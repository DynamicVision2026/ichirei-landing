// The customer record (customer-loop ticket, 2026-11-15, part 2). One small object per customer in the order store: `customers/<id>.json`.
//
//   <id>   E + the first 32 hex of sha256(lowercased, trimmed email) once an email is known; before that V… = the browser's id (the ic_v cookie, engine/visitor.ts).
//   merge  when an email first appears for a browser, the browser's record is merged into the email's record and a pointer `customers/ptr/<browser id>.json` is kept.
//
// What it holds: the emails and browser ids seen, first / last seen, the language, the marketing consent (and its time), the basket token, and a timeline of EVENTS — a code and a time (and, for an
// order, Shopify's order name, our order ref and the amount). NEVER the moment's text, a name or an address: the story lives in the preview and the order records only.
//
// Shared by every Cloud Run instance: each write is a read-modify-write with a precondition (OrderStore.casObject → Cloud Storage ifGenerationMatch), so two instances never overwrite each other.
// Retention: a record WITHOUT an order is deleted 30 days after its last event, with its basket items and holds; a record with an order is kept with the order (sweepCustomers, run from the daily trigger).

import { createHash } from 'node:crypto'
import { analyticsDay } from './analytics.ts'
import type { OrderStore } from './order-store.ts'

export const EVENT_CODES = [
  'visited', 'tried', 'previewed', 'saved',
  'held', 'hold_expired', 'hold_used',
  'ordered_free', 'ordered_paid',
  'collected', 'sent', 'opened', 'answered',
  'cancelled', 'refunded',
] as const
export type EventCode = (typeof EVENT_CODES)[number]

export interface CustomerEvent {
  code: EventCode
  at: string
  /** Shopify's order name (#1018) — orders only. */
  order?: string
  /** Our order reference — orders only. */
  ref?: string
  /** The amount paid, in the shop's whole yen — orders only. */
  amount?: number
}

export interface CustomerRecord {
  schema: 'customer'
  id: string
  emails: string[]
  browsers: string[]
  first_seen: string
  last_seen: string
  language: string | null
  consent: { marketing: boolean; at: string | null }
  /** The public free-gift code the customer came with (en promotion), if any. */
  from_code: string | null
  /** The private basket token (/b/<token>), once a basket exists. */
  basket_token: string | null
  /** The ids of the saved gifts (basket/<id>.json). */
  basket: string[]
  /** The browsers that may see the basket: the ones that saved into it or opened its private link. An email never opens a basket, so a browser that only gave the same email is not here. */
  basket_browsers?: string[]
  /** True once an order exists: the record is then kept with the order. */
  has_order: boolean
  events: CustomerEvent[]
}

export const MAX_EVENTS = 200
export const RETENTION_DAYS = 30
const DAY_MS = 86_400_000

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()
export const validEmail = (email: unknown): email is string => typeof email === 'string' && email.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email.trim())
export const emailHash = (email: string): string => createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 32)
export const emailCustomerId = (email: string): string => `E${emailHash(email)}`

const path = (id: string): string => `customers/${id}.json`
const ptrPath = (browser: string): string => `customers/ptr/${browser}.json`
const orderPath = (name: string): string => `customers/byorder/${name.replace(/\D/g, '').slice(0, 8)}.json`

const blank = (id: string, now: Date): CustomerRecord => ({
  schema: 'customer', id, emails: [], browsers: [], first_seen: now.toISOString(), last_seen: now.toISOString(), language: null,
  consent: { marketing: false, at: null }, from_code: null, basket_token: null, basket: [], has_order: false, events: [],
})

const parse = (buf: Buffer | null): CustomerRecord | null => {
  if (!buf) return null
  try {
    const j = JSON.parse(buf.toString('utf8')) as CustomerRecord
    return j && j.schema === 'customer' && typeof j.id === 'string' ? j : null
  } catch {
    return null
  }
}

/** Read-modify-write with the store's precondition; falls back to a plain write for a store that has none (a test stub). */
export async function casJson<T>(store: OrderStore, p: string, mutate: (cur: T | null) => T | null): Promise<T | null> {
  const run = (cur: Buffer | null): Buffer | string | null => {
    let obj: T | null = null
    if (cur) {
      try {
        obj = JSON.parse(cur.toString('utf8')) as T
      } catch {
        obj = null
      }
    }
    const next = mutate(obj)
    return next === null ? null : JSON.stringify(next)
  }
  if (store.casObject) {
    const out = await store.casObject(p, run, 'application/json')
    return out ? (JSON.parse(out.toString('utf8')) as T) : null
  }
  const cur = await store.getObject(p)
  const next = run(cur)
  if (next === null) return cur ? (JSON.parse(cur.toString('utf8')) as T) : null
  await store.putObject(p, next, 'application/json')
  return JSON.parse(String(next)) as T
}

/** The id a browser's record lives under: its email record when it has been merged, else its own. */
export async function customerIdOf(store: OrderStore, browser: string): Promise<string> {
  try {
    const raw = await store.getObject(ptrPath(browser))
    const j = raw ? (JSON.parse(raw.toString('utf8')) as { id?: string }) : null
    if (j?.id && /^[EV][A-Za-z0-9_-]{22,64}$/.test(j.id)) return j.id
  } catch {
    // no pointer: the browser's own record
  }
  return browser
}

export async function readCustomer(store: OrderStore, id: string): Promise<CustomerRecord | null> {
  return parse(await store.getObject(path(id)))
}

/** The creation of a record is listed once in `ops/customers-<day>.jsonl` (an id only) so the 30-day clean-up can find it. */
async function listNew(store: OrderStore, id: string, now: Date): Promise<void> {
  await store.appendJsonl(`ops/customers-${analyticsDay(now)}.jsonl`, { id, at: now.toISOString() }).catch(() => {})
}

export interface Who {
  /** The browser's id (ic_v) — may be null for a request with no cookie. */
  browser?: string | null
  email?: string | null
}

export interface EventExtra {
  order?: string
  ref?: string
  amount?: number
  language?: string | null
  code?: string | null
}

/** Add an event to the customer (found by email, else by browser). Creates the record on first sight. Returns the record's id. */
export async function recordCustomerEvent(store: OrderStore | null, who: Who, code: EventCode, extra: EventExtra = {}, now: Date = new Date()): Promise<string | null> {
  if (!store) return null
  const email = who.email && validEmail(who.email) ? normalizeEmail(who.email) : null
  const browser = who.browser && /^V[A-Za-z0-9_-]{22}$/.test(who.browser) ? who.browser : null
  if (!email && !browser) return null
  if (email && browser) await linkEmail(store, browser, email, now)
  const id = email ? emailCustomerId(email) : await customerIdOf(store, browser as string)
  let created = false
  await casJson<CustomerRecord>(store, path(id), (cur) => {
    const rec: CustomerRecord = cur ?? blank(id, now)
    if (!cur) created = true
    if (email && !rec.emails.includes(email)) rec.emails.push(email)
    if (browser && !rec.browsers.includes(browser)) rec.browsers.push(browser)
    rec.last_seen = now.toISOString()
    if (extra.language) rec.language = extra.language
    if (extra.code && !rec.from_code) rec.from_code = extra.code
    // a `visited` is one line a day, not one per page
    const last = rec.events[rec.events.length - 1]
    if (!(code === 'visited' && last?.code === 'visited' && last.at.slice(0, 10) === now.toISOString().slice(0, 10))) {
      const ev: CustomerEvent = { code, at: now.toISOString() }
      if (extra.order) ev.order = extra.order
      if (extra.ref) ev.ref = extra.ref
      if (typeof extra.amount === 'number') ev.amount = extra.amount
      rec.events.push(ev)
      if (rec.events.length > MAX_EVENTS) rec.events.splice(0, rec.events.length - MAX_EVENTS)
    }
    if (code === 'ordered_free' || code === 'ordered_paid') rec.has_order = true
    return rec
  })
  if (created) await listNew(store, id, now)
  if (extra.order && (code === 'ordered_free' || code === 'ordered_paid')) {
    await store.putObject(orderPath(extra.order), JSON.stringify({ id }), 'application/json').catch(() => {})
  }
  return id
}

/**
 * The first time an email is seen for a browser: merge the browser's record into the email's record and keep a pointer from the browser id. Nothing is lost: events, emails, browsers, consent,
 * the basket (its token and its items) all move to the email record. Idempotent.
 */
export async function linkEmail(store: OrderStore, browser: string, email: string, now: Date = new Date()): Promise<string> {
  const eid = emailCustomerId(email)
  const current = await customerIdOf(store, browser)
  if (current === eid) return eid
  const from = parse(await store.getObject(path(current)))
  let created = false
  await casJson<CustomerRecord>(store, path(eid), (cur) => {
    const rec: CustomerRecord = cur ?? blank(eid, from?.first_seen ? new Date(from.first_seen) : now)
    if (!cur) created = true
    const e = normalizeEmail(email)
    if (!rec.emails.includes(e)) rec.emails.push(e)
    for (const b of [browser, ...(from?.browsers ?? [])]) if (!rec.browsers.includes(b)) rec.browsers.push(b)
    if (from) {
      for (const m of from.emails) if (!rec.emails.includes(m)) rec.emails.push(m)
      if (Date.parse(from.first_seen) < Date.parse(rec.first_seen)) rec.first_seen = from.first_seen
      rec.language = rec.language ?? from.language
      rec.from_code = rec.from_code ?? from.from_code
      if (from.consent.marketing && !rec.consent.marketing) rec.consent = from.consent
      rec.basket_token = rec.basket_token ?? from.basket_token
      for (const item of from.basket) if (!rec.basket.includes(item)) rec.basket.push(item)
      rec.basket_browsers = [...new Set([...(rec.basket_browsers ?? []), ...(from.basket_browsers ?? [])])]
      rec.has_order = rec.has_order || from.has_order
      rec.events = [...rec.events, ...from.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-MAX_EVENTS)
    }
    rec.last_seen = now.toISOString()
    return rec
  })
  if (created) await listNew(store, eid, now)
  // a basket token that pointed at the browser record now points at the email record
  if (from?.basket_token) await casJson<{ customer: string }>(store, `basket/tok/${from.basket_token}.json`, () => ({ customer: eid })).catch(() => {})
  await store.putObject(ptrPath(browser), JSON.stringify({ id: eid }), 'application/json')
  if (from && current !== eid && current === browser) await store.deleteObject?.(path(current)).catch(() => {})
  return eid
}

/** The marketing consent (a ticked box), with its time. */
export async function saveConsent(store: OrderStore | null, who: Who, marketing: boolean, now: Date = new Date()): Promise<void> {
  if (!store || !marketing) return
  const email = who.email && validEmail(who.email) ? normalizeEmail(who.email) : null
  const browser = who.browser ?? null
  if (!email && !browser) return
  if (email && browser) await linkEmail(store, browser, email, now)
  const id = email ? emailCustomerId(email) : await customerIdOf(store, browser as string)
  await casJson<CustomerRecord>(store, path(id), (cur) => {
    const rec = cur ?? blank(id, now)
    rec.consent = { marketing: true, at: now.toISOString() }
    return rec
  })
}

/** The customer a Shopify order name points to (the /ops page searches by it). */
export async function customerOfOrder(store: OrderStore, orderName: string): Promise<string | null> {
  try {
    const raw = await store.getObject(orderPath(orderName))
    const j = raw ? (JSON.parse(raw.toString('utf8')) as { id?: string }) : null
    return j?.id ?? null
  } catch {
    return null
  }
}

// ---- the 30-day clean-up -------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface SweepResult {
  checked: number
  deleted: number
}

/**
 * A record with NO order is deleted 30 days after its last event — together with its basket items, its basket token, its pointers and the holds of its emails. A record with an order is kept.
 * The candidates come from the daily `ops/customers-<day>.jsonl` lists (the last 45 days).
 */
export async function sweepCustomers(store: OrderStore | null, now: Date = new Date(), hooks: { onDelete?: (rec: CustomerRecord) => Promise<void> } = {}): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, deleted: 0 }
  if (!store || !store.deleteObject) return out
  const ids = new Set<string>()
  for (let i = 0; i <= RETENTION_DAYS + 15; i++) {
    const day = analyticsDay(new Date(now.getTime() - i * DAY_MS))
    const raw = await store.getObject(`ops/customers-${day}.jsonl`).catch(() => null)
    for (const line of (raw?.toString('utf8') ?? '').split('\n')) {
      if (!line.trim()) continue
      try {
        const j = JSON.parse(line) as { id?: string }
        if (j.id && /^[EV][A-Za-z0-9_-]{22,64}$/.test(j.id)) ids.add(j.id)
      } catch {
        // a broken line is skipped
      }
    }
  }
  for (const id of ids) {
    const rec = await readCustomer(store, id).catch(() => null)
    if (!rec) continue
    out.checked++
    if (rec.has_order) continue
    if (now.getTime() - Date.parse(rec.last_seen) < RETENTION_DAYS * DAY_MS) continue
    for (const item of rec.basket) await store.deleteObject(`basket/${item}.json`).catch(() => {})
    if (rec.basket_token) await store.deleteObject(`basket/tok/${rec.basket_token}.json`).catch(() => {})
    for (const b of rec.browsers) await store.deleteObject(ptrPath(b)).catch(() => {})
    await hooks.onDelete?.(rec).catch(() => {})
    await store.deleteObject(path(id))
    out.deleted++
  }
  return out
}

/** A step of an order's life (collected, sent, opened, answered …) goes on the timeline of the customer who made it: found by the order's saved email, else by its browser. Best effort. */
export async function recordOrderEvent(store: OrderStore | null, orderRef: string | null | undefined, code: EventCode, now: Date = new Date()): Promise<void> {
  if (!store || !orderRef) return
  try {
    const o = (await store.get(orderRef)) as { buyer_email?: string | null; visitor?: string | null; shopify_order_name?: string | null } | null
    if (!o) return
    await recordCustomerEvent(store, { email: o.buyer_email ?? null, browser: o.visitor ?? null }, code, { ref: orderRef, ...(o.shopify_order_name ? { order: o.shopify_order_name } : {}) }, now)
  } catch {
    // the timeline is never a reason to fail a customer's action
  }
}
