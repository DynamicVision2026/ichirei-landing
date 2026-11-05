// v9.6: the reading frame and the tone lines (engine side). The pure rules — purposes, states, the old occasion codes, the 「その他」 mapping — live in src/order/purpose.ts so the
// page and the server share them.

import { effectivePurpose, effectiveState, freePickMode, purposeFromOccasion, type FreePickMode, type Purpose, type PurposeFacts, type Relationship, type State } from '../src/order/purpose.ts'

export * from '../src/order/purpose.ts'

// ---- the five-question reading frame (the first block of every prompt) -------------------------------------------------------------------------------------------------------

const TONE: Record<Exclude<Purpose, 'other'>, { carries: string; tone: string }> = {
  celebrate: { carries: 'the quality the occasion reveals', tone: 'Bright. A 還暦 / sixtieth birthday is a rebirth, never age.' },
  thanks: { carries: 'the specific care that was given', tone: 'Warm and specific; no flattery.' },
  apology: {
    carries: "the receiver's goodness that the sender failed to honour (faith, patience, forgiveness)",
    tone: "Humble. Never the sender's guilt. No celebration words, no celebration characters.",
  },
  encourage: { carries: 'strength the receiver has already shown', tone: 'Hopeful. Never illness, pain or death words.' },
  farewell: { carries: 'what they leave behind in the sender', tone: 'Grateful and forward-looking.' },
  reconnect: { carries: 'the thread that never broke, or what stayed the same', tone: 'Light. No blame for the gap.' },
  confess: { carries: 'the quality the sender has watched for years', tone: 'Sincere, not effusive.' },
  memorial: { carries: 'who they were, in one act', tone: 'Quiet. Ink black; no red, no celebration, no gift wording.' },
}

const STATE_LINE: Record<Exclude<State, 'other'>, string> = {
  close: 'They are close and see each other often.',
  apart: 'They live apart.',
  lapsed: "They have not met in a while: no guilt for the gap.",
  strained: 'Something between them is unresolved: honour the other person; never announce a reconciliation.',
  lost: 'The receiver can no longer be met: the remembrance rules apply, whatever the purpose.',
}

const PLAYFUL: Record<FreePickMode, string> = {
  playful: 'PLAYFUL: a light, smiling angle (a habit, an object, a saying, a place).',
  gentle: 'GENTLE: no jokes, no teasing; still a different angle from the main card (a habit, an object, a saying, a place), told softly.',
  none: 'NONE: there is no free pick for this gift.',
}

/** The language and script every line you write must be in (2026-11-05). The code checks it afterwards; this is the instruction. */
const LANGUAGE_LINE: Record<string, string> = {
  ja: 'LANGUAGE OF EVERY LINE YOU WRITE: Japanese (kanji and kana). This holds even when the story is in another language; a quotation from the story stays exactly as the customer wrote it.',
  'zh-Hant': 'LANGUAGE AND SCRIPT OF EVERY LINE YOU WRITE: Traditional Chinese (繁體中文) only — no Simplified characters, no Japanese kana. This holds even when the story is in another language; a quotation from the story stays exactly as the customer wrote it.',
  'zh-Hans': 'LANGUAGE AND SCRIPT OF EVERY LINE YOU WRITE: Simplified Chinese (简体中文) only — no Traditional-only characters, no Japanese kana. This holds even when the story is in another language; a quotation from the story stays exactly as the customer wrote it.',
  en: 'LANGUAGE OF EVERY LINE YOU WRITE: English only — no Chinese or Japanese characters outside quotation marks. This holds even when the story is in another language; a quotation from the story stays exactly as the customer wrote it.',
}

export interface FrameContext extends PurposeFacts {
  language?: string
  relationship: Relationship | null
  relationship_other?: string | null
  direction?: string | null
}

/**
 * The reading frame: five questions in a fixed order, the tone rules for this gift's purpose, the state override and the free-pick mode. It is the FIRST block of every prompt
 * (selection, refill, free pick, gaze rewrite, review). The free-text lines are the customer's own words: context to read, never to copy onto a card.
 */
export function purposeFrame(ctx: FrameContext): string {
  const p = effectivePurpose(ctx)
  const s = effectiveState(ctx)
  const form: string[] = []
  form.push(`relationship: ${ctx.relationship ?? 'unspecified'}${ctx.relationship_other ? ` (the sender's own words: “${ctx.relationship_other}”)` : ''}`)
  form.push(`purpose: ${ctx.purpose ?? purposeFromOccasion(ctx.occasion) ?? 'unspecified'}${ctx.purpose_other ? ` (the sender's own words: “${ctx.purpose_other}”${p ? `, read as: ${p}` : ', not mappable: use a neutral warm tone'})` : ''}`)
  form.push(`state: ${ctx.state ?? 'not given'}${ctx.state_other ? ` (the sender's own words: “${ctx.state_other}”${s ? `, read as: ${s}` : ''})` : ''}`)
  const purposeLine = p ? `${p}: the character carries ${TONE[p].carries}. Tone: ${TONE[p].tone}` : 'not given or not mappable: use a neutral, warm tone and let the story decide.'
  const stateLine = s ? STATE_LINE[s] : 'not given: infer it from the story.'
  const mode = freePickMode(ctx)
  return [
    'READING FRAME — read this first, before anything else',
    `THE FORM (the sender chose these before writing): ${form.join(' · ')}`,
    'Answer these five questions, in this order, from the story and the form, before you choose anything:',
    '1. WHO receives it? The person named by the relationship above — never the narrator. In a first-person story the narrator is the sender: find the receiver’s acts inside it.',
    `2. WHY is it given? The purpose — ${purposeLine}`,
    `3. WHERE do the two stand now? ${stateLine}`,
    '4. What is FELT, and what was never said? Name a main feeling and the one underneath it, as relational feelings (gratitude, respect, regret, tenderness, longing, trust, pride, worry, relief…), from the story.',
    '5. What did the RECEIVER DO that shows it? One act, quoted from the story.',
    "Result: the character names the RECEIVER'S QUALITY, in the tone of the purpose. Never a quality of the sender; never a fact the story or the form does not give; never a tone that breaks the purpose's rules (a review rejects a line about the sender as `subject` and one that breaks the tone as `tone`).",
    `FREE PICK for this gift: ${PLAYFUL[mode]}`,
    ...(ctx.language && LANGUAGE_LINE[ctx.language] ? [LANGUAGE_LINE[ctx.language]] : []),
  ].join('\n')
}

/** The short tone reminder for the prompts that do not pick characters (the gaze-line rewrite, the poem, the film, the pictures). '' when no purpose applies. */
export function toneLine(f: PurposeFacts): string {
  const p = effectivePurpose(f)
  const s = effectiveState(f)
  if (!p && !s) return ''
  const parts = [p ? `Purpose: ${p}. ${TONE[p].tone}` : '', s ? STATE_LINE[s] : ''].filter(Boolean)
  return `TONE OF THIS GIFT — ${parts.join(' ')}`
}
