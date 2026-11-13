import { useMemo } from 'react'
import { getClaim } from '../demo/claim-store.ts'
import type { UiLanguage } from '../demo/i18n.ts'
import { CLAIM_COPY } from './copy.ts'

/** A thin line over the flow while a claim is open (an order paid without our site): "Order #1016: paid. Write your story and choose the character." Nothing when there is no claim. */
export default function ClaimBanner({ language }: { language: UiLanguage }) {
  const claim = useMemo(() => getClaim(), [])
  if (!claim) return null
  return (
    <p className="claimBanner" role="status" data-testid="claim-banner">
      {CLAIM_COPY[language].banner.replace('{order}', claim.order)}
    </p>
  )
}
