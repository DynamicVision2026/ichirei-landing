// The first-pass (AI) review of the Japanese palette, applied 2026-10-27 (scripts/apply-ja-review.mjs, sheets in review/ja/).
// An AI pass is NOT a human review: its classical lines are never shown, REQUIRE_CLASSICAL_ECHO is not affected by it, an `ok` row
// stays unvouched for, and no copy may claim a native-speaker check. What the pass changed is stricter, or a correction.
//   node --experimental-strip-types scripts/test-ja-review.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPalette, classicalEchoOf, isAiReviewer, loadPalette, parseCsv, parsePalette } from '../engine/palette.ts'
import type { Candidate, EngineResult } from '../engine/contract.ts'
import { COPY } from '../src/demo/i18n.ts'
import { LANDING_COPY } from '../src/landing/copy.ts'
import { TEXT } from '../src/reveal/copy.ts'

let failures = 0
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
  if (!cond) failures++
}
const root = process.cwd()
const palette = loadPalette()
const ja = (k: string) => palette.lookup('ja', k)!

// ---- 1. what the review changed ---------------------------------------------------------------------------------------------
const MEMORIAL_27 = '寿 祝 賀 慶 吉 祥 喜 福 婚 宴 祭 誕 初 始 新 芽 歓 悦 嫁 婿 杯 酒 鯉 鶴 亀 桃 帆'.split(' ')
check('memorial: the 27 celebration / beginning characters carry the `memorial` block code', MEMORIAL_27.length === 27 && MEMORIAL_27.every((k) => ja(k).blocked_occasions.includes('memorial')), MEMORIAL_27.filter((k) => !ja(k).blocked_occasions.includes('memorial')).join(' '))
check('status: 渡 草 犬 耐 黙 梨 moved from ok to context_required', ['渡', '草', '犬', '耐', '黙', '梨'].every((k) => ja(k).status === 'context_required'), ['渡', '草', '犬', '耐', '黙', '梨'].map((k) => `${k}:${ja(k).status}`).join(' '))
check('occasions: wedding 帰 還 続 断 継 秋 耐; retirement 肩 窓; birthday 迎 渡 峠; new_baby 星', [['帰', 'wedding'], ['還', 'wedding'], ['続', 'wedding'], ['断', 'wedding'], ['継', 'wedding'], ['秋', 'wedding'], ['耐', 'wedding'], ['肩', 'retirement_farewell'], ['窓', 'retirement_farewell'], ['迎', 'birthday_milestone'], ['渡', 'birthday_milestone'], ['峠', 'birthday_milestone'], ['星', 'new_baby']].every(([k, o]) => ja(k).blocked_occasions.includes(o)))
check('readings: 峠 has no on reading; 背 せい/そむ-く replace せなか; 蝶 no kun; 祝 シュウ, 想 ソ, 育 はぐく-む added', ja('峠').readings.join() === 'とうげ' && ja('背').readings.includes('そむ-く') && !ja('背').readings.includes('せなか') && ja('蝶').readings.join() === 'チョウ' && ja('祝').readings.includes('シュウ') && ja('想').readings.includes('ソ') && ja('育').readings.includes('はぐく-む'))
check('inscription form: 嘆 is carved 嘆 (not 歎)', ja('嘆').raw.inscription_form === '嘆')
check('every change is stricter or a correction: no row lost a block, no hard_block row was loosened (the 嘆, 送, 別 … hard blocks are all still hard_block)', palette.size > 600 && ['嘆', '送', '別'].every((k) => !ja(k) || ja(k).status === 'hard_block'))

// ---- 2. owner decisions (要検討) -------------------------------------------------------------------------------------------
check('owner decision: 寿 is NOT blocked for new_baby (widely used for births); it still is for school_career and memorial', !ja('寿').blocked_occasions.includes('new_baby') && ja('寿').blocked_occasions.includes('school_career') && ja('寿').blocked_occasions.includes('memorial'), ja('寿').blocked_occasions.join('|'))
check('owner decision: 志 is context_required (the standard label on funeral return gifts)', ja('志').status === 'context_required')

// ---- 3. AI review is not human review ---------------------------------------------------------------------------------------
check('isAiReviewer: "Claude(AI一次確認)" and any "Claude…" is an AI pass; a person\'s name and draft markers are not', isAiReviewer('Claude(AI一次確認)') && isAiReviewer('claude-sonnet') && isAiReviewer(' Claude') && !isAiReviewer('田中 花子') && !isAiReviewer('draft-unreviewed') && !isAiReviewer(''))
const jaRows = parseCsv(readFileSync(join(root, 'engine', 'palette.csv'), 'utf8')).slice(1).filter((r) => r[0] === 'ja')
const aiRows = jaRows.filter((r) => /^Claude/.test(r[15]))
check('the sheet records the AI pass on the ja rows (304 rows; the 18 hand-written interim rows keep their marker), dated 2026-10-26', aiRows.length === 304 && aiRows.every((r) => r[16] === '2026-10-26') && jaRows.filter((r) => r[15] === 'interim-unreviewed').length === 18)
check('no row in the palette counts as reviewed: every ja row is `reviewed = false`', jaRows.every((r) => ja(r[1]).reviewed === false))
check('classical lines: not one ja row yields a classical line (classicalEchoOf is null for all 322)', jaRows.every((r) => classicalEchoOf(ja(r[1])) === null))

// a synthetic palette: the same row reviewed by an AI vs by a person
const header = parseCsv(readFileSync(join(root, 'engine', 'palette.csv'), 'utf8'))[0]
const rowCsv = (o: Record<string, string>) => header.map((c) => o[c] ?? '').join(',')
const base = { language: 'ja', inscription_form: '灯', readings: 'トウ|ひ', core_meanings: 'lamp', auspicious_compounds: '灯|灯火', status: 'ok', taboo_flags: 'none', blocked_occasions: 'none', register_flags: 'warm', anchor_required: 'no', cross_language_note: 'x'.repeat(30), relationship_fit: 'all', inscription_fitness: 'high' }
const mini = (kanji: string, reviewer: string, echo: string) => `${header.join(',')}\n${rowCsv({ ...base, kanji, classical_echo: echo, reviewed_by: reviewer, reviewed_on: reviewer.startsWith('draft') ? '' : '2026-10-26' })}\n`
const ECHO = '慈母手中線，遊子身上衣 — 孟郊「遊子吟」'
const aiPal = parsePalette(mini('灯', 'Claude(AI一次確認)', ECHO))
const humanPal = parsePalette(mini('灯', '田中 花子', ECHO))
check('a classical line on a row reviewed by "Claude…" is NEVER returned; the same row reviewed by a person is', classicalEchoOf(aiPal.lookup('ja', '灯')) === null && classicalEchoOf(humanPal.lookup('ja', '灯'))?.text !== undefined)
const cand = (kanji: string): Candidate => ({ slot: 'main', kanji, inscription_form: null, reading: 'ひ', truth_type: 'Essence', one_line_gaze: 'x', story_anchor: 'a', unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const result = (kanji: string): EngineResult => ({ language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day', occasion_detail: null, inscription_script: null, status: 'sufficient', follow_up_question: null, particulars: ['p'], fingerprint: { relationship_note: 'n', scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null, emotional_register: ['warm'] }, candidates: [cand(kanji), { ...cand('守'), slot: 'second', truth_type: 'Role' }], primary_kanji: kanji, runner_up_kanji: '守', freestyle_kanji: null, fallback_follow_up_question: 'q' } as EngineResult)
const shownAi = applyPalette(result('灯'), aiPal, 'a', { requireClassicalEcho: false })
const shownHuman = applyPalette(result('灯'), humanPal, 'a', { requireClassicalEcho: false })
check('applyPalette: a main candidate from an AI-reviewed row carries NO classical line on the card; from a human-reviewed row it does', shownAi.candidates[0].classical_echo === null && shownHuman.candidates[0].classical_echo?.text === '慈母手中線，遊子身上衣')
const requireAi = applyPalette(result('灯'), aiPal, 'a', { requireClassicalEcho: true })
check('REQUIRE_CLASSICAL_ECHO: an AI-reviewed line does not satisfy it (no main is eligible → insufficient), a human-reviewed one does', requireAi.status === 'insufficient' && applyPalette(result('灯'), humanPal, 'a', { requireClassicalEcho: true }).candidates[0].eliminated === false)
check('REQUIRE_CLASSICAL_ECHO stays OFF by default (the environment is not set)', !/^(1|true|on|yes)$/i.test((process.env.REQUIRE_CLASSICAL_ECHO ?? '').trim()))
const cb = readFileSync(join(root, 'cloudbuild.yaml'), 'utf8')
check('REQUIRE_CLASSICAL_ECHO is not switched on anywhere in the deploy file', !/REQUIRE_CLASSICAL_ECHO/.test(cb.replace(/#.*$/gm, '')))
// an `ok` row nobody (human) has reviewed does not vouch for the character: palette_status stays the model's, never "ok" from an AI pass
const okAi = applyPalette(result('灯'), aiPal, 'a', { requireClassicalEcho: false }).candidates[0]
const okHuman = applyPalette(result('灯'), humanPal, 'a', { requireClassicalEcho: false }).candidates[0]
check('an `ok` row from the AI pass does not vouch for the character (palette_status keeps the model\'s own); a human-reviewed ok row does', okAi.palette_status === 'ok' && okHuman.palette_status === 'ok' && aiPal.lookup('ja', '灯')!.reviewed === false && humanPal.lookup('ja', '灯')!.reviewed === true)

// ---- 4. the classical sheet is stored, not used ------------------------------------------------------------------------------
const echoSheet = parseCsv(readFileSync(join(root, 'review', 'ja', 'classical_echo_ja.csv'), 'utf8').replace(/^﻿/, ''))
const eh = echoSheet[0]
check('review/ja/classical_echo_ja.csv is kept as the human reviewer\'s starting point (322 rows; AI lines recorded as "Claude(AI…)", all of them unverified against a book)', echoSheet.length === 323 && eh.includes('classical_text') && echoSheet.slice(1).every((r) => /^(Claude|interim-)/.test(r[eh.indexOf('reviewed_by')])) && echoSheet.slice(1).filter((r) => r[eh.indexOf('classical_text')] !== '').length === 38 + 0, echoSheet.slice(1).filter((r) => r[eh.indexOf('classical_text')] !== '').length)
check('review/ja/palette_ja.csv and Reviewer_Reply_JA.md are stored next to it', readFileSync(join(root, 'review', 'ja', 'Reviewer_Reply_JA.md'), 'utf8').includes('AI（Claude）') && parseCsv(readFileSync(join(root, 'review', 'ja', 'palette_ja.csv'), 'utf8').replace(/^﻿/, '')).length === 323)

// ---- 5. no "checked by native speakers" wording anywhere a customer reads -------------------------------------------------
const leaves = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(leaves) : v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [])
const claim = /native[- ]speaker|native-checked|ネイティブ(?:スピーカー|チェック|確認)|母語話者|母语者|母語者|校閲済|审校|審校|checked by (?:a )?(?:native|japanese)|reviewed by (?:a )?(?:native|japanese)|確認済み/i
const copyText = [...leaves(COPY), ...leaves(LANDING_COPY), ...leaves(TEXT)]
check(`no customer-facing copy claims a native-speaker or human check of the characters (${copyText.length} strings scanned: demo, landing, reveal)`, copyText.every((t) => !claim.test(t)), copyText.filter((t) => claim.test(t)).slice(0, 3))
check('index.html makes no such claim either', !claim.test(readFileSync(join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')))

if (failures > 0) {
  console.log(`\n${failures} ja-review check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll ja-review checks passed.')
