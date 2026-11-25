// The owner's gift maker (Ticket 8, 2026-11-25): the owner sends free gifts to bloggers, from himself. This turns one moment into a FINISHED gift — the character, the poem, the film's four lines and
// four checked pictures, the receiver's link — with no checkout and no manual step, and answers with the receiver's link.
//
// It is an addition BESIDE the product, not a change to it: it calls the engine, the poem handler, the film script and the picture code exactly as a customer's order does, and writes the same records
// (order, animation, gift) — but
//   · it is an owner gift at 0: no Shopify, no cart, no checkout, no customer e-mail; it is collected at once and opens at once (`collect_required: false`, `collected_at` set);
//   · it is marked `source: 'owner_outreach'` with its `tag`, and it is NEVER written to the orders index (`recordOrderIndex`) — so it is not in /ops, in sales, in revenue, in the daily caps, in the
//     free-gift counts or in the tool funnel: those all start from that index (or from a customer's own events, which this never records);
//   · its pictures are drawn as a PAID order's are (`paid: true`): the daily picture limit neither holds them back nor counts them;
//   · at most 30 a day (ICHIREI_OWNER_GIFT_DAILY_MAX), counted in its own small record.
// The receiver's page /g/RG-… is the normal one; nothing on it tells it from a customer's gift. Nothing here sends an e-mail or logs a story, a name or the token.

import { createHash, timingSafeEqual } from 'node:crypto'
import { runEngine } from './engine.ts'
import { LANGUAGES, STORY_MAX, countChars, mergeStory, parseContext, type EngineResult, type Language } from './contract.ts'
import { decideStoryLanguage } from './story-language.ts'
import { ANIMATION_ID_PATTERN, animationUrl, buildAnimationRecord, filmUsable, isAnimationRecord, newAnimationId, pictureUrl, type AnimationRecord } from './animation.ts'
import { buildGiftRecord, giftUrl, isGiftRecord, newGiftToken, type GiftRecord } from './gift.ts'
import { ORDER_REF_PATTERN, buildRecord, newOrderRef, optionalName, parseOrderRequest, todayJst, type OrderRecord, type StoredPoem } from './order.ts'
import { isOrderRecord } from './buyer.ts'
import { allocateCertificateNo } from './certificate-no.ts'
import { casJson } from './customer.ts'
import { costCollector } from './ai-cost.ts'
import { ensureArt, readArt, renderBudgetMs, type ArtRecord, type ImageClient } from './film-art.ts'
import { filmInputFromRecord } from './film-store.ts'
import { makeFilm, type FilmInput, type FilmRecord } from './film.ts'
import type { OrderStore } from './order-store.ts'
import { readSecret } from './track.ts'
import { createPoemHandler, type PoemDeps } from '../api/poem.ts'
import { DEFAULT_STYLE } from '../src/order/inscription.ts'
import { POEM_TYPES, defaultPoemType, poemTypeAllowed, type PoemType } from '../src/order/packages.ts'
import type Anthropic from '@anthropic-ai/sdk'

export const OWNER_TOKEN_SECRET = 'ICHIREI_OWNER_API_TOKEN'
export const OWNER_GIFT_DAILY_DEFAULT = 30
export const OWNER_SOURCE = 'owner_outreach'

type Reader = (name: string, env: NodeJS.ProcessEnv) => Promise<string>

// ---- who may ask ----------------------------------------------------------------------------------------------------------------------------------------------------------------

let tokenCache: { value: string; at: number } | null = null
export const resetOwnerTokenCache = (): void => {
  tokenCache = null
}

/** The agent's token: the environment wins (tests, local runs), otherwise Secret Manager, kept for a minute. '' = none set up (the Bearer way is then simply off). */
export async function ownerApiToken(env: NodeJS.ProcessEnv = process.env, read: Reader = readSecret, now: number = Date.now()): Promise<string> {
  const direct = env[OWNER_TOKEN_SECRET]?.trim()
  if (direct) return direct
  if (tokenCache && now - tokenCache.at < (tokenCache.value ? 60_000 : 30_000)) return tokenCache.value
  let value = ''
  try {
    value = (await read(OWNER_TOKEN_SECRET, env)).trim()
  } catch {
    value = ''
  }
  tokenCache = { value, at: now }
  return value
}

const sha = (s: string): Buffer => createHash('sha256').update(s).digest()

/** `none` = the request carries no Bearer header; `yes` = it carries the owner's token; `bad` = a Bearer header that is not it (or no token is set up). Never logs the token. */
export async function bearerOwner(req: Request, env: NodeJS.ProcessEnv = process.env, read: Reader = readSecret, now: number = Date.now()): Promise<'none' | 'yes' | 'bad'> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!m) return 'none'
  const token = await ownerApiToken(env, read, now)
  if (!token) return 'bad'
  return timingSafeEqual(sha(m[1]), sha(token)) ? 'yes' : 'bad'
}

// ---- the day's count ------------------------------------------------------------------------------------------------------------------------------------------------------------

export const ownerGiftDailyMax = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.ICHIREI_OWNER_GIFT_DAILY_MAX?.trim()
  return raw !== undefined && raw !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : OWNER_GIFT_DAILY_DEFAULT
}
const dayPath = (now: Date): string => `owner-gifts/day-${todayJst(now)}.json`
const indexPath = 'owner-gifts/index.json'

/** One gift of today's allowance, taken before anything is made (a second request cannot slip past); false when the 30 are used. */
async function takeToday(store: OrderStore, now: Date, max: number): Promise<boolean> {
  const after = await casJson<{ n: number }>(store, dayPath(now), (cur) => ({ n: (cur?.n ?? 0) + 1 })).catch(() => null)
  if (!after) return false
  if (after.n > max) {
    await giveBack(store, now)
    return false
  }
  return true
}
async function giveBack(store: OrderStore, now: Date): Promise<void> {
  await casJson<{ n: number }>(store, dayPath(now), (cur) => ({ n: Math.max(0, (cur?.n ?? 0) - 1) })).catch(() => null)
}
export async function givenToday(store: OrderStore, now: Date): Promise<number> {
  try {
    const raw = await store.getObject(dayPath(now))
    return raw ? Number((JSON.parse(raw.toString('utf8')) as { n?: number }).n) || 0 : 0
  } catch {
    return 0
  }
}

// ---- the gift -------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface OwnerGiftDeps {
  store: OrderStore
  env?: NodeJS.ProcessEnv
  now?: () => Date
  /** Tests: stand in for the engine, the poem model, the film script, the image model and the picture check. Nothing else is faked: the same code runs. */
  engine?: typeof runEngine
  poem?: PoemDeps['generate']
  film?: (input: FilmInput) => Promise<FilmRecord>
  image?: ImageClient
  vision?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  pollMs?: number
  /** How long the answer waits for the pictures (default ICHIREI_OWNER_GIFT_WAIT_MS, 90 s); after that it answers with `pictures_ready: false`. */
  waitMs?: number
}

export interface OwnerGiftInput {
  moment?: unknown
  language?: unknown
  receiver?: unknown
  sender?: unknown
  poem_style?: unknown
  tag?: unknown
}

export type PicturesState = 'ready' | 'drawing' | 'no_script' | 'failed'

export interface OwnerGiftView {
  id: string
  glyph: string
  reading: string
  line: string
  poem: { type: string; lines: string[]; reading: string } | null
  pictures_ready: boolean
  pictures_state: PicturesState
  /** How many of the four pictures passed their check (the others show a plain tile or a neighbour's picture). */
  pictures_drawn: number
  /** Private addresses of the pictures that are drawn (the owner's page shows them). */
  picture_urls: (string | null)[]
  receiver_link: string
  sender_page: string
  language: Language
  receiver: string
  sender: string
  tag: string | null
  opened: boolean
  created_at: string
}

export type OwnerGiftResult = { ok: true; gift: OwnerGiftView } | { ok: false; status: number; code: string; error: string; follow_up_question?: string }

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): OwnerGiftResult => ({ ok: false, status, code, error, ...extra })
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/
const sleep = (ms: number): Promise<null> => new Promise((r) => setTimeout(() => r(null), ms).unref?.())
export const ownerWaitMs = (env: NodeJS.ProcessEnv = process.env): number => (Number(env.ICHIREI_OWNER_GIFT_WAIT_MS) >= 0 && env.ICHIREI_OWNER_GIFT_WAIT_MS !== undefined && env.ICHIREI_OWNER_GIFT_WAIT_MS !== '' ? Number(env.ICHIREI_OWNER_GIFT_WAIT_MS) : 90_000)

const readAs = async <T>(store: OrderStore, id: string, ok: (x: unknown) => x is T): Promise<T | null> => {
  try {
    const x = await store.get(id)
    return ok(x) ? x : null
  } catch {
    return null
  }
}

/** The state of the four pictures: drawn and checked (`ready`), still being drawn (`drawing`), none could be drawn (`failed`), or the film's script was only the fallback (`no_script`: nothing to draw). */
export function picturesStateOf(anim: AnimationRecord, art: ArtRecord | null): { state: PicturesState; drawn: number } {
  const film = anim.film
  if (!filmUsable(film) || film.status !== 'ready') return { state: filmUsable(film) ? 'no_script' : 'drawing', drawn: 0 }
  const drawn = art ? art.slots.filter((s) => s === 'ai').length : 0
  if (art?.status === 'done' || (art && art.status === 'incomplete' && !art.slots.includes('pending') && !art.slots.includes('unchecked'))) return { state: drawn > 0 ? 'ready' : 'failed', drawn }
  return { state: 'drawing', drawn }
}

async function view(store: OrderStore, env: NodeJS.ProcessEnv, order: OrderRecord, gift: GiftRecord, anim: AnimationRecord, art: ArtRecord | null): Promise<OwnerGiftView> {
  const { state, drawn } = picturesStateOf(anim, art)
  return {
    id: order.order_ref,
    glyph: gift.glyph,
    reading: gift.reading,
    line: gift.who,
    poem: gift.poem,
    pictures_ready: state === 'ready',
    pictures_state: state,
    pictures_drawn: drawn,
    picture_urls: [0, 1, 2, 3].map((i) => (art && art.slots[i] === 'ai' ? pictureUrl(anim.id, i + 1, art.made_at) : null)),
    receiver_link: giftUrl(gift.token, env),
    sender_page: animationUrl(anim.id, env),
    language: gift.language,
    receiver: order.production.receiver_name,
    sender: order.production.sender_name,
    tag: order.outreach?.tag ?? null,
    opened: !!gift.opened_at,
    created_at: order.created_at,
  }
}

/** Draw the pictures (a paid order's rules: the daily limit never holds them back), waiting at most `wait` ms; the rest keeps being drawn and the next look continues it. */
async function drawPictures(d: OwnerGiftDeps, anim: AnimationRecord, wait: number, force: boolean): Promise<ArtRecord | null> {
  const env = d.env ?? process.env
  if (!filmUsable(anim.film) || anim.film.status !== 'ready') return null
  const drawing = ensureArt(
    { store: d.store, image: d.image, client: d.vision, env, log: d.log, now: d.now, pollMs: d.pollMs, ...(force ? { force: true } : {}) },
    { id: anim.id, film: anim.film, memorial: anim.memorial, language: anim.language, paid: true },
  )
  const art = await Promise.race([drawing, sleep(Math.min(wait, renderBudgetMs(env)))])
  return art ?? (await readArt(d.store, anim.id).catch(() => null))
}

/**
 * Make one finished owner gift. The steps are the customer's, in order: the engine picks the character (the main card), the poem is written and stored by the poem handler, the order is
 * validated by the order's own parser, the film script is written, the records are stored, and the four pictures are drawn and checked.
 */
export async function makeOwnerGift(d: OwnerGiftDeps, input: OwnerGiftInput): Promise<OwnerGiftResult> {
  const env = d.env ?? process.env
  const now = d.now?.() ?? new Date()
  const log = d.log ?? ((l: string) => console.log(l))
  const store = d.store

  // 1 · what was asked
  const moment = typeof input.moment === 'string' ? input.moment.trim() : ''
  if (!moment) return fail(400, 'missing_moment', 'Missing "moment"')
  if (countChars(moment) > STORY_MAX) return fail(400, 'moment_too_long', `"moment" is longer than ${STORY_MAX} characters`)
  const language = input.language
  if (typeof language !== 'string' || !(LANGUAGES as readonly string[]).includes(language)) return fail(400, 'bad_language', `"language" must be one of ${LANGUAGES.join(' | ')}`)
  const receiver = optionalName(input.receiver ?? '')
  if (receiver === null) return fail(400, 'bad_receiver', '"receiver" is at most 20 characters, no control characters')
  const sender = optionalName(input.sender ?? '')
  if (sender === null) return fail(400, 'bad_sender', '"sender" is at most 20 characters, no control characters')
  let tag: string | null = null
  if (input.tag !== undefined && input.tag !== null && input.tag !== '') {
    if (typeof input.tag !== 'string' || !TAG.test(input.tag.trim())) return fail(400, 'bad_tag', '"tag" is 1–40 letters, digits, dots, dashes or underscores')
    tag = input.tag.trim()
  }
  // the story's language is the one key (as on the page): the gift is made in the language the moment is written in
  const storyLanguage = decideStoryLanguage(moment, language as Language)
  let style: PoemType
  const wantStyle = input.poem_style
  if (wantStyle === undefined || wantStyle === null || wantStyle === '' || wantStyle === 'default') style = defaultPoemType(storyLanguage, moment)
  else if (typeof wantStyle === 'string' && (POEM_TYPES as readonly string[]).includes(wantStyle) && poemTypeAllowed(storyLanguage, wantStyle, moment)) style = wantStyle as PoemType
  else return fail(400, 'bad_poem_style', '"poem_style" is default, or a format offered for this language (tanka, haiku, tang, ci, en)')

  // 2 · today's allowance of owner gifts (its own count; no customer limit is touched)
  const max = ownerGiftDailyMax(env)
  if (!(await takeToday(store, now, max))) return fail(429, 'daily_limit', `At most ${max} owner gifts a day`)
  const cost = costCollector('owner_gift', 'harness') // the money is real, so it is in the AI cost; the source keeps it out of every customer number
  try {
    // 3 · the character: the engine, as the writing page runs it; the main card is the one chosen
    const ctx = parseContext({ language: storyLanguage })
    if (!ctx.ok) return fail(400, 'bad_language', ctx.error)
    let result: EngineResult
    try {
      result = await (d.engine ?? runEngine)(moment, 'A', { context: { ...ctx.context, language: storyLanguage }, round: 1, onUsage: (stage, u) => cost.add(stage, u) })
    } catch (err) {
      log(`[ichirei-owner-gift] ${JSON.stringify({ event: 'engine_failed', class: err instanceof Error ? err.name : 'error' })}`)
      await giveBack(store, now)
      return fail(502, 'engine_failed', 'The engine could not read the moment. Try again in a moment.')
    }
    const main = result.candidates.find((c) => c.kanji === result.primary_kanji && c.eliminated !== true)
    if (result.status !== 'sufficient' || !result.primary_kanji || !main) {
      await giveBack(store, now)
      return fail(422, 'moment_needs_more', 'The moment does not give the engine enough to choose a character. Add one concrete scene.', { ...(result.follow_up_question ? { follow_up_question: result.follow_up_question } : {}) })
    }

    // 4 · the poem: the poem handler, as the order page calls it (the same checks, the same store)
    const poemHandler = createPoemHandler(() => ({ store, now: d.now, ...(d.poem ? { generate: d.poem } : {}) }))
    const pres = await poemHandler(new Request('http://owner.local/api/poem', {
      method: 'POST',
      body: JSON.stringify({
        story: moment, language: storyLanguage, type: style, kanji: main.kanji, gaze: main.one_line_gaze, source: 'harness',
        ...(result.relationship ? { relationship: result.relationship } : {}), ...(result.direction ? { direction: result.direction } : {}), ...(result.occasion ? { occasion: result.occasion } : {}),
        ...(result.occasion_detail ? { occasion_detail: result.occasion_detail } : {}), ...(result.purpose ? { purpose: result.purpose } : {}), ...(result.state ? { state: result.state } : {}),
      }),
    }))
    const pj = (await pres.json().catch(() => null)) as { poem_id?: string; code?: string } | null
    if (!pres.ok || !pj?.poem_id) {
      await giveBack(store, now)
      return fail(502, 'poem_failed', 'The poem could not be written. Try again in a moment.')
    }
    const poem = (await store.get(pj.poem_id).catch(() => null)) as StoredPoem | null
    if (!poem || poem.schema !== 'poem') {
      await giveBack(store, now)
      return fail(502, 'poem_failed', 'The poem could not be saved. Try again in a moment.')
    }

    // 5 · the order, validated by the order's own parser: an e-gift, the language's default carved form, the two names
    const parsed = parseOrderRequest({
      story: moment, engine_result: result, selected_kanji: main.kanji, language: storyLanguage, page_language: language, sender_name: sender, receiver_name: receiver,
      inscription_style: DEFAULT_STYLE[storyLanguage], package: 'egift',
      shown_characters: result.candidates.filter((c) => c.eliminated !== true).map((c) => ({ set: 1, candidate: c })),
    }, now)
    if (!parsed.ok) {
      await giveBack(store, now)
      return fail(422, 'order_invalid', `The gift could not be made (${parsed.field}).`)
    }
    const order = parsed.order
    order.certificate.poems = [{ type: poem.type, lines: poem.lines, reading: poem.reading }]
    const ref = newOrderRef(now)
    const record = buildRecord(order, ref, now, [poem])
    // an owner gift: free, no Shopify, collected and open at once; it is never a customer order
    record.status = 'owner'
    record.source = OWNER_SOURCE
    record.outreach = { tag, at: now.toISOString() }
    record.price = 0
    record.production.price_jpy = 0
    record.collect_required = false
    record.collected_at = now.toISOString()

    // 6 · the film's script, and the records (the animation, the receiver's gift, the order)
    const animId = newAnimationId()
    const token = newGiftToken()
    const anim = buildAnimationRecord(record, animId, now)
    anim.gift_token = token
    const film = await (d.film ?? ((i: FilmInput) => makeFilm(i, { log: d.log })))(filmInputFromRecord(record))
    anim.film = film
    record.production.film = film
    try {
      record.certificate_no = await allocateCertificateNo(store, ref, now)
    } catch {
      record.certificate_no = null // (the gift then simply shows no number)
    }
    record.animation_id = animId
    record.gift_token = token
    const gift = buildGiftRecord(record, animId, token, null, now) // no sender e-mail: no gift back is offered, and no e-mail is ever sent
    try {
      await store.put(animId, anim)
      await store.put(token, gift)
      await store.put(ref, record)
      await casJson<{ items: { id: string; at: string }[] }>(store, indexPath, (cur) => ({ items: [...(cur?.items ?? []), { id: ref, at: now.toISOString() }] }))
    } catch {
      await giveBack(store, now)
      return fail(503, 'store_failed', 'The gift could not be saved. Nothing was made; try again.')
    }
    void cost.flush(store, now)

    // 7 · the four pictures, drawn and checked; the answer waits for them up to the allowance
    const art = await drawPictures(d, anim, d.waitMs ?? ownerWaitMs(env), false)
    log(`[ichirei-owner-gift] ${JSON.stringify({ event: 'made', order_ref: ref, language: storyLanguage, tag, pictures: picturesStateOf(anim, art).state })}`)
    return { ok: true, gift: await view(store, env, record, gift, anim, art) }
  } catch (err) {
    log(`[ichirei-owner-gift] ${JSON.stringify({ event: 'failed', class: err instanceof Error ? err.name : 'error' })}`)
    await giveBack(store, now)
    return fail(500, 'failed', 'The gift could not be made. Try again in a moment.')
  }
}

/** One owner gift as it stands now. With `advance`, a set of pictures that is not finished is carried on (the pending ones are drawn again) before answering — so polling this finishes the gift. */
export async function readOwnerGift(d: OwnerGiftDeps, id: string, opts: { advance?: boolean } = {}): Promise<OwnerGiftView | null> {
  if (!ORDER_REF_PATTERN.test(id)) return null
  const env = d.env ?? process.env
  const order = await readAs(d.store, id, isOrderRecord)
  if (!order || order.source !== OWNER_SOURCE || !order.animation_id || !order.gift_token || !ANIMATION_ID_PATTERN.test(order.animation_id)) return null
  const [gift, anim] = await Promise.all([readAs(d.store, order.gift_token, isGiftRecord), readAs(d.store, order.animation_id, isAnimationRecord)])
  if (!gift || !anim) return null
  let art = await readArt(d.store, anim.id).catch(() => null)
  if (opts.advance && picturesStateOf(anim, art).state === 'drawing') art = await drawPictures(d, anim, d.waitMs ?? ownerWaitMs(env), true)
  return view(d.store, env, order, gift, anim, art)
}

/** The outreach gifts, newest first: the tag, the receiver, the character, the date, opened or not. */
export async function listOwnerGifts(d: OwnerGiftDeps, limit = 200): Promise<OwnerGiftView[]> {
  let items: { id: string; at: string }[] = []
  try {
    const raw = await d.store.getObject(indexPath)
    items = raw ? ((JSON.parse(raw.toString('utf8')) as { items?: { id: string; at: string }[] }).items ?? []) : []
  } catch {
    items = []
  }
  const out: OwnerGiftView[] = []
  for (const it of items.slice(-limit).reverse()) {
    const v = await readOwnerGift(d, it.id)
    if (v) out.push(v)
  }
  return out
}
