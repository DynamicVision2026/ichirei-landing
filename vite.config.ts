import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: GitHub Pages serves the site under /ichirei-landing/; Vercel and Cloud
// Run serve from the root. Vercel sets VERCEL=1 during builds, so key off that
// (dev always root). Anything else that serves from the root (the Cloud Run
// Docker build) sets ICHIREI_BASE=/ explicitly, which wins over the heuristic.
// ICHIREI_MOCK_API=1 proxies /api to scripts/mock-api.mjs for keyless local runs.
export default defineConfig(({ command }) => ({
  base:
    process.env.ICHIREI_BASE ??
    (command === 'build' && !process.env.VERCEL ? '/ichirei-landing/' : '/'),
  plugins: [react()],
  server: process.env.ICHIREI_MOCK_API
    ? { proxy: { '/api': `http://localhost:${process.env.MOCK_PORT ?? 8787}` } }
    : undefined,
}))
