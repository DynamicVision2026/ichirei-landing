// v9 tests: the classical lexicon as the source of the main and second characters (ICHIREI_LEXICON_MODE = off | shadow | on).
// The data (engine/lexicon.csv + the palette rows added for it), the eligibility filter and the owner's restrictions, the prompt
// (static block first, cached), `on` (lexicon-only slots, the fallback and the `lexicon_miss` log, the classical line only when a human
// reviewed it) and `shadow` (today's result, the lexicon's choice only logged). Everything runs against a FAKE model: no key, no network.
//
//   node --experimental-strip-types scripts/test-v9.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { LEXICON_COLUMNS, buildLexiconPrompt, eligibleFor, lexiconEchoOf, lexiconModeFromEnv, lexiconRowIn, loadLexicon, parseLexicon, renderLexiconTable, rowReviewedByHuman, rowShowsLine } from '../engine/lexicon.ts'
import { loadPalette, parseCsv } from '../engine/palette.ts'
import { logMainCharacter, resetMainTally } from '../engine/main-count.ts'
// @ts-expect-error untyped test helper
import { startServer } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const lexicon = loadLexicon()
const palette = loadPalette()
const gift = (language: any, relationship: any, direction: any, occasion: any) => ({ language, relationship, direction, occasion })
const kanjiOf = (language: any, relationship: any, direction: any, occasion: any, lex = lexicon) => eligibleFor(lex, palette, gift(language, relationship, direction, occasion)).chars.map((c) => c.kanji)
const has = (set: string[], ...ks: string[]) => ks.every((k) => set.includes(k))
const none = (set: string[], ...ks: string[]) => ks.every((k) => !set.includes(k))

// ---- 1. the data -----------------------------------------------------------------------------------------------------------------
const csvRows = parseCsv(read('engine/lexicon.csv'))
check('(1) engine/lexicon.csv: header = the 15 source columns + reviewed_by + reviewed_on', csvRows[0].join(',') === LEXICON_COLUMNS.join(',') && LEXICON_COLUMNS.slice(-2).join() === 'reviewed_by,reviewed_on', csvRows[0].join(','))
check('(1) 167 rows, 153 distinct characters, 149 rows with a verified line (a line and kana_only = no)', lexicon.size === 167 && new Set(lexicon.rows.map((r) => r.kanji)).size === 153 && lexicon.rows.filter((r) => r.raw.line_original !== '' && r.raw.kana_only === 'no').length === 149, `${lexicon.size} ${new Set(lexicon.rows.map((r) => r.kanji)).size} ${lexicon.rows.filter((r) => r.raw.line_original !== '' && r.raw.kana_only === 'no').length}`)
check('(1) reviewed_by and reviewed_on are empty on every row: nothing is human-reviewed yet', lexicon.rows.every((r) => r.raw.reviewed_by === '' && r.raw.reviewed_on === '') && lexicon.rows.every((r) => !rowReviewedByHuman(r)))
check('(1) the two benchmark rows (默, 迎) are marked DO NOT USE and are never offered', lexicon.rows.filter((r) => r.excluded).map((r) => r.kanji).sort().join('') === '默迎'.split('').sort().join(''))
const unresolved = lexicon.distinct().filter((k) => !lexiconRowIn(palette, 'ja', k) || !lexiconRowIn(palette, 'zh', k))
check('(1) every usable lexicon character has a palette row in BOTH ja and zh (the 恵/楽-type forms are found through the inscription form)', unresolved.length === 0, unresolved.join(' '))
const paletteRows = parseCsv(read('engine/palette.csv')).slice(1)
const added = paletteRows.filter((r) => r[16] === '2026-10-27')
check('(1) the palette rows added for the lexicon (86 ja + 86 zh) are AI first-pass rows: reviewed_by "Claude(AI一次確認)", never counted as reviewed', added.length === 172 && added.every((r) => r[15] === 'Claude(AI一次確認)') && palette.rows.filter((r) => r.raw.reviewed_on === '2026-10-27').every((r) => r.reviewed === false))
const pal = (f: 'ja' | 'zh', k: string) => palette.lookup(f, k)!
check('(1) the owner restrictions are in the palette rows too: ja 蔵 / zh 藏 partner only; zh 绿 not for a partner', pal('ja', '蔵').raw.relationship_fit === 'spouse|romance' && pal('zh', '藏').raw.relationship_fit === 'spouse|romance' && !pal('zh', '绿').raw.relationship_fit.split('|').some((x) => x === 'spouse' || x === 'romance'), `${pal('ja', '蔵').raw.relationship_fit} ${pal('zh', '藏').raw.relationship_fit} ${pal('zh', '绿').raw.relationship_fit}`)
check('(1) the stand-alone reading risks are carried over: zh 匂 is a hard block (kokuji); ja 重 is blocked for birthdays, parent_day and thanks; 慰 for weddings and births', pal('zh', '匂').status === 'hard_block' && ['birthday_milestone', 'parent_day', 'seasonal_thanks'].every((o) => pal('ja', '重').blocked_occasions.includes(o)) && ['wedding', 'new_baby'].every((o) => pal('ja', '慰').blocked_occasions.includes(o)))

// ---- 2. who is eligible, and the owner's restrictions ---------------------------------------------------------------------------------
const mother = kanjiOf('ja', 'parent_mother', 'up', 'parent_day')
check('(2) a mother on parent_day (ja): a long list, none of the benchmark characters, 重 (blocked for parent_day) left out', mother.length > 80 && none(mother, '黙', '默', '迎', '重') && has(mother, '待', '守', '灯'), `${mother.length}`)
check('(2) 藏 is partner only: offered for spouse and romance, never for a parent, a friend, a child or an unspecified relationship', has(kanjiOf('ja', 'spouse', 'across', null), '蔵') && has(kanjiOf('zh-Hant', 'romance', 'across', null), '藏') && none(kanjiOf('ja', 'parent_mother', 'up', null), '蔵') && none(kanjiOf('ja', 'friend', 'across', null), '蔵') && none(kanjiOf('ja', 'child', 'down', null), '蔵') && none(kanjiOf('ja', null, null, null), '蔵'))
const synth = (kanji: string, fits: string, extra: Record<string, string> = {}) => {
  const head = [...LEXICON_COLUMNS]
  const base: Record<string, string> = { kanji, pos_in_line: 'verb', meaning_in_line: 'm', person_quality: 'q', fits_relationships: fits, line_original: '行', source: '出典', source_url: '', kana_only: 'no', card_fit: 'high', sense_check: '', context_check: '', standalone_reading_risk: 'none', confidence: 'high', notes: '', reviewed_by: '', reviewed_on: '', ...extra }
  return head.map((h) => `"${base[h].replace(/"/g, '""')}"`).join(',')
}
const synthLex = (...rows: string[]) => parseLexicon(`${LEXICON_COLUMNS.join(',')}\n${rows.join('\n')}\n`)
const grat = synthLex(synth('恩', 'parent / partner / mentor'))
check('(2) 恩 is upward or partner only: offered up and to a partner, never down, across, or with no direction', has(kanjiOf('ja', 'parent_mother', 'up', null), '恩') && has(kanjiOf('ja', 'spouse', 'across', null, grat), '恩') && none(kanjiOf('ja', 'parent_mother', 'down', null), '恩') && none(kanjiOf('ja', 'mentor', 'across', null), '恩') && none(kanjiOf('ja', 'parent_mother', null, null), '恩'))
check('(2) …(the real 恩 row carries no partner tag, so for a spouse it is not offered at all: the restriction only narrows)', none(kanjiOf('ja', 'spouse', 'across', null), '恩'))
const green = synthLex(synth('綠', 'friend / partner / parent'))
check('(2) 綠 is not for a partner in Chinese (zh and en), even if its row said partner; fine for a partner in Japanese and for a friend in Chinese', none(kanjiOf('zh-Hant', 'spouse', 'across', null, green), '绿') && none(kanjiOf('zh-Hans', 'romance', 'across', null, green), '绿') && none(kanjiOf('en', 'spouse', 'across', null, green), '緑') && has(kanjiOf('ja', 'spouse', 'across', null, green), '緑') && has(kanjiOf('zh-Hant', 'friend', 'across', null, green), '绿'), JSON.stringify([kanjiOf('zh-Hant', 'spouse', 'across', null, green), kanjiOf('ja', 'spouse', 'across', null, green), kanjiOf('zh-Hant', 'friend', 'across', null, green)]))
check('(2) the real 綠 row: friend / mentor / work / parent only, so a Chinese partner never gets it', none(kanjiOf('zh-Hant', 'spouse', 'across', null), '绿') && has(kanjiOf('zh-Hant', 'friend', 'across', null), '绿'))
const mem = kanjiOf('ja', 'parent_mother', 'up', 'memorial')
check('(2) memorial: only characters the lexicon tags memorial, and none of the palette\'s celebration / new-beginning blocks', mem.length > 20 && mem.length < mother.length && has(mem, '偲', '憶') && none(mem, '祝', '寿', '嬉', '笑'), `${mem.length}`)
check('(2) palette blocks apply: a hard_block row, or a row blocked for the occasion, is never offered (zh 匂; ja 慰 for a wedding)', none(kanjiOf('zh-Hant', 'spouse', 'across', null), '匂') && none(kanjiOf('ja', 'spouse', 'across', 'wedding'), '慰') && has(kanjiOf('ja', 'spouse', 'across', null), '匂'))
check('(2) "JP only" rows (匂) are offered in Japanese only — not in Chinese, and not in English (judged by both palettes)', has(kanjiOf('ja', 'parent_mother', 'up', null), '匂') && none(kanjiOf('en', 'parent_mother', 'up', null), '匂') && none(kanjiOf('zh-Hans', 'parent_mother', 'up', null), '匂'))
check('(2) the candidate form follows the language: ja 蔵 (inscription 藏), zh 藏 (simplified key)… and the zh key of 楽 is 乐', (() => {
  const ja = eligibleFor(lexicon, palette, gift('ja', 'spouse', 'across', null)).chars.find((c) => c.kanji === '蔵')
  const zh = eligibleFor(lexicon, palette, gift('zh-Hans', 'spouse', 'across', null)).chars
  return ja?.inscription_form === '藏' && zh.some((c) => c.kanji === '乐' && c.inscription_form === '樂')
})())
check('(2) an unspecified relationship narrows nothing by relationship (but 藏 and 恩 still hold)', kanjiOf('ja', null, null, null).length > mother.length && none(kanjiOf('ja', null, null, null), '蔵', '恩'))

// ---- 3. the mode switch -----------------------------------------------------------------------------------------------------------
check('(3) ICHIREI_LEXICON_MODE: default (unset, empty, unknown) = shadow; off / shadow / on in any case', lexiconModeFromEnv({}) === 'shadow' && lexiconModeFromEnv({ ICHIREI_LEXICON_MODE: '' }) === 'shadow' && lexiconModeFromEnv({ ICHIREI_LEXICON_MODE: 'banana' }) === 'shadow' && lexiconModeFromEnv({ ICHIREI_LEXICON_MODE: 'ON' }) === 'on' && lexiconModeFromEnv({ ICHIREI_LEXICON_MODE: ' off ' }) === 'off')
const cloudbuild = read('cloudbuild.yaml')
check('(3) cloudbuild.yaml ships `on` (switched on 2026-10-28 after the live shadow comparison) and passes it on every deploy; the code default without any setting stays shadow', /_LEXICON_MODE: 'on'/.test(cloudbuild) && cloudbuild.includes('ICHIREI_LEXICON_MODE=${_LEXICON_MODE}') && lexiconModeFromEnv({}) === 'shadow')

// ---- 4. the prompt ---------------------------------------------------------------------------------------------------------------------
const setA = eligibleFor(lexicon, palette, gift('ja', 'parent_mother', 'up', 'parent_day'))
const setB = eligibleFor(lexicon, palette, gift('zh-Hant', 'romance', 'across', 'wedding'))
const pa = buildLexiconPrompt(lexicon, setA)
const pb = buildLexiconPrompt(lexicon, setB)
check('(4) the static block is the same for every gift (so it can be cached) and holds every usable lexicon entry; the list for THIS gift is in the dynamic block', pa.staticBlock === pb.staticBlock && pa.dynamicBlock !== pb.dynamicBlock && lexicon.rows.filter((r) => !r.excluded).every((r) => pa.staticBlock.includes(`- ${r.kanji} |`)) && !pa.staticBlock.includes('{{') && !pa.dynamicBlock.includes('{{'))
check('(4) the benchmark rows are not in the prompt at all', !pa.staticBlock.includes('- 默 |') && !pa.staticBlock.includes('- 迎 |') && renderLexiconTable(lexicon).split('\n').length === 165)
const lp = read('engine/lexicon-prompt.md')
check('(4) lexicon-prompt.md carries the reasoning: choose by the person not the tag, slots 1–2 only from the list, freestyle stays open, the no-fit answer (insufficient + lexicon_miss + one question), no classical line written by the model', ['Choose by the person, not the tag', 'must each be one of the characters in the list', 'NOT limited to the lexicon', '"lexicon_miss": true', 'ONE follow-up question', 'Do not write any classical line'].every((n) => lp.includes(n)))

check('(4) the gentle variety rule is in the lexicon prompt: prefer the most story-specific character; a broad virtue (恕 誠 和 敬) is main only when the story is clearly about it; a preference, not a ban', ['Variety, gently', 'most story-specific', '恕, 誠, 和, 敬', 'clearly about that virtue', 'a preference, not a ban'].every((n) => lp.includes(n)) && lp.indexOf('Variety, gently') > lp.indexOf('<!-- ICHIREI:LEXICON-SPLIT -->'))

// ---- fake upstream ---------------------------------------------------------------------------------------------------------------------
interface Seen { kind: 'select' | 'lexicon_select' | 'review' | 'replace'; prompt: string; cached: boolean; content: unknown }
const seen: Seen[] = []
let paletteReply: any = null
let lexiconReply: any = null
let replaceQueue: any[] = []
let lexiconBehavior: 'ok' | 'hang' | 'error' = 'ok'
let reviewVetoes: Record<string, boolean> = {}
const hung: http.ServerResponse[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const content = body.messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: any) => b.text).join('\n') : String(content)
  const isLex = Array.isArray(content)
  const cached = isLex && content[0]?.cache_control?.type === 'ephemeral'
  const kind: Seen['kind'] = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Replacement Prompt (v8)') ? 'replace' : isLex ? 'lexicon_select' : 'select'
  seen.push({ kind, prompt, cached, content })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const start = () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  }
  if (kind === 'lexicon_select' && lexiconBehavior === 'hang') {
    start()
    hung.push(res)
    return
  }
  if (kind === 'lexicon_select' && lexiconBehavior === 'error') {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }))
    return
  }
  let reply: unknown
  if (kind === 'select') reply = paletteReply
  else if (kind === 'lexicon_select') reply = lexiconReply
  else if (kind === 'replace') reply = replaceQueue.length === 0 ? { none: true } : replaceQueue.shift()
  else {
    const items = [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2] }))
    reply = { verdicts: items.map((i) => ({ slot: i.slot, kanji: i.kanji, pass: !reviewVetoes[i.kanji], rule: reviewVetoes[i.kanji] ? 'dignity' : null, reason: 'ok' })) }
  }
  start()
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
for (const k of ['ICHIREI_REVIEW', 'ICHIREI_REPLACE', 'ICHIREI_REPLACE_ATTEMPTS', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_CALL_TIMEOUT_MS', 'ICHIREI_LEXICON_MODE']) delete process.env[k]

const fixture = JSON.parse(read('scripts/fixtures-v8/s0020-mother-thanks.json'))
const STORY: string = fixture.story
const CONTEXT = fixture.context // ja, parent_mother, up, parent_day
const A1 = '何も言わずに台所に戻りました'
const A2 = 'ちょうど今詰めてたところ'
check('(fixture) the anchors are verbatim fragments of the story', STORY.includes(A1) && STORY.includes(A2))
const cand = (slot: string, kanji: string, reading: string, anchor: string, inscription: string | null = null) => ({ slot, kanji, inscription_form: inscription, reading, truth_type: slot === 'main' ? 'Essence' : slot === 'freestyle' ? 'Play' : 'Hidden Cost', one_line_gaze: `${kanji}の人。`, story_anchor: anchor, unique_truth: 'u' })
const reply = (...cands: any[]) => ({ status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: cands, primary_kanji: cands.find((c) => c.slot === 'main')?.kanji ?? null, runner_up_kanji: cands.find((c) => c.slot === 'second')?.kanji ?? null, freestyle_kanji: cands.find((c) => c.slot === 'freestyle')?.kanji ?? null, fallback_follow_up_question: 'いちばん思い出す場面を教えてください。' })
const GOOD = () => reply(cand('main', '待', 'まつ', A1), cand('second', '守', 'まもる', A2), cand('freestyle', '詰', 'つめる', A2))
const MISS = () => ({ status: 'insufficient', lexicon_miss: true, follow_up_question: 'お母さまとの間で、いちばん思い出す小さな場面をひとつ教えてください。', emotional_register: ['grateful', 'regretful'], candidates: [], primary_kanji: null, runner_up_kanji: null, freestyle_kanji: null, fallback_follow_up_question: null })
const PALETTE_ANSWER = () => reply(cand('main', '備', 'そなえる', A1), cand('second', '支', 'ささえる', A2))

const logs: string[] = []
const origLog = console.log
const run = async (o: { mode?: 'off' | 'shadow' | 'on'; palette?: any; lex?: any; followUps?: number; replacements?: any[]; lexicon?: any; vetoes?: Record<string, boolean>; lexBehavior?: 'ok' | 'hang' | 'error'; context?: any } = {}) => {
  paletteReply = o.palette ?? PALETTE_ANSWER()
  lexiconReply = o.lex ?? GOOD()
  replaceQueue = clone(o.replacements ?? [])
  lexiconBehavior = o.lexBehavior ?? 'ok'
  reviewVetoes = o.vetoes ?? {}
  seen.length = 0
  logs.length = 0
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-')) logs.push(l); else origLog(...a) }
  try {
    return await runEngine(STORY, 'A', { context: o.context ?? CONTEXT, lexiconMode: o.mode ?? 'on', followUpsUsed: o.followUps ?? 0, lexicon: o.lexicon })
  } finally {
    console.log = origLog
  }
}
const count = (k: Seen['kind']) => seen.filter((s) => s.kind === k).length
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const slotKanji = (r: EngineResult, slot: string) => live(r).find((c) => c.slot === slot)?.kanji ?? null
const logJson = (tag: string) => logs.filter((l) => l.startsWith(`[ichirei-lexicon] ${tag} `)).map((l) => JSON.parse(l.slice(`[ichirei-lexicon] ${tag} `.length)))
const noStory = () => !logs.some((l) => STORY.split(/[。、\n]/).filter((p) => p.length >= 8).some((p) => l.includes(p)))

// ---- 5. on: the main and second characters come from the lexicon only ----------------------------------------------------------------
{
  const r = await run({ mode: 'on' })
  check('(5) on: slots 1 and 2 are lexicon characters (待 / 守), the freestyle stays open (詰, not in the lexicon)', r.status === 'sufficient' && slotKanji(r, 'main') === '待' && slotKanji(r, 'second') === '守' && slotKanji(r, 'freestyle') === '詰', JSON.stringify(r.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  check('(5) on: ONE selection call (lexicon prompt) and no palette-engine selection beside it', count('lexicon_select') === 1 && count('select') === 0)
  const sel = seen.find((s) => s.kind === 'lexicon_select')!
  const blocks = sel.content as { text: string; cache_control?: unknown }[]
  check('(5) on: the request has the static lexicon block FIRST with prompt caching, then the filled prompt and this gift\'s list', Array.isArray(blocks) && blocks.length === 2 && sel.cached && blocks[0].text.includes('THE LEXICON') && !blocks[1].cache_control && blocks[1].text.includes('CLASSICAL LEXICON — THIS GIFT') && blocks[1].text.indexOf(STORY.slice(0, 20)) < blocks[1].text.indexOf('CLASSICAL LEXICON — THIS GIFT'))
  check('(5) on: the list in the request is this gift\'s (待 is in it, 重 and the benchmark 黙 are not)', (() => { const list = (sel.content as any)[1].text.split('CLASSICAL LEXICON — THIS GIFT')[1]; return list.includes('待') && !list.includes('重 ') && !/^黙/m.test(list) })())
  check('(5) on: the review is kept for the freestyle only (the lexicon characters are pre-vetted): one review call, asking about 詰 alone', count('review') === 1 && (() => { const p = seen.find((s) => s.kind === 'review')!.prompt; return p.includes('"kanji": "詰"') && !p.includes('"kanji": "待"') && !p.includes('"kanji": "守"') })())
  check('(5) on: the result carries the lexicon report (chosen, eligible > 0) and no problems against the contract', r.lexicon?.mode === 'on' && r.lexicon.outcome === 'chosen' && r.lexicon.eligible > 80 && validateEngineResult(r).length === 0, validateEngineResult(r).join('; '))
  check('(5) on: the shown freestyle is the model\'s own; a vetoed freestyle is dropped as before, the lexicon cards stay', (await run({ mode: 'on', vetoes: { 詰: true } })).candidates.filter((c) => !c.eliminated).map((c) => c.slot).join() === 'main,second')
}
{
  // the model slips: slot 1 is not in the lexicon list → the code rejects it and promotes slot 2
  const r = await run({ mode: 'on', lex: reply(cand('main', '花', 'はな', A1), cand('second', '守', 'まもる', A2)), replacements: [{ ...cand('second', '恒', 'つねに', A1) }] })
  const flower = r.candidates.find((c) => c.kanji === '花')!
  check('(5) on: a main character outside the list (花) is rejected by the code: "palette: not_in_lexicon", flagged, never shown', flower.eliminated && flower.eliminated_reason === 'palette: not_in_lexicon' && flower.flags.includes('not_in_lexicon') && r.referee!.actions.some((a) => a.action === 'not_in_lexicon_eliminated' && a.kanji === '花'))
  check('(5) on: slot 2 (守) is promoted to primary and the empty slot is refilled — by a replacement that must also be a lexicon character (恒)', r.primary_kanji === '守' && r.runner_up_kanji === '恒' && r.referee!.actions.some((a) => a.action === 'replacement_added'), JSON.stringify([r.primary_kanji, r.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])]))
  const r2 = await run({ mode: 'on', lex: reply(cand('main', '待', 'まつ', A1), cand('second', '花', 'はな', A2)), replacements: [cand('second', '詰', 'つめる', A2)] })
  check('(5) on: a replacement outside the list (詰) is rejected too; the sender keeps the one valid main card', r2.status === 'sufficient' && slotKanji(r2, 'main') === '待' && slotKanji(r2, 'second') === null && r2.referee!.actions.some((a) => a.action === 'replacement_rejected' && a.kanji === '詰'), JSON.stringify(r2.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
}

// ---- 6. on: nothing fits → one question → still nothing → the palette engine, flagged lexicon_miss ----------------------------------------
{
  const r = await run({ mode: 'on', lex: MISS() })
  check('(6) on, first time: no lexicon character fits → insufficient with the model\'s one follow-up question (no cards, no second model call)', r.status === 'insufficient' && r.candidates.length === 0 && r.follow_up_question!.includes('小さな場面') && count('lexicon_select') === 1 && count('select') === 0 && r.lexicon?.outcome === 'question')
  const miss = logJson('miss')
  check('(6) the miss is logged with relationship, occasion, direction and the emotional register — and no story text', miss.length === 1 && miss[0].relationship === 'parent_mother' && miss[0].occasion === 'parent_day' && miss[0].direction === 'up' && JSON.stringify(miss[0].emotional_register) === '["grateful","regretful"]' && miss[0].outcome === 'question' && miss[0].reason === 'model_no_fit' && noStory(), JSON.stringify(miss))
}
{
  const r = await run({ mode: 'on', lex: MISS(), followUps: 1 })
  check('(6) on, after the follow-up answer: still no fit → the palette engine answers (a palette-prompt selection call follows the lexicon one)', count('lexicon_select') === 1 && count('select') === 1 && r.status === 'sufficient' && slotKanji(r, 'main') === '備' && slotKanji(r, 'second') === '支', JSON.stringify(seen.map((s) => s.kind)))
  check('(6) the fallback is flagged `lexicon_miss` on every card and the report says fallback', live(r).every((c) => c.flags.includes('lexicon_miss')) && r.lexicon?.outcome === 'fallback')
  check('(6) the fallback shows no classical line', r.candidates.every((c) => !c.classical_echo))
  check('(6) the fallback miss is logged (outcome fallback, follow-ups used 1), no story text; the palette call is the old prompt (no lexicon block)', logJson('miss')[0]?.outcome === 'fallback' && logJson('miss')[0]?.follow_ups_used === 1 && noStory() && typeof seen.find((s) => s.kind === 'select')!.content === 'string' && !seen.find((s) => s.kind === 'select')!.prompt.includes('THE LEXICON'))
}
{
  // a story that is simply too thin is the ordinary insufficient — not a lexicon miss, no fallback
  const thin = { ...MISS(), lexicon_miss: undefined }
  const r = await run({ mode: 'on', lex: thin, followUps: 1 })
  check('(6) an ordinary "story too thin" insufficient (no lexicon_miss) is passed on as it is: a question, no palette fallback, no miss logged', r.status === 'insufficient' && count('select') === 0 && logJson('miss').length === 0 && r.lexicon?.outcome === 'question')
}
{
  // the model chose outside the list for BOTH main slots and no replacement helps → treated as a miss (the sender is asked once)
  const bad = reply(cand('main', '花', 'はな', A1), cand('second', '歌', 'うた', A2))
  const r = await run({ mode: 'on', lex: bad })
  check('(6) both main characters outside the list and no valid replacement → insufficient WITH a question, logged as a miss (no_valid_choice)', r.status === 'insufficient' && typeof r.follow_up_question === 'string' && r.follow_up_question.length > 0 && logJson('miss')[0]?.reason === 'no_valid_choice', JSON.stringify([r.status, logJson('miss')]))
  const r2 = await run({ mode: 'on', lex: bad, followUps: 1 })
  check('(6) …and after a follow-up answer the palette engine answers instead', count('select') === 1 && r2.status === 'sufficient' && r2.lexicon?.outcome === 'fallback')
}
{
  const r = await run({ mode: 'on', context: { ...CONTEXT, relationship: 'spouse', direction: 'across', occasion: 'wedding' }, lex: reply(cand('main', '蔵', 'ぞう', A1, '藏'), cand('second', '守', 'まもる', A2)) })
  check('(6) 藏 for a spouse is allowed; the same 蔵 for a mother is rejected as outside this gift\'s list', slotKanji(r, 'main') === '蔵' && (await run({ mode: 'on', lex: reply(cand('main', '蔵', 'ぞう', A1, '藏'), cand('second', '守', 'まもる', A2)) })).candidates.find((c) => c.kanji === '蔵')!.eliminated_reason === 'palette: not_in_lexicon')
  const o = await run({ mode: 'on', lex: reply(cand('main', '恩', 'おん', A1), cand('second', '守', 'まもる', A2)), context: { ...CONTEXT, direction: 'down', occasion: null } })
  check('(6) 恩 going downward is rejected; the same 恩 upward (to a mother) is accepted', o.candidates.find((c) => c.kanji === '恩')!.eliminated_reason === 'palette: not_in_lexicon' && slotKanji(await run({ mode: 'on', lex: reply(cand('main', '恩', 'おん', A1), cand('second', '守', 'まもる', A2)) }), 'main') === '恩')
}

// ---- 7. the classical line on the card ------------------------------------------------------------------------------------------------
{
  const row = (extra: Record<string, string>) => synth('待', 'parent / partner', { line_original: '待つ心', source: '『万葉集』', ...extra })
  const reviewed = { reviewed_by: '田中 花子', reviewed_on: '2026-11-01' }
  const echoOf = (extra: Record<string, string>, lex = synthLex(row(extra))) => lexiconEchoOf(eligibleFor(lex, palette, gift('ja', 'parent_mother', 'up', null)), { kanji: '待', inscription_form: null })
  check('(7) a human-reviewed row with card_fit high is shown: line_original + source', JSON.stringify(echoOf(reviewed)) === JSON.stringify({ text: '待つ心', source: '『万葉集』' }))
  check('(7) not reviewed (empty), reviewed by an AI ("Claude…"), or an interim / draft marker → no line', echoOf({}) === null && echoOf({ reviewed_by: 'Claude(AI一次確認)', reviewed_on: '2026-10-27' }) === null && echoOf({ reviewed_by: 'claude-sonnet', reviewed_on: 'x' }) === null && echoOf({ reviewed_by: 'interim-unreviewed' }) === null && echoOf({ reviewed_by: 'draft-unreviewed' }) === null)
  check('(7) card_fit medium or low → no line, even when reviewed', echoOf({ ...reviewed, card_fit: 'medium' }) === null && echoOf({ ...reviewed, card_fit: 'low' }) === null)
  check('(7) kana_only = yes is never the card line, even when reviewed and high', echoOf({ ...reviewed, kana_only: 'yes' }) === null)
  check('(7) a reviewed row with no line or no source shows nothing', echoOf({ ...reviewed, line_original: '' }) === null && echoOf({ ...reviewed, source: '' }) === null)
  check('(7) rowShowsLine / rowReviewedByHuman agree', rowShowsLine(synthLex(row(reviewed)).rows[0]) && !rowShowsLine(synthLex(row({})).rows[0]))
  const two = synthLex(row({ ...reviewed, card_fit: 'low' }), synth('待', 'parent', { line_original: '二つ目', source: '二', ...reviewed }))
  check('(7) of several rows for one character, the first that may show its line is used', echoOf({}, two)?.text === '二つ目')

  // end to end: the line reaches the card only through the lexicon, only when human-reviewed
  const real = loadLexicon()
  check('(7) the real lexicon: no card shows a classical line yet (nothing human-reviewed) — on mode, a mother', (await run({ mode: 'on', lexicon: real })).candidates.every((c) => !c.classical_echo))
  const patched = synthLex(synth('待', 'parent / partner', { line_original: '待つ心', source: '『万葉集』', ...reviewed }), synth('守', 'parent / partner', { line_original: '守る心', source: '『詩経』', reviewed_by: 'Claude(AI一次確認)', reviewed_on: '2026-10-27' }), synth('恒', 'parent', { line_original: 'かな', source: 'かな集', kana_only: 'yes', ...reviewed }))
  const r = await run({ mode: 'on', lexicon: patched })
  check('(7) on, a patched lexicon: the human-reviewed row\'s line is on the main card; the AI-reviewed row\'s card has none; the freestyle never has one', r.status === 'sufficient' && r.candidates.find((c) => c.slot === 'main')!.classical_echo?.text === '待つ心' && r.candidates.find((c) => c.slot === 'second')!.classical_echo === null && r.candidates.find((c) => c.slot === 'freestyle')!.classical_echo === null, JSON.stringify(r.candidates.map((c) => [c.kanji, c.classical_echo])))
  check('(7) the patched lexicon limits the pool: with only three characters 待 守 恒, a model choice outside them (e.g. 灯) is rejected', (await run({ mode: 'on', lexicon: patched, lex: reply(cand('main', '灯', 'ひ', A1), cand('second', '守', 'まもる', A2)) })).candidates.find((c) => c.kanji === '灯')!.eliminated_reason === 'palette: not_in_lexicon')
}

// ---- 8. shadow and off ----------------------------------------------------------------------------------------------------------------------
process.env.ICHIREI_SHADOW_GRACE_MS = '1500'
{
  const r = await run({ mode: 'shadow' })
  check('(8) shadow: the customer sees today\'s result (備 / 支, from the palette engine) — no lexicon field, no change', slotKanji(r, 'main') === '備' && slotKanji(r, 'second') === '支' && r.lexicon === undefined && !live(r).some((c) => c.flags.includes('lexicon_miss')))
  check('(8) shadow: one extra, selection-only call (lexicon prompt, cached); the palette run keeps its own review; the shadow has no review and no replacement', count('select') === 1 && count('lexicon_select') === 1 && count('review') === 1 && count('replace') === 0 && seen.find((s) => s.kind === 'lexicon_select')!.cached)
  const sh = logJson('shadow')
  check('(8) shadow: ONE log line says what lexicon mode would have chosen next to what the customer got — kanji only, no story text', sh.length === 1 && sh[0].lexicon_main === '待' && sh[0].lexicon_second === '守' && sh[0].today_main === '備' && sh[0].today_second === '支' && sh[0].same_main === false && sh[0].relationship === 'parent_mother' && sh[0].occasion === 'parent_day' && sh[0].result === 'chosen' && noStory(), JSON.stringify(sh))
}
{
  const r = await run({ mode: 'shadow', lex: MISS() })
  check('(8) shadow: a lexicon miss is logged as a miss in the shadow line; the customer\'s result is unchanged', slotKanji(r, 'main') === '備' && logJson('shadow')[0]?.result === 'miss')
}
{
  const t0 = Date.now()
  const r = await run({ mode: 'shadow', lexBehavior: 'error' })
  check('(8) shadow: a failing side call changes nothing for the customer (and is logged as an error)', slotKanji(r, 'main') === '備' && logJson('shadow')[0]?.result === 'error')
  const t1 = Date.now()
  const h = await run({ mode: 'shadow', lexBehavior: 'hang' })
  check('(8) shadow: a hanging side call is cut off after the grace period; the customer gets the palette result, and the timeout is logged', slotKanji(h, 'main') === '備' && logJson('shadow')[0]?.result === 'timeout' && Date.now() - t1 < 8000, `${Date.now() - t1} ms ${t0}`)
}
{
  const r = await run({ mode: 'off' })
  check('(8) off: the palette engine alone — one selection (a plain string prompt), one review, no lexicon call, no lexicon field', count('select') === 1 && count('lexicon_select') === 0 && count('review') === 1 && typeof seen.find((s) => s.kind === 'select')!.content === 'string' && r.lexicon === undefined && slotKanji(r, 'main') === '備')
  const dflt = await (async () => { delete process.env.ICHIREI_LEXICON_MODE; paletteReply = PALETTE_ANSWER(); lexiconReply = GOOD(); seen.length = 0; const o = console.log; console.log = () => {}; try { return await runEngine(STORY, 'A', { context: CONTEXT }) } finally { console.log = o } })()
  check('(8) with no mode given at all the default is shadow: the palette answer, plus the side call', slotKanji(dflt, 'main') === '備' && count('lexicon_select') === 1)
}
{
  // an unusable lexicon file must never take the engine down
  process.env.ICHIREI_LEXICON_PATH = '/nonexistent/lexicon.csv'
  const r = await run({ mode: 'on' })
  delete process.env.ICHIREI_LEXICON_PATH
  check('(8) a missing lexicon file: the engine falls back to the palette engine and logs it — it never fails the request', slotKanji(r, 'main') === '備' && count('lexicon_select') === 0 && logs.some((l) => l.startsWith('[ichirei-lexicon] unavailable')))
}

// ---- 8b. the daily count of main characters ----------------------------------------------------------------------------------------------
{
  resetMainTally()
  const lines: string[] = []
  const at = new Date('2026-10-28T03:00:00Z') // 12:00 JST
  const res = (kanji: string, extra: Partial<EngineResult> = {}) => ({ status: 'sufficient', primary_kanji: kanji, language: 'ja', relationship: 'parent_mother', occasion: 'parent_day', candidates: [], ...extra }) as unknown as EngineResult
  logMainCharacter(res('待'), at, (l) => lines.push(l))
  logMainCharacter(res('待', { lexicon: { mode: 'on', outcome: 'chosen', eligible: 80 } }), at, (l) => lines.push(l))
  logMainCharacter(res('守'), at, (l) => lines.push(l))
  logMainCharacter(res('待', { lexicon: { mode: 'on', outcome: 'fallback', eligible: 80 } }), new Date('2026-10-28T14:00:00Z'), (l) => lines.push(l)) // 23:00 JST: same business day
  logMainCharacter(res('待'), new Date('2026-10-28T15:30:00Z'), (l) => lines.push(l)) // 00:30 JST next day: counter starts over
  const rows = lines.map((l) => JSON.parse(l.replace('[ichirei-main] ', '')))
  check('(8b) one line per shown main: the character, the JST day, and how many times it has been the main today on this instance', lines.every((l) => l.startsWith('[ichirei-main] ')) && rows.map((r) => `${r.kanji}${r.count_today_on_this_instance}`).join() === '待1,待2,守1,待3,待1' && rows[0].day === '2026-10-28' && rows[4].day === '2026-10-29', JSON.stringify(rows.map((r) => [r.day, r.kanji, r.count_today_on_this_instance])))
  check('(8b) the line says where the main came from (palette / lexicon / palette after a lexicon miss) and carries codes only', rows.slice(0, 4).map((r) => r.source).join() === 'palette,lexicon,palette,palette_after_lexicon_miss' && Object.keys(rows[0]).sort().join() === 'count_today_on_this_instance,day,kanji,language,occasion,relationship,source')
  check('(8b) an insufficient result has no main and logs nothing', logMainCharacter({ ...res('待'), status: 'insufficient', primary_kanji: null } as EngineResult, at, (l) => lines.push(l)) === null && lines.length === 5)
  resetMainTally()
  const r = await run({ mode: 'on' })
  const mains = logs.filter((l) => l.startsWith('[ichirei-main] '))
  check('(8b) a real run logs its main exactly once, with no story text', mains.length === 1 && JSON.parse(mains[0].slice(15)).kanji === r.primary_kanji && JSON.parse(mains[0].slice(15)).source === 'lexicon' && noStory(), mains.join('|'))
}

// ---- 9. /api/health -------------------------------------------------------------------------------------------------------------------------
{
  const server = await startServer({ upstreamUrl: process.env.ANTHROPIC_BASE_URL, env: { ICHIREI_LEXICON_MODE: '' } })
  try {
    const h = await (await fetch(`${server.url}/api/health`)).json()
    check('(9) /api/health reports the lexicon mode (shadow by default)', h.lexiconMode === 'shadow', JSON.stringify(h).slice(0, 300))
  } finally {
    await server.stop()
  }
  const on = await startServer({ upstreamUrl: process.env.ANTHROPIC_BASE_URL, env: { ICHIREI_LEXICON_MODE: 'on' } })
  try {
    const h = await (await fetch(`${on.url}/api/health`)).json()
    check('(9) …and `on` when it is switched on', h.lexiconMode === 'on')
  } finally {
    await on.stop()
  }
}

for (const r of hung) r.destroy()
upstream.closeAllConnections?.()
upstream.close()
console.log(failures === 0 ? '\nAll v9 checks passed.' : `\n${failures} v9 check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
