// The English bridge on a result (ticket 2026-11-12, Parts A and B). English only: for ja and zh nothing here runs.
//
// A US buyer cannot read a kanji, so each main (and, in remembrance, second) card carries, besides the character and its reading:
//   · a WORD with literary weight — fixed per kanji by the reviewed lexicon (en_word / en_echo / en_reviewed_by), else written by the model under the prompt's rule and logged (en_word_generated), else the plain palette meaning;
//   · a LINE of at most 14 words, written per story by the model and checked here against the story (the same story-truth rule as the card line);
//   · an ECHO from English literature — only from a reviewed row, never invented, never generated.
// The freestyle (遊び字) card is left exactly as it was.

import type { Candidate, EngineResult, Language } from './contract.ts'
import { inventedFacts } from './gaze.ts'
import { EN_WORD_SHAPE, enReviewed } from './lexicon-en.ts'
import { lexiconRowIn, rowShowsLine, type Lexicon, type LexiconRow } from './lexicon.ts'
import { classicalEchoOf, type Palette } from './palette.ts'
import { EN_LINE_MAX_WORDS, parseEcho, wordCount, type EnBridge } from '../src/order/en-bridge.ts'

// ---- the word ------------------------------------------------------------------------------------------------------------------------------------------
// The rule in the prompt: a word with literary weight (hearth, haven, keeper, steadfast, kindred, abide), never a plain word (light, warm, protect, honest); old and still spoken, never archaic.

/** Plain words the generated word may not be (the prompt's examples and their kin). */
export const PLAIN_WORDS: ReadonlySet<string> = new Set(
  ['light', 'warm', 'warmth', 'protect', 'protector', 'protection', 'honest', 'honesty', 'kind', 'kindness', 'strong', 'strength', 'happy', 'happiness', 'good', 'goodness', 'great', 'nice', 'love', 'loving', 'caring', 'care', 'brave', 'bravery', 'courage', 'support', 'supportive', 'help', 'helper', 'friend', 'family', 'special', 'amazing', 'wonderful', 'positive', 'hard-working', 'hardworking', 'reliable', 'dependable', 'patient', 'patience', 'peace', 'hope', 'dream'].map((w) => w.toLowerCase()),
)
/** Archaic or costume English. */
export const ARCHAIC_WORDS: ReadonlySet<string> = new Set(['thou', 'thee', 'thy', 'thine', 'hath', 'doth', 'verily', 'ere', 'betwixt', 'whence', 'hither', 'thither', 'forsooth', 'methinks', 'wherefore'])
/** Brand and self-help words. */
export const SELF_HELP_WORDS: ReadonlySet<string> = new Set(['journey', 'resilience', 'resilient', 'empower', 'empowered', 'empowerment', 'mindful', 'mindfulness', 'vibes', 'vibe', 'hustle', 'grind', 'synergy', 'authentic', 'authenticity'])

/** Why a word is not acceptable as a generated en_word, or null. */
export function wordProblem(word: string): string | null {
  const w = word.trim()
  if (!EN_WORD_SHAPE.test(w)) return 'shape'
  for (const part of w.toLowerCase().split(/[ -]/)) {
    if (PLAIN_WORDS.has(part)) return 'plain'
    if (ARCHAIC_WORDS.has(part)) return 'archaic'
    if (SELF_HELP_WORDS.has(part)) return 'self_help'
  }
  return null
}

/** The model's word, tidied (quotes, a closing full stop, case) — or null when it is not acceptable. */
export function cleanGeneratedWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const w = raw.trim().replace(/^["“'‘]+|["”'’.,;:!]+$/g, '').replace(/\s+/g, ' ').toLowerCase()
  return w && wordProblem(w) === null ? w : null
}

// ---- the line ------------------------------------------------------------------------------------------------------------------------------------------

/** Why a line is not acceptable, or null: one sentence, at most 14 words, English, no detail the story does not give. */
export function lineProblem(raw: unknown, story: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return 'empty'
  const line = raw.trim()
  if (/[　-鿿＀-￯]/.test(line)) return 'not_english'
  if (wordCount(line) > EN_LINE_MAX_WORDS) return 'too_long'
  if (/[.!?](?:["”’')\]]*)\s+\S/.test(line)) return 'not_one_sentence'
  if (line.includes('\n')) return 'not_one_sentence'
  if (inventedFacts(line, story, 'en').length > 0) return 'invented'
  return null
}

// ---- the lexicon rows of a candidate -------------------------------------------------------------------------------------------------------------------

const indexes = new WeakMap<Lexicon, Map<string, LexiconRow[]>>()
/** Every usable lexicon row by each form of its character (the lexicon's own, the Japanese palette's modern form and its inscription form). */
function indexOf(lexicon: Lexicon, palette: Palette): Map<string, LexiconRow[]> {
  const cached = indexes.get(lexicon)
  if (cached) return cached
  const map = new Map<string, LexiconRow[]>()
  const add = (form: string | null | undefined, row: LexiconRow) => {
    if (!form) return
    const list = map.get(form) ?? []
    if (!list.includes(row)) list.push(row)
    map.set(form, list)
  }
  for (const row of lexicon.rows) {
    if (row.excluded) continue
    add(row.kanji, row)
    const ja = lexiconRowIn(palette, 'ja', row.kanji)
    if (ja) {
      add(ja.kanji, row)
      add(ja.inscription_form, row)
    }
  }
  indexes.set(lexicon, map)
  return map
}

/** The reviewed English entry of a character: the first row with a reviewed word, else null. */
export function reviewedEntry(lexicon: Lexicon, palette: Palette, c: Pick<Candidate, 'kanji' | 'inscription_form'>): { word: string; echo: ReturnType<typeof parseEcho> } | null {
  const map = indexOf(lexicon, palette)
  const rows = [...(map.get(c.kanji) ?? []), ...(c.inscription_form ? map.get(c.inscription_form) ?? [] : [])]
  for (const r of rows) {
    if (enReviewed(r.raw.en_reviewed_by) && EN_WORD_SHAPE.test(r.raw.en_word)) return { word: r.raw.en_word.trim(), echo: parseEcho(r.raw.en_echo) }
  }
  return null
}

// ---- attaching it to a result --------------------------------------------------------------------------------------------------------------------------

export interface GeneratedWord {
  kanji: string
  word: string
  /** 'generated' = the model's word was used; 'meaning' = it was not acceptable and the plain palette meaning stands (reason in `problem`). */
  used: 'generated' | 'meaning'
  problem: string | null
}

/** The classical line of a card with its English rendering and English source, when the lexicon row that holds the line has them. Without them the line stays as it is (original script + its own source). */
export function withRendering(c: Candidate, lexicon: Lexicon | null, palette: Palette | null): Candidate['classical_echo'] {
  const echo = c.classical_echo
  if (!echo || !lexicon || !palette || echo.rendering) return echo
  const map = indexOf(lexicon, palette)
  const rows = [...(map.get(c.kanji) ?? []), ...(c.inscription_form ? map.get(c.inscription_form) ?? [] : [])]
  const row = rows.find((r) => r.raw.line_original === echo.text && r.raw.en_rendering.trim() !== '') ?? rows.find((r) => r.raw.en_rendering.trim() !== '' && echo.text.includes(r.raw.line_original.slice(0, 4)))
  return row ? { ...echo, rendering: row.raw.en_rendering.trim(), ...(row.raw.en_source.trim() ? { source_en: row.raw.en_source.trim() } : {}) } : echo
}

const isBridgeSlot = (c: Candidate): boolean => c.slot === 'main' || c.slot === 'second'

/** The bridge of one candidate: lexicon word and echo when reviewed, else the model's (valid) word, else the plain meaning; the line from the model if it passes, else the card's why_this. null for the freestyle. */
export function bridgeOf(c: Candidate, story: string, lexicon: Lexicon | null, palette: Palette | null, verifyClassical = false): { bridge: EnBridge | null; generated: GeneratedWord | null } {
  if (!isBridgeSlot(c)) return { bridge: null, generated: null }
  const reviewed = lexicon && palette ? reviewedEntry(lexicon, palette, c) : null
  let word: string | null = null
  let source: EnBridge['word_source'] = 'meaning'
  let generated: GeneratedWord | null = null
  if (reviewed) {
    word = reviewed.word
    source = 'lexicon'
  } else {
    const kept = c.en_word_source && typeof c.en_word === 'string' && c.en_word.trim() ? c.en_word.trim() : null // already settled by an earlier pass
    if (kept) {
      word = kept
      source = c.en_word_source as EnBridge['word_source']
    } else {
      const g = cleanGeneratedWord(c.en_word)
      if (g) {
        word = g
        source = 'generated'
        generated = { kanji: c.kanji, word: g, used: 'generated', problem: null }
      } else {
        const meaning = (c.meaning ?? '').trim()
        word = meaning || null
        source = 'meaning'
        generated = { kanji: c.kanji, word: typeof c.en_word === 'string' ? c.en_word.trim().slice(0, 40) : '', used: 'meaning', problem: typeof c.en_word === 'string' && c.en_word.trim() ? wordProblem(c.en_word.trim().toLowerCase()) ?? 'shape' : 'missing' }
      }
    }
  }
  if (!word) return { bridge: null, generated }
  const line = lineProblem(c.en_line, story) === null ? (c.en_line as string).trim() : (c.why_this ?? '').trim() || c.one_line_gaze.trim()
  const classical = verifyClassical ? knownClassical(c, lexicon, palette) : c.classical_echo ?? null
  return { bridge: { word, word_source: source, line, echo: reviewed?.echo ?? null, classical: classical ? withRendering({ ...c, classical_echo: classical }, lexicon, palette) ?? classical : null }, generated }
}

/**
 * Put the bridge on the main and second cards of an English result (a no-op for every other language). The model's `en_word` / `en_line` are consumed here: the freestyle keeps no such fields.
 * Pure: it can be applied to a partial result and again to the final one. Returns the words the model had to supply (for the log and the reviewer).
 */
export function attachEnBridge(result: EngineResult, story: string, lexicon: Lexicon | null, palette: Palette | null): { result: EngineResult; generated: GeneratedWord[] } {
  if ((result.language as Language) !== 'en' || !Array.isArray(result.candidates)) return { result, generated: [] }
  const generated: GeneratedWord[] = []
  const candidates = result.candidates.map((c) => {
    if (c.slot === 'freestyle') {
      if (c.en_word === undefined && c.en_line === undefined && c.en_echo === undefined && c.en_word_source === undefined) return c
      const { en_word: _w, en_line: _l, en_echo: _e, en_word_source: _s, ...rest } = c
      return rest as Candidate
    }
    if (c.eliminated) return c
    const { bridge, generated: g } = bridgeOf(c, story, lexicon, palette)
    if (g) generated.push(g)
    const classical = withRendering(c, lexicon, palette)
    if (!bridge) return { ...c, en_word: null, en_line: null, en_echo: null, classical_echo: classical }
    return { ...c, en_word: bridge.word, en_word_source: bridge.word_source, en_line: bridge.line, en_echo: bridge.echo, classical_echo: classical }
  })
  return { result: { ...result, candidates }, generated }
}

/** The classical line of a posted candidate, only if it is one the server itself would show: a reviewed palette line or a lexicon line that may be shown (human-reviewed, card_fit high). */
export function knownClassical(c: Candidate, lexicon: Lexicon | null, palette: Palette | null): NonNullable<Candidate['classical_echo']> | null {
  const posted = c.classical_echo
  if (!posted || !palette) return null
  for (const form of [c.kanji, c.inscription_form]) {
    if (!form) continue
    const known = classicalEchoOf(palette.lookup('ja', form))
    if (known && known.text === posted.text) return known
  }
  if (lexicon) {
    const map = indexOf(lexicon, palette)
    const rows = [...(map.get(c.kanji) ?? []), ...(c.inscription_form ? map.get(c.inscription_form) ?? [] : [])]
    const hit = rows.find((r) => rowShowsLine(r) && r.raw.line_original === posted.text)
    if (hit) return { text: hit.raw.line_original, source: hit.raw.source }
  }
  return null
}

/** The bridge a stored or posted candidate stands for (the order rebuilds it from the lexicon, never trusting the browser for the word, the echo or the classical line). */
export function bridgeForOrder(c: Candidate, story: string, lexicon: Lexicon | null, palette: Palette | null): EnBridge | null {
  return bridgeOf({ ...c, en_word_source: undefined }, story, lexicon, palette, true).bridge
}
