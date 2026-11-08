// Measures the recordings in assets/music/ and makes what the film needs from them (2026-11-08). The recordings themselves are never changed. For each piece:
//   · its length after the silent tail is trimmed (silence after the last chord longer than 1.5 s is cut; 0.3 s of it is kept so the decay is not clipped)
//   · its loudness over the last 41 s (the part a film can use), and the gain that brings that to −18 LUFS
//   · public/music/<track>.mp3: the last 45 s of the trimmed piece, with that gain and the limiter, as an mp3 — the page plays this (Safari does not play .ogg)
// and writes assets/music/music.json, which the server reads (engine/render/film-audio.ts). Run it again whenever a recording is added or replaced.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/prepare-music.ts

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIMITER, MAX_TAIL_SILENCE_S, MUSIC_FILE, PAGE_EXCERPT_S, TARGET_LUFS, TRACKS } from '../src/order/film-music.ts'

const dir = join(process.cwd(), 'assets', 'music')
const pub = join(process.cwd(), 'public', 'music')
mkdirSync(pub, { recursive: true })
const ff = (args: string[]): string => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? '')
  }
}
const sh = (cmd: string): string => execFileSync('sh', ['-c', cmd], { encoding: 'utf8' })

const tracks: Record<string, unknown> = {}
for (const t of TRACKS) {
  const file = join(dir, MUSIC_FILE[t])
  if (!existsSync(file)) {
    console.log(`${t}: no recording yet (${MUSIC_FILE[t]}) — films for this purpose use thanks`)
    continue
  }
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim())
  // the silent tail: the last silence that runs to the end of the file
  const log = sh(`ffmpeg -hide_banner -nostats -i "${file}" -af silencedetect=n=-50dB:d=0.5 -f null - 2>&1 | grep silence_ || true`)
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  const lastStart = starts.at(-1)
  const lastEnd = ends.at(-1) ?? duration
  let trimmed = Math.floor(duration * 1000) / 1000
  if (lastStart !== undefined && lastEnd >= duration - 0.1 && duration - lastStart > MAX_TAIL_SILENCE_S) trimmed = Math.round((lastStart + 0.3) * 1000) / 1000
  // loudness of the part a film can use (the last 41 s of the trimmed piece)
  const from = Math.max(0, trimmed - 41)
  const rep = sh(`ffmpeg -hide_banner -nostats -ss ${from} -t ${trimmed - from} -i "${file}" -af ebur128 -f null - 2>&1 | grep -E "^\\s+I:" | tail -1`)
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(rep)?.[1])
  const gainDb = Math.round((TARGET_LUFS - lufs) * 100) / 100
  // the page's excerpt
  const exStart = Math.max(0, trimmed - PAGE_EXCERPT_S)
  const out = join(pub, `${t}.mp3`)
  ff(['-y', '-loglevel', 'error', '-ss', String(exStart), '-t', String(trimmed - exStart), '-i', file, '-af', `volume=${gainDb}dB,${LIMITER}`, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '160k', out])
  tracks[t] = { file: MUSIC_FILE[t], duration: Math.round(duration * 1000) / 1000, trimmed, tail_silence_s: Math.round((duration - trimmed) * 100) / 100, window_lufs: lufs, gain_db: gainDb, page_excerpt_s: Math.round((trimmed - exStart) * 1000) / 1000 }
  console.log(t, JSON.stringify(tracks[t]))
}
writeFileSync(join(dir, 'music.json'), JSON.stringify({ target_lufs: TARGET_LUFS, tracks }, null, 2) + '\n')
