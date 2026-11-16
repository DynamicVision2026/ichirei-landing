// The customer loop (ticket 2026-11-15): the promotion's window and days (1), the customer record (2), the basket (3), the email holds and the live count (4), the free gift in Shopify (5).
// No network, no model: an in-memory order store shared by "two instances", and fake Shopify Admin / Storefront APIs.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-loop.ts

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClaimHandlers } from '../api/claim.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { deleteBasketItem, itemIdFor, listBasket, openBasketLink, readBasketItem, removeOrderedItem, saveBasketItem } from '../engine/basket.ts'
import { customerIdOf, customerOfOrder, emailCustomerId, linkEmail, readCustomer, recordCustomerEvent, sweepCustomers } from '../engine/customer.ts'
import { buildGiftRecord, newGiftToken } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { promoDayEnd, promoDayKey, promoOn } from '../engine/promo.ts'
import { holdForCart, holdOfBrowser, liveCount, markHoldUsed, placeHold, reapExpired, resetPromoCache, startCheckout, type PromoDeps } from '../engine/promo-holds.ts'
import { promoConfig, promoShopifyFrom, type PromoShopify } from '../engine/promo-shopify.ts'
import { createCart, loadShopifyConfig } from '../engine/shopify.ts'
import { holdRefusal } from '../src/loop/copy.ts'
import { emailHash as emailHashOf } from '../engine/customer.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const MIN = 60_000
const at = (iso: string) => new Date(iso)
const NOW = at('2026-11-18T15:00:00Z') // 10:00 a.m. Eastern, promo day 2026-11-18
const STORY = 'この話は、父が駅まで送ってくれた朝のことです。'
const B1 = 'V' + 'a'.repeat(22)
const B2 = 'V' + 'b'.repeat(22)
const B3 = 'V' + 'c'.repeat(22)
const ENV = { ICHIREI_PROMO_FROM: '2026-11-15T04:00:00-05:00', ICHIREI_PROMO_UNTIL: '2026-11-25T23:59:59-05:00', ICHIREI_PROMO_DISCOUNT_ID: '987654', ICHIREI_PROMO_CODES: 'thanks100, PLATFORM2' } as NodeJS.ProcessEnv

// ---- 1. the promotion's window and days -----------------------------------------------------------------------------------------------------------------
{
  check('(1) the promotion is on at 2026-11-15 04:00 Eastern and off at 03:59', promoOn(ENV, at('2026-11-15T04:00:00-05:00')) && !promoOn(ENV, at('2026-11-15T03:59:59-05:00')))
  check('(1) …and runs to 2026-11-25 23:59:59 Eastern, not a second more', promoOn(ENV, at('2026-11-25T23:59:59-05:00')) && !promoOn(ENV, at('2026-11-26T00:00:00-05:00')))
  check('(1) a promo day runs 4:00 a.m. to 3:59 a.m. Eastern: the key switches at 4:00 a.m. Eastern', promoDayKey(at('2026-11-18T03:59:59-05:00')) === '2026-11-17' && promoDayKey(at('2026-11-18T04:00:00-05:00')) === '2026-11-18' && promoDayKey(at('2026-11-18T23:30:00-05:00')) === '2026-11-18' && promoDayKey(at('2026-11-19T02:00:00-05:00')) === '2026-11-18')
  check('(1) a day ends at the next 4:00 a.m. Eastern (09:00 UTC in November)', promoDayEnd(at('2026-11-18T15:00:00Z')).toISOString() === '2026-11-19T09:00:00.000Z' && promoDayEnd(at('2026-11-19T07:00:00Z')).toISOString() === '2026-11-19T09:00:00.000Z')
  const cb = readFileSync('cloudbuild.yaml', 'utf8')
  check('(1) cloudbuild.yaml: the owner\'s window and numbers (from 2026-11-15 04:00 ET to 2026-11-30 23:59:59 ET (owner, Nov 15); 100 a day, 120-minute holds, 3 holds a day, 30 minutes of checkout grace) and the old promo line is gone', /_PROMO_FROM: '2026-11-15T04:00:00-05:00'/.test(cb) && /_PROMO_UNTIL: '2026-11-30T23:59:59-05:00'/.test(cb) && /_PROMO_DAILY: '100'/.test(cb) && /_PROMO_HOLD_MINUTES: '120'/.test(cb) && /_PROMO_HOLDS_PER_DAY: '3'/.test(cb) && /_PROMO_CHECKOUT_GRACE_MINUTES: '30'/.test(cb) && !/Have today's code/.test(readFileSync('src/demo/sizes-copy.ts', 'utf8') + readFileSync('src/demo/OrderForm.tsx', 'utf8')))
}

// ---- 2. the customer record ----------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  await recordCustomerEvent(store, { browser: B1 }, 'visited', { language: 'en' }, NOW)
  await recordCustomerEvent(store, { browser: B1 }, 'tried', {}, NOW)
  await recordCustomerEvent(store, { browser: B1 }, 'previewed', {}, NOW)
  const before = await readCustomer(store, B1)
  check('(2) before an email is known the record is the browser\'s own (id = the ic_v id) with its timeline', before?.id === B1 && before.events.map((e) => e.code).join() === 'visited,tried,previewed' && before.language === 'en')
  await recordCustomerEvent(store, { browser: B1, email: 'Ann@Example.com ' }, 'held', {}, NOW)
  const eid = emailCustomerId('ann@example.com')
  const merged = await readCustomer(store, eid)
  check('(2) when an email first appears for a browser, the browser record is merged into the email record (the events carry over, the email is lowercased) and a pointer is kept', merged?.id === eid && merged.emails.join() === 'ann@example.com' && merged.browsers.includes(B1) && merged.events.map((e) => e.code).join() === 'visited,tried,previewed,held' && (await customerIdOf(store, B1)) === eid && (await readCustomer(store, B1)) === null)
  check('(2) the email id is a hash of the lowercased, trimmed email', eid === emailCustomerId('  ANN@example.COM') && /^E[0-9a-f]{32}$/.test(eid))
  const again = await linkEmail(store, B1, 'ann@example.com', NOW)
  check('(2) merging again changes nothing (idempotent)', again === eid && (await readCustomer(store, eid))?.events.length === 4)
}
{
  // the paid webhook saves the email on the order and puts the order on the timeline
  const store = new MemoryOrderStore()
  const ref = 'IC-20261118-LOOP0001'
  const parsed = parseOrderRequest({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'simple', ship_to: 'egift', sender_email: 'taro@example.com', gift_message: '' }, NOW)
  if (!parsed.ok) throw new Error(parsed.error)
  const record: OrderRecord = buildRecord(parsed.order, ref, NOW)
  record.visitor = B2
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim = buildAnimationRecord(record, animId, NOW)
  anim.gift_token = token
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, buildGiftRecord(record, animId, token, null, NOW))
  await recordCustomerEvent(store, { browser: B2 }, 'previewed', {}, NOW)
  const SECRET = 'whsec-loop'
  const body = (amount: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id: 1, name: '#1018', email: 'Buyer@Example.com', financial_status: 'paid', processed_at: '2026-11-18T10:00:00-05:00', created_at: '2026-11-18T10:00:00-05:00', customer_locale: 'en-US', current_total_price: amount, total_price: amount, currency: 'USD', current_total_price_set: { shop_money: { amount: amount === '0.00' ? '0.00' : '2786.00', currency_code: 'JPY' }, presentment_money: { amount, currency_code: 'USD' } }, line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: ref }] }], note_attributes: [{ name: 'order_ref', value: ref }], discount_codes: amount === '0.00' ? [{ code: 'THANKS100' }] : [], ...extra })
  const used: unknown[] = []
  const hook = createClaimHandlers(() => ({ store, now: () => NOW, env: {} as never, onOrderPaid: async (rec, facts) => { used.push([rec.order_ref, facts.discountCodes]) } }))
  const send = (raw: string) => hook.webhook(new Request('https://x/api/shopify/orders-paid', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': createHmac('sha256', SECRET).update(raw).digest('base64') }, body: raw }))
  const hookWith = createClaimHandlers(() => ({ store, now: () => NOW, webhookSecret: async () => SECRET, onOrderPaid: async (rec, facts) => { used.push([rec.order_ref, facts.discountCodes]) } }))
  const raw = body('17.50')
  const r = await hookWith.webhook(new Request('https://x/api/shopify/orders-paid', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': createHmac('sha256', SECRET).update(raw).digest('base64') }, body: raw }))
  void send
  const rec = (await store.get(ref)) as OrderRecord
  check('(2) a paid webhook saves the buyer\'s email (lowercased), Shopify\'s order name and the amount on the order record', r.status === 200 && rec.buyer_email === 'buyer@example.com' && rec.shopify_order_name === '#1018' && rec.shopify_amount_jpy === 2786, JSON.stringify({ s: r.status, e: rec.buyer_email, n: rec.shopify_order_name, a: rec.shopify_amount_jpy }))
  const cust = await readCustomer(store, emailCustomerId('buyer@example.com'))
  const ev = cust?.events.find((e) => e.code === 'ordered_paid')
  check('(2) …and adds ordered_paid (with the order name and our order ref) to the customer\'s timeline, merged with the browser that made the order', !!ev && ev.order === '#1018' && ev.ref === ref && ev.amount === 2786 && cust!.browsers.includes(B2) && cust!.events.some((e) => e.code === 'previewed') && cust!.has_order === true)
  check('(2) a second delivery of the same webhook adds nothing (once)', (await hookWith.webhook(new Request('https://x/api/shopify/orders-paid', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': createHmac('sha256', SECRET).update(raw).digest('base64') }, body: raw }))).status === 200 && (await readCustomer(store, emailCustomerId('buyer@example.com')))!.events.filter((e) => e.code === 'ordered_paid').length === 1)
  check('(2) the order name finds the customer (the /ops search)', (await customerOfOrder(store, '#1018')) === emailCustomerId('buyer@example.com'))
  // no moment text, no names, no addresses in customers/
  await saveBasketItem(store, B2, { resume: { story: STORY, result: { cards: [] } }, story: STORY, language: 'ja', kanji: '証', reading: 'あかし', word: 'proof', line: 'x' }, NOW)
  const dump = [...store.objects.entries()].filter(([k]) => k.startsWith('customers/')).map(([, v]) => v.body.toString('utf8')).join('\n') + [...store.lines.entries()].filter(([k]) => k.includes('customers')).map(([, v]) => v.join('\n')).join('\n')
  check('(2) no moment text, no names and no address are ever written under customers/', dump.length > 0 && !dump.includes('父が駅まで') && !dump.includes('山田') && !dump.includes('taro@example.com'))
  void used
}
{
  // retention: a record with no order is deleted 30 days after its last event, with its basket; a record with an order stays
  const store = new MemoryOrderStore()
  const old = at('2026-10-10T00:00:00Z')
  await recordCustomerEvent(store, { browser: B1 }, 'visited', {}, old)
  await saveBasketItem(store, B1, { resume: { story: STORY }, story: STORY, language: 'ja', kanji: '証', reading: 'あかし', word: '', line: '' }, old)
  await recordCustomerEvent(store, { browser: B3, email: 'keep@example.com' }, 'ordered_paid', { order: '#1001', ref: 'IC-20261010-AAAAAAAA' }, old)
  const day31 = at('2026-11-10T01:00:00Z') // 31 days after
  const day29 = at('2026-11-08T01:00:00Z')
  const early = await sweepCustomers(store, day29)
  check('(2) at 29 days nothing is deleted', early.deleted === 0 && (await readCustomer(store, B1)) !== null)
  const sweep = await sweepCustomers(store, day31)
  check('(2) a 31-day-old record with no order is deleted, with its basket items and its token', sweep.deleted === 1 && (await readCustomer(store, B1)) === null && !store.objects.has(`basket/${itemIdFor(STORY, 'ja', '証')}.json`) && ![...store.objects.keys()].some((k) => k.startsWith('basket/tok/')))
  check('(2) a record with an order is kept with the order', (await readCustomer(store, emailCustomerId('keep@example.com')))?.has_order === true)
}

// ---- 3. the basket ------------------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const save = (browser: string, kanji = '証', story = STORY) => saveBasketItem(store, browser, { resume: { story, kanji, result: { n: 1 } }, story, language: 'en', kanji, reading: 'akari', word: 'lamp', line: 'The light left on.', to: 'Kenji', from: 'Brian', preview_id: 'AN-' + 'abcdefghjkmnpqrstuvw' }, NOW)
  const a = await save(B1)
  const b = await save(B1)
  const list = await listBasket(store, B1)
  check('(3) a result page creates exactly one basket item: opening the same result again is the same item', a.ok && b.ok && a.id === b.id && a.created === true && b.created === false && list.items.length === 1 && list.items[0].card.kanji === '証' && list.items[0].to === 'Kenji')
  check('(3) the item holds the card, the language, the names and the preview id — and saving calls no model (the engine and the film are never touched here)', list.items[0].preview_id === 'AN-abcdefghjkmnpqrstuvw' && list.items[0].language === 'en')
  const other = await save(B1, '憶')
  check('(3) another character is another item', a.ok && other.ok && other.id !== a.id && (await listBasket(store, B1)).items.length === 2)
  check('(3) another browser has its own, empty basket (an email never opens a basket)', (await listBasket(store, B3)).items.length === 0 && (await readBasketItem(store, B3, a.ok ? a.id : '')) === null)
  const token = a.ok ? a.token : ''
  check('(3) the private link: a random, unguessable token, shared by the customer\'s items', /^BT-[a-z2-9]{24}$/.test(token) && (other.ok ? other.token : '') === token)
  const fresh = await openBasketLink(store, B3, token)
  check('(3) /b/<token> opens the basket in a fresh browser and links that browser to the same record', !!fresh && fresh.items.length === 2 && (await listBasket(store, B3)).items.length === 2 && (await readBasketItem(store, B3, a.ok ? a.id : ''))?.card.kanji === '証')
  check('(3) the private link never shows an email (the answer has no email)', !JSON.stringify(fresh).includes('@'))
  check('(3) a wrong token gives nothing (the page then shows the normal landing)', (await openBasketLink(store, B2, 'BT-' + 'z'.repeat(24))) === null && (await openBasketLink(store, B2, 'nonsense')) === null)
  check('(3) "×" deletes at once — the item, and only for its owner', (await deleteBasketItem(store, B2, a.ok ? a.id : '')) === false && (await deleteBasketItem(store, B1, a.ok ? a.id : '')) === true && (await listBasket(store, B1)).items.length === 1 && !store.objects.has(`basket/${a.ok ? a.id : ''}.json`))
  await removeOrderedItem(store, B1, STORY, 'en', '憶')
  check('(3) the item that was ordered leaves the basket; the others stay', (await listBasket(store, B1)).items.length === 0)
  const keep = await save(B1, '証')
  const keep2 = await save(B1, '憶')
  await removeOrderedItem(store, B1, STORY, 'en', '憶')
  check('(3) …only that one: ordering 憶 leaves 証 in the basket', keep.ok && keep2.ok && (await listBasket(store, B1)).items.map((x) => x.card.kanji).join() === '証')
  {
    const s2 = new MemoryOrderStore()
    await saveBasketItem(s2, B1, { resume: { story: STORY }, story: STORY, language: 'en', kanji: '証', reading: '', word: '', line: '' }, NOW)
    await recordCustomerEvent(s2, { browser: B1, email: 'owner@example.com' }, 'held', {}, NOW)
    await recordCustomerEvent(s2, { browser: B2, email: 'owner@example.com' }, 'held', {}, NOW)
    check('(3) an email never opens a basket: another browser that gives the same email (a hold, an order) sees nothing of it; the browser that saved it still does', (await listBasket(s2, B2)).items.length === 0 && (await listBasket(s2, B1)).items.length === 1 && (await readBasketItem(s2, B2, itemIdFor(STORY, 'en', '証'))) === null)
  }
  const big = await saveBasketItem(store, B1, { resume: { story: 'x'.repeat(300_000) }, story: STORY, language: 'en', kanji: '証', reading: '', word: '', line: '' }, NOW)
  check('(3) an oversized item is refused (no storage for anything)', !big.ok && big.code === 'too_large')
}

// ---- 4 + 5. the live count, the email holds, and the free gift in Shopify ------------------------------------------------------------------------------
const fakeShopify = () => {
  const eligible = new Map<string, string>()
  const calls: string[] = []
  let broken = false
  const api: PromoShopify = {
    async addEligible(email) {
      if (broken) throw new Error('scope')
      const id = `gid://shopify/Customer/${emailCustomerId(email).slice(1, 9)}`
      eligible.set(id, email)
      calls.push(`add:${email}`)
      return id
    },
    async removeEligible(id) {
      eligible.delete(id)
      calls.push(`remove:${id}`)
    },
    async saveConsent(email) {
      calls.push(`consent:${email}`)
    },
  }
  return { api, eligible, calls, setBroken: (b: boolean) => (broken = b) }
}
const deps = (store: MemoryOrderStore, shopify: PromoShopify | null, now: Date, env = ENV): PromoDeps => ({ store, env, now: () => now, shopify })
const usedSlots = async (store: MemoryOrderStore, day: string, n: number) => { for (let i = 1; i <= n; i++) await store.putObject(`promo/${day}/slots/${i}-1.json`, JSON.stringify({ hold: 'H-' + 'x'.repeat(16), email_hash: 'f'.repeat(32), created_at: NOW.toISOString(), expires_at: NOW.toISOString(), state: 'used' }), 'application/json') }
{
  resetPromoCache()
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  await usedSlots(store, '2026-11-18', 98)
  const c0 = await liveCount(store, ENV, NOW, true)
  const h1 = await placeHold(deps(store, sh.api, NOW), { email: 'one@example.com', code: 'THANKS100', browser: B1 })
  const c1 = await liveCount(store, ENV, NOW, true)
  check('(4) the count: with 98 used and 1 active hold the card shows 1 (100 − 98 − 1)', c0.left === 2 && h1.ok && c1.left === 1 && c1.used === 98 && c1.active === 1, JSON.stringify([c0, c1]))
  const h2 = await placeHold(deps(store, sh.api, NOW), { email: 'two@example.com', code: 'thanks100', browser: B2 })
  const h3 = await placeHold(deps(store, sh.api, NOW), { email: 'three@example.com', code: 'THANKS100', browser: B3 })
  check('(4) a second email holds the last gift; a third email sees "all held or given" (no hold)', h2.ok && !h3.ok && h3.code === 'all_held' && (await liveCount(store, ENV, NOW, true)).left === 0)
  check('(5) a hold adds the customer to the discount\'s eligible list (and only the holders are on it)', sh.eligible.size === 2 && [...sh.eligible.values()].sort().join() === 'one@example.com,two@example.com')
  check('(4) the count is never below 0', (await liveCount(store, ENV, NOW, true)).left === 0)
  // expiry: 120 minutes later the held gifts are free again, the customers come off the eligible list, hold_expired is on the timeline
  const later = new Date(NOW.getTime() + 121 * MIN)
  const shL = sh
  const reaped = await reapExpired(deps(store, shL.api, later))
  const c2 = await liveCount(store, ENV, later, true)
  check('(4) a hold expires at 120 minutes and the count rises again', reaped === 2 && c2.left === 2 && c2.active === 0)
  check('(5) expiry removes the customers from the eligible list, and puts hold_expired on their timeline', sh.eligible.size === 0 && (await readCustomer(store, emailCustomerId('one@example.com')))!.events.some((e) => e.code === 'hold_expired'))
  // "Your hold ended. Hold again?": one tap re-holds with the same email (the next hold of the day)
  const again = await placeHold(deps(store, sh.api, later), { email: 'one@example.com', code: 'THANKS100', browser: B1 })
  check('(4) after expiry the same email can hold again (counts as the next hold): count 2', again.ok && !again.existing && again.hold.count === 2)
}
{
  resetPromoCache()
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  const a = await placeHold(deps(store, sh.api, NOW), { email: 'Same@Example.com', code: 'THANKS100', browser: B1 })
  const later = new Date(NOW.getTime() + 30 * MIN)
  const b = await placeHold(deps(store, sh.api, later), { email: 'same@example.com', code: 'THANKS100', browser: B2 })
  check('(4) one hold per email: the same email from two browsers gives ONE hold, the expiry unchanged, the second browser added to it', a.ok && b.ok && b.existing && a.hold.id === b.hold.id && a.hold.expires_at === b.hold.expires_at && (await liveCount(store, ENV, later, true)).active === 1)
  const mine = await holdOfBrowser(store, B1, later)
  check('(4) the browser that holds finds its hold (the card then says "held until …")', a.ok && !!mine && mine.view.id === a.hold.id && mine.view.minutes_left === 90)
  check('(4) the hold lasts 120 minutes from now', a.ok && Date.parse(a.hold.expires_at) - NOW.getTime() === 120 * MIN)
  const bad = await placeHold(deps(store, sh.api, NOW), { email: 'not an email', code: 'THANKS100' })
  // since 2026-11-15 no code is needed: a missing or wrong code still holds (the record keeps the code only when it is a configured one)
  const badCode = await placeHold(deps(store, sh.api, NOW), { email: 'wrong-code@example.com', code: 'WRONG' })
  const noCode = await placeHold(deps(store, sh.api, NOW), { email: 'no-code@example.com' })
  check('(5) the free gift needs no code: no code or a wrong one still holds (code kept only when configured); an invalid email is refused', !bad.ok && bad.code === 'bad_email' && badCode.ok && badCode.hold.code === null && noCode.ok && noCode.hold.code === null, JSON.stringify([badCode, noCode]))
  const second = await placeHold(deps(store, sh.api, NOW), { email: 'x@example.com', code: 'PLATFORM2', browser: B3 })
  check('(5) a second configured public code works too (one code per platform), and the hold remembers which code it came with', second.ok && second.hold.code === 'PLATFORM2')
  const off = await placeHold(deps(store, sh.api, at('2026-11-26T15:00:00Z')), { email: 'late@example.com', code: 'THANKS100' })
  check('(1) outside the window no hold can be placed', !off.ok && off.code === 'off')
}
{
  // three holds a day, then the three-holds message; and "already received today's free gift"
  resetPromoCache()
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  let t = NOW
  const place = () => placeHold(deps(store, sh.api, t), { email: 'busy@example.com', code: 'THANKS100', browser: B1 })
  const r: string[] = []
  for (let i = 0; i < 3; i++) {
    const x = await place()
    r.push(x.ok ? `ok${x.hold.count}` : x.code)
    t = new Date(t.getTime() + 121 * MIN)
    await reapExpired(deps(store, sh.api, t))
  }
  const fourth = await place()
  check('(4) three holds a day: the fourth hold the same day is refused with the three-holds line', r.join() === 'ok1,ok2,ok3' && !fourth.ok && fourth.code === 'three_holds', JSON.stringify([r, fourth]))
  const store2 = new MemoryOrderStore()
  const sh2 = fakeShopify()
  const h = await placeHold(deps(store2, sh2.api, NOW), { email: 'given@example.com', code: 'THANKS100', browser: B1 })
  const used = await markHoldUsed(deps(store2, sh2.api, new Date(NOW.getTime() + 10 * MIN)), { email: 'given@example.com', holdId: h.ok ? h.hold.id : null })
  const after = await placeHold(deps(store2, sh2.api, new Date(NOW.getTime() + 20 * MIN)), { email: 'given@example.com', code: 'THANKS100', browser: B1 })
  check('(5) the paid ($0) webhook marks the hold USED (by hold id or email), takes the customer off the eligible list at once, and puts hold_used on the timeline', used && sh2.eligible.size === 0 && (await readCustomer(store2, emailCustomerId('given@example.com')))!.events.some((e) => e.code === 'hold_used'))
  check('(4) this email already received today\'s free gift: no new hold ("You\'ve already given today\'s free gift.")', !after.ok && after.code === 'already_given' && (await liveCount(store2, ENV, NOW, true)).used === 1)
  check('(4) a used gift stays used for the day (the count: 1 given, 0 held)', (await liveCount(store2, ENV, new Date(NOW.getTime() + 500 * MIN), true)).used === 1)
}
{
  // (E, 2026-11-16) one free gift per person for the WHOLE promotion (Shopify: THANKS100 once per customer): an email that used its gift yesterday cannot hold today — in either language
  resetPromoCache()
  const DAY = 24 * 60 * MIN
  for (const [lang, email] of [['en', 'yesterday-en@example.com'], ['ja', 'yesterday-ja@example.com']] as const) {
    const store = new MemoryOrderStore()
    const sh = fakeShopify()
    const y = await placeHold(deps(store, sh.api, NOW), { email, code: '', browser: B1, language: lang })
    await markHoldUsed(deps(store, sh.api, new Date(NOW.getTime() + 10 * MIN)), { email, holdId: y.ok ? y.hold.id : null })
    const tomorrow = new Date(NOW.getTime() + DAY)
    const again = await placeHold(deps(store, sh.api, tomorrow), { email, code: '', browser: B2, language: lang })
    const fresh = await placeHold(deps(store, sh.api, tomorrow), { email: `new-${lang}@example.com`, code: '', browser: B3, language: lang })
    check(`(E) ${lang}: an email that used its free gift yesterday cannot hold today ("already received"); a new email can`, y.ok && !again.ok && again.code === 'already_given' && fresh.ok, JSON.stringify([again, fresh.ok]))
    // a gift used before the promotion-wide marker existed: found by reading the earlier days' holds
    const marker = `promo/used/${emailHashOf(email)}.json`
    const hadMarker = store.objects.has(marker)
    store.objects.delete(marker)
    resetPromoCache()
    const again2 = await placeHold(deps(store, sh.api, new Date(tomorrow.getTime() + 2 * DAY)), { email, code: '', browser: B2, language: lang === 'en' ? 'ja' : 'en' })
    check(`(E) ${lang}: the use writes a promotion-wide marker; without it (an older gift) the gift is still found on its day, and from the other language's page too`, hadMarker && !again2.ok && again2.code === 'already_given' && store.objects.has(marker), JSON.stringify(again2))
  }
  check('(E) the message for it (en): "This email has already received its free gift. Thank you. You can give this one for $17.50."', holdRefusal('already_given', '$17.50') === 'This email has already received its free gift. Thank you. You can give this one for $17.50.')
  check('(E) the message for it (ja): 「このメールアドレスでは、すでに無料ギフトをお受け取りいただいています。ありがとうございます。この贈りものは ¥3,980 でお贈りいただけます。」', holdRefusal('already_given', '¥3,980', 'ja') === 'このメールアドレスでは、すでに無料ギフトをお受け取りいただいています。ありがとうございます。この贈りものは ¥3,980 でお贈りいただけます。')
  // (E2) no customer-facing string says "per person per day" / 「1日1回」
  const files = ['src/loop/copy.ts', 'src/gift/ceremony/copy.ts', 'src/legal/legal-copy.ts', 'src/demo/i18n.ts', 'src/reveal/copy.ts', 'src/demo/sizes-copy.ts']
  const bad = files.filter((f) => /per person per day|1日1回|一人一日/.test(readFileSync(f, 'utf8')))
  check('(E) no customer-facing string contains "per person per day" or 「1日1回」 (card, order section, ceremony, /legal, landing, order form)', bad.length === 0, bad.join())
}
{
  // two instances racing for the last gift: exactly one hold
  resetPromoCache()
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  await usedSlots(store, '2026-11-18', 99)
  const emails = Array.from({ length: 12 }, (_, i) => `racer${i}@example.com`)
  const results = await Promise.all(emails.map((e, i) => placeHold(deps(store, sh.api, NOW), { email: e, code: 'THANKS100', browser: 'V' + String(i).padStart(22, 'q') })))
  const won = results.filter((x) => x.ok).length
  const slots = [...store.objects.keys()].filter((k) => k.startsWith('promo/2026-11-18/slots/100-'))
  check('(4) concurrency: twelve racers for the last gift produce exactly ONE hold (one slot object, one winner)', won === 1 && slots.length === 1, `${won} ${slots.join()}`)
  check('(5) …and exactly one customer is on the eligible list (the others were released)', sh.eligible.size === 1, String(sh.eligible.size))
}
{
  // the held cart carries the code, the email and the hold id; an unheld cart carries nothing; ja / zh are byte-identical
  resetPromoCache()
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  const h = await placeHold(deps(store, sh.api, NOW), { email: 'cart@example.com', code: 'THANKS100', browser: B1 })
  const cfg = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config!
  const bodies: { query: string; variables: { input: Record<string, any> } }[] = []
  const f = ((cb: string) => (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: cb, cost: { totalAmount: { amount: '0.00', currencyCode: 'USD' } } }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch)('https://soul-id-2.myshopify.com/cart/c/abc?key=k')
  const held = await holdForCart(deps(store, sh.api, NOW), { browser: B1 })
  await createCart(cfg, 'egift', [{ key: '_kanji', value: '証' }], 'IC-20261118-ABCDEFGH', f, 'en', held ? { code: held.code, email: held.rec.email, holdId: held.rec.id } : undefined)
  const inp = bodies[0].variables.input
  check('(5) a held cart carries THANKS100, the hold\'s email (buyerIdentity.email) and the hold id (a cart attribute)', !!held && inp.discountCodes?.[0] === 'THANKS100' && inp.buyerIdentity.email === 'cart@example.com' && inp.buyerIdentity.countryCode === 'US' && inp.attributes.some((a: { key: string; value: string }) => a.key === 'ichirei_hold' && a.value === (h.ok ? h.hold.id : '')), JSON.stringify(inp))
  const nobody = await holdForCart(deps(store, sh.api, NOW), { browser: B3 })
  bodies.length = 0
  await createCart(cfg, 'egift', [{ key: '_kanji', value: '証' }], 'IC-20261118-ABCDEFGH', f, 'en', nobody ? { code: nobody.code, email: nobody.rec.email, holdId: nobody.rec.id } : undefined)
  check('(5) an unheld cart carries no code and no email', nobody === null && bodies[0].variables.input.discountCodes === undefined && bodies[0].variables.input.buyerIdentity.email === undefined)
  const OLD_QUERY = `mutation CartCreate($input: CartInput!) {\n  cartCreate(input: $input) {\n    cart { id checkoutUrl cost { totalAmount { amount currencyCode } } }\n    userErrors { field message }\n  }\n}`
  for (const lang of ['ja', 'zh-Hant', 'zh-Hans']) {
    const raw: string[] = []
    const fj = (async (_u: string, init: RequestInit) => { raw.push(String(init.body)); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/abc?key=k', cost: { totalAmount: { amount: '3980', currencyCode: 'JPY' } } }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
    await createCart(cfg, 'egift', [{ key: '_kanji', value: '証' }], 'IC-20261118-ABCDEFGH', fj, lang)
    const want = JSON.stringify({ query: OLD_QUERY, variables: { input: { lines: [{ merchandiseId: cfg.variants.egift, quantity: 1, attributes: [{ key: '_kanji', value: '証' }] }], attributes: [{ key: 'order_ref', value: 'IC-20261118-ABCDEFGH' }] } } })
    check(`(5) ${lang}: the cart request body is byte-identical to 258da52 (no code, no email, no hold)`, raw[0] === want, raw[0])
  }
  // 2026-11-16: a JAPANESE holder's cart carries THANKS100, the hold's email and the hold id (the ja cart is in JPY; the e-gift totals ¥0); a ja non-holder's cart is exactly as before (above)
  {
    const rawJ: string[] = []
    const fJ = (async (_u: string, init: RequestInit) => { rawJ.push(String(init.body)); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/abc?key=k', cost: { totalAmount: { amount: '0', currencyCode: 'JPY' } } }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
    const r = await createCart(cfg, 'egift', [{ key: '_kanji', value: '証' }], 'IC-20261118-ABCDEFGH', fJ, 'ja', held ? { code: held.code, email: held.rec.email, holdId: held.rec.id } : undefined)
    const body = JSON.parse(rawJ[0]) as { query: string; variables: { input: Record<string, any> } }
    const inJ = body.variables.input
    check('(A) ja: a holder\'s cart carries THANKS100, the hold\'s email (buyerIdentity.email, no US country) and the hold id; it is the ja mutation (no @inContext) and Shopify totals it ¥0 in JPY', !!held && inJ.discountCodes?.[0] === 'THANKS100' && inJ.buyerIdentity?.email === 'cart@example.com' && inJ.buyerIdentity?.countryCode === undefined && inJ.attributes.some((a: { key: string; value: string }) => a.key === 'ichirei_hold') && !/@inContext/.test(body.query) && r.currency === 'JPY', rawJ[0])
  }
  // the checkout grace: 30 minutes more once the owner of the hold goes to checkout
  const late = new Date(NOW.getTime() + 110 * MIN)
  const view = held ? await startCheckout(deps(store, sh.api, late), held.rec) : null
  check('(4) at checkout the hold goes to "checkout" and lives 30 minutes more (never shorter)', !!view && view.state === 'checkout' && Date.parse(view.expires_at) === late.getTime() + 30 * MIN, JSON.stringify(view))
  // the Admin API calls themselves (fake Admin API): the eligible list is changed with discountCodeBasicUpdate, add then remove
  const sent: { query: string; variables: Record<string, any> }[] = []
  const fakeAdmin = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)) as { query: string; variables: Record<string, any> }
    sent.push(b)
    if (/customers\(first/.test(b.query)) return new Response(JSON.stringify({ data: { customers: { nodes: [] } } }), { status: 200 })
    if (/customerCreate/.test(b.query)) return new Response(JSON.stringify({ data: { customerCreate: { customer: { id: 'gid://shopify/Customer/55' }, userErrors: [] } } }), { status: 200 })
    if (/discountCodeBasicUpdate/.test(b.query)) return new Response(JSON.stringify({ data: { discountCodeBasicUpdate: { codeDiscountNode: { id: b.variables.id }, userErrors: [] } } }), { status: 200 })
    return new Response(JSON.stringify({ data: {} }), { status: 200 })
  }) as typeof fetch
  const real = promoShopifyFrom(ENV, { get: async () => 'tok', clear() {} } as never, fakeAdmin, { config: { apiBase: 'https://shop.example', apiVersion: '2026-01' } as never, secret: async () => 's' })
  const cid = await real!.addEligible('Real@Example.com')
  await real!.removeEligible(cid)
  const upd = sent.filter((x) => /discountCodeBasicUpdate/.test(x.query))
  check('(5) the real client: customerCreate for the email, then discountCodeBasicUpdate on THANKS100\'s id with customers.add; removal with customers.remove', cid === 'gid://shopify/Customer/55' && upd.length === 2 && upd[0].variables.id === 'gid://shopify/DiscountCodeNode/987654' && upd[0].variables.input.customerSelection.customers.add[0] === cid && upd[1].variables.input.customerSelection.customers.remove[0] === cid && sent[1].variables.input.email === 'real@example.com', JSON.stringify(sent.map((x) => x.query.slice(0, 40))))
  const denied = promoShopifyFrom(ENV, { get: async () => 'tok', clear() {} } as never, (async () => new Response(JSON.stringify({ errors: [{ message: 'Access denied for discountCodeBasicUpdate field. Required access: write_discounts' }] }), { status: 200 })) as typeof fetch, { config: { apiBase: 'https://shop.example', apiVersion: '2026-01' } as never, secret: async () => 's' })
  resetPromoCache()
  const st3 = new MemoryOrderStore()
  const noScope = await placeHold(deps(st3, denied, NOW), { email: 'noscope@example.com', code: 'THANKS100', browser: B1 })
  check('(5) if an Admin API call fails or a scope is missing: no hold is placed ("taking a short break"), the slot goes back, promo_unavailable is counted', !noScope.ok && noScope.code === 'unavailable' && (await liveCount(st3, ENV, NOW, true)).left === 100 && [...st3.lines.entries()].some(([k, v]) => k.startsWith('ops/health-') && v.join().includes('promo_unavailable')))
  const nocfg = await placeHold(deps(new MemoryOrderStore(), fakeShopify().api, NOW, { ...ENV, ICHIREI_PROMO_DISCOUNT_ID: '' } as NodeJS.ProcessEnv), { email: 'nocfg@example.com', code: 'THANKS100' })
  check('(5) without the discount id configured no hold is placed either (unavailable), never a broken page', !nocfg.ok && nocfg.code === 'unavailable' && promoConfig({} as NodeJS.ProcessEnv) === null)
}

// ---- the routes (api/loop.ts), with signed browser cookies and an in-memory store --------------------------------------------------------------------------------
{
  const { createLoopHandlers } = await import('../api/loop.ts')
  const { visitorToken, newVisitorId } = await import('../engine/visitor.ts')
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  const env = { ...ENV, ICHIREI_PUBLIC_URL: 'https://ichirei.soul-id.jp' } as NodeJS.ProcessEnv
  const h = createLoopHandlers(() => ({ store, env, now: () => NOW, shopify: sh.api }))
  const idA = newVisitorId()
  const idB = newVisitorId()
  const req = (id: string | null, path: string, init: RequestInit = {}) => new Request(`https://x${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(id ? { cookie: `ic_v=${visitorToken(id, env)}` } : {}), 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' } })
  const body = { resume: { v: 1, story: STORY, result: { candidates: [] } }, story: STORY, language: 'ja', kanji: '証', reading: 'あかし', word: '', line: '一行', to: '一郎', preview_id: null }
  const s1 = await h.basketSave(req(idA, '/api/basket', { method: 'POST', body: JSON.stringify(body) }))
  const j1 = (await s1.json()) as { id: string; token: string; count: number; created: boolean }
  const s2 = await h.basketSave(req(idA, '/api/basket', { method: 'POST', body: JSON.stringify(body) }))
  const j2 = (await s2.json()) as { count: number; created: boolean }
  check('routes: POST /api/basket saves one item (created once, the same item the second time) and answers the count', s1.status === 200 && j1.created && j1.count === 1 && j2.count === 1 && !j2.created && /^BK-/.test(j1.id))
  check('routes: saving without a browser cookie is refused (400), never a crash', (await h.basketSave(req(null, '/api/basket', { method: 'POST', body: JSON.stringify(body) }))).status === 400)
  const me = (await (await h.me(req(idA, '/api/me'))).json()) as { basket: { count: number } }
  check('routes: GET /api/me answers the basket count for this browser (and 0 for another)', me.basket.count === 1 && ((await (await h.me(req(idB, '/api/me'))).json()) as { basket: { count: number } }).basket.count === 0)
  const list = (await (await h.basketList(req(idA, '/api/basket'))).json()) as { items: { id: string }[]; link: string }
  check('routes: GET /api/basket lists the item and the private link https://…/b/<token>', list.items.length === 1 && list.link === `https://ichirei.soul-id.jp/b/${j1.token}`)
  const qr = await h.basketQr(req(idA, '/api/basket/qr.svg'))
  check('routes: the QR is an SVG of that link', qr.status === 200 && (qr.headers.get('content-type') ?? '').includes('svg') && (await qr.text()).includes('<svg'))
  check('routes: another browser cannot read the item by its id', (await h.basketItem(req(idB, `/api/basket/${j1.id}`), j1.id)).status === 404 && (await h.basketItem(req(idA, `/api/basket/${j1.id}`), j1.id)).status === 200)
  check('routes: a wrong token is 404; the right token opens the basket for the other browser (no email in the answer)', (await h.basketLink(req(idB, '/api/b/BT-' + 'z'.repeat(24)), 'BT-' + 'z'.repeat(24))).status === 404 && await (async () => { const r = await h.basketLink(req(idB, `/api/b/${j1.token}`), j1.token); const t = await r.text(); return r.status === 200 && !t.includes('@') && t.includes(j1.id) })())
  check('routes: DELETE removes it at once', (await h.basketDelete(req(idA, `/api/basket/${j1.id}`, { method: 'DELETE' }), j1.id)).status === 200 && ((await (await h.me(req(idA, '/api/me'))).json()) as { basket: { count: number } }).basket.count === 0)
  // the promotion's routes
  resetPromoCache()
  const st = (await (await h.promoState(req(idA, '/api/promo'))).json()) as { on: boolean; left: number; hold: unknown }
  check('routes: GET /api/promo answers on, the count left and no hold yet', st.on === true && st.left === 100 && st.hold === null)
  const bad = (await (await h.promoHold(req(idA, '/api/promo/hold', { method: 'POST', body: JSON.stringify({ email: 'not an email' }) }))).json()) as { ok: boolean; code: string }
  // the card sends only the email (no code since 2026-11-15)
  const good = await h.promoHold(req(idA, '/api/promo/hold', { method: 'POST', body: JSON.stringify({ email: 'Holder@Example.com', marketing: true }) }))
  const gj = (await good.json()) as { ok: boolean; link: string | null; left: number; hold: { minutes_left: number; email: string } }
  check('routes: POST /api/promo/hold — a bad email is {ok:false, bad_email}; an email alone (no code) holds, answers the minutes left, the count and the private link for the phone', !bad.ok && bad.code === 'bad_email' && gj.ok && gj.hold.minutes_left === 120 && gj.hold.email === 'holder@example.com' && gj.left === 99 && !!gj.link && gj.link.startsWith('https://ichirei.soul-id.jp/b/BT-'), JSON.stringify(gj))
  const st2 = (await (await h.promoState(req(idA, '/api/promo'))).json()) as { left: number; hold: { minutes_left: number } | null }
  const st3 = (await (await h.promoState(req(idB, '/api/promo'))).json()) as { hold: unknown }
  check('routes: the browser that holds sees its hold (and the count 99); a browser with no hold sees none', st2.hold?.minutes_left === 120 && st2.left === 99 && st3.hold === null)
  check('routes: the consent was handed to Shopify (the ticked box) and saved on the customer', sh.calls.includes('consent:holder@example.com') && (await readCustomer(store, emailCustomerId('holder@example.com')))?.consent.marketing === true)
  const down = createLoopHandlers(() => ({ store, env, now: () => NOW, shopify: null }))
  resetPromoCache()
  const dj = await down.promoHold(req(idB, '/api/promo/hold', { method: 'POST', body: JSON.stringify({ email: 'other@example.com', code: 'THANKS100' }) }))
  check('routes: with Shopify not reachable the hold answers 503 {ok:false, unavailable} — a message, never a broken page', dj.status === 503 && ((await dj.json()) as { code: string }).code === 'unavailable')
  const off = createLoopHandlers(() => ({ store, env, now: () => at('2026-12-05T15:00:00Z'), shopify: sh.api }))
  check('routes: outside the window /api/promo says on:false', ((await (await off.promoState(req(idA, '/api/promo'))).json()) as { on: boolean }).on === false)
}

// ---- /ops/customers: a customer by email or by Shopify order name, never a moment's text -------------------------------------------------------------------------
{
  const { createCustomerHandlers } = await import('../api/ops-customers.ts')
  const store = new MemoryOrderStore()
  const env = { ...ENV, ICHIREI_OPS_PASSWORD: 'pw-test', SHOPIFY_STORE_DOMAIN: 'soul-id-2.myshopify.com' } as NodeJS.ProcessEnv
  await saveBasketItem(store, B1, { resume: { story: STORY, result: { cards: ['SECRET-CARD-TEXT'] } }, story: STORY, language: 'ja', kanji: '証', reading: 'あかし', word: '', line: 'ひとこと' }, NOW)
  await recordCustomerEvent(store, { browser: B1, email: 'seen@example.com' }, 'tried', {}, NOW)
  await recordCustomerEvent(store, { browser: B1, email: 'seen@example.com' }, 'ordered_paid', { order: '#1018', ref: 'IC-20261118-LOOP0001', amount: 2786 }, NOW)
  const h = createCustomerHandlers(() => ({ store, env, now: () => NOW }))
  const auth = { authorization: 'Basic ' + Buffer.from('owner:pw-test').toString('base64') }
  const get = (q: string, headers: Record<string, string> = auth) => h.page(new Request(`https://x/ops/customers?q=${encodeURIComponent(q)}`, { headers }))
  const byMail = await (await get('Seen@Example.com')).text()
  const byOrder = await (await get('#1018')).text()
  check('ops customers: refused without the password', (await get('seen@example.com', {})).status === 401)
  check('ops customers: found by email and by the Shopify order name, with the timeline, the order, the Shopify admin link and the basket count', byMail.includes('ordered_paid') && byMail.includes('#1018') && byMail.includes('https://admin.shopify.com/store/soul-id-2/orders?query=1018') && byOrder.includes('seen@example.com') && byMail.includes('1件'))
  check('ops customers: no moment text, no card text, no names — never', !byMail.includes('父が駅まで') && !byMail.includes('SECRET-CARD-TEXT') && !byOrder.includes('父が駅まで') && !byMail.includes('ひとこと'))
  check('ops customers: an unknown email says so', (await (await get('nobody@example.com')).text()).includes('customer-none'))
}

// ---- 2026-11-16: ONE pool for /en and the Japanese page ------------------------------------------------------------------------------------------------------
{
  resetPromoCache()
  const store = new MemoryOrderStore()
  const sh = fakeShopify()
  // 60 gifts given on /en and 39 on /ja today (the slots do not know the language: one pool) …
  await usedSlots(store, '2026-11-18', 99)
  // … and one held from the Japanese page
  const hj = await placeHold(deps(store, sh.api, NOW), { email: 'nihon@example.com', code: '', browser: 'V' + 'j'.repeat(22), language: 'ja' })
  const left = (await liveCount(store, ENV, NOW, true)).left
  const he = await placeHold(deps(store, sh.api, NOW), { email: 'usa@example.com', code: '', browser: 'V' + 'u'.repeat(22), language: 'en' })
  const { createLoopHandlers } = await import('../api/loop.ts')
  const { visitorToken, newVisitorId } = await import('../engine/visitor.ts')
  resetPromoCache()
  const loop = createLoopHandlers(() => ({ store, env: ENV, now: () => NOW, shopify: sh.api }))
  const view = async (lang: string) => (await (await loop.promoState(new Request(`https://x/api/promo?lang=${lang}`, { headers: { cookie: `ic_v=${visitorToken(newVisitorId(), ENV)}` } }))).json()) as { left: number }
  const enView = await view('en')
  const jaView = await view('ja')
  check('(A) one pool: 60 given on /en + 39 on /ja + 1 held from /ja → 0 left, on both pages; the next hold from either page is refused ("all held or given")', hj.ok && left === 0 && !he.ok && he.code === 'all_held' && enView.left === 0 && jaView.left === 0, JSON.stringify({ hj: hj.ok, left, he, enView, jaView }))
  check('(A) the Japanese hold is recorded with its language (the customer record), the count is shared', [...store.objects.keys()].some((k) => k.startsWith('customers/')) && hj.ok)
}

console.log(failures === 0 ? '\nAll customer-loop checks passed.' : `\n${failures} customer-loop checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
