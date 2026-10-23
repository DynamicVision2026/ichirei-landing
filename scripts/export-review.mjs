// Export the palette for human reviewers: one CSV per language family, the same 17
// columns as engine/palette.csv plus an empty `reviewer_comment` column.
//
//   node scripts/export-review.mjs          # writes review/palette_ja.csv and review/palette_zh.csv
//   node scripts/export-review.mjs --check  # exits 1 if the files in review/ are out of date
//
// engine/palette.csv stays the single source of truth; reviewers send comments back
// and the changes are applied there. Re-run this after any palette edit.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from '../engine/palette.ts'

const root = join(import.meta.dirname, '..')
const [header, ...rows] = parseCsv(readFileSync(join(root, 'engine', 'palette.csv'), 'utf8'))
const langIdx = header.indexOf('language')

const quote = (cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)
const toCsv = (lines) => lines.map((cells) => cells.map(quote).join(',')).join('\n') + '\n'

export function reviewFiles() {
  return Object.fromEntries(
    ['ja', 'zh'].map((lang) => [
      `palette_${lang}.csv`,
      toCsv([[...header, 'reviewer_comment'], ...rows.filter((r) => r[langIdx] === lang).map((r) => [...r, ''])]),
    ]),
  )
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
