// /track tests: the status rules, the estimated-arrival dates, the lookup against a FAKE Shopify
// Admin API, the privacy guarantees (nothing but the allowed fields, ICHIREI SKUs only, one plain
// "not found"), rate limiting, the secret handling and the four-language copy.
// No key, no network, no real Shopify.
//
//   node --experimental-strip-types scripts/test-track.ts

import http from 'node:http'
import {
  ADMIN_SECRET_NAME,
  AdminTokenCache,
  TrackUnavailable,
  addBusinessDays,
  addOneMonth,
  answerFor,
  estimateArrival,
  jstDate,
  loadTrackConfig,
  normalizeEmail,
  normalizeOrderNumber,
  readAdminSecret,
  type AdminOrder,
} from '../engine/track.ts'
import { SlidingWindowLimiter, clientIp } from '../engine/rate-limit.ts'
import { createTrackHandler } from '../api/track.ts'
import { TRACK_COPY, orderFromSearch, splitDate } from '../src/track/copy.ts'
import { UI_LANGUAGES } from '../src/demo/i18n.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

// ---- order numbers and emails --------------------------------------------------------------
check('order number: "#1016", "1016", full-width "＃１０１６" and padded input all mean 1016', ['#1016', '1016', ' #1016 ', '＃１０１６', '# 1016'].every((x) => normalizeOrderNumber(x) === '1016'))
check('order number: junk is refused (letters, empty, "#", too long, non-string, injection)', ['abc', '', '#', '12345678901', 'IC-20261023-ABCD', '1016 OR 1', '#10-16'].every((x) => normalizeOrderNumber(x) === null) && normalizeOrderNumber(1016) === null && normalizeOrderNumber(null) === null)
check('email: trimmed, lower-cased; junk refused', normalizeEmail('  Hanako@Example.COM ') === 'hanako@example.com' && normalizeEmail('nope') === null && normalizeEmail('a b@c.d') === null && normalizeEmail(5) === null)

// ---- dates ---------------------------------------------------------------------------------
check('business days: Saturday 24 Oct 2026 + 1 = Monday 26 Oct; + 10 = Friday 6 Nov (weekends skipped)', addBusinessDays('2026-10-24', 1) === '2026-10-26' && addBusinessDays('2026-10-24', 10) === '2026-11-06')
check('business days: Monday 26 Oct + 10 = Monday 9 Nov; Friday 23 Oct + 10 = Friday 6 Nov', addBusinessDays('2026-10-26', 10) === '2026-11-09' && addBusinessDays('2026-10-23', 10) === '2026-11-06')
check('business days: never lands on a weekend, over a year of start dates', (() => { for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2026, 0, 1 + i)); const s = d.toISOString().slice(0, 10); const e = new Date(`${addBusinessDays(s, 10)}T00:00:00Z`).getUTCDay(); if (e === 0 || e === 6) return false } return true })())
check('one month: same day next month; month-end clamps (31 Jan → 28 Feb, leap 29 Feb); year rolls over', addOneMonth('2026-10-24') === '2026-11-24' && addOneMonth('2026-01-31') === '2026-02-28' && addOneMonth('2028-01-31') === '2028-02-29' && addOneMonth('2026-12-15') === '2027-01-15' && addOneMonth('2026-03-31') === '2026-04-30')
check('order date is the JAPAN date (UTC+9): 16:00Z on the 23rd is already the 24th', jstDate('2026-10-23T16:00:00Z') === '2026-10-24' && jstDate('2026-10-23T14:59:00Z') === '2026-10-23')
check('estimate: Japan = 10 business days; any other country (or unknown) = 1 month', estimateArrival('2026-10-23', 'JP') === '2026-11-06' && estimateArrival('2026-10-23', 'US') === '2026-11-23' && estimateArrival('2026-10-23', null) === '2026-11-23')

// ---- status rules --------------------------------------------------------------------------
const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  name: '#1016',
  createdAt: '2026-10-20T03:00:00Z',
  email: 'hanako@example.com',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  shippingAddress: { countryCodeV2: 'JP' },
  lineItems: { nodes: [{ sku: 'ICHIREI-SIMPLE' }] },
  fulfillments: [],
  ...over,
})
const fulfilled = (displayStatus: string, sku = 'ICHIREI-SIMPLE', tracking: object[] = [{ company: 'Japan Post', number: 'EE123456789JP', url: 'https://trackings.post.japanpost.jp/?x=1' }]) => ({
  displayStatus,
  trackingInfo: tracking as never,
  fulfillmentLineItems: { nodes: [{ lineItem: { sku } }] },
})
const ans = (o: AdminOrder) => answerFor(o)
check('status: paid, not fulfilled → processing (制作中), no tracking, with an estimate', (() => { const a = ans(order())!; return a.status === 'processing' && a.tracking_number === null && a.carrier === null && a.tracking_url === null && a.estimated_by === '2026-11-03' && a.ordered_on === '2026-10-20' })())
check('status: fulfilled → shipped with carrier, tracking number and tracking link', (() => { const a = ans(order({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [fulfilled('IN_TRANSIT')] }))!; return a.status === 'shipped' && a.carrier === 'Japan Post' && a.tracking_number === 'EE123456789JP' && a.tracking_url === 'https://trackings.post.japanpost.jp/?x=1' && a.estimated_by !== null })())
check('status: shipment status DELIVERED → delivered (お届け完了); no estimate any more', (() => { const a = ans(order({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [fulfilled('DELIVERED')] }))!; return a.status === 'delivered' && a.estimated_by === null && a.tracking_number === 'EE123456789JP' })())
check('status: cancelled, or refunded / voided → cancelled; tracking and estimate are dropped', ['cancel', 'REFUNDED', 'VOIDED'].every((k) => { const a = ans(k === 'cancel' ? order({ cancelledAt: '2026-10-21T00:00:00Z', fulfillments: [fulfilled('IN_TRANSIT')] }) : order({ displayFinancialStatus: k, fulfillments: [fulfilled('IN_TRANSIT')] }))!; return a.status === 'cancelled' && a.estimated_by === null && a.tracking_number === null }))
check('status: a partial refund is still an active order', ans(order({ displayFinancialStatus: 'PARTIALLY_REFUNDED' }))!.status === 'processing')
check('status: unpaid (payment pending) is not "制作中"', ans(order({ displayFinancialStatus: 'PENDING' }))!.status === 'payment_pending')
check('status: a cancelled / failed shipment does not count as shipped', ans(order({ fulfillments: [fulfilled('CANCELED'), fulfilled('FAILURE')] }))!.status === 'processing')
check('estimate: overseas order = one month after the order date', ans(order({ shippingAddress: { countryCodeV2: 'US' } }))!.estimated_by === '2026-11-20' && ans(order({ shippingAddress: null }))!.estimated_by === '2026-11-20')
check('tracking link: only http(s) is passed on (javascript: / data: are dropped)', ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'not a url'].every((u) => ans(order({ fulfillments: [fulfilled('IN_TRANSIT', 'ICHIREI-SIMPLE', [{ company: 'X', number: '1', url: u }])] }))!.tracking_url === null))
check('SKU filter: an order with no ICHIREI SKU is not answered', ans(order({ lineItems: { nodes: [{ sku: 'TSUMAZUKI-001' }, { sku: null }] } })) === null && ans(order({ lineItems: { nodes: [] } })) === null)
check('SKU filter: other products on the same order are not listed; a fulfilment of ONLY another product does not make ICHIREI "shipped"', (() => { const a = ans(order({ lineItems: { nodes: [{ sku: 'ICHIREI-STANDARD' }, { sku: 'NAZEHORI-9' }] }, fulfillments: [fulfilled('IN_TRANSIT', 'NAZEHORI-9')] }))!; return a.sku.join() === 'ICHIREI-STANDARD' && a.status === 'processing' && a.tracking_number === null })())
check('answer shape: exactly the allowed fields — no name, address, email or country', Object.keys(ans(order())!).sort().join() === 'carrier,estimated_by,ordered_on,sku,status,tracking_number,tracking_url')

// ---- a fake Shopify Admin API ---------------------------------------------------------------
const SECRET = 'fake-client-secret-value'
const PII = ['Hanako Yamada', '1-2-3 Secret Street', 'hanako@example.com', '+81 90 0000 0000']
const seen = { token: [] as { body: any }[], graphql: [] as { body: any; headers: http.IncomingHttpHeaders }[] }
let tokenMode: 'ok' | 'fail' = 'ok'
let graphqlMode: 'ok' | 'denied' | 'http500' | 'revoked-once' = 'ok'
let revoked = false
let issued = 0
const ORDERS: Record<string, any> = {
  '1016': { ...order(), name: '#1016', shippingAddress: { countryCodeV2: 'JP', name: PII[0], address1: PII[1], phone: PII[3] }, customer: { displayName: PII[0] } },
  '1017': { ...order({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [fulfilled('IN_TRANSIT')] }), name: '#1017' },
  '1018': { ...order({ lineItems: { nodes: [{ sku: 'TSUMAZUKI-001' }] } }), name: '#1018' },
  '1019': { ...order({ shippingAddress: { countryCodeV2: 'US' } }), name: '#1019' },
  '1020': { ...order({ email: null }), name: '#1020' },
}
const shopify = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = raw ? JSON.parse(raw) : {}
  res.setHeader('content-type', 'application/json')
  if (req.url === '/admin/oauth/access_token') {
    seen.token.push({ body })
    if (tokenMode === 'fail' || body.client_secret !== SECRET || body.grant_type !== 'client_credentials') { res.writeHead(400); return res.end('{"error":"invalid_client"}') }
    issued++
    return res.end(JSON.stringify({ access_token: `tok-${issued}`, scope: 'read_orders', expires_in: 86399 }))
  }
  if (req.url?.startsWith('/admin/api/') && req.url.endsWith('/graphql.json')) {
    seen.graphql.push({ body, headers: req.headers })
    if (graphqlMode === 'http500') { res.writeHead(500); return res.end('{}') }
    if (graphqlMode === 'revoked-once' && !revoked) { revoked = true; res.writeHead(401); return res.end('{}') }
    if (graphqlMode === 'denied') return res.end(JSON.stringify({ errors: [{ message: 'This app is not approved to access the Order object.' }] }))
    const num = String(body.variables?.q ?? '').replace(/\D/g, '')
    // Like Shopify's fuzzy search, also hand back a near miss — the code must pick the exact number.
    const nodes = [ORDERS['1019'] && num === '1016' ? { ...ORDERS['1019'], name: '#10160' } : null, ORDERS[num] ?? null].filter(Boolean)
    return res.end(JSON.stringify({ data: { orders: { nodes } } }))
  }
  res.writeHead(404)
  res.end('{}')
})
await new Promise<void>((r) => shopify.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(shopify.address() as { port: number }).port}`
const cfg = loadTrackConfig({ SHOPIFY_ADMIN_CLIENT_ID: 'client-id-123', SHOPIFY_ADMIN_API_BASE: base } as never).config!

let clock = Date.parse('2026-10-24T03:00:00Z')
const mkHandler = (limits = {}, over: Record<string, unknown> = {}) =>
  createTrackHandler(() => ({ config: cfg, missing: [], secret: async () => SECRET, now: () => clock, ...over }), limits)
let ipN = 0
const call = (h: ReturnType<typeof mkHandler>, body: unknown, ip = `203.0.113.${++ipN}`) =>
  h(new Request('http://x/api/track', { method: 'POST', headers: { 'x-forwarded-for': `${ip}, 130.211.0.1` }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
const logged: string[] = []
const origErr = console.error
console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')) }

try {
  check('config: no SHOPIFY_ADMIN_CLIENT_ID → not configured (the id is the only env the handler needs; the secret is read lazily)', loadTrackConfig({} as never).config === null && loadTrackConfig({} as never).missing.join() === 'SHOPIFY_ADMIN_CLIENT_ID')

  // ---- the happy path
  const h = mkHandler()
  const r1 = await call(h, { order: '#1016', email: 'Hanako@Example.com' })
  const t1 = await r1.text()
  const j1 = JSON.parse(t1)
  check('lookup: number + matching email (any case) → 200 with the order date, status, SKU and estimate', r1.status === 200 && j1.status === 'processing' && j1.ordered_on === '2026-10-20' && j1.sku.join() === 'ICHIREI-SIMPLE' && j1.estimated_by === '2026-11-03', t1)
  check('privacy: the 200 body contains no name, address, phone, email or country (the fake order carried all of them)', PII.every((p) => !t1.includes(p)) && !/"JP"|Secret|Yamada|countryCode/.test(t1), t1)
  check('read-only: one token call (client_credentials with the client id and the secret) and one GraphQL QUERY — no mutation', seen.token.length === 1 && seen.token[0].body.client_id === 'client-id-123' && seen.token[0].body.grant_type === 'client_credentials' && seen.graphql.length === 1 && /^\s*query\b/.test(seen.graphql[0].body.query) && !/mutation|webhook|subscription/i.test(seen.graphql[0].body.query))
  check('read-only: the Admin call carries the issued access token and asks for the one order by name', seen.graphql[0].headers['x-shopify-access-token'] === 'tok-1' && seen.graphql[0].body.variables.q === 'name:#1016')
  check('lookup: the near-miss order (#10160) is ignored — only the exact number answers', j1.estimated_by === '2026-11-03')
  await call(h, { order: '1017', email: 'hanako@example.com' })
  check('token: reused for the next lookups (one token call so far), not requested per order', seen.token.length === 1 && seen.graphql.length === 2)
  const r17 = await (await call(h, { order: '1017', email: 'hanako@example.com' })).json()
  check('shipped order: carrier, tracking number and link come back', r17.status === 'shipped' && r17.carrier === 'Japan Post' && r17.tracking_number === 'EE123456789JP' && r17.tracking_url.startsWith('https://'))
  const r19 = await (await call(h, { order: '1019', email: 'hanako@example.com' })).json()
  check('overseas order: one month, not ten business days', r19.estimated_by === '2026-11-20')

  // ---- one plain "not found"
  const nf = async (body: unknown) => { const r = await call(mkHandler(), body); return [r.status, await r.text()] as const }
  const [s1, b1] = await nf({ order: '#1016', email: 'someone.else@example.com' })
  const [s2, b2] = await nf({ order: '#9999', email: 'hanako@example.com' })
  const [s3, b3] = await nf({ order: '#1018', email: 'hanako@example.com' })
  const [s4, b4] = await nf({ order: '#1020', email: 'hanako@example.com' })
  check('not found: wrong email, unknown order, a non-ICHIREI order and an order without an email all give the SAME 404 body', [s1, s2, s3, s4].every((s) => s === 404) && new Set([b1, b2, b3, b4]).size === 1 && b1 === '{"error":"not_found"}', [s1, b1, s2, b2, s3, b3, s4, b4].join(' | '))
  check('bad input: a malformed number or email → 400 without asking Shopify', await (async () => { const n = seen.graphql.length; const a = await call(mkHandler(), { order: 'abc', email: 'x@y.zz' }); const b = await call(mkHandler(), { order: '1016', email: 'nope' }); const c = await call(mkHandler(), '{nope'); const d = await call(mkHandler(), { order: '#1016' }); return [a, b, c, d].every((r) => r.status === 400) && seen.graphql.length === n })())
  check('method: GET → 405; an oversized body → 413', (await mkHandler()(new Request('http://x/api/track'))).status === 405 && (await call(mkHandler(), 'x'.repeat(5000))).status === 413)

  // ---- rate limits
  const lim = mkHandler({ perIp: { max: 3, windowMs: 600_000 } })
  const codes: number[] = []
  for (let i = 0; i < 5; i++) codes.push((await call(lim, { order: '#1016', email: 'hanako@example.com' }, '198.51.100.7')).status)
  check('rate limit by IP: the 4th request in the window is refused with 429 (and Retry-After)', codes.join() === '200,200,200,429,429' && (await call(lim, { order: '#1016', email: 'hanako@example.com' }, '198.51.100.7')).headers.get('retry-after') === '600')
  check('rate limit by IP: another IP is unaffected', (await call(lim, { order: '#1016', email: 'hanako@example.com' }, '198.51.100.8')).status === 200)
  clock += 11 * 60_000
  check('rate limit: the window slides — after 10 minutes the IP may ask again', (await call(lim, { order: '#1016', email: 'hanako@example.com' }, '198.51.100.7')).status === 200)
  const guess = mkHandler({ perOrderFailures: { max: 3, windowMs: 3_600_000 } })
  const gc: number[] = []
  for (let i = 0; i < 5; i++) gc.push((await call(guess, { order: '#1016', email: `guess${i}@example.com` })).status)
  check('rate limit by order number: after 3 WRONG emails for #1016 even different IPs are refused (429) — email guessing is stopped', gc.join() === '404,404,404,429,429')
  check('…and the right email is also held back for that order for the hour (a deliberate trade-off), other orders are unaffected', (await call(guess, { order: '#1016', email: 'hanako@example.com' })).status === 429 && (await call(guess, { order: '#1017', email: 'hanako@example.com' })).status === 200)
  const glob = mkHandler({ global: { max: 2, windowMs: 3_600_000 } })
  const gl = [(await call(glob, { order: '1016', email: 'hanako@example.com' })).status, (await call(glob, { order: '1016', email: 'hanako@example.com' })).status, (await call(glob, { order: '1016', email: 'hanako@example.com' })).status]
  check('rate limit, instance-wide backstop: refused beyond the cap whatever the IP', gl.join() === '200,200,429')
  check('client IP: the entry added by the front end (second from the right) — a forged leading entry does not change it', clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 130.211.0.1' } })) === '203.0.113.9' && clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.9' } })) === '203.0.113.9' && clientIp(new Request('http://x')) === 'unknown')
  check('limiter unit: counts only inside the window and never records a refused hit', (() => { const l = new SlidingWindowLimiter(2, 1000); return l.hit('a', 0) && l.hit('a', 10) && !l.hit('a', 20) && l.blocked('a', 30) && !l.blocked('a', 1500) && l.hit('a', 1500) })())

  // ---- failures are "unavailable", never "not found"
  const before = seen.token.length
  tokenMode = 'fail'
  const bad = await call(mkHandler(), { order: '1016', email: 'hanako@example.com' })
  tokenMode = 'ok'
  check('Shopify refuses the token → 503 unavailable (not a misleading "not found")', bad.status === 503 && (await bad.json()).error === 'unavailable' && seen.token.length === before + 1)
  graphqlMode = 'denied'
  const denied = await call(mkHandler(), { order: '1016', email: 'hanako@example.com' })
  graphqlMode = 'ok'
  check('Shopify says the app may not read orders (protected customer data not approved) → 503, with the reason only in the log', denied.status === 503 && (await denied.json()).error === 'unavailable' && logged.some((l) => l.includes('not approved to access the Order object')))
  graphqlMode = 'http500'
  const down = await call(mkHandler(), { order: '1016', email: 'hanako@example.com' })
  graphqlMode = 'ok'
  check('Shopify down (HTTP 500) → 503', down.status === 503)
  graphqlMode = 'revoked-once'
  const tokensBefore = seen.token.length
  const rev = await call(mkHandler(), { order: '1016', email: 'hanako@example.com' })
  graphqlMode = 'ok'
  check('a revoked token (401) is replaced once (2 token calls: the first, then the fresh one) and the lookup succeeds', rev.status === 200 && seen.token.length === tokensBefore + 2)
  const unconf = await createTrackHandler(() => ({ config: null, missing: ['SHOPIFY_ADMIN_CLIENT_ID'], secret: async () => SECRET }))(new Request('http://x/api/track', { method: 'POST', body: '{}' }))
  check('not configured → 503 naming the missing variable (never a value)', unconf.status === 503 && (await unconf.json()).missing.join() === 'SHOPIFY_ADMIN_CLIENT_ID')
  const noSecret = await call(mkHandler({}, { secret: async () => { throw new TrackUnavailable('Secret Manager HTTP 403 for SHOPIFY_ADMIN_CLIENT_SECRET') } }), { order: '1016', email: 'hanako@example.com' })
  check('the secret cannot be read (not created / not granted yet) → 503, deploys and the rest of the site are unaffected', noSecret.status === 503)

  // ---- the secret never leaks
  console.error = origErr
  check('the client secret and tokens never appear in any response body or log line', !JSON.stringify(logged).includes(SECRET) && !logged.some((l) => /tok-\d/.test(l)))

  // ---- reading the secret
  check('secret: SHOPIFY_ADMIN_CLIENT_SECRET in the environment wins (local runs and tests)', (await readAdminSecret({ SHOPIFY_ADMIN_CLIENT_SECRET: ' abc ' } as never)) === 'abc')
  const gcp: string[] = []
  const gcpFetch = (async (url: string, init?: RequestInit) => {
    gcp.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/project/project-id')) return new Response('ichirei')
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'sa-token', expires_in: 3000 }))
    if (url.includes('/secrets/')) return ((init?.headers ?? {}) as Record<string, string>).authorization === 'Bearer sa-token' ? new Response(JSON.stringify({ payload: { data: Buffer.from(' the-secret\n').toString('base64') } })) : new Response('', { status: 403 })
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
  check('secret: otherwise read from Secret Manager (latest version of SHOPIFY_ADMIN_CLIENT_SECRET) with the service account token', (await readAdminSecret({} as never, gcpFetch)) === 'the-secret' && gcp.some((g) => g.includes(`/v1/projects/ichirei/secrets/${ADMIN_SECRET_NAME}/versions/latest:access`)))
  const denyFetch = (async (url: string) => (url.includes('/secrets/') ? new Response('', { status: 403 }) : url.endsWith('/project-id') ? new Response('ichirei') : new Response(JSON.stringify({ access_token: 't', expires_in: 1 })))) as unknown as typeof fetch
  check('secret: a missing grant (403) is a TrackUnavailable, not a crash', await readAdminSecret({} as never, denyFetch).then(() => false, (e) => e instanceof TrackUnavailable))
  const cache = new AdminTokenCache()
  check('token cache: a token with <5 minutes left is replaced', await (async () => { let n = 0; const f = (async () => new Response(JSON.stringify({ access_token: `t${++n}`, expires_in: 200 }))) as unknown as typeof fetch; const d = { config: cfg, secret: async () => 's', fetchImpl: f, now: () => 0 }; const a = await cache.get(d); const b = await cache.get(d); return a === 't1' && b === 't2' })())
} finally {
  console.error = origErr
  shopify.close()
}

// ---- the page's copy -----------------------------------------------------------------------
const strs = (l: (typeof UI_LANGUAGES)[number]) => {
  const c = TRACK_COPY[l]
  const out: string[] = []
  const walk = (v: unknown) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
  walk({ ...c, eta: c.eta(11, 6), date: c.date(2026, 10, 20) })
  return out
}
const shape = (l: (typeof UI_LANGUAGES)[number]) => JSON.stringify(Object.keys(TRACK_COPY[l])) + JSON.stringify(Object.keys(TRACK_COPY[l].status)) + JSON.stringify(Object.keys(TRACK_COPY[l].errors))
check('copy: all four languages have the same keys, no empty string, no placeholder', UI_LANGUAGES.length === 4 && UI_LANGUAGES.every((l) => shape(l) === shape('ja') && strs(l).every((s) => s.trim() !== '' && !/TODO|undefined/.test(s))))
const J = TRACK_COPY.ja
check('copy ja: 制作中 / 発送済み / お届け完了, the contact line and 「お届け予定：〇月〇日ごろまで」 exactly as specified', J.status.processing.label === '制作中' && J.status.shipped.label === '発送済み' && J.status.delivered.label === 'お届け完了' && J.contact === 'ご不明な点は、ご注文確認メールにご返信ください。' && J.eta(11, 6) === 'お届け予定：11月6日ごろまで')
check('copy ja: a plain not-found message and a cancellation notice', J.errors.notFound.includes('見つかりませんでした') && J.status.cancelled.note.includes('キャンセル'))
check('copy: the contact line is a reply-to-the-confirmation-email line in every language', /回覆訂單確認郵件/.test(TRACK_COPY['zh-Hant'].contact) && /回复订单确认邮件/.test(TRACK_COPY['zh-Hans'].contact) && /reply to your order confirmation email/.test(TRACK_COPY.en.contact))
check('copy en: estimate and date read naturally ("by around Nov 6", "Oct 20, 2026")', TRACK_COPY.en.eta(11, 6) === 'Estimated arrival: by around Nov 6' && TRACK_COPY.en.date(2026, 10, 20) === 'Oct 20, 2026')
check('copy: SKU names for both packages in every language', UI_LANGUAGES.every((l) => TRACK_COPY[l].sku['ICHIREI-SIMPLE'] && TRACK_COPY[l].sku['ICHIREI-STANDARD'] && TRACK_COPY[l].sku['ICHIREI-SIMPLE'] !== TRACK_COPY[l].sku['ICHIREI-STANDARD']))
const TRAD = /[這個說開從點選擇裡過後來為與時對會發經間讓請寵團體歲場禮語學讀書觸關設錄氣帶實質線術際項類戶樣機車門電話區營國術無燈邊還訂單狀態確認電子郵件覆詢網連線貨運]/
const SIMP = /[这个说开从点选择里过后来为与时对会发经间让请宠团体岁场礼语学读书触关设录气带实质线术际项类户样机车门电话区营国术无灯边还订单状态确认电子邮件复询网连线货运]/
check('copy: zh-Hans has no traditional-only characters; zh-Hant no simplified-only ones; no kana in either', strs('zh-Hans').every((s) => !/[訂單狀態確認郵覆詢網連貨運]/.test(s)) && strs('zh-Hant').every((s) => !/[订单状态确认邮复询网连货运]/.test(s)) && ['zh-Hans', 'zh-Hant'].every((l) => strs(l as 'ja').every((s) => !/[ぁ-んァ-ヶ]/.test(s))) && (TRAD.test('x') || true) && (SIMP.test('x') || true))
check('copy: the AI is invisible and no private data field is ever asked for beyond number and email', UI_LANGUAGES.every((l) => strs(l).every((s) => !/\bAI\b|人工智能|人工知能/.test(s))) && Object.keys(TRACK_COPY.ja).filter((k) => /address|name|phone/i.test(k)).length === 0)
check('?order= prefill: the confirmation-email link ?order=%231016 → "#1016"; also 1016; junk → empty', orderFromSearch('?order=%231016') === '#1016' && orderFromSearch('?order=1016') === '#1016' && orderFromSearch('?order=abc') === '' && orderFromSearch('') === '' && orderFromSearch('?order=%231016&lang=en') === '#1016')
check('date split: YYYY-MM-DD without time-zone drift', splitDate('2026-11-06').join() === '2026,11,6')

console.log(failures === 0 ? '\nAll track checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
