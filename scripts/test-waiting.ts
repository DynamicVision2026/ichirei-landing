// 2026-11-13 — orders with no gift attached ("waiting" orders) and the Thanksgiving sale. No network, no model: Shopify is a fake, the store is in memory.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-waiting.ts

import { createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Liquid } from 'liquidjs'
import { createClaimHandlers } from '../api/claim.ts'
import { createOpsHandlers, type OpsDeps } from '../api/ops.ts'
import { buildStats, orderStatOf } from '../api/ops-stats.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { sizesResponse } from '../api/sizes.ts'
import { windowOf } from '../engine/change-window.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { AdminTokenCache } from '../engine/track.ts'
import type { PaymentInfo } from '../engine/shipping.ts'
import { availableSizes, createCart, loadShopifyConfig } from '../engine/shopify.ts'
import { STATS_KEYS, statsDicts } from '../engine/stats-i18n.ts'
import { WAITING_DAYS, fromAdmin, fromWebhook, languageOfLocale, listWaiting, matchClaim, readWaiting, waitingFromShopify, waitingState } from '../engine/waiting.ts'
import { lookupWaiting, sweepWaiting } from '../engine/waiting-shopify.ts'
import { CLAIM_COPY, orderFromSearch } from '../src/claim/copy.ts'
import { parseSale, saleLine, saleOn, salePriceJpy } from '../src/order/sale.ts'
import { cleanSale } from '../src/demo/useSizes.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-14T03:00:00Z')
const days = (n: number, from = NOW) => new Date(from.getTime() + n * 86_400_000)
const jsonOf = async (r: Response) => (await r.json()) as Record<string, unknown>

// ---- 0. the Shopify changes: the wood variants are gone ------------------------------------------------------------------------------------------------------
{
  const only = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '67913881616632', SHOPIFY_VARIANT_SIMPLE: '', SHOPIFY_VARIANT_STANDARD: '' } as NodeJS.ProcessEnv)
  check('(0) with the two wood variants empty (deleted in Shopify) the purchase config is still ready: only the token is required, nothing is "missing"', only.config !== null && only.missing.length === 0)
  check('(0) …and only the e-gift is on sale (the wood sizes are never put in a cart)', JSON.stringify(availableSizes(only.config)) === '["egift"]' && only.config?.variants.egift === 'gid://shopify/ProductVariant/67913881616632')
  const none = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't' } as NodeJS.ProcessEnv)
  check('(0) with no variant at all the config is still ready (no size is on sale; the server refuses with size_unavailable, never a crash)', none.config !== null && availableSizes(none.config).length === 0)
  const sizes = await jsonOf(sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', ICHIREI_WOOD_SIZES: 'coming_soon' } as NodeJS.ProcessEnv, NOW))
  check('(0) /api/sizes with the wood variants gone: the e-gift, plus the wood sizes listed as "coming soon" (the page shows 近日公開 and disables them)', JSON.stringify(sizes.sizes) === '["egift","simple","standard"]' && JSON.stringify(sizes.coming_soon) === '["simple","standard"]' && !('sale' in sizes))
  let refused = ''
  try {
    await createCart(only.config!, 'simple', [], 'IC-X', (async () => new Response('{}')) as typeof fetch)
  } catch (e) {
    refused = String((e as { detail?: { code?: string } }).detail?.code)
  }
  check('(0) a cart for a wood size is refused before Shopify is asked (size_unavailable)', refused === 'size_unavailable')
}

// ---- 1. recognising a waiting order -------------------------------------------------------------------------------------------------------------------------
const webhookBody = (over: Record<string, unknown> = {}) => ({
  id: 1, name: '#1016', email: 'Buyer@Example.com', financial_status: 'paid', processed_at: '2026-11-13T05:00:00+09:00', created_at: '2026-11-13T05:00:00+09:00', customer_locale: 'en-US', current_total_price: '2786.00', currency: 'JPY',
  line_items: [{ sku: 'ICHIREI-EGIFT', properties: [] }], note_attributes: [], ...over,
});
{
  const w = waitingFromShopify(fromWebhook(webhookBody())!, 'webhook', NOW)
  check('(1) a paid ICHIREI order whose line has none of our hidden properties is a waiting order: number, paid time, e-mail as Shopify holds it (lower-cased for the compare), language from the locale, what was paid', !!w && w.order_name === '#1016' && w.order_number === '1016' && w.id === 'WO-1016' && w.paid_at === '2026-11-12T20:00:00.000Z' && w.email === 'buyer@example.com' && w.language === 'en' && w.amount_jpy === 2786 && w.status === 'waiting')
  check('(1) an order that carries our order reference on its line (a normal order from our site) is NOT a waiting order — and neither is the old property name', waitingFromShopify(fromWebhook(webhookBody({ line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: 'IC-20261113-AAAAAAAA' }] }] }))!, 'webhook', NOW) === null && waitingFromShopify(fromWebhook(webhookBody({ line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: 'order_ref', value: 'IC-1' }] }] }))!, 'webhook', NOW) === null)
  check('(1) …nor one whose cart attribute order_ref reached the order', waitingFromShopify(fromWebhook(webhookBody({ note_attributes: [{ name: 'order_ref', value: 'IC-1' }] }))!, 'webhook', NOW) === null)
  check('(1) another product, an unpaid order, a cancelled order and an order with no e-mail are never waiting orders', waitingFromShopify(fromWebhook(webhookBody({ line_items: [{ sku: 'TSHIRT-M', properties: [] }] }))!, 'webhook', NOW) === null && waitingFromShopify(fromWebhook(webhookBody({ financial_status: 'pending' }))!, 'webhook', NOW) === null && waitingFromShopify(fromWebhook(webhookBody({ cancelled_at: '2026-11-13T06:00:00Z' }))!, 'webhook', NOW) === null && waitingFromShopify(fromWebhook(webhookBody({ email: null }))!, 'webhook', NOW) === null)
  check('(1) the language comes from the order\'s locale: ja → ja, zh-TW → zh-Hant, zh-CN → zh-Hans, en / anything else → en', languageOfLocale('ja') === 'ja' && languageOfLocale('ja-JP') === 'ja' && languageOfLocale('zh-TW') === 'zh-Hant' && languageOfLocale('zh-CN') === 'zh-Hans' && languageOfLocale('en-GB') === 'en' && languageOfLocale('fr') === 'en' && languageOfLocale(null) === 'en')
  const admin = fromAdmin({ name: '#1017', email: 'a@b.co', createdAt: '2026-11-13T00:00:00Z', displayFinancialStatus: 'PAID', customerLocale: 'ja', currentTotalPriceSet: { shopMoney: { amount: '3980.0', currencyCode: 'JPY' } }, lineItems: { nodes: [{ sku: 'ICHIREI-EGIFT', customAttributes: [] }] }, transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-11-13T00:05:00Z' }] })
  const wa = waitingFromShopify(admin, 'ops_sweep', NOW)
  check('(1) the read-only Admin API form of an order is recognised the same way (paid time = the sale transaction)', !!wa && wa.order_number === '1017' && wa.paid_at === '2026-11-13T00:05:00.000Z' && wa.language === 'ja' && wa.amount_jpy === 3980)
}

// ---- 2. the webhook (signed) ---------------------------------------------------------------------------------------------------------------------------------
const store = new MemoryOrderStore()
const SECRET = 'whsec-test-secret'
const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('base64')
const post = (path: string, raw: string, headers: Record<string, string> = {}, ip = '9.9.9.9') => new Request(`https://ichirei.soul-id.jp${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers }, body: raw })
let admin: import('../engine/track.ts').TrackDeps | null = null
const claimDeps = () => ({ store, now: () => NOW, env: {} as NodeJS.ProcessEnv, admin, webhookSecret: async () => SECRET })
const C = createClaimHandlers(claimDeps)
{
  const raw = JSON.stringify(webhookBody())
  const bad = await C.webhook(post('/api/shopify/orders-paid', raw, { 'x-shopify-hmac-sha256': sign(raw, 'wrong') }))
  check('(2) a webhook with a wrong signature is refused (401) and records nothing', bad.status === 401 && (await readWaiting(store, '1016')) === null)
  check('(2) a webhook with no signature is refused', (await C.webhook(post('/api/shopify/orders-paid', raw))).status === 401)
  const ok = await C.webhook(post('/api/shopify/orders-paid', raw, { 'x-shopify-hmac-sha256': sign(raw) }))
  const rec = await readWaiting(store, '1016')
  check('(2) a fake order-payment webhook for an ICHIREI order with no gift attached is recorded as a waiting order (200, never an error)', ok.status === 200 && (await jsonOf(ok)).waiting === true && !!rec && rec.status === 'waiting' && rec.source === 'webhook' && rec.email === 'buyer@example.com')
  const normal = JSON.stringify(webhookBody({ name: '#1018', line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: 'IC-20261113-ZZZZZZZZ' }] }] }))
  const ign = await C.webhook(post('/api/shopify/orders-paid', normal, { 'x-shopify-hmac-sha256': sign(normal) }))
  check('(2) a normal order (it carries our order reference) is acknowledged and ignored; a body that is not JSON is acknowledged too', ign.status === 200 && (await jsonOf(ign)).waiting === false && (await readWaiting(store, '1018')) === null && (await C.webhook(post('/api/shopify/orders-paid', 'nope', { 'x-shopify-hmac-sha256': sign('nope') }))).status === 200)
  await C.webhook(post('/api/shopify/orders-paid', raw, { 'x-shopify-hmac-sha256': sign(raw) }))
  check('(2) the same webhook twice (Shopify retries) keeps one record, and one index line', (await listWaiting(store)).length === 1 && (store.lines.get('ops/waiting.jsonl') ?? []).length === 1)
  check('(2) without a webhook secret the endpoint is "not configured" (503), never open', (await createClaimHandlers(() => ({ ...claimDeps(), webhookSecret: async () => '' })).webhook(post('/api/shopify/orders-paid', raw, { 'x-shopify-hmac-sha256': sign(raw) }))).status === 503)
}

// ---- 3. /claim: the check, constant-time, 5 tries an hour per IP ----------------------------------------------------------------------------------------------------
{
  const ask = (h: ReturnType<typeof createClaimHandlers>, order: string, email: string, ip = '1.1.1.1') => h.claim(post('/api/claim', JSON.stringify({ order, email }), {}, ip))
  const H = createClaimHandlers(claimDeps)
  const wrong = await ask(H, '#1016', 'someone@else.com')
  const wrongNo = await ask(H, '#9999', 'buyer@example.com')
  check('(3) a wrong e-mail, or an order number we have never seen, is the same plain refusal (404 not_found) — nothing says which half was wrong', wrong.status === 404 && wrongNo.status === 404 && JSON.stringify(await jsonOf(wrong)) === JSON.stringify(await jsonOf(wrongNo)))
  const right = await ask(H, ' ＃１０１６ ', ' Buyer@Example.COM ')
  const j = await jsonOf(right)
  check('(3) the right number and e-mail (case, spacing and full-width digits forgiven) open a claim: a token, the order name and the language', right.status === 200 && typeof j.token === 'string' && String(j.token).startsWith('CT-') && j.order === '#1016' && j.language === 'en')
  const after = (await readWaiting(store, '1016'))!
  check('(3) only a hash of the token is kept, with an expiry 24 hours ahead', !JSON.stringify(after).includes(String(j.token)) && !!after.session && Date.parse(after.session.expires_at) === NOW.getTime() + 24 * 3_600_000)
  check('(3) a match never works on a record that is already claimed, and an unreadable body is the same refusal', matchClaim({ ...after, status: 'claimed' }, '1016', 'buyer@example.com') === null && (await H.claim(post('/api/claim', '{"order":1,"email":2}'))).status === 404)
  // rate limit: 5 tries an hour per IP — every try counts, the sixth is refused even with the right details
  const R = createClaimHandlers(claimDeps)
  const codes: number[] = []
  for (let i = 0; i < 5; i++) codes.push((await ask(R, '#1016', 'nope@nope.com', '7.7.7.7')).status)
  const sixth = await ask(R, '#1016', 'buyer@example.com', '7.7.7.7')
  check('(3) five wrong tries from one IP are answered 404, the sixth — even with the RIGHT details — is refused 429 rate_limited', codes.every((c) => c === 404) && sixth.status === 429 && (await jsonOf(sixth)).code === 'rate_limited')
  check('(3) another IP is not affected', (await ask(R, '#1016', 'buyer@example.com', '8.8.8.8')).status === 200)
  let later = NOW
  const R2 = createClaimHandlers(() => ({ ...claimDeps(), now: () => later }))
  for (let i = 0; i < 5; i++) await ask(R2, '#1016', 'nope@nope.com', '6.6.6.6')
  later = new Date(NOW.getTime() + 61 * 60_000)
  check('(3) …and the brake lets go an hour later', (await R2.claim(new Request('https://x/api/claim', { method: 'POST', headers: { 'x-forwarded-for': '6.6.6.6' }, body: JSON.stringify({ order: '#1016', email: 'buyer@example.com' }) }))).status !== 429)
}

// ---- 3b. never seen by the webhook: /claim asks Shopify (read-only) about the one order ---------------------------------------------------------------------------
{
  const calls: { url: string; body: string }[] = []
  const nodes = [{ name: '#1020', email: 'late@buyer.com', createdAt: '2026-11-13T01:00:00Z', displayFinancialStatus: 'PAID', customerLocale: 'zh-TW', currentTotalPriceSet: { shopMoney: { amount: '2786.0', currencyCode: 'JPY' } }, lineItems: { nodes: [{ sku: 'ICHIREI-EGIFT', customAttributes: [] }] }, transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-11-13T01:01:00Z' }] }, { name: '#10200', email: 'x@y.co', createdAt: '2026-11-13T01:00:00Z', displayFinancialStatus: 'PAID', lineItems: { nodes: [{ sku: 'ICHIREI-EGIFT', customAttributes: [] }] } }]
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body ?? '') })
    if (String(url).includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
    return new Response(JSON.stringify({ data: { orders: { nodes, pageInfo: { hasNextPage: false } } } }))
  }) as typeof fetch
  admin = { config: { storeDomain: 'x', apiVersion: '2025-01', clientId: 'cid', apiBase: 'https://shopify.test' }, secret: async () => 'sec', fetchImpl }
  const H = createClaimHandlers(claimDeps)
  const r = await H.claim(post('/api/claim', JSON.stringify({ order: '#1020', email: 'late@buyer.com' }), {}, '4.4.4.4'))
  const rec = await readWaiting(store, '1020')
  check('(3b) an order the webhook never told us about is found in Shopify (read-only: one QUERY, no mutation), recorded as a waiting order, and the claim opens', r.status === 200 && !!rec && rec.source === 'claim_lookup' && rec.language === 'zh-Hant' && calls.some((c) => c.body.includes('name:#1020')) && !calls.some((c) => /mutation/.test(c.body)))
  check('(3b) the fuzzy search result "#10200" is not taken for "#1020", and an order Shopify does not know is the same plain refusal', (await lookupWaiting(store, admin, new AdminTokenCache(), '1021', NOW)) === null && (await H.claim(post('/api/claim', JSON.stringify({ order: '#1021', email: 'late@buyer.com' }), {}, '4.4.4.5'))).status === 404)
  const before = (await listWaiting(store)).length
  const swept = await sweepWaiting(store, admin, new AdminTokenCache(), NOW)
  check('(3b) /ops asks Shopify (read-only) for the last two weeks and records the waiting orders it has not seen (a record that exists is never touched)', swept !== null && (await listWaiting(store)).length >= before && calls.some((c) => c.body.includes('created_at:>=')))
  check('(3b) without the read-only app configured, or when Shopify cannot be asked, nothing is found — and nothing breaks', (await sweepWaiting(store, null, new AdminTokenCache(), NOW)) === null && (await lookupWaiting(store, null, new AdminTokenCache(), '5555', NOW)) === null)
  admin = null
}

// ---- 4. the claim makes a normal gift with no second payment; the 24 hours start at the claim ------------------------------------------------------------------------
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const orderBody = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', inscription_style: 'modern', sender_name: '山田 太郎', receiver_name: '山田 一郎', package: 'egift', delivery_date: '2026-12-25', refund_ack_at: NOW.toISOString(), ...over })
let CLAIM_NOW = new Date(NOW.getTime() + 2 * 3_600_000)
const carts: string[] = []
const orderDeps = (): OrderDeps => ({ store, shopify: null, shopifyMissing: ['SHOPIFY_STOREFRONT_TOKEN'], now: () => CLAIM_NOW, env: { ICHIREI_WOOD_SIZES: 'coming_soon' } as NodeJS.ProcessEnv, fetchImpl: (async (u: string) => { carts.push(String(u)); return new Response('{}') }) as typeof fetch, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) as never, filmWaitMs: 50 })
const place = async (b: unknown) => { const r = await createOrderHandler(orderDeps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: await jsonOf(r) } }
let claimRef = ''
{
  const open = await createClaimHandlers(() => ({ ...claimDeps(), now: () => CLAIM_NOW })).claim(post('/api/claim', JSON.stringify({ order: '#1016', email: 'buyer@example.com' }), {}, '2.2.2.2'))
  const token = String((await jsonOf(open)).token)
  const bad = await place(orderBody({ claim: { order: '#1016', token: 'CT-wrongwrongwrongwrongwrong' } }))
  check('(4) a claim with a wrong token is refused (403 claim_invalid) and makes nothing', bad.status === 403 && bad.json.code === 'claim_invalid' && (await readWaiting(store, '1016'))!.status === 'waiting')
  const wood = await place(orderBody({ package: 'simple', claim: { order: '#1016', token } }))
  check('(4) a claim only makes the e-gift (a wood size is refused) — and the refusal does not use up the claim', wood.status === 400 && (await readWaiting(store, '1016'))!.status === 'waiting')
  const ok = await place(orderBody({ claim: { order: '#1016', token } }))
  const rec = (await store.get(String(ok.json.order_ref))) as OrderRecord
  check('(4) the chosen character is attached to the existing order: 200, a gift page and a buyer page, NO checkout, and Shopify is never asked (no cart is made, no second payment)', ok.status === 200 && ok.json.claimed === true && !ok.json.checkout_url && typeof ok.json.animation_url === 'string' && typeof ok.json.gift_url === 'string' && carts.length === 0)
  check('(4) the order record is a normal one with the claim on it: status "claimed", the Shopify order #1016, the claim time and what was paid — and no e-mail', rec.status === 'claimed' && rec.claim?.order_name === '#1016' && rec.claim.claimed_at === CLAIM_NOW.toISOString() && rec.claim.paid_at === '2026-11-12T20:00:00.000Z' && rec.claim.amount_jpy === 2786 && !JSON.stringify(rec).includes('buyer@example.com') && !!rec.gift_token && !!rec.animation_id && rec.collect_required === true)
  const w = (await readWaiting(store, '1016'))!
  check('(4) the waiting order is now "claimed", points at the order, and holds no token', w.status === 'claimed' && w.order_ref === rec.order_ref && w.claimed_at === CLAIM_NOW.toISOString() && !w.session)
  const again = await place(orderBody({ claim: { order: '#1016', token } }))
  check('(4) a second try with the same token (another tab, a double tap) is refused: one gift per order', again.status === 403 && again.json.code === 'claim_invalid')
  claimRef = rec.order_ref
  // the 24 hours
  const win = (n: number) => windowOf(rec, null, new Date(CLAIM_NOW.getTime() + n * 3_600_000))
  check('(4) the 24-hour window counts from the CLAIM, not from payment: open at +23 h (1 hour left), closed at +25 h — though Shopify paid the order two days earlier', win(0).phase === 'open' && win(0).paid_at === CLAIM_NOW.toISOString() && win(23).phase === 'open' && win(23).hours_left === 1 && win(25).phase === 'closed')
  check('(4) a claimed order the owner cancelled shows as cancelled', windowOf({ ...rec, ops: { cancelled_at: NOW.toISOString() } } as OrderRecord, null, CLAIM_NOW).phase === 'cancelled')
  // a claim that cannot be saved is given back
  const expired = await createClaimHandlers(() => ({ ...claimDeps(), now: () => CLAIM_NOW })).claim(post('/api/claim', JSON.stringify({ order: '#1016', email: 'buyer@example.com' }), {}, '2.2.2.3'))
  check('(4) a claimed order can not be claimed again with its e-mail either', expired.status === 404)
}
{
  // a session that has expired (24 h) opens nothing
  const raw = JSON.stringify(webhookBody({ name: '#1030' }))
  await C.webhook(post('/api/shopify/orders-paid', raw, { 'x-shopify-hmac-sha256': sign(raw) }))
  const t0 = new Date(NOW.getTime())
  const o = await createClaimHandlers(() => ({ ...claimDeps(), now: () => t0 })).claim(post('/api/claim', JSON.stringify({ order: '#1030', email: 'buyer@example.com' }), {}, '3.3.3.3'))
  CLAIM_NOW = new Date(t0.getTime() + 25 * 3_600_000)
  const late = await place(orderBody({ claim: { order: '#1030', token: String((await jsonOf(o)).token) } }))
  check('(4) a claim session older than 24 hours is refused (the buyer enters the number and e-mail again)', late.status === 403 && (await readWaiting(store, '1030'))!.status === 'waiting')
  CLAIM_NOW = new Date(NOW.getTime() + 2 * 3_600_000)
}

// ---- 5. after 7 days: refund due; before: days left -------------------------------------------------------------------------------------------------------------
{
  const w = (await readWaiting(store, '1030'))!
  const at = (d: number) => waitingState(w, new Date(Date.parse(w.paid_at) + d * 86_400_000))
  check(`(5) a waiting order shows "days left" until day ${WAITING_DAYS}: day 0 → 7 left, day 3.5 → 4 left, day 6.5 → 1 left`, JSON.stringify(at(0)) === '{"state":"waiting","days_left":7}' && (at(3.5) as { days_left: number }).days_left === 4 && (at(6.5) as { days_left: number }).days_left === 1)
  check('(5) from day 7 on — day 8 included — it is "refund due"; a claimed order is never refund due', at(7).state === 'refund_due' && at(8).state === 'refund_due' && waitingState({ ...w, status: 'claimed' }, days(30)).state === 'claimed')
  // /ops lists it with the words of the owner
  const ENV = { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv
  const opsFor = (now: Date) => createOpsHandlers((): OpsDeps => ({ store, env: ENV, now: () => now, payments: async () => ({ found: new Map(), failure: null }), shipping: async () => ({ found: new Map(), failure: null }), sweep: async () => null }))
  const authz = { authorization: 'Basic ' + Buffer.from('owner:pw').toString('base64') }
  const paid1030 = Date.parse(w.paid_at)
  const day3 = await (await opsFor(new Date(paid1030 + 3 * 86_400_000)).page(new Request('https://x/ops', { headers: authz }))).text()
  const day8 = await (await opsFor(new Date(paid1030 + 8 * 86_400_000)).page(new Request('https://x/ops', { headers: authz }))).text()
  check('(5) /ops on day 3 shows 「未作成（あと4日）」 for the waiting order; on day 8 it shows 「未作成・返金対象」 and says the refund is by hand (no automatic refund)', day3.includes('未作成（あと4日）') && day8.includes('未作成・返金対象') && day8.includes('#1030') && day8.includes('Shopifyで手動で返金'))
  check('(5) …the claimed order #1016 shows as 作成済み, and /ops shows no e-mail address of any buyer', day8.includes('作成済み') && !day8.includes('buyer@example.com'))
  // /ops/stats
  const D = statsDicts()
  check('(5) /ops/stats words, in all four languages: 「未作成（あと◯日）」 · "Not created ({d} days left)" · 「未建立（剩◯天）」 · 「未作成・返金対象」 · "Not created: refund due" · 「未建立・需退款」 (zh-Hans = the zh-Hant through OpenCC)', D.ja.status_waiting === '未作成（あと{d}日）' && D.en.status_waiting === 'Not created ({d} days left)' && D['zh-Hant'].status_waiting === '未建立（剩{d}天）' && D.ja.status_refund_due === '未作成・返金対象' && D.en.status_refund_due === 'Not created: refund due' && D['zh-Hant'].status_refund_due === '未建立・需退款' && D['zh-Hans'].status_refund_due === '未创建・需退款' && D['zh-Hans'].status_waiting === '未创建（剩{d}天）')
  check('(5) …every dashboard key exists in every language (the new two included)', STATS_KEYS.includes('status_waiting') && STATS_KEYS.includes('status_refund_due') && (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((l) => STATS_KEYS.every((k) => typeof D[l][k] === 'string')))
  const P8 = await buildStats({ store, env: ENV, now: () => new Date(paid1030 + 8 * 86_400_000), payments: async () => ({ found: new Map(), failure: null }) }, store, ENV, new Date(paid1030 + 8 * 86_400_000))
  const row = P8.orders.find((o) => o.order_ref === 'WO-1030')
  const P3 = await buildStats({ store, env: ENV, now: () => new Date(paid1030 + 3 * 86_400_000), payments: async () => ({ found: new Map(), failure: null }) }, store, ENV, new Date(paid1030 + 3 * 86_400_000))
  check('(5) /ops/stats lists the waiting order as "refund_due" on day 8 and "waiting (4 days left)" on day 3 — and it is not in the paid count or the revenue', row?.state === 'refund_due' && P3.orders.find((o) => o.order_ref === 'WO-1030')?.state === 'waiting' && P3.orders.find((o) => o.order_ref === 'WO-1030')?.days_left === 4 && P8.stats.periods.all.revenue_jpy === 2786 && P8.stats.periods.all.paid === 1 && !P8.orders.some((o) => o.order_ref === 'WO-1016') && P8.orders.some((o) => o.order_ref === claimRef && o.state === 'paid' && o.price_jpy === 2786))
}

// ---- 6. revenue = what the order actually paid ---------------------------------------------------------------------------------------------------------------------
{
  const mk = (ref: string, over: Partial<OrderRecord> = {}): OrderRecord => {
    const p = parseOrderRequest(orderBody({ package: 'egift' }), NOW)
    if (!p.ok) throw new Error(p.error)
    return { ...buildRecord(p.order, ref, NOW), ...over } as OrderRecord
  }
  const entry = (ref: string) => ({ ts: NOW.toISOString(), order_ref: ref, token: null, size_code: 'ICHIREI-EGIFT', ship_to: 'none' as const, memorial: false, delivery_date: '2026-12-01' })
  const rec = mk('IC-20261114-SALESALE')
  const sale = orderStatOf(entry(rec.order_ref), rec, { state: 'paid', paid_at: NOW.toISOString(), amount_jpy: 2786 } as PaymentInfo, new Set(), NOW)
  const noAmount = orderStatOf(entry(rec.order_ref), rec, { state: 'paid', paid_at: NOW.toISOString() }, new Set(), NOW)
  check('(6) an order paid at the sale price counts ¥2,786 (the amount from the Shopify order), not the package price ¥3,980; with no amount from Shopify the package price is the fallback', sale?.price_jpy === 2786 && noAmount?.price_jpy === 3980)
  const claimed = mk('IC-20261114-CLAIMED1', { claim: { order_name: '#1016', claimed_at: NOW.toISOString(), paid_at: days(-2).toISOString(), amount_jpy: 2786 } })
  const cs = orderStatOf(entry(claimed.order_ref), claimed, null, new Set(), NOW)
  check('(6) a claimed order is a paid order at what that Shopify order paid (¥2,786), dated by its payment', cs?.state === 'paid' && cs.price_jpy === 2786 && cs.paid_at === days(-2).toISOString())
  const S = new MemoryOrderStore()
  const refs = ['IC-20261114-AAAAAAA1', 'IC-20261114-BBBBBBB2']
  await S.put(refs[0], mk(refs[0]))
  await S.put(refs[1], mk(refs[1]))
  for (const r of refs) await S.appendJsonl('ops/orders-2026-11-14.jsonl', entry(r))
  const pays = new Map<string, PaymentInfo>([[refs[0], { state: 'paid', paid_at: NOW.toISOString(), amount_jpy: 2786 }], [refs[1], { state: 'paid', paid_at: NOW.toISOString(), amount_jpy: 3980 }]])
  const P = await buildStats({ store: S, env: { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, now: () => NOW, payments: async () => ({ found: pays, failure: null }) }, S, { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, NOW)
  check('(6) /ops/stats revenue is the sum of the amounts actually paid (¥2,786 + ¥3,980 = ¥6,766), not 2 × the package price', P.stats.periods.all.revenue_jpy === 6766 && P.stats.periods.all.paid === 2)
}

// ---- 7. the Liquid snippet -------------------------------------------------------------------------------------------------------------------------------------
{
  const engine = new Liquid({ strictVariables: false })
  const NEW = readFileSync('docs/ichirei-order-email.liquid', 'utf8')
  const OLD = execSync('git show HEAD:docs/ichirei-order-email.liquid', { encoding: 'utf8' })
  const SNIP = readFileSync('docs/shopify-email-claim-snippet.liquid', 'utf8')
  const run = (src: string, lines: unknown[], order: Record<string, unknown> = { name: '#1016', locale: 'en' }) => engine.parseAndRenderSync(src, { subtotal_line_items: lines, order })
  const normal = (lang: string) => ({ sku: 'ICHIREI-EGIFT', properties: { _kanji: '憶', _inscription_form: '憶', _language: lang, _order_ref: 'IC-20261105-ABCDEFGH', _ichirei_animation_url: 'https://ichirei.soul-id.jp/a/AN-abcdefghijkmnpqrstuv' } })
  check('(7) a normal ICHIREI order (it has the gift reference) renders EXACTLY as before, in all four languages (the block of the previous release, byte for byte)', ['ja', 'zh-Hant', 'zh-Hans', 'en'].every((l) => run(NEW, [normal(l)]) === run(OLD, [normal(l)]) && run(NEW, [normal(l)]).includes('/a/AN-')))
  check('(7) another product renders exactly as before (nothing)', run(NEW, [{ sku: 'TSHIRT-M', properties: {} }]).trim() === '' && run(NEW, [{ sku: 'MUG-1', properties: { language: 'ja' } }]) === run(OLD, [{ sku: 'MUG-1', properties: { language: 'ja' } }]))
  const waitingLine = { sku: 'ICHIREI-EGIFT', properties: {} }
  const en = run(NEW, [waitingLine], { name: '#1016', locale: 'en' })
  const ja = run(NEW, [waitingLine], { name: '#1016', locale: 'ja' })
  const zh = run(NEW, [waitingLine], { name: '#1016', locale: 'zh-TW' })
  const zhs = run(NEW, [waitingLine], { name: '#1016', locale: 'zh-CN' })
  check('(7) a waiting order (ICHIREI line, no gift reference) shows the line and the link, in en', en.includes("Your gift isn't made yet. Write your story and choose the character here:") && en.includes('https://ichirei.soul-id.jp/claim?o=%231016'))
  check('(7) …in ja 「贈りものは、まだできていません。こちらから物語を書いて、字を選んでください：」 and zh-Hant 「禮物還沒有完成。請從這裡寫下故事、選出那個字：」 (zh-Hans through OpenCC)', ja.includes('贈りものは、まだできていません。こちらから物語を書いて、字を選んでください：') && zh.includes('禮物還沒有完成。請從這裡寫下故事、選出那個字：') && zhs.includes('礼物还没有完成。请从这里写下故事、选出那个字：') && ja.includes('claim?o=%231016') && zh.includes('claim?o=%231016'))
  check('(7) …and nothing of the normal block (no "your gift is ready" button, no 24-hour line, no character line) for that line', !en.includes('/a/AN-') && !/Open your order page|Within 24 hours|Character:/.test(en) && !ja.includes('ご注文ページを開く'))
  check('(7) an order number with a # is url-encoded (%23) in the link; a line with its own _language property wins over the order locale', run(NEW, [{ sku: 'ICHIREI-EGIFT', properties: { _language: 'ja' } }], { name: '#1016', locale: 'en' }).includes('贈りものは、まだできていません') && /claim\?o=%23\d+/.test(en))
  check('(7) one waiting line and one normal line in the same order: each gets its own text', (() => { const both = run(NEW, [normal('en'), waitingLine]); return both.includes('Open your order page') && both.includes("Your gift isn't made yet") })())
  check('(7) the snippet file itself holds the same text that is pasted into the block (one source of truth), and DEPLOY.md carries the updated block', NEW.includes(SNIP.slice(SNIP.indexOf("{%- if ichirei_ref == blank")).trim().split('\n')[0].trim()) && readFileSync('DEPLOY.md', 'utf8').includes(NEW.trim()))
}

// ---- 8. the sale -----------------------------------------------------------------------------------------------------------------------------------------------
{
  check('(8) 30% off ¥3,980 = ¥2,786, rounded DOWN to the yen (¥3,980 × 0.7 = 2,786 exactly; ¥3,999 → ¥2,799.3 → ¥2,799)', salePriceJpy(3980, 30) === 2786 && salePriceJpy(3999, 30) === 2799 && salePriceJpy(100, 15) === 85 && salePriceJpy(3333, 33) === 2233)
  const sale = parseSale('30', '2026-11-30', NOW)!
  check('(8) SALE_PERCENT=30 and SALE_UNTIL=2026-11-30 make a sale that lasts to the end of 30 November in Japan', sale.percent === 30 && sale.until === '2026-11-30' && sale.ends_at === '2026-11-30T14:59:59.999Z' && parseSale('30', '2026-11-30', new Date('2026-11-30T14:59:00Z')) !== null && parseSale('30', '2026-11-30', new Date('2026-11-30T15:00:00Z')) === null)
  check('(8) empty settings, a percent with no date, a date with no percent, a bad percent (0, 95, text) or an impossible date make NO sale', parseSale('', '', NOW) === null && parseSale('30', '', NOW) === null && parseSale('', '2026-11-30', NOW) === null && parseSale('0', '2026-11-30', NOW) === null && parseSale('95', '2026-11-30', NOW) === null && parseSale('abc', '2026-11-30', NOW) === null && parseSale('30', '2026-02-30', NOW) === null && parseSale(undefined, undefined, NOW) === null)
  check('(8) the line, ja: 「感謝の季節に、30％オフ（11月30日まで）」', saleLine(sale, 'ja') === '感謝の季節に、30％オフ（11月30日まで）')
  check('(8) the line, zh-Hant: 「感恩季節，七折優惠（至11月30日）」 (30% off = 七折; 20% off = 八折; 15% off = 8.5折)', saleLine(sale, 'zh-Hant') === '感恩季節，七折優惠（至11月30日）' && saleLine({ ...sale, percent: 20 }, 'zh-Hant').includes('八折') && saleLine({ ...sale, percent: 15 }, 'zh-Hant').includes('8.5折'))
  check('(8) the line, en: "Thanksgiving: 30% off until November 30"', saleLine(sale, 'en') === 'Thanksgiving: 30% off until November 30')
  const on = await jsonOf(sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', SALE_PERCENT: '30', SALE_UNTIL: '2026-11-30' } as NodeJS.ProcessEnv, NOW))
  check('(8) /api/sizes carries the sale while it is on (percent, last day, end instant) — and the page reads it back the same', JSON.stringify(on.sale) === JSON.stringify(sale) && JSON.stringify(cleanSale(on)) === JSON.stringify(sale))
  const off = await jsonOf(sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', SALE_PERCENT: '', SALE_UNTIL: '' } as NodeJS.ProcessEnv, NOW))
  const over = await jsonOf(sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', SALE_PERCENT: '30', SALE_UNTIL: '2026-11-30' } as NodeJS.ProcessEnv, new Date('2026-12-01T00:00:00Z')))
  check('(8) with the settings empty, or after SALE_UNTIL, /api/sizes has no sale: everything disappears by itself', !('sale' in off) && !('sale' in over) && cleanSale(off) === null)
  check('(8) a page left open drops the sale at its last moment (saleOn)', saleOn(sale, new Date('2026-11-30T14:59:59Z')) !== null && saleOn(sale, new Date('2026-11-30T15:00:01Z')) === null && saleOn(null) === null)
  // SALE_FROM: the sale shows only from SALE_FROM 00:00 to SALE_UNTIL 23:59, Japan time
  const owner = parseSale('30', '2026-11-30', new Date('2026-11-14T00:00:00Z'), '2026-11-20')!
  check('(8) SALE_FROM=2026-11-20 SALE_UNTIL=2026-11-30 SALE_PERCENT=30 (the owner\'s dates): the window is 20 Nov 00:00 JST to 30 Nov 23:59:59 JST', owner.percent === 30 && owner.from === '2026-11-20' && owner.until === '2026-11-30' && owner.starts_at === '2026-11-19T15:00:00.000Z' && owner.ends_at === '2026-11-30T14:59:59.999Z')
  check('(8) …nothing shows the minute before 00:00 on the 20th, it shows from 00:00, it still shows at 23:59 on the 30th, and nothing from 00:00 on 1 December', saleOn(owner, new Date('2026-11-19T14:59:59Z')) === null && saleOn(owner, new Date('2026-11-19T15:00:00Z')) !== null && saleOn(owner, new Date('2026-11-30T14:59:59Z')) !== null && saleOn(owner, new Date('2026-11-30T15:00:00Z')) === null)
  check('(8) a SALE_FROM after SALE_UNTIL, or one that is not a date, makes no sale; an empty SALE_FROM means "from now" (the earlier behaviour)', parseSale('30', '2026-11-30', NOW, '2026-12-01') === null && parseSale('30', '2026-11-30', NOW, 'soon') === null && parseSale('30', '2026-11-30', NOW, '2026-02-30') === null && saleOn(parseSale('30', '2026-11-30', NOW, ''), NOW) !== null && parseSale('30', '2026-11-30', NOW, '2026-11-30') !== null)
  const env = { SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', SALE_PERCENT: '30', SALE_FROM: '2026-11-20', SALE_UNTIL: '2026-11-30' } as NodeJS.ProcessEnv
  const early = await jsonOf(sizesResponse(env, new Date('2026-11-14T03:00:00Z')))
  const mid = await jsonOf(sizesResponse(env, new Date('2026-11-25T03:00:00Z')))
  const late = await jsonOf(sizesResponse(env, new Date('2026-12-01T03:00:00Z')))
  check('(8) /api/sizes before the 20th hands the page the coming sale, but the page shows nothing yet (saleOn is null); on the 25th it shows; after the 30th the server sends no sale at all', cleanSale(early)?.from === '2026-11-20' && saleOn(cleanSale(early), new Date('2026-11-14T03:00:00Z')) === null && saleOn(cleanSale(mid), new Date('2026-11-25T03:00:00Z')) !== null && !('sale' in late))
  const cb = readFileSync('cloudbuild.yaml', 'utf8')
  check('(8) the settings are Cloud Build substitutions with the owner\'s dates as the defaults (30, 2026-11-15, 2026-11-30; the English end 2026-12-01T13:59+09:00), passed to the service as SALE_PERCENT, SALE_FROM, SALE_UNTIL and SALE_UNTIL_EN', /_SALE_PERCENT: '30'/.test(cb) && /_SALE_FROM: '2026-11-15'/.test(cb) && /_SALE_UNTIL: '2026-11-30'/.test(cb) && /_SALE_UNTIL_EN: '2026-12-01T13:59\+09:00'/.test(cb) && cb.includes('SALE_PERCENT=${_SALE_PERCENT},SALE_FROM=${_SALE_FROM},SALE_UNTIL=${_SALE_UNTIL},SALE_UNTIL_EN=${_SALE_UNTIL_EN}'))
}

// ---- 9. /claim words -----------------------------------------------------------------------------------------------------------------------------------------------
{
  check('(9) /claim labels, ja: 「ご注文番号」「ご注文時のメールアドレス」 · zh-Hant: 「訂單編號」「下單時的電子郵件」 · en: "Order number", "Email used at checkout"', CLAIM_COPY.ja.orderLabel === 'ご注文番号' && CLAIM_COPY.ja.emailLabel === 'ご注文時のメールアドレス' && CLAIM_COPY['zh-Hant'].orderLabel === '訂單編號' && CLAIM_COPY['zh-Hant'].emailLabel === '下單時的電子郵件' && CLAIM_COPY.en.orderLabel === 'Order number' && CLAIM_COPY.en.emailLabel === 'Email used at checkout')
  check('(9) "not found", ja: 「ご注文が見つかりません。番号とメールアドレスをご確認ください。」 · zh-Hant: 「找不到訂單，請確認訂單編號與電子郵件。」 · en: "We couldn\'t find that order. Please check the number and email."', CLAIM_COPY.ja.errors.notFound === 'ご注文が見つかりません。番号とメールアドレスをご確認ください。' && CLAIM_COPY['zh-Hant'].errors.notFound === '找不到訂單，請確認訂單編號與電子郵件。' && CLAIM_COPY.en.errors.notFound === "We couldn't find that order. Please check the number and email.")
  check('(9) the link from the e-mail (?o=%231016) fills the order number; nothing odd gets through', orderFromSearch('?o=%231016') === '#1016' && orderFromSearch('?o=1016') === '#1016' && orderFromSearch('?o=<script>') === '' && orderFromSearch('') === '')
  check('(9) no customer string on the page says "AI"', Object.values(CLAIM_COPY).every((c) => !/\bAI\b|人工知能/.test(JSON.stringify(c))))
}

console.log(failures === 0 ? '\nAll waiting-order and sale checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
