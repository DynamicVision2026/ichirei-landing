import { useEffect, useState } from 'react'
import { useLanguage } from '../useLanguage.ts'
import { toRevealLang } from '../reveal/lang.ts'
import { DOCUMENT } from '../reveal/copy.ts'
import RevealPage from '../reveal/RevealPage.tsx'
import { setLanguage } from '../lang-store.ts'
import { LOOP } from './copy.ts'
import { refreshMe, setBasketCount } from './me.ts'
import SavePanel from './SavePanel.tsx'
import { writePath } from '../reveal/paths.ts'
import './loop.css'
import '../reveal/reveal.css'

interface Item {
  id: string
  created_at: string
  language: string
  to: string
  card: { kanji: string; reading: string; word: string; line: string }
  preview_id: string | null
}

const dateOf = (iso: string, lang: string): string => {
  try {
    return new Date(iso).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'zh-Hant' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * "My gifts" (2026-11-16; the basket page before): /basket and the private link /b/<token>. Every saved gift shows its character, its word, the date and a small picture strip, with
 * "Give this gift →" (its result page opens in the writing room of its language) and "×" (deleted at once). A token that is not a basket's shows the normal landing page.
 */
export default function BasketApp() {
  const [uiLang] = useLanguage()
  const lang = toRevealLang(uiLang)
  const c = LOOP[lang]
  const path = window.location.pathname
  const token = path.startsWith('/b/') ? decodeURIComponent(path.slice(3).replace(/\/$/, '')) : null
  const [items, setItems] = useState<Item[] | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('rv-page')
    document.title = `${c.basketHeading} · ICHIREI`
    document.querySelector('meta[name=robots]')?.setAttribute('content', 'noindex, nofollow')
    return () => document.documentElement.classList.remove('rv-page')
  }, [c.basketHeading])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await fetch(token ? `/api/b/${encodeURIComponent(token)}` : '/api/basket', { credentials: 'same-origin' })
        if (!r.ok) {
          if (alive) setNotFound(true)
          return
        }
        const j = (await r.json()) as { items: Item[] }
        if (!alive) return
        setItems(j.items)
        setBasketCount(j.items.length)
        // the basket opens in the language of its newest gift
        const first = j.items[0]?.language
        if (first === 'ja' || first === 'en' || first === 'zh-Hant' || first === 'zh-Hans') setLanguage(first)
        if (token) {
          // the private link has done its work: the address is the plain basket from here (the token is not left in the address bar)
          try {
            window.history.replaceState(null, '', '/basket')
          } catch {
            // an address that cannot be changed stays as it is
          }
        }
      } catch {
        if (alive) setNotFound(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [token])

  // a wrong token: the normal landing page
  if (notFound && token) return <RevealPage />

  const remove = async (id: string) => {
    setItems((list) => (list ?? []).filter((i) => i.id !== id))
    try {
      await fetch(`/api/basket/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
    } finally {
      void refreshMe()
    }
  }
  void DOCUMENT

  return (
    <div className="rv basketPage" data-testid="basket-page" lang={lang}>
      <div className="wrap">
        <div className="basketTop">
          <a className="back" href={writePath(lang)}>
            {c.backToWrite}
          </a>
          <SavePanel lang={lang} />
        </div>
        <h1>{c.basketHeading}</h1>
        <p className="basketSaved" data-testid="basket-saved">
          {c.basketSaved}
        </p>
        {items === null && !notFound && <p className="sent">{c.loading}</p>}
        {(items?.length === 0 || notFound) && <p className="sent" data-testid="basket-empty">{c.empty}</p>}
        <ul className="basketList">
          {(items ?? []).map((i) => (
            <li className="basketItem" key={i.id} data-testid="basket-item">
              <span className="glyph notranslate">{i.card.kanji}</span>
              <div className="meta">
                <p className="reading">
                  {/* English first (2026-11-15): the word alone when there is one; no romanized reading */}
                  {i.card.word || i.card.reading}
                  {i.to ? ` — ${i.to}` : ''}
                </p>
                <p className="date">{dateOf(i.created_at, lang)}</p>
                {i.preview_id && (
                  <div className="strip" aria-hidden="true">
                    {[0, 1, 2, 3].map((n) => (
                      <img key={n} src={`/api/film/${i.preview_id}/picture/${n}.webp`} alt="" loading="lazy" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
                    ))}
                  </div>
                )}
              </div>
              <div className="acts">
                <button type="button" className="x" aria-label={c.removeLabel} title={c.removeLabel} data-testid="basket-remove" onClick={() => void remove(i.id)}>
                  {c.remove}
                </button>
                <a className="btn primary" data-testid="basket-give" href={`${writePath(toRevealLang(i.language as never))}?resume=${encodeURIComponent(i.id)}`}>
                  {c.giveThis}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
