// The story film's timeline and the maths of every frame (pure, no DOM): the page only applies what this file computes, and the tests check it
// without a browser. One fixed template for everyone:
//
//   0–5 s      scene 1: a picture (slow push-in) and line 1, phrase by phrase        } four scenes, 5 s each, an 0.8 s cross-fade between them
//   5–10 s     scene 2     10–15 s  scene 3     15–20 s  scene 4
//   20–27 s    the chosen character, revealed in ink (cinnabar; ink black for a remembrance); its reading appears beneath it
//   27–30 s    the "who they are" line, then the ICHIREI seal; then the last frame holds
//
// A remembrance film is slower and quieter: 5.5 s per scene, 37.5 s in all, the seal only fades in. The fallback script has two scenes (the "your
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
  final: { fadeIn: Span; reveal: Span; reading: Span; who: Span; seal: Span }
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
  const final = memorial
    ? { fadeIn: span(0.2, 1.0), reveal: span(0.8, 4.6), reading: span(5.6, 1.4), who: span(8.4, 1.8), seal: span(11.2, 1.6) }
    : { fadeIn: span(0.2, 0.8), reveal: span(0.6, 3.6), reading: span(4.4, 1.2), who: span(6.6, 1.4), seal: span(8.3, 1.0) }
  return { total: r3(F + (memorial ? 15.5 : 10)), memorial, scenes, final, phraseAt: (scene, phrase) => r3(scenes[scene].start + 0.9 + 0.9 * phrase) }
}

/** The phrases of a line (one line break at most): each fades in on its own. */
export const phrases = (line: string): string[] => line.split('\n').map((p) => p.trim()).filter(Boolean)

export interface FrameState {
  scenes: { opacity: number; progress: number; phrases: number[] }[]
  final: { opacity: number; reveal: number; reading: number; who: number; seal: number }
  progress: number
}

/** Everything the film shows at time t (seconds). `lines` are the four (or two) script lines. */
export function frameAt(t: number, tl: FilmTimeline, lines: string[]): FrameState {
  const f = tl.final
  const fade = (s: Span) => ease(clamp((t - s.start) / (s.end - s.start)))
  return {
    scenes: tl.scenes.map((s, i) => ({
      opacity: clamp((t - s.start) / 0.8) * clamp((s.end - t) / 0.8),
      progress: clamp((t - s.start) / (s.end - s.start)),
      phrases: phrases(lines[i] ?? '').map((_, j) => ease(clamp((t - tl.phraseAt(i, j)) / 0.9))),
    })),
    final: { opacity: clamp((t - f.fadeIn.start) / (f.fadeIn.end - f.fadeIn.start)), reveal: fade(f.reveal), reading: fade(f.reading), who: fade(f.who), seal: fade(f.seal) },
    progress: clamp(t / tl.total),
  }
}

/** Problems of a timeline (for the tests and as a guard if the numbers are edited): order, overlap, the ticket's 30 s / 37.5 s. */
export function filmTimelineProblems(tl: FilmTimeline): string[] {
  const out: string[] = []
  tl.scenes.forEach((s, i) => {
    if (!(s.end > s.start)) out.push(`scene ${i + 1}: bad span`)
    if (i > 0 && s.start >= tl.scenes[i - 1].end) out.push(`scene ${i + 1} starts after scene ${i} has ended (no cross-fade)`)
    if (i > 0 && s.start < tl.scenes[i - 1].end - 0.45) out.push(`scene ${i + 1} overlaps scene ${i} by more than the cross-fade`)
  })
  const f = tl.final
  const order: [string, Span][] = [['fadeIn', f.fadeIn], ['reveal', f.reveal], ['reading', f.reading], ['who', f.who], ['seal', f.seal]]
  for (const [name, s] of order) if (!(s.end > s.start) || s.end > tl.total) out.push(`final.${name}: outside the film`)
  if (f.fadeIn.start < tl.scenes[tl.scenes.length - 1].end - 0.45) out.push('the character starts before the last scene is leaving')
  if (!(f.reveal.start <= f.reading.start && f.reading.start < f.who.start && f.who.start < f.seal.start)) out.push('the final parts are out of order')
  return out
}
