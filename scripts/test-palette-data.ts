// Property tests for the shipped DRAFT palette (engine/palette.csv): shape, completeness,
// internal consistency. They cannot say the linguistics is right — that is the reviewers' job —
// but they stop a malformed or half-filled row from reaching them. No key, no network.
//
//   node --experimental-strip-types scripts/test-palette-data.ts

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INSCRIPTION_FITNESS, OCCASIONS, PALETTE_COLUMNS, PALETTE_ROW_STATUSES, RELATIONSHIPS, type PaletteRow } from '../engine/contract.ts'
import { FREESTYLE_CATEGORIES, classicalEchoOf, loadPalette, parseCsv, plainMeaning } from '../engine/palette.ts'
import { kanaToRomaji, romanizeReadings } from '../engine/romaji.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const list = (xs: string[]) => xs.slice(0, 25).join(' ')
const bad = (rows: PaletteRow[], pred: (r: PaletteRow) => boolean) => rows.filter((r) => !pred(r)).map((r) => `${r.language}:${r.kanji}`)

const palette = loadPalette()
const ja = palette.values().filter((r) => r.language === 'ja')
const zh = palette.values().filter((r) => r.language === 'zh')
const all = palette.values()
const cp = (s: string) => [...s]

// ---- size and spread ---------------------------------------------------------------------
check('size: about 300 ja rows and about 300 zh rows', ja.length >= 280 && ja.length <= 350 && zh.length >= 280 && zh.length <= 350, `ja=${ja.length} zh=${zh.length}`)
const count = (rows: PaletteRow[], st: string) => rows.filter((r) => r.status === st).length
check('spread: every status (ok, context_required, hard_block) is used in both languages', PALETTE_ROW_STATUSES.every((st) => count(ja, st) > 0 && count(zh, st) > 0))
console.log(`INFO  ja ${ja.length} rows: ok=${count(ja, 'ok')} context_required=${count(ja, 'context_required')} hard_block=${count(ja, 'hard_block')}`)
console.log(`INFO  zh ${zh.length} rows: ok=${count(zh, 'ok')} context_required=${count(zh, 'context_required')} hard_block=${count(zh, 'hard_block')}`)

// ---- every column filled -----------------------------------------------------------------
const emptyCells: string[] = []
for (const r of all) for (const col of PALETTE_COLUMNS) if (col !== 'reviewed_on' && r.raw[col] === '') emptyCells.push(`${r.language}:${r.kanji}.${col}`)
check('complete: no empty cell anywhere (reviewed_on aside) — "none" is used where nothing applies', emptyCells.length === 0, list(emptyCells))
const AI_PASS = /^Claude\(AI/
check('provenance: every row is draft-unreviewed, interim-unreviewed or an AI first pass ("Claude(AI…)", dated) — no human sign-off is claimed anywhere', bad(all, (r) => ['draft-unreviewed', 'interim-unreviewed'].includes(r.raw.reviewed_by) ? r.raw.reviewed_on === '' : AI_PASS.test(r.raw.reviewed_by) && /^\d{4}-\d{2}-\d{2}$/.test(r.raw.reviewed_on)).length === 0)
check('provenance: no row is "reviewed" yet — an AI pass is NOT a review (isReviewed is false for reviewed_by "Claude…")', all.every((r) => !r.reviewed) && all.some((r) => AI_PASS.test(r.raw.reviewed_by)))
check('provenance: exactly the 27 shipped interim rows keep interim-unreviewed (18 ja + 9 zh)', ja.filter((r) => r.raw.reviewed_by === 'interim-unreviewed').length === 18 && zh.filter((r) => r.raw.reviewed_by === 'interim-unreviewed').length === 9)

// ---- single characters, forms ------------------------------------------------------------
check('form: `kanji` and `inscription_form` are each a single character', bad(all, (r) => cp(r.kanji).length === 1 && cp(r.raw.inscription_form).length === 1).length === 0, list(bad(all, (r) => cp(r.kanji).length === 1 && cp(r.raw.inscription_form).length === 1)))
const KNOWN_ZH: [string, string][] = [['灯', '燈'], ['爱', '愛'], ['乐', '樂'], ['终', '終'], ['离', '離'], ['断', '斷'], ['丧', '喪'], ['亲', '親'], ['师', '師'], ['书', '書'], ['学', '學'], ['寿', '壽'], ['礼', '禮'], ['孙', '孫'], ['妈', '媽'], ['团', '團'], ['圆', '圓']]
check('zh: kanji = SIMPLIFIED and inscription_form = TRADITIONAL for known pairs', KNOWN_ZH.every(([simp, trad]) => palette.lookup('zh', simp)?.raw.kanji === simp && palette.lookup('zh', simp)?.raw.inscription_form === trad), KNOWN_ZH.filter(([s, t]) => palette.lookup('zh', s)?.raw.inscription_form !== t).join(' '))
check('zh: a row is found by either script (simplified 爱 and traditional 愛 give the same row)', palette.lookup('zh', '爱') === palette.lookup('zh', '愛') && palette.lookup('zh', '爱') !== undefined)
const KNOWN_JA: [string, string][] = [['灯', '燈'], ['学', '學'], ['桜', '櫻'], ['礼', '禮'], ['寿', '壽'], ['歳', '歲'], ['帰', '歸'], ['黙', '默'], ['縁', '緣'], ['宝', '寶']]
check('ja: inscription_form = kyūjitai for known pairs', KNOWN_JA.every(([m, k]) => palette.lookup('ja', m)?.raw.inscription_form === k), KNOWN_JA.filter(([m, k]) => palette.lookup('ja', m)?.raw.inscription_form !== k).join(' '))
check('zh: the same character is not listed twice under two scripts (no row\'s kanji is another row\'s inscription_form)', true) // enforced by the Palette constructor, which throws

// ---- readings ----------------------------------------------------------------------------
const kana = /^[ァ-ヿぁ-ゖー-]+$/
const tone = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/
check('ja readings: katakana (on) and hiragana (kun) only, "-" marks the okurigana split', bad(ja, (r) => r.readings.length > 0 && r.readings.every((x) => kana.test(x))).length === 0, list(bad(ja, (r) => r.readings.length > 0 && r.readings.every((x) => kana.test(x)))))
check('zh readings: pinyin with tone marks', bad(zh, (r) => r.readings.length > 0 && r.readings.every((x) => tone.test(x) && /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/.test(x))).length === 0, list(bad(zh, (r) => r.readings.length > 0 && r.readings.every((x) => tone.test(x) && /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/.test(x)))))

// ---- compounds and meanings --------------------------------------------------------------
const nonHard = (rows: PaletteRow[]) => rows.filter((r) => r.status !== 'hard_block')
const compoundsOf = (r: PaletteRow) => r.raw.auspicious_compounds.split('|').filter((c) => c && c !== 'none')
check('compounds: every ok row lists at least 2 auspicious compounds', bad(nonHard(all).filter((r) => r.status === 'ok'), (r) => compoundsOf(r).length >= 2).length === 0, list(bad(nonHard(all).filter((r) => r.status === 'ok'), (r) => compoundsOf(r).length >= 2)))
const forms = (r: PaletteRow) => [r.kanji, r.raw.inscription_form]
const missingChar: string[] = []
for (const r of all) for (const c of compoundsOf(r)) if (!forms(r).some((f) => c.includes(f))) missingChar.push(`${r.language}:${r.kanji}→${c}`)
// kana-only words (お迎え is fine because it has 迎; はなむけ is the one allowed kana-only compound)
check('compounds: each listed compound contains the row\'s character (either form)', missingChar.filter((x) => !x.endsWith('→はなむけ')).length === 0, list(missingChar))
check('meanings: every row has an English core meaning', bad(all, (r) => r.raw.core_meanings.length >= 3).length === 0)
check('cross-language note: every row has a real note (>= 20 characters)', bad(all, (r) => r.raw.cross_language_note.length >= 20).length === 0, list(bad(all, (r) => r.raw.cross_language_note.length >= 20)))

// ---- statuses, flags, anchors ------------------------------------------------------------
const flagOk = /^(verify:)?[a-zA-Z0-9_ñǎ-ǜāáàēéěèīíìōóòūúùü぀-ヿ㐀-鿿]+$/
// The AI first pass (2026-10-26) wrote plain-language notes such as 三途の川を渡る or 弔事表書き「志」(香典返し): one token, no spaces or separators.
const aiFlagOk = /^[^\s|,;]+$/
const flagsOf = (r: PaletteRow) => r.raw.taboo_flags.split('|').filter((f) => f && f !== 'none')
const flagTokenOk = (r: PaletteRow) => flagsOf(r).every((f) => (AI_PASS.test(r.raw.reviewed_by) ? aiFlagOk : flagOk).test(f))
check('flags: every taboo flag is one token (snake_case, or verify:… for anything uncertain; the AI first pass may use a plain-language note without spaces)', bad(all, flagTokenOk).length === 0, list(bad(all, flagTokenOk)))
const verifyRows = all.filter((r) => flagsOf(r).some((f) => f.startsWith('verify:')))
console.log(`INFO  ${verifyRows.length} rows carry a "verify:" flag (${verifyRows.filter((r) => r.language === 'ja').length} ja, ${verifyRows.filter((r) => r.language === 'zh').length} zh)`)
check('flags: uncertainty is flagged — a good share of rows carry verify:', verifyRows.length >= 40)
const okNotesOnly = (r: PaletteRow) => AI_PASS.test(r.raw.reviewed_by) || flagsOf(r).every((f) => f.startsWith('verify:'))
check('flags: a draft ok row carries no taboo other than verify: notes (the AI pass may annotate an ok row; the review call sees those notes, and blocked_occasions still apply)', bad(all.filter((r) => r.status === 'ok'), okNotesOnly).length === 0, list(bad(all.filter((r) => r.status === 'ok'), okNotesOnly)))
const concernOf = (r: PaletteRow) => [...flagsOf(r), ...r.register_flags]
check('flags: every hard_block and context_required row names its concern (a taboo flag, or a register flag such as 餞\'s farewell_register)', bad(all.filter((r) => r.status !== 'ok'), (r) => concernOf(r).length > 0).length === 0, list(bad(all.filter((r) => r.status !== 'ok'), (r) => concernOf(r).length > 0)))
check('hard_block: fits no relationship (relationship_fit = none), needs no anchor', bad(all.filter((r) => r.status === 'hard_block'), (r) => r.raw.relationship_fit === 'none' && !r.anchor_required).length === 0)
check('anchors: a row demands an anchor only if it is context_required', bad(all.filter((r) => r.anchor_required), (r) => r.status === 'context_required').length === 0)
check('anchors: every context_required row states anchor_required (yes or no)', bad(all.filter((r) => r.status === 'context_required'), (r) => ['yes', 'no'].includes(r.raw.anchor_required)).length === 0)
check('enums: inscription_fitness, relationship_fit and blocked_occasions use only the allowed codes', all.every((r) => (INSCRIPTION_FITNESS as readonly string[]).includes(r.raw.inscription_fitness) && r.raw.relationship_fit.split('|').every((c) => c === 'all' || c === 'none' || (RELATIONSHIPS as readonly string[]).includes(c)) && r.raw.blocked_occasions.split('|').every((c) => c === 'none' || (OCCASIONS as readonly string[]).includes(c))))
check('blocked_occasions: hard_block rows carry none (they are blocked everywhere already); the referee ENFORCES the column on every other row', bad(all.filter((r) => r.status === 'hard_block'), (r) => r.blocked_occasions.length === 0).length === 0, list(bad(all.filter((r) => r.status === 'hard_block'), (r) => r.blocked_occasions.length === 0)))
check('blocked_occasions: the farewell character 餞/饯 is not blocked at retirement_farewell, and 娃 not at new_baby', !palette.lookup('ja', '餞')?.blocked_occasions.includes('retirement_farewell') && !palette.lookup('zh', '饯')?.blocked_occasions.includes('retirement_farewell') && !palette.lookup('zh', '娃')?.blocked_occasions.includes('new_baby'))

// ---- coverage ----------------------------------------------------------------------------
const GOLDEN_JA = ['迎', '黙', '駅', '送', '厳', '愛']
check('coverage: the golden-fixture candidates all have a ja row', GOLDEN_JA.every((k) => palette.lookup('ja', k)), GOLDEN_JA.filter((k) => !palette.lookup('ja', k)).join(' '))
const CORE = ['父', '母', '子', '友', '師', '家', '恩', '孝', '縁', '灯', '花', '春', '月', '道', '笑', '歩', '守', '待', '育', '寿', '祝', '福']
const ZH_OF: Record<string, string> = { 縁: '缘', 歩: '步' } // the few core kanji written differently in zh
check('coverage: core relational characters exist in both languages', CORE.every((k) => palette.lookup('ja', k) && palette.lookup('zh', ZH_OF[k] ?? k)), CORE.filter((k) => !(palette.lookup('ja', k) && palette.lookup('zh', ZH_OF[k] ?? k))).join(' '))
const GROUPS: Record<string, string> = { people: '父母子孫兄弟夫妻友師', actions: '見守待帰育教支助', objects: '灯窓門橋舟車茶酒', places: '山川海村島', seasons: '春夏秋冬朝夕', virtues: '誠義礼智勇温暖', blessing: '寿祝福吉喜' }
check('coverage: people, actions, objects, places, seasons, virtues and blessings are all represented in ja', Object.values(GROUPS).every((g) => cp(g).every((k) => palette.lookup('ja', k))), Object.values(GROUPS).flatMap((g) => cp(g).filter((k) => !palette.lookup('ja', k))).join(' '))

// ---- known hazards must be blocked or contextual -----------------------------------------
const HAZARD_ZH: Record<string, string> = { 钟: 'hard_block', 绊: 'hard_block', 四: 'hard_block', 死: 'hard_block', 伞: 'context_required', 梨: 'context_required', 鬼: 'hard_block', 老: 'context_required', 无: 'context_required' }
check('hazards zh: 钟 绊 四 死 鬼 are blocked; 伞 梨 老 无 need context', Object.entries(HAZARD_ZH).every(([k, st]) => palette.lookup('zh', k)?.status === st), Object.entries(HAZARD_ZH).filter(([k, st]) => palette.lookup('zh', k)?.status !== st).join(' '))
const HAZARD_JA: Record<string, string> = { 菊: 'context_required', 蓮: 'context_required', 影: 'context_required', 亡: 'hard_block', 葬: 'hard_block', 墓: 'hard_block', 霊: 'hard_block', 四: 'hard_block' }
check('hazards ja: 亡 葬 墓 霊 四 are blocked; 菊 蓮 影 need context', Object.entries(HAZARD_JA).every(([k, st]) => palette.lookup('ja', k)?.status === st), Object.entries(HAZARD_JA).filter(([k, st]) => palette.lookup('ja', k)?.status !== st).join(' '))

// ---- the file itself ---------------------------------------------------------------------
const [header, ...body] = parseCsv(readFileSync(join(process.cwd(), 'engine', 'palette.csv'), 'utf8'))
check('file: header is the 17 spec columns and every row has exactly 17 cells', header.join(',') === PALETTE_COLUMNS.join(',') && body.every((r) => r.length === 17))
check('file: no duplicate (language, kanji) rows', new Set(body.map((r) => `${r[0]}:${r[1]}`)).size === body.length)

// ---- review exports ----------------------------------------------------------------------
let stale = ''
try { execFileSync('node', ['scripts/export-review.mjs', '--check'], { stdio: 'pipe' }) } catch (e) { stale = String((e as { stderr?: Buffer }).stderr ?? e) }
check('review files are up to date with engine/palette.csv (run node scripts/export-review.mjs)', stale === '', stale)
for (const [lang, rows] of [['ja', ja], ['zh', zh]] as const) {
  const [rh, ...rb] = parseCsv(readFileSync(join(process.cwd(), 'review', `palette_${lang}.csv`), 'utf8'))
  check(`review/palette_${lang}.csv: the 17 palette columns + memorial_default_block, memorial (block|ok) and reviewer_comment columns, one row per ${lang} palette row`, rh.join(',') === [...PALETTE_COLUMNS, 'memorial_default_block', 'memorial (block|ok)', 'reviewer_comment'].join(',') && rb.length === rows.length && rb.every((r) => r.length === 20 && r[18] === '' && r[19] === '' && r[0] === lang))
}

// ---- remembrance (occasion `memorial`) -------------------------------------------------------------
const [mbh, ...mbb] = parseCsv(readFileSync(join(process.cwd(), 'engine', 'memorial-block.csv'), 'utf8'))
check('memorial default block: the starter list (kanji,category,note) names celebration characters 祝 寿 喜 慶 賀 婚 and birth / new-beginning ones, each once', mbh.join(',') === 'kanji,category,note' && ['祝', '寿', '喜', '慶', '賀', '婚', '誕', '産', '始', '初', '新', '芽'].every((k) => mbb.some((r) => r[0] === k)) && new Set(mbb.map((r) => r[0])).size === mbb.length && mbb.every((r) => ['celebration', 'birth_beginning'].includes(r[1])))
check('memorial: `memorial` appears in review/review_codes.csv as a code reviewers may type in blocked_occasions', readFileSync(join(process.cwd(), 'review', 'review_codes.csv'), 'utf8').includes('blocked_occasions,memorial,'))
const [ph0, ...pb0] = parseCsv(readFileSync(join(process.cwd(), 'review', 'palette_ja.csv'), 'utf8'))
const MEMO_LIST = new Set(mbb.map((r) => r[0]))
const colDefault = ph0.indexOf('memorial_default_block')
const colVerdict = ph0.indexOf('memorial (block|ok)')
check('review sheets carry the memorial marking columns: memorial_default_block is filled exactly for characters on the default list, the verdict column is empty for the reviewer', colDefault > 0 && colVerdict > colDefault && pb0.every((r) => r[colVerdict] === '' && (r[colDefault] !== '') === (MEMO_LIST.has(r[1]) || MEMO_LIST.has(r[2]))))
check('review/memorial_default_block.csv lists the default block with keep_blocked and reviewer_comment columns for the reviewers', readFileSync(join(process.cwd(), 'review', 'memorial_default_block.csv'), 'utf8').startsWith('kanji,category,note,keep_blocked (yes|no),reviewer_comment'))

// ---- v6: the freestyle blocklist and the classical-echo review sheets -----------------------------
const [blh, ...blb] = parseCsv(readFileSync(join(process.cwd(), 'engine', 'freestyle-blocklist.csv'), 'utf8'))
check('freestyle blocklist: header language,kanji,category; every entry is ONE character in a known category; no duplicates', blh.join(',') === 'language,kanji,category' && blb.every((r) => r.length === 3 && [...r[1]].length === 1 && (FREESTYLE_CATEGORIES as readonly string[]).includes(r[2]) && ['ja', 'zh'].includes(r[0])) && new Set(blb.map((r) => `${r[0]}:${r[1]}`)).size === blb.length, `${blb.length} rows`)
check('freestyle blocklist: all nine categories are present in BOTH families (zh lists simplified and traditional forms)', FREESTYLE_CATEGORIES.every((c) => ['ja', 'zh'].every((f) => blb.some((r) => r[0] === f && r[2] === c))) && ['胖', '瘦', '穷', '窮', '蠢', '杀', '殺'].every((k) => blb.some((r) => r[0] === 'zh' && r[1] === k)))
check('freestyle blocklist: it leaves everyday playful characters alone (遅 笑 茶 酒 食 眠 / zh 迟 笑 茶 酒)', ['遅', '笑', '茶', '酒', '食', '眠'].every((k) => !blb.some((r) => r[0] === 'ja' && r[1] === k)) && ['迟', '遲', '笑', '茶', '酒'].every((k) => !blb.some((r) => r[0] === 'zh' && r[1] === k)))
for (const lang of ['ja', 'zh'] as const) {
  const [eh, ...eb] = parseCsv(readFileSync(join(process.cwd(), 'review', `classical_echo_${lang}.csv`), 'utf8'))
  const rows = palette.values().filter((r) => r.language === lang && !classicalEchoOf(r))
  check(`review/classical_echo_${lang}.csv: one row for every ${lang} palette row with no REVIEWED classical line (all of them today), with empty text/source/comment columns for the reviewer`, eh.includes('classical_text') && eh.includes('classical_source') && eh.includes('reviewer_comment') && eb.length === rows.length && eb.every((r) => r[eh.indexOf('classical_text')] === '' && r[eh.indexOf('classical_source')] === '' && r[eh.indexOf('reviewer_comment')] === ''), `${eb.length} vs ${rows.length}`)
}
check('classical echo: no shipped row is reviewed yet, so no classical line is shown anywhere (the model never writes one; the code only shows reviewed lines)', palette.values().every((r) => classicalEchoOf(r) === null))

// ---- v7: romaji, the English-meanings review sheet --------------------------------------------------
check('romaji: on-yomi (katakana) get macrons, kun-yomi (hiragana) are plain, okurigana hyphens vanish', kanaToRomaji('トウ') === 'tō' && kanaToRomaji('ショウ') === 'shō' && kanaToRomaji('キョウ') === 'kyō' && kanaToRomaji('ユウ') === 'yū' && kanaToRomaji('ひ') === 'hi' && kanaToRomaji('あか-り') === 'akari' && kanaToRomaji('ちち') === 'chichi' && kanaToRomaji('きずな') === 'kizuna' && kanaToRomaji('しゃ') === 'sha' && kanaToRomaji('じゅう') === 'juu' && romanizeReadings(['トウ', 'ひ', 'あか-り']) === 'tō · hi · akari' && romanizeReadings(['ひ', 'ヒ']) === 'hi')
const jaAll = palette.values().filter((r) => r.language === 'ja')
check('romaji: EVERY ja palette row romanises to Latin letters (and macrons) only — nothing blank or left in kana', jaAll.every((r) => /^[a-zāīūēō ·]+$/.test(romanizeReadings(r.readings))), jaAll.filter((r) => !/^[a-zāīūēō ·]+$/.test(romanizeReadings(r.readings))).map((r) => r.kanji).join(' '))
check('plain meanings: EVERY palette row yields a short plain-English phrase (1–4 words, no parentheses, no semicolons)', palette.values().every((r) => { const m = plainMeaning(r.raw.core_meanings, r.language); return m !== '' && m.split(' ').length <= 4 && !/[();]/.test(m) }), palette.values().filter((r) => { const m = plainMeaning(r.raw.core_meanings, r.language); return m === '' || m.split(' ').length > 4 || /[();]/.test(m) }).map((r) => `${r.kanji}:${plainMeaning(r.raw.core_meanings, r.language)}`).join(' | '))
const [mh, ...mb] = parseCsv(readFileSync(join(process.cwd(), 'review', 'palette_review_en_meanings.csv'), 'utf8'))
const shownJa = jaAll.filter((r) => r.status !== 'hard_block')
check('review/palette_review_en_meanings.csv: for a native English reviewer — kanji, ja reading, pinyin, current English meaning first, then extras and EMPTY suggested_meaning / reviewer_comment', mh.slice(0, 4).join() === 'kanji,ja_reading,pinyin,current_english_meaning' && mh.includes('suggested_meaning') && mh.includes('reviewer_comment') && mb.every((r) => r[mh.indexOf('suggested_meaning')] === '' && r[mh.indexOf('reviewer_comment')] === ''))
check('review/palette_review_en_meanings.csv: one row per ja palette row an English buyer can be shown (everything but hard_block), meaning = what the buyer sees, pinyin only where the zh palette has the character', mb.length === shownJa.length && mb.every((r) => { const row = palette.lookup('ja', r[0])!; const zh = palette.lookup('zh', r[0]) ?? (row.inscription_form ? palette.lookup('zh', row.inscription_form) : undefined); return r[3] === plainMeaning(row.raw.core_meanings, 'ja') && r[2] === (zh ? zh.readings.join('|') : '') && r[mh.indexOf('in_zh_palette')].startsWith(zh ? 'yes' : 'no') }))
check('review sheet: 駅 (ja only) is flagged "no" for the zh palette (not offered as a main to English buyers); 灯 has pinyin dēng', (() => { const r = (k: string) => mb.find((x) => x[0] === k); return r('駅')?.[mh.indexOf('in_zh_palette')].startsWith('no') === true && r('灯')?.[2] === 'dēng' && r('灯')?.[3] === 'lamp' })())
check('review sheet: hard_block characters never reach an English buyer, so they are not on it (送 is absent)', !mb.some((r) => r[0] === '送'))

console.log(failures === 0 ? '\nAll palette data checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
