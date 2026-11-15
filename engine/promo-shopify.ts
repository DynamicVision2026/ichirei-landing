// The free gift in Shopify (customer-loop ticket, 2026-11-15, part 5). Shopify itself does the checking: the free-gift code (THANKS100, a 100%-off ICHIREI-only discount) is limited to
// "specific customers", and OUR site adds an email's customer to that list when it holds a gift and removes it when the hold ends or the gift is used. So at checkout Shopify refuses the code for
// any other email (and removes the discount when the email is changed). There is no code logic here beyond that list. Admin API only (the existing Tracking app's token); needs the scopes
// read_discounts, write_discounts and write_customers — without them every call fails and no hold is placed (the card then says "taking a short break").
//
// Nothing in this file touches a thing other than the discount's customer list and (for a ticked box) one customer's marketing consent and tags.

import type { AdminTokenCache, TrackDeps } from './track.ts'
import { adminTokens, trackDepsOf } from './payments-lookup.ts'
import { normalizeEmail } from './customer.ts'

export class PromoUnavailable extends Error {
  readonly reason: string
  constructor(message: string, reason = 'shopify') {
    super(message)
    this.name = 'PromoUnavailable'
    this.reason = reason
  }
}

export interface PromoShopify {
  /** Make sure a Shopify customer exists for this email and is on the free-gift discount's eligible list. Returns the customer's id. Throws PromoUnavailable when Shopify cannot do it. */
  addEligible(email: string): Promise<string>
  /** Take that customer off the eligible list (hold ended or gift used). */
  removeEligible(customerId: string): Promise<void>
  /** A ticked "tell me about new seasons and offers": subscribed, with the time, and the tags. Throws PromoUnavailable when a scope is missing. */
  saveConsent(email: string, at: Date): Promise<void>
}

export interface PromoConfig {
  discountId: string
  /** The public codes a visitor may type on the card (case-insensitive). */
  codes: string[]
  /** The Shopify code put on a held cart. */
  cartCode: string
}

const toGid = (kind: string, v: string): string => (v.startsWith('gid://') ? v : `gid://shopify/${kind}/${v.replace(/\D/g, '')}`)

export function promoConfig(env: NodeJS.ProcessEnv = process.env): PromoConfig | null {
  const id = (env.ICHIREI_PROMO_DISCOUNT_ID ?? '').trim()
  if (!id) return null
  const codes = (env.ICHIREI_PROMO_CODES ?? 'THANKS100').split(/[,|;\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean) // (commas, bars or spaces: gcloud's env list cannot carry a comma, so Cloud Build uses `|`)
  return { discountId: toGid('DiscountCodeNode', id), codes: codes.length ? codes : ['THANKS100'], cartCode: (env.ICHIREI_PROMO_SHOPIFY_CODE ?? 'THANKS100').trim() || 'THANKS100' }
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
const DISCOUNT_UPDATE = `mutation DU($id: ID!, $input: DiscountCodeBasicInput!) { discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } } }`
const CUSTOMER_UPDATE = `mutation CU($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { field message } } }`
const CONSENT_UPDATE = `mutation CE($input: CustomerEmailMarketingConsentUpdateInput!) { customerEmailMarketingConsentUpdate(input: $input) { customer { id } userErrors { field message } } }`

/** The Admin API client of the promotion, or null when the Tracking app or the discount id is not configured. */
export function promoShopifyFrom(env: NodeJS.ProcessEnv = process.env, tokens: AdminTokenCache = adminTokens, fetchImpl?: typeof fetch, deps?: TrackDeps | null): PromoShopify | null {
  const cfg = promoConfig(env)
  const base = deps ?? trackDepsOf(env)
  if (!cfg || !base) return null
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
  const change = async (customerId: string, how: 'add' | 'remove'): Promise<void> => {
    const r = (await gql(d, tokens, DISCOUNT_UPDATE, { id: cfg.discountId, input: { customerSelection: { customers: { [how]: [customerId] } } } })).discountCodeBasicUpdate
    const err = userErrors(r)
    if (err) throw new PromoUnavailable(`Shopify discountCodeBasicUpdate: ${err}`, 'discount')
  }
  return {
    async addEligible(email) {
      const id = await customerFor(email)
      await change(id, 'add')
      return id
    },
    async removeEligible(customerId) {
      await change(customerId, 'remove')
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
