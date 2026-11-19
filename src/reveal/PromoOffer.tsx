import { useSale, useUsd } from '../demo/useSizes.ts'
import { thanksCopy } from '../loop/copy.ts'
import { promoPriceLine } from '../order/promo-price.ts'
import { writeHref } from './paths.ts'
import { twdApprox } from './currency.ts'
import { useCurrency } from './useCurrency.ts'
import { freeLine, goToFreeGiftBox, usePromoView, type PromoLang } from './promo-view.ts'

// The free gift wherever there is a button to start (2026-11-18): while the promotion runs, the e-gift section and "What they receive" lead with the free gift — how many are left, a "Hold my free
// gift" button that takes the visitor to the free-gift box in the hero and puts the cursor in its email field, and the price as one small line. Same box, same pool, same words as the hero
// (src/loop/copy.ts). en, ja and zh-Hant.

/**
 * The promotion's block: the free-gift line, the buttons and the price as one small line. `variant` "gifts" has the secondary "Write your moment →"; "receive" has only the hold button.
 * Not rendered while the promotion is off or sold out for the day (the section then shows its price and its start button, as today).
 */
export default function PromoOffer({ lang, variant, id }: { lang: PromoLang; variant: 'gifts' | 'receive'; id: string }) {
  const v = usePromoView(lang)
  const usdPrice = useUsd()
  const sale = useSale(lang)
  const { rates } = useCurrency(lang)
  const T = thanksCopy(lang)
  if (!v.on || v.soldOut) return null
  return (
    <div className="promoOffer" data-testid={`promo-offer-${id}`}>
      <p className="promoFree" data-testid={`promo-free-${id}`}>{freeLine(lang, v)}</p>
      <div className="promoBtns">
        {!v.held && (
          <button type="button" className="btn primary" data-testid={`promo-hold-${id}`} onClick={goToFreeGiftBox}>
            {T.hold}
          </button>
        )}
        {variant === 'gifts' && (
          <a className={v.held ? 'btn primary' : 'btn ghost'} href={writeHref(lang)} data-testid={`promo-write-${id}`}>
            {T.write}
          </a>
        )}
      </div>
      <p className="promoPriceSmall" data-testid={`promo-price-${id}`}>{promoPriceLine(lang, false, usdPrice, sale, twdApprox(rates))}</p>
    </div>
  )
}

/** One quiet line under a start button elsewhere on the page (the steps, the closing): the free gift and the way to hold it. Nothing while the promotion is off, sold out, or already held. */
export function PromoNote({ lang, id }: { lang: PromoLang; id: string }) {
  const v = usePromoView(lang)
  const T = thanksCopy(lang)
  if (!v.on || v.soldOut || v.held) return null
  return (
    <p className="promoNote" data-testid={`promo-note-${id}`}>
      <span>{freeLine(lang, v)}</span>{' '}
      <button type="button" className="linkBtn" onClick={goToFreeGiftBox} data-testid={`promo-note-hold-${id}`}>
        {T.hold}
      </button>
    </p>
  )
}
