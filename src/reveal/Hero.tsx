import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CATS, EXAMPLES, SCENE, TEXT, type RevealLang } from './copy.ts'
import { rich } from './rich.tsx'
import Picture from './Picture.tsx'
import { preloadPicture } from './preload.ts'
import { sceneName } from './scenes.ts'
import { usePrefersReducedMotion } from './usePrefersReducedMotion.ts'
import { approxShort, type Currency, type Rates } from './currency.ts'
import { PACKAGE_PRICE_JPY } from '../order/packages.ts'
import { usePromoOn, useSale, useUsd } from '../demo/useSizes.ts'
import DaysOfThanks from '../loop/DaysOfThanks'
import { usePromo } from '../loop/promo'
import { promoPriceLine } from '../loop/promo-price'
import { UsdPriceView } from '../order/SalePrice.tsx'
import { usdLaunchLine } from '../order/usd.ts'
import { writeLink } from './paths'

const INTERVAL_MS = 6000
const SWAP_MS = 350
const HERO_SIZES = '(max-width: 860px) 100vw, 480px'

const EXAMPLE_WORD: Record<RevealLang, string> = { en: 'Example', ja: '例', 'zh-Hant': '範例' }

/** The hero: the pitch, and a live-looking example — a short story turning into its character, six in rotation. */
export default function Hero({ lang, currency, rates, woodOnSale = false }: { lang: RevealLang; currency: Currency; rates: Rates | null; woodOnSale?: boolean }) {
  const t = TEXT[lang]
  const examples = EXAMPLES[lang]
  const reduce = usePrefersReducedMotion()
  const [ex, setEx] = useState(0)
  const [swap, setSwap] = useState(false)
  const [hold, setHold] = useState(false) // pointer or keyboard focus is on the card: stop advancing
  const [manual, setManual] = useState(false) // the visitor moved it themselves: announce changes to screen readers
  const timer = useRef(0)

  // A slide changes only once its picture is really there (2026-11-15): the current picture stays until then, so no slide ever shows an empty panel with its caption. A picture that cannot load at
  // all is skipped. The next slide's picture is fetched ahead of time.
  const pending = useRef(0)
  const [failed, setFailed] = useState<Record<string, true>>({})
  const go = useCallback(
    (i: number, tries = 0) => {
      window.clearTimeout(timer.current)
      const ticket = ++pending.current
      const c = examples[i].c
      void preloadPicture(sceneName(lang, c), HERO_SIZES).then((ok) => {
        if (ticket !== pending.current) return // the visitor has already moved on
        if (!ok) {
          setFailed((f) => ({ ...f, [c]: true }))
          if (tries < examples.length - 1) go((i + 1) % examples.length, tries + 1)
          return
        }
        if (reduce) {
          setEx(i)
          return
        }
        setSwap(true)
        timer.current = window.setTimeout(() => {
          setEx(i)
          setSwap(false)
        }, SWAP_MS)
      })
    },
    [reduce, examples, lang],
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
  // the next slide's picture, fetched while this one is shown
  useEffect(() => {
    void preloadPicture(sceneName(lang, examples[(ex + 1) % examples.length].c), HERO_SIZES)
  }, [ex, lang, examples])
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
  const sale = useSale(lang)
  // English (2026-11-14): a fixed dollar price ($25; while the sale is on only the sale price, with the launch line under it), never an "about" figure or a struck price. The other languages keep their converted line.
  const usdPrice = useUsd()
  const approx = lang === 'en' ? null : approxShort(PACKAGE_PRICE_JPY.simple, currency, rates, lang)
  // While the promotion runs (en and ja; zh is unchanged) the hero says ONE thing: write your moment, and today the whole gift can be free. The free-gift box sits right under the button, the price
  // shrinks to one small line under the box, and the occasion chips come last. After the promotion the hero is today's layout again, by itself (usePromoOn follows the promotion's own end).
  const promoOn = usePromoOn()
  const promoState = usePromo()
  const promoLayout = (lang === 'en' || lang === 'ja') && promoOn
  const soldOut = promoLayout && !!promoState?.on && !promoState.hold && (promoState.left ?? 1) === 0
  const priceLine = promoLayout ? promoPriceLine(lang as 'en' | 'ja', soldOut, usdPrice, sale) : ''

  return (
    <section className="hero">
      <div className="wrap heroGrid">
        <div className="heroCopy">
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{rich(t.h1)}</h1>
          <p className="lead">{woodOnSale ? t.sub : t.subS}</p>
          {lang === 'en' && <p className="heroTokyo" data-testid="hero-tokyo">Designed in Tokyo. Delivered worldwide.</p>}
          <div className="ctaRow">
            <a className="btn primary" href={writeLink()}>
              {t.ctaHero}
            </a>
            <span className="free">{rich(t.freeLine)}</span>
            {!promoLayout && approx && <span className="approxHero">{approx}</span>}
            {!promoLayout && lang === 'en' && (
              <span className="approxHero usdHero">
                <span data-testid="usd-hero"><UsdPriceView price={usdPrice} sale={sale} id="hero" /></span>
                {sale && <span className="usdLaunch" data-testid="usd-hero-line">{usdLaunchLine(usdPrice, sale.until)}</span>}
              </span>
            )}
          </div>
          {promoLayout && (
            <>
              <DaysOfThanks lang={lang as 'en' | 'ja'} compact />
              <p className={`promoPrice${soldOut ? ' soldOut' : ''}`} data-testid="promo-price">
                {priceLine}
              </p>
            </>
          )}
          <ul className="chips">
            {(['c1', 'c2', 'c3', 'c4', 'c5'] as const).map((k) => (
              <li key={k}>{t[k]}</li>
            ))}
          </ul>
        </div>

        <div className="heroArt">
          <figure className={`ph${swap ? ' swap' : ''}${failed[e.c] ? ' noimg' : ''}`} style={{ ['--cat' as string]: `var(--c-${e.c})` }} data-testid="hero-figure" data-slide={e.c}>
            <span className="phk notranslate" aria-hidden="true">
              {e.k}
            </span>
            <span className="phc">{SCENE[e.c][lang]}</span>
            <Picture key={e.c} name={sceneName(lang, e.c)} width={4} height={5} eager sizes={HERO_SIZES} onFail={() => setFailed((f) => ({ ...f, [e.c]: true }))} />
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
              <span className="k notranslate">
                {e.k}
              </span>
              <div className="meta">
                {/* English shows the English word only, never the romanized reading (owner's rule, 2026-11-16) */}
                {lang === 'en' ? (
                  <span className="rd" data-testid="hero-sample-word">{e.m}</span>
                ) : (
                  <span className="rd">
                    {e.rd} <small>· {e.m}</small>
                  </span>
                )}
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
