// POST /api/analytics — the browser reports two events of the learning loop (engine/analytics.ts):
//   chosen          { session, source, event: "chosen", choice: "main" | "second" | "free" }
//   explain_opened  { session, source, event: "explain_opened", choice? }
//   the story step: { session, source, event: story_opened | question_shown | question_switched | voice_used | draft_restored |
//                     story_submitted | followup_shown | reveal_shown, language?, set?, qid? }  (codes only)
// Whitelisted field by field; always 204 (a failure must never be visible to the buyer). Rate-limited by IP.

import { CLIENT_EVENTS, parseClientEvent, recordEvent } from '../engine/analytics.ts'
import { SlidingWindowLimiter, clientIp } from '../engine/rate-limit.ts'

const MAX_BODY_BYTES = 1_000
const limiter = new SlidingWindowLimiter(60, 60_000)
const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function POST(req: Request): Promise<Response> {
  if (!limiter.hit(clientIp(req))) return noContent()
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return noContent()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return noContent()
  }
  const event = parseClientEvent(body, new Date())
  if (event) await recordEvent(event)
  return noContent()
}

export const EVENTS = CLIENT_EVENTS
export const GET = () => new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { Allow: 'POST', 'content-type': 'application/json' } })
