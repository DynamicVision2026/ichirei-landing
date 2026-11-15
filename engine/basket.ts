// The basket (customer-loop ticket, 2026-11-15, part 3): a result is never lost. Every time a result page opens the page saves a basket item to the server, under the browser's customer record
// (engine/customer.ts). One object per saved gift: `basket/BK-<20>.json`. The item holds what the page needs to open the result page again — the chosen card and the cards around it,
// the story it came from, the language and the names, the preview id (the poem and the pictures already live in the preview: nothing is drawn again) — and the time.
// An email never opens a basket: only the browser it was made on, or the private link /b/<token> (a random, unguessable token), opens it.
//
// The item id is derived from the story and the chosen character, so opening the same result again is the SAME item (exactly one per result). 20 items at most per customer.

import { createHash, randomBytes } from 'node:crypto'
import { casJson, customerIdOf, readCustomer, type CustomerRecord } from './customer.ts'
import type { OrderStore } from './order-store.ts'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const MAX_ITEMS = 20
export const MAX_RESUME_BYTES = 240_000

export interface BasketItem {
  schema: 'basket-item'
  id: string
  created_at: string
  updated_at: string
  language: string
  /** The receiver's / sender's names as typed so far (may be empty). */
  to: string
  from: string
  /** The card: character, reading, word, the one line. */
  card: { kanji: string; reading: string; word: string; line: string }
  /** The draft of this story's pictures and poem (engine/preview.ts), when it was started. */
  preview_id: string | null
  /** What the page needs to open the result page again (story, answers, the cards, the pick, the context). Opaque to the server beyond its size. */
  resume: Record<string, unknown>
}

const b32 = (buf: Buffer, n: number): string => {
  let out = ''
  for (let i = 0; out.length < n; i++) out += ALPHABET[buf[i % buf.length] % ALPHABET.length]
  return out
}

/** The id of the item for this story and this character: the same result is always the same item. */
export function itemIdFor(story: string, language: string, kanji: string): string {
  const h = createHash('sha256').update(`${language}|${kanji}|${story.trim()}`).digest()
  return `BK-${b32(h, 20)}`
}

export const newBasketToken = (random: (n: number) => Uint8Array = randomBytes): string => `BT-${b32(Buffer.from(random(24)), 24)}`
export const BASKET_TOKEN_PATTERN = /^BT-[a-z2-9]{24}$/
const itemPath = (id: string): string => `basket/${id}.json`
const tokPath = (t: string): string => `basket/tok/${t}.json`

/** Only a browser that saved into the basket or opened its private link sees it — an email never does. */
const mayOpen = (rec: CustomerRecord, browser: string): boolean => (rec.basket_browsers ?? []).includes(browser)

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? [...v.trim()].slice(0, n).join('') : '')

export interface SaveInput {
  resume: Record<string, unknown>
  story: string
  language: string
  kanji: string
  reading: string
  word: string
  line: string
  to?: string
  from?: string
  preview_id?: string | null
}

export type SaveResult = { ok: true; id: string; token: string; created: boolean; customer: string } | { ok: false; code: 'too_large' | 'bad_input' | 'no_store' }

/** Save (or update) the basket item of this browser's result. Never calls a model. */
export async function saveBasketItem(store: OrderStore | null, browser: string, input: SaveInput, now: Date = new Date()): Promise<SaveResult> {
  if (!store) return { ok: false, code: 'no_store' }
  if (!input.story.trim() || !input.kanji || [...input.kanji].length > 2 || !input.resume || typeof input.resume !== 'object') return { ok: false, code: 'bad_input' }
  if (Buffer.byteLength(JSON.stringify(input.resume)) > MAX_RESUME_BYTES) return { ok: false, code: 'too_large' }
  const id = itemIdFor(input.story, input.language, input.kanji)
  const customer = await customerIdOf(store, browser)
  let created = false
  const item = await casJson<BasketItem>(store, itemPath(id), (cur) => {
    if (!cur) created = true
    return {
      schema: 'basket-item',
      id,
      created_at: cur?.created_at ?? now.toISOString(),
      updated_at: now.toISOString(),
      language: clip(input.language, 12) || 'ja',
      to: clip(input.to, 40) || cur?.to || '',
      from: clip(input.from, 40) || cur?.from || '',
      card: { kanji: clip(input.kanji, 2), reading: clip(input.reading, 60), word: clip(input.word, 60), line: clip(input.line, 200) },
      preview_id: typeof input.preview_id === 'string' && /^AN-[a-z2-9]{20}$/.test(input.preview_id) ? input.preview_id : (cur?.preview_id ?? null),
      resume: input.resume,
    }
  })
  if (!item) return { ok: false, code: 'bad_input' }
  // the customer's list and their private token
  let token = ''
  const dropped: string[] = []
  await casJson<CustomerRecord>(store, `customers/${customer}.json`, (cur) => {
    const rec: CustomerRecord =
      cur ?? { schema: 'customer', id: customer, emails: [], browsers: [browser], first_seen: now.toISOString(), last_seen: now.toISOString(), language: input.language || null, consent: { marketing: false, at: null }, from_code: null, basket_token: null, basket: [], basket_browsers: [], has_order: false, events: [] }
    if (!rec.basket.includes(id)) rec.basket.push(id)
    if (!(rec.basket_browsers ?? []).includes(browser)) rec.basket_browsers = [...(rec.basket_browsers ?? []), browser]
    while (rec.basket.length > MAX_ITEMS) dropped.push(rec.basket.shift() as string)
    if (!rec.basket_token) rec.basket_token = newBasketToken()
    token = rec.basket_token
    rec.last_seen = now.toISOString()
    if (!rec.events.some((e) => e.code === 'saved' && e.at.slice(0, 10) === now.toISOString().slice(0, 10))) rec.events.push({ code: 'saved', at: now.toISOString() })
    return rec
  })
  for (const d of dropped) await store.deleteObject?.(itemPath(d)).catch(() => {})
  await store.putObject(tokPath(token), JSON.stringify({ customer }), 'application/json', { ifAbsent: true }).catch(() => false)
  return { ok: true, id, token, created, customer }
}

export interface BasketSummary {
  id: string
  created_at: string
  language: string
  to: string
  card: BasketItem['card']
  preview_id: string | null
}

/** What the browser's basket holds, newest first, and its private link token. */
export async function listBasket(store: OrderStore | null, browser: string): Promise<{ items: BasketSummary[]; token: string | null }> {
  if (!store) return { items: [], token: null }
  const rec = await readCustomer(store, await customerIdOf(store, browser))
  if (!rec || !mayOpen(rec, browser)) return { items: [], token: null }
  const items: BasketSummary[] = []
  for (const id of rec.basket) {
    const raw = await store.getObject(itemPath(id)).catch(() => null)
    if (!raw) continue
    try {
      const it = JSON.parse(raw.toString('utf8')) as BasketItem
      items.push({ id: it.id, created_at: it.created_at, language: it.language, to: it.to, card: it.card, preview_id: it.preview_id })
    } catch {
      // a broken item is skipped
    }
  }
  items.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return { items, token: rec.basket_token }
}

/** One item in full — only if it is in THIS browser's basket. */
export async function readBasketItem(store: OrderStore | null, browser: string, id: string): Promise<BasketItem | null> {
  if (!store || !/^BK-[a-z2-9]{20}$/.test(id)) return null
  const rec = await readCustomer(store, await customerIdOf(store, browser))
  if (!rec || !mayOpen(rec, browser) || !rec.basket.includes(id)) return null
  const raw = await store.getObject(itemPath(id)).catch(() => null)
  try {
    return raw ? (JSON.parse(raw.toString('utf8')) as BasketItem) : null
  } catch {
    return null
  }
}

/** "×": deleted at once. Only from the owner's own basket. */
export async function deleteBasketItem(store: OrderStore | null, browser: string, id: string): Promise<boolean> {
  if (!store || !/^BK-[a-z2-9]{20}$/.test(id)) return false
  const customer = await customerIdOf(store, browser)
  let had = false
  await casJson<CustomerRecord>(store, `customers/${customer}.json`, (cur) => {
    if (!cur || !mayOpen(cur, browser) || !cur.basket.includes(id)) return null
    had = true
    cur.basket = cur.basket.filter((x) => x !== id)
    return cur
  })
  if (had) await store.deleteObject?.(itemPath(id)).catch(() => {})
  return had
}

/** After an order: the item that was ordered leaves the basket (the others stay). */
export async function removeOrderedItem(store: OrderStore | null, browser: string | null | undefined, story: string, language: string, kanji: string): Promise<void> {
  if (!store || !browser) return
  await deleteBasketItem(store, browser, itemIdFor(story, language, kanji)).catch(() => false)
}

/**
 * The private link: link this browser to the customer record the token belongs to, and answer its basket. null for a token that is not a basket's (the page then shows the normal landing).
 * The token never reveals an email.
 */
export async function openBasketLink(store: OrderStore | null, browser: string, token: string): Promise<{ items: BasketSummary[]; token: string } | null> {
  if (!store || !BASKET_TOKEN_PATTERN.test(token)) return null
  const raw = await store.getObject(tokPath(token)).catch(() => null)
  let customer: string | null = null
  try {
    customer = raw ? ((JSON.parse(raw.toString('utf8')) as { customer?: string }).customer ?? null) : null
  } catch {
    customer = null
  }
  if (!customer || !/^[EV][A-Za-z0-9_-]{22,64}$/.test(customer)) return null
  const rec = await readCustomer(store, customer)
  if (!rec || rec.basket_token !== token) return null
  await casJson<CustomerRecord>(store, `customers/${customer}.json`, (cur) => {
    if (!cur) return null
    if (!cur.browsers.includes(browser)) cur.browsers.push(browser)
    if (!(cur.basket_browsers ?? []).includes(browser)) cur.basket_browsers = [...(cur.basket_browsers ?? []), browser]
    cur.last_seen = new Date().toISOString()
    return cur
  })
  await store.putObject(`customers/ptr/${browser}.json`, JSON.stringify({ id: customer }), 'application/json')
  const list = await listBasket(store, browser)
  return { items: list.items, token }
}

/** The private link's token of this browser's customer record, made when it is first needed (a hold hands the browser to a phone with the same QR as the basket). */
export async function ensureBasketToken(store: OrderStore | null, browser: string, now: Date = new Date()): Promise<string | null> {
  if (!store || !browser) return null
  const customer = await customerIdOf(store, browser)
  let token = ''
  await casJson<CustomerRecord>(store, `customers/${customer}.json`, (cur) => {
    const rec: CustomerRecord =
      cur ?? { schema: 'customer', id: customer, emails: [], browsers: [browser], first_seen: now.toISOString(), last_seen: now.toISOString(), language: null, consent: { marketing: false, at: null }, from_code: null, basket_token: null, basket: [], basket_browsers: [], has_order: false, events: [] }
    if (!rec.basket_token) rec.basket_token = newBasketToken()
    if (!(rec.basket_browsers ?? []).includes(browser)) rec.basket_browsers = [...(rec.basket_browsers ?? []), browser]
    token = rec.basket_token
    return rec
  })
  if (!token) return null
  await store.putObject(tokPath(token), JSON.stringify({ customer }), 'application/json', { ifAbsent: true }).catch(() => false)
  return token
}
