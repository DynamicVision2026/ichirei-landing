// The completeness gate of a PAID gift (2026-11-14, B4). One automatic check per paid order — when the payment is seen (the webhook) and each time the buyer's page opens:
//
//   character    glyph, reading, the line (and for English the word) are there
//   poem         stored and not empty
//   pictures     every slot is a drawn picture, or a final washi that another passed picture stands in for (B2); a slot still pending / unchecked / an unfinished set is missing
//   film         the film script is `ready`
//   certificate  the certificate number is written
//
// Anything missing is redrawn / written again in the background — up to 5 tries over about 6 hours, with backoff. While the gift is incomplete the buyer's page says it is being finished
// instead of showing 「贈りものを受け取る」 (cancelling by e-mail stays possible). After the 5th try, or 12 hours after payment while still incomplete, the order is `needs_attention` in /ops
// (red) and — after the 5 tries — the collect button opens with what is there (the B2 stand-in pictures included). Paid orders never count against the daily picture limit (B5).

import type { AnimationRecord } from './animation.ts'
import { artRevFor, isAnimationRecord } from './animation.ts'
import { allocateCertificateNo } from './certificate-no.ts'
import { ensureArt, readArt, type ArtRecord, type ImageClient } from './film-art.ts'
import { filmInputFromRecord } from './film-store.ts'
import { makeFilm, type FilmInput, type FilmRecord } from './film.ts'
import { filmUsable } from './animation.ts'
import { isGiftRecord, type GiftRecord } from './gift.ts'
import { recordHealth } from './health.ts'
import type { GiftCheckState, OrderRecord } from './order.ts'
import type { OrderStore } from './order-store.ts'
import type Anthropic from '@anthropic-ai/sdk'

export type MissingPart = 'character' | 'poem' | 'pictures' | 'film' | 'certificate'
export interface GiftCheck {
  complete: boolean
  missing: MissingPart[]
}

export const MAX_TRIES = 5
/** Minutes before the next try, after the 1st … 5th: about 6 hours in all. */
export const TRY_DELAYS_MIN = [2, 10, 30, 90, 200] as const
export const ATTENTION_AFTER_MS = 12 * 3_600_000

/** What is missing from this gift. Pure: reads the records it is given. */
export function checkGift(order: OrderRecord, anim: AnimationRecord | null, gift: GiftRecord | null, art: ArtRecord | null, certNo?: number | null): GiftCheck {
  const missing: MissingPart[] = []
  const p = order.production
  const g = gift
  const hasWord = p.language !== 'en' || !!(g?.en?.word || p.certificate?.en?.word || p.certificate?.meaning_en || g?.meaning_en)
  if (!g || !g.glyph || !String(g.reading ?? '').trim() || !String(g.who ?? '').trim() || !p.glyph_to_carve || !hasWord) missing.push('character')
  const poemLines = g?.poem?.lines ?? p.certificate?.poems?.[0]?.lines ?? p.poems?.[0]?.lines ?? []
  if (!poemLines.some((l) => String(l ?? '').trim())) missing.push('poem')
  const film = anim?.film ?? null
  if (!filmUsable(film) || film.status !== 'ready') missing.push('film')
  // pictures: only meaningful for a ready script (a fallback script has nothing to draw; the film check already reports it)
  if (filmUsable(film) && film.status === 'ready') {
    const slots = art?.slots ?? []
    const settled = !!art && (art.status === 'done' || art.status === 'incomplete') && slots.length === film.lines.length && !slots.includes('pending') && !slots.includes('unchecked')
    if (!settled) missing.push('pictures')
  }
  const cert = certNo ?? order.certificate_no ?? g?.certificate_no ?? null
  if (!cert) missing.push('certificate')
  return { complete: missing.length === 0, missing }
}

export const triesOf = (o: OrderRecord): number => o.gift_check?.tries ?? 0
/** The 5 tries are used up: whatever is there goes to the buyer (collect opens). */
export const exhausted = (o: OrderRecord): boolean => triesOf(o) >= MAX_TRIES
/** Is the owner asked to look? 5 tries used up, or 12 hours after payment and still incomplete. */
export function needsAttention(o: OrderRecord, check: GiftCheck, now: Date): boolean {
  if (check.complete) return false
  if (o.gift_check?.attention) return true
  if (exhausted(o)) return true
  const seen = o.paid_at_seen ?? o.paid_seen_at ?? o.claim?.claimed_at ?? (o.source === 'reply' ? o.created_at : null)
  return !!seen && now.getTime() - Date.parse(seen) >= ATTENTION_AFTER_MS
}

export interface GiftCheckDeps {
  store: OrderStore
  env?: NodeJS.ProcessEnv
  now?: () => Date
  log?: (line: string) => void
  /** Tests: stand in for the certificate number, the poem, the film script and the image model / picture check. */
  allocate?: typeof allocateCertificateNo
  makePoem?: (rec: OrderRecord) => Promise<{ type: string; lines: string[]; pattern: string | null; reading: string } | null>
  film?: (input: FilmInput) => Promise<FilmRecord>
  image?: ImageClient
  vision?: Pick<Anthropic, 'messages'>
  pollMs?: number
}

const running = new Map<string, Promise<void>>()

async function loadParts(store: OrderStore, rec: OrderRecord) {
  const anim = rec.animation_id ? await store.get(rec.animation_id).catch(() => null) : null
  const gift = rec.gift_token ? await store.get(rec.gift_token).catch(() => null) : null
  const a = isAnimationRecord(anim) ? anim : null
  const g = isGiftRecord(gift) ? gift : null
  const art = a ? await readArt(store, a.id, artRevFor(a.id)).catch(() => null) : null
  return { anim: a, gift: g, art }
}

/** The check of an order as it stands (reads only). */
export async function checkOrder(store: OrderStore, rec: OrderRecord): Promise<GiftCheck & { anim: AnimationRecord | null; gift: GiftRecord | null; art: ArtRecord | null }> {
  const { anim, gift, art } = await loadParts(store, rec)
  return { ...checkGift(rec, anim, gift, art), anim, gift, art }
}

/** Write what is missing, as far as one try can. Never throws. */
async function repair(d: GiftCheckDeps, rec: OrderRecord, missing: MissingPart[]): Promise<OrderRecord> {
  const now = d.now?.() ?? new Date()
  let order = rec
  const { anim, gift } = await loadParts(d.store, order)
  // certificate number
  if (missing.includes('certificate')) {
    try {
      const n = await (d.allocate ?? allocateCertificateNo)(d.store, order.order_ref, now)
      order = { ...order, certificate_no: n }
      if (gift) await d.store.put(gift.token, { ...gift, certificate_no: n })
    } catch (err) {
      console.error('[ichirei-gift-check] certificate number failed', err instanceof Error ? err.message : err)
      void recordHealth(d.store, 'certificate_no_missing', { ref: order.order_ref }, now)
    }
  }
  // the film script
  let film: FilmRecord | null = anim?.film ?? null
  if (missing.includes('film') && anim) {
    try {
      film = await (d.film ?? makeFilm)(filmInputFromRecord(order))
      if (film.status === 'ready' || !filmUsable(anim.film)) {
        await d.store.put(anim.id, { ...anim, film })
        order = { ...order, production: { ...order.production, film } }
      }
    } catch (err) {
      console.error('[ichirei-gift-check] film script failed', err instanceof Error ? err.message : err)
    }
  }
  // the poem
  if (missing.includes('poem') && gift) {
    try {
      const poem = await d.makePoem?.(order)
      if (poem && poem.lines.some((l) => l.trim())) {
        order = { ...order, production: { ...order.production, poems: [{ poem_id: `PM-${order.order_ref}`, type: poem.type as never, lines: poem.lines, pattern: poem.pattern, reading: poem.reading }] } }
        await d.store.put(gift.token, { ...gift, poem: { type: poem.type, lines: poem.lines, reading: poem.reading } })
      } else void recordHealth(d.store, 'poem_failed', { ref: order.order_ref }, now)
    } catch {
      void recordHealth(d.store, 'poem_failed', { ref: order.order_ref }, now)
    }
  }
  // the pictures: only the missing slots are drawn (an unfinished set continues); paid, so the daily limit never holds it back
  if (missing.includes('pictures') && anim && filmUsable(film) && film.status === 'ready') {
    await ensureArt(
      { store: d.store, image: d.image, client: d.vision, env: d.env, log: d.log, now: d.now, pollMs: d.pollMs, force: true },
      { id: anim.id, film, memorial: anim.memorial, language: anim.language, rev: artRevFor(anim.id), paid: true },
    ).catch(() => null)
  }
  return order
}

/**
 * One background try (a try is counted when it runs). Saves the state on the order record and the health counters. Returns the new check.
 */
export async function runGiftTry(d: GiftCheckDeps, orderRef: string): Promise<GiftCheck | null> {
  const now = d.now?.() ?? new Date()
  let rec = (await d.store.get(orderRef).catch(() => null)) as OrderRecord | null
  if (!rec || !rec.production) return null
  const first = await checkOrder(d.store, rec)
  const prev: GiftCheckState = rec.gift_check ?? { tries: 0, missing: [] }
  if (first.complete) {
    if (prev.missing.length || !prev.complete_at) await d.store.put(rec.order_ref, { ...rec, gift_check: { ...prev, missing: [], next_try_at: null, complete_at: prev.complete_at ?? now.toISOString() } })
    return first
  }
  if (!prev.first_incomplete_at) void recordHealth(d.store, 'gift_incomplete', { ref: rec.order_ref, reason: first.missing.join('_') }, now)
  const tries = prev.tries + 1
  rec = await repair(d, rec, first.missing)
  const after = await checkOrder(d.store, rec)
  const delay = TRY_DELAYS_MIN[Math.min(tries - 1, TRY_DELAYS_MIN.length - 1)]
  const state: GiftCheckState = {
    tries,
    last_try_at: now.toISOString(),
    next_try_at: after.complete || tries >= MAX_TRIES ? null : new Date(now.getTime() + delay * 60_000).toISOString(),
    missing: after.missing,
    first_incomplete_at: prev.first_incomplete_at ?? now.toISOString(),
    ...(after.complete ? { complete_at: now.toISOString() } : {}),
    ...(prev.attention ? { attention: true, attention_at: prev.attention_at ?? null } : {}),
  }
  const flagged = !after.complete && needsAttention({ ...rec, gift_check: state }, after, now)
  if (flagged && !state.attention) {
    state.attention = true
    state.attention_at = now.toISOString()
    void recordHealth(d.store, 'needs_attention', { ref: rec.order_ref, reason: after.missing.join('_') }, now)
  }
  await d.store.put(rec.order_ref, { ...rec, gift_check: state, updated_at: now.toISOString() })
  ;(d.log ?? console.log)(`[ichirei-gift-check] ${JSON.stringify({ event: 'try', tries, complete: after.complete, missing: after.missing, attention: !!state.attention })}`)
  return after
}

/** True when a background try may run now: incomplete, tries left, its time has come, and none is running for this order. */
export function tryDue(rec: OrderRecord, check: GiftCheck, now: Date): boolean {
  if (check.complete || exhausted(rec) || running.has(rec.order_ref)) return false
  const next = rec.gift_check?.next_try_at
  return !next || Date.parse(next) <= now.getTime()
}

/** Start a try in the background when one is due (the buyer's page and the webhook call this; they never wait for it). Returns whether one was started. */
export function startTryIfDue(d: GiftCheckDeps, rec: OrderRecord, check: GiftCheck): boolean {
  if (!tryDue(rec, check, d.now?.() ?? new Date())) return false
  const p = runGiftTry(d, rec.order_ref).then(() => undefined, (err) => console.error('[ichirei-gift-check] try failed', err instanceof Error ? err.message : err))
  running.set(rec.order_ref, p)
  const done = () => { if (running.get(rec.order_ref) === p) running.delete(rec.order_ref) }
  p.then(done, done)
  return true
}

/** Tests: wait for the try of this order that is running (if any). */
export const waitForTry = (orderRef: string): Promise<void> => running.get(orderRef) ?? Promise.resolve()

