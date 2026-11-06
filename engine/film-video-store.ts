// The film as a video file for the gift's keepsakes (Part 5): made ONCE per order after the pictures are final, kept in the private bucket next to the pictures
// (films/<id>/film.mp4 and films/<id>/film.json), and made again only if the character changed in the 24-hour window or the pictures were drawn again.
// Nothing is made while the film is still being drawn, or has a picture that could not be drawn yet.

import { filmUsable, type AnimationRecord } from './animation.ts'
import type { ArtRecord } from './film-art.ts'
import type { GiftRecord } from './gift.ts'
import type { OrderStore } from './order-store.ts'
import { loadArtwork } from './render/artwork.ts'
import { makeFilmVideo } from './render/film-video.ts'
import { makeShareFilm, type ShareArtwork } from './render/share.ts'

/** Bump to make every film video again (a change in how the video looks). */
export const FILM_VIDEO_REV = '1'
export const filmVideoPath = (id: string): string => `films/${id}/film.mp4`
export const filmVideoMetaPath = (id: string): string => `films/${id}/film.json`

export interface FilmVideoMeta {
  rev: string
  glyph: string
  art_made_at: string | null
  seconds: number
  bytes: number
  render_ms: number
  made_at: string
}

/** The film is complete: its script is written and every picture is final (a drawn picture or the final washi — a washi slot is allowed). */
export const filmComplete = (anim: AnimationRecord, art: ArtRecord | null): boolean =>
  filmUsable(anim.film) && anim.film.status === 'ready' && !!art && art.status === 'done' && art.slots.length === anim.film.lines.length && art.slots.every((s) => s === 'ai' || s === 'washi')

export async function readFilmVideoMeta(store: OrderStore, id: string): Promise<FilmVideoMeta | null> {
  try {
    const b = await store.getObject(filmVideoMetaPath(id))
    return b ? (JSON.parse(b.toString('utf8')) as FilmVideoMeta) : null
  } catch {
    return null
  }
}

const upToDate = (m: FilmVideoMeta | null, gift: GiftRecord, art: ArtRecord): boolean => !!m && m.rev === FILM_VIDEO_REV && m.glyph === gift.glyph && m.art_made_at === (art.made_at ?? null)

const inflight = new Map<string, Promise<FilmVideoMeta>>()
const MAX_AT_ONCE = Number(process.env.ICHIREI_FILM_VIDEO_PARALLEL ?? 2)

export type EnsureResult = { state: 'ready'; meta: FilmVideoMeta } | { state: 'busy' } | { state: 'not_ready' }

/** The film video of this order: kept if it is current, otherwise made now (one render at a time per film; a few at once per server). */
export async function ensureFilmVideo(d: { store: OrderStore; env?: NodeJS.ProcessEnv; now?: () => Date; render?: typeof makeFilmVideo }, gift: GiftRecord, anim: AnimationRecord, art: ArtRecord | null): Promise<EnsureResult> {
  if (!filmComplete(anim, art) || !art) return { state: 'not_ready' }
  const cur = await readFilmVideoMeta(d.store, anim.id)
  if (upToDate(cur, gift, art) && (await d.store.getObject(filmVideoPath(anim.id)))) return { state: 'ready', meta: cur! }
  const running = inflight.get(anim.id)
  if (running) return { state: 'ready', meta: await running }
  if (inflight.size >= MAX_AT_ONCE) return { state: 'busy' }
  const job = (async () => {
    const work = await loadArtwork(d.store, gift, anim, art, d.env)
    const v = await (d.render ?? makeFilmVideo)(work)
    const meta: FilmVideoMeta = { rev: FILM_VIDEO_REV, glyph: gift.glyph, art_made_at: art.made_at ?? null, seconds: v.seconds, bytes: v.mp4.length, render_ms: v.renderMs, made_at: (d.now?.() ?? new Date()).toISOString() }
    await d.store.putObject(filmVideoPath(anim.id), v.mp4, 'video/mp4')
    await d.store.putObject(filmVideoMetaPath(anim.id), JSON.stringify(meta), 'application/json')
    console.log(`[ichirei-film-video] ${JSON.stringify({ event: 'rendered', seconds: v.seconds, frames: v.frames, render_ms: v.renderMs, bytes: v.mp4.length })}`)
    return meta
  })()
  inflight.set(anim.id, job)
  try {
    return { state: 'ready', meta: await job }
  } finally {
    inflight.delete(anim.id)
  }
}

/** A byte range of a file (iPhone Safari asks for the video in ranges), or the whole file. */
export function serveBytes(bytes: Buffer, contentType: string, rangeHeader: string | null, extra: Record<string, string> = {}): Response {
  const m = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/)
  const headers = { 'content-type': contentType, 'accept-ranges': 'bytes', ...extra }
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? Math.max(0, bytes.length - Number(m[2])) : Number(m[1])
    let end = m[1] === '' || m[2] === '' ? bytes.length - 1 : Math.min(Number(m[2]), bytes.length - 1)
    if (start >= bytes.length || start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${bytes.length}` } })
    end = Math.min(end, bytes.length - 1)
    start = Math.max(0, start)
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': String(end - start + 1) } })
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, 'content-length': String(bytes.length) } })
}

// ---- the share film (2026-11-06): the film the buyer and the receiver post to their own social accounts — pictures, character, poem and one relationship line, nothing else ----

/** Bump to make every share film again. */
export const SHARE_FILM_REV = '1'
export const shareFilmPath = (id: string): string => `films/${id}/share.mp4`
export const shareFilmMetaPath = (id: string): string => `films/${id}/share.json`

export interface ShareFilmMeta {
  rev: string
  glyph: string
  art_made_at: string | null
  relation: string | null
  seconds: number
  bytes: number
  render_ms: number
  made_at: string
}

export type EnsureShareResult = { state: 'ready'; meta: ShareFilmMeta } | { state: 'busy' } | { state: 'not_ready' }

const shareInflight = new Map<string, Promise<ShareFilmMeta>>()

/** The share film of this order: kept if current, otherwise made now (after the pictures are final; no model is called). `work` builds the artwork (pictures, poem, relation line). */
export async function ensureShareFilm(
  d: { store: OrderStore; now?: () => Date; render?: typeof makeShareFilm },
  gift: GiftRecord,
  anim: AnimationRecord,
  art: ArtRecord | null,
  work: () => Promise<ShareArtwork>,
  relation: string | null,
): Promise<EnsureShareResult> {
  if (!filmComplete(anim, art) || !art) return { state: 'not_ready' }
  let cur: ShareFilmMeta | null = null
  try {
    const b = await d.store.getObject(shareFilmMetaPath(anim.id))
    cur = b ? (JSON.parse(b.toString('utf8')) as ShareFilmMeta) : null
  } catch {
    cur = null
  }
  const fresh = !!cur && cur.rev === SHARE_FILM_REV && cur.glyph === gift.glyph && cur.art_made_at === (art.made_at ?? null) && cur.relation === relation
  if (fresh && (await d.store.getObject(shareFilmPath(anim.id)))) return { state: 'ready', meta: cur as ShareFilmMeta }
  const running = shareInflight.get(anim.id)
  if (running) return { state: 'ready', meta: await running }
  if (shareInflight.size >= MAX_AT_ONCE) return { state: 'busy' }
  const job = (async () => {
    const v = await (d.render ?? makeShareFilm)(await work())
    const meta: ShareFilmMeta = { rev: SHARE_FILM_REV, glyph: gift.glyph, art_made_at: art.made_at ?? null, relation, seconds: v.seconds, bytes: v.mp4.length, render_ms: v.renderMs, made_at: (d.now?.() ?? new Date()).toISOString() }
    await d.store.putObject(shareFilmPath(anim.id), v.mp4, 'video/mp4')
    await d.store.putObject(shareFilmMetaPath(anim.id), JSON.stringify(meta), 'application/json')
    console.log(`[ichirei-share-film] ${JSON.stringify({ event: 'rendered', seconds: v.seconds, frames: v.frames, render_ms: v.renderMs, bytes: v.mp4.length })}`)
    return meta
  })()
  shareInflight.set(anim.id, job)
  try {
    return { state: 'ready', meta: await job }
  } finally {
    shareInflight.delete(anim.id)
  }
}
