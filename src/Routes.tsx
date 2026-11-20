import { Suspense, lazy } from 'react'
import RevealPage from './reveal/RevealPage.tsx'
import { setLanguage } from './lang-store.ts'
import { captureUtm } from './demo/utm-store.ts'
import { writeLangOf } from './reveal/paths.ts'

// Minimal path-based routing (thin, per the harness's "choose thinner" rule):
// /demo renders the validation harness; /track the order-status page; /a/<id> the private story animation of one order (the sender's page), /g/<token> the receiver's gift page; /credits its attributions; /legal the legal notice (特定商取引法), the return rules and three short questions; /claim the page for an order paid without our site; everything else the landing page
// (the Reveal design). The landing is the one route that must paint fast, so it is in the entry bundle;
// the harness and the status page load on demand (and the landing's own story flow loads after the first paint).
const DemoApp = lazy(() => import('./demo/DemoApp.tsx'))
const TrackApp = lazy(() => import('./track/TrackApp.tsx'))
const AnimationApp = lazy(() => import('./animation/AnimationApp.tsx'))
const GiftApp = lazy(() => import('./gift/GiftApp.tsx'))
const CreditsApp = lazy(() => import('./animation/CreditsApp.tsx'))
const LegalApp = lazy(() => import('./legal/LegalApp.tsx'))
const ClaimApp = lazy(() => import('./claim/ClaimApp.tsx'))
const BasketApp = lazy(() => import('./loop/BasketApp.tsx'))

export default function Routes() {
  const path = window.location.pathname
  captureUtm() // (the arrival's utm_* parameters, kept for the tab: they travel with an English order)
  if (path === '/track' || path.startsWith('/track/')) {
    return (
      <Suspense fallback={null}>
        <TrackApp />
      </Suspense>
    )
  }
  if (path.startsWith('/g/')) {
    return (
      <Suspense fallback={null}>
        <GiftApp />
      </Suspense>
    )
  }
  if (path.startsWith('/a/')) {
    return (
      <Suspense fallback={null}>
        <AnimationApp />
      </Suspense>
    )
  }
  if (path === '/legal' || path === '/legal/') {
    return (
      <Suspense fallback={null}>
        <LegalApp />
      </Suspense>
    )
  }
  // /claim (2026-11-13): an order that was paid without going through our site — order number + e-mail, then the normal flow with no payment at the end
  if (path === '/claim' || path === '/claim/') {
    return (
      <Suspense fallback={null}>
        <ClaimApp />
      </Suspense>
    )
  }
  // the basket (2026-11-15): /basket is this browser's saved gifts, /b/<token> the private link that opens them on any device (a token that is not a basket's shows the normal landing page)
  // /en/basket and /zh/basket (2026-11-20): the same page in the address's language (the Save panel's gold button goes there)
  if (/^\/(en|zh)\/basket\/?$/.test(path)) setLanguage(path.startsWith('/en') ? 'en' : 'zh-Hant')
  if (path === '/basket' || path === '/basket/' || /^\/(en|zh)\/basket\/?$/.test(path) || path.startsWith('/b/')) {
    return (
      <Suspense fallback={null}>
        <BasketApp />
      </Suspense>
    )
  }
  if (path === '/credits' || path === '/credits/') {
    return (
      <Suspense fallback={null}>
        <CreditsApp />
      </Suspense>
    )
  }
  if (path.startsWith('/demo')) {
    return (
      <Suspense fallback={null}>
        <DemoApp />
      </Suspense>
    )
  }
  // /en (2026-11-12): the English page for the US launch — the same page with the language set to English (a link from search or an ad keeps its ?utm_… parameters)
  if (path === '/en' || path === '/en/') setLanguage('en')
  // /zh (2026-11-15): the Traditional Chinese page (its link preview is Chinese too: the server answers /zh with its own tags)
  if (path === '/zh' || path === '/zh/') setLanguage('zh-Hant')
  // the writing room (2026-11-16): /en/write, /write (Japanese), /zh/write — the flow on a page of its own, same tab
  const room = writeLangOf(path)
  if (room) {
    // the room's language is its address's (/write is Japanese) — unless the address names one (?lang=…, as the landing's own links can)
    if (!new URLSearchParams(window.location.search).get('lang')) setLanguage(room)
    return <RevealPage write />
  }
  return <RevealPage />
}
