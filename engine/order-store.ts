// Where orders live: the story and the engine result are kept HERE, under order_ref — never in
// Shopify — so production can read the gaze line and the anchor when it needs them.
//
//   gcs     Google Cloud Storage object  orders/<order_ref>.json  (Cloud Run: ORDER_BUCKET)
//   file    one JSON file per order      <ORDER_STORE_DIR>/<order_ref>.json (local / tests)
//   memory  in-process only              (unit tests)
//
// The GCS store talks to the JSON API directly with the service account's metadata-server token,
// so it needs no SDK. Cloud Run's service account needs roles/storage.objectAdmin on the bucket
// (DEPLOY.md). Env: ORDER_BUCKET, ORDER_STORE_DIR; tests may set GCS_API_BASE and GCS_ACCESS_TOKEN.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface OrderStore {
  readonly kind: 'gcs' | 'file' | 'memory'
  put(orderRef: string, record: object): Promise<void>
  get(orderRef: string): Promise<object | null>
}

const SAFE_REF = /^[A-Za-z0-9-]{1,64}$/
function assertRef(ref: string): void {
  if (!SAFE_REF.test(ref)) throw new Error(`Unsafe order_ref: ${ref.slice(0, 20)}`)
}

export class MemoryOrderStore implements OrderStore {
  readonly kind = 'memory' as const
  readonly records = new Map<string, object>()
  async put(ref: string, record: object) {
    assertRef(ref)
    this.records.set(ref, structuredClone(record))
  }
  async get(ref: string) {
    assertRef(ref)
    return this.records.has(ref) ? structuredClone(this.records.get(ref)!) : null
  }
}

export class FileOrderStore implements OrderStore {
  readonly kind = 'file' as const
  private readonly dir: string
  constructor(dir: string) {
    this.dir = dir
  }
  async put(ref: string, record: object) {
    assertRef(ref)
    await mkdir(this.dir, { recursive: true })
    const path = join(this.dir, `${ref}.json`)
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8')
    await rename(tmp, path) // atomic: a reader never sees half a record
  }
  async get(ref: string) {
    assertRef(ref)
    try {
      return JSON.parse(await readFile(join(this.dir, `${ref}.json`), 'utf8')) as object
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
}

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

export class GcsOrderStore implements OrderStore {
  readonly kind = 'gcs' as const
  private cached: { token: string; expiresAt: number } | null = null

  private readonly bucket: string
  private readonly opts: { apiBase?: string; staticToken?: string; fetchImpl?: typeof fetch }

  constructor(bucket: string, opts: { apiBase?: string; staticToken?: string; fetchImpl?: typeof fetch } = {}) {
    this.bucket = bucket
    this.opts = opts
  }

  private get api() {
    return (this.opts.apiBase ?? 'https://storage.googleapis.com').replace(/\/$/, '')
  }
  private get doFetch() {
    return this.opts.fetchImpl ?? fetch
  }

  private async token(): Promise<string> {
    if (this.opts.staticToken) return this.opts.staticToken
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token
    const res = await this.doFetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`metadata server token request failed: HTTP ${res.status}`)
    const j = (await res.json()) as { access_token: string; expires_in: number }
    this.cached = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
    return j.access_token
  }

  async put(ref: string, record: object) {
    assertRef(ref)
    const name = encodeURIComponent(`orders/${ref}.json`)
    const res = await this.doFetch(`${this.api}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${name}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(record, null, 2),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`GCS put failed: HTTP ${res.status}`)
  }

  async get(ref: string) {
    assertRef(ref)
    const name = encodeURIComponent(`orders/${ref}.json`)
    const res = await this.doFetch(`${this.api}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${name}?alt=media`, {
      headers: { authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GCS get failed: HTTP ${res.status}`)
    return (await res.json()) as object
  }
}

/** Pick the store from the environment; null = not configured (the order API then answers 503). */
export function createOrderStore(env: NodeJS.ProcessEnv = process.env): OrderStore | null {
  if (env.ORDER_BUCKET) {
    return new GcsOrderStore(env.ORDER_BUCKET, { apiBase: env.GCS_API_BASE || undefined, staticToken: env.GCS_ACCESS_TOKEN || undefined })
  }
  if (env.ORDER_STORE_DIR) return new FileOrderStore(env.ORDER_STORE_DIR)
  return null
}
