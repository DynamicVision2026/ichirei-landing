// v8 / v8.1 tests: the person test (prompts), the five golden stories from the 2026-10-26 live test, the review as a SAFETY check
// (taste is never a veto), the replacement stage (only an empty slot is filled), at most three cards, no zero-card dead end, the
// slim output contract, and the timeouts (review falls back, selection retries once). The fixtures in scripts/fixtures-v8/ run through
// the REAL engine against a FAKE model: no key, no network.
// NOTE: the fixtures hold retellings of copyrighted stories (private test DB) — keep this repo private.
//
//   node --experimental-strip-types scripts/test-v8.ts

import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine, normalizeModelOutput } from '../engine/engine.ts'
import { DEFAULT_FOLLOW_UP, validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { ModelTimeoutError } from '../engine/limits.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

interface Fixture { name: string; story_id: string; story: string; context: any; model_reply: any; replacements: any[]; expect: { main: string; second: string | null; freestyle: string | null; cause: string | null; replacement: boolean } }
const FIX = Object.fromEntries(
  readdirSync(join(process.cwd(), 'scripts', 'fixtures-v8')).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(read(`scripts/fixtures-v8/${f}`)) as Fixture
    return [j.name, j]
  }),
) as Record<string, Fixture>

/** The slim output contract: what the model is asked to write (no context echo, particulars, fingerprint notes, eliminated fields). */
function slim(reply: any): any {
  const r = clone(reply)
  for (const k of ['language', 'relationship', 'direction', 'occasion', 'occasion_detail', 'inscription_script', 'particulars', 'fingerprint']) delete r[k]
  r.emotional_register = reply.fingerprint?.emotional_register ?? ['grateful']
  for (const c of r.candidates) {
    for (const k of ['eliminated', 'eliminated_reason', 'suitability_flag', 'palette_status', 'flags']) delete c[k]
    if (c.slot === 'freestyle') delete c.unique_truth
  }
  return r
}

// ---- 1. the prompts (the reasoning lives there, not in code) -------------------------------------------------------------------
for (const file of ['engine/prompt.en.md', 'engine/prompt.ja.md', 'engine/prompt.zh.md']) {
  const text = read(file)
  check(`(1) ${file}: the person test is in the selection prompt`, ['THE PERSON TEST', 'If this scene had never happened, would this character still be true of them?', 'Person test (main slots only)'].every((n) => text.includes(n)))
  const contract = text.slice(text.indexOf('=== OUTPUT CONTRACT'))
  check(`(1) ${file}: the slim output contract — no particulars, no fingerprint object, no context echo, no eliminated fields; short anchors`, !contract.includes('"particulars"') && !contract.includes('"fingerprint": {') && !contract.includes('// echo of CONTEXT') && !contract.includes('"eliminated": boolean') && contract.includes('"emotional_register": string[]') && contract.includes('Do NOT echo the context') && contract.includes('SHORT verbatim fragment'))
}
const reviewPrompt = read('engine/review-prompt.md')
check('(1) review-prompt.md: a SAFETY check — vetoes only under named safety rules, concerns (scene noun, voice, invention, generic …) never fail', reviewPrompt.includes('SAFETY RULES') && reviewPrompt.includes('THE CONCERNS') && /Scene noun/.test(reviewPrompt.slice(reviewPrompt.lastIndexOf('THE CONCERNS'))) && reviewPrompt.includes('A candidate with only concerns is a PASS') && !/When in doubt, FAIL\./.test(reviewPrompt) && ['`palette`', '`occasion`', '`memorial`', '`dignity`', '`register`', '`insult`'].every((r) => reviewPrompt.includes(r)))
check('(1) review-prompt.md: the memorial veto is only celebration / birth characters and death-talk as such (not voice, not consolation)', reviewPrompt.includes('Nothing else is a reason to fail a memorial candidate'))
check('(1) replace-prompt.md carries the person test, the slots the engine fills, and the empty-list case', read('engine/replace-prompt.md').includes('PERSON TEST') && read('engine/replace-prompt.md').includes('{{ SURVIVING }}') && read('engine/replace-prompt.md').includes('{{ AVOID }}') && read('engine/replace-prompt.md').includes('{{ SLOTS }}') && read('engine/replace-prompt.md').includes('REMEMBRANCE') && read('engine/replace-prompt.md').includes('freestyle'))

// ---- 1b. Chrome auto-translate must not touch the page ---------------------------------------------------------------------------
const html = read('index.html')
check('(1b) index.html: <html translate="no"> and <meta name="google" content="notranslate">', /<html[^>]*\stranslate="no"/.test(html) && /<meta\s+name="google"\s+content="notranslate"/.test(html))
check('(1b) the kanji elements of the landing and the flow carry class "notranslate"', ['src/reveal/Hero.tsx', 'src/reveal/Sections.tsx', 'src/reveal/RevealPage.tsx', 'src/demo/Reveal.tsx', 'src/demo/OrderForm.tsx'].every((f) => /notranslate/.test(read(f))))

// ---- fake upstream: selection, review, replacement ---------------------------------------------------------------------------
type Kind = 'select' | 'review' | 'replace'
interface Veto { rule?: string | null; reason?: string }
const seen: { kind: Kind; prompt: string; model: string }[] = []
let cur: Fixture = Object.values(FIX)[0]
let selectReply: unknown = null
let vetoes: Record<string, Veto> = {}
let replaceQueue: any[] = []
let selectBehaviors: ('ok' | 'hang')[] = []
let reviewBehavior: 'ok' | 'hang' = 'ok'
const hung: http.ServerResponse[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const prompt = String(body.messages[0].content)
  const kind: Kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Replacement Prompt (v9') ? 'replace' : 'select'
  seen.push({ kind, prompt, model: String(body.model) })
  const hang = (kind === 'select' && (selectBehaviors.shift() ?? 'ok') === 'hang') || (kind === 'review' && reviewBehavior === 'hang')
  if (hang) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`)
    hung.push(res)
    return
  }
  let reply: unknown
  if (kind === 'select') reply = selectReply
  else if (kind === 'replace') reply = replaceQueue.length === 0 ? { none: true } : replaceQueue.shift()
  else {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2] }))
    reply = { verdicts: items.map((i) => { const v = vetoes[i.kanji]; return { slot: i.slot, kanji: i.kanji, pass: !v, rule: v ? (v.rule === undefined ? null : v.rule) : null, reason: v?.reason ?? 'ok', concern: v ? '' : 'a worry that is not a veto' } }) }
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(reply) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off' // these suites pin the palette engine's own call sequence; the lexicon modes have their own suite (test-v9.ts)
for (const k of ['ICHIREI_REVIEW', 'ICHIREI_REPLACE', 'ICHIREI_REPLACE_ATTEMPTS', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_CALL_TIMEOUT_MS', 'ICHIREI_REVIEW_TIMEOUT_MS']) delete process.env[k]

const logs: string[] = []
const stages: string[] = []
const origLog = console.log
interface RunOpts { replacements?: any[]; vetoes?: Record<string, Veto>; mutate?: (r: any) => void; slimShape?: boolean; selects?: ('ok' | 'hang')[]; review?: 'ok' | 'hang' }
const run = async (name: string, o: RunOpts = {}) => {
  cur = clone(FIX[name])
  const reply = (o.slimShape ?? true) ? slim(cur.model_reply) : clone(cur.model_reply)
  o.mutate?.(reply)
  selectReply = reply
  vetoes = o.vetoes ?? {}
  replaceQueue = clone(o.replacements ?? cur.replacements)
  selectBehaviors = [...(o.selects ?? [])]
  reviewBehavior = o.review ?? 'ok'
  seen.length = 0
  logs.length = 0
  stages.length = 0
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-')) logs.push(l); else origLog(...a) }
  try { return await runEngine(cur.story, 'A', { context: cur.context, onStage: (s) => stages.push(s) }) } finally { console.log = origLog }
}
const count = (k: Kind) => seen.filter((s) => s.kind === k).length
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const logJson = (prefix: string) => logs.filter((l) => l.startsWith(prefix)).map((l) => JSON.parse(l.slice(prefix.length)))
const noStory = (name: string) => !logs.some((l) => FIX[name].story.split(/[。、\n]/).filter((p) => p.length >= 8).some((p) => l.includes(p)))
/** The invariant: the sender sees at most three cards (one main, one second, one freestyle) and is never left with nothing. */
const sound = (r: EngineResult): string | null => {
  if (r.status === 'insufficient') return r.candidates.length === 0 && typeof r.follow_up_question === 'string' && r.follow_up_question.trim() ? null : `insufficient without cards-free state or without a question: ${JSON.stringify([r.candidates.length, r.follow_up_question])}`
  const mains = live(r).filter((c) => c.slot !== 'freestyle')
  const frees = live(r).filter((c) => c.slot === 'freestyle')
  if (mains.length < 1 || mains.length > 2) return `live mains ${mains.length}`
  if (frees.length > 1) return `live freestyles ${frees.length}`
  if (!mains.some((c) => c.kanji === r.primary_kanji)) return 'primary is not a live main'
  if (r.runner_up_kanji !== null && !mains.some((c) => c.kanji === r.runner_up_kanji && c.kanji !== r.primary_kanji)) return 'runner_up_kanji is not the other live main'
  return null
}

try {
  // ---- 2. the five golden stories (the model answers in the SLIM shape) --------------------------------------------------------
  for (const name of Object.keys(FIX).sort()) {
    const f = FIX[name]
    const e = f.expect
    // Spec step 8 (changed 2026-11-01): EVERY empty slot is refilled by ONE call — a second or a free pick the model never produced counts too.
    const gen = new Set<string>(f.model_reply.candidates.map((c: any) => c.slot))
    const asks = [...(gen.has('second') ? [] : ['second']), ...(gen.has('freestyle') ? [] : ['freestyle'])]
    const rep = asks.length > 0
    const e2 = asks.includes('second') ? f.replacements[0].kanji : e.second // (the fixture's first replacement is a second-type candidate)
    const reps = asks.includes('second') ? undefined : [] // (nothing on offer for a free pick: the model says "none")
    const r = await run(name, { replacements: reps })
    const liveMains = live(r).filter((c) => c.slot !== 'freestyle')
    check(`(2) ${name}: main ${e.main}, second ${e2 ?? '—'}, freestyle ${e.freestyle ?? '—'}`, r.status === 'sufficient' && r.primary_kanji === e.main && (e2 === null ? r.runner_up_kanji === null : r.runner_up_kanji === e2) && r.freestyle_kanji === e.freestyle, JSON.stringify({ p: r.primary_kanji, s: r.runner_up_kanji, f: r.freestyle_kanji, status: r.status }))
    check(`(2) ${name}: contract-valid after normalisation, at most three cards`, (e.cause === 'not_generated' ? validateEngineResult(r).every((p) => p.includes('"second"')) : validateEngineResult(r).length === 0) && sound(r) === null && liveMains.length === (e2 === null ? 1 : 2), `${validateEngineResult(r).join('; ')} / ${sound(r)}`)
    check(`(2) ${name}: ${rep ? `exactly one refill call, for the empty slot(s) ${asks.join('+')}` : 'no refill call'}; one selection, one review (two when a refill candidate is reviewed)`, count('replace') === (rep ? 1 : 0) && count('review') === (asks.includes('second') ? 2 : 1) && count('select') === 1, JSON.stringify(seen.map((s) => s.kind)))
    const empty = [...logJson('[ichirei-engine] main_slot_empty '), ...logJson('[ichirei-engine] second_slot_empty ')]
    check(`(2) ${name}: the reason is logged (cause ${e.cause ?? 'none'}), with no story text`, e.cause === null ? empty.length === 0 : empty.length === 1 && empty[0].missing.some((m: any) => m.cause === e.cause) && noStory(name), logs.join('\n'))
    check(`(2) ${name}: stage events reading → choosing → checking${rep ? ' → replacing' : ''}`, stages[0] === 'reading' && stages.indexOf('choosing') > 0 && stages.indexOf('checking') > stages.indexOf('choosing') && (rep ? stages.includes('replacing') : !stages.includes('replacing')), stages.join())
    check(`(2) ${name}: one [ichirei-timing] line, no story text; the review ran on the review model (claude-haiku-5-5)`, logJson('[ichirei-timing] ').length === 1 && noStory(name) && seen.filter((s) => s.kind === 'review').every((s) => s.model === 'claude-haiku-5-5'))
    // the old shape (full echo, particulars, fingerprint) still works: nothing depends on the model writing them
    const old = await run(name, { slimShape: false, replacements: reps })
    check(`(2) ${name}: the old, long output shape gives the same cards (the slim contract is only a saving)`, old.primary_kanji === r.primary_kanji && old.runner_up_kanji === r.runner_up_kanji && old.freestyle_kanji === r.freestyle_kanji)
  }
  // size of the answer the model has to write, before and after (JSON characters; the fixtures are real-shaped, see the report)
  {
    const sizes = Object.values(FIX).map((f) => ({ name: f.name, before: JSON.stringify(f.model_reply).length, after: JSON.stringify(slim(f.model_reply)).length }))
    const sum = (k: 'before' | 'after') => sizes.reduce((a, s) => a + s[k], 0)
    origLog(`INFO  answer size (JSON characters, five fixtures): before ${sum('before')} → after ${sum('after')} (${Math.round((1 - sum('after') / sum('before')) * 100)}% shorter): ${sizes.map((s) => `${s.name.slice(0, 5)} ${s.before}→${s.after}`).join(', ')}`)
    check('(2) the slim answer is at least 30% shorter than the long one on the five fixtures', sum('after') < sum('before') * 0.7)
  }
  const norm = normalizeModelOutput(slim(FIX['s0080-wife-anniversary'].model_reply))
  check('(2) normalizeModelOutput fills what the slim contract leaves out (particulars [], fingerprint with emotional_register, eliminated false, palette_status ok, flags []) and invents nothing', Array.isArray(norm.particulars) && norm.fingerprint.emotional_register?.length === 2 && norm.fingerprint.relationship_note === null && norm.candidates.every((c) => c.eliminated === false && c.eliminated_reason === null && c.palette_status === 'ok' && Array.isArray(c.flags) && c.suitability_flag === null) && norm.candidates.map((c) => c.kanji).join() === '労,寛,煙')

  // ---- 3. the review is a SAFETY check: a veto needs a named safety rule; taste is only a concern ------------------------------------
  const taste = await run('s0004-mother-memorial', { replacements: [], vetoes: { 包: { rule: null, reason: 'third-person gaze' }, 庇: { rule: 'voice', reason: 'consoles the sender' } } })
  check('(3) 0004 (the dead end of the live test): the review "rejects" both for taste → neither is a veto, BOTH cards stand (包 main, 庇 second); the only refill call is for the free pick the model never wrote', taste.status === 'sufficient' && taste.primary_kanji === '包' && taste.runner_up_kanji === '庇' && count('replace') === 1 && taste.referee?.actions.filter((a) => a.action === 'review_veto_ignored').length === 2, JSON.stringify(taste.referee?.actions))
  check('(3) …and the ignored vetoes are logged with their reason (the verdict line carries rule and concern, no story text)', logs.some((l) => l.startsWith('[ichirei-review]') && l.includes('third-person gaze')) && noStory('s0004-mother-memorial'))
  const scene = await run('s0032-friend-thanks', { vetoes: { 誓: { rule: null, reason: 'Scene noun' } } })
  check('(3) a "scene noun" fail is a concern, not a veto: the scene-noun test lives in the selection prompt (the main stays)', scene.primary_kanji === '誓' && scene.runner_up_kanji === '待' && count('replace') === 0)
  const safe = await run('s0032-friend-thanks', { vetoes: { 誓: { rule: 'dignity', reason: 'closes the receiver into a verdict' } } })
  check('(3) a veto under a safety rule (dignity) removes the main: the second is promoted and the now-empty second slot IS refilled (spec step 8, changed 2026-11-01) by ONE call: 待 main, 信 second, 靴 free pick', safe.status === 'sufficient' && safe.primary_kanji === '待' && safe.runner_up_kanji === '信' && safe.freestyle_kanji === '靴' && count('replace') === 1, JSON.stringify({ p: safe.primary_kanji, s: safe.runner_up_kanji, replace: count('replace') }))
  check('(3) …and the result is sound (at most 1 main + 1 second + 1 freestyle)', sound(safe) === null, String(sound(safe)))
  for (const rule of ['palette', 'occasion', 'memorial', 'dignity', 'register', 'insult']) {
    const r = await run('s0080-wife-anniversary', { vetoes: { 煙: { rule, reason: 'x' } } })
    check(`(3) rule "${rule}" is a valid veto (here on the freestyle 煙)`, r.freestyle_kanji === null && r.candidates.find((c) => c.kanji === '煙')?.eliminated === true)
  }
  const freeNoRule = await run('s0080-wife-anniversary', { vetoes: { 煙: { rule: null, reason: 'unsure' } } })
  check('(3) the optional freestyle is dropped on ANY fail (it is the risky slot)', freeNoRule.freestyle_kanji === null && freeNoRule.primary_kanji === '労' && freeNoRule.runner_up_kanji === '寛')

  // ---- 4. at most three cards; only an EMPTY slot is filled ----------------------------------------------------------------------
  const over = await run('s0080-wife-anniversary', {
    mutate: (r) => {
      r.candidates.push({ slot: 'second', kanji: '信', reading: 'しんじる', truth_type: 'Forward Blessing', one_line_gaze: 'x', story_anchor: '節約も楽しいと笑います', unique_truth: 'u' })
      r.candidates.push({ slot: 'main', kanji: '許', reading: 'ゆるす', truth_type: 'Role', one_line_gaze: 'x', story_anchor: '節約も楽しいと笑います', unique_truth: 'u' })
    },
  })
  check('(4) a model that writes extra candidates (2 mains + 2 seconds + freestyle): the sender still sees ONE main, ONE second, ONE freestyle; the extras are removed and logged', sound(over) === null && live(over).length === 3 && over.primary_kanji === '労' && over.runner_up_kanji === '寛' && over.freestyle_kanji === '煙' && logJson('[ichirei-engine] slot_overflow ')[0]?.removed.length === 2 && count('replace') === 0, JSON.stringify({ live: live(over).map((c) => c.kanji), logs }))
  check('(4) two live mains → no replacement call (it never adds a card beside a filled slot)', count('replace') === 0)
  const twoFree = await run('s0080-wife-anniversary', { mutate: (r) => r.candidates.push({ slot: 'freestyle', kanji: '酒', reading: 'さけ', truth_type: 'Play', one_line_gaze: 'x', story_anchor: 'タバコは減らせとよく言われます' }) })
  check('(4) two freestyles → one is kept (the one named by freestyle_kanji)', live(twoFree).filter((c) => c.slot === 'freestyle').length === 1 && twoFree.freestyle_kanji === '煙')
  // The replacement for one empty slot, repeated runs: never more than three cards
  for (const name of ['s0020-mother-thanks', 's0032-friend-thanks']) {
    const r = await run(name, { vetoes: name === 's0032-friend-thanks' ? { 待: { rule: 'register', reason: 'x' } } : {} })
    check(`(4) ${name}: after a replacement the sender sees at most three cards, one second`, sound(r) === null && live(r).length <= 3, String(sound(r)))
  }

  // ---- 5. never zero cards and no question ---------------------------------------------------------------------------------------
  const both = { 包: { rule: 'memorial', reason: 'death-talk' }, 庇: { rule: 'dignity', reason: 'verdict' } }
  const rescued = await run('s0004-mother-memorial', { vetoes: both, replacements: [FIX['s0004-mother-memorial'].replacements[1]] })
  check('(5) every main vetoed → ONE replacement is tried first; if it passes, it is the main card (慈) and the sender has a result', rescued.status === 'sufficient' && rescued.primary_kanji === '慈' && count('replace') === 1 && rescued.candidates.find((c) => c.kanji === '慈')?.slot === 'main' && sound(rescued) === null && validateEngineResult(rescued).length === 0, `${rescued.status} ${rescued.primary_kanji} ${validateEngineResult(rescued).join('; ')}`)
  const none = await run('s0004-mother-memorial', { vetoes: both, replacements: [] })
  check('(5) …if the replacement has nothing either (or fails) → `insufficient` WITH the model\'s own fallback question, no cards', none.status === 'insufficient' && none.follow_up_question === FIX['s0004-mother-memorial'].model_reply.fallback_follow_up_question && none.candidates.length === 0 && count('replace') === 1 && sound(none) === null && validateEngineResult(none).length === 0, JSON.stringify([none.status, none.follow_up_question, count('replace')]))
  const noQ = await run('s0004-mother-memorial', { vetoes: both, replacements: [], mutate: (r) => { r.fallback_follow_up_question = '' } })
  check('(5) …and when the model gave no fallback question either, the last-resort question for the language is asked (never none)', noQ.status === 'insufficient' && noQ.follow_up_question === DEFAULT_FOLLOW_UP.ja && validateEngineResult(noQ).length === 0, String(noQ.follow_up_question))
  check('(5) the last-resort question exists in all four languages', (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => DEFAULT_FOLLOW_UP[l].trim().length > 8))
  const modelInsufficient = await run('s0004-mother-memorial', { mutate: (r) => { r.status = 'insufficient'; r.follow_up_question = null; r.candidates = [] } })
  check('(5) the model itself says `insufficient` without a question → still a question (never a dead end)', modelInsufficient.status === 'insufficient' && typeof modelInsufficient.follow_up_question === 'string' && modelInsufficient.follow_up_question.length > 8, String(modelInsufficient.follow_up_question))
  // property: whatever the fake model and the fake review do, the result is sound
  {
    let n = 0
    let bad: string | null = null
    for (const name of Object.keys(FIX)) {
      const kanjis = FIX[name].model_reply.candidates.map((c: any) => c.kanji as string)
      for (let mask = 0; mask < 1 << kanjis.length; mask++) {
        for (const reps of [[], clone(FIX[name].replacements)]) {
          const v: Record<string, Veto> = {}
          kanjis.forEach((k: string, i: number) => { if (mask & (1 << i)) v[k] = { rule: i % 2 ? 'register' : 'dignity', reason: 'x' } })
          const r = await run(name, { vetoes: v, replacements: reps })
          const problem = sound(r)
          n++
          if (problem && !bad) bad = `${name} mask ${mask}: ${problem}`
        }
      }
    }
    check(`(5) property: ${n} combinations of vetoes × replacement outcomes over the five stories — every result is sound (≤ 3 cards, or zero cards WITH a question)`, bad === null, bad ?? '')
  }

  // ---- 6. replacement edge cases ---------------------------------------------------------------------------------------------------
  const base = 's0020-mother-thanks'
  // the 0020 reply has NO second card: the second slot is refilled by ONE call (spec step 8, changed 2026-11-01; it was left empty from 2026-10-30)
  const noSecond = await run(base)
  check('(6) a reply with NO second at all (the 0020 case) is detected (cause not_generated) and logged as second_slot_empty with will_replace=true and REFILLED by one call (支): main + second + freestyle', noSecond.status === 'sufficient' && count('replace') === 1 && live(noSecond).length === 3 && noSecond.runner_up_kanji === FIX[base].replacements[0].kanji && logJson('[ichirei-engine] second_slot_empty ')[0]?.missing.some((m: any) => m.cause === 'not_generated') && logJson('[ichirei-engine] second_slot_empty ')[0]?.will_replace === true && logJson('[ichirei-engine] main_slot_empty ').length === 0)
  // a MISSING MAIN is refilled: the model's reply has no main and no second (here: a reply with only the freestyle), or both are removed
  const noMains = (r: any) => { r.candidates = r.candidates.filter((c: any) => c.slot === 'freestyle'); r.primary_kanji = null; r.runner_up_kanji = null }
  const noneR = await run(base, { mutate: noMains, replacements: [] })
  check('(6) no live main and the model honestly finds no replacement ("none") → ONE replacement call, no forced card (never a freestyle alone)', count('replace') === 1 && !noneR.referee?.actions.some((a) => a.action === 'replacement_added') && noneR.candidates.every((c) => c.slot !== 'main' || c.eliminated) , JSON.stringify([noneR.status, noneR.candidates.map((c) => [c.slot, c.kanji, c.eliminated])]))
  const bad = await run(base, { mutate: noMains, replacements: [{ ...FIX[base].replacements[0], story_anchor: 'この文は物語にありません' }, { ...FIX[base].replacements[0], story_anchor: 'これも物語にありません' }] })
  check('(6) a main replacement whose story_anchor is not verbatim in the story is rejected; ONE refill call only (no second 40-second round)', count('replace') === 1 && bad.referee?.actions.some((a) => a.action === 'replacement_rejected' && /verbatim/.test(a.detail ?? '')) === true)
  process.env.ICHIREI_REPLACE_ATTEMPTS = '2'
  const two = await run(base, { mutate: noMains, replacements: [{ ...FIX[base].replacements[0], story_anchor: 'この文は物語にありません' }, FIX[base].replacements[0]] })
  delete process.env.ICHIREI_REPLACE_ATTEMPTS
  check('(6) with no live main, the single attempt is fixed at one (ICHIREI_REPLACE_ATTEMPTS only matters for a live-main result, which is never replaced now)', count('replace') === 1 && sound(two) === null)
  const good = await run(base, { mutate: noMains, replacements: [FIX[base].replacements[0]] })
  check('(6) a good replacement for an empty main slot becomes the MAIN (支), never more than three cards', good.primary_kanji === FIX[base].replacements[0].kanji && count('replace') === 1 && sound(good) === null, JSON.stringify([good.primary_kanji, good.status]))
  process.env.ICHIREI_REPLACE = 'off'
  await run(base, { mutate: noMains })
  delete process.env.ICHIREI_REPLACE
  check('(6) ICHIREI_REPLACE=off: no replacement call; the empty main slot is still logged (will_replace=false)', count('replace') === 0 && logJson('[ichirei-engine] main_slot_empty ')[0]?.will_replace === false)

  // ---- 7. timeouts ----------------------------------------------------------------------------------------------------------------
  process.env.ICHIREI_REVIEW_TIMEOUT_MS = '400'
  const t0 = Date.now()
  const noReview = await run('s0080-wife-anniversary', { review: 'hang' })
  delete process.env.ICHIREI_REVIEW_TIMEOUT_MS
  check('(7) a review that times out (60 s in production, 0.4 s here) does not fail the run: the selection is shown WITHOUT the review (mains stand, the unreviewed freestyle is dropped) and it is logged', noReview.status === 'sufficient' && noReview.primary_kanji === '労' && noReview.runner_up_kanji === '寛' && noReview.freestyle_kanji === null && noReview.review?.ran === false && logs.some((l) => l.startsWith('[ichirei-review]') && l.includes('"ran":false')) && Date.now() - t0 < 8000, JSON.stringify([noReview.status, noReview.review, Date.now() - t0]))
  process.env.ICHIREI_CALL_TIMEOUT_MS = '400'
  const retried = await run('s0080-wife-anniversary', { selects: ['hang', 'ok'] })
  check('(7) a selection that hits the ceiling is retried ONCE automatically and then succeeds (the sender sees a normal result, not an error)', retried.status === 'sufficient' && retried.primary_kanji === '労' && count('select') === 2 && logJson('[ichirei-engine] selection_timeout ')[0]?.retry === true, JSON.stringify([retried.status, count('select'), logs]))
  check('(7) …the page is told "reading" again for the retry (honest progress)', stages.filter((s) => s === 'reading').length === 2, stages.join())
  let err: unknown = null
  try { await run('s0080-wife-anniversary', { selects: ['hang', 'hang'] }) } catch (e) { err = e }
  check('(7) two timeouts in a row → a clear ModelTimeoutError (after exactly two attempts), not a hang', err instanceof ModelTimeoutError && count('select') === 2, String(err))
  delete process.env.ICHIREI_CALL_TIMEOUT_MS
  for (const r of hung) r.destroy()
  // the retry never runs past the run budget: with no room left it does not start
  process.env.ICHIREI_CALL_TIMEOUT_MS = '300'
  process.env.ICHIREI_RUN_BUDGET_MS = '20000' // less than the 20 s review reserve + 30 s minimum retry
  let err2: unknown = null
  try { await run('s0080-wife-anniversary', { selects: ['hang', 'ok'] }) } catch (e) { err2 = e }
  delete process.env.ICHIREI_CALL_TIMEOUT_MS
  delete process.env.ICHIREI_RUN_BUDGET_MS
  for (const r of hung) r.destroy()
  check('(7) when the run budget leaves no room for a retry, the timeout is reported at once (one selection call only)', err2 instanceof ModelTimeoutError && count('select') === 1 && logJson('[ichirei-engine] selection_timeout ')[0]?.retry === false, String(err2))
} finally {
  for (const r of hung) r.destroy()
  upstream.close()
}

if (failures > 0) {
  console.log(`\n${failures} v8 check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll v8 checks passed.')
