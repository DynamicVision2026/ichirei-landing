// Write the English reviewer's columns (en_word, en_echo, en_reviewed_by) back into engine/lexicon.csv, by kanji (ticket 2026-11-12, Part A). The Japanese and Chinese columns are never touched.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/lexicon-en-import.ts <reviewed.csv> [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs'
import { resolveSiblingPath } from '../engine/palette.ts'
import { importReviewed } from '../engine/lexicon-en.ts'

const file = process.argv[2]
if (!file) {
  console.error('usage: lexicon-en-import.ts <reviewed.csv> [--dry-run]')
  process.exit(2)
}
const target = resolveSiblingPath('lexicon.csv', process.env.ICHIREI_LEXICON_PATH)
const { text, report } = importReviewed(readFileSync(target, 'utf8'), readFileSync(file, 'utf8'))
console.log(`${report.written.length} characters written (${report.rows_changed} lexicon rows changed), ${report.skipped.length} skipped, ${report.warnings.length} warnings`)
for (const s of report.skipped) console.log(`  skipped ${s.kanji}: ${s.reason}`)
for (const w of report.warnings) console.log(`  warning ${w.kanji}: ${w.warning}`)
if (process.argv.includes('--dry-run')) console.log('(dry run: nothing written)')
else writeFileSync(target, text)
