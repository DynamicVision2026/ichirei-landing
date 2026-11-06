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

/** The story step of the page (engine/analytics.ts FLOW_EVENTS): codes only — the language, the question set and a known question id. Never text. */
export type FlowEvent = 'story_opened' | 'question_shown' | 'question_switched' | 'voice_used' | 'draft_restored' | 'story_submitted' | 'followup_shown' | 'reveal_shown'
export function trackFlow(event: FlowEvent, fields: { language?: string; set?: string | null; qid?: string | null } = {}): void {
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source: 'customer', event, language: fields.language, set: fields.set ?? undefined, qid: fields.qid ?? undefined }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}

/** The free card preview (engine/analytics.ts PREVIEW_EVENTS): codes and counts only — never a character, a poem or a story. */
export type PreviewEvent = 'card_preview_shown' | 'candidates_retry' | 'pictures_before_pay' | 'preview_to_order'
export function trackPreview(event: PreviewEvent, fields: { language?: string; n?: 1 | 2; state?: 'shown' | 'limited' | 'failed'; secs?: number } = {}): void {
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source: 'customer', event, ...fields }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}

/** Sharing the film or the poem card (engine/analytics.ts SHARE_EVENTS): the kind and the role only — never a character, a name or a story. */
export function trackShare(event: 'share_film_tap' | 'share_card_tap', role: 'sender' | 'receiver'): void {
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source: 'customer', event, role }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}
