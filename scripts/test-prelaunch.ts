// Pre-launch safety (2026-11-14): the gates fail closed, no checkout without the gift's records, paid means paid, the client IP is the hop the front end appended.
// (The request limits on the open endpoints are tested on the real server in scripts/test-server.mjs, section K.) No network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-prelaunch.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnimationHandlers } from '../api/animation.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createOrderHandler, ORDER_RECORD_FAILED, type OrderDeps } from '../api/order.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { buyerOrderView, orderGate } from '../engine/buyer.ts'
import { windowOf } from '../engine/change-window.ts'
import { buildGiftRecord, newGiftToken } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { notePayment, paidIn } from '../engine/paid-seen.ts'
import { clientIp } from '../engine/rate-limit.ts'
import { paymentOf } from '../engine/shipping.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { fromAdmin, fromWebhook, isWaiting } from '../engine/waiting.ts'
import { picturePath } from '../engine/film-art.ts'
import { HEALTH_CODES } from '../engine/health.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-14T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const body = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'simple', ship_to: 'egift', sender_email: 'taro@example.com', gift_message: 'いつも、ありがとう。', ...over })

/** A store that can be told to fail a read or a write of some keys. */
class Flaky extends MemoryOrderStore {
  failGet: (ref: string) => boolean = () => false
  failPut: (ref: string) => boolean = () => false
  override async get(ref: string) { if (this.failGet(ref)) throw new Error('boom: story text must never be logged'); return super.get(ref) }
  override async put(ref: string, record: object) { if (this.failPut(ref)) throw new Error('boom'); return super.put(ref, record) }
}

/** An order, its sender page and its receiver page, written the way /api/order writes them. */
async function build(st: MemoryOrderStore, opts: { putOrder?: boolean; collected?: boolean; giftCollectedAt?: string } = {}) {
  const parsed = parseOrderRequest(body(), NOW)
  if (!parsed.ok) throw new Error(parsed.error)
  const record = buildRecord(parsed.order, 'IC-20261114-ABCDEFGH', NOW)
  record.production.certificate.poems = [{ type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: 'あさごとに' }]
  const animId = newAnimationId()
  const token = newGiftToken()
  const anim = buildAnimationRecord(record, animId, NOW)
  anim.gift_token = token
  anim.film = { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: [], reason: 'test' } as never
  const gift = buildGiftRecord(record, animId, token, parsed.order.sender_email, NOW)
  if (opts.giftCollectedAt) gift.collected_at = opts.giftCollectedAt
  record.animation_id = animId
  record.gift_token = token
  await st.put(animId, anim)
  await st.put(token, gift)
  if (opts.putOrder) await st.put(record.order_ref, { ...record, paid_seen_at: NOW.toISOString(), paid_at_seen: NOW.toISOString(), ...(opts.collected ? { collected_at: NOW.toISOString() } : {}) } as never)
  await st.putObject(picturePath(animId, 1), Buffer.from('RIFFxxxxWEBP'), 'image/webp')
  return { record, animId, token }
}
const G = (st: MemoryOrderStore) => createGiftHandlers(() => ({ store: st, now: () => NOW }))
const A = (st: MemoryOrderStore) => createAnimationHandlers(() => ({ store: st, now: () => NOW }))
const text = async (r: Response) => JSON.stringify(await r.json())

// ---- 1. the gates fail closed --------------------------------------------------------------------------------------------------------------------
check('(1) orderGate(null) is held (pending), never open; a gift from before order records existed opens only with its own collected_at', orderGate(null) === 'pending' && orderGate(undefined) === 'pending' && orderGate(null, '2026-10-01T00:00:00Z') === 'ok')
check('(1) buyerOrderView(null) is not collected: nothing unlocks, the page says the gift is being finished', (() => { const v = buyerOrderView(null, null); return v.collected === false && v.finishing === true && v.confirming === false })())
{
  // a gift whose order record is MISSING
  const st = new MemoryOrderStore()
  const { token } = await build(st, { putOrder: false })
  const v = await G(st).view(token)
  const j = await text(v)
  check('(1) missing order record: the receiver\'s link answers the sealed envelope (arriving) — no character, no poem, no message', v.status === 200 && /"arriving":true/.test(j) && !/証|朝ごとに|いつも、ありがとう/.test(j), j)
  const r = await G(st).render(token)
  check('(1) missing order record: render is refused (403 not_collected), nothing is drawn', r.status === 403 && /not_collected/.test(await text(r)))
  check('(1) missing order record: a picture is refused too', (await G(st).picture(token, '1')).status === 403)
  check('(1) missing order record: a reply, the address and the downloads are refused (403)', (await G(st).reply(token, { text: 'x' })).status === 403 && (await G(st).filmMake(token)).status === 403)
}
{
  // a gift whose order record cannot be READ
  const st = new Flaky()
  const { token, record } = await build(st, { putOrder: true, collected: true })
  st.failGet = (ref) => ref === record.order_ref
  const v = await G(st).view(token)
  check('(1) a failed read of the order: 503, and nothing of the gift in the answer', v.status === 503 && !/証|備/.test(await text(v)))
  check('(1) a failed read: render, picture, reply and film are 503 as well', (await G(st).render(token)).status === 503 && (await G(st).picture(token, '1')).status === 503 && (await G(st).reply(token, { text: 'x' })).status === 503 && (await G(st).filmMake(token)).status === 503)
  st.failGet = () => false
  check('(1) …and with the read working again the same collected gift opens', (await G(st).view(token)).status === 200)
}
{
  // an old gift (no order record at all) opens only when the gift itself says it was collected
  const st1 = new MemoryOrderStore()
  const a = await build(st1, { putOrder: false })
  const st2 = new MemoryOrderStore()
  const b = await build(st2, { putOrder: false, giftCollectedAt: '2026-10-20T00:00:00Z' })
  check('(1) an old gift with no order record stays sealed; with collected_at on the gift record it opens', /"arriving":true/.test(await text(await G(st1).view(a.token))) && !/"arriving"/.test(await text(await G(st2).view(b.token))) && (await G(st2).view(b.token)).status === 200)
}
{
  // the buyer's own page
  const st = new MemoryOrderStore()
  const { animId } = await build(st, { putOrder: false })
  const res = await A(st).view(animId)
  const v = (await res.json()) as { gift?: unknown; order?: { finishing?: boolean; collected?: boolean } }
  check('(1) the buyer\'s page with no order record shows no link and no collect button: order.finishing, not collected', res.status === 200 && v.gift === undefined && v.order?.finishing === true && v.order?.collected === false, JSON.stringify(v).slice(0, 300))
  const fl = new Flaky()
  const c = await build(fl, { putOrder: true, collected: true })
  fl.failGet = (ref) => ref === c.record.order_ref
  const r2 = await A(fl).view(c.animId)
  const j2 = (await r2.json()) as { finishing?: boolean; gift?: unknown }
  check('(1) the buyer\'s page when the order cannot be read: 503 {finishing: true} — the page shows the "being finished" line, never the link', r2.status === 503 && j2.finishing === true && j2.gift === undefined)
}

// ---- 2. no checkout without the records ------------------------------------------------------------------------------------------------------------
{
  const mem = new Flaky()
  const carts: unknown[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => { carts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
  const deps = (): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0 } as OrderDeps)
  const post = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, unknown> } }
  const logged: string[] = []
  const oe = console.error
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); }
  const ok = await post(body())
  check('(2) with the records writable the order opens the checkout (unchanged)', ok.status === 200 && typeof ok.json.checkout_url === 'string' && carts.length === 1, JSON.stringify(ok))
  for (const [label, prefix] of [['the sender\'s page record', 'AN-'], ['the receiver\'s page record', 'RG-']] as const) {
    mem.failPut = (ref) => ref.startsWith(prefix)
    const before = carts.length
    const r = await post(body())
    check(`(2) ${label} cannot be written: an error, NO checkout URL, no cart made, and the message is the owner's ja string`, r.status === 503 && r.json.checkout_url === undefined && r.json.code === 'order_record_failed' && r.json.error === 'ただいま混み合っています。少しおいてもう一度お試しください。' && carts.length === before, JSON.stringify(r))
    const en = await post(body({ language: 'en', engine_result: { ...clone(GOLDEN), language: 'en' }, sender_name: 'Emily', receiver_name: 'Margaret' }))
    check(`(2) …in English: "Something went wrong on our side. Please try again in a moment." (${label})`, en.json.error === 'Something went wrong on our side. Please try again in a moment.' && en.json.checkout_url === undefined, JSON.stringify(en))
  }
  mem.failPut = (ref) => ref.startsWith('RG-')
  const zh = await post(body({ language: 'zh-Hant', inscription_style: 'traditional', engine_result: { ...clone(GOLDEN), language: 'zh-Hant' } }))
  check('(2) …in zh-Hant 「目前系統繁忙，請稍後再試一次。」, zh-Hans by OpenCC', zh.json.error === '目前系統繁忙，請稍後再試一次。' && ORDER_RECORD_FAILED['zh-Hans'] === '目前系统繁忙，请稍后再试一次。', JSON.stringify(zh))
  console.error = oe
  const line = logged.find((l) => l.includes('order_record_failed')) ?? ''
  check('(2) the failure is logged as the code order_record_failed with the order reference only — no story, no name, no error text', /order_record_failed/.test(line) && !/山田|駅|boom/.test(logged.join(' ')) && HEALTH_CODES.includes('order_record_failed' as never), logged.join(' | '))
  mem.failPut = () => false
  check('(2) and with the store back the next order goes through', (await post(body())).status === 200)
}

// ---- 3. paid means paid ----------------------------------------------------------------------------------------------------------------------------
{
  const fin = (displayFinancialStatus: string) => ({ displayFinancialStatus, createdAt: '2026-11-14T01:00:00Z', transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-11-14T01:00:05Z' }] })
  const st = (s: string) => paymentOf(fin(s)).state
  check('(3) shipping.paymentOf: PAID → paid; AUTHORIZED → unpaid; PARTIALLY_PAID → unpaid; PARTIALLY_REFUNDED → paid only as a flagged partial refund', st('PAID') === 'paid' && st('AUTHORIZED') === 'unpaid' && st('PARTIALLY_PAID') === 'unpaid' && paymentOf(fin('PARTIALLY_REFUNDED')).partially_refunded === true && paymentOf(fin('PAID')).partially_refunded === undefined)
  const adm = (s: string) => ({ name: '#1001', email: 'a@b.co', displayFinancialStatus: s, createdAt: '2026-11-14T01:00:00Z', lineItems: { nodes: [{ sku: 'ICHIREI-EGIFT', customAttributes: [] }] }, transactions: [] })
  check('(3) waiting.fromAdmin: only PAID is paid (AUTHORIZED, PARTIALLY_PAID, PARTIALLY_REFUNDED are not)', fromAdmin(adm('PAID')).paid === true && !fromAdmin(adm('AUTHORIZED')).paid && !fromAdmin(adm('PARTIALLY_PAID')).paid && !fromAdmin(adm('PARTIALLY_REFUNDED')).paid)
  const hook = (s: string) => ({ name: '#1001', email: 'a@b.co', financial_status: s, line_items: [{ sku: 'ICHIREI-EGIFT', properties: [] }], created_at: '2026-11-14T01:00:00Z' })
  check('(3) waiting.fromWebhook: only "paid" is paid (authorized, partially_paid, partially_refunded are not) — and such an order is never a waiting order', fromWebhook(hook('paid'))!.paid === true && !fromWebhook(hook('authorized'))!.paid && !fromWebhook(hook('partially_paid'))!.paid && !fromWebhook(hook('partially_refunded'))!.paid && isWaiting(fromWebhook(hook('paid'))!) && !isWaiting(fromWebhook(hook('authorized'))!))
  // the window / the order page: AUTHORIZED and PARTIALLY_PAID say "confirming" (phase unpaid), a partial refund keeps a SEEN payment and nothing else
  const rec = (seen: boolean) => ({ ...buildRecord(parseOrderRequest(body(), NOW).ok ? (parseOrderRequest(body(), NOW) as { ok: true; order: never }).order : (null as never), 'IC-20261114-ZZZZZZZZ', NOW), ...(seen ? { paid_seen_at: NOW.toISOString(), paid_at_seen: '2026-11-14T01:00:05Z' } : {}) })
  const phase = (s: string, seen: boolean) => windowOf(rec(seen) as never, paymentOf(fin(s)), NOW).phase
  check('(3) the order page: AUTHORIZED and PARTIALLY_PAID are "confirming" (phase unpaid); PAID is paid', phase('AUTHORIZED', false) === 'unpaid' && phase('PARTIALLY_PAID', false) === 'unpaid' && phase('PAID', false) === 'open')
  check('(3) PARTIALLY_REFUNDED stays paid only if paid_seen_at was already there; never a first sighting', phase('PARTIALLY_REFUNDED', true) === 'open' && phase('PARTIALLY_REFUNDED', false) === 'unpaid' && paidIn(paymentOf(fin('PARTIALLY_REFUNDED')), rec(true) as never) && !paidIn(paymentOf(fin('PARTIALLY_REFUNDED')), rec(false) as never))
  const s2 = new MemoryOrderStore()
  const r0 = rec(false) as never
  await s2.put((r0 as { order_ref: string }).order_ref, r0)
  const noted = await notePayment(s2, r0, paymentOf(fin('PARTIALLY_REFUNDED')), NOW)
  const noted2 = await notePayment(s2, r0, paymentOf(fin('AUTHORIZED')), NOW)
  const noted3 = await notePayment(s2, r0, paymentOf(fin('PAID')), NOW)
  check('(3) payment is "seen" (paid_seen_at written) only for PAID: not for PARTIALLY_REFUNDED, AUTHORIZED or PARTIALLY_PAID', !(noted as { paid_seen_at?: string }).paid_seen_at && !(noted2 as { paid_seen_at?: string }).paid_seen_at && !!(noted3 as { paid_seen_at?: string }).paid_seen_at)
}

// ---- 4. the client IP ------------------------------------------------------------------------------------------------------------------------------
check('(4) the client IP is the LAST X-Forwarded-For entry (the hop Cloud Run appends); a forged first hop changes nothing', clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } })) === '203.0.113.9' && clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' } })) === '203.0.113.9' && clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.9' } })) === '203.0.113.9' && clientIp(new Request('http://x')) === 'unknown')

console.log(failures === 0 ? '\nAll pre-launch checks passed.' : `\n${failures} pre-launch checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
