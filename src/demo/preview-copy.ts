// Copy of the free card preview and of the change rules (2026-10-30): ja / zh-Hant / en. Native reviewers check these before launch.
// The three lines the owner wrote word for word: drawing, the add-detail message, the made-to-order note (ja); the others follow their meaning.

import type { RevealLang } from '../reveal/copy.ts'

export interface PreviewCopy {
  /** The heading of the preview step. */
  heading: string
  /** Under it: what this is. */
  lead: string
  /** The light mark on the card. */
  sample: string
  /** While the pictures are being drawn. */
  drawing: string
  /** Where no picture comes before payment (limit reached, or they could not be drawn). */
  afterOrder: string
  /** A picture that has not arrived yet (for screen readers). */
  waiting: string
  /** "Who they are" label on the card. */
  who: string
  /** 「別の候補を見る」 and what follows it. */
  another: string
  anotherBusy: string
  addDetail: string
  prevSet: string
  nextSet: string
  setLabel: (n: number, total: number) => string
  /** The note above the order button. */
  madeToOrder: string
  /** The link beside the order button. */
  legalLink: string
  /** One line the change window, shown under the order button area. */
  windowNote: string
}

export const PREVIEW_COPY: Record<RevealLang, PreviewCopy> = {
  ja: {
    heading: 'カードの中面（見本）',
    lead: 'ご注文いただくカードの内側です。字と詩、あなたの物語の四つの場面が入ります。',
    sample: '見本',
    drawing: 'あなたの物語を描いています',
    afterOrder: '物語の絵は、ご注文後にお届けします',
    waiting: '描いています',
    who: 'その人は',
    another: '別の候補を見る',
    anotherBusy: '新しい候補を探しています…',
    addDetail: '物語を少し書き足すと、新しい字が見つかります',
    prevSet: '前の候補',
    nextSet: '次の候補',
    setLabel: (n, total) => `候補 ${n} / ${total}`,
    madeToOrder: '受注制作のため、24時間を過ぎたお客様都合の変更・返品はお受けできません。',
    legalLink: '特定商取引法に基づく表記・返品について',
    windowNote: 'ご注文から24時間以内であれば、ご覧いただいた他の字への変更・キャンセルを承ります。',
  },
  'zh-Hant': {
    heading: '卡片內頁（樣本）',
    lead: '這是您訂購的卡片內側：有字、有詩，還有您故事的四個場景。',
    sample: '樣本',
    drawing: '正在描繪你的故事',
    afterOrder: '故事的畫，會在訂購後為您送上',
    waiting: '描繪中',
    who: '這個人是',
    another: '看看其他候選',
    anotherBusy: '正在尋找新的候選…',
    addDetail: '把故事再多寫一點，就能找到新的字',
    prevSet: '上一組候選',
    nextSet: '下一組候選',
    setLabel: (n, total) => `候選 ${n} / ${total}`,
    madeToOrder: '因為是接單製作，下單超過 24 小時後，因顧客個人因素的更換或退貨，恕不受理。',
    legalLink: '特定商取引法標示・退換貨說明',
    windowNote: '下單後 24 小時內，可更換為您看過的其他字，或取消訂單。',
  },
  en: {
    heading: 'Inside the card (sample)',
    lead: 'This is the inside of the card you are ordering: the character, the poem and four scenes from your story.',
    sample: 'Sample',
    drawing: 'Drawing your story',
    afterOrder: "The pictures of your story are delivered after you order.",
    waiting: 'Drawing',
    who: 'They are',
    another: 'See other candidates',
    anotherBusy: 'Looking for new candidates…',
    addDetail: 'Add a little more to your story to find new characters.',
    prevSet: 'Previous candidates',
    nextSet: 'Next candidates',
    setLabel: (n, total) => `Candidates ${n} of ${total}`,
    madeToOrder: "Because each piece is made to order, we can't accept changes or returns for personal reasons after 24 hours.",
    legalLink: 'Legal notice (特定商取引法) and returns',
    windowNote: 'Within 24 hours of your order you can switch to another character you have seen, or cancel.',
  },
}
