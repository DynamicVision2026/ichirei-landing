// "Save to my email" (2026-11-18): any customer can keep their page by email and open it again from any device. One mail, in the page language, with the private link /b/<token> and nothing else of
// theirs in it (no story, no names): one line, the button "Open my gifts", "Saved until {date}", and the company footer.
//
// Rules this file keeps:
//   - An email alone never shows anything. Only the link inside the mail opens the page — opening it proves the address is theirs.
//   - If the record already has an email, a NEW address replaces it only after the link in the mail to the new address is opened (engine/basket.ts openBasketLink with ?m=).
//   - An address that already has a record (another device, a free-gift hold) gets the link of THAT record; this browser is not merged into it by typing the address.
//   - At most 3 mails a day per address (saving and "send my link again" together).
//   - The marketing consent is not touched: saving never subscribes anyone.
//   - No address and no message in any log line; nothing here logs.

import { publicUrl } from './animation.ts'
import { analyticsDay } from './analytics.ts'
import { casJson, customerIdOf, emailCustomerId, emailHash, linkEmail, normalizeEmail, readCustomer, validEmail, type CustomerRecord } from './customer.ts'
import { BASKET_TOKEN_PATTERN, ensureBasketToken, holdEmailChange, newBasketToken } from './basket.ts'
import { maskEmail } from './mygifts.ts'
import type { Mail, Mailer } from './mailer.ts'
import type { OrderStore } from './order-store.ts'
import { SUPPORT_EMAIL } from '../src/order/support.ts'

export const MAIL_PER_DAY = 3
export type MailLang = 'ja' | 'en' | 'zh-Hant'
export const mailLangOf = (l: unknown): MailLang => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : l === 'zh-Hant' || l === 'zh-Hans' || l === 'zh' ? 'zh-Hant' : 'en')

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Dec 17" / 「12月17日」 */
export const dayText = (d: Date, lang: MailLang): string => (lang === 'en' ? `${MONTH_EN[d.getUTCMonth()]} ${d.getUTCDate()}` : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`)

const TEXT: Record<MailLang, { subject: string; line: string; button: string; until: (d: string) => string; ignore: string; company: string }> = {
  en: { subject: 'Your ICHIREI gifts', line: 'Here is your private link to your ICHIREI gifts.', button: 'Open my gifts', until: (d) => `Saved until ${d}.`, ignore: 'If you did not ask for this, you can ignore it: nothing opens without this link.', company: 'Beyond Culture 獨歩文化株式会社' },
  ja: { subject: '一字礼 マイギフト', line: '一字礼のマイギフトを開く、あなただけのリンクです。', button: 'マイギフトを開く', until: (d) => `${d}まで保存されます。`, ignore: '心当たりがない場合は、このメールは無視してください。このリンクがなければ、何も開きません。', company: 'Beyond Culture 獨歩文化株式会社' },
  'zh-Hant': { subject: '一字禮 我的禮物', line: '這是開啟你的一字禮「我的禮物」的專屬連結。', button: '開啟我的禮物', until: (d) => `保存至${d}。`, ignore: '如果不是你本人操作，請忽略這封信：沒有這個連結，什麼都不會打開。', company: 'Beyond Culture 獨歩文化株式会社' },
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The mail: subject, one line, the button, "Saved until …", the footer. No story, no names. */
export function basketMail(to: string, link: string, savedUntil: Date, lang: MailLang): Mail {
  const t = TEXT[lang]
  const until = t.until(dayText(savedUntil, lang))
  const html =
    `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px;background:#F6EEE0;font-family:-apple-system,'Segoe UI','Hiragino Sans','Noto Sans TC',sans-serif;color:#2A221B">` +
    `<div style="max-width:30rem;margin:0 auto;padding:28px 24px;background:#EFE6D2;border:1px solid #D9C9A7">` +
    `<p style="margin:0 0 20px;font-size:16px;line-height:1.7">${esc(t.line)}</p>` +
    `<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#B3331F;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">${esc(t.button)}</a></p>` +
    `<p style="margin:0 0 6px;font-size:14px;color:#5B5246">${esc(until)}</p>` +
    `<p style="margin:0 0 22px;font-size:12px;color:#7A6F60">${esc(t.ignore)}</p>` +
    `<p style="margin:0;padding-top:14px;border-top:1px solid #D9C9A7;font-size:12px;color:#7A6F60">${esc(t.company)} · <a href="mailto:${SUPPORT_EMAIL}" style="color:#7A6F60">${SUPPORT_EMAIL}</a></p>` +
    `</div></body></html>`
  const text = `${t.line}\n\n${t.button}: ${link}\n\n${until}\n${t.ignore}\n\n${t.company} · ${SUPPORT_EMAIL}\n`
  return { to, subject: t.subject, html, text }
}

const countPath = (now: Date, email: string): string => `mail/count/${analyticsDay(now)}/${emailHash(email)}.json`

async function mailsToday(store: OrderStore, email: string, now: Date): Promise<number> {
  try {
    const raw = await store.getObject(countPath(now, email))
    return raw ? Number((JSON.parse(raw.toString('utf8')) as { n?: number }).n) || 0 : 0
  } catch {
    return 0
  }
}
const countMail = (store: OrderStore, email: string, now: Date): Promise<unknown> =>
  casJson<{ n: number }>(store, countPath(now, email), (cur) => ({ n: (cur?.n ?? 0) + 1 })).catch(() => null)

export type MailResult =
  | { ok: true; email: string; pending: boolean }
  | { ok: false; code: 'off' | 'no_store' | 'no_browser' | 'bad_email' | 'no_email' | 'limit' | 'send_failed' }

export interface MailDeps {
  store: OrderStore | null
  mailer: Mailer | null
  env?: NodeJS.ProcessEnv
  now?: Date
}

/** The record a basket token belongs to (created with its token when the browser has none yet). */
async function tokenOfRecord(store: OrderStore, id: string): Promise<string | null> {
  let token: string | null = null
  await casJson<CustomerRecord>(store, `customers/${id}.json`, (cur) => {
    if (!cur) return null
    if (!cur.basket_token || !BASKET_TOKEN_PATTERN.test(cur.basket_token)) return null
    token = cur.basket_token
    return cur
  })
  if (token) return token
  // an email's record that has no basket yet: make its token (and the pointer the link opens by)
  const fresh = newBasketToken()
  await casJson<CustomerRecord>(store, `customers/${id}.json`, (cur) => {
    if (!cur) return null
    if (!cur.basket_token) cur.basket_token = fresh
    token = cur.basket_token
    return cur
  })
  if (token) await store.putObject(`basket/tok/${token}.json`, JSON.stringify({ customer: id }), 'application/json', { ifAbsent: true }).catch(() => false)
  return token
}

async function stamp(store: OrderStore, id: string, now: Date): Promise<void> {
  await casJson<CustomerRecord>(store, `customers/${id}.json`, (cur) => {
    if (!cur) return null
    cur.mailed_at = now.toISOString()
    return cur
  }).catch(() => null)
}

/** "Save to my email". Sends exactly one mail with the private link, or says why not. */
export async function saveToEmail(d: MailDeps, browser: string | null, emailRaw: unknown, language: unknown): Promise<MailResult> {
  if (!d.mailer) return { ok: false, code: 'off' }
  if (!d.store) return { ok: false, code: 'no_store' }
  if (!browser) return { ok: false, code: 'no_browser' }
  if (!validEmail(emailRaw)) return { ok: false, code: 'bad_email' }
  const store = d.store
  const now = d.now ?? new Date()
  const email = normalizeEmail(emailRaw)
  if ((await mailsToday(store, email, now)) >= MAIL_PER_DAY) return { ok: false, code: 'limit' }
  const base = publicUrl(d.env)
  // this browser's record, with its private token
  const ownToken = await ensureBasketToken(store, browser, now)
  const own = await readCustomer(store, await customerIdOf(store, browser))
  if (!own || !ownToken) return { ok: false, code: 'no_store' }
  const eid = emailCustomerId(email)
  let link: string
  let pending = false
  let stampOn = own.id
  if (own.id === eid || own.emails.includes(email)) {
    link = `${base}/b/${ownToken}`
  } else if (own.emails.length > 0) {
    // the record has another address: the new one replaces it once the mail to it has been opened
    const mt = await holdEmailChange(store, own.id, email, now)
    link = `${base}/b/${ownToken}?m=${mt}`
    pending = true
  } else if (await readCustomer(store, eid)) {
    // the address already has a record (another device, a free-gift hold): the link of THAT record, and this browser is not merged into it by typing the address
    const t = await tokenOfRecord(store, eid)
    if (!t) return { ok: false, code: 'no_store' }
    link = `${base}/b/${t}`
    stampOn = eid
  } else {
    const id = await linkEmail(store, browser, email, now)
    const t = (await readCustomer(store, id))?.basket_token ?? ownToken
    link = `${base}/b/${t}`
    stampOn = id
  }
  const sent = await d.mailer.send(basketMail(email, link, new Date(now.getTime() + 30 * 86_400_000), mailLangOf(language)))
  if (!sent) return { ok: false, code: 'send_failed' }
  await countMail(store, email, now)
  await stamp(store, stampOn, now)
  return { ok: true, email: maskEmail(email), pending }
}

/** "Send my link again": to the address on the record, at most 3 a day per address. */
export async function resendLink(d: MailDeps, browser: string | null, language: unknown): Promise<MailResult> {
  if (!d.mailer) return { ok: false, code: 'off' }
  if (!d.store) return { ok: false, code: 'no_store' }
  if (!browser) return { ok: false, code: 'no_browser' }
  const store = d.store
  const now = d.now ?? new Date()
  const rec = await readCustomer(store, await customerIdOf(store, browser))
  // only a browser that is allowed into this page can ask for its link again
  if (!rec || !(rec.basket_browsers ?? []).includes(browser) || rec.emails.length === 0 || !rec.basket_token) return { ok: false, code: 'no_email' }
  const email = rec.emails[rec.emails.length - 1]
  if ((await mailsToday(store, email, now)) >= MAIL_PER_DAY) return { ok: false, code: 'limit' }
  const sent = await d.mailer.send(basketMail(email, `${publicUrl(d.env)}/b/${rec.basket_token}`, new Date(now.getTime() + 30 * 86_400_000), mailLangOf(language)))
  if (!sent) return { ok: false, code: 'send_failed' }
  await countMail(store, email, now)
  await stamp(store, rec.id, now)
  return { ok: true, email: maskEmail(email), pending: false }
}
