// GET /api/rates — the daily approximate JPY rates for the "≈ NT$2,060" lines of the Japanese and Traditional-Chinese pages (engine/rates.ts). The English page no longer uses it: it shows a fixed dollar price (USD_PRICE_EGIFT).
//   200 { "date": "2026-10-25", "base": "JPY", "rates": { "USD": 0.0066, … } }   or   { "rates": null } when no rate is known.
// Public data, no input; cached by the browser for an hour. Display only — nothing here touches a price.

import { sharedRates } from '../engine/rates.ts'

export async function GET(): Promise<Response> {
  const fetched = await sharedRates.get()
  const table = fetched
  return new Response(JSON.stringify(table ? { date: table.date, base: 'JPY', rates: table.rates } : { rates: null }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': table ? 'public, max-age=3600' : 'no-store' },
  })
}
