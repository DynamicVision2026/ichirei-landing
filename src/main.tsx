import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DemoApp from './demo/DemoApp.tsx'

// Minimal path-based routing (thin, per the harness's "choose thinner" rule):
// /demo renders the validation harness; everything else renders the landing page.
const isDemo = window.location.pathname.startsWith('/demo')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isDemo ? <DemoApp /> : <App />}</StrictMode>,
)
