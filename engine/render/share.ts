// What the buyer and the receiver post to their own social accounts (2026-11-06): a short film (MP4, 1080 × 1920) and a poem card (PNG, 1080 × 1350). They carry the relationship
// between two people through one character and NOTHING else: no logo, no seal, no brand name, no website, no hashtags, no names, no dates, no order data, no story captions, no
// picture credit and no end card. The film is: one relationship line (from the relationship chip only; none for 「その他」), the four story pictures, the character with its
// reading, the poem — and it ends on the poem. Made from the stored pictures and the stored poem: no model call.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { clamp } from '../../src/order/film-timeline.ts'
import { INK, QUIET, U, VIDEO_FPS, VIDEO_H, VIDEO_W, blend, lineLayer, run, textBlock, type Layer } from './film-draw.ts'
import { makeEndCard, toBlack, type CardState } from './endcard.ts'
import { audioPlan, moodOf } from './film-audio.ts'
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
/** The dark character section: the character revealed on the dark frame, leaving as the card comes. */
export const SHARE_CHAR = 4.0
export const SHARE_CARD_FADE = 0.8
/** The card's parts, from the moment it starts to come: the reading, the rule, then the poem line by line over SHARE_POEM_SPAN seconds. */
export const SHARE_CARD_READING = 0.9
export const SHARE_CARD_RULE = 1.5
export const SHARE_POEM_FROM = 2.1
export const SHARE_POEM_SPAN = 4.5
/** The finished card holds still this long before the end (the last second of it fades to black). */
export const SHARE_HOLD = 5
export const SHARE_FADE_OUT = 1

export function shareTimeline(pictures: number, hasRelation: boolean, poemLines: number) {
  const rel = hasRelation ? SHARE_REL : 0
  const picStart = rel
  const charStart = picStart + pictures * SHARE_PIC
  /** the card starts to settle just before the character has left */
  const cardStart = charStart + SHARE_CHAR - 0.2
  const poemStart = cardStart + SHARE_POEM_FROM
  const done = poemStart + SHARE_POEM_SPAN
  const total = Math.round((done + SHARE_HOLD) * 1000) / 1000
  void poemLines
  return { rel, picStart, charStart, cardStart, poemStart, done, total }
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
  /** which track runs under it (null = made without sound) */
  music: 'warm' | 'quiet' | null
}

/** Render the share film. `opts.seconds` cuts it short (tests); a washi (null) picture is drawn as plain washi. */
export async function makeShareFilm(a: ShareArtwork, opts: { fps?: number; ffmpeg?: string; seconds?: number; music?: boolean; onFrame?: (t: number, rgba: Buffer) => void } = {}): Promise<ShareFilm> {
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

  // the relationship line (first screen), the character and its reading (dark section), and the e-card
  const relSize = (en ? 5.6 : 5.2) * U
  const rel = a.relation ? await textBlock(body, a.relation, relSize, relSize * 1.6, VIDEO_W * 0.8, VIDEO_W * 0.1, VIDEO_H * 0.46, { ...c, gold: c.ivory }, { centre: true }) : null
  const kanjiSize = 44.7 * U
  const kanjiPng = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(kanjiSize * 1.2)}" height="${Math.ceil(kanjiSize * 1.2)}">${textPaths(hero, a.glyph, kanjiSize, kanjiSize * 0.6, kanjiSize * 0.99, c.kanji, 'middle', f.stroke).svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const kanji: Layer = { data: kanjiPng.data, w: kanjiPng.info.width, h: kanjiPng.info.height, x: Math.round(VIDEO_W / 2 - kanjiPng.info.width / 2), y: Math.round(VIDEO_H * 0.44 - kanjiPng.info.height / 2) }
  const reading = await lineLayer(body, a.reading, 2.9 * U, VIDEO_W / 2, VIDEO_H * 0.6, c.muted, 0.3 * 2.9 * U)
  const card = await makeEndCard({ language: a.language, glyph: a.glyph, reading: a.reading, poem: a.poem, poemType: a.poemType, quiet: a.quiet, relation: a.relation }, 'share')

  const plain = (rgb: [number, number, number]): Buffer => {
    const b = Buffer.alloc(VIDEO_W * VIDEO_H * 4)
    for (let i = 0; i < b.length; i += 4) { b[i] = rgb[0]; b[i + 1] = rgb[1]; b[i + 2] = rgb[2]; b[i + 3] = 255 }
    return b
  }
  const base = plain(c.frame)
  // the e-card always sits on the dark ink frame: a quiet film's light frame darkens as the card comes
  const darkBase = a.quiet ? plain(INK.frame) : base

  const dir = await mkdtemp(join(tmpdir(), 'ichirei-share-'))
  const file = join(dir, 'share.mp4')
  const audio = opts.music === false ? null : audioPlan(moodOf(a.quiet), total)
  const ff = run(opts.ffmpeg ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${VIDEO_W}x${VIDEO_H}`, '-r', String(fps), '-i', 'pipe:0', ...(audio ? audio.inputs : []), ...(audio ? audio.maps : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', ...(audio ? audio.codec : []), '-movflags', '+faststart', file])
  let err = ''
  ff.stdout.resume()
  ff.stderr.on('data', (d: Buffer) => (err += String(d)))
  const closed = new Promise<number>((res) => ff.on('close', (code) => res(code ?? 1)))
  ff.stdin.on('error', () => {})

  const frame = Buffer.alloc(base.length)
  const renderFrames = async (): Promise<void> => {
    for (let k = 0; k < frames; k++) {
      const t = k / fps
      // a quiet film's light frame turns dark ink over the card's coming
      const dark = a.quiet ? ramp(t, tl.cardStart - 0.6, tl.cardStart + 0.2) : 0
      if (dark <= 0.003) base.copy(frame)
      else if (dark >= 0.997) darkBase.copy(frame)
      else {
        const r = Math.round(c.frame[0] + (INK.frame[0] - c.frame[0]) * dark), g = Math.round(c.frame[1] + (INK.frame[1] - c.frame[1]) * dark), b = Math.round(c.frame[2] + (INK.frame[2] - c.frame[2]) * dark)
        for (let i = 0; i < frame.length; i += 4) { frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; frame[i + 3] = 255 }
      }
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
      // the character and its reading on the dark frame (revealed from the top, like the personal film); they leave as the card comes
      if (t >= tl.charStart - 0.01 && t <= tl.charStart + SHARE_CHAR + 0.01) {
        const hold = window(t, tl.charStart, tl.charStart + SHARE_CHAR, 0.4, 0.6)
        if (hold > 0.003) {
          blend(frame, kanji, hold, ramp(t, tl.charStart, tl.charStart + 1.8))
          blend(frame, reading, hold * ramp(t, tl.charStart + 1.3, tl.charStart + 2.2))
        }
      }
      // the e-card: the paper, the relationship line and the character settle together; then the reading, the rule and the poem line by line; it holds still, then the last second fades to black
      if (t >= tl.cardStart - 0.01) {
        const n = card.poemLines.length
        const lineFade = 0.9
        const step = n > 1 ? (SHARE_POEM_SPAN - lineFade) / (n - 1) : 0
        const st: CardState = {
          opacity: ramp(t, tl.cardStart, tl.cardStart + SHARE_CARD_FADE),
          rise: ramp(t, tl.cardStart, tl.cardStart + SHARE_CARD_FADE),
          reading: ramp(t, tl.cardStart + SHARE_CARD_READING, tl.cardStart + SHARE_CARD_READING + 0.7),
          rule: ramp(t, tl.cardStart + SHARE_CARD_RULE, tl.cardStart + SHARE_CARD_RULE + 0.5),
          who: 0,
          poem: Array.from({ length: n }, (_, i) => ramp(t, tl.poemStart + i * step, tl.poemStart + i * step + lineFade)),
          seal: 0,
        }
        card.draw(frame, st)
      }
      toBlack(frame, ramp(t, tl.total - SHARE_FADE_OUT, tl.total))
      opts.onFrame?.(t, frame)
      if (!ff.stdin.write(frame)) await new Promise<void>((res) => ff.stdin.once('drain', () => res()))
    }
    ff.stdin.end()
  }
  try {
    await renderFrames()
    const code = await closed
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.slice(0, 300)}`)
    return { mp4: await readFile(file), seconds: total, frames, renderMs: Date.now() - t0, music: audio?.mood ?? null }
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

