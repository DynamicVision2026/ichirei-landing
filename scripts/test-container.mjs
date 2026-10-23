// Container test: runs the BUILT image like Cloud Run would and checks it.
//
//   docker build -t ichirei:local .
//   node scripts/test-container.mjs                 # default: port-mapped, upstream via host.docker.internal
//   CONTAINER_NETWORK=host node scripts/test-container.mjs   # Linux: --network host
//
// The model upstream is the fake from server-fixtures.mjs (ANTHROPIC_BASE_URL),
// so no API key or network is needed — everything else is the real image.

import { execFileSync } from 'node:child_process'
import { GOLDEN, GOLDEN_CONTEXT, STORY, startFakeAnthropic, readNdjson, sleep, freePort } from './server-fixtures.mjs'

const IMAGE = process.env.IMAGE ?? 'ichirei:local'
const HOST_NET = process.env.CONTAINER_NETWORK === 'host'
const CONTAINER_PORT = 9090 // deliberately not 8080: proves the PORT env var is honored
let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()

const upstream = await startFakeAnthropic()
upstream.state.mode = { kind: 'stream', gapMs: 0, totalMs: 2500 }

const hostPort = HOST_NET ? CONTAINER_PORT : await freePort()
const upstreamForContainer = HOST_NET
  ? upstream.url
  : `http://host.docker.internal:${upstream.port}`
const name = `ichirei-test-${process.pid}`
const runArgs = [
  'run', '-d', '--name', name,
  ...(HOST_NET ? ['--network', 'host'] : ['-p', `127.0.0.1:${hostPort}:${CONTAINER_PORT}`, '--add-host', 'host.docker.internal:host-gateway']),
  '-e', `PORT=${CONTAINER_PORT}`,
  '-e', 'ANTHROPIC_API_KEY=runtime-secret-not-baked',
  '-e', `ANTHROPIC_BASE_URL=${upstreamForContainer}`,
  '-e', 'ICHIREI_HEARTBEAT_MS=1000',
  IMAGE,
]

try {
  docker(...runArgs)
  const base = `http://127.0.0.1:${hostPort}`
  const deadline = Date.now() + 20_000
  let health
  while (Date.now() < deadline) {
    try { health = await (await fetch(base + '/api/health')).json(); break } catch { await sleep(250) }
  }
  check('container boots and answers on the PORT env var (9090, not 8080)', Boolean(health?.ok), docker('logs', name))

  // ---- image hygiene ---------------------------------------------------
  const imageEnv = JSON.parse(docker('inspect', IMAGE, '--format', '{{json .Config.Env}}')).join('\n')
  const history = docker('history', '--no-trunc', IMAGE)
  check('secret is NOT baked into the image (env or layers)', !/ANTHROPIC_API_KEY/.test(imageEnv) && !/ANTHROPIC_API_KEY/.test(history))
  check('runs as non-root user', docker('inspect', IMAGE, '--format', '{{.Config.User}}') === 'node' && docker('exec', name, 'id', '-u') !== '0')
  check('API key arrives only at runtime (health reports it configured)', health?.apiKeyConfigured === true)
  const sh = (cmd) => { try { return docker('exec', name, 'sh', '-c', cmd) } catch { return '' } }
  check('prompt assets shipped: engine/prompt.ja.md + prompt.zh.md + explain-prompt.md', sh('test -f engine/prompt.ja.md && test -f engine/prompt.zh.md && test -f engine/explain-prompt.md && echo yes') === 'yes')
  check('production deps only (no vite / @vercel/node / typescript in runtime)', sh('ls node_modules | grep -E "^(vite|typescript)$"; ls node_modules/@vercel 2>/dev/null') === '', sh('ls node_modules | head -50'))
  check('runtime has the server deps (hono, anthropic sdk)', sh('ls node_modules/hono node_modules/@anthropic-ai >/dev/null 2>&1 && echo yes') === 'yes')

  // ---- served frontend --------------------------------------------------
  const html = await (await fetch(base + '/')).text()
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
  check('frontend: root-relative bundle path (ICHIREI_BASE=/ in the image build)', Boolean(asset), html.slice(0, 300))
  check('frontend: bundle loads', asset && (await fetch(base + asset)).status === 200)
  check('frontend: /demo SPA fallback', (await (await fetch(base + '/demo')).text()).includes('<div id="root">'))

  // ---- applied timeouts -------------------------------------------------
  check('timeout: Node requestTimeout = 300000ms in the container', health?.applied?.requestTimeout === 300_000, JSON.stringify(health?.applied))
  check('timeout: socket timeout = 300000ms in the container', health?.applied?.socketTimeout === 300_000)

  // ---- streaming through the container ---------------------------------
  const res = await fetch(base + '/api/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ story: STORY, condition: 'A', ...GOLDEN_CONTEXT }) })
  const lines = await readNdjson(res)
  const deltas = lines.filter((l) => l.msg.type === 'delta')
  const result = lines.find((l) => l.msg.type === 'result')
  check('select: streams delta lines then the golden result (real engine in the image)', deltas.length >= 3 && JSON.stringify(result?.msg.result) === JSON.stringify(GOLDEN))
  check('select: true streaming (first delta well before result)', result && deltas[0] && result.at - deltas[0].at > 800)
  check('upstream saw claude-sonnet-5, prompt.ja.md injected, key from runtime env', (() => {
    const r = upstream.state.requests.at(-1)
    return r?.body.model === 'claude-sonnet-5' && r.body.messages[0].content.includes(STORY) && r.body.messages[0].content.includes('OUTPUT CONTRACT (runtime)') && r.headers['x-api-key'] === 'runtime-secret-not-baked'
  })())

  // ---- Cloud Run lifecycle: SIGTERM → clean exit -------------------------
  const t0 = Date.now()
  docker('stop', '-t', '10', name)
  const stopMs = Date.now() - t0
  const exit = docker('inspect', name, '--format', '{{.State.ExitCode}}')
  check('SIGTERM: graceful stop (exit 0, well under the 10s grace period)', exit === '0' && stopMs < 5000, `exit=${exit} stopMs=${stopMs}`)
} finally {
  try { docker('rm', '-f', name) } catch {}
  await upstream.close()
}
console.log(failures === 0 ? '\nALL CONTAINER CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
