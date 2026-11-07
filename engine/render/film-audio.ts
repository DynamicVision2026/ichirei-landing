// The music under the saved film and the share film (2026-11-07). Two tracks in assets/music/ — `warm` (soft, slow, a little brighter: thanks, birthdays, Kanreki and the other
// celebrations) and `quiet` (sparse, slower, lower: remembrance and every quiet purpose) — both already levelled to about −18 LUFS when they were made (scripts/make-music.mjs). The
// mix only trims the track to the film's length and fades it: in over 1.5 s, out with the picture over the last 2 s. Stereo AAC 128 kbps. A missing file never stops a film (it is made silent).

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FADE_IN_S, FADE_OUT_S, moodOf, MUSIC_FILE, type Mood } from '../../src/order/film-music.ts'

export { moodOf }
export type { Mood }

export function musicDir(env: NodeJS.ProcessEnv = process.env): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [env.ICHIREI_MUSIC_DIR?.trim(), join(here, '..', '..', 'assets', 'music'), join(process.cwd(), 'assets', 'music')].filter((x): x is string => !!x)
  return candidates.find((d) => existsSync(join(d, MUSIC_FILE.warm))) ?? candidates[0]
}

export const musicPath = (mood: Mood, env: NodeJS.ProcessEnv = process.env): string => join(musicDir(env), MUSIC_FILE[mood])

export interface AudioPlan {
  /** ffmpeg input arguments (after the video input) */
  inputs: string[]
  /** stream mapping and the audio filter */
  maps: string[]
  /** audio codec arguments */
  codec: string[]
  mood: Mood
}

/** The ffmpeg pieces that put the music under a film of `seconds`; null = no file (silent). The audio is exactly as long as the picture (padded with silence if a track were shorter). */
export function audioPlan(mood: Mood, seconds: number, env: NodeJS.ProcessEnv = process.env): AudioPlan | null {
  const file = musicPath(mood, env)
  if (!existsSync(file)) {
    console.error(`[ichirei-film] music file missing (${mood}); the film is made without sound`)
    return null
  }
  const T = Math.round(seconds * 1000) / 1000
  const fin = Math.min(FADE_IN_S, T / 2)
  const fout = Math.min(FADE_OUT_S, T / 2)
  const filter = `[1:a]atrim=0:${T},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=${fin},afade=t=out:st=${Math.max(0, T - fout)}:d=${fout},apad=whole_dur=${T},atrim=0:${T}[a]`
  return { inputs: ['-i', file], maps: ['-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-t', String(T)], codec: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2'], mood }
}
