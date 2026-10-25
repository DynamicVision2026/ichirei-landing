// The learning loop (production, privacy-safe): per-session choice events written as daily JSONL under
// `analytics/YYYY-MM-DD.jsonl` in the order bucket. NEVER a story, a name, an order_ref, an email or any free
// text: only codes (language, relationship, occasion), slots and booleans, tied together by a random session id
// the browser makes up. scripts/report-choices.mjs turns the files into per-language percentages.
//
// Plumbing only: nothing here judges a character. Failures are logged and swallowed — analytics must never
// cost a customer their result.

import { LANGUAGES, OCCASIONS, RELATIONSHIPS, type EngineResult, type Language, type Occasion, type Relationship } from './contract.ts'
import { createOrderStore, type OrderStore } from './order-store.ts'

export const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
export const SOURCES = ['customer', 'harness'] as const
export type Source = (typeof SOURCES)[number]
/** What the buyer picked, relative to what was shown: the cinnabar primary, the other main card, or the freestyle. */
export const CHOICES = ['main', 'second', 'freestyle'] as const
export type Choice = (typeof CHOICES)[number]
/** Events the BROWSER may report; `shown` and `ordered` are written by the server itself. */
export const CLIENT_EVENTS = ['chosen', 'explain_opened'] as const

export type AnalyticsEvent =
  | { ts: string; session: string; source: Source; event: 'shown'; language: Language; relationship: Relationship | null; occasion: Occasion | null; status: 'sufficient' | 'insufficient'; main_slot: 'main' | 'second' | null; has_freestyle: boolean }
  | { ts: string; session: string; source: Source; event: 'chosen'; choice: Choice }
  | { ts: string; session: string; source: Source; event: 'explain_opened'; choice: Choice | null }
  | { ts: string; session: string; source: Source; event: 'ordered' }

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
  const choice = (CHOICES as readonly string[]).includes(b.choice as string) ? (b.choice as Choice) : null
  const ts = now.toISOString()
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
    status: result.status,
    main_slot: result.status === 'sufficient' && primary ? (primary.slot === 'second' ? 'second' : 'main') : null,
    has_freestyle: result.status === 'sufficient' && Boolean(result.freestyle_kanji),
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
