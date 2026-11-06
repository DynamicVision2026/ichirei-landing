// Part 3 of the 2026-10-31 ticket — the receiver's gift experience, server side: the running certificate number, the opening date (the closed
// envelope shows names and the date only), the sender's own preview, and the receiver's one thank-you. No network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-gift-experience.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGiftHandlers } from '../api/gift.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { allocateCertificateNo, formatCertificateNo } from '../engine/certificate-no.ts'
import { REPLY_MAX, checkReply, isLocked, lockedView, todayJst, type GiftRecord } from '../engine/gift.ts'
import { picturePath } from '../engine/film-art.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-07T03:00:00Z') // 12:00 JST on 7 Nov 2026
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const body = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'egift', gift_message: 'いつも、ありがとう。', ...over })

// ---- 1. the certificate number: running, unique, never reused ----------------------------------------------------------------------------------
{
  const st = new MemoryOrderStore()
  const a = await allocateCertificateNo(st, 'IC-1', NOW)
  const b = await allocateCertificateNo(st, 'IC-2', NOW)
  check('(1) the first certificate is 0001, the next 0002', a === 1 && b === 2 && formatCertificateNo(a) === '0001' && formatCertificateNo(12) === '0012')
  const many = await Promise.all(Array.from({ length: 25 }, (_, i) => allocateCertificateNo(st, `IC-P${i}`, NOW)))
  check('(1) 25 orders made at the same moment get 25 different numbers, 0003 … 0027, none twice', new Set(many).size === 25 && Math.min(...many) === 3 && Math.max(...many) === 27, many.join())
  await st.putObject('ops/certno/last.json', JSON.stringify({ n: 0 }), 'application/json') // a hint that lags behind: the scan walks over the numbers already taken
  const c = await allocateCertificateNo(st, 'IC-LATE', NOW)
  check('(1) a lagging hint never hands out a number already given (the scan walks forward)', c === 28, String(c))
  check('(1) every number is kept as a small private record of the order that holds it', JSON.parse((await st.getObject('ops/certno/0001.json'))!.toString()).order_ref === 'IC-1')
}

// ---- 2. an order: the number is stored on the order and on the gift; the opening date goes to the gift --------------------------------------------
const mem = new MemoryOrderStore()
const fetchImpl = (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })) as unknown as typeof fetch
const deps = (): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0 } as OrderDeps)
const post = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, unknown> } }
const o1 = await post(body({ sender_email: 'taro@example.com', open_date: '2026-11-10' }))
const o2 = await post(body({ sender_email: 'taro@example.com' }))
const rec1 = (await mem.get(o1.json.order_ref as string)) as { gift_token: string; animation_id: string; certificate_no?: number }
const rec2 = (await mem.get(o2.json.order_ref as string)) as { gift_token: string; certificate_no?: number }
// these tests are about what a COLLECTED gift shows (test-collect.ts covers the locked side): the buyer has pressed 「贈りものを受け取る」
for (const o of [o1, o2]) await mem.put(o.json.order_ref as string, { ...((await mem.get(o.json.order_ref as string)) as object), collected_at: NOW.toISOString() })
const g1 = (await mem.get(rec1.gift_token)) as GiftRecord
const g2 = (await mem.get(rec2.gift_token)) as GiftRecord
check('(2) two orders get two running numbers, kept on the order AND on the gift', rec1.certificate_no === 1 && rec2.certificate_no === 2 && g1.certificate_no === 1 && g2.certificate_no === 2, `${rec1.certificate_no},${rec2.certificate_no}`)
check('(2) the opening date goes to the gift (null when it opens at once)', g1.opens_on === '2026-11-10' && g2.opens_on === null)

// ---- 3. the closed envelope: names and the date, nothing else ------------------------------------------------------------------------------------
const anim = (await mem.get(rec1.animation_id)) as { film?: unknown }
anim.film = { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: [], reason: 'test' }
await mem.put(rec1.animation_id, anim)
await mem.putObject(picturePath(rec1.animation_id, 1), Buffer.from('RIFFxxxxWEBP'), 'image/webp')
const at = (iso: string) => createGiftHandlers(() => ({ store: mem, now: () => new Date(iso) }))
const before = at('2026-11-07T03:00:00Z')
const lockedRes = await before.view(g1.token)
const lockedText = await lockedRes.text()
const locked = JSON.parse(lockedText)
check('(3) before the opening date the page gets the CLOSED ENVELOPE: locked, the two names, the date and the days left (3)', lockedRes.status === 200 && locked.locked === true && locked.to === '山田 一郎' && locked.from === '山田 太郎' && locked.opens_on === '2026-11-10' && locked.days_left === 3, lockedText)
check('(3) …and nothing else leaves the server: no character, reading, poem, message, film, certificate number', !/証|glyph|reading|poem|message|いつも、ありがとう|film|certificate|pictures|AN-/.test(lockedText), lockedText)
check('(3) the pictures, the render, the scroll and the thank-you are all closed too (403)', (await before.picture(g1.token, '1')).status === 403 && (await before.render(g1.token)).status === 403 && (await before.scroll(g1.token, 'png')).status === 403 && (await before.reply(g1.token, { text: 'ありがとう' })).status === 403)
check('(3) the days left count in Japan time: 2 days the day before, and the page is open from the opening date at 00:00 JST', lockedView(g1, new Date('2026-11-08T03:00:00Z')).days_left === 2 && isLocked(g1, new Date('2026-11-09T14:59:59Z')) && !isLocked(g1, new Date('2026-11-09T15:00:00Z')) && todayJst(new Date('2026-11-09T15:00:00Z')) === '2026-11-10')
const opened = await at('2026-11-10T00:30:00Z').view(g1.token)
const openJ = (await opened.json()) as { locked: boolean; glyph: string; certificate_no: number; order_date: string; opens_on: string }
check('(3) on the day it opens: the full view, with the certificate number and the dates', opened.status === 200 && openJ.locked === false && openJ.glyph === '証' && openJ.certificate_no === 1 && openJ.order_date === '2026-11-07' && openJ.opens_on === '2026-11-10', JSON.stringify(openJ).slice(0, 300))
check('(3) a gift with no opening date is never closed', (await before.view(g2.token).then((r) => r.json()) as { locked: boolean }).locked === false)

// ---- 4. the sender can always look -----------------------------------------------------------------------------------------------------------
const pv = await before.view(g1.token, rec1.animation_id)
const pvJ = (await pv.json()) as { locked: boolean; film: { pictures: string[] } | null }
check('(4) with the sender\'s own id the closed gift opens for a preview (and only then)', pvJ.locked === false && (await before.view(g1.token, 'AN-aaaaaaaaaaaaaaaaaaaa')).status === 200 && (JSON.parse(await (await before.view(g1.token, 'AN-aaaaaaaaaaaaaaaaaaaa')).text()) as { locked: boolean }).locked === true)
check('(4) …its pictures carry the key so the sender\'s browser can fetch them before the day; the reply is still closed to a preview', (await before.picture(g1.token, '1', rec1.animation_id)).status === 200 && (await before.reply(g1.token, { text: 'x' })).status === 403)
const sv = (await (await createAnimationHandlers(() => ({ store: mem, now: () => NOW })).view(rec1.animation_id)).json()) as { gift?: { opens_on: string | null; certificate_no: number | null; reply: unknown } }
check('(4) the sender\'s page knows the opening date, the number and (so far) no reply', sv.gift?.opens_on === '2026-11-10' && sv.gift.certificate_no === 1 && sv.gift.reply === null)

// ---- 5. the thank-you: once, 200 characters, on the sender's page ----------------------------------------------------------------------------
{
  const day = at('2026-11-12T03:00:00Z')
  check('(5) an empty reply or one over 200 characters is refused; 200 characters are fine', (await day.reply(g2.token, { text: '  ' })).status === 400 && (await day.reply(g2.token, { text: 'あ'.repeat(REPLY_MAX + 1) })).status === 400 && checkReply({ text: 'あ'.repeat(REPLY_MAX) }).ok)
  const r1 = await day.reply(g2.token, { text: 'ありがとう。\n大切にします。' })
  check('(5) the first reply is kept', r1.status === 200)
  const r2 = await day.reply(g2.token, { text: 'もう一度' })
  check('(5) a second reply is refused (409), the first one stays', r2.status === 409 && ((await mem.get(g2.token)) as GiftRecord).reply?.text === 'ありがとう。 大切にします。')
  const s2 = (await (await createAnimationHandlers(() => ({ store: mem, now: () => NOW })).view(((await mem.get(rec2.gift_token)) as GiftRecord).animation_id)).json()) as { gift?: { reply: { text: string } | null } }
  check('(5) the sender\'s page shows it', s2.gift?.reply?.text === 'ありがとう。 大切にします。')
  const v = JSON.parse(await (await day.view(g2.token)).text())
  check('(5) the receiver\'s page only knows THAT a reply was sent (never the text of anyone else\'s page)', v.replied === true)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll gift-experience checks passed.')
process.exit(failures ? 1 : 0)
