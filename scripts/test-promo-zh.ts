// 2026-11-19 — the free gift on the Chinese page too: the same promotion, the same ONE daily pool (en, ja and zh), the same rules, the same private code on the cart.
// No network, no model, no Shopify: a fake Admin API and a fake Storefront API.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-promo-zh.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as OpenCC from 'opencc-js'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { emailHash } from '../engine/customer.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { liveCount, markHoldUsed, placeHold, resetPromoCache, scanDay, type HoldRecord, type PromoDeps } from '../engine/promo-holds.ts'
import { newHoldCode, type PromoShopify } from '../engine/promo-shopify.ts'
import { createCart, loadShopifyConfig } from '../engine/shopify.ts'
import { newVisitorId, visitorToken } from '../engine/visitor.ts'
import { holdRefusal, thanksCopy } from '../src/loop/copy.ts'
import { promoPriceLine } from '../src/order/promo-price.ts'
import { parseSale } from '../src/order/sale.ts'
import { parseUsdPrice } from '../src/order/usd.ts'
import { twdApprox } from '../src/reveal/currency.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const MIN = 60_000
const DAY = 24 * 60 * MIN
const NOW = new Date('2026-11-18T15:00:00Z') // 10:00 a.m. Eastern, promo day 2026-11-18
const ENV = { ICHIREI_PROMO_FROM: '2026-11-15T04:00:00-05:00', ICHIREI_PROMO_UNTIL: '2026-11-30T23:59:59-05:00', ICHIREI_PROMO_DAILY: '100', ICHIREI_PROMO_CODES: 'THANKS100' } as NodeJS.ProcessEnv
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })

// ---- the words ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const T = thanksCopy('zh-Hant')
  const n = T.count(37, 100)
  check('(1) zh-Hant card: 「感恩季」, the counter 「今日的100份免費禮物，還剩 {n} 份。」, the rule line, the email label, the consent box, the button, the line under it', T.title === '感恩季' && `${n.before}${n.n}${n.after}` === '今日的100份免費禮物，還剩 37 份。' && T.sub === '每人限一次，至11月30日止。每天早上（美東時間）／晚上6點（日本時間）更新名額。' && T.emailLabel === '電子郵件' && T.marketing === '也告訴我新的季節與優惠' && T.hold === '保留我的免費禮物' && T.small === '你的電子郵件只用來保留免費禮物，並在結帳時對應。')
  check('(1) zh-Hant: sold out 「今日的免費禮物已送完，明天會有新的名額。」 and already used 「這個電子郵件已經領過免費禮物了，謝謝你。這份禮物可以用 {price} 送出。」', T.none === '今日的免費禮物已送完，明天會有新的名額。' && T.alreadyGiven('¥3,980') === '這個電子郵件已經領過免費禮物了，謝謝你。這份禮物可以用 ¥3,980 送出。' && holdRefusal('already_given', '¥3,980', 'zh-Hant') === T.alreadyGiven('¥3,980') && holdRefusal('all_held', '¥3,980', 'zh-Hant') === T.none)
  const H = thanksCopy('zh-Hans')
  const same = (Object.keys(T) as (keyof typeof T)[]).every((k) => {
    const a = T[k]
    const b = H[k]
    if (typeof a === 'string') return b === toHans(a)
    if (k === 'count') return JSON.stringify(H.count(5, 100)) === toHans(JSON.stringify(T.count(5, 100)))
    if (k === 'held') return H.held('8:42', 7) === toHans(T.held('8:42', 7))
    if (k === 'orderFree') return H.orderFree(5, 100) === toHans(T.orderFree(5, 100))
    return (b as (x: never) => string)('¥3,980' as never) === toHans((a as (x: never) => string)('¥3,980' as never))
  })
  check('(1) zh-Hans is the zh-Hant text converted with OpenCC, every line', same)
  const src = readFileSync('src/loop/copy.ts', 'utf8')
  check('(1) no line of the Chinese copy says "AI", a machine or an algorithm', !/AI|人工智慧|人工智能|演算法|算法|機器|机器/.test(src.slice(src.indexOf('<zh-hant>'), src.indexOf('</zh-hans>'))))
}

// ---- the price line -------------------------------------------------------------------------------------------------------------------------------------------
{
  const sale = parseSale('30', '2026-11-30', NOW, '2026-11-15')
  const usd = parseUsdPrice('25', '17.50', 30)
  const twd = twdApprox({ TWD: 0.22 })
  check('(2) price line: 「若今日免費名額已滿：感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。」 — from the config and the page\'s own NT$ approximation', promoPriceLine('zh-Hant', false, usd, sale, twd) === '若今日免費名額已滿：感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。', promoPriceLine('zh-Hant', false, usd, sale, twd))
  check('(2) sold out: the same line without the 「若今日免費名額已滿：」 lead-in; no rate table: no bracket; no sale: just the regular price', promoPriceLine('zh-Hant', true, usd, sale, twd) === '感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。' && promoPriceLine('zh-Hant', false, usd, sale) === '若今日免費名額已滿：感恩季價格 ¥2,786，12月1日起 ¥3,980。' && promoPriceLine('zh-Hant', false, usd, null, twd) === '若今日免費名額已滿：¥3,980（約 NT$880）。')
}

// ---- one shared pool ---------------------------------------------------------------------------------------------------------------------------------------------
const fakeAdmin = () => {
  const codes = new Map<string, { code: string; holdId: string }>()
  let n = 0
  const api: PromoShopify = {
    async createHoldCode(holdId) {
      const code = newHoldCode()
      codes.set(`gid://shopify/DiscountCodeNode/${++n}`, { code, holdId })
      return { code, discountId: `gid://shopify/DiscountCodeNode/${n}` }
    },
    async deleteHoldCode(id) {
      codes.delete(id)
    },
    async saveConsent() {},
  }
  return { api, codes }
}
const deps = (store: MemoryOrderStore, shopify: PromoShopify | null, now = NOW): PromoDeps => ({ store, env: ENV, now: () => now, shopify, log: () => {} })
const holdOf = (store: MemoryOrderStore, email: string, day = '2026-11-18'): HoldRecord => JSON.parse(String(store.objects.get(`promo/${day}/holds/${emailHash(email)}.json`)?.body))
{
  resetPromoCache()
  const store = new MemoryOrderStore()
  const adm = fakeAdmin()
  const start = (await liveCount(store, ENV, NOW, true)).left
  const en = await placeHold(deps(store, adm.api), { email: 'en@example.com', browser: 'V' + 'e'.repeat(22), language: 'en' })
  const afterEn = (await liveCount(store, ENV, NOW, true)).left
  const ja = await placeHold(deps(store, adm.api), { email: 'ja@example.com', browser: 'V' + 'j'.repeat(22), language: 'ja' })
  const afterJa = (await liveCount(store, ENV, NOW, true)).left
  const zh = await placeHold(deps(store, adm.api), { email: 'zh@example.com', browser: 'V' + 'z'.repeat(22), language: 'zh-Hant' })
  const afterZh = (await liveCount(store, ENV, NOW, true)).left
  const zh2 = await placeHold(deps(store, adm.api), { email: 'zh2@example.com', browser: 'V' + 'y'.repeat(22), language: 'zh-Hans' })
  const afterZh2 = (await liveCount(store, ENV, NOW, true)).left
  check('(3) the ONE counter goes down for an en, a ja and a zh hold alike (100 → 99 → 98 → 97 → 96), zh-Hans too — no separate counter', start === 100 && en.ok && ja.ok && zh.ok && zh2.ok && afterEn === 99 && afterJa === 98 && afterZh === 97 && afterZh2 === 96, JSON.stringify([start, afterEn, afterJa, afterZh, afterZh2]))
  const sc = await scanDay(store, '2026-11-18', 100, NOW)
  const by = sc.slots.reduce((o: Record<string, number>, x) => ({ ...o, [x.slot.lang ?? '?']: (o[x.slot.lang ?? '?'] ?? 0) + 1 }), {})
  check('(3) every slot of the shared pool names its page language (en, ja, zh) for the dashboard; zh-Hant and zh-Hans count as zh', by.en === 1 && by.ja === 1 && by.zh === 2, JSON.stringify(by))
  check('(3) the hold of a Chinese page has its own private one-time code (GIFT-…), 2-hour hold, like the other pages', !!holdOf(store, 'zh@example.com').discount?.code?.startsWith('GIFT-') && Date.parse(holdOf(store, 'zh@example.com').expires_at) - NOW.getTime() === 120 * MIN)
  check('(3) three holds a day per email, whatever the language: the 4th hold of one email is refused', await (async () => {
    const s2 = new MemoryOrderStore()
    resetPromoCache()
    const a = fakeAdmin()
    const out: string[] = []
    for (let i = 0; i < 4; i++) {
      const t = new Date(NOW.getTime() + i * 150 * MIN) // each hold has ended before the next
      const r = await placeHold(deps(s2, a.api, t), { email: 'three@example.com', browser: 'V' + 't'.repeat(22), language: (['en', 'ja', 'zh-Hant', 'zh-Hant'] as const)[i] })
      out.push(r.ok ? 'ok' : r.code)
    }
    return out.slice(0, 3).every((x) => x === 'ok') && out[3] === 'three_holds'
  })(), 'see codes')
}

// ---- one per email for the whole promotion, across languages ---------------------------------------------------------------------------------------------------------
for (const [first, second] of [['en', 'zh-Hant'], ['zh-Hant', 'en'], ['ja', 'zh-Hant'], ['zh-Hans', 'ja']] as const) {
  resetPromoCache()
  const store = new MemoryOrderStore()
  const adm = fakeAdmin()
  const email = `once-${first}@example.com`
  const h = await placeHold(deps(store, adm.api), { email, browser: 'V' + 'a'.repeat(22), language: first })
  await markHoldUsed(deps(store, adm.api, new Date(NOW.getTime() + 10 * MIN)), { email, holdId: h.ok ? h.hold.id : null })
  const again = await placeHold(deps(store, adm.api, new Date(NOW.getTime() + DAY)), { email, browser: 'V' + 'b'.repeat(22), language: second })
  check(`(4) an email whose free gift was used in ${first} cannot hold again in ${second} ("already received")`, h.ok && !again.ok && again.code === 'already_given', JSON.stringify(again))
}

// ---- the cart: the hold's private code in the Chinese page's own market and currency (JPY) ----------------------------------------------------------------------------------
const cfg = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config!
type Sent = { query: string; variables: { input: Record<string, any> } }
const storefront = (sent: Sent[], free = true) =>
  (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)) as Sent
    sent.push(b)
    const codes = (b.variables.input.discountCodes ?? []) as string[]
    return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/abc?key=k', ...(codes.length ? { discountCodes: codes.map((code) => ({ code, applicable: free })) } : {}), cost: { totalAmount: { amount: codes.length && free ? '0' : '3980', currencyCode: 'JPY' } } }, userErrors: [] } } }), { status: 200 })
  }) as typeof fetch
{
  for (const lang of ['zh-Hant', 'zh-Hans'] as const) {
    const sent: Sent[] = []
    const r = await createCart(cfg, 'egift', [], 'IC-20261118-ZH', storefront(sent), lang, { code: 'GIFT-ABCD2345', email: 'zh@example.com', holdId: 'h1' }, 0)
    const input = sent[0].variables.input
    check(`(5) ${lang} cart: the hold's private code, its id and its email travel; no US context (the store's own yen market); the checkout link applies the code; the cart is free`, input.discountCodes?.[0] === 'GIFT-ABCD2345' && input.attributes.some((a: any) => a.key === 'ichirei_hold' && a.value === 'h1') && input.buyerIdentity?.email === 'zh@example.com' && !('countryCode' in (input.buyerIdentity ?? {})) && !/@inContext/.test(sent[0].query) && new URL(r.checkoutUrl).searchParams.get('discount') === 'GIFT-ABCD2345' && r.free === true && !new URL(r.checkoutUrl).searchParams.has('locale'), JSON.stringify(input))
  }
  // through /api/order
  const orderStore = new MemoryOrderStore()
  const adm = fakeAdmin()
  resetPromoCache()
  const visitor = newVisitorId()
  const cookie = `ic_v=${visitorToken(visitor)}`
  await placeHold(deps(orderStore, adm.api), { email: 'order-zh@example.com', browser: visitor, language: 'zh-Hant' })
  const code = holdOf(orderStore, 'order-zh@example.com').discount!.code
  const sent: Sent[] = []
  const d = (): OrderDeps => ({ store: orderStore, shopify: cfg, shopifyMissing: [], now: () => NOW, env: ENV, fetchImpl: storefront(sent), promoShopify: adm.api, promoRetryMs: 0, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) }) as unknown as OrderDeps
  const body = { story: '爸爸不太會說話，卻每年過年都開車到車站接我，回去時也一定送我。', engine_result: { ...clone(GOLDEN), language: 'zh-Hant' }, selected_kanji: '証', language: 'zh-Hant', inscription_style: 'traditional', sender_name: 'Ann', receiver_name: 'Ben', package: 'egift', delivery_date: '2026-12-25', refund_ack_at: NOW.toISOString(), sender_email: 'ann@example.com' }
  const res = await createOrderHandler(d)(new Request('http://x/api/order', { method: 'POST', headers: { cookie }, body: JSON.stringify(body) }))
  const j = (await res.json()) as Record<string, any>
  check('(5) /api/order for a holder on the Chinese page: 200, the cart carries the hold\'s own code and the checkout link applies it (the same hotfix path as en and ja)', res.status === 200 && sent[0]?.variables.input.discountCodes?.[0] === code && new URL(j.checkout_url).searchParams.get('discount') === code, JSON.stringify([res.status, j.code, j.error]))
  const plain = await createOrderHandler(() => ({ ...d(), store: new MemoryOrderStore() }) as OrderDeps)(new Request('http://x/api/order', { method: 'POST', headers: { cookie: `ic_v=${visitorToken(newVisitorId())}` }, body: JSON.stringify(body) }))
  const pj = (await plain.json()) as Record<string, any>
  check('(5) a Chinese visitor with no hold gets the normal cart (no code)', plain.status === 200 && !('discountCodes' in sent.at(-1)!.variables.input) && !new URL(pj.checkout_url).searchParams.has('discount'), JSON.stringify([plain.status, pj.code]))
}

// ---- the dashboard counts the language ------------------------------------------------------------------------------------------------------------------------------------
{
  const client = readFileSync('api/ops-stats-client.ts', 'utf8')
  const stats = readFileSync('api/ops-stats.ts', 'utf8')
  check('(6) "Free gifts by day" has a language column (ja · en · zh) counted from the shared pool\'s slots', client.includes("data-testid=\"promo-day-langs\"") && client.includes("' · zh ' + r.by_lang.zh") && stats.includes('by_lang') && stats.includes('promoDays'))
}

console.log(failures === 0 ? '\nAll Chinese free-gift checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
