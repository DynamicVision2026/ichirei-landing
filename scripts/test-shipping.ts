// Follow-up of 2026-10-30: the shipping address for the workshop CSV, read through the existing read-only Tracking app. A fake Shopify Admin API; no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-shipping.ts

import { readShippingAddresses, SHIPPING_SOURCE } from '../engine/shipping.ts'
import { AdminTokenCache, type TrackDeps } from '../engine/track.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}

const ADDR = { name: '山田 花子', phone: '090-1111-2222', address1: '神宮前1-2-3', address2: 'コーポA', city: '渋谷区', province: '東京都', zip: '150-0001', countryCodeV2: 'JP' }
const order = (ref: string, over: Record<string, unknown> = {}) => ({ cancelledAt: null, customAttributes: [{ key: 'order_ref', value: ref }], lineItems: { nodes: [{ customAttributes: [] }] }, shippingAddress: ADDR, ...over })

interface Call { url: string; headers: Record<string, string>; body: { query?: string; variables?: Record<string, unknown> } }
function fake(pages: unknown[][], opts: { errors?: unknown; status?: number } = {}) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 86400 }), { status: 200 })
    const body = JSON.parse(String(init.body))
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body })
    if (opts.status) return new Response('{}', { status: opts.status })
    if (opts.errors) return new Response(JSON.stringify({ errors: opts.errors }), { status: 200 })
    const i = body.variables.after ? Number(String(body.variables.after).replace('c', '')) : 0
    return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: `c${i + 1}` }, nodes: pages[i] } } }), { status: 200 })
  }) as typeof fetch
  const d: TrackDeps = { config: { storeDomain: 'x.myshopify.com', apiVersion: '2025-10', clientId: 'cid', apiBase: 'https://x.myshopify.com' }, secret: async () => 's', fetchImpl }
  return { d, calls }
}

const errors: string[] = []
const origErr = console.error
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')) }

{
  const f = fake([[order('IC-20261023-AAAAAAAA'), order('IC-20261023-ZZZZZZZZ'), order('IC-20261023-CANCELED', { cancelledAt: '2026-10-23T00:00:00Z' })]])
  const r = await readShippingAddresses(['IC-20261023-AAAAAAAA', 'IC-20261023-CANCELED', 'IC-20261023-MISSING1'], f.d, new AdminTokenCache())
  const a = r.found.get('IC-20261023-AAAAAAAA')
  check('matches the order by the order_ref the cart carries; name, phone, country, postal, region and "city address1 address2" come back', r.failure === null && a?.name === '山田 花子' && a.phone === '090-1111-2222' && a.country === 'JP' && a.postal === '150-0001' && a.region === '東京都' && a.address === '渋谷区 神宮前1-2-3 コーポA')
  check('orders that were not asked for, cancelled orders and unknown refs are not returned', r.found.size === 1 && !r.found.has('IC-20261023-ZZZZZZZZ') && !r.found.has('IC-20261023-CANCELED'))
  check('read-only: one GraphQL query (no mutation), the existing read-only app\'s token, only orders since the day of the oldest ref', f.calls.length === 1 && !/mutation/i.test(f.calls[0].body.query ?? '') && f.calls[0].headers['x-shopify-access-token'] === 'tok' && f.calls[0].body.variables?.q === 'created_at:>=2026-10-22')
}
{
  const f = fake([[order('IC-20261023-OTHERONE')], [order('IC-20261023-AAAAAAAA', { customAttributes: [], lineItems: { nodes: [{ customAttributes: [{ key: 'order_ref', value: 'IC-20261023-AAAAAAAA' }] }] } })]])
  const r = await readShippingAddresses(['IC-20261023-AAAAAAAA'], f.d, new AdminTokenCache())
  check('goes on to the next page until every wanted order is found; the order_ref on the line counts too', r.found.has('IC-20261023-AAAAAAAA') && f.calls.length === 2)
}
for (const [label, make, want] of [
  ['an access error naming protected customer data', () => fake([[]], { errors: [{ message: 'This app is not approved to access the Order object. See https://shopify.dev/docs/apps/launch/protected-customer-data', extensions: { code: 'ACCESS_DENIED' } }] }), 'protected_customer_data'],
  ['HTTP 403', () => fake([[]], { status: 403 }), 'protected_customer_data'],
  ['HTTP 500', () => fake([[]], { status: 500 }), 'unavailable'],
  ['another GraphQL error', () => fake([[]], { errors: [{ message: 'Throttled' }] }), 'unavailable'],
] as const) {
  const r = await readShippingAddresses(['IC-20261023-AAAAAAAA'], make().d, new AdminTokenCache())
  check(`${label} → ${want}; nothing is returned, nothing is guessed`, r.failure === want && r.found.size === 0)
}
{
  const r = await readShippingAddresses(['IC-20261023-AAAAAAAA'], null, new AdminTokenCache())
  const none = await readShippingAddresses([], null, new AdminTokenCache())
  check('no Tracking app configured → not_configured; no refs → nothing asked', r.failure === 'not_configured' && none.failure === null && none.found.size === 0)
}
check('no address, name or phone ever reaches the log', errors.every((e) => !/山田|150-0001|090-/.test(e)))
check('the CSV wording says exactly what to do in each case', SHIPPING_SOURCE.protected_customer_data.includes('protected customer data access (name, address, phone)') && SHIPPING_SOURCE.notFound.includes('60 days'))
console.error = origErr

if (failures) {
  console.error(`\n${failures} shipping check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll shipping checks passed.')
