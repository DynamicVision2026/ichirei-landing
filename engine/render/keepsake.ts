// "Save the card" on the English receiver page (ticket 2026-11-12, C2): a square image (1080 × 1080) of the character with its word and its line under it — the same stack as every English
// surface. No names, no story, nothing else. English first (2026-11-15): no romanized reading; the word is large, thickened with a stroke (the embedded serif has no bold).

import sharp from 'sharp'
import QRCode from 'qrcode'
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
  /** Japanese and Chinese (2026-11-19): the page's language. The certificate then has no English: the reading small beside the character (Japanese), the names as single lines (「〈name〉へ」/「〈name〉より」), no FOR / FROM, no upper-casing. */
  lang?: 'en' | 'ja' | 'zh-Hant' | 'zh-Hans'
  toLine?: string
  fromLine?: string
}

export async function makeCertificateCard(a: CertificateArtwork): Promise<Buffer> {
  const cjk = !!a.lang && a.lang !== 'en'
  const f = fontsFor(a.lang ?? 'en')
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const up = (t: string): string => (cjk ? t : t.toUpperCase())
  const W = CERT_W
  const H = CERT_H
  const x = 120
  let svg = `<rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="${SLIP}"/><rect x="66" y="66" width="${W - 132}" height="${H - 132}" fill="none" stroke="${GOLD}" stroke-width="3"/>`
  svg += textPaths(body, up(a.number), 34, x, 170, NUMBER, 'start').svg
  const cs = 520
  svg += textPaths(hero, a.glyph, cs, x - 14, 200 + cs * 0.86, CINNABAR, 'start', f.stroke).svg
  // English first (2026-11-15): the certificate alone keeps the reading, in small type next to the character ("待 · matsu"); the English word leads, large, under it
  let y = 200 + cs + 64
  if (a.reading) {
    const small = textPaths(hero, a.glyph, 40, x, y, MUTED, 'start', f.stroke)
    svg += small.svg
    const rx = x + small.width + 14
    const read = textPaths(body, `·  ${a.reading}`, 38, rx, y, MUTED, 'start')
    svg += cjk ? read.svg : `<g transform="translate(${rx} ${y}) skewX(-12) translate(${-rx} ${-y})">${read.svg}</g>`
    y += 92
  } else y += 32
  if (a.word) {
    svg += textPaths(body, a.word, 72, x, y, INK, 'start', 1.6).svg
    y += 120
  }
  if (cjk) {
    const names = [a.toLine ?? '', a.fromLine ?? ''].filter(Boolean)
    names.forEach((n, i) => {
      svg += textPaths(body, n, 54, x, y + i * 84, INK, 'start', f.stroke ? 1.4 : 0).svg
    })
    y += names.length ? names.length * 84 + 40 : 0
  } else if (a.to) {
    svg += textPaths(body, 'FOR', 30, x, y, MUTED, 'start').svg
    svg += textPaths(body, a.to, 54, x, y + 70, INK, 'start').svg
  }
  if (!cjk && a.from) {
    const fx = a.to ? x + 420 : x
    svg += textPaths(body, 'FROM', 30, fx, y, MUTED, 'start').svg
    svg += textPaths(body, a.from, 54, fx, y + 70, INK, 'start').svg
  }
  if (!cjk && (a.to || a.from)) y += 160
  const lines = wrapText(body, a.line, 40, W - 2 * x).slice(0, 3)
  lines.forEach((l, i) => {
    const t = textPaths(body, l, 40, x, y + i * 60, INK, 'start')
    svg += cjk ? t.svg : `<g transform="translate(${x} ${y + i * 60}) skewX(-10) translate(${-x} ${-(y + i * 60)})">${t.svg}</g>`
  })
  svg += textPaths(body, up(a.place), 30, x, H - 120, MUTED, 'start').svg
  return sharp({ create: { width: W, height: H, channels: 3, background: '#F3EFE5' } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

// ---- the way back to the gift page, as an image (Part 12 / 13, 2026-11-20) -------------------------------------------------------------------------------------------
// Receivers mostly open the gift inside LINE's own browser, where saving files is unreliable. The gift page stays online for at least ten years, so the keepsake that matters is the way back to it: the QR code
// of the receiver's page (`/g/<token>`) on an Ivory slip, the character under it and 「ICHIREI 一字礼」 in small type. No moment text, no names. The last page of the whole-gift PDF is the same slip
// with one line above the character: where the film and the music are.

export const QR_SLIP_W = 1080
export const QR_SLIP_H = 1350
const IVORY = '#F7F1E3'

export interface QrSlipArtwork {
  /** The receiver's page address (the QR carries exactly this). */
  url: string
  /** The character, drawn under the code. */
  glyph: string
  lang: 'en' | 'ja' | 'zh-Hant' | 'zh-Hans'
  /** No red for a remembrance or a quiet gift. */
  quiet: boolean
  /** One line under the code (the PDF's last page: 「この贈りものの映像と音楽は、こちらから」). */
  line?: string
}

export async function makeQrSlip(a: QrSlipArtwork): Promise<Buffer> {
  const f = fontsFor(a.lang)
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const W = QR_SLIP_W
  const H = QR_SLIP_H
  const qrSize = a.line ? 620 : 700
  const qr = await QRCode.toBuffer(a.url, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: qrSize, color: { dark: INK, light: IVORY } })
  const gs = 190
  const top = a.line ? 120 : 150
  let svg = ''
  svg += `<rect x="60" y="60" width="${W - 120}" height="${H - 120}" fill="none" stroke="#B8924A" stroke-width="2"/>`
  let y = top + qrSize + 40
  if (a.line) {
    for (const l of wrapText(body, a.line, 40, W - 260).slice(0, 2)) {
      svg += textPaths(body, l, 40, W / 2, y + 40, INK, 'middle').svg
      y += 60
    }
    y += 20
  } else y += 30
  svg += textPaths(hero, a.glyph, gs, W / 2, y + gs * 0.82, a.quiet ? INK : CINNABAR, 'middle', f.stroke).svg
  svg += textPaths(body, 'ICHIREI 一字礼', 30, W / 2, H - 120, MUTED, 'middle').svg
  return sharp({ create: { width: W, height: H, channels: 3, background: IVORY } })
    .composite([
      { input: qr, left: Math.round((W - qrSize) / 2), top },
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`), left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
}
