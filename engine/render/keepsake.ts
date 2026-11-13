// "Save the card" on the English receiver page (ticket 2026-11-12, C2): a square image (1080 × 1080) of the character with its reading, its word and its line under it — the same stack as every English
// surface. No names, no story, nothing else. The reading is slanted (the embedded Japanese serif has no italic) and the word is thickened with a stroke (it has no bold).

import sharp from 'sharp'
import { EN_LINE_MAX_WORDS, type EnBridge } from '../../src/order/en-bridge.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, wrapText } from './text.ts'

export const KEEPSAKE_SIZE = 1080
const PAPER = '#EFE6D2'
const INK = '#2A221B'
const MUTED = '#6B5F4E'
const CINNABAR = '#C0392B'

export interface KeepsakeArtwork {
  glyph: string
  /** Latin reading (italic). */
  reading: string
  bridge: EnBridge
  /** No red: remembrance, an apology, an encouragement. */
  quiet: boolean
}

export async function makeKeepsakeCard(a: KeepsakeArtwork): Promise<Buffer> {
  const f = fontsFor('en')
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const colour = a.quiet ? INK : CINNABAR
  const W = KEEPSAKE_SIZE
  let svg = ''
  const cs = 400
  svg += textPaths(hero, a.glyph, cs, W / 2, 80 + cs * 0.82, colour, 'middle', f.stroke).svg
  let y = 80 + cs + 70
  // the reading, slanted
  const read = textPaths(body, a.reading, 54, W / 2, y, MUTED, 'middle')
  svg += `<g transform="translate(${W / 2} ${y}) skewX(-12) translate(${-W / 2} ${-y})">${read.svg}</g>`
  y += 92
  // the word, heavier
  svg += textPaths(body, a.bridge.word, 84, W / 2, y, INK, 'middle', 1.6).svg
  y += 72
  // the line, wrapped
  const size = 40
  const lines = wrapText(body, a.bridge.line, size, 860).slice(0, 3)
  lines.forEach((l, i) => {
    svg += textPaths(body, l, size, W / 2, y + i * size * 1.5, INK, 'middle').svg
  })
  svg += textPaths(body, 'ICHIREI 一字礼', 26, W / 2, W - 52, MUTED, 'middle').svg
  return sharp({ create: { width: W, height: W, channels: 3, background: PAPER } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** The line is capped at this many words by the engine; the card shows at most three wrapped lines of it. */
export const KEEPSAKE_LINE_WORDS = EN_LINE_MAX_WORDS
