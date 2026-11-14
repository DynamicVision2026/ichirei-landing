// Shopify Storefront API: create a cart with one line (the chosen package) carrying the order's
// line-item attributes, and hand back the checkout URL the browser is sent to.
//
// Config (all from the environment; the token comes from Secret Manager, never the repo):
//   SHOPIFY_STOREFRONT_TOKEN_PUBLIC  Storefront API PUBLIC token (public by design; Cloud Build substitution) — wins if set
//   SHOPIFY_STOREFRONT_TOKEN   same token from the Secret Manager mount (the original route; used when the above is empty)
//                              (needs unauthenticated_write_checkouts)
//   SHOPIFY_VARIANT_EGIFT      variant of the ¥3,980 一字礼 eギフト (a digital product with no shipping; 67913881616632 since 2026-11-13)
//   SHOPIFY_VARIANT_SIMPLE     OPTIONAL: the wood variants were DELETED in Shopify on 2026-11-13. Wood is "coming soon", so these are never put in a cart; a missing
//   SHOPIFY_VARIANT_STANDARD   (or deleted) variant behaves exactly like "coming soon" — it is never an error and never blocks startup.
//   (the poem is free and included: it travels as attributes on the main line — there are no poem products or variants)
//   SHOPIFY_STORE_DOMAIN       default soul-id-2.myshopify.com
//   SHOPIFY_API_VERSION        default 2025-01
//   SHOPIFY_API_BASE           tests only: replaces https://<domain>
// What the customer is charged is decided by the variant's price in Shopify, never by the browser.

import { PACKAGES, type PackageId } from '../src/order/packages.ts'
import type { Attribute } from './order.ts'

export const DEFAULT_STORE_DOMAIN = 'soul-id-2.myshopify.com'
export const DEFAULT_API_VERSION = '2025-01'

export interface ShopifyConfig {
  storeDomain: string
  apiVersion: string
  token: string
  apiBase: string
  /** The variant of each size that is on sale: only those whose id is configured (since 2026-11-13 that is the e-gift alone). */
  variants: Partial<Record<PackageId, string>>
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
  const token = env.SHOPIFY_STOREFRONT_TOKEN_PUBLIC?.trim() || env.SHOPIFY_STOREFRONT_TOKEN?.trim() || ''
  // Only the token is required: the wood variants are gone and the e-gift variant is optional (a size without a variant is simply not on sale).
  const missing = token ? [] : ['SHOPIFY_STOREFRONT_TOKEN']
  if (missing.length > 0) return { config: null, missing }
  const storeDomain = (env.SHOPIFY_STORE_DOMAIN || DEFAULT_STORE_DOMAIN).trim()
  return {
    missing: [],
    config: {
      storeDomain,
      apiVersion: (env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
      token,
      apiBase: (env.SHOPIFY_API_BASE || `https://${storeDomain}`).replace(/\/$/, ''),
      variants: {
        ...(env.SHOPIFY_VARIANT_SIMPLE?.trim() ? { simple: toGid(env.SHOPIFY_VARIANT_SIMPLE.trim()) } : {}),
        ...(env.SHOPIFY_VARIANT_STANDARD?.trim() ? { standard: toGid(env.SHOPIFY_VARIANT_STANDARD.trim()) } : {}),
        // While the e-gift id is missing, that size is hidden on the page and refused by the server.
        ...(env.SHOPIFY_VARIANT_EGIFT?.trim() ? { egift: toGid(env.SHOPIFY_VARIANT_EGIFT.trim()) } : {}),
      },
    },
  }
}

const CART_CREATE = `mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart { id checkoutUrl cost { totalAmount { amount currencyCode } } }
    userErrors { field message }
  }
}`

export interface CartResult {
  cartId: string
  checkoutUrl: string
  variantId: string
  /** The currency Shopify priced the cart in (cost.totalAmount.currencyCode); null when it did not say. */
  currency: string | null
}

/** English orders (2026-11-14): the cart names the United States as the buyer's country, so the "ICHIREI English" market (English, USD, a fixed price) prices the checkout. ja / zh carts name nobody. */
export const EN_BUYER_COUNTRY = 'US'

export async function createCart(
  config: ShopifyConfig,
  pkg: PackageId,
  attributes: Attribute[],
  orderRef: string,
  fetchImpl: typeof fetch = fetch,
  language?: string,
): Promise<CartResult> {
  const variantId = config.variants[pkg]
  if (!variantId) throw new ShopifyError(`The size "${pkg}" has no Shopify variant configured`, { code: 'size_unavailable' })
  const res = await fetchImpl(`${config.apiBase}/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-storefront-access-token': config.token },
    body: JSON.stringify({
      query: CART_CREATE,
      variables: {
        input: {
          // The line carries the attributes (the chosen poem included); the cart repeats order_ref so it also lands on the order itself.
          lines: [{ merchandiseId: variantId, quantity: 1, attributes }],
          attributes: [{ key: 'order_ref', value: orderRef }],
          ...(language === 'en' ? { buyerIdentity: { countryCode: EN_BUYER_COUNTRY } } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new ShopifyError(`Shopify answered HTTP ${res.status}`, { status: res.status })
  let json: {
    data?: { cartCreate?: { cart?: { id?: string; checkoutUrl?: string; cost?: { totalAmount?: { amount?: string; currencyCode?: string } | null } | null } | null; userErrors?: { field?: string[]; message: string }[] } | null }
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
  const currency = cart.cost?.totalAmount?.currencyCode ?? null
  // An English cart should be priced in dollars. If Shopify says otherwise (the market is not set up for that buyer country), the buyer still gets the checkout; the owner sees the line.
  if (language === 'en' && currency && currency.toUpperCase() !== 'USD') {
    console.warn(`[ichirei-order] ${JSON.stringify({ event: 'en_cart_currency_mismatch', order_ref: orderRef, currency, amount: cart.cost?.totalAmount?.amount ?? null })}`)
  }
  return { cartId: cart.id, checkoutUrl: cart.checkoutUrl, variantId, currency }
}

/** The sizes that can be ordered right now: those with a variant. Without a config (not ready) none. */
export const availableSizes = (config: ShopifyConfig | null): PackageId[] => (config ? (PACKAGES.filter((p) => Boolean(config.variants[p])) as PackageId[]) : [])
