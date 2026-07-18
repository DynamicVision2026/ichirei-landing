// On-demand Stage-B explanation for the chosen candidate (build spec §5,
// Condition B/C). Thin relay — no selection logic; wording lives in
// engine/explain-prompt.md.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runExplain, type ExplainCandidate } from '../engine/explain.ts'

// Full Hobby-plan ceiling (also mirrored in vercel.json).
export const maxDuration = 60

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

  const { story, candidate } = (body ?? {}) as {
    story?: unknown
    candidate?: Partial<ExplainCandidate>
  }

  if (typeof story !== 'string' || !story.trim()) {
    return res.status(400).json({ error: 'Missing "story"' })
  }
  if (
    !candidate ||
    typeof candidate.kanji !== 'string' ||
    typeof candidate.reading !== 'string' ||
    typeof candidate.one_line_gaze !== 'string' ||
    typeof candidate.story_anchor !== 'string'
  ) {
    return res.status(400).json({
      error: 'Missing "candidate" {kanji, reading, one_line_gaze, story_anchor}',
    })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' })
  }

  try {
    const explanation = await runExplain(story, candidate as ExplainCandidate)
    return res.status(200).json({ explanation })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: `Explain failed: ${message}` })
  }
}
