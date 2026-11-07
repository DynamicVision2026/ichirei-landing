// 2026-11-07: a third card (趣字) in EVERY round except remembrance. The free pick has three steps — its five ranked options (the first one that is not already shown and passes the
// rules), a second hedged pair, then the best unused candidate of this round's main/second calls — and each fallback is logged with its reason (`free_source`) and counted for /ops.
// A FAKE model: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-free-three.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import type { EngineResult } from '../engine/contract.ts'
import { FREE_OPTIONS, freeCardPrompt, readCardReply, setAsideCode } from '../engine/cards.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { analyticsDay } from '../engine/analytics.ts'
import { readFreeSourceCounts, readMainCounts, recordFreeSource, recordMain } from '../engine/free-source.ts'
import { createOpsHandlers, type OpsDeps } from '../api/ops.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 900)}` : ''}`); if (!cond) failures++ }
const fx = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'memorial-story.json'), 'utf8'))

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
const F = (kanji: string, reading: string, anchor: string) => cand('freestyle', kanji, reading, GOOD, anchor, 'Play')
const F_朝 = () => F('朝', 'あさ', '電話ではいつも')
const F_箱 = () => F('箱', 'はこ', 'ケーキの箱')
// characters that were shown in an earlier round of this story (the free pick keeps coming back to them)
const SHOWN = ['星', '雪', '風', '月', '花']
const repeats = () => SHOWN.map((k) => F(k, 'あ', '電話ではいつも'))
const sel = (...c: any[]) => ({ suggest_memorial: false, status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: c, fallback_follow_up_question: 'あのとき、何がありましたか。' })

let mainReply: any = sel(M1(), M2())
let secondReply: any = sel(S1(), S2())
let freeAsk: [any, any] = [{ candidates: repeats() }, { candidates: repeats() }] // the first pair, the second pair (its prompt says SECOND ASK)
let freeDelay = 10
let vetoed = new Set<string>()
const counts: Record<string, number> = {}
const bodies: Record<string, any> = {}
const ends: Record<string, number[]> = {}
let t0 = 0

const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const content = body.messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: any) => b.text).join('\n') : String(content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Free Pick Card Prompt') ? 'free' : prompt.includes('Replacement Prompt (v9') ? 'refill' : prompt.includes('* CARD: second.') ? 'second' : prompt.includes('* CARD: main.') ? 'main' : 'other'
  counts[kind] = (counts[kind] ?? 0) + 1
  bodies[kind] = { prompt, max_tokens: body.max_tokens }
  let reply: unknown
  let ms = 10
  if (kind === 'review') {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: !vetoed.has(m[2]), rule: vetoed.has(m[2]) ? 'dignity' : null, reason: vetoed.has(m[2]) ? 'could read as a negative trait' : 'ok' }))
    reply = { verdicts: items }
  } else if (kind === 'gaze') reply = { gazes: [] }
  else if (kind === 'refill') reply = { none: true }
  else if (kind === 'main') { reply = mainReply; ms = 30 }
  else if (kind === 'second') { reply = secondReply; ms = 20 }
  else if (kind === 'free') { reply = prompt.includes('SECOND ASK') ? freeAsk[1] : freeAsk[0]; ms = freeDelay }
  else reply = {}
  await new Promise((r) => setTimeout(r, ms))
  ;(ends[kind] ??= []).push(Date.now() - t0)
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
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE', 'ICHIREI_FREE_RETRY', 'ICHIREI_FREE_RUNNER_UP']) delete process.env[k]

type Ctx = typeof fx.context
const BIRTHDAY: Ctx = { ...fx.context, occasion: 'birthday_milestone' }
const MEMORIAL: Ctx = fx.context
const logs: string[] = []
const origLog = console.log
let events: { at: number; slots: string }[] = []
let freeInfos: { round: number; source: string | null; reasons: string[] }[] = []
let debug: any = null
const run = async (ctx: Ctx, round: number, exclude: string[]): Promise<EngineResult> => {
  for (const k of Object.keys(counts)) counts[k] = 0
  for (const k of Object.keys(ends)) delete ends[k]
  logs.length = 0
  events = []
  freeInfos = []
  debug = null
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  t0 = Date.now()
  try {
    return await runEngine(STORY, 'A', {
      context: ctx,
      round,
      exclude,
      onCard: (p) => { events.push({ at: Date.now() - t0, slots: p.candidates.filter((c) => !c.eliminated).map((c) => c.slot).join() }) },
      onFreeSource: (i) => freeInfos.push(i),
      onDebug: (d) => { debug = d },
    })
  } finally { console.log = origLog }
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const sum = (r: EngineResult) => ['main', 'second', 'freestyle'].map((s) => live(r).find((c) => c.slot === s)).filter(Boolean).map((c) => `${c!.slot}:${c!.kanji}`).join()
const par = () => debug?.parallel ?? {}
const reset = () => { mainReply = sel(M1(), M2()); secondReply = sel(S1(), S2()); freeAsk = [{ candidates: repeats() }, { candidates: repeats() }]; freeDelay = 10; vetoed = new Set(); delete process.env.ICHIREI_FREE_RETRY; delete process.env.ICHIREI_FREE_RUNNER_UP }

try {
  // ---- the prompt and the reading of five options -------------------------------------------------------------------------------------------------------------------------------------
  const prompt = freeCardPrompt(STORY, BIRTHDAY as any, ['朝'])
  const retryPrompt = freeCardPrompt(STORY, BIRTHDAY as any, ['朝'], true)
  check('(1) the free-pick prompt asks for FIVE characters, ranked best to fifth, none on the avoid list, and says they are tried in order', /FIVE characters for the free pick, ranked from your best to your fifth/.test(prompt) && /<candidate 5>/.test(prompt) && /tried in order and the first one that passes the checks is used/.test(prompt) && !/TOP TWO/.test(prompt) && /not one of your five may be on this list/.test(prompt))
  check('(1) …the second ask also wants five, from different details', /SECOND ASK/.test(retryPrompt) && /Give five usable candidates now, none on the list above, from different details/.test(retryPrompt))
  const five = readCardReply(JSON.stringify({ candidates: [F_朝(), F_箱(), ...['星', '雪', '風', '月'].map((k) => F(k, 'あ', 'ケーキの箱'))] }), 'freestyle')
  const twoOnly = readCardReply(JSON.stringify({ candidates: [S1(), S2(), cand('second', '信', 'しん', GOOD, '車の窓の霜')] }), 'second')
  const mainFive = readCardReply(JSON.stringify({ candidates: [M1(), M2(), cand('main', '信', 'しん', GOOD, '車の窓の霜'), cand('main', '恩', 'おん', GOOD, '車の窓の霜'), cand('main', '想', 'そう', GOOD, '車の窓の霜'), cand('main', '常', 'つね', GOOD, '車の窓の霜')] }), 'main')
  check(`(1) up to ${FREE_OPTIONS} different options are read for the free pick, five for the main call, two for the second (remembrance) call`, five.cands.length === FREE_OPTIONS && twoOnly.cands.length === 2 && mainFive.cands.length === 5, `${five.cands.length}/${twoOnly.cands.length}`)

  // ---- (2) the first option that is not already shown is the card -----------------------------------------------------------------------------------------------------------------------------
  reset()
  freeAsk = [{ candidates: [...repeats().slice(0, 3), F_朝(), F_箱()] }, { candidates: [] }]
  const r2 = await run(BIRTHDAY, 2, SHOWN)
  check('(2) round 2: three already-shown options come first, the fourth stands — two cards (本命 + 遊び字), source "first", no second pair asked', sum(r2) === 'main:誠,freestyle:朝' && counts.free === 2 && par().free_source === 'first' && par().free_fallbacks.length === 0 && freeInfos[0]?.source === 'first', sum(r2) + JSON.stringify(par().free_fallbacks))
  check('(2) …the three shown options were set aside with the code already_shown (counted), the prompt named every shown character, and no model review was spent on them', par().free_set_aside?.already_shown === 3 && SHOWN.every((k) => bodies.free.prompt.includes(k)), JSON.stringify(par().free_set_aside))
  check('(2) …the free call asked for five options within the new token ceiling', bodies.free.max_tokens === 2600)

  // ---- (3) every option repeats an earlier character → the second pair, then a spare card from the main/second calls -----------------------------------------------------------------------------
  reset()
  const r3 = await run(BIRTHDAY, 2, SHOWN)
  const fb = par().free_fallbacks ?? []
  check('(3) round 2, every free option in BOTH pairs repeats an earlier character: the 遊び字 still appears — the unused candidate of the main call (its runner-up), shown in the free slot', live(r3).length === 2 && live(r3).some((c) => c.slot === 'freestyle') && !SHOWN.includes(live(r3).find((c) => c.slot === 'freestyle')!.kanji), sum(r3))
  check('(3) …the free slot holds a candidate the main card did not take, and it is not a character shown before', (() => { const f = live(r3).find((c) => c.slot === 'freestyle')!; return f.kanji === '守' && live(r3).filter((c) => c.kanji === f.kanji).length === 1 })(), sum(r3))
  check('(3) …source "runner_up"; two fallbacks logged — retry then runner_up — each with the reason already_shown; the second pair was asked once, no third pair', par().free_source === 'runner_up' && fb.length === 2 && fb[0].to === 'retry' && fb[1].to === 'runner_up' && fb.every((f: any) => f.why.includes('already_shown')) && counts.free === 4, JSON.stringify({ s: par().free_source, fb, free: counts.free }))
  check('(3) …the engine log line carries it: "[ichirei-engine] free_source" with round 2, source runner_up and the fallbacks', logs.some((l) => l.startsWith('[ichirei-engine] free_source') && l.includes('"round":2') && l.includes('"source":"runner_up"') && l.includes('already_shown')))
  check('(3) …the /ops callback gets the round, the source and the reasons in codes', freeInfos.length === 1 && freeInfos[0].round === 2 && freeInfos[0].source === 'runner_up' && freeInfos[0].reasons.includes('already_shown'), JSON.stringify(freeInfos))
  check('(3) …the card is shown as the free card in the progressive events too: main, then main+free; no second-lane call was made', events.map((e) => e.slots).join('|') === 'main|main,freestyle' && !counts.second, JSON.stringify(events))
  check('(3) …the spare card carries the free card\'s fields (reading, a verbatim anchor from the story, a line) and is an ordinary contract card', (() => { const f = live(r3).find((c) => c.slot === 'freestyle')!; return f.reading !== '' && STORY.includes(f.story_anchor) && f.one_line_gaze !== '' && f.truth_type === 'Play' })())

  // round 3: the same, with six characters shown
  const r3b = await run(BIRTHDAY, 3, [...SHOWN, '朝'])
  check('(3) round 3 (six characters shown): one 本命 and one 遊び字 as well', live(r3b).length === 2 && par().free_source === 'runner_up', sum(r3b))

  // ---- (4) the second pair succeeds ---------------------------------------------------------------------------------------------------------------------------------------------------------
  reset()
  freeAsk = [{ candidates: repeats() }, { candidates: [F_朝(), F_箱()] }]
  const r4 = await run(BIRTHDAY, 2, SHOWN)
  check('(4) the first pair repeats shown characters, the second pair gives a fresh one: two cards, source "retry", one fallback (retry) with the reason already_shown', sum(r4) === 'main:誠,freestyle:朝' && par().free_source === 'retry' && par().free_fallbacks.length === 1 && par().free_fallbacks[0].why.includes('already_shown'), sum(r4) + JSON.stringify(par().free_fallbacks))

  // ---- (4b) the other way the slot used to stay empty: the options are NEW characters, but they stand on the main card's sentence (a short story has no other place) ---------------------------------
  reset()
  freeAsk = [{ candidates: [F('朝', 'あさ', '車の窓の霜'), F('箱', 'はこ', '車の窓の霜をお湯で溶かして')] }, { candidates: [F('朝', 'あさ', '車の窓の霜'), F('箱', 'はこ', '車の窓の霜をお湯で溶かして')] }]
  const r4b = await run(BIRTHDAY, 2, SHOWN)
  const f4b = live(r4b).find((c) => c.slot === 'freestyle')
  check('(4b) round 2, the free options are new characters but all stand on the main card\'s place in the story: they are set aside (same_anchor) in both pairs, and the 遊び字 is the main call\'s spare — two cards, source runner_up, reason same_anchor', live(r4b).length === 2 && !!f4b && f4b.kanji === '守' && par().free_source === 'runner_up' && par().free_fallbacks.every((f: any) => f.why.includes('same_anchor')) && par().free_set_aside?.same_anchor >= 2, sum(r4b) + JSON.stringify({ fb: par().free_fallbacks, aside: par().free_set_aside }))

  // ---- (5) the spare card goes through the normal review ---------------------------------------------------------------------------------------------------------------------------------
  reset()
  vetoed = new Set(['守'])
  const r5b = await run(BIRTHDAY, 2, SHOWN)
  check('(5) when the only spare is rejected by the review, nothing weak is forced in — the last-resort refill is asked (and has nothing) — and the log says why (source none; reasons already_shown and the review rule)', sum(r5b) === 'main:誠' && par().free_source === null && freeInfos[0]?.source === null && freeInfos[0].reasons.some((x) => x.startsWith('review:')), sum(r5b) + JSON.stringify(freeInfos))
  check('(5) …and the refill for the 遊び字 was tried once before the round ended', (counts.refill ?? 0) >= 1, JSON.stringify(counts))

  // ---- (6) the spare card must not be a character the main or second card took; excluded spares are not shown -----------------------------------------------------------------------------
  reset()
  const r6 = await run(BIRTHDAY, 2, [...SHOWN, '守'])
  check('(6) a spare that was shown in an earlier round is never used (守 is excluded → no spare; the refill finds nothing)', !live(r6).some((c) => c.kanji === '守'), sum(r6))

  // ---- (7) the main cards never wait for the free pick ---------------------------------------------------------------------------------------------------------------------------------------
  reset()
  freeDelay = 400
  const r7 = await run(BIRTHDAY, 2, SHOWN)
  check('(7) the main card is shown long before the free pick finishes its pairs (slow free calls): main < 250 ms, the free card last', events.length === 2 && events[0].at < 250 && events[1].at > events[0].at && live(r7).length === 2, JSON.stringify(events))
  // Part 0: a reviewed 遊び字 is never dropped as "late" — however long it takes, it is shown
  freeDelay = 1800
  freeAsk = [{ candidates: [F_朝(), F_箱()] }, { candidates: [] }]
  const r7b = await run(BIRTHDAY, 1, [])
  check('(7) Part 0: a free card that arrives long after the main card (1.8 s per free call here) is still shown, final, and nothing is dropped as late', sum(r7b) === 'main:誠,freestyle:朝' && par().free_dropped == null && events.at(-1)?.slots === 'main,freestyle', sum(r7b) + JSON.stringify(events))

  // ---- (8) switches ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  reset()
  process.env.ICHIREI_FREE_RUNNER_UP = 'off'
  const r8 = await run(BIRTHDAY, 2, SHOWN)
  check('(8) ICHIREI_FREE_RUNNER_UP=off switches the third step off (rollback): the 遊び字 has no spare, source none', sum(r8) === 'main:誠' && par().free_source === null)
  reset()

  // ---- (9) remembrance keeps two cards, with no free call at all --------------------------------------------------------------------------------------------------------------------------------
  const r9 = await run(MEMORIAL, 2, [])
  check('(9) remembrance (偲ぶ): 本命 + 次点 (the only place `second` remains), no free call, no spare card, nothing counted for /ops', sum(r9) === 'main:誠,second:灯' && counts.free === 0 && counts.second === 1 && freeInfos.length === 0, sum(r9) + JSON.stringify(counts))
  // Part 0: a remembrance 次点 replaced by its runner-up leaves exactly ONE second card
  vetoed = new Set(['灯'])
  const r9b = await run(MEMORIAL, 2, [])
  check('(9) Part 0: the 次点 灯 fails the review and the runner-up 待 replaces it — exactly one `second` card, never two', sum(r9b) === 'main:誠,second:待' && r9b.candidates.filter((c) => !c.eliminated && c.slot === 'second').length === 1, sum(r9b))
  reset()

  // ---- (10) round 1 is unchanged ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  freeAsk = [{ candidates: [F_朝(), F_箱()] }, { candidates: [] }]
  const r10 = await run(BIRTHDAY, 1, [])
  check('(10) round 1: a 本命 and a 遊び字 from the first pair, source "first", no fallback, no spare', sum(r10) === 'main:誠,freestyle:朝' && par().free_source === 'first' && par().free_fallbacks.length === 0 && freeInfos[0]?.round === 1)

  // ---- (10b) rounds 1-3: always exactly one 本命 and one 遊び字, even when every free option repeats a shown character; the second lane is never called outside remembrance
  for (const [round, shown] of [[1, []], [2, SHOWN], [3, [...SHOWN, '朝']]] as [number, string[]][]) {
    reset()
    freeAsk = [{ candidates: repeats() }, { candidates: repeats() }]
    const rr = await run(BIRTHDAY, round, shown)
    const lv = live(rr)
    check(`(10b) round ${round}: exactly one 本命 and one 遊び字 (${sum(rr)}), no second card, no second-lane call`, lv.filter((c) => c.slot === 'main').length === 1 && lv.filter((c) => c.slot === 'freestyle').length === 1 && lv.length === 2 && !counts.second, sum(rr) + JSON.stringify(counts))
  }
  reset()

  // ---- (11) the codes ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  check('(11) set-aside reasons become short codes (no story text)', setAsideCode('palette: already shown for this story') === 'already_shown' && setAsideCode('slots: same story detail as the main card') === 'same_anchor' && setAsideCode('review: dignity: could read as a negative trait') === 'review:dignity' && setAsideCode('subject: the quoted act is the narrator\'s own, not the receiver\'s') === 'subject' && setAsideCode(null) === 'other')

  // ---- (12) the /ops count -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const store = new MemoryOrderStore()
  const now = new Date()
  await recordFreeSource(store, { round: 1, source: 'first', reasons: [] }, now)
  await recordFreeSource(store, { round: 2, source: 'runner_up', reasons: ['already_shown', 'Same Anchor!'] }, now)
  await recordFreeSource(store, { round: 3, source: null, reasons: ['late'] }, now)
  const c = await readFreeSourceCounts(store, [analyticsDay(now)])
  const stored = (store.lines.get(`ops/cards-${analyticsDay(now)}.jsonl`) ?? []).join('\n')
  check('(12) /ops counts: runs, by source, by round and by reason', c.runs === 3 && c.by_source.first === 1 && c.by_source.runner_up === 1 && c.by_source.none === 1 && c.by_round[2].runner_up === 1 && c.by_round[3].none === 1 && c.reasons.already_shown === 1 && c.reasons.late === 1, JSON.stringify(c))
  check('(12) …only codes are stored: no story, no character, no session id (reasons are cleaned to lower-case codes)', !/父|朝|誠|session/.test(stored) && stored.includes('sameanchor'), stored)

  // ---- (13) the owner's page shows the counts -------------------------------------------------------------------------------------------------------------------------------------------------------
  const O = createOpsHandlers((): OpsDeps => ({ store, env: { ICHIREI_OPS_PASSWORD: 'correct horse' } as NodeJS.ProcessEnv, now: () => now, mailer: async () => true, payments: async () => ({ found: new Map(), failure: null }), shipping: async () => ({ found: new Map(), failure: null }) }))
  const page = await (await O.page(new Request('https://ichirei.example/ops', { headers: { authorization: `Basic ${Buffer.from('owner:correct horse').toString('base64')}` } }))).text()
  const part = page.slice(page.indexOf('遊び字の出どころ'))
  check('(13) /ops shows the free card\'s sources for the last 8 days — per round: first, retry, runner_up, none — and the reasons with their counts', part.includes('class="freeT"') && /<td>2回目<\/td><td>0<\/td><td>0<\/td><td>1<\/td><td>0<\/td>/.test(part) && /<td>3回目<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>1<\/td>/.test(part) && /合計（3回）/.test(part) && part.includes('already_shown 1') && part.includes('late 1'), part.slice(0, 700))
  check('(13) …only codes and counts are on the page: no story, no character', !/父|朝|誠/.test(part))

  // ---- (14) the main character of every run, and the owner's top 10 over 30 days ------------------------------------------------------------------------------------------------------------------
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000)
  const mains = [['誠', 0], ['誠', 0], ['誠', 3], ['常', 5], ['守', 9], ['灯', 12], ['待', 20], ['信', 25], ['恩', 27], ['想', 28], ['箱', 29], ['朝', 29], ['雪', 40]] as const
  for (const [k, d] of mains) await recordMain(store, { round: 1, language: 'ja', main: k }, day(d))
  await recordMain(store, { round: 2, language: 'ja', main: 'ab' }, now) // not one character → not recorded
  const days30 = Array.from({ length: 30 }, (_, i) => analyticsDay(day(i)))
  const mc = await readMainCounts(store, days30)
  check('(14) the main characters of the last 30 days are counted, most common first (誠 3, then the rest), at most ten, older than 30 days left out, junk not recorded', mc.runs === 12 && mc.top.length === 10 && mc.top[0].kanji === '誠' && mc.top[0].count === 3 && mc.top[0].share === 25 && !mc.top.some((t) => t.kanji === '雪'), JSON.stringify(mc))
  const page2 = await (await O.page(new Request('https://ichirei.example/ops', { headers: { authorization: `Basic ${Buffer.from('owner:correct horse').toString('base64')}` } }))).text()
  const mpart = page2.slice(page2.indexOf('本命（メインの字）上位10（直近30日）'))
  check('(14) /ops shows the top 10 table with the character, the count and the share', mpart.includes('class="mainT"') && /<td>1<\/td><td class="k">誠<\/td><td>3<\/td><td>25%<\/td>/.test(mpart) && mpart.includes('全12回'), mpart.slice(0, 400))
} finally {
  console.log = origLog
  upstream.close()
}
if (failures > 0) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nAll three-card checks passed.')
