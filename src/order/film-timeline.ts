// The story film's timeline and the maths of every frame (pure, no DOM): the page only applies what this file computes, and the tests check it
// without a browser. One fixed template for everyone (2026-11-07: the film ends on an e-card):
//
//   0–5 s      scene 1: a picture (slow push-in) and line 1, phrase by phrase        } four scenes, 5 s each, an 0.8 s cross-fade between them
//   5–10 s     scene 2     10–15 s  scene 3     15–20 s  scene 4
//   20–23.4 s  the chosen character, revealed in ink on the dark frame (cinnabar; ink black for a remembrance); its reading appears beneath it
//   23.6 s     the dark character leaves and a paper card settles into the centre (0.8 s fade and a 12 px rise, then still)
//   24–29 s    on the card: the reading, a short gold rule, the "who they are" line, the poem line by line, the seal
//   29–33 s    the finished card holds still (4 s), then the last second fades to black — 34 s in all
//
// A remembrance film is slower and quieter: 5.5 s per scene, 41 s in all (the card is the same, in ink, without red). The fallback script has two scenes (the "your
// moment" line and the "who they are" line), so its film is 10 s shorter in the scene part. The numbers follow the hand-made reference film.

export interface Span {
  start: number
  end: number
}

export interface FilmTimeline {
  total: number
  memorial: boolean
  /** One span per scene (neighbouring spans overlap by 0.4 s: that is the cross-fade). */
  scenes: Span[]
  /** The dark character section (`fadeIn`, `reveal`, `reading`) ends when `darkOut` fades it; then the card: `card` (fade and rise), and on it `cardReading`, `rule`, `who`, `poem` (lines one after another), `seal`; `fadeOut` is the last second. */
  final: { fadeIn: Span; reveal: Span; reading: Span; darkOut: Span; card: Span; cardReading: Span; rule: Span; who: Span; poem: Span; seal: Span; fadeOut: Span }
  /** When a phrase of a scene's line appears (start of its 0.9 s fade). */
  phraseAt: (scene: number, phrase: number) => number
}

export const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, x))
export const ease = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function makeFilmTimeline(sceneCount: number, memorial: boolean): FilmTimeline {
  const per = memorial ? 5.5 : 5
  const n = Math.max(1, Math.min(4, Math.round(sceneCount)))
  const F = per * n // where the scenes end and the character begins
  const scenes: Span[] = Array.from({ length: n }, (_, i) => ({ start: r3(per * i), end: r3(per * i + per + 0.4) }))
  const span = (a: number, d: number): Span => ({ start: r3(F + a), end: r3(F + a + d) })
  const total = r3(F + (memorial ? 19 : 14))
  const final = memorial
    ? { fadeIn: span(0.2, 1.0), reveal: span(0.8, 3.0), reading: span(3.2, 1.2), darkOut: span(4.8, 0.8), card: span(5.2, 1.0), cardReading: span(6.2, 1.0), rule: span(7.2, 0.7), who: span(7.6, 1.2), poem: span(8.8, 4.0), seal: span(12.8, 1.2), fadeOut: { start: r3(total - 1), end: total } }
    : { fadeIn: span(0.2, 0.8), reveal: span(0.6, 2.2), reading: span(2.2, 0.9), darkOut: span(3.4, 0.6), card: span(3.6, 0.8), cardReading: span(4.1, 0.7), rule: span(4.6, 0.5), who: span(4.8, 0.8), poem: span(5.4, 3.0), seal: span(8.4, 0.6), fadeOut: { start: r3(total - 1), end: total } }
  return { total, memorial, scenes, final, phraseAt: (scene, phrase) => r3(scenes[scene].start + 0.9 + 0.9 * phrase) }
}

/** The phrases of a line (one line break at most): each fades in on its own. */
export const phrases = (line: string): string[] => line.split('\n').map((p) => p.trim()).filter(Boolean)

export interface FrameState {
  scenes: { opacity: number; progress: number; phrases: number[] }[]
  /** the dark character section */
  final: { opacity: number; reveal: number; reading: number }
  /** the e-card: `opacity` and `rise` (0 → 1, 1 = settled), then what is on it; `poem` is one number per line; `black` is the fade to black at the very end */
  card: { opacity: number; rise: number; reading: number; rule: number; who: number; poem: number[]; seal: number }
  black: number
  /** a quiet film's light frame turns to the dark ink frame as the card comes (0 → 1) */
  frameDark: number
  progress: number
}

/** Everything the film shows at time t (seconds). `lines` are the four (or two) script lines. */
export function frameAt(t: number, tl: FilmTimeline, lines: string[], poemLines = 0): FrameState {
  const f = tl.final
  const fade = (s: Span) => ease(clamp((t - s.start) / (s.end - s.start)))
  const poemSpan = f.poem.end - f.poem.start
  const lineFade = Math.min(0.8, poemSpan)
  const lineStep = poemLines > 1 ? (poemSpan - lineFade) / (poemLines - 1) : 0
  return {
    scenes: tl.scenes.map((s, i) => ({
      opacity: clamp((t - s.start) / 0.8) * clamp((s.end - t) / 0.8),
      progress: clamp((t - s.start) / (s.end - s.start)),
      phrases: phrases(lines[i] ?? '').map((_, j) => ease(clamp((t - tl.phraseAt(i, j)) / 0.9))),
    })),
    final: { opacity: clamp((t - f.fadeIn.start) / (f.fadeIn.end - f.fadeIn.start)) * (1 - fade(f.darkOut)), reveal: fade(f.reveal), reading: fade(f.reading) },
    card: {
      opacity: fade(f.card),
      rise: fade(f.card),
      reading: fade(f.cardReading),
      rule: fade(f.rule),
      who: fade(f.who),
      poem: Array.from({ length: poemLines }, (_, i) => ease(clamp((t - (f.poem.start + i * lineStep)) / lineFade))),
      seal: fade(f.seal),
    },
    black: clamp((t - f.fadeOut.start) / (f.fadeOut.end - f.fadeOut.start)),
    frameDark: fade(f.darkOut),
    progress: clamp(t / tl.total),
  }
}

/** Problems of a timeline (for the tests and as a guard if the numbers are edited): order, overlap, the ticket's 34 s / 41 s and the card's 4 s hold. */
export function filmTimelineProblems(tl: FilmTimeline): string[] {
  const out: string[] = []
  tl.scenes.forEach((s, i) => {
    if (!(s.end > s.start)) out.push(`scene ${i + 1}: bad span`)
    if (i > 0 && s.start >= tl.scenes[i - 1].end) out.push(`scene ${i + 1} starts after scene ${i} has ended (no cross-fade)`)
    if (i > 0 && s.start < tl.scenes[i - 1].end - 0.45) out.push(`scene ${i + 1} overlaps scene ${i} by more than the cross-fade`)
  })
  const f = tl.final
  const order: [string, Span][] = [['fadeIn', f.fadeIn], ['reveal', f.reveal], ['reading', f.reading], ['darkOut', f.darkOut], ['card', f.card], ['cardReading', f.cardReading], ['rule', f.rule], ['who', f.who], ['poem', f.poem], ['seal', f.seal], ['fadeOut', f.fadeOut]]
  for (const [name, s] of order) if (!(s.end > s.start) || s.end > tl.total + 1e-6) out.push(`final.${name}: outside the film`)
  if (f.fadeIn.start < tl.scenes[tl.scenes.length - 1].end - 0.45) out.push('the character starts before the last scene is leaving')
  if (!(f.reveal.start <= f.reading.start && f.reading.start < f.darkOut.start && f.card.start >= f.darkOut.start - 0.3)) out.push('the dark character section and the card are out of order')
  if (!(f.card.start < f.cardReading.start && f.cardReading.start < f.rule.start && f.rule.start <= f.who.start && f.who.start < f.poem.start && f.poem.end <= f.seal.start + 1e-6)) out.push('the card\'s parts are out of order')
  const done = Math.max(f.seal.end, f.poem.end)
  if (tl.total - done < 4 - 1e-6) out.push(`the finished card holds only ${Math.round((tl.total - done) * 10) / 10} s before the end (4 s at least)`)
  if (Math.abs(f.fadeOut.end - f.fadeOut.start - 1) > 1e-6 || Math.abs(f.fadeOut.end - tl.total) > 1e-6) out.push('the fade to black is not the last second')
  return out
}
