// Run the REAL engine over the internal story test database and write a CSV for human review.
//
//   node --experimental-strip-types scripts/run-story-db.mjs --dry-run          # plan + cost estimate, no model call
//   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/run-story-db.mjs --limit 5     # a small calibration run
//   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/run-story-db.mjs               # all (≈144 runs)
//
// Options
//   --db <csv>           the story database (default test-data/private/ICHIREI_Story_Test_DB_v1.csv)
//   --out <dir>          where story-run-YYYYMMDD.csv (+ .jsonl, + -summary.txt) go (default test-data/private)
//   --only main|memorial|all   which rows (default all = the `main` rows + the rows with receiver_alive = no)
//   --limit N            the first N selected rows only (calibration)     --ids 0011,0042   only these ids
//   --concurrency N      parallel runs (default 3)                         --timeout-s N     per run (default 300)
//   --resume             skip ids already in today's .jsonl (a long run can be continued)
//   --price-in / --price-out   USD per million tokens (default 3 / 15 — an ASSUMPTION, override with the real rates)
//
// PRIVACY: the database is retellings of copyrighted stories, for internal testing only. This repo is PUBLIC, so the
// data and every output live under test-data/ (git-ignored and docker-ignored) — never commit them, never publish them.
// The rows are never logged by the engine (it logs the referee/review lines without story text; this script silences them).
//
// What it runs: language ja; relationship / direction from the row's category, receiver and direction columns (metadata only);
// occasion = `memorial` for rows with receiver_alive = no, otherwise the first entry of `occasions` (mapped to the engine's
// codes), or `thanks` (= seasonal_thanks) when empty.
//
// Results are for human review, not pass/fail. Flags raised automatically: cinnabar on a memorial result, a celebration
// character on a memorial result, the memorial data path (certificate.memorial + ichirei_memorial) broken, a main kanji that
// repeats in more than 10% of the runs (sameness), and any run that errors or times out.

import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine, ENGINE_CONFIG } from '../engine/engine.ts'
import { loadPalette, parseCsv } from '../engine/palette.ts'
import { lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { isMemorial, mainGlyphTone } from '../src/order/memorial.ts'
import { COPY } from '../src/demo/i18n.ts'

const root = join(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}

const DB = opt('db', join(root, 'test-data', 'private', 'ICHIREI_Story_Test_DB_v1.csv'))
const OUT = opt('out', join(root, 'test-data', 'private'))
const ONLY = opt('only', 'all')
const LIMIT = Number(opt('limit', '0')) || 0
const IDS = opt('ids', '') ? new Set(opt('ids', '').split(',').map((s) => s.trim())) : null
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '3')) || 3)
const TIMEOUT_S = Number(opt('timeout-s', '300')) || 300
const PRICE_IN = Number(opt('price-in', '3'))
const PRICE_OUT = Number(opt('price-out', '15'))
const SAMEWORD_SHARE = 0.1
/** Sameness is a property of a whole set: with fewer runs than this a share of 10% means nothing, so it is not raised. */
const SAMENESS_MIN_RUNS = 20

// ---- the database ------------------------------------------------------------------------------------------------
export function loadDb(path) {
  const [header, ...body] = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

/** The rows to run: every `main` row, plus every row whose receiver has died (receiver_alive = no). */
export function selectRows(rows, only = 'all') {
  const main = (r) => r.test_use === 'main'
  const dead = (r) => r.receiver_alive === 'no'
  return rows.filter((r) => (only === 'main' ? main(r) : only === 'memorial' ? dead(r) : main(r) || dead(r)))
}

// ---- the engine context from the row's metadata (no reading of the story) ---------------------------------------------
const OCCASION_CODE = {
  thanks: 'seasonal_thanks', apology: 'seasonal_thanks', birthday: 'birthday_milestone', kanreki: 'birthday_milestone',
  anniversary: 'wedding', wedding: 'wedding', new_start: 'school_career', retirement: 'retirement_farewell',
  farewell: 'retirement_farewell', parents_day: 'parent_day',
}

export function occasionFor(row) {
  if (row.receiver_alive === 'no') return { code: 'memorial', from: 'receiver_alive=no' }
  const first = (row.occasions ?? '').split(/[/,、;|]/).map((s) => s.trim()).find((s) => s && s !== 'none' && s !== '—')
  const word = first || 'thanks'
  return { code: OCCASION_CODE[word] ?? 'seasonal_thanks', from: first ? word : 'thanks (empty)' }
}

export function relationshipFor(row) {
  const receiver = (row.sender_to_receiver ?? '').split('→').pop() ?? ''
  const has = (re) => re.test(receiver)
  switch (row.category) {
    case 'parents':
      if (has(/義/)) return 'in_law'
      if (has(/母|両親/)) return 'parent_mother'
      return 'parent_father'
    case 'children': return 'child'
    case 'grandparents': return 'grandparent'
    case 'siblings': return 'sibling'
    case 'friends': return 'friend'
    case 'mentor': return 'mentor'
    case 'work': return 'work'
    case 'partner': return has(/恋人|彼女|彼氏/) ? 'romance' : 'spouse'
    default: return has(/猫|犬/) ? 'pet' : has(/初恋/) ? 'romance' : 'community'
  }
}

const DIRECTION_BY_CATEGORY = { parents: 'up', grandparents: 'up', mentor: 'up', children: 'down', partner: 'across', siblings: 'across', friends: 'across', work: 'across', other: 'across' }
export const directionFor = (row) => (['up', 'down', 'across'].includes(row.direction) ? row.direction : (DIRECTION_BY_CATEGORY[row.category] ?? 'across'))

// ---- helpers -------------------------------------------------------------------------------------------------------
const quote = (cell) => {
  const s = String(cell ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
export const toCsv = (lines) => lines.map((cells) => cells.map(quote).join(',')).join('\n') + '\n'
const today = () => new Date().toISOString().slice(0, 10).replaceAll('-', '')
const LABELS = COPY.ja.slotLabels
const palette = loadPalette()

const COLUMNS = [
  'id', 'category', 'sender_to_receiver', 'receiver_alive', 'occasion_db', 'occasion_used', 'relationship_used', 'direction_used',
  'status', 'kanji_main', 'kanji_second', 'kanji_freestyle', 'slot_labels', 'readings',
  'gaze_main', 'gaze_second', 'gaze_freestyle', 'referee', 'review', 'eliminated', 'suggest_memorial',
  'follow_up_question', 'flags', 'seconds', 'input_tokens', 'output_tokens', 'cost_usd_est', 'error',
]

/** One finished run → one CSV row (as an object) plus its flags. Pure: the tests call it with a fake result. */
export function describeRun(row, ctx, outcome) {
  const base = {
    id: row.id, category: row.category, sender_to_receiver: row.sender_to_receiver, receiver_alive: row.receiver_alive,
    occasion_db: ctx.occasion_from, occasion_used: ctx.occasion, relationship_used: ctx.relationship, direction_used: ctx.direction,
    seconds: outcome.seconds.toFixed(1), input_tokens: outcome.input_tokens, output_tokens: outcome.output_tokens,
    cost_usd_est: outcome.cost.toFixed(4),
  }
  const flags = []
  if (outcome.error) {
    flags.push(outcome.timedOut ? 'timeout' : 'error')
    return { ...base, status: 'error', error: outcome.error, flags: flags.join('|'), main: null, _flags: flags }
  }
  const r = outcome.result
  const bySlot = (slot) => r.candidates.find((c) => c.slot === slot)
  const show = (c) => (c ? `${c.kanji}${c.eliminated ? '×' : ''}` : '')
  const live = r.candidates.filter((c) => !c.eliminated)
  const main = r.status === 'sufficient' ? r.primary_kanji : null
  const mainCand = r.candidates.find((c) => c.kanji === main)
  const memorial = isMemorial(ctx.occasion)

  if (memorial && r.status === 'sufficient') {
    // 1. cinnabar on a memorial result — the colour rule is one function shared with the page
    if (mainGlyphTone(r.occasion) === 'cinnabar') flags.push('cinnabar_on_memorial')
    // 2. a celebration character on a memorial result (any live slot, either form)
    const hit = live.filter((c) => palette.memorialCategory([c.kanji, c.inscription_form]))
    if (hit.length > 0) flags.push(`celebration_on_memorial(${hit.map((c) => c.kanji).join(',')})`)
    // 3. the data path to the workshop: certificate.memorial and the Shopify attribute, derived from this very result
    if (mainCand) {
      const parsed = parseOrderRequest({
        story: row.test_story_ja, engine_result: r, selected_kanji: mainCand.kanji, language: 'ja', sender_name: 'test', receiver_name: 'test',
        delivery_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), inscription_style: 'modern', package: 'simple',
      }, new Date(), palette)
      if (!parsed.ok || parsed.order.certificate.memorial !== true || !lineAttributes(parsed.order, 'IC-TEST').some((a) => a.key === 'ichirei_memorial' && a.value === 'yes')) flags.push('memorial_data_path_broken')
    }
  }
  if (r.status === 'insufficient') flags.push('insufficient')
  if (r.suggest_memorial === true) flags.push('suggest_memorial')

  const labelOf = (c) => (c.kanji === main ? LABELS.main : c.slot === 'freestyle' ? LABELS.freestyle : LABELS.second)
  return {
    ...base,
    status: r.status,
    kanji_main: show(mainCand), kanji_second: show(r.candidates.find((c) => c.slot !== 'freestyle' && c.kanji !== main)), kanji_freestyle: show(bySlot('freestyle')),
    slot_labels: r.candidates.map((c) => `${c.kanji}=${labelOf(c)}`).join(' | '),
    readings: r.candidates.map((c) => `${c.kanji}:${c.reading}`).join(' | '),
    gaze_main: mainCand?.one_line_gaze ?? '',
    gaze_second: r.candidates.find((c) => c.slot !== 'freestyle' && c.kanji !== main)?.one_line_gaze ?? '',
    gaze_freestyle: bySlot('freestyle')?.one_line_gaze ?? '',
    referee: (r.referee?.actions ?? []).map((a) => `${a.kanji}:${a.action}${a.detail ? `(${a.detail})` : ''}`).join(' | '),
    review: r.review ? (r.review.ran ? r.review.verdicts.map((v) => `${v.kanji}:${v.pass ? 'pass' : 'FAIL'}(${v.reason})`).join(' | ') : `not run: ${r.review.skipped_reason}`) : '',
    eliminated: r.candidates.filter((c) => c.eliminated).map((c) => `${c.kanji}:${c.eliminated_reason}`).join(' | '),
    suggest_memorial: r.suggest_memorial === true ? 'yes' : '',
    follow_up_question: r.status === 'insufficient' ? (r.follow_up_question ?? '') : '',
    flags: flags.join('|'),
    error: '',
    main,
    _flags: flags,
  }
}

/** The sameness flag: a main kanji that repeats in more than `share` of the runs that produced one. */
export function sameness(descs, share = SAMEWORD_SHARE) {
  const mains = descs.filter((d) => d.main).map((d) => d.main)
  const counts = new Map()
  for (const k of mains) counts.set(k, (counts.get(k) ?? 0) + 1)
  const limit = mains.length * share
  return { total: mains.length, counts, over: mains.length < SAMENESS_MIN_RUNS ? [] : [...counts].filter(([, n]) => n > limit).sort((a, b) => b[1] - a[1]) }
}

export function summarize(descs, { priceIn, priceOut }) {
  const lines = []
  const ok = descs.filter((d) => d.status !== 'error')
  const same = sameness(descs)
  const cost = descs.reduce((s, d) => s + Number(d.cost_usd_est), 0)
  const tin = descs.reduce((s, d) => s + Number(d.input_tokens), 0)
  const tout = descs.reduce((s, d) => s + Number(d.output_tokens), 0)
  lines.push(`Story run summary — ${descs.length} runs (${ok.length} produced a result, ${descs.length - ok.length} errored or timed out)`)
  lines.push(`Cost estimate: $${cost.toFixed(2)} (${tin} input + ${tout} output tokens at $${priceIn} / $${priceOut} per million — assumed rates, change with --price-in/--price-out). Mean $${(cost / Math.max(1, descs.length)).toFixed(3)} per run, ${(descs.reduce((s, d) => s + Number(d.seconds), 0) / Math.max(1, descs.length)).toFixed(0)} s per run.`)
  lines.push('')
  lines.push('Kanji spread per category (main kanji: count)')
  const byCat = new Map()
  for (const d of descs.filter((x) => x.main)) {
    const m = byCat.get(d.category) ?? new Map()
    m.set(d.main, (m.get(d.main) ?? 0) + 1)
    byCat.set(d.category, m)
  }
  for (const [cat, m] of [...byCat].sort()) {
    const n = [...m.values()].reduce((a, b) => a + b, 0)
    lines.push(`  ${cat} (${n} runs, ${m.size} different): ${[...m].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}${c > 1 ? '×' + c : ''}`).join(' ')}`)
  }
  lines.push('')
  lines.push(`Most repeated main kanji (of ${same.total} runs with a main): ${[...same.counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, c]) => `${k} ${c} (${((100 * c) / same.total).toFixed(0)}%)`).join(', ')}`)
  lines.push(same.over.length ? `SAMENESS FLAG: ${same.over.map(([k, c]) => `${k} in ${c} of ${same.total} runs (${((100 * c) / same.total).toFixed(0)}% > ${100 * SAMEWORD_SHARE}%)`).join('; ')}` : `No main kanji repeats in more than ${100 * SAMEWORD_SHARE}% of runs.`)
  lines.push('')
  const flagCounts = new Map()
  for (const d of descs) for (const f of d._flags ?? []) flagCounts.set(f.replace(/\(.*\)$/, ''), [...(flagCounts.get(f.replace(/\(.*\)$/, '')) ?? []), d.id])
  lines.push('Flags raised (ids)')
  if (flagCounts.size === 0) lines.push('  none')
  for (const [f, ids] of [...flagCounts].sort()) lines.push(`  ${f}: ${ids.length} — ${ids.join(', ')}`)
  const mem = descs.filter((d) => isMemorial(d.occasion_used))
  lines.push('')
  lines.push(`Memorial runs: ${mem.length} (${mem.filter((d) => d.status === 'sufficient').length} sufficient, ${mem.filter((d) => d.status === 'insufficient').length} insufficient, ${mem.filter((d) => d.status === 'error').length} error); celebration characters removed by the default block in ${mem.filter((d) => /blocked_occasion/.test(d.referee ?? '')).length} of them`)
  const sug = descs.filter((d) => d.suggest_memorial === 'yes')
  lines.push(`suggest_memorial raised on ${sug.length} non-memorial run(s): ${sug.map((d) => d.id).join(', ') || '—'}`)
  return lines.join('\n')
}

// ---- estimating before spending ---------------------------------------------------------------------------------------
/** Rough token budget per run. These are assumptions (the prompt is ~9k tokens; high effort thinks a lot): the calibration run replaces them. */
export const ASSUMED = { select_in: 11_000, select_out: 10_000, review_in: 3_500, review_out: 700 }
export function estimate(n, priceIn = PRICE_IN, priceOut = PRICE_OUT) {
  const per = ((ASSUMED.select_in + ASSUMED.review_in) * priceIn + (ASSUMED.select_out + ASSUMED.review_out) * priceOut) / 1e6
  return { per, total: per * n, low: per * n * 0.6, high: per * n * 1.6 }
}

// ---- the run -------------------------------------------------------------------------------------------------------------
async function runOne(row) {
  const occ = occasionFor(row)
  const ctx = { language: 'ja', relationship: relationshipFor(row), direction: directionFor(row), occasion: occ.code, occasion_from: occ.from }
  const usage = { in: 0, out: 0 }
  const t0 = Date.now()
  const outcome = { seconds: 0, input_tokens: 0, output_tokens: 0, cost: 0 }
  try {
    const result = await runEngine(row.test_story_ja, 'A', {
      context: { language: 'ja', relationship: ctx.relationship, direction: ctx.direction, occasion: ctx.occasion },
      signal: AbortSignal.timeout(TIMEOUT_S * 1000),
      onUsage: (_stage, u) => { usage.in += u.input_tokens; usage.out += u.output_tokens },
    })
    outcome.result = result
  } catch (e) {
    outcome.error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e)
    outcome.timedOut = /Timeout|AbortError|aborted/i.test(outcome.error)
  }
  outcome.seconds = (Date.now() - t0) / 1000
  outcome.input_tokens = usage.in
  outcome.output_tokens = usage.out
  outcome.cost = (usage.in * PRICE_IN + usage.out * PRICE_OUT) / 1e6
  return describeRun(row, ctx, outcome)
}

async function main() {
  if (!existsSync(DB)) {
    console.error(`Story database not found: ${DB}\nPut ICHIREI_Story_Test_DB_v1.csv in test-data/private/ (git-ignored) or pass --db.`)
    process.exit(2)
  }
  let rows = selectRows(loadDb(DB), ONLY)
  if (IDS) rows = rows.filter((r) => IDS.has(r.id))
  if (LIMIT) rows = rows.slice(0, LIMIT)
  const memorialN = rows.filter((r) => r.receiver_alive === 'no').length
  const est = estimate(rows.length)
  console.log(`Story run: ${rows.length} stories (${rows.length - memorialN} living-person rows, ${memorialN} memorial rows); engine model ${ENGINE_CONFIG.MODEL}, effort ${ENGINE_CONFIG.EFFORT}, concurrency ${CONCURRENCY}`)
  console.log(`Cost estimate (assumptions: ~${ASSUMED.select_in + ASSUMED.review_in} tokens in and ~${ASSUMED.select_out + ASSUMED.review_out} out per run at $${PRICE_IN}/$${PRICE_OUT} per MTok): ~$${est.total.toFixed(0)} (range $${est.low.toFixed(0)}–$${est.high.toFixed(0)}), about $${est.per.toFixed(2)} per run. Run --limit 5 first to replace the assumptions with measured numbers.`)
  if (flag('dry-run')) {
    const byCat = new Map()
    for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1)
    console.log(`By category: ${[...byCat].map(([k, n]) => `${k} ${n}`).join(', ')}`)
    for (const r of rows.slice(0, 5)) { const o = occasionFor(r); console.log(`  ${r.id} ${r.category} ${r.sender_to_receiver} → ${relationshipFor(r)}/${directionFor(r)}/${o.code} (${o.from})`) }
    return
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set: the real engine needs a model key (this script never mocks one). Use --dry-run to see the plan.')
    process.exit(3)
  }
  mkdirSync(OUT, { recursive: true })
  const stamp = today()
  const jsonl = join(OUT, `story-run-${stamp}.jsonl`)
  const done = new Map()
  if (flag('resume') && existsSync(jsonl)) {
    for (const l of readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) { const d = JSON.parse(l); done.set(d.id, d) }
  } else {
    writeFileSync(jsonl, '')
  }
  // quiet: the engine logs referee/review lines (no story text) — they are in the result anyway
  const origLog = console.log
  const quiet = (...a) => { if (!String(a[0] ?? '').startsWith('[ichirei-')) origLog(...a) }
  const todo = rows.filter((r) => !done.has(r.id))
  let next = 0
  let finished = done.size
  const worker = async () => {
    for (;;) {
      const row = todo[next++]
      if (!row) return
      console.log = quiet
      let d
      try { d = await runOne(row) } finally { console.log = origLog }
      done.set(row.id, d)
      appendFileSync(jsonl, JSON.stringify(d) + '\n')
      finished++
      origLog(`[${finished}/${rows.length}] ${row.id} ${d.occasion_used} → ${d.status}${d.main ? ' ' + d.main : ''}${d.flags ? '  flags: ' + d.flags : ''}  ${d.seconds}s $${d.cost_usd_est}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
  const descs = rows.map((r) => done.get(r.id)).filter(Boolean)
  // the sameness flag is a property of the whole set: add it to the rows that carry the repeated kanji
  const same = sameness(descs)
  const overSet = new Set(same.over.map(([k]) => k))
  for (const d of descs) if (d.main && overSet.has(d.main)) { d._flags = [...(d._flags ?? []), 'sameness'] ; d.flags = d._flags.join('|') }
  const csvPath = join(OUT, `story-run-${stamp}.csv`)
  writeFileSync(csvPath, '﻿' + toCsv([COLUMNS, ...descs.map((d) => COLUMNS.map((c) => d[c] ?? ''))]))
  const summary = summarize(descs, { priceIn: PRICE_IN, priceOut: PRICE_OUT })
  writeFileSync(join(OUT, `story-run-${stamp}-summary.txt`), summary + '\n')
  console.log('\n' + summary)
  console.log(`\nWrote ${csvPath}`)
}

if (process.argv[1] === import.meta.filename) await main()
