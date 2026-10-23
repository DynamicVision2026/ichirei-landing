// POST /api/order — the purchase hand-off.
//
//   1. validate what the browser sent (names, date, inscription choice, package), and derive
//      the character, reading and glyph from the ENGINE RESULT, not from client fields;
//   2. store the story and the engine result under a fresh order_ref (server-side, not in
//      Shopify) — if that fails there is no checkout, we never sell what production cannot see;
//   3. create a Shopify cart through the Storefront API, one line per package, with the line
//      attributes kanji, inscription_form, reading, sender_name, receiver_name, delivery_date,
//      language, order_ref;
//   4. answer { order_ref, checkout_url } and the browser redirects to Shopify checkout.
//
// Web-standard handler (like api/select.ts): mounted directly by server/app.ts and usable on Vercel.

import { buildRecord, lineAttributes, newOrderRef, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { ShopifyError, createCart, loadShopifyConfig, type ShopifyConfig } from '../engine/shopify.ts'

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
    const parsed = parseOrderRequest(body, now)
    if (!parsed.ok) return json(400, { error: parsed.error, field: parsed.field })

    if (!d.store) {
      return json(503, { error: 'Order storage is not configured on the server (set ORDER_BUCKET — see DEPLOY.md).', code: 'store_not_configured' })
    }
    if (!d.shopify) {
      return json(503, { error: `Shopify is not configured on the server (missing: ${d.shopifyMissing.join(', ')}).`, code: 'shopify_not_configured', missing: d.shopifyMissing })
    }

    const order = parsed.order
    const orderRef = newOrderRef(now)
    const record: OrderRecord = buildRecord(order, orderRef, now)

    // 2. Keep the story and the result before anything is sold.
    try {
      await d.store.put(orderRef, record)
    } catch (err) {
      console.error('[ichirei-order] store failed', orderRef, err instanceof Error ? err.message : err)
      return json(503, { error: 'Could not save the order. Nothing was charged; please try again.', code: 'store_failed' })
    }

    // 3. The Shopify cart.
    try {
      const cart = await createCart(d.shopify, order.package, lineAttributes(order, orderRef), orderRef, d.fetchImpl)
      record.status = 'cart_created'
      record.updated_at = (d.now?.() ?? new Date()).toISOString()
      record.shopify = { cart_id: cart.cartId, checkout_url: cart.checkoutUrl, variant_id: cart.variantId }
      try {
        await d.store.put(orderRef, record)
      } catch (err) {
        // The first write already holds the story and result; the status update is a convenience.
        console.error('[ichirei-order] status update failed', orderRef, err instanceof Error ? err.message : err)
      }
      console.log('[ichirei-order]', JSON.stringify({ order_ref: orderRef, status: record.status, package: order.package, language: order.language }))
      return json(200, {
        order_ref: orderRef,
        checkout_url: cart.checkoutUrl,
        glyph: order.glyph,
        certificate_text: record.production.certificate_text,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ichirei-order] cart failed', orderRef, message)
      record.status = 'cart_failed'
      record.error = message
      record.updated_at = (d.now?.() ?? new Date()).toISOString()
      await d.store.put(orderRef, record).catch(() => {})
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
