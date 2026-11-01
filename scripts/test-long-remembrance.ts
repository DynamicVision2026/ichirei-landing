// A long (4,105-character) Japanese remembrance story — father, 目上, 偲ぶ — must still come back with THREE cards, and the gaze-line step must never cost a card
// (live report 2026-11-01: only one card, 誠, came back). A FAKE model: no key, no network. What the real model chooses is for the live runner.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-long-remembrance.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult } from '../engine/contract.ts'
import { gazeIssues } from '../engine/gaze.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`); if (!cond) failures++ }
const fx = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'memorial-story.json'), 'utf8'))
const FILLER = '話しているうちに思い出したことも、ここに足しておきます。あの頃の家の匂いや、台所の窓から入る夕方の光、帰りの電車で考えていたことまで、一つひとつ覚えています。'
let story: string = fx.story
while ([...story].length + [...FILLER].length + 1 <= 4105) story += `\n${FILLER}`
story += 'あ'.repeat(4105 - [...story].length)

const BAD_GAZE_1 = '「そうか」という短い一言の中に、父の十年分の想いが詰まっていた。' // subject: the feelings
const BAD_GAZE_2 = '何も言わずに、玄関の灯りをつけてくれた。' // ends on a verb
const GOOD_GAZE_3 = 'いつも、帰ると少しだけ嬉しそうだった人。'
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string) => ({ slot, kanji, inscription_form: null, reading, truth_type: 'Essence', one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const modelReply = { ...fx.model_reply, primary_kanji: '誠', runner_up_kanji: '灯', freestyle_kanji: '待', candidates: [cand('main', '誠', 'まこと', BAD_GAZE_1, '帰省するたびに'), { ...cand('second', '灯', 'あかり', BAD_GAZE_2, '玄関の灯りをつけて'), truth_type: 'Private Symbol' }, { ...cand('freestyle', '待', 'まつ', GOOD_GAZE_3, '少しだけ嬉しそう'), truth_type: 'Play' }] }
let reviewReply: any = { verdicts: [{ slot: 'main', kanji: '誠', pass: true, reason: 'ok' }, { slot: 'second', kanji: '灯', pass: true, reason: 'ok' }, { slot: 'freestyle', kanji: '待', pass: true, reason: 'ok' }] }

let gazeReply: unknown = 'not json at all'
let refillReply: unknown = { none: true }
let refillCalls = 0
let gazeCalls = 0
let gazeFail = false
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Replacement Prompt (v9') ? 'replace' : 'select'
  if (kind === 'replace') refillCalls++
  if (kind === 'gaze') { gazeCalls++; if (gazeFail) { res.writeHead(500); res.end('boom'); return } }
  if (kind === 'review') { const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: true, rule: null, reason: 'ok' })); reviewReply = { verdicts: items } }
  const reply = kind === 'review' ? reviewReply : kind === 'gaze' ? gazeReply : kind === 'replace' ? refillReply : modelReply
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
for (const k of ['ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO']) delete process.env[k]

const logs: string[] = []
const origLog = console.log
const run = async () => { logs.length = 0; console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }; try { return await runEngine(story, 'A', { context: fx.context }) } finally { console.log = origLog } }
const live = (r: Awaited<ReturnType<typeof run>>) => r.candidates.filter((c) => !c.eliminated)
const gazeOf = (r: Awaited<ReturnType<typeof run>>, k: string) => r.candidates.find((c) => c.kanji === k)?.one_line_gaze

try {
  check('the test story is 4,105 characters (Japanese, father, 目上, 偲ぶ)', [...story].length === 4105 && fx.context.occasion === 'memorial' && fx.context.relationship === 'parent_father')
  check('the fake model\'s lines for 誠 and 灯 fail the gaze shape; the third passes', gazeIssues(BAD_GAZE_1, 'ja').length > 0 && gazeIssues(BAD_GAZE_2, 'ja').length > 0 && gazeIssues(GOOD_GAZE_3, 'ja').length === 0)

  // 1. the rewrite is not usable (the model answers with rubbish): all three cards stay, with their original lines
  const r1 = await run()
  check('(1) long remembrance story, gaze rewrite unusable: THREE live cards (誠 main, 灯 second, 待 freestyle), the contract validates', live(r1).length === 3 && live(r1).map((c) => c.kanji).join() === '誠,灯,待' && validateEngineResult(r1).length === 0, JSON.stringify(live(r1).map((c) => [c.slot, c.kanji])) + validateEngineResult(r1).join('; '))
  check('(1) …one rewrite call was made and the original lines are kept', gazeCalls === 1 && gazeOf(r1, '誠') === BAD_GAZE_1 && gazeOf(r1, '灯') === BAD_GAZE_2)

  // 2. the rewrite call itself fails (HTTP 500): same, three cards
  gazeCalls = 0; gazeFail = true
  const r2 = await run()
  check('(2) gaze rewrite call fails outright: still THREE live cards, lines unchanged', live(r2).length === 3 && gazeOf(r2, '誠') === BAD_GAZE_1, JSON.stringify(live(r2).map((c) => c.kanji)))
  gazeFail = false

  // 3. the better of the two lines: 誠 gets a rewrite that passes (taken); 灯 gets one that still fails but with FEWER problems than the original (taken); a worse one would be ignored
  const GOOD_1 = '言葉にせず、帰省のたびに玄関の灯りをつけて待っていた父。'
  const STILL_BAD_2 = '帰省のたびに、何も言わず玄関の灯りをつけて待ってくれた。' // still a verb ending, but a sentence about him: not worse than the original
  gazeCalls = 0
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: GOOD_1 }, { kanji: '灯', one_line_gaze: STILL_BAD_2 }] }
  const r3 = await run()
  check('(3) a rewrite that passes replaces the line; no card is lost', live(r3).length === 3 && gazeOf(r3, '誠') === GOOD_1 && gazeIssues(GOOD_1, 'ja').length === 0)
  check('(3) a rewrite that is not worse than the original never costs the card (the better of the two lines is kept)', gazeOf(r3, '灯') === BAD_GAZE_2 || gazeIssues(gazeOf(r3, '灯') ?? '', 'ja').length <= gazeIssues(BAD_GAZE_2, 'ja').length)
  const WORSE = '『ありがとう』という言葉の中に、想いが詰まっていた。' // two problems? (feeling subject + verb ending)
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: WORSE }] }
  const r4 = await run()
  check('(4) a rewrite that fails MORE checks than the original is ignored: the original line stays, three cards', live(r4).length === 3 && gazeIssues(WORSE, 'ja').length >= gazeIssues(BAD_GAZE_1, 'ja').length && (gazeOf(r4, '誠') === BAD_GAZE_1 || gazeIssues(gazeOf(r4, '誠') ?? '', 'ja').length < gazeIssues(BAD_GAZE_1, 'ja').length))

  // 5. REFILL (spec step 8, changed 2026-11-01): the free pick the model chose (喜) is blocked in remembrance → ONE refill call, a quieter free pick, THREE cards
  const blockedFree = { ...modelReply, freestyle_kanji: '喜', candidates: [modelReply.candidates[0], modelReply.candidates[1], { ...cand('freestyle', '喜', 'よろこぶ', GOOD_GAZE_3, '少しだけ嬉しそう'), truth_type: 'Play' }] }
  const saved = modelReply
  Object.assign(modelReply, blockedFree)
  gazeReply = 'not json at all'
  refillReply = { candidates: [{ ...cand('freestyle', '待', 'まつ', GOOD_GAZE_3, '少しだけ嬉しそう'), truth_type: 'Play' }] }
  refillCalls = 0
  const r5 = await run()
  const log5 = logs.find((l) => l.startsWith('[ichirei-cards]')) ?? ''
  check('(5) remembrance story whose free pick (喜) is blocked: THREE live cards after the refill (誠, 灯, and the replacement free pick 待), contract-valid', live(r5).length === 3 && live(r5).map((c) => c.kanji).join() === '誠,灯,待' && validateEngineResult(r5).length === 0, JSON.stringify(r5.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])) + validateEngineResult(r5).join('; '))
  check('(5) …with exactly ONE refill call, and the blocked 喜 is not shown', refillCalls === 1 && !live(r5).some((c) => c.kanji === '喜'), String(refillCalls))
  check('(5) …and the [ichirei-cards] line logs the refill: asked [freestyle], filled [freestyle], nothing rejected', log5.includes('"refill":{"asked":["freestyle"],"filled":["freestyle"],"rejected":[]') && log5.includes('"freestyle":1') && log5.includes('palette: blocked_occasion'), log5)
  // the refill finds nothing: the sender sees what is left (two cards), no error
  refillReply = { none: true }
  refillCalls = 0
  const r6 = await run()
  const log6 = logs.find((l) => l.startsWith('[ichirei-cards]')) ?? ''
  check('(6) …when the refill cannot fill the slot ("none"): the two cards that stand are shown, status sufficient, no error, ONE refill call at most', r6.status === 'sufficient' && live(r6).map((c) => c.kanji).join() === '誠,灯' && refillCalls === 1 && validateEngineResult(r6).length === 0 && log6.includes('"filled":[]') && log6.includes('"rejected":[{"slot":"freestyle"'), log6)
  // the refill offers another blocked character: rejected by the same referee, still no error and still one call
  refillReply = { candidates: [{ ...cand('freestyle', '祝', 'いわう', GOOD_GAZE_3, '少しだけ嬉しそう'), truth_type: 'Play' }] }
  refillCalls = 0
  const r7 = await run()
  check('(7) …a refill that offers another blocked character is refused by the same rules: two cards, no error, ONE call', r7.status === 'sufficient' && live(r7).map((c) => c.kanji).join() === '誠,灯' && refillCalls === 1)
  // a second card the review removed is refilled in the SAME call as the free pick
  const noSecondFree = { ...modelReply, candidates: [modelReply.candidates[0], { ...modelReply.candidates[1], eliminated: true, eliminated_reason: 'review: dignity' }, modelReply.candidates[2]] }
  Object.assign(modelReply, noSecondFree)
  refillReply = { candidates: [{ ...cand('second', '守', 'まもる', GOOD_GAZE_3, '玄関の灯りをつけて'), truth_type: 'Private Symbol' }, { ...cand('freestyle', '待', 'まつ', GOOD_GAZE_3, '少しだけ嬉しそう'), truth_type: 'Play' }] }
  refillCalls = 0
  const r8 = await run()
  const log8 = logs.find((l) => l.startsWith('[ichirei-cards]')) ?? ''
  check('(8) a removed SECOND and a blocked FREE pick are refilled by the SAME single call: three cards', refillCalls === 1 && live(r8).length === 3 && live(r8).some((c) => c.kanji === '守') && live(r8).some((c) => c.kanji === '待') && log8.includes('"asked":["second","freestyle"]'), log8 + JSON.stringify(r8.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  Object.assign(modelReply, saved)

  // 4. the log line that tells a missing card from a dropped one
  const cardsLog = logs.find((l) => l.startsWith('[ichirei-cards]'))
  check('(5) every request logs one [ichirei-cards] line: story length, live cards per slot, and the reason of every removed card (codes only — no story text)', !!cardsLog && cardsLog.includes('"story_chars":4105') && cardsLog.includes('"main":1') && cardsLog.includes('"second":1') && cardsLog.includes('"freestyle":1') && !cardsLog.includes('帰省'), String(cardsLog))
} finally {
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll long-remembrance checks passed.')
process.exit(failures ? 1 : 0)
