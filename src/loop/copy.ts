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
  /** A picture that is still being drawn: the soft tile in its place. */
  pictureMaking: string
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
  // ---- the dashboard (Part 7, 2026-11-20) ----
  groupUnsent: string
  groupSent: string
  groupSaved: string
  /** the counts line at the top: only the groups that are not empty */
  counts: (unsent: number, sent: number, saved: number) => string
  paidOn: (date: string) => string
  cancelBy: (when: string) => string
  collectAndSend: string
  sendIt: string
  seeAnswer: string
  giftPage: string
  opensAt: (when: string) => string
  notOpenedYet: string
  openedAt: (when: string) => string
  answerCame: (char: string) => string
  /** the quiet line at the bottom of the dashboard */
  staysSafe: string
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
    pictureMaking: '絵を描いています…',
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
    groupUnsent: 'まだ送っていない贈りもの',
    groupSent: '贈った贈りもの',
    groupSaved: '保存中の贈りもの',
    counts: (a, b, c) => [a ? `まだ送っていない：${a}` : '', b ? `贈った：${b}` : '', c ? `保存中：${c}` : ''].filter(Boolean).join('　'),
    paidOn: (d) => `お支払い：${d}`,
    cancelBy: (w) => `キャンセル期限：${w}まで`,
    collectAndSend: '受け取って送る →',
    sendIt: '相手に送る →',
    seeAnswer: '返事を見る →',
    giftPage: '贈りもののページ →',
    opensAt: (w) => `${w}に開きます`,
    notOpenedYet: 'まだ開かれていません',
    openedAt: (w) => `開封されました（${w}）`,
    answerCame: (ch) => `返事が届きました：${ch}`,
    staysSafe: 'このブラウザを閉じても、贈りものは消えません。メールのリンクから、いつでも戻れます。',
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
    pictureMaking: '正在繪製這幅畫…',
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
    groupUnsent: '還沒送出的禮物',
    groupSent: '已送出的禮物',
    groupSaved: '保存中的禮物',
    counts: (a, b, c) => [a ? `還沒送出：${a}` : '', b ? `已送出：${b}` : '', c ? `保存中：${c}` : ''].filter(Boolean).join('　'),
    paidOn: (d) => `付款：${d}`,
    cancelBy: (w) => `取消期限：${w}前`,
    collectAndSend: '領取並送出 →',
    sendIt: '送給對方 →',
    seeAnswer: '看回覆 →',
    giftPage: '禮物頁面 →',
    opensAt: (w) => `${w}開啟`,
    notOpenedYet: '還沒被打開',
    openedAt: (w) => `已打開（${w}）`,
    answerCame: (ch) => `回覆來了：${ch}`,
    staysSafe: '關掉瀏覽器，禮物也不會消失。隨時都能從郵件裡的連結回來。',
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
    pictureMaking: 'Drawing this picture…',
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
    groupUnsent: 'Not sent yet',
    groupSent: 'Sent',
    groupSaved: 'Saved',
    counts: (a, b, c) => [a ? `Not sent yet: ${a}` : '', b ? `Sent: ${b}` : '', c ? `Saved: ${c}` : ''].filter(Boolean).join(' · '),
    paidOn: (d) => `Paid ${d}`,
    cancelBy: (w) => `Cancel by ${w}`,
    collectAndSend: 'Collect and send →',
    sendIt: 'Send it →',
    seeAnswer: 'See the answer →',
    giftPage: 'Gift page →',
    opensAt: (w) => `Opens ${w}`,
    notOpenedYet: 'Not opened yet',
    openedAt: (w) => `Opened (${w})`,
    answerCame: (ch) => `An answer came: ${ch}`,
    staysSafe: 'Your gifts stay safe even if you close this browser. Come back anytime from the link in your email.',
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

/**
 * The Traditional Chinese card and order-section lines (2026-11-19): the Chinese page takes part in the same promotion and the same ONE daily pool (en, ja and zh share the 100 a day; the day
 * changes at 4:00 a.m. US Eastern = 18:00 Japan time). The zh-Hans block below is this one converted with OpenCC (never typed by hand).
 */
// <zh-hant>
const THANKS_ZH_HANT: typeof THANKS_EN = {
  title: '感恩季',
  count: (n: number, daily = 100) => ({ before: `今日的${daily}份免費禮物，還剩 `, n: String(n), after: ' 份。' }),
  sub: '每人限一次，至11月30日止。每天早上（美東時間）／晚上6點（日本時間）更新名額。',
  emailLabel: '電子郵件',
  hold: '保留我的免費禮物',
  holding: '保留中…',
  marketing: '也告訴我新的季節與優惠',
  small: '你的電子郵件只用來保留免費禮物，並在結帳時對應。',
  none: '今日的免費禮物已送完，明天會有新的名額。',
  held: (time: string, m: number) => `你的免費禮物已保留至 ${time}（還剩 ${m} 分鐘）。`,
  write: '寫下一個片刻 →',
  phone: '想在手機上繼續？掃描這個代碼，把禮物帶在身邊。',
  ended: '保留時間已結束。',
  badEmail: '請再確認一下電子郵件。',
  badCode: '請再確認一下免費禮物的代碼。',
  unavailable: '免費禮物暫時休息一下，請幾分鐘後再試一次。',
  threeHolds: (price: string) => `今天的三次保留已經用完。明天早上（美東時間）／晚上6點（日本時間）起可以再保留，也可以今天以 ${price} 送出這份禮物。`,
  alreadyGiven: (price: string) => `這個電子郵件已經領過免費禮物了，謝謝你。這份禮物可以用 ${price} 送出。`,
  orderHeld: (time: string) => `免費禮物已為你保留至 ${time}，結帳時會自動套用。`,
  orderOnUs: '每天前100份禮物免費送出。',
  orderHoldYours: '用電子郵件保留 →',
  orderFree: (n: number, daily = 100) => `今日免費禮物：還剩 ${n} / ${daily} 份。用電子郵件保留一份，這份禮物就是 ¥0。`,
  freePrice: '¥0',
  freeLabel: '免費禮物',
  orderNone: (price: string) => `今日的免費禮物已送完。這份禮物今天可以用 ${price} 送出，或明天再來。你的禮物已保存。`,
}
// </zh-hant>
// <zh-hans>
const THANKS_ZH_HANS: typeof THANKS_EN = {
  title: '感恩季',
  count: (n: number, daily = 100) => ({ before: `今日的${daily}份免费礼物，还剩 `, n: String(n), after: ' 份。' }),
  sub: '每人限一次，至11月30日止。每天早上（美东时间）／晚上6点（日本时间）更新名额。',
  emailLabel: '电子邮件',
  hold: '保留我的免费礼物',
  holding: '保留中…',
  marketing: '也告诉我新的季节与优惠',
  small: '你的电子邮件只用来保留免费礼物，并在结帐时对应。',
  none: '今日的免费礼物已送完，明天会有新的名额。',
  held: (time: string, m: number) => `你的免费礼物已保留至 ${time}（还剩 ${m} 分钟）。`,
  write: '写下一个片刻 →',
  phone: '想在手机上继续？扫描这个代码，把礼物带在身边。',
  ended: '保留时间已结束。',
  badEmail: '请再确认一下电子邮件。',
  badCode: '请再确认一下免费礼物的代码。',
  unavailable: '免费礼物暂时休息一下，请几分钟后再试一次。',
  threeHolds: (price: string) => `今天的三次保留已经用完。明天早上（美东时间）／晚上6点（日本时间）起可以再保留，也可以今天以 ${price} 送出这份礼物。`,
  alreadyGiven: (price: string) => `这个电子邮件已经领过免费礼物了，谢谢你。这份礼物可以用 ${price} 送出。`,
  orderHeld: (time: string) => `免费礼物已为你保留至 ${time}，结帐时会自动套用。`,
  orderOnUs: '每天前100份礼物免费送出。',
  orderHoldYours: '用电子邮件保留 →',
  orderFree: (n: number, daily = 100) => `今日免费礼物：还剩 ${n} / ${daily} 份。用电子邮件保留一份，这份礼物就是 ¥0。`,
  freePrice: '¥0',
  freeLabel: '免费礼物',
  orderNone: (price: string) => `今日的免费礼物已送完。这份礼物今天可以用 ${price} 送出，或明天再来。你的礼物已保存。`,
}
// </zh-hans>

/** The languages that show free gifts. */
export type ThanksLang = 'en' | 'ja' | 'zh-Hant' | 'zh-Hans'
export const THANKS = THANKS_EN
export const thanksCopy = (lang: string | null | undefined): typeof THANKS_EN => (lang === 'ja' ? THANKS_JA : lang === 'zh-Hant' ? THANKS_ZH_HANT : lang === 'zh-Hans' ? THANKS_ZH_HANS : THANKS_EN)
/** The locale a time is written in on a page of this language. */
export const thanksLocale = (lang: string | null | undefined): string => (lang === 'ja' ? 'ja-JP' : lang === 'zh-Hant' ? 'zh-TW' : lang === 'zh-Hans' ? 'zh-CN' : 'en-US')

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

// ---- Save under the customer's e-mail (2026-11-20, the owner's words) ----
export interface SaveCopy {
  /** The panel's lead above the e-mail field */
  lead: string
  field: string
  button: string
  note: string
  /** The prefilled address (partly hidden): the button and the way to type another */
  useSaved: string
  other: string
  /** The separate, unticked box (the free-gift text) */
  consent: string
  /** After saving: where the gift is now (the masked address in the line) */
  saved: (masked: string) => string
  /** After saving while the mailer is not set up yet: the same line without the e-mail part */
  savedPlain: string
  open: string
  /** My gifts on a new device: asks for the e-mail, then says "sent" whether or not it has gifts */
  lookupLead: string
  lookupSent: string
  lookupButton: string
  /** My gifts' heading once the e-mail is known */
  heading: (masked: string, n: number) => string
  /** the smaller copy-link line under the saved block */
  scanLine: string
}
export const SAVE: Record<RevealLang, SaveCopy> = {
  ja: {
    lead: 'この贈りものを、あなたのメールアドレスに保存します。',
    field: 'メールアドレス',
    button: 'メールに保存する',
    note: '保存した贈りもののリンクをお送りします。お知らせを送ることはありません。',
    useSaved: 'このメールに保存する',
    other: '別のメールにする',
    consent: '新しい季節やお知らせを受け取る',
    saved: (m) => `✓ 保存しました。${m}の贈りものとして、30日間お預かりします。リンクをメールでお送りしました。`,
    savedPlain: '✓ 保存しました。30日間お預かりします。',
    open: 'マイギフトを開く →',
    lookupLead: 'メールアドレスを入れてください。マイギフトを開くリンクをお送りします。登録やパスワードは要りません。',
    lookupSent: '送りました。メールのリンクから開いてください。',
    lookupButton: 'リンクを送る',
    heading: (m, n) => `${m}に保存した贈りもの（${n}）`,
    scanLine: 'スマホで読み取ると、いますぐ続きができます',
  },
  'zh-Hant': {
    lead: '這份禮物會保存在你的電子郵件之下。',
    field: '電子郵件',
    button: '保存到我的電子郵件',
    note: '我們只會寄給你保存禮物的連結，不寄其他東西。',
    useSaved: '保存到這個電子郵件',
    other: '換一個電子郵件',
    consent: '也告訴我新的季節與優惠',
    saved: (m) => `✓ 已保存在${m}之下，保留30天。連結已寄到你的信箱。`,
    savedPlain: '✓ 已保存，保留30天。',
    open: '打開我的禮物 →',
    lookupLead: '輸入你的電子郵件，我們會寄給你打開〈我的禮物〉的連結。不需要註冊或密碼。',
    lookupSent: '已寄出。請從郵件裡的連結打開。',
    lookupButton: '寄連結給我',
    heading: (m, n) => `保存在${m}的禮物（${n}）`,
    scanLine: '用手機掃描，馬上就能繼續',
  },
  en: {
    lead: "We'll save this gift under your email address.",
    field: 'Email',
    button: 'Save to my email',
    note: "We'll send you the link to your saved gifts. Nothing else.",
    useSaved: 'Save to this email',
    other: 'Use a different email',
    consent: 'Also tell me about new seasons and offers',
    saved: (m) => `✓ Saved under ${m} for 30 days. We've emailed you the link.`,
    savedPlain: "✓ Saved. We'll keep it for 30 days.",
    open: 'Open My gifts →',
    lookupLead: "Enter your email and we'll send you a link to My gifts. No account or password needed.",
    lookupSent: 'Sent. Open My gifts from the link in your email.',
    lookupButton: 'Send me the link',
    heading: (m, n) => `Saved under ${m} (${n})`,
    scanLine: 'Scan this to continue on your phone right now',
  },
}
