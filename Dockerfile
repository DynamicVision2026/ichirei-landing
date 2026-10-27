# syntax=docker/dockerfile:1
#
# ICHIREI on Cloud Run: one container serves the built Vite frontend AND the
# /api/* routes (the existing engine, unchanged). Listens on $PORT (Cloud Run
# injects it; 8080 by default). ANTHROPIC_API_KEY is NOT baked in — Cloud Run
# mounts it at runtime from Secret Manager (see cloudbuild.yaml / DEPLOY.md).

# ---- build: install everything and build the frontend -------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Cloud Run serves from the domain root. Without this, vite.config.ts would
# default a plain production build to the GitHub Pages subpath
# (/ichirei-landing/) and every asset would 404 — a blank page.
ENV ICHIREI_BASE=/
RUN npm run build

# ---- runtime: production deps + engine + server + built frontend ---------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# (the story animation reads only the minified stroke SVGs of KanjiVG, dist/main/*.svg: drop its variations and duplicate JSON, about 65 MB)
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf node_modules/@madcat/kanjivg/dist/variations \
 && find node_modules/@madcat/kanjivg/dist/main -name '*.json' -delete

# Reasoning stays in engine/prompt.*.md and explain-prompt.*.md — plain text
# files, read at request time. Editing them = a normal commit; Cloud Build
# rebuilds and redeploys. No code changes.
COPY engine ./engine
# Small plain-TS modules shared with the browser (packages, certificate text, glyph choice).
COPY src/order ./src/order
COPY api ./api
COPY server ./server
COPY --from=build /app/dist ./dist

USER node
ENV PORT=8080
EXPOSE 8080

# TypeScript runs via Node's built-in type stripping (no build step), so the
# engine files execute exactly as written.
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/index.ts"]
