// The free card preview before payment (2026-10-30). The sender chooses a character FIRST; only then do the four story pictures start — so the pictures never
// sway the choice. The pictures depend on the story alone: they are drawn ONCE per story and reused for every character, poem format and set of candidates.
// If the story text changes, it is a new story and a new set.
//
// A draft is a small animation record under a private id (no order behind it: order_ref DRAFT) with the film script and, beside it, the pictures
// (films/<id>/…, engine/film-art.ts). It keeps a hash of the story, never the story. When the order is made, the SAME record becomes the order's film:
// nothing is written or drawn twice (adoptDraft).
//
//   startPreview   write the script (one small model call) and save the draft; the same story gives back the same draft
//   previewView    what the page shows: the four lines and the pictures that are there so far
//   renderPreview  draw the pictures (a request that stays open, so Cloud Run keeps the CPU), each one shown as soon as it passes its check
//   adoptDraft     at order time: the draft becomes the order's film

import { createHash } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { ANIMATION_ID_PATTERN, isAnimationRecord, newAnimationId, pictureUrl, type AnimationRecord } from './animation.ts'
import type { Language } from './contract.ts'
import { ensureArt, readArt, renderBudgetMs, type ArtRecord, type ImageClient } from './film-art.ts'
import { checkPictures, makeFilm, type FilmInput, type FilmRecord } from './film.ts'
import type { OrderRecord } from './order.ts'
import type { OrderStore } from './order-store.ts'

export const DRAFT_REF = 'DRAFT'
/** The words shown to the film script's prompt while no character is chosen (engine/film-prompt.md says what to do with them). */
export const NOT_CHOSEN = '(chosen after the film)'

export interface PreviewDeps {
  store: OrderStore
  env?: NodeJS.ProcessEnv
  now?: () => Date
  /** Tests: stands in for the film-script call. */
  film?: (input: FilmInput) => Promise<FilmRecord>
  /** Tests: stand in for the image model and the picture check. */
  image?: ImageClient
  vision?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  pollMs?: number
}

export interface PreviewStart {
  /** The story as the engine saw it (story + follow-up answers). */
  story: string
  language: Language
  relationship: string | null
  direction: string | null
  occasion: string | null
  occasion_detail: string | null
  memorial: boolean
  /** v9.6: the tone line of the purpose, and whether the gift is a quiet one (apology, encouragement, remembrance). */
  tone?: string
  quiet?: boolean
  /** Every character shown to the sender for this story (both forms): none of them may appear in the film's lines. */
  shown: string[]
  /** A draft this browser already has for this story. */
  draft_id?: string | null
}

/** One story, one set: the hash of the story text, the language and whether it is a remembrance (the pictures' style). Never stored with the text. */
export const storyHash = (story: string, language: Language, memorial: boolean): string =>
  createHash('sha256').update(`${language}\n${memorial ? 'm' : 'l'}\n${story.replace(/\r\n?/g, '\n').trim()}`).digest('hex')

const read = async (store: OrderStore, id: string): Promise<AnimationRecord | null> => {
  if (!ANIMATION_ID_PATTERN.test(id)) return null
  try {
    const r = await store.get(id)
    return isAnimationRecord(r) ? r : null
  } catch {
    return null
  }
}

export const isDraft = (r: AnimationRecord | null): r is AnimationRecord & { draft: NonNullable<AnimationRecord['draft']> } => !!r && r.order_ref === DRAFT_REF && !!r.draft

export type StartOutcome =
  | { state: 'ok'; id: string; reused: boolean; script: 'ready' | 'fallback' }
  | { state: 'limited' }

/**
 * The draft of this story: the one the browser already has (same story → the same set, nothing drawn again) or a new one. `allowNew` is the
 * per-person daily limit — asked only when a NEW set would be drawn.
 */
export async function startPreview(deps: PreviewDeps, input: PreviewStart, allowNew: () => boolean = () => true): Promise<StartOutcome> {
  const pickedAt = (deps.now?.() ?? new Date()).toISOString()
  const hash = storyHash(input.story, input.language, input.memorial)
  if (input.draft_id) {
    const old = await read(deps.store, input.draft_id)
    if (isDraft(old) && old.draft.story_hash === hash && old.language === input.language) {
      return { state: 'ok', id: old.id, reused: true, script: old.film?.status === 'ready' ? 'ready' : 'fallback' }
    }
  }
  if (!allowNew()) return { state: 'limited' }
  const now = deps.now?.() ?? new Date()
  const forms = [...new Set(input.shown.filter(Boolean))]
  const filmInput: FilmInput = {
    story: input.story,
    language: input.language,
    relationship: input.relationship,
    direction: input.direction,
    occasion: input.occasion,
    occasion_detail: input.occasion_detail,
    memorial: input.memorial,
    ...(input.tone ? { tone: input.tone } : {}),
    ...(input.quiet ? { quiet: true } : {}),
    glyph: NOT_CHOSEN,
    forms,
    who: NOT_CHOSEN,
    moment: '',
    names: [],
  }
  // never blocks: a failed call or two failed checks give the fallback script (nothing to draw)
  const film = await (deps.film ?? ((i: FilmInput) => makeFilm(i, { log: deps.log })))(filmInput)
  const id = newAnimationId()
  const record: AnimationRecord = {
    schema: 'animation',
    id,
    order_ref: DRAFT_REF,
    created_at: now.toISOString(),
    language: input.language,
    glyph: '',
    reading: '',
    romanization: '',
    meaning_en: null,
    moment: '',
    who: '',
    memorial: input.memorial,
    film,
    draft: { story_hash: hash, memorial: input.memorial, created_at: now.toISOString(), picked_at: pickedAt },
  }
  await deps.store.put(id, record)
  return { state: 'ok', id, reused: false, script: film.status === 'ready' ? 'ready' : 'fallback' }
}

export type PreviewState = 'drawing' | 'done' | 'failed' | 'deferred'
/** One picture of the preview: drawn and checked (`ai`), the plain washi tile (`washi`: it failed its check — the others stay), or not there yet (`pending`). */
export type PreviewSlot = 'ai' | 'washi' | 'pending'
export interface PreviewView {
  id: string
  /**
   * drawing = still at work; done = finished — every slot is a picture or a washi tile, and at least one is a picture; failed = nothing could be drawn at all
   * (all four failed, or the script was only the fallback): only then does the page leave the pictures out; deferred = the film limit of the day.
   */
  state: PreviewState
  /** The four lines, in the order the story happened (empty for a fallback script). */
  lines: string[]
  /** Per picture: its address once it has passed its check, else null. A picture that is shown is never taken away. */
  pictures: (string | null)[]
  slots: PreviewSlot[]
}

/** What the page shows now: the lines and the pictures that are already there. */
export function viewOf(rec: AnimationRecord, art: ArtRecord | null): PreviewView {
  const film = rec.film
  if (!film || film.status !== 'ready' || film.lines.length !== 4) return { id: rec.id, state: 'failed', lines: [], pictures: [null, null, null, null], slots: ['washi', 'washi', 'washi', 'washi'] }
  const slots: PreviewSlot[] = film.lines.map((_, i) => (art && art.slots[i] === 'ai' ? 'ai' : art && art.slots[i] === 'washi' ? 'washi' : 'pending'))
  const pictures = film.lines.map((_, i) => (slots[i] === 'ai' ? pictureUrl(rec.id, i + 1, art?.made_at) : null))
  const anyPicture = slots.includes('ai')
  const settled = !slots.includes('pending')
  let state: PreviewState = 'drawing'
  if (art?.status === 'deferred') state = 'deferred'
  else if (art?.status === 'done' || (settled && art)) state = anyPicture ? 'done' : 'failed'
  else if (art?.status === 'incomplete') state = anyPicture ? 'drawing' : 'failed' // still being tried again; nothing drawn at all = failed for now
  return { id: rec.id, state, lines: film.lines, pictures, slots }
}

export async function previewView(deps: PreviewDeps, id: string): Promise<PreviewView | null> {
  const rec = await read(deps.store, id)
  if (!isDraft(rec)) return null
  const art = await readArt(deps.store, id).catch(() => null)
  return viewOf(rec, art)
}

/** Draw the pictures of a draft. Stays open until they are done or the render window ends; two calls draw one set. */
export async function renderPreview(deps: PreviewDeps, id: string): Promise<PreviewView | null> {
  const rec = await read(deps.store, id)
  if (!isDraft(rec)) return null
  if (rec.film?.status !== 'ready') return viewOf(rec, null)
  const budget = renderBudgetMs(deps.env)
  const t0 = Date.now()
  const art = await Promise.race([
    ensureArt({ store: deps.store, image: deps.image, client: deps.vision, env: deps.env, log: deps.log, now: deps.now, pollMs: deps.pollMs, progress: true }, { id, film: rec.film, memorial: rec.memorial, language: rec.language }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), budget).unref?.()),
  ])
  const final = art ?? (await readArt(deps.store, id).catch(() => null))
  // The owner's timing, per picture: seconds from the moment the character was picked (the draft's `picked_at`) to the moment each picture passed its check.
  const pickedMs = Date.parse(rec.draft.picked_at ?? rec.created_at)
  const startedMs = final ? Date.parse(final.started_at) : NaN
  const secs = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(startedMs) ? Math.round(((startedMs - pickedMs) + ms) / 100) / 10 : null)
  ;(deps.log ?? console.log)(`[ichirei-preview] ${JSON.stringify({
    event: 'preview_render',
    render_secs: Math.round((Date.now() - t0) / 100) / 10,
    secs_from_pick_to_render: Number.isFinite(startedMs) ? Math.round((startedMs - pickedMs) / 100) / 10 : null,
    picture_secs_from_pick: final?.slots.map((s, i) => (s === 'ai' ? secs(final.ready_ms?.[i]) : null)) ?? null,
    finished: art !== null,
    status: final?.status ?? 'rendering',
    pictures: final ? final.slots.filter((s) => s === 'ai').length : null,
    washi: final ? final.slots.filter((s) => s === 'washi').length : null,
  })}`)
  return viewOf(rec, final)
}

/**
 * At order time: the draft the buyer saw becomes the order's film. It is adopted only if it is a draft, it is for this very story and language, its script is
 * a real one, and none of its lines contains the chosen character. Returns the adopted animation record, or null (the order then makes its film as usual).
 */
export async function adoptDraft(store: OrderStore, draftId: string, record: OrderRecord, built: AnimationRecord, expect: { story: string; language: Language; memorial: boolean }): Promise<AnimationRecord | null> {
  const old = await read(store, draftId)
  if (!isDraft(old)) return null
  if (old.draft.story_hash !== storyHash(expect.story, expect.language, expect.memorial) || old.language !== expect.language) return null
  const film = old.film
  if (!film || film.status !== 'ready' || film.lines.length !== 4) return null
  const p = record.production
  // the chosen character must not be in the film's lines (a character shown only after the draft was made could be)
  const forms = [p.kanji, p.glyph_to_carve].filter(Boolean)
  if (film.lines.some((l) => forms.some((f) => l.includes(f)))) return null
  if (checkPictures(film.pictures, { glyph: p.glyph_to_carve, forms, names: [p.sender_name, p.receiver_name], memorial: expect.memorial, occasion: record.engine_result.occasion ?? null, language: expect.language, story: expect.story }).length > 0) return null
  // a preview that ended with washi slots: the first open after payment gives each of them one more full attempt (the other pictures stay)
  const adopted: AnimationRecord = { ...built, id: old.id, created_at: old.created_at, film, draft: null, retry_washi: true }
  return adopted
}

