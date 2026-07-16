import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Condition, EngineResult } from './types'
import Elicitation from './Elicitation'
import Reveal from './Reveal'
import { exportEvents, log, setCondition as logSetCondition, setStory as logSetStory } from './logging'

// Validation-harness orchestrator: elicitation (§7) → engine call (§4) →
// adaptive follow-up (§7.4, at most twice) → progressive reveal (§8), with the
// three-condition toggle (§5) switching presentation over ONE cached engine
// call — conditions never re-invoke the engine.

const CONDITIONS: { id: Condition; label: string }[] = [
  { id: 'A', label: 'A' },
  { id: 'B', label: 'B' },
  { id: 'C', label: 'C' },
]

const MAX_FOLLOW_UPS = 2

// Spec §10 golden fixture — one tap to load for acceptance runs.
const GOLDEN_FIXTURE =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

type Phase = 'elicit' | 'processing' | 'followup' | 'reveal' | 'thin'

function ProcessingView() {
  const reduceMotion = useReducedMotion()
  return (
    <div className="flex flex-col items-center gap-10 py-24">
      <svg width="120" height="120" viewBox="0 0 140 140" fill="none" aria-hidden="true">
        <circle cx="70" cy="70" r="54" stroke="#C9A96E" strokeOpacity="0.15" strokeWidth="1.5" />
        <circle
          cx="70" cy="70" r="54" stroke="#C9A96E" strokeWidth="2" strokeLinecap="round"
          strokeDasharray="90 250" className={reduceMotion ? undefined : 'ink-loop-spin'}
        />
        <circle
          cx="70" cy="70" r="38" stroke="#C9A96E" strokeOpacity="0.35" strokeWidth="1"
          strokeLinecap="round" strokeDasharray="40 200"
          className={reduceMotion ? undefined : 'ink-loop-spin-reverse'}
        />
        <circle cx="70" cy="70" r="3" fill="#C9A96E" fillOpacity="0.8" />
      </svg>
      <div className="text-center">
        <p className="font-serif-jp text-lg tracking-wider text-ivory/80">
          言葉を読んでいます...
        </p>
        <p className="font-label mt-3 text-[11px] text-ivory/40">
          深く読むほど時間がかかります（1〜2分ほどお待ちください）
        </p>
      </div>
    </div>
  )
}

export default function DemoApp() {
  const [phase, setPhase] = useState<Phase>('elicit')
  const [story, setStory] = useState('')
  const [condition, setConditionState] = useState<Condition>('A')
  const [result, setResult] = useState<EngineResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null)
  const [followUpAnswer, setFollowUpAnswer] = useState('')
  const followUpsUsed = useRef(0)
  const sessionLogged = useRef(false)

  const changeCondition = (c: Condition) => {
    if (c === condition) return
    log('condition_changed', { from: condition, to: c })
    logSetCondition(c)
    setConditionState(c)
  }

  const runEngine = async (fullStory: string) => {
    setPhase('processing')
    setError(null)
    if (!sessionLogged.current) {
      log('session_started', {})
      sessionLogged.current = true
    }
    logSetStory(fullStory)
    try {
      const res = await fetch('/api/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ story: fullStory, condition }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const engineResult = data as EngineResult
      setResult(engineResult)
      log('engine_run', {
        status: engineResult.status,
        primary: engineResult.primary_kanji,
        candidates: engineResult.candidates.length,
        follow_ups_used: followUpsUsed.current,
      })
      if (engineResult.status === 'insufficient') {
        if (followUpsUsed.current < MAX_FOLLOW_UPS && engineResult.follow_up_question) {
          followUpsUsed.current += 1
          setFollowUpQuestion(engineResult.follow_up_question)
          setFollowUpAnswer('')
          log('follow_up_shown', { question: engineResult.follow_up_question })
          setPhase('followup')
        } else {
          setPhase('thin')
        }
      } else {
        setPhase('reveal')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('elicit')
    }
  }

  const submitFollowUp = () => {
    const answer = followUpAnswer.trim()
    if (!answer) return
    const merged = `${story}\n\n${answer}`
    setStory(merged)
    void runEngine(merged)
  }

  return (
    <div className="min-h-screen bg-ink px-6 py-10 text-ivory">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mincho text-lg text-ivory">一字礼</span>
            <span className="font-label text-xs tracking-[0.25em] text-gold">
              ICHIREI · VALIDATION HARNESS
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="font-label mr-1 text-[10px] tracking-wide text-ivory/40">
                condition
              </span>
              {CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => changeCondition(c.id)}
                  className={`font-label h-7 w-7 rounded-full text-xs transition-colors ${
                    condition === c.id
                      ? 'bg-gold text-ink'
                      : 'border border-gold/30 text-ivory/60 hover:border-gold'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={exportEvents}
              className="font-label rounded-full border border-ivory/20 px-3 py-1.5 text-[11px] text-ivory/60 transition-colors hover:border-ivory/50"
            >
              ログ書き出し
            </button>
          </div>
        </header>

        {error && (
          <p className="font-label mb-6 rounded-sm border border-cinnabar/50 bg-cinnabar/10 p-4 text-sm text-cinnabar">
            {error}
          </p>
        )}

        {phase === 'elicit' && (
          <>
            <Elicitation
              story={story}
              onStoryChange={setStory}
              onSubmit={() => void runEngine(story)}
              submitting={false}
            />
            <button
              type="button"
              onClick={() => setStory(GOLDEN_FIXTURE)}
              className="font-label mt-8 text-[11px] tracking-wide text-ivory/30 underline-offset-4 transition-colors hover:text-ivory/60 hover:underline"
            >
              golden fixture を入れる（§10 受け入れテスト用）
            </button>
          </>
        )}

        {phase === 'processing' && <ProcessingView />}

        {phase === 'followup' && followUpQuestion && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-label mb-4 text-[11px] tracking-[0.2em] text-gold/70">
              もうすこしだけ、聞かせてください
            </p>
            <p className="font-mincho mb-8 text-xl leading-relaxed text-ivory">
              {followUpQuestion}
            </p>
            <textarea
              value={followUpAnswer}
              onChange={(e) => setFollowUpAnswer(e.target.value)}
              rows={5}
              placeholder="思い出したことを、そのまま。"
              className="font-serif-jp w-full resize-none rounded-sm border border-gold/25 bg-paper/60 p-4 text-base leading-loose text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
            />
            <button
              type="button"
              onClick={submitFollowUp}
              disabled={!followUpAnswer.trim()}
              className="font-label mt-6 rounded-full bg-gold px-8 py-3.5 text-sm tracking-[0.1em] text-ink transition-all hover:shadow-[0_8px_30px_rgba(201,169,110,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              つづきを探しにいく
            </button>
          </motion.div>
        )}

        {phase === 'thin' && (
          <div className="py-12 text-center">
            <p className="font-mincho text-xl leading-relaxed text-ivory">
              いただいた言葉だけでは、その人だけの一字にまだ届きませんでした。
            </p>
            <p className="font-serif-jp mt-4 text-sm leading-loose text-ivory/60">
              ありふれた一字をお渡しするより、もう一度、小さな仕草や口ぐせを思い出してから
              お越しください。それがこの記念式の誠実さです。
            </p>
            <button
              type="button"
              onClick={() => setPhase('elicit')}
              className="font-label mt-8 rounded-full border border-gold/40 px-6 py-2.5 text-sm text-ivory transition-colors hover:border-gold hover:bg-gold/10"
            >
              物語に戻る
            </button>
          </div>
        )}

        {phase === 'reveal' && result && (
          <Reveal result={result} story={story} condition={condition} />
        )}

        {result && (phase === 'reveal' || phase === 'thin') && (
          <details className="mt-14 opacity-60">
            <summary className="font-label cursor-pointer text-[11px] tracking-[0.15em] text-ivory/40">
              raw contract（診断用）
            </summary>
            <pre className="mt-3 max-h-[50vh] overflow-auto rounded-sm border border-gold/15 bg-paper/40 p-4 text-[11px] leading-relaxed text-ivory/70">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
