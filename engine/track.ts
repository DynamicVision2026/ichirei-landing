// Order status lookup for /track — READ-ONLY, ICHIREI orders only.
//
// The "ICHIREI Tracking" Dev Dashboard app (scope read_orders only) is the only credential used
// here. We get an Admin API token with the client-credentials grant, run ONE read query for the
// order the customer named, and answer only if (a) the email matches and (b) the order contains
// an ICHIREI SKU. Everything else — wrong number, wrong email, someone else's product — is the
// same "not found". No database: the status is derived from Shopify's own data.
//
// What leaves this module is deliberately small: order date, status, ICHIREI SKUs, carrier,
// tracking number and tracking URL, plus an estimated-arrival date derived from the shipping
// country (the country itself is never returned). Never a name, an address or an email.
//
// Env: SHOPIFY_ADMIN_CLIENT_ID, the client secret (SHOPIFY_ADMIN_CLIENT_SECRET, or read from
// Secret Manager — see readAdminSecret), SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION,
// SHOPIFY_ADMIN_API_BASE (tests only).

import { DEFAULT_API_VERSION, DEFAULT_STORE_DOMAIN } from './shopify.ts'

/** Only orders with a line item whose SKU contains this are ever answered. */
export const SKU_MARK = 'ICHIREI'
export const ADMIN_SECRET_NAME = 'SHOPIFY_ADMIN_CLIENT_SECRET'

export type TrackStatus = 'payment_pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

export interface TrackAnswer {
  /** The order date in Japan time, YYYY-MM-DD. */
  ordered_on: string
  status: TrackStatus
  /** Only the SKUs that contain ICHIREI (other products in the same order are not shown). */
  sku: string[]
  carrier: string | null
  tracking_number: string | null
  tracking_url: string | null
  /** "By around" date, YYYY-MM-DD (Japan: 10 business days; elsewhere: 1 month). null once delivered or cancelled. */
  estimated_by: string | null
}

// ---- pure helpers (tested directly) ------------------------------------------------------------

/** "#1016", "1016", " ＃１０１６ " → "1016"; null when it is not a plausible order number. */
export function normalizeOrderNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.normalize('NFKC').trim().replace(/^#/, '').trim()
  return /^\d{1,9}$/.test(s) ? s : null
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.normalize('NFKC').trim().toLowerCase()
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const fromYmd = (s: string) => new Date(`${s}T00:00:00Z`)

/** The calendar date in Japan (UTC+9) of an ISO timestamp. */
export function jstDate(iso: string): string {
  return ymd(new Date(new Date(iso).getTime() + 9 * 3_600_000))
}

/** `n` business days after `start` (YYYY-MM-DD), skipping Saturdays and Sundays (no holiday calendar). */
export function addBusinessDays(start: string, n: number): string {
  const d = fromYmd(start)
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) left--
  }
  return ymd(d)
}

/** The same day next month; a day that does not exist there (31st → 30th/28th) falls back to the month's last day. */
export function addOneMonth(start: string): string {
  const d = fromYmd(start)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return ymd(d)
}

/** Japan: within 10 business days of the order date. Everywhere else: within 1 month. */
export function estimateArrival(orderedOn: string, countryCode: string | null): string {
  return countryCode === 'JP' ? addBusinessDays(orderedOn, 10) : addOneMonth(orderedOn)
}

const isIchirei = (sku: unknown) => typeof sku === 'string' && sku.toUpperCase().includes(SKU_MARK)

/** Only http(s) links are passed on to the browser. */
const safeUrl = (u: unknown): string | null => {
  if (typeof u !== 'string') return null
  try {
    const p = new URL(u)
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null
  } catch {
    return null
  }
}

/** The slice of the Admin API order that the status is derived from. */
export interface AdminOrder {
  name?: string | null
  createdAt: string
  email?: string | null
  cancelledAt?: string | null
  displayFinancialStatus?: string | null
  displayFulfillmentStatus?: string | null
  shippingAddress?: { countryCodeV2?: string | null } | null
  lineItems?: { nodes?: { sku?: string | null }[] } | null
  fulfillments?:
    | {
        displayStatus?: string | null
        trackingInfo?: { company?: string | null; number?: string | null; url?: string | null }[] | null
        fulfillmentLineItems?: { nodes?: { lineItem?: { sku?: string | null } | null }[] } | null
      }[]
    | null
}

/** Derive the answer; null when the order has no ICHIREI SKU (→ "not found"). */
export function answerFor(order: AdminOrder): TrackAnswer | null {
  const sku = [...new Set((order.lineItems?.nodes ?? []).map((n) => n.sku).filter(isIchirei) as string[])]
  if (sku.length === 0) return null

  const orderedOn = jstDate(order.createdAt)
  const fin = (order.displayFinancialStatus ?? '').toUpperCase()
  const cancelled = Boolean(order.cancelledAt) || fin === 'REFUNDED' || fin === 'VOIDED'

  // Fulfilments that carry an ICHIREI item and were not cancelled or failed.
  const live = (order.fulfillments ?? []).filter((f) => {
    const st = (f.displayStatus ?? '').toUpperCase()
    if (st === 'CANCELED' || st === 'CANCELLED' || st === 'FAILURE') return false
    const items = f.fulfillmentLineItems?.nodes
    return !items || items.some((i) => isIchirei(i.lineItem?.sku))
  })
  const delivered = live.some((f) => (f.displayStatus ?? '').toUpperCase() === 'DELIVERED')
  const tracking = live.flatMap((f) => f.trackingInfo ?? []).find((t) => t.number || t.url) ?? null

  let status: TrackStatus
  if (cancelled) status = 'cancelled'
  else if (delivered) status = 'delivered'
  else if (live.length > 0 || (order.displayFulfillmentStatus ?? '').toUpperCase() === 'FULFILLED') status = 'shipped'
  else if (['PENDING', 'EXPIRED', 'AUTHORIZED_PENDING'].includes(fin)) status = 'payment_pending'
  else status = 'processing'

  const showTracking = status === 'shipped' || status === 'delivered'
  return {
    ordered_on: orderedOn,
    status,
    sku,
    carrier: showTracking ? (tracking?.company?.trim() || null) : null,
    tracking_number: showTracking ? (tracking?.number?.trim() || null) : null,
    tracking_url: showTracking ? safeUrl(tracking?.url) : null,
    estimated_by: status === 'delivered' || status === 'cancelled' ? null : estimateArrival(orderedOn, order.shippingAddress?.countryCodeV2 ?? null),
  }
}

// ---- Shopify Admin access ----------------------------------------------------------------------

export interface TrackConfig {
  storeDomain: string
  apiVersion: string
  clientId: string
  /** Where the Admin API is reached (https://<domain>; tests point it at a local fake). */
  apiBase: string
}

export function loadTrackConfig(env: NodeJS.ProcessEnv = process.env): { config: TrackConfig | null; missing: string[] } {
  const clientId = env.SHOPIFY_ADMIN_CLIENT_ID?.trim() ?? ''
  if (!clientId) return { config: null, missing: ['SHOPIFY_ADMIN_CLIENT_ID'] }
  const storeDomain = (env.SHOPIFY_STORE_DOMAIN || DEFAULT_STORE_DOMAIN).trim()
  return {
    missing: [],
    config: {
      storeDomain,
      apiVersion: (env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
      clientId,
      apiBase: (env.SHOPIFY_ADMIN_API_BASE || `https://${storeDomain}`).replace(/\/$/, ''),
    },
  }
}

export class TrackUnavailable extends Error {}

const METADATA = 'http://metadata.google.internal/computeMetadata/v1'

/**
 * The client secret. SHOPIFY_ADMIN_CLIENT_SECRET in the environment wins (local runs and tests);
 * otherwise it is read from Secret Manager (secret SHOPIFY_ADMIN_CLIENT_SECRET, latest version)
 * with the Cloud Run service account — so a secret that does not exist yet can never break a
 * deploy, it only makes /track answer "unavailable" until it is created and granted.
 */
export async function readAdminSecret(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const direct = env.SHOPIFY_ADMIN_CLIENT_SECRET?.trim()
  if (direct) return direct
  const meta = async (path: string) => {
    const r = await fetchImpl(`${METADATA}/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000) })
    if (!r.ok) throw new TrackUnavailable(`metadata server HTTP ${r.status}`)
    return r
  }
  const project = env.GOOGLE_CLOUD_PROJECT?.trim() || (await (await meta('project/project-id')).text()).trim()
  const { access_token } = (await (await meta('instance/service-accounts/default/token')).json()) as { access_token: string }
  const base = (env.SECRET_MANAGER_API_BASE || 'https://secretmanager.googleapis.com').replace(/\/$/, '')
  const res = await fetchImpl(`${base}/v1/projects/${encodeURIComponent(project)}/secrets/${ADMIN_SECRET_NAME}/versions/latest:access`, {
    headers: { authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new TrackUnavailable(`Secret Manager HTTP ${res.status} for ${ADMIN_SECRET_NAME}`)
  const data = ((await res.json()) as { payload?: { data?: string } }).payload?.data
  if (!data) throw new TrackUnavailable(`${ADMIN_SECRET_NAME} has no value`)
  return Buffer.from(data, 'base64').toString('utf8').trim()
}

const ORDER_QUERY = `query TrackOrder($q: String!) {
  orders(first: 5, query: $q) {
    nodes {
      name
      createdAt
      email
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      shippingAddress { countryCodeV2 }
      lineItems(first: 50) { nodes { sku } }
      fulfillments {
        displayStatus
        trackingInfo { company number url }
        fulfillmentLineItems(first: 50) { nodes { lineItem { sku } } }
      }
    }
  }
}`

export interface TrackDeps {
  config: TrackConfig
  /** Returns the client secret (cached by the caller's closure if wanted). */
  secret: () => Promise<string>
  fetchImpl?: typeof fetch
  now?: () => number
}

/** One client-credentials token, reused until shortly before it expires (Shopify issues ~24 h tokens). */
export class AdminTokenCache {
  private cached: { token: string; expiresAt: number } | null = null
  async get(d: TrackDeps): Promise<string> {
    const now = d.now?.() ?? Date.now()
    if (this.cached && this.cached.expiresAt > now + 300_000) return this.cached.token
    const doFetch = d.fetchImpl ?? fetch
    const res = await doFetch(`${d.config.apiBase}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: d.config.clientId, client_secret: await d.secret(), grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new TrackUnavailable(`Shopify token request failed: HTTP ${res.status}`)
    const j = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!j.access_token) throw new TrackUnavailable('Shopify token response had no access_token')
    this.cached = { token: j.access_token, expiresAt: now + (j.expires_in ?? 3600) * 1000 }
    return j.access_token
  }
  clear() {
    this.cached = null
  }
}

/**
 * Find the order and answer, or null for "not found" (no such order, wrong email, no email on the
 * order, or no ICHIREI SKU — all indistinguishable to the caller). Throws TrackUnavailable when
 * Shopify cannot be asked at all, which is a service problem and must not look like "not found".
 */
export async function lookupOrder(orderNumber: string, email: string, d: TrackDeps, tokens: AdminTokenCache): Promise<TrackAnswer | null> {
  const doFetch = d.fetchImpl ?? fetch
  const call = async (token: string) =>
    doFetch(`${d.config.apiBase}/admin/api/${d.config.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query: ORDER_QUERY, variables: { q: `name:#${orderNumber}` } }),
      signal: AbortSignal.timeout(15_000),
    })
  let res = await call(await tokens.get(d))
  if (res.status === 401) {
    // The token was revoked or expired early: get a fresh one once.
    tokens.clear()
    res = await call(await tokens.get(d))
  }
  if (!res.ok) throw new TrackUnavailable(`Shopify Admin API HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { orders?: { nodes?: AdminOrder[] } }; errors?: { message: string }[] }
  if (json.errors?.length) throw new TrackUnavailable(`Shopify Admin API: ${json.errors.map((e) => e.message).join('; ')}`)
  const nodes = json.data?.orders?.nodes
  if (!nodes) throw new TrackUnavailable('Shopify Admin API returned no orders field')
  // The search is fuzzy: take only the order whose number is exactly the one asked for.
  const order = nodes.find((o) => (o.name ?? '').replace(/\D/g, '') === orderNumber)
  if (!order) return null
  const onOrder = normalizeEmail(order.email ?? '')
  if (!onOrder || onOrder !== email) return null
  return answerFor(order)
}
