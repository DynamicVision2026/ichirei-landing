import { useEffect, useRef, useState } from 'react'
import { trackFlow } from '../demo/analytics'
import { nextQuestionId, questionSetOf, questionsOf, randomFirst, setOfQuestionId } from '../demo/questions'
import { OPENER, STORY_MIN } from './opener-copy'
import {
  DIRECTION_CODES,
  OCCASION_CODES,
  OCCASION_DETAIL_MAX,
  READER_CHOICES,
  RELATIONSHIP_CODES,
  STORY_MAX,
  appendSpoken,
  clipStory,
  contextComplete,
  storyLength,
  type Copy,
  type GiftContext,
} from '../demo/i18n.ts'
import type { RevealLang } from './copy.ts'
import { TEXT } from './copy.ts'

// The WRITE section's composer (customer site): relationship / direction / occasion as chips, the optional
// occasion detail, the one-moment textarea with a live counter and the soft length hint, and the voice button.
// It collects exactly what the harness' Elicitation collects (same GiftContext, same limits); DemoApp does the
// posting to /api/select. The language is the page's language switch, so there is no language control here.

interface SpeechAlternative {
  transcript: string
}
interface SpeechResult {
  isFinal: boolean
  0: SpeechAlternative
}
interface SpeechResultEvent {
  resultIndex: number
  results: { length: number; [i: number]: SpeechResult }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function Chips<T extends string>({
  label,
  codes,
  labels,
  value,
  onPick,
  name,
}: {
  label: string
  codes: readonly T[]
  labels: Record<T, string>
  value: T | ''
  onPick: (c: T) => void
  name: string
}) {
  return (
    <div className="cgroup" role="group" aria-labelledby={`cg-${name}`}>
      <span className="clab" id={`cg-${name}`}>
        {label}
      </span>
      <div className="cchips">
        {codes.map((c) => (
          <button key={c} type="button" className="cchip" data-chip={`${name}:${c}`} aria-pressed={value === c} onClick={() => onPick(c)}>
            {labels[c]}
          </button>
        ))}
      </div>
    </div>
  )
}

type Props = {
  story: string
  onStoryChange: (s: string) => void
  onSubmit: () => void
  copy: Copy
  lang: RevealLang
  context: GiftContext
  onContextChange: (next: GiftContext) => void
  /** The story-opener question shown above the box (a known id from engine/story-questions.json), chosen here and held by the page. */
  questionId: string | null
  onQuestionChange: (id: string | null) => void
}

// story_opened is reported once per page load (the Composer remounts after a retry).
let openedReported = false

export default function Composer({ story, onStoryChange, onSubmit, copy, lang, context, onContextChange, questionId, onQuestionChange }: Props) {
  const t = TEXT[lang]
  const o = OPENER[lang]
  const setCtx = (patch: Partial<GiftContext>) => onContextChange({ ...context, ...patch })
  const n = storyLength(story)
  // A short sentence is enough, but not an empty or junk try: every submit costs real AI money (Part A3).
  const longEnough = storyLength(story.trim()) >= STORY_MIN
  const ready = contextComplete(context) && longEnough
  const set = questionSetOf(context)
  const questions = set ? questionsOf(set, lang) : []
  const question = questions.find((q) => q.id === questionId) ?? null
  // Remembrance: the wording stops speaking of gifts (the person has died; the character is kept, not given).
  const memorial = context.occasion === 'memorial'

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [voiceLimit, setVoiceLimit] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechSupported = getSpeechRecognition() !== null
  const storyRef = useRef(story)
  storyRef.current = story
  useEffect(() => () => recognitionRef.current?.stop(), [])

  // The question: once a relationship and an occasion are picked, show ONE specific question (a random angle first, so the question never
  // steers every story to the same few characters). A saved draft brings its own question back; changing the set picks a new one.
  useEffect(() => {
    if (!set) {
      if (questionId !== null) onQuestionChange(null)
      return
    }
    if (setOfQuestionId(questionId) === set) return
    const id = randomFirst(set)
    onQuestionChange(id)
    trackFlow('question_shown', { language: context.language, set, qid: id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set])
  const switchQuestion = () => {
    if (!set) return
    const id = nextQuestionId(set, questionId)
    onQuestionChange(id)
    trackFlow('question_switched', { language: context.language, set, qid: id })
    trackFlow('question_shown', { language: context.language, set, qid: id })
  }

  // story_opened: the story section comes into view (once per page load).
  const formRef = useRef<HTMLFormElement | null>(null)
  useEffect(() => {
    if (openedReported) return
    const el = formRef.current
    const fire = () => {
      if (openedReported) return
      openedReported = true
      trackFlow('story_opened', { language: context.language })
    }
    if (!el || typeof IntersectionObserver === 'undefined') return fire()
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        fire()
        io.disconnect()
      }
    }, { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const Ctor = getSpeechRecognition()
    if (!Ctor) return
    setVoiceLimit(false)
    trackFlow('voice_used', { language: context.language, set, qid: questionId })
    const rec = new Ctor()
    rec.lang = copy.speechLang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const text = r[0].transcript.trim()
          if (text) {
            // never past the limit without a word: the first STORY_MAX characters are kept, the page says so and stops listening
            const next = appendSpoken(storyRef.current, text)
            storyRef.current = next.text
            onStoryChange(next.text)
            if (next.clipped) setVoiceLimit(true)
            if (next.full) rec.stop()
          }
        } else {
          interimText += r[0].transcript
        }
      }
      setInterim(interimText)
    }
    rec.onend = () => {
      setListening(false)
      setInterim('')
      recognitionRef.current = null
    }
    rec.onerror = () => {
      setListening(false)
      setInterim('')
    }
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  return (
    <form
      ref={formRef}
      className="composer"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSubmit()
      }}
    >
      <Chips name="relationship" label={copy.relationshipLabel} codes={RELATIONSHIP_CODES} labels={copy.relationships} value={context.relationship} onPick={(c) => setCtx({ relationship: c })} />
      <Chips name="direction" label={memorial ? copy.memorial.directionLabel : copy.directionLabel} codes={DIRECTION_CODES} labels={memorial ? copy.memorial.directions : copy.directions} value={context.direction} onPick={(c) => setCtx({ direction: c })} />
      <Chips name="occasion" label={copy.occasionLabel} codes={OCCASION_CODES} labels={copy.occasions} value={context.occasion} onPick={(c) => setCtx({ occasion: c })} />

      {!memorial && (
        <details className="readerField" data-testid="reader-field" open={context.reader ? true : undefined}>
          <summary>{o.readerLabel}</summary>
          <div className="cchips" role="group" aria-label={o.readerLabel}>
            {READER_CHOICES.map((r) => (
              <button key={r || 'same'} type="button" className="cchip" data-chip={`reader:${r || 'same'}`} aria-pressed={(context.reader ?? '') === r} onClick={() => setCtx({ reader: r })}>
                {o.readerOptions[r === '' ? '' : r]}
              </button>
            ))}
          </div>
        </details>
      )}

      <label className="clab" htmlFor="occasion-detail">
        {copy.occasionDetailLabel}
      </label>
      <input
        id="occasion-detail"
        name="occasion_detail"
        type="text"
        value={context.occasionDetail}
        maxLength={OCCASION_DETAIL_MAX}
        onChange={(e) => setCtx({ occasionDetail: e.target.value })}
        placeholder={copy.occasionDetailPlaceholder}
      />

      {question ? (
        <>
          <label className="qPrompt" htmlFor="moment" data-testid="story-question" data-question-id={question.id}>
            {question.text}
          </label>
          <p className="qNote" data-testid="question-optional">
            {o.optionalNote}
          </p>
          <button type="button" className="qSwitch" data-testid="question-switch" onClick={switchQuestion}>
            {o.switchQuestion}
          </button>
        </>
      ) : (
        <label className="clab" htmlFor="moment">
          {t.cMom}
        </label>
      )}
      <textarea
        id="moment"
        data-testid="story-input"
        rows={6}
        value={story}
        maxLength={STORY_MAX}
        onChange={(e) => onStoryChange(clipStory(e.target.value))}
        placeholder={question ? o.answerHint : copy.storyPlaceholder}
      />
      <div className="cmeta">
        <span data-testid="story-hint">{copy.storyHint}</span>
        {n > 0 && !longEnough && <span data-testid="story-too-short">{o.tooShort}</span>}
        <span className="cnt" data-testid="story-counter" aria-live="off">
          {copy.storyCounter(n, STORY_MAX)}
        </span>
      </div>

      {!speechSupported && (
        <span className="sent" data-testid="voice-none">
          {o.voiceNone}
        </span>
      )}
      {speechSupported && (
        <button type="button" className={`btn ghost voice${listening ? ' on' : ''}`} onClick={toggleVoice} aria-pressed={listening}>
          <span className="dot" aria-hidden="true" />
          {listening ? copy.voiceListening : copy.voiceStart}
        </button>
      )}
      {interim && <span className="sent">{interim}…</span>}
      {voiceLimit && (
        <span className="sent" role="status" data-testid="voice-limit-note">
          {copy.voiceLimit}
        </span>
      )}

      <button type="submit" className="btn primary" disabled={!ready}>
        {t.cGo}
      </button>
      {!contextComplete(context) && <p className="sent">{copy.contextMissing}</p>}
    </form>
  )
}
