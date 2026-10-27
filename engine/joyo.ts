// 常用漢字 (the 2,136 characters of the Japanese government's 2010 list): the readability rule of spec v9.1 step 4 — for Japanese buyers the MAIN
// character must be one the receiver can read. Source: KANJIDIC2 grades 1–6 and 8 (EDRDG, CC BY-SA 4.0) via the MIT npm package `kanji-data`,
// 2,140 characters of which four variant forms (填 剥 頬 𠮟) were dropped to match the official count. Plumbing only: a lookup, no judgement.

import { readFileSync } from 'node:fs'
import { resolveSiblingPath } from './palette.ts'

let set: Set<string> | null = null

export function loadJoyo(): Set<string> {
  if (set) return set
  const path = resolveSiblingPath('joyo.txt', process.env.ICHIREI_JOYO_PATH)
  set = new Set([...readFileSync(path, 'utf8').replace(/\s+/g, '')])
  if (set.size < 2000) throw new Error(`joyo.txt looks wrong (${set.size} characters)`)
  return set
}

/** Is this character a 常用漢字? (The modern form: the one a Japanese buyer's card carries.) */
export const isJoyo = (ch: string): boolean => loadJoyo().has(ch)
