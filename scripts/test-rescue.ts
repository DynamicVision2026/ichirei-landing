// v9.7: (1) a card the review rejects under a LINE rule (insult, dignity, truth, subject) gets its line rewritten ONCE with the reviewer's note and is checked again — every slot, not only refills;
// (2) the free pick's safety net: a second hedged pair when the first pair left no free card. A FAKE model: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-rescue.ts
import http from 'node:http'
import { runEngine } from '../engine/engine.ts'
import type { EngineResult } from '../engine/contract.ts'
import { lineRuleOf } from '../engine/cards.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`); if (!cond) failures++ }

check('(0) the line rules are insult, dignity, truth and subject; a rule about the character (register, palette, memorial …) is not one', ['insult', 'dignity', 'truth', 'subject'].every((r) => lineRuleOf(`review: ${r}: x`) === r) && lineRuleOf('review: register: x') === null && lineRuleOf('review: memorial: x') === null && lineRuleOf('palette: hard block') === null && lineRuleOf(null) === null)

const STORY = '祖母の飼っていた猫は、いつも縁側の日だまりで細い目をして、私が帰るのを待っていた。祖母は毎朝、猫の水を替えてから私の弁当を詰めてくれた。祖母は夜、私が眠るまで廊下の灯りをつけていてくれた。'
const A = { cat: '縁側の日だまりで細い目をして、私が帰るのを待っていた', water: '祖母は毎朝、猫の水を替えてから私の弁当を詰めてくれた', lamp: '祖母は夜、私が眠るまで廊下の灯りをつけていてくれた' }
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string, truth = 'Essence') => ({ slot, kanji, inscription_form: null, reading, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const sel = (...c: unknown[]) => ({ suggest_memorial: false, status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: c, fallback_follow_up_question: 'あのとき、何がありましたか。' })
const MAIN = sel(cand('main', '誠', 'まこと', 'いつも、夜遅くまで灯りをつけて待っていてくれた人。', A.lamp, 'Turning Point'), cand('main', '守', 'まもる', '毎朝、私の弁当を詰めてくれた人。', A.water))
const SECOND = sel(cand('second', '灯', 'あかり', '眠るまで廊下の灯りをつけていてくれた人。', A.lamp, 'Private Symbol'), cand('second', '待', 'まつ', '帰りを待っていてくれた人。', A.cat))
type Rev = (kanji: string, prompt: string) => { pass: boolean; rule: string | null; reason: string }
let freeReplies: unknown[] = [] // by ask: the 1st pair answers freeReplies[0], the 2nd pair (the prompt says SECOND ASK) freeReplies[1]
let main: unknown = MAIN
let second: unknown = SECOND
let reviewer: Rev = () => ({ pass: true, rule: null, reason: 'ok' })
let gazeReply: unknown = { gazes: [] }
const kinds: Record<string, string[]> = {}
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const content = JSON.parse(raw).messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: { text: string }) => b.text).join('\n') : String(content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Free Pick Card Prompt') ? 'free' : prompt.includes('Replacement Prompt (v9') ? 'refill' : prompt.includes('* CARD: second.') ? 'second' : prompt.includes('* CARD: main.') ? 'main' : 'other'
  ;(kinds[kind] ??= []).push(prompt)
  let reply: unknown
  if (kind === 'review') reply = { verdicts: [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], ...reviewer(m[2], prompt) })) }
  else if (kind === 'free') reply = freeReplies[prompt.includes('SECOND ASK') ? 1 : 0] ?? { none: true }
  else reply = kind === 'main' ? main : kind === 'second' ? second : kind === 'gaze' ? gazeReply : kind === 'refill' ? { none: true } : sel()
  const text = JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE', 'ICHIREI_FREE_RETRY']) delete process.env[k]

const logs: string[] = []
const origLog = console.log
const run = async (ctx: object = { relationship: 'grandparent', direction: 'up', purpose: 'thanks' }): Promise<EngineResult> => {
  for (const k of Object.keys(kinds)) delete kinds[k]
  logs.length = 0
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { return await runEngine(STORY, 'A', { context: { language: 'ja', ...ctx } as never }) } finally { console.log = origLog }
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const card = (r: EngineResult, slot: string) => live(r).find((c) => c.slot === slot)
const sum = (r: EngineResult) => ['main', 'second', 'freestyle'].map((sl) => card(r, sl)).filter(Boolean).map((c) => `${c!.slot}:${c!.kanji}`).join()
const cardsLine = () => JSON.parse((logs.find((l) => l.startsWith('[ichirei-cards]')) ?? '[ichirei-cards] {}').slice('[ichirei-cards] '.length))
const FREE_CAT = { candidates: [cand('freestyle', '猫', 'ねこ', '細い目で、縁側の日だまりにいる猫と待っていた人。', A.cat, 'Play'), cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }
const REWORDED = '縁側の日だまりで、猫と一緒に私の帰りを待っていた人。'

try {
  // ---- 1. the free pick 猫: rejected on `insult` for 「細い目」 (the reviewer says rewording would make it safe) → one rewrite → checked again → stands
  freeReplies = [FREE_CAT]
  reviewer = (k, prompt) => (k === '猫' && prompt.includes('細い目で、縁側') ? { pass: false, rule: 'insult', reason: 'mentions the narrowness of her eyes; rewording would make it safe' } : { pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [{ kanji: '猫', one_line_gaze: REWORDED }] }
  const a = await run()
  const cat = card(a, 'freestyle')
  check('(1) the free pick 猫 rejected on `insult` because of 「細い目」: the line is rewritten ONCE (with the reviewer\'s own note) and the card is checked again → 猫 stands with the new line, no second free pick needed', cat?.kanji === '猫' && cat.one_line_gaze === REWORDED && (kinds.gaze?.length ?? 0) === 1 && /insult/.test(kinds.gaze[0]) && /rewording would make it safe/.test(kinds.gaze[0]), `${sum(a)} | ${cat?.one_line_gaze} | gaze ${kinds.gaze?.length}`)
  check('(1) …logged as a line rescue (slot freestyle, rule insult, rewritten, saved) and the safety net was not needed', cardsLine().parallel?.line_rescue?.some((x: { slot: string; rule: string; rewritten: boolean; saved: boolean }) => x.slot === 'freestyle' && x.rule === 'insult' && x.rewritten && x.saved) && cardsLine().parallel?.free_retry?.asked === false, JSON.stringify(cardsLine().parallel?.line_rescue))

  // ---- 2. every slot: the MAIN card's line rejected under `dignity`
  freeReplies = [{ candidates: [cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  reviewer = (k, prompt) => (k === '誠' && prompt.includes('夜遅くまで灯り') ? { pass: false, rule: 'dignity', reason: 'reads as a verdict; reword' } : { pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '夜、廊下の灯りをつけて待っていてくれた人。' }] }
  const b = await run()
  check('(2) EVERY slot, not only refills: the main 誠 rejected under `dignity` gets the same one rewrite and stays the main card (the runner-up 守 is not used)', card(b, 'main')?.kanji === '誠' && card(b, 'main')?.one_line_gaze.startsWith('夜、廊下') && cardsLine().parallel?.line_rescue?.some((x: { slot: string; rule: string; saved: boolean }) => x.slot === 'main' && x.rule === 'dignity' && x.saved), sum(b))

  // ---- 3. the rewrite does not help: the card goes, once — the runner-up, never a loop
  reviewer = (k) => (k === '誠' ? { pass: false, rule: 'truth', reason: 'claims something the story does not state' } : { pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '夜遅くまで、灯りをつけて待っていてくれた人。' }] }
  const c = await run()
  check('(3) a rewrite that is rejected again is not tried again (one rewrite per card); the runner-up 守 becomes the main', card(c, 'main')?.kanji === '守' && (kinds.gaze?.length ?? 0) === 1, `${sum(c)} | gaze ${kinds.gaze?.length}`)

  // ---- 4. a rejection about the CHARACTER is not a line problem: no rewrite
  reviewer = (k) => (k === '誠' ? { pass: false, rule: 'register', reason: 'wrong register for this relationship' } : { pass: true, rule: null, reason: 'ok' })
  const d = await run()
  check('(4) a rejection under a rule about the character (register) gets no line rewrite: the runner-up takes over at once', card(d, 'main')?.kanji === '守' && !kinds.gaze, `${sum(d)} | gaze ${kinds.gaze?.length}`)

  // ---- 5. the free pick's safety net
  reviewer = () => ({ pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [] }
  freeReplies = [{ none: true }, { candidates: [cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  const e = await run()
  check('(5) the first pair of free-pick calls returns nothing → a SECOND hedged pair is asked once, and its card is shown (three cards); the log says why (no_candidates) and that it won', sum(e).includes('freestyle:水') && cardsLine().parallel?.free_retry?.asked === true && cardsLine().parallel.free_retry.why === 'no_candidates' && cardsLine().parallel.free_retry.won === true && cardsLine().parallel.calls.some((x: { slot: string; round?: number }) => x.slot === 'freestyle' && x.round === 2), JSON.stringify(cardsLine().parallel?.free_retry))
  freeReplies = [{ candidates: [cand('freestyle', '猫', 'ねこ', '細い目の猫と待っていた人。', A.cat, 'Play')] }, { candidates: [cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  reviewer = (k) => (k === '猫' ? { pass: false, rule: 'register', reason: 'not suited' } : { pass: true, rule: null, reason: 'ok' })
  const f = await run()
  const ask2 = (kinds.free ?? []).find((p) => p.includes('SECOND ASK')) ?? ''
  check('(5) the first pair offered 猫 and it was set aside (not a line problem) → the second pair is told which character was set aside and why (a code), and 水 stands; log why all_set_aside', sum(f).includes('freestyle:水') && cardsLine().parallel?.free_retry?.why === 'all_set_aside' && /"kanji": "猫"/.test(ask2) && /set aside \(review: register\)/.test(ask2), `${sum(f)} | ${ask2.slice(-300)}`)
  freeReplies = [{ none: true }, { none: true }]
  const g = await run()
  check('(5) both pairs fail → two cards, as before (never a third pair), free_retry won false', sum(g) === 'main:誠,second:灯' && cardsLine().parallel?.free_retry?.won === false && (cardsLine().parallel?.calls ?? []).filter((x: { slot: string }) => x.slot === 'freestyle').length <= 4, `${sum(g)} | ${(cardsLine().parallel?.calls ?? []).filter((x: { slot: string }) => x.slot === 'freestyle').length}`)
  process.env.ICHIREI_FREE_RETRY = 'off'
  freeReplies = [{ none: true }, { candidates: [cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  const h = await run()
  delete process.env.ICHIREI_FREE_RETRY
  check('(5) ICHIREI_FREE_RETRY=off switches the safety net off (rollback)', sum(h) === 'main:誠,second:灯' && cardsLine().parallel?.free_retry?.asked === false)
  const m = await run({ relationship: 'grandparent', direction: 'up', purpose: 'memorial' })
  check('(5) remembrance has no free pick, so no safety net either', !kinds.free && cardsLine().parallel?.free_retry?.asked === false && !sum(m).includes('freestyle'), sum(m))
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll rescue checks passed.')
process.exit(failures ? 1 : 0)
