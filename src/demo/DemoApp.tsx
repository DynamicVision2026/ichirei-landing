import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Condition, EngineResult } from './types'
import Elicitation from './Elicitation'
import Reveal from './Reveal'
import { exportEvents, log, setCondition as logSetCondition, setStory as logSetStory } from './logging'
import { COPY, DEFAULT_GIFT_CONTEXT, contextToPayload, type Copy, type GiftContext } from './i18n'

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

// Hard client-side deadline: if no terminal line arrives in this window, the
// spinner is replaced by a visible error — the UI can never hang silently.
// 290s sits just under the 300s server/Cloud Run request timeout (server/app.ts,
// cloudbuild.yaml) so the user sees THIS clear message rather than a cut stream.
// (On the Vercel fallback a 60s function kill still ends the stream at once and
// surfaces as a visible error, so the longer window costs nothing there.)
// Overridable for tests via /demo?engine_timeout_ms=1500.
const ENGINE_TIMEOUT_MS = (() => {
  const p = Number(new URLSearchParams(window.location.search).get('engine_timeout_ms'))
  return Number.isFinite(p) && p > 0 ? p : 290_000
})()

/** The engine stream ended without a terminal line (shown with the sender's UI language). */
class StreamCutError extends Error {}

/** Consume the /api/select NDJSON stream; resolves on the terminal line. */
async function consumeEngineStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (chars: number) => void,
): Promise<EngineResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleLine = (line: string): EngineResult | null => {
    const trimmed = line.trim()
    if (!trimmed) return null
    const msg = JSON.parse(trimmed) as
      | { type: 'delta'; chars: number }
      | { type: 'ping' } // server heartbeat during silent reasoning — ignore
      | { type: 'result'; result: EngineResult }
      | { type: 'error'; error: string }
    if (msg.type === 'ping') return null
    if (msg.type === 'delta') {
      onProgress(msg.chars)
      return null
    }
    if (msg.type === 'error') throw new Error(msg.error)
    return msg.result
  }
  // Remember the terminal result but keep reading until the server closes the
  // stream (it does so immediately after the terminal line). Returning early
  // would leave the response half-read, which browsers report as an aborted
  // request (net::ERR_ABORTED) even though the result was delivered.
  let final: EngineResult | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const result = handleLine(buffer.slice(0, nl))
      if (result) final = result
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  }
  const tail = handleLine(buffer)
  if (tail) final = tail
  if (final) return final
  throw new StreamCutError('stream cut')
}

// Spec §10 golden fixture — one tap to load for acceptance runs (story + its context).
const GOLDEN_CONTEXT: GiftContext = {
  ...DEFAULT_GIFT_CONTEXT,
  language: 'ja',
  relationship: 'parent_father',
  direction: 'up',
  occasion: 'birthday_milestone',
  occasionDetail: '還暦',
}
const GOLDEN_FIXTURE =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

type Phase = 'elicit' | 'processing' | 'followup' | 'reveal' | 'thin'

function ProcessingView({ receivedChars, copy }: { receivedChars: number; copy: Copy }) {
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
          {copy.processingTitle}
        </p>
        <p className="font-label mt-3 text-[11px] text-ivory/40">
          {receivedChars > 0 ? copy.processingProgress(receivedChars) : copy.processingWait}
        </p>
      </div>
    </div>
  )
}

/**
 * Shown when the palette referee removed every candidate that could be the primary
 * (primary_kanji is null): says so plainly, lists what was removed and why, and points
 * back to the story. Candidates that survived (if any) are still revealed beneath it.
 */
function NoPrimaryNotice({ result, copy }: { result: EngineResult; copy: Copy }) {
  const removed = result.candidates.filter((c) => c.eliminated)
  const kept = result.candidates.filter((c) => !c.eliminated)
  return (
    <section
      role="alert"
      data-testid="no-primary"
      className="mb-10 rounded-sm border border-gold/40 bg-paper/50 p-6"
    >
      <p className="font-mincho text-xl leading-relaxed text-ivory">{copy.noPrimaryTitle}</p>
      <p className="font-serif-jp mt-3 text-sm leading-loose text-ivory/70">{copy.noPrimaryBody}</p>
      {removed.length > 0 && (
        <div className="mt-5">
          <p className="font-label mb-2 text-[11px] tracking-[0.15em] text-gold/70">{copy.noPrimaryRemoved}</p>
          <ul className="flex flex-col gap-1.5">
            {removed.map((c) => (
              <li key={c.kanji} className="font-serif-jp text-xs leading-relaxed text-ivory/60">
                <span className="font-mincho mr-2 text-lg text-ivory/80">{c.kanji}</span>
                {c.eliminated_reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {kept.length > 0 && (
        <p className="font-label mt-4 text-[11px] text-ivory/45">
          {copy.noPrimaryKept}：{kept.map((c) => c.kanji).join(' ')}
        </p>
      )}
    </section>
  )
}

export default function DemoApp() {
  const [phase, setPhase] = useState<Phase>('elicit')
  const [story, setStory] = useState('')
  const [context, setContext] = useState<GiftContext>(DEFAULT_GIFT_CONTEXT)
  const copy = COPY[context.language]
  const [condition, setConditionState] = useState<Condition>('A')
  const [result, setResult] = useState<EngineResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receivedChars, setReceivedChars] = useState(0)
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
    setReceivedChars(0)
    if (!sessionLogged.current) {
      log('session_started', {})
      sessionLogged.current = true
    }
    logSetStory(fullStory)
    const controller = new AbortController()
    let timedOut = false
    const deadline = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ENGINE_TIMEOUT_MS)
    try {
      const res = await fetch('/api/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ story: fullStory, condition, ...contextToPayload(context) }),
        signal: controller.signal,
      })
      if (!res.ok) {
        let message: string | null = null
        try {
          message = ((await res.json()) as { error?: string })?.error ?? null
        } catch {
          message = null
        }
        throw new Error(message ?? copy.serverError(res.status))
      }
      const isStream =
        (res.headers.get('content-type') ?? '').includes('ndjson') && res.body
      const engineResult: EngineResult = isStream
        ? await consumeEngineStream(res.body!, setReceivedChars)
        : ((await res.json()) as EngineResult)
      setResult(engineResult)
      log('engine_run', {
        status: engineResult.status,
        primary: engineResult.primary_kanji,
        candidates: engineResult.candidates.length,
        no_eligible_primary: engineResult.referee?.no_eligible_primary ?? false,
        language: context.language,
        relationship: context.relationship,
        direction: context.direction,
        occasion: context.occasion,
        has_occasion_detail: context.occasionDetail.trim() !== '',
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
      const message = timedOut
        ? copy.timeout(Math.round(ENGINE_TIMEOUT_MS / 1000))
        : e instanceof StreamCutError
          ? copy.streamCut
          : e instanceof Error
            ? e.message
            : String(e)
      setError(message)
      setPhase('elicit')
    } finally {
      window.clearTimeout(deadline)
    }
  }

  // "もう一度試す": back to the story input with the current story text kept, so the
  // sender can edit it and run again. Result, error and follow-up state are cleared.
  const tryAgain = () => {
    log('retry_clicked', { story_chars: story.length })
    followUpsUsed.current = 0
    setResult(null)
    setError(null)
    setFollowUpQuestion(null)
    setFollowUpAnswer('')
    setReceivedChars(0)
    setPhase('elicit')
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
              {copy.exportLog}
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
              copy={copy}
              context={context}
              onContextChange={setContext}
            />
            <button
              type="button"
              onClick={() => {
                setStory(GOLDEN_FIXTURE)
                setContext(GOLDEN_CONTEXT)
              }}
              className="font-label mt-8 text-[11px] tracking-wide text-ivory/30 underline-offset-4 transition-colors hover:text-ivory/60 hover:underline"
            >
              load golden fixture (§10 acceptance test)
            </button>
          </>
        )}

        {phase === 'processing' && <ProcessingView receivedChars={receivedChars} copy={copy} />}

        {phase === 'followup' && followUpQuestion && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-label mb-4 text-[11px] tracking-[0.2em] text-gold/70">
              {copy.followUpHeading}
            </p>
            <p className="font-mincho mb-8 text-xl leading-relaxed text-ivory">
              {followUpQuestion}
            </p>
            <textarea
              value={followUpAnswer}
              onChange={(e) => setFollowUpAnswer(e.target.value)}
              rows={5}
              placeholder={copy.followUpPlaceholder}
              className="font-serif-jp w-full resize-none rounded-sm border border-gold/25 bg-paper/60 p-4 text-base leading-loose text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
            />
            <button
              type="button"
              onClick={submitFollowUp}
              disabled={!followUpAnswer.trim()}
              className="font-label mt-6 rounded-full bg-gold px-8 py-3.5 text-sm tracking-[0.1em] text-ink transition-all hover:shadow-[0_8px_30px_rgba(201,169,110,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copy.followUpSubmit}
            </button>
          </motion.div>
        )}

        {phase === 'thin' && (
          <div className="py-12 text-center">
            <p className="font-mincho text-xl leading-relaxed text-ivory">
              {copy.thinTitle}
            </p>
            <p className="font-serif-jp mt-4 text-sm leading-loose text-ivory/60">{copy.thinBody}</p>
            <button
              type="button"
              onClick={() => setPhase('elicit')}
              className="font-label mt-8 rounded-full border border-gold/40 px-6 py-2.5 text-sm text-ivory transition-colors hover:border-gold hover:bg-gold/10"
            >
              {copy.thinBack}
            </button>
          </div>
        )}

        {phase === 'reveal' && result && (
          <>
            {result.primary_kanji === null && <NoPrimaryNotice result={result} copy={copy} />}
            {result.candidates.some((c) => !c.eliminated) && (
              <Reveal result={result} story={story} condition={condition} copy={copy} context={context} />
            )}
            <div className="mt-12 text-center">
              <button
                type="button"
                onClick={tryAgain}
                className="font-label rounded-full border border-gold/40 px-6 py-2.5 text-sm text-ivory transition-colors hover:border-gold hover:bg-gold/10"
              >
                {copy.tryAgain}
              </button>
            </div>
          </>
        )}

        {result && (phase === 'reveal' || phase === 'thin') && (
          <details className="mt-14 opacity-60">
            <summary className="font-label cursor-pointer text-[11px] tracking-[0.15em] text-ivory/40">
              {copy.rawContract}
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
