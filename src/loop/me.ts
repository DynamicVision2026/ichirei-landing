// What the server knows about this browser, for the landing's bars (ticket 2026-11-15): how many gifts the basket holds, a paid gift waiting to be collected, and a free-gift hold.
// One small read (/api/me), shared by every bar on the page; nothing is shown until it answers, and a failure shows nothing (never a broken page).

import { useSyncExternalStore } from 'react'

export interface HoldInfo {
  id?: string
  email: string
  state: string
  expires_at: string
  minutes_left: number
  count?: number
}
export interface Me {
  basket: { count: number }
  ready: { id: string; name: string } | null
  hold: HoldInfo | null
}

let me: Me | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function loadMe(force = false): Promise<void> {
  if (inflight && !force) return inflight
  const lang = (() => {
    try {
      return document.documentElement.lang || ''
    } catch {
      return ''
    }
  })()
  inflight = fetch(`/api/me${lang ? `?l=${encodeURIComponent(lang)}` : ''}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .then((j) => {
      if (j && typeof j === 'object' && j.basket) {
        me = j
        emit()
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

export const refreshMe = (): Promise<void> => loadMe(true)

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  void loadMe()
  return () => listeners.delete(l)
}

export function useMe(): Me | null {
  return useSyncExternalStore(subscribe, () => me, () => null)
}

/** Tests and the basket page set the count after "×" or a save, without another read. */
export function setBasketCount(n: number): void {
  if (me) me = { ...me, basket: { count: n } }
  else me = { basket: { count: n }, ready: null, hold: null }
  emit()
}
