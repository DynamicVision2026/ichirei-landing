import { inkOnly } from '../order/memorial.ts'
import { cleanReading } from '../order/reading.ts'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { COPY, pageLang, type PageCopy } from './copy.ts'
import { clamp, frameAt, makeFilmTimeline, phrases, type FilmTimeline } from '../order/film-timeline.ts'
import { CARD_ASPECT, CARD_RISE_U, CARD_WIDTH, cardLayout, isVerticalPoemType } from '../order/film-card.ts'
import { musicGain } from '../order/film-music.ts'
import type { AnimationView } from './types.ts'
import BuyerPage from './BuyerPage.tsx'
import { BUYER_COPY } from './buyer-copy.ts'
import '../fonts.css'
import './animation.css'

// The story film page /a/<id>: a 34-second film (41 s for a remembrance) that RETELLS the customer's own story in four short scenes and ends with the chosen character as
// the answer, on a paper e-card with its reading, the poem and a small seal. Fixed template, the same for every order; the script (four lines, four picture descriptions) was written once when the order was made and
// the four pictures were drawn once, on the first open (POST /api/film/<id>/render) — both are saved, nothing is generated when the film is played. The timing and every frame's maths are src/order/film-timeline.ts; this file draws them.
// prefers-reduced-motion gets a still page (the four scenes, then the character). While the script or the pictures are still being made the page waits quietly.


/** /a/<id> is the sender's private page (the receiver's gift page /g/<token> is src/gift/GiftApp.tsx). */
const routeFromPath = (): { id: string } | null => {
  const a = window.location.pathname.match(/^\/a\/([A-Za-z0-9-]{3,64})\/?$/)?.[1]
  return a ? { id: a } : null
}

type Load = { state: 'loading' } | { state: 'error'; kind: 'notFound' | 'unavailable' | 'gone' } | { state: 'ready'; view: AnimationView }

export default function AnimationApp() {
  const route = useMemo(routeFromPath, [])
  const id = route?.id ?? null
  const viewUrl = `/api/animation/${id}`
  const renderUrl = `/api/film/${id}/render`
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [lang, setLang] = useState(() => pageLang('ja'))
  const copy = COPY[lang]

  // a real order's page (the view carries the gift) is the buyer's welcome page; the reserved sample films have none and stay a film
  const buyer = load.state === 'ready' && !!load.view.gift
  useEffect(() => {
    document.title = buyer ? BUYER_COPY[lang].title : COPY[lang].title
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [lang, buyer])

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
        const res = await fetch(viewUrl, { signal: ac.signal })
        if (res.status === 404) return setLoad({ state: 'error', kind: 'notFound' })
        if (res.status === 410) {
          // a cancelled order: the page says only that the gift is no longer available
          const j = (await res.json().catch(() => ({}))) as { language?: AnimationView['language'] }
          if (j.language) setLang(pageLang(j.language))
          return setLoad({ state: 'error', kind: 'gone' })
        }
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
  }, [id, viewUrl])

  // the script is there but the pictures are not drawn yet (the first open), or some could not be drawn earlier (quota or an outage): ask the server.
  // The request stays open until it is done (the server holds it so Cloud Run keeps the CPU); "pending" means ask again. An incomplete film PLAYS
  // meanwhile (washi where a picture is missing) and the missing pictures replace the washi when they arrive. Two opens draw one set (the server's lock).
  const film0 = load.state === 'ready' ? load.view.film : null
  const needsPictures = !!film0 && ((film0.pictures === null && !film0.deferred) || film0.incomplete === true)
  useEffect(() => {
    if (!needsPictures || !id) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = async () => {
      try {
        const res = await fetch(renderUrl, { method: 'POST', signal: ac.signal })
        if (!res.ok) {
          timer = setTimeout(go, 5000)
          return
        }
        const j = (await res.json()) as { state: string; view: AnimationView }
        // never take pictures away from a film that is already playing
        setLoad((cur) => (cur.state === 'ready' && cur.view.film?.pictures && !j.view.film?.pictures ? cur : { state: 'ready', view: j.view }))
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
  }, [needsPictures, id, renderUrl])

  // the buyer's welcome page (/a/<id> of an order): no film here — the film plays in the preview of what the receiver sees; its pictures are still drawn on this first open
  if (load.state === 'ready' && load.view.gift)
    return (
      <main className={`an-page an-buyer${inkOnly(load.view) ? ' an-memorial' : ''}`} data-testid="animation-page" lang={lang}>
        <BuyerPage view={load.view} lang={lang} preparing={copy.preparing} onCollected={() => setLoad((cur) => (cur.state === 'ready' ? { state: 'ready', view: { ...cur.view, order: cur.view.order ? { ...cur.view.order, collected: true } : cur.view.order } } : cur))} />
      </main>
    )
  return (
    <main className="an-page" data-testid="animation-page" lang={lang}>
      {load.state === 'loading' && <p className="an-note">{copy.loading}</p>}
      {load.state === 'error' && (
        <p className="an-note" role="alert" data-testid="animation-error">
          {load.kind === 'notFound' ? copy.notFound : load.kind === 'gone' ? BUYER_COPY[lang].gone : copy.unavailable}
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
      {load.state === 'ready' && load.view.film?.pictures && (
        <section>
          <Film key={load.view.id} view={load.view} film={{ ...load.view.film, pictures: load.view.film.pictures }} copy={copy} />
        </section>
      )}
    </main>
  )
}

/** The page plays the last 45 s (or less) of the piece, so the film starts that far in: the piece ENDS where the film ends (its last chord under the e-card). */
const musicOffset = (au: HTMLAudioElement, total: number): number => (Number.isFinite(au.duration) ? Math.max(0, au.duration - total) : 0)

/** The character's reading under it: the kana reading (ja), the pinyin (zh), the romanization and meaning (en: a reader of English cannot read kana). */
function readingLine(view: AnimationView): string {
  if (view.language === 'en') return [cleanReading(view.romanization.split(' / ')[0]), view.meaning_en].filter(Boolean).join(' · ')
  return cleanReading(view.reading)
}

type ReadyFilm = Omit<NonNullable<AnimationView['film']>, 'pictures'> & { pictures: string[] }

/** `giftMode` (the receiver's page): no share button, and `onEnd` is called once when the film has played to its end. */
export function Film({ view, film, copy, giftMode = false, onEnd }: { view: AnimationView; film: ReadyFilm; copy: PageCopy; giftMode?: boolean; onEnd?: () => void }) {
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
  // quiet music under the film (public/music): the film starts muted (a phone blocks sound before a tap); the sound button turns it on; the choice is kept for this session only
  const audio = useRef<HTMLAudioElement>(null)
  const readSound = (): boolean => {
    try { return sessionStorage.getItem('ichirei-film-sound') === 'on' } catch { return false }
  }
  const [sound, setSound] = useState(false)
  const soundWanted = useRef(readSound())
  const poemLines = useMemo(() => (view.poem?.lines ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean), [view.poem])

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
      const f = frameAt(sec, tl, film.lines, poemLines.length)
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
      // the e-card: it settles (fade and a 12 px rise), then its parts come one after another
      const card = root.querySelector<HTMLElement>('[data-card]')
      if (card) {
        card.style.opacity = String(f.card.opacity)
        card.style.transform = `translateY(calc(var(--u) * ${(CARD_RISE_U * (1 - f.card.rise)).toFixed(3)}))`
      }
      set('[data-card-reading]', f.card.reading)
      set('[data-card-rule]', f.card.rule)
      set('[data-card-who]', f.card.who)
      set('[data-card-seal]', f.card.seal)
      root.querySelectorAll<HTMLElement>('[data-card-line]').forEach((el, i) => { el.style.opacity = String(f.card.poem[i] ?? 0) })
      set('[data-black]', f.black)
      // a quiet film's light frame turns to the dark ink frame as the card comes
      if (root.dataset.quiet === 'yes') {
        const k = f.frameDark
        const mix = (a: number, b: number) => Math.round(a + (b - a) * k)
        root.style.setProperty('--frame', `rgb(${mix(207, 26)}, ${mix(198, 20)}, ${mix(177, 16)})`)
      }
      // the music follows the picture's clock: its volume is the fade in and the fade out; a drift of more than a third of a second is corrected
      const au = audio.current
      if (au) {
        au.volume = clamp(musicGain(sec, tl.total))
        if (!au.paused && Math.abs(au.currentTime - (musicOffset(au, tl.total) + sec)) > 0.35) au.currentTime = Math.min(musicOffset(au, tl.total) + sec, Math.max(0, (au.duration || tl.total) - 0.02))
      }
      const bar = root.querySelector<HTMLElement>('[data-progress]')
      if (bar) bar.style.width = `${f.progress * 100}%`
    },
    [tl, film.lines, reducedAtStart, forcePlay, poemLines.length],
  )

  const tick = useCallback(
    (now: number) => {
      t.current = Math.min(tl.total, t.current + (now - last.current) / 1000)
      last.current = now
      render(t.current)
      if (t.current >= tl.total) {
        setPlaying(false)
        setClock(tl.total)
        audio.current?.pause()
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
    const au = audio.current
    if (au) {
      try { au.currentTime = Math.min(musicOffset(au, tl.total) + t.current, Math.max(0, (au.duration || tl.total) - 0.02)) } catch { /* not loaded yet: it is set when the file's length is known */ }
      au.muted = !soundWanted.current
      // a muted film may start by itself; if the phone refuses sound without a tap it simply stays muted
      void au.play().catch(() => { au.muted = true; soundWanted.current = false; setSound(false) })
      if (soundWanted.current) setSound(true)
    }
  }, [tick, tl.total])
  const pause = useCallback(() => {
    cancelAnimationFrame(raf.current)
    setPlaying(false)
    setClock(t.current)
    audio.current?.pause()
  }, [])
  const toggleSound = useCallback(() => {
    const au = audio.current
    const next = !soundWanted.current
    soundWanted.current = next
    setSound(next)
    try { sessionStorage.setItem('ichirei-film-sound', next ? 'on' : 'off') } catch { /* the choice is simply not kept */ }
    if (!au) return
    au.muted = !next
    if (next && playing) void au.play().catch(() => { au.muted = true; soundWanted.current = false; setSound(false) })
  }, [playing])
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
      seek: (s: number) => { cancelAnimationFrame(raf.current); setPlaying(false); audio.current?.pause(); t.current = clamp(s, 0, tl.total); render(t.current); setClock(t.current) },
      play,
      pause,
      get time() { return t.current },
      get muted() { return audio.current?.muted ?? true },
      total: tl.total,
    }
    return () => { delete (window as unknown as { __ichireiFilm?: unknown }).__ichireiFilm }
  }, [play, pause, render, tl.total])

  const share = useCallback(async () => {
    // the sender's page shares the RECEIVER's link (never its own); the receiver's page and the samples share their own address
    const url = view.gift?.url ?? window.location.href
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
  }, [copy, view.gift?.url])

  const [q0, q1] = copy.quote
  void q0
  void q1
  const ended = !playing && t.current >= tl.total - 0.001
  void clock
  const endedOnce = useRef(false)
  useEffect(() => {
    if (ended && !endedOnce.current) {
      endedOnce.current = true
      onEnd?.()
    }
  }, [ended, onEnd])
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
      </div>
      <EndCard view={view} copy={copy} poemLines={poemLines} />
      <div className="an-black" data-black />
      {view.music && <button type="button" className="an-sound" data-testid="film-sound" aria-pressed={sound} onClick={(e) => { e.stopPropagation(); toggleSound() }}>
        {sound ? copy.soundOff : copy.soundOn}
      </button>}
      <div className="an-progress" data-progress />
    </>
  )

  return (
    <>
      <div className={`an-wrap${still ? ' an-wrap-still' : ''}`} ref={wrap}>
        {!still && view.music && <audio ref={audio} src={`/music/${view.music}.mp3`} preload="auto" muted playsInline data-testid="film-music" data-track={view.music} onLoadedMetadata={(e) => { const au = e.currentTarget; if (!au.paused) au.currentTime = Math.min(musicOffset(au, tl.total) + t.current, Math.max(0, au.duration - 0.02)) }} />}
        {still ? (
          <div className={`an-still-page${inkOnly(view) ? ' an-memorial' : ''}`} data-quiet={inkOnly(view) ? 'yes' : 'no'} style={{ ['--u' as string]: '3.6px' }} data-testid="film-still">
            {film.lines.map((line, i) => (
              <section className="an-still-scene" key={i}>
                <div className="an-art"><img src={film.pictures[i]} alt="" decoding="async" /></div>
                <p className="an-line an-line-still">{phrases(line).map((p, j) => <span key={j} style={{ opacity: 1 }}>{renderPhrase(p)}</span>)}</p>
              </section>
            ))}
            <section className="an-still-final">
              <EndCard view={view} copy={copy} poemLines={poemLines} still />
            </section>
          </div>
        ) : (
          <div
            ref={frame}
            className={`an-film${inkOnly(view) ? ' an-memorial' : ''}`}
            style={{ ['--u' as string]: `${u}px`, width: `${u * 100}px`, height: `${u * 177.78}px` }}
            role="img"
            aria-label={copy.alt}
            translate="no"
            data-testid="film"
            data-duration={tl.total}
            data-pictures={film.pictures.join(',')}
            data-status={film.status}
            data-memorial={view.memorial ? 'yes' : 'no'}
            data-quiet={inkOnly(view) ? 'yes' : 'no'}
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
          {!giftMode && (
            <button type="button" className="an-btn" onClick={share} data-testid="animation-share">
              {copy.share}
            </button>
          )}
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

/** The e-card the film ends on: a paper card with the character, its reading, a short gold rule, the "who they are" line, the poem and a small seal. Its geometry is src/order/film-card.ts (the same numbers the saved film uses). */
function EndCard({ view, copy, poemLines, still = false }: { view: AnimationView; copy: PageCopy; poemLines: string[]; still?: boolean }) {
  const L = cardLayout('film')
  const vertical = isVerticalPoemType(view.poem?.type)
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  const en = view.language === 'en'
  return (
    <div className={`an-card${still ? ' an-card-still' : ''}`} data-card data-testid="film-card" data-card-aspect={CARD_ASPECT} style={{ width: `calc(var(--u) * ${CARD_WIDTH * 100})`, height: `calc(var(--u) * ${CARD_WIDTH * 100 * CARD_ASPECT})` }}>
      <div className="an-card-kanji notranslate" translate="no" data-testid="film-card-kanji" style={{ top: pct(L.charY), fontSize: `calc(var(--u) * ${L.charSize * CARD_WIDTH * 100})` }}>{view.glyph}</div>
      <div className="an-card-reading notranslate" translate="no" data-card-reading data-testid="film-card-reading" style={{ top: pct(L.readingY) }}>{readingLine(view)}</div>
      <i className="an-card-rule" data-card-rule style={{ top: pct(L.ruleY) }} />
      <div className="an-card-who" data-card-who data-testid="film-who" style={{ top: pct(L.whoTop ?? 0.455) }}>
        {phrases(view.who).map((p, i) => <span key={i}>{p}</span>)}
      </div>
      {poemLines.length > 0 && (
        <div className={`an-card-poem ${vertical ? 'an-poem-v' : 'an-poem-h'}${en ? ' an-poem-en' : ''}`} data-testid="film-poem" data-poem-type={view.poem?.type ?? ''} data-poem-vertical={vertical ? 'yes' : 'no'} style={{ top: pct(L.poemTop) }}>
          {poemLines.map((l, i) => <p key={i} className="notranslate" translate="no" data-card-line={i} data-testid="film-poem-line">{l}</p>)}
        </div>
      )}
      <div className="an-card-seal" data-card-seal data-testid="film-seal" aria-hidden="true"><b>{copy.sealText.join('')}</b></div>
    </div>
  )
}

/** A phrase with its quotation (「…」 or “…”) set in gold, as in the reference film. */
function renderPhrase(p: string) {
  const parts = p.split(/(「[^」]*」|『[^』]*』|“[^”]*”)/g).filter((x) => x !== '')
  return parts.map((x, i) => (/^(「|『|“)/.test(x) ? <span className="an-q" key={i}>{x}</span> : x))
}
