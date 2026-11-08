// The music under the saved film and the share film (2026-11-08): six public-domain recordings in assets/music/ (see LICENSES.md), one per purpose. Each file is the LAST 60 s of the recording after its
// silent tail is trimmed (an excerpt; the full recordings stay on Wikimedia Commons); `assets/music/music.json` (made by scripts/prepare-music.ts) holds the excerpt's length and the level parameters.
// The whole excerpt is levelled (gain, gentle upward compression, gain, a lift of the ending so it can be heard on a phone speaker, limiter: src/order/film-music.ts levelChain), then the mix ALIGNS THE END of
// the piece to the END of the film: it starts at (excerpt length − film length) seconds, so the piece's real last phrase and final chord play under the e-card and the film finishes where the piece finishes.
// Fade in over 2 s; no fade-out of the music itself, only the very last 0.5 s (against a click). Stereo AAC 128 kbps. A missing file never stops a film (it is made silent).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FADE_IN_S, FADE_OUT_S, MIN_SPARE_S, MUSIC_FILE, levelChain, startOf, trackFor, type Track } from '../../src/order/film-music.ts'

export { trackFor }
export type { Track }

export function musicDir(env: NodeJS.ProcessEnv = process.env): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [env.ICHIREI_MUSIC_DIR?.trim(), join(here, '..', '..', 'assets', 'music'), join(process.cwd(), 'assets', 'music')].filter((x): x is string => !!x)
  return candidates.find((d) => existsSync(join(d, 'music.json'))) ?? candidates[0]
}

export interface TrackMeta {
  file: string
  /** the length of the full recording and of its trimmed version (the excerpt is the last `excerpt_s` of the latter) */
  source_duration: number
  source_trimmed: number
  tail_silence_s: number
  /** the length of the stored excerpt; it ends where the trimmed recording ends */
  excerpt_s: number
  /** = excerpt_s: the length the mix counts back from */
  trimmed: number
  raw_window_lufs: number
  g1_db: number
  g2_db: number
  lift_db: number
  /** the loudness of the last 41 s of the processed excerpt */
  film_lufs: number
  /** per film length (s): how many dB the 6 s before the final fade are under the music as a whole */
  ending_gap_db: Record<string, number>
  page_excerpt_s: number
}

const cache = new Map<string, Record<string, TrackMeta>>()
/** What scripts/prepare-music.ts measured; a piece that has no recording yet is simply not in it. */
export function musicTable(env: NodeJS.ProcessEnv = process.env): Record<string, TrackMeta> {
  const dir = musicDir(env)
  let t = cache.get(dir)
  if (!t) {
    try {
      t = (JSON.parse(readFileSync(join(dir, 'music.json'), 'utf8')) as { tracks: Record<string, TrackMeta> }).tracks
    } catch {
      t = {}
    }
    cache.set(dir, t)
  }
  return t
}

export const musicPath = (track: Track, env: NodeJS.ProcessEnv = process.env): string => join(musicDir(env), MUSIC_FILE[track])

/** The piece a film of `seconds` really gets: the purpose's own, or `thanks` when that recording is not there yet or (trimmed) is shorter than the film + 2 s. null = no music at all. */
export function chooseTrack(f: { purpose?: string | null; state?: string | null; memorial?: boolean; occasion?: string | null }, seconds: number, env: NodeJS.ProcessEnv = process.env): Track | null {
  const table = musicTable(env)
  const fits = (t: Track): boolean => !!table[t] && existsSync(musicPath(t, env)) && table[t].trimmed >= seconds + MIN_SPARE_S
  const want = trackFor(f)
  if (fits(want)) return want
  return fits('thanks') ? 'thanks' : null
}

export interface AudioPlan {
  /** ffmpeg input arguments (after the video input) */
  inputs: string[]
  /** stream mapping and the audio filter */
  maps: string[]
  /** audio codec arguments */
  codec: string[]
  track: Track
  /** where in the recording the film starts (seconds): trimmed length − film length */
  start: number
  trimmed: number
}

/** The ffmpeg pieces that put `track` under a film of `seconds`; null = no file (silent). The audio is exactly as long as the picture. */
export function audioPlan(track: Track | null, seconds: number, env: NodeJS.ProcessEnv = process.env): AudioPlan | null {
  if (!track) {
    console.error('[ichirei-film] no music is available; the film is made without sound')
    return null
  }
  const meta = musicTable(env)[track]
  const file = musicPath(track, env)
  if (!meta || !existsSync(file)) {
    console.error(`[ichirei-film] music file missing (${track}); the film is made without sound`)
    return null
  }
  const T = Math.round(seconds * 1000) / 1000
  const start = Math.max(0, startOf(meta.trimmed, T))
  const fin = Math.min(FADE_IN_S, T / 2)
  const fout = Math.min(FADE_OUT_S, T / 2)
  const filter =
    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,${levelChain({ g1_db: meta.g1_db, g2_db: meta.g2_db, lift_db: meta.lift_db, excerpt_s: meta.trimmed })},atrim=start=${start}:duration=${T},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=${fin},afade=t=out:st=${Math.max(0, Math.round((T - fout) * 1000) / 1000)}:d=${fout},apad=whole_dur=${T},atrim=0:${T}[a]`
  return { inputs: ['-i', file], maps: ['-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-t', String(T)], codec: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2'], track, start, trimmed: meta.trimmed }
}
