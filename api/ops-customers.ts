// /ops/customers (2026-11-15, private, behind the same password as /ops): look a customer up by email or by Shopify order name. It shows the timeline (codes and times), the free-gift holds,
// the orders (with a link to the order in the Shopify admin) and how many gifts the basket holds and since when. NEVER a moment's text, a story, a name or an address: those live in the preview
// and order records, and nothing here reads them. Read-only; nothing is written.
//
//   GET /ops/customers            the search page
//   GET /ops/customers?q=…        the answer for an email or an order name (#1018 / 1018)

import { createOrderStore } from '../engine/order-store.ts'
import { customerOfOrder, emailCustomerId, readCustomer, validEmail, normalizeEmail, type CustomerRecord } from '../engine/customer.ts'
import { emailHash } from '../engine/customer.ts'
import { promoDayKey, promoWindow } from '../engine/promo.ts'
import type { HoldRecord } from '../engine/promo-holds.ts'
import { checkOpsAuth, type OpsDeps } from './ops.ts'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const respond = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } })

const CSS = `body{font:15px/1.6 system-ui,'Hiragino Sans','Noto Sans JP',sans-serif;margin:0;color:#2a221b;background:#efe6d2}header{padding:.9rem 1.2rem;border-bottom:1px solid #d7ccb4}h1{font-size:1.2rem;margin:0}
main{padding:0 1.2rem 3rem;max-width:960px;margin:0 auto}h2{font-size:1.05rem;margin:1.6rem 0 .5rem}table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #d7ccb4;padding:.35rem .6rem;text-align:left;font-size:.9rem}
input[type=text]{font:inherit;padding:.4rem .6rem;width:20rem;max-width:100%}button{font:inherit;padding:.4rem .9rem}.note{color:#8a8070;font-size:.85rem}a{color:#b7410e}`

const jst = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
  } catch {
    return iso
  }
}
const addDays = (key: string, n: number): string => {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The Shopify admin's order list, searched by the order name (the store handle comes from SHOPIFY_STORE_DOMAIN). */
export function adminOrderLink(env: NodeJS.ProcessEnv, name: string): string {
  const handle = (env.SHOPIFY_STORE_DOMAIN || 'soul-id-2.myshopify.com').trim().replace(/\.myshopify\.com$/i, '')
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/orders?query=${encodeURIComponent(name.replace(/^#/, ''))}`
}

export function createCustomerHandlers(deps: () => OpsDeps) {
  return {
    async page(req: Request): Promise<Response> {
      const d = deps()
      const env = d.env ?? process.env
      const denied = await checkOpsAuth(req, env, d.readSecret)
      if (denied) return denied
      const store = d.store
      const now = d.now?.() ?? new Date()
      const q = (new URL(req.url, 'http://localhost').searchParams.get('q') ?? '').trim().slice(0, 254)
      let body = ''
      if (!store) body = '<p>注文の保存先が設定されていません。</p>'
      else if (q) {
        let id: string | null = null
        let email: string | null = null
        if (validEmail(q)) {
          email = normalizeEmail(q)
          id = emailCustomerId(email)
        } else if (/^#?\d{3,8}$/.test(q)) id = await customerOfOrder(store, q)
        const rec: CustomerRecord | null = id ? await readCustomer(store, id) : null
        if (!rec) body = '<p data-testid="customer-none">該当するお客様の記録はありません。</p>'
        else {
          const emails = rec.emails
          // the holds of this customer's emails, over the promotion's days
          const win = promoWindow(env)
          const holds: { day: string; h: HoldRecord }[] = []
          if (win) {
            let day = promoDayKey(new Date(win.from))
            const last = promoDayKey(new Date(Math.min(now.getTime(), win.until)))
            for (let n = 0; n < 16 && day <= last; n++, day = addDays(day, 1)) {
              for (const e of emails) {
                const raw = await store.getObject(`promo/${day}/holds/${emailHash(e)}.json`).catch(() => null)
                try {
                  if (raw) holds.push({ day, h: JSON.parse(raw.toString('utf8')) as HoldRecord })
                } catch {
                  // a broken hold is skipped
                }
              }
            }
          }
          // the basket: how many and since when (never what is in it)
          const items: string[] = []
          for (const itemId of rec.basket) {
            const raw = await store.getObject(`basket/${itemId}.json`).catch(() => null)
            try {
              const it = raw ? (JSON.parse(raw.toString('utf8')) as { created_at?: string }) : null
              if (it?.created_at) items.push(it.created_at)
            } catch {
              // skipped
            }
          }
          const orders = rec.events.filter((e) => (e.code === 'ordered_free' || e.code === 'ordered_paid') && e.order)
          body =
            `<h2>お客様</h2><table data-testid="customer-summary"><tbody>` +
            `<tr><th>メール</th><td>${esc(emails.join(', ') || '—')}</td></tr>` +
            `<tr><th>初回 / 最終</th><td>${esc(jst(rec.first_seen))} / ${esc(jst(rec.last_seen))}</td></tr>` +
            `<tr><th>言語</th><td>${esc(rec.language ?? '—')}</td></tr>` +
            `<tr><th>お知らせの同意</th><td>${rec.consent.marketing ? `あり（${esc(rec.consent.at ? jst(rec.consent.at) : '')}）` : 'なし'}</td></tr>` +
            `<tr><th>入口のコード</th><td>${esc(rec.from_code ?? '—')}</td></tr>` +
            `<tr><th>保存した贈りもの</th><td data-testid="customer-basket">${items.length}件${items.length ? `（${esc(items.map(jst).join(' / '))}）` : ''}</td></tr>` +
            `</tbody></table>` +
            `<h2>ご注文</h2>` +
            (orders.length
              ? `<table data-testid="customer-orders"><thead><tr><th>時刻</th><th>Shopify</th><th>内容</th><th>金額</th></tr></thead><tbody>${orders
                  .map((o) => `<tr><td>${esc(jst(o.at))}</td><td><a href="${esc(adminOrderLink(env, o.order as string))}" target="_blank" rel="noopener noreferrer">${esc(o.order)}</a></td><td>${esc(o.code === 'ordered_free' ? '無料' : '有料')} · ${esc(o.ref ?? '')}</td><td>${typeof o.amount === 'number' ? esc(o.amount) : ''}</td></tr>`)
                  .join('')}</tbody></table>`
              : '<p class="note">ご注文はありません。</p>') +
            `<h2>無料ギフトの確保</h2>` +
            (holds.length
              ? `<table data-testid="customer-holds"><thead><tr><th>米東部の日</th><th>状態</th><th>回数</th><th>コード</th><th>期限</th></tr></thead><tbody>${holds
                  .map((x) => `<tr><td>${esc(x.day)}</td><td>${esc(x.h.status)}</td><td>${esc(x.h.count)}</td><td>${esc(x.h.code ?? '')}</td><td>${esc(jst(x.h.checkout_until && Date.parse(x.h.checkout_until) > Date.parse(x.h.expires_at) ? x.h.checkout_until : x.h.expires_at))}</td></tr>`)
                  .join('')}</tbody></table>`
              : '<p class="note">確保の記録はありません。</p>') +
            `<h2>経過</h2><table data-testid="customer-timeline"><thead><tr><th>時刻</th><th>出来事</th><th>注文</th></tr></thead><tbody>${rec.events
              .map((e) => `<tr><td>${esc(jst(e.at))}</td><td>${esc(e.code)}</td><td>${esc(e.order ?? '')}</td></tr>`)
              .reverse()
              .join('')}</tbody></table>` +
            `<p class="note">ひと場面の文章、お名前、住所はここには表示されません。</p>`
        }
      }
      const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>お客様 · ICHIREI</title><style>${CSS}</style></head><body>` +
        `<header><h1>お客様</h1></header><main><p><a href="/ops">← 注文の一覧（/ops）</a> · <a href="/ops/stats">数字</a></p>` +
        `<form method="get" action="/ops/customers"><input type="text" name="q" value="${esc(q)}" placeholder="メールアドレス または 注文番号（#1018）" data-testid="customer-q"> <button type="submit">探す</button></form>${body}</main></body></html>`
      return respond(200, html)
    },
  }
}

export const customerHandlers = createCustomerHandlers(() => ({ store: createOrderStore() }))
