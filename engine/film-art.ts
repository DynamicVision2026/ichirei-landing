// The pictures of the story film: four new ink-wash pictures per order, each drawn from the picture description the film script holds (engine/film.ts).
// They are drawn on the FIRST OPEN of /a/<id> (after payment), not when the order is made: an order that is never paid costs nothing for pictures.
//
//   1. one request (POST /api/film/<id>/render) stays open until the pictures are done (≤ 120 s), so Cloud Run keeps the CPU allocated;
//   2. the four pictures are drawn in parallel by Google's image model on Vertex AI (the service account's own token — no API key);
//   3. one vision call (engine/film-picture-check-prompt.md) looks at all four; a picture that fails, or could not be drawn, is drawn ONE more time;
//      a picture that fails again is replaced by a plain washi picture — a film never shows a failed picture, and it always plays;
//   4. the pictures are saved as private objects (films/<animation id>/1.webp … 4.webp) in the order bucket and served only through the server.
//
// A lock (in this process and, through a create-if-absent object, across instances) makes two opens draw one set. Limits: one full set and four
// single-picture retries per order; ICHIREI_FILM_DAILY_MAX sets (default 200) a day — above it the pictures wait for the next day.
//
// Env: ICHIREI_FILM_IMAGE_MODEL (one or more, separated by | , or ;, tried in order when a model is not found; default gemini-3.1-flash-image|gemini-2.5-flash-image),
// ICHIREI_FILM_IMAGE_LOCATION (default global), ICHIREI_FILM_IMAGE_PROJECT (default: the project of the metadata server), ICHIREI_FILM_IMAGE_TIMEOUT_MS
// (60000 per picture), ICHIREI_FILM_RENDER_MS (120000), ICHIREI_FILM_DAILY_MAX, ICHIREI_FILM_CHECK_MODEL (default claude-haiku-5-5),
// ICHIREI_FILM_IMAGE_USD / ICHIREI_FILM_JPY_PER_USD (the cost estimate in the log: 0.039 and 150 — assumptions, not measurements).
// Logs (no story text): [ichirei-film] film_render_start | film_render_done | film_picture_fail | film_image_error | film_check_error | film_render_deferred.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { DEFAULT_REVIEW_MODEL } from './engine.ts'
import type { FilmRecord } from './film.ts'
import { callSignal, timedOut } from './limits.ts'
import type { OrderStore } from './order-store.ts'

// ---- the style (fixed, the same for every order) ----------------------------------------------------------------------------------------------------

export const IMAGE_STYLE =
  'Japanese sumi-e ink-wash painting on warm off-white washi paper. Soft graded black ink only, with at most one muted earth-brown accent wash. Loose, confident brush strokes, visible paper grain, generous empty space. People only as simple silhouettes, as hands, or seen from behind; no faces or facial features. No text, letters, signatures, seals or frames. Quiet, tender, everyday life. Consistent hand, as if one painter made the whole series. Portrait 4:5.'
export const IMAGE_STYLE_MEMORIAL = 'Paler grey-beige paper, very soft ink, still and calm.'
/** Added to a picture drawn a second time, for the reason it failed the first time. */
const RETRY_HINT: Record<string, string> = {
  face: 'Absolutely no faces: show only figures seen from behind, silhouettes and hands.',
  text: 'Absolutely no writing, letters or marks that look like writing anywhere in the picture.',
  illness: 'Show only a calm everyday moment: no medical or sickroom scene, no injury.',
  celebration: 'No celebration of any kind: quiet and still.',
  unsafe: 'Gentle, safe, everyday imagery only.',
  off_story: 'Follow the description exactly; keep it a simple ink-wash painting.',
}

export const buildImagePrompt = (description: string, memorial: boolean, hint = ''): string =>
  [IMAGE_STYLE, memorial ? IMAGE_STYLE_MEMORIAL : '', `Scene: ${description.trim()}`, hint].filter(Boolean).join('\n')

export const IMAGE_SIZE = { width: 1080, height: 1350 }

// ---- the state of one film's pictures -----------------------------------------------------------------------------------------------------------------

export interface ArtRecord {
  schema: 'film-art'
  id: string
  /** rendering = being drawn right now (a lease); done = finished (slots tell which are drawn); deferred = the daily limit was reached on `date`. */
  status: 'rendering' | 'done' | 'deferred'
  started_at: string
  made_at?: string
  date?: string
  /** One per picture: `ai` = drawn and saved as films/<id>/<n>.webp; `washi` = the plain fallback picture. */
  slots: ('ai' | 'washi')[]
  /** Why a slot is washi (codes only). */
  reasons?: string[]
  ms?: number
  model?: string
}

export const artPath = (id: string) => `films/${id}/art.json`
export const picturePath = (id: string, n: number) => `films/${id}/${n}.webp`
export const rendersPath = (day: string) => `films/renders-${day}.jsonl`
export const washiUrl = (slot: number) => `/film/washi-${(slot % 2) + 1}.webp`

const LEASE_MS = 150_000
const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d)
export const renderBudgetMs = (env: NodeJS.ProcessEnv = process.env) => num(env.ICHIREI_FILM_RENDER_MS, 120_000)
export const dailyMax = (env: NodeJS.ProcessEnv = process.env): number => {
  const v = env.ICHIREI_FILM_DAILY_MAX?.trim().toLowerCase()
  if (v === 'off' || v === 'none') return Infinity
  return num(v, 200)
}

export async function readArt(store: OrderStore, id: string): Promise<ArtRecord | null> {
  const raw = await store.getObject(artPath(id))
  if (!raw) return null
  try {
    const j = JSON.parse(raw.toString('utf8')) as ArtRecord
    return j && j.schema === 'film-art' && Array.isArray(j.slots) ? j : null
  } catch {
    return null
  }
}

// ---- the image model (Vertex AI, the Cloud Run service account) ---------------------------------------------------------------------------------------

export class ImageError extends Error {
  readonly code: string
  constructor(code: string, message = code) {
    super(message)
    this.code = code
  }
}

export interface ImageClient {
  /** One picture as image bytes (PNG or JPEG). Throws ImageError. */
  generate(prompt: string, signal: AbortSignal): Promise<{ bytes: Buffer; model: string }>
}

const METADATA = 'http://metadata.google.internal/computeMetadata/v1'

export function vertexImageClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): ImageClient {
  const models = (env.ICHIREI_FILM_IMAGE_MODEL?.trim() || 'gemini-3.1-flash-image|gemini-2.5-flash-image').split(/[|,;]/).map((m) => m.trim()).filter(Boolean)
  const location = env.ICHIREI_FILM_IMAGE_LOCATION?.trim() || 'global'
  let token: { value: string; expiresAt: number } | null = null
  let project: string | null = env.ICHIREI_FILM_IMAGE_PROJECT?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim() || null
  let working = 0 // the index of the model that last worked (a "not found" moves it on)

  const meta = async (path: string, signal: AbortSignal) => {
    const res = await fetchImpl(`${METADATA}/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })
    if (!res.ok) throw new ImageError('auth', `metadata server HTTP ${res.status}`)
    return res
  }
  const getToken = async (signal: AbortSignal) => {
    if (env.ICHIREI_FILM_IMAGE_TOKEN) return env.ICHIREI_FILM_IMAGE_TOKEN // tests / a local run with `gcloud auth print-access-token`
    if (token && token.expiresAt > Date.now() + 60_000) return token.value
    const j = (await (await meta('instance/service-accounts/default/token', signal)).json()) as { access_token: string; expires_in: number }
    token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
    return token.value
  }
  const getProject = async (signal: AbortSignal) => project ?? (project = (await (await meta('project/project-id', signal)).text()).trim())
  const base = env.ICHIREI_FILM_IMAGE_BASE?.trim() || (location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`)

  return {
    async generate(prompt, signal) {
      let lastNotFound = false
      for (let k = 0; k < models.length; k++) {
        const model = models[(working + k) % models.length]
        const url = `${base.replace(/\/$/, '')}/v1/projects/${await getProject(signal)}/locations/${location}/publishers/google/models/${model}:generateContent`
        let res: Response
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${await getToken(signal)}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:5' } },
            }),
            signal,
          })
        } catch (err) {
          if (err instanceof ImageError) throw err
          throw new ImageError(timedOut(signal) ? 'timeout' : 'network')
        }
        if (res.status === 404) {
          lastNotFound = true
          continue // this model is not served here: the next one in the list
        }
        if (res.status === 401 || res.status === 403) throw new ImageError('permission', `HTTP ${res.status}`)
        if (res.status === 429) throw new ImageError('quota', 'HTTP 429')
        if (!res.ok) throw new ImageError('http', `HTTP ${res.status}`)
        working = (working + k) % models.length
        const j = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { data?: string } }[] } }[]; promptFeedback?: { blockReason?: string } }
        const data = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
        if (!data) throw new ImageError(j.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCK/i.test(j.candidates?.[0]?.finishReason ?? '') ? 'blocked' : 'no_image')
        return { bytes: Buffer.from(data, 'base64'), model }
      }
      throw new ImageError(lastNotFound ? 'model_not_found' : 'network')
    },
  }
}

/** Image bytes → the film's picture: 1080 × 1350 (4:5), WebP. */
export const toFilmWebp = (bytes: Buffer): Promise<Buffer> => sharp(bytes).rotate().resize(IMAGE_SIZE.width, IMAGE_SIZE.height, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer()
const toCheckJpeg = (webp: Buffer): Promise<Buffer> => sharp(webp).resize(768, 960).jpeg({ quality: 80 }).toBuffer()

// ---- the picture check (one vision call) -----------------------------------------------------------------------------------------------------------

export interface Verdict {
  ok: boolean
  reason: string
}
const REASONS = new Set(['ok', 'face', 'text', 'illness', 'celebration', 'unsafe', 'off_story'])
type Messages = Pick<Anthropic, 'messages'>

function readPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [process.env.ICHIREI_FILM_CHECK_PROMPT_PATH, join(here, 'film-picture-check-prompt.md'), join(process.cwd(), 'engine', 'film-picture-check-prompt.md')]) {
    if (!p) continue
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error('film-picture-check-prompt.md not found')
}

export function buildCheckPrompt(descriptions: string[], memorial: boolean): string {
  const values: Record<string, string> = {
    MEMORIAL: memorial ? 'This is a REMEMBRANCE film (the person it is for has died): check "celebration".' : 'This is not a remembrance film: ignore "celebration".',
    DESCRIPTIONS: descriptions.map((d, i) => `Picture ${i + 1}: ${d}`).join('\n'),
  }
  return readPrompt().replace(/\{\{ (MEMORIAL|DESCRIPTIONS) \}\}/g, (m) => values[m.slice(3, -3).trim()])
}

export function parseVerdicts(raw: string, n: number): Verdict[] | null {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a === -1 || b < a) return null
  try {
    const j = JSON.parse(text.slice(a, b + 1)) as { pictures?: { ok?: unknown; reason?: unknown }[] }
    if (!Array.isArray(j.pictures) || j.pictures.length !== n) return null
    return j.pictures.map((p) => {
      const reason = typeof p.reason === 'string' && REASONS.has(p.reason) ? p.reason : 'off_story'
      // a verdict is only ever a pass when it says so in both fields
      return { ok: p.ok === true && reason === 'ok', reason: p.ok === true && reason === 'ok' ? 'ok' : reason === 'ok' ? 'off_story' : reason }
    })
  } catch {
    return null
  }
}

export interface CheckResult {
  verdicts: Verdict[]
  input_tokens: number
  output_tokens: number
}

/** One vision call over `jpegs` (with their descriptions). Throws when it cannot get a readable answer in two tries. */
export async function checkPictures(client: Messages, jpegs: Buffer[], descriptions: string[], memorial: boolean, env: NodeJS.ProcessEnv = process.env, outer?: AbortSignal): Promise<CheckResult> {
  const model = env.ICHIREI_FILM_CHECK_MODEL?.trim() || DEFAULT_REVIEW_MODEL
  const timeout = num(env.ICHIREI_FILM_CHECK_TIMEOUT_MS, 40_000)
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: buildCheckPrompt(descriptions, memorial) }]
  jpegs.forEach((j, i) => {
    content.push({ type: 'text', text: `Picture ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: j.toString('base64') } })
  })
  let last: unknown = null
  const usage = { input_tokens: 0, output_tokens: 0 }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = callSignal(outer, timeout)
    try {
      const message = await client.messages.stream({ model, max_tokens: 600, messages: [{ role: 'user', content }] }, { signal }).finalMessage()
      usage.input_tokens += message.usage?.input_tokens ?? 0
      usage.output_tokens += message.usage?.output_tokens ?? 0
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const verdicts = parseVerdicts(text, jpegs.length)
      if (verdicts) return { verdicts, ...usage }
      last = new Error('parse')
    } catch (err) {
      last = err
    }
  }
  throw new ImageError('check', last instanceof Error ? last.message.slice(0, 80) : 'check')
}

// ---- drawing the set --------------------------------------------------------------------------------------------------------------------------------

export interface ArtDeps {
  store: OrderStore
  image?: ImageClient
  client?: Messages
  env?: NodeJS.ProcessEnv
  log?: (line: string) => void
  now?: () => Date
  /** Tests: how often a waiting open looks at the store (ms). */
  pollMs?: number
  signal?: AbortSignal
}

const logLine = (log: (l: string) => void, event: string, data: Record<string, unknown>) => log(`[ichirei-film] ${JSON.stringify({ event, ...data })}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dayOf = (d: Date) => d.toISOString().slice(0, 10)

/** Opens in this process that are already drawing a film's pictures (a second open waits for the same set). */
const inflight = new Map<string, Promise<ArtRecord>>()
export const artInFlight = (id: string) => inflight.get(id)

export interface RenderInput {
  id: string
  film: FilmRecord
  memorial: boolean
}

/** The pictures of a film: from the store when they are done, else drawn now (once, however many opens). Never throws; failed slots are washi. */
export function ensureArt(deps: ArtDeps, input: RenderInput): Promise<ArtRecord> {
  const running = inflight.get(input.id)
  if (running) return running
  const p = renderLocked(deps, input).catch((err) => {
    ;(deps.log ?? console.log)(`[ichirei-film] ${JSON.stringify({ event: 'film_render_error', reason: err instanceof Error ? err.message.slice(0, 80) : 'error' })}`)
    return washiArt(input, 'error', deps.now?.() ?? new Date())
  })
  inflight.set(input.id, p)
  const done = () => { if (inflight.get(input.id) === p) inflight.delete(input.id) }
  p.then(done, done)
  return p
}

const washiArt = (input: RenderInput, reason: string, now: Date): ArtRecord => ({ schema: 'film-art', id: input.id, status: 'done', started_at: now.toISOString(), made_at: now.toISOString(), slots: input.film.lines.map(() => 'washi' as const), reasons: input.film.lines.map(() => reason) })

async function renderLocked(deps: ArtDeps, input: RenderInput): Promise<ArtRecord> {
  const env = deps.env ?? process.env
  const now = () => deps.now?.() ?? new Date()
  const log = deps.log ?? ((l: string) => console.log(l))
  const { store } = deps
  const { id } = input
  if (input.film.status !== 'ready' || !Array.isArray(input.film.pictures) || input.film.pictures.length === 0) return washiArt(input, 'fallback_script', now())
  const deadline = Date.now() + renderBudgetMs(env)
  // the lock: a create-if-absent object. Someone else's fresh lease is waited for; a stale one (a crashed instance) or a deferral of an earlier day is taken over.
  for (;;) {
    const cur = await readArt(store, id)
    if (cur?.status === 'done') return cur
    if (cur?.status === 'rendering' && Date.parse(cur.started_at) > now().getTime() - LEASE_MS) {
      if (Date.now() > deadline) return cur
      await sleep(deps.pollMs ?? 2000)
      continue
    }
    if (cur?.status === 'deferred' && cur.date === dayOf(now())) return cur
    const lease: ArtRecord = { schema: 'film-art', id, status: 'rendering', started_at: now().toISOString(), slots: [] }
    const got = await store.putObject(artPath(id), JSON.stringify(lease), 'application/json', cur ? {} : { ifAbsent: true })
    if (got) break
    // lost the race: look again
  }
  // the daily limit
  const today = dayOf(now())
  const max = dailyMax(env)
  if (Number.isFinite(max)) {
    const used = ((await store.getObject(rendersPath(today)))?.toString('utf8').split('\n').filter(Boolean).length) ?? 0
    if (used >= max) {
      const deferred: ArtRecord = { schema: 'film-art', id, status: 'deferred', started_at: now().toISOString(), date: today, slots: [] }
      await store.putObject(artPath(id), JSON.stringify(deferred), 'application/json')
      logLine(log, 'film_render_deferred', { used, max })
      return deferred
    }
  }
  await store.appendJsonl(rendersPath(today), { ts: now().toISOString(), id }).catch(() => {})

  const t0 = Date.now()
  const n = input.film.pictures.length
  const descriptions = input.film.pictures
  logLine(log, 'film_render_start', { pictures: n })
  const image = deps.image ?? vertexImageClient(env)
  const client = deps.client ?? new Anthropic({ maxRetries: 0 })
  const timeout = num(env.ICHIREI_FILM_IMAGE_TIMEOUT_MS, 60_000)
  const webp: (Buffer | null)[] = Array(n).fill(null)
  const reasons: string[] = Array(n).fill('')
  let modelUsed = ''
  let drawn = 0
  const usage = { input_tokens: 0, output_tokens: 0 }

  const drawAndCheck = async (slots: number[], attempt: number) => {
    // draw in parallel
    const results = await Promise.all(
      slots.map(async (slot) => {
        const signal = callSignal(deps.signal, timeout)
        try {
          const hint = attempt > 1 && reasons[slot] ? (RETRY_HINT[reasons[slot]] ?? '') : ''
          const r = await image.generate(buildImagePrompt(descriptions[slot], input.memorial, hint), signal)
          drawn++
          modelUsed = r.model
          return { slot, webp: await toFilmWebp(r.bytes) }
        } catch (err) {
          const code = err instanceof ImageError ? err.code : timedOut(signal) ? 'timeout' : 'image'
          logLine(log, 'film_image_error', { slot: slot + 1, code, attempt })
          return { slot, error: code }
        }
      }),
    )
    const good = results.filter((r): r is { slot: number; webp: Buffer } => 'webp' in r)
    for (const r of results) if ('error' in r) { reasons[r.slot] = 'image_error'; webp[r.slot] = null }
    if (good.length === 0) return
    // one vision call over the pictures just drawn
    try {
      const jpegs = await Promise.all(good.map((g) => toCheckJpeg(g.webp)))
      const res = await checkPictures(client, jpegs, good.map((g) => descriptions[g.slot]), input.memorial, env, deps.signal)
      usage.input_tokens += res.input_tokens
      usage.output_tokens += res.output_tokens
      good.forEach((g, i) => {
        const v = res.verdicts[i]
        if (v.ok) {
          webp[g.slot] = g.webp
          reasons[g.slot] = ''
        } else {
          webp[g.slot] = null
          reasons[g.slot] = v.reason
          logLine(log, 'film_picture_fail', { slot: g.slot + 1, reason: v.reason, attempt })
        }
      })
    } catch (err) {
      // a picture that could not be checked is never shown
      logLine(log, 'film_check_error', { reason: err instanceof ImageError ? err.code : 'check', attempt })
      for (const g of good) { webp[g.slot] = null; reasons[g.slot] = 'check_error' }
    }
  }

  await drawAndCheck([...Array(n).keys()], 1)
  const again = [...Array(n).keys()].filter((i) => !webp[i] && reasons[i] !== 'check_error')
  if (again.length > 0 && Date.now() < deadline - 15_000) await drawAndCheck(again, 2) // each failed picture is drawn once more, no more

  const slots = webp.map((w) => (w ? ('ai' as const) : ('washi' as const)))
  await Promise.all(webp.map((w, i) => (w ? store.putObject(picturePath(id, i + 1), w, 'image/webp') : Promise.resolve(true))))
  const ms = Date.now() - t0
  const art: ArtRecord = { schema: 'film-art', id, status: 'done', started_at: new Date(t0).toISOString(), made_at: now().toISOString(), slots, reasons: reasons.map((r) => r || 'ok'), ms, model: modelUsed || undefined }
  await store.putObject(artPath(id), JSON.stringify(art), 'application/json')
  const usd = drawn * Number(env.ICHIREI_FILM_IMAGE_USD || 0.039) + (usage.input_tokens * 1 + usage.output_tokens * 5) / 1e6
  logLine(log, 'film_render_done', { ms, pictures: slots.filter((s) => s === 'ai').length, drawn, washi: slots.filter((s) => s === 'washi').length, est_cost_jpy: Math.round(usd * Number(env.ICHIREI_FILM_JPY_PER_USD || 150) * 10) / 10 })
  return art
}
