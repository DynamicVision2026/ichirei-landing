import { useEffect } from 'react'
import { toRevealLang } from '../reveal/lang.ts'
import { useLanguage } from '../useLanguage.ts'
import { CREDITS_COPY as COPY, OFL_NAME as OFL } from './credits-copy.ts'
import '../fonts.css'
import './animation.css'

// /credits — the attributions the typefaces behind the story film and the stroke data of the gift page (KanjiVG, CC BY-SA 3.0) require.
// Part 15 (2026-11-20): it is linked only from the small footer of the landing pages and from /legal (never from the ceremony), and it shows ONE language — the page's own (ja, en or zh-Hant) — not a mixed
// two-language text. The facts are the same in each; the licence names and the typeface names are proper names.


export default function CreditsApp() {
  const [language] = useLanguage()
  const lang = toRevealLang(language)
  const t = COPY[lang]
  useEffect(() => {
    document.title = `${t.title} — ICHIREI`
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang
  }, [t.title, lang])
  const home = lang === 'en' ? '/en' : lang === 'zh-Hant' ? '/zh' : '/'
  return (
    <main className="an-page an-credits" data-testid="credits-page" lang={lang === 'zh-Hant' ? 'zh-Hant' : lang} data-lang={lang}>
      <h1>{t.heading}</h1>
      <p>{t.intro}</p>
      {t.fonts.map((it) => (
        <section key={it.name} data-testid="credit-item">
          <h2>{it.name}</h2>
          <p>{it.use}</p>
          <p>{it.credit}</p>
          <p>
            {t.licenceLabel}: <a href="https://openfontlicense.org" rel="noreferrer">{OFL}</a> · <a href={it.href} rel="noreferrer">{it.href}</a>
          </p>
        </section>
      ))}
      <h2>{t.illustrationsHeading}</h2>
      <p data-testid="credit-illustrations">{t.illustrations}</p>
      <h2>{t.strokesHeading}</h2>
      <p data-testid="credit-kanjivg">
        {t.strokes.before}<a href="https://kanjivg.tagaini.net/" rel="noreferrer">{t.strokes.kanjivg}</a>{t.strokes.middle}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/" rel="noreferrer">{t.strokes.cc}</a>{t.strokes.after}<a href="/strokes/kanjivg-subset.json">{t.strokes.file}</a>{t.strokes.end}
      </p>
      <h2>{t.musicHeading}</h2>
      <p data-testid="credit-music">{t.music}</p>
      <p>
        <a href={home}>{t.home}</a>
      </p>
    </main>
  )
}
