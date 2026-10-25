// The learning loop, browser side: a random session id per page load and two fire-and-forget events.
// No story text, no names, nothing the buyer typed — only which card kind was chosen and whether the
// explanation was opened (engine/analytics.ts keeps the rest; scripts/report-choices.mjs reports it).

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function makeId(): string {
  const bytes = new Uint8Array(24)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export const sessionId: string = makeId()
export type Source = 'customer' | 'harness'
export type Choice = 'main' | 'second' | 'freestyle'

/** Which kind of card: the cinnabar primary, the other main card, or the freestyle. */
export const choiceOf = (c: { slot: string; kanji: string }, primaryKanji: string | null): Choice =>
  c.slot === 'freestyle' ? 'freestyle' : c.kanji === primaryKanji ? 'main' : 'second'

export function track(event: 'chosen' | 'explain_opened', source: Source, choice: Choice): void {
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source, event, choice }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}
