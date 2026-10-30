// GET  /api/animation/<id>              — what the page /a/<id> plays (the private story film of one order); `film: null` while its script is being written,
//                                         `film.pictures: null` while its four pictures are not drawn yet.
// POST /api/film/<id>/render            — draws the four pictures (the first open of the film, after payment) and stays open until they are done (≤ 120 s),
//                                         so Cloud Run keeps the CPU allocated. Two opens draw one set (engine/film-art.ts).
// GET  /api/film/<id>/picture/<n>.webp  — one saved picture, through the server (the bucket is private and never listed).
// GET  /api/animation/<id>/qr.svg       — a QR code of the page's address, for the printed card (the workshop fetches it by id).
//
// The id is a private, unguessable link (100 bits): possession of the link is the only access control, as for any shared link. The answers
// are never cached by shared caches and never indexed. Web-standard handlers like api/order.ts; mounted by server/app.ts.

import QRCode from 'qrcode'
import type Anthropic from '@anthropic-ai/sdk'
import { ANIMATION_ID_PATTERN, animationUrl, animationView, artRevFor, filmUsable, isAnimationRecord, sampleRecord, type AnimationRecord } from '../engine/animation.ts'
import { giftUrl, isGiftRecord } from '../engine/gift.ts'
import { ensureArt, picturePath, readArt, renderBudgetMs, type ArtRecord, type ImageClient } from '../engine/film-art.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { FILM_RETRY_AFTER_MS, ensureFilm, filmInFlight, raceTimeout } from '../engine/film-store.ts'
import type { FilmInput, FilmRecord } from '../engine/film.ts'

const headers = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: headers({ 'content-type': 'application/json; charset=utf-8', ...extra }) })

export interface AnimationDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  /** Tests: stands in for the film-script call. */
  film?: (input: FilmInput) => Promise<FilmRecord>
  /** Tests: stand in for the image model and the picture check. */
  image?: ImageClient
  vision?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  /** Tests: how often a waiting open looks at the store (ms). */
  pollMs?: number
}

async function load(id: string, d: AnimationDeps) {
  if (!ANIMATION_ID_PATTERN.test(id)) return { status: 404 as const }
  const sample = sampleRecord(id, d.env)
  if (sample) return { status: 200 as const, rec: sample } // a reserved sample film (ICHIREI_ANIMATION_SAMPLES=on): no order behind it
  if (!d.store) return { status: 503 as const }
  let rec: object | null
  try {
    rec = await d.store.get(id)
  } catch {
    return { status: 503 as const }
  }
  return isAnimationRecord(rec) ? { status: 200 as const, rec } : { status: 404 as const }
}

const safeArt = async (store: OrderStore | null, id: string): Promise<ArtRecord | null> => {
  if (!store) return null
  try {
    return await readArt(store, id, artRevFor(id))
  } catch {
    return null
  }
}

/** The film script of a record, written now when it is missing (a lost call, or a film from before the pictures were drawn from descriptions). */
async function withScript(rec: AnimationRecord, d: AnimationDeps, force: boolean): Promise<AnimationRecord> {
  if (filmUsable(rec.film) || rec.order_ref === 'SAMPLE' || !d.store) return rec
  if (force || filmInFlight(rec.id) || (d.now?.() ?? new Date()).getTime() - Date.parse(rec.created_at) > FILM_RETRY_AFTER_MS) return ensureFilm(d.store, rec, { make: d.film })
  return rec
}

export function createAnimationHandlers(deps: () => AnimationDeps) {
  return {
    async view(id: string): Promise<Response> {
      const d = deps()
      const r = await load(id, d)
      if (r.status === 503) return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      if (r.status === 404) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      // No script yet: if one is on its way (or the first try never finished, long ago) look again here — once, briefly — before answering "not yet".
      const rec = await withScript(r.rec, d, false)
      const art = filmUsable(rec.film) && rec.film.status === 'ready' ? await safeArt(d.store, rec.id) : null
      const view = animationView(rec, art)
      // the sender's page only: what to share with the receiver and where the order stands (no price, no names)
      if (rec.gift_token && d.store) {
        try {
          const g = await d.store.get(rec.gift_token)
          if (isGiftRecord(g)) view.gift = { url: giftUrl(g.token, d.env), size_code: g.size_code, ship_to: g.ship_to, egift_state: g.egift?.state ?? null }
        } catch {
          // the page works without it
        }
      }
      return json(200, view, { 'cache-control': 'private, no-store' })
    },

    /** The first open of a film: write its script if it is missing, then draw its four pictures. The answer carries the view (with the pictures when done). */
    async render(id: string): Promise<Response> {
      const d = deps()
      const r = await load(id, d)
      if (r.status === 503) return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      if (r.status === 404) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      const rec = await withScript(r.rec, d, true)
      const noStore = { 'cache-control': 'private, no-store' }
      if (!filmUsable(rec.film)) return json(200, { state: 'pending', view: animationView(rec, null) }, noStore)
      if (rec.film.status === 'fallback' || !d.store) return json(200, { state: 'ready', view: animationView(rec, null) }, noStore)
      const budget = renderBudgetMs(d.env)
      const art = await raceTimeout(ensureArt({ store: d.store, image: d.image, client: d.vision, env: d.env, log: d.log, now: d.now, pollMs: d.pollMs }, { id: rec.id, film: rec.film, memorial: rec.memorial, language: rec.language, rev: artRevFor(rec.id) }), budget)
      if (!art) return json(200, { state: 'pending', view: animationView(rec, await safeArt(d.store, rec.id)) }, noStore) // still being drawn: ask again
      if (art.status === 'rendering') return json(200, { state: 'pending', view: animationView(rec, art) }, noStore)
      return json(200, { state: art.status === 'deferred' ? 'deferred' : 'ready', view: animationView(rec, art) }, noStore)
    },

    async picture(id: string, n: string): Promise<Response> {
      const d = deps()
      const k = /^[1-4]$/.test(n) ? Number(n) : 0
      if (!ANIMATION_ID_PATTERN.test(id) || !k) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      if (!d.store) return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      let bytes: Buffer | null
      try {
        bytes = await d.store.getObject(picturePath(id, k))
      } catch {
        return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      }
      if (!bytes) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      // the address carries the time the set was made, so it never changes under a browser that has it
      return new Response(new Uint8Array(bytes), { status: 200, headers: headers({ 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' }) })
    },

    async qr(id: string): Promise<Response> {
      const d = deps()
      const r = await load(id, d)
      if (r.status === 503) return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      if (r.status === 404) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      const svg = await QRCode.toString(animationUrl(r.rec.id, d.env), { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
      return new Response(svg, { status: 200, headers: headers({ 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, no-store' }) })
    },
  }
}

export const handlers = createAnimationHandlers(() => ({ store: createOrderStore() }))
