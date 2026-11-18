// The basket (customer-loop ticket, 2026-11-15, part 3): a result is never lost. Every time a result page opens the page saves a basket item to the server, under the browser's customer record
// (engine/customer.ts). One object per saved gift: `basket/BK-<20>.json`. The item holds what the page needs to open the result page again — the chosen card and the cards around it,
// the story it came from, the language and the names, the preview id (the poem and the pictures already live in the preview: nothing is drawn again) — and the time.
// An email never opens a basket: only the browser it was made on, or the private link /b/<token> (a random, unguessable token), opens it.
//
// The item id is derived from the story and the chosen character, so opening the same result again is the SAME item (exactly one per result). 20 items at most per customer.

import { createHash, randomBytes } from 'node:crypto'
import { casJson, customerIdOf, linkEmail, normalizeEmail, readCustomer, validEmail, type CustomerRecord } from './customer.ts'
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
  /** The card: character, reading, word, the one line. `meaning` is the English core meaning of the character (en cards; "" otherwise). */
  card: { kanji: string; reading: string; word: string; line: string; meaning?: string }
  /** What the sender picked for this gift (2026-11-18): the relationship and the reason for giving (codes, plus the free text of "other"), the round (1–3) and the slot (main / second / free) of the chosen card. */
  context?: { relationship: string; relationship_other: string; purpose: string; purpose_other: string; occasion: string }
  round?: number
  slot?: string
  /** The poem of the preview, when one had been written. */
  poem?: { lines: string[]; reading: string; type?: string } | null
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
export const mayOpen = (rec: CustomerRecord, browser: string): boolean => (rec.basket_browsers ?? []).includes(browser)

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
  meaning?: string
  relationship?: string
  relationship_other?: string
  purpose?: string
  purpose_other?: string
  occasion?: string
  round?: number
  slot?: string
  poem?: { lines: string[]; reading: string; type?: string } | null
}

const SLOTS = ['main', 'second', 'freestyle']
const cleanPoem = (p: SaveInput['poem']): BasketItem['poem'] => {
  if (!p || !Array.isArray(p.lines)) return null
  const lines = p.lines.filter((l) => typeof l === 'string').slice(0, 12).map((l) => clip(l, 120))
  return lines.length > 0 ? { lines, reading: clip(p.reading, 400), ...(typeof p.type === 'string' ? { type: clip(p.type, 12) } : {}) } : null
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
      // what is saved is exactly what was chosen: every field of the card comes from this request, none is kept from an earlier save of the same item
      card: { kanji: clip(input.kanji, 2), reading: clip(input.reading, 60), word: clip(input.word, 60), line: clip(input.line, 200), meaning: clip(input.meaning, 60) },
      context: { relationship: clip(input.relationship, 24), relationship_other: clip(input.relationship_other, 60), purpose: clip(input.purpose, 24), purpose_other: clip(input.purpose_other, 60), occasion: clip(input.occasion, 24) },
      round: Number.isInteger(input.round) && (input.round as number) >= 1 && (input.round as number) <= 9 ? input.round : cur?.round,
      slot: SLOTS.includes(input.slot ?? '') ? input.slot : cur?.slot,
      poem: cleanPoem(input.poem) ?? cur?.poem ?? null,
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
  updated_at: string
  language: string
  to: string
  card: BasketItem['card']
  preview_id: string | null
  context: NonNullable<BasketItem['context']>
  round: number | null
  slot: string | null
  poem: BasketItem['poem']
  /** The moment as the sender wrote it (the first message and their answers): shown on the customer's own page only, never logged and never in the dashboard. */
  story: string
  /** The day the saved gift is removed if nothing more happens (30 days after the last visit; a record with an order is kept). */
  saved_until: string
}

const DAY_MS = 86_400_000
const summaryOf = (it: BasketItem, rec: CustomerRecord): BasketSummary => {
  const r = (it.resume ?? {}) as { story?: unknown; followUps?: unknown }
  const answers = Array.isArray(r.followUps) ? r.followUps.filter((a): a is string => typeof a === 'string' && a.trim() !== '') : []
  const story = [typeof r.story === 'string' ? r.story : '', ...answers].filter((t) => t.trim() !== '').join('\n\n').slice(0, 7000)
  return {
    id: it.id, created_at: it.created_at, updated_at: it.updated_at ?? it.created_at, language: it.language, to: it.to, card: it.card, preview_id: it.preview_id,
    context: it.context ?? { relationship: '', relationship_other: '', purpose: '', purpose_other: '', occasion: '' },
    round: it.round ?? null, slot: it.slot ?? null, poem: it.poem ?? null, story,
    saved_until: new Date(Date.parse(rec.last_seen) + 30 * DAY_MS).toISOString(),
  }
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
      items.push(summaryOf(JSON.parse(raw.toString('utf8')) as BasketItem, rec))
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
export async function openBasketLink(store: OrderStore | null, browser: string, token: string, mailToken?: string | null, now: Date = new Date()): Promise<{ items: BasketSummary[]; token: string } | null> {
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
  const before = await customerIdOf(store, browser)
  await casJson<CustomerRecord>(store, `customers/${customer}.json`, (cur) => {
    if (!cur) return null
    if (!cur.browsers.includes(browser)) cur.browsers.push(browser)
    if (!(cur.basket_browsers ?? []).includes(browser)) cur.basket_browsers = [...(cur.basket_browsers ?? []), browser]
    cur.last_seen = new Date().toISOString()
    return cur
  })
  await store.putObject(`customers/ptr/${browser}.json`, JSON.stringify({ id: customer }), 'application/json')
  // what this browser had saved on its own (a record with no email in it) joins the page it has just been let into
  if (before === browser && before !== customer) await absorbBrowserRecord(store, customer, browser, now)
  // the link inside the mail to a NEW address: opening it proves the address, so the record takes it (replacing the old one)
  if (mailToken) await confirmEmailChange(store, browser, customer, mailToken, now)
  const list = await listBasket(store, browser)
  return { items: list.items, token }
}

/** The browser's own record (V…, no email in it) is merged into the record it has just been let into; the items, the timeline and the order flag move, the old record goes. */
async function absorbBrowserRecord(store: OrderStore, customer: string, browser: string, now: Date): Promise<void> {
  const from = await readCustomer(store, browser)
  if (!from) return
  await casJson<CustomerRecord>(store, `customers/${customer}.json`, (cur) => {
    if (!cur) return null
    for (const id of from.basket) if (!cur.basket.includes(id)) cur.basket.push(id)
    while (cur.basket.length > MAX_ITEMS) cur.basket.shift()
    cur.has_order = cur.has_order || from.has_order
    cur.events = [...cur.events, ...from.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-200)
    cur.last_seen = now.toISOString()
    return cur
  })
  if (from.basket_token && from.basket_token !== (await readCustomer(store, customer))?.basket_token) await store.deleteObject?.(tokPath(from.basket_token)).catch(() => {})
  await store.deleteObject?.(`customers/${browser}.json`).catch(() => {})
}

export const MAIL_TOKEN_PATTERN = /^BM-[a-z2-9]{24}$/
const pendingPath = (t: string): string => `basket/pending/${t}.json`

/** "Save to my email" with an address that is not the record's own: held until the link in the mail to the new address is opened. Returns the mail token. */
export async function holdEmailChange(store: OrderStore, customer: string, email: string, now: Date = new Date(), random: (n: number) => Uint8Array = randomBytes): Promise<string> {
  const t = `BM-${b32(Buffer.from(random(24)), 24)}`
  await store.putObject(pendingPath(t), JSON.stringify({ customer, email, at: now.toISOString() }), 'application/json')
  return t
}

async function confirmEmailChange(store: OrderStore, browser: string, customer: string, mailToken: string, now: Date): Promise<boolean> {
  if (!MAIL_TOKEN_PATTERN.test(mailToken)) return false
  const raw = await store.getObject(pendingPath(mailToken)).catch(() => null)
  let pending: { customer?: string; email?: string; at?: string } | null = null
  try {
    pending = raw ? (JSON.parse(raw.toString('utf8')) as { customer?: string; email?: string; at?: string }) : null
  } catch {
    pending = null
  }
  // only the record it was made for, and only within a week
  if (!pending || pending.customer !== customer || typeof pending.email !== 'string' || !validEmail(pending.email) || now.getTime() - Date.parse(pending.at ?? '') > 7 * 86_400_000) return false
  const eid = await linkEmail(store, browser, pending.email, now)
  await casJson<CustomerRecord>(store, `customers/${eid}.json`, (cur) => {
    if (!cur) return null
    cur.emails = [normalizeEmail(pending.email as string)]
    cur.mailed_at = cur.mailed_at ?? now.toISOString()
    return cur
  })
  await store.deleteObject?.(pendingPath(mailToken)).catch(() => {})
  return true
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
