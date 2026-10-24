// POST /api/track { order, email } — order status for the /track page.
//
// Read-only and ICHIREI-only (engine/track.ts). The same plain answer — 404 { error: "not_found" } —
// is given for a bad number, a wrong email, an order with no email and an order without an ICHIREI
// SKU, so the endpoint cannot be used to find out which orders or emails exist. Rate-limited by IP
// (and by order number for wrong guesses). 503 { error: "unavailable" } means WE cannot ask Shopify
// (not configured / permission / outage), never "not found".
//
// Web-standard handler like api/order.ts: mounted by server/app.ts.

import {
  AdminTokenCache,
  TrackUnavailable,
  loadTrackConfig,
  lookupOrder,
  normalizeEmail,
  normalizeOrderNumber,
  readAdminSecret,
  type TrackConfig,
  type TrackDeps,
} from '../engine/track.ts'
import { SlidingWindowLimiter, clientIp } from '../engine/rate-limit.ts'

const MAX_BODY_BYTES = 2_000

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })

export interface TrackHandlerDeps {
  config: TrackConfig | null
  missing: string[]
  secret: () => Promise<string>
  fetchImpl?: typeof fetch
  now?: () => number
}

export interface TrackLimits {
  /** Requests per IP per window. */
  perIp?: { max: number; windowMs: number }
  /** WRONG guesses per order number per window (stops email guessing for one order). */
  perOrderFailures?: { max: number; windowMs: number }
  /** Requests per instance per window — a backstop against many IPs. */
  global?: { max: number; windowMs: number }
}

export function createTrackHandler(deps: () => TrackHandlerDeps, limits: TrackLimits = {}) {
  const perIp = new SlidingWindowLimiter(limits.perIp?.max ?? 10, limits.perIp?.windowMs ?? 10 * 60_000)
  const perOrder = new SlidingWindowLimiter(limits.perOrderFailures?.max ?? 5, limits.perOrderFailures?.windowMs ?? 60 * 60_000)
  const global = new SlidingWindowLimiter(limits.global?.max ?? 300, limits.global?.windowMs ?? 60 * 60_000, 4)
  const tokens = new AdminTokenCache()

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
    const d = deps()
    const now = d.now?.() ?? Date.now()

    if (!d.config) return json(503, { error: 'unavailable', code: 'not_configured', missing: d.missing })

    // Brakes first, so a flood costs nothing.
    if (!perIp.hit(clientIp(req), now) || !global.hit('all', now)) {
      return json(429, { error: 'rate_limited' }, { 'Retry-After': '600' })
    }

    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request body too large' })
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return json(400, { error: 'bad_request' })
    }
    const o = (body ?? {}) as { order?: unknown; email?: unknown }
    const number = normalizeOrderNumber(o.order)
    const email = normalizeEmail(o.email)
    if (!number || !email) return json(400, { error: 'bad_request' })

    if (perOrder.blocked(`o:${number}`, now)) return json(429, { error: 'rate_limited' }, { 'Retry-After': '3600' })

    const td: TrackDeps = { config: d.config, secret: d.secret, fetchImpl: d.fetchImpl, now: d.now }
    try {
      const answer = await lookupOrder(number, email, td, tokens)
      if (!answer) {
        perOrder.hit(`o:${number}`, now)
        return json(404, { error: 'not_found' })
      }
      return json(200, answer)
    } catch (err) {
      // The reason goes to the log (never the secret or token — none of them is in the message).
      console.error('[ichirei-track] unavailable:', err instanceof Error ? err.message : err)
      return json(503, { error: 'unavailable', code: err instanceof TrackUnavailable ? 'upstream' : 'error' })
    }
  }
}

export const POST = createTrackHandler(() => {
  const { config, missing } = loadTrackConfig()
  return { config, missing, secret: () => readAdminSecret() }
})

export const GET = () => json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
