// Which sizes of the gift can be ordered right now: asked once from /api/sizes (only sizes whose Shopify variant is configured are listed).
// Until the answer is in, `null` (the page shows nothing rather than flashing a size that is about to disappear). If the question itself fails,
// the two sizes that always exist are assumed (the server still refuses anything that is not on sale).

import { useEffect, useState } from 'react'
import { PACKAGES, PACKAGE_DISPLAY_ORDER, type PackageId } from '../order/packages.ts'

const FALLBACK: PackageId[] = ['simple', 'standard']
let cache: PackageId[] | null = null
let inflight: Promise<PackageId[]> | null = null

export const cleanSizes = (raw: unknown): PackageId[] => {
  const list = Array.isArray((raw as { sizes?: unknown } | null)?.sizes) ? ((raw as { sizes: unknown[] }).sizes as unknown[]) : []
  const known = list.filter((x): x is PackageId => typeof x === 'string' && (PACKAGES as readonly string[]).includes(x))
  return PACKAGE_DISPLAY_ORDER.filter((p) => known.includes(p))
}

export function loadSizes(): Promise<PackageId[]> {
  if (cache) return Promise.resolve(cache)
  inflight ??= fetch('/api/sizes')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const sizes = j ? cleanSizes(j) : FALLBACK
      cache = sizes
      return sizes
    })
    .catch(() => FALLBACK)
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useSizes(): PackageId[] | null {
  const [sizes, setSizes] = useState<PackageId[] | null>(cache)
  useEffect(() => {
    let alive = true
    void loadSizes().then((s) => alive && setSizes(s))
    return () => {
      alive = false
    }
  }, [])
  return sizes
}
