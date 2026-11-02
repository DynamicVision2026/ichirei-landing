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
import { readPayments, readShippingAddresses, SHIPPING_SOURCE, type PaymentResult, type ShippingResult } from '../engine/shipping.ts'
import { cancelOrder, changeCharacter, changePoemFormat, editNames, windowOf, type ChangeDeps, type WindowInfo } from '../engine/change-window.ts'
import { createPoemHandler } from './poem.ts'
import { mergeStory, type Candidate } from '../engine/contract.ts'
import type { Palette } from '../engine/palette.ts'
import type { generatePoem } from '../engine/poem.ts'
import { POEM_TYPES, PRINTED_CARD, poemTypesFor, type PoemType } from '../src/order/packages.ts'
import type { StoredPoem } from '../engine/order.ts'
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
  /** The payment lookup (when it was paid, cancelled, refunded): tests replace it. */
  payments?: (refs: string[]) => Promise<PaymentResult>
  /** Tests: the poem writer (production: the same one as the page's poem step). */
  generatePoem?: typeof generatePoem
  palette?: Palette
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

const SIZE_LABEL: Record<string, string> = { 'ICHIREI-EGIFT': '一字礼 eギフト', 'ICHIREI-SIMPLE': '木札', 'ICHIREI-STANDARD': '版木', 'ICHIREI-DIGITAL': '（旧）デジタル', 'ICHIREI-CARD': '（旧）カード' }
const SHIP_LABEL: Record<string, string> = { none: '郵送なし', me: '自分に', direct: '相手に直接', egift: 'eギフト' }
const sizeOf = (sku: string): PackageId | null => ((Object.entries(PACKAGE_SKU).find(([, v]) => v === sku)?.[0] as PackageId | undefined) ?? null)

interface Row {
  entry: OrderIndexEntry
  record: OrderRecord | null
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

/** One poem for the character of an order, written and checked by the same code as the page's poem step (api/poem.ts); null when it cannot be written. */
async function makePoemFor(store: OrderStore, d: OpsDeps, now: Date, rec: OrderRecord, cand: Candidate, type: PoemType): Promise<StoredPoem | null> {
  const er = rec.engine_result
  const handler = createPoemHandler(() => ({ store, now: () => now, generate: d.generatePoem, palette: d.palette }))
  const res = await handler(new Request('http://internal/api/poem', {
    method: 'POST',
    body: JSON.stringify({ story: rec.story, ...(rec.follow_ups?.length ? { follow_ups: rec.follow_ups } : {}), language: rec.production.language, relationship: er.relationship ?? undefined, direction: er.direction ?? undefined, occasion: er.occasion ?? undefined, purpose: er.purpose ?? undefined, state: er.state ?? undefined, occasion_detail: er.occasion_detail ?? undefined, kanji: cand.kanji, gaze: cand.one_line_gaze, type, source: 'ops' }),
  }))
  if (!res.ok) return null
  const out = (await res.json()) as { poem_id?: string }
  if (!out.poem_id) return null
  return ((await store.get(out.poem_id).catch(() => null)) as StoredPoem | null) ?? null
}

const adminTokens = new AdminTokenCache()

function trackDepsOf(env: NodeJS.ProcessEnv): TrackDeps | null {
  const { config } = loadTrackConfig(env)
  return config ? { config, secret: () => readAdminSecret(env) } : null
}

/** The default address lookup: the read-only ICHIREI Tracking app, the way /track asks for its orders. */
function shopifyShipping(env: NodeJS.ProcessEnv): (refs: string[]) => Promise<ShippingResult> {
  return (refs) => readShippingAddresses(refs, trackDepsOf(env), adminTokens)
}

/** The default payment lookup (when it was paid, cancelled or refunded): the same read-only app; no customer data. */
function shopifyPayments(env: NodeJS.ProcessEnv): (refs: string[]) => Promise<PaymentResult> {
  return (refs) => readPayments(refs, trackDepsOf(env), adminTokens)
}

/** The user name typed at the Basic Auth prompt: the log's "who". */
const whoOf = (req: Request): string => {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!m) return 'owner'
  try {
    return Buffer.from(m[1], 'base64').toString('utf8').split(':')[0] || 'owner'
  } catch {
    return 'owner'
  }
}

interface Classified extends Row {
  win: WindowInfo
}

/** The 24-hour window of every row (payment time from Shopify when it can be asked). */
async function classify(rows: Row[], d: OpsDeps, env: NodeJS.ProcessEnv, now: Date): Promise<{ rows: Classified[]; verified: boolean }> {
  const refs = rows.map((r) => r.entry.order_ref)
  const pay: PaymentResult = refs.length ? await (d.payments ?? shopifyPayments(env))(refs) : { found: new Map(), failure: null }
  const verified = pay.failure === null
  return { verified, rows: rows.map((r) => ({ ...r, win: windowOf(r.record, verified ? (pay.found.get(r.entry.order_ref) ?? null) : 'unverified', now) })) }
}

/** The sizes whose printed card is made by the owner (木札, 版木). The e-gift's card is a PDF the receiver prints at home; it is never in a print list. */
const isCardSize = (r: Row) => {
  const s = sizeOf(r.entry.size_code)
  return !!s && PRINTED_CARD[s]
}

/** 製作に進めるもの: the window has closed and the order is not cancelled. */
const ready = (r: Classified) => r.win.phase === 'closed'

const POEM_LABEL: Record<string, string> = { tanka: '短歌', haiku: '俳句', tang: '漢詩（唐詩の形）', ci: '宋詞', en: '自由詩' }

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
      const { d, env, now, store } = g
      const days = lastDays(now, 8)
      const { rows, verified } = await classify(await loadRows(store, days), d, env, now)
      const flagged = await flaggedEgifts(store, now)
      const common = (r: Classified) => {
        const e = r.entry
        return `<td>${esc(e.order_ref)}</td><td>${esc(SIZE_LABEL[e.size_code] ?? e.size_code)}</td><td>${e.memorial ? '偲ぶ' : ''}</td><td>${esc(SHIP_LABEL[e.ship_to] ?? e.ship_to)}</td>`
      }
      const addrOf = (r: Classified) => {
        const eg = r.gift?.egift
        return !eg ? '—' : eg.state === 'received' ? '受け取り済み' : flagged.some((f) => f.token === r.gift?.token) ? '⚠ 30日たっても未入力' : '入力待ち'
      }
      const readyLine = (r: Classified) => {
        const e = r.entry
        const size = sizeOf(e.size_code)
        const ops = r.record?.ops
        return `<tr>${common(r)}<td>${esc(addrOf(r))}</td><td>${esc(e.delivery_date)}</td>` +
          `<td>${size && PRINTED_CARD[size] ? `<a href="/ops/card/${esc(e.order_ref)}.pdf">カードPDF</a>` : ''}</td>` +
          `<td>${ops?.printed_at ? '印刷済み' : size && PRINTED_CARD[size] ? `<button name="what" value="printed" data-ref="${esc(e.order_ref)}">印刷した</button>` : ''}</td>` +
          `<td>${ops?.shipped_at ? '発送済み' : size && SHIPS[size] ? `<button name="what" value="shipped" data-ref="${esc(e.order_ref)}">発送した</button>` : ''}</td></tr>`
      }
      const readyTable = (list: Classified[]) =>
        `<div class="wide"><table><thead><tr><th>注文番号</th><th>サイズ</th><th>偲ぶ</th><th>お届け</th><th>相手の住所</th><th>希望日</th><th>カード</th><th>印刷</th><th>発送</th></tr></thead>` +
        `<tbody>${list.map(readyLine).join('') || '<tr><td colspan="9">なし</td></tr>'}</tbody></table></div>`
      const openLine = (r: Classified) => {
        const rec = r.record
        const p = rec?.production
        const shown = (rec?.shown_characters ?? []).filter((x) => x.candidate.kanji !== p?.kanji)
        const charOpts = shown.map((x) => `<option value="${esc(x.candidate.kanji)}">${esc(x.candidate.kanji)}（候補${x.set}）</option>`).join('')
        const poemUsed = (rec?.ops?.poem_format_changes ?? 0) >= 1
        const hasPoem = (p?.poems.length ?? 0) > 0
        const offered = p ? poemTypesFor(p.language, mergeStory(rec?.story ?? '', rec?.follow_ups ?? [])) : []
        const poemOpts = Object.entries(POEM_LABEL).filter(([k]) => k !== p?.poems[0]?.type && (offered as readonly string[]).includes(k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
        const log = (rec?.ops?.log ?? []).map((l) => `<li>${esc(l.at.slice(0, 16).replace('T', ' '))} ${esc(l.who)} ${esc(l.action)} ${esc(l.detail)}</li>`).join('')
        const canMsg = !!p && SHIPS[p.package] && p.ship_to !== 'me' && p.ship_to !== 'none'
        return `<tr class="inwindow"><td>${esc(r.entry.order_ref)}</td><td>${esc(SIZE_LABEL[r.entry.size_code] ?? r.entry.size_code)}</td><td>${r.entry.memorial ? '偲ぶ' : ''}</td>` +
          `<td>変更受付中（あと${r.win.hours_left}時間）${r.win.verified ? '' : '<br><small>注文作成時刻から計算</small>'}</td>` +
          `<td><details><summary>変更する</summary><div class="chg" data-ref="${esc(r.entry.order_ref)}">` +
          `<p>現在の字: <b>${esc(p?.glyph_to_carve ?? '')}</b></p>` +
          `<p><label>字を変更 <select name="kanji" ${charOpts ? '' : 'disabled'}>${charOpts || '<option>他に候補なし</option>'}</select></label> <button data-act="character" ${charOpts ? '' : 'disabled'}>この字に変更（詩は書き直します）</button></p>` +
          `<p><label>詩の形式（1回だけ） <select name="poem_type" ${hasPoem && !poemUsed ? '' : 'disabled'}>${poemOpts}</select></label> <button data-act="poem" ${hasPoem && !poemUsed ? '' : 'disabled'}>形式を変更</button>${poemUsed ? ' <small>変更済み</small>' : ''}</p>` +
          `<p><label>差出人 <input name="sender" value="${esc(p?.sender_name ?? '')}" maxlength="40"></label> <label>受取人 <input name="receiver" value="${esc(p?.receiver_name ?? '')}" maxlength="40"></label>` +
          `${canMsg ? ` <label>メッセージ（60字まで） <input name="message" value="${esc(p?.gift_message ?? '')}" maxlength="60"></label>` : ''} <button data-act="names">名前${canMsg ? '・メッセージ' : ''}を保存</button></p>` +
          `<p><button data-act="cancel">キャンセルとして記録</button> <small>返金はShopifyで行ってください（ここでは何も返金されません）</small></p>` +
          `<small>Shopifyの注文に入っている字・詩の情報は変わりません。製作はこのページのデータで行います。</small>` +
          `${log ? `<ul class="log">${log}</ul>` : ''}</div></details></td></tr>`
      }
      const openTable = (list: Classified[]) =>
        `<div class="wide"><table class="openT"><thead><tr><th>注文番号</th><th>サイズ</th><th>偲ぶ</th><th>状態</th><th>操作</th></tr></thead><tbody>${list.map(openLine).join('') || '<tr><td colspan="5">なし</td></tr>'}</tbody></table></div>`
      const otherLine = (r: Classified) => `<tr class="inwindow">${common(r)}<td>${r.win.phase === 'cancelled' ? 'キャンセル' : r.win.phase === 'unpaid' ? '入金を確認できません' : '製作なし（eギフトなど）'}</td></tr>`
      const otherTable = (list: Classified[]) =>
        `<div class="wide"><table><thead><tr><th>注文番号</th><th>サイズ</th><th>偲ぶ</th><th>お届け</th><th>状態</th></tr></thead><tbody>${list.map(otherLine).join('') || '<tr><td colspan="5">なし</td></tr>'}</tbody></table></div>`
      const readyRows = rows.filter((r) => ready(r) && isCardSize(r))
      const openRows = rows.filter((r) => r.win.phase === 'open')
      const otherRows = rows.filter((r) => r.win.phase === 'cancelled' || r.win.phase === 'unpaid' || (ready(r) && !isCardSize(r)))
      const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ICHIREI ops</title>` +
        `<style>body{font:15px/1.6 system-ui,'Hiragino Sans',sans-serif;margin:1.2rem;color:#2a221b;background:#efe6d2}table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #d7ccb4;padding:.35rem .5rem;text-align:left;white-space:nowrap}.wide{overflow-x:auto}a,button{color:#2a221b}button{cursor:pointer}h1,h2{font-weight:600}.bar a,.bar button{margin-right:.8rem}tr.inwindow td{color:#8a8070;background:#f4efe3}tr.inwindow summary{cursor:pointer;color:#2a221b}.chg{white-space:normal;min-width:30rem;color:#2a221b}.chg p{margin:.4rem 0}.note{background:#fff;border:1px solid #d7ccb4;padding:.5rem .8rem}.log{font-size:.85rem}</style></head><body>` +
        `<h1>ICHIREI 注文</h1>` +
        `<p class="note">ご注文から24時間は「変更受付中」です。この間に製作は始めません。24時間が過ぎてキャンセルのないものだけが、下のPDFと木札・版木CSVに入ります。</p>` +
        `${verified ? '' : '<p class="note">⚠ Shopifyから入金を確認できませんでした。いまは注文を作成した時刻から24時間で数えています（入金が確認できていない注文も含まれます）。</p>'}` +
        `<p class="bar"><a href="/ops/cards/today.pdf">製作に進めるカードをまとめてPDF</a><a href="/ops/wooden-today.csv">製作に進める木札・版木 CSV</a><button id="egift-run">eギフトの確認を今すぐ実行</button></p>` +
        `<h2>製作に進めるもの（${readyRows.length}）</h2>${readyTable(readyRows)}` +
        `<h2>変更受付中（${openRows.length}）</h2>${openTable(openRows)}` +
        `<h2>そのほか（キャンセル・入金未確認・製作なし ${otherRows.length}）</h2>${otherTable(otherRows)}` +
        `<p>${flagged.length ? `⚠ 住所が30日たっても入力されていないeギフト: ${flagged.length}件（自動の返金はしません。ご判断ください）` : ''}</p>` +
        `<script>document.addEventListener('click',async(e)=>{const b=e.target.closest('button');if(!b)return;if(b.id==='egift-run'){const r=await fetch('/ops/egift/run',{method:'POST'});alert(await r.text());return}` +
        `const act=b.dataset.act;if(act){const box=b.closest('.chg');const f=(n)=>box.querySelector('[name='+n+']');if(act==='cancel'&&!confirm('この注文をキャンセルとして記録します。製作の対象から外れます。よろしいですか？'))return;` +
        `const body={order_ref:box.dataset.ref,action:act};if(act==='character')body.kanji=f('kanji').value;if(act==='poem')body.poem_type=f('poem_type').value;if(act==='names'){body.sender=f('sender').value;body.receiver=f('receiver').value;if(f('message'))body.message=f('message').value}` +
        `b.disabled=true;const r=await fetch('/ops/change',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));alert(r.ok?'変更しました: '+(j.message||''):'できませんでした: '+(j.error||r.status));location.reload();return}` +
        `const ref=b.dataset.ref;if(!ref)return;const r=await fetch('/ops/mark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order_ref:ref,what:b.value})});if(r.ok)location.reload();else alert('失敗しました')})</script></body></html>`
      return text(200, html, 'text/html; charset=utf-8')
    },

    async card(req: Request, ref: string): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { d, env, now, store } = g
      const { rows } = await classify((await loadRows(store, lastDays(now, 60))).filter((r) => r.entry.order_ref === ref).slice(-1), d, env, now)
      const row = rows.at(-1)
      const size = row ? sizeOf(row.entry.size_code) : null
      if (!row || !size || !PRINTED_CARD[size]) return jsonRes(404, { error: 'not_found' })
      // nothing is made before the change window closes, and nothing for a cancelled order
      if (row.win.phase === 'open') return jsonRes(409, { error: 'まだ変更受付中です（支払いから24時間は製作しません）', code: 'window_open', ends_at: row.win.ends_at })
      if (row.win.phase !== 'closed') return jsonRes(409, { error: 'キャンセル済み、または入金を確認できない注文です', code: row.win.phase })
      const a = await artworkFor(store, row, env)
      if (!a) return jsonRes(404, { error: 'not_found' })
      return new Response(new Uint8Array(await cardsPdf([a], env)), { status: 200, headers: baseHeaders({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="ichirei-card-${ref}.pdf"` }) })
    },

    /** Every card that may be made now: the window has closed, not cancelled, not printed yet. */
    async cardsToday(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { d, env, now, store } = g
      const today = analyticsDay(now)
      const { rows } = await classify(await loadRows(store, lastDays(now, 8)), d, env, now)
      const arts = []
      for (const r of rows.filter((x) => ready(x) && isCardSize(x) && !x.record?.ops?.printed_at)) {
        const a = await artworkFor(store, r, env)
        if (a) arts.push(a)
      }
      if (arts.length === 0) return jsonRes(404, { error: 'no_cards_ready' })
      return new Response(new Uint8Array(await cardsPdf(arts, env)), { status: 200, headers: baseHeaders({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="ichirei-cards-${today}.pdf"` }) })
    },

    /** The workshop's list: wooden orders whose window has closed, not cancelled, not shipped yet. */
    async woodenCsv(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const { d, env, now, store } = g
      const today = analyticsDay(now)
      const head = ['order_ref', 'size', 'character_to_carve', 'remembrance', 'ship_to', 'recipient_name', 'country', 'postal', 'region', 'address', 'phone', 'address_source', 'gift_packaging', 'no_price_slip', 'payment']
      const out = [head.join(',')]
      const rows = (await classify(await loadRows(store, lastDays(now, 8)), d, env, now)).rows.filter((r) => {
        const size = sizeOf(r.entry.size_code)
        return ready(r) && size && WOODEN[size] && !r.record?.ops?.shipped_at
      })
      // "send to me" / "send directly": the address is the one typed at the Shopify checkout; ask the read-only Tracking app for exactly these orders.
      const atShopify = rows.filter((r) => r.entry.ship_to !== 'egift' && !r.gift?.egift?.address).map((r) => r.entry.order_ref)
      const shop = atShopify.length ? await (d.shipping ?? shopifyShipping(env))(atShopify) : { found: new Map(), failure: null }
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
          source, direct ? 'yes' : 'no', direct ? 'yes' : 'no', r.win.verified ? 'paid' : 'unverified (Shopify could not be asked)',
        ].map(csvCell).join(','))
      }
      return text(200, '﻿' + out.join('\r\n') + '\r\n', 'text/csv; charset=utf-8', { 'content-disposition': `attachment; filename="ichirei-wooden-${today}.csv"` })
    },

    /** The 24-hour change window: change the character (from those already shown), the poem format (once), the names and message, or flag the order cancelled. */
    async change(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      if (!sameSitePost(req)) return jsonRes(403, { error: 'cross_site' })
      const { d, env, now, store } = g
      let body: Record<string, unknown>
      try {
        body = (await req.json()) as Record<string, unknown>
      } catch {
        return jsonRes(400, { error: 'bad_json' })
      }
      const ref = typeof body.order_ref === 'string' ? body.order_ref : ''
      if (!/^IC-\d{8}-[A-Z0-9]{8}$/.test(ref)) return jsonRes(400, { error: 'bad_request' })
      const rec = (await store.get(ref).catch(() => null)) as OrderRecord | null
      if (!rec || !rec.production) return jsonRes(404, { error: 'not_found' })
      const win = (await classify([{ entry: { order_ref: ref } as OrderIndexEntry, record: rec, gift: null }], d, env, now)).rows[0].win
      if (win.phase !== 'open') {
        const why = win.phase === 'closed' ? '支払いから24時間を過ぎているため、変更できません（受注製作のため、お客様都合の変更は受けられません）。当方の不備の修正は別途行います。' : win.phase === 'cancelled' ? 'この注文はキャンセル済みです。' : '入金を確認できない注文です。'
        return jsonRes(409, { error: why, code: win.phase === 'closed' ? 'window_closed' : win.phase })
      }
      const cd: ChangeDeps = { store, now, who: whoOf(req), makePoem: (r, cand, type) => makePoemFor(store, d, now, r, cand, type), palette: d.palette }
      const action = body.action
      const res =
        action === 'character' ? await changeCharacter(cd, rec, typeof body.kanji === 'string' ? body.kanji : '')
        : action === 'poem' ? await changePoemFormat(cd, rec, (POEM_TYPES as readonly string[]).includes(String(body.poem_type)) ? (body.poem_type as PoemType) : ('' as PoemType))
        : action === 'names' ? await editNames(cd, rec, { sender: body.sender, receiver: body.receiver, message: body.message })
        : action === 'cancel' ? await cancelOrder(cd, rec)
        : null
      if (!res) return jsonRes(400, { error: 'bad_action' })
      return res.ok ? jsonRes(200, { ok: true, message: res.message }) : jsonRes(422, { error: res.error, code: res.code })
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
      const rec = (await store.get(ref)) as OrderRecord | null
      if (!rec) return jsonRes(404, { error: 'not_found' })
      // only what may be made can be marked: not while the change window is open, not for a cancelled order
      const win = (await classify([{ entry: { order_ref: ref } as OrderIndexEntry, record: rec, gift: null }], g.d, g.env, now)).rows[0].win
      if (win.phase !== 'closed') return jsonRes(409, { error: win.phase === 'open' ? 'まだ変更受付中です' : 'キャンセル済み、または入金を確認できない注文です', code: win.phase })
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
