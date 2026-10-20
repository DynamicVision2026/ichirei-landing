// The Cloud Run transport for the ICHIREI engine.
//
// This file is deliberately thin. The engine (engine/*.ts) and the HTTP
// handlers (api/*.ts) are reused UNCHANGED — this just mounts them on a plain
// Node server and serves the built frontend. Reasoning still lives only in
// engine/prompt.md (cardinal rule); nothing here selects or interprets anything.

import type { Server } from 'node:http'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { POST as selectPost } from '../api/select.ts'
import explainHandler from '../api/explain.ts'
import logHandler from '../api/log.ts'
import { ENGINE_CONFIG } from '../engine/engine.ts'
import { adaptVercelHandler } from './vercel-compat.ts'
import { withHeartbeat } from './heartbeat.ts'

export interface ServerConfig {
  /** Max time to receive a full request from the client (Node http server). */
  requestTimeoutMs: number
  /** Socket-inactivity cap; also bounds a connection that goes fully silent. */
  socketTimeoutMs: number
  /** Inject a {"type":"ping"} NDJSON line after this much stream silence (0 = off). */
  heartbeatMs: number
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Set by server/index.ts once listening, so /api/health can report what the
 *  Node http server ACTUALLY applied (not merely what was configured). */
export const serverRef: { current?: Server } = {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    // 300s: generous on purpose — long reasoning passes are the reason this
    // service exists. Keep in step with Cloud Run's --timeout (cloudbuild.yaml)
    // and the frontend deadline (ENGINE_TIMEOUT_MS in src/demo/DemoApp.tsx).
    requestTimeoutMs: num(env.ICHIREI_REQUEST_TIMEOUT_MS, 300_000),
    socketTimeoutMs: num(env.ICHIREI_SOCKET_TIMEOUT_MS, 300_000),
    heartbeatMs: num(env.ICHIREI_HEARTBEAT_MS, 10_000),
  }
}

export function createApp(config: ServerConfig): Hono {
  const app = new Hono()

  // Fail clearly if the secret was not mounted (api/select.ts' own message is
  // Vercel-specific, so intercept first with a Cloud Run-appropriate one).
  const requireApiKey: MiddlewareHandler = async (c, next) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return c.json(
        {
          error:
            'ANTHROPIC_API_KEY is not set on the server. Mount the Secret Manager secret as an env var on the Cloud Run service (see DEPLOY.md).',
        },
        500,
      )
    }
    await next()
  }

  // ---- API -------------------------------------------------------------
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: ENGINE_CONFIG.MODEL,
      effort: ENGINE_CONFIG.EFFORT,
      maxTokens: ENGINE_CONFIG.MAX_TOKENS,
      configured: config,
      applied: serverRef.current
        ? {
            requestTimeout: serverRef.current.requestTimeout,
            headersTimeout: serverRef.current.headersTimeout,
            keepAliveTimeout: serverRef.current.keepAliveTimeout,
            socketTimeout: serverRef.current.timeout,
          }
        : null,
    }),
  )

  // Streams NDJSON (delta … result|error) — handler reused as-is.
  app.post('/api/select', requireApiKey, async (c) =>
    withHeartbeat(await selectPost(c.req.raw), config.heartbeatMs),
  )
  app.post('/api/explain', requireApiKey, adaptVercelHandler(explainHandler))
  app.post('/api/log', adaptVercelHandler(logHandler))

  const methodNotAllowed = (c: Context) =>
    c.json({ error: 'Method not allowed' }, 405, { Allow: 'POST' })
  app.all('/api/select', methodNotAllowed)
  app.all('/api/explain', methodNotAllowed)
  app.all('/api/log', methodNotAllowed)
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  // ---- Frontend (built Vite output) ------------------------------------
  // Hashed bundles under /assets are immutable; everything else revalidates so
  // a redeploy is picked up immediately.
  app.use(
    '/*',
    serveStatic({
      root: './dist',
      onFound: (path, c) => {
        c.header(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    }),
  )
  // SPA fallback: /demo and any other client route get index.html.
  app.get(
    '*',
    serveStatic({
      root: './dist',
      path: 'index.html',
      onFound: (_path, c) => {
        c.header('Cache-Control', 'no-cache')
      },
    }),
  )

  return app
}
