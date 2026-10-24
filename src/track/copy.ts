// Copy for /track (order status) in the four languages. Plain TS, no imports beyond a type, so the
// Node tests can load it. The status LABELS are the owner's words (制作中 / 発送済み / お届け完了);
// the rest is a first draft for native review in zh-Hans / zh-Hant / en.

import type { UiLanguage } from '../demo/i18n.ts'

export type TrackStatus = 'payment_pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

export interface TrackCopy {
  documentTitle: string
  heading: string
  intro: string
  orderLabel: string
  orderPlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  submit: string
  submitting: string
  another: string
  /** Shown on every status. */
  contact: string
  errors: { notFound: string; badInput: string; rateLimited: string; unavailable: string; network: string }
  status: Record<TrackStatus, { label: string; note: string }>
  fields: { orderedOn: string; product: string; carrier: string; trackingNumber: string; trackingLink: string }
  /** SKU → the package's name; an unknown SKU is shown as is. */
  sku: { 'ICHIREI-SIMPLE': string; 'ICHIREI-STANDARD': string }
  /** "Estimated arrival" line from a month and a day. */
  eta: (month: number, day: number) => string
  /** A date as a sentence part (the order date). */
  date: (year: number, month: number, day: number) => string
}

const ja: TrackCopy = {
  documentTitle: 'ご注文の状況 — ICHIREI 一字礼',
  heading: 'ご注文の状況',
  intro: 'ご注文番号とメールアドレスを入力してください。',
  orderLabel: 'ご注文番号',
  orderPlaceholder: '例：#1016',
  emailLabel: 'ご注文時のメールアドレス',
  emailPlaceholder: 'name@example.com',
  submit: '状況を見る',
  submitting: '確認しています…',
  another: '別のご注文を調べる',
  contact: 'ご不明な点は、ご注文確認メールにご返信ください。',
  errors: {
    notFound: 'ご注文が見つかりませんでした。ご注文番号とメールアドレスをご確認ください。',
    badInput: 'ご注文番号（例：#1016）とメールアドレスを、正しく入力してください。',
    rateLimited: '短時間に何度も照会されました。しばらくしてから、もう一度お試しください。',
    unavailable: 'ただいま状況を確認できません。時間をおいて、もう一度お試しください。',
    network: '通信に失敗しました。もう一度お試しください。',
  },
  status: {
    payment_pending: { label: 'お支払い確認中', note: 'お支払いの確認ができ次第、制作に入ります。' },
    processing: { label: '制作中', note: '一字を、心をこめて制作しています。' },
    shipped: { label: '発送済み', note: '発送しました。お届けまで、いましばらくお待ちください。' },
    delivered: { label: 'お届け完了', note: 'お届けが完了しました。' },
    cancelled: { label: 'キャンセル済み', note: 'このご注文は、キャンセル（または返金）されています。' },
  },
  fields: { orderedOn: 'ご注文日', product: '商品', carrier: '配送会社', trackingNumber: '追跡番号', trackingLink: '配送状況を見る' },
  sku: { 'ICHIREI-SIMPLE': '一字礼 シンプル', 'ICHIREI-STANDARD': '一字礼 スタンダード' },
  eta: (m, d) => `お届け予定：${m}月${d}日ごろまで`,
  date: (y, m, d) => `${y}年${m}月${d}日`,
}

const zhHans: TrackCopy = {
  documentTitle: '订单状态 — ICHIREI 一字礼',
  heading: '订单状态',
  intro: '请输入订单号和邮箱地址。',
  orderLabel: '订单号',
  orderPlaceholder: '例如：#1016',
  emailLabel: '下单时使用的邮箱',
  emailPlaceholder: 'name@example.com',
  submit: '查看状态',
  submitting: '正在确认…',
  another: '查询其他订单',
  contact: '如有疑问，请直接回复订单确认邮件。',
  errors: {
    notFound: '没有找到这个订单。请确认订单号和邮箱地址。',
    badInput: '请正确填写订单号（例如：#1016）和邮箱地址。',
    rateLimited: '短时间内查询次数过多，请稍后再试。',
    unavailable: '目前无法确认订单状态，请稍后再试。',
    network: '网络连接失败，请再试一次。',
  },
  status: {
    payment_pending: { label: '确认付款中', note: '确认付款后，就会开始制作。' },
    processing: { label: '制作中', note: '正在用心制作这一个字。' },
    shipped: { label: '已发货', note: '已经发货，请耐心等待送达。' },
    delivered: { label: '已送达', note: '已经送达。' },
    cancelled: { label: '已取消', note: '这个订单已被取消（或已退款）。' },
  },
  fields: { orderedOn: '下单日期', product: '商品', carrier: '承运商', trackingNumber: '运单号', trackingLink: '查看物流' },
  sku: { 'ICHIREI-SIMPLE': '一字礼 简约款', 'ICHIREI-STANDARD': '一字礼 标准款' },
  eta: (m, d) => `预计送达：${m}月${d}日左右前`,
  date: (y, m, d) => `${y}年${m}月${d}日`,
}

const zhHant: TrackCopy = {
  documentTitle: '訂單狀態 — ICHIREI 一字禮',
  heading: '訂單狀態',
  intro: '請輸入訂單編號和電子郵件地址。',
  orderLabel: '訂單編號',
  orderPlaceholder: '例如：#1016',
  emailLabel: '下單時使用的電子郵件',
  emailPlaceholder: 'name@example.com',
  submit: '查看狀態',
  submitting: '正在確認…',
  another: '查詢其他訂單',
  contact: '如有疑問，請直接回覆訂單確認郵件。',
  errors: {
    notFound: '找不到這筆訂單。請確認訂單編號和電子郵件地址。',
    badInput: '請正確填寫訂單編號（例如：#1016）和電子郵件地址。',
    rateLimited: '短時間內查詢次數過多，請稍後再試。',
    unavailable: '目前無法確認訂單狀態，請稍後再試。',
    network: '網路連線失敗，請再試一次。',
  },
  status: {
    payment_pending: { label: '確認付款中', note: '確認付款後，就會開始製作。' },
    processing: { label: '製作中', note: '正在用心製作這一個字。' },
    shipped: { label: '已出貨', note: '已經出貨，請耐心等待送達。' },
    delivered: { label: '已送達', note: '已經送達。' },
    cancelled: { label: '已取消', note: '這筆訂單已被取消（或已退款）。' },
  },
  fields: { orderedOn: '下單日期', product: '商品', carrier: '承運商', trackingNumber: '貨運單號', trackingLink: '查看物流' },
  sku: { 'ICHIREI-SIMPLE': '一字禮 簡約款', 'ICHIREI-STANDARD': '一字禮 標準款' },
  eta: (m, d) => `預計送達：${m}月${d}日左右前`,
  date: (y, m, d) => `${y}年${m}月${d}日`,
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const en: TrackCopy = {
  documentTitle: 'Order status — ICHIREI 一字礼',
  heading: 'Order status',
  intro: 'Enter your order number and the email address you ordered with.',
  orderLabel: 'Order number',
  orderPlaceholder: 'e.g. #1016',
  emailLabel: 'Email used for the order',
  emailPlaceholder: 'name@example.com',
  submit: 'Check status',
  submitting: 'Checking…',
  another: 'Look up another order',
  contact: 'If you have any questions, just reply to your order confirmation email.',
  errors: {
    notFound: 'We could not find that order. Please check the order number and the email address.',
    badInput: 'Please enter a valid order number (e.g. #1016) and email address.',
    rateLimited: 'Too many lookups in a short time. Please try again a little later.',
    unavailable: 'We cannot check the status right now. Please try again a little later.',
    network: 'The connection failed. Please try again.',
  },
  status: {
    payment_pending: { label: 'Confirming payment', note: 'Production begins as soon as your payment is confirmed.' },
    processing: { label: 'In production', note: 'Your character is being made, with care.' },
    shipped: { label: 'Shipped', note: 'It is on its way to you.' },
    delivered: { label: 'Delivered', note: 'It has been delivered.' },
    cancelled: { label: 'Cancelled', note: 'This order has been cancelled (or refunded).' },
  },
  fields: { orderedOn: 'Ordered on', product: 'Item', carrier: 'Carrier', trackingNumber: 'Tracking number', trackingLink: 'Track the parcel' },
  sku: { 'ICHIREI-SIMPLE': 'ICHIREI Simple', 'ICHIREI-STANDARD': 'ICHIREI Standard' },
  eta: (m, d) => `Estimated arrival: by around ${MONTHS[m - 1]} ${d}`,
  date: (y, m, d) => `${MONTHS[m - 1]} ${d}, ${y}`,
}

export const TRACK_COPY: Record<UiLanguage, TrackCopy> = { ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant, en }

/** What /api/track answers (mirrors engine/track.ts TrackAnswer). */
export interface TrackAnswer {
  ordered_on: string
  status: TrackStatus
  sku: string[]
  carrier: string | null
  tracking_number: string | null
  tracking_url: string | null
  estimated_by: string | null
}

/** "YYYY-MM-DD" → [y, m, d] (no time zones involved: the server already chose the Japan date). */
export const splitDate = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m, d]
}

/** The order number from ?order= ("%231016" → "#1016"); '' when absent or implausible. */
export function orderFromSearch(search: string): string {
  const raw = (new URLSearchParams(search).get('order') ?? '').normalize('NFKC').trim().replace(/^#/, '')
  return /^\d{1,9}$/.test(raw) ? `#${raw}` : ''
}
