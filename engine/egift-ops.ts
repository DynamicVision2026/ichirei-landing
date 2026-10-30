// What the owner needs to see and do around orders and e-gifts (Part D / E of the 2026-10-30 ticket). Nothing here writes to Shopify.
//
//   ops/orders-<day>.jsonl   one line per order, written at order time: order_ref, the receiver page's token, the size, where it goes, remembrance,
//                            the requested delivery date. NO story, no names, no address, no e-mail.
//   ops/egift.jsonl          one line per e-gift order (the token), so the reminders know whom to look at.
//
// The reminders: 7 days after an e-gift order whose receiver has not typed an address, the sender gets ONE e-mail. There is no mail service wired yet:
// the mailer is a small interface, and by default (no ICHIREI_MAIL_WEBHOOK_URL) nothing is sent — the run only reports who is due. With the webhook set,
// each mail is POSTed there as { to, subject, text } (a Make / Zapier / own-function URL that sends it).

import { analyticsDay } from './analytics.ts'
import { addressExpired, flaggedNoAddress, giftUrl, isGiftRecord, purgeAddress, reminderDue, type GiftRecord } from './gift.ts'
import type { OrderStore } from './order-store.ts'
import type { OrderRecord } from './order.ts'

export interface OrderIndexEntry {
  ts: string
  order_ref: string
  token: string | null
  size_code: string
  ship_to: string
  memorial: boolean
  delivery_date: string
}

export const ordersIndexPath = (now: Date): string => `ops/orders-${analyticsDay(now)}.jsonl`
export const EGIFT_INDEX_PATH = 'ops/egift.jsonl'

/** Best effort: the owner's list must never be a reason for an order to fail. */
export async function recordOrderIndex(store: OrderStore, record: OrderRecord, now: Date): Promise<void> {
  try {
    const p = record.production
    const entry: OrderIndexEntry = { ts: now.toISOString(), order_ref: record.order_ref, token: record.gift_token ?? null, size_code: p.size_code ?? '', ship_to: p.ship_to ?? 'none', memorial: p.certificate.memorial === true, delivery_date: p.delivery_date }
    await store.appendJsonl(ordersIndexPath(now), entry)
    if (p.ship_to === 'egift' && record.gift_token) await store.appendJsonl(EGIFT_INDEX_PATH, { ts: now.toISOString(), token: record.gift_token })
  } catch (err) {
    console.error('[ichirei-ops] index append failed', err instanceof Error ? err.message : err)
  }
}

export async function readJsonl<T = Record<string, unknown>>(store: OrderStore, path: string): Promise<T[]> {
  const buf = await store.getObject(path)
  if (!buf) return []
  const out: T[] = []
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      // a torn line never stops the list
    }
  }
  return out
}

// ---- the mailer ---------------------------------------------------------------------------------------------------------------------------------

export interface Mail {
  to: string
  subject: string
  text: string
}
export type Mailer = (mail: Mail) => Promise<boolean>

/** Sends nothing (no mail service is configured): the run reports who is due. */
export const noMailer: Mailer = async () => false

export function webhookMailer(url: string, fetchImpl: typeof fetch = fetch): Mailer {
  return async (mail) => {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mail), signal: AbortSignal.timeout(15_000) })
      return res.ok
    } catch {
      return false
    }
  }
}
export const mailerFromEnv = (env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Mailer => (env.ICHIREI_MAIL_WEBHOOK_URL?.trim() ? webhookMailer(env.ICHIREI_MAIL_WEBHOOK_URL.trim(), fetchImpl) : noMailer)

export function reminderMail(g: GiftRecord, env: NodeJS.ProcessEnv = process.env): Mail | null {
  const to = g.egift?.sender_email
  if (!to) return null
  const link = giftUrl(g.token, env)
  if (g.language === 'ja') return { to, subject: '【一字礼】まだ受け取り住所が入力されていません', text: `eギフトでお贈りした一字について、受け取る方の住所がまだ入力されていません。\n\n下のリンクをもう一度お送りいただくか、あなたご自身がこのリンクを開いて住所を入力することもできます。\n${link}\n\nこのお知らせは一度だけお送りしています。` }
  if (g.language === 'en') return { to, subject: '[ICHIREI] Your e-gift is still waiting for an address', text: `The person you gave your e-gift to has not entered a delivery address yet.\n\nYou can send them the link again, or open it yourself and enter the address for them:\n${link}\n\nThis is the only reminder we will send.` }
  return { to, subject: '【一字禮】對方還沒有填寫收件地址', text: `你以電子禮物贈送的一字，對方還沒有填寫收件地址。\n\n你可以再把下面的連結傳給對方，或自己打開連結代為填寫地址。\n${link}\n\n這是唯一一封提醒信。` }
}

export interface ReminderRun {
  due: number
  sent: number
  /** Due but not sent: no mail service is configured, or it refused. */
  unsent: number
}

/** Send the one reminder to every sender whose e-gift has waited 7 days. Marks a reminder as sent ONLY when the mailer accepted it. Never throws. */
export async function runEgiftReminders(store: OrderStore, mail: Mailer, now: Date, env: NodeJS.ProcessEnv = process.env): Promise<ReminderRun> {
  const run: ReminderRun = { due: 0, sent: 0, unsent: 0 }
  try {
    for (const { token } of await readJsonl<{ token: string }>(store, EGIFT_INDEX_PATH)) {
      const g = await store.get(token)
      if (!isGiftRecord(g) || !reminderDue(g, now)) continue
      run.due++
      const m = reminderMail(g, env)
      if (m && (await mail(m))) {
        await store.put(token, { ...g, egift: { ...g.egift!, reminded_at: now.toISOString() } })
        run.sent++
      } else run.unsent++
    }
  } catch (err) {
    console.error('[ichirei-egift] reminder run failed', err instanceof Error ? err.message : err)
  }
  console.log(`[ichirei-egift] reminders ${JSON.stringify(run)}`)
  return run
}

/** E-gifts the owner has to look at: no address after 30 days (the owner decides; no automatic refund). */
export async function flaggedEgifts(store: OrderStore, now: Date): Promise<GiftRecord[]> {
  const out: GiftRecord[] = []
  for (const { token } of await readJsonl<{ token: string }>(store, EGIFT_INDEX_PATH)) {
    const g = await store.get(token)
    if (isGiftRecord(g) && flaggedNoAddress(g, now)) out.push(g)
  }
  return out
}

/** Delete the receiver's address 90 days after the order shipped. Returns how many were deleted. */
export async function purgeExpiredAddresses(store: OrderStore, now: Date): Promise<number> {
  let n = 0
  try {
    for (const { token } of await readJsonl<{ token: string }>(store, EGIFT_INDEX_PATH)) {
      const g = await store.get(token)
      if (isGiftRecord(g) && addressExpired(g, now)) {
        await store.put(token, purgeAddress(g))
        n++
      }
    }
  } catch (err) {
    console.error('[ichirei-egift] purge failed', err instanceof Error ? err.message : err)
  }
  return n
}

