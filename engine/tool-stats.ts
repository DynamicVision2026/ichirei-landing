// The Relationship Map tool's own numbers (Ticket 7, Part 31): read server-side from https://tools.beyondculture.ai/api/stats with the token in Secret Manager (PROMO_STATS_TOKEN; the service account already has
// access). The tool lives in its own repo and service — this only READS. Counts only; nothing personal. If the tool does not answer (or answers something unreadable) the caller shows "Tool stats unavailable"
// and the rest of the page works. The answer is read tolerantly (field names and the two usual shapes: a list of day rows, or day → language → row) and cached for a minute.

import { readSecret } from './track.ts'

export const TOOL_STATS_URL = 'https://tools.beyondculture.ai/api/stats'
export const TOOL_STATS_SECRET = 'PROMO_STATS_TOKEN'
export type ToolLang = 'ja' | 'en' | 'zh'

export interface ToolDayRow {
  day: string
  lang: ToolLang
  starts: number
  /** results by distance level 1–7 (index 0 = level 1) */
  results: number[]
  noResult: number
  mapped: number
  warmOpens: number
  /** clicks per product id (ichirei, …) */
  clicks: Record<string, number>
  /** clicks per product by level 1–7, when the tool says them */
  clicksByLevel: Record<string, number[]> | null
}
export interface ToolStats {
  rows: ToolDayRow[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)
const first = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}
export const toolLangOf = (v: unknown): ToolLang | null => {
  const s = String(v ?? '').toLowerCase()
  return s === 'ja' ? 'ja' : s === 'en' ? 'en' : /^zh/.test(s) ? 'zh' : null
}
const levels = (v: unknown): number[] => {
  const out = [0, 0, 0, 0, 0, 0, 0]
  if (Array.isArray(v)) v.slice(0, 7).forEach((x, i) => { out[i] = num(x) })
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^[1-7]$/.test(k)) out[Number(k) - 1] = num(x)
  return out
}
const dayOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

function rowOf(day: string, lang: ToolLang, o: Record<string, unknown>): ToolDayRow {
  const clicksRaw = first(o, 'clicks', 'offers', 'clicks_by_product', 'products')
  const clicks: Record<string, number> = {}
  const byLevel: Record<string, number[]> = {}
  if (clicksRaw && typeof clicksRaw === 'object') {
    for (const [k, v] of Object.entries(clicksRaw as Record<string, unknown>)) {
      if (!/^[a-z0-9_-]{1,24}$/i.test(k)) continue
      if (v && typeof v === 'object') {
        const lv = levels(v)
        byLevel[k.toLowerCase()] = lv
        clicks[k.toLowerCase()] = lv.reduce((a, b) => a + b, 0)
      } else clicks[k.toLowerCase()] = num(v)
    }
  }
  const cbl = first(o, 'clicks_by_level', 'clicks_levels')
  if (cbl && typeof cbl === 'object') for (const [k, v] of Object.entries(cbl as Record<string, unknown>)) if (/^[a-z0-9_-]{1,24}$/i.test(k)) byLevel[k.toLowerCase()] = levels(v)
  return {
    day,
    lang,
    starts: num(first(o, 'starts', 'started', 'start')),
    results: levels(first(o, 'results', 'results_by_level', 'levels')),
    noResult: num(first(o, 'no_result', 'no_results', 'noresult')),
    mapped: num(first(o, 'mapped', 'put_on_map', 'map_saved', 'saved')),
    warmOpens: num(first(o, 'warm_opens', 'warm_sheet_opens', 'warm', 'warm_sheet')),
    clicks,
    clicksByLevel: Object.keys(byLevel).length ? byLevel : null,
  }
}

/** The tool's answer as day × language rows; null when it cannot be read. */
export function normalizeToolStats(raw: unknown): ToolStats | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const body = (root.stats && typeof root.stats === 'object' ? root.stats : root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  const rows: ToolDayRow[] = []
  const list = Array.isArray(body) ? body : Array.isArray(body.days) ? (body.days as unknown[]) : Array.isArray(body.rows) ? (body.rows as unknown[]) : null
  if (list) {
    for (const r of list) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const day = dayOf(first(o, 'day', 'date'))
      const lang = toolLangOf(first(o, 'lang', 'language'))
      if (day && lang) rows.push(rowOf(day, lang, o))
    }
    return { rows }
  }
  const src = (body.days && typeof body.days === 'object' ? body.days : body) as Record<string, unknown>
  for (const [d, perLang] of Object.entries(src)) {
    const day = dayOf(d)
    if (!day || !perLang || typeof perLang !== 'object') continue
    for (const [l, o] of Object.entries(perLang as Record<string, unknown>)) {
      const lang = toolLangOf(l)
      if (lang && o && typeof o === 'object') rows.push(rowOf(day, lang, o as Record<string, unknown>))
    }
  }
  return rows.length > 0 || Object.keys(src).length === 0 ? { rows } : null
}

let cache: { at: number; value: ToolStats | null } | null = null
export const resetToolStatsCache = (): void => {
  cache = null
}

/** Ask the tool (token from the environment or Secret Manager); never throws — null = unavailable. */
export async function fetchToolStats(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, read: (name: string, env: NodeJS.ProcessEnv) => Promise<string> = readSecret, now: number = Date.now()): Promise<ToolStats | null> {
  if (cache && now - cache.at < 60_000) return cache.value
  let value: ToolStats | null = null
  try {
    const token = (env[TOOL_STATS_SECRET]?.trim() || (await read(TOOL_STATS_SECRET, env))).trim()
    if (token) {
      const r = await fetchImpl(env.ICHIREI_TOOL_STATS_URL?.trim() || TOOL_STATS_URL, { headers: { authorization: `Bearer ${token}`, 'x-stats-token': token, accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
      if (r.ok) value = normalizeToolStats(await r.json().catch(() => null))
    }
  } catch {
    value = null
  }
  cache = { at: now, value }
  return value
}
