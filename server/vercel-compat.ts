// Runs the repo's existing Vercel-style handlers (api/explain.ts, api/log.ts)
// unchanged on a plain Hono server.
//
// Those files export `(req: VercelRequest, res: VercelResponse)`, using only a
// tiny slice of the Vercel API: `req.method`, `req.body`, `res.setHeader()`,
// `res.status()`, `res.json()`, `res.end()`. This shim provides exactly that
// slice and turns the result into a web-standard Response — so the validation
// and error text live in ONE place (api/*.ts) and both hosts share it.
//
// (api/select.ts needs no shim: it is already a web-standard
// `POST(Request): Response` handler and is mounted directly.)

import type { Context } from 'hono'
import type { VercelRequest, VercelResponse } from '@vercel/node'

type VercelStyleHandler = (req: VercelRequest, res: VercelResponse) => unknown

async function parseBody(raw: Request): Promise<unknown> {
  const text = await raw.text()
  if (!text) return undefined
  if ((raw.headers.get('content-type') ?? '').includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      // Mirror Vercel: unparseable JSON arrives as the raw string, and the
      // handler's own `typeof body === 'string'` branch turns it into a 400.
      return text
    }
  }
  return text
}

export function adaptVercelHandler(handler: VercelStyleHandler) {
  return async (c: Context): Promise<Response> => {
    const raw = c.req.raw
    const req = { method: raw.method, body: await parseBody(raw), headers: {} }

    return new Promise<Response>((resolve) => {
      const headers = new Headers()
      let status = 200
      let responded = false

      const respond = (body: string | null) => {
        if (responded) return
        responded = true
        resolve(new Response(body, { status, headers }))
      }

      const res = {
        setHeader(name: string, value: string) {
          headers.set(name, value)
          return res
        },
        status(code: number) {
          status = code
          return res
        },
        json(payload: unknown) {
          headers.set('content-type', 'application/json; charset=utf-8')
          respond(JSON.stringify(payload))
          return res
        },
        end() {
          respond(null)
          return res
        },
      }

      Promise.resolve(handler(req as unknown as VercelRequest, res as unknown as VercelResponse))
        .then(() => {
          // A handler that returns without answering would hang the request.
          if (!responded) {
            status = 500
            res.json({ error: 'Handler finished without sending a response' })
          }
        })
        .catch((err) => {
          console.error('[vercel-compat] handler threw:', err)
          if (!responded) {
            status = 500
            res.json({ error: 'Internal server error' })
          }
        })
    })
  }
}
