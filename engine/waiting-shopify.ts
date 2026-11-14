// The two READ-ONLY ways to find waiting orders in Shopify (the third, the webhook, is api/claim.ts). Same Tracking app and same token as /track: scope read_orders only, one
// GraphQL query, never a mutation — nothing here writes to Shopify. Without the app's configuration, or when Shopify refuses the buyer's e-mail (protected customer data) or cannot
// be asked, the answer is "nothing found" and the caller carries on: a waiting order is never an error.

import { recordWaiting, waitingFromShopify, fromAdmin, type AdminWaitingOrder, type WaitingOrder } from './waiting.ts'
import type { OrderStore } from './order-store.ts'
import { TrackUnavailable, type AdminTokenCache, type TrackDeps } from './track.ts'

const FIELDS = `name email createdAt cancelledAt displayFinancialStatus customerLocale
      currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      customAttributes { key value }
      lineItems(first: 10) { nodes { sku customAttributes { key value } } }
      transactions(first: 5) { kind status processedAt }`

const QUERY = `query Waiting($q: String!, $after: String) {
  orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { ${FIELDS} }
  }
}`

async function run(d: TrackDeps, tokens: AdminTokenCache, q: string, after: string | null): Promise<{ nodes: AdminWaitingOrder[]; next: string | null }> {
  const doFetch = d.fetchImpl ?? fetch
  const call = async (token: string) =>
    doFetch(`${d.config.apiBase}/admin/api/${d.config.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query: QUERY, variables: { q, after } }),
      signal: AbortSignal.timeout(20_000),
    })
  let res = await call(await tokens.get(d))
  if (res.status === 401) {
    tokens.clear()
    res = await call(await tokens.get(d))
  }
  if (!res.ok) throw new TrackUnavailable(`Shopify Admin API HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { orders?: { nodes?: AdminWaitingOrder[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } }; errors?: { message?: string }[] }
  if (json.errors?.length) throw new TrackUnavailable(`Shopify Admin API: ${json.errors.map((e) => e.message ?? '').join('; ')}`)
  const orders = json.data?.orders
  if (!orders?.nodes) throw new TrackUnavailable('Shopify Admin API returned no orders field')
  return { nodes: orders.nodes, next: orders.pageInfo?.hasNextPage ? (orders.pageInfo.endCursor ?? null) : null }
}

/** /ops: the last `days` days of orders; every waiting one is recorded (a record that exists is never touched). Returns how many were new, or null when Shopify could not be asked. */
export async function sweepWaiting(store: OrderStore, d: TrackDeps | null, tokens: AdminTokenCache, now: Date, days = 14): Promise<number | null> {
  if (!d) return null
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  let created = 0
  try {
    let after: string | null = null
    for (let page = 0; page < 4; page++) {
      const r = await run(d, tokens, `created_at:>=${since}`, after)
      for (const o of r.nodes) {
        const w = waitingFromShopify(fromAdmin(o), 'ops_sweep', now)
        if (w && (await recordWaiting(store, w)).created) created++
      }
      if (!r.next) break
      after = r.next
    }
    return created
  } catch (err) {
    console.error('[ichirei-waiting] sweep failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** /claim: Shopify's own record of the one order named (only used when we have none). The record is stored and returned; null when it is not a waiting order or Shopify cannot be asked. */
export async function lookupWaiting(store: OrderStore, d: TrackDeps | null, tokens: AdminTokenCache, orderNumber: string, now: Date): Promise<WaitingOrder | null> {
  if (!d) return null
  try {
    const r = await run(d, tokens, `name:#${orderNumber}`, null)
    // the search is fuzzy: only the order whose number is exactly the one asked for
    const o = r.nodes.find((n) => (n.name ?? '').replace(/\D/g, '') === orderNumber)
    const w = o ? waitingFromShopify(fromAdmin(o), 'claim_lookup', now) : null
    return w ? (await recordWaiting(store, w)).record : null
  } catch (err) {
    console.error('[ichirei-waiting] lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}
