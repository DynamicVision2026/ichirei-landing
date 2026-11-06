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
  /** E. Changes and help */
  changeUntil: (when: string) => string
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
    changeUntil: (w) => `ご注文から24時間以内（${w}まで）なら、確認メールに返信して、字の変更や取り消しができます。`,
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
    changeUntil: (w) => `下單後24小時內（${w}前），回覆確認郵件即可更換字或取消訂單。`,
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
    changeUntil: (w) => `Until ${w} (24 hours after ordering), reply to the confirmation email to change the character or cancel.`,
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

/** The ordering day in the reader's own time zone (the browser's). */
export function orderedText(lang: PageLang, iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return lang === 'en' ? `${t.getDate()} ${EN_MONTHS[t.getMonth()]}` : `${t.getMonth() + 1}月${t.getDate()}日`
}

/** 11月7日 14時 · 14時37分 · 7 Nov, 14:37 — the deadline in the reader's own time zone; the minutes are shown unless they are 00 (the deadline is exact, so it is never rounded). */
export function deadlineText(lang: PageLang, iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const h = t.getHours()
  const min = t.getMinutes()
  if (lang === 'en') return `${t.getDate()} ${EN_MONTHS[t.getMonth()]}, ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  return `${t.getMonth() + 1}月${t.getDate()}日 ${h}時${min ? `${min}分` : ''}`
}
