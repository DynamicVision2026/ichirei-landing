// Repeats made visible: one log line per finished run with the MAIN character the sender was shown and how many times that character
// has been the main today (JST business day) on this instance. Codes and one character only — never story text. Plumbing only: nothing here
// judges or steers a choice (the variety preference lives in engine/lexicon-prompt.md).
//
// Cloud Run may run several instances and scales to zero, so the in-process count is per instance. The day's TOTAL for each character is
// the number of these lines for that character in Cloud Logging (see DEPLOY.md, "Daily count of main characters").

import type { EngineResult } from './contract.ts'
import { analyticsDay } from './analytics.ts'

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
    const line = { day, kanji: result.primary_kanji, count_today_on_this_instance: count, source: sourceOf(result), language: result.language, relationship: result.relationship, occasion: result.occasion }
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
