// Heartbeat for the NDJSON stream.
//
// While the model reasons (adaptive thinking, thinking text not returned) there
// can be no output for a minute or more, so the response would carry no bytes.
// Some clients/networks drop a silent connection long before the server's own
// deadline — a real risk on a mobile iPad link. This wrapper passes the
// response through untouched and, after `intervalMs` of silence, injects a
// whole `{"type":"ping"}` line. The frontend ignores pings.
//
// Framing is safe because api/select.ts enqueues exactly one complete NDJSON
// line per chunk, so a ping can only land between lines. Non-NDJSON responses
// (JSON errors, static files) are returned as-is.

export function withHeartbeat(response: Response, intervalMs: number): Response {
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.body || intervalMs <= 0 || !contentType.includes('ndjson')) return response

  const reader = response.body.getReader()
  const ping = new TextEncoder().encode(JSON.stringify({ type: 'ping' }) + '\n')
  let lastWrite = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(
        () => {
          if (Date.now() - lastWrite < intervalMs) return
          try {
            controller.enqueue(ping)
            lastWrite = Date.now()
          } catch {
            stop() // stream already closed/cancelled
          }
        },
        Math.max(250, Math.floor(intervalMs / 2)),
      )
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          stop()
          controller.close()
          return
        }
        lastWrite = Date.now()
        controller.enqueue(value)
      } catch (err) {
        stop()
        controller.error(err)
      }
    },
    cancel(reason) {
      stop()
      return reader.cancel(reason)
    },
  })

  return new Response(body, { status: response.status, headers: response.headers })
}
