// "My ICHIREI" (2026-11-18): the customer's own page. What /basket and /b/<token> hold beyond the saved gifts: the customer's email (masked — never in full), the free-gift hold, and the gifts
// already sent (the orders on this customer's record). Everything here is behind the same door as the basket: only a browser that saved into it or opened its private link sees any of it —
// an email alone never does. Nothing here calls a model, and nothing here is ever put in a log line.

import { listBasket, mayOpen, type BasketSummary } from './basket.ts'
import { customerIdOf, readCustomer, type CustomerRecord } from './customer.ts'
import { holdOfBrowser } from './promo-holds.ts'
import { isOrderRecord } from './buyer.ts'
import { windowOf } from './change-window.ts'
import { isGiftRecord } from './gift.ts'
import { returnWord } from '../src/order/return-chars.ts'
import type { OrderStore } from './order-store.ts'

/** b•••@gmail.com — the first letter of the name and the whole domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${[...email.slice(0, at)][0]}•••${email.slice(at)}`
}

export type SentStatus = 'paid' | 'collected' | 'opened'
/**
 * Where a paid gift stands (Part 7, 2026-11-20): not collected yet · collected but not sent · sent and scheduled for later · sent and not opened yet · opened · answered.
 * `sent` is the sender's own first use of a copy-link or share button on their page (recorded once); `answered` is the receiver's send-back.
 */
export type GiftStage = 'to_collect' | 'to_send' | 'scheduled' | 'unopened' | 'opened' | 'answered'
export interface SentGift {
  kanji: string
  reading: string
  word: string
  receiver: string
  /** The paid date (the time Shopify gave for the payment when it was seen, else the order's own time). */
  at: string
  status: SentStatus
  /** The group on the dashboard: still to be sent, or sent. */
  group: 'unsent' | 'sent'
  stage: GiftStage
  /** The cancel deadline while it can still be cancelled (the 24 hours are open and the gift is not collected); else null. */
  change_until: string | null
  /** When it opens (a scheduled gift) and the zone it was picked in; when it was opened. */
  opens_at: string | null
  opens_tz: string | null
  opened_at: string | null
  /** The character the receiver sent back, and its word in the gift's language. */
  answer: { char: string; word: string; /** the gift sent back (Part 14): its receiver page, opened in the new ceremony */ page?: string } | null
  /** The sender's own page of this gift (/a/<id>), when it has one. */
  page: string | null
}

const MAX_SENT = 30

/** The gifts this customer has ordered (newest first): the character, the receiver, the paid date, where it stands, and the sender's page of it. */
export async function sentGifts(store: OrderStore, rec: CustomerRecord, now: Date = new Date()): Promise<SentGift[]> {
  const refs = [...new Set(rec.events.filter((e) => (e.code === 'ordered_paid' || e.code === 'ordered_free') && e.ref).map((e) => e.ref as string))].reverse().slice(0, MAX_SENT)
  const out: SentGift[] = []
  for (const ref of refs) {
    try {
      const o = await store.get(ref)
      if (!isOrderRecord(o) || o.ops?.cancelled_at) continue
      const g = o.gift_token ? await store.get(o.gift_token).catch(() => null) : null
      const gift = isGiftRecord(g) ? g : null
      const openedAt = gift?.opened_at ?? rec.events.find((e) => e.code === 'opened' && e.ref === ref)?.at ?? null
      const answeredAt = gift?.answered_at ?? rec.events.find((e) => e.code === 'answered' && e.ref === ref)?.at ?? null
      const sentAt = gift?.shared_at ?? rec.events.find((e) => e.code === 'sent' && e.ref === ref)?.at ?? null
      const opensAt = gift?.opens_at ?? null
      const collected = !!o.collected_at
      const isSent = !!(sentAt || openedAt || answeredAt)
      const stage: GiftStage = answeredAt ? 'answered' : openedAt ? 'opened' : isSent ? (opensAt && Date.parse(opensAt) > now.getTime() ? 'scheduled' : 'unopened') : collected ? 'to_send' : 'to_collect'
      const win = collected ? null : windowOf(o, 'unverified', now)
      const lang = (gift?.language ?? o.production.language) as 'ja' | 'zh-Hant' | 'zh-Hans' | 'en'
      const char = gift?.reply?.char ?? ''
      out.push({
        kanji: o.production.kanji,
        reading: o.production.reading ?? '',
        word: o.production.meaning ?? '',
        receiver: o.production.receiver_name ?? '',
        at: o.paid_at_seen ?? o.created_at,
        status: openedAt ? 'opened' : collected ? 'collected' : 'paid',
        group: isSent ? 'sent' : 'unsent',
        stage,
        change_until: win && win.phase === 'open' ? win.ends_at : null,
        opens_at: opensAt,
        opens_tz: gift?.opens_tz ?? null,
        opened_at: openedAt,
        answer: answeredAt && char ? { char, word: gift?.reply?.gift ? '' : returnWord(char, lang), ...(gift?.reply?.gift ? { page: `/g/${gift.reply.gift}` } : {}) } : null,
        page: gift?.reply?.gift && answeredAt ? `/g/${gift.reply.gift}` : o.animation_id ? `/a/${o.animation_id}` : null,
      })
    } catch {
      // an order that cannot be read is simply not listed
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

export interface MyPage {
  items: BasketSummary[]
  token: string | null
  /** The customer's email, masked (null while none is known). */
  email: string | null
  /** An active free-gift hold: when it ends. */
  hold: { expires_at: string; minutes_left: number } | null
  sent: SentGift[]
  saved_days: number
}

/** The whole page of this browser. Empty (and nothing else) for a browser that is not allowed in. */
export async function myPage(store: OrderStore | null, browser: string, now: Date = new Date()): Promise<MyPage> {
  const empty: MyPage = { items: [], token: null, email: null, hold: null, sent: [], saved_days: 30 }
  if (!store) return empty
  const rec = await readCustomer(store, await customerIdOf(store, browser))
  if (!rec || !mayOpen(rec, browser)) return empty
  const email = rec.emails.length > 0 ? rec.emails[rec.emails.length - 1] : null
  // the gifts already sent are listed for a record that has an email (the orders on it are the ones that email made); without one the page has no such section
  const [list, hold, sent] = await Promise.all([listBasket(store, browser), holdOfBrowser(store, browser, now), email ? sentGifts(store, rec, now) : Promise.resolve([] as SentGift[])])
  const live = hold && (hold.view.state === 'active' || hold.view.state === 'checkout') ? hold.view : null
  return { items: list.items, token: list.token, email: email ? maskEmail(email) : null, hold: live ? { expires_at: live.expires_at, minutes_left: live.minutes_left } : null, sent, saved_days: 30 }
}
