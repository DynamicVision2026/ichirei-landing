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
  parsePalette,
} from '../engine/palette.ts'
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
const rowsOf = (status: string) => [...palette.values()].filter((r) => r.status === status)

check('palette: 18 rows, all ja', palette.size === 18 && [...palette.values()].every((r) => r.language === 'ja'), String(palette.size))
check('palette: hard_block rows are exactly 送 終 別 離 切 去 散 衰 老 死 苦 錆 消 弱 病 無', rowsOf('hard_block').map((r) => r.kanji).join('') === HARD.join(''), rowsOf('hard_block').map((r) => r.kanji).join(''))
check('palette: 迎 and 餞 are context_required with anchor_required=yes', ['迎', '餞'].every((k) => { const r = palette.get(`ja:${k}`); return r?.status === 'context_required' && r.anchor_required === true }))
check('palette: only 迎 and 餞 require an anchor', [...palette.values()].filter((r) => r.anchor_required).map((r) => r.kanji).join('') === '迎餞')
check('palette: every row says it is interim/unreviewed (no human sign-off claimed)', [...palette.values()].every((r) => r.raw.reviewed_by === 'interim-unreviewed' && r.raw.reviewed_on === ''))
check('palette: every hard_block row names at least one taboo flag', rowsOf('hard_block').every((r) => r.taboo_flags.length > 0))
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
check('csv: a row with a comma inside a quoted cell parses to one palette row', quoted.size === 1 && quoted.get('ja:禍')?.raw.core_meanings === 'misfortune, calamity' && quoted.get('ja:禍')?.taboo_flags.join() === 'x,y')
check('csv: wrong header throws', throws(() => parsePalette('language,kanji\n')).includes('header'))
check('csv: wrong column count throws', throws(() => parsePalette(`${HEADER}\nja,送,hard_block\n`)).includes('columns'))
check('csv: unknown status throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '送', status: 'blocked' })}\n`)).includes('invalid status'))
check('csv: unknown language throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'en', kanji: '送', status: 'ok' })}\n`)).includes('invalid language'))
check('csv: bad anchor_required throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '迎', status: 'ok', anchor_required: 'maybe' })}\n`)).includes('anchor_required'))
check('csv: duplicate (language, kanji) throws', throws(() => parsePalette(`${HEADER}\n${rowCsv({ language: 'ja', kanji: '送', status: 'ok' })}\n${rowCsv({ language: 'ja', kanji: '送', status: 'hard_block' })}\n`)).includes('duplicate'))
check('csv: header-only palette is valid and empty', parsePalette(`${HEADER}\n`).size === 0)

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
    kanji, reading: 'よみ', kyujitai_form: null, truth_type: 'Essence', one_line_gaze: 'g', story_anchor: '駅まで迎えに来て',
    unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [], ...over,
  } as Candidate
}
function raw(candidates: Candidate[], primary: string | null, over: Partial<EngineResult> = {}): EngineResult {
  return { ...clone(GOLDEN), candidates, primary_kanji: primary, ...over } as EngineResult
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

const viaOldForm = run(raw([cand('黙'), cand('X', { kyujitai_form: '送' })], '黙'))
check('hard_block: matches on the inscription form (kyujitai_form) too', get(viaOldForm, 'X').eliminated === true)

const zh = run(raw([cand('送'), cand('灯')], '灯', { language: 'zh' }))
check('hard_block: language-scoped — the ja blocklist does not touch a zh result', get(zh, '送').eliminated === false && zh.referee?.actions.length === 0)

// ---------------------------------------------------------------------------
// 5. Promotion when the primary is removed.
// ---------------------------------------------------------------------------
const removed = run(raw([cand('黙'), cand('送'), cand('灯')], '送'))
check('promote: hard-blocked primary → the next surviving candidate in order becomes primary', removed.primary_kanji === '灯' && removed.referee?.primary_changed === true && removed.referee.original_primary === '送', String(removed.primary_kanji))
check('promote: the result still validates (primary is among the non-eliminated candidates)', validateEngineResult({ ...removed, candidates: removed.candidates }).filter((p) => p.includes('primary')).length === 0)

const wrap = run(raw([cand('黙'), cand('灯'), cand('送')], '送'))
check('promote: when the blocked primary is last, search wraps to the start', wrap.primary_kanji === '黙')

const skipping = run(raw([cand('送'), cand('愛', { eliminated: true, eliminated_reason: 'g1' }), cand('終'), cand('菊', { flags: ['no_heart_anchor'] }), cand('迎', { story_anchor: '' }), cand('灯')], '送'))
check('promote: skips eliminated, hard_block, no_heart_anchor and anchorless context_required candidates', skipping.primary_kanji === '灯', String(skipping.primary_kanji))
check('promote: an anchorless context_required kanji skipped as a target is flagged palette_anchor_missing and stays alive', get(skipping, '迎').eliminated === false && get(skipping, '迎').flags.includes('palette_anchor_missing'))

const none = run(raw([cand('送'), cand('終'), cand('迎', { story_anchor: '' })], '送'))
check('promote: nothing eligible → primary_kanji null + referee.no_eligible_primary', none.primary_kanji === null && none.referee?.no_eligible_primary === true)
check('promote: a result with no eligible primary is accepted by the contract validator', validateEngineResult(none).filter((p) => p.includes('primary')).length === 0, validateEngineResult(none).join('; '))

// ---------------------------------------------------------------------------
// 6. Rule 2: a context_required kanji is primary only with its anchor line.
// ---------------------------------------------------------------------------
const noAnchor = run(raw([cand('黙'), cand('餞', { story_anchor: '' }), cand('灯')], '餞'))
check('anchor: 餞 primary with an empty story_anchor is refused → next survivor promoted', noAnchor.primary_kanji === '灯' && noAnchor.referee?.primary_changed === true)
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
check('golden: 送 stays eliminated with the MODEL\'s reason; 迎 is context_required', get(golden, '送').eliminated_reason?.startsWith('ゲート3') === true && get(golden, '迎').palette_status === 'context_required')
check('golden: the refereed fixture still conforms to the contract', validateEngineResult(golden).length === 0, validateEngineResult(golden).join('; '))

// The reported first real run: 送 alive, 餞 primary.
const live = run(raw([cand('黙'), cand('駅'), cand('送'), cand('餞', { story_anchor: '' }), cand('灯')], '餞'))
check('regression (first live run): 送 is now eliminated by the palette, and an anchorless 餞 cannot be primary', get(live, '送').eliminated && get(live, '送').eliminated_reason === 'palette: hard_block' && live.primary_kanji !== '餞')

console.log(failures === 0 ? '\nAll palette referee checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
