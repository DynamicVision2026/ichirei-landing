// What the buyer's own page /a/<id> knows about the ORDER (never a price, a name, an address or the story): when it was ordered, until when it can still be changed, and — for a
// wooden gift — which of the four steps it is at. Read-only; the owner sets the step and the tracking number on /ops (api/ops.ts, POST /ops/wood).

import { comingSoonSizes, SHIPS } from '../src/order/packages.ts'
import type { WindowInfo } from './change-window.ts'
import type { OrderOps, OrderRecord } from './order.ts'

export const WOOD_STEPS = ['received', 'making', 'shipped', 'delivered'] as const
export type WoodStep = (typeof WOOD_STEPS)[number]

/** The step the owner chose, or — when none was chosen — the one the printed / shipped marks imply. */
export function woodStepOf(ops: OrderOps | undefined | null): WoodStep {
  if (ops?.wood_step && (WOOD_STEPS as readonly string[]).includes(ops.wood_step)) return ops.wood_step
  return ops?.shipped_at ? 'shipped' : ops?.printed_at ? 'making' : 'received'
}

/** Letters, digits and hyphens, up to 40: a parcel number. Anything else is refused (it is shown on a page and put in a link-free line). */
export const TRACKING_PATTERN = /^[A-Za-z0-9-]{4,40}$/

export interface BuyerOrderView {
  /** When the payment went through (else when the order was made); an ISO time the page shows in the buyer's own time zone. */
  ordered_at: string | null
  /** The end of the 24-hour change window while it is open, else null (after it, or when the order is not paid / cancelled, the page shows no such line). */
  change_until: string | null
  /** The wooden gift's status (a wooden gift sent by link, whose receiver types the address, counts as "to them directly"), or null: e-gift orders, wooden sizes that are "coming soon", cancelled and unpaid orders have none. step is 1..4. */
  wood: { step: 1 | 2 | 3 | 4; tracking_no: string | null; ship_to: 'me' | 'direct' } | null
}

export function buyerOrderView(rec: OrderRecord | null, win: WindowInfo, env: NodeJS.ProcessEnv = process.env): BuyerOrderView {
  if (!rec) return { ordered_at: null, change_until: null, wood: null }
  const pkg = rec.production.package
  const alive = win.phase === 'open' || win.phase === 'closed'
  const wooden = !!SHIPS[pkg] && !comingSoonSizes(env.ICHIREI_WOOD_SIZES).includes(pkg)
  const step = woodStepOf(rec.ops)
  const ship = rec.production.ship_to ?? 'me'
  return {
    ordered_at: win.paid_at ?? rec.created_at,
    change_until: win.phase === 'open' ? win.ends_at : null,
    wood: wooden && alive && ship !== 'none'
      ? { step: (WOOD_STEPS.indexOf(step) + 1) as 1 | 2 | 3 | 4, tracking_no: step === 'shipped' || step === 'delivered' ? (rec.ops?.tracking_no ?? null) : null, ship_to: ship === 'me' ? 'me' : 'direct' }
      : null,
  }
}

/** A stored order record (and not a film, a gift or an index line): what the page may read from it. */
export function isOrderRecord(x: unknown): x is OrderRecord {
  const r = x as Partial<OrderRecord> | null
  return !!r && r.schema === 1 && typeof r.order_ref === 'string' && typeof r.created_at === 'string' && !!r.production && typeof r.production === 'object'
}
