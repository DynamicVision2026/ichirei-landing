// What the buyer and the receiver post to their own social accounts (2026-11-06): a short film (MP4, 1080 × 1920) and a poem card (PNG, 1080 × 1350). They carry the relationship
// between two people through one character and NOTHING else: no logo, no seal, no brand name, no website, no hashtags, no names, no dates, no order data, no story captions, no
// picture credit and no end card. The film is: one relationship line (from the relationship chip only; none for 「その他」), the four story pictures, the character with its
// reading, the poem — and it ends on the poem. Made from the stored pictures and the stored poem: no model call.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { clamp } from '../../src/order/film-timeline.ts'
import { INK, QUIET, U, VIDEO_FPS, VIDEO_H, VIDEO_W, blend, lineLayer, run, textBlock, type Layer } from './film-video.ts'
import { isVerticalPoem, verticalCells } from './card.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, wrapText } from './text.ts'
import type { Artwork } from './artwork.ts'

/** The artwork plus the one relationship line (null = none). */
export type ShareArtwork = Artwork & { relation: string | null }

const smooth = (x: number) => x * x * (3 - 2 * x)
/** 0 → 1 over [a, b]. */
const ramp = (t: number, a: number, b: number) => smooth(clamp((t - a) / Math.max(1e-6, b - a)))
/** Opacity of something shown from `a` to `b`, fading in over `fi` and out over `fo` (fo = 0 keeps it to the end). */
const window = (t: number, a: number, b: number, fi: number, fo: number) => ramp(t, a, a + fi) * (fo > 0 ? 1 - ramp(t, b - fo, b) : 1)

export const SHARE_REL = 2.8
export const SHARE_PIC = 3.6
export const SHARE_CHAR = 4.8
export const SHARE_POEM_LINE = 0.8
export const SHARE_POEM_HOLD = 3

export function shareTimeline(pictures: number, hasRelation: boolean, poemLines: number) {
  const rel = hasRelation ? SHARE_REL : 0
  const picStart = rel
  const charStart = picStart + pictures * SHARE_PIC
  const poemStart = charStart + SHARE_CHAR
  const total = poemLines > 0 ? poemStart + poemLines * SHARE_POEM_LINE + SHARE_POEM_HOLD : charStart + SHARE_CHAR
  return { rel, picStart, charStart, poemStart, total }
}

/** Every piece of TEXT the share film and the poem card draw — and nothing else is ever drawn as text: the relationship line, the character, its reading and the poem. */
export function shareTexts(a: Pick<ShareArtwork, 'relation' | 'glyph' | 'reading' | 'poem'>): string[] {
  return [...(a.relation ? [a.relation] : []), a.glyph, a.reading, ...a.poem.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)]
}

export interface ShareFilm {
  mp4: Buffer
  seconds: number
  frames: number
  renderMs: number
}

/** Render the share film. `opts.seconds` cuts it short (tests); a washi (null) picture is drawn as plain washi. */
export async function makeShareFilm(a: ShareArtwork, opts: { fps?: number; ffmpeg?: string; seconds?: number; onFrame?: (t: number, rgba: Buffer) => void } = {}): Promise<ShareFilm> {
  const t0 = Date.now()
  const fps = opts.fps ?? VIDEO_FPS
  const c = a.quiet ? QUIET : INK
  const f = fontsFor(a.language)
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const en = a.language === 'en'
  const n = a.lines.length
  const poem = a.poem.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const tl = shareTimeline(n, !!a.relation, poem.length)
  const total = opts.seconds ? Math.min(tl.total, opts.seconds) : tl.total
  const frames = Math.round(total * fps)

  // the pictures: centred, 86% wide, slightly larger than their frame for the slow push-in
  const artW = Math.round(VIDEO_W * 0.86)
  const artH = Math.round(VIDEO_H * 0.58)
  const artX = Math.round(VIDEO_W * 0.07)
  const artY = Math.round((VIDEO_H - artH) / 2)
  const PRE = 1.12
  const pre: { data: Buffer; w: number; h: number }[] = []
  for (let i = 0; i < n; i++) {
    const src = a.pictures[i]
    const w = Math.round(artW * PRE)
    const h = Math.round(artH * PRE)
    const img = src ? sharp(src).resize(w, h, { fit: 'cover' }) : sharp({ create: { width: w, height: h, channels: 3, background: { r: c.washi[0], g: c.washi[1], b: c.washi[2] } } })
    pre.push({ data: await img.removeAlpha().raw().toBuffer(), w, h })
  }

  // the relationship line, the character, its reading and the poem lines
  const relSize = (en ? 5.6 : 5.2) * U
  const rel = a.relation ? await textBlock(body, a.relation, relSize, relSize * 1.6, VIDEO_W * 0.8, VIDEO_W * 0.1, VIDEO_H * 0.46, { ...c, gold: c.ivory }, { centre: true }) : null
  const kanjiSize = 44.7 * U
  const kanjiPng = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(kanjiSize * 1.2)}" height="${Math.ceil(kanjiSize * 1.2)}">${textPaths(hero, a.glyph, kanjiSize, kanjiSize * 0.6, kanjiSize * 0.99, c.kanji, 'middle', f.stroke).svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const kanji: Layer = { data: kanjiPng.data, w: kanjiPng.info.width, h: kanjiPng.info.height, x: Math.round(VIDEO_W / 2 - kanjiPng.info.width / 2), y: Math.round(VIDEO_H * 0.44 - kanjiPng.info.height / 2) }
  const reading = await lineLayer(body, a.reading, 2.9 * U, VIDEO_W / 2, VIDEO_H * 0.6, c.muted, 0.3 * 2.9 * U)
  const poemSize = (en ? 4.4 : 4.2) * U
  const poemGap = poemSize * (en ? 1.7 : 1.95)
  const poemLayers: Layer[] = []
  const wrapped = poem.flatMap((l) => (en ? wrapText(body, l, poemSize, VIDEO_W * 0.8) : [l]))
  const top = VIDEO_H / 2 - (wrapped.length * poemGap) / 2
  for (let i = 0; i < wrapped.length; i++) poemLayers.push(await textBlock(body, wrapped[i], poemSize, poemGap, VIDEO_W * 0.84, VIDEO_W * 0.08, top + i * poemGap, { ...c, gold: c.ivory }, { centre: true }))

  const base = Buffer.alloc(VIDEO_W * VIDEO_H * 4)
  for (let i = 0; i < base.length; i += 4) { base[i] = c.frame[0]; base[i + 1] = c.frame[1]; base[i + 2] = c.frame[2]; base[i + 3] = 255 }

  const dir = await mkdtemp(join(tmpdir(), 'ichirei-share-'))
  const file = join(dir, 'share.mp4')
  const ff = run(opts.ffmpeg ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${VIDEO_W}x${VIDEO_H}`, '-r', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file])
  let err = ''
  ff.stdout.resume()
  ff.stderr.on('data', (d: Buffer) => (err += String(d)))
  const closed = new Promise<number>((res) => ff.on('close', (code) => res(code ?? 1)))
  ff.stdin.on('error', () => {})

  const frame = Buffer.alloc(base.length)
  const renderFrames = async (): Promise<void> => {
    for (let k = 0; k < frames; k++) {
      const t = k / fps
      base.copy(frame)
      if (rel && t < tl.rel + 0.01) blend(frame, rel, window(t, 0, tl.rel, 0.9, 0.7))
      for (let i = 0; i < n; i++) {
        const s0 = tl.picStart + i * SHARE_PIC
        if (t < s0 - 0.01 || t > s0 + SHARE_PIC + 0.01) continue
        const op = window(t, s0, s0 + SHARE_PIC, 0.6, 0.6)
        if (op <= 0.003) continue
        const progress = clamp((t - s0) / SHARE_PIC)
        const p = pre[i]
        const sc = 1.02 + 0.08 * progress
        const shift = (-6 * 3 * progress) / artH
        const map = (O: number, v: number, sh: number) => clamp(O + (v - O - sh) / sc)
        const x0 = map(0.5, 0, 0), x1 = map(0.5, 1, 0), y0 = map(0.6, 0, shift), y1 = map(0.6, 1, shift)
        const left = Math.min(p.w - 8, Math.round(x0 * p.w)), topPx = Math.min(p.h - 8, Math.round(y0 * p.h))
        const width = Math.max(8, Math.min(p.w - left, Math.round((x1 - x0) * p.w)))
        const height = Math.max(8, Math.min(p.h - topPx, Math.round((y1 - y0) * p.h)))
        const cut = await sharp(p.data, { raw: { width: p.w, height: p.h, channels: 3 } }).extract({ left, top: topPx, width, height }).resize(artW, artH, { kernel: 'linear', fit: 'fill' }).ensureAlpha().raw().toBuffer()
        blend(frame, { data: cut, w: artW, h: artH, x: artX, y: artY }, op)
      }
      // the character and its reading (the character is revealed from the top, like the personal film); they leave before the poem when there is one
      if (t >= tl.charStart - 0.01) {
        const hold = poem.length > 0 ? window(t, tl.charStart, tl.poemStart, 0.4, 0.7) : window(t, tl.charStart, tl.charStart + SHARE_CHAR, 0.4, 0)
        if (hold > 0.003) {
          blend(frame, kanji, hold, ramp(t, tl.charStart, tl.charStart + 1.8))
          blend(frame, reading, hold * ramp(t, tl.charStart + 1.3, tl.charStart + 2.2))
        }
      }
      // the poem, line by line; it stays to the end (the film ends on the poem)
      if (poem.length > 0 && t >= tl.poemStart - 0.01) {
        const per = wrapped.length / Math.max(1, poem.length)
        poemLayers.forEach((L, i) => blend(frame, L, ramp(t, tl.poemStart + (i / per) * SHARE_POEM_LINE, tl.poemStart + (i / per) * SHARE_POEM_LINE + 0.9)))
      }
      opts.onFrame?.(t, frame)
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

// ---- the poem card (PNG, 1080 × 1350) -------------------------------------------------------------------------------------------------------------------

export const CARD_W = 1080
export const CARD_H = 1350
const PAPER = '#EFE6D2'
const MUTED = '#6B5A3A'
const INK_TEXT = '#2A221B'
const CINNABAR = '#C0392B'

/** The poem card: the relationship line, the character and its reading, the poem (vertical for 短歌 and 俳句, centred lines for the others). Nothing else. */
export async function makeShareCard(a: ShareArtwork): Promise<Buffer> {
  const f = fontsFor(a.language)
  const body = fontObject(f.body)
  const hero = fontObject(f.character)
  const colour = a.quiet ? INK_TEXT : CINNABAR
  let svg = ''
  if (a.relation) svg += textPaths(body, a.relation, 46, CARD_W / 2, 130, MUTED, 'middle').svg
  const cs = 400
  svg += textPaths(hero, a.glyph, cs, CARD_W / 2, 230 + cs * 0.82, colour, 'middle', f.stroke).svg
  svg += textPaths(body, a.reading, 54, CARD_W / 2, 700, MUTED, 'middle').svg
  const poem = a.poem.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (poem.length > 0) {
    if (isVerticalPoem(a.poemType)) {
      const size = 50
      const { cells } = verticalCells(poem, CARD_W / 2, 790, size)
      for (const cell of cells) {
        if (cell.rotate) svg += `<g transform="rotate(90 ${cell.x} ${cell.y + size / 2})">${textPaths(body, cell.ch, size, cell.x, cell.y + size / 2 + size * 0.38, INK_TEXT, 'middle').svg}</g>`
        else if (cell.offset) svg += textPaths(body, cell.ch, size, cell.x + size * 0.5, cell.y + size * 0.42, INK_TEXT, 'middle').svg
        else svg += textPaths(body, cell.ch, size, cell.x, cell.y + size * 0.88, INK_TEXT, 'middle').svg
      }
    } else {
      const size = a.language === 'en' ? 46 : 48
      const lines = poem.flatMap((l) => (a.language === 'en' ? wrapText(body, l, size, 900) : wrapText(body, l, size, 920)))
      const gap = size * (a.language === 'en' ? 1.65 : 1.8)
      lines.forEach((l, i) => { svg += textPaths(body, l, size, CARD_W / 2, 830 + i * gap, INK_TEXT, 'middle').svg })
    }
  }
  return sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: PAPER } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

