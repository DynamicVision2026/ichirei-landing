// Serverless entry point for the ICHIREI engine (build spec §4).
//
// Its only job: receive { story, follow_ups?, condition, language?, relationship?, direction?,
// occasion?, occasion_detail?, inscription_script? }, hand them to the engine, and return the engine's JSON. It holds the Anthropic API key (server-side only,
// never sent to the browser) and contains no selection logic of its own.
//
// The response is STREAMED as NDJSON so the connection carries bytes from the
// moment the model starts reasoning (Vercel won't idle-kill it, and the client
// gets live progress). Protocol, one JSON object per line:
//   {"type":"stage","stage":"reading|choosing|checking|replacing"}  ...as the engine moves on (honest progress steps)
//   {"type":"delta","chars":<cumulative model output chars>}   ...repeated
//   {"type":"card","result":<engine JSON contract, the cards so far>}  ...as each card passes its checks (main; then main+second; then all three), parallel cards only
//   {"type":"result","result":<engine JSON contract>[,"debug":{…}]}  ...terminal (`debug`: only with ?debug=1 — this request's timings, codes and numbers, no story text)
//   {"type":"error","code":"engine_busy|model_timeout|engine_error","seconds"?:<n>}  ...terminal (a code only: the page shows its own calm words; the full error is in the log)

import { maxRoundsOf } from '../engine/limits.ts'
import { claimRound } from '../engine/rounds.ts'
import { runEngine } from '../engine/engine.ts'
import { ModelTimeoutError, callTimeoutMs } from '../engine/limits.ts'
import { cleanSession, cleanSource, recordEvent, shownEvent } from '../engine/analytics.ts'
import { costCollector } from '../engine/ai-cost.ts'
import { recordFreeSource, recordMain } from '../engine/free-source.ts'
import { createOrderStore } from '../engine/order-store.ts'
import { newMoment, siteRound } from '../engine/day-limits.ts'
import { recordHealth } from '../engine/health.ts'
import { classOf, requestIdOf, visitorCode } from '../engine/engine-log.ts'
import { decideStoryLanguage } from '../engine/story-language.ts'
import { clientIp } from '../engine/rate-limit.ts'
import { visitorOf } from '../engine/visitor.ts'
import { recordCustomerEvent } from '../engine/customer.ts'
import { parsePromptQuestion } from '../engine/story-questions.ts'
import { REPLY_BUSY, claimReplyRound, claimsReply } from '../engine/reply.ts'
import { FOLLOW_UP_MAX, LIMIT_PERSON, LIMIT_SITE, NO_MORE_ROUNDS, STORY_MAX, parseExclude, countChars, mergeStory, parseContext, parseFollowUps, type Condition } from '../engine/contract.ts'

// Full Hobby-plan ceiling (also mirrored in vercel.json).
export const maxDuration = 60

const VALID_CONDITIONS: Condition[] = ['A', 'B', 'C']

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Body is not valid JSON' })
  }

  const { story, follow_ups, session, source, condition, language, relationship, direction, occasion, occasion_detail, inscription_script, prompt_question, reader, exclude, retry, purpose, purpose_other, state, state_other, relationship_other, receiver_gender, sender_gender } = (body ?? {}) as {
    purpose?: unknown
    purpose_other?: unknown
    state?: unknown
    state_other?: unknown
    relationship_other?: unknown
    receiver_gender?: unknown
    sender_gender?: unknown
    exclude?: unknown
    retry?: unknown
    prompt_question?: unknown
    reader?: unknown
    story?: unknown
    follow_ups?: unknown
    session?: unknown
    source?: unknown
    condition?: unknown
    language?: unknown
    relationship?: unknown
    direction?: unknown
    occasion?: unknown
    occasion_detail?: unknown
    inscription_script?: unknown
  }

  if (typeof story !== 'string' || !story.trim()) {
    return jsonResponse(400, { error: 'Missing "story" (non-empty string)' })
  }
  // No minimum (STEP 0 judges sufficiency by content); a hard maximum, rejected before any model call.
  if (countChars(story) > STORY_MAX) {
    return jsonResponse(400, { error: `"story" is longer than ${STORY_MAX} characters (got ${countChars(story)})`, code: 'story_too_long', max: STORY_MAX })
  }
  // Follow-up answers are separate fields with their own limit (600 each, at most two).
  const fu = parseFollowUps(follow_ups)
  if (!fu.ok) return jsonResponse(400, { error: fu.error, code: fu.code, max: FOLLOW_UP_MAX })
  const cond: Condition = VALID_CONDITIONS.includes(condition as Condition)
    ? (condition as Condition)
    : 'A'

  // v5 context. All four are optional (the current /demo UI sends none): language
  // defaults to 'ja', the rest reach the prompt as "unspecified". A value that IS
  // sent must be one of the codes in engine/contract.ts (occasion_detail is free text,
  // length-capped).
  const parsed = parseContext({ language, relationship, direction, occasion, occasion_detail, inscription_script, reader, purpose, purpose_other, state, state_other, relationship_other, receiver_gender, sender_gender })
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error })
  // The story's language is the one key (Part 6, 2026-11-20): decided ONCE here, when the round starts, from the text (typed or spoken) — Traditional or Simplified follows its own characters, a mixed
  // story follows its larger part, a story too short to tell keeps the page's language. Every engine step below (the prompt file, the lexicon, the review, the gaze, the explain step, the poem forms, the film
  // world) runs in it; the page language only fills in when the text says nothing and keeps deciding the menus, prices, currency and checkout.
  const pageLanguage = parsed.context.language
  const storyLanguage = decideStoryLanguage(mergeStory(story, fu.followUps), pageLanguage)
  const engineContext = { ...parsed.context, language: storyLanguage }
  // The story-opener question: `prompt_question` is { id, text }. Only a KNOWN id counts and the wording is the server's own (text from the
  // request is never put in a prompt); it does not count toward the story limit and an unknown one is simply ignored.
  const promptQuestion = parsePromptQuestion(prompt_question, pageLanguage)

  // 「別の候補を見る」: the characters already shown for this story (never chosen again) and which retry this is (at most 2).
  const ex = parseExclude(exclude, retry, maxRoundsOf(process.env) - 1)
  if (!ex.ok) return jsonResponse(400, { error: ex.code === 'retry_limit' ? (NO_MORE_ROUNDS[pageLanguage] ?? NO_MORE_ROUNDS.en) : ex.error, code: ex.code })

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[ichirei-select] ANTHROPIC_API_KEY is not set on the server')
    return jsonResponse(500, { code: 'engine_error' })
  }

  // A card call that CLAIMS to be a gift back (Part 14 follow-up, 2026-11-20) must hold a valid, unused reply ticket, and a ticket allows exactly ONE card round: a second round, a refill, a retry, a second
  // tab, a made-up, used or switched-off ticket — all refused here with the calm busy line, before any model call, whatever the page says. (A call that does not claim to be a reply is an ordinary moment.)
  let replyRound: Awaited<ReturnType<typeof claimReplyRound>> | null = null
  if (claimsReply(body)) {
    const store = createOrderStore()
    const rr = ex.retry === 0 && ex.exclude.length === 0 ? await claimReplyRound(store, (body as { reply_ticket?: unknown }).reply_ticket) : ({ ok: false } as const)
    if (!rr.ok) {
      console.log(`[ichirei-reply] ${JSON.stringify({ route: '/api/select', code: 'round_refused' })}`)
      return jsonResponse(429, { error: REPLY_BUSY[pageLanguage] ?? REPLY_BUSY.en, code: 'engine_busy' })
    }
    replyRound = rr
  }

  // The free tries (2026-11-15): a NEW moment (round 1) is counted per browser (the signed ic_v cookie) with the connection as the backstop; every card round counts for the whole site.
  // A missing or forged cookie is never a reason to refuse — it is just a new browser. Nothing here touches checkout or payment.
  {
    const store = createOrderStore()
    const lang = pageLanguage
    const refuse = (code: 'limit_person' | 'limit_site') => {
      console.log(`[ichirei-limit] ${JSON.stringify({ route: '/api/select', code })}`)
      void recordHealth(store, code)
      return jsonResponse(429, { error: (code === 'limit_person' ? LIMIT_PERSON : LIMIT_SITE)[lang] ?? (code === 'limit_person' ? LIMIT_PERSON : LIMIT_SITE).en, code })
    }
    if (ex.retry === 0 && !replyRound) {
      const v = newMoment(visitorOf(req), clientIp(req))
      if (!v.ok) return refuse(v.code)
      void recordCustomerEvent(store, { browser: visitorOf(req) }, 'tried', { language: lang }).catch(() => {})
    }
    if (!(await siteRound(store))) return refuse('limit_site')
  }

  // The rounds are counted by the server (gift ceremony ticket, part 0): round 1 hands out a signed ticket, a later round must present it, and round MAX + 1 is refused whatever the page says.
  const round_ticket_in = (body as { round_ticket?: unknown }).round_ticket
  const claim = await claimRound(createOrderStore(), round_ticket_in, ex.retry, maxRoundsOf(process.env))
  if (!claim.ok) return jsonResponse(400, { error: claim.code === 'retry_limit' ? (NO_MORE_ROUNDS[pageLanguage] ?? NO_MORE_ROUNDS.en) : 'The round ticket is not valid', code: claim.code })
  const serverRetry = claim.round - 1

  let wantsDebug = false
  try {
    wantsDebug = new URL(req.url, 'http://localhost').searchParams.get('debug') === '1'
  } catch {
    wantsDebug = false
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      const t0 = Date.now()
      const cost = costCollector('select', cleanSource(source))
      let received = 0
      let lastSent = 0
      // `?debug=1`: this request's own timings and outcome (engine onDebug: numbers and codes, no story text) ride along on the terminal line. Without it nothing changes.
      let debug: Record<string, unknown> | null = null
      try {
        const result = await runEngine(mergeStory(story, fu.followUps), cond, {
          context: engineContext,
          promptQuestion: promptQuestion?.text ?? null,
          exclude: ex.exclude,
          round: serverRetry + 1,
          followUpsUsed: fu.followUps.length,
          onStage: (stage) => send({ type: 'stage', stage }),
          onUsage: (stage, usage) => cost.add(stage, usage),
          onCard: (partial) => send({ type: 'card', result: { ...partial, story_language: storyLanguage, page_language: pageLanguage } }),
          // The /ops count of where the third card (趣字) came from (codes only; best effort)
          onFreeSource: (info) => void recordFreeSource(createOrderStore(), info),
          onMain: (info) => void recordMain(createOrderStore(), info),
          // English: a word the model had to supply because the lexicon row is not reviewed — logged with its kanji for the reviewer (no story text)
          onEnWord: (info) => {
            console.log(`[ichirei-en] en_word_generated ${JSON.stringify(info)}`)
            void recordEvent({ ts: new Date().toISOString(), source: cleanSource(source), event: 'en_word_generated', kanji: info.kanji, word: info.word, used: info.used, problem: info.problem }, createOrderStore())
          },
          ...(wantsDebug ? { onDebug: (d: Record<string, unknown>) => { debug = d } } : {}),
          onDelta: (text) => {
            received += text.length
            // Throttle progress lines: one per ~200 chars of model output.
            if (received - lastSent >= 200) {
              lastSent = received
              send({ type: 'delta', chars: received })
            }
          },
        })
        // Learning loop: codes and booleans only, tied to a random browser session id (engine/analytics.ts). Never awaited.
        const sessionId = cleanSession(session)
        if (sessionId) void recordEvent(shownEvent(result, sessionId, cleanSource(source), new Date(), Date.now() - t0))
        // a reply's one round is kept only when it gave cards: no cards (a follow-up question, a remembrance offer) gives it back
        if (replyRound && (result.status !== 'sufficient' || result.primary_kanji === null)) void replyRound.release()
        send({ type: 'result', result: { ...result, story_language: storyLanguage, page_language: pageLanguage }, round_ticket: claim.ticket, ...(wantsDebug && debug ? { debug } : {}) })
      } catch (err) {
        void claim.release() // the engine broke: this round is given back
        if (replyRound) void replyRound.release()
        // The full error stays in the server log, with the class and the provider's request id. The page gets only a code (2026-11-20): it shows its own calm text, never a message, a status or JSON.
        const code = visitorCode(err)
        console.error(`[ichirei-select] engine_failed ${JSON.stringify({ code, class: classOf(err), request_id: requestIdOf(err) ?? null })} ${err instanceof Error ? err.message : String(err)}`)
        send({ type: 'error', code, ...(err instanceof ModelTimeoutError ? { seconds: Math.round(callTimeoutMs() / 1000) } : {}) })
      } finally {
        void cost.flush(createOrderStore(), new Date(), cleanSession(session) ?? undefined)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Defeat proxy buffering so deltas reach the client as they're written.
      'x-accel-buffering': 'no',
    },
  })
}
