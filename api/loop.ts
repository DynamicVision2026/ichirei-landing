// The customer loop's routes (ticket 2026-11-15): the basket, the free-gift card and the small "who is this browser" answer the landing bars use. Web-standard handlers, mounted by server/app.ts.
//
//   GET    /api/me                  → { basket: { count }, ready: { id, name } | null, hold: HoldView | null }      (the landing's bars; one cheap read)
//   POST   /api/basket              → save (or update) the basket item of a result page            { id, token, count, created }
//   GET    /api/basket              → the browser's basket (newest first) and its private-link token   { items, token }
//   GET    /api/basket/<id>         → one item in full, to open its result page again
//   DELETE /api/basket/<id>         → "×"
//   GET    /api/basket/qr.svg       → the QR of the private link
//   GET    /api/b/<token>           → open a basket by its private link (a wrong token is a plain 404: the page then shows the normal landing)
//   GET    /api/promo               → the live card: { on, left, daily, hold }          (cached 8 s per instance; the page asks every 60 s)
//   POST   /api/promo/hold          → "Hold my free gift" { email, code, marketing? }
//
// Nothing here calls a model. A basket item's resume payload and the customer's email are never put in a log line.

import QRCode from 'qrcode'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { SlidingWindowLimiter, clientIp } from '../engine/rate-limit.ts'
import { visitorOf } from '../engine/visitor.ts'
import { deleteBasketItem, ensureBasketToken, listBasket, openBasketLink, readBasketItem, saveBasketItem, BASKET_TOKEN_PATTERN, type SaveInput } from '../engine/basket.ts'
import { customerIdOf, readCustomer, recordCustomerEvent } from '../engine/customer.ts'
import { promoDaily, promoHoldsPerDay, promoOn } from '../engine/promo.ts'
import { holdOfBrowser, liveCount, placeHold, reapExpired, type PromoDeps } from '../engine/promo-holds.ts'
import { promoShopifyFrom, type PromoShopify } from '../engine/promo-shopify.ts'
import { recordHealth } from '../engine/health.ts'
import { isOrderRecord } from '../engine/buyer.ts'
import { publicUrl } from '../engine/animation.ts'

const MAX_BODY_BYTES = 300_000
const hdr = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'private, no-store', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: hdr({ 'content-type': 'application/json; charset=utf-8', ...extra }) })

export interface LoopDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  shopify?: PromoShopify | null
}

async function readBody(req: Request): Promise<unknown | 'big' | null> {
  const text = await req.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return 'big'
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')

/** The paid-but-not-yet-collected gift this browser made, for the "Your gift for {name} is ready. Collect it →" bar. */
async function readyGift(store: OrderStore, browser: string): Promise<{ id: string; name: string } | null> {
  const rec = await readCustomer(store, await customerIdOf(store, browser))
  if (!rec) return null
  const refs = rec.events.filter((e) => (e.code === 'ordered_paid' || e.code === 'ordered_free') && e.ref).map((e) => e.ref as string).reverse().slice(0, 3)
  for (const ref of refs) {
    try {
      const o = await store.get(ref)
      if (isOrderRecord(o) && o.animation_id && !o.collected_at && !o.ops?.cancelled_at) return { id: o.animation_id, name: o.production.receiver_name }
    } catch {
      // an order that cannot be read is simply not offered
    }
  }
  return null
}

export function createLoopHandlers(deps: () => LoopDeps) {
  const holdLimiter = new SlidingWindowLimiter(12, 60 * 60_000)
  const promoDeps = (d: LoopDeps): PromoDeps => ({ store: d.store, env: d.env ?? process.env, ...(d.now ? { now: d.now } : {}), shopify: d.shopify === undefined ? promoShopifyFrom(d.env ?? process.env) : d.shopify })
  let lastReap = 0

  return {
    async me(req: Request): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      if (!d.store || !browser) return json(200, { basket: { count: 0 }, ready: null, hold: null })
      const now = d.now?.() ?? new Date()
      // a visit lands on the timeline of a record that already exists (a visit alone never makes a record)
      const lang = new URL(req.url, 'http://localhost').searchParams.get('l')
      if (await readCustomer(d.store, await customerIdOf(d.store, browser))) void recordCustomerEvent(d.store, { browser }, 'visited', { language: lang && /^[a-zA-Z-]{2,8}$/.test(lang) ? lang : null }, now)
      const [list, ready, hold] = await Promise.all([listBasket(d.store, browser), readyGift(d.store, browser), holdOfBrowser(d.store, browser, now)])
      return json(200, { basket: { count: list.items.length }, ready, hold: hold && (hold.view.state === 'active' || hold.view.state === 'checkout') ? hold.view : null })
    },

    async basketSave(req: Request): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      if (!browser) return json(400, { error: 'no_browser', code: 'no_browser' })
      const body = (await readBody(req)) as Record<string, unknown> | 'big' | null
      if (body === 'big') return json(413, { error: 'too_large', code: 'too_large' })
      if (!body || typeof body !== 'object') return json(400, { error: 'bad_request', code: 'bad_request' })
      const resume = body.resume
      const input: SaveInput = {
        resume: resume && typeof resume === 'object' ? (resume as Record<string, unknown>) : ({} as Record<string, unknown>),
        story: str(body.story, 6000),
        language: str(body.language, 12),
        kanji: str(body.kanji, 4),
        reading: str(body.reading, 60),
        word: str(body.word, 60),
        line: str(body.line, 200),
        to: str(body.to, 40),
        from: str(body.from, 40),
        preview_id: typeof body.preview_id === 'string' ? body.preview_id : null,
      }
      const now = d.now?.() ?? new Date()
      const r = await saveBasketItem(d.store, browser, input, now)
      if (!r.ok) return json(r.code === 'too_large' ? 413 : r.code === 'no_store' ? 503 : 400, { error: r.code, code: r.code })
      if (r.created) void recordHealth(d.store, 'basket_saved', {}, now)
      const list = await listBasket(d.store, browser)
      return json(200, { id: r.id, token: r.token, count: list.items.length, created: r.created })
    },

    async basketList(req: Request): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      if (!browser) return json(200, { items: [], token: null })
      const l = await listBasket(d.store, browser)
      return json(200, { items: l.items, token: l.token, link: l.token ? `${publicUrl(d.env)}/b/${l.token}` : null })
    },

    async basketItem(req: Request, id: string): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      const item = browser ? await readBasketItem(d.store, browser, id) : null
      return item ? json(200, item) : json(404, { error: 'not_found', code: 'not_found' })
    },

    async basketDelete(req: Request, id: string): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      const ok = browser ? await deleteBasketItem(d.store, browser, id) : false
      return ok ? json(200, { deleted: true }) : json(404, { error: 'not_found', code: 'not_found' })
    },

    async basketQr(req: Request): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      const l = browser ? await listBasket(d.store, browser) : { items: [], token: null }
      if (!l.token) return json(404, { error: 'not_found', code: 'not_found' })
      const svg = await QRCode.toString(`${publicUrl(d.env)}/b/${l.token}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
      return new Response(svg, { status: 200, headers: hdr({ 'content-type': 'image/svg+xml; charset=utf-8' }) })
    },

    async basketLink(req: Request, token: string): Promise<Response> {
      const d = deps()
      const browser = visitorOf(req, d.env)
      if (!browser || !BASKET_TOKEN_PATTERN.test(token)) return json(404, { error: 'not_found', code: 'not_found' })
      const r = await openBasketLink(d.store, browser, token)
      if (!r) return json(404, { error: 'not_found', code: 'not_found' })
      const now = d.now?.() ?? new Date()
      void recordHealth(d.store, 'basket_link_opened', {}, now)
      return json(200, { items: r.items, token: r.token })
    },

    async promoState(req: Request): Promise<Response> {
      const d = deps()
      const env = d.env ?? process.env
      const now = d.now?.() ?? new Date()
      if (!promoOn(env, now) || !d.store) return json(200, { on: false })
      // ends of holds are handled on a timer by whoever asks (a minute apart at most), as well as by the daily trigger
      if (now.getTime() - lastReap > 60_000) {
        lastReap = now.getTime()
        void reapExpired(promoDeps(d)).catch(() => {})
      }
      const c = await liveCount(d.store, env, now)
      const browser = visitorOf(req, d.env)
      const h = browser ? await holdOfBrowser(d.store, browser, now) : null
      const hold = h && (h.view.state === 'active' || h.view.state === 'checkout') ? h.view : null
      // how this browser's last hold of the day ended, for the card's "Your hold ended. Hold again?" and "You've already given today's free gift."
      const ended = h && !hold ? (h.view.state === 'used' ? 'used' : h.view.state === 'expired' ? (h.rec.count >= promoHoldsPerDay(env) ? 'three_holds' : 'expired') : null) : null
      return json(200, { on: true, left: c.left, daily: promoDaily(env), ended, hold: hold ? { state: hold.state, expires_at: hold.expires_at, minutes_left: hold.minutes_left, email: hold.email } : null })
    },

    async promoHold(req: Request): Promise<Response> {
      const d = deps()
      const now = d.now?.() ?? new Date()
      const ip = clientIp(req)
      if (!holdLimiter.hit(ip, now.getTime())) return json(429, { error: 'rate_limited', code: 'rate_limited' }, { 'Retry-After': '600' })
      const body = (await readBody(req)) as Record<string, unknown> | 'big' | null
      if (!body || body === 'big' || typeof body !== 'object') return json(400, { error: 'bad_request', code: 'bad_request' })
      const browser = visitorOf(req, d.env)
      const r = await placeHold(promoDeps(d), { email: body.email, code: body.code, browser, ip, marketing: body.marketing === true, language: body.language === 'ja' ? 'ja' : 'en' }) // one shared pool for /en and /ja (2026-11-16); the language is only recorded
      if (!r.ok) return json(r.code === 'unavailable' ? 503 : 200, { ok: false, code: r.code })
      const left = (await liveCount(d.store, d.env ?? process.env, now, true)).left
      const token = browser ? await ensureBasketToken(d.store, browser, now).catch(() => null) : null
      return json(200, { ok: true, existing: r.existing, link: token ? `${publicUrl(d.env)}/b/${token}` : null, hold: { state: r.hold.state, expires_at: r.hold.expires_at, minutes_left: r.hold.minutes_left, email: r.hold.email, count: r.hold.count }, left })
    },
  }
}

export const loopHandlers = createLoopHandlers(() => ({ store: createOrderStore() }))
