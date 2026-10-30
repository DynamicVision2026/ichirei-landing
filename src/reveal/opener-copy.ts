// Copy of the story opener (Part A, 2026-10-30): the question link, the answer hint, the 10-character note, the draft banner and the
// line shown where the browser has no speech recognition. ja / zh-Hant / en; native reviewers check these before launch.

import type { RevealLang } from './copy.ts'

export interface OpenerCopy {
  /** Quiet link under the question: another angle for the same set. */
  switchQuestion: string
  /** The textarea placeholder: a short answer hint, not "write your story". */
  answerHint: string
  /** Shown while the story is shorter than the minimum. */
  tooShort: string
  draftBanner: string
  draftContinue: string
  draftNew: string
  /** Where the browser cannot recognise speech: the button is hidden and this one line is shown. */
  voiceNone: string
}

export const STORY_MIN = 10

export const OPENER: Record<RevealLang, OpenerCopy> = {
  ja: {
    switchQuestion: '別の問いにする',
    answerHint: 'ひとつの場面や、ひと言だけでも大丈夫です。',
    tooShort: '10字以上で送れます。',
    draftBanner: '書きかけの物語があります',
    draftContinue: '続ける',
    draftNew: '新しく書く',
    voiceNone: 'キーボードのマイクでも話して入力できます。',
  },
  'zh-Hant': {
    switchQuestion: '換一個問題',
    answerHint: '只寫一個場景，或一句話也沒關係。',
    tooShort: '寫滿 10 個字即可送出。',
    draftBanner: '有一篇還沒寫完的故事',
    draftContinue: '繼續',
    draftNew: '重新寫',
    voiceNone: '也可以使用鍵盤上的麥克風來說話輸入。',
  },
  en: {
    switchQuestion: 'Try another question',
    answerHint: 'One moment, or even one sentence, is enough.',
    tooShort: 'At least 10 characters to send.',
    draftBanner: 'You have a story in progress',
    draftContinue: 'Continue',
    draftNew: 'Start new',
    voiceNone: "You can also use your keyboard's microphone.",
  },
}
