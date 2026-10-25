// Approximate local prices for overseas visitors: ONE daily JPY rate table, fetched from a free source
// (no key). Display only — the checkout is always in JPY and the client never sends a price.
//
// The table is fetched lazily and kept for 24 hours (a fresh fetch is tried at server start by warm()).
// If every source fails, the last good table is kept for up to 7 days; after that — or if there never was
// one — GET /api/rates answers { rates: null } and the page simply hides the approximate-price line.

/** The currencies the page offers (JPY itself needs no rate). */
export const RATE_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'TWD', 'HKD', 'SGD', 'KRW'] as const
export type RateCurrency = (typeof RATE_CURRENCIES)[number]

export interface RateTable {
  /** The date the source gave for these rates (YYYY-MM-DD), else the fetch date. */
  date: string
  /** Units of the currency per 1 JPY. */
  rates: Record<RateCurrency, number>
}

/** Free, keyless, daily; the second URL is the same data on another host. */
export const RATE_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.json',
  'https://latest.currency-api.pages.dev/v1/currencies/jpy.json',
] as const

const FRESH_MS = 24 * 3_600_000
const STALE_OK_MS = 7 * 24 * 3_600_000
const FETCH_TIMEOUT_MS = 4_000

/** Pure: pull the table out of the source's JSON ({ date, jpy: { usd: 0.0066, … } }); null if anything is off. */
export function parseRates(body: unknown, now: Date): RateTable | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as { date?: unknown; jpy?: unknown }
  if (typeof b.jpy !== 'object' || b.jpy === null) return null
  const jpy = b.jpy as Record<string, unknown>
  const rates = {} as Record<RateCurrency, number>
  for (const c of RATE_CURRENCIES) {
    const v = jpy[c.toLowerCase()]
    // JPY is the weakest of these (1 JPY is a fraction of every unit but KRW/TWD); anything non-positive or absurd is a bad table.
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1_000) return null
    rates[c] = v
  }
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : now.toISOString().slice(0, 10)
  return { date, rates }
}

export class RateCache {
  private table: RateTable | null = null
  private fetchedAt = 0
  private inflight: Promise<void> | null = null

  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly sources: readonly string[]

  constructor(fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date(), sources: readonly string[] = RATE_SOURCES) {
    this.fetchImpl = fetchImpl
    this.now = now
    this.sources = sources
  }

  private async refresh(): Promise<void> {
    for (const url of this.sources) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } })
        if (!res.ok) continue
        const table = parseRates(await res.json(), this.now())
        if (table) {
          this.table = table
          this.fetchedAt = this.now().getTime()
          return
        }
      } catch {
        // try the next source
      }
    }
  }

  /** The current table, or null (hide the line). Never throws, never waits more than the fetch timeout. */
  async get(): Promise<RateTable | null> {
    const age = this.now().getTime() - this.fetchedAt
    if (this.table === null || age >= FRESH_MS) {
      this.inflight ??= this.refresh().finally(() => {
        this.inflight = null
      })
      await this.inflight
    }
    if (this.table !== null && this.now().getTime() - this.fetchedAt >= STALE_OK_MS) return null
    return this.table
  }

  /** Start the first fetch without waiting for it (server start). */
  warm(): void {
    void this.get()
  }
}

/** One per process. ICHIREI_RATES=off (tests, offline runs) never goes to the network: the page then hides the lines. */
export const sharedRates = new RateCache(fetch, () => new Date(), process.env.ICHIREI_RATES === 'off' ? [] : RATE_SOURCES)
