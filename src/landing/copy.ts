// Landing-page copy (v5): all occasions, any relationship, in ja / zh-Hans / zh-Hant.
// Same setup as /demo (src/demo/i18n.ts): plain TS with no imports beyond a type, one Copy per
// language, shape-checked by scripts/test-landing-copy.ts.
//
// Editorial rules (also enforced by that test):
//  - occasion-neutral: nothing assumes a 60th birthday or any one occasion;
//  - any relationship: no line assumes a parent, a spouse, an age;
//  - the AI stays invisible: no mention of AI, models, algorithms or "reading by a machine";
//  - the SENDER chooses and the character mirrors the SENDER's gaze — never "the receiver
//    picks their own kanji", never "they will love it";
//  - the thesis line is kept verbatim in Japanese.
//
// The write → choose → order flow (src/demo/*) has its own copy in src/demo/i18n.ts.
//
// The zh-Hans / zh-Hant text is a first draft for native-speaker review (see the report).

import type { UiLanguage } from '../demo/i18n.ts'

export interface LandingCopy {
  documentTitle: string
  documentDescription: string
  /** The brand in the language's own script (一字礼 / 一字禮). */
  brand: string
  nav: { languageLabel: string; languages: Record<UiLanguage, string>; cta: string }
  hero: { eyebrow: string; title: string; subtitle: string; cta: string }
  marquee: { phrase: string; label: string }
  resonance: { lines: string[]; thesis: string }
  process: { label: string; steps: string[] }
}

const ja: LandingCopy = {
  documentTitle: 'ICHIREI 一字礼 — 一字の贈りもの',
  documentDescription: 'ICHIREI（一字礼）— あなたの目に映る、その人を、一文字に。大切な人への、一字の贈りもの。',
  brand: '一字礼',
  nav: {
    languageLabel: '言語',
    languages: { ja: '日本語', 'zh-Hans': '简体', 'zh-Hant': '繁體' },
    cta: 'はじめる',
  },
  hero: {
    eyebrow: 'A Gift of One Character',
    title: '一字の贈りもの',
    subtitle: 'あなたの目に映る、その人を、一文字に。',
    cta: 'その一字を、探しにいく',
  },
  marquee: { phrase: '一字礼 ・ ICHIREI ・ 一字の贈りもの ・ ', label: '一字礼 ICHIREI 一字の贈りもの' },
  resonance: {
    lines: [
      'ずっと、そばで見てきた。',
      '言葉にすると、いつも足りなくなる。',
      'カードの一行では、伝えきれない。',
      'その人を、一文字にできたら。',
      'それは、あなたにしか選べない一字。',
    ],
    thesis: '想いは、言葉にできなくてもいい。一文字が、あなたの見つめ方を映す。',
  },
  process: {
    label: 'The Process',
    steps: [
      'その人のことを書く',
      '言葉を、深く読む',
      '一字が浮かぶ',
      '六つの候補',
      'あなたが選ぶ',
      '一字が、贈りものになる',
    ],
  },
}

const zhHans: LandingCopy = {
  documentTitle: 'ICHIREI 一字礼 — 一个字的礼物',
  documentDescription: 'ICHIREI（一字礼）— 把你眼中的那个人，凝成一个字。献给重要的人的一个字的礼物。',
  brand: '一字礼',
  nav: {
    languageLabel: '语言',
    languages: { ja: '日本語', 'zh-Hans': '简体', 'zh-Hant': '繁體' },
    cta: '开始',
  },
  hero: {
    eyebrow: 'A Gift of One Character',
    title: '一个字的礼物',
    subtitle: '把你眼中的那个人，凝成一个字。',
    cta: '去寻找那一个字',
  },
  marquee: { phrase: '一字礼 ・ ICHIREI ・ 一个字的礼物 ・ ', label: '一字礼 ICHIREI 一个字的礼物' },
  resonance: {
    lines: [
      '一直都在身边看着。',
      '一说出口，总觉得不够。',
      '卡片上的一行字，说不尽。',
      '如果能把那个人，凝成一个字。',
      '那是只有你才能选出的一个字。',
    ],
    thesis: '心意，不必说出口也可以。一个字，映出你看着对方的方式。',
  },
  process: {
    label: 'The Process',
    steps: ['写下那个人', '深入读懂你的文字', '一个字浮现', '六个候选', '由你来选', '一个字，成为礼物'],
  },
}

const zhHant: LandingCopy = {
  documentTitle: 'ICHIREI 一字禮 — 一個字的禮物',
  documentDescription: 'ICHIREI（一字禮）— 把你眼中的那個人，凝成一個字。獻給重要的人的一個字的禮物。',
  brand: '一字禮',
  nav: {
    languageLabel: '語言',
    languages: { ja: '日本語', 'zh-Hans': '简体', 'zh-Hant': '繁體' },
    cta: '開始',
  },
  hero: {
    eyebrow: 'A Gift of One Character',
    title: '一個字的禮物',
    subtitle: '把你眼中的那個人，凝成一個字。',
    cta: '去尋找那一個字',
  },
  marquee: { phrase: '一字禮 ・ ICHIREI ・ 一個字的禮物 ・ ', label: '一字禮 ICHIREI 一個字的禮物' },
  resonance: {
    lines: [
      '一直都在身邊看著。',
      '一說出口，總覺得不夠。',
      '卡片上的一行字，說不盡。',
      '如果能把那個人，凝成一個字。',
      '那是只有你才能選出的一個字。',
    ],
    thesis: '心意，不必說出口也可以。一個字，映出你看著對方的方式。',
  },
  process: {
    label: 'The Process',
    steps: ['寫下那個人', '深入讀懂你的文字', '一個字浮現', '六個候選', '由你來選', '一個字，成為禮物'],
  },
}

export const LANDING_COPY: Record<UiLanguage, LandingCopy> = { ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant }
