import type { RevealLang } from '../reveal/copy.ts'
import { LOOP } from './copy.ts'
import { useMe } from './me.ts'
import './loop.css'

/** The header's "My gifts" button on every customer page (2026-11-16): opens the saved-gifts page; "My gifts (2)" once there is at least one. */
export default function MyGiftsButton({ lang, className = '', receiver = false }: { lang: RevealLang; className?: string; /** The receiver's pages (Part 14, 2026-11-20): shown only once the browser has something saved, ordered or sent back. */ receiver?: boolean }) {
  const me = useMe()
  const n = me?.basket.count ?? 0
  if (receiver && n === 0 && me?.has !== true) return null
  return (
    <a className={`myGifts ${className}`.trim()} href="/basket" data-testid="my-gifts" data-count={n}>
      {LOOP[lang].myGifts(n)}
    </a>
  )
}
