// "Waiting" orders (2026-11-13): someone paid for the ICHIREI product WITHOUT going through our site (a store page, a ChatGPT checkout). That order has no story and no
// character, so no gift can be made — yet. It is NOT an error: we keep a small record, the buyer's e-mail block in Shopify links them to /claim, and there they write their
// story and choose the character; the character is then attached to the EXISTING order (no second payment). After 7 days unclaimed the owner sees "refund due" and
// refunds by hand in Shopify (the app is read-only: nothing here ever writes to Shopify).
//
// How an order is recognised: a paid order with a line whose SKU contains "ICHIREI-" and which carries none of our hidden gift properties (today: the order reference
// `_order_ref`, also `order_ref` for orders made before 2026-11-05). Three ways in, one function (`waitingFromShopify`):
//   1. the Shopify "order payment" webhook  (POST /api/shopify/orders-paid, signed with the store's webhook secret)
//   2. /ops asking Shopify (read-only) for the last two weeks of orders
//   3. /claim asking Shopify (read-only) for the one order named, when we have no record of it yet
//
// Stored under `WO-<order number>` in the order store, plus one index line in `ops/waiting.jsonl` (codes and numbers; no story, no name).

import { createHash, timingSafeEqual } from 'node:crypto'
import { jstDate, normalizeEmail, normalizeOrderNumber } from './track.ts'
import type { OrderStore } from './order-store.ts'
import { readJsonl } from './egift-ops.ts'

export const WAITING_INDEX_PATH = 'ops/waiting.jsonl'
/** Days a waiting order may stay unclaimed before it is "refund due". */
export const WAITING_DAYS = 7
const DAY_MS = 86_400_000
/** A claim session (the permission to attach one character to the order) lasts this long. */
export const CLAIM_SESSION_MS = 24 * 3_600_000

export type WaitingLanguage = 'ja' | 'zh-Hant' | 'zh-Hans' | 'en'

export interface WaitingOrder {
  schema: 'waiting_order'
  /** WO-<number> */
  id: string
  /** "#1016" */
  order_name: string
  /** "1016" */
  order_number: string
  /** When Shopify took the payment (ISO). */
  paid_at: string
  /** The buyer's e-mail as Shopify holds it (lower case). Used only to check /claim. */
  email: string
  /** From the order's locale; the language /claim opens in. */
  language: WaitingLanguage
  /** What the buyer actually paid (JPY, whole yen) — the dashboard counts this, never the package price. null when Shopify did not say. */
  amount_jpy: number | null
  source: 'webhook' | 'ops_sweep' | 'claim_lookup'
  status: 'waiting' | 'claimed'
  recorded_at: string
  /** The permission given to the person who passed the /claim check: only a hash of the token is kept. */
  session?: { token_hash: string; expires_at: string }
  claimed_at?: string
  /** The order record (OR-…) the claim produced. */
  order_ref?: string
}

export const waitingId = (orderNumber: string): string => `WO-${orderNumber}`

// ---- recognising the order ----------------------------------------------------------------------------------------------------------------------------------------

/** The order as the webhook (REST) or the read-only Admin API (GraphQL, flattened by `fromAdmin`) describes it — only the fields this module reads. */
export interface ShopifyOrderFacts {
  name?: string | null
  email?: string | null
  paid: boolean
  cancelled: boolean
  paidAt?: string | null
  createdAt?: string | null
  locale?: string | null
  amount?: number | string | null
  currency?: string | null
  /** one entry per line item */
  lines: { sku?: string | null; props: { key: string; value: string }[] }[]
  /** the order's own custom attributes (the cart's `order_ref` lands here too) */
  attrs: { key: string; value: string }[]
}

const isRef = (key: string) => key === '_order_ref' || key === 'order_ref'
const hasRef = (list: { key: string; value: string }[]) => list.some((a) => isRef(a.key) && typeof a.value === 'string' && a.value.trim() !== '')
const isIchireiSku = (sku: unknown) => typeof sku === 'string' && sku.toUpperCase().includes('ICHIREI-')

/** True when this paid order has an ICHIREI line with no gift attached. */
export function isWaiting(o: ShopifyOrderFacts): boolean {
  if (!o.paid || o.cancelled) return false
  if (hasRef(o.attrs)) return false
  return o.lines.some((l) => isIchireiSku(l.sku) && !hasRef(l.props))
}

/** The language of the buyer's checkout ("ja", "ja-JP", "zh-TW", "zh-CN", "en-US" …); anything else is English. */
export function languageOfLocale(locale: string | null | undefined): WaitingLanguage {
  const l = (locale ?? '').toLowerCase().replace('_', '-')
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('zh')) return /hans|cn|sg/.test(l) ? 'zh-Hans' : 'zh-Hant'
  return 'en'
}

const wholeYen = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/** The facts of a webhook body (Shopify's REST order JSON: name, email, financial_status, line_items[].properties[{name,value}], note_attributes, locale …). */
export function fromWebhook(body: unknown): ShopifyOrderFacts | null {
  const o = body as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const pairs = (v: unknown): { key: string; value: string }[] =>
    Array.isArray(v) ? v.filter((p): p is { name: string; value: unknown } => !!p && typeof (p as { name?: unknown }).name === 'string').map((p) => ({ key: p.name, value: typeof p.value === 'string' ? p.value : String(p.value ?? '') })) : []
  const status = String(o.financial_status ?? '').toLowerCase()
  const money = (o.current_total_price ?? o.total_price) as unknown
  return {
    name: typeof o.name === 'string' ? o.name : null,
    email: typeof o.email === 'string' ? o.email : typeof o.contact_email === 'string' ? o.contact_email : null,
    paid: ['paid', 'partially_paid', 'authorized', 'partially_refunded'].includes(status),
    cancelled: typeof o.cancelled_at === 'string' && o.cancelled_at !== '',
    paidAt: typeof o.processed_at === 'string' ? o.processed_at : null,
    createdAt: typeof o.created_at === 'string' ? o.created_at : null,
    locale: typeof o.customer_locale === 'string' ? o.customer_locale : typeof o.locale === 'string' ? o.locale : null,
    amount: typeof money === 'string' || typeof money === 'number' ? money : null,
    currency: typeof o.currency === 'string' ? o.currency : null,
    lines: Array.isArray(o.line_items) ? o.line_items.map((l) => ({ sku: typeof (l as { sku?: unknown }).sku === 'string' ? (l as { sku: string }).sku : null, props: pairs((l as { properties?: unknown }).properties) })) : [],
    attrs: pairs(o.note_attributes),
  }
}

/** The slice of an Admin API (GraphQL) order the sweep and the claim lookup ask for. */
export interface AdminWaitingOrder {
  name?: string | null
  email?: string | null
  createdAt?: string | null
  cancelledAt?: string | null
  displayFinancialStatus?: string | null
  customerLocale?: string | null
  currentTotalPriceSet?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null
  customAttributes?: { key: string; value?: string | null }[] | null
  lineItems?: { nodes?: { sku?: string | null; customAttributes?: { key: string; value?: string | null }[] | null }[] } | null
  transactions?: { kind?: string | null; status?: string | null; processedAt?: string | null }[] | null
}

export function fromAdmin(o: AdminWaitingOrder): ShopifyOrderFacts {
  const status = (o.displayFinancialStatus ?? '').toUpperCase()
  const ok = (o.transactions ?? []).filter((t) => (t.status ?? '').toUpperCase() === 'SUCCESS' && t.processedAt && ['SALE', 'CAPTURE', 'AUTHORIZATION'].includes((t.kind ?? '').toUpperCase()))
  const flat = (l?: { key: string; value?: string | null }[] | null) => (l ?? []).map((a) => ({ key: a.key, value: a.value ?? '' }))
  return {
    name: o.name ?? null,
    email: o.email ?? null,
    paid: ['PAID', 'PARTIALLY_PAID', 'AUTHORIZED', 'PARTIALLY_REFUNDED'].includes(status),
    cancelled: !!o.cancelledAt,
    paidAt: ok.map((t) => t.processedAt as string).sort()[0] ?? null,
    createdAt: o.createdAt ?? null,
    locale: o.customerLocale ?? null,
    amount: o.currentTotalPriceSet?.shopMoney?.amount ?? null,
    currency: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
    lines: (o.lineItems?.nodes ?? []).map((n) => ({ sku: n.sku ?? null, props: flat(n.customAttributes) })),
    attrs: flat(o.customAttributes),
  }
}

/** The waiting-order record for a Shopify order, or null when it is not one (not paid, cancelled, no ICHIREI line, a gift is attached, no usable number or e-mail). */
export function waitingFromShopify(o: ShopifyOrderFacts, source: WaitingOrder['source'], now: Date): WaitingOrder | null {
  if (!isWaiting(o)) return null
  const number = normalizeOrderNumber(String(o.name ?? ''))
  const email = normalizeEmail(o.email ?? '')
  if (!number || !email) return null
  const paid = o.paidAt || o.createdAt || now.toISOString()
  const paidMs = Date.parse(paid)
  return {
    schema: 'waiting_order',
    id: waitingId(number),
    order_name: `#${number}`,
    order_number: number,
    paid_at: Number.isFinite(paidMs) ? new Date(paidMs).toISOString() : now.toISOString(),
    email,
    language: languageOfLocale(o.locale),
    amount_jpy: !o.currency || o.currency.toUpperCase() === 'JPY' ? wholeYen(o.amount) : null,
    source,
    status: 'waiting',
    recorded_at: now.toISOString(),
  }
}

// ---- the store ------------------------------------------------------------------------------------------------------------------------------------------------------

export async function readWaiting(store: OrderStore, orderNumber: string): Promise<WaitingOrder | null> {
  const rec = (await store.get(waitingId(orderNumber)).catch(() => null)) as WaitingOrder | null
  return rec && rec.schema === 'waiting_order' ? rec : null
}

/** Keep the record (never overwrites one that already exists: a claimed order stays claimed, a recorded e-mail stays). Returns the record that is now stored. */
export async function recordWaiting(store: OrderStore, w: WaitingOrder): Promise<{ record: WaitingOrder; created: boolean }> {
  const had = await readWaiting(store, w.order_number)
  if (had) return { record: had, created: false }
  await store.put(w.id, w)
  await store.appendJsonl(WAITING_INDEX_PATH, { id: w.id, at: w.recorded_at }).catch((err) => console.error('[ichirei-waiting] index append failed', err instanceof Error ? err.message : err))
  console.log('[ichirei-waiting]', JSON.stringify({ event: 'waiting_recorded', order: w.order_name, source: w.source, language: w.language }))
  return { record: w, created: true }
}

export async function listWaiting(store: OrderStore): Promise<WaitingOrder[]> {
  const ids = [...new Set((await readJsonl<{ id?: string }>(store, WAITING_INDEX_PATH)).map((l) => l.id).filter((x): x is string => typeof x === 'string' && /^WO-\d{1,9}$/.test(x)))]
  const out: WaitingOrder[] = []
  for (const id of ids) {
    const rec = (await store.get(id).catch(() => null)) as WaitingOrder | null
    if (rec && rec.schema === 'waiting_order') out.push(rec)
  }
  return out.sort((a, b) => Date.parse(b.paid_at) - Date.parse(a.paid_at))
}

// ---- how long it has waited -----------------------------------------------------------------------------------------------------------------------------------------

export type WaitingState = { state: 'claimed' } | { state: 'waiting'; days_left: number } | { state: 'refund_due' }

/** Until day 7: 「未作成（あと◯日）」. From day 7 on (the day-8 view of the owner included): refund due. Claimed: done. */
export function waitingState(w: WaitingOrder, now: Date): WaitingState {
  if (w.status === 'claimed') return { state: 'claimed' }
  const left = Date.parse(w.paid_at) + WAITING_DAYS * DAY_MS - now.getTime()
  return left > 0 ? { state: 'waiting', days_left: Math.max(1, Math.ceil(left / DAY_MS)) } : { state: 'refund_due' }
}

// ---- /claim: the check ---------------------------------------------------------------------------------------------------------------------------------------------

const digest = (s: string) => createHash('sha256').update(s).digest()
/** Constant-time string comparison (both sides are hashed first, so length does not leak). */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

/** The record when BOTH the number and the e-mail match; every other case (no such order, wrong e-mail, already claimed) is the same answer: null. The compare is constant-time and is done even when there is no record. */
export function matchClaim(rec: WaitingOrder | null, orderNumber: string, email: string): WaitingOrder | null {
  const emailOk = sameSecret(rec?.email ?? '\u0000no-record', email)
  const numberOk = sameSecret(rec?.order_number ?? '\u0000no-record', orderNumber)
  return rec && emailOk && numberOk && rec.status === 'waiting' ? rec : null
}

export const newClaimToken = (): string => `CT-${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')}`
export const claimTokenHash = (token: string): string => digest(token).toString('hex')

/** Open a claim session on a matched record; returns the token to give the browser. */
export async function openClaimSession(store: OrderStore, rec: WaitingOrder, now: Date): Promise<string> {
  const token = newClaimToken()
  rec.session = { token_hash: claimTokenHash(token), expires_at: new Date(now.getTime() + CLAIM_SESSION_MS).toISOString() }
  await store.put(rec.id, rec)
  return token
}

/** The record when the number and the token are good (live session, still waiting); null otherwise. */
export async function checkClaimSession(store: OrderStore, orderNumber: string, token: string, now: Date): Promise<WaitingOrder | null> {
  const rec = await readWaiting(store, orderNumber)
  const ok = !!rec && rec.status === 'waiting' && !!rec.session && Date.parse(rec.session.expires_at) > now.getTime() && sameSecret(rec.session.token_hash, claimTokenHash(token))
  return ok ? rec : null
}

/** What the order record keeps of the claim: when it was claimed (the 24-hour clock starts here), when Shopify took the payment, and what was paid. No e-mail. */
export interface OrderClaim {
  order_name: string
  claimed_at: string
  paid_at: string
  amount_jpy: number | null
}

export const claimOf = (w: WaitingOrder, now: Date): OrderClaim => ({ order_name: w.order_name, claimed_at: now.toISOString(), paid_at: w.paid_at, amount_jpy: w.amount_jpy })

export { jstDate, normalizeEmail, normalizeOrderNumber }
