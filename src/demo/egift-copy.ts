// While the wooden sizes are "coming soon" the only gift is the e-gift, and nothing on the page may promise carving, printing or posting (2026-11-07). The order step and the card screen read the
// same `Copy` as always; this swaps in the e-gift wording for the few lines that speak of the carved form, the delivery date and the shipping. When the wooden sizes go on sale the original wording is back.

import type { Copy, UiLanguage } from './i18n.ts'

const LABEL: Record<UiLanguage, string> = { ja: '字体', 'zh-Hans': '字体', 'zh-Hant': '字體', en: 'Character form' }
const SAME_JA = 'この字は、現代の字体（新字体）で表示します。'
const SAME_EN = 'This character is shown in its modern Japanese form.'

/** The same Copy with the carved-form and shipping lines in their e-gift form. The Chinese 「刻字：…」 notes keep their content and lose the word 刻字. */
export function egiftCopy(copy: Copy, language: UiLanguage): Copy {
  const zhWord = language === 'zh-Hans' ? '字体' : '字體'
  const word = (s: string | null): string | null => (s === null ? null : s.replace(/^刻字/, zhWord))
  return {
    ...copy,
    inscriptionScriptLabel: LABEL[language],
    inscriptionNote: (c, script) => word(copy.inscriptionNote(c, script)),
    previewNote: (c, script) => word(copy.previewNote(c, script)),
    order: {
      ...copy.order,
      inscriptionLabel: LABEL[language],
      inscriptionSame: language === 'ja' ? SAME_JA : language === 'en' ? SAME_EN : copy.order.inscriptionSame,
      shippingNote: '',
    },
  }
}
