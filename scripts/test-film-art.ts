// The pictures of the story film (engine/film-art.ts): the fixed style, the Vertex AI client (against a fake server), the picture check, the drawing of
// a set with its per-slot retry and washi fallback, the lock, the limits, and the private storage. The image model and the vision check are FAKES here:
// this suite proves the plumbing and the rules, NOT what Google's model draws or Claude sees.
//
//   node --experimental-strip-types scripts/test-film-art.ts

import http from 'node:http'
import sharp from 'sharp'
import { SAMPLE_IDS, SAMPLE_RECORDS, animationView } from '../engine/animation.ts'
import { IMAGE_STYLE, IMAGE_STYLE_MEMORIAL, ImageError, artPath, buildCheckPrompt, buildImagePrompt, checkPictures, dailyMax, ensureArt, parseVerdicts, picturePath, readArt, rendersPath, toFilmWebp, vertexImageClient, type ArtDeps, type ImageClient, type Verdict } from '../engine/film-art.ts'
import { GcsOrderStore, MemoryOrderStore, assertObjectPath } from '../engine/order-store.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const PNG = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
const FILM = SAMPLE_RECORDS[SAMPLE_IDS.ja].film!
const mkId = (name: string) => `AN-${(name + '2'.repeat(20)).slice(0, 20)}`
const ID = mkId('art')
const NOW = new Date('2026-10-28T03:00:00Z')
const mem = () => new MemoryOrderStore()

// ---- 1. the style and the prompts -----------------------------------------------------------------------------------------------------------------------
{
  const p = buildImagePrompt('a mother\'s hand placing one flower on a bento box', false)
  check('(1) the image prompt = the fixed sumi-e style + the picture description: ink-wash on washi, no faces, no text, silhouettes / hands / from behind, 4:5', p.startsWith(IMAGE_STYLE) && p.includes('Japanese sumi-e ink-wash painting on warm off-white washi paper') && p.includes('no faces or facial features') && p.includes('No text, letters, signatures, seals or frames') && p.includes('Portrait 4:5') && p.includes("Scene: a mother's hand placing one flower on a bento box") && !p.includes(IMAGE_STYLE_MEMORIAL))
  const m = buildImagePrompt('x', true, 'Absolutely no faces.')
  check('(1) a remembrance film adds the paler grey-beige line; a second try adds the hint for why the first failed', m.includes('Paler grey-beige paper, very soft ink, still and calm.') && m.endsWith('Absolutely no faces.'))
  const c = buildCheckPrompt(['one', 'two'], true)
  check('(1) the picture-check prompt (a prompt file, not code) lists the descriptions, names every reason, and says when "celebration" applies', c.includes('Picture 1: one') && c.includes('Picture 2: two') && ['face', 'text', 'illness', 'celebration', 'unsafe', 'off_story'].every((r) => c.includes(`"${r}"`)) && c.includes('REMEMBRANCE film') && buildCheckPrompt(['a'], false).includes('ignore "celebration"') && !/\{\{ [A-Z]+ \}\}/.test(c))
}

// ---- 2. the Vertex AI client (a fake server) ---------------------------------------------------------------------------------------------------------------
type Seen = { url: string; auth: string; body: any }
const seen: Seen[] = []
let vertexMode: 'ok' | 'first404' | '403' | '429' | 'blocked' | 'noimage' | 'hang' | '500' = 'ok'
const vertex = http.createServer(async (req, res) => {
  let raw = ''
  for await (const ch of req) raw += ch
  seen.push({ url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: JSON.parse(raw || '{}') })
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (vertexMode === 'hang') return
  if (vertexMode === '403') return send(403, { error: { message: 'denied' } })
  if (vertexMode === '429') return send(429, { error: { message: 'quota' } })
  if (vertexMode === '500') return send(500, { error: { message: 'boom' } })
  if (vertexMode === 'first404' && (req.url ?? '').includes('gemini-3.1-flash-image')) return send(404, { error: { message: 'not found' } })
  if (vertexMode === 'blocked') return send(200, { candidates: [{ finishReason: 'IMAGE_SAFETY' }], promptFeedback: { blockReason: 'SAFETY' } })
  if (vertexMode === 'noimage') return send(200, { candidates: [{ content: { parts: [{ text: 'sorry' }] } }] })
  send(200, { candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] })
})
await new Promise<void>((r) => vertex.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(vertex.address() as { port: number }).port}`
const venv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ICHIREI_FILM_IMAGE_BASE: base, ICHIREI_FILM_IMAGE_TOKEN: 'tok-test', ICHIREI_FILM_IMAGE_PROJECT: 'proj-x', ...over }) as never
const sig = () => AbortSignal.timeout(5000)
{
  const c = vertexImageClient(venv())
  const r = await c.generate('PROMPT-1', sig())
  const s = seen.at(-1)!
  check('(2) the request: POST …/v1/projects/<project>/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent with the service account\'s bearer token (no API key), the prompt, 4:5', s.url === '/v1/projects/proj-x/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent' && s.auth === 'Bearer tok-test' && s.body.contents[0].parts[0].text === 'PROMPT-1' && s.body.generationConfig.imageConfig.aspectRatio === '4:5' && JSON.stringify(s.body.generationConfig.responseModalities).includes('IMAGE') && r.model === 'gemini-3.1-flash-image' && r.bytes.length === PNG.length)
  const reg = vertexImageClient(venv({ ICHIREI_FILM_IMAGE_LOCATION: 'us-central1', ICHIREI_FILM_IMAGE_MODEL: 'my-model' }))
  await reg.generate('x', sig())
  check('(2) the location and the model come from the environment (ICHIREI_FILM_IMAGE_LOCATION / _MODEL)', seen.at(-1)!.url.includes('/locations/us-central1/publishers/google/models/my-model:generateContent'))
  vertexMode = 'first404'
  seen.length = 0
  const fb = vertexImageClient(venv())
  const r2 = await fb.generate('x', sig())
  const r3 = await fb.generate('y', sig())
  check('(2) a model that is not found (404) hands over to the next one in the list; the one that worked is tried first from then on', r2.model === 'gemini-2.5-flash-image' && seen.length === 3 && seen[0].url.includes('gemini-3.1') && seen[1].url.includes('gemini-2.5') && r3.model === 'gemini-2.5-flash-image' && seen[2].url.includes('gemini-2.5'))
  vertexMode = '403'
  const e403 = await vertexImageClient(venv()).generate('x', sig()).catch((e) => e)
  vertexMode = '429'
  const e429 = await vertexImageClient(venv()).generate('x', sig()).catch((e) => e)
  vertexMode = '500'
  const e500 = await vertexImageClient(venv()).generate('x', sig()).catch((e) => e)
  vertexMode = 'blocked'
  const eb = await vertexImageClient(venv()).generate('x', sig()).catch((e) => e)
  vertexMode = 'noimage'
  const en = await vertexImageClient(venv()).generate('x', sig()).catch((e) => e)
  vertexMode = 'first404'
  const allMissing = await vertexImageClient(venv({ ICHIREI_FILM_IMAGE_MODEL: 'gemini-3.1-flash-image' })).generate('x', sig()).catch((e) => e)
  vertexMode = 'hang'
  const eh = await vertexImageClient(venv()).generate('x', AbortSignal.timeout(150)).catch((e) => e)
  vertexMode = 'ok'
  check('(2) errors carry a code and never a body: permission (403), quota (429), http (500), blocked (a safety refusal), no_image, model_not_found (every model 404), and a timeout', [e403, e429, e500, eb, en, allMissing].every((e) => e instanceof ImageError) && e403.code === 'permission' && e429.code === 'quota' && e500.code === 'http' && eb.code === 'blocked' && en.code === 'no_image' && allMissing.code === 'model_not_found' && eh instanceof Error)
  // the metadata server (production): token and project id
  const metaCalls: string[] = []
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    if (url.startsWith('http://metadata.google.internal')) {
      metaCalls.push(url.split('/computeMetadata/v1/')[1])
      check('(2) the metadata server is asked with the Metadata-Flavor header', ((init?.headers ?? {}) as Record<string, string>)['Metadata-Flavor'] === 'Google')
      return url.endsWith('project-id') ? new Response('proj-meta') : new Response(JSON.stringify({ access_token: 'tok-meta', expires_in: 3600 }))
    }
    return fetch(url, init)
  }) as unknown as typeof fetch
  seen.length = 0
  const prod = vertexImageClient({ ICHIREI_FILM_IMAGE_BASE: base } as never, fakeFetch)
  await prod.generate('x', sig())
  await prod.generate('y', sig())
  check('(2) in production no key is configured: the project id and the access token come from the metadata server (once each, the token is kept)', seen[0].auth === 'Bearer tok-meta' && seen[0].url.includes('/projects/proj-meta/') && metaCalls.filter((m) => m.endsWith('project-id')).length === 1 && metaCalls.filter((m) => m.includes('token')).length === 1)
}
{
  const w = await toFilmWebp(PNG)
  const meta = await sharp(w).metadata()
  check('(2) every picture is saved as WebP at 1080 × 1350 (4:5) whatever size the model returned', meta.format === 'webp' && meta.width === 1080 && meta.height === 1350)
}

// ---- 3. the picture check ---------------------------------------------------------------------------------------------------------------------------------
type Call = { content: any[]; model: string }
function fakeVision(plan: (call: number, n: number) => Verdict[] | string | Error) {
  const calls: Call[] = []
  const client = {
    messages: {
      stream: (params: any) => ({
        finalMessage: async () => {
          const n = params.messages[0].content.filter((b: any) => b.type === 'image').length
          calls.push({ content: params.messages[0].content, model: params.model })
          const out = plan(calls.length, n)
          if (out instanceof Error) throw out
          const text = typeof out === 'string' ? out : JSON.stringify({ pictures: out })
          return { content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 50 }, stop_reason: 'end_turn' }
        },
      }),
    },
  }
  return { client: client as never, calls }
}
const OK: Verdict = { ok: true, reason: 'ok' }
function FAIL(reason: string): Verdict {
  return { ok: false, reason }
}
{
  const v = parseVerdicts('```json\n{"pictures":[{"ok":true,"reason":"ok"},{"ok":false,"reason":"face"},{"ok":true,"reason":"face"},{"ok":false,"reason":"nonsense"}]}\n```', 4)
  check('(3) verdicts are read strictly: a pass needs ok:true AND reason "ok"; an unknown reason is a failure (off_story); a wrong count or unreadable text is no answer', v !== null && v[0].ok && !v[1].ok && v[1].reason === 'face' && !v[2].ok && !v[3].ok && v[3].reason === 'off_story' && parseVerdicts('{"pictures":[]}', 4) === null && parseVerdicts('no', 1) === null)
  const vis = fakeVision(() => [OK, FAIL('text')])
  const jpeg = await sharp(PNG).jpeg().toBuffer()
  const r = await checkPictures(vis.client, [jpeg, jpeg], ['d one', 'd two'], false, { ICHIREI_FILM_CHECK_MODEL: '' } as never)
  const blocks = vis.calls[0].content
  check('(3) ONE call to claude-haiku-5-5 sees all the pictures together with their descriptions (prompt first, then "Picture n:" and the image)', vis.calls.length === 1 && vis.calls[0].model === 'claude-haiku-5-5' && blocks[0].type === 'text' && blocks[0].text.includes('Picture 2: d two') && blocks.filter((b: any) => b.type === 'image').length === 2 && blocks.find((b: any) => b.type === 'image').source.media_type === 'image/jpeg' && r.verdicts[1].reason === 'text' && r.input_tokens === 1000)
  const bad = fakeVision((n) => (n === 1 ? 'I think they are fine' : [OK, OK]))
  const r2 = await checkPictures(bad.client, [jpeg, jpeg], ['a', 'b'], false)
  const dead = fakeVision(() => new Error('overloaded'))
  const e = await checkPictures(dead.client, [jpeg], ['a'], false).catch((x) => x)
  check('(3) an unreadable answer is asked for once more; a check that cannot run in two tries throws (the caller then shows no unchecked picture)', bad.calls.length === 2 && r2.verdicts.every((x) => x.ok) && dead.calls.length === 2 && e instanceof ImageError && e.code === 'check')
}

// ---- 4. drawing a set -----------------------------------------------------------------------------------------------------------------------------------------
interface Rig { deps: ArtDeps; store: MemoryOrderStore; prompts: string[]; logs: string[]; imageCalls: () => number; maxParallel: () => number; vis: ReturnType<typeof fakeVision> }
function rig(opts: { image?: (prompt: string, n: number) => Promise<void> | void; vision?: (call: number, n: number) => Verdict[] | string | Error; env?: Record<string, string>; store?: MemoryOrderStore } = {}): Rig {
  const store = opts.store ?? mem()
  const prompts: string[] = []
  let n = 0
  let running = 0
  let max = 0
  const image: ImageClient = {
    async generate(prompt) {
      prompts.push(prompt)
      const mine = ++n
      running++
      max = Math.max(max, running)
      try {
        await sleep(15)
        await opts.image?.(prompt, mine)
      } finally {
        running--
      }
      return { bytes: PNG, model: 'fake-image-model' }
    },
  }
  const vis = fakeVision(opts.vision ?? ((_c, k) => Array(k).fill(OK)))
  const logs: string[] = []
  return { deps: { store, image, client: vis.client, env: { ICHIREI_FILM_DAILY_MAX: '1000', ...(opts.env ?? {}) } as never, log: (l) => logs.push(l), now: () => NOW, pollMs: 15 }, store, prompts, logs, imageCalls: () => n, maxParallel: () => max, vis }
}
const input = (id = ID, memorial = false) => ({ id, film: FILM, memorial })
const eventsOf = (logs: string[]) => logs.map((l) => JSON.parse(l.replace('[ichirei-film] ', '')))
{
  const r = rig()
  const art = await ensureArt(r.deps, input())
  const saved = await readArt(r.store, ID)
  const objs = [1, 2, 3, 4].map((i) => r.store.objects.get(picturePath(ID, i)))
  const meta = await Promise.all(objs.map((o) => sharp(o!.body).metadata()))
  const ev = eventsOf(r.logs)
  check('(4) a set: four pictures drawn IN PARALLEL (one image call each, from the film\'s own descriptions), one picture check, four WebP 1080×1350 objects films/<id>/1..4.webp and art.json {done, all ai}', art.status === 'done' && art.slots.join() === 'ai,ai,ai,ai' && r.imageCalls() === 4 && r.maxParallel() === 4 && r.vis.calls.length === 1 && meta.every((m) => m.format === 'webp' && m.width === 1080 && m.height === 1350) && objs.every((o) => o!.contentType === 'image/webp') && saved?.status === 'done' && r.prompts.every((p, i) => p.includes(FILM.pictures[i]) || FILM.pictures.some((d) => p.includes(d))))
  check('(4) logs: film_render_start, film_render_done with the time, the picture count and an estimated cost in yen — and no story text or description', ev[0].event === 'film_render_start' && ev.at(-1).event === 'film_render_done' && ev.at(-1).pictures === 4 && ev.at(-1).est_cost_jpy > 0 && typeof ev.at(-1).ms === 'number' && !r.logs.join('\n').includes('bento') && !r.logs.join('\n').includes('flower'), r.logs.join('\n'))
  const again = rig({ store: r.store })
  const second = await ensureArt(again.deps, input())
  check('(4) the pictures are saved: a later open draws nothing (no image call, no check) and gets the same set', second.status === 'done' && again.imageCalls() === 0 && again.vis.calls.length === 0)
  const v = animationView({ ...SAMPLE_RECORDS[SAMPLE_IDS.ja], id: ID }, art)
  check('(4) the view then carries the four private picture addresses (/api/film/<id>/picture/<n>.webp), never a bucket address', v.film?.pictures?.length === 4 && v.film.pictures.every((u, i) => u.startsWith(`/api/film/${ID}/picture/${i + 1}.webp`)) && !JSON.stringify(v).includes('storage.googleapis'))
}
{
  const r = rig({ vision: (call, k) => (call === 1 ? [OK, FAIL('face'), OK, OK] : Array(k).fill(OK)) })
  const art = await ensureArt(r.deps, input())
  const ev = eventsOf(r.logs)
  check('(4) a picture that fails the check (a face) is drawn ONCE more — with a hint for why — and then passes: five image calls, two checks, all four saved', art.slots.join() === 'ai,ai,ai,ai' && r.imageCalls() === 5 && r.vis.calls.length === 2 && r.prompts[4].includes('Absolutely no faces') && r.vis.calls[1].content.filter((b: any) => b.type === 'image').length === 1 && ev.some((e) => e.event === 'film_picture_fail' && e.slot === 2 && e.reason === 'face'))
}
{
  const r = rig({ vision: (_c, k) => (k === 4 ? [OK, FAIL('text'), OK, FAIL('illness')] : Array(k).fill(FAIL('text'))) })
  const art = await ensureArt(r.deps, input())
  check('(4) a picture that fails twice gets the plain washi picture; the film is still done and the other pictures are kept; nothing failed is saved', art.status === 'done' && art.slots.join() === 'ai,washi,ai,washi' && r.imageCalls() === 6 && !r.store.objects.has(picturePath(ID, 2)) && !r.store.objects.has(picturePath(ID, 4)) && r.store.objects.has(picturePath(ID, 1)) && art.reasons?.[1] === 'text' && art.reasons?.[3] === 'text' && eventsOf(r.logs).filter((e) => e.event === 'film_picture_fail').length === 4)
}
{
  let fail = new Set([2])
  const r = rig({ image: (_p, n) => { if (fail.has(n)) throw new ImageError('http') } })
  const art = await ensureArt(r.deps, input())
  check('(4) an image error (slot 2 once) → that picture is drawn once more and the film gets all four; film_image_error is logged with the slot and the code', art.slots.join() === 'ai,ai,ai,ai' && r.imageCalls() === 5 && eventsOf(r.logs).some((e) => e.event === 'film_image_error' && e.slot === 2 && e.code === 'http'), JSON.stringify([art, r.imageCalls(), r.logs]))
  fail = new Set()
  const down = rig({ image: () => { throw new ImageError('permission') } })
  const dart = await ensureArt(down.deps, input(mkId('downdowndowndowndo22')))
  const again = await ensureArt(rig({ store: down.store }).deps, input(mkId('downdowndowndowndo22')))
  check('(4) the image model is down (all four fail, twice): all four are washi, the film still plays, at most 4 + 4 calls were made (one set plus single retries) — and a later open does not start again', dart.status === 'done' && dart.slots.join() === 'washi,washi,washi,washi' && down.imageCalls() === 8 && down.vis.calls.length === 0 && eventsOf(down.logs).filter((e) => e.event === 'film_image_error').length === 8 && again.status === 'done')
}
{
  const r = rig({ vision: () => new Error('overloaded') })
  const art = await ensureArt(r.deps, input(mkId('checkdowncheckdown22')))
  check('(4) the picture check cannot run: NO unchecked picture is shown — all washi, nothing saved but the state, film_check_error logged; the film plays', art.slots.join() === 'washi,washi,washi,washi' && r.store.objects.size === 1 && eventsOf(r.logs).some((e) => e.event === 'film_check_error') && r.imageCalls() === 4)
}
{
  const r = rig()
  await ensureArt(r.deps, input(mkId('memmemmemmemmemmem222'), true))
  check('(4) a remembrance film: every image prompt carries the paler grey-beige line, and the check is told it is a remembrance film (celebration is checked)', r.prompts.every((p) => p.includes('Paler grey-beige paper')) && r.vis.calls[0].content[0].text.includes('This is a REMEMBRANCE film') && r.vis.calls[0].content[0].text.includes('check "celebration"'))
  const f = rig()
  const art = await ensureArt(f.deps, { id: mkId('fallbackfallbackfa22'), film: { status: 'fallback', lines: ['a', 'b'], pictures: [], made_at: NOW.toISOString() }, memorial: false })
  check('(4) a fallback script (two lines) has nothing to draw: no image call, no check, no object — two washi slots', art.slots.join() === 'washi,washi' && f.imageCalls() === 0 && f.vis.calls.length === 0 && f.store.objects.size === 0)
}

// ---- 5. the lock ------------------------------------------------------------------------------------------------------------------------------------------------
{
  const r = rig()
  const [a, b, c] = await Promise.all([ensureArt(r.deps, input(mkId('lockedlockedlockedl2'))), ensureArt(r.deps, input(mkId('lockedlockedlockedl2'))), ensureArt(rig({ store: r.store }).deps, input(mkId('lockedlockedlockedl2')))])
  check('(5) three opens at once make ONE set: four image calls in all, the same result for everyone (in this process, and across instances through the create-if-absent lease)', r.imageCalls() === 4 && [a, b, c].every((x) => x.status === 'done' && x.slots.join() === 'ai,ai,ai,ai'))
  // another instance holds a fresh lease: wait for it
  const store = mem()
  const id = mkId('leaseleaseleaselea22')
  await store.putObject(artPath(id), JSON.stringify({ schema: 'film-art', id, status: 'rendering', started_at: NOW.toISOString(), slots: [] }), 'application/json')
  const w = rig({ store })
  const waiting = ensureArt(w.deps, input(id))
  await sleep(80)
  const stillWaiting = w.imageCalls() === 0
  await store.putObject(artPath(id), JSON.stringify({ schema: 'film-art', id, status: 'done', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
  const got = await waiting
  check('(5) a fresh lease of another instance is WAITED for (no second set); when it finishes its result is returned', stillWaiting && got.status === 'done' && w.imageCalls() === 0)
  const store2 = mem()
  const id2 = mkId('staleleasestaleleas22')
  await store2.putObject(artPath(id2), JSON.stringify({ schema: 'film-art', id: id2, status: 'rendering', started_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(), slots: [] }), 'application/json')
  const s = rig({ store: store2 })
  const took = await ensureArt(s.deps, input(id2))
  check('(5) a stale lease (a crashed instance, minutes old) is taken over and the set is drawn', took.status === 'done' && s.imageCalls() === 4)
  const first = await mem().putObject(artPath(ID), 'a', 'application/json', { ifAbsent: true })
  const m2 = mem()
  await m2.putObject(artPath(ID), 'a', 'application/json', { ifAbsent: true })
  check('(5) the store\'s ifAbsent write is a real lock (the second writer gets false)', first === true && (await m2.putObject(artPath(ID), 'b', 'application/json', { ifAbsent: true })) === false && (await m2.getObject(artPath(ID)))!.toString() === 'a')
}

// ---- 6. the daily limit ------------------------------------------------------------------------------------------------------------------------------------------
{
  check('(6) ICHIREI_FILM_DAILY_MAX: 200 by default, a number, or off', dailyMax({} as never) === 200 && dailyMax({ ICHIREI_FILM_DAILY_MAX: '5' } as never) === 5 && dailyMax({ ICHIREI_FILM_DAILY_MAX: 'off' } as never) === Infinity)
  const store = mem()
  const r = rig({ store, env: { ICHIREI_FILM_DAILY_MAX: '2' } })
  const a = await ensureArt(r.deps, input(mkId('dayonedayonedayone22')))
  const b = await ensureArt(r.deps, input(mkId('daytwodaytwodaytwo222')))
  const calls = r.imageCalls()
  const c = await ensureArt(r.deps, input(mkId('daythreedaythreedayt22')))
  const view = animationView({ ...SAMPLE_RECORDS[SAMPLE_IDS.ja], id: mkId('daythreedaythreedayt22') }, c)
  check('(6) above the daily limit (here 2) the third set is NOT drawn: no image call, the state is "deferred" (the page says 「映像は明日お届けします」), the count is kept in films/renders-<day>.jsonl', a.status === 'done' && b.status === 'done' && c.status === 'deferred' && r.imageCalls() === calls && view.film?.deferred === true && view.film.pictures === null && (await store.getObject(rendersPath('2026-10-28')))!.toString().trim().split('\n').length === 2 && eventsOf(r.logs).some((e) => e.event === 'film_render_deferred'))
  const same = await ensureArt(r.deps, input(mkId('daythreedaythreedayt22')))
  const next = rig({ store, env: { ICHIREI_FILM_DAILY_MAX: '2' } })
  next.deps.now = () => new Date('2026-10-29T03:00:00Z')
  const later = await ensureArt(next.deps, input(mkId('daythreedaythreedayt22')))
  check('(6) the same day it stays deferred (no spend); the next day the same film is drawn', same.status === 'deferred' && later.status === 'done' && next.imageCalls() === 4)
}

// ---- 7. private storage -------------------------------------------------------------------------------------------------------------------------------------------
{
  const reqs: { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = []
  const objects = new Map<string, Buffer>()
  const gcs = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const ch of req) chunks.push(ch as Buffer)
    reqs.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) })
    const u = new URL(req.url ?? '', 'http://x')
    if (req.method === 'POST') {
      const name = u.searchParams.get('name')!
      if (u.searchParams.get('ifGenerationMatch') === '0' && objects.has(name)) { res.writeHead(412); return res.end() }
      objects.set(name, Buffer.concat(chunks))
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('{}')
    }
    const name = decodeURIComponent(u.pathname.split('/o/')[1] ?? '')
    if (!objects.has(name)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(objects.get(name))
  })
  await new Promise<void>((r) => gcs.listen(0, '127.0.0.1', r))
  const store = new GcsOrderStore('private-bucket', { apiBase: `http://127.0.0.1:${(gcs.address() as { port: number }).port}`, staticToken: 'tok' })
  const webp = await toFilmWebp(PNG)
  const ok1 = await store.putObject(picturePath(ID, 1), webp, 'image/webp')
  const lock1 = await store.putObject(artPath(ID), '{}', 'application/json', { ifAbsent: true })
  const lock2 = await store.putObject(artPath(ID), '{}', 'application/json', { ifAbsent: true })
  const back = await store.getObject(picturePath(ID, 1))
  const miss = await store.getObject(picturePath(ID, 2))
  const up = reqs.filter((r) => r.method === 'POST')
  check('(7) the bucket stays private: objects are uploaded with a plain media upload — no predefinedAcl, no ACL entries, no allUsers — to films/<id>/…, and read back with the service account\'s token', ok1 && up.every((r) => !/predefinedAcl|acl/i.test(r.url) && !/allUsers|public/i.test(r.body.toString('latin1').slice(0, 200)) && r.headers.authorization === 'Bearer tok') && up[0].url.includes(encodeURIComponent(`films/${ID}/1.webp`)) && back!.equals(webp) && miss === null)
  check('(7) ifAbsent maps to ifGenerationMatch=0: the second lock write gets 412 and returns false', lock1 === true && lock2 === false && up.filter((r) => r.url.includes('ifGenerationMatch=0')).length === 2)
  const bad = ['films/../orders/IC-20261023-ABCDEFGH.json', 'orders/IC-20261023-ABCDEFGH.json', `films/${ID}/5.webp`, `films/${ID}/../x.webp`, 'films/AN-short/1.webp', `films/${ID}/1.png`, 'films/', '../films/x']
  const errs = await Promise.all(bad.map((p) => store.getObject(p).then(() => 'read', () => 'refused')))
  check('(7) only films/<animation id>/(1–4.webp | art.json) and the daily count can be read or written through the object API: orders, path tricks, other names are refused', errs.every((e) => e === 'refused') && (() => { try { assertObjectPath(`films/${ID}/art.json`); assertObjectPath(rendersPath('2026-10-28')); return true } catch { return false } })())
  check('(7) nothing lists the bucket: the store has no list function, and the server serves a picture only by id and number (see the API tests)', !('list' in store) && !('listObjects' in store))
  gcs.close()
}

vertex.closeAllConnections?.()
vertex.close()
console.log(failures === 0 ? '\nAll film picture checks passed.' : `\n${failures} film picture check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
