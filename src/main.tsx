import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DemoApp from './demo/DemoApp.tsx'
import TrackApp from './track/TrackApp.tsx'

// Minimal path-based routing (thin, per the harness's "choose thinner" rule):
// /demo renders the validation harness; /track the order-status page; everything else the landing page.
const path = window.location.pathname
const isDemo = path.startsWith('/demo')
const isTrack = path === '/track' || path.startsWith('/track/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isTrack ? <TrackApp /> : isDemo ? <DemoApp /> : <App />}</StrictMode>,
)
