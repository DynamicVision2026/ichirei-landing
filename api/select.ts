// Serverless entry point for the ICHIREI engine (build spec §4).
//
// Its only job: receive { story, condition }, hand the story to the engine, and
// return the engine's JSON. It holds the Anthropic API key (server-side only,
// never sent to the browser) and contains no selection logic of its own.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runEngine } from '../engine/engine.ts'
import type { Condition } from '../engine/contract.ts'

// maxDuration + includeFiles (bundling engine/prompt.md) are set in vercel.json.

const VALID_CONDITIONS: Condition[] = ['A', 'B', 'C']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return res.status(400).json({ error: 'Body is not valid JSON' })
    }
  }

  const { story, condition } = (body ?? {}) as {
    story?: unknown
    condition?: unknown
  }

  if (typeof story !== 'string' || !story.trim()) {
    return res.status(400).json({ error: 'Missing "story" (non-empty string)' })
  }
  const cond: Condition = VALID_CONDITIONS.includes(condition as Condition)
    ? (condition as Condition)
    : 'A'

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error:
        'ANTHROPIC_API_KEY is not set on the server. Add it as a Vercel environment variable.',
    })
  }

  try {
    const result = await runEngine(story, cond)
    return res.status(200).json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 502: the engine ran but the model output couldn't be turned into the contract.
    return res.status(502).json({ error: `Engine failed: ${message}` })
  }
}
