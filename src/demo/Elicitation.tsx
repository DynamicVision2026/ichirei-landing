import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  COPY,
  DIRECTION_CODES,
  OCCASION_CODES,
  OCCASION_DETAIL_MAX,
  RELATIONSHIP_CODES,
  UI_LANGUAGES,
  contextComplete,
  isChineseUi,
  type Copy,
  type GiftContext,
} from './i18n'

// Elicitation UI (build spec §7, v5): language + the gift's context (relationship,
// direction, occasion, optional occasion_detail), then the opening ask, a voice-foregrounded
// input with graceful text fallback, and five memory-angle chips that each open an aimed
// input box. All copy comes from ./i18n (ja / zh-Hans / zh-Hant) and is occasion-neutral.
// The adaptive follow-up loop lives in DemoApp.

const SELECT_CLASS =
  'font-serif-jp w-full rounded-sm border border-gold/25 bg-paper/60 px-3 py-2.5 text-sm text-ivory outline-none transition-colors focus:border-gold'

// Minimal typing for the (prefixed) Web Speech API.
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
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

type Props = {
  story: string
  onStoryChange: (s: string) => void
  onSubmit: () => void
  submitting: boolean
  copy: Copy
  context: GiftContext
  onContextChange: (next: GiftContext) => void
  /** The language pills (the landing page has its own switch in the nav). */
  showLanguage?: boolean
  /** The traditional/simplified inscription toggle (customers choose on the order form instead). */
  showInscriptionScript?: boolean
}

export default function Elicitation({
  story,
  onStoryChange,
  onSubmit,
  submitting,
  copy,
  context,
  onContextChange,
  showLanguage = true,
  showInscriptionScript = true,
}: Props) {
  const setCtx = (patch: Partial<GiftContext>) => onContextChange({ ...context, ...patch })
  const ready = contextComplete(context) && story.trim() !== ''
  const [activeAngle, setActiveAngle] = useState<string | null>(null)
  const [angleText, setAngleText] = useState('')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechSupported = getSpeechRecognition() !== null

  // Keep a ref to the latest story so speech callbacks append to fresh state.
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
          const t = r[0].transcript.trim()
          if (t) {
            const base = storyRef.current
            onStoryChange(base ? `${base}${base.endsWith('。') ? '' : ''}${t}` : t)
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

  const addAngleText = () => {
    const t = angleText.trim()
    if (!t || !activeAngle) return
    const line = `【${activeAngle}】${t}`
    onStoryChange(story ? `${story}\n${line}` : line)
    setAngleText('')
    setActiveAngle(null)
  }

  return (
    <div>
      {/* Language: also the language of this UI and of the engine's output text */}
      {showLanguage && (
      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label={copy.languageLabel}>
        <span className="font-label mr-1 text-[10px] tracking-wide text-ivory/40">{copy.languageLabel}</span>
        {UI_LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            data-language={l}
            aria-pressed={context.language === l}
            onClick={() => setCtx({ language: l })}
            className={`font-serif-jp rounded-full border px-4 py-1.5 text-sm transition-colors ${
              context.language === l
                ? 'border-gold bg-gold text-ink'
                : 'border-ivory/20 text-ivory/70 hover:border-ivory/50'
            }`}
          >
            {COPY[l].languageName}
          </button>
        ))}
      </div>
      )}

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="font-mincho mb-8 text-xl leading-relaxed text-ivory sm:text-2xl"
      >
        {copy.openingAsk}
      </motion.p>

      {/* The gift's context: relationship, direction, occasion (+ optional detail) */}
      <fieldset className="mb-8 rounded-sm border border-gold/20 bg-paper/30 p-4">
        <legend className="font-label px-2 text-[11px] tracking-[0.2em] text-gold/70">
          {copy.contextHeading}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.relationshipLabel}</span>
            <select
              name="relationship"
              value={context.relationship}
              onChange={(e) => setCtx({ relationship: e.target.value as GiftContext['relationship'] })}
              className={SELECT_CLASS}
            >
              <option value="">{copy.choose}</option>
              {RELATIONSHIP_CODES.map((c) => (
                <option key={c} value={c}>
                  {copy.relationships[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.directionLabel}</span>
            <select
              name="direction"
              value={context.direction}
              onChange={(e) => setCtx({ direction: e.target.value as GiftContext['direction'] })}
              className={SELECT_CLASS}
            >
              <option value="">{copy.choose}</option>
              {DIRECTION_CODES.map((c) => (
                <option key={c} value={c}>
                  {copy.directions[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.occasionLabel}</span>
            <select
              name="occasion"
              value={context.occasion}
              onChange={(e) => setCtx({ occasion: e.target.value as GiftContext['occasion'] })}
              className={SELECT_CLASS}
            >
              <option value="">{copy.choose}</option>
              {OCCASION_CODES.map((c) => (
                <option key={c} value={c}>
                  {copy.occasions[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.occasionDetailLabel}</span>
            <input
              name="occasion_detail"
              type="text"
              value={context.occasionDetail}
              maxLength={OCCASION_DETAIL_MAX}
              onChange={(e) => setCtx({ occasionDetail: e.target.value })}
              placeholder={copy.occasionDetailPlaceholder}
              className={`${SELECT_CLASS} placeholder:text-ivory/25`}
            />
          </label>
        </div>
        {showInscriptionScript && isChineseUi(context.language) && (
          <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={copy.inscriptionScriptLabel}>
            <span className="font-label mr-1 text-[11px] text-ivory/60">{copy.inscriptionScriptLabel}</span>
            {(['traditional', 'simplified'] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                data-inscription-script={sc}
                aria-pressed={context.inscriptionScript === sc}
                onClick={() => setCtx({ inscriptionScript: sc })}
                className={`font-serif-jp rounded-full border px-3 py-1 text-xs transition-colors ${
                  context.inscriptionScript === sc
                    ? 'border-gold bg-gold/15 text-ivory'
                    : 'border-ivory/20 text-ivory/60 hover:border-ivory/50'
                }`}
              >
                {copy.inscriptionScripts[sc]}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      {/* Voice foregrounded; text always available beneath */}
      <div className="mb-4 flex items-center gap-3">
        {speechSupported ? (
          <button
            type="button"
            onClick={toggleVoice}
            className={`font-label flex items-center gap-2 rounded-full px-5 py-2.5 text-sm transition-colors ${
              listening
                ? 'bg-cinnabar text-ivory'
                : 'bg-gold text-ink hover:shadow-[0_6px_24px_rgba(201,169,110,0.3)]'
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                listening ? 'animate-pulse bg-ivory' : 'bg-ink/60'
              }`}
            />
            {listening ? copy.voiceListening : copy.voiceStart}
          </button>
        ) : (
          <span className="font-label text-xs text-ivory/40">
            {copy.voiceUnsupported}
          </span>
        )}
        {interim && (
          <span className="font-serif-jp text-sm text-ivory/50">{interim}…</span>
        )}
      </div>

      <textarea
        value={story}
        onChange={(e) => onStoryChange(e.target.value)}
        rows={7}
        placeholder={copy.storyPlaceholder}
        className="font-serif-jp w-full resize-none rounded-sm border border-gold/25 bg-paper/60 p-4 text-base leading-loose text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
      />

      {/* Five memory angles — each opens an aimed input box */}
      <p className="font-label mt-6 mb-2 text-[11px] tracking-[0.2em] text-gold/70">
        {copy.anglesHeading}
      </p>
      <div className="flex flex-wrap gap-2">
        {copy.angles.map((angle) => (
          <button
            key={angle}
            type="button"
            onClick={() => setActiveAngle(activeAngle === angle ? null : angle)}
            className={`font-serif-jp rounded-full border px-4 py-1.5 text-sm transition-colors ${
              activeAngle === angle
                ? 'border-gold bg-gold/15 text-ivory'
                : 'border-ivory/20 text-ivory/70 hover:border-ivory/50'
            }`}
          >
            {angle}
          </button>
        ))}
      </div>

      {activeAngle && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-4 rounded-sm border border-gold/20 bg-paper/40 p-4"
        >
          <p className="font-serif-jp mb-2 text-sm text-gold">{activeAngle}</p>
          <textarea
            value={angleText}
            onChange={(e) => setAngleText(e.target.value)}
            rows={3}
            placeholder={copy.anglePlaceholder}
            className="font-serif-jp w-full resize-none border-0 border-b border-gold/30 bg-transparent pb-2 text-base leading-relaxed text-ivory outline-none placeholder:text-ivory/25 focus:border-gold"
          />
          <button
            type="button"
            onClick={addAngleText}
            disabled={!angleText.trim()}
            className="font-label mt-3 rounded-full border border-gold/40 px-4 py-1.5 text-xs text-ivory transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-40"
          >
            {copy.angleAdd}
          </button>
        </motion.div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !ready}
        className="font-label mt-10 rounded-full bg-gold px-8 py-3.5 text-sm tracking-[0.1em] text-ink transition-all hover:shadow-[0_8px_30px_rgba(201,169,110,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {copy.submit}
      </button>
      {!contextComplete(context) && (
        <p className="font-label mt-3 text-[11px] text-ivory/40">{copy.contextMissing}</p>
      )}
    </div>
  )
}
