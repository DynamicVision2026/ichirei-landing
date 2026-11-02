import { useEffect, useState, type MutableRefObject } from 'react'
import type { EngineResult } from './types'
import { sessionId, trackPreview } from './analytics.ts'

// The free card preview (engine/preview.ts): the moment a character is picked, the draft of the story is asked for (the film script), then the four
// pictures are drawn and shown one by one as they arrive. The same story gives back the same draft: switching characters, formats or candidate sets
// never draws again. Nothing here blocks the order: a limit, an error or a slow picture only means the card shows no picture yet.

export type PreviewPhase = 'script' | 'drawing' | 'done' | 'failed' | 'limited'
export type PreviewSlot = 'ai' | 'washi' | 'pending'
export interface PreviewState {
  phase: PreviewPhase
  lines: string[]
  pictures: (string | null)[]
  /** Per picture: drawn (`ai`), the plain washi tile (`washi`), or not there yet (`pending`). A picture that is shown is never taken away. */
  slots: PreviewSlot[]
  /** The draft to send with the order (so the order's film is the one the buyer saw). */
  draftId: string | null
}
export type DraftRef = MutableRefObject<{ key: string; id: string } | null>

const EMPTY: (string | null)[] = [null, null, null, null]
const PENDING: PreviewSlot[] = ['pending', 'pending', 'pending', 'pending']
const WASHI: PreviewSlot[] = ['washi', 'washi', 'washi', 'washi']
const POLL_MS = 2500
const GIVE_UP_MS = 240_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Requests of one story still on their way (React's strict mode asks twice in development; a second ask joins the first). */
const starting = new Map<string, Promise<{ state: 'ok'; id: string } | { state: 'limited' } | { state: 'error' }>>()

type View = { state: 'drawing' | 'done' | 'failed' | 'deferred'; lines: string[]; pictures: (string | null)[]; slots?: PreviewSlot[] }

export function usePreview(args: { result: EngineResult; story: string; followUps: string[]; shown: string[]; draftRef: DraftRef }): PreviewState {
  const { result, story, followUps, shown, draftRef } = args
  const [state, setState] = useState<PreviewState>({ phase: 'script', lines: [], pictures: EMPTY, slots: PENDING, draftId: draftRef.current?.id ?? null })
  const memorial = result.occasion === 'memorial'
  const key = JSON.stringify([result.language, memorial, story.trim(), followUps])

  useEffect(() => {
    let alive = true
    const t0 = Date.now()
    const secs = () => (Date.now() - t0) / 1000
    const finish = (phase: PreviewPhase, id: string | null, view?: View) => {
      if (!alive) return
      const pictures = view?.pictures ?? EMPTY
      const slots = view?.slots ?? pictures.map((p): PreviewSlot => (p ? 'ai' : phase === 'drawing' || phase === 'script' ? 'pending' : 'washi'))
      setState({ phase, lines: view?.lines ?? [], pictures, slots: phase === 'failed' || phase === 'limited' ? (view?.slots ?? WASHI) : slots, draftId: id })
    }
    ;(async () => {
      const known = draftRef.current?.key === key ? draftRef.current.id : null
      let start = starting.get(key)
      if (!start) {
        start = fetch('/api/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            story,
            ...(followUps.length ? { follow_ups: followUps } : {}),
            language: result.language,
            ...(result.relationship ? { relationship: result.relationship } : {}),
            ...(result.direction ? { direction: result.direction } : {}),
            ...(result.occasion ? { occasion: result.occasion } : {}),
            ...(result.occasion_detail ? { occasion_detail: result.occasion_detail } : {}),
            // v9.6: why the gift is given and where the two stand — the film and its pictures take the purpose's tone (quiet for an apology, an encouragement, a remembrance)
            ...(result.purpose ? { purpose: result.purpose } : {}),
            ...(result.state ? { state: result.state } : {}),
            shown,
            ...(known ? { draft_id: known } : {}),
            session: sessionId,
          }),
        })
          .then(async (r) => {
            const j = (await r.json().catch(() => null)) as { state?: string; id?: string } | null
            if (r.ok && j?.state === 'ok' && j.id) return { state: 'ok' as const, id: j.id }
            if (r.ok && j?.state === 'limited') return { state: 'limited' as const }
            return { state: 'error' as const }
          })
          .catch(() => ({ state: 'error' as const }))
        starting.set(key, start)
        void start.finally(() => starting.delete(key))
      }
      const out = await start
      if (out.state === 'limited') {
        trackPreview('pictures_before_pay', { language: result.language, state: 'limited', secs: secs() })
        return finish('limited', null)
      }
      if (out.state === 'error') {
        trackPreview('pictures_before_pay', { language: result.language, state: 'failed', secs: secs() })
        return finish('failed', null)
      }
      draftRef.current = { key, id: out.id }
      if (alive) setState((s) => ({ ...s, draftId: out.id }))
      // the drawing: one request that stays open until the pictures are done, and a look every few seconds so each picture shows when it arrives
      const render = fetch(`/api/preview/${out.id}/render`, { method: 'POST' }).then((r) => (r.ok ? (r.json() as Promise<View>) : null)).catch(() => null)
      let last: View | null = null
      let done = false
      void render.then((v) => {
        if (v) last = v
      })
      while (alive && Date.now() - t0 < GIVE_UP_MS) {
        const v = await fetch(`/api/preview/${out.id}`).then((r) => (r.ok ? (r.json() as Promise<View>) : null)).catch(() => null)
        if (v) last = v
        if (last) {
          const terminal = last.state === 'done' || last.state === 'failed' || last.state === 'deferred'
          if (terminal) {
            done = true
            finish(last.state === 'done' ? 'done' : 'failed', out.id, last)
            trackPreview('pictures_before_pay', { language: result.language, state: last.state === 'done' ? 'shown' : 'failed', secs: secs() })
            return
          }
          finish('drawing', out.id, last)
        }
        await sleep(POLL_MS)
      }
      if (alive && !done) {
        // out of time: what is there stays on the card (a picture is never taken away); what is not there is shown as the plain washi tile
        const some = !!last?.pictures.some(Boolean)
        trackPreview('pictures_before_pay', { language: result.language, state: some ? 'shown' : 'failed', secs: secs() })
        finish(some ? 'done' : 'failed', out.id, last ? { ...last, slots: last.slots?.map((s) => (s === 'pending' ? 'washi' : s)) ?? last.pictures.map((p): PreviewSlot => (p ? 'ai' : 'washi')) } : undefined)
      }
    })()
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}
