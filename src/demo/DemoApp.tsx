import { useState } from 'react'
import type { Condition, EngineResult } from './types'

// Step-1 route stub (build spec §9.1): a story box, the three-condition toggle,
// and a raw-JSON view of the engine's response. This is the pre-UI test surface —
// the elicitation and progressive-reveal UIs come in later build steps.

const GOLDEN_FIXTURE =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

const CONDITIONS: { id: Condition; label: string }[] = [
  { id: 'A', label: 'A — 一字＋一文＋出典' },
  { id: 'B', label: 'B — ＋深い解説' },
  { id: 'C', label: 'C — ＋現物プレビュー' },
]

type Status = 'idle' | 'loading' | 'done' | 'error'

export default function DemoApp() {
  const [story, setStory] = useState('')
  const [condition, setCondition] = useState<Condition>('A')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<EngineResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setStatus('loading')
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ story, condition }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`)
        setStatus('error')
        return
      }
      setResult(data as EngineResult)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-ink px-6 py-12 text-ivory">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-mincho text-lg text-ivory">一字礼</span>
            <span className="font-label text-xs tracking-[0.25em] text-gold">
              ICHIREI · VALIDATION HARNESS
            </span>
          </div>
          <a href="/" className="font-label text-xs text-ivory/50 hover:text-ivory">
            ← landing
          </a>
        </header>

        <label className="font-serif-jp mb-2 block text-sm text-ivory/70">
          物語（その人の六十年）
        </label>
        <textarea
          value={story}
          onChange={(e) => setStory(e.target.value)}
          rows={7}
          placeholder="ここに物語を貼り付けてください…"
          className="font-serif-jp w-full resize-none rounded-sm border border-gold/25 bg-paper/60 p-4 text-base leading-relaxed text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setStory(GOLDEN_FIXTURE)}
            className="font-label rounded-full border border-ivory/20 px-3 py-1.5 text-xs text-ivory/70 transition-colors hover:border-ivory/50"
          >
            golden fixture を入れる
          </button>
          <span className="font-label text-[11px] tracking-wide text-ivory/40">
            condition:
          </span>
          <div className="flex gap-1">
            {CONDITIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCondition(c.id)}
                className={`font-label rounded-full px-3 py-1.5 text-xs transition-colors ${
                  condition === c.id
                    ? 'bg-gold text-ink'
                    : 'border border-gold/30 text-ivory/70 hover:border-gold'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={status === 'loading' || !story.trim()}
          className="font-label mt-6 rounded-full bg-gold px-7 py-3 text-sm tracking-[0.1em] text-ink transition-all hover:shadow-[0_8px_30px_rgba(201,169,110,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === 'loading' ? '言葉を読んでいます…' : 'エンジンにかける'}
        </button>

        {status === 'error' && (
          <p className="font-label mt-6 rounded-sm border border-cinnabar/50 bg-cinnabar/10 p-4 text-sm text-cinnabar">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <span className="font-label text-xs tracking-[0.2em] text-gold">
                RAW CONTRACT
              </span>
              <span className="font-label text-[11px] text-ivory/40">
                status: {result.status}
                {result.primary_kanji ? ` · primary: ${result.primary_kanji}` : ''}
              </span>
            </div>
            <pre className="max-h-[70vh] overflow-auto rounded-sm border border-gold/20 bg-paper/50 p-4 text-xs leading-relaxed text-ivory/85">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
