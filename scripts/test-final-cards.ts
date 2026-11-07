// 2026-11-07 (part 5): a card is shown only when it is final — what the page was shown is what the result carries; the main and second calls run without extended thinking; a stalled call is asked
// again (the hedge); one log line says where the time went. A FAKE model: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-final-cards.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { cardPrompt } from '../engine/cards.ts'
import type { EngineResult } from '../engine/contract.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 900)}` : ''}`); if (!cond) failures++ }
const fx = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'memorial-story.json'), 'utf8'))

let STORY = '父は毎朝、私より先に起きて、車の窓の霜をお湯で溶かしてくれた。冬の朝は特に早くて、台所の湯気の向こうで、黙って新聞を読んでいた。電話ではいつも「そっちは寒いか」とだけ聞く人だ。' + '還暦の日には、何も言わずに、私の好きなケーキの箱を抱えて帰ってくるだろう。'
STORY += 'あ'.repeat(Math.max(0, 143 - [...STORY].length))
STORY = [...STORY].slice(0, 143).join('')

const GOOD = 'いつも、私より先に起きている人。'
const GOOD2 = 'そっと、湯気の向こうで待っている人。'
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string, truth = 'Essence') => ({ slot, kanji, inscription_form: null, reading, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const M1 = (g = GOOD) => cand('main', '誠', 'まこと', g, '車の窓の霜をお湯で溶かして', 'Turning Point')
const M2 = () => cand('main', '守', 'まもる', GOOD, '車の窓の霜', 'Role')
const S1 = () => cand('second', '灯', 'あかり', GOOD2, '台所の湯気の向こう', 'Private Symbol')
const S2 = () => cand('second', '待', 'まつ', GOOD2, '黙って新聞を読んで', 'Hidden Cost')
const F1 = () => cand('freestyle', '朝', 'あさ', GOOD, '電話ではいつも', 'Play')
const F2 = () => cand('freestyle', '箱', 'はこ', GOOD, 'ケーキの箱', 'Play')
const sel = (...c: any[]) => ({ suggest_memorial: false, status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: c, fallback_follow_up_question: 'あのとき、何がありましたか。' })

let mainReply: any = sel(M1(), M2())
let secondReply: any = sel(S1(), S2())
let freeReply: any = { candidates: [F1(), F2()] }
let gazeReply: any = { gazes: [] }
let vetoed = new Set<string>()
let mainDelays: number[] = [30] // by request: the first main request waits mainDelays[0], the next mainDelays[1] …
const counts: Record<string, number> = {}
const bodies: Record<string, any[]> = {}
let t0 = 0

const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const content = body.messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: any) => b.text).join('\n') : String(content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Free Pick Card Prompt') ? 'free' : prompt.includes('Replacement Prompt (v9') ? 'refill' : prompt.includes('* CARD: second.') ? 'second' : prompt.includes('* CARD: main.') ? 'main' : 'other'
  counts[kind] = (counts[kind] ?? 0) + 1
  ;(bodies[kind] ??= []).push({ thinking: body.thinking, at: Date.now() - t0 })
  let reply: unknown = {}
  let ms = 10
  if (kind === 'review') {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: !vetoed.has(m[2]), rule: vetoed.has(m[2]) ? 'dignity' : null, reason: vetoed.has(m[2]) ? 'could read as a negative trait' : 'ok' }))
    reply = { verdicts: items }
  } else if (kind === 'gaze') reply = gazeReply
  else if (kind === 'refill') reply = { none: true }
  else if (kind === 'main') { reply = mainReply; ms = mainDelays[Math.min(counts.main - 1, mainDelays.length - 1)] }
  else if (kind === 'second') { reply = secondReply; ms = 20 }
  else if (kind === 'free') reply = freeReply
  await new Promise((r) => setTimeout(r, ms))
  const text = JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 120 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE', 'ICHIREI_FREE_RETRY', 'ICHIREI_FREE_RUNNER_UP', 'ICHIREI_CARD_THINKING', 'ICHIREI_CARD_HEDGE_MS']) delete process.env[k]

const BIRTHDAY = { ...fx.context, occasion: 'birthday_milestone' }
const logs: string[] = []
const origLog = console.log
let mainInfos: { round: number; language: string; main: string; second: string | null }[] = []
let events: { at: number; cards: { slot: string; kanji: string; line: string }[] }[] = []
const run = async (ctx: any = BIRTHDAY): Promise<EngineResult> => {
  for (const k of Object.keys(counts)) counts[k] = 0
  for (const k of Object.keys(bodies)) delete bodies[k]
  logs.length = 0
  events = []
  mainInfos = []
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  t0 = Date.now()
  try {
    return await runEngine(STORY, 'A', { context: ctx, round: 1, exclude: [], onMain: (i) => mainInfos.push(i), onCard: (p) => { events.push({ at: Date.now() - t0, cards: p.candidates.filter((c) => !c.eliminated).map((c) => ({ slot: c.slot, kanji: c.kanji, line: c.one_line_gaze })) }) } })
  } finally { console.log = origLog }
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const reset = () => { mainReply = sel(M1(), M2()); secondReply = sel(S1(), S2()); freeReply = { candidates: [F1(), F2()] }; gazeReply = { gazes: [] }; vetoed = new Set(); mainDelays = [30]; delete process.env.ICHIREI_CARD_THINKING; delete process.env.ICHIREI_CARD_HEDGE_MS }
/** Every card shown at any moment is exactly the card of the final result (same slot, same character, same line). */
const shownIsFinal = (r: EngineResult): boolean => events.every((e) => e.cards.every((c) => { const f = live(r).find((x) => x.slot === c.slot); return !!f && f.kanji === c.kanji && f.one_line_gaze === c.line })) && !logs.some((l) => l.includes('card_changed_after_shown'))
const timing = () => { const l = logs.find((x) => x.startsWith('[ichirei-card-timing]')); return l ? JSON.parse(l.slice('[ichirei-card-timing] '.length)) : null }

try {
  // ---- (1) the ordinary run: every shown card is the final card -----------------------------------------------------------------------------------------------------------------------------
  reset()
  const r1 = await run()
  check('(1) two cards (本命 + 遊び字); each one the page was shown is, character and line, the card the result carries; nothing changed after it was shown', live(r1).length === 2 && events.length === 2 && shownIsFinal(r1), JSON.stringify(events))
  check('(1) the main character that stands is reported once for the owner\'s top 10 (round, language, main; second only in remembrance), and logged', mainInfos.length === 1 && mainInfos[0].main === '誠' && mainInfos[0].second === null && mainInfos[0].round === 1 && logs.some((l) => l.startsWith('[ichirei-engine] main_character')), JSON.stringify(mainInfos))

  // ---- (2) a line the last gate has to fix is fixed BEFORE the card is shown ------------------------------------------------------------------------------------------------------------------
  reset()
  mainReply = sel(M1('いつも、私より先に起きる。'), M2()) // ends on a verb: the old order showed this line, then the gate rewrote it
  const r2 = await run()
  const main2 = live(r2).find((c) => c.slot === 'main')
  check('(2) a main line that still fails the shape check after its first rewrite is mended before it is shown: the first card carries the mended line (ends on 人, not the verb) and it is the final line — nothing changes on screen', !!main2 && main2.one_line_gaze.endsWith('人') && !main2.one_line_gaze.endsWith('起きる。') && events[0].cards[0].line === main2.one_line_gaze && shownIsFinal(r2), JSON.stringify({ events: events[0], final: main2?.one_line_gaze }))

  // ---- (3) a rescued card: shown once, with its final line --------------------------------------------------------------------------------------------------------------------------------
  reset()
  vetoed = new Set(['誠'])
  const r3 = await run()
  check('(3) a main the review vetoes is never shown: the first card on screen is the runner-up (守), and it stays', events[0].cards[0].kanji === '守' && live(r3).find((c) => c.slot === 'main')?.kanji === '守' && shownIsFinal(r3), JSON.stringify(events))

  // ---- (4) no extended thinking on the main and second calls; the switch puts it back ----------------------------------------------------------------------------------------------------
  reset()
  await run()
  check('(4) the main and second calls are sent with thinking disabled (the 110 s case: thinking used the 6,000-token budget, the answer was cut off and the call repeated)', bodies.main?.[0].thinking?.type === 'disabled' && counts.main === 1 && !counts.second, JSON.stringify(bodies.main))
  await run(fx.context) // remembrance: the second (次点) call exists and is sent without thinking too
  check('(4) …and in remembrance the second call is also sent with thinking disabled (it is the only occasion with a second call)', bodies.second?.[0].thinking?.type === 'disabled' && counts.second === 1 && !counts.free, JSON.stringify(bodies.second))
  reset()
  process.env.ICHIREI_CARD_THINKING = 'on'
  await run()
  check('(4) ICHIREI_CARD_THINKING=on puts the model\'s own thinking back (no override on the request)', bodies.main?.[0].thinking === undefined)

  // ---- (5) a stalled call is hedged ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  reset()
  process.env.ICHIREI_CARD_HEDGE_MS = '150'
  mainDelays = [1500, 40] // the first main request stalls, the second answers quickly
  const r5 = await run()
  const tm = timing()
  const mainEntries = (tm?.calls ?? []).filter((c: any) => c.slot === 'main')
  check('(5) a main call that has not answered after the hedge time is asked again (no thinking); the faster answer wins: both cards are out long before the stalled call would have answered, and every shown card is final', counts.main === 2 && bodies.main[1].thinking?.type === 'disabled' && events[0].at < 800 && live(r5).length === 2 && shownIsFinal(r5), JSON.stringify({ counts, events: events.map((e) => e.at) }))
  check('(5) …the log says so: card_hedge, and the timing line names the second call as the winner', logs.some((l) => l.startsWith('[ichirei-engine] card_hedge') && l.includes('"slot":"main"')) && mainEntries.some((c: any) => c.hedge === 2 && c.won === true), JSON.stringify(mainEntries))
  reset()
  process.env.ICHIREI_CARD_HEDGE_MS = '0'
  mainDelays = [250]
  await run()
  check('(5) ICHIREI_CARD_HEDGE_MS=0 switches the hedge off (one main call)', counts.main === 1)
  reset()
  mainDelays = [250]
  await run()
  check('(5) a main call that answers in time is never asked twice (default hedge time 40 s)', counts.main === 1 && !counts.second)

  // ---- (6) the timing line --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  reset()
  await run()
  const t = timing()
  check('(6) one line says where the time went: every call with its model, ms, tries, tokens and stop reason; first and last card; review, refill and line-fix times; `slow` empty when the run took under 30 s', !!t && t.round === 1 && t.calls.length >= 3 && t.calls.every((c: any) => typeof c.ms === 'number' && typeof c.attempts === 'number' && 'stop_reason' in c && 'thinking_tokens' in c) && typeof t.first_card_ms === 'number' && typeof t.all_cards_ms === 'number' && typeof t.review_ms === 'number' && typeof t.refill_ms === 'number' && typeof t.gaze_ms === 'number' && Array.isArray(t.slow) && t.slow.length === 0 && t.total_ms < 30_000, JSON.stringify(t))
  check('(6) …it holds codes and numbers only — no story text', !JSON.stringify(t).includes('父') && !JSON.stringify(t).includes('霜'))

  // ---- (7) part 6: the recurring characters rule is in the main/second prompt, in ja / zh / en, and in the lexicon rules ---------------------------------------------------------------------------
  const six = ['誠', '常', '待', '信', '恩', '想']
  for (const lang of ['ja', 'zh', 'en']) {
    const base = readFileSync(join(process.cwd(), 'engine', `prompt.${lang}.md`), 'utf8')
    const full = cardPrompt(base, 'main')
    check(`(7) prompt.${lang}: the recurring-characters rule is there — the six characters, "only when THIS story's specific act makes it clearly the best", prefer the more specific one — and it reaches both the main and second call`, six.every((k) => base.includes(k)) && /Recurring characters rule/.test(base) && /clearly the best character for this person/.test(base) && /prefer the specific one/.test(base) && /RECURRING CHARACTERS/.test(full) && /RECURRING CHARACTERS/.test(cardPrompt(base, 'second')))
  }
  const lex = readFileSync(join(process.cwd(), 'engine', 'lexicon-prompt.md'), 'utf8')
  check('(7) the lexicon rules say it too (rule 11): the specific listed character when it fits as well', /RECURRING CHARACTERS/.test(lex) && six.every((k) => lex.includes(k)) && /choose the specific one/.test(lex))

  // ---- (8) part 7: the card line never adds a detail the story does not give (「迷わず」, a desk) -----------------------------------------------------------------------------------------------------
  reset()
  mainReply = sel(M1('迷わず、私より先に起きてくれる人。'), M2())
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '私より先に起きて、霜を溶かしてくれる人。' }] }
  const r8a = await run()
  const m8a = live(r8a).find((c) => c.slot === 'main')
  check('(8) a line with 「迷わず」 (the story never says it) is rewritten ONCE, with the added detail named in the reason, and the card is shown with the rewritten line — never with 「迷わず」', counts.gaze === 1 && m8a?.kanji === '誠' && !m8a.one_line_gaze.includes('迷わず') && events.every((e) => e.cards.every((c) => !c.line.includes('迷わず'))) && shownIsFinal(r8a), JSON.stringify({ gaze: counts.gaze, line: m8a?.one_line_gaze }))
  reset()
  mainReply = sel(M1('机で黙って待っていてくれる人。'), M2()) // a desk: the story has none
  gazeReply = { gazes: [] } // the rewrite brings nothing
  const r8b = await run()
  const m8b = live(r8b).find((c) => c.slot === 'main')
  check('(8) a line that still adds a detail after its one rewrite (a desk the story never mentions) sets the card aside: the runner-up (守) is the main, and the desk line was never on screen', m8b?.kanji === '守' && events.every((e) => e.cards.every((c) => !c.line.includes('机'))) && !live(r8b).some((c) => c.one_line_gaze.includes('机')) && shownIsFinal(r8b), JSON.stringify({ main: m8b?.kanji, events }))
  reset()
  const { inventedFacts, inventedWhy } = await import('../engine/gaze.ts')
  check('(8) the check is "in the line but not in the story": 「机」 is fine when the story has a desk; manner words, objects and family words are named in the reason; zh and en have their own lists', inventedFacts('机の前で待つ人。', '父は机の前にいた。', 'ja').length === 0 && inventedFacts('迷わず来る人。', '父は来た。', 'ja').join() === '迷わず' && inventedFacts('毫不猶豫地來的人', '他來了。', 'zh-Hant').length === 1 && inventedFacts('Someone who comes without hesitation.', 'He came.', 'en').length === 1 && /adds a detail the story does not give \(迷わず\)/.test(inventedWhy(['迷わず'])) && /about the sender or a relative/.test(inventedWhy(['娘'])))
} finally {
  console.log = origLog
  upstream.close()
}
if (failures > 0) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nAll final-card checks passed.')
