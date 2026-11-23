// The Relationship Map tool's own numbers (Ticket 7, Part 31): read server-side from https://tools.beyondculture.ai/api/stats with the token in Secret Manager (PROMO_STATS_TOKEN; the service account already has
// access). The tool lives in its own repo and service — this only READS. Counts only; nothing personal. If the tool does not answer (or answers something unreadable) the caller shows "Tool stats unavailable"
// and the rest of the page works. The answer is read tolerantly (field names and the two usual shapes: a list of day rows, or day → language → row) and cached for a minute.

import { readSecret } from './track.ts'

export const TOOL_STATS_URL = 'https://tools.beyondculture.ai/api/stats?days=14'
export const TOOL_STATS_SECRET = 'PROMO_STATS_TOKEN'
export type ToolLang = 'ja' | 'en' | 'zh'

export interface ToolDayRow {
  day: string
  lang: ToolLang
  starts: number
  /** results by distance level 1–7 (index 0 = level 1) */
  results: number[]
  noResult: number
  /** null = the tool does not count it (yet): the dashboard shows 「—」. */
  mapped: number | null
  warmOpens: number
  /** clicks per product id (ichirei, …) */
  clicks: Record<string, number>
  /** clicks per product by level 1–7, when the tool says them */
  clicksByLevel: Record<string, number[]> | null
  /** clicks per product by level GROUP (near 1–2, middle 3–4, far 5–7), when the tool says them (`clicksByGroup`) */
  clicksByGroup: Record<string, { near: number; middle: number; far: number }> | null
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
/** A count, or an object of counts (the tool's `noResult` is split by reason): the total. */
const sumOf = (v: unknown): number => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v as Record<string, unknown>).reduce<number>((a, x) => a + num(x), 0) : num(v))
function groupsOf(v: unknown): Record<string, { near: number; middle: number; far: number }> | null {
  if (!v || typeof v !== 'object') return null
  const out: Record<string, { near: number; middle: number; far: number }> = {}
  for (const [k, g] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,24}$/i.test(k) || !g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    out[k.toLowerCase()] = { near: num(o.near), middle: num(o.middle), far: num(o.far) }
  }
  return Object.keys(out).length ? out : null
}
const dayOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

function rowOf(day: string, lang: ToolLang, o: Record<string, unknown>): ToolDayRow {
  const clicksRaw = first(o, 'clicks', 'offers', 'clicks_by_product', 'products')
  const clicks: Record<string, number> = {}
  const byLevel: Record<string, number[]> = {}
  if (typeof clicksRaw === 'number' || (typeof clicksRaw === 'string' && /^\d{1,9}$/.test(clicksRaw))) clicks.ichirei = num(clicksRaw) // an old day holds a plain number: it is ICHIREI's
  else if (clicksRaw && typeof clicksRaw === 'object') {
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
    noResult: sumOf(first(o, 'noResult', 'no_result', 'no_results', 'noresult')),
    mapped: ((m) => (m === undefined ? null : num(m)))(first(o, 'mapped', 'put_on_map', 'map_saved', 'saved')),
    warmOpens: num(first(o, 'warmOpens', 'warm_opens', 'warm_sheet_opens', 'warm', 'warm_sheet')),
    clicks,
    clicksByLevel: Object.keys(byLevel).length ? byLevel : null,
    clicksByGroup: groupsOf(first(o, 'clicksByGroup', 'clicks_by_group')),
  }
}

/** Two rows of the same day and language (zh-Hant and zh-Hans both read as zh) are added together. */
function mergeRows(rows: ToolDayRow[]): ToolDayRow[] {
  const by = new Map<string, ToolDayRow>()
  for (const r of rows) {
    const k = `${r.day}|${r.lang}`
    const a = by.get(k)
    if (!a) { by.set(k, { ...r, results: [...r.results], clicks: { ...r.clicks } }); continue }
    a.starts += r.starts; a.noResult += r.noResult; a.warmOpens += r.warmOpens
    a.mapped = a.mapped === null && r.mapped === null ? null : (a.mapped ?? 0) + (r.mapped ?? 0)
    a.results = a.results.map((x, i) => x + (r.results[i] ?? 0))
    for (const [p, n] of Object.entries(r.clicks)) a.clicks[p] = (a.clicks[p] ?? 0) + n
    if (r.clicksByLevel) { a.clicksByLevel = a.clicksByLevel ?? {}; for (const [p, lv] of Object.entries(r.clicksByLevel)) a.clicksByLevel[p] = (a.clicksByLevel[p] ?? [0, 0, 0, 0, 0, 0, 0]).map((x, i) => x + (lv[i] ?? 0)) }
    if (r.clicksByGroup) { a.clicksByGroup = a.clicksByGroup ?? {}; for (const [p, g] of Object.entries(r.clicksByGroup)) { const c = a.clicksByGroup[p] ?? { near: 0, middle: 0, far: 0 }; a.clicksByGroup[p] = { near: c.near + g.near, middle: c.middle + g.middle, far: c.far + g.far } } }
  }
  return [...by.values()]
}

/** The tool's answer as day × language rows; null when it cannot be read. The real shape (2026-11-22): `{ days: [{ date, langs: { ja: {…}, en, 'zh-Hant', 'zh-Hans' } }] }`; the older flat shapes are still read. */
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
      const day = dayOf(first(o, 'date', 'day'))
      if (day && o.langs && typeof o.langs === 'object') {
        for (const [l, v] of Object.entries(o.langs as Record<string, unknown>)) {
          const lang = toolLangOf(l)
          if (lang && v && typeof v === 'object') rows.push(rowOf(day, lang, v as Record<string, unknown>))
        }
        continue
      }
      const lang = toolLangOf(first(o, 'lang', 'language'))
      if (day && lang) rows.push(rowOf(day, lang, o))
    }
    return { rows: mergeRows(rows) }
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
  return rows.length > 0 || Object.keys(src).length === 0 ? { rows: mergeRows(rows) } : null
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
      const r = await fetchImpl(env.ICHIREI_TOOL_STATS_URL?.trim() || TOOL_STATS_URL, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
      if (r.ok) value = normalizeToolStats(await r.json().catch(() => null))
    }
  } catch {
    value = null
  }
  cache = { at: now, value }
  return value
}
