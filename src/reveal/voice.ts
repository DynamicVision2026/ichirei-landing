// Voice input (2026-11-05, Part 9). The browser's own speech recognition: no audio goes to our server and nothing is stored. This file holds the small pure parts.

import { storyLength } from '../demo/i18n.ts'

export type VoiceLang = 'ja-JP' | 'zh-TW' | 'zh-CN' | 'en-US'

/** The picker: the same labels on every page, whatever the page language. */
export const VOICE_LANGS: readonly { code: VoiceLang; label: string }[] = [
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-TW', label: '中文（台灣）' },
  { code: 'zh-CN', label: '中文（普通话）' },
  { code: 'en-US', label: 'English' },
]

export const voiceLangForPage = (page: string): VoiceLang => (page === 'ja' ? 'ja-JP' : page === 'zh-Hant' ? 'zh-TW' : page === 'zh-Hans' ? 'zh-CN' : 'en-US')
export const isVoiceLang = (v: unknown): v is VoiceLang => VOICE_LANGS.some((l) => l.code === v)

const KEY = 'ichirei.voiceLang'
/** The choice is remembered for the session only (a failing storage is simply no memory). */
export function loadVoiceLang(): VoiceLang | null {
  try {
    const v = window.sessionStorage.getItem(KEY)
    return isVoiceLang(v) ? v : null
  } catch {
    return null
  }
}
export function saveVoiceLang(v: VoiceLang): void {
  try {
    window.sessionStorage.setItem(KEY, v)
  } catch {
    // (no storage: the choice lasts until the page is left)
  }
}

/** Spoken text added AT the cursor (`pos` counts UTF-16 units, like selectionStart); everything typed stays. A space is put between two Latin words only. */
export function insertSpoken(current: string, spoken: string, pos: number, max: number): { text: string; cursor: number; over: boolean; full: boolean } {
  const at = Math.max(0, Math.min(pos, current.length))
  const before = current.slice(0, at)
  const after = current.slice(at)
  const needSpace = /[A-Za-z0-9,.!?]$/.test(before) && /^[A-Za-z0-9]/.test(spoken)
  const piece = `${needSpace ? ' ' : ''}${spoken}`
  const text = `${before}${piece}${after}`
  const n = storyLength(text)
  return { text, cursor: before.length + piece.length, over: n > max, full: n >= max }
}

/** After the browser ended the session: start again? Only while the button is still on and the end was not a refusal of the microphone. */
export function shouldRestart(wanted: boolean, error: string | null): boolean {
  if (!wanted) return false
  return !(error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture' || error === 'language-not-supported')
}
