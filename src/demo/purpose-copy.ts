// v9.6: the copy of the new form groups, in the four languages the page speaks (ja, zh-Hans, zh-Hant, en): the relationship chip 「その他」, WHY the gift is given
// (replaces the old 場面 chips) and, optionally, where the two stand now. Every group ends with 「その他」 and a short free text. Rules: docs/ICHIREI_Relationship_Emotion_Map.md.

import type { PurposeCode, StateCode, UiLanguage } from './i18n.ts'

export interface PurposeCopy {
  other: string
  relationshipOtherPlaceholder: string
  purposeLabel: string
  purposes: Record<PurposeCode, string>
  purposeOtherPlaceholder: string
  purposeMissing: string
  stateLabel: string
  states: Record<StateCode, string>
  stateOtherPlaceholder: string
  /** Shown beside a free-text field: how many characters are left. */
  limit: (max: number) => string
}

export const PURPOSE_COPY: Record<UiLanguage, PurposeCopy> = {
  ja: {
    other: 'その他',
    relationshipOtherPlaceholder: '例：幼なじみ、元同僚',
    purposeLabel: '贈る理由',
    purposes: {
      celebrate: 'お祝い（誕生日・還暦・結婚・出産・入学など）',
      thanks: 'ありがとう',
      apology: 'ごめんね・仲直り',
      encourage: '応援・お見舞い',
      farewell: '門出・送別（退職・引っ越し・卒業）',
      reconnect: 'ご無沙汰・再会',
      confess: '想いを伝える（ずっと言えなかったこと）',
      memorial: '偲ぶ',
      other: 'その他',
    },
    purposeOtherPlaceholder: '例：幼なじみの誕生日、喧嘩した兄へ',
    purposeMissing: '贈る理由を選んでください。',
    stateLabel: '今のふたりは（任意）',
    states: { close: 'いつも近く', apart: '離れて暮らす', lapsed: 'しばらく会っていない', strained: 'すれ違ったまま', lost: 'もう会えない', other: 'その他' },
    stateOtherPlaceholder: '例：連絡は取っている',
    limit: (max) => `${max}字まで`,
  },
  'zh-Hant': {
    other: '其他',
    relationshipOtherPlaceholder: '例如：青梅竹馬、前同事',
    purposeLabel: '送禮的理由',
    purposes: {
      celebrate: '祝福（生日・六十大壽・結婚・出生・入學等）',
      thanks: '謝謝',
      apology: '道歉・和好',
      encourage: '加油・探望',
      farewell: '送別・新旅程（退休・搬家・畢業）',
      reconnect: '久違・重逢',
      confess: '傳達心意（一直沒說出口的話）',
      memorial: '追思',
      other: '其他',
    },
    purposeOtherPlaceholder: '例如：青梅竹馬的生日、吵架的哥哥',
    purposeMissing: '請選擇送禮的理由。',
    stateLabel: '現在的兩人（選填）',
    states: { close: '常在身邊', apart: '分隔兩地', lapsed: '很久沒見', strained: '還有心結', lost: '已無法相見', other: '其他' },
    stateOtherPlaceholder: '例如：還有聯絡',
    limit: (max) => `最多${max}字`,
  },
  'zh-Hans': {
    other: '其他',
    relationshipOtherPlaceholder: '例如：青梅竹马、前同事',
    purposeLabel: '送礼的理由',
    purposes: {
      celebrate: '祝福（生日・六十大寿・结婚・出生・入学等）',
      thanks: '谢谢',
      apology: '道歉・和好',
      encourage: '加油・探望',
      farewell: '送别・新旅程（退休・搬家・毕业）',
      reconnect: '久违・重逢',
      confess: '传达心意（一直没说出口的话）',
      memorial: '追思',
      other: '其他',
    },
    purposeOtherPlaceholder: '例如：青梅竹马的生日、吵架的哥哥',
    purposeMissing: '请选择送礼的理由。',
    stateLabel: '现在的两人（选填）',
    states: { close: '常在身边', apart: '分隔两地', lapsed: '很久没见', strained: '还有心结', lost: '已无法相见', other: '其他' },
    stateOtherPlaceholder: '例如：还有联系',
    limit: (max) => `最多${max}字`,
  },
  en: {
    other: 'Other',
    relationshipOtherPlaceholder: 'e.g. childhood friend, former colleague',
    purposeLabel: "Why you're giving",
    purposes: {
      celebrate: 'Celebrate (birthday, 60th, wedding, birth, school…)',
      thanks: 'Thank you',
      apology: 'Sorry / making up',
      encourage: 'Encourage / get well',
      farewell: 'Farewell / new start (retiring, moving, graduating)',
      reconnect: 'Keep in touch / meeting again',
      confess: 'Say it at last (what was never said)',
      memorial: 'In memory',
      other: 'Other',
    },
    purposeOtherPlaceholder: "e.g. an old friend's birthday, my brother after a fight",
    purposeMissing: "Please choose why you're giving.",
    stateLabel: 'Where the two of you stand now (optional)',
    states: { close: 'Close', apart: 'Living apart', lapsed: "Haven't met in a while", strained: 'Something unresolved', lost: 'No longer here', other: 'Other' },
    stateOtherPlaceholder: 'e.g. we still write',
    limit: (max) => `up to ${max} characters`,
  },
}
