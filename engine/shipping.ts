// The shipping address of a Shopify order, for the workshop CSV (/ops): "send to me" and "send directly" orders are paid and addressed at the Shopify checkout,
// so the address lives only there. It is read through the existing read-only app "ICHIREI Tracking" (scope read_orders — no write of any kind, no new scope, no
// Shopify setting changed) and handed straight to the CSV: never stored, never logged, never shown on a page. Orders are matched by the order_ref the cart carries
// (cart attribute order_ref, repeated on the line).
//
// Shopify may refuse the address fields until the app is approved for "protected customer data" (name, address, phone). That is reported as
// `protected_customer_data`, never worked around.

import { AdminTokenCache, TrackUnavailable, type TrackDeps } from './track.ts'

export interface ShippingAddress {
  name: string
  phone: string
  country: string
  postal: string
  region: string
  address: string
}

export type ShippingFailure = 'protected_customer_data' | 'not_configured' | 'unavailable'

export interface ShippingResult {
  found: Map<string, ShippingAddress>
  /** null = Shopify answered; the refs missing from `found` are simply orders it does not have in the window. */
  failure: ShippingFailure | null
}

interface Attr {
  key?: string | null
  value?: string | null
}
interface AdminAddress {
  name?: string | null
  phone?: string | null
  address1?: string | null
  address2?: string | null
  city?: string | null
  province?: string | null
  zip?: string | null
  countryCodeV2?: string | null
}
interface AdminOrderAddr {
  cancelledAt?: string | null
  customAttributes?: Attr[] | null
  lineItems?: { nodes?: { customAttributes?: Attr[] | null }[] } | null
  shippingAddress?: AdminAddress | null
}

const ADDRESS_QUERY = `query ShipTo($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      cancelledAt
      customAttributes { key value }
      lineItems(first: 5) { nodes { customAttributes { key value } } }
      shippingAddress { name phone address1 address2 city province zip countryCodeV2 }
    }
  }
}`

/** Payment only — no customer data at all, so it works with read_orders alone (no protected-customer-data approval). */
const PAYMENT_QUERY = `query Paid($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      cancelledAt
      displayFinancialStatus
      customAttributes { key value }
      currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      lineItems(first: 5) { nodes { customAttributes { key value } } }
      transactions(first: 10) { kind status processedAt }
    }
  }
}`

const DENIED = /protected customer data|not approved|access denied|ACCESS_DENIED|not have access/i
const MAX_PAGES = 5

const refOf = (o: { customAttributes?: Attr[] | null; lineItems?: { nodes?: { customAttributes?: Attr[] | null }[] } | null }): string | null => {
  for (const a of [...(o.customAttributes ?? []), ...(o.lineItems?.nodes ?? []).flatMap((n) => n.customAttributes ?? [])]) if ((a?.key === '_order_ref' || a?.key === 'order_ref') && a.value) return a.value
  return null
}

const clean = (a: AdminAddress): ShippingAddress => ({
  name: (a.name ?? '').trim(),
  phone: (a.phone ?? '').trim(),
  country: (a.countryCodeV2 ?? '').trim(),
  postal: (a.zip ?? '').trim(),
  region: (a.province ?? '').trim(),
  address: [a.city, a.address1, a.address2].map((x) => (x ?? '').trim()).filter(Boolean).join(' '),
})

/** Order refs look like IC-YYYYMMDD-XXXXXXXX: the day is the day the cart was made, so Shopify only needs to be asked about orders since then. */
const dayOfRef = (ref: string): string | null => {
  const m = /^IC-(\d{4})(\d{2})(\d{2})-/.exec(ref)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

interface Page<T> {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
  nodes?: T[]
}

/** The orders of the Shopify store since the day of the oldest ref, matched to our refs; `pick` turns one Shopify order into what the caller wants (null = skip it). */
async function scan<N extends { customAttributes?: Attr[] | null; lineItems?: { nodes?: { customAttributes?: Attr[] | null }[] } | null }, T>(
  refs: string[],
  d: TrackDeps | null,
  tokens: AdminTokenCache,
  query: string,
  pick: (o: N) => T | null,
): Promise<{ found: Map<string, T>; failure: ShippingFailure | null }> {
  const found = new Map<string, T>()
  if (!refs.length) return { found, failure: null }
  if (!d) return { found, failure: 'not_configured' }
  const days = refs.map(dayOfRef).filter((x): x is string => !!x).sort()
  if (!days.length) return { found, failure: null }
  const since = new Date(Date.parse(`${days[0]}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const wanted = new Set(refs)
  const doFetch = d.fetchImpl ?? fetch
  try {
    let after: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const call = async (token: string) =>
        doFetch(`${d.config.apiBase}/admin/api/${d.config.apiVersion}/graphql.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
          body: JSON.stringify({ query, variables: { q: `created_at:>=${since}`, after } }),
          signal: AbortSignal.timeout(20_000),
        })
      let res = await call(await tokens.get(d))
      if (res.status === 401) {
        tokens.clear()
        res = await call(await tokens.get(d))
      }
      if (res.status === 403) return { found, failure: 'protected_customer_data' }
      if (!res.ok) throw new TrackUnavailable(`Shopify Admin API HTTP ${res.status}`)
      const json = (await res.json()) as { data?: { orders?: Page<N> }; errors?: { message?: string; extensions?: { code?: string } }[] }
      if (json.errors?.length) {
        const text = json.errors.map((e) => `${e.extensions?.code ?? ''} ${e.message ?? ''}`).join('; ')
        if (DENIED.test(text)) return { found, failure: 'protected_customer_data' }
        throw new TrackUnavailable(`Shopify Admin API: ${text}`)
      }
      const orders = json.data?.orders
      if (!orders?.nodes) throw new TrackUnavailable('Shopify Admin API returned no orders field')
      for (const o of orders.nodes) {
        const ref = refOf(o)
        if (!ref || !wanted.has(ref) || found.has(ref)) continue
        const got = pick(o)
        if (got !== null) found.set(ref, got)
      }
      if (found.size >= wanted.size || !orders.pageInfo?.hasNextPage || !orders.pageInfo.endCursor) break
      after = orders.pageInfo.endCursor
    }
    return { found, failure: null }
  } catch (err) {
    // the reason goes to the log; no address is ever in it
    console.error('[ichirei-ops] Shopify orders unavailable:', err instanceof Error ? err.message : err)
    return { found, failure: 'unavailable' }
  }
}

export async function readShippingAddresses(refs: string[], d: TrackDeps | null, tokens: AdminTokenCache): Promise<ShippingResult> {
  return scan<AdminOrderAddr, ShippingAddress>(refs, d, tokens, ADDRESS_QUERY, (o) => (o.cancelledAt || !o.shippingAddress ? null : clean(o.shippingAddress)))
}

// ---- payment: when was it paid, and is the order still alive ---------------------------------------------------------------------------------------------------

/** What Shopify says about one order: paid (and when), cancelled, refunded. No customer data. */
export interface PaymentInfo {
  state: 'paid' | 'unpaid' | 'cancelled' | 'refunded'
  /** When the payment went through (the 24-hour change window starts here). null while unpaid. */
  paid_at: string | null
  /** What the order actually cost (the order's total after discounts, whole yen; null when Shopify did not say or the currency is not JPY). The dashboard's revenue uses this, never the package price. */
  amount_jpy?: number | null
  /** An order paid in another currency (a US buyer: USD 17.50): what the buyer paid, shown beside the yen amount; never added up. */
  amount_buyer?: { amount: string; currency: string } | null
}
export interface PaymentResult {
  found: Map<string, PaymentInfo>
  failure: ShippingFailure | null
}

interface AdminOrderPay {
  createdAt?: string | null
  cancelledAt?: string | null
  displayFinancialStatus?: string | null
  customAttributes?: Attr[] | null
  lineItems?: { nodes?: { customAttributes?: Attr[] | null }[] } | null
  transactions?: { kind?: string | null; status?: string | null; processedAt?: string | null }[] | null
  currentTotalPriceSet?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null; presentmentMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null
}

const PAID_STATES = new Set(['PAID', 'PARTIALLY_PAID', 'AUTHORIZED', 'PARTIALLY_REFUNDED'])

/** The moment of payment: the first successful sale / capture (else authorization) transaction, else the order's own time when it is marked paid. */
export function paymentOf(o: AdminOrderPay): PaymentInfo {
  const status = (o.displayFinancialStatus ?? '').toUpperCase()
  if (o.cancelledAt) return { state: 'cancelled', paid_at: null }
  if (status === 'REFUNDED' || status === 'VOIDED' || status === 'EXPIRED') return { state: 'refunded', paid_at: null }
  if (!PAID_STATES.has(status)) return { state: 'unpaid', paid_at: null }
  const ok = (o.transactions ?? []).filter((t) => (t.status ?? '').toUpperCase() === 'SUCCESS' && t.processedAt)
  const pick = (kinds: string[]) => ok.filter((t) => kinds.includes((t.kind ?? '').toUpperCase())).map((t) => t.processedAt as string).sort()[0]
  const money = o.currentTotalPriceSet?.shopMoney
  const amount = money?.amount !== undefined && money.amount !== null && (!money.currencyCode || money.currencyCode.toUpperCase() === 'JPY') && Number.isFinite(Number(money.amount)) ? Math.round(Number(money.amount)) : null
  // the buyer's own-currency amount (USD for an English order): shown beside the yen amount, never summed. The yen amount above is always the SHOP's money.
  const pres = o.currentTotalPriceSet?.presentmentMoney
  const buyer = pres?.amount && pres.currencyCode && pres.currencyCode.toUpperCase() !== (money?.currencyCode ?? 'JPY').toUpperCase() ? { amount: pres.amount, currency: pres.currencyCode.toUpperCase() } : null
  return { state: 'paid', paid_at: pick(['SALE', 'CAPTURE']) ?? pick(['AUTHORIZATION']) ?? o.createdAt ?? null, amount_jpy: amount, ...(buyer ? { amount_buyer: buyer } : {}) }
}

export async function readPayments(refs: string[], d: TrackDeps | null, tokens: AdminTokenCache): Promise<PaymentResult> {
  return scan<AdminOrderPay, PaymentInfo>(refs, d, tokens, PAYMENT_QUERY, (o) => paymentOf(o))
}

/** The wording of the CSV's address_source cell. */
export const SHIPPING_SOURCE = {
  read: 'Shopify checkout address',
  notFound: 'Shopify checkout address: order not found (read_orders sees 60 days) — look it up in Shopify',
  protected_customer_data: 'Shopify refused the address: the Tracking app needs protected customer data access (name, address, phone) — look it up in Shopify',
  not_configured: 'Shopify address lookup is not configured — look it up in Shopify',
  unavailable: 'Shopify could not be asked just now — look it up in Shopify',
} as const
