// Which piece plays under a film, and how it is fitted to the film (2026-11-08). Six public-domain recordings (Musopen, Wikimedia Commons), one per purpose of the gift; the order's
// PURPOSE decides — no model call. The piece is ALIGNED TO THE END of the film: its real last phrase and final chord play under the e-card, and the film finishes where the piece finishes.
// Pure; the page (an <audio> element), the saved film and the share film all use this.

import { purposeFromOccasion } from './purpose.ts'

export const TRACKS = ['celebrate', 'thanks', 'apology', 'encourage', 'confess', 'memorial'] as const
export type Track = (typeof TRACKS)[number]

/** The recordings (assets/music/ for the server). The page plays a levelled mp3 excerpt of the same piece (public/music/<track>.mp3: Safari does not play .ogg). */
export const MUSIC_FILE: Record<Track, string> = { celebrate: 'celebrate.ogg', thanks: 'thanks.ogg', apology: 'apology.ogg', encourage: 'encourage.ogg', confess: 'confess.ogg', memorial: 'memorial.ogg' }

/** Every purpose code of the site and the piece it gets. */
export const TRACK_OF_PURPOSE: Record<string, Track> = {
  celebrate: 'celebrate',
  thanks: 'thanks',
  reconnect: 'thanks',
  other: 'thanks',
  apology: 'apology',
  encourage: 'encourage',
  farewell: 'encourage',
  confess: 'confess',
  memorial: 'memorial',
}

/**
 * The piece for a gift. Remembrance (the flag, the purpose, or the state `lost`) always gets the memorial piece; an order without a purpose takes the one its old occasion stands for, else `thanks`;
 * an unknown purpose is `thanks`.
 */
export function trackFor(f: { purpose?: string | null; state?: string | null; memorial?: boolean; occasion?: string | null }): Track {
  if (f.memorial === true || f.state === 'lost' || f.purpose === 'memorial') return 'memorial'
  const purpose = f.purpose ?? purposeFromOccasion(f.occasion ?? null)
  return (purpose && TRACK_OF_PURPOSE[purpose]) || 'thanks'
}

/** We enter the piece in the middle of a phrase, so it fades in over 2 s; it is NOT faded out — the last chord rings — except the very last 0.5 s, against a click. */
export const FADE_IN_S = 2
export const FADE_OUT_S = 0.5
/** A piece must run this much longer than the film (after its silent tail is trimmed), or the film uses `thanks`. */
export const MIN_SPARE_S = 2
/** Silence after the last chord longer than this is trimmed before the piece is aligned to the end of the film. */
export const MAX_TAIL_SILENCE_S = 1.5
/** The mp3 excerpt the page plays: the last 45 s of the trimmed, levelled piece (the longest film is 41 s). */
export const PAGE_EXCERPT_S = 45
/** Every piece is levelled to about this loudness, and a limiter keeps a loud peak from clipping. */
export const TARGET_LUFS = -18
export const LIMITER = 'alimiter=limit=0.84:attack=5:release=60:level=disabled'

/** Where in the piece the film starts: the piece's (trimmed) length minus the film's. */
export const startOf = (trimmed: number, film: number): number => Math.round((trimmed - film) * 1000) / 1000

/** Volume (0 → 1) of the music at second `t` of a film of `total` seconds. */
export function musicGain(t: number, total: number): number {
  const up = Math.min(1, Math.max(0, t / FADE_IN_S))
  const down = Math.min(1, Math.max(0, (total - t) / FADE_OUT_S))
  return up * down
}

/** The sound button's words (ja / zh-Hant / en; zh-Hans is shown in 繁體, as the rest of the film page). */
export const SOUND_LABEL = {
  ja: { on: '音を出す', off: '音を消す' },
  'zh-Hant': { on: '開啟聲音', off: '關閉聲音' },
  en: { on: 'Sound on', off: 'Sound off' },
} as const
