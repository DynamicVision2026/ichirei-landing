// The sender's words: the share buttons (LINE, WhatsApp, WeChat, QR, copy, e-mail), the words that travel with the link, and the e-gift receive form.
// Used by the buyer's page (BuyerPage.tsx) and the receiver's e-gift form (GiftPanels.tsx).

import type { PageLang } from './copy.ts'

export interface PanelCopy {
  giveTitle: string
  giveLead: string
  line: string
  copyLink: string
  copied: string
  email: string
  qr: string
  qrNote: string
  linkLabel: string
  shareText: string
  mailSubject: string
  statusTitle: string
  sizeLabel: string
  shipLabel: string
  shipMe: string
  shipDirect: string
  shipEgift: string
  shipNone: string
  egiftWaiting: string
  egiftReceived: string
  track: string
  /** After the order: the 24-hour change window (the order-complete line). */
  changeWindow: string
  from: (name: string) => string
  to: (name: string) => string
  characterLabel: string
  poemLabel: string
  receive: string
  receiveLead: string
  receiveJapanOnly: string
  formName: string
  formCountry: string
  formPostal: string
  formRegion: string
  formLine1: string
  formLine2: string
  formPhone: string
  send: string
  sending: string
  thanks: string
  alreadyReceived: string
  addressError: string
  addressPrivacy: string
  saveScroll: string
  savePng: string
  savePdf: string
  previewLink: string
  previewNote: string
  opensOnLabel: (date: string) => string
  replyTitle: string
  replyNone: string
  numberLabel: string
  /** The words that go with the link when it is shared (nothing about the character, the poem or the story). */
  sentLine: string
  sentLineMemorial: string
  whatsapp: string
  wechat: string
  wechatNote: string
  saveQr: string
  wechatVideo: string
}

/** The sender's words (the share buttons, the e-gift form): used by the buyer's page and the receiver's e-gift form. */
export const SENDER_COPY: Record<PageLang, PanelCopy> = {
  ja: {
    giveTitle: '贈る', giveLead: '相手のためのページです。リンクを送ると、映像からはじまります。',
    line: 'LINEで贈る', copyLink: 'リンクをコピー', copied: 'コピーしました', email: 'メールで贈る', qr: 'QRコードを表示', qrNote: '相手のスマートフォンで読み取れます。',
    linkLabel: '相手のページのリンク', shareText: 'あなたのための一字の物語です。', mailSubject: 'あなたのための一字',
    statusTitle: 'ご注文の状況', sizeLabel: 'サイズ', shipLabel: 'お届け', shipMe: 'ご自身に届けます', shipDirect: '相手に直接届けます', shipEgift: 'eギフト（住所は相手が入力）', shipNone: '郵送はありません（デジタル）',
    egiftWaiting: '相手の住所の入力を待っています', egiftReceived: '相手が住所を入力しました', track: '配送状況を見る',
    changeWindow: 'ご注文から24時間以内であれば、ご覧いただいた他の字への変更・キャンセルを承ります。ご注文確認メールにご返信ください。',
    from: (n) => `${n} より`, to: (n) => `${n} さんへ`, characterLabel: 'あなたに贈られた一字', poemLabel: 'この字に添えられた詩',
    receive: '受け取る', receiveLead: 'お届け先を入力してください。', receiveJapanOnly: '日本国内のみお届けできます。',
    formName: 'お名前', formCountry: '国', formPostal: '郵便番号', formRegion: '都道府県', formLine1: '住所', formLine2: '建物名・部屋番号', formPhone: '電話番号',
    send: '送信する', sending: '送信しています…', thanks: 'ありがとうございます。お届け先を受け取りました。', alreadyReceived: 'お届け先はすでに受け取っています。', addressError: '入力内容を確認してください。', addressPrivacy: '入力された住所は、お届けのためだけに使います。',
    saveScroll: '物語絵巻を保存', savePng: '画像（PNG）', savePdf: 'PDF',
    previewLink: '相手に届くとおりに見る', previewNote: '封を開く前の状態から、相手に届くとおりに確認できます。', opensOnLabel: (d) => `開封日 ${d}`, replyTitle: '相手からのひとこと', replyNone: 'まだ届いていません。', numberLabel: '証の番号',
    sentLine: '贈りものを送りました。', sentLineMemorial: '一字の便りを送りました。', whatsapp: 'WhatsAppで贈る', wechat: 'WeChatで贈る', wechatNote: 'WeChatでは、QRコードの画像か、物語の映像（動画）を送ってください。', saveQr: 'QRコードを画像で保存', wechatVideo: '映像（MP4）を保存する ↓',
  },
  'zh-Hant': {
    giveTitle: '送出', giveLead: '這是為對方準備的頁面。把連結傳給對方，會先從影片開始。',
    line: '用 LINE 傳送', copyLink: '複製連結', copied: '已複製', email: '用電子郵件傳送', qr: '顯示 QR code', qrNote: '對方可以用手機掃描。',
    linkLabel: '對方頁面的連結', shareText: '這是為你準備的一個字的故事。', mailSubject: '為你準備的一個字',
    statusTitle: '訂單狀況', sizeLabel: '尺寸', shipLabel: '寄送', shipMe: '寄給你自己', shipDirect: '直接寄給對方', shipEgift: '電子禮物（地址由對方填寫）', shipNone: '不郵寄（數位版）',
    egiftWaiting: '等待對方填寫地址', egiftReceived: '對方已填寫地址', track: '查看配送狀況',
    changeWindow: '下單後 24 小時內，可更換為您看過的其他字，或取消訂單。請回覆訂單確認信。',
    from: (n) => `${n} 贈`, to: (n) => `${n} 收`, characterLabel: '贈與你的一個字', poemLabel: '與這個字一起的詩',
    receive: '收下', receiveLead: '請填寫收件資料。', receiveJapanOnly: '僅限寄送至日本國內。',
    formName: '姓名', formCountry: '國家', formPostal: '郵遞區號', formRegion: '都道府縣／省', formLine1: '地址', formLine2: '建築物名稱・房號', formPhone: '電話',
    send: '送出', sending: '送出中…', thanks: '謝謝。已收到你的收件資料。', alreadyReceived: '已經收到收件資料了。', addressError: '請確認填寫的內容。', addressPrivacy: '填寫的地址只用於寄送。',
    saveScroll: '儲存故事長卷', savePng: '圖片（PNG）', savePdf: 'PDF',
    previewLink: '以對方收到的樣子預覽', previewNote: '可以從拆信封之前開始，確認對方收到的樣子。', opensOnLabel: (d) => `開啟日 ${d}`, replyTitle: '對方的回覆', replyNone: '尚未收到。', numberLabel: '證書編號',
    sentLine: '我送了你一份禮物。', sentLineMemorial: '我寄了一封一個字的信給你。', whatsapp: '用 WhatsApp 傳送', wechat: '用微信傳送', wechatNote: '在微信裡，請傳送 QR code 圖片，或故事影片。', saveQr: '將 QR code 存成圖片', wechatVideo: '儲存影片（MP4）↓',
  },
  en: {
    giveTitle: 'Give it', giveLead: 'This page is for the person you are giving it to. Send them the link and it starts with the film.',
    line: 'Send on LINE', copyLink: 'Copy the link', copied: 'Copied', email: 'Send by e-mail', qr: 'Show a QR code', qrNote: 'They can scan it with their phone.',
    linkLabel: 'Their page’s link', shareText: 'A one-character story, made for you.', mailSubject: 'One character, for you',
    statusTitle: 'Your order', sizeLabel: 'Size', shipLabel: 'Delivery', shipMe: 'Comes to you', shipDirect: 'Goes directly to them', shipEgift: 'E-gift (they enter the address)', shipNone: 'Not shipped (digital)',
    egiftWaiting: 'Waiting for them to enter their address', egiftReceived: 'They have entered their address', track: 'See delivery status',
    changeWindow: 'Within 24 hours of your order you can switch to another character you have seen, or cancel. Please reply to your order confirmation e-mail.',
    from: (n) => `From ${n}`, to: (n) => `To ${n}`, characterLabel: 'The character given to you', poemLabel: 'The poem that comes with it',
    receive: 'Receive your gift', receiveLead: 'Please tell us where to send it.', receiveJapanOnly: 'This size can be sent within Japan only.',
    formName: 'Name', formCountry: 'Country', formPostal: 'Postal code', formRegion: 'Prefecture / state', formLine1: 'Address', formLine2: 'Building, room', formPhone: 'Phone',
    send: 'Send', sending: 'Sending…', thanks: 'Thank you. We have your address.', alreadyReceived: 'Your address has already been received.', addressError: 'Please check what you entered.', addressPrivacy: 'Your address is used only for the delivery.',
    saveScroll: 'Save the story scroll', savePng: 'Image (PNG)', savePdf: 'PDF',
    previewLink: 'Preview it as they will see it', previewNote: 'You can look at it from the sealed envelope onwards, exactly as they will.', opensOnLabel: (d) => `Opens on ${d}`, replyTitle: 'Their reply', replyNone: 'Nothing yet.', numberLabel: 'Certificate number',
    sentLine: 'I have sent you a gift.', sentLineMemorial: 'I have sent you a letter of one character.', whatsapp: 'Send on WhatsApp', wechat: 'Send on WeChat', wechatNote: 'On WeChat, please send the QR code as an image, or the story video.', saveQr: 'Save the QR code as an image', wechatVideo: 'Save the video (MP4) ↓',
  },
}

