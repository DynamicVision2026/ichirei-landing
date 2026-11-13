// ONE-SHOT, MANUAL, PAID (2026-11-13). Runs the two English sample stories of the Western-pictures ticket end to end through the real film steps — the film script (a model call), then the four pictures
// (the image model) and their picture check (a vision call) — and saves the four pictures of each. It is NOT part of any test or build.
//
//   needs: ANTHROPIC_API_KEY, and Vertex access for the image model (a service account / gcloud login, or ICHIREI_FILM_IMAGE_API_KEY)
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/sample-en-pictures.ts [--out /tmp/en-samples]
//
// Writes <out>/mom-porch-light-1..4.jpg and <out>/dad-tire-1..4.jpg and prints each film's four lines and picture descriptions.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { ensureArt, picturePath, vertexImageClient } from '../engine/film-art.ts'
import { makeFilm, type FilmInput } from '../engine/film.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'

const STORIES: { key: string; story: string; relationship: string; glyph: string; who: string }[] = [
  { key: 'mom-porch-light', story: 'My mom left the porch light on every night until I got home, even in my twenties.', relationship: 'parent_mother', glyph: '灯', who: 'Someone who kept the porch light on for me.' },
  { key: 'dad-tire', story: 'My dad taught me to change a tire in our driveway the week before I left for college.', relationship: 'parent_father', glyph: '備', who: 'Someone who made sure I was ready.' },
]
const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i === -1 ? null : (process.argv[i + 1] ?? '')
}
const OUT = arg('--out') || '/tmp/en-samples'
mkdirSync(OUT, { recursive: true })
const client = new Anthropic()
const image = vertexImageClient(process.env)

for (const [k, s] of STORIES.entries()) {
  const input: FilmInput = { story: s.story, language: 'en', relationship: s.relationship, direction: 'up', occasion: 'thanks', occasion_detail: null, memorial: false, tone: '', glyph: s.glyph, forms: [s.glyph], who: s.who, moment: s.story, names: [] }
  const film = await makeFilm(input, { client })
  console.log(`\n${s.key}: film ${film.status}`)
  film.lines.forEach((l, i) => console.log(`  ${i + 1}. ${l.replace(/\n/g, ' ')}\n     picture: ${film.pictures[i] ?? ''}`))
  const store = new MemoryOrderStore()
  const id = `AN-${(`sample${k}` + '2'.repeat(20)).slice(0, 20)}`
  const art = await ensureArt({ store, image, client, env: { ...process.env, ICHIREI_FILM_DAILY_MAX: '1000' }, log: (l) => console.log(l), pollMs: 500 }, { id, film, memorial: false, language: 'en' })
  console.log(`  pictures: ${art.slots.join(', ')}`)
  for (let n = 1; n <= 4; n++) {
    const webp = await store.getObject(picturePath(id, n))
    if (webp) writeFileSync(join(OUT, `${s.key}-${n}.jpg`), await sharp(webp).jpeg({ quality: 88 }).toBuffer())
  }
}
console.log(`\nsaved in ${OUT}`)
