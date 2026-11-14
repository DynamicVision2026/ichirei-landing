// Waiting orders (2026-11-13) — the two doors:
//
//   POST /api/claim { order, email }          the /claim page: checks the number and the e-mail against the waiting-order record (constant-time compare, at most 5 tries per
//                                             hour per IP) and, on a match, answers { ok, token, order, language }. The token is what POST /api/order then needs to attach the
//                                             chosen character to the EXISTING order (no second payment). Any other case — no such order, wrong e-mail, already claimed — is the same
//                                             404 { code: "not_found" }, so the page cannot be used to find out which orders or e-mails exist.
//   POST /api/shopify/orders-paid             Shopify's "order payment" webhook (X-Shopify-Hmac-Sha256 = base64 HMAC-SHA256 of the raw body with the store's webhook secret, secret
//                                             SHOPIFY_WEBHOOK_SECRET from the environment or Secret Manager). A valid call always answers 200 (Shopify retries on anything else); an order
//                                             that is a waiting order is recorded, every other order is ignored. Nothing is ever written to Shopify.
//
// Web-standard handlers like api/order.ts: mounted by server/app.ts.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { SlidingWindowLimiter, clientIp } from '../engine/rate-limit.ts'
import { adminTokens, trackDepsOf } from '../engine/payments-lookup.ts'
import { lookupWaiting } from '../engine/waiting-shopify.ts'
import { fromWebhook, matchClaim, normalizeEmail, normalizeOrderNumber, openClaimSession, readWaiting, recordWaiting, waitingFromShopify } from '../engine/waiting.ts'
import { readSecret, type TrackDeps } from '../engine/track.ts'
import { isOrderRecord } from '../engine/buyer.ts'
import { markPaidSeen, orderRefOfFacts } from '../engine/paid-seen.ts'
import type { OrderRecord } from '../engine/order.ts'
import { checkOrder, startTryIfDue } from '../engine/gift-check.ts'
import { makePoemFor } from '../engine/poem-repair.ts'

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } })

export interface ClaimDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  /** The read-only Shopify app (null = not configured). */
  admin?: TrackDeps | null
  /** The webhook secret (tests inject it; production reads SHOPIFY_WEBHOOK_SECRET from the environment or Secret Manager). */
  webhookSecret?: () => Promise<string>
  /** Called (not awaited by Shopify's retry logic) once an order made on our site is seen paid: the completeness check of the paid gift (engine/gift-check.ts). Tests inject a spy. */
  onPaid?: (rec: OrderRecord) => Promise<void>
}

export interface ClaimLimits {
  /** Tries per IP per window (default 5 per hour). */
  max?: number
  windowMs?: number
}

export function createClaimHandlers(deps: () => ClaimDeps, limits: ClaimLimits = {}) {
  const limiter = new SlidingWindowLimiter(limits.max ?? 5, limits.windowMs ?? 60 * 60_000)

  return {
    async claim(req: Request): Promise<Response> {
      if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
      const d = deps()
      const now = d.now?.() ?? new Date()
      // every try counts, right or wrong (a refused one is not looked at at all)
      if (!limiter.hit(clientIp(req), now.getTime())) {
        return json(429, { error: 'Too many tries. Please wait a while and try again.', code: 'rate_limited' }, { 'Retry-After': String(Math.ceil((limits.windowMs ?? 3_600_000) / 1000)) })
      }
      const text = await req.text()
      if (text.length > 2_000) return json(413, { error: 'Request body too large' })
      let body: { order?: unknown; email?: unknown } | null = null
      try {
        body = JSON.parse(text)
      } catch {
        return json(400, { error: 'Body is not valid JSON' })
      }
      const number = normalizeOrderNumber(body?.order)
      const email = normalizeEmail(body?.email)
      const notFound = () => json(404, { error: 'not_found', code: 'not_found' })
      if (!number || !email) return notFound()
      if (!d.store) return json(503, { error: 'unavailable', code: 'store_not_configured' })
      let rec = await readWaiting(d.store, number)
      // never seen (the webhook is not set up yet, or the order is older than it): ask Shopify, read-only, about this one order
      if (!rec) rec = await lookupWaiting(d.store, d.admin === undefined ? trackDepsOf(d.env ?? process.env) : d.admin, adminTokens, number, now)
      const hit = matchClaim(rec, number, email)
      if (!hit) return notFound()
      const token = await openClaimSession(d.store, hit, now)
      console.log('[ichirei-waiting]', JSON.stringify({ event: 'claim_opened', order: hit.order_name }))
      return json(200, { ok: true, token, order: hit.order_name, order_number: hit.order_number, language: hit.language })
    },

    async webhook(req: Request): Promise<Response> {
      if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
      const d = deps()
      const env = d.env ?? process.env
      const raw = Buffer.from(await req.arrayBuffer())
      if (raw.length > 1_000_000) return json(413, { error: 'Request body too large' })
      let secret = ''
      try {
        secret = await (d.webhookSecret ?? (() => readSecret('SHOPIFY_WEBHOOK_SECRET', env)))()
      } catch {
        return json(503, { error: 'unavailable', code: 'webhook_not_configured' })
      }
      if (!secret) return json(503, { error: 'unavailable', code: 'webhook_not_configured' })
      const given = Buffer.from(req.headers.get('x-shopify-hmac-sha256') ?? '', 'base64')
      const want = createHmac('sha256', secret).update(raw).digest()
      if (given.length !== want.length || !timingSafeEqual(given, want)) return json(401, { error: 'bad_signature' })
      if (!d.store) return json(503, { error: 'unavailable', code: 'store_not_configured' })
      let body: unknown = null
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        return json(200, { ok: true, waiting: false })
      }
      const facts = fromWebhook(body)
      const at = d.now?.() ?? new Date()
      // an order made on OUR site: remember that its payment was seen (collect needs it), and start the check that the gift is complete (2026-11-14)
      if (facts && facts.paid && !facts.cancelled) {
        const ref = orderRefOfFacts(facts)
        if (ref) {
          try {
            const rec = await d.store.get(ref)
            if (isOrderRecord(rec)) {
              const seen = await markPaidSeen(d.store, rec, facts.paidAt ?? facts.createdAt ?? null, at)
              console.log('[ichirei-paid]', JSON.stringify({ event: 'paid_seen', source: 'webhook' }))
              if (d.onPaid) await d.onPaid(seen).catch((err) => console.error('[ichirei-paid] onPaid failed', err instanceof Error ? err.message : err))
            }
          } catch (err) {
            console.error('[ichirei-paid] webhook record failed', err instanceof Error ? err.message : err)
            return json(500, { error: 'store_failed' }) // Shopify retries a non-200: the sighting is written on the next delivery
          }
        }
      }
      const w = facts ? waitingFromShopify(facts, 'webhook', at) : null
      if (!w) return json(200, { ok: true, waiting: false })
      await recordWaiting(d.store, w)
      return json(200, { ok: true, waiting: true })
    },
  }
}

/** The webhook's follow-up for an order made on our site: the first completeness try of the paid gift starts in the background (engine/gift-check.ts). */
async function onPaidDefault(rec: OrderRecord): Promise<void> {
  const store = createOrderStore()
  if (!store) return
  const chk = await checkOrder(store, rec)
  startTryIfDue({ store, makePoem: (r) => makePoemFor(r) }, rec, chk)
}

export const claimHandlers = createClaimHandlers(() => ({ store: createOrderStore(), onPaid: onPaidDefault }))
