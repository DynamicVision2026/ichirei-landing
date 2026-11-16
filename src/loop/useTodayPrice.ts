import { useSale, useUsd } from '../demo/useSizes.ts'
import { usd } from '../order/usd.ts'
import { PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import { salePriceJpy } from '../order/sale.ts'

/** The e-gift price a customer pays today: en "$17.50" while the sale runs, else "$25"; ja the yen price (with the sale, if one runs). */
export function useTodayPrice(lang: string = 'en'): { text: string; sale: boolean; regular: string } {
  const price = useUsd()
  const sale = useSale(lang === 'ja' ? 'ja' : 'en')
  if (lang === 'ja') {
    const yen = PACKAGE_PRICE_JPY.egift
    return { text: formatYen(sale ? salePriceJpy(yen, sale.percent) : yen), sale: !!sale, regular: formatYen(sale ? salePriceJpy(yen, sale.percent) : yen) }
  }
  return { text: usd(sale ? price.egift_sale : price.egift), sale: !!sale, regular: usd(sale ? price.egift_sale : price.egift) }
}
