// Part 16 (2026-11-20): a saved gift shows all four pictures, always. Fake models, no key, no network, no cost.
//
// The cause of the empty first picture: My gifts asked the film store for pictures numbered 0–3, while the store (and the result page) number them 1–4 — picture 0 does not exist, so slot 1 was an empty
// striped box, and slots 2–4 showed pictures 1–3. Since 2026-11-20 the server reads the pictures from the film store when the list is asked for.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-basket-pictures.ts

// (the fake image model draws one and the same picture for every slot; the duplicate check has its own test, scripts/test-duplicate-pictures.ts)
process.env.ICHIREI_DUPLICATE_CHECK = 'off'

import { fakePicture } from './_fake-picture.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnimationHandlers } from '../api/animation.ts'
import { createPreviewHandlers } from '../api/preview.ts'
import { listBasket, openBasketLink, saveBasketItem, type SaveInput } from '../engine/basket.ts'
import { artPath, readArt, type ImageClient } from '../engine/film-art.ts'
import { loadArtwork } from '../engine/render/artwork.ts'
import { createGiftHandlers } from '../api/gift.ts'
import type { FilmRecord } from '../engine/film.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { SlidingWindowLimiter } from '../engine/rate-limit.ts'
import { newVisitorId } from '../engine/visitor.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-20T03:00:00Z')
const STORY = 'She cooked for us every Thanksgiving and never once sat down before everyone else had eaten.'
const PNG = await fakePicture(400, 500)
const FILM: FilmRecord = { status: 'ready', lines: ['One.', 'Two.', 'Three.', 'Four.'], pictures: [
  'A woman seen from behind at a quiet kitchen counter in soft morning light, a bowl in front of her',
  'Two hands holding a closed lunch box over a wooden table, window light across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight',
  'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table' ], made_at: NOW.toISOString() }
const OKV = { ok: true, reason: 'ok' }
const vision = { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: [OKV] }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const store = new MemoryOrderStore()
let hold: Promise<void> | null = null
const image: ImageClient = { async generate() { if (hold) await hold; await sleep(5); return { bytes: PNG, model: 'fake-image' } } }
const H = createPreviewHandlers(() => ({ store, now: () => NOW, film: async () => JSON.parse(JSON.stringify(FILM)), image, vision: vision as never, env: { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_RENDER_MS: '20000' } as never, log: () => {}, pollMs: 10, daily: new SlidingWindowLimiter(5, 86_400_000) }))
const A = createAnimationHandlers(() => ({ store, now: () => NOW }))
const started = await (await H.start(new Request('http://x/api/preview', { method: 'POST', body: JSON.stringify({ story: STORY, language: 'en', relationship: 'parent_mother', purpose: 'thanks', shown: ['支'] }) }))).json() as { id: string }

const B = newVisitorId()
const input = (preview: string | null): SaveInput => ({
  resume: { v: 1, story: STORY, followUps: [], result: { candidates: [] } }, story: STORY, language: 'en', kanji: '支', reading: 'shi', word: 'keeper', line: 'She keeps everyone at the table.', to: 'Mom', meaning: 'keeper',
  relationship: 'parent_mother', purpose: 'thanks', occasion: 'thanksgiving', round: 1, slot: 'main', preview_id: preview, poem: { lines: ['one', 'two'], reading: '' },
})
const mine = async () => (await listBasket(store, B)).items[0]

// ---- saved while the pictures are still being made -------------------------------------------------------------------------------------------------------
let release!: () => void
hold = new Promise<void>((r) => { release = r })
const rendering = H.render(started.id)
await sleep(30)
await saveBasketItem(store, B, input(started.id), NOW)
const early = await mine()
check('(1) saved while the pictures are being made: all four are "making" — nothing is empty, nothing is lost', early.pictures.length === 4 && early.pictures.every((p) => p.state === 'making'), JSON.stringify(early.pictures))
release()
await rendering
const done = await mine()
check('(2) once they are made, the same saved item shows all four, addressed 1 to 4 — picture 1 is /picture/1.webp (the store has no picture 0)', done.pictures.length === 4 && done.pictures.every((p, i) => p.state === 'ok' && p.url.startsWith(`/api/film/${started.id}/picture/${i + 1}.webp`)), JSON.stringify(done.pictures))
const urls = done.pictures.map((p) => (p.state === 'ok' ? p.url : ''))
const served = await Promise.all(urls.map(async (u) => A.picture(started.id, (u.match(/picture\/(\d)/) ?? [])[1] ?? '0')))
check('(2) every one of those addresses is served by the film picture route (200, image/webp)', served.every((r) => r.status === 200 && r.headers.get('content-type') === 'image/webp'))
check('(2) the address the route does NOT know — picture 0 — is the one My gifts used to ask for: a 404', (await A.picture(started.id, '0')).status === 404)

// ---- the same numbering everywhere else: the whole-gift PDF / share film / keepsakes (loadArtwork), and the receiver's picture route ---------------------------------------------
{
  const anim = (await store.get(started.id)) as never
  const art = await readArt(store, started.id)
  const aw = await loadArtwork(store, { language: 'en', glyph: '支', reading: 'shi', who: 'x', certificate_line: '', poem: null, memorial: false, purpose: 'thanks', package: 'egift', ship_to: 'none', from: 'A', to: 'B' } as never, anim, art)
  check('(2b) the whole-gift PDF, the share film and the cards read pictures 1–4 from the same store: all four come out as real pictures, picture 1 first', aw.pictures.length === 4 && aw.pictures.every((b) => b !== null && b.length > 500))
  const G = createGiftHandlers(() => ({ store, now: () => NOW }))
  check('(2b) the receiver\'s picture route knows only 1–4 too: picture 0 and 5 are a 404 (the token is checked after the number)', (await G.picture('RG-aaaaaaaaaaaaaaaaaaaaaaaa', '0')).status === 404 && (await G.picture('RG-aaaaaaaaaaaaaaaaaaaaaaaa', '5')).status === 404)
  check('(2b) the numbers handed out by the previews and the film views are 1-based (viewOf): …/picture/1.webp … /picture/4.webp, and nothing carries /picture/0', done.pictures.every((p) => p.state === 'ok' && !p.url.includes('/picture/0')))
}

// ---- picture 1 finished with a different link after the save → My gifts shows the final one -----------------------------------------------------------------
const art0 = JSON.parse((await store.getObject(artPath(started.id)))!.toString('utf8')) as Record<string, unknown>
await store.putObject(artPath(started.id), JSON.stringify({ ...art0, made_at: '2026-11-20T03:05:00.000Z' }), 'application/json')
const later = await mine()
check('(3) the pictures were redone after the save (a new set time): My gifts shows the final links, not the ones from the time of the save', later.pictures[0].state === 'ok' && (later.pictures[0] as { url: string }).url !== urls[0] && (later.pictures[0] as { url: string }).url.includes(`v=${Date.parse('2026-11-20T03:05:00.000Z')}`))

// ---- an old saved item that carries an expired / wrong link of its own is repaired on read --------------------------------------------------------------------
{
  const raw = JSON.parse((await store.getObject(`basket/${later.id}.json`))!.toString('utf8')) as Record<string, unknown>
  raw.pictures = ['https://storage.googleapis.com/old-bucket/films/x/0.webp?X-Goog-Expires=60&X-Goog-Signature=dead', null, null, null]
  await store.putObject(`basket/${later.id}.json`, JSON.stringify(raw), 'application/json')
  const fixed = await mine()
  check('(4) an old saved item with an expired or wrong link of its own: the list ignores it and gives the link read from the draft', fixed.pictures.every((p) => p.state === 'ok' && p.url.startsWith(`/api/film/${started.id}/picture/`)) && !JSON.stringify(fixed.pictures).includes('old-bucket'))
}
{
  const l = await openBasketLink(store, newVisitorId(), 'BT-aaaaaaaaaaaaaaaaaaaaaaaa').catch(() => null)
  check('(4) the private link of a basket gives the same list (and an unknown link gives nothing)', l === null)
}

// ---- a picture that failed for good: the other three only; nothing at all: no pictures -----------------------------------------------------------------------
{
  const art = JSON.parse((await store.getObject(artPath(started.id)))!.toString('utf8')) as { slots: string[] }
  await store.putObject(artPath(started.id), JSON.stringify({ ...art, slots: ['washi', 'ai', 'ai', 'ai'] }), 'application/json')
  const three = await mine()
  check('(5) picture 1 failed for good: it is "none" (the page leaves it out) and the other three stay as they were', three.pictures.map((p) => p.state).join() === 'none,ok,ok,ok')
  await store.putObject(artPath(started.id), JSON.stringify({ ...art, slots: ['washi', 'washi', 'washi', 'washi'] }), 'application/json')
  check('(5) nothing could be drawn: all four are "none"', (await mine()).pictures.every((p) => p.state === 'none'))
  await store.putObject(artPath(started.id), JSON.stringify({ ...art, slots: ['ai', 'pending', 'ai', 'ai'], status: 'rendering' }), 'application/json')
  check('(5) one picture still being drawn: "making" in its place, the others shown', (await mine()).pictures.map((p) => p.state).join() === 'ok,making,ok,ok')
}
{
  await saveBasketItem(store, B, { ...input(null), kanji: '恒' }, NOW)
  const list = (await listBasket(store, B)).items
  const none = list.find((i) => i.card.kanji === '恒')!
  check('(6) a saved item that never had a draft: no pictures (the page leaves the section out), never a placeholder', none.pictures.length === 4 && none.pictures.every((p) => p.state === 'none'))
}
{
  const src = readFileSync(join(process.cwd(), 'src/loop/BasketApp.tsx'), 'utf8')
  check('(7) the page no longer builds picture addresses itself (no "/picture/" in BasketApp) and has no striped placeholder class', !src.includes('/picture/') && !src.includes('mgPicEmpty') && !readFileSync(join(process.cwd(), 'src/loop/loop.css'), 'utf8').includes('mgPicEmpty'))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
