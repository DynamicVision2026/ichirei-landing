// GET /api/animation/<id> — what the page /a/<id> plays (the private story animation of one order).
// GET /api/animation/<id>/qr.svg — a QR code of the page's address, for the printed card (the workshop fetches it by id).
// GET /api/strokes?c=<one character>&script=ja|zh — the stroke-order data of one character (public, open data, cacheable).
//
// The id is a private, unguessable link (100 bits): possession of the link is the only access control, as for any shared link. The answers
// are never cached by shared caches and never indexed. Web-standard handlers like api/order.ts; mounted by server/app.ts.

import QRCode from 'qrcode'
import { ANIMATION_ID_PATTERN, animationUrl, animationView, isAnimationRecord, sampleRecord } from '../engine/animation.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { isOneIdeograph, strokesFor, type StrokeScript } from '../engine/stroke-data.ts'

const headers = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: headers({ 'content-type': 'application/json; charset=utf-8', ...extra }) })

export interface AnimationDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
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

export function createAnimationHandlers(deps: () => AnimationDeps) {
  return {
    async view(id: string): Promise<Response> {
      const r = await load(id, deps())
      if (r.status === 503) return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      if (r.status === 404) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      return json(200, animationView(r.rec), { 'cache-control': 'private, no-store' })
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

/** Stroke data: public open data, so it is cached hard (the answer for a character never changes). */
export function strokesGet(url: URL): Response {
  const c = url.searchParams.get('c')
  const script: StrokeScript = url.searchParams.get('script') === 'zh' ? 'zh' : 'ja'
  if (!isOneIdeograph(c)) return json(400, { error: 'bad_character' }, { 'cache-control': 'no-store' })
  const data = strokesFor(c, script)
  if (!data) return json(404, { error: 'no_strokes' }, { 'cache-control': 'public, max-age=86400' })
  return json(200, data, { 'cache-control': 'public, max-age=31536000, immutable' })
}

export const handlers = createAnimationHandlers(() => ({ store: createOrderStore() }))
