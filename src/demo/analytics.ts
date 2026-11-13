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

// One anonymous id per browser TAB (sessionStorage only — never a cookie, never sent to a third party): the dashboard counts visitors by it. Without storage it is per page load.
function tabSessionId(): string {
  try {
    const k = 'ichirei-sid'
    const had = window.sessionStorage.getItem(k)
    if (had && /^[A-Za-z0-9_-]{16,64}$/.test(had)) return had
    const id = makeId()
    window.sessionStorage.setItem(k, id)
    return id
  } catch {
    return makeId()
  }
}
export const sessionId: string = tabSessionId()
export type Source = 'customer' | 'harness'
export type Choice = 'main' | 'second' | 'free'

/** Which kind of card (2026-11-07): the 本命 (`main`), the 遊び字 (`free`) or, in remembrance only, the 次点 (`second`). */
export const choiceOf = (c: { slot: string; kanji: string }, primaryKanji: string | null): Choice =>
  c.slot === 'freestyle' ? 'free' : c.kanji === primaryKanji ? 'main' : 'second'

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
export type FlowEvent = 'chips_done' | 'story_opened' | 'question_shown' | 'question_switched' | 'voice_used' | 'draft_restored' | 'story_submitted' | 'followup_shown' | 'reveal_shown'
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

/** A page view for the owner dashboard (once per tab session): the page language and the referrer's HOST only (the server turns it into a bucket and keeps only the bucket). */
export function trackPageView(language: string): void {
  try {
    const flag = 'ichirei-pv'
    if (window.sessionStorage.getItem(flag)) return
    window.sessionStorage.setItem(flag, '1')
  } catch {
    // (without storage every load counts as a visit)
  }
  try {
    let ref = ''
    try {
      ref = document.referrer ? new URL(document.referrer).hostname : ''
    } catch {
      ref = ''
    }
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source: 'customer', event: 'page_view', language, ref, own: window.location.hostname }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}

/** The receiver opened the envelope of a gift: the gift link goes to the server only to be hashed (never stored as it is). */
export function trackReceiverOpened(token: string): void {
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source: 'customer', event: 'receiver_opened', gift: token }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}

/** The US e-gift launch's events (2026-11-12, English pages): codes only. `code` is an occasion chip code (src/order/en-chips.ts). */
export function trackUs(event: 'us_banner_seen' | 'occasion_chip' | 'egift_scheduled' | 'receiver_saved_card' | 'receiver_replied', code?: string): void {
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, source: 'customer', event, ...(code ? { code } : {}) }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // analytics must never get in the way
  }
}
