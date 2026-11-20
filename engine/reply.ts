// The free gift back (Part 14, 2026-11-20). Every gift can close its loop: after the receiver has opened it, they may send ONE gift back to the sender, free, and so experience the product themselves.
//
//   the pair      two e-mails — the sender's (the order's e-mail) and the receiver's (typed by the receiver when they send the gift back), each lowercased and trimmed. The pair holds the right, not the story:
//                 one gift back per pair, ever (`reply/pair/<sha256 of the pair>.json`, stored hashed), and one per gift (the gift record keeps `back`).
//   the ticket    a small server-side record (`RT-…`) tied to the gift that was opened. The receiver's button creates it; the writing page and the order step carry it; the order uses it up.
//   no Shopify    a reply is an e-gift made at ¥0 / $0 with `source: 'reply'`. It is not part of the promotion: not counted in the daily 100, no code, no checkout, no cap of its own (replies cannot exceed gifts sent).
//   delivery      to the sender: the reply gift is attached to the original gift (`reply` with the character and the reply gift's token) and shows in the sender's マイギフト as 「返事が届きました：〈字〉」;
//                 once a mailer exists also one e-mail with the link. Until RESEND_API_KEY is set the receiver's e-mail is taken as entered; with a mailer it gets the usual inbox-link check first
//                 (the reply waits, held under the address, until the link in the mail is opened).
//   kill switch   ICHIREI_REPLY_ENABLED (default on); "0" / "off" turns the choice off everywhere: the receiver then sees only 「あなたも一字を贈る」.
//   who gets it   open, non-quiet gifts only; a remembrance or a quiet purpose never; a reply never gets a reply.
//
// Nothing in here is ever logged with an e-mail, a name or the story: codes and counts only.

import { createHash, randomBytes } from 'node:crypto'
import { isQuietPurpose } from '../src/order/purpose.ts'
import { emailHash, normalizeEmail, validEmail } from './customer.ts'
import { isGiftRecord, type GiftRecord } from './gift.ts'
import type { OrderStore } from './order-store.ts'
import type { OrderRecord } from './order.ts'

export const REPLY_TICKET_PATTERN = /^RT-[a-z2-9]{24}$/
export const newReplyTicketId = (random: (n: number) => Uint8Array = randomBytes): string => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (const b of random(24)) out += alphabet[b % alphabet.length]
  return `RT-${out}`
}

/** The owner's emergency off-switch. On unless it says "0", "off", "false" or "no". */
export const replyEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !['0', 'off', 'false', 'no'].includes((env.ICHIREI_REPLY_ENABLED ?? '').trim().toLowerCase())

export interface ReplyTicket {
  schema: 'reply-ticket'
  id: string
  /** The gift that was opened (the one this reply answers). */
  gift_token: string
  created_at: string
  status: 'open' | 'used'
  used_at?: string
}
export const isReplyTicket = (x: unknown): x is ReplyTicket => {
  const t = x as Partial<ReplyTicket> | null
  return !!t && t.schema === 'reply-ticket' && typeof t.id === 'string' && REPLY_TICKET_PATTERN.test(t.id) && typeof t.gift_token === 'string'
}

// ---- the pair, stored hashed -----------------------------------------------------------------------------------------------------------------------------------------

/** sha256 of the two normalised e-mails (the sender's first), with an optional server-side salt; 40 hex characters. The e-mails themselves are never stored here. */
export const pairHash = (senderEmail: string, receiverEmail: string, env: NodeJS.ProcessEnv = process.env): string =>
  createHash('sha256').update(`${(env.ICHIREI_PAIR_SALT ?? 'ichirei-pair-v1').trim()}|${normalizeEmail(senderEmail)}|${normalizeEmail(receiverEmail)}`).digest('hex').slice(0, 40)
const pairPath = (hash: string): string => `reply/pair/${hash}.json`

/** Take the pair's one gift back. false = it has been used already. */
export async function claimPair(store: OrderStore, hash: string, now: Date): Promise<boolean> {
  return store.putObject(pairPath(hash), JSON.stringify({ at: now.toISOString() }), 'application/json', { ifAbsent: true })
}
export async function pairUsed(store: OrderStore, hash: string): Promise<boolean> {
  return (await store.getObject(pairPath(hash)).catch(() => null)) !== null
}
export async function releasePair(store: OrderStore, hash: string): Promise<void> {
  await store.deleteObject?.(pairPath(hash)).catch(() => {})
}

// ---- who may send a gift back ---------------------------------------------------------------------------------------------------------------------------------------

/** The sender's e-mail of a gift: the order's own (Shopify's, once the payment was seen), else the one typed on the order page. null = there is no pair to form. */
export function senderEmailOf(order: OrderRecord | null | undefined, gift: GiftRecord): string | null {
  const o = order as (OrderRecord & { buyer_email?: string | null }) | null | undefined
  const a = o?.buyer_email
  if (typeof a === 'string' && validEmail(a)) return normalizeEmail(a)
  const b = gift.egift?.sender_email
  if (typeof b === 'string' && validEmail(b)) return normalizeEmail(b)
  return null
}

export type BackState = { state: 'available' } | { state: 'used'; char: string; page: string | null } | null

/**
 * What the receiver is offered on the last screen: `available` (one button), `used` (this gift has been answered: its character and the way to the page), or null (nothing: switched off, a remembrance,
 * a quiet purpose, a reply itself, a gift not opened yet, or no sender e-mail to make a pair with).
 */
export function backStateOf(gift: GiftRecord, order: OrderRecord | null | undefined, env: NodeJS.ProcessEnv = process.env): BackState {
  if (!replyEnabled(env)) return null
  if (gift.memorial || isQuietPurpose(gift.purpose ?? null)) return null
  if (gift.source === 'reply') return null
  if (gift.back) return { state: 'used', char: gift.back.char, page: gift.back.page ?? null }
  if (!gift.opened_at) return null
  if (!senderEmailOf(order, gift)) return null
  return { state: 'available' }
}

export const readTicket = async (store: OrderStore, id: string): Promise<ReplyTicket | null> => {
  if (!REPLY_TICKET_PATTERN.test(id)) return null
  try {
    const t = await store.get(id)
    return isReplyTicket(t) ? t : null
  } catch {
    return null
  }
}

/** A fresh ticket for an opened gift (one open ticket per gift: asking again gives the same one back). */
export async function openTicket(store: OrderStore, gift: GiftRecord, now: Date): Promise<{ ticket: ReplyTicket; created: boolean }> {
  const id = gift.reply_ticket ?? null
  const existing = id ? await readTicket(store, id) : null
  if (existing && existing.status === 'open') return { ticket: existing, created: false }
  const t: ReplyTicket = { schema: 'reply-ticket', id: newReplyTicketId(), gift_token: gift.token, created_at: now.toISOString(), status: 'open' }
  await store.put(t.id, t)
  await store.put(gift.token, { ...gift, reply_ticket: t.id })
  return { ticket: t, created: true }
}

// ---- delivery -----------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What a held reply keeps while the receiver's address waits for its inbox link: the reply gift's token and the ticket (never the address itself). */
interface Held {
  replies: { gift_token: string; ticket: string; at: string }[]
}
const heldPath = (email: string): string => `reply/held/${emailHash(email)}.json`

export async function holdReply(store: OrderStore, receiverEmail: string, entry: { gift_token: string; ticket: string; at: string }): Promise<void> {
  const p = heldPath(receiverEmail)
  const body = (cur: Buffer | null): string => {
    let h: Held = { replies: [] }
    try { h = cur ? (JSON.parse(cur.toString('utf8')) as Held) : h } catch { h = { replies: [] } }
    if (!h.replies.some((r) => r.gift_token === entry.gift_token)) h.replies.push(entry)
    return JSON.stringify(h)
  }
  if (store.casObject) await store.casObject(p, body, 'application/json')
  else await store.putObject(p, body(await store.getObject(p).catch(() => null)), 'application/json')
}
export async function takeHeld(store: OrderStore, receiverEmail: string): Promise<Held['replies']> {
  const p = heldPath(receiverEmail)
  const buf = await store.getObject(p).catch(() => null)
  if (!buf) return []
  let h: Held = { replies: [] }
  try { h = JSON.parse(buf.toString('utf8')) as Held } catch { return [] }
  await store.deleteObject?.(p).catch(() => {})
  return h.replies
}

// ---- the ticket's one card round, enforced on the server (Part 14 follow-up, 2026-11-20) ------------------------------------------------------------------------------------------------------

/** The calm busy line a refused card call gets, in the page's language — the same words the page shows whenever the service is busy (never a reason, never a status). */
export const REPLY_BUSY: Record<string, string> = {
  ja: 'ただいま混み合っています。少し待ってから、もう一度お試しください。書いたひと場面はそのまま残っています。',
  en: "We're a little busy right now. Please try again in a moment. Your moment is still here.",
  'zh-Hant': '目前有點忙碌，請稍候再試一次。你寫下的片刻都還在。',
  'zh-Hans': '目前有点忙碌，请稍候再试一次。你写下的片刻都还在。',
}

/** A card call that names a reply ticket (any `reply_ticket` or `reply` field, whatever its value) is a call that CLAIMS to be a reply. */
export const claimsReply = (body: unknown): boolean => {
  const b = body as { reply_ticket?: unknown; reply?: unknown } | null
  return !!b && typeof b === 'object' && (b.reply_ticket !== undefined || b.reply !== undefined)
}

const roundPath = (ticketId: string): string => `reply/round/${ticketId}.json`
export type ReplyRound = { ok: true; release: () => Promise<void> } | { ok: false }

/**
 * One reply ticket allows exactly ONE card round. The call is good only with a ticket that exists, is still open (not used by an order), belongs to a gift that may still be answered (opened, not a remembrance
 * or a quiet purpose, not answered yet, the switch on) — and the round is taken by a lock (`ifAbsent`) so a second round, a refill, a retry or a second tab for the same ticket is refused. `release` gives the
 * round back when the call produced no cards (the engine failed, or it only asked a follow-up question): the visitor is never left with a dead ticket for a call that gave them nothing.
 */
export async function claimReplyRound(store: OrderStore | null, raw: unknown, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<ReplyRound> {
  if (!store || typeof raw !== 'string' || !REPLY_TICKET_PATTERN.test(raw)) return { ok: false }
  if (!replyEnabled(env)) return { ok: false }
  try {
    const ticket = await readTicket(store, raw)
    if (!ticket || ticket.status !== 'open') return { ok: false }
    const gift = await store.get(ticket.gift_token)
    if (!isGiftRecord(gift)) return { ok: false }
    const order = gift.order_ref ? await store.get(gift.order_ref).catch(() => null) : null
    const state = backStateOf(gift, order && typeof order === 'object' ? (order as OrderRecord) : null, env)
    if (!state || state.state !== 'available') return { ok: false }
    const took = await store.putObject(roundPath(ticket.id), JSON.stringify({ at: now.toISOString() }), 'application/json', { ifAbsent: true })
    if (!took) return { ok: false }
    return { ok: true, release: async () => { await store.deleteObject?.(roundPath(ticket.id)).catch(() => {}) } }
  } catch {
    return { ok: false }
  }
}

export { isGiftRecord }
