// The owner's gift maker (Ticket 8, 2026-11-25). Owner only — never public, never linked from the site.
//
//   POST /ops/api/gifts        { moment, language, receiver, sender, poem_style?, tag? }  → the finished gift: { id, glyph, reading, line, pictures_ready, receiver_link, sender_page, … }
//   GET  /ops/api/gifts        the outreach gifts (newest first) and today's count
//   GET  /ops/api/gifts/<id>   one gift as it stands; polling it carries on the pictures that are not finished
//   GET  /ops/gifts/new        the same, as a small page
//
// Who may ask: the owner's sign-in (ICHIREI_OWNER_EMAILS) or the /ops password as for every /ops page, or — for an agent — `Authorization: Bearer <ICHIREI_OWNER_API_TOKEN>`. Anything else is refused.
// A browser request that is not a Bearer one must come from this very site (the same rule as every /ops POST). The work itself is engine/owner-gift.ts.

import { checkOpsAuth, sameSitePost, type OpsDeps } from './ops.ts'
import { ownerGiftsPage } from './ops-gifts-page.ts'
import { bearerOwner, givenToday, listOwnerGifts, makeOwnerGift, ownerGiftDailyMax, readOwnerGift, type OwnerGiftDeps } from '../engine/owner-gift.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'

const MAX_BODY_BYTES = 30_000
const headers = (type: string) => ({ 'content-type': type, 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: headers('application/json; charset=utf-8') })

/** What the handlers need: the /ops dependencies plus the stand-ins the tests give for the models (production leaves them out and the real engine, poem, film and picture code runs). */
export interface OwnerGiftsApiDeps extends Pick<OpsDeps, 'store' | 'env' | 'now' | 'readSecret'>, Pick<OwnerGiftDeps, 'engine' | 'poem' | 'film' | 'image' | 'vision' | 'log' | 'pollMs' | 'waitMs'> {}

export function createOwnerGiftHandlers(deps: () => OwnerGiftsApiDeps) {
  /** Bearer token, or the /ops owner gate; a store is needed after that. */
  const guard = async (req: Request, write: boolean): Promise<Response | { d: OwnerGiftsApiDeps; env: NodeJS.ProcessEnv; now: Date; store: OrderStore }> => {
    const d = deps()
    const env = d.env ?? process.env
    const now = d.now?.() ?? new Date()
    const bearer = await bearerOwner(req, env, d.readSecret, now.getTime())
    if (bearer === 'bad') return json(401, { error: 'Unauthorized', code: 'unauthorized' })
    if (bearer === 'none') {
      const denied = await checkOpsAuth(req, env, d.readSecret, d.store ?? null, now)
      if (denied) return denied
      if (write && !sameSitePost(req)) return json(403, { error: 'This must come from the owner page itself.', code: 'forbidden' })
    }
    if (!d.store) return json(503, { error: 'Order storage is not configured', code: 'store_not_configured' })
    return { d, env, now, store: d.store }
  }
  const work = (g: { d: OwnerGiftsApiDeps; env: NodeJS.ProcessEnv; store: OrderStore }): OwnerGiftDeps => ({
    store: g.store, env: g.env, now: g.d.now, engine: g.d.engine, poem: g.d.poem, film: g.d.film, image: g.d.image, vision: g.d.vision, log: g.d.log, pollMs: g.d.pollMs, waitMs: g.d.waitMs,
  })
  return {
    async create(req: Request): Promise<Response> {
      const g = await guard(req, true)
      if (g instanceof Response) return g
      const text = await req.text()
      if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request body too large', code: 'too_large' })
      let body: Record<string, unknown>
      try {
        const j = JSON.parse(text)
        if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object')
        body = j as Record<string, unknown>
      } catch {
        return json(400, { error: 'Body is not valid JSON', code: 'bad_json' })
      }
      const r = await makeOwnerGift(work(g), body)
      if (!r.ok) return json(r.status, { error: r.error, code: r.code, ...(r.follow_up_question ? { follow_up_question: r.follow_up_question } : {}) })
      return json(200, r.gift)
    },
    async get(req: Request, id: string): Promise<Response> {
      const g = await guard(req, false)
      if (g instanceof Response) return g
      const v = await readOwnerGift(work(g), id, { advance: true })
      return v ? json(200, v) : json(404, { error: 'No such gift', code: 'not_found' })
    },
    async list(req: Request): Promise<Response> {
      const g = await guard(req, false)
      if (g instanceof Response) return g
      const gifts = await listOwnerGifts(work(g))
      return json(200, { gifts, today: { n: await givenToday(g.store, g.now), max: ownerGiftDailyMax(g.env) } })
    },
    async page(req: Request): Promise<Response> {
      // the page itself is for a signed-in owner (or the password); a Bearer token is for the API
      const d = deps()
      const denied = await checkOpsAuth(req, d.env ?? process.env, d.readSecret, d.store ?? null, d.now?.() ?? new Date())
      if (denied) return denied
      return new Response(ownerGiftsPage(), { status: 200, headers: headers('text/html; charset=utf-8') })
    },
  }
}

export const ownerGiftHandlers = createOwnerGiftHandlers(() => ({ store: createOrderStore() }))
