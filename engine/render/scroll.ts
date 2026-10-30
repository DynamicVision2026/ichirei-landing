// The story scroll (物語絵巻), all sizes (Part E1): ONE tall image — the four pictures in story order, each with its line, then the character (cinnabar; ink black for
// remembrance), its reading and the "who they are" line, a small 「一字礼 ICHIREI」 seal and the credit line. PNG about 2400 px wide, and the same as a PDF.
// Made from the film's stored data with no new AI call; the paper and the type match the film. Only called when all four pictures are real.

import sharp from 'sharp'
import PDFDocument from 'pdfkit'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, wrapText } from './text.ts'
import { credit, type Artwork } from './artwork.ts'

export const PAPER = '#EFE6D2'
export const INK = '#2A221B'
export const CINNABAR = '#C0392B'
const MUTED = '#6B5F4E'
const WIDTH = 2400
const PIC_W = 1440
const PIC_H = 1800

export interface Scroll {
  png: Buffer
  width: number
  height: number
}

export async function makeScroll(a: Artwork, env: NodeJS.ProcessEnv = process.env): Promise<Scroll> {
  const f = fontsFor(a.language)
  const body = fontObject(f.body, env)
  const charFont = fontObject(f.character, env)
  const composites: { input: Buffer; left: number; top: number }[] = []
  let svg = ''
  let y = 220
  const picLeft = (WIDTH - PIC_W) / 2
  for (let i = 0; i < a.lines.length; i++) {
    const pic = a.pictures[i]
    if (!pic) throw new Error('the story scroll needs four real pictures')
    composites.push({ input: await sharp(pic).resize(PIC_W, PIC_H, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer(), left: picLeft, top: y })
    y += PIC_H + 150
    for (const line of wrapText(body, a.lines[i].replace(/\n+/g, ''), 66, 1500)) {
      const t = textPaths(body, line, 66, WIDTH / 2, y, INK, 'middle')
      svg += t.svg
      y += 108
    }
    y += 210
  }
  // the character
  const color = a.memorial ? INK : CINNABAR
  const cs = 640
  const g = textPaths(charFont, a.glyph, cs, WIDTH / 2, y + cs * 0.82, color, 'middle', f.stroke)
  svg += g.svg
  y += cs + 120
  svg += textPaths(body, a.reading, 76, WIDTH / 2, y, MUTED, 'middle').svg
  y += 150
  for (const line of wrapText(body, a.who, 68, 1600)) {
    svg += textPaths(body, line, 68, WIDTH / 2, y, INK, 'middle').svg
    y += 110
  }
  y += 170
  // the seal: a small square with 一字礼 (ink for remembrance)
  const seal = 150
  const sx = WIDTH / 2 - seal / 2
  svg += `<rect x="${sx}" y="${y}" width="${seal}" height="${seal}" rx="12" fill="${color}"/>`
  const sealFont = fontObject('body-ja', env)
  svg += textPaths(sealFont, '一字', 54, WIDTH / 2, y + 66, PAPER, 'middle').svg + textPaths(sealFont, '礼', 54, WIDTH / 2, y + 126, PAPER, 'middle').svg
  y += seal + 70
  svg += textPaths(sealFont, 'ICHIREI', 38, WIDTH / 2, y, MUTED, 'middle').svg
  y += 110
  svg += textPaths(body, credit(a.language), 40, WIDTH / 2, y, MUTED, 'middle').svg
  y += 180
  const height = Math.ceil(y)
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">${svg}</svg>`)
  const png = await sharp({ create: { width: WIDTH, height, channels: 3, background: PAPER } })
    .composite([...composites, { input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  return { png, width: WIDTH, height }
}

/** The same scroll as a PDF: one tall page holding the image (1 px = 1 pt). */
export async function scrollPdf(s: Scroll): Promise<Buffer> {
  const doc = new PDFDocument({ size: [s.width, s.height], margin: 0, info: { Title: 'ICHIREI 一字礼', Producer: 'ICHIREI' } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  doc.image(s.png, 0, 0, { width: s.width, height: s.height })
  doc.end()
  return done
}
