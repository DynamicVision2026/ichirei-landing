import type { RevealLang } from '../reveal/copy.ts'
import { LOOP } from './copy.ts'
import { useMe } from './me.ts'
import './loop.css'

/** 「保存した贈りもの（n）→」: shown when this browser's basket has items (landing, writing step, under the person-limit message). */
export function BasketBar({ lang, className = '' }: { lang: RevealLang; className?: string }) {
  const me = useMe()
  const n = me?.basket.count ?? 0
  if (n < 1) return null
  return (
    <p className={`loopBar ${className}`.trim()} data-testid="basket-bar">
      <a href="/basket">{LOOP[lang].basketBar(n)}</a>
    </p>
  )
}

/** 「{name}への贈りものの準備ができました。受け取る →」: a paid gift this browser made that has not been collected yet. Gone once it is collected. */
export function GiftReadyBar({ lang }: { lang: RevealLang }) {
  const me = useMe()
  if (!me?.ready) return null
  return (
    <p className="loopBar loopBar--ready" data-testid="gift-ready-bar">
      <a href={`/a/${me.ready.id}`}>{LOOP[lang].readyBar(me.ready.name.trim())}</a>
    </p>
  )
}

/** Both bars, at the top of the landing page. */
export default function LoopBars({ lang }: { lang: RevealLang }) {
  return (
    <div className="loopBars">
      <GiftReadyBar lang={lang} />
      <BasketBar lang={lang} />
    </div>
  )
}
