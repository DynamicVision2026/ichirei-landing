// Local mock of the Vercel API surface, implementing the same NDJSON streaming
// protocol as api/select.ts — lets the harness be exercised (and the streaming
// client verified) without an API key or token spend.
//
//   node scripts/mock-api.mjs            # port 8787
//   ICHIREI_MOCK_API=1 npm run dev      # vite proxies /api -> :8787
//
// Query/env knobs: MOCK_DELAY_MS (total stream duration, default 3000),
// POST /api/select?mode=hang never responds (for timeout testing),
// POST /api/select?mode=error emits an NDJSON error line.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(here, 'golden-fixture.json'), 'utf8'))
const PORT = Number(process.env.MOCK_PORT ?? 8787)
const TOTAL_MS = Number(process.env.MOCK_DELAY_MS ?? 3000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let body = ''
  for await (const chunk of req) body += chunk

  if (url.pathname === '/api/select' && req.method === 'POST') {
    const mode = url.searchParams.get('mode')
    if (mode === 'hang') return // never respond — client timeout test
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    })
    if (mode === 'error') {
      res.write(JSON.stringify({ type: 'error', error: 'Engine failed: simulated model parse failure' }) + '\n')
      return res.end()
    }
    // Simulate the model streaming: 10 progress lines spread over TOTAL_MS.
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      await sleep(TOTAL_MS / (steps + 1))
      res.write(JSON.stringify({ type: 'delta', chars: i * 210 }) + '\n')
    }
    await sleep(TOTAL_MS / (steps + 1))
    res.write(JSON.stringify({ type: 'result', result: FIXTURE }) + '\n')
    return res.end()
  }

  if (url.pathname === '/api/explain' && req.method === 'POST') {
    await sleep(400)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({
      explanation:
        '折り目正しくというより、行き先のあるやさしさだった。「金は要るか」とだけ言って封筒を押し付けたあの改札から二十年、あなたは一度も迎えを欠かさなかった。還暦を迎えるいま、こんどは私があなたを迎えにいく番だと思う。',
    }))
  }

  if (url.pathname === '/api/log' && req.method === 'POST') {
    res.writeHead(204)
    return res.end()
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => console.log(`mock api on :${PORT} (stream ${TOTAL_MS}ms)`))
