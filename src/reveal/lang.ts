import type { UiLanguage } from '../demo/i18n.ts'
import type { RevealLang } from './copy.ts'

/** The page shows English, Japanese and Traditional Chinese; the engine still knows zh-Hans (used by /demo). */
export const toRevealLang = (l: UiLanguage): RevealLang => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : 'zh-Hant')
