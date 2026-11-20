// The examples (2026-11-20): up to four real example gifts a visitor can open before writing. A card is a paper slip: the character (cinnabar), its word, the one line, the first picture and one line of
// the moment. Tapping one opens that example's read-only ceremony (/s/<token>). Shown on the landing page (a swipeable row), on /examples, and reached by a ghost 「見本を見る」 button.
// Samples carry no real names: they say 「あなた」 / "You" from 「一字礼」 / "ICHIREI" (engine/sample.ts).

import { useEffect, useState } from 'react'
import type { RevealLang } from './copy.ts'
import { examplesPath, landingPath, writePath } from './paths.ts'
import './examples.css'

interface Card {
  token: string
  language: string
  glyph: string
  word: string
  line: string
  moment: string
  picture: string
}

export const EX = {
  ja: { button: '見本を見る', title: '一字礼の見本', section: '一字礼の見本', all: 'ほかの見本も見る →', make: 'あなたの大切な人へ', lead: '一つの場面が、こんな一字の贈りものになります。', empty: '見本は、まもなく公開します。', alt: '' },
  en: { button: 'See examples', title: 'ICHIREI examples', section: 'Examples', all: 'See all examples →', make: 'Make one for someone of yours', lead: 'One moment becomes a gift like these.', empty: 'Examples are coming soon.', alt: '' },
  'zh-Hant': { button: '看範例', title: '一字禮範例', section: '範例', all: '看更多範例 →', make: '送給你重要的人', lead: '一個片刻，會變成像這樣的一字禮物。', empty: '範例即將公開。', alt: '' },
} as const
const LANG_LABEL: Record<string, string> = { ja: '日本語', en: 'English', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文' }
const lk = (l: RevealLang): 'ja' | 'en' | 'zh-Hant' => (l === 'en' ? 'en' : l === 'zh-Hant' ? 'zh-Hant' : 'ja')

const count = (kind: 'view' | 'card'): void => {
  try {
    void fetch('/api/examples/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }), keepalive: true }).catch(() => {})
  } catch {
    // a count only
  }
}

function useExamples(lang: RevealLang): Card[] | null {
  const [cards, setCards] = useState<Card[] | null>(null)
  useEffect(() => {
    let alive = true
    void fetch(`/api/examples?lang=${lk(lang)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ examples: Card[] }>) : { examples: [] as Card[] }))
      .then((j) => alive && setCards(j.examples ?? []))
      .catch(() => alive && setCards([]))
    return () => {
      alive = false
    }
  }, [lang])
  return cards
}

/** The ghost 「見本を見る」 button — next to the main start button, in "How it works", and under the moment box's guide line. Never a pill. */
export function ExamplesButton({ lang, className = '' }: { lang: RevealLang; className?: string }) {
  return (
    <a className={`exBtn ${className}`.trim()} href={examplesPath(lang)} data-testid="examples-button">
      {EX[lk(lang)].button}
    </a>
  )
}

function ExampleCard({ c, lang, onOpen }: { c: Card; lang: RevealLang; onOpen: () => void }) {
  const here = lk(lang)
  const mine = here === 'zh-Hant' ? c.language.startsWith('zh') : c.language === here
  return (
    <a className="exCard" href={`/s/${c.token}?src=examples`} data-testid="example-card" data-token={c.token} data-lang={c.language} onClick={onOpen}>
      <span className="exPic">{c.picture && <img src={c.picture} alt="" loading="lazy" decoding="async" />}</span>
      <span className="exBody">
        <span className="exFace">
          <span className="exGlyph notranslate" translate="no" data-testid="example-glyph">{c.glyph}</span>
          {c.word && <span className="exWord notranslate" data-testid="example-word">{c.word}</span>}
        </span>
        {c.line && <span className="exLine" data-testid="example-line">{c.line}</span>}
        {c.moment && <span className="exMoment" data-testid="example-moment">{c.moment}</span>}
        {!mine && <span className="exLang" data-testid="example-lang">{LANG_LABEL[c.language] ?? c.language}</span>}
      </span>
    </a>
  )
}

/** The landing page's section: a horizontal row to swipe on a phone (one card and a bit of the next), under it 「ほかの見本も見る →」. Nothing is drawn when there are no examples. */
export function ExamplesSection({ lang }: { lang: RevealLang }) {
  const cards = useExamples(lang)
  if (!cards || cards.length === 0) return null
  const t = EX[lk(lang)]
  return (
    <section className="exSection" id="examples" data-testid="examples-section" aria-label={t.section}>
      <div className="wrap">
        <h2 className="exH">{t.section}</h2>
        <div className="exRow" data-testid="examples-row">
          {cards.map((c) => <ExampleCard key={c.token} c={c} lang={lang} onOpen={() => count('card')} />)}
        </div>
        <p className="exAll"><a href={examplesPath(lang)} data-testid="examples-all">{t.all}</a></p>
      </div>
    </section>
  )
}

/** /examples, /en/examples, /zh/examples. */
export default function ExamplesPage({ lang }: { lang: RevealLang }) {
  const cards = useExamples(lang)
  const t = EX[lk(lang)]
  useEffect(() => {
    document.documentElement.classList.add('rv-page')
    document.title = `${t.title} · ICHIREI`
    count('view')
    return () => document.documentElement.classList.remove('rv-page')
  }, [t.title])
  return (
    <div className="rv exPage" data-testid="examples-page" lang={lang}>
      <header className="top writeTop">
        <div className="wrap">
          <a className="brand" href={landingPath(lang)}>
            <span className="ji notranslate" aria-hidden="true">字</span>
            <b>ICHIREI</b>
          </a>
          <div className="topR">
            <a className="writeBack" href={landingPath(lang)}>←</a>
          </div>
        </div>
      </header>
      <main className="wrap exMain">
        <h1 className="exTitle" data-testid="examples-title">{t.title}</h1>
        <p className="exLead">{t.lead}</p>
        {cards === null && <p className="exLead">…</p>}
        {cards !== null && cards.length === 0 && <p className="exLead">{t.empty}</p>}
        <div className="exGrid">
          {(cards ?? []).map((c) => <ExampleCard key={c.token} c={c} lang={lang} onOpen={() => count('card')} />)}
        </div>
        <p className="exMake"><a className="btn primary" data-testid="examples-make" href={`${writePath(lang)}?src=examples`}>{t.make}</a></p>
      </main>
    </div>
  )
}
