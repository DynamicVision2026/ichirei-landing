import { Suspense, lazy } from 'react'
import RevealPage from './reveal/RevealPage.tsx'

// Minimal path-based routing (thin, per the harness's "choose thinner" rule):
// /demo renders the validation harness; /track the order-status page; /a/<id> the private story animation of one order; /credits its attributions; everything else the landing page
// (the Reveal design). The landing is the one route that must paint fast, so it is in the entry bundle;
// the harness and the status page load on demand (and the landing's own story flow loads after the first paint).
const DemoApp = lazy(() => import('./demo/DemoApp.tsx'))
const TrackApp = lazy(() => import('./track/TrackApp.tsx'))
const AnimationApp = lazy(() => import('./animation/AnimationApp.tsx'))
const CreditsApp = lazy(() => import('./animation/CreditsApp.tsx'))

export default function Routes() {
  const path = window.location.pathname
  if (path === '/track' || path.startsWith('/track/')) {
    return (
      <Suspense fallback={null}>
        <TrackApp />
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
  return <RevealPage />
}
