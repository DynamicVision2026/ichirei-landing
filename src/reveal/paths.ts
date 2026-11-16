// The customer site's addresses (2026-11-16): each language's landing page and its writing room — the full-screen page that holds only the flow (the choices, the moment, the characters, the
// result, the order section and checkout). Same tab always: in-app browsers often block or eject new tabs, and the hold and the saved gifts would be lost.

import type { RevealLang } from './copy.ts'
import { getLanguage } from '../lang-store.ts'
import { toRevealLang } from './lang.ts'

export const landingPath = (lang: RevealLang): string => (lang === 'en' ? '/en' : lang === 'zh-Hant' ? '/zh' : '/')
export const writePath = (lang: RevealLang): string => (lang === 'en' ? '/en/write' : lang === 'zh-Hant' ? '/zh/write' : '/write')
/** The language a writing-room address belongs to (null = not one). */
export const writeLangOf = (path: string): RevealLang | null => {
  const p = path.replace(/\/+$/, '') || '/'
  return p === '/en/write' ? 'en' : p === '/zh/write' ? 'zh-Hant' : p === '/write' ? 'ja' : null
}
/** "Write your moment" from anywhere: the writing room of the page's language, keeping the address's query (?lang, ?code, utm_…). */
export const writeHref = (lang: RevealLang): string => {
  let q = ''
  try {
    q = window.location.search
  } catch {
    // no address to read
  }
  return writePath(lang) + q
}

/** The same, for the landing's sections that know only their copy: the language is read from the page's language store. */
export const writeLink = (): string => writeHref(toRevealLang(getLanguage()))
