import type { RevealLang } from '../reveal/copy.ts'
import { LOOP } from './copy.ts'
import { useMe } from './me.ts'
import './loop.css'

/** The header's "My gifts" button on every customer page (2026-11-16): opens the saved-gifts page; "My gifts (2)" once there is at least one. */
export default function MyGiftsButton({ lang, className = '' }: { lang: RevealLang; className?: string }) {
  const me = useMe()
  const n = me?.basket.count ?? 0
  return (
    <a className={`myGifts ${className}`.trim()} href="/basket" data-testid="my-gifts" data-count={n}>
      {LOOP[lang].myGifts(n)}
    </a>
  )
}
