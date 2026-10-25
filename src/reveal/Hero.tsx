import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CATS, EXAMPLES, SCENE, TEXT, type RevealLang } from './copy.ts'
import { rich } from './rich.tsx'
import Picture from './Picture.tsx'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.ts'
import { approxShort, type Currency, type Rates } from './currency.ts'
import { PACKAGE_PRICE_JPY } from '../order/packages.ts'

const INTERVAL_MS = 6000
const SWAP_MS = 350

const EXAMPLE_WORD: Record<RevealLang, string> = { en: 'Example', ja: '例', 'zh-Hant': '範例' }

/** The hero: the pitch, and a live-looking example — a short story turning into its character, six in rotation. */
export default function Hero({ lang, currency, rates }: { lang: RevealLang; currency: Currency; rates: Rates | null }) {
  const t = TEXT[lang]
  const examples = EXAMPLES[lang]
  const reduce = usePrefersReducedMotion()
  const [ex, setEx] = useState(0)
  const [swap, setSwap] = useState(false)
  const [hold, setHold] = useState(false) // pointer or keyboard focus is on the card: stop advancing
  const [manual, setManual] = useState(false) // the visitor moved it themselves: announce changes to screen readers
  const timer = useRef(0)

  const go = useCallback(
    (i: number) => {
      window.clearTimeout(timer.current)
      if (reduce) {
        setEx(i)
        return
      }
      setSwap(true)
      timer.current = window.setTimeout(() => {
        setEx(i)
        setSwap(false)
      }, SWAP_MS)
    },
    [reduce],
  )
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Auto-advance: never with reduced motion, and not while the visitor is on the card.
  const auto = !reduce && !hold
  useEffect(() => {
    if (!auto) return
    const id = window.setTimeout(() => go((ex + 1) % examples.length), INTERVAL_MS)
    return () => window.clearTimeout(id)
  }, [auto, ex, go, examples.length])

  const e = examples[ex]
  const pick = (i: number) => {
    setManual(true)
    go(i)
  }
  const onDotsKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (ex + step + examples.length) % examples.length
    pick(next)
    ;(event.currentTarget.querySelectorAll('button')[next] as HTMLElement | undefined)?.focus()
  }
  const approx = approxShort(PACKAGE_PRICE_JPY.simple, currency, rates, lang)

  return (
    <section className="hero">
      <div className="wrap heroGrid">
        <div className="heroCopy">
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{rich(t.h1)}</h1>
          <p className="lead">{t.sub}</p>
          <div className="ctaRow">
            <a className="btn primary" href="#write">
              {t.ctaHero}
            </a>
            <span className="free">{rich(t.freeLine)}</span>
            {approx && <span className="approxHero">{approx}</span>}
          </div>
          <ul className="chips">
            {(['c1', 'c2', 'c3', 'c4', 'c5'] as const).map((k) => (
              <li key={k}>{t[k]}</li>
            ))}
          </ul>
        </div>

        <div className="heroArt">
          <figure className={`ph${swap ? ' swap' : ''}`} style={{ ['--cat' as string]: `var(--c-${e.c})` }}>
            <span className="phk" aria-hidden="true">
              {e.k}
            </span>
            <span className="phc">{SCENE[e.c][lang]}</span>
            <Picture key={e.c} name={`scenes/${e.c}`} width={4} height={5} eager={ex === 0} sizes="(max-width: 860px) 100vw, 480px" />
          </figure>
          <div
            className={`reveal${swap ? ' swap' : ''}${auto ? ' run' : ''}`}
            style={{ ['--cat' as string]: `var(--c-${e.c})` }}
            aria-live={manual ? 'polite' : 'off'}
            onMouseEnter={() => setHold(true)}
            onMouseLeave={() => setHold(false)}
            onFocus={() => setHold(true)}
            onBlur={() => setHold(false)}
          >
            <div className="tag">
              <span className="cat">{CATS[e.c][lang]}</span>
              <span>{e.who}</span>
              <span>{e.occ}</span>
            </div>
            <p className="story">{e.story}</p>
            <div className="arrow" aria-hidden="true" />
            <div className="out">
              <span className="k">
                {e.k}
              </span>
              <div className="meta">
                <span className="rd">
                  {e.rd} <small>· {e.m}</small>
                </span>
                <p className="gz">{e.gz}</p>
              </div>
            </div>
            <div className="bar" aria-hidden="true">
              <i key={ex} />
            </div>
            <div className="dots" role="group" aria-label={EXAMPLE_WORD[lang]} onKeyDown={onDotsKey}>
              {examples.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${EXAMPLE_WORD[lang]} ${i + 1}`}
                  aria-current={i === ex ? 'true' : 'false'}
                  tabIndex={i === ex ? 0 : -1}
                  onClick={() => pick(i)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
