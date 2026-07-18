// Serverless entry point for the ICHIREI engine (build spec §4).
//
// Its only job: receive { story, condition }, hand the story to the engine, and
// return the engine's JSON. It holds the Anthropic API key (server-side only,
// never sent to the browser) and contains no selection logic of its own.
//
// The response is STREAMED as NDJSON so the connection carries bytes from the
// moment the model starts reasoning (Vercel won't idle-kill it, and the client
// gets live progress). Protocol, one JSON object per line:
//   {"type":"delta","chars":<cumulative model output chars>}   ...repeated
//   {"type":"result","result":<engine JSON contract>}          ...terminal
//   {"type":"error","error":"<message>"}                       ...terminal

import { runEngine } from '../engine/engine.ts'
import type { Condition } from '../engine/contract.ts'

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

  const { story, condition } = (body ?? {}) as { story?: unknown; condition?: unknown }

  if (typeof story !== 'string' || !story.trim()) {
    return jsonResponse(400, { error: 'Missing "story" (non-empty string)' })
  }
  const cond: Condition = VALID_CONDITIONS.includes(condition as Condition)
    ? (condition as Condition)
    : 'A'

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, {
      error:
        'ANTHROPIC_API_KEY is not set on the server. Add it as a Vercel environment variable.',
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      let received = 0
      let lastSent = 0
      try {
        const result = await runEngine(story, cond, {
          onDelta: (text) => {
            received += text.length
            // Throttle progress lines: one per ~200 chars of model output.
            if (received - lastSent >= 200) {
              lastSent = received
              send({ type: 'delta', chars: received })
            }
          },
        })
        send({ type: 'result', result })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        send({ type: 'error', error: `Engine failed: ${message}` })
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
