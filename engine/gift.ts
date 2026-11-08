// The receiver's gift page (Part D of the 2026-10-30 ticket): a second private link per order, separate from the sender's page.
//
//   sender's page   /a/<AN-…>   (private, exists since the film): order details, a preview of everything, the 「贈る」 button.
//   receiver's page /g/<RG-…>   (new): the film plays first, then the character, the poem, the certificate line, 「○○より」, the sender's
//                               message and the scroll download. It NEVER shows a price, an order number, the other candidate characters or the
//                               sender's story; and nothing in it names the sender's page (its pictures come through the receiver's own link).
//
// The receiver's link is a token of 100 bits (RG-…), stored as its own small record in the order store (like the film record). For an e-gift the
// receiver types their address here: it is kept on our side only (this record), goes onto the owner's daily list, and is never shown to the sender or
// to anyone else; it is deleted 90 days after the order ships.

import { cleanReading } from '../src/order/reading.ts'
import { randomBytes } from 'node:crypto'
import { animationView, publicUrl, type AnimationRecord, type AnimationView } from './animation.ts'
import { certificateText } from '../src/order/certificate.ts'
import { EGIFT_JAPAN_ONLY, PACKAGE_SKU, type PackageId } from '../src/order/packages.ts'
import type { OrderRecord } from './order.ts'
import type { ArtRecord } from './film-art.ts'
import type { Language } from './contract.ts'
import { purposeFromOccasion } from '../src/order/purpose.ts'
import { convertLineScript, fullWidthPunctuation } from './script.ts'

export const GIFT_TOKEN_PATTERN = /^RG-[a-z2-9]{20}$/

export const newGiftToken = (random: (n: number) => Uint8Array = randomBytes): string => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789' // no look-alikes (no i, l, o, 0, 1)
  const bytes = random(20)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return `RG-${out}`
}
export const giftUrl = (token: string, env: NodeJS.ProcessEnv = process.env): string => `${publicUrl(env)}/g/${token}`

export interface GiftAddress {
  name: string
  /** ISO 3166 alpha-2. */
  country: string
  postal: string
  region: string
  line1: string
  line2: string
  phone: string
}

export interface GiftEgift {
  /** waiting: the receiver has not typed an address yet · received: they have. */
  state: 'waiting' | 'received'
  /** For the one reminder e-mail after 7 days; never shown to the receiver. */
  sender_email: string | null
  reminded_at: string | null
  received_at: string | null
  address: GiftAddress | null
}

export interface GiftRecord {
  schema: 'gift'
  token: string
  /** The sender's film page. Never sent to the receiver's page. */
  animation_id: string
  /** Kept for the owner; never sent to a page. */
  order_ref: string
  created_at: string
  language: Language
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  who: string
  memorial: boolean
  /** v9.6: why the gift is given; absent on older gifts. */
  purpose?: string | null
  /** The one line that comes with the character (the certificate line), in the sender's language. */
  certificate_line: string
  poem: { type: string; lines: string[]; reading: string } | null
  /** 「○○より」 / 「＿＿さんへ」: the sender's and the receiver's names as the sender typed them. */
  from: string
  to: string
  /** The short message for the card (60 characters at most); empty when none. */
  message: string
  size_code: string
  package: PackageId
  ship_to: 'none' | 'me' | 'direct' | 'egift'
  egift: GiftEgift | null
  /** Set from the owner page when the order has shipped: the address is deleted 90 days later. */
  shipped_at?: string | null
  /** The day the envelope may be opened (YYYY-MM-DD, JST); null/absent = at once. Until then the receiver's page shows the closed envelope only. */
  opens_on?: string | null
  /** 「一字礼　第 NNNN 号」 — the running number (engine/certificate-no.ts); null on gifts made before numbers existed. */
  certificate_no?: number | null
  /** The receiver's one reply (「ありがとうを返す」), shown on the sender's page. */
  reply?: { text: string; at: string } | null
}

export function buildGiftRecord(record: OrderRecord, animationId: string, token: string, senderEmail: string | null, now: Date = new Date()): GiftRecord {
  const p = record.production
  const poem = p.certificate.poems[0] ?? p.poems[0] ?? null
  const ship = p.ship_to ?? 'me'
  return {
    schema: 'gift',
    token,
    animation_id: animationId,
    order_ref: record.order_ref,
    created_at: now.toISOString(),
    language: p.language,
    glyph: p.glyph_to_carve,
    reading: cleanReading(p.certificate.reading),
    romanization: cleanReading(p.certificate.romanization),
    meaning_en: p.certificate.meaning_en,
    who: fullWidthPunctuation(convertLineScript(p.gaze_line, p.language) ?? p.gaze_line, p.language), // (an older order whose line is in the wrong Chinese script is shown in the right one)
    memorial: p.certificate.memorial === true,
    ...((p.certificate.purpose ?? purposeFromOccasion((record.engine_result as { occasion?: string | null } | undefined)?.occasion ?? null)) ? { purpose: (p.certificate.purpose ?? purposeFromOccasion((record.engine_result as { occasion?: string | null } | undefined)?.occasion ?? null)) as string } : {}),
    certificate_line: certificateText(p.language),
    poem: poem ? { type: String((poem as { type?: unknown }).type ?? ''), lines: [...((poem as { lines?: string[] }).lines ?? [])], reading: String((poem as { reading?: unknown }).reading ?? '') } : null,
    from: p.sender_name,
    to: p.receiver_name,
    message: p.gift_message ?? '',
    size_code: p.size_code ?? PACKAGE_SKU[p.package],
    package: p.package,
    ship_to: ship,
    egift: ship === 'egift' ? { state: 'waiting', sender_email: senderEmail, reminded_at: null, received_at: null, address: null } : null,
    shipped_at: null,
    opens_on: p.open_date ?? null,
    certificate_no: record.certificate_no ?? null,
    reply: null,
  }
}

export function isGiftRecord(x: unknown): x is GiftRecord {
  const r = x as Partial<GiftRecord> | null
  return !!r && r.schema === 'gift' && typeof r.token === 'string' && GIFT_TOKEN_PATTERN.test(r.token) && typeof r.animation_id === 'string' && typeof r.glyph === 'string'
}

/** What the receiver's page gets: the film, the character, the poem, the lines and the message — and nothing about the order or the story. */
export interface GiftView extends AnimationView {
  token: string
  certificate_line: string
  poem: { type: string; lines: string[]; reading: string } | null
  from: string
  to: string
  message: string
  /** null: an ordinary gift (nothing to enter). Otherwise the receiver is asked for an address: worldwide, or Japan only for the wooden sizes. */
  egift: { state: 'waiting' | 'received'; japan_only: boolean } | null
  locked: false
  /** The running certificate number (null on old gifts). */
  certificate_no: number | null
  /** The day the order was made (JST, YYYY-MM-DD) and the day the envelope opens (null = at once): the certificate shows one of them. */
  order_date: string
  opens_on: string | null
  /** True once the receiver has sent their reply (the reply itself is for the sender's page only). */
  replied: boolean
  /** Which size it is: the keepsake lines of the last screen depend on it. */
  package: PackageId
}

/** The closed envelope: names and the date only. Nothing of the film, the character, the poem or the message leaves the server before the day. */
export interface GiftLockedView {
  locked: true
  token: string
  language: Language
  memorial: boolean
  purpose?: string | null
  from: string
  to: string
  opens_on: string
  days_left: number
  /** The buyer has not collected the gift yet (2026-11-06): the envelope stays sealed with no open button and says it is arriving soon. */
  arriving?: boolean
}

const JST = 9 * 3600_000
export const todayJst = (now: Date): string => new Date(now.getTime() + JST).toISOString().slice(0, 10)
const dayNumber = (d: string): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000)

/** True while the envelope may not be opened yet (the opening date has not come, in Japan time). */
export const isLocked = (g: GiftRecord, now: Date): boolean => !!g.opens_on && todayJst(now) < g.opens_on

export function lockedView(g: GiftRecord, now: Date): GiftLockedView {
  const opens = g.opens_on ?? todayJst(now)
  return { locked: true, token: g.token, language: g.language, memorial: g.memorial, ...(g.purpose ? { purpose: g.purpose } : {}), from: g.from, to: g.to, opens_on: opens, days_left: Math.max(1, dayNumber(opens) - dayNumber(todayJst(now))) }
}

/** The sealed envelope of a gift the buyer has not collected yet: the two names, nothing else, no open button. */
export function arrivingView(g: GiftRecord): GiftLockedView {
  return { locked: true, arriving: true, token: g.token, language: g.language, memorial: g.memorial, ...(g.purpose ? { purpose: g.purpose } : {}), from: g.from, to: g.to, opens_on: g.opens_on ?? '', days_left: 0 }
}

export const REPLY_MAX = 200

export type ReplyCheck = { ok: true; text: string } | { ok: false; error: string }
export function checkReply(body: unknown): ReplyCheck {
  const raw = (body as { text?: unknown } | null)?.text
  if (typeof raw !== 'string') return { ok: false, error: 'text is required' }
  const text = raw.replace(/\p{Cc}+/gu, ' ').replace(/[ \t]+/g, ' ').trim()
  if (!text) return { ok: false, error: 'text is required' }
  if ([...text].length > REPLY_MAX) return { ok: false, error: `text is longer than ${REPLY_MAX} characters` }
  return { ok: true, text }
}

export function giftView(g: GiftRecord, anim: AnimationRecord, art: ArtRecord | null): GiftView {
  const v = animationView(anim, art)
  const from = `/api/film/${anim.id}/picture/`
  const to = `/api/gift/${g.token}/picture/`
  return {
    ...v,
    id: g.token, // the receiver's page never carries the sender's id
    film: v.film ? { ...v.film, pictures: v.film.pictures ? v.film.pictures.map((u) => (u.startsWith(from) ? to + u.slice(from.length) : u)) : null } : null,
    token: g.token,
    certificate_line: g.certificate_line,
    poem: g.poem,
    from: g.from,
    to: g.to,
    message: g.message,
    egift: g.egift ? { state: g.egift.state, japan_only: EGIFT_JAPAN_ONLY[g.package] } : null,
    locked: false,
    certificate_no: g.certificate_no ?? null,
    order_date: todayJst(new Date(g.created_at)),
    opens_on: g.opens_on ?? null,
    replied: !!g.reply,
    package: g.package,
  }
}

// ---- the e-gift address -----------------------------------------------------------------------------------------------------------------------

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

export type AddressCheck = { ok: true; address: GiftAddress } | { ok: false; field: string; error: string }

/** Validate what the receiver typed. Japan format by default; the wooden sizes are Japan only at launch, the card ships worldwide. */
export function checkAddress(body: unknown, pkg: PackageId): AddressCheck {
  const b = (body ?? {}) as Record<string, unknown>
  const name = clean(b.name, 60)
  if (!name) return { ok: false, field: 'name', error: 'Name is required' }
  const country = (clean(b.country, 2) || 'JP').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, field: 'country', error: 'Country must be a 2-letter code' }
  if (EGIFT_JAPAN_ONLY[pkg] && country !== 'JP') return { ok: false, field: 'country', error: 'This size can be sent as an e-gift within Japan only' }
  const postal = clean(b.postal, 20)
  if (country === 'JP' ? !/^\d{3}-?\d{4}$/.test(postal.replace(/[〒\s]/g, '')) : postal === '') return { ok: false, field: 'postal', error: 'Postal code is required' }
  const line1 = clean(b.line1, 120)
  if (!line1) return { ok: false, field: 'line1', error: 'Address is required' }
  const phone = clean(b.phone, 20)
  if (!/^[0-9+\-() ]{7,20}$/.test(phone)) return { ok: false, field: 'phone', error: 'Phone number is required' }
  const region = clean(b.region, 60)
  if (country === 'JP' && !region) return { ok: false, field: 'region', error: 'Prefecture is required' }
  return { ok: true, address: { name, country, postal: country === 'JP' ? postal.replace(/[〒\s]/g, '').replace(/^(\d{3})-?(\d{4})$/, '$1-$2') : postal, region, line1, line2: clean(b.line2, 120), phone } }
}

// ---- reminders and clean-up --------------------------------------------------------------------------------------------------------------------

export const REMIND_AFTER_DAYS = 7
export const FLAG_AFTER_DAYS = 30
export const ADDRESS_KEEP_DAYS = 90
const DAY = 86_400_000

/** E-gifts whose receiver has not typed an address 7 days after the order, and who have not been reminded yet (the sender is e-mailed ONCE). */
export const reminderDue = (g: GiftRecord, now: Date): boolean => !!g.egift && g.egift.state === 'waiting' && !g.egift.reminded_at && !!g.egift.sender_email && now.getTime() - Date.parse(g.created_at) >= REMIND_AFTER_DAYS * DAY
/** After 30 days with no address the order is flagged on the owner page; the owner decides, there is no automatic refund. */
export const flaggedNoAddress = (g: GiftRecord, now: Date): boolean => !!g.egift && g.egift.state === 'waiting' && now.getTime() - Date.parse(g.created_at) >= FLAG_AFTER_DAYS * DAY
/** The receiver's address is deleted 90 days after the order ships. */
export const addressExpired = (g: GiftRecord, now: Date): boolean => !!g.egift?.address && !!g.shipped_at && now.getTime() - Date.parse(g.shipped_at) >= ADDRESS_KEEP_DAYS * DAY
export function purgeAddress(g: GiftRecord): GiftRecord {
  return g.egift ? { ...g, egift: { ...g.egift, address: null } } : g
}
