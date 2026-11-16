// The customer loop's words (ticket 2026-11-15): the basket, the gift-ready bar, the Save panel and the English "Days of Thanks" card. The page shows ja, zh-Hant and en (zh-Hans readers see zh-Hant).
// Every string here is the owner's, exactly as given.

import type { RevealLang } from '../reveal/copy.ts'

export interface LoopCopy {
  basketBar: (n: number) => string
  /** the gift-ready bar: with the receiver's name, and without */
  readyBar: (name: string) => string
  basketHeading: string
  basketSaved: string
  giveThis: string
  remove: string
  removeLabel: string
  empty: string
  backToWrite: string
  save: string
  copyLink: string
  copied: string
  qrNote: string
  emailIt: string
  emailSubject: string
  emailBody: (link: string) => string
  linkNote: string
  loading: string
  /** en only (2026-11-15): what Save did, and how to continue elsewhere (ja and zh-Hant keep the panel as it was). */
  saved?: string
  elsewhere?: string
}

export const LOOP: Record<RevealLang, LoopCopy> = {
  ja: {
    basketBar: (n) => `保存した贈りもの（${n}）→`,
    readyBar: (name) => (name ? `${name}への贈りものの準備ができました。受け取る →` : '贈りものの準備ができました。受け取る →'),
    basketHeading: '保存した贈りもの',
    basketSaved: '30日間保存されます。',
    giveThis: 'この贈りものを贈る →',
    remove: '×',
    removeLabel: '削除',
    empty: '保存した贈りものはありません。',
    backToWrite: '← 場面を書く',
    save: '保存',
    copyLink: 'リンクをコピー',
    copied: 'コピーしました',
    qrNote: 'スマホで読み取ると、続きができます',
    emailIt: '自分にメールで送る',
    emailSubject: 'My ICHIREI basket',
    emailBody: (link) => link,
    linkNote: 'このリンクを知っている人は、保存した内容を見られます。大切に保管してください。',
    loading: '…',
  },
  'zh-Hant': {
    basketBar: (n) => `已儲存的禮物（${n}）→`,
    readyBar: (name) => (name ? `給${name}的禮物準備好了。前往領取 →` : '禮物準備好了。前往領取 →'),
    basketHeading: '已儲存的禮物',
    basketSaved: '保存30天。',
    giveThis: '送出這份禮物 →',
    remove: '×',
    removeLabel: '刪除',
    empty: '目前沒有儲存的禮物。',
    backToWrite: '← 寫下片刻',
    save: '儲存',
    copyLink: '複製連結',
    copied: '已複製',
    qrNote: '用手機掃描就能繼續',
    emailIt: '寄給自己',
    emailSubject: 'My ICHIREI basket',
    emailBody: (link) => link,
    linkNote: '知道這個連結的人都能看到儲存的內容，請妥善保管。',
    loading: '…',
  },
  en: {
    basketBar: (n) => `Your basket (${n}) →`,
    readyBar: (name) => (name ? `Your gift for ${name} is ready. Collect it →` : 'Your gift is ready. Collect it →'),
    basketHeading: 'Your basket',
    basketSaved: 'Saved for 30 days.',
    giveThis: 'Give this gift →',
    remove: '×',
    removeLabel: 'Delete',
    empty: 'Nothing saved yet.',
    backToWrite: '← Write a moment',
    save: 'Save',
    copyLink: 'Copy link',
    copied: 'Copied',
    qrNote: 'Scan with your phone to continue there',
    emailIt: 'Email it to myself',
    emailSubject: 'My ICHIREI basket',
    emailBody: (link) => link,
    linkNote: 'Anyone with this link can see your saved gifts. Keep it private.',
    loading: '…',
    saved: 'Saved. This gift is in your basket on this device, for 30 days.',
    elsewhere: 'To continue on another device (your phone, another computer), scan the code or email the link to yourself.',
  },
}

/** The English "Days of Thanks" card and the lines in the order section. `price` is the price a customer pays today ("$17.50" while the sale runs, else "$25"), read from the price data. */
export const THANKS = {
  title: 'Days of Thanks',
  count: (n: number, daily = 100) => ({ n: String(n), after: ` of today's ${daily} free gifts are still available.` }),
  sub: 'One free gift per person per day, through November 25. New gifts arrive every morning (US Eastern).',
  emailLabel: 'Email',
  hold: 'Hold my free gift',
  holding: 'Holding…',
  marketing: 'Also tell me about new seasons and offers',
  small: 'We use your email only to hold your free gift and match it at checkout.',
  none: "Today's free gifts are all held or given. New ones arrive tomorrow morning (US Eastern).",
  held: (time: string, m: number) => `Your free gift is held until ${time} (${m} min left).`,
  write: 'Write your moment →',
  phone: 'Continuing on your phone? Scan this to take your gift with you.',
  ended: 'Your hold ended. Hold again?',
  holdAgain: 'Hold again',
  badEmail: 'Please check the email address.',
  badCode: 'Please check the free gift code.',
  unavailable: 'Free gifts are taking a short break. Please try again in a few minutes.',
  threeHolds: (price: string) => `You've used today's three holds. Tomorrow morning (US Eastern) you can hold a free gift again, or give this one today for ${price}.`,
  alreadyGiven: (price: string) => `You've already given today's free gift. Thank you. You can give this one today for ${price}, or come back tomorrow morning (US Eastern).`,
  // the order section, above "Continue to payment"
  orderHeld: (time: string) => `Your free gift is held for you until ${time}. It's applied at checkout.`,
  orderOnUs: 'The first 100 gifts each day are on us.',
  orderHoldYours: 'Hold yours with your email →',
  // the order section (2026-11-15): where the visitor stands
  orderFree: (n: number, daily = 100) => `Free today: ${n} of today's ${daily} free gifts are left. Hold one with your email and this gift is $0.`,
  freePrice: '$0',
  freeLabel: 'Your free gift',
  orderNone: (price: string, sale: boolean) => `Today's free gifts are all held or given. You can give this one today for ${price}${sale ? ' (30% off for Thanksgiving)' : ''}, or come back tomorrow morning (US Eastern). Your gift is saved.`,
}

/** The message for a refused hold, by the server's code. */
export function holdRefusal(code: string, price: string): string {
  switch (code) {
    case 'bad_email':
      return THANKS.badEmail
    case 'bad_code':
      return THANKS.badCode
    case 'all_held':
      return THANKS.none
    case 'three_holds':
    case 'ip_limit':
      return THANKS.threeHolds(price)
    case 'already_given':
      return THANKS.alreadyGiven(price)
    default:
      return THANKS.unavailable
  }
}
