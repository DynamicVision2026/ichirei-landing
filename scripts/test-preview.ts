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

// ---- 7. Part 1 fix (2026-10-31): a washi slot never hides the pictures that are there ----------------------------------------------------------------------------
{
  const { createHash } = await import('node:crypto')
  const { markWashiForRetry, artPath, readArt } = await import('../engine/film-art.ts')
  const KITCHEN = 'standing at a quiet kitchen counter'
  let failKitchen = true // the first picture fails every check while this is on (a face, even after the rewrite)
  const visionFail = {
    messages: {
      stream: (params: { messages: { content: string | { type: string; text?: string }[] }[] }) => ({
        finalMessage: async () => {
          const content = params.messages[0].content
          if (typeof content === 'string') return { content: [{ type: 'text', text: JSON.stringify({ picture: `A woman seen from behind ${KITCHEN} in soft grey light, her hands resting on a closed bento box on the counter` }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
          const text = content.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
          const n = content.filter((b) => b.type === 'image').length
          const bad = failKitchen && text.includes(KITCHEN)
          return { content: [{ type: 'text', text: JSON.stringify({ pictures: Array.from({ length: n }, () => (bad ? { ok: false, reason: 'face' } : OKV)) }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
        },
      }),
    },
  }
  const store = new MemoryOrderStore()
  let drawn = 0
  const image: ImageClient = { async generate() { drawn++; await new Promise((r) => setTimeout(r, 15)); return { bytes: PNG, model: 'fake-image' } } }
  const logs: string[] = []
  const env = { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_RENDER_MS: '30000', ICHIREI_FILM_QUOTA_WAITS_MS: '0', ICHIREI_FILM_CHECK_WAITS_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' } as never
  const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async () => clone(FILM), image, vision: visionFail as never, env, log: (l) => logs.push(l), pollMs: 10, daily: new SlidingWindowLimiter(5, 86_400_000) }))
  const started = await (await H.start(new Request('http://x/api/preview', { method: 'POST', body: JSON.stringify({ story: FIX.story, language: 'ja', ...FIX.context, shown: ['証'] }) }))).json() as { id: string }
  // watch the page's view while the pictures are being drawn: what is shown never goes away
  const seen: number[] = []
  let polling = true
  const watcher = (async () => { while (polling) { const v = await (await H.view(started.id)).json() as { pictures: (string | null)[] }; seen.push(v.pictures.filter(Boolean).length); await new Promise((r) => setTimeout(r, 5)) } })()
  const view = await (await H.render(started.id)).json() as { state: string; pictures: (string | null)[]; slots: string[] }
  polling = false
  await watcher
  check('(7) the slot that failed its check three times is the plain washi tile, and the other three pictures are shown: state "done" (not "failed"), slots washi / ai / ai / ai', view.state === 'done' && view.slots.join() === 'washi,ai,ai,ai' && view.pictures[0] === null && view.pictures.slice(1).every((u) => typeof u === 'string'))
  check('(7) the pictures that are shown never go away while the others are still being drawn (the number shown never goes down)', seen.length > 2 && seen.every((n, i) => i === 0 || n >= seen[i - 1]) && seen.at(-1) === 3)
  const ev = logs.map((l) => (l.startsWith('[ichirei-preview] ') ? JSON.parse(l.slice('[ichirei-preview] '.length)) : null)).find((e) => e?.event === 'preview_render')
  check('(7) preview_render is logged with the seconds from the pick to each picture (null for the washi tile) — codes and numbers only', !!ev && ev.picture_secs_from_pick.length === 4 && ev.picture_secs_from_pick[0] === null && ev.picture_secs_from_pick.slice(1).every((x: unknown) => typeof x === 'number' && (x as number) >= 0) && ev.pictures === 3 && ev.washi === 1 && typeof ev.secs_from_pick_to_render === 'number')
  const art0 = await readArt(store, started.id)
  check('(7) the art record keeps when each picture was ready, and no story text', art0?.ready_ms?.length === 4 && art0.ready_ms[0] === null && art0.ready_ms.slice(1).every((x) => typeof x === 'number'))
  // the order adopts the draft; the washi slot gets ONE more full attempt at the first open, the others stay exactly as they are
  const sha = (b: Buffer | null) => (b ? createHash('sha256').update(b).digest('hex') : '')
  const before = await Promise.all([2, 3, 4].map(async (n) => sha(await store.getObject(`films/${started.id}/${n}.webp`))))
  const drawnBefore = drawn
  const deps = (): OrderDeps => ({ store, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl: (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })) as typeof fetch, film: async () => clone(FILM), filmWaitMs: 0 })
  const res = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ story: FIX.story, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2027-01-15', inscription_style: 'modern', package: 'standard', draft_id: started.id }) }))
  const rec = (await store.get(((await res.json()) as { order_ref: string }).order_ref)) as { animation_id: string }
  check('(7) the order adopted the draft (same id) and remembers that its washi slot is to be tried once more', res.status === 200 && rec.animation_id === started.id && ((await store.get(started.id)) as { retry_washi?: boolean }).retry_washi === true && drawn === drawnBefore)
  failKitchen = false // the second attempt passes
  const A = createAnimationHandlers(() => ({ store, now: () => NOW, image, vision: visionFail as never, env, log: (l) => logs.push(l), pollMs: 10 }))
  const opened = await (await A.render(started.id)).json() as { state: string; view: { film: { pictures: string[] } } }
  const art1 = await readArt(store, started.id)
  check('(7) AFTER PAYMENT the washi slot is drawn once more and passes: all four are pictures now', opened.state === 'ready' && art1?.slots.join() === 'ai,ai,ai,ai' && art1.paid_retry === true && opened.view.film.pictures.every((u) => u.startsWith('/api/film/')))
  const after = await Promise.all([2, 3, 4].map(async (n) => sha(await store.getObject(`films/${started.id}/${n}.webp`))))
  check('(7) …only that one slot was drawn (one picture, not four): the other three are byte for byte what they were', drawn - drawnBefore === 1 && after.join() === before.join())
  check('(7) it is done once per film: a second call changes nothing', (await markWashiForRetry(store, started.id, NOW)) === false)
  // a slot that fails again after payment stays washi, and is not tried a third time
  failKitchen = true
  const store2 = new MemoryOrderStore()
  const H2 = createPreviewHandlers(() => ({ store: store2, now: () => NOW, film: async () => clone(FILM), image, vision: visionFail as never, env, log: () => {}, pollMs: 10, daily: new SlidingWindowLimiter(5, 86_400_000) }))
  const s2 = await (await H2.start(new Request('http://x/api/preview', { method: 'POST', body: JSON.stringify({ story: FIX.story + ' 二', language: 'ja', ...FIX.context, shown: ['証'] }) }))).json() as { id: string }
  await H2.render(s2.id)
  await markWashiForRetry(store2, s2.id, NOW)
  const A2 = createAnimationHandlers(() => ({ store: store2, now: () => NOW, image, vision: visionFail as never, env, log: () => {}, pollMs: 10 }))
  void A2
  const art2 = JSON.parse((await store2.getObject(artPath(s2.id)))!.toString())
  check('(7) before the retry the washi slot is "pending" again with its counters cleared, a fresh call budget, and the pictures untouched', art2.slots.join() === 'pending,ai,ai,ai' && art2.check_fails[0] === 0 && art2.rewrites[0] === 0 && art2.calls === 0 && art2.status === 'incomplete')
  // when ALL four fail, the page leaves the pictures out (state failed); with one picture it never does
  const { viewOf } = await import('../engine/preview.ts')
  const recAny = { id: started.id, film: { ...clone(FILM) }, order_ref: 'DRAFT', draft: {}, language: 'ja', memorial: false } as never
  const none = viewOf(recAny, { schema: 'film-art', id: started.id, status: 'done', started_at: NOW.toISOString(), slots: ['washi', 'washi', 'washi', 'washi'] })
  const one = viewOf(recAny, { schema: 'film-art', id: started.id, status: 'done', started_at: NOW.toISOString(), slots: ['washi', 'washi', 'washi', 'ai'] })
  const mid = viewOf(recAny, { schema: 'film-art', id: started.id, status: 'rendering', started_at: NOW.toISOString(), slots: ['ai', 'pending', 'washi', 'pending'] })
  check('(7) the page says "pictures after the order" only when ALL FOUR slots failed (state failed) — one picture is enough to show the card with its washi tiles; while drawing, a washi tile already shows', none.state === 'failed' && one.state === 'done' && mid.state === 'drawing' && mid.slots.join() === 'ai,pending,washi,pending')
}

// ---- 8. v9.6 follow-up: WHY the card shows no pictures — the picture outcome in `?debug=1` ------------------------------------------------------------------------------------
{
  const FALLBACK: FilmRecord = { status: 'fallback', lines: [], pictures: [], made_at: NOW.toISOString(), reason: 'pic_blocked' }
  const mkRig = (over: { film?: () => FilmRecord; image?: ImageClient; env?: Record<string, string>; daily?: SlidingWindowLimiter } = {}) => {
    const store = new MemoryOrderStore()
    const image: ImageClient = over.image ?? { async generate() { return { bytes: PNG, model: 'fake-image' } } }
    const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async () => clone((over.film ?? (() => FILM))()), image, vision: vision as never, env: { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_RENDER_MS: '20000', ICHIREI_FILM_QUOTA_WAITS_MS: '0', ICHIREI_FILM_CHECK_WAITS_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0', ...(over.env ?? {}) } as never, log: () => {}, daily: over.daily ?? new SlidingWindowLimiter(100, 86_400_000) }))
    const start = async (extra: Record<string, unknown> = {}, q = '?debug=1') => {
      const r = await H.start(new Request(`http://x/api/preview${q}`, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.5' }, body: JSON.stringify({ story: FIX.story + (extra.story ?? ''), language: 'ja', ...FIX.context, shown: ['備'], ...extra }) }))
      return (await r.json()) as Record<string, any>
    }
    const render = async (id: string, q = '?debug=1') => (await (await H.render(id, new Request(`http://x/api/preview/${id}/render${q}`, { method: 'POST' }))).json()) as Record<string, any>
    const view = async (id: string, q = '?debug=1') => (await (await H.view(id, new Request(`http://x/api/preview/${id}${q}`))).json()) as Record<string, any>
    return { store, H, start, render, view }
  }
  // ok
  {
    const r = mkRig()
    const a = await r.start()
    const done = await r.render(a.id)
    const v = await r.view(a.id)
    check('(8) outcome `ok`: the pictures were drawn → debug.outcome ok with the numbers (pictures 4, washi 0); the start says drawing, the view agrees', a.debug?.outcome === 'drawing' && done.debug?.outcome === 'ok' && done.debug.pictures === 4 && done.debug.washi === 0 && v.debug?.outcome === 'ok', JSON.stringify([a.debug, done.debug]))
    const plain = await r.render(a.id, '')
    check('(8) without ?debug=1 the response is unchanged: no `debug` key on the start, the view or the render', !('debug' in plain) && !('debug' in (await r.view(a.id, ''))) && !('debug' in (await r.start({}, ''))))
  }
  // limit: the person's daily limit
  {
    const r = mkRig({ daily: new SlidingWindowLimiter(1, 86_400_000) })
    await r.start({ story: ' 一' })
    const lim = await r.start({ story: ' 二' })
    check('(8) outcome `limit` (person_daily): the second new set of one person in a day → state limited, debug {outcome limit, limit person_daily, max} — the page\'s 「物語の絵は、ご注文後にお届けします」 is the right message', lim.state === 'limited' && lim.debug?.outcome === 'limit' && lim.debug.limit === 'person_daily' && typeof lim.debug.max === 'number', JSON.stringify(lim))
  }
  // limit: the day's film limit (all sets)
  {
    const r = mkRig({ env: { ICHIREI_FILM_DAILY_MAX: '1' } })
    const a1 = await r.start({ story: ' 甲' })
    await r.render(a1.id)
    const a2 = await r.start({ story: ' 乙' })
    const out = await r.render(a2.id)
    check('(8) outcome `limit` (film_daily): the day\'s film limit (ICHIREI_FILM_DAILY_MAX) reached → render state failed/deferred and debug {outcome limit, limit film_daily}', out.debug?.outcome === 'limit' && out.debug.limit === 'film_daily' && out.debug.art_status === 'deferred', JSON.stringify(out.debug))
  }
  // all_failed: the script fell back (the film script could not be made or failed its checks twice)
  {
    const r = mkRig({ film: () => FALLBACK })
    const a = await r.start()
    const out = await r.render(a.id)
    check('(8) outcome `all_failed` / cause script_fallback: the film script was only the fallback → the reason code (pic_blocked) is in the output, so the cause is known without reading the logs', a.debug?.script_status === 'fallback' && out.state === 'failed' && out.debug?.outcome === 'all_failed' && out.debug.cause === 'script_fallback' && out.debug.script_reason === 'pic_blocked', JSON.stringify([a.debug, out.debug]))
  }
  // all_failed: the image model failed for every picture
  {
    const { ImageError } = await import('../engine/film-art.ts')
    const bad: ImageClient = { async generate() { throw new ImageError('image_error', 'boom') } } as never
    const r = mkRig({ image: bad })
    const a = await r.start()
    const out = await r.render(a.id)
    check('(8) outcome `all_failed` / cause images_failed: every picture failed → reasons per slot (codes only) in debug, no picture, state failed', out.state !== 'done' && out.debug?.outcome === 'all_failed' && out.debug.cause === 'images_failed' && Array.isArray(out.debug.reasons) && out.debug.reasons.length === 4 && out.debug.pictures === 0, JSON.stringify(out.debug))
  }
  // the preview takes the purpose's tone: the page forwards purpose + state; an apology is a quiet film
  {
    const inputs: FilmInput[] = []
    const store = new MemoryOrderStore()
    const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async (i) => { inputs.push(i); return clone(FILM) }, log: () => {} }))
    await H.start(new Request('http://x/api/preview', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7' }, body: JSON.stringify({ story: FIX.story, language: 'ja', relationship: 'sibling', direction: 'across', purpose: 'apology', state: 'strained', shown: ['備'] }) }))
    check('(8) a preview of an apology is a quiet film with the purpose\'s tone line (the page now sends purpose and state with the draft request)', inputs[0]?.quiet === true && /apology/.test(inputs[0]?.tone ?? '') && /unresolved/.test(inputs[0]?.tone ?? ''), JSON.stringify([inputs[0]?.quiet, inputs[0]?.tone]))
  }
  check('(8) the film prompt tells the writer: no knife, blade, weapon, fight or quarrel in a picture (the check refuses them), and no celebration image in a quiet gift (an apology, an encouragement)', (() => { const t = readFileSync(join(process.cwd(), 'engine/film-prompt.md'), 'utf8'); return t.includes('NO knife, blade, weapon, fight or quarrel') && t.includes('a quiet gift (an apology, an encouragement') })())
}

upstream.close()
if (failures) {
  console.error(`\n${failures} preview check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll preview checks passed.')
