// Stroke-order data for the story animation (one character, drawn stroke by stroke). Read from two open data packages, on demand:
//   Japanese forms  KanjiVG (CC BY-SA 3.0, via the npm package @madcat/kanjivg): the centre line of each stroke, in a 109 × 109 box.
//   Chinese forms   Make Me a Hanzi (Arphic Public License / LGPL, via hanzi-writer-data): the outline of each stroke plus its centre line
//                   (median), in a 1024 × 1024 box (y up; `flip` tells the page how to put it right way up).
// A character that is in neither set has no strokes: the page then fades the character in as ink instead. Plumbing only — no model call.
// The credits page (src/animation/CreditsPage.tsx) carries the attributions these licences require.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

export type StrokeScript = 'ja' | 'zh'

export type StrokeData =
  | { source: 'kanjivg'; box: 109; strokes: { d: string }[] }
  | { source: 'hanzi'; box: 1024; flip: string; strokes: { d: string; median: string }[] }

/** A single CJK ideograph (or compatibility ideograph) — the only thing a lookup accepts, so nothing else can reach the file system. */
export const isOneIdeograph = (c: unknown): c is string => typeof c === 'string' && [...c].length === 1 && /^[㐀-鿿豈-﫿\u{20000}-\u{2FA1F}]$/u.test(c)

const require_ = createRequire(import.meta.url)
let kvgDir: string | null | undefined
let hanziDir: string | null | undefined

function packageDir(name: string): string | null {
  try {
    return dirname(require_.resolve(`${name}/package.json`))
  } catch {
    return null
  }
}

export function kanjivgFile(c: string): string | null {
  if (kvgDir === undefined) {
    const root = packageDir('@madcat/kanjivg')
    kvgDir = root ? join(root, 'dist', 'main') : null
  }
  if (!kvgDir) return null
  const file = join(kvgDir, `${c.codePointAt(0)!.toString(16).padStart(5, '0')}.svg`)
  return existsSync(file) ? file : null
}

export function hanziFile(c: string): string | null {
  if (hanziDir === undefined) hanziDir = packageDir('hanzi-writer-data')
  if (!hanziDir) return null
  const file = join(hanziDir, `${c}.json`)
  return existsSync(file) ? file : null
}

/** The strokes in the order they are written, from KanjiVG's SVG (`<path id="kvg:06bcd-s1" d="…"/>`). */
export function parseKanjivg(svg: string): StrokeData | null {
  const strokes: { n: number; d: string }[] = []
  for (const m of svg.matchAll(/<path\b[^>]*?\bid="kvg:[0-9a-f]+-s(\d+)"[^>]*?\bd="([^"]+)"/g)) strokes.push({ n: Number(m[1]), d: m[2] })
  if (strokes.length === 0) return null
  strokes.sort((a, b) => a.n - b.n)
  return { source: 'kanjivg', box: 109, strokes: strokes.map((s) => ({ d: s.d })) }
}

const median = (pts: unknown): string | null =>
  Array.isArray(pts) && pts.length >= 2 && pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
    ? (pts as [number, number][]).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
    : null

/** From Make Me a Hanzi's JSON `{ strokes: [outline…], medians: [[[x,y]…]…] }`. */
export function parseHanzi(json: unknown): StrokeData | null {
  const j = json as { strokes?: unknown; medians?: unknown }
  if (!Array.isArray(j?.strokes) || !Array.isArray(j?.medians) || j.strokes.length === 0 || j.strokes.length !== j.medians.length) return null
  const out: { d: string; median: string }[] = []
  for (let i = 0; i < j.strokes.length; i++) {
    const d = j.strokes[i]
    const m = median(j.medians[i])
    if (typeof d !== 'string' || !m) return null
    out.push({ d, median: m })
  }
  return { source: 'hanzi', box: 1024, flip: 'scale(1,-1) translate(0,-900)', strokes: out }
}

const cache = new Map<string, StrokeData | null>()

/** The strokes of one character for a script (Japanese form → KanjiVG first, Chinese form → Make Me a Hanzi first; the other as a second try). */
export function strokesFor(c: string, script: StrokeScript): StrokeData | null {
  if (!isOneIdeograph(c)) return null
  const key = `${script}:${c}`
  if (cache.has(key)) return cache.get(key)!
  const fromKvg = (): StrokeData | null => {
    const f = kanjivgFile(c)
    return f ? parseKanjivg(readFileSync(f, 'utf8')) : null
  }
  const fromHanzi = (): StrokeData | null => {
    const f = hanziFile(c)
    if (!f) return null
    try {
      return parseHanzi(JSON.parse(readFileSync(f, 'utf8')))
    } catch {
      return null
    }
  }
  const data = (script === 'ja' ? fromKvg() ?? fromHanzi() : fromHanzi() ?? fromKvg()) ?? null
  if (cache.size > 2000) cache.clear()
  cache.set(key, data)
  return data
}
