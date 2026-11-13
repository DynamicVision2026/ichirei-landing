// Copy of the free card preview and of the change rules (2026-10-30): ja / zh-Hant / en. Native reviewers check these before launch.
// The three lines the owner wrote word for word: drawing, the add-detail message, the made-to-order note (ja); the others follow their meaning.

import type { RevealLang } from '../reveal/copy.ts'

import { REFUND_EN, REFUND_EN_MEMORIAL } from '../order/refund-en.ts'

export interface PreviewCopy {
  /** The heading of the preview step. */
  heading: string
  /** Under it: what this is. */
  lead: string
  /** The same for the e-gift (2026-11-07): there is no printed card; it comes as a PDF to print at home. */
  leadEgift: string
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
  /** Under the cards (2026-11-05): 「別の三字を探す（あと2回）」 — two cards instead of three on a memorial page — and what follows it. */
  another: (left: number) => string
  anotherBusy: string
  addDetail: string
  prevSet: string
  nextSet: string
  setLabel: (n: number, total: number) => string
  /** The quiet link at the bottom of the card screen, back to the story. */
  editStory: string
  /** Only after a request failed: repeats that request. */
  retry: string
  /** On the order step, above the character: back to the cards. */
  chooseOther: string
  /** The refund line above the order button (2026-11-06): cancel only within 24 hours of payment and before 「贈りものを受け取る」. */
  refundLine: string
  /** The same line on a remembrance order: the button is called 「一字を受け取る」 / 「領取這個字」 / "Collect it" (nothing is "given"). */
  refundLineMemorial: string
  /** The small link after it, to /legal#refund. */
  refundDetails: string
  /** The required checkbox: the button stays disabled until it is ticked (never pre-ticked). */
  refundCheck: string
  /** The link beside the order button. */
  legalLink: string
}

export const PREVIEW_COPY: Record<RevealLang, PreviewCopy> = {
  ja: {
    heading: 'カードの中面（見本）',
    lead: 'ご注文いただくカードの内側です。字と詩、あなたの物語の四つの場面が入ります。',
    leadEgift: 'カードの内側（見本）：字と歌、そして物語の四つの場面。eギフトでは、ご自宅で印刷できるPDFでお届けします。',
    sample: '見本',
    drawing: 'あなたの物語を描いています',
    afterOrder: '物語の絵は、ご注文後にお届けします',
    waiting: '描いています…',
    who: 'その人は',
    another: (left) => `別の二字を探す（あと${left}回）`,
    anotherBusy: '新しい候補を探しています…',
    addDetail: '物語を少し書き足すと、新しい字が見つかります。',
    prevSet: '‹ 前の組',
    nextSet: '次の組 ›',
    setLabel: (n, total) => `${n} / ${total}`,
    editStory: '物語を書きなおす',
    retry: 'もう一度ためす',
    chooseOther: '字を選びなおす',
    refundLine: 'キャンセル（全額返金）は、お支払い完了から24時間以内、かつご注文ページで「贈りものを受け取る」を押す前に限ります。24時間を過ぎると、お客様都合による返金は一切できません。お支払い後の内容の変更もできません。',
    refundLineMemorial: 'キャンセル（全額返金）は、お支払い完了から24時間以内、かつご注文ページで「一字を受け取る」を押す前に限ります。24時間を過ぎると、お客様都合による返金は一切できません。お支払い後の内容の変更もできません。',
    refundDetails: '詳しくはこちら',
    refundCheck: 'キャンセル・返金の条件（お支払い完了から24時間以内、受け取り前に限る）を確認しました。',
    legalLink: '特定商取引法に基づく表記・返品について',
  },
  'zh-Hant': {
    heading: '卡片內頁（樣本）',
    lead: '這是您訂購的卡片內側：有字、有詩，還有您故事的四個場景。',
    leadEgift: '卡片內頁（樣本）：有字、有詩，還有你故事的四個場景。e禮物會以可在家列印的PDF提供。',
    sample: '樣本',
    drawing: '正在描繪你的故事',
    afterOrder: '故事的畫，會在訂購後為您送上',
    waiting: '描繪中…',
    who: '這個人是',
    another: (left) => `再找兩個新的字（還可以找${left}次）`,
    anotherBusy: '正在尋找新的候選…',
    addDetail: '把故事再多寫一些，就能找到新的字。',
    prevSet: '‹ 上一組',
    nextSet: '下一組 ›',
    setLabel: (n, total) => `${n} / ${total}`,
    editStory: '修改故事',
    retry: '再試一次',
    chooseOther: '重新選字',
    refundLine: '取消（全額退款）僅限付款完成後24小時內，且在訂單頁面按下「領取禮物」之前。超過24小時後，一律不接受個人因素退款。付款後亦不可更改內容。',
    refundLineMemorial: '取消（全額退款）僅限付款完成後24小時內，且在訂單頁面按下「領取這個字」之前。超過24小時後，一律不接受個人因素退款。付款後亦不可更改內容。',
    refundDetails: '詳細說明',
    refundCheck: '我已確認取消與退款條件（限付款完成後24小時內、領取前）。',
    legalLink: '特定商取引法標示・退換貨說明',
  },
  en: {
    heading: 'Inside the card (sample)',
    lead: 'This is the inside of the card you are ordering: the character, the poem and four scenes from your story.',
    leadEgift: 'Inside of the card (sample): the character, the poem and four scenes from your story. With the e-gift, it comes as a PDF you can print at home.',
    sample: 'Sample',
    drawing: 'Drawing your story',
    afterOrder: "The pictures of your story are delivered after you order.",
    waiting: 'Drawing…',
    who: 'They are',
    another: (left) => `Find two more (${left} left)`,
    anotherBusy: 'Looking for new candidates…',
    addDetail: 'Add a little more to your story to find new characters.',
    prevSet: '‹ Previous',
    nextSet: 'Next ›',
    setLabel: (n, total) => `${n} / ${total}`,
    editStory: 'Edit your story',
    retry: 'Try again',
    chooseOther: 'Choose a different character',
    refundLine: REFUND_EN,
    refundLineMemorial: REFUND_EN_MEMORIAL,
    refundDetails: 'Details',
    refundCheck: "I've read the cancellation and refund terms (within 24 hours of payment, before collecting).",
    legalLink: 'Legal notice (特定商取引法) and returns',
  },
}
