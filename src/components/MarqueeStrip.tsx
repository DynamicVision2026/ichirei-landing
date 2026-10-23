import { useLanding } from '../landing/useLanding'

export default function MarqueeStrip() {
  const { copy } = useLanding()
  const run = copy.marquee.phrase.repeat(4)

  return (
    <section
      aria-label={copy.marquee.label}
      className="w-full overflow-hidden border-y border-gold/15 bg-[#150F0B] py-5"
    >
      <div className="marquee-track flex w-max whitespace-nowrap">
        <span className="font-mincho text-lg tracking-[0.3em] text-gold sm:text-xl">
          {run}
        </span>
        <span
          aria-hidden="true"
          className="font-mincho text-lg tracking-[0.3em] text-gold sm:text-xl"
        >
          {run}
        </span>
      </div>
    </section>
  )
}
