// The Western world of an English film (2026-11-13). The text lives in engine/film-western.en.md (the writing rules live in prompts, not in code); this file only reads it and puts each piece in its place.
// Everything here is for `language === 'en'` and nothing else: for ja, zh-Hant and zh-Hans every prompt this touches is built exactly as before (the callers do not call into here).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type WesternPiece = 'image world' | 'check setting' | 'script setting' | 'script scenes' | 'rewrite setting' | 'retry setting'

let cache: Map<string, string> | null = null

function load(): Map<string, string> {
  if (cache) return cache
  const here = dirname(fileURLToPath(import.meta.url))
  let raw = ''
  for (const p of [process.env.ICHIREI_FILM_WESTERN_PATH, join(here, 'film-western.en.md'), join(process.cwd(), 'engine', 'film-western.en.md')]) {
    if (!p) continue
    try {
      raw = readFileSync(p, 'utf8')
      break
    } catch {
      // next
    }
  }
  if (!raw) throw new Error('film-western.en.md not found')
  const out = new Map<string, string>()
  for (const block of raw.split(/^## /m).slice(1)) {
    const nl = block.indexOf('\n')
    out.set(block.slice(0, nl).trim(), block.slice(nl + 1).trim())
  }
  cache = out
  return out
}

export function western(piece: WesternPiece): string {
  const t = load().get(piece)
  if (!t) throw new Error(`film-western.en.md has no "${piece}" section`)
  return t
}

/** The clause the shared prompts hold for English today; for `en` it is swapped for the Western text. */
export const OLD_SCRIPT_SETTING = 'en → a neutral modern home.'
export const OLD_CHECK_SETTING = 'en → a neutral modern home.'
export const OLD_REWRITE_SETTING = 'en → neutral modern)'

/** Swap `from` for `to` in a built prompt (it must be there: a prompt that lost its clause would silently stop saying it). */
export function swapOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`a prompt no longer holds "${from}"`)
  return text.replace(from, () => to)
}
