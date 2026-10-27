// Apply the first-pass (AI) review of the Japanese palette to engine/palette.csv.
//
//   node --experimental-strip-types scripts/apply-ja-review.mjs [review/ja/palette_ja.csv] [--dry-run]
//
// What it takes from the reviewed sheet, for the `ja` rows only, matched by kanji: taboo_flags, blocked_occasions (including the
// `memorial` codes), status, register_flags, readings, inscription_form and inscription_fitness — everything the reviewer changed
// is stricter or a correction (the diff was read row by row before this script was written). Then the two owner decisions:
//   寿  — do NOT block `new_baby` (寿 is widely used for births)
//   志  — `context_required` (it is the standard label on funeral return gifts)
// And it records who looked: reviewed_by = the reviewer's value ("Claude(AI一次確認)"), reviewed_on = the date — except on the 18
// hand-written `interim-unreviewed` rows, which keep that marker.
//
// AI review is NOT human review: the engine treats a reviewed_by that starts with "Claude" as NOT reviewed (engine/palette.ts
// isReviewed), so no classical line from those rows is ever shown, REQUIRE_CLASSICAL_ECHO is unaffected, and an `ok` row stays
// unvouched for. classical_echo is never touched here (review/ja/classical_echo_ja.csv is the human reviewer's starting point).
// Re-run `node scripts/export-review.mjs` afterwards.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from '../engine/palette.ts'

const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dry = process.argv.includes('--dry-run')
const sheetPath = args[0] ?? join(root, 'review', 'ja', 'palette_ja.csv')
const enginePath = join(root, 'engine', 'palette.csv')

const quote = (cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)
const toCsv = (lines) => lines.map((cells) => cells.map(quote).join(',')).join('\n') + '\n'

const engineText = readFileSync(enginePath, 'utf8')
const [header, ...rows] = parseCsv(engineText)
const [sheetHeader, ...sheetRows] = parseCsv(readFileSync(sheetPath, 'utf8').replace(/^﻿/, ''))
const ix = (h, name) => {
  const i = h.indexOf(name)
  if (i === -1) throw new Error(`column ${name} not found`)
  return i
}

const TAKE = ['taboo_flags', 'blocked_occasions', 'status', 'register_flags', 'readings', 'inscription_form', 'inscription_fitness', 'reviewed_by', 'reviewed_on']
const sheet = new Map(sheetRows.filter((r) => r[ix(sheetHeader, 'language')] === 'ja').map((r) => [r[ix(sheetHeader, 'kanji')], r]))
const changes = []
let matched = 0
for (const row of rows) {
  if (row[ix(header, 'language')] !== 'ja') continue
  const kanji = row[ix(header, 'kanji')]
  const reviewed = sheet.get(kanji)
  if (!reviewed) throw new Error(`${kanji} is not in the reviewed sheet`)
  matched++
  for (const col of TAKE) {
    // The 18 hand-written "interim-unreviewed" rows keep that marker (they still need a human's eyes); the AI pass is recorded on the rest.
    if ((col === 'reviewed_by' || col === 'reviewed_on') && /^interim-/.test(row[ix(header, 'reviewed_by')])) continue
    const before = row[ix(header, col)]
    const after = reviewed[ix(sheetHeader, col)]
    if (before !== after) {
      row[ix(header, col)] = after
      if (col !== 'reviewed_by' && col !== 'reviewed_on') changes.push(`${kanji} ${col}: ${before} -> ${after}`)
    }
  }
}
if (matched !== sheet.size) throw new Error(`reviewed sheet has ${sheet.size} ja rows, engine has ${matched}`)

// owner decisions
const edit = (kanji, col, fn) => {
  const row = rows.find((r) => r[ix(header, 'language')] === 'ja' && r[ix(header, 'kanji')] === kanji)
  if (!row) throw new Error(`${kanji} not found`)
  const before = row[ix(header, col)]
  const after = fn(before)
  if (before !== after) {
    row[ix(header, col)] = after
    changes.push(`${kanji} ${col}: ${before} -> ${after}  (owner decision)`)
  }
}
edit('寿', 'blocked_occasions', (v) => v.split('|').filter((o) => o !== 'new_baby').join('|') || 'none')
edit('志', 'status', () => 'context_required')

console.log(changes.join('\n'))
console.log(`\n${changes.length} change(s) across ${matched} ja rows${dry ? ' (dry run, nothing written)' : ''}`)
if (!dry) writeFileSync(enginePath, toCsv([header, ...rows]))
