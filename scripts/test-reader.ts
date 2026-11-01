// Part B of the 2026-10-30 ticket — the reader's language: a character must pass the buyer's palette AND the palette of the culture where the
// receiver will read the gift (same rules as the English cross-check). Fake model: no key, no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-reader.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POST as selectPost } from '../api/select.ts'
import { READERS, parseContext, type EngineResult } from '../engine/contract.ts'
import { applyPalette, loadPalette, readerAddsFamily, refereeFamilies } from '../engine/palette.ts'
import { eligibleFor } from '../engine/lexicon.ts'
import { loadLexicon } from '../engine/lexicon.ts'
import { contextToPayload, DEFAULT_GIFT_CONTEXT, READER_CHOICES } from '../src/demo/i18n.ts'
import { OPENER } from '../src/reveal/opener-copy.ts'
process.env.ICHIREI_CARDS = 'single' // these checks drive the single-selection-call engine with one fake reply; the parallel cards have scripts/test-parallel.ts

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const palette = loadPalette()
const FIX = JSON.parse(read('scripts/fixtures-v6/a-solemn-parent.json'))

// ---- 1. the families -------------------------------------------------------------------------------------------------------------------
check('(1) families judged: ja buyer → ja; reader Taiwan (zh) → ja + zh; reader Japan → ja; reader English-speaking → ja + zh; reader other / none → ja only', refereeFamilies('ja').join() === 'ja' && refereeFamilies('ja', 'zh').join() === 'ja,zh' && refereeFamilies('ja', 'ja').join() === 'ja' && refereeFamilies('ja', 'en').join() === 'ja,zh' && refereeFamilies('ja', 'other').join() === 'ja' && refereeFamilies('ja', null).join() === 'ja')
check('(1) zh buyer with a Japanese reader → zh + ja; an English buyer is unchanged (both already)', refereeFamilies('zh-Hant', 'ja').join() === 'zh,ja' && refereeFamilies('en', 'ja').join() === 'ja,zh' && readerAddsFamily('ja', 'zh') && !readerAddsFamily('ja', 'ja') && !readerAddsFamily('en', 'zh'))
check('(1) the context takes a reader (ja | zh | en | other); an unknown value is refused; remembrance drops it', READERS.join() === 'ja,zh,en,other' && parseContext({ language: 'ja', reader: 'zh' }).ok && (parseContext({ language: 'ja', reader: 'zh' }) as { context: { reader: string } }).context.reader === 'zh' && !parseContext({ language: 'ja', reader: 'mars' }).ok && (parseContext({ language: 'ja', occasion: 'memorial', reader: 'zh' }) as { context: { reader: unknown } }).context.reader === null && (parseContext({ language: 'ja' }) as { context: { reader: unknown } }).context.reader === null)

// ---- 2. the referee: a character allowed in ja but blocked in zh -------------------------------------------------------------------------
// 匂: the Japanese palette allows it (context_required), the Chinese palette hard-blocks it.
const jaRow = palette.lookup('ja', '匂')
const zhRow = palette.lookup('zh', '匂')
check('(2) fixture facts: 匂 is not a hard block in the ja palette and IS one in the zh palette', jaRow?.status !== 'hard_block' && zhRow?.status === 'hard_block')
const withSecond = (kanji: string, reader: string | null): EngineResult => {
  const r = clone(FIX.model_reply) as any
  r.language = 'ja'; r.relationship = 'parent_father'; r.direction = 'up'; r.occasion = 'parent_day'; r.occasion_detail = null; r.inscription_script = null
  if (reader) r.reader = reader
  const c = r.candidates.find((x: any) => x.slot === 'second')
  c.kanji = kanji
  c.story_anchor = '相変わらず、ほとんど何も話さないけど'
  r.runner_up_kanji = kanji
  return r as EngineResult
}
const story: string = FIX.story
const logs: string[] = []
const run = (reader: string | null, kanji = '匂') => applyPalette(withSecond(kanji, reader), palette, story, { log: (l) => logs.push(l) })
const second = (r: EngineResult) => r.candidates.find((c) => c.slot === 'second')!
logs.length = 0
const noReader = run(null)
check('(2) a ja buyer with no reader choice: 匂 is not refused for being blocked in zh (the old behaviour)', !second(noReader).eliminated || !/hard_block|palette/.test(second(noReader).eliminated_reason ?? '') && !logs.some((l) => l.includes('cross-check')), JSON.stringify([second(noReader).eliminated, second(noReader).eliminated_reason]))
logs.length = 0
const zh = run('zh')
check('(2) …with the receiver reading in Taiwan / Hong Kong / Macau: 匂 is refused (hard block in zh), flagged blocked_by_zh', second(zh).eliminated === true && /palette/.test(second(zh).eliminated_reason ?? '') && second(zh).flags.includes('blocked_by_zh'), JSON.stringify([second(zh).eliminated_reason, second(zh).flags]))
const line = logs.find((l) => l.startsWith('[ichirei-referee] reader cross-check'))
check('(2) logged: `[ichirei-referee] reader cross-check` with the kanji and the family that blocked it — no story text', !!line && JSON.parse(line.slice(line.indexOf('{'))).kanji === '匂' && JSON.parse(line.slice(line.indexOf('{'))).blocked_by.join() === 'zh' && !line.includes('父') && !line.includes('相変わらず'), line)
logs.length = 0
const en = run('en')
check('(2) an English-speaking reader is judged by both palettes: 匂 is refused too', second(en).eliminated === true && logs.some((l) => l.startsWith('[ichirei-referee] reader cross-check')))
logs.length = 0
const jp = run('ja'), other = run('other')
check('(2) a reader in Japan or "other" changes nothing for a ja buyer', !second(jp).flags.includes('blocked_by_zh') && !second(other).flags.includes('blocked_by_zh') && !logs.some((l) => l.includes('cross-check')))
logs.length = 0
const okChar = run('zh', '守')
check('(2) a character that passes both palettes (守) is untouched by the reader check', !second(okChar).eliminated || !/palette/.test(second(okChar).eliminated_reason ?? ''), JSON.stringify([second(okChar).eliminated_reason]))
// a main candidate needs a row in BOTH palettes (the English rule): a ja-only character is refused as a main for a Taiwan reader
const jaOnly = [...new Set(palette.rows.filter((r) => r.language === 'ja').map((r) => r.kanji))].find((k) => !palette.lookup('zh', k) && palette.lookup('ja', k)?.status !== 'hard_block')
if (jaOnly) {
  const asMain = (reader: string | null) => { const r = withSecond('守', reader) as any; const m = r.candidates.find((x: any) => x.slot === 'main'); m.kanji = jaOnly; m.inscription_form = null; r.primary_kanji = jaOnly; return applyPalette(r, palette, story, { log: () => {} }) }
  check(`(2) a main with no zh row at all (${jaOnly}) is refused for a Taiwan reader (the English missing-row rule) and is fine without one`, asMain('zh').candidates.find((c) => c.kanji === jaOnly)?.eliminated === true && !(asMain(null).candidates.find((c) => c.kanji === jaOnly)?.eliminated_reason ?? '').includes('row'))
}

// ---- 3. the lexicon list narrows ---------------------------------------------------------------------------------------------------------
{
  const lex = loadLexicon()
  const g = { language: 'ja' as const, relationship: 'parent_father' as const, direction: 'up' as const, occasion: 'parent_day' as const }
  const base = eligibleFor(lex, palette, g)
  const tw = eligibleFor(lex, palette, { ...g, reader: 'zh' })
  check('(3) the lexicon list for a ja buyer with a Taiwan reader holds only characters both palettes accept (never longer; 匂 is gone if it was there)', tw.chars.length <= base.chars.length && !tw.chars.some((c) => c.kanji === '匂'), `${base.chars.length} → ${tw.chars.length}`)
}

// ---- 4. the page and the request -------------------------------------------------------------------------------------------------------
check('(4) the page sends reader only when chosen and never for remembrance; the three languages carry the field label and the four options', contextToPayload({ ...DEFAULT_GIFT_CONTEXT, occasion: 'wedding', reader: 'zh' }).reader === 'zh' && contextToPayload({ ...DEFAULT_GIFT_CONTEXT, occasion: 'wedding', reader: '' }).reader === undefined && contextToPayload({ ...DEFAULT_GIFT_CONTEXT, occasion: 'memorial', reader: 'zh' }).reader === undefined && READER_CHOICES.join() === ',ja,zh,en,other' && (['ja', 'zh-Hant', 'en'] as const).every((l) => OPENER[l].readerLabel && Object.keys(OPENER[l].readerOptions).length === 5) && OPENER.ja.readerLabel === '受け取る方が読むのは？' && OPENER['zh-Hant'].readerLabel === '對方閱讀的語言？' && OPENER.en.readerLabel === 'Where will they read it?')

// ---- 5. end to end through /api/select: both mains blocked in zh → ONE replacement for the empty main slot ----------------------------------
const seen: { kind: string; prompt: string }[] = []
let mains: [string, string] = ['匂', '断']
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Replacement Prompt (v9') ? 'replace' : 'select'
  seen.push({ kind, prompt })
  let payload: unknown
  if (kind === 'select') {
    const r = clone(FIX.model_reply) as any
    r.candidates.find((c: any) => c.slot === 'main').kanji = mains[0]
    r.candidates.find((c: any) => c.slot === 'second').kanji = mains[1]
    r.primary_kanji = mains[0]; r.runner_up_kanji = mains[1]
    payload = r
  } else if (kind === 'replace') {
    payload = { slot: 'second', kanji: '守', inscription_form: null, reading: 'まもる', truth_type: 'Hidden Cost', one_line_gaze: 'あなたは言葉の代わりに、静けさのまま、そこにいてくれた。', story_anchor: '相変わらず、ほとんど何も話さないけど', unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] }
  } else {
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1)) as { slot: string; kanji: string }[]
    payload = { verdicts: items.map((i) => ({ slot: i.slot, kanji: i.kanji, pass: true, rule: null, reason: 'ok', concern: '' })) }
  }
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(payload) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
const origLog = console.log
const selectRun = async (body: Record<string, unknown>) => {
  seen.length = 0
  const lines: string[] = []
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-')) lines.push(l); else origLog(...a) }
  try {
    const res = await selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story: FIX.story, language: 'ja', ...FIX.context, ...body }) }))
    const text = await res.text()
    const last = JSON.parse(text.trim().split('\n').filter((l) => l.includes('"result"')).pop() ?? '{}').result as EngineResult | undefined
    return { status: res.status, result: last, lines }
  } finally { console.log = origLog }
}
const tw = await selectRun({ reader: 'zh' })
check('(5) ja buyer, Taiwan reader, both mains (匂, 断) blocked in zh → both refused, ONE replacement call for the empty main slot, and the replacement (守) becomes the main', tw.status === 200 && seen.filter((s) => s.kind === 'replace').length === 1 && tw.result?.primary_kanji === '守' && tw.result?.reader === 'zh' && tw.lines.filter((l) => l.startsWith('[ichirei-referee] reader cross-check')).length >= 2, JSON.stringify([tw.result?.primary_kanji, seen.map((s) => s.kind), tw.lines.filter((l) => l.includes('cross-check')).length]))
mains = ['匂', '守']
const one = await selectRun({ reader: 'zh' })
check('(5) only the main is blocked: the second (守) is promoted and the now-empty second slot gets ONE refill call (spec step 8, 2026-11-01; the fake model offers 守 again, which is refused as already offered)', one.result?.primary_kanji === '守' && seen.filter((s) => s.kind === 'replace').length === 1, JSON.stringify([one.result?.primary_kanji, seen.map((s) => s.kind)]))
const none = await selectRun({})
check('(5) the same story with no reader choice keeps 匂 as the main (the check only applies when the sender says where it will be read)', none.result?.primary_kanji === '匂' || !!none.result?.candidates.find((c) => c.kanji === '匂' && !c.eliminated), JSON.stringify([none.result?.primary_kanji]))
check('(5) an invalid reader is a 400 before any model call', (await (async () => { seen.length = 0; const r = await selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story: FIX.story, language: 'ja', reader: 'mars' }) })); return r.status === 400 && seen.length === 0 })()))
upstream.close()

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll reader checks passed.')
process.exit(failures ? 1 : 0)
