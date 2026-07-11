import { useReducedMotion } from 'framer-motion'

export default function AIProcessing() {
  const reduceMotion = useReducedMotion()

  return (
    <section
      id="ai-processing"
      className="relative flex min-h-screen w-full flex-col items-center justify-center gap-12 bg-[#120D09] px-6"
    >
      <svg
        width="140"
        height="140"
        viewBox="0 0 140 140"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="70"
          cy="70"
          r="54"
          stroke="#C9A96E"
          strokeOpacity="0.15"
          strokeWidth="1.5"
        />
        <circle
          cx="70"
          cy="70"
          r="54"
          stroke="#C9A96E"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="90 250"
          className={reduceMotion ? undefined : 'ink-loop-spin'}
        />
        <circle
          cx="70"
          cy="70"
          r="38"
          stroke="#C9A96E"
          strokeOpacity="0.35"
          strokeWidth="1"
          strokeLinecap="round"
          strokeDasharray="40 200"
          className={reduceMotion ? undefined : 'ink-loop-spin-reverse'}
        />
        <circle cx="70" cy="70" r="3" fill="#C9A96E" fillOpacity="0.8" />
      </svg>

      <p className="font-serif-jp text-lg tracking-wider text-ivory/80">
        言葉を読んでいます...
      </p>
    </section>
  )
}
