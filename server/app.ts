// The Cloud Run transport for the ICHIREI engine.
//
// This file is deliberately thin. The engine (engine/*.ts) and the HTTP
// handlers (api/*.ts) are reused UNCHANGED — this just mounts them on a plain
// Node server and serves the built frontend. Reasoning still lives only in
// engine/prompt.<lang>.md (cardinal rule); nothing here selects or interprets anything.

import type { Server } from 'node:http'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { compress } from 'hono/compress'
import { POST as selectPost } from '../api/select.ts'
import { POST as orderPost } from '../api/order.ts'
import { POST as poemPost } from '../api/poem.ts'
import { POST as trackPost } from '../api/track.ts'
import { claimHandlers } from '../api/claim.ts'
import { handlers as animationHandlers } from '../api/animation.ts'
import { handlers as previewHandlers } from '../api/preview.ts'
import { handlers as selftestHandlers } from '../api/selftest.ts'
import { readFile } from 'node:fs/promises'
import { handlers as giftHandlers } from '../api/gift.ts'
import { handlers as opsHandlers } from '../api/ops.ts'
import { statsHandlers } from '../api/ops-stats.ts'
import { POST as analyticsPost } from '../api/analytics.ts'
import { GET as ratesGet } from '../api/rates.ts'
import { GET as sizesGet } from '../api/sizes.ts'
import { loadTrackConfig } from '../engine/track.ts'
import { createOrderStore } from '../engine/order-store.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import explainHandler from '../api/explain.ts'
import logHandler from '../api/log.ts'
import { ENGINE_CONFIG } from '../engine/engine.ts'
import { lexiconModeFromEnv } from '../engine/lexicon.ts'
import { cardsMode } from '../engine/cards.ts'
import { simpleMaxStrokes } from '../engine/strokes.ts'
import { adaptVercelHandler } from './vercel-compat.ts'
import { envRunLimiter } from '../engine/rate-limit.ts'
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

/** What /api/health reports about the purchase flow: configured or not, and what is missing. */
export function orderReadiness(env: NodeJS.ProcessEnv = process.env) {
  const shopify = loadShopifyConfig(env)
  const store = createOrderStore(env)
  const missing = [...(store ? [] : ['ORDER_BUCKET']), ...shopify.missing]
  return {
    ready: missing.length === 0,
    store: store?.kind ?? null,
    shopifyStore: (env.SHOPIFY_STORE_DOMAIN || 'soul-id-2.myshopify.com').trim(),
    missing,
  }
}

const previewRefused = () => new Response(JSON.stringify({ error: 'preview_only', message: 'This is a preview: nothing here is sent.' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } })

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
      // Purchase flow readiness — which settings are still missing, never their values.
      orders: orderReadiness(),
      // /track readiness: the client id is configured; the secret itself is checked on first use.
      track: { ready: loadTrackConfig().missing.length === 0, missing: loadTrackConfig().missing },
      model: ENGINE_CONFIG.MODEL,
      effort: ENGINE_CONFIG.EFFORT,
      maxTokens: ENGINE_CONFIG.MAX_TOKENS,
      maxTokensRetry: ENGINE_CONFIG.MAX_TOKENS_RETRY,
      reviewModel: ENGINE_CONFIG.REVIEW_MODEL,
      reviewEffort: ENGINE_CONFIG.REVIEW_EFFORT,
      callTimeoutMs: ENGINE_CONFIG.CALL_TIMEOUT_MS,
      reviewTimeoutMs: ENGINE_CONFIG.REVIEW_TIMEOUT_MS,
      lexiconMode: lexiconModeFromEnv(),
      cardsMode: cardsMode(), // parallel | single (ICHIREI_CARDS=single is the rollback)
      // Which build is live: the short commit SHA (Cloud Build's SHORT_SHA, passed at deploy) and when it was deployed. null when the deploy did not set them (a local run).
      selftest: { configured: Boolean(process.env.ICHIREI_SELFTEST_TOKEN?.trim()) },
      commit: process.env.ICHIREI_COMMIT?.trim() || null,
      deployedAt: process.env.ICHIREI_DEPLOYED_AT?.trim() || null,
      filmPictures: { model: process.env.ICHIREI_FILM_IMAGE_MODEL || 'gemini-3.1-flash-image|gemini-2.5-flash-image', location: process.env.ICHIREI_FILM_IMAGE_LOCATION || 'global', dailyMax: process.env.ICHIREI_FILM_DAILY_MAX || '200' },
      simpleMaxStrokes: simpleMaxStrokes(),
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

  // Per-IP brake on the two routes that cost a model call (ICHIREI_SELECT_LIMIT / ICHIREI_EXPLAIN_LIMIT = "max/minutes" or "off").
  // Per Cloud Run instance, like the other limiters: a brake on a runaway or abusive client, not an exact quota. Every request
  // that reaches the route counts (before the body is read), so a refused one never costs a model call.
  const selectLimit = envRunLimiter('ICHIREI_SELECT_LIMIT', { max: 12, minutes: 60 })
  const explainLimit = envRunLimiter('ICHIREI_EXPLAIN_LIMIT', { max: 40, minutes: 60 })
  const poemLimit = envRunLimiter('ICHIREI_POEM_LIMIT', { max: 20, minutes: 60 })
  const limited = (limiter: typeof selectLimit): MiddlewareHandler => async (c, next) => {
    const r = limiter.check(c.req.raw)
    if (r.ok) return next()
    console.log(`[ichirei-limit] ${JSON.stringify({ route: new URL(c.req.url).pathname, limited: true })}`)
    return c.json({ error: 'Too many requests from this connection. Please wait a little and try again.', code: 'rate_limited' }, 429, { 'Retry-After': String(r.retryAfterSeconds) })
  }

  // Streams NDJSON (stage … delta … result|error) — handler reused as-is.
  app.post('/api/select', requireApiKey, limited(selectLimit), async (c) =>
    withHeartbeat(await selectPost(c.req.raw), config.heartbeatMs),
  )
  app.post('/api/explain', requireApiKey, limited(explainLimit), adaptVercelHandler(explainHandler))
  // The included poem: one model call per poem (45 s ceiling), 20 per hour per IP; all four formats are always available.
  app.post('/api/poem', requireApiKey, limited(poemLimit), (c) => poemPost(c.req.raw))
  // The story animation (/a/<id>): the private view of one order and a QR code of its address. Generous
  // per-IP limit (ICHIREI_ANIMATION_LIMIT): a page load makes a handful of calls; this only stops scraping.
  const animationLimit = envRunLimiter('ICHIREI_ANIMATION_LIMIT', { max: 120, minutes: 10 })
  app.get('/api/animation/:id', limited(animationLimit), (c) => animationHandlers.view(c.req.param('id')))
  app.get('/api/animation/:id/qr.svg', limited(animationLimit), (c) => animationHandlers.qr(c.req.param('id')))
  // The film's pictures: drawn on the first open (the request stays open until they are done — it holds one image-model run, so a tight per-IP limit),
  // then served from the private bucket through the server.
  const filmRenderLimit = envRunLimiter('ICHIREI_FILM_RENDER_LIMIT', { max: 30, minutes: 10 })
  app.post('/api/animation/:id/collect', limited(animationLimit), (c) => animationHandlers.collect(c.req.param('id')))
  app.post('/api/film/:id/render', requireApiKey, limited(filmRenderLimit), (c) => animationHandlers.render(c.req.param('id')))
  // The post-deploy self-test (v9.8): the internal purpose stories through the real pipeline (no pictures). The run needs the secret token (header x-selftest-token), is capped at 6 a day and skipped for a commit
  // already tested; the latest report is public, read-only and cached 60 s — codes and characters only, never a line of any story.
  app.post('/api/selftest/run', requireApiKey, (c) => selftestHandlers.run(c.req.raw))
  app.get('/api/selftest/latest', () => selftestHandlers.latest())
  // The free card preview (before payment): the draft is made the moment a character is picked; its pictures are drawn once per story.
  const previewLimit = envRunLimiter('ICHIREI_PREVIEW_LIMIT', { max: 30, minutes: 60 })
  app.post('/api/preview', requireApiKey, limited(previewLimit), (c) => previewHandlers.start(c.req.raw))
  app.post('/api/preview/:id/render', requireApiKey, limited(filmRenderLimit), (c) => previewHandlers.render(c.req.param('id'), c.req.raw))
  app.get('/api/preview/:id', limited(animationLimit), (c) => previewHandlers.view(c.req.param('id'), c.req.raw))
  app.get('/api/film/:id/picture/:file', limited(animationLimit), (c) => animationHandlers.picture(c.req.param('id'), c.req.param('file').replace(/\.webp$/, '')))
  // The receiver's gift page (/g/<token>): its own view, pictures, render and QR; and the e-gift address (typed once, never returned by any call).
  app.get('/api/gift/:token', limited(animationLimit), (c) => giftHandlers.view(c.req.param('token'), c.req.query('preview')))
  app.get('/api/gift/:token/og.png', limited(animationLimit), (c) => giftHandlers.og(c.req.param('token')))
  app.get('/api/gift/:token/qr.png', limited(animationLimit), (c) => giftHandlers.qrPng(c.req.param('token')))
  app.get('/api/gift/:token/qr.svg', limited(animationLimit), (c) => giftHandlers.qr(c.req.param('token')))
  app.post('/api/gift/:token/render', requireApiKey, limited(filmRenderLimit), (c) => giftHandlers.render(c.req.param('token'), c.req.query('preview')))
  app.get('/api/gift/:token/picture/:file', limited(animationLimit), (c) => giftHandlers.picture(c.req.param('token'), c.req.param('file').replace(/\.webp$/, ''), c.req.query('preview')))
  // The story scroll: an image is drawn per request (a few seconds of CPU), so a tight per-IP limit.
  const scrollLimit = envRunLimiter('ICHIREI_SCROLL_LIMIT', { max: 20, minutes: 10 })
  for (const ext of ['png', 'pdf']) {
    app.get(`/api/gift/:token/scroll.${ext}`, limited(scrollLimit), (c) => giftHandlers.scroll(c.req.param('token'), ext, c.req.query('preview')))
    app.get(`/api/animation/:id/scroll.${ext}`, limited(scrollLimit), (c) => giftHandlers.scrollForSender(c.req.param('id'), ext))
  }
  const replyLimit = envRunLimiter('ICHIREI_GIFT_REPLY_LIMIT', { max: 20, minutes: 60 })
  // a sender looking at the gift in preview mode (?preview=…) can never answer it or receive it: nothing in preview marks the gift as opened, replied to or received
  app.post('/api/gift/:token/reply', limited(replyLimit), async (c) => (c.req.query('preview') ? previewRefused() : giftHandlers.reply(c.req.param('token'), await c.req.json().catch(() => null))))
  // The keepsakes: the film as a video (made once per order, about half a minute of one CPU — a tight per-IP limit) and the card as a PDF.
  const videoLimit = envRunLimiter('ICHIREI_FILM_VIDEO_LIMIT', { max: 8, minutes: 10 })
  app.post('/api/gift/:token/film/make', limited(videoLimit), (c) => giftHandlers.filmMake(c.req.param('token'), c.req.query('preview')))
  app.get('/api/gift/:token/film.mp4', limited(animationLimit), (c) => giftHandlers.filmGet(c.req.param('token'), c.req.raw, c.req.query('preview')))
  app.get('/api/gift/:token/card.pdf', limited(scrollLimit), (c) => giftHandlers.cardPdf(c.req.param('token'), c.req.query('preview')))
  app.get('/api/gift/:token/keepsake-card.png', limited(scrollLimit), (c) => giftHandlers.keepsakeCard(c.req.param('token'), c.req.query('preview')))
  app.post('/api/animation/:id/schedule', limited(replyLimit), async (c) => giftHandlers.scheduleForSender(c.req.param('id'), await c.req.json().catch(() => null)))
  app.get('/api/animation/:id/keepsake-card.png', limited(scrollLimit), (c) => giftHandlers.keepsakeCardForSender(c.req.param('id')))
  // sharing to social media (2026-11-06): the share film (MP4 1080×1920) and the poem card (PNG 1080×1350) — only after collecting / opening, never for remembrance, never in preview mode
  app.post('/api/animation/:id/share/film/make', limited(videoLimit), (c) => giftHandlers.shareFilmMakeForSender(c.req.param('id')))
  app.get('/api/animation/:id/share-film.mp4', limited(animationLimit), (c) => giftHandlers.shareFilmGetForSender(c.req.param('id'), c.req.raw))
  app.get('/api/animation/:id/share-card.png', limited(scrollLimit), (c) => giftHandlers.shareCardForSender(c.req.param('id')))
  app.post('/api/gift/:token/share/film/make', limited(videoLimit), (c) => (c.req.query('preview') ? previewRefused() : giftHandlers.shareFilmMake(c.req.param('token'))))
  app.get('/api/gift/:token/share-film.mp4', limited(animationLimit), (c) => (c.req.query('preview') ? previewRefused() : giftHandlers.shareFilmGet(c.req.param('token'), c.req.raw)))
  app.get('/api/gift/:token/share-card.png', limited(scrollLimit), (c) => (c.req.query('preview') ? previewRefused() : giftHandlers.shareCard(c.req.param('token'))))
  app.post('/api/animation/:id/film/make', limited(videoLimit), (c) => giftHandlers.filmMakeForSender(c.req.param('id')))
  app.get('/api/animation/:id/film.mp4', limited(animationLimit), (c) => giftHandlers.filmGetForSender(c.req.param('id'), c.req.raw))
  app.get('/api/animation/:id/card.pdf', limited(scrollLimit), (c) => giftHandlers.cardPdfForSender(c.req.param('id')))
  const addressLimit = envRunLimiter('ICHIREI_GIFT_ADDRESS_LIMIT', { max: 20, minutes: 60 })
  app.post('/api/gift/:token/address', limited(addressLimit), async (c) => (c.req.query('preview') ? previewRefused() : giftHandlers.address(c.req.param('token'), await c.req.json().catch(() => null))))
  // The owner's page (Basic Auth, ICHIREI_OPS_PASSWORD; refused outright without it). Never indexed, never cached.
  const opsLimit = envRunLimiter('ICHIREI_OPS_LIMIT', { max: 120, minutes: 10 })
  app.get('/ops', limited(opsLimit), (c) => opsHandlers.page(c.req.raw))
  app.get('/ops/stats', limited(opsLimit), (c) => statsHandlers.page(c.req.raw))
  app.get('/ops/stats.json', limited(opsLimit), (c) => statsHandlers.json(c.req.raw))
  app.get('/ops/card/:file', limited(opsLimit), (c) => opsHandlers.card(c.req.raw, c.req.param('file').replace(/\.pdf$/, '')))
  app.get('/ops/cards/today.pdf', limited(opsLimit), (c) => opsHandlers.cardsToday(c.req.raw))
  app.get('/ops/wooden-today.csv', limited(opsLimit), (c) => opsHandlers.woodenCsv(c.req.raw))
  app.post('/ops/mark', limited(opsLimit), (c) => opsHandlers.mark(c.req.raw))
  app.post('/ops/wood', limited(opsLimit), (c) => opsHandlers.wood(c.req.raw))
  app.post('/ops/change', limited(opsLimit), (c) => opsHandlers.change(c.req.raw))
  app.post('/ops/egift/run', limited(opsLimit), (c) => opsHandlers.egiftRun(c.req.raw))
  app.post('/api/log', adaptVercelHandler(logHandler))
  // Purchase hand-off: stores the story + result under order_ref, creates the Shopify cart.
  app.post('/api/order', (c) => orderPost(c.req.raw))
  // Order status (read-only, ICHIREI orders only): number + email → status, carrier, tracking.
  app.post('/api/track', (c) => trackPost(c.req.raw))
  // Orders paid WITHOUT going through our site ("waiting" orders, 2026-11-13): /claim checks the order number and e-mail (5 tries an hour per IP, in the handler);
  // the Shopify order-payment webhook (signed) records the order. Neither ever writes to Shopify.
  app.post('/api/claim', (c) => claimHandlers.claim(c.req.raw))
  app.post('/api/shopify/orders-paid', (c) => claimHandlers.webhook(c.req.raw))
  // Learning loop: two browser events (chosen, explain_opened) → analytics/YYYY-MM-DD.jsonl. Always 204.
  app.post('/api/analytics', (c) => analyticsPost(c.req.raw))

  // Approximate JPY rates for the "≈ US$65" lines (display only; null → the page hides them).
  app.get('/api/rates', () => ratesGet())
  // Which sizes of the gift can be ordered now (those with a Shopify variant); the page hides the rest.
  app.get('/api/sizes', () => sizesGet())

  const methodNotAllowed = (c: Context) =>
    c.json({ error: 'Method not allowed' }, 405, { Allow: 'POST' })
  app.all('/api/select', methodNotAllowed)
  app.all('/api/explain', methodNotAllowed)
  app.all('/api/log', methodNotAllowed)
  app.all('/api/order', methodNotAllowed)
  app.all('/api/poem', methodNotAllowed)
  app.all('/api/track', methodNotAllowed)
  app.all('/api/claim', methodNotAllowed)
  app.all('/api/shopify/orders-paid', methodNotAllowed)
  app.all('/api/analytics', methodNotAllowed)
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  // The private animation pages are never indexed.
  app.use('/a/*', async (c, next) => {
    await next()
    c.header('X-Robots-Tag', 'noindex, nofollow')
  })
  app.use('/claim', async (c, next) => {
    await next()
    c.header('X-Robots-Tag', 'noindex, nofollow')
  })
  app.use('/g/*', async (c, next) => {
    await next()
    c.header('X-Robots-Tag', 'noindex, nofollow')
  })
  // The receiver's link, as HTML for the crawlers of LINE, WhatsApp, WeChat and mail (they do not run the page's scripts): this gift's own Open Graph tags
  // (names and the opening date, and the envelope picture — never the character). Everything else about the page is the built index.html.
  let indexHtml: string | null = null
  app.get('/g/:token', limited(animationLimit), async (c, next) => {
    try {
      indexHtml ??= await readFile('./dist/index.html', 'utf8')
    } catch {
      return next()
    }
    return (await giftHandlers.page(c.req.param('token'), indexHtml)) ?? next()
  })

  // The built bundle, stylesheet and pages are text: gzip them (Cloud Run does not). Never the API — the NDJSON
  // stream and its heartbeat must reach the browser byte by byte, so /api/* is left exactly as it was.
  const gzip = compress()
  app.use('/*', (c, next) => (c.req.path.startsWith('/api/') ? next() : gzip(c, next)))

  // ---- Frontend (built Vite output) ------------------------------------
  // Hashed bundles under /assets are immutable; the photos under /img keep for an hour (a swapped photo
  // shows up within the hour); everything else revalidates so a redeploy is picked up immediately.
  app.use(
    '/*',
    serveStatic({
      root: './dist',
      onFound: (path, c) => {
        c.header(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : path.includes('/img/') ? 'public, max-age=3600' : 'no-cache',
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
