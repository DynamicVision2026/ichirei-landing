// The one price line under the free-gift box in the hero while the promotion runs (2026-11-17). Both prices come from the existing price config (the dollar prices of /api/sizes and the sale),
// never from the text. Plain TS with no React import so Node tests can load it.

import { usd, type UsdPrice } from './usd.ts'
import { PACKAGE_PRICE_JPY, formatYen } from './packages.ts'
import { salePriceJpy, type Sale } from './sale.ts'

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The day after the sale's last day, YYYY-MM-DD -> [month (1-12), day]; null when the date is unreadable. */
export function dayAfter(until: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 86_400_000)
  return [d.getUTCMonth() + 1, d.getUTCDate()]
}

/**
 * en: "If today's free gifts are gone: $17.50 (Thanksgiving price). $25 from December 1."  ja: 「本日の無料枠が終了した場合：感謝の季節価格 ¥2,786（12月1日から ¥3,980）」.
 * `soldOut`: the free gifts of the day are gone, so the line is the plain price line (no "if …" lead-in). Without a sale only the regular price is named.
 */
export function promoPriceLine(lang: 'en' | 'ja', soldOut: boolean, usdPrice: UsdPrice, sale: Sale | null): string {
  const next = sale ? dayAfter(sale.until) : null
  if (lang === 'en') {
    const lead = soldOut ? '' : "If today's free gifts are gone: "
    if (!sale) return `${lead}${usd(usdPrice.egift)}.`
    return `${lead}${usd(usdPrice.egift_sale)} (Thanksgiving price).${next ? ` ${usd(usdPrice.egift)} from ${MONTH[next[0] - 1]} ${next[1]}.` : ''}`
  }
  const regular = formatYen(PACKAGE_PRICE_JPY.egift)
  const lead = soldOut ? '' : '本日の無料枠が終了した場合：'
  if (!sale) return `${lead}${regular}`
  return `${lead}感謝の季節価格 ${formatYen(salePriceJpy(PACKAGE_PRICE_JPY.egift, sale.percent))}${next ? `（${next[0]}月${next[1]}日から ${regular}）` : ''}`
}
