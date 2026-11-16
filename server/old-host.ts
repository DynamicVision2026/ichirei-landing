// The move to ichirei.beyondculture.ai (2026-11-16). The old address keeps answering exactly as before until the owner's test order on the new one has passed; then
// ICHIREI_REDIRECT_OLD_HOST=1 (cloudbuild substitution _REDIRECT_OLD_HOST) turns on a 301 from the old host to the same path and query on publicUrl().
//
// Never redirected, even when it is on:
//   - every /api/* request: Shopify's webhook (POST /api/shopify/orders-paid) does not follow redirects, no POST may be turned into a GET, and a page still open on the
//     old host keeps calling its own API (a cross-host redirect of a fetch would fail);
//   - /ops and everything under it (the owner's dashboard and its POST actions);
//   - any method other than GET and HEAD.
// Requests on any other host (the new one included) are never touched.

import { publicUrl } from '../engine/animation.ts'

export const OLD_HOST = 'ichirei.soul-id.jp'

const hostOf = (raw: string | null | undefined): string => (raw ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')

/** Where an old-host request should go instead, or null when it is answered here as before. */
export function oldHostRedirect(req: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ICHIREI_REDIRECT_OLD_HOST?.trim() !== '1') return null
  if (req.method !== 'GET' && req.method !== 'HEAD') return null
  const url = new URL(req.url)
  const host = hostOf(req.headers.get('host')) || hostOf(url.host)
  if (host !== OLD_HOST) return null
  const path = url.pathname
  if (path === '/api' || path.startsWith('/api/') || path === '/ops' || path.startsWith('/ops/')) return null
  const target = publicUrl(env)
  if (hostOf(new URL(target).host) === OLD_HOST) return null // the public address still names the old host: nothing to send anyone to
  return `${target}${path}${url.search}`
}
