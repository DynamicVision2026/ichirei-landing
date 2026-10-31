// The free card preview before payment (2026-10-30, Part 1): the characters come first and the pictures only after the pick; one drawing per story;
// 「別の候補を見る」 leaves out every character already shown and stops after two retries; the daily picture limit; the shown characters kept on the order;
// the draft becoming the order's film. FAKE models: no key, no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-preview.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { POST as selectPost } from '../api/select.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { createPreviewHandlers, previewDailyMax } from '../api/preview.ts'
import { PREVIEW_EVENTS, parseClientEvent } from '../engine/analytics.ts'
import { MAX_EXCLUDED, MAX_RETRIES, parseExclude } from '../engine/contract.ts'
import { loadPrompt } from '../engine/engine.ts'
import type { ImageClient } from '../engine/film-art.ts'
import type { FilmInput, FilmRecord } from '../engine/film.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { SlidingWindowLimiter } from '../engine/rate-limit.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { DRAFT_REF, NOT_CHOSEN, startPreview, storyHash } from '../engine/preview.ts'
import { parseOrderRequest, parseShown } from '../engine/order.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-30T03:00:00Z')
const GOLDEN = JSON.parse(read('scripts/golden-fixture.json'))

// ---- 1. 「別の候補を見る」: the characters already shown are left out ---------------------------------------------------------------------------------------
check('(1) parseExclude: nothing = a first run; a list needs retry 1 or 2; a third retry, a stray value or a long list is refused', (() => {
  const ok0 = parseExclude(undefined, undefined)
  const ok1 = parseExclude(['備', '憶'], 1)
  return ok0.ok && ok0.retry === 0 && ok1.ok && ok1.exclude.join('') === '備憶' && ok1.retry === 1 &&
    !parseExclude(['備'], 3).ok && !parseExclude(['備'], undefined).ok && !parseExclude(['ab'], 1).ok && !parseExclude(['a'], 1).ok && !parseExclude([1], 1).ok &&
    !parseExclude(Array.from({ length: MAX_EXCLUDED + 1 }, () => '字'), 1).ok && MAX_RETRIES === 2 && !parseExclude(undefined, 1).ok
})())
for (const l of ['ja', 'en', 'zh-Hant'] as const) {
  const p = loadPrompt(l)
  check(`(1) prompt.${l}.md: the "already shown" slot, and the instruction never to choose them again, in any slot or form`, p.includes('{{ ALREADY SHOWN }}') && /Never choose any of those characters, in any slot, in any form/.test(p))
}

const FIX = JSON.parse(read('scripts/fixtures-v6/a-solemn-parent.json'))
const prompts: string[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const isReview = prompt.includes('Independent Review Prompt')
  if (!isReview) prompts.push(prompt)
  const text = JSON.stringify(isReview ? FIX.review_reply : FIX.model_reply)
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
const origLog = console.log
const select = async (extra: Record<string, unknown>) => {
  prompts.length = 0
  console.log = (...a: unknown[]) => { if (!String(a[0]).startsWith('[ichirei-')) origLog(...a) }
  try {
    const res = await selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story: FIX.story, language: 'ja', ...FIX.context, ...extra }) }))
    const text = await res.text()
    const last = text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).at(-1)
    return { status: res.status, prompt: prompts[0] ?? '', result: last?.type === 'result' ? last.result : last }
  } finally { console.log = origLog }
}
const first = await select({})
const mainKanji = first.result.primary_kanji as string
const shownKanji = (first.result.candidates as { kanji: string; eliminated: boolean }[]).filter((c) => !c.eliminated).map((c) => c.kanji)
check('(1) a first run names nobody as already shown', first.status === 200 && !first.prompt.includes('ALREADY SHOWN FOR THIS STORY:') && shownKanji.includes(mainKanji))
const retry = await select({ exclude: shownKanji, retry: 1 })
check('(1) 「別の候補を見る」: the prompt lists the characters already shown for this story, on one line before the story', retry.status === 200 && retry.prompt.includes(`ALREADY SHOWN FOR THIS STORY: ${shownKanji.join(' ')}`))
const live = (retry.result.candidates as { kanji: string; eliminated: boolean; eliminated_reason?: string }[])
check('(1) …and the referee removes every one of them from every slot, whatever the model chose (the fake model offers the same ones again)', live.every((c) => !shownKanji.includes(c.kanji) || (c.eliminated && /already shown/.test(String(c.eliminated_reason)))))
check('(1) no new main is left (the fake model has nothing else), so the result is not a sufficient one that shows an excluded character', !shownKanji.includes(retry.result.primary_kanji) )
const bad = await select({ exclude: shownKanji, retry: 3 })
const noRetry = await select({ exclude: shownKanji })
check('(1) a third retry or a list without a retry number is refused (400), before any model call', bad.status === 400 && noRetry.status === 400 && bad.prompt === '' && noRetry.prompt === '')

// ---- 2. the shown characters are kept on the order -----------------------------------------------------------------------------------------------------------
{
  const cands = GOLDEN.candidates.filter((c: { eliminated: boolean }) => !c.eliminated)
  const mk = (kanji: string, set: number) => ({ set, candidate: { ...cands.find((c: { kanji: string }) => c.kanji === kanji) ?? cands[0], kanji } })
  const shown = parseShown([{ set: 1, candidate: cands[0] }, { set: 2, candidate: { ...cands[0], kanji: '憶', reading: 'おもい' } }, { set: 4, candidate: cands[0] }, { set: 1, candidate: { ...cands[0], eliminated: true, kanji: '黙' } }, { set: 1, candidate: { ...cands[0], kanji: '二字' } }, { set: 3, candidate: { ...cands[0], story_anchor: '' , kanji: '想' } }, mk('証', 1)])
  check('(2) parseShown keeps live, well-formed candidates with their set and slot; a bad set number, an eliminated card, a two-character "character" or a card with no anchor is left out; no character twice', shown.length === 2 && shown[0].set === 1 && shown[1].candidate.kanji === '憶' && shown[1].set === 2 && ['main', 'second', 'freestyle'].includes(shown[0].slot))
  const body = { story: FIX.story, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2027-01-15', inscription_style: 'modern', package: 'standard', shown_characters: [{ set: 2, candidate: { ...cands[0], kanji: '憶', reading: 'おもい' } }] }
  const p = parseOrderRequest(body, NOW)
  check('(2) the order carries every shown character with its slot and its lines — and always the chosen one', p.ok && p.order.shown.length === 2 && p.order.shown.some((s) => s.candidate.kanji === '証') && p.order.shown.some((s) => s.candidate.kanji === '憶' && s.set === 2 && s.candidate.one_line_gaze.length > 0))
}

// ---- 3. the draft: script first, pictures only on the pick, one set per story ------------------------------------------------------------------------------
const PNG = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
const FILM: FilmRecord = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [
  'A woman seen from behind standing at a quiet kitchen counter in soft morning light, a small bento box in front of her',
  'Two hands holding a closed modern lunch box over a wooden table, window light falling across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight, a single bag left',
  'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table in the afternoon' ], made_at: NOW.toISOString() }
const OKV = { ok: true, reason: 'ok' }
const vision = { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: [OKV] }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
const rig = () => {
  const store = new MemoryOrderStore()
  const filmInputs: FilmInput[] = []
  let drawn = 0
  const image: ImageClient = { async generate() { drawn++; await new Promise((r) => setTimeout(r, 10)); return { bytes: PNG, model: 'fake-image' } } }
  const daily = new SlidingWindowLimiter(5, 86_400_000)
  const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async (i) => { filmInputs.push(i); return clone(FILM) }, image, vision: vision as never, env: { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_RENDER_MS: '20000' } as never, log: () => {}, pollMs: 10, daily }))
  const call = async (body: Record<string, unknown>, ip = '203.0.113.5') => {
    const r = await H.start(new Request('http://x/api/preview', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ story: FIX.story, language: 'ja', ...FIX.context, shown: ['備', '憶'], ...body }) }))
    return { status: r.status, json: (await r.json()) as Record<string, any> }
  }
  return { store, H, call, filmInputs, drawn: () => drawn, daily }
}
{
  const r = rig()
  check('(3) before a character is picked nothing is drawn: no draft exists, no image was asked for', r.drawn() === 0 && r.store.objects.size === 0)
  const a = await r.call({})
  check('(3) the pick starts the draft: the film script is written (once), saved under a private id with no order behind it, and NOTHING is drawn yet', a.status === 200 && a.json.state === 'ok' && /^AN-[a-z2-9]{20}$/.test(a.json.id) && a.json.reused === false && r.filmInputs.length === 1 && r.drawn() === 0)
  const rec = (await r.store.get(a.json.id)) as { order_ref: string; draft: { story_hash: string }; glyph: string; film: FilmRecord }
  check('(3) the draft keeps a hash of the story and the script, never the story: order_ref DRAFT, no character, no story text', rec.order_ref === DRAFT_REF && rec.draft.story_hash === storyHash(FIX.story, 'ja', false) && rec.glyph === '' && !JSON.stringify(rec).includes(FIX.story.slice(0, 12)))
  check('(3) the script is written with NO character chosen (the prompt is told so) and with every shown character forbidden in the lines', r.filmInputs[0].glyph === NOT_CHOSEN && r.filmInputs[0].who === NOT_CHOSEN && r.filmInputs[0].forms.join('') === '備憶')
  const v0 = await (await r.H.view(a.json.id)).json() as { state: string; lines: string[]; pictures: (string | null)[] }
  check('(3) the view before any drawing: the four lines, no picture yet', v0.lines.length === 4 && v0.pictures.every((p) => p === null) && v0.state === 'drawing')
  const t0 = Date.now()
  const rend = await (await r.H.render(a.json.id)).json() as { state: string; pictures: (string | null)[] }
  check('(3) the render draws the four pictures (the request stays open until they are done), each one served by the film picture route', r.drawn() === 4 && rend.state === 'done' && rend.pictures.every((p) => typeof p === 'string' && p.startsWith(`/api/film/${a.json.id}/picture/`)) && Date.now() - t0 < 20000)
  // switching characters, poem formats or candidate sets: the browser asks again with the same story
  const b = await r.call({ draft_id: a.json.id, shown: ['備', '憶', '想', '恵'] })
  const c = await r.call({ draft_id: a.json.id, language: 'ja', relationship: 'friend', shown: ['備'] })
  await r.H.render(a.json.id)
  check('(3) ONE DRAWING PER STORY: asking again for the same story (another character, a new set of candidates, another context chip) gives back the same draft, writes no new script and draws nothing again', b.json.id === a.json.id && b.json.reused === true && c.json.id === a.json.id && r.filmInputs.length === 1 && r.drawn() === 4)
  const d = await r.call({ draft_id: a.json.id, story: FIX.story + ' その後も、変わらない。' })
  check('(3) …and a CHANGED story is a new story: a new draft, a new script', d.json.id !== a.json.id && d.json.reused === false && r.filmInputs.length === 2)
  const e = await r.call({ draft_id: a.json.id, language: 'en' })
  check('(3) the same text in another language is a new set too (the pictures are judged against the buyer\'s world)', e.json.id !== a.json.id && r.filmInputs.length === 3)
  const mem = await r.call({ draft_id: a.json.id, occasion: 'memorial' })
  check('(3) a remembrance is a new set (its own paler style)', mem.json.id !== a.json.id && r.filmInputs[3]?.memorial === true)
  const A = createAnimationHandlers(() => ({ store: r.store, now: () => NOW }))
  const G = createGiftHandlers(() => ({ store: r.store, now: () => NOW }))
  check('(3) no download before payment: a draft is not a film page, has no QR, no story scroll and no PDF (those routes only know orders)', (await A.view(a.json.id)).status === 404 && (await A.qr(a.json.id)).status === 404 && (await A.render(a.json.id)).status === 404 && (await G.scrollForSender(a.json.id, 'png')).status === 404 && (await G.scrollForSender(a.json.id, 'pdf')).status === 404)
  check('(3) a made-up or foreign id is a 404', (await r.H.view('AN-nonexistent2222222')).status === 404 && (await r.H.render('AN-nonexistent2222222')).status === 404 && (await r.H.view('RG-aaaaaaaaaaaaaaaaaaaa')).status === 404)
}

// ---- 4. at most 5 new picture sets per person per day ---------------------------------------------------------------------------------------------------------------
{
  const r = rig()
  const outs: string[] = []
  for (let i = 0; i < 6; i++) outs.push((await r.call({ story: `${FIX.story} ${'あ'.repeat(i + 1)}` })).json.state)
  const scriptCallsAtLimit = r.filmInputs.length
  const other = await r.call({ story: FIX.story + ' 別のひと' }, '198.51.100.9')
  const again = await r.call({ story: FIX.story + ' あ' }, '203.0.113.5')
  check('(4) the 6th new set of one person in a day is "limited" — no draft, no script call; another person is not affected', outs.slice(0, 5).every((s) => s === 'ok') && outs[5] === 'limited' && scriptCallsAtLimit === 5 && other.json.state === 'ok' && r.filmInputs.length === 6)
  check('(4) a new set after the limit stays limited, and writes no script', again.json.state === 'limited' && r.filmInputs.length === 6)
  check('(4) the limit is 5 a day by default and can be set (ICHIREI_PREVIEW_DAILY_MAX); 0 switches the pictures off before payment', previewDailyMax({} as never) === 5 && previewDailyMax({ ICHIREI_PREVIEW_DAILY_MAX: '8' } as never) === 8 && previewDailyMax({ ICHIREI_PREVIEW_DAILY_MAX: '0' } as never) === 0)
}
{
  const r = rig()
  const a = await r.call({})
  r.daily.hit('203.0.113.5'); r.daily.hit('203.0.113.5'); r.daily.hit('203.0.113.5'); r.daily.hit('203.0.113.5')
  const again = await r.call({ draft_id: a.json.id })
  check('(4) a person at the limit still gets their own draft back for the same story (reuse is never limited)', again.json.state === 'ok' && again.json.reused === true && again.json.id === a.json.id)
}

// ---- 5. the draft becomes the order's film ----------------------------------------------------------------------------------------------------------------------------
{
  const r = rig()
  const d = await r.call({ shown: ['証', '憶'] })
  await r.H.render(d.json.id)
  const carts: unknown[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => { carts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
  let filmCalls = 0
  const deps = (): OrderDeps => ({ store: r.store, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: async () => { filmCalls++; return clone(FILM) }, filmWaitMs: 0 })
  const order = async (over: Record<string, unknown>) => {
    const res = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ story: FIX.story, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2027-01-15', inscription_style: 'modern', package: 'standard', draft_id: d.json.id, ...over }) }))
    return { status: res.status, json: (await res.json()) as Record<string, any> }
  }
  const o = await order({})
  const rec = (await r.store.get(o.json.order_ref)) as { animation_id: string; production: { film: FilmRecord }; shown_characters: { candidate: { kanji: string } }[] }
  const anim = (await r.store.get(d.json.id)) as { order_ref: string; draft: unknown; glyph: string; film: FilmRecord }
  check('(5) the order ADOPTS the draft: its animation id is the draft\'s id, the record now belongs to the order (not a draft), the same script — and no second script call, no second drawing', o.status === 200 && rec.animation_id === d.json.id && anim.order_ref === o.json.order_ref && !anim.draft && anim.glyph === '証' && anim.film.lines.join() === FILM.lines.join() && rec.production.film.lines.join() === FILM.lines.join() && filmCalls === 0 && r.drawn() === 4)
  check('(5) the shown characters are on the order record', Array.isArray(rec.shown_characters) && rec.shown_characters.some((s) => s.candidate.kanji === '証'))
  const A = createAnimationHandlers(() => ({ store: r.store, now: () => NOW }))
  const view = (await (await A.view(d.json.id)).json()) as { glyph: string; film: { pictures: string[] } }
  check('(5) the sender\'s page of the order now opens that same film, with the pictures already drawn', view.glyph === '証' && view.film.pictures.length === 4 && view.film.pictures.every((u) => u.includes(`/api/film/${d.json.id}/picture/`)))
  const d2 = await r.call({ story: FIX.story + ' ちがう話' })
  const o2 = await order({ draft_id: d2.json.id })
  const rec2 = (await r.store.get(o2.json.order_ref)) as { animation_id: string }
  check('(5) a draft of ANOTHER story is not adopted: the order makes its own film as before', o2.status === 200 && rec2.animation_id !== d2.json.id && filmCalls === 1)
  const o3 = await order({ draft_id: 'AN-nonexistent2222222' })
  check('(5) an unknown draft id is simply ignored (the order goes on and makes its film)', o3.status === 200 && filmCalls === 2)
  // a line that contains the chosen character: not adopted
  const bad = rig()
  const dd = await startPreview({ store: bad.store, film: async () => ({ ...clone(FILM), lines: ['朝、証を見つけた。', ...FILM.lines.slice(1)] }), log: () => {} }, { story: FIX.story, language: 'ja', relationship: null, direction: null, occasion: null, occasion_detail: null, memorial: false, shown: [] })
  const deps2 = (): OrderDeps => ({ ...deps(), store: bad.store })
  const res = await createOrderHandler(deps2)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ story: FIX.story, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2027-01-15', inscription_style: 'modern', package: 'standard', draft_id: dd.state === 'ok' ? dd.id : '' }) }))
  const j = (await res.json()) as { order_ref: string }
  const rr = (await bad.store.get(j.order_ref)) as { animation_id: string }
  check('(5) a draft whose lines contain the chosen character is not adopted (the film must never name its answer)', res.status === 200 && dd.state === 'ok' && rr.animation_id !== dd.id)
}

// ---- 6. the analytics events: codes and counts only -------------------------------------------------------------------------------------------------------------------
{
  const s = 'abcdefghijklmnopqrstuvwx'
  const ev = (e: Record<string, unknown>) => parseClientEvent({ session: s, source: 'customer', language: 'ja', ...e }, NOW) as Record<string, unknown> | null
  check('(6) the four preview events are accepted: card_preview_shown, candidates_retry (1 or 2), pictures_before_pay (shown / limited / failed), preview_to_order', PREVIEW_EVENTS.join() === 'card_preview_shown,candidates_retry,pictures_before_pay,preview_to_order' && ev({ event: 'candidates_retry', n: 2 })?.n === 2 && ev({ event: 'candidates_retry', n: 3 })?.n === null && ev({ event: 'pictures_before_pay', state: 'limited' })?.state === 'limited' && ev({ event: 'pictures_before_pay', state: 'zz' })?.state === null)
  const e = ev({ event: 'card_preview_shown', secs: 41.6, kanji: '備', story: 'x', character: '備' })
  check('(6) only codes and whole seconds are kept: no character, no story, no free text', e !== null && e.secs === 42 && !('kanji' in e) && !('story' in e) && !('character' in e) && ev({ event: 'card_preview_shown', secs: -3 })?.secs === null)
}

upstream.close()
if (failures) {
  console.error(`\n${failures} preview check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll preview checks passed.')
