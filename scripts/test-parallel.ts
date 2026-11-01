// Parallel cards (2026-11-01): main, second and free pick are written by three calls that start at the same moment; each card is reviewed as soon as it is written;
// a rejected or doubled character falls back to its own call's runner-up. A FAKE model with settable latencies: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-parallel.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { eligibleFor, lexiconEchoOf, loadLexicon } from '../engine/lexicon.ts'
import { loadPalette } from '../engine/palette.ts'
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
const F1 = () => cand('freestyle', '朝', 'あさ', GOOD, '毎朝', 'Play')
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
  bodies[kind] = { cached, blocks: Array.isArray(content) ? content.length : 0, model: body.model, effort: body.output_config?.effort, max_tokens: body.max_tokens, prompt }
  let reply: unknown
  if (kind === 'review') {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: !vetoed.has(m[2]), rule: vetoed.has(m[2]) ? 'dignity' : null, reason: vetoed.has(m[2]) ? 'could read as a negative trait' : 'ok' }))
    reply = { verdicts: items }
  } else if (kind === 'refill') reply = refillReply
  else if (kind === 'gaze') reply = { gazes: [] }
  else if (kind === 'main' || kind === 'second') reply = replyFor ? replyFor(kind, prompt) : (replies as any)[kind]
  else reply = (replies as any)[kind] ?? (replies as any).other ?? {}
  const ms = (delay as any)[kind] ?? 10
  await new Promise((r) => setTimeout(r, ms))
  ;(ends[kind] ??= []).push(Date.now() - t0)
  const text = JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: kind === 'main' ? 900 : kind === 'second' ? 800 : 120, output_tokens_details: { thinking_tokens: kind === 'main' ? 600 : kind === 'second' ? 500 : 0 } } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE']) delete process.env[k]

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
const sum = (r: EngineResult) => liveOf(r).map((c) => `${c.slot}:${c.kanji}`).join()

try {
  check('the test story is 143 characters (Japanese, birthday)', [...STORY].length === 143)

  // ---- (1) the three calls start together; each card is reviewed as soon as it is written ---------------------------------------------------------------------------
  delay = { main: 300, second: 200, free: 100, review: 40, refill: 10 }
  const r1 = await run()
  const startsAt = [starts.main[0], starts.second[0], starts.free[0]]
  check('(1) three calls — main, second, free — start at the same moment (within 60 ms of each other), and none has answered before all have started', Math.max(...startsAt) - Math.min(...startsAt) < 60 && Math.max(...startsAt) < Math.min(ends.main[0], ends.second[0], ends.free[0]) && counts.main === 1 && counts.second === 1 && counts.free === 1, JSON.stringify({ starts: startsAt, ends: [ends.main[0], ends.second[0], ends.free[0]] }))
  check('(1) …a card is reviewed as soon as it is written: the free pick\'s review starts before the main call has even answered; the three reviews overlap', starts.review.length === 3 && Math.min(...starts.review) < ends.main[0] && starts.review.filter((t) => t >= ends.main[0] - 5).length <= 1, JSON.stringify({ review_starts: starts.review, main_end: ends.main[0] }))
  check('(1) …three cards in the order main, second, free; no refill; contract-valid', sum(r1) === 'main:誠,second:灯,freestyle:朝' && counts.refill === 0 && validateEngineResult(r1).length === 0, sum(r1) + validateEngineResult(r1).join('; '))
  check('(1) …every call asks for the TOP TWO, ranked: the prompts say so; the main and the second carry their own lens', /TOP TWO/.test(bodies.main.prompt) && /deepest truth, from the story's turning point/.test(bodies.main.prompt) && /a different side of the person, from another scene or habit than the turning point/.test(bodies.second.prompt) && /TOP TWO/.test(bodies.free.prompt) && /\* CARD: main\./.test(bodies.main.prompt) && /\* CARD: second\./.test(bodies.second.prompt))

  // ---- models, effort and the free pick's prompt -----------------------------------------------------------------------------------------------------------------------------
  check('(2) main and second use the SELECTION model at low effort; the free pick uses the small model (claude-haiku-5-5) at low effort with a short answer limit; none carries the others\' lens', bodies.main.model === 'claude-sonnet-5' && bodies.second.model === 'claude-sonnet-5' && bodies.main.effort === 'low' && bodies.second.effort === 'low' && bodies.free.model === 'claude-haiku-5-5' && bodies.free.effort === 'low' && bodies.free.max_tokens <= 2000 && !bodies.main.prompt.includes('a different side of the person') && !bodies.second.prompt.includes("deepest truth, from the story's turning point. Candidate 1"), JSON.stringify({ m: bodies.main.model, s: bodies.second.model, f: bodies.free.model, e: [bodies.main.effort, bodies.free.effort] }))
  check('(2) …the free pick is told: positive, a habit / place / object / saying, never a character that could read as a negative trait (寒, 冷, 頑, 怠), and not another word for warmth or care; it gets the story, the relationship and the occasion', /NEVER A NEGATIVE TRAIT/.test(bodies.free.prompt) && /寒, 冷, 頑, 怠/.test(bodies.free.prompt) && /a habit, a place, an object/.test(bodies.free.prompt) && /Not another word for the same feeling/.test(bodies.free.prompt) && bodies.free.prompt.includes('車の窓の霜') && bodies.free.prompt.includes('birthday_milestone') && bodies.free.prompt.includes('parent_father'))
  check('(2) …main and second get the whole language prompt (the rules: truth, 常用漢字, remembrance blocks) with the story and the context', bodies.main.prompt.includes('車の窓の霜') && bodies.main.prompt.includes('birthday_milestone') && bodies.main.prompt.length > 15000 && bodies.second.prompt.length > 15000)

  // ---- (3) cards appear one by one, in order ------------------------------------------------------------------------------------------------------------------------------------
  check('(3) each card is shown as soon as it passes, in the order main, second, free: three events with 1, 2, then 3 cards', cardEvents.map((e) => e.slots).join('|') === 'main|main,second|main,second,freestyle', JSON.stringify(cardEvents))
  check('(3) …the main card is out right after the main call + its review, not after the other cards; the second follows', cardEvents[0].at >= ends.main[0] && cardEvents[0].at < ends.main[0] + 200 && cardEvents[1].at >= cardEvents[0].at, JSON.stringify({ cardEvents, main_end: ends.main[0] }))

  // ---- (4) the log -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const L = cardsLine()
  const callOf = (slot: string) => L.parallel?.calls?.find((c: any) => c.slot === slot)
  check('(4) [ichirei-cards]: ms per call, output_tokens, thinking_tokens and stop_reason per call; every review with its ms; the time to the first card and to all cards', ['main', 'second', 'freestyle'].every((s) => { const c = callOf(s); return c && typeof c.ms === 'number' && c.stop_reason === 'end_turn' && typeof c.output_tokens === 'number' && c.model && c.effort && c.attempts === 1 }) && callOf('main').output_tokens === 900 && callOf('main').thinking_tokens === 600 && L.parallel.reviews.length === 3 && L.parallel.reviews.every((r: any) => typeof r.ms === 'number' && r.pass === true) && typeof L.parallel.first_card_ms === 'number' && typeof L.parallel.all_cards_ms === 'number' && L.parallel.first_card_ms <= L.parallel.all_cards_ms, JSON.stringify(L.parallel).slice(0, 700))
  check('(4) …no story text and no kanji in the parallel part of the log line besides what was already logged (codes, numbers, slots)', !JSON.stringify(L.parallel).includes('霜') && !JSON.stringify(L.parallel).includes('新聞'))
  check('(4) …calls: select 3 (one per card), review 3, refill 0', L.calls.select === 3 && L.calls.review === 3 && L.calls.refill === 0, JSON.stringify(L.calls))

  // ---- (5) a collision uses the runner-up, with no extra selection call ------------------------------------------------------------------------------------------------
  delay = { main: 60, second: 120, free: 90, review: 20, refill: 10 }
  replies = { main: sel(M1(), M2()), second: sel(cand('second', '誠', 'まこと', GOOD2, '黙って新聞を読んで', 'Private Symbol'), S1()), free: free(F1(), F2()) }
  const r5 = await run()
  const L5 = cardsLine()
  check('(5) the second card puts forward the main\'s character (誠): it uses its own runner-up (灯) — three cards, still exactly one call per card (3 selection calls), no refill', sum(r5) === 'main:誠,second:灯,freestyle:朝' && counts.main + counts.second + counts.free === 3 && counts.refill === 0, sum(r5) + JSON.stringify(counts))
  check('(5) …the collision is resolved without spending a review on the doubled character (3 reviews for 3 cards), and the log names it: collisions [{second, runner_up}], runner_up_used [second]', counts.review === 3 && L5.parallel.collisions.some((c: any) => c.slot === 'second' && c.resolved === 'runner_up') && L5.parallel.runner_up_used.join() === 'second', JSON.stringify({ counts, p: L5.parallel.collisions, u: L5.parallel.runner_up_used }))
  // the free pick doubles the second's character: it uses its runner-up (箱)
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(cand('freestyle', '灯', 'あかり', GOOD, '毎朝', 'Play'), F2()) }
  delay = { main: 60, second: 60, free: 30, review: 20, refill: 10 }
  const r5b = await run()
  check('(5) the free pick doubles the second\'s character (灯): the free pick uses its runner-up (箱), again no extra selection call', sum(r5b) === 'main:誠,second:灯,freestyle:箱' && counts.main + counts.second + counts.free === 3 && counts.refill === 0, sum(r5b) + JSON.stringify(counts))
  // both collide with nothing left: the lower card stays empty (main/second would be refilled; the free pick is simply not shown)
  replies = { main: sel(M1()), second: sel(cand('second', '誠', 'まこと', GOOD2, '黙って新聞を読んで', 'Private Symbol')), free: free(F1()) }
  const r5c = await run()
  check('(5) the second has no runner-up and doubles the main: its slot is refilled ONCE by the existing refill (a third-party fill here: none offered) — two cards, no error', counts.refill === 1 && sum(r5c) === 'main:誠,freestyle:朝' && r5c.status === 'sufficient', sum(r5c) + JSON.stringify(counts))

  // ---- (6) a rejected character falls back to its call's runner-up, then the refill, then nothing (free) -----------------------------------------------------------------
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  delay = { main: 60, second: 50, free: 40, review: 20, refill: 10 }
  vetoed = new Set(['誠'])
  const r6 = await run()
  check('(6) the review rejects the main\'s first character (誠): the call\'s runner-up (守) stands — no refill call, no new selection call', sum(r6) === 'main:守,second:灯,freestyle:朝' && counts.refill === 0 && counts.main === 1 && counts.review === 4, sum(r6) + JSON.stringify(counts))
  vetoed = new Set(['誠', '守'])
  const r6b = await run()
  check('(6) both of the main\'s characters are rejected: only now the existing refill is asked (once); the second is promoted if the refill finds nothing', counts.refill === 1 && r6b.candidates.some((c) => !c.eliminated && c.slot !== 'freestyle'), sum(r6b) + JSON.stringify(counts))
  vetoed = new Set(['朝', '箱'])
  delay = { main: 400, second: 400, free: 40, review: 30, refill: 10 }
  const r6c = await run()
  const tFree = ends.free[0]
  check('(6) both of the free pick\'s characters are rejected: two cards, NO refill call for the free pick, no error', sum(r6c) === 'main:誠,second:灯' && counts.refill === 0 && r6c.status === 'sufficient', sum(r6c) + JSON.stringify(counts))
  const dFree = r6c && cardsLine().ms.total
  delay = { main: 400, second: 400, free: 40, review: 30, refill: 10 }
  vetoed = new Set()
  await run()
  const dOk = cardsLine().ms.total
  check('(6) …the rejection costs the others no time: the same run with an accepted free pick takes no longer (within 80 ms)', Math.abs(dFree - dOk) < 80 && tFree < 400, JSON.stringify({ dFree, dOk }))
  vetoed = new Set()
  // a free pick that is slow is let go after the main and second cards are settled (a short grace), never holding the others
  process.env.ICHIREI_FREE_GRACE_MS = '150'
  delay = { main: 100, second: 100, free: 3000, review: 20, refill: 10 }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const r6d = await run()
  const tTotal = cardsLine().ms.total
  check('(6) a very slow free pick (3 s) does not hold the result: it is let go 150 ms after the main and second are settled — two cards, finished long before 3 s, logged as free_dropped "late"', sum(r6d) === 'main:誠,second:灯' && tTotal < 1200 && cardsLine().parallel.free_dropped === 'late', sum(r6d) + tTotal)
  delete process.env.ICHIREI_FREE_GRACE_MS

  // ---- (7) remembrance: two calls ----------------------------------------------------------------------------------------------------------------------------------------------------
  delay = { ...BASE_DELAY }
  replies = { main: sel(M1(), M2()), second: sel(S1(), S2()), free: free(F1(), F2()) }
  const r7 = await run(MEMORIAL)
  check('(7) remembrance makes TWO calls (main and second), no free-pick call, two cards, "not_offered"', counts.main === 1 && counts.second === 1 && counts.free === 0 && liveOf(r7).length === 2 && cardsLine().freestyle === 'not_offered' && cardsLine().calls.select === 2 && !cardsLine().parallel.calls.some((c: any) => c.slot === 'freestyle'), sum(r7) + JSON.stringify(counts))

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
  check('(9) a 143-character story with realistic timings (main 17 s, second 15 s, free 6 s, each review 4 s) finishes in ≤ 30 s with three cards', sum(r9) === 'main:誠,second:灯,freestyle:朝' && L9.ms.total <= 30000, JSON.stringify(L9.ms))
  check('(9) …the main card is shown at about 21 s (the main call + its review) and all cards at the same moment; nothing waits for the free pick', cardEvents.length === 3 && cardEvents[0].at >= 20800 && cardEvents[0].at <= 24000 && L9.parallel.first_card_ms <= 24000 && L9.parallel.all_cards_ms <= 25000, JSON.stringify({ cardEvents, p: [L9.parallel.first_card_ms, L9.parallel.all_cards_ms] }))
  console.log(`      (timings: first card ${L9.parallel.first_card_ms} ms, all cards ${L9.parallel.all_cards_ms} ms, total ${L9.ms.total} ms; for the old single call at 60 s: 60 s + review + refill)`)
  // ---- LEXICON MODE (ICHIREI_LEXICON_MODE=on, as shipped in cloudbuild.yaml): the lexicon rules apply to each of the three calls and their reviews ------------------------------
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
  check('(L1) lexicon on: three calls start together, three cards main:' + LA + ', second:' + LB + ', free 朝 (the free pick is not limited to the list), no refill', sum(l1) === `main:${LA},second:${LB},freestyle:朝` && counts.main === 1 && counts.second === 1 && counts.free === 1 && counts.refill === 0 && Math.max(starts.main[0], starts.second[0], starts.free[0]) - Math.min(starts.main[0], starts.second[0], starts.free[0]) < 60, sum(l1) + JSON.stringify(counts))
  check('(L1) …[ichirei-cards] says cards_mode "parallel" (and "single" is what the rollback logs, see below)', LL.cards_mode === 'parallel' && !!LL.parallel, String(LL.cards_mode))
  check('(L2) the main and the second call carry the lexicon: the static table FIRST as its own cached block, then the language prompt + the one-card block + the gift\'s list and rules; the card block says the lexicon rules apply to the card', bodies.main.cached === true && bodies.main.blocks === 2 && bodies.second.cached === true && bodies.main.prompt.indexOf('THE LEXICON (every entry') < bodies.main.prompt.indexOf('* CARD: main.') && bodies.main.prompt.indexOf('* CARD: main.') < bodies.main.prompt.indexOf('CLASSICAL LEXICON — THIS GIFT') && /LEXICON MODE: the lexicon rules after this block apply to your card/.test(bodies.main.prompt) && /RULES FOR THIS MODE/.test(bodies.second.prompt) && bodies.main.prompt.includes(LA), bodies.main.prompt.slice(-600))
  check('(L2) …the free-pick call is the compact prompt only (no lexicon table, no list: the free pick is not limited to it, lexicon rule 4); it still gets the "no negative trait" rule', !bodies.free.cached && bodies.free.blocks === 0 && !bodies.free.prompt.includes('THE LEXICON') && !bodies.free.prompt.includes('CLASSICAL LEXICON — THIS GIFT') && /NEVER A NEGATIVE TRAIT/.test(bodies.free.prompt))
  check('(L2) …a lexicon main asks for the miss answer (rule 6); the second is told NOT to write lexicon_miss (the main decides)', /answer as rule 6 says/.test(bodies.main.prompt) && /do NOT write lexicon_miss/.test(bodies.second.prompt) && !/do NOT write lexicon_miss/.test(bodies.main.prompt))
  const echoOf = (k: string) => { const c = l1.candidates.find((x) => x.kanji === k && !x.eliminated); return c ? JSON.stringify(c.classical_echo) === JSON.stringify(lexiconEchoOf(set, c)) : false }
  check('(L3) the classical line on a card comes from the lexicon (a person-reviewed row only), never from the palette — also on the cards shown early; the result carries the lexicon report (mode on, chosen)', echoOf(LA) && echoOf(LB) && (l1 as any).lexicon?.mode === 'on' && (l1 as any).lexicon?.outcome === 'chosen' && cardEvents.length === 3 && cardEvents.every((e) => e.lexicon === 'on') && cardEvents[0].echoes === `${LA}:${lexiconEchoOf(set, { kanji: LA, inscription_form: set.chars.find((c) => c.kanji === LA)?.inscription_form ?? null }) ? 'line' : 'none'}`, JSON.stringify(cardEvents))
  check('(L4) every card is reviewed, lexicon characters included (3 reviews)', counts.review === 3 && LL.calls.review === 3, JSON.stringify(counts))

  // a main or second character outside the list is refused by the referee; the call's runner-up (on the list) stands — no refill
  replies = { main: lexSel(lexCand('main', '猫'), lexCand('main', LA)), second: lexSel(lexCand('second', LB, GOOD2, '台所の湯気の向こう'), lexCand('second', LD, GOOD2, '黙って新聞を読んで')), free: free(F1(), F2()) }
  const l5 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L5) the main call\'s first character is outside the list (猫): the referee refuses it ("not_in_lexicon"), its runner-up ' + LA + ' stands; no refill call, no new selection call; a refused character is not even reviewed', sum(l5) === `main:${LA},second:${LB},freestyle:朝` && counts.refill === 0 && counts.main === 1 && counts.review === 3 && l5.candidates.some((c) => c.kanji === '猫' && c.eliminated && /not_in_lexicon/.test(c.eliminated_reason ?? '')), sum(l5) + JSON.stringify(counts))
  // both of the second's characters are outside the list: its slot is refilled once, FROM THE LIST (the refill prompt carries the lexicon blocks), the free pick is never refilled
  replies = { main: lexSel(lexCand('main', LA), lexCand('main', LC)), second: lexSel(lexCand('second', '猫', GOOD2, '台所の湯気の向こう'), lexCand('second', '犬', GOOD2, '黙って新聞を読んで')), free: free(F1()) }
  vetoed = new Set(['朝'])
  refillReply = { candidates: [{ ...lexCand('second', LD, GOOD2, '黙って新聞を読んで') }] }
  const l6 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L6) both of the second\'s characters are off the list: ONE refill call (with the lexicon blocks in its prompt) fills the second from the list; the rejected free pick is NOT refilled (two cards + the refilled second)', counts.refill === 1 && sum(l6) === `main:${LA},second:${LD}` && bodies.refill.prompt.includes('CLASSICAL LEXICON — THIS GIFT'), sum(l6) + JSON.stringify(counts))
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
  check('(L8) after a follow-up answer, a second miss falls back to the palette engine — also three parallel calls, no lexicon blocks, three cards flagged lexicon_miss, outcome "fallback"', sum(l8) === 'main:誠,second:灯,freestyle:朝' && (l8 as any).lexicon?.outcome === 'fallback' && l8.candidates.filter((c) => !c.eliminated).every((c) => c.flags.includes('lexicon_miss')) && cardsLine().cards_mode === 'parallel', sum(l8) + JSON.stringify((l8 as any).lexicon))
  replyFor = null

  // ---- the rollback: ICHIREI_CARDS=single is ONE selection call, with or without the lexicon, and the log line says so -------------------------------------------------------------
  process.env.ICHIREI_CARDS = 'single'
  replies = { main: {}, second: {}, free: {}, other: { ...lexSel(lexCand('main', LA), lexCand('second', LB, GOOD2, '台所の湯気の向こう'), { ...F1() }), primary_kanji: LA, runner_up_kanji: LB, freestyle_kanji: '朝' } } as any
  const l9 = await run(BIRTHDAY, STORY, { lexiconMode: 'on' })
  check('(L9) ICHIREI_CARDS=single (lexicon on): ONE selection call, no card calls, three cards; [ichirei-cards] says cards_mode "single" and has no parallel part', (counts as any).other === 1 && counts.main === 0 && counts.second === 0 && counts.free === 0 && sum(l9) === `main:${LA},second:${LB},freestyle:朝` && cardsLine().cards_mode === 'single' && !cardsLine().parallel, sum(l9) + JSON.stringify(counts) + String(cardsLine().cards_mode))
  await run(BIRTHDAY, STORY, { lexiconMode: 'off' })
  check('(L9) …and without the lexicon the same: cards_mode "single"', cardsLine().cards_mode === 'single' && (counts as any).other === 1)
  delete process.env.ICHIREI_CARDS
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll parallel-card checks passed.')
process.exit(failures ? 1 : 0)
