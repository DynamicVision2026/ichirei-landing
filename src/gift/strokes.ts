// The stroke file of the gift ceremony (public/strokes/kanjivg-subset.json, from KanjiVG — CC BY-SA 3.0): fetched once per page, and the timing of the writing.

export interface StrokeFile {
  viewBox: number
  chars: Record<string, string[]>
}

let loaded: Promise<StrokeFile | null> | null = null
/** The stroke file, fetched once per page. null when it cannot be had (the glyph then fades in). */
export function loadStrokes(): Promise<StrokeFile | null> {
  if (!loaded) {
    loaded = fetch('/strokes/kanjivg-subset.json')
      .then((r) => (r.ok ? (r.json() as Promise<StrokeFile>) : null))
      .catch(() => null)
  }
  return loaded
}

export const strokeMs = (n: number): { per: number; gap: number; total: number } => {
  const per = Math.max(140, Math.min(420, Math.round(2200 / Math.max(1, n))))
  const gap = Math.round(per * 0.2)
  return { per, gap, total: n * (per + gap) }
}

