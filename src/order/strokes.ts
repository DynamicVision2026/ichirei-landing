// The carving check (spec v9.1 step 9): the Simple set only takes characters of at most ICHIREI_SIMPLE_MAX_STROKES strokes (default 20,
// the owner's number until the workshop gives the real limit); above it the Standard set only. The stroke counts are attached to each
// candidate by the server (engine/strokes.ts) and re-checked there when the order arrives — the browser's copy is only for the display.
// Plain TS, no imports: shared by the browser and the server.

export const DEFAULT_SIMPLE_MAX_STROKES = 20

/** Stroke counts of the two forms of a candidate; null = unknown (then the Standard set only). */
export interface StrokeInfo {
  kanji: number | null
  inscription_form: number | null
}

/** Can the Simple set carve a glyph with this many strokes? An unknown count is not allowed (the Standard set is always possible). */
export const simpleAvailable = (strokes: number | null | undefined, max: number = DEFAULT_SIMPLE_MAX_STROKES): boolean => typeof strokes === 'number' && strokes <= max

/** The stroke count of the glyph that will be carved, given which form it is. */
export function carvedStrokes(
  candidate: { kanji: string; inscription_form: string | null; strokes?: StrokeInfo | null },
  glyph: string,
): number | null {
  const s = candidate.strokes
  if (!s) return null
  if (glyph === candidate.kanji) return s.kanji
  if (candidate.inscription_form !== null && glyph === candidate.inscription_form) return s.inscription_form
  return null
}
