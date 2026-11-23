import { cleanTool, type Tool } from '../order/tool.ts'

// The Relationship Map tool's items (src/order/tool.ts) of the page the visitor arrived on, kept for the visit only (the tab's session storage); the newest arrival from the tool wins.
const KEY = 'ichirei-tool'

/** Called once on load: remembers the arrival's tool items when the address says src=tool. Returns whether this load is a NEW arrival from the tool (to be counted once). */
export function captureTool(): boolean {
  try {
    const found = cleanTool(new URLSearchParams(window.location.search))
    if (!found) return false
    const sig = JSON.stringify(found)
    const had = window.sessionStorage.getItem(KEY)
    window.sessionStorage.setItem(KEY, sig)
    return had !== sig
  } catch {
    return false
  }
}

/** The visit's tool items (from storage, else from the address), or null for a normal visit. */
export function getTool(): Tool | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    return (raw ? cleanTool(JSON.parse(raw)) : null) ?? cleanTool(new URLSearchParams(window.location.search))
  } catch {
    return null
  }
}
