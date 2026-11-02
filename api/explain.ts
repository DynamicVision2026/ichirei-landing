// On-demand Stage-B explanation for the chosen candidate (build spec §5,
// Condition B/C). Thin relay — no selection logic; wording lives in
// engine/explain-prompt.{ja,zh,en}.md.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { FOLLOW_UP_MAX, STORY_MAX, countChars, mergeStory, parseContext, parseFollowUps } from '../engine/contract.ts'
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

  const { story, follow_ups, candidate, language, relationship, direction, occasion, occasion_detail, inscription_script, purpose, purpose_other, state, state_other, relationship_other } = (body ?? {}) as {
    purpose?: unknown
    purpose_other?: unknown
    state?: unknown
    state_other?: unknown
    relationship_other?: unknown
    story?: unknown
    follow_ups?: unknown
    candidate?: Partial<ExplainCandidate>
    language?: unknown
    relationship?: unknown
    direction?: unknown
    occasion?: unknown
    occasion_detail?: unknown
    inscription_script?: unknown
  }

  if (typeof story !== 'string' || !story.trim()) {
    return res.status(400).json({ error: 'Missing "story"' })
  }
  if (countChars(story) > STORY_MAX) {
    return res.status(400).json({ error: `"story" is longer than ${STORY_MAX} characters`, code: 'story_too_long', max: STORY_MAX })
  }
  const fu = parseFollowUps(follow_ups)
  if (!fu.ok) return res.status(400).json({ error: fu.error, code: fu.code, max: FOLLOW_UP_MAX })
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
  // v5 context, same codes and validation as /api/select. All optional; language defaults to ja.
  const parsed = parseContext({ language, relationship, direction, occasion, occasion_detail, inscription_script, purpose, purpose_other, state, state_other, relationship_other })
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server.' })
  }

  try {
    const explanation = await runExplain(mergeStory(story, fu.followUps), candidate as ExplainCandidate, { context: parsed.context })
    return res.status(200).json({ explanation })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: `Explain failed: ${message}` })
  }
}
