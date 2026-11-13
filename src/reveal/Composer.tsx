import { useEffect, useRef, useState } from 'react'
import { trackFlow, trackUs } from '../demo/analytics'
import { OCCASION_CHIPS, RELATIONSHIP_CHIPS, occasionChipOf, relationshipChipOf } from '../order/en-chips.ts'
import { nextQuestionId, questionSetOf, questionsOf, randomFirst, setOfQuestionId } from '../demo/questions'
import { OPENER, STORY_MIN } from './opener-copy'
import {
  DIRECTION_CODES,
  OCCASION_DETAIL_MAX,
  PURPOSE_CODES,
  STATE_CODES,
  occasionOf,
  purposeOf,
  READER_CHOICES,
  RELATIONSHIP_CODES,
  STORY_MAX,
  contextComplete,
  storyLength,
  type Copy,
  type GiftContext,
} from '../demo/i18n.ts'
import { PURPOSE_COPY } from '../demo/purpose-copy.ts'
import { VOICE_LANGS, insertSpoken, isVoiceLang, loadVoiceLang, saveVoiceLang, shouldRestart, voiceLangForPage, type VoiceLang } from './voice.ts'
import { PURPOSE_OTHER_MAX, RELATIONSHIP_OTHER_MAX, STATE_OTHER_MAX, directionForRelationship } from '../order/purpose.ts'
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
  onerror: ((e: { error?: string }) => void) | null
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
  optional,
}: {
  label: string
  codes: readonly T[]
  labels: Record<T, string>
  value: T | ''
  onPick: (c: T | '') => void
  name: string
  /** An optional group: pressing the chosen chip again clears it. */
  optional?: boolean
}) {
  return (
    <div className="cgroup" role="group" aria-labelledby={`cg-${name}`}>
      <span className="clab" id={`cg-${name}`}>
        {label}
      </span>
      <div className="cchips">
        {codes.map((c) => (
          <button key={c} type="button" className="cchip" data-chip={`${name}:${c}`} aria-pressed={value === c} onClick={() => onPick(optional && value === c ? '' : c)}>
            {labels[c]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** English (2026-11-12): chips whose label is not the code — Wife and Husband are both `spouse`, so the pressed one is the chip the sender chose (or, for a restored draft, the first of its code). */
function ChipRow({ label, name, chips, pressed, onPick, base }: { label: string; name: string; chips: readonly { code: string; label: string }[]; pressed: string; onPick: (code: string) => void; base: (code: string) => string }) {
  // data-chip keeps the code the chip stands for (relationship:spouse, purpose:thanks) on the FIRST chip of that code, as every test and the dashboard know it; the others carry their own code
  return (
    <div className="cgroup" role="group" aria-labelledby={`cg-${name}`}>
      <span className="clab" id={`cg-${name}`}>
        {label}
      </span>
      <div className="cchips">
        {chips.map((c, i) => (
          <button key={c.code} type="button" className="cchip" data-chip={`${name}:${chips.findIndex((x) => base(x.code) === base(c.code)) === i ? base(c.code) : c.code}`} data-chip-code={c.code} aria-pressed={pressed === c.code} onClick={() => onPick(c.code)}>
            {c.label}
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
  // Part 7: the direction chip that goes with the relationship is pre-selected (it looks exactly like a chosen chip and can be changed). Only a direction the sender has NOT chosen themselves
  // is replaced when they change the relationship: `autoDirection` remembers what we put there.
  const autoDirection = useRef<string>('')
  const pickRelationship = (c: string) => {
    const want = directionForRelationship(c) ?? ''
    const mine = context.direction === '' || context.direction === autoDirection.current
    if (mine) {
      autoDirection.current = want
      setCtx({ relationship: c as GiftContext['relationship'], direction: want as GiftContext['direction'] })
    } else setCtx({ relationship: c as GiftContext['relationship'] })
  }
  // English chips: which relationship chip and which occasion chip the sender pressed (the codes behind them are shared)
  const [relChip, setRelChip] = useState<string>('')
  const [occChip, setOccChip] = useState<string>('')
  const n = storyLength(story)
  // A short sentence is enough, but not an empty or junk try: every submit costs real AI money (Part A3).
  const longEnough = storyLength(story.trim()) >= STORY_MIN
  // Never cut silently: past STORY_MAX the text stays exactly as pasted, the counter turns red, one line says why, and the button waits.
  const over = n > STORY_MAX
  const ready = contextComplete(context) && longEnough && !over
  // the owner dashboard's funnel: the relationship and the purpose are chosen (once per page load)
  const chipsDone = useRef(false)
  useEffect(() => {
    if (!chipsDone.current && contextComplete(context)) {
      chipsDone.current = true
      trackFlow('chips_done', { language: context.language })
    }
  }, [context])
  const set = questionSetOf(context)
  const questions = set ? questionsOf(set, lang) : []
  const question = questions.find((q) => q.id === questionId) ?? null
  // Remembrance: the wording stops speaking of gifts (the person has died; the character is kept, not given).
  const memorial = occasionOf(context) === 'memorial'
  const pc = PURPOSE_COPY[context.language]
  const purpose = purposeOf(context)
  const OtherText = ({ name, value, max, placeholder, onChange }: { name: string; value: string; max: number; placeholder: string; onChange: (v: string) => void }) => (
    <label className="cother">
      <input id={name} name={name} type="text" data-testid={name} value={value} maxLength={max} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
      <span className="cotherLimit">{pc.limit(max)}</span>
    </label>
  )

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

  // Voice (2026-11-05, Part 9): the browser's own recognition in the language of the picker (the page language until the sender picks), words shown while speaking, listening kept on across
  // the browser's own stops, speech ADDED at the cursor (typed text is never replaced). No audio and no text goes anywhere but into the box.
  const [voiceLang, setVoiceLang] = useState<VoiceLang>(() => loadVoiceLang() ?? voiceLangForPage(context.language))
  const voicePicked = useRef(loadVoiceLang() !== null)
  useEffect(() => {
    if (!voicePicked.current) setVoiceLang(voiceLangForPage(context.language))
  }, [context.language])
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const wantRef = useRef(false) // the button is on
  const errorRef = useRef<string | null>(null)
  const cursorRef = useRef(0)
  const restartsRef = useRef<number[]>([])
  const voiceLangRef = useRef(voiceLang)
  voiceLangRef.current = voiceLang

  const stopVoice = () => {
    wantRef.current = false
    recognitionRef.current?.stop()
    setListening(false)
    setInterim('')
  }
  const beginVoice = () => {
    const Ctor = getSpeechRecognition()
    if (!Ctor || !wantRef.current) return
    const rec = new Ctor()
    rec.lang = voiceLangRef.current
    rec.continuous = true
    rec.interimResults = true
    errorRef.current = null
    rec.onresult = (e) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const text = r[0].transcript.trim()
          if (!text) continue
          // never past the limit without a word: what was said is kept whole, the page says so and stops listening
          const next = insertSpoken(storyRef.current, text, cursorRef.current, STORY_MAX)
          storyRef.current = next.text
          cursorRef.current = next.cursor
          onStoryChange(next.text)
          window.setTimeout(() => {
            const ta = taRef.current
            if (ta && document.activeElement === ta) ta.setSelectionRange(next.cursor, next.cursor)
          }, 0)
          if (next.over) setVoiceLimit(true)
          if (next.full) stopVoice()
        } else {
          interimText += r[0].transcript
        }
      }
      setInterim(interimText)
    }
    rec.onerror = (e) => {
      errorRef.current = e?.error ?? 'error'
    }
    rec.onend = () => {
      setInterim('')
      recognitionRef.current = null
      // the browser stops by itself on silence: while the button is still on, listen again (unless the microphone was refused, or it is stopping in a loop)
      const now = Date.now()
      restartsRef.current = restartsRef.current.filter((t) => now - t < 2000)
      if (shouldRestart(wantRef.current, errorRef.current) && restartsRef.current.length < 6) {
        restartsRef.current.push(now)
        window.setTimeout(beginVoice, 120)
        return
      }
      wantRef.current = false
      setListening(false)
    }
    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      wantRef.current = false
      setListening(false)
    }
  }
  const toggleVoice = () => {
    if (listening) {
      stopVoice()
      return
    }
    if (!getSpeechRecognition()) return
    setVoiceLimit(false)
    trackFlow('voice_used', { language: context.language, set, qid: questionId })
    cursorRef.current = taRef.current?.selectionStart ?? storyRef.current.length
    wantRef.current = true
    restartsRef.current = []
    setListening(true)
    beginVoice()
  }
  useEffect(() => () => {
    wantRef.current = false
    recognitionRef.current?.stop()
  }, [])

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
      {lang === 'en' ? (
        <ChipRow
          name="relationship"
          label={copy.relationshipLabel}
          chips={RELATIONSHIP_CHIPS}
          base={(code) => RELATIONSHIP_CHIPS.find((c) => c.code === code)?.relationship ?? code}
          pressed={context.relationship ? (RELATIONSHIP_CHIPS.find((c) => c.code === relChip && c.relationship === context.relationship)?.code ?? relationshipChipOf(context.relationship)?.code ?? '') : ''}
          onPick={(code) => {
            const chip = RELATIONSHIP_CHIPS.find((c) => c.code === code)
            if (!chip) return
            setRelChip(code)
            pickRelationship(chip.relationship)
          }}
        />
      ) : (
        <Chips name="relationship" label={copy.relationshipLabel} codes={[...RELATIONSHIP_CODES, 'other'] as const} labels={{ ...copy.relationships, other: pc.other }} value={context.relationship} onPick={(c) => pickRelationship(c)} />
      )}
      {context.relationship === 'other' && <OtherText name="relationship_other" value={context.relationshipOther ?? ''} max={RELATIONSHIP_OTHER_MAX} placeholder={pc.relationshipOtherPlaceholder} onChange={(v) => setCtx({ relationshipOther: v })} />}
      <Chips name="direction" label={memorial ? copy.memorial.directionLabel : copy.directionLabel} codes={DIRECTION_CODES} labels={memorial ? copy.memorial.directions : copy.directions} value={context.direction} onPick={(c) => setCtx({ direction: c })} />
      {lang === 'en' ? (
        <ChipRow
          name="purpose"
          label={pc.purposeLabel}
          chips={OCCASION_CHIPS}
          base={(code) => OCCASION_CHIPS.find((c) => c.code === code)?.purpose ?? code}
          pressed={purpose ? (OCCASION_CHIPS.find((c) => c.code === occChip && c.purpose === purpose)?.code ?? occasionChipOf(purpose)?.code ?? '') : ''}
          onPick={(code) => {
            const chip = OCCASION_CHIPS.find((c) => c.code === code)
            if (!chip) return
            setOccChip(code)
            trackUs('occasion_chip', code)
            setCtx({ purpose: chip.purpose, occasion: '', occasionDetail: chip.detail })
          }}
        />
      ) : (
        <Chips name="purpose" label={pc.purposeLabel} codes={PURPOSE_CODES} labels={pc.purposes} value={purpose} onPick={(c) => setCtx({ purpose: c, occasion: '' })} />
      )}
      {purpose === 'other' && <OtherText name="purpose_other" value={context.purposeOther ?? ''} max={PURPOSE_OTHER_MAX} placeholder={pc.purposeOtherPlaceholder} onChange={(v) => setCtx({ purposeOther: v })} />}
      <Chips name="state" label={pc.stateLabel} codes={STATE_CODES} labels={pc.states} value={context.state ?? ''} optional onPick={(c) => setCtx({ state: c })} />
      {context.state === 'other' && <OtherText name="state_other" value={context.stateOther ?? ''} max={STATE_OTHER_MAX} placeholder={pc.stateOtherPlaceholder} onChange={(v) => setCtx({ stateOther: v })} />}

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

      {(purpose === 'celebrate' || purpose === 'other') && (
        <>
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
        </>
      )}

      {/* The box captures the scene or story the sender remembers most. The random question is only a HINT, small, under the headline. */}
      <label className="qHeadline" htmlFor="moment" data-testid="story-headline">
        {o.headline}
      </label>
      {question && (
        <>
          <p className="qHint" data-testid="story-hint-line">
            <span className="qHintLabel">{o.hintLabel}</span>
            <span data-testid="story-question" data-question-id={question.id}>
              {question.text}
            </span>
          </p>
          <button type="button" className="qSwitch" data-testid="question-switch" onClick={switchQuestion}>
            {o.switchQuestion}
          </button>
          <p className="qNote" data-testid="question-optional">
            {o.optionalNote}
          </p>
        </>
      )}
      <textarea
        id="moment"
        ref={taRef}
        data-testid="story-input"
        rows={6}
        value={story}
        onChange={(e) => {
          cursorRef.current = e.target.selectionStart ?? e.target.value.length
          onStoryChange(e.target.value)
        }}
        onSelect={(e) => {
          cursorRef.current = e.currentTarget.selectionStart ?? cursorRef.current
        }}
        aria-invalid={over || undefined}
        placeholder={o.answerHint}
      />
      <div className="cmeta">
        <span data-testid="story-hint">{copy.storyHint}</span>
        {n > 0 && !longEnough && <span data-testid="story-too-short">{o.tooShort}</span>}
        <span className={`cnt${over ? ' over' : ''}`} data-testid="story-counter" aria-live="off">
          {copy.storyCounter(n, STORY_MAX)}
        </span>
      </div>
      {over && (
        <p className="storyOver" role="alert" data-testid="story-over">
          {copy.storyOver}
        </p>
      )}

      {listening && (
        <p className="voiceInterim" data-testid="voice-interim" aria-hidden="true">
          {interim}
        </p>
      )}
      {speechSupported && (
        <div className="voiceRow">
          <button type="button" className={`btn ghost voice${listening ? ' on' : ''}`} data-testid="voice-button" onClick={toggleVoice} aria-pressed={listening}>
            <span className="dot" aria-hidden="true" />
            {listening ? copy.voiceListening : copy.voiceStart}
          </button>
          <select
            className="voiceLang"
            data-testid="voice-lang"
            aria-label="Speech language"
            value={voiceLang}
            disabled={listening}
            onChange={(e) => {
              const v = e.target.value
              if (isVoiceLang(v)) {
                voicePicked.current = true
                saveVoiceLang(v)
                setVoiceLang(v)
              }
            }}
          >
            {VOICE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <span className="sent" data-testid="voice-help">
        {o.voiceNone}
      </span>
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
