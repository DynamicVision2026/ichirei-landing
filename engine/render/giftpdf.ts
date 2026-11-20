// 「まとめて保存」 (Part 12, 2026-11-20): the whole gift in ONE PDF — the 物語絵巻 extended: the character with its reading and its line, the poem (set vertically for Japanese and Chinese), the four pictures
// with their lines, the certificate, and on the last page the QR of the gift page with 「この贈りものの映像と音楽は、こちらから」. Made from the stored records with no new model call; the paper and the type are
// the scroll's. Pages that need what a gift may not have (the poem, four real pictures) are simply left out.

import sharp from 'sharp'
import PDFDocument from 'pdfkit'
import { toTraditional } from '../script.ts'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, wrapText } from './text.ts'
import { verticalCells, isVerticalPoem } from './card.ts'
import { makeQrSlip } from './keepsake.ts'
import { INK, CINNABAR, PAPER } from './scroll.ts'
import { credit, type Artwork } from './artwork.ts'

const MUTED = '#6B5F4E'
const W = 1080
const H = 1350
const STRIP = 380

/** The line on the last page, in the gift's language. */
export const QR_PAGE_LINE: Record<'ja' | 'en' | 'zh-Hant' | 'zh-Hans', string> = {
  ja: 'この贈りものの映像と音楽は、こちらから',
  en: 'The film and music are here',
  'zh-Hant': '影片與音樂請由此觀看',
  'zh-Hans': '影片與音樂請由此觀看', // drawn in the Traditional forms (the server's Chinese font is Traditional only); the page itself says it in Simplified
}

const page = (svg: string, h = H): Promise<Buffer> =>
  sharp({ create: { width: W, height: h, channels: 3, background: PAPER } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${svg}</svg>`), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()

export async function giftPdfPages(a: Artwork, certificate: Buffer | null, env: NodeJS.ProcessEnv = process.env): Promise<{ pages: Buffer[]; qrUrl: string }> {
  const hans = a.language === 'zh-Hans'
  const t = (v: string): string => (hans ? toTraditional(v) : v)
  const lang = a.language
  const f = fontsFor(lang)
  const body = fontObject(f.body, env)
  const hero = fontObject(f.character, env)
  const color = a.quiet ? INK : CINNABAR
  const pages: Buffer[] = []

  // 1 · the character, its reading and its line
  {
    let svg = ''
    const cs = 560
    svg += textPaths(hero, t(a.glyph), cs, W / 2, 170 + cs * 0.82, color, 'middle', f.stroke).svg
    let y = 170 + cs + 110
    const enFirst = lang === 'en' && !!a.en
    if (enFirst && a.en) {
      svg += textPaths(body, a.en.word, 104, W / 2, y, INK, 'middle', 3).svg
      y += 120
      for (const l of wrapText(body, a.en.line, 46, 860).slice(0, 3)) { svg += textPaths(body, l, 46, W / 2, y, INK, 'middle').svg; y += 70 }
    } else {
      if (a.reading) { svg += textPaths(body, t(a.reading), 56, W / 2, y, MUTED, 'middle').svg; y += 110 }
      for (const l of wrapText(body, t(a.who), 48, 860).slice(0, 4)) { svg += textPaths(body, l, 48, W / 2, y, INK, 'middle').svg; y += 76 }
    }
    svg += textPaths(body, 'ICHIREI 一字礼', 28, W / 2, H - 70, MUTED, 'middle').svg
    pages.push(await page(svg))
  }

  // 2 · the poem: vertical for Japanese and Chinese (the ceremony sets it so), horizontal for English
  if (a.poem.length > 0) {
    let svg = ''
    if (lang !== 'en') {
      const size = a.poem.length > 5 ? 46 : 58
      const lines = a.poem.map(t)
      const layout = verticalCells(lines, W / 2, 0, size)
      const top = Math.max(150, (H - layout.height) / 2)
      for (const c of layout.cells) {
        const y = top + c.y
        if (c.rotate) svg += `<g transform="rotate(90 ${c.x} ${y + size / 2})">${textPaths(body, c.ch, size, c.x, y + size / 2 + size * 0.32, INK, 'middle').svg}</g>`
        else if (c.offset) svg += textPaths(body, c.ch, size, c.x + size * 0.5, y + size * 0.5, INK, 'middle').svg
        else svg += textPaths(body, c.ch, size, c.x, y + size * 0.85, INK, 'middle').svg
      }
    } else {
      const lines = a.poem
      const size = 50
      const top = (H - lines.length * 84) / 2
      lines.forEach((l, i) => { svg += textPaths(body, l, size, W / 2, top + i * 84 + size, INK, 'middle').svg })
    }
    svg += textPaths(body, 'ICHIREI 一字礼', 28, W / 2, H - 70, MUTED, 'middle').svg
    pages.push(await page(svg))
  }

  // 3–6 · the four pictures, each with its line (only when all four are real)
  if (a.pictures.length === 4 && a.pictures.every((p) => !!p)) {
    for (let i = 0; i < 4; i++) {
      const pic = await sharp(a.pictures[i] as Buffer).resize(W, H, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer()
      let svg = ''
      const lines = wrapText(body, t((a.lines[i] ?? '').replace(/\n+/g, '')), 44, 900).slice(0, 3)
      lines.forEach((l, j) => { svg += textPaths(body, l, 44, W / 2, H + 100 + j * 70, INK, 'middle').svg })
      const h = H + STRIP
      pages.push(await sharp({ create: { width: W, height: h, channels: 3, background: PAPER } })
        .composite([{ input: pic, left: 0, top: 0 }, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${svg}</svg>`), left: 0, top: 0 }])
        .png({ compressionLevel: 9 }).toBuffer())
    }
  }

  // 7 · the certificate (a remembrance or a quiet gift has none: its image is cinnabar and the certificate is not offered for them)
  if (certificate) pages.push(certificate)

  // 8 · the QR of the gift page, with the line about the film and the music
  pages.push(await makeQrSlip({ url: a.qrUrl, glyph: t(a.glyph), lang, quiet: a.quiet, line: QR_PAGE_LINE[lang] }))
  return { pages, qrUrl: a.qrUrl }
}

/** The pages as one PDF: each page is as large as its image (1 px = 1 pt). */
export async function giftPdf(a: Artwork, certificate: Buffer | null, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const { pages } = await giftPdfPages(a, certificate, env)
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, info: { Title: 'ICHIREI 一字礼', Producer: 'ICHIREI', Subject: credit(a.language) } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  for (const p of pages) {
    const m = await sharp(p).metadata()
    const w = m.width ?? W
    const h = m.height ?? H
    doc.addPage({ size: [w, h], margin: 0 })
    doc.image(p, 0, 0, { width: w, height: h })
  }
  doc.end()
  return done
}
export { isVerticalPoem }
