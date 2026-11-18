import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useLanguage } from '../useLanguage'
import { trackPageView } from '../demo/analytics'
import { DOCUMENT, REVEAL_LANGS, TEXT, type RevealLang } from './copy'
import { Angles, Closing, Dock, Faq, Footer, Gifts, Moments, Opening, Philosophy, Reviews, Steps, StoryShape, Strip } from './Sections'
import Hero from './Hero'
import ClaimBanner from '../claim/ClaimBanner'
import { Receive, UsBanner, UsKanji, UsWho } from './UsSections'
import { useCurrency } from './useCurrency'
import { toRevealLang } from './lang'
import { useMemorialSelected } from './occasion-store'
import { useComingSoon, useSizes } from '../demo/useSizes'
import { SHIPS } from '../order/packages'
import LoopBars from '../loop/LoopBars'
import MyGiftsButton from '../loop/MyGifts'
import WelcomeBack from '../loop/WelcomeBack'
import { LOOP } from '../loop/copy'
import { landingPath, writeHref, writePath } from './paths'

// The story flow (composer → cards → order) is the heaviest part of the page and sits below the fold: it loads
// right after the first paint, so the hero shows without waiting for it.
const DemoApp = lazy(() => import('../demo/DemoApp'))

const SWITCH_LABEL: Record<RevealLang, string> = { en: 'EN', ja: '日本語', 'zh-Hant': '繁中' }

function setMeta(selector: string, attr: string, value: string) {
  document.querySelector(selector)?.setAttribute(attr, value)
}

/**
 * The customer site (/, /en, /zh): the Reveal design. HERO → (welcome back) → strip → PHILOSOPHY → STORY SHAPE → ANGLES → STEPS → MOMENTS → REVIEWS → GIFTS → FAQ → CLOSING.
 * With `write` (2026-11-16) it is the writing room (/write, /en/write, /zh/write): a page of its own that holds ONLY the flow (DemoApp in customer mode: the choices, the moment,
 * the characters, the result, the order section and checkout) under a reduced header — the wordmark, "My gifts" and a quiet "← Back". Every "Write your moment" leads there in the
 * same tab; the phone's Back and "← Back" return to the landing page, and the draft, the hold and the saved gifts are kept (they are saved already). Old links with #write / #result
 * (and the saved gifts' ?resume=) open the writing room.
 */
export default function RevealPage({ write = false }: { write?: boolean }) {
  const [uiLang, setUiLang] = useLanguage()
  const lang = toRevealLang(uiLang)
  const t = TEXT[lang]
  const { currency, rates, setCurrency } = useCurrency(lang)
  // the wooden sizes show only while they are on sale (the page asks /api/sizes once; until it answers, the e-gift version shows)
  const sizes = useSizes()
  const soon = useComingSoon()
  const woodOnSale = !!sizes && sizes.some((p) => SHIPS[p] && !soon.includes(p))
  const memorial = useMemorialSelected() // 偲ぶ picked in the form → the copy says two cards, no free pick

  // the owner dashboard's page view: once per tab session, no cookie, no third party
  useEffect(() => {
    trackPageView(lang)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A visitor whose stored language is Simplified Chinese (from /demo) gets the page in Traditional Chinese.
  useEffect(() => {
    if (uiLang === 'zh-Hans') setUiLang('zh-Hant')
  }, [uiLang, setUiLang])

  // The tab title, the meta description, <html lang> and the share tags follow the language.
  useEffect(() => {
    const d = DOCUMENT[lang]
    document.title = d.title
    document.documentElement.lang = lang
    const description = woodOnSale ? d.description : (d.descriptionS ?? d.description) // (nothing about carving while the wooden sizes are "coming soon")
    setMeta('meta[name=description]', 'content', description)
    setMeta('meta[property="og:title"]', 'content', d.title)
    setMeta('meta[property="og:description"]', 'content', description)
    setMeta('meta[property="og:locale"]', 'content', lang === 'ja' ? 'ja_JP' : lang === 'zh-Hant' ? 'zh_TW' : 'en_US')
  }, [lang, woodOnSale])

  // The page behind and around the light design is light too (the /demo harness is not).
  useEffect(() => {
    document.documentElement.classList.add('rv-page')
    return () => document.documentElement.classList.remove('rv-page')
  }, [])

  // the landing page: an old #write / #result link, or a saved gift's ?resume=, opens the writing room (same tab, the query kept)
  const toRoom = !write && (window.location.hash === '#write' || window.location.hash === '#result' || new URLSearchParams(window.location.search).has('resume'))
  useEffect(() => {
    if (toRoom) window.location.replace(writePath(lang) + window.location.search)
  }, [toRoom, lang])
  // …also when only the hash changes on an open landing page (an old in-page link to #write)
  useEffect(() => {
    if (write) return
    const onHash = () => {
      if (window.location.hash === '#write' || window.location.hash === '#result') window.location.replace(writePath(lang) + window.location.search)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [write, lang])

  const aside: ReactNode = (
    <>
      <span className="eyebrow">{t.wrEye}</span>
      <h2>{t.wrH}</h2>
      <ul className="tips">
        {([t.tp1, t.tp2, t.tp3, t.tp4, t.tp5] as const).map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </>
  )

  if (toRoom) return null

  if (write)
    return (
      <div className="rv writeRoom" id="top" data-testid="write-room">
        <header className="top writeTop">
          <div className="wrap">
            <a className="brand" href={landingPath(lang)} data-testid="write-brand">
              <span className="ji notranslate" aria-hidden="true">
                字
              </span>
              <b>ICHIREI</b>
            </a>
            <div className="topR">
              <MyGiftsButton lang={lang} />
              <a className="writeBack" href={landingPath(lang)} data-testid="write-back">
                {LOOP[lang].back}
              </a>
            </div>
          </div>
        </header>
        <main>
          <ClaimBanner language={uiLang} />
          <Suspense
            fallback={
              <section className="tintBand" id="write">
                <div className="wrap writeGrid">
                  <div>{aside}</div>
                  <div className="composer" style={{ minHeight: '40rem' }} aria-busy="true" />
                </div>
              </section>
            }
          >
            <DemoApp mode="customer" aside={aside} />
          </Suspense>
        </main>
      </div>
    )

  return (
    <div className="rv" id="top">
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#top">
            <span className="ji notranslate" aria-hidden="true">
              字
            </span>
            <b>ICHIREI</b>
          </a>
          <div className="topR">
            <div className="lang" role="group" aria-label="Language">
              {REVEAL_LANGS.map((l) => (
                <button key={l} type="button" data-lang={l} lang={l} aria-pressed={lang === l} onClick={() => setUiLang(l)}>
                  {SWITCH_LABEL[l]}
                </button>
              ))}
            </div>
            <MyGiftsButton lang={lang} className="topGifts" />
            <a className="btn primary" href={writeHref(lang)}>
              {t.ctaTop}
            </a>
          </div>
        </div>
      </header>

      <main>
        <LoopBars lang={lang} />
        <ClaimBanner language={uiLang} />
        <Hero lang={lang} currency={currency} rates={rates} woodOnSale={woodOnSale} />
        <WelcomeBack lang={lang} />
        <Opening t={t} />
        {lang === 'en' && <UsBanner />}
        <Strip t={t} woodOnSale={woodOnSale} />
        {lang === 'en' && <UsKanji />}
        <Philosophy t={t} lang={lang} />
        <StoryShape t={t} />
        <Angles t={t} lang={lang} />
        <Steps t={t} lang={lang} memorial={memorial} woodOnSale={woodOnSale} />
        <Moments t={t} memorial={memorial} />
        <Reviews t={t} />
        <Receive lang={lang} />
        {lang === 'en' && <UsWho />}
        <Gifts t={t} lang={lang} currency={currency} rates={rates} onCurrency={setCurrency} woodOnSale={woodOnSale} />
        <Faq t={t} lang={lang} woodOnSale={woodOnSale} />
        <Closing t={t} lang={lang} woodOnSale={woodOnSale} />
      </main>
      <Footer t={t} lang={lang} />
      <Dock t={t} />
    </div>
  )
}
