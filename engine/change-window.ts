// The 24-hour window after payment (2026-10-30; since 2026-11-06 the ONLY thing it allows is cancelling for a full refund).
//
//   After payment nothing is changed: no other character, no poem-format change, no names or message edits (a customer who wants something different cancels
//   within 24 hours of payment and orders again). Cancelling stops when the buyer presses 「贈りものを受け取る」 on their order page (collected_at), like unwrapping a
//   present; the owner can still override that for our own mistakes. A request received in time is honoured even if the owner handles it after the 24 hours.
//   Nothing is made before the window closes: the workshop CSV and the card PDFs list only orders whose window has closed (api/ops.ts).
//   Everything here changes OUR records only (the order, the film page, the receiver's page) — never Shopify, whose order keeps what was sent at checkout.

import type { OpsLogEntry, OrderRecord } from './order.ts'
import type { OrderStore } from './order-store.ts'
import type { PaymentInfo } from './shipping.ts'

export const WINDOW_MS = 24 * 3_600_000

export type WindowPhase = 'open' | 'closed' | 'cancelled' | 'unpaid'
export interface WindowInfo {
  phase: WindowPhase
  /** When the payment went through (or, when Shopify could not be asked, when the order was made — then `verified` is false). */
  paid_at: string | null
  ends_at: string | null
  /** Whole hours left while the window is open (rounded up), else null. */
  hours_left: number | null
  verified: boolean
}

/**
 * `pay`: what Shopify said about this order — a PaymentInfo; `null` = Shopify answered but has no such order (never paid, or older than the app can see);
 * `'unverified'` = Shopify could not be asked (the order's own time is used, and the page says so).
 */
export function windowOf(rec: OrderRecord | null, pay: PaymentInfo | null | 'unverified', now: Date): WindowInfo {
  const none = (phase: WindowPhase, verified = true): WindowInfo => ({ phase, paid_at: null, ends_at: null, hours_left: null, verified })
  if (rec?.ops?.cancelled_at) return none('cancelled')
  if (pay === 'unverified') return span(rec?.created_at ?? null, now, false)
  if (pay === null) return none('unpaid')
  if (pay.state === 'cancelled' || pay.state === 'refunded') return none('cancelled')
  if (pay.state === 'unpaid') return none('unpaid')
  return span(pay.paid_at, now, true)
}

function span(paidAt: string | null, now: Date, verified: boolean): WindowInfo {
  const t = paidAt ? Date.parse(paidAt) : NaN
  if (!Number.isFinite(t)) return { phase: 'unpaid', paid_at: null, ends_at: null, hours_left: null, verified }
  const end = t + WINDOW_MS
  const open = now.getTime() < end
  return { phase: open ? 'open' : 'closed', paid_at: new Date(t).toISOString(), ends_at: new Date(end).toISOString(), hours_left: open ? Math.max(1, Math.ceil((end - now.getTime()) / 3_600_000)) : null, verified }
}

// ---- the owner's actions ------------------------------------------------------------------------------------------------------------------------------------------

export type ChangeResult = { ok: true; message: string } | { ok: false; code: string; error: string }
const refuse = (code: string, error: string): ChangeResult => ({ ok: false, code, error })

export interface ChangeDeps {
  store: OrderStore
  now: Date
  /** The user name the owner typed at /ops (the log's "who"). */
  who: string
}

const cleanWho = (s: string) => s.replace(/[^\w.@-]/g, '').slice(0, 30) || 'owner'
const logEntry = (d: ChangeDeps, action: OpsLogEntry['action'], detail: string): OpsLogEntry => ({ at: d.now.toISOString(), who: cleanWho(d.who), action, detail })

/** Flag the order cancelled: it leaves the print list and the workshop CSV. The refund is the owner's, in Shopify. */
export async function cancelOrder(d: ChangeDeps, rec: OrderRecord, opts: { override?: boolean } = {}): Promise<ChangeResult> {
  if (rec.ops?.cancelled_at) return refuse('already_cancelled', 'The order is marked cancelled already.')
  // the buyer has collected the gift: the right to cancel ended with that tap (the owner may still override, for our own mistakes)
  if (rec.collected_at && !opts.override) return refuse('collected', 'The buyer has already collected the gift: the order can no longer be cancelled.')
  rec.ops = { ...(rec.ops ?? {}), cancelled_at: d.now.toISOString(), log: [...(rec.ops?.log ?? []), logEntry(d, 'cancel', rec.collected_at ? 'flag (override after collected)' : 'flag')] }
  rec.updated_at = d.now.toISOString()
  await d.store.put(rec.order_ref, rec)
  return { ok: true, message: 'cancelled' }
}
