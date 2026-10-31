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

export const POEM_TYPES = ['tanka', 'tang', 'ci', 'en'] as const
export type PoemType = (typeof POEM_TYPES)[number]
/** One poem per order. */
export const MAX_POEMS = 1
/** The format offered first, by site language: Japanese → tanka, Chinese → ci, English → en. */
export const DEFAULT_POEM_TYPE: Record<'ja' | 'zh-Hans' | 'zh-Hant' | 'en', PoemType> = { ja: 'tanka', 'zh-Hans': 'ci', 'zh-Hant': 'ci', en: 'en' }
