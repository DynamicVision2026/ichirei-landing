// ONE engine, ONE story, the REAL model (internal helper of scripts/free-pick-compare.mjs; it prints one JSON line). Needs ANTHROPIC_API_KEY. Never mocks a model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/free-pick-run-one.mjs --root <engine checkout> --story <id> [--stories <file.json>]
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const root = resolve(opt('root', '.'))
const stories = JSON.parse(readFileSync(resolve(opt('stories', join(import.meta.dirname, 'fixtures', 'free-pick-stories.json'))), 'utf8')).stories
const c = stories.find((s) => s.id === opt('story', ''))
if (!c) { console.error('unknown story id'); process.exit(2) }
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set: this script calls the real model.'); process.exit(3) }

const { runEngine } = await import(pathToFileURL(join(root, 'engine', 'engine.ts')).href)
const usage = []
const logs = []
const origLog = console.log
console.log = (...a) => { logs.push(a.map(String).join(' ')) }
const ctx = { language: c.language, relationship: c.relationship, direction: c.direction, purpose: c.purpose, ...(c.state ? { state: c.state } : {}), ...(c.occasion_detail ? { occasion_detail: c.occasion_detail } : {}) }
const t0 = Date.now()
let r
try {
  r = await runEngine(c.story, 'A', { context: ctx, signal: AbortSignal.timeout(300_000), onUsage: (stage, u) => usage.push({ stage, model: u.model, input: u.input_tokens, output: u.output_tokens }) })
} finally {
  console.log = origLog
}
const ms = Date.now() - t0
const cardsLine = logs.find((l) => l.startsWith('[ichirei-cards]'))
const cards = r.candidates.filter((x) => !x.eliminated).map((x) => ({ slot: x.slot, kanji: x.kanji, form: x.inscription_form ?? x.kanji, reading: x.reading, meaning: x.meaning ?? null, en_word: x.en_word ?? null, line: x.one_line_gaze, anchor: x.story_anchor, flags: x.flags ?? [] }))
console.log(JSON.stringify({ id: c.id, language: c.language, ms, status: r.status, cards, usage, calls: cardsLine ? JSON.parse(cardsLine.slice('[ichirei-cards] '.length)).parallel?.calls ?? null : null, total_ms: cardsLine ? JSON.parse(cardsLine.slice('[ichirei-cards] '.length)).ms ?? null : null }))
