// While the engine works (2026-11-05, Part 8): a few short phrases cut from the visitor's own story fade in and out beside the progress ring.
// Done entirely in the browser — no engine call, nothing is sent; the phrases are the story's own words, never reworded.

const SPLIT = /[。．.！!？?\n\r、，,；;：:]+/u
const MAX_CHARS = 28
const MIN_CHARS = 5

/** Up to `max` (default 6) short phrases from the story, in story order, spread over the whole text. */
export function storyPhrases(story: string, max = 6): string[] {
  const parts = story
    .split(SPLIT)
    .map((p) => p.replace(/\s+/gu, ' ').trim())
    .map((p) => (Array.from(p).length > MAX_CHARS ? Array.from(p).slice(0, MAX_CHARS).join('').trim() : p))
    .filter((p) => Array.from(p).length >= MIN_CHARS)
  const unique = [...new Set(parts)]
  if (unique.length <= max) return unique
  // evenly spaced over the story, so the phrases come from the beginning, the middle and the end
  const out: string[] = []
  for (let i = 0; i < max; i++) out.push(unique[Math.floor((i * (unique.length - 1)) / (max - 1))])
  return [...new Set(out)]
}
