// The receiver's gift page (engine/gift.ts):
//   GET  /api/gift/<token>                 — what /g/<token> shows (the film, the character, the poem, the lines, the message); never a price,
//                                            an order number, the other candidates or the sender's story.
//   POST /api/gift/<token>/render          — the film's pictures, drawn on the first open (the same run as the sender's page: one set per order).
//   GET  /api/gift/<token>/picture/<n>.webp — one saved picture, through the server, under the RECEIVER's own link.
//   GET  /api/gift/<token>/qr.svg          — a QR code of the receiver's address (the printed card carries it).
//   POST /api/gift/<token>/address         — the e-gift receiver types their address (once). Kept on our side only; never returned by any call.
// Possession of the link is the only access control, as for the sender's page. Never cached by shared caches, never indexed.

import QRCode from 'qrcode'
import { ANIMATION_ID_PATTERN, isAnimationRecord, type AnimationRecord } from '../engine/animation.ts'
import { GIFT_TOKEN_PATTERN, checkAddress, giftUrl, giftView, isGiftRecord, type GiftRecord } from '../engine/gift.ts'
import { readArt, picturePath, type ArtRecord } from '../engine/film-art.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { createAnimationHandlers, type AnimationDeps } from './animation.ts'
import { filmUsable } from '../engine/animation.ts'

const headers = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: headers({ 'content-type': 'application/json; charset=utf-8', ...extra }) })
const noStore = { 'cache-control': 'private, no-store' }

export interface GiftDeps extends AnimationDeps {
  store: OrderStore | null
}

async function loadGift(token: string, d: GiftDeps): Promise<{ status: 200; gift: GiftRecord; anim: AnimationRecord } | { status: 404 | 503 }> {
  if (!GIFT_TOKEN_PATTERN.test(token)) return { status: 404 }
  if (!d.store) return { status: 503 }
  try {
    const g = await d.store.get(token)
    if (!isGiftRecord(g)) return { status: 404 }
    const a = await d.store.get(g.animation_id)
    if (!isAnimationRecord(a)) return { status: 404 }
    return { status: 200, gift: g, anim: a }
  } catch {
    return { status: 503 }
  }
}

const safeArt = async (store: OrderStore | null, id: string): Promise<ArtRecord | null> => {
  if (!store) return null
  try {
    return await readArt(store, id)
  } catch {
    return null
  }
}

export function createGiftHandlers(deps: () => GiftDeps) {
  const anim = createAnimationHandlers(deps)
  return {
    async view(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const art = filmUsable(r.anim.film) && r.anim.film.status === 'ready' ? await safeArt(d.store, r.anim.id) : null
      return json(200, giftView(r.gift, r.anim, art), noStore)
    },

    /** The first open: draw the pictures (the sender's own render, by the sender's id — never shown to the receiver) and answer with the receiver's view. */
    async render(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const res = await anim.render(r.gift.animation_id)
      if (!res.ok) return json(res.status, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      const j = (await res.json()) as { state: string }
      // the view is built again from the stored records so that it can only ever be the receiver's view
      const fresh = await loadGift(token, d)
      const rec = fresh.status === 200 ? fresh : r
      const art = filmUsable(rec.anim.film) && rec.anim.film.status === 'ready' ? await safeArt(d.store, rec.anim.id) : null
      return json(200, { state: j.state, view: giftView(rec.gift, rec.anim, art) }, noStore)
    },

    async picture(token: string, n: string): Promise<Response> {
      const d = deps()
      const k = /^[1-4]$/.test(n) ? Number(n) : 0
      if (!GIFT_TOKEN_PATTERN.test(token) || !k) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (!ANIMATION_ID_PATTERN.test(r.gift.animation_id)) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      let bytes: Buffer | null
      try {
        bytes = await d.store!.getObject(picturePath(r.gift.animation_id, k))
      } catch {
        return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      }
      if (!bytes) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      return new Response(new Uint8Array(bytes), { status: 200, headers: headers({ 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' }) })
    },

    async qr(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const svg = await QRCode.toString(giftUrl(r.gift.token, d.env), { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
      return new Response(svg, { status: 200, headers: headers({ 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, no-store' }) })
    },

    /** The e-gift receiver types their address — once. The address is stored on the gift record and returned by NO call. */
    async address(token: string, body: unknown): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const g = r.gift
      if (!g.egift) return json(409, { error: 'This gift is not an e-gift', code: 'not_egift' }, noStore)
      if (g.egift.state === 'received') return json(409, { error: 'The address has already been received', code: 'already_received' }, noStore)
      const checked = checkAddress(body, g.package)
      if (!checked.ok) return json(400, { error: checked.error, field: checked.field }, noStore)
      const now = d.now?.() ?? new Date()
      const next: GiftRecord = { ...g, egift: { ...g.egift, state: 'received', received_at: now.toISOString(), address: checked.address } }
      try {
        await d.store!.put(token, next)
      } catch {
        return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      }
      console.log(`[ichirei-gift] address_received ${JSON.stringify({ token_prefix: token.slice(0, 5), country: checked.address.country })}`) // no name, no address
      return json(200, { ok: true }, noStore)
    },
  }
}

export const handlers = createGiftHandlers(() => ({ store: createOrderStore() }))
