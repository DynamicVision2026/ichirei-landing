// The story film as a video file (Part 5 of the 2026-10-31 ticket): MP4, 1080 × 1920, no sound, about 30 s (37.5 s for a remembrance), made from the SAME
// timeline and frame maths as the film on the page (src/animation/film.ts) — nothing new is written or drawn by a model. The frames are composed here in
// plain pixels (the four pictures with their slow push-in, each line phrase by phrase, the character revealed in ink, its reading, the "who they are" line
// and the seal) and piped to ffmpeg (H.264, yuv420p, faststart, so it plays on an iPhone and on Android and "Save Video" works).
//
// Cost: about a minute of one CPU and a few hundred MB of memory; made once per order after the pictures are final and kept in the private bucket.

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { clamp, frameAt, makeFilmTimeline, phrases } from '../../src/animation/film.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, textWidth, wrapText } from './text.ts'
import { credit, type Artwork } from './artwork.ts'

export const VIDEO_W = 1080
export const VIDEO_H = 1920
export const VIDEO_FPS = 24
const U = VIDEO_W / 100 // one hundredth of the frame's width, as on the page

interface Colours {
  frame: [number, number, number]
  ivory: string
  gold: string
  kanji: string
  muted: string
  washi: [number, number, number]
}
const INK: Colours = { frame: [26, 20, 16], ivory: '#F5EDD8', gold: '#C9A96E', kanji: '#C0392B', muted: '#A89B83', washi: [232, 222, 198] }
const QUIET: Colours = { frame: [207, 198, 177], ivory: '#1D1913', gold: '#6B5A3A', kanji: '#14110D', muted: '#4C4538', washi: [232, 222, 198] }

/** A picture-sized layer of straight-alpha RGBA pixels. */
interface Layer {
  data: Buffer
  w: number
  h: number
  x: number
  y: number
}

const QUOTE_OPEN = new Set(['「', '『', '“'])
const QUOTE_CLOSE = new Set(['」', '』', '”'])

/** One block of text (wrapped lines, quotations in gold) as a transparent layer. */
async function textBlock(font: unknown, text: string, size: number, lineHeight: number, maxWidth: number, left: number, top: number, c: Colours, opts: { centre?: boolean; width?: number } = {}): Promise<Layer> {
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
async function lineLayer(font: unknown, text: string, size: number, cx: number, top: number, fill: string, letterSpacing = 0): Promise<Layer> {
  const chars = Array.from(text)
  const widths = chars.map((ch) => textWidth(font, ch, size))
  const total = widths.reduce((a, b) => a + b, 0) + letterSpacing * (chars.length - 1)
  const w = Math.ceil(total + size)
  const h = Math.ceil(size * 1.5)
  let svg = ''
  let pen = size / 2
  chars.forEach((ch, i) => {
    svg += textPaths(font, ch, size, pen, size * 1.1, fill, 'start').svg
    pen += widths[i] + letterSpacing
  })
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: png.data, w: png.info.width, h: png.info.height, x: Math.round(cx - w / 2), y: Math.round(top) }
}

/** Blend a layer over the frame (RGBA, straight alpha → opaque frame), with an extra opacity and an optional vertical wipe (0..1 of the layer's height shown). */
function blend(dst: Buffer, L: Layer, opacity: number, wipe = 1, dy = 0): void {
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

export interface FilmVideo {
  mp4: Buffer
  seconds: number
  frames: number
  renderMs: number
}

const run = (cmd: string, args: string[]) => spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })

/** Render the film. `a.pictures` must hold the real pictures (a washi slot is drawn as plain washi). `onlyFirstSeconds` is for the tests. */
export async function makeFilmVideo(a: Artwork, opts: { fps?: number; ffmpeg?: string; seconds?: number } = {}): Promise<FilmVideo> {
  const t0 = Date.now()
  const fps = opts.fps ?? VIDEO_FPS
  const c = a.memorial ? QUIET : INK
  const f = fontsFor(a.language)
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const en = a.language === 'en'
  const tl = makeFilmTimeline(a.lines.length, a.memorial)
  const total = opts.seconds ? Math.min(tl.total, opts.seconds) : tl.total
  const frames = Math.round(total * fps)

  // the picture frame of each scene: 86% wide, from 9% down, 58% tall; the picture is prepared once, a little larger than its frame, for the push-in
  const artW = Math.round(VIDEO_W * 0.86)
  const artH = Math.round(VIDEO_H * 0.58)
  const artX = Math.round(VIDEO_W * 0.07)
  const artY = Math.round(VIDEO_H * 0.09)
  const PRE = 1.12
  const pre: { data: Buffer; w: number; h: number }[] = []
  for (let i = 0; i < a.lines.length; i++) {
    const src = a.pictures[i]
    const w = Math.round(artW * PRE)
    const h = Math.round(artH * PRE)
    const img = src ? sharp(src).resize(w, h, { fit: 'cover' }) : sharp({ create: { width: w, height: h, channels: 3, background: { r: c.washi[0], g: c.washi[1], b: c.washi[2] } } })
    pre.push({ data: await img.removeAlpha().raw().toBuffer(), w, h })
  }

  // text: the line of each scene, phrase by phrase (on the page each phrase is a block that fades in and settles 6 px)
  const lineSize = (en ? 5.3 : 4.6) * U
  const lineHeight = lineSize * (en ? 1.55 : 1.9)
  const sceneText: Layer[][] = []
  for (let i = 0; i < a.lines.length; i++) {
    const blocks: Layer[] = []
    let y = VIDEO_H * 0.72
    for (const p of phrases(a.lines[i])) {
      const L = await textBlock(body, p, lineSize, lineHeight, VIDEO_W * 0.82, VIDEO_W * 0.09, y, c)
      blocks.push(L)
      y += L.h - lineSize * 0.4
    }
    sceneText.push(blocks)
  }

  // the character, its reading, the "who" line, the seal
  const kanjiSize = 44.7 * U
  const kanjiPng = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(kanjiSize * 1.2)}" height="${Math.ceil(kanjiSize * 1.2)}">${textPaths(hero, a.glyph, kanjiSize, kanjiSize * 0.6, kanjiSize * 0.99, c.kanji, 'middle', f.stroke).svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const kanjiCentreY = VIDEO_H / 2 - VIDEO_W * 0.09
  const kanji: Layer = { data: kanjiPng.data, w: kanjiPng.info.width, h: kanjiPng.info.height, x: Math.round(VIDEO_W / 2 - kanjiPng.info.width / 2), y: Math.round(kanjiCentreY - kanjiPng.info.height / 2) }
  const reading = await lineLayer(body, en ? a.reading : a.reading, 2.9 * U, VIDEO_W / 2, VIDEO_H * 0.61, c.muted, 0.3 * 2.9 * U)
  const whoSize = (en ? 5.2 : 4.6) * U
  const whoBlocks: Layer[] = []
  {
    let y = VIDEO_H * 0.68
    for (const p of phrases(a.who)) {
      const L = await textBlock(body, p, whoSize, whoSize * (en ? 1.5 : 1.8), VIDEO_W * 0.8, VIDEO_W * 0.1, y, { ...c, gold: c.ivory }, { centre: true })
      whoBlocks.push(L)
      y += L.h - whoSize * 0.4
    }
  }
  // the seal: a gold square with 一字礼 set in a column, ICHIREI beneath, and the small picture credit
  const sealBox = 10 * U
  const sealTop = Math.round(VIDEO_H * 0.93 - sealBox - 2.4 * U - 1.6 * U)
  const sealCols: string[] = ['一', '字', '礼']
  let sealSvg = `<rect x="2" y="2" width="${sealBox - 4}" height="${sealBox - 4}" fill="none" stroke="${c.gold}" stroke-width="3"/>`
  const sealFont = 2.5 * U
  const pitch = sealFont * 1.08
  sealCols.forEach((ch, i) => { sealSvg += textPaths(hero, ch, sealFont, sealBox / 2, sealBox / 2 + sealFont * 0.36 + (i - 1) * pitch, c.gold, 'middle', f.stroke).svg })
  const sealPng = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(sealBox)}" height="${Math.ceil(sealBox)}">${sealSvg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const seal: Layer = { data: sealPng.data, w: sealPng.info.width, h: sealPng.info.height, x: Math.round(VIDEO_W / 2 - sealBox / 2), y: sealTop }
  const brand = await lineLayer(body, 'ICHIREI', 2.4 * U, VIDEO_W / 2, sealTop + sealBox + 1.2 * U, c.gold, 0.32 * 2.4 * U)
  const credits = await lineLayer(body, credit(a.language), 1.9 * U, VIDEO_W / 2, VIDEO_H * 0.965, c.muted)

  // the plain frame
  const base = Buffer.alloc(VIDEO_W * VIDEO_H * 4)
  for (let i = 0; i < base.length; i += 4) { base[i] = c.frame[0]; base[i + 1] = c.frame[1]; base[i + 2] = c.frame[2]; base[i + 3] = 255 }

  // ffmpeg writes to a file (the faststart step rewrites the file's head, which a pipe cannot do), then we read it back
  const dir = await mkdtemp(join(tmpdir(), 'ichirei-film-'))
  const file = join(dir, 'film.mp4')
  const ff = run(opts.ffmpeg ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${VIDEO_W}x${VIDEO_H}`, '-r', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file])
  let err = ''
  ff.stdout.resume()
  ff.stderr.on('data', (d: Buffer) => (err += String(d)))
  const closed = new Promise<number>((res) => ff.on('close', (code) => res(code ?? 1)))
  ff.stdin.on('error', () => {}) // a dead ffmpeg is reported by its exit code

  const frame = Buffer.alloc(base.length)
  const renderFrames = async (): Promise<void> => {
    for (let n = 0; n < frames; n++) {
      const t = n / fps
      const st = frameAt(t, tl, a.lines)
      base.copy(frame)
      for (let i = 0; i < st.scenes.length; i++) {
        const s = st.scenes[i]
        if (s.opacity <= 0.003) continue
        const p = pre[i]
        const sc = 1.02 + 0.08 * s.progress
        const shift = (-6 * 3 * s.progress) / artH
        const map = (O: number, v: number, sh: number) => clamp(O + (v - O - sh) / sc)
        const x0 = map(0.5, 0, 0), x1 = map(0.5, 1, 0), y0 = map(0.6, 0, shift), y1 = map(0.6, 1, shift)
        const left = Math.min(p.w - 8, Math.round(x0 * p.w)), top = Math.min(p.h - 8, Math.round(y0 * p.h))
        const width = Math.max(8, Math.min(p.w - left, Math.round((x1 - x0) * p.w)))
        const height = Math.max(8, Math.min(p.h - top, Math.round((y1 - y0) * p.h)))
        const cut = await sharp(p.data, { raw: { width: p.w, height: p.h, channels: 3 } }).extract({ left, top, width, height }).resize(artW, artH, { kernel: 'linear', fit: 'fill' }).ensureAlpha().raw().toBuffer()
        blend(frame, { data: cut, w: artW, h: artH, x: artX, y: artY }, s.opacity)
        sceneText[i]?.forEach((L, j) => {
          const k = s.phrases[j] ?? 0
          blend(frame, L, k * s.opacity, 1, Math.round(6 * 3 * (1 - k)))
        })
      }
      if (st.final.opacity > 0.003) {
        blend(frame, kanji, st.final.opacity, st.final.reveal)
        blend(frame, reading, st.final.opacity * st.final.reading)
        whoBlocks.forEach((L) => blend(frame, L, st.final.opacity * st.final.who))
        blend(frame, seal, st.final.opacity * st.final.seal)
        blend(frame, brand, st.final.opacity * st.final.seal * 0.8)
        blend(frame, credits, st.final.opacity * st.final.seal * 0.7)
      }
      if (!ff.stdin.write(frame)) await new Promise<void>((res) => ff.stdin.once('drain', () => res()))
    }
    ff.stdin.end()
  }
  try {
    await renderFrames()
    const code = await closed
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.slice(0, 300)}`)
    return { mp4: await readFile(file), seconds: total, frames, renderMs: Date.now() - t0 }
  } finally {
    ff.kill()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
