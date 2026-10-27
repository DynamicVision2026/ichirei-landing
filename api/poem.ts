// POST /api/poem — one poem for the chosen character (the paid add-on, 歌の添え書き), and GET /api/poem-types — which types are on offer.
//
//   body  { session?, story, follow_ups?, language, relationship?, direction?, occasion?, occasion_detail?, kanji, gaze, type }
//   200   { poem_id, type, lines, pattern, reading, aids, preview, price_jpy }   `preview` is the FIRST LINE only
//   502   { error, code: 'poem_failed', type, reasons: [codes] }   (+ `problems`: the failed checks in words, only in ICHIREI_POEM_PREVIEW mode)
//   The poem is stored under poem_id on the server; /api/order takes the poem_id (never poem text from the browser) and the Shopify
//   line item + attributes are built from the stored poem. A type whose Shopify variant is not configured is not offered (unless ICHIREI_POEM_PREVIEW=on, which only lets this endpoint write it).
//
// Web-standard handler like api/order.ts. Cost brake: the server mounts it behind ICHIREI_POEM_LIMIT (20 per hour per IP).

import { randomBytes } from 'node:crypto'
import { cleanSession, cleanSource, recordEvent } from '../engine/analytics.ts'
import { STORY_MAX, countChars, mergeStory, parseContext, parseFollowUps, type Language } from '../engine/contract.ts'
import { POEM_ID_PATTERN, todayJst, type StoredPoem } from '../engine/order.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { loadPalette, type Palette } from '../engine/palette.ts'
import { generatePoem, type GenerateOptions } from '../engine/poem.ts'
import { availablePoemTypes, poemPreviewOn, poemTypesAccepted } from '../engine/shopify.ts'
import { MAX_POEMS, POEM_PRICE_JPY, POEM_TYPES, type PoemType } from '../src/order/packages.ts'

const MAX_BODY_BYTES = 40_000
const GAZE_MAX = 300

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export interface PoemDeps {
  store: OrderStore | null
  /** The types POST /api/poem accepts: those with a configured Shopify variant — all four when ICHIREI_POEM_PREVIEW is on (testing only). */
  types: PoemType[]
  palette?: Palette
  generate?: typeof generatePoem
  generateOptions?: GenerateOptions
  /** ICHIREI_POEM_PREVIEW: a failed poem also answers with the failed checks in words (`problems`), for the owner's testing. */
  detail?: boolean
  now?: () => Date
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
    if (!d.types.includes(type as PoemType)) return json(404, { error: 'This kind of poem is not on offer.', code: 'poem_type_unavailable', field: 'type' })
    if (typeof body.story !== 'string' || !body.story.trim()) return json(400, { error: 'Missing "story"', field: 'story' })
    if (countChars(body.story) > STORY_MAX) return json(400, { error: `"story" is longer than ${STORY_MAX} characters`, field: 'story' })
    const fu = parseFollowUps(body.follow_ups)
    if (!fu.ok) return json(400, { error: fu.error, field: 'follow_ups' })
    const ctx = parseContext({ language: body.language, relationship: body.relationship, direction: body.direction, occasion: body.occasion, occasion_detail: body.occasion_detail })
    if (!ctx.ok) return json(400, { error: ctx.error })
    const { language, relationship, direction, occasion, occasion_detail } = ctx.context
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

    const gen = d.generate ?? generatePoem
    const result = await gen(
      { story: mergeStory(body.story, fu.followUps), language: language as Language, relationship, direction, occasion, occasion_detail, kanji, inscription_form: forms.find((f) => f !== kanji) ?? null, gaze, type: type as PoemType },
      palette,
      d.generateOptions,
    )
    if (!result.ok) {
      const status = result.code === 'poem_timeout' ? 504 : result.code === 'declined' ? 422 : 502
      return json(status, { error: result.error, code: result.code, type, ...(result.reasons?.length ? { reasons: result.reasons } : {}), ...(d.detail && result.problems?.length ? { problems: result.problems } : {}) })
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
    // Learning loop: which types were previewed — the session id and the type only, never the poem or the story.
    const sessionId = cleanSession(body.session)
    if (sessionId) void recordEvent({ ts: now.toISOString(), session: sessionId, source: cleanSource(body.source), event: 'poem_previewed', poem_type: poem.type }, d.store, now)
    return json(200, { poem_id: poemId, type: poem.type, lines: poem.lines, pattern: poem.pattern, reading: poem.reading, aids: poem.aids, preview: poem.lines[0], price_jpy: POEM_PRICE_JPY, max: MAX_POEMS })
  }
}

export const poemIdValid = (id: unknown): id is string => typeof id === 'string' && POEM_ID_PATTERN.test(id)

export const POST = createPoemHandler(() => ({ store: createOrderStore(), types: poemTypesAccepted(), detail: poemPreviewOn() }))
export const GET = () => json(405, { error: 'Method not allowed' })

/** GET /api/poem-types — the types on offer and the price shown (the charge is the Shopify variant's). Empty list → the page hides the poem step. */
export const TYPES_GET = () => json(200, { types: availablePoemTypes(), price_jpy: POEM_PRICE_JPY, max: MAX_POEMS })
