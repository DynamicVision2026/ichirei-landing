// The pictures of the story film: four new ink-wash pictures per order, each drawn from the picture description the film script holds (engine/film.ts).
// They are drawn on the FIRST OPEN of /a/<id> (after payment), not when the order is made: an order that is never paid costs nothing for pictures.
//
//   1. one request (POST /api/film/<id>/render) stays open until the pictures are done (≤ 120 s), so Cloud Run keeps the CPU allocated;
//   2. the four pictures are drawn TWO AT A TIME by Google's image model on Vertex AI (the service account's own token — no API key); a quota
//      answer (429) tries the next model, then waits 8 s, 20 s, 40 s and tries again, inside the render window;
//   3. one vision call (engine/film-picture-check-prompt.md) looks at what was drawn; a picture that fails is drawn ONE more time; washi is FINAL only
//      for a picture that fails the safety check twice. A slot that failed only for quota or an outage stays `pending`: the film shows washi there now, is
//      marked `incomplete`, and the next open (and one background retry ~10 minutes later) draws ONLY the missing slots. A picture that was drawn but
//      could not be CHECKED (the check call failed) is kept stored as `unchecked` (films/<id>/<n>.unchecked.webp, never served): only the check is
//      retried (5 s, 15 s, 30 s, then on the next open). A film always plays;
//   4. the pictures are saved as private objects (films/<animation id>/1.webp … 4.webp) in the order bucket and served only through the server.
//
// A lock (in this process and, through a create-if-absent object, across instances) makes two opens draw one set. Limits: one full set and four
// single-picture retries per order (12 successful draws — our own errors, quota answers, timeouts and check errors never count); ICHIREI_FILM_DAILY_MAX sets (default 200) a day — above it
// the pictures wait for the next day (a retry of an incomplete film is not a new set).
//
// Env: ICHIREI_FILM_IMAGE_MODEL (one or more, separated by | , or ;, tried in order when a model is not found; default gemini-3.1-flash-image|gemini-2.5-flash-image),
// ICHIREI_FILM_IMAGE_LOCATION (default global), ICHIREI_FILM_IMAGE_PROJECT (default: the project of the metadata server), ICHIREI_FILM_IMAGE_TIMEOUT_MS
// (90000 per picture), ICHIREI_FILM_RENDER_MS (120000: how long one request is held), ICHIREI_FILM_RENDER_DEADLINE_MS (200000), ICHIREI_FILM_DAILY_MAX, ICHIREI_FILM_CHECK_MODEL (default claude-haiku-5-5), ICHIREI_FILM_CHECK_MAX_TOKENS (4000), ICHIREI_FILM_CHECK_TIMEOUT_MS (60000), ICHIREI_FILM_CHECK_WAITS_MS (5000,15000,30000),
// ICHIREI_FILM_IMAGE_USD / ICHIREI_FILM_JPY_PER_USD (the cost estimate in the log: 0.039 and 150 — assumptions, not measurements),
// ICHIREI_FILM_IMAGE_CONCURRENCY (2), ICHIREI_FILM_QUOTA_WAITS_MS (8000,20000,40000), ICHIREI_FILM_RETRY_MS (60000: the least time between two tries of an
// incomplete film), ICHIREI_FILM_BG_RETRY_MS (600000: the one background retry; 0 = none), ICHIREI_FILM_CALL_CAP (12).
// Logs (no story text): [ichirei-film] film_render_start | film_render_done | film_picture_fail | film_image_error | film_quota_wait | film_check_error | film_check_wait | film_picture_rewrite | film_render_deferred | film_render_retry.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { DEFAULT_REVIEW_MODEL } from './engine.ts'
import type { Language } from './contract.ts'
import { checkPictures as refereeDescriptions, type FilmRecord } from './film.ts'
import { callSignal, timedOut } from './limits.ts'
import type { OrderStore } from './order-store.ts'

// ---- the style (fixed, the same for every order) ----------------------------------------------------------------------------------------------------

export const IMAGE_STYLE =
  'Japanese sumi-e ink-wash painting on warm off-white washi paper. Soft graded black ink only, with at most one muted earth-brown accent wash. Loose, confident brush strokes, visible paper grain, generous empty space. People only as hands, or seen from behind, or from far away as small silhouettes; never a face, not even in profile, and no facial features. No text, letters, signatures, seals or frames. Quiet, tender, everyday life. People wear contemporary everyday clothes; modern objects (a plain modern umbrella, modern doors, phones and trains) unless the description says otherwise. Consistent hand, as if one painter made the whole series. Portrait 4:5.'
export const IMAGE_STYLE_MEMORIAL = 'Paler grey-beige paper, very soft ink, still and calm.'
/** Added to a picture drawn a second time, for the reason it failed the first time. */
const RETRY_HINT: Record<string, string> = {
  face: 'Absolutely no faces, not even in profile: show only hands, or a person seen from behind or far away as a small silhouette.',
  text: 'Absolutely no writing, letters or marks that look like writing anywhere in the picture.',
  illness: 'Show only a calm everyday moment: no medical or sickroom scene, no injury.',
  celebration: 'No celebration of any kind: quiet and still.',
  unsafe: 'Gentle, safe, everyday imagery only.',
  clothing: 'People wear contemporary everyday clothes; no kimono or traditional dress.',
  setting: 'A modern, ordinary home and street; no traditional Japanese interior, lanterns or shrine architecture.',
  religious: 'No religious symbol of any kind: no cross (not even one made by a window frame), altar, shrine or temple.',
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
  /** One per picture: `ai` = drawn and saved as films/<id>/<n>.webp; `washi` = the plain picture, FINAL (it failed the safety check twice); `pending` = not drawn yet; `unchecked` = drawn and kept stored (films/<id>/<n>.unchecked.webp) but the safety check could not run yet — never shown. */
  slots: ('ai' | 'washi' | 'pending' | 'unchecked')[]
  /** Why a slot is not (yet) a picture (codes only). */
  reasons?: string[]
  /** How often each slot's picture failed the safety check: the second failure makes the description be rewritten once; a failure after that makes the washi final. */
  check_fails?: number[]
  /** Per slot: 1 once its description was rewritten (the same moment from a different view) — the rewrite happens once. */
  rewrites?: number[]
  /** Per slot: the rewritten description (null = the film's own). */
  rewritten?: (string | null)[]
  /** Successful draws so far (an error, a quota answer or a timeout is not one): the order's cap is 8. */
  calls?: number
  /** The earliest time the next open may draw the pending slots again. */
  retry_after?: string
  /** The one background retry was scheduled. */
  bg_scheduled?: boolean
  /** Samples only: the set of pictures was redrawn for a new revision (an older art record is ignored). */
  rev?: string
  /** Per slot: milliseconds from the start of the render that drew it to the moment it passed its check (null = not a picture). For the owner's timing. */
  ready_ms?: (number | null)[]
  /** Washi slots of the card preview got their one more full attempt after payment (engine/film-art.ts markWashiForRetry). */
  paid_retry?: boolean
  ms?: number
  model?: string
}

export const hasPending = (a: Pick<ArtRecord, 'slots'>): boolean => a.slots.includes('pending') || a.slots.includes('unchecked')

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
export const uncheckedPath = (id: string, n: number) => `films/${id}/${n}.unchecked.webp`
export const rendersPath = (day: string) => `films/renders-${day}.jsonl`
export const washiUrl = (slot: number) => `/film/washi-${(slot % 2) + 1}.webp`

const LEASE_MS = 240_000
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
const REASONS = new Set(['ok', 'face', 'text', 'illness', 'celebration', 'unsafe', 'clothing', 'setting', 'religious', 'off_story'])
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

export function buildCheckPrompt(descriptions: string[], memorial: boolean, language: Language = 'en'): string {
  const values: Record<string, string> = {
    LANGUAGE: language,
    MEMORIAL: memorial ? 'This is a REMEMBRANCE film (the person it is for has died): check "celebration".' : 'This is not a remembrance film: ignore "celebration".',
    DESCRIPTIONS: descriptions.map((d, i) => `Picture ${i + 1}: ${d}`).join('\n'),
  }
  return readPrompt().replace(/\{\{ (MEMORIAL|DESCRIPTIONS|LANGUAGE) \}\}/g, (m) => values[m.slice(3, -3).trim()])
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

/** What went wrong with ONE check call (no story text: the status, the stop reason and the first 200 characters of the reply). */
export interface CheckCause {
  kind: 'http' | 'timeout' | 'parse' | 'refusal' | 'max_tokens' | 'network'
  status?: number
  stop_reason?: string
  reply?: string
  /** One picture's own call (the fallback when the call over all of them failed). */
  single?: number
}

export interface CheckResult {
  /** One per picture; null = the check could not be done for that picture (it stays unchecked and is never shown). */
  verdicts: (Verdict | null)[]
  causes: CheckCause[]
  input_tokens: number
  output_tokens: number
}

class CheckFailure extends Error {
  readonly cause2: CheckCause
  constructor(c: CheckCause) {
    super(c.kind)
    this.cause2 = c
  }
}

function causeOf(err: unknown, signal: AbortSignal): CheckCause {
  if (err instanceof CheckFailure) return err.cause2
  const e = err as { status?: unknown; message?: unknown; name?: unknown } | null
  const reply = typeof e?.message === 'string' ? e.message.slice(0, 200) : undefined
  if (timedOut(signal)) return { kind: 'timeout' }
  if (typeof e?.status === 'number') return { kind: 'http', status: e.status, reply }
  return { kind: 'network', reply: reply ?? (typeof e?.name === 'string' ? e.name : undefined) }
}

/** ONE call over `jpegs`; throws CheckFailure with the cause. The answer is a few dozen tokens, but the model may think first: room and low effort for it. */
async function checkCall(client: Messages, jpegs: Buffer[], descriptions: string[], memorial: boolean, env: NodeJS.ProcessEnv, outer: AbortSignal | undefined, language: Language, usage: { input_tokens: number; output_tokens: number }): Promise<Verdict[]> {
  const model = env.ICHIREI_FILM_CHECK_MODEL?.trim() || DEFAULT_REVIEW_MODEL
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: buildCheckPrompt(descriptions, memorial, language) }]
  jpegs.forEach((j, i) => {
    content.push({ type: 'text', text: `Picture ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: j.toString('base64') } })
  })
  const signal = callSignal(outer, num(env.ICHIREI_FILM_CHECK_TIMEOUT_MS, 60_000))
  let message: Anthropic.Message
  try {
    message = await client.messages.stream({ model, max_tokens: num(env.ICHIREI_FILM_CHECK_MAX_TOKENS, 4000), output_config: { effort: 'low' }, messages: [{ role: 'user', content }] }, { signal }).finalMessage()
  } catch (err) {
    throw new CheckFailure(causeOf(err, signal))
  }
  usage.input_tokens += message.usage?.input_tokens ?? 0
  usage.output_tokens += message.usage?.output_tokens ?? 0
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const verdicts = parseVerdicts(text, jpegs.length)
  if (verdicts) return verdicts
  const stop = message.stop_reason ?? undefined
  throw new CheckFailure({ kind: stop === 'max_tokens' ? 'max_tokens' : stop === 'refusal' ? 'refusal' : 'parse', stop_reason: stop, reply: text.slice(0, 200) })
}

/**
 * Check pictures. One call over all of them; if that fails (whatever the cause), each picture gets its own call. A picture whose check still fails is
 * `null` in the result with the causes — the caller keeps it stored as unchecked and tries again later. Never throws.
 */
export async function checkPictures(client: Messages, jpegs: Buffer[], descriptions: string[], memorial: boolean, env: NodeJS.ProcessEnv = process.env, outer?: AbortSignal, language: Language = 'en'): Promise<CheckResult> {
  const usage = { input_tokens: 0, output_tokens: 0 }
  const causes: CheckCause[] = []
  try {
    return { verdicts: await checkCall(client, jpegs, descriptions, memorial, env, outer, language, usage), causes, ...usage }
  } catch (err) {
    causes.push(err instanceof CheckFailure ? err.cause2 : { kind: 'network' })
  }
  if (jpegs.length === 1) return { verdicts: [null], causes, ...usage }
  const verdicts: (Verdict | null)[] = Array(jpegs.length).fill(null)
  await mapLimit(jpegs.map((_, i) => i), 2, async (i) => {
    try {
      verdicts[i] = (await checkCall(client, [jpegs[i]], [descriptions[i]], memorial, env, outer, language, usage))[0]
    } catch (err) {
      causes.push({ ...(err instanceof CheckFailure ? err.cause2 : { kind: 'network' as const }), single: i + 1 })
    }
  })
  return { verdicts, causes, ...usage }
}

// ---- the one rewrite before a washi becomes final ---------------------------------------------------------------------------------------------------

function readRewritePrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [process.env.ICHIREI_FILM_REWRITE_PROMPT_PATH, join(here, 'film-picture-rewrite-prompt.md'), join(process.cwd(), 'engine', 'film-picture-rewrite-prompt.md')]) {
    if (!p) continue
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error('film-picture-rewrite-prompt.md not found')
}

export function buildRewritePrompt(description: string, reason: string, memorial: boolean, language: Language, feedback = ''): string {
  const values: Record<string, string> = {
    REASON: reason,
    LANGUAGE: language,
    MEMORIAL: memorial ? 'This is a REMEMBRANCE film (the person it is for has died): no celebration of any kind.' : '',
    DESCRIPTION: description,
    FEEDBACK: feedback,
  }
  return readRewritePrompt().replace(/\{\{ (REASON|LANGUAGE|MEMORIAL|DESCRIPTION|FEEDBACK) \}\}/g, (m) => values[m.slice(3, -3).trim()])
}

/**
 * The same moment from a different view, once (and one retry if the answer breaks a rule). The result must pass the same description rules as a film's own
 * pictures and must differ from the original. Throws ImageError('rewrite') when it cannot be had — an outage, never a verdict on the picture.
 */
export async function rewritePicture(client: Messages, description: string, reason: string, memorial: boolean, language: Language, env: NodeJS.ProcessEnv = process.env, outer?: AbortSignal): Promise<{ text: string; input_tokens: number; output_tokens: number }> {
  const model = env.ICHIREI_FILM_CHECK_MODEL?.trim() || DEFAULT_REVIEW_MODEL
  const usage = { input_tokens: 0, output_tokens: 0 }
  let feedback = ''
  let last = 'call'
  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = callSignal(outer, num(env.ICHIREI_FILM_CHECK_TIMEOUT_MS, 60_000))
    try {
      const message = await client.messages.stream({ model, max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: buildRewritePrompt(description, reason, memorial, language, feedback) }] }, { signal }).finalMessage()
      usage.input_tokens += message.usage?.input_tokens ?? 0
      usage.output_tokens += message.usage?.output_tokens ?? 0
      const raw = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const a = raw.indexOf('{')
      const b = raw.lastIndexOf('}')
      const text = a >= 0 && b > a ? ((JSON.parse(raw.slice(a, b + 1)) as { picture?: unknown }).picture ?? '') : ''
      if (typeof text !== 'string' || !text.trim()) {
        last = 'parse'
        feedback = '\nYOUR PREVIOUS REPLY COULD NOT BE READ: reply with exactly one JSON object {"picture": "…"}.\n'
        continue
      }
      const t = text.trim()
      const problems = refereeDescriptions([t], { glyph: '', forms: [], names: [], memorial, occasion: memorial ? 'memorial' : null, language }).filter((p) => p.code !== 'pic_same')
      if (t.toLowerCase() === description.trim().toLowerCase()) problems.push({ code: 'pic_same', detail: 'It must read differently from the original: a different view of the same moment.' })
      if (problems.length === 0) return { text: t, ...usage }
      last = 'rules'
      feedback = `\nYOUR PREVIOUS ANSWER BROKE THESE RULES — write a new one that fixes every one of them:\n${problems.map((p) => `- ${p.detail}`).join('\n')}\n`
    } catch {
      last = timedOut(signal) ? 'timeout' : 'call'
      feedback = ''
    }
  }
  throw new ImageError('rewrite', last)
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
  /** The card preview (before payment): every picture is checked on its own and shown as soon as it passes (see `progress` in renderLocked). */
  progress?: boolean
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
  /** The buyer's language: the picture check judges the setting against it. */
  language?: Language
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
  // how long this render may keep starting waits and retries: longer than the 120 s a request is held (the page asks again and joins this same render)
  const deadline = started + num(env.ICHIREI_FILM_RENDER_DEADLINE_MS, 200_000)

  // the lock: a create-if-absent object. Someone else's fresh lease is waited for; a stale one (a crashed instance) is taken over; an INCOMPLETE film
  // is drawn again (only its pending slots) once its retry time has come; a deferral of an earlier day is taken over.
  let cur: ArtRecord | null = null
  let leaseAt = ''
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
    leaseAt = now().toISOString()
    const lease: ArtRecord = { ...(carried ? cur! : {}), schema: 'film-art', id, status: 'rendering', started_at: leaseAt, slots: carried ? cur!.slots : [], rev: input.rev }
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
  const rewrites: number[] = retry ? [...(cur!.rewrites ?? Array(n).fill(0))] : Array(n).fill(0)
  const rewritten: (string | null)[] = retry ? [...(cur!.rewritten ?? Array(n).fill(null))] : Array(n).fill(null)
  /** The description a slot is drawn and checked from: its rewrite when there is one. */
  const desc = (i: number) => rewritten[i] ?? descriptions[i]
  /** Slots whose description was just rewritten and have not been drawn since. */
  const afterRewrite = new Set<number>()
  let calls = retry ? (cur!.calls ?? 0) : 0
  const cap = num(env.ICHIREI_FILM_CALL_CAP, 12)
  // a scene the script could not make safe (v9.9) has no picture description: its slot is the plain washi tile, final — the other scenes are drawn as usual
  for (let i = 0; i < n; i++) {
    if (!String(descriptions[i] ?? '').trim()) {
      slots[i] = 'washi'
      reasons[i] = 'scene_blocked'
      checkFails[i] = 2
    }
  }
  const todo = [...Array(n).keys()].filter((i) => slots[i] === 'pending')
  const toCheck = [...Array(n).keys()].filter((i) => slots[i] === 'unchecked')
  logLine(log, retry ? 'film_render_retry' : 'film_render_start', { pictures: n, pending: todo.length, unchecked: toCheck.length })

  const image = deps.image ?? vertexImageClient(env)
  const client = deps.client ?? new Anthropic({ maxRetries: 0 })
  const timeout = num(env.ICHIREI_FILM_IMAGE_TIMEOUT_MS, 90_000)
  const concurrency = num(env.ICHIREI_FILM_IMAGE_CONCURRENCY, 2)
  const waits = waitsOf(env)
  const checkWaits = (env.ICHIREI_FILM_CHECK_WAITS_MS === undefined || env.ICHIREI_FILM_CHECK_WAITS_MS === '' ? '5000,15000,30000' : env.ICHIREI_FILM_CHECK_WAITS_MS).split(',').map(Number).filter((x) => Number.isFinite(x) && x >= 0)
  let modelUsed = ''
  let drawn = 0
  const usage = { input_tokens: 0, output_tokens: 0 }

  /** One picture, with the quota waits: a 429 (after the fallback model was tried too) waits 8 s, 20 s, 40 s — while the render window has room. Only a picture that was drawn counts toward the order's cap. */
  const draw = async (slot: number, attempt: number): Promise<{ webp: Buffer } | { error: string }> => {
    let w = 0
    for (;;) {
      if (calls >= cap) return { error: 'limit' }
      const signal = callSignal(deps.signal, timeout)
      try {
        const hint = attempt > 1 && reasons[slot] ? (RETRY_HINT[reasons[slot]] ?? '') : ''
        const r = await image.generate(buildImagePrompt(desc(slot), input.memorial, hint), signal)
        calls++
        afterRewrite.delete(slot)
        drawn++
        modelUsed = r.model
        return { webp: await toFilmWebp(r.bytes) }
      } catch (err) {
        const code = err instanceof ImageError ? err.code : timedOut(signal) ? 'timeout' : 'image'
        if (code === 'quota') {
          const wait = waits[w++]
          if (wait === undefined || Date.now() + wait + 20_000 > deadline) {
            logLine(log, 'film_image_error', { slot: slot + 1, code, attempt, gave_up: true })
            return { error: 'quota' }
          }
          logLine(log, 'film_quota_wait', { slot: slot + 1, wait_ms: wait, attempt })
          await sleep(wait)
          continue
        }
        // our own errors (an error answer, a timeout, a network failure) are not counted either: nothing was drawn
        logLine(log, 'film_image_error', { slot: slot + 1, code, attempt })
        return { error: code }
      }
    }
  }

  /** Before a washi becomes final: the description is rewritten ONCE (the same moment from a different view). false = the rewrite could not be had (an outage: the slot stays pending). */
  const rewriteSlot = async (slot: number, reason: string): Promise<boolean> => {
    try {
      const r = await rewritePicture(client, desc(slot), reason, input.memorial, input.language ?? 'en', env, deps.signal)
      usage.input_tokens += r.input_tokens
      usage.output_tokens += r.output_tokens
      rewritten[slot] = r.text
      rewrites[slot] = 1
      checkFails[slot] = 1 // the drawing from the new view gets its own check: failing that one is final
      afterRewrite.add(slot)
      logLine(log, 'film_picture_rewrite', { slot: slot + 1, reason, ok: true })
      return true
    } catch (err) {
      logLine(log, 'film_picture_rewrite', { slot: slot + 1, reason, ok: false, cause: err instanceof ImageError ? err.message : 'call' })
      return false
    }
  }

  /**
   * The safety check of pictures that are stored as unchecked. One call over all of them (or one each, if that fails); a check that could not run is tried
   * again after 5 s, 15 s, 30 s while the window has room; what is still unchecked stays stored for the next open. A failed check is counted; the second
   * one makes that slot's washi final. A verdict "ok" makes the picture public to the page (films/<id>/<n>.webp).
   */
  const checkStored = async (items: { slot: number; webp: Buffer }[], attempt: number) => {
    let left = items
    for (let t = 0; left.length > 0; t++) {
      const jpegs = await Promise.all(left.map((g) => toCheckJpeg(g.webp)))
      const res = await checkPictures(client, jpegs, left.map((g) => desc(g.slot)), input.memorial, env, deps.signal, input.language)
      usage.input_tokens += res.input_tokens
      usage.output_tokens += res.output_tokens
      const still: typeof left = []
      for (const [i, g] of left.entries()) {
        const v = res.verdicts[i]
        if (!v) {
          still.push(g)
        } else if (v.ok) {
          await store.putObject(picturePath(id, g.slot + 1), g.webp, 'image/webp')
          slots[g.slot] = 'ai'
          reasons[g.slot] = ''
        } else {
          checkFails[g.slot]++
          reasons[g.slot] = v.reason
          logLine(log, 'film_picture_fail', { slot: g.slot + 1, reason: v.reason, attempt, fails: checkFails[g.slot] })
          if (checkFails[g.slot] < 2) slots[g.slot] = 'pending' // failed once: drawn again as it is
          else if (rewrites[g.slot] < 1) {
            // failed twice: the description is rewritten once and drawn again (if the rewrite cannot be had now, the slot waits for the next try)
            await rewriteSlot(g.slot, v.reason)
            slots[g.slot] = 'pending'
          } else slots[g.slot] = 'washi' // failed after the rewrite too: final
        }
      }
      if (still.length > 0) {
        // the real cause, so a log tells why (no story text: the status, the stop reason and the first 200 characters of the reply)
        logLine(log, 'film_check_error', { reason: 'check', slots: still.map((g) => g.slot + 1), try: t + 1, causes: res.causes.slice(0, 4) })
        for (const g of still) reasons[g.slot] = 'unchecked'
      }
      left = still
      const wait = checkWaits[t]
      if (left.length === 0 || wait === undefined || Date.now() + wait + 20_000 > deadline) break
      logLine(log, 'film_check_wait', { slots: left.map((g) => g.slot + 1), wait_ms: wait })
      await sleep(wait)
    }
    for (const g of left) slots[g.slot] = 'unchecked'
  }

  /** The moment each picture passed its check, as milliseconds since this render began (kept in the record; the owner reads it as 'seconds from the pick'). */
  const readyMs: (number | null)[] = Array(n).fill(null)
  const hadPicture = slots.map((s) => s === 'ai') // pictures from an earlier render keep their own time
  const markReady = () => {
    for (let i = 0; i < n; i++) if (slots[i] === 'ai' && !hadPicture[i] && readyMs[i] === null) readyMs[i] = Date.now() - started
  }
  /** While drawing: the pictures that are already checked are written into the lease (same start time, still `rendering`), so a page that is waiting can show each one as it arrives (the card preview). */
  const progress = async () => {
    markReady()
    const snap: ArtRecord = { schema: 'film-art', id, status: 'rendering', started_at: leaseAt, slots: slots.map((s) => (s === 'ai' || s === 'washi' ? s : ('pending' as const))), rev: input.rev, ...(cur?.paid_retry ? { paid_retry: true } : {}) }
    await store.putObject(artPath(id), JSON.stringify(snap), 'application/json').catch(() => {})
  }

  /** Draw `list`, two at a time. Each picture drawn is STORED (unchecked) before anything else, so a check that fails can never throw a drawing away. */
  const round = async (list: number[], attempt: number) => {
    // a slot that already failed twice and was waiting for its rewrite (the rewrite could not be had earlier)
    for (const slot of [...list]) {
      if (slots[slot] === 'pending' && checkFails[slot] >= 2 && rewrites[slot] < 1 && !(await rewriteSlot(slot, reasons[slot] || 'off_story'))) list = list.filter((x) => x !== slot)
    }
    if (deps.progress) {
      // The card preview (before payment): each picture is stored the moment it is drawn and checked on its own while the next one is drawn,
      // and every picture that has passed is written into the lease — the page that waits shows each one as soon as it is there.
      await mapLimit(list, concurrency, async (slot) => {
        const r = await draw(slot, attempt)
        if (!('webp' in r)) {
          reasons[slot] = r.error
          return
        }
        await store.putObject(uncheckedPath(id, slot + 1), r.webp, 'image/webp')
        slots[slot] = 'unchecked'
        await checkStored([{ slot, webp: r.webp }], attempt)
        await progress()
      })
      return
    }
    const results = await mapLimit(list, concurrency, async (slot) => ({ slot, r: await draw(slot, attempt) }))
    const good: { slot: number; webp: Buffer }[] = []
    for (const { slot, r } of results) {
      if ('webp' in r) good.push({ slot, webp: r.webp })
      else reasons[slot] = r.error
    }
    if (good.length === 0) return
    await Promise.all(good.map((g) => store.putObject(uncheckedPath(id, g.slot + 1), g.webp, 'image/webp')))
    for (const g of good) slots[g.slot] = 'unchecked'
    await checkStored(good, attempt)
  }

  // pictures drawn earlier whose check could not run: only the check is done again (nothing is drawn)
  if (toCheck.length > 0) {
    const loaded: { slot: number; webp: Buffer }[] = []
    for (const i of toCheck) {
      const webp = await store.getObject(uncheckedPath(id, i + 1)).catch(() => null)
      if (webp) loaded.push({ slot: i, webp })
      else slots[i] = 'pending' // the stored picture is gone: draw it again
    }
    if (loaded.length > 0) await checkStored(loaded, 0)
  }
  await round(todo.concat(toCheck.filter((i) => slots[i] === 'pending' && !todo.includes(i))), 1)
  // each picture that failed the check, or hit a transient error other than quota, is drawn once more in this same render
  const again = [...Array(n).keys()].filter((i) => slots[i] === 'pending' && ['', 'face', 'text', 'illness', 'celebration', 'unsafe', 'clothing', 'setting', 'religious', 'off_story', 'http', 'timeout', 'network', 'no_image', 'blocked', 'image'].includes(reasons[i]) && (todo.includes(i) || toCheck.includes(i)))
  if (again.length > 0 && Date.now() < deadline - 15_000) await round(again, 2)
  // a description rewritten in the last round is drawn from its new view right away (and checked: failing that is final)
  const third = [...afterRewrite].filter((i) => slots[i] === 'pending')
  if (third.length > 0 && Date.now() < deadline - 15_000) await round(third, 3)

  const incomplete = slots.includes('pending') || slots.includes('unchecked')
  const ms = Date.now() - started
  const art: ArtRecord = {
    schema: 'film-art', id, status: incomplete ? 'incomplete' : 'done', started_at: new Date(started).toISOString(), made_at: now().toISOString(), slots, ready_ms: ((): (number | null)[] => { markReady(); return slots.map((sl, i) => (sl === 'ai' ? (readyMs[i] ?? (cur?.ready_ms?.[i] ?? null)) : null)) })(),
    reasons: reasons.map((r, i) => (slots[i] === 'ai' ? 'ok' : r || 'ok')), check_fails: checkFails, rewrites, rewritten, calls, rev: input.rev, ms: (cur?.ms ?? 0) + ms, model: modelUsed || cur?.model,
    ...(incomplete ? { retry_after: new Date(now().getTime() + num(env.ICHIREI_FILM_RETRY_MS, 60_000)).toISOString() } : {}),
    ...(cur?.bg_scheduled ? { bg_scheduled: true } : {}),
    ...(cur?.paid_retry ? { paid_retry: true } : {}),
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

/**
 * After payment, the washi slots of the card preview get ONE more full attempt (a fresh draw, check and, if it fails twice, a fresh description rewrite): they are
 * made pending again with their counters cleared and a fresh call budget; the pictures that are there stay exactly as they are. Done once per film (`paid_retry`).
 * Returns true when something was reset (the next open of the film then draws only those slots).
 */
export async function markWashiForRetry(store: OrderStore, id: string, now: Date = new Date()): Promise<boolean> {
  const art = await readArtRaw(store, id)
  if (!art || art.paid_retry || (art.status !== 'done' && art.status !== 'incomplete') || !art.slots.includes('washi')) return false
  const n = art.slots.length
  const wash = art.slots.map((s, i) => s === 'washi' && art.reasons?.[i] !== 'scene_blocked') // (a scene the script could not make safe stays washi)
  if (!wash.includes(true)) return false
  const next: ArtRecord = {
    ...art,
    status: 'incomplete',
    paid_retry: true,
    slots: art.slots.map((s, i) => (wash[i] ? ('pending' as const) : s)),
    reasons: (art.reasons ?? Array(n).fill('')).map((r, i) => (wash[i] ? '' : r)),
    check_fails: (art.check_fails ?? Array(n).fill(0)).map((c, i) => (wash[i] ? 0 : c)),
    rewrites: (art.rewrites ?? Array(n).fill(0)).map((c, i) => (wash[i] ? 0 : c)),
    rewritten: (art.rewritten ?? Array(n).fill(null)).map((r, i) => (wash[i] ? null : r)),
    ready_ms: (art.ready_ms ?? Array(n).fill(null)).map((r, i) => (wash[i] ? null : r)),
    calls: 0,
    retry_after: now.toISOString(),
    bg_scheduled: false,
  }
  await store.putObject(artPath(id), JSON.stringify(next), 'application/json')
  return true
}
