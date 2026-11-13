// The English layer of the lexicon (ticket 2026-11-12, Part A): the CSV the English reviewer works in, and the import that writes her three columns back by kanji.
//
//   export:  node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/lexicon-en-export.ts <out.csv>
//   import:  node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/lexicon-en-import.ts <reviewed.csv>
//
// Only the three columns en_word, en_echo and en_reviewed_by are ever written; every other cell of engine/lexicon.csv (the Japanese and Chinese columns included) stays byte for byte as it was.

import { LEXICON_COLUMNS, LEXICON_EN_COLUMNS, lexiconRowIn, parseLexicon, type Lexicon } from './lexicon.ts'
import { parseCsv, isAiReviewer, type Palette } from './palette.ts'
import { romanizeReadings } from './romaji.ts'

const quote = (c: string): string => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
/** CSV text with the same quoting rules the lexicon file already uses (a parse → write round trip of engine/lexicon.csv is byte for byte). */
export const toCsv = (rows: string[][]): string => rows.map((r) => r.map(quote).join(',')).join('\n') + '\n'

/** lexicon.csv text with the three English columns present (added empty when the file still has the 17 columns). Idempotent. */
export function withEnglishColumns(text: string): string {
  const rows = parseCsv(text)
  if (rows[0]?.length === LEXICON_COLUMNS.length + LEXICON_EN_COLUMNS.length) return text
  return toCsv(rows.map((r, i) => (i === 0 ? [...r, ...LEXICON_EN_COLUMNS] : [...r, ...LEXICON_EN_COLUMNS.map(() => '')])))
}

/** A reviewed English row: the reviewer's initials and date are filled, and it is not a draft / interim / AI marker. */
export const enReviewed = (by: string): boolean => by.trim() !== '' && !/^(draft|interim)-/i.test(by.trim()) && !isAiReviewer(by)

/** One or two words, letters (and a hyphen) only: the shape of an `en_word`. */
export const EN_WORD_SHAPE = /^[A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*)?$/

// ---- export --------------------------------------------------------------------------------------------------------------------------------------------

export const EXPORT_COLUMNS = ['kanji', 'reading', 'meaning_ja', 'meaning_in_line', 'person_quality', 'fits_relationships', 'memorial', 'line_original', 'source', 'source_url', 'ja_reviewed_by', 'en_word', 'en_echo', 'en_reviewed_by', 'en_rendering', 'en_source'] as const

/** The reviewer's spreadsheet: every lexicon row with its kanji, reading, Japanese meaning and classical line, and the three English columns to fill. */
export function exportForReviewer(lexicon: Lexicon, palette: Palette): string {
  const rows: string[][] = [[...EXPORT_COLUMNS]]
  for (const r of lexicon.rows) {
    const ja = lexiconRowIn(palette, 'ja', r.kanji)
    const readings = ja ? ja.readings.slice(0, 4) : []
    const reading = readings.length ? `${readings.map((x) => x.replace(/-/g, '')).join('・')} (${romanizeReadings(readings)})` : ''
    rows.push([
      r.kanji,
      reading,
      ja?.raw.core_meanings ?? '',
      r.raw.meaning_in_line,
      r.raw.person_quality,
      r.raw.fits_relationships,
      r.tags.has('memorial') ? 'memorial' : '',
      r.raw.line_original,
      r.raw.source,
      r.raw.source_url,
      r.raw.reviewed_by,
      r.raw.en_word,
      r.raw.en_echo,
      r.raw.en_reviewed_by,
      r.raw.en_rendering,
      r.raw.en_source,
    ])
  }
  return toCsv(rows)
}

// ---- import --------------------------------------------------------------------------------------------------------------------------------------------

export interface ImportReport {
  /** Characters whose English columns changed (every lexicon row of the character). */
  written: string[]
  /** Lexicon rows changed. */
  rows_changed: number
  /** Reviewer rows that were not written, with the reason. */
  skipped: { kanji: string; reason: string }[]
  /** Not blocking: something the reviewer may want to look at again. */
  warnings: { kanji: string; warning: string }[]
}

/** The stem of a word, to look for it (or its root) in an echo: "keeper" → "keep", "steadfast" → "stead". */
const stemOf = (w: string): string => w.toLowerCase().replace(/[^a-z]/g, '').slice(0, Math.max(3, w.length - 2))

/**
 * Write the reviewer's three columns into engine/lexicon.csv text, by kanji. The reviewer's file may carry any other columns (they are ignored) in any order; it needs `kanji`, `en_word`, `en_echo` and `en_reviewed_by`.
 * Rules: a row with `en_reviewed_by` needs a word of the right shape (one or two words); two reviewer rows for one kanji must agree; an unknown kanji is skipped; the Japanese and Chinese columns are never touched.
 */
export function importReviewed(lexiconText: string, reviewerCsv: string): { text: string; report: ImportReport } {
  const report: ImportReport = { written: [], rows_changed: 0, skipped: [], warnings: [] }
  const rows = parseCsv(withEnglishColumns(lexiconText))
  const header = rows[0]
  const at = (name: string): number => header.indexOf(name)
  const [iKanji, iWord, iEcho, iBy, iRender, iSource] = ['kanji', ...LEXICON_EN_COLUMNS].map(at)
  const theirs = parseCsv(reviewerCsv.replace(/^﻿/, ''))
  const h = theirs[0] ?? []
  const col = (name: string): number => h.indexOf(name)
  for (const need of ['kanji', 'en_word', 'en_echo', 'en_reviewed_by']) if (col(need) === -1) throw new Error(`the reviewer's file has no "${need}" column`)
  const known = new Set(rows.slice(1).map((r) => r[iKanji]))
  const wanted = new Map<string, { word: string; echo: string; by: string; rendering: string; source: string }>()
  for (const t of theirs.slice(1)) {
    const kanji = (t[col('kanji')] ?? '').trim()
    if (!kanji) continue
    const optional = (name: string): string => (col(name) === -1 ? '' : (t[col(name)] ?? '').trim())
    const entry = { word: (t[col('en_word')] ?? '').trim(), echo: (t[col('en_echo')] ?? '').trim(), by: (t[col('en_reviewed_by')] ?? '').trim(), rendering: optional('en_rendering'), source: optional('en_source') }
    if (!known.has(kanji)) {
      report.skipped.push({ kanji, reason: 'not a character of the lexicon' })
      continue
    }
    const before = wanted.get(kanji)
    if (before && (before.word !== entry.word || before.echo !== entry.echo || before.by !== entry.by || before.rendering !== entry.rendering || before.source !== entry.source)) {
      report.skipped.push({ kanji, reason: 'two rows for this character disagree' })
      wanted.delete(kanji)
      known.delete(kanji)
      continue
    }
    if (entry.by && !enReviewed(entry.by)) {
      report.skipped.push({ kanji, reason: `"${entry.by}" is not a reviewer's initials and date` })
      continue
    }
    if (entry.by && !EN_WORD_SHAPE.test(entry.word)) {
      report.skipped.push({ kanji, reason: entry.word ? `"${entry.word}" is not one or two words` : 'reviewed, but no en_word' })
      continue
    }
    if (entry.word && !EN_WORD_SHAPE.test(entry.word)) {
      report.skipped.push({ kanji, reason: `"${entry.word}" is not one or two words` })
      continue
    }
    if (entry.echo && !/\s[—–-]\s?\S/.test(entry.echo)) report.warnings.push({ kanji, warning: 'the echo should end with an em dash and its source' })
    if (entry.echo && entry.word && !entry.echo.toLowerCase().includes(stemOf(entry.word.split(' ')[0]))) report.warnings.push({ kanji, warning: `the echo does not seem to contain "${entry.word}" or its root` })
    if (entry.echo && !entry.by) report.warnings.push({ kanji, warning: 'an echo without en_reviewed_by is not shown' })
    wanted.set(kanji, entry)
  }
  const changed = new Set<string>()
  const out = rows.map((r, i) => {
    if (i === 0) return r
    const w = wanted.get(r[iKanji])
    if (!w) return r
    // the optional columns are written only when the reviewer's file has them (a file with just the three never blanks an earlier rendering)
    const hasOptional = col('en_rendering') !== -1 || col('en_source') !== -1
    const render = hasOptional ? w.rendering : r[iRender]
    const source = hasOptional ? w.source : r[iSource]
    if (r[iWord] === w.word && r[iEcho] === w.echo && r[iBy] === w.by && r[iRender] === render && r[iSource] === source) return r
    report.rows_changed++
    changed.add(r[iKanji])
    const copy = [...r]
    copy[iWord] = w.word
    copy[iEcho] = w.echo
    copy[iBy] = w.by
    copy[iRender] = render
    copy[iSource] = source
    return copy
  })
  report.written = [...changed]
  const text = toCsv(out)
  parseLexicon(text) // must still load
  return { text, report }
}
