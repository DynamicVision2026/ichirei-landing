// The post-deploy self-test (v9.8): the internal 16-story purpose set run through the real pipeline (engine/selftest.ts), recorded, and served as codes.
//
//   POST /api/selftest/run     header  x-selftest-token: <ICHIREI_SELFTEST_TOKEN>   (a Secret Manager secret, mounted by the deploy; never printed)
//                              → 200 {state:"done", report}      the run is finished (up to ~270 s); the report is the public form (codes and characters only)
//                              → 200 {state:"skipped", reason:"already_tested", commit}   this commit was tested already
//                              → 401 wrong or missing token · 503 no token configured · 429 {state:"capped"} at most 6 runs a day · 409 {state:"running"}
//   GET  /api/selftest/latest  the latest report, public, read-only, cached 60 s (cache-control: public, max-age=60). Top level: commit, time, spend estimate; per story: id, purpose, state,
//                              each card's slot and character, pass/fail per check, the film script's rule codes, total ms. NO story text, card line or poem anywhere.
//
// Results live in the order bucket (selftest/latest.json, selftest/day-<date>.json, selftest/commit-<sha>.json, selftest/lock.json); without a bucket they are kept in memory for the life of the instance.

import { createHash, timingSafeEqual } from 'node:crypto'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { publicReport, runSelftest, type SelftestDeps, type SelftestReport } from '../engine/selftest.ts'

export const SELFTEST_DAILY_MAX = 6
const LOCK_STALE_MS = 6 * 60_000

const hdr = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: hdr({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }) })

export interface SelftestApiDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  /** Tests: stands in for the real run. */
  run?: (d: SelftestDeps) => Promise<SelftestReport>
  deps?: SelftestDeps
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest()
export const tokenOk = (given: string | null, expected: string): boolean => !!given && !!expected && timingSafeEqual(digest(given), digest(expected))

// without a bucket: kept in memory (per instance)
const mem = new Map<string, string>()

async function readJson<T>(store: OrderStore | null, path: string): Promise<T | null> {
  try {
    const raw = store ? await store.getObject(path) : mem.has(path) ? Buffer.from(mem.get(path)!) : null
    return raw ? (JSON.parse(raw.toString('utf8')) as T) : null
  } catch {
    return null
  }
}
async function writeJson(store: OrderStore | null, path: string, body: object): Promise<void> {
  const text = JSON.stringify(body)
  if (!store) mem.set(path, text)
  else await store.putObject(path, text, 'application/json')
}

const commitOf = (env: NodeJS.ProcessEnv): string | null => {
  const c = env.ICHIREI_COMMIT?.trim() ?? ''
  return /^[0-9a-zA-Z]{4,40}$/.test(c) ? c : null
}

export function createSelftestHandlers(getDeps: () => SelftestApiDeps) {
  return {
    async run(req: Request): Promise<Response> {
      const d = getDeps()
      const env = d.env ?? process.env
      const now = d.now ?? (() => new Date())
      const expected = env.ICHIREI_SELFTEST_TOKEN ?? ''
      if (!expected) return json(503, { state: 'refused', code: 'not_configured' })
      if (req.method !== 'POST') return json(405, { state: 'refused', code: 'method_not_allowed' })
      if (!tokenOk(req.headers.get('x-selftest-token'), expected)) return json(401, { state: 'refused', code: 'unauthorized' })
      const store = d.store
      const commit = commitOf(env)
      const today = now().toISOString().slice(0, 10)
      // this commit was tested already: nothing to do (and it does not count against the day)
      if (commit && (await readJson(store, `selftest/commit-${commit}.json`))) return json(200, { state: 'skipped', reason: 'already_tested', commit })
      // at most 6 runs a day
      const day = (await readJson<{ runs: number }>(store, `selftest/day-${today}.json`)) ?? { runs: 0 }
      if (day.runs >= SELFTEST_DAILY_MAX) return json(429, { state: 'capped', max: SELFTEST_DAILY_MAX, runs: day.runs })
      // one run at a time
      const lock = await readJson<{ started_at: string; done: boolean }>(store, 'selftest/lock.json')
      if (lock && !lock.done && now().getTime() - Date.parse(lock.started_at) < LOCK_STALE_MS) return json(409, { state: 'running' })
      const startedAt = now().toISOString()
      await writeJson(store, 'selftest/lock.json', { started_at: startedAt, done: false })
      await writeJson(store, `selftest/day-${today}.json`, { runs: day.runs + 1 })
      try {
        const report = publicReport(await (d.run ?? runSelftest)({ ...(d.deps ?? {}), commit, env, now }))
        await writeJson(store, 'selftest/latest.json', report)
        if (commit) await writeJson(store, `selftest/commit-${commit}.json`, { commit, at: report.finished_at, passed: report.summary.passed, failed: report.summary.failed })
        await writeJson(store, 'selftest/lock.json', { started_at: startedAt, done: true })
        console.log(`[ichirei-selftest] ${JSON.stringify({ commit, stories: report.summary.stories, passed: report.summary.passed, failed: report.summary.failed, errors: report.summary.errors, ms: report.ms, spend_estimate_usd: report.spend_estimate_usd })}`)
        return json(200, { state: 'done', report })
      } catch (err) {
        await writeJson(store, 'selftest/lock.json', { started_at: startedAt, done: true }).catch(() => {})
        console.log(`[ichirei-selftest] ${JSON.stringify({ commit, error: String((err as Error)?.name ?? 'error').slice(0, 40) })}`)
        return json(500, { state: 'error', code: 'run_failed' })
      }
    },

    async latest(): Promise<Response> {
      const d = getDeps()
      const r = await readJson<SelftestReport>(d.store, 'selftest/latest.json')
      if (!r) return json(404, { state: 'none' })
      // rebuilt through the whitelist again on the way out: whatever is stored, only codes and characters are served
      return json(200, publicReport(r), { 'cache-control': 'public, max-age=60' })
    },
  }
}

export const handlers = createSelftestHandlers(() => ({ store: createOrderStore() }))
