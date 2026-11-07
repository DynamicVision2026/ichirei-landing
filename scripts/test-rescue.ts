// v9.7: (1) a card the review rejects under a LINE rule (insult, dignity, truth, subject) gets its line rewritten ONCE with the reviewer's note and is checked again — every slot, not only refills;
// (2) the free pick's safety net: a second hedged pair when the first pair left no free card. A FAKE model: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-rescue.ts
import http from 'node:http'
import { runEngine } from '../engine/engine.ts'
import type { EngineResult } from '../engine/contract.ts'
import { lineRuleOf } from '../engine/cards.ts'
import { appearanceProblem } from '../engine/gaze.ts'
import { convertLineScript, lineLanguageProblem, simplifiedOnlyChars, toSimplified, toTraditional } from '../engine/script.ts'

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
process.env.ICHIREI_FREE_RUNNER_UP = 'off' // (the third step — a spare card from the main/second calls — is tested in test-free-three.ts; this suite is about the second pair)

const logs: string[] = []
const origLog = console.log
const run = async (ctx: object = { relationship: 'grandparent', direction: 'up', purpose: 'thanks' }, extra: { exclude?: string[]; round?: number } = {}): Promise<EngineResult> => {
  for (const k of Object.keys(kinds)) delete kinds[k]
  logs.length = 0
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { return await runEngine(STORY, 'A', { context: { language: 'ja', ...ctx } as never, ...extra }) } finally { console.log = origLog }
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const card = (r: EngineResult, slot: string) => live(r).find((c) => c.slot === slot)
const sum = (r: EngineResult) => ['main', 'second', 'freestyle'].map((sl) => card(r, sl)).filter(Boolean).map((c) => `${c!.slot}:${c!.kanji}`).join()
const cardsLine = () => JSON.parse((logs.find((l) => l.startsWith('[ichirei-cards]')) ?? '[ichirei-cards] {}').slice('[ichirei-cards] '.length))
const FREE_CAT = { candidates: [cand('freestyle', '猫', 'ねこ', '縁側でうたた寝ばかりの猫を、呆れて眺めていた人。', A.cat, 'Play'), cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }
const REWORDED = '縁側の日だまりで、猫と一緒に私の帰りを待っていた人。'

try {
  // ---- 1. the free pick 猫: rejected on `insult` for 「細い目」 (the reviewer says rewording would make it safe) → one rewrite → checked again → stands
  freeReplies = [{ candidates: [FREE_CAT.candidates[0]] }] // (one option only: the line rescue comes LAST since 2026-11-07 — while another candidate is left it is tried first)
  reviewer = (k, prompt) => (k === '猫' && prompt.includes('うたた寝ばかり') ? { pass: false, rule: 'insult', reason: 'mentions the narrowness of her eyes; rewording would make it safe' } : { pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [{ kanji: '猫', one_line_gaze: REWORDED }] }
  const a = await run()
  const cat = card(a, 'freestyle')
  check('(1) the free pick 猫 rejected on `insult` because of 「細い目」: the line is rewritten ONCE (with the reviewer\'s own note) and the card is checked again → 猫 stands with the new line, no second free pick needed', cat?.kanji === '猫' && cat.one_line_gaze === REWORDED && (kinds.gaze?.length ?? 0) === 1 && /insult/.test(kinds.gaze[0]) && /rewording would make it safe/.test(kinds.gaze[0]), `${sum(a)} | ${cat?.one_line_gaze} | gaze ${kinds.gaze?.length}`)
  check('(1) …logged as a line rescue (slot freestyle, rule insult, rewritten, saved) and the safety net was not needed', cardsLine().parallel?.line_rescue?.some((x: { slot: string; rule: string; rewritten: boolean; saved: boolean }) => x.slot === 'freestyle' && x.rule === 'insult' && x.rewritten && x.saved) && cardsLine().parallel?.free_retry?.asked === false, JSON.stringify(cardsLine().parallel?.line_rescue))

  // ---- 2. every slot: the MAIN card's line rejected under `dignity`
  freeReplies = [{ candidates: [cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  reviewer = (k, prompt) => (k === '誠' && prompt.includes('夜遅くまで灯り') ? { pass: false, rule: 'dignity', reason: 'reads as a verdict; reword' } : { pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '夜、廊下の灯りをつけて待っていてくれた人。' }] }
  freeReplies = [{ candidates: [cand('freestyle', '猫', 'ねこ', '縁側で、帰りを待っていた人。', A.cat, 'Play')] }]
  const b0 = await run()
  check('(2) 2026-11-07: while the main call has another candidate, the rejected 誠 is NOT rewritten first — the next candidate 守 stands at once (no rewrite, no refill: the speed fix)', card(b0, 'main')?.kanji === '守' && !kinds.gaze && !kinds.refill, `${sum(b0)} | gaze ${kinds.gaze?.length} refill ${kinds.refill?.length}`)
  main = sel(MAIN.candidates[0]) // the call offered one candidate only
  const b = await run()
  main = MAIN
  check('(2) EVERY slot, not only refills: with no other candidate left, the main 誠 rejected under `dignity` gets the one rewrite and stays the main card', card(b, 'main')?.kanji === '誠' && card(b, 'main')?.one_line_gaze.startsWith('夜、廊下') && cardsLine().parallel?.line_rescue?.some((x: { slot: string; rule: string; saved: boolean }) => x.slot === 'main' && x.rule === 'dignity' && x.saved), sum(b))

  // ---- 3. the rewrite does not help: the card goes, once — the runner-up, never a loop
  reviewer = (k) => (k === '誠' || k === '守' ? { pass: false, rule: 'truth', reason: 'claims something the story does not state' } : { pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '夜遅くまで、灯りをつけて待っていてくれた人。' }] }
  const c = await run()
  check('(3) a rejected card is rewritten at most ONCE (one rewrite per card, never a loop): both mains are rejected under `truth`, each gets its one rewrite after the list is used up — two rewrites at most', (kinds.gaze?.length ?? 0) <= 2 && (kinds.gaze?.length ?? 0) >= 1, `${sum(c)} | gaze ${kinds.gaze?.length}`)

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
  check('(5) both pairs fail → no free card is invented (never a third pair; the main card stands alone here because the spare and the refill are off/empty), free_retry won false', sum(g) === 'main:誠' && cardsLine().parallel?.free_retry?.won === false && (cardsLine().parallel?.calls ?? []).filter((x: { slot: string }) => x.slot === 'freestyle').length <= 4, `${sum(g)} | ${(cardsLine().parallel?.calls ?? []).filter((x: { slot: string }) => x.slot === 'freestyle').length}`)
  process.env.ICHIREI_FREE_RETRY = 'off'
  freeReplies = [{ none: true }, { candidates: [cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  const h = await run()
  delete process.env.ICHIREI_FREE_RETRY
  check('(5) ICHIREI_FREE_RETRY=off switches the safety net off (rollback)', sum(h) === 'main:誠' && cardsLine().parallel?.free_retry?.asked === false)
  // ---- 5b. (2026-11-05, Part 5) the 趣字 in EVERY round: round 2 / 3 use the same safety net
  reviewer = () => ({ pass: true, rule: null, reason: 'ok' })
  gazeReply = { gazes: [] }
  // round 2: 猫 and 水 were shown in round 1; the first pair offers only those (set aside by the referee), the second pair is asked once more and 灯火 stands
  freeReplies = [
    { candidates: [cand('freestyle', '猫', 'ねこ', '縁側でうたた寝ばかりの猫を、呆れて眺めていた人。', A.cat, 'Play'), cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] },
    { candidates: [cand('freestyle', '朝', 'あさ', '毎朝、猫の水を替えてからお弁当を詰めてくれた人。', A.water, 'Play')] },
  ]
  const r2 = await run(undefined, { exclude: ['猫', '水'], round: 2 })
  const ask2b = (kinds.free ?? []).find((p) => p.includes('SECOND ASK')) ?? ''
  const retryLog = logs.find((l) => l.includes('free_retry')) ?? ''
  check('(5b) round 2: the first pair offers only characters already shown → a second hedged pair is asked once, told to avoid every character already shown, and the 趣字 is filled', sum(r2).includes('freestyle:朝') && cardsLine().parallel?.free_retry?.asked === true && cardsLine().parallel?.free_retry?.won === true && ask2b.includes('猫') && ask2b.includes('水'), `${sum(r2)} | ${JSON.stringify(cardsLine().parallel?.free_retry)}`)
  check('(5b) …the log carries the round and the reason: free_retry {"round":2,"why":"all_set_aside",…}', /free_retry/.test(retryLog) && retryLog.includes('"round":2') && retryLog.includes('all_set_aside'), retryLog)
  // round 3: nothing at all comes back from the first pair → why no_candidates, round 3
  freeReplies = [{ none: true }, { candidates: [cand('freestyle', '朝', 'あさ', '毎朝、猫の水を替えてからお弁当を詰めてくれた人。', A.water, 'Play')] }]
  const r3 = await run(undefined, { exclude: ['猫', '水', '灯', '待'], round: 3 })
  check('(5b) round 3: an empty first pair → the second pair fills the 趣字; log why no_candidates, round 3', sum(r3).includes('freestyle:朝') && (logs.find((l) => l.includes('free_retry')) ?? '').includes('"round":3') && (logs.find((l) => l.includes('free_retry')) ?? '').includes('no_candidates'))
  // the main cards never wait for it: the main and second are on screen (onCard) before the second free pair is even asked
  const order: string[] = []
  freeReplies = [{ none: true }, { candidates: [cand('freestyle', '朝', 'あさ', '毎朝、猫の水を替えてからお弁当を詰めてくれた人。', A.water, 'Play')] }]
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { await runEngine(STORY, 'A', { context: { language: 'ja', relationship: 'grandparent', direction: 'up', purpose: 'thanks' } as never, exclude: ['猫', '水'], round: 2, onCard: (partial) => { order.push(live(partial).map((c) => c.slot).join('+')) } }) } finally { console.log = origLog }
  check('(5b) the main and second cards are shown before the 趣字 (they never wait for the safety net)', order.length >= 2 && !order[0].includes('freestyle') && order.at(-1)!.includes('freestyle'), JSON.stringify(order))
  // memorial: still no free pick in any round
  const m2 = await run({ relationship: 'grandparent', direction: 'up', purpose: 'memorial', occasion: 'memorial' }, { exclude: ['猫'], round: 2 })
  check('(5b) remembrance (偲ぶ): still no 趣字 in round 2 and no safety net', !sum(m2).includes('freestyle') && cardsLine().parallel?.free_retry?.asked === false)

  // ---- 5c. (2026-11-05, Part 1) every card line is in the page's language and script — checked in code, mended in code when only the Chinese script is wrong
  reviewer = () => ({ pass: true, rule: null, reason: 'ok' })
  freeReplies = [{ none: true }, { none: true }]
  const ZH = { relationship: 'grandparent', direction: 'up', purpose: 'thanks', language: 'zh-Hant' }
  const zhMain = (line: string) => sel(cand('main', '誠', 'chéng', line, A.lamp, 'Turning Point'), cand('main', '守', 'shǒu', '每天早上替我裝好便當的人。', A.water))
  const zhFree = (line: string) => [{ candidates: [cand('freestyle', '灯', 'dēng', line, A.cat, 'Play')] }, { none: true }]
  // 1. a Simplified line on a Traditional page is converted (no model call for it)
  main = zhMain('夜里一直给我留着灯的人。'); freeReplies = zhFree('直到我睡著都替我留著走廊燈的人。'); gazeReply = { gazes: [] }
  const z1 = await run(ZH)
  check('(5c) zh-Hant page: a Simplified line (夜里一直给我留着灯的人) is CONVERTED in code (OpenCC) — the card shows Traditional, and no rewrite call was spent', card(z1, 'main')?.one_line_gaze === '夜裡一直給我留著燈的人。' && !kinds.gaze && cardsLine().parallel?.language?.some((x: { slot: string; how: string }) => x.slot === 'main' && x.how === 'converted'), `${card(z1, 'main')?.one_line_gaze} | gaze ${kinds.gaze?.length}`)
  // 2. a Japanese line on a Traditional page is rewritten ONCE in the right language
  main = zhMain('夜里一直给我留着灯的人。'); freeReplies = zhFree('眠るまで廊下の灯りをつけていてくれた人。'); gazeReply = { gazes: [{ kanji: '灯', one_line_gaze: '直到我睡著都替我留著走廊燈的人。' }] }
  const z2 = await run(ZH)
  check('(5c) zh-Hant page: a JAPANESE line (眠るまで…) is rewritten ONCE in Traditional Chinese, and the rewritten line stands', card(z2, 'freestyle')?.one_line_gaze === '直到我睡著都替我留著走廊燈的人。' && (kinds.gaze ?? []).length === 1 && cardsLine().parallel?.language?.some((x: { slot: string; how: string; code: string }) => x.slot === 'freestyle' && x.how === 'rewritten' && x.code === 'kana'), `${card(z2, 'freestyle')?.one_line_gaze} | gaze ${kinds.gaze?.length}`)
  // 3. the rewrite is Japanese again → the card is dropped (never shown)
  main = zhMain('夜里一直给我留着灯的人。'); freeReplies = zhFree('眠るまで廊下の灯りをつけていてくれた人。'); gazeReply = { gazes: [{ kanji: '灯', one_line_gaze: 'まだ廊下の灯りをつけていてくれた人。' }] }
  const z3 = await run(ZH)
  const lines3 = live(z3).map((c) => c.one_line_gaze)
  check('(5c) …and when the rewrite is still Japanese the card is DROPPED — no Japanese line is ever shown on a Traditional page (the spare or nothing stands in the slot)', !lines3.some((l) => /[ぁ-んァ-ン]/.test(l)) && card(z3, 'freestyle')?.kanji !== '灯' && cardsLine().parallel?.language?.some((x: { slot: string; how: string }) => x.slot === 'freestyle' && x.how === 'dropped'), JSON.stringify(lines3))
  // 4. a Traditional line passes untouched; the ja page needs kana; the en page tolerates CJK only inside quotation marks
  main = zhMain('夜裡一直給我留著燈的人。'); freeReplies = zhFree('直到我睡著都替我留著走廊燈的人。'); gazeReply = { gazes: [] }
  const z4 = await run(ZH)
  check('(5c) zh-Hant page: a Traditional line passes untouched (no conversion, no rewrite)', card(z4, 'main')?.one_line_gaze === '夜裡一直給我留著燈的人。' && !kinds.gaze && !cardsLine().parallel?.language?.length)
  main = sel(cand('main', '誠', 'まこと', '夜遅くまで灯をともして待っていてくれた人。', A.lamp, 'Turning Point'), cand('main', '守', 'まもる', '毎朝、私の弁当を詰めてくれた人。', A.water)); second = SECOND; freeReplies = [{ none: true }, { none: true }]; gazeReply = { gazes: [] }
  const j1 = await run()
  check('(5c) ja page: a line with kana passes untouched', card(j1, 'main')?.one_line_gaze.startsWith('夜遅くまで') === true && !kinds.gaze && !(cardsLine().parallel?.language?.length ?? 0))
  main = sel(cand('main', '誠', 'まこと', '夜遅くまで待っていた祖母', A.lamp, 'Turning Point'), cand('main', '守', 'まもる', '毎朝、私の弁当を詰めてくれた人。', A.water))
  gazeReply = { gazes: [] }
  const j2 = await run(undefined)
  check('(5c) ja page: a line with kana passes (「夜遅くまで待っていた祖母」 has kana in 〜まで/〜ていた), and the check is not tripped by ordinary Japanese', !!card(j2, 'main'))
  main = sel(cand('main', '誠', 'まこと', '深夜待機祖母', A.lamp, 'Turning Point'), cand('main', '守', 'まもる', '毎朝、私の弁当を詰めてくれた人。', A.water))
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '夜遅くまで私を待っていてくれた祖母。' }] }
  const j3 = await run(undefined)
  check('(5c) ja page: a line with NO kana at all (深夜待機祖母 is kanji only) is rewritten once', lineLanguageProblem('深夜待機祖母', 'ja') !== null && card(j3, 'main')?.one_line_gaze === '夜遅くまで私を待っていてくれた祖母。', `${card(j3, 'main')?.one_line_gaze}`)
  check('(5c) unit: the en page rejects CJK outside quotation marks and accepts it inside them; the zh-Hans page converts Traditional-only characters; kana is refused on both Chinese pages', lineLanguageProblem('Someone who fixed my 自転車', 'en')?.code === 'cjk' && lineLanguageProblem('Someone who said 「ただいま」 every day', 'en') === null && lineLanguageProblem('Someone who fixed the old bike', 'en') === null && convertLineScript('夜裡一直給我留著燈的人', 'zh-Hans') === '夜里一直给我留着灯的人' && lineLanguageProblem('眠るまで待っていた人', 'zh-Hans')?.code === 'kana' && lineLanguageProblem('眠るまで待っていた人', 'zh-Hant')?.code === 'kana')
  check('(5c) unit: ordinary Traditional text with characters that also exist in Simplified (皇后, 范, 批准, 里長, 吃飯, 床) is NOT flagged; the Simplified-only ones are', lineLanguageProblem('替皇后和范先生批准了里長吃飯的人', 'zh-Hant') === null && simplifiedOnlyChars('忆旧车骑过').join('') === '忆旧车骑过' && simplifiedOnlyChars('憶舊車騎過').length === 0 && toTraditional('软件里的旧车') === '軟體裡的舊車' && toSimplified('軟體裡的舊車') === '软件里的旧车')
  main = MAIN; second = SECOND

  // ---- 6. a line that remarks on the body or looks goes to the line rewrite BEFORE the review
  check('(6) the appearance check: 「いつも細い目でどこかを追っている人」, 「目が細い人」, 「丸い顔の母」, 「背が高い人」 are caught; 「目を合わせてくれた人」, 「大きな背中で待っていた人」, 「高い目標を持つ人」 are not; en and zh too', ['いつも細い目でどこかを追っている人。', '目が細い人。', '丸い顔の母。', '背が高い人。'].every((t) => appearanceProblem(t, 'ja') !== null) && ['目を合わせてくれた人。', '大きな背中で待っていた人。', '高い目標を持つ人。'].every((t) => appearanceProblem(t, 'ja') === null) && appearanceProblem('a tall man with narrow eyes', 'en') !== null && appearanceProblem('Someone who waits at the door', 'en') === null && appearanceProblem('眼睛小小的人', 'zh-Hant') !== null && appearanceProblem('總是等門的人', 'zh-Hant') === null)
  reviewer = () => ({ pass: true, rule: null, reason: 'ok' })
  freeReplies = [{ candidates: [cand('freestyle', '猫', 'ねこ', 'いつも細い目でどこかを追っている人。', A.cat, 'Play'), cand('freestyle', '水', 'みず', '毎朝、猫の水を替えてくれた人。', A.water, 'Play')] }]
  gazeReply = { gazes: [{ kanji: '猫', one_line_gaze: '縁側の日だまりで、猫と一緒に私の帰りを待っていた人。' }] }
  const n = await run()
  const catCard = card(n, 'freestyle')
  check('(6) the free pick 猫 whose line said 「いつも細い目でどこかを追っている人」: the line is rewritten ONCE before the review (the reviewer never sees 「細い目」), and the card stands with the new line', catCard?.kanji === '猫' && !appearanceProblem(catCard.one_line_gaze, 'ja') && (kinds.gaze?.length ?? 0) === 1 && !(kinds.review ?? []).some((p) => p.includes('いつも細い目でどこかを追っている人')) && cardsLine().parallel?.looks_rewritten?.some((x: { slot: string; rewritten: boolean }) => x.slot === 'freestyle' && x.rewritten), `${sum(n)} | ${catCard?.one_line_gaze} | gaze ${kinds.gaze?.length}`)
  gazeReply = { gazes: [] }
  const n2 = await run()
  check('(6) when no usable rewrite comes back the card is not lost for it: it goes on (the shape check after the review asks once more), never an error', n2.status === 'sufficient' && live(n2).length >= 2)
  const m = await run({ relationship: 'grandparent', direction: 'up', purpose: 'memorial' })
  check('(5) remembrance has no free pick, so no safety net either', !kinds.free && cardsLine().parallel?.free_retry?.asked === false && !sum(m).includes('freestyle'), sum(m))
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll rescue checks passed.')
process.exit(failures ? 1 : 0)
