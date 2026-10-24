// The two packages on sale. Prices here are what the UI DISPLAYS; the amount actually charged
// is whatever the Shopify variant behind each package costs (engine/shopify.ts picks the variant
// from SHOPIFY_VARIANT_SIMPLE / SHOPIFY_VARIANT_STANDARD) — the client never sends a price.
// Plain TS, no imports: shared by the browser and the server.

export const PACKAGES = ['simple', 'standard'] as const
export type PackageId = (typeof PACKAGES)[number]

/** Tax-included JPY price shown to the customer. Keep in step with the two Shopify variants. */
export const PACKAGE_PRICE_JPY: Record<PackageId, number> = { simple: 9800, standard: 18850 }

export const formatYen = (n: number): string => `¥${n.toLocaleString('en-US')}`
