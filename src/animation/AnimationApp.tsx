import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { COPY, pageLang, type PageCopy } from './copy.ts'
import { FRAME_H, FRAME_W, momentSize, poemSizes, whoSize } from './layout.ts'
import { makeTimeline, type Span, type Timeline } from './timeline.ts'
import type { AnimationView, StrokeData } from './types.ts'
import './animation.css'

// The story animation page /a/<id>: one fixed 30-second film per order, drawn in HTML / SVG / CSS from the data the order already holds
// (engine/animation.ts) and the stroke order of the character (engine/stroke-data.ts). No model call, no per-customer styling. The timing
// is src/animation/timeline.ts; this file only plays it with the Web Animations API (smooth on phones, no JS per frame) and holds the last
// frame. prefers-reduced-motion gets the finished frame as a still.

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;700&family=Noto+Serif+TC:wght@400;600&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap'

const idFromPath = () => window.location.pathname.match(/^\/a\/([A-Za-z0-9-]{3,64})\/?$/)?.[1] ?? null

type Load = { state: 'loading' } | { state: 'error'; kind: 'notFound' | 'unavailable' } | { state: 'ready'; view: AnimationView; strokes: StrokeData | null }

export default function AnimationApp() {
  const id = useMemo(idFromPath, [])
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [lang, setLang] = useState(() => pageLang('ja'))
  const copy = COPY[lang]

  useEffect(() => {
    document.title = COPY[lang].title
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    if (!document.querySelector('link[data-animation-fonts]')) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = FONT_CSS
      l.setAttribute('data-animation-fonts', '')
      document.head.appendChild(l)
    }
    return () => meta.remove()
  }, [lang])

  useEffect(() => {
    if (!id) {
      setLoad({ state: 'error', kind: 'notFound' })
      return
    }
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`/api/animation/${id}`, { signal: ac.signal })
        if (res.status === 404) return setLoad({ state: 'error', kind: 'notFound' })
        if (!res.ok) return setLoad({ state: 'error', kind: 'unavailable' })
        const view = (await res.json()) as AnimationView
        setLang(pageLang(view.language))
        let strokes: StrokeData | null = null
        try {
          const s = await fetch(`/api/strokes?c=${encodeURIComponent(view.glyph)}&script=${view.script}`, { signal: ac.signal })
          if (s.ok) strokes = (await s.json()) as StrokeData
        } catch {
          if (ac.signal.aborted) return
        }
        setLoad({ state: 'ready', view, strokes })
      } catch {
        if (!ac.signal.aborted) setLoad({ state: 'error', kind: 'unavailable' })
      }
    })()
    return () => ac.abort()
  }, [id])

  return (
    <main className={`an-page${load.state === 'ready' && load.view.memorial ? ' an-memorial' : ''}`} data-testid="animation-page" lang={lang}>
      {load.state === 'loading' && <p className="an-note">{copy.loading}</p>}
      {load.state === 'error' && (
        <p className="an-note" role="alert" data-testid="animation-error">
          {load.kind === 'notFound' ? copy.notFound : copy.unavailable}
        </p>
      )}
      {load.state === 'ready' && <Film view={load.view} strokes={load.strokes} copy={copy} />}
    </main>
  )
}

function Film({ view, strokes, copy }: { view: AnimationView; strokes: StrokeData | null; copy: PageCopy }) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const strokeEls = useRef<(SVGPathElement | null)[]>([])
  const [u, setU] = useState(3.6) // px per frame unit (the frame is 100 units wide)
  const [lengths, setLengths] = useState<number[] | null | undefined>(strokes && strokes.strokes.length > 0 ? undefined : null)
  const [playKey, setPlayKey] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [forcePlay, setForcePlay] = useState(false)
  const [ended, setEnded] = useState(false)
  const [toast, setToast] = useState('')
  // a browser without the Web Animations API (very old phones) gets the finished frame as a still, like reduced motion
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
  const still = (reducedMotion && !forcePlay) || !canAnimate

  // the frame fits the screen: as large as a 9:16 box can be in the space above the buttons
  useLayoutEffect(() => {
    const fit = () => {
      const el = wrap.current
      if (!el) return
      const w = el.clientWidth
      const h = el.clientHeight
      setU(Math.max(1.5, Math.min(w / FRAME_W, h / FRAME_H)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (wrap.current) ro.observe(wrap.current)
    window.addEventListener('orientationchange', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', fit)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReducedMotion(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  // stroke lengths decide how long each stroke takes: measure them once the paths are in the page
  useLayoutEffect(() => {
    if (lengths !== undefined || !strokes) return
    setLengths(strokeEls.current.slice(0, strokes.strokes.length).map((p) => (p ? p.getTotalLength() : 1)))
  }, [lengths, strokes])

  const poem = view.poem
  const timeline: Timeline | null = useMemo(() => {
    if (lengths === undefined) return null
    return makeTimeline({ memorial: view.memorial, poemLines: poem ? poem.lines.length : 0, poemNotes: !!poem && poem.notes.length > 0, strokeLengths: lengths })
  }, [lengths, view.memorial, poem])

  const sizes = useMemo(() => (poem ? poemSizes(poem.lines, poem.lineAids, poem.notes) : null), [poem])
  const momentFs = useMemo(() => momentSize(view.moment), [view.moment])
  const whoFs = useMemo(() => whoSize(view.who), [view.who])

  // play the film
  useEffect(() => {
    const root = stage.current
    if (!root || !timeline || still) return
    let cancelled = false
    const anims: Animation[] = []
    setEnded(false)
    const q = (sel: string) => Array.from(root.querySelectorAll<HTMLElement | SVGElement>(sel))
    const one = (sel: string) => root.querySelector<HTMLElement | SVGElement>(sel)
    const run = (el: Element | null | undefined, keyframes: Keyframe[], span: Span, opts: KeyframeAnimationOptions = {}) => {
      if (!el) return
      anims.push(el.animate(keyframes, { delay: span.start * 1000, duration: Math.max((span.end - span.start) * 1000, 1), fill: 'both', easing: 'ease-out', ...opts }))
    }
    const rise = [{ opacity: 0, transform: 'translateY(1.2em)' }, { opacity: 1, transform: 'translateY(0)' }]
    const fade = [{ opacity: 0 }, { opacity: 1 }]

    const go = () => {
      if (cancelled) return
      run(one('[data-fx="moment"]'), rise, timeline.moment.in)
      run(one('[data-fx="moment"]'), [{ opacity: 1 }, { opacity: 0 }], timeline.moment.out, { fill: 'forwards', easing: 'ease-in' })
      if (strokes && strokes.strokes.length > 0) {
        q('[data-fx="stroke"]').forEach((el, i) => {
          const span = timeline.glyph.strokes[i]
          if (!span) return
          run(el, [{ strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0.97, opacity: 1, offset: 0.03 }, { strokeDashoffset: 0, opacity: 1 }], span, { easing: 'cubic-bezier(.45,.05,.35,1)' })
        })
      } else {
        run(one('[data-fx="glyph-ink"]'), [{ opacity: 0, filter: 'blur(14px)' }, { opacity: 1, filter: 'blur(0px)' }], timeline.glyph.write, { easing: 'ease-in-out' })
      }
      if (timeline.glyphMove) {
        run(one('[data-fx="glyph-wrap"]'), [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-62.9%) scale(0.42)' }], timeline.glyphMove, { easing: 'cubic-bezier(.5,0,.2,1)' })
      }
      if (timeline.reading) run(one('[data-fx="reading"]'), rise, timeline.reading)
      q('[data-fx="pline"]').forEach((el, i) => run(el, rise, timeline.poemLines[i] ?? timeline.poemLines[timeline.poemLines.length - 1], { easing: 'ease-out' }))
      if (timeline.poemNotes) run(one('[data-fx="notes"]'), fade, timeline.poemNotes)
      run(one('[data-fx="who"]'), rise, timeline.who)
      if (timeline.memorial) run(one('[data-fx="seal"]'), [{ opacity: 0 }, { opacity: 0.55 }], timeline.seal, { easing: 'ease-in-out' })
      else
        run(
          one('[data-fx="seal"]'),
          [
            { opacity: 0, transform: 'scale(1.9) rotate(-7deg)' },
            { opacity: 1, transform: 'scale(0.94) rotate(0deg)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1) rotate(0deg)' },
          ],
          timeline.seal,
          { easing: 'cubic-bezier(.2,.8,.3,1)' },
        )
      // the end: the frame holds (fill: both keeps the last keyframe)
      const last = anims.reduce<Animation | null>((a, b) => (!a || (b.effect?.getComputedTiming().endTime ?? 0) > (a.effect?.getComputedTiming().endTime ?? 0) ? b : a), null)
      void last?.finished.then(() => !cancelled && setEnded(true)).catch(() => {})
    }

    // wait for the fonts (a short moment at most), so the lines do not jump while they appear
    const ready = document.fonts?.ready ?? Promise.resolve()
    void Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).then(go)

    const onVisibility = () => anims.forEach((a) => (document.hidden ? a.pause() : a.play()))
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      anims.forEach((a) => a.cancel())
    }
  }, [timeline, strokes, still, playKey])

  const share = useCallback(async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: copy.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setToast(copy.copied)
        setTimeout(() => setToast(''), 2400)
      }
    } catch {
      // the share sheet was dismissed
    }
  }, [copy])

  const q = copy.quote
  const poemMain = poem ? sizes!.fs : 0
  return (
    <>
      <div className="an-wrap" ref={wrap}>
        <div
          ref={stage}
          className={`an-stage${view.memorial ? ' an-memorial' : ''}${still ? ' an-still' : ''}${poem ? ' an-haspoem' : ' an-nopoem'}${view.poem?.type === 'en' ? ' an-poem-en' : ''}`}
          style={{ ['--u' as string]: `${u}px`, width: `${u * FRAME_W}px`, height: `${u * FRAME_H}px` }}
          role="img"
          aria-label={copy.alt}
          data-testid="animation-stage"
          data-duration={timeline?.total ?? ''}
          data-ended={ended ? 'yes' : 'no'}
          data-memorial={view.memorial ? 'yes' : 'no'}
        >
          <div className="an-paper" aria-hidden="true" />
          <p className="an-moment an-fx" data-fx="moment" data-testid="animation-moment" style={{ fontSize: `calc(var(--u) * ${momentFs})` }}>
            {q[0]}
            {view.moment}
            {q[1]}
          </p>

          <div className="an-glyph-wrap an-fx-wrap" data-fx="glyph-wrap">
            <svg
              className="an-glyph"
              viewBox={strokes ? `0 0 ${strokes.box} ${strokes.box}` : '0 0 100 100'}
              aria-hidden="true"
              data-testid="animation-glyph"
              data-source={strokes?.source ?? 'ink'}
              data-strokes={strokes?.strokes.length ?? 0}
            >
              {strokes?.source === 'kanjivg' && (
                <g fill="none" stroke="currentColor" strokeWidth={5.8} strokeLinecap="round" strokeLinejoin="round">
                  {strokes.strokes.map((s, i) => (
                    <path key={i} d={s.d} ref={(el) => void (strokeEls.current[i] = el)} className="an-stroke an-fx" data-fx="stroke" pathLength={1} strokeDasharray="1 1" />
                  ))}
                </g>
              )}
              {strokes?.source === 'hanzi' && (
                <g transform={strokes.flip}>
                  <defs>
                    {strokes.strokes.map((s, i) => (
                      <clipPath key={i} id={`an-clip-${i}`}>
                        <path d={s.d} />
                      </clipPath>
                    ))}
                  </defs>
                  {strokes.strokes.map((s, i) => (
                    <g key={i} clipPath={`url(#an-clip-${i})`}>
                      <path
                        d={s.median}
                        ref={(el) => void (strokeEls.current[i] = el)}
                        className="an-stroke an-fx"
                        data-fx="stroke"
                        pathLength={1}
                        strokeDasharray="1 1"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={170}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  ))}
                </g>
              )}
              {!strokes && (
                <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="86" fill="currentColor" className="an-ink an-fx" data-fx="glyph-ink">
                  {view.glyph}
                </text>
              )}
            </svg>
          </div>

          {!poem && (
            <div className="an-reading an-fx" data-fx="reading" data-testid="animation-reading">
              <span className="an-reading-main">{view.reading}</span>
              {view.language === 'en' && view.meaning_en ? <span className="an-reading-sub">{view.meaning_en}</span> : null}
            </div>
          )}

          {poem && sizes && (
            <div className="an-poem" data-testid="animation-poem" data-type={poem.type} style={{ fontSize: `calc(var(--u) * ${poemMain})` }}>
              {poem.lines.map((line, i) => (
                <div key={i} className="an-pline an-fx" data-fx="pline">
                  <span className="an-pline-main">{line}</span>
                  {poem.lineAids[i] ? <span className="an-pline-aid" style={{ fontSize: `calc(var(--u) * ${sizes.aid})` }}>{poem.lineAids[i]}</span> : null}
                </div>
              ))}
              {poem.notes.length > 0 && (
                <div className="an-notes an-fx" data-fx="notes" style={{ fontSize: `calc(var(--u) * ${sizes.note})` }}>
                  {poem.notes.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="an-who an-fx" data-fx="who" data-testid="animation-who" style={{ fontSize: `calc(var(--u) * ${whoFs})` }}>
            {view.who}
          </p>
          <div className="an-seal an-fx" data-fx="seal" data-testid="animation-seal" aria-hidden="true">
            {copy.sealText.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="an-controls">
        {reducedMotion && !forcePlay && canAnimate && (
          <p className="an-note an-small" data-testid="animation-reduced">
            {copy.reducedNote}{' '}
            <button type="button" className="an-btn" onClick={() => setForcePlay(true)}>
              {copy.playAnyway}
            </button>
          </p>
        )}
        <div className="an-buttons">
          <button type="button" className={`an-btn${ended ? ' an-btn-hot' : ''}`} onClick={() => (forcePlay || !reducedMotion ? setPlayKey((k) => k + 1) : setForcePlay(true))} data-testid="animation-replay">
            {copy.replay}
          </button>
          <button type="button" className="an-btn" onClick={share} data-testid="animation-share">
            {copy.share}
          </button>
          <a className="an-btn" href="/credits" data-testid="animation-credits-link">
            {copy.credits}
          </a>
        </div>
        <p className="an-toast" role="status">
          {toast}
        </p>
      </div>
    </>
  )
}
