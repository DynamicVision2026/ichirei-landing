// GET /api/sizes — which sizes of the gift can be ordered right now.
//   200 { "sizes": ["egift", "simple", "standard"], "coming_soon": ["simple", "standard"] }   in the page's display order (left to right), only those whose Shopify variant is configured.
//   `sale` { percent, from, until, starts_at, ends_at } is there from the settings (SALE_PERCENT, SALE_FROM, SALE_UNTIL) until the sale is over; the page shows it only inside [starts_at, ends_at].
//   `sale.en_ends_at` (SALE_UNTIL_EN, an exact moment) is where the English pages' sale ends when it differs from `ends_at`.
//   `max_rounds` (ICHIREI_MAX_ROUNDS, 2 by default): how many sets of characters one story gets; the page shows 「別の二字を探す」 only while rounds are left, and /api/select refuses more.
//   `usd` { egift, egift_sale } is the English page's fixed dollar price, cents allowed (USD_PRICE_EGIFT, USD_PRICE_EGIFT_SALE; 25 and 17.5 by default).
//   `coming_soon` is there only when ICHIREI_WOOD_SIZES=coming_soon (the e-gift-first launch): 木札 and 版木 are then LISTED (so the page can show them as 「近日公開」) and the page disables their buttons.
// Public, no input, nothing secret (variant ids are never sent). A size whose variant id is missing (SHOPIFY_VARIANT_EGIFT until
// the owner creates the e-gift in Shopify) is simply absent: the page hides it and /api/order refuses it. Without a Shopify config: { sizes: [] }.

import { availableSizes, loadShopifyConfig } from '../engine/shopify.ts'
import { maxRoundsOf } from '../engine/limits.ts'
import { PACKAGE_DISPLAY_ORDER, comingSoonSizes } from '../src/order/packages.ts'
import { parseSale } from '../src/order/sale.ts'
import { parseUsdPrice } from '../src/order/usd.ts'

export function sizesResponse(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Response {
  const soon = comingSoonSizes(env.ICHIREI_WOOD_SIZES)
  // the Thanksgiving sale shown on the page (SALE_PERCENT + SALE_UNTIL, Japan time): present until the last day is over (the page shows it only from its first moment, SALE_FROM 00:00 JST, to its last, SALE_UNTIL 23:59 JST), so it disappears by itself afterwards
  const sale = parseSale(env.SALE_PERCENT, env.SALE_UNTIL, now, env.SALE_FROM, env.SALE_UNTIL_EN)
  const open = new Set([...availableSizes(loadShopifyConfig(env).config), ...soon])
  return new Response(JSON.stringify({ sizes: PACKAGE_DISPLAY_ORDER.filter((p) => open.has(p)), ...(soon.length > 0 ? { coming_soon: soon } : {}), ...(sale ? { sale } : {}), usd: parseUsdPrice(env.USD_PRICE_EGIFT, env.USD_PRICE_EGIFT_SALE, sale?.percent ?? null), max_rounds: maxRoundsOf(env) }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  })
}

export const GET = () => sizesResponse()
