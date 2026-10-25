// Makes the WebP derivatives of the photos in public/img (run by `npm run build`; safe to run any time).
//
//   public/img/scenes/parents.jpg  →  parents-640.webp, parents-1280.webp   (never enlarged)
//
// The JPG is the source of truth and the fallback: to swap a photo, drop in a new JPG with the same name —
// no code change; the next build rebuilds its WebP files. If sharp cannot load (it is a build-time tool
// only), the committed WebP files are kept and a warning is printed.

import { readdirSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const ROOT = new URL('../public/img/', import.meta.url).pathname
const WIDTHS = [640, 1280]

let sharp
try {
  sharp = (await import('sharp')).default
} catch (e) {
  console.warn(`[make-images] sharp is not available (${e instanceof Error ? e.message : e}); keeping the existing WebP files`)
  process.exit(0)
}

const jpgs = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (['.jpg', '.jpeg'].includes(extname(name).toLowerCase())) jpgs.push(p)
  }
}
walk(ROOT)

for (const src of jpgs) {
  const base = src.slice(0, -extname(src).length)
  for (const w of WIDTHS) {
    await sharp(src).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(`${base}-${w}.webp`)
  }
}
console.log(`[make-images] ${jpgs.length} photos → ${jpgs.length * WIDTHS.length} WebP files (${jpgs.map((p) => basename(p)).join(', ')})`)
