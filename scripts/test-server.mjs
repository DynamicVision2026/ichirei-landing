// Cloud Run server test: the REAL server + REAL engine/prompt.<lang>.md/SDK against a
// fake Anthropic upstream. No API key, no network, no token spend.
//
//   node scripts/test-server.mjs           # ~20s
//   node scripts/test-server.mjs --long    # + a 75s stream proving no 60s cap
//
// Builds the frontend with ICHIREI_BASE=/ (as the Dockerfile does) so the
// static-serving checks run against the same kind of bundle that ships.

import { execSync } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOLDEN, GOLDEN_REFEREED, GOLDEN_CONTEXT, STORY, EXPLAIN_TEXT, sleep, startFakeAnthropic, startServer, readNdjson } from './server-fixtures.mjs'

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
  check('select: terminal result line equals the golden contract (after the palette referee)', JSON.stringify(result?.msg.result) === JSON.stringify(GOLDEN_REFEREED))
  check('select: primary is 迎 with 6 candidates', result?.msg.result.primary_kanji === '迎' && result?.msg.result.candidates.length === 6)
  check('select: result is the last line', lines.at(-1)?.msg.type === 'result')

  // What did the real engine actually send the model?
  const sent = upstream.state.requests.at(-1)
  const prompt = sent?.body.messages?.[0]?.content ?? ''
  check('engine→model: model is claude-sonnet-5, streaming, effort high', sent?.body.model === 'claude-sonnet-5' && sent?.body.stream === true && sent?.body.output_config?.effort === 'high', JSON.stringify({ m: sent?.body.model, s: sent?.body.stream, e: sent?.body.output_config }))
  check('engine→model: max_tokens 20000 (full depth, unchanged)', sent?.body.max_tokens === 20000)
  check('engine→model: prompt.ja.md loaded (skeleton + runtime contract + golden context)', prompt.includes('YOUR ROLE') && prompt.includes('OUTPUT CONTRACT (runtime)') && prompt.includes('inscription_form') && ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: birthday_milestone', 'occasion_detail: 還暦'].every((l) => prompt.includes(l)))
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
  check('explain: explain-prompt.ja.md loaded (default language) + candidate/story injected', exPrompt.includes('Stage-B Deep Explanation Prompt') && exPrompt.includes('Japanese / ja') && exPrompt.includes('迎') && exPrompt.includes(STORY) && !/\{\{ [A-Z_]+ \}\}/.test(exPrompt))
  const exZh = await post(base, '/api/explain', { story: '他總是把玄關的燈留著。', candidate: { kanji: '灯', inscription_form: '燈', reading: 'dēng', one_line_gaze: '你把燈留著。', story_anchor: '把玄關的燈留著' }, language: 'zh-Hant', relationship: 'parent_father', direction: 'up', occasion: 'seasonal_thanks' })
  const exZhPrompt = upstream.state.requests.at(-1)?.body.messages?.[0]?.content ?? ''
  check('explain: zh-Hant → explain-prompt.zh.md, display_script traditional, context + both forms injected', exZh.status === 200 && exZhPrompt.includes('Chinese / zh') && exZhPrompt.includes('display_script: traditional') && exZhPrompt.includes('occasion: seasonal_thanks') && exZhPrompt.includes('TRADITIONAL_FORM: 燈') && exZhPrompt.includes('SIMPLIFIED_FORM: 灯') && !/\{\{ [A-Z_]+ \}\}/.test(exZhPrompt))
  const exEn = await post(base, '/api/explain', { story: 'My mum left the porch light on every night until I got home.', candidate: { kanji: '灯', inscription_form: '燈', reading: 'on: tō · kun: hi, akari', meaning: 'lamp; a light kept lit', one_line_gaze: 'You left the porch light on every night.', story_anchor: 'left the porch light on' }, language: 'en', relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone', inscription_script: 'simplified' })
  const exEnPrompt = upstream.state.requests.at(-1)?.body.messages?.[0]?.content ?? ''
  check('explain: en → explain-prompt.en.md, romaji reading + English meaning + carved form + context injected, no slot left', exEn.status === 200 && exEnPrompt.includes('English / en') && exEnPrompt.includes('reading: on: tō · kun: hi, akari') && exEnPrompt.includes('meaning: lamp; a light kept lit') && exEnPrompt.includes('carved old form 燈') && exEnPrompt.includes('relationship: parent_mother') && !/\{\{ [A-Z_]+ \}\}/.test(exEnPrompt))
  const exBadCtx = await post(base, '/api/explain', { story: STORY, candidate: cand, occasion: 'kanreki' })
  check('explain: an invalid context code → 400', exBadCtx.status === 400 && /occasion/.test((await exBadCtx.json()).error))
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

  // ---- I2. Purchase flow through the real server (fake Shopify, file store) -------
  {
    const orderBody = {
      story: STORY, engine_result: GOLDEN_REFEREED, selected_kanji: '迎', language: 'ja', sender_name: '山田 太郎',
      receiver_name: '山田 一郎', delivery_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), inscription_style: 'kyujitai', package: 'simple',
    }
    const noOrders = await post(base, '/api/order', orderBody)
    const noOrdersJ = await noOrders.json()
    check('orders: an unconfigured server answers 503 (store_not_configured) and /api/health lists what is missing', noOrders.status === 503 && noOrdersJ.code === 'store_not_configured' && health.orders?.ready === false && health.orders.missing.includes('ORDER_BUCKET') && health.orders.missing.includes('SHOPIFY_STOREFRONT_TOKEN'), JSON.stringify(health.orders))
    check('orders: /api/order GET → 405 with Allow: POST', (await fetch(base + '/api/order')).status === 405)

    const dir = mkdtempSync(join(tmpdir(), 'ichirei-order-'))
    const seen = []
    const shop = http.createServer(async (req, res) => {
      let raw = ''
      for await (const c of req) raw += c
      seen.push({ url: req.url, token: req.headers['x-shopify-storefront-access-token'], body: JSON.parse(raw) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/k', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/k' }, userErrors: [] } } }))
    })
    await new Promise((r) => shop.listen(0, '127.0.0.1', r))
    const orders = await startServer({
      upstreamUrl: upstream.url,
      env: { ORDER_STORE_DIR: dir, SHOPIFY_STOREFRONT_TOKEN: 'shpat_server_test', SHOPIFY_VARIANT_SIMPLE: '1111', SHOPIFY_VARIANT_STANDARD: '2222', SHOPIFY_API_BASE: `http://127.0.0.1:${shop.address().port}` },
    })
    try {
      const h2 = await (await fetch(orders.url + '/api/health')).json()
      check('orders: configured server → health.orders.ready, store "file", no secret values in the health output', h2.orders.ready === true && h2.orders.store === 'file' && h2.orders.missing.length === 0 && !JSON.stringify(h2).includes('shpat_server_test'), JSON.stringify(h2.orders))
      const ok = await post(orders.url, '/api/order', orderBody)
      const okJ = await ok.json()
      check('orders: POST /api/order → 200 {order_ref, checkout_url, glyph, certificate_text}', ok.status === 200 && /^IC-\d{8}-[2-9A-Z]{8}$/.test(okJ.order_ref) && okJ.checkout_url === 'https://soul-id-2.myshopify.com/cart/c/k' && okJ.glyph === '迎' && okJ.certificate_text === 'この字は、あなたの目に映る、その人です。', JSON.stringify(okJ))
      const file = JSON.parse(readFileSync(join(dir, `${okJ.order_ref}.json`), 'utf8'))
      check('orders: the story and the engine result are stored server-side under that order_ref (gaze line and anchor included)', file.story === STORY && file.engine_result.candidates.length === 6 && file.production.gaze_line === GOLDEN.candidates[0].one_line_gaze && file.production.story_anchor === GOLDEN.candidates[0].story_anchor && file.status === 'cart_created')
      const line = seen[0].body.variables.input.lines[0]
      check('orders: Shopify got the Simple variant, the token header, and the eight attributes — without the story', seen[0].url === '/api/2025-01/graphql.json' && seen[0].token === 'shpat_server_test' && line.merchandiseId.endsWith('/1111') && line.attributes.map((a) => a.key).join() === 'kanji,inscription_form,reading,sender_name,receiver_name,delivery_date,language,order_ref' && line.attributes.at(-1).value === okJ.order_ref && !JSON.stringify(seen[0].body).includes('口下手'))
      const invalid = await post(orders.url, '/api/order', { ...orderBody, package: 'gold' })
      check('orders: invalid package → 400 and nothing more reaches Shopify', invalid.status === 400 && (await invalid.json()).field === 'package' && seen.length === 1)
    } finally {
      await orders.stop()
      shop.close()
    }
  }

  // ---- I3. /track through the real server (fake Shopify Admin API) -------------------
  {
    const noTrack = await post(base, '/api/track', { order: '#1016', email: 'a@b.co' })
    check('track: an unconfigured server answers 503 not_configured, and /api/health lists the missing id', noTrack.status === 503 && (await noTrack.json()).code === 'not_configured' && health.track?.ready === false && health.track.missing.join() === 'SHOPIFY_ADMIN_CLIENT_ID')
    check('track: GET /api/track → 405; the /track page itself is served (SPA) with HTML 200', (await fetch(base + '/api/track')).status === 405 && (await fetch(base + '/track?order=%231016')).status === 200 && (await (await fetch(base + '/track')).text()).includes('<div id="root">'))
    const admin = http.createServer(async (req, res) => {
      let raw = ''
      for await (const c of req) raw += c
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/admin/oauth/access_token') return res.end(JSON.stringify({ access_token: 'tok', expires_in: 86399, _secret_ok: JSON.parse(raw).client_secret === 'srv-secret' }))
      res.end(JSON.stringify({ data: { orders: { nodes: [{ name: '#1016', createdAt: '2026-10-20T03:00:00Z', email: 'hanako@example.com', cancelledAt: null, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', shippingAddress: { countryCodeV2: 'JP', address1: 'SECRET-STREET' }, lineItems: { nodes: [{ sku: 'ICHIREI-STANDARD' }] }, fulfillments: [] }] } } }))
    })
    await new Promise((r) => admin.listen(0, '127.0.0.1', r))
    const tracked = await startServer({
      upstreamUrl: upstream.url,
      env: { SHOPIFY_ADMIN_CLIENT_ID: 'cid', SHOPIFY_ADMIN_CLIENT_SECRET: 'srv-secret', SHOPIFY_ADMIN_API_BASE: `http://127.0.0.1:${admin.address().port}` },
    })
    try {
      const h3 = await (await fetch(tracked.url + '/api/health')).json()
      const ok = await post(tracked.url, '/api/track', { order: '#1016', email: 'Hanako@example.com' })
      const okT = await ok.text()
      const miss = await post(tracked.url, '/api/track', { order: '#1016', email: 'other@example.com' })
      check('track: configured server → health.track.ready; matching email → 200 processing; wrong email → 404; no address, email or secret in any body', h3.track.ready === true && ok.status === 200 && JSON.parse(okT).status === 'processing' && JSON.parse(okT).sku[0] === 'ICHIREI-STANDARD' && miss.status === 404 && !okT.includes('SECRET-STREET') && !okT.includes('hanako') && !JSON.stringify(h3).includes('srv-secret'), okT)
    } finally {
      await tracked.stop()
      admin.close()
    }
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
