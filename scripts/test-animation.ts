// The story film (/a/<id>): the record and view it is built from, the timeline and frame maths, the API (incl. "still being prepared"), the order
// wiring (the film is made when the order is made and can never block it), the sample films and the server routes. The script-writing call and its
// referee are tested by scripts/test-film.ts; the picture in a real browser by scripts/test-animation-browser.mjs.
//
//   node --experimental-strip-types scripts/test-animation.ts

import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ANIMATION_ID_PATTERN, SAMPLE_IDS, SAMPLE_RECORDS, animationSamplesOn, animationUrl, animationView, buildAnimationRecord, isAnimationRecord, newAnimationId, publicUrl, type AnimationRecord } from '../engine/animation.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { createOrderHandler } from '../api/order.ts'
import { checkFilmScript, fallbackFilm, type FilmInput, type FilmRecord } from '../engine/film.ts'
import { FILM_RETRY_AFTER_MS, filmInputFromRecord, filmWaitMs } from '../engine/film-store.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { loadPalette } from '../engine/palette.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { COPY, pageLang } from '../src/animation/copy.ts'
import { clamp, filmTimelineProblems, frameAt, makeFilmTimeline, phrases } from '../src/animation/film.ts'
// @ts-expect-error untyped .mjs
import { startServer } from './server-fixtures.mjs'

delete process.env.ICHIREI_FILM
let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const palette = loadPalette()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- 1. the id, the record, the view ------------------------------------------------------------------------------------------------------------------
{
  const ids = new Set(Array.from({ length: 500 }, () => newAnimationId()))
  check('(1) ids: AN- + 20 characters from a 32-symbol alphabet (100 bits), unique, and they fit the order store\'s key rule', ids.size === 500 && [...ids].every((i) => ANIMATION_ID_PATTERN.test(i) && /^[A-Za-z0-9-]{1,64}$/.test(i)))
  check('(1) …and nothing guessable is accepted: other prefixes, short ids, upper case, path tricks', !['AN-short', 'IC-20261023-ABCDEFGH', 'an-abcdefghjkmnpqrstuvw', 'AN-../../../etc/passwd', 'AN-ABCDEFGHJKMNPQRSTUVW', ''].some((i) => ANIMATION_ID_PATTERN.test(i)))
  check('(1) the public address: https://ichirei.soul-id.jp/a/<id> by default, ICHIREI_PUBLIC_URL overrides (a trailing slash is dropped)', animationUrl('AN-abcdefghjkmnpqrstuvw', {} as never) === 'https://ichirei.soul-id.jp/a/AN-abcdefghjkmnpqrstuvw' && publicUrl({ ICHIREI_PUBLIC_URL: 'https://x.example/' } as never) === 'https://x.example')
}

const GOLD = JSON.parse(read('scripts/golden-fixture.json'))
const STORY = '母は毎朝お弁当を作ってくれた。「ちょうど今詰めてたところ」と言って、何も言わずに台所に戻りました。'
const orderBody = (language: string, more: Record<string, unknown> = {}, candidate: Record<string, unknown> = {}) => ({
  story: STORY,
  engine_result: { ...clone(GOLD), language, candidates: GOLD.candidates.map((c: any, i: number) => (i === 0 ? { ...c, kanji: '備', inscription_form: null, reading: 'そなえる', story_anchor: '何も言わずに台所に戻りました', one_line_gaze: '毎朝、お弁当に庭の花をのせて、黙って備えてくれた人。', ...candidate } : c)), primary_kanji: '備' },
  selected_kanji: '備', language, sender_name: '山田 太郎', receiver_name: '山田 花子', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'standard', ...more,
})
const NOW = new Date('2026-10-28T03:00:00Z')
const parsed = parseOrderRequest(orderBody('ja'), NOW, palette)
if (!parsed.ok) throw new Error('fixture order does not parse: ' + parsed.error)
const orderRec = buildRecord(parsed.order, 'IC-20261028-ABCDEFGH', NOW, [])
const ID = 'AN-abcdefghjkmnpqrstuvw'
const rec = buildAnimationRecord(orderRec, ID, NOW)
const READY: FilmRecord = { status: 'ready', made_at: NOW.toISOString(), pictures: [...SAMPLE_RECORDS[SAMPLE_IDS.ja].film!.pictures], lines: ['春には、お弁当に\n庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、\n母は静かに台所へ戻った。', '教師になり、生徒に\n自分のお弁当を分けた日、母を思った。', '帰る日の弁当を頼むと、「ちょうど今詰めてたところ」。'] }
{
  check('(1) the record is built from what the engine already produced — the carved form, "your moment", "who they are", the reading, the remembrance flag — and has no film yet', rec.glyph === '備' && rec.moment === '何も言わずに台所に戻りました' && rec.who.startsWith('毎朝、お弁当') && rec.reading.length > 0 && rec.memorial === false && rec.film === null && rec.language === 'ja' && isAnimationRecord(rec) && !('poem' in rec) && !('script' in rec))
  const text = JSON.stringify(rec)
  check('(1) …and nothing else of the order: no names, no story, no delivery date, no package, no engine result', !['山田', '毎朝お弁当を作ってくれた', '2026-12-01', 'standard', 'candidates', 'sender_name', 'engine_result'].some((x) => text.includes(x)))
  const v = animationView({ ...rec, film: READY })
  check('(1) the view the page gets drops the order_ref and the dates; the film comes as {status, lines, pictures}; pictures are null until they are drawn; no film = null; an older film that has scene IDs and no descriptions counts as no film', !('order_ref' in v) && !('created_at' in v) && v.film?.status === 'ready' && v.film.lines.length === 4 && v.film.pictures === null && animationView(rec).film === null && animationView({ ...rec, film: { status: 'ready', lines: READY.lines, scenes: ['S-01'] } as never }).film === null)
  const memOrder = parseOrderRequest(orderBody('ja', { engine_result: { ...clone(orderBody('ja').engine_result), occasion: 'memorial' } }), NOW, palette)
  check('(1) the remembrance flag follows the order\'s certificate (memorial occasion → true)', memOrder.ok && buildAnimationRecord(buildRecord(memOrder.order, 'IC-20261028-MEMMEMME', NOW, []), ID, NOW).memorial === true, memOrder.ok ? '' : memOrder.error)
  const fi = filmInputFromRecord(orderRec)
  check('(1) the film input of an order: the saved story, language, relationship, direction, occasion, remembrance flag, the carved character with its forms, "who they are", "your moment", the names (only to be kept out of the lines)', fi.story.includes('ちょうど今詰めてたところ') && fi.language === 'ja' && fi.glyph === '備' && fi.forms.includes('備') && fi.who.startsWith('毎朝、お弁当') && fi.moment === '何も言わずに台所に戻りました' && fi.memorial === false && fi.names.includes('山田 太郎') && fi.occasion === (GOLD.occasion ?? fi.occasion) && typeof fi.relationship !== 'undefined')
}

// ---- 2. the timeline and the frames -----------------------------------------------------------------------------------------------------------------
{
  const t = makeFilmTimeline(4, false)
  check('(2) the film is 30 seconds: four scenes of 5 s (0–5, 5–10, 10–15, 15–20), the character 20–27 s, "who they are" and the seal 27–30 s', t.total === 30 && t.scenes.map((s) => s.start).join() === '0,5,10,15' && t.final.fadeIn.start >= 20 && t.final.reveal.start >= 20 && t.final.reading.end <= 27 && t.final.who.start >= 26.5 && t.final.seal.end === 29.3 + 0 && t.final.who.end <= 30)
  check('(2) scenes cross-fade for 0.8 s (each ends 0.4 s into the next one\'s time slot); the lines appear phrase by phrase, 0.9 s apart, starting 0.9 s into the scene', t.scenes.every((s, i) => Math.abs(s.end - (5 * i + 5.4)) < 1e-6) && t.phraseAt(0, 0) === 0.9 && t.phraseAt(0, 1) === 1.8 && t.phraseAt(2, 0) === 10.9)
  const mem = makeFilmTimeline(4, true)
  check('(2) a remembrance film is slower: 5.5 s per scene and 37.5 s in all, in order, inside the film', mem.total === 37.5 && mem.scenes.map((s) => s.start).join() === '0,5.5,11,16.5' && filmTimelineProblems(mem).length === 0)
  const fb = makeFilmTimeline(2, false)
  check('(2) the fallback film (two scenes) is 20 s — the character at 10 s — and still in order', fb.total === 20 && fb.final.fadeIn.start === 10.2 && filmTimelineProblems(fb).length === 0 && makeFilmTimeline(2, true).total === 26.5)
  const bad: string[] = []
  for (const n of [1, 2, 3, 4]) for (const m of [false, true]) bad.push(...filmTimelineProblems(makeFilmTimeline(n, m)).map((p) => `${n}/${m}: ${p}`))
  check('(2) for 1–4 scenes, normal or remembrance: spans in order, inside the film, cross-fades overlap by no more than 0.4 s', bad.length === 0, bad.join(' | '))
  check('(2) the guard catches a broken timeline (a scene that starts after the last has ended, a seal outside the film)', filmTimelineProblems({ ...t, scenes: [t.scenes[0], { start: 9, end: 10 }, ...t.scenes.slice(2)] }).length > 0 && filmTimelineProblems({ ...t, final: { ...t.final, seal: { start: 29, end: 31 } } }).length > 0)
  const lines = READY.lines
  const f0 = frameAt(0, t, lines)
  const f3 = frameAt(3, t, lines)
  const fx = frameAt(5.2, t, lines)
  check('(2) frames: at 0 s nothing is visible; at 3 s scene 1 is fully there with all its phrases; at 5.2 s scenes 1 and 2 are both partly visible (the cross-fade); the character is not there yet', f0.scenes[0].opacity === 0 && f3.scenes[0].opacity === 1 && f3.scenes[0].phrases.every((p) => p > 0.99) && f3.scenes[1].opacity === 0 && fx.scenes[0].opacity > 0 && fx.scenes[0].opacity < 1 && fx.scenes[1].opacity > 0 && fx.scenes[1].opacity < 1 && f3.final.opacity === 0 && f3.final.reveal === 0)
  const f22 = frameAt(22, t, lines)
  const f30 = frameAt(30, t, lines)
  check('(2) frames: at 22 s the character is being revealed (between 0 and 1), no scene is visible; at 30 s everything is on: character, reading, who line and seal; progress runs 0 → 1', f22.final.reveal > 0 && f22.final.reveal < 1 && f22.scenes.every((s) => s.opacity === 0) && f30.final.reveal === 1 && f30.final.reading === 1 && f30.final.who === 1 && f30.final.seal === 1 && f0.progress === 0 && f30.progress === 1)
  check('(2) opacity never leaves 0–1 and the picture\'s push-in progress is 0 → 1 over its scene, for any time, even outside the film', [-5, 0, 0.1, 4.9, 5.4, 12.3, 19.99, 20.1, 27, 29.99, 30, 31, 100].every((x) => frameAt(x, t, lines).scenes.every((s) => s.opacity >= 0 && s.opacity <= 1 && s.progress >= 0 && s.progress <= 1)) && clamp(2) === 1 && clamp(-1) === 0)
  check('(2) phrases: one line break at most gives two phrases; empty parts are dropped', phrases('a\nb').length === 2 && phrases('abc').length === 1 && phrases(' a \n\n ').length === 1 && frameAt(3, t, ['a\nb', 'c', 'd', 'e']).scenes[0].phrases.length === 2)
}

// ---- 3. the API -----------------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  await store.put(ID, { ...rec, film: READY })
  await store.put('IC-20261028-ABCDEFGH', orderRec)
  const h = createAnimationHandlers(() => ({ store, env: {} as never }))
  const ok = await h.view(ID)
  const okJ = (await ok.json()) as any
  check('(3) GET /api/animation/<id>: 200 with the view and its film, never cached by anyone but the browser, never indexed', ok.status === 200 && okJ.glyph === '備' && okJ.film.lines.length === 4 && !('order_ref' in okJ) && ok.headers.get('cache-control') === 'private, no-store' && ok.headers.get('x-robots-tag') === 'noindex, nofollow')
  const missing = await h.view('AN-aaaaaaaaaaaaaaaaaaaa')
  const bad = await h.view('IC-20261028-ABCDEFGH')
  const trick = await h.view('../orders')
  check('(3) an unknown id, an order_ref, a path trick → the same 404 (an order record is never served through this route)', missing.status === 404 && bad.status === 404 && trick.status === 404 && ((await bad.json()) as any).error === 'not_found')
  const down = await createAnimationHandlers(() => ({ store: null })).view(ID)
  const flaky = await createAnimationHandlers(() => ({ store: { kind: 'memory', get: async () => { throw new Error('boom') }, put: async () => {}, appendJsonl: async () => {} } as never })).view(ID)
  check('(3) no store, or a store that fails → 503 (never a 404 that would look like a wrong link)', down.status === 503 && flaky.status === 503)
  const qr = await h.qr(ID)
  const svg = await qr.text()
  check('(3) GET /api/animation/<id>/qr.svg: an SVG QR code of the page address (for the printed card); unknown id → 404', qr.status === 200 && qr.headers.get('content-type')?.startsWith('image/svg+xml') === true && svg.includes('<svg') && svg.includes('path') && (await h.qr('AN-aaaaaaaaaaaaaaaaaaaa')).status === 404)

  // a film still being written
  const PEND = 'AN-pendingpendingpendi2'
  const pend: AnimationRecord = { ...rec, id: PEND }
  await store.put(PEND, pend)
  let calls = 0
  const slowFilm = async (): Promise<FilmRecord> => { calls++; await sleep(150); return READY }
  const young = createAnimationHandlers(() => ({ store, env: {} as never, now: () => NOW, film: slowFilm }))
  const early = (await (await young.view(PEND)).json()) as any
  check('(3) a film that is not there yet: the view answers 200 with film: null (the page shows its quiet "preparing" screen and asks again); a young record does not start a second call', early.film === null && early.glyph === '備' && calls === 0)
  const old = createAnimationHandlers(() => ({ store, env: {} as never, now: () => new Date(NOW.getTime() + FILM_RETRY_AFTER_MS + 5000), film: slowFilm }))
  const [v1, v2] = await Promise.all([old.view(PEND), old.view(PEND)])
  const j1 = (await v1.json()) as any
  const j2 = (await v2.json()) as any
  check('(3) a record older than 25 s still without a film (a restart cut the first try short): the view makes it now — once, however many people look at the same time — and answers with it', j1.film?.status === 'ready' && j2.film?.status === 'ready' && calls === 1, `calls=${calls}`)
  const saved = (await store.get(PEND)) as AnimationRecord
  const savedOrder = (await store.get('IC-20261028-ABCDEFGH')) as any
  check('(3) …and saves it on the animation record and on the order record (production.film), so the next look needs no call', saved.film?.status === 'ready' && savedOrder.production.film?.status === 'ready' && (await (await old.view(PEND)).json() as any).film.status === 'ready' && calls === 1)
  const fbStore = new MemoryOrderStore()
  await fbStore.put('AN-fallbackfallbackfa22', { ...rec, id: 'AN-fallbackfallbackfa22' })
  await fbStore.put('IC-20261028-ABCDEFGH', orderRec)
  const failing = createAnimationHandlers(() => ({ store: fbStore, env: {} as never, now: () => new Date(NOW.getTime() + 60000), film: async () => { throw new Error('model down') } }))
  const quiet = console.error
  console.error = () => {}
  const fv = await failing.view('AN-fallbackfallbackfa22')
  console.error = quiet
  check('(3) a film step that throws never breaks the page: 200, film still null (it will be asked again)', fv.status === 200 && ((await fv.json()) as any).film === null)
  const noOrder = new MemoryOrderStore()
  await noOrder.put('AN-lonelylonelylonely22', { ...rec, id: 'AN-lonelylonelylonely22', order_ref: 'IC-20261028-GONEGONE' })
  const lonely = await createAnimationHandlers(() => ({ store: noOrder, env: {} as never, now: () => new Date(NOW.getTime() + 60000), film: slowFilm })).view('AN-lonelylonelylonely22')
  check('(3) an animation whose order record is gone: 200 with film null, no crash', lonely.status === 200 && ((await lonely.json()) as any).film === null)
}

// ---- 3b. the first open: drawing the pictures, serving them -------------------------------------------------------------------------------------------------
{
  const PNG = await sharp({ create: { width: 300, height: 380, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
  const mkRig = (over: { image?: () => Promise<unknown>; env?: Record<string, string>; film?: (i: FilmInput) => Promise<FilmRecord> } = {}) => {
    const store = new MemoryOrderStore()
    let imageCalls = 0
    let filmCalls = 0
    const image = { async generate() { imageCalls++; await sleep(10); await over.image?.(); return { bytes: PNG, model: 'fake' } } }
    const vision = { messages: { stream: (params: any) => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: params.messages[0].content.filter((b: any) => b.type === 'image').map(() => ({ ok: true, reason: 'ok' })) }) }], usage: { input_tokens: 10, output_tokens: 5 } }) }) } }
    const logs: string[] = []
    const film = async (i: FilmInput) => { filmCalls++; return (over.film ?? (async () => READY))(i) }
    const h = createAnimationHandlers(() => ({ store, env: { ICHIREI_FILM_DAILY_MAX: '100', ...(over.env ?? {}) } as never, now: () => new Date(NOW.getTime() + 120_000), film, image: image as never, vision: vision as never, log: (l) => logs.push(l), pollMs: 10 }))
    return { store, h, logs, imageCalls: () => imageCalls, filmCalls: () => filmCalls }
  }
  const RID = 'AN-renderrenderrender22'
  const post = async (r: ReturnType<typeof mkRig>, id = RID) => ((await (await r.h.render(id)).json()) as any)
  {
    const r = mkRig()
    await r.store.put(RID, { ...rec, id: RID, film: READY })
    const before = (await (await r.h.view(RID)).json()) as any
    const a = await post(r)
    const pic = await r.h.picture(RID, '2')
    const bytes = Buffer.from(await pic.arrayBuffer())
    const meta = await sharp(bytes).metadata()
    const second = await post(r)
    const after = (await (await r.h.view(RID)).json()) as any
    check('(3b) the first open: the view says "script ready, pictures not drawn" (pictures: null); POST /api/film/<id>/render draws the four pictures and answers {state: ready, view} with four private picture addresses', before.film.pictures === null && a.state === 'ready' && a.view.film.pictures.length === 4 && a.view.film.pictures.every((u: string, i: number) => u.startsWith(`/api/film/${RID}/picture/${i + 1}.webp?v=`)) && r.imageCalls() === 4)
    check('(3b) GET /api/film/<id>/picture/<n>.webp serves the saved WebP (1080×1350) through the server — private cache, never indexed; every later open gets the pictures from the view with no new image call', pic.status === 200 && pic.headers.get('content-type') === 'image/webp' && /^private,/.test(pic.headers.get('cache-control') ?? '') && pic.headers.get('x-robots-tag') === 'noindex, nofollow' && meta.width === 1080 && meta.height === 1350 && second.state === 'ready' && r.imageCalls() === 4 && after.film.pictures.length === 4 && after.film.pictures[0].includes('/picture/1.webp'))
    const bad = await Promise.all([r.h.picture(RID, '5'), r.h.picture(RID, '0'), r.h.picture(RID, 'x'), r.h.picture('AN-aaaaaaaaaaaaaaaaaaaa', '1'), r.h.picture('../orders', '1'), r.h.picture('IC-20261028-ABCDEFGH', '1')])
    check('(3b) a picture is served only for a valid id and number 1–4 that exists: 5, 0, a word, an unknown id, a path trick, an order_ref → 404', bad.every((x) => x.status === 404))
    const none = await createAnimationHandlers(() => ({ store: null })).picture(RID, '1')
    check('(3b) no store → 503 (never a 404 that looks like a wrong link)', none.status === 503)
  }
  {
    const r = mkRig()
    await r.store.put(RID, { ...rec, id: RID, film: READY })
    const [x, y, z] = await Promise.all([post(r), post(r), post(r)])
    check('(3b) three first opens at once make ONE set of pictures (four image calls in all), and all three get it', r.imageCalls() === 4 && [x, y, z].every((o) => o.state === 'ready' && o.view.film.pictures.length === 4))
  }
  {
    const r = mkRig()
    await r.store.put('IC-20261028-ABCDEFGH', orderRec)
    await r.store.put(RID, { ...rec, id: RID, film: null })
    const a = await post(r)
    const savedAnim = (await r.store.get(RID)) as AnimationRecord
    const savedOrder = (await r.store.get('IC-20261028-ABCDEFGH')) as any
    check('(3b) the script was lost (no film on the record): the same render request writes the script first (from the saved order), saves it on both records, then draws the pictures', a.state === 'ready' && r.filmCalls() === 1 && r.imageCalls() === 4 && savedAnim.film?.status === 'ready' && savedOrder.production.film?.pictures.length === 4)
    const r2 = mkRig()
    await r2.store.put('IC-20261028-ABCDEFGH', orderRec)
    await r2.store.put(RID, { ...rec, id: RID, film: { status: 'ready', made_at: NOW.toISOString(), lines: READY.lines, scenes: ['S-02', 'S-12', 'S-21', 'S-15'] } as never })
    const b = await post(r2)
    check('(3b) a film written before pictures came from descriptions (it has scene IDs, no descriptions) is written again on the first open', b.state === 'ready' && r2.filmCalls() === 1 && r2.imageCalls() === 4)
    const r3 = mkRig()
    await r3.store.put(RID, { ...rec, id: RID, film: null })
    const c = await post(r3)
    check('(3b) the script cannot be written (the order record is gone): the answer is "pending" with film: null — no crash, no image call', c.state === 'pending' && c.view.film === null && r3.imageCalls() === 0)
  }
  {
    const r = mkRig()
    await r.store.put(RID, { ...rec, id: RID, film: { status: 'fallback', made_at: NOW.toISOString(), lines: ['a', 'b'], pictures: [], reason: 'timeout' } })
    const a = await post(r)
    check('(3b) a fallback script has nothing to draw: ready at once with two washi pictures (/film/washi-1.webp, washi-2.webp), no image call', a.state === 'ready' && a.view.film.pictures.join() === '/film/washi-1.webp,/film/washi-2.webp' && r.imageCalls() === 0)
  }
  {
    const r = mkRig({ image: () => sleep(400), env: { ICHIREI_FILM_RENDER_MS: '150' } })
    await r.store.put(RID, { ...rec, id: RID, film: READY })
    const t0 = Date.now()
    const a = await post(r)
    const quick = Date.now() - t0
    await sleep(900)
    const b = await post(r)
    check('(3b) a render that takes longer than the request may stay open (here 150 ms of a 400 ms set) answers "pending" with no pictures yet; asking again joins it and returns the finished set (no second set)', a.state === 'pending' && a.view.film.pictures === null && quick < 380 && b.state === 'ready' && b.view.film.pictures.length === 4 && r.imageCalls() === 4, `${quick} ms`)
  }
  {
    const r = mkRig({ env: { ICHIREI_FILM_DAILY_MAX: '0.5' } })
    const r0 = mkRig({ env: { ICHIREI_FILM_DAILY_MAX: '1' } })
    await r0.store.put(RID, { ...rec, id: RID, film: READY })
    await r0.store.put('AN-secondsecondsecond22', { ...rec, id: 'AN-secondsecondsecond22', film: READY })
    const a = await post(r0)
    const b = await post(r0, 'AN-secondsecondsecond22')
    void r
    check('(3b) above the daily limit the answer is {state: deferred} and the view says so (the page shows 「映像は明日お届けします」); nothing is drawn', a.state === 'ready' && b.state === 'deferred' && b.view.film.deferred === true && b.view.film.pictures === null && r0.imageCalls() === 4)
  }
  {
    const r = mkRig()
    const [missing, bad] = await Promise.all([r.h.render('AN-aaaaaaaaaaaaaaaaaaaa'), r.h.render('IC-20261028-ABCDEFGH')])
    const down = await createAnimationHandlers(() => ({ store: null })).render(RID)
    check('(3b) render: an unknown id or an order_ref → 404; no store → 503', missing.status === 404 && bad.status === 404 && down.status === 503)
  }
}

// ---- 4. the sample films (for the owner's phone tests) ---------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const off = createAnimationHandlers(() => ({ store, env: {} as never }))
  const on = createAnimationHandlers(() => ({ store, env: { ICHIREI_ANIMATION_SAMPLES: 'on' } as never }))
  check('(4) the four sample ids are valid ids and each has a valid record with a finished script: four lines and four picture descriptions — Japanese, Chinese, English, remembrance', Object.values(SAMPLE_IDS).length === 4 && Object.values(SAMPLE_IDS).every((i) => ANIMATION_ID_PATTERN.test(i) && isAnimationRecord(SAMPLE_RECORDS[i]) && SAMPLE_RECORDS[i].film?.status === 'ready' && SAMPLE_RECORDS[i].film!.lines.length === 4 && SAMPLE_RECORDS[i].film!.pictures.length === 4) && SAMPLE_RECORDS[SAMPLE_IDS.memorial].memorial === true && SAMPLE_RECORDS[SAMPLE_IDS.zh].language === 'zh-Hant' && SAMPLE_RECORDS[SAMPLE_IDS.en].language === 'en')
  const probs: string[] = []
  for (const r of Object.values(SAMPLE_RECORDS)) {
    const f = r.film!
    // the samples' own stories are not stored; the lines stand in for them, so every check except "quotations are in the story" is real
    const input: FilmInput = { story: f.lines.join('\n'), language: r.language, relationship: null, direction: null, occasion: r.memorial ? 'memorial' : null, occasion_detail: null, memorial: r.memorial, glyph: r.glyph, forms: [r.glyph], who: r.who, moment: r.moment, names: [] }
    for (const p of checkFilmScript({ lines: f.lines, pictures: f.pictures }, input, palette)) probs.push(`${r.id}: ${p.code} ${p.detail}`)
  }
  check('(4) every sample script passes the same referee a real one has to pass (lengths, no digits, no character in the lines, no illness words, no blocked characters, scene rules)', probs.length === 0, probs.join(' | '))
  check('(4) …and the Japanese sample\'s pictures are written from story 0020 (a bento with one spring flower, a lunch box passed across a desk) — only what the story says', /bento box/.test(SAMPLE_RECORDS[SAMPLE_IDS.ja].film!.pictures[0]) && /lunch box/.test(SAMPLE_RECORDS[SAMPLE_IDS.ja].film!.pictures[2]) && SAMPLE_RECORDS[SAMPLE_IDS.memorial].film!.pictures.every((d) => !/cake|candle|party|festival/i.test(d)))
  check('(4) off by default (and for anything but "on"): a sample id is a plain 404; on: it plays without any order behind it', !animationSamplesOn({} as never) && !animationSamplesOn({ ICHIREI_ANIMATION_SAMPLES: 'off' } as never) && animationSamplesOn({ ICHIREI_ANIMATION_SAMPLES: 'on' } as never) && (await off.view(SAMPLE_IDS.ja)).status === 404 && (await on.view(SAMPLE_IDS.ja)).status === 200)
  const v = (await (await on.view(SAMPLE_IDS.ja)).json()) as any
  check('(4) the sample view has the shape of a real one (glyph, who, film with four lines; pictures null until the first open draws them) and holds no order data', v.glyph === '備' && v.film.lines.length === 4 && v.film.pictures === null && !('order_ref' in v) && (await on.qr(SAMPLE_IDS.ja)).status === 200 && (await on.view('AN-sample' + 'x'.repeat(11))).status === 404)
}

// ---- 5. the order wiring --------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const carts: any[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    carts.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/1', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })
  }) as unknown as typeof fetch
  const shopify = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN_PUBLIC: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2' } as never).config!
  const inputs: FilmInput[] = []
  const goodFilm = async (i: FilmInput): Promise<FilmRecord> => { inputs.push(i); return READY }
  const handler = (o: Partial<Parameters<typeof createOrderHandler>[0] extends () => infer D ? D : never> & { s?: any } = {}) => createOrderHandler(() => ({ store: o.s ?? store, shopify, shopifyMissing: [], now: () => NOW, fetchImpl, env: {}, film: goodFilm, filmWaitMs: 2000, ...o }))
  const post = (h: (r: Request) => Promise<Response>, body: unknown) => h(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(body) }))
  const res = await post(handler(), orderBody('ja'))
  const j = (await res.json()) as any
  const attrs = carts[0].variables.input.lines[0].attributes as { key: string; value: string }[]
  const link = attrs.find((a) => a.key === 'ichirei_animation_url')?.value ?? ''
  const id = link.split('/').pop() ?? ''
  check('(5) an order makes its film with no manual step: the response and the Shopify line item carry the private address (ichirei_animation_url), https://ichirei.soul-id.jp/a/AN-…', res.status === 200 && j.animation_url === link && /^https:\/\/ichirei\.soul-id\.jp\/a\/AN-[a-z2-9]{20}$/.test(link))
  const stored = (await store.get(id)) as AnimationRecord
  const order = (await store.get(j.order_ref)) as any
  check('(5) …the film script is saved on the animation record (what the page plays) AND with the order (production.film, beside the certificate data); the order points to the animation; the pictures are NOT drawn at order time (unpaid orders cost nothing for pictures)', isAnimationRecord(stored) && stored.film?.status === 'ready' && stored.film.lines.length === 4 && order.production.film?.status === 'ready' && order.production.film.pictures.join() === READY.pictures.join() && order.animation_id === id && stored.order_ref === j.order_ref && (await store.getObject(`films/${id}/art.json`)) === null && (await store.getObject(`films/${id}/1.webp`)) === null)
  check('(5) …the film step got the saved story, the language, the carved character and the "who they are" line of this order', inputs.length === 1 && inputs[0].story.includes('ちょうど今詰めてたところ') && inputs[0].glyph === '備' && inputs[0].language === 'ja' && inputs[0].who.startsWith('毎朝'))
  check('(5) …and the cart sees only the link: no story, no film lines in any attribute', !JSON.stringify(carts[0]).includes('台所に戻りました') && !JSON.stringify(carts[0]).includes('庭の花を一輪') && attrs.at(-1)?.key === 'ichirei_animation_url')
  const pub = await post(handler({ env: { ICHIREI_PUBLIC_URL: 'https://example.test' } as never }), orderBody('ja'))
  check('(5) ICHIREI_PUBLIC_URL sets the address in the link', ((await pub.json()) as any).animation_url.startsWith('https://example.test/a/AN-'))

  // a film that is slow: the buyer is not kept waiting, and the film is still saved when it finishes
  carts.length = 0
  const t0 = Date.now()
  const slow = await post(handler({ film: async () => { await sleep(400); return READY }, filmWaitMs: 50 }), orderBody('ja'))
  const slowJ = (await slow.json()) as any
  const early = Date.now() - t0
  const slowId = slowJ.animation_url.split('/').pop()
  const before = (await store.get(slowId)) as AnimationRecord
  await sleep(600)
  const after = (await store.get(slowId)) as AnimationRecord
  const afterOrder = (await store.get(slowJ.order_ref)) as any
  check('(5) a slow film does not hold the buyer: the answer comes after the short wait (here 50 ms of a 400 ms film), the link is already valid, and the film is saved on both records when it finishes', slow.status === 200 && early < 350 && before.film === null && after.film?.status === 'ready' && afterOrder.production.film?.status === 'ready' && afterOrder.status === 'cart_created', `early=${early}`)

  // a film step that throws can never block or fail the order
  const quiet = console.error
  console.error = () => {}
  const boom = await post(handler({ film: async () => { throw new Error('model exploded') } }), orderBody('ja'))
  console.error = quiet
  const boomJ = (await boom.json()) as any
  check('(5) a film step that throws does not touch the order: 200, checkout url, the link still given (the page will make the film on first look)', boom.status === 200 && !!boomJ.checkout_url && boomJ.animation_url.includes('/a/AN-') && ((await store.get(boomJ.order_ref)) as any).status === 'cart_created')

  // the fallback film (the model failed twice) is saved like any other
  const fb = await post(handler({ film: async (i) => fallbackFilm(i, 'timeout', NOW) }), orderBody('ja'))
  const fbJ = (await fb.json()) as any
  const fbRec = (await store.get(fbJ.animation_url.split('/').pop())) as AnimationRecord
  check('(5) the fallback film (two lines, nothing to draw) is saved and served like any other; the order is the same', fb.status === 200 && fbRec.film?.status === 'fallback' && fbRec.film.pictures.length === 0 && fbRec.film.lines.length === 2 && fbRec.film.lines[0] === '何も言わずに台所に戻りました' && fbRec.film.lines[1].startsWith('毎朝') && fbRec.film.reason === 'timeout')

  // the animation record may fail without stopping the order
  const failing: any = { kind: 'memory', put: async (ref: string, r: object) => { if (ref.startsWith('AN-')) throw new Error('animation store down'); await store.put(ref, r) }, get: async (ref: string) => store.get(ref), appendJsonl: async () => {} }
  console.error = () => {}
  carts.length = 0
  const soft = await post(handler({ s: failing }), orderBody('ja'))
  console.error = quiet
  const softJ = (await soft.json()) as any
  check('(5) if the animation record cannot be written the ORDER still goes through — without a link', soft.status === 200 && softJ.animation_url === null && !carts[0].variables.input.lines[0].attributes.some((a: any) => a.key === 'ichirei_animation_url'))

  const memBody = orderBody('ja')
  ;(memBody.engine_result as any).occasion = 'memorial'
  inputs.length = 0
  const mem = await post(handler(), memBody)
  const memJ = (await mem.json()) as any
  const memRec = (await store.get(memJ.animation_url.split('/').pop())) as AnimationRecord
  check('(5) a remembrance order makes a remembrance film, and the film step is told so', mem.status === 200 && memRec.memorial === true && inputs[0]?.memorial === true)
  check('(5) the film wait is short by default (8 s) and can be changed or set to 0 in the environment', filmWaitMs({} as never) === 8000 && filmWaitMs({ ICHIREI_FILM_WAIT_MS: '2500' } as never) === 2500 && filmWaitMs({ ICHIREI_FILM_WAIT_MS: '0' } as never) === 0 && filmWaitMs({ ICHIREI_FILM_WAIT_MS: 'x' } as never) === 8000)
}

// ---- 6. where the model is (and is not) called ------------------------------------------------------------------------------------------------------------
{
  const modelFree = ['engine/animation.ts', 'src/animation/AnimationApp.tsx', 'src/animation/film.ts', 'src/animation/copy.ts', 'src/animation/CreditsApp.tsx']
  const api = read('api/animation.ts')
  check('(6) playing a film makes no model call: the page, its timeline and the view code import no model SDK and call no model route (the page only asks /api/animation and /api/film/<id>/render); api/animation.ts holds the SDK as a TYPE only — the image model and the picture check run only inside the render route, once per film', !modelFree.some((f) => /anthropic|\/api\/(select|explain|poem)|messages\.(stream|create)|\bmakeFilm\b/i.test(read(f))) && /import type Anthropic/.test(api) && !/import Anthropic/.test(api) && /\/api\/film\/\$\{id\}\/render/.test(read('src/animation/AnimationApp.tsx')))
  const page = read('src/animation/AnimationApp.tsx')
  check('(6) the page never plays a film that is not ready: no film → "preparing" screen that asks again every few seconds', page.includes('animation-preparing') && /setTimeout|setInterval/.test(page) && page.includes('data-testid="animation-preparing"'))
}

// ---- 7. the server: the page, the headers, the routes, the pictures ---------------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-anim-'))
  writeFileSync(join(dir, `${ID}.json`), JSON.stringify({ ...rec, film: READY }))
  const server = await startServer({ upstreamUrl: 'http://127.0.0.1:9', env: { ORDER_STORE_DIR: dir, ICHIREI_ANIMATION_LIMIT: '8/10' } })
  try {
    const view = await fetch(`${server.url}/api/animation/${ID}`)
    const page = await fetch(`${server.url}/a/${ID}`)
    const credits = await fetch(`${server.url}/credits`)
    const robots = await (await fetch(`${server.url}/robots.txt`)).text()
    check('(7) the real server: /api/animation/<id> answers with the view and the film; /a/<id> serves the app, marked noindex; /credits serves it too; robots.txt keeps /a/ out of search', view.status === 200 && ((await view.json()) as any).film.lines.length === 4 && page.status === 200 && (await page.text()).includes('<div id="root">') && page.headers.get('x-robots-tag') === 'noindex, nofollow' && credits.status === 200 && /Disallow: \/a\//.test(robots))
    const qr = await fetch(`${server.url}/api/animation/${ID}/qr.svg`)
    const strokes = await fetch(`${server.url}/api/strokes?c=${encodeURIComponent('備')}&script=ja`)
    check('(7) …the QR code is served; the stroke-data route of the first version is gone (the film no longer draws strokes)', qr.status === 200 && (await qr.text()).includes('<svg') && strokes.status !== 200)
    const washi = await fetch(`${server.url}/film/washi-1.webp`)
    const gone = await fetch(`${server.url}/film/scenes/S-12.webp`)
    check('(7) the two washi fallback pictures are static files (/film/washi-1.webp, washi-2.webp); the 40-picture library is gone', washi.status === 200 && (washi.headers.get('content-type') ?? '').includes('image/webp') && (await washi.arrayBuffer()).byteLength > 1000 && !(gone.headers.get('content-type') ?? '').includes('image/webp'))
    const codes: number[] = []
    for (let i = 0; i < 10; i++) codes.push((await fetch(`${server.url}/api/animation/AN-aaaaaaaaaaaaaaaaaaaa`)).status)
    check('(7) scraping is slowed: the per-IP limit (here 8 per 10 minutes, default 120) answers 429 with Retry-After', codes.includes(429) && codes.indexOf(429) > 0, codes.join())
    const rl = await fetch(`${server.url}/api/animation/AN-aaaaaaaaaaaaaaaaaaaa`)
    check('(7) …429 carries Retry-After and the standard body', rl.status === 429 && rl.headers.get('retry-after') !== null && ((await rl.json()) as any).code === 'rate_limited')
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-anim-samples-'))
  const sampled = await startServer({ upstreamUrl: 'http://127.0.0.1:9', env: { ORDER_STORE_DIR: dir, ICHIREI_ANIMATION_SAMPLES: 'on' } })
  const plain = await startServer({ upstreamUrl: 'http://127.0.0.1:9', env: { ORDER_STORE_DIR: dir } })
  try {
    const a = await fetch(`${sampled.url}/api/animation/${SAMPLE_IDS.ja}`)
    const b = await fetch(`${plain.url}/api/animation/${SAMPLE_IDS.ja}`)
    const page = await fetch(`${sampled.url}/a/${SAMPLE_IDS.memorial}`)
    check('(7b) the real server: with ICHIREI_ANIMATION_SAMPLES=on the sample film answers 200 and its page is served; without it the same id is a 404', a.status === 200 && ((await a.json()) as any).film.lines.length === 4 && page.status === 200 && b.status === 404)
  } finally {
    await sampled.stop()
    await plain.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 7c. the real server: the first open draws the pictures (fake image model + fake picture check), then every open plays at once -------------------------------
{
  const PNG = await sharp({ create: { width: 320, height: 400, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
  const vertexSeen: { url: string; auth: string }[] = []
  const vertex = http.createServer(async (req, res) => {
    for await (const _c of req) void _c
    vertexSeen.push({ url: req.url ?? '', auth: String(req.headers.authorization ?? '') })
    await sleep(20)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }))
  })
  const visionSeen: number[] = []
  const claude = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = JSON.parse(raw)
    const n = body.messages[0].content.filter((b: any) => b.type === 'image').length
    visionSeen.push(n)
    const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify({ pictures: Array.from({ length: n }, () => ({ ok: true, reason: 'ok' })) }) } })
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  })
  await new Promise<void>((r) => vertex.listen(0, '127.0.0.1', r))
  await new Promise<void>((r) => claude.listen(0, '127.0.0.1', r))
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-art-'))
  const server = await startServer({
    upstreamUrl: `http://127.0.0.1:${(claude.address() as { port: number }).port}`,
    env: { ORDER_STORE_DIR: dir, ICHIREI_ANIMATION_SAMPLES: 'on', ICHIREI_ANIMATION_LIMIT: 'off', ICHIREI_FILM_IMAGE_BASE: `http://127.0.0.1:${(vertex.address() as { port: number }).port}`, ICHIREI_FILM_IMAGE_TOKEN: 'tok-server', ICHIREI_FILM_IMAGE_PROJECT: 'proj-server', ICHIREI_FILM_DAILY_MAX: '50' },
  })
  try {
    const sid = SAMPLE_IDS.ja
    const v0 = (await (await fetch(`${server.url}/api/animation/${sid}`)).json()) as any
    const t0 = Date.now()
    const r1 = await fetch(`${server.url}/api/film/${sid}/render`, { method: 'POST' })
    const j1 = (await r1.json()) as any
    const took = Date.now() - t0
    const pic = await fetch(`${server.url}${j1.view.film.pictures[0]}`)
    const meta = await sharp(Buffer.from(await pic.arrayBuffer())).metadata()
    const r2 = await fetch(`${server.url}/api/film/${sid}/render`, { method: 'POST' })
    const j2 = (await r2.json()) as any
    const v1 = (await (await fetch(`${server.url}/api/animation/${sid}`)).json()) as any
    check('(7c) the real server, the first open of a sample: the view has no pictures yet; POST /api/film/<id>/render stays open until the four are drawn (four image-model calls with the token, one picture check over all four), then the view has four pictures served from the private store', v0.film.pictures === null && r1.status === 200 && j1.state === 'ready' && j1.view.film.pictures.length === 4 && vertexSeen.length === 4 && vertexSeen.every((v) => v.auth === 'Bearer tok-server' && v.url.includes('/projects/proj-server/')) && visionSeen.join() === '4' && pic.status === 200 && meta.width === 1080 && meta.height === 1350, `${took} ms ${JSON.stringify([vertexSeen.length, visionSeen])}`)
    check('(7c) …every later open plays at once: the second render and the plain view make no new image or check call and give the same four pictures', j2.state === 'ready' && vertexSeen.length === 4 && visionSeen.length === 1 && v1.film.pictures.join() === j1.view.film.pictures.join())
    const bad = await fetch(`${server.url}/api/film/AN-aaaaaaaaaaaaaaaaaaaa/render`, { method: 'POST' })
    const get = await fetch(`${server.url}/api/film/${sid}/render`)
    check('(7c) an unknown id → 404; the render route is POST only', bad.status === 404 && get.status !== 200)
  } finally {
    await server.stop()
    vertex.close()
    claude.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 8. the pages' copy, the credits, the packaging ------------------------------------------------------------------------------------------------------
{
  check('(8) the page speaks ja, zh-Hant and en (a zh-Hans order reads the Traditional wording); every line is filled', (['ja', 'zh-Hant', 'en'] as const).every((l) => Object.values(COPY[l]).every((v) => (Array.isArray(v) ? v.length > 0 : String(v).length > 0))) && pageLang('zh-Hans') === 'zh-Hant' && pageLang('en') === 'en' && pageLang('ja') === 'ja')
  const words = (['ja', 'zh-Hant', 'en'] as const).flatMap((l) => Object.values(COPY[l]).flat().map(String)).join('\n')
  check('(8) the word "AI" is never shown to the customer: not in the page copy, the credits page or the player', !/\bAI\b|人工知能|人工智慧|artificial intelligence/i.test(words) && !/\bAI\b|人工知能|人工智慧|artificial intelligence/i.test(read('src/animation/CreditsApp.tsx')) && !/>[^<]*\bAI\b[^<]*</.test(read('src/animation/AnimationApp.tsx')))
  check('(8) the preparing screen is quiet and in all three languages', (['ja', 'zh-Hant', 'en'] as const).every((l) => COPY[l].preparing.length > 3) && COPY.ja.preparing.includes('映像を準備しています'))
  const credits = read('src/animation/CreditsApp.tsx')
  check('(8) the credits page no longer lists KanjiVG or Make Me a Hanzi (nothing is drawn stroke by stroke any more) and still carries the typefaces (SIL OFL)', !/KanjiVG|Make Me a Hanzi|Arphic|Ulrich Apel/.test(credits) && ['Zen Old Mincho', 'Noto Serif TC', 'Cormorant', 'SIL Open Font License'].every((n) => credits.includes(n)))
  const app = read('src/animation/AnimationApp.tsx')
  check('(8) the film links to the credits page, and /a/<id> and /credits are routed', app.includes('/credits') && /startsWith\('\/a\/'\)/.test(read('src/Routes.tsx')) && read('src/Routes.tsx').includes("'/credits'"))
  check('(8) prefers-reduced-motion gets a still page of the four scenes and the character (with a button to play it anyway); the film pauses while the tab is hidden; the character keeps translate="no"', app.includes('prefers-reduced-motion: reduce') && app.includes('film-still') && app.includes('animation-reduced') && app.includes('visibilitychange') && /translate="no"/.test(app))
  const pkg = JSON.parse(read('package.json'))
  check('(8) the stroke-data packages are gone from the dependencies (KanjiVG, Make Me a Hanzi); qrcode stays', !pkg.dependencies['@madcat/kanjivg'] && !pkg.dependencies['hanzi-writer-data'] && !!pkg.dependencies.qrcode && !existsSync(new URL('../engine/stroke-data.ts', import.meta.url)))
  check('(8) the image no longer prunes KanjiVG; the washi fallback ships with the build (public/ → dist/); sharp (WebP for the pictures) is a runtime dependency', !read('Dockerfile').includes('kanjivg') && existsSync(new URL('../public/film/washi-2.webp', import.meta.url)) && !!pkg.dependencies.sharp && !pkg.devDependencies?.sharp)
}

console.log(failures === 0 ? '\nAll animation checks passed.' : `\n${failures} animation check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
