import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

// Elicitation UI (build spec §7): opening ask, voice-foregrounded input with
// graceful text fallback, five memory-angle chips that each open an aimed
// input box. The adaptive follow-up loop lives in DemoApp.

const OPENING_ASK = '六十年を、全部書かなくていい。その人らしい、小さなことを、ひとつだけ。'

const ANGLES = [
  'いつものクセ・口ぐせ',
  '助けてくれた、あの時',
  'つくったもの、直したもの',
  'その人といえば、この場所',
  '言わなかったけれど、してくれたこと',
]

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
}

export default function Elicitation({ story, onStoryChange, onSubmit, submitting }: Props) {
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
    rec.lang = 'ja-JP'
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
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="font-mincho mb-8 text-xl leading-relaxed text-ivory sm:text-2xl"
      >
        {OPENING_ASK}
      </motion.p>

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
            {listening ? '聞いています… タップで停止' : '声で話す'}
          </button>
        ) : (
          <span className="font-label text-xs text-ivory/40">
            このブラウザは音声入力に対応していません — 下に書いてください
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
        placeholder="たとえば——いつも同じ場所に座って、同じ湯のみでお茶を飲んでいた……"
        className="font-serif-jp w-full resize-none rounded-sm border border-gold/25 bg-paper/60 p-4 text-base leading-loose text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
      />

      {/* Five memory angles — each opens an aimed input box */}
      <p className="font-label mt-6 mb-2 text-[11px] tracking-[0.2em] text-gold/70">
        思い出の入り口
      </p>
      <div className="flex flex-wrap gap-2">
        {ANGLES.map((angle) => (
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
            placeholder="思い浮かんだことを、そのまま。"
            className="font-serif-jp w-full resize-none border-0 border-b border-gold/30 bg-transparent pb-2 text-base leading-relaxed text-ivory outline-none placeholder:text-ivory/25 focus:border-gold"
          />
          <button
            type="button"
            onClick={addAngleText}
            disabled={!angleText.trim()}
            className="font-label mt-3 rounded-full border border-gold/40 px-4 py-1.5 text-xs text-ivory transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-40"
          >
            物語に加える
          </button>
        </motion.div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !story.trim()}
        className="font-label mt-10 rounded-full bg-gold px-8 py-3.5 text-sm tracking-[0.1em] text-ink transition-all hover:shadow-[0_8px_30px_rgba(201,169,110,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        その一字を、探しにいく
      </button>
    </div>
  )
}
