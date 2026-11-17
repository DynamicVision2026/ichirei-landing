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

/**
 * English carts (2026-11-15): the mutation runs in the context of the United States and English, so the checkout is written in English (without a language the checkout falls back to
 * the store's primary language, Japanese). The ja / zh mutation is exactly the one above — no @inContext.
 */
const CART_CREATE_EN = CART_CREATE.replace('mutation CartCreate($input: CartInput!) {', 'mutation CartCreate($input: CartInput!) @inContext(country: US, language: EN) {')

/** A held cart reads back its codes (`applicable`) as well as its total: the free gift is checked before the buyer is handed the checkout. Other carts keep the query above, byte for byte. */
const withCodes = (q: string): string => q.replace('cart { id checkoutUrl cost', 'cart { id checkoutUrl discountCodes { code applicable } cost')

/** A held free gift (English or Japanese, during the promotion — one shared pool): the cart carries the hold's OWN private code (GIFT-…, engine/promo-shopify.ts), the hold's email as a prefill
 * only, and the hold id. Without one the cart carries no code. */
export interface CartPromo {
  code: string
  email: string
  holdId: string
}

/** A held cart that Shopify did not price at 0 with the hold's code applicable, twice: the buyer is NOT sent to a full-price checkout (the order API answers "taking a short break"). */
export class PromoCartNotFree extends Error {
  constructor() {
    super('The free-gift cart was not free')
    this.name = 'PromoCartNotFree'
  }
}

/** English orders (2026-11-14): the cart names the United States as the buyer's country, so the "ICHIREI English" market (English, USD, a fixed price) prices the checkout. ja / zh carts name nobody. */
export const EN_BUYER_COUNTRY = 'US'

async function createCartOnce(
  config: ShopifyConfig,
  pkg: PackageId,
  attributes: Attribute[],
  orderRef: string,
  fetchImpl: typeof fetch = fetch,
  language?: string,
  promo?: CartPromo,
): Promise<CartResult> {
  const variantId = config.variants[pkg]
  if (!variantId) throw new ShopifyError(`The size "${pkg}" has no Shopify variant configured`, { code: 'size_unavailable' })
  const promoLang = language === 'en' || language === 'ja'
  const res = await fetchImpl(`${config.apiBase}/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-storefront-access-token': config.token },
    body: JSON.stringify({
      query: ((q) => (promoLang && promo ? withCodes(q) : q))(language === 'en' ? CART_CREATE_EN : CART_CREATE),
      variables: {
        input: {
          // The line carries the attributes (the chosen poem included); the cart repeats order_ref so it also lands on the order itself.
          lines: [{ merchandiseId: variantId, quantity: 1, attributes }],
          attributes: [{ key: 'order_ref', value: orderRef }, ...(promoLang && promo ? [{ key: 'ichirei_hold', value: promo.holdId }] : [])],
          // English: the US buyer (and the hold's email). Japanese (2026-11-16, one shared pool): only a holder's cart names the hold's email; a non-holder's ja cart is exactly as before.
          ...(language === 'en' ? { buyerIdentity: { countryCode: EN_BUYER_COUNTRY, ...(promo ? { email: promo.email } : {}) } } : language === 'ja' && promo ? { buyerIdentity: { email: promo.email } } : {}),
          ...(promoLang && promo ? { discountCodes: [promo.code] } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new ShopifyError(`Shopify answered HTTP ${res.status}`, { status: res.status })
  let json: {
    data?: { cartCreate?: { cart?: { id?: string; checkoutUrl?: string; discountCodes?: { code?: string; applicable?: boolean }[] | null; cost?: { totalAmount?: { amount?: string; currencyCode?: string } | null } | null } | null; userErrors?: { field?: string[]; message: string }[] } | null }
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
  // a held cart is free only when Shopify says the hold's code applies AND prices the cart at 0 (the buyer is never handed a full-price checkout by mistake)
  const held = promoLang && promo ? promo : null
  const total = Number(cart.cost?.totalAmount?.amount)
  const free = held ? Number.isFinite(total) && total === 0 && (cart.discountCodes ?? []).some((c) => (c.code ?? '').toUpperCase() === held.code.toUpperCase() && c.applicable === true) : undefined
  if (held && !free) console.warn(`[ichirei-promo] ${JSON.stringify({ event: 'promo_cart_not_free', hold: held.holdId, order_ref: orderRef, applicable: (cart.discountCodes ?? []).some((c) => c.applicable === true), total: Number.isFinite(total) ? cart.cost?.totalAmount?.amount : null, currency })}`)
  // the checkout link names its language (English: locale=en) and, for a held cart, the code too (discount=<code>: Shopify applies it on load), keeping every query parameter Shopify put on it; other links are returned as they came
  let checkoutUrl = cart.checkoutUrl
  if (language === 'en' || held) {
    if (language === 'en') url.searchParams.set('locale', 'en')
    if (held) url.searchParams.set('discount', held.code)
    checkoutUrl = url.toString()
  }
  return { cartId: cart.id, checkoutUrl, variantId, currency, ...(held ? { free } : {}) }
}

const notUsd = (c: string | null): boolean => !!c && c.toUpperCase() !== 'USD'

/**
 * Creates the cart. An English cart should be priced in dollars: if Shopify says otherwise, the cart is made ONCE more with the same buyer identity (the market is sometimes picked late);
 * if it still is not USD the buyer keeps the checkout (owner decision: never stop a sale) and the result says `mismatch` so the order API counts it in red on /ops/stats.
 * A held free-gift cart must come back FREE (the hold's code applicable, the total 0): if not, it is made once more after a moment (a new code can take a few seconds to be known to the
 * cart), and if it is still not free PromoCartNotFree is thrown — a holder is never sent to a full-price checkout.
 */
export async function createCart(config: ShopifyConfig, pkg: PackageId, attributes: Attribute[], orderRef: string, fetchImpl: typeof fetch = fetch, language?: string, promo?: CartPromo, retryDelayMs = 1500): Promise<CartResult> {
  const first = await createCartPriced(config, pkg, attributes, orderRef, fetchImpl, language, promo)
  const held = promo && (language === 'en' || language === 'ja')
  if (!held || first.free) return first
  await new Promise((r) => setTimeout(r, retryDelayMs))
  const second = await createCartPriced(config, pkg, attributes, orderRef, fetchImpl, language, promo)
  if (second.free) return second
  console.warn(`[ichirei-promo] ${JSON.stringify({ event: 'promo_cart_refused', hold: promo.holdId, order_ref: orderRef })}`)
  throw new PromoCartNotFree()
}

async function createCartPriced(config: ShopifyConfig, pkg: PackageId, attributes: Attribute[], orderRef: string, fetchImpl: typeof fetch, language?: string, promo?: CartPromo): Promise<CartResult> {
  const first = await createCartOnce(config, pkg, attributes, orderRef, fetchImpl, language, promo)
  if (language !== 'en' || !notUsd(first.currency)) return first
  console.warn(`[ichirei-order] ${JSON.stringify({ event: 'en_cart_currency_retry', order_ref: orderRef, currency: first.currency })}`)
  let second: CartResult
  try {
    second = await createCartOnce(config, pkg, attributes, orderRef, fetchImpl, language, promo)
  } catch {
    second = first
  }
  if (!notUsd(second.currency)) return second
  console.warn(`[ichirei-order] ${JSON.stringify({ event: 'en_cart_currency_mismatch', order_ref: orderRef, currency: second.currency })}`)
  return { ...second, mismatch: true }
}

/** The sizes that can be ordered right now: those with a variant. Without a config (not ready) none. */
export const availableSizes = (config: ShopifyConfig | null): PackageId[] => (config ? (PACKAGES.filter((p) => Boolean(config.variants[p])) as PackageId[]) : [])
