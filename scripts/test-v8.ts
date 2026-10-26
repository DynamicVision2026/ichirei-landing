// v8 tests: the person test (prompts + review), the five golden stories from the 2026-10-26 live test, and the replacement stage
// (a main slot that ends up empty is refilled instead of showing two cards). The fixtures in scripts/fixtures-v8/ run through the
// REAL engine against a FAKE model: no key, no network. The fake review fails exactly the candidates named in the fixture's
// `review_fail` (the live reviewer applies review rule 6 — the prompt text is asserted below); the fake selection returns the
// fixture's `model_reply`; the fake replacement returns the fixture's `replacements` one by one.
// NOTE: the fixtures hold retellings of copyrighted stories (private test DB) — keep this repo private.
//
//   node --experimental-strip-types scripts/test-v8.ts

import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult, type EngineResult } from '../engine/contract.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

interface Fixture { name: string; story_id: string; story: string; context: any; model_reply: any; review_fail: Record<string, string>; replacements: any[]; expect: { main: string; second: string | null; freestyle: string | null; cause: string | null; replacement: boolean; promoted?: boolean; rejected?: string[] } }
const FIX = Object.fromEntries(
  readdirSync(join(process.cwd(), 'scripts', 'fixtures-v8')).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(read(`scripts/fixtures-v8/${f}`)) as Fixture
    return [j.name, j]
  }),
) as Record<string, Fixture>

// ---- 1. the person test is in the prompts (the reasoning lives there, not in code) -------------------------------------------
for (const [file, needles] of [
  ['engine/prompt.en.md', ['THE PERSON TEST', 'If this scene had never happened, would this character still be true of them?', 'ONLY in the freestyle slot']],
  ['engine/prompt.ja.md', ['THE PERSON TEST', 'If this scene had never happened, would this character still be true of them?', 'Person test (main slots only)']],
  ['engine/prompt.zh.md', ['THE PERSON TEST', 'If this scene had never happened, would this character still be true of them?', 'Person test (main slots only)']],
] as const) {
  const text = read(file)
  check(`(1) ${file}: the person test is in the selection prompt (${needles.length} marker phrase(s))`, needles.every((n) => text.includes(n)), needles.filter((n) => !text.includes(n)).join(' | '))
}
check('(1) review-prompt.md: rule 6 "Scene noun" fails an object / place / action of the story in a MAIN slot (a freestyle may still be one)', /6\. Scene noun/.test(read('engine/review-prompt.md')) && /freestyle/.test(read('engine/review-prompt.md').split('Scene noun')[1] ?? ''))
check('(1) replace-prompt.md carries the person test and the slots the engine fills', read('engine/replace-prompt.md').includes('PERSON TEST') && read('engine/replace-prompt.md').includes('{{ SURVIVING }}') && read('engine/replace-prompt.md').includes('{{ AVOID }}'))

// ---- 1b. Chrome auto-translate must not touch the page (the site has its own EN / 日本語 / 繁中) -------------------------------
const html = read('index.html')
check('(1b) index.html: <html translate="no"> and <meta name="google" content="notranslate">', /<html[^>]*\stranslate="no"/.test(html) && /<meta\s+name="google"\s+content="notranslate"/.test(html))
check('(1b) the kanji elements of the landing and the flow carry class "notranslate" (every `k`, `phk`, glyph and slip element)', ['src/reveal/Hero.tsx', 'src/reveal/Sections.tsx', 'src/reveal/RevealPage.tsx', 'src/demo/Reveal.tsx', 'src/demo/OrderForm.tsx'].every((f) => /notranslate/.test(read(f))))

// ---- fake upstream: selection, review, replacement ---------------------------------------------------------------------------
type Kind = 'select' | 'review' | 'replace'
const seen: { kind: Kind; prompt: string }[] = []
let cur: Fixture = Object.values(FIX)[0]
let replaceQueue: any[] = []
let replaceNone = false
let extraReplyDelay = 0
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const kind: Kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Replacement Prompt (v8)') ? 'replace' : 'select'
  seen.push({ kind, prompt })
  let reply: unknown
  if (kind === 'select') reply = cur.model_reply
  else if (kind === 'replace') reply = replaceNone || replaceQueue.length === 0 ? { none: true } : replaceQueue.shift()
  else {
    // answer for every item the review prompt shows: pass, unless the fixture says this kanji fails
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2] }))
    reply = { verdicts: items.map((i) => ({ slot: i.slot, kanji: i.kanji, pass: !(i.kanji in cur.review_fail), reason: cur.review_fail[i.kanji] ?? 'ok' })) }
  }
  if (extraReplyDelay) await new Promise((r) => setTimeout(r, extraReplyDelay))
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
delete process.env.ICHIREI_REVIEW
delete process.env.ICHIREI_REPLACE
delete process.env.REQUIRE_CLASSICAL_ECHO

const logs: string[] = []
const stages: string[] = []
const origLog = console.log
const run = async (name: string, opts: { replacements?: any[]; none?: boolean; mutate?: (r: any) => void } = {}) => {
  cur = clone(FIX[name])
  opts.mutate?.(cur.model_reply)
  replaceQueue = clone(opts.replacements ?? cur.replacements)
  replaceNone = opts.none ?? false
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

try {
  // ---- 2. the five golden stories --------------------------------------------------------------------------------------------
  for (const name of Object.keys(FIX).sort()) {
    const f = FIX[name]
    const e = f.expect
    const r = await run(name)
    const second = r.runner_up_kanji
    const liveMains = live(r).filter((c) => c.slot !== 'freestyle')
    check(`(2) ${name}: main ${e.main}, second ${e.second ?? '—'}, freestyle ${e.freestyle ?? '—'}`, r.status === 'sufficient' && r.primary_kanji === e.main && (e.second === null ? second === null : second === e.second) && r.freestyle_kanji === e.freestyle, JSON.stringify({ p: r.primary_kanji, s: second, f: r.freestyle_kanji, status: r.status }))
    check(`(2) ${name}: the result conforms to the contract and two cards stand (main + second)`, validateEngineResult(r).length === 0 && liveMains.length === (e.second === null ? 1 : 2), validateEngineResult(r).join('; ') + ' / live ' + liveMains.length)
    check(`(2) ${name}: ${e.replacement ? `${1 + (e.rejected?.length ?? 0)} replacement call(s) (a character refused by the referee costs one more, no review call)` : 'no replacement call'}; the review ran ${e.replacement ? 'for the accepted replacement too' : 'once'}`, count('replace') === (e.replacement ? 1 + (e.rejected?.length ?? 0) : 0) && count('review') === (e.replacement ? 2 : 1) && count('select') === 1, JSON.stringify(seen.map((s) => s.kind)))
    const empty = logJson('[ichirei-engine] main_slot_empty ')
    check(`(2) ${name}: the reason is logged (cause ${e.cause ?? 'none'}), with no story text`, e.cause === null ? empty.length === 0 : empty.length === 1 && empty[0].missing.some((m: any) => m.cause === e.cause) && noStory(name), logs.join('\n'))
    if (e.promoted) check(`(2) ${name}: the scene-noun main was refused by the review and the quality candidate promoted`, r.referee?.promoted_from === 'second' && r.candidates.find((c) => c.slot === 'main')?.eliminated === true, JSON.stringify(r.referee))
    if (e.replacement) check(`(2) ${name}: the replacement went through the SAME referee + review (action replacement_added, a review verdict for it)`, !!r.referee?.actions.some((a) => a.action === 'replacement_added') && !!r.review?.verdicts.some((v) => v.kanji === e.second), JSON.stringify(r.referee?.actions))
    if (e.rejected) check(`(2) ${name}: a refused replacement (${e.rejected.join(',')}) is logged and never shown; the next attempt is used`, e.rejected.every((k) => !live(r).some((c) => c.kanji === k)) && r.referee?.actions.some((a) => a.action === 'replacement_rejected') === true && logJson('[ichirei-engine] replacement ').length === 2, logs.join('\n'))
    check(`(2) ${name}: stage events arrive in order (reading → choosing → checking${e.replacement ? ' → replacing' : ''})`, stages[0] === 'reading' && stages.indexOf('choosing') > 0 && stages.indexOf('checking') > stages.indexOf('choosing') && (e.replacement ? stages.includes('replacing') : !stages.includes('replacing')), stages.join())
    check(`(2) ${name}: one [ichirei-timing] line with the stage times and no story text`, logJson('[ichirei-timing] ').length === 1 && ['select_ms', 'review_ms', 'replace_ms', 'total_ms'].every((k) => k in logJson('[ichirei-timing] ')[0]) && noStory(name), logs.join('\n'))
  }

  // ---- 3. replacement edge cases ---------------------------------------------------------------------------------------------
  const base = 's0020-mother-thanks'
  const noneR = await run(base, { none: true })
  check('(3) the model honestly finds no replacement ("none") → two cards (main + freestyle), never a forced third; the attempts stop after the first "none"', noneR.status === 'sufficient' && live(noneR).length === 2 && count('replace') === 1 && !noneR.referee?.actions.some((a) => a.action === 'replacement_added'))
  const bad = await run(base, { replacements: [{ ...FIX[base].replacements[0], story_anchor: 'この文は物語にありません' }, { ...FIX[base].replacements[0], story_anchor: 'これも物語にありません' }] })
  check('(3) a replacement whose story_anchor is not verbatim in the story is rejected (twice), the attempts are capped at 2, two cards remain', count('replace') === 2 && live(bad).length === 2 && bad.referee?.actions.filter((a) => a.action === 'replacement_rejected').length === 2 && logJson('[ichirei-engine] replacement ').every((l) => l.ok === false))
  const dup = await run(base, { replacements: [{ ...FIX[base].replacements[0], kanji: '備' }, FIX[base].replacements[0]] })
  check('(3) a replacement that repeats a character already offered is rejected without a review call, the second attempt is used', dup.runner_up_kanji === '支' && count('replace') === 2 && count('review') === 2)
  process.env.ICHIREI_REPLACE = 'off'
  const off = await run(base)
  delete process.env.ICHIREI_REPLACE
  check('(3) ICHIREI_REPLACE=off: no replacement call; the empty slot is still logged (will_replace=false) and the result is as before (two cards)', count('replace') === 0 && live(off).length === 2 && logJson('[ichirei-engine] main_slot_empty ')[0]?.will_replace === false)
  const both = await run('s0080-wife-anniversary', { mutate: (r) => { r.candidates = r.candidates.filter((c: any) => c.slot !== 'second'); r.runner_up_kanji = null } })
  check('(3) a model reply with NO second at all (the 0020 case) is detected as cause not_generated and refilled', both.runner_up_kanji !== null || count('replace') === 1, JSON.stringify(seen.map((s) => s.kind)))

  // ---- 4. the fixtures never carry scene nouns as a main in what the engine ships -----------------------------------------------
  for (const name of Object.keys(FIX)) {
    const r = await run(name)
    check(`(4) ${name}: no scene-noun character ships as a main (${Object.keys(FIX[name].review_fail).join(',') || 'none expected'})`, live(r).filter((c) => c.slot !== 'freestyle').every((c) => !(c.kanji in FIX[name].review_fail)))
  }
} finally {
  upstream.close()
}

if (failures > 0) {
  console.log(`\n${failures} v8 check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll v8 checks passed.')
