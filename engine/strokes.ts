// Stroke counts for the carving check (engine/strokes.csv: `char,strokes`, 13,108 characters). Source: KANJIDIC2 (Electronic Dictionary
// Research and Development Group, CC BY-SA 4.0), via the MIT-licensed npm package `kanji-data` 1.1.0 — read once, 2026-10-28.
// Plumbing only: counts and compares, never judges a character.

import { readFileSync } from 'node:fs'
import { DEFAULT_SIMPLE_MAX_STROKES, type StrokeInfo } from '../src/order/strokes.ts'
import { parseCsv, resolveSiblingPath } from './palette.ts'
import type { EngineResult } from './contract.ts'

let table: Map<string, number> | null = null

export function loadStrokes(): Map<string, number> {
  if (table && process.env.ICHIREI_CACHE_PROMPT !== '0') return table
  const path = resolveSiblingPath('strokes.csv', process.env.ICHIREI_STROKES_PATH)
  const [header, ...body] = parseCsv(readFileSync(path, 'utf8'))
  if (!header || header.join(',') !== 'char,strokes') throw new Error('strokes.csv: header must be char,strokes')
  table = new Map(body.map((r) => [r[0], Number(r[1])]))
  return table
}

/** ICHIREI_SIMPLE_MAX_STROKES (default 20): the Simple set takes at most this many strokes. */
export function simpleMaxStrokes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ICHIREI_SIMPLE_MAX_STROKES)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SIMPLE_MAX_STROKES
}

/** No simplified Chinese character in the palette has more strokes than this (the biggest, e.g. 樱 辅 赠, have 15–16). */
export const SIMPLIFIED_CAP = 20

/**
 * Strokes of a glyph. A simplified Chinese form that KANJIDIC does not hold (让 欢 续 …) takes the traditional form's count as an upper
 * bound, but never more than SIMPLIFIED_CAP (讓 has 24 strokes; 让 has 5). So with the default limit of 20 a simplified glyph is always
 * allowed on the Simple set; with a lower limit it errs towards the Standard set until exact counts are added. Unknown → null.
 */
export function strokesOf(glyph: string, fallbackGlyph?: string | null): number | null {
  const t = loadStrokes()
  const own = t.get(glyph)
  if (own !== undefined) return own
  const other = fallbackGlyph ? t.get(fallbackGlyph) : undefined
  return other === undefined ? null : Math.min(other, SIMPLIFIED_CAP)
}

export function strokeInfo(c: { kanji: string; inscription_form: string | null }): StrokeInfo {
  return { kanji: strokesOf(c.kanji, c.inscription_form), inscription_form: c.inscription_form ? strokesOf(c.inscription_form, c.kanji) : null }
}

/** Attach the stroke counts to every candidate and the limit to the result, for the order form. Never throws (a missing file only means "unknown"). */
export function attachStrokes(result: EngineResult): EngineResult {
  if (result.status !== 'sufficient' || !Array.isArray(result.candidates)) return result
  try {
    return { ...result, simple_max_strokes: simpleMaxStrokes(), candidates: result.candidates.map((c) => (c.eliminated ? c : { ...c, strokes: strokeInfo(c) })) }
  } catch (err) {
    console.log(`[ichirei-engine] strokes unavailable ${JSON.stringify({ error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })}`)
    return result
  }
}
