// The examples the public pages show (2026-11-20): up to 4 read-only sample gifts (engine/sample.ts) switched on for the Examples page, the page's own language first.
//   GET  /api/examples?lang=ja|en|zh-Hant   → { examples: [{ token, language, glyph, word, line, moment, picture }] }
//   GET  /api/examples/featured?lang=…      → { featured: null | { token, language, glyph, word, moment, pictures: [{ src, caption } × 4], poem: string[] } }   (Part 24: the language's featured sample)
//   POST /api/examples/count { kind: 'view' | 'card', token? }   → a count only (examples-page views, cards opened); no visitor data
// Names never appear: a sample says 「あなた」 / 「一字礼」 and its words had names replaced when it was made. No order, e-mail or token of any real gift is in an answer.

import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { casJson } from '../engine/customer.ts'
import { examplesFor, featuredFor, listSamples } from '../engine/sample.ts'
import { isAnimationRecord } from '../engine/animation.ts'

const headers = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: headers({ 'content-type': 'application/json; charset=utf-8', ...extra }) })
export const examplesStatsPath = 'samples/stats/examples.json'

export interface ExampleCard {
  token: string
  language: string
  glyph: string
  /** The English word (en) or the reading (ja / zh): never a reading alone on an English card. */
  word: string
  /** The one line of how the giver sees the receiver. */
  line: string
  /** One line of the moment, cut short (the first caption of the film). */
  moment: string
  picture: string
}

const cut = (t: string, n: number): string => (t.length > n ? `${[...t].slice(0, n).join('')}…` : t)
const pageLang = (v: string | null): 'ja' | 'en' | 'zh-Hant' => (v === 'en' ? 'en' : v === 'zh-Hant' || v === 'zh' ? 'zh-Hant' : 'ja')

export function createExamplesHandlers(deps: () => { store: OrderStore | null }) {
  return {
    async list(req: Request): Promise<Response> {
      const { store } = deps()
      const lang = pageLang(new URL(req.url, 'http://x').searchParams.get('lang'))
      if (!store) return json(200, { examples: [] }, { 'cache-control': 'no-store' })
      const rows = examplesFor(await listSamples(store).catch(() => []), lang)
      const out: ExampleCard[] = []
      for (const r of rows) {
        const g = (await store.get(r.token).catch(() => null)) as { animation_id?: string; en?: { line_you?: string | null; line?: string } } | null
        const a = g?.animation_id ? await store.get(g.animation_id).catch(() => null) : null
        const moment = isAnimationRecord(a) && a.film?.lines?.length ? a.film.lines[0] : ''
        out.push({ token: r.token, language: r.language, glyph: r.glyph, word: r.language === 'en' ? r.word : r.reading.split(' / ')[0].replace(/\./g, ''), line: r.language === 'en' ? (g?.en?.line_you || g?.en?.line || r.who) : r.who, moment: cut(moment, 60), picture: `/api/gift/${r.token}/picture/1.webp` })
      }
      return json(200, { examples: out }, { 'cache-control': 'public, max-age=60' })
    },
    /** The language's featured sample, for the writing page's small example and the landing's "one moment, four pictures and a poem". Nothing of any real gift: a sample's words had names replaced. */
    async featured(req: Request): Promise<Response> {
      const { store } = deps()
      const lang = pageLang(new URL(req.url, 'http://x').searchParams.get('lang'))
      if (!store) return json(200, { featured: null }, { 'cache-control': 'no-store' })
      const hit = featuredFor(await listSamples(store).catch(() => []), lang)
      if (!hit) return json(200, { featured: null }, { 'cache-control': 'public, max-age=60' })
      const g = (await store.get(hit.token).catch(() => null)) as { animation_id?: string; poem?: { lines?: string[] } | null } | null
      const a = g?.animation_id ? await store.get(g.animation_id).catch(() => null) : null
      if (!isAnimationRecord(a) || !a.film || a.film.lines.length !== 4) return json(200, { featured: null }, { 'cache-control': 'public, max-age=60' })
      const moment = cut((a.moment || a.film.lines[0] || '').trim(), 140)
      return json(200, { featured: { token: hit.token, language: hit.language, glyph: hit.glyph, word: hit.language === 'en' ? hit.word : hit.reading.split(' / ')[0].replace(/\./g, ''), moment, pictures: a.film.lines.map((caption, i) => ({ src: `/api/gift/${hit.token}/picture/${i + 1}.webp`, caption })), poem: (g?.poem?.lines ?? []).map(String) } }, { 'cache-control': 'public, max-age=60' })
    },
    async count(req: Request): Promise<Response> {
      const { store } = deps()
      let body: { kind?: unknown; token?: unknown } = {}
      try {
        body = (await req.json()) as typeof body
      } catch {
        body = {}
      }
      if (store && (body.kind === 'view' || body.kind === 'card')) {
        const k = body.kind
        await casJson<{ views: number; cards: number }>(store, examplesStatsPath, (cur) => ({ views: (cur?.views ?? 0) + (k === 'view' ? 1 : 0), cards: (cur?.cards ?? 0) + (k === 'card' ? 1 : 0) })).catch(() => null)
      }
      return json(200, { ok: true }, { 'cache-control': 'no-store' })
    },
  }
}
export const examplesHandlers = createExamplesHandlers(() => ({ store: createOrderStore() }))
