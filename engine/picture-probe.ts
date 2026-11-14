// The daily picture probe (2026-11-14, B7). The post-deploy self-test draws no pictures, so a broken image path could go unseen for days. Once a day the probe draws ONE fixed internal film
// (English, four pictures) through the REAL path — the image model, the pixel check, the vision check, the retries, the rewrites — and records what became of each slot:
// drawn / retry (needed a second go) / substituted (another passed picture stands in) / pending / washi (nothing passed). Codes only. One probe per day (the cost cap).

import { createHash } from 'node:crypto'
import type { FilmRecord } from './film.ts'
import { ensureArt, readArt, type ImageClient } from './film-art.ts'
import type { OrderStore } from './order-store.ts'
import type Anthropic from '@anthropic-ai/sdk'

export type ProbeSlot = 'drawn' | 'retry' | 'substituted' | 'pending' | 'washi'
export interface ProbeReport {
  day: string
  ran: boolean
  /** why it did not run (already_today | no_store | off) */
  skipped?: string
  slots: ProbeSlot[]
  /** the failure codes of the slots that did not pass first time (codes only) */
  reasons: string[]
  ms: number
}

export const probePath = (day: string): string => `selftest/probe-${day}.json`

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
/** A fixed, valid animation id for the day (the pictures of a probe are never mixed with any order's). */
export function probeId(day: string): string {
  const h = createHash('sha256').update(`probe-${day}`).digest()
  let out = 'AN-'
  for (let i = 0; i < 20; i++) out += ALPHABET[h[i] % ALPHABET.length]
  return out
}

/** The fixed internal film: four scenes of one porch-light moment (no real customer story, nothing of any order). */
export const PROBE_FILM: FilmRecord = {
  status: 'ready',
  turning_point: 'The porch light was always on when I got home',
  made_at: '2026-11-14T00:00:00.000Z',
  pictures: [
    'a wide quiet view of a suburban street at dusk, a pickup truck parked in a driveway and a small house with its porch light on',
    'a hand resting on the steering wheel of a pickup truck, soft light through the windshield',
    'a small figure seen from behind walking up a driveway toward a lit porch, far away',
    'the porch light glowing beside a front door at night, an empty rocking chair on the porch',
  ],
  lines: ['Every night, the porch light was on.', 'I drove home slowly, even when it was late.', 'The walk up the driveway was never dark.', 'Somebody had left the light on for me.'],
} as unknown as FilmRecord

export interface ProbeDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  image?: ImageClient
  vision?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
}

export async function runPictureProbe(d: ProbeDeps): Promise<ProbeReport> {
  const env = d.env ?? process.env
  const now = (d.now ?? (() => new Date()))()
  const day = now.toISOString().slice(0, 10)
  const base: ProbeReport = { day, ran: false, slots: [], reasons: [], ms: 0 }
  if (env.ICHIREI_PICTURE_PROBE?.trim().toLowerCase() === 'off') return { ...base, skipped: 'off' }
  if (!d.store) return { ...base, skipped: 'no_store' }
  const prior = await d.store.getObject(probePath(day)).catch(() => null)
  if (prior) {
    try {
      return { ...(JSON.parse(prior.toString('utf8')) as ProbeReport), ran: false, skipped: 'already_today' }
    } catch {
      return { ...base, skipped: 'already_today' }
    }
  }
  // the day's mark is written FIRST: even a probe that dies halfway never runs twice in a day
  await d.store.putObject(probePath(day), JSON.stringify({ ...base, ran: true, started_at: now.toISOString() }), 'application/json')
  const id = probeId(day)
  const t0 = Date.now()
  const art = await ensureArt({ store: d.store, image: d.image, client: d.vision, env, log: d.log, now: d.now }, { id, film: PROBE_FILM, memorial: false, language: 'en', rev: 'probe', paid: true })
  const fresh = (await readArt(d.store, id, 'probe').catch(() => null)) ?? art
  const anyAi = fresh.slots.includes('ai')
  const slots: ProbeSlot[] = fresh.slots.map((s, i) => (s === 'ai' ? (fresh.outcomes?.[i] === 'drawn_on_retry' ? 'retry' : 'drawn') : s === 'washi' ? (anyAi ? 'substituted' : 'washi') : 'pending'))
  const reasons = fresh.slots.map((s, i) => (s === 'ai' && fresh.outcomes?.[i] !== 'drawn_on_retry' ? '' : String(fresh.reasons?.[i] ?? '').replace(/[^a-z0-9_]/g, '').slice(0, 24))).filter((r) => r && r !== 'ok')
  const report: ProbeReport = { day, ran: true, slots, reasons, ms: Date.now() - t0 }
  await d.store.putObject(probePath(day), JSON.stringify(report), 'application/json')
  return report
}
