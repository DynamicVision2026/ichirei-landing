// The story-run script (scripts/run-story-db.mjs): the row → context mapping, the occasion rule, the flags, the CSV and the summary,
// and one real end-to-end run of the script against a FAKE model with a tiny made-up database (no key, no cost, no private data).
//   node --experimental-strip-types scripts/test-story-run.ts

import http from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCsv } from '../engine/palette.ts'
// @ts-expect-error — a plain .mjs module
import { describeRun, directionFor, estimate, occasionFor, relationshipFor, sameness, selectRows, summarize, toCsv } from './run-story-db.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const row = (o: Record<string, string>) => ({ id: '0001', test_use: 'main', category: 'parents', sender_to_receiver: '娘→父', direction: 'up', receiver_alive: 'yes', occasions: 'thanks / birthday', test_story_ja: 'x', ...o })

// ---- selection and the occasion rule ------------------------------------------------------------------------------------
const rows = [row({ id: '1' }), row({ id: '2', test_use: 'edge', receiver_alive: 'no' }), row({ id: '3', test_use: 'edge', receiver_alive: 'yes' }), row({ id: '4', test_use: 'exclude', receiver_alive: 'no' }), row({ id: '5', test_use: 'main', receiver_alive: 'unclear' })]
check('selection: every `main` row plus every row with receiver_alive = no (and nothing else)', selectRows(rows).map((r: any) => r.id).join() === '1,2,4,5' && selectRows(rows, 'main').map((r: any) => r.id).join() === '1,5' && selectRows(rows, 'memorial').map((r: any) => r.id).join() === '2,4')
check('occasion: receiver_alive = no → memorial; otherwise the FIRST entry of occasions (mapped to the engine codes); empty or none → thanks (seasonal_thanks)', occasionFor(row({ receiver_alive: 'no', occasions: 'birthday' })).code === 'memorial' && occasionFor(row({ occasions: 'thanks / birthday' })).code === 'seasonal_thanks' && occasionFor(row({ occasions: 'birthday / thanks' })).code === 'birthday_milestone' && occasionFor(row({ occasions: 'kanreki / retirement' })).code === 'birthday_milestone' && occasionFor(row({ occasions: 'anniversary' })).code === 'wedding' && occasionFor(row({ occasions: 'new_start' })).code === 'school_career' && occasionFor(row({ occasions: 'farewell' })).code === 'retirement_farewell' && occasionFor(row({ occasions: 'parents_day / thanks' })).code === 'parent_day' && occasionFor(row({ occasions: 'none' })).code === 'seasonal_thanks' && occasionFor(row({ occasions: '' })).code === 'seasonal_thanks' && occasionFor(row({ occasions: 'none' })).from === 'thanks (empty)')
check('relationship / direction come from the row\'s metadata (category, receiver word, direction column)', relationshipFor(row({ sender_to_receiver: '娘→母' })) === 'parent_mother' && relationshipFor(row({ sender_to_receiver: '娘→父' })) === 'parent_father' && relationshipFor(row({ sender_to_receiver: '妻→義母' })) === 'in_law' && relationshipFor(row({ category: 'children', sender_to_receiver: '父→娘' })) === 'child' && relationshipFor(row({ category: 'partner', sender_to_receiver: '夫→妻' })) === 'spouse' && relationshipFor(row({ category: 'partner', sender_to_receiver: '私→彼女' })) === 'romance' && relationshipFor(row({ category: 'other', sender_to_receiver: '私→飼い猫' })) === 'pet' && relationshipFor(row({ category: 'other', sender_to_receiver: '私→常連客' })) === 'community' && directionFor(row({ direction: 'down' })) === 'down' && directionFor(row({ direction: '—', category: 'children' })) === 'down')
check('cost estimate: ≈ $0.2 per run on the stated assumptions (so ≈ $29 for 144), always shown as an estimate with a range', Math.abs(estimate(144).total - 144 * estimate(1).total) < 1e-9 && estimate(144).total > 15 && estimate(144).total < 50 && estimate(144).low < estimate(144).total && estimate(144).high > estimate(144).total)

// ---- the flags ------------------------------------------------------------------------------------------------------------
const cand = (slot: string, kanji: string, over: Record<string, unknown> = {}) => ({ slot, kanji, inscription_form: null, reading: 'よみ', one_line_gaze: `${kanji}の人`, story_anchor: 'a', eliminated: false, eliminated_reason: null, flags: [], ...over })
const result = (occasion: string, cands: any[], primary: string, extra: Record<string, unknown> = {}) => ({ status: 'sufficient', language: 'ja', occasion, candidates: cands, primary_kanji: primary, referee: { actions: [] }, review: { ran: true, skipped_reason: null, verdicts: [] }, ...extra })
const run = (r: any, occasion = 'memorial') => describeRun(row({ id: '9', test_story_ja: 'x'.repeat(10), receiver_alive: occasion === 'memorial' ? 'no' : 'yes' }), { occasion, occasion_from: 'x', relationship: 'parent_father', direction: 'up' }, { seconds: 12.3, input_tokens: 1000, output_tokens: 2000, cost: 0.033, result: r })
const clean = run(result('memorial', [cand('main', '灯', { inscription_form: '燈' }), cand('second', '守'), cand('freestyle', '笑')], '灯'))
check('a clean memorial result raises no flag (灯 main, the memorial data path to the workshop is intact)', clean.flags === '' && clean.main === '灯' && clean.kanji_main === '灯' && clean.kanji_freestyle === '笑' && clean.slot_labels.includes('灯=本命') && clean.slot_labels.includes('笑=遊び字'), JSON.stringify(clean))
check('flag: a celebration character on a live memorial candidate (here the freestyle 祝)', run(result('memorial', [cand('main', '灯'), cand('second', '守'), cand('freestyle', '祝')], '灯')).flags.includes('celebration_on_memorial(祝)'))
check('flag: cinnabar on a memorial result — if the result does not carry the memorial occasion, the colour rule would draw the main in cinnabar', run(result('parent_day', [cand('main', '灯'), cand('second', '守')], '灯')).flags.includes('cinnabar_on_memorial'))
check('flag: the memorial data path is checked from the very result (certificate.memorial and ichirei_memorial=yes)', !clean.flags.includes('memorial_data_path_broken') && run(result('parent_day', [cand('main', '灯'), cand('second', '守')], '灯')).flags.includes('memorial_data_path_broken'))
check('an eliminated celebration character is not a flag (the referee did its job) and is shown as ×', run(result('memorial', [cand('main', '祝', { eliminated: true, eliminated_reason: 'palette: blocked_occasion' }), cand('second', '灯'), cand('freestyle', '笑')], '灯')).flags === '' )
check('flag: an error / a timeout is a row of its own with the message and the flag', describeRun(row({}), { occasion: 'seasonal_thanks', occasion_from: 'thanks', relationship: 'child', direction: 'down' }, { seconds: 300, input_tokens: 0, output_tokens: 0, cost: 0, error: 'TimeoutError: aborted', timedOut: true }).flags === 'timeout' && describeRun(row({}), { occasion: 'seasonal_thanks', occasion_from: 'thanks', relationship: 'child', direction: 'down' }, { seconds: 1, input_tokens: 0, output_tokens: 0, cost: 0, error: 'Error: boom' }).flags === 'error')
check('an insufficient result is recorded with the follow-up question', run({ status: 'insufficient', occasion: 'memorial', candidates: [], primary_kanji: null, follow_up_question: 'もう少し教えてください', referee: { actions: [] } }, 'memorial').follow_up_question === 'もう少し教えてください')
const many = Array.from({ length: 20 }, (_, i) => ({ main: i < 4 ? '灯' : `字${i}` }))
check('sameness: a main kanji in more than 10% of runs is flagged (灯 in 4 of 20 = 20%), one in exactly 10% is not; with under 20 runs nothing is flagged', sameness(many).over.length === 1 && sameness(many.slice(0, 5)).over.length === 0 && sameness(many).over[0][0] === '灯' && sameness(Array.from({ length: 20 }, (_, i) => ({ main: i < 2 ? '灯' : `字${i}` }))).over.length === 0)
const summary = summarize([{ ...clean, _flags: [] }, { ...run(result('parent_day', [cand('main', '灯'), cand('second', '守')], '灯'), 'parent_day'), _flags: [] }], { priceIn: 3, priceOut: 15 })
check('summary: cost, kanji per category, the most repeated characters, flags, memorial counts — and the rates are labelled as assumed', /Cost estimate: \$0\.07/.test(summary) && summary.includes('Kanji spread per category') && summary.includes('Most repeated main kanji') && summary.includes('Flags raised') && summary.includes('assumed rates') && summary.includes('Memorial runs'), summary)
check('CSV quoting: commas, quotes and newlines survive', toCsv([['a,b', 'c"d', 'e\nf']]) === '"a,b","c""d","e\nf"\n')

// ---- end to end against a fake model with a tiny made-up database ------------------------------------------------------------
const FIX = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'memorial-story.json'), 'utf8'))
const LIVE = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', 'living-parent.json'), 'utf8'))
let calls = 0
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const review = prompt.includes('Independent Review Prompt')
  calls++
  const memorial = prompt.includes('occasion: memorial')
  const reply = review ? (memorial ? FIX.review_reply : LIVE.review_reply) : memorial ? FIX.model_reply : LIVE.model_reply
  const text = JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2000 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
const dir = mkdtempSync(join(tmpdir(), 'story-run-test-'))
const header = ['id', 'test_use', 'category', 'sender_to_receiver', 'direction', 'receiver_alive', 'occasions', 'emotion', 'themes', 'key_moment_ja', 'test_story_ja', 'test_story_chars', 'note', 'title', 'url']
const dbRows = [
  ['T1', 'main', 'parents', '娘→父', 'up', 'yes', 'parents_day / thanks', 'grateful', '', '', LIVE.story, '0', '', '', ''],
  ['T2', 'edge', 'parents', '娘→父', 'up', 'no', 'birthday', 'longing', '', '', FIX.story, '0', '', '', ''],
]
writeFileSync(join(dir, 'db.csv'), toCsv([header, ...dbRows]))
const env = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, ANTHROPIC_API_KEY: 'test-key-not-real' }
let out = ''
try {
  out = await new Promise<string>((resolve, reject) => {
    import('node:child_process').then(({ execFile }) =>
      execFile('node', ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/run-story-db.mjs', '--db', join(dir, 'db.csv'), '--out', dir, '--concurrency', '2'], { env, cwd: process.cwd() }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr) + String(stdout))) : resolve(stdout))),
    )
  })
} catch (e) {
  out = String(e)
}
const files = readdirSync(dir)
const csvName = files.find((f) => /^story-run-\d{8}\.csv$/.test(f))
check('end to end: story-run-YYYYMMDD.csv (+ .jsonl and -summary.txt) are written next to --out', !!csvName && files.some((f) => f.endsWith('.jsonl')) && files.some((f) => f.endsWith('-summary.txt')), out + files.join())
if (csvName) {
  const [h, ...b] = parseCsv(readFileSync(join(dir, csvName), 'utf8').replace(/^﻿/, ''))
  const rec = (id: string) => Object.fromEntries(h.map((k, i) => [k, b.find((r) => r[0] === id)?.[i] ?? ''])) as Record<string, string>
  check('end to end: the CSV has the review columns (three kanji, slot labels, readings, one-line gazes, referee, review, follow-up, time, cost)', ['kanji_main', 'kanji_second', 'kanji_freestyle', 'slot_labels', 'readings', 'gaze_main', 'gaze_second', 'gaze_freestyle', 'referee', 'review', 'follow_up_question', 'seconds', 'cost_usd_est', 'occasion_used'].every((c) => h.includes(c)) && b.length === 2)
  const t1 = rec('T1')
  const t2 = rec('T2')
  check('end to end: the living-parent row ran as parent_day (first occasion entry), the receiver_alive = no row ran as memorial', t1.occasion_used === 'parent_day' && t2.occasion_used === 'memorial' && t2.occasion_db === 'receiver_alive=no')
  check('end to end: the memorial row — the referee removed the celebration characters (祝, 喜), 灯 is the main, no flag; the living row keeps 祝', t2.kanji_main === '灯' && t2.eliminated.includes('祝:palette: blocked_occasion') && t2.eliminated.includes('喜:') && t2.flags === '' && t1.kanji_main === '祝' && t1.flags === '', JSON.stringify([t1, t2]))
  check('end to end: tokens and cost are summed from the model\'s usage (2 calls per run: select + review), the review verdicts are in the row', Number(t1.input_tokens) === 2000 && Number(t1.output_tokens) === 4000 && Number(t1.cost_usd_est) > 0 && t1.review.includes('祝:pass'), JSON.stringify(t1))
}
check('end to end: five model calls for two stories — select + review each, plus one replacement attempt for the memorial row that lost its second card (the fake model has nothing to offer)', calls === 5, String(calls))
upstream.close()

// ---- end to end against a fake /api/select (the --target path: streaming NDJSON, no key) ------------------------------------
const bodies: any[] = []
let inFlight = 0
let maxInFlight = 0
const site = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  bodies.push({ path: req.url, body })
  inFlight++
  maxInFlight = Math.max(maxInFlight, inFlight)
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' })
  res.write(JSON.stringify({ type: 'delta', chars: 200 }) + '\n')
  await new Promise((r) => setTimeout(r, 30))
  res.write(JSON.stringify({ type: 'ping' }) + '\n')
  // T1 (living) gets a result split across two chunks; T2 (memorial) gets a terminal error line
  if (body.occasion === 'memorial') res.write(JSON.stringify({ type: 'error', error: 'Engine failed: overloaded' }) + '\n')
  else {
    const line = JSON.stringify({ type: 'result', result: result('parent_day', [cand('main', '迎'), cand('second', '守'), cand('freestyle', '笑')], '迎') }) + '\n'
    res.write(line.slice(0, 40))
    await new Promise((r) => setTimeout(r, 10))
    res.write(line.slice(40))
  }
  inFlight--
  res.end()
})
await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
const dir2 = mkdtempSync(join(tmpdir(), 'story-run-api-test-'))
writeFileSync(join(dir2, 'db.csv'), toCsv([header, ...dbRows]))
const { ANTHROPIC_API_KEY: _drop, ...envNoKey } = process.env
let out2 = ''
try {
  out2 = await new Promise<string>((resolve, reject) => {
    import('node:child_process').then(({ execFile }) =>
      execFile('node', ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/run-story-db.mjs', '--db', join(dir2, 'db.csv'), '--out', dir2, '--target', `http://127.0.0.1:${(site.address() as { port: number }).port}/`], { env: envNoKey, cwd: process.cwd() }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr) + String(stdout))) : resolve(stdout))),
    )
  })
} catch (e) {
  out2 = String(e)
}
site.close()
check('--target <url>: no ANTHROPIC_API_KEY needed, POST /api/select once per story, one at a time by default', bodies.length === 2 && bodies.every((b) => b.path === '/api/select') && maxInFlight === 1, out2 + JSON.stringify(bodies))
check('--target <url>: the body is the website\'s (story + condition A + language/relationship/direction/occasion), with no session id (no analytics)', bodies.length === 2 && bodies[0].body.story === LIVE.story && bodies[0].body.condition === 'A' && bodies[0].body.language === 'ja' && bodies[0].body.relationship === 'parent_father' && bodies[0].body.direction === 'up' && bodies[0].body.occasion === 'parent_day' && bodies[1].body.occasion === 'memorial' && bodies.every((b) => !('session' in b.body)), JSON.stringify(bodies))
const csv2 = readdirSync(dir2).find((f) => /^story-run-\d{8}\.csv$/.test(f))
if (csv2) {
  const [h, ...b] = parseCsv(readFileSync(join(dir2, csv2), 'utf8').replace(/^﻿/, ''))
  const rec = (id: string) => Object.fromEntries(h.map((k, i) => [k, b.find((r) => r[0] === id)?.[i] ?? ''])) as Record<string, string>
  const a1 = rec('T1')
  const a2 = rec('T2')
  check('--target <url>: the streamed result becomes a normal row (three kanji, measured seconds), tokens and cost left blank', a1.status === 'sufficient' && a1.kanji_main === '迎' && a1.kanji_freestyle === '笑' && Number(a1.seconds) > 0 && a1.input_tokens === '' && a1.cost_usd_est === '', JSON.stringify(a1))
  check('--target <url>: a terminal error line is reported as an error row with the server\'s message (never a made-up result)', a2.status === 'error' && a2.flags === 'error' && a2.error.includes('overloaded') && a2.kanji_main === '', JSON.stringify(a2))
  const sum2 = readFileSync(join(dir2, csv2.replace('.csv', '-summary.txt')), 'utf8')
  check('--target <url>: the summary says cost is not measured and lists the time per run', sum2.includes('Cost: not measured') && sum2.includes('T1 ') && sum2.includes('T2 '), sum2)
} else check('--target <url>: the CSV is written', false, out2)

if (failures > 0) {
  console.log(`\n${failures} story-run check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll story-run checks passed.')
