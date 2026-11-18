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
  /** 2026-11-16: the header button on every page — "My gifts", with the count when there is at least one */
  myGifts: (n: number) => string
  /** the write page's quiet way back to the landing page */
  back: string
  /** the landing's welcome-back card (a returning visitor with saved gifts) */
  welcome: string
  seeAll: string
  // ---- "My ICHIREI", the customer's own page (2026-11-18) ----
  pageTitle: string
  /** under the masked email: what the page holds once an email is known */
  giftsAndOrders: string
  holdUntil: (time: string) => string
  savedOn: (date: string) => string
  savedUntil: (date: string) => string
  forName: (name: string) => string
  yourMoment: string
  readAll: string
  readLess: string
  poemHeading: string
  picturesHeading: string
  pictureOpen: string
  close: string
  removeAsk: string
  removeYes: string
  removeNo: string
  sentHeading: string
  statusPaid: string
  statusCollected: string
  statusOpened: string
  openGift: string
  emptyPage: string
  writeMoment: string
  // ---- "Save to my email" ----
  keepTitle: string
  emailPlaceholder: string
  emailLabel: string
  saveToEmail: string
  sending: string
  mailSent: string
  mailPending: string
  mailBad: string
  mailLimit: string
  mailFail: string
  sendAgain: string
}

export const LOOP: Record<RevealLang, LoopCopy> = {
  ja: {
    basketBar: (n) => `マイギフト（${n}）→`,
    readyBar: (name) => (name ? `${name}への贈りものの準備ができました。受け取る →` : '贈りものの準備ができました。受け取る →'),
    basketHeading: 'マイギフト',
    basketSaved: '30日間保存されます。',
    giveThis: 'この贈りものを贈る →',
    remove: '削除',
    removeLabel: '削除',
    empty: '保存した贈りものはありません。',
    backToWrite: '← 場面を書く',
    save: '保存',
    copyLink: 'リンクをコピー',
    copied: 'コピーしました',
    qrNote: 'スマホで読み取ると、続きができます',
    emailIt: '自分にメールで送る',
    emailSubject: 'ICHIREI マイギフト',
    emailBody: (link) => link,
    linkNote: 'このリンクを知っている人は、保存した内容を見られます。大切に保管してください。',
    loading: '…',
    myGifts: (n) => (n > 0 ? `マイギフト（${n}）` : 'マイギフト'),
    back: '← 戻る',
    welcome: 'おかえりなさい。保存した贈りもの：',
    seeAll: 'すべて見る →',
    pageTitle: 'マイギフト',
    giftsAndOrders: '保存した贈りものと、ご注文',
    holdUntil: (t) => `無料ギフトを ${t} まで確保しています`,
    savedOn: (d) => `${d}に保存`,
    savedUntil: (d) => `${d}まで保存`,
    forName: (n) => `${n}へ`,
    yourMoment: 'あなたの場面',
    readAll: 'すべて読む',
    readLess: '閉じる',
    poemHeading: '詩',
    picturesHeading: 'その場面の4枚の絵',
    pictureOpen: 'この絵を大きく見る',
    close: '閉じる',
    removeAsk: 'この贈りものをマイギフトから削除しますか？',
    removeYes: '削除する',
    removeNo: 'やめる',
    sentHeading: '贈った贈りもの',
    statusPaid: 'お支払い済み',
    statusCollected: '受け取り済み',
    statusOpened: '開封されました',
    openGift: '贈りもののページを開く →',
    emptyPage: 'まだ何もありません。最初に書いた場面は、ここに残ります。',
    writeMoment: '場面を書く →',
    keepTitle: '贈りものを残す：あなただけのリンクをメールでお送りします。',
    emailPlaceholder: 'you@example.com',
    emailLabel: 'メールアドレス',
    saveToEmail: 'メールに保存',
    sending: '送信中…',
    mailSent: '送りました。メールのリンクを開くと、どの端末でも贈りものが見られます。',
    mailPending: '送りました。メールのリンクを開くと、このアドレスに切り替わります。',
    mailBad: 'メールアドレスをご確認ください。',
    mailLimit: '今日はこのアドレスにすでに3通お送りしました。明日またお試しください。',
    mailFail: 'いま送れませんでした。しばらくしてからもう一度お試しください。',
    sendAgain: 'リンクをもう一度送る',
  },
  'zh-Hant': {
    basketBar: (n) => `我的禮物（${n}）→`,
    readyBar: (name) => (name ? `給${name}的禮物準備好了。前往領取 →` : '禮物準備好了。前往領取 →'),
    basketHeading: '我的禮物',
    basketSaved: '保存30天。',
    giveThis: '送出這份禮物 →',
    remove: '刪除',
    removeLabel: '刪除',
    empty: '目前沒有儲存的禮物。',
    backToWrite: '← 寫下片刻',
    save: '儲存',
    copyLink: '複製連結',
    copied: '已複製',
    qrNote: '用手機掃描就能繼續',
    emailIt: '寄給自己',
    emailSubject: 'ICHIREI 我的禮物',
    emailBody: (link) => link,
    linkNote: '知道這個連結的人都能看到儲存的內容，請妥善保管。',
    loading: '…',
    myGifts: (n) => (n > 0 ? `我的禮物（${n}）` : '我的禮物'),
    back: '← 返回',
    welcome: '歡迎回來。您儲存的禮物：',
    seeAll: '查看全部 →',
    pageTitle: '我的禮物',
    giftsAndOrders: '你的禮物與訂單',
    holdUntil: (t) => `你的免費禮物保留至 ${t}`,
    savedOn: (d) => `儲存於 ${d}`,
    savedUntil: (d) => `保存至 ${d}`,
    forName: (n) => `給${n}`,
    yourMoment: '你的片刻',
    readAll: '閱讀全文',
    readLess: '收起',
    poemHeading: '詩',
    picturesHeading: '那個片刻的四幅畫',
    pictureOpen: '放大這幅畫',
    close: '關閉',
    removeAsk: '要把這份禮物從「我的禮物」刪除嗎？',
    removeYes: '刪除',
    removeNo: '保留',
    sentHeading: '你送出的禮物',
    statusPaid: '已付款',
    statusCollected: '已領取',
    statusOpened: '已開啟',
    openGift: '開啟禮物頁面 →',
    emptyPage: '這裡還空著。你寫下的第一個片刻，會留在這裡。',
    writeMoment: '寫下你的片刻 →',
    keepTitle: '留住你的禮物：我們會把專屬連結寄給你。',
    emailPlaceholder: 'you@example.com',
    emailLabel: '電子信箱',
    saveToEmail: '存到我的信箱',
    sending: '寄送中…',
    mailSent: '已寄出。開啟信中的連結，就能在任何裝置看到你的禮物。',
    mailPending: '已寄出。開啟信中的連結後，就會改用這個信箱。',
    mailBad: '請確認電子信箱的格式。',
    mailLimit: '今天已寄給這個信箱 3 封信，請明天再試。',
    mailFail: '目前寄不出去，請稍後再試。',
    sendAgain: '再寄一次連結',
  },
  en: {
    basketBar: (n) => `My gifts (${n}) →`,
    readyBar: (name) => (name ? `Your gift for ${name} is ready. Collect it →` : 'Your gift is ready. Collect it →'),
    basketHeading: 'My gifts',
    basketSaved: 'Saved for 30 days.',
    giveThis: 'Give this gift →',
    remove: 'Remove',
    removeLabel: 'Remove',
    empty: 'Nothing saved yet.',
    backToWrite: '← Write a moment',
    save: 'Save',
    copyLink: 'Copy link',
    copied: 'Copied',
    qrNote: 'Scan with your phone to continue there',
    emailIt: 'Email it to myself',
    emailSubject: 'My ICHIREI gifts',
    emailBody: (link) => link,
    linkNote: 'Anyone with this link can see your saved gifts. Keep it private.',
    loading: '…',
    saved: 'Saved to My gifts (top right), on this device for 30 days.',
    elsewhere: 'To continue on another device (your phone, another computer), scan the code or email the link to yourself.',
    myGifts: (n) => (n > 0 ? `My gifts (${n})` : 'My gifts'),
    back: '← Back',
    welcome: 'Welcome back. Your saved gifts:',
    seeAll: 'See all →',
    pageTitle: 'My ICHIREI',
    giftsAndOrders: 'Your gifts and orders',
    holdUntil: (t) => `Your free gift is held until ${t}`,
    savedOn: (d) => `Saved ${d}`,
    savedUntil: (d) => `Saved until ${d}`,
    forName: (n) => `For ${n}`,
    yourMoment: 'Your moment',
    readAll: 'Read all',
    readLess: 'Show less',
    poemHeading: 'The poem',
    picturesHeading: 'Four pictures of your moment',
    pictureOpen: 'Open this picture',
    close: 'Close',
    removeAsk: 'Remove this gift from My ICHIREI?',
    removeYes: 'Remove',
    removeNo: 'Keep it',
    sentHeading: "Gifts you've sent",
    statusPaid: 'Paid',
    statusCollected: 'Collected',
    statusOpened: 'Opened',
    openGift: 'Open the gift page →',
    emptyPage: 'Nothing here yet. The first moment you write will be kept here for you.',
    writeMoment: 'Write your moment →',
    keepTitle: "Keep your gifts: we'll email you your private link.",
    emailPlaceholder: 'you@example.com',
    emailLabel: 'Email',
    saveToEmail: 'Save to my email',
    sending: 'Sending…',
    mailSent: 'Sent. Open the link in that email to see your gifts anywhere.',
    mailPending: 'Sent. Open the link in that email to switch to this address.',
    mailBad: 'Please check the email address.',
    mailLimit: "We've already sent 3 emails to this address today. Please try again tomorrow.",
    mailFail: "We couldn't send it just now. Please try again in a moment.",
    sendAgain: 'Send my link again',
  },
}

/** The English "Days of Thanks" card and the lines in the order section. `price` is the price a customer pays today ("$17.50" while the sale runs, else "$25"), read from the price data. */
const THANKS_EN = {
  title: 'Days of Thanks',
  count: (n: number, daily = 100) => ({ before: '', n: String(n), after: ` of today's ${daily} free gifts are still available.` }),
  // (2026-11-16) one free gift per person for the whole promotion (Shopify: once per customer)
  sub: 'One free gift per person, through November 30. New free gifts every morning (US Eastern).',
  emailLabel: 'Email',
  hold: 'Hold my free gift',
  holding: 'Holding…',
  marketing: 'Also tell me about new seasons and offers',
  small: 'We use your email only to hold your free gift and match it at checkout.',
  none: "Today's free gifts are all held or given. New ones arrive tomorrow morning (US Eastern).",
  held: (time: string, m: number) => `Your free gift is held until ${time} (${m} min left).`,
  write: 'Write your moment →',
  phone: 'Continuing on your phone? Scan this to take your gift with you.',
  // 2026-11-16: one line, then the email form as usual (the old line and its link said "Hold again" twice)
  ended: 'Your hold ended.',
  badEmail: 'Please check the email address.',
  badCode: 'Please check the free gift code.',
  unavailable: 'Free gifts are taking a short break. Please try again in a few minutes.',
  threeHolds: (price: string) => `You've used today's three holds. Tomorrow morning (US Eastern) you can hold a free gift again, or give this one today for ${price}.`,
  alreadyGiven: (price: string) => `This email has already received its free gift. Thank you. You can give this one for ${price}.`,
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


/**
 * The Japanese card and order-section lines (2026-11-16): the US and Japan share ONE daily pool of free gifts. Same rules, same day boundary (4:00 a.m. US Eastern = 18:00 Japan time);
 * times are shown in the visitor's own time zone; the 18:00 wording is the Japanese text only. Plain and warm: never 「エラー」「上限」「無効」.
 */
const THANKS_JA: typeof THANKS_EN = {
  title: '感謝の季節 無料ギフト',
  count: (n: number, daily = 100) => ({ before: '本日の無料ギフト　残り ', n: String(n), after: ` / ${daily}` }),
  sub: 'お一人様1回限り、11月30日まで。毎日18時（日本時間）に新しい枠が出ます。',
  emailLabel: 'メールアドレス',
  hold: '無料ギフトを確保する',
  holding: '確保しています…',
  marketing: '新しい季節やお知らせを受け取る',
  small: 'メールアドレスは、無料ギフトの確保とお支払い時の照合にのみ使います。',
  none: '本日の無料ギフトはすべて確保・お渡し済みです。次の枠は18時（日本時間）に出ます。',
  held: (time: string, m: number) => `無料ギフトを ${time} まで確保しました（残り ${m} 分）。`,
  write: '一字を探す →',
  phone: 'スマホで続けますか？このコードを読み取ってください。',
  ended: '確保の時間が終わりました。',
  badEmail: 'メールアドレスをもう一度ご確認ください。',
  badCode: '無料ギフトのコードをもう一度ご確認ください。',
  unavailable: '無料ギフトの受付を少しだけお休みしています。数分後にもう一度お試しください。',
  threeHolds: (price: string) => `本日の確保は3回まで使われました。明日18時（日本時間）からまた確保できます。この贈りものを本日 ${price} で贈ることもできます。`,
  alreadyGiven: (price: string) => `このメールアドレスでは、すでに無料ギフトをお受け取りいただいています。ありがとうございます。この贈りものは ${price} でお贈りいただけます。`,
  orderHeld: (time: string) => `無料ギフトは ${time} まで確保されています。お支払い画面で自動的に適用されます。`,
  orderOnUs: '毎日100件の贈りものは無料です。',
  orderHoldYours: 'メールアドレスで確保する →',
  orderFree: (n: number, daily = 100) => `本日の無料ギフト：残り ${n} / ${daily}。メールアドレスで確保すると、この贈りものは ¥0 になります。`,
  freePrice: '¥0',
  freeLabel: '無料ギフト',
  orderNone: (price: string) => `本日の無料ギフトはすべて確保・お渡し済みです。この贈りものを本日 ${price} で贈るか、18時（日本時間）以降にまたお越しください。贈りものは保存されています。`,
}

/** The languages that show free gifts (zh-Hant: none). */
export type ThanksLang = 'en' | 'ja'
export const THANKS = THANKS_EN
export const thanksCopy = (lang: string | null | undefined): typeof THANKS_EN => (lang === 'ja' ? THANKS_JA : THANKS_EN)

/** The message for a refused hold, by the server's code. */
export function holdRefusal(code: string, price: string, lang: string = 'en'): string {
  const THANKS = thanksCopy(lang)
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
