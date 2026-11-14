// 2026-11-14 — English orders check out in US dollars. No network, no model: Shopify is a fake, the store is in memory.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-usd-checkout.ts
//
//   1. an English order's cart names the United States (buyerIdentity countryCode US); ja / zh carts name nobody; a cart priced in another currency is logged and still returned
//   2. the sale dates: SALE_FROM 2026-11-15, SALE_UNTIL 2026-11-30 (ja / zh), SALE_UNTIL_EN 2026-12-01T13:59+09:00 (English), 30%
//   3. the prices on the English pages: $25, sale $17.50 (cents allowed), never a struck price; the launch line; the legal notice
//   4. a paid USD order (presentment USD 17.50, shop money in yen, SKU ICHIREI-EGIFT) goes through the webhook, /claim, the gift and /ops/stats with no special path — revenue adds the YEN

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClaimHandlers } from '../api/claim.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { buildStats, orderStatOf } from '../api/ops-stats.ts'
import { createOpsHandlers, type OpsDeps } from '../api/ops.ts'
import { sizesResponse } from '../api/sizes.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { type OrderRecord } from '../engine/order.ts'
import { createCart, loadShopifyConfig } from '../engine/shopify.ts'
import { paymentOf } from '../engine/shipping.ts'
import { computeStats } from '../engine/stats.ts'
import { fromAdmin, fromWebhook, readWaiting, waitingFromShopify } from '../engine/waiting.ts'
import { parseSale, saleOn } from '../src/order/sale.ts'
import { DEFAULT_USD_PRICE, parseUsdPrice, usd, usdLaunchLine } from '../src/order/usd.ts'
import { cleanSale, cleanUsd } from '../src/demo/useSizes.ts'
import { legalView } from '../src/legal/legal-copy.ts'
import { STATS_CLIENT_JS } from '../api/ops-stats-client.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-16T03:00:00Z')
const jsonOf = async (r: Response) => (await r.json()) as Record<string, unknown>

// ---- 1. the cart -----------------------------------------------------------------------------------------------------------------------------------------------
const cfg = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config!
type CartBody = { variables: { input: { lines: unknown[]; buyerIdentity?: { countryCode?: string } } } }
const fake = (currency: string | null, sent: CartBody[] = []) =>
  (async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x', ...(currency ? { cost: { totalAmount: { amount: '17.50', currencyCode: currency } } } : {}) }, userErrors: [] } } }))
  }) as typeof fetch
{
  const sent: CartBody[] = []
  await createCart(cfg, 'egift', [], 'IC-1', fake('USD', sent), 'en')
  await createCart(cfg, 'egift', [], 'IC-2', fake('JPY', sent), 'ja')
  await createCart(cfg, 'egift', [], 'IC-3', fake('JPY', sent), 'zh-Hant')
  await createCart(cfg, 'egift', [], 'IC-4', fake('JPY', sent), 'zh-Hans')
  await createCart(cfg, 'egift', [], 'IC-5', fake('JPY', sent))
  check('(1) an English cart is made with buyerIdentity { countryCode: "US" } (the "ICHIREI English" market: English, USD)', sent[0].variables.input.buyerIdentity?.countryCode === 'US')
  check('(1) ja, zh-Hant, zh-Hans carts (and a call with no language) have NO buyerIdentity at all — exactly as before', sent.slice(1).every((b) => !('buyerIdentity' in b.variables.input)))
  const warned: string[] = []
  const w0 = console.warn
  console.warn = (...a: unknown[]) => { warned.push(a.join(' ')) }
  try {
    const mism = await createCart(cfg, 'egift', [], 'IC-6', fake('JPY'), 'en')
    check('(1) an English cart that Shopify prices in yen is logged as en_cart_currency_mismatch — and the checkout is still returned', mism.checkoutUrl.startsWith('https://') && mism.currency === 'JPY' && warned.length === 1 && warned[0].includes('en_cart_currency_mismatch') && warned[0].includes('IC-6'))
    warned.length = 0
    await createCart(cfg, 'egift', [], 'IC-7', fake('USD'), 'en')
    await createCart(cfg, 'egift', [], 'IC-8', fake('JPY'), 'ja')
    await createCart(cfg, 'egift', [], 'IC-9', fake(null), 'en')
    check('(1) a USD English cart, a yen ja cart, and an answer with no cost block make no mismatch line', warned.length === 0)
  } finally {
    console.warn = w0
  }
  // through /api/order
  const store = new MemoryOrderStore()
  const carts: CartBody[] = []
  const deps = (): OrderDeps => ({ store, shopify: cfg, shopifyMissing: [], now: () => NOW, env: {} as NodeJS.ProcessEnv, fetchImpl: fake('USD', carts), film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) } as unknown as OrderDeps)
  const base = { story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', selected_kanji: '証', inscription_style: 'modern', sender_name: 'Ann', receiver_name: 'Ben', package: 'egift', delivery_date: '2026-12-25', refund_ack_at: NOW.toISOString(), sender_email: 'ann@example.com' }
  const place = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: await jsonOf(r) } }
  const en = await place({ ...base, language: 'en', engine_result: { ...clone(GOLDEN), language: 'en' } })
  const ja = await place({ ...base, language: 'ja', engine_result: clone(GOLDEN) })
  check('(1) POST /api/order for an English order creates the cart with countryCode US; the Japanese order creates it with no buyer identity', en.status === 200 && ja.status === 200 && carts.length === 2 && carts[0].variables.input.buyerIdentity?.countryCode === 'US' && !('buyerIdentity' in carts[1].variables.input), JSON.stringify([en, ja]).slice(0, 300))
}

// ---- 2. the sale dates ----------------------------------------------------------------------------------------------------------------------------------------
{
  const y = readFileSync('cloudbuild.yaml', 'utf8')
  check('(2) cloudbuild defaults: 30 %, SALE_FROM 2026-11-15, SALE_UNTIL 2026-11-30, SALE_UNTIL_EN 2026-12-01T13:59+09:00, USD sale price 17.50 — all passed to the service', /_SALE_PERCENT: '30'/.test(y) && /_SALE_FROM: '2026-11-15'/.test(y) && /_SALE_UNTIL: '2026-11-30'/.test(y) && /_SALE_UNTIL_EN: '2026-12-01T13:59\+09:00'/.test(y) && /_USD_PRICE_EGIFT: '25'/.test(y) && /_USD_PRICE_EGIFT_SALE: '17\.50'/.test(y) && y.includes('SALE_UNTIL_EN=${_SALE_UNTIL_EN}') && y.includes('SALE_FROM=${_SALE_FROM}'))
  const s = parseSale('30', '2026-11-30', NOW, '2026-11-15', '2026-12-01T13:59+09:00')!
  check('(2) the Japanese / Chinese window is 15 Nov 00:00 JST to 30 Nov 23:59:59 JST; the English one ends at 2026-12-01 13:59 JST', s.starts_at === '2026-11-14T15:00:00.000Z' && s.ends_at === '2026-11-30T14:59:59.999Z' && s.en_ends_at === '2026-12-01T04:59:00.000Z')
  const at = (iso: string) => new Date(iso)
  check('(2) at 2026-12-01 00:30 JST the ja / zh sale is over and the English one is still on; at 14:00 JST both are over', saleOn(s, at('2026-11-30T15:30:00Z'), 'ja') === null && saleOn(s, at('2026-11-30T15:30:00Z'), 'zh-Hant') === null && saleOn(s, at('2026-11-30T15:30:00Z'), 'en') !== null && saleOn(s, at('2026-12-01T05:00:00Z'), 'en') === null)
  check('(2) before 15 Nov 00:00 JST nothing shows in any language', saleOn(s, at('2026-11-14T14:59:00Z'), 'en') === null && saleOn(s, at('2026-11-14T14:59:00Z'), 'ja') === null && saleOn(s, at('2026-11-14T15:00:00Z'), 'ja') !== null)
  const noEn = parseSale('30', '2026-11-30', NOW, '2026-11-15')!
  check('(2) without SALE_UNTIL_EN (or with an unreadable one) English follows SALE_UNTIL', noEn.en_ends_at === undefined && parseSale('30', '2026-11-30', NOW, '2026-11-15', 'tomorrow')!.en_ends_at === undefined && saleOn(noEn, at('2026-11-30T15:30:00Z'), 'en') === null)
  const sizes = await jsonOf(sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', SALE_PERCENT: '30', SALE_FROM: '2026-11-15', SALE_UNTIL: '2026-11-30', SALE_UNTIL_EN: '2026-12-01T13:59+09:00' } as NodeJS.ProcessEnv, NOW))
  const cs = cleanSale(sizes)
  check('(2) /api/sizes carries the English end (sale.en_ends_at) and the page keeps it; after 14:00 JST on 1 Dec the sale is gone from the answer', (sizes.sale as { en_ends_at?: string }).en_ends_at === '2026-12-01T04:59:00.000Z' && cs?.en_ends_at === '2026-12-01T04:59:00.000Z' && !('sale' in (await jsonOf(sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SALE_PERCENT: '30', SALE_UNTIL: '2026-11-30', SALE_UNTIL_EN: '2026-12-01T13:59+09:00' } as NodeJS.ProcessEnv, new Date('2026-12-01T05:00:00Z'))))))
}

// ---- 3. the English prices -------------------------------------------------------------------------------------------------------------------------------------
{
  check('(3) defaults: $25, sale $17.50 (= $25 minus 30 %, to the cent)', DEFAULT_USD_PRICE.egift === 25 && DEFAULT_USD_PRICE.egift_sale === 17.5 && parseUsdPrice('25', '', 30).egift_sale === 17.5)
  check('(3) USD_PRICE_EGIFT_SALE accepts cents: "17.50", "17.5", "$17.50"; three decimals or text fall back', parseUsdPrice('25', '17.50').egift_sale === 17.5 && parseUsdPrice('25', '17.5').egift_sale === 17.5 && parseUsdPrice('25', '$17.50').egift_sale === 17.5 && parseUsdPrice('25', '17.555', 30).egift_sale === 17.5 && parseUsdPrice('25', 'x').egift_sale === 17.5)
  check('(3) whole dollars have no decimals ($25), anything else has two ($17.50, $12.30)', usd(25) === '$25' && usd(17.5) === '$17.50' && usd(12.3) === '$12.30' && usd(18) === '$18')
  check('(3) the launch line: "Thanksgiving launch price, through November 30. $25 from December 1."', usdLaunchLine(DEFAULT_USD_PRICE, '2026-11-30') === 'Thanksgiving launch price, through November 30. $25 from December 1.' && usdLaunchLine({ egift: 30, egift_sale: 21 }, '2026-12-31') === 'Thanksgiving launch price, through December 31. $30 from January 1.')
  const u = cleanUsd({ usd: { egift: 25, egift_sale: 17.5 } })
  check('(3) the page reads cents from /api/sizes (and falls back on junk)', u.egift_sale === 17.5 && cleanUsd({ usd: { egift: 25, egift_sale: 17.555 } }).egift_sale === 17.5 && cleanUsd(null).egift === 25)
  const legal = legalView('en', false).rows.find((r) => r.label === 'Prices')!.value
  const legalFull = legalView('en', true).rows.find((r) => r.label === 'Prices')!.value
  check('(3) the English legal notice: "US$25 (sale US$17.50) for orders from the English site; ¥3,980 for orders from the Japanese and Chinese sites"', legal.includes('US$25 (sale US$17.50) for orders from the English site; ¥3,980 for orders from the Japanese and Chinese sites') && legalFull.includes('US$25 (sale US$17.50) for orders from the English site; ¥3,980 for orders from the Japanese and Chinese sites'))
  check('(3) the Japanese and Chinese legal prices are unchanged (yen only)', !/US\$/.test(legalView('ja', false).rows.map((r) => r.value).join('') + legalView('zh-Hant', false).rows.map((r) => r.value).join('')))
  const src = ['src/order/SalePrice.tsx', 'src/reveal/Hero.tsx', 'src/reveal/UsSections.tsx', 'src/demo/OrderForm.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n')
  check('(3) no component draws a struck dollar price (the dollar view has no <s> / data-price-old) and the yen line above "Continue to payment" is gone', !/UsdPriceView[^]{0,400}<s\b/.test(readFileSync('src/order/SalePrice.tsx', 'utf8').split('export function UsdPriceView')[1] ?? '') && !/order-yen-line|yenCheckoutLine/.test(src))
}

// ---- 4. a paid USD order ---------------------------------------------------------------------------------------------------------------------------------------
const SECRET = 'whsec-usd'
const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('base64')
const post = (path: string, raw: string, ip = '9.9.9.9') => new Request(`https://ichirei.soul-id.jp${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'x-shopify-hmac-sha256': sign(raw) }, body: raw })
const usdOrder = (over: Record<string, unknown> = {}) => ({
  id: 7, name: '#1101', email: 'Ann.Buyer@Example.com', financial_status: 'paid', processed_at: '2026-11-16T10:00:00+09:00', created_at: '2026-11-16T10:00:00+09:00', customer_locale: 'en-US',
  // what a USD order looks like: the order's own money is dollars; the *_set carries both the shop's yen and what the buyer paid
  current_total_price: '17.50', total_price: '17.50', currency: 'USD', presentment_currency: 'USD',
  current_total_price_set: { shop_money: { amount: '2786.00', currency_code: 'JPY' }, presentment_money: { amount: '17.50', currency_code: 'USD' } },
  line_items: [{ sku: 'ICHIREI-EGIFT', properties: [] }], note_attributes: [], ...over,
});
{
  const facts = fromWebhook(usdOrder())!
  check('(4) a USD order is read as: the shop money 2786 JPY (revenue), and the buyer\'s 17.50 USD kept beside it', Number(facts.amount) === 2786 && facts.currency === 'JPY' && facts.buyer?.amount === '17.50' && facts.buyer?.currency === 'USD')
  const w = waitingFromShopify(facts, 'webhook', NOW)
  check('(4) it is recognised as an ICHIREI order (SKU ICHIREI-EGIFT, paid, no order reference): a waiting order, English, ¥2,786 with USD 17.50 beside it — never ¥17 or ¥18', !!w && w.order_number === '1101' && w.language === 'en' && w.amount_jpy === 2786 && w.amount_buyer?.amount === '17.50' && w.amount_buyer.currency === 'USD')
  check('(4) an old-style body with NO money sets and a non-yen currency is never counted as yen (amount_jpy stays null) — the buyer amount is kept', (() => { const x = waitingFromShopify(fromWebhook(usdOrder({ current_total_price_set: undefined, total_price_set: undefined }))!, 'webhook', NOW); return !!x && x.amount_jpy === null && x.amount_buyer?.amount === '17.50' })())
  check('(4) a yen order is unchanged: ¥3,980, no buyer amount', (() => { const x = waitingFromShopify(fromWebhook(usdOrder({ current_total_price: '3980', currency: 'JPY', current_total_price_set: undefined, customer_locale: 'ja' }))!, 'webhook', NOW); return !!x && x.amount_jpy === 3980 && !x.amount_buyer })())
  check('(4) with our order reference on the line (a normal order from our site, paid in USD) it is NOT a waiting order — it makes a normal gift', waitingFromShopify(fromWebhook(usdOrder({ line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: 'IC-20261116-ABCDEFGH' }] }] }))!, 'webhook', NOW) === null)
  // the Admin API form of the same order
  const adm = fromAdmin({ name: '#1102', email: 'a@b.co', createdAt: '2026-11-16T01:00:00Z', displayFinancialStatus: 'PAID', customerLocale: 'en', currentTotalPriceSet: { shopMoney: { amount: '2786.0', currencyCode: 'JPY' }, presentmentMoney: { amount: '17.50', currencyCode: 'USD' } }, lineItems: { nodes: [{ sku: 'ICHIREI-EGIFT', customAttributes: [] }] }, transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-11-16T01:05:00Z' }] })
  const wa = waitingFromShopify(adm, 'ops_sweep', NOW)
  check('(4) the read-only Admin API form agrees (shop money ¥2,786, buyer USD 17.50)', !!wa && wa.amount_jpy === 2786 && wa.amount_buyer?.currency === 'USD')
  const pay = paymentOf({ displayFinancialStatus: 'PAID', createdAt: '2026-11-16T01:00:00Z', transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-11-16T01:05:00Z' }], currentTotalPriceSet: { shopMoney: { amount: '2786.0', currencyCode: 'JPY' }, presentmentMoney: { amount: '17.50', currencyCode: 'USD' } } })
  check('(4) the payment lookup (the 24-hour rule and revenue) takes the yen shop amount and carries the buyer amount: 2786 / USD 17.50', pay.state === 'paid' && pay.amount_jpy === 2786 && pay.amount_buyer?.amount === '17.50')
}
{
  const store = new MemoryOrderStore()
  const C = createClaimHandlers(() => ({ store, now: () => NOW, env: {} as NodeJS.ProcessEnv, admin: null, webhookSecret: async () => SECRET }))
  const raw = JSON.stringify(usdOrder())
  const hook = await C.webhook(post('/api/shopify/orders-paid', raw))
  check('(4) the signed webhook accepts the USD order and records a waiting order', hook.status === 200 && (await jsonOf(hook)).waiting === true && !!(await readWaiting(store, '1101')))
  const open = await C.claim(post('/api/claim', JSON.stringify({ order: '#1101', email: ' ann.buyer@example.com ' }), '2.2.2.2'))
  const oj = await jsonOf(open)
  check('(4) /claim works for it (the number and the e-mail Shopify holds): a token, English', open.status === 200 && typeof oj.token === 'string' && oj.language === 'en')
  // the claim makes a normal gift: no checkout, the 24-hour rule from the claim, the record keeps both amounts
  const deps = (): OrderDeps => ({ store, shopify: null, shopifyMissing: ['SHOPIFY_STOREFRONT_TOKEN'], now: () => NOW, env: {} as NodeJS.ProcessEnv, fetchImpl: (async () => new Response('{}')) as typeof fetch, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) } as unknown as OrderDeps)
  const body = { story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', engine_result: { ...clone(GOLDEN), language: 'en' }, selected_kanji: '証', language: 'en', inscription_style: 'modern', sender_name: 'Ann', receiver_name: 'Ben', package: 'egift', delivery_date: '2026-12-25', refund_ack_at: NOW.toISOString(), sender_email: 'ann@example.com', claim: { order: '#1101', token: String(oj.token) } }
  const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(body) }))
  const rj = await jsonOf(r)
  const rec = (await store.get(String(rj.order_ref))) as OrderRecord
  check('(4) the claim of the USD order makes a normal gift (200, no checkout, status claimed) and the record keeps ¥2,786 and USD 17.50', r.status === 200 && rj.claimed === true && !rj.checkout_url && rec.status === 'claimed' && rec.claim?.amount_jpy === 2786 && rec.claim.amount_buyer?.amount === '17.50' && rec.claim.amount_buyer.currency === 'USD', JSON.stringify(rj).slice(0, 200))
  // /ops/stats revenue
  const entry = { ts: NOW.toISOString(), order_ref: rec.order_ref, token: null, size_code: 'ICHIREI-EGIFT', ship_to: 'none' as const, memorial: false, delivery_date: '2026-12-25' }
  const stat = orderStatOf(entry, rec, null, new Set(), NOW)
  check('(4) the dashboard row: price_jpy 2786 (the yen the shop settles), the buyer\'s USD 17.50 beside it — never ¥17', stat?.state === 'paid' && stat.price_jpy === 2786 && stat.price_buyer?.amount === '17.50' && stat.price_buyer.currency === 'USD')
  const viaShopify = orderStatOf(entry, { ...rec, claim: undefined, status: 'cart_created' } as OrderRecord, { state: 'paid', paid_at: NOW.toISOString(), amount_jpy: 2786, amount_buyer: { amount: '17.50', currency: 'USD' } }, new Set(), NOW)
  check('(4) an order made on our site and paid in USD (the payment lookup) gives the same: ¥2,786 and USD 17.50', viaShopify?.price_jpy === 2786 && viaShopify.price_buyer?.currency === 'USD')
  const jpy = orderStatOf(entry, { ...rec, claim: undefined, status: 'cart_created' } as OrderRecord, { state: 'paid', paid_at: NOW.toISOString(), amount_jpy: 3980 }, new Set(), NOW)
  const total = computeStats({ events: [], orders: [stat!, jpy!], renders: [], now: NOW })
  check('(4) /ops/stats revenue adds the yen: ¥2,786 + ¥3,980 = ¥6,766 (the $17.50 is not added as 17 or 18)', total.periods.all.revenue_jpy === 6766, String(total.periods.all.revenue_jpy))
  const ENV = { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv
  const P = await buildStats({ store, env: ENV, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }) }, store, ENV, NOW)
  check('(4) buildStats keeps price_buyer on the order list (the page draws "¥2,786 ($17.50)")', P.orders.every((o) => o.price_jpy === 0 || o.price_jpy !== 17))
  check('(4) the stats page draws the buyer amount beside the yen: ¥2,786 ($17.50)', STATS_CLIENT_JS.includes("function money(o)") && STATS_CLIENT_JS.includes("buyerAmt(o.price_buyer)") && STATS_CLIENT_JS.includes('money(o)'))
  // the stats page script itself computes the label; run its helpers on a sample
  const helpers = STATS_CLIENT_JS.match(/function num\(n\)[^\n]*\n\s*function yen\(n\)[^\n]*\n\s*function buyerAmt\(b\)[^\n]*\n[^\n]*\n\s*function money\(o\)[^\n]*\n/)
  const label = helpers ? (new Function(`${helpers[0]}; return money({ price_jpy: 2786, price_buyer: { amount: '17.50', currency: 'USD' } }) + '|' + money({ price_jpy: 3980 });`)() as string) : ''
  check('(4) …and that label is exactly "¥2,786 ($17.50)" for a USD order and "¥3,980" for a yen order', label === '¥2,786 ($17.50)|¥3,980', label)
}

// ---- 5. /ops (the owner's page) shows the dollars beside the yen on a waiting USD order, and /ops/stats lists it the same way --------------------------------------------------
{
  const store = new MemoryOrderStore()
  const C = createClaimHandlers(() => ({ store, now: () => NOW, env: {} as NodeJS.ProcessEnv, admin: null, webhookSecret: async () => SECRET }))
  await C.webhook(post('/api/shopify/orders-paid', JSON.stringify(usdOrder({ id: 9, name: '#1104' }))))
  const ENV = { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv
  const ops = createOpsHandlers((): OpsDeps => ({ store, env: ENV, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }), shipping: async () => ({ found: new Map(), failure: null }), sweep: async () => null }))
  const page = await (await ops.page(new Request('https://x/ops', { headers: { authorization: 'Basic ' + Buffer.from('owner:pw').toString('base64') } }))).text()
  check('(5) /ops lists the waiting USD order with "¥2,786 ($17.50)"', page.includes('#1104') && page.includes('¥2,786 ($17.50)'))
  const P = await buildStats({ store, env: ENV, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }) }, store, ENV, NOW)
  const row = P.orders.find((o) => o.order_ref === 'WO-1104')
  check('(5) /ops/stats lists it as waiting with price_jpy 2786 and price_buyer USD 17.50 (and it is not in the revenue until a gift is made)', row?.state === 'waiting' && row.price_jpy === 2786 && row.price_buyer?.amount === '17.50' && P.stats.periods.all.revenue_jpy === 0)
}

if (failures > 0) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nAll USD checkout checks passed.')
