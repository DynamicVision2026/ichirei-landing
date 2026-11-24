// "Tool → purchase" (Ticket 7, Part 31): the Relationship Map's visitors followed from the tool to a paid order, split near / middle / far by the level (1–2 / 3–4 / 5–7), per day and per language.
//   1 measured (tool)   2 clicked ICHIREI (tool, offer=ichirei)   3 landed on ICHIREI with src=tool   4 started writing   5 gift created   6 free gift   7 paid order
// Steps 1–2 come from the tool's own numbers; 3–4 from the browser's events (a `tool_landed` event and the same session's `story_submitted`), counted on the day of the visit; 5–7 from the orders that carry the tool
// mark, counted on the day they were made (a free gift = a paid-state order with a total of 0; "paid order" = one that paid money). Counts only: no email, no name, no gift text, no session id.

import { analyticsDay, type AnalyticsEvent, type ToolGroup } from './analytics.ts'
import { funnelLang, type ToolLang, type ToolStats } from './tool-stats.ts'
import { lvGroup } from '../src/order/tool.ts'
import type { OrderRecord } from './order.ts'

export interface FunnelRow {
  day: string
  lang: ToolLang
  group: ToolGroup
  measured: number
  clicked: number
  landed: number
  started: number
  created: number
  free: number
  paid: number
}
export interface ToolOrderFact {
  record: OrderRecord
  /** paid-state and total 0 */
  free: boolean
  /** paid-state and money paid */
  paid: boolean
}

const langOf = (l: unknown): ToolLang => (l === 'en' ? 'en' : typeof l === 'string' && l.startsWith('zh') ? 'zh' : 'ja')

export function computeToolFunnel(input: { events: AnalyticsEvent[]; orders: ToolOrderFact[]; tool: ToolStats | null }): FunnelRow[] {
  const rows = new Map<string, FunnelRow>()
  const row = (day: string, lang: ToolLang, group: ToolGroup): FunnelRow => {
    const k = `${day}|${lang}|${group}`
    let r = rows.get(k)
    if (!r) rows.set(k, (r = { day, lang, group, measured: 0, clicked: 0, landed: 0, started: 0, created: 0, free: 0, paid: 0 }))
    return r
  }
  // 3 and 4: the browser's events — one landing per session; "started writing" = the same session sent its moment
  const landing = new Map<string, FunnelRow>()
  for (const e of input.events) {
    if (e.event !== 'tool_landed' || landing.has(e.session)) continue
    const r = row(analyticsDay(new Date(e.ts)), langOf(e.language), e.tool)
    r.landed++
    landing.set(e.session, r)
  }
  const started = new Set<string>()
  for (const e of input.events) {
    if (e.event !== 'story_submitted' || started.has(e.session)) continue
    const r = landing.get(e.session)
    if (r) {
      r.started++
      started.add(e.session)
    }
  }
  // 5–7: the orders that carry the tool mark
  for (const o of input.orders) {
    const t = o.record.tool
    if (!t) continue
    const r = row(analyticsDay(new Date(o.record.created_at)), langOf(o.record.page_language ?? o.record.story_language), lvGroup(t.lv))
    r.created++
    if (o.free) r.free++
    else if (o.paid) r.paid++
  }
  // 1 and 2: the tool's numbers (clicks per level when the tool says them, otherwise under "unknown")
  for (const tr of input.tool?.rows ?? []) {
    const groups: Array<[ToolGroup, number[]]> = [['near', [0, 1]], ['middle', [2, 3]], ['far', [4, 5, 6]]]
    for (const [g, idx] of groups) row(tr.day, funnelLang(tr.lang), g).measured += idx.reduce((a, i) => a + (tr.results[i] ?? 0), 0)
    const byGroup = tr.clicksByGroup?.ichirei
    const byLevel = tr.clicksByLevel?.ichirei
    if (byGroup) for (const [g] of groups) row(tr.day, funnelLang(tr.lang), g).clicked += byGroup[g as 'near' | 'middle' | 'far']
    else if (byLevel) for (const [g, idx] of groups) row(tr.day, funnelLang(tr.lang), g).clicked += idx.reduce((a, i) => a + (byLevel[i] ?? 0), 0)
    else if ((tr.clicks.ichirei ?? 0) > 0) row(tr.day, funnelLang(tr.lang), 'unknown').clicked += tr.clicks.ichirei
  }
  return [...rows.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.lang.localeCompare(b.lang) || a.group.localeCompare(b.group)))
}
