// The printed story card (Part E2): A6 folded, printed as A5 landscape, two pages (outside, inside), 3 mm bleed, fonts embedded, full-size pictures.
//
//   page 1 (outside)  left: the back — the QR code to the RECEIVER's page, the slogan, the credit line · right: the front — the character and its reading
//   page 2 (inside)   left: the four pictures with their lines · right: the character, "who they are", the poem, the certificate line, 「＿＿さんへ」「＿＿より」
//
// Colours: warm washi paper #EFE6D2, ink #2A221B, cinnabar #C0392B for the main character ONLY (ink black for remembrance: no red anywhere). Type: Zen Old
// Mincho for the character, Noto Serif for the text. The 「さんへ / より」 lines are blank when the sender hands it over themselves (to write by hand),
// and filled with the names and the short message when it ships directly or as an e-gift. The owner prints these himself at launch on a home inkjet.

import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { fontBuffer, fontsFor } from './fonts.ts'
import { CINNABAR, INK, PAPER } from './scroll.ts'
import { credit, slogan, type Artwork } from './artwork.ts'

const MM = 72 / 25.4
const BLEED = 3 * MM
const TRIM_W = 210 * MM
const TRIM_H = 148 * MM
export const PAGE_W = TRIM_W + 2 * BLEED
export const PAGE_H = TRIM_H + 2 * BLEED
const MUTED = '#6B5F4E'
const LINE = '#B9AC93'

const CAPTION = {
  ja: { to: (n: string) => (n ? `${n} さんへ` : '＿＿＿＿＿＿ さんへ'), from: (n: string) => (n ? `${n} より` : '＿＿＿＿＿＿ より') },
  'zh-Hant': { to: (n: string) => (n ? `${n} 收` : '＿＿＿＿＿＿ 收'), from: (n: string) => (n ? `${n} 贈` : '＿＿＿＿＿＿ 贈') },
  en: { to: (n: string) => (n ? `To ${n}` : 'To ______________'), from: (n: string) => (n ? `From ${n}` : 'From ______________') },
}
const capFor = (l: Artwork['language']) => (l === 'ja' ? CAPTION.ja : l === 'en' ? CAPTION.en : CAPTION['zh-Hant'])

type Doc = InstanceType<typeof PDFDocument>

/** Each font file is embedded ONCE per PDF, however many cards use it. Returns the registered names for this card's language. */
function registerFonts(doc: Doc, a: Artwork, env: NodeJS.ProcessEnv, done: Set<string>): void {
  const f = fontsFor(a.language)
  for (const name of new Set([f.body, f.character, 'body-ja' as const])) {
    if (!done.has(name)) {
      doc.registerFont(name, fontBuffer(name, env))
      done.add(name)
    }
  }
  names.body = f.body
  names.char = f.character
}
const names = { body: 'body-ja', char: 'character-ja', mark: 'body-ja' }

function paper(doc: Doc) {
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER)
}

function qr(doc: Doc, url: string, x: number, y: number, size: number) {
  const q = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const n = q.modules.size
  const cell = size / n
  doc.fillColor(INK)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.15, cell + 0.15).fill(INK)
}

/** Draw the main character big and centred in a box; stroke thickens a regular-weight font into a bold one (the Chinese font has one weight). */
function glyph(doc: Doc, a: Artwork, cx: number, top: number, size: number) {
  const color = a.memorial ? INK : CINNABAR
  const stroke = fontsFor(a.language).stroke
  doc.font(names.char).fontSize(size)
  const w = doc.widthOfString(a.glyph)
  doc.fillColor(color)
  if (stroke) doc.lineWidth(size * 0.012).strokeColor(color).text(a.glyph, cx - w / 2, top, { lineBreak: false, fill: true, stroke: true })
  else doc.text(a.glyph, cx - w / 2, top, { lineBreak: false })
}

function centred(doc: Doc, text: string, cx: number, y: number, width: number, size: number, color: string, opts: { lineGap?: number } = {}) {
  doc.font(names.body).fontSize(size).fillColor(color)
  doc.text(text, cx - width / 2, y, { width, align: 'center', lineGap: opts.lineGap ?? 2 })
}

function drawOutside(doc: Doc, a: Artwork) {
  paper(doc)
  const half = TRIM_W / 2
  const leftCx = BLEED + half / 2
  const rightCx = BLEED + half + half / 2
  // the back (left): QR to the receiver's page, the slogan, the credit
  const q = 30 * MM
  qr(doc, a.qrUrl, leftCx - q / 2, BLEED + 38 * MM, q)
  centred(doc, slogan(a.language), leftCx, BLEED + 38 * MM + q + 10 * MM, half - 24 * MM, 8.5, INK)
  centred(doc, credit(a.language), leftCx, BLEED + TRIM_H - 14 * MM, half - 24 * MM, 7, MUTED)
  // the front (right): the character and its reading
  glyph(doc, a, rightCx, BLEED + 28 * MM, 150)
  centred(doc, a.reading, rightCx, BLEED + 28 * MM + 214, half - 20 * MM, 13, INK)
  doc.font(names.mark).fontSize(8).fillColor(MUTED)
  const mark = 'ICHIREI 一字礼'
  doc.text(mark, rightCx - doc.widthOfString(mark) / 2, BLEED + TRIM_H - 14 * MM, { lineBreak: false })
  // the fold
  doc.lineWidth(0.3).strokeColor(LINE).dash(2, { space: 3 }).moveTo(BLEED + half, 0).lineTo(BLEED + half, BLEED - 1).stroke().moveTo(BLEED + half, BLEED + TRIM_H + 1).lineTo(BLEED + half, PAGE_H).stroke().undash()
}

function drawInside(doc: Doc, a: Artwork) {
  paper(doc)
  const half = TRIM_W / 2
  const leftX = BLEED + 9 * MM
  const colW = (half - 18 * MM - 5 * MM) / 2
  const picH = colW * 1.25
  const rowH = picH + 15 * MM
  // the four pictures with their lines (a plain washi box where a picture is missing — the card never waits for one)
  for (let i = 0; i < Math.min(4, a.lines.length); i++) {
    const x = leftX + (i % 2) * (colW + 5 * MM)
    const y = BLEED + 8 * MM + Math.floor(i / 2) * rowH
    const pic = a.pictures[i]
    if (pic) doc.image(pic, x, y, { width: colW, height: picH })
    else doc.rect(x, y, colW, picH).fill('#E8DEC6')
    doc.font(names.body).fontSize(6.4).fillColor(INK).text(a.lines[i].replace(/\n+/g, ''), x, y + picH + 1.8 * MM, { width: colW, align: 'center', lineGap: 1 })
  }
  // the right page
  const rx = BLEED + half + 7 * MM
  const rw = half - 14 * MM
  const rcx = rx + rw / 2
  glyph(doc, a, rcx, BLEED + 6 * MM, 62)
  let y = BLEED + 6 * MM + 92
  centred(doc, a.reading, rcx, y, rw, 9, MUTED)
  y += 18
  doc.font(names.body).fontSize(8.6)
  const whoH = doc.heightOfString(a.who, { width: rw, align: 'center', lineGap: 2 })
  centred(doc, a.who, rcx, y, rw, 8.6, INK)
  y += whoH + 10
  if (a.poem.length) {
    const poem = a.poem.join('\n')
    doc.font(names.body).fontSize(7.8)
    const ph = doc.heightOfString(poem, { width: rw, align: 'center', lineGap: 2 })
    centred(doc, poem, rcx, y, rw, 7.8, INK)
    y += ph + 9
  }
  centred(doc, a.certificateLine, rcx, y, rw, 6.8, MUTED)
  // to / from, and the short message (when it ships directly or as an e-gift)
  const cap = capFor(a.language)
  const base = BLEED + TRIM_H - 11 * MM
  if (a.message) centred(doc, a.message, rcx, base - 38, rw, 7.6, INK)
  doc.font(names.body).fontSize(8.4).fillColor(INK)
  doc.text(cap.to(a.to), rx, base - 20, { width: rw, align: 'left', lineBreak: false })
  doc.text(cap.from(a.from), rx, base - 4, { width: rw, align: 'right', lineBreak: false })
}

/** One or many cards into one PDF (the owner's "all of today's cards"). */
export async function cardsPdf(cards: Artwork[], env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  if (cards.length === 0) throw new Error('no cards')
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false, info: { Title: 'ICHIREI card', Producer: 'ICHIREI' } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  const embedded = new Set<string>()
  for (const a of cards) {
    registerFonts(doc, a, env, embedded)
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 })
    drawOutside(doc, a)
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 })
    drawInside(doc, a)
  }
  doc.end()
  return done
}
