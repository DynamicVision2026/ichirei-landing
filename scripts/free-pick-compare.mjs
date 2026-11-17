// Part D of the 2026-11-16 ticket: the same stories through TODAY's engine (a checkout of the commit before the ticket) and the NEW engine (this checkout), with the REAL model.
// Writes review/free-pick-compare-<date>.md: for each story the three cards of each engine (character, reading, English word, line, the detail it starts from), the round time and the cost
// per round (logged tokens × engine/ops-costs.ts). About a dozen model calls in all; needs ANTHROPIC_API_KEY. Not part of any test.
//
//   ANTHROPIC_API_KEY=… node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/free-pick-compare.mjs [--old-ref 95b7532] [--stories file.json] [--out review/free-pick-compare-2026-11-17.md]
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { tokensUsd } from '../engine/ops-costs.ts'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set: this script calls the real model.'); process.exit(3) }
const repo = resolve(join(import.meta.dirname, '..'))
const oldRef = opt('old-ref', '95b7532')
const storiesFile = resolve(opt('stories', join(repo, 'scripts', 'fixtures', 'free-pick-stories.json')))
const out = resolve(opt('out', join(repo, 'review', 'free-pick-compare-2026-11-17.md')))
const stories = JSON.parse(readFileSync(storiesFile, 'utf8')).stories

// today's engine: the commit before the ticket, checked out beside this one (its node_modules is this one's)
const work = mkdtempSync(join(tmpdir(), 'ichirei-old-'))
const oldRoot = join(work, 'old')
execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', oldRoot, oldRef], { stdio: 'ignore' })
symlinkSync(join(repo, 'node_modules'), join(oldRoot, 'node_modules'))

const runOne = (root, id) => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(repo, 'scripts', 'free-pick-run-one.mjs'), '--root', root, '--story', id, '--stories', storiesFile], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return { error: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 600) }
  try { return JSON.parse(r.stdout.trim().split('\n').pop()) } catch { return { error: `unreadable: ${r.stdout.slice(0, 300)}` } }
}
const costOf = (usage) => usage.reduce((a, u) => a + tokensUsd(u.model, { in: u.input, out: u.output }), 0)
const byModel = (usage) => Object.entries(usage.reduce((a, u) => { const k = u.model; (a[k] ??= { in: 0, out: 0 }); a[k].in += u.input; a[k].out += u.output; return a }, {})).map(([m, t]) => `${m}: ${t.in} in / ${t.out} out`).join('; ')
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')

const lines = ['# Free pick: today\'s engine and the new engine (2026-11-17)', '', `Today's engine = commit \`${oldRef}\` (Sonnet 5 for the main card, Haiku 5.5 with no thinking for the free pick). New engine = this checkout (Sonnet 5.5 for the cards, the AHA section, Sonnet 5.5 with light thinking for the free pick, Haiku 5.5 as the fast fallback after 8 s). Same stories, same machine, one run each, the real model. Costs use the current price table in \`engine/ops-costs.ts\` for both engines, so only the models and token counts differ.`, '']
const summary = []
try {
  for (const s of stories) {
    lines.push(`## ${s.id} (${s.language})`, '', `> ${s.story}`, '', `Context: ${s.relationship}, ${s.direction}, purpose ${s.purpose}${s.occasion_detail ? `, ${s.occasion_detail}` : ''}.`, '')
    for (const [label, root] of [['Today\'s engine', oldRoot], ['New engine', repo]]) {
      console.error(`${label}: ${s.id} …`)
      const r = runOne(root, s.id)
      lines.push(`### ${label}`, '')
      if (r.error) { lines.push(`The run failed: \`${cell(r.error)}\``, ''); summary.push({ id: s.id, label, error: true }); continue }
      lines.push('| Card | Character | Reading | English word | Line (その人は、/ They are…) | The detail it starts from (story_anchor) |', '|---|---|---|---|---|---|')
      for (const c of r.cards) lines.push(`| ${c.slot} | ${cell(c.form)} | ${cell(c.reading)} | ${cell(c.en_word ?? c.meaning)} | ${cell(c.line)} | ${cell(c.anchor)} |`)
      const usd = costOf(r.usage)
      const calls = (r.calls ?? []).map((c) => `${c.slot}${c.hedge ? ` h${c.hedge}` : ''} ${c.model} ${Math.round((c.ms ?? 0) / 100) / 10}s${c.won === true ? ' (won)' : c.error ? ` (${c.error})` : ''}`).join('; ')
      lines.push('', `Round time: **${(r.ms / 1000).toFixed(1)} s** · cost per round: **$${usd.toFixed(4)}** (${byModel(r.usage)}).`, `Calls: ${calls || '—'}.`, '')
      summary.push({ id: s.id, label, ms: r.ms, usd })
    }
  }
  lines.push('## Round time and cost per round', '', '| Story | Engine | Round time | Cost per round |', '|---|---|---|---|')
  for (const x of summary) lines.push(`| ${x.id} | ${x.label} | ${x.error ? 'failed' : `${(x.ms / 1000).toFixed(1)} s`} | ${x.error ? '—' : `$${x.usd.toFixed(4)}`} |`)
  lines.push('', 'Deploy rule (the ticket): the new engine\'s cards pass every rule and its round time is no more than about 5 s longer than today\'s. Read the lines: they are for a person to judge.', '')
  mkdirSync(join(out, '..'), { recursive: true })
  writeFileSync(out, lines.join('\n'))
  console.error(`written: ${out}`)
} finally {
  try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', oldRoot], { stdio: 'ignore' }) } catch { /* the temp checkout is left in the temp folder */ }
  if (existsSync(oldRoot)) console.error(`(the temporary checkout ${oldRoot} could not be removed)`)
}
