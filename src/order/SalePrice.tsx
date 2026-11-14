// The price with the Thanksgiving sale drawn beside it (see sale.ts): the old price struck through, then the sale price; and the one line of words. Nothing here sets a price —
// Shopify's automatic discount does; this only shows it. With no sale it is exactly the plain price as before.

import { formatYen } from './packages.ts'
import { saleLine, salePriceJpy, type Sale } from './sale.ts'
import { usd, usdLaunchLine, type UsdPrice } from './usd.ts'

export function PriceWithSale({ yen, sale, id }: { yen: number; sale: Sale | null; id: string }) {
  if (!sale) return <>{formatYen(yen)}</>
  return (
    <>
      <s className="priceOld" data-price-old={id}>{formatYen(yen)}</s> <b className="priceSale" data-price-sale={id}>{formatYen(salePriceJpy(yen, sale.percent))}</b>
    </>
  )
}

export function SaleLine({ sale, lang }: { sale: Sale | null; lang: 'ja' | 'zh-Hant' | 'en' }) {
  if (!sale) return null
  return <span className="saleLine sent" data-testid="sale-line">{saleLine(sale, lang)}</span>
}

/**
 * The English page's price: `$25`; while the sale is on ONLY the sale price (`$17.50`) — never the regular price before it, struck or plain (the English version has never been sold at
 * $25: FTC 16 CFR 233.1). The launch line goes under it (UsdLaunchLine).
 */
export function UsdPriceView({ price, sale, id }: { price: UsdPrice; sale: Sale | null; id: string }) {
  if (!sale) return <>{usd(price.egift)}</>
  return <b className="priceSale" data-price-sale={id}>{usd(price.egift_sale)}</b>
}

/** "Thanksgiving launch price, through November 30. $25 from December 1." — only while the sale is on. */
export function UsdLaunchLine({ price, sale }: { price: UsdPrice; sale: Sale | null }) {
  if (!sale) return null
  return <span className="saleLine sent" data-testid="sale-line">{usdLaunchLine(price, sale.until)}</span>
}
