// Ticket 8 (2026-11-25): the owner's gift maker. FAKE models only — the engine, the poem model, the film script, the image model and the picture check are stand-ins; no key, no network, no API credit.
// The real code runs everywhere else: the poem handler, the order parser, the record builders, the picture renderer, the receiver's gift handler, the sender's page and the dashboard's numbers.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-owner-gift.ts

process.env.ICHIREI_DUPLICATE_CHECK = 'off' // (the fake image model draws one and the same picture for every slot)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakePicture } from './_fake-picture.mjs'
import { createOwnerGiftHandlers } from '../api/ops-gifts.ts'
import { OWNER_GIFT_DICT, OWNER_GIFT_KEYS, ownerGiftsPage } from '../api/ops-gifts-page.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { buildStats, createStatsHandlers } from '../api/ops-stats.ts'
import { buildGiftRecord, isGiftRecord } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { windowOf } from '../engine/change-window.ts'
import { ownerGiftDailyMax, resetOwnerTokenCache } from '../engine/owner-gift.ts'
import { rendersPath, type ImageClient } from '../engine/film-art.ts'
import type { FilmInput, FilmRecord } from '../engine/film.ts'
import type { Poem } from '../engine/poem.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const NOW = new Date('2026-11-25T03:00:00Z')
const TOKEN = 'owner-token-0123456789-not-real'
const MOMENT = '朝の台所で、母は黙って弁当を包んでいた。「もういらない」と言った私に、何も言わずに。'

// the fakes
const PNG = await fakePicture(400, 500)
const FILM: FilmRecord = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [
  'A woman seen from behind standing at a quiet kitchen counter in soft morning light, a small bento box in front of her',
  'Two hands holding a closed modern lunch box over a wooden table, window light falling across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight, a single bag left',
  'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table in the afternoon' ], made_at: NOW.toISOString() }
const vision = { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: [{ ok: true, reason: 'ok' }] }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
const POEM: Poem = { type: 'tanka', lines: ['朝の台所', '包みし弁当', '言わぬまま', '母の背中に', '春の光が'], pattern: null, aids: { kakikudashi: null, romaji: null, english: null } as never, reading: 'あさのだいどころ…' }

let fetchCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async () => { fetchCalls++; throw new Error('no network in this test') }) as typeof fetch
const logs: string[] = []
const origLog = console.log
const quiet = (...a: unknown[]) => { const s = a.map(String).join(' '); if (s.startsWith('PASS') || s.startsWith('FAIL') || s.startsWith('\n')) origLog(...a); else logs.push(s) }

interface Rig { store: MemoryOrderStore; H: ReturnType<typeof createOwnerGiftHandlers>; engineCalls: number; drawn: () => number; env: NodeJS.ProcessEnv; filmInputs: FilmInput[] }
function rig(over: { engine?: () => Promise<unknown>; imageDelay?: number; waitMs?: number; env?: Record<string, string>; poemFails?: boolean } = {}): Rig {
  const store = new MemoryOrderStore()
  let drawn = 0
  const env = { ICHIREI_OPS_PASSWORD: 'pw', ICHIREI_OWNER_API_TOKEN: TOKEN, ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai', ICHIREI_FILM_RENDER_MS: '20000', ICHIREI_FILM_DAILY_MAX: '1', ...over.env } as NodeJS.ProcessEnv
  const image: ImageClient = { async generate() { drawn++; await new Promise((r) => setTimeout(r, over.imageDelay ?? 5)); return { bytes: PNG, model: 'fake-image' } } }
  const r = { store, engineCalls: 0, drawn: () => drawn, env, filmInputs: [] as FilmInput[] } as Rig
  r.H = createOwnerGiftHandlers(() => ({
    store, env, now: () => NOW, readSecret: async () => '',
    engine: (async () => { r.engineCalls++; return over.engine ? over.engine() : clone(GOLDEN) }) as never,
    poem: (async () => (over.poemFails ? { ok: false, code: 'poem_failed', error: 'x', reasons: [] } : { ok: true, poem: clone(POEM) })) as never,
    film: async (i: FilmInput) => { r.filmInputs.push(i); return clone(FILM) },
    image, vision: vision as never, log: () => {}, pollMs: 5, waitMs: over.waitMs ?? 15_000,
  }))
  return r
}
const post = (r: Rig, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  r.H.create(new Request('http://x/ops/api/gifts', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
const BODY = { moment: MOMENT, language: 'ja', receiver: '松本先生', sender: 'Brian', poem_style: 'default', tag: 'outreach-2026-11' }
const basic = `Basic ${Buffer.from('owner:pw').toString('base64')}`

console.log = quiet
// ---- 1 · who may ask ---------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const r = rig()
  const none = await post(r, BODY, {})
  const wrong = await post(r, BODY, { authorization: 'Bearer not-the-token' })
  const passwordOnlyCrossSite = await post(r, BODY, { authorization: basic })
  const noToken = rig({ env: { ICHIREI_OWNER_API_TOKEN: '' } })
  resetOwnerTokenCache()
  const bearerNoSecret = await post(noToken, BODY)
  check('(1) no sign-in, no token → refused; a wrong Bearer token → 401; with no token set up the Bearer way is off', none.status === 401 && wrong.status === 401 && bearerNoSecret.status === 401 && r.engineCalls === 0 && noToken.engineCalls === 0)
  check('(1) the /ops password from another site (no Sec-Fetch-Site / Origin) is refused for a POST', passwordOnlyCrossSite.status === 403 && r.engineCalls === 0)
  const same = await post(r, BODY, { authorization: basic, 'sec-fetch-site': 'same-origin' })
  check('(1) the owner page itself (the /ops password, from this very site) may make a gift', same.status === 200 && r.engineCalls === 1)
  const ok = await post(rig(), BODY)
  check('(1) the agent\'s Bearer token (ICHIREI_OWNER_API_TOKEN) may make a gift', ok.status === 200)
  const gp = rig()
  const getNo = await gp.H.list(new Request('http://x/ops/api/gifts'))
  const getWrong = await gp.H.get(new Request('http://x/ops/api/gifts/IC-20261125-AAAAAAAA', { headers: { authorization: 'Bearer nope' } }), 'IC-20261125-AAAAAAAA')
  const pageNo = await gp.H.page(new Request('http://x/ops/gifts/new'))
  check('(1) the list, one gift and the page are owner-only too', getNo.status === 401 && getWrong.status === 401 && pageNo.status === 401)
}

// ---- 2 · the finished gift ---------------------------------------------------------------------------------------------------------------------------------------------
const R = rig()
const res = await post(R, BODY)
const made = (await res.json()) as Record<string, any>
console.log = origLog
check('(2) POST → the answer has the character, its reading, the line, pictures_ready, the receiver\'s link and the sender\'s page', res.status === 200 && made.glyph === '証' && typeof made.reading === 'string' && made.reading.length > 0 && typeof made.line === 'string' && made.line.length > 0 && made.pictures_ready === true && /^https:\/\/ichirei\.beyondculture\.ai\/g\/RG-[a-z2-9]{20}$/.test(made.receiver_link) && /^https:\/\/ichirei\.beyondculture\.ai\/a\/AN-/.test(made.sender_page), JSON.stringify(made))
console.log = quiet
const token = String(made.receiver_link).split('/g/')[1]
const animId = String(made.sender_page).split('/a/')[1]
const GH = createGiftHandlers(() => ({ store: R.store, env: R.env, now: () => NOW, image: undefined, vision: vision as never, log: () => {} }))
const rv = await GH.view(token)
const view = (await rv.json()) as Record<string, any>
console.log = origLog
check('(2) the receiver\'s link opens the gift at once: not sealed, not locked, the character, the line, the poem, the film with its four lines and four pictures, "from Brian" and "to 松本先生"', rv.status === 200 && view.locked !== true && view.glyph === '証' && view.who === made.line && view.poem?.lines?.length === 5 && view.from === 'Brian' && view.to === '松本先生' && view.film?.status === 'ready' && view.film.lines.length === 4 && Array.isArray(view.film.pictures) && view.film.pictures.length === 4, JSON.stringify(view).slice(0, 400))
{
  // identical to a customer gift: the receiver's record has the very keys buildGiftRecord gives a customer's, and the page's view carries no owner mark
  const parsed = parseOrderRequest({ story: MOMENT, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: 'Brian', receiver_name: '松本先生', inscription_style: 'modern', package: 'egift' }, NOW)
  const cust = parsed.ok ? buildGiftRecord(buildRecord(parsed.order, 'IC-20261125-ZZZZZZZZ', NOW, []), 'AN-x', 'RG-aaaaaaaaaaaaaaaaaaaa', null, NOW) : null
  const mine = (await R.store.get(token)) as Record<string, unknown>
  const strip = (o: Record<string, unknown>) => Object.keys(o).filter((k) => !['egift'].includes(k)).sort().join()
  check('(2) the receiver\'s gift record has the same fields as a customer\'s (no owner mark on it), and the receiver\'s view says nothing of an owner, a tag or a price', !!cust && strip(mine) === strip(cust as unknown as Record<string, unknown>) && !JSON.stringify(view).match(/owner|outreach|tag|price/i), `${strip(mine)} | ${cust ? strip(cust as unknown as Record<string, unknown>) : ''}`)
}
const order = (await R.store.get(made.id)) as OrderRecord
check('(2) the order is an owner gift at 0: source owner_outreach with its tag, price 0, no Shopify, collected at once, nothing to collect', order.source === 'owner_outreach' && order.outreach?.tag === 'outreach-2026-11' && order.price === 0 && order.production.price_jpy === 0 && order.shopify === null && order.collect_required === false && !!order.collected_at && order.production.package === 'egift' && order.production.sender_name === 'Brian' && order.production.receiver_name === '松本先生')
check('(2) the film was written from the real chosen character and the two names, as for a customer', R.filmInputs.length === 1 && R.filmInputs[0].glyph === '証' && R.filmInputs[0].names.includes('Brian') && R.filmInputs[0].language === 'ja')
check('(2) no network was touched: no Shopify, no payment lookup, no e-mail', fetchCalls === 0)
const AH = createAnimationHandlers(() => ({ store: R.store, env: R.env, now: () => NOW, vision: vision as never, log: () => {}, payments: async () => ({ found: new Map(), failure: null }) }))
{
  const sv = await AH.view(animId)
  const sj = (await sv.json()) as Record<string, any>
  check('(2) the sender\'s page /a/AN-… works: collected, not "confirming payment", the receiver\'s link offered', sv.status === 200 && sj.order?.collected === true && sj.order?.confirming === false && sj.gift?.url === made.receiver_link, JSON.stringify(sj.order))
  check('(2) the 24-hour window of an owner gift is closed (nothing to cancel, nothing paid)', windowOf(order, null, NOW).phase === 'closed')
}

// ---- 3 · never a customer order ----------------------------------------------------------------------------------------------------------------------------------------
{
  const keys = [...R.store.objects.keys()]
  const stats = await buildStats({ store: R.store, env: R.env, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }), toolStats: async () => null }, R.store, R.env, NOW)
  check('(3) it is not in the orders index, so not in /ops, sales, revenue, the free-gift counts or the tool funnel', !keys.some((k) => k.startsWith('ops/orders-')) && stats.orders.length === 0 && stats.stats.periods.all.paid === 0 && stats.stats.periods.all.revenue_jpy === 0 && stats.stats.periods.all.funnel.paid === 0 && stats.tool.funnel.every((x) => x.paid === 0 && x.free === 0 && x.created === 0), JSON.stringify([stats.orders.length, stats.stats.periods.all.paid, stats.stats.periods.all.revenue_jpy]))
  const evKeys = keys.filter((k) => k.startsWith('analytics/'))
  const evs = evKeys.flatMap((k) => (R.store.objects.get(k)?.toString('utf8') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string; source: string }))
  check('(3) it records no customer event (no "ordered", no visit): only the AI cost, marked as not a customer\'s', evs.every((e) => e.event === 'ai_cost' && e.source !== 'customer'))
  check('(3) the day\'s free sets are not counted and the daily picture limit did not hold the pictures back (limit 1, already used, and the four pictures were drawn)', !R.store.objects.has(rendersPath('2026-11-25')) && R.drawn() >= 4 && made.pictures_drawn === 4)
  const gifts = await createStatsHandlers(() => ({ store: R.store, env: R.env, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }), toolStats: async () => null })).json(new Request('http://x/ops/stats.json', { headers: { authorization: basic } }))
  check('(3) /ops/stats.json shows no owner gift', !(await gifts.text()).includes(made.id))
}

// ---- 4 · the list, "opened", the status ---------------------------------------------------------------------------------------------------------------------------------
{
  const list0 = (await (await R.H.list(new Request('http://x/ops/api/gifts', { headers: { authorization: `Bearer ${TOKEN}` } }))).json()) as { gifts: Record<string, any>[]; today: { n: number; max: number } }
  check('(4) the list has the gift: tag, receiver, character, date, opened no — and today\'s count (1 of 30)', list0.gifts.length === 1 && list0.gifts[0].tag === 'outreach-2026-11' && list0.gifts[0].receiver === '松本先生' && list0.gifts[0].glyph === '証' && list0.gifts[0].created_at.startsWith('2026-11-25') && list0.gifts[0].opened === false && list0.today.n === 1 && list0.today.max === 30, JSON.stringify(list0))
  await GH.opened(token)
  const list1 = (await (await R.H.list(new Request('http://x/ops/api/gifts', { headers: { authorization: `Bearer ${TOKEN}` } }))).json()) as { gifts: Record<string, any>[] }
  check('(4) once the receiver has opened it the list says opened yes', list1.gifts[0].opened === true)
  const one = await R.H.get(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }), made.id)
  const oj = (await one.json()) as Record<string, any>
  check('(4) GET /ops/api/gifts/<id> reports the gift (receiver link, pictures ready)', one.status === 200 && oj.receiver_link === made.receiver_link && oj.pictures_ready === true && oj.id === made.id)
  const missing = await R.H.get(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }), 'IC-20261125-ABCDEFGH')
  const customer = rig()
  await customer.store.put('IC-20261125-CUSTOMER', { schema: 1, order_ref: 'IC-20261125-CUSTOMER', created_at: NOW.toISOString(), production: {} })
  check('(4) an id that is not an owner gift answers 404 (a customer\'s order is never read through here)', missing.status === 404 && (await customer.H.get(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }), 'IC-20261125-CUSTOMER')).status === 404)
}

// ---- 5 · pictures that need longer than the request ------------------------------------------------------------------------------------------------------------------------
{
  const slow = rig({ imageDelay: 120, waitMs: 60 })
  const r1 = await post(slow, BODY)
  const j1 = (await r1.json()) as Record<string, any>
  check('(5) pictures that need longer than the request allows: the answer comes at once with pictures_ready false (and the link already works)', r1.status === 200 && j1.pictures_ready === false && j1.pictures_state === 'drawing' && /\/g\/RG-/.test(j1.receiver_link), JSON.stringify(j1).slice(0, 300))
  let last: Record<string, any> = j1
  for (let i = 0; i < 40 && !last.pictures_ready; i++) {
    last = (await (await slow.H.get(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }), j1.id)).json()) as Record<string, any>
    await new Promise((r) => setTimeout(r, 30))
  }
  check('(5) GET /ops/api/gifts/<id> reports when they are done (and polling it carries them on)', last.pictures_ready === true && last.pictures_drawn === 4 && last.picture_urls.every((u: string | null) => !!u), JSON.stringify(last).slice(0, 300))
}

// ---- 6 · the day's limit, and what is refused --------------------------------------------------------------------------------------------------------------------------------
{
  check('(6) at most 30 owner gifts a day by default (ICHIREI_OWNER_GIFT_DAILY_MAX changes it)', ownerGiftDailyMax({}) === 30 && ownerGiftDailyMax({ ICHIREI_OWNER_GIFT_DAILY_MAX: '3' } as never) === 3)
  const lim = rig({ env: { ICHIREI_OWNER_GIFT_DAILY_MAX: '2' } })
  const a = await post(lim, BODY)
  const b = await post(lim, BODY)
  const c = await post(lim, BODY)
  const cj = (await c.json()) as Record<string, any>
  check('(6) the day\'s allowance: the third gift of a day with a limit of 2 is refused (429, daily_limit) before anything is made', a.status === 200 && b.status === 200 && c.status === 429 && cj.code === 'daily_limit' && lim.engineCalls === 2)
  const next = createOwnerGiftHandlers(() => ({ store: lim.store, env: lim.env, now: () => new Date('2026-11-26T03:00:00Z'), engine: (async () => clone(GOLDEN)) as never, poem: (async () => ({ ok: true, poem: clone(POEM) })) as never, film: async () => clone(FILM), image: { async generate() { return { bytes: PNG, model: 'fake-image' } } }, vision: vision as never, log: () => {}, pollMs: 5 }))
  check('(6) the next day it starts again', (await next.create(new Request('http://x/', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(BODY) }))).status === 200)
  const v = rig()
  const bad = [
    await post(v, { ...BODY, moment: '' }), await post(v, { ...BODY, language: 'fr' }), await post(v, { ...BODY, tag: 'bad tag!' }), await post(v, { ...BODY, poem_style: 'sonnet' }), await post(v, { ...BODY, poem_style: 'en' }),
    await post(v, { ...BODY, receiver: 'x'.repeat(40) }), await post(v, 'not json'),
  ]
  const codes = await Promise.all(bad.map(async (x) => ((await x.json()) as { code: string }).code))
  check('(6) what is wrong is refused before any model is asked: no moment, an unknown language, a bad tag, an unknown or wrong-language poem style, a too-long name, bad JSON', bad.every((x) => x.status === 400) && v.engineCalls === 0 && codes.join() === 'missing_moment,bad_language,bad_tag,bad_poem_style,bad_poem_style,bad_receiver,bad_json', codes.join())
  const need = rig({ engine: async () => ({ ...clone(GOLDEN), status: 'insufficient', primary_kanji: null, candidates: [], follow_up_question: '具体的な場面をひとつ教えてください。' }) })
  const n = await post(need, BODY)
  const nj = (await n.json()) as Record<string, any>
  const listN = (await (await need.H.list(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }))).json()) as { gifts: unknown[]; today: { n: number } }
  check('(6) a moment that gives the engine too little: 422 with its one question, nothing stored, and the day\'s count given back', n.status === 422 && nj.code === 'moment_needs_more' && nj.follow_up_question.includes('具体的') && listN.gifts.length === 0 && listN.today.n === 0)
  const pf = rig({ poemFails: true })
  const p = await post(pf, BODY)
  const boom = rig({ engine: async () => { throw new Error('engine down: secret story text') } })
  const e = await post(boom, BODY)
  const ej = await e.text()
  check('(6) a poem that cannot be written, or an engine that fails, answers 502 and gives the count back — and the error text never leaves the server', p.status === 502 && e.status === 502 && !ej.includes('secret story text') && (await (await pf.H.list(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }))).json() as { today: { n: number } }).today.n === 0)
}

// ---- 7 · the languages --------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const zh = { ...clone(GOLDEN), language: 'zh-Hant', candidates: clone(GOLDEN).candidates.map((c: Record<string, unknown>) => ({ ...c, reading: 'zhèng' })) }
  const en = { ...clone(GOLDEN), language: 'en' }
  const zhR = rig({ engine: async () => zh })
  const enR = rig({ engine: async () => en })
  const z = await post(zhR, { ...BODY, language: 'zh-Hant', moment: '外婆每天早上都會在廚房裡替我準備熱騰騰的早餐，從來沒有說過一句辛苦。', receiver: '外婆', poem_style: 'default' })
  const e = await post(enR, { ...BODY, language: 'en', moment: 'My grandmother kept a warm breakfast on the stove every morning and never once said it was hard.', receiver: 'Grandma', poem_style: 'default' })
  const zo = (await zhR.store.get(((await z.json()) as { id: string }).id)) as OrderRecord
  const eo = (await enR.store.get(((await e.json()) as { id: string }).id)) as OrderRecord
  check('(7) the gift is made in the language of the moment: zh-Hant keeps its carved form and its default poem (tang); English is an e-gift too, with its own default poem style', z.status === 200 && e.status === 200 && zo.production.language === 'zh-Hant' && zo.production.inscription_style === 'traditional' && eo.production.language === 'en' && eo.production.inscription_style === 'modern', JSON.stringify([z.status, e.status, zo?.production?.language, zo?.production?.inscription_style, eo?.production?.language, eo?.production?.inscription_style]))
}

// ---- 8 · the page -------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const html = ownerGiftsPage()
  const pg = await rig().H.page(new Request('http://x/ops/gifts/new', { headers: { authorization: basic } }))
  const body = await pg.text()
  check('(8) /ops/gifts/new is a page for the owner: the form (moment, language, receiver, sender, poem style, tag), the make button, no robots, no store', pg.status === 200 && body === html && ['gift-moment', 'gift-language', 'gift-receiver', 'gift-sender', 'gift-style', 'gift-tag', 'gift-make'].every((t) => html.includes(`data-testid="${t}"`)) && html.includes('noindex') && pg.headers.get('cache-control') === 'no-store')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
  let parses = true
  try { new Function(script) } catch { parses = false }
  const used = [...script.matchAll(/\bt\('([a-z_]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('_'))
  const dyn = ['moment', 'language', 'receiver', 'sender', 'style', 'tag'].map((k) => `f_${k}`).concat(['default', 'tanka', 'haiku', 'tang', 'ci', 'en'].map((k) => `style_${k}`), ['ja', 'en', 'zh-Hant', 'zh-Hans'].map((l) => `lang_${l}`), ['c_tag', 'c_receiver', 'c_char', 'c_date', 'c_opened', 'c_link', 'err_generic', 'err_needs_more', 'err_limit', 'err_auth', 'err_moment', 'err_poem', 'err_engine', 'making', 'make'])
  check('(8) the page script is valid, plain JavaScript with no template literals, and every word it asks for exists in en, ja, zh-Hant and zh-Hans', parses && !script.includes('`') && [...used, ...dyn].every((k) => ['en', 'ja', 'zh-Hant', 'zh-Hans'].every((l) => typeof OWNER_GIFT_DICT[l][k] === 'string' && OWNER_GIFT_DICT[l][k].length > 0)), [...used, ...dyn].filter((k) => !OWNER_GIFT_DICT['zh-Hans'][k]).join())
  check('(8) the three languages carry the same words, and zh-Hans is the simplified form of zh-Hant (the language names stay as they are)', ['ja', 'zh-Hant', 'zh-Hans'].every((l) => Object.keys(OWNER_GIFT_DICT[l]).join() === OWNER_GIFT_KEYS.join()) && OWNER_GIFT_DICT['zh-Hans'].make === '制作礼物' && OWNER_GIFT_DICT['zh-Hans']['lang_zh-Hant'] === '繁體中文')
}

// ---- 9 · privacy and "never public" ------------------------------------------------------------------------------------------------------------------------------------------
{
  const all = logs.join('\n')
  check('(9) nothing printed carries the token, the moment, a name or the poem', !all.includes(TOKEN) && !all.includes('台所') && !all.includes('松本') && !all.includes('Brian'), all.slice(0, 300))
  const files: string[] = []
  const walk = async (dir: string) => {
    const { readdirSync, statSync } = await import('node:fs')
    for (const f of readdirSync(dir)) {
      if (['node_modules', 'dist', '.git', 'shots', 'review', 'design'].includes(f)) continue
      const p = join(dir, f)
      if (statSync(p).isDirectory()) await walk(p)
      else if (/\.(tsx?|html|json|md|css)$/.test(f)) files.push(p)
    }
  }
  for (const d of ['src', 'public']) await walk(join(process.cwd(), d))
  files.push(join(process.cwd(), 'index.html'))
  const linking = files.filter((f) => /ops\/gifts|ops\/api\/gifts/.test(readFileSync(f, 'utf8')))
  const opsPages = ['api/ops.ts', 'api/ops-home.ts', 'api/ops-stats.ts', 'api/ops-stats-client.ts', 'api/ops-customers.ts'].filter((f) => /ops\/gifts/.test(readFileSync(join(process.cwd(), f), 'utf8')))
  check('(9) no page of the site links to it: nothing in src, public or index.html, and no other /ops page, mentions /ops/gifts', linking.length === 0 && opsPages.length === 0, [...linking, ...opsPages].join())
  const app = readFileSync(join(process.cwd(), 'server', 'app.ts'), 'utf8')
  check('(9) it is mounted behind the /ops rate limit like every owner page', /app\.post\('\/ops\/api\/gifts', limited\(opsLimit\)/.test(app) && /app\.get\('\/ops\/gifts\/new', limited\(opsLimit\)/.test(app))
}

globalThis.fetch = realFetch
console.log = origLog
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll owner-gift checks passed.')
process.exit(failures ? 1 : 0)
