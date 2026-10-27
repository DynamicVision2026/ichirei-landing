// The story animation (/a/<id>): the data it is built from, the timeline, the text fitting, the API, the order wiring and the server routes.
// The picture itself is checked in a real browser by scripts/test-animation-browser.mjs.
//
//   node --experimental-strip-types scripts/test-animation.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ANIMATION_ID_PATTERN, SAMPLE_IDS, SAMPLE_RECORDS, animationSamplesOn, animationUrl, animationView, buildAnimationRecord, isAnimationRecord, newAnimationId, publicUrl, splitAids, type AnimationRecord } from '../engine/animation.ts'
import { createAnimationHandlers, strokesGet } from '../api/animation.ts'
import { createOrderHandler } from '../api/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { loadPalette } from '../engine/palette.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { isOneIdeograph, parseHanzi, parseKanjivg, strokesFor } from '../engine/stroke-data.ts'
import { FRAME_H, FRAME_W, POEM_BOX, emWidth, fitFont, momentSize, poemSizes, wrapCount, whoSize } from '../src/animation/layout.ts'
import { COPY, pageLang } from '../src/animation/copy.ts'
import { FILM_SECONDS, MEMORIAL_SLOWDOWN, makeTimeline, timelineProblems } from '../src/animation/timeline.ts'
// @ts-expect-error untyped .mjs
import { startServer } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const palette = loadPalette()

// ---- 1. the id, the record, the view ------------------------------------------------------------------------------------------------------------------
{
  const ids = new Set(Array.from({ length: 500 }, () => newAnimationId()))
  check('(1) ids: AN- + 20 characters from a 32-symbol alphabet (100 bits), unique, and they fit the order store\'s key rule', ids.size === 500 && [...ids].every((i) => ANIMATION_ID_PATTERN.test(i) && /^[A-Za-z0-9-]{1,64}$/.test(i)))
  check('(1) …and nothing guessable is accepted: other prefixes, short ids, upper case, path tricks', !['AN-short', 'IC-20261023-ABCDEFGH', 'an-abcdefghjkmnpqrstuvw', 'AN-../../../etc/passwd', 'AN-ABCDEFGHJKMNPQRSTUVW', ''].some((i) => ANIMATION_ID_PATTERN.test(i)))
  check('(1) the public address: https://ichirei.soul-id.jp/a/<id> by default, ICHIREI_PUBLIC_URL overrides (a trailing slash is dropped)', animationUrl('AN-abcdefghjkmnpqrstuvw', {} as never) === 'https://ichirei.soul-id.jp/a/AN-abcdefghjkmnpqrstuvw' && publicUrl({ ICHIREI_PUBLIC_URL: 'https://x.example/' } as never) === 'https://x.example')
}

const GOLD = JSON.parse(read('scripts/golden-fixture.json'))
const orderBody = (language: string, more: Record<string, unknown> = {}, candidate: Record<string, unknown> = {}) => ({
  story: '母は毎朝お弁当を作ってくれた。何も言わずに台所に戻りました。',
  engine_result: { ...clone(GOLD), language, candidates: GOLD.candidates.map((c: any, i: number) => (i === 0 ? { ...c, kanji: '備', inscription_form: null, reading: 'そなえる', story_anchor: '何も言わずに台所に戻りました', one_line_gaze: '毎朝、お弁当に庭の花をのせて、黙って備えてくれた人。', ...candidate } : c)), primary_kanji: '備' },
  selected_kanji: '備', language, sender_name: '山田 太郎', receiver_name: '山田 花子', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'standard', ...more,
})
const NOW = new Date('2026-10-28T03:00:00Z')
const parsed = parseOrderRequest(orderBody('ja'), NOW, palette)
if (!parsed.ok) throw new Error('fixture order does not parse: ' + parsed.error)
parsed.order.certificate.poems = [{ type: 'tang', lines: ['晨起折庭花', '盒中春色華', '廿載備朝飯', '不言惟在家'], reading: '晨に起きて庭の花を折り\n盒の中 春の色華やぐ\n廿載 朝の飯を備ふ\n言はず ただ家に在り\n\n毎朝早く起きて庭の花を折り、弁当箱に春の彩りを添えてくれた。' }]
const orderRec = buildRecord(parsed.order, 'IC-20261028-ABCDEFGH', NOW, [])
const ID = 'AN-abcdefghjkmnpqrstuvw'
const rec = buildAnimationRecord(orderRec, ID, NOW)
{
  check('(1) the record is built from what the engine already produced: the carved form, "your moment" (the anchor), "who they are" (the gaze line), the reading, the memorial flag, the first poem', rec.glyph === '備' && rec.moment === '何も言わずに台所に戻りました' && rec.who.startsWith('毎朝、お弁当') && rec.reading.length > 0 && rec.memorial === false && rec.poem?.type === 'tang' && rec.poem.lines.length === 4 && rec.script === 'ja' && rec.language === 'ja' && isAnimationRecord(rec))
  const text = JSON.stringify(rec)
  check('(1) …and nothing else of the order: no names, no story, no delivery date, no package, no engine result', !['山田', '台所に戻りました。', '2026-12-01', 'standard', 'candidates', 'sender_name', 'engine_result'].some((x) => text.includes(x) && x !== '何も言わずに台所に戻りました') )
  const v = animationView(rec)
  check('(1) the view the page gets drops the order_ref and the dates; the poem comes with its per-line aids and its notes', !('order_ref' in v) && !('created_at' in v) && v.poem?.lineAids.length === 4 && v.poem.lineAids[0] === '晨に起きて庭の花を折り' && v.poem.notes.length === 1 && v.poem.notes[0].startsWith('毎朝早く'))
  check('(1) splitAids: a first block with one entry per line is shown under the lines, the rest are notes; any other shape is notes only; no reading = nothing', JSON.stringify(splitAids(['a', 'b'], 'x\ny\n\nnote')) === JSON.stringify({ lineAids: ['x', 'y'], notes: ['note'] }) && JSON.stringify(splitAids(['a', 'b', 'c'], 'x\ny')) === JSON.stringify({ lineAids: [null, null, null], notes: ['x\ny'] }) && JSON.stringify(splitAids(['a'], '')) === JSON.stringify({ lineAids: [null], notes: [] }))
  const zh = buildAnimationRecord(buildRecord(parseOrderRequest(orderBody('zh-Hant', { inscription_style: 'traditional' }), NOW, palette).ok ? (parseOrderRequest(orderBody('zh-Hant', { inscription_style: 'traditional' }), NOW, palette) as any).order : parsed.order, 'IC-20261028-ZZZZZZZZ', NOW, []), 'AN-zzzzzzzzzzzzzzzzzzzz', NOW)
  check('(1) a Chinese order draws with the Chinese stroke data; an English one with the Japanese form', zh.script === 'zh' && buildAnimationRecord({ ...orderRec, production: { ...orderRec.production, language: 'en' } }, ID, NOW).script === 'ja')
  const memOrder = parseOrderRequest(orderBody('ja', { engine_result: { ...clone(orderBody('ja').engine_result), occasion: 'memorial' } }), NOW, palette)
  check('(1) the memorial flag follows the order\'s certificate (memorial occasion → true)', memOrder.ok && buildAnimationRecord(buildRecord(memOrder.order, 'IC-20261028-MEMMEMME', NOW, []), ID, NOW).memorial === true, memOrder.ok ? '' : memOrder.error)
  const noPoem = buildAnimationRecord({ ...orderRec, production: { ...orderRec.production, certificate: { ...orderRec.production.certificate, poems: [] } } }, ID, NOW)
  check('(1) an order with no poem has poem: null', noPoem.poem === null && animationView(noPoem).poem === null)
}

// ---- 2. stroke data ------------------------------------------------------------------------------------------------------------------------------------
{
  const kvg = strokesFor('備', 'ja')
  const hz = strokesFor('燈', 'zh')
  check('(2) Japanese forms come from KanjiVG (備: 12 strokes, centre lines in a 109 box), Chinese forms from Make Me a Hanzi (燈: 16 strokes with outlines and medians in a 1024 box)', kvg?.source === 'kanjivg' && kvg.strokes.length === 12 && kvg.box === 109 && hz?.source === 'hanzi' && hz.strokes.length === 16 && hz.box === 1024 && hz.strokes.every((s) => 'median' in s && s.d.startsWith('M')))
  check('(2) either set is the other\'s second try (a character only one of them has still gets strokes); unknown characters have none', strokesFor('母', 'zh')?.strokes.length === 5 && strokesFor('母', 'ja')?.strokes.length === 5 && strokesFor('𠮟', 'ja') !== null && strokesFor('a' as never, 'ja') === null)
  check('(2) only one ideograph is looked up: nothing else can reach the file system', isOneIdeograph('備') && isOneIdeograph('𠮟') && !['', 'ab', '../a', '備備', 'a', '1', '/', null, 5].some((x) => isOneIdeograph(x as never)))
  let missing: string[] = []
  for (const r of palette.rows) for (const c of [r.kanji, r.inscription_form]) if (c && !strokesFor(c, r.language === 'ja' ? 'ja' : 'zh')) missing.push(`${r.language}:${c}`)
  check('(2) EVERY character and form in the palette (1,646 of them) has stroke data — the ink-fade fallback is only for freestyle characters outside it', missing.length === 0, missing.slice(0, 10).join(' '))
  check('(2) parsers: KanjiVG paths are read in stroke order whatever the file order; a file with no strokes, or a Hanzi entry whose strokes and medians disagree, is refused', parseKanjivg('<svg><path id="kvg:00001-s2" d="M1,1"/><path id="kvg:00001-s1" d="M0,0"/></svg>')?.strokes.map((s) => s.d).join('|') === 'M0,0|M1,1' && parseKanjivg('<svg></svg>') === null && parseHanzi({ strokes: ['M0 0'], medians: [] }) === null && (parseHanzi({ strokes: ['M0 0'], medians: [[[0, 0], [1, 1]]] })?.strokes[0] as { median?: string } | undefined)?.median === 'M0 0 L1 1')
}

// ---- 3. the timeline ------------------------------------------------------------------------------------------------------------------------------------
{
  const strokes = [40, 60, 20, 30, 50]
  const t = makeTimeline({ memorial: false, poemLines: 4, poemNotes: true, strokeLengths: strokes })
  check('(3) the film is 30 seconds and holds still after that', t.total === FILM_SECONDS && FILM_SECONDS === 30)
  check('(3) 0–5 s: the story moment fades in and is gone before the character starts', t.moment.in.start >= 0 && t.moment.out.end <= 5 && t.glyph.strokes[0].start >= 5)
  check('(3) 5–15 s: all strokes are written inside this window, in order, longer strokes taking longer', t.glyph.strokes.every((s) => s.start >= 5 && s.end <= 15) && t.glyph.strokes.length === 5 && timelineProblems(t).length === 0 && t.glyph.strokes[1].end - t.glyph.strokes[1].start > t.glyph.strokes[2].end - t.glyph.strokes[2].start)
  check('(3) 15–25 s: the poem appears line by line inside this window, after the character has moved aside, notes last', t.poemLines.length === 4 && t.poemLines.every((s) => s.start >= 15 && s.end <= 25) && t.glyphMove!.end <= t.poemLines[0].start && t.poemNotes!.start >= t.poemLines[3].end - 0.01 && t.poemNotes!.end <= 25)
  check('(3) 25–30 s: the "who they are" line, then the seal, both inside the last five seconds', t.who.start >= 25 && t.seal.start >= t.who.start && t.seal.end <= 30)
  const mem = makeTimeline({ memorial: true, poemLines: 5, strokeLengths: strokes })
  check('(3) memorial: the same film, slower by a quarter (37.5 s), in order, nothing outside it', mem.total === FILM_SECONDS * MEMORIAL_SLOWDOWN && MEMORIAL_SLOWDOWN === 1.25 && mem.memorial && timelineProblems(mem).length === 0 && mem.who.start === t.who.start * 1.25)
  const none = makeTimeline({ memorial: false, poemLines: 0, strokeLengths: null })
  check('(3) no poem: the character keeps its place and its reading fades in; no stroke data: the character fades in as ink over the same 10 seconds', none.glyphMove === null && none.reading !== null && none.poemLines.length === 0 && none.glyph.strokes.length === 0 && none.glyph.write.start >= 5 && none.glyph.write.end <= 15 && timelineProblems(none).length === 0)
  const problems: string[] = []
  for (const n of [1, 2, 5, 12, 16, 23, 30]) for (const poem of [0, 1, 4, 5, 8]) for (const memorial of [false, true]) {
    const tl = makeTimeline({ memorial, poemLines: poem, poemNotes: poem > 0, strokeLengths: Array.from({ length: n }, (_, i) => 1 + ((i * 37) % 90)) })
    problems.push(...timelineProblems(tl).map((p) => `${n} strokes/${poem} lines/${memorial}: ${p}`))
  }
  check('(3) for every stroke count (1–30), poem length (none, 1, 4, 5, 8) and memorial or not: spans in order, inside the film, no overlap', problems.length === 0, problems.slice(0, 3).join(' | '))
  check('(3) the guard catches a broken timeline (a stroke that starts before the moment is gone, a poem before the character has moved)', timelineProblems({ ...t, glyph: { ...t.glyph, strokes: [{ start: 3, end: 4 }] } }).length > 0 && timelineProblems({ ...t, poemLines: [{ start: 15.2, end: 16 }] }).length > 0)
}

// ---- 4. text fitting ------------------------------------------------------------------------------------------------------------------------------------
{
  check('(4) widths: a CJK character is one em, a Latin letter about half; wrapping counts lines', emWidth('母の背') === 3 && emWidth('abcd') > 1.9 && emWidth('abcd') < 2.3 && wrapCount('あ'.repeat(30), 4, 40) === 3 && wrapCount('', 4, 40) === 0)
  const big = poemSizes(['晨起折庭花', '盒中春色華', '廿載備朝飯', '不言惟在家'], ['晨に起きて庭の花を折り', '盒の中 春の色華やぐ', '廿載 朝の飯を備ふ', '言はず ただ家に在り'], ['毎朝早く起きて庭の花を折り、弁当箱に春の彩りを添えてくれた。二十年、朝のご飯を用意し続けて、何も言わず、ただ家にいてくれた。'])
  check('(4) a four-line 漢詩 with its 書き下し and 現代語訳 gets a large size that fits the poem box', big.fs >= 4.6 && big.fs <= 5.8 && big.aid < big.fs)
  const lines8 = Array.from({ length: 8 }, () => '一朝謝語欲啟口')
  const hardest = poemSizes(lines8, lines8.map(() => 'いっちょうしゃごくちをひらかんとほっす'), ['これは三行ほどになる長い現代語訳です。'.repeat(3), 'An English rendering that runs a good deal longer than one short line would. '.repeat(2)])
  const used = (fs: number, aid: number) => lines8.length * (fs * 1.45 + 0.08 * fs + aid * 1.45 + 0.5 * fs)
  check('(4) the worst case (eight lines, an aid under each, two long notes) shrinks to a smaller but readable size; it never goes below the minimum, and the shortest poem is never smaller than the longest', hardest.fs >= 3.2 && hardest.fs < big.fs && poemSizes(['a'], [null], []).fs >= hardest.fs && used(hardest.fs, hardest.aid) < POEM_BOX.height + 40)
  const f = fitFont([{ text: 'あ'.repeat(200), size: 1, gap: 0 }], 80, 40, 3.6, 5.8)
  check('(4) fitFont: never outside [min, max]; a short moment line is large, a very long one small', f === 3.6 && momentSize('黙って') === 5.8 && momentSize('何も言わずに台所に戻りました') >= 4.6 && whoSize('背中で語る人。') >= 4.4 && whoSize('毎朝、お弁当に庭の花をのせて、黙って備えてくれた人。'.repeat(2)) < 4.4)
  check('(4) the frame is 9:16', Math.abs(FRAME_H / FRAME_W - 16 / 9) < 0.01)
}

// ---- 5. the API -----------------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  await store.put(ID, rec)
  await store.put('IC-20261028-ABCDEFGH', orderRec)
  const h = createAnimationHandlers(() => ({ store, env: {} as never }))
  const ok = await h.view(ID)
  const okJ = (await ok.json()) as any
  check('(5) GET /api/animation/<id>: 200 with the view, never cached by anyone but the browser, never indexed', ok.status === 200 && okJ.glyph === '備' && okJ.poem.lines.length === 4 && !('order_ref' in okJ) && ok.headers.get('cache-control') === 'private, no-store' && ok.headers.get('x-robots-tag') === 'noindex, nofollow')
  const missing = await h.view('AN-aaaaaaaaaaaaaaaaaaaa')
  const bad = await h.view('IC-20261028-ABCDEFGH')
  const trick = await h.view('../orders')
  check('(5) an unknown id, an order_ref, a path trick → the same 404 (an order record is never served through this route)', missing.status === 404 && bad.status === 404 && trick.status === 404 && ((await bad.json()) as any).error === 'not_found')
  const down = await createAnimationHandlers(() => ({ store: null })).view(ID)
  const flaky = await createAnimationHandlers(() => ({ store: { kind: 'memory', get: async () => { throw new Error('boom') }, put: async () => {}, appendJsonl: async () => {} } as never })).view(ID)
  check('(5) no store, or a store that fails → 503 (never a 404 that would look like a wrong link)', down.status === 503 && flaky.status === 503)
  const qr = await h.qr(ID)
  const svg = await qr.text()
  check('(5) GET /api/animation/<id>/qr.svg: an SVG QR code of the page address (for the printed card); unknown id → 404', qr.status === 200 && qr.headers.get('content-type')?.startsWith('image/svg+xml') === true && svg.includes('<svg') && svg.includes('path') && (await h.qr('AN-aaaaaaaaaaaaaaaaaaaa')).status === 404)
  const s1 = strokesGet(new URL('http://x/api/strokes?c=%E5%82%99&script=ja'))
  const s2 = strokesGet(new URL('http://x/api/strokes?c=%E7%87%88&script=zh'))
  const s3 = strokesGet(new URL('http://x/api/strokes?c=%E5%82%99%E5%82%99&script=ja'))
  const s4 = strokesGet(new URL('http://x/api/strokes?c=a'))
  const s5 = strokesGet(new URL('http://x/api/strokes?c=%F0%AA%9C%80&script=ja'))
  check('(5) GET /api/strokes: 200 with the strokes (cached for a year: open data that never changes); two characters or a Latin letter → 400; a character with no data → 404', s1.status === 200 && ((await s1.json()) as any).strokes.length === 12 && s1.headers.get('cache-control')?.includes('immutable') === true && s2.status === 200 && ((await s2.json()) as any).source === 'hanzi' && s3.status === 400 && s4.status === 400 && s5.status === 404)
}

// ---- 5b. the sample films (for the owner's phone tests) -----------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const off = createAnimationHandlers(() => ({ store, env: {} as never }))
  const on = createAnimationHandlers(() => ({ store, env: { ICHIREI_ANIMATION_SAMPLES: 'on' } as never }))
  check('(5b) the four sample ids are valid ids (AN- + 20 characters) and each has a valid record: Japanese tanka, Chinese ci, English poem, memorial', Object.values(SAMPLE_IDS).length === 4 && Object.values(SAMPLE_IDS).every((i) => ANIMATION_ID_PATTERN.test(i) && isAnimationRecord(SAMPLE_RECORDS[i])) && SAMPLE_RECORDS[SAMPLE_IDS.memorial].memorial === true && SAMPLE_RECORDS[SAMPLE_IDS.zh].script === 'zh' && SAMPLE_RECORDS[SAMPLE_IDS.en].poem?.type === 'en' && SAMPLE_RECORDS[SAMPLE_IDS.ja].poem?.type === 'tanka')
  check('(5b) off by default (and for anything but "on"): a sample id is a plain 404; on: it plays without any order behind it', !animationSamplesOn({} as never) && !animationSamplesOn({ ICHIREI_ANIMATION_SAMPLES: 'off' } as never) && animationSamplesOn({ ICHIREI_ANIMATION_SAMPLES: 'on' } as never) && (await off.view(SAMPLE_IDS.ja)).status === 404 && (await on.view(SAMPLE_IDS.ja)).status === 200)
  const v = (await (await on.view(SAMPLE_IDS.ja)).json()) as any
  check('(5b) the sample view is the same shape as a real one (glyph, moment, who, the poem with its lines) and holds no order data', v.glyph === '備' && v.poem.lines.length === 5 && !('order_ref' in v) && (await on.qr(SAMPLE_IDS.ja)).status === 200 && (await on.view('AN-sample' + 'x'.repeat(11))).status === 404)
}

// ---- 6. the order wiring --------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const carts: any[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    carts.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/1', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })
  }) as unknown as typeof fetch
  const shopify = loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN_PUBLIC: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2' } as never).config!
  const handler = (s: any = store, env: any = {}) => createOrderHandler(() => ({ store: s, shopify, shopifyMissing: [], now: () => NOW, fetchImpl, env }))
  const post = (h: (r: Request) => Promise<Response>, body: unknown) => h(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(body) }))
  const res = await post(handler(), orderBody('ja'))
  const j = (await res.json()) as any
  const attrs = carts[0].variables.input.lines[0].attributes as { key: string; value: string }[]
  const link = attrs.find((a) => a.key === 'ichirei_animation_url')?.value ?? ''
  const id = link.split('/').pop() ?? ''
  check('(6) an order makes its animation: the response and the Shopify line item carry the private address (ichirei_animation_url), https://ichirei.soul-id.jp/a/AN-…', res.status === 200 && j.animation_url === link && /^https:\/\/ichirei\.soul-id\.jp\/a\/AN-[a-z2-9]{20}$/.test(link))
  const stored = (await store.get(id)) as AnimationRecord
  const order = (await store.get(j.order_ref)) as any
  check('(6) …the animation record is stored under that id (built from the order: glyph, moment, who) and the order record points to it', isAnimationRecord(stored) && stored.glyph === '備' && stored.order_ref === j.order_ref && order.animation_id === id)
  check('(6) …and the cart sees only the link: no story, no moment line in the animation attribute', !JSON.stringify(carts[0]).includes('台所に戻りました') && attrs.at(-1)?.key === 'ichirei_animation_url')
  const pub = await post(handler(store, { ICHIREI_PUBLIC_URL: 'https://example.test' }), orderBody('ja'))
  check('(6) ICHIREI_PUBLIC_URL sets the address in the link', ((await pub.json()) as any).animation_url.startsWith('https://example.test/a/AN-'))
  // the animation record may fail without stopping the order
  const failing: any = { kind: 'memory', put: async (ref: string, r: object) => { if (ref.startsWith('AN-')) throw new Error('animation store down'); await store.put(ref, r) }, get: async (ref: string) => store.get(ref), appendJsonl: async () => {} }
  const quiet = console.error
  console.error = () => {}
  carts.length = 0
  const soft = await post(handler(failing), orderBody('ja'))
  console.error = quiet
  const softJ = (await soft.json()) as any
  check('(6) if the animation record cannot be written the ORDER still goes through — without a link', soft.status === 200 && softJ.animation_url === null && !carts[0].variables.input.lines[0].attributes.some((a: any) => a.key === 'ichirei_animation_url'))
  const memBody = orderBody('ja')
  ;(memBody.engine_result as any).occasion = 'memorial'
  const mem = await post(handler(), memBody)
  const memJ = (await mem.json()) as any
  const memRec = (await store.get(memJ.animation_url.split('/').pop())) as AnimationRecord
  check('(6) a memorial order makes a memorial animation', mem.status === 200 && memRec.memorial === true)
  const stock = read('api/order.ts')
  check('(6) no model call anywhere in the animation: nothing in api/animation.ts, engine/animation.ts, engine/stroke-data.ts or src/animation imports the Anthropic SDK or calls a model route', ![ 'api/animation.ts', 'engine/animation.ts', 'engine/stroke-data.ts', 'src/animation/AnimationApp.tsx', 'src/animation/timeline.ts', 'src/animation/layout.ts' ].some((f) => /anthropic|\/api\/(select|explain|poem)|messages\.(stream|create)/i.test(read(f))) && stock.includes('buildAnimationRecord'))
}

// ---- 7. the server: the page, the headers, the routes ---------------------------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-anim-'))
  writeFileSync(join(dir, `${ID}.json`), JSON.stringify(rec))
  const server = await startServer({ upstreamUrl: 'http://127.0.0.1:9', env: { ORDER_STORE_DIR: dir, ICHIREI_ANIMATION_LIMIT: '8/10' } })
  try {
    const view = await fetch(`${server.url}/api/animation/${ID}`)
    const page = await fetch(`${server.url}/a/${ID}`)
    const credits = await fetch(`${server.url}/credits`)
    const robots = await (await fetch(`${server.url}/robots.txt`)).text()
    check('(7) the real server: /api/animation/<id> answers with the view; /a/<id> serves the app, marked noindex; /credits serves it too; robots.txt keeps /a/ out of search', view.status === 200 && ((await view.json()) as any).glyph === '備' && page.status === 200 && (await page.text()).includes('<div id="root">') && page.headers.get('x-robots-tag') === 'noindex, nofollow' && credits.status === 200 && /Disallow: \/a\//.test(robots))
    const qr = await fetch(`${server.url}/api/animation/${ID}/qr.svg`)
    const st = await fetch(`${server.url}/api/strokes?c=${encodeURIComponent('備')}&script=ja`)
    check('(7) …the QR code and the stroke data are served', qr.status === 200 && (await qr.text()).includes('<svg') && st.status === 200 && ((await st.json()) as any).strokes.length === 12)
    const codes: number[] = []
    for (let i = 0; i < 6; i++) codes.push((await fetch(`${server.url}/api/animation/AN-aaaaaaaaaaaaaaaaaaaa`)).status)
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
    check('(7b) the real server: with ICHIREI_ANIMATION_SAMPLES=on the sample film answers 200 and its page is served; without it the same id is a 404', a.status === 200 && ((await a.json()) as any).poem.type === 'tanka' && page.status === 200 && b.status === 404)
  } finally {
    await sampled.stop()
    await plain.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 8. the pages' copy, the credits, the packaging ------------------------------------------------------------------------------------------------------
{
  check('(8) the page speaks ja, zh-Hant and en (a zh-Hans order reads the Traditional wording); every line is filled', (['ja', 'zh-Hant', 'en'] as const).every((l) => Object.values(COPY[l]).every((v) => (Array.isArray(v) ? v.length > 0 : String(v).length > 0))) && pageLang('zh-Hans') === 'zh-Hant' && pageLang('en') === 'en' && pageLang('ja') === 'ja')
  const credits = read('src/animation/CreditsApp.tsx')
  check('(8) the credits page carries the attributions the licences require: KanjiVG (CC BY-SA 3.0, Ulrich Apel), Make Me a Hanzi (Arphic Public License, Arphic Technology), and the three typefaces (SIL OFL)', ['KanjiVG', 'Ulrich Apel', 'CC BY-SA 3.0', 'Make Me a Hanzi', 'Arphic Public License', 'Arphic Technology', 'Zen Old Mincho', 'Noto Serif TC', 'Cormorant', 'SIL Open Font License'].every((n) => credits.includes(n)))
  check('(8) the film links to the credits page, and /a/<id> and /credits are routed', read('src/animation/AnimationApp.tsx').includes('href="/credits"') && /startsWith\('\/a\/'\)/.test(read('src/Routes.tsx')) && read('src/Routes.tsx').includes("'/credits'"))
  const app = read('src/animation/AnimationApp.tsx')
  check('(8) prefers-reduced-motion gets the finished frame as a still (with a button to play it anyway); the film pauses while the tab is hidden', app.includes('prefers-reduced-motion: reduce') && app.includes('an-still') && app.includes('playAnyway') && app.includes('visibilitychange'))
  const pkg = JSON.parse(read('package.json'))
  check('(8) the data packages are runtime dependencies (the image installs without dev dependencies)', ['@madcat/kanjivg', 'hanzi-writer-data', 'qrcode'].every((d) => pkg.dependencies[d]))
  const docker = read('Dockerfile')
  check('(8) the image drops KanjiVG\'s variations and duplicate JSON (about 65 MB) and keeps the SVGs and the licences', docker.includes('rm -rf node_modules/@madcat/kanjivg/dist/variations') && docker.includes("find node_modules/@madcat/kanjivg/dist/main -name '*.json' -delete") && !docker.includes('.svg -delete'))
}

console.log(failures === 0 ? '\nAll animation checks passed.' : `\n${failures} animation check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
