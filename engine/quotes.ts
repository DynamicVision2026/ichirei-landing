// Exact quotes (Ticket 9, item 7, 2026-11-26). A title, a name or a quoted phrase of the sender's moment is copied EXACTLY into what the gift says: the engine once wrote "KEEPING SWINGING" for the
// sender's "KEEP SWINGING". English only — nothing here runs for ja or zh.
//
// The protected phrases of a moment: what is in quotation marks, a run of capital letters (a title, a slogan), and a run of two or more Capitalized words (a name, a title). A text is "altered" when it
// holds something that is a near copy of a protected phrase but not the phrase itself (the letters differ; a change of case alone is not a change). Exact copies, and texts that do not echo the phrase
// at all, pass. The check is for the card's line, the receiver's line, the English line and the film's lines; each gets ONE rewrite where one exists.

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (s: string): string[] => norm(s).split(' ').filter(Boolean)

/** The phrases of a moment that must be copied exactly (each at least 6 letters long, at least one word of 3 letters). */
export function protectedPhrases(story: string): string[] {
  const out = new Set<string>()
  const add = (p: string) => {
    const t = p.trim().replace(/^[\s"'“”‘’(]+|[\s"'“”‘’).,;:!?]+$/g, '')
    if (t.replace(/[^A-Za-z]/g, '').length >= 6 && words(t).some((w) => w.length >= 3)) out.add(t)
  }
  for (const m of story.matchAll(/[“"]([^“”"\n]{3,80})[”"]/g)) add(m[1])
  for (const m of story.matchAll(/[‘']([^‘’'\n]{6,80})[’'](?![a-z])/g)) add(m[1])
  for (const m of story.matchAll(/\b[A-Z][A-Z0-9'’&-]{1,}(?:\s+[A-Z][A-Z0-9'’&-]{1,}){0,6}\b/g)) add(m[0])
  for (const m of story.matchAll(/\b[A-Z][a-z]+(?:['’][a-z]+)?(?:\s+(?:of|the|and|&)\s+|\s+)[A-Z][a-z]+(?:['’][a-z]+)?(?:\s+[A-Z][a-z]+)*\b/g)) add(m[0])
  return [...out]
}

function distance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

/** The first protected phrase that `text` echoes with different letters ("KEEPING SWINGING" for "KEEP SWINGING"), or null. A phrase the text copies exactly is fine. */
export function alteredQuote(text: string, story: string): { phrase: string; found: string } | null {
  const t = words(text)
  if (t.length === 0) return null
  for (const phrase of protectedPhrases(story)) {
    const p = words(phrase)
    if (p.length === 0) continue
    const want = p.join(' ')
    const near = Math.max(2, Math.floor(want.length * 0.25))
    let exact = false
    let altered: string | null = null
    for (const size of new Set([p.length, p.length + 1, Math.max(1, p.length - 1)])) {
      for (let i = 0; i + size <= t.length; i++) {
        const got = t.slice(i, i + size).join(' ')
        if (got === want) exact = true
        else if (got[0] === want[0] && distance(got, want) <= near && (p.length > 1 || got.length >= want.length - 1)) {
          const raw = text.trim().split(/\s+/).slice(i, i + size).join(' ')
          // the same kind of text as the phrase: an ALL-CAPS slogan is altered by ALL-CAPS text, a Title Case name by capitalized words; a lower-case paraphrase ("keeps swinging") is not a quote
          const letters = (x: string) => x.replace(/[^A-Za-z]/g, '')
          const upper = letters(phrase) === letters(phrase).toUpperCase()
          const title = !upper && phrase.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).every((w) => /^[^A-Za-z]*[A-Z]/.test(w))
          const sameKind = upper ? letters(raw) === letters(raw).toUpperCase() : title ? raw.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).every((w) => /^[^A-Za-z]*[A-Z]/.test(w)) : true
          if (sameKind) altered = altered ?? raw
        }
      }
    }
    if (altered && !exact) return { phrase, found: altered }
  }
  return null
}

/** The wording of the failure, for a rewrite prompt or a log. */
export const quoteWhy = (q: { phrase: string; found: string }): string => `it changes “${q.phrase}” into “${q.found}”: copy titles, names and quoted words exactly as the story has them`
