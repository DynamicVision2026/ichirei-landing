// Shopify Storefront API: create a cart with one line (the chosen package) carrying the order's
// line-item attributes, and hand back the checkout URL the browser is sent to.
//
// Config (all from the environment; the token comes from Secret Manager, never the repo):
//   SHOPIFY_STOREFRONT_TOKEN_PUBLIC  Storefront API PUBLIC token (public by design; Cloud Build substitution) — wins if set
//   SHOPIFY_STOREFRONT_TOKEN   same token from the Secret Manager mount (the original route; used when the above is empty)
//                              (needs unauthenticated_write_checkouts)
//   SHOPIFY_VARIANT_SIMPLE     variant of the ¥9,800 package   (gid://shopify/ProductVariant/… or the number)
//   SHOPIFY_VARIANT_STANDARD   variant of the ¥18,850 package
//   SHOPIFY_VARIANT_POEM_TANKA / _TANG / _CI / _EN   the ¥1,980 poem add-on variants (optional: a type whose variant is missing is hidden)
//   SHOPIFY_STORE_DOMAIN       default soul-id-2.myshopify.com
//   SHOPIFY_API_VERSION        default 2025-01
//   SHOPIFY_API_BASE           tests only: replaces https://<domain>
// What the customer is charged is decided by the variant's price in Shopify, never by the browser.

import { POEM_TYPES, type PackageId, type PoemType } from '../src/order/packages.ts'
import type { Attribute } from './order.ts'

export const DEFAULT_STORE_DOMAIN = 'soul-id-2.myshopify.com'
export const DEFAULT_API_VERSION = '2025-01'

export interface ShopifyConfig {
  storeDomain: string
  apiVersion: string
  token: string
  apiBase: string
  variants: Record<PackageId, string>
  /** The poem add-on variants that are configured (a type without one is not offered). */
  poemVariants?: Partial<Record<PoemType, string>>
}

export const POEM_VARIANT_ENV: Record<PoemType, string> = {
  tanka: 'SHOPIFY_VARIANT_POEM_TANKA',
  tang: 'SHOPIFY_VARIANT_POEM_TANG',
  ci: 'SHOPIFY_VARIANT_POEM_CI',
  en: 'SHOPIFY_VARIANT_POEM_EN',
}

export class ShopifyError extends Error {
  readonly detail?: unknown
  constructor(message: string, detail?: unknown) {
    super(message)
    this.detail = detail
  }
}

const toGid = (v: string) => (/^\d+$/.test(v) ? `gid://shopify/ProductVariant/${v}` : v)

/** The poem variants configured in the environment (gid form). Independent of the main package variants. */
export function poemVariantsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<PoemType, string>> {
  const out: Partial<Record<PoemType, string>> = {}
  for (const t of POEM_TYPES) {
    const v = env[POEM_VARIANT_ENV[t]]?.trim()
    if (v) out[t] = toGid(v)
  }
  return out
}

/** The poem types the buyer may be offered: those with a configured variant. */
export const availablePoemTypes = (env: NodeJS.ProcessEnv = process.env): PoemType[] => POEM_TYPES.filter((t) => poemVariantsFromEnv(env)[t] !== undefined)

/** Read the config; `missing` lists the env vars still to set (empty when ready). */
export function loadShopifyConfig(env: NodeJS.ProcessEnv = process.env): { config: ShopifyConfig | null; missing: string[] } {
  const token = env.SHOPIFY_STOREFRONT_TOKEN_PUBLIC?.trim() || env.SHOPIFY_STOREFRONT_TOKEN?.trim() || ''
  const missing = [
    ...(token ? [] : ['SHOPIFY_STOREFRONT_TOKEN']),
    ...['SHOPIFY_VARIANT_SIMPLE', 'SHOPIFY_VARIANT_STANDARD'].filter((k) => !env[k]?.trim()),
  ]
  if (missing.length > 0) return { config: null, missing }
  const storeDomain = (env.SHOPIFY_STORE_DOMAIN || DEFAULT_STORE_DOMAIN).trim()
  return {
    missing: [],
    config: {
      storeDomain,
      apiVersion: (env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim(),
      token,
      apiBase: (env.SHOPIFY_API_BASE || `https://${storeDomain}`).replace(/\/$/, ''),
      variants: { simple: toGid(env.SHOPIFY_VARIANT_SIMPLE!.trim()), standard: toGid(env.SHOPIFY_VARIANT_STANDARD!.trim()) },
      poemVariants: poemVariantsFromEnv(env),
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
  /** Poem add-ons: each becomes its own line item (its own variant), carrying the poem's attributes. */
  poems: { type: PoemType; attributes: Attribute[] }[] = [],
): Promise<CartResult> {
  const variantId = config.variants[pkg]
  const poemLines = poems.map((p) => {
    const merchandiseId = config.poemVariants?.[p.type]
    if (!merchandiseId) throw new ShopifyError(`No Shopify variant is configured for the ${p.type} poem (${POEM_VARIANT_ENV[p.type]})`)
    return { merchandiseId, quantity: 1, attributes: p.attributes }
  })
  const res = await fetchImpl(`${config.apiBase}/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-storefront-access-token': config.token },
    body: JSON.stringify({
      query: CART_CREATE,
      variables: {
        input: {
          // The line carries the eight attributes; the cart repeats order_ref so it also lands on the order itself.
          lines: [{ merchandiseId: variantId, quantity: 1, attributes }, ...poemLines],
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
