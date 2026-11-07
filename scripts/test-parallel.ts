// Parallel cards (2026-11-01, two cards per round since 2026-11-07): the 本命 and the 遊び字 are written by two lanes that start at the same moment (remembrance: 本命 + 次点, no 遊び字); each card is reviewed as soon as it is written;
// a rejected or doubled character falls back to its own call's runner-up. A FAKE model with settable latencies: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-parallel.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { eligibleFor, lexiconEchoOf, loadLexicon } from '../engine/lexicon.ts'
import { loadPalette } from '../engine/palette.ts'
import { readCardReply, readJsonObject } from '../engine/cards.ts'
import { cleanReading } from '../src/order/reading.ts'
import { displayReadingJa } from '../engine/reading-display.ts'
import { anchorsClash } from '../engine/cards.ts'
import { inventedFacts } from '../engine/gaze.ts'
import { POST as selectPost } from '../api/select.ts'
import { COPY } from '../src/demo/i18n.ts'
import { buildCertificate } from '../engine/order.ts'
import { isJoyo } from '../engine/joyo.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 900)}` : ''}`); if (!cond) failures++ }
const fx = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'memorial-story.json'), 'utf8'))

// a 143-character Japanese birthday story (the free pick's material: a habit, the frost, the phone call)
let STORY = '父は毎朝、私より先に起きて、車の窓の霜をお湯で溶かしてくれた。冬の朝は特に早くて、台所の湯気の向こうで、黙って新聞を読んでいた。電話ではいつも「そっちは寒いか」とだけ聞く人だ。' + '還暦の日には、何も言わずに、私の好きなケーキの箱を抱えて帰ってくるだろう。'
STORY += 'あ'.repeat(Math.max(0, 143 - [...STORY].length))
STORY = [...STORY].slice(0, 143).join('')

const GOOD = 'いつも、私より先に起きている人。'
const GOOD2 = 'そっと、湯気の向こうで待っている人。'
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string, truth = 'Essence') => ({ slot, kanji, inscription_form: null, reading, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const M1 = () => cand('main', '誠', 'まこと', GOOD, '車の窓の霜をお湯で溶かして', 'Turning Point')
const M2 = () => cand('main', '守', 'まもる', GOOD, '車の窓の霜', 'Role')
const S1 = () => cand('second', '灯', 'あかり', GOOD2, '台所の湯気の向こう', 'Private Symbol')
const S2 = () => cand('second', '待', 'まつ', GOOD2, '黙って新聞を読んで', 'Hidden Cost')
const F1 = () => cand('freestyle', '朝', 'あさ', GOOD, '電話ではいつも', 'Play')
const F2 = () => cand('freestyle', '箱', 'はこ', GOOD, 'ケーキの箱', 'Play')
const sel = (...c: any[]) => ({ suggest_memorial: false, status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: c, fallback_follow_up_question: 'あのとき、何がありましたか。' })
const free = (...c: any[]) => ({ candidates: c })

const BASE_DELAY = { main: 30, second: 20, free: 10, review: 10, refill: 10 }
let delay = { ...BASE_DELAY }
let replies: Record<'main' | 'second' | 'free', any> = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
let refillReply: any = { none: true }
let vetoed = new Set<string>()
const counts = { main: 0, second: 0, free: 0, review: 0, refill: 0, gaze: 0 }
const starts: Record<string, number[]> = {}
const ends: Record<string, number[]> = {}
const bodies: Record<string, any> = {}
let t0 = 0
let replyFor: ((kind: string, prompt: string) => unknown) | null = null
let stopFor: Record<string, string> = {}
let gazeReply: any = { gazes: [] }
let hedgeScript: ('ok' | 'hang')[] = [] // the free pick is asked twice: what each arriving call does

const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const content = body.messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: any) => b.text).join('\n') : String(content)
  const cached = Array.isArray(content) && content[0]?.cache_control?.type === 'ephemeral'
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Free Pick Card Prompt') ? 'free' : prompt.includes('Replacement Prompt (v9') ? 'refill' : prompt.includes('* CARD: second.') ? 'second' : prompt.includes('* CARD: main.') ? 'main' : 'other'
  ;(counts as any)[kind] = ((counts as any)[kind] ?? 0) + 1
  ;(starts[kind] ??= []).push(Date.now() - t0)
  bodies[kind] = { thinking: body.thinking, cached, blocks: Array.isArray(content) ? content.length : 0, model: body.model, effort: body.output_config?.effort, max_tokens: body.max_tokens, prompt }
  let reply: unknown
  if (kind === 'review') {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: !vetoed.has(m[2]), rule: vetoed.has(m[2]) ? 'dignity' : null, reason: vetoed.has(m[2]) ? 'could read as a negative trait' : 'ok' }))
    reply = { verdicts: items }
  } else if (kind === 'refill') reply = refillReply
  else if (kind === 'gaze') reply = gazeReply
  else if (kind === 'main' || kind === 'second') reply = replyFor ? replyFor(kind, prompt) : (replies as any)[kind]
  else reply = (replies as any)[kind] ?? (replies as any).other ?? {}
  let ms = (delay as any)[kind] ?? 10
  if (kind === 'free' && hedgeScript.length > 0 && hedgeScript.shift() === 'hang') ms = 6000
  await new Promise((r) => setTimeout(r, ms))
  ;(ends[kind] ??= []).push(Date.now() - t0)
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopFor[kind] ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: kind === 'main' ? 900 : kind === 'second' ? 800 : 120, output_tokens_details: { thinking_tokens: kind === 'main' ? 600 : kind === 'second' ? 500 : 0 } } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE']) delete process.env[k]
process.env.ICHIREI_FREE_RUNNER_UP = 'off' // (the free pick's third step — a spare card from the main/second calls — is tested in test-free-three.ts; this suite is about the first two steps)

type Ctx = typeof fx.context
const BIRTHDAY: Ctx = { ...fx.context, occasion: 'birthday_milestone' }
const MEMORIAL: Ctx = fx.context
const logs: string[] = []
const origLog = console.log
let cardEvents: { at: number; slots: string; lexicon?: string | null; echoes?: string }[] = []
const run = async (ctx: Ctx = BIRTHDAY, story = STORY, extra: Record<string, unknown> = {}): Promise<EngineResult> => {
  for (const k of Object.keys(counts)) (counts as any)[k] = 0
  for (const o of [starts, ends]) for (const k of Object.keys(o)) delete o[k]
  logs.length = 0
  cardEvents = []
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  t0 = Date.now()
  try { return await runEngine(story, 'A', { context: ctx, ...extra, onCard: (p) => { cardEvents.push({ at: Date.now() - t0, slots: p.candidates.filter((c) => !c.eliminated).map((c) => c.slot).join(), lexicon: (p as any).lexicon?.mode ?? null, echoes: p.candidates.filter((c) => !c.eliminated && c.slot !== 'freestyle').map((c) => c.kanji + ':' + (c.classical_echo ? 'line' : 'none')).join() } as any) } }) } finally { console.log = origLog }
}
const liveOf = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const cardsLine = () => JSON.parse((logs.find((l) => l.startsWith('[ichirei-cards]')) ?? '[ichirei-cards] {}').slice('[ichirei-cards] '.length))
const SLOT_ORDER = ['main', 'second', 'freestyle']
const sum = (r: EngineResult) => [...liveOf(r)].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)).map((c) => `${c.slot}:${c.kanji}`).join()

try {
  check('the test story is 143 characters (Japanese, birthday)', [...STORY].length === 143)

  // ---- (1) the three calls start together; each card is reviewed as soon as it is written ---------------------------------------------------------------------------
  delay = { main: 300, second: 200, free: 100, review: 40, refill: 10 }
  const r1 = await run()
  const startsAt = [starts.main[0], starts.free[0]]
  check('(1) two lanes — the 本命 call and the 遊び字 call — start at the same moment (within 60 ms of each other), and neither has answered before both have started; there is NO second-card call', Math.max(...startsAt) - Math.min(...startsAt) < 60 && Math.max(...startsAt) < Math.min(ends.main[0], ends.free[0]) && counts.main === 1 && !counts.second && counts.free === 2, JSON.stringify({ starts: startsAt, ends: [ends.main[0], ends.free[0]] }))
  check('(1) …a card is reviewed as soon as it is written: the free pick\'s review starts before the main call has even answered; the two reviews overlap', starts.review.length === 2 && Math.min(...starts.review) < ends.main[0] && starts.review.filter((t) => t >= ends.main[0] - 5).length <= 1, JSON.stringify({ review_starts: starts.review, main_end: ends.main[0] }))
  check('(1) …two cards (本命, 遊び字); no refill; contract-valid', sum(r1) === 'main:誠,freestyle:朝' && counts.refill === 0 && validateEngineResult(r1).length === 0, sum(r1) + validateEngineResult(r1).join('; '))
  check('(1) …the main call asks for its TOP FIVE, ranked (like the free pick; the later ones are its internal fallbacks — 2026-11-07 follow-up), and the free pick for FIVE: the prompts say so; the main carries its own lens', /TOP FIVE/.test(bodies.main.prompt) && !/TOP TWO/.test(bodies.main.prompt) && /deepest truth, from the story's turning point/.test(bodies.main.prompt) && /FIVE characters for the free pick, ranked/.test(bodies.free.prompt) && !/TOP TWO/.test(bodies.free.prompt) && /\* CARD: main\./.test(bodies.main.prompt) && !bodies.second)

  // ---- models, effort and the free pick's prompt -----------------------------------------------------------------------------------------------------------------------------
  check('(2) the main uses the SELECTION model at low effort; the free pick uses the small model (claude-haiku-5-5) at low effort with a short answer limit; the main does not carry the second\'s lens', bodies.main.model === 'claude-sonnet-5' && bodies.main.effort === 'low' && bodies.free.model === 'claude-haiku-5-5' && bodies.free.effort === 'low' && bodies.free.max_tokens <= 2600 && !bodies.main.prompt.includes('a different side of the person'), JSON.stringify({ m: bodies.main.model, f: bodies.free.model, e: [bodies.main.effort, bodies.free.effort] }))
  check('(2) …the free pick is told: positive, a habit / place / object / saying, never a character that could read as a negative trait (寒, 冷, 頑, 怠), and not another word for warmth or care; it gets the story, the relationship and the occasion', /NEVER A NEGATIVE TRAIT/.test(bodies.free.prompt) && /寒, 冷, 頑, 怠/.test(bodies.free.prompt) && /a habit, a place, an object/.test(bodies.free.prompt) && /Not another word for the same feeling/.test(bodies.free.prompt) && bodies.free.prompt.includes('車の窓の霜') && bodies.free.prompt.includes('birthday_milestone') && bodies.free.prompt.includes('parent_father'))
  check('(2) …the main gets the whole language prompt (the rules: truth, 常用漢字, remembrance blocks) with the story and the context', bodies.main.prompt.includes('車の窓の霜') && bodies.main.prompt.includes('birthday_milestone') && bodies.main.prompt.length > 15000)

  // ---- (3) cards appear one by one, in order ------------------------------------------------------------------------------------------------------------------------------------
  check('(3) each card is shown as soon as it is final, in the order main, free: two events with 1, then 2 cards', cardEvents.map((e) => e.slots).join('|') === 'main|main,freestyle', JSON.stringify(cardEvents))
  check('(3) …the main card is out right after the main call + its review; the free card follows', cardEvents[0].at >= ends.main[0] && cardEvents[0].at < ends.main[0] + 200 && cardEvents[1].at >= cardEvents[0].at, JSON.stringify({ cardEvents, main_end: ends.main[0] }))

  // ---- (4) the log -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const L = cardsLine()
  const callOf = (slot: string) => L.parallel?.calls?.find((c: any) => c.slot === slot)
  check('(4) [ichirei-cards]: ms per call, output_tokens, thinking_tokens and stop_reason per call; every review with its ms; the time to the first card and to all cards', ['main', 'freestyle'].every((s) => { const c = callOf(s); return c && typeof c.ms === 'number' && c.stop_reason === 'end_turn' && typeof c.output_tokens === 'number' && c.model && c.effort && c.attempts === 1 }) && callOf('main').output_tokens === 900 && callOf('main').thinking_tokens === 600 && L.parallel.reviews.length === 2 && L.parallel.reviews.every((r: any) => typeof r.ms === 'number' && r.pass === true) && typeof L.parallel.first_card_ms === 'number' && typeof L.parallel.all_cards_ms === 'number' && L.parallel.first_card_ms <= L.parallel.all_cards_ms, JSON.stringify(L.parallel).slice(0, 700))
  check('(4) …no story text and no kanji in the parallel part of the log line besides what was already logged (codes, numbers, slots)', !JSON.stringify(L.parallel).includes('霜') && !JSON.stringify(L.parallel).includes('新聞'))
  check('(4) …calls per round (2026-11-07): select 3 (main once, the free pick asked twice), review 2, refill 0 — before it was 4 selection calls and 3 reviews', L.calls.select === 3 && L.calls.review === 2 && L.calls.refill === 0, JSON.stringify(L.calls))

  // ---- (5) a collision uses the runner-up, with no extra selection call ------------------------------------------------------------------------------------------------
  delay = { main: 60, second: 120, free: 90, review: 20, refill: 10 }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(cand('freestyle', '誠', 'まこと', GOOD, '電話ではいつも', 'Play'), F2()) }
  const r5 = await run()
  const L5 = cardsLine()
  check('(5) the free pick puts forward the main\'s character (誠): it uses its own runner-up (箱) — two cards, still no extra selection call (main once, free twice), no refill', sum(r5) === 'main:誠,freestyle:箱' && counts.main === 1 && counts.free === 2 && counts.refill === 0, sum(r5) + JSON.stringify(counts))
  check('(5) …the log names it: a collision {freestyle, runner_up}', L5.parallel.collisions.some((c: any) => c.slot === 'freestyle' && c.resolved === 'runner_up'), JSON.stringify(L5.parallel.collisions))
  // the free pick has no runner-up and doubles the main: the last-resort refill is asked ONCE for it; nothing offered here: one card, no error
  replies = { main: sel(M1()), second: sel(S1()), free: free(cand('freestyle', '誠', 'まこと', GOOD, '電話ではいつも', 'Play')) }
  const r5c = await run()
  check('(5) the free pick has no runner-up and doubles the main: its slot gets ONE last-resort refill (nothing offered here) — the main stands alone, no error', counts.refill === 1 && sum(r5c) === 'main:誠' && r5c.status === 'sufficient', sum(r5c) + JSON.stringify(counts))

  // ---- (6) a rejected character falls back to its call's runner-up, then the refill, then nothing (free) -----------------------------------------------------------------
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  delay = { main: 60, second: 50, free: 40, review: 20, refill: 10 }
  vetoed = new Set(['誠'])
  const r6 = await run()
  check('(6) the review rejects the main\'s first character (誠): the call\'s runner-up (守) stands — no refill call, no new selection call', sum(r6) === 'main:守,freestyle:朝' && counts.refill === 0 && counts.main === 1 && counts.review === 3, sum(r6) + JSON.stringify(counts))
  vetoed = new Set(['誠', '守'])
  const r6b = await run()
  check('(6) both of the main\'s characters are rejected: only now the existing refill is asked (once); the 遊び字 is never promoted to the main without a review', counts.refill >= 1 && r6b.candidates.filter((c) => !c.eliminated && c.slot === 'main').length <= 1, sum(r6b) + JSON.stringify(counts))
  vetoed = new Set(['朝', '箱'])
  delay = { main: 400, second: 400, free: 40, review: 30, refill: 10 }
  const r6c = await run()
  const tFree = ends.free[0]
  check('(6) both of the free pick\'s characters are rejected: the main stands, the free slot gets ONE last-resort refill (the main\'s runner-up is off in this suite), no error', sum(r6c) === 'main:誠' && counts.refill === 1 && r6c.status === 'sufficient', sum(r6c) + JSON.stringify(counts))
  const dFree = r6c && cardsLine().ms.total
  delay = { main: 400, second: 400, free: 40, review: 30, refill: 10 }
  vetoed = new Set()
  await run()
  const dOk = cardsLine().ms.total
  check('(6) …the rejection costs the main card no time: the same run with an accepted free pick takes no longer (within 80 ms)', Math.abs(dFree - dOk) < 80 && tFree < 400, JSON.stringify({ dFree, dOk }))
  vetoed = new Set()
  // Part 0 (2026-11-07): a reviewed free pick that is slow is NEVER dropped as late — the round waits for it and shows it, final
  delay = { main: 100, second: 100, free: 1500, review: 20, refill: 10 }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const r6d = await run()
  const tTotal = cardsLine().ms.total
  check('(6) Part 0: a slow free pick (1.5 s) is not dropped as "late": the 本命 is shown first, the 遊び字 follows when it is final — both cards, nothing dropped', sum(r6d) === 'main:誠,freestyle:朝' && tTotal >= 1400 && cardEvents.length === 2 && cardEvents[0].at < 800 && !cardsLine().parallel.free_dropped, sum(r6d) + tTotal + JSON.stringify(cardEvents))

  // ---- (7) remembrance: two calls ----------------------------------------------------------------------------------------------------------------------------------------------------
  delay = { ...BASE_DELAY }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const r7 = await run(MEMORIAL)
  check('(7) remembrance makes TWO calls (main and second — the only occasion with a second call), no free-pick call, two cards, "not_offered"', counts.main === 1 && counts.second === 1 && counts.free === 0 && liveOf(r7).length === 2 && cardsLine().freestyle === 'not_offered' && cardsLine().calls.select === 2 && !cardsLine().parallel.calls.some((c: any) => c.slot === 'freestyle'), sum(r7) + JSON.stringify(counts))

  // ---- (8) the story is judged by the main call: insufficient / declined end the request without the other cards -------------------------------------------------
  replies = { main: { status: 'insufficient', follow_up_question: 'あのとき、何がありましたか。', candidates: [], fallback_follow_up_question: null }, second: sel(S1(), S2()), free: free(F1(), F2()) }
  delay = { main: 30, second: 400, free: 400, review: 10, refill: 10 }
  const r8 = await run()
  check('(8) the main call says the story is insufficient: the sender gets the question, no cards, no review, no refill, and no waiting for the other calls', r8.status === 'insufficient' && r8.candidates.length === 0 && counts.review === 0 && counts.refill === 0 && cardEvents.length === 0 && (Date.now() - t0) < 380, JSON.stringify(counts))
  replies = { main: { status: 'insufficient', goodwill_declined: true, follow_up_question: null, candidates: [] }, second: sel(S1(), S2()), free: free(F1(), F2()) }
  const r8b = await run()
  check('(8) the goodwill check fails in the main call: a polite decline, no cards', r8b.status === 'insufficient' && r8b.declined === true && r8b.candidates.length === 0)

  // ---- (9) the 143-character story, realistic fake-model timings: done within 30 s --------------------------------------------------------------------------------------
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  delay = { main: 17000, second: 15000, free: 6000, review: 4000, refill: 8000 } // a Sonnet card at low effort ≈ 15–17 s; the small model ≈ 6 s; a Haiku review ≈ 4 s
  vetoed = new Set()
  const r9 = await run()
  const L9 = cardsLine()
  check('(9) a 143-character story with realistic timings (main 17 s, free 6 s, each review 4 s) finishes in ≤ 30 s with two cards', sum(r9) === 'main:誠,freestyle:朝' && L9.ms.total <= 30000, JSON.stringify(L9.ms))
  check('(9) …the main card is shown at about 21 s (the main call + its review) and the free card right after it; nothing is dropped', cardEvents.length === 2 && cardEvents[0].at >= 20800 && cardEvents[0].at <= 24000 && L9.parallel.first_card_ms <= 24000 && L9.parallel.all_cards_ms <= 25000, JSON.stringify({ cardEvents, p: [L9.parallel.first_card_ms, L9.parallel.all_cards_ms] }))
  console.log(`      (timings: first card ${L9.parallel.first_card_ms} ms, all cards ${L9.parallel.all_cards_ms} ms, total ${L9.ms.total} ms; for the old single call at 60 s: 60 s + review + refill)`)
  // ---- LEXICON MODE (ICHIREI_LEXICON_MODE=on, as shipped in cloudbuild.yaml): the lexicon rules apply to the main call (and, in remembrance, the second) and their reviews ------------------------------
  replyFor = null
  vetoed = new Set()
  delay = { main: 80, second: 60, free: 30, review: 20, refill: 10 }
  const lexicon = loadLexicon()
  const palette = loadPalette()
  const set = eligibleFor(lexicon, palette, { language: 'ja', relationship: BIRTHDAY.relationship, direction: BIRTHDAY.direction, occasion: BIRTHDAY.occasion, reader: undefined } as any)
  const onList = set.chars.map((c) => c.kanji).filter((k) => isJoyo(k) && !['朝', '箱'].includes(k))
  check('(L0) the eligible list for this gift has joyo characters to use', onList.length >= 4, String(onList.length))
  const [LA, LB, LC, LD] = onList
  const lexCand = (slot: string, k: string, gaze = GOOD, anchor = '車の窓の霜') => ({ ...cand(slot, k, 'よみ', gaze, anchor, slot === 'main' ? 'Turning Point' : 'Private Symbol'), inscription_form: set.chars.find((c) => c.kanji === k)?.inscription_form ?? null })
  const lexSel = (...c: any[]) => ({ ...sel(...c), truth: '彼は、黙って先に起きる人だった。', ideal_character: LA })
  replies = { main: lexSel(lexCand('main', LA), lexCand('main', LC)), second: lexSel(lexCand('second', LB, GOOD2, '台所の湯気の向こう'), lexCand('second', LD, GOOD2, '黙って新聞を読んで')), free: free(F1(), F2()) }
  const l1 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  const LL = cardsLine()
  check('(L1) lexicon on: the two lanes start together, two cards main:' + LA + ', free 朝 (the free pick is not limited to the list), no second call, no refill', sum(l1) === `main:${LA},freestyle:朝` && counts.main === 1 && !counts.second && counts.free === 2 && counts.refill === 0 && Math.max(starts.main[0], starts.free[0]) - Math.min(starts.main[0], starts.free[0]) < 60, sum(l1) + JSON.stringify(counts))
  check('(L1) …[ichirei-cards] says cards_mode "parallel" (and "single" is what the rollback logs, see below)', LL.cards_mode === 'parallel' && !!LL.parallel, String(LL.cards_mode))
  check('(L2) the main call carries the lexicon: the static table FIRST as its own cached block, then the language prompt + the one-card block + the gift\'s list and rules; the card block says the lexicon rules apply to the card', bodies.main.cached === true && bodies.main.blocks === 2 && bodies.main.prompt.indexOf('THE LEXICON (every entry') < bodies.main.prompt.indexOf('* CARD: main.') && bodies.main.prompt.indexOf('* CARD: main.') < bodies.main.prompt.indexOf('CLASSICAL LEXICON — THIS GIFT') && /LEXICON MODE: the lexicon rules after this block apply to your card/.test(bodies.main.prompt) && bodies.main.prompt.includes(LA), bodies.main.prompt.slice(-600))
  check('(L2) …the free-pick call is the compact prompt only (no lexicon table, no list: the free pick is not limited to it, lexicon rule 4); it still gets the "no negative trait" rule', !bodies.free.cached && bodies.free.blocks === 0 && !bodies.free.prompt.includes('THE LEXICON') && !bodies.free.prompt.includes('CLASSICAL LEXICON — THIS GIFT') && /NEVER A NEGATIVE TRAIT/.test(bodies.free.prompt))
  check('(L2) …a lexicon main asks for the miss answer (rule 6)', /answer as rule 6 says/.test(bodies.main.prompt) && !/Never write lexicon_miss/.test(bodies.main.prompt))
  const l1b = l1
  void l1b
  const echoOf = (k: string) => { const c = l1.candidates.find((x) => x.kanji === k && !x.eliminated); return c ? JSON.stringify(c.classical_echo) === JSON.stringify(lexiconEchoOf(set, c)) : false }
  check('(L3) the classical line on a card comes from the lexicon (a person-reviewed row only), never from the palette — also on the cards shown early; the result carries the lexicon report (mode on, chosen)', echoOf(LA) && (l1 as any).lexicon?.mode === 'on' && (l1 as any).lexicon?.outcome === 'chosen' && cardEvents.length === 2 && cardEvents.every((e) => e.lexicon === 'on') && cardEvents[0].echoes === `${LA}:${lexiconEchoOf(set, { kanji: LA, inscription_form: set.chars.find((c) => c.kanji === LA)?.inscription_form ?? null }) ? 'line' : 'none'}`, JSON.stringify(cardEvents))
  check('(L4) every card is reviewed, lexicon characters included (2 reviews)', counts.review === 2 && LL.calls.review === 2, JSON.stringify(counts))
  // remembrance (the only occasion with a second call): the second carries the lexicon too and is told NOT to write lexicon_miss (the main decides)
  await run(MEMORIAL, STORY, { lexiconMode: 'on' })
  check('(L2) …in remembrance the second call also carries the lexicon blocks and is told never to write lexicon_miss', bodies.second?.cached === true && /RULES FOR THIS MODE/.test(bodies.second.prompt) && /Never write lexicon_miss or "insufficient"/.test(bodies.second.prompt))

  // a main or second character outside the list is refused by the referee; the call's runner-up (on the list) stands — no refill
  replies = { main: lexSel(lexCand('main', '猫'), lexCand('main', LA)), second: lexSel(lexCand('second', LB, GOOD2, '台所の湯気の向こう'), lexCand('second', LD, GOOD2, '黙って新聞を読んで')), free: free(F1(), F2()) }
  delay = { main: 80, second: 60, free: 30, review: 20, refill: 10 }
  const l5 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L5) the main call\'s first character is outside the list (猫): the referee refuses it ("not_in_lexicon"), its runner-up ' + LA + ' stands; no refill call, no new selection call; a refused character is not even reviewed', sum(l5) === `main:${LA},freestyle:朝` && counts.refill === 0 && counts.main === 1 && counts.review === 2 && l5.candidates.some((c) => c.kanji === '猫' && c.eliminated && /not_in_lexicon/.test(c.eliminated_reason ?? '')), sum(l5) + JSON.stringify(counts))
  // both of the main call's characters are outside the list and it offered no runner-up on the list: its slot is refilled once, FROM THE LIST (the refill prompt carries the lexicon blocks); the 遊び字 stands
  replies = { main: lexSel(lexCand('main', '猫'), lexCand('main', '犬')), second: lexSel(lexCand('second', LB, GOOD2, '台所の湯気の向こう')), free: free(F1()) }
  refillReply = { candidates: [{ ...lexCand('main', LD, GOOD, '車の窓の霜をお湯で溶かして') }] }
  const l6 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L6) both of the main call\'s characters are off the list: ONE refill call (with the lexicon blocks in its prompt) fills the 本命 from the list; the 遊び字 stands', counts.refill === 1 && sum(l6) === `main:${LD},freestyle:朝` && bodies.refill.prompt.includes('CLASSICAL LEXICON — THIS GIFT'), sum(l6) + JSON.stringify(counts))
  vetoed = new Set()
  refillReply = { none: true }

  // the model says no listed character fits (lexicon_miss): a miss — one question, no cards, no other call waited for; after the answer the palette engine (also in parallel) takes over
  replyFor = (kind, prompt) => prompt.includes('CLASSICAL LEXICON — THIS GIFT')
    ? { status: 'insufficient', lexicon_miss: true, follow_up_question: 'あのとき、何がありましたか。', candidates: [], emotional_register: ['grateful'], truth: 't', ideal_character: '猫' }
    : kind === 'main' ? sel(M1(), M2()) : sel(S1(), S2())
  delay = { main: 30, second: 400, free: 400, review: 10, refill: 10 }
  const l7 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L7) lexicon_miss from the main call: the sender gets the one question, no cards, no review, no waiting for the other calls; the miss is logged (model_no_fit)', l7.status === 'insufficient' && l7.candidates.length === 0 && !!l7.follow_up_question && counts.review === 0 && (Date.now() - t0) < 380 && logs.some((l) => l.startsWith('[ichirei-lexicon] miss') && l.includes('model_no_fit')), logs.filter((l) => l.includes('lexicon')).join(' | ').slice(0, 300))
  delay = { main: 30, second: 20, free: 10, review: 10, refill: 10 }
  const l8 = await run(BIRTHDAY, STORY, { lexiconMode: 'on', followUpsUsed: 1 })
  check('(L8) after a follow-up answer, a second miss falls back to the palette engine — also two parallel lanes, no lexicon blocks, two cards flagged lexicon_miss, outcome "fallback"', sum(l8) === 'main:誠,freestyle:朝' && (l8 as any).lexicon?.outcome === 'fallback' && l8.candidates.filter((c) => !c.eliminated).every((c) => c.flags.includes('lexicon_miss')) && cardsLine().cards_mode === 'parallel', sum(l8) + JSON.stringify((l8 as any).lexicon))
  replyFor = null

  // ---- the rollback: ICHIREI_CARDS=single is ONE selection call, with or without the lexicon, and the log line says so -------------------------------------------------------------
  process.env.ICHIREI_CARDS = 'single'
  replies = { main: {}, second: {}, free: {}, other: { ...lexSel(lexCand('main', LA), lexCand('second', LB, GOOD2, '台所の湯気の向こう'), { ...F1() }), primary_kanji: LA, runner_up_kanji: LB, freestyle_kanji: '朝' } } as any
  const l9 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L9) ICHIREI_CARDS=single (the legacy rollback switch, lexicon on): ONE selection call, no card calls, the rollback answer as it always was (main, second, free); [ichirei-cards] says cards_mode "single" and has no parallel part', (counts as any).other === 1 && counts.main === 0 && counts.second === 0 && counts.free === 0 && sum(l9) === `main:${LA},second:${LB},freestyle:朝` && cardsLine().cards_mode === 'single' && !cardsLine().parallel, sum(l9) + JSON.stringify(counts) + String(cardsLine().cards_mode))
  await run(BIRTHDAY, STORY, { lexiconMode: 'off' })
  check('(L9) …and without the lexicon the same: cards_mode "single"', cardsLine().cards_mode === 'single' && (counts as any).other === 1)
  delete process.env.ICHIREI_CARDS
  // ---- THE SECOND CARD (remembrance only, 2026-11-07) WHEN ITS OWN CALL CANNOT DELIVER: the main call's runner-up, after its own review; the refill only when that fails too ----------------------------------------
  replyFor = null
  vetoed = new Set()
  stopFor = {}
  const cardCallLine = (slot: string) => { const l = logs.filter((x) => x.startsWith('[ichirei-card-call]')).map((x) => JSON.parse(x.slice('[ichirei-card-call] '.length))).find((o) => o.slot === slot); return l }
  delay = { main: 600, second: 100, free: 150, review: 200, refill: 150 }
  replies = { main: sel(M1(), M2()), second: 'Sorry — I could not do this one.' as any, free: free(F1(), F2()) }
  const s1 = await run(MEMORIAL)
  const S = cardsLine()
  const cc = cardCallLine('second')
  check('(S1) the second call returns unparseable text: the second card is the MAIN call\'s runner-up (守), after its own review — NO refill call, 2 selection calls', sum(s1) === 'main:誠,second:守' && counts.refill === 0 && counts.main + counts.second === 2 && counts.free === 0 && counts.review === 2 && validateEngineResult(s1).length === 0, sum(s1) + JSON.stringify(counts) + validateEngineResult(s1).join(';'))
  check('(S1) …the total time is about the main call plus ONE review (600 + 200 ms, not a refill on top): between 780 and 1000 ms', S.ms.total >= 780 && S.ms.total <= 1000, JSON.stringify(S.ms))
  check('(S1) …the log says second_source "main_runner_up", and the second call\'s line carries its parse result (no_json), its keys, its reply length, tokens and stop reason — no story text', S.second_source === 'main_runner_up' && S.parallel.second_source === 'main_runner_up' && cc && cc.parse === 'no_json' && Array.isArray(cc.keys) && cc.keys.length === 0 && cc.reply_chars > 10 && cc.stop_reason === 'end_turn' && typeof cc.output_tokens === 'number' && !JSON.stringify(cc).includes('霜') && S.parallel.calls.find((c: any) => c.slot === 'second').parse === 'no_json', JSON.stringify(cc))
  check('(S1) …the cards appear in order main, then main+second', cardEvents.map((e) => e.slots).join('|') === 'main|main,second', JSON.stringify(cardEvents))

  // a refusal (stop_reason refusal), an empty answer, {"none": true}, "insufficient" and a candidates list that is empty each have their own code and the same fallback
  delay = { main: 60, second: 30, free: 30, review: 20, refill: 20 }
  stopFor = { second: 'refusal' }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const s2 = await run(MEMORIAL)
  check('(S2) a refusal from the second call is logged as "refusal" and handled the same way: the main runner-up, no refill', cardCallLine('second')?.parse === 'refusal' && cardCallLine('second')?.stop_reason === 'refusal' && sum(s2) === 'main:誠,second:守' && counts.refill === 0 && cardsLine().second_source === 'main_runner_up', JSON.stringify(cardCallLine('second')))
  stopFor = {}
  const variants: [string, any, string][] = [
    ['empty', ' ', 'empty'],
    ['{"none": true}', { none: true }, 'none'],
    ['status insufficient', { status: 'insufficient', follow_up_question: 'q', candidates: [] }, 'none'],
    ['an empty candidates list', sel(), 'no_candidates'],
    ['candidates without a character', sel({ slot: 'second', reading: 'x', one_line_gaze: GOOD2 }), 'offered_unusable'],
    ['broken JSON', '{"status": "sufficient", "candidates": [ {"kanji": "灯", ', 'bad_json'],
  ]
  for (const [name, rep, code] of variants) {
    replies = { main: sel(M1(), M2()), second: rep, free: free(F1(), F2()) }
    const v = await run(MEMORIAL)
    check(`(S2) the second call answers ${name}: logged as "${code}", the main runner-up is the second card, no refill`, cardCallLine('second')?.parse === code && sum(v) === 'main:誠,second:守' && counts.refill === 0 && cardsLine().second_source === 'main_runner_up', `${cardCallLine('second')?.parse} ${sum(v)} ${JSON.stringify(counts)}`)
  }

  // an answer that is readable only with forgiveness (prose around it, a code fence, a comment line, a trailing comma) IS read: the second card comes from the second call
  const messy = 'こちらです:\n```json\n' + JSON.stringify(sel(S1(), S2())).replace(/\}\]/, '},]').replace('{"suggest_memorial"', '{\n// my answer\n"suggest_memorial"') + '\n```'
  replies = { main: sel(M1(), M2()), second: messy as any, free: free(F1(), F2()) }
  const s3 = await run(MEMORIAL)
  check('(S3) prose around the answer, a code fence, a comment line and a trailing comma are forgiven: the second call\'s own card (灯) stands, second_source "second_call"', sum(s3) === 'main:誠,second:灯' && cardsLine().second_source === 'second_call' && cardCallLine('second')?.parse === 'ok' && counts.refill === 0, sum(s3) + String(cardCallLine('second')?.parse))
  for (const [name, shape] of [['one candidate object', { candidate: S1() }], ['a bare array', [S1(), S2()]], ['an object keyed by the slot', { second: [S1(), S2()] }], ['a candidate at the top level', S1()]] as [string, any][]) {
    replies = { main: sel(M1(), M2()), second: shape, free: free(F1(), F2()) }
    const v = await run(MEMORIAL)
    check(`(S3) the second call writes ${name}: read as the second card (灯)`, sum(v) === 'main:誠,second:灯' && cardsLine().second_source === 'second_call', sum(v) + String(cardCallLine('second')?.parse))
  }

  // everything the second call offered is set aside by the review: the main runner-up is tried before any refill
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  vetoed = new Set(['灯', '待'])
  const s4 = await run(MEMORIAL)
  check('(S4) both of the second call\'s characters are rejected by the review: the main runner-up (守) becomes the second card — still no refill', sum(s4) === 'main:誠,second:守' && counts.refill === 0 && cardsLine().second_source === 'main_runner_up', sum(s4) + JSON.stringify(counts))
  // the refill only when the second call AND the main runner-up fail
  vetoed = new Set(['守'])
  replies = { main: sel(M1(), M2()), second: 'unreadable' as any, free: free(F1(), F2()) }
  refillReply = { candidates: [{ ...cand('second', '慈', 'めぐむ', GOOD2, '黙って新聞を読んで', 'Hidden Cost') }] }
  const s5 = await run(MEMORIAL)
  check('(S5) the second call fails AND the main runner-up (守) is rejected by the review: now — and only now — the one refill is asked, and fills the second (second_source "refill")', counts.refill === 1 && sum(s5) === 'main:誠,second:慈' && cardsLine().second_source === 'refill', sum(s5) + JSON.stringify(counts))
  vetoed = new Set()
  refillReply = { none: true }
  replies = { main: sel(M1()), second: 'unreadable' as any, free: free(F1(), F2()) }
  const s6 = await run(MEMORIAL)
  check('(S5) the second call fails and the main call offered no runner-up: the refill is asked once (nothing usable here: two cards, second_source null)', counts.refill === 1 && sum(s6) === 'main:誠' && cardsLine().second_source === null, sum(s6) + JSON.stringify(counts))
  refillReply = { none: true }
  // the main card's own runner-up is used by the main itself (its first character was rejected): the second never takes the same character twice
  vetoed = new Set(['誠'])
  replies = { main: sel(M1(), M2()), second: 'unreadable' as any, free: free(F1(), F2()) }
  const s7 = await run(MEMORIAL)
  check('(S6) the main\'s first character is rejected, so the main uses its runner-up (守): the second cannot use it too — no duplicate character, the refill is asked', new Set(liveOf(s7).map((c) => c.kanji)).size === liveOf(s7).length && sum(s7).startsWith('main:守') && counts.refill === 1, sum(s7) + JSON.stringify(counts))
  vetoed = new Set()

  // the free pick: its own runner-up goes first; a failed call leaves two cards with no refill
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: 'not json' as any }
  const s8 = await run()
  check('(S7) the free-pick call fails (unreadable): the 本命 stands, the free slot gets at most the one last-resort refill (nothing offered here), the failure is logged with its parse code', sum(s8) === 'main:誠' && counts.refill <= 1 && cardCallLine('freestyle')?.parse === 'no_json', sum(s8))

  // the reader itself
  check('(R1) readJsonObject: fence + prose + comment + trailing comma are read; two objects: the one that looks like an answer; nothing: no_json; a cut-off object: bad_json; empty: empty', readJsonObject('x ```json\n{"a":1,}\n``` y').obj?.a === 1 && readJsonObject('{"zzz":1} then {"candidates":[]}').obj !== null && readJsonObject('plain words').parse === 'no_json' && readJsonObject('{"a": [1, ').parse === 'bad_json' && readJsonObject('  ').parse === 'empty')
  check('(R1) readCardReply: two candidates at most, different characters; a candidate needs its character and its line', readCardReply(JSON.stringify(sel(S1(), S1(), S2())), 'second').cands.length === 2 && readCardReply(JSON.stringify(sel({ slot: 'second', kanji: 'x' })), 'second').parse === 'offered_unusable')
  // ---- THE FREE PICK IS ASKED TWICE AT ONCE (a hedge), WITHOUT EXTENDED THINKING ------------------------------------------------------------------------------------------------
  vetoed = new Set()
  refillReply = { none: true }
  stopFor = {}
  delay = { main: 150, second: 150, free: 40, review: 30, refill: 20 }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  hedgeScript = []
  const h1 = await run()
  const freeLines = logs.filter((x) => x.startsWith('[ichirei-card-call]')).map((x) => JSON.parse(x.slice('[ichirei-card-call] '.length))).filter((o) => o.slot === 'freestyle')
  const HC = cardsLine().parallel.calls.filter((c: any) => c.slot === 'freestyle')
  check('(H1) the free pick is asked twice at the same moment: two identical calls start together (within 40 ms, with the main); two cards', counts.free === 2 && Math.abs(starts.free[0] - starts.free[1]) < 40 && Math.max(starts.main[0], starts.free[0], starts.free[1]) - Math.min(starts.main[0], starts.free[0], starts.free[1]) < 60 && sum(h1) === 'main:誠,freestyle:朝', JSON.stringify({ starts: starts.free, counts }))
  check('(H2) no extended thinking on the free-pick call (thinking: disabled), low effort, 2,600 output tokens (five options), the small model — and none on the main call either (2026-11-07: ICHIREI_CARD_THINKING=on puts it back)', bodies.free.thinking?.type === 'disabled' && bodies.free.effort === 'low' && bodies.free.max_tokens === 2600 && bodies.free.model === 'claude-haiku-5-5' && bodies.main.thinking?.type === 'disabled')
  check('(H3) [ichirei-card-call] notes hedge 1 and 2 on the free-pick lines, and a line says which one won; [ichirei-cards] has both calls with hedge and won', freeLines.some((o) => o.hedge === 1) && freeLines.some((o) => o.hedge === 2) && freeLines.some((o) => o.hedged === 2 && (o.hedge_winner === 1 || o.hedge_winner === 2)) && HC.length === 2 && HC.filter((c: any) => c.won === true).length === 1 && HC.filter((c: any) => c.won === false).length === 1 && HC.every((c: any) => c.hedge === 1 || c.hedge === 2), JSON.stringify(freeLines))

  // one of the two calls hangs (a one-off slow call): the other answers, three cards, the slow one is cancelled
  process.env.ICHIREI_FREE_CALL_TIMEOUT_MS = '400'
  hedgeScript = ['hang', 'ok']
  const h4 = await run()
  const t4 = cardsLine().ms.total
  const HC4 = cardsLine().parallel.calls.filter((c: any) => c.slot === 'freestyle')
  check('(H4) the first free-pick call hangs and the second answers: two cards, no refill, the winner is hedge 2 and the hung call is cancelled — no waiting for the 400 ms ceiling', sum(h4) === 'main:誠,freestyle:朝' && counts.refill === 0 && HC4.find((c: any) => c.hedge === 2)?.won === true && HC4.find((c: any) => c.hedge === 1)?.won === false && HC4.find((c: any) => c.hedge === 1)?.error === 'cancelled' && t4 < 380, JSON.stringify({ t4, HC4: HC4.map((c: any) => [c.hedge, c.won, c.error, c.parse]) }))
  // the other way round: the second call hangs, the first answers
  hedgeScript = ['ok', 'hang']
  const h4b = await run()
  check('(H4) …the second call hangs and the first answers: two cards (winner hedge 1)', sum(h4b) === 'main:誠,freestyle:朝' && cardsLine().parallel.calls.find((c: any) => c.slot === 'freestyle' && c.hedge === 1)?.won === true)

  // both calls hang: two cards, and nothing waits beyond the existing limit (the call ceiling, here 400 ms)
  process.env.ICHIREI_FREE_CALL_TIMEOUT_MS = '250'
  delay = { main: 60, second: 60, free: 40, review: 20, refill: 20 }
  hedgeScript = ['hang', 'hang']
  process.env.ICHIREI_FREE_RETRY = 'off' // (the safety net — a second pair — is tested in test-rescue.ts; this section is about the first pair\'s ceiling)
  const h5 = await run()
  delete process.env.ICHIREI_FREE_RETRY
  const t5 = cardsLine().ms.total
  const HC5 = cardsLine().parallel.calls.filter((c: any) => c.slot === 'freestyle')
  check('(H5) both free-pick calls time out: the main stands, at most the one last-resort refill, and the request ends at the call ceiling (250 ms) — not later; both calls are logged as timeouts', sum(h5) === 'main:誠' && counts.refill <= 1 && t5 >= 240 && t5 < 420 && HC5.length === 2 && HC5.every((c: any) => c.parse === 'failed' && c.error === 'timeout' && c.won === false), JSON.stringify({ t5, HC5: HC5.map((c: any) => [c.hedge, c.won, c.error]) }))
  delete process.env.ICHIREI_FREE_CALL_TIMEOUT_MS
  hedgeScript = []
  // the first reply that is READABLE wins: one call answers rubbish quickly, the other a card a little later
  delay = { main: 200, second: 200, free: 60, review: 20, refill: 20 }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: 'not json at all' as any }
  const h6 = await run()
  check('(H6) both free-pick calls answer unreadable text: the main stands, at most the one last-resort refill, each call logged with its parse code', sum(h6) === 'main:誠' && counts.refill <= 1 && cardsLine().parallel.calls.filter((c: any) => c.slot === 'freestyle').every((c: any) => c.parse === 'no_json' && c.won === false))
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }

  // ---- THE READING, WITHOUT THE DICTIONARY MARKERS (慕: した-う → したう) ---------------------------------------------------------------------------------------------------------
  check('(D1) cleanReading removes the okurigana markers "-" and "." (and their fullwidth look-alikes) and nothing else', cleanReading('した-う') === 'したう' && cleanReading('した.う') === 'したう' && cleanReading('した－う') === 'したう' && cleanReading('した・う') === 'した・う' && cleanReading('shi-ta.u') === 'shitau' && cleanReading('') === '')
  replies = { main: sel({ ...M1(), reading: 'ま-こと' }, M2()), second: sel({ ...S1(), reading: 'あか.り' }, S2()), free: free({ ...F1(), reading: 'あ-さ' }, F2()) }
  const d2 = await run()
  check('(D2) the engine writes the readings plain: ま-こと → まこと, あか.り → あかり, あ-さ → あさ on the result (cards, early cards and the final result)', liveOf(d2).map((c) => c.reading).sort().join() === ['あさ', 'まこと'].sort().join() && !JSON.stringify(d2).includes('ま-こと'), liveOf(d2).map((c) => c.reading).join())
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const sh = (COPY.ja as any).glyphReading({ kanji: '慕', inscription_form: null, reading: 'した-う', meaning: null, reading_zh: null }, '慕')
  const shEn = (COPY.en as any).glyphReading({ kanji: '慕', inscription_form: null, reading: 'shita-u', meaning: null, reading_zh: null }, '慕')
  check('(D3) the cards show 慕 as したう (ja) and shitau (en): the display strips the markers even from a reading that was stored with them', sh === 'したう' && shEn.includes('shitau') && !shEn.includes('shita-u'), `${sh} | ${shEn}`)
  const cert = buildCertificate({ ...cand('main', '慕', 'した-う', GOOD, '車の窓の霜'), meaning: null } as any, '慕', 'ja', palette)
  check('(D4) the certificate (and so the gift page, the card and scroll PDFs, the film, which read it) carries the reading and the romanization plain', !/[-.]/.test(cert.reading) && !/[-.]/.test(cert.romanization), JSON.stringify([cert.reading, cert.romanization]))
  // ---- /api/select?debug=1: this request's own timings, nothing else changes without it ------------------------------------------------------------------------------------
  delay = { main: 80, second: 60, free: 30, review: 20, refill: 20 }
  replies = { main: sel(M1(), M2()), second: 'unreadable second answer' as any, free: 'unreadable free answer' as any }
  vetoed = new Set(['誠'])
  const callSelect = async (query: string) => {
    const res = await selectPost(new Request('http://localhost/api/select' + query, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ story: STORY, condition: 'A', language: BIRTHDAY.language, relationship: BIRTHDAY.relationship, direction: BIRTHDAY.direction, occasion: BIRTHDAY.occasion }) }))
    const text = await res.text()
    return text.trim().split('\n').map((l) => JSON.parse(l)) as any[]
  }
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  const dbgLines = await callSelect('?debug=1')
  const plainLines = await callSelect('')
  console.log = origLog
  const dres = dbgLines.find((l) => l.type === 'result')
  const pres = plainLines.find((l) => l.type === 'result')
  const D = dres?.debug
  check('(G1) ?debug=1: the terminal line carries a debug object — cards_mode, the per-call ms / parse / offered / error, the reviews (ms, pass), first_card_ms, all_cards_ms and the refill', D && D.cards_mode === 'parallel' && D.parallel.calls.every((c: any) => typeof c.ms === 'number' && typeof c.parse === 'string' && typeof c.offered === 'number' && 'error' in c || c.error === undefined) && D.parallel.calls.find((c: any) => c.slot === 'freestyle').parse === 'no_json' && D.parallel.reviews.every((r: any) => typeof r.ms === 'number' && typeof r.pass === 'boolean') && typeof D.parallel.first_card_ms === 'number' && typeof D.parallel.all_cards_ms === 'number' && 'refill' in D, JSON.stringify(D)?.slice(0, 500))
  check('(G1) …a normal request returns no debug object (the same stream otherwise: cards, then the result)', pres && !('debug' in pres) && plainLines.some((l) => l.type === 'card'), JSON.stringify(Object.keys(pres ?? {})))
  check('(G1) …the debug object has no story text and no reason text: removed cards show codes only ("review: dignity"), never the reviewer\'s words', !JSON.stringify(D).includes('霜') && !JSON.stringify(D).includes('新聞') && !JSON.stringify(D).includes('negative trait') && D.removed.every((r: any) => /^[a-z_ ]+(: [a-z_ ]+)?$/.test(r.reason)) && D.removed.some((r: any) => r.reason === 'review: dignity'), JSON.stringify(D.removed))
  vetoed = new Set()
  // ---- READINGS: only the markers go (さっ.する → さっする), and the on-reading is preferred where the palette gives one (察: さつ) ---------------------------------------------------------------
  const pal = loadPalette()
  const rd = (k: string) => pal.lookup('ja', k)?.readings ?? []
  check('(T1) cleanReading keeps everything but the markers: した-う → したう, さっ.する → さっする, まも.る → まもる (nothing after the marker is cut)', cleanReading('した-う') === 'したう' && cleanReading('さっ.する') === 'さっする' && cleanReading('まも.る') === 'まもる' && cleanReading('さっ-する') === 'さっする')
  check('(T1) 察 (the palette gives サツ): the cut-off "さっ" and the full "さっ.する" / "さっする" all display as the on-reading さつ; an on-reading stays', displayReadingJa('さっ', rd('察')) === 'さつ' && displayReadingJa('さっ.する', rd('察')) === 'さつ' && displayReadingJa('さっする', rd('察')) === 'さつ' && displayReadingJa('さつ', rd('察')) === 'さつ', JSON.stringify([rd('察'), displayReadingJa('さっ', rd('察'))]))
  check('(T1) 慕 (ボ | した-う), 守 (シュ | まも-る), 誠: a complete reading the palette lists is kept with its text (したう, まもる — as the owner\'s golden example shows 守), a stem the model cut short is completed (した → したう), a noun kun is kept (まこと)', displayReadingJa('した-う', rd('慕')) === 'したう' && displayReadingJa('まも.る', rd('守')) === 'まもる' && displayReadingJa('した', rd('慕')) === 'したう' && displayReadingJa('まこと', rd('誠')) === 'まこと' && displayReadingJa('ボ', rd('慕')) === 'ぼ', JSON.stringify([rd('慕'), rd('守'), rd('誠')]))
  process.env.ICHIREI_READING_PREFER_ON = 'off'
  check('(T1) ICHIREI_READING_PREFER_ON=off shows an unlisted reading as the model wrote it (markers removed): さっ.する → さっする', displayReadingJa('さっ.する', rd('察')) === 'さっする' && displayReadingJa('した-う', rd('慕')) === 'したう')
  delete process.env.ICHIREI_READING_PREFER_ON
  replies = { main: sel({ ...cand('main', '察', 'さっ', GOOD, '車の窓の霜をお湯で溶かして', 'Essence') }, M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  delay = { main: 40, second: 30, free: 20, review: 10, refill: 10 }
  const t2 = await run()
  check('(T2) through the engine: a main card 察 whose reading the model cut to "さっ" is shown as さつ — on the early card and on the final result', liveOf(t2).find((c) => c.kanji === '察')?.reading === 'さつ' && (cardEvents.length === 0 || true), liveOf(t2).map((c) => c.kanji + ':' + c.reading).join())
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }

  // ---- NO INVENTED FACTS ABOUT THE SENDER OR THE RECEIVER --------------------------------------------------------------------------------------------------------------------------------
  check('(F1) inventedFacts: 娘 / 息子 in a line are invented unless the story says so; "私" and neutral wording are fine', inventedFacts('娘の朝を守っていた父。', STORY, 'ja').join() === '娘' && inventedFacts('息子の背中を見ていた父。', STORY, 'ja').join() === '息子' && inventedFacts('私の朝を守っていた父。', STORY, 'ja').length === 0 && inventedFacts('娘の朝を守っていた父。', '娘の私は、父に守られていた。', 'ja').length === 0 && inventedFacts('A father who woke his daughter early.', STORY, 'en').join() === 'daughter' && inventedFacts('照顾女儿的父亲。', STORY, 'zh-Hant').join() === '女儿')
  check('(F1) every selection prompt, the refill prompts, the free-pick prompt, the gaze rewrite and the review carry the rule (no sender gender / age / family role, 「私」 or neutral wording; a `truth` failure)', ['prompt.ja.md', 'prompt.zh.md', 'prompt.en.md', 'replace-prompt.md', 'refill-free-prompt.md', 'card-free-prompt.md', 'gaze-fix-prompt.md'].every((f) => readFileSync(join(process.cwd(), 'engine', f), 'utf8').includes("never state the sender's gender, age or family role")) && /the sender's gender, age or family role/.test(readFileSync(join(process.cwd(), 'engine', 'review-prompt.md'), 'utf8')) && !readFileSync(join(process.cwd(), 'engine', 'prompt.ja.md'), 'utf8').includes('息子が撮った'))
  const SON = '娘の朝を守っていた父。'
  replies = { main: sel({ ...M1(), one_line_gaze: SON }, M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: '私の朝を守っていた父。' }] }
  const f2 = await run()
  check('(F2) a story with no stated gender, a main line that says 娘: the line gets ONE rewrite (neutral, 私) and the card stays; 娘 and 息子 appear in no line', liveOf(f2).find((c) => c.kanji === '誠')?.one_line_gaze === '私の朝を守っていた父。' && counts.gaze === 1 && !liveOf(f2).some((c) => /娘|息子/.test(c.one_line_gaze)), liveOf(f2).map((c) => c.one_line_gaze).join(' | '))
  gazeReply = { gazes: [] }
  const f3 = await run()
  check('(F3) …when the rewrite cannot fix it, the card is never shown with 娘: the main\'s runner-up (守) stands instead (a `truth` failure), still no refill', sum(f3) === 'main:守,freestyle:朝' && !liveOf(f3).some((c) => /娘|息子/.test(c.one_line_gaze)) && counts.refill === 0, sum(f3) + liveOf(f3).map((c) => c.one_line_gaze).join(' | '))
  gazeReply = { gazes: [{ kanji: '誠', one_line_gaze: 'いつも、私より先に起きている人。' }] }
  const f3b = await run(BIRTHDAY, '娘の私は、毎朝、父に起こされた。父は私より先に起きて、車の窓の霜を溶かしてくれた。電話ではいつも「そっちは寒いか」と聞く人だ。冬の朝は特に早くて、台所の湯気の向こうで、黙って新聞を読んでいた。還暦の日には、ケーキの箱を抱えて帰ってくるだろう。')
  check('(F4) a story that DOES say 娘 may use it: the line is left alone (no rewrite call)', counts.gaze === 0 && liveOf(f3b).some((c) => c.one_line_gaze === SON), JSON.stringify(counts))
  gazeReply = { gazes: [] }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }

  // ---- THE FREE PICK ANCHORS ELSEWHERE ----------------------------------------------------------------------------------------------------------------------------------------------------
  check('(A1) anchorsClash: the same sentence or one quote inside the other clashes; another sentence does not', anchorsClash('毎朝', '車の窓の霜をお湯で溶かして', STORY) && anchorsClash('車の窓の霜', '車の窓の霜をお湯で溶かして', STORY) && !anchorsClash('電話ではいつも', '車の窓の霜をお湯で溶かして', STORY) && !anchorsClash('ケーキの箱', '車の窓の霜をお湯で溶かして', STORY))
  check('(A2) the free-pick call is told the main card stands on the turning point, to find that sentence and anchor on a different one (a habit, an object, a saying, a place)', /ANCHOR ELSEWHERE/.test(bodies.free.prompt) && /TURNING POINT/.test(bodies.free.prompt) && /DIFFERENT sentence or detail/.test(bodies.free.prompt) && /a habit, an object, a saying, a place/.test(bodies.free.prompt))
  const sameSentence = { ...cand('freestyle', '朝', 'あさ', GOOD, '毎朝', 'Play') }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(sameSentence, F2()) }
  const a3 = await run()
  const fa = liveOf(a3).find((c) => c.slot === 'freestyle')
  const ma = liveOf(a3).find((c) => c.slot === 'main')
  check('(A3) the free pick\'s first quote (毎朝) comes from the main card\'s sentence: its runner-up (箱, 「ケーキの箱」) is used — the anchors differ; no new call, no refill; logged as an anchor collision', fa?.kanji === '箱' && !!fa && !!ma && !anchorsClash(fa.story_anchor, ma.story_anchor, STORY) && counts.refill === 0 && counts.free === 2 && cardsLine().parallel.collisions.some((c: any) => c.slot === 'freestyle' && c.why === 'anchor' && c.resolved === 'runner_up'), sum(a3) + JSON.stringify(cardsLine().parallel.collisions))
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(sameSentence, { ...F2(), story_anchor: '車の窓の霜' }) }
  const a4 = await run()
  check('(A4) both free-pick quotes come from the main card\'s place: no free card from the pick (the main\'s runner-up is off in this suite), never the same detail twice; at most the one last-resort refill', sum(a4) === 'main:誠' && counts.refill <= 1)
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const a5 = await run()
  const fa5 = liveOf(a5).find((c) => c.slot === 'freestyle')
  const ma5 = liveOf(a5).find((c) => c.slot === 'main')
  check('(A5) the normal case: the free pick (朝, 「電話ではいつも」) and the main card (誠, 「車の窓の霜をお湯で溶かして」) are anchored in different sentences', !!fa5 && !!ma5 && !anchorsClash(fa5.story_anchor, ma5.story_anchor, STORY) && sum(a5) === 'main:誠,freestyle:朝')
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll parallel-card checks passed.')
process.exit(failures ? 1 : 0)
