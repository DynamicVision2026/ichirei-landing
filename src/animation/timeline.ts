// The timeline of the story animation — one fixed film, the same for every customer. Pure numbers (seconds), no DOM, so it is tested
// without a browser and the page only plays what this file says.
//
//   0 –  5 s   the story moment fades in as one line, then fades away
//   5 – 15 s   the character is written stroke by stroke (long strokes take longer)
//  15 – 25 s   the poem appears line by line, reading aids smaller beneath (the character moves up and shrinks to make room)
//  25 – 30 s   the "who they are" line, then the ICHIREI seal; then the frame holds still
//
// With no poem the character stays large and its reading fades in beneath it instead. Memorial: the same film, 25 % slower and quieter —
// the seal only fades in (no stamp), nothing is red.

export const FILM_SECONDS = 30
export const MEMORIAL_SLOWDOWN = 1.25

export interface Span {
  start: number
  end: number
}

export interface Timeline {
  /** Playing time in seconds, the hold frame included. */
  total: number
  memorial: boolean
  moment: { in: Span; out: Span }
  glyph: { write: Span; strokes: Span[]; settle: number }
  /** The character moving up and shrinking to make room for the poem; null without a poem. */
  glyphMove: Span | null
  /** The character's reading under it (only without a poem). */
  reading: Span | null
  poemLines: Span[]
  poemNotes: Span | null
  who: Span
  seal: Span
}

export interface TimelineInput {
  memorial: boolean
  /** Number of poem lines (0 = no poem). */
  poemLines: number
  /** There are notes (現代語訳 / English) under the poem. */
  poemNotes?: boolean
  /** Length of each stroke (any unit); null = no stroke data (the character fades in as ink instead). */
  strokeLengths: number[] | null
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function makeTimeline(input: TimelineInput): Timeline {
  const k = input.memorial ? MEMORIAL_SLOWDOWN : 1
  const at = (a: number, b: number): Span => ({ start: r3(a * k), end: r3(b * k) })

  // strokes share 5.4 – 14.4 s in proportion to their length (a short dot never takes as long as a long sweep), with a breath between
  const strokes: Span[] = []
  const lengths = input.strokeLengths && input.strokeLengths.length > 0 ? input.strokeLengths.map((l) => Math.max(Number.isFinite(l) ? l : 0, 1)) : null
  if (lengths) {
    // breath between strokes (less for a character with very many strokes), then the strokes share what is left in proportion to their length
    const gap = lengths.length > 1 ? Math.min(0.14, 1.5 / (lengths.length - 1)) : 0
    const span = 9 - gap * (lengths.length - 1)
    const sum = lengths.reduce((a, b) => a + b, 0)
    let durs = lengths.map((l) => Math.max((span * l) / sum, 0.18))
    const used = durs.reduce((a, b) => a + b, 0)
    if (used > span) durs = durs.map((d) => (d * span) / used) // many tiny strokes: never past the end of the writing window
    let t = 5.4
    durs.forEach((dur) => {
      strokes.push(at(t, t + dur))
      t += dur + gap
    })
  }
  const hasPoem = input.poemLines > 0
  const poemLines: Span[] = []
  if (hasPoem) {
    // 16.4 – 23.2 s: the lines are spread evenly; each takes 0.9 s to appear
    const n = input.poemLines
    const step = n > 1 ? (23.2 - 16.4 - 0.9) / (n - 1) : 0
    for (let i = 0; i < n; i++) poemLines.push(at(16.4 + i * step, 16.4 + i * step + 0.9))
  }
  return {
    total: r3(FILM_SECONDS * k),
    memorial: input.memorial,
    moment: { in: at(0.6, 2.6), out: at(4.0, 5.0) },
    glyph: { write: at(5.2, 14.6), strokes, settle: r3(15 * k) },
    glyphMove: hasPoem ? at(15, 16.4) : null,
    reading: hasPoem ? null : at(15.6, 17.4),
    poemLines,
    poemNotes: hasPoem && input.poemNotes ? at(23.4, 24.6) : null,
    who: at(25, 26.8),
    seal: at(27.4, 28.6),
  }
}

/** The film is in order and inside its length: for the tests, and a guard if the numbers are ever edited. */
export function timelineProblems(t: Timeline): string[] {
  const out: string[] = []
  const all: [string, Span][] = [['moment.in', t.moment.in], ['moment.out', t.moment.out], ['glyph.write', t.glyph.write], ['who', t.who], ['seal', t.seal]]
  if (t.glyphMove) all.push(['glyphMove', t.glyphMove])
  if (t.reading) all.push(['reading', t.reading])
  if (t.poemNotes) all.push(['poemNotes', t.poemNotes])
  t.glyph.strokes.forEach((s, i) => all.push([`stroke ${i + 1}`, s]))
  t.poemLines.forEach((s, i) => all.push([`poem line ${i + 1}`, s]))
  for (const [name, s] of all) {
    if (!(s.start >= 0 && s.end > s.start)) out.push(`${name}: bad span ${s.start}–${s.end}`)
    if (s.end > t.total) out.push(`${name}: ends after the film (${s.end} > ${t.total})`)
  }
  for (let i = 1; i < t.glyph.strokes.length; i++) if (t.glyph.strokes[i].start < t.glyph.strokes[i - 1].end) out.push(`stroke ${i + 1} starts before stroke ${i} ends`)
  for (let i = 1; i < t.poemLines.length; i++) if (t.poemLines[i].start <= t.poemLines[i - 1].start) out.push(`poem line ${i + 1} is not after line ${i}`)
  if (t.moment.out.start < t.moment.in.end) out.push('the moment fades out before it has faded in')
  if (t.glyph.strokes.length > 0 && t.glyph.strokes[0].start < t.moment.out.end) out.push('the first stroke starts before the moment has gone')
  if (t.glyph.strokes.length > 0 && t.glyph.strokes[t.glyph.strokes.length - 1].end > t.glyph.settle) out.push('the character is still being written when the poem starts')
  if (t.poemLines.length > 0 && t.glyphMove && t.poemLines[0].start < t.glyphMove.end) out.push('the poem starts before the character has moved aside')
  if (t.poemLines.length > 0 && t.poemLines[t.poemLines.length - 1].end > t.who.start) out.push('the poem is still appearing when the "who they are" line starts')
  if (t.seal.start < t.who.start) out.push('the seal comes before the "who they are" line')
  return out
}
