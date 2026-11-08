// What the printed card and the story scroll are made of — the same pieces the receiver's page shows, read from the stored records (never the story text
// beyond the film's own four lines, never the price): the four pictures in story order with their lines, the character with its reading and the "who they
// are" line, the poem, the certificate line, 「○○より」 / 「＿＿さんへ」, the short message, and the receiver page's address for the QR code.

import { cleanReading } from '../../src/order/reading.ts'
import { isQuietPurpose } from '../../src/order/purpose.ts'
import sharp from 'sharp'
import type { AnimationRecord } from '../animation.ts'
import { filmUsable } from '../animation.ts'
import { picturePath, type ArtRecord } from '../film-art.ts'
import { giftUrl, type GiftRecord } from '../gift.ts'
import type { OrderStore } from '../order-store.ts'

export interface Artwork {
  language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'
  glyph: string
  reading: string
  who: string
  certificateLine: string
  lines: string[]
  /** Full-size JPEGs (1080×1350), or null where the slot is plain washi (no real picture). */
  pictures: (Buffer | null)[]
  poem: string[]
  /** The poem's format code (tanka, haiku, tang, ci, en): 短歌 and 俳句 are set vertically (縦書き) on the card, the others stay horizontal. */
  poemType?: string
  memorial: boolean
  /** Why the gift is given (the purpose code), which decides the music; absent on older gifts. */
  purpose?: string | null
  /** The state chip (`lost` always gets the remembrance piece); not kept on orders, so usually absent. */
  state?: string | null
  /** v9.6: no red, no celebration colour — remembrance, an apology and an encouragement. The main character is ink. */
  quiet: boolean
  /** Names printed on the card. Empty strings mean the line stays blank, for handwriting (the sender hands it over). */
  from: string
  /** True = the printed card of a wooden size that the sender hands over: an empty name stays a line to write on. False = an empty name (none was given) is simply left out. */
  handwrite?: boolean
  to: string
  message: string
  qrUrl: string
}

/** True when all four pictures are real: only then is a story scroll made (never with a washi slot). */
export const scrollReady = (anim: AnimationRecord, art: ArtRecord | null): boolean => !!art && filmUsable(anim.film) && anim.film.status === 'ready' && art.slots.length === 4 && art.slots.every((s) => s === 'ai')

export async function loadArtwork(store: OrderStore, gift: GiftRecord, anim: AnimationRecord, art: ArtRecord | null, env: NodeJS.ProcessEnv = process.env): Promise<Artwork> {
  const film = filmUsable(anim.film) ? anim.film : null
  const lines = film ? film.lines : []
  const pictures: (Buffer | null)[] = []
  for (let i = 0; i < lines.length; i++) {
    if (art?.slots[i] !== 'ai') {
      pictures.push(null)
      continue
    }
    try {
      const webp = await store.getObject(picturePath(anim.id, i + 1))
      pictures.push(webp ? await sharp(webp).jpeg({ quality: 92 }).toBuffer() : null)
    } catch {
      pictures.push(null)
    }
  }
  // the printed card of a wooden size has blank lines (the sender hands it over and may write them); the e-gift's home-print card carries the names
  const blank = gift.package !== 'egift' && (gift.ship_to === 'me' || gift.ship_to === 'none')
  return {
    language: gift.language,
    glyph: gift.glyph,
    reading: cleanReading(gift.reading),
    who: gift.who,
    certificateLine: gift.certificate_line,
    lines,
    pictures,
    poem: gift.poem?.lines ?? [],
    poemType: gift.poem?.type ?? '',
    memorial: gift.memorial,
    purpose: gift.purpose ?? null,
    quiet: gift.memorial || isQuietPurpose(gift.purpose),
    handwrite: blank,
    from: blank ? '' : gift.from,
    to: blank ? '' : gift.to,
    message: blank ? '' : gift.message,
    qrUrl: giftUrl(gift.token, env),
  }
}

export const SLOGAN = { en: 'Designed in Tokyo. Made in Japan. Delivered worldwide.', ja: '東京でデザインし、日本でつくり、世界へ届ける。', 'zh-Hant': '東京設計・日本製作・送達全世界。' } as const
export const CREDIT = { en: 'Illustrations drawn by AI', ja: '挿画：AIによる描画', 'zh-Hant': '插畫：AI 繪製' } as const
export const slogan = (l: Artwork['language']): string => (l === 'ja' ? SLOGAN.ja : l === 'en' ? SLOGAN.en : SLOGAN['zh-Hant'])
export const credit = (l: Artwork['language']): string => (l === 'ja' ? CREDIT.ja : l === 'en' ? CREDIT.en : CREDIT['zh-Hant'])
