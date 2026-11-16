// The buyer's own world in a film's four pictures, per language (2026-11-13 for English as "the Western world"; 2026-11-16 for every language). The text lives in
// engine/film-world.<lang>.md — en (contemporary US / Europe), ja (contemporary Japan), zh (contemporary Taiwan / Hong Kong / mainland China; used for zh-Hant and zh-Hans). The writing
// rules live in prompts, never in code: this file only reads them and puts each piece in its place. Every language has the same six sections.
//
// The shared prompt files name all three worlds in one clause ("ja → …; zh-Hant / zh-Hans → …; en → …"). A built prompt replaces that whole clause with ITS language's world, so no prompt
// for one language carries another language's world.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type WorldPiece = 'image world' | 'check setting' | 'script setting' | 'script scenes' | 'rewrite setting' | 'retry setting'
export type WorldLang = 'en' | 'ja' | 'zh'
export const WORLD_PIECES: readonly WorldPiece[] = ['image world', 'check setting', 'script setting', 'script scenes', 'rewrite setting', 'retry setting']

/** The world file a film language reads: en, ja, or zh (zh-Hant and zh-Hans). Anything else reads nothing (the caller leaves its prompt as it is). */
export const worldLang = (language: string | null | undefined): WorldLang | null =>
  language === 'en' ? 'en' : language === 'ja' ? 'ja' : language === 'zh-Hant' || language === 'zh-Hans' || language === 'zh' ? 'zh' : null

const cache = new Map<WorldLang, Map<string, string>>()

function load(lang: WorldLang): Map<string, string> {
  const hit = cache.get(lang)
  if (hit) return hit
  const here = dirname(fileURLToPath(import.meta.url))
  const file = `film-world.${lang}.md`
  let raw = ''
  for (const p of [process.env.ICHIREI_FILM_WORLD_DIR ? join(process.env.ICHIREI_FILM_WORLD_DIR, file) : '', join(here, file), join(process.cwd(), 'engine', file)]) {
    if (!p) continue
    try {
      raw = readFileSync(p, 'utf8')
      break
    } catch {
      // next
    }
  }
  if (!raw) throw new Error(`${file} not found`)
  const out = new Map<string, string>()
  for (const block of raw.split(/^## /m).slice(1)) {
    const nl = block.indexOf('\n')
    out.set(block.slice(0, nl).trim(), block.slice(nl + 1).trim())
  }
  cache.set(lang, out)
  return out
}

/** One section of one language's world. */
export function world(lang: WorldLang, piece: WorldPiece): string {
  const t = load(lang).get(piece)
  if (!t) throw new Error(`film-world.${lang}.md has no "${piece}" section`)
  return t
}

/** English only, kept for the callers and tests that named it: the Western world (= world('en', piece)). */
export const western = (piece: WorldPiece): string => world('en', piece)

/** The clause each shared prompt file holds for the three worlds at once; a built prompt swaps it for its own language's world. */
export const OLD_SCRIPT_SETTING =
  'ja → a modern Japanese home and town; zh-Hant / zh-Hans → a modern Taiwanese, Hong Kong or Chinese home and street (never Japanese houses, paper lanterns, tatami, shoji or torii); en → a neutral modern home.'
export const OLD_CHECK_SETTING =
  'ja → a modern Japanese home and town. zh-Hant or zh-Hans → a modern Taiwanese, Hong Kong or Chinese home and street (no Japanese houses, paper lanterns, tatami or torii). en → a neutral modern home.'
export const OLD_REWRITE_SETTING = '(ja → modern Japanese; zh-Hant / zh-Hans → modern Taiwanese, Hong Kong or Chinese; en → neutral modern)'

/** Swap `from` for `to` in a built prompt (it must be there: a prompt that lost its clause would silently stop saying it). */
export function swapOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`a prompt no longer holds "${from}"`)
  return text.replace(from, () => to)
}
