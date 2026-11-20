// The buyer's own page /a/<id> (after payment, opened from the confirmation e-mail): its few words, in the three languages of the customer pages. The strings are the owner's
// (ticket 2026-11-06), word for word; zh-Hans reads as zh-Hant (toRevealLang), as on every customer page. One is not in the ticket for zh-Hant / en (the order date label) and uses the nearest wording — marked NEAREST below. The support address is printed alone, as selectable text, with no label of our own.

import type { PageLang } from './copy.ts'

export interface BuyerCopy {
  title: string
  /** A. Welcome */
  welcome: string
  orderCharacter: string
  orderGift: string
  /** NEAREST: the ticket gives 「注文日」 for ja only. */
  orderDate: string
  sizes: { egift: string; simple: string; standard: string }
  /** B. Send the gift (the e-gift; the digital gift is included in every size) */
  sendTitle: string
  sendTitleMemorial: string
  sendLine: string
  opensOn: (date: string) => string
  preview: string
  /** C. Wooden gift status */
  woodTitle: string
  woodSteps: [string, string, string, string]
  woodShip: { me: string; direct: string }
  /** D. Save */
  saveTitle: string
  /** E. Cancelling (the only thing that can still be done after payment) */
  changeUntil: (when: string) => string
  /** 「贈りものを受け取る」: the one tap that unlocks sending and saving, and ends the right to cancel. */
  collect: string
  /** A remembrance order: nothing is "given", the one tap is called 「一字を受け取る」 / 「領取這個字」 / "Collect it". */
  collectMemorial: string
  collectLine: string
  collectLineLate: string
  collectFinishing: string
  collectConfirm: string
  collectYes: string
  collectNo: string
  cancelBy: (when: string) => string
  checkFirst: string
  /** The payment has not been seen yet (Shopify has not confirmed it): nothing unlocks, the page asks to be opened again (2026-11-14). */
  confirmingPayment: string
  /** The paid gift is not complete yet (a picture, the poem, the film or the certificate number is still missing): the page asks to be opened again; cancelling stays possible. */
  finishingGift: string
  /** A cancelled order. */
  gone: string
}

export const BUYER_COPY: Record<PageLang, BuyerCopy> = {
  ja: {
    title: '一字礼 — ご注文ページ',
    welcome: 'ご注文ありがとうございます。',
    orderCharacter: '一字',
    orderGift: '贈り方',
    orderDate: '注文日',
    sizes: { egift: 'eギフト', simple: '木札', standard: '版木' },
    sendTitle: '贈りものを送る',
    sendTitleMemorial: '贈りものを届ける',
    sendLine: '相手が開くのは、封をした贈りものです。下のどれかで送ってください。',
    opensOn: (d) => `開封日：${d}（それまでは封が閉じたままです）`,
    preview: '相手が見る画面を確かめる',
    woodTitle: '木の贈りもの',
    woodSteps: ['ご注文を承りました', '制作しています', '発送しました', 'お届け済み'],
    woodShip: { me: 'お届け先：ご自身', direct: 'お届け先：相手の方へ直接' },
    saveTitle: '保存する',
    changeUntil: (w) => `お支払い完了から24時間以内、${w}までなら、確認メールにご返信いただくとキャンセル（全額返金）ができます。`,
    collect: '贈りものを受け取る',
    collectMemorial: '一字を受け取る',
    collectLine: '受け取ると、相手に送ったり、保存したりできるようになります。受け取った後はキャンセルできません。',
    collectLineLate: '受け取ると、相手に送ったり、保存したりできるようになります。',
    collectFinishing: '贈りものを仕上げています…',
    collectConfirm: '受け取りますか？この後はキャンセルできません。',
    collectYes: '受け取る',
    collectNo: 'まだ',
    cancelBy: (w) => `キャンセル期限：${w}まで（受け取る前に限ります）。期限を過ぎると、お客様都合による返金はできません。`,
    checkFirst: '受け取る前に、相手に届く内容をご確認ください。',
    confirmingPayment: 'お支払いを確認しています。数分後にもう一度開いてください。',
    finishingGift: '贈りものを仕上げています。数分後にもう一度開いてください。',
    gone: 'この贈りものは、現在ご覧いただけません。',
  },
  'zh-Hant': {
    title: '一字禮 — 訂單頁面',
    welcome: '謝謝你的訂購。',
    orderCharacter: '一字',
    orderGift: '方案',
    orderDate: '下單日',
    sizes: { egift: 'e禮物', simple: '木牌', standard: '版木' },
    sendTitle: '把禮物送出去',
    sendTitleMemorial: '把它傳給家人',
    sendLine: '對方打開的會是一份封好的禮物。請用下面任一種方式傳送。',
    opensOn: (d) => `開啟日期：${d}（在那之前禮物會保持封好）`,
    preview: '預覽對方會看到的畫面',
    woodTitle: '木製禮物',
    woodSteps: ['已收到訂單', '製作中', '已出貨', '已送達'],
    woodShip: { me: '寄送對象：寄給自己', direct: '寄送對象：直接寄給對方' },
    saveTitle: '儲存',
    changeUntil: (w) => `付款完成後24小時內，${w}前，回覆確認郵件即可取消並全額退款。`,
    collect: '領取禮物',
    collectMemorial: '領取這個字',
    collectLine: '領取後即可傳送與儲存。領取後將無法取消訂單。',
    collectLineLate: '領取後即可傳送與儲存。',
    collectFinishing: '禮物製作中…',
    collectConfirm: '確定領取嗎？領取後將無法取消。',
    collectYes: '領取',
    collectNo: '先不要',
    cancelBy: (w) => `取消期限：${w}前（限領取前）。超過期限後，恕不接受個人因素退款。`,
    checkFirst: '領取前，請先確認對方將收到的內容。',
    confirmingPayment: '正在確認付款，請幾分鐘後再打開。',
    finishingGift: '禮物正在完成中，請幾分鐘後再打開。',
    gone: '這份禮物目前無法查看。',
  },
  en: {
    title: 'ICHIREI — your order',
    welcome: 'Thank you for your order.',
    orderCharacter: 'Character',
    orderGift: 'Gift',
    orderDate: 'Ordered',
    sizes: { egift: 'E-gift', simple: 'Wooden tag', standard: 'Carved block' },
    sendTitle: 'Send your gift',
    sendTitleMemorial: 'Share it with family',
    sendLine: "They'll open a sealed gift. Send it in any of these ways.",
    opensOn: (d) => `Opens on: ${d} (sealed until then)`,
    preview: "Preview what they'll see",
    woodTitle: 'Your wooden gift',
    woodSteps: ['Order received', 'Being made', 'Shipped', 'Delivered'],
    woodShip: { me: 'Ship to: you', direct: 'Ship to: them directly' },
    saveTitle: 'Save',
    changeUntil: (w) => `Until ${w} (24 hours after payment), reply to the confirmation email to cancel for a full refund.`,
    collect: 'Collect your gift',
    collectMemorial: 'Collect it',
    collectLine: "Once collected, you can send and save it. After that, the order can't be cancelled.",
    collectLineLate: 'Once collected, you can send and save it.',
    collectFinishing: 'Finishing your gift…',
    collectConfirm: "Collect it now? You won't be able to cancel after this.",
    collectYes: 'Collect',
    collectNo: 'Not yet',
    cancelBy: (w) => `Cancel by: ${w} (before you collect). After that, no refunds for change of mind.`,
    checkFirst: "Before collecting, check what they'll receive.",
    confirmingPayment: "We're confirming your payment. Please open this page again in a few minutes.",
    finishingGift: "Your gift is being finished. Please open this page again in a few minutes.",
    gone: 'This gift is no longer available.',
  },
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 11月10日 · 10 Nov — from a day (YYYY-MM-DD), no time zone involved (the opening day is a calendar day). */
export function dayText(lang: PageLang, ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const month = Number(m[2])
  const day = Number(m[3])
  return lang === 'en' ? `${day} ${EN_MONTHS[month - 1]}` : `${month}月${day}日`
}

/**
 * The page's market zone for the times on the buyer's page (2026-11-20): ja → Japan time, zh → Japan time (the Chinese page is the Japanese store's), en → US Eastern. Never the device's zone: nothing
 * about the visitor's device decides what time a page shows.
 */
const ZONE_OF: Record<PageLang, string> = { ja: 'Asia/Tokyo', 'zh-Hant': 'Asia/Tokyo', en: 'America/New_York' }
const clockOf = (lang: PageLang, iso: string): { month: number; day: number; hour: number; minute: number } | null => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const f = new Intl.DateTimeFormat('en-US', { timeZone: ZONE_OF[lang], hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  return { month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute) }
}

/** The ordering day, in the page's market zone. */
export function orderedText(lang: PageLang, iso: string): string {
  const c = clockOf(lang, iso)
  if (!c) return ''
  return lang === 'en' ? `${c.day} ${EN_MONTHS[c.month - 1]}` : `${c.month}月${c.day}日`
}

/** The cancel deadline with its zone, in the page's market: 「11月20日 20時4分（日本時間）」 · en "Nov 20, 6:04 AM ET". The minutes are shown unless they are 00 (the deadline is exact, so it is never rounded). */
export function deadlineText(lang: PageLang, iso: string): string {
  const c = clockOf(lang, iso)
  if (!c) return ''
  if (lang === 'en') {
    const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12
    return `${EN_MONTHS[c.month - 1]} ${c.day}, ${h12}:${String(c.minute).padStart(2, '0')} ${c.hour >= 12 ? 'PM' : 'AM'} ET`
  }
  return `${c.month}月${c.day}日 ${c.hour}時${c.minute ? `${c.minute}分` : ''}（日本時間）`
}
