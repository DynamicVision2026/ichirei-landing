// The receiver's gift page (engine/gift.ts):
//   GET  /api/gift/<token>                 — what /g/<token> shows (the film, the character, the poem, the lines, the message); never a price,
//                                            an order number, the other candidates or the sender's story.
//   POST /api/gift/<token>/render          — the film's pictures, drawn on the first open (the same run as the sender's page: one set per order).
//   GET  /api/gift/<token>/picture/<n>.webp — one saved picture, through the server, under the RECEIVER's own link.
//   GET  /api/gift/<token>/qr.svg          — a QR code of the receiver's address (the printed card carries it).
//   POST /api/gift/<token>/address         — the e-gift receiver types their address (once). Kept on our side only; never returned by any call.
// Possession of the link is the only access control, as for the sender's page. Never cached by shared caches, never indexed.

import { isQuietPurpose } from '../src/order/purpose.ts'
import QRCode from 'qrcode'
import { ANIMATION_ID_PATTERN, isAnimationRecord, type AnimationRecord } from '../engine/animation.ts'
import { orderGate, type OrderGate } from '../engine/buyer.ts'
import { GIFT_TOKEN_PATTERN, arrivingView, checkAddress, checkReply, giftUrl, giftView, isGiftRecord, isLocked, lockedView, todayJst, type GiftRecord } from '../engine/gift.ts'
import { OPEN_DATE_MAX_DAYS } from '../src/order/packages.ts'
import { readArt, picturePath, type ArtRecord } from '../engine/film-art.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { createAnimationHandlers, type AnimationDeps } from './animation.ts'
import { filmUsable } from '../engine/animation.ts'
import { loadArtwork, scrollReady } from '../engine/render/artwork.ts'
import { makeScroll, scrollPdf } from '../engine/render/scroll.ts'
import { makeOgImage } from '../engine/render/og.ts'
import { makeKeepsakeCard } from '../engine/render/keepsake.ts'
import { cleanReading } from '../src/order/reading.ts'
import { injectOg, ogKey, ogMeta } from '../engine/gift-share.ts'
import { ensureFilmVideo, ensureShareFilm, filmComplete, filmVideoPath, serveBytes, shareFilmPath } from '../engine/film-video-store.ts'
import { makeShareCard, type ShareArtwork } from '../engine/render/share.ts'
import { relationLine } from '../src/order/relation-line.ts'
import { cardsPdf, homePrintPdf } from '../engine/render/card.ts'

const headers = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: headers({ 'content-type': 'application/json; charset=utf-8', ...extra }) })
const noStore = { 'cache-control': 'private, no-store' }

export interface GiftDeps extends AnimationDeps {
  store: OrderStore | null
  /** For the tests: stands in for the video renderer. */
  videoRender?: typeof import('../engine/render/film-video.ts').makeFilmVideo
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

/** Whether the buyer has collected the gift (2026-11-06) and whether the order was cancelled: read from the order record (an older order, or one with no record, is open as before). */
async function gateOf(g: GiftRecord, d: GiftDeps): Promise<OrderGate> {
  if (!d.store || !g.order_ref) return 'ok'
  try {
    return orderGate((await d.store.get(g.order_ref)) as never)
  } catch {
    return 'ok'
  }
}
const gone = (g: GiftRecord) => json(410, { error: 'unavailable', language: g.language }, { 'cache-control': 'no-store' })
const notCollected = () => json(403, { error: 'not_collected' }, { 'cache-control': 'no-store' })

/** The closed envelope: true while the opening date has not come — unless the caller holds the SENDER's own id (the sender may always look). */
const closed = (g: GiftRecord, d: GiftDeps, preview?: string | null): boolean => !senderPreview(g, preview) && isLocked(g, d.now?.() ?? new Date())
const senderPreview = (g: GiftRecord, preview?: string | null): boolean => !!preview && preview === g.animation_id
/** The receiver's pictures with the sender's key attached, so a previewing sender's own browser can fetch them before the day. */
const withPreview = <T extends { film: { pictures: string[] | null } | null }>(v: T, key: string): T =>
  v.film?.pictures ? { ...v, film: { ...v.film, pictures: v.film.pictures.map((u) => `${u}${u.includes('?') ? '&' : '?'}preview=${key}`) } } : v

const safeArt = async (store: OrderStore | null, id: string): Promise<ArtRecord | null> => {
  if (!store) return null
  try {
    return await readArt(store, id)
  } catch {
    return null
  }
}

async function scrollResponse(gift: GiftRecord, anim: AnimationRecord, ext: string, d: GiftDeps): Promise<Response> {
  if (ext !== 'png' && ext !== 'pdf') return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
  const art = await safeArt(d.store, anim.id)
  if (!scrollReady(anim, art)) return json(404, { error: 'not_ready' }, { 'cache-control': 'no-store' })
  try {
    const work = await loadArtwork(d.store!, gift, anim, art, d.env)
    const scroll = await makeScroll(work, d.env)
    const body = ext === 'png' ? scroll.png : await scrollPdf(scroll)
    return new Response(new Uint8Array(body), { status: 200, headers: headers({ 'content-type': ext === 'png' ? 'image/png' : 'application/pdf', 'content-disposition': `attachment; filename="ichirei-scroll.${ext}"`, 'cache-control': 'private, no-store' }) })
  } catch (err) {
    console.error('[ichirei-scroll] failed', err instanceof Error ? err.message : err)
    return json(500, { error: 'scroll_failed' }, { 'cache-control': 'no-store' })
  }
}

type Found = { gift: GiftRecord; anim: AnimationRecord }

/** The film as a video (made once, kept): answers when it is ready, or says it is still being made. */
async function videoMake(f: Found, d: GiftDeps): Promise<Response> {
  const art = await safeArt(d.store, f.anim.id)
  if (!filmComplete(f.anim, art)) return json(409, { state: 'not_ready' }, noStore)
  try {
    const r = await ensureFilmVideo({ store: d.store!, env: d.env, now: d.now, render: d.videoRender }, f.gift, f.anim, art)
    if (r.state === 'ready') return json(200, { state: 'ready', seconds: r.meta.seconds, bytes: r.meta.bytes }, noStore)
    return json(r.state === 'busy' ? 202 : 409, { state: r.state === 'busy' ? 'pending' : 'not_ready' }, noStore)
  } catch (err) {
    console.error('[ichirei-film-video] failed', err instanceof Error ? err.message : err)
    return json(500, { state: 'failed' }, noStore)
  }
}

async function videoGet(f: Found, d: GiftDeps, req: Request): Promise<Response> {
  let bytes: Buffer | null
  try {
    bytes = await d.store!.getObject(filmVideoPath(f.anim.id))
  } catch {
    return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
  }
  if (!bytes) return json(404, { error: 'not_ready' }, { 'cache-control': 'no-store' })
  const download = new URL(req.url).searchParams.get('download') === '1'
  return serveBytes(bytes, 'video/mp4', req.headers.get('range'), { 'cache-control': 'private, max-age=3600', 'x-robots-tag': 'noindex, nofollow', 'content-disposition': `${download ? 'attachment' : 'inline'}; filename="ichirei-film.mp4"` })
}

/** The card as a PDF: the e-gift's A4 home-print (outside, inside, crop and fold marks), or a keepsake copy of the wooden sizes' printed card. */
async function cardResponse(f: Found, d: GiftDeps): Promise<Response> {
  const art = await safeArt(d.store, f.anim.id)
  if (!filmComplete(f.anim, art)) return json(404, { error: 'not_ready' }, { 'cache-control': 'no-store' })
  try {
    const work = await loadArtwork(d.store!, f.gift, f.anim, art, d.env)
    const pdf = f.gift.package === 'egift' ? await homePrintPdf(work, d.env) : await cardsPdf([work], d.env)
    return new Response(new Uint8Array(pdf), { status: 200, headers: headers({ 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${f.gift.package === 'egift' ? 'ichirei-card-print-at-home' : 'ichirei-card'}.pdf"`, 'cache-control': 'private, no-store' }) })
  } catch (err) {
    console.error('[ichirei-card] failed', err instanceof Error ? err.message : err)
    return json(500, { error: 'card_failed' }, { 'cache-control': 'no-store' })
  }
}

/** The artwork of the share film and the poem card: the stored pictures and poem plus the ONE relationship line (the relationship chip only; none for 「その他」). */
async function shareArtwork(f: Found, art: ArtRecord | null, d: GiftDeps): Promise<{ work: () => Promise<ShareArtwork>; relation: string | null }> {
  let relationship: string | null = null
  try {
    const o = (await d.store!.get(f.gift.order_ref)) as { engine_result?: { relationship?: string | null } } | null
    relationship = o?.engine_result?.relationship ?? null
  } catch {
    relationship = null
  }
  const relation = relationLine(relationship, f.gift.language)
  return { relation, work: async () => ({ ...(await loadArtwork(d.store!, f.gift, f.anim, art, d.env)), relation }) }
}

/** Sharing is for gifts that are not remembrance (the page shows nothing there). */
const shareOffered = (f: Found) => !f.gift.memorial

async function shareFilmMake(f: Found, d: GiftDeps): Promise<Response> {
  if (!shareOffered(f)) return json(404, { error: 'not_offered' }, { 'cache-control': 'no-store' })
  const art = await safeArt(d.store, f.anim.id)
  if (!filmComplete(f.anim, art)) return json(409, { state: 'not_ready' }, noStore)
  try {
    const { work, relation } = await shareArtwork(f, art, d)
    const r = await ensureShareFilm({ store: d.store!, now: d.now }, f.gift, f.anim, art, work, relation)
    if (r.state === 'ready') return json(200, { state: 'ready', seconds: r.meta.seconds, bytes: r.meta.bytes }, noStore)
    return json(r.state === 'busy' ? 202 : 409, { state: r.state === 'busy' ? 'pending' : 'not_ready' }, noStore)
  } catch (err) {
    console.error('[ichirei-share-film] failed', err instanceof Error ? err.message : err)
    return json(500, { state: 'failed' }, noStore)
  }
}

async function shareFilmGet(f: Found, d: GiftDeps, req: Request): Promise<Response> {
  if (!shareOffered(f)) return json(404, { error: 'not_offered' }, { 'cache-control': 'no-store' })
  let bytes: Buffer | null
  try {
    bytes = await d.store!.getObject(shareFilmPath(f.anim.id))
  } catch {
    return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
  }
  if (!bytes) return json(404, { error: 'not_ready' }, { 'cache-control': 'no-store' })
  return serveBytes(bytes, 'video/mp4', req.headers.get('range'), { 'cache-control': 'private, max-age=3600', 'x-robots-tag': 'noindex, nofollow', 'content-disposition': 'attachment; filename="ichirei-share.mp4"' })
}

async function shareCardGet(f: Found, d: GiftDeps): Promise<Response> {
  if (!shareOffered(f)) return json(404, { error: 'not_offered' }, { 'cache-control': 'no-store' })
  const art = await safeArt(d.store, f.anim.id)
  if (!filmComplete(f.anim, art)) return json(404, { error: 'not_ready' }, { 'cache-control': 'no-store' })
  try {
    const { work } = await shareArtwork(f, art, d)
    const png = await makeShareCard(await work())
    return new Response(new Uint8Array(png), { status: 200, headers: headers({ 'content-type': 'image/png', 'content-disposition': 'attachment; filename="ichirei-poem-card.png"', 'cache-control': 'private, no-store' }) })
  } catch (err) {
    console.error('[ichirei-share-card] failed', err instanceof Error ? err.message : err)
    return json(500, { error: 'card_failed' }, { 'cache-control': 'no-store' })
  }
}

/** English only (2026-11-12): the square card — the character with its reading, word and line. Needs no film. */
async function keepsakeCardResponse(f: Found): Promise<Response> {
  const g = f.gift
  if (g.language !== 'en' || !g.en) return json(404, { error: 'not_offered' }, { 'cache-control': 'no-store' })
  try {
    const png = await makeKeepsakeCard({ glyph: g.glyph, reading: cleanReading(g.romanization.split(' / ')[0]), bridge: g.en, quiet: g.memorial || isQuietPurpose(g.purpose) })
    return new Response(new Uint8Array(png), { status: 200, headers: headers({ 'content-type': 'image/png', 'content-disposition': 'attachment; filename="ichirei-card.png"', 'cache-control': 'private, no-store' }) })
  } catch (err) {
    console.error('[ichirei-keepsake-card] failed', err instanceof Error ? err.message : err)
    return json(500, { error: 'card_failed' }, { 'cache-control': 'no-store' })
  }
}

async function bySender(animationId: string, d: GiftDeps): Promise<Found | Response> {
  if (!ANIMATION_ID_PATTERN.test(animationId) || !d.store) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
  try {
    const a = await d.store.get(animationId)
    if (!isAnimationRecord(a) || !a.gift_token) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
    const r = await loadGift(a.gift_token, d)
    return r.status === 200 ? { gift: r.gift, anim: r.anim } : json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
  } catch {
    return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
  }
}

export function createGiftHandlers(deps: () => GiftDeps) {
  const anim = createAnimationHandlers(deps)
  return {
    async view(token: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const gate = await gateOf(r.gift, d)
      if (gate === 'cancelled') return gone(r.gift)
      // not collected yet: the sealed envelope with no open button (the buyer's own preview sees the final gift)
      if (gate === 'pending' && !senderPreview(r.gift, preview)) return json(200, arrivingView(r.gift), noStore)
      if (closed(r.gift, d, preview)) return json(200, lockedView(r.gift, d.now?.() ?? new Date()), noStore)
      const art = filmUsable(r.anim.film) && r.anim.film.status === 'ready' ? await safeArt(d.store, r.anim.id) : null
      const v = giftView(r.gift, r.anim, art)
      return json(200, senderPreview(r.gift, preview) ? withPreview(v, r.gift.animation_id) : v, noStore)
    },

    /** The first open: draw the pictures (the sender's own render, by the sender's id — never shown to the receiver) and answer with the receiver's view. */
    async render(token: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const gate = await gateOf(r.gift, d)
      if (gate === 'cancelled') return gone(r.gift)
      if (gate === 'pending' && !senderPreview(r.gift, preview)) return notCollected()
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      const res = await anim.render(r.gift.animation_id)
      if (!res.ok) return json(res.status, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      const j = (await res.json()) as { state: string }
      // the view is built again from the stored records so that it can only ever be the receiver's view
      const fresh = await loadGift(token, d)
      const rec = fresh.status === 200 ? fresh : r
      const art = filmUsable(rec.anim.film) && rec.anim.film.status === 'ready' ? await safeArt(d.store, rec.anim.id) : null
      const v = giftView(rec.gift, rec.anim, art)
      return json(200, { state: j.state, view: senderPreview(rec.gift, preview) ? withPreview(v, rec.gift.animation_id) : v }, noStore)
    },

    async picture(token: string, n: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const k = /^[1-4]$/.test(n) ? Number(n) : 0
      if (!GIFT_TOKEN_PATTERN.test(token) || !k) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (!ANIMATION_ID_PATTERN.test(r.gift.animation_id)) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      const gate = await gateOf(r.gift, d)
      if (gate === 'cancelled') return gone(r.gift)
      if (gate === 'pending' && !senderPreview(r.gift, preview)) return notCollected()
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
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

    /** The picture a shared link shows (1200 × 630): the sealed envelope with 「○○へ」 — never the character. Made once per gift, kept in the bucket. */
    async og(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const g = r.gift
      const key = ogKey(g)
      let bytes: Buffer | null = null
      try {
        bytes = await d.store!.getObject(key)
      } catch {
        bytes = null
      }
      if (!bytes) {
        try {
          bytes = await makeOgImage({ to: g.to, from: g.from, memorial: g.memorial || isQuietPurpose(g.purpose), language: g.language }, d.env)
        } catch (err) {
          console.error('[ichirei-og] failed', err instanceof Error ? err.message : err)
          return json(500, { error: 'og_failed' }, { 'cache-control': 'no-store' })
        }
        await d.store!.putObject(key, bytes, 'image/png').catch(() => false)
      }
      return new Response(new Uint8Array(bytes), { status: 200, headers: headers({ 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }) })
    },

    /** /g/<token> as HTML for the crawlers of LINE, WhatsApp, WeChat and mail: the page with this gift's own Open Graph tags. null = serve the page as it is. */
    async page(token: string, html: string): Promise<Response | null> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return null
      const out = injectOg(html, ogMeta(r.gift, d.env, d.now?.() ?? new Date()))
      return new Response(out, { status: 200, headers: headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }) })
    },

    /** The same QR code as a PNG picture: WeChat has no share link, so the sender saves this image and sends it. */
    async qrPng(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const png = await QRCode.toBuffer(giftUrl(r.gift.token, d.env), { type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 720 })
      return new Response(new Uint8Array(png), { status: 200, headers: headers({ 'content-type': 'image/png', 'content-disposition': 'attachment; filename="ichirei-qr.png"', 'cache-control': 'private, no-store' }) })
    },

    // ---- the keepsakes: the film as a video, the card as a PDF (the receiver's own link, or the sender's page by their own id) ----
    async filmMake(token: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return videoMake(r, d)
    },
    async filmGet(token: string, req: Request, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return videoGet(r, d, req)
    },
    async cardPdf(token: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return cardResponse(r, d)
    },
    async filmMakeForSender(animationId: string): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return videoMake(f, d)
    },
    async filmGetForSender(animationId: string, req: Request): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return videoGet(f, d, req)
    },
    /** The sender sets (or clears) the day the envelope opens, after paying and collecting (English share sheet, 2026-11-12). Only while the gift is not cancelled; the day is today or later, at most OPEN_DATE_MAX_DAYS ahead. */
    async scheduleForSender(animationId: string, body: unknown): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      const raw = (body as { open_date?: unknown } | null)?.open_date
      const now = d.now?.() ?? new Date()
      let opens: string | null = null
      if (raw !== null && raw !== undefined && raw !== '') {
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return json(400, { error: 'open_date must be YYYY-MM-DD' }, noStore)
        const today = todayJst(now)
        const last = todayJst(new Date(now.getTime() + OPEN_DATE_MAX_DAYS * 86_400_000))
        if (raw < today || raw > last || Number.isNaN(Date.parse(raw))) return json(400, { error: 'open_date is out of range' }, noStore)
        opens = raw
      }
      try {
        await d.store!.put(f.gift.token, { ...f.gift, opens_on: opens })
      } catch {
        return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      }
      return json(200, { ok: true, opens_on: opens }, noStore)
    },
    async keepsakeCard(token: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return keepsakeCardResponse(r)
    },
    async keepsakeCardForSender(animationId: string): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return keepsakeCardResponse(f)
    },
    async cardPdfForSender(animationId: string): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return cardResponse(f, d)
    },

    /** The story scroll (PNG or PDF) of the receiver's gift. Only when all four pictures are real: never with a washi slot. */
    async scroll(token: string, ext: string, preview?: string | null): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, preview)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return scrollResponse(r.gift, r.anim, ext, d)
    },

    /** The same scroll from the SENDER's page (by the sender's own id). */
    async scrollForSender(animationId: string, ext: string): Promise<Response> {
      const d = deps()
      if (!ANIMATION_ID_PATTERN.test(animationId) || !d.store) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
      try {
        const a = await d.store.get(animationId)
        if (!isAnimationRecord(a) || !a.gift_token) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
        const r = await loadGift(a.gift_token, d)
        if (r.status !== 200) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' })
        { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
        return scrollResponse(r.gift, r.anim, ext, d)
      } catch {
        return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      }
    },

    // ---- sharing the film and the poem card to social media (2026-11-06): after collecting (the buyer) / after the envelope is open (the receiver); never for remembrance ----
    async shareFilmMake(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, null)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return shareFilmMake(r, d)
    },
    async shareFilmGet(token: string, req: Request): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, null)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return shareFilmGet(r, d, req)
    },
    async shareCard(token: string): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      if (closed(r.gift, d, null)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      return shareCardGet(r, d)
    },
    async shareFilmMakeForSender(animationId: string): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return shareFilmMake(f, d)
    },
    async shareFilmGetForSender(animationId: string, req: Request): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return shareFilmGet(f, d, req)
    },
    async shareCardForSender(animationId: string): Promise<Response> {
      const d = deps()
      const f = await bySender(animationId, d)
      if (f instanceof Response) return f
      { const gate = await gateOf(f.gift, d); if (gate === 'cancelled') return gone(f.gift); if (gate === 'pending') return notCollected() }
      return shareCardGet(f, d)
    },

    /** The receiver's one thank-you (200 characters at most, once). It is shown on the sender's page; there is no e-mail and no second reply. */
    async reply(token: string, body: unknown): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      { const gate = await gateOf(r.gift, d); if (gate === 'cancelled') return gone(r.gift); if (gate === 'pending') return notCollected() }
      if (closed(r.gift, d, null)) return json(403, { error: 'locked' }, { 'cache-control': 'no-store' })
      if (r.gift.reply) return json(409, { error: 'The reply has already been sent', code: 'already_replied' }, noStore)
      const checked = checkReply(body)
      if (!checked.ok) return json(400, { error: checked.error }, noStore)
      const now = d.now?.() ?? new Date()
      try {
        await d.store!.put(token, { ...r.gift, reply: { text: checked.text, at: now.toISOString() } })
      } catch {
        return json(503, { error: 'unavailable' }, { 'cache-control': 'no-store' })
      }
      console.log(`[ichirei-gift] reply_sent ${JSON.stringify({ token_prefix: token.slice(0, 5) })}`) // no text
      return json(200, { ok: true }, noStore)
    },

    /** The e-gift receiver types their address — once. The address is stored on the gift record and returned by NO call. */
    async address(token: string, body: unknown): Promise<Response> {
      const d = deps()
      const r = await loadGift(token, d)
      if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'unavailable' }, { 'cache-control': 'no-store' })
      const g = r.gift
      { const gate = await gateOf(g, d); if (gate === 'cancelled') return gone(g); if (gate === 'pending') return notCollected() }
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
