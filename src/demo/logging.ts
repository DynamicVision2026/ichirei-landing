// Behavioral instrumentation (build spec §6).
//
// Append-only event log. Events accumulate client-side (the source of truth for
// export) and are POSTed best-effort to /api/log so they also land in the Vercel
// function logs. Priority signals: candidate_returned and candidate_dwell_ms.

import type { Condition } from './types'

export type LogEventName =
  | 'session_started'
  | 'engine_run'
  | 'candidate_opened'
  | 'candidate_dwell_ms'
  | 'candidate_returned'
  | 'selection_changed'
  | 'preview_opened'
  | 'explain_opened'
  | 'final_selection'
  | 'condition_changed'
  | 'follow_up_shown'

export interface LogEvent {
  event: LogEventName
  ts: string
  seq: number
  session_id: string
  story_id: string | null
  condition: Condition
  [key: string]: unknown
}

const events: LogEvent[] = []
let seq = 0

const session_id =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`

let story_id: string | null = null
let condition: Condition = 'A'

/** Stable id for a story text so re-runs of the same story correlate. */
export function setStory(storyText: string) {
  let h = 5381
  for (let i = 0; i < storyText.length; i++) h = ((h << 5) + h + storyText.charCodeAt(i)) | 0
  story_id = `story-${(h >>> 0).toString(36)}`
}

export function setCondition(c: Condition) {
  condition = c
}

export function log(event: LogEventName, payload: Record<string, unknown> = {}) {
  const entry: LogEvent = {
    event,
    ts: new Date().toISOString(),
    seq: seq++,
    session_id,
    story_id,
    condition,
    ...payload,
  }
  events.push(entry)
  // Best-effort server sink — never blocks or breaks the UI.
  try {
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}

export function getEvents(): readonly LogEvent[] {
  return events
}

/** Download the full append-only log as a JSON file (iPad-friendly export). */
export function exportEvents() {
  const blob = new Blob([JSON.stringify(events, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ichirei-events-${session_id.slice(0, 8)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function getSessionId() {
  return session_id
}
