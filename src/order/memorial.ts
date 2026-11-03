// Remembrance (occasion `memorial`): the one place that says how a memorial result is drawn and carved.
// Plain TS, no imports: used by the browser (Reveal, OrderForm), the order code and the story-run checker.
//
// In Japan a red name on a grave means a living person, so for memorial results the MAIN character is ink
// (black) — or gold — never cinnabar; the same goes for the carving (the workshop reads `ichirei_memorial=yes`).

export type MainGlyphTone = 'ink' | 'cinnabar'

export const isMemorial = (occasion: string | null | undefined): boolean => occasion === 'memorial'

/** The colour family of the main character: ink for remembrance, cinnabar for everything else. */
export const mainGlyphTone = (occasion: string | null | undefined): MainGlyphTone => (isMemorial(occasion) ? 'ink' : 'cinnabar')

/**
 * Launch freeze: ONE rule for "ink, never red" on every page that shows the character — a remembrance (its wording stays its own) and the quiet purposes (apology, encouragement).
 * A view carries `memorial` and, from v9.6, the purpose the rules used.
 */
export const inkOnly = (v: { memorial?: boolean; purpose?: string | null }): boolean => v.memorial === true || v.purpose === 'apology' || v.purpose === 'encourage' || v.purpose === 'memorial'
