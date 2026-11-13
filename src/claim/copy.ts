// The words of /claim (2026-11-13) — the page for an order that was paid WITHOUT going through our site (a store page, a ChatGPT checkout): the buyer gives the order number and the
// e-mail used at checkout, then writes the story and chooses the character; the character is attached to that paid order (nothing more to pay). Plain TS, no imports beyond a type, so
// Node tests can load it. The ja / zh-Hant / en labels and the "not found" sentences are the owner's; zh-Hans is the zh-Hant text through OpenCC (never typed by hand).

import type { UiLanguage } from '../demo/i18n.ts'

export interface ClaimCopy {
  documentTitle: string
  heading: string
  intro: string
  orderLabel: string
  orderPlaceholder: string
  emailLabel: string
  submit: string
  submitting: string
  errors: { notFound: string; rateLimited: string; network: string }
  /** A thin line over the flow while a claim is open ("{order}" = the order number). */
  banner: string
  /** On the order step: nothing to pay. */
  note: string
  /** The order step's button (it makes the gift; it does not go to checkout). */
  make: string
}

export const CLAIM_COPY: Record<UiLanguage, ClaimCopy> = {
  ja: {
    documentTitle: '贈りものを作る｜一字礼',
    heading: '贈りものを作る',
    intro: 'ご注文はお預かりしています。物語を書いて、字を選んでください。お支払いはすでに済んでいますので、このあとのお支払いはありません。',
    orderLabel: 'ご注文番号',
    orderPlaceholder: '例：#1016',
    emailLabel: 'ご注文時のメールアドレス',
    submit: '次へ',
    submitting: '確認しています…',
    errors: {
      notFound: 'ご注文が見つかりません。番号とメールアドレスをご確認ください。',
      rateLimited: '試行回数が多すぎます。1時間ほどあけて、もう一度お試しください。',
      network: '通信に失敗しました。もう一度お試しください。',
    },
    banner: 'ご注文 {order}：お支払い済みです。物語を書いて、字を選んでください。',
    note: 'お支払いは済んでいます。追加のお支払いはありません。字を選ぶと、贈りものができあがります。',
    make: '贈りものを作る',
  },
  'zh-Hant': {
    documentTitle: '製作你的禮物｜一字禮',
    heading: '製作你的禮物',
    intro: '你的訂單已經收到。請寫下故事、選出那個字。款項已經付清，之後不會再收費。',
    orderLabel: '訂單編號',
    orderPlaceholder: '例如：#1016',
    emailLabel: '下單時的電子郵件',
    submit: '下一步',
    submitting: '確認中…',
    errors: { notFound: '找不到訂單，請確認訂單編號與電子郵件。', rateLimited: '嘗試次數過多，請一小時後再試。', network: '連線失敗，請再試一次。' },
    banner: '訂單 {order}：款項已付清。請寫下故事、選出那個字。',
    note: '款項已經付清，不會再收費。選好字，你的禮物就會製作完成。',
    make: '製作禮物',
  },
  'zh-Hans': {
    documentTitle: '制作你的礼物｜一字礼',
    heading: '制作你的礼物',
    intro: '你的订单已经收到。请写下故事、选出那个字。款项已经付清，之后不会再收费。',
    orderLabel: '订单编号',
    orderPlaceholder: '例如：#1016',
    emailLabel: '下单时的电子邮件',
    submit: '下一步',
    submitting: '确认中…',
    errors: { notFound: '找不到订单，请确认订单编号与电子邮件。', rateLimited: '尝试次数过多，请一小时后再试。', network: '连接失败，请再试一次。' },
    banner: '订单 {order}：款项已付清。请写下故事、选出那个字。',
    note: '款项已经付清，不会再收费。选好字，你的礼物就会制作完成。',
    make: '制作礼物',
  },
  en: {
    documentTitle: 'Make your gift | ICHIREI',
    heading: 'Make your gift',
    intro: 'We have your order. Write your story and choose the character. You have already paid, so there is nothing more to pay.',
    orderLabel: 'Order number',
    orderPlaceholder: 'e.g. #1016',
    emailLabel: 'Email used at checkout',
    submit: 'Continue',
    submitting: 'Checking…',
    errors: {
      notFound: "We couldn't find that order. Please check the number and email.",
      rateLimited: 'Too many tries. Please wait an hour and try again.',
      network: "Couldn't connect. Please try again.",
    },
    banner: 'Order {order}: paid. Write your story and choose the character.',
    note: 'You have already paid. There is nothing more to pay. Choose the character and your gift will be made.',
    make: 'Make my gift',
  },
}

/** "?o=%231016" or "?o=1016" → "#1016" (what the e-mail link carries; anything else → ""). */
export const orderFromSearch = (search: string): string => {
  const v = new URLSearchParams(search).get('o') ?? ''
  const m = /^#?(\d{1,9})$/.exec(v.trim())
  return m ? `#${m[1]}` : ''
}
