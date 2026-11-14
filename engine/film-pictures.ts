// Which picture each of the four slots SHOWS (2026-11-14, B2). The plain washi tile is never shown in place of a picture — not on the result page, not on the gift page, not on the card PDF, not in the film:
//
//   drawn        the slot's own picture (it passed its check)
//   substituted  the slot failed for good (final washi, or a scene the script could not make safe): another PASSED picture of the same story stands in, the NEAREST scene first
//                (an earlier scene wins a tie). Its caption stays the slot's own line.
//   pending      not drawn yet (quota, an outage, a check that could not run): the waiting state while the page can wait; once the gift is delivered (`settle`), it is substituted too
//   none         no passed picture at all (a fallback script, or all four failed): the pictures block is left out and the film stays its text-and-character version
//
// Plain TS (no model, no store) so the view, the card, the film video and the tests all use the same rule.

export type ArtSlot = 'ai' | 'washi' | 'pending' | 'unchecked'
export type SlotKind = 'drawn' | 'substituted' | 'pending' | 'none'

export interface Resolution {
  kinds: SlotKind[]
  /** For each slot, the slot whose picture is shown there (its own for `drawn`, the stand-in for `substituted`), else null. */
  source: (number | null)[]
  /** At least one slot has a passed picture. */
  anyDrawn: boolean
  /** Slots that show another slot's picture. */
  substituted: number[]
  /** Slots still being drawn (only when `settle` is false). */
  pending: number[]
}

/** The passed picture nearest to slot `i` (an earlier one wins a tie), or null. */
export function nearestDrawn(slots: readonly ArtSlot[], i: number): number | null {
  let best: number | null = null
  for (let d = 1; d < slots.length; d++) {
    if (i - d >= 0 && slots[i - d] === 'ai') return i - d
    if (i + d < slots.length && slots[i + d] === 'ai') {
      best = i + d
      break
    }
  }
  return best
}

/**
 * `settle` = the gift is being delivered (or the page cannot wait any more): a slot that is still pending is treated like a failed one and gets a stand-in.
 * Without it (the result page while pictures are drawn, the buyer's page) a pending slot stays `pending` and the page shows its waiting state.
 */
export function resolveSlots(slots: readonly ArtSlot[], opts: { settle?: boolean } = {}): Resolution {
  const anyDrawn = slots.includes('ai')
  const kinds: SlotKind[] = []
  const source: (number | null)[] = []
  const substituted: number[] = []
  const pending: number[] = []
  slots.forEach((s, i) => {
    if (s === 'ai') {
      kinds.push('drawn')
      source.push(i)
    } else if ((s === 'pending' || s === 'unchecked') && !opts.settle) {
      kinds.push('pending')
      source.push(null)
      pending.push(i)
    } else {
      const j = anyDrawn ? nearestDrawn(slots, i) : null
      kinds.push(j === null ? 'none' : 'substituted')
      source.push(j)
      if (j !== null) substituted.push(i)
    }
  })
  return { kinds, source, anyDrawn, substituted, pending }
}

/** True when the pictures block must be left out: nothing passed (and nothing is still being drawn). */
export const noPictures = (slots: readonly ArtSlot[]): boolean => !slots.includes('ai') && !slots.includes('pending') && !slots.includes('unchecked')
