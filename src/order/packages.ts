// The three sizes of the one gift (owner decision 2026-10-31): 一字礼 eギフト (the whole digital gift, nothing posted), 木札 and 版木. The story, character, poem, film and
// story pictures are the same in all of them. The separate デジタル ¥2,980 and カード ¥4,980 are gone: they merged into the one real e-gift.
// Prices here are what the UI DISPLAYS; the amount actually charged is whatever the Shopify variant behind each size costs (engine/shopify.ts picks the variant
// from SHOPIFY_VARIANT_EGIFT / _SIMPLE / _STANDARD) — the client never sends a price.
// Plain TS, no imports: shared by the browser and the server.

/** eギフト (egift) · 木札 (simple) · 版木 (standard). The ids simple / standard are the two that existed first. */
export const PACKAGES = ['egift', 'simple', 'standard'] as const
export type PackageId = (typeof PACKAGES)[number]
/** Sizes that were sold for a short time and no longer are: old test orders may carry them, and must stay readable. */
export const LEGACY_PACKAGES = ['digital', 'card'] as const

/** The order the page shows them in, left to right: eギフト (「今すぐ贈れる」), 木札 (おすすめ), 版木. */
export const PACKAGE_DISPLAY_ORDER: readonly PackageId[] = ['egift', 'simple', 'standard']
/**
 * E-gift-first launch switch: ICHIREI_WOOD_SIZES=coming_soon puts 木札 and 版木 on the page as 「近日公開」 (disabled buttons; /api/order refuses them). Off by default — the owner turns it on.
 * Reads the value it is given (the server passes its environment); anything else means the wooden sizes are on sale as usual.
 */
export const COMING_SOON_VALUE = 'coming_soon'
export const comingSoonSizes = (value: string | null | undefined): PackageId[] => ((value ?? '').trim().toLowerCase() === COMING_SOON_VALUE ? ['simple', 'standard'] : [])
/** The size recommended on the page. */
export const RECOMMENDED_PACKAGE: PackageId = 'simple'

/** Tax-included JPY price shown to the customer. Keep in step with the Shopify variants. */
export const PACKAGE_PRICE_JPY: Record<PackageId, number> = { egift: 3980, simple: 9800, standard: 18850 }

/** The size code kept on the order record and on the Shopify variant's SKU. */
export const PACKAGE_SKU: Record<PackageId, string> = { egift: 'ICHIREI-EGIFT', simple: 'ICHIREI-SIMPLE', standard: 'ICHIREI-STANDARD' }

/** Sizes that are shipped to somebody (everything but the e-gift, which is sent as a link). */
export const SHIPS: Record<PackageId, boolean> = { egift: false, simple: true, standard: true }
/** Sizes with a wooden piece: they overseas-ship by EMS (¥6,000). */
export const WOODEN: Record<PackageId, boolean> = { egift: false, simple: true, standard: true }
/** Sizes that come with the printed card in the box (the owner prints it at launch). The e-gift's card is a PDF to print at home (Part 5). */
export const PRINTED_CARD: Record<PackageId, boolean> = { egift: false, simple: true, standard: true }

/** Where a shipped size goes: to the sender, directly to the receiver (the receiver's address at checkout), or as an e-gift (the receiver types the address). */
export const SHIP_TO = ['me', 'direct', 'egift'] as const
export type ShipTo = (typeof SHIP_TO)[number]
/** The short message shown in the letter (and printed on the card when it goes to the receiver), in characters (by code point). */
export const GIFT_MESSAGE_MAX = 60
/** Entering the receiver's address (ship to "egift") for the wooden sizes is Japan only at launch. */
export const EGIFT_JAPAN_ONLY: Record<PackageId, boolean> = { egift: false, simple: true, standard: true }
/** How far ahead the sender may fix the day the gift opens (days). */
export const OPEN_DATE_MAX_DAYS = 365

export const formatYen = (n: number): string => `¥${n.toLocaleString('en-US')}`

// ---- the poem (歌の添え書き) ----------------------------------------------------------------------------------------
// ONE poem is included in every order, free: after choosing a character the buyer picks a format (the default follows the site language).
// It travels as attributes on the main ICHIREI line item and in certificate.poems; there is no price and no extra line item.

export const POEM_TYPES = ['tanka', 'haiku', 'tang', 'ci', 'en'] as const
export type PoemType = (typeof POEM_TYPES)[number]
/** One poem per order. */
export const MAX_POEMS = 1
/** The format offered first, by the story's language (spec v9.5): Japanese → tanka, Chinese → the Tang quatrain (tang), English → free verse. */
export const DEFAULT_POEM_TYPE: Record<'ja' | 'zh-Hans' | 'zh-Hant' | 'en', PoemType> = { ja: 'tanka', 'zh-Hans': 'tang', 'zh-Hant': 'tang', en: 'en' }

/**
 * The formats offered follow the STORY's language (spec v9.5, owner decision): a Japanese story offers 短歌 (default), 俳句 or the Tang-style quatrain (漢詩) with its 書き下し — no 宋詞, no English;
 * a Chinese story offers the Tang quatrain (唐詩, default) or 宋詞; an English story offers free verse only. The first format is the default. An order made before this rule keeps the format it has.
 */
export type StoryLanguage = 'ja' | 'zh' | 'en'
export const POEM_TYPES_BY_STORY_LANGUAGE: Record<StoryLanguage, readonly PoemType[]> = { ja: ['tanka', 'haiku', 'tang'], zh: ['tang', 'ci'], en: ['en'] }

/** The language most of the story's text is written in (kana → Japanese; else Han characters → Chinese; else Latin letters → English), or null when it is too short to tell. */
export function detectStoryLanguage(text: string): StoryLanguage | null {
  let kana = 0
  let han = 0
  let latin = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x3040 && c <= 0x30ff) || c === 0x30fc) kana++
    else if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) han++
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++
  }
  const total = kana + han + latin
  if (total < 8) return null
  // Japanese prose is full of kana (about half of its letters); Chinese has none
  if (kana / total >= 0.12) return 'ja'
  if (han >= latin) return 'zh'
  return 'en'
}

const orderFamily = (language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'): StoryLanguage => (language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh')

/** The story's language for the poem step: the language the text is mostly written in, else the language the engine ran in (the order's language). */
export const storyLanguageOf = (language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en', story?: string): StoryLanguage => (story ? detectStoryLanguage(story) : null) ?? orderFamily(language)

export const poemTypesFor = (language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en', story?: string): readonly PoemType[] => POEM_TYPES_BY_STORY_LANGUAGE[storyLanguageOf(language, story)]
export const poemTypeAllowed = (language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en', type: string, story?: string): boolean => (poemTypesFor(language, story) as readonly string[]).includes(type)
export const defaultPoemType = (language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en', story?: string): PoemType => poemTypesFor(language, story)[0]
