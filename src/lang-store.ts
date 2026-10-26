/// <reference lib="dom" />
// The sender's language (ja | zh-Hans | zh-Hant | en), shared by the landing page and /demo.
// A tiny external store (no React import, so Node tests can load it): the choice is kept in
// localStorage and can be forced with ?lang= (both win). On a first visit the language comes from the
// browser's most preferred language (navigator.languages[0]): ja* → 日本語, any zh* → 繁中 (zh-Hant),
// everything else, Korean included → English. React reads it through src/useLanguage.ts.

import type { UiLanguage } from './demo/i18n.ts'

const KEY = 'ichirei.lang'
const VALID: readonly UiLanguage[] = ['ja', 'zh-Hans', 'zh-Hant', 'en']

const isLang = (v: unknown): v is UiLanguage => typeof v === 'string' && (VALID as readonly string[]).includes(v)

/**
 * Pure: pick a language from ?lang=, the stored choice and the browser's languages (in that order).
 * `navigatorLanguages` is navigator.languages (most preferred first); its first entry decides.
 */
export function detectLanguage(input: { search?: string; stored?: string | null; navigatorLanguages?: readonly string[]; navigatorLanguage?: string }): UiLanguage {
  const fromQuery = new URLSearchParams(input.search ?? '').get('lang')
  if (isLang(fromQuery)) return fromQuery
  if (isLang(input.stored)) return input.stored
  const nav = (input.navigatorLanguages?.[0] ?? input.navigatorLanguage ?? '').toLowerCase()
  if (/^ja\b/.test(nav)) return 'ja'
  if (/^zh\b/.test(nav)) return 'zh-Hant'
  return 'en'
}

let current: UiLanguage | null = null
const listeners = new Set<() => void>()

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null // private window / blocked storage: the page still works, the choice just is not remembered
  }
}

export function getLanguage(): UiLanguage {
  if (current === null) {
    current =
      typeof window === 'undefined'
        ? 'en'
        : detectLanguage({ search: window.location.search, stored: readStored(), navigatorLanguages: window.navigator?.languages, navigatorLanguage: window.navigator?.language })
    if (typeof document !== 'undefined') document.documentElement.lang = current
  }
  return current
}

export function setLanguage(next: UiLanguage): void {
  if (!isLang(next) || next === current) return
  current = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    // not remembered; fine
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  listeners.forEach((fn) => fn())
}

export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
