import { useSyncExternalStore } from 'react'
import type { UiLanguage } from './demo/i18n.ts'
import { getLanguage, setLanguage, subscribeLanguage } from './lang-store'

/** [language, setLanguage] shared by the landing page and /demo. */
export function useLanguage(): [UiLanguage, (l: UiLanguage) => void] {
  const lang = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'ja' as UiLanguage)
  return [lang, setLanguage]
}
