// The pictures of the story film (engine/film-art.ts): the fixed style, the Vertex AI client (against a fake server), the picture check, the drawing of
// a set with its per-slot retry and washi fallback, the lock, the limits, and the private storage. The image model and the vision check are FAKES here:
// this suite proves the plumbing and the rules, NOT what Google's model draws or Claude sees.
//
//   node --experimental-strip-types scripts/test-film-art.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { SAMPLE_IDS, SAMPLE_RECORDS, animationView } from '../engine/animation.ts'
import { IMAGE_STYLE, IMAGE_STYLE_MEMORIAL, ImageError, artPath, buildCheckPrompt, buildImagePrompt, buildRewritePrompt, checkPictures, dailyMax, ensureArt, parseVerdicts, picturePath, readArt, rendersPath, toFilmWebp, uncheckedPath, vertexImageClient, type ArtDeps, type ImageClient, type Verdict } from '../engine/film-art.ts'
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
  const cz = buildCheckPrompt(['one'], false, 'zh-Hant')
  check('(1) the picture check also judges clothes, setting and religious symbols: reasons "clothing", "setting", "religious" (a cross made by a window frame counts), against the buyer\'s language — and an unknown reason is still a failure', ['"clothing"', '"setting"', '"religious"'].every((r) => c.includes(r)) && /window whose frame forms a cross counts/.test(c) && cz.includes('the film\'s language is zh-Hant') && /Chinese home and street \(no Japanese houses, paper lanterns, tatami or torii\)/.test(cz) && buildCheckPrompt(['x'], false, 'ja').includes('the film\'s language is ja') && parseVerdicts('{"pictures":[{"ok":false,"reason":"religious"},{"ok":false,"reason":"clothing"},{"ok":false,"reason":"setting"}]}', 3)!.map((v) => v.reason).join() === 'religious,clothing,setting')
  check('(1) the picture check allows handwriting that cannot be read (a letter, a notebook, soft strokes — the remembrance story is about letters) and fails only readable words', /CANNOT be read as words/.test(c) && /Only words you can actually read fail/.test(c))
  check('(1) the picture-check prompt (a prompt file, not code) lists the descriptions, names every reason, and says when "celebration" applies', c.includes('Picture 1: one') && c.includes('Picture 2: two') && ['face', 'text', 'illness', 'celebration', 'unsafe', 'off_story'].every((r) => c.includes(`"${r}"`)) && c.includes('REMEMBRANCE film') && buildCheckPrompt(['a'], false).includes('ignore "celebration"') && !/\{\{ [A-Z]+ \}\}/.test(c))
}

// ---- 2. the Vertex AI client (a fake server) ---------------------------------------------------------------------------------------------------------------
type Seen = { url: string; auth: string; body: any }
const seen: Seen[] = []
let vertexMode: 'ok' | 'first404' | 'first429' | '403' | '429' | 'blocked' | 'noimage' | 'hang' | '500' = 'ok'
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
  if (vertexMode === 'first429' && (req.url ?? '').includes('gemini-3.1-flash-image')) return send(429, { error: { message: 'quota' } })
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
  vertexMode = 'first429'
  seen.length = 0
  const q = vertexImageClient(venv())
  const rq = await q.generate('x', sig())
  const rq2 = await q.generate('y', sig())
  check('(2) a quota answer (429) from the first model tries the FALLBACK model at once (gemini-2.5-flash-image) — and the first model stays the first choice next time (a quota is not "not found")', rq.model === 'gemini-2.5-flash-image' && seen[0].url.includes('gemini-3.1') && seen[1].url.includes('gemini-2.5') && seen[2].url.includes('gemini-3.1') && rq2.model === 'gemini-2.5-flash-image')
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
const REWRITE_OK = 'hands holding the handle of a plain modern umbrella beside a quiet doorway, soft evening light on the wet ground'
function fakeVision(plan: (call: number, n: number) => Verdict[] | string | Error | { text: string; stop_reason: string } | 'HANG', rewritePlan: (call: number) => string | Error = () => JSON.stringify({ picture: REWRITE_OK })) {
  const calls: (Call & { params: any })[] = []
  const rewrites: { prompt: string; params: any }[] = []
  const client = {
    messages: {
      stream: (params: any, opts?: { signal?: AbortSignal }) => ({
        finalMessage: async () => {
          if (typeof params.messages[0].content === 'string') {
            // the description rewrite (a text-only call)
            rewrites.push({ prompt: params.messages[0].content, params })
            const o = rewritePlan(rewrites.length)
            if (o instanceof Error) throw o
            return { content: [{ type: 'text', text: o }], usage: { input_tokens: 100, output_tokens: 30 }, stop_reason: 'end_turn' }
          }
          const n = params.messages[0].content.filter((b: any) => b.type === 'image').length
          calls.push({ content: params.messages[0].content, model: params.model, params })
          const out = plan(calls.length, n)
          if (out === 'HANG') await new Promise((_, rej) => opts?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
          if (out instanceof Error) throw out
          const o = out as Verdict[] | string | { text: string; stop_reason: string }
          const text = typeof o === 'string' ? o : Array.isArray(o) ? JSON.stringify({ pictures: o }) : o.text
          return { content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 50 }, stop_reason: typeof o === 'object' && !Array.isArray(o) ? o.stop_reason : 'end_turn' }
        },
      }),
    },
  }
  return { client: client as never, calls, rewrites }
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
  check('(3) ONE call to claude-haiku-5-5 sees all the pictures together with their descriptions (prompt first, then "Picture n:" and the image)', vis.calls.length === 1 && vis.calls[0].model === 'claude-haiku-5-5' && blocks[0].type === 'text' && blocks[0].text.includes('Picture 2: d two') && blocks.filter((b: any) => b.type === 'image').length === 2 && blocks.find((b: any) => b.type === 'image').source.media_type === 'image/jpeg' && r.verdicts[1]?.reason === 'text' && r.input_tokens === 1000)
  const bad = fakeVision((call, k) => (call === 1 ? 'I think they are fine' : Array(k).fill(OK)))
  const r2 = await checkPictures(bad.client, [jpeg, jpeg], ['a', 'b'], false)
  check('(3) the check call asks for room and low effort (max_tokens 4000, effort low): the answer is a few dozen tokens but the model may think first', bad.calls[0].params.max_tokens === 4000 && bad.calls[0].params.output_config?.effort === 'low')
  check('(3) an answer that cannot be read over all pictures falls back to ONE CALL PER PICTURE: here 1 batch + 2 singles, both pictures checked; the cause is recorded with the first 200 characters of the reply', bad.calls.length === 3 && r2.verdicts.every((x) => x?.ok === true) && r2.causes[0].kind === 'parse' && r2.causes[0].reply === 'I think they are fine' && r2.causes[0].stop_reason === 'end_turn')
  const cut = fakeVision(() => ({ text: '', stop_reason: 'max_tokens' }))
  const rc = await checkPictures(cut.client, [jpeg], ['a'], false)
  const long = fakeVision(() => 'x'.repeat(500))
  const rl = await checkPictures(long.client, [jpeg], ['a'], false)
  const dead = fakeVision(() => Object.assign(new Error('529 overloaded_error: Overloaded'), { status: 529 }))
  const rd = await checkPictures(dead.client, [jpeg], ['a'], false)
  const hang = fakeVision(() => 'HANG')
  const rh = await checkPictures(hang.client, [jpeg], ['a'], false, { ICHIREI_FILM_CHECK_TIMEOUT_MS: '40' } as never)
  check('(3) the REAL cause is kept for the log: max_tokens (stop reason + empty reply), parse (reply cut to 200 characters), http (the status), timeout — each as a cause, never thrown; a picture that cannot be checked is null (unchecked)', rc.verdicts[0] === null && rc.causes[0].kind === 'max_tokens' && rc.causes[0].stop_reason === 'max_tokens' && rl.causes[0].kind === 'parse' && rl.causes[0].reply!.length === 200 && rd.verdicts[0] === null && rd.causes[0].kind === 'http' && rd.causes[0].status === 529 && rh.causes[0].kind === 'timeout' && dead.calls.length === 1)
  const dead2 = fakeVision(() => new Error('overloaded'))
  const rd2 = await checkPictures(dead2.client, [jpeg, jpeg], ['a', 'b'], false)
  check('(3) two pictures, the check down: one batch call and one single call each (3), every verdict null, three causes (the singles are numbered) — nothing thrown', dead2.calls.length === 3 && rd2.verdicts.every((x) => x === null) && rd2.causes.length === 3 && rd2.causes.filter((c) => c.single).length === 2)
}

// ---- 4. drawing a set -----------------------------------------------------------------------------------------------------------------------------------------
interface Rig { deps: ArtDeps; store: MemoryOrderStore; prompts: string[]; logs: string[]; imageCalls: () => number; maxParallel: () => number; vis: ReturnType<typeof fakeVision> }
function rig(opts: { image?: (prompt: string, n: number) => Promise<void> | void; vision?: Parameters<typeof fakeVision>[0]; rewrite?: Parameters<typeof fakeVision>[1]; env?: Record<string, string>; store?: MemoryOrderStore } = {}): Rig {
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
  const vis = fakeVision(opts.vision ?? ((_c, k) => Array(k).fill(OK)), opts.rewrite)
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
  check('(4) a set: four pictures drawn TWO AT A TIME (one image call each, from the film\'s own descriptions), one picture check, four WebP 1080×1350 objects films/<id>/1..4.webp and art.json {done, all ai}', art.status === 'done' && art.slots.join() === 'ai,ai,ai,ai' && r.imageCalls() === 4 && r.maxParallel() === 2 && r.vis.calls.length === 1 && meta.every((m) => m.format === 'webp' && m.width === 1080 && m.height === 1350) && objs.every((o) => o!.contentType === 'image/webp') && saved?.status === 'done' && r.prompts.every((p, i) => p.includes(FILM.pictures[i]) || FILM.pictures.some((d) => p.includes(d))))
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
  check('(4) a picture that fails again after its description was REWRITTEN gets the plain washi picture for good; the film is done and the other pictures are kept; nothing failed is saved. (round 1: 4 draws, round 2: 2, round 3 after the rewrite: 2 — eight draws, two rewrites)', art.status === 'done' && art.slots.join() === 'ai,washi,ai,washi' && r.imageCalls() === 8 && r.vis.rewrites.length === 2 && !r.store.objects.has(picturePath(ID, 2)) && !r.store.objects.has(picturePath(ID, 4)) && r.store.objects.has(picturePath(ID, 1)) && art.rewrites?.join() === '0,1,0,1' && eventsOf(r.logs).filter((e) => e.event === 'film_picture_fail').length === 6)
}
{
  let fail = new Set([2])
  const r = rig({ image: (_p, n) => { if (fail.has(n)) throw new ImageError('http') } })
  const art = await ensureArt(r.deps, input())
  check('(4) an image error (slot 2 once) → that picture is drawn once more and the film gets all four; film_image_error is logged with the slot and the code', art.slots.join() === 'ai,ai,ai,ai' && r.imageCalls() === 5 && eventsOf(r.logs).some((e) => e.event === 'film_image_error' && e.slot === 2 && e.code === 'http'), JSON.stringify([art, r.imageCalls(), r.logs]))
  fail = new Set()
  const down = rig({ image: () => { throw new ImageError('http') } })
  const dart = await ensureArt(down.deps, input(mkId('downdowndowndowndo22')))
  const soon = await ensureArt(down.deps, input(mkId('downdowndowndowndo22')))
  check('(4) the image model is down (every call fails, twice): the film STILL PLAYS with washi, but it is INCOMPLETE — every slot is pending, not final; at most 4 + 4 calls were made; an open straight after makes no new call (retry_after)', dart.status === 'incomplete' && dart.slots.join() === 'pending,pending,pending,pending' && down.imageCalls() === 8 && down.vis.calls.length === 0 && eventsOf(down.logs).filter((e) => e.event === 'film_image_error').length === 8 && !!dart.retry_after && soon.status === 'incomplete' && down.imageCalls() === 8)
  // our own errors never count toward the cap and never make washi final: every open tries again
  const later = rig({ store: down.store, image: () => { throw new ImageError('http') }, env: { ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' } })
  later.deps.now = () => new Date(NOW.getTime() + 5 * 60_000)
  const lart = await ensureArt(later.deps, input(mkId('downdowndowndowndo22')))
  check('(4) our own errors (an error answer, a timeout) never count toward the order\'s cap and never make washi final: the saved count of successful draws is 0, and the next open tries all four again (eight more calls here, all failing again) — still pending, never washi', dart.calls === 0 && later.imageCalls() === 8 && lart.status === 'incomplete' && lart.slots.join() === 'pending,pending,pending,pending')
  const t = rig({ image: () => { throw new ImageError('timeout') }, env: { ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' } })
  const tart = await ensureArt(t.deps, input(mkId('timeouttimeouttimeou')))
  check('(4) image timeouts are not final either (pending, calls 0)', tart.slots.join() === 'pending,pending,pending,pending' && tart.calls === 0)
  const ci = mkId('capreachedcapreached')
  const cstore = mem()
  await cstore.putObject(artPath(ci), JSON.stringify({ schema: 'film-art', id: ci, status: 'incomplete', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'ai', 'pending', 'pending'], reasons: ['ok', 'ok', 'quota', 'quota'], check_fails: [0, 0, 0, 0], calls: 12, retry_after: NOW.toISOString() }), 'application/json')
  const cr = rig({ store: cstore, env: { ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' } })
  cr.deps.now = () => new Date(NOW.getTime() + 1000)
  const cart = await ensureArt(cr.deps, input(ci))
  check('(4) the order\'s cap (12 SUCCESSFUL draws: four first, four retries, four redraws after a rewrite) stops drawing but does not turn a pending slot into washi: no image call, the slots stay pending, the film is incomplete', cr.imageCalls() === 0 && cart.status === 'incomplete' && cart.slots.join() === 'ai,ai,pending,pending')
  const f = rig({ vision: (_c, k) => Array(k).fill(FAIL('face')) })
  const fart = await ensureArt(f.deps, input(mkId('twofailuresfinalwash')))
  check('(4) washi is final only when the SAME slot fails the safety check three times — twice as drawn from the film\'s own description, once more from the rewritten one: every picture fails every time → four final washi (done), 12 draws, four rewrites', fart.status === 'done' && fart.slots.join() === 'washi,washi,washi,washi' && fart.calls === 12 && f.imageCalls() === 12 && f.vis.rewrites.length === 4)
}
{
  const id = mkId('checkdowncheckdown22')
  let up = false
  const CK = { ICHIREI_FILM_CHECK_WAITS_MS: '5,5,5', ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' }
  const r = rig({ env: CK, vision: (_c, k) => (up ? Array(k).fill(OK) : { text: '', stop_reason: 'max_tokens' }) })
  const art = await ensureArt(r.deps, input(id))
  const ev = eventsOf(r.logs)
  const stored = [1, 2, 3, 4].every((i) => r.store.objects.has(uncheckedPath(id, i)))
  const shown = [1, 2, 3, 4].some((i) => r.store.objects.has(picturePath(id, i)))
  check('(4) the picture check cannot run (every call fails): the four drawn pictures are KEPT, stored as unchecked (films/<id>/<n>.unchecked.webp), the slots are `unchecked`, none is public (no <n>.webp), the film is incomplete and shows washi — and nothing was drawn again', art.status === 'incomplete' && art.slots.join() === 'unchecked,unchecked,unchecked,unchecked' && stored && !shown && r.imageCalls() === 4 && art.calls === 4)
  const ce = ev.filter((e) => e.event === 'film_check_error')
  check('(4) …the check is retried after 5 s, 15 s, 30 s (here 5 ms each: four tries in all, each logged with the REAL cause — kind, stop reason, reply) before giving up for now; film_check_error carries no story text', ce.length === 4 && ce[0].causes[0].kind === 'max_tokens' && ce[0].causes[0].stop_reason === 'max_tokens' && ev.filter((e) => e.event === 'film_check_wait').length === 3 && ce.every((e) => e.slots.length === 4) && !r.logs.join('\n').includes('bento'))
  up = true
  const again = rig({ store: r.store, env: CK, vision: (_c, k) => Array(k).fill(OK) })
  again.deps.now = () => new Date(NOW.getTime() + 2 * 60_000)
  const done = await ensureArt(again.deps, input(id))
  check('(4) the next open does ONLY the check (no image call at all): the stored pictures pass and become public (<n>.webp), the film is done', done.status === 'done' && done.slots.join() === 'ai,ai,ai,ai' && again.imageCalls() === 0 && again.vis.calls.length === 1 && [1, 2, 3, 4].every((i) => r.store.objects.has(picturePath(id, i))))
  const half = mkId('halfunchecked22222')
  const hs = mem()
  await hs.putObject(uncheckedPath(half, 2), Buffer.from(await toFilmWebp(PNG)), 'image/webp')
  await hs.putObject(picturePath(half, 1), Buffer.from('p1'), 'image/webp')
  await hs.putObject(artPath(half), JSON.stringify({ schema: 'film-art', id: half, status: 'incomplete', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'unchecked', 'pending', 'pending'], reasons: ['ok', 'unchecked', 'quota', 'quota'], check_fails: [0, 0, 0, 0], calls: 2, retry_after: NOW.toISOString() }), 'application/json')
  const hr = rig({ store: hs, env: CK })
  hr.deps.now = () => new Date(NOW.getTime() + 1000)
  const hart = await ensureArt(hr.deps, input(half))
  check('(4) a retry with one unchecked and two pending slots: the unchecked one is only checked (not redrawn), the two pending ones are drawn — two image calls, slot 1 untouched', hart.slots.join() === 'ai,ai,ai,ai' && hr.imageCalls() === 2 && hr.prompts.every((p) => !p.includes(FILM.pictures[1])) && hs.objects.get(picturePath(half, 1))!.body.toString() === 'p1')
  const e = rig({ vision: () => new Error('overloaded'), env: CK })
  const eart = await ensureArt(e.deps, input(mkId('checkdownnotdiscarded')))
  check('(4) a check outage never costs a drawing (the first live failure drew three sets for one film): one set drawn, four calls, nothing discarded', eart.slots.every((x) => x === 'unchecked') && e.imageCalls() === 4)
}
{
  const r = rig()
  await ensureArt(r.deps, input(mkId('memmemmemmemmemmem222'), true))
  check('(4) a remembrance film: every image prompt carries the paler grey-beige line, and the check is told it is a remembrance film (celebration is checked)', r.prompts.every((p) => p.includes('Paler grey-beige paper')) && r.vis.calls[0].content[0].text.includes('This is a REMEMBRANCE film') && r.vis.calls[0].content[0].text.includes('check "celebration"'))
  const f = rig()
  const art = await ensureArt(f.deps, { id: mkId('fallbackfallbackfa22'), film: { status: 'fallback', lines: ['a', 'b'], pictures: [], made_at: NOW.toISOString() }, memorial: false })
  check('(4) a fallback script (two lines) has nothing to draw: no image call, no check, no object — two washi slots', art.slots.join() === 'washi,washi' && f.imageCalls() === 0 && f.vis.calls.length === 0 && f.store.objects.size === 0)
}

// ---- 4b. quota (429): two at a time, the fallback model, waits, pending slots, retries --------------------------------------------------------------------------
{
  const QUOTA = { ICHIREI_FILM_QUOTA_WAITS_MS: '15,30,45', ICHIREI_FILM_RETRY_MS: '60000', ICHIREI_FILM_BG_RETRY_MS: '0' }
  // a quota that gives way after N rejections: the first N image calls answer 429
  let rejects = 0
  const r = rig({ env: QUOTA, image: () => { if (rejects > 0) { rejects--; throw new ImageError('quota') } } })
  rejects = 5
  const art = await ensureArt(r.deps, input(mkId('quotaquotaquotaquota')))
  const ev = eventsOf(r.logs)
  check('(4b) a quota answer waits and tries again (here 15 / 30 / 45 ms instead of 8 / 20 / 40 s) and the picture still comes: all four drawn, never more than two at a time, film_quota_wait logged per wait', art.status === 'done' && art.slots.join() === 'ai,ai,ai,ai' && r.maxParallel() <= 2 && ev.filter((e) => e.event === 'film_quota_wait').length >= 5 && ev.filter((e) => e.event === 'film_quota_wait').every((e) => [15, 30, 45].includes(e.wait_ms)))
  check('(4b) quota answers do NOT count toward the order\'s limit: five 429s, four pictures, and the saved count of billable calls is 4 (not 9)', art.calls === 4 && r.imageCalls() === 9)
}
{
  const QUOTA = { ICHIREI_FILM_QUOTA_WAITS_MS: '10,10,10', ICHIREI_FILM_RETRY_MS: '60000', ICHIREI_FILM_BG_RETRY_MS: '0' }
  let healthy = false
  const id = mkId('quotagivesupquotagi')
  const r = rig({ env: QUOTA, image: () => { if (!healthy) throw new ImageError('quota') } })
  const art = await ensureArt(r.deps, input(id))
  const ev = eventsOf(r.logs)
  check('(4b) quota that does not give way (after the three waits): the film is INCOMPLETE — washi shown now, every slot pending (not final), retry_after set; 4 slots × (1 + 3 waits) = 16 tries, none billable, no picture check', art.status === 'incomplete' && art.slots.join() === 'pending,pending,pending,pending' && art.calls === 0 && r.imageCalls() === 16 && r.vis.calls.length === 0 && !!art.retry_after && ev.filter((e) => e.event === 'film_quota_wait').length === 12 && ev.some((e) => e.event === 'film_image_error' && e.gave_up === true))
  const view = animationView({ ...SAMPLE_RECORDS[SAMPLE_IDS.ja], id }, art)
  check('(4b) the view of an incomplete film: four pictures (washi), incomplete: true — the page plays it and asks for the missing ones', view.film?.incomplete === true && !!view.film.pictures?.every((u) => u.startsWith('/film/washi-')))
  const early = rig({ store: r.store, env: QUOTA })
  const again = await ensureArt(early.deps, input(id))
  check('(4b) an open BEFORE retry_after draws nothing (no hammering of a quota): same incomplete state, no image call', again.status === 'incomplete' && early.imageCalls() === 0)
  healthy = true
  const later = rig({ store: r.store, env: QUOTA })
  later.deps.now = () => new Date(NOW.getTime() + 2 * 60_000)
  const done = await ensureArt(later.deps, input(id))
  check('(4b) the next open after retry_after draws the missing slots (quota healthy again): four pictures, status done, saved; films/<id>/1..4.webp exist', done.status === 'done' && done.slots.join() === 'ai,ai,ai,ai' && later.imageCalls() === 4 && [1, 2, 3, 4].every((i) => r.store.objects.has(picturePath(id, i))))
}
{
  // only the missing slots are drawn: slot 1 and 3 are already pictures
  const QUOTA = { ICHIREI_FILM_QUOTA_WAITS_MS: '10', ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' }
  const id = mkId('onlymissingonlymiss')
  const store = mem()
  await store.putObject(picturePath(id, 1), Buffer.from('p1'), 'image/webp')
  await store.putObject(picturePath(id, 3), Buffer.from('p3'), 'image/webp')
  await store.putObject(artPath(id), JSON.stringify({ schema: 'film-art', id, status: 'incomplete', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'pending', 'ai', 'pending'], reasons: ['ok', 'quota', 'ok', 'quota'], check_fails: [0, 0, 0, 0], calls: 2, retry_after: NOW.toISOString() }), 'application/json')
  const r = rig({ store, env: QUOTA })
  r.deps.now = () => new Date(NOW.getTime() + 1000)
  const art = await ensureArt(r.deps, input(id))
  check('(4b) a retry draws ONLY the missing slots (2 and 4): two image calls with their own descriptions, the check sees two pictures, slots 1 and 3 are untouched', art.status === 'done' && art.slots.join() === 'ai,ai,ai,ai' && r.imageCalls() === 2 && r.prompts.some((p) => p.includes(FILM.pictures[1])) && r.prompts.some((p) => p.includes(FILM.pictures[3])) && !r.prompts.some((p) => p.includes(FILM.pictures[0])) && r.vis.calls[0].content.filter((b: any) => b.type === 'image').length === 2 && store.objects.get(picturePath(id, 1))!.body.toString() === 'p1' && art.calls === 4)
}
{
  // washi is FINAL only after the safety check failed twice (across opens too)
  const id = mkId('finalonlytwicefinal')
  const store = mem()
  await store.putObject(artPath(id), JSON.stringify({ schema: 'film-art', id, status: 'incomplete', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'pending', 'ai', 'ai'], reasons: ['ok', 'face', 'ok', 'ok'], check_fails: [0, 1, 0, 0], calls: 5, retry_after: NOW.toISOString() }), 'application/json')
  const r = rig({ store, env: { ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' }, vision: (_c, k) => Array(k).fill(FAIL('face')) })
  r.deps.now = () => new Date(NOW.getTime() + 1000)
  const art = await ensureArt(r.deps, input(id))
  check('(4b) a picture that failed the safety check once in an earlier open and fails again is REWRITTEN once and drawn from the new view in the same render; failing that too makes the washi final — the film is done', art.status === 'done' && art.slots.join() === 'ai,washi,ai,ai' && art.rewrites?.[1] === 1 && r.imageCalls() === 2 && r.vis.rewrites.length === 1 && !store.objects.has(picturePath(id, 2)))
  const r2 = rig({ store: mem(), vision: (call, k) => (call === 1 ? [OK, FAIL('face'), OK, OK] : Array(k).fill(OK)) })
  const a2 = await ensureArt(r2.deps, input(mkId('failthenpassfailthen')))
  check('(4b) one failed check is not final: the picture is drawn again in the same render and passes', a2.slots.join() === 'ai,ai,ai,ai' && a2.check_fails?.[1] === 1)
}
{
  // the background retry: about ten minutes later (here 60 ms), draws only what is missing
  let healthy = false
  const id = mkId('backgroundretrybackg')
  const r = rig({ env: { ICHIREI_FILM_QUOTA_WAITS_MS: '5', ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '60' }, image: () => { if (!healthy) throw new ImageError('quota') } })
  const first = await ensureArt(r.deps, input(id))
  healthy = true
  let saved = await readArt(r.store, id)
  for (let k = 0; k < 100 && saved?.status !== 'done'; k++) {
    await sleep(30)
    saved = await readArt(r.store, id)
  }
  const ev = eventsOf(r.logs)
  check('(4b) one background retry is scheduled for an incomplete film and draws the missing slots by itself (no open needed); it is scheduled once and never again', first.status === 'incomplete' && first.bg_scheduled === true && saved?.status === 'done' && saved.slots.join() === 'ai,ai,ai,ai' && ev.filter((e) => e.event === 'film_render_retry').length === 1, JSON.stringify([first.status, first.bg_scheduled, saved?.status, saved?.slots, ev.map((e) => e.event)]))
}
{
  // a record saved by the first version (a quota failure was written down as washi, "done"): it is pending again
  const id = mkId('legacylegacylegacylega')
  const store = mem()
  await store.putObject(artPath(id), JSON.stringify({ schema: 'film-art', id, status: 'done', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'washi', 'ai', 'washi'], reasons: ['ok', 'image_error', 'ok', 'face'] }), 'application/json')
  await store.putObject(picturePath(id, 1), Buffer.from('a'), 'image/webp')
  await store.putObject(picturePath(id, 3), Buffer.from('c'), 'image/webp')
  const read = await readArt(store, id)
  check('(4b) a record from the first version: a washi that was only an image error is pending again (a failed check stays final), the status becomes incomplete', read?.status === 'incomplete' && read.slots.join() === 'ai,pending,ai,washi')
  const r = rig({ store, env: { ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' } })
  r.deps.now = () => new Date(NOW.getTime() + 1000)
  const art = await ensureArt(r.deps, input(id))
  check('(4b) …and the next open draws just that slot', art.slots.join() === 'ai,ai,ai,washi' && r.imageCalls() === 1)
}
{
  // a sample\'s revision: an art record of an older revision is ignored and the pictures are drawn again
  const id = mkId('samplerevsamplerevsam')
  const store = mem()
  await store.putObject(artPath(id), JSON.stringify({ schema: 'film-art', id, status: 'done', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
  const stale = await readArt(store, id, '2')
  const plain = await readArt(store, id)
  const r = rig({ store })
  const art = await ensureArt(r.deps, { ...input(id), rev: '2' })
  const saved = await readArt(store, id, '2')
  check('(4b) a sample\'s picture revision: an older record is ignored (read as none) and the pictures are drawn again, saved under the new revision; a record without a revision still reads for a normal film', stale === null && plain?.status === 'done' && art.status === 'done' && r.imageCalls() === 4 && saved?.rev === '2')
}
{
  // three films opened within a minute, a model that allows two image calls at a time and rejects the rest with 429 (the situation in the live log)
  let active = 0
  const gate = async () => { if (active >= 2) throw new ImageError('quota'); active++; try { await sleep(40) } finally { active-- } }
  const store = mem()
  const logs: string[] = []
  const mk3 = (name: string) => { const r = rig({ store, env: { ICHIREI_FILM_QUOTA_WAITS_MS: '30,60,90', ICHIREI_FILM_BG_RETRY_MS: '0', ICHIREI_FILM_RETRY_MS: '0' }, image: gate }); r.deps.log = (l) => logs.push(l); return { id: mkId(name), r } }
  const films = [mk3('threefilmsonesimul'), mk3('threefilmstwosimul'), mk3('threefilmsthreesimul')]
  const t0 = Date.now()
  const arts = await Promise.all(films.map((f) => ensureArt(f.r.deps, input(f.id))))
  const ev = eventsOf(logs)
  const slotsAi = arts.flatMap((a) => a.slots).filter((x) => x === 'ai').length
  console.log(`      simulated: 3 films at once against a model that allows 2 image calls at a time — ${Date.now() - t0} ms, ${slotsAi}/12 pictures drawn, ${ev.filter((e) => e.event === 'film_quota_wait').length} quota waits, ${ev.filter((e) => e.event === 'film_image_error').length} gave up, ${arts.filter((a) => a.status === 'incomplete').length} incomplete`)
  check('(4b) three films opened together against a model that rejects a third simultaneous call: the waits absorb it — no film is left incomplete here, and anything that did run out of waits is pending (retried later), never final washi', arts.every((a) => a.status === 'done' || (a.status === 'incomplete' && !a.slots.includes('washi'))) && slotsAi + arts.flatMap((a) => a.slots).filter((x) => x === 'pending').length === 12)
}

{
  const r = rig({ vision: (call, k) => (call === 1 ? [OK, FAIL('religious'), OK, FAIL('clothing')] : Array(k).fill(OK)) })
  const art = await ensureArt(r.deps, { ...input(mkId('languagesettingcheck')), language: 'zh-Hant' })
  check('(4) the buyer\'s language reaches the picture check (a Chinese film is judged against a Chinese home); a picture that fails for a cross or for a kimono is drawn again with a hint that names the rule', r.vis.calls[0].content[0].text.includes('the film\'s language is zh-Hant') && art.slots.join() === 'ai,ai,ai,ai' && r.prompts.some((p) => p.includes('No religious symbol of any kind: no cross (not even one made by a window frame)')) && r.prompts.some((p) => p.includes('no kimono or traditional dress')))
}

{
  const src = readFileSync(new URL('../engine/film-art.ts', import.meta.url), 'utf8')
  check('(4) an image call may take 90 s (the default of ICHIREI_FILM_IMAGE_TIMEOUT_MS; slots 1 and 2 timed out at 60 s in the live log), the picture check 60 s, and the render may keep going for 200 s while a request is held for 120 s', /ICHIREI_FILM_IMAGE_TIMEOUT_MS, 90_000/.test(src) && /ICHIREI_FILM_CHECK_TIMEOUT_MS, 60_000/.test(src) && /ICHIREI_FILM_RENDER_DEADLINE_MS, 200_000/.test(src) && /ICHIREI_FILM_RENDER_MS, 120_000/.test(src))
}

// ---- 4c. the rewrite before a washi becomes final -------------------------------------------------------------------------------------------------------
{
  check('(4c) the fixed style text carries the contemporary-clothes and modern-objects sentence', IMAGE_STYLE.includes('People wear contemporary everyday clothes; modern objects (a plain modern umbrella, modern doors, phones and trains) unless the description says otherwise.') && buildImagePrompt('x', false).includes('modern objects (a plain modern umbrella'))
  // slot 2 fails twice from its own description, then PASSES from the rewritten one
  const id = mkId('rewritepassesrewrite2')
  const r = rig({ vision: (call, k) => (call === 1 ? [OK, FAIL('religious'), OK, OK] : call === 2 ? [FAIL('religious')] : Array(k).fill(OK)) })
  const art = await ensureArt(r.deps, input(id))
  const ev = eventsOf(r.logs)
  check('(4c) a picture that failed twice is not washi yet: its description is rewritten ONCE (the same moment from a different view; the prompt carries the description, the reason and the language) and the picture is drawn again from the new text — it passes, so it is a real picture', art.slots.join() === 'ai,ai,ai,ai' && r.vis.rewrites.length === 1 && r.vis.rewrites[0].prompt.includes(FILM.pictures[1]) && r.vis.rewrites[0].prompt.includes('failed the safety check (religious)') && r.vis.rewrites[0].prompt.includes('The film\'s language is en') && /DIFFERENT view/.test(r.vis.rewrites[0].prompt) && /hands on an umbrella handle/.test(r.vis.rewrites[0].prompt) && r.imageCalls() === 6 && r.prompts.at(-1)!.includes(REWRITE_OK) && !r.prompts.at(-1)!.includes(FILM.pictures[1]))
  check('(4c) the rewrite is kept with the film (art.json: rewrites 1, the new text), logged as film_picture_rewrite (slot, reason, ok) — no story text — and happens only once per slot', art.rewrites?.join() === '0,1,0,0' && art.rewritten?.[1] === REWRITE_OK && ev.some((e) => e.event === 'film_picture_rewrite' && e.slot === 2 && e.reason === 'religious' && e.ok === true) && ev.filter((e) => e.event === 'film_picture_rewrite').length === 1 && !r.logs.join('\n').includes('umbrella'))
  // a rewrite that breaks a rule is asked again once; two bad answers = no rewrite (an outage, not a verdict): the slot waits, it is NOT washi
  const id2 = mkId('rewritebadrewritebad2')
  const bad = rig({ vision: (call, k) => (call === 1 ? [OK, FAIL('text'), OK, OK] : call === 2 ? [FAIL('text')] : Array(k).fill(OK)), rewrite: (c) => JSON.stringify({ picture: c === 1 ? 'a smiling mother with a happy face holding an umbrella beside a quiet doorway in soft evening light today' : 'x' }) })
  const bart = await ensureArt(bad.deps, input(id2))
  check('(4c) a rewrite that breaks the rules (a smiling face; too short) is refused by the same referee and asked for once more; if no usable rewrite comes, the slot WAITS (pending, check_fails 2, no rewrite recorded) — our own failure never makes washi final', bad.vis.rewrites.length === 2 && /BROKE THESE RULES/.test(bad.vis.rewrites[1].prompt) && bart.slots.join() === 'ai,pending,ai,ai' && bart.rewrites?.[1] === 0 && bart.check_fails?.[1] === 2 && bart.status === 'incomplete')
  const ok = rig({ store: bad.store, env: { ICHIREI_FILM_RETRY_MS: '0', ICHIREI_FILM_BG_RETRY_MS: '0' } })
  ok.deps.now = () => new Date(NOW.getTime() + 2 * 60_000)
  const later = await ensureArt(ok.deps, input(id2))
  check('(4c) the next open rewrites it first (the rewrite works now), then draws and checks it: a real picture', later.slots.join() === 'ai,ai,ai,ai' && ok.vis.rewrites.length === 1 && ok.imageCalls() === 1 && later.rewrites?.[1] === 1)
  const id3 = mkId('rewritenotagainrewri')
  const once = rig({ vision: (_c, k) => Array(k).fill(FAIL('face')) })
  const oart = await ensureArt(once.deps, input(id3))
  check('(4c) one rewrite per slot, never two: when the rewritten picture fails too, the washi is final and no second rewrite is asked for', oart.slots.join() === 'washi,washi,washi,washi' && once.vis.rewrites.length === 4 && oart.rewrites?.join() === '1,1,1,1')
  const bm = buildRewritePrompt('a mother\'s hand on a bento box', 'text', true, 'zh-Hant')
  check('(4c) the rewrite prompt is a prompt file: the description, the reason, the language and — for a remembrance film — "no celebration"; it asks for the same moment, a different view, no new fact, English, 15–40 words, JSON {"picture"}', bm.includes('a mother\'s hand on a bento box') && bm.includes('(text)') && bm.includes('The film\'s language is zh-Hant') && bm.includes('REMEMBRANCE film') && /Add no new object, place, person or event/.test(bm) && /15–40 words/.test(bm) && /"picture"/.test(bm) && !/\{\{ [A-Z]+ \}\}/.test(bm))
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
