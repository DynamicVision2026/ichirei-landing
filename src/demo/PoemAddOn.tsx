import { useCallback, useEffect, useRef, useState } from 'react'
import type { Candidate, EngineResult } from './types'
import type { Copy, UiLanguage } from './i18n'
import { log } from './logging'
import { sessionId } from './analytics'
import { DEFAULT_POEM_TYPE, POEM_TYPES, type PoemType } from '../order/packages.ts'

// The poem (歌の添え書き): ONE poem is included free in every order. After the character is chosen the buyer picks a format (the first one
// shown follows the site language: ja → tanka, zh → ci, en → en), the poem is written at once and shown IN FULL before checkout; another
// format can be tried (each one is written once and kept). The page keeps only the poem_id: /api/order reads the poem back from the server —
// poem text is never sent by the browser. A poem that cannot be written after two tries is given up politely and the order goes ahead without
// one. While a poem is being written the order button waits (the buyer sees the poem before paying).

type Status = { state: 'loading'; attempt: number } | { state: 'ready'; poemId: string; lines: string[]; reading: string } | { state: 'failed' }
export type PoemStep = 'loading' | 'ready' | 'none'

type Props = {
  result: EngineResult
  story: string
  followUps: string[]
  candidate: Candidate
  copy: Copy
  language: UiLanguage
  /** The poem_ids to send with the order (zero or one) and whether the step is still working. */
  onChange: (poemIds: string[], step: PoemStep) => void
  disabled?: boolean
}

const TRIES = 2
const CALL_TIMEOUT_MS = 60_000

export default function PoemAddOn({ result, story, followUps, candidate, copy, language, onChange, disabled }: Props) {
  const p = copy.order.poem
  const [selected, setSelected] = useState<PoemType>(DEFAULT_POEM_TYPE[language])
  const [status, setStatus] = useState<Partial<Record<PoemType, Status>>>({})
  const inflight = useRef<{ type: PoemType; ac: AbortController } | null>(null)
  const started = useRef<Set<PoemType>>(new Set())

  const write = useCallback(
    async (type: PoemType) => {
      for (let attempt = 1; attempt <= TRIES; attempt++) {
        const ac = new AbortController()
        inflight.current = { type, ac }
        setStatus((s) => ({ ...s, [type]: { state: 'loading', attempt } }))
        log('poem_requested', { type, attempt })
        try {
          const res = await fetch('/api/poem', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: AbortSignal.any ? AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : ac.signal,
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
              type,
            }),
          })
          const data = (await res.json().catch(() => null)) as { poem_id?: string; lines?: string[]; reading?: string; code?: string } | null
          if (res.ok && data?.poem_id && Array.isArray(data.lines) && data.lines.length > 0) {
            setStatus((s) => ({ ...s, [type]: { state: 'ready', poemId: data.poem_id!, lines: data.lines!, reading: data.reading ?? '' } }))
            log('poem_ready', { type, attempt })
            return
          }
          log('poem_failed', { type, attempt, code: data?.code ?? res.status })
          if (res.status === 429 || data?.code === 'declined') break // nothing to gain from asking again right away
        } catch {
          if (ac.signal.aborted) return // the buyer chose another format: this one is dropped quietly
          log('poem_failed', { type, attempt, code: 'network' })
        }
      }
      setStatus((s) => ({ ...s, [type]: { state: 'failed' } }))
    },
    [candidate.kanji, candidate.one_line_gaze, followUps, language, result, story],
  )

  // write the selected format (once) as soon as it is selected; leave an unfinished one if the buyer moves on
  useEffect(() => {
    if (started.current.has(selected)) return
    started.current.add(selected)
    const prev = inflight.current
    if (prev && prev.type !== selected) {
      prev.ac.abort()
      started.current.delete(prev.type)
      setStatus((s) => (s[prev.type]?.state === 'loading' ? { ...s, [prev.type]: undefined } : s))
    }
    void write(selected)
  }, [selected, write])
  useEffect(
    () => () => {
      inflight.current?.ac.abort()
      started.current.clear() // (a remount, as React's strict mode does in development, writes the poem again)
    },
    [],
  )

  const st = status[selected]
  const step: PoemStep = !st || st.state === 'loading' ? 'loading' : st.state === 'ready' ? 'ready' : 'none'
  const poemId = st?.state === 'ready' ? st.poemId : ''
  useEffect(() => {
    onChange(poemId ? [poemId] : [], step)
  }, [poemId, step]) // eslint-disable-line react-hooks/exhaustive-deps

  const tryAgain = () => {
    started.current.delete(selected)
    setStatus((s) => ({ ...s, [selected]: undefined }))
    started.current.add(selected)
    void write(selected)
  }

  return (
    <fieldset className="cgroup" data-testid="poem-addon" data-step={step}>
      <legend className="clab">{p.heading}</legend>
      <p className="sent">{p.note}</p>
      <div className="optRow">
        {POEM_TYPES.map((t) => (
          <label key={t} className={`opt${selected === t ? ' on' : ''}`}>
            <input type="radio" name="poem_type" value={t} data-poem-type={t} checked={selected === t} disabled={disabled} onChange={() => setSelected(t)} />
            <span>{p.types[t]}</span>
          </label>
        ))}
      </div>
      <div className="sent" data-poem-result={selected} data-state={st?.state ?? 'loading'} aria-live="polite">
        {(!st || st.state === 'loading') && <span>{p.loading}</span>}
        {st?.state === 'ready' && (
          <>
            <span className="notranslate" data-poem-full style={{ display: 'block', whiteSpace: 'pre-line', lineHeight: 1.9, fontSize: '1.05em' }}>
              {st.lines.join('\n')}
            </span>
            {st.reading && (
              <span className="notranslate" data-poem-reading style={{ display: 'block', whiteSpace: 'pre-line', lineHeight: 1.7, fontSize: '0.85em', opacity: 0.75, marginTop: '0.5em' }}>
                {st.reading}
              </span>
            )}
            <span style={{ display: 'block', marginTop: '0.5em' }}>{p.printedOnCard}</span>
          </>
        )}
        {st?.state === 'failed' && (
          <>
            <span role="status" data-poem-failed>{p.failedFinal}</span>{' '}
            <button type="button" className="backLink" onClick={tryAgain} disabled={disabled}>
              {p.tryAgain}
            </button>
          </>
        )}
      </div>
    </fieldset>
  )
}
