// The card image (Ticket 10, 2026-11-26): GET /api/gift/<RG-id>/card.png — the REVEALED card as the receiver's page shows it after opening, as one portrait picture (1080 × 1350): the character in cinnabar
// with the poem written small inside its strokes, the heading ("In Brian's eyes, you are"), the English word (Japanese: the reading), the card line, and the ICHIREI / 一字礼 marks, on the ceremony's washi.
// It is made from the gift's own record, never from the receiver's browser: fetching it is not opening the gift. Text is drawn as outlines from our own fonts (no system fonts on Cloud Run).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { GiftRecord } from '../gift.ts'
import { isQuietPurpose } from '../../src/order/purpose.ts'
import { cardHeading, cardLang } from '../../src/order/card-copy.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, textWidth, wrapText } from './text.ts'

export const CARD_IMAGE_W = 1080
export const CARD_IMAGE_H = 1350
/** Bumped when the design changes: pictures made before are made again. */
export const CARD_IMAGE_DESIGN = 'reveal1'

const PAPER = '#F3EFE5'
const INK = '#151311'
const SOFT = '#3B362F'
const MUTE = '#5C564D'
const RED = '#C0392B'
const REDFILL = '#BE3526'
const CREAM = '#FFF4E6'

export interface CardFacts {
  language: string
  glyph: string
  heading: string
  /** Under the heading: the English word (en), the reading (ja), nothing (zh). */
  under: string
  /** The exact line printed on the card (the receiver's line when the gift has one, else the sender's line). */
  line: string
  /** The poem written inside the character (the poem's lines; else the line; else the character). */
  poem: string[]
  /** A remembrance, an apology or an encouragement: no cinnabar. */
  quiet: boolean
}

type GiftForCard = Pick<GiftRecord, 'language' | 'glyph' | 'reading' | 'who' | 'from' | 'poem' | 'en' | 'meaning_en' | 'memorial' | 'purpose' | 'source'>

/** What the receiver's reveal prints for this gift — the same choices as src/gift/ceremony/NewCeremony.tsx (the heading, the word under the character, the line). */
export function cardFacts(g: GiftForCard): CardFacts {
  const lang = cardLang(g.language)
  const from = g.source === 'sample' ? '' : (g.from ?? '').trim()
  const lineYou = lang === 'en' ? g.en?.line_you?.trim() || null : (g.who ?? '').trim() || null
  const framed = lang === 'en' && g.en?.frame === 'you_are'
  const oldLine = (g.en?.line ?? g.who ?? '').trim()
  const under = lang === 'en' ? (g.en?.word ?? g.meaning_en ?? '').trim() : lang === 'ja' ? (g.reading ?? '').split(' / ')[0].trim() : ''
  const line = lineYou ?? oldLine
  const lines = (g.poem?.lines ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return {
    language: g.language,
    glyph: g.glyph,
    heading: cardHeading(g.language, from, !!(lineYou || framed)),
    under,
    line,
    poem: lines.length ? lines : [(g.en?.line ?? g.who ?? '').trim() || g.glyph],
    quiet: g.memorial === true || isQuietPurpose(g.purpose ?? null),
  }
}

/** The exact line printed on the card. */
export const cardLine = (g: GiftForCard): string => cardFacts(g).line

/** The object name of the stored picture: it changes with anything the picture shows (and with the design). */
export const cardKey = (token: string, f: CardFacts): string =>
  `card/${token}.${createHash('sha1').update([CARD_IMAGE_DESIGN, f.language, f.glyph, f.heading, f.under, f.line, f.poem.join('\n'), f.quiet ? 1 : 0].join('|')).digest('hex').slice(0, 8)}.png`

let paper: Buffer | null | undefined
/** The ceremony's own washi texture when the built site is there (dist or public); otherwise flat paper. */
function paperTexture(): Buffer | null {
  if (paper !== undefined) return paper
  paper = null
  for (const p of [join(process.cwd(), 'dist', 'img', 'ceremony', 'paper.jpg'), join(process.cwd(), 'public', 'img', 'ceremony', 'paper.jpg')]) {
    if (existsSync(p)) {
      try {
        paper = readFileSync(p)
        break
      } catch {
        paper = null
      }
    }
  }
  return paper
}
export async function paperBackground(w: number, h: number): Promise<Buffer> {
  const tex = paperTexture()
  const base = sharp({ create: { width: w, height: h, channels: 3, background: PAPER } })
  if (!tex) return base.png().toBuffer()
  const bg = await sharp(tex).resize(w, h, { fit: 'cover', position: 'centre' }).toBuffer()
  return sharp(bg).png().toBuffer()
}

/** Letter-spaced text (the wordmark, the heading): centred or from the left edge. */
export function spaced(font: Parameters<typeof textWidth>[0], text: string, size: number, x: number, baseline: number, fill: string, tracking: number, anchor: 'middle' | 'start' = 'middle', stroke = 0): string {
  const chars = Array.from(text)
  const widths = chars.map((c) => textWidth(font, c, size))
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1)
  let pen = anchor === 'middle' ? x - total / 2 : x
  let svg = ''
  chars.forEach((c, i) => {
    if (c !== ' ') svg += textPaths(font, c, size, pen, baseline, fill, 'start', stroke).svg
    pen += widths[i] + tracking
  })
  return svg
}

/** The corner marks of the ceremony: ICHIREI at the top left, 一字礼 set vertically at the top right. */
export function cornerMarks(body: Parameters<typeof textWidth>[0], jaBody: Parameters<typeof textWidth>[0], w: number, scale = 1): string {
  let svg = spaced(body, 'ICHIREI', 26 * scale, 56 * scale, 96 * scale, INK, 9 * scale, 'start')
  Array.from('一字礼').forEach((c, i) => {
    svg += textPaths(jaBody, c, 30 * scale, w - 56 * scale - 15 * scale, (100 + i * 40) * scale, INK, 'start').svg
  })
  return svg
}

export async function makeCardImage(f: CardFacts, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const W = CARD_IMAGE_W
  const H = CARD_IMAGE_H
  const fonts = fontsFor(f.language)
  const body = fontObject(fonts.body, env)
  const hero = fontObject(fonts.character, env)
  const jaBody = fontObject(fontsFor('ja').body, env)
  const en = cardLang(f.language) === 'en'
  let svg = ''

  // the character: a cinnabar shape with the poem in cream, small, inside its strokes (a quiet gift is drawn in ink)
  const box = 700
  const bx = (W - box) / 2
  const by = 165
  const size = Math.round(box * 0.97)
  const baseline = by + size * 0.85
  const glyph = textPaths(hero, f.glyph, size, W / 2, baseline, '#000', 'middle').svg
  const fs = 15
  const rowsN = Math.ceil(box / fs) + 2
  const rows = f.poem.map((l) => {
    const unit = `${l}  ·  `
    const reps = Math.max(2, Math.ceil((box + 40) / Math.max(40, textWidth(body, unit, fs))) + 1)
    return textPaths(body, unit.repeat(reps), fs, bx, 0, CREAM, 'start', 0.35).svg
  })
  const fill = f.quiet ? INK : REDFILL
  svg += `<defs><clipPath id="gc">${glyph}</clipPath>${rows.map((r, i) => `<g id="row${i}">${r}</g>`).join('')}</defs>`
  svg += `<g clip-path="url(#gc)"><rect x="${bx - 20}" y="${by - 20}" width="${box + 40}" height="${box + 60}" fill="${fill}"/>`
  for (let i = 0; i < rowsN; i++) svg += `<use href="#row${i % rows.length}" y="${(by + fs * (i + 1)).toFixed(1)}"/>`
  svg += '</g>'

  // the words under it
  let y = by + box + 96
  svg += en ? spaced(body, f.heading.toUpperCase(), 27, W / 2, y, MUTE, 3.2) : spaced(body, f.heading, 30, W / 2, y, MUTE, 1.5)
  y += 14
  if (f.under) {
    const us = en ? 84 : 52
    const fit = (s: number) => { let z = s; while (z > 30 && textWidth(body, f.under, z) > W - 160) z -= 2; return z }
    y += fit(us) + 10
    svg += textPaths(body, f.under, fit(us), W / 2, y, INK, 'middle', en ? 2.2 : 1).svg
  }
  y += f.under ? 56 : 34
  const ls = en ? 42 : 40
  const lines = wrapText(body, f.line, ls, W - 190).slice(0, 4)
  lines.forEach((l, i) => {
    svg += textPaths(body, l, ls, W / 2, y + ls + i * ls * 1.5, SOFT, 'middle').svg
  })
  svg += cornerMarks(body, jaBody, W)

  const bg = await paperBackground(W, H)
  return sharp(bg)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export { RED as CARD_RED }
