// The e-card the saved film and the share film end on (2026-11-07), drawn in plain pixels from the same numbers as the page (src/order/film-card.ts): a paper card
// (antique paper, 3 px corners, a soft shadow down and to the right; no glass, no blur) on the dark frame, with the character, its reading, a short gold rule and the poem —
// and, in the film the buyer keeps, the "who they are" line and a small seal; in the share film the relationship line above the character and nothing else.
// 短歌 and 俳句 are set vertically (one line per column, read right to left, never wrapped inside a line); tang, ci and en are horizontal and centred. Nothing here calls a model.

import sharp from 'sharp'
import { CARD_COLOURS, CARD_PAPER, CARD_RADIUS_PX_1080, CARD_RISE_U, CARD_WIDTH, CARD_ASPECT, POEM_U, cardLayout, isVerticalPoemType, type CardVariant } from '../../src/order/film-card.ts'
import { INK, QUIET, U, VIDEO_H, VIDEO_W, blend, lineLayer, textBlock, type Colours, type Layer } from './film-draw.ts'
import { verticalCells } from './card.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, textWidth, wrapText } from './text.ts'

export const CARD_W = Math.round(VIDEO_W * CARD_WIDTH)
export const CARD_H = Math.round(CARD_W * CARD_ASPECT)
export const CARD_X = Math.round((VIDEO_W - CARD_W) / 2)
export const CARD_Y = Math.round((VIDEO_H - CARD_H) / 2)
export const RISE_PX = Math.round(CARD_RISE_U * U)

export interface EndCardInput {
  language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'
  glyph: string
  reading: string
  who?: string
  /** English bridge (film variant only): the word under the reading and the line in the "who" slot. Absent = the card as it was. */
  word?: string | null
  line?: string | null
  poem: string[]
  poemType?: string
  quiet: boolean
  /** the share film's relationship line (null / absent = none) */
  relation?: string | null
}

/** What is on the card at one moment (the page's FrameState.card, or the share film's own timing): everything 0 → 1; `poem` has one number per poem line. */
export interface CardState {
  opacity: number
  rise: number
  reading: number
  rule: number
  who: number
  poem: number[]
  seal: number
}

export interface EndCard {
  /** the poem lines as drawn (cleaned), for the tests */
  poemLines: string[]
  vertical: boolean
  /** the pieces' frame positions (for the tests) */
  poemBox: { x: number; y: number; w: number; h: number }
  /** the poem's text size in px (at least 4.4% of the frame's width) */
  poemSize: number
  draw: (frame: Buffer, st: CardState, extra?: { fade?: number }) => void
}

const svgLayer = async (svg: string, w: number, h: number, x: number, y: number): Promise<Layer> => {
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: png.data, w: png.info.width, h: png.info.height, x: Math.round(x), y: Math.round(y) }
}

/** The paper and its shadow, as one layer a little larger than the card. */
async function paperLayer(): Promise<Layer> {
  const pad = 64
  const w = CARD_W + 2 * pad
  const h = CARD_H + 2 * pad
  const r = (CARD_RADIUS_PX_1080 * VIDEO_W) / 1080
  const svg =
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CARD_PAPER[0]}"/><stop offset="1" stop-color="${CARD_PAPER[1]}"/></linearGradient>` +
    `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter>` +
    `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="11"/><feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.18  0 0 0 0.07 0"/></filter>` +
    `<clipPath id="c"><rect x="${pad}" y="${pad}" width="${CARD_W}" height="${CARD_H}" rx="${r}"/></clipPath></defs>` +
    `<rect x="${pad + 14}" y="${pad + 24}" width="${CARD_W}" height="${CARD_H}" rx="${r}" fill="#000" opacity="0.42" filter="url(#b)"/>` +
    `<rect x="${pad}" y="${pad}" width="${CARD_W}" height="${CARD_H}" rx="${r}" fill="url(#g)"/>` +
    `<g clip-path="url(#c)"><rect x="${pad}" y="${pad}" width="${CARD_W}" height="${CARD_H}" filter="url(#n)"/></g>`
  return svgLayer(svg, w, h, CARD_X - pad, CARD_Y - pad)
}

export async function makeEndCard(a: EndCardInput, variant: CardVariant): Promise<EndCard> {
  const bridge = variant === 'film' && a.language === 'en' && !!a.word
  const L = cardLayout(variant, bridge)
  const f = fontsFor(a.language)
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const en = a.language === 'en'
  const colour = a.quiet ? CARD_COLOURS.ink : CARD_COLOURS.cinnabar
  const textColours: Colours = { ...(a.quiet ? QUIET : INK), ivory: CARD_COLOURS.text, gold: CARD_COLOURS.quote }
  const cy = (frac: number) => CARD_Y + frac * CARD_H
  const poem = a.poem.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

  const paper = await paperLayer()

  // the character
  const cs = L.charSize * CARD_W
  const kanjiSvg = textPaths(hero, a.glyph, cs, cs * 0.6, cs * 0.99, colour, 'middle', f.stroke).svg
  const kw = Math.ceil(cs * 1.2)
  const kanji = await svgLayer(kanjiSvg, kw, kw, VIDEO_W / 2 - kw / 2, cy(L.charY) - kw / 2)

  // the relationship line (share film) above the character
  const relation = variant === 'share' && a.relation && L.relationY !== null ? await textBlock(body, a.relation, (en ? 5.2 : 4.8) * U, (en ? 5.2 : 4.8) * U * 1.6, CARD_W * 0.84, CARD_X + CARD_W * 0.08, cy(L.relationY) - (en ? 5.2 : 4.8) * U * 0.8, { ...textColours, ivory: CARD_COLOURS.reading }, { centre: true, width: CARD_W * 0.84 }) : null

  // the reading, spaced (a long reading is kept inside the card by narrowing the space)
  const readSize = 3.1 * U
  let spacing = 0.3 * readSize
  const chars = Array.from(a.reading)
  const natural = chars.reduce((s, ch) => s + textWidth(body, ch, readSize), 0)
  const maxW = CARD_W * 0.84
  if (natural + spacing * (chars.length - 1) > maxW) spacing = Math.max(0, (maxW - natural) / Math.max(1, chars.length - 1))
  const reading = await lineLayer(body, a.reading, readSize, VIDEO_W / 2, cy(L.readingY) - readSize * 0.8, CARD_COLOURS.reading, spacing)

  // the word (English bridge): bold, under the reading
  let word: Layer | null = null
  if (bridge && L.wordY !== null && a.word) {
    const wordSize = 5.2 * U
    word = await lineLayer(body, a.word, wordSize, VIDEO_W / 2, cy(L.wordY) - wordSize * 0.8, CARD_COLOURS.text, 0.02 * wordSize, wordSize * 0.035)
  }

  // the short gold rule
  const ruleW = Math.round(CARD_W * 0.14)
  const rule = await svgLayer(`<rect x="0" y="0" width="${ruleW}" height="3" fill="${CARD_COLOURS.rule}"/>`, ruleW, 3, VIDEO_W / 2 - ruleW / 2, cy(L.ruleY))

  // the "who they are" line (the film the buyer keeps only)
  const whoSize = (en ? 3.7 : 3.4) * U
  const who: Layer[] = []
  let whoBottom = cy(L.whoTop ?? L.ruleY)
  const whoText = bridge ? a.line : a.who
  if (L.whoTop !== null && whoText) {
    let y = cy(L.whoTop)
    for (const p of whoText.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const b = await textBlock(body, p, whoSize, whoSize * (en ? 1.5 : 1.7), CARD_W * 0.8, CARD_X + CARD_W * 0.1, y, textColours, { centre: true })
      who.push(b)
      y += b.h - whoSize * 0.4
    }
    whoBottom = y
  }

  // the poem: at least 4.4% of the frame's width; vertical for 短歌 and 俳句 (one line per column, right to left), horizontal and centred for the rest
  const poemSize = POEM_U * U
  const vertical = isVerticalPoemType(a.poemType)
  /** one group of layers per poem line (a long horizontal line may take two rows); a group fades in as one */
  const poemLayers: Layer[][] = []
  let poemTop = Math.max(cy(L.poemTop), whoBottom + 0.02 * CARD_H)
  let box = { x: CARD_X, y: poemTop, w: 0, h: 0 }
  if (poem.length > 0 && vertical) {
    const colGap = poemSize * 1.75
    const first = verticalCells(poem, VIDEO_W / 2, poemTop, poemSize)
    const maxBottom = cy(0.95)
    if (poemTop + first.height > maxBottom) poemTop = Math.max(cy(L.poemTop) - 0.03 * CARD_H, maxBottom - first.height)
    const lay = verticalCells(poem, VIDEO_W / 2, poemTop, poemSize)
    // one layer per line (column): the cells of line i are those whose x is that column's x
    const colXs = poem.map((_, i) => VIDEO_W / 2 + (Math.max(0, poem.length - 1) * colGap) / 2 - i * colGap)
    for (let i = 0; i < poem.length; i++) {
      const own = lay.cells.filter((c) => Math.abs(c.x - colXs[i]) < 0.5)
      const lw = Math.ceil(poemSize * 1.8)
      const lh = Math.ceil(lay.height + poemSize)
      const ox = colXs[i] - lw / 2
      let svg = ''
      for (const cell of own) {
        const x = cell.x - ox
        const y = cell.y - poemTop
        if (cell.rotate) svg += `<g transform="rotate(90 ${x} ${y + poemSize / 2})">${textPaths(body, cell.ch, poemSize, x, y + poemSize / 2 + poemSize * 0.38, CARD_COLOURS.text, 'middle').svg}</g>`
        else if (cell.offset) svg += textPaths(body, cell.ch, poemSize, x + poemSize * 0.5, y + poemSize * 0.42, CARD_COLOURS.text, 'middle').svg
        else svg += textPaths(body, cell.ch, poemSize, x, y + poemSize * 0.88, CARD_COLOURS.text, 'middle').svg
      }
      poemLayers.push([await svgLayer(svg, lw, lh, ox, poemTop)])
    }
    box = { x: Math.round(VIDEO_W / 2 - lay.width / 2 - poemSize / 2), y: Math.round(poemTop), w: Math.round(lay.width + poemSize), h: Math.round(lay.height) }
  } else if (poem.length > 0) {
    const maxW = CARD_W * 0.84
    const wrapped = poem.map((l) => (en ? wrapText(body, l, poemSize, maxW) : [l]))
    const total = wrapped.reduce((s, w) => s + w.length, 0)
    const lineH = Math.min(poemSize * (en ? 1.7 : 1.85), ((cy(0.95) - poemTop) / Math.max(1, total)))
    const gap = Math.max(poemSize * 1.3, lineH)
    const need = total * gap
    if (poemTop + need > cy(0.95)) poemTop = Math.max(cy(L.poemTop) - 0.04 * CARD_H, cy(0.95) - need)
    let y = poemTop
    for (const w of wrapped) {
      const group: Layer[] = []
      for (const row of w) {
        group.push(await textBlock(body, row, poemSize, gap, maxW, CARD_X + (CARD_W - maxW) / 2, y, { ...textColours, ivory: CARD_COLOURS.text }, { centre: true, width: maxW }))
        y += gap
      }
      poemLayers.push(group)
    }
    box = { x: Math.round(CARD_X + (CARD_W - maxW) / 2), y: Math.round(poemTop), w: Math.round(maxW), h: Math.round(y - poemTop) }
  }

  // the seal in the bottom-right corner (the film the buyer keeps only): an outline in cinnabar (ink when quiet) with 一字礼 set in a column
  let seal: Layer | null = null
  if (L.seal) {
    const box = Math.round(L.seal.size * CARD_W)
    const sc = colour
    const sealFont = box * 0.26
    const pitch = sealFont * 1.08
    let svg = `<rect x="2" y="2" width="${box - 4}" height="${box - 4}" fill="none" stroke="${sc}" stroke-width="2.5"/>`
    ;['一', '字', '礼'].forEach((ch, i) => { svg += textPaths(hero, ch, sealFont, box / 2, box / 2 + sealFont * 0.36 + (i - 1) * pitch, sc, 'middle', f.stroke).svg })
    seal = await svgLayer(svg, box, box, CARD_X + CARD_W - L.seal.margin * CARD_W - box, CARD_Y + CARD_H - L.seal.margin * CARD_W - box)
  }

  return {
    poemLines: poem,
    vertical,
    poemBox: box,
    poemSize,
    draw(frame, st, extra) {
      void extra
      if (st.opacity <= 0.003) return
      const dy = Math.round((1 - st.rise) * RISE_PX)
      blend(frame, paper, st.opacity, 1, dy)
      blend(frame, kanji, st.opacity, 1, dy)
      if (relation) blend(frame, relation, st.opacity, 1, dy)
      blend(frame, reading, st.opacity * st.reading, 1, dy)
      if (word) blend(frame, word, st.opacity * st.reading, 1, dy)
      blend(frame, rule, st.opacity * st.rule, 1, dy)
      for (const b of who) blend(frame, b, st.opacity * st.who, 1, dy)
      poemLayers.forEach((group, i) => group.forEach((b) => blend(frame, b, st.opacity * (st.poem[i] ?? 0), 1, dy)))
      if (seal) blend(frame, seal, st.opacity * st.seal, 1, dy)
    },
  }
}

/** Fade the whole frame towards black (k = 0 → none, 1 → black). */
export function toBlack(frame: Buffer, k: number): void {
  if (k <= 0.003) return
  const m = 1 - Math.min(1, k)
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = frame[i] * m
    frame[i + 1] = frame[i + 1] * m
    frame[i + 2] = frame[i + 2] * m
  }
}
