// The story-opener question (Part A): which question set a gift belongs to, and the questions of that set in the page's language.
// The wording lives in engine/story-questions.json (also read by the server, which looks the wording up by id).

import data from '../../engine/story-questions.json' with { type: 'json' }
import type { RevealLang } from '../reveal/copy.ts'
import type { GiftContext } from './i18n.ts'

export type QuestionSet = 'up' | 'across' | 'down' | 'work' | 'memorial'
export interface Question {
  id: string
  angle: string
  text: string
}
type RawQuestion = { id: string; angle: string; ja: string; 'zh-Hant': string; en: string }
const SETS = (data as unknown as { sets: Record<QuestionSet, RawQuestion[]> }).sets

/** The direction a relationship usually has, for the (rare) visitor who picked a relationship but not yet a direction. */
const DEFAULT_DIRECTION: Record<string, 'up' | 'across' | 'down'> = {
  parent_mother: 'up', parent_father: 'up', grandparent: 'up', in_law: 'up', mentor: 'up',
  child: 'down',
  spouse: 'across', romance: 'across', sibling: 'across', friend: 'across', pet: 'across', community: 'across',
}

/**
 * Which set of questions fits this gift: remembrance has its own (remembering voice); a boss or colleague gets the work set; everyone
 * else by direction (up: parent, mentor, 還暦 · across: partner, friend · down: child). Null until a relationship and an occasion are picked.
 */
export function questionSetOf(ctx: Pick<GiftContext, 'relationship' | 'direction' | 'occasion'>): QuestionSet | null {
  if (ctx.relationship === '' || ctx.occasion === '') return null
  if (ctx.occasion === 'memorial') return 'memorial'
  if (ctx.relationship === 'work') return 'work'
  const dir = ctx.direction !== '' ? ctx.direction : DEFAULT_DIRECTION[ctx.relationship]
  return dir === 'up' || dir === 'down' || dir === 'across' ? dir : null
}

export const questionsOf = (set: QuestionSet, lang: RevealLang): Question[] => SETS[set].map((q) => ({ id: q.id, angle: q.angle, text: q[lang] }))

/** The set a known question id belongs to (the id is `<set>-<angle>`), or null. */
export const setOfQuestionId = (id: string | null | undefined): QuestionSet | null => {
  if (!id) return null
  for (const set of Object.keys(SETS) as QuestionSet[]) if (SETS[set].some((q) => q.id === id)) return set
  return null
}

/** A RANDOM angle first, not always the same one: if every parent story began with the same question, many parents would get the same few characters. */
export const randomFirst = (set: QuestionSet, rng: () => number = Math.random): string => SETS[set][Math.min(SETS[set].length - 1, Math.floor(rng() * SETS[set].length))].id

/** The next angle of the same set (cycling through all four). */
export function nextQuestionId(set: QuestionSet, currentId: string | null): string {
  const list = SETS[set]
  const i = list.findIndex((q) => q.id === currentId)
  return list[(i + 1) % list.length].id
}

/** The wording of a known question id in the page's language, or null. */
export function questionTextOf(id: string | null | undefined, lang: RevealLang): string | null {
  const set = setOfQuestionId(id)
  return set ? (SETS[set].find((q) => q.id === id)?.[lang] ?? null) : null
}
