// Repeats made visible: one log line per finished run with the MAIN character the sender was shown and how many times that character
// has been the main today (JST business day) on this instance. Codes and one character only — never story text. Plumbing only: nothing here
// judges or steers a choice (the variety preference lives in engine/lexicon-prompt.md).
//
// Cloud Run may run several instances and scales to zero, so the in-process count is per instance. The day's TOTAL for each character is
// the number of these lines for that character in Cloud Logging (see DEPLOY.md, "Daily count of main characters").

import type { EngineResult } from './contract.ts'
import { analyticsDay } from './analytics.ts'
import { BROAD_VIRTUES } from './lexicon.ts'
import { isJoyo } from './joyo.ts'

let tally = { day: '', counts: new Map<string, number>() }

/** Where the main came from: the classical lexicon, the palette engine, or the palette engine after a lexicon miss. */
const sourceOf = (r: EngineResult): 'lexicon' | 'palette' | 'palette_after_lexicon_miss' =>
  r.lexicon?.outcome === 'chosen' ? 'lexicon' : r.lexicon?.outcome === 'fallback' ? 'palette_after_lexicon_miss' : 'palette'

/** Log the main character of a finished result (sufficient ones only). Returns the line's data, or null when there was no main. Never throws. */
export function logMainCharacter(result: EngineResult, now: Date = new Date(), log: (line: string) => void = (l) => console.log(l)) {
  try {
    if (result.status !== 'sufficient' || !result.primary_kanji) return null
    const day = analyticsDay(now)
    if (tally.day !== day) tally = { day, counts: new Map() }
    const count = (tally.counts.get(result.primary_kanji) ?? 0) + 1
    tally.counts.set(result.primary_kanji, count)
    const line = { day, kanji: result.primary_kanji, count_today_on_this_instance: count, source: sourceOf(result), broad_virtue: BROAD_VIRTUES.includes(result.primary_kanji), joyo: isJoyo(result.primary_kanji), language: result.language, relationship: result.relationship, occasion: result.occasion }
    log(`[ichirei-main] ${JSON.stringify(line)}`)
    return line
  } catch {
    return null
  }
}

/** Tests only. */
export const resetMainTally = () => {
  tally = { day: '', counts: new Map() }
}

/**
 * Spec v9.1 step 11: every card removed for SAFETY, with the reason — one line per run, only when something was removed. Codes, characters
 * and the rule names only, never story text. `by` says who removed it: the palette referee (levels 1 and 3, the lexicon list), the
 * review call (the named safety rule), or the slot gate (a repeated character, a fourth card).
 */
export function logSafetyRemovals(result: EngineResult, log: (line: string) => void = (l) => console.log(l)) {
  try {
    const removed = (result.candidates ?? [])
      .filter((c) => c.eliminated && typeof c.eliminated_reason === 'string' && /^(palette:|review:|slots:|freestyle:)/.test(c.eliminated_reason))
      .map((c) => {
        const reason = c.eliminated_reason as string
        const by = reason.startsWith('review:') ? 'review' : reason.startsWith('slots:') ? 'slots' : 'referee'
        const rule = by === 'review' ? (reason.match(/^review: ([a-z]+):/)?.[1] ?? null) : null
        return { slot: c.slot, kanji: c.kanji, by, ...(rule ? { rule } : {}), reason: reason.slice(0, 120) }
      })
    if (removed.length === 0) return null
    const line = { language: result.language, relationship: result.relationship, occasion: result.occasion, direction: result.direction, removed }
    log(`[ichirei-safety] removed ${JSON.stringify(line)}`)
    return line
  } catch {
    return null
  }
}
