// The owner's page /ops (Part E3, private): today's orders first, a print-ready card PDF per order and "all of today's cards" as one PDF, a CSV of today's
// wooden orders for the workshop, marks for printed / shipped, and the e-gift reminders. HTTP Basic Auth: ICHIREI_OPS_PASSWORD (Secret Manager) — without it
// every /ops request is refused (503), never open. No Shopify write of any kind; the only things written are our own records (printed_at / shipped_at).
//
//   GET  /ops                       the list (HTML)
//   GET  /ops/card/<order_ref>.pdf  the card of one order
//   GET  /ops/cards/today.pdf       every card of today's orders, one PDF
//   GET  /ops/wooden-today.csv      today's wooden orders for the workshop
//   POST /ops/mark                  { order_ref, what: printed | shipped }
//   POST /ops/egift/run             send the due reminders, delete the addresses 90 days after shipping
//
// The list shows codes the owner needs (order number, size, remembrance, where it goes, address status) — never a story. The CSV carries the character in its
// carving form and, for an e-gift, the receiver's name and address as they typed them (the one place an address leaves our records — for the parcel).

import { createHash, timingSafeEqual } from 'node:crypto'
import { analyticsDay } from '../engine/analytics.ts'
import { isAnimationRecord } from '../engine/animation.ts'
import { flaggedEgifts, mailerFromEnv, purgeExpiredAddresses, readJsonl, runEgiftReminders, type Mailer, type OrderIndexEntry } from '../engine/egift-ops.ts'
import { readArt } from '../engine/film-art.ts'
import { isGiftRecord, type GiftRecord } from '../engine/gift.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import type { OrderRecord } from '../engine/order.ts'
import { readShippingAddresses, SHIPPING_SOURCE, type ShippingResult } from '../engine/shipping.ts'
import { AdminTokenCache, loadTrackConfig, readAdminSecret, readSecret, type TrackDeps } from '../engine/track.ts'
import { loadArtwork } from '../engine/render/artwork.ts'
import { cardsPdf } from '../engine/render/card.ts'
import { PACKAGE_SKU, SHIPS, WOODEN, type PackageId } from '../src/order/packages.ts'

const baseHeaders = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', ...extra })
const text = (status: number, body: string, type: string, extra: Record<string, string> = {}) => new Response(body, { status, headers: baseHeaders({ 'content-type': type, ...extra }) })
const jsonRes = (status: number, body: unknown) => text(status, JSON.stringify(body), 'application/json; charset=utf-8')

export interface OpsDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  mailer?: Mailer
  /** Tests only: the Secret Manager reader. */
  readSecret?: (name: string, env: NodeJS.ProcessEnv) => Promise<string>
  /** The Shopify address lookup (read-only Tracking app); tests replace it. Default: the same app and secret /track uses. */
  shipping?: (refs: string[]) => Promise<ShippingResult>
}

const sha = (s: string) => createHash('sha256').update(s).digest()

export const OPS_SECRET_NAME = 'ICHIREI_OPS_PASSWORD'

let cachedPassword: { value: string; at: number } | null = null

/** The environment wins (local runs, tests); otherwise Secret Manager at request time, kept for a minute — a secret that does not exist yet can never break a deploy, /ops just stays closed (503). */
async function opsPassword(env: NodeJS.ProcessEnv, read: (name: string, env: NodeJS.ProcessEnv) => Promise<string>): Promise<string> {
  const direct = env[OPS_SECRET_NAME]?.trim()
  if (direct) return direct
  if (cachedPassword && Date.now() - cachedPassword.at < 60_000) return cachedPassword.value
  try {
    const value = await read(OPS_SECRET_NAME, env)
    cachedPassword = { value, at: Date.now() }
    return value
  } catch {
    return ''
  }
}

/** null = allowed; otherwise the refusal. The password is compared in constant time; any user name is accepted. */
export async function checkOpsAuth(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
  read: (name: string, env: NodeJS.ProcessEnv) => Promise<string> = readSecret,
): Promise<Response | null> {
  const password = await opsPassword(env, read)
  if (!password) return jsonRes(503, { error: 'The owner page is not configured (ICHIREI_OPS_PASSWORD).', code: 'ops_not_configured' })
  const header = req.headers.get('authorization') ?? ''
  const m = /^Basic\s+(.+)$/i.exec(header)
  let given = ''
  if (m) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8')
      given = decoded.slice(decoded.indexOf(':') + 1)
    } catch {
      given = ''
    }
  }
  if (m && timingSafeEqual(sha(given), sha(password))) return null
  return text(401, 'Authentication required', 'text/plain; charset=utf-8', { 'www-authenticate': 'Basic realm="ICHIREI ops", charset="UTF-8"' })
}

/** A browser that has cached the password sends it with any request: a POST must come from this very site (Sec-Fetch-Site / Origin). */
export function sameSitePost(req: Request): boolean {
  const sfs = req.headers.get('sec-fetch-site')
  if (sfs) return sfs === 'same-origin' || sfs === 'none'
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === new URL(req.url).host || origin === (req.headers.get('x-forwarded-host') ? `https://${req.headers.get('x-forwarded-host')}` : '')
  } catch {
    return false
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const csvCell = (v: unknown) => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // a spreadsheet must never read a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const SIZE_LABEL: Record<string, string> = { 'ICHIREI-DIGITAL': '① デジタル', 'ICHIREI-CARD': '② カード', 'ICHIREI-SIMPLE': '③ 木札', 'ICHIREI-STANDARD': '④ 版木' }
const SHIP_LABEL: Record<string, string> = { none: '郵送なし', me: '自分に', direct: '相手に直接', egift: 'eギフト' }
const sizeOf = (sku: string): PackageId | null => ((Object.entries(PACKAGE_SKU).find(([, v]) => v === sku)?.[0] as PackageId | undefined) ?? null)

interface Row {
  entry: OrderIndexEntry
  record: (OrderRecord & { ops?: { printed_at?: string; shipped_at?: string } }) | null
  gift: GiftRecord | null
}

async function loadRows(store: OrderStore, days: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (const day of days) {
    const entries = await readJsonl<OrderIndexEntry>(store, `ops/orders-${day}.jsonl`)
    for (const entry of entries) {
      let record: Row['record'] = null
      let gift: GiftRecord | null = null
      try {
        record = (await store.get(entry.order_ref)) as Row['record']
        if (entry.token) {
          const g = await store.get(entry.token)
          gift = isGiftRecord(g) ? g : null
        }
      } catch {
        // a row with a missing record is still listed
      }
      rows.push({ entry, record, gift })
    }
  }
  return rows
}

const lastDays = (now: Date, n: number): string[] => Array.from({ length: n }, (_, i) => analyticsDay(new Date(now.getTime() - i * 86_400_000)))

async function artworkFor(store: OrderStore, row: Row, env: NodeJS.ProcessEnv) {
  if (!row.gift) return null
  const anim = await store.get(row.gift.animation_id)
  if (!isAnimationRecord(anim)) return null
  let art = null
  try {
    art = await readArt(store, anim.id)
  } catch {
    art = null
  }
  return loadArtwork(store, row.gift, anim, art, env)
}

const adminTokens = new AdminTokenCache()

/** The default address lookup: the read-only ICHIREI Tracking app, the way /track asks for its orders. */
function shopifyShipping(env: NodeJS.ProcessEnv): (refs: string[]) => Promise<ShippingResult> {
  return (refs) => {
    const { config } = loadTrackConfig(env)
    const td: TrackDeps | null = config ? { config, secret: () => readAdminSecret(env) } : null
    return readShippingAddresses(refs, td, adminTokens)
  }
}

export function createOpsHandlers(deps: () => OpsDeps) {
  const guard = async (req: Request): Promise<{ d: OpsDeps; env: NodeJS.ProcessEnv; now: Date; store: OrderStore } | Response> => {
    const d = deps()
    const env = d.env ?? process.env
    const denied = await checkOpsAuth(req, env, d.readSecret)
    if (denied) return denied
    if (!d.store) return jsonRes(503, { error: 'Order storage is not configured', code: 'store_not_configured' })
    return { d, env, now: d.now?.() ?? new Date(), store: d.store }
  }

  return {
    async page(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { now, store } = g
      const days = lastDays(now, 8)
      const rows = await loadRows(store, days)
      const today = days[0]
      const flagged = await flaggedEgifts(store, now)
      const line = (r: Row) => {
        const e = r.entry
        const size = sizeOf(e.size_code)
        const eg = r.gift?.egift
        const addr = !eg ? '—' : eg.state === 'received' ? '受け取り済み' : flagged.some((f) => f.token === r.gift?.token) ? '⚠ 30日たっても未入力' : '入力待ち'
        const ops = r.record?.ops
        return `<tr><td>${esc(e.order_ref)}</td><td>${esc(SIZE_LABEL[e.size_code] ?? e.size_code)}</td><td>${e.memorial ? '偲ぶ' : ''}</td><td>${esc(SHIP_LABEL[e.ship_to] ?? e.ship_to)}</td><td>${esc(addr)}</td><td>${esc(e.delivery_date)}</td>` +
          `<td>${size && size !== 'digital' ? `<a href="/ops/card/${esc(e.order_ref)}.pdf">カードPDF</a>` : ''}</td>` +
          `<td>${ops?.printed_at ? '印刷済み' : size && size !== 'digital' ? `<button name="what" value="printed" data-ref="${esc(e.order_ref)}">印刷した</button>` : ''}</td>` +
          `<td>${ops?.shipped_at ? '発送済み' : size && SHIPS[size] ? `<button name="what" value="shipped" data-ref="${esc(e.order_ref)}">発送した</button>` : ''}</td></tr>`
      }
      const todays = rows.filter((r) => r.entry.ts && analyticsDay(new Date(r.entry.ts)) === today)
      const earlier = rows.filter((r) => !todays.includes(r))
      const table = (list: Row[]) => `<div class="wide"><table><thead><tr><th>注文番号</th><th>サイズ</th><th>偲ぶ</th><th>お届け</th><th>相手の住所</th><th>希望日</th><th>カード</th><th>印刷</th><th>発送</th></tr></thead><tbody>${list.map(line).join('') || '<tr><td colspan="9">なし</td></tr>'}</tbody></table></div>`
      const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ICHIREI ops</title>` +
        `<style>body{font:15px/1.6 system-ui,'Hiragino Sans',sans-serif;margin:1.2rem;color:#2a221b;background:#efe6d2}table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #d7ccb4;padding:.35rem .5rem;text-align:left;white-space:nowrap}.wide{overflow-x:auto}a,button{color:#2a221b}button{cursor:pointer}h1,h2{font-weight:600}.bar a,.bar button{margin-right:.8rem}</style></head><body>` +
        `<h1>ICHIREI 注文</h1><p class="bar"><a href="/ops/cards/today.pdf">今日のカードをまとめてPDF</a><a href="/ops/wooden-today.csv">今日の木札・版木 CSV</a><button id="egift-run">eギフトの確認を今すぐ実行</button></p>` +
        `<h2>今日（${esc(today)}）</h2>${table(todays)}<h2>これまで（直近7日）</h2>${table(earlier)}` +
        `<p>${flagged.length ? `⚠ 住所が30日たっても入力されていないeギフト: ${flagged.length}件（自動の返金はしません。ご判断ください）` : ''}</p>` +
        `<script>document.addEventListener('click',async(e)=>{const b=e.target.closest('button');if(!b)return;if(b.id==='egift-run'){const r=await fetch('/ops/egift/run',{method:'POST'});alert(await r.text());return}const ref=b.dataset.ref;if(!ref)return;const r=await fetch('/ops/mark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order_ref:ref,what:b.value})});if(r.ok)location.reload();else alert('失敗しました')})</script></body></html>`
      return text(200, html, 'text/html; charset=utf-8')
    },

    async card(req: Request, ref: string): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { env, now, store } = g
      const rows = (await loadRows(store, lastDays(now, 60))).filter((r) => r.entry.order_ref === ref)
      const row = rows.at(-1)
      const size = row ? sizeOf(row.entry.size_code) : null
      if (!row || !size || size === 'digital') return jsonRes(404, { error: 'not_found' })
      const a = await artworkFor(store, row, env)
      if (!a) return jsonRes(404, { error: 'not_found' })
      return new Response(new Uint8Array(await cardsPdf([a], env)), { status: 200, headers: baseHeaders({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="ichirei-card-${ref}.pdf"` }) })
    },

    async cardsToday(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { env, now, store } = g
      const today = analyticsDay(now)
      const rows = (await loadRows(store, [today])).filter((r) => { const s = sizeOf(r.entry.size_code); return s && s !== 'digital' })
      const arts = []
      for (const r of rows) {
        const a = await artworkFor(store, r, env)
        if (a) arts.push(a)
      }
      if (arts.length === 0) return jsonRes(404, { error: 'no_cards_today' })
      return new Response(new Uint8Array(await cardsPdf(arts, env)), { status: 200, headers: baseHeaders({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="ichirei-cards-${today}.pdf"` }) })
    },

    async woodenCsv(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { now, store } = g
      const today = analyticsDay(now)
      const head = ['order_ref', 'size', 'character_to_carve', 'remembrance', 'ship_to', 'recipient_name', 'country', 'postal', 'region', 'address', 'phone', 'address_source', 'gift_packaging', 'no_price_slip']
      const out = [head.join(',')]
      const rows = (await loadRows(store, [today])).filter((r) => {
        const size = sizeOf(r.entry.size_code)
        return size && WOODEN[size]
      })
      // "send to me" / "send directly": the address is the one typed at the Shopify checkout; ask the read-only Tracking app for exactly these orders.
      const atShopify = rows.filter((r) => r.entry.ship_to !== 'egift' && !r.gift?.egift?.address).map((r) => r.entry.order_ref)
      const shop = atShopify.length ? await (g.d.shipping ?? shopifyShipping(g.env))(atShopify) : { found: new Map(), failure: null }
      for (const r of rows) {
        const p = r.record?.production
        const a = r.gift?.egift?.address
        const sa = shop.found.get(r.entry.order_ref)
        const direct = r.entry.ship_to === 'direct'
        const source = a ? 'e-gift form' : r.entry.ship_to === 'egift' ? 'e-gift: not entered yet' : sa ? SHIPPING_SOURCE.read : shop.failure ? SHIPPING_SOURCE[shop.failure] : SHIPPING_SOURCE.notFound
        out.push([
          r.entry.order_ref, SIZE_LABEL[r.entry.size_code] ?? r.entry.size_code, p?.glyph_to_carve ?? r.gift?.glyph ?? '', r.entry.memorial ? 'yes' : 'no', r.entry.ship_to,
          a?.name ?? sa?.name ?? '', a?.country ?? sa?.country ?? '', a?.postal ?? sa?.postal ?? '', a?.region ?? sa?.region ?? '',
          a ? [a.line1, a.line2].filter(Boolean).join(' ') : sa?.address ?? '', a?.phone ?? sa?.phone ?? '',
          source, direct ? 'yes' : 'no', direct ? 'yes' : 'no',
        ].map(csvCell).join(','))
      }
      return text(200, '﻿' + out.join('\r\n') + '\r\n', 'text/csv; charset=utf-8', { 'content-disposition': `attachment; filename="ichirei-wooden-${today}.csv"` })
    },

    async mark(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      if (!sameSitePost(req)) return jsonRes(403, { error: 'cross_site' })
      const { now, store } = g
      let body: { order_ref?: unknown; what?: unknown }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return jsonRes(400, { error: 'bad_json' })
      }
      const ref = typeof body.order_ref === 'string' ? body.order_ref : ''
      const what = body.what === 'printed' || body.what === 'shipped' ? body.what : null
      if (!/^IC-\d{8}-[A-Z0-9]{8}$/.test(ref) || !what) return jsonRes(400, { error: 'bad_request' })
      const rec = (await store.get(ref)) as (OrderRecord & { ops?: Record<string, string> }) | null
      if (!rec) return jsonRes(404, { error: 'not_found' })
      const iso = now.toISOString()
      await store.put(ref, { ...rec, ops: { ...(rec.ops ?? {}), [`${what}_at`]: iso } })
      // shipped also starts the 90 days after which the receiver's address is deleted
      if (what === 'shipped' && rec.gift_token) {
        const gift = await store.get(rec.gift_token)
        if (isGiftRecord(gift)) await store.put(rec.gift_token, { ...gift, shipped_at: iso })
      }
      return jsonRes(200, { ok: true })
    },

    async egiftRun(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      if (!sameSitePost(req) && !req.headers.get('authorization')) return jsonRes(403, { error: 'cross_site' })
      const { d, env, now, store } = g
      const run = await runEgiftReminders(store, d.mailer ?? mailerFromEnv(env), now, env)
      const purged = await purgeExpiredAddresses(store, now)
      const note = env.ICHIREI_MAIL_WEBHOOK_URL ? '' : '（メール送信サービスが未設定のため、送信はされていません）'
      return text(200, `お知らせの対象 ${run.due}件・送信 ${run.sent}件・未送信 ${run.unsent}件${note}\n削除した住所 ${purged}件`, 'text/plain; charset=utf-8')
    },
  }
}

export const handlers = createOpsHandlers(() => ({ store: createOrderStore() }))
