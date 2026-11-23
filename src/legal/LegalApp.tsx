import { useEffect } from 'react'
import { legalView, rowValue } from './legal-copy.ts'
import { useComingSoon, useSizes } from '../demo/useSizes.ts'
import { SHIPS } from '../order/packages.ts'
import { toRevealLang } from '../reveal/lang.ts'
import { useLanguage } from '../useLanguage.ts'
import type { UiLanguage } from '../demo/i18n.ts'
import '../reveal/reveal.css'

/** 「クレジット・ライセンス」: the credits page is linked from the footer and from here only (Part 15, 2026-11-20). */
const CREDITS_LINK = { ja: 'クレジット・ライセンス', en: 'Credits & licences', 'zh-Hant': '致謝與授權' } as const

// /legal — 特定商取引法に基づく表記, the return rules and three short questions, in ja / zh-Hant / en. Linked from the footer and from beside the order button.
// The seller's details are the owner's own (src/legal/legal-copy.ts); the e-mail address is plain, selectable text.

const LANGS: { id: UiLanguage; label: string }[] = [
  { id: 'ja', label: '日本語' },
  { id: 'zh-Hant', label: '繁中' },
  { id: 'en', label: 'EN' },
]

export default function LegalApp() {
  const [language, setLanguage] = useLanguage()
  const lang = toRevealLang(language)
  const sizes = useSizes()
  const soon = useComingSoon()
  // everything about the wooden sizes shows only while they are on sale (the page asks /api/sizes once; until it answers, the e-gift version shows)
  const woodOnSale = !!sizes && sizes.some((p) => SHIPS[p] && !soon.includes(p))
  const t = legalView(lang, woodOnSale)
  useEffect(() => {
    document.title = `${t.title} · ICHIREI`
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang
  }, [t.title, lang])
  return (
    <div className="rv legal" data-testid="legal-page">
      <main className="wrap legalWrap">
        <nav className="legalLang" aria-label="language">
          {LANGS.map((l) => (
            <button key={l.id} type="button" aria-pressed={toRevealLang(l.id) === lang ? 'true' : 'false'} data-lang={l.id} onClick={() => setLanguage(l.id)}>
              {l.label}
            </button>
          ))}
        </nav>
        <h1>{t.title}</h1>
        <p className="sent">{t.lead}</p>
        <h2>{t.tableTitle}</h2>
        <dl className="legalRows" data-testid="legal-rows">
          {t.rows.map((r) => (
            <div key={r.label} className="legalRow">
              <dt>{r.label}</dt>
              <dd data-testid={/^[^\s@]+@[^\s@]+$/.test(r.value) ? 'legal-email' : r.key === 'delivery' ? 'legal-delivery' : undefined}>{rowValue(lang, r, woodOnSale)}</dd>
            </div>
          ))}
        </dl>
        <h2 id="returns">{t.returnsTitle}</h2>
        <div className="legalReturns" data-testid="legal-returns">
          {t.sections.map((x, i) => (
            <section key={x.heading} id={i === 0 ? 'refund' : undefined} data-testid="legal-section">
              <h3>{x.heading}</h3>
              <p>{x.body}</p>
            </section>
          ))}
        </div>
        <p data-testid="legal-cancel-time">{t.cancelTime}</p>
        <h2 id="privacy">{t.privacy.heading}</h2>
        <p data-testid="legal-privacy">{t.privacy.body}</p>
        <p data-testid="legal-email-use">{t.emailUse}</p>
        <p data-testid="legal-retention">{t.retention}</p>
        <p data-testid="legal-signin">{t.signIn}</p>
        <h2 id="tool" data-testid="legal-tool-heading">{t.tool.heading}</h2>
        <p data-testid="legal-tool">{t.tool.body}</p>
        <h2 id="faq">{t.faqTitle}</h2>
        <div className="legalFaq" data-testid="legal-faq">
          {t.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
        <p>
          <a href={lang === 'en' ? '/en/credits' : lang === 'zh-Hant' ? '/zh/credits' : '/credits'} className="legalLink" data-testid="legal-credits">{CREDITS_LINK[lang]}</a>
        </p>
        <p>
          <a href="/" className="legalLink">{t.back}</a>
        </p>
      </main>
    </div>
  )
}
