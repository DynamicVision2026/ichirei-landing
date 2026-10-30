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

const QUERY = `query ShipTo($q: String!, $after: String) {
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

const DENIED = /protected customer data|not approved|access denied|ACCESS_DENIED|not have access/i
const MAX_PAGES = 5

const refOf = (o: AdminOrderAddr): string | null => {
  for (const a of [...(o.customAttributes ?? []), ...(o.lineItems?.nodes ?? []).flatMap((n) => n.customAttributes ?? [])]) if (a?.key === 'order_ref' && a.value) return a.value
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

export async function readShippingAddresses(refs: string[], d: TrackDeps | null, tokens: AdminTokenCache): Promise<ShippingResult> {
  const found = new Map<string, ShippingAddress>()
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
          body: JSON.stringify({ query: QUERY, variables: { q: `created_at:>=${since}`, after } }),
          signal: AbortSignal.timeout(20_000),
        })
      let res = await call(await tokens.get(d))
      if (res.status === 401) {
        tokens.clear()
        res = await call(await tokens.get(d))
      }
      if (res.status === 403) return { found, failure: 'protected_customer_data' }
      if (!res.ok) throw new TrackUnavailable(`Shopify Admin API HTTP ${res.status}`)
      const json = (await res.json()) as { data?: { orders?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: AdminOrderAddr[] } }; errors?: { message?: string; extensions?: { code?: string } }[] }
      if (json.errors?.length) {
        const text = json.errors.map((e) => `${e.extensions?.code ?? ''} ${e.message ?? ''}`).join('; ')
        if (DENIED.test(text)) return { found, failure: 'protected_customer_data' }
        throw new TrackUnavailable(`Shopify Admin API: ${text}`)
      }
      const orders = json.data?.orders
      if (!orders?.nodes) throw new TrackUnavailable('Shopify Admin API returned no orders field')
      for (const o of orders.nodes) {
        const ref = refOf(o)
        if (!ref || !wanted.has(ref) || o.cancelledAt) continue
        // A shipping address that came back empty for an order we know is the access refusal in disguise (Shopify blanks protected fields), unless the order truly has none.
        if (o.shippingAddress) found.set(ref, clean(o.shippingAddress))
      }
      if (found.size >= wanted.size || !orders.pageInfo?.hasNextPage || !orders.pageInfo.endCursor) break
      after = orders.pageInfo.endCursor
    }
    return { found, failure: null }
  } catch (err) {
    // the reason goes to the log; no address is ever in it
    console.error('[ichirei-ops] shipping addresses unavailable:', err instanceof Error ? err.message : err)
    return { found, failure: 'unavailable' }
  }
}

/** The wording of the CSV's address_source cell. */
export const SHIPPING_SOURCE = {
  read: 'Shopify checkout address',
  notFound: 'Shopify checkout address: order not found (read_orders sees 60 days) — look it up in Shopify',
  protected_customer_data: 'Shopify refused the address: the Tracking app needs protected customer data access (name, address, phone) — look it up in Shopify',
  not_configured: 'Shopify address lookup is not configured — look it up in Shopify',
  unavailable: 'Shopify could not be asked just now — look it up in Shopify',
} as const
