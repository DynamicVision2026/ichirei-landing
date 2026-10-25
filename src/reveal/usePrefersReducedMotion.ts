import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'
const subscribe = (fn: () => void) => {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}

/** True when the visitor asked the system for less motion: the carousel then never auto-advances. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
