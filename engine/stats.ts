// The numbers of the owner dashboard (/ops/stats, 2026-11-07). Pure functions: events and order rows in, counts out — no story, no name, no e-mail, no IP can reach this file, because none of
// them is in its input. The caller (api/ops-stats.ts) builds the order rows from the order records (only ICHIREI orders) and reads the analytics events.

import { analyticsDay, SOURCE_BUCKETS, type AnalyticsEvent, type SourceBucket } from './analytics.ts'
import { FILM_SCRIPT_USD, PICTURES_PER_RENDER, PICTURE_USD, USD_JPY, tokensUsd } from './ops-costs.ts'

export const PERIODS = ['today', 'd7', 'd30', 'all'] as const
export type Period = (typeof PERIODS)[number]

export type OrderState = 'paid' | 'cancelled' | 'refunded' | 'unpaid' | 'unverified' | 'waiting' | 'refund_due'
export type ChosenSlot = 'main' | 'free' | 'second'

/** One ICHIREI order as the dashboard sees it — fixed, listed fields only. */
export interface OrderStat {
  order_ref: string
  created_at: string
  paid_at: string | null
  state: OrderState
  /** hours left of the 24-hour cancel window (null when it has closed or does not apply) */
  hours_left: number | null
  size_code: string
  /** the chosen character (the gift's own character, shown to the owner as it is on the order list) */
  kanji: string
  slot: ChosenSlot | null
  memorial: boolean
  language: string
  purpose: string | null
  /** What was actually paid for the order (from the Shopify order; the package price only when Shopify could not say). */
  price_jpy: number
  /** waiting orders only (paid without our site, no gift yet): whole days left before it is "refund due". */
  days_left?: number | null
  collected: boolean
  opened: boolean
  /** how many rounds of characters the sender looked at (1–3) */
  rounds: number
  /** the anonymous browser session of the order, when known (links it to its source) */
  session?: string
}

export interface PeriodStats {
  visits: number
  social_visits: number
  stories: number
  cards: number
  avg_cards_secs: number | null
  paid: number
  revenue_jpy: number
  cancelled: number
  ai_cost_jpy: number
  ai_cost_usd: number
  funnel: { chips: number; story: number; cards: number; give: number; paid: number; collected: number; opened: number; shared: number; visits: number }
  choice: { main: number; free: number; second: number; round2: number; round3: number }
  daily: { day: string; visits: number; paid: number }[]
  sources: { visits: Record<SourceBucket, number>; paid: Record<SourceBucket, number> }
  languages: { visits: Record<'ja' | 'zh-Hant' | 'en', number>; paid: Record<'ja' | 'zh-Hant' | 'en', number> }
}

export interface StatsResult {
  generated_at: string
  periods: Record<Period, PeriodStats>
}

const SOCIAL: readonly SourceBucket[] = ['instagram', 'facebook', 'x', 'line', 'xhs']
const DAY_MS = 86_400_000

/** The first instant (ISO) of a period in Japan time; `all` has none. */
export function periodStart(p: Period, now: Date): number {
  if (p === 'all') return -Infinity
  const days = p === 'today' ? 1 : p === 'd7' ? 7 : 30
  const jstMidnight = Date.parse(analyticsDay(now) + 'T00:00:00+09:00')
  return jstMidnight - (days - 1) * DAY_MS
}

const zero = <T extends string>(keys: readonly T[]): Record<T, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>
const langBucket = (l: string | null | undefined): 'ja' | 'zh-Hant' | 'en' => (l === 'en' ? 'en' : l === 'zh-Hant' || l === 'zh-Hans' ? 'zh-Hant' : 'ja')

export interface StatsInput {
  events: AnalyticsEvent[]
  orders: OrderStat[]
  /** timestamps of film renders (4 pictures each) */
  renders: string[]
  now: Date
}

export function computeStats(inp: StatsInput): StatsResult {
  const { now } = inp
  const customer = inp.events.filter((e) => e.source === 'customer')
  // the session → source bucket of every page view (an order's source is the source of its session)
  const srcOfSession = new Map<string, SourceBucket>()
  for (const e of customer) if (e.event === 'page_view') srcOfSession.set(e.session, e.src)
  const periods = {} as Record<Period, PeriodStats>
  for (const p of PERIODS) {
    const from = periodStart(p, now)
    const inP = (ts: string): boolean => {
      const t = Date.parse(ts)
      return Number.isFinite(t) && t >= from && t <= now.getTime() + DAY_MS
    }
    const ev = customer.filter((e) => inP(e.ts))
    const sessions = (pred: (e: AnalyticsEvent) => boolean): Set<string> => new Set(ev.filter(pred).map((e) => e.session ?? ""))
    const visitS = sessions((e) => e.event === 'page_view')
    const storyS = sessions((e) => e.event === 'story_submitted')
    const chipsS = sessions((e) => e.event === 'chips_done')
    const cardsEv = ev.filter((e) => e.event === 'shown' && e.status === 'sufficient')
    const cardsS = new Set(cardsEv.map((e) => e.session ?? ""))
    const giveS = sessions((e) => e.event === 'chosen')
    const shareS = sessions((e) => e.event === 'share_film_tap' || e.event === 'share_card_tap')
    const msList = cardsEv.map((e) => (e.event === 'shown' && typeof e.ms === 'number' ? e.ms : null)).filter((x): x is number => x !== null)
    const orders = inp.orders.filter((o) => inP(o.paid_at ?? o.created_at))
    const paidOrders = orders.filter((o) => o.state === 'paid' || o.state === 'unverified')
    const cancelled = orders.filter((o) => o.state === 'cancelled' || o.state === 'refunded').length
    const revenue = paidOrders.reduce((a, o) => a + (Number.isFinite(o.price_jpy) ? o.price_jpy : 0), 0)
    // AI cost: the logged tokens priced by engine/ops-costs.ts, plus the pictures and film scripts of the renders in the period
    let usd = 0
    for (const e of inp.events) if (e.event === 'ai_cost' && inP(e.ts)) usd += tokensUsd(e.model, e)
    const renders = inp.renders.filter(inP).length
    usd += renders * (PICTURES_PER_RENDER * PICTURE_USD + FILM_SCRIPT_USD)
    // visits per source and language (a visit = a session with a page view)
    const visitsBy = zero(SOURCE_BUCKETS)
    const visitLang = { ja: 0, 'zh-Hant': 0, en: 0 }
    for (const e of ev) if (e.event === 'page_view') {
      visitsBy[e.src]++
      visitLang[langBucket(e.language)]++
    }
    const paidBy = zero(SOURCE_BUCKETS)
    const paidLang = { ja: 0, 'zh-Hant': 0, en: 0 }
    for (const o of paidOrders) {
      paidBy[(o.session && srcOfSession.get(o.session)) || 'direct']++
      paidLang[langBucket(o.language)]++
    }
    // the days of the period (the last 60 at most), oldest first
    const nDays = p === 'today' ? 1 : p === 'd7' ? 7 : p === 'd30' ? 30 : 60
    const days = Array.from({ length: nDays }, (_, i) => analyticsDay(new Date(now.getTime() - (nDays - 1 - i) * DAY_MS)))
    const visitsPerDay = new Map<string, Set<string>>()
    for (const e of ev) if (e.event === 'page_view') {
      const d = analyticsDay(new Date(e.ts))
      if (!visitsPerDay.has(d)) visitsPerDay.set(d, new Set())
      visitsPerDay.get(d)!.add(e.session)
    }
    const paidPerDay = new Map<string, number>()
    for (const o of paidOrders) {
      const d = analyticsDay(new Date(o.paid_at ?? o.created_at))
      paidPerDay.set(d, (paidPerDay.get(d) ?? 0) + 1)
    }
    periods[p] = {
      visits: visitS.size,
      social_visits: [...visitS].filter((s) => SOCIAL.includes(srcOfSession.get(s) as SourceBucket)).length,
      stories: storyS.size,
      cards: cardsS.size,
      avg_cards_secs: msList.length ? Math.round((msList.reduce((a, b) => a + b, 0) / msList.length / 1000) * 10) / 10 : null,
      paid: paidOrders.length,
      revenue_jpy: revenue,
      cancelled,
      ai_cost_usd: Math.round(usd * 100) / 100,
      ai_cost_jpy: Math.round(usd * USD_JPY),
      funnel: {
        visits: visitS.size,
        chips: chipsS.size,
        story: storyS.size,
        cards: cardsS.size,
        give: giveS.size,
        paid: paidOrders.length,
        collected: paidOrders.filter((o) => o.collected).length,
        opened: paidOrders.filter((o) => o.opened).length,
        shared: shareS.size,
      },
      // the share of PAID orders only: which kind of card the buyer chose, and how many looked at round 2 / round 3
      choice: {
        main: paidOrders.filter((o) => o.slot === 'main').length,
        free: paidOrders.filter((o) => o.slot === 'free').length,
        second: paidOrders.filter((o) => o.slot === 'second').length,
        round2: paidOrders.filter((o) => o.rounds >= 2).length,
        round3: paidOrders.filter((o) => o.rounds >= 3).length,
      },
      daily: days.map((day) => ({ day, visits: visitsPerDay.get(day)?.size ?? 0, paid: paidPerDay.get(day) ?? 0 })),
      sources: { visits: visitsBy, paid: paidBy },
      languages: { visits: visitLang, paid: paidLang },
    }
  }
  return { generated_at: now.toISOString(), periods }
}
