// Making and keeping the film of an order. The script is written by ONE small model call (engine/film.ts) right when the order is made, in parallel
// with the Shopify cart (there are no payment webhooks in this system, so "the moment the order is made" is the earliest honest trigger). The
// result is saved on the animation record (what the page reads) and on the order record (production.film). If it is not ready when someone opens
// /a/<id> the page waits quietly; if it is still missing after a while (a restart, a throttled instance) the view asks for it once more here.

import { toneLine } from './purpose.ts'
import { isQuietPurpose } from '../src/order/purpose.ts'
import type { AnimationRecord } from './animation.ts'
import { isAnimationRecord } from './animation.ts'
import { mergeStory } from './contract.ts'
import { makeFilm, type FilmInput, type FilmOptions, type FilmRecord } from './film.ts'
import type { OrderRecord } from './order.ts'
import type { OrderStore } from './order-store.ts'

/** The film input of an order record (what the engine saw and what the card says). */
export function filmInputFromRecord(record: OrderRecord): FilmInput {
  const p = record.production
  const result = record.engine_result
  const cand = result.candidates.find((c) => c.kanji === p.kanji)
  return {
    story: mergeStory(record.story, record.follow_ups ?? []),
    language: p.language,
    relationship: result.relationship ?? null,
    direction: result.direction ?? null,
    occasion: result.occasion ?? null,
    occasion_detail: result.occasion_detail ?? null,
    memorial: p.certificate.memorial === true,
    tone: toneLine({ purpose: (result.purpose as never) ?? null, state: (result.state as never) ?? null }),
    quiet: p.certificate.memorial === true || isQuietPurpose(result.purpose),
    glyph: p.glyph_to_carve,
    forms: [p.kanji, p.glyph_to_carve, cand?.inscription_form ?? ''].filter(Boolean),
    who: p.gaze_line,
    moment: p.story_anchor,
    names: [p.sender_name, p.receiver_name],
  }
}

/** Films being written in this process, by animation id (so a second look never starts a second call). */
const inflight = new Map<string, Promise<FilmRecord | null>>()
export const trackFilm = <T extends FilmRecord | null>(id: string, p: Promise<T>): Promise<T> => {
  inflight.set(id, p)
  const done = () => { if (inflight.get(id) === p) inflight.delete(id) }
  p.then(done, done)
  return p
}
export const filmInFlight = (id: string): Promise<FilmRecord | null> | undefined => inflight.get(id)

export const raceTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), ms)
  p.then((v) => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(null) })
})

/** Waiting time of /api/order for the film (the cart is created at the same time): ICHIREI_FILM_WAIT_MS, default 8 s. */
export const filmWaitMs = (env: NodeJS.ProcessEnv = process.env): number => (Number(env.ICHIREI_FILM_WAIT_MS) >= 0 && env.ICHIREI_FILM_WAIT_MS !== undefined && env.ICHIREI_FILM_WAIT_MS !== '' ? Number(env.ICHIREI_FILM_WAIT_MS) : 8000)

/** After this long without a film the view of /a/<id> asks for it once more (the first try may have been cut short by a restart). */
export const FILM_RETRY_AFTER_MS = 25_000

/**
 * A film missing from its record, written now: read the order, write the script, save it on both records. Used by the view of /a/<id> only when
 * no film is on its way in this process. Never throws.
 */
export async function ensureFilm(store: OrderStore, anim: AnimationRecord, opts: FilmOptions & { make?: (i: FilmInput) => Promise<FilmRecord> } = {}): Promise<AnimationRecord> {
  const running = filmInFlight(anim.id)
  if (running) {
    await raceTimeout(running, 8000)
    return reload(store, anim)
  }
  // registered at once (before anything is awaited), so a second look at the same moment finds it and makes no second call
  const job = trackFilm(
    anim.id,
    (async (): Promise<FilmRecord | null> => {
      try {
        const order = (await store.get(anim.order_ref)) as OrderRecord | null
        if (!order || !order.production) return null
        const film = await (opts.make ?? ((i: FilmInput) => makeFilm(i, opts)))(filmInputFromRecord(order))
        const fresh = await reload(store, anim)
        fresh.film = film
        await store.put(anim.id, fresh)
        order.production.film = film
        await store.put(order.order_ref, order)
        return film
      } catch (err) {
        console.error('[ichirei-film] could not make the film', err instanceof Error ? err.message : err)
        return null
      }
    })(),
  )
  await raceTimeout(job, 8000)
  return reload(store, anim)
}

async function reload(store: OrderStore, anim: AnimationRecord): Promise<AnimationRecord> {
  try {
    const r = await store.get(anim.id)
    return isAnimationRecord(r) ? r : anim
  } catch {
    return anim
  }
}
