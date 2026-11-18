// "My ICHIREI" (2026-11-18): the customer's own page. What /basket and /b/<token> hold beyond the saved gifts: the customer's email (masked — never in full), the free-gift hold, and the gifts
// already sent (the orders on this customer's record). Everything here is behind the same door as the basket: only a browser that saved into it or opened its private link sees any of it —
// an email alone never does. Nothing here calls a model, and nothing here is ever put in a log line.

import { listBasket, mayOpen, type BasketSummary } from './basket.ts'
import { customerIdOf, readCustomer, type CustomerRecord } from './customer.ts'
import { holdOfBrowser } from './promo-holds.ts'
import { isOrderRecord } from './buyer.ts'
import type { OrderStore } from './order-store.ts'

/** b•••@gmail.com — the first letter of the name and the whole domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${[...email.slice(0, at)][0]}•••${email.slice(at)}`
}

export type SentStatus = 'paid' | 'collected' | 'opened'
export interface SentGift {
  kanji: string
  reading: string
  word: string
  receiver: string
  at: string
  status: SentStatus
  /** The sender's own page of this gift (/a/<id>), when it has one. */
  page: string | null
}

const MAX_SENT = 20

/** The gifts this customer has ordered (newest first): the character, the receiver, the date, where it stands, and the sender's page of it. */
export async function sentGifts(store: OrderStore, rec: CustomerRecord): Promise<SentGift[]> {
  const refs = [...new Set(rec.events.filter((e) => (e.code === 'ordered_paid' || e.code === 'ordered_free') && e.ref).map((e) => e.ref as string))].reverse().slice(0, MAX_SENT)
  const out: SentGift[] = []
  for (const ref of refs) {
    try {
      const o = await store.get(ref)
      if (!isOrderRecord(o) || o.ops?.cancelled_at) continue
      const opened = rec.events.some((e) => e.code === 'opened' && e.ref === ref)
      out.push({
        kanji: o.production.kanji,
        reading: o.production.reading ?? '',
        word: o.production.meaning ?? '',
        receiver: o.production.receiver_name ?? '',
        at: o.created_at,
        status: opened ? 'opened' : o.collected_at ? 'collected' : 'paid',
        page: o.animation_id ? `/a/${o.animation_id}` : null,
      })
    } catch {
      // an order that cannot be read is simply not listed
    }
  }
  return out
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
  const [list, hold, sent] = await Promise.all([listBasket(store, browser), holdOfBrowser(store, browser, now), email ? sentGifts(store, rec) : Promise.resolve([] as SentGift[])])
  const live = hold && (hold.view.state === 'active' || hold.view.state === 'checkout') ? hold.view : null
  return { items: list.items, token: list.token, email: email ? maskEmail(email) : null, hold: live ? { expires_at: live.expires_at, minutes_left: live.minutes_left } : null, sent, saved_days: 30 }
}
