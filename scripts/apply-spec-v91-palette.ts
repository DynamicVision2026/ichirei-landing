// Engine v9.1 spec, section C ("the four levels of blocking") applied to engine/palette.csv. Idempotent. Writes
// review/v9_1_section_c_changes.csv: every field of every row that changed, with the reason (before = the palette as it was in git HEAD
// when the script first ran; later runs keep the recorded before-values).
//
//   node --experimental-strip-types scripts/apply-spec-v91-palette.ts
//
// Level 1 (never, any slot): death / illness / ending words, and the expert's do-not-use list 黙/默 迎 執 忍 走  → hard_block.
// Level 2 (needs story support): 耐 渡 草 犬 梨 冷 寒 涙 and 切 (moved from level 1 by the owner) → context_required + anchor_required.
// Level 3 (one occasion): milestone 迎 渡 冬 夕 影 菊 峠; wedding 帰 秋 断 続 還 耐 継 (JAPANESE palette only — owner decision 2026-10-28: these are Japanese 忌み言葉; for Chinese buyers only 断 is blocked, and it is already a hard block; 归 is auspicious in a Chinese wedding, 之子于归); remembrance = engine/memorial-block.csv.
// Rule: a character in the lexicon with a verified warm line is never level 1 (so 篤/笃 is NOT blocked) — except the do-not-use list.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseCsv } from '../engine/palette.ts'

const ROOT = new URL('..', import.meta.url).pathname
const PATH = `${ROOT}engine/palette.csv`
const CHANGES = `${ROOT}review/v9_1_section_c_changes.csv`
const q = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
const rows = parseCsv(readFileSync(PATH, 'utf8'))
const header = rows[0]
const col = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>
const body = rows.slice(1)

type Change = { family: string; character: string; field: string; before: string; after: string; reason: string }
const previous: Change[] = existsSync(CHANGES) ? parseCsv(readFileSync(CHANGES, 'utf8')).slice(1).map((r) => ({ family: r[0], character: r[1], field: r[2], before: r[3], after: r[4], reason: r[5] })) : []
const changes = new Map<string, Change>(previous.map((c) => [`${c.family}|${c.character}|${c.field}`, c]))

const ZH_ALIAS: Record<string, string> = { 涙: '泪', 帰: '归', 続: '续', 継: '继', 別: '别', 執: '执', 黙: '默' }
const find = (family: string, ch: string) => body.find((r) => r[col.language] === family && [ch, family === 'zh' ? ZH_ALIAS[ch] : undefined].some((c) => c !== undefined && (r[col.kanji] === c || r[col.inscription_form] === c)))
const record = (family: string, character: string, field: string, before: string, after: string, reason: string) => {
  const key = `${family}|${character}|${field}`
  const first = changes.get(key)
  const origin = first ? first.before : before
  if (origin === after) changes.delete(key)
  else changes.set(key, { family, character, field, before: origin, after, reason: first?.reason ?? reason })
}
function patch(family: string, ch: string, fields: Record<string, string>, reason: string, append?: Record<string, string>) {
  const row = find(family, ch)
  if (!row) throw new Error(`no ${family} row for ${ch}`)
  for (const [f, v] of Object.entries(fields)) {
    if (row[col[f]] !== v) {
      record(family, row[col.kanji], f, row[col[f]], v, reason)
      row[col[f]] = v
    }
  }
  for (const [f, add] of Object.entries(append ?? {})) {
    if (!row[col[f]].includes(add)) {
      // taboo flags are a "|" list ("none" = nothing recorded); notes are sentences
      const v = f === 'taboo_flags' ? [...row[col[f]].split('|').filter((x) => x && x !== 'none'), add].join('|') : row[col[f]] ? `${row[col[f]]} ${add}` : add
      record(family, row[col.kanji], f, row[col[f]], v, reason)
      row[col[f]] = v
    }
  }
}
const addOccasion = (family: string, ch: string, occ: string, reason: string) => {
  const row = find(family, ch)
  if (!row) throw new Error(`no ${family} row for ${ch}`)
  if (row[col.status] === 'hard_block') return // already blocked everywhere; the palette keeps blocked_occasions empty on hard_block rows
  const cur = row[col.blocked_occasions] === 'none' || row[col.blocked_occasions] === '' ? [] : row[col.blocked_occasions].split('|')
  if (cur.includes(occ)) return
  const v = [...cur, occ].join('|')
  record(family, row[col.kanji], 'blocked_occasions', row[col.blocked_occasions], v, reason)
  row[col.blocked_occasions] = v
}
const addRow = (cells: Record<string, string>, reason: string) => {
  const family = cells.language
  if (find(family, cells.kanji)) return
  const row = header.map((h) => cells[h] ?? '')
  body.push(row)
  record(family, cells.kanji, 'row', '(none)', `${cells.status} (new row)`, reason)
}
const AI = { reviewed_by: 'Claude(AI一次確認)', reviewed_on: '2026-10-28' }

// ---- the 篤 revert ------------------------------------------------------------------------------------------------------------------
patch('ja', '篤', {
  status: 'context_required',
  taboo_flags: 'kitoku_critically_ill_危篤',
  anchor_required: 'yes',
  relationship_fit: 'parent_mother|parent_father|grandparent|spouse|romance|friend|work|mentor',
  inscription_fitness: 'medium',
  cross_language_note: 'Same character and core meaning in Chinese (笃, dǔ). Added from the classical lexicon (engine/lexicon.csv, 2026-10-27); AI first pass, not human-reviewed.',
}, 'spec v9.1 section C: a lexicon character with a verified line is never level 1 (only the do-not-use list is); the 2026-10-28 hard block is reverted. The illness rule (level 4, per gift) keeps 篤 away from an ill receiver.')

// ---- level 1: the expert's do-not-use list ------------------------------------------------------------------------------------------------
const L1 = 'level 1 (spec v9.1 section C): on the expert\'s do-not-use list (黙/默 迎 執 忍 走) — never used in any slot'
const NOTE1 = ' Level 1 (spec v9.1 C): expert do-not-use list — never used in any slot.'
for (const [family, chars] of [['ja', ['黙', '迎', '忍', '走']], ['zh', ['默', '迎', '忍', '走']]] as const) {
  for (const ch of chars) {
    const row = find(family, ch)!
    patch(family, ch, { status: 'hard_block', anchor_required: 'no', relationship_fit: 'none' }, L1, { cross_language_note: NOTE1.trim(), taboo_flags: 'do_not_use_expert_list' })
    void row
  }
}
for (const family of ['ja', 'zh']) {
  const r = find(family, '迎')
  if (r && r[col.blocked_occasions] !== 'none') patch(family, '迎', { blocked_occasions: 'none' }, 'level 1 hard block already covers every occasion (the palette keeps blocked_occasions empty on hard_block rows); the milestone block it had is now implied')
}
addRow({ language: 'ja', kanji: '執', inscription_form: '執', readings: 'シツ|シュウ|と-る', core_meanings: 'grasp; hold on; carry out', auspicious_compounds: '執筆|執行|執着', status: 'hard_block', taboo_flags: 'do_not_use_expert_list|stubbornness_執着', blocked_occasions: 'none', register_flags: 'none', anchor_required: 'no', cross_language_note: `Same character in Chinese (执, zhí).${NOTE1}`, relationship_fit: 'none', inscription_fitness: 'medium', classical_echo: 'none', ...AI }, L1)
addRow({ language: 'zh', kanji: '执', inscription_form: '執', readings: 'zhí', core_meanings: 'grasp; hold on; carry out', auspicious_compounds: '执笔|执行|固执', status: 'hard_block', taboo_flags: 'do_not_use_expert_list|stubbornness_固执', blocked_occasions: 'none', register_flags: 'none', anchor_required: 'no', cross_language_note: `Same character in Japanese (執, シツ).${NOTE1}`, relationship_fit: 'none', inscription_fitness: 'medium', classical_echo: 'none', ...AI }, L1)
// level 1: the ending words (spec: 死 病 逝 葬 終 別 …) — the Chinese row for 别 was still context_required
patch('zh', '别', { status: 'hard_block', anchor_required: 'no', relationship_fit: 'none' }, 'level 1 (spec v9.1 section C): ending word 別 — hard block in the Chinese palette too (it already was in the Japanese one)')

// ---- level 2: needs story support ---------------------------------------------------------------------------------------------------------
const L2 = 'level 2 (spec v9.1 section C): allowed only when the story clearly shows it in a warm sense'
for (const family of ['ja', 'zh']) for (const ch of ['耐', '渡', '草', '犬', '梨', '冷', '寒', '涙']) patch(family, ch, { status: 'context_required', anchor_required: 'yes' }, L2)
patch('ja', '切', { status: 'context_required', anchor_required: 'yes' }, 'owner decision (spec v9.1 section C): 切 (大切／切実) moves from level 1 to level 2')
patch('zh', '切', { status: 'context_required', anchor_required: 'yes' }, 'owner decision (spec v9.1 section C): 切 is level 2')

// ---- level 3: one occasion ------------------------------------------------------------------------------------------------------------------------
const L3M = 'level 3 (spec v9.1 section C): blocked for milestone birthdays (還暦)'
for (const family of ['ja', 'zh']) for (const ch of ['渡', '冬', '夕', '影', '菊']) addOccasion(family, ch, 'birthday_milestone', L3M)
addOccasion('ja', '峠', 'birthday_milestone', L3M)
const L3W = 'level 3 (spec v9.1 section C): blocked for weddings (Japanese palette: 忌み言葉)'
for (const ch of ['帰', '秋', '断', '続', '継', '耐']) addOccasion('ja', ch, 'wedding', L3W)
// Owner decision (2026-10-28): the wedding block is NOT applied to Chinese buyers. An earlier run of this script had added it to zh 归 秋 续 继 耐 and a zh 还 row; undo that.
for (const ch of ['归', '秋', '续', '继', '耐']) {
  const row = find('zh', ch)
  if (!row) throw new Error(`no zh row for ${ch}`)
  const cur = row[col.blocked_occasions].split('|').filter((x) => x && x !== 'none' && x !== 'wedding')
  const v = cur.length ? cur.join('|') : 'none'
  if (row[col.blocked_occasions] !== v) {
    record('zh', row[col.kanji], 'blocked_occasions', row[col.blocked_occasions], v, 'owner decision: wedding block removed for Chinese buyers')
    row[col.blocked_occasions] = v
  }
}
const zhHuan = body.findIndex((r) => r[col.language] === 'zh' && r[col.kanji] === '还' && r[col.cross_language_note].startsWith('Added for the wedding block'))
if (zhHuan >= 0) body.splice(zhHuan, 1)
changes.delete('zh|还|row')
addOccasion('ja', '還', 'wedding', L3W)

const text = [header, ...body].map((r) => r.map(q).join(',')).join('\n') + '\n'
writeFileSync(PATH, text)
const out = ['family,character,field,before,after,reason', ...[...changes.values()].map((c) => [c.family, c.character, c.field, c.before, c.after, c.reason].map(q).join(','))].join('\n') + '\n'
writeFileSync(CHANGES, out)
console.log(`palette rows: ${body.length}; recorded changes: ${changes.size} (review/v9_1_section_c_changes.csv)`)

// remembrance: the default block must carry the celebration / new-beginning characters named in the spec
const mb = readFileSync(`${ROOT}engine/memorial-block.csv`, 'utf8')
const missing = [...'祝寿喜初新婚'].filter((c) => !mb.split('\n').some((l) => l.split(',')[0] === c || l.includes(`,${c},`) || l.startsWith(`${c},`)))
console.log(missing.length ? `memorial-block.csv is missing: ${missing.join(' ')}` : 'memorial-block.csv carries 祝 寿 喜 初 新 婚')
