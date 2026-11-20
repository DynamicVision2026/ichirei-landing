// The free gift back on the writing page and the order step (Part 14, 2026-11-20). zh-Hans is the zh-Hant text converted with OpenCC (checked in test-reply.ts).

import type { UiLanguage } from './i18n.ts'

export interface ReplyCopy {
  /** The order step: the price line and its tag, the one field, the button. */
  price: string
  tag: string
  emailLabel: string
  emailNote: string
  submit: string
  submitting: string
  /** Under the cards: a gift back has one round only. */
  roundNote: string
  /** The writing page when the ticket is not good any more (the calm lines; the server's own words for the order step). */
  invalid: string
  used: string
  off: string
  /** One line above the writing box: who it goes to. */
  banner: (to: string) => string
}

const HANT: ReplyCopy = {
  price: '¥0',
  tag: '回贈・免費',
  emailLabel: '你的電子郵件地址',
  emailNote: '電子郵件用於「我的禮物」和確認這次回贈，不會顯示給對方。',
  submit: '免費回贈',
  submitting: '正在送出…',
  roundNote: '回贈只有一次選字',
  invalid: '這個回贈已經無法使用。',
  used: '你們之間的回贈已經用過了。',
  off: '回贈目前暫停。',
  banner: (to) => (to.trim() ? `回贈給${to.trim()}：寫下一個片刻。` : '回贈：寫下一個片刻。'),
}

export const REPLY_COPY: Record<UiLanguage, ReplyCopy> = {
  ja: {
    price: '¥0',
    tag: '贈り返し・無料',
    emailLabel: 'あなたのメールアドレス',
    emailNote: 'メールは「マイギフト」と、この贈り返しの確認に使います。お相手には表示されません。',
    submit: '無料で贈り返す',
    submitting: '送っています…',
    roundNote: '贈り返しは1回の選出です',
    invalid: 'この贈り返しは、もう使えません。',
    used: 'このおふたりの贈り返しは、すでに使われています。',
    off: '贈り返しは、いまお休みしています。',
    banner: (to) => (to.trim() ? `${to.trim()}さんへの贈り返し：ひと場面を書いてください。` : '贈り返し：ひと場面を書いてください。'),
  },
  en: {
    price: '$0',
    tag: 'Gift back · free',
    emailLabel: 'Your email address',
    emailNote: 'Your email is used for My gifts and to confirm this gift back. It is never shown to them.',
    submit: 'Send it back, free',
    submitting: 'Sending…',
    roundNote: 'A gift back has one round of characters',
    invalid: 'This gift back can no longer be used.',
    used: 'The gift back between you two has already been used.',
    off: 'Sending a gift back is paused right now.',
    banner: (to) => (to.trim() ? `A gift back for ${to.trim()}: write one moment.` : 'A gift back: write one moment.'),
  },
  'zh-Hant': HANT,
  'zh-Hans': {
    price: '¥0',
    tag: '回赠・免费',
    emailLabel: '你的电子邮件地址',
    emailNote: '电子邮件用于「我的礼物」和确认这次回赠，不会显示给对方。',
    submit: '免费回赠',
    submitting: '正在送出…',
    roundNote: '回赠只有一次选字',
    invalid: '这个回赠已经无法使用。',
    used: '你们之间的回赠已经用过了。',
    off: '回赠目前暂停。',
    banner: (to) => (to.trim() ? `回赠给${to.trim()}：写下一个片刻。` : '回赠：写下一个片刻。'),
  },
}
