// The story film's DATA side. One fixed 30-second film per order (the same template for everyone): it retells the customer's own story in four
// short scenes and ends with the chosen character. This module keeps what the page needs under a private, unguessable id (AN-…): the carved form,
// its reading, the "who they are" line, the memorial flag and — when it is ready — the film script (engine/film.ts: four lines and four scene IDs).
// The page `/a/<id>` plays it with the fixed template in src/animation/; no model call happens when it is played.

import { randomBytes } from 'node:crypto'
import type { Language } from './contract.ts'
import type { OrderRecord } from './order.ts'
import type { FilmRecord } from './film.ts'

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
  /** The carved form: the character the film ends with. */
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  /** "Your moment": the sender's own words as the card quotes them (used only by the fallback script). */
  moment: string
  /** "Who they are": the card's one line (shown near the end of the film). */
  who: string
  memorial: boolean
  /** The film script (engine/film.ts): four lines and four scene IDs, or the fallback; null while it is being written. */
  film: FilmRecord | null
}

export function buildAnimationRecord(record: OrderRecord, id: string, now: Date = new Date()): AnimationRecord {
  const p = record.production
  return {
    schema: 'animation',
    id,
    order_ref: record.order_ref,
    created_at: now.toISOString(),
    language: p.language,
    glyph: p.glyph_to_carve,
    reading: p.certificate.reading,
    romanization: p.certificate.romanization,
    meaning_en: p.certificate.meaning_en,
    moment: p.story_anchor,
    who: p.gaze_line,
    memorial: p.certificate.memorial === true,
    film: null,
  }
}

export interface AnimationView {
  id: string
  language: Language
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  who: string
  memorial: boolean
  /** null = the film is still being written (the page shows a quiet waiting screen and asks again). */
  film: { status: 'ready' | 'fallback'; lines: string[]; scenes: string[] } | null
}

/** What the page receives: what the film shows, and nothing about the order, the names or the story beyond the film's own lines. */
export function animationView(r: AnimationRecord): AnimationView {
  return {
    id: r.id,
    language: r.language,
    glyph: r.glyph,
    reading: r.reading,
    romanization: r.romanization,
    meaning_en: r.meaning_en,
    who: r.who,
    memorial: r.memorial,
    film: r.film ? { status: r.film.status, lines: r.film.lines, scenes: r.film.scenes } : null,
  }
}

export function isAnimationRecord(x: unknown): x is AnimationRecord {
  const r = x as Partial<AnimationRecord> | null
  return !!r && r.schema === 'animation' && typeof r.id === 'string' && ANIMATION_ID_PATTERN.test(r.id) && typeof r.glyph === 'string' && typeof r.moment === 'string' && typeof r.who === 'string'
}

// ---- sample films (for the owner's phone tests) --------------------------------------------------------------------------------------------------
// ICHIREI_ANIMATION_SAMPLES=on makes four reserved ids play made-up SAMPLE films without any order behind them, so the film can be opened on a real
// phone before a real order exists. Off by default; switch it off in cloudbuild.yaml (`_ANIMATION_SAMPLES`) when the testing is done. The sample
// stories are invented for this purpose and belong to no customer; their scripts were written by hand to follow the film-script rules (they were not
// produced by the model).

export const SAMPLE_IDS = {
  ja: 'AN-sampleja222222222222',
  zh: 'AN-samplezh222222222222',
  en: 'AN-sampleen222222222222',
  memorial: 'AN-samplemem22222222222',
} as const

export const animationSamplesOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.ICHIREI_ANIMATION_SAMPLES?.trim().toLowerCase() === 'on'

const sampleBase = { schema: 'animation' as const, order_ref: 'SAMPLE', created_at: '2026-10-28T00:00:00.000Z' }
const madeAt = '2026-10-28T00:00:00.000Z'

export const SAMPLE_RECORDS: Record<string, AnimationRecord> = {
  // 0020: a daughter and her mother's lunch boxes (the golden story of the film tests)
  [SAMPLE_IDS.ja]: { ...sampleBase, id: SAMPLE_IDS.ja, language: 'ja', glyph: '備', reading: 'そなえ・び', romanization: 'sonae / bi', meaning_en: 'prepare', moment: '「ちょうど今詰めてたところ」', who: 'いつも、頼まれる前に備えている人。', memorial: false,
    film: { status: 'ready', made_at: madeAt, scenes: ['S-02', 'S-12', 'S-21', 'S-15'], lines: ['春には、お弁当に\n庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、\n母は静かに台所へ戻った。', '教師になり、生徒に\n自分のお弁当を分けた日、母を思った。', '帰る日の弁当を頼むと、「ちょうど今詰めてたところ」。'] } },
  [SAMPLE_IDS.zh]: { ...sampleBase, id: SAMPLE_IDS.zh, language: 'zh-Hant', glyph: '待', reading: 'dài', romanization: 'dài', meaning_en: 'wait', moment: '你總是在門口等我', who: '總是點著燈、在門口等我回家的人。', memorial: false,
    film: { status: 'ready', made_at: madeAt, scenes: ['S-35', 'S-16', 'S-13', 'S-31'], lines: ['每次晚歸，玄關總有一盞燈亮著。', '下雨的夜裡，媽媽撐著傘在門口等。', '我去外地讀書，她在月台上揮著手。', '電話裡她只說：「家裡燈還亮著。」'] } },
  [SAMPLE_IDS.en]: { ...sampleBase, id: SAMPLE_IDS.en, language: 'en', glyph: '待', reading: 'まつ', romanization: 'matsu', meaning_en: 'wait', moment: 'She was always waiting at the station', who: 'The one who waited, every single time, without ever being asked.', memorial: false,
    film: { status: 'ready', made_at: madeAt, scenes: ['S-13', 'S-16', 'S-35', 'S-04'], lines: ['Every time I left, she stood\nat the station and waved.', 'When it rained, she was there\nwith an umbrella, before I asked.', 'I came home late, and the shoes\nwere already set by the door.', 'She only said, \u201cThe tea is ready.\u201d'] } },
  [SAMPLE_IDS.memorial]: { ...sampleBase, id: SAMPLE_IDS.memorial, language: 'ja', glyph: '綴', reading: 'つづる', romanization: 'tsuzuru', meaning_en: 'stitch', moment: '私の名前で、何十通も手紙を書き続けてくれた', who: '私の名前で、何十通も手紙を書き続けてくれた人。', memorial: true,
    film: { status: 'ready', made_at: madeAt, scenes: ['S-14', 'S-22', 'S-38', 'S-40'], lines: ['母は、私の名前で\n何通も手紙を書いてくれた。', '遠くの先生への礼状も、\n祖母への便りも、母の字だった。', '机の上には、あの日の便箋が\n今も重ねてある。', '母の字を読むと、\n私の名前が少し誇らしい。'] } },
}

export const sampleRecord = (id: string, env: NodeJS.ProcessEnv = process.env): AnimationRecord | null => (animationSamplesOn(env) ? (SAMPLE_RECORDS[id] ?? null) : null)
