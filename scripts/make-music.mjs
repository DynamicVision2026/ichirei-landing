// The two music tracks under the film (2026-11-07), written and rendered here — nothing is downloaded and no third-party recording is used, so there is no licence to carry,
// nothing is attributed and nothing is registered with any audio-fingerprinting service. Deterministic: the same script always writes the same files.
//
//   warm   soft felt piano with a slow string pad, 66 bpm, D major (a plain I–V–vi–IV turn, twice, then IV–V–I): thanks, birthdays, Kanreki and the other celebrations
//   quiet  a few plucked strings (koto-like, a Japanese pentatonic mode on A) over a very low drone, 48 bpm, sparse: remembrance and every quiet purpose
//
// Each is 60 s of stereo, with a soft room reverb, levelled to about −18 LUFS (ffmpeg loudnorm) and saved as MP3 (.mp3, 192 kbps — every browser plays it, Chromium without proprietary codecs included) in assets/music/ (what the server mixes under the MP4s)
// and the same bytes in public/music/ (what the film page plays). Needs ffmpeg.
//
//   node scripts/make-music.mjs

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SR = 44100
const SECONDS = 60
const N = SR * SECONDS
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

function mixer() {
  const L = new Float32Array(N), R = new Float32Array(N)
  return {
    L, R,
    add(start, samples, gain, pan) {
      const i0 = Math.max(0, Math.round(start * SR))
      const l = gain * Math.cos(((pan + 1) * Math.PI) / 4), r = gain * Math.sin(((pan + 1) * Math.PI) / 4)
      for (let i = 0; i < samples.length && i0 + i < N; i++) { L[i0 + i] += samples[i] * l; R[i0 + i] += samples[i] * r }
    },
  }
}

/** A felt piano note: a few harmonics (the upper ones weak and quick to fade), a slightly stretched series, a soft 6 ms attack. */
function piano(f, dur, vel) {
  const len = Math.round(Math.min(dur + 1.5, 7) * SR)
  const out = new Float32Array(len)
  const tau = 1.2 + 3.2 * Math.sqrt(110 / f)
  for (let h = 1; h <= 7; h++) {
    const fh = f * h * Math.sqrt(1 + 0.0004 * h * h)
    if (fh > 6000) break
    const a = Math.pow(h, -1.7) * (h === 2 ? 1.2 : 1)
    const th = tau / Math.pow(h, 0.75)
    for (let i = 0; i < len; i++) {
      const t = i / SR
      const att = Math.min(1, t / 0.006)
      out[i] += a * att * Math.exp(-t / th) * Math.sin(2 * Math.PI * fh * t)
    }
  }
  const rel = Math.round(0.4 * SR)
  for (let i = 0; i < len; i++) { const t = i / SR; if (t > dur) out[i] *= Math.max(0, 1 - (i - Math.round(dur * SR)) / rel) }
  return out.map((v) => v * vel)
}

/** A string pad: a few detuned voices, six harmonics with a gentle slope, a slow swell in and a slow release, a touch of vibrato. */
function pad(f, dur, vel, seed) {
  const r = rng(seed)
  const len = Math.round((dur + 2.5) * SR)
  const out = new Float32Array(len)
  for (const cents of [-4, 3]) {
    const ff = f * Math.pow(2, cents / 1200)
    const ph = r() * 6.28
    for (let h = 1; h <= 6; h++) {
      const a = Math.pow(h, -1.5)
      for (let i = 0; i < len; i++) {
        const t = i / SR
        const env = Math.min(1, t / 1.6) * (t > dur ? Math.max(0, 1 - (t - dur) / 2.5) : 1)
        const vib = 1 + 0.0025 * Math.sin(2 * Math.PI * 4.6 * t + ph)
        out[i] += a * env * Math.sin(2 * Math.PI * ff * h * vib * t + ph * h)
      }
    }
  }
  return out.map((v) => v * vel * 0.5)
}

/** A plucked string (koto-like): bright at the start, quick to mellow, a small upward glide in the first 60 ms. */
function pluck(f, dur, vel) {
  const len = Math.round(Math.min(dur + 2, 8) * SR)
  const out = new Float32Array(len)
  for (let h = 1; h <= 8; h++) {
    const a = Math.pow(h, -1.35)
    const th = 2.6 / Math.pow(h, 0.8)
    let ph = 0
    for (let i = 0; i < len; i++) {
      const t = i / SR
      const glide = 1 - 0.012 * Math.exp(-t / 0.03)
      ph += (2 * Math.PI * f * h * glide) / SR
      const att = Math.sin((Math.PI / 2) * Math.min(1, t / 0.012))
      out[i] += a * att * att * Math.exp(-t / th) * Math.sin(ph)
    }
  }
  return out.map((v) => v * vel * 0.55)
}

/** A simple room: four combs and two all-passes per side (different lengths left and right), mixed softly. */
function reverb(m, wet, decay) {
  const tank = (x, delays, ap) => {
    const y = new Float32Array(N)
    for (const d of delays) {
      const buf = new Float32Array(d)
      let p = 0, lp = 0
      for (let i = 0; i < N; i++) {
        const v = buf[p]
        lp = lp * 0.4 + v * 0.6
        buf[p] = x[i] + lp * decay
        p = (p + 1) % d
        y[i] += v / delays.length
      }
    }
    let z = y
    for (const d of ap) {
      const buf = new Float32Array(d)
      const o = new Float32Array(N)
      let p = 0
      for (let i = 0; i < N; i++) {
        const b = buf[p]
        const v = z[i] + b * 0.5
        buf[p] = v
        o[i] = b - 0.5 * v
        p = (p + 1) % d
      }
      z = o
    }
    return z
  }
  const wl = tank(m.L, [1687, 1801, 2053, 2251], [556, 441])
  const wr = tank(m.R, [1733, 1907, 2111, 2347], [579, 461])
  for (let i = 0; i < N; i++) { m.L[i] = m.L[i] * (1 - wet * 0.4) + wl[i] * wet; m.R[i] = m.R[i] * (1 - wet * 0.4) + wr[i] * wet }
}

function toWav(m, path) {
  let peak = 0
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(m.L[i]), Math.abs(m.R[i]))
  const k = peak > 0 ? 0.8 / peak : 1
  const buf = Buffer.alloc(44 + N * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40)
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, m.L[i] * k)) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, m.R[i] * k)) * 32767), 46 + i * 4) }
  writeFileSync(path, buf)
}

// ---- warm -------------------------------------------------------------------------------------------------------------------------------------------------------------------
function warm() {
  const m = mixer()
  const r = rng(7)
  const beat = 60 / 66
  const bar = beat * 4
  const CH = { D: [50, 57, 62, 66], A: [45, 52, 57, 61], Bm: [47, 54, 59, 62], G: [43, 50, 55, 59] }
  const prog = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'D', 'A', 'Bm', 'G', 'G', 'A', 'D', 'D']
  const pattern = [0, 1, 2, 3, 2, 1, 2, 1]
  prog.forEach((c, b) => {
    const t0 = b * bar
    pattern.forEach((idx, j) => {
      const v = (j === 0 ? 0.62 : 0.4) + 0.06 * r()
      m.add(t0 + j * (beat / 2), piano(hz(CH[c][idx]), 2.4, v), 0.55, -0.25 + 0.5 * r())
    })
    // a soft string pad on the chord, one bar long, overlapping
    CH[c].slice(0, 3).forEach((mn, k) => m.add(t0, pad(hz(mn + (k === 0 ? 12 : 0)), bar, 0.2, b * 10 + k), 0.55, k - 1 === 0 ? 0 : (k - 1) * 0.3))
  })
  const melody = [
    [0, 0, 74, 2], [0, 2, 78, 2], [1, 0, 76, 3], [2, 0, 74, 2], [2, 2, 71, 2], [3, 0, 71, 2], [3, 2, 74, 2],
    [4, 0, 78, 3], [4, 3, 74, 1], [5, 0, 76, 2], [5, 2, 73, 2], [6, 0, 74, 2], [6, 2, 71, 2], [7, 0, 73, 4],
    [8, 0, 81, 2], [8, 2, 78, 2], [9, 0, 76, 2], [9, 2, 81, 2], [10, 0, 78, 2], [10, 2, 74, 2], [11, 0, 71, 2], [11, 2, 74, 2],
    [12, 0, 71, 2], [12, 2, 74, 2], [13, 0, 76, 2], [13, 2, 73, 2], [14, 0, 74, 6],
  ]
  for (const [b, bt, mn, d] of melody) m.add(b * bar + bt * beat, piano(hz(mn), d * beat, 0.7), 0.5, 0.2)
  reverb(m, 0.34, 0.83)
  return m
}

// ---- quiet ------------------------------------------------------------------------------------------------------------------------------------------------------------------
function quiet() {
  const m = mixer()
  const r = rng(21)
  // a very low drone (A and E) that swells in and out slowly
  for (const [mn, g] of [[33, 0.5], [40, 0.32], [45, 0.22]]) m.add(0, pad(hz(mn), 56, 0.35, mn), g, 0)
  // a Japanese pentatonic on A (A B C E F): a note now and then, sometimes two together
  const A = 57, B = 59, C = 60, E = 64, F = 65
  const notes = [
    [2.0, A], [4.6, E], [7.2, C], [9.4, F], [11.9, E], [14.5, A, E], [17.6, C], [20.1, B], [22.4, A], [25.5, E], [28.0, F, C], [30.8, E],
    [33.5, C], [36.2, A], [38.6, B], [41.0, E, A], [44.0, C], [46.6, A], [49.2, E], [51.8, A - 12, A], [55.0, A - 12],
  ]
  for (const [t, ...ms] of notes) ms.forEach((mn, k) => m.add(t + k * 0.04, pluck(hz(mn + 12 * (mn < 52 ? 1 : 0)), 3, 0.5 + 0.15 * r()), 0.5, -0.3 + 0.6 * r()))
  reverb(m, 0.42, 0.88)
  return m
}

const root = process.cwd()
const tmp = mkdtempSync(join(tmpdir(), 'ichirei-music-'))
function levelAndEncode(name) {
  const wav = join(tmp, `${name}.wav`)
  const report = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${wav}" -af loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`], { encoding: 'utf8' })
  const j = JSON.parse(report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1))
  const af = `loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`
  mkdirSync(join(root, 'assets', 'music'), { recursive: true })
  mkdirSync(join(root, 'public', 'music'), { recursive: true })
  const out = join(root, 'assets', 'music', `${name}.mp3`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', `${af},aresample=44100`, '-c:a', 'libmp3lame', '-b:a', '192k', out])
  copyFileSync(out, join(root, 'public', 'music', `${name}.mp3`))
  console.log(name, 'measured', j.input_i, 'LUFS →', out)
}
try {
  for (const [name, make] of [['warm', warm], ['quiet', quiet]]) { toWav(make(), join(tmp, `${name}.wav`)); levelAndEncode(name) }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
