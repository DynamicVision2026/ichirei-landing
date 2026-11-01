// Which occasion the visitor has picked in the story form (the form lives in the lazily loaded DemoApp; the "steps" and "examples" sections of the landing page sit outside it).
// Only one thing is shared: whether 偲ぶ (remembrance) is selected, because a remembrance result is two cards (main + second, no free pick) and the copy says so.
import { useSyncExternalStore } from 'react'

let memorial = false
const listeners = new Set<() => void>()

export function setMemorialSelected(value: boolean): void {
  if (memorial === value) return
  memorial = value
  for (const l of listeners) l()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** true while 偲ぶ / 追思 / In memory is the picked occasion. */
export function useMemorialSelected(): boolean {
  return useSyncExternalStore(subscribe, () => memorial, () => false)
}
