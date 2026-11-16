// The free-gift days (customer-loop ticket, 2026-11-15, parts 4 and 5): the live count and the email holds of the "Days of Thanks" promotion (en). All state lives in the order store and is shared by
// every Cloud Run instance, with create-if-absent or generation-match writes, so two instances can never give the same last free gift twice:
//
//   promo/<day>/slots/<n>-<g>.json   the day's capacity: slot n (1..100), generation g. A hold takes the lowest free slot with an IF-ABSENT create; a slot whose hold ended (expired or released)
//                                    is taken again as the next generation (n-(g+1)), again if-absent; a slot whose gift was given stays used. Exactly one of two racing instances wins a slot.
//   promo/<day>/holds/<email hash>.json   one record per email and day: the email, the browsers, the code, the times, the status, how many holds today, the slot, the Shopify customer.
//   promo/<day>/ip/<hash>-<k>.json   the address backstop: 10 holds per address per day, if-absent slots.
//
// A promo day runs 4:00 a.m. to 3:59 a.m. US Eastern (engine/promo.ts). {n} on the live card = daily − used − active.
// Paying at the normal price needs no hold, and any email works at checkout; only the FREE gift is tied to the hold's email (Shopify checks that: engine/promo-shopify.ts).

import { createHash, randomBytes } from 'node:crypto'
import { analyticsDay } from './analytics.ts'
import { casJson, customerIdOf, emailHash, normalizeEmail, readCustomer, recordCustomerEvent, saveConsent, validEmail } from './customer.ts'
import { recordHealth } from './health.ts'
import type { OrderStore } from './order-store.ts'
import { promoCheckoutGraceMinutes, promoDaily, promoDayEnd, promoDayKey, promoHoldMinutes, promoHoldsPerDay, promoOn, promoWindow } from './promo.ts'
import { codeAllowed, promoConfig, type PromoShopify } from './promo-shopify.ts'

const MIN = 60_000
const IP_HOLDS_PER_DAY = 10
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export interface SlotRecord {
  hold: string
  email_hash: string
  created_at: string
  expires_at: string
  state: 'active' | 'used' | 'released'
  /** True once the end of this hold was handled (eligibility removed, `hold_expired` recorded). */
  reaped?: boolean
}

export interface HoldRecord {
  schema: 'hold'
  id: string
  day: string
  email: string
  email_hash: string
  browsers: string[]
  code: string | null
  created_at: string
  expires_at: string
  /** Set when the owner of the hold went to checkout: the hold then lives until this time (the grace). */
  checkout_until?: string | null
  status: 'active' | 'checkout' | 'used' | 'expired'
  /** How many holds this email has placed today (the first is 1). */
  count: number
  slot: { n: number; g: number }
  shopify_customer: string | null
  used_at?: string | null
  consent: boolean
}

export type HoldState = 'active' | 'checkout' | 'used' | 'expired'

export interface HoldView {
  id: string
  email: string
  day: string
  state: HoldState
  expires_at: string
  minutes_left: number
  count: number
  code: string | null
  slot: { n: number; g: number }
}

export interface PromoDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  shopify?: PromoShopify | null
  log?: (line: string) => void
}

const slotPath = (day: string, n: number, g: number): string => `promo/${day}/slots/${n}-${g}.json`
const holdPath = (day: string, hash: string): string => `promo/${day}/holds/${hash}.json`
/** (2026-11-16) one free gift per person for the WHOLE promotion (Shopify: THANKS100 once per customer): an email that used its free gift on any day is marked here. */
const usedEverPath = (hash: string): string => `promo/used/${hash}.json`

/**
 * Has this email received its free gift at any time in the promotion (any day, either language)? The marker written when a gift is used answers at once; a gift used before the marker
 * existed is found by reading this email's hold of each earlier promotion day (at most one small read per day), and the marker is written then.
 */
export async function usedInPromotion(store: OrderStore, env: NodeJS.ProcessEnv, hash: string, now: Date): Promise<boolean> {
  if (await readJson<{ day: string }>(store, usedEverPath(hash))) return true
  const win = promoWindow(env)
  if (!win) return false
  const first = promoDayKey(new Date(win.from))
  let day = promoDayKey(now)
  for (let i = 0; i < 60 && day >= first; i++) {
    const r = await readJson<HoldRecord>(store, holdPath(day, hash))
    if (r && r.status === 'used') {
      await store.putObject(usedEverPath(hash), JSON.stringify({ day, at: now.toISOString() }), 'application/json').catch(() => false)
      return true
    }
    day = analyticsDayBefore(day)
  }
  return false
}
const ipPath = (day: string, ip: string, k: number): string => `promo/${day}/ip/${createHash('sha256').update(ip).digest('hex').slice(0, 16)}-${k}.json`
const newHoldId = (): string => {
  let out = 'H-'
  for (const b of randomBytes(16)) out += ALPHABET[b % ALPHABET.length]
  return out
}

const readJson = async <T,>(store: OrderStore, p: string): Promise<T | null> => {
  try {
    const raw = await store.getObject(p)
    return raw ? (JSON.parse(raw.toString('utf8')) as T) : null
  } catch {
    return null
  }
}

const slotFree = (s: SlotRecord, now: Date): boolean => s.state === 'released' || (s.state === 'active' && now.getTime() >= Date.parse(s.expires_at))
const slotState = (s: SlotRecord, now: Date): 'used' | 'active' | 'free' => (s.state === 'used' ? 'used' : slotFree(s, now) ? 'free' : 'active')

/** The latest generation of slot n (null when it was never taken), probing generations 1, 2, 3 … */
async function latestSlot(store: OrderStore, day: string, n: number): Promise<{ g: number; slot: SlotRecord } | null> {
  let last: { g: number; slot: SlotRecord } | null = null
  for (let g = 1; g <= 30; g++) {
    const s = await readJson<SlotRecord>(store, slotPath(day, n, g))
    if (!s) break
    last = { g, slot: s }
  }
  return last
}

/** The day's capacity at this moment: how many gifts are given and how many are held. Slots are taken in order, so the scan stops at the first slot never taken. */
export async function scanDay(store: OrderStore, day: string, daily: number, now: Date): Promise<{ used: number; active: number; slots: { n: number; g: number; slot: SlotRecord; state: 'used' | 'active' | 'free' }[] }> {
  let used = 0
  let active = 0
  const slots: { n: number; g: number; slot: SlotRecord; state: 'used' | 'active' | 'free' }[] = []
  for (let n = 1; n <= daily; n++) {
    const l = await latestSlot(store, day, n)
    if (!l) break
    const state = slotState(l.slot, now)
    slots.push({ n, g: l.g, slot: l.slot, state })
    if (state === 'used') used++
    else if (state === 'active') active++
  }
  return { used, active, slots }
}

const cache = new Map<string, { at: number; used: number; active: number }>()
const CACHE_MS = 8_000
export const resetPromoCache = (): void => cache.clear()

export interface Count {
  daily: number
  used: number
  active: number
  left: number
}

/** The live card's number: `left` = daily − used − active, never below 0. Cached for a few seconds per instance (a cache only: a hold is always decided on the slots themselves). */
export async function liveCount(store: OrderStore | null, env: NodeJS.ProcessEnv, now: Date, fresh = false): Promise<Count> {
  const daily = promoDaily(env)
  if (!store) return { daily, used: 0, active: 0, left: daily }
  const day = promoDayKey(now)
  const hit = cache.get(day)
  if (!fresh && hit && now.getTime() - hit.at < CACHE_MS) return { daily, used: hit.used, active: hit.active, left: Math.max(0, daily - hit.used - hit.active) }
  const s = await scanDay(store, day, daily, now)
  cache.set(day, { at: now.getTime(), used: s.used, active: s.active })
  return { daily, used: s.used, active: s.active, left: Math.max(0, daily - s.used - s.active) }
}

async function claimSlot(store: OrderStore, day: string, daily: number, hold: string, hash: string, now: Date, expires: Date): Promise<{ n: number; g: number } | null> {
  const fresh = (): SlotRecord => ({ hold, email_hash: hash, created_at: now.toISOString(), expires_at: expires.toISOString(), state: 'active' })
  for (let n = 1; n <= daily; n++) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const l = await latestSlot(store, day, n)
      const g = l ? l.g + 1 : 1
      if (l && !slotFree(l.slot, now)) break // taken (held or given): the next slot
      // free (never taken, or its hold ended): an IF-ABSENT create of the next generation — exactly one racer wins
      if (await store.putObject(slotPath(day, n, g), JSON.stringify(fresh()), 'application/json', { ifAbsent: true })) return { n, g }
      // lost the race: look at this slot again
    }
  }
  return null
}

async function claimIp(store: OrderStore, day: string, ip: string): Promise<boolean> {
  for (let k = 1; k <= IP_HOLDS_PER_DAY; k++) {
    if (await store.putObject(ipPath(day, ip, k), '{}', 'application/json', { ifAbsent: true })) return true
  }
  return false
}

/** A hold as the page sees it, with its state worked out from the slot (the stored status is only a hint). */
export async function viewHold(store: OrderStore, rec: HoldRecord, now: Date): Promise<HoldView> {
  const slot = await readJson<SlotRecord>(store, slotPath(rec.day, rec.slot.n, rec.slot.g))
  const mine = !!slot && slot.hold === rec.id
  let state: HoldState
  const until = Math.max(Date.parse(rec.expires_at), rec.checkout_until ? Date.parse(rec.checkout_until) : 0)
  if (rec.status === 'used' || (mine && slot!.state === 'used')) state = 'used'
  else if (!mine || slot!.state === 'released' || now.getTime() >= until) state = 'expired'
  else state = rec.checkout_until && now.getTime() < Date.parse(rec.checkout_until) && rec.status === 'checkout' ? 'checkout' : 'active'
  return { id: rec.id, email: rec.email, day: rec.day, state, expires_at: new Date(until).toISOString(), minutes_left: Math.max(0, Math.ceil((until - now.getTime()) / MIN)), count: rec.count, code: rec.code, slot: rec.slot }
}

export async function holdOfEmail(store: OrderStore | null, email: string, now: Date): Promise<{ rec: HoldRecord; view: HoldView } | null> {
  if (!store || !validEmail(email)) return null
  const day = promoDayKey(now)
  const rec = await readJson<HoldRecord>(store, holdPath(day, emailHash(email)))
  return rec ? { rec, view: await viewHold(store, rec, now) } : null
}

/** The hold this browser has today: the emails of its customer record, newest hold first. */
export async function holdOfBrowser(store: OrderStore | null, browser: string | null, now: Date): Promise<{ rec: HoldRecord; view: HoldView } | null> {
  if (!store || !browser) return null
  const cust = await readCustomer(store, await customerIdOf(store, browser))
  if (!cust) return null
  let best: { rec: HoldRecord; view: HoldView } | null = null
  for (const e of cust.emails) {
    const h = await holdOfEmail(store, e, now)
    if (h && (!best || Date.parse(h.rec.created_at) > Date.parse(best.rec.created_at))) best = h
  }
  // a browser added to a hold (same email on another device) finds it through the hold record itself
  return best
}

export type PlaceResult =
  | { ok: true; hold: HoldView; existing: boolean }
  | { ok: false; code: 'off' | 'bad_email' | 'bad_code' | 'all_held' | 'three_holds' | 'already_given' | 'ip_limit' | 'unavailable' }

export interface PlaceInput {
  email: unknown
  code?: unknown
  browser?: string | null
  ip?: string
  /** "Also tell me about new seasons and offers" */
  marketing?: boolean
  language?: string | null
}

/**
 * "Hold my free gift". A hold is placed only if: the promotion is on, the email is valid (no code is needed since 2026-11-15), gifts are left (a slot is won), this email has fewer than three
 * holds today and has not received today's free gift, and the address backstop allows it. The same email while a hold is active (from any device) shows that hold: no new hold, the expiry unchanged.
 * Any Shopify failure means NO hold (and `promo_unavailable` is counted) — never a broken page.
 */
export async function placeHold(d: PromoDeps, input: PlaceInput): Promise<PlaceResult> {
  const env = d.env ?? process.env
  const now = d.now?.() ?? new Date()
  const store = d.store
  if (!store || !promoOn(env, now)) return { ok: false, code: 'off' }
  if (!validEmail(input.email)) return { ok: false, code: 'bad_email' }
  const email = normalizeEmail(input.email)
  const cfg = promoConfig(env)
  if (!cfg) {
    void recordHealth(store, 'promo_unavailable', { reason: 'not_configured' }, now)
    return { ok: false, code: 'unavailable' }
  }
  // (2026-11-15) the free gift needs no code: the card asks only for an email. A code that comes with the request (a ?code=… link) is kept when it is one of the configured codes and ignored otherwise.
  const givenCode = codeAllowed(cfg, input.code) && typeof input.code === 'string' ? input.code.trim().toUpperCase() : null
  const day = promoDayKey(now)
  const hash = emailHash(email)
  const browser = input.browser && /^V[A-Za-z0-9_-]{22}$/.test(input.browser) ? input.browser : null
  const existing = await readJson<HoldRecord>(store, holdPath(day, hash))
  // one free gift per person for the whole promotion (2026-11-16, matching Shopify's "once per customer"): an email that received one on ANY day, in either language, holds no more
  if (!(existing && (existing.status === 'active' || existing.status === 'checkout')) && (await usedInPromotion(store, env, hash, now))) return { ok: false, code: 'already_given' }
  if (existing) {
    const view = await viewHold(store, existing, now)
    if (view.state === 'active' || view.state === 'checkout') {
      // the same email again (maybe another device): the same hold, the expiry unchanged — the browser is added to it
      if (browser && !existing.browsers.includes(browser)) {
        await casJson<HoldRecord>(store, holdPath(day, hash), (cur) => {
          if (!cur) return null
          if (!cur.browsers.includes(browser)) cur.browsers.push(browser)
          return cur
        })
        await recordCustomerEvent(store, { email, browser }, 'visited', { language: input.language ?? null }, now)
      }
      return { ok: true, hold: view, existing: true }
    }
    if (view.state === 'used') return { ok: false, code: 'already_given' }
    if (existing.count >= promoHoldsPerDay(env)) return { ok: false, code: 'three_holds' }
  }
  if (!d.shopify) {
    void recordHealth(store, 'promo_unavailable', { reason: 'no_shopify' }, now)
    return { ok: false, code: 'unavailable' }
  }
  if (input.ip && !(await claimIp(store, day, input.ip))) return { ok: false, code: 'ip_limit' }
  const expires = new Date(Math.min(now.getTime() + promoHoldMinutes(env) * MIN, promoDayEnd(now).getTime()))
  const id = newHoldId()
  const slot = await claimSlot(store, day, promoDaily(env), id, hash, now, expires)
  if (!slot) {
    cache.delete(day)
    return { ok: false, code: 'all_held' }
  }
  let customerId: string
  try {
    customerId = await d.shopify.addEligible(email)
  } catch (err) {
    // no hold without Shopify: the slot goes back at once
    await casJson<SlotRecord>(store, slotPath(day, slot.n, slot.g), (cur) => (cur ? { ...cur, state: 'released', reaped: true } : null)).catch(() => null)
    cache.delete(day)
    void recordHealth(store, 'promo_unavailable', { reason: err instanceof Error && 'reason' in err ? String((err as { reason: string }).reason) : 'shopify' }, now)
    d.log?.(`[ichirei-promo] ${JSON.stringify({ event: 'promo_unavailable' })}`)
    return { ok: false, code: 'unavailable' }
  }
  const rec: HoldRecord = {
    schema: 'hold', id, day, email, email_hash: hash, browsers: browser ? [browser] : [], code: givenCode,
    created_at: now.toISOString(), expires_at: expires.toISOString(), status: 'active', count: (existing?.count ?? 0) + 1, slot, shopify_customer: customerId, consent: input.marketing === true,
  }
  if (existing) await casJson<HoldRecord>(store, holdPath(day, hash), () => ({ ...rec, browsers: [...new Set([...existing.browsers, ...rec.browsers])] }))
  else if (!(await store.putObject(holdPath(day, hash), JSON.stringify(rec), 'application/json', { ifAbsent: true }))) {
    // the same email raced itself from two devices: the other request's hold stands; ours goes back
    await casJson<SlotRecord>(store, slotPath(day, slot.n, slot.g), (cur) => (cur ? { ...cur, state: 'released', reaped: true } : null)).catch(() => null)
    const other = await readJson<HoldRecord>(store, holdPath(day, hash))
    cache.delete(day)
    return other ? { ok: true, hold: await viewHold(store, other, now), existing: true } : { ok: false, code: 'unavailable' }
  }
  cache.delete(day)
  await recordCustomerEvent(store, { email, browser }, 'held', { language: input.language ?? null, code: rec.code }, now)
  void recordHealth(store, 'held', { reason: rec.code ?? 'none' }, now)
  if (input.marketing === true) {
    await saveConsent(store, { email, browser }, true, now).catch(() => {})
    try {
      await d.shopify.saveConsent(email, now)
      void recordHealth(store, 'consent_saved', {}, now)
    } catch {
      void recordHealth(store, 'consent_not_saved', {}, now) // a missing write_customers scope: the hold still stands, the consent is kept on our side only
    }
  }
  return { ok: true, hold: await viewHold(store, rec, now), existing: false }
}

/** "Continue to payment" with an active hold: the hold goes to `checkout` and lives 30 minutes more (the grace) — never shorter than it already was. */
export async function startCheckout(d: PromoDeps, rec: HoldRecord): Promise<HoldView | null> {
  const store = d.store
  if (!store) return null
  const env = d.env ?? process.env
  const now = d.now?.() ?? new Date()
  const until = new Date(Math.max(Date.parse(rec.expires_at), now.getTime() + promoCheckoutGraceMinutes(env) * MIN))
  const next = await casJson<HoldRecord>(store, holdPath(rec.day, rec.email_hash), (cur) => (cur && cur.id === rec.id && cur.status !== 'used' ? { ...cur, status: 'checkout', checkout_until: until.toISOString() } : null))
  if (!next) return null
  // the slot lives as long as the hold does
  await casJson<SlotRecord>(store, slotPath(rec.day, rec.slot.n, rec.slot.g), (cur) => (cur && cur.hold === rec.id && cur.state === 'active' ? { ...cur, expires_at: new Date(Math.max(Date.parse(cur.expires_at), until.getTime())).toISOString() } : null))
  cache.delete(rec.day)
  return viewHold(store, next, now)
}

/**
 * The paid ($0) webhook: the hold is USED — by hold id, else by email. The slot stays used for the day, the customer is taken off the eligible list at once, and the timeline gets
 * `hold_used`. Returns true when a hold was marked.
 */
export async function markHoldUsed(d: PromoDeps, ref: { holdId?: string | null; email?: string | null }): Promise<boolean> {
  const store = d.store
  if (!store) return false
  const now = d.now?.() ?? new Date()
  const day = promoDayKey(now)
  const days = [day, analyticsDayBefore(day)]
  let found: HoldRecord | null = null
  if (ref.email && validEmail(ref.email)) {
    for (const dd of days) {
      const r = await readJson<HoldRecord>(store, holdPath(dd, emailHash(ref.email)))
      if (r && (!ref.holdId || r.id === ref.holdId)) {
        found = r
        break
      }
    }
  }
  if (!found) return false
  const rec = found
  await casJson<SlotRecord>(store, slotPath(rec.day, rec.slot.n, rec.slot.g), (cur) => (cur && cur.hold === rec.id ? { ...cur, state: 'used', reaped: true } : null))
  await casJson<HoldRecord>(store, holdPath(rec.day, rec.email_hash), (cur) => (cur ? { ...cur, status: 'used', used_at: now.toISOString() } : null))
  await store.putObject(usedEverPath(rec.email_hash), JSON.stringify({ day: rec.day, at: now.toISOString() }), 'application/json').catch(() => false)
  cache.delete(rec.day)
  if (rec.shopify_customer && d.shopify) await d.shopify.removeEligible(rec.shopify_customer).catch(() => d.log?.(`[ichirei-promo] ${JSON.stringify({ event: 'remove_eligible_failed' })}`))
  await recordCustomerEvent(store, { email: rec.email, browser: rec.browsers[0] ?? null }, 'hold_used', {}, now)
  void recordHealth(store, 'hold_used', {}, now)
  return true
}

const analyticsDayBefore = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Handle the end of holds that expired: take their customers off Shopify's eligible list and record `hold_expired` (once each). Called on a timer by the live-count endpoint and from the daily trigger.
 * Returns how many holds were handled.
 */
export async function reapExpired(d: PromoDeps): Promise<number> {
  const store = d.store
  if (!store) return 0
  const env = d.env ?? process.env
  const now = d.now?.() ?? new Date()
  let n = 0
  const today = promoDayKey(now)
  for (const day of [today, analyticsDayBefore(today)]) {
    const scan = await scanDay(store, day, promoDaily(env), now)
    for (const s of scan.slots) {
      if (s.state !== 'free' || s.slot.reaped || s.slot.state === 'used') continue
      const claimed = await casJson<SlotRecord>(store, slotPath(day, s.n, s.g), (cur) => (cur && !cur.reaped ? { ...cur, reaped: true } : null))
      if (!claimed) continue
      const rec = await readJson<HoldRecord>(store, holdPath(day, s.slot.email_hash))
      if (!rec || rec.id !== s.slot.hold) continue
      if (rec.shopify_customer && d.shopify) await d.shopify.removeEligible(rec.shopify_customer).catch(() => d.log?.(`[ichirei-promo] ${JSON.stringify({ event: 'remove_eligible_failed' })}`))
      await casJson<HoldRecord>(store, holdPath(day, rec.email_hash), (cur) => (cur && cur.id === rec.id && cur.status !== 'used' ? { ...cur, status: 'expired' } : null))
      await recordCustomerEvent(store, { email: rec.email, browser: rec.browsers[0] ?? null }, 'hold_expired', {}, now)
      void recordHealth(store, 'hold_expired', {}, now)
      n++
    }
  }
  if (n) cache.delete(today)
  return n
}

/** The held cart of this browser (or email): the hold and the code for the cart, or null — then the cart carries NO code. */
export async function holdForCart(d: PromoDeps, who: { browser?: string | null; email?: string | null }): Promise<{ rec: HoldRecord; view: HoldView; code: string } | null> {
  const env = d.env ?? process.env
  const now = d.now?.() ?? new Date()
  if (!d.store || !promoOn(env, now)) return null
  const cfg = promoConfig(env)
  if (!cfg) return null
  const h = (who.email ? await holdOfEmail(d.store, who.email, now) : null) ?? (await holdOfBrowser(d.store, who.browser ?? null, now))
  if (!h || (h.view.state !== 'active' && h.view.state !== 'checkout')) return null
  return { ...h, code: cfg.cartCode }
}

/** For tests and /ops: the day key a moment belongs to, in the form the paths use. */
export const dayKeyOf = (now: Date): string => promoDayKey(now)
void analyticsDay
