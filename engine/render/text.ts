// Text as outlines: the story scroll is a picture, and the server has no system fonts, so every glyph is taken from our own font file with fontkit and
// drawn as an SVG path (sharp then needs no fonts at all). Also line breaking for CJK and Latin text.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Font = any

const NO_LINE_START = new Set(Array.from('、。，．・：；？！）」』】〕〉》ー々ゝゞ,.:;?!)]}'))
const NO_LINE_END = new Set(Array.from('（「『【〔〈《([{'))

export const isLatinWordChar = (c: string) => /[A-Za-z0-9'’-]/.test(c)

/** Advance width of a string in px at `size`. */
export function textWidth(font: Font, text: string, size: number): number {
  const run = font.layout(text)
  return (run.advanceWidth ?? run.positions.reduce((a: number, p: { xAdvance: number }) => a + p.xAdvance, 0)) * (size / font.unitsPerEm)
}

/** Break a text into lines no wider than `maxWidth` (CJK between any two characters, Latin at spaces); explicit newlines are kept. */
export function wrapText(font: Font, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const tokens: string[] = []
    let word = ''
    for (const ch of Array.from(para)) {
      if (isLatinWordChar(ch)) word += ch
      else {
        if (word) { tokens.push(word); word = '' }
        tokens.push(ch)
      }
    }
    if (word) tokens.push(word)
    let line = ''
    for (const tok of tokens) {
      const next = line + tok
      if (line && textWidth(font, next.trimEnd(), size) > maxWidth && !(NO_LINE_START.has(tok) && tok !== ' ')) {
        // never start a line with closing punctuation, never end one with an opening bracket
        const last = Array.from(line.trimEnd()).at(-1) ?? ''
        if (NO_LINE_END.has(last)) {
          const body = Array.from(line.trimEnd())
          body.pop()
          out.push(body.join('').trimEnd())
          line = last + tok
        } else {
          out.push(line.trimEnd())
          line = tok === ' ' ? '' : tok
        }
      } else line = next
    }
    out.push(line.trimEnd())
  }
  return out.filter((l, i, a) => l !== '' || (i > 0 && i < a.length - 1))
}

/** One line of text as SVG paths, `x` = centre (anchor 'middle') or left edge, `baseline` = y of the baseline. Returns the markup and the width. */
export function textPaths(font: Font, text: string, size: number, x: number, baseline: number, fill: string, anchor: 'middle' | 'start' = 'start', stroke = 0): { svg: string; width: number } {
  const run = font.layout(text)
  const scale = size / font.unitsPerEm
  const width = run.positions.reduce((a: number, p: { xAdvance: number }) => a + p.xAdvance, 0) * scale
  let pen = anchor === 'middle' ? x - width / 2 : x
  let svg = ''
  run.glyphs.forEach((g: { path: { toSVG(): string }; id: number }, i: number) => {
    const pos = run.positions[i]
    const d = g.path.toSVG()
    if (d) svg += `<path transform="translate(${(pen + pos.xOffset * scale).toFixed(2)} ${(baseline - pos.yOffset * scale).toFixed(2)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" d="${d}" fill="${fill}"${stroke ? ` stroke="${fill}" stroke-width="${(stroke / scale).toFixed(1)}" stroke-linejoin="round"` : ''}/>`
    pen += pos.xAdvance * scale
  })
  return { svg, width }
}
