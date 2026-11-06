// The read-only Shopify payment lookup (when an order was paid, cancelled or refunded), shared by /ops and the buyer's page. It uses the same read-only Tracking app
// as /track and never writes to Shopify; no customer data is read. Without the app's configuration it answers "not configured" and callers fall back to the order's own time.

import { readPayments, type PaymentResult } from './shipping.ts'
import { AdminTokenCache, loadTrackConfig, readAdminSecret, type TrackDeps } from './track.ts'

export const adminTokens = new AdminTokenCache()

export function trackDepsOf(env: NodeJS.ProcessEnv): TrackDeps | null {
  const { config } = loadTrackConfig(env)
  return config ? { config, secret: () => readAdminSecret(env) } : null
}

export function shopifyPayments(env: NodeJS.ProcessEnv): (refs: string[]) => Promise<PaymentResult> {
  return (refs) => readPayments(refs, trackDepsOf(env), adminTokens)
}
