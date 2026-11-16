// "Save the card" on the English receiver page (ticket 2026-11-12, C2): a square image (1080 × 1080) of the character with its word and its line under it — the same stack as every English
// surface. No names, no story, nothing else. English first (2026-11-15): no romanized reading; the word is large, thickened with a stroke (the embedded serif has no bold).

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
  /** Latin reading — kept in the record, no longer drawn on the square card (English first, 2026-11-15). */
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
  // English first (2026-11-15): the character, then the English word large, then the line — no romanized reading (only the certificate keeps it)
  let y = 80 + cs + 150
  // the word, large and heavier
  svg += textPaths(body, a.bridge.word, 96, W / 2, y, INK, 'middle', 1.8).svg
  y += 84
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

// ---- the certificate (gift ceremony redesign 2026-11-15, screen 7 "The certificate") -------------------------------------------------------------------
// The receiver's certificate as one image (1080 × 1350): the paper slip of screen 6 — the number, the character in cinnabar, its reading and word, both names,
// the certificate line, the date. Gold only on the rule. A remembrance or a quiet gift never comes here (the new ceremony is for English open gifts only).

export const CERT_W = 1080
export const CERT_H = 1350
const SLIP = '#FBF8F1'
const GOLD = '#B8924A'
const NUMBER = '#6E561C'

export interface CertificateArtwork {
  glyph: string
  reading: string
  word: string
  to: string
  from: string
  /** e.g. "This character is Kenji, as seen through Brian's eyes." */
  line: string
  /** e.g. "ICHIREI · No. 0003" */
  number: string
  /** e.g. "November 15, 2026 · Tokyo" */
  place: string
}

export async function makeCertificateCard(a: CertificateArtwork): Promise<Buffer> {
  const f = fontsFor('en')
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const W = CERT_W
  const H = CERT_H
  const x = 120
  let svg = `<rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="${SLIP}"/><rect x="66" y="66" width="${W - 132}" height="${H - 132}" fill="none" stroke="${GOLD}" stroke-width="3"/>`
  svg += textPaths(body, a.number.toUpperCase(), 34, x, 170, NUMBER, 'start').svg
  const cs = 520
  svg += textPaths(hero, a.glyph, cs, x - 14, 200 + cs * 0.86, CINNABAR, 'start', f.stroke).svg
  // English first (2026-11-15): the certificate alone keeps the reading, in small type next to the character ("待 · matsu"); the English word leads, large, under it
  let y = 200 + cs + 64
  if (a.reading) {
    const small = textPaths(hero, a.glyph, 40, x, y, MUTED, 'start', f.stroke)
    svg += small.svg
    const rx = x + small.width + 14
    const read = textPaths(body, `·  ${a.reading}`, 38, rx, y, MUTED, 'start')
    svg += `<g transform="translate(${rx} ${y}) skewX(-12) translate(${-rx} ${-y})">${read.svg}</g>`
    y += 92
  } else y += 32
  svg += textPaths(body, a.word, 72, x, y, INK, 'start', 1.6).svg
  y += 120
  if (a.to) {
    svg += textPaths(body, 'FOR', 30, x, y, MUTED, 'start').svg
    svg += textPaths(body, a.to, 54, x, y + 70, INK, 'start').svg
  }
  if (a.from) {
    const fx = a.to ? x + 420 : x
    svg += textPaths(body, 'FROM', 30, fx, y, MUTED, 'start').svg
    svg += textPaths(body, a.from, 54, fx, y + 70, INK, 'start').svg
  }
  if (a.to || a.from) y += 160
  const lines = wrapText(body, a.line, 40, W - 2 * x).slice(0, 3)
  lines.forEach((l, i) => {
    const t = textPaths(body, l, 40, x, y + i * 60, INK, 'start')
    svg += `<g transform="translate(${x} ${y + i * 60}) skewX(-10) translate(${-x} ${-(y + i * 60)})">${t.svg}</g>`
  })
  svg += textPaths(body, a.place.toUpperCase(), 30, x, H - 120, MUTED, 'start').svg
  return sharp({ create: { width: W, height: H, channels: 3, background: '#F3EFE5' } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}
