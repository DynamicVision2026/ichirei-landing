// A long (4,105-character) Japanese remembrance story — father, 目上, 偲ぶ — and the card rules around it (live reports 2026-11-01). A FAKE model: no key, no network.
//  * remembrance returns TWO cards (main + second): no free pick is offered, none is asked for in a refill, none counts as an empty slot, and the log says freestyle "not_offered";
//  * the gaze-line step can never cost a card (the better of the two lines is kept);
//  * the refill (spec step 8) still covers a removed main or second in remembrance, and every empty slot (the free pick included) for every other occasion;
//  * a birthday story still returns three cards.
// What the real model chooses is for the live runner.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-long-remembrance.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult } from '../engine/contract.ts'
import { gazeIssues } from '../engine/gaze.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`); if (!cond) failures++ }
const fx = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'memorial-story.json'), 'utf8'))
const FILLER = '話しているうちに思い出したことも、ここに足しておきます。あの頃の家の匂いや、台所の窓から入る夕方の光、帰りの電車で考えていたことまで、一つひとつ覚えています。'
let story: string = fx.story
while ([...story].length + [...FILLER].length + 1 <= 4105) story += `\n${FILLER}`
story += 'あ'.repeat(4105 - [...story].length)

const BAD_GAZE_1 = '「そうか」という短い一言の中に、父の十年分の想いが詰まっていた。' // subject: the feelings
const BAD_GAZE_2 = '何も言わずに、玄関の灯りをつけてくれた。' // ends on a verb
const GOOD_GAZE_3 = 'いつも、帰ると少しだけ嬉しそうだった人。'
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string, truth = 'Essence') => ({ slot, kanji, inscription_form: null, reading, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const MAIN = () => cand('main', '誠', 'まこと', BAD_GAZE_1, '帰省するたびに')
const SECOND = () => cand('second', '灯', 'あかり', BAD_GAZE_2, '玄関の灯りをつけて', 'Private Symbol')
const FREE = (k = '待', r = 'まつ') => cand('freestyle', k, r, GOOD_GAZE_3, '少しだけ嬉しそう', 'Play')
const replyOf = (...cands: any[]) => ({ ...fx.model_reply, primary_kanji: '誠', runner_up_kanji: '灯', freestyle_kanji: cands.find((c) => c.slot === 'freestyle')?.kanji ?? null, candidates: cands })

let modelReply: any = replyOf(MAIN(), SECOND(), FREE())
let gazeReply: unknown = 'not json at all'
let refillReply: unknown = { none: true }
let refillCalls = 0
let gazeCalls = 0
let gazeFail = false
let refillHang = false
const lastBody: Record<string, any> = {}
let vetoed = new Set<string>()
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const prompt = String(body.messages[0].content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Replacement Prompt (v9') ? 'replace' : 'select'
  lastBody[kind] = { model: body.model, effort: body.output_config?.effort, max_tokens: body.max_tokens, prompt }
  if (kind === 'replace') { refillCalls++; if (refillHang) return }
  if (kind === 'gaze') { gazeCalls++; if (gazeFail) { res.writeHead(500); res.end('boom'); return } }
  let reply: unknown
  if (kind === 'review') {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: !vetoed.has(m[2]), rule: vetoed.has(m[2]) ? 'dignity' : null, reason: 'ok' }))
    reply = { verdicts: items }
  } else reply = kind === 'gaze' ? gazeReply : kind === 'replace' ? refillReply : modelReply
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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
for (const k of ['ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE']) delete process.env[k]

const logs: string[] = []
const origLog = console.log
type Ctx = typeof fx.context
const MEMORIAL: Ctx = fx.context
const BIRTHDAY: Ctx = { ...fx.context, occasion: 'birthday_milestone' }
const run = async (ctx: Ctx = MEMORIAL) => {
  logs.length = 0; refillCalls = 0; gazeCalls = 0
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { return await runEngine(story, 'A', { context: ctx }) } finally { console.log = origLog }
}
type R = Awaited<ReturnType<typeof run>>
const live = (r: R) => r.candidates.filter((c) => !c.eliminated)
const gazeOf = (r: R, k: string) => r.candidates.find((c) => c.kanji === k)?.one_line_gaze
const cardsLog = () => logs.find((l) => l.startsWith('[ichirei-cards]')) ?? ''

try {
  check('the test story is 4,105 characters (Japanese, father, 目上, 偲ぶ)', [...story].length === 4105 && MEMORIAL.occasion === 'memorial' && MEMORIAL.relationship === 'parent_father')
  check('the fake model\'s lines for 誠 and 灯 fail the gaze shape; the third passes', gazeIssues(BAD_GAZE_1, 'ja').length > 0 && gazeIssues(BAD_GAZE_2, 'ja').length > 0 && gazeIssues(GOOD_GAZE_3, 'ja').length === 0)

  // ---- remembrance: TWO cards, no free pick, no refill call, "not_offered" ---------------------------------------------------------------------------------------------
  modelReply = replyOf(MAIN(), SECOND(), FREE())
  const r1 = await run()
  check('(1) remembrance, the model wrote a free pick (待) anyway: it is dropped — TWO live cards (誠 main, 灯 second), no free pick, contract-valid', live(r1).map((c) => `${c.slot}:${c.kanji}`).join() === 'main:誠,second:灯' && r1.freestyle_kanji === null && validateEngineResult(r1).length === 0, JSON.stringify(r1.candidates.map((c) => [c.slot, c.kanji])) + validateEngineResult(r1).join('; '))
  check('(1) …no refill call is made (the free pick is not an empty slot in remembrance) and the log says freestyle "not_offered", with no refill', refillCalls === 0 && cardsLog().includes('"freestyle":"not_offered"') && cardsLog().includes('"refill":null') && !logs.some((l) => l.includes('free_slot_empty')), cardsLog())

  modelReply = replyOf(MAIN(), SECOND(), FREE('喜', 'よろこぶ'))
  const r2 = await run()
  check('(2) remembrance, the model\'s free pick is the blocked 喜: two cards, no refill call, no error', r2.status === 'sufficient' && live(r2).length === 2 && !live(r2).some((c) => c.kanji === '喜') && refillCalls === 0 && cardsLog().includes('"freestyle":"not_offered"'), cardsLog())

  modelReply = replyOf(MAIN(), SECOND())
  const r3 = await run()
  check('(3) remembrance, the model wrote none (as the prompt now asks): two cards, no refill call (the old run asked for a free pick here and lost 14 s)', live(r3).length === 2 && refillCalls === 0 && validateEngineResult(r3).length === 0)
  check('(3) …the selection prompt tells the model: no free pick in remembrance', ['ja', 'zh', 'en'].every((f) => readFileSync(join(process.cwd(), 'engine', `prompt.${f}.md`), 'utf8').includes('NO FREESTYLE IN REMEMBRANCE')))

  // ---- the gaze step never costs a card ------------------------------------------------------------------------------------------------------------------------------------
  check('(4) gaze rewrite unusable (rubbish): both cards stay, one rewrite call, original lines kept', live(r3).length === 2 && gazeCalls === 1 && gazeOf(r3, '誠') === BAD_GAZE_1 && gazeOf(r3, '灯') === BAD_GAZE_2)
  gazeFail = true
  const r4 = await run()
  gazeFail = false
  check('(4) gaze rewrite call fails outright: still both cards, lines unchanged', live(r4).length === 2 && gazeOf(r4, '誠') === BAD_GAZE_1)
  const GOOD_1 = '言葉にせず、帰省のたびに玄関の灯りをつけて待っていた父。'
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: GOOD_1 }] }
  const r5 = await run()
  check('(4) a rewrite that passes replaces the line; no card is lost', live(r5).length === 2 && gazeOf(r5, '誠') === GOOD_1 && gazeIssues(GOOD_1, 'ja').length === 0)
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '『ありがとう』という言葉の中に、想いが詰まっていた。' }] }
  const r6 = await run()
  check('(4) a rewrite that is not better is ignored (the better of the two lines is kept); both cards stay', live(r6).length === 2 && gazeIssues(gazeOf(r6, '誠') ?? '', 'ja').length <= gazeIssues(BAD_GAZE_1, 'ja').length)
  gazeReply = 'not json at all'

  // ---- the refill still covers a removed MAIN or SECOND in remembrance (one call, only those slots) ------------------------------------------------------------------------
  modelReply = replyOf(MAIN(), SECOND())
  vetoed = new Set(['灯'])
  refillReply = { candidates: [{ ...cand('second', '守', 'まもる', GOOD_GAZE_3, '玄関の灯りをつけて', 'Hidden Cost') }] }
  const r7 = await run()
  vetoed = new Set()
  check('(5) remembrance, the review removes the second (灯): ONE refill call asks for the second ONLY, fills it (守): main + second, still no free pick', refillCalls === 1 && live(r7).map((c) => c.kanji).join() === '誠,守' && cardsLog().includes('"asked":["second"]') && cardsLog().includes('"filled":["second"]') && cardsLog().includes('"freestyle":"not_offered"'), cardsLog() + JSON.stringify(r7.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  modelReply = replyOf(MAIN(), SECOND())
  vetoed = new Set(['灯'])
  refillReply = { none: true }
  const r8 = await run()
  vetoed = new Set()
  check('(5) …and when the refill finds nothing: the one card that stands is shown, no error, one call at most', r8.status === 'sufficient' && live(r8).map((c) => c.kanji).join() === '誠' && refillCalls === 1)

  // ---- every other occasion: three cards (birthday), and the free pick is still refilled ------------------------------------------------------------------------------------
  modelReply = replyOf(MAIN(), SECOND(), FREE())
  refillReply = { none: true }
  const b1 = await run(BIRTHDAY)
  check('(6) a birthday story still returns THREE cards (誠 main, 灯 second, 待 free pick), no refill call, and the log does not say "not_offered"', live(b1).map((c) => `${c.slot}:${c.kanji}`).join() === 'main:誠,second:灯,freestyle:待' && refillCalls === 0 && !cardsLog().includes('not_offered') && validateEngineResult(b1).length === 0, cardsLog())
  modelReply = replyOf(MAIN(), SECOND())
  refillReply = { candidates: [FREE()] }
  const b2 = await run(BIRTHDAY)
  check('(6) a birthday story whose reply has no free pick: ONE refill call asks for the free pick and fills it — three cards', live(b2).length === 3 && refillCalls === 1 && cardsLog().includes('"asked":["freestyle"]') && cardsLog().includes('"filled":["freestyle"]'), cardsLog())

  // ---- the speed measure (2026-11-01): total time and the time of every step on the [ichirei-cards] line; behaviour unchanged -------------------------------------
  modelReply = replyOf(MAIN(), SECOND())
  refillReply = { candidates: [FREE()] }
  const m1 = await run(BIRTHDAY)
  const mj = JSON.parse(cardsLog().slice('[ichirei-cards] '.length))
  const parts = mj.ms.select + mj.ms.referee + mj.ms.review + mj.ms.refill + mj.ms.gaze
  check('(8) the [ichirei-cards] line carries the total and the time of each step — selection, referee, review, refill, gaze check — as numbers, and the steps add up to no more than the total', ['total', 'select', 'referee', 'review', 'refill', 'gaze'].every((k) => typeof mj.ms[k] === 'number' && mj.ms[k] >= 0) && parts <= mj.ms.total + 5 && mj.ms.select_attempts === 1, cardsLog())
  check('(8) …and the calls made: one selection, one review, one refill (the free pick the reply left out), one gaze rewrite (the fake model\'s lines fail the shape) — and the cards are the same three as before', mj.calls.select === 1 && mj.calls.review === 1 && mj.calls.refill === 1 && mj.calls.gaze === 1 && live(m1).length === 3, JSON.stringify(mj.calls))
  modelReply = replyOf({ ...MAIN(), one_line_gaze: GOOD_GAZE_3 }, { ...SECOND(), one_line_gaze: GOOD_GAZE_3 }, FREE())
  await run(BIRTHDAY)
  const mk = JSON.parse(cardsLog().slice('[ichirei-cards] '.length))
  check('(8) a request with three cards and good lines makes no refill and no gaze call: calls {select 1, review 1, refill 0, gaze 0}, refill null', mk.calls.refill === 0 && mk.calls.gaze === 0 && mk.refill === null && mk.ms.gaze_failing === 0, cardsLog())
  // ---- FREE-PICK REFILL (2026-11-01): the live fault — a removed free pick (寒, review: insult) was refilled with "no usable replacement" twice out of two ------------------------------
  const INFO = (l: string) => origLog(`INFO  ${l.slice(0, 900)}`)
  const refillLog = () => logs.find((l) => l.startsWith('[ichirei-refill]')) ?? ''
  const free寒 = { ...FREE('寒', 'さむい'), one_line_gaze: GOOD_GAZE_3 }
  const goodMain = { ...MAIN(), one_line_gaze: GOOD_GAZE_3 }
  const goodSecond = { ...SECOND(), one_line_gaze: GOOD_GAZE_3 }
  modelReply = replyOf(goodMain, goodSecond, free寒)
  vetoed = new Set(['寒'])
  const NEW_FREE = { slot: 'freestyle', kanji: '待', reading: 'まつ', inscription_form: null, truth_type: 'Play', one_line_gaze: GOOD_GAZE_3, story_anchor: '少しだけ嬉しそう' }
  refillReply = { candidate: NEW_FREE }
  const t0 = Date.now()
  const f1 = await run(BIRTHDAY)
  const dt1 = Date.now() - t0
  const cj = JSON.parse(cardsLog().slice('[ichirei-cards] '.length))
  check('(9) birthday story, the free pick 寒 is removed by the review (insult): ONE refill call asks for the free pick only and the refilled free pick 待 is shown — three cards, in well under 10 s', live(f1).map((c) => `${c.slot}:${c.kanji}`).join() === 'main:誠,second:灯,freestyle:待' && refillCalls === 1 && cj.refill.asked.join() === 'freestyle' && cj.refill.filled.join() === 'freestyle' && dt1 < 10_000, cardsLog())
  check('(9) …the free-pick-only refill uses the compact prompt, the small review-class model (claude-haiku-5-5) at LOW effort with a short answer limit — not the long selection prompt, not the selection model', lastBody.replace.model === 'claude-haiku-5-5' && lastBody.replace.effort === 'low' && lastBody.replace.max_tokens <= 2000 && lastBody.replace.prompt.includes('free pick only') && !lastBody.replace.prompt.includes('Return this exact shape') && lastBody.replace.prompt.includes('寒'), JSON.stringify({ ...lastBody.replace, prompt: undefined }))
  const rl = JSON.parse(refillLog().slice('[ichirei-refill] '.length))
  check('(9) …and the [ichirei-refill] line says what came back, in codes only: mode free_only, parse ok, the reply length, stop reason, the offered slot and character, nothing missing', rl.mode === 'free_only' && rl.parse === 'ok' && rl.reply_chars > 20 && rl.stop_reason === 'end_turn' && rl.offered[0].slot === 'freestyle' && rl.offered[0].kanji === '待' && rl.offered[0].missing.length === 0 && !refillLog().includes('少しだけ') && !refillLog().includes('嬉しそう'), refillLog())
  INFO(cardsLog())
  INFO(refillLog())

  // the refill finds nothing / fails: two cards, no error — whichever way it fails, and the log says which
  const failures: [string, unknown, string][] = [
    ['nothing at all (empty reply)', '', 'empty'],
    ['prose with no JSON', 'I could not find one.', 'no_json'],
    ['broken JSON', '{"candidate": {"kanji": "待", ', 'no_json'],
    ['an honest "none"', { none: true }, 'none'],
    ['an element missing its reading', { candidate: { ...NEW_FREE, reading: '' } }, 'offered_unusable'],
  ]
  for (const [label, reply, want] of failures) {
    refillReply = reply
    const r = await run(BIRTHDAY)
    const j = JSON.parse(refillLog().slice('[ichirei-refill] '.length) || '{}')
    check(`(10) the refill answers ${label}: two cards (誠, 灯), status sufficient, no error, ONE refill call — and the log names the cause (parse ${want})`, r.status === 'sufficient' && live(r).map((c) => c.kanji).join() === '誠,灯' && refillCalls === 1 && j.parse === want && validateEngineResult(r).length === 0, refillLog())
  }
  refillReply = { candidate: { ...NEW_FREE, reading: '' } }
  await run(BIRTHDAY)
  check('(10) …an offer with a missing field is logged with the field NAME (not its text): missing ["reading"]', JSON.parse(refillLog().slice('[ichirei-refill] '.length)).offered[0].missing.join() === 'reading')
  // the reply repeats the WHOLE selection shape (main, second and the new free pick): the free pick is still found, the others are ignored
  refillReply = { status: 'sufficient', candidates: [{ ...goodMain, slot: 'main' }, { ...goodSecond, slot: 'second' }, NEW_FREE], primary_kanji: '誠' }
  const whole = await run(BIRTHDAY)
  check('(10) a reply that repeats the whole selection shape still yields the new free pick (the element that names the free pick slot) — three cards', live(whole).map((c) => c.kanji).join() === '誠,灯,待', JSON.stringify(live(whole).map((c) => [c.slot, c.kanji])))
  // the call hangs: the 10 s ceiling (here 0.3 s) cuts it off; two cards, no error, and it does not wait for the long default
  process.env.ICHIREI_REFILL_FREE_TIMEOUT_MS = '300'
  refillHang = true
  const t1 = Date.now()
  const hung = await run(BIRTHDAY)
  const dt2 = Date.now() - t1
  refillHang = false
  delete process.env.ICHIREI_REFILL_FREE_TIMEOUT_MS
  check('(11) the refill hangs: it is cut off at the ceiling, the sender sees TWO cards, no error — within about a second here (10 s in production), the log says call_failed', hung.status === 'sufficient' && live(hung).length === 2 && dt2 < 3000 && JSON.parse(refillLog().slice('[ichirei-refill] '.length)).parse === 'call_failed', `${dt2} ms ${refillLog()}`)
  // a refill that includes a removed MAIN or SECOND keeps the selection prompt and the selection model
  modelReply = replyOf(goodMain, goodSecond, FREE())
  vetoed = new Set(['灯'])
  refillReply = { candidates: [{ ...cand('second', '守', 'まもる', GOOD_GAZE_3, '玄関の灯りをつけて', 'Hidden Cost') }] }
  await run(BIRTHDAY)
  vetoed = new Set()
  check('(12) a refill for a removed SECOND card keeps the current model (the selection model, not claude-haiku-5-5), the selection prompt, and the long answer limit', refillCalls === 1 && lastBody.replace.model !== 'claude-haiku-5-5' && lastBody.replace.effort === 'medium' && lastBody.replace.max_tokens > 2000 && lastBody.replace.prompt.includes('Return this exact shape') && JSON.parse(refillLog().slice('[ichirei-refill] '.length)).mode === 'full', JSON.stringify({ ...lastBody.replace, prompt: undefined }))
  check('(7) every request logs one [ichirei-cards] line with the story length and codes only — no story text', cardsLog().includes('"story_chars":4105') && !cardsLog().includes('帰省'))
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll long-remembrance checks passed.')
process.exit(failures ? 1 : 0)
