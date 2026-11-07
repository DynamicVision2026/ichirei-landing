// The owner's dashboard /ops/stats (2026-11-07, private, behind the same password as /ops). One page: visits, where people drop off, every paid ICHIREI order, revenue,
// cancellations, sharing and what the AI cost. Four languages (日本語 · English · 繁體中文 · 简体中文) with a switch at the top right.
//
// Privacy: the page and its data carry codes and counts only — never a story, a name, a message, an e-mail or an IP. The order rows hold exactly the listed fields
// (time, shortened order number, size, character, kind, language, purpose, amount, collected, opened, status). Only orders whose size code is ICHIREI-… are read:
// every other order of the shared store is ignored.
//
//   GET /ops/stats        the page (HTML with its numbers embedded)
//   GET /ops/stats.json   the same numbers as JSON (for tests and for the page's own refresh)

import { analyticsDay, tokenHash, type AnalyticsEvent } from '../engine/analytics.ts'
import { readJsonl, type OrderIndexEntry } from '../engine/egift-ops.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { type OrderRecord } from '../engine/order.ts'
import { readFreeSourceCounts, readMainCounts } from '../engine/free-source.ts'
import { rendersPath } from '../engine/film-art.ts'
import { windowOf } from '../engine/change-window.ts'
import { shopifyPayments } from '../engine/payments-lookup.ts'
import type { PaymentInfo, PaymentResult } from '../engine/shipping.ts'
import { computeStats, type ChosenSlot, type OrderState, type OrderStat, type StatsResult } from '../engine/stats.ts'
import { STATS_KEYS, STATS_LANGS, STATS_LANG_NAMES, statsDicts } from '../engine/stats-i18n.ts'
import { checkOpsAuth, type OpsDeps } from './ops.ts'
import { STATS_CLIENT_JS } from './ops-stats-client.ts'

/** Events and orders are kept (and read) for 13 months. */
export const KEEP_DAYS = 400
const DAY_MS = 86_400_000
/** Shopify's read-only app sees orders for 60 days; older orders cannot be asked and are counted from our own record. */
const SHOPIFY_VISIBLE_DAYS = 55

const baseHeaders = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', ...extra })
const respond = (status: number, body: string, type: string) => new Response(body, { status, headers: baseHeaders({ 'content-type': type }) })

const daysBack = (now: Date, n: number): string[] => Array.from({ length: n }, (_, i) => analyticsDay(new Date(now.getTime() - i * DAY_MS)))

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

/** The order row's shortened number: the part after the prefix, last eight characters. */
export const shortRef = (ref: string): string => ref.replace(/^[A-Z]+-/, '').slice(-8)

const SLOT: Record<string, ChosenSlot> = { main: 'main', second: 'second', freestyle: 'free' }

/** The dashboard's view of one order: only the listed fields, never the story. */
export function orderStatOf(entry: OrderIndexEntry, rec: OrderRecord | null, pay: PaymentInfo | null | 'unverified', openedHashes: Set<string>, now: Date): OrderStat | null {
  if (!rec || !entry.size_code.startsWith('ICHIREI-')) return null // every other order of the shared store is ignored
  const win = windowOf(rec, pay, now)
  let state: OrderState
  if (pay === 'unverified') state = win.phase === 'cancelled' ? 'cancelled' : 'unverified'
  else if (rec.ops?.cancelled_at) state = 'cancelled'
  else if (pay === null) state = Date.now() - Date.parse(rec.created_at) > SHOPIFY_VISIBLE_DAYS * DAY_MS ? 'unverified' : 'unpaid'
  else state = pay.state === 'paid' ? 'paid' : pay.state === 'refunded' ? 'refunded' : pay.state === 'cancelled' ? 'cancelled' : 'unpaid'
  const p = rec.production
  const shown = rec.shown_characters ?? []
  const chosen = shown.find((s) => s.candidate.kanji === p.kanji)
  return {
    order_ref: rec.order_ref,
    created_at: rec.created_at,
    paid_at: pay && pay !== 'unverified' ? pay.paid_at : null,
    state,
    hours_left: win.phase === 'open' ? win.hours_left : null,
    size_code: entry.size_code,
    kanji: p.kanji,
    slot: chosen ? (SLOT[chosen.slot] ?? null) : null,
    memorial: entry.memorial === true,
    language: p.language,
    purpose: p.certificate?.purpose ?? null,
    price_jpy: typeof p.price_jpy === 'number' ? p.price_jpy : 0,
    collected: !!rec.collected_at,
    opened: !!entry.token && openedHashes.has(tokenHash(entry.token)),
    rounds: Math.max(1, ...shown.map((s) => s.set)),
    ...(entry.session ? { session: entry.session } : {}),
  }
}

export interface StatsPayload {
  stats: StatsResult
  /** the latest 50 orders (no session id) */
  orders: Omit<OrderStat, 'session'>[]
  free: Awaited<ReturnType<typeof readFreeSourceCounts>> | null
  main: Awaited<ReturnType<typeof readMainCounts>> | null
  /** false when Shopify could not be asked about payments */
  verified: boolean
  now: string
}

export async function buildStats(d: OpsDeps, store: OrderStore, env: NodeJS.ProcessEnv, now: Date): Promise<StatsPayload> {
  const days = daysBack(now, KEEP_DAYS)
  const eventLists = await inBatches(days, 25, (day) => readJsonl<AnalyticsEvent>(store, `analytics/${day}.jsonl`).catch(() => [] as AnalyticsEvent[]))
  const events = eventLists.flat()
  const entryLists = await inBatches(days, 25, (day) => readJsonl<OrderIndexEntry>(store, `ops/orders-${day}.jsonl`).catch(() => [] as OrderIndexEntry[]))
  // only ICHIREI orders; the same order is listed once even if the index holds it twice
  const seen = new Set<string>()
  const entries = entryLists.flat().filter((e) => typeof e.size_code === 'string' && e.size_code.startsWith('ICHIREI-') && !seen.has(e.order_ref) && !!seen.add(e.order_ref))
  const records = await inBatches(entries, 25, async (e) => {
    try {
      return (await store.get(e.order_ref)) as OrderRecord | null
    } catch {
      return null
    }
  })
  const refs = entries.map((e) => e.order_ref)
  const pay: PaymentResult = refs.length ? await (d.payments ?? shopifyPayments(env))(refs).catch(() => ({ found: new Map(), failure: 'error' as never })) : { found: new Map(), failure: null }
  const verified = pay.failure === null
  const opened = new Set<string>()
  for (const e of events) if (e.event === 'receiver_opened' && e.gift) opened.add(e.gift)
  const orders: OrderStat[] = []
  entries.forEach((e, i) => {
    const o = orderStatOf(e, records[i], verified ? (pay.found.get(e.order_ref) ?? null) : 'unverified', opened, now)
    if (o && o.state !== 'unpaid') orders.push(o)
  })
  const renderLists = await inBatches(days, 25, (day) => readJsonl<{ ts?: string }>(store, rendersPath(day)).catch(() => []))
  const renders = renderLists.flat().map((r) => r.ts).filter((t): t is string => typeof t === 'string')
  const stats = computeStats({ events, orders, renders, now })
  const latest = [...orders]
    .sort((a, b) => Date.parse(b.paid_at ?? b.created_at) - Date.parse(a.paid_at ?? a.created_at))
    .slice(0, 50)
    .map(({ session: _s, ...rest }) => rest)
  const free = await readFreeSourceCounts(store, daysBack(now, 30)).catch(() => null)
  const main = await readMainCounts(store, daysBack(now, 30)).catch(() => null)
  return { stats, orders: latest, free, main, verified, now: now.toISOString() }
}

const jsonForScript = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const CSS = `:root{--bg:#efe6d2;--ink:#2a221b;--card:#fff;--line:#d7ccb4;--soft:#8a8070;--bar:#b7410e;--bar2:#6b7f5e}
*{box-sizing:border-box}body{font:15px/1.6 system-ui,'Hiragino Sans','Noto Sans JP','Noto Sans TC',sans-serif;margin:0;color:var(--ink);background:var(--bg)}
header{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--line)}
h1{font-size:1.25rem;margin:0;font-weight:600}h2{font-size:1.05rem;margin:1.6rem 0 .6rem;font-weight:600}
main{padding:0 1.2rem 3rem;max-width:1180px;margin:0 auto}
.langs,.tabs{display:flex;gap:.3rem;flex-wrap:wrap}.langs button,.tabs button{font:inherit;padding:.25rem .7rem;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;cursor:pointer}
.langs button[aria-pressed=true],.tabs button[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.tabs{margin:1rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.7rem}
.num{background:var(--card);border:1px solid var(--line);padding:.7rem .9rem;border-radius:6px}.num b{display:block;font-size:1.55rem;font-weight:600;line-height:1.3}.num span{display:block;color:var(--soft);font-size:.82rem}
.num small{display:block;color:var(--soft);font-size:.78rem;margin-top:.15rem}
table{border-collapse:collapse;width:100%;background:var(--card)}th,td{border:1px solid var(--line);padding:.3rem .5rem;text-align:left;white-space:nowrap;font-size:.88rem}.wide{overflow-x:auto}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.k{font-size:1.2rem}
.bar{display:grid;grid-template-columns:minmax(8rem,14rem) 1fr auto;gap:.6rem;align-items:center;margin:.25rem 0;font-size:.9rem}.bar i{display:block;height:1.05rem;background:var(--bar);border-radius:2px;min-width:2px}.bar em{font-style:normal;color:var(--soft);font-variant-numeric:tabular-nums;white-space:nowrap}
.days{display:flex;align-items:flex-end;gap:2px;height:150px;background:var(--card);border:1px solid var(--line);padding:.5rem .5rem .2rem;overflow-x:auto}.days div{flex:1 0 12px;max-width:64px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;font-size:.65rem;color:var(--soft)}.days i{display:block;width:100%;background:var(--bar);min-height:1px}.days b{font-weight:400;color:var(--bar2)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}.note{color:var(--soft);font-size:.85rem}.warn{background:#fff;border:1px solid var(--line);padding:.4rem .8rem}
a{color:var(--ink)}tr.cancel td{color:var(--soft);background:#f4efe3}
@media(max-width:560px){.bar{grid-template-columns:1fr auto}.bar i{grid-column:1/-1;order:3}header{padding:.7rem 1rem}main{padding:0 1rem 3rem}}`

export function createStatsHandlers(deps: () => OpsDeps) {
  const guard = async (req: Request) => {
    const d = deps()
    const env = d.env ?? process.env
    const denied = await checkOpsAuth(req, env, d.readSecret)
    if (denied) return denied
    if (!d.store) return respond(503, JSON.stringify({ error: 'Order storage is not configured', code: 'store_not_configured' }), 'application/json; charset=utf-8')
    return { d, env, now: d.now?.() ?? new Date(), store: d.store }
  }
  return {
    async json(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      return respond(200, JSON.stringify(await buildStats(g.d, g.store, g.env, g.now)), 'application/json; charset=utf-8')
    },
    async page(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const payload = await buildStats(g.d, g.store, g.env, g.now)
      const data = { ...payload, langs: STATS_LANGS, lang_names: STATS_LANG_NAMES, keys: STATS_KEYS, dict: statsDicts() }
      const ja = statsDicts().ja
      const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${ja.title}</title><style>${CSS}</style></head><body>` +
        `<header><h1 id="title">${ja.title}</h1><div class="langs" id="langs" role="group" aria-label="language"></div></header>` +
        `<main><p><a id="back" href="/ops"></a></p><div class="tabs" id="tabs" role="group"></div><div id="app"></div></main>` +
        `<script type="application/json" id="d">${jsonForScript(data)}</script><script>${STATS_CLIENT_JS}</script></body></html>`
      return respond(200, html, 'text/html; charset=utf-8')
    },
  }
}

export const statsHandlers = createStatsHandlers(() => ({ store: createOrderStore() }))
