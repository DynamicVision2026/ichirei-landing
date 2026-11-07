// The e-card the film ends on (2026-11-07): a paper card that settles into the centre of the dark frame and carries the character, its reading, a short gold rule, the
// "who they are" line, the poem and a small seal. The page (CSS), the saved film and the share film all use THESE numbers, so the three look the same. Pure: no DOM, no fonts.
//
// All positions are fractions of the card (x: of its width, y: of its height); the card itself is 74% of the frame's width, portrait 5:8.

export const CARD_WIDTH = 0.74
export const CARD_ASPECT = 8 / 5 // height / width
/** The card is centred in the frame; the frame is 9:16, so the card's height as a fraction of the frame's height is CARD_WIDTH × 1.6 × (9 / 16). */
export const CARD_RADIUS_PX_1080 = 3
export const CARD_RISE_U = 1.1 // about 12 px at 1080 wide
export const CARD_PAPER: [string, string] = ['#EFE5CC', '#E6D9BB']
export const CARD_COLOURS = { ink: '#14110D', text: '#2A221B', cinnabar: '#C0392B', reading: '#7A6340', rule: '#B8995F', quote: '#7A6340' } as const

/** The poem is at least 4.4% of the frame's width (48 px at 1080) so it reads on a phone. */
export const POEM_MIN_U = 4.4
/** What the saved film draws (a little above the minimum, never below it). */
export const POEM_U = 4.5

export type CardVariant = 'film' | 'share'

export interface CardLayout {
  /** the character: centre y, font size as a fraction of the card's width */
  charY: number
  charSize: number
  readingY: number
  ruleY: number
  /** the "who they are" line (the film the buyer keeps only): top y */
  whoTop: number | null
  /** the relationship line (the share film only): centre y */
  relationY: number | null
  /** the poem's region: top y and the lowest y it may reach */
  poemTop: number
  poemBottom: number
  /** the seal in the bottom-right corner (the film the buyer keeps only): its box as a fraction of the card's width, and the margin */
  seal: { size: number; margin: number } | null
}

export const cardLayout = (variant: CardVariant): CardLayout =>
  variant === 'film'
    ? { charY: 0.205, charSize: 0.45, readingY: 0.385, ruleY: 0.425, whoTop: 0.455, relationY: null, poemTop: 0.595, poemBottom: 0.91, seal: { size: 0.09, margin: 0.055 } }
    : { charY: 0.27, charSize: 0.45, readingY: 0.445, ruleY: 0.487, whoTop: null, relationY: 0.085, poemTop: 0.575, poemBottom: 0.93, seal: null }

/** Poems set vertically (縦書き): 短歌 and 俳句 — one line per column, read right to left. The others (tang, ci, en) are horizontal and centred. */
export const isVerticalPoemType = (type: string | undefined | null): boolean => type === 'tanka' || type === 'haiku'
