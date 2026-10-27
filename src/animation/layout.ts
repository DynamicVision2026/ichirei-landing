// Text fitting for the film's frame (pure, no DOM). The frame is 100 units wide and 177.8 tall (9:16); every size below is in those units.
// Text is estimated, not measured, so the final frame fits on any phone before a single glyph is drawn: a CJK character is one em wide, a Latin
// letter about half an em.

export const FRAME_W = 100
export const FRAME_H = 177.78

const CJK = /[぀-ヿ㐀-鿿豈-﫿＀-￯、-〿]/u

/** Estimated width of a string in em. */
export const emWidth = (s: string): number => [...s].reduce((w, c) => w + (CJK.test(c) ? 1 : c === ' ' ? 0.28 : 0.52), 0)

/** Lines a text wraps to in a box `width` units wide at font size `fs`. */
export function wrapCount(text: string, fs: number, width: number): number {
  if (!text) return 0
  return text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil((emWidth(part) * fs) / width)), 0)
}

export interface Block {
  text: string
  /** Size relative to the fitted size (the poem line is 1, an aid under it about .52). */
  size: number
  /** Space after the block, in units of the fitted size. */
  gap: number
}

/** The largest font size in [min, max] at which all blocks stacked fit in a box `width` × `height`; `min` when nothing does. */
export function fitFont(blocks: Block[], width: number, height: number, min: number, max: number, lineHeight = 1.45): number {
  const used = (fs: number) => blocks.reduce((h, b) => h + wrapCount(b.text, fs * b.size, width) * fs * b.size * lineHeight + b.gap * fs, 0)
  for (let fs = max; fs > min; fs = Math.round((fs - 0.1) * 10) / 10) if (used(fs) <= height) return fs
  return min
}

export interface PoemSizes {
  fs: number
  aid: number
  note: number
}

export const POEM_BOX = { top: 50, height: 90, width: 86 }

/** Sizes for the poem block: the lines, each aid under its line, the notes under all. */
export function poemSizes(lines: string[], lineAids: (string | null)[], notes: string[]): PoemSizes {
  const blocks: Block[] = []
  lines.forEach((l, i) => {
    blocks.push({ text: l, size: 1, gap: lineAids[i] ? 0.08 : 0.5 })
    if (lineAids[i]) blocks.push({ text: lineAids[i]!, size: 0.52, gap: 0.5 })
  })
  for (const n of notes) blocks.push({ text: n, size: 0.52, gap: 0.3 })
  const fs = fitFont(blocks, POEM_BOX.width, POEM_BOX.height, 3.2, 5.8)
  const small = Math.max(2.3, Math.round(fs * 0.52 * 10) / 10)
  return { fs, aid: small, note: small }
}

/** Size of the one-line story moment (it may wrap onto several lines). */
export function momentSize(text: string): number {
  return fitFont([{ text, size: 1, gap: 0 }], 80, 40, 3.6, 5.8)
}

/** Size of the "who they are" line. */
export function whoSize(text: string): number {
  return fitFont([{ text, size: 1, gap: 0 }], 84, 19, 3.2, 4.8)
}
