import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const CONTEXT_TAGS = [
  '続柄（親・配偶者・友人 など）',
  '転機となった出来事',
  '感謝していること',
  'これからの人生への願い',
]

function countWorkingDays(from: Date, to: Date): number {
  let count = 0
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1)
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

function calendarDaysUntil(to: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - today.getTime()) / 86_400_000)
}

type Props = {
  onSubmit: () => void
}

export default function StoryInput({ onSubmit }: Props) {
  const reduceMotion = useReducedMotion()
  const [story, setStory] = useState('')
  const [kanrekiDate, setKanrekiDate] = useState('')

  const dateNotice = useMemo(() => {
    if (!kanrekiDate) return null
    const date = new Date(`${kanrekiDate}T00:00:00`)
    if (Number.isNaN(date.getTime())) return null
    const workingDays = countWorkingDays(new Date(), date)
    if (workingDays >= 10 || workingDays < 0) return null
    return `還暦まで${calendarDaysUntil(date)}日です。特急仕上げ（3営業日）もご用意しています。`
  }, [kanrekiDate])

  return (
    <section
      id="story-input"
      className="relative w-full bg-ink px-6 py-32 sm:py-40"
    >
      <div className="mx-auto max-w-2xl">
        <motion.h2
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="font-mincho mb-14 text-2xl leading-relaxed text-ivory sm:text-3xl"
        >
          その人の六十年について、書いてください。
        </motion.h2>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ delay: 0.2, duration: 1 }}
        >
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={8}
            placeholder="たとえば——朝早く起きて、家族の誰よりも先に働きに出ていた。口数は少ないけれど、節目にはいつも隣にいてくれた……"
            className="font-serif-jp w-full resize-none border-0 border-b border-gold/30 bg-transparent pb-4 text-lg leading-loose text-ivory outline-none transition-colors placeholder:text-ivory/25 focus:border-gold"
          />

          <div className="mt-10 flex flex-wrap gap-3">
            {CONTEXT_TAGS.map((tag) => (
              <span
                key={tag}
                className="font-serif-jp rounded-full border border-ivory/20 px-4 py-1.5 text-sm text-ivory/70"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="mt-12">
            <label className="font-serif-jp flex flex-col gap-3 text-sm text-ivory/70">
              還暦の日
              <input
                type="date"
                value={kanrekiDate}
                onChange={(e) => setKanrekiDate(e.target.value)}
                className="font-label w-fit border-0 border-b border-gold/30 bg-transparent pb-2 text-base text-ivory outline-none transition-colors [color-scheme:dark] focus:border-gold"
              />
            </label>
            {dateNotice && (
              <p className="font-serif-jp mt-4 text-sm leading-relaxed text-gold">
                {dateNotice}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            className="font-label mt-16 rounded-full bg-gold px-8 py-3.5 text-sm tracking-[0.15em] text-ink shadow-[0_8px_30px_rgba(201,169,110,0.25)] transition-all hover:shadow-[0_8px_40px_rgba(201,169,110,0.4)] active:scale-[0.98]"
          >
            想いを書きはじめる
          </button>
        </motion.div>
      </div>
    </section>
  )
}
