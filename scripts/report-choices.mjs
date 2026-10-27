// What do buyers actually choose? Per language: % main, % second, % freestyle, % ordered.
//
//   node scripts/report-choices.mjs --bucket ichirei-orders-581109768569     # reads gs://<bucket>/analytics/*.jsonl (needs gcloud; Cloud Shell has it)
//   node scripts/report-choices.mjs --dir ./some/folder                       # reads <dir>/analytics/*.jsonl, or <dir>/*.jsonl
//   options: --source customer|harness|all (default customer)   --from YYYY-MM-DD   --to YYYY-MM-DD
//
// The files are written by engine/analytics.ts: one JSON line per event, codes and booleans only (no story,
// no names, no order numbers), tied together by a random session id.
//
// Definitions (printed under the table):
//   shown      sessions that were shown a result (status sufficient)
//   chose      sessions that made a final choice (their LAST "chosen" event counts)
//   main / second / freestyle   share of the sessions that chose — which kind of card they picked
//   ordered    share of the SHOWN sessions that went on to order
//   explained  share of the SHOWN sessions that opened a deeper explanation

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Per-language summary of event lines (objects). Pure — the tests call it directly. */
export function summarize(events, { source = 'customer', from = null, to = null } = {}) {
  const sessions = new Map()
  for (const e of events) {
    if (!e || typeof e.session !== 'string' || typeof e.event !== 'string') continue
    if (source !== 'all' && e.source !== source) continue
    const day = typeof e.ts === 'string' ? e.ts.slice(0, 10) : ''
    if ((from && day < from) || (to && day > to)) continue
    const s = sessions.get(e.session) ?? { language: null, shown: false, chosen: null, explained: false, ordered: false, mainSlot: null }
    if (e.event === 'shown' && e.status === 'sufficient') { s.shown = true; s.language = e.language ?? s.language; s.mainSlot = e.main_slot ?? null }
    else if (e.event === 'chosen') s.chosen = e.choice
    else if (e.event === 'explain_opened') s.explained = true
    else if (e.event === 'ordered') s.ordered = true
    sessions.set(e.session, s)
  }
  const byLang = new Map()
  for (const s of sessions.values()) {
    if (!s.shown || !s.language) continue // a choice or an order we never saw the result of cannot be attributed to a language
    const r = byLang.get(s.language) ?? { language: s.language, shown: 0, chose: 0, main: 0, second: 0, freestyle: 0, ordered: 0, explained: 0 }
    r.shown++
    if (s.chosen) { r.chose++; r[s.chosen]++ }
    if (s.ordered) r.ordered++
    if (s.explained) r.explained++
    byLang.set(s.language, r)
  }
  const pct = (n, d) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null)
  return [...byLang.values()]
    .sort((a, b) => a.language.localeCompare(b.language))
    .map((r) => ({ ...r, pct_main: pct(r.main, r.chose), pct_second: pct(r.second, r.chose), pct_freestyle: pct(r.freestyle, r.chose), pct_ordered: pct(r.ordered, r.shown), pct_explained: pct(r.explained, r.shown) }))
}

/** The poem add-on per type: sessions that previewed it, sessions that added it to an order, and orders completed with it. Pure. */
export function summarizePoems(events, { source = 'customer', from = null, to = null } = {}) {
  const byType = new Map()
  const row = (t) => byType.get(t) ?? { type: t, previewed: new Set(), added: new Set() }
  for (const e of events) {
    if (!e || typeof e.session !== 'string' || typeof e.event !== 'string') continue
    if (source !== 'all' && e.source !== source) continue
    const day = typeof e.ts === 'string' ? e.ts.slice(0, 10) : ''
    if ((from && day < from) || (to && day > to)) continue
    if ((e.event === 'poem_previewed' || e.event === 'poem_added') && typeof e.poem_type === 'string') {
      const r = row(e.poem_type)
      ;(e.event === 'poem_previewed' ? r.previewed : r.added).add(e.session)
      byType.set(e.poem_type, r)
    }
  }
  return [...byType.values()].sort((a, b) => a.type.localeCompare(b.type)).map((r) => ({ type: r.type, previewed: r.previewed.size, added: r.added.size }))
}

export function formatPoems(rows) {
  if (rows.length === 0) return '(no poem add-on events in this range)'
  return ['poem type  previewed   added', ...rows.map((r) => `${r.type.padEnd(10)} ${String(r.previewed).padStart(9)} ${String(r.added).padStart(7)}`)].join('\n')
}

export function format(rows) {
  const f = (v) => (v === null ? '   —' : `${v.toFixed(1)}%`.padStart(6))
  const head = ['language', 'shown', 'chose', '% main', '% second', '% freestyle', '% ordered', '% explained']
  const lines = [head.map((h, i) => (i === 0 ? h.padEnd(10) : h.padStart(i === 1 || i === 2 ? 6 : 12))).join(' ')]
  for (const r of rows) {
    lines.push([r.language.padEnd(10), String(r.shown).padStart(6), String(r.chose).padStart(6), f(r.pct_main).padStart(12), f(r.pct_second).padStart(12), f(r.pct_freestyle).padStart(12), f(r.pct_ordered).padStart(12), f(r.pct_explained).padStart(12)].join(' '))
  }
  if (rows.length === 0) lines.push('(no sessions with a shown result in this range)')
  lines.push('', 'shown = sessions shown a result · chose = sessions with a final choice')
  lines.push('% main / second / freestyle = share of the sessions that chose · % ordered, % explained = share of the shown sessions')
  return lines.join('\n')
}

export function parseJsonl(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* a torn line never stops the report */ }
  }
  return out
}

function readDir(dir) {
  const base = existsSync(join(dir, 'analytics')) ? join(dir, 'analytics') : dir
  return readdirSync(base).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().flatMap((f) => parseJsonl(readFileSync(join(base, f), 'utf8')))
}

function readBucket(bucket) {
  const text = execFileSync('gcloud', ['storage', 'cat', `gs://${bucket}/analytics/*.jsonl`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return parseJsonl(text)
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null }
  const dir = opt('dir') ?? (opt('bucket') ? null : process.env.ORDER_STORE_DIR ?? null)
  const bucket = opt('bucket') ?? (dir ? null : process.env.ORDER_BUCKET ?? null)
  if (!dir && !bucket) {
    console.error('usage: node scripts/report-choices.mjs --bucket <name> | --dir <folder>  [--source customer|harness|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD]')
    process.exit(2)
  }
  const events = dir ? readDir(dir) : readBucket(bucket)
  const range = { source: opt('source') ?? 'customer', from: opt('from'), to: opt('to') }
  console.log(format(summarize(events, range)))
  console.log('\n' + formatPoems(summarizePoems(events, range)))
}
