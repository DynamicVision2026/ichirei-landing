// Hotfix 2026-11-16: the free gift is $0 at checkout whoever is signed in. ONE PRIVATE CODE PER HOLD (GIFT-XXXXXXXX), not a customer list on THANKS100. No network, no model, no Shopify:
// a fake Admin API and a fake Storefront API.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-free-code.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClaimHandlers, markPaidHold } from '../api/claim.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { createLoopHandlers } from '../api/loop.ts'
import { emailHash, readCustomer, emailCustomerId } from '../engine/customer.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { holdForCart, markHoldUsed, placeHold, reapExpired, resetPromoCache, type HoldRecord, type PromoDeps } from '../engine/promo-holds.ts'
import { isHoldCode, newHoldCode, publicCodeName, type PromoShopify } from '../engine/promo-shopify.ts'
import { paymentOf } from '../engine/shipping.ts'
import { createCart, loadShopifyConfig, PromoCartNotFree } from '../engine/shopify.ts'
import { newVisitorId, visitorToken } from '../engine/visitor.ts'
import type { OrderRecord } from '../engine/order.ts'
import type { ShopifyOrderFacts } from '../engine/waiting.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}\n`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const MIN = 60_000
const NOW = new Date('2026-11-18T15:00:00Z') // 10:00 a.m. Eastern, promo day 2026-11-18
const ENV = { ICHIREI_PROMO_FROM: '2026-11-15T04:00:00-05:00', ICHIREI_PROMO_UNTIL: '2026-11-25T23:59:59-05:00', ICHIREI_PROMO_DAILY: '100', ICHIREI_PROMO_CODES: 'THANKS100' } as NodeJS.ProcessEnv
const B1 = 'V' + 'a'.repeat(22)

// every log line of this run (console and the hold code's own log): nothing may carry a whole private code or an email
const logged: string[] = []
const wrap = (k: 'log' | 'warn' | 'error') => {
  const orig = console[k]
  console[k] = (...a: unknown[]) => {
    logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  }
  return () => (console[k] = orig)
}
const restore = [wrap('log'), wrap('warn'), wrap('error')]

// ---- the fake Admin API: one code per hold ---------------------------------------------------------------------------------------------------------------------
const fakeAdmin = () => {
  const codes = new Map<string, { code: string; holdId: string; startsAt: Date; endsAt: Date }>()
  const calls: string[] = []
  let failDelete = false
  let broken = false
  let n = 0
  const api: PromoShopify = {
    async createHoldCode(holdId, endsAt, now) {
      if (broken) throw new Error('scope')
      const code = newHoldCode()
      const discountId = `gid://shopify/DiscountCodeNode/${++n}`
      codes.set(discountId, { code, holdId, startsAt: now, endsAt })
      calls.push('create')
      return { code, discountId }
    },
    async deleteHoldCode(discountId) {
      if (failDelete) throw new Error('boom')
      codes.delete(discountId)
      calls.push('delete')
    },
    async saveConsent() {},
  }
  return { api, codes, calls, setFailDelete: (b: boolean) => (failDelete = b), setBroken: (b: boolean) => (broken = b) }
}
const deps = (store: MemoryOrderStore, shopify: PromoShopify | null, now = NOW, log?: (l: string) => void): PromoDeps => ({ store, env: ENV, now: () => now, shopify, log: log ?? ((l) => logged.push(l)) })
const holdOf = (store: MemoryOrderStore, email: string, day = '2026-11-18'): HoldRecord => JSON.parse(String(store.objects.get(`promo/${day}/holds/${emailHash(email)}.json`)?.body))

// ---- the fake Storefront API: the cart read-back ----------------------------------------------------------------------------------------------------------------
const cfg = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config!
type Mode = 'free' | 'not_applicable' | 'full_price' | 'free_after_first'
const storefront = (mode: Mode, bodies: { query: string; variables: { input: Record<string, any> } }[] = [], currency = 'USD') => {
  let n = 0
  return (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body))
    bodies.push(b)
    n++
    const sent = (b.variables.input.discountCodes ?? []) as string[]
    const free = mode === 'free' || (mode === 'free_after_first' && n >= 2)
    const withCodes = /discountCodes \{ code applicable \}/.test(b.query)
    return new Response(
      JSON.stringify({
        data: {
          cartCreate: {
            cart: {
              id: 'gid://shopify/Cart/x',
              checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/abc?key=k',
              ...(withCodes ? { discountCodes: sent.map((code) => ({ code, applicable: free })) } : {}),
              cost: { totalAmount: { amount: sent.length ? (free ? '0.00' : currency === 'JPY' ? '3980' : '17.50') : currency === 'JPY' ? '3980' : '17.50', currencyCode: currency } },
            },
            userErrors: [],
          },
        },
      }),
      { status: 200 },
    )
  }) as typeof fetch
}

// ---- 1. a hold makes ONE private code, with the settings of the ticket ---------------------------------------------------------------------------------------------
resetPromoCache()
const store = new MemoryOrderStore()
const sh = fakeAdmin()
const h1 = await placeHold(deps(store, sh.api), { email: 'Holder@Example.com', browser: B1, language: 'en' })
const rec1 = holdOf(store, 'holder@example.com')
const made = [...sh.codes.values()]
check('(1) a hold creates exactly one code in Shopify, named for the hold (title "ICHIREI free gift · <hold id>" is the fake\'s holdId argument)', h1.ok && made.length === 1 && made[0].holdId === rec1.id && /^GIFT-[A-Z2-9]{8}$/.test(made[0].code))
check('(1) the code starts when the hold is placed and ends at the hold\'s expiry + the 30-minute checkout grace (2 h + 30 min)', made[0].startsAt.getTime() === NOW.getTime() && made[0].endsAt.getTime() === Date.parse(rec1.expires_at) + 30 * MIN && Date.parse(rec1.expires_at) === NOW.getTime() + 120 * MIN)
check('(1) the hold record keeps { code, discountId } and NO customer id', rec1.discount?.code === made[0].code && !!rec1.discount?.discountId && !('shopify_customer' in rec1) && !JSON.stringify(rec1).includes('gid://shopify/Customer'))
const ja = await placeHold(deps(store, sh.api), { email: 'ja@example.com', browser: 'V' + 'b'.repeat(22), language: 'ja' })
check('(1) Japanese holders get the same kind of code', ja.ok && sh.codes.size === 2 && holdOf(store, 'ja@example.com').discount!.code.startsWith('GIFT-') && holdOf(store, 'ja@example.com').discount!.code !== rec1.discount!.code)
check('(1) the same email holding again from another device is the same hold: no second code', (await placeHold(deps(store, sh.api), { email: 'holder@example.com', browser: 'V' + 'c'.repeat(22) })).ok && sh.codes.size === 2)

// ---- 2. the held cart: that code, discount= on the link, read back before the hand-over --------------------------------------------------------------------------------
const bodies: { query: string; variables: { input: Record<string, any> } }[] = []
const held = await holdForCart(deps(store, sh.api), { browser: B1 })
const cart = await createCart(cfg, 'egift', [], 'IC-20261118-ABCDEFGH', storefront('free', bodies), 'en', { code: held!.code!, email: held!.rec.email, holdId: held!.rec.id }, 0)
check('(2) the cart carries the hold\'s own code as its only discount code; buyerIdentity keeps country US and the email (a prefill only)', held!.code === rec1.discount!.code && bodies[0].variables.input.discountCodes.join() === rec1.discount!.code && bodies[0].variables.input.buyerIdentity.countryCode === 'US' && bodies[0].variables.input.buyerIdentity.email === 'holder@example.com')
check('(2) the checkout link has discount=<code> and keeps key=…, locale=en', new URL(cart.checkoutUrl).searchParams.get('discount') === rec1.discount!.code && new URL(cart.checkoutUrl).searchParams.get('key') === 'k' && new URL(cart.checkoutUrl).searchParams.get('locale') === 'en')
check('(2) the cart is read back (discountCodes { code applicable } and the total) and handed over only when applicable AND 0', /discountCodes \{ code applicable \}/.test(bodies[0].query) && /cost \{ totalAmount/.test(bodies[0].query) && cart.free === true)

// ---- 3. a cart that is not free: one more try, then no checkout --------------------------------------------------------------------------------------------------------------
{
  logged.length = 0
  const b1: typeof bodies = []
  const again = await createCart(cfg, 'egift', [], 'IC-20261118-RETRY001', storefront('free_after_first', b1), 'en', { code: rec1.discount!.code, email: 'holder@example.com', holdId: rec1.id }, 0)
  check('(3) the first cart not free (code not yet applicable, $17.50): the cart is made once more, and the free one is handed over', b1.length === 2 && again.free === true && new URL(again.checkoutUrl).searchParams.get('discount') === rec1.discount!.code)
  check('(3) …and promo_cart_not_free is logged for the first one, with no code and no email', logged.some((l) => l.includes('"event":"promo_cart_not_free"')) && logged.every((l) => !l.includes(rec1.discount!.code) && !l.includes('@')), logged.join(' | '))
  for (const [lang, cur] of [['en', 'USD'], ['ja', 'JPY']] as const) {
    logged.length = 0
    const b2: typeof bodies = []
    let err: unknown = null
    let url: string | null = null
    try {
      url = (await createCart(cfg, 'egift', [], 'IC-20261118-REFUSE01', storefront('not_applicable', b2, cur), lang, { code: rec1.discount!.code, email: 'holder@example.com', holdId: rec1.id }, 0)).checkoutUrl
    } catch (e) {
      err = e
    }
    check(`(3) ${lang}: still not free after the second cart: PromoCartNotFree, exactly two carts, and NO checkout URL (a holder is never sent to full price)`, err instanceof PromoCartNotFree && b2.length === 2 && url === null)
    check(`(3) ${lang}: …both tries are logged as promo_cart_not_free, then promo_cart_refused — never the code, never an email`, logged.filter((l) => l.includes('"event":"promo_cart_not_free"')).length === 2 && logged.some((l) => l.includes('"event":"promo_cart_refused"')) && logged.every((l) => !l.includes(rec1.discount!.code) && !l.includes('@')), logged.join(' | '))
  }
  // a total that is 0 but a code that is not applicable, and an applicable code with a non-zero total, are both "not free"
  const odd = (applicable: boolean, amount: string) => (async (_u: string, init: RequestInit) => { const sent = JSON.parse(String(init.body)).variables.input.discountCodes as string[]; return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'c', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/abc?key=k', discountCodes: sent.map((code) => ({ code, applicable })), cost: { totalAmount: { amount, currencyCode: 'USD' } } }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
  const p = { code: rec1.discount!.code, email: 'holder@example.com', holdId: rec1.id }
  check('(3) "applicable but the total is not 0" and "total 0 but the code is not applicable" are both refused; "applicable and 0.00" passes', (await createCart(cfg, 'egift', [], 'IC-A', odd(true, '17.50'), 'en', p, 0).then(() => false, (e) => e instanceof PromoCartNotFree)) && (await createCart(cfg, 'egift', [], 'IC-B', odd(false, '0.00'), 'en', p, 0).then(() => false, (e) => e instanceof PromoCartNotFree)) && (await createCart(cfg, 'egift', [], 'IC-C', odd(true, '0.00'), 'en', p, 0)).free === true)
  // no holder: nothing changes (no code, no read-back field, no discount parameter)
  const b3: typeof bodies = []
  const plain = await createCart(cfg, 'egift', [], 'IC-NOHOLD', storefront('free', b3), 'en', undefined, 0)
  check('(3) a cart with no hold carries no code, asks for no read-back and has no discount= on its link', b3.length === 1 && b3[0].variables.input.discountCodes === undefined && !/discountCodes \{/.test(b3[0].query) && !new URL(plain.checkoutUrl).searchParams.has('discount'))
}

const sentN: { query: string; variables: { input: Record<string, any> } }[] = []
const sentW: { query: string; variables: { input: Record<string, any> } }[] = []
// ---- 4. through /api/order: a holder gets the free link or the break message, never a full-price one -----------------------------------------------------------------------------
{
  const orderStore = new MemoryOrderStore()
  const adm = fakeAdmin()
  resetPromoCache()
  const visitor = newVisitorId()
  const cookie = `ic_v=${visitorToken(visitor)}`
  const hold = await placeHold(deps(orderStore, adm.api), { email: 'order@example.com', browser: visitor, language: 'en' })
  const code = holdOf(orderStore, 'order@example.com').discount!.code
  const body = (language: 'en' | 'ja') => ({ story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', engine_result: { ...clone(GOLDEN), language }, selected_kanji: '証', language, inscription_style: 'modern', sender_name: 'Ann', receiver_name: 'Ben', package: 'egift', delivery_date: '2026-12-25', refund_ack_at: NOW.toISOString(), sender_email: 'ann@example.com' })
  const run = async (mode: Mode, language: 'en' | 'ja', promoShopify: PromoShopify | null = adm.api) => {
    const sent: typeof bodies = []
    const d = (): OrderDeps => ({ store: orderStore, shopify: cfg, shopifyMissing: [], now: () => NOW, env: ENV, fetchImpl: storefront(mode, sent, language === 'ja' ? 'JPY' : 'USD'), promoShopify, promoRetryMs: 0, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) } as unknown as OrderDeps)
    const r = await createOrderHandler(d)(new Request('http://x/api/order', { method: 'POST', headers: { cookie }, body: JSON.stringify(body(language)) }))
    return { status: r.status, json: (await r.json()) as Record<string, any>, sent }
  }
  logged.length = 0
  const ok = await run('free', 'en')
  check('(4) /api/order for a holder (en): 200, the checkout link has discount=<the hold\'s code>, the cart carries it, and the order record names the hold (ids only)', hold.ok && ok.status === 200 && new URL(ok.json.checkout_url).searchParams.get('discount') === code && ok.sent[0].variables.input.discountCodes[0] === code)
  const recOrder = (await orderStore.get(ok.json.order_ref)) as OrderRecord
  check('(4) …the order record keeps { hold id, day, email hash } and neither the code nor the email', recOrder.hold?.id === holdOf(orderStore, 'order@example.com').id && recOrder.hold?.email_hash === emailHash('order@example.com') && !JSON.stringify(recOrder).includes(code) && !JSON.stringify(recOrder).includes('order@example.com') && !JSON.stringify(recOrder.hold).includes('@'))
  const bad = await run('not_applicable', 'en')
  check('(4) a holder whose cart is not free: 503 promo_unavailable ("taking a short break"), NO checkout_url anywhere in the answer, the order is marked cart_failed, nothing is charged', bad.status === 503 && bad.json.code === 'promo_unavailable' && !('checkout_url' in bad.json) && !JSON.stringify(bad.json).includes('myshopify') && bad.sent.length === 2 && ((await orderStore.get(bad.json.order_ref)) as OrderRecord).status === 'cart_failed')
  const badJa = await run('full_price', 'ja')
  check('(4) the same for a Japanese holder (¥3,980 would be the full price): 503 promo_unavailable, no link', badJa.status === 503 && badJa.json.code === 'promo_unavailable' && !('checkout_url' in badJa.json))
  const stillHeld = await holdForCart(deps(orderStore, adm.api), { browser: visitor })
  check('(4) the hold stays after a refused cart (the visitor may try again)', !!stillHeld && ['active', 'checkout'].includes(stillHeld.view.state) && stillHeld.code === code)
  // a hold made before the per-hold codes (no discount on the record): the code is made when it goes to checkout
  const legacyStore = new MemoryOrderStore()
  resetPromoCache()
  const adm2 = fakeAdmin()
  const v2 = newVisitorId()
  await placeHold(deps(legacyStore, adm2.api), { email: 'legacy@example.com', browser: v2, language: 'en' })
  const lr = holdOf(legacyStore, 'legacy@example.com')
  const { discount: _gone, ...old } = lr
  await legacyStore.putObject(`promo/2026-11-18/holds/${emailHash('legacy@example.com')}.json`, JSON.stringify({ ...old, shopify_customer: 'gid://shopify/Customer/1' }), 'application/json')
  adm2.codes.clear()
  resetPromoCache()
  const sentL: typeof bodies = []
  const dL = (shopify: PromoShopify | null): OrderDeps => ({ store: legacyStore, shopify: cfg, shopifyMissing: [], now: () => NOW, env: ENV, fetchImpl: storefront('free', sentL), promoShopify: shopify, promoRetryMs: 0, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) } as unknown as OrderDeps)
  const lrRes = await createOrderHandler(() => dL(adm2.api))(new Request('http://x/api/order', { method: 'POST', headers: { cookie: `ic_v=${visitorToken(v2)}` }, body: JSON.stringify(body('en')) }))
  const lj = (await lrRes.json()) as Record<string, any>
  check('(4) a hold from before this fix (no code yet, still has the old customer id) gets its own code at checkout, saved on the record; the cart is free', lrRes.status === 200 && adm2.codes.size === 1 && !!holdOf(legacyStore, 'legacy@example.com').discount?.code && new URL(lj.checkout_url).searchParams.get('discount') === holdOf(legacyStore, 'legacy@example.com').discount!.code)
  const lrRes2 = await createOrderHandler(() => dL(null))(new Request('http://x/api/order', { method: 'POST', headers: { cookie: `ic_v=${visitorToken(v2)}` }, body: JSON.stringify(body('en')) }))
  // (this hold now has a code, so make a fresh legacy one with no Shopify at all)
  await legacyStore.putObject(`promo/2026-11-18/holds/${emailHash('legacy@example.com')}.json`, JSON.stringify({ ...old }), 'application/json')
  resetPromoCache()
  const lrRes3 = await createOrderHandler(() => dL(null))(new Request('http://x/api/order', { method: 'POST', headers: { cookie: `ic_v=${visitorToken(v2)}` }, body: JSON.stringify(body('en')) }))
  const lj3 = (await lrRes3.json()) as Record<string, any>
  check('(4) a holder with no code and no way to make one gets the break message, never a full-price checkout', lrRes2.status === 200 && lrRes3.status === 503 && lj3.code === 'promo_unavailable' && !('checkout_url' in lj3))
  // a visitor with no hold pays the price shown: no code at all
  const none = await createOrderHandler(() => ({ store: orderStore, shopify: cfg, shopifyMissing: [], now: () => NOW, env: ENV, fetchImpl: storefront('free', (sentN as never)), promoShopify: adm.api, promoRetryMs: 0, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) }) as unknown as OrderDeps)(new Request('http://x/api/order', { method: 'POST', headers: { cookie: `ic_v=${visitorToken(newVisitorId())}` }, body: JSON.stringify(body('en')) }))
  check('(4) a visitor with no hold: 200 and a cart with no code (the price shown)', none.status === 200 && sentN.length === 1 && sentN[0].variables.input.discountCodes === undefined && !new URL(((await none.json()) as { checkout_url: string }).checkout_url).searchParams.has('discount'))
  // a wooden size never carries the code
  const wood = await createOrderHandler(() => ({ store: orderStore, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, env: ENV, fetchImpl: storefront('free', (sentW as never)), promoShopify: adm.api, promoRetryMs: 0, film: async () => ({ status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' }) }) as unknown as OrderDeps)(new Request('http://x/api/order', { method: 'POST', headers: { cookie }, body: JSON.stringify({ ...body('ja'), package: 'simple' }) }))
  check('(4) a wooden size never carries the free code (its price stays as shown)', sentW.length === 1 ? sentW[0].variables.input.discountCodes === undefined : wood.status !== 200)
}

// ---- 5. the end of a hold or its use deletes the code; a failed delete is logged and nothing else breaks ----------------------------------------------------------------------------
{
  resetPromoCache()
  const st = new MemoryOrderStore()
  const a = fakeAdmin()
  await placeHold(deps(st, a.api), { email: 'expire@example.com', browser: B1, language: 'en' })
  await placeHold(deps(st, a.api), { email: 'used@example.com', browser: 'V' + 'd'.repeat(22), language: 'ja' })
  const used = holdOf(st, 'used@example.com')
  const wasUsed = await markHoldUsed(deps(st, a.api, new Date(NOW.getTime() + 10 * MIN)), { holdId: used.id, email: 'used@example.com' })
  check('(5) using the gift deletes that hold\'s code in Shopify (and only that one), marks the hold used and writes the promotion-wide marker', wasUsed && a.codes.size === 1 && ![...a.codes.values()].some((c) => c.holdId === used.id) && JSON.parse(String(st.objects.get(`promo/used/${emailHash('used@example.com')}.json`)?.body)).day === '2026-11-18')
  const reaped = await reapExpired(deps(st, a.api, new Date(NOW.getTime() + 121 * MIN)))
  check('(5) a hold that ended (expired) has its code deleted too', reaped === 1 && a.codes.size === 0)

  // a failed delete: logged (hold id and the last four characters only), nothing else breaks
  resetPromoCache()
  const st2 = new MemoryOrderStore()
  const b = fakeAdmin()
  const lines: string[] = []
  await placeHold(deps(st2, b.api, NOW, (l) => lines.push(l)), { email: 'f1@example.com', browser: B1, language: 'en' })
  await placeHold(deps(st2, b.api, NOW, (l) => lines.push(l)), { email: 'f2@example.com', browser: 'V' + 'e'.repeat(22), language: 'en' })
  b.setFailDelete(true)
  const c1 = holdOf(st2, 'f1@example.com').discount!.code
  const usedOk = await markHoldUsed(deps(st2, b.api, new Date(NOW.getTime() + 5 * MIN), (l) => lines.push(l)), { holdId: holdOf(st2, 'f1@example.com').id, email: 'f1@example.com' })
  const reapedOk = await reapExpired(deps(st2, b.api, new Date(NOW.getTime() + 121 * MIN), (l) => lines.push(l)))
  check('(5) when deleting fails: markHoldUsed still marks the hold used, reapExpired still handles the expired hold, and both log delete_code_failed', usedOk && reapedOk === 1 && lines.filter((l) => l.includes('"event":"delete_code_failed"')).length === 2 && holdOf(st2, 'f1@example.com').status === 'used' && holdOf(st2, 'f2@example.com').status === 'expired')
  check('(5) …the log names the hold and the last four characters of the code only: no whole code, no email', lines.every((l) => !l.includes(c1) && !/GIFT-[A-Z2-9]{8}/.test(l) && !l.includes('@')) && lines.some((l) => l.includes(c1.slice(-4))), lines.join(' | '))
  const cs = await readCustomer(st2, emailCustomerId('f1@example.com'))
  check('(5) …and the timeline still says hold_used', !!cs?.events.some((e) => e.code === 'hold_used'))
  // no Shopify at hand when a hold ends: nothing breaks
  check('(5) a hold without a code (older) or with no Admin client ends quietly', (await reapExpired(deps(st2, null, new Date(NOW.getTime() + 300 * MIN)))) === 0)
}

// ---- 6. the paid webhook: the hold of the ORDER (any checkout email), and how a free order is named -----------------------------------------------------------------------------------
{
  resetPromoCache()
  const st = new MemoryOrderStore()
  const a = fakeAdmin()
  const visitor = newVisitorId()
  await placeHold(deps(st, a.api), { email: 'held@example.com', browser: visitor, language: 'en' })
  const hold = holdOf(st, 'held@example.com')
  // the buyer paid with ANOTHER email (Shop Pay's saved account): the order record names the hold, so that hold is the one marked used
  const rec = { schema: 1, order_ref: 'IC-20261118-WEBHOOK1', buyer_email: 'shoppay@other.example', hold: { id: hold.id, day: hold.day, email_hash: hold.email_hash } } as unknown as OrderRecord
  const facts = { attrs: [{ key: 'ichirei_hold', value: hold.id }], discountCodes: [hold.discount!.code] } as unknown as ShopifyOrderFacts
  const done = await markPaidHold(st, a.api, rec, facts)
  check('(6) a $0 order paid with another email than the hold\'s (Shop Pay): the order\'s own hold is marked used, its code deleted, and the hold\'s email is marked "received" for the whole promotion', done && holdOf(st, 'held@example.com').status === 'used' && a.codes.size === 0 && st.objects.has(`promo/used/${emailHash('held@example.com')}.json`) && !st.objects.has(`promo/used/${emailHash('shoppay@other.example')}.json`))
  // with the cart attribute alone (no record link), or a GIFT- code alone, the hold of the buyer's email is found as before
  resetPromoCache()
  const st2 = new MemoryOrderStore()
  const a2 = fakeAdmin()
  await placeHold(deps(st2, a2.api), { email: 'same@example.com', browser: B1, language: 'ja' })
  const hid = holdOf(st2, 'same@example.com').id
  const viaAttr = await markPaidHold(st2, a2.api, { schema: 1, order_ref: 'IC-X', buyer_email: 'same@example.com' } as unknown as OrderRecord, { attrs: [{ key: 'ichirei_hold', value: hid }], discountCodes: [] } as unknown as ShopifyOrderFacts, () => NOW)
  check('(6) the cart\'s ichirei_hold attribute alone is enough (the buyer\'s email is the hold\'s)', viaAttr && holdOf(st2, 'same@example.com').status === 'used')
  resetPromoCache()
  const st3 = new MemoryOrderStore()
  const a3 = fakeAdmin()
  await placeHold(deps(st3, a3.api), { email: 'code@example.com', browser: B1, language: 'en' })
  const viaCode = await markPaidHold(st3, a3.api, { schema: 1, order_ref: 'IC-Y', buyer_email: 'code@example.com' } as unknown as OrderRecord, { attrs: [], discountCodes: [holdOf(st3, 'code@example.com').discount!.code] } as unknown as ShopifyOrderFacts, () => NOW)
  check('(6) a GIFT- code on the order (no attribute) is recognised as the free gift too', viaCode && holdOf(st3, 'code@example.com').status === 'used')
  check('(6) an ordinary paid order (no code, no hold attribute) is not a free gift: nothing is marked', (await markPaidHold(st3, a3.api, { schema: 1, order_ref: 'IC-Z', buyer_email: 'code@example.com' } as unknown as OrderRecord, { attrs: [], discountCodes: [] } as unknown as ShopifyOrderFacts, () => NOW)) === false)
  // the dashboard
  const gift = paymentOf({ displayFinancialStatus: 'PAID', createdAt: '2026-11-18T15:00:00Z', currentTotalPriceSet: { shopMoney: { amount: '0.0', currencyCode: 'JPY' }, presentmentMoney: { amount: '0.0', currencyCode: 'USD' } }, discountCodes: ['GIFT-AB23CD45'], transactions: [] } as never)
  const typed = paymentOf({ displayFinancialStatus: 'PAID', createdAt: '2026-11-18T15:00:00Z', currentTotalPriceSet: { shopMoney: { amount: '0.0', currencyCode: 'JPY' } }, discountCodes: ['THANKS100'], transactions: [] } as never)
  check('(6) the dashboard: a GIFT- order is a free gift with no code shown (free_code null); a typed THANKS100 keeps its name', gift.state === 'paid' && gift.free === true && gift.free_code === null && typed.state === 'paid' && typed.free === true && typed.free_code === 'THANKS100')
  check('(6) the helpers: isHoldCode / publicCodeName', isHoldCode('gift-ab23cd45') && !isHoldCode('THANKS100') && publicCodeName('GIFT-AB23CD45') === null && publicCodeName('THANKS100') === 'THANKS100' && publicCodeName(null) === null)
  const stats = readFileSync('api/ops-stats-client.ts', 'utf8')
  check('(6) the dashboard page shows the "free gift" label and appends a code only when there is one (never a private code, which is never passed to it)', /o\.free \? ' · ' \+ t\('free_mark'\) \+ \(o\.free_code \?/.test(stats))
}

// ---- 7. the routes and the pages: no whole private code, no email -------------------------------------------------------------------------------------------------------------------
{
  resetPromoCache()
  const st = new MemoryOrderStore()
  const a = fakeAdmin()
  const env = { ...ENV, ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as NodeJS.ProcessEnv
  const h = createLoopHandlers(() => ({ store: st, env, now: () => NOW, shopify: a.api }))
  const id = newVisitorId()
  const req = (path: string, init: RequestInit = {}) => new Request(`https://x${path}`, { ...init, headers: { cookie: `ic_v=${visitorToken(id, env)}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' } })
  const res = await h.promoHold(req('/api/promo/hold', { method: 'POST', body: JSON.stringify({ email: 'page@example.com', language: 'en' }) }))
  const text = await res.text()
  const state = await (await h.promoState(req('/api/promo'))).text()
  const code = holdOf(st, 'page@example.com').discount!.code
  check('(7) the hold answer and the card\'s state never contain the private code (the card says "applied at checkout"; the code goes only to the cart)', res.status === 200 && !text.includes(code) && !state.includes(code) && !/GIFT-[A-Z2-9]{8}/.test(text + state))
  const basket = await (await h.basketList(req('/api/basket'))).text()
  check('(7) nor does the My gifts list', !/GIFT-[A-Z2-9]{8}/.test(basket))
  // sources that print pages or logs: none writes a code
  const src = ['engine/promo-holds.ts', 'engine/promo-shopify.ts', 'engine/shopify.ts', 'api/order.ts', 'api/claim.ts', 'api/loop.ts', 'api/ops-stats.ts', 'api/ops-customers.ts', 'engine/customer.ts'].map((f) => readFileSync(f, 'utf8')).join('\n')
  check('(7) no log line in the code prints the hold\'s code (only codeTail, the last four characters)', !/console\.(log|warn|error)\([^)]*discount\??\.code/.test(src) && !/JSON\.stringify\(\{[^}]*code: (rec|held|made)\??\.(discount\??\.)?code/.test(src))
  const claim = createClaimHandlers(() => ({ store: st }))
  void claim
  // every line logged during this whole run
  const whole = logged.join('\n')
  check('(7) across the whole run no log line holds a whole GIFT- code or an email address', !/GIFT-[A-Z2-9]{8}/.test(whole) && !/[\w.+-]+@[\w-]+\.[\w.]+/.test(whole), whole.match(/GIFT-[A-Z2-9]{8}|[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? '')
}

// ---- 8. the rules that stay -------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  resetPromoCache()
  const st = new MemoryOrderStore()
  const a = fakeAdmin()
  const p = (email: string, browser: string, now = NOW) => placeHold(deps(st, a.api, now), { email, browser })
  const r1 = await p('rules@example.com', B1)
  check('(8) THANKS100 is not touched by the site: the config requires no id for it, and no code path edits it', r1.ok && !readFileSync('engine/promo-shopify.ts', 'utf8').includes('discountCodeBasicUpdate') && !/addEligible|removeEligible|shopify_customer/.test(['engine/promo-holds.ts', 'engine/promo-shopify.ts', 'api/claim.ts', 'api/order.ts', 'api/loop.ts'].map((f) => readFileSync(f, 'utf8')).join('\n')))
  a.setBroken(true)
  const none = await p('broken@example.com', 'V' + 'f'.repeat(22))
  check('(8) if Shopify cannot make the code: no hold ("taking a short break"), the slot goes back', !none.ok && none.code === 'unavailable')
  const cb = readFileSync('cloudbuild.yaml', 'utf8')
  check('(8) cloudbuild still passes the promo settings (hold 120 min, grace 30, 3 holds a day, 100 a day)', /_PROMO_DAILY: '100'/.test(cb) && /_PROMO_HOLD_MINUTES: '120'/.test(cb) && /_PROMO_HOLDS_PER_DAY: '3'/.test(cb) && /_PROMO_CHECKOUT_GRACE_MINUTES: '30'/.test(cb))
}

for (const r of restore) r()
process.stdout.write(failures === 0 ? '\nAll free-code checks passed.\n' : `\n${failures} CHECKS FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
