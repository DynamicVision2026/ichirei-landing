// The learning loop (production, privacy-safe): per-session choice events written as daily JSONL under
// `analytics/YYYY-MM-DD.jsonl` in the order bucket. NEVER a story, a name, an order_ref, an email or any free
// text: only codes (language, relationship, occasion), slots and booleans, tied together by a random session id
// the browser makes up. scripts/report-choices.mjs turns the files into per-language percentages.
//
// Plumbing only: nothing here judges a character. Failures are logged and swallowed — analytics must never
// cost a customer their result.

import { PURPOSES, STATES } from '../src/order/purpose.ts'
import { LANGUAGES, OCCASIONS, RELATIONSHIPS, type EngineResult, type Language, type Occasion, type Relationship } from './contract.ts'
import { createOrderStore, type OrderStore } from './order-store.ts'
import { QUESTION_SETS, findQuestion, type QuestionSet } from './story-questions.ts'
import type { PoemType } from '../src/order/packages.ts'

export const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
export const SOURCES = ['customer', 'harness'] as const
export type Source = (typeof SOURCES)[number]
/** What the buyer picked, relative to what was shown (2026-11-07): the 本命 (`main`), the 遊び字 (`free`), or — remembrance only — the 次点 (`second`). Older events say `freestyle`; it is read as `free`. */
export const CHOICES = ['main', 'second', 'free'] as const
export type Choice = (typeof CHOICES)[number]
/** Events the BROWSER may report; `shown` and `ordered` are written by the server itself. */
/** The story step of the page (Part A, 2026-10-30): codes only — the language, the question set and the question id (a known id, never text). */
export const FLOW_EVENTS = ['story_opened', 'question_shown', 'question_switched', 'voice_used', 'draft_restored', 'story_submitted', 'followup_shown', 'reveal_shown'] as const
export type FlowEvent = (typeof FLOW_EVENTS)[number]
/** The free card preview (2026-10-30): codes only — never a character or a story. `n` = which retry (1 or 2); `state` = how the pictures went; `secs` = seconds from the pick to a complete preview. */
export const PREVIEW_EVENTS = ['card_preview_shown', 'candidates_retry', 'pictures_before_pay', 'preview_to_order'] as const
export type PreviewEvent = (typeof PREVIEW_EVENTS)[number]
export const PICTURE_STATES = ['shown', 'limited', 'failed'] as const
export type PictureState = (typeof PICTURE_STATES)[number]
/** Sharing the film or the poem card to social media (2026-11-06): codes only — which one, and who shares (sender = the buyer, receiver = the person who opened the gift). */
export const SHARE_EVENTS = ['share_film_tap', 'share_card_tap'] as const
export type ShareEvent = (typeof SHARE_EVENTS)[number]
export const SHARE_ROLES = ['sender', 'receiver'] as const
export type ShareRole = (typeof SHARE_ROLES)[number]
export const CLIENT_EVENTS = ['chosen', 'explain_opened', ...FLOW_EVENTS, ...PREVIEW_EVENTS, ...SHARE_EVENTS] as const

export type AnalyticsEvent =
  | { ts: string; session: string; source: Source; event: 'shown'; language: Language; relationship: Relationship | null; occasion: Occasion | null; purpose?: string | null; state?: string | null; status: 'sufficient' | 'insufficient'; main_slot: 'main' | 'second' | null; has_free: boolean }
  | { ts: string; session: string; source: Source; event: FlowEvent; language: Language | null; set: QuestionSet | null; qid: string | null }
  | { ts: string; session: string; source: Source; event: PreviewEvent; language: Language | null; n: 1 | 2 | null; state: PictureState | null; secs: number | null }
  | { ts: string; session: string; source: Source; event: ShareEvent; role: ShareRole }
  | { ts: string; session: string; source: Source; event: 'chosen'; choice: Choice }
  | { ts: string; session: string; source: Source; event: 'explain_opened'; choice: Choice | null }
  | { ts: string; session: string; source: Source; event: 'ordered'; poem_types?: PoemType[] }
  /** The poem add-on (no story or poem text): which types were previewed, which were added to an order. */
  | { ts: string; session: string; source: Source; event: 'poem_previewed' | 'poem_added'; poem_type: PoemType }

/** JST date (the business day) of a timestamp, YYYY-MM-DD. */
export const analyticsDay = (now: Date): string => new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
export const analyticsPath = (now: Date): string => `analytics/${analyticsDay(now)}.jsonl`

export const cleanSession = (v: unknown): string | null => (typeof v === 'string' && SESSION_PATTERN.test(v) ? v : null)
export const cleanSource = (v: unknown): Source => ((SOURCES as readonly string[]).includes(v as string) ? (v as Source) : 'customer')

/** A client-reported event, whitelisted field by field; anything else is dropped. */
export function parseClientEvent(body: unknown, now: Date): AnalyticsEvent | null {
  const b = (body ?? {}) as Record<string, unknown>
  const session = cleanSession(b.session)
  if (!session || !(CLIENT_EVENTS as readonly string[]).includes(b.event as string)) return null
  const source = cleanSource(b.source)
  const rawChoice = b.choice === 'freestyle' ? 'free' : b.choice
  const choice = (CHOICES as readonly string[]).includes(rawChoice as string) ? (rawChoice as Choice) : null
  const ts = now.toISOString()
  if ((FLOW_EVENTS as readonly string[]).includes(b.event as string)) {
    const language = (LANGUAGES as readonly string[]).includes(b.language as string) ? (b.language as Language) : null
    const qid = findQuestion(b.qid)?.question.id ?? null
    const set = (QUESTION_SETS as readonly string[]).includes(b.set as string) ? (b.set as QuestionSet) : null
    return { ts, session, source, event: b.event as FlowEvent, language, set, qid }
  }
  if ((PREVIEW_EVENTS as readonly string[]).includes(b.event as string)) {
    const language = (LANGUAGES as readonly string[]).includes(b.language as string) ? (b.language as Language) : null
    const n = b.n === 1 || b.n === 2 ? b.n : null
    const state = (PICTURE_STATES as readonly string[]).includes(b.state as string) ? (b.state as PictureState) : null
    const secs = typeof b.secs === 'number' && Number.isFinite(b.secs) && b.secs >= 0 && b.secs < 3600 ? Math.round(b.secs) : null
    return { ts, session, source, event: b.event as PreviewEvent, language, n, state, secs }
  }
  if ((SHARE_EVENTS as readonly string[]).includes(b.event as string)) return (SHARE_ROLES as readonly string[]).includes(b.role as string) ? { ts, session, source, event: b.event as ShareEvent, role: b.role as ShareRole } : null
  if (b.event === 'chosen') return choice ? { ts, session, source, event: 'chosen', choice } : null
  return { ts, session, source, event: 'explain_opened', choice }
}

/** The `shown` event for a finished engine run (codes and booleans only). */
export function shownEvent(result: EngineResult, session: string, source: Source, now: Date): AnalyticsEvent {
  const primary = result.candidates?.find((c) => c.kanji === result.primary_kanji)
  return {
    ts: now.toISOString(),
    session,
    source,
    event: 'shown',
    language: (LANGUAGES as readonly string[]).includes(result.language) ? result.language : 'ja',
    relationship: (RELATIONSHIPS as readonly string[]).includes(result.relationship as string) ? result.relationship : null,
    occasion: (OCCASIONS as readonly string[]).includes(result.occasion as string) ? result.occasion : null,
    // v9.6: codes only — never the 「その他」 texts
    purpose: (PURPOSES as readonly string[]).includes(result.purpose as string) ? (result.purpose as string) : null,
    state: (STATES as readonly string[]).includes(result.state as string) ? (result.state as string) : null,
    status: result.status,
    main_slot: result.status === 'sufficient' && primary ? (primary.slot === 'second' ? 'second' : 'main') : null,
    has_free: result.status === 'sufficient' && Boolean(result.freestyle_kanji),
  }
}

/** Append one event. Never throws. `store` defaults to the one the environment configures (null = analytics off). */
export async function recordEvent(event: AnalyticsEvent, store: OrderStore | null = createOrderStore(), now: Date = new Date()): Promise<boolean> {
  if (!store) return false
  try {
    await store.appendJsonl(analyticsPath(now), event)
    return true
  } catch (err) {
    console.error('[ichirei-analytics] append failed:', err instanceof Error ? err.message : err)
    return false
  }
}
