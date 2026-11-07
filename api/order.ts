// POST /api/order — the purchase hand-off.
//
//   1. validate what the browser sent (names, date, inscription choice, package), and derive
//      the character, reading and glyph from the ENGINE RESULT, not from client fields;
//   2. store the story and the engine result under a fresh order_ref (server-side, not in
//      Shopify) — if that fails there is no checkout, we never sell what production cannot see;
//   3. create a Shopify cart through the Storefront API, one line per package, with the line
//      attributes kanji, inscription_form, reading, sender_name, receiver_name, delivery_date,
//      language, order_ref (and ichirei_animation_url, the private address of the story animation);
//   4. answer { order_ref, checkout_url } and the browser redirects to Shopify checkout.
//
// Web-standard handler (like api/select.ts): mounted directly by server/app.ts and usable on Vercel.

import { animationUrl, buildAnimationRecord, newAnimationId, type AnimationRecord } from '../engine/animation.ts'
import { adoptDraft } from '../engine/preview.ts'
import { mergeStory } from '../engine/contract.ts'
import { ANIMATION_ID_PATTERN } from '../engine/animation.ts'
import { buildGiftRecord, giftUrl, newGiftToken } from '../engine/gift.ts'
import { allocateCertificateNo } from '../engine/certificate-no.ts'
import { recordOrderIndex } from '../engine/egift-ops.ts'
import { filmInputFromRecord, filmWaitMs, raceTimeout, trackFilm } from '../engine/film-store.ts'
import { makeFilm, type FilmInput, type FilmRecord } from '../engine/film.ts'
import { cleanSession, cleanSource, recordEvent } from '../engine/analytics.ts'
import { POEM_ID_PATTERN, buildRecord, lineAttributes, newOrderRef, parseOrderRequest, type OrderRecord, type StoredPoem, type ValidOrder } from '../engine/order.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import type { Palette } from '../engine/palette.ts'
import { ShopifyError, createCart, loadShopifyConfig, type ShopifyConfig } from '../engine/shopify.ts'
import { MAX_POEMS, POEM_TYPES, comingSoonSizes, poemTypeAllowed } from '../src/order/packages.ts'

const MAX_BODY_BYTES = 300_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export interface OrderDeps {
  store: OrderStore | null
  shopify: ShopifyConfig | null
  /** Env var names still missing for Shopify (reported in the 503 so the fix is obvious). */
  shopifyMissing: string[]
  now?: () => Date
  fetchImpl?: typeof fetch
  /** Tests inject a palette; production reads engine/palette.csv. */
  palette?: Palette
  /** The site's public address for the animation link (ICHIREI_PUBLIC_URL); tests inject their own. */
  env?: NodeJS.ProcessEnv
  /** Tests: stands in for the film-script call (production: engine/film.ts). */
  film?: (input: FilmInput) => Promise<FilmRecord>
  /** Tests: how long the answer may wait for the film (production: ICHIREI_FILM_WAIT_MS, 8 s). */
  filmWaitMs?: number
}

/**
 * The poem of an order (one is included, free): the browser sends only a poem_id; the poem is read back from the store (what /api/poem wrote)
 * and must belong to the chosen character and language. At most MAX_POEMS. It goes on the main line item as attributes and into the certificate.
 */
async function resolvePoems(raw: unknown, store: OrderStore, order: ValidOrder): Promise<{ ok: true; poems: StoredPoem[] } | { ok: false; error: string; code: string }> {
  if (raw === undefined || raw === null) return { ok: true, poems: [] }
  if (!Array.isArray(raw)) return { ok: false, code: 'bad_poems', error: '"poems" must be an array' }
  if (raw.length > MAX_POEMS) return { ok: false, code: 'too_many_poems', error: `At most ${MAX_POEMS} poem can be included` }
  const poems: StoredPoem[] = []
  for (const item of raw) {
    const id = (item as { poem_id?: unknown } | null)?.poem_id
    if (typeof id !== 'string' || !POEM_ID_PATTERN.test(id)) return { ok: false, code: 'bad_poems', error: 'Each poem needs a valid "poem_id"' }
    let rec: StoredPoem | null = null
    try {
      rec = (await store.get(id)) as StoredPoem | null
    } catch {
      return { ok: false, code: 'store_failed', error: 'Could not read the poem. Please try again.' }
    }
    if (!rec || rec.schema !== 'poem' || !Array.isArray(rec.lines) || !(POEM_TYPES as readonly string[]).includes(rec.type)) return { ok: false, code: 'poem_not_found', error: 'A poem in the order was not found; please make it again.' }
    if (!poemTypeAllowed(order.language, rec.type, mergeStory(order.story, order.follow_ups))) return { ok: false, code: 'poem_type_not_offered', error: 'That poem format is not offered for this story\'s language.' }
    if (rec.language !== order.language || !rec.forms.some((f) => f === order.candidate.kanji || f === order.candidate.inscription_form)) return { ok: false, code: 'poem_mismatch', error: 'A poem does not belong to the chosen character.' }
    poems.push(rec)
  }
  return { ok: true, poems }
}

export function createOrderHandler(deps: () => OrderDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request body too large' })
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return json(400, { error: 'Body is not valid JSON' })
    }

    const d = deps()
    const now = d.now?.() ?? new Date()
    const parsed = parseOrderRequest(body, now, d.palette)
    if (!parsed.ok) return json(400, { error: parsed.error, field: parsed.field })

    if (!d.store) {
      return json(503, { error: 'Order storage is not configured on the server (set ORDER_BUCKET — see DEPLOY.md).', code: 'store_not_configured' })
    }
    if (!d.shopify) {
      return json(503, { error: `Shopify is not configured on the server (missing: ${d.shopifyMissing.join(', ')}).`, code: 'shopify_not_configured', missing: d.shopifyMissing })
    }

    const order = parsed.order
    // E-gift-first launch: with ICHIREI_WOOD_SIZES=coming_soon the wooden sizes are shown as 「近日公開」 and cannot be ordered (whatever the page sent).
    if (comingSoonSizes((d.env ?? process.env).ICHIREI_WOOD_SIZES).includes(order.package)) return json(400, { error: `The size "${order.package}" is coming soon.`, code: 'size_coming_soon', field: 'package' })
    // A size whose Shopify variant is not configured (① and ② until the owner creates them) cannot be ordered.
    if (!d.shopify.variants[order.package]) return json(400, { error: `The size "${order.package}" is not on sale yet.`, code: 'size_unavailable', field: 'package' })
    const resolved = await resolvePoems((body as { poems?: unknown } | null)?.poems, d.store, order)
    if (!resolved.ok) return json(400, { error: resolved.error, code: resolved.code, field: 'poems' })
    const poems = resolved.poems
    order.certificate.poems = poems.map((p) => ({ type: p.type, lines: p.lines, reading: p.reading }))
    const orderRef = newOrderRef(now)
    const record: OrderRecord = buildRecord(order, orderRef, now, poems)

    // Writes of the order record go one after the other, so a film that finishes late can never be overwritten by an older write.
    let chain: Promise<unknown> = Promise.resolve()
    const putOrder = () => {
      const p = chain.catch(() => {}).then(() => d.store!.put(orderRef, record))
      chain = p
      return p
    }

    // The story film of this order: a small record under a private id (the page reads it), and ONE small model call that writes the film's script
    // from the story — started now, in parallel with the cart (nothing waits for it for long, and it can never block or fail the order: engine/film.ts
    // falls back to a generic script). Without a record there is simply no link.
    let animationLink: string | null = null
    let giftLink: string | null = null
    let filmP: Promise<FilmRecord> | null = null
    try {
      // The card preview the buyer saw (a draft made when they picked the character): if it is for this very story, it BECOMES this order's film — the same
      // script and the same pictures, nothing written or drawn twice. Otherwise the film is made now, as before.
      const draftId = typeof (body as { draft_id?: unknown } | null)?.draft_id === 'string' && ANIMATION_ID_PATTERN.test((body as { draft_id: string }).draft_id) ? (body as { draft_id: string }).draft_id : null
      const built = buildAnimationRecord(record, newAnimationId(), now)
      const adopted: AnimationRecord | null = draftId
        ? await adoptDraft(d.store, draftId, record, built, { story: mergeStory(order.story, order.follow_ups), language: order.language, memorial: order.certificate.memorial === true }).catch(() => null)
        : null
      const anim = adopted ?? built
      const animationId = anim.id
      // the receiver's own link (Part D): a second small record, so the receiver's page never carries the sender's id
      const token = newGiftToken()
      // 「一字礼　第 NNNN 号」: the running number, given once (a store failure here must not stop the order: the gift then simply shows no number)
      try {
        record.certificate_no = await allocateCertificateNo(d.store, orderRef, now)
      } catch (err) {
        console.error('[ichirei-order] certificate number failed', orderRef, err instanceof Error ? err.message : err)
      }
      anim.gift_token = token
      await d.store.put(animationId, anim)
      await d.store.put(token, buildGiftRecord(record, animationId, token, order.sender_email, now))
      record.animation_id = animationId
      record.gift_token = token
      giftLink = giftUrl(token, d.env)
      animationLink = animationUrl(animationId, d.env)
      if (adopted) {
        record.production.film = adopted.film ?? undefined
        console.log(`[ichirei-preview] ${JSON.stringify({ event: 'draft_adopted', order_ref: orderRef })}`)
      } else if (draftId) console.log(`[ichirei-preview] ${JSON.stringify({ event: 'draft_not_adopted', order_ref: orderRef })}`)
      if (!adopted) filmP = trackFilm(
        animationId,
        (d.film ?? makeFilm)(filmInputFromRecord(record)).then(async (film) => {
          try {
            anim.film = film
            record.production.film = film
            await Promise.all([d.store!.put(animationId, anim), putOrder()])
          } catch (err) {
            console.error('[ichirei-order] film save failed', orderRef, err instanceof Error ? err.message : err)
          }
          return film
        }),
      )
    } catch (err) {
      console.error('[ichirei-order] animation record failed', orderRef, err instanceof Error ? err.message : err)
    }

    // 2. Keep the story and the result before anything is sold.
    try {
      await putOrder()
    } catch (err) {
      console.error('[ichirei-order] store failed', orderRef, err instanceof Error ? err.message : err)
      return json(503, { error: 'Could not save the order. Nothing was charged; please try again.', code: 'store_failed' })
    }
    // The owner's list (/ops) and the e-gift reminders read this small index: codes only, no story, no names, no address.
    await recordOrderIndex(d.store, record, now, cleanSession((body as { session?: unknown } | null)?.session))

    // 3. The Shopify cart.
    try {
      const cart = await createCart(d.shopify, order.package, lineAttributes(order, orderRef, animationLink, giftLink), orderRef, d.fetchImpl)
      record.status = 'cart_created'
      record.updated_at = (d.now?.() ?? new Date()).toISOString()
      record.shopify = { cart_id: cart.cartId, checkout_url: cart.checkoutUrl, variant_id: cart.variantId }
      // the film is written while the cart is made; give it a few seconds more at most, then let the buyer go on (it keeps being written)
      if (filmP) await raceTimeout(filmP, d.filmWaitMs ?? filmWaitMs(d.env))
      try {
        await putOrder()
      } catch (err) {
        // The first write already holds the story and result; the status update is a convenience.
        console.error('[ichirei-order] status update failed', orderRef, err instanceof Error ? err.message : err)
      }
      console.log('[ichirei-order]', JSON.stringify({ order_ref: orderRef, status: record.status, package: order.package, language: order.language, poems: poems.map((p) => p.type) }))
      // Learning loop: "ordered" — the session id only, never the order_ref or anything the buyer typed.
      const sessionId = cleanSession((body as { session?: unknown } | null)?.session)
      if (sessionId) {
        const ts = (d.now?.() ?? new Date()).toISOString()
        const source = cleanSource((body as { source?: unknown } | null)?.source)
        void recordEvent({ ts, session: sessionId, source, event: 'ordered', ...(poems.length ? { poem_types: poems.map((p) => p.type) } : {}) }, d.store, d.now?.() ?? new Date())
        for (const p of poems) void recordEvent({ ts, session: sessionId, source, event: 'poem_added', poem_type: p.type }, d.store, d.now?.() ?? new Date())
      }
      return json(200, {
        order_ref: orderRef,
        checkout_url: cart.checkoutUrl,
        glyph: order.glyph,
        certificate_text: record.production.certificate_text,
        certificate: record.production.certificate,
        animation_url: animationLink,
        gift_url: giftLink,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ichirei-order] cart failed', orderRef, message)
      record.status = 'cart_failed'
      record.error = message
      record.updated_at = (d.now?.() ?? new Date()).toISOString()
      await putOrder().catch(() => {})
      return json(502, {
        error: err instanceof ShopifyError ? 'Could not open the checkout. Nothing was charged; please try again.' : 'Could not open the checkout. Please try again.',
        code: 'cart_failed',
        order_ref: orderRef,
      })
    }
  }
}

/** Wired to the environment at call time (so config changes and tests need no restart). */
export const POST = createOrderHandler(() => {
  const { config, missing } = loadShopifyConfig()
  return { store: createOrderStore(), shopify: config, shopifyMissing: missing }
})

/** Anything but POST. */
export const GET = () => json(405, { error: 'Method not allowed' })
