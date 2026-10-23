import { useLanguage } from '../useLanguage.ts'
import { LANDING_COPY, type LandingCopy } from './copy.ts'
import type { UiLanguage } from '../demo/i18n.ts'

/** The landing copy for the sender's current language, plus the language and its setter. */
export function useLanding(): { copy: LandingCopy; language: UiLanguage; setLanguage: (l: UiLanguage) => void } {
  const [language, setLanguage] = useLanguage()
  return { copy: LANDING_COPY[language], language, setLanguage }
}
