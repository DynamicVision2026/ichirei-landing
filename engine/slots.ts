// The last gate before a result leaves the engine: whatever the model, the referee, the review and the replacement stage did, the
// sender sees AT MOST three cards — one main (the primary), one second, one freestyle — and is never left with nothing.
// Plumbing only: it counts and trims, it never chooses between characters by merit (the order of preference is the order the
// result already states: the primary, then the runner-up, then the model's own order).

import type { Candidate, EngineResult, RefereeAction } from './contract.ts'
import { questionFor, toInsufficient } from './palette.ts'

export const SLOT_OVERFLOW_REASON = 'slots: more candidates than the slot allows'

const isMain = (c: Candidate) => c.slot !== 'freestyle'

/** At most one live primary, one live second and one live freestyle. Extras are removed (eliminated, with a reason) and logged without story text. */
export function enforceSlots(result: EngineResult, log: (line: string) => void = (l) => console.log(l)): EngineResult {
  if (result.status !== 'sufficient') return result
  const live = result.candidates.filter((c) => !c.eliminated)
  const mains = live.filter(isMain)
  const frees = live.filter((c) => !isMain(c))
  const rank = (c: Candidate) => (c.kanji === result.primary_kanji ? 0 : c.kanji === result.runner_up_kanji ? 1 : 2)
  const keepMains = new Set([...mains].sort((a, b) => rank(a) - rank(b)).slice(0, 2).map((c) => c))
  const keepFree = new Set([...frees].sort((a, b) => (a.kanji === result.freestyle_kanji ? 0 : 1) - (b.kanji === result.freestyle_kanji ? 0 : 1)).slice(0, 1))
  const extras = [...mains.filter((c) => !keepMains.has(c)), ...frees.filter((c) => !keepFree.has(c))]
  if (extras.length === 0) return result
  const actions: RefereeAction[] = [...(result.referee?.actions ?? [])]
  const dropped = new Set(extras)
  const candidates = result.candidates.map((c) => {
    if (!dropped.has(c)) return c
    actions.push({ kanji: c.kanji, action: 'slot_overflow_eliminated', detail: SLOT_OVERFLOW_REASON })
    return { ...c, eliminated: true, eliminated_reason: SLOT_OVERFLOW_REASON, flags: [...c.flags, 'slot_overflow'] }
  })
  log(`[ichirei-engine] slot_overflow ${JSON.stringify({ removed: extras.map((c) => ({ slot: c.slot, kanji: c.kanji })), kept: [...keepMains, ...keepFree].map((c) => ({ slot: c.slot, kanji: c.kanji })) })}`)
  const runnerUp = [...keepMains].find((c) => c.kanji !== result.primary_kanji)
  return {
    ...result,
    candidates,
    runner_up_kanji: runnerUp ? runnerUp.kanji : null,
    freestyle_kanji: [...keepFree][0]?.kanji ?? null,
    ...(result.referee ? { referee: { ...result.referee, actions } } : {}),
  }
}

/**
 * Close the result: the slot limits hold, and if no main candidate is live (or the model itself said `insufficient`) the sender gets
 * `insufficient` WITH a question — a result with zero cards and no question is impossible.
 */
export function finalizeResult(result: EngineResult, log?: (line: string) => void): EngineResult {
  if (result.status === 'insufficient') {
    return typeof result.follow_up_question === 'string' && result.follow_up_question.trim() ? result : { ...result, follow_up_question: questionFor(result) }
  }
  const slotted = enforceSlots(result, log)
  const primary = slotted.candidates.find((c) => !c.eliminated && isMain(c) && c.kanji === slotted.primary_kanji)
  if (primary) return slotted
  return toInsufficient(slotted)
}
