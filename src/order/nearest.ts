/** The index of the drawn slot nearest to `i` (an earlier one wins a tie), or null when none is drawn. Client-side twin of engine/film-pictures.ts nearestDrawn. */
export function nearestDrawn(drawn: readonly boolean[], i: number): number | null {
  for (let d = 1; d < drawn.length; d++) {
    if (i - d >= 0 && drawn[i - d]) return i - d
    if (i + d < drawn.length && drawn[i + d]) return i + d
  }
  return null
}
