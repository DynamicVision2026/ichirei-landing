// Plain words for the image model (2026-11-14, B8). A picture description that names a brand, a product or a written object ("orange slices in a Ziploc bag", a jersey with his number, a sign that
// says …) makes the image model draw letters — on every retry, because the name in the description wins over the "no text" line of the style. Before a description goes to the image model (and to the picture
// check, which judges the picture against it) the listed names are replaced by plain words (engine/film-plain-words.csv: lang, match (a regular expression), plain).
// ONLY the picture description is cleaned. The scene's caption keeps the sender's own words.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Rule {
  re: RegExp
  plain: string
}

let cached: Rule[] | null = null

function load(): Rule[] {
  if (cached) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  let text = ''
  for (const p of [process.env.ICHIREI_FILM_PLAIN_WORDS_PATH, join(here, 'film-plain-words.csv'), join(process.cwd(), 'engine', 'film-plain-words.csv')]) {
    if (!p) continue
    try {
      text = readFileSync(p, 'utf8')
      break
    } catch {
      // next
    }
  }
  const rules: Rule[] = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    // lang,match,plain — the match may itself contain commas inside brackets only in the sign rules, so split from both ends
    const first = line.indexOf(',')
    const last = line.lastIndexOf(',')
    if (first < 0 || last <= first) continue
    const match = line.slice(first + 1, last)
    const plain = line.slice(last + 1).trim()
    try {
      rules.push({ re: new RegExp(match, 'giu'), plain })
    } catch {
      // a bad row is skipped, never an error for the customer
    }
  }
  cached = rules
  return rules
}

/** The description as the image model gets it: brands, products and text-bearing objects replaced by plain words. Anything not listed is left exactly as it is. */
export function plainDescription(text: string): string {
  let out = text
  for (const r of load()) {
    r.re.lastIndex = 0
    out = out.replace(r.re, (m, ...rest) => {
      // keep a leading article that the match swallowed ("a Ziploc bag" → "a clear plastic bag", "a sign that says X" → "a sign seen from far away")
      const lead = /^(a|an|the|his|her|their) /i.exec(m)
      const plain = r.plain
      if (lead && !/^(a|an|the|his|her|their) /i.test(plain)) {
        const article = lead[1].toLowerCase() === 'a' && /^[aeiou]/i.test(plain) ? 'an' : lead[1]
        return `${article} ${plain}`
      }
      void rest
      return plain
    })
  }
  return out
}

/** True when the description still names something the list knows (used by the tests). */
export const hasListedName = (text: string): boolean => load().some((r) => ((r.re.lastIndex = 0), r.re.test(text)))
