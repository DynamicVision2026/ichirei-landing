// The 24-hour change window after payment (2026-10-30), and what the owner may do inside it.
//
//   Within 24 hours of payment: switch to another character ALREADY SHOWN for this story (the poem is written again, once, in the same format; the
//   pictures stay), change the poem format once, fix the printed names and message, or cancel (a flag — the refund itself is made by the owner in Shopify).
//   After 24 hours: nothing for a change of mind: every piece is made to order. Our own mistakes are fixed whenever they are found.
//
// Nothing is made before the window closes: the workshop CSV and the card PDFs list only orders whose window has closed (api/ops.ts). Everything here changes
// OUR records only (the order, the film page, the receiver's page) — never Shopify, whose order attributes keep what was sent at checkout.

import { isAnimationRecord, type AnimationRecord } from './animation.ts'
import type { Candidate } from './contract.ts'
import { isGiftRecord, type GiftRecord } from './gift.ts'
import { GIFT_MESSAGE_MAX, SHIPS, poemTypeAllowed, type PoemType } from '../src/order/packages.ts'
import { glyphFor } from '../src/order/inscription.ts'
import { isMemorial } from '../src/order/memorial.ts'
import { NAME_MAX, buildCertificate, cleanName, simpleStrokeProblem, type OpsLogEntry, type OrderRecord, type StoredPoem } from './order.ts'
import type { OrderStore } from './order-store.ts'
import { loadPalette, type Palette } from './palette.ts'
import type { PaymentInfo } from './shipping.ts'
import { countChars, mergeStory } from './contract.ts'

export const WINDOW_MS = 24 * 3_600_000

export type WindowPhase = 'open' | 'closed' | 'cancelled' | 'unpaid'
export interface WindowInfo {
  phase: WindowPhase
  /** When the payment went through (or, when Shopify could not be asked, when the order was made — then `verified` is false). */
  paid_at: string | null
  ends_at: string | null
  /** Whole hours left while the window is open (rounded up), else null. */
  hours_left: number | null
  verified: boolean
}

/**
 * `pay`: what Shopify said about this order — a PaymentInfo; `null` = Shopify answered but has no such order (never paid, or older than the app can see);
 * `'unverified'` = Shopify could not be asked (the order's own time is used, and the page says so).
 */
export function windowOf(rec: OrderRecord | null, pay: PaymentInfo | null | 'unverified', now: Date): WindowInfo {
  const none = (phase: WindowPhase, verified = true): WindowInfo => ({ phase, paid_at: null, ends_at: null, hours_left: null, verified })
  if (rec?.ops?.cancelled_at) return none('cancelled')
  if (pay === 'unverified') return span(rec?.created_at ?? null, now, false)
  if (pay === null) return none('unpaid')
  if (pay.state === 'cancelled' || pay.state === 'refunded') return none('cancelled')
  if (pay.state === 'unpaid') return none('unpaid')
  return span(pay.paid_at, now, true)
}

function span(paidAt: string | null, now: Date, verified: boolean): WindowInfo {
  const t = paidAt ? Date.parse(paidAt) : NaN
  if (!Number.isFinite(t)) return { phase: 'unpaid', paid_at: null, ends_at: null, hours_left: null, verified }
  const end = t + WINDOW_MS
  const open = now.getTime() < end
  return { phase: open ? 'open' : 'closed', paid_at: new Date(t).toISOString(), ends_at: new Date(end).toISOString(), hours_left: open ? Math.max(1, Math.ceil((end - now.getTime()) / 3_600_000)) : null, verified }
}

// ---- the owner's actions ------------------------------------------------------------------------------------------------------------------------------------------

export type ChangeResult = { ok: true; message: string } | { ok: false; code: string; error: string }
const refuse = (code: string, error: string): ChangeResult => ({ ok: false, code, error })

export interface PoemMaker {
  /** Write one poem of `type` for `kanji` of this order's story (the same checks as the page's poem step). null = it could not be written. */
  (rec: OrderRecord, candidate: Candidate, type: PoemType): Promise<StoredPoem | null>
}

export interface ChangeDeps {
  store: OrderStore
  now: Date
  /** The user name the owner typed at /ops (the log's "who"). */
  who: string
  makePoem: PoemMaker
  palette?: Palette
}

const cleanWho = (s: string) => s.replace(/[^\w.@-]/g, '').slice(0, 30) || 'owner'
const logEntry = (d: ChangeDeps, action: OpsLogEntry['action'], detail: string): OpsLogEntry => ({ at: d.now.toISOString(), who: cleanWho(d.who), action, detail })

async function related(store: OrderStore, rec: OrderRecord): Promise<{ anim: AnimationRecord | null; gift: GiftRecord | null }> {
  let anim: AnimationRecord | null = null
  let gift: GiftRecord | null = null
  try {
    const a = rec.animation_id ? await store.get(rec.animation_id) : null
    anim = isAnimationRecord(a) ? a : null
    const g = rec.gift_token ? await store.get(rec.gift_token) : null
    gift = isGiftRecord(g) ? g : null
  } catch {
    // handled by the caller: the order record alone can still be changed
  }
  return { anim, gift }
}

const currentPoemType = (rec: OrderRecord): PoemType | null => (rec.production.poems[0]?.type ?? null)

function applyPoem(rec: OrderRecord, gift: GiftRecord | null, poem: StoredPoem | null) {
  rec.production.poems = poem ? [{ poem_id: poem.poem_id, type: poem.type, lines: poem.lines, pattern: poem.pattern, reading: poem.reading }] : []
  rec.production.certificate = { ...rec.production.certificate, poems: poem ? [{ type: poem.type, lines: poem.lines, reading: poem.reading }] : [] }
  if (gift) gift.poem = poem ? { type: poem.type, lines: poem.lines, reading: poem.reading } : null
}

/** Switch to another character that was shown for this story. The poem is written again (same format); the film's pictures and lines stay. */
export async function changeCharacter(d: ChangeDeps, rec: OrderRecord, kanji: string): Promise<ChangeResult> {
  const p = rec.production
  if (kanji === p.kanji) return refuse('same_character', 'That is the character of the order already.')
  const cand = rec.shown_characters?.find((s) => s.candidate.kanji === kanji)?.candidate
  if (!cand) return refuse('not_shown', 'Only a character that was shown for this story can be chosen.')
  const glyph = glyphFor(cand, p.inscription_style)
  if (p.package === 'simple') {
    const problem = simpleStrokeProblem(cand, glyph)
    if (problem) return refuse('too_many_strokes', problem)
  }
  const { anim, gift } = await related(d.store, rec)
  // the film must never name its answer: a line that contains the new character stops the change (nothing is redrawn, nothing is rewritten)
  const forms = [cand.kanji, glyph, cand.inscription_form ?? ''].filter(Boolean)
  if (anim?.film?.lines.some((l) => forms.some((f) => l.includes(f)))) return refuse('film_line_has_character', 'A line of the film contains that character; it cannot be changed to it.')
  // the poem: the same format, written for the new character, with the same checks as on the page (a failure changes nothing)
  const type = currentPoemType(rec)
  let poem: StoredPoem | null = null
  if (type) {
    poem = await d.makePoem(rec, cand, type)
    if (!poem) return refuse('poem_failed', 'The poem for that character could not be written just now. Nothing was changed; try again.')
  }
  const palette = d.palette ?? loadPalette()
  const from = p.glyph_to_carve
  rec.production = {
    ...p,
    kanji: cand.kanji,
    glyph_to_carve: glyph,
    reading: cand.reading,
    meaning: cand.meaning ?? null,
    gaze_line: cand.one_line_gaze,
    story_anchor: cand.story_anchor,
    unique_truth: cand.unique_truth ?? '',
    suitability_flag: cand.suitability_flag ?? null,
    certificate: buildCertificate(cand, glyph, p.language, palette, isMemorial(rec.engine_result.occasion ?? null), rec.engine_result.purpose ?? null),
  }
  applyPoem(rec, gift, poem)
  const cert = rec.production.certificate
  if (anim) Object.assign(anim, { glyph, reading: cert.reading, romanization: cert.romanization, meaning_en: cert.meaning_en, moment: cand.story_anchor, who: cand.one_line_gaze })
  if (gift) Object.assign(gift, { glyph, reading: cert.reading, romanization: cert.romanization, meaning_en: cert.meaning_en, who: cand.one_line_gaze })
  rec.ops = { ...(rec.ops ?? {}), log: [...(rec.ops?.log ?? []), logEntry(d, 'change_character', `${from} → ${glyph}`)] }
  rec.updated_at = d.now.toISOString()
  await save(d.store, rec, anim, gift)
  return { ok: true, message: `${from} → ${glyph}` }
}

/** The poem format, once per order (the character stays). */
export async function changePoemFormat(d: ChangeDeps, rec: OrderRecord, type: PoemType): Promise<ChangeResult> {
  const current = currentPoemType(rec)
  if (!current) return refuse('no_poem', 'This order has no poem to change.')
  if (type === current) return refuse('same_format', 'That is the format of the poem already.')
  // the formats follow the story's language (spec v9.4); an order made before keeps the format it has, and may switch only to one that is offered now
  if (!poemTypeAllowed(rec.production.language, type, mergeStory(rec.story, rec.follow_ups))) return refuse('format_not_offered', 'That format is not offered for this story\'s language.')
  if ((rec.ops?.poem_format_changes ?? 0) >= 1) return refuse('poem_format_used', 'The poem format can be changed once per order, and it was.')
  const cand = rec.shown_characters?.find((s) => s.candidate.kanji === rec.production.kanji)?.candidate ?? rec.engine_result.candidates.find((c) => c.kanji === rec.production.kanji)
  if (!cand) return refuse('no_candidate', 'The character of this order could not be found in its record.')
  const poem = await d.makePoem(rec, cand, type)
  if (!poem) return refuse('poem_failed', 'The poem could not be written just now. Nothing was changed; try again.')
  const { anim, gift } = await related(d.store, rec)
  applyPoem(rec, gift, poem)
  rec.ops = { ...(rec.ops ?? {}), poem_format_changes: (rec.ops?.poem_format_changes ?? 0) + 1, log: [...(rec.ops?.log ?? []), logEntry(d, 'change_poem', `${current} → ${type}`)] }
  rec.updated_at = d.now.toISOString()
  await save(d.store, rec, anim, gift)
  return { ok: true, message: `${current} → ${type}` }
}

/** The names and the message printed on the card (the message at most 60 characters, and only for a gift that goes to the receiver). */
export async function editNames(d: ChangeDeps, rec: OrderRecord, input: { sender?: unknown; receiver?: unknown; message?: unknown }): Promise<ChangeResult> {
  const p = rec.production
  const changed: string[] = []
  let sender = p.sender_name
  let receiver = p.receiver_name
  let message = p.gift_message ?? ''
  if (input.sender !== undefined) {
    const v = cleanName(input.sender)
    if (!v) return refuse('bad_sender', `The sender's name must be 1–${NAME_MAX} characters.`)
    if (v !== sender) changed.push('sender')
    sender = v
  }
  if (input.receiver !== undefined) {
    const v = cleanName(input.receiver)
    if (!v) return refuse('bad_receiver', `The receiver's name must be 1–${NAME_MAX} characters.`)
    if (v !== receiver) changed.push('receiver')
    receiver = v
  }
  if (input.message !== undefined) {
    if (typeof input.message !== 'string') return refuse('bad_message', 'The message must be text.')
    const flat = input.message.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()
    if (countChars(flat) > GIFT_MESSAGE_MAX) return refuse('message_too_long', `The message is at most ${GIFT_MESSAGE_MAX} characters.`)
    if (flat && (p.ship_to === 'me' || p.ship_to === 'none' || !SHIPS[p.package])) return refuse('no_message', 'A message travels only with a gift that goes to the receiver (directly or as an e-gift).')
    if (flat !== message) changed.push('message')
    message = flat
  }
  if (changed.length === 0) return refuse('nothing_changed', 'Nothing was changed.')
  const { anim, gift } = await related(d.store, rec)
  rec.production = { ...p, sender_name: sender, receiver_name: receiver, gift_message: message }
  if (gift) Object.assign(gift, { from: sender, to: receiver, message })
  rec.ops = { ...(rec.ops ?? {}), log: [...(rec.ops?.log ?? []), logEntry(d, 'edit_names', changed.join('+'))] }
  rec.updated_at = d.now.toISOString()
  await save(d.store, rec, anim, gift)
  return { ok: true, message: changed.join(', ') }
}

/** Flag the order cancelled: it leaves the print list and the workshop CSV. The refund is the owner's, in Shopify. */
export async function cancelOrder(d: ChangeDeps, rec: OrderRecord): Promise<ChangeResult> {
  if (rec.ops?.cancelled_at) return refuse('already_cancelled', 'The order is marked cancelled already.')
  rec.ops = { ...(rec.ops ?? {}), cancelled_at: d.now.toISOString(), log: [...(rec.ops?.log ?? []), logEntry(d, 'cancel', 'flag')] }
  rec.updated_at = d.now.toISOString()
  await d.store.put(rec.order_ref, rec)
  return { ok: true, message: 'cancelled' }
}

async function save(store: OrderStore, rec: OrderRecord, anim: AnimationRecord | null, gift: GiftRecord | null) {
  if (anim) await store.put(anim.id, anim)
  if (gift) await store.put(gift.token, gift)
  await store.put(rec.order_ref, rec)
}
