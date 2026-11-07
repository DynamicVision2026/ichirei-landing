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
//   {"type":"error","error":"<message>","code"?:"model_timeout","seconds"?:<n>}  ...terminal

import { runEngine } from '../engine/engine.ts'
import { ModelTimeoutError, callTimeoutMs } from '../engine/limits.ts'
import { cleanSession, cleanSource, recordEvent, shownEvent } from '../engine/analytics.ts'
import { recordFreeSource } from '../engine/free-source.ts'
import { createOrderStore } from '../engine/order-store.ts'
import { parsePromptQuestion } from '../engine/story-questions.ts'
import { FOLLOW_UP_MAX, STORY_MAX, parseExclude, countChars, mergeStory, parseContext, parseFollowUps, type Condition } from '../engine/contract.ts'

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

  const { story, follow_ups, session, source, condition, language, relationship, direction, occasion, occasion_detail, inscription_script, prompt_question, reader, exclude, retry, purpose, purpose_other, state, state_other, relationship_other } = (body ?? {}) as {
    purpose?: unknown
    purpose_other?: unknown
    state?: unknown
    state_other?: unknown
    relationship_other?: unknown
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
  const parsed = parseContext({ language, relationship, direction, occasion, occasion_detail, inscription_script, reader, purpose, purpose_other, state, state_other, relationship_other })
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error })
  // The story-opener question: `prompt_question` is { id, text }. Only a KNOWN id counts and the wording is the server's own (text from the
  // request is never put in a prompt); it does not count toward the story limit and an unknown one is simply ignored.
  const promptQuestion = parsePromptQuestion(prompt_question, parsed.context.language)

  // 「別の候補を見る」: the characters already shown for this story (never chosen again) and which retry this is (at most 2).
  const ex = parseExclude(exclude, retry)
  if (!ex.ok) return jsonResponse(400, { error: ex.error, code: ex.code })

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, {
      error:
        'ANTHROPIC_API_KEY is not set on the server. Add it as a Vercel environment variable.',
    })
  }

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
      let received = 0
      let lastSent = 0
      // `?debug=1`: this request's own timings and outcome (engine onDebug: numbers and codes, no story text) ride along on the terminal line. Without it nothing changes.
      let debug: Record<string, unknown> | null = null
      try {
        const result = await runEngine(mergeStory(story, fu.followUps), cond, {
          context: parsed.context,
          promptQuestion: promptQuestion?.text ?? null,
          exclude: ex.exclude,
          round: ex.retry + 1,
          followUpsUsed: fu.followUps.length,
          onStage: (stage) => send({ type: 'stage', stage }),
          onCard: (partial) => send({ type: 'card', result: partial }),
          // The /ops count of where the third card (趣字) came from (codes only; best effort)
          onFreeSource: (info) => void recordFreeSource(createOrderStore(), info),
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
        if (sessionId) void recordEvent(shownEvent(result, sessionId, cleanSource(source), new Date()))
        send({ type: 'result', result, ...(wantsDebug && debug ? { debug } : {}) })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        send({ type: 'error', error: `Engine failed: ${message}`, ...(err instanceof ModelTimeoutError ? { code: 'model_timeout', seconds: Math.round(callTimeoutMs() / 1000) } : {}) })
      } finally {
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
