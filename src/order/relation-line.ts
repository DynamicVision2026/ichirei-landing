// The one line that opens the shared film and sits on top of the shared poem card (2026-11-06): the RELATIONSHIP chip only — "For Mom", never a name, a story or the free
// text of 「その他」. Zh-Hans is not needed here (customer pages are ja / zh-Hant / en; a zh-Hans order reads as zh-Hant). Anything not on the list (「その他」, none) gives no line.

import type { Relationship } from './purpose.ts'

export type ShareLang = 'ja' | 'zh-Hant' | 'en'

export const RELATION_LINE: Record<Relationship, Record<ShareLang, string>> = {
  parent_mother: { ja: '母へ', 'zh-Hant': '給媽媽', en: 'For Mom' },
  parent_father: { ja: '父へ', 'zh-Hant': '給爸爸', en: 'For Dad' },
  child: { ja: 'わが子へ', 'zh-Hant': '給孩子', en: 'For my child' },
  grandparent: { ja: '祖父母へ', 'zh-Hant': '給祖父母', en: 'For Grandma or Grandpa' },
  spouse: { ja: 'パートナーへ', 'zh-Hant': '給另一半', en: 'For my partner' },
  romance: { ja: '大切な人へ', 'zh-Hant': '給我愛的人', en: 'For someone I love' },
  sibling: { ja: 'きょうだいへ', 'zh-Hant': '給兄弟姊妹', en: 'For my sibling' },
  friend: { ja: '友へ', 'zh-Hant': '給朋友', en: 'For a friend' },
  work: { ja: '仕事の仲間へ', 'zh-Hant': '給工作夥伴', en: 'For a colleague' },
  pet: { ja: 'うちの子へ', 'zh-Hant': '給毛孩', en: 'For my pet' },
  in_law: { ja: '家族へ', 'zh-Hant': '給家人', en: 'For family' },
  mentor: { ja: '恩師へ', 'zh-Hant': '給恩師', en: 'For my teacher' },
  community: { ja: '仲間へ', 'zh-Hant': '給夥伴', en: 'For someone in my circle' },
  caregiver: { ja: '支えてくれた人へ', 'zh-Hant': '給照顧我的人', en: 'For the one who cared for me' },
}

export function relationLine(relationship: string | null | undefined, language: string): string | null {
  const row = (RELATION_LINE as Record<string, Record<ShareLang, string>>)[relationship ?? '']
  if (!row) return null
  return row[language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh-Hant']
}
