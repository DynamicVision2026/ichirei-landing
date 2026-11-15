import { THANKS } from './copy.ts'
import { localTime, usePromo } from './promo.ts'
import { useTodayPrice } from './useTodayPrice.ts'
import './loop.css'

/**
 * The line above 「Continue to payment」 on the English page while the promotion runs (2026-11-15): the hold (applied at checkout), the invitation to hold one, or that today's are all held or
 * given — with the price read from the price data. The three-holds and already-given lines show when they apply.
 */
export default function OrderLine() {
  const p = usePromo()
  const price = useTodayPrice()
  if (!p || !p.on) return null
  const left = p.left ?? 0
  let body: React.ReactNode
  if (p.hold) body = THANKS.orderHeld(localTime(p.hold.expires_at))
  else if (p.ended === 'used') body = THANKS.alreadyGiven(price.text)
  else if (p.ended === 'three_holds') body = THANKS.threeHolds(price.text)
  else if (left > 0)
    body = (
      <>
        {THANKS.orderOnUs}{' '}
        <a href="#days-of-thanks" data-testid="order-hold-link">
          {THANKS.orderHoldYours}
        </a>
      </>
    )
  else body = THANKS.orderNone(price.text, price.sale)
  return (
    <p className="orderThanks" role="status" data-testid="order-promo-line">
      {body}
    </p>
  )
}
