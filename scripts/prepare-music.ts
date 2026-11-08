// Prepares the recordings in assets/music/ for the film (2026-11-08, follow-up). For each piece it:
//   1. trims the silent tail (silence after the last chord longer than 1.5 s is cut; 0.3 s of it is kept so the decay is not clipped) and KEEPS ONLY THE LAST 60 s of the trimmed recording in assets/music/<track>.ogg
//      (stream copy, no re-encoding) — only the end of a piece is ever used; the full recording stays on the Commons page named in LICENSES.md
//   2. levels it to −18 LUFS with gentle upward compression and a lift of the ending (src/order/film-music.ts: levelChain), found as the smallest lift that makes the 6 s before the final 0.5 s fade
//      at most 7 dB (the rule is 8) under the loudness of the music of the film as a whole, for the 34 s, 41 s and 32.6 s films
//   3. makes public/music/<track>.mp3: the last 45 s of the processed excerpt (the page plays this; Safari does not play .ogg)
// and writes assets/music/music.json, which the server reads (engine/render/film-audio.ts). A recording that is already an excerpt (60 s or less) is left as it is. Run it again whenever a recording is added.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/prepare-music.ts [--from <folder with full recordings named <track>.ogg>]

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENDING_CHECK_S, EXCERPT_STORE_S, GAP_AIM_DB, GAP_RULE_DB, LIMITER, MAX_TAIL_SILENCE_S, MUSIC_FILE, PAGE_EXCERPT_S, TARGET_LUFS, TRACKS, levelChain, type LevelParams } from '../src/order/film-music.ts'

const dir = join(process.cwd(), 'assets', 'music')
const pub = join(process.cwd(), 'public', 'music')
const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null
mkdirSync(pub, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'ichirei-music-'))
const FILMS = [34, 41, 32.6]

const sh = (cmd: string): string => execFileSync('sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 1 << 28 })
const ffmpeg = (args: string[]): void => void execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] })
const probeDuration = (f: string): number => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())
const lufs = (f: string, start: number, dur: number): number => Number(/I:\s+(-?[\d.]+) LUFS/.exec(sh(`ffmpeg -hide_banner -nostats -ss ${start} -t ${dur} -i "${f}" -af ebur128 -f null - 2>&1 | grep -E "^\\s+I:" | tail -1`))?.[1])
const r3 = (x: number): number => Math.round(x * 1000) / 1000

const old = existsSync(join(dir, 'music.json')) ? (JSON.parse(readFileSync(join(dir, 'music.json'), 'utf8')) as { tracks: Record<string, Record<string, number | string>> }).tracks : {}
const tracks: Record<string, unknown> = {}

for (const t of TRACKS) {
  const target = join(dir, MUSIC_FILE[t])
  const src = from && existsSync(join(from, MUSIC_FILE[t])) ? join(from, MUSIC_FILE[t]) : target
  if (!existsSync(src)) {
    console.log(`${t}: no recording yet (${MUSIC_FILE[t]}) — films for this purpose use thanks`)
    continue
  }
  const srcDuration = probeDuration(src)
  let sourceTrimmed: number
  let sourceDuration: number
  let tail = 0
  if (srcDuration > EXCERPT_STORE_S + 0.5) {
    // a full recording: trim the silent tail, keep the last 60 s
    const log = sh(`ffmpeg -hide_banner -nostats -i "${src}" -af silencedetect=n=-50dB:d=0.5 -f null - 2>&1 | grep silence_ || true`)
    const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
    const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
    const lastStart = starts.at(-1)
    const lastEnd = ends.at(-1) ?? srcDuration
    sourceTrimmed = Math.floor(srcDuration * 1000) / 1000
    if (lastStart !== undefined && lastEnd >= srcDuration - 0.1 && srcDuration - lastStart > MAX_TAIL_SILENCE_S) sourceTrimmed = r3(lastStart + 0.3)
    sourceDuration = r3(srcDuration)
    tail = srcDuration - sourceTrimmed < 0.05 ? 0 : r3(srcDuration - sourceTrimmed)
    const part = join(tmp, `${t}.ogg`)
    ffmpeg(['-ss', String(r3(sourceTrimmed - EXCERPT_STORE_S)), '-t', String(EXCERPT_STORE_S), '-i', src, '-c', 'copy', part])
    copyFileSync(part, target + '.new')
    renameSync(target + '.new', target)
  } else {
    // already an excerpt: what was recorded about the full recording stays
    const o = old[t] ?? {}
    sourceTrimmed = Number(o.source_trimmed ?? srcDuration)
    sourceDuration = Number(o.source_duration ?? srcDuration)
    tail = Number(o.tail_silence_s ?? 0)
  }
  const D = r3(probeDuration(target))
  const wav = join(tmp, `${t}.wav`)
  ffmpeg(['-i', target, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', wav])
  const win = Math.min(41, D)
  const rawLufs = lufs(wav, D - win, win)
  const g1 = Math.round((TARGET_LUFS - rawLufs) * 100) / 100
  // find the smallest lift (whole dB) that brings the ending within GAP_AIM_DB of the film's music, for the 34 / 41 / 32.6 s films
  const gaps = (file: string): number[] => FILMS.map((F) => lufs(file, D - F, F) - lufs(file, D - ENDING_CHECK_S - 0.5, ENDING_CHECK_S))
  let lift = 0
  let g2 = 0
  let worst = Infinity
  for (; lift <= 36; lift++) {
    const probe = join(tmp, `${t}.probe.wav`)
    const base: LevelParams = { g1_db: g1, g2_db: 0, lift_db: lift, excerpt_s: D }
    ffmpeg(['-i', wav, '-af', levelChain(base).replace(`,${LIMITER}`, ''), '-c:a', 'pcm_f32le', probe])
    worst = Math.max(...gaps(probe))
    if (worst <= GAP_AIM_DB) {
      g2 = Math.round((TARGET_LUFS - lufs(probe, D - win, win)) * 100) / 100
      break
    }
  }
  const params: LevelParams = { g1_db: g1, g2_db: g2, lift_db: lift, excerpt_s: D }
  // verify on the finished chain (with the limiter)
  const fin = join(tmp, `${t}.final.wav`)
  ffmpeg(['-i', wav, '-af', levelChain(params), '-c:a', 'pcm_f32le', fin])
  const finalGaps = gaps(fin)
  const finalWhole = lufs(fin, D - win, win)
  if (Math.max(...finalGaps) > GAP_RULE_DB) console.error(`${t}: WARNING the ending is still ${Math.max(...finalGaps).toFixed(1)} dB under the rest (rule ${GAP_RULE_DB})`)
  // the page's mp3: the last 45 s of the processed excerpt
  const pageLen = Math.min(PAGE_EXCERPT_S, D)
  ffmpeg(['-i', wav, '-af', `${levelChain(params)},atrim=start=${r3(D - pageLen)},asetpts=PTS-STARTPTS`, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '160k', join(pub, `${t}.mp3`)])
  tracks[t] = {
    file: MUSIC_FILE[t],
    source_duration: sourceDuration,
    source_trimmed: sourceTrimmed,
    tail_silence_s: tail,
    excerpt_s: D,
    /** the length the mix counts back from: the stored excerpt ends where the trimmed recording ends */
    trimmed: D,
    raw_window_lufs: rawLufs,
    g1_db: g1,
    g2_db: g2,
    lift_db: lift,
    film_lufs: Math.round(finalWhole * 10) / 10,
    ending_gap_db: Object.fromEntries(FILMS.map((F, i) => [String(F), Math.round(finalGaps[i] * 10) / 10])),
    page_excerpt_s: pageLen,
  }
  console.log(t, JSON.stringify(tracks[t]))
}
writeFileSync(join(dir, 'music.json'), JSON.stringify({ target_lufs: TARGET_LUFS, gap_rule_db: GAP_RULE_DB, tracks }, null, 2) + '\n')
rmSync(tmp, { recursive: true, force: true })
