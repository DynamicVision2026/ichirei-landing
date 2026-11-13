import { useEffect, useRef } from 'react'
import { trackUs } from '../demo/analytics'
import Picture from './Picture'

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

/** What the receiver gets — only what is live today, in the order they meet it. */
const RECEIVE_ITEMS: readonly { key: string; title: string; text: string }[] = [
  { key: 'character', title: 'One character, with its word and line', text: 'The kanji you chose, its reading, one English word for what it means, and a line from your story.' },
  { key: 'poem', title: 'A poem', text: 'Written from the story you told about them.' },
  { key: 'pictures', title: 'Four pictures of your story', text: 'Ink-wash scenes drawn from the moments you described.' },
  { key: 'film', title: 'A short film with music', text: 'About thirty seconds, ending on the card.' },
  { key: 'certificate', title: 'The certificate', text: 'A keepsake they can save and print.' },
]

export function UsReceive() {
  return (
    <section className="usReceive" id="receive" data-testid="us-receive">
      <div className="wrap center">
        <span className="eyebrow">What they receive</span>
        <h2>Everything arrives on one private page.</h2>
        <ol className="usReceiveList">
          {RECEIVE_ITEMS.map((it, i) => (
            <li key={it.key} data-receive={it.key}>
              <span className="usReceiveN" aria-hidden="true">{i + 1}</span>
              <b>{it.title}</b>
              <small>{it.text}</small>
            </li>
          ))}
        </ol>
        <figure className="usReceiveArt ph" aria-hidden="true">
          <Picture name="scenes/en/tree" width={4} height={5} sizes="(max-width: 860px) 60vw, 240px" />
        </figure>
      </div>
    </section>
  )
}
