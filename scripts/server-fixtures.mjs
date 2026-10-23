// Shared fixtures for the Cloud Run server tests (no API key, no network):
//   - startFakeAnthropic(): a stand-in for api.anthropic.com that speaks the
//     real Messages SSE streaming protocol. The REAL engine + SDK talk to it via
//     ANTHROPIC_BASE_URL, so only the model itself is mocked.
//   - startServer(): boots the REAL server (server/index.ts) as a child process.

import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { applyPalette, loadPalette } from '../engine/palette.ts'

export const GOLDEN = JSON.parse(
  readFileSync(new URL('./golden-fixture.json', import.meta.url), 'utf8'),
)

// The context the golden fixture is run with (spec: ja / parent_father / up / birthday_milestone,
// plus the optional occasion_detail that says which birthday).
export const GOLDEN_CONTEXT = {
  language: GOLDEN.language,
  relationship: GOLDEN.relationship,
  direction: GOLDEN.direction,
  occasion: GOLDEN.occasion,
  occasion_detail: GOLDEN.occasion_detail,
}

export const STORY =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

// What the engine returns for the golden model answer: the same JSON after the palette referee.
export const GOLDEN_REFEREED = applyPalette(GOLDEN, loadPalette(), STORY)

export const EXPLAIN_TEXT =
  '折り目正しくというより、行き先のあるやさしさだった。「金は要るか」とだけ言って封筒を押し付けたあの改札から二十年、あなたは一度も迎えを欠かさなかった。還暦を迎えるいま、こんどは私があなたを迎えにいく番だと思う。'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

/**
 * Fake Anthropic upstream. Behaviour is switched per test via `state.mode`:
 *   { kind: 'stream', gapMs, totalMs }  silent gap, then text streamed over totalMs
 *   { kind: 'badjson' }                 model replies with non-JSON prose
 *   { kind: 'upstream-400' }            upstream rejects the request (non-retryable)
 */
export async function startFakeAnthropic() {
  const state = {
    requests: [],
    aborted: 0,
    mode: { kind: 'stream', gapMs: 0, totalMs: 1500 },
  }
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404)
      return res.end()
    }
    const body = JSON.parse(raw)
    state.requests.push({ headers: req.headers, body })
    const m = state.mode
    res.on('close', () => {
      if (!res.writableEnded) state.aborted++
    })

    if (m.kind === 'upstream-400') {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'simulated upstream rejection' },
        }),
      )
    }

    const prompt =
      typeof body.messages?.[0]?.content === 'string'
        ? body.messages[0].content
        : JSON.stringify(body.messages?.[0]?.content)
    const isExplain = prompt.includes('Stage-B Deep Explanation Prompt')
    const text =
      m.kind === 'badjson'
        ? '申し訳ありません。JSONを生成できませんでした。'
        : isExplain
          ? EXPLAIN_TEXT
          : JSON.stringify(GOLDEN)

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_fake', type: 'message', role: 'assistant', model: body.model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 1 },
      },
    })
    sse('content_block_start', {
      type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
    })
    // Simulated "thinking" silence: no bytes of model text for gapMs.
    if (m.gapMs) await sleep(m.gapMs)

    const pieces = []
    for (let i = 0; i < text.length; i += 160) pieces.push(text.slice(i, i + 160))
    const pause = (m.totalMs ?? 1500) / Math.max(1, pieces.length)
    for (const piece of pieces) {
      await sleep(pause)
      if (res.destroyed) return
      sse('content_block_delta', {
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece },
      })
    }
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1234 },
    })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  return {
    state,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }),
  }
}

/** Boot the real server as a child process; resolves once it is listening. */
export async function startServer({ upstreamUrl, env = {}, withKey = true } = {}) {
  const port = await freePort()
  const childEnv = { ...process.env, PORT: String(port), ...env }
  delete childEnv.ANTHROPIC_API_KEY
  if (withKey) childEnv.ANTHROPIC_API_KEY = 'test-key-not-real'
  if (upstreamUrl) childEnv.ANTHROPIC_BASE_URL = upstreamUrl

  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'],
    { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let out = ''
  let exited = false
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (out += d))
  proc.on('exit', () => (exited = true))

  const deadline = Date.now() + 15_000
  while (!out.includes('listening on')) {
    if (exited) throw new Error(`server exited during boot:\n${out}`)
    if (Date.now() > deadline) throw new Error(`server did not start:\n${out}`)
    await sleep(100)
  }
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    logs: () => out,
    isAlive: () => !exited,
    stop: async () => {
      if (exited) return
      proc.kill('SIGTERM')
      await Promise.race([new Promise((r) => proc.on('exit', r)), sleep(3000)])
      if (!exited) proc.kill('SIGKILL')
    },
  }
}

/** Read an NDJSON response, returning every line with its arrival time. */
export async function readNdjson(res) {
  const lines = []
  const t0 = Date.now()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) lines.push({ at: Date.now() - t0, msg: JSON.parse(line) })
    }
  }
  return lines
}
