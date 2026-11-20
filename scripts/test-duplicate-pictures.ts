// Four different pictures, always (2026-11-20). A film whose pictures include the same image twice (a failed picture replaced by a copy of its neighbour, or two scenes drawn alike) is refused at the
// picture check: the duplicate is a failure like any other ("duplicate": the usual rewrite, then the plain washi tile). Also the brand rule: `brand_logo` is a known fail reason with a hint.
// Fake models: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-duplicate-pictures.ts

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakePicture } from './_fake-picture.mjs'
import { createPreviewHandlers } from '../api/preview.ts'
import { readArt, picturePath, type ImageClient } from '../engine/film-art.ts'
import type { FilmRecord } from '../engine/film.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { DUPLICATE_BITS, hashDistance, pictureHash } from '../engine/picture-pixels.ts'
import { SlidingWindowLimiter } from '../engine/rate-limit.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-20T03:00:00Z')
const BASE = await fakePicture(400, 500)
// four clearly different pictures: the base, mirrored, upside down, and turned
const VARIANTS = [BASE, await sharp(BASE).flop().png().toBuffer(), await sharp(BASE).flip().png().toBuffer(), await sharp(BASE).rotate(180).png().toBuffer(), await sharp(BASE).rotate(90).resize(400, 500, { fit: 'fill' }).png().toBuffer()]

// ---- 1. the fingerprint ----------------------------------------------------------------------------------------------------------------------------------------
{
  const h = await Promise.all(VARIANTS.map((v) => pictureHash(v)))
  check('(1) the same picture has distance 0 from itself and the different pictures are all further apart than the duplicate limit', hashDistance(h[0], h[0]) === 0 && h.every((a, i) => h.every((b, j) => i === j || hashDistance(a, b) > DUPLICATE_BITS)), JSON.stringify(h))
  const w1 = await sharp(VARIANTS[0]).webp({ quality: 80 }).toBuffer()
  const w2 = await sharp(VARIANTS[0]).webp({ quality: 78 }).toBuffer()
  check('(1) the same picture saved twice as webp (the way the film keeps them), even at a slightly different quality, is the same picture (distance within the limit)', hashDistance(await pictureHash(w1), await pictureHash(w2)) <= DUPLICATE_BITS)
}

// ---- 2. a render whose second and third pictures come out the same -------------------------------------------------------------------------------------------
const FILM: FilmRecord = { status: 'ready', lines: ['One.', 'Two.', 'Three.', 'Four.'], pictures: [
  'A woman seen from behind at a quiet kitchen counter in soft morning light, a bowl in front of her',
  'Two hands holding a closed lunch box over a wooden table, window light across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight',
  'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table' ], made_at: NOW.toISOString() }
const OKV = { ok: true, reason: 'ok' }
// the picture check answers one verdict per picture; the rewrite (a plain-text prompt) answers { picture }
const vision = {
  messages: {
    stream: (params: { messages: { content: unknown }[] }) => ({
      finalMessage: async () => {
        const content = params.messages[0].content
        const text = typeof content === 'string' ? JSON.stringify({ picture: 'A wide, quiet view of the kitchen window at dusk, a kettle on the stove, nobody in sight, soft grey light across the table' }) : JSON.stringify({ pictures: (content as { type: string }[]).filter((b) => b.type === 'image').map(() => OKV) })
        return { content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
      },
    }),
  },
}
const rig = (pick: (prompt: string, call: number) => Buffer) => {
  const store = new MemoryOrderStore()
  const logs: string[] = []
  let call = 0
  const image: ImageClient = { async generate(prompt: string) { await new Promise((r) => setTimeout(r, 3)); return { bytes: pick(String(prompt), call++), model: 'fake-image' } } }
  const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async () => JSON.parse(JSON.stringify(FILM)), image, vision: vision as never, env: { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_RENDER_MS: '20000', ICHIREI_FILM_CHECK_WAITS_MS: '0', ICHIREI_FILM_QUOTA_WAITS_MS: '0' } as never, log: (l: string) => logs.push(l), pollMs: 10, daily: new SlidingWindowLimiter(5, 86_400_000) }))
  const start = async () => (await (await H.start(new Request('http://x/api/preview', { method: 'POST', body: JSON.stringify({ story: 'She cooked for us every Thanksgiving and never once sat down before everyone else had eaten.', language: 'en', relationship: 'parent_mother', purpose: 'thanks', shown: ['支'] }) }))).json()) as { id: string }
  return { store, logs, H, start, calls: () => call }
}
const distinctStored = async (store: MemoryOrderStore, id: string, art: { slots: string[] } | null): Promise<{ n: number; distinct: boolean }> => {
  const hs: string[] = []
  for (let i = 0; i < 4; i++) if (art?.slots[i] === 'ai') hs.push(await pictureHash((await store.getObject(picturePath(id, i + 1)))!))
  return { n: hs.length, distinct: hs.every((a, i) => hs.every((b, j) => i === j || hashDistance(a, b) > DUPLICATE_BITS)) }
}
{
  // call 0,1,2,3 are the first draws of slots 1..4 (all at once); slots 2 and 3 (calls 1, 2) come back as the SAME picture; the redraw gets a different one
  const r = rig((_p, c) => (c === 1 || c === 2 ? VARIANTS[1] : c < 4 ? VARIANTS[c] : VARIANTS[4]))
  const { id } = await r.start()
  await r.H.render(id)
  const art = await readArt(r.store, id)
  const d = await distinctStored(r.store, id, art)
  check('(2) a picture that came out the same as another is refused ("duplicate" in the log), drawn again from a rewritten view, and the film ends with four DIFFERENT pictures', d.n === 4 && d.distinct && r.logs.some((l) => /duplicate/.test(l)), JSON.stringify({ slots: art?.slots, n: d.n, logs: r.logs.filter((l) => /fail|duplicate/.test(l)).slice(0, 4) }))
}
{
  // the image model only ever draws ONE picture: the first is kept, the others are refused as duplicates, and after their one rewrite they end as plain washi tiles — never four copies
  const r = rig(() => VARIANTS[0])
  const { id } = await r.start()
  await r.H.render(id)
  const art = await readArt(r.store, id)
  const d = await distinctStored(r.store, id, art)
  check('(2) when every draw is the same picture, only ONE of them is kept; the rest end as washi — never the same image twice in one film', d.n === 1 && d.distinct && art?.slots.filter((s) => s === 'washi').length === 3, JSON.stringify({ slots: art?.slots, n: d.n }))
}

// ---- 3. the brand rule -------------------------------------------------------------------------------------------------------------------------------------------
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  const check1 = read('engine/film-picture-check-prompt.md')
  check('(3) the picture check names "brand_logo" (a maker\'s name or emblem on a car, phone, bag or shop) as a fail reason', /"brand_logo"/.test(check1) && /steering wheel/.test(check1))
  check('(3) the film script and scene prompts say: no brand names, logos or readable trademarks (cars, phones, bags, shops)', /readable trademarks/.test(read('engine/film-prompt.md')) && /readable trademarks/.test(read('engine/film-scene-prompt.md')))
  const art = read('engine/film-art.ts')
  check('(3) brand_logo is a known reason (REASONS, the retry hint, the rewrite feedback and the failure list), so the existing one rewrite applies', (art.match(/brand_logo/g) ?? []).length >= 4)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
