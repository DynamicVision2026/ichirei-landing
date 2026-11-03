// The four checks the owner reads per story (v9.6): about the receiver · no invented facts · tone fits the purpose · free pick follows the purpose rule.
// Pure code on an engine result: used by scripts/test-purpose.ts (fake-model replies) and by scripts/run-story-accuracy.mjs --set purpose (the real model, run by the owner).
// These are mechanical checks that catch the clear failures; the lines themselves are printed for a human to read.

import type { EngineResult } from './contract.ts'
import { appearanceProblem, gazeProblem, inventedFacts, lineOpensWithSender, subjectProblem } from './gaze.ts'
import { loadPalette } from './palette.ts'
import { effectivePurpose, effectiveState, freePickMode, type PurposeFacts } from './purpose.ts'

export interface PurposeCase {
  id: string
  purpose: string
  relationship: string
  direction: string
  state: string | null
  occasion_detail: string | null
  language: string
  story: string
}

export interface FourChecks {
  receiver: boolean
  facts: boolean
  tone: boolean
  free: boolean
  /** the free pick's character is not a negative feeling or state (焦, 辛, 苦, 怒 …) — launch freeze */
  free_tone: boolean
  /** the same findings as short CODES (receiver:subject, facts:invented, tone:celebration_character …): safe to publish — no card text, no story text */
  codes: string[]
  notes: string[]
}

const FIRST_PERSON_SUBJECT = /^(私は|私が|僕は|僕が|わたしは|わたしが|我は|我|I\b|I'|I’)/
const CELEBRATION = /おめでとう|祝|congrat|恭喜|誕生日|万歳|乾杯|慶/i
const ILLNESS = /病|死|痛|弱|衰|苦しむ|寝たきり|sick|pain|illness|dying|weak/i
const GUILT = /ごめん|申し訳|後悔|罪|悔やむ|謝|guilt|sorry|regret|ashamed/i
const AGE = /老い|老人|年寄|衰え|age(?:ing)?\b|elderly/i
const JOKE = /冗談|からか|ネタ|笑える|爆笑|ドジ|ぐうたら|joke|tease|silly/i

const TONE_BAD: Partial<Record<string, RegExp>> = { apology: GUILT, encourage: ILLNESS, celebrate: AGE }

/** Run the four checks on one result. `facts` are the form's purpose/state (what the sender chose). */
export function fourChecks(result: EngineResult, c: PurposeCase | (PurposeFacts & { story: string; language: string })): FourChecks {
  const notes: string[] = []
  const codes: string[] = []
  const live = result.candidates.filter((x) => !x.eliminated)
  const language = (c.language === 'en' ? 'en' : c.language === 'ja' ? 'ja' : 'zh-Hant') as 'ja' | 'en' | 'zh-Hant'
  const facts: PurposeFacts = { purpose: (c as PurposeCase).purpose as never, state: ((c as PurposeCase).state ?? null) as never, purpose_other: (c as PurposeFacts).purpose_other ?? null, state_other: (c as PurposeFacts).state_other ?? null }
  const purpose = effectivePurpose(facts)
  const state = effectiveState(facts)
  const quiet = purpose === 'apology' || purpose === 'encourage' || purpose === 'memorial'

  // 1. about the receiver: every line describes the person (a sentence about the person, not about the sender or a feeling)
  let receiver = true
  for (const x of live) {
    if (FIRST_PERSON_SUBJECT.test(x.one_line_gaze.trim()) || lineOpensWithSender(x.one_line_gaze, language)) {
      receiver = false
      notes.push(`${x.kanji}: the line starts with the sender as its subject`); codes.push('receiver:sender_subject')
    }
    const sp = subjectProblem(x, language, c.story)
    if (sp) {
      receiver = false
      notes.push(`${x.kanji}: subject — ${sp.why}`); codes.push(`receiver:subject_${sp.where}`)
    }
    if (appearanceProblem(x.one_line_gaze, language)) {
      receiver = false
      notes.push(`${x.kanji}: the line remarks on the person's body or looks`)
      codes.push('receiver:appearance')
    }
    const p = gazeProblem(x.one_line_gaze, language)
    if (p) {
      receiver = false
      notes.push(`${x.kanji}: ${p}`); codes.push('receiver:shape')
    }
  }

  // 2. no invented facts about the sender or a relative
  let facts_ok = true
  for (const x of live) {
    const bad = inventedFacts(x.one_line_gaze, c.story, language)
    if (bad.length > 0) {
      facts_ok = false
      notes.push(`${x.kanji}: states a fact the story does not give (${bad.join(', ')})`); codes.push('facts:invented')
    }
  }

  // 3. tone fits the purpose: no celebration characters or words where there must be none; the purpose's own forbidden words
  let tone = true
  const palette = loadPalette()
  if (quiet || state === 'lost') {
    for (const x of live) {
      if (palette.memorialCategory([x.kanji, x.inscription_form])) {
        tone = false
        notes.push(`${x.kanji}: a celebration character in a quiet gift`); codes.push('tone:celebration_character')
      }
      if (CELEBRATION.test(x.one_line_gaze)) {
        tone = false
        notes.push(`${x.kanji}: celebration words in a quiet gift`); codes.push('tone:celebration_words')
      }
    }
  }
  const bad = purpose ? TONE_BAD[purpose] : undefined
  if (bad) {
    for (const x of live) {
      if (bad.test(x.one_line_gaze)) {
        tone = false
        notes.push(`${x.kanji}: a word that breaks the tone of ${purpose}`); codes.push(`tone:${purpose}`)
      }
    }
  }

  // 4. the free pick follows the purpose rule: none for remembrance / "lost"; otherwise one, and a gentle purpose has no joke in it
  const mode = freePickMode(facts)
  const free = live.find((x) => x.slot === 'freestyle')
  let freeOk = true
  if (mode === 'none') {
    if (free) {
      freeOk = false
      notes.push('a free pick was offered where there must be none'); codes.push('free:offered_where_none')
    }
  } else {
    if (!free) notes.push('no free pick was shown (allowed, but the purpose offers one)')
    else if (mode === 'gentle' && JOKE.test(free.one_line_gaze)) {
      freeOk = false
      notes.push(`${free.kanji}: a joke in a gentle purpose`); codes.push('free:joke_in_gentle')
    }
  }
  // 5. free_tone (launch freeze): the free pick is never a character whose common meaning is a negative feeling or state, even as a joke
  let freeTone = true
  if (free) {
    const palette2 = loadPalette()
    const hit = (['ja', 'zh'] as const).map((f) => palette2.freestyleCategory(f, [free.kanji, free.inscription_form])).find((cat) => cat === 'negative_feeling')
    if (hit) {
      freeTone = false
      notes.push(`${free.kanji}: the free pick's character is a negative feeling or state`); codes.push('free:free_tone')
    }
  }
  return { receiver, facts: facts_ok, tone, free: freeOk, free_tone: freeTone, codes: [...new Set(codes)], notes }
}
