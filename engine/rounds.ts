// The rounds of one moment, kept by the SERVER (2026-11-14, gift ceremony ticket part 0). A story gets ICHIREI_MAX_ROUNDS rounds of characters (2 by default). The page used to declare
// which round it was asking for and the server believed it, so anyone calling the API directly could buy extra rounds (model cost). Now round 1 hands out a signed round ticket
// (RS-… id + HMAC) and every later request must present it; the server counts the rounds of that id in the order store and refuses round MAX+1 whatever the page sends.
//
//   rounds/<RS-id>-<n>.json   one small object per round, created if-absent: two requests at once cannot both take the same round, and a round that failed (the engine broke) is given back.
//
// The HMAC key is derived from a secret the server already holds (ICHIREI_ROUND_SECRET, else the Anthropic key, which every instance that can serve /api/select has); it is never printed or sent.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { assertObjectPath, type OrderStore } from './order-store.ts'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export const newRoundSession = (random: (n: number) => Uint8Array = randomBytes): string => {
  let out = 'RS-'
  for (const b of random(20)) out += ALPHABET[b % ALPHABET.length]
  return out
}

function key(env: NodeJS.ProcessEnv): string {
  return createHmac('sha256', 'ichirei-round-ticket').update(env.ICHIREI_ROUND_SECRET || env.ANTHROPIC_API_KEY || 'dev-only').digest('hex')
}
const mac = (sid: string, env: NodeJS.ProcessEnv): string => createHmac('sha256', key(env)).update(sid).digest('base64url').slice(0, 27)

/** The ticket the page keeps and sends back with each "find more": `<RS-id>.<signature>`. */
export const issueTicket = (sid: string, env: NodeJS.ProcessEnv = process.env): string => `${sid}.${mac(sid, env)}`

/** The session id inside a ticket, or null when it is not a ticket this server signed. */
export function verifyTicket(ticket: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof ticket !== 'string' || ticket.length > 80) return null
  const [sid, sig, extra] = ticket.split('.')
  if (extra !== undefined || !sid || !sig || !/^RS-[a-z2-9]{20}$/.test(sid)) return null
  const want = Buffer.from(mac(sid, env))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got) ? sid : null
}

export type RoundClaim =
  | { ok: true; sid: string; round: number; ticket: string; release: () => Promise<void> }
  | { ok: false; code: 'retry_limit' | 'bad_round_ticket' }

/** Without a configured store (local development) the rounds are counted in this process. */
const memory = new Map<string, 'claimed' | 'failed'>()

async function take(store: OrderStore | null, sid: string, n: number): Promise<boolean> {
  const path = `rounds/${sid}-${n}.json`
  if (!store) {
    const cur = memory.get(path)
    if (cur === 'claimed') return false
    memory.set(path, 'claimed')
    return true
  }
  assertObjectPath(path)
  const made = await store.putObject(path, JSON.stringify({ state: 'claimed' }), 'application/json', { ifAbsent: true })
  if (made) return true
  // an earlier try of this round failed (the engine broke): the round is given back
  const old = await store.getObject(path).catch(() => null)
  if (old && (() => { try { return (JSON.parse(old.toString()) as { state?: string }).state === 'failed' } catch { return false } })()) {
    await store.putObject(path, JSON.stringify({ state: 'claimed' }), 'application/json')
    return true
  }
  return false
}

async function giveBack(store: OrderStore | null, sid: string, n: number): Promise<void> {
  const path = `rounds/${sid}-${n}.json`
  if (!store) {
    memory.set(path, 'failed')
    return
  }
  await store.putObject(path, JSON.stringify({ state: 'failed' }), 'application/json').catch(() => {})
}

/**
 * Take the next round of a moment. No ticket = round 1 of a new moment (a page that says it is asking for a later round without a ticket is refused: the server cannot know it).
 * A ticket = the lowest free round of that moment, whatever number the page says; none left = `retry_limit`.
 */
export async function claimRound(store: OrderStore | null, ticket: unknown, declaredRetry: number, max: number, env: NodeJS.ProcessEnv = process.env): Promise<RoundClaim> {
  let sid: string
  if (ticket === undefined || ticket === null || ticket === '') {
    if (declaredRetry > 0) return { ok: false, code: 'retry_limit' }
    sid = newRoundSession()
  } else {
    const v = verifyTicket(ticket, env)
    if (!v) return { ok: false, code: 'bad_round_ticket' }
    sid = v
  }
  for (let n = 1; n <= Math.max(1, max); n++) {
    if (await take(store, sid, n)) return { ok: true, sid, round: n, ticket: issueTicket(sid, env), release: () => giveBack(store, sid, n) }
  }
  return { ok: false, code: 'retry_limit' }
}
