// The four sizes and the three ways to send (Part C, 2026-10-30): names, what each size includes, shipping, the badges and the ship-to choice.
// ① デジタル · ② カード · ③ 木札 (Simple) · ④ 版木 (Standard). The story, character, poem, film and story pictures are the same in all of them.
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
  messageLabel: string
  messagePlaceholder: string
  messageCounter: (n: number, max: number) => string
  /** E-gift of a wooden size is Japan only at launch. */
  egiftJapanOnly: string
  /** Shown under the sizes when remembrance is chosen. */
  memorialNote: string
  /** Shown for the digital size: nothing is sent by post. */
  digitalNote: string
  digitalNoteMemorial: string
}

const ja: SizeCopy = {
  names: { digital: 'デジタル', card: 'カード', simple: '木札（シンプル）', standard: '版木（スタンダード）' },
  includes: {
    digital: 'デジタルギフト（字のページ・「合う理由」・詩・映像・物語絵巻のダウンロード）',
    card: 'デジタルギフト＋物語カード（A6二つ折り）を封筒に入れて',
    simple: 'デジタルギフト＋物語カード＋木札に一字（金色）・水引・ギフトボックス',
    standard: 'デジタルギフト＋物語カード＋一字を刻んだ版木・拓本セット（墨・たんぽ・和紙）・布の袋',
  },
  includesMemorial: {
    digital: 'デジタルギフト（字のページ・詩・映像・物語絵巻のダウンロード）',
    card: 'デジタルギフト＋物語カード（墨色の一字）を封筒に入れて',
    simple: 'デジタルギフト＋物語カード＋木札に一字（墨色）・無地の紐・ギフトボックス',
    standard: 'デジタルギフト＋物語カード＋一字を刻んだ版木・拓本セット（墨・たんぽ・和紙）・布の袋',
  },
  ship: { digital: '送料なし', card: '郵送（日本・海外）', simple: '日本国内送料無料・海外は EMS ¥6,000', standard: '日本国内送料無料・海外は EMS ¥6,000' },
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
  messageLabel: 'カードのひと言（任意・60字まで）',
  messagePlaceholder: '例：いつも、ありがとう。',
  messageCounter: (n, max) => `${n} / ${max}字`,
  egiftJapanOnly: '木札・版木のeギフトは、日本国内のみです。',
  memorialNote: '偲ぶ場合も、すべてのサイズをお選びいただけます。字は墨色で、紅白の水引・赤い印は使いません。',
  digitalNote: 'デジタルギフトは郵送されません。リンクで贈ります。',
  digitalNoteMemorial: 'デジタル版は郵送されません。リンクでお届けします。',
}

const en: SizeCopy = {
  names: { digital: 'Digital', card: 'Card', simple: 'Wooden tag (Simple)', standard: 'Block set (Standard)' },
  includes: {
    digital: 'The digital gift: character page, how it matches, the poem, the film, and the story scroll to download',
    card: 'The digital gift + a printed story card (A6, folded) in an envelope',
    simple: 'The digital gift + the card + a wooden tag with the character in gold colour, mizuhiki cord and gift box',
    standard: 'The digital gift + the card + a wooden block with the character, a rubbing set (ink, tampo, washi) and a cloth pouch',
  },
  includesMemorial: {
    digital: 'The digital gift: character page, the poem, the film, and the story scroll to download',
    card: 'The digital gift + a printed story card with the character in ink black, in an envelope',
    simple: 'The digital gift + the card + a wooden tag with the character in ink black, a plain cord and gift box',
    standard: 'The digital gift + the card + a wooden block with the character, a rubbing set (ink, tampo, washi) and a cloth pouch',
  },
  ship: { digital: 'No shipping', card: 'By mail, Japan and worldwide', simple: 'Free in Japan · overseas EMS ¥6,000', standard: 'Free in Japan · overseas EMS ¥6,000' },
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
  messageLabel: 'A short message for the card (optional, up to 60 characters)',
  messagePlaceholder: 'e.g. Thank you, always.',
  messageCounter: (n, max) => `${n} / ${max}`,
  egiftJapanOnly: 'E-gift for the wooden tag and the block set is Japan only.',
  memorialNote: 'For remembrance every size is available. The character is in ink black; no red-and-white cord and no red seal.',
  digitalNote: 'The digital gift is not shipped. You give it with a link.',
  digitalNoteMemorial: 'The digital version is not shipped. You share it with a link.',
}

const zhHant: SizeCopy = {
  names: { digital: '數位版', card: '卡片', simple: '木牌（簡約）', standard: '版木（標準）' },
  includes: {
    digital: '數位禮物（字的頁面、為什麼是這個字、詩、影片，以及可下載的故事長卷）',
    card: '數位禮物＋故事卡（A6 對摺），裝入信封寄出',
    simple: '數位禮物＋故事卡＋金色刻字的木牌、水引繩與禮盒',
    standard: '數位禮物＋故事卡＋刻字版木、拓印組（墨、拓包、和紙）與布袋',
  },
  includesMemorial: {
    digital: '數位禮物（字的頁面、詩、影片，以及可下載的故事長卷）',
    card: '數位禮物＋故事卡（墨色的字），裝入信封寄出',
    simple: '數位禮物＋故事卡＋墨色刻字的木牌、素色繩與禮盒',
    standard: '數位禮物＋故事卡＋刻字版木、拓印組（墨、拓包、和紙）與布袋',
  },
  ship: { digital: '免運費', card: '郵寄（日本與海外）', simple: '日本國內免運費・海外 EMS ¥6,000', standard: '日本國內免運費・海外 EMS ¥6,000' },
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
  messageLabel: '卡片上的一句話（選填，最多 60 字）',
  messagePlaceholder: '例：一直以來，謝謝你。',
  messageCounter: (n, max) => `${n} / ${max} 字`,
  egiftJapanOnly: '木牌與版木的電子禮物，僅限日本國內。',
  memorialNote: '追思時也可選擇所有尺寸。字以墨色呈現，不使用紅白水引與紅色印章。',
  digitalNote: '數位版不會郵寄，以連結贈送。',
  digitalNoteMemorial: '數位版不會郵寄，以連結分享。',
}

const zhHans: SizeCopy = {
  names: { digital: '数字版', card: '卡片', simple: '木牌（简约）', standard: '版木（标准）' },
  includes: {
    digital: '数字礼物（字的页面、为什么是这个字、诗、影片，以及可下载的故事长卷）',
    card: '数字礼物＋故事卡（A6 对折），装入信封寄出',
    simple: '数字礼物＋故事卡＋金色刻字的木牌、水引绳与礼盒',
    standard: '数字礼物＋故事卡＋刻字版木、拓印组（墨、拓包、和纸）与布袋',
  },
  includesMemorial: {
    digital: '数字礼物（字的页面、诗、影片，以及可下载的故事长卷）',
    card: '数字礼物＋故事卡（墨色的字），装入信封寄出',
    simple: '数字礼物＋故事卡＋墨色刻字的木牌、素色绳与礼盒',
    standard: '数字礼物＋故事卡＋刻字版木、拓印组（墨、拓包、和纸）与布袋',
  },
  ship: { digital: '免运费', card: '邮寄（日本与海外）', simple: '日本国内免运费・海外 EMS ¥6,000', standard: '日本国内免运费・海外 EMS ¥6,000' },
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
  messageLabel: '卡片上的一句话（选填，最多 60 字）',
  messagePlaceholder: '例：一直以来，谢谢你。',
  messageCounter: (n, max) => `${n} / ${max} 字`,
  egiftJapanOnly: '木牌与版木的电子礼物，仅限日本国内。',
  memorialNote: '追思时也可选择所有尺寸。字以墨色呈现，不使用红白水引与红色印章。',
  digitalNote: '数字版不会邮寄，以链接赠送。',
  digitalNoteMemorial: '数字版不会邮寄，以链接分享。',
}

export const SIZE_COPY: Record<UiLanguage, SizeCopy> = { ja, en, 'zh-Hant': zhHant, 'zh-Hans': zhHans }
