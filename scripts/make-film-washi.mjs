// The two plain washi pictures the story film falls back to when a picture could not be drawn (or was refused by the picture check): one soft brush
// stroke on washi, no text. Slot 1 and 3 use washi-1, slot 2 and 4 use washi-2. They are static files: public/film/washi-1.webp and washi-2.webp
// (1080 × 1350), served at /film/washi-<n>.webp. This script writes the ones that are missing and never overwrites a file that is in place.
//
//   node scripts/make-film-washi.mjs

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../public/film/', import.meta.url).pathname

function washiSvg(n) {
  const sway = 80 + ((n * 53) % 160)
  const y = 560 + ((n * 37) % 220)
  const w = 26 + ((n * 7) % 22)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${n}" result="n"/><feColorMatrix in="n" values="0 0 0 0 .55  0 0 0 0 .47  0 0 0 0 .36  0 0 0 .22 0"/></filter>
    <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${n + 3}"/><feDisplacementMap in="SourceGraphic" scale="46"/><feGaussianBlur stdDeviation="6"/></filter>
    <radialGradient id="v" cx="50%" cy="42%" r="75%"><stop offset="55%" stop-color="#3c2814" stop-opacity="0"/><stop offset="100%" stop-color="#3c2814" stop-opacity=".28"/></radialGradient>
  </defs>
  <rect width="1080" height="1350" fill="#E8DEC6"/>
  <rect width="1080" height="1350" filter="url(#paper)"/>
  <path d="M130 ${y} C 380 ${y - sway}, 690 ${y + sway}, 950 ${y - 40}" stroke="#2A221B" stroke-width="${w}" stroke-linecap="round" fill="none" opacity=".62" filter="url(#soft)"/>
  <path d="M170 ${y + 90} C 420 ${y + 40}, 640 ${y + 150}, 880 ${y + 70}" stroke="#2A221B" stroke-width="${Math.round(w / 3)}" stroke-linecap="round" fill="none" opacity=".25" filter="url(#soft)"/>
  <rect width="1080" height="1350" fill="url(#v)"/>
</svg>`
}

mkdirSync(DIR, { recursive: true })
const sharp = (await import('sharp')).default
let wrote = 0
for (const n of [1, 2]) {
  const file = join(DIR, `washi-${n}.webp`)
  if (existsSync(file)) continue
  await sharp(Buffer.from(washiSvg(n))).webp({ quality: 72 }).toFile(file)
  wrote++
}
console.log(`washi pictures written: ${wrote}`)
