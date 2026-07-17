import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: GitHub Pages serves the site under /ichirei-landing/, Vercel at the
// root. Vercel sets VERCEL=1 during builds, so key off that (dev always root).
export default defineConfig(({ command }) => ({
  base: command === 'build' && !process.env.VERCEL ? '/ichirei-landing/' : '/',
  plugins: [react()],
}))
