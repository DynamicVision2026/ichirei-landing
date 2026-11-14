// Whether the visitor is inside the write → cards → result → order flow (2026-11-14, C2). The sticky "write" dock is hidden for the whole flow, decided by this phase flag and not by how much of the
// section happens to be on screen (a tall section could leave the dock on top of a card button or "Continue to payment" on a phone).
import { useSyncExternalStore } from 'react'

let active = false
const listeners = new Set<() => void>()

export function setFlowActive(value: boolean): void {
  if (active === value) return
  active = value
  for (const l of listeners) l()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useFlowActive(): boolean {
  return useSyncExternalStore(subscribe, () => active, () => false)
}
