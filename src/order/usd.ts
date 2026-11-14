// The English page's price (2026-11-14, owner decision): a fixed dollar price, not a converted "about" figure. English carts are USD carts (the "ICHIREI English" Shopify market, US buyer
// identity) and Shopify's fixed price there is what is charged; this only shows it. Display only.
//
//   USD_PRICE_EGIFT        e.g. 25           Cloud Build substitution _USD_PRICE_EGIFT (dollars; cents allowed)
//   USD_PRICE_EGIFT_SALE   e.g. 17.50        Cloud Build substitution _USD_PRICE_EGIFT_SALE (shown while the Thanksgiving sale is on; empty = the sale percent off the price, rounded down to the cent)
//
// No struck-through price is ever shown on the English pages (the English version has never been sold at the full price: FTC 16 CFR 233.1): while the sale is on only the sale price shows,
// with the launch line under it.
// Plain TS with no React import so Node tests and the server can load it.

export interface UsdPrice {
  /** The e-gift's regular price in dollars (whole, or with cents). */
  egift: number
  /** The launch (sale) price in dollars. */
  egift_sale: number
}

export const DEFAULT_USD_PRICE: UsdPrice = { egift: 25, egift_sale: 17.5 }

const dollars = (raw: string | undefined | null): number | null => {
  const t = (raw ?? '').trim().replace(/^(US)?\$/i, '')
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  return cents >= 100 ? cents / 100 : null
}

/** The dollar prices from the settings: a missing or unreadable one falls back ($25; the sale price = the sale percent off, rounded down to the cent, else $17.50). */
export function parseUsdPrice(priceRaw: string | undefined | null, saleRaw: string | undefined | null, salePercent: number | null = null): UsdPrice {
  const egift = dollars(priceRaw) ?? DEFAULT_USD_PRICE.egift
  const given = dollars(saleRaw)
  const fromPercent = salePercent !== null ? Math.floor(Math.round(egift * 100) * (100 - salePercent) / 100) / 100 : null
  return { egift, egift_sale: given ?? fromPercent ?? DEFAULT_USD_PRICE.egift_sale }
}

/** `$25` for whole dollars, `$17.50` for anything else. */
export const usd = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
/** `US$25` / `US$17.50` (the legal page). */
export const usdCode = (n: number): string => `US${usd(n)}`

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "Thanksgiving launch price, through November 30. $25 from December 1." — `until` is the sale's last day (YYYY-MM-DD). */
export function usdLaunchLine(price: UsdPrice, until: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until)
  if (!m) return ''
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const next = new Date(last.getTime() + 86_400_000)
  return `Thanksgiving launch price, through ${MONTH[last.getUTCMonth()]} ${last.getUTCDate()}. ${usd(price.egift)} from ${MONTH[next.getUTCMonth()]} ${next.getUTCDate()}.`
}
