// 2026-11-20 — Part 13: the receiver's keepsakes — one way to keep everything (the QR image and the link), the in-app browser line. No network, no model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-keep-all.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import jsQR from 'jsqr'
import sharp from 'sharp'
import * as OpenCC from 'opencc-js'
import { createGiftHandlers } from '../api/gift.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { type GiftRecord } from '../engine/gift.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { makeQrSlip } from '../engine/render/keepsake.ts'
import { CER, allCeremonyText } from '../src/gift/ceremony/copy.ts'
import { isInAppBrowser } from '../src/gift/ceremony/in-app.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-20T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })
const decode = async (png: Buffer | Uint8Array) => {
  const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return jsQR(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height)?.data ?? null
}

// ---- the words, exactly as the owner wrote them ------------------------------------------------------------------------------------------------------------
{
  const ja = CER.ja, en = CER.en, zh = CER['zh-Hant'], hs = CER['zh-Hans']
  check('(1) the in-app line in all three languages', ja.inAppLine === '保存がうまくいかないときは、右上の︙から「ブラウザで開く」を選んでください。' && en.inAppLine === "If saving doesn't work, open this page in your browser from the ︙ menu." && zh.inAppLine === '如果無法儲存，請從右上角的︙選擇「用瀏覽器開啟」。')
  check('(1) zh-Hans is the zh-Hant text converted with OpenCC', hs.inAppLine === toHans(zh.inAppLine))
  check('(1) no he / she and no machine words in the new line', (['en', 'ja', 'zh-Hant', 'zh-Hans'] as const).every((l) => !allCeremonyText(l).some((t) => /\b(he|she)\b/i.test(t) || /[他她]/.test(t) || /\bAI\b|人工智|機器|机器/.test(t))))
}

// ---- the in-app browser ---------------------------------------------------------------------------------------------------------------------------------------
{
  const LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0'
  const LINE_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Line/14.8.0 LIFF'
  const IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.12.114'
  const FB = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0.0;]'
  const WECHAT = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0 Mobile Safari/537.36 MicroMessenger/8.0.47.2560'
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  check('(2) LINE (iPhone and Android), Instagram, Facebook and WeChat are in-app browsers', [LINE, LINE_ANDROID, IG, FB, WECHAT].every(isInAppBrowser))
  check('(2) Safari, Chrome, an empty user agent and nothing are not', [SAFARI, CHROME, '', null, undefined].every((u) => !isInAppBrowser(u)))
}

// ---- the QR image -----------------------------------------------------------------------------------------------------------------------------------------------------
const URL = 'https://ichirei.beyondculture.ai/g/RG-abcdefghijkmnpqrstuv'
for (const lang of ['ja', 'en', 'zh-Hant'] as const) {
  const png = await makeQrSlip({ url: URL, glyph: '備', lang, quiet: false })
  const meta = await sharp(png).metadata()
  check(`(3) the slip (${lang}) is a PNG whose QR decodes to the receiver's page — and to nothing else`, meta.format === 'png' && (meta.width ?? 0) >= 1000 && (await decode(png)) === URL)
}
check('(3) the slip is Ivory (the corners are the Ivory paper, not white)', await (async () => { const raw = await sharp(await makeQrSlip({ url: URL, glyph: '備', lang: 'ja', quiet: false })).raw().toBuffer({ resolveWithObject: true }); const px = (x: number, y: number) => [...raw.data.subarray((y * raw.info.width + x) * raw.info.channels, (y * raw.info.width + x) * raw.info.channels + 3)]; const c = px(10, 10); return c[0] === 0xf7 && c[1] === 0xf1 && c[2] === 0xe3 })())

// ---- the route: the receiver's own link; closed before the day -------------------------------------------------------------------------------------------------------
const mem = new MemoryOrderStore()
const fetchImpl = (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })) as unknown as typeof fetch
const deps = (): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0 } as OrderDeps)
const post = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, unknown> } }
const body = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-11-25', inscription_style: 'kyujitai', package: 'egift', ...over })
const open1 = await post(body({ sender_email: 'taro@example.com' }))
const shut1 = await post(body({ sender_email: 'taro@example.com', open_date: '2026-12-25' }))
for (const o of [open1, shut1]) await mem.put(o.json.order_ref as string, { ...((await mem.get(o.json.order_ref as string)) as object), collected_at: NOW.toISOString() })
const gOpen = (await mem.get(((await mem.get(open1.json.order_ref as string)) as { gift_token: string }).gift_token)) as GiftRecord
const gShut = (await mem.get(((await mem.get(shut1.json.order_ref as string)) as { gift_token: string }).gift_token)) as GiftRecord
const H = createGiftHandlers(() => ({ store: mem, now: () => NOW, env: { ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as NodeJS.ProcessEnv }))
{
  const res = await H.keepQr(gOpen.token)
  const png = Buffer.from(await res.arrayBuffer())
  check('(4) the route gives a PNG of the receiver\'s own page (the QR decodes to /g/<token>), as a download, never stored by a cache', res.status === 200 && res.headers.get('content-type') === 'image/png' && /attachment/.test(res.headers.get('content-disposition') ?? '') && /no-store/.test(res.headers.get('cache-control') ?? '') && (await decode(png)) === `https://ichirei.beyondculture.ai/g/${gOpen.token}`, `${res.status} ${await decode(png)}`)
  check('(4) before the opening day it is closed (403) — a preview with the sender\'s own id still opens it', (await H.keepQr(gShut.token)).status === 403 && (await H.keepQr(gShut.token, (await mem.get(gShut.animation_id)) ? gShut.animation_id : null)).status === 200)
  check('(4) a made-up token is 404', (await H.keepQr('RG-aaaaaaaaaaaaaaaaaaaa')).status === 404)
}
// ---- the page: the sender's route, the in-app line above the two buttons -----------------------------------------------------------------------------------------------------------
{
  const sender = await H.keepQrForSender(((await mem.get(((await mem.get(open1.json.order_ref as string)) as { gift_token: string }).gift_token)) as GiftRecord).animation_id)
  check('(5) the sender\'s page gets the same QR through its own id', sender.status === 200 && (await decode(Buffer.from(await sender.arrayBuffer()))) === `https://ichirei.beyondculture.ai/g/${gOpen.token}`)
  const page = readFileSync('src/gift/ceremony/NewCeremony.tsx', 'utf8')
  const keep = page.slice(page.indexOf('function KeepScreen'))
  check('(5) the in-app line sits above the two buttons (passed as the hint of GiftActions) and shows only in an in-app browser', keep.includes('isInAppBrowser(') && keep.includes('hint={inApp ?') && keep.includes('data-testid="keep-inapp"'))
  check('(5) the four cards stay on the screen to look at, with no 保存 link of their own', keep.includes('keep-film') && keep.includes('keep-pictures') && keep.includes('keep-card') && keep.includes('keep-cert') && !keep.includes('data-testid="save-') && !keep.includes('download'))
}

console.log(failures === 0 ? '\nAll keep-all checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
