// Shopify Storefront API: create a cart with one line (the chosen package) carrying the order's
// line-item attributes, and hand back the checkout URL the browser is sent to.
//
// Config (all from the environment; the token comes from Secret Manager, never the repo):
//   SHOPIFY_STOREFRONT_TOKEN   Storefront API access token (needs unauthenticated_write_checkouts)
//   SHOPIFY_VARIANT_SIMPLE     variant of the ¥9,800 package   (gid://shopify/ProductVariant/… or the number)
//   SHOPIFY_VARIANT_STANDARD   variant of the ¥15,800 package
//   SHOPIFY_STORE_DOMAIN       default soul-id-2.myshopify.com
//   SHOPIFY_API_VERSION        default 2025-01
//   SHOPIFY_API_BASE           tests only: replaces https://<domain>
// What the customer is charged is decided by the variant's price in Shopify, never by the browser.

import type { PackageId } from '../src/order/packages.ts'
import type { Attribute } from './order.ts'

export const DEFAULT_STORE_DOMAIN = 'soul-id-2.myshopify.com'
export const DEFAULT_API_VERSION = '2025-01'

export interface ShopifyConfig {
  storeDomain: string
  apiVersion: string
  token: string
  apiBase: string
  variants: Record<PackageId, string>
}

export class ShopifyError extends Error {
  readonly detail?: unknown
  constructor(message: string, detail?: unknown) {
    super(message)
    this.detail = detail
  }
}

const toGid = (v: string) => (/^\d+$/.test(v) ? `gid://shopify/ProductVariant/${v}` : v)

/** Read the config; `missing` lists the env vars still to set (empty when ready). */
export function loadShopifyConfig(env: NodeJS.ProcessEnv = process.env): { config: ShopifyConfig | null; missing: string[] } {
  const missing = ['SHOPIFY_STOREFRONT_TOKEN', 'SHOPIFY_VARIANT_SIMPLE', 'SHOPIFY_VARIANT_STANDARD'].filter((k) => !env[k]?.trim())
  if (missing.length > 0) return { config: null, missing }
  const storeDomain = (env.SHOPIFY_STORE_DOMAIN || DEFAULT_STORE_DOMAIN).trim()
  return {
    missing: [],
    config: {
      storeDomain,
      apiVersion: (env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
      token: env.SHOPIFY_STOREFRONT_TOKEN!.trim(),
      apiBase: (env.SHOPIFY_API_BASE || `https://${storeDomain}`).replace(/\/$/, ''),
      variants: { simple: toGid(env.SHOPIFY_VARIANT_SIMPLE!.trim()), standard: toGid(env.SHOPIFY_VARIANT_STANDARD!.trim()) },
    },
  }
}

const CART_CREATE = `mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { id checkoutUrl }
    userErrors { field message }
  }
}`

export interface CartResult {
  cartId: string
  checkoutUrl: string
  variantId: string
}

export async function createCart(
  config: ShopifyConfig,
  pkg: PackageId,
  attributes: Attribute[],
  orderRef: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CartResult> {
  const variantId = config.variants[pkg]
  const res = await fetchImpl(`${config.apiBase}/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-storefront-access-token': config.token },
    body: JSON.stringify({
      query: CART_CREATE,
      variables: {
        input: {
          // The line carries the eight attributes; the cart repeats order_ref so it also lands on the order itself.
          lines: [{ merchandiseId: variantId, quantity: 1, attributes }],
          attributes: [{ key: 'order_ref', value: orderRef }],
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new ShopifyError(`Shopify answered HTTP ${res.status}`, { status: res.status })
  let json: {
    data?: { cartCreate?: { cart?: { id?: string; checkoutUrl?: string } | null; userErrors?: { field?: string[]; message: string }[] } | null }
    errors?: { message: string }[]
  }
  try {
    json = await res.json()
  } catch {
    throw new ShopifyError('Shopify answered with something that is not JSON')
  }
  if (json.errors?.length) throw new ShopifyError(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`, json.errors)
  const out = json.data?.cartCreate
  if (out?.userErrors?.length) throw new ShopifyError(`Shopify rejected the cart: ${out.userErrors.map((e) => e.message).join('; ')}`, out.userErrors)
  const cart = out?.cart
  if (!cart?.id || !cart.checkoutUrl) throw new ShopifyError('Shopify returned no cart')
  let url: URL
  try {
    url = new URL(cart.checkoutUrl)
  } catch {
    throw new ShopifyError('Shopify returned an invalid checkout URL')
  }
  // Production Shopify checkouts are https. (Tests point SHOPIFY_API_BASE at http://127.0.0.1.)
  if (url.protocol !== 'https:' && !config.apiBase.startsWith('http://')) throw new ShopifyError('Shopify returned a non-https checkout URL')
  return { cartId: cart.id, checkoutUrl: cart.checkoutUrl, variantId }
}
