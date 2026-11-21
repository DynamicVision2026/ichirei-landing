// The owner's own sign-in for /ops (Part 25, 2026-11-21): a person signed in (Google, LINE or the email link) whose verified email is on the owner list opens the dashboard with no password. The list is the
// Secret Manager secret ICHIREI_OWNER_EMAILS (comma separated), read the usual way: the environment wins (tests, local runs), otherwise Secret Manager at request time, kept for a minute when found and half a
// minute when it is missing — a list that does not exist yet changes nothing: /ops stays exactly as it was (the password). Nothing here logs an address.

import { readSecret } from './track.ts'
import { normalizeEmail } from './customer.ts'
import { sessionAccount, type Account } from './accounts.ts'
import type { OrderStore } from './order-store.ts'

export const OWNER_SECRET_NAME = 'ICHIREI_OWNER_EMAILS'

type Reader = (name: string, env: NodeJS.ProcessEnv) => Promise<string>
let cache: { list: string[]; at: number; found: boolean } | null = null

export const parseOwnerList = (raw: string): string[] => [...new Set(raw.split(/[,\s;]+/).map((x) => normalizeEmail(x)).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))]

export function resetOwnerCache(): void {
  cache = null
}

/** The owner emails (lower-cased); an empty list = the owner sign-in is not set up and nothing changes. */
export async function ownerEmails(env: NodeJS.ProcessEnv = process.env, read: Reader = readSecret, now: number = Date.now()): Promise<string[]> {
  const direct = env[OWNER_SECRET_NAME]?.trim()
  if (direct) return parseOwnerList(direct)
  if (cache && now - cache.at < (cache.found ? 60_000 : 30_000)) return cache.list
  try {
    const list = parseOwnerList(await read(OWNER_SECRET_NAME, env))
    cache = { list, at: now, found: list.length > 0 }
    return list
  } catch {
    cache = { list: [], at: now, found: false }
    return []
  }
}

/** The signed-in account when it is an owner (a verified email on the list); otherwise null. */
export async function ownerAccount(store: OrderStore | null, req: Request, env: NodeJS.ProcessEnv = process.env, now: Date = new Date(), read: Reader = readSecret): Promise<Account | null> {
  if (!store) return null
  const list = await ownerEmails(env, read, now.getTime())
  if (list.length === 0) return null
  const a = await sessionAccount(store, req, env, now).catch(() => null)
  if (!a || !a.email || !a.email_verified) return null
  return list.includes(normalizeEmail(a.email)) ? a : null
}
