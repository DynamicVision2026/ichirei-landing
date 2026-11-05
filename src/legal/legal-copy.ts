// /legal — 特定商取引法に基づく表記 and the three FAQ entries (2026-10-30). ja / zh-Hant / en.
//
// The seller's own details are NEVER invented: every one the owner must supply is 【 】 (see `PLACEHOLDER`) — fill them in here and publish. Prices, shipping and
// the change rules come from the current product definition (src/order/packages.ts, src/demo/sizes-copy.ts and the 24-hour rule of engine/change-window.ts).

import { PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import type { RevealLang } from '../reveal/copy.ts'

/** What the owner fills in. A page that still contains it is not finished. */
export const PLACEHOLDER = '【 】'

export interface LegalRow {
  label: string
  /** The value; may contain PLACEHOLDER (to be filled by the owner). */
  value: string
}

export interface LegalCopy {
  title: string
  lead: string
  tableTitle: string
  rows: LegalRow[]
  returnsTitle: string
  returns: string[]
  faqTitle: string
  faq: { q: string; a: string }[]
  back: string
  /** Shown when 【 】 is still on the page (the owner's reminder is in DEPLOY.md; this one is for whoever opens the page). */
  note: string
}

const y = (id: 'egift' | 'simple' | 'standard') => formatYen(PACKAGE_PRICE_JPY[id])

export const LEGAL: Record<RevealLang, LegalCopy> = {
  ja: {
    title: '特定商取引法に基づく表記',
    lead: 'ICHIREI（一字礼）のご注文について。',
    tableTitle: '販売事業者の表記',
    rows: [
      { label: '販売業者', value: PLACEHOLDER },
      { label: '運営責任者', value: PLACEHOLDER },
      { label: '所在地', value: PLACEHOLDER },
      { label: '電話番号', value: PLACEHOLDER },
      { label: 'メールアドレス', value: PLACEHOLDER },
      { label: '販売URL', value: 'https://ichirei.soul-id.jp' },
      { label: '販売価格', value: `一字礼 eギフト ${y('egift')} ／ 木札 ${y('simple')} ／ 版木 ${y('standard')}（いずれも税込）` },
      { label: '商品代金以外の必要料金', value: '日本国内への送料は無料です。海外へのお届け（木札・版木）は EMS ¥6,000。eギフトは郵送がなく、送料はかかりません。' },
      { label: 'お支払い方法', value: `ご注文手続きの画面（Shopify）に表示される方法。${PLACEHOLDER}` },
      { label: 'お支払い時期', value: PLACEHOLDER },
      { label: '商品のお届け時期', value: `eギフト: お支払い後すぐ（開封日を指定した場合はその日）。木札・版木: ご注文時に指定した希望日に合わせて製作・発送します（製作はご注文から24時間の変更受付期間のあとに始まります）。製作・発送にかかる日数: ${PLACEHOLDER}。` },
    ],
    returnsTitle: '返品・交換・キャンセルについて',
    returns: [
      '本商品は、お客様の物語から選ばれた一字でつくる受注制作品です。',
      'ご注文から24時間以内であれば、ご注文時に表示された他の字への変更、名入れ・メッセージの修正、詩の形式の変更（1回）、またはキャンセル（全額返金）を承ります。ご注文確認メールにご返信ください。',
      '24時間を過ぎたお客様都合による変更・返品・返金はお受けできません。',
      '商品の破損、誤った字・誤印刷など当方の不備があった場合は、お届けから14日以内にご連絡ください。作り直し、または返金いたします。',
      'eギフトは、ギフトページのお届け後の返金はいたしかねます（正常に表示されない場合を除きます）。',
    ],
    faqTitle: 'よくあるご質問',
    faq: [
      { q: '注文後に字を変えられますか？', a: '24時間以内なら、表示された他の字に変更できます。' },
      { q: 'キャンセルできますか？', a: '24時間以内なら全額返金します。' },
      { q: '届いた品物に問題があったら？', a: '14日以内にご連絡ください。作り直しか返金をします。' },
      { q: 'お名前は入力しないといけませんか？', a: 'お名前の入力は任意です。入力された呼び名は、贈りものに表示するためだけに使います。' },
    ],
    back: 'トップへ戻る',
    note: '【 】の項目は、販売事業者が記入します。',
  },
  'zh-Hant': {
    title: '特定商取引法標示（日本《特定商業交易法》）',
    lead: '關於 ICHIREI（一字禮）的訂購。',
    tableTitle: '販售業者資訊',
    rows: [
      { label: '販售業者', value: PLACEHOLDER },
      { label: '營運負責人', value: PLACEHOLDER },
      { label: '所在地', value: PLACEHOLDER },
      { label: '電話號碼', value: PLACEHOLDER },
      { label: '電子郵件', value: PLACEHOLDER },
      { label: '販售網址', value: 'https://ichirei.soul-id.jp' },
      { label: '售價', value: `一字禮 e 禮物 ${y('egift')} ／ 木牌 ${y('simple')} ／ 版木 ${y('standard')}（皆含稅）` },
      { label: '商品價款以外的費用', value: '寄往日本國內免運費。寄往海外（木牌、版木）為 EMS ¥6,000。e 禮物不郵寄，無運費。' },
      { label: '付款方式', value: `訂購流程畫面（Shopify）所顯示的方式。${PLACEHOLDER}` },
      { label: '付款時間', value: PLACEHOLDER },
      { label: '交付時間', value: `e 禮物：付款後立即送達（若指定了開封日，則於當天開啟）。木牌、版木：依訂購時指定的希望日製作並寄出（下單後有 24 小時的更換受理期間，之後才開始製作）。製作與寄送所需天數：${PLACEHOLDER}。` },
    ],
    returnsTitle: '退貨、更換與取消',
    returns: [
      '本商品是依您的故事所選出的一個字製作的接單製作商品。',
      '下單後 24 小時內，可更換為訂購時顯示過的其他字、修正署名與訊息、變更詩的形式（限 1 次），或取消訂單（全額退款）。請回覆訂單確認信。',
      '超過 24 小時，因顧客個人因素的更換、退貨與退款，恕不受理。',
      '商品破損、字錯或印刷錯誤等屬於我方的疏失，請於收到商品後 14 天內聯絡我們，我們會重新製作或退款。',
      'e 禮物在禮物頁面送達後恕不退款（頁面無法正常顯示時除外）。',
    ],
    faqTitle: '常見問題',
    faq: [
      { q: '下單後可以換字嗎？', a: '24 小時內，可以換成您看過的其他字。' },
      { q: '可以取消訂單嗎？', a: '24 小時內取消，全額退款。' },
      { q: '收到的商品有問題怎麼辦？', a: '請在 14 天內聯絡我們，我們會重新製作或退款。' },
      { q: '一定要填寫姓名嗎？', a: '姓名為選填。你填寫的稱呼只會用來顯示在禮物上。' },
    ],
    back: '回到首頁',
    note: '標示【 】的項目，由販售業者填寫。',
  },
  en: {
    title: 'Legal notice (特定商取引法)',
    lead: 'About ordering from ICHIREI (一字礼), as the Japanese Act on Specified Commercial Transactions asks.',
    tableTitle: 'The seller',
    rows: [
      { label: 'Seller', value: PLACEHOLDER },
      { label: 'Person in charge', value: PLACEHOLDER },
      { label: 'Address', value: PLACEHOLDER },
      { label: 'Telephone', value: PLACEHOLDER },
      { label: 'E-mail', value: PLACEHOLDER },
      { label: 'Site', value: 'https://ichirei.soul-id.jp' },
      { label: 'Prices', value: `ICHIREI e-gift ${y('egift')} · Wooden tag ${y('simple')} · Carved block ${y('standard')} (all tax included)` },
      { label: 'Other charges', value: 'Shipping inside Japan is free. Shipping abroad (wooden tag and carved block) is EMS ¥6,000. The e-gift is not posted, so it has no shipping.' },
      { label: 'Payment methods', value: `The methods shown at checkout (Shopify). ${PLACEHOLDER}` },
      { label: 'When you pay', value: PLACEHOLDER },
      { label: 'Delivery', value: `E-gift: right after you pay (on the day you chose, if you set an opening date). Wooden tag and carved block: made and shipped for the date you choose when you order (making starts after the 24-hour change window). Days to make and ship: ${PLACEHOLDER}.` },
    ],
    returnsTitle: 'Returns, changes and cancellation',
    returns: [
      'Every piece is made to order, from the one character chosen from your story.',
      'Within 24 hours of your order you can switch to another character you were shown when you ordered, correct the names and message, change the poem format (once), or cancel for a full refund. Please reply to your order confirmation e-mail.',
      'After 24 hours we cannot accept changes, returns or refunds for personal reasons.',
      'If something is our fault — a damaged piece, the wrong character, a misprint — tell us within 14 days of delivery and we will remake it or refund you.',
      'The e-gift is not refundable once the gift page has been delivered, unless it does not work.',
    ],
    faqTitle: 'Questions',
    faq: [
      { q: 'Can I change the character after I order?', a: 'Within 24 hours, yes: you can switch to another character you were shown.' },
      { q: 'Can I cancel?', a: 'Within 24 hours we refund you in full.' },
      { q: 'What if what I receive has a problem?', a: 'Tell us within 14 days and we will remake it or refund you.' },
      { q: 'Do I have to enter a name?', a: 'Names are optional. Any name you enter is used only to show on the gift.' },
    ],
    back: 'Back to the home page',
    note: 'Items marked 【 】 are filled in by the seller.',
  },
}
