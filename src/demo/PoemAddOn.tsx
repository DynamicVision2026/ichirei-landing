import { useEffect, useRef, useState } from 'react'
import type { Candidate, EngineResult } from './types'
import type { Copy, UiLanguage } from './i18n'
import { log } from './logging'
import { sessionId } from './analytics'
import { MAX_POEMS, POEM_PRICE_JPY, POEM_TYPES, formatYen, type PoemType } from '../order/packages.ts'

// The poem add-on (歌の添え書き), spec v9.1 step 10: after choosing a character the buyer may add up to MAX_POEMS poems, each ¥1,980.
// Selecting a chip asks /api/poem for that poem and shows ONLY ITS FIRST LINE ("the full poem is printed on your card"). The page keeps
// the poem_id only; /api/order reads the poem back from the server — poem text is never sent by the browser. A type with no Shopify
// variant is not offered (/api/poem-types lists the types on offer); with none on offer the whole step is hidden.

type Status = { state: 'loading' } | { state: 'ready'; poemId: string; preview: string } | { state: 'error'; message: string }

type Props = {
  result: EngineResult
  story: string
  followUps: string[]
  candidate: Candidate
  copy: Copy
  language: UiLanguage
  /** Called with the poem_ids of the poems that are ready and chosen, in the order they were added. */
  onChange: (poemIds: string[]) => void
  disabled?: boolean
}

export default function PoemAddOn({ result, story, followUps, candidate, copy, language, onChange, disabled }: Props) {
  const p = copy.order.poem
  const [offered, setOffered] = useState<PoemType[] | null>(null)
  const [status, setStatus] = useState<Partial<Record<PoemType, Status>>>({})
  const [order, setOrder] = useState<PoemType[]>([])
  const aborts = useRef<Partial<Record<PoemType, AbortController>>>({})

  useEffect(() => {
    let alive = true
    const pending = aborts.current
    fetch('/api/poem-types')
      .then((r) => (r.ok ? r.json() : { types: [] }))
      .then((j: { types?: unknown }) => alive && setOffered(Array.isArray(j.types) ? (POEM_TYPES.filter((t) => (j.types as unknown[]).includes(t)) as PoemType[]) : []))
      .catch(() => alive && setOffered([]))
    return () => {
      alive = false
      Object.values(pending).forEach((a) => a?.abort())
    }
  }, [])

  const readyIds = order.flatMap((t) => (status[t]?.state === 'ready' ? [(status[t] as { poemId: string }).poemId] : []))
  const readyKey = readyIds.join('|')
  useEffect(() => {
    onChange(readyKey ? readyKey.split('|') : [])
  }, [readyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!offered || offered.length === 0) return null

  const chosen = order.filter((t) => status[t]?.state === 'ready' || status[t]?.state === 'loading')
  const remove = (t: PoemType) => {
    aborts.current[t]?.abort()
    setStatus((s) => ({ ...s, [t]: undefined }))
    setOrder((o) => o.filter((x) => x !== t))
  }
  const choose = async (t: PoemType) => {
    if (disabled) return
    if (status[t]) return remove(t)
    if (chosen.length >= MAX_POEMS) return
    const ac = new AbortController()
    aborts.current[t] = ac
    setStatus((s) => ({ ...s, [t]: { state: 'loading' } }))
    setOrder((o) => [...o, t])
    log('poem_requested', { type: t })
    try {
      const res = await fetch('/api/poem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          session: sessionId,
          source: 'customer',
          story,
          ...(followUps.length ? { follow_ups: followUps } : {}),
          language,
          ...(result.relationship ? { relationship: result.relationship } : {}),
          ...(result.direction ? { direction: result.direction } : {}),
          ...(result.occasion ? { occasion: result.occasion } : {}),
          ...(result.occasion_detail ? { occasion_detail: result.occasion_detail } : {}),
          kanji: candidate.kanji,
          gaze: candidate.one_line_gaze,
          type: t,
        }),
      })
      const data = (await res.json().catch(() => null)) as { poem_id?: string; preview?: string } | null
      if (!res.ok || !data?.poem_id || typeof data.preview !== 'string') throw new Error('poem failed')
      setStatus((s) => ({ ...s, [t]: { state: 'ready', poemId: data.poem_id!, preview: data.preview! } }))
      log('poem_ready', { type: t })
    } catch (err) {
      if (ac.signal.aborted) return
      log('poem_failed', { type: t, reason: err instanceof Error ? err.message : 'error' })
      setStatus((s) => ({ ...s, [t]: { state: 'error', message: p.failed } }))
    }
  }

  const addedCount = readyIds.length
  return (
    <fieldset className="cgroup" data-testid="poem-addon">
      <legend className="clab">{p.heading}</legend>
      <p className="sent">{p.note(formatYen(POEM_PRICE_JPY), MAX_POEMS)}</p>
      <div className="optRow">
        {offered.map((t) => {
          const st = status[t]
          const on = st?.state === 'ready' || st?.state === 'loading'
          const blocked = !st && chosen.length >= MAX_POEMS
          return (
            <button
              key={t}
              type="button"
              className={`opt${on ? ' on' : ''}`}
              data-poem-type={t}
              aria-pressed={on}
              disabled={disabled || blocked || st?.state === 'loading'}
              onClick={() => choose(t)}
            >
              <span>{p.types[t]}</span>
              <span className="pkgPrice" data-poem-price>
                {formatYen(POEM_PRICE_JPY)}
              </span>
            </button>
          )
        })}
      </div>
      {order.map((t) => {
        const st = status[t]
        if (!st) return null
        return (
          <div key={t} className="sent" data-poem-result={t} data-state={st.state}>
            <strong>{p.types[t]}</strong>{' '}
            {st.state === 'loading' && <span>{p.loading}</span>}
            {st.state === 'ready' && (
              <>
                <span className="notranslate" data-poem-preview>
                  {st.preview}
                </span>{' '}
                <span>{p.printedOnCard}</span>{' '}
                <button type="button" className="backLink" onClick={() => remove(t)} disabled={disabled}>
                  {p.remove}
                </button>
              </>
            )}
            {st.state === 'error' && (
              <>
                <span role="alert">{st.message}</span>{' '}
                <button type="button" className="backLink" onClick={() => remove(t)}>
                  {p.remove}
                </button>
              </>
            )}
          </div>
        )
      })}
      {addedCount > 0 && (
        <p className="sent" data-poem-total>
          {p.total(addedCount, formatYen(POEM_PRICE_JPY * addedCount))}
        </p>
      )}
    </fieldset>
  )
}
