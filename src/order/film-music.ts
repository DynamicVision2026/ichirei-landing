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
export const LIMITER = 'alimiter=limit=0.71:attack=5:release=60:level=disabled'
/** Only the end of a piece is ever used, so the repo keeps just the last 60 s of each trimmed recording (the 41 s film + the 2 s fade-in + margin). */
export const EXCERPT_STORE_S = 60

// ---- the ending must be HEARD ----------------------------------------------------------------------------------------------------------------------------------------------------
// The recordings die away: the last seconds are 20–30 dB under the rest, which on a phone speaker is silence just when the card arrives. So the excerpt is (1) gently compressed upward — quiet passages
// are lifted — and (2) given a lift of its last seconds, as an engineer would ride the fader up during the decay. The lift is found per piece (scripts/prepare-music.ts) as the smallest one that makes
// the 6 s before the final 0.5 s fade at most GAP_RULE_DB under the loudness of the film's music as a whole; the final chord still rings and decays, audibly.
export const GAP_RULE_DB = 8
/** What prepare-music aims for (a margin under the rule). */
export const GAP_AIM_DB = 7
/** The stretch before the final fade that is checked: [end − 6.5 s, end − 0.5 s]. */
export const ENDING_CHECK_S = 6
/** The lift grows (smoothly) over this many seconds before the end of the excerpt. */
export const LIFT_RAMP_S = 14
/** A static upward-compression curve (dB in → dB out): quiet passages come up, loud ones stay. */
export const COMPAND = 'compand=attacks=0.8:decays=3:points=-90/-90|-75/-52|-60/-40|-50/-32|-40/-25|-30/-19|-20/-14|-10/-8|0/-3:soft-knee=8'

export interface LevelParams {
  /** gain before the compressor (dB) */
  g1_db: number
  /** gain after the lift (dB), to bring the film's stretch to −18 LUFS */
  g2_db: number
  /** how much louder the very end is made (dB) */
  lift_db: number
  /** length of the stored excerpt (s): the lift is counted back from its end */
  excerpt_s: number
}

/**
 * The whole processing of a stored excerpt, as an ffmpeg filter chain: gain → upward compression → gain → the ending's lift → limiter. Run over the WHOLE excerpt (the film takes the last part of it
 * afterwards), so the page's mp3 and the MP4's audio come out the same.
 */
export function levelChain(p: LevelParams): string {
  const x = `clip(1-(${p.excerpt_s}-t)/${LIFT_RAMP_S},0,1)`
  const lift = p.lift_db > 0 ? `,volume=volume='pow(10,${p.lift_db}/20*(${x}*${x}*(3-2*${x})))':eval=frame` : ''
  return `volume=${p.g1_db}dB,${COMPAND},volume=${p.g2_db}dB${lift},${LIMITER}`
}

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
