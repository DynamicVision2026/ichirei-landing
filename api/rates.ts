// GET /api/rates — the daily approximate JPY rates for the "≈ US$65" lines (engine/rates.ts).
//   200 { "date": "2026-10-25", "base": "JPY", "rates": { "USD": 0.0066, … } }   or   { "rates": null } when no rate is known.
// Public data, no input; cached by the browser for an hour. Display only — nothing here touches a price.

import { sharedRates } from '../engine/rates.ts'

export async function GET(): Promise<Response> {
  const fetched = await sharedRates.get()
  // USD_PER_JPY (config, 2026-11-12): the owner's own dollar rate for the "about $27" line on /en; it wins over the daily table. Display only.
  const usd = Number((process.env.USD_PER_JPY ?? '').trim())
  const table = Number.isFinite(usd) && usd > 0 && usd < 1 ? { date: fetched?.date ?? new Date().toISOString().slice(0, 10), rates: { ...(fetched?.rates ?? {}), USD: usd } } : fetched
  return new Response(JSON.stringify(table ? { date: table.date, base: 'JPY', rates: table.rates } : { rates: null }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': table ? 'public, max-age=3600' : 'no-store' },
  })
}
