import { useEffect, useState } from 'react'
import type { RevealLang } from '../reveal/copy.ts'
import { writePath } from '../reveal/paths.ts'
import { toRevealLang } from '../reveal/lang.ts'
import { LOOP } from './copy.ts'
import { useMe } from './me.ts'
import './loop.css'

interface Item {
  id: string
  language: string
  card: { kanji: string; reading: string; word: string; line: string }
}

/**
 * The landing page for a returning visitor with saved gifts (2026-11-16), just under the hero: "Welcome back. Your saved gifts:" — each saved character large with its word (English on /en;
 * the Japanese / Chinese pages show the word, else the reading, in their own language) and "Give this gift →". Up to three, then "See all →" to My gifts. Nothing shows without saved gifts.
 */
export default function WelcomeBack({ lang }: { lang: RevealLang }) {
  const me = useMe()
  const n = me?.basket.count ?? 0
  const [items, setItems] = useState<Item[] | null>(null)
  useEffect(() => {
    if (n < 1) return
    let alive = true
    void (async () => {
      try {
        const r = await fetch('/api/basket', { credentials: 'same-origin' })
        if (!r.ok) return
        const j = (await r.json()) as { items?: Item[] }
        if (alive && Array.isArray(j.items)) setItems(j.items)
      } catch {
        // the card simply does not show
      }
    })()
    return () => {
      alive = false
    }
  }, [n])
  if (n < 1 || !items || items.length === 0) return null
  const c = LOOP[lang]
  // the gifts saved on this language's page (a zh-Hans gift belongs to the Traditional Chinese page)
  const mine = items.filter((i) => toRevealLang(i.language as never) === lang)
  if (mine.length === 0) return null
  const shown = mine.slice(0, 3)
  return (
    <section className="welcomeBack" data-testid="welcome-back" lang={lang}>
      <div className="wrap">
        <p className="wbHead">{c.welcome}</p>
        <ul className="wbList">
          {shown.map((i) => (
            <li key={i.id} className="wbItem" data-testid="welcome-item">
              <span className="wbGlyph notranslate" translate="no">{i.card.kanji}</span>
              <span className="wbWord" data-testid="welcome-word">{i.card.word || i.card.reading}</span>
              <a className="wbGive" data-testid="welcome-give" href={`${writePath(toRevealLang(i.language as never))}?resume=${encodeURIComponent(i.id)}`}>
                {c.giveThis}
              </a>
            </li>
          ))}
        </ul>
        {mine.length > 3 && (
          <a className="wbAll" href="/basket" data-testid="welcome-all">
            {c.seeAll}
          </a>
        )}
      </div>
    </section>
  )
}
