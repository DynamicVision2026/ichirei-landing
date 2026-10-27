// One-off, kept for traceability: add palette rows (ja + zh) for the classical-lexicon characters (engine/lexicon.csv) that the
// palettes did not have yet. AI first pass (reviewed_by "Claude(AI一次確認)"): it only ADDS restrictions — a status other than ok,
// taboo flags, blocked occasions, register flags, an anchor requirement, a narrower relationship_fit — never a reviewed claim.
// The per-character data (readings, forms, compounds, risks carried over from the lexicon's standalone_reading_risk) lives in
// scripts/lexicon-palette-data.json, generated from the author's notes; this script only assembles and appends the rows.
//
//   node --experimental-strip-types scripts/add-lexicon-palette-rows.mjs [--dry-run]
//
// Idempotent: characters that already have a row in a family are skipped.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPalette, parseCsv } from '../engine/palette.ts'

const root = join(import.meta.dirname, '..')
const dry = process.argv.includes('--dry-run')
const data = JSON.parse(readFileSync(join(root, 'scripts', 'lexicon-palette-data.json'), 'utf8'))
const enginePath = join(root, 'engine', 'palette.csv')
const [header, ...rows] = parseCsv(readFileSync(enginePath, 'utf8'))
const palette = loadPalette()
const [, ...lex] = parseCsv(readFileSync(join(root, 'engine', 'lexicon.csv'), 'utf8'))

const quote = (cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)
const toCsv = (lines) => lines.map((cells) => cells.map(quote).join(',')).join('\n') + '\n'

// lexicon fits_relationships -> palette relationship codes
const REL = { parent: ['parent_mother', 'parent_father', 'grandparent'], partner: ['spouse', 'romance'], mentor: ['mentor'], friend: ['friend'], work: ['work'], child: ['child'] }
const fitsOf = (key) => {
  const out = []
  for (const r of lex.filter((x) => x[0] === key)) {
    for (const tok of r[4].replace(/\([^)]*\)/g, '').split('/').map((t) => t.trim()).filter(Boolean)) for (const code of REL[tok] ?? []) if (!out.includes(code)) out.push(code)
  }
  return out
}

const AI = 'Claude(AI一次確認)'
const ON = '2026-10-27'
const added = { ja: [], zh: [] }
const make = (lang, key, d) => {
  const f = d[lang]
  const [kanji, form, readings, meaning, compounds] = lang === 'ja' ? f : [f[0], f[1], f[2], f[3], f[4]]
  const status = d[`${lang}_status`] ?? 'ok'
  let fit = fitsOf(key)
  if (d[`${lang}_fit_partner_only`]) fit = ['spouse', 'romance']
  if (d[`${lang}_fit_no_partner`]) fit = fit.filter((c) => c !== 'spouse' && c !== 'romance')
  if (status === 'hard_block') fit = ['none']
  const other = lang === 'ja' ? d.zh : d.ja
  const note =
    status === 'hard_block'
      ? `${other[0]} is a Japanese kokuji (国字), not a standard Chinese character: hard-blocked for Chinese orders. Added from the classical lexicon (2026-10-27), AI first pass.`
      : `Same character and core meaning in ${lang === 'ja' ? 'Chinese' : 'Japanese'} (${other[0]}${other[0] !== kanji ? `, ${lang === 'ja' ? other[2].split('|')[0] : other[2].split('|')[0]}` : ''}). Added from the classical lexicon (engine/lexicon.csv, 2026-10-27); AI first pass, not human-reviewed.`
  return [
    lang, kanji, form, readings, meaning, compounds, status,
    d[`${lang}_taboo`] ?? 'none', d[`${lang}_blocked`] ?? 'none', d[`${lang}_reg`] ?? 'warm',
    status === 'ok' ? 'no' : (d[`${lang}_anchor`] ?? 'no'), note,
    fit.length ? fit.join('|') : 'all', status === 'hard_block' ? 'low' : (d.insc ?? 'high'), 'none', AI, ON,
  ]
}
for (const [key, d] of Object.entries(data)) {
  for (const lang of ['ja', 'zh']) {
    const f = d[lang]
    const have = palette.lookup(lang, f[0]) ?? palette.lookup(lang, f[1])
    if (have) continue
    added[lang].push(make(lang, key, d))
  }
}
const lastJa = rows.map((r) => r[0]).lastIndexOf('ja')
const next = [...rows.slice(0, lastJa + 1), ...added.ja, ...rows.slice(lastJa + 1), ...added.zh]
console.log(`adding ${added.ja.length} ja and ${added.zh.length} zh rows${dry ? ' (dry run)' : ''}`)
if (!dry) writeFileSync(enginePath, toCsv([header, ...next]))
