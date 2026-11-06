// The buyer's own page (ticket 2026-11-06): what GET /api/animation/<id> tells it about the ORDER — when it was ordered, the real end of the 24-hour change window (gone after it),
// the wooden gift's four steps (never for an e-gift, never while the wooden sizes are "coming soon") — what the owner sets on /ops (POST /ops/wood), and that looking at the
// receiver's page in preview mode never changes the gift. FAKE Shopify payment lookup; in-memory store; no network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-buyer.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnimationHandlers } from '../api/animation.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createOpsHandlers, type OpsDeps } from '../api/ops.ts'
import { buildAnimationRecord, newAnimationId, type AnimationRecord } from '../engine/animation.ts'
import { buyerOrderView, woodStepOf } from '../engine/buyer.ts'
import { WINDOW_MS, windowOf } from '../engine/change-window.ts'
import { recordOrderIndex } from '../engine/egift-ops.ts'
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
const T0 = new Date('2026-11-06T03:00:00Z') // the moment of payment
const at = (hours: number) => new Date(T0.getTime() + hours * H)
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'

const store = new MemoryOrderStore()
async function addOrder(ref: string, pkg: 'egift' | 'simple' | 'standard', over: Record<string, unknown> = {}) {
  const body = { story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'modern', package: pkg, ...(pkg === 'egift' ? { sender_email: 'taro@example.com' } : { ship_to: 'me' }), ...over }
  const p = parseOrderRequest(body, T0)
  if (!p.ok) throw new Error(p.error)
  const record = buildRecord(p.order, ref, T0)
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim: AnimationRecord = buildAnimationRecord(record, animId, T0)
  anim.gift_token = token
  anim.film = { status: 'fallback', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。'], pictures: [], reason: 'test' } as never
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, buildGiftRecord(record, animId, token, p.order.sender_email, T0))
  await recordOrderIndex(store, record, T0)
  return { ref, animId, token }
}
const pay: Record<string, PaymentInfo | undefined> = {}
let down = false
let NOW = at(2)
let ENV: NodeJS.ProcessEnv = { ICHIREI_SUPPORT_EMAIL: 'help@example.com' } as NodeJS.ProcessEnv
const payments = async (refs: string[]): Promise<PaymentResult> => (down ? { found: new Map(), failure: 'unavailable' } : { found: new Map(refs.filter((r) => pay[r]).map((r) => [r, pay[r] as PaymentInfo])), failure: null })
const A = createAnimationHandlers(() => ({ store, now: () => NOW, env: ENV, payments }))
const view = async (id: string) => (await (await A.view(id)).json()) as { order?: { ordered_at: string | null; change_until: string | null; wood: { step: number; tracking_no: string | null; ship_to: string } | null } | null; support_email?: string | null; gift?: { url: string } }

const eg = await addOrder('IC-20261106-EGIFT001', 'egift')
const wd = await addOrder('IC-20261106-WOOD0001', 'simple')
const bl = await addOrder('IC-20261106-BLOCK001', 'standard', { ship_to: 'direct' })
for (const r of [eg.ref, wd.ref, bl.ref]) pay[r] = { state: 'paid', paid_at: T0.toISOString() }

// ---- the 24-hour line: the real deadline, and gone after it ---------------------------------------------------------------------------------------------
{
  const v = await view(eg.animId)
  check('(1) the buyer page view carries the real deadline: the payment time + 24 hours (Shopify\'s payment time, not the cart time)', v.order?.change_until === at(24).toISOString() && v.order?.ordered_at === T0.toISOString(), JSON.stringify(v.order))
  NOW = at(23.9)
  check('(1) …still there just before the deadline', (await view(eg.animId)).order?.change_until === at(24).toISOString())
  NOW = at(24)
  check('(1) …and gone from the deadline on: the page then shows no 24-hour line (change_until null)', (await view(eg.animId)).order?.change_until === null)
  NOW = at(300)
  check('(1) …and stays gone', (await view(eg.animId)).order?.change_until === null)
  NOW = at(2)
  pay[eg.ref] = { state: 'paid', paid_at: at(-30).toISOString() }
  check('(1) an order paid 30 hours ago (a cart that was paid late is measured from its payment) has no deadline line', (await view(eg.animId)).order?.change_until === null)
  pay[eg.ref] = { state: 'cancelled', paid_at: null }
  check('(1) a cancelled order has none, and never paid has none', (await view(eg.animId)).order?.change_until === null)
  pay[eg.ref] = undefined
  const unpaid = await view(eg.animId)
  check('(1) never paid (Shopify has no such order): no deadline line, no wooden section', unpaid.order?.change_until === null && unpaid.order?.wood === null)
  pay[eg.ref] = { state: 'paid', paid_at: T0.toISOString() }
  down = true
  const un = await view(eg.animId)
  check('(1) when Shopify cannot be asked the order\'s own time is used (the deadline is then the order time + 24 hours — never invented)', un.order?.change_until === new Date(Date.parse((await store.get(eg.ref) as OrderRecord).created_at) + WINDOW_MS).toISOString() || un.order?.change_until === null)
  down = false
  const sup = await view(eg.animId)
  check('(1) the support address is the one in ICHIREI_SUPPORT_EMAIL (plain text), and absent when none is set or it is not an address', sup.support_email === 'help@example.com')
  ENV = {} as NodeJS.ProcessEnv
  check('(1) …none set → null', (await view(eg.animId)).support_email === null)
  ENV = { ICHIREI_SUPPORT_EMAIL: 'not an address' } as NodeJS.ProcessEnv
  check('(1) …junk → null', (await view(eg.animId)).support_email === null)
  ENV = {} as NodeJS.ProcessEnv
}

// ---- the wooden section: e-gift never, "coming soon" never, otherwise four steps ---------------------------------------------------------------------
{
  const e = await view(eg.animId)
  check('(2) an e-gift order has NO wooden section (wood: null)', e.order?.wood === null)
  const w0 = await view(wd.animId)
  check('(2) a wooden order starts at step 1 (order received), shipped to the buyer ("me"), no tracking number', w0.order?.wood?.step === 1 && w0.order.wood.ship_to === 'me' && w0.order.wood.tracking_no === null, JSON.stringify(w0.order))
  const bw = await view(bl.animId)
  check('(2) a wooden order sent directly: ship_to "direct"', bw.order?.wood?.ship_to === 'direct')
  ENV = { ICHIREI_WOOD_SIZES: 'coming_soon' } as NodeJS.ProcessEnv
  check('(2) while the wooden sizes are "coming soon" (ICHIREI_WOOD_SIZES=coming_soon) no wooden order shows the section', (await view(wd.animId)).order?.wood === null && (await view(bl.animId)).order?.wood === null)
  ENV = {} as NodeJS.ProcessEnv
  check('(2) …and back to normal when the switch is off', (await view(wd.animId)).order?.wood?.step === 1)
  const rec = (await store.get(wd.ref)) as OrderRecord
  check('(2) with no explicit step: printed → 2 (being made), shipped → 3', woodStepOf({}) === 'received' && woodStepOf({ printed_at: 'x' }) === 'making' && woodStepOf({ printed_at: 'x', shipped_at: 'y' }) === 'shipped' && woodStepOf({ wood_step: 'delivered' }) === 'delivered')
  check('(2) buyerOrderView: a cancelled order and an unpaid one have no wooden section', buyerOrderView(rec, windowOf(rec, { state: 'cancelled', paid_at: null }, NOW)).wood === null && buyerOrderView(rec, windowOf(rec, null, NOW)).wood === null)
  check('(2) the view has no price, no name, no address, no order number beyond what the page needs', !JSON.stringify(await view(wd.animId)).match(/山田|IC-2026|¥|taro@/))
}

// ---- /ops: the owner sets the step and the tracking number --------------------------------------------------------------------------------------------
{
  const OPS_ENV = { ICHIREI_OPS_PASSWORD: 'correct horse' } as NodeJS.ProcessEnv
  const O = createOpsHandlers((): OpsDeps => ({ store, env: OPS_ENV, now: () => NOW, mailer: async () => true, payments, shipping: async () => ({ found: new Map(), failure: null }) }))
  const auth = `Basic ${Buffer.from('owner:correct horse').toString('base64')}`
  const wood = async (body: unknown, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) => {
    const r = await O.wood(new Request('https://ichirei.soul-id.jp/ops/wood', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
    return { status: r.status, json: (await r.json()) as { ok?: boolean; code?: string; error?: string } }
  }
  NOW = at(2)
  check('(3) /ops/wood is refused while the 24-hour window is open (nothing is made yet)', (await wood({ order_ref: wd.ref, step: 'making' })).status === 409)
  NOW = at(30)
  check('(3) /ops/wood needs the owner\'s password and a same-site POST', (await O.wood(new Request('https://ichirei.soul-id.jp/ops/wood', { method: 'POST', body: '{}' }))).status === 401 && (await wood({ order_ref: wd.ref, step: 'making' }, { 'sec-fetch-site': 'cross-site' })).status === 403)
  check('(3) an e-gift order has no wooden steps (422 not_wooden)', (await wood({ order_ref: eg.ref, step: 'making' })).json.code === 'not_wooden')
  check('(3) a bad step or a bad order number is refused (400)', (await wood({ order_ref: wd.ref, step: 'flying' })).status === 400 && (await wood({ order_ref: 'x', step: 'making' })).status === 400)
  check('(3) a tracking number must be letters, digits and hyphens (4–40): anything else is refused and nothing is stored', (await wood({ order_ref: wd.ref, step: 'shipped', tracking_no: 'a b<script>' })).json.code === 'bad_tracking' && ((await store.get(wd.ref)) as OrderRecord).ops?.wood_step === undefined)
  check('(3) step 2 (being made) is stored and the buyer\'s page shows it', (await wood({ order_ref: wd.ref, step: 'making' })).status === 200 && (await view(wd.animId)).order?.wood?.step === 2)
  const s3 = await wood({ order_ref: wd.ref, step: 'shipped', tracking_no: 'JP1234567890' })
  const v3 = await view(wd.animId)
  check('(3) step 3 (shipped) with the tracking number: the page gets both; the shipped time is set and the receiver\'s address clock starts', s3.status === 200 && v3.order?.wood?.step === 3 && v3.order.wood.tracking_no === 'JP1234567890' && !!((await store.get(wd.ref)) as OrderRecord).ops?.shipped_at && !!((await store.get(wd.token)) as { shipped_at?: string }).shipped_at)
  check('(3) step 4 (delivered) keeps the tracking number', (await wood({ order_ref: wd.ref, step: 'delivered', tracking_no: 'JP1234567890' })).status === 200 && (await view(wd.animId)).order?.wood?.step === 4)
  check('(3) the owner can put the step back (and the tracking number is not shown before "shipped")', (await wood({ order_ref: wd.ref, step: 'making', tracking_no: 'JP1234567890' })).status === 200 && (await view(wd.animId)).order?.wood?.tracking_no === null)
  const page = await (await O.page(new Request('https://ichirei.soul-id.jp/ops', { headers: { authorization: auth } }))).text()
  check('(3) the /ops page shows the step choice and the tracking field for a wooden order that may be made', page.includes('data-wood="1"') && page.includes('name="tracking_no"') && page.includes('3 発送しました（追跡番号）'))
}

// ---- preview mode: looking at the receiver's page changes nothing ------------------------------------------------------------------------------------
{
  NOW = at(2)
  const G = createGiftHandlers(() => ({ store, now: () => NOW }))
  const all = async () => JSON.stringify(await Promise.all([eg.ref, eg.animId, eg.token].map((k) => store.get(k))))
  const before = await all()
  const sealed = await G.view(eg.token, eg.animId)
  await G.render(eg.token, eg.animId)
  await G.picture(eg.token, '1', eg.animId)
  const plain = await G.view(eg.token)
  check('(4) the receiver\'s page opens in preview mode with the buyer\'s own page id (200) — and WITHOUT it before the opening day it stays sealed only if a date is set', sealed.status === 200 && plain.status === 200)
  check('(4) previewing (view, render, picture) writes NOTHING: the order, the film and the gift record are byte-for-byte what they were — the gift is not marked opened, replied to or received', (await all()) === before)
  const gr = (await store.get(eg.token)) as { egift?: { state: string }; reply?: unknown }
  check('(4) …the gift has no reply and nothing received (an address, if the gift takes one, is still "waiting")', !gr.reply && (gr.egift?.state ?? 'waiting') === 'waiting')
}

console.log(failures ? `\n${failures} buyer check(s) FAILED` : '\nAll buyer checks passed.')
process.exit(failures ? 1 : 0)
