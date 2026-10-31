import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COPY as FILM_COPY, pageLang, type PageLang } from '../animation/copy.ts'
import { Film } from '../animation/AnimationApp.tsx'
import { EgiftReceive } from '../animation/GiftPanels.tsx'
import type { GiftLockedView, GiftView } from '../animation/types.ts'
import { GIFT_COPY, fullDateText, openDateText, type GiftCopy } from './copy.ts'
import { linerFor } from './liner.ts'
import '../animation/animation.css'
import './gift.css'

// The receiver's gift page /g/<token> (Part 3 of the 2026-10-31 ticket). One screen at a time:
//   1 the sealed envelope (or, before the opening date, the same envelope with the date instead of the button)
//   2 the opening (about 1.5 s: the seal breaks, the flap lifts onto the seasonal liner, the letter slides up; reduced motion: a fade)
//   3 the letter   4 the 30-second film   5 the reveal   6 the poem   7 the certificate   8 what to keep, and the one thank-you
// The page never shows a price, an order number, the other candidate characters or the sender's story; the server sends the closed envelope
// (names and the date) and nothing else until the day. The sender may look at any time with ?preview=<their own page id>.

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;700;900&family=Noto+Serif+JP:wght@300;400;600&family=Noto+Serif+TC:wght@400;600;900&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400&display=swap'

type Step = 'envelope' | 'opening' | 'letter' | 'film' | 'reveal' | 'poem' | 'cert' | 'keep'
type Load = { state: 'loading' } | { state: 'error'; kind: 'notFound' | 'unavailable' } | { state: 'locked'; view: GiftLockedView } | { state: 'ready'; view: GiftView }

export const OPENING_MS = 1500
export const FADE_MS = 450

const routeToken = (): string | null => window.location.pathname.match(/^\/g\/(RG-[a-z2-9]{20})\/?$/)?.[1] ?? window.location.pathname.match(/^\/g\/([A-Za-z0-9-]{3,64})\/?$/)?.[1] ?? null
const previewKey = (): string | null => new URLSearchParams(window.location.search).get('preview')

const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** The story scroll exists only when all four pictures are real (never with a washi slot). */
const scrollAvailable = (v: GiftView): boolean => !!v.film && v.film.status === 'ready' && !v.film.incomplete && !!v.film.pictures && v.film.pictures.length === 4 && v.film.pictures.every((u) => !u.startsWith('/film/washi-'))

export default function GiftApp() {
  const token = useMemo(routeToken, [])
  const preview = useMemo(previewKey, [])
  const q = preview ? `?preview=${encodeURIComponent(preview)}` : ''
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [lang, setLang] = useState<PageLang>('ja')
  const [step, setStep] = useState<Step>('envelope')
  const reduced = useMemo(prefersReducedMotion, [])
  const copy = GIFT_COPY[lang]

  useEffect(() => {
    document.title = GIFT_COPY[lang].title
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

  // the view; while the film's script is still being written ask again every few seconds; a closed envelope is asked again when the tab comes back
  useEffect(() => {
    if (!token) return setLoad({ state: 'error', kind: 'notFound' })
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = async () => {
      try {
        const res = await fetch(`/api/gift/${token}${q}`, { signal: ac.signal })
        if (res.status === 404) return setLoad({ state: 'error', kind: 'notFound' })
        if (!res.ok) return setLoad({ state: 'error', kind: 'unavailable' })
        const view = (await res.json()) as GiftView | GiftLockedView
        setLang(pageLang(view.language))
        if (view.locked) return setLoad({ state: 'locked', view })
        setLoad((cur) => (cur.state === 'ready' && cur.view.film?.pictures && !view.film?.pictures ? cur : { state: 'ready', view }))
        if (!view.film) timer = setTimeout(go, 3000)
      } catch {
        if (!ac.signal.aborted) setLoad({ state: 'error', kind: 'unavailable' })
      }
    }
    void go()
    const onVis = () => !document.hidden && load.state === 'locked' && void go()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      ac.abort()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [token, q]) // eslint-disable-line react-hooks/exhaustive-deps

  // the pictures: drawn once (the server holds the request until they are done), started as soon as the envelope is here so they are ready by the film
  const film0 = load.state === 'ready' ? load.view.film : null
  const needsPictures = !!film0 && ((film0.pictures === null && !film0.deferred) || film0.incomplete === true)
  useEffect(() => {
    if (!needsPictures || !token) return
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = async () => {
      try {
        const res = await fetch(`/api/gift/${token}/render${q}`, { method: 'POST', signal: ac.signal })
        if (!res.ok) {
          timer = setTimeout(go, 5000)
          return
        }
        const j = (await res.json()) as { state: string; view: GiftView }
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
  }, [needsPictures, token, q])

  const openEnvelope = useCallback(() => {
    setStep('opening')
    window.setTimeout(() => setStep('letter'), reduced ? FADE_MS : OPENING_MS)
  }, [reduced])

  const memorial = load.state === 'ready' || load.state === 'locked' ? load.view.memorial : false
  const shell = `gf-page gf-step-${step}${memorial ? ' gf-memorial' : ''}`

  if (load.state === 'loading' || load.state === 'error')
    return (
      <main className={shell} lang={lang} data-testid="gift-page" data-step="loading">
        <p className="gf-note" role={load.state === 'error' ? 'alert' : 'status'} data-testid={load.state === 'error' ? 'animation-error' : undefined}>
          {load.state === 'loading' ? copy.loading : load.kind === 'notFound' ? copy.notFound : copy.unavailable}
        </p>
      </main>
    )

  if (load.state === 'locked') {
    const v = load.view
    return (
      <main className={shell} lang={lang} data-testid="gift-page" data-step="envelope" data-locked="yes">
        <Envelope copy={copy} lang={lang} to={v.to} from={v.from} memorial={v.memorial} date={v.opens_on} reduced={reduced} state="closed" locked={{ opens_on: v.opens_on, days_left: v.days_left }} />
      </main>
    )
  }

  const view = load.view
  const stage = (body: React.ReactNode, extra = '') => (
    <main className={`${shell}${extra}`} lang={lang} data-testid="gift-page" data-step={step} data-memorial={memorial ? 'yes' : 'no'}>
      {preview && <p className="gf-preview" data-testid="gift-preview-note">{copy.previewNote}</p>}
      {body}
    </main>
  )

  if (step === 'envelope' || step === 'opening')
    return stage(
      <Envelope copy={copy} lang={lang} to={view.to} from={view.from} memorial={view.memorial} date={view.opens_on ?? view.order_date} reduced={reduced} state={step === 'opening' ? 'opening' : 'closed'} onOpen={openEnvelope} />,
    )

  if (step === 'letter')
    return stage(
      <section className="gf-paper gf-letter" data-testid="gift-letter">
        <p className="gf-to" data-testid="gift-to">{copy.to(view.to)}</p>
        {view.message && <blockquote className="gf-message" data-testid="gift-message">{view.message}</blockquote>}
        <p className="gf-lead" data-testid="gift-lead">{view.memorial ? copy.letterLeadMemorial(view.from) : copy.letterLead(view.from)}</p>
        <p className="gf-from" data-testid="gift-from">{copy.from(view.from)}</p>
        <button type="button" className="gf-btn" data-testid="gift-to-film" onClick={() => setStep('film')}>{copy.letterButton}</button>
      </section>,
    )

  if (step === 'film') {
    const pictures = view.film?.pictures
    return (
      <main className={`an-page${view.memorial ? ' an-memorial' : ''}`} lang={lang} data-testid="gift-page" data-step="film">
        {!pictures && !view.film?.deferred && (
          <p className="an-note an-preparing" role="status" data-testid="animation-preparing">{copy.preparing}<span className="an-dots" aria-hidden="true" /></p>
        )}
        {!pictures && view.film?.deferred && <p className="an-note" role="status" data-testid="animation-deferred">{copy.deferred}</p>}
        {pictures && view.film && (
          <section>
            <Film key={view.id} view={view} film={{ ...view.film, pictures }} copy={FILM_COPY[lang]} giftMode onEnd={() => window.setTimeout(() => setStep('reveal'), reduced ? 0 : 1400)} />
          </section>
        )}
        {(reduced || !pictures) && (
          <p className="gf-skip"><button type="button" className="gf-btn gf-btn-quiet" data-testid="gift-skip" onClick={() => setStep('reveal')}>{copy.next}</button></p>
        )}
      </main>
    )
  }

  if (step === 'reveal')
    return stage(
      <section className="gf-reveal" data-testid="gift-reveal">
        <p className="gf-char notranslate" translate="no" data-testid="gift-glyph" aria-label={view.glyph}>{view.glyph}</p>
        <p className="gf-reading notranslate" translate="no" data-testid="gift-reading">{readingLine(view)}</p>
        <p className="gf-gold" data-testid="gift-gold">{copy.revealGold(view.from)}</p>
        <p className="gf-who" data-testid="gift-who">{view.who}</p>
        <button type="button" className="gf-btn" data-testid="gift-to-poem" onClick={() => setStep(view.poem ? 'poem' : 'cert')}>{view.poem ? copy.poemButton : copy.certButton}</button>
      </section>,
    )

  if (step === 'poem' && view.poem)
    return stage(
      <section className="gf-poem-wrap" data-testid="gift-poem-screen">
        <h2 className="gf-label">{copy.poemLabel}</h2>
        <div className={`gf-paper gf-poem gf-poem-${view.poem.type}`} data-testid="gift-poem" data-poem-type={view.poem.type}>
          {view.poem.type === 'tanka' ? (
            <div className="gf-vert" data-testid="gift-poem-vertical">{view.poem.lines.map((l, i) => <p key={i} className="notranslate" translate="no">{l}</p>)}</div>
          ) : (
            view.poem.lines.map((l, i) => <p key={i} className="notranslate" translate="no">{l}</p>)
          )}
        </div>
        {view.poem.reading && <p className="gf-poem-reading" data-testid="gift-poem-reading">{view.poem.reading}</p>}
        <button type="button" className="gf-btn" data-testid="gift-to-cert" onClick={() => setStep('cert')}>{copy.certButton}</button>
      </section>,
    )

  if (step === 'cert')
    return stage(
      <section className="gf-paper gf-cert" data-testid="gift-cert" data-cert-no={view.certificate_no ?? ''}>
        <h2 className="gf-cert-title" data-testid="gift-cert-title">{copy.certTitle(view.certificate_no ? String(view.certificate_no).padStart(4, '0') : null)}</h2>
        <p className="gf-cert-glyph notranslate" translate="no" data-testid="gift-cert-glyph">{view.glyph}</p>
        <p className="gf-cert-to" data-testid="gift-cert-to">{copy.certTo(view.to)}</p>
        <p className="gf-cert-line" data-testid="gift-cert-line">{copy.certLine(view.from)}</p>
        <p className="gf-cert-from" data-testid="gift-cert-from">{copy.certFrom(view.from)}</p>
        <p className="gf-cert-date" data-testid="gift-cert-date">{fullDateText(lang, view.opens_on ?? view.order_date)}</p>
        <p className="gf-cert-tag">{copy.certTagline}</p>
        <button type="button" className="gf-btn" data-testid="gift-to-keep" onClick={() => setStep('keep')}>{copy.certNext}</button>
      </section>,
    )

  // 8. what to keep, and the one thank-you
  return stage(
    <section className="gf-keep" data-testid="gift-keep">
      <h2 className="gf-label">{copy.keepTitle}</h2>
      {scrollAvailable(view) && (
        <p className="gf-row" data-testid="gift-scroll">
          <a className="gf-btn gf-btn-quiet" href={`/api/gift/${view.token}/scroll.png${q}`} download>{copy.saveScroll} · {copy.savePng}</a>
          <a className="gf-btn gf-btn-quiet" href={`/api/gift/${view.token}/scroll.pdf${q}`} download>{copy.savePdf}</a>
        </p>
      )}
      {view.egift && <EgiftReceive view={view} lang={lang} />}
      {!preview && <ReplyBox token={view.token} copy={copy} from={view.from} replied={view.replied} />}
      <p className="gf-row">
        <button type="button" className="gf-btn gf-btn-quiet" data-testid="gift-replay" onClick={() => setStep('film')}>{FILM_COPY[lang].replay}</button>
        <a className="gf-btn gf-btn-quiet" href="/credits" data-testid="animation-credits-link">{FILM_COPY[lang].credits}</a>
      </p>
    </section>,
  )
}

/** The character's reading under it: the kana reading (ja), the pinyin (zh), the romanization and meaning (en). */
function readingLine(view: GiftView): string {
  if (view.language === 'en') return [view.romanization.split(' / ')[0], view.meaning_en].filter(Boolean).join(' · ')
  return view.reading
}

function Envelope({ copy, lang, to, from, memorial, date, reduced, state, locked, onOpen }: {
  copy: GiftCopy
  lang: PageLang
  to: string
  from: string
  memorial: boolean
  /** Which season's liner: the opening date, or the day it was ordered. */
  date: string
  reduced: boolean
  state: 'closed' | 'opening'
  locked?: { opens_on: string; days_left: number }
  onOpen?: () => void
}) {
  const liner = useMemo(() => linerFor(date, memorial), [date, memorial])
  const thisYear = new Date().getFullYear()
  const ref = useRef<HTMLDivElement>(null)
  return (
    <section className="gf-env-screen" data-testid="gift-envelope-screen">
      <p className="gf-label" data-testid="gift-env-label">{memorial ? copy.envLabelMemorial : copy.envLabel}</p>
      <p className="gf-env-line" data-testid="gift-env-line">{memorial ? copy.envLineMemorial : copy.envLine}</p>
      <div
        ref={ref}
        className={`gf-env gf-env-${state}`}
        data-testid="gift-envelope"
        data-state={state}
        data-motion={reduced ? 'fade' : 'full'}
        data-liner={liner.season ?? 'plain'}
        style={{ ['--liner-ground' as string]: liner.ground, ['--liner-image' as string]: liner.image ?? 'none', ['--liner-size' as string]: `${liner.size}px` }}
      >
        <div className="gf-env-back" />
        <div className="gf-env-letter" aria-hidden="true" />
        <div className="gf-env-front">
          <p className="gf-env-to" data-testid="gift-env-to">{copy.to(to)}</p>
          <p className="gf-env-from" data-testid="gift-env-from">{copy.from(from)}</p>
        </div>
        <div className="gf-env-flap" aria-hidden="true"><div className="gf-flap-out" /><div className="gf-flap-in" /></div>
        <div className="gf-seal" aria-hidden="true" data-testid="gift-seal"><i className="gf-seal-l" /><i className="gf-seal-r" /><b>一字礼</b></div>
      </div>
      {locked ? (
        <>
          <p className="gf-locked" data-testid="gift-locked-date">{copy.opensOn(openDateText(lang, locked.opens_on, thisYear))}</p>
          <p className="gf-locked-note" data-testid="gift-locked-note">{copy.daysLeft(locked.days_left)}</p>
        </>
      ) : (
        <button type="button" className="gf-btn gf-btn-hot" data-testid="gift-open" onClick={onOpen} disabled={state === 'opening'}>{copy.open}</button>
      )}
    </section>
  )
}

function ReplyBox({ token, copy, from, replied }: { token: string; copy: GiftCopy; from: string; replied: boolean }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>(replied ? 'sent' : 'idle')
  const send = async () => {
    setPhase('sending')
    try {
      const res = await fetch(`/api/gift/${token}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      setPhase(res.ok || res.status === 409 ? 'sent' : 'error')
    } catch {
      setPhase('error')
    }
  }
  if (phase === 'sent') return <p className="gf-sent" role="status" data-testid="gift-reply-sent">{copy.replySent(from)}</p>
  const left = 200 - [...text].length
  return (
    <form className="gf-reply" data-testid="gift-reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send() }}>
      <h3 className="gf-label">{copy.replyTitle}</h3>
      <textarea value={text} onChange={(e) => setText([...e.target.value].slice(0, 200).join(''))} placeholder={copy.replyPlaceholder} rows={3} maxLength={400} data-testid="gift-reply-text" />
      <p className="gf-count" data-testid="gift-reply-left">{copy.replyLeft(left)}</p>
      {phase === 'error' && <p role="alert" className="gf-error">{copy.replyError}</p>}
      <button type="submit" className="gf-btn gf-btn-hot" data-testid="gift-reply-send" disabled={!text.trim() || phase === 'sending'}>{phase === 'sending' ? copy.replySending : copy.replySend}</button>
    </form>
  )
}
