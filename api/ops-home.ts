// The owner's simple dashboard /ops/home (2026-11-15, the architect): the same numbers as /ops/stats, laid out for a quick daily read — four key numbers, the journey,
// a daily chart, free gifts per promotion day, the latest gifts as a spreadsheet (with a CSV download), AI cost and the characters chosen. English only.
// /ops/stats stays as the detailed page ("Engine details"). Same password as /ops. Codes and counts only: never a story, a name, a message or an e-mail.
//
//   GET /ops/home?p=today|d7|d30|all   the page
//   GET /ops/home/orders.csv           the latest gifts as a spreadsheet file

import { checkOpsAuth, sameSitePost, type OpsDeps } from './ops.ts'
import { buildStats, shortRef, type StatsPayload } from './ops-stats.ts'
import { createOrderStore } from '../engine/order-store.ts'
import { analyticsDay } from '../engine/analytics.ts'
import { loadLexicon } from '../engine/lexicon.ts'
import { PERIODS, type OrderStat, type Period } from '../engine/stats.ts'
import { readCustomer, type CustomerRecord, type EventCode } from '../engine/customer.ts'
import type { BasketItem } from '../engine/basket.ts'
import type { OrderStore } from '../engine/order-store.ts'
import { checkNow, countsOf, lastErrorOf, lightOf, modelsOf, plainWords, readEngineLines, replyCountsOf, type ReplyCounts, type Counts, type EngineLine, type LastError, type LightState } from '../engine/engine-log.ts'
import { ENGINE_CONFIG, DEFAULT_FREE_MODEL } from '../engine/engine.ts'
import Anthropic from '@anthropic-ai/sdk'

const DAY_MS = 86_400_000
const headers = (type: string, extra: Record<string, string> = {}) => ({ 'content-type': type, 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', ...extra })
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const n = (v: number): string => new Intl.NumberFormat('en-US').format(v)

let wordCache: Map<string, string> | null = null
/** The reviewed English word of a character (lexicon `en_word`), '' when there is none. */
export function englishWord(kanji: string, fromOrders?: Map<string, string>): string {
  const seen = fromOrders?.get(kanji)
  if (seen) return seen
  if (!wordCache) {
    wordCache = new Map()
    try {
      for (const r of loadLexicon().rows) if (r.raw.en_word && !wordCache.has(r.kanji)) wordCache.set(r.kanji, r.raw.en_word)
    } catch {
      /* no lexicon: no words */
    }
  }
  return wordCache.get(kanji) ?? ''
}

const PERIOD_LABEL: Record<Period, string> = { today: 'Today', d7: '7 days', d30: '30 days', all: 'All time' }
const PERIOD_DAYS: Record<Period, number> = { today: 1, d7: 7, d30: 30, all: 400 }

/** One word for where a gift stands. */
export function statusOf(o: Omit<OrderStat, 'session'>): { label: string; tone: 'ink' | 'soft' | 'red' } {
  if (o.state === 'cancelled') return { label: 'Cancelled', tone: 'soft' }
  if (o.state === 'refunded') return { label: 'Refunded', tone: 'soft' }
  if (o.state === 'refund_due') return { label: 'Refund due', tone: 'red' }
  if (o.state === 'waiting') return { label: 'Waiting for details', tone: 'red' }
  if (o.state === 'unverified') return { label: 'Payment not checked', tone: 'soft' }
  if (o.opened) return { label: 'Opened', tone: 'ink' }
  if (o.collected) return { label: 'Collected', tone: 'ink' }
  return { label: 'Paid', tone: 'ink' }
}

const LANG_WORD = (l: string): string => (l === 'zh-Hant' || l === 'zh-Hans' ? 'zh' : l === 'ja' ? 'ja' : 'en')
/** The language cell: the story's language, and the page's when it differs ("page ja · story zh", Part 6). */
export const langCell = (o: { language: string; page_language?: string }): string => {
  const story = LANG_WORD(o.language)
  const page = o.page_language ? LANG_WORD(o.page_language) : story
  return page === story ? (story === 'zh' ? 'Chinese' : story === 'ja' ? 'Japanese' : 'English') : `page ${page} · story ${story}`
}

const priceOf = (o: Omit<OrderStat, 'session'>): string => {
  if (o.free) return 'Free'
  if (o.price_buyer && o.price_buyer.currency === 'USD') return `$${Number(o.price_buyer.amount).toFixed(2)}`
  if (o.price_buyer) return `${o.price_buyer.amount} ${o.price_buyer.currency}`
  return `¥${n(o.price_jpy)}`
}

const whenOf = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const inPeriod = (o: Omit<OrderStat, 'session'>, p: Period, now: Date): boolean => {
  const t = Date.parse(o.paid_at ?? o.created_at)
  if (p === 'today') return analyticsDay(new Date(t)) === analyticsDay(now)
  return now.getTime() - t < PERIOD_DAYS[p] * DAY_MS
}

const CSS = `*{box-sizing:border-box}body{margin:0;background:#F3EFE5;color:#151311;font:15px/1.55 Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
a{color:#151311}a:hover{color:#C0392B}.serif{font-family:'Zen Old Mincho','Hiragino Mincho ProN','Yu Mincho',Georgia,serif}
.wrap{max-width:1240px;margin:0 auto;padding:36px 28px 64px;display:flex;flex-direction:column;gap:24px}
header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.eyebrow{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#5C564D}
h1{margin:4px 0;font-size:34px;font-weight:700;line-height:1.15}h2{margin:0;font-size:21px;font-weight:700}
.sub{font-size:15px;color:#3B362F}
.tabs{display:flex;flex-wrap:wrap;gap:8px}.tabs a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border:1px solid #CFC8BA;border-radius:22px;text-decoration:none;font-weight:500;font-size:14px}
.tabs a[aria-current=page]{background:#151311;color:#FBF8F1;border-color:#151311}
.card{background:#FBF8F1;padding:24px 26px;box-shadow:0 1px 2px rgba(21,19,17,.06),0 8px 24px rgba(21,19,17,.05);display:flex;flex-direction:column;gap:14px;min-width:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.kpi{gap:6px}.kpi .label{font-size:13px;color:#5C564D}.kpi .big{font-size:44px;font-weight:700;line-height:1}.kpi .big small{font-size:22px;color:#5C564D}.kpi .note{font-size:14px;color:#3B362F}
.meter{height:6px;background:#E6E0D3}.meter i{display:block;height:6px;background:#151311}
.eng-light{display:flex;gap:12px;align-items:center}.eng-dot{display:inline-block;width:22px;height:22px;border-radius:50%;box-shadow:0 0 0 4px rgba(21,19,17,.08)}
.eng th,.eng td{text-align:left;padding:6px 12px 6px 0;font-weight:400}.eng thead th{font-size:13px;color:#5C564D}.eng tbody th{font-weight:500;white-space:nowrap}.eng-last{margin:4px 0 0}.eng-models{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px}
.eng-check{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.eng-btn{min-height:44px;padding:0 20px;border:1px solid #151311;background:#FBF8F1;color:#151311;font:inherit;font-weight:600;border-radius:22px;cursor:pointer}.eng-btn:disabled{opacity:.5;cursor:default}
.alert{background:#FDECEB;color:#8E1F14;border:2px solid #C0392B;padding:12px 16px;font-weight:600}
.row2{display:flex;flex-wrap:wrap;gap:16px}.main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:16px}.side{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:16px}
.step{display:grid;grid-template-columns:200px minmax(0,1fr) 96px;align-items:center;gap:14px;font-size:15px}.step .bar{height:22px;background:#EFE9DC}.step .bar i{display:block;height:22px;background:#151311}
.step .v{text-align:right;font-variant-numeric:tabular-nums}.step .v span{color:#5C564D}
.chart{width:100%;height:auto;display:block}.legend{display:flex;gap:18px;font-size:13px;color:#3B362F}.legend i{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14.5px}th{font-weight:500;font-size:13px;color:#5C564D;text-align:left;padding:8px;border-bottom:1px solid #E2DBCC;white-space:nowrap}
td{padding:11px 8px;border-bottom:1px solid #EFE9DC;white-space:nowrap;font-variant-numeric:tabular-nums}td.k{font-size:22px;color:#C0392B;line-height:1}
.pill{display:inline-block;padding:3px 10px;font-size:13px;background:#151311;color:#FBF8F1}.pill.soft{background:#E6E0D3;color:#3B362F}.pill.red{background:#C0392B;color:#fff}
.mini{display:grid;grid-template-columns:64px minmax(0,1fr) 72px;align-items:center;gap:12px;font-size:14px}.mini .bar{height:8px;background:#EFE9DC}.mini .bar i{display:block;height:8px;background:#151311}
.chars{display:flex;flex-wrap:wrap;gap:10px}.ch{width:72px;padding:10px 0;background:#F3EFE5;text-align:center;display:flex;flex-direction:column;gap:2px}.ch b{font-size:28px;color:#C0392B;line-height:1.1;font-weight:700}.ch span{font-size:12px;color:#3B362F}.ch em{font-style:normal;font-size:12px;color:#5C564D}
.muted{font-size:13px;color:#5C564D}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#E2DBCC}.tick{font-weight:600}table.people td{padding:9px 8px}details summary{cursor:pointer}.tl{white-space:normal;padding:8px 0;min-width:280px}.tl ol{margin:6px 0 0;padding-left:18px;font-size:13px}footer{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;color:#5C564D;border-top:1px solid #E2DBCC;padding-top:18px}
@media(max-width:640px){.wrap{padding:24px 16px 48px}.step{grid-template-columns:1fr 80px}.step .bar{grid-column:1/-1;order:3}h1{font-size:28px}}`

function dailyChart(daily: { day: string; visits: number; paid: number }[]): string {
  const days = daily.slice(-30)
  if (days.length === 0) return '<p class="muted">No visits yet in this period.</p>'
  const W = 760
  const H = 180
  const pad = 26
  const max = Math.max(1, ...days.map((d) => d.visits))
  const bw = (W - pad) / days.length
  const bars = days
    .map((d, i) => {
      const x = pad + i * bw + bw * 0.15
      const w = Math.max(2, bw * 0.7)
      const hv = ((H - 30) * d.visits) / max
      const hp = ((H - 30) * d.paid) / max
      const label = days.length <= 10 || i % Math.ceil(days.length / 8) === 0 ? `<text x="${x + w / 2}" y="${H - 6}" font-size="11" text-anchor="middle" fill="#5C564D">${esc(d.day.slice(5))}</text>` : ''
      return `<rect x="${x}" y="${H - 20 - hv}" width="${w}" height="${hv}" fill="#CFC8BA"><title>${esc(d.day)}: ${d.visits} visits, ${d.paid} gifts</title></rect>` +
        (d.paid ? `<rect x="${x}" y="${H - 20 - hp}" width="${w}" height="${hp}" fill="#C0392B"></rect>` : '') + label
    })
    .join('')
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Visits and gifts per day"><text x="0" y="12" font-size="11" fill="#5C564D">${max}</text><line x1="${pad}" x2="${W}" y1="${H - 20}" y2="${H - 20}" stroke="#E2DBCC"/>${bars}</svg>`
}


// ---------- the engine status card (2026-11-20): is the AI working? ----------

export interface EngineCardData {
  light: LightState
  hour: Counts
  day: Counts
  last: LastError | null
  /** What each kind of call last used (seen in the last 24 hours; the configured models fill the rest). */
  models: Record<string, string>
  /** The free gift back in the last 24 hours (Part 14): tickets started, gifts sent back, second ones refused. */
  reply: ReplyCounts
}

/** The models the site is set to use (the environment, as the engine reads it). */
export const configuredModels = (env: NodeJS.ProcessEnv = process.env): Record<string, string> => ({
  main: ENGINE_CONFIG.MODEL,
  free: env.ICHIREI_FREE_MODEL ?? env.ICHIREI_REFILL_FREE_MODEL ?? DEFAULT_FREE_MODEL,
  review: ENGINE_CONFIG.REVIEW_MODEL,
})

export function engineCardData(lines: EngineLine[], now: Date, configured: Record<string, string> = {}): EngineCardData {
  return { light: lightOf(lines, now), hour: countsOf(lines, now, 3_600_000), day: countsOf(lines, now, 24 * 3_600_000), last: lastErrorOf(lines), models: modelsOf(lines, configured), reply: replyCountsOf(lines, now, 24 * 3_600_000) }
}

const LIGHT_LOOK: Record<LightState['light'], { color: string; en: string; zh: string }> = {
  green: { color: '#2F7D4F', en: 'Working', zh: '正常' },
  amber: { color: '#B7791F', en: 'Some calls are failing', zh: '部分失敗' },
  red: { color: '#C0392B', en: 'Not working', zh: '異常' },
  grey: { color: '#8C867B', en: 'No traffic', zh: '沒有流量' },
}
const KIND_LABEL: Record<string, string> = { main: 'Main card 主推', second: 'Second card 第二張', free: 'Free card 趣字', review: 'Review 審查', replace: 'Refill 補位', film_script: 'Film script 影片腳本', pictures: 'Pictures 圖片', pictures_check: 'Picture check 圖片檢查', poem: 'Poem 詩', gaze: 'Who line 一句話', explain: 'Explain 解說', check: 'Check now 立即檢查' }

export function renderEngineCard(d: EngineCardData, now: Date): string {
  const look = LIGHT_LOOK[d.light.light]
  const row = (label: string, c: Counts) =>
    `<tr><th scope="row">${label}</th><td><b>${n(c.cardsOk)}</b> OK 成功 · <b style="color:${c.cardsFailed ? '#C0392B' : 'inherit'}">${n(c.cardsFailed)}</b> failed 失敗</td><td><b>${n(c.picturesOk)}</b> OK 成功 · <b style="color:${c.picturesFailed ? '#C0392B' : 'inherit'}">${n(c.picturesFailed)}</b> failed 失敗</td></tr>`
  const last = d.last
    ? (() => {
        const w = plainWords(d.last.cls)
        return `<p class="eng-last"><b>${esc(w.en)}</b><br><span>${esc(w.zh)}</span><br><span class="muted">${esc(whenOf(d.last.at))} ET · ${n(d.last.count)}× in 24 h · ${esc(KIND_LABEL[d.last.kind] ?? d.last.kind)} · <code>${esc(d.last.cls)}</code></span></p>`
      })()
    : `<p class="muted">No errors in the last 24 hours. 過去 24 小時沒有錯誤。</p>`
  const models = Object.entries(d.models).filter(([k]) => k !== 'check').map(([k, v]) => `<span class="eng-model">${esc(KIND_LABEL[k] ?? k)}: <b>${esc(v)}</b></span>`).join('')
  const rc = d.reply ?? { started: 0, sent: 0, pairsUsed: 0 }
  const replyLine = `<p class="muted" data-testid="reply-counts" style="margin:10px 0 0">Gift back 贈り返し・回贈 (24 h): started 開始 <b>${n(rc.started)}</b> · sent 送出 <b>${n(rc.sent)}</b> · pairs used 已用的組合 <b>${n(rc.pairsUsed)}</b></p>`
  return `<section class="card" id="engine-status" data-light="${d.light.light}" aria-label="Engine status">` +
    `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center"><h2 class="serif">Engine status <span class="muted" style="font-weight:500">引擎狀態</span></h2>` +
    `<div class="eng-light"><i class="eng-dot" data-testid="engine-light" data-light="${d.light.light}" style="background:${look.color}"></i><span><b data-testid="engine-light-word">${look.en} ${look.zh}</b><br><span class="muted">${esc(d.light.why)} · ${n(d.light.total)} card calls in 30 min</span></span></div></div>` +
    `<div class="scroll"><table class="eng"><thead><tr><th></th><th>Card rounds 卡片</th><th>Pictures 圖片</th></tr></thead><tbody>${row('Last hour 最近 1 小時', d.hour)}${row('Last 24 h 最近 24 小時', d.day)}</tbody></table></div>` +
    `<div><div class="eyebrow">Last error 最近一次錯誤</div>${last}</div>` +
    (models ? `<div><div class="eyebrow">Models in use 使用中的模型</div><div class="eng-models">${models}</div></div>` : '') +
    replyLine +
    `<div class="eng-check"><button type="button" id="engine-check" class="eng-btn">Check now 立即檢查</button><span id="engine-check-result" role="status" aria-live="polite" class="muted">One tiny call to the AI, at most once a minute. 只呼叫一次，每分鐘最多一次。</span></div>` +
    `<script>(function(){var b=document.getElementById('engine-check'),o=document.getElementById('engine-check-result');if(!b)return;b.addEventListener('click',function(){b.disabled=true;o.textContent='Checking… 檢查中…';fetch('/ops/home/engine-check',{method:'POST',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j.limited){o.textContent='Please wait '+j.wait+' s. 請等 '+j.wait+' 秒。'}else if(j.ok){o.textContent='OK 正常 · '+j.model+' · '+(j.ms/1000).toFixed(1)+' s'}else{o.textContent='Failed 失敗: '+j.words.en+' / '+j.words.zh+' ('+j.cls+')'}}).catch(function(){o.textContent='Could not check. 無法檢查。'}).then(function(){b.disabled=false})})})()</script>` +
    `</section>`
}

export function renderHome(payload: StatsPayload, p: Period, now: Date, customers: CustomerRow[] = [], engine: EngineCardData | null = null): string {
  const s = payload.stats.periods[p]
  const f = s.funnel
  const orders = payload.orders.filter((o) => inPeriod(o, p, now))
  const usd = orders.filter((o) => !o.free && o.state === 'paid' && o.price_buyer?.currency === 'USD').reduce((t, o) => t + Number(o.price_buyer?.amount ?? 0), 0)
  const freeGiven = orders.filter((o) => o.free && o.state === 'paid').length
  const promoToday = payload.promo?.days?.[0] ?? null
  const words = new Map<string, string>()
  for (const o of payload.orders) if (o.kanji && o.word_en && !words.has(o.kanji)) words.set(o.kanji, o.word_en)
  const steps: [string, number][] = [
    ['Visited the page', f.visits], ['Chose who and why', f.chips], ['Wrote a moment', f.story], ['Saw a character', f.cards], ['Chose one to give', f.give],
    ['Paid (free or paid)', f.paid], ['Collected the gift', f.collected], ['Receiver opened it', f.opened], ['Shared it', f.shared],
  ]
  const top = Math.max(1, f.visits)
  let worst = ''
  let worstDrop = 0
  for (let i = 1; i < steps.length - 1; i++) {
    const drop = steps[i - 1][1] - steps[i][1]
    if (drop > worstDrop) { worstDrop = drop; worst = `${steps[i - 1][0].toLowerCase()} → ${steps[i][0].toLowerCase()}` }
  }
  const tabs = PERIODS.map((k) => `<a href="/ops/home?p=${k}"${k === p ? ' aria-current="page"' : ''}>${PERIOD_LABEL[k]}</a>`).join('')
  const kpi = (label: string, big: string, note: string, extra = '') => `<div class="card kpi"><div class="label">${label}</div><div class="big serif">${big}</div>${extra}<div class="note">${note}</div></div>`
  const promoKpi = promoToday
    ? kpi('Free gifts today · US + Japan', `${promoToday.given}<small> / ${promoToday.given + promoToday.held + promoToday.left}</small>`, `${promoToday.held} held now · ${promoToday.left} left`,
        `<div class="meter"><i style="width:${Math.round((100 * promoToday.given) / Math.max(1, promoToday.given + promoToday.held + promoToday.left))}%"></i></div>`)
    : kpi('Free gifts given', String(freeGiven), PERIOD_LABEL[p])
  const rows = orders.slice(0, 25).map((o) => {
    const st = statusOf(o)
    const word = o.word_en || englishWord(o.kanji, words)
    return `<tr><td>${esc(whenOf(o.paid_at ?? o.created_at))}</td><td class="k serif">${esc(o.kanji || '—')}</td><td>${esc(word || '')}</td><td>${esc(o.slot === 'free' ? 'Playful' : o.slot ? 'Main' : '')}</td>` +
      `<td>${esc(langCell(o))}</td><td>${esc(o.purpose ?? '')}</td><td>${esc(priceOf(o))}</td><td><span class="pill ${st.tone === 'ink' ? '' : st.tone}">${st.label}</span></td><td class="muted">${esc(shortRef(o.order_ref))}</td></tr>`
  }).join('')
  const promoRows = (payload.promo?.days ?? []).slice(0, 16).map((d) => {
    const total = Math.max(1, d.given + d.held + d.left)
    return `<div class="mini"><div>${esc(d.day.slice(5))}</div><div class="bar"><i style="width:${Math.round((100 * d.given) / total)}%"></i></div><div style="text-align:right"><b>${d.given}</b> / ${total}</div></div>`
  }).join('')
  const chars = (payload.main?.top ?? []).slice(0, 8).map((c) => `<div class="ch"><b class="serif">${esc(c.kanji)}</b><span>${esc(englishWord(c.kanji, words) || '')}</span><em>×${c.count}</em></div>`).join('')
  const perMoment = s.stories > 0 ? s.ai_cost_usd / s.stories : 0
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ICHIREI · Owner</title>` +
    `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><style>${CSS}</style></head><body><div class="wrap">` +
    `<header><div><div class="eyebrow">ICHIREI · Owner</div><h1 class="serif">${PERIOD_LABEL[p]}</h1><div class="sub">Updated ${esc(whenOf(now.toISOString()))} Eastern${payload.promo?.on ? ' · Days of Thanks is on' : ''}${payload.verified ? '' : ' · Shopify could not be checked, payments are unconfirmed'}</div></div><nav class="tabs" aria-label="Period">${tabs}</nav></header>` +
    (engine ? renderEngineCard(engine, now) : '') +
    (payload.attention.count > 0 ? `<div class="alert">${payload.attention.count} paid gift(s) are not complete. Open <a href="/ops">All orders</a>.</div>` : '') +
    `<section class="kpis" aria-label="Key numbers">` +
    kpi('Visitors', n(s.visits), `${n(s.stories)} wrote a moment · ${n(s.cards)} saw a character`) +
    promoKpi +
    kpi('Gifts ordered', n(s.paid), `Paid revenue $${usd.toFixed(2)}${s.revenue_jpy ? ` · ¥${n(s.revenue_jpy)}` : ''}${s.cancelled ? ` · ${s.cancelled} cancelled` : ''}`) +
    kpi('Opened by receivers', n(f.opened), `${n(f.collected)} collected · ${n(f.shared)} shared`) +
    `</section>` +
    `<section class="card" aria-label="The journey"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline"><h2 class="serif">The journey</h2>${worst ? `<div class="muted">Biggest drop: <b style="color:#151311">${esc(worst)}</b></div>` : ''}</div>` +
    steps.map(([label, v]) => `<div class="step"><div>${label}</div><div class="bar"><i style="width:${Math.round((100 * v) / top)}%"></i></div><div class="v"><b>${n(v)}</b> <span>${Math.round((100 * v) / top)}%</span></div></div>`).join('') +
    `</section>` +
    renderCustomersSection(customers) +
    `<div class="row2"><div class="main">` +
    `<section class="card" aria-label="Visits and gifts per day"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline"><h2 class="serif">Day by day</h2><div class="legend"><span><i style="background:#CFC8BA"></i>Visits</span><span><i style="background:#C0392B"></i>Gifts</span></div></div>${dailyChart(payload.stats.periods[p === 'today' ? 'd7' : p].daily)}</section>` +
    `<section class="card" aria-label="Latest gifts"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline"><h2 class="serif">Latest gifts</h2><div style="display:flex;gap:18px;font-size:14px"><a href="/ops/home/orders.csv">Download spreadsheet (CSV)</a><a href="/ops">All orders →</a></div></div>` +
    (rows ? `<div class="scroll"><table><thead><tr><th>When (ET)</th><th>Character</th><th>English</th><th>Card</th><th>Language</th><th>Occasion</th><th>Price</th><th>Status</th><th>Order</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">No gifts in this period yet.</p>`) +
    `</section></div><div class="side">` +
    (promoRows ? `<section class="card" aria-label="Free gifts by day"><h2 class="serif" style="font-size:19px">Free gifts by day</h2><div class="muted">One shared pool for /en and the Japanese page; the language of each gift is in the table below.</div>${promoRows}<div class="muted">A promotion day runs 4:00 a.m. to 3:59 a.m. Eastern.</div></section>` : '') +
    `<section class="card" aria-label="AI cost"><h2 class="serif" style="font-size:19px">AI cost (estimate)</h2><div class="serif" style="font-size:34px;font-weight:700">$${s.ai_cost_usd.toFixed(2)} <span style="font-size:16px;color:#5C564D">¥${n(s.ai_cost_jpy)}</span></div><div class="muted">${perMoment ? `About $${perMoment.toFixed(2)} per moment written. ` : ''}Real bills: Anthropic Console and Google Cloud Billing.</div></section>` +
    (chars ? `<section class="card" aria-label="Characters chosen"><h2 class="serif" style="font-size:19px">Most chosen characters, 30 days</h2><div class="chars">${chars}</div></section>` : '') +
    `</div></div>` +
    `<footer><a href="/ops/customers">Customers (search by email)</a><a href="/ops">All orders</a><a href="/ops/stats">Engine details</a><span>Numbers include our own tests.</span></footer>` +
    `</div></body></html>`
}

// ---------- customers: one row per person (browser or email), what they did, what they saved ----------

/** The steps shown as columns, in the order a customer meets them. */
export const STEP_COLUMNS: { label: string; codes: EventCode[] }[] = [
  { label: 'Visited', codes: ['visited'] },
  { label: 'Wrote', codes: ['tried'] },
  { label: 'Pictures', codes: ['previewed'] },
  { label: 'Saved (e-mail)', codes: ['saved_email'] }, // saves with an e-mail only (2026-11-20): a save without one is not counted
  { label: 'Held free', codes: ['held'] },
  { label: 'Ordered', codes: ['ordered_free', 'ordered_paid'] },
  { label: 'Collected', codes: ['collected'] },
  { label: 'Sent', codes: ['sent'] },
  { label: 'Opened', codes: ['opened'] },
  { label: 'Answered', codes: ['answered'] },
]

const EVENT_WORDS: Record<EventCode, string> = {
  visited: 'Visited the page', tried: 'Wrote a moment', previewed: 'Saw the pictures', saved: 'Saved a gift', saved_email: 'Saved a gift under an e-mail', held: 'Held a free gift', hold_expired: 'Free-gift hold ended',
  hold_used: 'Used the free-gift hold', ordered_free: 'Ordered (free)', ordered_paid: 'Ordered (paid)', collected: 'Collected the gift', sent: 'Sent the link', opened: 'Receiver opened it',
  answered: 'Receiver answered', cancelled: 'Cancelled', refunded: 'Refunded',
}

export interface CustomerRow {
  rec: CustomerRecord
  saved: { kanji: string; word: string; at: string }[]
}

/** Every customer record listed in the last `days` days (newest activity first), with the characters in their basket. Codes and characters only: never a moment's text. */
export async function buildCustomers(store: OrderStore, now: Date, days = 45): Promise<CustomerRow[]> {
  const ids = new Set<string>()
  for (let i = 0; i <= days; i++) {
    const raw = await store.getObject(`ops/customers-${analyticsDay(new Date(now.getTime() - i * DAY_MS))}.jsonl`).catch(() => null)
    for (const line of (raw?.toString('utf8') ?? '').split('\n')) {
      try {
        const j = JSON.parse(line) as { id?: string }
        if (j.id && /^[EV][A-Za-z0-9_-]{22,64}$/.test(j.id)) ids.add(j.id)
      } catch {
        // an empty or broken line
      }
    }
  }
  const recs: CustomerRecord[] = []
  for (const id of ids) {
    const r = await readCustomer(store, id).catch(() => null)
    if (r) recs.push(r)
  }
  // a browser record that was merged into an email's record is shown once, under the email
  const emailBrowsers = new Set(recs.filter((r) => r.id.startsWith('E')).flatMap((r) => r.browsers))
  const shown = recs.filter((r) => r.id.startsWith('E') || !emailBrowsers.has(r.id))
  shown.sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen))
  const rows: CustomerRow[] = []
  for (const rec of shown) {
    const saved: CustomerRow['saved'] = []
    for (const item of rec.basket.slice(0, 8)) {
      const buf = await store.getObject(`basket/${item}.json`).catch(() => null)
      if (!buf) continue
      try {
        const b = JSON.parse(buf.toString('utf8')) as BasketItem
        saved.push({ kanji: b.card?.kanji ?? '', word: b.card?.word ?? '', at: b.created_at })
      } catch {
        // unreadable item
      }
    }
    rows.push({ rec, saved })
  }
  return rows
}

const countOf = (rec: CustomerRecord, codes: EventCode[]): number => rec.events.filter((e) => codes.includes(e.code)).length
const lastAction = (rec: CustomerRecord): string => {
  const e = rec.events[rec.events.length - 1]
  return e ? EVENT_WORDS[e.code] ?? e.code : '—'
}
const who = (rec: CustomerRecord): string => rec.emails[0] ?? `Visitor ${rec.id.slice(1, 7).toUpperCase()}`

export function renderCustomersSection(rows: CustomerRow[], limit = 50): string {
  if (rows.length === 0) return `<section class="card" aria-label="Customers"><h2 class="serif">Customers</h2><p class="muted">No customer records yet. A record starts when someone visits the page.</p></section>`
  const head = `<tr><th>Customer</th><th>Saved gifts</th><th>Last seen</th>${STEP_COLUMNS.map((c) => `<th style="text-align:center">${c.label}</th>`).join('')}<th>Orders</th><th>Last action</th><th>First seen</th></tr>`
  const body = rows.slice(0, limit).map(({ rec, saved }) => {
    const cells = STEP_COLUMNS.map((c) => {
      const k = countOf(rec, c.codes)
      return `<td style="text-align:center">${k === 0 ? '<span class="dot"></span>' : k === 1 ? '<span class="tick">✓</span>' : `<span class="tick">${k}</span>`}</td>`
    }).join('')
    const savedCell = saved.length ? saved.map((x) => `<span class="serif" style="color:#C0392B;font-size:18px" title="${esc(x.word)}">${esc(x.kanji)}</span>`).join(' ') + ` <span class="muted">${saved.length}</span>` : '<span class="muted">—</span>'
    const orders = rec.events.filter((e) => e.order).map((e) => esc(e.order)).join(', ') || '<span class="muted">—</span>'
    const timeline = rec.events.slice(-40).map((e) => `<li><span class="muted">${esc(whenOf(e.at))}</span> ${esc(EVENT_WORDS[e.code] ?? e.code)}${e.order ? ` · ${esc(e.order)}` : ''}</li>`).join('')
    const link = rec.emails[0] ? `<a href="/ops/customers?q=${encodeURIComponent(rec.emails[0])}">${esc(who(rec))}</a>` : esc(who(rec))
    return `<tr><td><details><summary>${link}</summary><div class="tl"><div class="muted">ID ${esc(rec.id.slice(0, 12))}… · ${esc(rec.language ?? '')}${rec.consent.marketing ? ' · said yes to news' : ''}${rec.basket_token ? ' · has a private basket link' : ''}</div><ol>${timeline}</ol></div></details></td>` +
      `<td>${savedCell}</td><td>${esc(whenOf(rec.last_seen))}</td>${cells}<td>${orders}</td><td>${esc(lastAction(rec))}</td><td>${esc(whenOf(rec.first_seen))}</td></tr>`
  }).join('')
  return `<section class="card" aria-label="Customers"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline"><h2 class="serif">Customers</h2>` +
    `<div style="display:flex;gap:18px;font-size:14px"><span class="muted">${rows.length} people, newest activity first</span><a href="/ops/home/customers.csv">Download spreadsheet (CSV)</a></div></div>` +
    `<div class="scroll"><table class="people"><thead>${head}</thead><tbody>${body}</tbody></table></div>` +
    `<div class="muted">✓ = did it once, a number = how many times. Tap a name for the full timeline. A visitor becomes an email once they hold a free gift or pay; saved gifts live in the visitor's basket on their device and on their private basket link, for 30 days.</div></section>`
}

export function customersCsv(rows: CustomerRow[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['customer_id', 'email', 'first_seen', 'last_seen', 'language', ...STEP_COLUMNS.map((c) => c.label.toLowerCase().replace(/ /g, '_')), 'saved_characters', 'orders', 'marketing_ok', 'last_action']
  const lines = rows.map(({ rec, saved }) => [rec.id, rec.emails.join(' '), rec.first_seen, rec.last_seen, rec.language ?? '', ...STEP_COLUMNS.map((c) => countOf(rec, c.codes)),
    saved.map((x) => `${x.kanji} ${x.word}`.trim()).join(' | '), rec.events.filter((e) => e.order).map((e) => e.order).join(' '), rec.consent.marketing ? 'yes' : 'no', lastAction(rec)].map(q).join(','))
  return [head.join(','), ...lines].join('\n') + '\n'
}

export function ordersCsv(payload: StatsPayload): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['paid_at', 'order', 'character', 'english', 'card', 'language', 'occasion', 'price', 'free', 'collected', 'opened', 'status']
  const lines = payload.orders.map((o) => [o.paid_at ?? o.created_at, shortRef(o.order_ref), o.kanji, o.word_en || englishWord(o.kanji), o.slot ?? '', langCell(o), o.purpose ?? '', priceOf(o), o.free ? 'yes' : 'no', o.collected ? 'yes' : 'no', o.opened ? 'yes' : 'no', statusOf(o).label].map(q).join(','))
  return [head.join(','), ...lines].join('\n') + '\n'
}

export function createHomeHandlers(deps: () => OpsDeps) {
  const guard = async (req: Request) => {
    const d = deps()
    const env = d.env ?? process.env
    const denied = await checkOpsAuth(req, env, d.readSecret)
    if (denied) return denied
    if (!d.store) return new Response(JSON.stringify({ error: 'Order storage is not configured', code: 'store_not_configured' }), { status: 503, headers: headers('application/json; charset=utf-8') })
    return { d, env, now: d.now?.() ?? new Date(), store: d.store }
  }
  return {
    async page(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const asked = new URL(req.url).searchParams.get('p') ?? 'today'
      const p: Period = (PERIODS as readonly string[]).includes(asked) ? (asked as Period) : 'today'
      const [payload, customers, lines] = await Promise.all([buildStats(g.d, g.store, g.env, g.now), buildCustomers(g.store, g.now).catch(() => [] as CustomerRow[]), readEngineLines(g.store, g.now, 24).catch(() => [] as EngineLine[])])
      return new Response(renderHome(payload, p, g.now, customers, engineCardData(lines, g.now, configuredModels(g.env))), { status: 200, headers: headers('text/html; charset=utf-8') })
    },
    /** "Check now": ONE tiny call to the AI (the review model, about 10 tokens), at most once a minute. The answer is OK or the error class in words; nothing else is returned. */
    async engineCheck(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      if (!sameSitePost(req)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: headers('application/json; charset=utf-8') })
      const dd = g.d as OpsDeps & { engineClient?: Parameters<typeof checkNow>[0]['client'] }
      const client = dd.engineClient ?? (new Anthropic({ maxRetries: 0, ...(g.env.ANTHROPIC_API_KEY ? { apiKey: g.env.ANTHROPIC_API_KEY } : {}) }) as unknown as Parameters<typeof checkNow>[0]['client'])
      const result = await checkNow({ client, model: g.env.ICHIREI_REVIEW_MODEL ?? ENGINE_CONFIG.REVIEW_MODEL, store: g.store, now: g.now })
      return new Response(JSON.stringify(result), { status: 200, headers: headers('application/json; charset=utf-8') })
    },
    async csv(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const payload = await buildStats(g.d, g.store, g.env, g.now)
      return new Response(ordersCsv(payload), { status: 200, headers: headers('text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="ichirei-gifts.csv"' }) })
    },
    async customersCsv(req: Request): Promise<Response> {
      const g = await guard(req)
      if (g instanceof Response) return g
      const rows = await buildCustomers(g.store, g.now)
      return new Response(customersCsv(rows), { status: 200, headers: headers('text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="ichirei-customers.csv"' }) })
    },
  }
}

export const homeHandlers = createHomeHandlers(() => ({ store: createOrderStore() }))
