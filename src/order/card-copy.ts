// The words of the receiver's reveal that the card image (engine/render/card-image.ts) and the link picture (engine/render/og.ts) draw on the server (Ticket 10, 2026-11-26). They are the same
// words the ceremony prints (src/gift/ceremony/copy.ts: meaningYou / meaningOld, markLabel / markTitle / markBody) — kept here because the server may only import from src/order; a test compares the two.

export type CardLang = 'en' | 'ja' | 'zh-Hant' | 'zh-Hans'
export const cardLang = (language: string | null | undefined): CardLang => (language === 'ja' ? 'ja' : language === 'zh-Hant' ? 'zh-Hant' : language === 'zh-Hans' ? 'zh-Hans' : 'en')

const s = (v: string | null | undefined): string => (v ?? '').trim()

/** The heading above the word: "In Brian's eyes, you are" (English, with the receiver's line or a word chosen to finish it) / the old "In Brian's eyes" (an English gift made before) / the Japanese and Chinese line. */
export const cardHeading = (language: string, from: string, youForm: boolean): string => {
  const f = s(from)
  switch (cardLang(language)) {
    case 'ja':
      return f ? `${f}さんの目に映る、あなた` : 'この贈りものに映る、あなた'
    case 'zh-Hant':
      return f ? `在${f}眼中的你` : '在這份禮物眼中的你'
    case 'zh-Hans':
      return f ? `在${f}眼中的你` : '在这份礼物眼中的你'
    default:
      return youForm ? (f ? `In ${f}'s eyes, you are` : 'Seen through this gift, you are') : f ? `In ${f}'s eyes` : 'Seen through this gift'
  }
}

/** The envelope stage ("the mark"): the label above the title, the two title lines, the body. */
export const markCopy = (language: string, from: string, to: string): { label: string; title: [string, string]; body: string } => {
  const f = s(from)
  const t = s(to)
  switch (cardLang(language)) {
    case 'ja':
      return { label: t ? `${t}さんへ` : '', title: f ? [`${f}さんから、`, '小さな印がひとつ届きました。'] : ['小さな印がひとつ、', '届きました。'], body: 'ページにあるのは、これだけです。触れて、近くで見てください。' }
    case 'zh-Hant':
      return { label: t ? `給${t}` : '', title: f ? [`${f}送給你`, '一枚小小的印。'] : ['有人送給你', '一枚小小的印。'], body: '頁面上只有它。輕觸它，靠近看看。' }
    case 'zh-Hans':
      return { label: t ? `给${t}` : '', title: f ? [`${f}送给你`, '一枚小小的印。'] : ['有人送给你', '一枚小小的印。'], body: '页面上只有它。轻触它，靠近看看。' }
    default:
      return { label: t ? `For ${t}` : '', title: f ? [`${f} sent you`, 'one small mark.'] : ['Someone sent you', 'one small mark.'], body: 'It is all there is on the page. Touch it, and look closer.' }
  }
}
