// The three sizes and the three ways to send (2026-10-31): names, what each size includes, shipping, the badges and the ship-to choice.
// 一字礼 eギフト · 木札 (Simple) · 版木 (Standard). The story, character, poem, film and story pictures are the same in all of them.
// Wording follows the claims rules (Part F): "wooden tag", "gold colour", no hand-made claim. Native reviewers check these before launch.

import type { PackageId, ShipTo } from '../order/packages.ts'
import type { UiLanguage } from './i18n.ts'

export interface SizeCopy {
  names: Record<PackageId, string>
  /** One line each: what the size includes. */
  includes: Record<PackageId, string>
  /** Remembrance: the same, with the character in ink black and no red-and-white cord. */
  includesMemorial: Record<PackageId, string>
  ship: Record<PackageId, string>
  recommended: string
  sendNow: string
  shipTo: { label: string } & Record<ShipTo, { label: string; note: string }>
  /** Remembrance: nothing is "given" — the same three ways, without gift wording. */
  shipToMemorial: { label: string } & Record<ShipTo, { label: string; note: string }>
  /** E-gift: the sender's e-mail, for the one reminder if the receiver has not entered an address after 7 days. */
  emailLabel: string
  emailNote: string
  messageLabel: string
  messagePlaceholder: string
  messageCounter: (n: number, max: number) => string
  /** E-gift of a wooden size is Japan only at launch. */
  egiftJapanOnly: string
  /** Shown under the sizes when remembrance is chosen. */
  memorialNote: string
  /** Shown for the e-gift: nothing is sent by post — it is sent as a link, and opens when the sender says. */
  egiftNote: string
  egiftNoteMemorial: string
}

const ja: SizeCopy = {
  names: { egift: '一字礼 eギフト', simple: '木札（シンプル）', standard: '版木（スタンダード）' },
  includes: {
    egift: 'すべてのデジタルギフト（開封の演出・物語の映像・字の頁・詩・証・物語絵巻）＋ご自宅で印刷できるカードPDF',
    simple: 'eギフトのすべて＋印刷した物語カード＋木札に一字（金色）・水引・ギフトボックス',
    standard: 'eギフトのすべて＋印刷した物語カード＋一字を刻んだ版木・拓本セット（墨・たんぽ・和紙）・布の袋',
  },
  includesMemorial: {
    egift: 'すべてのデジタルギフト（静かな開封・物語の映像・字の頁・詩・証・物語絵巻）＋ご自宅で印刷できるカードPDF（墨色の一字）',
    simple: 'eギフトのすべて＋印刷した物語カード＋木札に一字（墨色）・無地の紐・ギフトボックス',
    standard: 'eギフトのすべて＋印刷した物語カード＋一字を刻んだ版木・拓本セット（墨・たんぽ・和紙）・布の袋',
  },
  ship: { egift: '送料なし（リンクでお届け）', simple: '日本国内送料無料・海外は EMS ¥6,000', standard: '日本国内送料無料・海外は EMS ¥6,000' },
  recommended: 'おすすめ',
  sendNow: '今すぐ贈れる',
  shipTo: {
    label: 'どこへ届けますか',
    me: { label: '自分に届ける', note: 'あなたが手渡しします。カードの「＿＿さんへ」「＿＿より」は空白のまま、手書きできます。' },
    direct: { label: '相手に直接届ける', note: 'チェックアウトの配送先に、相手の住所を入れてください。お名前とひと言をカードに印刷し、価格明細は入れず、ギフト包装でお届けします。' },
    egift: { label: 'eギフトで贈る（住所は相手が入力）', note: '相手にリンクを送ります。受け取る方が自分で住所を入力します。お名前とひと言はカードに印刷されます。' },
  },
  shipToMemorial: {
    label: 'どこへ届けますか',
    me: { label: '自分に届ける', note: 'あなたが手渡しします。カードの「＿＿さんへ」「＿＿より」は空白のまま、手書きできます。' },
    direct: { label: 'ご家族などに直接届ける', note: 'チェックアウトの配送先に、お届け先の住所を入れてください。お名前とひと言をカードに印刷し、価格明細は入れず、無地の包装でお届けします。' },
    egift: { label: 'リンクで届ける（住所は受け取る方が入力）', note: '受け取る方にリンクを送ります。住所は受け取る方が自分で入力します。お名前とひと言はカードに印刷されます。' },
  },
  emailLabel: 'あなたのメールアドレス',
  emailNote: '相手が7日たっても住所を入力しない場合に、一度だけお知らせします。それ以外には使いません。',
  messageLabel: 'カードのひと言（任意・60字まで）',
  messagePlaceholder: '例：いつも、ありがとう。',
  messageCounter: (n, max) => `${n} / ${max}字`,
  egiftJapanOnly: '木札・版木のeギフトは、日本国内のみです。',
  memorialNote: '偲ぶ場合も、すべてのサイズをお選びいただけます。字は墨色で、紅白の水引・赤い印は使いません。',
  egiftNote: 'eギフトは郵送されません。リンクで贈ります。開封日を指定することもできます。',
  egiftNoteMemorial: 'eギフトは郵送されません。リンクでお届けします。',
}

const en: SizeCopy = {
  names: { egift: 'ICHIREI e-gift', simple: 'Wooden tag (Simple)', standard: 'Block set (Standard)' },
  includes: {
    egift: 'The whole digital gift (the opening, the film of their story, the character page, the poem, the certificate, the story scroll) + the card as a PDF to print at home',
    simple: 'Everything in the e-gift + a printed story card + a wooden tag with the character in gold colour, mizuhiki cord and gift box',
    standard: 'Everything in the e-gift + a printed story card + a wooden block with the character, a rubbing set (ink, tampo, washi) and a cloth pouch',
  },
  includesMemorial: {
    egift: 'The whole digital gift (a quiet opening, the film, the character page, the poem, the certificate, the story scroll) + the card as a PDF to print at home, the character in ink black',
    simple: 'Everything in the e-gift + a printed story card + a wooden tag with the character in ink black, a plain cord and gift box',
    standard: 'Everything in the e-gift + a printed story card + a wooden block with the character, a rubbing set (ink, tampo, washi) and a cloth pouch',
  },
  ship: { egift: 'No shipping (sent as a link)', simple: 'Free in Japan · overseas EMS ¥6,000', standard: 'Free in Japan · overseas EMS ¥6,000' },
  recommended: 'Recommended',
  sendNow: 'Send it now',
  shipTo: {
    label: 'Where should it go?',
    me: { label: 'Send to me', note: 'You hand it over. The card’s “To ___” and “From ___” lines stay blank, for you to fill in with a pen.' },
    direct: { label: 'Send directly to them', note: 'Enter their address as the shipping address at checkout. Their name, yours and a short message are printed on the card, with no price slip and gift packaging.' },
    egift: { label: 'Send as an e-gift (they enter the address)', note: 'We give you a link for them. They enter their own address. The names and the short message are printed on the card.' },
  },
  shipToMemorial: {
    label: 'Where should it go?',
    me: { label: 'Send to me', note: 'You hand it over. The card’s “To ___” and “From ___” lines stay blank, for you to fill in with a pen.' },
    direct: { label: 'Send directly to the family', note: 'Enter their address as the shipping address at checkout. The names and a short message are printed on the card, with no price slip and plain wrapping.' },
    egift: { label: 'Send by link (they enter the address)', note: 'We give you a link to pass on. They enter their own address. The names and the short message are printed on the card.' },
  },
  emailLabel: 'Your e-mail address',
  emailNote: 'Used only to tell you once, after 7 days, if they have not entered an address yet.',
  messageLabel: 'A short message for the card (optional, up to 60 characters)',
  messagePlaceholder: 'e.g. Thank you, always.',
  messageCounter: (n, max) => `${n} / ${max}`,
  egiftJapanOnly: 'E-gift for the wooden tag and the block set is Japan only.',
  memorialNote: 'For remembrance every size is available. The character is in ink black; no red-and-white cord and no red seal.',
  egiftNote: 'The e-gift is not posted. You send it as a link, and you can fix the day it opens.',
  egiftNoteMemorial: 'The e-gift is not posted. It is sent as a link.',
}

const zhHant: SizeCopy = {
  names: { egift: '一字禮 e 禮物', simple: '木牌（簡約）', standard: '版木（標準）' },
  includes: {
    egift: '完整的數位禮物（拆封的儀式、故事影片、字的頁面、詩、證書、故事長卷）＋可在家列印的卡片 PDF',
    simple: 'e 禮物的全部內容＋印製的故事卡＋金色刻字的木牌、水引繩與禮盒',
    standard: 'e 禮物的全部內容＋印製的故事卡＋刻字版木、拓印組（墨、拓包、和紙）與布袋',
  },
  includesMemorial: {
    egift: '完整的數位禮物（安靜的拆封、故事影片、字的頁面、詩、證書、故事長卷）＋可在家列印的卡片 PDF（墨色的字）',
    simple: 'e 禮物的全部內容＋印製的故事卡＋墨色刻字的木牌、素色繩與禮盒',
    standard: 'e 禮物的全部內容＋印製的故事卡＋刻字版木、拓印組（墨、拓包、和紙）與布袋',
  },
  ship: { egift: '免運費（以連結送出）', simple: '日本國內免運費・海外 EMS ¥6,000', standard: '日本國內免運費・海外 EMS ¥6,000' },
  recommended: '推薦',
  sendNow: '馬上就能送',
  shipTo: {
    label: '要寄到哪裡？',
    me: { label: '寄給我自己', note: '由你交給對方。卡片上的「＿＿收」「＿＿贈」會留白，可以親筆寫。' },
    direct: { label: '直接寄給對方', note: '請在結帳時填入對方的地址。對方與你的名字、一句話會印在卡片上，不附價格明細，並以禮物包裝寄出。' },
    egift: { label: '以電子禮物贈送（地址由對方填寫）', note: '我們會給你一個連結傳給對方，由對方自己填寫地址。名字與一句話會印在卡片上。' },
  },
  shipToMemorial: {
    label: '要寄到哪裡？',
    me: { label: '寄給我自己', note: '由你交給對方。卡片上的「＿＿收」「＿＿贈」會留白，可以親筆寫。' },
    direct: { label: '直接寄給家人', note: '請在結帳時填入收件人的地址。名字與一句話會印在卡片上，不附價格明細，並以素色包裝寄出。' },
    egift: { label: '以連結寄送（地址由對方填寫）', note: '我們會給你一個連結傳給對方，由對方自己填寫地址。名字與一句話會印在卡片上。' },
  },
  emailLabel: '你的電子郵件',
  emailNote: '若對方 7 天後仍未填寫地址，我們只會通知你一次。不作其他用途。',
  messageLabel: '卡片上的一句話（選填，最多 60 字）',
  messagePlaceholder: '例：一直以來，謝謝你。',
  messageCounter: (n, max) => `${n} / ${max} 字`,
  egiftJapanOnly: '木牌與版木的電子禮物，僅限日本國內。',
  memorialNote: '追思時也可選擇所有尺寸。字以墨色呈現，不使用紅白水引與紅色印章。',
  egiftNote: 'e 禮物不會郵寄，以連結送出，也可以指定開封日。',
  egiftNoteMemorial: 'e 禮物不會郵寄，以連結送出。',
}

const zhHans: SizeCopy = {
  names: { egift: '一字礼 e 礼物', simple: '木牌（简约）', standard: '版木（标准）' },
  includes: {
    egift: '完整的数字礼物（拆封的仪式、故事影片、字的页面、诗、证书、故事长卷）＋可在家打印的卡片 PDF',
    simple: 'e 礼物的全部内容＋印制的故事卡＋金色刻字的木牌、水引绳与礼盒',
    standard: 'e 礼物的全部内容＋印制的故事卡＋刻字版木、拓印组（墨、拓包、和纸）与布袋',
  },
  includesMemorial: {
    egift: '完整的数字礼物（安静的拆封、故事影片、字的页面、诗、证书、故事长卷）＋可在家打印的卡片 PDF（墨色的字）',
    simple: 'e 礼物的全部内容＋印制的故事卡＋墨色刻字的木牌、素色绳与礼盒',
    standard: 'e 礼物的全部内容＋印制的故事卡＋刻字版木、拓印组（墨、拓包、和纸）与布袋',
  },
  ship: { egift: '免运费（以链接送出）', simple: '日本国内免运费・海外 EMS ¥6,000', standard: '日本国内免运费・海外 EMS ¥6,000' },
  recommended: '推荐',
  sendNow: '马上就能送',
  shipTo: {
    label: '要寄到哪里？',
    me: { label: '寄给我自己', note: '由你交给对方。卡片上的“＿＿收”“＿＿赠”会留白，可以亲笔写。' },
    direct: { label: '直接寄给对方', note: '请在结账时填入对方的地址。对方与你的名字、一句话会印在卡片上，不附价格明细，并以礼物包装寄出。' },
    egift: { label: '以电子礼物赠送（地址由对方填写）', note: '我们会给你一个链接传给对方，由对方自己填写地址。名字与一句话会印在卡片上。' },
  },
  shipToMemorial: {
    label: '要寄到哪里？',
    me: { label: '寄给我自己', note: '由你交给对方。卡片上的“＿＿收”“＿＿赠”会留白，可以亲笔写。' },
    direct: { label: '直接寄给家人', note: '请在结账时填入收件人的地址。名字与一句话会印在卡片上，不附价格明细，并以素色包装寄出。' },
    egift: { label: '以链接寄送（地址由对方填写）', note: '我们会给你一个链接传给对方，由对方自己填写地址。名字与一句话会印在卡片上。' },
  },
  emailLabel: '你的电子邮件',
  emailNote: '若对方 7 天后仍未填写地址，我们只会通知你一次。不作其他用途。',
  messageLabel: '卡片上的一句话（选填，最多 60 字）',
  messagePlaceholder: '例：一直以来，谢谢你。',
  messageCounter: (n, max) => `${n} / ${max} 字`,
  egiftJapanOnly: '木牌与版木的电子礼物，仅限日本国内。',
  memorialNote: '追思时也可选择所有尺寸。字以墨色呈现，不使用红白水引与红色印章。',
  egiftNote: 'e 礼物不会邮寄，以链接送出，也可以指定开封日。',
  egiftNoteMemorial: 'e 礼物不会邮寄，以链接送出。',
}

export const SIZE_COPY: Record<UiLanguage, SizeCopy> = { ja, en, 'zh-Hant': zhHant, 'zh-Hans': zhHans }
