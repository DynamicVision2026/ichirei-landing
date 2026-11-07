// Where the free card (趣字) of each run came from — a count for /ops (2026-11-07). One line per run in `ops/cards-<day>.jsonl`: the round, the source and the reasons, in CODES only.
// Never a story, a character, a name or a session id. Best effort: a count is never a reason to lose a result.

import { analyticsDay } from './analytics.ts'
import { readJsonl } from './egift-ops.ts'
import type { OrderStore } from './order-store.ts'

export const FREE_SOURCES = ['first', 'retry', 'runner_up'] as const
export type FreeSource = (typeof FREE_SOURCES)[number]
export interface FreeSourceLine {
  ts: string
  round: 1 | 2 | 3
  source: FreeSource | null
  reasons: string[]
}

export const freeSourcePath = (now: Date): string => `ops/cards-${analyticsDay(now)}.jsonl`

const cleanCode = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9_:]/g, '').slice(0, 40)

export async function recordFreeSource(store: OrderStore | null, info: { round: number; source: FreeSource | null; reasons: string[] }, now: Date = new Date()): Promise<void> {
  if (!store) return
  try {
    const round = info.round === 2 || info.round === 3 ? info.round : 1
    const line: FreeSourceLine = { ts: now.toISOString(), round, source: info.source && (FREE_SOURCES as readonly string[]).includes(info.source) ? info.source : null, reasons: [...new Set(info.reasons.map(cleanCode).filter(Boolean))].slice(0, 12) }
    await store.appendJsonl(freeSourcePath(now), line)
  } catch (err) {
    console.error('[ichirei-ops] free_source append failed', err instanceof Error ? err.message : err)
  }
}

export interface FreeSourceCounts {
  runs: number
  by_source: Record<FreeSource | 'none', number>
  /** per round (1, 2, 3): the same split — the rounds where the third card used to go missing */
  by_round: Record<1 | 2 | 3, Record<FreeSource | 'none', number>>
  /** how often each reason made a later step necessary (or cost the card) */
  reasons: Record<string, number>
}

const emptySplit = (): Record<FreeSource | 'none', number> => ({ first: 0, retry: 0, runner_up: 0, none: 0 })

export async function readFreeSourceCounts(store: OrderStore, days: string[]): Promise<FreeSourceCounts> {
  const out: FreeSourceCounts = { runs: 0, by_source: emptySplit(), by_round: { 1: emptySplit(), 2: emptySplit(), 3: emptySplit() }, reasons: {} }
  for (const day of days) {
    let lines: FreeSourceLine[] = []
    try {
      lines = await readJsonl<FreeSourceLine>(store, `ops/cards-${day}.jsonl`)
    } catch {
      lines = []
    }
    for (const l of lines) {
      const key = l.source && (FREE_SOURCES as readonly string[]).includes(l.source) ? l.source : 'none'
      const round = l.round === 2 || l.round === 3 ? l.round : 1
      out.runs++
      out.by_source[key]++
      out.by_round[round][key]++
      for (const r of Array.isArray(l.reasons) ? l.reasons : []) out.reasons[r] = (out.reasons[r] ?? 0) + 1
    }
  }
  return out
}

// ---- the main character (本命) of every run, for the owner's "which characters keep coming back" table (2026-11-07) ------------------------------------------------------------------------
// One line per finished run in `ops/mains-<day>.jsonl`: the round, the language and the main character (and the second). Never a story, a name or a session id.

export interface MainLine {
  ts: string
  round: 1 | 2 | 3
  language: string
  main: string
  second: string | null
}

export const mainPath = (now: Date): string => `ops/mains-${analyticsDay(now)}.jsonl`
const oneChar = (v: unknown): string | null => (typeof v === 'string' && [...v.trim()].length === 1 && /\p{Script=Han}/u.test(v.trim()) ? v.trim() : null)

export async function recordMain(store: OrderStore | null, info: { round: number; language: string; main: string; second?: string | null }, now: Date = new Date()): Promise<void> {
  if (!store) return
  try {
    const main = oneChar(info.main)
    if (!main) return
    const line: MainLine = { ts: now.toISOString(), round: info.round === 2 || info.round === 3 ? info.round : 1, language: ['ja', 'zh-Hans', 'zh-Hant', 'en'].includes(info.language) ? info.language : 'ja', main, second: oneChar(info.second) }
    await store.appendJsonl(mainPath(now), line)
  } catch (err) {
    console.error('[ichirei-ops] main append failed', err instanceof Error ? err.message : err)
  }
}

export interface MainCounts {
  runs: number
  /** the ten most common main characters over the days read, most common first */
  top: { kanji: string; count: number; share: number }[]
}

export async function readMainCounts(store: OrderStore, days: string[], top = 10): Promise<MainCounts> {
  const count = new Map<string, number>()
  let runs = 0
  for (const day of days) {
    let lines: MainLine[] = []
    try {
      lines = await readJsonl<MainLine>(store, `ops/mains-${day}.jsonl`)
    } catch {
      lines = []
    }
    for (const l of lines) {
      const k = oneChar(l.main)
      if (!k) continue
      runs++
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  const list = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([kanji, n]) => ({ kanji, count: n, share: runs ? Math.round((n / runs) * 1000) / 10 : 0 }))
  return { runs, top: list }
}
