// The story film's DATA side. One fixed 30-second film per order (the same template for everyone): it retells the customer's own story in four
// short scenes and ends with the chosen character. This module keeps what the page needs under a private, unguessable id (AN-…): the carved form,
// its reading, the "who they are" line, the memorial flag and — when it is ready — the film script (engine/film.ts: four lines and four picture descriptions; the pictures themselves are drawn on the first open, engine/film-art.ts).
// The page `/a/<id>` plays it with the fixed template in src/animation/; no model call happens when it is played.

import { randomBytes } from 'node:crypto'
import type { Language } from './contract.ts'
import type { OrderRecord } from './order.ts'
import type { FilmRecord } from './film.ts'
import type { ArtRecord } from './film-art.ts'

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
  /** The film script (engine/film.ts): four lines and four picture descriptions, or the fallback; null while it is being written. */
  film: FilmRecord | null
  /** The receiver's page of this order (engine/gift.ts): the sender's page offers it for sharing. Never sent to the receiver. */
  gift_token?: string | null
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
  /**
   * null = the film script is still being written (the page shows a quiet waiting screen and asks again).
   * `pictures` null = the script is there but the four pictures are not drawn yet: the page asks POST /api/film/<id>/render, which stays open until they are.
   * `deferred` = the daily picture limit was reached; they come the next day.
   * `incomplete` = some pictures could not be drawn yet (quota or an outage): washi is shown in their place and the page asks the server to draw only those.
   */
  film: { status: 'ready' | 'fallback'; lines: string[]; pictures: string[] | null; deferred?: boolean; incomplete?: boolean } | null
  /** The sender's page only (api/animation.ts adds it): what to share and where the order stands. */
  gift?: { url: string; size_code: string; ship_to: string; egift_state: 'waiting' | 'received' | null } | null
}

/** A film the pictures can be drawn for: a fallback script (nothing to draw) or one with its four descriptions (older films with scene IDs are written again). */
export const filmUsable = (f: FilmRecord | null | undefined): f is FilmRecord => !!f && (f.status === 'fallback' || (Array.isArray(f.pictures) && f.pictures.length === f.lines.length && f.lines.length === 4))

/** The address of a picture: our own private route (never a bucket address), versioned by when the set was made. */
export const pictureUrl = (id: string, n: number, madeAt?: string): string => `/api/film/${id}/picture/${n}.webp${madeAt ? `?v=${Date.parse(madeAt) || 0}` : ''}`
export const washiPictureUrl = (slot: number): string => `/film/washi-${(slot % 2) + 1}.webp`

/** What the page receives: what the film shows, and nothing about the order, the names or the story beyond the film's own lines. */
export function animationView(r: AnimationRecord, art: ArtRecord | null = null): AnimationView {
  const f = r.film
  let film: AnimationView['film'] = null
  if (filmUsable(f)) {
    if (f.status === 'fallback') film = { status: 'fallback', lines: f.lines, pictures: f.lines.map((_, i) => washiPictureUrl(i)) }
    else if (art && art.status !== 'deferred' && art.slots.length === f.lines.length) {
      // done, incomplete, or being drawn again (a lease still shows what was there): a picture where there is one, washi elsewhere
      film = { status: 'ready', lines: f.lines, pictures: f.lines.map((_, i) => (art.slots[i] === 'ai' ? pictureUrl(r.id, i + 1, art.made_at) : washiPictureUrl(i))), ...(art.slots.includes('pending') || art.slots.includes('unchecked') ? { incomplete: true } : {}) }
    } else film = { status: 'ready', lines: f.lines, pictures: null, ...(art?.status === 'deferred' ? { deferred: true } : {}) }
  }
  return { id: r.id, language: r.language, glyph: r.glyph, reading: r.reading, romanization: r.romanization, meaning_en: r.meaning_en, who: r.who, memorial: r.memorial, film }
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

/**
 * The revision of a sample's pictures. An art record saved under another revision is ignored, so changing a number here makes that sample draw its
 * pictures AGAIN on its next open (no access to the bucket needed). 2: ja / zh / memorial redrawn after the quota fixes; 3: zh / en / memorial redrawn
 * after the clothes-and-setting and no-religious-symbol rules; 4: zh / en / memorial redrawn again after the picture-check fix (ja stays on 2); 5: zh redrawn after the contemporary-objects style line and the rewrite-before-washi step.
 */
export const SAMPLE_ART_REV: Record<string, string> = {
  'AN-sampleja222222222222': '2',
  'AN-samplezh222222222222': '5',
  'AN-sampleen222222222222': '4',
  'AN-samplemem22222222222': '4',
}
export const artRevFor = (id: string): string | undefined => SAMPLE_ART_REV[id]

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
    film: { status: 'ready', made_at: madeAt, pictures: ['a mother\'s hand placing one spring flower on an open bento box on a wooden kitchen counter, soft morning window light', 'a young woman seen from behind at a kitchen doorway, her mother a small silhouette at the stove beyond, pale morning light', 'two hands passing a wrapped lunch box across a classroom desk, a teacher seen from behind among empty desks, afternoon light through a window', 'a woman seen from behind holding a telephone receiver beside a window at dusk, warm lamp light and a quiet room'], lines: ['春には、お弁当に\n庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、\n母は静かに台所へ戻った。', '教師になり、生徒に\n自分のお弁当を分けた日、母を思った。', '帰る日の弁当を頼むと、「ちょうど今詰めてたところ」。'] } },
  [SAMPLE_IDS.zh]: { ...sampleBase, id: SAMPLE_IDS.zh, language: 'zh-Hant', glyph: '待', reading: 'dài', romanization: 'dài', meaning_en: 'wait', moment: '你總是在門口等我', who: '總是點著燈、在門口等我回家的人。', memorial: false,
    film: { status: 'ready', made_at: madeAt, pictures: ['a lit lamp glowing beside a front door at night, a pair of shoes on the entrance step, a quiet apartment street in autumn', 'a mother seen from behind holding an umbrella at a doorway in evening rain, soft reflections on the wet ground', 'a mother\'s silhouette waving on a train platform as a train pulls away, early morning mist', 'a hand holding an old telephone receiver beside a warm lamp in a small room at night'], lines: ['每次晚歸，玄關總有一盞燈亮著。', '下雨的夜裡，媽媽撐著傘在門口等。', '我去外地讀書，她在月台上揮著手。', '電話裡她只說：「家裡燈還亮著。」'] } },
  [SAMPLE_IDS.en]: { ...sampleBase, id: SAMPLE_IDS.en, language: 'en', glyph: '待', reading: 'まつ', romanization: 'matsu', meaning_en: 'wait', moment: 'She was always waiting at the station', who: 'The one who waited, every single time, without ever being asked.', memorial: false,
    film: { status: 'ready', made_at: madeAt, pictures: ['a silhouette of a mother standing on a small railway station platform waving, morning light, a simple wooden bench', 'a woman seen from behind holding an umbrella at a station exit in steady rain, wet paving stones', 'a pair of shoes set neatly by a doorway at night, warm light from inside a home', 'two cups of tea on a low wooden table in a quiet room, steam rising, soft evening light'], lines: ['Every time I left, she stood\nat the station and waved.', 'When it rained, she was there\nwith an umbrella, before I asked.', 'I came home late, and the shoes\nwere already set by the door.', 'She only said, \u201cThe tea is ready.\u201d'] } },
  [SAMPLE_IDS.memorial]: { ...sampleBase, id: SAMPLE_IDS.memorial, language: 'ja', glyph: '綴', reading: 'つづる', romanization: 'tsuzuru', meaning_en: 'stitch', moment: '私の名前で、何十通も手紙を書き続けてくれた', who: '私の名前で、何十通も手紙を書き続けてくれた人。', memorial: true,
    film: { status: 'ready', made_at: madeAt, pictures: ['a mother\'s hand holding a brush over a sheet of folded paper at a low desk, soft grey window light', 'a stack of folded paper tied with string on a quiet shelf, a single window, still afternoon', 'a small wooden desk by a sunlit window with folded paper stacked on one corner and an empty chair', 'a pair of hands resting on a folded sheet of paper in soft light, a window beyond'], lines: ['母は、私の名前で\n何通も手紙を書いてくれた。', '遠くの先生への礼状も、\n祖母への便りも、母の字だった。', '机の上には、あの日の便箋が\n今も重ねてある。', '母の字を読むと、\n私の名前が少し誇らしい。'] } },
}

export const sampleRecord = (id: string, env: NodeJS.ProcessEnv = process.env): AnimationRecord | null => (animationSamplesOn(env) ? (SAMPLE_RECORDS[id] ?? null) : null)
