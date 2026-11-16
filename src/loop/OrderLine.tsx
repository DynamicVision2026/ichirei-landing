import { useState, type ReactNode } from 'react'
import { UsdPriceView } from '../order/SalePrice.tsx'
import { usd, type UsdPrice } from '../order/usd.ts'
import type { Sale } from '../order/sale.ts'
import { holdRefusal, thanksCopy, type ThanksLang } from './copy.ts'
import { PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import { salePriceJpy } from '../order/sale.ts'
import { localTime, requestHold, usePromo } from './promo.ts'
import { refreshMe } from './me.ts'
import { useTodayPrice } from './useTodayPrice.ts'
import './loop.css'

/**
 * Where the visitor stands, above 「Continue to payment」 on the English page while the promotion runs (2026-11-15):
 *   · a hold: "Your free gift is held for you until 12:23 PM. It's applied at checkout." (and the e-gift price reads $0 · Your free gift, the price struck through);
 *   · no hold, gifts left today: a short box — "Free today: n of today's 100 free gifts are left. Hold one with your email and this gift is $0." — with the email and Hold my free gift
 *     (the same rules as the card); after a hold the price turns to $0 without reloading;
 *   · none left today: one line; the price stays.
 * The three-holds and already-given lines show when they apply. With the promotion off nothing is shown.
 */
export default function OrderLine({ lang = 'en' }: { lang?: ThanksLang }) {
  const THANKS = thanksCopy(lang)
  const p = usePromo()
  const price = useTodayPrice(lang)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (!p || !p.on) return null
  const left = p.left ?? 0
  if (p.hold)
    return (
      <p className="orderThanks" role="status" data-testid="order-promo-line" data-state="held">
        {THANKS.orderHeld(localTime(p.hold.expires_at, lang))}
      </p>
    )
  if (p.ended === 'used')
    return (
      <p className="orderThanks" role="status" data-testid="order-promo-line" data-state="used">
        {THANKS.alreadyGiven(price.text)}
      </p>
    )
  if (p.ended === 'three_holds')
    return (
      <p className="orderThanks" role="status" data-testid="order-promo-line" data-state="three">
        {THANKS.threeHolds(price.text)}
      </p>
    )
  if (left <= 0)
    return (
      <p className="orderThanks" role="status" data-testid="order-promo-line" data-state="none">
        {THANKS.none}
      </p>
    )
  const hold = async () => {
    setBusy(true)
    setMessage(null)
    const r = await requestHold(email.trim(), false, lang)
    if (r.ok) void refreshMe()
    else setMessage(holdRefusal(r.code ?? 'unavailable', price.text, lang))
    setBusy(false)
  }
  return (
    <div className="orderFree" data-testid="order-promo-line" data-state="free">
      <p className="orderFreeLine" data-testid="order-free-line">{THANKS.orderFree(left, p.daily ?? 100)}</p>
      <div className="orderFreeForm" role="group" aria-label={THANKS.hold}>
        <label>
          {THANKS.emailLabel}
          <input
            type="email"
            name="free-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (email.trim() && !busy) void hold()
              }
            }}
            autoComplete="email"
            data-testid="order-free-email"
          />
        </label>
        <button type="button" className="btn ghost" disabled={busy || !email.trim()} onClick={() => void hold()} data-testid="order-free-hold">
          {busy ? THANKS.holding : THANKS.hold}
        </button>
      </div>
      <p className="small">{THANKS.small}</p>
      {message && (
        <p className="err" role="alert" data-testid="order-free-message">
          {message}
        </p>
      )}
    </div>
  )
}

/** The English e-gift price on the order form: today's price, or — with a hold — "$0 · Your free gift" with today's price struck through. */
export function EnEgiftPrice({ price, sale, id, promo }: { price: UsdPrice; sale: Sale | null; id: string; promo: boolean }) {
  const p = usePromo()
  const THANKS = thanksCopy('en')
  if (promo && p?.on && p.hold)
    return (
      <span className="priceFree" data-price-free={id}>
        <s data-price-struck>{usd(sale ? price.egift_sale : price.egift)}</s> <b>{THANKS.freePrice}</b> <span className="freeLabel">· {THANKS.freeLabel}</span>
      </span>
    )
  return <UsdPriceView price={price} sale={sale} id={id} />
}

/** The Japanese e-gift price (2026-11-16): with a hold, "¥0 · 無料ギフト" with the regular price struck through; otherwise `fallback` (today's price as before). */
export function JaEgiftPrice({ sale, id, promo, fallback }: { sale: Sale | null; id: string; promo: boolean; fallback: ReactNode }) {
  const p = usePromo()
  const THANKS = thanksCopy('ja')
  if (promo && p?.on && p.hold) {
    const yen = PACKAGE_PRICE_JPY.egift
    return (
      <span className="priceFree" data-price-free={id}>
        <s data-price-struck>{formatYen(sale ? salePriceJpy(yen, sale.percent) : yen)}</s> <b>{THANKS.freePrice}</b> <span className="freeLabel">· {THANKS.freeLabel}</span>
      </span>
    )
  }
  return <>{fallback}</>
}
