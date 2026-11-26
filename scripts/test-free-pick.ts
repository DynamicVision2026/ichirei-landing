// 2026-11-16: a smarter free pick (遊び字) and Sonnet 5.5 for the cards. No network, no model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-free-pick.ts
// (The free call's models, thinking and the fast fallback's timing run against a fake model in test-parallel.ts; the price table in test-ops-stats.ts.)

import { readFileSync } from 'node:fs'
import { DEFAULT_FREE_MODEL, DEFAULT_REVIEW_MODEL } from '../engine/engine.ts'
import { FREE_CALL_MS_DEFAULT, FREE_EFFORT, FREE_FALLBACK_AFTER_MS_DEFAULT, FREE_FALLBACK_MAX_TOKENS, FREE_MAX_TOKENS } from '../engine/cards.ts'
import { MODEL_PRICES } from '../engine/ops-costs.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const read = (f: string) => readFileSync(`engine/${f}`, 'utf8')
const FILES = ['prompt.en.md', 'prompt.ja.md', 'prompt.zh.md', 'card-free-prompt.md']

// ---- A. models ---------------------------------------------------------------------------------------------------------------------------------------------------
{
  const cb = readFileSync('cloudbuild.yaml', 'utf8')
  check("(A) cloudbuild: _MODEL 'claude-sonnet-5-5' → ICHIREI_MODEL, _FREE_MODEL 'claude-sonnet-5-5' → ICHIREI_FREE_MODEL, passed on every deploy; the review stays on _REVIEW_MODEL (Haiku 5.5)", /_MODEL: 'claude-sonnet-5-5'/.test(cb) && /_FREE_MODEL: 'claude-sonnet-5-5'/.test(cb) && cb.includes('ICHIREI_MODEL=${_MODEL}') && cb.includes('ICHIREI_FREE_MODEL=${_FREE_MODEL}') && /_REVIEW_MODEL: 'claude-haiku-5-5'/.test(cb))
  const code = ['engine/engine.ts', 'engine/explain.ts', 'engine/cache-warm.ts'].map((f) => readFileSync(f, 'utf8')).join('\n')
  check("(A) the code default for the main and second cards is claude-sonnet-5-5 (nowhere is 'claude-sonnet-5' still the default)", (code.match(/ICHIREI_MODEL \?\? 'claude-sonnet-5-5'/g) ?? []).length === 3 && !/ICHIREI_MODEL \?\? 'claude-sonnet-5'/.test(code))
  check("(A) the free pick: model claude-sonnet-5-5, effort medium, 5,000 tokens, adaptive thinking (Sonnet 5.5 takes no thinking budget); the fast fallback is Haiku 5.5 (2,600 tokens, no thinking) sent after 8 s; the checks stay on Haiku", DEFAULT_FREE_MODEL === 'claude-sonnet-5-5' && FREE_EFFORT() === 'medium' && FREE_MAX_TOKENS === 5000 && FREE_FALLBACK_MAX_TOKENS === 2600 && FREE_FALLBACK_AFTER_MS_DEFAULT === 8000 && DEFAULT_REVIEW_MODEL === 'claude-haiku-5-5' && FREE_CALL_MS_DEFAULT >= 30_000)
  const cards = readFileSync('engine/cards.ts', 'utf8')
  check('(A) the first free call asks for adaptive thinking; the fallback sends thinking: disabled', /extra\.adaptive \? \{ thinking: \{ type: 'adaptive'/.test(cards) && /noThinking: true, hedge: 2/.test(cards) && /adaptive: true, hedge: 1/.test(cards))
  check('(A) the price of Sonnet 5.5 equals Sonnet 5 ($2 / $10)', MODEL_PRICES['claude-sonnet-5-5'].input === MODEL_PRICES['claude-sonnet-5'].input && MODEL_PRICES['claude-sonnet-5-5'].output === MODEL_PRICES['claude-sonnet-5'].output)
}

// ---- B0. the AHA section in all four prompts ------------------------------------------------------------------------------------------------------------------------------
{
  const HEAD = 'THE AHA — WHAT EVERY CARD MUST DO'
  const END = 'Only "Aha — that\'s them. I never had the word for it." is a card.'
  const sectionOf = (t: string): string => {
    const i = t.indexOf(HEAD)
    const j = t.indexOf('side of the person (second), and the playful detail only these two share (free).', i)
    return i < 0 || j < 0 ? '' : t.slice(i, j + 'side of the person (second), and the playful detail only these two share (free).'.length)
  }
  const sections = FILES.map((f) => sectionOf(read(f)))
  check('(B0) all four prompts (en, ja, zh, free) contain the section "THE AHA — WHAT EVERY CARD MUST DO", and it is the same text in each', sections.every((s) => s.length > 1200 && s.includes(END)) && new Set(sections).size === 1, sections.map((s) => s.length).join())
  const s = sections[0]
  check('(B0) the section says what the owner wrote: ACCURATE first (accuracy comes first), SURPRISING second (the surprise is in the angle, never in strangeness or rarity), THE TEST, begin from a specific detail, the one_line_gaze names the detail, three different "ahas"', /1\. ACCURATE\./.test(s) && /Accuracy comes first/.test(s) && /2\. SURPRISING\./.test(s) && /never in strangeness or rarity/.test(s) && /THE TEST\./.test(s) && /Begin from a specific detail of the moment, not from the general feeling/.test(s) && /The one_line_gaze names that detail/.test(s) && /three different "ahas"/.test(s))
  const placed = FILES.map((f) => {
    const t = read(f)
    const at = t.indexOf(HEAD)
    return f === 'card-free-prompt.md' ? at > t.indexOf('Write the FREE PICK') && at < t.indexOf('CONTEXT (supplied by the harness') : at > t.indexOf('YOUR ROLE') && at < t.indexOf('The governing definition of a good character') && at < t.indexOf('Standing guardrails')
  })
  check('(B0) it sits right after the role description and before the rules (before the governing definition and the guardrails; in the free prompt before CONTEXT and its rules)', placed.every(Boolean), placed.join())
  // every line the prompts had before (the rules) is still there, word for word; the only lines that changed are the free prompt's opening line and its output paragraph (the "Be quick" sentences go, candidate 1 is the smartest)
  const before = JSON.parse(readFileSync('scripts/fixtures/prompt-lines-before-aha.json', 'utf8')) as Record<string, string[]>
  const CHANGED = (f: string, l: string): boolean => (f === 'card-free-prompt.md' && (l.startsWith('Write the FREE PICK (遊び字) card of this gift.') || l.startsWith('OUTPUT. Reply with exactly one JSON object'))) ||
    // Ticket 9 (2026-11-26): the English prompt's three en_word lines were reworded on purpose (the word is chosen in English from the moment)
    (f === 'prompt.en.md' && (l.startsWith('en_word:') || l.startsWith('* `en_word`') || l.includes('"en_word": string')))
  const lost: string[] = []
  for (const f of FILES) {
    const have = new Set(read(f).split('\n'))
    for (const l of before[f]) if (!have.has(l) && !CHANGED(f, l)) lost.push(`${f}: ${l.slice(0, 80)}`)
  }
  check('(B0) no existing rule was removed from any of the four prompts (every earlier line is still present, word for word; two lines of the free prompt and three en_word lines of the English prompt were reworded on purpose)', lost.length === 0, lost.join(' | '))
}

// ---- B. the free-pick prompt: from safe to smart -------------------------------------------------------------------------------------------------------------------------------
{
  const t = read('card-free-prompt.md')
  check('(B) "Be quick" and "A quick, honest answer beats a forced one" are gone', !/Be quick/i.test(t) && !/quick, honest answer/i.test(t) && !/do not deliberate/i.test(t))
  check('(B) the section WHAT MAKES A FREE PICK SMART is there, before the rules (before rule 1)', t.indexOf('WHAT MAKES A FREE PICK SMART') > 0 && t.indexOf('WHAT MAKES A FREE PICK SMART') < t.indexOf('1. Story-anchored:'))
  const smart = t.slice(t.indexOf('WHAT MAKES A FREE PICK SMART'), t.indexOf('1. Story-anchored:'))
  check('(B) it says: smile in recognition ("that\'s so them"); the turn comes from the SHAPE, a PART (radical), a SECOND MEANING or the OBJECT; the three examples 傘, 甘, 走; concrete (one object, habit, place), never a feeling word; what a smart friend would think of', /smile in recognition/.test(smart) && /that's so them/.test(smart) && /SHAPE/.test(smart) && /PARTS \(radicals\)/.test(smart) && /SECOND MEANING/.test(smart) && /OBJECT ITSELF/.test(smart) && smart.includes('傘 for the father who always carries the umbrella for both') && smart.includes('甘 for the grandmother who sneaks an extra sweet into the lunch box') && smart.includes('走 for the friend who runs to every train') && /one object, one habit, one place/.test(smart) && /Never a feeling word/.test(smart) && /smart friend would think of/.test(smart))
  check('(B) the weak picks to avoid: a character that only restates a feeling (楽, 笑, 喜), a generic "fun" word, one tied to the story only by a vague theme', /WEAK PICKS TO AVOID/.test(smart) && /楽, 笑, 喜/.test(smart) && /generic "fun" word/.test(smart) && /vague theme/.test(smart))
  check('(B) one_line_gaze must show the turn (the detail and why this character catches it, still completing 「その人は、」 / "They are"); candidate 1 is the smartest one that passes every rule, not the safest; five ranked options kept', /name the detail and why this character catches it/.test(smart) && /「その人は、」/.test(smart) && /candidate 1 must be the smartest one that passes every rule, not the safest/.test(smart) && /FIVE characters for the free pick, ranked/.test(t) && /smartest one that passes every rule, not the safest/.test(t.slice(t.indexOf('OUTPUT. Reply with exactly one JSON object'))))
  const rules = (t.slice(t.indexOf('THE RULES (every one still applies)')).match(/^\d+\. /gm) ?? []).length
  check('(B) every safety rule is still there: rules 1 to 10, ANCHOR ELSEWHERE, THE OTHER CARDS, the avoid list, the output contract, {"none": true}', rules === 10 && /ANCHOR ELSEWHERE\./.test(t) && /THE OTHER CARDS/.test(t) && /\{\{ AVOID \}\}/.test(t) && /\{\{ FIELDS \}\}/.test(t) && t.includes('{"none": true}') && /7\. NEVER A NEGATIVE TRAIT OR FEELING/.test(t) && /6\. TRUTH\./.test(t) && /2\. Teasing, never insulting\./.test(t))
}

process.stdout.write(failures === 0 ? '\nAll free-pick checks passed.\n' : `\n${failures} CHECKS FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
