import { useSale, useUsd } from '../demo/useSizes.ts'
import { usd } from '../order/usd.ts'

/** The price a customer pays today, from the price data ("$17.50" while the sale runs, else "$25"). */
export function useTodayPrice(): { text: string; sale: boolean } {
  const price = useUsd()
  const sale = useSale('en')
  return { text: usd(sale ? price.egift_sale : price.egift), sale: !!sale }
}

