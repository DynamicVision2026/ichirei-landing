// The free card preview before payment (engine/preview.ts):
//
//   POST /api/preview                { story, follow_ups?, language, …context, shown: [characters], draft_id? }
//                                    → { state: "ok", id, reused, script: "ready" | "fallback" } | { state: "limited" }
//                                    Called the moment the sender picks a character: the film script is written (one small call) and the draft is saved.
//                                    The same story gives back the same draft (nothing is drawn twice). A NEW set counts against the person's daily limit.
//   POST /api/preview/<id>/render    draws the four pictures; stays open until they are done (≤ the render window) so Cloud Run keeps the CPU.
//   GET  /api/preview/<id>           the four lines and the pictures that are there so far (the page asks every few seconds).
//   (the pictures themselves are served by GET /api/film/<id>/picture/<n>.webp, the same private route as the order's film)
//
// A draft id is a private, unguessable link (100 bits), held by the browser that made it. No download exists before payment: there is no scroll and no PDF
// for a draft (those routes only know orders). Web-standard handlers; mounted by server/app.ts.

import { cleanSession } from '../engine/analytics.ts'
import { FOLLOW_UP_MAX, STORY_MAX, countChars, mergeStory, parseContext, parseExclude, parseFollowUps } from '../engine/contract.ts'
import { ANIMATION_ID_PATTERN } from '../engine/animation.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { SlidingWindowLimiter, clientIp } from '../engine/rate-limit.ts'
import { previewView, renderPreview, startPreview, type PreviewDeps } from '../engine/preview.ts'

const MAX_BODY_BYTES = 60_000
const DAY_MS = 86_400_000
const hdr = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: hdr({ 'content-type': 'application/json; charset=utf-8', ...extra }) })

/** At most this many NEW picture sets per person per day (ICHIREI_PREVIEW_DAILY_MAX, default 5): the same identity as the story limit (the connection's address). */
export const previewDailyMax = (env: NodeJS.ProcessEnv = process.env): number => (Number(env.ICHIREI_PREVIEW_DAILY_MAX) >= 0 && env.ICHIREI_PREVIEW_DAILY_MAX !== undefined && env.ICHIREI_PREVIEW_DAILY_MAX !== '' ? Number(env.ICHIREI_PREVIEW_DAILY_MAX) : 5)

export interface PreviewApiDeps extends Omit<PreviewDeps, 'store'> {
  store: OrderStore | null
  /** Tests: their own daily limiter. */
  daily?: SlidingWindowLimiter
}

let sharedDaily: SlidingWindowLimiter | null = null
let sharedMax = -1
const dailyFor = (env: NodeJS.ProcessEnv): SlidingWindowLimiter => {
  const max = previewDailyMax(env)
  if (!sharedDaily || sharedMax !== max) {
    sharedDaily = new SlidingWindowLimiter(max, DAY_MS)
    sharedMax = max
  }
  return sharedDaily
}

export function createPreviewHandlers(deps: () => PreviewApiDeps) {
  const need = (d: PreviewApiDeps): d is PreviewApiDeps & { store: OrderStore } => d.store !== null
  return {
    async start(req: Request): Promise<Response> {
      const d = deps()
      if (!need(d)) return json(503, { error: 'unavailable', code: 'store_not_configured' })
      const text = await req.text()
      if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request body too large' })
      let body: Record<string, unknown>
      try {
        body = JSON.parse(text) as Record<string, unknown>
      } catch {
        return json(400, { error: 'Body is not valid JSON' })
      }
      const story = body.story
      if (typeof story !== 'string' || !story.trim()) return json(400, { error: 'Missing "story"' })
      if (countChars(story) > STORY_MAX) return json(400, { error: 'story_too_long', code: 'story_too_long', max: STORY_MAX })
      const fu = parseFollowUps(body.follow_ups)
      if (!fu.ok) return json(400, { error: fu.error, code: fu.code, max: FOLLOW_UP_MAX })
      const ctx = parseContext(body)
      if (!ctx.ok) return json(400, { error: ctx.error })
      const shown = parseExclude(body.shown, 1)
      if (!shown.ok) return json(400, { error: shown.error, code: shown.code })
      const draftId = typeof body.draft_id === 'string' && ANIMATION_ID_PATTERN.test(body.draft_id) ? body.draft_id : null
      const env = d.env ?? process.env
      const daily = d.daily ?? dailyFor(env)
      const ip = clientIp(req)
      const out = await startPreview(
        { ...d, store: d.store },
        {
          story: mergeStory(story.trim(), fu.followUps),
          language: ctx.context.language,
          relationship: ctx.context.relationship,
          direction: ctx.context.direction,
          occasion: ctx.context.occasion,
          occasion_detail: ctx.context.occasion_detail || null,
          memorial: ctx.context.occasion === 'memorial',
          shown: shown.exclude,
          draft_id: draftId,
        },
        () => daily.hit(ip),
      )
      void cleanSession(body.session)
      return json(200, out)
    },

    async view(id: string): Promise<Response> {
      const d = deps()
      if (!need(d)) return json(503, { error: 'unavailable' })
      const v = await previewView({ ...d, store: d.store }, id)
      return v ? json(200, v) : json(404, { error: 'not_found' })
    },

    async render(id: string): Promise<Response> {
      const d = deps()
      if (!need(d)) return json(503, { error: 'unavailable' })
      const v = await renderPreview({ ...d, store: d.store }, id)
      return v ? json(200, v) : json(404, { error: 'not_found' })
    },
  }
}

export const handlers = createPreviewHandlers(() => ({ store: createOrderStore() }))
