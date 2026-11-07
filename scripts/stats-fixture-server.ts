// A tiny server for the browser checks and the screenshots of /ops/stats: the real handler on fixture data (a made-up month; no story, no name, no real order). Fixed "now" so the
// numbers never move. Prints "listening <port>" and waits.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/stats-fixture-server.ts [port]

import { createServer } from 'node:http'
import { createStatsHandlers } from '../api/ops-stats.ts'
import { analyticsPath, tokenHash } from '../engine/analytics.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import type { PaymentInfo } from '../engine/shipping.ts'

const NOW = new Date('2026-11-07T03:00:00Z')
const store = new MemoryOrderStore()
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
const SRC = ['direct', 'direct', 'direct', 'instagram', 'instagram', 'facebook', 'x', 'line', 'xhs', 'other'] as const
const LANGS = ['ja', 'ja', 'ja', 'zh-Hant', 'en'] as const
const PURPOSES = ['celebrate', 'thanks', 'apology', 'encourage', 'farewell', 'reconnect', 'confess', 'memorial', 'other']
const KANJI = ['証', '遊', '礼', '恩', '縁', '灯', '結', '和', '祈', '澄', '凛', '蔵']
const SKUS = ['ICHIREI-STANDARD', 'ICHIREI-SIMPLE', 'ICHIREI-EGIFT', 'ICHIREI-EGIFT', 'ICHIREI-EGIFT']
const PRICE: Record<string, number> = { 'ICHIREI-STANDARD': 18850, 'ICHIREI-SIMPLE': 9800, 'ICHIREI-EGIFT': 3980 }
const ts = (daysAgo: number, hour: number, min = 0) => new Date(Date.UTC(2026, 10, 7 - daysAgo, hour, min)).toISOString()
const put = (e: object) => store.appendJsonl(analyticsPath(new Date((e as { ts: string }).ts)), e)

const pays = new Map<string, PaymentInfo>()
let n = 0
for (let d = 59; d >= 0; d--) {
  const visitors = d === 0 ? 46 : 18 + Math.floor(rnd() * 40)
  for (let v = 0; v < visitors; v++) {
    const sid = `fx${d}x${v}`.padEnd(20, 'z')
    const base = { session: sid, source: 'customer' }
    const hour = Math.min(14, 0 + Math.floor(rnd() * (d === 0 ? 3 : 14)))
    const lang = pick([...LANGS])
    await put({ ...base, ts: ts(d, hour), event: 'page_view', language: lang, src: pick([...SRC]) })
    if (rnd() > 0.55) await put({ ...base, ts: ts(d, hour, 2), event: 'chips_done', language: lang, set: null, qid: null })
    else continue
    if (rnd() > 0.35) await put({ ...base, ts: ts(d, hour, 5), event: 'story_submitted', language: lang, set: null, qid: null })
    else continue
    if (rnd() > 0.12) await put({ ...base, ts: ts(d, hour, 6), event: 'shown', ms: 14000 + Math.floor(rnd() * 22000), language: lang, relationship: null, occasion: null, status: 'sufficient', main_slot: 'main', has_free: true })
    else continue
    if (rnd() > 0.5) await put({ ...base, ts: ts(d, hour, 8), event: 'chosen', choice: rnd() > 0.45 ? 'main' : 'free' })
    else continue
    if (rnd() > 0.55) {
      const sku = pick(SKUS)
      const ref = `IC-2026${String(11).padStart(2, '0')}${String(7 - d).padStart(2, '0')}-${String(++n).padStart(8, '0')}`
      const token = 'RG-' + String(n).repeat(8).slice(0, 24)
      const rare = rnd()
      const state: PaymentInfo = rare < 0.08 ? { state: 'refunded', paid_at: null } : { state: 'paid', paid_at: ts(d, hour, 12) }
      const freeBuyer = rnd() > 0.5
      await store.put(ref, {
        schema: 1, order_ref: ref, created_at: ts(d, hour, 10), updated_at: ts(d, hour, 10),
        collected_at: rnd() > 0.45 ? ts(d, hour + 1) : null,
        production: { language: lang, kanji: pick(KANJI), price_jpy: PRICE[sku], certificate: { purpose: pick(PURPOSES) } },
        shown_characters: [{ set: 1, slot: freeBuyer ? 'freestyle' : 'main', candidate: { kanji: '' } }, ...(rnd() > 0.6 ? [{ set: 2, slot: 'main', candidate: { kanji: '' } }] : []), ...(rnd() > 0.85 ? [{ set: 3, slot: 'main', candidate: { kanji: '' } }] : [])],
      })
      const rec = (await store.get(ref)) as { production: { kanji: string }; shown_characters: { candidate: { kanji: string } }[] }
      rec.shown_characters[0].candidate.kanji = rec.production.kanji
      await store.put(ref, rec)
      await store.appendJsonl(`ops/orders-${analyticsPath(new Date(Date.UTC(2026, 10, 7 - d, 1))).slice(10, 20)}.jsonl`, { ts: ts(d, hour, 10), order_ref: ref, token, size_code: sku, ship_to: 'none', memorial: rnd() > 0.93, delivery_date: '2026-12-01', session: sid })
      pays.set(ref, state)
      if (rnd() > 0.5) await put({ ts: ts(d, hour + 2), session: `rx${n}`.padEnd(20, 'z'), source: 'customer', event: 'receiver_opened', gift: tokenHash(token) })
      if (rnd() > 0.7) await put({ ...base, ts: ts(d, hour + 3), event: 'share_card_tap', role: 'buyer' })
    }
  }
  if (d < 20) await put({ ts: ts(d, 3), source: 'customer', event: 'ai_cost', kind: 'select', model: 'claude-sonnet-5-5', in: 600_000 + Math.floor(rnd() * 300_000), out: 40_000, cr: 900_000, cw: 60_000 })
}
// one order of another shop in the same store: it must never show
await store.put('IC-20261107-OTHER001', { schema: 1, order_ref: 'IC-20261107-OTHER001', created_at: ts(0, 1), production: { language: 'ja', kanji: '他', price_jpy: 55555, certificate: {} } })
await store.appendJsonl('ops/orders-2026-11-07.jsonl', { ts: ts(0, 1), order_ref: 'IC-20261107-OTHER001', token: null, size_code: 'SHOP-OTHER', ship_to: 'none', memorial: false, delivery_date: '2026-12-01' })
pays.set('IC-20261107-OTHER001', { state: 'paid', paid_at: ts(0, 1) })
// the two existing tables
for (let i = 0; i < 40; i++) await store.appendJsonl('ops/mains-2026-11-07.jsonl', { ts: ts(0, 1), round: 1 + (i % 3), language: 'ja', main: KANJI[(i * i) % 7] })
for (let i = 0; i < 24; i++) await store.appendJsonl('ops/cards-2026-11-07.jsonl', { ts: ts(0, 1), round: 1 + (i % 3), source: ['first', 'first', 'retry', 'runner_up', null][i % 5], reasons: i % 4 === 0 ? ['free_repeat'] : [] })

const handlers = createStatsHandlers(() => ({ store, env: { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, now: () => NOW, payments: async () => ({ found: pays, failure: null }) }))
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const r = new Request(url, { headers: req.headers as Record<string, string> })
  const out = url.pathname === '/ops/stats.json' ? await handlers.json(r) : url.pathname === '/ops/stats' ? await handlers.page(r) : new Response('not found', { status: 404 })
  res.writeHead(out.status, Object.fromEntries(out.headers))
  res.end(Buffer.from(await out.arrayBuffer()))
})
server.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => console.log(`listening ${(server.address() as { port: number }).port}`))
