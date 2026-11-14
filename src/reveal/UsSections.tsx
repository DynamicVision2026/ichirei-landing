import { useEffect, useRef } from 'react'
import { trackUs } from '../demo/analytics'
import Picture from './Picture'
import { UsdLaunchLine, UsdPriceView } from '../order/SalePrice.tsx'
import { useSale, useUsd } from '../demo/useSizes'
import { KANJI_EXAMPLE } from './kanji-example.ts'

// The English landing page's own sections (ticket 2026-11-12, C1): the one-line delivery banner and the "What they receive" strip. English only — RevealPage mounts them for the English page and nothing else.

const US_BANNER = 'The e-gift arrives the same day you order — even on Christmas morning.'

/** One fixed line under the hero. Counted once per page load when it scrolls into view (us_banner_seen). */
export function UsBanner() {
  const ref = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    const el = ref.current
    let done = false
    const fire = () => {
      if (done) return
      done = true
      trackUs('us_banner_seen')
    }
    if (!el || typeof IntersectionObserver === 'undefined') return fire()
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        fire()
        io.disconnect()
      }
    }, { threshold: 0.6 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <section className="usBanner" aria-label="Delivery">
      <div className="wrap">
        <p ref={ref} data-testid="us-banner">{US_BANNER}</p>
      </div>
    </section>
  )
}

/** What the receiver gets — only what is live today, in the order they meet it (2026-11-14 wording). */
const RECEIVE_ITEMS: readonly { key: string; title: string }[] = [
  { key: 'character', title: 'Their character, with its reading and its meaning in English' },
  { key: 'poem', title: 'A short poem written from your moment' },
  { key: 'pictures', title: 'Four ink-wash pictures of the moment you wrote' },
  { key: 'film', title: 'A short film (about 30 seconds) with music, made to share' },
  { key: 'certificate', title: 'A certificate, and a card to print at home (PDF)' },
]

/** "What is a kanji?" — one short block before the rest of the page (English only). */
export function UsKanji() {
  return (
    <section className="usKanji" id="what-is-kanji" data-testid="us-kanji">
      <div className="wrap center">
        <span className="eyebrow">What is a kanji?</span>
        <p className="usKanjiText">
          Kanji are the characters of written Japanese, carried from China more than 1,500 years ago. Each one holds a meaning, not just a sound.{' '}
          <b className="usKanjiGlyph k notranslate" data-testid="us-kanji-glyph">{KANJI_EXAMPLE.kanji}</b> means <b data-testid="us-kanji-word">{KANJI_EXAMPLE.word}</b>: the one who never changes. One character can hold what a long card can&rsquo;t.
        </p>
      </div>
    </section>
  )
}

/** "Who it's for" — after the receive strip (English only). */
export function UsWho() {
  return (
    <section className="usWho" id="who-its-for" data-testid="us-who">
      <div className="wrap center">
        <span className="eyebrow">Who it&rsquo;s for</span>
        <p className="usWhoText">
          For Mom, Dad, your partner, a grandparent, a brother or sister, a friend, a mentor or a colleague. For Thanksgiving, Christmas, a birthday, an anniversary, a thank-you, or no reason at all. And for someone you&rsquo;ve lost, it keeps how you saw them.
        </p>
      </div>
    </section>
  )
}

export function UsReceive() {
  const price = useUsd()
  const sale = useSale('en')
  return (
    <section className="usReceive" id="receive" data-testid="us-receive">
      <div className="wrap center">
        <span className="eyebrow">What they receive</span>
        <ol className="usReceiveList">
          {RECEIVE_ITEMS.map((it, i) => (
            <li key={it.key} data-receive={it.key}>
              <span className="usReceiveN" aria-hidden="true">{i + 1}</span>
              <b>{it.title}</b>
            </li>
          ))}
        </ol>
        <p className="usReceiveNote" data-testid="us-receive-note">
          Everything arrives as one private link, the same day. Send it by text, email or WhatsApp. Nothing is mailed. Or set it to open on Christmas morning.
        </p>
        <p className="usReceivePrice"><span data-testid="us-receive-price"><UsdPriceView price={price} sale={sale} id="receive" /></span><UsdLaunchLine price={price} sale={sale} /></p>
        <figure className="usReceiveArt ph" aria-hidden="true">
          <Picture name="scenes/m1" width={4} height={5} sizes="(max-width: 860px) 60vw, 240px" />
        </figure>
      </div>
    </section>
  )
}
