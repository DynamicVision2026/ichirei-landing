// The two packages on sale. Prices here are what the UI DISPLAYS; the amount actually charged
// is whatever the Shopify variant behind each package costs (engine/shopify.ts picks the variant
// from SHOPIFY_VARIANT_SIMPLE / SHOPIFY_VARIANT_STANDARD) — the client never sends a price.
// Plain TS, no imports: shared by the browser and the server.

export const PACKAGES = ['simple', 'standard'] as const
export type PackageId = (typeof PACKAGES)[number]

/** Tax-included JPY price shown to the customer. Keep in step with the two Shopify variants. */
export const PACKAGE_PRICE_JPY: Record<PackageId, number> = { simple: 9800, standard: 18850 }

export const formatYen = (n: number): string => `¥${n.toLocaleString('en-US')}`

// ---- the poem add-on (歌の添え書き) ----------------------------------------------------------------------------------
// After choosing a character the buyer may add up to MAX_POEMS poems, each a paid add-on of POEM_PRICE_JPY (tax included). The amount charged
// is the price of the Shopify variant behind each type (SHOPIFY_VARIANT_POEM_<TYPE>); this number only DISPLAYS it.

export const POEM_TYPES = ['tanka', 'tang', 'ci', 'en'] as const
export type PoemType = (typeof POEM_TYPES)[number]
export const POEM_PRICE_JPY = 1980
export const MAX_POEMS = 2
