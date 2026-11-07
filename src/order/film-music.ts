// Which music goes under a film, and how it is faded (2026-11-07). The page (an <audio> element), the saved film and the share film all use this: two tracks, chosen by the gift's
// mood — `quiet` for a remembrance and every quiet purpose (apology, encouragement), `warm` for everything else. Pure.

export type Mood = 'warm' | 'quiet'

/** The track files (assets/music/ for the server, public/music/ for the page — the same bytes). */
export const MUSIC_FILE: Record<Mood, string> = { warm: 'warm.mp3', quiet: 'quiet.mp3' }

export const moodOf = (quiet: boolean): Mood => (quiet ? 'quiet' : 'warm')

/** The music fades in over 1.5 s and out with the picture over the last 2 s. */
export const FADE_IN_S = 1.5
export const FADE_OUT_S = 2

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
