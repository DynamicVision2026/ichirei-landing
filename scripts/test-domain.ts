// ichirei.beyondculture.ai becomes the main address (2026-11-16). No network, no model, no Shopify.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-domain.ts
// The two live hosts against the real server (redirect off and on) are in scripts/test-server.mjs (section I2).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Liquid } from 'liquidjs'
import { DEFAULT_PUBLIC_URL, animationUrl, publicUrl } from '../engine/animation.ts'
import { giftUrl } from '../engine/gift.ts'
import { landingShare } from '../engine/landing-share.ts'
import { ogMeta } from '../engine/gift-share.ts'
import { icsText, googleCalendarUrl } from '../src/order/calendar.ts'
import { LEGAL } from '../src/legal/legal-copy.ts'
import { EXAMPLES } from '../src/reveal/copy.ts'
import { OLD_HOST, oldHostRedirect } from '../server/old-host.ts'

let failures = 0
const check = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}

const NEW = 'https://ichirei.beyondculture.ai'
const NO_ENV = {} as NodeJS.ProcessEnv

// ---- 1. one base URL ------------------------------------------------------------------------------------------------------------------------------------------
{
  check('(1) DEFAULT_PUBLIC_URL is https://ichirei.beyondculture.ai and publicUrl() falls back to it', DEFAULT_PUBLIC_URL === NEW && publicUrl(NO_ENV) === NEW)
  const cb = readFileSync('cloudbuild.yaml', 'utf8')
  check("(1) cloudbuild: _PUBLIC_URL: 'https://ichirei.beyondculture.ai', passed as ICHIREI_PUBLIC_URL on every deploy", cb.includes("_PUBLIC_URL: 'https://ichirei.beyondculture.ai'") && cb.includes('ICHIREI_PUBLIC_URL=${_PUBLIC_URL}'))
  check("(1) cloudbuild: _REDIRECT_OLD_HOST: '' (empty = off), passed as ICHIREI_REDIRECT_OLD_HOST", /_REDIRECT_OLD_HOST: ''/.test(cb) && cb.includes('ICHIREI_REDIRECT_OLD_HOST=${_REDIRECT_OLD_HOST}'))
  const env = { ICHIREI_PUBLIC_URL: NEW } as NodeJS.ProcessEnv
  check('(1) a built gift link is https://ichirei.beyondculture.ai/g/<token>', giftUrl('RG-abcdefghijkmnpqrstu', env) === `${NEW}/g/RG-abcdefghijkmnpqrstu` && giftUrl('RG-abcdefghijkmnpqrstu', NO_ENV) === `${NEW}/g/RG-abcdefghijkmnpqrstu`)
  check('(1) a built buyer link is https://ichirei.beyondculture.ai/a/<id>', animationUrl('AN-abcdefghijkmnpqrstuv', env) === `${NEW}/a/AN-abcdefghijkmnpqrstuv` && animationUrl('AN-abcdefghijkmnpqrstuv', NO_ENV) === `${NEW}/a/AN-abcdefghijkmnpqrstuv`)
  const en = landingShare('en', NO_ENV)
  const zh = landingShare('zh-Hant', NO_ENV)
  check('(1) the share cards: /en and /zh name the new host (url and image), built from publicUrl()', en.url === `${NEW}/en` && en.image.startsWith(NEW) && zh.url === `${NEW}/zh` && zh.image.startsWith(NEW))
  const other = landingShare('en', { ICHIREI_PUBLIC_URL: 'https://example.test/' } as NodeJS.ProcessEnv)
  check('(1) …and follow ICHIREI_PUBLIC_URL (no hard-coded host left in them)', other.url === 'https://example.test/en' && landingShare('zh-Hant', { ICHIREI_PUBLIC_URL: 'https://example.test' } as NodeJS.ProcessEnv).url === 'https://example.test/zh')
  const gift = { token: 'RG-abcdefghijkmnpqrstu', language: 'en', to: 'Mom', from: 'Sam', memorial: false, opens_on: null } as unknown as Parameters<typeof ogMeta>[0]
  const og = ogMeta(gift, NO_ENV)
  check("(1) a gift's link preview (url and picture) is on the new host", og.url === `${NEW}/g/RG-abcdefghijkmnpqrstu` && og.image.startsWith(`${NEW}/`))
  const ev = { lang: 'en' as const, to: 'Mom', start: '2026-12-25T12:00:00.000Z', giftUrl: `${NEW}/g/RG-abcdefghijkmnpqrstu`, senderUrl: `${NEW}/a/AN-abcdefghijkmnpqrstuv` }
  const ics = icsText(ev, 'AN-abcdefghijkmnpqrstuv') ?? ''
  check('(1) the calendar event: UID host ichirei.beyondculture.ai, both links on the new host, nothing names soul-id.jp', ics.includes('UID:AN-abcdefghijkmnpqrstuv@ichirei.beyondculture.ai') && ics.includes(`${NEW}/a/AN-`) && !ics.includes('soul-id') && !(googleCalendarUrl(ev) ?? '').includes('soul-id'))
  const sched = readFileSync('src/animation/Schedule.tsx', 'utf8')
  check("(1) the calendar's sender link comes from the server (sender_url = publicUrl()/a/<id>), never from the host the page is open on", !sched.includes('window.location.origin') && readFileSync('api/animation.ts', 'utf8').includes('sender_url: animationUrl(rec.id, d.env)'))
}

// ---- 2. the e-mail blocks ------------------------------------------------------------------------------------------------------------------------------------
{
  const engine = new Liquid({ strictVariables: false })
  const block = readFileSync('docs/ichirei-order-email.liquid', 'utf8')
  const snippet = readFileSync('docs/shopify-email-claim-snippet.liquid', 'utf8')
  const waiting = engine.parseAndRenderSync(block, { subtotal_line_items: [{ sku: 'ICHIREI-EGIFT', properties: {} }], order: { name: '#1016', locale: 'en' } })
  check('(2) the order e-mail block (waiting order): the claim link is https://ichirei.beyondculture.ai/claim?o=%231016', waiting.includes(`${NEW}/claim?o=%231016`) && !waiting.includes('soul-id'))
  const normal = engine.parseAndRenderSync(block, { subtotal_line_items: [{ sku: 'ICHIREI-EGIFT', properties: { _kanji: '憶', _inscription_form: '憶', _language: 'en', _order_ref: 'IC-20261105-ABCDEFGH', _ichirei_animation_url: animationUrl('AN-abcdefghijkmnpqrstuv', NO_ENV) } }], order: { name: '#1017', locale: 'en' } })
  check('(2) the order e-mail block (normal order): the buyer-page button carries the link we built (new host)', normal.includes(`${NEW}/a/AN-abcdefghijkmnpqrstuv`) && !normal.includes('soul-id'))
  check('(2) neither Liquid file names soul-id.jp any more', !block.includes('soul-id.jp') && !snippet.includes('soul-id.jp') && snippet.includes(`${NEW}/claim?o=`))
}

// ---- 3. the old host: off by default; on = 301 for pages only ----------------------------------------------------------------------------------------------------
{
  const req = (path: string, host: string, method = 'GET') => new Request(`http://127.0.0.1:8080${path}`, { method, headers: { host } })
  const ON = { ICHIREI_REDIRECT_OLD_HOST: '1', ICHIREI_PUBLIC_URL: NEW } as NodeJS.ProcessEnv
  check('(3) the old host is ichirei.soul-id.jp', OLD_HOST === 'ichirei.soul-id.jp')
  check('(3) off (unset, empty, "0", "true"): nothing is ever redirected', [{}, { ICHIREI_REDIRECT_OLD_HOST: '' }, { ICHIREI_REDIRECT_OLD_HOST: '0' }, { ICHIREI_REDIRECT_OLD_HOST: 'true' }].every((e) => oldHostRedirect(req('/en/g/x?x=1', OLD_HOST), e as NodeJS.ProcessEnv) === null))
  check(`(3) on: GET /en/g/<id>?x=1 on the old host → ${NEW}/en/g/<id>?x=1`, oldHostRedirect(req('/en/g/RG-abcdefghijkmnpqrstu?x=1', OLD_HOST), ON) === `${NEW}/en/g/RG-abcdefghijkmnpqrstu?x=1`)
  check('(3) on: /a/…, /en/…, /claim, /track, / and HEAD all go to the same path and query', [['/a/AN-abcdefghijkmnpqrstuv', 'GET'], ['/en/write', 'GET'], ['/claim?o=%231016', 'GET'], ['/track?order=%231016', 'GET'], ['/', 'GET'], ['/en', 'HEAD']].every(([p, m]) => oldHostRedirect(req(p, OLD_HOST, m), ON) === `${NEW}${p}`))
  check('(3) on: the Host header in any case, with a port or a trailing dot, still counts as the old host', oldHostRedirect(req('/en', 'Ichirei.Soul-ID.jp:443'), ON) === `${NEW}/en` && oldHostRedirect(req('/en', 'ichirei.soul-id.jp.'), ON) === `${NEW}/en`)
  check('(3) on: POST /api/shopify/orders-paid is never redirected (Shopify webhooks do not follow redirects)', oldHostRedirect(req('/api/shopify/orders-paid', OLD_HOST, 'POST'), ON) === null)
  check('(3) on: no other POST /api/* is redirected either, nor an API GET', ['/api/order', '/api/promo/hold', '/api/select', '/api/basket', '/api/gift/RG-abcdefghijkmnpqrstu/reply'].every((p) => oldHostRedirect(req(p, OLD_HOST, 'POST'), ON) === null) && oldHostRedirect(req('/api/sizes', OLD_HOST), ON) === null)
  check('(3) on: /ops and everything under it is never redirected (GET or POST)', ['/ops', '/ops/home', '/ops/stats', '/ops/customers?q=x'].every((p) => oldHostRedirect(req(p, OLD_HOST), ON) === null) && oldHostRedirect(req('/ops/mark', OLD_HOST, 'POST'), ON) === null)
  check('(3) on: a POST, PUT or DELETE to a page path is not redirected (only GET and HEAD)', ['POST', 'PUT', 'DELETE'].every((m) => oldHostRedirect(req('/en', OLD_HOST, m), ON) === null))
  check('(3) on: requests on the new host (or any other host) are never redirected', ['ichirei.beyondculture.ai', 'ichirei-abc-an.a.run.app', 'localhost:5173'].every((h) => oldHostRedirect(req('/en/g/x?x=1', h), ON) === null))
  check('(3) on, but ICHIREI_PUBLIC_URL still names the old host: nothing is redirected (no loop)', oldHostRedirect(req('/en', OLD_HOST), { ICHIREI_REDIRECT_OLD_HOST: '1', ICHIREI_PUBLIC_URL: 'https://ichirei.soul-id.jp' } as NodeJS.ProcessEnv) === null)
}

// ---- 4. nothing a customer reads names soul-id.jp --------------------------------------------------------------------------------------------------------------------
{
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx|css|html|json|md|txt|liquid|svg|xml)$/.test(name)) out.push(p)
    }
    return out
  }
  const files = ['index.html', ...walk('src'), ...walk('engine'), ...walk('api'), ...walk('docs'), 'public/robots.txt']
  const hits = files.filter((f) => readFileSync(f, 'utf8').includes('soul-id.jp'))
  check('(4) no customer-facing string still contains soul-id.jp: index.html, src/, engine/, api/, docs/ (Liquid), public/robots.txt (tests and DEPLOY.md history excepted)', hits.length === 0, hits.join(', '))
  const index = readFileSync('index.html', 'utf8')
  check('(4) index.html: og:url, og:image and twitter:image on the new host', index.includes(`<meta property="og:url" content="${NEW}/" />`) && index.includes(`<meta property="og:image" content="${NEW}/img/scenes/parents.jpg" />`) && index.includes(`<meta name="twitter:image" content="${NEW}/img/scenes/parents.jpg" />`))
  const site = [LEGAL.ja, LEGAL['zh-Hant'], LEGAL.en].map((l) => JSON.stringify(l))
  check('(4) /legal: 販売URL / 販售網址 / Site read https://ichirei.beyondculture.ai', site.every((t) => t.includes(`"value":"${NEW}"`)) && site.every((t) => !t.includes('soul-id')))
  const deploy = readFileSync('DEPLOY.md', 'utf8')
  check('(4) DEPLOY.md names the new address and has a "Domains" note (both hosts mapped)', deploy.includes('## Domains (2026-11-16)') && /Both hosts are mapped/.test(deploy) && deploy.includes('ichirei.beyondculture.ai'))
}

// ---- 5. /en sample cards: the English word only ----------------------------------------------------------------------------------------------------------------------
{
  const hero = readFileSync('src/reveal/Hero.tsx', 'utf8')
  check('(5) the /en hero sample card shows the English word only ("the question"), never the romanized reading ("toi")', EXAMPLES.en.some((e) => e.m === 'the question') && /lang === 'en' \?[\s\S]{0,120}\{e\.m\}/.test(hero))
}

console.log(failures === 0 ? '\nALL DOMAIN CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
