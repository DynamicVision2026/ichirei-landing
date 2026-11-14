// Payment SEEN (2026-11-14, audit #1). A gift is unlocked (collect, downloads, sharing, the receiver's link) only for an order whose payment was seen at least once:
// by Shopify's order-paid webhook, or by a successful read-only payment lookup. "Shopify could not be asked" is never proof of payment. The first sighting is stored
// on the order record as `paid_seen_at` (and `paid_at_seen`, the time Shopify gave for the payment, which starts the 24-hour window). Nothing here writes to Shopify.

import type { OrderRecord } from './order.ts'
import type { OrderStore } from './order-store.ts'
import type { PaymentInfo } from './shipping.ts'
import type { ShopifyOrderFacts } from './waiting.ts'

export const ORDER_REF_PATTERN = /^IC-\d{8}-[A-Z0-9]{8}$/

/** True once the payment of this order was seen (an order claimed from a waiting Shopify order was paid there: Shopify's own record showed it paid). */
export const paidSeen = (rec: OrderRecord | null | undefined): boolean => !!rec && (!!rec.paid_seen_at || !!rec.claim || !!rec.collected_at)

/** The order reference our checkout attached to a Shopify order (cart attribute or line property), or null. */
export function orderRefOfFacts(o: ShopifyOrderFacts): string | null {
  const all = [...o.attrs, ...o.lines.flatMap((l) => l.props)]
  const hit = all.find((a) => (a.key === '_order_ref' || a.key === 'order_ref') && ORDER_REF_PATTERN.test((a.value ?? '').trim()))
  return hit ? hit.value.trim() : null
}

/** Record the first sighting of a payment on the order. Returns the (possibly updated) record; a record that was seen before is returned as it is. */
export async function markPaidSeen(store: OrderStore, rec: OrderRecord, paidAt: string | null, now: Date): Promise<OrderRecord> {
  if (rec.paid_seen_at) return rec
  const next: OrderRecord = { ...rec, paid_seen_at: now.toISOString(), paid_at_seen: paidAt && Number.isFinite(Date.parse(paidAt)) ? new Date(paidAt).toISOString() : now.toISOString(), updated_at: now.toISOString() }
  try {
    await store.put(rec.order_ref, next)
  } catch {
    // the sighting is used for this request anyway; the next lookup writes it
  }
  return next
}

/** A lookup result that proves payment (Shopify says paid): record it. Anything else (unverified, not found, unpaid, cancelled) changes nothing. */
export async function notePayment(store: OrderStore | null, rec: OrderRecord, pay: PaymentInfo | null | 'unverified', now: Date): Promise<OrderRecord> {
  if (!store || rec.paid_seen_at || !pay || pay === 'unverified' || pay.state !== 'paid') return rec
  return markPaidSeen(store, rec, pay.paid_at, now)
}
