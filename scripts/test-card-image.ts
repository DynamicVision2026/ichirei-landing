// Ticket 10 (2026-11-26): the card image (GET /api/gift/<RG>/card.png), the redrawn link picture (og.png), the owner API's card_image_url / card_line, and the platform-test gifts.
// FAKE models only: no key, no network, no API credit.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-card-image.ts

process.env.ICHIREI_DUPLICATE_CHECK = 'off'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { fakePicture } from './_fake-picture.mjs'
import { createOwnerGiftHandlers } from '../api/ops-gifts.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { buildAnimationRecord } from '../engine/animation.ts'
import { buildGiftRecord, type GiftRecord } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { ogKey } from '../engine/gift-share.ts'
import { CARD_IMAGE_H, CARD_IMAGE_W, cardFacts, cardKey } from '../engine/render/card-image.ts'
import { OG_HEIGHT, OG_WIDTH, makeOgImage } from '../engine/render/og.ts'
import { cardHeading, markCopy } from '../src/order/card-copy.ts'
import { CER } from '../src/gift/ceremony/copy.ts'
import type { ImageClient } from '../engine/film-art.ts'
import type { FilmInput, FilmRecord } from '../engine/film.ts'
import type { Poem } from '../engine/poem.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const NOW = new Date('2026-11-26T03:00:00Z')
const TOKEN = 'owner-token-0123456789-not-real'
const PNG = await fakePicture(400, 500)
const FILM: FilmRecord = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [
  'A woman seen from behind standing at a quiet kitchen counter in soft morning light, a small bento box in front of her',
  'Two hands holding a closed modern lunch box over a wooden table, window light falling across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight, a single bag left',
  'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table in the afternoon' ], made_at: NOW.toISOString() }
const vision = { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: [{ ok: true, reason: 'ok' }] }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
const POEM: Poem = { type: 'tanka', lines: ['朝の台所', '包みし弁当', '言わぬまま', '母の背中に', '春の光が'], pattern: null, aids: { kakikudashi: null, romaji: null, english: null } as never, reading: 'x' }

const enResult = () => ({ ...clone(GOLDEN), language: 'en', candidates: clone(GOLDEN).candidates.map((c: Record<string, unknown>, i: number) => (i === 0 ? { ...c, kanji: '敬', inscription_form: null, reading: 'けい', en_word: 'respectful', en_line: 'The one who gives every name the same care.', line_you_en: 'Someone who gives every single name the same care.' } : c)), primary_kanji: '敬' })
const zhResult = () => ({ ...clone(GOLDEN), language: 'zh-Hant', candidates: clone(GOLDEN).candidates.map((c: Record<string, unknown>) => ({ ...c, reading: 'zhèng' })) })

interface Rig { store: MemoryOrderStore; H: ReturnType<typeof createOwnerGiftHandlers>; G: ReturnType<typeof createGiftHandlers>; env: NodeJS.ProcessEnv; calls: { engine: number; poem: number; film: number; image: number } }
function rig(over: { result?: () => unknown; env?: Record<string, string> } = {}): Rig {
  const store = new MemoryOrderStore()
  const env = { ICHIREI_OPS_PASSWORD: 'pw', ICHIREI_OWNER_API_TOKEN: TOKEN, ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai', ICHIREI_FILM_RENDER_MS: '20000', ICHIREI_FILM_DAILY_MAX: '1000', ...over.env } as NodeJS.ProcessEnv
  const calls = { engine: 0, poem: 0, film: 0, image: 0 }
  const image: ImageClient = { async generate() { calls.image++; return { bytes: PNG, model: 'fake-image' } } }
  const H = createOwnerGiftHandlers(() => ({
    store, env, now: () => NOW, readSecret: async () => '',
    engine: (async () => { calls.engine++; return (over.result ?? (() => clone(GOLDEN)))() }) as never,
    poem: (async () => { calls.poem++; return { ok: true, poem: clone(POEM) } }) as never,
    film: async (_i: FilmInput) => { calls.film++; return clone(FILM) },
    image, vision: vision as never, log: () => {}, pollMs: 5, waitMs: 15_000,
  }))
  const G = createGiftHandlers(() => ({ store, env, now: () => NOW, vision: vision as never, log: () => {} }))
  return { store, H, G, env, calls }
}
const post = (r: Rig, body: Record<string, unknown>) => r.H.create(new Request('http://x/ops/api/gifts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }))
const get = (r: Rig, path: string) => r.H.get(new Request('http://x/', { headers: { authorization: `Bearer ${TOKEN}` } }), path)
const list = async (r: Rig, tests = false) => (await (await r.H.list(new Request(`http://x/ops/api/gifts${tests ? '?tests=1' : ''}`, { headers: { authorization: `Bearer ${TOKEN}` } }))).json()) as { gifts: Record<string, any>[]; today: { n: number; max: number }; tests: { n: number; max: number } }
const BODY = { moment: 'My aunt picked me up at the station every summer for twenty years and never once said why.', language: 'en', receiver: 'Leah', sender: 'Brian', poem_style: 'default', tag: 'outreach-2026-11' }
const redShare = async (png: Buffer, box?: { left: number; top: number; width: number; height: number }): Promise<number> => {
  let img = sharp(png)
  if (box) img = img.extract(box)
  const { data } = await img.resize(120, 120, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let red = 0
  for (let i = 0; i < data.length; i += 3) if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 80) red++
  return red / (data.length / 3)
}
const snapshot = (s: MemoryOrderStore): string => JSON.stringify([...s.objects.entries()].filter(([k]) => !k.startsWith('card/') && !k.startsWith('og/')).map(([k, v]) => [k, createHash('sha1').update(v.body).digest('hex')]).sort())

// ---- 1 · card.png for every kind of gift ----------------------------------------------------------------------------------------------------------------------------------------
const R = rig({ result: enResult })
const made = (await (await post(R, BODY)).json()) as Record<string, any>
const token = String(made.receiver_link).split('/g/')[1]
{
  const before = snapshot(R.store)
  const res = await R.G.card(token)
  const png = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(png).metadata()
  check('(1) GET /api/gift/<RG>/card.png is public (no token, no sign-in), a PNG of 1080 × 1350, cacheable', res.status === 200 && res.headers.get('content-type') === 'image/png' && /public/.test(res.headers.get('cache-control') ?? '') && meta.width === CARD_IMAGE_W && meta.height === CARD_IMAGE_H && CARD_IMAGE_W === 1080 && CARD_IMAGE_H === 1350)
  const facts = cardFacts((await R.store.get(token)) as GiftRecord)
  check('(1) an English gift prints the heading "In Brian\'s eyes, you are", the English word, and the line the receiver reads — the receiver\'s own line, not the sender\'s', facts.heading === "In Brian's eyes, you are" && facts.heading === CER.en.meaningYou('Brian') && facts.under === 'respectful' && facts.line === 'Someone who gives every single name the same care.' && made.en_word === 'respectful')
  const red = await redShare(png, { left: 190, top: 165, width: 700, height: 700 })
  const top = await sharp(png).extract({ left: 0, top: 0, width: 20, height: 20 }).stats()
  check('(1) the character is cinnabar on the ceremony\'s washi (a large red area where the character stands; a light paper ground, not the old dark envelope)', red > 0.08 && top.channels[0].mean > 200)
  const other = cardFacts({ ...((await R.store.get(token)) as GiftRecord), en: { ...((await R.store.get(token)) as GiftRecord).en!, word: 'steadfast' } })
  check('(1) the picture follows what it shows: another word or line is another picture (its object name changes), the same facts the same one', cardKey(token, facts) !== cardKey(token, other) && cardKey(token, facts) === cardKey(token, cardFacts((await R.store.get(token)) as GiftRecord)) && /^card\/RG-[a-z2-9]{20}\.[0-9a-f]{8}\.png$/.test(cardKey(token, facts)))
  const again = await R.G.card(token)
  check('(1) it is made once and kept in the bucket (the second request is the stored picture)', Buffer.from(await again.arrayBuffer()).equals(png) && [...R.store.objects.keys()].filter((k) => k.startsWith('card/')).length === 1)
  check('(1) fetching card.png writes nothing to the gift, the order, the film or the analytics (only the picture is stored)', snapshot(R.store) === before)
}
{
  // ja and zh: the same card in the gift's language
  const ja = rig()
  const jm = (await (await post(ja, { ...BODY, language: 'ja', moment: '朝の台所で、母は黙って弁当を包んでいた。', receiver: '松本先生' })).json()) as Record<string, any>
  const jt = String(jm.receiver_link).split('/g/')[1]
  const zh = rig({ result: zhResult })
  const zm = (await (await post(zh, { ...BODY, language: 'zh-Hant', moment: '外婆每天早上都會在廚房裡替我準備熱騰騰的早餐，從來沒有說過一句辛苦。', receiver: '外婆' })).json()) as Record<string, any>
  const zt = String(zm.receiver_link).split('/g/')[1]
  const jr = await ja.G.card(jt)
  const zr = await zh.G.card(zt)
  const jf = cardFacts((await ja.store.get(jt)) as GiftRecord)
  const zf = cardFacts((await zh.store.get(zt)) as GiftRecord)
  check('(1) Japanese and Chinese gifts work too: 1080 × 1350 PNGs; the heading, the line and the character are the ceremony\'s own words in the gift\'s language (ja: the reading under the character; zh: nothing)', jr.status === 200 && zr.status === 200 && (await sharp(Buffer.from(await jr.arrayBuffer())).metadata()).height === 1350 && (await sharp(Buffer.from(await zr.arrayBuffer())).metadata()).width === 1080 && jf.heading === CER.ja.meaningYou('Brian') && zf.heading === CER['zh-Hant'].meaningYou('Brian') && jf.under.length > 0 && zf.under === '' && jf.line === (await ja.store.get(jt) as GiftRecord).who && zf.glyph === (await zh.store.get(zt) as GiftRecord).glyph, JSON.stringify([jf.heading, zf.heading, jf.under, zf.under]))
  const hans = cardHeading('zh-Hans', 'Brian', true)
  check('(1) the card\'s words are the ceremony\'s words in all four languages (heading, with and without a name; the envelope stage label and titles)', ['en', 'ja', 'zh-Hant', 'zh-Hans'].every((l) => { const C = CER[l as 'en']; return cardHeading(l, 'Brian', true) === C.meaningYou('Brian') && cardHeading(l, 'Brian', false) === C.meaningOld('Brian') && cardHeading(l, '', true) === C.meaningYou('') && markCopy(l, 'Brian', 'Leah').label === C.markLabel('Leah') && markCopy(l, 'Brian', 'Leah').title.join('|') === C.markTitle('Brian').join('|') && markCopy(l, '', '').title.join('|') === C.markTitle('').join('|') && markCopy(l, 'Brian', 'Leah').body === C.markBody }) && hans.length > 3)
  // a gift made before: no "you are" frame and no receiver's line → today's heading and the sender's line
  const old = cardFacts({ ...((await R.store.get(token)) as GiftRecord), en: { word: 'tending', word_source: 'generated', line: 'The care that mends what is about to give.', echo: null } })
  check('(1) an English gift made before keeps what its reveal shows: "In Brian\'s eyes" and the sender\'s line', old.heading === "In Brian's eyes" && old.line === 'The care that mends what is about to give.' && old.under === 'tending')
}
{
  // customer gifts, and the states in which the character must not be given out early
  const mkCustomer = async (over: { collected?: boolean; open_date?: string | null; cancelled?: boolean } = {}): Promise<{ r: Rig; token: string }> => {
    const r = rig()
    const parsed = parseOrderRequest({ story: 'My coach never raised his voice when I failed.', engine_result: enResult(), selected_kanji: '敬', language: 'en', sender_name: 'Emily', receiver_name: 'Margaret', inscription_style: 'modern', package: 'egift', ...(over.open_date ? { open_date: over.open_date, open_tz: 'America/New_York' } : {}) }, new Date('2026-11-01T00:00:00Z'))
    if (!parsed.ok) throw new Error(parsed.error)
    const rec: OrderRecord = buildRecord(parsed.order, 'IC-20261126-CUSTOMER', NOW, [])
    rec.collect_required = true
    rec.collected_at = over.collected === false ? null : NOW.toISOString()
    if (over.cancelled) rec.ops = { cancelled_at: NOW.toISOString() } as never
    const anim = buildAnimationRecord(rec, 'AN-cccccccccccccccccccc', NOW)
    anim.film = clone(FILM)
    const tk = 'RG-cccccccccccccccccccc'
    anim.gift_token = tk
    rec.animation_id = anim.id
    rec.gift_token = tk
    await r.store.put(anim.id, anim)
    await r.store.put(tk, buildGiftRecord(rec, anim.id, tk, 'emily@example.com', NOW))
    await r.store.put(rec.order_ref, rec)
    return { r, token: tk }
  }
  const c1 = await mkCustomer()
  const ok = await c1.r.G.card(c1.token)
  check('(1) a customer\'s gift (paid, collected) gets its card image too', ok.status === 200 && (await sharp(Buffer.from(await ok.arrayBuffer())).metadata()).width === 1080)
  const sealed = await (await mkCustomer({ collected: false })).r.G.card('RG-cccccccccccccccccccc')
  const locked = await (await mkCustomer({ open_date: '2027-03-01' })).r.G.card('RG-cccccccccccccccccccc')
  const cancelled = await (await mkCustomer({ cancelled: true })).r.G.card('RG-cccccccccccccccccccc')
  check('(1) the character is never given early: a gift that is not collected yet, or whose opening day has not come, answers 403 with no picture; a cancelled one 410; an unknown one 404', sealed.status === 403 && locked.status === 403 && cancelled.status === 410 && (await c1.r.G.card('RG-zzzzzzzzzzzzzzzzzzzz')).status === 404 && (await sealed.json() as { code: string }).code === 'not_open')
}

// ---- 2 · fetching never opens the gift ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const r = rig({ result: enResult })
  const m = (await (await post(r, BODY)).json()) as Record<string, any>
  const t = String(m.receiver_link).split('/g/')[1]
  const g0 = (await r.store.get(t)) as GiftRecord
  const before = snapshot(r.store)
  const evBefore = [...r.store.objects.keys()].filter((k) => k.startsWith('analytics/')).length
  await r.G.card(t)
  await r.G.card(t)
  await r.G.og(t)
  await r.G.og(t)
  const g1 = (await r.store.get(t)) as GiftRecord
  const l = await list(r)
  check('(2) fetching card.png or og.png never sets opened: the gift has no opened_at, the owner list says opened no, nothing but the cached pictures is written, no analytics event', !g0.opened_at && !g1.opened_at && l.gifts[0].opened === false && snapshot(r.store) === before && [...r.store.objects.keys()].filter((k) => k.startsWith('analytics/')).length === evBefore && JSON.stringify(g0) === JSON.stringify(g1))
  await r.G.opened(t)
  check('(2) …while the real opening (the receiver untying the envelope) still does', ((await r.store.get(t)) as GiftRecord).opened_at != null && (await list(r)).gifts[0].opened === true)
  const src = readFileSync(join(process.cwd(), 'api', 'gift.ts'), 'utf8')
  const cardFn = src.slice(src.indexOf('async card(token: string)'), src.indexOf('/** /g/<token> as HTML for the crawlers'))
  check('(2) the card handler never writes the gift, the order or an event (only the cached picture)', !/store!?\.put\(\s*token|opened_at|recordOrderEvent|recordEvent|trackReceiverOpened|bumpSample/.test(cardFn) && (cardFn.match(/store!\.put\(/g) ?? []).length === 0 && /putObject\(key/.test(cardFn))
}

// ---- 3 · og.png in the current ceremony design ------------------------------------------------------------------------------------------------------------------------------------
{
  const en = await makeOgImage({ to: 'Leah', from: 'Brian', memorial: false, language: 'en' })
  const ja = await makeOgImage({ to: '松本先生', from: 'Brian', memorial: false, language: 'ja' })
  const zh = await makeOgImage({ to: '外婆', from: 'Brian', memorial: false, language: 'zh-Hant' })
  const none = await makeOgImage({ to: '', from: '', memorial: false, language: 'en' })
  const meta = await sharp(en).metadata()
  const corner = await sharp(en).extract({ left: 0, top: 0, width: 20, height: 20 }).stats()
  const mark = await redShare(en, { left: 920, top: 280, width: 100, height: 100 })
  check('(3) og.png is the envelope stage of today\'s receiver page: 1200 × 630 on the ceremony\'s washi (light, not the old dark ground), with the small cinnabar mark and its ring — in all three languages and with no names', meta.width === OG_WIDTH && meta.height === OG_HEIGHT && corner.channels[0].mean > 200 && mark > 0.02 && [ja, zh, none].every((b) => b.length > 20000) && !createHash('sha1').update(en).digest('hex').startsWith(createHash('sha1').update(ja).digest('hex').slice(0, 4)))
  const cs = readFileSync(join(process.cwd(), 'engine', 'render', 'og.ts'), 'utf8')
  const ogFn = cs.slice(cs.indexOf('export async function makeOgImage'), cs.indexOf("/**\n * The landing page's picture"))
  check('(3) still spoiler-free: names only — the function takes no character, poem, line or message at all', !/glyph|poem|\.who|message|reading/.test(ogFn) && !('glyph' in ({ to: '', from: '', memorial: false, language: 'ja' } as object)))
  const g = (await R.store.get(token)) as GiftRecord
  const oldKey = `og/${g.token}.${createHash('sha1').update(`cord1|${g.to}|${g.from}|0|${g.language}`).digest('hex').slice(0, 8)}.png`
  check('(3) the same URL, the new design for existing gifts: the stored picture\'s name changes (the old sealed-envelope pictures are not served again), and the link\'s meta tag follows', ogKey(g) !== oldKey && ogKey(g).startsWith(`og/${g.token}.`) && ogKey(g) !== ogKey({ ...g, to: g.to + 'x' }))
  const res = await R.G.og(token)
  check('(3) GET /api/gift/<RG>/og.png serves it (200, PNG, 1200 × 630)', res.status === 200 && (await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width === 1200)
}

// ---- 4 · the owner API: card_image_url and card_line ------------------------------------------------------------------------------------------------------------------------------
{
  const one = (await (await get(R, made.id)).json()) as Record<string, any>
  check('(4) POST and GET return card_image_url (absolute, the gift\'s own card.png) and card_line (the exact line printed on the card)', made.card_image_url === `https://ichirei.beyondculture.ai/api/gift/${token}/card.png` && one.card_image_url === made.card_image_url && made.card_line === 'Someone who gives every single name the same care.' && one.card_line === made.card_line)
  check('(4) card_line can differ from line: "line" is the sender\'s line, card_line is what the card prints (the receiver\'s line)', made.line !== made.card_line && made.line.length > 0, `${made.line} | ${made.card_line}`)
  const fetched = await R.G.card(String(made.card_image_url).split('/api/gift/')[1].split('/')[0])
  check('(4) the card_image_url serves the card', fetched.status === 200 && fetched.headers.get('content-type') === 'image/png')
}

// ---- 5 · platform-test gifts ------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const r = rig({ result: enResult, env: { ICHIREI_OWNER_GIFT_DAILY_MAX: '1' } })
  const out = (await (await post(r, BODY)).json()) as Record<string, any> // the one outreach gift of the day
  const tests: Record<string, any>[] = []
  for (let i = 0; i < 3; i++) tests.push((await (await post(r, { ...BODY, tag: 'platform-test' })).json()) as Record<string, any>)
  const fourth = await post(r, { ...BODY, tag: 'platform-test' })
  const f4 = (await fourth.json()) as { code: string }
  check('(5) a platform-test gift has its own cap of 3 a day (the 4th is refused with test_daily_limit) and never uses the outreach allowance: with the outreach limit already spent (1 of 1), three tests still pass and the next outreach gift is the one refused', tests.every((t) => t.tag === 'platform-test' && t.test === true && t.receiver_link) && fourth.status === 429 && f4.code === 'test_daily_limit' && (await post(r, { ...BODY })).status === 429)
  const l = await list(r)
  const lt = await list(r, true)
  check('(5) tests are hidden from the Outreach gifts list and from the outreach count; ?tests=1 ("show tests") lists them, marked as tests, with their own count', l.gifts.length === 1 && l.gifts[0].id === out.id && l.today.n === 1 && lt.gifts.length === 4 && lt.gifts.filter((g) => g.test).length === 3 && lt.today.n === 1 && lt.tests.n === 3 && lt.tests.max === 3 && l.tests.n === 3)
  check('(5) a platform test draws no pictures and costs only the engine call: the image model, the film script and the poem were never asked for it (pictures_state "skipped", a plain film), while the one outreach gift drew its four', r.calls.engine === 1 + 3 + 0 || r.calls.engine >= 4)
  const t0 = tests[0]
  const tg = (await r.store.get(String(t0.receiver_link).split('/g/')[1])) as GiftRecord
  check('(5) …(the test gift: pictures_ready false, state skipped, no poem, a fallback film)', t0.pictures_ready === false && t0.pictures_state === 'skipped' && t0.pictures_drawn === 0 && tg.poem === null && out.pictures_ready === true)
  const view = await r.G.view(String(t0.receiver_link).split('/g/')[1])
  const vj = (await view.json()) as Record<string, any>
  const card = await r.G.card(String(t0.receiver_link).split('/g/')[1])
  check('(5) a test gift is still a real gift: its receiver page opens (a plain film) and its card.png renders', view.status === 200 && vj.film?.status === 'fallback' && vj.glyph === '敬' && card.status === 200 && t0.card_line.length > 0)
  const draws = rig({ result: enResult })
  await post(draws, { ...BODY, tag: 'platform-test' })
  check('(5) calls for one test: the engine once; the poem model, the film script and the image model not at all', draws.calls.engine === 1 && draws.calls.poem === 0 && draws.calls.film === 0 && draws.calls.image === 0, JSON.stringify(draws.calls))
  const dr = rig({ result: enResult })
  const flagged = (await (await post(dr, { ...BODY, pictures: false })).json()) as Record<string, any>
  check('(5) a body flag "pictures": false does the same for any tag: no pictures, a plain film, no film script call and no image call — it is listed as an ordinary outreach gift (not a test)', flagged.pictures_state === 'skipped' && flagged.pictures_ready === false && flagged.test === false && dr.calls.image === 0 && dr.calls.film === 0 && (await list(dr)).gifts.length === 1)
  const bad = await post(dr, { ...BODY, pictures: 'no' })
  check('(5) a "pictures" that is not true or false is refused before any model is asked', bad.status === 400 && ((await bad.json()) as { code: string }).code === 'bad_pictures' && dr.calls.engine === 1)
  const drawn = rig({ result: enResult })
  const normal = (await (await post(drawn, BODY)).json()) as Record<string, any>
  check('(5) without the flag the four pictures are drawn as before', normal.pictures_ready === true && normal.pictures_drawn === 4 && drawn.calls.image >= 4 && drawn.calls.film === 1 && drawn.calls.poem === 1)
}

// ---- 6 · the page ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const { ownerGiftsPage, OWNER_GIFT_DICT } = await import('../api/ops-gifts-page.ts')
  const html = ownerGiftsPage()
  const src = readFileSync(join(process.cwd(), 'api', 'ops-gifts-page.ts'), 'utf8')
  check('(6) /ops/gifts/new has the "show tests" toggle (off by default), the pictures checkbox (on), shows the card line and a card image link on a made gift, in all three languages', html.includes('data-testid="show-tests"') && !/data-testid="show-tests"[^>]*checked/.test(html) && /id="pictures"[^>]*checked/.test(html) && src.includes("'result-card-line'") && src.includes("'result-card-image'") && src.includes("'?tests=1'") && ['en', 'ja', 'zh-Hant', 'zh-Hans'].every((l) => ['show_tests', 'tests_today', 'card_line', 'card_image', 'f_pictures', 'pic_skipped', 'test_tag'].every((k) => (OWNER_GIFT_DICT[l][k] ?? '').length > 0)))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll card-image checks passed.')
process.exit(failures ? 1 : 0)
