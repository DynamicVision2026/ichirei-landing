// The drawing primitives shared by the saved film, the share film and the e-card (frame size, colours, text blocks, alpha blending). Pure pixels; no timeline here.

import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { textPaths, textWidth, wrapText } from './text.ts'

export const VIDEO_W = 1080
export const VIDEO_H = 1920
export const VIDEO_FPS = 24
export const U = VIDEO_W / 100 // one hundredth of the frame's width, as on the page

export interface Colours {
  frame: [number, number, number]
  ivory: string
  gold: string
  kanji: string
  muted: string
  washi: [number, number, number]
}
export const INK: Colours = { frame: [26, 20, 16], ivory: '#F5EDD8', gold: '#C9A96E', kanji: '#C0392B', muted: '#A89B83', washi: [232, 222, 198] }
export const QUIET: Colours = { frame: [207, 198, 177], ivory: '#1D1913', gold: '#6B5A3A', kanji: '#14110D', muted: '#4C4538', washi: [232, 222, 198] }

/** A picture-sized layer of straight-alpha RGBA pixels. */
export interface Layer {
  data: Buffer
  w: number
  h: number
  x: number
  y: number
}

const QUOTE_OPEN = new Set(['「', '『', '“'])
const QUOTE_CLOSE = new Set(['」', '』', '”'])

/** One block of text (wrapped lines, quotations in gold) as a transparent layer. */
export async function textBlock(font: unknown, text: string, size: number, lineHeight: number, maxWidth: number, left: number, top: number, c: Colours, opts: { centre?: boolean; width?: number } = {}): Promise<Layer> {
  const lines = wrapText(font, text.replace(/\n+/g, ''), size, maxWidth)
  const w = opts.width ?? maxWidth
  const h = Math.ceil(lines.length * lineHeight + size * 0.4)
  let inQuote = false
  let svg = ''
  lines.forEach((line, i) => {
    const base = i * lineHeight + size * 1.05
    const total = textWidth(font, line, size)
    let pen = opts.centre ? (w - total) / 2 : 0
    let run = ''
    let runQuote = inQuote
    const flush = () => {
      if (!run) return
      const t = textPaths(font, run, size, pen, base, runQuote ? c.gold : c.ivory, 'start')
      svg += t.svg
      pen += t.width
      run = ''
    }
    for (const ch of Array.from(line)) {
      const opens = QUOTE_OPEN.has(ch)
      if (opens) { flush(); inQuote = true; runQuote = true }
      run += ch
      if (QUOTE_CLOSE.has(ch)) { flush(); inQuote = false; runQuote = false }
      else if (!opens && runQuote !== inQuote) { runQuote = inQuote }
    }
    flush()
  })
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: png.data, w: png.info.width, h: png.info.height, x: Math.round(left), y: Math.round(top) }
}

/** One line of text, centred on `cx`, as a transparent layer. */
export async function lineLayer(font: unknown, text: string, size: number, cx: number, top: number, fill: string, letterSpacing = 0, stroke = 0): Promise<Layer> {
  const chars = Array.from(text)
  const widths = chars.map((ch) => textWidth(font, ch, size))
  const total = widths.reduce((a, b) => a + b, 0) + letterSpacing * (chars.length - 1)
  const w = Math.ceil(total + size)
  const h = Math.ceil(size * 1.5)
  let svg = ''
  let pen = size / 2
  chars.forEach((ch, i) => {
    svg += textPaths(font, ch, size, pen, size * 1.1, fill, 'start', stroke).svg
    pen += widths[i] + letterSpacing
  })
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: png.data, w: png.info.width, h: png.info.height, x: Math.round(cx - w / 2), y: Math.round(top) }
}

/** Blend a layer over the frame (RGBA, straight alpha → opaque frame), with an extra opacity and an optional vertical wipe (0..1 of the layer's height shown). */
export function blend(dst: Buffer, L: Layer, opacity: number, wipe = 1, dy = 0): void {
  if (opacity <= 0.003 || wipe <= 0) return
  const soft = Math.max(8, Math.round(L.h * 0.12))
  const edge = wipe >= 1 ? L.h + soft : wipe * (L.h + soft)
  for (let row = 0; row < L.h; row++) {
    const y = L.y + row + dy
    if (y < 0 || y >= VIDEO_H) continue
    let rowAlpha = opacity
    if (wipe < 1) {
      const d = edge - row
      if (d <= 0) break
      if (d < soft) rowAlpha *= d / soft
    }
    for (let col = 0; col < L.w; col++) {
      const x = L.x + col
      if (x < 0 || x >= VIDEO_W) continue
      const si = (row * L.w + col) * 4
      const a = (L.data[si + 3] / 255) * rowAlpha
      if (a <= 0.004) continue
      const di = (y * VIDEO_W + x) * 4
      dst[di] = dst[di] + (L.data[si] - dst[di]) * a
      dst[di + 1] = dst[di + 1] + (L.data[si + 1] - dst[di + 1]) * a
      dst[di + 2] = dst[di + 2] + (L.data[si + 2] - dst[di + 2]) * a
    }
  }
}


export const run = (cmd: string, args: string[]) => spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
