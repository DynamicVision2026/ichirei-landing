import { useEffect, useRef, useState } from 'react'
import {
  DIRECTION_CODES,
  OCCASION_CODES,
  OCCASION_DETAIL_MAX,
  RELATIONSHIP_CODES,
  STORY_MAX,
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
}

export default function Composer({ story, onStoryChange, onSubmit, copy, lang, context, onContextChange }: Props) {
  const t = TEXT[lang]
  const setCtx = (patch: Partial<GiftContext>) => onContextChange({ ...context, ...patch })
  const ready = contextComplete(context) && story.trim() !== ''
  const n = storyLength(story)
  // Remembrance: the wording stops speaking of gifts (the person has died; the character is kept, not given).
  const memorial = context.occasion === 'memorial'

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechSupported = getSpeechRecognition() !== null
  const storyRef = useRef(story)
  storyRef.current = story
  useEffect(() => () => recognitionRef.current?.stop(), [])

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const Ctor = getSpeechRecognition()
    if (!Ctor) return
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
          if (text) onStoryChange(clipStory(storyRef.current ? `${storyRef.current}${text}` : text))
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

      <label className="clab" htmlFor="moment">
        {t.cMom}
      </label>
      <textarea
        id="moment"
        data-testid="story-input"
        rows={6}
        value={story}
        maxLength={STORY_MAX}
        onChange={(e) => onStoryChange(clipStory(e.target.value))}
        placeholder={copy.storyPlaceholder}
      />
      <div className="cmeta">
        <span data-testid="story-hint">{copy.storyHint}</span>
        <span className="cnt" data-testid="story-counter" aria-live="off">
          {copy.storyCounter(n, STORY_MAX)}
        </span>
      </div>

      {speechSupported && (
        <button type="button" className={`btn ghost voice${listening ? ' on' : ''}`} onClick={toggleVoice} aria-pressed={listening}>
          <span className="dot" aria-hidden="true" />
          {listening ? copy.voiceListening : copy.voiceStart}
        </button>
      )}
      {interim && <span className="sent">{interim}…</span>}

      <button type="submit" className="btn primary" disabled={!ready}>
        {t.cGo}
      </button>
      {!contextComplete(context) && <p className="sent">{copy.contextMissing}</p>}
    </form>
  )
}
