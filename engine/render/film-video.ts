// The story film as a video file (Part 5 of the 2026-10-31 ticket): MP4, 1080 × 1920, with quiet music, about 34 s (41 s for a remembrance), made from the SAME
// timeline and frame maths as the film on the page (src/animation/film.ts) — nothing new is written or drawn by a model. The frames are composed here in
// plain pixels (the four pictures with their slow push-in, each line phrase by phrase, the character revealed in ink, then the paper e-card with the character, its
// reading, the "who they are" line, the poem and the seal — engine/render/endcard.ts) and piped to ffmpeg (H.264, yuv420p, faststart, so it plays on an iPhone and on Android and "Save Video" works).
//
// Cost: about a minute of one CPU and a few hundred MB of memory; made once per order after the pictures are final and kept in the private bucket.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { clamp, frameAt, makeFilmTimeline, phrases } from '../../src/order/film-timeline.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths } from './text.ts'
import { INK, QUIET, U, VIDEO_FPS, VIDEO_H, VIDEO_W, blend, lineLayer, run, textBlock, type Layer } from './film-draw.ts'
import { makeEndCard, toBlack } from './endcard.ts'
import { audioPlan, chooseTrack } from './film-audio.ts'
export * from './film-draw.ts'
import { credit, type Artwork } from './artwork.ts'

export interface FilmVideo {
  mp4: Buffer
  seconds: number
  frames: number
  renderMs: number
  /** which piece runs under it (null = made without sound) and where in the recording the film starts */
  music: string | null
  musicStart: number | null
}

/** Render the film. `a.pictures` must hold the real pictures (a washi slot is drawn as plain washi). `onlyFirstSeconds` is for the tests. */
export async function makeFilmVideo(a: Artwork, opts: { fps?: number; ffmpeg?: string; seconds?: number; music?: boolean; onFrame?: (t: number, rgba: Buffer) => void } = {}): Promise<FilmVideo> {
  const t0 = Date.now()
  const fps = opts.fps ?? VIDEO_FPS
  const c = a.quiet ? QUIET : INK
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

  // the dark character section (the character and its reading, revealed in ink), then the e-card (engine/render/endcard.ts) and the small picture credit under it
  const kanjiSize = 44.7 * U
  const kanjiPng = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(kanjiSize * 1.2)}" height="${Math.ceil(kanjiSize * 1.2)}">${textPaths(hero, a.glyph, kanjiSize, kanjiSize * 0.6, kanjiSize * 0.99, c.kanji, 'middle', f.stroke).svg}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const kanjiCentreY = VIDEO_H / 2 - VIDEO_W * 0.09
  const kanji: Layer = { data: kanjiPng.data, w: kanjiPng.info.width, h: kanjiPng.info.height, x: Math.round(VIDEO_W / 2 - kanjiPng.info.width / 2), y: Math.round(kanjiCentreY - kanjiPng.info.height / 2) }
  const reading = await lineLayer(body, a.reading, 2.9 * U, VIDEO_W / 2, VIDEO_H * 0.61, c.muted, 0.3 * 2.9 * U)
  const card = await makeEndCard({ language: a.language, glyph: a.glyph, reading: a.reading, who: a.who, ...(a.language === 'en' && a.en ? { word: a.en.word, line: a.en.line } : {}), poem: a.poem, poemType: a.poemType, quiet: a.quiet }, 'film')
  const credits = await lineLayer(body, credit(a.language), 1.9 * U, VIDEO_W / 2, VIDEO_H * 0.965, INK.muted)

  // the plain frame
  const plain = (rgb: [number, number, number]): Buffer => {
    const b = Buffer.alloc(VIDEO_W * VIDEO_H * 4)
    for (let i = 0; i < b.length; i += 4) { b[i] = rgb[0]; b[i + 1] = rgb[1]; b[i + 2] = rgb[2]; b[i + 3] = 255 }
    return b
  }
  const base = plain(c.frame)
  // a quiet film (remembrance and the quiet purposes) has a light frame; the e-card always sits on the dark ink frame, so the frame darkens as the card comes
  const darkBase = a.quiet ? plain(INK.frame) : base

  // ffmpeg writes to a file (the faststart step rewrites the file's head, which a pipe cannot do), then we read it back
  const dir = await mkdtemp(join(tmpdir(), 'ichirei-film-'))
  const file = join(dir, 'film.mp4')
  const audio = opts.music === false ? null : audioPlan(chooseTrack({ purpose: a.purpose, memorial: a.memorial, state: a.state }, total), total)
  const ff = run(opts.ffmpeg ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${VIDEO_W}x${VIDEO_H}`, '-r', String(fps), '-i', 'pipe:0', ...(audio ? audio.inputs : []), ...(audio ? audio.maps : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', ...(audio ? audio.codec : []), '-movflags', '+faststart', file])
  let err = ''
  ff.stdout.resume()
  ff.stderr.on('data', (d: Buffer) => (err += String(d)))
  const closed = new Promise<number>((res) => ff.on('close', (code) => res(code ?? 1)))
  ff.stdin.on('error', () => {}) // a dead ffmpeg is reported by its exit code

  const frame = Buffer.alloc(base.length)
  const renderFrames = async (): Promise<void> => {
    for (let n = 0; n < frames; n++) {
      const t = n / fps
      const st = frameAt(t, tl, a.lines, card.poemLines.length)
      if (st.frameDark <= 0.003) base.copy(frame)
      else if (st.frameDark >= 0.997) darkBase.copy(frame)
      else {
        const k = st.frameDark
        const r = Math.round(c.frame[0] + (INK.frame[0] - c.frame[0]) * k), g = Math.round(c.frame[1] + (INK.frame[1] - c.frame[1]) * k), b = Math.round(c.frame[2] + (INK.frame[2] - c.frame[2]) * k)
        for (let i = 0; i < frame.length; i += 4) { frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; frame[i + 3] = 255 }
      }
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
      }
      if (st.card.opacity > 0.003) {
        card.draw(frame, st.card)
        blend(frame, credits, st.card.opacity * 0.7)
      }
      toBlack(frame, st.black)
      opts.onFrame?.(t, frame)
      if (!ff.stdin.write(frame)) await new Promise<void>((res) => ff.stdin.once('drain', () => res()))
    }
    ff.stdin.end()
  }
  try {
    await renderFrames()
    const code = await closed
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.slice(0, 300)}`)
    return { mp4: await readFile(file), seconds: total, frames, renderMs: Date.now() - t0, music: audio?.track ?? null, musicStart: audio?.start ?? null }
  } finally {
    ff.kill()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
