// Poem add-on tests (ICHIREI_Poem_AddOn_Ticket.md; spec v9.1 step 10): the four form checkers, the chosen character, the palette's blocks and the
// occasion rules for poems, regeneration, the safety review, /api/poem (first-line preview, rate limit, hidden types), the order (max 2, separate
// line items, attributes, the certificate, no poem text from the browser), analytics (no text) and the page. A FAKE model: no key, no network.
// Fixtures: scripts/fixtures-v9/poems.json — all four types on stories 0020 and 0004 (memorial). Whether the REAL model passes the form checks
// is for the owner's live test.
//
//   node --experimental-strip-types scripts/test-poem.ts

import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CI_PATTERNS, blockedCharacters, checkContainsCharacter, checkCraft, checkForm, checkPalette, moraCount } from '../engine/poem-check.ts'
import { buyerAids, generatePoem, loadPoemPrompt, loadPoemReviewPrompt, poemFamilies, reasonCode, type PoemInput } from '../engine/poem.ts'
import { createPoemHandler, TYPES_GET } from '../api/poem.ts'
import { createOrderHandler } from '../api/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadPalette } from '../engine/palette.ts'
import { checkRhyme, lineRhyme } from '../engine/rhyme.ts'
import { availablePoemTypes, loadShopifyConfig, poemPreviewOn, poemTypesAccepted, poemVariantsFromEnv } from '../engine/shopify.ts'
import { MAX_POEMS, POEM_PRICE_JPY, POEM_TYPES, formatYen, type PoemType } from '../src/order/packages.ts'
import { COPY } from '../src/demo/i18n.ts'
// @ts-expect-error untyped test helper
import { startServer } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const palette = loadPalette()
const fx = JSON.parse(read('scripts/fixtures-v9/poems.json')) as { cases: { name: string; story: string; context: any; kanji: string; gaze: string; poems: Record<PoemType, any> }[] }
const [C20, C04] = fx.cases

// ---- 1. the four form checkers --------------------------------------------------------------------------------------------------------------
check('(1) mora counting: every kana is one; ゃゅょ join the kana before; ッ ー ん count; katakana = hiragana', moraCount('じゅんびをする') === 6 && moraCount('きっと') === 3 && moraCount('ファイル') === 3 && moraCount('ラーメン') === 4 && moraCount('あさごとに') === 5 && moraCount('  あ、い。') === 2)
const tanka = (lines: string[], kana: string[]) => ({ type: 'tanka' as const, lines, reading_kana: kana })
const okTanka = tanka(C20.poems.tanka.lines, C20.poems.tanka.reading_kana)
check('(1) tanka: 5-7-5-7-7 morae from the kana reading — valid', checkForm(okTanka).length === 0, checkForm(okTanka).join('; '))
check('(1) tanka: a wrong mora count, a wrong line count, a missing reading, a non-kana reading are all form errors', checkForm(tanka(C20.poems.tanka.lines, ['あさごとに', 'ふたのはなそえそえ', 'そなえたる', 'ははのせなかを', 'いまもおもえる'])).some((p) => p.includes('line 2 has 9 morae')) && checkForm(tanka(C20.poems.tanka.lines.slice(0, 4), C20.poems.tanka.reading_kana.slice(0, 4))).some((p) => p.includes('5 lines')) && checkForm({ type: 'tanka', lines: C20.poems.tanka.lines }).some((p) => p.includes('kana reading')) && checkForm(tanka(C20.poems.tanka.lines, ['朝ごとに', 'ふたのはなそえ', 'そなえたる', 'ははのせなかを', 'いまもおもえる'])).some((p) => p.includes('not kana only')))
const tang = (lines: string[]) => ({ type: 'tang' as const, lines })
check('(1) tang: 4 lines, all 5 or all 7 characters — valid (5 and 7)', checkForm(tang(C20.poems.tang.lines), palette).length === 0 && checkForm(tang(['晨起折得庭前花', '盒中春色輕如雲', '廿載備辦朝夕飯', '不言我今始知恩'])).length === 0)
check('(1) tang: 3 lines, mixed 5/7, 6 characters are form errors', checkForm(tang(['一二三四五', '一二三四五', '一二三四五'])).some((p) => p.includes('4 lines')) && checkForm(tang(['一二三四五', '一二三四五', '一二三四五六七', '一二三四五'])).some((p) => p.includes('5 characters or all 7')) && checkForm(tang(['一二三四五六', '一二三四五六', '一二三四五六', '一二三四五六'])).some((p) => p.includes('5 characters or all 7')))
check('(1) tang / ci: written in traditional characters — simplified forms (飞 间 爱) are a form error', checkForm(tang(['晨起折庭花', '盒中春色轻', '廿載備朝飯', '爱我始知間']), palette).some((p) => p.includes('simplified')) && !checkForm(tang(C20.poems.tang.lines), palette).some((p) => p.includes('simplified')))
const ci = (pattern: string, lines: string[]) => ({ type: 'ci' as const, pattern, lines })
check('(1) ci: three patterns only, line lengths checked — 憶江南 3-5-7-7-5, 如夢令 6-6-5-6-2-2-6, 長相思 3-3-7-5 ×2', Object.keys(CI_PATTERNS).join() === '憶江南,如夢令,長相思' && checkForm(ci('憶江南', C20.poems.ci.lines), palette).length === 0 && checkForm(ci('如夢令', C04.poems.ci.lines), palette).length === 0 && checkForm(ci('長相思', ['一二三', '一二三', '一二三四五六七', '一二三四五', '一二三', '一二三', '一二三四五六七', '一二三四五'])).length === 0)
check('(1) ci: an unknown pattern, the wrong lengths for the chosen pattern, and a missing pattern are form errors', checkForm(ci('水調歌頭', C20.poems.ci.lines)).some((p) => p.includes('pattern')) && checkForm(ci('如夢令', C20.poems.ci.lines)).some((p) => p.includes('如夢令 needs line lengths 6-6-5-6-2-2-6')) && checkForm({ type: 'ci', lines: C20.poems.ci.lines }).some((p) => p.includes('pattern')))
const en = (lines: string[]) => ({ type: 'en' as const, lines })
check('(1) en: 4–6 short lines — valid', checkForm(en(C20.poems.en.lines)).length === 0 && checkForm(en(['a', 'b', 'c', 'd', 'e', 'f'])).length === 0)
check('(1) en: 3 lines, 7 lines, or a line of more than 12 words are form errors', checkForm(en(['a', 'b', 'c'])).some((p) => p.includes('4–6')) && checkForm(en(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).some((p) => p.includes('4–6')) && checkForm(en(['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen', 'b', 'c', 'd'])).some((p) => p.includes('not short')) && checkForm(en(['one two three four five six seven eight nine ten eleven twelve thirteen', 'b', 'c', 'd'])).length === 0)
check('(1) an empty line is a form error for every type', POEM_TYPES.every((t) => checkForm({ type: t, lines: ['', 'x', 'y', 'z'], reading_kana: ['a', 'b', 'c', 'd'] }).some((p) => p.includes('empty'))))
check('(1) the chosen character must appear (its other form counts); if missing it fails like a form error', checkContainsCharacter(en(C20.poems.en.lines), ['備']) === null && checkContainsCharacter(en(C20.poems.en.lines), ['温', '溫']) !== null && checkContainsCharacter(tang(['晨起折庭花', '盒中春色輕', '溫載備朝飯', '不言我始知']), ['温', '溫']) === null)

// ---- 2. the palette's blocks and the occasion rules for poems --------------------------------------------------------------------------------
const bad = (type: PoemType, lines: string[], occasion: any, families: ('ja' | 'zh')[]) => checkPalette({ type, lines }, palette, occasion, families)
check('(2) level 1: a hard-block character (死 病 無) anywhere in the poem fails, for every occasion', bad('tang', ['晨起折庭花', '盒中春色死', '廿載備朝飯', '不言我始知'], 'parent_day', ['zh']).some((p) => p.includes('死')) && bad('tanka', ['無きものを', 'a', 'b', 'c', 'd'], null, ['ja']).some((p) => p.includes('無')))
check('(2) level 3, kanreki / milestone: 冬 夕 影 菊 渡 are blocked for birthday_milestone (rebirth, never decline) — and fine on another occasion', bad('tang', ['晨起折庭冬', '盒中春色華', '廿載備朝飯', '不言惟在家'], 'birthday_milestone', ['zh']).some((p) => p.includes('冬')) && !bad('tang', ['晨起折庭冬', '盒中春色華', '廿載備朝飯', '不言惟在家'], 'parent_day', ['zh']).some((p) => p.includes('冬')))
check('(2) level 3, wedding: 帰 秋 続 継 耐 are blocked; English goodbye / farewell / parting too', bad('tanka', ['帰る日は', 'a', 'b', 'c', 'd'], 'wedding', ['ja']).some((p) => p.includes('帰')) && bad('en', ['Goodbye is not the word', 'b', 'c', 'd'], 'wedding', []).some((p) => p.includes('Goodbye')))
check('(2) remembrance: the celebration / new-beginning characters (祝 寿 喜 初 新 婚) are blocked in every script; English death / grave / heaven / loss words too — the remembering voice has none of them', ['祝', '寿', '喜', '初', '新', '婚'].every((k) => bad('tang', ['晨起折庭花', `盒中春色${k}`, '廿載備朝飯', '不言我始知'], 'memorial', ['zh']).length > 0) && bad('en', ['She died last spring.', 'b', 'c', 'd'], 'memorial', []).length > 0 && bad('en', ['Her grave is quiet.', 'b', 'c', 'd'], 'memorial', []).length > 0 && bad('en', ['In heaven now.', 'b', 'c', 'd'], 'memorial', []).length > 0)
check('(2) kanreki English: old age / decline / twilight are refused (the prompt asks for rebirth)', bad('en', ['In your old age, still kind.', 'b', 'c', 'd'], 'birthday_milestone', []).length > 0 && bad('en', ['A fresh start at sixty.', 'b', 'c', 'd'], 'birthday_milestone', []).length === 0)
check('(2) the chosen character itself is exempt (it was judged when the card was offered)', checkPalette({ type: 'tang', lines: ['晨起折庭花', '盒中春色冬', '廿載備朝飯', '不言我始知'] }, palette, 'birthday_milestone', ['zh'], ['冬']).length === 0)
check('(2) the prompt is given the blocked characters for THIS gift (memorial → 祝 and 喜 among them; milestone → 冬; no list for an English poem)', (() => { const m = blockedCharacters(palette, 'memorial', ['zh']); const b = blockedCharacters(palette, 'birthday_milestone', ['zh']); return m.includes('祝') && m.includes('喜') && b.includes('冬') && !b.includes('祝') && poemFamilies('en', 'ja').length === 0 && poemFamilies('tanka', 'en').join() === 'ja' && poemFamilies('tang', 'ja').join() === 'zh,ja' && poemFamilies('ci', 'zh-Hant').join() === 'zh' })())
check('(2) every fixture poem passes every code check (form, character, palette) — memorial and parent_day', fx.cases.every((c) => POEM_TYPES.every((t) => { const p = c.poems[t]; const d = { type: t, lines: p.lines, reading_kana: p.reading_kana, pattern: p.pattern } as any; return checkForm(d, palette).length === 0 && checkContainsCharacter(d, [c.kanji]) === null && checkPalette(d, palette, c.context.occasion, poemFamilies(t, c.context.language), [c.kanji]).length === 0 })))
for (const t of POEM_TYPES) {
  const text = read(`engine/poem.${t}.md`)
  check(`(2) engine/poem.${t}.md carries the content rules: 詩眼 at the turning point, built from the story, the sender's view, occasion register (kanreki rebirth, remembrance voice, wedding taboos), the relationship test, the illness rule, goodwill, honesty (no famous line, no poet)`, ['詩眼', 'turning point', 'Build the poem from the story', "sender's honest view", 'rebirth', 'remembering voice', 'Wedding', 'RELATIONSHIP TEST', 'ILLNESS RULE', 'GOODWILL', 'Do not quote or imitate', '{{ AVOID_CHARACTERS }}'].every((n) => text.includes(n)), t)
}
check('(2) reading aids by buyer language (ticket rule 6): ja buyer → 書き下し文 for tang / ci; en buyer → English rendering; non-ja buyer of a tanka → romaji + English; zh buyer none', buyerAids('tang', 'ja').includes('kakikudashi') && buyerAids('ci', 'en').includes('english') && buyerAids('tanka', 'en').includes('romaji') && buyerAids('tanka', 'zh-Hant').includes('romaji') && buyerAids('tang', 'zh-Hans').includes('null') && buyerAids('tanka', 'ja').includes('null'))

// ---- fake upstream: poem generation and poem review ---------------------------------------------------------------------------------------
const seen: { kind: 'poem' | 'review'; prompt: string }[] = []
let replies: unknown[] = []
let reviewReplies: unknown[] = []
let hang = false
const hung: http.ServerResponse[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const prompt = String(body.messages[0].content)
  const kind = prompt.includes('Poem Review Prompt') ? 'review' : 'poem'
  seen.push({ kind, prompt })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  if (hang && kind === 'poem') {
    hung.push(res)
    return
  }
  const reply = kind === 'poem' ? (replies.length > 1 ? replies.shift() : replies[0]) : reviewReplies.length > 1 ? reviewReplies.shift() : (reviewReplies[0] ?? { pass: true, rule: null, reason: 'ok' })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: typeof reply === 'string' ? reply : JSON.stringify(reply) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
for (const k of ['ICHIREI_REVIEW', 'ICHIREI_POEM_TIMEOUT_MS']) delete process.env[k]

const logs: string[] = []
const origLog = console.log
const quiet = async <T,>(f: () => Promise<T>): Promise<T> => {
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-')) logs.push(l); else origLog(...a) }
  try { return await f() } finally { console.log = origLog }
}
const input = (c: typeof C20, type: PoemType): PoemInput => ({ story: c.story, language: c.context.language, relationship: c.context.relationship, direction: c.context.direction, occasion: c.context.occasion, occasion_detail: null, kanji: c.kanji, inscription_form: null, gaze: c.gaze, type })
const gen = async (c: typeof C20, type: PoemType, reps: unknown[], rev: unknown[] = [], language?: string) => {
  replies = reps
  reviewReplies = rev
  seen.length = 0
  logs.length = 0
  return quiet(() => generatePoem({ ...input(c, type), ...(language ? { language: language as never } : {}) }, palette))
}
const noText = () => !logs.some((l) => [C20, C04].some((c) => c.story.split(/[。、\n]/).filter((p) => p.length >= 8).some((p) => l.includes(p))) || l.includes('朝ごとに') || l.includes('幾十の'))

// ---- 3. generation: all four types on both stories (plumbing) ---------------------------------------------------------------------------------
for (const c of fx.cases) {
  for (const t of POEM_TYPES) {
    const r = await gen(c, t, [c.poems[t]])
    check(`(3) ${c.name} / ${t}: a valid poem passes the code checks and the review → ok, ${c.poems[t].lines.length} lines, the character present`, r.ok && r.poem.lines.join() === c.poems[t].lines.join() && r.poem.type === t && count('poem') === 1 && count('review') === 1, JSON.stringify(r).slice(0, 300))
    if (r.ok && t === 'ci') check(`(3) ${c.name} / ci: the pattern is kept`, r.poem.pattern === c.poems.ci.pattern)
  }
}
function count(k: 'poem' | 'review') { return seen.filter((s) => s.kind === k).length }
{
  const r = await gen(C20, 'tang', [C20.poems.tang])
  check('(3) reading aids by buyer: a Japanese buyer of a tang gets the 書き下し文 (stored as the reading text); an English buyer gets the English rendering instead', r.ok && r.poem.aids.kakikudashi?.length === 4 && r.poem.reading.includes('晨に起きて') && r.poem.aids.english === null)
  const withEn = { ...C20.poems.tang, english: 'At dawn I pick a flower.' }
  const rEn = await gen(C20, 'tang', [withEn], [], 'en')
  check('(3) …English buyer: the English rendering is kept, the kakikudashi dropped', rEn.ok && rEn.poem.aids.english === 'At dawn I pick a flower.' && rEn.poem.aids.kakikudashi === null && rEn.poem.reading === 'At dawn I pick a flower.')
  const tk = await gen(C20, 'tanka', [{ ...C20.poems.tanka, romaji: ['asagoto ni', 'futa no hana soe', 'sonaetaru', 'haha no senaka o', 'ima mo omoeru'], english: 'Each morning, a flower on the lid.' }], [], 'en')
  check('(3) …a non-Japanese buyer of a tanka gets romaji + English; the Japanese buyer gets none', tk.ok && tk.poem.aids.romaji?.length === 5 && tk.poem.reading.includes('asagoto ni') && tk.poem.reading.includes('Each morning') && (await gen(C20, 'tanka', [C20.poems.tanka])).ok === true)
}
{
  const prompt = (await gen(C04, 'tang', [C04.poems.tang]), seen[0].prompt)
  check('(3) the prompt the model gets: the context, the character and its forms, the story, the blocked characters for a MEMORIAL gift (祝 喜 …), the aids line — and no slot left', prompt.includes('occasion: memorial') && prompt.includes('character: 綴') && prompt.includes('Dozens') === false && prompt.includes('祝') && !/\{\{ [A-Z_]+ \}\}/.test(prompt) && prompt.includes('kakikudashi'))
  check('(3) the safety review prompt gets the poem, the story and the rules; its slots are filled', seen[1].prompt.includes('Poem Review Prompt') && seen[1].prompt.includes('舊箋幾十通') && !/\{\{ [A-Z_]+ \}\}/.test(seen[1].prompt))
}

// ---- 4. failures: regenerate once, then an error for that type only ---------------------------------------------------------------------------
{
  const wrong = { ...C20.poems.tanka, reading_kana: ['あさごとに', 'ふたのはなそえそえ', 'そなえたる', 'ははのせなかを', 'いまもおもえる'] }
  const r = await gen(C20, 'tanka', [wrong, C20.poems.tanka])
  check('(4) a form error → regenerate once with the failed checks fed back → ok on the second try', r.ok && count('poem') === 2 && seen[1].prompt.includes('YOUR PREVIOUS POEM FAILED THESE CHECKS') && seen[1].prompt.includes('line 2 has 9 morae'))
  const r2 = await gen(C20, 'tanka', [wrong])
  check('(4) …fails again → an error for that type only (poem_failed); nothing is thrown; the log lists the failed checks, never the poem or the story', !r2.ok && r2.code === 'poem_failed' && count('poem') === 2 && logs.some((l) => l.includes('"code":"poem_failed"') && l.includes('morae')) && noText())
  const noChar = { lines: ['Every morning, a lid.', 'A flower from the yard.', 'She never asked.', 'I am learning to say it.'] }
  const r3 = await gen(C20, 'en', [noChar, C20.poems.en])
  check('(4) the chosen character missing from the poem is a failure like a form error (then regenerated)', r3.ok && seen[1].prompt.includes('does not appear in the poem'))
  const blockedMem = { ...C04.poems.tang, lines: ['舊箋幾十通', '皆是母手跡', '綴我名而祝', '燈前讀不已'] }
  const r4 = await gen(C04, 'tang', [blockedMem])
  check('(4) memorial: a celebration character (祝) in the poem fails the palette check, twice → error for that type', !r4.ok && r4.code === 'poem_failed' && logs.some((l) => l.includes('blocked in remembrance')))
  const r5 = await gen(C04, 'en', [{ lines: ['She died last spring.', '綴 — to stitch a daughter\'s words —', 'b', 'c'] }])
  check('(4) memorial, English: death words fail the check (no talk of death or loss)', !r5.ok && r5.code === 'poem_failed')
  const kan = { ...C20.poems.tang, lines: ['晨起折庭冬', '盒中春色華', '廿載備朝飯', '不言惟在家'] }
  const r6 = await gen({ ...C20, context: { ...C20.context, occasion: 'birthday_milestone' } }, 'tang', [kan])
  check('(4) kanreki / milestone: 冬 (decline) in the poem fails the palette check; the same poem is fine for parent_day', !r6.ok && (await gen(C20, 'tang', [kan])).ok === true)
  const rv = await gen(C20, 'en', [C20.poems.en], [{ pass: false, rule: 'relationship', reason: 'reads as a debt' }, { pass: true, rule: null, reason: 'ok' }])
  check('(4) the safety review may veto under a named rule (relationship) → regenerate with the reason; the second poem passes', rv.ok && count('poem') === 2 && count('review') === 2 && seen[2].prompt.includes('review (relationship)'))
  const rv2 = await gen(C20, 'en', [C20.poems.en], [{ pass: false, rule: 'illness', reason: 'x' }])
  check('(4) …vetoed twice → an error for that type', !rv2.ok && rv2.code === 'poem_failed')
  const rv3 = await gen(C20, 'en', [C20.poems.en], [{ pass: false, rule: 'taste', reason: 'a bit plain' }])
  check('(4) a "fail" for taste (not a safety rule) is a concern, not a veto', rv3.ok)
  const rv4 = await gen(C20, 'en', [C20.poems.en], ['not json at all'])
  check('(4) an unusable review lets the poem through (the code checks still ran)', rv4.ok)
  const dec = await gen(C20, 'en', [{ declined: true }])
  check('(4) goodwill: {"declined": true} → no poem, code declined', !dec.ok && dec.code === 'declined')
  process.env.ICHIREI_POEM_TIMEOUT_MS = '400'
  hang = true
  const t0 = Date.now()
  const to = await gen(C20, 'en', [C20.poems.en])
  hang = false
  delete process.env.ICHIREI_POEM_TIMEOUT_MS
  check('(4) the hard cap (default 45 s, here 0.4 s): a poem that takes too long ends with poem_timeout, quickly', !to.ok && to.code === 'poem_timeout' && Date.now() - t0 < 5000)
}

// ---- 4b. v9.3: the rhyme of the 漢詩, craft notes, 現代語訳, the English path, the failure reasons ------------------------------------------------
{
  const q = (lines: string[]) => ({ type: 'tang' as const, lines })
  check('(4b) tang rhyme: lines 2 and 4 on the same rhyme pass (光/霜, 家/花, 輕 vs 雲 do not match but 雲/恩 do); line 1 is free', checkRhyme(['床前明月光', '疑是地上霜', '舉頭望明月', '低頭思故鄉']).length === 0 && checkRhyme(['x', '盒中春色華', 'y', '不言惟在家']).length === 0 && checkRhyme(['x', '輕如雲', 'y', '始知恩']).length === 0 && checkRhyme(['a', 'bb霜', 'c', 'dd光']).length === 0)
  check('(4b) tang rhyme: lines 2 and 4 that do not rhyme are a form error naming both characters and their pinyin (輕 qing vs 知 zhi)', (() => { const p = checkForm(q(['晨起折庭花', '盒中春色輕', '廿載備朝飯', '不言我始知'])); return p.length === 1 && p[0].startsWith('lines 2 and 4 must rhyme') && p[0].includes('輕 (qing)') && p[0].includes('知 (zhi)') })())
  check('(4b) rhyme uses the modern rhyme groups (中華新韻): ü and u are different (魚 vs 母), -i after zh/ch/sh/r/z/c/s is its own group (詩 shi vs 地 di), 夜 ye is 三皆 not 二波', checkRhyme(['x', '魚', 'y', '女']).length === 0 && checkRhyme(['x', '魚', 'y', '母']).length === 1 && checkRhyme(['x', '詩', 'y', '思']).length === 0 && checkRhyme(['x', '詩', 'y', '地']).length === 1 && lineRhyme('夜')?.group === '三皆' && lineRhyme('歌')?.group === '二波')
  check('(4b) a polyphonic character takes the reading its line implies (the library is given the whole line)', lineRhyme('樂聲悠揚')?.pinyin === 'yang' && lineRhyme('行路難')?.char === '難')
  check('(4b) a tang that fails only the rhyme is regenerated once with the pinyin of both line ends fed back — then ok', await (async () => { const bad = { ...C20.poems.tang, lines: ['晨起折庭花', '盒中春色輕', '廿載備朝飯', '不言我始知'] }; const r = await gen(C20, 'tang', [bad, C20.poems.tang]); return r.ok && count('poem') === 2 && seen.filter((x) => x.kind === 'poem')[1].prompt.includes('輕 (qing)') && seen.filter((x) => x.kind === 'poem')[1].prompt.includes('must rhyme') })())
  const rr = await gen(C20, 'tang', [{ ...C20.poems.tang, lines: ['晨起折庭花', '盒中春色輕', '廿載備朝飯', '不言我始知'] }])
  check('(4b) …still no rhyme the second time → poem_failed with the reason code `rhyme` (and the words in `problems`), logged without the poem or story', !rr.ok && rr.code === 'poem_failed' && rr.reasons?.join() === 'rhyme' && (rr.problems?.length ?? 0) === 2 && logs.some((l) => l.includes('"reasons":["rhyme"]')) && noText())
  check('(4b) the tang and ci prompts require the rhyme (tang) and classical imagery with no modern words, with the 一聲 / 竹籠 examples', ['MUST end on the same rhyme', 'CLASSICAL IMAGERY ONLY', '一聲', '竹籠', '電話', '弁當'].every((n) => loadPoemPrompt('tang').includes(n)) && ['CLASSICAL IMAGERY ONLY', '一聲', '竹籠', '電話', '弁當'].every((n) => loadPoemPrompt('ci').includes(n)))
  check('(4b) craft notes: a tanka that uses the same kanji twice (母 … 母) is flagged; the chosen character may repeat; a tanka with no repeat is clean', checkCraft({ type: 'tanka', lines: ['母の背に', '朝の光や', '母の声', 'いまも聞こえる', '今ありがとう'] }, ['備']).some((x) => x.includes('母')) && checkCraft({ type: 'tanka', lines: ['備えゆく', '朝の光や', '備えたる', 'いまも聞こえる', 'ありがとう'] }, ['備']).length === 0 && checkCraft({ type: 'tanka', lines: C20.poems.tanka.lines }, ['備']).length === 0)
  check('(4b) craft notes: modern words in a tang / ci (電話, 弁當 …) are flagged; the tanka prompt forbids a repeated word', checkCraft({ type: 'tang', lines: ['一通電話來', 'a', 'b', 'c'] }, []).some((x) => x.includes('電話')) && checkCraft({ type: 'ci', lines: ['弁當'] }, []).some((x) => x.includes('弁當')) && loadPoemPrompt('tanka').includes('never use the same word twice'))
  const rep = { ...C20.poems.tanka, lines: ['母の背で', '備えた朝や', '母の声', 'いまも聞こえる', '今ありがとう'], reading_kana: ['ははのせで', 'そなえたあさや', 'ははのこえ', 'いまもきこえる', 'いまありがとう'] }
  const dv = await gen(C20, 'tanka', [rep, C20.poems.tanka])
  check('(4b) a craft note costs one regeneration, with the note fed back — and the second poem ships', dv.ok && count('poem') === 2 && seen.filter((x) => x.kind === 'poem')[1].prompt.includes('CRAFT PROBLEMS') && dv.poem.lines.join() === C20.poems.tanka.lines.join())
  const dv2 = await gen(C20, 'tanka', [rep])
  check('(4b) …if the second try repeats the word too, it still ships (a craft note never fails a poem)', dv2.ok && count('poem') === 2 && logs.some((l) => l.includes('"craft_notes"')))
  const dv3 = await gen(C20, 'tanka', [rep, { ...C20.poems.tanka, reading_kana: ['あ', 'い', 'う', 'え', 'お'] }])
  check('(4b) …and if the second try fails a HARD check, the first poem (hard checks passed) ships instead of an error', dv3.ok && dv3.poem.lines.join() === rep.lines.join())
  // 現代語訳
  const g = await gen(C20, 'tang', [C20.poems.tang])
  check('(4b) a Japanese buyer of a tang gets 書き下し + 現代語訳: both are kept and both are in the stored reading text (書き下し first)', g.ok && typeof g.poem.aids.gendaigo === 'string' && g.poem.aids.gendaigo.includes('二十年') && g.poem.reading.includes('晨に起きて') && g.poem.reading.indexOf('晨に起きて') < g.poem.reading.indexOf('二十年'))
  const gc = await gen(C20, 'ci', [C20.poems.ci])
  check('(4b) …and of a ci too', gc.ok && typeof gc.poem.aids.gendaigo === 'string' && gc.poem.reading.includes('朝また朝') && gc.poem.reading.includes('弁当箱'))
  const noG = await gen(C20, 'tang', [{ ...C20.poems.tang, gendaigo: undefined }, { ...C20.poems.tang, gendaigo: undefined }])
  check('(4b) a Japanese tang without a 現代語訳 is regenerated once, then fails with the reason `gendaigo`', !noG.ok && noG.reasons?.join() === 'gendaigo' && count('poem') === 2)
  const ge = await gen(C20, 'tang', [{ ...C20.poems.tang, english: 'At dawn I pick a flower.' }], [], 'en')
  const gz = await gen(C20, 'tang', [C20.poems.tang], [], 'zh-Hant')
  check('(4b) English and Chinese buyers get no 現代語訳 (and a Chinese buyer needs none)', ge.ok && ge.poem.aids.gendaigo === null && gz.ok && gz.poem.aids.gendaigo === null && gz.poem.aids.kakikudashi === null && buyerAids('tang', 'ja').includes('現代語訳') && buyerAids('ci', 'ja').includes('gendaigo') && !buyerAids('tang', 'en').includes('gendaigo is'))
  check('(4b) tang / ci prompts ask for `gendaigo` in the output shape', loadPoemPrompt('tang').includes('"gendaigo"') && loadPoemPrompt('ci').includes('"gendaigo"'))
  const gArr = await gen(C20, 'tang', [{ ...C20.poems.tang, gendaigo: ['毎朝早く起きて庭の花を折り、', '二十年、何も言わずに朝のご飯を用意してくれた。'] }])
  check('(4b) a 現代語訳 returned line by line (an array) is joined, not dropped — and the ok log says whether the aids are there (counts only)', gArr.ok && gArr.poem.aids.gendaigo === '毎朝早く起きて庭の花を折り、 二十年、何も言わずに朝のご飯を用意してくれた。' && logs.some((l) => l.includes('"ok":true') && l.includes('"gendaigo":true') && l.includes('"kakikudashi":4')) && noText())
  // the story's time stays as the story has it
  check('(4b) all four poem prompts carry the truth-of-events rule: no event the story does not contain; a later visit stays in the future (the tang / ci prompts name 將 待 擬 期 and forbid 今日 for it)', POEM_TYPES.every((t) => { const x = loadPoemPrompt(t); return x.includes('3b. TRUTH OF EVENTS') && x.includes('Never write an event the story does not contain') && x.includes('stays in the future') }) && ['tang', 'ci'].every((t) => { const x = loadPoemPrompt(t as PoemType); return x.includes('將, 待, 擬, 期') && x.includes('今日') }))
  // the English path
  const enOk = await gen(C20, 'en', [C20.poems.en])
  check('(4b) English poem: a good reply passes (4 lines, 備 present, one poem call + one review call)', enOk.ok && count('poem') === 1 && count('review') === 1)
  const enLong = { lines: ['Every morning a lid, and a small flower from the yard, laid on rice', 'She never asked to be thanked.', '備 — to be ready before anyone asks —', 'twenty years late, I am learning to say it.'] }
  const enSoft = await gen(C20, 'en', [enLong, C20.poems.en])
  check('(4b) English poem: a line of 13–16 words is a craft note (one regeneration, then ships), only more than 16 is a form error', enSoft.ok && count('poem') === 2 && seen.filter((x) => x.kind === 'poem')[1].prompt.includes('CRAFT PROBLEMS'))
  const fenced = '```json\n' + JSON.stringify(C20.poems.en) + '\n```'
  const enFence = await gen(C20, 'en', [fenced])
  const enText = await gen(C20, 'en', [{ poem: C20.poems.en.lines.join('\n') }])
  const enPlain = await gen(C20, 'en', ['Here is your poem: ' + JSON.stringify(C20.poems.en) + ' I hope you like it.'])
  check('(4b) English poem: the reply may come in a code fence, with chatter around it, or as `poem` text with line breaks — all are read', enFence.ok && enText.ok && enPlain.ok)
  const enNoChar = await gen(C20, 'en', [{ lines: ['Every morning, a lid.', 'A flower from the yard.', 'She never asked.', 'I am learning to say it.'] }])
  check('(4b) English poem: the reason `character_missing` is reported when the character is left out (twice), in the log and in `reasons`', !enNoChar.ok && enNoChar.reasons?.join() === 'character_missing' && logs.some((l) => l.includes('"reasons":["character_missing"]')))
  const enBad = await gen(C20, 'en', ['I could not write that.'])
  check('(4b) English poem: an unreadable reply is reported as the reason `parse` (not a silent failure)', !enBad.ok && enBad.reasons?.join() === 'parse' && logs.some((l) => l.includes('"reasons":["parse"]')))
  const enVeto = await gen(C20, 'en', [C20.poems.en], [{ pass: false, rule: 'palette', reason: 'uses a parting word' }])
  check('(4b) English poem: a review veto is reported as `review:palette` with its reason in the problems', !enVeto.ok && enVeto.reasons?.join() === 'review:palette' && (enVeto.problems ?? []).some((p) => p.includes('uses a parting word')))
  check('(4b) the review prompt says the chosen character in the poem is intended (a Chinese character inside an English poem is not a taboo)', loadPoemReviewPrompt().includes('was already judged') && loadPoemReviewPrompt().includes('inside an English poem'))
  check('(4b) the English prompt tells the model to copy the character itself, gives the word limit and the shape', (() => { const t = loadPoemPrompt('en'); return t.includes('AS THE CHARACTER ITSELF') && t.includes('TWELVE words') && t.includes('never translate it away') })())
  check('(4b) failure reasons are short codes: call / parse / form / character_missing / rhyme / palette / review:<rule> / gendaigo', ['call: boom', 'the reply was not a JSON object', 'the reply has no lines array', 'a tanka has 5 lines (got 4)', 'the chosen character (備) does not appear in the poem', 'lines 2 and 4 must rhyme: …', '死: hard block (never used)', '祝: blocked in remembrance (x)', 'review (relationship): x', 'gendaigo is missing: …'].map(reasonCode).join() === 'call,parse,parse,form,character_missing,rhyme,palette,palette,review:relationship,gendaigo')
}

// ---- 5. /api/poem and /api/poem-types ------------------------------------------------------------------------------------------------------
const store = new MemoryOrderStore()
const handler = (types: PoemType[], extra: object = {}) => createPoemHandler(() => ({ store, types, palette, now: () => new Date('2026-10-28T03:00:00Z'), ...extra }))
const body = (c: typeof C20, type: string, more: object = {}) => ({ session: 'abcdefghijklmnop1234', story: c.story, language: c.context.language, relationship: c.context.relationship, direction: c.context.direction, occasion: c.context.occasion, kanji: c.kanji, gaze: c.gaze, type, ...more })
const post = (h: (r: Request) => Promise<Response>, b: unknown) => h(new Request('http://x/api/poem', { method: 'POST', body: JSON.stringify(b) }))
let poemId20 = ''
let poemIdEn = ''
{
  replies = [C20.poems.tanka]
  reviewReplies = []
  const res = await quiet(() => post(handler(['tanka', 'tang', 'ci', 'en']), body(C20, 'tanka')))
  const j = (await res.json()) as any
  poemId20 = j.poem_id
  check('(5) /api/poem: 200 with the poem lines, the reading aids and a preview that is the FIRST LINE only', res.status === 200 && j.lines.length === 5 && j.preview === j.lines[0] && j.preview === '朝ごとに' && j.price_jpy === POEM_PRICE_JPY && typeof j.reading === 'string' && /^PM-20261028-[a-z2-9]{10}$/.test(j.poem_id), JSON.stringify(j).slice(0, 200))
  check('(5) …the poem is stored on the server under poem_id (the order reads it back); the stored record has the character forms', (store.records.get(j.poem_id) as any)?.lines?.length === 5 && (store.records.get(j.poem_id) as any)?.kanji === '備')
  replies = [C20.poems.en]
  const en = await quiet(() => post(handler(['tanka', 'en']), body(C20, 'en')))
  poemIdEn = ((await en.json()) as any).poem_id
  check('(5) the page shows only the preview: PoemAddOn renders `preview`, never the full lines, and says the full poem is printed on the card', (() => { const src = read('src/demo/PoemAddOn.tsx'); return src.includes('st.preview') && !src.includes('.lines') && src.includes('p.printedOnCard') && COPY.ja.order.poem.printedOnCard.includes('カード') && COPY.en.order.poem.printedOnCard.includes('printed on your card') })())
  const hidden = await post(handler(['tanka']), body(C20, 'ci'))
  check('(5) a type with no Shopify variant is not offered: 404 poem_type_unavailable', hidden.status === 404 && ((await hidden.json()) as any).code === 'poem_type_unavailable')
  const results = await Promise.all([
    post(handler(['tanka']), body(C20, 'sonnet')),
    post(handler(['tanka']), { ...body(C20, 'tanka'), story: '' }),
    post(handler(['tanka']), { ...body(C20, 'tanka'), kanji: 'ab' }),
    post(handler(['tanka']), { ...body(C20, 'tanka'), gaze: '' }),
    post(handler(['tanka']), { ...body(C20, 'tanka'), language: 'fr' }),
    post(handler(['tanka']), body(C20, 'tanka', { kanji: '死' })),
    post(handler(['tanka'], { store: null }), body(C20, 'tanka')),
  ])
  check('(5) bad input: unknown type / empty story / not one character / empty gaze / unknown language → 400; a hard-block character (死) → 400 character_not_allowed; no store → 503', results.slice(0, 5).every((r) => r.status === 400) && results[5].status === 400 && ((await results[5].json()) as any).code === 'character_not_allowed' && results[6].status === 503)
  const mem = await post(handler(['tanka']), body(C04, 'tanka', { kanji: '祝' }))
  check('(5) remembrance: a celebration character cannot carry a poem (400 character_not_allowed)', mem.status === 400 && ((await mem.json()) as any).code === 'character_not_allowed')
  replies = [{ ...C20.poems.tanka, reading_kana: ['あ', 'い', 'う', 'え', 'お'] }]
  const failed = await quiet(() => post(handler(['tanka']), body(C20, 'tanka')))
  check('(5) a type that fails its checks twice answers 502 poem_failed for that type only (the page can still order the character and the other poem)', failed.status === 502 && ((await failed.json()) as any).code === 'poem_failed')
  const lines = (store.lines.get('analytics/2026-10-28.jsonl') ?? []).map((l) => JSON.parse(l))
  check('(5) analytics: poem_previewed per preview — session, source and the type only; no story, no poem text', lines.filter((e) => e.event === 'poem_previewed').map((e) => e.poem_type).join() === 'tanka,en' && lines.every((e) => !JSON.stringify(e).includes('朝ごとに')))
}
{
  const t = (await TYPES_GET().json()) as any
  check('(5) /api/poem-types answers with the types on offer (those with a variant), the price and the maximum', Array.isArray(t.types) && t.price_jpy === 1980 && t.max === 2)
  const env = (o: Record<string, string>) => availablePoemTypes(o as NodeJS.ProcessEnv)
  check('(5) a missing variant env var hides that type (not a failure): none → none; two set → those two', env({}).length === 0 && env({ SHOPIFY_VARIANT_POEM_TANKA: '123', SHOPIFY_VARIANT_POEM_EN: ' 456 ' }).join() === 'tanka,en' && poemVariantsFromEnv({ SHOPIFY_VARIANT_POEM_CI: '9' } as never).ci === 'gid://shopify/ProductVariant/9' && env({ SHOPIFY_VARIANT_POEM_TANG: '  ' }).length === 0)
}

// ---- 6. the order: max 2, separate line items, attributes, certificate -------------------------------------------------------------------------
const shopSeen: any[] = []
const fakeShopify = (async (_url: string, init: RequestInit) => {
  shopSeen.push(JSON.parse(String(init.body)))
  return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/1', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })
}) as unknown as typeof fetch
const shop = (poemVariants: Partial<Record<PoemType, string>>) => ({ ...loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN_PUBLIC: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2' } as never).config!, poemVariants })
const orderHandler = (poemVariants: Partial<Record<PoemType, string>>) => createOrderHandler(() => ({ store, shopify: shop(poemVariants), shopifyMissing: [], now: () => new Date('2026-10-28T03:00:00Z'), fetchImpl: fakeShopify, palette }))
const GOLD = JSON.parse(read('scripts/golden-fixture.json'))
const orderBody = (more: object = {}) => ({ story: C20.story, engine_result: { ...clone(GOLD), language: 'ja', candidates: GOLD.candidates.map((c: any, i: number) => (i === 0 ? { ...c, kanji: '備', inscription_form: null, reading: 'そなえる' } : c)), primary_kanji: '備' }, selected_kanji: '備', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 花子', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'standard', session: 'abcdefghijklmnop1234', source: 'customer', ...more })
const VARS = { tanka: 'gid://shopify/ProductVariant/501', tang: 'gid://shopify/ProductVariant/502', ci: 'gid://shopify/ProductVariant/503', en: 'gid://shopify/ProductVariant/504' }
const postOrder = (h: (r: Request) => Promise<Response>, b: unknown) => h(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) }))
{
  shopSeen.length = 0
  const res = await quiet(() => postOrder(orderHandler(VARS), orderBody({ poems: [{ poem_id: poemId20, lines: ['EVIL'] }, { poem_id: poemIdEn }] })))
  const j = (await res.json()) as any
  const lines = shopSeen[0].variables.input.lines
  check('(6) an order with 2 poems: ONE cart with three line items — the package and one separate line item per poem, each on its own variant', res.status === 200 && lines.length === 3 && lines[0].merchandiseId.endsWith('/2') && lines[1].merchandiseId === VARS.tanka && lines[2].merchandiseId === VARS.en, JSON.stringify(j).slice(0, 200))
  const attr = (l: any, k: string) => l.attributes.find((a: any) => a.key === k)?.value
  check('(6) each poem line carries ichirei_poem_type, ichirei_poem_text (the lines, one per row), ichirei_poem_reading and order_ref', attr(lines[1], 'ichirei_poem_type') === 'tanka' && attr(lines[1], 'ichirei_poem_text') === C20.poems.tanka.lines.join('\n') && attr(lines[1], 'ichirei_poem_reading') === '-' && attr(lines[1], 'order_ref') === j.order_ref && attr(lines[2], 'ichirei_poem_type') === 'en' && attr(lines[2], 'ichirei_poem_text') === C20.poems.en.lines.join('\n'))
  check('(6) poem text comes from the server\'s store, never from the browser: the "EVIL" lines sent with the poem_id are ignored', !JSON.stringify(shopSeen[0]).includes('EVIL'))
  check('(6) the certificate object carries poems: [{type, lines, reading}] (response and stored record) and the record lists the price shown', j.certificate.poems.length === 2 && j.certificate.poems[0].type === 'tanka' && j.certificate.poems[0].lines.length === 5 && j.certificate.poems[1].type === 'en' && (store.records.get(j.order_ref) as any).production.certificate.poems.length === 2 && (store.records.get(j.order_ref) as any).production.poems.map((p: any) => p.price_jpy).join() === '1980,1980' && (store.records.get(j.order_ref) as any).production.poems[0].poem_id === poemId20)
  check('(6) the main line is unchanged: the nine attributes and the animation link, no poem keys', lines[0].attributes.map((a: any) => a.key).join() === 'kanji,inscription_form,reading,certificate_meaning_en,sender_name,receiver_name,delivery_date,language,order_ref,ichirei_animation_url')
  const ev = (store.lines.get('analytics/2026-10-28.jsonl') ?? []).map((l) => JSON.parse(l))
  check('(6) analytics: the order is recorded with the poem types; a poem_added event per poem — types only', ev.some((e) => e.event === 'ordered' && e.poem_types?.join() === 'tanka,en') && ev.filter((e) => e.event === 'poem_added').map((e) => e.poem_type).join() === 'tanka,en')
  const none = await quiet(() => postOrder(orderHandler(VARS), orderBody()))
  const jn = (await none.json()) as any
  check('(6) an order with no poem is exactly as before: one line item, certificate.poems = []', none.status === 200 && shopSeen.at(-1).variables.input.lines.length === 1 && jn.certificate.poems.length === 0)
}
{
  const r1 = await postOrder(orderHandler(VARS), orderBody({ poems: [{ poem_id: poemId20 }, { poem_id: poemIdEn }, { poem_id: poemId20 }] }))
  check(`(6) at most ${MAX_POEMS} poems: a third is refused (400 too_many_poems)`, r1.status === 400 && ((await r1.json()) as any).code === 'too_many_poems')
  const r2 = await postOrder(orderHandler(VARS), orderBody({ poems: [{ poem_id: poemId20 }, { poem_id: poemId20 }] }))
  check('(6) the same kind twice is refused (400 duplicate_poem_type)', r2.status === 400 && ((await r2.json()) as any).code === 'duplicate_poem_type')
  const r3 = await postOrder(orderHandler({ en: VARS.en }), orderBody({ poems: [{ poem_id: poemId20 }] }))
  check('(6) a poem whose type has no variant (tanka here) is refused — the order does not go through with it (400 poem_type_unavailable)', r3.status === 400 && ((await r3.json()) as any).code === 'poem_type_unavailable')
  const r4 = await postOrder(orderHandler(VARS), orderBody({ poems: [{ poem_id: 'PM-20261028-zzzzzzzzzz' }] }))
  const r5 = await postOrder(orderHandler(VARS), orderBody({ poems: [{ poem_id: 'nope' }] }))
  const r6 = await postOrder(orderHandler(VARS), orderBody({ poems: 'x' }))
  check('(6) an unknown poem_id (poem_not_found), a malformed one and a non-array are refused (400)', r4.status === 400 && ((await r4.json()) as any).code === 'poem_not_found' && r5.status === 400 && r6.status === 400)
  const r7 = await postOrder(orderHandler(VARS), orderBody({ selected_kanji: '守', poems: [{ poem_id: poemId20 }] }))
  check('(6) a poem belongs to ONE character: ordering it with another character is refused (400 poem_mismatch)', r7.status === 400 && ((await r7.json()) as any).code === 'poem_mismatch')
  const r8 = await postOrder(orderHandler(VARS), orderBody({ language: 'en', engine_result: { ...orderBody().engine_result, language: 'en' }, poems: [{ poem_id: poemId20 }] }))
  check('(6) …nor in another language', r8.status === 400)
}

{
  // @ts-expect-error untyped script
  const { summarizePoems, formatPoems } = await import('./report-choices.mjs')
  const evs = (store.lines.get('analytics/2026-10-28.jsonl') ?? []).map((l) => JSON.parse(l))
  const rows = summarizePoems(evs, { source: 'customer' })
  check('(6) the report counts poem previews and additions per type (sessions, no text) and prints a poem block', rows.some((r: any) => r.type === 'tanka' && r.previewed === 1 && r.added === 1) && rows.some((r: any) => r.type === 'en' && r.previewed === 1 && r.added === 1) && formatPoems(rows).includes('previewed') && formatPoems([]).includes('no poem add-on events'))
}

// ---- 7. the server: rate limit 20 per hour, the page ------------------------------------------------------------------------------------------------
{
  const server = await startServer({ upstreamUrl: process.env.ANTHROPIC_BASE_URL, env: { ICHIREI_POEM_LIMIT: '2/60', ICHIREI_LEXICON_MODE: 'off' } })
  try {
    const types = (await (await fetch(`${server.url}/api/poem-types`)).json()) as any
    check('(7) the server answers /api/poem-types: no variant env → no types (the page hides the poem step); /api/health lists poemTypes', types.types.length === 0 && ((await (await fetch(`${server.url}/api/health`)).json()) as any).poemTypes?.length === 0)
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${server.url}/api/poem`, { method: 'POST', body: JSON.stringify(body(C20, 'tanka')) })).status)
    check('(7) /api/poem is rate limited per IP (here 2/60): the third request is 429 with Retry-After; the first two reach the handler (404: no types on offer)', statuses.join() === '404,404,429', statuses.join())
    const rl = await fetch(`${server.url}/api/poem`, { method: 'POST', body: '{}' })
    check('(7) …429 carries the standard body and header', rl.status === 429 && rl.headers.get('retry-after') !== null && ((await rl.json()) as any).code === 'rate_limited')
  } finally {
    await server.stop()
  }
  const dflt = read('server/app.ts')
  check('(7) the default limit is 20 per hour per IP', dflt.includes("envRunLimiter('ICHIREI_POEM_LIMIT', { max: 20, minutes: 60 })"))
  const withTypes = await startServer({ upstreamUrl: process.env.ANTHROPIC_BASE_URL, env: { SHOPIFY_VARIANT_POEM_TANKA: '501', SHOPIFY_VARIANT_POEM_EN: '504', ICHIREI_LEXICON_MODE: 'off' } })
  try {
    const t = (await (await fetch(`${withTypes.url}/api/poem-types`)).json()) as any
    check('(7) with two variants set the server offers exactly those two types', t.types.join() === 'tanka,en' && t.price_jpy === 1980)
  } finally {
    await withTypes.stop()
  }
}

// ---- 7b. ICHIREI_POEM_PREVIEW: internal testing of poem quality before the Shopify poem products exist ------------------------------------------
{
  check('(7b) preview switch: off by default, `on` only when set to on (anything else is off)', !poemPreviewOn({} as never) && !poemPreviewOn({ ICHIREI_POEM_PREVIEW: 'off' } as never) && !poemPreviewOn({ ICHIREI_POEM_PREVIEW: '1' } as never) && poemPreviewOn({ ICHIREI_POEM_PREVIEW: 'on' } as never) && poemPreviewOn({ ICHIREI_POEM_PREVIEW: ' ON ' } as never))
  check('(7b) preview accepts all four types for POST /api/poem even with no variant; off accepts only the types with a variant', poemTypesAccepted({ ICHIREI_POEM_PREVIEW: 'on' } as never).join() === 'tanka,tang,ci,en' && poemTypesAccepted({} as never).length === 0 && poemTypesAccepted({ SHOPIFY_VARIANT_POEM_CI: '9' } as never).join() === 'ci')
  check('(7b) …but what the page and the order flow read is unchanged: availablePoemTypes ignores the preview switch', availablePoemTypes({ ICHIREI_POEM_PREVIEW: 'on' } as never).length === 0)
  check('(7b) cloudbuild.yaml sets it (temporarily) to on and passes it to the service', /_POEM_PREVIEW: 'on'/.test(read('cloudbuild.yaml')) && read('cloudbuild.yaml').includes('ICHIREI_POEM_PREVIEW=${_POEM_PREVIEW}'))
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-poem-preview-'))
  const preview = await startServer({ upstreamUrl: process.env.ANTHROPIC_BASE_URL, env: { ICHIREI_POEM_PREVIEW: 'on', ICHIREI_POEM_LIMIT: '4/60', ICHIREI_LEXICON_MODE: 'off', ORDER_STORE_DIR: dir } })
  try {
    const h = (await (await fetch(`${preview.url}/api/health`)).json()) as any
    check('(7b) /api/health reports poemPreview: true — and poemTypes still lists only the types with a variant (none here)', h.poemPreview === true && h.poemTypes.length === 0)
    const t = (await (await fetch(`${preview.url}/api/poem-types`)).json()) as any
    check('(7b) the page still gets NO poem chips: /api/poem-types is empty in preview mode (customers see nothing)', t.types.length === 0)
    const statuses: number[] = []
    for (const type of ['tanka', 'tang', 'ci', 'en'] as const) {
      replies = [C20.poems[type]]
      reviewReplies = []
      statuses.push((await quiet(() => fetch(`${preview.url}/api/poem`, { method: 'POST', body: JSON.stringify(body(C20, type)) }))).status)
    }
    check('(7b) POST /api/poem works for all four types with no Shopify variant (200 each)', statuses.join() === '200,200,200,200', statuses.join())
    const fifth = await fetch(`${preview.url}/api/poem`, { method: 'POST', body: JSON.stringify(body(C20, 'tanka')) })
    check('(7b) the rate limit still applies in preview (here 4/60: the fifth request is 429)', fifth.status === 429 && ((await fifth.json()) as any).code === 'rate_limited')
    const bad = await fetch(`${preview.url}/api/poem`, { method: 'POST', body: JSON.stringify(body(C20, 'tanka', { kanji: '死' })) })
    check('(7b) the other poem rules still apply in preview (a hard-block character is refused; limit counted first so this is 429 or 400)', bad.status === 429 || bad.status === 400)
  } finally {
    await preview.stop()
    rmSync(dir, { recursive: true, force: true })
  }
  // rules independent of the rate limit, through the handler with all four types accepted (what preview does)
  const all = ['tanka', 'tang', 'ci', 'en'] as PoemType[]
  const refused = await post(handler(all), body(C20, 'tanka', { kanji: '死' }))
  check('(7b) preview: the palette block still refuses a hard-block character (400 character_not_allowed)', refused.status === 400 && ((await refused.json()) as any).code === 'character_not_allowed')
  const memorial = await post(handler(all), body(C04, 'tanka', { kanji: '祝' }))
  check('(7b) preview: the remembrance block still refuses a celebration character (400)', memorial.status === 400)
  replies = [C20.poems.tang]
  reviewReplies = []
  const tangRes = await quiet(() => post(handler(all), body(C20, 'tang')))
  const tangJ = (await tangRes.json()) as any
  check('(7b) POST /api/poem for a Japanese buyer\'s tang returns the 現代語訳: `aids.gendaigo`, and `reading` = 書き下し then 現代語訳 (and the stored poem has the same reading)', tangRes.status === 200 && tangJ.aids?.kakikudashi?.length === 4 && tangJ.aids?.gendaigo?.includes('二十年') && tangJ.reading.includes('晨に起きて') && tangJ.reading.includes(tangJ.aids.gendaigo) && (store.records.get(tangJ.poem_id) as any)?.reading === tangJ.reading)
  // failure reasons through the API: codes always, the words only in preview mode
  const failing = { ok: false as const, code: 'poem_failed' as const, error: 'x', reasons: ['character_missing'], problems: ['the chosen character (待) does not appear in the poem'] }
  const rOff = await post(handler(all, { generate: async () => failing }), body(C20, 'en'))
  const jOff = (await rOff.json()) as any
  const rOn = await post(handler(all, { generate: async () => failing, detail: true }), body(C20, 'en'))
  const jOn = (await rOn.json()) as any
  check('(7b) a failed poem answers 502 with `reasons` (short codes); the failed checks in words (`problems`) only in preview mode', rOff.status === 502 && jOff.code === 'poem_failed' && jOff.reasons?.join() === 'character_missing' && jOff.problems === undefined && jOn.problems?.length === 1 && jOn.reasons?.join() === 'character_missing')
  // the order flow still refuses a poem whose Shopify variant is missing, whatever the preview says
  replies = [C20.poems.ci]
  reviewReplies = []
  const ci = (await (await quiet(() => post(handler(all), body(C20, 'ci')))).json()) as any
  const refusedOrder = await postOrder(orderHandler({}), orderBody({ poems: [{ poem_id: ci.poem_id }] }))
  check('(7b) the order flow still refuses a poem without a variant (400 poem_type_unavailable), even though the preview wrote it', typeof ci.poem_id === 'string' && refusedOrder.status === 400 && ((await refusedOrder.json()) as any).code === 'poem_type_unavailable')
}

// ---- 8. the page ------------------------------------------------------------------------------------------------------------------------------------
{
  const form = read('src/demo/OrderForm.tsx')
  const addon = read('src/demo/PoemAddOn.tsx')
  check('(8) the order form mounts the add-on and sends only poem_ids with the order', form.includes('<PoemAddOn') && form.includes("poems: poemIds.map((poem_id) => ({ poem_id }))") && !/poems:.*lines/.test(form))
  check('(8) the add-on: four chips from /api/poem-types, at most 2 selectable, each showing ¥1,980, hidden when no type is on offer', addon.includes('/api/poem-types') && addon.includes('MAX_POEMS') && addon.includes('POEM_PRICE_JPY') && addon.includes('offered.length === 0') && addon.includes('return null'))
  check('(8) the add-on copy exists in all four languages: the question, the four type names, the price and the "printed on the card" line', (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => { const p = COPY[l].order.poem; return p.heading.length > 0 && POEM_TYPES.every((t) => p.types[t].length > 0) && p.note(formatYen(1980), 2).includes('1,980') && p.printedOnCard.length > 0 && p.total(2, '¥3,960').includes('3,960') }) && COPY.ja.order.poem.heading === 'この一字に、歌を添えますか？')
  check('(8) price display comes from packages.ts (POEM_PRICE_JPY = 1980, MAX_POEMS = 2); the charge is the Shopify variant\'s', POEM_PRICE_JPY === 1980 && MAX_POEMS === 2 && read('src/order/packages.ts').includes('POEM_PRICE_JPY = 1980'))
  check('(8) the prompts are all in place (one file per type) and load', POEM_TYPES.every((t) => loadPoemPrompt(t).length > 1500))
}

for (const r of hung) r.destroy()
upstream.closeAllConnections?.()
upstream.close()
console.log(failures === 0 ? '\nAll poem checks passed.' : `\n${failures} poem check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
