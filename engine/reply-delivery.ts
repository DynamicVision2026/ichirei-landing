// Part 14 (2026-11-20): delivering a gift that was sent back. The reply gift is a normal e-gift (made by the order handler); here it is attached to the gift it answers, so the original SENDER
// finds it in マイギフト (「返事が届きました：〈字〉」) and, once a mailer exists, in one e-mail with the link. Codes only in the log: never an address, a name or the story.

import { recordOrderEvent } from './customer.ts'
import { isGiftRecord, giftUrl } from './gift.ts'
import { mailLangOf, type MailLang } from './basket-mail.ts'
import type { Mail, Mailer } from './mailer.ts'
import type { OrderStore } from './order-store.ts'
import { SUPPORT_EMAIL } from '../src/order/support.ts'
import { isReplyTicket, readTicket, senderEmailOf, takeHeld } from './reply.ts'
import { isOrderRecord } from './buyer.ts'

const TEXT: Record<MailLang, { subject: (to: string) => string; line: string; button: string; company: string }> = {
  en: { subject: (to) => (to ? `${to} sent you a character.` : 'A character came back to you.'), line: 'Your gift has been answered with a character of its own. Open it here.', button: 'Open it', company: 'Beyond Culture' },
  ja: { subject: (to) => (to ? `${to}さんから、一字が届きました。` : '一字が届きました。'), line: 'あなたの贈りものに、一字の返事が届きました。こちらから開けます。', button: '開く', company: 'Beyond Culture' },
  'zh-Hant': { subject: (to) => (to ? `${to}送給你一個字。` : '有一個字送回給你。'), line: '你送出的禮物，收到了一個字的回禮。請從這裡打開。', button: '打開', company: 'Beyond Culture' },
}
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The one e-mail to the original sender: 「〈to〉さんから、一字が届きました。」 with the link to the reply gift. */
export function replyMail(to: string, link: string, fromName: string, lang: MailLang): Mail {
  const t = TEXT[lang]
  const subject = t.subject(fromName.trim())
  const html =
    `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px;background:#F6EEE0;font-family:-apple-system,'Segoe UI','Hiragino Sans','Noto Sans TC',sans-serif;color:#2A221B">` +
    `<div style="max-width:30rem;margin:0 auto;padding:28px 24px;background:#EFE6D2;border:1px solid #D9C9A7">` +
    `<p style="margin:0 0 20px;font-size:16px;line-height:1.7">${esc(subject)}</p>` +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.7">${esc(t.line)}</p>` +
    `<p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#B3331F;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">${esc(t.button)}</a></p>` +
    `<p style="margin:0;padding-top:14px;border-top:1px solid #D9C9A7;font-size:12px;color:#7A6F60">${esc(t.company)} · <a href="mailto:${SUPPORT_EMAIL}" style="color:#7A6F60">${SUPPORT_EMAIL}</a></p>` +
    `</div></body></html>`
  return { to, subject, html, text: `${subject}\n\n${t.line}\n${link}\n\n${t.company} · ${SUPPORT_EMAIL}\n` } as Mail
}

export interface DeliverDeps {
  store: OrderStore
  mailer: Mailer | null
  env?: NodeJS.ProcessEnv
  now: Date
}

/**
 * Attach the reply gift to the gift it answers (once): the original gift records the answer (its character and the reply gift's token), the sender's timeline gets 「answered」, the ticket is used up,
 * and — with a mailer — the sender gets one e-mail. Safe to call again: a gift that already has its answer is left as it is.
 */
export async function deliverReply(d: DeliverDeps, ticketId: string, replyToken: string): Promise<'delivered' | 'already' | 'missing'> {
  const ticket = await readTicket(d.store, ticketId)
  const rg = await d.store.get(replyToken).catch(() => null)
  if (!ticket || !isGiftRecord(rg)) return 'missing'
  const og = await d.store.get(ticket.gift_token).catch(() => null)
  if (!isGiftRecord(og)) return 'missing'
  if (og.back) return 'already'
  const at = d.now.toISOString()
  const page = rg.animation_id ? `/a/${rg.animation_id}` : null
  await d.store.put(og.token, { ...og, reply: { text: '', at, char: rg.glyph, gift: rg.token }, answered_at: og.answered_at ?? at, back: { char: rg.glyph, at, gift: rg.token, page } })
  if (isReplyTicket(ticket) && ticket.status !== 'used') await d.store.put(ticket.id, { ...ticket, status: 'used', used_at: at })
  await recordOrderEvent(d.store, og.order_ref, 'answered', d.now).catch(() => {})
  if (d.mailer) {
    try {
      const order = await d.store.get(og.order_ref).catch(() => null)
      const to = senderEmailOf(isOrderRecord(order) ? order : null, og)
      if (to) await d.mailer.send(replyMail(to, giftUrl(rg.token, d.env ?? process.env), rg.from ?? '', mailLangOf(og.language)))
    } catch {
      // the mail is a convenience: the answer is in マイギフト either way
    }
  }
  return 'delivered'
}


/** The receiver has opened the inbox link of their address: every gift sent back that waited for it is delivered now. Returns how many. */
export async function deliverHeldFor(d: DeliverDeps, emails: string[]): Promise<number> {
  let n = 0
  for (const e of [...new Set(emails)]) {
    for (const h of await takeHeld(d.store, e)) {
      try {
        if ((await deliverReply(d, h.ticket, h.gift_token)) === 'delivered') n++
      } catch {
        // one that cannot be delivered now is left; the receiver can open the link again
      }
    }
  }
  return n
}
