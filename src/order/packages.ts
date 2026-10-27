// The two packages on sale. Prices here are what the UI DISPLAYS; the amount actually charged
// is whatever the Shopify variant behind each package costs (engine/shopify.ts picks the variant
// from SHOPIFY_VARIANT_SIMPLE / SHOPIFY_VARIANT_STANDARD) — the client never sends a price.
// Plain TS, no imports: shared by the browser and the server.

export const PACKAGES = ['simple', 'standard'] as const
export type PackageId = (typeof PACKAGES)[number]

/** Tax-included JPY price shown to the customer. Keep in step with the two Shopify variants. */
export const PACKAGE_PRICE_JPY: Record<PackageId, number> = { simple: 9800, standard: 18850 }

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
