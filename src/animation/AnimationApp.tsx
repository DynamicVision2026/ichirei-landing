import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { COPY, pageLang, type PageCopy } from './copy.ts'
import { clamp, frameAt, makeFilmTimeline, phrases, type FilmTimeline } from './film.ts'
import type { AnimationView } from './types.ts'
import './animation.css'

// The story film page /a/<id>: a 30-second film that RETELLS the customer's own story in four short scenes and ends with the chosen character as
// the answer. Fixed template, the same for every order; the script (four lines, four picture descriptions) was written once when the order was made and
// the four pictures were drawn once, on the first open (POST /api/film/<id>/render) — both are saved, nothing is generated when the film is played. The timing and every frame's maths are src/animation/film.ts; this file draws them.
// prefers-reduced-motion gets a still page (the four scenes, then the character). While the script or the pictures are still being made the page waits quietly.

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;700;900&family=Noto+Serif+JP:wght@300;400;600&family=Noto+Serif+TC:wght@400;600;900&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400&display=swap'

const idFromPath = () => window.location.pathname.match(/^\/a\/([A-Za-z0-9-]{3,64})\/?$/)?.[1] ?? null

type Load = { state: 'loading' } | { state: 'error'; kind: 'notFound' | 'unavailable' } | { state: 'ready'; view: AnimationView }

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

  // fetch the view; while the script is still being written ask again every few seconds
  useEffect(() => {
    if (!id) {
      setLoad({ state: 'error', kind: 'notFound' })
      return
    }
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = async () => {
      try {
        const res = await fetch(`/api/animation/${id}`, { signal: ac.signal })
        if (res.status === 404) return setLoad({ state: 'error', kind: 'notFound' })
        if (!res.ok) return setLoad({ state: 'error', kind: 'unavailable' })
        const view = (await res.json()) as AnimationView
        setLang(pageLang(view.language))
        setLoad({ state: 'ready', view })
        if (!view.film) timer = setTimeout(go, 3000)
      } catch {
        if (!ac.signal.aborted) setLoad({ state: 'error', kind: 'unavailable' })
      }
    }
    void go()
    return () => {
      ac.abort()
      if (timer) clearTimeout(timer)
    }
  }, [id])

  // the script is there but the pictures are not drawn yet: this is the first open — ask for them. The request stays open until they are done
  // (the server holds it so Cloud Run keeps the CPU); "pending" means ask again. Two opens draw one set (the server's lock).
  const needsPictures = load.state === 'ready' && !!load.view.film && load.view.film.pictures === null && !load.view.film.deferred
  useEffect(() => {
    if (!needsPictures || !id) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = async () => {
      try {
        const res = await fetch(`/api/film/${id}/render`, { method: 'POST', signal: ac.signal })
        if (!res.ok) {
          timer = setTimeout(go, 5000)
          return
        }
        const j = (await res.json()) as { state: string; view: AnimationView }
        setLoad({ state: 'ready', view: j.view })
        if (j.state === 'pending') timer = setTimeout(go, 3000)
      } catch {
        if (!ac.signal.aborted) timer = setTimeout(go, 5000)
      }
    }
    void go()
    return () => {
      ac.abort()
      if (timer) clearTimeout(timer)
    }
  }, [needsPictures, id])

  return (
    <main className={`an-page${load.state === 'ready' && load.view.memorial ? ' an-memorial' : ''}`} data-testid="animation-page" lang={lang}>
      {load.state === 'loading' && <p className="an-note">{copy.loading}</p>}
      {load.state === 'error' && (
        <p className="an-note" role="alert" data-testid="animation-error">
          {load.kind === 'notFound' ? copy.notFound : copy.unavailable}
        </p>
      )}
      {load.state === 'ready' && !load.view.film?.pictures && !load.view.film?.deferred && (
        <p className="an-note an-preparing" role="status" data-testid="animation-preparing">
          {copy.preparing}
          <span className="an-dots" aria-hidden="true" />
        </p>
      )}
      {load.state === 'ready' && load.view.film?.deferred && !load.view.film.pictures && (
        <p className="an-note" role="status" data-testid="animation-deferred">
          {copy.deferred}
        </p>
      )}
      {load.state === 'ready' && load.view.film?.pictures && <Film key={load.view.id} view={load.view} film={{ ...load.view.film, pictures: load.view.film.pictures }} copy={copy} />}
    </main>
  )
}

/** The character's reading under it: the kana reading (ja), the pinyin (zh), the romanization and meaning (en: a reader of English cannot read kana). */
function readingLine(view: AnimationView): string {
  if (view.language === 'en') return [view.romanization.split(' / ')[0], view.meaning_en].filter(Boolean).join(' · ')
  return view.reading
}

type ReadyFilm = Omit<NonNullable<AnimationView['film']>, 'pictures'> & { pictures: string[] }

function Film({ view, film, copy }: { view: AnimationView; film: ReadyFilm; copy: PageCopy }) {
  const wrap = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [u, setU] = useState(3.6) // px per unit: the frame is 100 units wide
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [clock, setClock] = useState(0) // seconds, for the still / progress label only
  const [toast, setToast] = useState('')
  const reducedAtStart = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const [forcePlay, setForcePlay] = useState(false)
  const still = reducedAtStart && !forcePlay

  const tl: FilmTimeline = useMemo(() => makeFilmTimeline(film.lines.length, view.memorial), [film.lines.length, view.memorial])
  const t = useRef(0)
  const raf = useRef(0)
  const last = useRef(0)

  // the frame is as large as a 9:16 box can be in the space above the buttons
  useLayoutEffect(() => {
    const fit = () => {
      const el = wrap.current
      if (!el) return
      setU(Math.max(1.5, Math.min(el.clientWidth / 100, el.clientHeight / 177.78)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (wrap.current) ro.observe(wrap.current)
    window.addEventListener('orientationchange', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', fit)
    }
  }, [still])

  // pictures and fonts first (a few seconds at most), so the film does not stutter at its start
  useEffect(() => {
    let alive = true
    const imgs = film.pictures.map((s) => new Promise<void>((res) => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = s }))
    const fonts = document.fonts?.ready ?? Promise.resolve()
    void Promise.race([Promise.all([...imgs, fonts]), new Promise((r) => setTimeout(r, 4000))]).then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [film.pictures])

  /** Apply the frame at time `sec` (direct style writes, like the hand-made reference: smooth and cheap on a phone). */
  const render = useCallback(
    (sec: number) => {
      const root = frame.current
      if (!root) return
      const f = frameAt(sec, tl, film.lines)
      root.querySelectorAll<HTMLElement>('[data-scene]').forEach((el, i) => {
        const s = f.scenes[i]
        if (!s) return
        el.style.opacity = String(s.opacity)
        const img = el.querySelector<HTMLElement>('.an-art img')
        if (img) img.style.transform = reducedAtStart && !forcePlay ? 'none' : `scale(${1.02 + 0.08 * s.progress}) translateY(${-6 * s.progress}px)`
        el.querySelectorAll<HTMLElement>('[data-phrase]').forEach((p, j) => {
          const k = s.phrases[j] ?? 0
          p.style.opacity = String(k)
          p.style.transform = `translateY(${6 * (1 - k)}px)`
        })
      })
      const fin = root.querySelector<HTMLElement>('[data-final]')
      if (fin) fin.style.opacity = String(f.final.opacity)
      const kanji = root.querySelector<HTMLElement>('[data-kanji]')
      if (kanji) {
        const pos = `0 ${100 - f.final.reveal * 100}%`
        kanji.style.setProperty('-webkit-mask-position', pos)
        kanji.style.setProperty('mask-position', pos)
        kanji.style.filter = `blur(${(1 - f.final.reveal) * 2.5}px)`
      }
      const set = (sel: string, v: number) => {
        const el = root.querySelector<HTMLElement>(sel)
        if (el) el.style.opacity = String(v)
      }
      set('[data-reading]', f.final.reading)
      set('[data-who]', f.final.who)
      set('[data-seal]', f.final.seal)
      const bar = root.querySelector<HTMLElement>('[data-progress]')
      if (bar) bar.style.width = `${f.progress * 100}%`
    },
    [tl, film.lines, reducedAtStart, forcePlay],
  )

  const tick = useCallback(
    (now: number) => {
      t.current = Math.min(tl.total, t.current + (now - last.current) / 1000)
      last.current = now
      render(t.current)
      if (t.current >= tl.total) {
        setPlaying(false)
        setClock(tl.total)
        return
      }
      raf.current = requestAnimationFrame(tick)
    },
    [render, tl.total],
  )
  const play = useCallback(() => {
    if (t.current >= tl.total) t.current = 0
    last.current = performance.now()
    setPlaying(true)
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
  }, [tick, tl.total])
  const pause = useCallback(() => {
    cancelAnimationFrame(raf.current)
    setPlaying(false)
    setClock(t.current)
  }, [])
  const replay = useCallback(() => {
    t.current = 0
    render(0)
    play()
  }, [play, render])

  // start by itself (nothing to tap); a still page shows the last frame
  useEffect(() => {
    if (!ready) return
    if (still) {
      render(tl.total)
      return
    }
    render(0)
    play()
    return () => cancelAnimationFrame(raf.current)
  }, [ready, still, tl.total]) // eslint-disable-line react-hooks/exhaustive-deps

  // the film stops while the tab is hidden
  useEffect(() => {
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf.current) : playing && (last.current = performance.now(), (raf.current = requestAnimationFrame(tick))))
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [playing, tick])

  // a seam for the tests: seek to a moment, play, pause (nothing else uses it)
  useEffect(() => {
    ;(window as unknown as { __ichireiFilm?: unknown }).__ichireiFilm = {
      seek: (s: number) => { cancelAnimationFrame(raf.current); setPlaying(false); t.current = clamp(s, 0, tl.total); render(t.current) },
      play,
      pause,
      get time() { return t.current },
      total: tl.total,
    }
    return () => { delete (window as unknown as { __ichireiFilm?: unknown }).__ichireiFilm }
  }, [play, pause, render, tl.total])

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

  const [q0, q1] = copy.quote
  void q0
  void q1
  const ended = !playing && t.current >= tl.total - 0.001
  void clock
  const body = (
    <>
      {film.lines.map((line, i) => (
        <div className="an-scene" data-scene={i} data-picture={film.pictures[i]} key={i}>
          <div className="an-art">
            <img src={film.pictures[i]} alt="" decoding="async" draggable={false} />
          </div>
          <p className="an-line" data-testid="film-line">
            {phrases(line).map((p, j) => (
              <span key={j} data-phrase={j}>
                {renderPhrase(p)}
              </span>
            ))}
          </p>
        </div>
      ))}
      <div className="an-final" data-final>
        <div className="an-kanji notranslate" translate="no" data-kanji data-testid="film-kanji">
          {view.glyph}
        </div>
        <div className="an-reading notranslate" translate="no" data-reading data-testid="film-reading">
          {readingLine(view)}
        </div>
        <div className="an-who" data-who data-testid="film-who">
          {phrases(view.who).map((p, i) => (
            <span key={i}>{p}</span>
          ))}
        </div>
        <div className="an-seal" data-seal data-testid="film-seal" aria-hidden="true">
          <b>{copy.sealText.join('')}</b>
          <small>ICHIREI</small>
        </div>
      </div>
      <div className="an-progress" data-progress />
    </>
  )

  return (
    <>
      <div className={`an-wrap${still ? ' an-wrap-still' : ''}`} ref={wrap}>
        {still ? (
          <div className={`an-still-page${view.memorial ? ' an-memorial' : ''}`} style={{ ['--u' as string]: '3.6px' }} data-testid="film-still">
            {film.lines.map((line, i) => (
              <section className="an-still-scene" key={i}>
                <div className="an-art"><img src={film.pictures[i]} alt="" decoding="async" /></div>
                <p className="an-line an-line-still">{phrases(line).map((p, j) => <span key={j} style={{ opacity: 1 }}>{renderPhrase(p)}</span>)}</p>
              </section>
            ))}
            <section className="an-still-final">
              <div className="an-kanji an-kanji-still notranslate" translate="no" data-testid="film-kanji">{view.glyph}</div>
              <div className="an-reading an-reading-still notranslate" translate="no">{readingLine(view)}</div>
              <div className="an-who an-who-still">{phrases(view.who).map((p, i) => <span key={i}>{p}</span>)}</div>
              <div className="an-seal an-seal-still"><b>{copy.sealText.join('')}</b><small>ICHIREI</small></div>
            </section>
          </div>
        ) : (
          <div
            ref={frame}
            className={`an-film${view.memorial ? ' an-memorial' : ''}`}
            style={{ ['--u' as string]: `${u}px`, width: `${u * 100}px`, height: `${u * 177.78}px` }}
            role="img"
            aria-label={copy.alt}
            translate="no"
            data-testid="film"
            data-duration={tl.total}
            data-pictures={film.pictures.join(',')}
            data-status={film.status}
            data-memorial={view.memorial ? 'yes' : 'no'}
            data-ready={ready ? 'yes' : 'no'}
            data-ended={ended ? 'yes' : 'no'}
            onClick={() => (playing ? pause() : play())}
          >
            {body}
          </div>
        )}
      </div>

      <div className="an-controls">
        {still && (
          <p className="an-note an-small" data-testid="animation-reduced">
            {copy.reducedNote}{' '}
            <button type="button" className="an-btn" onClick={() => setForcePlay(true)}>
              {copy.playAnyway}
            </button>
          </p>
        )}
        <div className="an-buttons">
          {!still && (
            <button type="button" className="an-btn" onClick={() => (playing ? pause() : play())} data-testid="animation-play">
              {playing ? copy.pause : copy.play}
            </button>
          )}
          <button type="button" className={`an-btn${ended ? ' an-btn-hot' : ''}`} onClick={() => (still ? setForcePlay(true) : replay())} data-testid="animation-replay">
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

/** A phrase with its quotation (「…」 or “…”) set in gold, as in the reference film. */
function renderPhrase(p: string) {
  const parts = p.split(/(「[^」]*」|『[^』]*』|“[^”]*”)/g).filter((x) => x !== '')
  return parts.map((x, i) => (/^(「|『|“)/.test(x) ? <span className="an-q" key={i}>{x}</span> : x))
}
