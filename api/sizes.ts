// GET /api/sizes — which sizes of the gift can be ordered right now.
//   200 { "sizes": ["egift", "simple", "standard"] }   in the page's display order (left to right), only those whose Shopify variant is configured.
// Public, no input, nothing secret (variant ids are never sent). A size whose variant id is missing (SHOPIFY_VARIANT_EGIFT until
// the owner creates the e-gift in Shopify) is simply absent: the page hides it and /api/order refuses it. Without a Shopify config: { sizes: [] }.

import { availableSizes, loadShopifyConfig } from '../engine/shopify.ts'
import { PACKAGE_DISPLAY_ORDER } from '../src/order/packages.ts'

export function sizesResponse(env: NodeJS.ProcessEnv = process.env): Response {
  const open = new Set(availableSizes(loadShopifyConfig(env).config))
  return new Response(JSON.stringify({ sizes: PACKAGE_DISPLAY_ORDER.filter((p) => open.has(p)) }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  })
}

export const GET = () => sizesResponse()
