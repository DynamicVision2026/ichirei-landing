// GET /api/sizes — which sizes of the gift can be ordered right now.
//   200 { "sizes": ["egift", "simple", "standard"], "coming_soon": ["simple", "standard"] }   in the page's display order (left to right), only those whose Shopify variant is configured.
//   `sale` { percent, from, until, starts_at, ends_at } is there from the settings (SALE_PERCENT, SALE_FROM, SALE_UNTIL) until the sale is over; the page shows it only inside [starts_at, ends_at].
//   `coming_soon` is there only when ICHIREI_WOOD_SIZES=coming_soon (the e-gift-first launch): 木札 and 版木 are then LISTED (so the page can show them as 「近日公開」) and the page disables their buttons.
// Public, no input, nothing secret (variant ids are never sent). A size whose variant id is missing (SHOPIFY_VARIANT_EGIFT until
// the owner creates the e-gift in Shopify) is simply absent: the page hides it and /api/order refuses it. Without a Shopify config: { sizes: [] }.

import { availableSizes, loadShopifyConfig } from '../engine/shopify.ts'
import { PACKAGE_DISPLAY_ORDER, comingSoonSizes } from '../src/order/packages.ts'
import { parseSale } from '../src/order/sale.ts'

export function sizesResponse(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Response {
  const soon = comingSoonSizes(env.ICHIREI_WOOD_SIZES)
  // the Thanksgiving sale shown on the page (SALE_PERCENT + SALE_UNTIL, Japan time): present until the last day is over (the page shows it only from its first moment, SALE_FROM 00:00 JST, to its last, SALE_UNTIL 23:59 JST), so it disappears by itself afterwards
  const sale = parseSale(env.SALE_PERCENT, env.SALE_UNTIL, now, env.SALE_FROM)
  const open = new Set([...availableSizes(loadShopifyConfig(env).config), ...soon])
  return new Response(JSON.stringify({ sizes: PACKAGE_DISPLAY_ORDER.filter((p) => open.has(p)), ...(soon.length > 0 ? { coming_soon: soon } : {}), ...(sale ? { sale } : {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  })
}

export const GET = () => sizesResponse()
