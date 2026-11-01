// v6 engine tests: two MAIN candidates + one FREESTYLE (遊び字), the emotional register, classical
// lines from reviewed palette rows only, REQUIRE_CLASSICAL_ECHO, the separate review call, and the
// story-length limit — against a fake Anthropic upstream that answers the selection call and the
// review call differently. The four fixtures (a solemn parent, playful classmates, an insult-type
// joke caught by the palette, one caught only by the review) live in scripts/fixtures-v6/.
// No key, no network, no real model.
//
//   node --experimental-strip-types scripts/test-v6.ts

import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { FOLLOW_UP_MAX, MAX_FOLLOW_UPS, REVIEW_VETO_RULES, STORY_MAX, countChars, mergeStory, parseFollowUps, validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { applyPalette, applyReviewVerdicts, classicalEchoOf, loadPalette, parseFreestyleBlocklist, parsePalette, FREESTYLE_CATEGORIES } from '../engine/palette.ts'
import { REVIEW_SLOTS, fillReviewPrompt, loadReviewPrompt, parseVerdicts, reviewItems } from '../engine/review.ts'
import { parseOrderRequest } from '../engine/order.ts'
import { POST as selectPost } from '../api/select.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const FIX = Object.fromEntries(
  readdirSync(join(process.cwd(), 'scripts', 'fixtures-v6')).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-v6', f), 'utf8'))
    return [j.name.split('-')[0], j]
  }),
) as Record<string, { name: string; story: string; context: any; model_reply: any; review_reply: any; expect: any }>

// ---- a fake upstream: one reply for the selection call, another for the review call ----------------
const seen: { kind: 'select' | 'review'; prompt: string }[] = []
let selectReply: unknown = null
let reviewReply: unknown = null
let reviewMode: 'ok' | 'garbage' | 'http500' = 'ok'
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const prompt = String(body.messages[0].content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : 'select'
  seen.push({ kind, prompt })
  if (kind === 'review' && reviewMode === 'http500') {
    res.writeHead(500, { 'content-type': 'application/json' })
    return res.end('{"error":{"type":"api_error","message":"boom"}}')
  }
  const payload = kind === 'review' ? (reviewMode === 'garbage' ? 'I think they are all fine.' : reviewReply) : selectReply
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off' // these suites pin the palette engine's own call sequence; the lexicon modes have their own suite (test-v9.ts)
delete process.env.ICHIREI_REVIEW
delete process.env.REQUIRE_CLASSICAL_ECHO

const logLines: string[] = []
const origLog = console.log
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-review]')) logLines.push(l); else origLog(...a) }
  try { return await fn() } finally { console.log = origLog }
}
const run = async (key: string, mutate?: (reply: any, review: any) => void) => {
  const f = FIX[key]
  const reply = clone(f.model_reply)
  const review = clone(f.review_reply)
  mutate?.(reply, review)
  selectReply = reply
  reviewReply = review
  seen.length = 0
  logLines.length = 0
  return quiet(() => runEngine(f.story, 'A', { context: f.context }))
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const bySlot = (r: EngineResult, slot: string) => r.candidates.find((c) => c.slot === slot)

try {
  // =============================================================================================
  // 1. The four fixtures (+ the no-main case), end to end
  // =============================================================================================
  const a = await run('a')
  check('(a) solemn parent: sufficient, conforms to the v6 contract', a.status === 'sufficient' && validateEngineResult(a).length === 0, validateEngineResult(a).join('; '))
  check('(a) exactly three candidates in slots main, second, freestyle; primary 証, second 守, freestyle 封', a.candidates.map((c) => c.slot).join() === 'main,second,freestyle' && a.primary_kanji === '証' && a.runner_up_kanji === '守' && a.freestyle_kanji === '封' && live(a).length === 3)
  check('(a) the emotional register is read from the story and carried (grateful, tender)', a.fingerprint.emotional_register?.join() === 'grateful,tender')
  check('(a) main and second are different truth types; the freestyle is "Play" and never the primary', bySlot(a, 'main')!.truth_type !== bySlot(a, 'second')!.truth_type && bySlot(a, 'freestyle')!.truth_type === 'Play' && a.primary_kanji !== a.freestyle_kanji)
  check('(a) the review call ran once, with verdicts for all three, and the result records them', seen.filter((s) => s.kind === 'review').length === 1 && a.review?.ran === true && a.review.verdicts.length === 3 && a.review.verdicts.every((v) => v.pass))
  check('(a) the review is a FRESH call: it does not contain the selection prompt or its reasoning', !seen.find((s) => s.kind === 'review')!.prompt.includes('Abandonment Resistance') && !seen.find((s) => s.kind === 'review')!.prompt.includes('HARD PROCESS RULES') && seen.find((s) => s.kind === 'review')!.prompt.includes(FIX.a.story))
  check('(a) the verdicts are logged on one [ichirei-review] line, and the story is NOT in the log', logLines.length === 1 && logLines[0].includes('"ran":true') && logLines[0].includes('証') && !logLines[0].includes('口下手') && !logLines[0].includes(FIX.a.story.slice(0, 12)), logLines.join('\n'))
  check('(a) no classical line anywhere: no palette row is reviewed yet, so nothing is shown', a.candidates.every((c) => c.classical_echo === null))

  const b = await run('b')
  check('(b) playful classmates: a freestyle 遅 survives (anchor is verbatim, review passes), alongside main 来 and second 待', validateEngineResult(b).length === 0 && b.freestyle_kanji === '遅' && b.primary_kanji === '来' && b.runner_up_kanji === '待' && live(b).length === 3, validateEngineResult(b).join('; '))
  check('(b) the freestyle is an ordinary, unlovely character with NO palette row — allowed for this slot only', loadPalette().lookup('ja', '遅') === undefined && bySlot(b, 'freestyle')!.eliminated === false)
  check('(b) the register is playful (+ grateful) and the freestyle gaze is one light line', b.fingerprint.emotional_register?.[0] === 'playful' && !bySlot(b, 'freestyle')!.one_line_gaze.includes('\n'))

  const c1 = await run('c1')
  const free1 = bySlot(c1, 'freestyle')!
  check('(c1) insult-type joke (また太ったな): the freestyle 太 is refused by the palette freestyle blocklist — eliminated, reason names the category', free1.eliminated === true && free1.eliminated_reason === 'palette: freestyle_blocked (weight)' && c1.freestyle_kanji === null && free1.flags.includes('freestyle_blocked'), JSON.stringify(free1))
  check('(c1) the two main candidates are untouched and the result still conforms (2 live + the refused freestyle kept as eliminated)', c1.primary_kanji === '夜' && c1.runner_up_kanji === '守' && live(c1).length === 2 && validateEngineResult(c1).length === 0, validateEngineResult(c1).join('; '))
  check('(c1) the refused freestyle never reaches the reviewer', !seen.find((s) => s.kind === 'review')!.prompt.includes('また太ったな') || !JSON.stringify(reviewItems(c1, loadPalette())).includes('太'))
  check('(c1) a refusal is recorded in the referee actions', c1.referee?.actions.some((x) => x.kanji === '太' && x.action === 'freestyle_blocked_eliminated') === true)

  const c2 = await run('c2')
  const free2 = bySlot(c2, 'freestyle')!
  check('(c2) an insult-type joke NOT on the blocklist (下っ端): the referee lets it through, the REVIEW call fails it and it is dropped', seen.find((s) => s.kind === 'review')!.prompt.includes('下っ端') && free2.eliminated === true && free2.eliminated_reason === 'review: Mocks social status: laughing AT him, not with him.' && c2.freestyle_kanji === null && free2.flags.includes('review_failed'), JSON.stringify(free2))
  check('(c2) the verdict is logged (pass: false) and the mains stand', logLines.length === 1 && logLines[0].includes('"pass":false') && c2.primary_kanji === '看' && c2.runner_up_kanji === '残' && validateEngineResult(c2).length === 0)

  const e = await run('e')
  check('(e) both main slots hard-blocked (送, 別): the result is `insufficient` with the model\'s own fallback question — NOT the freestyle promoted', e.status === 'insufficient' && e.follow_up_question === FIX.e.expect.follow_up && e.candidates.length === 0 && e.primary_kanji === null && e.runner_up_kanji === null && e.freestyle_kanji === null && validateEngineResult(e).length === 0, JSON.stringify(e).slice(0, 400))
  check('(e) the referee records why; the review call is never made for an insufficient result', e.referee?.no_eligible_primary === true && e.referee.actions.some((x) => x.action === 'insufficient_no_main') && seen.filter((s) => s.kind === 'review').length === 0)

  // =============================================================================================
  // 2. Promotion: slot 2 replaces slot 1; the freestyle is never promoted
  // =============================================================================================
  const p1 = await run('a', (r) => { r.candidates[0].kanji = '送'; r.primary_kanji = '送' })
  check('referee: slot 1 hard-blocked (送) → slot 2 (守) is promoted, promoted_from "second", the freestyle stays a freestyle', p1.primary_kanji === '守' && p1.referee?.promoted_from === 'second' && p1.referee.primary_changed === true && p1.freestyle_kanji === '封' && p1.runner_up_kanji === null && validateEngineResult(p1).length === 0, validateEngineResult(p1).join('; '))
  check('referee: after a promotion the second slot is consumed — no backup remains', p1.runner_up_kanji === null)
  const p2 = await run('a', (r) => { r.candidates[0].kanji = '送'; r.candidates[1].kanji = '終'; r.primary_kanji = '送'; r.runner_up_kanji = '終' })
  check('referee: BOTH main slots removed → insufficient + fallback question; the freestyle (封) is never promoted to primary', p2.status === 'insufficient' && p2.primary_kanji === null && p2.freestyle_kanji === null && p2.follow_up_question === FIX.a.model_reply.fallback_follow_up_question)
  const p3 = await run('a', (r) => { r.candidates[0].kanji = '送'; r.primary_kanji = '送'; r.candidates[1].kanji = '証'; r.candidates[1].story_anchor = '作り話のアンカー'; r.runner_up_kanji = '証' })
  check('referee: slot 2 that is context_required with an invented anchor cannot be promoted → insufficient', p3.status === 'insufficient')
  const p4 = await run('a', (r) => { r.candidates[0].kanji = '送'; r.primary_kanji = '送' })
  check('referee: the review ran on the PROMOTED main (守), not on the removed slot 1', seen.filter((s) => s.kind === 'review').length === 1 && !JSON.stringify(reviewItems(p4, loadPalette()).map((i) => i.kanji)).includes('送') && p4.review?.verdicts.some((v) => v.slot === 'second' && v.kanji === '守') === true)

  // =============================================================================================
  // 3. The freestyle's rules enforced in code
  // =============================================================================================
  const f1 = await run('b', (r) => { r.candidates[2].story_anchor = 'いつも遅刻する人でした' })
  check('freestyle: an anchor that is not a verbatim fragment of the story → no freestyle (2 candidates alive, freestyle_kanji null)', f1.freestyle_kanji === null && bySlot(f1, 'freestyle')!.eliminated_reason === 'freestyle: story_anchor is not a verbatim fragment of the story' && live(f1).length === 2)
  const f2 = await run('b', (r) => { r.candidates[2].kanji = '来'; r.candidates[2].inscription_form = '來' })
  check('freestyle: the same character as a main slot is dropped', f2.freestyle_kanji === null && bySlot(f2, 'freestyle')!.eliminated_reason === 'freestyle: same character as a main slot')
  const f3 = await run('b', (r) => { r.candidates[2].kanji = '死'; r.candidates[2].story_anchor = '待ち合わせにいつも三十分遅れてくる' })
  check('freestyle: palette hard blocks still apply to it (死)', f3.freestyle_kanji === null && bySlot(f3, 'freestyle')!.eliminated_reason === 'palette: hard_block')
  const f4 = await run('b', (r) => { r.candidates[2].kanji = '星'; })
  check('freestyle: blocked_occasions still apply (星 is blocked for a new-baby order)', (() => { const m = clone(FIX.b.model_reply); m.occasion = 'new_baby'; m.candidates[2].kanji = '星'; const out = applyPalette({ ...m, language: 'ja' }, loadPalette(), FIX.b.story); const c = out.candidates.find((x) => x.slot === 'freestyle')!; return c.eliminated === true && c.eliminated_reason === 'palette: blocked_occasion' })() && f4.status === 'sufficient')
  const bl = loadPalette()
  const blocked = (fam: 'ja' | 'zh', ch: string) => bl.freestyleCategory(fam, [ch])
  check('freestyle blocklist: body, appearance, weight, intelligence, status (poverty / stinginess / low standing), sexual, illness, disability and cruelty are all covered, in ja and zh (both scripts) — and money itself is NOT', FREESTYLE_CATEGORIES.every((cat) => ['ja', 'zh'].every((fam) => [...bl.freestyleBlocked].some(([k, v]) => k.startsWith(`${fam}:`) && v === cat))) && blocked('ja', '太') === 'weight' && blocked('ja', '馬') === 'intelligence' && blocked('zh', '胖') === 'weight' && blocked('zh', '窮') === 'status' && blocked('ja', '金') === undefined && blocked('zh', '钱') === undefined && blocked('ja', '銭') === undefined && blocked('zh', '穷') === 'status')
  check('freestyle blocklist: an ordinary playful kanji is NOT blocked (遅, 笑, 茶, 迟)', ['遅', '笑', '茶'].every((c) => !blocked('ja', c)) && !blocked('zh', '迟') && !blocked('zh', '遲'))
  check('freestyle blocklist: parser rejects a bad header, a multi-character entry, an unknown category and duplicates', [
    'language,kanji\nja,太', 'language,kanji,category\nja,太太,weight', 'language,kanji,category\nja,太,odd', 'language,kanji,category\nja,太,weight\nja,太,body',
  ].every((t) => { try { parseFreestyleBlocklist(t); return false } catch { return true } }))
  check('freestyle blocklist: a main slot is never subject to it (太 as a MAIN kanji is only subject to the palette)', (() => { const m = clone(FIX.b.model_reply); m.candidates[0].kanji = '太'; m.candidates[0].inscription_form = null; return !applyPalette({ ...m, language: 'ja' }, loadPalette(), FIX.b.story).candidates[0].eliminated })())
  check('freestyle: only main/second can be the primary — a model that names the freestyle as primary gets slot 1 back? (the validator flags it)', (() => { const m = clone(FIX.b.model_reply); m.primary_kanji = '遅'; return validateEngineResult(applyPalette({ ...m, language: 'ja' }, loadPalette(), FIX.b.story)).some((p) => p.includes('must not be the freestyle')) })())

  // =============================================================================================
  // 4. The review call: failures, disabled, unusable
  // =============================================================================================
  const r1 = await run('a', undefined)
  void r1
  const rv1 = await run('a', (_r, review) => { review.verdicts[0].pass = false; review.verdicts[0].rule = 'occasion'; review.verdicts[0].reason = 'Occasion taboo: ends a celebration.' })
  check('review: slot 1 fails → eliminated "review: …", slot 2 promoted, the freestyle kept', rv1.candidates[0].eliminated === true && rv1.candidates[0].eliminated_reason === 'review: occasion: Occasion taboo: ends a celebration.' && rv1.primary_kanji === '守' && rv1.referee?.promoted_from === 'second' && rv1.freestyle_kanji === '封' && validateEngineResult(rv1).length === 0, validateEngineResult(rv1).join('; '))
  const rv2 = await run('a', (_r, review) => { review.verdicts[0].pass = false; review.verdicts[0].rule = 'dignity'; review.verdicts[1].pass = false; review.verdicts[1].rule = 'register' })
  check('review: both main slots fail → insufficient with the fallback question (the freestyle is not promoted)', rv2.status === 'insufficient' && rv2.follow_up_question === FIX.a.model_reply.fallback_follow_up_question && rv2.freestyle_kanji === null && rv2.review?.verdicts.length === 3)
  const rv3 = await run('a', (_r, review) => { review.verdicts[1].pass = false; review.verdicts[1].rule = 'palette' })
  check('review: slot 2 fails (slot 1 stands) → slot 2 is eliminated and there is no backup', rv3.primary_kanji === '証' && rv3.candidates[1].eliminated === true && rv3.runner_up_kanji === null && validateEngineResult(rv3).length === 0)
  reviewMode = 'garbage'
  const rv4 = await run('a')
  reviewMode = 'ok'
  check('review unusable (unparseable reply): the mains stand on the referee alone, the FREESTYLE is dropped, the skip is recorded and logged', rv4.primary_kanji === '証' && rv4.runner_up_kanji === '守' && rv4.freestyle_kanji === null && bySlot(rv4, 'freestyle')!.eliminated === true && rv4.review?.ran === false && /review call failed/.test(rv4.review?.skipped_reason ?? '') && logLines.length === 1 && logLines[0].includes('"ran":false'), JSON.stringify(rv4.review))
  reviewMode = 'http500'
  const rv5 = await run('a')
  reviewMode = 'ok'
  check('review unusable (the call errors): same fail-closed policy for the freestyle, the customer still gets their two mains', rv5.status === 'sufficient' && rv5.primary_kanji === '証' && rv5.freestyle_kanji === null && rv5.review?.ran === false)
  process.env.ICHIREI_REVIEW = 'off'
  const rv6 = await run('a')
  delete process.env.ICHIREI_REVIEW
  check('review disabled (ICHIREI_REVIEW=off): no review call is made and the freestyle does not ship', seen.filter((s) => s.kind === 'review').length === 0 && rv6.freestyle_kanji === null && rv6.review?.ran === false && rv6.primary_kanji === '証')
  const rv7 = await run('a', (_r, review) => { review.verdicts = review.verdicts.slice(0, 2) })
  check('review: a missing verdict for the freestyle drops it (no PASS, no freestyle); missing main verdicts leave the mains standing', rv7.freestyle_kanji === null && rv7.primary_kanji === '証' && rv7.runner_up_kanji === '守')
  check('review prompt: every slot is in the file, loads, and fills in one pass (slot-like text in the story is not re-substituted)', Object.values(REVIEW_SLOTS).every((s) => loadReviewPrompt().includes(s)) && (() => { const f = fillReviewPrompt(loadReviewPrompt(), 'x {{ CANDIDATES }} y', { language: 'ja', relationship: 'friend', direction: 'across', occasion: null, occasion_detail: null, inscription_script: null }, []); return f.includes('x {{ CANDIDATES }} y') && f.includes('occasion: unspecified') })())
  check('review prompt: the rules — palette, occasion taboos, dignity, invention, generic; the freestyle rules; vetoes only under a safety rule', ['SAFETY RULES', 'THE CONCERNS', '`palette`', '`occasion`', '`dignity`', '`register`', '`insult`', 'Invention', 'Generic', 'birthday_milestone', 'retirement_farewell'].every((k) => loadReviewPrompt().includes(k)))
  check('review prompt (2026-10-30): `truth` is a safety rule for the gaze lines of the main, second AND freestyle cards (an added fact such as "forgave" fails); the freestyle must be light (`register`) and never built on a painful or shame-linked detail (`dignity`, 黒 for ashamed-of hands)', ['9. `truth`', '7. `truth`', '8. `dignity`', '"forgave"', 'It is not light', 'oil-stained hands', '| "truth", "reason"'].every((k) => loadReviewPrompt().includes(k)) && (REVIEW_VETO_RULES as readonly string[]).includes('truth'))
  for (const fam of ['ja', 'zh', 'en']) {
    const p = readFileSync(join(process.cwd(), 'engine', `prompt.${fam}.md`), 'utf8')
    check(`prompt.${fam}.md (2026-10-30): every "who they are" line states only what the story says (no "forgave" when the story says he never came again); the freestyle is LIGHT, always written except in remembrance, never a painful or shame-linked detail (黒 for ashamed-of oil-stained hands)`, p.includes('every line that says who the receiver is') && p.includes('"forgave"') && p.includes('The freestyle is LIGHT') && p.includes('Omit it ONLY when every detail the story gives is painful or shame-linked') && p.includes('NEVER use the freestyle slot for a painful or shame-linked detail') && p.includes('oil-stained hands') && p.includes('7. Light only.'))
  }
  const truthVeto = await run('a', (_reply, review) => {
    review.verdicts[0] = { slot: 'main', kanji: review.verdicts[0].kanji, pass: false, rule: 'truth', reason: 'States that he forgave; the story only says he never came again.', concern: '' }
  })
  check('a `truth` veto on a main card is APPLIED (the card is removed with the rule named), not ignored as "no safety rule named"', bySlot(truthVeto, 'main')?.eliminated === true && /review: truth:/.test(bySlot(truthVeto, 'main')?.eliminated_reason ?? '') && !truthVeto.referee?.actions.some((x) => x.action === 'review_veto_ignored'))
  check('review input: the reviewer sees the palette facts for each candidate (status, taboo flags) and null for a character with no row', (() => { const items = reviewItems(a, loadPalette()); return items.find((i) => i.kanji === '証')?.palette?.status === 'context_required' && items.find((i) => i.kanji === '封')?.palette === null && items.map((i) => i.slot).join() === 'main,second,freestyle' })())
  check('review parser: fenced / prose-wrapped JSON accepted; verdicts for unasked candidates ignored; a non-boolean pass is not a verdict', (() => {
    const items = reviewItems(a, loadPalette())
    const text = 'Here:\n```json\n' + JSON.stringify({ verdicts: [{ slot: 'main', kanji: '証', pass: true, reason: 'ok' }, { slot: 'second', kanji: '守', pass: 'yes', reason: 'x' }, { slot: 'main', kanji: '別', pass: false, reason: 'not asked' }] }) + '\n```'
    const v = parseVerdicts(text, items)
    return v.length === 1 && v[0].kanji === '証'
  })())

  // =============================================================================================
  // 5. Classical lines: from REVIEWED palette rows only; the model's own value is discarded
  // =============================================================================================
  const HEADER = 'language,kanji,inscription_form,readings,core_meanings,auspicious_compounds,status,taboo_flags,blocked_occasions,register_flags,anchor_required,cross_language_note,relationship_fit,inscription_fitness,classical_echo,reviewed_by,reviewed_on'
  const csvRow = (o: Record<string, string>) => HEADER.split(',').map((c) => { const v = o[c] ?? (c === 'status' ? 'ok' : c === 'taboo_flags' || c === 'blocked_occasions' || c === 'register_flags' ? 'none' : ''); return /[",]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v }).join(',')
  const mini = (rows: Record<string, string>[]) => parsePalette(`${HEADER}\n${rows.map(csvRow).join('\n')}\n`)
  const echoLine = '慈母手中線，遊子身上衣 — 孟郊「遊子吟」'
  const reviewedPal = mini([
    { language: 'ja', kanji: '証', inscription_form: '証', status: 'ok', classical_echo: echoLine, reviewed_by: 'Reviewer Name' },
    { language: 'ja', kanji: '守', inscription_form: '守', status: 'ok', classical_echo: '子曰「君子欲訥於言」— 論語・里仁', reviewed_by: 'draft-unreviewed' },
    { language: 'ja', kanji: '封', inscription_form: '封', status: 'ok', classical_echo: '封 — どこか', reviewed_by: 'Reviewer Name' },
  ])
  check('classical: the cell format is `text — source`; both parts are required, only a REVIEWED row yields a line', classicalEchoOf(reviewedPal.lookup('ja', '証')!)?.text === '慈母手中線，遊子身上衣' && classicalEchoOf(reviewedPal.lookup('ja', '証')!)?.source === '孟郊「遊子吟」' && classicalEchoOf(reviewedPal.lookup('ja', '守')!) === null && classicalEchoOf(undefined) === null)
  check('classical: a reviewed row whose cell has no " — source" part shows nothing; "none" and empty show nothing', classicalEchoOf(mini([{ language: 'ja', kanji: '証', classical_echo: '孟郊「遊子吟」', reviewed_by: 'R' }]).lookup('ja', '証')!) === null && classicalEchoOf(mini([{ language: 'ja', kanji: '証', classical_echo: 'none', reviewed_by: 'R' }]).lookup('ja', '証')!) === null)
  const withModelEcho = clone(FIX.a.model_reply)
  withModelEcho.candidates[0].classical_echo = { text: '我が作った名句', source: '架空集' }
  withModelEcho.candidates[2].classical_echo = { text: '我が作った名句', source: '架空集' }
  const out1 = applyPalette({ ...withModelEcho, language: 'ja' }, reviewedPal, FIX.a.story)
  const echoOf = (r: EngineResult, k: string) => r.candidates.find((c) => c.kanji === k)?.classical_echo
  check('classical: attached from the reviewed row (証); the unreviewed row (守) gets none; the model\'s own invention on 証 is overwritten', JSON.stringify(echoOf(out1, '証')) === JSON.stringify({ text: '慈母手中線，遊子身上衣', source: '孟郊「遊子吟」' }) && echoOf(out1, '守') === null)
  check('classical: the freestyle NEVER carries one, even from a reviewed row, even if the model wrote one', echoOf(out1, '封') === null && validateEngineResult({ ...out1, language: 'ja' }).every((p) => !p.includes('classical')))
  check('classical: with the real (all draft-unreviewed) palette nothing is attached, whatever the model wrote', applyPalette({ ...withModelEcho, language: 'ja' }, loadPalette(), FIX.a.story).candidates.every((c) => c.classical_echo === null))
  const reqOn = (res: EngineResult, pal = reviewedPal) => applyPalette({ ...res, language: 'ja' }, pal, FIX.a.story, { requireClassicalEcho: true })
  const req1 = reqOn(clone(FIX.a.model_reply))
  check('REQUIRE_CLASSICAL_ECHO on: slot 1 with a reviewed line (証) stays; slot 2 without one (守, unreviewed row) is not eligible; no backup remains', req1.primary_kanji === '証' && req1.candidates[1].eliminated === true && req1.candidates[1].eliminated_reason === 'palette: classical_echo_required' && req1.runner_up_kanji === null)
  const req2 = applyPalette({ ...clone(FIX.a.model_reply), language: 'ja' }, loadPalette(), FIX.a.story, { requireClassicalEcho: true })
  check('REQUIRE_CLASSICAL_ECHO on with the shipped (unreviewed) palette: no main is eligible → insufficient (why it ships OFF)', req2.status === 'insufficient' && req2.follow_up_question === FIX.a.model_reply.fallback_follow_up_question)
  const req3 = applyPalette({ ...clone(FIX.a.model_reply), language: 'ja' }, loadPalette(), FIX.a.story, { requireClassicalEcho: false })
  check('REQUIRE_CLASSICAL_ECHO off (the default): unreviewed rows are fine', req3.status === 'sufficient' && req3.primary_kanji === '証')
  process.env.REQUIRE_CLASSICAL_ECHO = '1'
  const req4 = await run('a')
  delete process.env.REQUIRE_CLASSICAL_ECHO
  const req5 = await run('a')
  check('REQUIRE_CLASSICAL_ECHO is read from the environment (1/true/on); off when unset', req4.status === 'insufficient' && req5.status === 'sufficient')
  check('REQUIRE_CLASSICAL_ECHO: when slot 1 lacks a line and slot 2 has one, slot 2 is promoted', (() => { const pal = mini([{ language: 'ja', kanji: '守', inscription_form: '守', classical_echo: '子曰「君子欲訥於言」 — 論語・里仁', reviewed_by: 'Reviewer Name' }]); const out = applyPalette({ ...clone(FIX.a.model_reply), language: 'ja' }, pal, FIX.a.story, { requireClassicalEcho: true }); return out.primary_kanji === '守' && out.referee?.promoted_from === 'second' && out.candidates[1].classical_echo?.source === '論語・里仁' })())
  check('review after referee: a classical line is attached to the surviving main after the review too', (() => { const stage1 = applyPalette({ ...clone(FIX.a.model_reply), language: 'ja' }, reviewedPal, FIX.a.story); const after = applyReviewVerdicts(stage1, reviewedPal, FIX.a.story, { ran: true, skipped_reason: null, verdicts: FIX.a.review_reply.verdicts }); return JSON.stringify(echoOf(after, '証')) === JSON.stringify({ text: '慈母手中線，遊子身上衣', source: '孟郊「遊子吟」' }) })())

  // =============================================================================================
  // 6. Contract validation of the new shape
  // =============================================================================================
  const base = () => clone(applyPalette({ ...FIX.a.model_reply, language: 'ja' }, loadPalette(), FIX.a.story))
  const mut = (fn: (r: any) => void) => { const r = base(); fn(r); return validateEngineResult(r) }
  check('contract: the refereed golden (a) conforms', validateEngineResult(base()).length === 0, validateEngineResult(base()).join('; '))
  check('contract: 2 to 6 candidates (one refill beside each removed card) — 1 or 7+ are rejected', mut((r) => (r.candidates = r.candidates.slice(0, 1))).some((p) => p.includes('2 to 6')) && mut((r) => { r.candidates = [...r.candidates, ...r.candidates, ...r.candidates] }).some((p) => p.includes('2 to 6')) && mut((r) => r.candidates.push({ ...r.candidates[0], slot: 'freestyle' })).some((p) => p.includes('more than one freestyle') || p.includes('2 to 6')))
  check('contract: exactly one main and one second; a missing second is caught', mut((r) => (r.candidates[1].slot = 'main')).some((p) => p.includes('"second"')) && mut((r) => (r.candidates[0].slot = 'bogus')).some((p) => p.includes('slot invalid')))
  check('contract: main and second must be different truth types', mut((r) => (r.candidates[1].truth_type = r.candidates[0].truth_type)).some((p) => p.includes('different truth types')))
  check('contract: "Play" belongs to the freestyle only (and the freestyle must be "Play")', mut((r) => (r.candidates[1].truth_type = 'Play')).some((p) => p.includes('"Play"')) && mut((r) => (r.candidates[2].truth_type = 'Role')).some((p) => p.includes('"Play"')))
  check('contract: emotional_register must be 1–2 non-empty strings', mut((r) => (r.fingerprint.emotional_register = [])).some((p) => p.includes('emotional_register')) && mut((r) => (r.fingerprint.emotional_register = ['a', 'b', 'c'])).some((p) => p.includes('emotional_register')) && mut((r) => delete r.fingerprint.emotional_register).some((p) => p.includes('emotional_register')))
  check('contract: fallback_follow_up_question is required on a sufficient result', mut((r) => delete r.fallback_follow_up_question).some((p) => p.includes('fallback_follow_up_question')))
  check('contract: freestyle_kanji must name the live freestyle (null while one is live, or a wrong kanji, are caught)', mut((r) => (r.freestyle_kanji = null)).some((p) => p.includes('freestyle')) && mut((r) => (r.freestyle_kanji = '証')).some((p) => p.includes('freestyle')) && mut((r) => delete r.freestyle_kanji).some((p) => p.includes('freestyle_kanji missing')))
  check('contract: the runner-up must be the second-slot candidate; the primary may not be the freestyle', mut((r) => (r.runner_up_kanji = '封')).some((p) => p.includes('second-slot')) && mut((r) => (r.primary_kanji = '封')).some((p) => p.includes('freestyle')))
  check('contract: the freestyle repeating a main kanji is caught; the freestyle needs no unique_truth (it has none)', mut((r) => (r.candidates[2].kanji = '証')).some((p) => p.includes('repeats a main kanji')) && base().candidates[2].unique_truth === '' && validateEngineResult(base()).length === 0)
  check('contract: a classical_echo must be {text, source}; the freestyle may not carry one', mut((r) => (r.candidates[0].classical_echo = { text: 'x' })).some((p) => p.includes('classical_echo')) && mut((r) => (r.candidates[2].classical_echo = { text: 'x', source: 'y' })).some((p) => p.includes('freestyle never carries')))
  check('contract: an insufficient result has no freestyle and no runner-up', validateEngineResult({ ...e, freestyle_kanji: '封' }).some((p) => p.includes('freestyle_kanji not null')) && validateEngineResult(e).length === 0)

  // =============================================================================================
  // 7. Story length: no minimum, hard maximum 5000 characters (raised from 600 on 2026-10-30, to 2000 the same day, to 5000 on 2026-11-01); the API never truncates, it rejects, follow-up answers 600 EACH, rejected cleanly (d)
  // =============================================================================================
  const long = FIX.d.story.repeat(8) // 5600 characters
  const post = (body: unknown) => selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify(body) }))
  seen.length = 0
  const selLong = await post({ story: long, language: 'ja' })
  const selLongBody = (await selLong.json()) as { error: string; code: string; max: number }
  check('(d) the 5600-character story → 400 story_too_long with the limit (5000), before any model call', countChars(long) === 5600 && selLong.status === 400 && selLongBody.code === 'story_too_long' && selLongBody.max === 5000 && selLongBody.error.includes('5000') && selLongBody.error.includes('5600') && seen.length === 0, JSON.stringify(selLongBody))
  selectReply = FIX.a.model_reply
  reviewReply = FIX.a.review_reply
  const edge = await post({ story: '短'.repeat(5000), language: 'ja' })
  check('(d) exactly 5000 characters is accepted (streams); 5001 is not', edge.status === 200 && (await post({ story: '短'.repeat(5001) })).status === 400)
  await edge.text()
  check('(d) characters are counted as Unicode code points, not UTF-16 units (5000 × 𠮷 is fine, 5001 is not)', countChars('𠮷'.repeat(5000)) === 5000 && '𠮷'.repeat(5000).length === 10000 && (await post({ story: '𠮷'.repeat(5001) })).status === 400)
  seen.length = 0
  const thin = await post({ story: '父', language: 'ja' })
  await thin.text()
  check('no minimum: a one-character story is not rejected by length (STEP 0 judges sufficiency by content)', thin.status === 200)
  check('the caps are shared constants in the contract: story 5000, each follow-up answer 600, at most 2 answers', STORY_MAX === 5000 && FOLLOW_UP_MAX === 600 && MAX_FOLLOW_UPS === 2)

  // follow-up answers: their own field, 600 each — so a 5000-character story can still be followed up
  const fuA = '甲'.repeat(600)
  const fuB = '乙'.repeat(600)
  seen.length = 0
  const withFu = await post({ story: '短'.repeat(5000), follow_ups: [fuA, fuB], language: 'ja' })
  await withFu.text()
  const sentPrompt = seen.find((x) => x.kind === 'select')?.prompt ?? ''
  check('follow-ups: two answers of 600 characters each ride along with a 5000-character story; the engine reads all three, in order', withFu.status === 200 && sentPrompt.includes('短'.repeat(5000) + '\n\n' + fuA + '\n\n' + fuB))
  check('follow-ups: an answer of 601 characters → 400 follow_up_too_long (max 600); a third answer → 400 too_many_follow_ups; a non-array → 400', (await (async () => { const r = await post({ story: '父', follow_ups: ['甲'.repeat(601)] }); const b = (await r.json()) as { code: string; max: number }; return r.status === 400 && b.code === 'follow_up_too_long' && b.max === 600 })()) && (await (async () => { const r = await post({ story: '父', follow_ups: ['a', 'b', 'c'] }); return r.status === 400 && ((await r.json()) as { code: string }).code === 'too_many_follow_ups' })()) && (await post({ story: '父', follow_ups: 'さらに' })).status === 400 && (await post({ story: '父', follow_ups: [5] })).status === 400)
  check('follow-ups: blank answers are ignored; omitting the field is the same as an empty list', parseFollowUps(['  ', '本当の答え']).ok === true && (parseFollowUps(['  ', '本当の答え']) as { followUps: string[] }).followUps.join() === '本当の答え' && (parseFollowUps(undefined) as { followUps: string[] }).followUps.length === 0 && mergeStory('物語', ['答え']) === '物語\n\n答え' && mergeStory('物語') === '物語')
  const orderBody = { story: long, engine_result: clone(a), selected_kanji: '証', language: 'ja', sender_name: '山田', receiver_name: '父', delivery_date: '2099-01-01', inscription_style: 'kyujitai', package: 'simple' }
  const NOW = new Date('2026-10-25T00:00:00Z')
  const ord = parseOrderRequest(orderBody, NOW)
  check('(d) the order endpoint rejects the 5600-character story, naming the field (limit 5000)', ord.ok === false && ord.field === 'story' && ord.error.includes('5000'))
  const ordOk = parseOrderRequest({ ...orderBody, story: '長'.repeat(5000), follow_ups: [fuA, fuB], delivery_date: '2026-12-01' }, NOW)
  check('the order endpoint accepts a 5000-character story with two 600-character follow-up answers, and keeps the answers apart from the story', ordOk.ok === true && ordOk.order.story.length === 5000 && ordOk.order.follow_ups.length === 2 && ordOk.order.follow_ups[1] === fuB)
  check('the order endpoint refuses a 601-character answer or three answers, naming the field "follow_ups"', (() => { const r = parseOrderRequest({ ...orderBody, story: '父', follow_ups: ['甲'.repeat(601)], delivery_date: '2026-12-01' }, NOW); const r2 = parseOrderRequest({ ...orderBody, story: '父', follow_ups: ['a', 'b', 'c'], delivery_date: '2026-12-01' }, NOW); return r.ok === false && r.field === 'follow_ups' && r2.ok === false && r2.field === 'follow_ups' })())
  const freeOrder = parseOrderRequest({ ...orderBody, story: FIX.a.story, selected_kanji: '封', delivery_date: '2026-12-01', engine_result: clone(a) }, NOW)
  check('ordering: the freestyle card can be chosen like any other card (its glyph, reading and gaze travel with the order)', freeOrder.ok === true && freeOrder.order.candidate.slot === 'freestyle' && freeOrder.order.glyph === '封')
  const elimOrder = parseOrderRequest({ ...orderBody, story: FIX.c1.story, selected_kanji: '太', delivery_date: '2026-12-01', engine_result: clone(c1) }, NOW)
  check('ordering: a refused (eliminated) freestyle cannot be ordered', elimOrder.ok === false && elimOrder.field === 'selected_kanji')
} finally {
  console.log = origLog
  upstream.close()
}

console.log(failures === 0 ? '\nAll v6 checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
