// Health counters for /ops/stats (2026-11-14): things that went wrong or were rescued, as CODES per day — never a story, a name, an address or an order's contents.
// One line per event in `ops/health-<day>.jsonl`: { ts, code, ref?, slot?, reason? } where `ref` is an order reference or an animation id (both private, opaque ids) and `reason` a short code.
// Best effort: a counter is never a reason to lose a result or to stop an order.

import { analyticsDay } from './analytics.ts'
import { readJsonl } from './egift-ops.ts'
import type { OrderStore } from './order-store.ts'

/** The codes /ops/stats shows. `red` = the owner must look (money or a customer who may be waiting for nothing). */
export const HEALTH_CODES = [
  'en_cart_currency_mismatch',
  'certificate_no_missing',
  'picture_substituted',
  'pictures_none',
  'picture_empty',
  'picture_text',
  'picture_setting',
  'picture_failed',
  'poem_failed',
  'film_fallback',
  'gift_incomplete',
  'needs_attention',
  'film_blank_or_substituted',
  'film_drawn',
] as const
export type HealthCode = (typeof HEALTH_CODES)[number]
export const RED_HEALTH_CODES: readonly HealthCode[] = ['en_cart_currency_mismatch', 'needs_attention', 'certificate_no_missing']

export interface HealthLine {
  ts: string
  code: HealthCode
  ref?: string
  slot?: number
  reason?: string
}

export const healthPath = (now: Date): string => `ops/health-${analyticsDay(now)}.jsonl`
const cleanCode = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9_:]/g, '').slice(0, 40)
const cleanRef = (s: unknown): string => String(s ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)

export async function recordHealth(store: OrderStore | null, code: HealthCode, info: { ref?: string; slot?: number; reason?: string } = {}, now: Date = new Date()): Promise<void> {
  if (!store || !(HEALTH_CODES as readonly string[]).includes(code)) return
  try {
    const line: HealthLine = { ts: now.toISOString(), code, ...(info.ref ? { ref: cleanRef(info.ref) } : {}), ...(Number.isInteger(info.slot) ? { slot: info.slot } : {}), ...(info.reason ? { reason: cleanCode(info.reason) } : {}) }
    await store.appendJsonl(healthPath(now), line)
  } catch (err) {
    console.error('[ichirei-health] append failed', err instanceof Error ? err.message : err)
  }
}

export interface HealthCounts {
  /** per day (YYYY-MM-DD, Japan time) and code */
  by_day: Record<string, Partial<Record<HealthCode, number>>>
  /** totals over the days read */
  total: Partial<Record<HealthCode, number>>
  /** per-reason counts of the picture failures (text / setting / religious / face …), over the days read */
  reasons: Record<string, number>
}

export async function readHealth(store: OrderStore, days: string[]): Promise<HealthCounts> {
  const out: HealthCounts = { by_day: {}, total: {}, reasons: {} }
  for (const day of days) {
    let lines: HealthLine[] = []
    try {
      lines = await readJsonl<HealthLine>(store, `ops/health-${day}.jsonl`)
    } catch {
      lines = []
    }
    const d: Partial<Record<HealthCode, number>> = {}
    for (const l of lines) {
      if (!(HEALTH_CODES as readonly string[]).includes(l.code)) continue
      d[l.code] = (d[l.code] ?? 0) + 1
      out.total[l.code] = (out.total[l.code] ?? 0) + 1
      if (l.reason && (l.code === 'picture_substituted' || l.code === 'picture_empty' || l.code === 'picture_failed')) out.reasons[l.reason] = (out.reasons[l.reason] ?? 0) + 1
    }
    out.by_day[day] = d
  }
  return out
}
