// POST /api/poem — one poem for the chosen character (歌の添え書き: ONE poem is included free in every order; the buyer picks the format).
//
//   body  { session?, story, follow_ups?, language, relationship?, direction?, occasion?, occasion_detail?, kanji, gaze, type }
//   200   { poem_id, type, lines, pattern, reading, aids, preview }   the page shows the FULL poem before checkout (`preview` is the first line)
//   502   { error, code: 'poem_failed', type, reasons: [codes] }   (the failed checks in words are in the server log only)
//   The poem is stored under poem_id on the server; /api/order takes the poem_id (never poem text from the browser) and the attributes on the
//   main Shopify line item are built from the stored poem. All four types are always available.
//
// Web-standard handler like api/order.ts. Cost brake: the server mounts it behind ICHIREI_POEM_LIMIT (20 per hour per IP).

import { noCelebration, toneLine } from '../engine/purpose.ts'
import { createHash, randomBytes } from 'node:crypto'
import { cleanSession, cleanSource, recordEvent } from '../engine/analytics.ts'
import { costCollector } from '../engine/ai-cost.ts'
import { STORY_MAX, countChars, mergeStory, parseContext, parseFollowUps, type Language } from '../engine/contract.ts'
import { POEM_ID_PATTERN, todayJst, type StoredPoem } from '../engine/order.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { loadPalette, type Palette } from '../engine/palette.ts'
import { generatePoem, type GenerateOptions } from '../engine/poem.ts'
import { POEM_TYPES, poemTypeAllowed, poemTypesFor, type PoemType } from '../src/order/packages.ts'
import { decideStoryLanguage } from '../engine/story-language.ts'

const MAX_BODY_BYTES = 40_000
const GAZE_MAX = 300

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export interface PoemDeps {
  store: OrderStore | null
  palette?: Palette
  generate?: typeof generatePoem
  generateOptions?: GenerateOptions
  now?: () => Date
}

// Rewrites (2026-11-20): a style is written once, then at most TWICE more per result — three versions in all. The count is the server's, keyed by the result (the story, the character, the
// language and the style), so a page that is reloaded, or a request that leaves out the "rewrite" flag, cannot get a fourth. The record keeps the poem ids of the versions (their lines go to
// the model as "do not reuse these") and nothing else: no story, no name.
export const MAX_REWRITES = 2
const MAX_VERSIONS = MAX_REWRITES + 1
export const rewriteKey = (story: string, language: string, kanji: string, type: string): string => createHash('sha256').update(`${story}\n${language}\n${kanji}\n${type}`).digest('hex').slice(0, 32)
const rewritePath = (key: string): string => `poems/rw-${key}.json`
interface RewriteRecord { ids: string[] }
async function readRewrites(store: OrderStore, key: string): Promise<RewriteRecord> {
  try {
    const raw = await store.getObject(rewritePath(key))
    const j = raw ? (JSON.parse(raw.toString('utf8')) as RewriteRecord) : null
    return { ids: Array.isArray(j?.ids) ? j!.ids.filter((x) => typeof x === 'string' && POEM_ID_PATTERN.test(x)).slice(0, MAX_VERSIONS) : [] }
  } catch {
    return { ids: [] }
  }
}
/** Adds the new version, unless the result already has all three (a second request that raced the first): then false and nothing changes. */
async function addVersion(store: OrderStore, key: string, id: string): Promise<boolean> {
  if (store.casObject) {
    let added = false
    await store.casObject(rewritePath(key), (cur) => {
      const rec = cur ? (JSON.parse(cur.toString('utf8')) as RewriteRecord) : { ids: [] }
      const ids = Array.isArray(rec.ids) ? rec.ids : []
      if (ids.length >= MAX_VERSIONS) return null
      added = true
      return JSON.stringify({ ids: [...ids, id] })
    })
    return added
  }
  const rec = await readRewrites(store, key)
  if (rec.ids.length >= MAX_VERSIONS) return false
  await store.putObject(rewritePath(key), JSON.stringify({ ids: [...rec.ids, id] }), 'application/json')
  return true
}

export const newPoemId = (now: Date = new Date(), random: (n: number) => Uint8Array = randomBytes): string => {
  const bytes = random(10)
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let suffix = ''
  for (const b of bytes) suffix += alphabet[b % alphabet.length]
  return `PM-${todayJst(now).replaceAll('-', '')}-${suffix}`
}

export function createPoemHandler(deps: () => PoemDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'Request body too large' })
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text)
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object')
    } catch {
      return json(400, { error: 'Body is not valid JSON' })
    }
    const d = deps()
    const now = d.now?.() ?? new Date()

    const type = body.type
    if (typeof type !== 'string' || !(POEM_TYPES as readonly string[]).includes(type)) return json(400, { error: `Invalid "type": expected one of ${POEM_TYPES.join(' | ')}`, field: 'type' })
    if (typeof body.story !== 'string' || !body.story.trim()) return json(400, { error: 'Missing "story"', field: 'story' })
    if (countChars(body.story) > STORY_MAX) return json(400, { error: `"story" is longer than ${STORY_MAX} characters`, field: 'story' })
    const fu = parseFollowUps(body.follow_ups)
    if (!fu.ok) return json(400, { error: fu.error, field: 'follow_ups' })
    const ctx = parseContext({ language: body.language, relationship: body.relationship, direction: body.direction, occasion: body.occasion, occasion_detail: body.occasion_detail, purpose: body.purpose, purpose_other: body.purpose_other, state: body.state, state_other: body.state_other, relationship_other: body.relationship_other })
    if (!ctx.ok) return json(400, { error: ctx.error })
    const { relationship, direction, occasion, occasion_detail } = ctx.context
    // the story's language decides the poem (Part 6): the page's language only fills in when the text says nothing
    const language = decideStoryLanguage(mergeStory(body.story, fu.followUps), ctx.context.language)
    // the formats follow the story's language (spec v9.4): 短歌 / 漢詩 for a Japanese story, 漢詩 / 宋詞 for a Chinese one, free verse for an English one
    if (!poemTypeAllowed(language, type, mergeStory(body.story, fu.followUps))) return json(400, { error: `The format "${type}" is not offered for this story's language; offered: ${poemTypesFor(language, mergeStory(body.story, fu.followUps)).join(' | ')}`, code: 'poem_type_not_offered', field: 'type' })
    const kanji = typeof body.kanji === 'string' ? body.kanji.trim() : ''
    if ([...kanji].length !== 1 || !/[㐀-鿿豈-﫿]/u.test(kanji)) return json(400, { error: '"kanji" must be one character', field: 'kanji' })
    const gaze = typeof body.gaze === 'string' ? body.gaze.trim() : ''
    if (!gaze || [...gaze].length > GAZE_MAX) return json(400, { error: `"gaze" must be 1–${GAZE_MAX} characters`, field: 'gaze' })
    if (!d.store) return json(503, { error: 'Order storage is not configured on the server (set ORDER_BUCKET — see DEPLOY.md).', code: 'store_not_configured' })

    // The chosen character must be one the sender could have been shown: a hard block, a block for this occasion and the remembrance
    // default block are refused here as well (the poem rules are the card's rules).
    const palette = d.palette ?? loadPalette()
    const family = language === 'ja' || language === 'en' ? 'ja' : 'zh'
    const row = palette.lookup(family, kanji) ?? palette.lookup(family === 'ja' ? 'zh' : 'ja', kanji)
    if (row && (row.status === 'hard_block' || (occasion !== null && row.blocked_occasions.includes(occasion)))) return json(400, { error: 'This character cannot carry a poem for this gift.', code: 'character_not_allowed', field: 'kanji' })
    if (occasion === 'memorial' && palette.memorialCategory([kanji])) return json(400, { error: 'This character cannot carry a poem for this gift.', code: 'character_not_allowed', field: 'kanji' })
    const forms = [...new Set([kanji, row?.inscription_form, row?.kanji].filter((x): x is string => Boolean(x)))]

    // the result's earlier versions of this style (the server's own record): at the limit the request is refused, and otherwise their lines go to the model as "do not reuse these"
    const story = mergeStory(body.story, fu.followUps)
    const rwKey = rewriteKey(story, language, kanji, type)
    const known = await readRewrites(d.store, rwKey)
    if (known.ids.length >= MAX_VERSIONS) return json(429, { error: 'That is all the versions of this style for this character.', code: 'rewrite_limit', type, rewrites_left: 0, version: known.ids.length })
    const previous: string[][] = []
    for (const id of known.ids) {
      try {
        const old = (await d.store.get(id)) as StoredPoem | null
        if (old && old.schema === 'poem' && old.type === type && Array.isArray(old.lines)) previous.push(old.lines.map(String))
      } catch {
        // a version that cannot be read is simply not passed on
      }
    }

    const gen = d.generate ?? generatePoem
    const cost = costCollector('poem', cleanSource(body.source))
    const result = await gen(
      { story: mergeStory(body.story, fu.followUps), language: language as Language, relationship, direction, occasion, occasion_detail, tone: toneLine(ctx.context), quiet: noCelebration(ctx.context), kanji, ...(previous.length ? { previous } : {}), inscription_form: forms.find((f) => f !== kanji) ?? null, gaze, type: type as PoemType },
      palette,
      { ...d.generateOptions, onUsage: (stage: 'poem' | 'review', u: { model: string; input_tokens: number; output_tokens: number }) => cost.add(stage, u) },
    )
    void cost.flush(d.store, now, cleanSession(body.session) ?? undefined)
    if (!result.ok) {
      const status = result.code === 'poem_timeout' ? 504 : result.code === 'declined' ? 422 : 502
      return json(status, { error: result.error, code: result.code, type, ...(result.reasons?.length ? { reasons: result.reasons } : {}) })
    }

    const poem = result.poem
    const poemId = newPoemId(now)
    const stored: StoredPoem = { schema: 'poem', poem_id: poemId, type: poem.type, lines: poem.lines, pattern: poem.pattern, reading: poem.reading, kanji, forms, language: language as Language, created_at: now.toISOString() }
    try {
      await d.store.put(poemId, stored)
    } catch (err) {
      console.error('[ichirei-poem] store failed', err instanceof Error ? err.message : err)
      return json(503, { error: 'Could not save the poem. Nothing was charged; please try again.', code: 'store_failed' })
    }
    // the version is counted only once it is stored: a failed rewrite costs the customer nothing
    const counted = await addVersion(d.store, rwKey, poemId).catch(() => true)
    const version = known.ids.length + 1
    const rewritesLeft = Math.max(0, MAX_REWRITES - (version - 1))
    if (!counted) return json(429, { error: 'That is all the versions of this style for this character.', code: 'rewrite_limit', type, rewrites_left: 0, version: MAX_VERSIONS })
    // Learning loop: which types were previewed — the session id and the type only, never the poem or the story.
    const sessionId = cleanSession(body.session)
    if (sessionId) void recordEvent({ ts: now.toISOString(), session: sessionId, source: cleanSource(body.source), event: 'poem_previewed', poem_type: poem.type }, d.store, now)
    return json(200, { poem_id: poemId, type: poem.type, lines: poem.lines, pattern: poem.pattern, reading: poem.reading, aids: poem.aids, preview: poem.lines[0], version, rewrites_left: rewritesLeft })
  }
}

export const poemIdValid = (id: unknown): id is string => typeof id === 'string' && POEM_ID_PATTERN.test(id)

export const POST = createPoemHandler(() => ({ store: createOrderStore() }))
export const GET = () => json(405, { error: 'Method not allowed' })
