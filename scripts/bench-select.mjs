// Time and quality bench for the selection engine on the five golden stories (scripts/fixtures-v8/).
//
//   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/bench-select.mjs                       # default configs, in-process engine
//   ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/bench-select.mjs --config "medium:ICHIREI_EFFORT=medium"
//   node --experimental-strip-types scripts/bench-select.mjs --url https://ichirei.soul-id.jp --config "live:"   # the deployed service, as the page calls it
//   … --runs 3 (repeat each story, for p50/p90)   --only s0032-friend-thanks,s0004-mother-memorial   --out bench.json
//
// A CONFIG is "name:ENV=value,ENV=value" (the engine knobs: ICHIREI_EFFORT, ICHIREI_MAX_TOKENS, ICHIREI_MODEL, ICHIREI_REVIEW_MODEL,
// ICHIREI_REVIEW_EFFORT, ICHIREI_REPLACE, …). Engine settings are read when the engine module loads, so every config runs in its
// own child process. With --url the settings are the service's own (set on Cloud Run), so use one config; the times then include the network.
//
// What it prints, per story and per config: seconds in each stage (select / review / replace, from the engine's own [ichirei-timing]
// line, or from the stage events with --url), the main / second / freestyle, and a QUALITY line: whether the main is the fixture's
// expected quality character, and that no scene noun (a fixture's `review_fail` character) ships as a main. A model answers
// differently run to run: the quality line is a flag for a human to read, not a verdict. Never prints the story.
//
// This script calls the real model: it costs money (about one full run plus a review per story). Without a key it stops before any call.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

const root = join(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : argv[i + 1]
}
const optAll = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []))

const dir = join(root, 'scripts', 'fixtures-v8')
const only = opt('only', '')
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .filter((f) => !only || only.split(',').includes(f.name))
  .sort((a, b) => a.name.localeCompare(b.name))
const runs = Math.max(1, Number(opt('runs', '1')) || 1)
const url = opt('url', '')

const pct = (xs, p) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const secs = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1))

// ------------------------------------------------------------------------------------------------------------------------------
// child: run the stories in this process with this process's env (one config)
// ------------------------------------------------------------------------------------------------------------------------------
if (argv.includes('--child')) {
  const { runEngine } = await import('../engine/engine.ts')
  const out = []
  for (const f of fixtures) {
    for (let n = 0; n < runs; n++) {
      const lines = []
      const orig = console.log
      console.log = (...a) => {
        const l = a.map(String).join(' ')
        if (l.startsWith('[ichirei-timing] ')) lines.push(l)
      }
      const t0 = Date.now()
      let result = null
      let error = null
      try {
        result = await runEngine(f.story, 'A', { context: f.context })
      } catch (e) {
        error = String(e?.message ?? e).slice(0, 200)
      } finally {
        console.log = orig
      }
      const timing = lines.length ? JSON.parse(lines.at(-1).slice('[ichirei-timing] '.length)) : null
      out.push({ name: f.name, total_ms: Date.now() - t0, timing, error, main: result?.primary_kanji ?? null, second: result?.runner_up_kanji ?? null, freestyle: result?.freestyle_kanji ?? null, status: result?.status ?? null })
    }
  }
  process.stdout.write(JSON.stringify(out))
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------------------------------------
// parent
// ------------------------------------------------------------------------------------------------------------------------------
const configs = (optAll('config').length ? optAll('config') : ['baseline:', 'effort-medium:ICHIREI_EFFORT=medium', 'medium-8k:ICHIREI_EFFORT=medium,ICHIREI_MAX_TOKENS=8000']).map((c) => {
  const i = c.indexOf(':')
  const name = c.slice(0, i)
  const env = Object.fromEntries(c.slice(i + 1).split(',').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))
  return { name, env }
})

if (!url && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set: this bench calls the real model (or pass --url to time the deployed service). Nothing was run.')
  process.exit(2)
}

async function viaUrl() {
  const out = []
  for (const f of fixtures) {
    for (let n = 0; n < runs; n++) {
      const t0 = Date.now()
      const at = {}
      let result = null
      let error = null
      try {
        const ctx = f.context
        const res = await fetch(`${url.replace(/\/$/, '')}/api/select`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ story: f.story, condition: 'A', source: 'bench', language: ctx.language, relationship: ctx.relationship, direction: ctx.direction, occasion: ctx.occasion }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const dec = new TextDecoder()
        let buf = ''
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true })
          let nl
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            const msg = JSON.parse(line)
            if (msg.type === 'stage' && !(msg.stage in at)) at[msg.stage] = Date.now() - t0
            if (msg.type === 'result') result = msg.result
            if (msg.type === 'error') throw new Error(msg.error)
          }
        }
      } catch (e) {
        error = String(e?.message ?? e).slice(0, 200)
      }
      const total = Date.now() - t0
      // stage events give the boundaries: reading→choosing = until the model starts answering, choosing→checking = the selection, checking→end = review (+ replacement)
      const timing = at.checking != null ? { select_ms: at.checking, review_ms: (at.replacing ?? total) - at.checking, replace_ms: at.replacing != null ? total - at.replacing : 0, total_ms: total } : null
      out.push({ name: f.name, total_ms: total, timing, error, main: result?.primary_kanji ?? null, second: result?.runner_up_kanji ?? null, freestyle: result?.freestyle_kanji ?? null, status: result?.status ?? null })
    }
  }
  return out
}

const viaChild = (cfg) =>
  new Promise((resolve, reject) => {
    const args = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(root, 'scripts', 'bench-select.mjs'), '--child', '--runs', String(runs), ...(only ? ['--only', only] : [])]
    execFile('node', args, { env: { ...process.env, ...cfg.env }, maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60_000 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr) || String(err))) : resolve(JSON.parse(stdout))))
  })

const report = []
for (const cfg of url ? configs.slice(0, 1) : configs) {
  console.log(`\n=== ${cfg.name}  ${JSON.stringify(cfg.env)}${url ? `  (${url})` : ''}`)
  const rows = url ? await viaUrl() : await viaChild(cfg)
  report.push({ config: cfg, rows })
  console.log('story                         total  select review replace  main / second / freestyle   quality')
  for (const r of rows) {
    const f = fixtures.find((x) => x.name === r.name)
    const exp = f.expect
    const scene = Object.keys(f.review_fail)
    const q = r.error ? `ERROR ${r.error}` : [r.main === exp.main ? 'main=expected' : `main≠${exp.main}`, scene.includes(r.main) ? 'SCENE-NOUN MAIN' : 'no scene-noun main', r.second ? '' : 'NO SECOND'].filter(Boolean).join(', ')
    console.log(`${r.name.padEnd(30)}${secs(r.total_ms).padStart(5)}s${secs(r.timing?.select_ms).padStart(7)}${secs(r.timing?.review_ms).padStart(7)}${secs(r.timing?.replace_ms).padStart(8)}  ${[r.main, r.second, r.freestyle].map((x) => x ?? '—').join(' / ').padEnd(24)}  ${q}`)
  }
  const totals = rows.filter((r) => !r.error).map((r) => r.total_ms)
  console.log(`p50 ${secs(pct(totals, 50))}s   p90 ${secs(pct(totals, 90))}s   (n=${totals.length}; targets: p50 < 60s, p90 < 90s)`)
}
if (opt('out', '')) writeFileSync(opt('out', ''), JSON.stringify(report, null, 2))
