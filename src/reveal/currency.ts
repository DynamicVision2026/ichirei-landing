/// <reference lib="dom" />
// Approximate local prices (display only). The yen price is the price; checkout is always in JPY.
//
// Plain TS with no React import so Node tests can load it. The rate table comes from GET /api/rates
// (engine/rates.ts: one daily table from a free source). With no table the lines are simply hidden.

import type { RevealLang } from './copy.ts'

export const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'TWD', 'HKD', 'SGD', 'KRW'] as const
export type Currency = (typeof CURRENCIES)[number]

export const SYMBOL: Record<Currency, string> = { JPY: '¥', USD: 'US$', EUR: '€', GBP: '£', AUD: 'A$', TWD: 'NT$', HKD: 'HK$', SGD: 'S$', KRW: '₩' }

/** Units of the currency per 1 JPY, as served by /api/rates. */
export type Rates = Partial<Record<Currency, number>>

/** What a visitor sees first: yen for Japan, NT$ for 繁中, US$ for English (they can change it). */
export const DEFAULT_CURRENCY: Record<RevealLang, Currency> = { ja: 'JPY', 'zh-Hant': 'TWD', en: 'USD' }

const isCurrency = (v: unknown): v is Currency => typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v)

/** Rounded, readable: TWD to 10, KRW to 1,000, the rest to whole units. Null when there is no rate for it. */
export function formatApprox(yen: number, currency: Currency, rates: Rates | null): string | null {
  if (currency === 'JPY') return null
  const rate = rates?.[currency]
  if (typeof rate !== 'number' || !(rate > 0)) return null
  const step = currency === 'KRW' ? 1000 : currency === 'TWD' ? 10 : 1
  return SYMBOL[currency] + (Math.round((yen * rate) / step) * step).toLocaleString('en-US')
}

/** The line next to a yen price, always marked as approximate: "≈ US$65 approx." / "目安 NT$2,060" / "約 NT$2,060". Null = show nothing. */
export function approxLine(yen: number, currency: Currency, rates: Rates | null, lang: RevealLang): string | null {
  const amount = formatApprox(yen, currency, rates)
  if (amount === null) return null
  if (lang === 'en' && currency === 'USD') return `about ${amount.replace('US$', '$')}` // English (2026-11-12): "about $27", to the whole dollar
  return lang === 'ja' ? `目安 ${amount}` : lang === 'zh-Hant' ? `約 ${amount}` : `≈ ${amount} approx.`
}

/** The short form for the hero line: "(≈ US$65)". */
export function approxShort(yen: number, currency: Currency, rates: Rates | null, lang: RevealLang): string | null {
  const amount = formatApprox(yen, currency, rates)
  if (amount === null) return null
  if (lang === 'en' && currency === 'USD') return `(about ${amount.replace('US$', '$')})`
  return lang === 'ja' ? `(目安 ${amount})` : lang === 'zh-Hant' ? `(約 ${amount})` : `(≈ ${amount})`
}

/** Pure: the rates in a /api/rates body, or null. */
export function ratesFromBody(body: unknown): Rates | null {
  if (typeof body !== 'object' || body === null) return null
  const r = (body as { rates?: unknown }).rates
  if (typeof r !== 'object' || r === null) return null
  const out: Rates = {}
  for (const c of CURRENCIES) {
    const v = (r as Record<string, unknown>)[c]
    if (c !== 'JPY' && typeof v === 'number' && Number.isFinite(v) && v > 0) out[c] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

// ---- a tiny external store: the rate table and the visitor's currency choice -----------------------------------

const KEY = 'ichirei.currency'
let rates: Rates | null = null
let chosen: Currency | null = null
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export const subscribeCurrency = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getRates = (): Rates | null => rates
export function getChosenCurrency(): Currency | null {
  if (chosen === null && typeof window !== 'undefined') {
    try {
      const v = window.localStorage.getItem(KEY)
      if (isCurrency(v)) chosen = v
    } catch {
      // private window: not remembered
    }
  }
  return chosen
}
export function setCurrency(c: Currency): void {
  chosen = c
  try {
    window.localStorage.setItem(KEY, c)
  } catch {
    // not remembered
  }
  emit()
}

/** Fetch the table once per page load. Any failure leaves it null (the lines stay hidden). */
export async function loadRates(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const res = await fetch('/api/rates')
    if (!res.ok) return
    rates = ratesFromBody(await res.json())
    if (rates) emit()
  } catch {
    // no rates, no lines
  }
}
