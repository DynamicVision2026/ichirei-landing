// Part 24 (2026-11-21): teach people to write a moment that can be painted. The four pictures can only show what the sender wrote, so the writing page says it plainly (one line + four light guides + a small
// example made from the language's featured sample), and the landing page shows the same thing as a section: "One moment, four pictures and a poem". Nothing here calls the pictures anything but ink pictures.
// The example and the section exist only while the language has a featured sample (engine/sample.ts featuredFor): with none, the line and the guides stand alone and the section is not drawn.

import { useEffect, useState } from 'react'
import type { RevealLang } from './copy.ts'
import './examples.css'

interface Featured {
  token: string
  language: string
  glyph: string
  word: string
  moment: string
  pictures: Array<{ src: string; caption: string }>
  poem: string[]
}

export const GUIDE = {
  ja: {
    line: 'あなたのひと場面は、4枚の墨の絵と一首の歌になります。絵になるように、目に見えることを書いてください。',
    guides: ['どこで、いつ', 'その人がしたこと', 'その人のひと言', 'そのあと'],
    exampleLabel: '例：ひと場面が、4枚の絵になりました',
    section: 'ひと場面が、4枚の絵と一首の歌に',
    momentLabel: 'ひと場面',
    poemLabel: '一首の歌',
    toExample: 'どう絵になるかを見る →',
    lang: 'ja',
  },
  en: {
    line: 'Your moment becomes four ink pictures and one poem. Write what could be seen.',
    guides: ['Where and when', 'What they did', 'What they said, even one word', 'What happened next'],
    exampleLabel: 'An example: one moment, four pictures',
    section: 'One moment, four pictures and a poem',
    momentLabel: 'The moment',
    poemLabel: 'The poem',
    toExample: 'See how a moment becomes pictures →',
    lang: 'en',
  },
  'zh-Hant': {
    line: '你寫下的片刻，會成為四幅水墨畫和一首詩。請寫下看得見的細節。',
    guides: ['在哪裡、什麼時候', '他做了什麼', '他說的一句話', '之後呢'],
    exampleLabel: '範例：一個片刻，變成四幅畫',
    section: '一個片刻，四幅畫與一首詩',
    momentLabel: '片刻',
    poemLabel: '一首詩',
    toExample: '看片刻如何成畫 →',
    lang: 'zh-Hant',
  },
} as const
const lk = (l: RevealLang): 'ja' | 'en' | 'zh-Hant' => (l === 'en' ? 'en' : l === 'zh-Hant' ? 'zh-Hant' : 'ja')

const asked = new Map<string, Promise<Featured | null>>()
function loadFeatured(lang: RevealLang): Promise<Featured | null> {
  const k = lk(lang)
  let p = asked.get(k)
  if (!p) {
    p = fetch(`/api/examples/featured?lang=${k}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ featured: Featured | null }>) : { featured: null }))
      .then((j) => (j.featured && Array.isArray(j.featured.pictures) && j.featured.pictures.length === 4 ? j.featured : null))
      .catch(() => null)
    asked.set(k, p)
  }
  return p
}

/** The language's featured sample once the server has said there is one (null while loading or when there is none). */
export function useFeatured(lang: RevealLang): Featured | null {
  const [f, setF] = useState<Featured | null>(null)
  useEffect(() => {
    let alive = true
    void loadFeatured(lang).then((x) => alive && setF(x))
    return () => {
      alive = false
    }
  }, [lang])
  return f
}

function Pictures({ f, testid }: { f: Featured; testid: string }) {
  return (
    <ol className="wgPics" data-testid={testid}>
      {f.pictures.map((p, i) => (
        <li key={i} className="wgPic">
          <img src={p.src} alt="" loading="lazy" decoding="async" />
          <span className="wgCap" data-testid="guide-example-caption">{p.caption}</span>
        </li>
      ))}
    </ol>
  )
}

/** Under 「忘れられない、ひと場面」: the one line, four light guides (a numbered list — not form fields), and the small example. */
export function WriteGuide({ lang }: { lang: RevealLang }) {
  const t = GUIDE[lk(lang)]
  const f = useFeatured(lang)
  return (
    <div className="wg" data-testid="write-guide" lang={t.lang}>
      <p className="wgLine" data-testid="write-guide-line">{t.line}</p>
      <ol className="wgList" data-testid="write-guide-list">
        {t.guides.map((g, i) => (
          <li key={i} data-testid="write-guide-item">{g}</li>
        ))}
      </ol>
      {f && (
        <div className="wgEx" data-testid="write-example">
          <p className="wgExLabel">{t.exampleLabel}</p>
          {f.moment && <p className="wgMoment" data-testid="write-example-moment">{f.moment}</p>}
          <Pictures f={f} testid="write-example-pictures" />
        </div>
      )}
    </div>
  )
}

/** The landing section: left the moment, right its four pictures and the poem; stacked on a phone. Not drawn without a featured sample. */
export function OneMoment({ lang }: { lang: RevealLang }) {
  const t = GUIDE[lk(lang)]
  const f = useFeatured(lang)
  if (!f) return null
  return (
    <section className="wgSection" id="one-moment" data-testid="one-moment" aria-label={t.section}>
      <div className="wrap">
        <h2 className="wgH">{t.section}</h2>
        <div className="wgSplit">
          <div className="wgLeft">
            <p className="wgSmall">{t.momentLabel}</p>
            <p className="wgMomentBig" data-testid="one-moment-text">{f.moment}</p>
          </div>
          <div className="wgRight">
            <Pictures f={f} testid="one-moment-pictures" />
            {f.poem.length > 0 && (
              <div className="wgPoem" data-testid="one-moment-poem">
                <p className="wgSmall">{t.poemLabel}</p>
                {f.poem.map((l, i) => <span key={i} className="wgPoemLine">{l}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** A small link in "How it works" step 1 to that section; only while it exists. */
export function ToOneMoment({ lang }: { lang: RevealLang }) {
  const f = useFeatured(lang)
  if (!f) return null
  return <a className="wgTo" href="#one-moment" data-testid="step1-link">{GUIDE[lk(lang)].toExample}</a>
}
