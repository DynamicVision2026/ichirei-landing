// The pictures of the story film: four new ink-wash pictures per order, each drawn from the picture description the film script holds (engine/film.ts).
// They are drawn on the FIRST OPEN of /a/<id> (after payment), not when the order is made: an order that is never paid costs nothing for pictures.
//
//   1. one request (POST /api/film/<id>/render) stays open until the pictures are done (≤ 120 s), so Cloud Run keeps the CPU allocated;
//   2. the four pictures are drawn TWO AT A TIME by Google's image model on Vertex AI (the service account's own token — no API key); a quota
//      answer (429) tries the next model, then waits 8 s, 20 s, 40 s and tries again, inside the render window;
//   3. one vision call (engine/film-picture-check-prompt.md) looks at what was drawn; a picture that fails is drawn ONE more time; washi is FINAL only
//      for a picture that fails the safety check twice. A slot that failed only for quota or an outage stays `pending`: the film shows washi there now, is
//      marked `incomplete`, and the next open (and one background retry ~10 minutes later) draws ONLY the missing slots. A film always plays;
//   4. the pictures are saved as private objects (films/<animation id>/1.webp … 4.webp) in the order bucket and served only through the server.
//
// A lock (in this process and, through a create-if-absent object, across instances) makes two opens draw one set. Limits: one full set and four
// single-picture retries per order (8 billable image calls — quota answers do not count); ICHIREI_FILM_DAILY_MAX sets (default 200) a day — above it
// the pictures wait for the next day (a retry of an incomplete film is not a new set).
//
// Env: ICHIREI_FILM_IMAGE_MODEL (one or more, separated by | , or ;, tried in order when a model is not found; default gemini-3.1-flash-image|gemini-2.5-flash-image),
// ICHIREI_FILM_IMAGE_LOCATION (default global), ICHIREI_FILM_IMAGE_PROJECT (default: the project of the metadata server), ICHIREI_FILM_IMAGE_TIMEOUT_MS
// (60000 per picture), ICHIREI_FILM_RENDER_MS (120000), ICHIREI_FILM_DAILY_MAX, ICHIREI_FILM_CHECK_MODEL (default claude-haiku-5-5),
// ICHIREI_FILM_IMAGE_USD / ICHIREI_FILM_JPY_PER_USD (the cost estimate in the log: 0.039 and 150 — assumptions, not measurements),
// ICHIREI_FILM_IMAGE_CONCURRENCY (2), ICHIREI_FILM_QUOTA_WAITS_MS (8000,20000,40000), ICHIREI_FILM_RETRY_MS (60000: the least time between two tries of an
// incomplete film), ICHIREI_FILM_BG_RETRY_MS (600000: the one background retry; 0 = none), ICHIREI_FILM_CALL_CAP (8).
// Logs (no story text): [ichirei-film] film_render_start | film_render_done | film_picture_fail | film_image_error | film_quota_wait | film_check_error | film_render_deferred | film_render_retry.

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
  /**
   * rendering = being drawn right now (a lease; `slots` still shows what was there before);
   * done = finished — every slot is a picture or a FINAL washi;
   * incomplete = finished for now, but a slot is `pending` (quota or an outage): the film shows washi there and the next open draws only those slots;
   * deferred = the daily limit was reached on `date`.
   */
  status: 'rendering' | 'done' | 'incomplete' | 'deferred'
  started_at: string
  made_at?: string
  date?: string
  /** One per picture: `ai` = drawn and saved as films/<id>/<n>.webp; `washi` = the plain picture, FINAL (it failed the safety check twice); `pending` = not drawn yet. */
  slots: ('ai' | 'washi' | 'pending')[]
  /** Why a slot is not (yet) a picture (codes only). */
  reasons?: string[]
  /** How often each slot's picture failed the safety check: 2 makes its washi final. */
  check_fails?: number[]
  /** Billable image calls so far (a quota answer is not one): the order's cap is 8. */
  calls?: number
  /** The earliest time the next open may draw the pending slots again. */
  retry_after?: string
  /** The one background retry was scheduled. */
  bg_scheduled?: boolean
  /** Samples only: the set of pictures was redrawn for a new revision (an older art record is ignored). */
  rev?: string
  ms?: number
  model?: string
}

export const hasPending = (a: Pick<ArtRecord, 'slots'>): boolean => a.slots.includes('pending')

/** A record saved before pending slots existed: a washi that was only an image error or an unchecked picture was never final — it is pending. */
function normalizeArt(a: ArtRecord): ArtRecord {
  if (a.check_fails) return a
  const slots = a.slots.map((s, i) => (s === 'washi' && ['image_error', 'check_error', 'error'].includes(a.reasons?.[i] ?? '') ? ('pending' as const) : s))
  const art: ArtRecord = { ...a, slots, check_fails: a.slots.map((_, i) => (a.slots[i] === 'washi' && !['image_error', 'check_error', 'error', 'fallback_script'].includes(a.reasons?.[i] ?? '') ? 2 : 0)) }
  if (art.status === 'done' && hasPending(art)) art.status = 'incomplete'
  return art
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

/** The saved state of a film's pictures (null = none). `rev` is a sample's revision: a record of another revision is ignored (the pictures are drawn again). */
export async function readArt(store: OrderStore, id: string, rev?: string): Promise<ArtRecord | null> {
  const art = await readArtRaw(store, id)
  return art && (art.rev ?? undefined) === (rev ?? undefined) ? art : null
}

async function readArtRaw(store: OrderStore, id: string): Promise<ArtRecord | null> {
  const raw = await store.getObject(artPath(id))
  if (!raw) return null
  try {
    const j = JSON.parse(raw.toString('utf8')) as ArtRecord
    return j && j.schema === 'film-art' && Array.isArray(j.slots) ? normalizeArt(j) : null
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
      let sawQuota = false
      let onlyNotFound = true // every model before this one answered "not found": this one is the new first choice
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
        if (res.status === 429) {
          sawQuota = true
          onlyNotFound = false
          continue // out of quota for this model: try the next one before anyone waits
        }
        if (res.status === 401 || res.status === 403) throw new ImageError('permission', `HTTP ${res.status}`)
        if (!res.ok) throw new ImageError('http', `HTTP ${res.status}`)
        if (onlyNotFound) working = (working + k) % models.length
        const j = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { data?: string } }[] } }[]; promptFeedback?: { blockReason?: string } }
        const data = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
        if (!data) throw new ImageError(j.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCK/i.test(j.candidates?.[0]?.finishReason ?? '') ? 'blocked' : 'no_image')
        return { bytes: Buffer.from(data, 'base64'), model }
      }
      throw new ImageError(sawQuota ? 'quota' : lastNotFound ? 'model_not_found' : 'network')
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
  /** The background retry: draw the pending slots now, whatever `retry_after` says. */
  force?: boolean
}

const logLine = (log: (l: string) => void, event: string, data: Record<string, unknown>) => log(`[ichirei-film] ${JSON.stringify({ event, ...data })}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dayOf = (d: Date) => d.toISOString().slice(0, 10)

/** Opens in this process that are already drawing a film's pictures (a second open waits for the same set). */
const inflight = new Map<string, Promise<ArtRecord>>()
export const artInFlight = (id: string) => inflight.get(id)
/** Films with a background retry waiting in this process. */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

export interface RenderInput {
  id: string
  film: FilmRecord
  memorial: boolean
  /** A sample's picture revision (engine/animation.ts): an art record of another revision is ignored. */
  rev?: string
}

/** The pictures of a film: from the store when they are done, else drawn now (once, however many opens). Never throws; undrawn slots show washi. */
export function ensureArt(deps: ArtDeps, input: RenderInput): Promise<ArtRecord> {
  const running = inflight.get(input.id)
  if (running) return running
  const p = renderLocked(deps, input).catch((err) => {
    ;(deps.log ?? console.log)(`[ichirei-film] ${JSON.stringify({ event: 'film_render_error', reason: err instanceof Error ? err.message.slice(0, 80) : 'error' })}`)
    return pendingArt(input, 'error', deps.now?.() ?? new Date())
  })
  inflight.set(input.id, p)
  const done = () => { if (inflight.get(input.id) === p) inflight.delete(input.id) }
  p.then(done, done)
  return p
}

/** Nothing drawn (an error before anything was saved): washi for now, every slot still to be drawn on the next open. Not saved. */
const pendingArt = (input: RenderInput, reason: string, now: Date): ArtRecord => ({ schema: 'film-art', id: input.id, status: 'incomplete', started_at: now.toISOString(), slots: input.film.lines.map(() => 'pending' as const), reasons: input.film.lines.map(() => reason), rev: input.rev })
/** A fallback script has nothing to draw: final washi. */
const scriptFallbackArt = (input: RenderInput, now: Date): ArtRecord => ({ schema: 'film-art', id: input.id, status: 'done', started_at: now.toISOString(), made_at: now.toISOString(), slots: input.film.lines.map(() => 'washi' as const), reasons: input.film.lines.map(() => 'fallback_script') })

/** `fn` over `items`, at most `limit` at a time, results in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

const waitsOf = (env: NodeJS.ProcessEnv): number[] => {
  const v = env.ICHIREI_FILM_QUOTA_WAITS_MS
  if (v === undefined || v === '') return [8000, 20000, 40000]
  return v.split(',').map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0)
}

async function renderLocked(deps: ArtDeps, input: RenderInput): Promise<ArtRecord> {
  const env = deps.env ?? process.env
  const now = () => deps.now?.() ?? new Date()
  const log = deps.log ?? ((l: string) => console.log(l))
  const { store } = deps
  const { id } = input
  if (input.film.status !== 'ready' || !Array.isArray(input.film.pictures) || input.film.pictures.length === 0) return scriptFallbackArt(input, now())
  const n = input.film.pictures.length
  const descriptions = input.film.pictures
  const started = Date.now()
  const deadline = started + renderBudgetMs(env)

  // the lock: a create-if-absent object. Someone else's fresh lease is waited for; a stale one (a crashed instance) is taken over; an INCOMPLETE film
  // is drawn again (only its pending slots) once its retry time has come; a deferral of an earlier day is taken over.
  let cur: ArtRecord | null = null
  for (;;) {
    const raw = await readArtRaw(store, id)
    const stale = !!raw && (raw.rev ?? undefined) !== (input.rev ?? undefined) // a sample of an older revision: drawn again from scratch
    cur = stale ? null : raw
    if (cur?.status === 'done') return cur
    if (cur?.status === 'incomplete' && !deps.force && cur.retry_after && Date.parse(cur.retry_after) > now().getTime()) return cur
    if (cur?.status === 'rendering' && Date.parse(cur.started_at) > now().getTime() - LEASE_MS) {
      if (Date.now() > deadline) return cur
      await sleep(deps.pollMs ?? 2000)
      continue
    }
    if (cur?.status === 'deferred' && cur.date === dayOf(now())) return cur
    const carried = cur && cur.slots.length === n
    const lease: ArtRecord = { ...(carried ? cur! : {}), schema: 'film-art', id, status: 'rendering', started_at: now().toISOString(), slots: carried ? cur!.slots : [], rev: input.rev }
    const got = await store.putObject(artPath(id), JSON.stringify(lease), 'application/json', raw ? {} : { ifAbsent: true })
    if (got) break
    // lost the race: look again
  }
  const retry = !!cur && cur.slots.length === n // a later try of an incomplete film: only the pending slots, and not a new set for the daily count

  // the daily limit (a set is counted once, when it is first drawn)
  const today = dayOf(now())
  const max = dailyMax(env)
  if (!retry && Number.isFinite(max)) {
    const used = ((await store.getObject(rendersPath(today)))?.toString('utf8').split('\n').filter(Boolean).length) ?? 0
    if (used >= max) {
      const deferred: ArtRecord = { schema: 'film-art', id, status: 'deferred', started_at: now().toISOString(), date: today, slots: [], rev: input.rev }
      await store.putObject(artPath(id), JSON.stringify(deferred), 'application/json')
      logLine(log, 'film_render_deferred', { used, max })
      return deferred
    }
  }
  if (!retry) await store.appendJsonl(rendersPath(today), { ts: now().toISOString(), id }).catch(() => {})

  const slots: ArtRecord['slots'] = retry ? [...cur!.slots] : Array(n).fill('pending')
  const reasons: string[] = retry ? [...(cur!.reasons ?? Array(n).fill(''))] : Array(n).fill('')
  const checkFails: number[] = retry ? [...(cur!.check_fails ?? Array(n).fill(0))] : Array(n).fill(0)
  let calls = retry ? (cur!.calls ?? 0) : 0
  const cap = num(env.ICHIREI_FILM_CALL_CAP, 8)
  const todo = [...Array(n).keys()].filter((i) => slots[i] === 'pending')
  logLine(log, retry ? 'film_render_retry' : 'film_render_start', { pictures: n, pending: todo.length })

  const image = deps.image ?? vertexImageClient(env)
  const client = deps.client ?? new Anthropic({ maxRetries: 0 })
  const timeout = num(env.ICHIREI_FILM_IMAGE_TIMEOUT_MS, 60_000)
  const concurrency = num(env.ICHIREI_FILM_IMAGE_CONCURRENCY, 2)
  const waits = waitsOf(env)
  const fresh = new Map<number, Buffer>()
  let modelUsed = ''
  let drawn = 0
  const usage = { input_tokens: 0, output_tokens: 0 }

  /** One picture, with the quota waits: a 429 (after the fallback model was tried too) waits 8 s, 20 s, 40 s — while the render window has room. */
  const draw = async (slot: number, attempt: number): Promise<{ webp: Buffer } | { error: string }> => {
    let w = 0
    for (;;) {
      if (calls >= cap) return { error: 'limit' }
      const signal = callSignal(deps.signal, timeout)
      try {
        const hint = attempt > 1 && reasons[slot] ? (RETRY_HINT[reasons[slot]] ?? '') : ''
        const r = await image.generate(buildImagePrompt(descriptions[slot], input.memorial, hint), signal)
        calls++
        drawn++
        modelUsed = r.model
        return { webp: await toFilmWebp(r.bytes) }
      } catch (err) {
        const code = err instanceof ImageError ? err.code : timedOut(signal) ? 'timeout' : 'image'
        if (code === 'quota') {
          // not counted against the order's limit: nothing was drawn
          const wait = waits[w++]
          if (wait === undefined || Date.now() + wait + 20_000 > deadline) {
            logLine(log, 'film_image_error', { slot: slot + 1, code, attempt, gave_up: true })
            return { error: 'quota' }
          }
          logLine(log, 'film_quota_wait', { slot: slot + 1, wait_ms: wait, attempt })
          await sleep(wait)
          continue
        }
        calls++
        logLine(log, 'film_image_error', { slot: slot + 1, code, attempt })
        return { error: code }
      }
    }
  }

  /** Draw `list`, two at a time, then check what was drawn with ONE vision call. A failed check is counted; the second one makes the washi final. */
  const round = async (list: number[], attempt: number) => {
    const results = await mapLimit(list, concurrency, async (slot) => ({ slot, r: await draw(slot, attempt) }))
    const good: { slot: number; webp: Buffer }[] = []
    for (const { slot, r } of results) {
      if ('webp' in r) good.push({ slot, webp: r.webp })
      else reasons[slot] = r.error === 'limit' ? 'limit' : r.error
    }
    if (good.length === 0) return
    try {
      const jpegs = await Promise.all(good.map((g) => toCheckJpeg(g.webp)))
      const res = await checkPictures(client, jpegs, good.map((g) => descriptions[g.slot]), input.memorial, env, deps.signal)
      usage.input_tokens += res.input_tokens
      usage.output_tokens += res.output_tokens
      good.forEach((g, i) => {
        const v = res.verdicts[i]
        if (v.ok) {
          fresh.set(g.slot, g.webp)
          slots[g.slot] = 'ai'
          reasons[g.slot] = ''
        } else {
          checkFails[g.slot]++
          reasons[g.slot] = v.reason
          logLine(log, 'film_picture_fail', { slot: g.slot + 1, reason: v.reason, attempt, fails: checkFails[g.slot] })
          if (checkFails[g.slot] >= 2) slots[g.slot] = 'washi' // failed the safety check twice: final
        }
      })
    } catch (err) {
      // a picture that could not be checked is never shown; the slot stays pending (an outage is not final)
      logLine(log, 'film_check_error', { reason: err instanceof ImageError ? err.code : 'check', attempt })
      for (const g of good) reasons[g.slot] = 'check_error'
    }
  }

  await round(todo, 1)
  // each picture that failed the check, or hit a transient error other than quota, is drawn once more in this same render
  const again = todo.filter((i) => slots[i] === 'pending' && reasons[i] !== 'quota' && reasons[i] !== 'check_error' && reasons[i] !== 'limit' && reasons[i] !== 'permission' && reasons[i] !== 'model_not_found')
  if (again.length > 0 && Date.now() < deadline - 15_000) await round(again, 2)
  // the order's limit reached: what is still pending can no longer be drawn — final washi
  for (let i = 0; i < n; i++) if (slots[i] === 'pending' && reasons[i] === 'limit') slots[i] = 'washi'

  await Promise.all([...fresh].map(([i, w]) => store.putObject(picturePath(id, i + 1), w, 'image/webp')))
  const incomplete = slots.includes('pending')
  const ms = Date.now() - started
  const art: ArtRecord = {
    schema: 'film-art', id, status: incomplete ? 'incomplete' : 'done', started_at: new Date(started).toISOString(), made_at: now().toISOString(), slots,
    reasons: reasons.map((r, i) => (slots[i] === 'ai' ? 'ok' : r || 'ok')), check_fails: checkFails, calls, rev: input.rev, ms: (cur?.ms ?? 0) + ms, model: modelUsed || cur?.model,
    ...(incomplete ? { retry_after: new Date(now().getTime() + num(env.ICHIREI_FILM_RETRY_MS, 60_000)).toISOString() } : {}),
    ...(cur?.bg_scheduled ? { bg_scheduled: true } : {}),
  }
  // one background retry about ten minutes later (best effort: an idle Cloud Run instance may be paused — the next open draws them anyway)
  const bgMs = env.ICHIREI_FILM_BG_RETRY_MS === undefined || env.ICHIREI_FILM_BG_RETRY_MS === '' ? 600_000 : Number(env.ICHIREI_FILM_BG_RETRY_MS)
  if (incomplete && !art.bg_scheduled && bgMs > 0 && !deps.force) {
    art.bg_scheduled = true
    const t = setTimeout(() => {
      retryTimers.delete(id)
      void ensureArt({ ...deps, force: true, signal: undefined }, input)
    }, bgMs)
    t.unref?.()
    retryTimers.set(id, t)
  }
  await store.putObject(artPath(id), JSON.stringify(art), 'application/json')
  const usd = drawn * Number(env.ICHIREI_FILM_IMAGE_USD || 0.039) + (usage.input_tokens * 1 + usage.output_tokens * 5) / 1e6
  logLine(log, 'film_render_done', { ms, pictures: slots.filter((x) => x === 'ai').length, drawn, washi: slots.filter((x) => x === 'washi').length, pending: slots.filter((x) => x === 'pending').length, incomplete, est_cost_jpy: Math.round(usd * Number(env.ICHIREI_FILM_JPY_PER_USD || 150) * 10) / 10 })
  return art
}
