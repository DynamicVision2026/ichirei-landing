// 「贈りものを受け取る」 (ticket 2026-11-06): until the buyer collects, the receiver's link is a sealed envelope that says it is arriving soon, nothing can be sent or saved (the page AND
// the server), the preview watches the final gift but unlocks nothing and never serves an MP4; one tap records the time once and ends the right to cancel; a cancelled order shows only
// "no longer available". Orders made before this button existed are not gated. FAKE Shopify payment lookup, in-memory store, no network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-collect.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnimationHandlers } from '../api/animation.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { buildAnimationRecord, newAnimationId, type AnimationRecord } from '../engine/animation.ts'
import { cancelOrder } from '../engine/change-window.ts'
import { picturePath } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import type { PaymentInfo, PaymentResult } from '../engine/shipping.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const H = 3_600_000
const T0 = new Date('2026-11-06T03:00:00Z')
const at = (h: number) => new Date(T0.getTime() + h * H)
let NOW = at(2)
const store = new MemoryOrderStore()
const pay: Record<string, PaymentInfo | undefined> = {}
const payments = async (refs: string[]): Promise<PaymentResult> => ({ found: new Map(refs.filter((r) => pay[r]).map((r) => [r, pay[r] as PaymentInfo])), failure: null })
const A = createAnimationHandlers(() => ({ store, now: () => NOW, payments }))
const G = createGiftHandlers(() => ({ store, now: () => NOW, payments }))

async function addOrder(ref: string, opts: { legacy?: boolean; art?: boolean; pkg?: 'egift' | 'simple' } = {}) {
  const pkg = opts.pkg ?? 'egift'
  const p = parseOrderRequest({ story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'modern', package: pkg, ...(pkg === 'egift' ? { sender_email: 'taro@example.com' } : { ship_to: 'me' }) }, T0)
  if (!p.ok) throw new Error(p.error)
  const record: OrderRecord = buildRecord(p.order, ref, T0)
  if (opts.legacy) {
    delete record.collect_required
    delete record.collected_at
  }
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim: AnimationRecord = buildAnimationRecord(record, animId, T0)
  anim.gift_token = token
  anim.film = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: Array(4).fill('A woman seen from behind at a quiet kitchen counter in soft morning light'), made_at: T0.toISOString() } as never
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, buildGiftRecord(record, animId, token, p.order.sender_email, T0))
  if (opts.art !== false) {
    for (let i = 1; i <= 4; i++) await store.putObject(picturePath(animId, i), Buffer.from('RIFFxxxxWEBP'), 'image/webp')
    await store.putObject(`films/${animId}/art.json`, JSON.stringify({ schema: 'film-art', id: animId, status: 'done', started_at: T0.toISOString(), made_at: T0.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
  }
  pay[ref] = { state: 'paid', paid_at: T0.toISOString() }
  return { ref, animId, token }
}
const j = async (r: Response) => (await r.json()) as Record<string, any>
const req = (u = 'https://x/api/x') => new Request(u)

// ---- before the tap -------------------------------------------------------------------------------------------------------------------------------
const o = await addOrder('IC-20261106-COLLECT1')
{
  const rec = (await store.get(o.ref)) as OrderRecord
  check('(1) every new order says its gift must be collected first (collect_required) and has no collected_at yet', rec.collect_required === true && !rec.collected_at)
  const bv = await j(await A.view(o.animId))
  check('(1) the buyer page view says collected: false and carries the film (the preview needs it)', bv.order?.collected === false && !!bv.film?.pictures)
  const rv = await G.view(o.token)
  const rvj = await rv.text()
  const parsed = JSON.parse(rvj)
  check('(2) the receiver\'s link is a SEALED ENVELOPE saying it is arriving soon: locked + arriving, the two names, and NOTHING of the character, the poem, the film or the message', rv.status === 200 && parsed.locked === true && parsed.arriving === true && !rvj.includes('証') && !parsed.film && !parsed.poem && !parsed.message && parsed.from === '山田 太郎')
  const prev = await j(await G.view(o.token, o.animId))
  check('(2) the buyer\'s own preview (?preview=<their id>) shows the FINAL gift: the character, the film with its four pictures', prev.glyph === '証' && prev.film?.pictures?.length === 4 && !prev.locked)
  check('(3) the receiver cannot render or fetch a picture before it is collected (403 not_collected); the previewing buyer can', (await G.render(o.token)).status === 403 && (await G.picture(o.token, '1')).status === 403 && (await G.picture(o.token, '1', o.animId)).status === 200)
  const dl = await Promise.all([
    G.filmMake(o.token), G.filmGet(o.token, req()), G.cardPdf(o.token), G.scroll(o.token, 'png'),
    G.filmMake(o.token, o.animId), G.filmGet(o.token, req(), o.animId), G.cardPdf(o.token, o.animId), G.scroll(o.token, 'pdf', o.animId),
    G.filmMakeForSender(o.animId), G.filmGetForSender(o.animId, req()), G.cardPdfForSender(o.animId), G.scrollForSender(o.animId, 'png'),
  ])
  check('(3) NO download is reachable before collecting — the film MP4 (make and get), the card PDF and the story scroll — by the receiver link, by the preview key, or from the buyer\'s own page: all 403', dl.every((r) => r.status === 403), dl.map((r) => r.status).join())
  check('(3) the receiver can neither reply nor give an address before it is collected (403)', (await G.reply(o.token, { text: 'ありがとう' })).status === 403 && (await G.address(o.token, { name: 'x' })).status === 403)
}

// ---- collecting -------------------------------------------------------------------------------------------------------------------------------------
{
  const early = await addOrder('IC-20261106-NOTREADY', { art: false })
  const r0 = await A.collect(early.animId)
  check('(4) the tap is refused while the final gift is still being made (409 not_ready): the pictures are not drawn yet', r0.status === 409 && (await j(r0)).code === 'not_ready' && !((await store.get(early.ref)) as OrderRecord).collected_at)
  const unpaid = await addOrder('IC-20261106-UNPAID01')
  pay[unpaid.ref] = undefined
  check('(4) …and for an order that was never paid (409)', (await A.collect(unpaid.animId)).status === 409)
  NOW = at(3)
  const r1 = await A.collect(o.animId)
  const rec = (await store.get(o.ref)) as OrderRecord
  check('(5) the tap records the time ONCE, server side: 200, collected_at = now', r1.status === 200 && rec.collected_at === at(3).toISOString())
  NOW = at(5)
  const r2 = await j(await A.collect(o.animId))
  check('(5) a second tap changes nothing (the first time stays)', r2.collected_at === at(3).toISOString() && ((await store.get(o.ref)) as OrderRecord).collected_at === at(3).toISOString())
  const bv = await j(await A.view(o.animId))
  check('(5) the buyer page view now says collected: true', bv.order?.collected === true)
  const rv = await j(await G.view(o.token))
  check('(6) the receiver\'s link now opens: the full gift (character, film pictures)', rv.glyph === '証' && rv.film?.pictures?.length === 4 && !rv.locked)
  check('(6) the send/save side works: the receiver\'s render and pictures, and the downloads are no longer refused for being uncollected', (await G.picture(o.token, '1')).status === 200 && (await G.cardPdfForSender(o.animId)).status !== 403 && (await G.scrollForSender(o.animId, 'png')).status !== 403 && (await G.filmMakeForSender(o.animId)).status !== 403)
  const cancel = await cancelOrder({ store, now: NOW, who: 'owner' }, (await store.get(o.ref)) as OrderRecord)
  check('(7) after the tap the order can no longer be cancelled (the owner can only override)', !cancel.ok && cancel.code === 'collected')
  NOW = at(2)
}

// ---- cancelled orders -----------------------------------------------------------------------------------------------------------------------------
{
  const c = await addOrder('IC-20261106-CANCELED')
  const rec = (await store.get(c.ref)) as OrderRecord
  const res = await cancelOrder({ store, now: NOW, who: 'owner' }, rec)
  check('(8) an order inside the window can be cancelled before the tap', res.ok)
  const bv = await A.view(c.animId)
  const rv = await G.view(c.token)
  const bj = await j(bv)
  check('(8) a CANCELLED order: the buyer page and the receiver link both answer 410 — they show nothing of the gift (only the language, for the one-line message)', bv.status === 410 && rv.status === 410 && !JSON.stringify(bj).includes('証') && bj.language === 'ja')
  check('(8) …and nothing can be collected, saved or answered', (await A.collect(c.animId)).status === 410 && (await G.cardPdfForSender(c.animId)).status === 410 && (await G.reply(c.token, { text: 'x' })).status === 410)
  // cancelled in Shopify: the buyer page too
  const s = await addOrder('IC-20261106-SHOPCANC')
  pay[s.ref] = { state: 'cancelled', paid_at: null }
  check('(8) an order Shopify says is cancelled / refunded: the buyer page is gone too', (await A.view(s.animId)).status === 410)
}

// ---- older orders ------------------------------------------------------------------------------------------------------------------------------------
{
  const l = await addOrder('IC-20261106-LEGACY01', { legacy: true })
  const rv = await j(await G.view(l.token))
  const bv = await j(await A.view(l.animId))
  check('(9) an order made before the button existed is not gated: its link works and its page shows collected: true', rv.glyph === '証' && bv.order?.collected === true)
}

console.log(failures ? `\n${failures} collect check(s) FAILED` : '\nAll collect checks passed.')
process.exit(failures ? 1 : 0)
