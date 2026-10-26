import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useLanguage } from '../useLanguage'
import { DOCUMENT, REVEAL_LANGS, TEXT, type RevealLang } from './copy'
import { Angles, Closing, Dock, Faq, Footer, Gifts, Moments, Philosophy, Reviews, Steps, StoryShape, Strip } from './Sections'
import Hero from './Hero'
import { useCurrency } from './useCurrency'
import { toRevealLang } from './lang'

// The story flow (composer → cards → order) is the heaviest part of the page and sits below the fold: it loads
// right after the first paint, so the hero shows without waiting for it.
const DemoApp = lazy(() => import('../demo/DemoApp'))

const SWITCH_LABEL: Record<RevealLang, string> = { en: 'EN', ja: '日本語', 'zh-Hant': '繁中' }

function setMeta(selector: string, attr: string, value: string) {
  document.querySelector(selector)?.setAttribute(attr, value)
}

/**
 * The customer site (/): the Reveal design. HERO → strip → PHILOSOPHY → STORY SHAPE → ANGLES → WRITE (the real
 * flow: DemoApp in customer mode) → STEPS → MOMENTS → REVIEWS → GIFTS → FAQ → CLOSING.
 */
export default function RevealPage() {
  const [uiLang, setUiLang] = useLanguage()
  const lang = toRevealLang(uiLang)
  const t = TEXT[lang]
  const { currency, rates, setCurrency } = useCurrency(lang)

  // A visitor whose stored language is Simplified Chinese (from /demo) gets the page in Traditional Chinese.
  useEffect(() => {
    if (uiLang === 'zh-Hans') setUiLang('zh-Hant')
  }, [uiLang, setUiLang])

  // The tab title, the meta description, <html lang> and the share tags follow the language.
  useEffect(() => {
    const d = DOCUMENT[lang]
    document.title = d.title
    document.documentElement.lang = lang
    setMeta('meta[name=description]', 'content', d.description)
    setMeta('meta[property="og:title"]', 'content', d.title)
    setMeta('meta[property="og:description"]', 'content', d.description)
    setMeta('meta[property="og:locale"]', 'content', lang === 'ja' ? 'ja_JP' : lang === 'zh-Hant' ? 'zh_TW' : 'en_US')
  }, [lang])

  // The page behind and around the light design is light too (the /demo harness is not).
  useEffect(() => {
    document.documentElement.classList.add('rv-page')
    return () => document.documentElement.classList.remove('rv-page')
  }, [])

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
            <a className="btn primary" href="#write">
              {t.ctaTop}
            </a>
          </div>
        </div>
      </header>

      <main>
        <Hero lang={lang} currency={currency} rates={rates} />
        <Strip t={t} />
        <Philosophy t={t} />
        <StoryShape t={t} />
        <Angles t={t} lang={lang} />
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
        <Steps t={t} />
        <Moments t={t} />
        <Reviews t={t} />
        <Gifts t={t} lang={lang} currency={currency} rates={rates} onCurrency={setCurrency} />
        <Faq t={t} />
        <Closing t={t} />
      </main>
      <Footer t={t} />
      <Dock t={t} />
    </div>
  )
}
