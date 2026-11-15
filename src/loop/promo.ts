// The English "Days of Thanks" card's live numbers (ticket 2026-11-15): how many of today's free gifts are left and the hold this browser has. One small read every 60 s while a card or the order
// section is on screen (/api/promo; the server caches the count for a few seconds). A failed read keeps the last answer.

import { useSyncExternalStore } from 'react'

export interface PromoHold {
  state: string
  expires_at: string
  minutes_left: number
  email: string
}
export interface PromoState {
  on: boolean
  left?: number
  daily?: number
  ended?: 'expired' | 'used' | 'three_holds' | null
  hold?: PromoHold | null
}

let state: PromoState | null = null
let timer: number | null = null
let users = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export async function refreshPromo(): Promise<void> {
  try {
    const r = await fetch('/api/promo', { credentials: 'same-origin' })
    if (!r.ok) return
    state = (await r.json()) as PromoState
    emit()
  } catch {
    // keeps the last answer
  }
}

/** A hold just placed (or an answer from the hold form) is shown at once, before the next read. */
export function setPromoHold(hold: PromoHold | null, left?: number): void {
  state = { ...(state ?? { on: true }), on: true, hold, ended: null, ...(left !== undefined ? { left } : {}) }
  emit()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  users++
  void refreshPromo()
  if (timer === null) timer = window.setInterval(() => void refreshPromo(), 60_000)
  return () => {
    listeners.delete(l)
    users--
    if (users <= 0 && timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}

export const usePromo = (): PromoState | null => useSyncExternalStore(subscribe, () => state, () => null)

/** "8:42 PM" in the visitor's own time zone. */
export const localTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}
