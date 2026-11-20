import { useCallback, useEffect, useRef, useState } from 'react'
import type { Candidate, EngineResult } from './types'
import type { Copy, UiLanguage } from './i18n'
import { log } from './logging'
import { sessionId } from './analytics'
import { defaultPoemType, poemTypesFor, type PoemType } from '../order/packages.ts'

// The poem (歌の添え書き): ONE poem is included free in every order. After the character is chosen the buyer picks a format (the first one
// shown follows the site language: ja → tanka, zh → ci, en → en), the poem is written at once and shown IN FULL before checkout; another
// format can be tried (each one is written once and kept; 2026-11-20: and rewritten up to twice — 「別の歌にする」, every version kept, ‹ 1 / 3 ›, the one on screen is the one ordered). The page keeps only the poem_id: /api/order reads the poem back from the server —
// poem text is never sent by the browser. A poem that cannot be written after two tries is given up politely and the order goes ahead without
// one. While a poem is being written the order button waits (the buyer sees the poem before paying).

type Version = { poemId: string; lines: string[]; reading: string }
type Status = { state: 'loading'; attempt: number } | { state: 'ready'; poemId: string; lines: string[]; reading: string; /** the server's count of rewrites still allowed for this style of this result */ left: number } | { state: 'failed' }
/** The later versions of a style (the first is in `status`), which one is on screen (0 = the first), and a rewrite in flight. */
type Extra = { versions: Version[]; index: number; left: number; rewriting: boolean; failed: boolean }
export type PoemStep = 'loading' | 'ready' | 'none'

type Props = {
  result: EngineResult
  story: string
  followUps: string[]
  candidate: Candidate
  copy: Copy
  language: UiLanguage
  /** The poem_ids to send with the order (zero or one) and whether the step is still working. */
  onChange: (poemIds: string[], step: PoemStep, poem?: { lines: string[]; reading: string; type: PoemType }) => void
  disabled?: boolean
  /** The e-gift has no printed card: the note says the poem is on the gift page and on the card PDF printed at home. */
  egift?: boolean
}

const TRIES = 2
const MAX_REWRITES = 2
const CALL_TIMEOUT_MS = 60_000

export default function PoemAddOn({ result, story, followUps, candidate, copy, language, onChange, disabled, egift = false }: Props) {
  const p = copy.order.poem
  // the formats follow the story's language (spec v9.4): 短歌 / 漢詩 for a Japanese story, 漢詩 / 宋詞 for a Chinese one, free verse for an English one
  const offered = poemTypesFor(language, [story, ...followUps].join('\n'))
  const [selected, setSelected] = useState<PoemType>(defaultPoemType(language, [story, ...followUps].join('\n')))
  const [status, setStatus] = useState<Partial<Record<PoemType, Status>>>({})
  const [extra, setExtra] = useState<Partial<Record<PoemType, Extra>>>({})
  const inflight = useRef<{ type: PoemType; ac: AbortController } | null>(null)
  const started = useRef<Set<PoemType>>(new Set())
  const statusRef = useRef<Partial<Record<PoemType, Status>>>({})
  statusRef.current = status

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
          const data = (await res.json().catch(() => null)) as { poem_id?: string; lines?: string[]; reading?: string; code?: string; rewrites_left?: number } | null
          if (res.ok && data?.poem_id && Array.isArray(data.lines) && data.lines.length > 0) {
            setStatus((s) => ({ ...s, [type]: { state: 'ready', poemId: data.poem_id!, lines: data.lines!, reading: data.reading ?? '', left: typeof data.rewrites_left === 'number' ? data.rewrites_left : MAX_REWRITES } }))
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
    if (prev && prev.type !== selected && statusRef.current[prev.type]?.state === 'loading') {
      // (only a poem that is still being written is dropped; one that is finished stays, so going back to it costs nothing)
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
  const ex = extra[selected]
  // every version of this style: the first, then the rewrites; the one on screen is the one that is ordered (its poem_id)
  const versions: Version[] = st?.state === 'ready' ? [{ poemId: st.poemId, lines: st.lines, reading: st.reading }, ...(ex?.versions ?? [])] : []
  const at = Math.min(ex?.index ?? 0, Math.max(0, versions.length - 1))
  const shown = versions[at]
  const left = st?.state === 'ready' ? (ex?.left ?? st.left) : 0
  const rewriting = ex?.rewriting === true
  // the order button waits while a poem is being written, a rewrite included
  const step: PoemStep = !st || st.state === 'loading' || rewriting ? 'loading' : st.state === 'ready' ? 'ready' : 'none'
  const poemId = shown?.poemId ?? ''
  const shownPoem = shown ? { lines: shown.lines, reading: shown.reading, type: selected } : undefined
  useEffect(() => {
    onChange(poemId ? [poemId] : [], step, shownPoem)
  }, [poemId, step]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 「別の歌にする」: a new poem in the same style for the same character and story. A failure keeps the poem on screen; the limit is the server's. */
  const rewrite = async () => {
    const type = selected
    if (st?.state !== 'ready' || rewriting || left <= 0) return
    setExtra((e) => ({ ...e, [type]: { versions: e[type]?.versions ?? [], index: e[type]?.index ?? 0, left: e[type]?.left ?? st.left, rewriting: true, failed: false } }))
    log('poem_requested', { type, attempt: 1, rewrite: true })
    let done: Version | null = null
    let newLeft = Math.max(0, left - 1)
    let limited = false
    try {
      const res = await fetch('/api/poem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(CALL_TIMEOUT_MS) : undefined,
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
          rewrite: true,
        }),
      })
      const data = (await res.json().catch(() => null)) as { poem_id?: string; lines?: string[]; reading?: string; code?: string; rewrites_left?: number } | null
      if (res.ok && data?.poem_id && Array.isArray(data.lines) && data.lines.length > 0) {
        done = { poemId: data.poem_id, lines: data.lines, reading: data.reading ?? '' }
        if (typeof data.rewrites_left === 'number') newLeft = data.rewrites_left
        log('poem_ready', { type, attempt: 1, rewrite: true })
      } else {
        limited = data?.code === 'rewrite_limit'
        log('poem_failed', { type, attempt: 1, code: data?.code ?? res.status, rewrite: true })
      }
    } catch {
      log('poem_failed', { type, attempt: 1, code: 'network', rewrite: true })
    }
    setExtra((e) => {
      const cur = e[type]
      const list = [...(cur?.versions ?? []), ...(done ? [done] : [])]
      return { ...e, [type]: { versions: list, index: done ? list.length : (cur?.index ?? 0), left: limited ? 0 : done ? newLeft : (cur?.left ?? left), rewriting: false, failed: !done && !limited } }
    })
  }
  const go = (d: number) => setExtra((e) => {
    const cur = e[selected]
    const n = versions.length
    const next = Math.min(Math.max(0, at + d), n - 1)
    return { ...e, [selected]: { versions: cur?.versions ?? [], index: next, left: cur?.left ?? left, rewriting: false, failed: false } }
  })

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
        {offered.map((t) => (
          <label key={t} className={`opt${selected === t ? ' on' : ''}`}>
            <input type="radio" name="poem_type" value={t} data-poem-type={t} checked={selected === t} disabled={disabled} onChange={() => setSelected(t)} />
            <span>{p.types[t]}</span>
          </label>
        ))}
      </div>
      <div className="sent" data-poem-result={selected} data-state={st?.state ?? 'loading'} aria-live="polite">
        {(!st || st.state === 'loading') && <span>{p.loading}</span>}
        {st?.state === 'ready' && shown && (
          <>
            <span className="notranslate" data-poem-full data-poem-id={shown.poemId} data-version={at + 1} style={{ display: 'block', whiteSpace: 'pre-line', lineHeight: 1.9, fontSize: '1.05em' }}>
              {shown.lines.join('\n')}
            </span>
            {shown.reading && (
              <span className="notranslate" data-poem-reading style={{ display: 'block', whiteSpace: 'pre-line', lineHeight: 1.7, fontSize: '0.85em', opacity: 0.75, marginTop: '0.5em' }}>
                {shown.reading}
              </span>
            )}
            <span style={{ display: 'block', marginTop: '0.5em' }}>{egift ? p.printedOnCardEgift : p.printedOnCard}</span>
            {/* 2026-11-20: the quiet link and its count; every version is kept and the one on screen is the one ordered */}
            <span className="poemRewrite" data-testid="poem-rewrite-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.3rem .9rem', marginTop: '.7em', fontSize: '.9em' }}>
              {versions.length > 1 && (
                <span className="poemNav" data-testid="poem-nav" style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}>
                  <button type="button" className="backLink" aria-label={p.prev} data-testid="poem-prev" disabled={disabled || rewriting || at === 0} onClick={() => go(-1)}>‹</button>
                  <span data-testid="poem-position" className="notranslate">{at + 1} / {versions.length}</span>
                  <button type="button" className="backLink" aria-label={p.next} data-testid="poem-next" disabled={disabled || rewriting || at === versions.length - 1} onClick={() => go(1)}>›</button>
                  <span data-testid="poem-use" aria-pressed="true" style={{ color: '#C9A96E', fontWeight: 600 }}>✓ {p.use}</span>
                </span>
              )}
              {left > 0 ? (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '.5rem' }}>
                  <button type="button" className="backLink" data-testid="poem-rewrite" disabled={disabled || rewriting} onClick={() => void rewrite()}>{p.rewrite}</button>
                  <span data-testid="poem-left" style={{ opacity: 0.75 }}>{p.left(left)}</span>
                </span>
              ) : (
                <span data-testid="poem-limit" style={{ opacity: 0.75 }}>{p.limit}</span>
              )}
            </span>
            {ex?.failed && <span role="status" data-testid="poem-rewrite-failed" style={{ display: 'block', marginTop: '.4em' }}>{p.rewriteFailed}</span>}
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
