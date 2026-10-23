// Cloud Run server test: the REAL server + REAL engine/prompt.<lang>.md/SDK against a
// fake Anthropic upstream. No API key, no network, no token spend.
//
//   node scripts/test-server.mjs           # ~20s
//   node scripts/test-server.mjs --long    # + a 75s stream proving no 60s cap
//
// Builds the frontend with ICHIREI_BASE=/ (as the Dockerfile does) so the
// static-serving checks run against the same kind of bundle that ships.

import { execSync } from 'node:child_process'
import { GOLDEN, GOLDEN_CONTEXT, STORY, EXPLAIN_TEXT, sleep, startFakeAnthropic, startServer, readNdjson } from './server-fixtures.mjs'

const LONG = process.argv.includes('--long')
let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const post = (base, path, body, init = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })

console.log('building frontend (ICHIREI_BASE=/)…')
execSync('npm run build', { stdio: 'ignore', env: { ...process.env, ICHIREI_BASE: '/' } })

const upstream = await startFakeAnthropic()
const server = await startServer({
  upstreamUrl: upstream.url,
  env: { ICHIREI_HEARTBEAT_MS: '1000' },
})
const base = server.url

try {
  // ---- A. Static frontend + routing -----------------------------------
  const home = await fetch(base + '/')
  const html = await home.text()
  check('static: / serves index.html', home.status === 200 && html.includes('<div id="root">'))
  const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
  check('static: bundle path is root-relative (/assets/…)', Boolean(assetPath), html.slice(0, 400))
  const asset = await fetch(base + assetPath)
  check('static: bundle loads as JS', asset.status === 200 && (asset.headers.get('content-type') ?? '').includes('javascript'))
  check('static: hashed asset is immutable-cached', (asset.headers.get('cache-control') ?? '').includes('immutable'))
  check('static: index.html is no-cache', (home.headers.get('cache-control') ?? '').includes('no-cache'))
  const demo = await fetch(base + '/demo')
  check('SPA: /demo falls back to index.html', demo.status === 200 && (await demo.text()).includes('<div id="root">'))
  const nope = await fetch(base + '/api/nope')
  check('api: unknown /api path is JSON 404 (not index.html)', nope.status === 404 && (await nope.json()).error === 'Not found')
  const wrongMethod = await fetch(base + '/api/select')
  check('api: GET /api/select is 405 with Allow: POST', wrongMethod.status === 405 && wrongMethod.headers.get('allow') === 'POST')

  // ---- B. Health + timeouts actually applied ---------------------------
  const health = await (await fetch(base + '/api/health')).json()
  check('health: ok + key configured + model', health.ok && health.apiKeyConfigured && health.model === 'claude-sonnet-5', JSON.stringify(health))
  check('timeout: Node requestTimeout applied = 300000ms', health.applied?.requestTimeout === 300_000, JSON.stringify(health.applied))
  check('timeout: Node socket timeout applied = 300000ms', health.applied?.socketTimeout === 300_000, JSON.stringify(health.applied))
  check('timeout: keep-alive outlasts front end (>=600s)', (health.applied?.keepAliveTimeout ?? 0) >= 600_000)

  // ---- C. /api/select streams through the REAL engine ------------------
  upstream.state.requests.length = 0
  upstream.state.mode = { kind: 'stream', gapMs: 0, totalMs: 2500 }
  const res = await post(base, '/api/select', { story: STORY, condition: 'A', ...GOLDEN_CONTEXT })
  check('select: 200 + ndjson content-type', res.status === 200 && (res.headers.get('content-type') ?? '').includes('ndjson'))
  const lines = await readNdjson(res)
  const deltas = lines.filter((l) => l.msg.type === 'delta')
  const result = lines.find((l) => l.msg.type === 'result')
  check('select: progress delta lines streamed', deltas.length >= 3, `deltas=${deltas.length}`)
  check('select: first delta arrives well before the result (true streaming, not buffered)', result && deltas[0] && result.at - deltas[0].at > 800, `first=${deltas[0]?.at} result=${result?.at}`)
  check('select: terminal result line equals the golden contract', JSON.stringify(result?.msg.result) === JSON.stringify(GOLDEN))
  check('select: primary is 迎 with 6 candidates', result?.msg.result.primary_kanji === '迎' && result?.msg.result.candidates.length === 6)
  check('select: result is the last line', lines.at(-1)?.msg.type === 'result')

  // What did the real engine actually send the model?
  const sent = upstream.state.requests.at(-1)
  const prompt = sent?.body.messages?.[0]?.content ?? ''
  check('engine→model: model is claude-sonnet-5, streaming, effort high', sent?.body.model === 'claude-sonnet-5' && sent?.body.stream === true && sent?.body.output_config?.effort === 'high', JSON.stringify({ m: sent?.body.model, s: sent?.body.stream, e: sent?.body.output_config }))
  check('engine→model: max_tokens 20000 (full depth, unchanged)', sent?.body.max_tokens === 20000)
  check('engine→model: prompt.ja.md loaded (skeleton + runtime contract + golden context)', prompt.includes('YOUR ROLE') && prompt.includes('OUTPUT CONTRACT (runtime)') && prompt.includes('kyujitai_form') && ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: birthday_milestone', 'occasion_detail: 還暦'].every((l) => prompt.includes(l)))
  check('engine→model: story injected at the slot, slot removed', prompt.includes(STORY) && !prompt.includes('{{ Paste the story here }}'))
  check('engine→model: API key comes from env (x-api-key header)', sent?.headers['x-api-key'] === 'test-key-not-real')

  // ---- D. Heartbeat during silent "reasoning" --------------------------
  upstream.state.mode = { kind: 'stream', gapMs: 4000, totalMs: 800 }
  const hb = await readNdjson(await post(base, '/api/select', { story: STORY }))
  const pings = hb.filter((l) => l.msg.type === 'ping')
  const firstReal = hb.find((l) => l.msg.type === 'delta' || l.msg.type === 'result')
  check('heartbeat: pings arrive during a silent model gap', pings.length >= 2, `pings=${pings.length}`)
  check('heartbeat: pings precede the first model output', pings[0] && firstReal && pings[0].at < firstReal.at)
  check('heartbeat: result still delivered intact', hb.at(-1)?.msg.type === 'result' && hb.at(-1).msg.result.primary_kanji === '迎')

  // ---- E. Error surfacing ---------------------------------------------
  upstream.state.mode = { kind: 'badjson' }
  const bad = await readNdjson(await post(base, '/api/select', { story: STORY }))
  const badErr = bad.find((l) => l.msg.type === 'error')
  check('error: non-JSON model output → ndjson error line', Boolean(badErr) && badErr.msg.error.startsWith('Engine failed:'), JSON.stringify(bad.map((l) => l.msg)))
  upstream.state.mode = { kind: 'upstream-400' }
  const up = await readNdjson(await post(base, '/api/select', { story: STORY }))
  check('error: upstream rejection → ndjson error line with reason', up.some((l) => l.msg.type === 'error' && /simulated upstream rejection/.test(l.msg.error)), JSON.stringify(up.map((l) => l.msg)))
  const noStory = await post(base, '/api/select', { story: '   ' })
  check('error: empty story → 400 JSON (handler validation reused)', noStory.status === 400 && /story/.test((await noStory.json()).error))
  const badJsonBody = await post(base, '/api/select', '{not json')
  check('error: malformed body → 400 JSON', badJsonBody.status === 400)

  // ---- F. /api/explain via the compat shim (api/explain.ts reused) ------
  upstream.state.mode = { kind: 'stream', gapMs: 0, totalMs: 300 }
  upstream.state.requests.length = 0
  const cand = { kanji: '迎', reading: 'むかえ', one_line_gaze: 'あなたは二十年、私の帰りをいつも駅で迎えてくれた。', story_anchor: '盆に帰るたびに車で駅まで迎えに来て' }
  const ex = await post(base, '/api/explain', { story: STORY, candidate: cand })
  const exBody = await ex.json()
  check('explain: 200 {explanation}', ex.status === 200 && exBody.explanation === EXPLAIN_TEXT, JSON.stringify(exBody))
  const exPrompt = upstream.state.requests.at(-1)?.body.messages?.[0]?.content ?? ''
  check('explain: explain-prompt.md loaded + candidate/story injected', exPrompt.includes('Stage-B Deep Explanation Prompt') && exPrompt.includes('迎') && exPrompt.includes(STORY) && !exPrompt.includes('{{KANJI}}'))
  const exMissing = await post(base, '/api/explain', { story: STORY })
  check('explain: missing candidate → 400 (shim passes handler error through)', exMissing.status === 400 && /candidate/.test((await exMissing.json()).error))
  const exBadBody = await post(base, '/api/explain', '{broken')
  const exBadJson = await exBadBody.json()
  check('explain: malformed JSON → 400 "Body is not valid JSON"', exBadBody.status === 400 && exBadJson.error === 'Body is not valid JSON', JSON.stringify(exBadJson))
  const exGet = await fetch(base + '/api/explain')
  check('explain: GET → 405', exGet.status === 405)

  // ---- G. /api/log -----------------------------------------------------
  const lg = await post(base, '/api/log', { event: 'candidate_returned', kanji: '迎', session_id: 'test-session' })
  await sleep(200)
  check('log: 204 and event echoed to stdout (→ Cloud Logging)', lg.status === 204 && server.logs().includes('[ichirei-event]') && server.logs().includes('candidate_returned'))

  // ---- H. Client disconnect mid-stream must not hurt the instance ------
  upstream.state.mode = { kind: 'stream', gapMs: 0, totalMs: 12_000 }
  const abort = new AbortController()
  const slow = await post(base, '/api/select', { story: STORY }, { signal: abort.signal })
  const reader = slow.body.getReader()
  await reader.read() // got at least one line
  abort.abort()
  await sleep(1500)
  check('abort: server process still alive after client disconnect', server.isAlive())
  upstream.state.mode = { kind: 'stream', gapMs: 0, totalMs: 500 }
  const after = await readNdjson(await post(base, '/api/select', { story: STORY }))
  check('abort: next request after a disconnect still completes', after.at(-1)?.msg.type === 'result')

  // ---- I. Missing key → clear Cloud Run-specific error -----------------
  const keyless = await startServer({ upstreamUrl: upstream.url, withKey: false })
  try {
    const h = await (await fetch(keyless.url + '/api/health')).json()
    check('no key: health reports apiKeyConfigured=false', h.apiKeyConfigured === false)
    const r = await post(keyless.url, '/api/select', { story: STORY })
    const body = await r.json()
    check('no key: 500 with Secret Manager guidance (not the Vercel message)', r.status === 500 && /Secret Manager/.test(body.error) && !/Vercel/.test(body.error), JSON.stringify(body))
  } finally {
    await keyless.stop()
  }

  // ---- J. (opt-in) one stream longer than Vercel's 60s cap --------------
  if (LONG) {
    console.log('\n--long: streaming a 75s response (Vercel Hobby would have killed this at 60s)…')
    upstream.state.mode = { kind: 'stream', gapMs: 25_000, totalMs: 50_000 }
    const tl = Date.now()
    const long = await readNdjson(await post(base, '/api/select', { story: STORY }))
    const secs = (Date.now() - tl) / 1000
    check(`long: completed after ${secs.toFixed(0)}s (> 60s) with the full result`, secs > 70 && long.at(-1)?.msg.type === 'result' && long.at(-1).msg.result.primary_kanji === '迎', `secs=${secs}`)
    check('long: heartbeat kept the silent opening alive', long.filter((l) => l.msg.type === 'ping').length >= 10)
  }
} finally {
  await server.stop()
  await upstream.close()
}

console.log(failures === 0 ? '\nALL SERVER CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
