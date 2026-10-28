// The few words around the film (the film itself speaks in the customer's own words). Three languages; zh-Hans reads as zh-Hant here
// (the page is only ever opened for zh-Hant / ja / en orders; a zh-Hans order falls back to the Traditional wording).

export type PageLang = 'ja' | 'zh-Hant' | 'en'

export type OrderLanguage = 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'

export const pageLang = (l: OrderLanguage): PageLang => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : 'zh-Hant')

export interface PageCopy {
  title: string
  loading: string
  notFound: string
  unavailable: string
  replay: string
  share: string
  copied: string
  credits: string
  reducedNote: string
  playAnyway: string
  sealText: string[]
  quote: [string, string]
  alt: string
  /** The quiet screen while the film's script is still being written. */
  preparing: string
  /** The daily picture limit was reached: the pictures come the next day. */
  deferred: string
  play: string
  pause: string
}

export const COPY: Record<PageLang, PageCopy> = {
  ja: {
    title: '一字礼 — あなたの物語',
    loading: '読み込んでいます…',
    notFound: 'このリンクは開けませんでした。リンクをもう一度ご確認ください。',
    unavailable: '少し混み合っています。しばらくしてからもう一度お試しください。',
    replay: 'もう一度見る',
    share: '共有する',
    copied: 'リンクをコピーしました',
    credits: 'クレジット',
    reducedNote: '動きを減らす設定のため、静止画で表示しています。',
    playAnyway: 'アニメーションを再生する',
    sealText: ['一', '字', '礼'],
    quote: ['「', '」'],
    alt: 'あなたの物語の映像。最後に一字が現れます',
    preparing: '映像を準備しています',
    deferred: '映像は明日お届けします',
    play: '再生',
    pause: '一時停止',
  },
  'zh-Hant': {
    title: '一字禮 — 你的故事',
    loading: '載入中…',
    notFound: '這個連結無法開啟，請再確認一次連結。',
    unavailable: '目前有點擁擠，請稍後再試一次。',
    replay: '再看一次',
    share: '分享',
    copied: '已複製連結',
    credits: '版權與致謝',
    reducedNote: '因為你設定了減少動態效果，這裡顯示為靜態畫面。',
    playAnyway: '播放動畫',
    sealText: ['一', '字', '禮'],
    quote: ['「', '」'],
    alt: '你的故事的影片，最後出現那一個字',
    preparing: '正在準備影片',
    deferred: '影片將於明天送達',
    play: '播放',
    pause: '暫停',
  },
  en: {
    title: 'ICHIREI — your story',
    loading: 'Loading…',
    notFound: 'This link could not be opened. Please check the link again.',
    unavailable: 'It is a little busy right now. Please try again in a moment.',
    replay: 'Watch again',
    share: 'Share',
    copied: 'Link copied',
    credits: 'Credits',
    reducedNote: 'Shown as a still because your device asks for reduced motion.',
    playAnyway: 'Play the animation',
    sealText: ['一', '字', '礼'],
    quote: ['“', '”'],
    alt: 'A film of your story; the character appears at the end',
    preparing: 'Preparing your film',
    deferred: 'Your film will arrive tomorrow',
    play: 'Play',
    pause: 'Pause',
  },
}
