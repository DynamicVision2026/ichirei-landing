// The story-opener questions (Part A of the 2026-10-30 ticket): one specific question above the story box, four angles per set.
// The data is engine/story-questions.json (ja / zh-Hant / en; native reviewers check it before launch). A question is context for the
// engine only — it is never a reason to choose a character — and it is never about what to tell the receiver or how they will react.
//
// The browser sends the shown question's id with the story (`prompt_question`); the server trusts the ID only and looks the wording up
// here, so text typed into a request can never reach a prompt.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Language } from './contract.ts'

export const QUESTION_SETS = ['up', 'across', 'down', 'work', 'memorial'] as const
export type QuestionSet = (typeof QUESTION_SETS)[number]
export const QUESTION_ANGLES = ['habit', 'moment', 'said', 'changed'] as const
export type QuestionAngle = (typeof QUESTION_ANGLES)[number]
export type QuestionLang = 'ja' | 'zh-Hant' | 'en'
export interface StoryQuestion {
  id: string
  angle: QuestionAngle
  ja: string
  'zh-Hant': string
  en: string
}
export interface QuestionFile {
  angles: QuestionAngle[]
  sets: Record<QuestionSet, StoryQuestion[]>
}

let cached: QuestionFile | null = null
export function loadStoryQuestions(): QuestionFile {
  if (cached) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, 'story-questions.json'), join(process.cwd(), 'engine', 'story-questions.json'), join(process.cwd(), 'story-questions.json')]
  for (const p of candidates) {
    try {
      cached = JSON.parse(readFileSync(p, 'utf8')) as QuestionFile
      return cached
    } catch {
      // try next
    }
  }
  throw new Error(`story-questions.json not found (looked at ${candidates.join(', ')})`)
}

/** The language a question is written in for a buyer's language (Simplified Chinese buyers read the Traditional wording). */
export const questionLang = (language: Language | string): QuestionLang => (language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh-Hant')

export function findQuestion(id: unknown): { set: QuestionSet; question: StoryQuestion } | null {
  if (typeof id !== 'string') return null
  const file = loadStoryQuestions()
  for (const set of QUESTION_SETS) {
    const question = file.sets[set]?.find((q) => q.id === id)
    if (question) return { set, question }
  }
  return null
}

/** The wording of a known question id in the buyer's language, or null for anything unknown. */
export const questionText = (id: unknown, language: Language | string): string | null => {
  const found = findQuestion(id)
  return found ? found.question[questionLang(language)] : null
}

/**
 * Read the browser's `prompt_question` ({ id, text }): only a KNOWN id counts, and the text used is always the server's own wording.
 * Anything else (missing, unknown id, wrong type) is simply ignored — the question is optional context, never a reason to refuse a story.
 */
export function parsePromptQuestion(raw: unknown, language: Language | string): { id: string; set: QuestionSet; text: string } | null {
  const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined
  const found = findQuestion(id)
  return found ? { id: found.question.id, set: found.set, text: found.question[questionLang(language)] } : null
}
