// The four sizes of the one gift (owner decision 2026-10-30): the story, character, poem, film and story pictures are the same in all of them.
// Prices here are what the UI DISPLAYS; the amount actually charged is whatever the Shopify variant behind each size costs (engine/shopify.ts
// picks the variant from SHOPIFY_VARIANT_DIGITAL / _CARD / _SIMPLE / _STANDARD) — the client never sends a price.
// Plain TS, no imports: shared by the browser and the server.

/** ① デジタル · ② カード · ③ 木札 (simple) · ④ 版木 (standard). The ids simple / standard are the two that existed first. */
export const PACKAGES = ['digital', 'card', 'simple', 'standard'] as const
export type PackageId = (typeof PACKAGES)[number]

/** The order the page shows them in: ③ 木札 (recommended), ④ 版木, ② カード, ① デジタル (last, "send it now"). */
export const PACKAGE_DISPLAY_ORDER: readonly PackageId[] = ['simple', 'standard', 'card', 'digital']
/** The size recommended on the page. */
export const RECOMMENDED_PACKAGE: PackageId = 'simple'

/** Tax-included JPY price shown to the customer. Keep in step with the Shopify variants. */
export const PACKAGE_PRICE_JPY: Record<PackageId, number> = { digital: 2980, card: 4980, simple: 9800, standard: 18850 }

/** The size code kept on the order record and on the Shopify variant's SKU. */
export const PACKAGE_SKU: Record<PackageId, string> = { digital: 'ICHIREI-DIGITAL', card: 'ICHIREI-CARD', simple: 'ICHIREI-SIMPLE', standard: 'ICHIREI-STANDARD' }

/** Sizes that are shipped to somebody (everything but the digital gift). */
export const SHIPS: Record<PackageId, boolean> = { digital: false, card: true, simple: true, standard: true }
/** Sizes with a wooden piece: they overseas-ship by EMS (¥6,000); the card goes by mail, Japan and worldwide. */
export const WOODEN: Record<PackageId, boolean> = { digital: false, card: false, simple: true, standard: true }

/** Where a shipped size goes: to the sender, directly to the receiver (the receiver's address at checkout), or as an e-gift (the receiver types the address). */
export const SHIP_TO = ['me', 'direct', 'egift'] as const
export type ShipTo = (typeof SHIP_TO)[number]
/** The short message printed on the card when shipping directly or as an e-gift (characters, by code point). */
export const GIFT_MESSAGE_MAX = 60
/** E-gift for the wooden sizes is Japan only at launch; for the card it works worldwide. */
export const EGIFT_JAPAN_ONLY: Record<PackageId, boolean> = { digital: false, card: false, simple: true, standard: true }

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
