// The picture a link shows when it is shared (Open Graph, 1200 × 630): the ENVELOPE STAGE of today's receiver page (Ticket 10, 2026-11-26) — the ceremony's washi, ICHIREI and 一字礼 in the corners, the label
// "For Leah", the two title lines "Brian sent you / one small mark." and the small cinnabar mark with its ring. (Until 2026-11-26 it was the old sealed envelope with the gold 礼 seal and the cord.)
// NEVER the character, the poem, the line or anything else of the gift — the character is the surprise: names only. Text is drawn as outlines from our own font files (no system fonts on Cloud Run),
// the PNG is made once per gift (and again only if the names change) and kept in the private bucket; the server hands it out.

import sharp from 'sharp'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, textWidth, wrapText } from './text.ts'
import { cornerMarks, paperBackground, spaced } from './card-image.ts'
import { markCopy } from '../../src/order/card-copy.ts'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

export interface OgInput {
  to: string
  from: string
  memorial: boolean
  language: string
}

/** Shrink a line until it fits; returns the size to use. */
function fit(font: Parameters<typeof textWidth>[0], text: string, size: number, maxWidth: number): number {
  let s = size
  while (s > 20 && textWidth(font, text, s) > maxWidth) s -= 2
  return s
}

export async function makeOgImage(input: OgInput, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const f = fontsFor(input.language)
  const body = fontObject(f.body, env)
  const jaBody = fontObject(fontsFor('ja').body, env)
  const INK = '#151311'
  const SOFT = '#3B362F'
  const MUTE = '#5C564D'
  const mark = input.memorial ? INK : '#C0392B'
  const copy = markCopy(input.language, input.from, input.to)
  const en = input.language === 'en'
  const left = 92
  const maxW = 640
  let svg = ''
  let y = 222
  if (copy.label) {
    const size = fit(body, en ? copy.label.toUpperCase() : copy.label, en ? 26 : 28, maxW)
    svg += spaced(body, en ? copy.label.toUpperCase() : copy.label, size, left, y, MUTE, en ? 3.4 : 1.5, 'start')
    y += 22
  }
  for (const line of copy.title) {
    const size = fit(body, line, 62, maxW)
    y += size + 12
    svg += textPaths(body, line, size, left, y, INK, 'start', 0.5).svg
  }
  y += 34
  const bs = 25
  for (const l of wrapText(body, copy.body, bs, maxW - 40).slice(0, 3)) {
    y += bs * 1.55
    svg += textPaths(body, l, bs, left, y, SOFT, 'start').svg
  }
  // the mark: the small cinnabar square, turned 7 degrees, with its ring
  const mx = 968
  const my = 330
  svg += `<circle cx="${mx}" cy="${my}" r="74" fill="none" stroke="${mark}" stroke-opacity=".28" stroke-width="2"/>`
  svg += `<circle cx="${mx}" cy="${my}" r="46" fill="none" stroke="${mark}" stroke-width="2.5"/>`
  svg += `<rect x="${mx - 17}" y="${my - 17}" width="34" height="34" rx="4" fill="${mark}" transform="rotate(7 ${mx} ${my})"/>`
  svg += cornerMarks(body, jaBody, OG_WIDTH, 0.8)
  const bg = await paperBackground(OG_WIDTH, OG_HEIGHT)
  return sharp(bg)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * The landing page's picture for the e-gift: the same sealed washi envelope and gold seal on the dark ground as the link picture, with no name on it,
 * at the 16:10 frame of the other two size photos (1600 × 1000). Made by scripts/make-egift-image.ts into public/img/egift-hero.jpg.
 */
export async function makeEnvelopeArt(env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const W = 1600
  const H = 1000
  const hero = fontObject(fontsFor('ja').character, env)
  const ew = 880
  const eh = Math.round(ew * (427 / 640))
  const x0 = (W - ew) / 2
  const y0 = (H - eh) / 2
  const tipX = W / 2
  const tipY = y0 + eh * 0.54
  const seal = ['#e6c97e', '#c9a45c', '#8f6f2f']
  const glyph = textPaths(hero, '礼', 64, tipX, tipY + 22, '#4A3510', 'middle')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="seal" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${seal[0]}"/><stop offset=".6" stop-color="${seal[1]}"/><stop offset="1" stop-color="${seal[2]}"/></radialGradient>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#000" flood-opacity=".55"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="#1A1410"/>
<g filter="url(#shadow)"><rect x="${x0}" y="${y0}" width="${ew}" height="${eh}" rx="8" fill="#E4D8BC"/></g>
<polygon points="${x0},${y0 + eh} ${tipX},${y0 + eh * 0.46} ${x0 + ew},${y0 + eh}" fill="#D6C8A6" opacity=".55"/>
<polygon points="${x0},${y0} ${x0 + ew},${y0} ${tipX},${tipY}" fill="#D6C8A6"/>
<polyline points="${x0},${y0} ${tipX},${tipY} ${x0 + ew},${y0}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="2.5"/>
<circle cx="${tipX}" cy="${tipY}" r="66" fill="url(#seal)"/>
${glyph.svg}
</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}
