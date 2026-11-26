// The cheap pixel check before any model call (2026-11-14, B2): a drawn picture that is near-empty — plain paper, a lone stroke, a faint wash with no recognisable subject — is `empty`.
// It measures how much of the picture is NOT paper (ink share), how many separate marks there are, and how much sharp detail there is (edge density), on a small grey copy.
// The plain washi tiles (public/film/washi-*.webp) and a blank sample must fail; real ink-wash pictures with a subject, which keep generous empty space on purpose, must pass.

import sharp from 'sharp'

export interface PixelStats {
  /** Share of pixels clearly darker than the paper (0–1). */
  ink: number
  /** Separate ink marks of a meaningful size (4-connected). */
  marks: number
  /** Share of pixels on a sharp edge (0–1). */
  edge: number
  /** Share of ink that sits in the biggest single mark (1 = one lone stroke). */
  biggest: number
}

const W = 96
const H = 120

/** The thresholds (tuned on the washi tiles, a blank sample and showcase pictures — scripts/test-picture-pixels.ts). */
export const EMPTY_RULE = { minInk: 0.02, loneInk: 0.07, loneMarks: 3, loneBiggest: 0.4 } as const

export async function pixelStats(image: Buffer): Promise<PixelStats> {
  const { data } = await sharp(image).rotate().resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const n = W * H
  // the paper tone: a high percentile of the luminance (the paper is the lightest wide area; a vignette darkens only the rim)
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < n; i++) hist[data[i]]++
  let acc = 0
  let paper = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= n * 0.7) {
      paper = v
      break
    }
  }
  const dark = (i: number) => data[i] < paper - 38
  let ink = 0
  for (let i = 0; i < n; i++) if (dark(i)) ink++
  // connected marks
  const seen = new Uint8Array(n)
  const sizes: number[] = []
  const stack: number[] = []
  for (let s = 0; s < n; s++) {
    if (seen[s] || !dark(s)) continue
    let size = 0
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const p = stack.pop()!
      size++
      const x = p % W
      const y = (p - x) / W
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && !seen[q] && dark(q)) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    sizes.push(size)
  }
  const marks = sizes.filter((s) => s >= 12).length
  const biggest = ink ? Math.max(0, ...sizes) / ink : 0
  // edge density: steep luminance steps between neighbours
  let edges = 0
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = Math.abs(data[i + 1] - data[i - 1])
      const gy = Math.abs(data[i + W] - data[i - W])
      if (gx + gy > 46) edges++
    }
  return { ink: ink / n, marks, edge: edges / n, biggest }
}

/**
 * True when the picture is near-empty: next to no ink, or little ink that sits in one or two dominant strokes (the washi tile: two brush strokes, 4–5 % ink, one of them over half of it).
 * A real picture keeps generous empty space on purpose, so a picture with several separate marks, or more than 7 % ink, always passes this check (the model check judges the rest).
 */
export function isNearEmpty(s: PixelStats): boolean {
  if (s.ink < EMPTY_RULE.minInk) return true
  return s.ink < EMPTY_RULE.loneInk && s.marks <= EMPTY_RULE.loneMarks && s.biggest >= EMPTY_RULE.loneBiggest
}

export async function checkEmpty(image: Buffer): Promise<{ empty: boolean; stats: PixelStats }> {
  const stats = await pixelStats(image)
  return { empty: isNearEmpty(stats), stats }
}


/** A small fingerprint of a picture (2026-11-20, "four different pictures, always"): a difference hash of 8 × 8 comparisons on a 9 × 8 grey copy, as 16 hex digits. */
export async function pictureHash(img: Buffer): Promise<string> {
  const raw = await sharp(img).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer()
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0'
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}
/** How many of the 64 bits differ between two fingerprints (0 = the same picture). */
export function hashDistance(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}
/** Two pictures of one film are the same picture (a copy of the neighbour, or two scenes drawn alike) when they differ in at most this many bits. */
export const DUPLICATE_BITS = 2


/** Share of pixels that are nearly black (0–1), on a small grey copy. */
export async function darkShare(image: Buffer): Promise<number> {
  const { data } = await sharp(image).rotate().resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  let dark = 0
  for (let i = 0; i < data.length; i++) if (data[i] < 56) dark++
  return dark / data.length
}
/** A night picture keeps a light page (Ticket 9, item 9): more than this share of near-black means a large solid-black area. */
export const NIGHT_DARK_MAX = 0.12

/**
 * Night and evening pictures (English films) keep a LIGHT page: when more than NIGHT_DARK_MAX of the picture is near-black, the shadows are lifted (black becomes a soft charcoal, the paper stays
 * paper) so no large solid-black area remains. A picture that is already light is returned as it is.
 */
export async function keepLightPage(webp: Buffer): Promise<Buffer> {
  if ((await darkShare(webp).catch(() => 0)) <= NIGHT_DARK_MAX) return webp
  return sharp(webp).linear(0.74, 66).webp({ quality: 82 }).toBuffer()
}
