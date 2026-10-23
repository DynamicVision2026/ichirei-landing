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
// The zh-Hans / zh-Hant text is a first draft for native-speaker review (see the report).

import type { UiLanguage } from '../demo/i18n.ts'

export interface SampleCandidate {
  /** The carved glyph (traditional / kyūjitai form when there is one). */
  glyph: string
  /** Line under the glyph: the other form (if any) and the reading. */
  pair: string
  reasoning: string
  primary?: boolean
}

export interface Tier {
  name: string
  lead: string
  price: string
  note: string
}

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
  story: {
    heading: string
    placeholder: string
    tags: string[]
    deliveryDateLabel: string
    deliveryNotice: (days: number) => string
    submit: string
  }
  processing: { text: string }
  showcase: { label: string; summary: string; primaryBadge: string; candidates: SampleCandidate[] }
  confirmation: {
    glyph: string
    pair: string
    /** The certificate line on the paper slip. 〇〇 stands for the sender's name. */
    certificate: string
    headline: string
    subline: string
    cta: string
    delivery: string
    ceremonyCaption: string
    tiers: Tier[]
  }
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
  story: {
    heading: 'その人について、書いてください。',
    placeholder:
      'たとえば——いつも同じ席に座って、同じ湯のみでお茶を飲んでいた。口数は少ないけれど、大事な日にはいつも隣にいてくれた……',
    tags: ['その人との関係（家族・パートナー・友人・仲間 など）', '忘れられない出来事', '感謝していること', 'これからへの願い'],
    deliveryDateLabel: 'お届け希望日',
    deliveryNotice: (days) => `お届け希望日まで${days}日です。特急仕上げ（3営業日）もご用意しています。`,
    submit: '想いを書きはじめる',
  },
  processing: { text: '言葉を読んでいます...' },
  showcase: {
    label: 'Story Summary — Sample',
    summary:
      '帰りがどんなに遅くなっても、玄関の灯りはついていた。多くは語らないけれど、駅まで迎えに来る車の音は、いつも同じだった。同じ湯のみで、お茶を淹れてくれる人。',
    primaryBadge: '中心の一字',
    candidates: [
      { glyph: '燈', pair: '灯 ・ あかり', reasoning: '帰りが遅い夜も、玄関の灯りはいつもついていた。言葉の代わりに、そこにあった一字。', primary: true },
      { glyph: '迎', pair: 'むかえ', reasoning: '改札の向こうで、いつも同じ場所に立っていた。迎えることが、その人の習慣だった。' },
      { glyph: '待', pair: 'まち', reasoning: '何も言わず、ただ待っていてくれた時間の長さ。' },
      { glyph: '默', pair: '黙 ・ もく', reasoning: '多くは語らない。けれど、黙ってそこにいてくれた。' },
      { glyph: '窗', pair: '窓 ・ まど', reasoning: '台所の窓から、帰ってくる姿をいつも探してくれていた。' },
      { glyph: '茶', pair: 'ちゃ', reasoning: '同じ湯のみで、同じ時間に、お茶を淹れてくれた。' },
    ],
  },
  confirmation: {
    glyph: '燈',
    pair: '灯 ・ あかり',
    certificate: 'この字は、〇〇様の目に映る、あなたです。',
    headline: 'この一字を、贈る。',
    subline: '想いを、一字にのせて。',
    cta: 'この一字を、贈る',
    delivery: 'お届け希望日までにお届けします。制作には10営業日をいただいております。',
    ceremonyCaption: '拓本の儀の映像を、後日ここに公開します。',
    tiers: [
      { name: '通常仕上げ', lead: '10営業日', price: '¥38,000', note: '税込・送料込（価格は仮）' },
      { name: '特急仕上げ', lead: '3営業日', price: '¥52,000', note: '税込・送料込（価格は仮）' },
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
  story: {
    heading: '请写一写那个人。',
    placeholder: '例如——总是坐在同一个位置，用同一只杯子喝茶。话不多，但重要的日子，总会在身旁……',
    tags: ['与那个人的关系（家人、伴侣、朋友、伙伴等）', '难忘的一件事', '想要感谢的事', '对往后的心愿'],
    deliveryDateLabel: '期望送达日',
    deliveryNotice: (days) => `距离期望送达日还有 ${days} 天。我们也提供加急制作（3 个工作日）。`,
    submit: '开始写下心意',
  },
  processing: { text: '正在阅读你的文字……' },
  showcase: {
    label: 'Story Summary — Sample',
    summary: '无论多晚回家，玄关的灯总是亮着。话不多，但来车站接我的车声，每次都一样。总是用同一只杯子，为我泡上一杯茶。',
    primaryBadge: '核心之字',
    candidates: [
      { glyph: '燈', pair: '灯 ・ dēng', reasoning: '再晚回家，玄关的灯也是亮着的。没有说出口的话，都在这盏灯里。', primary: true },
      { glyph: '迎', pair: 'yíng', reasoning: '站在检票口外，总是同一个位置。迎接，成了那个人的习惯。' },
      { glyph: '待', pair: 'dài', reasoning: '什么都不说，只是一直等着。那段等待的时间有多长。' },
      { glyph: '默', pair: 'mò', reasoning: '话不多，却总是默默地在那里。' },
      { glyph: '窗', pair: 'chuāng', reasoning: '厨房的窗边，总在张望我回来的身影。' },
      { glyph: '茶', pair: 'chá', reasoning: '同一只杯子，同一个时间，为我泡上一杯茶。' },
    ],
  },
  confirmation: {
    glyph: '燈',
    pair: '灯 ・ dēng',
    certificate: '这个字，是〇〇眼中的你。',
    headline: '就用这一个字。',
    subline: '把心意，放进这一个字里。',
    cta: '就用这一个字',
    delivery: '将在您期望的送达日之前送到。制作需要 10 个工作日。',
    ceremonyCaption: '拓印仪式的影片将于日后在此公开。',
    tiers: [
      { name: '标准制作', lead: '10 个工作日', price: '¥38,000', note: '含税含运费（价格为暂定）' },
      { name: '加急制作', lead: '3 个工作日', price: '¥52,000', note: '含税含运费（价格为暂定）' },
    ],
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
  story: {
    heading: '請寫一寫那個人。',
    placeholder: '例如——總是坐在同一個位置，用同一只杯子喝茶。話不多，但重要的日子，總會在身旁……',
    tags: ['與那個人的關係（家人、伴侶、朋友、夥伴等）', '難忘的一件事', '想要感謝的事', '對往後的心願'],
    deliveryDateLabel: '期望送達日',
    deliveryNotice: (days) => `距離期望送達日還有 ${days} 天。我們也提供加急製作（3 個工作天）。`,
    submit: '開始寫下心意',
  },
  processing: { text: '正在閱讀你的文字……' },
  showcase: {
    label: 'Story Summary — Sample',
    summary: '無論多晚回家，玄關的燈總是亮著。話不多，但來車站接我的車聲，每次都一樣。總是用同一只杯子，為我泡上一杯茶。',
    primaryBadge: '核心之字',
    candidates: [
      { glyph: '燈', pair: '灯 ・ dēng', reasoning: '再晚回家，玄關的燈也是亮著的。沒有說出口的話，都在這盞燈裡。', primary: true },
      { glyph: '迎', pair: 'yíng', reasoning: '站在剪票口外，總是同一個位置。迎接，成了那個人的習慣。' },
      { glyph: '待', pair: 'dài', reasoning: '什麼都不說，只是一直等著。那段等待的時間有多長。' },
      { glyph: '默', pair: 'mò', reasoning: '話不多，卻總是默默地在那裡。' },
      { glyph: '窗', pair: 'chuāng', reasoning: '廚房的窗邊，總在張望我回來的身影。' },
      { glyph: '茶', pair: 'chá', reasoning: '同一只杯子，同一個時間，為我泡上一杯茶。' },
    ],
  },
  confirmation: {
    glyph: '燈',
    pair: '灯 ・ dēng',
    certificate: '這個字，是〇〇眼中的你。',
    headline: '就用這一個字。',
    subline: '把心意，放進這一個字裡。',
    cta: '就用這一個字',
    delivery: '將在您期望的送達日之前送到。製作需要 10 個工作天。',
    ceremonyCaption: '拓印儀式的影片將於日後在此公開。',
    tiers: [
      { name: '標準製作', lead: '10 個工作天', price: '¥38,000', note: '含稅含運費（價格為暫定）' },
      { name: '加急製作', lead: '3 個工作天', price: '¥52,000', note: '含稅含運費（價格為暫定）' },
    ],
  },
}

export const LANDING_COPY: Record<UiLanguage, LandingCopy> = { ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant }
