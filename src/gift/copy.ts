// The words of the receiver's gift page /g/<token> (Part 3 of the 2026-10-31 ticket), in the three page languages. Names are the sender's and the
// receiver's as the sender typed them. The remembrance variant has its own first line and no celebration words.

import type { PageLang } from '../animation/copy.ts'

export interface GiftCopy {
  title: string
  loading: string
  notFound: string
  unavailable: string
  preparing: string
  deferred: string
  // 1. the sealed envelope
  envLabel: string
  envLabelMemorial: string
  envLine: string
  /** v9.6: the opening line by purpose. 「おめでとう」 belongs to a celebration only. */
  envLineCelebrate: string
  envLineThanks: string
  envLineMemorial: string
  to: (name: string) => string
  from: (name: string) => string
  open: string
  opensOn: (date: string) => string
  daysLeft: (n: number) => string
  /** The buyer has not collected the gift yet: the sealed envelope says so, with no open button. */
  arriving: string
  /** A cancelled order: the only thing the link says. */
  gone: string
  /** The sender looking at their own gift before the day. */
  previewNote: string
  // 3. the letter
  letterLead: (name: string) => string
  letterLeadMemorial: (name: string) => string
  letterButton: string
  // 5. the reveal
  revealGold: (name: string) => string
  poemButton: string
  // 6. the poem
  poemLabel: string
  certButton: string
  // 7. the certificate
  certTitle: (no: string | null) => string
  certTo: (name: string) => string
  certLine: (name: string) => string
  certFrom: (name: string) => string
  certDate: (date: string) => string
  certTagline: string
  certNext: string
  // 8. keepsakes and the reply
  keepTitle: string
  saveScroll: string
  savePng: string
  savePdf: string
  replyTitle: string
  replyPlaceholder: string
  replySend: string
  replySending: string
  replySent: (name: string) => string
  replyError: string
  replyLeft: (n: number) => string
  /** Skip to the next screen when motion is reduced and the film is shown as stills. */
  next: string
  replay: string
  credits: string
  creditLine: string
}

const ja = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number)
  return `${y}年${m}月${day}日`
}
const jaShort = (d: string, thisYear: number): string => {
  const [y, m, day] = d.split('-').map(Number)
  return y === thisYear ? `${m}月${day}日` : `${y}年${m}月${day}日`
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const en = (d: string, withYear = true): string => {
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** The date as the envelope shows it (the year only when it is not this year). */
export const openDateText = (lang: PageLang, d: string, thisYear: number): string =>
  lang === 'en' ? en(d, Number(d.slice(0, 4)) !== thisYear) : jaShort(d, thisYear)
export const fullDateText = (lang: PageLang, d: string): string => (lang === 'en' ? en(d) : ja(d))

export const GIFT_COPY: Record<PageLang, GiftCopy> = {
  ja: {
    title: '一字の贈りもの',
    loading: '読み込んでいます…',
    notFound: 'このリンクは開けませんでした。リンクをもう一度ご確認ください。',
    unavailable: '少し混み合っています。しばらくしてからもう一度お試しください。',
    preparing: '映像を準備しています',
    deferred: '映像は明日お届けします',
    envLabel: '一字の贈りもの',
    envLabelMemorial: '一字の便り',
    envLine: 'あなただけに届いた、一字の贈りもの',
    envLineCelebrate: 'おめでとう。あなただけに届いた、一字の贈りもの',
    envLineThanks: 'ありがとうを込めて。あなただけに届いた、一字の贈りもの',
    envLineMemorial: 'あなたに届いた、一字の便り',
    to: (n) => (n ? `${n}へ` : ''),
    from: (n) => (n ? `${n}より` : ''),
    open: '封を開く',
    opensOn: (d) => `${d}に開きます`,
    daysLeft: (n) => `あと${n}日。その日まで、封は閉じたままです。`,
    arriving: 'まもなく届きます',
    gone: 'この贈りものは、現在ご覧いただけません。',
    previewNote: 'あなたは贈り主として、相手に届くとおりに見ています。',
    letterLead: (n) => (n ? `${n}さんの目に映る、あなたを一字にしました。まずは、ふたりの物語から。` : 'あなたを一字にしました。まずは、ふたりの物語から。'),
    letterLeadMemorial: (n) => (n ? `${n}さんの目に映る、あなたを一字にしました。まずは、ふたりの物語から。` : 'あなたを一字にしました。まずは、ふたりの物語から。'),
    letterButton: '物語を見る',
    revealGold: (n) => (n ? `${n}さんの目に映る、あなた。` : ''),
    poemButton: '詩を読む',
    poemLabel: 'この字に添えられた詩',
    certButton: '証を見る',
    certTitle: (no) => (no ? `一字礼　第 ${no} 号` : '一字礼'),
    certTo: (n) => (n ? `${n} 様` : ''),
    certLine: (n) => (n ? `この一字は、${n}さんの目に映る、あなたです。` : ''),
    certFrom: (n) => (n ? `贈り主　${n}` : ''),
    certDate: (d) => d,
    certTagline: 'DESIGNED IN TOKYO · 世界にひとつの一字',
    certNext: '受け取ったものを見る',
    keepTitle: '手元に残す',
    saveScroll: '物語絵巻を保存',
    savePng: '画像（PNG）',
    savePdf: 'PDF',
    replyTitle: 'ありがとうを返す',
    replyPlaceholder: '一言、届けませんか（200字まで）',
    replySending: '届けています…',
    replySend: '届ける',
    replySent: (n) => (n ? `${n}さんに届けました。` : '届けました。'),
    replyError: '届けられませんでした。もう一度お試しください。',
    replyLeft: (n) => `あと${n}字`,
    next: '次へ',
    replay: 'もう一度見る',
    credits: 'クレジット',
    creditLine: '',
  },
  'zh-Hant': {
    title: '一個字的禮物',
    loading: '載入中…',
    notFound: '這個連結無法開啟，請再確認一次連結。',
    unavailable: '目前有點擁擠，請稍後再試一次。',
    preparing: '正在準備影片',
    deferred: '影片將於明天送達',
    envLabel: '一個字的禮物',
    envLabelMemorial: '一個字的來信',
    envLine: '只為你送達的，一個字的禮物',
    envLineCelebrate: '恭喜。只為你送達的，一個字的禮物',
    envLineThanks: '謝謝你。只為你送達的，一個字的禮物',
    envLineMemorial: '送到你手上的，一個字的來信',
    to: (n) => (n ? `致 ${n}` : ''),
    from: (n) => (n ? `${n} 敬上` : ''),
    open: '拆開信封',
    opensOn: (d) => `${d}開啟`,
    daysLeft: (n) => `還有 ${n} 天。在那天之前，信封會一直封著。`,
    arriving: '即將送達',
    gone: '這份禮物目前無法查看。',
    previewNote: '你以贈送者的身分，看到的就是對方會看到的樣子。',
    letterLead: (n) => (n ? `把${n}眼中的你，化成了一個字。先從你們兩人的故事開始。` : '把你化成了一個字。先從你們兩人的故事開始。'),
    letterLeadMemorial: (n) => (n ? `把${n}眼中的你，化成了一個字。先從你們兩人的故事開始。` : '把你化成了一個字。先從你們兩人的故事開始。'),
    letterButton: '看故事',
    revealGold: (n) => (n ? `${n}眼中的你。` : ''),
    poemButton: '讀詩',
    poemLabel: '與這個字一起的詩',
    certButton: '看證書',
    certTitle: (no) => (no ? `一字禮　第 ${no} 號` : '一字禮'),
    certTo: (n) => (n ? `${n} 先生／女士` : ''),
    certLine: (n) => (n ? `這個字，是${n}眼中的你。` : ''),
    certFrom: (n) => (n ? `贈予者　${n}` : ''),
    certDate: (d) => d,
    certTagline: 'DESIGNED IN TOKYO · 世上獨一無二的一個字',
    certNext: '看收到的東西',
    keepTitle: '留在身邊',
    saveScroll: '儲存故事長卷',
    savePng: '圖片（PNG）',
    savePdf: 'PDF',
    replyTitle: '回一聲謝謝',
    replyPlaceholder: '想說的一句話（200 字以內）',
    replySending: '傳送中…',
    replySend: '傳達',
    replySent: (n) => (n ? `已傳達給${n}。` : '已傳達。'),
    replyError: '無法傳達，請再試一次。',
    replyLeft: (n) => `還可輸入 ${n} 字`,
    next: '下一步',
    replay: '再看一次',
    credits: '版權與致謝',
    creditLine: '',
  },
  en: {
    title: 'A gift of one character',
    loading: 'Loading…',
    notFound: 'This link could not be opened. Please check the link again.',
    unavailable: 'It is a little busy right now. Please try again in a moment.',
    preparing: 'Preparing your film',
    deferred: 'Your film will arrive tomorrow',
    envLabel: 'A gift of one character',
    envLabelMemorial: 'A letter of one character',
    envLine: 'A gift of one character, arrived for you alone',
    envLineCelebrate: 'Congratulations. A gift of one character, arrived for you alone',
    envLineThanks: 'With thanks. A gift of one character, arrived for you alone',
    envLineMemorial: 'A letter of one character, arrived for you',
    to: (n) => (n ? `To ${n}` : ''),
    from: (n) => (n ? `From ${n}` : ''),
    open: 'Open the envelope',
    opensOn: (d) => `Opens on ${d}`,
    daysLeft: (n) => `${n} ${n === 1 ? 'day' : 'days'} to go. The envelope stays sealed until then.`,
    arriving: 'Arriving soon',
    gone: 'This gift is no longer available.',
    previewNote: 'You are the sender, seeing it exactly as they will.',
    letterLead: (n) => (n ? `This is you, as ${n} sees you, made into one character. First, the story of the two of you.` : 'This is you, made into one character. First, the story of the two of you.'),
    letterLeadMemorial: (n) => (n ? `This is you, as ${n} sees you, made into one character. First, the story of the two of you.` : 'This is you, made into one character. First, the story of the two of you.'),
    letterButton: 'See the story',
    revealGold: (n) => (n ? `You, as ${n} sees you.` : ''),
    poemButton: 'Read the poem',
    poemLabel: 'The poem that comes with it',
    certButton: 'See the certificate',
    certTitle: (no) => (no ? `ICHIREI · No. ${no}` : 'ICHIREI'),
    certTo: (n) => (n ? `For ${n}` : ''),
    certLine: (n) => (n ? `This character is you, as ${n} sees you.` : ''),
    certFrom: (n) => (n ? `From ${n}` : ''),
    certDate: (d) => d,
    certTagline: 'DESIGNED IN TOKYO · One character, only yours',
    certNext: 'See what you have received',
    keepTitle: 'Keep it',
    saveScroll: 'Save the story scroll',
    savePng: 'Image (PNG)',
    savePdf: 'PDF',
    replyTitle: 'Say thank you',
    replyPlaceholder: 'A few words back (up to 200 characters)',
    replySending: 'Sending…',
    replySend: 'Send',
    replySent: (n) => (n ? `Sent to ${n}.` : 'Sent.'),
    replyError: 'It could not be sent. Please try again.',
    replyLeft: (n) => `${n} left`,
    next: 'Next',
    replay: 'Watch again',
    credits: 'Credits',
    creditLine: '',
  },
}
