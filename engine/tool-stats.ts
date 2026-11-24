// The Relationship Map tool's own numbers (Ticket 7, Part 31; Part B 2026-11-23): read server-side from https://tools.beyondculture.ai/api/stats?days=N with the token in Secret Manager (PROMO_STATS_TOKEN; the
// service account already has access), and the saved-map email list from /api/savers?days=N (same token). The tool lives in its own repo and service — this only READS.
// The stats are counts only. The saver list holds email addresses: it is handed to the owner's page on its own request (never inside the stats payload), is never cached here, never logged and never put in a link.
// If the tool does not answer (or answers something unreadable) the caller says so and the rest of the page works. The stats answer is read tolerantly (field names, and a few older shapes) and cached for a minute.

import { readSecret } from './track.ts'

export const TOOL_STATS_BASE = 'https://tools.beyondculture.ai/api/stats'
export const TOOL_SAVERS_BASE = 'https://tools.beyondculture.ai/api/savers'
/** How many days of the tool's numbers the dashboard asks for (the page's periods are today / 7 / 30 days / all: "all" shows what this holds). */
export const TOOL_STATS_DAYS = 90
export const TOOL_STATS_URL = `${TOOL_STATS_BASE}?days=${TOOL_STATS_DAYS}`
export const TOOL_STATS_SECRET = 'PROMO_STATS_TOKEN'
/** The funnel's three languages (zh-Hant and zh-Hans are one `zh` there). */
export type ToolLang = 'ja' | 'en' | 'zh'
/** The tool's own four languages: the dashboard's table keeps them apart. */
export type ToolRowLang = 'ja' | 'en' | 'zh-Hant' | 'zh-Hans'
export const funnelLang = (l: ToolRowLang): ToolLang => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : 'zh')

export interface ToolDayRow {
  /** The tool's day (UTC). */
  day: string
  lang: ToolRowLang
  starts: number
  /** readings by input: screenshots (`input.shots`) and the five questions (`input.taps`) */
  shots: number
  taps: number
  /** results by distance level 1–7 (index 0 = level 1) */
  results: number[]
  /** no result: the total, and by reason (unsure, help, minor, busy, thin, retry, group … any new reason is kept by its code) */
  noResult: number
  noResultBy: Record<string, number>
  /** people put on the map: the total (null = the tool does not count it) and by group (family, partner, friends, work, clients …) */
  mapped: number | null
  placed: Record<string, number>
  warmOpens: number
  /** clicks per product id (ichirei, …) */
  clicks: Record<string, number>
  /** clicks per product by level 1–7, when the tool says them */
  clicksByLevel: Record<string, number[]> | null
  /** clicks per product by level GROUP (near 1–2, middle 3–4, far 5–7), when the tool says them (`clicksByGroup`) */
  clicksByGroup: Record<string, { near: number; middle: number; far: number }> | null
  /** "how close do you feel": `"<the person's own sense 1–7>|<the level shown 1–7>"` → how many */
  felt: Record<string, number>
  /** model readings and their cost in US dollars */
  readings: number
  costUsd: number
}
export interface ToolStats {
  rows: ToolDayRow[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : 0)
const money = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 10_000) / 10_000 : 0
}
const first = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}
export const toolLangOf = (v: unknown): ToolRowLang | null => {
  const s = String(v ?? '').toLowerCase().replace('_', '-')
  return s === 'ja' ? 'ja' : s === 'en' ? 'en' : s === 'zh-hans' || s === 'zh-cn' ? 'zh-Hans' : /^zh/.test(s) ? 'zh-Hant' : null
}
const levels = (v: unknown): number[] => {
  const out = [0, 0, 0, 0, 0, 0, 0]
  if (Array.isArray(v)) v.slice(0, 7).forEach((x, i) => { out[i] = num(x) })
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^[1-7]$/.test(k)) out[Number(k) - 1] = num(x)
  return out
}
const CODE = /^[a-z0-9_-]{1,24}$/i
/** An object of counts by code (reasons, groups): any code is kept. */
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (CODE.test(k)) out[k.toLowerCase()] = num(x)
  return out
}
const total = (c: Record<string, number>): number => Object.values(c).reduce((a, b) => a + b, 0)
function groupsOf(v: unknown): Record<string, { near: number; middle: number; far: number }> | null {
  if (!v || typeof v !== 'object') return null
  const out: Record<string, { near: number; middle: number; far: number }> = {}
  for (const [k, g] of Object.entries(v as Record<string, unknown>)) {
    if (!CODE.test(k) || !g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    out[k.toLowerCase()] = { near: num(o.near), middle: num(o.middle), far: num(o.far) }
  }
  return Object.keys(out).length ? out : null
}
const feltOf = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^[1-7]\|[1-7]$/.test(k)) out[k] = num(x)
  return out
}
const dayOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

function rowOf(day: string, lang: ToolRowLang, o: Record<string, unknown>): ToolDayRow {
  const clicksRaw = first(o, 'clicks', 'offers', 'clicks_by_product', 'products')
  const clicks: Record<string, number> = {}
  const byLevel: Record<string, number[]> = {}
  if (typeof clicksRaw === 'number' || (typeof clicksRaw === 'string' && /^\d{1,9}$/.test(clicksRaw))) clicks.ichirei = num(clicksRaw) // an old day holds a plain number: it is ICHIREI's
  else if (clicksRaw && typeof clicksRaw === 'object') {
    for (const [k, v] of Object.entries(clicksRaw as Record<string, unknown>)) {
      if (!CODE.test(k)) continue
      if (v && typeof v === 'object') {
        const lv = levels(v)
        byLevel[k.toLowerCase()] = lv
        clicks[k.toLowerCase()] = lv.reduce((a, b) => a + b, 0)
      } else clicks[k.toLowerCase()] = num(v)
    }
  }
  const cbl = first(o, 'clicks_by_level', 'clicks_levels')
  if (cbl && typeof cbl === 'object') for (const [k, v] of Object.entries(cbl as Record<string, unknown>)) if (CODE.test(k)) byLevel[k.toLowerCase()] = levels(v)
  const input = (o.input && typeof o.input === 'object' ? o.input : {}) as Record<string, unknown>
  const nrRaw = first(o, 'noResult', 'no_result', 'no_results', 'noresult')
  const noResultBy = counts(nrRaw)
  const placed = counts(first(o, 'placed', 'mapped_by_group'))
  const mappedRaw = first(o, 'mapped', 'put_on_map', 'map_saved', 'saved')
  return {
    day,
    lang,
    starts: num(first(o, 'starts', 'started', 'start')),
    shots: num(first(input, 'shots') ?? o.shots),
    taps: num(first(input, 'taps') ?? o.taps),
    results: levels(first(o, 'results', 'results_by_level', 'levels')),
    noResult: nrRaw && typeof nrRaw === 'object' ? total(noResultBy) : num(nrRaw),
    noResultBy,
    mapped: mappedRaw !== undefined ? num(mappedRaw) : Object.keys(placed).length ? total(placed) : null,
    placed,
    warmOpens: num(first(o, 'warmOpens', 'warm_opens', 'warm_sheet_opens', 'warm', 'warm_sheet')),
    clicks,
    clicksByLevel: Object.keys(byLevel).length ? byLevel : null,
    clicksByGroup: groupsOf(first(o, 'clicksByGroup', 'clicks_by_group')),
    felt: feltOf(o.felt),
    readings: num(o.readings),
    costUsd: money(first(o, 'costUsd', 'cost_usd', 'cost')),
  }
}

const addMaps = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a }
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n
  return out
}
/** Two rows of the same day and language are added together (a day sent twice). */
function mergeRows(rows: ToolDayRow[]): ToolDayRow[] {
  const by = new Map<string, ToolDayRow>()
  for (const r of rows) {
    const k = `${r.day}|${r.lang}`
    const a = by.get(k)
    if (!a) { by.set(k, { ...r, results: [...r.results], clicks: { ...r.clicks } }); continue }
    a.starts += r.starts; a.shots += r.shots; a.taps += r.taps; a.noResult += r.noResult; a.warmOpens += r.warmOpens; a.readings += r.readings; a.costUsd = Math.round((a.costUsd + r.costUsd) * 10_000) / 10_000
    a.mapped = a.mapped === null && r.mapped === null ? null : (a.mapped ?? 0) + (r.mapped ?? 0)
    a.results = a.results.map((x, i) => x + (r.results[i] ?? 0))
    a.noResultBy = addMaps(a.noResultBy, r.noResultBy); a.placed = addMaps(a.placed, r.placed); a.felt = addMaps(a.felt, r.felt); a.clicks = addMaps(a.clicks, r.clicks)
    if (r.clicksByLevel) { a.clicksByLevel = a.clicksByLevel ?? {}; for (const [p, lv] of Object.entries(r.clicksByLevel)) a.clicksByLevel[p] = (a.clicksByLevel[p] ?? [0, 0, 0, 0, 0, 0, 0]).map((x, i) => x + (lv[i] ?? 0)) }
    if (r.clicksByGroup) { a.clicksByGroup = a.clicksByGroup ?? {}; for (const [p, g] of Object.entries(r.clicksByGroup)) { const c = a.clicksByGroup[p] ?? { near: 0, middle: 0, far: 0 }; a.clicksByGroup[p] = { near: c.near + g.near, middle: c.middle + g.middle, far: c.far + g.far } } }
  }
  return [...by.values()]
}

/** The tool's answer as day × language rows; null when it cannot be read. The real shape: `{ days: [{ date, langs: { ja: {…}, en, 'zh-Hant', 'zh-Hans' } }] }`; the older flat shapes are still read. */
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

type Reader = (name: string, env: NodeJS.ProcessEnv) => Promise<string>
const tokenOf = async (env: NodeJS.ProcessEnv, read: Reader): Promise<string> => (env[TOOL_STATS_SECRET]?.trim() || (await read(TOOL_STATS_SECRET, env))).trim()

let cache: { at: number; value: ToolStats | null } | null = null
export const resetToolStatsCache = (): void => {
  cache = null
}

/** Ask the tool (token from the environment or Secret Manager); never throws — null = unavailable. */
export async function fetchToolStats(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, read: Reader = readSecret, now: number = Date.now()): Promise<ToolStats | null> {
  if (cache && now - cache.at < 60_000) return cache.value
  let value: ToolStats | null = null
  try {
    const token = await tokenOf(env, read)
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

// ---- the saved-map emails (Part B, 2026-11-23): owner only ------------------------------------------------------------------------------------------------------------------------------

export interface Saver {
  email: string
  lang: ToolRowLang | null
  /** UTC timestamps (ISO) */
  first: string | null
  last: string | null
  /** key mails sent */
  count: number
  reminders: boolean
  news: boolean
}
const flag = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true' || v === 'yes'
const stamp = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) && v.length <= 40 ? v : null)
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/

/** The saver list as the tool sends it — `{ savers: [{ email, lang, first, last, count, reminders, news }] }`, newest first; a row with no usable address is left out. null when it cannot be read. */
export function normalizeSavers(raw: unknown): Saver[] | null {
  if (!raw || typeof raw !== 'object') return null
  const list = Array.isArray(raw) ? raw : (raw as { savers?: unknown }).savers
  if (!Array.isArray(list)) return null
  const out: Saver[] = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const email = typeof o.email === 'string' ? o.email.trim() : ''
    if (!EMAIL.test(email)) continue
    out.push({ email, lang: toolLangOf(o.lang ?? o.language), first: stamp(o.first), last: stamp(o.last), count: num(o.count), reminders: flag(o.reminders), news: flag(o.news) })
  }
  return out
}

/** `days` = how many days back (0 = all). Never cached, never logged: the answer goes straight to the owner's page. null = unavailable. */
export async function fetchToolSavers(days: number, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, read: Reader = readSecret): Promise<Saver[] | null> {
  try {
    const token = await tokenOf(env, read)
    if (!token) return null
    const d = Number.isInteger(days) && days >= 0 && days <= 3650 ? days : 7
    const base = env.ICHIREI_TOOL_SAVERS_URL?.trim() || TOOL_SAVERS_BASE
    const r = await fetchImpl(`${base}?days=${d}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    return r.ok ? normalizeSavers(await r.json().catch(() => null)) : null
  } catch {
    return null
  }
}
