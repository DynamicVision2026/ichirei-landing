// The words of the result page (2026-11-14, B3): the page the sender sees right after pressing 「この一字を贈る」 / "Give this character" — their own character, the four pictures of their moment and the poem.
// ja / zh-Hant / en are the owner's strings; zh-Hans is the zh-Hant text through OpenCC (typed here, and checked equal to the conversion by scripts/test-final-fixes.ts).

import type { UiLanguage } from './i18n.ts'

export interface ResultCopy {
  /** "Your gift for {name}" — with the receiver's name when it is known */
  headingNamed: (name: string) => string
  heading: string
  sub: string
  picturesHeading: string
  closing: string
  note: string
  make: string
  another: string
  waiting: string
  /** a picture that is still being drawn */
  drawing: string
  /** the poem is still being written */
  poemWaiting: string
  /** the header's way back to the writing page, with the story still in the box (2026-11-20) */
  back: string
}

export const RESULT_COPY: Record<UiLanguage, ResultCopy> = {
  ja: {
    headingNamed: (n) => `${n}への贈りもの`,
    heading: 'あなたの贈りもの',
    sub: 'あなたの目に映る、その人。',
    picturesHeading: 'その場面の4枚の絵',
    closing: 'この一字は、あなたの目に映る、その人です。',
    note: 'お届けする贈りものは、封を開くところから始まり、音楽つきのフィルムとともに届きます。',
    make: 'この一字を贈る →',
    another: 'ほかの字を選ぶ',
    waiting: 'その場面を描いています。1分ほどお待ちください。',
    drawing: '描いています…',
    poemWaiting: '歌を書いています…',
    back: '← 場面に戻る',
  },
  'zh-Hant': {
    headingNamed: (n) => `給${n}的禮物`,
    heading: '你的禮物',
    sub: '你眼中的那個人。',
    picturesHeading: '那個片刻的四幅畫',
    closing: '這個字，是你眼中的那個人。',
    note: '送出的禮物會從拆開信封開始，並附上配樂短片。',
    make: '把這個字送出去 →',
    another: '選別的字',
    waiting: '正在描繪這個片刻，約需一分鐘。',
    drawing: '描繪中……',
    poemWaiting: '正在寫詩……',
    back: '← 回到我的片刻',
  },
  'zh-Hans': {
    headingNamed: (n) => `给${n}的礼物`,
    heading: '你的礼物',
    sub: '你眼中的那个人。',
    picturesHeading: '那个片刻的四幅画',
    closing: '这个字，是你眼中的那个人。',
    note: '送出的礼物会从拆开信封开始，并附上配乐短片。',
    make: '把这个字送出去 →',
    another: '选别的字',
    waiting: '正在描绘这个片刻，约需一分钟。',
    drawing: '描绘中……',
    poemWaiting: '正在写诗……',
    back: '← 回到我的片刻',
  },
  en: {
    headingNamed: (n) => `Your gift for ${n}`,
    heading: 'Your gift',
    sub: 'This is how you see them.',
    picturesHeading: 'Four pictures of your moment',
    closing: 'This character is the person as seen through your eyes.',
    note: 'The finished gift opens from a sealed envelope, with the film and music.',
    make: 'Make it a gift →',
    another: 'Choose another character',
    waiting: 'Painting your moment. About a minute.',
    drawing: 'Painting…',
    poemWaiting: 'Writing the poem…',
    back: '← Back to my moment',
  },
}
