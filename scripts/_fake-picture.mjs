// A fake "picture" for the tests that stand in for the image model: warm paper with a few separate soft ink marks (a horizon wash, a roof, a door, a small figure and a lamp) — enough ink and enough
// separate marks to pass the cheap pixel check (engine/picture-pixels.ts) the way a real ink-wash picture does. A flat sheet of paper would (correctly) fail it as `empty`.
import sharp from 'sharp'

/** @param {number} [width] @param {number} [height] @param {string} [paper] @returns {Promise<Buffer>} a PNG */
export async function fakePicture(width = 400, height = 500, paper = '#d8d0bc') {
  const w = width
  const h = height
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 400 500">
    <rect width="400" height="500" fill="${paper}"/>
    <ellipse cx="200" cy="360" rx="170" ry="42" fill="#3a352c" opacity="0.72"/>
    <polygon points="70,230 150,160 230,230" fill="#2a2620" opacity="0.85"/>
    <rect x="95" y="230" width="110" height="80" fill="#4a4338" opacity="0.8"/>
    <rect x="130" y="262" width="26" height="48" fill="#17140f"/>
    <ellipse cx="300" cy="300" rx="16" ry="30" fill="#1d1a15"/>
    <circle cx="300" cy="262" r="12" fill="#1d1a15"/>
    <circle cx="330" cy="120" r="26" fill="#6b6354" opacity="0.8"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
