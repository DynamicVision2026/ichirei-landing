// Copy of the story opener (Part A, 2026-10-30): the question link, the answer hint, the 10-character note, the draft banner and the
// line shown where the browser has no speech recognition. ja / zh-Hant / en; native reviewers check these before launch.

import type { RevealLang } from './copy.ts'

export interface OpenerCopy {
  /** The large headline above the story box: the scene or story the sender remembers most. */
  headline: string
  /** The small label before the random question, which is only a hint. */
  hintLabel: string
  /** Quiet link under the question: another angle for the same set. */
  switchQuestion: string
  /** One quiet line under the question: answering it is optional. */
  optionalNote: string
  /** The textarea placeholder: an example of one moment, not "write your story". */
  answerHint: string
  /** Shown while the story is shorter than the minimum. */
  tooShort: string
  draftBanner: string
  draftContinue: string
  draftNew: string
  /** Where the browser cannot recognise speech: the button is hidden and this one line is shown. */
  voiceNone: string
  /** Part B: where will the receiver read it? Collapsed by default; not shown for remembrance. */
  readerLabel: string
  readerOptions: { '': string; ja: string; zh: string; en: string; other: string }
}

export const STORY_MIN = 10

export const OPENER: Record<RevealLang, OpenerCopy> = {
  ja: {
    headline: 'その人との、いちばん心に残っている場面を。',
    hintLabel: 'ヒント：',
    switchQuestion: '別のヒントにする',
    optionalNote: 'ヒントに答えなくても大丈夫。思い浮かぶ場面を、そのまま書いてください。',
    answerHint: '例：母は、私が帰るまで毎晩玄関の灯りをつけて待っていた。二十代になってからも。',
    tooShort: '10字以上で送れます。',
    draftBanner: '書きかけの場面があります',
    draftContinue: '続ける',
    draftNew: '新しく書く',
    voiceNone: 'スマホのキーボードのマイクでも入力できます。',
    readerLabel: '受け取る方が読むのは？',
    readerOptions: { '': 'わたしと同じ', ja: '日本', zh: '台湾・香港・マカオ', en: '英語圏', other: 'その他' },
  },
  'zh-Hant': {
    headline: '寫下你和那個人之間，最難忘的一個場景。',
    hintLabel: '提示：',
    switchQuestion: '換一個提示',
    optionalNote: '不必回答提示。想到的場景，直接寫下來就好。',
    answerHint: '例如：媽媽每天晚上都留著門口那盞燈，等我回家。即使我已經二十幾歲了。',
    tooShort: '寫滿 10 個字即可送出。',
    draftBanner: '有一個還沒寫完的片刻',
    draftContinue: '繼續',
    draftNew: '重新寫',
    voiceNone: '也可以用手機鍵盤上的麥克風輸入。',
    readerLabel: '對方閱讀的語言？',
    readerOptions: { '': '和我相同', ja: '日本', zh: '台灣・香港・澳門', en: '英語圈', other: '其他' },
  },
  en: {
    headline: 'The moment with them you remember most.',
    hintLabel: 'Hint:',
    switchQuestion: 'Another hint',
    optionalNote: "You don't have to answer the hint. Write the scene that comes to mind, just as it is.",
    answerHint: 'e.g. My mom left the porch light on every night until I got home, even in my twenties.',
    tooShort: 'At least 10 characters to send.',
    draftBanner: 'You have a moment in progress',
    draftContinue: 'Continue',
    draftNew: 'Start new',
    voiceNone: "You can also use the microphone on your phone's keyboard.",
    readerLabel: 'Where will they read it?',
    readerOptions: { '': 'Same as me', ja: 'Japan', zh: 'Taiwan / Hong Kong / Macau', en: 'English-speaking', other: 'Other' },
  },
}
