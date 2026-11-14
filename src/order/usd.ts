// The English page's price (2026-11-14, owner decision): a fixed dollar price, not a converted "about" figure. Checkout itself stays in yen (Shopify), and one small line above the order button
// says so. Display only — Shopify's variant price and its discount set what is charged.
//
//   USD_PRICE_EGIFT        whole dollars, e.g. 25            Cloud Build substitution _USD_PRICE_EGIFT (the owner edits it)
//   USD_PRICE_EGIFT_SALE   whole dollars, e.g. 17            Cloud Build substitution _USD_PRICE_EGIFT_SALE (shown while the Thanksgiving sale is on; empty = the sale percent applied to the price, rounded down)
//
// Plain TS with no React import so Node tests and the server can load it.

export interface UsdPrice {
  /** The e-gift's price in whole dollars. */
  egift: number
  /** The sale price in whole dollars (shown struck-through → this, while the sale is on). */
  egift_sale: number
}

export const DEFAULT_USD_PRICE: UsdPrice = { egift: 25, egift_sale: 17 }

const wholeDollars = (raw: string | undefined | null): number | null => {
  const t = (raw ?? '').trim().replace(/^\$/, '')
  if (!/^\d{1,4}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 ? n : null
}

/** The dollar prices from the settings: a missing or unreadable one falls back ($25; the sale price = the sale percent off, rounded down, else $17). */
export function parseUsdPrice(priceRaw: string | undefined | null, saleRaw: string | undefined | null, salePercent: number | null = null): UsdPrice {
  const egift = wholeDollars(priceRaw) ?? DEFAULT_USD_PRICE.egift
  const given = wholeDollars(saleRaw)
  const fromPercent = salePercent !== null ? Math.floor((egift * (100 - salePercent)) / 100) : null
  return { egift, egift_sale: given ?? fromPercent ?? DEFAULT_USD_PRICE.egift_sale }
}

export const usd = (n: number): string => `$${n}`

/** The one small line above the English order button — the only place yen appears on the English pages (the legal notice excepted): checkout is in yen. */
export const yenCheckoutLine = (yenText: string): string => `Checkout is processed in Japanese yen (${yenText}); your card shows the converted amount.`
