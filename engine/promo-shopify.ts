// The free gift in Shopify (hotfix 2026-11-16). ONE PRIVATE CODE PER HOLD. When a hold is placed the site creates a single-use 100%-off code (GIFT-XXXXXXXX) for the ICHIREI e-gift, open to all
// customers, that dies with the hold; the held cart carries it, and the hold's end or use deletes it. Nothing depends on who is signed in at checkout (Shop Pay, a saved account, another
// email): a customer-specific code is refused when the checkout's customer is not that email, which sent every holder to full price. Our site enforces "one per email", the daily
// 100, the 2-hour hold and the 3 holds a day (engine/promo-holds.ts); Shopify only honours a code nobody else has.
//
// THANKS100 is NOT touched by the site any more (the owner keeps it in Shopify as a manual fallback for support). Admin API only (the existing Tracking app's token); needs the scopes
// write_discounts (the codes) and, for a ticked marketing box, read/write_customers — without write_discounts every call fails and no hold is placed (the card then says "taking a short break").

import type { AdminTokenCache, TrackDeps } from './track.ts'
import { adminTokens, trackDepsOf } from './payments-lookup.ts'
import { normalizeEmail } from './customer.ts'
import { newHoldCode } from './hold-code.ts'
export { HOLD_CODE_PREFIX, codeTail, isHoldCode, newHoldCode, publicCodeName } from './hold-code.ts'

export class PromoUnavailable extends Error {
  readonly reason: string
  constructor(message: string, reason = 'shopify') {
    super(message)
    this.name = 'PromoUnavailable'
    this.reason = reason
  }
}

/** The private code of one hold: what the cart carries, and the Shopify discount to delete when the hold ends or is used. */
export interface HoldDiscount {
  code: string
  discountId: string
}

export interface PromoShopify {
  /** Make the single-use, 100%-off, e-gift-only code for one hold; it ends at `endsAt`. Throws PromoUnavailable when Shopify cannot do it. */
  createHoldCode(holdId: string, endsAt: Date, now: Date): Promise<HoldDiscount>
  /** Delete a hold's code (the hold ended or the gift was used). Throws PromoUnavailable when Shopify cannot do it (the code expires on its own anyway). */
  deleteHoldCode(discountId: string): Promise<void>
  /** A ticked "tell me about new seasons and offers": subscribed, with the time, and the tags. Throws PromoUnavailable when a scope is missing. */
  saveConsent(email: string, at: Date): Promise<void>
}

export interface PromoConfig {
  /** The numeric id of THANKS100 (legacy: the site no longer edits it). */
  discountId: string | null
  /** The public codes a visitor may type on the card (case-insensitive). */
  codes: string[]
}

const toGid = (kind: string, v: string): string => (v.startsWith('gid://') ? v : `gid://shopify/${kind}/${v.replace(/\D/g, '')}`)

export function promoConfig(env: NodeJS.ProcessEnv = process.env): PromoConfig {
  const id = (env.ICHIREI_PROMO_DISCOUNT_ID ?? '').trim()
  const codes = (env.ICHIREI_PROMO_CODES ?? 'THANKS100').split(/[,|;\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean) // (commas, bars or spaces: gcloud's env list cannot carry a comma, so Cloud Build uses `|`)
  return { discountId: id ? toGid('DiscountCodeNode', id) : null, codes: codes.length ? codes : ['THANKS100'] }
}

/** Is the typed code one of the configured public codes? */
export const codeAllowed = (cfg: PromoConfig, typed: unknown): boolean => typeof typed === 'string' && cfg.codes.includes(typed.trim().toUpperCase())

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] }

async function gql(d: TrackDeps, tokens: AdminTokenCache, query: string, variables: Record<string, unknown>): Promise<Record<string, any>> {
  const doFetch = d.fetchImpl ?? fetch
  const call = async (token: string) =>
    doFetch(`${d.config.apiBase}/admin/api/${d.config.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    })
  let res: Response
  try {
    res = await call(await tokens.get(d))
    if (res.status === 401) {
      tokens.clear()
      res = await call(await tokens.get(d))
    }
  } catch (err) {
    throw new PromoUnavailable(`Shopify could not be asked: ${err instanceof Error ? err.message : 'error'}`, 'unreachable')
  }
  if (!res.ok) throw new PromoUnavailable(`Shopify Admin API HTTP ${res.status}`, `http_${res.status}`)
  const json = (await res.json().catch(() => ({}))) as Gql
  if (json.errors?.length) {
    const m = json.errors.map((e) => e.message).join('; ')
    throw new PromoUnavailable(`Shopify Admin API: ${m}`, /access denied|scope|permission/i.test(m) ? 'scope' : 'graphql')
  }
  return (json.data ?? {}) as Record<string, any>
}

const userErrors = (x: { userErrors?: { field?: string[]; message: string }[] } | null | undefined): string => (x?.userErrors ?? []).map((e) => e.message).join('; ')

const CUSTOMER_BY_EMAIL = `query C($q: String!) { customers(first: 1, query: $q) { nodes { id } } }`
const CUSTOMER_CREATE = `mutation CC($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`
const CODE_CREATE = `mutation DC($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`
const CODE_DELETE = `mutation DD($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }`
const CUSTOMER_UPDATE = `mutation CU($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { field message } } }`
const CONSENT_UPDATE = `mutation CE($input: CustomerEmailMarketingConsentUpdateInput!) { customerEmailMarketingConsentUpdate(input: $input) { customer { id } userErrors { field message } } }`

/** The Admin API client of the promotion, or null when the Tracking app or the discount id is not configured. */
export function promoShopifyFrom(env: NodeJS.ProcessEnv = process.env, tokens: AdminTokenCache = adminTokens, fetchImpl?: typeof fetch, deps?: TrackDeps | null): PromoShopify | null {
  const base = deps ?? trackDepsOf(env)
  if (!base) return null
  const egift = (env.SHOPIFY_VARIANT_EGIFT ?? '').trim()
  const variantGid = egift ? toGid('ProductVariant', egift) : null
  const d: TrackDeps = { ...base, ...(fetchImpl ? { fetchImpl } : {}) }

  const customerFor = async (email: string): Promise<string> => {
    const e = normalizeEmail(email)
    const found = (await gql(d, tokens, CUSTOMER_BY_EMAIL, { q: `email:${e}` })).customers?.nodes?.[0]?.id as string | undefined
    if (found) return found
    const made = (await gql(d, tokens, CUSTOMER_CREATE, { input: { email: e, tags: ['ichirei-thanks'] } })).customerCreate
    const id = made?.customer?.id as string | undefined
    if (id) return id
    // "email has already been taken" (a race): find it
    const again = (await gql(d, tokens, CUSTOMER_BY_EMAIL, { q: `email:${e}` })).customers?.nodes?.[0]?.id as string | undefined
    if (again) return again
    throw new PromoUnavailable(`Shopify customerCreate: ${userErrors(made) || 'no customer'}`, 'customer')
  }
  return {
    async createHoldCode(holdId, endsAt, now) {
      if (!variantGid) throw new PromoUnavailable('SHOPIFY_VARIANT_EGIFT is not set: the free gift has no product to apply to', 'config')
      const code = newHoldCode()
      const r = (await gql(d, tokens, CODE_CREATE, {
        d: {
          title: `ICHIREI free gift · ${holdId}`,
          code,
          startsAt: now.toISOString(),
          endsAt: endsAt.toISOString(),
          customerSelection: { all: true }, // nothing depends on who is signed in at checkout
          customerGets: { value: { percentage: 1.0 }, items: { products: { productVariantsToAdd: [variantGid] } } }, // 100% off the ICHIREI e-gift only
          appliesOncePerCustomer: true,
          usageLimit: 1,
          combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
        },
      })).discountCodeBasicCreate
      const err = userErrors(r)
      const id = r?.codeDiscountNode?.id as string | undefined
      if (err || !id) throw new PromoUnavailable(`Shopify discountCodeBasicCreate: ${err || 'no discount'}`, 'discount')
      return { code, discountId: id }
    },
    async deleteHoldCode(discountId) {
      const r = (await gql(d, tokens, CODE_DELETE, { id: discountId })).discountCodeDelete
      const err = userErrors(r)
      if (err) throw new PromoUnavailable(`Shopify discountCodeDelete: ${err}`, 'discount')
    },
    async saveConsent(email, at) {
      const id = await customerFor(email)
      const tags = (await gql(d, tokens, CUSTOMER_UPDATE, { input: { id, tags: ['ichirei-thanks', 'ichirei-en'] } })).customerUpdate
      if (userErrors(tags)) throw new PromoUnavailable(`Shopify customerUpdate: ${userErrors(tags)}`, 'customer')
      const c = (await gql(d, tokens, CONSENT_UPDATE, { input: { customerId: id, emailMarketingConsent: { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN', consentUpdatedAt: at.toISOString() } } })).customerEmailMarketingConsentUpdate
      if (userErrors(c)) throw new PromoUnavailable(`Shopify consent: ${userErrors(c)}`, 'consent')
    },
  }
}
