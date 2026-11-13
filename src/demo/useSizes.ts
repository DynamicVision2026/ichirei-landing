// Which sizes of the gift can be ordered right now: asked once from /api/sizes (only sizes whose Shopify variant is configured are listed).
// Until the answer is in, `null` (the page shows nothing rather than flashing a size that is about to disappear). If the question itself fails,
// the two sizes that always exist are assumed (the server still refuses anything that is not on sale).

import { useEffect, useState } from 'react'
import { PACKAGES, PACKAGE_DISPLAY_ORDER, SHIPS, type PackageId } from '../order/packages.ts'
import { saleOn, type Sale } from '../order/sale.ts'

const FALLBACK: PackageId[] = ['simple', 'standard']
let cache: PackageId[] | null = null
/** The sizes shown as 「近日公開」 (ICHIREI_WOOD_SIZES=coming_soon on the server): listed, but not orderable. */
let soon: PackageId[] = []
let inflight: Promise<PackageId[]> | null = null
/** The Thanksgiving sale the server says is on (null = none). */
let sale: Sale | null = null

/** Pure: the sale in a /api/sizes body, or null. */
export const cleanSale = (raw: unknown): Sale | null => {
  const s = (raw as { sale?: Partial<Sale> } | null)?.sale
  const ok = !!s && typeof s.percent === 'number' && typeof s.until === 'string' && typeof s.ends_at === 'string' && Number.isFinite(Date.parse(s.ends_at))
  if (!ok || !s) return null
  const starts = typeof s.starts_at === 'string' && Number.isFinite(Date.parse(s.starts_at)) ? s.starts_at : '1970-01-01T00:00:00.000Z'
  return { percent: s.percent as number, from: typeof s.from === 'string' ? s.from : '1970-01-01', until: s.until as string, starts_at: starts, ends_at: s.ends_at as string }
}

export const cleanSizes = (raw: unknown): PackageId[] => {
  const list = Array.isArray((raw as { sizes?: unknown } | null)?.sizes) ? ((raw as { sizes: unknown[] }).sizes as unknown[]) : []
  const known = list.filter((x): x is PackageId => typeof x === 'string' && (PACKAGES as readonly string[]).includes(x))
  return PACKAGE_DISPLAY_ORDER.filter((p) => known.includes(p))
}

export const cleanComingSoon = (raw: unknown): PackageId[] => {
  const list = Array.isArray((raw as { coming_soon?: unknown } | null)?.coming_soon) ? ((raw as { coming_soon: unknown[] }).coming_soon as unknown[]) : []
  return PACKAGE_DISPLAY_ORDER.filter((p) => list.includes(p))
}

export function loadSizes(): Promise<PackageId[]> {
  if (cache) return Promise.resolve(cache)
  inflight ??= fetch('/api/sizes')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const sizes = j ? cleanSizes(j) : FALLBACK
      soon = j ? cleanComingSoon(j) : []
      sale = j ? cleanSale(j) : null
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

/** The sizes that are shown but cannot be ordered yet (empty unless the owner turned the e-gift-first switch on). Same single request as useSizes. */
export function useComingSoon(): PackageId[] {
  const [list, setList] = useState<PackageId[]>(soon)
  useEffect(() => {
    let alive = true
    void loadSizes().then(() => alive && setList(soon))
    return () => {
      alive = false
    }
  }, [])
  return list
}

/** True only when a wooden size can be ordered right now (on sale, not "coming soon"). Until /api/sizes answers it is false: the e-gift wording shows. */
export function useWoodOnSale(): boolean {
  const sizes = useSizes()
  const soon = useComingSoon()
  return !!sizes && sizes.some((p) => SHIPS[p] && !soon.includes(p))
}

/** The sale to show right now (null = none): from the same single /api/sizes request. It shows only from its first moment to its last, and the page switches it on at the start and off at the end by itself. */
export function useSale(): Sale | null {
  const [raw, setRaw] = useState<Sale | null>(sale)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    void loadSizes().then(() => alive && setRaw(sale))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!raw) return
    const now = Date.now()
    const next = [Date.parse(raw.starts_at), Date.parse(raw.ends_at) + 1].filter((t) => t > now).sort((a, b) => a - b)[0]
    if (next === undefined || next - now > 2_147_000_000) return
    const t = window.setTimeout(() => setTick((n) => n + 1), next - now + 50)
    return () => window.clearTimeout(t)
  }, [raw, tick])
  void tick
  return saleOn(raw)
}
