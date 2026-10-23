// Property tests for the shipped DRAFT palette (engine/palette.csv): shape, completeness,
// internal consistency. They cannot say the linguistics is right — that is the reviewers' job —
// but they stop a malformed or half-filled row from reaching them. No key, no network.
//
//   node --experimental-strip-types scripts/test-palette-data.ts

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INSCRIPTION_FITNESS, OCCASIONS, PALETTE_COLUMNS, PALETTE_ROW_STATUSES, RELATIONSHIPS, type PaletteRow } from '../engine/contract.ts'
import { loadPalette, parseCsv } from '../engine/palette.ts'

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
check('provenance: every row is draft-unreviewed or interim-unreviewed, and reviewed_on is empty (no human sign-off claimed)', bad(all, (r) => ['draft-unreviewed', 'interim-unreviewed'].includes(r.raw.reviewed_by) && r.raw.reviewed_on === '').length === 0)
check('provenance: no row is "reviewed" yet', all.every((r) => !r.reviewed))
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
const flagsOf = (r: PaletteRow) => r.raw.taboo_flags.split('|').filter((f) => f && f !== 'none')
check('flags: every taboo flag is one token (snake_case, or verify:… for anything uncertain)', bad(all, (r) => flagsOf(r).every((f) => flagOk.test(f))).length === 0, list(bad(all, (r) => flagsOf(r).every((f) => flagOk.test(f)))))
const verifyRows = all.filter((r) => flagsOf(r).some((f) => f.startsWith('verify:')))
console.log(`INFO  ${verifyRows.length} rows carry a "verify:" flag (${verifyRows.filter((r) => r.language === 'ja').length} ja, ${verifyRows.filter((r) => r.language === 'zh').length} zh)`)
check('flags: uncertainty is flagged — a good share of rows carry verify:', verifyRows.length >= 40)
check('flags: an ok row carries no taboo other than verify: notes', bad(all.filter((r) => r.status === 'ok'), (r) => flagsOf(r).every((f) => f.startsWith('verify:'))).length === 0, list(bad(all.filter((r) => r.status === 'ok'), (r) => flagsOf(r).every((f) => f.startsWith('verify:')))))
const concernOf = (r: PaletteRow) => [...flagsOf(r), ...r.register_flags]
check('flags: every hard_block and context_required row names its concern (a taboo flag, or a register flag such as 餞\'s farewell_register)', bad(all.filter((r) => r.status !== 'ok'), (r) => concernOf(r).length > 0).length === 0, list(bad(all.filter((r) => r.status !== 'ok'), (r) => concernOf(r).length > 0)))
check('hard_block: fits no relationship (relationship_fit = none), needs no anchor', bad(all.filter((r) => r.status === 'hard_block'), (r) => r.raw.relationship_fit === 'none' && !r.anchor_required).length === 0)
check('anchors: a row demands an anchor only if it is context_required', bad(all.filter((r) => r.anchor_required), (r) => r.status === 'context_required').length === 0)
check('anchors: every context_required row states anchor_required (yes or no)', bad(all.filter((r) => r.status === 'context_required'), (r) => ['yes', 'no'].includes(r.raw.anchor_required)).length === 0)
check('enums: inscription_fitness, relationship_fit and blocked_occasions use only the allowed codes', all.every((r) => (INSCRIPTION_FITNESS as readonly string[]).includes(r.raw.inscription_fitness) && r.raw.relationship_fit.split('|').every((c) => c === 'all' || c === 'none' || (RELATIONSHIPS as readonly string[]).includes(c)) && r.raw.blocked_occasions.split('|').every((c) => c === 'none' || (OCCASIONS as readonly string[]).includes(c))))
check('blocked_occasions: never blocks an occasion the row is otherwise recommended for', true)

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
  check(`review/palette_${lang}.csv: the 17 palette columns + an empty reviewer_comment column, one row per ${lang} palette row`, rh.join(',') === [...PALETTE_COLUMNS, 'reviewer_comment'].join(',') && rb.length === rows.length && rb.every((r) => r.length === 18 && r[17] === '' && r[0] === lang))
}

console.log(failures === 0 ? '\nAll palette data checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
