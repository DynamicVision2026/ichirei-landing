// The English bridge (ticket 2026-11-12, Part B): what an English buyer or receiver reads beside the character — shared by the server (certificate, gift view, film card) and the pages.
//
//   1. the character, large     2. the reading, italic (tomoshibi)     3. the word, bold (hearth)     4. the line (per story)     5. the echo, small, only when the lexicon row is reviewed
//
// The word and the echo are fixed per kanji (engine/lexicon.csv, reviewed once); the line is written per story. English only: ja and zh never read this module.

export interface EnEcho {
  text: string
  source: string
}

/** The classical line of the character (Japanese or Chinese source), shown only when the scholar has reviewed its row: the original, its English rendering and the source named in English when the lexicon has them. */
export interface EnClassical {
  text: string
  source: string
  rendering?: string
  source_en?: string
}

export interface EnBridge {
  /** One word (two at most) with literary weight; the lexicon's when the row is reviewed. */
  word: string
  /** Where the word comes from: the reviewed lexicon, the model's pick under the prompt's rule, or the plain palette meaning (last resort). */
  word_source: 'lexicon' | 'generated' | 'meaning'
  /** One plain sentence (at most 14 words) from this story. */
  line: string
  /** Reviewed rows only. */
  echo: EnEcho | null
  /** The classical line, when its row has been reviewed (it sits with the echo under "Where this word comes from"). */
  classical?: EnClassical | null
}

/** The heading under which the echo and the classical line sit together on the en pages. */
export const WHERE_THIS_WORD_COMES_FROM = 'Where this word comes from'

/** The line is at most this many words. */
export const EN_LINE_MAX_WORDS = 14

/** The sentence under the poem on the receiver page. */
export const poemWrittenFrom = (senderName: string | null | undefined): string => {
  const n = (senderName ?? '').trim()
  return n ? `Written from the story ${n} told about you.` : 'Written from a story told about you.'
}

/** `"Save the cricket on the hearth" — Milton, Il Penseroso` → { text, source }. null when it has no source (then no echo is shown). */
export function parseEcho(cell: string): EnEcho | null {
  const s = cell.trim()
  if (!s) return null
  const m = /^(.*\S)\s+[—–]\s+(\S.*)$/.exec(s)
  if (!m) return null
  const text = m[1].replace(/^["“”']+|["“”']+$/g, '').trim()
  const source = m[2].trim()
  return text && source ? { text, source } : null
}

/** The echo as printed: “text” — source (the source's work in the original, e.g. "Milton, Il Penseroso"). */
export const echoText = (e: EnEcho): string => `“${e.text}” — ${e.source}`

/** The source shortened to the author for small places (the film card, the certificate's narrow column): "Milton, Il Penseroso" → "Milton". */
export const echoAuthor = (e: EnEcho): string => e.source.split(',')[0].trim()

/** How many words a line has. */
export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

/** Two sentences are "the same" when they differ only in case, punctuation and spacing (the English card shows a line once: 2026-11-14). */
export const sameSentence = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const norm = (x: string | null | undefined) => (x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return norm(a) !== '' && norm(a) === norm(b)
}
