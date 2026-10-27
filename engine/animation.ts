// The story animation (one fixed 30-second film per order, the same style for every customer; no AI call). This module is the DATA side:
// it turns what the engine already produced for an order — the carved character, the poem, the "your moment" line, the "who they are" line,
// the memorial flag — into a small record kept under a private, unguessable id (AN-…), and into the view the page `/a/<id>` plays.
// The film itself is drawn by src/animation/ (HTML / SVG / CSS), from the stroke data in engine/stroke-data.ts.

import { randomBytes } from 'node:crypto'
import type { Language } from './contract.ts'
import type { OrderRecord } from './order.ts'
import type { PoemType } from '../src/order/packages.ts'
import type { StrokeScript } from './stroke-data.ts'

export const ANIMATION_ID_PATTERN = /^AN-[a-z2-9]{20}$/
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // 32 symbols → 100 bits in 20 characters; no look-alikes (l, o, 0, 1)
export const DEFAULT_PUBLIC_URL = 'https://ichirei.soul-id.jp'

export const newAnimationId = (random: (n: number) => Uint8Array = randomBytes): string => {
  let id = 'AN-'
  for (const b of random(20)) id += ALPHABET[b % ALPHABET.length]
  return id
}

export const publicUrl = (env: NodeJS.ProcessEnv = process.env): string => (env.ICHIREI_PUBLIC_URL?.trim() || DEFAULT_PUBLIC_URL).replace(/\/+$/, '')
export const animationUrl = (id: string, env: NodeJS.ProcessEnv = process.env): string => `${publicUrl(env)}/a/${id}`

export interface AnimationRecord {
  schema: 'animation'
  id: string
  /** Kept for the owner; never sent to the page. */
  order_ref: string
  created_at: string
  language: Language
  /** Which stroke data draws the character: Japanese forms (ja, en buyers) or Chinese forms (zh buyers). */
  script: StrokeScript
  /** The carved form. */
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  /** "Your moment": the sender's own words from the story, as the card quotes them. */
  moment: string
  /** "Who they are": the one line of the card. */
  who: string
  memorial: boolean
  /** The first poem of the order, when there is one: its type, lines and the reading aids as stored with it. */
  poem: { type: PoemType; lines: string[]; reading: string } | null
}

export function buildAnimationRecord(record: OrderRecord, id: string, now: Date = new Date()): AnimationRecord {
  const p = record.production
  const poem = p.certificate.poems[0]
  return {
    schema: 'animation',
    id,
    order_ref: record.order_ref,
    created_at: now.toISOString(),
    language: p.language,
    script: p.language === 'zh-Hans' || p.language === 'zh-Hant' ? 'zh' : 'ja',
    glyph: p.glyph_to_carve,
    reading: p.certificate.reading,
    romanization: p.certificate.romanization,
    meaning_en: p.certificate.meaning_en,
    moment: p.story_anchor,
    who: p.gaze_line,
    memorial: p.certificate.memorial === true,
    poem: poem ? { type: poem.type, lines: [...poem.lines], reading: poem.reading ?? '' } : null,
  }
}

/** The reading aids stored with a poem: the first block is shown under the lines when it has one entry per line; the rest are notes under the poem. */
export function splitAids(lines: string[], reading: string): { lineAids: (string | null)[]; notes: string[] } {
  const parts = reading.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return { lineAids: lines.map(() => null), notes: [] }
  const first = parts[0].split('\n').map((s) => s.trim())
  if (first.length === lines.length) return { lineAids: first, notes: parts.slice(1) }
  return { lineAids: lines.map(() => null), notes: parts }
}

export interface AnimationView {
  id: string
  language: Language
  script: StrokeScript
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  moment: string
  who: string
  memorial: boolean
  poem: { type: PoemType; lines: string[]; lineAids: (string | null)[]; notes: string[] } | null
}

/** What the page receives: everything it draws, and nothing about the order, the names or the story beyond the two quoted lines. */
export function animationView(r: AnimationRecord): AnimationView {
  return {
    id: r.id,
    language: r.language,
    script: r.script,
    glyph: r.glyph,
    reading: r.reading,
    romanization: r.romanization,
    meaning_en: r.meaning_en,
    moment: r.moment,
    who: r.who,
    memorial: r.memorial,
    poem: r.poem ? { type: r.poem.type, lines: r.poem.lines, ...splitAids(r.poem.lines, r.poem.reading) } : null,
  }
}

export function isAnimationRecord(x: unknown): x is AnimationRecord {
  const r = x as Partial<AnimationRecord> | null
  return !!r && r.schema === 'animation' && typeof r.id === 'string' && ANIMATION_ID_PATTERN.test(r.id) && typeof r.glyph === 'string' && typeof r.moment === 'string' && typeof r.who === 'string'
}
