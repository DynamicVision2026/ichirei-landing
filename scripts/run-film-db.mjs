// Run the REAL film-script call over stories from the internal story test database (and the zh / en story fixtures) and write a CSV for human review.
// This is the check the unit tests cannot make: what the model actually writes (retold, not invented? quotations exact? names kept out? no illness
// images? remembrance rules?). The referee's checks run on every result (the same code the live site runs); what it cannot judge — whether the lines
// are true to the story, whether the scenes fit — is for a reader.
//
//   node --experimental-strip-types scripts/run-film-db.mjs --dry-run                  # the plan, no model call
//   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/run-film-db.mjs         # the default set: 0020, 2 remembrance, 1 illness, 4 more ja + the zh / en fixtures
//   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/run-film-db.mjs --ids 0020,0080 --out ./out
//
// For each story it first picks the character the way the site does (the engine run of scripts/run-story-db.mjs: one call), then writes the film
// (ONE call to the film model, claude-haiku-5-5 by default; the film call is the only one this script is about). Output: film-run-YYYYMMDD.csv and
// -summary.txt in --out (default test-data/private; git-ignored — the stories are copyrighted, never publish them).
//
// Options: --db <csv>  --out <dir>  --ids a,b,c  --limit N  --no-fixtures (ja database stories only)  --timeout-s N (engine run, default 300)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { checkFilmScript, loadSceneManifest, makeFilm } from '../engine/film.ts'
import { loadPalette } from '../engine/palette.ts'
import { directionFor, loadDb, occasionFor, relationshipFor, toCsv } from './run-story-db.mjs'

const root = join(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const DB = opt('db', join(root, 'test-data', 'private', 'ICHIREI_Story_Test_DB_v1.csv'))
const OUT = opt('out', join(root, 'test-data', 'private'))
const IDS = opt('ids', '') ? opt('ids', '').split(',').map((s) => s.trim()) : null
const LIMIT = Number(opt('limit', '0')) || 0
const TIMEOUT_S = Number(opt('timeout-s', '300')) || 300
const ILLNESS = /入院|病気|病院|がん|癌|認知症|介護|脳梗塞|余命/

/** The default set: the golden story 0020, two remembrance stories, one that mentions illness, four more living-person stories. */
export function defaultIds(rows) {
  const ids = new Set(['0020'])
  const dead = rows.filter((r) => r.receiver_alive === 'no').slice(0, 2)
  const sick = rows.find((r) => ILLNESS.test(r.test_story_ja ?? '') && r.receiver_alive !== 'no')
  for (const r of dead) ids.add(r.id)
  if (sick) ids.add(sick.id)
  for (const r of rows.filter((x) => x.test_use === 'main' && !ids.has(x.id))) { if (ids.size >= 8) break; ids.add(r.id) }
  return [...ids]
}

/** zh / en stories from the engine fixtures (the database holds Japanese stories only). */
function fixtureStories() {
  const out = []
  for (const dirName of readdirSync(join(root, 'scripts')).filter((d) => d.startsWith('fixtures-'))) {
    for (const f of readdirSync(join(root, 'scripts', dirName)).filter((x) => x.endsWith('.json'))) {
      const j = JSON.parse(readFileSync(join(root, 'scripts', dirName, f), 'utf8'))
      const c = j.context
      if (j.story && c && (c.language === 'en' || c.language === 'zh-Hant' || c.language === 'zh-Hans')) out.push({ id: f.replace(/\.json$/, ''), story: j.story, context: c, alive: c.occasion !== 'memorial' })
    }
  }
  return out.slice(0, 4)
}

const COLUMNS = ['id', 'language', 'occasion', 'memorial', 'character', 'status', 'reason', 'scenes', 'line_1', 'line_2', 'line_3', 'line_4', 'referee_recheck', 'seconds', 'flags']

async function one(item, palette, manifest) {
  const t0 = Date.now()
  const flags = []
  let result
  try {
    result = await runEngine(item.story, 'A', { context: item.context, signal: AbortSignal.timeout(TIMEOUT_S * 1000) })
  } catch (e) {
    return { id: item.id, language: item.context.language, status: 'engine_error', reason: String(e).slice(0, 120), seconds: ((Date.now() - t0) / 1000).toFixed(1), flags: 'engine_error' }
  }
  const main = result.candidates.find((c) => c.kanji === result.primary_kanji)
  if (result.status !== 'sufficient' || !main) return { id: item.id, language: item.context.language, status: 'no_character', reason: result.status, seconds: ((Date.now() - t0) / 1000).toFixed(1), flags: 'no_character' }
  const memorial = item.context.occasion === 'memorial'
  const input = {
    story: item.story, language: item.context.language, relationship: item.context.relationship ?? null, direction: item.context.direction ?? null,
    occasion: item.context.occasion ?? null, occasion_detail: null, memorial, glyph: main.inscription_form ?? main.kanji, forms: [main.kanji, main.inscription_form ?? ''].filter(Boolean),
    who: main.one_line_gaze, moment: main.story_anchor, names: [],
  }
  const film = await makeFilm(input, {})
  // the same referee again on the saved film (a fallback has two lines and is not re-checked)
  const again = film.status === 'ready' ? checkFilmScript({ lines: film.lines, scenes: film.scenes }, input, manifest, palette).map((p) => p.code) : []
  if (film.status === 'fallback') flags.push(`fallback(${film.reason})`)
  if (again.length) flags.push(`referee_recheck(${again.join('+')})`)
  if (memorial && film.scenes.some((s) => manifest.find((m) => m.id === s)?.celebration)) flags.push('celebration_scene_on_memorial')
  if (!memorial && film.scenes.some((s) => manifest.find((m) => m.id === s)?.memorial_only)) flags.push('memorial_scene_on_normal')
  if (item.context.language === 'ja' && ILLNESS.test(item.story)) flags.push('story_mentions_illness_READ_THE_LINES')
  if (memorial) flags.push('memorial_READ_THE_LINES')
  const L = film.lines
  return { id: item.id, language: item.context.language, occasion: item.context.occasion, memorial: memorial ? 'yes' : '', character: input.glyph, status: film.status, reason: film.reason ?? '', scenes: film.scenes.join(' '), line_1: L[0] ?? '', line_2: L[1] ?? '', line_3: L[2] ?? '', line_4: L[3] ?? '', referee_recheck: again.join('+'), seconds: ((Date.now() - t0) / 1000).toFixed(1), flags: flags.join('|') }
}

async function main() {
  const palette = loadPalette()
  const manifest = loadSceneManifest()
  const items = []
  if (existsSync(DB)) {
    const rows = loadDb(DB)
    for (const id of IDS ?? defaultIds(rows)) {
      const r = rows.find((x) => x.id === id)
      if (!r) continue
      const occ = occasionFor(r)
      items.push({ id: r.id, story: r.test_story_ja, context: { language: 'ja', relationship: relationshipFor(r), direction: directionFor(r), occasion: occ.code }, alive: r.receiver_alive !== 'no' })
    }
  } else console.log(`(no story database at ${DB}; only the fixtures are used)`)
  if (!flag('no-fixtures') && !IDS) items.push(...fixtureStories())
  const run = LIMIT ? items.slice(0, LIMIT) : items
  console.log(`Film run: ${run.length} stories (${run.filter((i) => i.context.language === 'ja').length} ja, ${run.filter((i) => i.context.language === 'en').length} en, ${run.filter((i) => i.context.language.startsWith('zh')).length} zh; ${run.filter((i) => i.context.occasion === 'memorial').length} remembrance). Each = one engine run + one film call.`)
  if (flag('dry-run')) { for (const i of run) console.log(`  ${i.id} ${i.context.language} ${i.context.occasion} ${i.context.relationship ?? ''}`); return }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set: this script calls the real model (it never mocks one). Use --dry-run for the plan.'); process.exit(3) }
  const rows = []
  for (const it of run) { const r = await one(it, palette, manifest); rows.push(r); console.log(`${r.id} ${r.language} ${r.status}${r.reason ? `(${r.reason})` : ''} ${r.scenes ?? ''} ${r.flags ? '[' + r.flags + ']' : ''}`) }
  mkdirSync(OUT, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  writeFileSync(join(OUT, `film-run-${stamp}.csv`), '﻿' + toCsv([COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c] ?? ''))]))
  const ok = rows.filter((r) => r.status === 'ready').length
  const summary = [`Film run — ${rows.length} stories: ${ok} ready, ${rows.filter((r) => r.status === 'fallback').length} fallback, ${rows.filter((r) => !['ready', 'fallback'].includes(r.status)).length} without a character or errored.`, `Flags: ${rows.filter((r) => r.flags).map((r) => `${r.id}: ${r.flags}`).join('; ') || 'none'}`, 'READ every line against its story: (1) nothing invented, (2) quotations exact, (3) no names / places / numbers, (4) no illness or hospital image, (5) remembrance films calm, no celebration, (6) scenes fit the lines.'].join('\n')
  writeFileSync(join(OUT, `film-run-${stamp}-summary.txt`), summary + '\n')
  console.log('\n' + summary)
}

if (process.argv[1] === import.meta.filename) await main()
