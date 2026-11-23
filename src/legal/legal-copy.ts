// /legal — 特定商取引法に基づく表記 and the three FAQ entries (2026-10-30). ja / zh-Hant / en.
//
// The seller's own details are the owner's real ones (2026-11-06), word for word; nothing here is invented, and no 【 】 may remain on the page (scripts/test-legal.ts).
// Prices, shipping and the change rules come from the current product definition (src/order/packages.ts, src/demo/sizes-copy.ts and the 24-hour rule of engine/change-window.ts).

import { PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import type { RevealLang } from '../reveal/copy.ts'
import { SUPPORT_EMAIL } from '../order/support.ts'

import { REFUND_EN } from '../order/refund-en.ts'
import { DEFAULT_USD_PRICE, usdCode } from '../order/usd.ts'

export interface LegalRow {
  label: string
  /** The delivery row is the one that grows a wooden-sizes sentence while they are on sale. */
  key?: 'delivery'
  value: string
}

export interface LegalCopy {
  title: string
  lead: string
  tableTitle: string
  rows: LegalRow[]
  returnsTitle: string
  /** The refund policy: four short paragraphs, each with its heading (2026-11-06). The first is what /legal#refund points to. */
  sections: { heading: string; body: string }[]
  /** The wooden sizes' part of the delivery row: shown only while the wooden sizes are on sale (not while they are "coming soon"). */
  deliveryWood: string
  faqTitle: string
  /** The privacy section (2026-11-15): the one functional cookie. No banner. */
  privacy: { heading: string; body: string }
  /** 2026-11-15: what the email is used for (Email), how long saved gifts stay (Retention) — shown under the privacy sentence — and the cancellation-time sentence (under the return rules). */
  emailUse: string
  retention: string
  /** 2026-11-20: what signing in stores, why, and how to delete the account. */
  signIn: string
  /** Ticket 7 (2026-11-22, Part 32): the Relationship Map tool (tools.beyondculture.ai/kyori) — what is stored and for how long. */
  tool: { heading: string; body: string }
  cancelTime: string
  faq: { q: string; a: string }[]
  back: string
}

const y = (id: 'egift' | 'simple' | 'standard') => formatYen(PACKAGE_PRICE_JPY[id])
/** The e-gift's price on the legal notice, in English (2026-11-14): dollars for orders from the English site (checkout is in USD), yen for the Japanese and Chinese sites. */
const EN_EGIFT_PRICE = `${usdCode(DEFAULT_USD_PRICE.egift)} (sale ${usdCode(DEFAULT_USD_PRICE.egift_sale)}) for orders from the English site; ${y('egift')} for orders from the Japanese and Chinese sites`

export const LEGAL: Record<RevealLang, LegalCopy> = {
  ja: {
    title: '特定商取引法に基づく表記',
    lead: 'ICHIREI（一字礼）のご注文について。',
    tableTitle: '販売事業者の表記',
    rows: [
      { label: '販売業者', value: 'Beyond Culture 獨歩文化株式会社' },
      { label: '運営責任者', value: '代表取締役 傅豊国' },
      { label: '所在地', value: '〒143-0023 東京都大田区山王2丁目5番13号 大森北口ビル5F 5-72' },
      { label: '電話番号', value: '請求があった場合、遅滞なく電子メールにて開示いたします。お問い合わせはメールにてお願いいたします。' },
      { label: 'メールアドレス', value: SUPPORT_EMAIL },
      { label: '販売URL', value: 'https://ichirei.beyondculture.ai' },
      { label: '販売価格', value: `一字礼 eギフト ${y('egift')} ／ 木札 ${y('simple')} ／ 版木 ${y('standard')}（いずれも税込）` },
      { label: '商品代金以外の必要料金', value: '日本国内への送料は無料です。海外へのお届け（木札・版木）は EMS ¥6,000。eギフトは郵送がなく、送料はかかりません。' },
      { label: 'お支払い方法', value: 'ご注文画面（Shopify）に表示される方法' },
      { label: 'お支払い時期', value: 'ご注文時にお支払いが確定します。' },
      { label: '商品のお届け時期', key: 'delivery', value: 'eギフト：お支払い後すぐ（開封日を指定した場合はその日）。' },
    ],
    returnsTitle: '返品・交換・キャンセルについて',
    deliveryWood: '木札・版木：お支払い完了から24時間のキャンセル受付期間ののちに制作を始め、国内は約2〜3週間でお届けします（海外はさらに1〜2週間）。',
    sections: [
      { heading: 'お支払い完了から24時間以内', body: 'お支払い完了から24時間以内にメールを受信した場合に限り、ご注文のキャンセル（送料を含む全額返金）を承ります。ただし、ご注文ページで「贈りものを受け取る」を押した後は、キャンセルできません（すべての商品に共通）。ご注文確認メールにご返信ください。期限内に受信したお申し出は、対応が24時間を過ぎても承ります。お支払い後の内容の変更（字・歌・お名前・メッセージなど）はお受けしていません。別の内容をご希望の場合は、キャンセルのうえ、あらためてご注文ください。ストア等で直接ご購入いただいた注文は、受け取り（/claim）の時点から24時間です。' },
      { heading: '24時間を過ぎた場合', body: 'すべての商品はご注文ごとに制作するため、お支払い完了から24時間を過ぎたお客様都合による返品・返金はお受けできません。お支払い前にご確認いただいた字・歌・絵の内容は、不備には当たりません。' },
      { heading: '当方の不備', body: '木札・版木の破損、誤った字、誤印刷など当方の不備があった場合は、お届けから14日以内に写真を添えてメールでご連絡ください。作り直し、または返金いたします（返送料は当方負担）。eギフトのページが正常に表示されない場合は修正し、修正できない場合は返金いたします。' },
      { heading: '配送について', body: '配送中の紛失は、追跡で確認のうえ再発送または返金いたします。ご入力いただいた住所の誤りや長期不在などで返送された場合、再発送の送料はお客様のご負担となります。海外発送で発生する関税・輸入税は、受け取る方のご負担となります。' },
    ],
    privacy: { heading: 'プライバシー', body: '無料のお試し回数を管理するため、機能上必要なCookieを1つ使用します。' },
    emailUse: '無料の贈りものを確保するためにメールアドレスをご入力いただいた場合、確保と決済時の照合のためだけに使います。ご希望の場合のみ、お知らせをお送りします。',
    retention: 'ご注文のない保存データは、30日後に削除します。',
    signIn: 'ログイン（Google、LINE、メールのリンク）では、ログイン先の提供元が発行するID、メールアドレス（提供される場合）、LINEの表示名（ヘッダーの表示用）だけを保存します。目的は、お客様の贈りものを保存し、どの端末からでも見つけられるようにすることです。プロフィール写真や友だち情報は取得しません。アカウントの削除は、マイギフトの「アカウントを削除」から、または info@beyondculture.ai までご連絡ください。お知らせのメールは、別の同意ボックスにチェックされた場合のみお送りします。',
    tool: { heading: '関係の地図（一字の距離）', body: '関係の地図（一字の距離）で保存された地図は、鍵をかけて保管され、当社は中身を読めません。24か月更新のない地図は自動で削除されます。鍵のメールは、配信記録として送信サービスに30日間保管されたのち削除されます。チャットの画像と文字は読み取りのためだけに使い、保存しません。' },
    cancelTime: 'キャンセルのご連絡は、メールを送信した時刻で受け付けます。',
    faqTitle: 'よくあるご質問',
    faq: [
      { q: '注文後に字を変えられますか？', a: 'お支払い後の内容の変更（字・歌・お名前・メッセージなど）はお受けしていません。別の内容をご希望の場合は、キャンセルのうえ、あらためてご注文ください。' },
      { q: 'キャンセルできますか？', a: 'お支払い完了から24時間以内にメールを受信した場合に限り、ご注文のキャンセル（送料を含む全額返金）を承ります。ただし、ご注文ページで「贈りものを受け取る」を押した後は、キャンセルできません（すべての商品に共通）。ストア等で直接ご購入いただいた注文は、受け取り（/claim）の時点から24時間です。' },
      { q: '届いた品物に問題があったら？', a: '木札・版木の破損、誤った字、誤印刷など当方の不備があった場合は、お届けから14日以内に写真を添えてメールでご連絡ください。作り直し、または返金いたします（返送料は当方負担）。eギフトのページが正常に表示されない場合は修正し、修正できない場合は返金いたします。' },
      { q: 'お名前は入力しないといけませんか？', a: 'お名前の入力は任意です。入力された呼び名は、贈りものに表示するためだけに使います。' },
    ],
    back: 'トップへ戻る',
  },
  'zh-Hant': {
    title: '特定商取引法標示（日本《特定商業交易法》）',
    lead: '關於 ICHIREI（一字禮）的訂購。',
    tableTitle: '販售業者資訊',
    rows: [
      { label: '販售業者', value: 'Beyond Culture 獨歩文化株式会社' },
      { label: '營運負責人', value: '代表董事 傅豊国' },
      { label: '所在地', value: '〒143-0023 東京都大田区山王2丁目5番13號 大森北口大樓5F 5-72' },
      { label: '電話號碼', value: '如有需要，我們會在收到請求後儘速以電子郵件提供。諮詢請透過電子郵件聯絡。' },
      { label: '電子郵件', value: SUPPORT_EMAIL },
      { label: '販售網址', value: 'https://ichirei.beyondculture.ai' },
      { label: '售價', value: `一字禮 e 禮物 ${y('egift')} ／ 木牌 ${y('simple')} ／ 版木 ${y('standard')}（皆含稅）` },
      { label: '商品價款以外的費用', value: '寄往日本國內免運費。寄往海外（木牌、版木）為 EMS ¥6,000。e 禮物不郵寄，無運費。' },
      { label: '付款方式', value: '訂購流程畫面（Shopify）所顯示的方式' },
      { label: '付款時間', value: '下單時即完成付款。' },
      { label: '交付時間', key: 'delivery', value: 'e禮物：付款後立即送達（若指定開啟日期，則於當天開啟）。' },
    ],
    returnsTitle: '退貨、更換與取消',
    deliveryWood: '木牌、版木：付款完成後24小時的取消受理期間結束後開始製作，日本國內約2〜3週送達（海外另需1〜2週）。',
    sections: [
      { heading: '付款完成後24小時內', body: '僅限付款完成後24小時內我們收到您的郵件，可取消訂單（含運費全額退款）。但在訂單頁面按下「領取禮物」後，即無法取消（所有商品皆同）。請直接回覆訂單確認郵件。只要在期限內收到，即使處理時間超過24小時，仍會受理。付款後恕不更改內容（字、詩、姓名、訊息等）。如需不同內容，請先取消，再重新下單。在商店等處直接購買的訂單，從領取（/claim）時起算24小時。' },
      { heading: '超過24小時', body: '所有商品皆為接單後製作，付款完成超過24小時後，恕不接受因個人因素的退貨或退款。付款前已確認的字、詩與圖畫內容，不屬於瑕疵。' },
      { heading: '我方疏失', body: '如木牌、版木有破損、刻錯字或印刷錯誤等我方疏失，請於送達後14日內附上照片來信告知，我們將重新製作或退款（退回運費由我方負擔）。e禮物頁面無法正常顯示時，我們會修正；無法修正時將退款。' },
      { heading: '關於配送', body: '運送途中遺失時，經追蹤確認後將重新寄送或退款。若因您填寫的地址有誤或長期無人收件而遭退回，重新寄送的運費由您負擔。寄送海外時產生的關稅與進口稅，由收件人負擔。' },
    ],
    privacy: { heading: '隱私', body: '為了管理免費試用次數，我們使用一個功能上必要的Cookie。' },
    emailUse: '若你為保留免費禮物輸入電子郵件，我們只用它來保留禮物並在結帳時核對。只有在你同意時，才會寄送消息。',
    retention: '沒有下單的儲存資料，會在30天後刪除。',
    signIn: '登入（Google、LINE、電子郵件連結）只會儲存登入提供者發出的識別碼、電子郵件（若有提供）與 LINE 顯示名稱（用於頁首顯示）。目的是保存你的禮物，讓你在任何裝置上都能找到。我們不會取得大頭貼或好友資料。要刪除帳戶，請在〈我的禮物〉按「刪除帳戶」，或來信 info@beyondculture.ai。只有在另外勾選同意框時，我們才會寄送消息信件。',
    tool: { heading: '關係地圖（一字之間）', body: '在『一字之間』儲存的地圖會上鎖保存，我們無法讀取內容。24 個月沒有更新的地圖會自動刪除。鑰匙郵件會作為寄送紀錄，在郵件服務保存 30 天後刪除。聊天截圖與文字只用於讀取，不會保存。' },
    cancelTime: '取消申請以你寄出郵件的時間為準。',
    faqTitle: '常見問題',
    faq: [
      { q: '下單後可以換字嗎？', a: '付款後恕不更改內容（字、詩、姓名、訊息等）。如需不同內容，請先取消，再重新下單。' },
      { q: '可以取消訂單嗎？', a: '僅限付款完成後24小時內我們收到您的郵件，可取消訂單（含運費全額退款）。但在訂單頁面按下「領取禮物」後，即無法取消（所有商品皆同）。在商店等處直接購買的訂單，從領取（/claim）時起算24小時。' },
      { q: '收到的商品有問題怎麼辦？', a: '如木牌、版木有破損、刻錯字或印刷錯誤等我方疏失，請於送達後14日內附上照片來信告知，我們將重新製作或退款（退回運費由我方負擔）。e禮物頁面無法正常顯示時，我們會修正；無法修正時將退款。' },
      { q: '一定要填寫姓名嗎？', a: '姓名為選填。你填寫的稱呼只會用來顯示在禮物上。' },
    ],
    back: '回到首頁',
  },
  en: {
    title: 'Legal notice (特定商取引法)',
    lead: 'About ordering from ICHIREI (一字礼), as the Japanese Act on Specified Commercial Transactions asks.',
    tableTitle: 'The seller',
    rows: [
      { label: 'Seller', value: 'Beyond Culture 獨歩文化株式会社 (Beyond Culture Inc.)' },
      { label: 'Person in charge', value: '傅豊国, Representative Director' },
      { label: 'Address', value: 'Omori Kitaguchi Bldg. 5F 5-72, 2-5-13 Sanno, Ota-ku, Tokyo 143-0023, Japan' },
      { label: 'Telephone', value: 'Disclosed by email without delay upon request. Please contact us by email.' },
      { label: 'E-mail', value: SUPPORT_EMAIL },
      { label: 'Site', value: 'https://ichirei.beyondculture.ai' },
      { label: 'Prices', value: `ICHIREI e-gift ${EN_EGIFT_PRICE} · Wooden tag ${y('simple')} · Carved block ${y('standard')} (all tax included)` },
      { label: 'Other charges', value: 'Shipping inside Japan is free. Shipping abroad (wooden tag and carved block) is EMS ¥6,000. The e-gift is not posted, so it has no shipping.' },
      { label: 'Payment methods', value: 'The methods shown at checkout (Shopify)' },
      { label: 'When you pay', value: 'Payment is taken when you place the order.' },
      { label: 'Delivery', key: 'delivery', value: 'E-gift: right after payment (or on the opening date you set).' },
    ],
    returnsTitle: 'Returns, changes and cancellation',
    deliveryWood: 'Wooden tag and carved block: made after the 24-hour cancellation period, delivered in about 2–3 weeks in Japan (1–2 weeks more overseas).',
    sections: [
      { heading: 'Within 24 hours of payment', body: REFUND_EN + ' Please reply to your order confirmation email. Requests received in time are honoured even if we handle them later. We can\'t change an order after payment (character, poem, names or message). If you\'d like something different, cancel and place a new order. For orders bought directly in our store and claimed later, the 24 hours start at the claim.' },
      { heading: 'After 24 hours', body: 'Every gift is made to order, so more than 24 hours after payment we can\'t accept returns or refunds for change of mind. The character, poem and pictures you reviewed before paying are not considered a defect.' },
      { heading: 'If we made a mistake', body: 'If a wooden tag or block arrives damaged, with the wrong character or a misprint, email us a photo within 14 days of delivery and we\'ll remake it or refund you (we cover return shipping). If an e-gift page doesn\'t display properly, we\'ll fix it, or refund you if we can\'t.' },
      { heading: 'Delivery', body: 'If a parcel is lost in transit, we\'ll check the tracking and reship or refund. If it\'s returned because of an incorrect address you entered or because no one collected it, reshipping is at your cost. Import duties and taxes on overseas deliveries are paid by the recipient.' },
    ],
    privacy: { heading: 'Privacy', body: 'We use one functional cookie to limit free previews.' },
    emailUse: 'If you enter your email to hold a free gift, we use it only to hold it and match it at checkout. We send news only if you ask for it.',
    retention: 'Saved gifts without an order are deleted after 30 days.',
    signIn: 'Signing in (Google, LINE or an email link) stores only the id the provider gives us, your email (when it gives one) and your LINE display name (to show in the header). We do it to keep your gifts and let you find them on any device. We do not take your profile photo or your friends. To delete your account, use “Delete my account” in My gifts or email info@beyondculture.ai. We send news only if you tick the separate consent box.',
    tool: { heading: 'The Relationship Map tool', body: 'Maps saved in the Relationship Map tool are stored locked; we cannot read them. A map not updated for 24 months is deleted automatically. The key email is kept by our mail service for 30 days as a delivery record, then deleted. Chat screenshots and their text are used only for the reading and are never stored.' },
    cancelTime: 'For cancellations, the time you send your email is the time that counts.',
    faqTitle: 'Questions',
    faq: [
      { q: 'Can I change the character after I order?', a: 'We can\'t change an order after payment (character, poem, names or message). If you\'d like something different, cancel and place a new order.' },
      { q: 'Can I cancel?', a: REFUND_EN + ' ' + 'For orders bought directly in our store and claimed later, the 24 hours start at the claim.' },
      { q: 'What if what I receive has a problem?', a: 'If a wooden tag or block arrives damaged, with the wrong character or a misprint, email us a photo within 14 days of delivery and we\'ll remake it or refund you (we cover return shipping). If an e-gift page doesn\'t display properly, we\'ll fix it, or refund you if we can\'t.' },
      { q: 'Do I have to enter a name?', a: 'Names are optional. Any name you enter is used only to show on the gift.' },
    ],
    back: 'Back to the home page',
  },
}

/** The value of a row: the delivery row adds the wooden sizes' sentence only while they are on sale (nothing about wood while they are "coming soon"). */
export function rowValue(lang: RevealLang, row: LegalRow, woodOnSale: boolean): string {
  if (row.key !== 'delivery' || !woodOnSale) return row.value
  return `${row.value}${lang === 'en' ? ' ' : ''}${LEGAL[lang].deliveryWood}`
}

// ---- while the wooden sizes are "coming soon" the page says nothing about wood (2026-11-07) -----------------------------------------------------------------------------------------------------
// The price row, the other-charges row, the "if we made a mistake" paragraph and FAQ answer, and the delivery paragraph (a parcel lost in transit) are about the wooden sizes; while those are not on sale
// they are replaced by their e-gift-only form (or left out). The page asks /api/sizes once; until it answers, the e-gift version shows.
const EGIFT_ONLY: Record<RevealLang, { price: string; other: string; defect: string }> = {
  ja: {
    price: `一字礼 eギフト ${y('egift')}（税込）`,
    other: 'eギフトは郵送がなく、送料はかかりません。',
    defect: 'eギフトのページが正常に表示されない場合は、修正します。修正できない場合は返金いたします。',
  },
  'zh-Hant': {
    price: `一字禮 e 禮物 ${y('egift')}（含稅）`,
    other: 'e 禮物不郵寄，無運費。',
    defect: 'e禮物頁面無法正常顯示時，我們會修正；無法修正時將退款。',
  },
  en: {
    price: `ICHIREI e-gift ${EN_EGIFT_PRICE} (tax included)`,
    other: 'The e-gift is sent as a link, so there is nothing to post and no delivery charge.',
    defect: "If an e-gift page doesn't display properly, we'll fix it, or refund you if we can't.",
  },
}

/** The page's text for this moment: the full text while the wooden sizes are on sale, the e-gift-only text while they are "coming soon". */
export function legalView(lang: RevealLang, woodOnSale: boolean): LegalCopy {
  const full = LEGAL[lang]
  if (woodOnSale) return full
  const only = EGIFT_ONLY[lang]
  return {
    ...full,
    rows: full.rows.map((r, i) => (i === 6 ? { ...r, value: only.price } : i === 7 ? { ...r, value: only.other } : r)),
    // the paragraph on parcels lost in transit is about shipping wooden goods: left out
    sections: full.sections.filter((_, i) => i !== 3).map((x, i) => (i === 2 ? { ...x, body: only.defect } : x)),
    faq: full.faq.map((f, i) => (i === 2 ? { ...f, a: only.defect } : f)),
  }
}
