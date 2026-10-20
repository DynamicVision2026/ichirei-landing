// Process entry point for Cloud Run (and `npm start` locally).
//   - listens on the PORT env var Cloud Run provides (default 8080)
//   - ANTHROPIC_API_KEY comes from the environment (a mounted Secret Manager
//     secret in production — never baked into the image)

import { createServer, type Server } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp, loadConfig, serverRef } from './app.ts'

// Run from the project root so ./dist and the engine's cwd-relative prompt
// lookups resolve regardless of where the process was started.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

// A stray rejection (e.g. a client that disconnects mid-stream) must not take
// down an instance that may be serving other requests.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

const config = loadConfig()
const app = createApp(config)
const port = Number(process.env.PORT ?? 8080)

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
    createServer,
    serverOptions: {
      requestTimeout: config.requestTimeoutMs,
      headersTimeout: Math.min(60_000, config.requestTimeoutMs || 60_000),
      // Outlast the front end's idle expectations so a reused connection is
      // never closed out from under it.
      keepAliveTimeout: 620_000,
    },
  },
  (info) => {
    console.log(
      `[ichirei] listening on :${info.port} — requestTimeout=${config.requestTimeoutMs}ms socketTimeout=${config.socketTimeoutMs}ms heartbeat=${config.heartbeatMs}ms apiKey=${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'}`,
    )
  },
) as Server
server.timeout = config.socketTimeoutMs
serverRef.current = server

// Cloud Run sends SIGTERM before stopping an instance (10s grace).
process.on('SIGTERM', () => {
  console.log('[ichirei] SIGTERM — closing')
  server.close(() => process.exit(0))
  server.closeIdleConnections()
})
