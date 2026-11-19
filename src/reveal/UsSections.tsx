import { useEffect, useRef } from 'react'
import { trackUs } from '../demo/analytics'
import Picture from './Picture'
import { UsdLaunchLine, UsdPriceView } from '../order/SalePrice.tsx'
import { useSale, useUsd } from '../demo/useSizes'
import { KANJI_EXAMPLE } from './kanji-example.ts'
import PromoOffer from './PromoOffer.tsx'
import { freeLine, usePromoView } from './promo-view.ts'

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

/** What the receiver gets — only what is live today, in the order they meet it: five small labelled points under the picture (2026-11-18). */
const RECEIVE_ITEMS: readonly { key: string; title: string }[] = [
  { key: 'character', title: 'The character (its English word and meaning)' },
  { key: 'poem', title: 'A poem from your moment' },
  { key: 'pictures', title: 'Four ink pictures' },
  { key: 'film', title: 'A short film with music' },
  { key: 'certificate', title: 'A certificate and a card to print' },
]
const RECEIVE_ALT = 'The character card, a poem, four ink pictures, a short film and a certificate.'

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

/** The `receive` picture: the character, the poem, the pictures, the film and the certificate, on the site's dark ink ground (sample art, 640 / 1280 WebP with a JPG fallback). */
function ReceiveArt({ alt }: { alt: string }) {
  return (
    <figure className="receiveArt" data-testid="receive-art">
      <Picture name="package/receive" width={1600} height={1600} alt={alt} sizes="(max-width: 860px) 100vw, 760px" />
    </figure>
  )
}

export function UsReceive() {
  const price = useUsd()
  const sale = useSale('en')
  const pv = usePromoView('en')
  return (
    <section className="usReceive" id="receive" data-testid="us-receive">
      <div className="wrap center">
        <span className="eyebrow">What they receive</span>
        <ReceiveArt alt={RECEIVE_ALT} />
        <ul className="usReceiveList" data-testid="us-receive-list">
          {RECEIVE_ITEMS.map((it, i) => (
            <li key={it.key} data-receive={it.key}>
              <span className="usReceiveN" aria-hidden="true">{i + 1}</span>
              <b>{it.title}</b>
            </li>
          ))}
        </ul>
        <p className="usReceiveNote" data-testid="us-receive-note">
          Everything arrives as one private link, the same day. Send it by text, email or WhatsApp. Nothing is mailed. Or set it to open on Christmas morning.
        </p>
        {pv.on && !pv.soldOut ? (
          <PromoOffer lang="en" variant="receive" id="receive" />
        ) : (
          <>
            {pv.soldOut && <p className="promoFree" data-testid="promo-free-receive">{freeLine('en', pv)}</p>}
            <p className="usReceivePrice"><span data-testid="us-receive-price"><UsdPriceView price={price} sale={sale} id="receive" /></span><UsdLaunchLine price={price} sale={sale} /></p>
          </>
        )}
      </div>
    </section>
  )
}

const RECEIVE_JA: readonly string[] = ['一字', '詩', '四枚の絵', 'ショートフィルム', '証書']

/** The Japanese page's "what they receive" (2026-11-18): the picture, the five points (the words of the picture itself) and, while the promotion runs, the free gift. */
export function JaReceive() {
  const pv = usePromoView('ja')
  return (
    <section className="usReceive" id="receive" data-testid="ja-receive">
      <div className="wrap center">
        <span className="eyebrow">届くもの</span>
        <ReceiveArt alt="一字のカード、詩、四枚の絵、ショートフィルム、証書。" />
        <ul className="usReceiveList" data-testid="ja-receive-list">
          {RECEIVE_JA.map((t, i) => (
            <li key={t} data-receive={i}>
              <span className="usReceiveN" aria-hidden="true">{i + 1}</span>
              <b>{t}</b>
            </li>
          ))}
        </ul>
        {pv.on && !pv.soldOut && <PromoOffer lang="ja" variant="receive" id="receive" />}
        {pv.soldOut && <p className="promoFree" data-testid="promo-free-receive">{freeLine('ja', pv)}</p>}
      </div>
    </section>
  )
}

/** The Chinese page: the picture and, while the promotion runs (2026-11-19), the free gift like the other two pages. */
export function ZhReceive() {
  const pv = usePromoView('zh-Hant')
  return (
    <section className="usReceive" id="receive" data-testid="zh-receive">
      <div className="wrap center">
        <ReceiveArt alt="一字卡片、詩、四幅畫、短片與證書。" />
        {pv.on && !pv.soldOut && <PromoOffer lang="zh-Hant" variant="receive" id="receive" />}
        {pv.soldOut && <p className="promoFree" data-testid="promo-free-receive">{freeLine('zh-Hant', pv)}</p>}
      </div>
    </section>
  )
}

/** "What they receive" for the page's language. */
export function Receive({ lang }: { lang: 'ja' | 'en' | 'zh-Hant' | 'zh-Hans' }) {
  return lang === 'en' ? <UsReceive /> : lang === 'ja' ? <JaReceive /> : <ZhReceive />
}
