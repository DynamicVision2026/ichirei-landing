// The price with the Thanksgiving sale drawn beside it (see sale.ts): the old price struck through, then the sale price; and the one line of words. Nothing here sets a price —
// Shopify's automatic discount does; this only shows it. With no sale it is exactly the plain price as before.

import { formatYen } from './packages.ts'
import { saleLine, salePriceJpy, type Sale } from './sale.ts'

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
