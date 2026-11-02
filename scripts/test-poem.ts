// Poem add-on tests (ICHIREI_Poem_AddOn_Ticket.md; spec v9.1 step 10): the four form checkers, the chosen character, the palette's blocks and the
// occasion rules for poems, regeneration, the safety review, /api/poem (first-line preview, rate limit, hidden types), the order (max 2, separate
// line items, attributes, the certificate, no poem text from the browser), analytics (no text) and the page. A FAKE model: no key, no network.
// Fixtures: scripts/fixtures-v9/poems.json — all four types on stories 0020 and 0004 (memorial). Whether the REAL model passes the form checks
// is for the owner's live test.
//
//   node --experimental-strip-types scripts/test-poem.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CI_PATTERNS, blockedCharacters, checkCharacterOnce, checkContainsCharacter, checkCraft, checkForcedLabel, checkForm, checkPalette, meaningWords, moraCount } from '../engine/poem-check.ts'
import { buyerAids, generatePoem, loadPoemPrompt, loadPoemReviewPrompt, poemFamilies, reasonCode, type PoemInput } from '../engine/poem.ts'
import { createPoemHandler } from '../api/poem.ts'
import { createOrderHandler } from '../api/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadPalette } from '../engine/palette.ts'
import { checkRhyme, lineRhyme } from '../engine/rhyme.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { DEFAULT_POEM_TYPE, MAX_POEMS, POEM_TYPES, poemTypesFor, type PoemType } from '../src/order/packages.ts'
import { COPY } from '../src/demo/i18n.ts'
// @ts-expect-error untyped test helper
import { startServer } from './server-fixtures.mjs'
process.env.ICHIREI_FILM = 'off' // (the film-script call is switched off in this suite: orders here never reach the model)

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
check('(1) en: 4–8 short lines — valid', checkForm(en(C20.poems.en.lines)).length === 0 && checkForm(en(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).length === 0)
check('(1) en: 3 lines, 9 lines, or a line of more than 12 words are form errors', checkForm(en(['a', 'b', 'c'])).some((p) => p.includes('4–8')) && checkForm(en(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).some((p) => p.includes('4–8')) && checkForm(en(['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen', 'b', 'c', 'd'])).some((p) => p.includes('not short')) && checkForm(en(['one two three four five six seven eight nine ten eleven twelve thirteen', 'b', 'c', 'd'])).length === 0)
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
  const si = await gen(C20, 'en', [C20.poems.en], [{ pass: false, rule: 'story_image', reason: 'generic sea at dusk; carry the prints of the places' }, { pass: true, rule: null, reason: 'ok' }])
  check('(4) spec v9.4: the review rejects imagery that does not come from the story (story_image) → ONE rewrite asked for, with the reader\'s note; the second poem passes', si.ok && count('poem') === 2 && count('review') === 2 && seen[2].prompt.includes('IMAGERY DOES NOT COME FROM THIS STORY') && seen[2].prompt.includes('the prints of the places'))
  const si2 = await gen(C20, 'en', [C20.poems.en], [{ pass: false, rule: 'story_image', reason: 'still generic' }])
  check('(4) …rejected again after the rewrite: the poem in hand is kept (a poem is never lost to the quality rule) — and the safety rules still veto', si2.ok && count('poem') === 2 && logs.some((l) => l.includes('story_image_kept')))
  // ---- 俳句 (spec v9.5, Japanese stories only): 5-7-5, one image from the story, the same review as the tanka --------------------------------------------------------
  const hk = (lines: string[], reading_kana?: string[]) => ({ type: 'haiku' as const, lines, reading_kana })
  check('(1) haiku: 3 lines, 5-7-5 morae counted from the kana reading — valid', checkForm(hk(C20.poems.haiku.lines, C20.poems.haiku.reading_kana)).length === 0 && checkForm(hk(C04.poems.haiku.lines, C04.poems.haiku.reading_kana)).length === 0)
  check('(1) haiku: a wrong mora count, a wrong line count (a tanka is not a haiku), a missing reading are all form errors', checkForm(hk(C20.poems.haiku.lines, ['ふたのはな', 'そなえてまて', 'ははのはる'])).some((p) => p.includes('line 2 has 6 morae')) && checkForm(hk(C20.poems.tanka.lines, C20.poems.tanka.reading_kana)).some((p) => p.includes('3 lines')) && checkForm(hk(C20.poems.haiku.lines)).some((p) => p.includes('kana reading')))
  const haikuOk = await gen(C20, 'haiku', [C20.poems.haiku])
  check('(4) a generated haiku (through the real pipeline, fake model) is 5-7-5, holds the chosen character, and uses an image from THIS story (the flower on the lunch-box lid: 花 is in the story)', haikuOk.ok && haikuOk.poem.lines.length === 3 && moraCount(C20.poems.haiku.reading_kana[0]) === 5 && moraCount(C20.poems.haiku.reading_kana[1]) === 7 && moraCount(C20.poems.haiku.reading_kana[2]) === 5 && haikuOk.poem.lines.join('').includes('備') && haikuOk.poem.lines.join('').includes('花') && C20.story.includes('花') && haikuOk.poem.type === 'haiku')
  const haikuSi = await gen(C20, 'haiku', [C20.poems.haiku], [{ pass: false, rule: 'story_image', reason: 'generic spring scenery' }, { pass: true, rule: null, reason: 'ok' }])
  check('(4) a haiku gets the tanka\'s review: generic imagery (story_image) → ONE rewrite with the reader\'s note, then it passes', haikuSi.ok && count('poem') === 2 && count('review') === 2 && seen[2].prompt.includes('IMAGERY DOES NOT COME FROM THIS STORY'))
  const hp = loadPoemPrompt('haiku')
  check('(4) the haiku prompt: 5-7-5, ONE concrete image from the turning point, a season word (季語) only when the story\'s season is clear and never forced, no explaining of feelings, quiet in remembrance', hp.includes('5-7-5') && hp.includes('ONE concrete image') && hp.includes('季語') && hp.includes('do NOT force one') && hp.includes('do NOT explain feelings') && hp.includes('Remembrance: quiet'))
  check('(4) a haiku\'s buyer aids and palette follow the tanka (Japanese reader: none; other readers: romaji + English; judged by the ja palette)', poemFamilies('haiku', 'ja').join() === 'ja' && buyerAids('haiku', 'ja') === buyerAids('tanka', 'ja') && buyerAids('haiku', 'en').includes('romaji'))
  for (const t of POEM_TYPES) {
    const prompt = loadPoemPrompt(t)
    check(`(4) spec v9.4: the ${t} prompt asks the poem to carry the TURNING POINT through one concrete image of the story and forbids generic scenery`, prompt.includes('carry the TURNING POINT') && prompt.includes('ONE concrete image') && prompt.includes('NO generic scenery') && prompt.includes('Remembrance stories stay quiet'))
  }
  check('(4) the review prompt carries the story_image rule', loadPoemReviewPrompt().includes('`story_image`') && loadPoemReviewPrompt().includes('does not come from THIS story'))
  // ---- v9.6 addendum: the poem condenses the story and carries the character exactly once, naturally ------------------------------------------------------------------
  for (const [t, c] of [['tanka', C20], ['haiku', C20], ['tang', C20], ['tanka', C04], ['haiku', C04], ['tang', C04], ['ci', C20]] as const) {
    const p = c.poems[t]
    const d = { type: t, lines: p.lines, reading_kana: p.reading_kana, pattern: p.pattern } as any
    check(`(5) v9.6: the ${t} fixture (${c.name}) contains the character exactly once, and no label line`, checkCharacterOnce(d, [c.kanji]) === null && checkContainsCharacter(d, [c.kanji]) === null && checkForcedLabel(d, [c.kanji]) === null)
  }
  const twice = (t: PoemType, c: typeof C20): any => { const p = c.poems[t]; return { ...p, lines: p.lines.map((l: string, i: number) => (i === p.lines.length - 1 ? l + c.kanji : l)) } }
  {
    let allTwice = true
    for (const t of ['tanka', 'haiku', 'tang'] as const) {
      const r = await gen(C20, t, [twice(t, C20), C20.poems[t]])
      if (!(r.ok && count('poem') === 2 && seen[1].prompt.includes('appears 2 times') && seen[1].prompt.includes('exactly once'))) allTwice = false
    }
    check('(5) the character twice in a tanka, a haiku or a 漢詩 fails the code check ("exactly once"), and the model is asked to rewrite', allTwice)
  }
  check('(5) …a poem with the character twice on both tries is an error for that type (poem_failed), never shown', !(await gen(C20, 'tanka', [twice('tanka', C20)])).ok)
  const label = { ...C20.poems.tanka, lines: [C20.kanji + '見ゆ', ...C20.poems.tanka.lines.slice(1)], reading_kana: ['みゆ', ...C20.poems.tanka.reading_kana.slice(1)] }
  check('(5) a bare label line that only announces the character (「備見ゆ」) is refused by the code check', checkForcedLabel({ type: 'tanka', lines: label.lines }, [C20.kanji]) !== null && checkForcedLabel({ type: 'haiku', lines: ['父察す', 'a', 'b'] }, ['察']) !== null && checkForcedLabel({ type: 'tanka', lines: C20.poems.tanka.lines }, [C20.kanji]) === null)
  const noCharPoem = { ...C20.poems.tanka, lines: C20.poems.tanka.lines.map((l: string) => l.split(C20.kanji).join('')) }
  const rMissing = await gen(C20, 'tanka', [noCharPoem, C20.poems.tanka])
  check('(5) a fake poem WITHOUT the character is rewritten (the second try, with the failed check fed back, passes)', checkContainsCharacter({ type: 'tanka', lines: noCharPoem.lines }, [C20.kanji]) !== null && rMissing.ok && count('poem') === 2 && seen[1].prompt.includes('does not appear in the poem'))
  const rImg = await gen(C20, 'tanka', [C20.poems.tanka], [{ pass: false, rule: 'story_image', reason: 'the moon on the sea is not in the story' }, { pass: true, rule: null, reason: 'ok' }])
  check('(5) a fake poem with an image that is NOT in the story is rewritten once (the reader\'s note is fed back: no scenery, object or feeling the story does not give)', rImg.ok && count('poem') === 2 && count('review') === 2 && seen[2].prompt.includes('IMAGERY DOES NOT COME FROM THIS STORY') && seen[2].prompt.includes('the moon on the sea'))
  const rLab = await gen(C20, 'tanka', [C20.poems.tanka], [{ pass: false, rule: 'character', reason: 'the character is a forced label' }, { pass: true, rule: null, reason: 'ok' }])
  check('(5) the review rule `character` (missing, a label, or forced): ONE rewrite, then the better poem is kept — never lost to a quality rule', rLab.ok && count('poem') === 2 && seen[2].prompt.includes('NOT USED NATURALLY'))
  const rKeep = await gen(C20, 'tanka', [C20.poems.tanka], [{ pass: false, rule: 'character', reason: 'still a label' }])
  check('(5) …rejected again after the rewrite: the poem in hand is kept (not an error)', rKeep.ok && count('poem') === 2)
  const rTone = await gen(C20, 'tanka', [C20.poems.tanka], [{ pass: false, rule: 'tone', reason: 'a celebration word in an apology' }, { pass: true, rule: null, reason: 'ok' }])
  check('(5) the review rule `tone` (the purpose\'s tone rules apply to the poem) is a veto: regenerate with the reason', rTone.ok && count('poem') === 2 && seen[2].prompt.includes('review (tone)'))
  const quietIn = { ...input(C04, 'tang'), quiet: true, occasion: null }
  replies = [{ ...C04.poems.tang, lines: ['舊箋幾十通', '皆是母手跡', '綴我名而祝', '燈前讀不已'] }]
  reviewReplies = []
  const rQuiet = await quiet(() => generatePoem(quietIn as PoemInput, palette))
  check('(5) a quiet gift (apology / encouragement / the state "lost") keeps celebration characters (祝) out of the poem even with no occasion code', !rQuiet.ok && logs.some((l) => l.includes('blocked in remembrance')))
  check('(5) the English meaning word counts as the character in an English poem (信 → "trust"): present passes, absent fails; the glyph still counts', checkContainsCharacter(en(['She gave me the keys,', 'and said nothing.', 'That was trust.', 'I knew it then.']), ['信'], meaningWords('trust')) === null && checkContainsCharacter(en(['She gave me the keys,', 'and said nothing.', 'That was all.', 'I knew it then.']), ['信'], meaningWords('trust')) !== null && checkContainsCharacter(en(['the quiet word 待 —', 'b', 'c', 'd']), ['待'], meaningWords('to wait')) === null && meaningWords('to be ready').includes('ready'))
  for (const t of POEM_TYPES) {
    const pr = loadPoemPrompt(t)
    check(`(5) the ${t} prompt: the character exactly once and naturally (no label line), the poem condenses the story around the RECEIVER, only the story's images, the purpose tone applies`, (t === 'en' ? pr.includes('MEANING WORD') : pr.includes('EXACTLY ONCE')) && pr.includes('THE POEM CONDENSES THE STORY') && pr.includes('RECEIVER') && pr.includes("ONLY THE STORY'S IMAGES") && pr.includes('PURPOSE TONE'))
  }
  check('(5) per format: tanka — one image from the turning point, the receiver\'s act and the feeling, the character inside a natural word (潤して / 察して / 待ちて); haiku — one image only, 季語 only when the season is clear; 漢詩 — the arc, the character best in line 3 or 4; 宋詞 — the arc; English — 4–8 lines, the turning point', (() => { const k = (t: PoemType) => loadPoemPrompt(t); return k('tanka').includes('潤して') && k('tanka').includes('the receiver\'s act') && k('haiku').includes('ONE image only') && k('haiku').includes('季語') && k('tang').includes('line 3 or 4') && k('tang').includes('ARC') && k('ci').includes('ARC') && k('en').includes('TURNING POINT') && k('en').includes('4 to 8') })())
  check('(5) the poem review prompt has the `character` and `tone` rules and the stricter story_image (nothing the story does not give)', loadPoemReviewPrompt().includes('`character`') && loadPoemReviewPrompt().includes('`tone`') && loadPoemReviewPrompt().includes('nothing in the poem may come from outside the story') && /"story_image" \| "character" \| "tone"/.test(loadPoemReviewPrompt()))
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
  check('(4b) the English prompt asks for the character\'s MEANING WORD once (v9.6), gives the word limit and the four-to-eight-line shape', (() => { const t = loadPoemPrompt('en'); return t.includes('MEANING WORD') && t.includes('ONCE') && t.includes('TWELVE words') && t.includes('4 to 8 strings') })())
  check('(4b) failure reasons are short codes: call / parse / form / character_missing / rhyme / palette / review:<rule> / gendaigo', ['call: boom', 'the reply was not a JSON object', 'the reply has no lines array', 'a tanka has 5 lines (got 4)', 'the chosen character (備) does not appear in the poem', 'lines 2 and 4 must rhyme: …', '死: hard block (never used)', '祝: blocked in remembrance (x)', 'review (relationship): x', 'gendaigo is missing: …'].map(reasonCode).join() === 'call,parse,parse,form,character_missing,rhyme,palette,palette,review:relationship,gendaigo')
}

// ---- 5. /api/poem: the included poem ------------------------------------------------------------------------------------------------------------
const store = new MemoryOrderStore()
const handler = (extra: object = {}) => createPoemHandler(() => ({ store, palette, now: () => new Date('2026-10-28T03:00:00Z'), ...extra }))
const body = (c: typeof C20, type: string, more: object = {}) => ({ session: 'abcdefghijklmnop1234', story: c.story, language: c.context.language, relationship: c.context.relationship, direction: c.context.direction, occasion: c.context.occasion, kanji: c.kanji, gaze: c.gaze, type, ...more })
const post = (h: (r: Request) => Promise<Response>, b: unknown) => h(new Request('http://x/api/poem', { method: 'POST', body: JSON.stringify(b) }))
let poemId20 = ''
let poemIdEn = ''
{
  replies = [C20.poems.tanka]
  reviewReplies = []
  const res = await quiet(() => post(handler(), body(C20, 'tanka')))
  const j = (await res.json()) as any
  poemId20 = j.poem_id
  check('(5) /api/poem: 200 with the FULL poem (every line), the reading aids and the poem_id — and no price anywhere', res.status === 200 && j.lines.length === 5 && j.lines.join() === C20.poems.tanka.lines.join() && typeof j.reading === 'string' && /^PM-20261028-[a-z2-9]{10}$/.test(j.poem_id) && !('price_jpy' in j) && !('max' in j), JSON.stringify(j).slice(0, 200))
  check('(5) …the poem is stored on the server under poem_id (the order reads it back); the stored record has the character forms', (store.records.get(j.poem_id) as any)?.lines?.length === 5 && (store.records.get(j.poem_id) as any)?.kanji === '備')
  const EN_STORY = { ...C20, story: 'My mother waited at the station every time I left. She only said, "The tea is ready."', context: { ...C20.context, language: 'en' } }
  const ZH_STORY = { ...C20, story: '每次晚歸，玄關總有一盞燈亮著。下雨的夜裡，媽媽撐著傘在門口等，她只說家裡的燈還亮著。', context: { ...C20.context, language: 'zh-Hant' } }
  replies = [C20.poems.en]
  const en = await quiet(() => post(handler(), body(EN_STORY, 'en')))
  poemIdEn = ((await en.json()) as any).poem_id
  const offeredFor = async (c: typeof C20) => { const out: string[] = []; for (const t of POEM_TYPES) { replies = [C20.poems[t]]; if ((await quiet(() => post(handler(), body(c, t)))).status === 200) out.push(t) } return out.join() }
  const ja2 = await offeredFor(C20)
  const zh2 = await offeredFor(ZH_STORY)
  const en1 = await offeredFor(EN_STORY)
  check('(5) spec v9.5, the formats follow the story\'s language: a Japanese story answers tanka, haiku and tang only (3, tanka first), a Chinese story tang and ci only (2), an English story en only (1)', ja2 === 'tanka,haiku,tang' && zh2 === 'tang,ci' && en1 === 'en', [ja2, zh2, en1].join(' | '))
  replies = [C20.poems.ci]
  const ciJa = await quiet(() => post(handler(), body(C20, 'ci')))
  check('(5) …and a format that is not offered is refused with a clear code (400 poem_type_not_offered) — the model is not called', ciJa.status === 400 && ((await ciJa.json()) as any).code === 'poem_type_not_offered')
  const results = await Promise.all([
    post(handler(), body(C20, 'sonnet')),
    post(handler(), { ...body(C20, 'tanka'), story: '' }),
    post(handler(), { ...body(C20, 'tanka'), kanji: 'ab' }),
    post(handler(), { ...body(C20, 'tanka'), gaze: '' }),
    post(handler(), { ...body(C20, 'tanka'), language: 'fr' }),
    post(handler(), body(C20, 'tanka', { kanji: '死' })),
    post(handler({ store: null }), body(C20, 'tanka')),
  ])
  check('(5) bad input: unknown type / empty story / not one character / empty gaze / unknown language → 400; a hard-block character (死) → 400 character_not_allowed; no store → 503', results.slice(0, 5).every((r) => r.status === 400) && results[5].status === 400 && ((await results[5].json()) as any).code === 'character_not_allowed' && results[6].status === 503)
  const mem = await post(handler(), body(C04, 'tanka', { kanji: '祝' }))
  check('(5) remembrance: a celebration character cannot carry a poem (400 character_not_allowed)', mem.status === 400 && ((await mem.json()) as any).code === 'character_not_allowed')
  replies = [{ ...C20.poems.tanka, reading_kana: ['あ', 'い', 'う', 'え', 'お'] }]
  const failed = await quiet(() => post(handler(), body(C20, 'tanka')))
  const failedJ = (await failed.json()) as any
  check('(5) a poem that fails its checks twice answers 502 poem_failed with the reason codes (and never the failed checks in words) — the page then lets the order go ahead without a poem', failed.status === 502 && failedJ.code === 'poem_failed' && Array.isArray(failedJ.reasons) && !('problems' in failedJ))
  const lines = (store.lines.get('analytics/2026-10-28.jsonl') ?? []).map((l) => JSON.parse(l))
  check('(5) analytics: poem_previewed per poem written — session, source and the type only; no story, no poem text', lines.filter((e) => e.event === 'poem_previewed').length >= 2 && lines.every((e) => !JSON.stringify(e).includes('朝ごとに')))
}

// ---- 6. the order: ONE poem, on the main line item, free ------------------------------------------------------------------------------------------
const shopSeen: any[] = []
const fakeShopify = (async (_url: string, init: RequestInit) => {
  shopSeen.push(JSON.parse(String(init.body)))
  return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/1', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })
}) as unknown as typeof fetch
const shop = () => loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN_PUBLIC: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2' } as never).config!
const orderHandler = () => createOrderHandler(() => ({ store, shopify: shop(), shopifyMissing: [], now: () => new Date('2026-10-28T03:00:00Z'), fetchImpl: fakeShopify, palette }))
const GOLD = JSON.parse(read('scripts/golden-fixture.json'))
const orderBody = (more: object = {}) => ({ story: C20.story, engine_result: { ...clone(GOLD), language: 'ja', candidates: GOLD.candidates.map((c: any, i: number) => (i === 0 ? { ...c, kanji: '備', inscription_form: null, reading: 'そなえる' } : c)), primary_kanji: '備' }, selected_kanji: '備', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 花子', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'standard', session: 'abcdefghijklmnop1234', source: 'customer', ...more })
const postOrder = (h: (r: Request) => Promise<Response>, b: unknown) => h(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) }))
{
  shopSeen.length = 0
  const res = await quiet(() => postOrder(orderHandler(), orderBody({ poems: [{ poem_id: poemId20, lines: ['EVIL'] }] })))
  const j = (await res.json()) as any
  const lines = shopSeen[0].variables.input.lines
  const attr = (l: any, k: string) => l.attributes.find((a: any) => a.key === k)?.value
  check('(6) an order with the included poem: ONE cart with ONE line item (the package) — no poem line item, no poem product, no variant', res.status === 200 && lines.length === 1 && lines[0].merchandiseId.endsWith('/2'), JSON.stringify(j).slice(0, 200))
  check('(6) the poem goes on that main line as ichirei_poem_type, ichirei_poem_text (the lines, one per row) and ichirei_poem_reading', attr(lines[0], 'ichirei_poem_type') === 'tanka' && attr(lines[0], 'ichirei_poem_text') === C20.poems.tanka.lines.join('\n') && attr(lines[0], 'ichirei_poem_reading') === '-')
  check('(6) poem text comes from the server\'s store, never from the browser: the "EVIL" lines sent with the poem_id are ignored', !JSON.stringify(shopSeen[0]).includes('EVIL'))
  check('(6) the attribute order: the nine usual ones, then the poem (type, text, reading), then the animation link last', lines[0].attributes.map((a: any) => a.key).join() === 'kanji,inscription_form,reading,certificate_meaning_en,sender_name,receiver_name,delivery_date,language,order_ref,ichirei_size,ship_to,ichirei_poem_type,ichirei_poem_text,ichirei_poem_reading,ichirei_gift_url,ichirei_animation_url')
  const rec = store.records.get(j.order_ref) as any
  check('(6) the certificate object carries poems: [{type, lines, reading}] (response and stored record); the record has no price for it', j.certificate.poems.length === 1 && j.certificate.poems[0].type === 'tanka' && j.certificate.poems[0].lines.length === 5 && rec.production.certificate.poems.length === 1 && rec.production.poems.length === 1 && !('price_jpy' in rec.production.poems[0]))
  const anim = store.records.get(j.animation_url.split('/').pop()) as any
  check('(6) the story film does not carry the poem (it retells the story and ends with the character): the animation record has no poem field, while the order keeps the chosen one', !('poem' in anim) && rec.production.poems[0].type === 'tanka')
  const ev = (store.lines.get('analytics/2026-10-28.jsonl') ?? []).map((l) => JSON.parse(l))
  check('(6) analytics: the order is recorded with the poem type, and a poem_added event — type only', ev.some((e) => e.event === 'ordered' && e.poem_types?.join() === 'tanka') && ev.filter((e) => e.event === 'poem_added').map((e) => e.poem_type).join() === 'tanka')
  const none = await quiet(() => postOrder(orderHandler(), orderBody()))
  const jn = (await none.json()) as any
  const noAttrs = shopSeen.at(-1).variables.input.lines[0].attributes.map((a: any) => a.key)
  const noAnim = store.records.get(jn.animation_url.split('/').pop()) as any
  check('(6) an order with no poem (the buyer\'s poem failed twice) goes through: one line item, no poem attributes, certificate.poems = [], and its film is the same as any other', none.status === 200 && shopSeen.at(-1).variables.input.lines.length === 1 && !noAttrs.some((k: string) => k.startsWith('ichirei_poem')) && jn.certificate.poems.length === 0 && !('poem' in noAnim))
  const en = await quiet(() => postOrder(orderHandler(), orderBody({ language: 'en', inscription_style: 'modern', engine_result: { ...orderBody().engine_result, language: 'en' }, poems: [{ poem_id: poemIdEn }] })))
  check('(6) …and an English poem is refused for a Japanese gift (the poem belongs to a language), so the page asks for the poem again', en.status === 400 && ['poem_mismatch', 'poem_type_not_offered'].includes(((await en.json()) as any).code))
}
{
  const r1 = await postOrder(orderHandler(), orderBody({ poems: [{ poem_id: poemId20 }, { poem_id: poemIdEn }] }))
  check(`(6) one poem only (MAX_POEMS = ${MAX_POEMS}): a second is refused (400 too_many_poems)`, MAX_POEMS === 1 && r1.status === 400 && ((await r1.json()) as any).code === 'too_many_poems')
  const r4 = await postOrder(orderHandler(), orderBody({ poems: [{ poem_id: 'PM-20261028-zzzzzzzzzz' }] }))
  const r5 = await postOrder(orderHandler(), orderBody({ poems: [{ poem_id: 'nope' }] }))
  const r6 = await postOrder(orderHandler(), orderBody({ poems: 'x' }))
  check('(6) an unknown poem_id (poem_not_found), a malformed one and a non-array are refused (400)', r4.status === 400 && ((await r4.json()) as any).code === 'poem_not_found' && r5.status === 400 && r6.status === 400)
  const r7 = await postOrder(orderHandler(), orderBody({ selected_kanji: '守', poems: [{ poem_id: poemId20 }] }))
  check('(6) a poem belongs to ONE character: ordering it with another character is refused (400 poem_mismatch)', r7.status === 400 && ((await r7.json()) as any).code === 'poem_mismatch')
}

{
  // @ts-expect-error untyped script
  const { summarizePoems, formatPoems } = await import('./report-choices.mjs')
  const evs = (store.lines.get('analytics/2026-10-28.jsonl') ?? []).map((l) => JSON.parse(l))
  const rows = summarizePoems(evs, { source: 'customer' })
  check('(6) the report counts poems written and ordered per type (sessions, no text) and prints a poem block', rows.some((r: any) => r.type === 'tanka' && r.previewed >= 1 && r.added === 1) && formatPoems(rows).includes('previewed') && formatPoems([]).includes('no poem add-on'))
}

// ---- 7. the server: rate limit 20 per hour; nothing of the old add-on is left --------------------------------------------------------------------------
{
  const server = await startServer({ upstreamUrl: process.env.ANTHROPIC_BASE_URL, env: { ICHIREI_POEM_LIMIT: '2/60', ICHIREI_LEXICON_MODE: 'off' } })
  try {
    const h = (await (await fetch(`${server.url}/api/health`)).json()) as any
    check('(7) /api/poem-types is gone (every format is always on offer) and /api/health no longer lists poem types or a preview switch', (await fetch(`${server.url}/api/poem-types`)).status === 404 && !('poemTypes' in h) && !('poemPreview' in h))
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${server.url}/api/poem`, { method: 'POST', body: JSON.stringify(body(C20, 'tanka')) })).status)
    check('(7) /api/poem is rate limited per IP (here 2/60): the third request is 429 with Retry-After; the first two reach the handler (503: no order store in this test server)', statuses.join() === '503,503,429', statuses.join())
    const rl = await fetch(`${server.url}/api/poem`, { method: 'POST', body: '{}' })
    check('(7) …429 carries the standard body and header', rl.status === 429 && rl.headers.get('retry-after') !== null && ((await rl.json()) as any).code === 'rate_limited')
  } finally {
    await server.stop()
  }
  const dflt = read('server/app.ts')
  check('(7) the default limit is 20 per hour per IP', dflt.includes("envRunLimiter('ICHIREI_POEM_LIMIT', { max: 20, minutes: 60 })"))
  const gone = ['cloudbuild.yaml', 'engine/shopify.ts', 'api/poem.ts', 'api/order.ts', 'server/app.ts', 'src/demo/PoemAddOn.tsx', 'src/order/packages.ts'].map((f) => [f, read(f)] as const)
  check('(7) the preview switch and the poem products are gone from the code and the deploy file: no ICHIREI_POEM_PREVIEW, no SHOPIFY_VARIANT_POEM_*, no poem price, no poem variant', gone.every(([, t]) => !/ICHIREI_POEM_PREVIEW|SHOPIFY_VARIANT_POEM|POEM_PRICE_JPY|poemVariants|poemPreviewOn|_POEM_PREVIEW/.test(t)), gone.filter(([, t]) => /ICHIREI_POEM_PREVIEW|SHOPIFY_VARIANT_POEM|POEM_PRICE_JPY|poemVariants|poemPreviewOn/.test(t)).map(([f]) => f).join())
}

// ---- 8. the page ------------------------------------------------------------------------------------------------------------------------------------
{
  const form = read('src/demo/OrderForm.tsx')
  const addon = read('src/demo/PoemAddOn.tsx')
  check('(8) the order form mounts the step, sends only the poem_id with the order, and waits while the poem is being written', form.includes('<PoemAddOn') && form.includes("poems: poemIds.map((poem_id) => ({ poem_id }))") && !/poems:.*lines/.test(form) && form.includes("poemStep !== 'loading'"))
  check('(8) the step is always visible: the formats of the story\'s language as radio buttons, no call to a type list, no price', addon.includes('offered.map') && addon.includes('type="radio"') && !addon.includes('/api/poem-types') && !addon.includes('formatYen'))
  check('(8) the default format follows the story\'s language: ja → tanka, zh → tang / 漢詩 (both scripts), en → en; the step offers poemTypesFor(...)', DEFAULT_POEM_TYPE.ja === 'tanka' && DEFAULT_POEM_TYPE['zh-Hans'] === 'tang' && DEFAULT_POEM_TYPE['zh-Hant'] === 'tang' && DEFAULT_POEM_TYPE.en === 'en' && addon.includes('poemTypesFor(language') && addon.includes('defaultPoemType(language'))
  check('(8) the whole poem is shown before checkout (every line, then the reading aids), not just a first line', addon.includes('data-poem-full') && addon.includes('st.lines.join') && !addon.includes('.preview') && addon.includes('data-poem-reading'))
  check('(8) a poem that fails is tried twice, then given up politely and the order goes ahead without one (the step reports "none", not "loading")', addon.includes('const TRIES = 2') && addon.includes("'none'") && addon.includes('failedFinal'))
  check('(8) the copy exists in all four languages: the heading, "included, no extra charge", the four format names, the failure note and the retry button — and mentions no price', (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => { const c = COPY[l].order.poem; return c.heading.length > 3 && c.note.length > 10 && POEM_TYPES.every((t) => c.types[t].length > 1) && c.loading.length > 2 && c.printedOnCard.length > 3 && c.failedFinal.length > 15 && c.tryAgain.length > 1 && !/[¥￥]|円|\d{3,}|yen/i.test(c.note + c.heading) }))
  // spec v9.5: every label is shown in the PAGE language; the Tang quatrain is never called 漢詩 on a zh page (it is the normal word only in Japanese)
  const L = (l: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en') => COPY[l].order.poem.types
  check('(8) labels, ja page: 短歌（五七五七七）/ 俳句（五七五）/ 漢詩（唐詩の形・五言／七言絶句）/ 宋詞 / 自由詩', L('ja').tanka === '短歌（五七五七七）' && L('ja').haiku === '俳句（五七五）' && L('ja').tang === '漢詩（唐詩の形・五言／七言絶句）' && L('ja').ci === '宋詞' && L('ja').en === '自由詩')
  check('(8) labels, zh-Hant page: 短歌（五七五七七）/ 俳句（五七五）/ 唐詩（五言／七言絕句）/ 宋詞 / 自由詩 — and 漢詩 is not shown as a format name', L('zh-Hant').tanka === '短歌（五七五七七）' && L('zh-Hant').haiku === '俳句（五七五）' && L('zh-Hant').tang === '唐詩（五言／七言絕句）' && L('zh-Hant').ci === '宋詞' && L('zh-Hant').en === '自由詩' && !Object.values(L('zh-Hant')).some((v) => v.includes('漢詩')) && !Object.values(L('zh-Hans')).some((v) => v.includes('汉诗') || v.includes('漢詩')))
  check('(8) labels, en page: Tanka (5-7-5-7-7) / Haiku (5-7-5) / Tang-style quatrain (5 or 7 characters per line) / Song-dynasty ci / Free verse', L('en').tanka === 'Tanka (5-7-5-7-7)' && L('en').haiku === 'Haiku (5-7-5)' && L('en').tang === 'Tang-style quatrain (5 or 7 characters per line)' && L('en').ci === 'Song-dynasty ci' && L('en').en === 'Free verse')
  check('(8) the step shows the labels of the PAGE language for the formats of the STORY language (a Japanese story on a zh-Hant page: 短歌 / 俳句 / 唐詩, never 漢詩)', addon.includes('p.types[t]') && poemTypesFor('zh-Hant', C20.story).map((t) => L('zh-Hant')[t]).join('|') === '短歌（五七五七七）|俳句（五七五）|唐詩（五言／七言絕句）' && poemTypesFor('en', C20.story).map((t) => L('en')[t]).join('|') === 'Tanka (5-7-5-7-7)|Haiku (5-7-5)|Tang-style quatrain (5 or 7 characters per line)')
  check('(8) the prompts are all in place (one file per type) and load', POEM_TYPES.every((t) => loadPoemPrompt(t).length > 1500))
}

for (const r of hung) r.destroy()
upstream.closeAllConnections?.()
upstream.close()
console.log(failures === 0 ? '\nAll poem checks passed.' : `\n${failures} poem check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
