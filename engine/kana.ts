// The gift character inside a film caption, in kana (2026-11-03). A caption (a film line) may not show the gift character before the reveal; when the story's own words carry it (「待ってた」,
// 「野良猫」) the WORD that holds it is replaced by its hiragana reading, taken from a morphological analyser with readings (kuromoji, IPADIC) — never a single character by its standalone reading
// (that gave 「野良びょう」 for 野良猫). Only the gift character triggers a replacement; every other character stays as written. If the analyser is not loaded, a token has no reading, or the text
// cannot be matched back to its tokens, the answer is null: no reliable reading, the caption is left empty by the caller (the film still shows its picture).
//
//   待ってた → まってた   期待 → きたい   野良猫 (gift 猫) → のらねこ   野良猫 (gift 待) → unchanged

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface Token {
  surface_form: string
  reading?: string
  pos: string
  word_type?: string
}
export interface Tokenizer {
  tokenize(text: string): Token[]
}

const IDEOGRAPH = /[㐀-䶿一-鿿豈-﫿]/u
const KANA_ONLY = /^[ぁ-ゖー]+$/u
const toHiragana = (t: string): string => t.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

let loaded: Tokenizer | null = null
let loading: Promise<Tokenizer | null> | null = null

function dictPath(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const dir = join(dirname(require.resolve('kuromoji/package.json')), 'dict')
    return existsSync(dir) ? dir : null
  } catch {
    return null
  }
}

/** Load the analyser once (about a second, the dictionary stays in memory). Never rejects: null when it cannot be had. */
export function loadTokenizer(): Promise<Tokenizer | null> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= (async () => {
    try {
      const dic = dictPath()
      if (!dic) return null
      const require = createRequire(import.meta.url)
      const kuromoji = require('kuromoji') as { builder(o: { dicPath: string }): { build(cb: (err: Error | null, t: Tokenizer) => void): void } }
      loaded = await new Promise<Tokenizer | null>((resolve) => kuromoji.builder({ dicPath: dic }).build((err, t) => resolve(err ? null : t)))
      return loaded
    } catch {
      return null
    }
  })()
  return loading
}

/** The analyser if it has been loaded (the checks are synchronous; makeFilm loads it first). */
export const tokenizerIfLoaded = (): Tokenizer | null => loaded

const nounish = (t: Token): boolean => t.pos === '名詞' || t.pos === '接頭詞'

/**
 * Replace the WORD that holds a gift character by its hiragana. `gift` are the forms of the gift character only. Returns the text unchanged when it holds none of them, the new text, or null when
 * no reliable reading exists.
 */
export function kanaFixWords(text: string, gift: string[], tok: Tokenizer | null = loaded): string | null {
  const forms = gift.filter((f) => [...f].length === 1)
  if (!forms.some((f) => text.includes(f))) return text
  if (!tok) return null
  let tokens: Token[]
  try {
    tokens = tok.tokenize(text)
  } catch {
    return null
  }
  if (tokens.map((t) => t.surface_form).join('') !== text) return null // the analyser did not keep the text as it was: not reliable
  const hits = tokens.map((t, k) => (forms.some((f) => t.surface_form.includes(f)) ? k : -1)).filter((k) => k >= 0)
  const spans: { from: number; to: number }[] = []
  for (const k of hits) {
    let from = k
    let to = k
    // a compound noun is ONE word (野良猫 may be 野良 + 猫): the nouns next to the gift noun that carry kanji belong to it
    if (nounish(tokens[k])) {
      while (from > 0 && nounish(tokens[from - 1]) && IDEOGRAPH.test(tokens[from - 1].surface_form)) from--
      while (to + 1 < tokens.length && nounish(tokens[to + 1]) && IDEOGRAPH.test(tokens[to + 1].surface_form)) to++
    }
    const last = spans.at(-1)
    if (last && from <= last.to) last.to = Math.max(last.to, to)
    else spans.push({ from, to })
  }
  const offsets: number[] = []
  let at = 0
  for (const t of tokens) {
    offsets.push(at)
    at += t.surface_form.length
  }
  let out = text
  for (const sp of [...spans].reverse()) {
    let kana = ''
    for (let k = sp.from; k <= sp.to; k++) {
      const t = tokens[k]
      // a token with kanji needs a real reading; a token without (kana, punctuation) is kept as written
      if (!IDEOGRAPH.test(t.surface_form)) {
        kana += t.surface_form
        continue
      }
      if (t.word_type && t.word_type !== 'KNOWN') return null
      const r = t.reading && t.reading !== '*' ? toHiragana(t.reading) : ''
      if (!r || !KANA_ONLY.test(r)) return null
      kana += r
    }
    const start = offsets[sp.from]
    const end = offsets[sp.to] + tokens[sp.to].surface_form.length
    out = out.slice(0, start) + kana + out.slice(end)
  }
  return out
}
