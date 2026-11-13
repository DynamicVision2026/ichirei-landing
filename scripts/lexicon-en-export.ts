// Write the English reviewer's spreadsheet (ticket 2026-11-12, Part A): every row of engine/lexicon.csv with its kanji, reading, Japanese meaning and classical line, and the three English columns to fill.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/lexicon-en-export.ts [out.csv]   (default: docs/lexicon-en-review.csv)
import { writeFileSync } from 'node:fs'
import { exportForReviewer } from '../engine/lexicon-en.ts'
import { loadLexicon } from '../engine/lexicon.ts'
import { loadPalette } from '../engine/palette.ts'

const out = process.argv[2] ?? 'docs/lexicon-en-review.csv'
const lexicon = loadLexicon()
writeFileSync(out, exportForReviewer(lexicon, loadPalette()))
console.log(`${lexicon.size} rows (${lexicon.distinct().length} characters) written to ${out}`)
