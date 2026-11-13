// ONE-SHOT, MANUAL, PAID (2026-11-13). Draws the seven /en relationship scenes with the image model, with the same English picture prompt a real English film uses (Sumi-e ink-wash style without the word
// "Japanese", then the Western world line, then the scene) — no faces, no text. It is NOT part of any test or build and nothing at runtime calls a model for these: the result is committed as static images.
//
//   needs: Vertex access (a service account / gcloud login on the project, or ICHIREI_FILM_IMAGE_API_KEY), and optionally ANTHROPIC_API_KEY for the safety check of the pictures
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/generate-en-scenes.ts [--out /tmp/en-scenes] [--install]
//
// It draws each scene (up to three tries), checks the seven with the same picture check a film's pictures pass (when an Anthropic key is there), and writes <name>.jpg, <name>-1280.webp and <name>-640.webp
// (1280 × 1600 and 640 × 800, the sizes the page already uses). With --install the pictures that passed are copied over public/img/scenes/en/ (the file names the page already reads). Look at them first.

import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { buildImagePrompt, checkPictures, vertexImageClient } from '../engine/film-art.ts'

const SCENES: { name: string; description: string }[] = [
  { name: 'kitchen', description: 'a mother and her adult daughter seen from behind, sitting at a suburban kitchen table with two mugs, soft morning light through the window over the sink' },
  { name: 'hood', description: "a father and his adult son seen from behind, standing at the open hood of a car in a driveway, the father's hand pointing into the engine, late afternoon light" },
  { name: 'porch', description: 'two friends seen from behind, sitting side by side on the steps of a front porch, a porch light glowing above the door, early evening' },
  { name: 'bench', description: 'an older couple seen from behind on a park bench, shoulders close together, bare autumn trees and a gravel path, soft low sun' },
  { name: 'desk', description: "a teacher's wooden desk in an empty classroom with a folded greeting card standing open on it beside a stack of papers and a cup of pencils, afternoon light from a tall window" },
  { name: 'thanksgiving', description: 'a Thanksgiving dinner table set for a family, a roast turkey on a platter, bowls of food and two candles, empty chairs around it, warm evening light' },
  { name: 'tree', description: 'a Christmas tree in the corner of a living room with one small wrapped gift on the floor beneath it, the edge of a sofa in the foreground, soft light' },
]

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i === -1 ? null : (process.argv[i + 1] ?? '')
}
const OUT = arg('--out') || '/tmp/en-scenes'
mkdirSync(OUT, { recursive: true })
const image = vertexImageClient(process.env)
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null

const passed: string[] = []
for (const s of SCENES) {
  let ok = false
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const { bytes } = await image.generate(buildImagePrompt(s.description, false, '', 'en'), AbortSignal.timeout(120_000))
    const big = await sharp(bytes).resize(1280, 1600, { fit: 'cover' }).toBuffer()
    if (client) {
      const jpeg = await sharp(big).jpeg({ quality: 85 }).toBuffer()
      const r = await checkPictures(client as never, [jpeg], [s.description], false, process.env, undefined, 'en')
      const v = r.verdicts[0]
      console.log(`${s.name} try ${attempt}: ${v ? (v.ok ? 'ok' : `failed (${v.reason})`) : 'not checked'}`)
      ok = !!v?.ok
      if (v === null) ok = true // the check could not run: keep the picture, look at it yourself
    } else {
      console.log(`${s.name} try ${attempt}: drawn (no ANTHROPIC_API_KEY, so not checked: look at it yourself)`)
      ok = true
    }
    if (ok) {
      await sharp(big).jpeg({ quality: 86 }).toFile(join(OUT, `${s.name}.jpg`))
      await sharp(big).webp({ quality: 82 }).toFile(join(OUT, `${s.name}-1280.webp`))
      await sharp(big).resize(640, 800).webp({ quality: 80 }).toFile(join(OUT, `${s.name}-640.webp`))
      passed.push(s.name)
    }
  }
}
console.log(`written to ${OUT}: ${passed.join(', ') || 'none'}${passed.length < SCENES.length ? ` — NOT drawn: ${SCENES.filter((s) => !passed.includes(s.name)).map((s) => s.name).join(', ')}` : ''}`)
if (process.argv.includes('--install')) {
  for (const name of passed) for (const f of [`${name}.jpg`, `${name}-1280.webp`, `${name}-640.webp`]) copyFileSync(join(OUT, f), join('public/img/scenes/en', f))
  console.log('installed into public/img/scenes/en/ — rebuild and look at /en')
}
