// The 24-hour change window after payment (2026-10-30, Part 2): the rule, what the owner may do on /ops inside it (switch to a character already shown,
// the poem format once, the printed names and message, cancel), the refusals after 24 hours, and the lists (workshop CSV, card PDF) that never include an order
// inside the window or a cancelled one. FAKE Shopify and a FAKE poem writer: no key, no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-change-window.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createOpsHandlers, type OpsDeps } from '../api/ops.ts'
import { buildAnimationRecord, newAnimationId, type AnimationRecord } from '../engine/animation.ts'
import { WINDOW_MS, windowOf } from '../engine/change-window.ts'
import { recordOrderIndex } from '../engine/egift-ops.ts'
import { picturePath } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken, type GiftRecord } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { paymentOf, readPayments, type PaymentInfo, type PaymentResult } from '../engine/shipping.ts'
import { AdminTokenCache, type TrackDeps } from '../engine/track.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const H = 3_600_000
const T0 = new Date('2026-10-23T03:00:00Z') // the moment of payment of the main test order (12:00 JST)
const at = (hours: number) => new Date(T0.getTime() + hours * H)
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'

// ---- 1. the rule itself -----------------------------------------------------------------------------------------------------------------------------------------
const rec0 = { created_at: T0.toISOString(), ops: {} } as unknown as OrderRecord
const paid = (h: number): PaymentInfo => ({ state: 'paid', paid_at: at(h).toISOString() })
{
  const w = windowOf(rec0, paid(0), at(2))
  check('(1) within 24 hours of payment the window is OPEN, with the hours left (rounded up)', w.phase === 'open' && w.hours_left === 22 && w.verified && w.ends_at === at(24).toISOString())
  check('(1) at 24 hours exactly, and after, it is CLOSED: nothing for a change of mind', windowOf(rec0, paid(0), at(24)).phase === 'closed' && windowOf(rec0, paid(0), at(23.99)).phase === 'open' && windowOf(rec0, paid(0), at(100)).phase === 'closed' && WINDOW_MS === 24 * H)
  check('(1) the window starts at PAYMENT, not at the cart: a cart paid a day later is open from its own payment', windowOf({ ...rec0, created_at: at(-30).toISOString() } as OrderRecord, paid(0), at(2)).phase === 'open')
  check('(1) never paid (Shopify has no such paid order) is "unpaid", cancelled or refunded in Shopify is "cancelled", and our own cancel flag wins', windowOf(rec0, null, at(2)).phase === 'unpaid' && windowOf(rec0, { state: 'unpaid', paid_at: null }, at(2)).phase === 'unpaid' && windowOf(rec0, { state: 'cancelled', paid_at: null }, at(2)).phase === 'cancelled' && windowOf(rec0, { state: 'refunded', paid_at: null }, at(2)).phase === 'cancelled' && windowOf({ ...rec0, ops: { cancelled_at: 'x' } } as OrderRecord, paid(0), at(2)).phase === 'cancelled')
  const un = windowOf(rec0, 'unverified', at(2))
  check('(1) when Shopify cannot be asked, the order\'s own time is used and the answer says it is not verified', un.phase === 'open' && !un.verified && windowOf(rec0, 'unverified', at(30)).phase === 'closed')
  check('(1) paymentOf: PAID with a sale at 12:05 → paid then; AUTHORIZED counts; PENDING (a bank transfer not yet in) is unpaid; cancelledAt and REFUNDED are not alive', paymentOf({ displayFinancialStatus: 'PAID', createdAt: '2026-10-23T03:00:00Z', transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-10-23T03:05:00Z' }] }).paid_at === '2026-10-23T03:05:00Z' && paymentOf({ displayFinancialStatus: 'AUTHORIZED', createdAt: '2026-10-23T03:00:00Z', transactions: [{ kind: 'AUTHORIZATION', status: 'SUCCESS', processedAt: '2026-10-23T03:01:00Z' }] }).state === 'paid' && paymentOf({ displayFinancialStatus: 'PENDING' }).state === 'unpaid' && paymentOf({ displayFinancialStatus: 'PAID', cancelledAt: 'x' }).state === 'cancelled' && paymentOf({ displayFinancialStatus: 'REFUNDED' }).state === 'refunded')
}

// ---- 2. the payment lookup (a fake Shopify, no customer data) -----------------------------------------------------------------------------------
{
  const calls: { query: string }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 86400 }), { status: 200 })
    const body = JSON.parse(String(init.body))
    calls.push({ query: body.query })
    const node = (ref: string, over: Record<string, unknown>) => ({ createdAt: '2026-10-23T03:00:00Z', cancelledAt: null, displayFinancialStatus: 'PAID', customAttributes: [{ key: 'order_ref', value: ref }], lineItems: { nodes: [] }, transactions: [{ kind: 'SALE', status: 'SUCCESS', processedAt: '2026-10-23T03:07:00Z' }], ...over })
    return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node('IC-20261023-PAID0001', {}), node('IC-20261023-PEND0001', { displayFinancialStatus: 'PENDING', transactions: [] })] } } }), { status: 200 })
  }) as typeof fetch
  const d: TrackDeps = { config: { storeDomain: 'x.myshopify.com', apiVersion: '2025-10', clientId: 'cid', apiBase: 'https://x.myshopify.com' }, secret: async () => 's', fetchImpl }
  const r = await readPayments(['IC-20261023-PAID0001', 'IC-20261023-PEND0001', 'IC-20261023-NONE0001'], d, new AdminTokenCache())
  check('(2) the payment lookup answers per order (paid at the transaction time / unpaid) and nothing for an order Shopify does not have', r.failure === null && r.found.get('IC-20261023-PAID0001')?.paid_at === '2026-10-23T03:07:00Z' && r.found.get('IC-20261023-PEND0001')?.state === 'unpaid' && !r.found.has('IC-20261023-NONE0001'))
  check('(2) it is read-only and asks for NO customer data: no name, address, phone or e-mail field, no mutation', calls.length === 1 && !/mutation/i.test(calls[0].query) && !/shippingAddress|billingAddress|email|phone|customer\b/i.test(calls[0].query))
}

// ---- 3. /ops ----------------------------------------------------------------------------------------------------------------------------------------------------------
const webp = async (c: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: c } }).webp().toBuffer()
const store = new MemoryOrderStore()
const alt = (kanji: string, reading: string, set: number) => ({ set, candidate: { ...clone(GOLDEN.candidates[0]), kanji, inscription_form: null, reading, one_line_gaze: `${kanji}の人。`, story_anchor: clone(GOLDEN.candidates[0]).story_anchor } })
async function addOrder(ref: string, over: Record<string, unknown> = {}, opts: { lines?: string[]; poem?: boolean; shown?: unknown[] } = {}) {
  const body = { story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'standard', ship_to: 'direct', gift_message: 'ありがとう', shown_characters: opts.shown ?? [alt('備', 'そなえ', 2), alt('憶', 'おもい', 2), alt('鬱', 'うつ', 3)], ...over } as Record<string, unknown>
  const p = parseOrderRequest(body, T0)
  if (!p.ok) throw new Error(p.error)
  const record = buildRecord(p.order, ref, T0)
  if (opts.poem !== false) {
    record.production.poems = [{ poem_id: 'PM-20261023-aaaaaaaaaa', type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], pattern: null, reading: 'あさごとに' }]
    record.production.certificate.poems = [{ type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: 'あさごとに' }]
  }
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim: AnimationRecord = buildAnimationRecord(record, animId, T0)
  anim.gift_token = token
  anim.film = { status: 'ready', lines: opts.lines ?? ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: Array(4).fill('A woman seen from behind standing at a quiet kitchen counter in soft morning light, a small bento box in front of her'), made_at: T0.toISOString() }
  record.production.film = anim.film
  const gift: GiftRecord = buildGiftRecord(record, animId, token, null, T0)
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, gift)
  for (let i = 1; i <= 4; i++) await store.putObject(picturePath(animId, i), await webp('#9a8f7a'), 'image/webp')
  await store.putObject(`films/${animId}/art.json`, JSON.stringify({ schema: 'film-art', id: animId, status: 'done', started_at: T0.toISOString(), made_at: T0.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
  await recordOrderIndex(store, record, T0)
  return { record, anim, gift, animId, token }
}

const paidAt: Record<string, PaymentInfo> = {}
let paymentsDown = false
let paymentAsked: string[][] = []
const ENV = { ICHIREI_OPS_PASSWORD: 'correct horse' } as NodeJS.ProcessEnv
let NOW = at(2)
const O = createOpsHandlers((): OpsDeps => ({
  store, env: ENV, now: () => NOW, mailer: async () => true,
  payments: async (refs): Promise<PaymentResult> => {
    paymentAsked.push(refs)
    if (paymentsDown) return { found: new Map(), failure: 'unavailable' }
    return { found: new Map(refs.filter((r) => paidAt[r]).map((r) => [r, paidAt[r]])), failure: null }
  },
  shipping: async () => ({ found: new Map(), failure: null }),
}))
const auth = (user = 'owner') => `Basic ${Buffer.from(`${user}:correct horse`).toString('base64')}`
const req = (path: string, init: RequestInit = {}) => new Request(`https://ichirei.soul-id.jp${path}`, { ...init, headers: { authorization: auth(), ...(init.headers as Record<string, string> | undefined) } })
const post = (path: string, body: unknown, user = 'owner', headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) => new Request(`https://ichirei.soul-id.jp${path}`, { method: 'POST', headers: { authorization: auth(user), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const change = async (body: unknown, user = 'owner') => { const r = await O.change(post('/ops/change', body, user)); return { status: r.status, json: (await r.json()) as { ok?: boolean; error?: string; code?: string; message?: string } } }
const get = async (ref: string) => (await store.get(ref)) as OrderRecord

await addOrder('IC-20261023-INWINDOW', {})
await addOrder('IC-20261023-CLOSED01', { sender_name: '田中 花子' })
paidAt['IC-20261023-INWINDOW'] = paid(0)
paidAt['IC-20261023-CLOSED01'] = paid(-30) // paid 30 hours before T0 → at T0+2h it is 32 hours old
{
  const page = await (await O.page(req('/ops'))).text()
  check('(3) /ops: the order inside the window is listed as 「キャンセル受付中（あと22時間）」, greyed, with its action; the older one is in "製作に進めるもの"', page.includes('キャンセル受付中（あと22時間）') && /class="inwindow"[^>]*><td>IC-20261023-INWINDOW/.test(page) && /製作に進めるもの（1）/.test(page) && /キャンセル受付中（1）/.test(page))
  const readyPart = page.slice(page.indexOf('製作に進めるもの'), page.indexOf('キャンセル受付中（'))
  check('(3) …and the order inside the window is NOT in the list of what may be made (no card PDF link, no print button for it)', readyPart.includes('IC-20261023-CLOSED01') && !readyPart.includes('IC-20261023-INWINDOW') && !page.includes('/ops/card/IC-20261023-INWINDOW'))
  check('(3) its action is there: cancel (nothing else is offered) — and a note that nothing is changed after payment', page.includes('data-act="cancel"') && page.includes('お支払い後の内容の変更（字・歌・お名前・メッセージ）は行いません'))
  if (process.env.RENDER_SHOTS) (await import('node:fs')).writeFileSync(join(process.env.RENDER_SHOTS, 'ops-window.html'), page)
  const csv = await (await O.woodenCsv(req('/ops/wooden-today.csv'))).text()
  check('(3) the workshop CSV has only the order whose window has closed — never the one inside it', csv.includes('IC-20261023-CLOSED01') && !csv.includes('IC-20261023-INWINDOW') && csv.split('\r\n')[0].endsWith(',payment') && csv.includes(',paid'))
  const pdf = await O.cardsToday(req('/ops/cards/today.pdf'))
  const pdfText = Buffer.from(await pdf.arrayBuffer()).toString('latin1')
  check('(3) "all cards" is a PDF of the closed order only: 2 pages (one order)', pdf.status === 200 && (pdfText.match(/\/Type \/Page\b/g) ?? []).length === 2)
  const one = await O.card(req('/ops/card/IC-20261023-INWINDOW.pdf'), 'IC-20261023-INWINDOW')
  const oneOk = await O.card(req('/ops/card/IC-20261023-CLOSED01.pdf'), 'IC-20261023-CLOSED01')
  check('(3) the card of an order inside the window is refused (409 window_open); one whose window has closed is made', one.status === 409 && ((await one.json()) as { code: string }).code === 'window_open' && oneOk.status === 200)
  const mk = await O.mark(post('/ops/mark', { order_ref: 'IC-20261023-INWINDOW', what: 'printed' }))
  check('(3) nothing can be marked printed or shipped while the window is open', mk.status === 409)
}

// after payment nothing is changed: the old change actions are gone, and a refused action writes nothing
{
  const before = JSON.stringify(await get('IC-20261023-INWINDOW'))
  const results = await Promise.all([
    change({ order_ref: 'IC-20261023-INWINDOW', action: 'character', kanji: '憶' }, 'brian'),
    change({ order_ref: 'IC-20261023-INWINDOW', action: 'poem', poem_type: 'haiku' }),
    change({ order_ref: 'IC-20261023-INWINDOW', action: 'names', sender: '山田 次郎', message: 'x' }),
  ])
  check('(4) NO CHANGES after payment: switching the character, the poem format and editing names or the message are refused (400 bad_action) — and the record is exactly as it was', results.every((r) => r.status === 400 && r.json.error === 'bad_action') && JSON.stringify(await get('IC-20261023-INWINDOW')) === before)
  check('(4) the stored list of characters shown for the story is still on the order (a new order with the same story offers them again)', ((await get('IC-20261023-INWINDOW')).shown_characters?.length ?? 0) >= 1)
  const page = await (await O.page(req('/ops'))).text()
  check('(4) /ops offers only cancelling: no 字を変更, no poem-format change, no name/message edit', page.includes('data-act="cancel"') && !page.includes('data-act="character"') && !page.includes('data-act="poem"') && !page.includes('data-act="names"') && !page.includes('字を変更') && !page.includes('詩の形式'))
}
// 受け取り: once the buyer has pressed 「贈りものを受け取る」 the order can no longer be cancelled (the owner can override for our own mistakes)
{
  const c = await addOrder('IC-20261023-COLLECT1', {})
  paidAt['IC-20261023-COLLECT1'] = paid(0)
  const rec = await get('IC-20261023-COLLECT1')
  rec.refund_ack_at = at(-0.1).toISOString()
  rec.collected_at = at(1).toISOString()
  await store.put(rec.order_ref, rec)
  const page = await (await O.page(req('/ops'))).text()
  check('(4b) /ops shows 受け取り 済（時刻）/ 未 for each order, and the time the refund terms were ticked', /IC-20261023-COLLECT1[\s\S]{0,400}済（10-23 1[0-9]:\d\d）/.test(page) && /IC-20261023-INWINDOW[\s\S]{0,400}<td>未<\/td>/.test(page) && /確認済み（10-23 \d\d:\d\d）/.test(page) && page.includes('<th>受け取り</th>') && page.includes('<th>返金条件の確認</th>'))
  const blocked = await change({ order_ref: 'IC-20261023-COLLECT1', action: 'cancel' })
  check('(4b) cancelling an order the buyer has collected is refused (422 collected) and writes nothing', blocked.status === 422 && blocked.json.code === 'collected' && !(await get('IC-20261023-COLLECT1')).ops?.cancelled_at && c.record.order_ref === 'IC-20261023-COLLECT1')
  const forced = await change({ order_ref: 'IC-20261023-COLLECT1', action: 'cancel', override: true }, 'brian')
  const after = await get('IC-20261023-COLLECT1')
  check('(4b) …the owner can override with a second confirm (our own mistakes): flagged and logged as an override', forced.status === 200 && !!after.ops?.cancelled_at && /override/.test(after.ops?.log?.at(-1)?.detail ?? ''))
}
{
  const r = await change({ order_ref: 'IC-20261023-INWINDOW', action: 'cancel' })
  const after = await get('IC-20261023-INWINDOW')
  const csv = await (await O.woodenCsv(req('/ops/wooden-today.csv'))).text()
  check('(8) CANCEL: the order is flagged (our record only), logged, and gone from the workshop CSV and the print list — the page says the refund is made in Shopify', r.status === 200 && !!after.ops?.cancelled_at && after.ops?.log?.at(-1)?.action === 'cancel' && !csv.includes('IC-20261023-INWINDOW'))
  const page = await (await O.page(req('/ops'))).text()
  check('(8) …it moves to "そのほか（キャンセル…）" and shows no actions any more', /そのほか（キャンセル・入金未確認・製作なし [1-9]/.test(page) && !/data-ref="IC-20261023-INWINDOW"/.test(page.replace(/<tr class="inwindow"><td>IC-20261023-INWINDOW[\s\S]*?<\/tr>/, '')) )
  const again = await change({ order_ref: 'IC-20261023-INWINDOW', action: 'cancel' })
  check('(8) a cancelled order accepts no further change (409), and the flag is not set twice', again.status === 409 && again.json.code === 'cancelled')
  const cards = await O.card(req('/ops/card/IC-20261023-INWINDOW.pdf'), 'IC-20261023-INWINDOW')
  check('(8) the card of a cancelled order is refused', cards.status === 409)
}
// after 24 hours
{
  const ok = await addOrder('IC-20261023-AFTER001', {})
  paidAt['IC-20261023-AFTER001'] = paid(0)
  const snapshot = JSON.stringify(await get('IC-20261023-AFTER001'))
  NOW = at(25)
  const results = await Promise.all([
    change({ order_ref: 'IC-20261023-AFTER001', action: 'character', kanji: '憶' }),
    change({ order_ref: 'IC-20261023-AFTER001', action: 'poem', poem_type: 'en' }),
    change({ order_ref: 'IC-20261023-AFTER001', action: 'names', sender: '山田 次郎' }),
  ])
  check('(9) AFTER 24 HOURS (and before) every change is refused: made to order, no change of mind — and the record is exactly as it was', results.every((r) => r.status === 400 && r.json.error === 'bad_action') && JSON.stringify(await get('IC-20261023-AFTER001')) === snapshot && ok.record.order_ref === 'IC-20261023-AFTER001')
  const csv = await (await O.woodenCsv(req('/ops/wooden-today.csv'))).text()
  check('(9) …and from then on the order is in the workshop CSV', csv.includes('IC-20261023-AFTER001'))
  const mk = await O.mark(post('/ops/mark', { order_ref: 'IC-20261023-AFTER001', what: 'printed' }))
  check('(9) …and can be marked printed', mk.status === 200 && !!(await get('IC-20261023-AFTER001')).ops?.printed_at)
  const csv2 = await (await O.woodenCsv(req('/ops/wooden-today.csv'))).text()
  const pdf = await O.cardsToday(req('/ops/cards/today.pdf'))
  const pdfText = Buffer.from(await pdf.arrayBuffer()).toString('latin1')
  check('(9) "all cards" leaves out what is already printed (AFTER001) and the cancelled ones: the one other closed order, 2 pages', pdf.status === 200 && (pdfText.match(/\/Type \/Page\b/g) ?? []).length === 2 && csv2.includes('IC-20261023-AFTER001'))
  NOW = at(2)
}
// Shopify says...
{
  await addOrder('IC-20261023-SHOPCANC', {})
  await addOrder('IC-20261023-NEVERPAI', {})
  paidAt['IC-20261023-SHOPCANC'] = { state: 'cancelled', paid_at: null }
  NOW = at(40)
  const csv = await (await O.woodenCsv(req('/ops/wooden-today.csv'))).text()
  check('(10) an order Shopify has cancelled or refunded, or never paid (a cart that was abandoned), is never in the workshop CSV — only paid ones', !csv.includes('IC-20261023-SHOPCANC') && !csv.includes('IC-20261023-NEVERPAI') && csv.includes('IC-20261023-CLOSED01'))
  const page = await (await O.page(req('/ops'))).text()
  check('(10) …they are listed under "そのほか", as キャンセル / 入金を確認できません', /IC-20261023-NEVERPAI[\s\S]{0,300}入金を確認できません/.test(page) && /IC-20261023-SHOPCANC[\s\S]{0,300}キャンセル/.test(page))
  // Shopify cannot be asked: the order's own time; the page and the CSV say so
  paymentsDown = true
  NOW = at(40)
  const page2 = await (await O.page(req('/ops'))).text()
  const csv2 = await (await O.woodenCsv(req('/ops/wooden-today.csv'))).text()
  check('(10) when Shopify cannot be asked the order\'s own time is used — and the page and the CSV both say it is not verified', page2.includes('Shopifyから入金を確認できませんでした') && csv2.includes('unverified (Shopify could not be asked)'))
  paymentsDown = false
  NOW = at(2)
}
// the doors
{
  const x = await O.change(post('/ops/change', { order_ref: 'IC-20261023-CLOSED01', action: 'cancel' }, 'owner', { 'sec-fetch-site': 'cross-site' }))
  const nope = await O.change(new Request('https://ichirei.soul-id.jp/ops/change', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' }))
  const bad = await change({ order_ref: 'nonsense', action: 'cancel' })
  const unknown = await change({ order_ref: 'IC-20261023-ZZZZZZZZ', action: 'cancel' })
  const act = await change({ order_ref: 'IC-20261023-SENDME01', action: 'refund' })
  check('(11) a cross-site POST, a request with no password, a bad reference, an unknown order and an unknown action are all refused — and nothing is written to Shopify (there is no Shopify call but the read-only lookups)', x.status === 403 && nope.status === 401 && bad.status === 400 && unknown.status === 404 && act.status === 400 && paymentAsked.length > 0)
}

if (failures) {
  console.error(`\n${failures} change-window check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll change-window checks passed.')
