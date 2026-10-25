// Palette referee tests — engine/palette.csv + engine/palette.ts. No key, no network.
//
//   node --experimental-strip-types scripts/test-palette.ts

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HARD_BLOCK_REASON,
  anchorPresent,
  applyPalette,
  loadPalette,
  parseCsv,
  plainMeaning,
  refereeFamilies,
  parsePalette,
} from '../engine/palette.ts'
import { romanizeReadings } from '../engine/romaji.ts'
import { PALETTE_COLUMNS, validateEngineResult, type Candidate, type EngineResult } from '../engine/contract.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}

const GOLDEN: EngineResult = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const STORY =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

// ---------------------------------------------------------------------------
// 1. The shipped interim palette.
// ---------------------------------------------------------------------------
const palette = loadPalette()
const HARD = ['送', '終', '別', '離', '切', '去', '散', '衰', '老', '死', '苦', '錆', '消', '弱', '病', '無']
const jaRows = palette.values().filter((r) => r.language === 'ja')
const zhRows = palette.values().filter((r) => r.language === 'zh')
const interim = (rows: typeof jaRows) => rows.filter((r) => r.raw.reviewed_by === 'interim-unreviewed')

// The interim rows from the first referee version are kept exactly: same status, flags, anchors.
check('interim ja rows kept: the 16 hard_block kanji are still hard_block', HARD.every((k) => palette.lookup('ja', k)?.status === 'hard_block'))
check('interim ja rows kept: 迎 and 餞 are context_required with anchor_required=yes', ['迎', '餞'].every((k) => { const r = palette.lookup('ja', k); return r?.status === 'context_required' && r.anchor_required === true }))
check('interim ja rows kept: exactly those 18 rows are still marked interim-unreviewed', interim(jaRows).map((r) => r.kanji).sort().join('') === [...HARD, '迎', '餞'].sort().join(''))
check('interim ja rows kept: 送 still carries funeral_connotation + parting', ['funeral_connotation', 'parting'].every((f) => palette.lookup('ja', '送')?.taboo_flags.includes(f)))
const ZH_TRAD = ['死', '終', '喪', '散', '離', '斷', '病', '苦', '四']
const ZH_SIMP = ['死', '终', '丧', '散', '离', '断', '病', '苦', '四']
check('interim zh rows kept: the 9 requested kanji are hard_block, found by TRADITIONAL form', ZH_TRAD.every((k) => palette.lookup('zh', k)?.status === 'hard_block'))
check('interim zh rows kept: …and by SIMPLIFIED form — one row serves both scripts', ZH_SIMP.every((k) => palette.lookup('zh', k)?.status === 'hard_block') && palette.lookup('zh', '终') === palette.lookup('zh', '終'))
check('interim zh rows kept: exactly 9 rows (no duplicate simplified rows any more) are interim-unreviewed', interim(zhRows).length === 9 && interim(zhRows).map((r) => r.kanji).sort().join('') === [...ZH_SIMP].sort().join(''))
check('interim zh rows kept: 四 is still flagged as a 死 homophone', palette.lookup('zh', '四')?.taboo_flags.includes('homophone_death') === true)
check('palette: 17 columns in the spec order', readFileSync('engine/palette.csv', 'utf8').split('\n')[0] === PALETTE_COLUMNS.join(','))

// ---------------------------------------------------------------------------
// 2. CSV parsing and validation (a malformed palette must throw, not be skipped).
// ---------------------------------------------------------------------------
const HEADER = PALETTE_COLUMNS.join(',')
const rowCsv = (cells: Partial<Record<(typeof PALETTE_COLUMNS)[number], string>>) =>
  PALETTE_COLUMNS.map((c) => cells[c] ?? '').join(',')
const throws = (fn: () => unknown) => { try { fn(); return '' } catch (e) { return (e as Error).message } }

const q = parseCsv('a,"b,c","d ""e""",f\r\n\r\n1,2,3,4\n')
check('csv: quoted commas, "" escapes, CRLF, blank lines', JSON.stringify(q) === JSON.stringify([['a', 'b,c', 'd "e"', 'f'], ['1', '2', '3', '4']]), JSON.stringify(q))
check('csv: unterminated quote throws', throws(() => parseCsv('a,"b')).includes('unterminated'))
const quoted = parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '禍', status: 'hard_block', taboo_flags: '"x|y"', core_meanings: '"misfortune, calamity"' })}\n`)
check('csv: a row with a comma inside a quoted cell parses to one palette row', quoted.size === 1 && quoted.lookup('ja', '禍')?.raw.core_meanings === 'misfortune, calamity' && quoted.lookup('ja', '禍')?.taboo_flags.join() === 'x,y')
check('csv: wrong header throws', throws(() => parsePalette('language,kanji\n')).includes('header'))
check('csv: wrong column count throws', throws(() => parsePalette(`${HEADER}\nja,送,hard_block\n`)).includes('columns'))
check('csv: unknown status throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '送', status: 'blocked' })}\n`)).includes('invalid status'))
check('csv: unknown language throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'en', kanji: '送', status: 'ok' })}\n`)).includes('invalid language'))
check('csv: bad anchor_required throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '迎', status: 'ok', anchor_required: 'maybe' })}\n`)).includes('anchor_required'))
check('csv: duplicate (language, kanji) throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '送', status: 'ok' })}\n${rowCsv({ language: 'ja', kanji: '送', status: 'hard_block' })}\n`)).includes('duplicate'))
check('csv: header-only palette is valid and empty', parsePalette(`${HEADER}\n`).size === 0)

check('csv: "none" is the explicit empty marker in list columns (not a flag called none)', (() => { const r = parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '花', status: 'ok', taboo_flags: 'none', blocked_occasions: 'none', register_flags: 'none' })}\n`).lookup('ja', '花'); return r !== undefined && r.taboo_flags.length === 0 && r.blocked_occasions.length === 0 && r.register_flags.length === 0 })())
check('csv: unknown occasion code in blocked_occasions throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '花', status: 'ok', blocked_occasions: 'birthday' })}\n`)).includes('blocked_occasions'))
check('csv: unknown relationship code in relationship_fit throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '花', status: 'ok', relationship_fit: 'father' })}\n`)).includes('relationship_fit'))
check('csv: inscription_fitness must be high | medium | low', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '花', status: 'ok', inscription_fitness: 'great' })}\n`)).includes('inscription_fitness'))
check('csv: a bare "zh" language row is valid; zh-Hans / zh-Hant are NOT palette languages (one row serves both scripts)', parsePalette(`${HEADER}\n${rowCsv({ language: 'zh', kanji: '灯', inscription_form: '燈', status: 'ok' })}\n`).size === 1 && throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'zh-Hans', kanji: '灯', status: 'ok' })}\n`)).includes('invalid language'))
const alias = parsePalette(`${HEADER}\n${rowCsv({ language: 'zh', kanji: '灯', inscription_form: '燈', status: 'ok' })}\n`)
check('palette: a zh row is found by its simplified `kanji` AND its traditional `inscription_form`', alias.lookup('zh', '灯') === alias.lookup('zh', '燈') && alias.lookup('zh', '灯') !== undefined && alias.size === 1)
check('palette: a form belonging to another row is rejected (ambiguous alias)', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'zh', kanji: '灯', inscription_form: '燈', status: 'ok' })}\n${rowCsv({ language: 'zh', kanji: '燈', status: 'ok' })}\n`)).includes('already belongs'))
check('palette: lookups are family-scoped (a zh row is not found as ja)', alias.lookup('ja', '灯') === undefined)

process.env.ICHIREI_PALETTE_PATH = join(tmpdir(), 'ichirei-no-such-palette.csv')
check('loadPalette: a missing file throws (the blocklist is never silently skipped)', throws(() => loadPalette()).includes('not found'))
const dir = mkdtempSync(join(tmpdir(), 'ichirei-palette-'))
writeFileSync(join(dir, 'p.csv'), `${HEADER}\n${rowCsv({ language: 'ja', kanji: '禍', status: 'hard_block' })}\n`)
process.env.ICHIREI_PALETTE_PATH = join(dir, 'p.csv')
check('loadPalette: ICHIREI_PALETTE_PATH override is honoured', loadPalette().size === 1)
delete process.env.ICHIREI_PALETTE_PATH

// ---------------------------------------------------------------------------
// 3. Helpers to build raw model results.
// ---------------------------------------------------------------------------
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
function cand(kanji: string, over: Partial<Candidate> = {}): Candidate {
  return {
    slot: 'main', kanji, reading: 'よみ', inscription_form: null, truth_type: 'Essence', one_line_gaze: 'g', story_anchor: '駅まで迎えに来て',
    unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [], ...over,
  } as Candidate
}
/**
 * A raw model result from a list of candidates. Slots are assigned unless a candidate is a freestyle: the one named
 * by `runner_up_kanji` (default: the first non-primary candidate) is `second`; every other candidate is an inert extra
 * `main` — the referee only ever looks at the primary and the second slot.
 */
function raw(candidates: Candidate[], primary: string | null, over: Partial<EngineResult> = {}): EngineResult {
  const runnerUp = over.runner_up_kanji !== undefined ? over.runner_up_kanji : (candidates.find((c) => c.kanji !== primary && c.slot !== 'freestyle')?.kanji ?? null)
  const slotted = candidates.map((c) => (c.slot === 'freestyle' ? c : { ...c, slot: c.kanji === runnerUp && c.kanji !== primary ? ('second' as const) : ('main' as const) }))
  return { ...clone(GOLDEN), runner_up_kanji: runnerUp, freestyle_kanji: null, candidates: slotted, primary_kanji: primary, ...over } as EngineResult
}
const kanjis = (r: EngineResult) => r.candidates.map((c) => c.kanji).join('')
const get = (r: EngineResult, k: string) => r.candidates.find((c) => c.kanji === k)!
const run = (r: EngineResult, story = STORY) => applyPalette(r, palette, story)

// ---------------------------------------------------------------------------
// 4. Rule 1: hard_block candidates are eliminated with reason "palette: hard_block".
// ---------------------------------------------------------------------------
for (const k of HARD) {
  const out = run(raw([cand('黙'), cand(k), cand('灯')], '黙'))
  const c = get(out, k)
  if (!(c.eliminated === true && c.eliminated_reason === HARD_BLOCK_REASON && c.palette_status === 'off_palette' && c.flags.includes('palette_hard_block'))) {
    check(`hard_block ${k}: eliminated with reason "palette: hard_block", off_palette, flagged`, false, JSON.stringify(c))
  }
}
check('hard_block: all 16 kanji are eliminated with the exact reason "palette: hard_block" (and off_palette + palette_hard_block flag)', HARD.every((k) => { const c = get(run(raw([cand('黙'), cand(k)], '黙')), k); return c.eliminated && c.eliminated_reason === 'palette: hard_block' && c.palette_status === 'off_palette' && c.flags.includes('palette_hard_block') }))

const survivor = run(raw([cand('黙'), cand('送', { flags: ['funeral_connotation'] }), cand('灯')], '黙'))
check('hard_block: the candidate stays in the array (moved to eliminated, not deleted)', kanjis(survivor) === '黙送灯')
check('hard_block: the row\'s taboo flags are merged in without duplicates', get(survivor, '送').flags.filter((f) => f === 'funeral_connotation').length === 1 && get(survivor, '送').flags.includes('parting'))
check('hard_block: other candidates and a surviving primary are untouched', get(survivor, '黙').eliminated === false && get(survivor, '灯').eliminated === false && survivor.primary_kanji === '黙' && survivor.referee?.primary_changed === false)
check('hard_block: the action is recorded in referee.actions', survivor.referee?.actions.some((a) => a.kanji === '送' && a.action === 'hard_block_eliminated') === true)

const already = run(raw([cand('黙'), cand('送', { eliminated: true, eliminated_reason: 'ゲート3：葬送の連想' })], '黙'))
check('hard_block: a candidate the model already eliminated keeps the model\'s reason (still recorded)', get(already, '送').eliminated_reason === 'ゲート3：葬送の連想' && already.referee?.actions[0]?.action === 'hard_block_already_eliminated')

const viaOldForm = run(raw([cand('黙'), cand('X', { inscription_form: '送' })], '黙'))
check('hard_block: matches on the inscription form (inscription_form) too', get(viaOldForm, 'X').eliminated === true)

const zh = run(raw([cand('送'), cand('灯')], '灯', { language: 'zh-Hant' }))
check('hard_block: language-scoped — the ja hard_block on 送 does not eliminate it in a zh result (the zh row is context_required)', get(zh, '送').eliminated === false && get(zh, '送').palette_status === 'context_required' && zh.referee?.actions.length === 0)

// ---------------------------------------------------------------------------
// 5. Promotion when the primary is removed: slot 2 (`second`) — nothing else, never the freestyle.
// ---------------------------------------------------------------------------
const removed = run(raw([cand('黙'), cand('送'), cand('灯')], '送', { runner_up_kanji: '黙' }))
check('promote: hard-blocked primary → the SECOND slot (黙) becomes primary, promoted_from "second"', removed.primary_kanji === '黙' && removed.referee?.primary_changed === true && removed.referee.original_primary === '送' && removed.referee.promoted_from === 'second')
check('promote: the result still validates its primary (a live candidate, not the freestyle)', validateEngineResult({ ...removed, candidates: removed.candidates }).filter((p) => p.includes('primary')).length === 0)
const notNext = run(raw([cand('黙'), cand('送'), cand('灯')], '送', { runner_up_kanji: '灯' }))
check('promote: slot 2 is used even when another candidate comes first in array order (order is irrelevant now)', notNext.primary_kanji === '灯')
const skipping = run(raw([cand('送'), cand('愛', { eliminated: true, eliminated_reason: 'g1' }), cand('終'), cand('菊', { flags: ['no_heart_anchor'] }), cand('迎', { story_anchor: '' }), cand('灯')], '送', { runner_up_kanji: '灯' }))
check('promote: the second slot is promoted even though other candidates were eliminated, blocked, unanchored or anchorless', skipping.primary_kanji === '灯', String(skipping.primary_kanji))
const noBackup = run(raw([cand('黙'), cand('送'), cand('灯')], '送', { runner_up_kanji: null }))
check('promote: no second slot (or none eligible) → NOT array order any more: the result becomes insufficient', noBackup.status === 'insufficient' && noBackup.primary_kanji === null && noBackup.referee?.no_eligible_primary === true)
const secondBlocked = run(raw([cand('黙'), cand('送'), cand('終')], '送', { runner_up_kanji: '終' }))
check('promote: a hard-blocked second slot cannot be promoted → insufficient', secondBlocked.status === 'insufficient')
const secondAnchorless = run(raw([cand('送'), cand('迎', { story_anchor: '' })], '送', { runner_up_kanji: '迎' }))
check('promote: an anchorless context_required second slot is skipped (and flagged) → insufficient', secondAnchorless.status === 'insufficient' && secondAnchorless.referee?.actions.some((a) => a.kanji === '迎' && a.action === 'primary_refused_no_anchor') === true)
check('promote: an insufficient-by-referee result carries the model\'s fallback question, no candidates and no primary, and validates', secondBlocked.follow_up_question === GOLDEN.fallback_follow_up_question && secondBlocked.candidates.length === 0 && secondBlocked.freestyle_kanji === null && validateEngineResult(secondBlocked).length === 0, validateEngineResult(secondBlocked).join('; '))
const withFree = run(raw([cand('送'), cand('終'), cand('遅', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて' })], '送', { runner_up_kanji: '終' }))
check('promote: the FREESTYLE is never promoted — with both main slots gone the result is insufficient even though a freestyle survived', withFree.status === 'insufficient' && withFree.primary_kanji === null && withFree.freestyle_kanji === null)

// ---------------------------------------------------------------------------
// 4b. Draft (unreviewed) `ok` rows do not vouch; reviewed ones do. Cautious rows always apply.
// ---------------------------------------------------------------------------
const mini = (reviewedBy: string) => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '灯', inscription_form: '燈', status: 'ok', taboo_flags: 'verify:x', reviewed_by: reviewedBy })}\n${rowCsv({ language: 'ja', kanji: '冬', status: 'context_required', taboo_flags: 'cold', reviewed_by: 'draft-unreviewed' })}\n`)
const drafted = applyPalette(raw([cand('灯', { palette_status: 'off_palette', flags: ['model_doubt'] }), cand('冬', { palette_status: 'ok' })], '灯'), mini('draft-unreviewed'), STORY)
check('draft ok row: the model\'s own palette_status and flags are left alone (an unreviewed draft does not vouch)', get(drafted, '灯').palette_status === 'off_palette' && get(drafted, '灯').flags.join() === 'model_doubt')
check('draft context_required row: still applied (cautious rows apply even unreviewed)', get(drafted, '冬').palette_status === 'context_required' && get(drafted, '冬').flags.includes('cold'))
const signed = applyPalette(raw([cand('灯', { palette_status: 'off_palette' })], '灯'), mini('Reviewer Name'), STORY)
check('reviewed ok row: overwrites the model\'s palette_status with ok and merges the flags', get(signed, '灯').palette_status === 'ok' && get(signed, '灯').flags.includes('verify:x'))
const shipped = applyPalette(raw([cand('愛', { palette_status: 'off_palette' }), cand('黙')], '黙'), palette, STORY)
check('shipped draft palette: no draft ok row overwrites the model (nothing is reviewed yet)', get(shipped, '愛').palette_status === 'off_palette' && shipped.referee?.actions.length === 0)

// ---------------------------------------------------------------------------
// 5b. The runner-up that ships is the second slot, while it is still a valid backup.
// ---------------------------------------------------------------------------
const ru1 = run(raw([cand('黙'), cand('送'), cand('灯'), cand('駅')], '送', { runner_up_kanji: '駅' }))
check('runner-up: a removed primary is replaced by the second slot (駅), NOT by another candidate', ru1.primary_kanji === '駅' && ru1.referee?.promoted_from === 'second')
check('runner-up: once promoted it is consumed (runner_up_kanji becomes null)', ru1.runner_up_kanji === null)
const ru2 = run(raw([cand('黙'), cand('餞', { story_anchor: '毎朝お弁当を作った' }), cand('灯'), cand('駅')], '餞', { runner_up_kanji: '駅' }))
check('runner-up: an anchorless context_required primary is replaced by the second slot too', ru2.primary_kanji === '駅' && ru2.referee?.promoted_from === 'second')
const ru3 = run(raw([cand('黙'), cand('灯'), cand('終')], '黙', { runner_up_kanji: '終' }))
check('runner-up: a hard-blocked second slot is cleared (runner_up_kanji null) even though the primary stands', ru3.primary_kanji === '黙' && ru3.runner_up_kanji === null)
const ru4 = run(raw([cand('黙'), cand('灯'), cand('駅')], '黙', { runner_up_kanji: '駅' }))
check('runner-up: a valid second slot is kept as the backup', ru4.runner_up_kanji === '駅' && ru4.primary_kanji === '黙')

// ---------------------------------------------------------------------------
// 5b2. blocked_occasions: a row listing THIS order's occasion is removed from the candidates.
// ---------------------------------------------------------------------------
import { BLOCKED_OCCASION_REASON } from '../engine/palette.ts'
const blockPal = parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '寿', status: 'ok', blocked_occasions: 'new_baby|school_career' })}\n${rowCsv({ language: 'ja', kanji: '冬', status: 'context_required', anchor_required: 'no', blocked_occasions: 'birthday_milestone' })}\n${rowCsv({ language: 'ja', kanji: '送', status: 'hard_block', blocked_occasions: 'wedding' })}\n`)
const at = (occasion: EngineResult['occasion'], cands: Candidate[], primary: string | null, over: Partial<EngineResult> = {}) =>
  applyPalette(raw(cands, primary, { occasion, ...over }), blockPal, STORY)
const nb = at('new_baby', [cand('黙'), cand('寿'), cand('灯')], '黙')
check('blocked_occasion: a row listing the order\'s occasion is eliminated with reason "palette: blocked_occasion"', get(nb, '寿').eliminated === true && get(nb, '寿').eliminated_reason === BLOCKED_OCCASION_REASON && BLOCKED_OCCASION_REASON === 'palette: blocked_occasion')
check('blocked_occasion: marked off_palette + palette_blocked_occasion flag; recorded in referee.actions; stays in the array', get(nb, '寿').palette_status === 'off_palette' && get(nb, '寿').flags.includes('palette_blocked_occasion') && nb.referee?.actions.some((a) => a.kanji === '寿' && a.action === 'blocked_occasion_eliminated') === true && nb.candidates.length === 3)
check('blocked_occasion: the same row is untouched at an occasion it does not list', at('birthday_milestone', [cand('黙'), cand('寿')], '黙').candidates.every((c) => !c.eliminated))
check('blocked_occasion: an order with NO occasion blocks nothing', at(null, [cand('黙'), cand('寿'), cand('冬')], '黙').candidates.every((c) => !c.eliminated))
check('blocked_occasion: applies to an unreviewed ok row too (blocking is the cautious direction)', get(at('school_career', [cand('黙'), cand('寿', { palette_status: 'ok' })], '黙'), '寿').eliminated === true)
check('blocked_occasion: applies to a context_required row as well', get(at('birthday_milestone', [cand('黙'), cand('冬')], '黙'), '冬').eliminated === true)
check('blocked_occasion: each listed occasion is honoured (new_baby and school_career for 寿)', ['new_baby', 'school_career'].every((o) => get(at(o as EngineResult['occasion'], [cand('黙'), cand('寿')], '黙'), '寿').eliminated))
const mdl = at('new_baby', [cand('黙'), cand('寿', { eliminated: true, eliminated_reason: 'ゲート1' })], '黙')
check('blocked_occasion: a candidate the model already eliminated keeps the model\'s reason (still recorded)', get(mdl, '寿').eliminated_reason === 'ゲート1' && mdl.referee?.actions[0]?.action === 'blocked_occasion_already_eliminated')
const hbo = at('wedding', [cand('黙'), cand('送')], '黙')
check('blocked_occasion: a hard_block row stays a plain hard_block (reason palette: hard_block)', get(hbo, '送').eliminated_reason === 'palette: hard_block' && hbo.referee?.actions.length === 1 && hbo.referee.actions[0].action === 'hard_block_eliminated')
const bp = at('new_baby', [cand('寿'), cand('黙'), cand('灯')], '寿', { runner_up_kanji: '灯' })
check('blocked_occasion: a blocked PRIMARY is replaced by the second slot', bp.primary_kanji === '灯' && bp.referee?.original_primary === '寿' && bp.referee.promoted_from === 'second')
const bp2 = at('new_baby', [cand('寿'), cand('黙'), cand('灯')], '寿', { runner_up_kanji: null })
check('blocked_occasion: …and with no second slot the result is insufficient (no array-order fallback)', bp2.status === 'insufficient' && bp2.follow_up_question === GOLDEN.fallback_follow_up_question)
const br = at('new_baby', [cand('黙'), cand('寿'), cand('灯')], '黙', { runner_up_kanji: '寿' })
check('blocked_occasion: a runner-up blocked at this occasion is cleared even though the primary stands', br.primary_kanji === '黙' && br.runner_up_kanji === null)
const bn = at('new_baby', [cand('寿')], '寿')
check('blocked_occasion: if the blocked one was the only candidate, nothing eligible remains → insufficient', bn.status === 'insufficient' && bn.primary_kanji === null && bn.referee?.no_eligible_primary === true)
const shippedNb = applyPalette(raw([cand('黙'), cand('寿'), cand('娃'), cand('饯')], '黙', { occasion: 'new_baby', language: 'zh-Hant' }), palette, STORY)
check('blocked_occasion (shipped palette, zh new_baby): 寿 is removed; 娃 (baby) is kept', get(shippedNb, '寿').eliminated === true && get(shippedNb, '娃').eliminated === false)
const shippedRf = applyPalette(raw([cand('黙'), cand('餞', { story_anchor: '駅まで送ってくれて' }), cand('夕')], '餞', { occasion: 'retirement_farewell' }), palette, STORY)
check('blocked_occasion (shipped palette, ja retirement_farewell): 餞 is NOT blocked (it is the farewell character); 夕 is', get(shippedRf, '餞').eliminated === false && shippedRf.primary_kanji === '餞' && get(shippedRf, '夕').eliminated === true)
const wed = (lang: 'ja' | 'zh-Hant', k: string) => applyPalette(raw([cand('黙'), cand(k)], '黙', { occasion: 'wedding', language: lang }), palette, STORY)
check('blocked_occasion (shipped palette, wedding): ja 蓮 is blocked, zh 莲 is not', get(wed('ja', '蓮'), '蓮').eliminated === true && get(wed('zh-Hant', '莲'), '莲').eliminated === false)

// ---------------------------------------------------------------------------
// 5c. zh rows: traditional (inscription) forms, with simplified display forms.
// ---------------------------------------------------------------------------
const zhRaw = (cs: Candidate[], primary: string | null, over: Partial<EngineResult> = {}) => raw(cs, primary, { language: 'zh-Hant', ...over })
for (const k of ZH_TRAD) {
  const out = run(zhRaw([cand('燈'), cand(k)], '燈'))
  if (!(get(out, k).eliminated && get(out, k).eliminated_reason === HARD_BLOCK_REASON && get(out, k).palette_status === 'off_palette')) check(`zh hard_block ${k}`, false, JSON.stringify(get(out, k)))
}
check('zh hard_block: 死 終 喪 散 離 斷 病 苦 四 are each eliminated with "palette: hard_block"', ZH_TRAD.every((k) => { const c = get(run(zhRaw([cand('燈'), cand(k)], '燈')), k); return c.eliminated && c.eliminated_reason === 'palette: hard_block' }))
const zhSimp = run(zhRaw([cand('灯'), cand('终', { inscription_form: '終' }), cand('离', { inscription_form: '離' })], '灯'))
check('zh hard_block: display form 终 with traditional form 終 is caught', get(zhSimp, '终').eliminated && get(zhSimp, '离').eliminated)
const zhNullTrad = run(zhRaw([cand('灯'), cand('断', { inscription_form: null }), cand('丧', { inscription_form: null })], '灯'))
check('zh hard_block: a simplified form whose traditional form was left null is still caught', get(zhNullTrad, '断').eliminated && get(zhNullTrad, '丧').eliminated)
const zhViaTrad = run(zhRaw([cand('灯'), cand('X', { inscription_form: '斷' })], '灯'))
check('zh hard_block: matched through inscription_form (the traditional form) alone', get(zhViaTrad, 'X').eliminated)
const zhPrimary = run(zhRaw([cand('灯'), cand('四'), cand('暖')], '四', { runner_up_kanji: '暖' }))
check('zh hard_block: a blocked primary (四) is replaced by the runner-up', zhPrimary.primary_kanji === '暖' && get(zhPrimary, '四').eliminated)
const jaVsZh = run(raw([cand('黙'), cand('终'), cand('灯')], '黙'))
check('zh rows do not leak into a ja result (终 is not a ja row)', get(jaVsZh, '终').eliminated === false)
const zhNoJa = run(zhRaw([cand('灯'), cand('迎', { story_anchor: '' })], '迎'))
check('ja rows do not leak into a zh result (迎 anchor rule is ja only)', zhNoJa.primary_kanji === '迎')

// ---------------------------------------------------------------------------
// 6. Rule 2: a context_required kanji is primary only with its anchor line.
// ---------------------------------------------------------------------------
const noAnchor = run(raw([cand('黙'), cand('餞', { story_anchor: '' }), cand('灯')], '餞'))
check('anchor: 餞 primary with an empty story_anchor is refused → the second slot (黙) is promoted', noAnchor.primary_kanji === '黙' && noAnchor.referee?.primary_changed === true)
check('anchor: the refused 餞 is NOT eliminated (it only loses primary) and is flagged palette_anchor_missing', get(noAnchor, '餞').eliminated === false && get(noAnchor, '餞').flags.includes('palette_anchor_missing') && noAnchor.referee?.actions.some((a) => a.kanji === '餞' && a.action === 'primary_refused_no_anchor') === true)
check('anchor: 餞 keeps its palette verdict (context_required) and the row\'s register flag', get(noAnchor, '餞').palette_status === 'context_required' && get(noAnchor, '餞').flags.includes('farewell_register'))

const withAnchor = run(raw([cand('黙'), cand('餞', { story_anchor: '駅まで送ってくれて' }), cand('灯')], '餞'))
check('anchor: 餞 primary WITH a verbatim story anchor stays primary', withAnchor.primary_kanji === '餞' && withAnchor.referee?.primary_changed === false)
const withAnchor迎 = run(raw([cand('迎', { story_anchor: '盆に帰るたびに車で駅まで迎えに来て' }), cand('黙')], '迎'))
check('anchor: 迎 with a verbatim anchor stays primary (the golden case)', withAnchor迎.primary_kanji === '迎')
const invented = run(raw([cand('餞', { story_anchor: '毎朝お弁当を作ってくれた' }), cand('黙')], '餞'))
check('anchor: an anchor that is not in the story (invented/paraphrased) does not count', invented.primary_kanji === '黙')
const ellipsis = run(raw([cand('迎', { story_anchor: '駅まで迎えに来て…帰りも必ず送ってくれる' }), cand('黙')], '迎'))
check('anchor: "…" joins verbatim pieces — each piece must be in the story', ellipsis.primary_kanji === '迎')
const badEllipsis = run(raw([cand('迎', { story_anchor: '駅まで迎えに来て…母は泣いた' }), cand('黙')], '迎'))
check('anchor: one invented piece after "…" makes the anchor fail', badEllipsis.primary_kanji === '黙')
check('anchorPresent: whitespace ignored; whitespace-only / non-string / missing → false', anchorPresent({ story_anchor: '駅まで 迎えに来て' }, STORY) && !anchorPresent({ story_anchor: '   ' }, STORY) && !anchorPresent({ story_anchor: undefined as unknown as string }, STORY))

const notPrimary = run(raw([cand('黙'), cand('餞', { story_anchor: '' }), cand('灯')], '黙'))
check('anchor: an anchorless context_required kanji that is NOT the primary is left alone (no promotion, no flag)', notPrimary.primary_kanji === '黙' && !get(notPrimary, '餞').flags.includes('palette_anchor_missing') && notPrimary.referee?.actions.length === 0)
const ctxOnlyOk = run(raw([cand('迎', { story_anchor: '' }), cand('黙')], '黙'))
check('anchor: context_required rows set palette_status from the palette, overriding the model', get(ctxOnlyOk, '迎').palette_status === 'context_required' && get(ctxOnlyOk, '迎').flags.includes('okaeri_death_euphemism'))

// ---------------------------------------------------------------------------
// 7. Pass-through and purity.
// ---------------------------------------------------------------------------
const insufficient: EngineResult = { ...clone(GOLDEN), status: 'insufficient', follow_up_question: '？', candidates: [], primary_kanji: null, particulars: [] }
check('passthrough: an insufficient result is returned untouched (no referee block)', run(insufficient) === insufficient && insufficient.referee === undefined)
const input = raw([cand('黙'), cand('送'), cand('灯')], '送')
const frozen = JSON.stringify(input)
run(input)
check('purity: applyPalette does not mutate its input', JSON.stringify(input) === frozen)
const empty = applyPalette(raw([cand('送'), cand('迎', { story_anchor: '' })], '送'), parsePalette(`${HEADER}\n`), STORY)
check('empty palette: nothing is blocked, the model\'s primary stands (referee is data-driven)', empty.primary_kanji === '送' && empty.candidates.every((c) => !c.eliminated))

// ---------------------------------------------------------------------------
// 8. The golden fixture through the referee (raw model output → refereed).
// ---------------------------------------------------------------------------
const golden = run(clone(GOLDEN))
check('golden: 迎 stays primary (its anchor 盆に帰るたびに車で駅まで迎えに来て is verbatim in the story)', golden.primary_kanji === '迎' && golden.referee?.primary_changed === false)
check('golden: 迎 is context_required (from the palette); 黙 is the second slot and the runner-up; the freestyle 封 survives its own rules (verbatim anchor, no blocklist hit)', get(golden, '迎').palette_status === 'context_required' && golden.runner_up_kanji === '黙' && golden.freestyle_kanji === '封' && !get(golden, '封').eliminated)
check('golden: the refereed fixture still conforms to the v6 contract', validateEngineResult(golden).length === 0, validateEngineResult(golden).join('; '))

// The reported first real run: 送 alive, 餞 primary.
const live = run(raw([cand('黙'), cand('駅'), cand('送'), cand('餞', { story_anchor: '' }), cand('灯')], '餞', { runner_up_kanji: '灯' }))
check('regression (first live run): 送 is now eliminated by the palette, and an anchorless 餞 cannot be primary — the runner-up takes over', get(live, '送').eliminated && get(live, '送').eliminated_reason === 'palette: hard_block' && live.primary_kanji === '灯')

// ---------------------------------------------------------------------------
// 9. en is judged against BOTH palettes (ja and zh): the buyer reads English, but the gift may be shown in any kanji culture.
// ---------------------------------------------------------------------------
const logs: string[] = []
const quiet = { log: (l: string) => logs.push(l) }
const FORM: Record<string, string> = { 黙: '默', 灯: '燈', 餞: '餞', 迎: '迎', 駅: '驛', 鐘: '鐘', 絆: '絆', 断: '斷', 鬼: '鬼', 走: '走', 蓮: '蓮', 寿: '壽' }
const ec = (kanji: string, over: Partial<Candidate> = {}) => cand(kanji, { inscription_form: FORM[kanji] ?? null, ...over })
const enRaw = (candidates: Candidate[], primary: string | null, over: Partial<EngineResult> = {}) => raw(candidates, primary, { language: 'en', inscription_script: null, ...over })
const runEn = (r: EngineResult, story = STORY) => applyPalette(r, palette, story, quiet)
check('en cross-check: the referee judges en against ja AND zh; ja against ja only; zh against zh only', refereeFamilies('en').join() === 'ja,zh' && refereeFamilies('ja').join() === 'ja' && refereeFamilies('zh-Hant').join() === 'zh' && refereeFamilies('zh-Hans').join() === 'zh')
check('en: every ja hard_block kanji is eliminated for an English result too (same rows, same reason, blocked by ja)', HARD.every((k) => { const c = get(runEn(enRaw([ec('灯'), cand(k)], '灯')), k); return c.eliminated === true && c.eliminated_reason === HARD_BLOCK_REASON && c.palette_status === 'off_palette' && c.flags.includes('blocked_by_ja') }))

// the real pairs: fine in Japanese, blocked in Mandarin
const ZH_ONLY = [['鐘', 'homophone_送终_funeral'], ['絆', 'trip_hinder_connotation'], ['断', 'severing'], ['鬼', 'ghost_death_association']] as const
for (const [k] of ZH_ONLY) {
  const jaOnly = run(raw([ec(k), cand('灯')], k))
  check(`en cross-check: ${k} is not blocked in ja (${palette.lookup('ja', k)?.status}) but is hard_block in zh — so it IS blocked for ja? no: ja keeps it, en refuses it`, jaOnly.candidates.find((c) => c.kanji === k)?.eliminated === false && palette.lookup('zh', FORM[k])?.status === 'hard_block' && palette.lookup('ja', k)?.status !== 'hard_block')
}
logs.length = 0
const ck = runEn(enRaw([ec('鐘'), ec('灯'), cand('遅', { slot: 'freestyle', story_anchor: '駅まで迎えに来て' })], '鐘', { runner_up_kanji: '灯' }))
check('en cross-check: 鐘 (fine in ja, hard_block in zh) is refused as MAIN for en → eliminated "palette: hard_block", flagged blocked_by_zh; the second (灯) is promoted', get(ck, '鐘').eliminated === true && get(ck, '鐘').eliminated_reason === HARD_BLOCK_REASON && get(ck, '鐘').flags.includes('blocked_by_zh') && !get(ck, '鐘').flags.includes('blocked_by_ja') && ck.primary_kanji === '灯' && ck.referee?.promoted_from === 'second')
check('en cross-check: the same answer for language ja keeps 鐘 as primary (the asymmetry is the point)', run(raw([ec('鐘'), cand('灯')], '鐘')).primary_kanji === '鐘')
check('en cross-check: logged as "[ichirei-referee] en cross-check" with the kanji and the family that blocked it — and no story text', logs.length === 1 && logs[0].startsWith('[ichirei-referee] en cross-check ') && JSON.parse(logs[0].slice('[ichirei-referee] en cross-check '.length)).kanji === '鐘' && JSON.parse(logs[0].slice('[ichirei-referee] en cross-check '.length)).blocked_by.join() === 'zh' && !logs[0].includes('駅') && !logs[0].includes('迎えに'), logs.join('\n'))
logs.length = 0
runEn(enRaw([ec('灯'), cand('送', { story_anchor: 'x' }), cand('遅', { slot: 'freestyle' })], '灯'))
check('en cross-check: the reverse pair (送 hard_block in ja, context_required in zh) is logged as blocked by ja', logs.some((l) => l.includes('"kanji":"送"') && l.includes('"blocked_by":["ja"]')), logs.join('\n'))
for (const k of ['絆', '断', '鬼']) check(`en cross-check: ${k} is refused for en (blocked by zh)`, get(runEn(enRaw([ec(k), ec('灯')], k, { runner_up_kanji: '灯' })), k).eliminated === true && get(runEn(enRaw([ec(k), ec('灯')], k, { runner_up_kanji: '灯' })), k).flags.includes('blocked_by_zh'))

// off-palette rule: a main candidate needs a row in BOTH palettes
logs.length = 0
const miss = runEn(enRaw([ec('駅'), ec('灯')], '駅', { runner_up_kanji: '灯' }))
check('en off-palette rule: 駅 has a ja row but NO zh row → not eligible as a main candidate for en ("palette: no_row_in_zh"), flagged, the second is promoted', palette.lookup('ja', '駅') !== undefined && palette.lookup('zh', '驛') === undefined && palette.lookup('zh', '驿') === undefined && get(miss, '駅').eliminated === true && get(miss, '駅').eliminated_reason === 'palette: no_row_in_zh' && get(miss, '駅').flags.includes('no_zh_row') && miss.primary_kanji === '灯' && miss.referee?.actions.some((a) => a.kanji === '駅' && a.action === 'missing_row_eliminated') === true)
check('en off-palette rule: logged with the family it lacks', logs.length === 1 && logs[0].includes('"kanji":"駅"') && logs[0].includes('"blocked_by":["zh"]') && logs[0].includes('no_row_in_zh'), logs.join('\n'))
check('en off-palette rule: the same 駅 is fine as a MAIN for ja', run(raw([ec('駅'), cand('灯')], '駅')).primary_kanji === '駅')
check('en off-palette rule: applies to the SECOND slot too (it cannot be promoted) → both mains gone → insufficient', runEn(enRaw([ec('鐘'), ec('駅')], '鐘', { runner_up_kanji: '駅' })).status === 'insufficient')
const noRowAny = runEn(enRaw([cand('X'), ec('灯')], 'X', { runner_up_kanji: '灯' }))
check('en off-palette rule: a character in NEITHER palette is not a main either', get(noRowAny, 'X').eliminated === true && get(noRowAny, 'X').eliminated_reason === 'palette: no_row_in_ja' && noRowAny.primary_kanji === '灯')
check('en off-palette rule: the model\'s own elimination keeps its reason (still recorded)', (() => { const o = runEn(enRaw([ec('灯'), ec('駅', { eliminated: true, eliminated_reason: 'ゲート3' })], '灯')); return get(o, '駅').eliminated_reason === 'ゲート3' && o.referee?.actions.some((a) => a.action === 'missing_row_already_eliminated') === true })())

// context_required / anchor in either palette; blocked occasions in either
const zhCtx = runEn(enRaw([ec('走', { story_anchor: 'a fragment not in the story' }), ec('灯')], '走', { runner_up_kanji: '灯' }))
check('en: 走 is ok in ja but context_required + anchor_required in zh → the anchor rule applies to en: refused as primary without a verbatim anchor', palette.lookup('ja', '走')?.status === 'ok' && palette.lookup('zh', '走')?.status === 'context_required' && zhCtx.primary_kanji === '灯' && zhCtx.referee?.actions.some((a) => a.kanji === '走' && a.action === 'primary_refused_no_anchor') === true)
const zhCtxOk = runEn(enRaw([ec('走', { story_anchor: 'she ran to the gate' }), ec('灯')], '走', { runner_up_kanji: '灯' }), 'Every evening she ran to the gate to meet me.')
check('en: …kept with a verbatim anchor, and its palette_status is context_required (the stricter row wins)', zhCtxOk.primary_kanji === '走' && get(zhCtxOk, '走').palette_status === 'context_required')
check('en: for ja the same 走 is a plain ok main (no anchor needed)', run(raw([ec('走', { story_anchor: 'a fragment not in the story' }), cand('灯')], '走')).primary_kanji === '走')
const wedding = runEn(enRaw([ec('蓮'), ec('灯')], '蓮', { occasion: 'wedding', runner_up_kanji: '灯' }))
check('en: a blocked occasion in EITHER palette removes the main (蓮 is blocked for weddings in ja only)', get(wedding, '蓮').eliminated_reason === 'palette: blocked_occasion' && get(wedding, '蓮').flags.includes('blocked_by_ja') && wedding.primary_kanji === '灯')
const enOcc = runEn(enRaw([ec('黙'), ec('寿'), ec('灯')], '寿', { occasion: 'new_baby', runner_up_kanji: '灯' }))
check('en: blocked_occasions still apply (寿 is blocked for a new_baby order)', get(enOcc, '寿').eliminated_reason === 'palette: blocked_occasion' && enOcc.primary_kanji === '灯')
check('en: the ja-only and en referee agree on a plain safe pair (灯 + 迎 stay main and second for both)', (() => { const e = runEn(enRaw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' })], '灯')); const j = run(raw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' })], '灯')); return e.primary_kanji === '灯' && e.runner_up_kanji === '迎' && j.primary_kanji === '灯' && j.runner_up_kanji === '迎' })())

// the freestyle: no row needed, but both blocklists and both palettes' hard blocks apply
const frNoRow = runEn(enRaw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' }), ec('駅', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて' })], '灯'))
check('en freestyle: a character with NO zh row (駅) is still allowed — the freestyle needs no palette row', frNoRow.freestyle_kanji === '駅')
const frZh = runEn(enRaw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' }), cand('胖', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて' })], '灯'))
check('en freestyle: a character on the ZH-only blocklist (胖, weight) is refused for en — both blocklists are checked', frZh.freestyle_kanji === null && get(frZh, '胖').eliminated_reason === 'palette: freestyle_blocked (weight)' && palette.freestyleCategory('ja', ['胖']) === undefined)
check('en freestyle: …while for ja the same 胖 is not on the ja list and is allowed', run(raw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' }), cand('胖', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて' })], '灯')).freestyle_kanji === '胖')
const frJa = runEn(enRaw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' }), cand('太', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて' })], '灯'))
check('en freestyle: a character on the JA-only blocklist (太) is refused too', frJa.freestyle_kanji === null && get(frJa, '太').eliminated_reason === 'palette: freestyle_blocked (weight)')
const frHard = runEn(enRaw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' }), ec('鐘', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて' })], '灯'))
check('en freestyle: a hard_block in either palette (鐘 is blocked by zh) removes the freestyle as well', frHard.freestyle_kanji === null && get(frHard, '鐘').eliminated_reason === HARD_BLOCK_REASON)
check('en cross-check never touches ja or zh results: no log line is written for them', (() => { logs.length = 0; applyPalette(raw([ec('鐘'), cand('灯')], '鐘'), palette, STORY, quiet); applyPalette(raw([cand('钟'), cand('灯')], '钟', { language: 'zh-Hant' }), palette, STORY, quiet); return logs.length === 0 })())

// attached fields: reading, reading_zh, meaning come from the palette, never from the model
const enAttach = runEn(enRaw([ec('灯', { reading: 'MODEL-GUESS', meaning: 'MODEL-GUESS', reading_zh: 'MODEL-GUESS', why_this: 'Lamplight is the light you left on for me.' }), ec('迎', { story_anchor: '駅まで迎えに来て', reading: 'x', meaning: 'x', why_this: 'Welcoming is what the station was.' })], '灯'))
check('en attach: ONE reading (the model\'s MODEL-GUESS is not on the row → first kun reading), reading_zh (pinyin) and meaning are overwritten from the palette rows; the model\'s why_this is kept', get(enAttach, '灯').reading === 'hi' && get(enAttach, '迎').reading === 'mukaeru' && get(enAttach, '灯').reading_zh === 'dēng' && get(enAttach, '灯').meaning === 'lamp' && get(enAttach, '灯').why_this === 'Lamplight is the light you left on for me.' && get(enAttach, '迎').meaning === 'welcome')
check('en attach: a candidate with no zh row (e.g. a ja-only freestyle 駅) has reading_zh null and keeps nothing invented; its reading/meaning come from the ja row', (() => { const o = runEn(enRaw([ec('灯'), ec('迎', { story_anchor: '駅まで迎えに来て' }), ec('駅', { slot: 'freestyle', truth_type: 'Play', story_anchor: '駅まで送ってくれて', reading: 'x', meaning: 'x', why_this: 'y' })], '灯')); const c = get(o, '駅'); return c.reading_zh === null && c.reading !== 'x' && c.meaning === 'station' })())
check('en attach: for ja and zh results nothing is attached or changed (no reading_zh, the model\'s own reading stays)', (() => { const o = run(raw([ec('灯', { reading: 'ひ' }), cand('迎', { story_anchor: '駅まで迎えに来て' })], '灯')); return get(o, '灯').reading === 'ひ' && get(o, '灯').reading_zh === undefined })())
check('en attach: plainMeaning picks the family-tagged item, drops parentheses, cuts at the first comma, lower-cases', plainMeaning('bond, ties (ja); to trip, hinder (zh)', 'ja') === 'bond' && plainMeaning('bond, ties (ja); to trip, hinder (zh)', 'zh') === 'to trip' && plainMeaning('Lamp; light', 'ja') === 'lamp' && plainMeaning('friend (of like mind)', 'ja') === 'friend' && plainMeaning('', 'ja') === '')
check('en attach: EVERY shipped ja row yields a romaji reading made only of Latin letters/macrons and a non-empty plain meaning (nothing blank reaches a buyer)', palette.values().filter((r) => r.language === 'ja').every((r) => /^[a-zāīūēō ·]+$/i.test(romanizeReadings(r.readings)) && plainMeaning(r.raw.core_meanings, 'ja') !== ''), palette.values().filter((r) => r.language === 'ja').filter((r) => !/^[a-zāīūēō ·]+$/i.test(romanizeReadings(r.readings))).map((r) => r.kanji).join(' '))
check('en attach: every shipped zh row has pinyin readings (reading_zh never comes out empty for a character that has a row)', palette.values().filter((r) => r.language === 'zh').every((r) => r.readings.length > 0))

console.log(failures === 0 ? '\nAll palette referee checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
