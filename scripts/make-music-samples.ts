// Listening samples for the owner (2026-11-08): one saved film per music recording — ja, a tanka, washi placeholder pictures — with its music, plus where each piece starts and the loudness of the result.
// The memorial film is the 41 s remembrance film; the others are the normal 34 s film. For each: where the piece starts, the loudness of the whole film audio and of its last 6 s before the final 0.5 s (and the gap).
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/make-music-samples.ts ./shots/music-samples

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { makeFilmVideo } from '../engine/render/film-video.ts'
import { musicPath, musicTable } from '../engine/render/film-audio.ts'
import { TRACKS } from '../src/order/film-music.ts'

const out = process.argv[2] ?? './shots/music-samples'
mkdirSync(out, { recursive: true })
const washi = await Promise.all([1, 2, 3, 4].map((i) => sharp(readFileSync(`public/film/washi-${((i - 1) % 2) + 1}.webp`)).resize(1080, 1350, { fit: 'cover' }).modulate({ brightness: 0.9 + i * 0.03 }).jpeg().toBuffer()))
const BASE = { language: 'ja', glyph: '備', reading: 'そなえる', who: 'ことばより先に、手を動かしていた人。', certificateLine: '', pictures: washi, from: '', to: '', message: '', qrUrl: '', lines: ['毎朝、母は弁当を包んでいた。', '蓋の上には、庭の小さな花。', '何も言わずに、ただ笑っていた。', 'いまも、あの蓋の花を思い出す。'], poemType: 'tanka', poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'] } as const
const table = musicTable()
const report: Record<string, unknown> = {}
for (const t of TRACKS) {
  if (!existsSync(musicPath(t))) {
    console.log(`${t}: no recording yet — no sample`)
    continue
  }
  const quiet = t === 'memorial' || t === 'apology' || t === 'encourage'
  const v = await makeFilmVideo({ ...BASE, purpose: t, memorial: t === 'memorial', quiet } as never)
  const file = `${out}/music-${t}.mp4`
  writeFileSync(file, v.mp4)
  const rep = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -vn -af ebur128=peak=true -f null - 2>&1 | grep -E "^\\s+(I:|Peak:)" | tr -s ' ' | tr '\\n' ' '`]).toString().trim()
  const lf = (from: number, d: number): number => Number(/I:\s+(-?[\d.]+) LUFS/.exec(execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -ss ${from} -t ${d} -i "${file}" -vn -af ebur128 -f null - 2>&1 | grep -E "^\\s+I:" | tail -1`]).toString())?.[1])
  const whole = lf(0, v.seconds)
  const last6 = lf(v.seconds - 6.5, 6)
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv=p=0', file]).toString().trim().replace(/\n/g, ' ')
  report[t] = { film_seconds: v.seconds, start_in_recording_s: v.musicStart, trimmed_length_s: table[t].trimmed, whole_film_lufs: whole, last6s_before_final_fade_lufs: last6, gap_db: Math.round((whole - last6) * 10) / 10, recording_ends_at_film_end: Math.abs((v.musicStart ?? 0) + v.seconds - table[t].trimmed) < 0.05, loudness: rep, streams: dur, render_ms: v.renderMs }
  console.log(t, JSON.stringify(report[t]))
}
writeFileSync(`${out}/music-report.json`, JSON.stringify(report, null, 2))
