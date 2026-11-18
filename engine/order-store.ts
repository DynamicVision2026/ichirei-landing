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

import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface OrderStore {
  readonly kind: 'gcs' | 'file' | 'memory'
  put(orderRef: string, record: object): Promise<void>
  get(orderRef: string): Promise<object | null>
  /** Append one JSON line to an object like `analytics/2026-10-25.jsonl` (the learning loop; no story text, no names). */
  appendJsonl(path: string, record: object): Promise<void>
  /**
   * The film's pictures and its small state file (films/<animation id>/1.webp … 4.webp, art.json, and the daily render count). Private objects in the
   * same bucket: nothing here makes an object public, and nothing lists the bucket. `ifAbsent` makes the write a lock: it returns false when the object
   * already exists (Cloud Storage: ifGenerationMatch=0).
   */
  putObject(path: string, body: Buffer | string, contentType: string, opts?: { ifAbsent?: boolean }): Promise<boolean>
  getObject(path: string): Promise<Buffer | null>
  /**
   * Read-modify-write of one small object with a PRECONDITION (Cloud Storage: ifGenerationMatch; a new object is created with ifGenerationMatch=0): `mutate` gets the current bytes (null when absent)
   * and returns the new bytes, or null to leave it as it is. A concurrent writer makes the write fail and `mutate` runs again on the newer bytes, so two instances can never both win. Returns what is stored after.
   */
  casObject?(path: string, mutate: (current: Buffer | null) => Buffer | string | null, contentType?: string): Promise<Buffer | null>
  /** Remove an object (the 30-day clean-up of saved gifts and customer records). Absent = nothing to do. */
  deleteObject?(path: string): Promise<void>
}

const SAFE_OBJECT = /^(analytics\/\d{4}-\d{2}-\d{2}\.jsonl|films\/(AN-[a-z2-9]{20}\/(art\.json|film\.(mp4|json)|share\.(mp4|json)|[1-4](\.unchecked)?\.webp)|renders-\d{4}-\d{2}-\d{2}\.jsonl)|ops\/(orders-\d{4}-\d{2}-\d{2}|cards-\d{4}-\d{2}-\d{2}|mains-\d{4}-\d{2}-\d{2}|health-\d{4}-\d{2}-\d{2}|customers-\d{4}-\d{2}-\d{2}|egift|waiting)\.jsonl|ops\/certno\/(\d{4,7}|last)\.json|og\/RG-[a-z2-9]{20}\.[0-9a-f]{8}\.png|rounds\/RS-[a-z2-9]{20}-[1-9]\.json|customers\/(ptr\/)?[EV][A-Za-z0-9_-]{22,64}\.json|customers\/byorder\/\d{3,8}\.json|basket\/BK-[a-z2-9]{20}\.json|basket\/tok\/BT-[a-z2-9]{24}\.json|basket\/pending\/BM-[a-z2-9]{24}\.json|mail\/count\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.json|promo\/\d{4}-\d{2}-\d{2}\/(holds\/[0-9a-f]{32}|slots\/\d{1,3}-\d{1,3}|used\/H-[a-z2-9]{16}|checkout\/H-[a-z2-9]{16}|ip\/[0-9a-f]{16}-\d{1,2})\.json|promo\/used\/[0-9a-f]{32}\.json|selftest\/(latest|lock)\.json|selftest\/probe-\d{4}-\d{2}-\d{2}\.json|selftest\/day-\d{4}-\d{2}-\d{2}\.json|selftest\/month-\d{4}-\d{2}\.json|selftest\/commit-[0-9a-zA-Z]{4,40}\.json)$/
export function assertObjectPath(path: string): void {
  if (!SAFE_OBJECT.test(path)) throw new Error(`Unsafe object path: ${path.slice(0, 40)}`)
}

const SAFE_PATH = /^(analytics\/\d{4}-\d{2}-\d{2}|films\/renders-\d{4}-\d{2}-\d{2}|ops\/orders-\d{4}-\d{2}-\d{2}|ops\/cards-\d{4}-\d{2}-\d{2}|ops\/mains-\d{4}-\d{2}-\d{2}|ops\/health-\d{4}-\d{2}-\d{2}|ops\/customers-\d{4}-\d{2}-\d{2}|ops\/egift|ops\/waiting)\.jsonl$/
function assertJsonlPath(path: string): void {
  if (!SAFE_PATH.test(path)) throw new Error(`Unsafe analytics path: ${path.slice(0, 40)}`)
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
  readonly lines = new Map<string, string[]>()
  async appendJsonl(path: string, record: object) {
    assertJsonlPath(path)
    this.lines.set(path, [...(this.lines.get(path) ?? []), JSON.stringify(record)])
  }
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()
  async putObject(path: string, body: Buffer | string, contentType: string, opts: { ifAbsent?: boolean } = {}) {
    assertObjectPath(path)
    if (opts.ifAbsent && this.objects.has(path)) return false
    this.objects.set(path, { body: Buffer.from(body), contentType })
    return true
  }
  async getObject(path: string) {
    assertObjectPath(path)
    if (path.endsWith('.jsonl')) return this.lines.has(path) ? Buffer.from(this.lines.get(path)!.join('\n') + '\n') : null
    return this.objects.get(path)?.body ?? null
  }
  async casObject(path: string, mutate: (current: Buffer | null) => Buffer | string | null, contentType = 'application/json') {
    assertObjectPath(path)
    // one process, no await between the read and the write: atomic
    const cur = this.objects.get(path)?.body ?? null
    const next = mutate(cur ? Buffer.from(cur) : null)
    if (next === null) return cur
    this.objects.set(path, { body: Buffer.from(next), contentType })
    return this.objects.get(path)!.body
  }
  async deleteObject(path: string) {
    assertObjectPath(path)
    this.objects.delete(path)
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
  async appendJsonl(path: string, record: object) {
    assertJsonlPath(path)
    const file = join(this.dir, path)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, JSON.stringify(record) + '\n', 'utf8') // O_APPEND: whole small lines never interleave
  }
  async putObject(path: string, body: Buffer | string, _contentType: string, opts: { ifAbsent?: boolean } = {}) {
    assertObjectPath(path)
    const file = join(this.dir, path)
    await mkdir(dirname(file), { recursive: true })
    if (opts.ifAbsent) {
      try {
        await writeFile(file, body, { flag: 'wx' }) // fails when it exists: a lock
        return true
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw e
      }
    }
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, body)
    await rename(tmp, file)
    return true
  }
  async getObject(path: string) {
    assertObjectPath(path)
    try {
      return await readFile(join(this.dir, path))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
  private readonly casQueue = new Map<string, Promise<unknown>>()
  async casObject(path: string, mutate: (current: Buffer | null) => Buffer | string | null, contentType = 'application/json') {
    assertObjectPath(path)
    // one process: writes to the same path go one after the other
    const prev = this.casQueue.get(path) ?? Promise.resolve()
    const run = prev.catch(() => {}).then(async () => {
      const cur = await this.getObject(path)
      const next = mutate(cur ? Buffer.from(cur) : null)
      if (next === null) return cur
      await this.putObject(path, next, contentType)
      return Buffer.from(next)
    })
    this.casQueue.set(path, run)
    return run as Promise<Buffer | null>
  }
  async deleteObject(path: string) {
    assertObjectPath(path)
    try {
      await unlink(join(this.dir, path))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
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

  /**
   * Cloud Storage has no append, so a daily JSONL object is read, extended and written back with
   * `ifGenerationMatch` (0 for a new object): a concurrent writer makes the upload fail with 412 and we retry.
   */
  async appendJsonl(path: string, record: object) {
    assertJsonlPath(path)
    const name = encodeURIComponent(path)
    const bucket = encodeURIComponent(this.bucket)
    for (let attempt = 0; attempt < 6; attempt++) {
      const auth = { authorization: `Bearer ${await this.token()}` }
      const cur = await this.doFetch(`${this.api}/storage/v1/b/${bucket}/o/${name}?alt=media`, { headers: auth, signal: AbortSignal.timeout(15_000) })
      let text = ''
      let generation = '0'
      if (cur.status === 200) {
        text = await cur.text()
        generation = cur.headers.get('x-goog-generation') ?? ''
        if (!generation) throw new Error('GCS append: no x-goog-generation on the existing object')
      } else if (cur.status !== 404) throw new Error(`GCS append read failed: HTTP ${cur.status}`)
      if (text && !text.endsWith('\n')) text += '\n'
      const res = await this.doFetch(`${this.api}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${name}&ifGenerationMatch=${generation}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/x-ndjson; charset=utf-8' },
        body: text + JSON.stringify(record) + '\n',
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return
      if (res.status !== 412) throw new Error(`GCS append failed: HTTP ${res.status}`)
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * (attempt + 1)))
    }
    throw new Error('GCS append: gave up after repeated generation conflicts')
  }

  async putObject(path: string, body: Buffer | string, contentType: string, opts: { ifAbsent?: boolean } = {}) {
    assertObjectPath(path)
    // a plain media upload: no predefinedAcl and no ACL entries, so the object keeps the bucket's (private) access
    const res = await this.doFetch(`${this.api}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}${opts.ifAbsent ? '&ifGenerationMatch=0' : ''}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': contentType },
      body: typeof body === 'string' ? body : new Uint8Array(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 412 && opts.ifAbsent) return false
    if (!res.ok) throw new Error(`GCS put failed: HTTP ${res.status}`)
    return true
  }
  async getObject(path: string) {
    assertObjectPath(path)
    const res = await this.doFetch(`${this.api}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(path)}?alt=media`, {
      headers: { authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GCS get failed: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  /** Read-modify-write with ifGenerationMatch: a concurrent writer makes the upload answer 412 and the whole step runs again on the newer bytes. */
  async casObject(path: string, mutate: (current: Buffer | null) => Buffer | string | null, contentType = 'application/json') {
    assertObjectPath(path)
    const name = encodeURIComponent(path)
    const bucket = encodeURIComponent(this.bucket)
    for (let attempt = 0; attempt < 8; attempt++) {
      const auth = { authorization: `Bearer ${await this.token()}` }
      const cur = await this.doFetch(`${this.api}/storage/v1/b/${bucket}/o/${name}?alt=media`, { headers: auth, signal: AbortSignal.timeout(15_000) })
      let current: Buffer | null = null
      let generation = '0'
      if (cur.status === 200) {
        current = Buffer.from(await cur.arrayBuffer())
        generation = cur.headers.get('x-goog-generation') ?? ''
        if (!generation) throw new Error('GCS cas: no x-goog-generation on the existing object')
      } else if (cur.status !== 404) throw new Error(`GCS cas read failed: HTTP ${cur.status}`)
      const next = mutate(current ? Buffer.from(current) : null)
      if (next === null) return current
      const res = await this.doFetch(`${this.api}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${name}&ifGenerationMatch=${generation}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': contentType },
        body: typeof next === 'string' ? next : new Uint8Array(next),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return Buffer.from(next)
      if (res.status !== 412) throw new Error(`GCS cas failed: HTTP ${res.status}`)
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * (attempt + 1)))
    }
    throw new Error('GCS cas: gave up after repeated generation conflicts')
  }
  async deleteObject(path: string) {
    assertObjectPath(path)
    const res = await this.doFetch(`${this.api}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status !== 404 && !res.ok) throw new Error(`GCS delete failed: HTTP ${res.status}`)
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
