// The one outgoing mail of the customer's own page (2026-11-18): "Save to my email" sends a private link. A transactional mail service — Resend — sends it from gifts@beyondculture.ai (its DNS
// records live on a subdomain, send.beyondculture.ai, so the root SPF and the mailbox records stay as they are). The API key is a Secret Manager secret (RESEND_API_KEY), never in the repo.
// The key is read the way the Shopify client secret is (engine/track.ts readSecret): RESEND_API_KEY in the environment wins, otherwise Secret Manager (latest version) with the Cloud Run service
// account — so a secret that does not exist yet can never break a deploy, and the deploy's --set-secrets list does not change.
// Without a key there is no mailer: the "Save to my email" box is not shown, and everything else (the QR code, copy link) works as before.
// Nothing here logs an address or a message.

export interface Mail {
  to: string
  subject: string
  html: string
  text: string
}

export interface Mailer {
  /** true when the service accepted the message. */
  send(mail: Mail): Promise<boolean>
}

export const DEFAULT_MAIL_FROM = 'ICHIREI <gifts@beyondculture.ai>'

/** The Resend mailer of this environment, or null while RESEND_API_KEY is not set. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Mailer | null {
  const key = (env.RESEND_API_KEY ?? '').trim()
  if (!key) return null
  const from = (env.ICHIREI_MAIL_FROM ?? '').trim() || DEFAULT_MAIL_FROM
  return {
    async send(mail: Mail): Promise<boolean> {
      try {
        const r = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
          signal: AbortSignal.timeout(12_000),
        })
        return r.ok
      } catch {
        return false
      }
    },
  }
}

export const MAIL_SECRET_NAME = 'RESEND_API_KEY'
let found: { mailer: Mailer; key: string } | null = null
let missingUntil = 0

/**
 * The mailer for a request: the environment's key, else (on Cloud Run only) the Secret Manager secret RESEND_API_KEY. A key that was found is kept; a missing one is looked for again only every
 * ten minutes, so a page that has no mail box never waits on Secret Manager twice.
 */
export async function resolveMailer(env: NodeJS.ProcessEnv = process.env, now: number = Date.now(), fetchImpl: typeof fetch = fetch): Promise<Mailer | null> {
  const direct = mailerFromEnv(env, fetchImpl)
  if (direct) return direct
  if (!env.K_SERVICE) return null // not on Cloud Run: no Secret Manager to ask
  if (found) return found.mailer
  if (now < missingUntil) return null
  try {
    const { readSecret } = await import('./track.ts')
    const key = await readSecret(MAIL_SECRET_NAME, {} as NodeJS.ProcessEnv, fetchImpl)
    const m = key ? mailerFromEnv({ ...env, RESEND_API_KEY: key }, fetchImpl) : null
    if (m) {
      found = { mailer: m, key }
      return m
    }
  } catch {
    // no secret (yet): the box stays hidden
  }
  missingUntil = now + 10 * 60_000
  return null
}

/** For tests: forget what was found. */
export function resetMailerCache(): void {
  found = null
  missingUntil = 0
}
