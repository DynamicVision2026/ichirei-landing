// Export the palette for human reviewers: one CSV per language family, the same 17
// columns as engine/palette.csv plus an empty `reviewer_comment` column.
//
//   node scripts/export-review.mjs          # writes review/palette_ja.csv and review/palette_zh.csv
//   node scripts/export-review.mjs --check  # exits 1 if the files in review/ are out of date
//
// It also writes review/classical_echo_ja.csv and review/classical_echo_zh.csv: every palette row whose
// classical line is EMPTY or whose row is not yet REVIEWED, so reviewers can fill them in. The engine shows a
// classical line only for a reviewed row, in the format `text — source` (space, em dash, space) —
// "text + exact source", e.g. `慈母手中線，遊子身上衣 — 孟郊「遊子吟」`. The model never writes one.
//
// And review/palette_review_en_meanings.csv: for a NATIVE ENGLISH reviewer — every Japanese palette row that can
// reach an English-speaking buyer (hard_block rows are never shown), with the Japanese reading, the romaji, the pinyin
// (when the Mandarin palette has the character), the plain-English meaning the buyer will actually see
// (`current_english_meaning`) and the full palette meaning, plus empty `suggested_meaning` / `reviewer_comment`.
//
// engine/palette.csv stays the single source of truth; reviewers send comments back
// and the changes are applied there. Re-run this after any palette edit.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { classicalEchoOf, parseCsv, parsePalette, plainMeaning } from '../engine/palette.ts'
import { romanizeReadings } from '../engine/romaji.ts'

const root = join(import.meta.dirname, '..')
const [header, ...rows] = parseCsv(readFileSync(join(root, 'engine', 'palette.csv'), 'utf8'))
const langIdx = header.indexOf('language')

const quote = (cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)
const toCsv = (lines) => lines.map((cells) => cells.map(quote).join(',')).join('\n') + '\n'

const palette = parsePalette(readFileSync(join(root, 'engine', 'palette.csv'), 'utf8'))
const col = (r, name) => r[header.indexOf(name)]

/** Rows that still need a classical line: none recorded, or the row is not reviewed (so nothing would be shown). */
export function echoRows(lang) {
  return rows
    .filter((r) => r[langIdx] === lang)
    .filter((r) => {
      const row = palette.lookup(lang, col(r, 'kanji'))
      return !classicalEchoOf(row)
    })
}

const ECHO_HEADER = ['language', 'kanji', 'inscription_form', 'readings', 'core_meanings', 'draft_classical_echo (unverified, from the draft)', 'echo_state', 'reviewed_by', 'classical_text', 'classical_source', 'reviewer_comment']

const EN_HEADER = ['kanji', 'ja_reading', 'pinyin', 'current_english_meaning', 'inscription_form', 'romaji', 'all_core_meanings', 'in_zh_palette', 'palette_status', 'suggested_meaning', 'reviewer_comment']

/** One row per Japanese palette row an English buyer can be shown (everything but hard_block). */
export function enMeaningRows() {
  return palette
    .values()
    .filter((r) => r.language === 'ja' && r.status !== 'hard_block')
    .map((r) => {
      const zh = palette.lookup('zh', r.kanji) ?? (r.inscription_form ? palette.lookup('zh', r.inscription_form) : undefined)
      return [
        r.kanji,
        r.readings.join('|'),
        zh ? zh.readings.join('|') : '',
        plainMeaning(r.raw.core_meanings, 'ja'),
        r.inscription_form,
        romanizeReadings(r.readings),
        r.raw.core_meanings,
        zh ? 'yes' : 'no (not offered as a main candidate to English buyers)',
        r.status,
        '',
        '',
      ]
    })
}

export function reviewFiles() {
  const files = {}
  for (const lang of ['ja', 'zh']) {
    files[`palette_${lang}.csv`] = toCsv([[...header, 'reviewer_comment'], ...rows.filter((r) => r[langIdx] === lang).map((r) => [...r, ''])])
    files[`classical_echo_${lang}.csv`] = toCsv([
      ECHO_HEADER,
      ...echoRows(lang).map((r) => {
        const draft = col(r, 'classical_echo')
        const reviewed = !/^(draft|interim)-/.test(col(r, 'reviewed_by')) && col(r, 'reviewed_by') !== ''
        const state = !draft || draft === 'none' ? 'empty' : reviewed ? 'reviewed-but-no-valid-line' : 'draft-unreviewed'
        return [col(r, 'language'), col(r, 'kanji'), col(r, 'inscription_form'), col(r, 'readings'), col(r, 'core_meanings'), draft === 'none' ? '' : draft, state, col(r, 'reviewed_by'), '', '', '']
      }),
    ])
  }
  files['palette_review_en_meanings.csv'] = toCsv([EN_HEADER, ...enMeaningRows()])
  return files
}

if (process.argv[1] === import.meta.filename) {
  const files = reviewFiles()
  const dir = join(root, 'review')
  if (process.argv.includes('--check')) {
    let stale = false
    for (const [name, text] of Object.entries(files)) {
      let current = ''
      try { current = readFileSync(join(dir, name), 'utf8') } catch {}
      if (current !== text) { console.error(`review/${name} is out of date — run node scripts/export-review.mjs`); stale = true }
    }
    process.exit(stale ? 1 : 0)
  }
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text)
    console.log(`review/${name}: ${text.split('\n').length - 2} rows`)
  }
}
