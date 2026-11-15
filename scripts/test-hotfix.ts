// Hotfix 2026-11-15: the English checkout (language and locale), the order-step wording, the free tries counted per browser, and the "Days of Thanks" promotion. No network, no model.
// (The cookie and the limits on the REAL server are in scripts/test-server.mjs section L; the picture cap for paid orders is in scripts/test-film-art.ts section 6.)
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-hotfix.ts

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnimationHandlers } from '../api/animation.ts'
import { createClaimHandlers } from '../api/claim.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createPreviewHandlers } from '../api/preview.ts'
import { sizesResponse } from '../api/sizes.ts'
import { buildAnimationRecord, newAnimationId, type AnimationRecord } from '../engine/animation.ts'
import { LIMIT_PERSON, LIMIT_SITE } from '../engine/contract.ts'
import { SlidingWindowLimiter } from '../engine/rate-limit.ts'
import { newMoment, previewAddress, resetDayLimits, siteRound } from '../engine/day-limits.ts'
import { dailyMax, picturePath } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { promoFilmDailyMax, promoOn, promoWindow } from '../engine/promo.ts'
import { createCart, loadShopifyConfig } from '../engine/shopify.ts'
import { paymentOf } from '../engine/shipping.ts'
import type { PaymentInfo, PaymentResult } from '../engine/shipping.ts'
import { cleanPromo } from '../src/demo/useSizes.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'
import { LEGAL } from '../src/legal/legal-copy.ts'
import { PREVIEW_COPY } from '../src/demo/preview-copy.ts'
import { cookieValue, ensureVisitor, newVisitorId, verifyVisitor, visitorOf, visitorSetCookie, visitorToken } from '../engine/visitor.ts'
import { fromWebhook, isWaiting } from '../engine/waiting.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-18T03:00:00Z')

// ---- 1. the English checkout ---------------------------------------------------------------------------------------------------------------------------
{
  const cfg = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config!
  const sent: { query: string; variables: { input: Record<string, unknown> } }[] = []
  const mk = (checkout: string) => (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: checkout, cost: { totalAmount: { amount: '17.50', currencyCode: 'USD' } } }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
  const attrs = [{ key: '_kanji', value: '証' }]
  const en = await createCart(cfg, 'egift', attrs, 'IC-20261118-ABCDEFGH', mk('https://soul-id-2.myshopify.com/cart/c/abc?key=k1'), 'en')
  check('(1) the English cart is created in the context of the US and English: @inContext(country: US, language: EN) on the cartCreate mutation', /^mutation CartCreate\(\$input: CartInput!\) @inContext\(country: US, language: EN\) \{/.test(sent[0].query), sent[0].query.slice(0, 120))
  check('(1) the English cart keeps buyerIdentity { countryCode: US }', (sent[0].variables.input.buyerIdentity as { countryCode?: string })?.countryCode === 'US')
  const u = new URL(en.checkoutUrl)
  check('(1) the English checkout link has locale=en and keeps the parameters Shopify put on it (key=k1)', u.searchParams.get('locale') === 'en' && u.searchParams.get('key') === 'k1' && u.pathname === '/cart/c/abc', en.checkoutUrl)
  // ja / zh: the request body is byte-identical to what it was before this change
  const OLD_QUERY = `mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { id checkoutUrl cost { totalAmount { amount currencyCode } } }
    userErrors { field message }
  }
}`
  for (const lang of ['ja', 'zh-Hant', 'zh-Hans', undefined]) {
    sent.length = 0
    const raw: string[] = []
    const f = (async (_u: string, init: RequestInit) => { raw.push(String(init.body)); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/abc?key=k1', cost: { totalAmount: { amount: '3980', currencyCode: 'JPY' } } }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
    const r = await createCart(cfg, 'egift', attrs, 'IC-20261118-ABCDEFGH', f, lang)
    const want = JSON.stringify({ query: OLD_QUERY, variables: { input: { lines: [{ merchandiseId: cfg.variants.egift, quantity: 1, attributes: attrs }], attributes: [{ key: 'order_ref', value: 'IC-20261118-ABCDEFGH' }] } } })
    check(`(1) ${lang ?? 'no language'}: the request body is byte-identical to before (no @inContext, no buyerIdentity) and the checkout link is returned untouched (no locale)`, raw[0] === want && r.checkoutUrl === 'https://soul-id-2.myshopify.com/cart/c/abc?key=k1', raw[0])
  }
}

// ---- 2. the order-step wording -----------------------------------------------------------------------------------------------------------------------------
{
  const en = JSON.stringify(SIZE_COPY.en)
  check('(2) en: the e-gift card says "a short film of your moment with music" (no "your story" there)', en.includes('a short film of your moment with music') && !/short film of your story/.test(en))
  const ja = JSON.stringify(SIZE_COPY.ja)
  const zh = JSON.stringify(SIZE_COPY['zh-Hant'])
  check('(2) ja / zh e-gift lines carry no "moment" rewrite (their own text)', !/moment/.test(ja + zh))
}

// ---- 3. free tries per browser --------------------------------------------------------------------------------------------------------------------------------
{
  const env = { ICHIREI_ROUND_SECRET: 'secret-a' } as NodeJS.ProcessEnv
  const first = ensureVisitor(new Request('http://x/'), env)
  check('(3) a first visit gets a cookie: ic_v = <id>.<signature>, HttpOnly; Secure; SameSite=Lax; one year (Max-Age 31536000)', !!first.setCookie && /^ic_v=V[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}; Max-Age=31536000; Path=\/; HttpOnly; Secure; SameSite=Lax$/.test(first.setCookie), first.setCookie ?? '')
  const tok = visitorToken(first.id, env)
  const again = ensureVisitor(new Request('http://x/', { headers: { cookie: `a=b; ic_v=${tok}` } }), env)
  check('(3) a valid cookie is kept (nothing is set again) and names the same browser', again.setCookie === null && again.id === first.id && verifyVisitor(tok, env) === first.id)
  const forged = ensureVisitor(new Request('http://x/', { headers: { cookie: `ic_v=${first.id}.AAAAAAAAAAAAAAAAAAAAAA` } }), env)
  const other = ensureVisitor(new Request('http://x/', { headers: { cookie: `ic_v=${tok}` } }), { ICHIREI_ROUND_SECRET: 'secret-b' } as NodeJS.ProcessEnv)
  check('(3) a forged signature (or a token signed with another key) is not refused: it gets a NEW token', !!forged.setCookie && forged.id !== first.id && !!other.setCookie && verifyVisitor(`${first.id}.AAAAAAAAAAAAAAAAAAAAAA`, env) === null)
  const req = new Request('http://x/')
  const issued = ensureVisitor(req, env)
  check('(3) within the request the new id is the one the handlers see (visitorOf)', visitorOf(req, env) === issued.id && visitorOf(new Request('http://x/'), env) === null)
  check('(3) the key is the round tickets\' key: the same secret signs both (a different secret gives a different signature)', visitorToken('V' + 'a'.repeat(22), env) !== visitorToken('V' + 'a'.repeat(22), { ICHIREI_ROUND_SECRET: 'secret-b' } as NodeJS.ProcessEnv) && cookieValue('x=1; ic_v=abc', 'ic_v') === 'abc' && visitorSetCookie('t').includes('HttpOnly'))
  check('(3) ids are random', new Set(Array.from({ length: 200 }, () => newVisitorId())).size === 200)
}
{
  resetDayLimits()
  const env = {} as NodeJS.ProcessEnv
  const A = 'VAAAAAAAAAAAAAAAAAAAAAA', B = 'VBBBBBBBBBBBBBBBBBBBBBB'
  let ok = 0
  for (let i = 0; i < 20; i++) if (newMoment(A, '203.0.113.1', env).ok) ok++
  const v21 = newMoment(A, '203.0.113.1', env)
  check('(3) 20 new moments a day per browser: the 21st gets limit_person', ok === 20 && !v21.ok && v21.code === 'limit_person')
  check('(3) a second browser on the SAME address is not blocked (the address backstop is 100)', newMoment(B, '203.0.113.1', env).ok === true)
  // the address backstop: 100 a day
  resetDayLimits()
  let n = 0
  for (let i = 0; i < 100; i++) if (newMoment(`V${String(i).padStart(22, 'x')}`, '198.51.100.9', env).ok) n++
  const over = newMoment('Vzzzzzzzzzzzzzzzzzzzzzz', '198.51.100.9', env)
  check('(3) the address backstop: the 101st new moment from one address in a day is refused (limit_person), whatever the browsers', n === 100 && !over.ok && over.code === 'limit_person')
  check('(3) a request with no usable token counts by address only (never refused for lacking one)', newMoment(null, '192.0.2.7', env).ok === true)
  resetDayLimits()
  check('(3) the day limits read the environment: ICHIREI_MOMENT_DAILY_MAX=1', newMoment(A, '203.0.113.2', { ICHIREI_MOMENT_DAILY_MAX: '1' } as NodeJS.ProcessEnv).ok && !newMoment(A, '203.0.113.2', { ICHIREI_MOMENT_DAILY_MAX: '1' } as NodeJS.ProcessEnv).ok)
  resetDayLimits()
  const site = { ICHIREI_SELECT_DAILY_MAX: '3' } as NodeJS.ProcessEnv
  const a = [await siteRound(null, site, NOW), await siteRound(null, site, NOW), await siteRound(null, site, NOW), await siteRound(null, site, NOW)]
  check('(3) the whole site: card rounds a day are capped (ICHIREI_SELECT_DAILY_MAX; 3 here → the 4th is refused); the next day starts again', JSON.stringify(a) === JSON.stringify([true, true, true, false]) && (await siteRound(null, site, new Date(NOW.getTime() + 86_400_000))) === true)
  resetDayLimits()
  check('(3) the site cap is 2,000 a day by default', (await siteRound(null, {} as NodeJS.ProcessEnv, NOW)) === true)
  check('(3) the owner\'s warmer messages (2026-11-15: ja / zh-Hant / en, zh-Hans by OpenCC)', LIMIT_PERSON.ja === '今日はたくさんの場面を書いてくださいました。続きは明日また書けます。すでに見つけた字は、今日このまま贈れます。' && LIMIT_PERSON['zh-Hant'] === '今天你已經寫下許多片刻了。明天可以繼續寫。已經找到的字，今天就能送出。' && LIMIT_PERSON.en === "You've written many moments today. You can write more tomorrow, and any character you've already found can still be given today." && LIMIT_PERSON['zh-Hans'] === '今天你已经写下许多片刻了。明天可以继续写。已经找到的字，今天就能送出。' && LIMIT_SITE.ja === 'ただいま多くの方にご利用いただいています。少し時間をおいて、もう一度お試しください。' && LIMIT_SITE['zh-Hant'] === '目前有很多人正在使用，請稍等片刻再試一次。' && LIMIT_SITE.en === 'Lots of people are writing their moments right now. Please try again in a little while.' && LIMIT_SITE['zh-Hans'] === '目前有很多人正在使用，请稍等片刻再试一次。')
  check('(3) /legal: one sentence about the one functional cookie in each language, no banner', LEGAL.ja.privacy.body === '無料のお試し回数を管理するため、機能上必要なCookieを1つ使用します。' && LEGAL['zh-Hant'].privacy.body === '為了管理免費試用次數，我們使用一個功能上必要的Cookie。' && LEGAL.en.privacy.body === 'We use one functional cookie to limit free previews.')
  check('(3) the "pictures are painted later" line (never "try again tomorrow"): ja / zh-Hant / en', PREVIEW_COPY.ja.afterOrder === '4枚の絵は、贈ると決めたときに描かれます。' && PREVIEW_COPY['zh-Hant'].afterOrder === '四幅畫會在你決定送出時繪製。' && PREVIEW_COPY.en.afterOrder === 'Your four pictures are painted the moment you give this gift.' && !/tomorrow|明日|明天/.test(JSON.stringify([PREVIEW_COPY.ja.afterOrder, PREVIEW_COPY['zh-Hant'].afterOrder, PREVIEW_COPY.en.afterOrder])))
}
{
  // the picture sets: per BROWSER (the token), the address as the backstop
  const store = new MemoryOrderStore()
  const FILM = { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['a', 'b', 'c', 'd'], made_at: NOW.toISOString() }
  const daily = new SlidingWindowLimiter(2, 86_400_000)
  const dailyIp = new SlidingWindowLimiter(4, 86_400_000)
  const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async () => clone(FILM) as never, env: { ICHIREI_FILM: 'off' } as never, log: () => {}, daily, dailyIp }))
  const cookieOf = (id: string) => `ic_v=${visitorToken(id, process.env)}`
  const start = async (id: string | null, ip: string, k: number) => {
    const r = await H.start(new Request('http://x/api/preview', { method: 'POST', headers: { 'x-forwarded-for': `6.6.6.6, ${ip}`, ...(id ? { cookie: cookieOf(id) } : {}) }, body: JSON.stringify({ story: `その人は、いつも黙って駅まで送ってくれた。${k}`, language: 'ja', relationship: 'parent_father', direction: 'up', purpose: 'thanks', shown: ['備'] }) }))
    return ((await r.json()) as { state: string }).state
  }
  const X = 'V' + 'x'.repeat(22), Y = 'V' + 'y'.repeat(22)
  const a = [await start(X, '203.0.113.30', 1), await start(X, '203.0.113.30', 2), await start(X, '203.0.113.30', 3)]
  check('(3) picture sets: 5 a day per BROWSER (2 here): the third new set of one browser is "limited"', JSON.stringify(a) === JSON.stringify(['ok', 'ok', 'limited']), JSON.stringify(a))
  const y = [await start(Y, '203.0.113.30', 4), await start(Y, '203.0.113.30', 5)]
  check('(3) a second browser on the same address still gets its own sets (until the address backstop)', y[0] === 'ok' && y[1] === 'limited' || y[0] === 'ok', JSON.stringify(y))
  const z = await start('V' + 'z'.repeat(22), '203.0.113.30', 6)
  check('(3) the address backstop (4 here) stops a fifth set from that address even for a fresh browser', z === 'limited', z)
  const forgedStart = await start(null, '203.0.113.31', 7)
  check('(3) no cookie at all is not a refusal: the connection stands in for the person', forgedStart === 'ok')
  void previewAddress
}

// ---- 4. the promotion ------------------------------------------------------------------------------------------------------------------------------------------
{
  const env = { ICHIREI_PROMO_FROM: '2026-11-17T12:00:00-05:00', ICHIREI_PROMO_UNTIL: '2026-11-25T23:59:59-05:00' } as NodeJS.ProcessEnv
  const at = (iso: string) => new Date(iso)
  check('(4) the promotion is on only between its dates (US Eastern): not before Nov 17 12:00, on at the start and the end, off after Nov 25 23:59:59', !promoOn(env, at('2026-11-17T16:59:59Z')) && promoOn(env, at('2026-11-17T17:00:00Z')) && promoOn(env, at('2026-11-20T12:00:00Z')) && promoOn(env, at('2026-11-26T04:59:59Z')) && !promoOn(env, at('2026-11-26T05:00:00Z')))
  check('(4) empty dates = off (the default of any environment that does not set them)', !promoOn({} as NodeJS.ProcessEnv, NOW) && promoWindow({ ICHIREI_PROMO_FROM: '', ICHIREI_PROMO_UNTIL: '' } as NodeJS.ProcessEnv) === null)
  check('(4) the picture cap for previews: 300 inside the dates, 200 outside (ICHIREI_FILM_DAILY_MAX_PROMO = 300 by default)', dailyMax(env, at('2026-11-20T12:00:00Z')) === 300 && dailyMax(env, at('2026-11-26T12:00:00Z')) === 200 && dailyMax(env, at('2026-11-16T12:00:00Z')) === 200 && dailyMax({} as NodeJS.ProcessEnv, NOW) === 200 && promoFilmDailyMax({ ICHIREI_FILM_DAILY_MAX_PROMO: '450' } as NodeJS.ProcessEnv) === 450)
  const body = async (e: NodeJS.ProcessEnv, now: Date) => (await sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1', ...e } as NodeJS.ProcessEnv, now).json()) as { promo?: { from: string; until: string } }
  const on = await body(env, at('2026-11-20T12:00:00Z'))
  const over = await body(env, at('2026-11-27T12:00:00Z'))
  const none = await body({}, at('2026-11-20T12:00:00Z'))
  check('(4) /api/sizes carries the promotion window until it is over; nothing when it is off or over', !!on.promo && Date.parse(on.promo.from) === Date.parse('2026-11-17T12:00:00-05:00') && cleanPromo(on)?.until === Date.parse('2026-11-25T23:59:59-05:00') && over.promo === undefined && none.promo === undefined && cleanPromo({}) === null)
}

// ---- 5. a $0 order is a normal paid order ------------------------------------------------------------------------------------------------------------------
{
  // Shopify: total 0, status PAID, a 100%-off code
  const zero = (over: Record<string, unknown> = {}) => ({ id: 9, name: '#1201', email: 'ann@example.com', financial_status: 'paid', processed_at: '2026-11-18T09:00:00-05:00', created_at: '2026-11-18T09:00:00-05:00', customer_locale: 'en-US', current_total_price: '0.00', total_price: '0.00', currency: 'USD', current_total_price_set: { shop_money: { amount: '0.00', currency_code: 'JPY' }, presentment_money: { amount: '0.00', currency_code: 'USD' } }, discount_codes: [{ code: 'THANKS1118', amount: '25.00', type: 'percentage' }], line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: 'IC-20261118-ZERO0001' }] }], note_attributes: [], ...over })
  const facts = fromWebhook(zero())!
  check('(5) a $0 PAID webhook is read as paid (not refused for its amount) and is NOT a waiting order (it carries our order reference)', facts.paid === true && !facts.cancelled && Number(facts.amount) === 0 && !isWaiting(facts))
  const pay = paymentOf({ displayFinancialStatus: 'PAID', createdAt: '2026-11-18T14:00:00Z', discountCodes: ['THANKS1118'], currentTotalPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'JPY' }, presentmentMoney: { amount: '0.00', currencyCode: 'USD' } }, transactions: [] })
  check('(5) the payment lookup reads it as paid, revenue 0, marked free with the code\'s name', pay.state === 'paid' && pay.amount_jpy === 0 && pay.free === true && pay.free_code === 'THANKS1118' && pay.paid_at === '2026-11-18T14:00:00Z', JSON.stringify(pay))

  // the whole path: webhook → payment seen → collectable → the receiver's ceremony
  const store = new MemoryOrderStore()
  const ref = 'IC-20261118-ZERO0001'
  const p = parseOrderRequest({ story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'simple', ship_to: 'egift', sender_email: 'taro@example.com', gift_message: 'ありがとう。' }, NOW)
  if (!p.ok) throw new Error(p.error)
  const record: OrderRecord = buildRecord(p.order, ref, NOW)
  record.certificate_no = 9
  record.production.poems = [{ poem_id: 'PM-20261118-aaaaaaaaaa', type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], pattern: null, reading: 'あさごとに' }]
  record.production.certificate.poems = [{ type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: 'あさごとに' }]
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim: AnimationRecord = buildAnimationRecord(record, animId, NOW)
  anim.gift_token = token
  anim.film = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: Array(4).fill('x'), made_at: NOW.toISOString() } as never
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, buildGiftRecord(record, animId, token, p.order.sender_email, NOW))
  for (let i = 1; i <= 4; i++) await store.putObject(picturePath(animId, i), Buffer.from('RIFFxxxxWEBP'), 'image/webp')
  await store.putObject(`films/${animId}/art.json`, JSON.stringify({ schema: 'film-art', id: animId, status: 'done', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
  const payInfo: PaymentInfo = { state: 'paid', paid_at: '2026-11-18T14:00:00Z', amount_jpy: 0, free: true, free_code: 'THANKS1118' }
  const payments = async (refs: string[]): Promise<PaymentResult> => ({ found: new Map(refs.map((r) => [r, payInfo])), failure: null })
  // the signed webhook for the $0 order
  const SECRET = 'whsec-zero'
  const raw = JSON.stringify(zero())
  const hook = createClaimHandlers(() => ({ store, now: () => NOW, env: { SHOPIFY_WEBHOOK_SECRET: SECRET } as never }))
  const wr = await hook.webhook(new Request('https://x/api/shopify/orders-paid', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': createHmac('sha256', SECRET).update(raw).digest('base64') }, body: raw }))
  const seen = (await store.get(ref)) as OrderRecord
  check('(5) the signed $0 webhook is accepted and the order\'s payment is SEEN (paid_seen_at written) — and it is not turned into a waiting order', wr.status === 200 && !!seen.paid_seen_at && ((await wr.json()) as { waiting?: boolean }).waiting !== true, String(wr.status))
  const A = createAnimationHandlers(() => ({ store, now: () => NOW, payments }))
  const G = createGiftHandlers(() => ({ store, now: () => NOW, payments }))
  const bv = (await (await A.view(animId)).json()) as { order?: { confirming?: boolean; finishing?: boolean; collected?: boolean }; gift?: { url?: string } }
  check('(5) the buyer\'s page shows it as paid (not "confirming", not "being finished"), with the collect step and the link', bv.order?.confirming === false && !bv.order?.finishing && bv.order?.collected === false && !!bv.gift?.url, JSON.stringify(bv.order))
  const col = await A.collect(animId)
  check('(5) Collect works for the $0 order (200, recorded once)', col.status === 200 && ((await col.json()) as { collected?: boolean }).collected === true)
  const v = await G.view(token)
  const vj = (await v.json()) as { locked?: boolean; glyph?: string }
  check('(5) the receiver\'s page opens: the character is there, nothing is sealed', v.status === 200 && !vj.locked && vj.glyph === '証')
  const rr = await G.render(token)
  check('(5) the ceremony completes: render answers ready with the receiver\'s view', rr.status === 200 && ((await rr.json()) as { state?: string }).state === 'ready')
  const rep = await G.reply(token, { text: 'ありがとう。', char: '謝' })
  check('(5) the answer (a reply and a returned character) is accepted once', rep.status === 200 && (await G.reply(token, { text: 'again' })).status === 409)
}

console.log(failures === 0 ? '\nAll hotfix checks passed.' : `\n${failures} hotfix checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
