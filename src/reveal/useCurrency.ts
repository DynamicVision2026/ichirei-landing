import { useEffect, useSyncExternalStore } from 'react'
import type { RevealLang } from './copy.ts'
import { DEFAULT_CURRENCY, getChosenCurrency, getRates, loadRates, setCurrency, subscribeCurrency, type Currency, type Rates } from './currency.ts'

/** The visitor's display currency (their choice, else the language's default), the rate table (null = hide the lines) and a setter. */
export function useCurrency(lang: RevealLang): { currency: Currency; rates: Rates | null; setCurrency: (c: Currency) => void } {
  useEffect(() => {
    void loadRates()
  }, [])
  const chosen = useSyncExternalStore(subscribeCurrency, getChosenCurrency, () => null)
  const rates = useSyncExternalStore(subscribeCurrency, getRates, () => null)
  return { currency: chosen ?? DEFAULT_CURRENCY[lang], rates, setCurrency }
}
