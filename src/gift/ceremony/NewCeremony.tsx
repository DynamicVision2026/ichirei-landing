import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GiftView } from '../../animation/types.ts'
import { EgiftReceive } from '../../animation/GiftPanels.tsx'
import { RETURN_CHARS, returnWord } from '../../order/return-chars.ts'
import { cleanReading } from '../../order/reading.ts'
import { usePromoOn } from '../../demo/useSizes'
import { trackReceiverOpened, trackUs } from '../../demo/analytics'
import ShareSection from '../ShareSection.tsx'
import { CER } from './copy.ts'
import './ceremony.css'

// The receiver's new ceremony (gift ceremony redesign 2026-11-15, phase A: Classic, English). Nine screens, one at a time, each waits for a tap:
//   1 the mark · 2 the note · 3 the film · 4 the character (it grows from the mark, then the poem is found inside its strokes) · 5 the poem · 6 the certificate
//   7 what to keep · 8 send a character back · 9 sent, and your turn.
// The motion and the numbers are the director's preview (v5). Reduced motion: cross-fades only (no push-in, no grow, no dive into the stroke).
// The data is today's gift view; nothing new is asked of the sender. Before the mark is touched the page shows the two names and nothing else.

export type CeremonyScreen = 'mark' | 'note' | 'film' | 'char' | 'poem' | 'cert' | 'keep' | 'back' | 'sent'

/** The director's film: 6.6 s a picture, a 0.9 s cross-fade, a slow push-in 1 → 1.07; then it fades to paper over 1.1 s while the music fades over 2.4 s. */
export const FILM_HOLD_MS = 6600
export const FILM_REDUCED_HOLD_MS = 3000
export const FILM_FADE_MS = 900
export const FILM_END_MS = 1100
export const MUSIC_FADE_MS = 2400
export const GROW_MS = 2200

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function play(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  if (!el || !(el as HTMLElement).animate) return Promise.resolve()
  try {
    return (el as HTMLElement).animate(frames, { ...opts, fill: 'forwards' }).finished.then(() => undefined, () => undefined)
  } catch {
    return Promise.resolve()
  }
}
const cancelAll = (els: (Element | null)[]) => els.forEach((el) => (el as HTMLElement | null)?.getAnimations?.().forEach((a) => a.cancel()))

const filmComplete = (v: GiftView): boolean => !!v.film && v.film.status === 'ready' && !v.film.incomplete && !!v.film.pictures && !v.film.deferred
const scrollAvailable = (v: GiftView): boolean => filmComplete(v) && v.film!.pictures!.length === 4 && v.film!.pictures!.every((u) => !u.startsWith('/film/washi-')) && !v.film!.substituted?.length && !v.film!.no_pictures

export default function NewCeremony({ view, preview, q }: { view: GiftView; preview: boolean; q: string }) {
  const reduced = useMemo(reducedMotion, [])
  const [screen, setScreen] = useState<CeremonyScreen>('mark')
  const [sent, setSent] = useState<{ char: string | null; text: boolean } | null>(view.replied ? { char: null, text: false } : null)
  const markAt = useRef<{ x: number; y: number } | null>(null)
  const firstMark = useRef<HTMLButtonElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLElement>(null)
  const from = view.from ?? ''
  const to = view.to ?? ''

  // the 398 px stage, scaled up on a large screen by min(w/430, h/660, 1.7) (never down)
  useLayoutEffect(() => {
    const fit = () => {
      const st = stage.current
      const el = root.current
      if (!st || !el) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const z = Math.max(1, Math.min(vw / 430, vh / 660, 1.7))
      st.style.transform = z > 1.01 ? `scale(${z})` : 'none'
      st.style.height = `${vh / z}px`
      el.style.setProperty('--sh', `${vh / z}px`)
      el.dataset.zoom = z.toFixed(3)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const go = useCallback((s: CeremonyScreen) => {
    if (!markAt.current && firstMark.current) {
      const m = firstMark.current.getBoundingClientRect()
      if (m.width) markAt.current = { x: m.left + m.width / 2, y: m.top + m.height / 2 }
    }
    setScreen(s)
    window.scrollTo(0, 0)
  }, [])

  const open = useCallback(() => {
    const m = firstMark.current?.getBoundingClientRect()
    if (m && m.width) markAt.current = { x: m.left + m.width / 2, y: m.top + m.height / 2 }
    if (!preview) {
      trackReceiverOpened(view.token)
      // the sender's page shows "Opened (time)": the first opening is kept (codes only)
      try { void fetch(`/api/gift/${view.token}/opened`, { method: 'POST', keepalive: true }).catch(() => {}) } catch { /* the page works without it */ }
    }
    setScreen(view.message?.trim() ? 'note' : 'film')
  }, [preview, view.token, view.message])

  const afterChar = view.poem && view.poem.lines.length ? 'poem' : 'cert'

  return (
    <main ref={root} className="cr" lang="en" data-testid="gift-page" data-ceremony="new" data-screen={screen} data-step={screen} data-motion={reduced ? 'fade' : 'full'}>
      {screen === 'char' && <CharacterLayers view={view} reduced={reduced} markAt={markAt} stageRef={stage} />}
      <div ref={stage} className="cr-stage">
        <p className="cr-wm">ICHIREI</p>
        <p className="cr-wv" lang="ja">一字礼</p>
        {preview && <p className="cr-preview" data-testid="gift-preview-note">{CER.previewNote}</p>}

        {screen === 'mark' && (
          <section className="cr-scr" data-testid="cr-mark">
            <button ref={firstMark} type="button" className="cr-markbtn" data-testid="cr-markbtn" aria-label={CER.markAria} onClick={open}><span className="cr-ring" /><span className="cr-mark" /></button>
            <div className="cr-txt">
              {CER.markLabel(to) && <p className="cr-lab" data-testid="cr-for">{CER.markLabel(to)}</p>}
              <h1 className="cr-h" data-testid="cr-mark-title">{CER.markTitle(from)[0]}<br />{CER.markTitle(from)[1]}</h1>
              <p className="cr-b">{CER.markBody}</p>
            </div>
            <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-open" onClick={open}>{CER.markButton}</button>
          </section>
        )}

        {screen === 'note' && (
          <section className="cr-scr" data-testid="cr-note">
            <div className="cr-slip cr-note">
              <p className="cr-hw cr-note-text" data-testid="gift-message" style={{ fontSize: noteSize(view.message) }}>{view.message}</p>
              {from && <p className="cr-hw cr-note-from">{from}</p>}
            </div>
            <button type="button" className="cr-markbtn cr-right" aria-label={CER.markAria} onClick={() => go('film')}><span className="cr-ring" /><span className="cr-mark" /></button>
            <div className="cr-txt">
              <p className="cr-lab">{CER.noteLabel(from)}</p>
              <h2 className="cr-h">{CER.noteTitle}</h2>
              <p className="cr-b">{CER.noteBody}</p>
            </div>
            <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-to-film" onClick={() => go('film')}>{CER.noteButton}</button>
          </section>
        )}

        {screen === 'film' && <FilmScreen view={view} reduced={reduced} from={from} onDone={() => go('char')} />}

        {screen === 'char' && (
          <section className="cr-scr" data-testid="cr-char">
            <div className="cr-gbox" id="cr-gbox" role="img" aria-label={CER.glyphAria(readingOf(view), wordOf(view))} />
            <p className="cr-slip cr-cap" id="cr-cap1">{CER.cap1(from)[0]}<br />{CER.cap1(from)[1]}</p>
            <p className="cr-slip cr-cap" id="cr-cap2">{CER.cap2[0]}<br />{CER.cap2[1]}</p>
            <Meaning view={view} from={from} />
            <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-to-poem" onClick={() => go(afterChar)}>{afterChar === 'poem' ? CER.toPoem : CER.toCertFromChar}</button>
          </section>
        )}

        {screen === 'poem' && view.poem && (
          <section className="cr-scr cr-flow" data-testid="cr-poem">
            <div className="cr-row" style={{ gap: 16 }}>
              <div className="cr-small notranslate" translate="no" aria-hidden="true">{view.glyph}</div>
              <p className="cr-lab" style={{ lineHeight: 1.7 }}>{CER.poemLabel[0]}<br />{CER.poemLabel[1]}</p>
            </div>
            <div className="cr-poem" data-testid="gift-poem" data-poem-type={view.poem.type}>
              {view.poem.lines.map((l, i) => (
                <p key={i} className={`cr-rise notranslate${i === 3 && view.poem!.lines.length === 6 ? ' cr-gap' : ''}`} translate="no" style={{ animationDelay: `${0.3 + i * 0.6 + (i > 2 ? 0.4 : 0)}s` }}>{l}</p>
              ))}
            </div>
            <p className="cr-b" style={{ fontSize: 15, color: 'var(--mute)' }} data-testid="gift-poem-from">{CER.poemFrom(from)}</p>
            <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="cr-to-cert" onClick={() => go('cert')}>{CER.toCert}</button>
          </section>
        )}

        {screen === 'cert' && (
          <section className="cr-scr cr-flow" data-testid="cr-cert">
            <div className="cr-slip cr-cert" data-testid="gift-cert" data-cert-no={view.certificate_no ?? ''}>
              <p className="cr-lab cr-cert-no">{CER.certNo(view.certificate_no)}</p>
              <div className="cr-big notranslate" translate="no" role="img" aria-label={CER.certAria(readingOf(view))} data-testid="gift-cert-glyph">{view.glyph}</div>
              <p className="cr-m" style={{ margin: 0, fontSize: 25, fontWeight: 900 }}>
                {readingOf(view) && <i style={{ fontWeight: 500, fontSize: 16, color: 'var(--mute)' }}>{readingOf(view)}</i>}
                {readingOf(view) && wordOf(view) ? ' · ' : ''}
                {wordOf(view)}
              </p>
              {(to || from) && (
                <div className="cr-pair">
                  {to && <div><p className="cr-lab">{CER.certFor}</p><p className="cr-name" data-testid="gift-cert-to">{to}</p></div>}
                  {from && <div><p className="cr-lab">{CER.certFrom}</p><p className="cr-name" data-testid="gift-cert-from">{from}</p></div>}
                </div>
              )}
              <p className="cr-m" style={{ margin: 0, fontSize: 16, lineHeight: 1.55, fontStyle: 'italic', maxWidth: '24ch' }} data-testid="gift-cert-line">{CER.certLine(to, from)}</p>
              <p className="cr-lab">{CER.certPlace(view.opens_on ?? view.order_date)}</p>
            </div>
            <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="cr-to-keep" onClick={() => go('keep')}>{CER.toKeep}</button>
          </section>
        )}

        {screen === 'keep' && <KeepScreen view={view} preview={preview} q={q} from={from} onAnswer={() => go(sent ? 'sent' : 'back')} />}

        {screen === 'back' && <BackScreen view={view} from={from} onSent={(r) => { setSent(r); go('sent') }} />}

        {screen === 'sent' && (
          <SentScreen from={from} sent={sent} onBack={() => go('keep')} />
        )}
      </div>
    </main>
  )
}

const readingOf = (v: GiftView): string => cleanReading((v.romanization ?? '').split(' / ')[0] ?? '')
const wordOf = (v: GiftView): string => (v.en?.word ?? v.meaning_en ?? '').trim()
/** The note in the hand of the preview, smaller as it gets longer (never under 22 px). */
const noteSize = (m: string): string => {
  const n = [...(m ?? '')].length
  return n <= 60 ? 'clamp(33px, 10vw, 41px)' : n <= 110 ? '30px' : n <= 160 ? '26px' : '22px'
}

/** Screen 4's words: "In Brian's eyes, you are" / the word and the reading / the line said to the receiver / "This character is not a wish for you…". */
function Meaning({ view, from }: { view: GiftView; from: string }) {
  const lineYou = view.en?.line_you?.trim() || null
  const oldLine = (view.en?.line ?? view.who ?? '').trim()
  return (
    <div className="cr-txt cr-meaning" id="cr-meaning" data-testid="cr-meaning" data-line={lineYou ? 'you' : 'old'}>
      <p className="cr-lab" data-testid="cr-meaning-label">{lineYou ? CER.meaningYou(from) : CER.meaningOld(from)}</p>
      <p className="cr-word notranslate" translate="no" data-testid="cr-word">{wordOf(view)} {readingOf(view) && <i>{readingOf(view)}</i>}</p>
      <p className="cr-b cr-ink" data-testid="cr-line">{lineYou ?? oldLine}</p>
      <p className="cr-b">{CER.notAWish(from)}</p>
    </div>
  )
}

/**
 * The character's three layers (the director's technique, copied from the preview's `#lens`, `#micro`, `#mask` and `reveal()`), fixed over the whole window:
 *   the solid character grows from the mark (2.2 s, slow start, fast finish, no bounce) → it fades into the lens, whose red is the poem written small in cream →
 *   "… chose one character for you." → a dive ×4 into one stroke (2.4 s), along it (5.4 s) with "Look closer. A poem is written inside it.", back out (2.6 s) → the meaning rises.
 * Reduced motion: no grow and no dive; the views cross-fade.
 */
function CharacterLayers({ view, reduced, markAt, stageRef }: { view: GiftView; reduced: boolean; markAt: React.MutableRefObject<{ x: number; y: number } | null>; stageRef: React.RefObject<HTMLDivElement | null> }) {
  const lens = useRef<HTMLDivElement>(null)
  const micro = useRef<HTMLPreElement>(null)
  const mglyph = useRef<HTMLDivElement>(null)
  const solid = useRef<HTMLDivElement>(null)
  const poem = useMemo(() => {
    const lines = (view.poem?.lines ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    return lines.length ? lines : [(view.en?.line ?? view.who ?? '').trim() || view.glyph]
  }, [view.poem, view.en, view.who, view.glyph])

  useEffect(() => {
    let alive = true
    const box = () => document.getElementById('cr-gbox')?.getBoundingClientRect() ?? null
    const layout = () => {
      const r = box()
      if (!r || !micro.current || !mglyph.current || !solid.current) return r
      const fs = r.width / 40
      Object.assign(micro.current.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.width}px`, fontSize: `${fs}px`, lineHeight: `${fs}px` })
      const rows: string[] = []
      for (let i = 0; i < 42; i++) {
        const line = `${poem[i % poem.length]}  ·  `
        rows.push(line.repeat(Math.ceil(110 / line.length) + 1))
      }
      micro.current.textContent = rows.join('\n')
      for (const g of [mglyph.current, solid.current]) Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.width}px`, fontSize: `${r.width * 0.97}px` })
      return r
    }
    const cap1 = () => document.getElementById('cr-cap1')
    const cap2 = () => document.getElementById('cr-cap2')
    const meaning = () => document.getElementById('cr-meaning')
    const run = async () => {
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(1500)])
      if (!alive) return
      const r = layout()
      if (!r || !lens.current || !solid.current) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const mx = markAt.current?.x ?? r.left + r.width * 0.7
      const my = markAt.current?.y ?? r.top + r.width * 1.05
      solid.current.style.transformOrigin = `${mx - r.left}px ${my - r.top}px`
      lens.current.dataset.phase = 'grow'
      if (reduced) await play(solid.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 900 })
      else await play(solid.current, [{ opacity: 1, transform: 'scale(.036)' }, { opacity: 1, transform: 'scale(1)' }], { duration: GROW_MS, easing: 'cubic-bezier(.7,0,.2,1)' })
      if (!alive) return
      void play(solid.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: 100 })
      await play(lens.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 600 })
      if (!alive) return
      lens.current.dataset.phase = 'lens'
      void play(cap1(), [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 1900 })
      await wait(1300)
      if (!alive) return
      if (!reduced) {
        const k = 4
        const fy = r.top + r.width * 0.6
        const ty = vh * 0.36 - k * fy
        const near0 = `translate(${vw / 2 - k * (r.left + r.width * 0.38)}px,${ty}px) scale(${k})`
        const near1 = `translate(${vw / 2 - k * (r.left + r.width * 0.66)}px,${ty}px) scale(${k})`
        lens.current.dataset.phase = 'dive'
        await play(lens.current, [{ opacity: 1, transform: 'translate(0px,0px) scale(1)' }, { opacity: 1, transform: near0 }], { duration: 2400, easing: 'ease-in-out' })
        if (!alive) return
        void play(cap2(), [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: 5600 })
        await play(lens.current, [{ opacity: 1, transform: near0 }, { opacity: 1, transform: near1 }], { duration: 5400, easing: 'ease-in-out' })
        if (!alive) return
        await play(lens.current, [{ opacity: 1, transform: near1 }, { opacity: 1, transform: 'translate(0px,0px) scale(1)' }], { duration: 2600, easing: 'ease-in-out' })
        if (!alive) return
      } else {
        // the close view is only said, not shown: the slip fades in and out over the whole character
        await play(cap2(), [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 3600 })
        if (!alive) return
      }
      lens.current.dataset.phase = 'done'
      void play(meaning(), [{ opacity: 0, translate: '0 12px' }, { opacity: 1, translate: '0 0' }], { duration: 900, easing: 'ease-out' })
    }
    void run()
    const onResize = () => {
      layout()
    }
    window.addEventListener('resize', onResize)
    const l = lens.current
    const so = solid.current
    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
      cancelAll([l, so, cap1(), cap2(), meaning()])
    }
  }, [poem, reduced, markAt, stageRef])

  return (
    <>
      <div ref={lens} className="cr-lens" aria-hidden="true" data-testid="cr-lens">
        <pre ref={micro} className="cr-micro" data-testid="cr-micro" />
        <div className="cr-mask" data-testid="cr-mask"><div ref={mglyph} className="cr-glyph notranslate" translate="no">{view.glyph}</div></div>
        <div className="cr-tex" />
      </div>
      <div ref={solid} className="cr-glyph cr-solid notranslate" translate="no" aria-hidden="true" data-testid="cr-solid">{view.glyph}</div>
    </>
  )
}

/** Screen 3: today's four engine pictures and four lines with the purpose's music, in the director's motion. It never ends on black: it fades to paper. */
function FilmScreen({ view, reduced, from, onDone }: { view: GiftView; reduced: boolean; from: string; onDone: () => void }) {
  const pictures = view.film?.pictures ?? null
  const lines = view.film?.lines ?? []
  const frame = useRef<HTMLDivElement>(null)
  const picA = useRef<HTMLDivElement>(null)
  const picB = useRef<HTMLDivElement>(null)
  const capt = useRef<HTMLParagraphElement>(null)
  const txt = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [tick, setTick] = useState(-1)
  const [muted, setMuted] = useState(false)
  const run = useRef(0)
  const audio = useRef<HTMLAudioElement | null>(null)
  const fadeT = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const count = Math.min(4, pictures?.length ?? 0)
  const hold = reduced ? FILM_REDUCED_HOLD_MS : FILM_HOLD_MS

  useEffect(() => {
    if (!view.music) return
    const au = new Audio(`/music/${view.music}.mp3`)
    au.preload = 'auto'
    audio.current = au
    return () => {
      clearInterval(fadeT.current)
      au.pause()
      audio.current = null
    }
  }, [view.music])

  // the first picture waits, faint, before the film is played; the pictures are fetched ahead so the film does not stutter
  useEffect(() => {
    if (!pictures?.length) return
    pictures.forEach((src) => { const im = new Image(); im.src = src })
    if (picA.current && !playing) {
      picA.current.style.backgroundImage = `url("${pictures[0]}")`
      picA.current.style.opacity = '0.38'
    }
  }, [pictures, playing])

  useEffect(() => () => { run.current++ }, [])

  const quiet = (ms: number) => {
    const au = audio.current
    if (!au) return
    clearInterval(fadeT.current)
    const step = au.volume / Math.max(1, ms / 60)
    fadeT.current = setInterval(() => {
      if (au.volume - step <= 0.01) {
        clearInterval(fadeT.current)
        au.pause()
        au.volume = 1
      } else au.volume -= step
    }, 60)
  }

  const start = async () => {
    if (!pictures?.length) return
    const id = ++run.current
    setPlaying(true)
    void play(txt.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 500 })
    const au = audio.current
    if (au) {
      clearInterval(fadeT.current)
      try {
        const total = (count * hold + FILM_END_MS) / 1000
        au.currentTime = Number.isFinite(au.duration) ? Math.max(0, au.duration - total) : 0
      } catch { /* not loaded yet: it starts from the beginning */ }
      au.volume = 1
      au.muted = muted
      void au.play().catch(() => {})
    }
    const layers = [picA.current, picB.current]
    for (let i = 0; i < count; i++) {
      const on = layers[i % 2]
      const off = layers[(i + 1) % 2]
      if (!on || !off) return
      on.style.backgroundImage = `url("${pictures[i]}")`
      setTick(i)
      void play(off, [{ opacity: 1 }, { opacity: 0 }], { duration: FILM_FADE_MS })
      if (reduced) void play(on, [{ opacity: i ? 0 : 0.38 }, { opacity: 1 }], { duration: FILM_FADE_MS })
      else void play(on, [{ opacity: i ? 0 : 0.38, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.015)', offset: 0.15 }, { opacity: 1, transform: 'scale(1.07)' }], { duration: hold + FILM_FADE_MS, easing: 'linear' })
      if (capt.current) {
        capt.current.textContent = lines[i] ?? ''
        void play(capt.current, [{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: hold })
      }
      await wait(hold)
      if (id !== run.current) return
    }
    // the end: the music fades over 2.4 s; the picture fades to the paper (1.1 s); then straight to the character — never a black frame
    quiet(MUSIC_FADE_MS)
    if (frame.current) frame.current.dataset.ending = 'yes'
    await play(frame.current, [{ opacity: 1 }, { opacity: 0 }], { duration: FILM_END_MS })
    if (id !== run.current) return
    onDone()
  }

  const skip = () => {
    run.current++
    quiet(500)
    onDone()
  }
  const toggle = () => {
    setMuted((m) => {
      if (audio.current) audio.current.muted = !m
      return !m
    })
  }

  return (
    <section className="cr-scr" data-testid="cr-film" data-playing={playing ? 'yes' : 'no'}>
      <div ref={frame} className="cr-slip cr-frame" data-testid="cr-frame" role="img" aria-label={CER.filmTitle}>
        <div ref={picA} className="cr-pic" data-testid="cr-pic" />
        <div ref={picB} className="cr-pic" data-testid="cr-pic" />
        <p ref={capt} className="cr-capt" aria-live="polite" data-testid="film-line" />
      </div>
      <div className="cr-ticks" aria-hidden="true">{[0, 1, 2, 3].map((n) => <i key={n} className={n <= tick ? 'cr-on' : ''} />)}</div>
      <div ref={txt} className="cr-txt" style={{ bottom: 94 }}>
        <h2 className="cr-h">{CER.filmTitle}</h2>
        <p className="cr-b">{CER.filmBody(from, !!view.music)}</p>
        {!pictures && !view.film?.deferred && <p className="cr-status" role="status" data-testid="animation-preparing">{CER.preparing}</p>}
        {!pictures && view.film?.deferred && <p className="cr-status" role="status" data-testid="animation-deferred">{CER.deferred}</p>}
      </div>
      <div className="cr-fixrow">
        {!playing && <button type="button" className="cr-go" data-testid="cr-play" disabled={!pictures?.length} onClick={() => void start()}>{CER.play}</button>}
        {view.music && <button type="button" className="cr-go cr-quiet" data-testid="film-sound" aria-pressed={muted} onClick={toggle}>{muted ? CER.soundOn : CER.soundOff}</button>}
        <button type="button" className="cr-go cr-quiet" data-testid="gift-skip" onClick={skip}>{CER.skip}</button>
      </div>
    </section>
  )
}

type SavePhase = 'idle' | 'making' | 'ready' | 'failed'

/** Screen 7: the film (MP4, unchanged), the four pictures (the story scroll), the card (the print-at-home PDF) and the certificate (PNG). */
function KeepScreen({ view, preview, q, from, onAnswer }: { view: GiftView; preview: boolean; q: string; from: string; onAnswer: () => void }) {
  const base = `/api/gift/${view.token}`
  const [film, setFilm] = useState<SavePhase>('idle')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const complete = filmComplete(view)
  const scroll = scrollAvailable(view)
  const pics = view.film?.pictures ?? []
  const sep = q ? '&' : '?'
  const saveFilm = async () => {
    setFilm('making')
    try {
      for (let i = 0; i < 40 && alive.current; i++) {
        const res = await fetch(`${base}/film/make${q}`, { method: 'POST' })
        const j = (await res.json().catch(() => ({}))) as { state?: string }
        if (res.ok && j.state === 'ready') {
          const a = document.createElement('a')
          a.href = `${base}/film.mp4${q}${sep}download=1`
          a.download = 'ichirei-film.mp4'
          document.body.appendChild(a)
          a.click()
          a.remove()
          setFilm('ready')
          return
        }
        if (!res.ok && res.status !== 202) throw new Error('make failed')
        await wait(3000)
      }
      throw new Error('timed out')
    } catch {
      if (alive.current) setFilm('failed')
    }
  }
  return (
    <section className="cr-scr cr-flow" data-testid="gift-keep">
      <h2 className="cr-h">{CER.keepTitle}</h2>
      {complete && (
        <div className="cr-slip cr-keep" data-testid="keep-film">
          <div className="cr-thumb" style={pics[0] ? { backgroundImage: `url("${pics[0]}")` } : undefined} />
          <div>
            <h3>{CER.keepFilm}</h3>
            <p>{CER.keepFilmLine(from, !!view.music)}</p>
            {!preview && <button type="button" className="cr-go" data-testid="save-film" disabled={film === 'making'} onClick={() => void saveFilm()}>{film === 'making' ? CER.saving : film === 'ready' ? CER.saved : CER.save}</button>}
            {film === 'failed' && <p role="alert" className="cr-err" data-testid="save-film-failed">{CER.saveFailed}</p>}
          </div>
        </div>
      )}
      {film === 'ready' && (
        <div>
          <video className="cr-video" data-testid="save-film-video" src={`${base}/film.mp4${q}`} controls playsInline preload="metadata" />
          <p className="cr-b" style={{ fontSize: 15 }}>{CER.filmHint}</p>
        </div>
      )}
      {scroll && (
        <div className="cr-slip cr-keep" data-testid="keep-pictures">
          <div className="cr-thumb cr-four">{pics.slice(0, 4).map((p, i) => <i key={i} style={{ backgroundImage: `url("${p}")` }} />)}</div>
          <div>
            <h3>{CER.keepPictures}</h3>
            <p>{CER.keepPicturesLine}</p>
            {!preview && <a className="cr-go" data-testid="save-scroll" href={`${base}/scroll.png${q}`} download>{CER.save}</a>}
          </div>
        </div>
      )}
      {complete && (
        <div className="cr-slip cr-keep" data-testid="keep-card">
          <div className="cr-thumb cr-white"><span className="cr-small notranslate" translate="no" style={{ fontSize: 54 }}>{view.glyph}</span></div>
          <div>
            <h3>{CER.keepCard}</h3>
            <p>{CER.keepCardLine(!!view.poem)}</p>
            {!preview && <a className="cr-go" data-testid="save-card" href={`${base}/card.pdf${q}`} download>{CER.save}</a>}
          </div>
        </div>
      )}
      <div className="cr-slip cr-keep" data-testid="keep-cert">
        <div className="cr-thumb cr-goldline"><span className="cr-small notranslate" translate="no" style={{ fontSize: 44 }}>{view.glyph}</span></div>
        <div>
          <h3>{CER.keepCert}</h3>
          <p>{CER.keepCertLine(view.certificate_no, !!(view.to && view.from))}</p>
          {!preview && <a className="cr-go" data-testid="save-certificate" href={`${base}/certificate.png${q}`} download onClick={() => trackUs('receiver_saved_card')}>{CER.save}</a>}
        </div>
      </div>
      {!preview && complete && <div className="cr-share"><ShareSection lang="en" base={base} role="receiver" /></div>}
      {view.egift && !preview && <div className="cr-egift"><EgiftReceive view={view} lang="en" /></div>}
      {!preview && <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="gift-to-answer" onClick={onAnswer}>{CER.toAnswer(from)}</button>}
      <a className="cr-go cr-quiet" href="/credits" data-testid="animation-credits-link">{CER.credits}</a>
    </section>
  )
}

/** Screen 8: one of the twelve, and/or a few words (80 characters), sent once. */
function BackScreen({ view, from, onSent }: { view: GiftView; from: string; onSent: (r: { char: string | null; text: boolean }) => void }) {
  const [char, setChar] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'error'>('idle')
  const send = async () => {
    if (!char && !text.trim()) return
    setPhase('sending')
    try {
      const res = await fetch(`/api/gift/${view.token}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(text.trim() ? { text: text.trim() } : {}), ...(char ? { char } : {}) }) })
      if (res.ok || res.status === 409) {
        if (res.ok) trackUs('receiver_replied')
        onSent({ char, text: !!text.trim() })
      } else setPhase('error')
    } catch {
      setPhase('error')
    }
  }
  return (
    <section className="cr-scr cr-flow" data-testid="gift-answer">
      <h2 className="cr-h" data-testid="gift-answer-title">{CER.backTitle(from)[0]}<br />{CER.backTitle(from)[1]}</h2>
      <p className="cr-b">{CER.backBody}</p>
      <ul className="cr-grid" data-testid="gift-chars">
        {RETURN_CHARS.map((r) => (
          <li key={r.char}>
            <button type="button" className="cr-ch" aria-pressed={char === r.char} data-testid={`gift-char-${r.char}`} onClick={() => setChar((c) => (c === r.char ? null : r.char))}>
              <b className="notranslate" translate="no">{r.char}</b>
              <span>{r.en}</span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <label htmlFor="cr-reply" className="cr-lab" style={{ display: 'block', marginBottom: 6 }}>{CER.wordsLabel}</label>
        <input id="cr-reply" className="cr-field" type="text" maxLength={80} placeholder={CER.wordsPlaceholder} value={text} onChange={(e) => setText([...e.target.value].slice(0, 80).join(''))} data-testid="gift-reply-text" />
      </div>
      {phase === 'error' && <p role="alert" className="cr-b cr-ink">{CER.sendError}</p>}
      <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="gift-reply-send" disabled={(!char && !text.trim()) || phase === 'sending'} onClick={() => void send()}>
        {phase === 'sending' ? CER.sending : CER.send(char, from)}
      </button>
    </section>
  )
}

/** Screen 9: sent; then "Is there someone you've never quite said it to?" with a real button to /en (and the free-gift card while the promotion runs). */
function SentScreen({ from, sent, onBack }: { from: string; sent: { char: string | null; text: boolean } | null; onBack: () => void }) {
  const promoOn = usePromoOn()
  const char = sent?.char ?? null
  return (
    <section className="cr-scr cr-flow" data-testid="gift-reply-sent">
      <div className="cr-sent"><span className="cr-dot" aria-hidden="true" /><p className="cr-lab" role="status" data-testid="cr-sent-line">{CER.sentLine(from, char, char ? returnWord(char, 'en') : '')}</p></div>
      {char ? <p className="cr-b cr-ink">{CER.bothSaid(from)}</p> : sent?.text ? <p className="cr-b cr-ink">{CER.wordsSent(from)}</p> : null}
      <h2 className="cr-h" style={{ fontSize: 'clamp(28px, 8.6vw, 35px)' }} data-testid="cr-ask">{CER.ask}</h2>
      {promoOn && (
        <div className="cr-slip cr-promo" data-testid="gift-landing-promo">
          <p className="cr-m" style={{ fontSize: 18, lineHeight: 1.4 }}>{CER.promo}</p>
          <p className="cr-promo-sub">{CER.promoSub}</p>
        </div>
      )}
      <a className="cr-blk" href="/en" data-testid="gift-landing-line">{CER.giveOwn}</a>
      <button type="button" className="cr-go cr-quiet" onClick={onBack}>{CER.backToGift}</button>
    </section>
  )
}
