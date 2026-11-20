// The read-only sample gift and the Examples page (2026-11-20). Fake models: no key, no network, no Shopify.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-sample.ts

import sharp from 'sharp'
import { fakePicture } from './_fake-picture.mjs'
import { createGiftHandlers } from '../api/gift.ts'
import { createPreviewHandlers } from '../api/preview.ts'
import { createExamplesHandlers } from '../api/examples.ts'
import { saveBasketItem } from '../engine/basket.ts'
import type { ImageClient } from '../engine/film-art.ts'
import type { FilmRecord } from '../engine/film.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { SlidingWindowLimiter } from '../engine/rate-limit.ts'
import { examplesFor, listSamples, makeSample, readStats, updateSample, MAX_EXAMPLES, neutralize } from '../engine/sample.ts'
import { newVisitorId } from '../engine/visitor.ts'
import { createHomeHandlers } from '../api/ops-home.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-20T03:00:00Z')
const BASE = await fakePicture(400, 500)
const VARIANTS = [BASE, await sharp(BASE).flop().png().toBuffer(), await sharp(BASE).flip().png().toBuffer(), await sharp(BASE).rotate(180).png().toBuffer()]
const filmOf = (name: string): FilmRecord => ({ status: 'ready', lines: [`${name} came home late.`, 'Two hands held a closed lunch box.', `${name}san left the porch light on.`, 'A small flower on a closed box.'], pictures: [
  `${name} seen from behind at a quiet kitchen counter in soft morning light, a bowl in front`, 'Two hands holding a closed lunch box over a wooden table, window light across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight', 'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table' ], made_at: NOW.toISOString() })
const OKV = { ok: true, reason: 'ok' }
const vision = { messages: { stream: (params: { messages: { content: unknown }[] }) => ({ finalMessage: async () => {
  const content = params.messages[0].content
  const text = typeof content === 'string' ? JSON.stringify({ picture: 'A wide quiet view of a kitchen window at dusk, a kettle on the stove, nobody in sight, soft grey light' }) : JSON.stringify({ pictures: (content as { type: string }[]).filter((b) => b.type === 'image').map(() => OKV) })
  return { content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
} }) } }

const store = new MemoryOrderStore()
let n = 0
const image: ImageClient = { async generate() { await new Promise((r) => setTimeout(r, 2)); return { bytes: VARIANTS[n++ % 4], model: 'fake-image' } } }
let currentFilm = filmOf('Kenji')
const P = createPreviewHandlers(() => ({ store, now: () => NOW, film: async () => JSON.parse(JSON.stringify(currentFilm)), image, vision: vision as never, env: { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_RENDER_MS: '20000', ICHIREI_FILM_CHECK_WAITS_MS: '0' } as never, log: () => {}, pollMs: 10, daily: new SlidingWindowLimiter(50, 86_400_000) }))
const G = createGiftHandlers(() => ({ store, now: () => NOW, env: { ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as never }))
const startDraft = async (story: string, language: string) => {
  const r = (await (await P.start(new Request('http://x/api/preview', { method: 'POST', body: JSON.stringify({ story, language, relationship: 'parent_mother', purpose: 'thanks', shown: ['支'] }) }))).json()) as { id: string }
  await P.render(r.id)
  return r.id
}
const B = newVisitorId()
const draftEn = await startDraft('Kenji cooked for us every Thanksgiving and never once sat down before everyone else had eaten.', 'en')
await saveBasketItem(store, B, { resume: { v: 1 }, story: 'x', language: 'en', kanji: '支', reading: 'shi', word: 'keeper', line: 'She keeps everyone at the table.', to: 'Kenji', relationship: 'parent_mother', purpose: 'thanks', occasion: 'thanksgiving', round: 1, slot: 'main', preview_id: draftEn, poem: { lines: ['Kenji set the table', 'and sat last'], reading: '' } }, NOW)

// ---- 1. making a sample --------------------------------------------------------------------------------------------------------------------------------------------
const refused = await makeSample(store, { id: draftEn, permission: false }, NOW)
check('(1) without the box ticked ("I have the giver\'s permission") nothing is made', !refused.ok && refused.code === 'no_permission' && (await listSamples(store)).length === 0)
check('(1) a made-up or malformed id is refused, and an id with no film is not found', !(await makeSample(store, { id: 'nope', permission: true }, NOW)).ok && (await makeSample(store, { id: 'AN-aaaaaaaaaaaaaaaaaaaa', permission: true }, NOW) as { code?: string }).code === 'not_found')
const made = await makeSample(store, { id: draftEn, permission: true, names: ['Kenji'], featured: true }, NOW)
check('(1) a sample is made from a draft: its own record, with the card the browser saved (支, keeper) and every name replaced by a neutral word — the changes are listed', made.ok && made.changes.length >= 3 && made.changes.every((c) => !/Kenji/.test(c)) && /someone/.test(made.changes.join(' ')), JSON.stringify(made))
if (!made.ok) throw new Error('no sample')
const token = made.token
const keys = [...store.records.keys()]
check('(1) no Shopify order and no promotion count: the only records are the draft, the sample\'s own film and its gift; nothing under promo/, customers\' orders or ordered events', keys.every((k) => /^(AN|RG)-/.test(k)) && [...store.objects.keys()].every((k) => !k.startsWith('promo/') && !k.startsWith('customers/byorder/')))

// ---- 2. what a visitor gets --------------------------------------------------------------------------------------------------------------------------------------------
const v = (await (await G.view(token)).json()) as Record<string, any>
const vs = JSON.stringify(v)
check('(2) the sample opens: the character 支, "You" from "ICHIREI", the example flag, no gift back, no e-gift, no certificate number, not replied', v.sample === true && v.glyph === '支' && v.to === 'You' && v.from === 'ICHIREI' && v.back === null && v.egift === null && v.certificate_no === null && v.replied === false, vs.slice(0, 300))
check('(2) no real name anywhere in what the page gets (the film lines, the line, the poem), and no e-mail or order data', !/Kenji/.test(vs) && !/@/.test(vs) && !/order_ref|order_date_|BK-|customer/.test(vs.replace(/order_date/g, '')) && /someone/.test(vs), vs.slice(0, 400))
check('(2) its four pictures are served through the sample\'s own link', Array.isArray(v.film?.pictures) && v.film.pictures.length === 4 && v.film.pictures.every((u: string) => u.startsWith(`/api/gift/${token}/picture/`)))
const pic = await G.picture(token, '1')
check('(2) a picture of the sample is served (200, webp) — the draft was copied, so it outlives the draft', pic.status === 200 && pic.headers.get('content-type') === 'image/webp')
const rendered = (await (await G.render(token)).json()) as { view?: Record<string, any> }
check('(2) the first-open render of a sample answers the same read-only view', rendered.view?.sample === true && rendered.view?.back === null)

// ---- 3. read-only: any number of times, nothing marked --------------------------------------------------------------------------------------------------------
for (let i = 0; i < 5; i++) await G.opened(token)
const rec = (await store.get(token)) as { opened_at?: string | null; reply?: unknown; answered_at?: string | null }
const stats = await readStats(store, token)
check('(3) opened five times: nothing is marked opened or answered on the record; only a count (5 opens)', !rec.opened_at && !rec.reply && !rec.answered_at && stats.views === 5, JSON.stringify({ rec, stats }))
check('(3) a sample never gives a gift back and never takes a reply: both are refused', (await G.back(token)).status === 403 && (await G.reply(token, { text: 'hello' })).status === 403)
await G.own(token)
check('(3) the last button ("Make one for someone of yours") is counted once for that sample', (await readStats(store, token)).own === 1)

// ---- 4. the link preview ------------------------------------------------------------------------------------------------------------------------------------------------
const html = await (await G.page(token, '<!doctype html><html><head><title>x</title></head><body></body></html>'))!.text()
check('(4) the link preview says "An ICHIREI gift (example)", points to /s/<token>, and never shows the character or any name', /An ICHIREI gift \(example\)/.test(html) && html.includes(`/s/${token}`) && !html.includes('支') && !/Kenji/.test(html))

// ---- 5. the switch -------------------------------------------------------------------------------------------------------------------------------------------------------
await updateSample(store, token, { on: false })
const off = await G.view(token)
check('(5) switched off, the page answers 410 sample_off (the calm line) and the link preview falls back to the plain page', off.status === 410 && ((await off.json()) as { code?: string }).code === 'sample_off' && (await G.page(token, '<html></html>')) === null && (await G.opened(token)).status === 410)
await updateSample(store, token, { on: true })
check('(5) switched on again it opens as before', (await G.view(token)).status === 200)

// ---- 6. the examples ----------------------------------------------------------------------------------------------------------------------------------------------------
currentFilm = filmOf('Haruka')
const draftJa = await startDraft('はるかは毎朝、黙って弁当を詰めてくれた。その手の速さを、ずっと覚えている。', 'ja')
const madeJa = await makeSample(store, { id: draftJa, permission: true, names: ['はるか', 'Haruka'], card: { kanji: '整', reading: 'ととのえる', line: '玄関の前で深く息をついて自分を整え、何でもなかったような声で「ただいま」と言う人。', language: 'ja', poem: null } }, NOW)
if (!madeJa.ok) throw new Error('no ja sample: ' + JSON.stringify(madeJa))
await updateSample(store, token, { examples: true, order: 2 })
await updateSample(store, madeJa.token, { examples: true, order: 1 })
const rows = await listSamples(store)
check('(6) the dashboard list has both samples with their character, language, link data and counts', rows.length === 2 && rows.every((r) => r.token && r.glyph && r.language && typeof r.views === 'number'))
const EX = createExamplesHandlers(() => ({ store }))
const exJa = ((await (await EX.list(new Request('http://x/api/examples?lang=ja'))).json()) as { examples: any[] }).examples
const exEn = ((await (await EX.list(new Request('http://x/api/examples?lang=en'))).json()) as { examples: any[] }).examples
check('(6) the examples page lists the switched-on samples, the page\'s own language first, then the others; each with its character, word or reading, one line, the first picture and a short line of the moment', exJa.length === 2 && exJa[0].language === 'ja' && exJa[1].language === 'en' && exEn[0].language === 'en' && exEn[1].language === 'ja' && exJa.every((e) => e.glyph && e.line && e.picture.endsWith('/picture/1.webp') && e.moment))
check('(6) an English card shows its English word and never a reading alone; a Japanese card its reading', exEn.find((e) => e.language === 'en').word === 'keeper' && exJa.find((e) => e.language === 'ja').word === 'ととのえる')
check('(6) no real name appears anywhere in the examples (either language)', !/Kenji|Haruka|はるか/.test(JSON.stringify([exJa, exEn])))
// at most four
const more: string[] = []
for (let i = 0; i < 4; i++) { const m = await makeSample(store, { id: draftEn, permission: true, names: ['Kenji'] }, NOW); if (m.ok) more.push(m.token) }
const results = []
for (const t of more) results.push(await updateSample(store, t, { examples: true, order: 5 }))
check('(6) at most four examples can be switched on: the fifth is refused', results.filter((r) => r.ok).length === MAX_EXAMPLES - 2 && results.some((r) => !r.ok && r.code === 'too_many'), JSON.stringify(results))
check('(6) examplesFor never returns more than four', examplesFor(await listSamples(store), 'ja').length <= MAX_EXAMPLES)
// featured: one per language
await updateSample(store, more[0], { featured: true })
const feat = (await listSamples(store)).filter((r) => r.featured && r.language === 'en')
check('(6) one featured sample per language: featuring another English sample takes the mark off the first', feat.length === 1 && feat[0].token === more[0])
await EX.count(new Request('http://x/api/examples/count', { method: 'POST', body: JSON.stringify({ kind: 'view' }) }))
await EX.count(new Request('http://x/api/examples/count', { method: 'POST', body: JSON.stringify({ kind: 'card' }) }))
const es = JSON.parse((await store.getObject('samples/stats/examples.json'))!.toString('utf8')) as { views: number; cards: number }
check('(6) examples-page views and cards opened are counted (counts only)', es.views === 1 && es.cards === 1)

// ---- 7. the neutral words ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const r = neutralize('健二さんは毎朝、健二の弁当を作った。', ['健二'], 'あの人')
  check('(7) names (with their さん) are replaced by a neutral word, each counted', r.text === 'あの人は毎朝、あの人の弁当を作った。' && r.n === 2, JSON.stringify(r))
}


// ---- 8. the dashboard's 見本 / Samples card (only the owner, behind /ops) ----------------------------------------------------------------------------------------------
{
  const H = createHomeHandlers(() => ({ store, env: { ICHIREI_OPS_PASSWORD: 'pw', ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as NodeJS.ProcessEnv, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }) }))
  const auth = { authorization: 'Basic ' + Buffer.from('owner:pw').toString('base64'), 'sec-fetch-site': 'same-origin' }
  const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const post = (path: string, o: Record<string, string>, headers: Record<string, string> = auth) => new Request(`http://x${path}`, { method: 'POST', headers, body: form(o) })
  check('(8) making a sample needs the owner\'s password', (await H.samplesMake(post('/ops/home/samples', { id: draftEn, permission: '1' }, { 'sec-fetch-site': 'same-origin' }))).status === 401)
  const noBox = await H.samplesMake(post('/ops/home/samples', { id: draftEn }))
  check('(8) without the permission box the dashboard says so and makes nothing', noBox.status === 303 && decodeURIComponent(noBox.headers.get('location') ?? '').includes('Tick the box'))
  const before = (await listSamples(store)).length
  const ok = await H.samplesMake(post('/ops/home/samples', { id: draftEn, permission: '1', names: 'Kenji' }))
  const loc = decodeURIComponent(ok.headers.get('location') ?? '')
  check('(8) 「見本にする」 builds the sample and the notice gives its link and the names it replaced', ok.status === 303 && /Made https:\/\/ichirei\.beyondculture\.ai\/s\/RG-/.test(loc) && /names replaced/.test(loc) && (await listSamples(store)).length === before + 1, loc)
  const page = await (await H.page(new Request('http://x/ops/home', { headers: auth }))).text()
  check('(8) the card lists every sample with its link, a QR PNG, opens and "made their own" counts, and the switches (on, featured, examples page, order)', /data-testid="samples"/.test(page) && /data-testid="sample-row"/.test(page) && /\/s\/RG-/.test(page) && /sample-qr\/RG-[a-z2-9]{20}\.png/.test(page) && /name="examples"/.test(page) && /name="order"/.test(page) && /data-testid="sample-sources"/.test(page) && /From an example gift \(src=x_sample\)/.test(page))
  const t = (await listSamples(store))[0].token
  const qr = await H.sampleQr(new Request('http://x/ops/home/sample-qr/' + t + '.png', { headers: auth }), t)
  const qb = Buffer.from(await qr.arrayBuffer())
  check('(8) the QR is a PNG that can be downloaded', qr.status === 200 && qr.headers.get('content-type') === 'image/png' && qb.subarray(1, 4).toString() === 'PNG' && /attachment/.test(qr.headers.get('content-disposition') ?? ''))
  await H.samplesUpdate(post('/ops/home/samples/update', { token: t, order: '3' }))
  const row = (await listSamples(store)).find((r) => r.token === t)!
  check('(8) the switches save: unticked boxes mean off (a checkbox that is not sent is off), the order number is kept', row.on === false && row.examples === false && row.order === 3)
  check('(8) a cross-site post is refused', (await H.samplesMake(post('/ops/home/samples', { id: draftEn, permission: '1' }, { authorization: auth.authorization, 'sec-fetch-site': 'cross-site' }))).status === 403)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
