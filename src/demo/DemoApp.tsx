import ResultPage, { type ResultLive } from './ResultPage'
import { setFlowActive } from '../reveal/flow-store.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Candidate, Condition, EngineResult } from './types'
import Elicitation from './Elicitation'
import Reveal from './Reveal'
import OrderForm from './OrderForm'
import Composer from '../reveal/Composer'
import { toRevealLang } from '../reveal/lang'
import { sessionId, trackFlow, trackPreview } from './analytics'
import { PREVIEW_COPY } from './preview-copy'
import { storyPhrases } from './phrases'
import type { DraftRef } from './usePreview'
import { clearDraft, draftOf, loadDraft, saveDraft, type Draft } from './draft'
import { questionSetOf, questionTextOf } from './questions'
import { OPENER } from '../reveal/opener-copy'
import { exportEvents, log, setCondition as logSetCondition, setStory as logSetStory } from './logging'
import { setMemorialSelected } from '../reveal/occasion-store'
import { egiftCopy } from './egift-copy'
import { useMaxRounds, useWoodOnSale } from './useSizes'
import { COPY, DEFAULT_GIFT_CONTEXT, FOLLOW_UP_COUNTER_FROM, FOLLOW_UP_MAX, clipStory, contextToPayload, occasionOf, purposeOf, storyLength, type Copy, type GiftContext } from './i18n'
import { getLanguage, setLanguage } from '../lang-store'
import { useLanguage } from '../useLanguage'
import { cleanInscriptionForm } from '../order/inscription'
import { BasketBar } from '../loop/LoopBars'
import { refreshMe, setBasketCount } from '../loop/me'

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

/** What the server is really doing (api/select.ts sends one `stage` line per step; engine/engine.ts onStage). */
type EngineStage = 'reading' | 'choosing' | 'checking' | 'replacing'
const STEP_ORDER: EngineStage[] = ['reading', 'choosing', 'checking', 'replacing']

/** The server reported that a model call hit its ceiling (code model_timeout). */
class ModelTimeoutStreamError extends Error {
  seconds: number
  constructor(message: string, seconds: number) {
    super(message)
    this.seconds = seconds
  }
}

/** The engine stream ended without a terminal line (shown with the sender's UI language). */
class StreamCutError extends Error {}

/** The server's terminal error line: a CODE only (engine_busy / engine_error). The page shows its own calm words, never anything the server wrote. */
class EngineStreamError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/** A message that is the page's own copy (a limit, "too long"): the only kind of message that is shown as written. Anything else shows the calm line. */
class ShownError extends Error {}

/** Consume the /api/select NDJSON stream; resolves on the terminal line. */
async function consumeEngineStream(
  body: ReadableStream<Uint8Array>,
  onStage: (stage: EngineStage) => void,
  onCard?: (partial: EngineResult) => void,
  onTicket?: (ticket: string) => void,
): Promise<EngineResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const handleLine = (line: string): EngineResult | null => {
    const trimmed = line.trim()
    if (!trimmed) return null
    const msg = JSON.parse(trimmed) as
      | { type: 'delta'; chars: number } // model output progress — the stage events carry the real steps
      | { type: 'stage'; stage: EngineStage }
      | { type: 'card'; result: EngineResult } // a card has passed its checks: the result as it stands (main; main + second; all three)
      | { type: 'ping' } // server heartbeat during silent reasoning — ignore
      | { type: 'result'; result: EngineResult; round_ticket?: string }
      | { type: 'error'; code?: string; seconds?: number }
    if (msg.type === 'ping') return null
    if (msg.type === 'delta') return null
    if (msg.type === 'stage') {
      onStage(msg.stage)
      return null
    }
    if (msg.type === 'card') {
      onCard?.(msg.result)
      return null
    }
    if (msg.type === 'result' && msg.round_ticket) onTicket?.(msg.round_ticket) // the server's signed ticket for the rounds of this moment
    if (msg.type === 'error') throw msg.code === 'model_timeout' ? new ModelTimeoutStreamError('model_timeout', msg.seconds ?? 150) : new EngineStreamError(msg.code ?? 'engine_error')
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

// Spec §10 golden fixture — one tap to load for acceptance runs (story + its context). The occasion is parent_day, as in the
// automated tests (scripts/golden-fixture.json): the Japanese review blocks 迎 for birthday_milestone ("お迎えが来る"), the golden answer's main.
const GOLDEN_CONTEXT: GiftContext = {
  ...DEFAULT_GIFT_CONTEXT,
  language: 'ja',
  relationship: 'parent_father',
  direction: 'up',
  occasion: '',
  purpose: 'thanks', // (the golden fixture's occasion was parent_day: 母の日・父の日 is 「ありがとう」 now)
  occasionDetail: '還暦',
}
const GOLDEN_FIXTURE =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

type Phase = 'elicit' | 'processing' | 'followup' | 'suggest' | 'reveal' | 'result' | 'order' | 'thin' | 'declined'

/**
 * harness  — /demo: the internal validation harness (A/B/C conditions, log export, golden fixture,
 *            diagnostics).
 * customer — / : the same engine with none of the test controls; ends in the order form.
 */
export type Mode = 'harness' | 'customer'

function ProcessingView({ stage, copy, phrases, quoteOpen, quoteClose }: { stage: EngineStage; copy: Copy; phrases: string[]; quoteOpen: string; quoteClose: string }) {
  const reduceMotion = useReducedMotion()
  // The visitor's own words, one at a time, fading in and out beside the ring (decorative: hidden from screen readers; nothing is sent anywhere).
  const [phraseIdx, setPhraseIdx] = useState(0)
  useEffect(() => {
    if (phrases.length < 2) return
    const id = window.setInterval(() => setPhraseIdx((i) => (i + 1) % phrases.length), 3200)
    return () => window.clearInterval(id)
  }, [phrases])
  // reading → choosing → checking are always listed; the extra "finding one more" step appears only when the engine really does it.
  const steps = STEP_ORDER.filter((s) => s !== 'replacing' || stage === 'replacing')
  const at = STEP_ORDER.indexOf(stage)
  return (
    <div className="flex flex-col items-center gap-10 py-24 text-accent" role="status">
      <svg width="120" height="120" viewBox="0 0 140 140" fill="none" aria-hidden="true">
        <circle cx="70" cy="70" r="54" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
        <circle
          cx="70" cy="70" r="54" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeDasharray="90 250" className={reduceMotion ? undefined : 'ink-loop-spin'}
        />
        <circle
          cx="70" cy="70" r="38" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1"
          strokeLinecap="round" strokeDasharray="40 200"
          className={reduceMotion ? undefined : 'ink-loop-spin-reverse'}
        />
        <circle cx="70" cy="70" r="3" fill="currentColor" fillOpacity="0.8" />
      </svg>
      {phrases.length > 0 && (
        <div className="storyPhraseBox" aria-hidden="true" data-testid="story-phrases" data-count={phrases.length}>
          <AnimatePresence mode="wait">
            <motion.p
              key={phraseIdx}
              className="storyPhrase font-serif-jp"
              data-testid="story-phrase"
              initial={{ opacity: reduceMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduceMotion ? 1 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.9, ease: 'easeInOut' }}
            >
              {quoteOpen}{phrases[phraseIdx % phrases.length]}{quoteClose}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
      <div className="text-center">
        <p className="font-serif-jp text-lg tracking-wider text-fg">
          {copy.processingTitle}
        </p>
        <ol className="font-label mt-5 flex flex-col items-center gap-1.5 text-[13px]" data-testid="processing-steps">
          {steps.map((s) => {
            const i = STEP_ORDER.indexOf(s)
            const state = i < at ? 'done' : i === at ? 'now' : 'next'
            return (
              <li key={s} data-step={s} data-state={state} aria-current={state === 'now' ? 'step' : undefined} className={state === 'now' ? 'text-fg' : state === 'done' ? 'text-mute' : 'text-mute opacity-50'}>
                <span aria-hidden="true">{state === 'done' ? '✓ ' : state === 'now' ? '· ' : '  '}</span>
                {copy.processingSteps[s]}
              </li>
            )
          })}
        </ol>
        <p className="font-label mt-4 text-[12px] text-mute">{copy.processingWait}</p>
      </div>
    </div>
  )
}

/** /demo: a full page. */
function HarnessShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-page px-6 py-10 text-fg">{children}</div>
}

/**
 * /: the WRITE section of the landing page, where the sender writes, chooses and orders. While the story is
 * being written it is two columns (the page's tips beside the composer); once the engine runs, the flow takes
 * the whole width of a single column.
 */
function CustomerShell({ children, aside, phase }: { children: React.ReactNode; aside?: ReactNode; phase: Phase }) {
  const [uiLang] = useLanguage()
  return (
    <section className="tintBand" id="write" data-phase={phase}>
      <div className={phase === 'elicit' ? 'wrap writeGrid' : 'wrap flowWrap'}>
        {phase === 'elicit' && <div>{aside}</div>}
        <div className="flowMain">
          {phase === 'elicit' && <BasketBar lang={toRevealLang(uiLang)} className="loopBar--under" />}
          {children}
        </div>
      </div>
    </section>
  )
}

export default function DemoApp({ mode = 'harness', aside }: { mode?: Mode; aside?: ReactNode } = {}) {
  const customer = mode === 'customer'
  const [phase, setPhase] = useState<Phase>('elicit')
  const [story, setStory] = useState('')
  // The story-opener question shown above the box (customer page): a known id from engine/story-questions.json, picked by the Composer.
  const [questionId, setQuestionId] = useState<string | null>(null)
  // A draft saved by an earlier visit (customer page): offered once, never applied silently.
  const [draftOffer, setDraftOffer] = useState<Draft | null>(() => (mode === 'customer' ? loadDraft() : null))
  // The language is shared with the landing page: starts from the sender's stored choice and writes it back.
  const [context, setContextState] = useState<GiftContext>(() => ({ ...DEFAULT_GIFT_CONTEXT, language: getLanguage() }))
  const setContext = (next: GiftContext) => {
    if (next.language !== context.language) setLanguage(next.language)
    setContextState(next)
  }
  // The landing page's steps and examples say "two cards" while 偲ぶ is picked (a remembrance result is main + second, no free pick).
  const memorialNow = occasionOf(context) === 'memorial'
  useEffect(() => {
    if (!customer) return
    setMemorialSelected(memorialNow)
    return () => setMemorialSelected(false)
  }, [customer, memorialNow])
  // while the wooden sizes are "coming soon" the lines about the carved form and the shipping say nothing about wood (src/demo/egift-copy.ts)
  const woodOnSale = useWoodOnSale()
  const maxRounds = useMaxRounds() // how many sets of characters one story gets (ICHIREI_MAX_ROUNDS, 2 by default)
  const baseCopy = COPY[context.language]
  const copy = useMemo(() => (woodOnSale ? baseCopy : egiftCopy(baseCopy, context.language)), [woodOnSale, baseCopy, context.language])
  const [chosen, setChosen] = useState<Candidate | null>(null)

  // The nav switch on the landing page changes the shared language; follow it.
  const [storeLanguage] = useLanguage()
  useEffect(() => {
    setContextState((c) => (c.language === storeLanguage ? c : { ...c, language: storeLanguage }))
  }, [storeLanguage])
  const [condition, setConditionState] = useState<Condition>('A')
  const [result, setResult] = useState<EngineResult | null>(null)
  // 「別の候補を見る」 (customer page): every set of candidates shown for THIS story (at most three), which one is on screen, and the note after a retry that found nothing new.
  const [sets, setSets] = useState<EngineResult[]>([])
  const [setIdx, setSetIdx] = useState(0)
  const [retryNote, setRetryNote] = useState(false)
  const [chosenSet, setChosenSet] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  // The draft of this story's pictures: one set per story, kept while the visitor tries other characters or other candidates.
  const draftRef: DraftRef = useRef(null)
  const [error, setError] = useState<string | null>(null)
  /** The server's code for the last refusal (limit_person shows the basket bar under the message). */
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [stage, setStage] = useState<EngineStage>('reading')
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null)
  const [followUpAnswer, setFollowUpAnswer] = useState('')
  // The answers already given (each at most FOLLOW_UP_MAX characters), kept apart from the story so each has its own limit.
  const [followUps, setFollowUps] = useState<string[]>([])
  const followUpsUsed = useRef(0)
  const memorialDeclined = useRef(false)
  // The request that just ran, so 「もう一度ためす」 (shown only after a failure) repeats exactly that request.
  const lastRun = useRef<(() => void) | null>(null)
  const sessionLogged = useRef(false)
  /** The server's signed ticket for the rounds of this moment (issued with round 1; sent back with every 「別の候補」). */
  const roundTicket = useRef<string | null>(null)

  // Customer site: when the flow moves on (processing → follow-up → cards → order form) bring the start of the
  // WRITE section back into view, so a long form never leaves the visitor in the middle of the next step.
  // Only a REAL step change scrolls (2026-11-14, C1): the phase is compared with the one before, so neither the first render nor the late answer of useReducedMotion (which re-runs an effect that
  // lists it) can scroll the landing page to #write on load. The result page is its own full-screen page: it does not scroll the landing behind it.
  const reduceMotion = useReducedMotion()
  const reduceRef = useRef(reduceMotion)
  reduceRef.current = reduceMotion
  const prevPhase = useRef<Phase>('elicit')
  useEffect(() => {
    const before = prevPhase.current
    prevPhase.current = phase
    if (!customer || before === phase || phase === 'result') return
    // when the cards arrive the page goes to the TOP OF THE CARDS (2026-11-15), not to the writing box above them
    const target = (phase === 'reveal' ? document.getElementById('cards') : null) ?? document.getElementById('write')
    target?.scrollIntoView({ block: 'start', behavior: reduceRef.current ? 'auto' : 'smooth' })
  }, [phase, customer])
  // the dock is hidden for the whole flow (a phase flag, C2)
  useEffect(() => {
    if (!customer) return
    setFlowActive(phase !== 'elicit')
    return () => setFlowActive(false)
  }, [customer, phase])
  // the result page has its own address state (#result): the browser's back button returns to the cards with the rounds as they were
  const [live, setLive] = useState<ResultLive | null>(null)
  const [receiverName, setReceiverName] = useState('')

  // The basket (2026-11-15): every time a result page opens, it is saved to the server under this browser's record — the chosen card, the story it came from, the names and the draft's id. Opening the
  // same result again is the same item; nothing is asked of a model. What is saved is exactly what the page needs to open the result page again.
  const savedKey = useRef('')
  useEffect(() => {
    if (!customer || phase !== 'result' || !live || !chosen || !result) return
    // The form reports one render AFTER a card is chosen (and a report from the card chosen before is still in `live` until then): save only a report that belongs to the card that was chosen,
    // so the character, its word, its line and its pictures can never come from two different cards (2026-11-18).
    if (live.kanji !== chosen.kanji || live.slot !== chosen.slot) return
    const set = sets[chosenSet] ?? result
    const purpose = purposeOf(context)
    const key = JSON.stringify([chosen.kanji, chosen.slot, chosenSet, live.reading, live.word, live.line, live.receiverName, live.preview.draftId, live.poem?.lines ?? null, context.relationship, purpose, context.language])
    if (savedKey.current === key) return
    savedKey.current = key
    const resume = { v: 1, story, followUps, context, questionId, result: set, kanji: chosen.kanji, receiver: live.receiverName }
    void fetch('/api/basket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        resume, story, language: context.language, kanji: chosen.kanji, reading: live.reading, word: live.word ?? '', line: live.line, to: live.receiverName, preview_id: live.preview.draftId,
        meaning: live.meaning, relationship: context.relationship, relationship_other: context.relationshipOther ?? '', purpose, purpose_other: context.purposeOther ?? '', occasion: occasionOf(context),
        round: chosenSet + 1, slot: chosen.slot, poem: live.poem,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number }>) : null))
      .then((j) => {
        if (j) setBasketCount(j.count)
      })
      .catch(() => {})
  }, [customer, phase, live, chosen, result, sets, chosenSet, story, followUps, context, questionId])
  // 「この贈りものを贈る →」 on the basket page opens the landing with ?resume=<item id>: the saved result page is put back, with no model call.
  useEffect(() => {
    if (!customer) return
    let id: string | null = null
    try {
      id = new URLSearchParams(window.location.search).get('resume')
    } catch {
      id = null
    }
    if (!id || !/^BK-[a-z2-9]{20}$/.test(id)) return
    let alive = true
    void (async () => {
      try {
        const r = await fetch(`/api/basket/${encodeURIComponent(id as string)}`, { credentials: 'same-origin' })
        if (!r.ok || !alive) return
        const item = (await r.json()) as { resume?: { story?: string; followUps?: string[]; context?: GiftContext; questionId?: string | null; result?: EngineResult; kanji?: string; receiver?: string } }
        const rs = item.resume
        const cand = rs?.result?.candidates?.find((c) => c.kanji === rs.kanji)
        if (!rs || !rs.story || !rs.context || !rs.result || !cand) return
        savedKey.current = '' // (the same card saves the same item again: nothing is duplicated)
        setLanguage(rs.context.language)
        setStory(rs.story)
        setFollowUps(Array.isArray(rs.followUps) ? rs.followUps : [])
        setContextState(rs.context)
        setQuestionId(rs.questionId ?? null)
        setResult(rs.result)
        setSets([rs.result])
        setSetIdx(0)
        setChosenSet(0)
        setChosen(cand)
        setReceiverName(rs.receiver ?? '')
        setDraftOffer(null)
        setPhase('result')
        try {
          window.history.replaceState(null, '', window.location.pathname + '#result')
        } catch {
          // an address that cannot be changed stays as it is
        }
        void refreshMe()
      } catch {
        // a basket that cannot be read leaves the page as it is
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer])
  useEffect(() => {
    if (!customer || phase !== 'result') return
    try {
      if (window.location.hash !== '#result') window.history.pushState({ ichireiResult: true }, '', '#result')
    } catch {
      // a page without history access simply has no address state
    }
    const onPop = () => {
      if (window.location.hash !== '#result') setPhase((p) => (p === 'result' ? 'reveal' : p))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [customer, phase])
  const leaveResult = (to: 'order' | 'reveal') => {
    try {
      if (window.location.hash === '#result') window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      // nothing to clear
    }
    if (to === 'order') trackPreview('result_to_order', { language: context.language })
    setPhase(to)
  }

  // Never lose a draft (customer page): the story, the chips and the question are saved in this browser as the visitor types — but not
  // while an earlier draft is still waiting for 続ける / 新しく書く, and never into a page without browser storage (saveDraft swallows that).
  useEffect(() => {
    if (!customer || draftOffer) return
    const id = window.setTimeout(() => {
      if (story.trim() === '') clearDraft()
      else saveDraft(draftOf(story, context, questionId))
    }, 400)
    return () => window.clearTimeout(id)
  }, [customer, draftOffer, story, context.relationship, context.direction, context.occasion, context.purpose, context.purposeOther, context.state, context.stateOther, context.relationshipOther, context.receiverGender, context.senderGender, context.occasionDetail, context.reader, questionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeCondition = (c: Condition) => {
    if (c === condition) return
    log('condition_changed', { from: condition, to: c })
    logSetCondition(c)
    setConditionState(c)
  }

  const runEngine = async (fullStory: string, answers: string[] = [], ctx: GiftContext = context, again: { exclude: string[]; retry: 1 | 2 } | null = null) => {
    lastRun.current = () => void runEngine(fullStory, answers, ctx, again)
    setPhase('processing')
    setRetryNote(false)
    setError(null)
    setErrorCode(null)
    setStage('reading')
    if (!sessionLogged.current) {
      log('session_started', {})
      sessionLogged.current = true
    }
    logSetStory([fullStory, ...answers].join('\n\n'))
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
        body: JSON.stringify({ story: fullStory, ...(answers.length ? { follow_ups: answers } : {}), ...(customer && questionId ? { prompt_question: { id: questionId, text: questionTextOf(questionId, toRevealLang(ctx.language)) ?? '' } } : {}), session: sessionId, source: customer ? 'customer' : 'harness', condition, ...contextToPayload(ctx), ...(again ? { exclude: again.exclude, retry: again.retry, ...(roundTicket.current ? { round_ticket: roundTicket.current } : {}) } : {}) }),
        signal: controller.signal,
      })
      if (!res.ok) {
        let message: string | null = null
        try {
          const body = (await res.json()) as { error?: string; code?: string }
          setErrorCode(body?.code ?? null)
          // the server's own words are shown only for the limits (it writes those in the page's language); every other answer shows the calm line, never a message or a status
          message = body?.code === 'story_too_long' || body?.code === 'follow_up_too_long' ? copy.storyTooLong : body?.code === 'rate_limited' ? copy.rateLimited : (body?.code === 'limit_person' || body?.code === 'limit_site' || body?.code === 'retry_limit') && typeof body?.error === 'string' ? body.error : null
        } catch {
          message = null
        }
        throw new ShownError(message ?? copy.serverError(res.status))
      }
      // Cards appear as they pass their checks (main first, then second, then the free pick): the page opens the reveal with the cards so far. The terminal result
      // still replaces it with the whole set, and a sender who has already moved on (chosen a card, opened the order form) is not pulled back.
      const showEarly = (partial: EngineResult) => {
        if (partial.status !== 'sufficient' || partial.suggest_memorial === true || partial.primary_kanji === null || !partial.candidates.some((c) => !c.eliminated)) return
        setResult(partial)
        setPhase((p) => (p === 'processing' || p === 'reveal' ? 'reveal' : p))
      }
      const isStream =
        (res.headers.get('content-type') ?? '').includes('ndjson') && res.body
      const engineResult: EngineResult = isStream
        ? await consumeEngineStream(res.body!, setStage, again ? undefined : showEarly, (t) => { roundTicket.current = t })
        : ((await res.json()) as EngineResult)
      if (again) {
        // 「別の候補を見る」: three new characters for the same story, or — when nothing new is true to it — the note to write a little more. Never an error page.
        const fresh = engineResult.status === 'sufficient' && engineResult.declined !== true && engineResult.primary_kanji !== null && engineResult.candidates.some((c) => !c.eliminated)
        trackPreview('candidates_retry', { language: ctx.language, n: again.retry })
        setRetryCount(again.retry)
        if (fresh) {
          setSets((list) => {
            const next = [...list, engineResult]
            setSetIdx(next.length - 1)
            return next
          })
          setResult(engineResult)
        } else setRetryNote(true)
        setPhase('reveal')
        return
      }
      setResult(engineResult)
      setSets([engineResult])
      setSetIdx(0)
      setRetryCount(0)
      log('engine_run', {
        status: engineResult.status,
        primary: engineResult.primary_kanji,
        candidates: engineResult.candidates.length,
        no_eligible_primary: engineResult.referee?.no_eligible_primary ?? false,
        language: ctx.language,
        relationship: ctx.relationship,
        direction: ctx.direction,
        occasion: occasionOf(ctx),
        purpose: purposeOf(ctx),
        state: ctx.state ?? '',
        has_occasion_detail: ctx.occasionDetail.trim() !== '',
        follow_ups_used: followUpsUsed.current,
      })
      if (engineResult.status === 'insufficient' && engineResult.declined === true) {
        // The goodwill check: a polite decline. Nothing to answer, nothing to choose.
        log('declined_shown', {})
        setPhase('declined')
      } else if (engineResult.status === 'insufficient') {
        if (followUpsUsed.current < MAX_FOLLOW_UPS && engineResult.follow_up_question) {
          followUpsUsed.current += 1
          setFollowUpQuestion(engineResult.follow_up_question)
          setFollowUpAnswer('')
          log('follow_up_shown', { question: engineResult.follow_up_question })
          if (customer) trackFlow('followup_shown', { language: ctx.language, set: questionSetOf(ctx), qid: questionId })
          setPhase('followup')
        } else {
          setPhase('thin')
        }
      } else if (engineResult.suggest_memorial === true && occasionOf(ctx) !== 'memorial' && !memorialDeclined.current) {
        // The story clearly says the person has died: ask the sender (never switch the occasion silently).
        log('memorial_suggested', {})
        setPhase('suggest')
      } else {
        if (customer) trackFlow('reveal_shown', { language: ctx.language, set: questionSetOf(ctx), qid: questionId })
        setPhase((p) => (p === 'order' ? p : 'reveal'))
      }
    } catch (e) {
      const message = e instanceof ModelTimeoutStreamError
        ? copy.timeout(e.seconds)
        : timedOut
        ? copy.timeout(Math.round(ENGINE_TIMEOUT_MS / 1000))
        : e instanceof StreamCutError
          ? copy.streamCut
          : e instanceof ShownError
            ? e.message
            : copy.busy // a network failure, a server code, anything else: the calm line
      setError(message)
      setPhase(again ? 'reveal' : 'elicit')
    } finally {
      window.clearTimeout(deadline)
    }
  }

  // "もう一度試す": back to the story input with the current story text kept, so the
  // sender can edit it and run again. Result, error and follow-up state are cleared.
  const tryAgain = () => {
    log('retry_clicked', { story_chars: story.length })
    followUpsUsed.current = 0
    memorialDeclined.current = false
    // The story box gets the story with the answers folded in (the box then shows the over-limit line if it is past the limit; nothing is ever cut), so nothing the sender wrote is lost.
    setStory([story, ...followUps].join('\n\n'))
    setFollowUps([])
    setResult(null)
    setSets([])
    setSetIdx(0)
    setRetryNote(false)
    setRetryCount(0)
    setError(null)
    setFollowUpQuestion(null)
    setFollowUpAnswer('')
    setStage('reading')
    setChosen(null)
    setPhase('elicit')
  }

  // The sender's answer to "this sounds like someone who has passed away": look again as memorial, or keep what was found.
  const acceptMemorial = () => {
    log('memorial_accepted', {})
    const next = { ...context, purpose: 'memorial' as const, occasion: '' as const }
    setContext(next)
    setResult(null)
    followUpsUsed.current = 0
    void runEngine(story, followUps, next)
  }
  const declineMemorial = () => {
    log('memorial_declined', {})
    memorialDeclined.current = true
    if (customer) trackFlow('reveal_shown', { language: context.language, set: questionSetOf(context), qid: questionId })
    setPhase('reveal')
  }

  // 「別の候補を見る」: three new characters for the same story, leaving out every character already shown (at most two retries).
  const shownForms = () => [...new Set(sets.flatMap((r) => r.candidates.filter((c) => !c.eliminated).flatMap((c) => [c.kanji, cleanInscriptionForm(c.kanji, c.inscription_form) ?? ''])).filter(Boolean))]
  const seeOthers = () => {
    if (retryCount >= maxRounds - 1 || phase !== 'reveal') return
    void runEngine(story, followUps, context, { exclude: shownForms(), retry: (retryCount + 1) as 1 | 2 })
  }
  const pc = PREVIEW_COPY[toRevealLang(context.language)]

  const submitFollowUp = () => {
    const answer = followUpAnswer.trim()
    if (!answer) return
    setFollowUpAnswer('')
    const next = [...followUps, clipStory(answer, FOLLOW_UP_MAX)]
    setFollowUps(next)
    void runEngine(story, next)
  }

  const revealLang = toRevealLang(context.language)
  const phrases = useMemo(() => storyPhrases(story), [story])
  const body = (
    <>
      {error && (
        <div role="alert" className="font-label mb-6 rounded-sm border border-seal/60 bg-seal/10 p-4 text-sm text-fg">
          <p>{error}</p>
          {customer && errorCode === 'limit_person' && <BasketBar lang={revealLang} className="loopBar--under" />}
          {customer && lastRun.current && (
            <button type="button" className="btn ghost mt-4" data-testid="retry-request" onClick={() => lastRun.current?.()}>
              {pc.retry}
            </button>
          )}
        </div>
      )}

      {phase === 'elicit' && customer && draftOffer && (
        <div className="draftBanner" role="status" data-testid="draft-banner">
          <span>{OPENER[revealLang].draftBanner}</span>
          <button
            type="button"
            className="btn ghost"
            data-testid="draft-continue"
            onClick={() => {
              setStory(draftOffer.story)
              setContextState((c) => ({ ...c, relationship: draftOffer.relationship, direction: draftOffer.direction, occasion: draftOffer.occasion, purpose: (draftOffer.purpose ?? '') as GiftContext['purpose'], purposeOther: draftOffer.purposeOther ?? '', state: (draftOffer.state ?? '') as GiftContext['state'], stateOther: draftOffer.stateOther ?? '', relationshipOther: draftOffer.relationshipOther ?? '', receiverGender: (draftOffer.receiverGender ?? '') as GiftContext['receiverGender'], senderGender: (draftOffer.senderGender ?? '') as GiftContext['senderGender'], occasionDetail: draftOffer.occasionDetail, reader: draftOffer.reader as GiftContext['reader'] }))
              setQuestionId(draftOffer.questionId)
              trackFlow('draft_restored', { language: context.language })
              setDraftOffer(null)
            }}
          >
            {OPENER[revealLang].draftContinue}
          </button>
          <button
            type="button"
            className="btn ghost"
            data-testid="draft-new"
            onClick={() => {
              clearDraft() // 「新しく書く」 deletes the saved draft at once
              setDraftOffer(null)
            }}
          >
            {OPENER[revealLang].draftNew}
          </button>
        </div>
      )}

      {phase === 'elicit' && (
        <>
          {customer ? (
            <Composer
              story={story}
              onStoryChange={setStory}
              onSubmit={() => {
                setFollowUps([])
                trackFlow('story_submitted', { language: context.language, set: questionSetOf(context), qid: questionId })
                void runEngine(story)
              }}
              copy={copy}
              lang={revealLang}
              context={context}
              onContextChange={setContext}
              questionId={questionId}
              onQuestionChange={setQuestionId}
            />
          ) : (
            <Elicitation
              story={story}
              onStoryChange={setStory}
              onSubmit={() => {
                setFollowUps([])
                void runEngine(story)
              }}
              submitting={false}
              copy={copy}
              context={context}
              onContextChange={setContext}
              showLanguage
              showInscriptionScript
            />
          )}
          {!customer && (
            <button
              type="button"
              onClick={() => {
                setStory(GOLDEN_FIXTURE)
                setContext(GOLDEN_CONTEXT)
              }}
              className="font-label mt-8 text-[11px] tracking-wide text-mute underline-offset-4 transition-colors hover:text-fg hover:underline"
            >
              load golden fixture (§10 acceptance test)
            </button>
          )}
        </>
      )}

      {phase === 'processing' && <ProcessingView stage={stage} copy={copy} phrases={customer ? phrases : []} quoteOpen={revealLang === 'en' ? '“' : '「'} quoteClose={revealLang === 'en' ? '”' : '」'} />}

      {phase === 'followup' && followUpQuestion && (
        <motion.div
          className={customer ? 'composer' : undefined}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="font-label mb-4 text-[12px] tracking-[0.2em] text-accent">{copy.followUpHeading}</p>
          <p className="font-mincho mb-8 text-xl leading-relaxed text-fg" data-testid="followup-question">
            {followUpQuestion}
          </p>
          <textarea
            value={followUpAnswer}
            onChange={(e) => setFollowUpAnswer(clipStory(e.target.value, FOLLOW_UP_MAX))}
            maxLength={FOLLOW_UP_MAX}
            data-testid="followup-input"
            aria-label={followUpQuestion}
            rows={5}
            placeholder={copy.followUpPlaceholder}
            className="font-serif-jp w-full resize-none rounded-sm border border-line bg-page p-4 text-base leading-loose text-fg outline-none transition-colors placeholder:text-mute focus:border-accent"
          />
          {(customer || storyLength(followUpAnswer) >= FOLLOW_UP_COUNTER_FROM) && (
            <p data-testid="story-counter" className="font-label mt-2 text-right text-[12px] text-mute">
              {copy.storyCounter(storyLength(followUpAnswer), FOLLOW_UP_MAX)}
            </p>
          )}
          <button
            type="button"
            onClick={submitFollowUp}
            disabled={!followUpAnswer.trim()}
            className={
              customer
                ? 'btn primary mt-6'
                : 'font-label mt-6 rounded-full bg-accent px-8 py-3.5 text-sm tracking-[0.1em] text-page transition-all disabled:cursor-not-allowed disabled:opacity-40'
            }
          >
            {copy.followUpSubmit}
          </button>
        </motion.div>
      )}

      {phase === 'suggest' && (
        <div className={customer ? 'composer' : 'text-center'} data-testid="memorial-suggest" role="group" aria-labelledby="memorial-suggest-title">
          <p id="memorial-suggest-title" className="font-mincho text-xl leading-relaxed text-fg">
            {copy.memorial.suggestTitle}
          </p>
          <p className="font-serif-jp mt-4 text-sm leading-loose text-mute">{copy.memorial.suggestBody}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" data-testid="memorial-yes" onClick={acceptMemorial} className={customer ? 'btn primary' : 'font-label rounded-full bg-accent px-6 py-2.5 text-sm text-page'}>
              {copy.memorial.suggestYes}
            </button>
            <button type="button" data-testid="memorial-no" onClick={declineMemorial} className={customer ? 'btn ghost' : 'font-label rounded-full border border-accent/40 px-6 py-2.5 text-sm text-fg hover:border-accent'}>
              {copy.memorial.suggestNo}
            </button>
          </div>
        </div>
      )}

      {phase === 'declined' && (
        <div className="py-12 text-center" data-declined>
          <p className="font-serif-jp mx-auto max-w-xl text-sm leading-loose text-fg">{result?.follow_up_question}</p>
          <button
            type="button"
            onClick={() => setPhase('elicit')}
            className={customer ? 'btn ghost mt-8' : 'font-label mt-8 rounded-full border border-accent/40 px-6 py-2.5 text-sm text-fg transition-colors hover:border-accent hover:bg-accent/10'}
          >
            {copy.thinBack}
          </button>
        </div>
      )}

      {phase === 'thin' && (
        <div className="py-12 text-center">
          <p className="font-mincho text-xl leading-relaxed text-fg">{copy.thinTitle}</p>
          <p className="font-serif-jp mt-4 text-sm leading-loose text-mute">{copy.thinBody}</p>
          <button
            type="button"
            onClick={() => setPhase('elicit')}
            className={customer ? 'btn ghost mt-8' : 'font-label mt-8 rounded-full border border-accent/40 px-6 py-2.5 text-sm text-fg transition-colors hover:border-accent hover:bg-accent/10'}
          >
            {copy.thinBack}
          </button>
        </div>
      )}

      {(phase === 'reveal' || phase === 'order' || phase === 'result') && result && (
        <div hidden={phase !== 'reveal'}>
          {result.primary_kanji !== null && result.candidates.some((c) => !c.eliminated) && (
            <Reveal
              key={setIdx}
              result={customer && sets[setIdx] ? sets[setIdx] : result}
              story={story}
              followUps={followUps}
              condition={customer ? 'A' : condition}
              copy={copy}
              context={context}
              diagnostics={!customer}
              onFinalize={
                customer
                  ? (c) => {
                      setChosen(c)
                      setChosenSet(setIdx)
                      setPhase('result') // the character, the four pictures and the poem come first, on their own page (B3)
                    }
                  : undefined
              }
            />
          )}
          {customer && sets.length > 0 && result.primary_kanji !== null && (
            <div className="candidateSets" data-testid="candidate-sets">
              {retryCount < maxRounds - 1 && !retryNote ? (
                <button type="button" className="btn ghost" data-testid="see-others" onClick={seeOthers}>
                  {pc.another(maxRounds - 1 - retryCount)}
                </button>
              ) : (
                <p className="sent" role="status" data-testid="retry-cap">
                  {retryCount >= maxRounds - 1 ? pc.noMore : pc.addDetail}
                </p>
              )}
              {sets.length > 1 && (
                <p className="setNav sent">
                  <button type="button" className="backLink" data-testid="set-prev" disabled={setIdx === 0} onClick={() => setSetIdx((i) => Math.max(0, i - 1))}>
                    {pc.prevSet}
                  </button>
                  <span data-testid="set-label">{pc.setLabel(setIdx + 1, sets.length)}</span>
                  <button type="button" className="backLink" data-testid="set-next" disabled={setIdx >= sets.length - 1} onClick={() => setSetIdx((i) => Math.min(sets.length - 1, i + 1))}>
                    {pc.nextSet}
                  </button>
                </p>
              )}
            </div>
          )}
          <div className="mt-12 text-center">
            <button
              type="button"
              onClick={tryAgain}
              data-testid={customer ? 'edit-story' : undefined}
              className={customer ? 'backLink' : 'font-label rounded-full border border-accent/40 px-6 py-2.5 text-sm text-fg transition-colors hover:border-accent hover:bg-accent/10'}
            >
              {customer ? pc.editStory : copy.tryAgain}
            </button>
          </div>
        </div>
      )}

      {customer && phase === 'result' && live && chosen && live.kanji === chosen.kanji && live.slot === chosen.slot && <ResultPage live={live} onMake={() => leaveResult('order')} onAnother={() => leaveResult('reveal')} />}

      {customer && (phase === 'order' || phase === 'result') && result && chosen && (
        <div hidden={phase === 'result'}>
        <OrderForm onLive={setLive} receiverName={receiverName} onReceiver={setReceiverName} result={customer && sets[chosenSet] ? sets[chosenSet] : result} draftRef={draftRef} shown={sets.flatMap((r, i) => r.candidates.filter((c) => !c.eliminated).map((c) => ({ set: (i + 1) as 1 | 2 | 3, candidate: c })))} story={story} followUps={followUps} promptQuestionId={customer ? questionId : null} candidate={chosen} copy={copy} onBack={() => setPhase('reveal')} />
        </div>
      )}

      {!customer && result && (phase === 'reveal' || phase === 'thin') && (
        <details className="mt-14 opacity-60">
          <summary className="font-label cursor-pointer text-[11px] tracking-[0.15em] text-mute">{copy.rawContract}</summary>
          <pre className="mt-3 max-h-[50vh] overflow-auto rounded-sm border border-line bg-surface p-4 text-[11px] leading-relaxed text-mute">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
    </>
  )

  if (customer) {
    return (
      <CustomerShell aside={aside} phase={phase}>
        {body}
      </CustomerShell>
    )
  }

  return (
    <HarnessShell>
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mincho text-lg text-fg">一字礼</span>
            <span className="font-label text-xs tracking-[0.25em] text-accent">ICHIREI · VALIDATION HARNESS</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="font-label mr-1 text-[10px] tracking-wide text-mute">condition</span>
              {CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => changeCondition(c.id)}
                  className={`font-label h-7 w-7 rounded-full text-xs transition-colors ${
                    condition === c.id ? 'bg-accent text-page' : 'border border-accent/30 text-mute hover:border-accent'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={exportEvents}
              className="font-label rounded-full border border-fg/20 px-3 py-1.5 text-[11px] text-mute transition-colors hover:border-fg/50"
            >
              {copy.exportLog}
            </button>
          </div>
        </header>
        {body}
      </div>
    </HarnessShell>
  )
}
