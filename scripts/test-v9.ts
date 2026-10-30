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
import { DECLINE_MESSAGE, REVIEW_VETO_RULES, validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { BROAD_VIRTUES, LEXICON_COLUMNS, buildLexiconPrompt, eligibleFor, lexiconEchoOf, lexiconModeFromEnv, lexiconRowIn, loadLexicon, parseLexicon, renderEligible, renderLexiconTable, rowReviewedByHuman, rowShowsLine } from '../engine/lexicon.ts'
import { loadPalette, parseCsv } from '../engine/palette.ts'
import { isJoyo } from '../engine/joyo.ts'
import { logMainCharacter, logSafetyRemovals, resetMainTally } from '../engine/main-count.ts'
import { attachStrokes, simpleMaxStrokes, strokesOf } from '../engine/strokes.ts'
import { parseOrderRequest } from '../engine/order.ts'
import { DEFAULT_STYLE, STYLES_BY_LANGUAGE, glyphFor, hasFormChoice, normalizeStyle } from '../src/order/inscription.ts'
import { simpleAvailable } from '../src/order/strokes.ts'
import { COPY, carvedGlyph } from '../src/demo/i18n.ts'
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
const paletteCsv = parseCsv(read('engine/palette.csv'))
const headerIdx = Object.fromEntries(paletteCsv[0].map((h, i) => [h, i])) as Record<string, number>
const paletteRows = paletteCsv.slice(1)
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
check('(2) 恩 is upward only (spec v9.1 step 3): offered up, never down, across, to a partner or with no direction — even if its row said partner', has(kanjiOf('ja', 'parent_mother', 'up', null), '恩') && none(kanjiOf('ja', 'spouse', 'across', null, grat), '恩') && none(kanjiOf('ja', 'parent_mother', 'down', null), '恩') && none(kanjiOf('ja', 'mentor', 'across', null), '恩') && none(kanjiOf('ja', 'parent_mother', null, null), '恩') && has(kanjiOf('ja', 'spouse', 'up', null, grat), '恩'))
check('(2) …and the real 恩 row is listed for parent / mentor / work / memorial, so a child receiving it from a parent (direction down) never sees it', none(kanjiOf('ja', 'child', 'down', 'birthday_milestone'), '恩'))
const green = synthLex(synth('綠', 'friend / partner / parent'))
check('(2) 綠 is not for a partner in Chinese (zh and en), even if its row said partner; fine for a partner in Japanese and for a friend in Chinese', none(kanjiOf('zh-Hant', 'spouse', 'across', null, green), '绿') && none(kanjiOf('zh-Hans', 'romance', 'across', null, green), '绿') && none(kanjiOf('en', 'spouse', 'across', null, green), '緑') && has(kanjiOf('ja', 'spouse', 'across', null, green), '緑') && has(kanjiOf('zh-Hant', 'friend', 'across', null, green), '绿'), JSON.stringify([kanjiOf('zh-Hant', 'spouse', 'across', null, green), kanjiOf('ja', 'spouse', 'across', null, green), kanjiOf('zh-Hant', 'friend', 'across', null, green)]))
check('(2) the real 綠 row: friend / mentor / work / parent only, so a Chinese partner never gets it', none(kanjiOf('zh-Hant', 'spouse', 'across', null), '绿') && has(kanjiOf('zh-Hant', 'friend', 'across', null), '绿'))
const mem = kanjiOf('ja', 'parent_mother', 'up', 'memorial')
check('(2) memorial: the "memorial" tag is guidance only (spec v9.1 step 3) — the remembrance default block (祝 寿 喜 初 新 婚 …) is what removes characters', mem.length > 100 && has(mem, '偲', '憶') && none(mem, '祝', '寿', '喜', '初', '新', '婚'), `${mem.length}`)
check('(2) palette blocks apply: a hard_block row, or a row blocked for the occasion, is never offered (zh 匂; ja 慰 for a wedding)', none(kanjiOf('zh-Hant', 'spouse', 'across', null), '匂') && none(kanjiOf('ja', 'spouse', 'across', 'wedding'), '慰') && has(kanjiOf('ja', 'spouse', 'across', null), '匂'))
check('(2) "JP only" rows (匂) are offered in Japanese only — not in Chinese, and not in English (judged by both palettes)', has(kanjiOf('ja', 'parent_mother', 'up', null), '匂') && none(kanjiOf('en', 'parent_mother', 'up', null), '匂') && none(kanjiOf('zh-Hans', 'parent_mother', 'up', null), '匂'))
check('(2) the candidate form follows the language: ja 蔵 (inscription 藏), zh 藏 (simplified key)… and the zh key of 楽 is 乐', (() => {
  const ja = eligibleFor(lexicon, palette, gift('ja', 'spouse', 'across', null)).chars.find((c) => c.kanji === '蔵')
  const zh = eligibleFor(lexicon, palette, gift('zh-Hans', 'spouse', 'across', null)).chars
  return ja?.inscription_form === '藏' && zh.some((c) => c.kanji === '乐' && c.inscription_form === '樂')
})())
check('(2) relationship tags are GUIDANCE, not a filter (spec v9.1 step 3): the open list is the same for a mother, a friend and a child — only which characters are listed for the relationship differs', JSON.stringify(kanjiOf('ja', 'parent_mother', 'up', null)) === JSON.stringify(kanjiOf('ja', 'friend', 'up', null)) && JSON.stringify(kanjiOf('ja', 'child', 'up', null)) === JSON.stringify(kanjiOf('ja', 'friend', 'up', null)) && none(kanjiOf('ja', null, null, null), '蔵', '恩'))
check('(2) …the listing: with a known relationship the characters listed for it come first and the rest follow under their own heading, still open', (() => { const set = eligibleFor(lexicon, palette, gift('ja', 'child', 'down', null)); const listed = set.chars.filter((c) => c.suitsRelationship).length; const text = renderEligible(set, 'child'); return listed > 20 && listed < 80 && set.chars.length > 120 && text.includes('Listed as suiting this relationship (child)') && text.includes('Also open to this gift but not listed') && text.includes('guidance, not a rule') })())

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

check('(4) the variety rule is in the lexicon prompt (stronger, v9.2): the most story-specific character; a broad virtue (恕 誠 和 敬) is main ONLY when the key moment of the story is explicitly about that virtue, otherwise it is the second at most', ['8. Variety.', 'most story-specific', '恕, 誠, 和, 敬', 'key moment of the story is explicitly about that virtue', 'ONLY'].every((n) => lp.includes(n)) && !lp.includes('a preference, not a ban') && lp.indexOf('8. Variety.') > lp.indexOf('<!-- ICHIREI:LEXICON-SPLIT -->'))

// ---- fake upstream ---------------------------------------------------------------------------------------------------------------------
interface Seen { kind: 'select' | 'lexicon_select' | 'review' | 'replace'; prompt: string; cached: boolean; content: unknown }
const seen: Seen[] = []
let paletteReply: any = null
let lexiconReply: any = null
let replaceQueue: any[] = []
let lexiconBehavior: 'ok' | 'hang' | 'error' = 'ok'
let reviewVetoes: Record<string, boolean> = {}
let reviewRule = 'dignity'
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
    reply = { verdicts: items.map((i) => ({ slot: i.slot, kanji: i.kanji, pass: !reviewVetoes[i.kanji], rule: reviewVetoes[i.kanji] ? reviewRule : null, reason: 'ok' })) }
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
const lines11: string[] = []
const origLog = console.log
const run = async (o: { mode?: 'off' | 'shadow' | 'on'; palette?: any; lex?: any; followUps?: number; replacements?: any[]; lexicon?: any; vetoes?: Record<string, boolean>; lexBehavior?: 'ok' | 'hang' | 'error'; context?: any; story?: string; rule?: string } = {}) => {
  reviewRule = o.rule ?? 'dignity'
  paletteReply = o.palette ?? PALETTE_ANSWER()
  lexiconReply = o.lex ?? GOOD()
  replaceQueue = clone(o.replacements ?? [])
  lexiconBehavior = o.lexBehavior ?? 'ok'
  reviewVetoes = o.vetoes ?? {}
  seen.length = 0
  logs.length = 0
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-')) logs.push(l); else origLog(...a) }
  try {
    return await runEngine(o.story ?? STORY, 'A', { context: o.context ?? CONTEXT, lexiconMode: o.mode ?? 'on', followUpsUsed: o.followUps ?? 0, lexicon: o.lexicon })
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
  check('(5) on: the review checks ALL three cards (spec v9.1 step 7) — lexicon characters included: one review call asking about 待, 守 and 詰', count('review') === 1 && (() => { const p = seen.find((s) => s.kind === 'review')!.prompt; return p.includes('"kanji": "詰"') && p.includes('"kanji": "待"') && p.includes('"kanji": "守"') })())
  check('(5) on: the result carries the lexicon report (chosen, eligible > 0) and no problems against the contract', r.lexicon?.mode === 'on' && r.lexicon.outcome === 'chosen' && r.lexicon.eligible > 80 && validateEngineResult(r).length === 0, validateEngineResult(r).join('; '))
  check('(5) on: the shown freestyle is the model\'s own; a vetoed freestyle is dropped as before, the lexicon cards stay', (await run({ mode: 'on', vetoes: { 詰: true } })).candidates.filter((c) => !c.eliminated).map((c) => c.slot).join() === 'main,second')
}
{
  // the model slips: slot 1 is not in the lexicon list → the code rejects it and promotes slot 2
  const r = await run({ mode: 'on', lex: reply(cand('main', '花', 'はな', A1), cand('second', '守', 'まもる', A2)), replacements: [{ ...cand('second', '恒', 'つねに', A1) }] })
  const flower = r.candidates.find((c) => c.kanji === '花')!
  check('(5) on: a main character outside the list (花) is rejected by the code: "palette: not_in_lexicon", flagged, never shown', flower.eliminated && flower.eliminated_reason === 'palette: not_in_lexicon' && flower.flags.includes('not_in_lexicon') && r.referee!.actions.some((a) => a.action === 'not_in_lexicon_eliminated' && a.kanji === '花'))
  check('(5) on: slot 2 (守) is promoted to primary; the empty SECOND slot is NOT refilled (spec step 8: replacement is for the main slot only) — one main card, no replacement call', r.primary_kanji === '守' && r.runner_up_kanji === null && !r.referee!.actions.some((a) => a.action === 'replacement_added') && count('replace') === 0, JSON.stringify([r.primary_kanji, r.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])]))
  const r2 = await run({ mode: 'on', lex: reply(cand('main', '待', 'まつ', A1), cand('second', '花', 'はな', A2)), replacements: [cand('second', '詰', 'つめる', A2)] })
  check('(5) on: a removed second card (花, not in the list) is not replaced (no replacement call, even though one is on offer); the sender keeps the one valid main card', r2.status === 'sufficient' && slotKanji(r2, 'main') === '待' && slotKanji(r2, 'second') === null && count('replace') === 0, JSON.stringify(r2.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  // both mains off the list → the main slot IS empty: ONE replacement is tried, and it must be a lexicon character too
  const r3 = await run({ mode: 'on', lex: reply(cand('main', '花', 'はな', A1), cand('second', '詰', 'つめる', A2)), replacements: [cand('second', '恒', 'つねに', A1)] })
  check('(5) on: when BOTH mains are off the list the main slot is empty, so one replacement is tried; a lexicon character (恒) becomes the main', r3.status === 'sufficient' && slotKanji(r3, 'main') === '恒' && count('replace') === 1, JSON.stringify(r3.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  const r4 = await run({ mode: 'on', lex: reply(cand('main', '花', 'はな', A1), cand('second', '詰', 'つめる', A2)), replacements: [cand('second', '詰', 'つめる', A2)] })
  check('(5) on: …and a replacement outside the list is rejected too (never a card the lexicon does not hold as a main)', count('replace') === 1 && r4.status !== 'sufficient' || (r4.referee?.actions.some((a) => a.action === 'replacement_rejected') ?? false), JSON.stringify([r4.status, r4.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])]))
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
  check('(8b) the line says where the main came from (palette / lexicon / palette after a lexicon miss) and carries codes only', rows.slice(0, 4).map((r) => r.source).join() === 'palette,lexicon,palette,palette_after_lexicon_miss' && Object.keys(rows[0]).sort().join() === 'broad_virtue,count_today_on_this_instance,day,joyo,kanji,language,occasion,relationship,source')
  check('(8b) an insufficient result has no main and logs nothing', logMainCharacter({ ...res('待'), status: 'insufficient', primary_kanji: null } as EngineResult, at, (l) => lines.push(l)) === null && lines.length === 5)
  resetMainTally()
  const r = await run({ mode: 'on' })
  const mains = logs.filter((l) => l.startsWith('[ichirei-main] '))
  check('(8b) a real run logs its main exactly once, with no story text', mains.length === 1 && JSON.parse(mains[0].slice(15)).kanji === r.primary_kanji && JSON.parse(mains[0].slice(15)).source === 'lexicon' && noStory(), mains.join('|'))
}

// ---- 8c. illness and frailty (level 4: judged per gift by the AI) ----------------------------------------------------------------------
{
  const fx = JSON.parse(read('scripts/fixtures-v9/s0005-teacher-stroke-illness.json'))
  check('(8c) 篤 is NOT blocked by the palette (spec v9.1 section C: a lexicon character with a verified line is never level 1): context_required + anchor in ja and zh', pal('ja', '篤').status === 'context_required' && pal('ja', '篤').anchor_required && pal('zh', '笃').status === 'context_required')
  for (const fam of ['ja', 'zh', 'en']) {
    const t = read(`engine/prompt.${fam}.md`)
    const block = t.slice(t.indexOf('ILLNESS AND FRAILTY'), t.indexOf('RELATIONSHIP TEST'))
    check(`(8c) prompt.${fam}.md: the illness rule — every slot incl. the freestyle, illness / hospital / stroke / dementia / frailty, illness-or-death associations in the buyer's language, examples, "when in doubt do not choose it", the review may veto`, block.length > 300 && ['EVERY slot', 'stroke', 'dementia', 'frail', 'NEVER choose', 'when in doubt', 'may veto'].every((n) => block.includes(n)) && (fam === 'zh' ? block.includes('笃') && block.includes('逝') : ['篤', '峠', '迎', '渡', '逝', '終', '静'].every((k) => block.includes(k))), fam)
  }
  const rp = read('engine/review-prompt.md')
  check('(8c) review-prompt.md: `illness` is a named safety rule for main, second and freestyle, with the Japanese and Chinese examples; the output shape lists it', rp.includes('6. `illness`') && rp.includes('4. `illness`') && ['篤', '峠', '迎', '渡', '逝', '終', '静'].every((k) => rp.includes(k)) && rp.includes('| "illness"') && rp.includes('`insult`, `illness`'))
  check('(8c) `illness` is in REVIEW_VETO_RULES (a veto under it is applied, not ignored)', (REVIEW_VETO_RULES as readonly string[]).includes('illness'))
  check('(8c) lexicon-prompt.md: the illness rule applies to the list too', lp.includes('ILLNESS AND FRAILTY') && lp.includes('lexicon_miss'))

  const slim = () => clone(fx.model_reply)
  for (const mode of ['off', 'on'] as const) {
    const pass = await run({ mode, story: fx.story, context: fx.context, palette: slim(), lex: slim() })
    check(`(8c) fixture teacher-stroke (${mode}): the palette alone does not remove 篤 any more — keeping it away from an ill receiver is the AI rule's job (prompt + review)`, live(pass).some((c) => c.kanji === '篤'))
    const r = await run({ mode, story: fx.story, context: fx.context, palette: slim(), lex: slim(), vetoes: { 篤: true }, rule: 'illness' })
    check(`(8c) fixture teacher-stroke (${mode}): the review vetoes 篤 under \`illness\` (applied, not ignored): 篤 is gone from every slot, 存 stays the main, 綴 the freestyle`, !live(r).some((c) => c.kanji === '篤') && r.primary_kanji === '存' && slotKanji(r, 'freestyle') === '綴' && r.candidates.find((c) => c.kanji === '篤')?.eliminated_reason?.startsWith('review: illness') === true, JSON.stringify(r.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  }
  const ill = slim(); ill.candidates[1].kanji = '守'; ill.candidates[1].reading = 'まもる'; ill.runner_up_kanji = '守'
  const rv = await run({ mode: 'off', story: fx.story, context: fx.context, palette: ill, vetoes: { 存: true }, rule: 'illness' })
  check('(8c) the review vetoes a MAIN under `illness`: 存 is out and 守 is promoted', rv.primary_kanji === '守' && rv.candidates.find((c) => c.kanji === '存')?.eliminated_reason?.startsWith('review: illness') === true)
  const rfv = await run({ mode: 'off', story: fx.story, context: fx.context, palette: ill, vetoes: { 綴: true }, rule: 'illness' })
  check('(8c) …and a freestyle under `illness` is dropped', rfv.freestyle_kanji === null && rfv.primary_kanji === '存')
}

// ---- 8d. spec v9.1 — section C and steps 1–7, 9, 11 ---------------------------------------------------------------------------------------
{
  // section C
  const status = (f: 'ja' | 'zh', k: string) => pal(f, k).status
  check('(C) level 1: the expert\'s do-not-use list 黙/默 迎 執 忍 走 is a hard block in BOTH palettes (never used in any slot)', (['ja', 'zh'] as const).every((f) => (f === 'ja' ? ['黙', '迎', '執', '忍', '走'] : ['默', '迎', '执', '忍', '走']).every((k) => status(f, k) === 'hard_block')))
  check('(C) level 1: the ending words stay hard blocks — 死 病 逝 葬 終 別 in ja, and 别 in zh too (it was context_required)', ['死', '病', '逝', '葬', '終', '別'].every((k) => status('ja', k) === 'hard_block') && ['死', '病', '逝', '葬', '终', '别'].every((k) => status('zh', k) === 'hard_block'))
  check('(C) level 2 (needs story support): 耐 渡 草 犬 梨 冷 寒 涙 and 切 are context_required with an anchor in ja AND zh (切 moved from level 1 by the owner)', ['耐', '渡', '草', '犬', '梨', '冷', '寒', '切'].every((k) => (['ja', 'zh'] as const).every((f) => status(f, k) === 'context_required' && pal(f, k).anchor_required)) && (['ja', 'zh'] as const).every((f) => status(f, f === 'zh' ? '泪' : '涙') === 'context_required'))
  check('(C) level 3 (milestone): 渡 冬 夕 影 菊 are blocked for birthday_milestone in ja and zh, 峠 in ja (迎 is level 1 now)', (['ja', 'zh'] as const).every((f) => ['渡', '冬', '夕', '影', '菊'].every((k) => pal(f, k).blocked_occasions.includes('birthday_milestone'))) && pal('ja', '峠').blocked_occasions.includes('birthday_milestone'))
  check('(C) level 3 (wedding): 帰 秋 続 継 耐 還 断 are blocked for weddings in the JAPANESE palette only; for Chinese buyers only 断 is blocked (a hard block) — 归 秋 续 继 耐 are open, and there is no zh 还 row (owner decision: those are Japanese 忌み言葉)', ['帰', '秋', '続', '継', '耐', '還', '断'].every((k) => pal('ja', k).blocked_occasions.includes('wedding')) && ['归', '秋', '续', '继', '耐'].every((k) => !pal('zh', k).blocked_occasions.includes('wedding') && pal('zh', k).status !== 'hard_block') && status('zh', '断') === 'hard_block' && !paletteRows.some((r) => r[headerIdx.language] === 'zh' && (r[headerIdx.kanji] === '还' || r[headerIdx.inscription_form] === '還')))
  check('(C) level 3 (remembrance): the default block carries 祝 寿 喜 初 新 婚', ['祝', '寿', '喜', '初', '新', '婚'].every((k) => palette.memorialCategory([k]) !== undefined))
  const hardInLexicon: string[] = []
  for (const k of lexicon.distinct()) for (const f of ['ja', 'zh'] as const) { const row = lexiconRowIn(palette, f, k); if (row?.status === 'hard_block') hardInLexicon.push(`${f}:${row.kanji}`) }
  check('(C) a lexicon character with a verified line is never level 1 — the ONLY lexicon character that is a hard block anywhere is zh 匂 (a Japanese-made character that does not exist in Chinese; reported to the owner as a deliberate exception)', hardInLexicon.join() === 'zh:匂', hardInLexicon.join())
  const changes = parseCsv(read('review/v9_1_section_c_changes.csv'))
  check('(C) review/v9_1_section_c_changes.csv lists every changed status / flag with its before, after and reason', changes[0].join() === 'family,character,field,before,after,reason' && changes.length > 50 && changes.slice(1).every((r) => r.length === 6 && r[5] !== '') && changes.some((r) => r[0] === 'ja' && r[1] === '篤' && r[2] === 'status' && r[3] === 'hard_block' && r[4] === 'context_required'))
  check('(C) English buyers: blocked in EITHER row blocks it — 匂 (ja fine, zh hard block) and the level-1 characters are not offered to en', none(kanjiOf('en', 'parent_mother', 'up', null), '匂', '迎', '黙', '死'))

  // step 1: goodwill
  const hostile = { status: 'insufficient', goodwill_declined: true, follow_up_question: null, candidates: [], primary_kanji: null, runner_up_kanji: null, freestyle_kanji: null, emotional_register: ['contempt'] }
  const gd = await run({ mode: 'on', lex: hostile })
  check('(1) goodwill (selection): a hostile story gets a polite decline — insufficient, declined: true, the fixed polite message, no cards, no question to answer, nothing else called', gd.status === 'insufficient' && gd.declined === true && gd.follow_up_question === DECLINE_MESSAGE.ja && gd.candidates.length === 0 && count('review') === 0 && count('replace') === 0 && gd.lexicon === undefined && !('goodwill_declined' in gd))
  check('(1) …the decline is logged as [ichirei-safety] goodwill_decline with codes only (no story text) and is not a lexicon miss', logs.some((l) => l.startsWith('[ichirei-safety] goodwill_decline')) && noStory() && logJson('miss').length === 0)
  check('(1) …the decline message exists in all four languages and accuses nobody', (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => DECLINE_MESSAGE[l].length > 40))
  const gr = await run({ mode: 'off', vetoes: { 備: true }, rule: 'goodwill' })
  check('(1) goodwill (review): a verdict under the rule `goodwill` on any card declines the whole result politely', gr.declined === true && gr.status === 'insufficient' && gr.candidates.length === 0 && logs.some((l) => l.includes('"stage":"review"')))
  const notHostile = await run({ mode: 'off' })
  check('(1) an ordinary story is not declined', notHostile.declined === undefined && notHostile.status === 'sufficient')
  for (const fam of ['ja', 'zh', 'en']) {
    const t = read(`engine/prompt.${fam}.md`)
    check(`(1) prompt.${fam}.md carries the goodwill check (hostile or mocking → decline; critical-but-loving is answered) and the output contract field`, t.includes('GOODWILL CHECK') && t.includes('goodwill_declined') && t.includes('NOT hostile'), fam)
  }

  // step 2: truth + ideal character
  const withIdeal = (ideal: string) => ({ truth: 'she was always ready, without ever being asked', ideal_character: ideal, ...GOOD() })
  await run({ mode: 'on', lex: withIdeal('伴') })
  const miss1 = logJson('ideal_not_in_lexicon')
  check('(2) the ideal character (no limits) is logged when it is not on the list: ideal_not_in_lexicon with the character, whether it is in the lexicon at all, and codes — never story text or the truth sentence', miss1.length === 1 && miss1[0].ideal === '伴' && miss1[0].in_lexicon === false && miss1[0].relationship === 'parent_mother' && miss1[0].occasion === 'parent_day' && noStory() && !logs.some((l) => l.includes('ready, without')), JSON.stringify(miss1))
  await run({ mode: 'on', lex: withIdeal('待') })
  check('(2) an ideal character that IS on the list is not logged', logJson('ideal_not_in_lexicon').length === 0)
  await run({ mode: 'on', lex: withIdeal('恩'), context: { ...CONTEXT, relationship: 'child', direction: 'down', occasion: null } })
  const miss2 = logJson('ideal_not_in_lexicon')
  check('(2) an ideal that is in the lexicon but not open to this gift (恩 going downward) is logged with in_lexicon true', miss2.length === 1 && miss2[0].ideal === '恩' && miss2[0].in_lexicon === true && miss2[0].reason === 'in_lexicon_but_not_open_to_this_gift', JSON.stringify(miss2))
  const rr = await run({ mode: 'on', lex: withIdeal('待') })
  check('(2) `truth` and `ideal_character` are read by the engine and never passed on to the page', !('truth' in rr) && !('ideal_character' in rr))
  const sel = seen.find((s) => s.kind === 'lexicon_select')!.prompt
  check('(2) the lexicon prompt asks for them FIRST: a one-sentence truth, then the ideal character with no limits, then the choice from the list', sel.includes('`truth`') && sel.includes('`ideal_character`') && sel.includes('Order of work') && sel.includes('if the ideal character is on the list, use it'))

  // step 4 + 7: relationship test
  for (const fam of ['ja', 'zh', 'en']) {
    const t = read(`engine/prompt.${fam}.md`)
    check(`(4) prompt.${fam}.md: the RELATIONSHIP TEST — read relationship and direction together; reject 恩 parent→child, 耐 husband→wife, 慕 employee→boss; the same characters are right in a fitting relationship; applies to every slot; the review may veto`, ['RELATIONSHIP TEST', 'EVERY slot', 'in front of their family', 'seen and honoured', 'judged, owed, pitied, embarrassed, romantically misread', '恩', '耐', '慕', 'may veto'].every((n) => t.includes(n)), fam)
  }
  const rp2 = read('engine/review-prompt.md')
  check('(7) review-prompt.md: `relationship` and `goodwill` are named safety rules for the main / second AND the freestyle; the veto rules list them', rp2.includes('7. `relationship`') && rp2.includes('8. `goodwill`') && rp2.includes('5. `relationship`') && rp2.includes('6. `goodwill`') && (['relationship', 'goodwill'] as string[]).every((r) => (REVIEW_VETO_RULES as readonly string[]).includes(r)))
  const rel = JSON.parse(read('scripts/fixtures-v9/relationship-test.json')).cases as any[]
  for (const mode of ['off', 'on'] as const) {
    for (const c of rel) {
      const reply = { ...clone(c.model_reply) }
      if (c.kind === 'misfit') {
        const r = await run({ mode, story: c.story, context: c.context, palette: reply, lex: reply, vetoes: { [c.rejected]: true }, rule: 'relationship' })
        const card = r.candidates.find((x) => x.kanji === c.rejected)
        check(`(4/7) misfit ${c.name} (${mode}): ${c.rejected} never reaches the sender${c.promoted ? `; ${c.promoted} is promoted` : ''}`, !live(r).some((x) => x.kanji === c.rejected) && (c.promoted ? r.primary_kanji === c.promoted : r.status === 'sufficient') && Boolean(card?.eliminated || !card), JSON.stringify(r.candidates.map((x) => [x.slot, x.kanji, x.eliminated_reason])))
        if (mode === 'on' && c.code_rejects_in_on) check(`(4/7) …${c.name}: in lexicon mode the CODE rejects it before the review (恩 going downward is not on the list)`, card?.eliminated_reason === 'palette: not_in_lexicon', String(card?.eliminated_reason))
        else check(`(4/7) …${c.name} (${mode}): removed by the review under the rule \`relationship\``, card?.eliminated_reason?.startsWith('review: relationship') === true, String(card?.eliminated_reason))
      } else {
        const r = await run({ mode, story: c.story, context: c.context, palette: reply, lex: reply })
        check(`(4/7) fit ${c.name} (${mode}): the same character ${c.kept} is kept in a fitting relationship`, live(r).some((x) => x.kanji === c.kept), JSON.stringify(r.candidates.map((x) => [x.slot, x.kanji, x.eliminated_reason])))
      }
    }
  }

  // step 5/6: all cards are different characters
  const dup = reply(cand('main', '待', 'まつ', A1), cand('second', '待', 'まつ', A2), cand('freestyle', '詰', 'つめる', A2))
  const rd = await run({ mode: 'on', lex: dup })
  check('(6) all cards are different characters: a second card that repeats the main is removed (slots: same character as another card)', rd.candidates.filter((c) => !c.eliminated).map((c) => c.kanji).join() === '待,詰' && rd.candidates.some((c) => c.slot === 'second' && c.eliminated_reason === 'slots: same character as another card'), JSON.stringify(rd.candidates.map((c) => [c.slot, c.kanji, c.eliminated_reason])))
  const fdup = reply(cand('main', '待', 'まつ', A1), cand('second', '守', 'まもる', A2), cand('freestyle', '守', 'まもる', A2))
  const rfd = await run({ mode: 'on', lex: fdup })
  check('(5) the playful card never repeats the main or the second: dropped by the referee; the prompt says so and allows "no playful card"', rfd.freestyle_kanji === null && live(rfd).map((c) => c.kanji).join() === '待,守' && lp.includes('It must NOT repeat the main or the second') && lp.includes('give no freestyle at all'))

  // step 11: logs
  const safety = logSafetyRemovals(rd, (l) => lines11.push(l))
  check('(11) safety removals are logged with the reason: [ichirei-safety] removed {slot, kanji, by, rule, reason} — codes only', safety !== null && lines11.length === 1 && lines11[0].startsWith('[ichirei-safety] removed ') && JSON.parse(lines11[0].slice('[ichirei-safety] removed '.length)).removed[0].by === 'slots')
  await run({ mode: 'off', vetoes: { 備: true }, rule: 'dignity' })
  const rem = logs.filter((l) => l.startsWith('[ichirei-safety] removed '))
  check('(11) …a review veto is logged with its rule (by review, rule dignity)', rem.length === 1 && JSON.parse(rem[0].slice('[ichirei-safety] removed '.length)).removed.some((x: any) => x.by === 'review' && x.rule === 'dignity' && x.kanji === '備'), rem.join('|'))
  await run({ mode: 'off' })
  check('(11) …and a clean run logs no removal line', logs.filter((l) => l.startsWith('[ichirei-safety] removed ')).length === 0)
}

// ---- 8e. step 9: the card, the carved form, the carving check ---------------------------------------------------------------------------------
{
  const reveal = read('src/demo/Reveal.tsx')
  check('(9) the card shows "how it matches" as three short lines — who they are (the gaze), your moment (the exact words from the story), the feeling (the emotional register) — in all four languages', ['data-match-who', 'data-match-moment', 'data-match-feeling', 'copy.match.who', 'copy.match.moment', 'copy.match.feeling'].every((n) => reveal.includes(n)) && (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => COPY[l].match.who.length > 0 && COPY[l].match.moment.length > 0 && COPY[l].match.feeling.length > 0))
  check('(9) the main card may carry the single word 深く響く (and its zh / en equivalents)', reveal.includes('data-resonates') && COPY.ja.match.resonates === '深く響く' && COPY['zh-Hant'].match.resonates.length > 0 && COPY.en.match.resonates === 'Resonates deeply')
  check('(9) the feeling words are shown in the page language (grateful → 感謝 / 感谢 / 感謝 / Grateful)', COPY.ja.match.registers.grateful === '感謝' && COPY['zh-Hans'].match.registers.grateful === '感谢' && COPY['zh-Hant'].match.registers.grateful === '感謝' && COPY.en.match.registers.grateful === 'Grateful')
  const scoreWords = /\d\s*%|％|percent|score|スコア|パーセント|マッチ率|一致度|相合度|匹配度|分數|分数/i
  const cardCopy = [reveal, ...(['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).map((l) => JSON.stringify(COPY[l].match) + COPY[l].slotLabels.main + COPY[l].revealIntro)].join('\n')
  check('(9) no percentages or scores anywhere on the card (the Reveal component and its copy)', !scoreWords.test(cardCopy), cardCopy.match(scoreWords)?.[0])
  const prompts = ['engine/prompt.ja.md', 'engine/prompt.zh.md', 'engine/prompt.en.md', 'engine/lexicon-prompt.md'].map(read).join('\n')
  check('(9) …and the model is never asked for one: no "score" / "percent" / "match rate" field in the selection prompts or their output contracts', !/"?(score|percent|percentage|match_rate|confidence_pct)"?\s*:/i.test(prompts))

  // the carved form
  const lamp = { kanji: '灯', inscription_form: '燈' }
  check('(9) Japanese buyers: the carved glyph is the modern form 新字体 (温 静 灯), never the old form — on the card, in the order and for en buyers too', carvedGlyph(lamp, 'ja', null) === '灯' && carvedGlyph({ kanji: '温', inscription_form: '溫' }, 'ja', null) === '温' && carvedGlyph({ kanji: '静', inscription_form: '靜' }, 'en', null) === '静' && glyphFor(lamp, normalizeStyle('ja', 'kyujitai') as never) === '灯' && DEFAULT_STYLE.ja === 'modern' && STYLES_BY_LANGUAGE.ja.length === 1 && !hasFormChoice('ja', lamp))
  check('(9) Chinese buyers: traditional by default (燈), simplified when chosen (灯)', carvedGlyph(lamp, 'zh-Hant', 'traditional') === '燈' && carvedGlyph(lamp, 'zh-Hans', 'simplified') === '灯' && hasFormChoice('zh-Hant', lamp))

  // the stroke check
  check('(9) stroke data: 温 12, 溫 14, 護 20, 響 20, 譲 20, 讓 24, 驗 23 (KANJIDIC2 via engine/strokes.csv)', strokesOf('温') === 12 && strokesOf('溫') === 14 && strokesOf('護') === 20 && strokesOf('響') === 20 && strokesOf('譲') === 20 && strokesOf('讓') === 24 && strokesOf('驗') === 23)
  check('(9) a simplified glyph KANJIDIC does not hold (让 欢) takes the traditional count but never more than the cap 20 — so it is never wrongly refused at the default limit; an unknown character is unknown (Standard only)', strokesOf('让', '讓') === 20 && strokesOf('欢', '歡') === 20 && strokesOf('𰻞') === null && simpleMaxStrokes({}) === 20 && simpleMaxStrokes({ ICHIREI_SIMPLE_MAX_STROKES: '18' }) === 18 && simpleMaxStrokes({ ICHIREI_SIMPLE_MAX_STROKES: 'x' }) === 20)
  check('(9) simpleAvailable: at most the limit; an unknown count is not allowed on Simple', simpleAvailable(20, 20) && !simpleAvailable(21, 20) && !simpleAvailable(null, 20) && simpleAvailable(12))
  const attached = attachStrokes(await run({ mode: 'off' }))
  check('(9) the engine attaches stroke counts to every live card and the limit to the result', attached.simple_max_strokes === 20 && live(attached).every((c) => typeof c.strokes?.kanji === 'number'))
  const zhResult = (kanji: string, trad: string) => ({ ...clone(attached), language: 'zh-Hant', status: 'sufficient', candidates: [{ ...clone(live(attached)[0]), kanji, inscription_form: trad, reading: 'ràng' }], primary_kanji: kanji }) as unknown as EngineResult
  const order = (language: string, result: EngineResult, kanji: string, style: string, pkg: string) => ({ story: STORY, engine_result: result, selected_kanji: kanji, language, sender_name: 'A', receiver_name: 'B', delivery_date: '2027-01-01', inscription_style: style, package: pkg })
  const tooMany = parseOrderRequest(order('zh-Hant', zhResult('読', '讀'), '読', 'traditional', 'simple'), new Date('2026-10-28'), palette)
  check('(9) the SERVER refuses the Simple set for a character above the limit (讀 traditional = 22 strokes) and names the field', !tooMany.ok && tooMany.field === 'package' && /Standard/.test(tooMany.error), JSON.stringify(tooMany).slice(0, 200))
  const std = parseOrderRequest(order('zh-Hant', zhResult('読', '讀'), '読', 'traditional', 'standard'), new Date('2026-10-28'), palette)
  const simp = parseOrderRequest(order('zh-Hant', zhResult('读', '讀'), '读', 'simplified', 'simple'), new Date('2026-10-28'), palette)
  check('(9) …the Standard set is always possible, and the simplified glyph (读, 10 strokes) fits the Simple set at the default limit', std.ok && simp.ok, JSON.stringify([std, simp]).slice(0, 300))
  process.env.ICHIREI_SIMPLE_MAX_STROKES = '10'
  const main = live(attached)[0]
  const lowLimit = parseOrderRequest(order('ja', clone(attached), main.kanji, 'modern', 'simple'), new Date('2026-10-28'), palette)
  delete process.env.ICHIREI_SIMPLE_MAX_STROKES
  const mainStrokes = strokesOf(main.kanji, main.inscription_form)!
  check(`(9) ICHIREI_SIMPLE_MAX_STROKES moves the limit (10: ${main.kanji} has ${mainStrokes} strokes → ${mainStrokes > 10 ? 'Standard only' : 'still Simple'})`, mainStrokes > 10 ? !lowLimit.ok : lowLimit.ok)
  const orderForm = read('src/demo/OrderForm.tsx')
  check('(9) the order form disables the Simple set with a note when the carved character is above the limit (the server re-checks)', orderForm.includes('data-simple-unavailable') && orderForm.includes('simpleUnavailable') && (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => COPY[l].order.simpleUnavailable(20).includes('20')))
  const unknown = palette.rows.filter((r) => r.language === 'zh' && strokesOf(r.kanji, r.inscription_form) === null).map((r) => r.kanji)
  check('(9) engine/strokes.csv covers every Chinese form in the palette (the simplified ones through the cap rule)', unknown.length === 0, unknown.join(''))
}

// ---- 8f. v9.2 readability: a Japanese buyer's MAIN must be a 常用漢字 (恕, 馨 … may be the second or the freestyle only) ---------------------------------------
{
  const joyoText = read('engine/joyo.txt').replace(/\s+/g, '')
  check('(R) the 常用漢字 list is the official 2,136 characters (and 恕 馨 毅 綴 撫 are not in it; 蔵 and 守 are)', [...joyoText].length === 2136 && new Set([...joyoText]).size === 2136 && ['恕', '馨', '毅', '綴', '撫', '藏'].every((c) => !isJoyo(c)) && ['蔵', '守', '待', '証'].every((c) => isJoyo(c)))
  const jaSet = eligibleFor(lexicon, palette, gift('ja', 'parent_mother', 'up', 'parent_day'))
  const zhSet = eligibleFor(lexicon, palette, gift('zh-Hant', 'parent_mother', 'up', 'parent_day'))
  const jaText = renderEligible(jaSet, 'parent_mother', 'ja')
  const lineOf = (text: string, k: string) => text.split('\n').find((l) => l.startsWith(k)) ?? ''
  check('(R) the Japanese list marks every non-常用 character "second or freestyle only" (恕 is marked, 待 is not)', jaSet.chars.some((c) => c.kanji === '恕') && lineOf(jaText, '恕').includes('NOT 常用漢字') && !lineOf(jaText, '待').includes('NOT 常用漢字') && jaSet.chars.filter((c) => !isJoyo(c.kanji)).every((c) => lineOf(jaText, c.kanji).includes('NOT 常用漢字')))
  check('(R) …and the Chinese and English lists carry no such mark (no change for Chinese buyers)', !renderEligible(zhSet, 'parent_mother', 'zh-Hant').includes('NOT 常用漢字') && !renderEligible(zhSet, 'parent_mother', 'en').includes('NOT 常用漢字') && !renderEligible(zhSet, 'parent_mother').includes('NOT 常用漢字'))
  check('(R) the prompts say it: lexicon rule 10 (Japanese buyers: the main is a 常用漢字; non-常用 is second or freestyle only; zh/en unchanged) and gate 8 of prompt.ja.md', lp.includes('10. Readability') && lp.includes('常用漢字') && lp.includes('never the main') && read('engine/prompt.ja.md').includes('8. Readability (main slots only') && read('engine/replace-prompt.md').includes('gate 8, readability'))
  const r1 = await run({ mode: 'on', lex: reply(cand('main', '恕', 'ゆるす', A1), cand('second', '守', 'まもる', A2), cand('freestyle', '詰', 'つめる', A2)) })
  check('(R) a Japanese buyer: a non-常用 main (恕) is refused as the main — the readable second (守) is promoted, 恕 may stay as the second', r1.status === 'sufficient' && r1.primary_kanji === '守' && r1.referee!.actions.some((a) => a.action === 'primary_refused_not_readable' && a.kanji === '恕') && count('replace') === 0, JSON.stringify([r1.primary_kanji, r1.candidates.map((c) => [c.slot, c.kanji, c.eliminated]), r1.referee!.actions.map((a) => a.action)]))
  check('(R) …and the cards are still at most three, all different characters', live(r1).length <= 3 && new Set(live(r1).map((c) => c.kanji)).size === live(r1).length)
  const r2 = await run({ mode: 'on', lex: reply(cand('main', '待', 'まつ', A1), cand('second', '恕', 'ゆるす', A2), cand('freestyle', '詰', 'つめる', A2)) })
  check('(R) a non-常用 character as the SECOND is fine (待 main, 恕 second)', r2.status === 'sufficient' && slotKanji(r2, 'main') === '待' && slotKanji(r2, 'second') === '恕' && count('replace') === 0)
  const r3 = await run({ mode: 'on', lex: reply(cand('main', '恕', 'ゆるす', A1), cand('second', '馨', 'かおる', A2)), replacements: [cand('second', '待', 'まつ', A1)] })
  check('(R) both main candidates non-常用: ONE replacement is asked for and it becomes the MAIN (待); a leftover non-常用 character stays as the second', r3.status === 'sufficient' && r3.primary_kanji === '待' && slotKanji(r3, 'main') === '待' && count('replace') === 1 && live(r3).filter((c) => c.slot === 'main').length === 1 && live(r3).filter((c) => c.slot === 'second').length <= 1 && live(r3).length <= 3, JSON.stringify([r3.primary_kanji, r3.candidates.map((c) => [c.slot, c.kanji, c.eliminated, c.eliminated_reason]), r3.referee!.actions.map((a) => a.action)]))
  const r4 = await run({ mode: 'on', lex: reply(cand('main', '恕', 'ゆるす', A1), cand('second', '馨', 'かおる', A2)), replacements: [cand('second', '怡', 'よろこぶ', A1)] })
  check('(R) a replacement that would become the main must be readable too: a non-常用 one (怡) is refused, the sender is not shown an unreadable main', r4.primary_kanji !== '怡' && (r4.primary_kanji === null || isJoyo(r4.primary_kanji)), JSON.stringify([r4.status, r4.primary_kanji]))
  const r5 = await run({ mode: 'off', palette: reply(cand('main', '毅', 'つよい', A1), cand('second', '支', 'ささえる', A2)) })
  check('(R) the palette engine (lexicon off) obeys the same rule: 毅 is not a main for a Japanese buyer, the readable second (支) is', r5.primary_kanji === '支', JSON.stringify([r5.primary_kanji]))
  check('(R) the main-count log line says whether the main is a broad virtue and whether it is 常用 (codes only)', (() => { resetMainTally(); const out: string[] = []; const rr = logMainCharacter({ ...r2, primary_kanji: '恕' } as EngineResult, new Date(), (l) => out.push(l)); const rr2 = logMainCharacter({ ...r2, primary_kanji: '待' } as EngineResult, new Date(), (l) => out.push(l)); return rr?.broad_virtue === true && rr?.joyo === false && rr2?.broad_virtue === false && rr2?.joyo === true && BROAD_VIRTUES.join('') === '恕誠和敬' })())
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
