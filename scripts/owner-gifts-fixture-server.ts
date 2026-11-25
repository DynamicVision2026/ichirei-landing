// A tiny server for the browser checks and the screenshot of /ops/gifts/new: the real owner gift handlers with FAKE models (no key, no network, no API credit) and the real picture route.
// The engine gives a fixed result, the poem, the film script and the pictures are stand-ins. Prints "listening <port>" and waits.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/owner-gifts-fixture-server.ts [port]

process.env.ICHIREI_DUPLICATE_CHECK = 'off'

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createOwnerGiftHandlers } from '../api/ops-gifts.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import type { FilmRecord } from '../engine/film.ts'

const NOW = new Date('2026-11-25T03:00:00Z')
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const store = new MemoryOrderStore()
const env = { ICHIREI_OPS_PASSWORD: 'pw', ICHIREI_OWNER_API_TOKEN: 'fixture-token-not-real', ICHIREI_FILM_RENDER_MS: '20000' } as NodeJS.ProcessEnv
const FILM: FilmRecord = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [
  'A woman seen from behind standing at a quiet kitchen counter in soft morning light, a small bento box in front of her',
  'Two hands holding a closed modern lunch box over a wooden table, window light falling across the grain of the wood',
  'A quiet hallway with a pair of slippers by a door and morning light on the floor, nobody in sight, a single bag left',
  'A small flower laid on a closed box beside a window, a cup of tea steaming softly on the table in the afternoon' ], made_at: NOW.toISOString() }
const papers = ['#d8d0bc', '#d3cbb2', '#dcd2b8', '#cfc6ac']
let n = 0
const picture = async (paper: string) => {
  const w = 400, h = 500
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 400 500"><rect width="400" height="500" fill="${paper}"/><ellipse cx="200" cy="360" rx="170" ry="42" fill="#3a352c" opacity="0.72"/><polygon points="70,230 150,160 230,230" fill="#2a2620" opacity="0.85"/><rect x="95" y="230" width="110" height="80" fill="#4a4338" opacity="0.8"/><rect x="130" y="262" width="26" height="48" fill="#17140f"/><ellipse cx="300" cy="300" rx="16" ry="30" fill="#1d1a15"/><circle cx="300" cy="262" r="12" fill="#1d1a15"/><circle cx="330" cy="120" r="26" fill="#6b6354" opacity="0.8"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
const vision = { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: [{ ok: true, reason: 'ok' }] }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
const image = { async generate() { return { bytes: await picture(papers[n++ % 4]), model: 'fake-image' } } }
const POEM = { type: 'tanka', lines: ['朝の台所', '包みし弁当', '言わぬまま', '母の背中に', '春の光が'], pattern: null, aids: { kakikudashi: null, romaji: null, english: null }, reading: 'あさのだいどころ' }
const handlers = createOwnerGiftHandlers(() => ({
  store, env, now: () => NOW, readSecret: async () => '', engine: (async () => JSON.parse(JSON.stringify(GOLDEN))) as never, poem: (async () => ({ ok: true, poem: POEM })) as never,
  film: async () => JSON.parse(JSON.stringify(FILM)), image, vision: vision as never, log: () => {}, pollMs: 5, waitMs: 15_000,
}))
const animation = createAnimationHandlers(() => ({ store, env, now: () => NOW, vision: vision as never, log: () => {} }))
const gifts = createGiftHandlers(() => ({ store, env, now: () => NOW, vision: vision as never, log: () => {} }))

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const r = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
  let out: Response
  const pic = /^\/api\/film\/(AN-[a-z2-9]{20})\/picture\/([1-4])\.webp$/.exec(url.pathname)
  const one = /^\/ops\/api\/gifts\/(IC-[0-9]{8}-[A-Z0-9]{8})$/.exec(url.pathname)
  const view = /^\/api\/gift\/(RG-[a-z2-9]{20})$/.exec(url.pathname)
  if (url.pathname === '/ops/api/gifts') out = req.method === 'POST' ? await handlers.create(r) : await handlers.list(r)
  else if (one) out = await handlers.get(r, one[1])
  else if (url.pathname === '/ops/gifts/new') out = await handlers.page(r)
  else if (pic) out = await animation.picture(pic[1], pic[2])
  else if (view) out = await gifts.view(view[1])
  else out = new Response('not found', { status: 404 })
  res.writeHead(out.status, Object.fromEntries(out.headers))
  res.end(Buffer.from(await out.arrayBuffer()))
})
server.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => console.log(`listening ${(server.address() as { port: number }).port}`))
