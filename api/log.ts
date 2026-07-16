// Append-only event sink (build spec §6).
//
// The client is the source of truth (it accumulates and exports the JSON);
// this endpoint just echoes each event into the Vercel function logs so runs
// are observable server-side too. No database — deliberately (non-goal §1).

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = { raw: body }
    }
  }
  console.log('[ichirei-event]', JSON.stringify(body))
  return res.status(204).end()
}
