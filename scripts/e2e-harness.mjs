// Usage: npx playwright + a dev server on :5173, then `node scripts/e2e-harness.mjs`.
// Optional env: CHROMIUM_PATH (browser binary), E2E_SHOTS_DIR (screenshot output).
// End-to-end harness test (build spec §9.7): drives the real /demo UI against a
// mocked engine returning the §10 golden-fixture shape. Verifies the reveal,
// condition toggle (no engine re-call), kyūjitai pairing, follow-up loop, and
// all §6 behavioral events.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const SHOTS = process.env.E2E_SHOTS_DIR ?? '.'
const STORY =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

const FIXTURE = JSON.parse(readFileSync(new URL('./golden-fixture.json', import.meta.url), 'utf8'))

const INSUFFICIENT = {
  status: 'insufficient',
  follow_up_question:
    'お父さまの、他の人には何でもないようなことなのに、あなたには忘れられない小さな仕草はありますか？',
  particulars: [], fingerprint: { relationship: null, scarce_asset: null,
    unsaid_truth: null, dominant_truth_type: null, dignity_direction: null },
  candidates: [], primary_kanji: null,
}

let failures = 0
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
})

// ---------- Run 1: sufficient path, full experiment flow ----------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  let selectCalls = 0
  let explainCalls = 0
  const loggedEvents = []
  await page.route('**/api/select', async (route) => {
    selectCalls++
    await new Promise((r) => setTimeout(r, 600)) // let the processing view show
    await route.fulfill({ json: FIXTURE })
  })
  await page.route('**/api/explain', async (route) => {
    explainCalls++
    await route.fulfill({ json: { explanation: '折り目正しくというより、行き先のあるやさしさだった。「金は要るか」とだけ言って封筒を押し付けたあの改札から二十年、あなたは一度も迎えを欠かさなかった。還暦を迎えるいま、こんどは私があなたを迎えにいく番だと思う。' } })
  })
  await page.route('**/api/log', async (route) => {
    try { loggedEvents.push(JSON.parse(route.request().postData() ?? '{}').event) } catch {}
    await route.fulfill({ status: 204, body: '' })
  })

  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  check('elicitation: opening ask shown', await page.locator('text=小さなことを、ひとつだけ').isVisible())
  check('elicitation: five angle chips', (await page.locator('button', { hasText: 'いつものクセ' }).count()) === 1
    && (await page.locator('text=言わなかったけれど、してくれたこと').count()) === 1)

  // Angle chip opens an aimed box and appends to the story
  await page.click('text=つくったもの、直したもの')
  await page.fill('textarea >> nth=1', '壊れた自転車をいつのまにか直してくれていた')
  await page.click('text=物語に加える')
  const storyVal1 = await page.locator('textarea').first().inputValue()
  check('angle chip appends aimed text', storyVal1.includes('【つくったもの、直したもの】'))

  await page.locator('textarea').first().fill(STORY)
  await page.click('text=その一字を、探しにいく')
  check('processing view shows', await page.locator('text=言葉を読んでいます').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-processing.png` })

  // Progressive reveal: 3 alive candidates at ~1.1s intervals, 迎 (primary) last
  await page.waitForSelector('article', { timeout: 10000 })
  const afterFirst = await page.locator('article').count()
  check('reveal is progressive (starts with 1)', afterFirst === 1)
  const firstGlyph = await page.locator('article').first().locator('span').first().textContent()
  check('primary does NOT surface first', firstGlyph !== '迎')
  await page.waitForTimeout(2600) // let all three land
  check('all survivors revealed', (await page.locator('article').count()) === 3)
  const lastGlyph = await page.locator('article').last().locator('span').first().textContent()
  check('primary 迎 resolves last', lastGlyph === '迎')
  const primaryColor = await page.locator('article').last().locator('span').first()
    .evaluate((el) => getComputedStyle(el).color)
  check('primary rendered in cinnabar', primaryColor === 'rgb(192, 57, 43)')

  // Kyūjitai pairing: 黙 card shows 默 as glyph, paired with 黙 + もく
  const mokuCard = page.locator('article', { hasText: '静けさのまま' })
  check('kyūjitai 默 used as inscription glyph', (await mokuCard.locator('span').first().textContent()) === '默')
  check('kyūjitai paired with modern + reading', await mokuCard.locator('text=黙 ・ もく').isVisible())
  check('kyūjitai pairing note shown', await mokuCard.locator('text=古体字（現代字：黙）').isVisible())

  await page.screenshot({ path: `${SHOTS}/e2e-reveal-A.png` })

  // Condition A purity: no explain / preview buttons
  await mokuCard.click()
  await page.waitForTimeout(400)
  check('condition A: no deep-explain button', (await page.locator('text=この一字を、深く読む').count()) === 0)
  check('condition A: no preview button', (await page.locator('text=かたちを見る').count()) === 0)

  // Dwell + return: open 迎, then re-open 黙 → candidate_returned
  await page.waitForTimeout(700)
  await page.locator('article').last().click() // opens 迎 (flushes 黙 dwell)
  await page.waitForTimeout(400)
  await mokuCard.click() // re-open 黙 → returned

  // Condition toggle B — presentation only, engine NOT re-called
  await page.click('header >> text="B"')
  await page.waitForTimeout(300)
  check('condition B: deep-explain button appears', await page.locator('text=この一字を、深く読む').first().isVisible())
  await page.click('text=この一字を、深く読む')
  await page.waitForSelector('text=こんどは私があなたを迎えにいく番', { timeout: 5000 })
  check('condition B: explanation rendered', true)
  check('explain called once', explainCalls === 1)
  await page.screenshot({ path: `${SHOTS}/e2e-reveal-B.png` })

  // Condition C — physical preview
  await page.click('header >> text="C"')
  await page.waitForTimeout(300)
  await page.click('text=かたちを見る（現物プレビュー）')
  await page.waitForTimeout(700)
  check('condition C: preview modal with rubbing placeholder', await page.locator('text=Rubbing Ceremony').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-preview-C.png` })
  await page.click('text=閉じる')

  // Selection: select 黙 first, then 迎 (selection_changed x2), finalize
  await page.locator('article', { hasText: '静けさのまま' }).locator('text=この一字を選ぶ').click()
  await page.locator('article').last().click() // open 迎
  await page.waitForTimeout(400)
  await page.locator('article').last().locator('text=この一字を選ぶ').click()
  await page.click('text=この一字で、還暦を祝う')
  await page.waitForTimeout(300)
  check('finalize confirms selection', await page.locator('text=「迎」に決めました').isVisible())

  // Eliminated diagnostics section
  await page.click('text=見送った字')
  await page.waitForTimeout(300)
  check('eliminated section lists 送 funeral reason', await page.locator('details').first().locator('text=葬送の連想があり').isVisible())
  check('eliminated 厳 shows kyūjitai 嚴', await page.locator('details').first().locator('text=嚴').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-final.png` })

  // Raw contract still available for diagnostics
  check('raw contract details present', (await page.locator('text=raw contract').count()) === 1)

  // Engine called exactly once across all condition switches
  check('engine called exactly once (conditions are presentation-only)', selectCalls === 1)

  // §6 events all captured
  await page.waitForTimeout(600)
  const need = ['session_started', 'engine_run', 'candidate_opened', 'candidate_dwell_ms',
    'candidate_returned', 'selection_changed', 'preview_opened', 'explain_opened',
    'final_selection', 'condition_changed']
  for (const ev of need) check(`event logged: ${ev}`, loggedEvents.includes(ev))
  const selChanges = loggedEvents.filter((e) => e === 'selection_changed').length
  check('selection_changed fired twice (黙→迎)', selChanges === 2)

  check('no page errors (run 1)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 2: insufficient → follow-up loop ----------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let call = 0
  await page.route('**/api/select', async (route) => {
    call++
    await route.fulfill({ json: call === 1 ? INSUFFICIENT : FIXTURE })
  })
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill('父は働き者で、感謝しています。')
  await page.click('text=その一字を、探しにいく')
  await page.waitForSelector('text=もうすこしだけ、聞かせてください', { timeout: 8000 })
  check('follow-up question shown once', await page.locator('text=忘れられない小さな仕草').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-followup.png` })
  await page.locator('textarea').fill('新聞を読み終わると、必ず四つ折りにして私の席に置いてくれた。')
  await page.click('text=つづきを探しにいく')
  await page.waitForSelector('article', { timeout: 10000 })
  check('follow-up answer re-runs engine into reveal', (await page.locator('article').count()) >= 1)
  check('engine ran twice on follow-up path', call === 2)
  check('no page errors (run 2)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}


// ---------- Run 3: true NDJSON streaming (vite proxy -> mock server) ----------
// No route interception on /api/select: the request travels through the dev
// server proxy to scripts/mock-api.mjs, which streams deltas over ~3s.
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await page.click('text=その一字を、探しにいく')
  check('stream: processing view shows', await page.locator('text=言葉を読んでいます').isVisible())
  // Progress deltas should surface as a live received-chars counter
  await page.waitForSelector('text=一字一字、書きあがっています', { timeout: 6000 })
  check('stream: live progress counter appears mid-stream', true)
  // When the terminal result line lands, the reveal begins
  await page.waitForSelector('article', { timeout: 10000 })
  await page.waitForTimeout(2600)
  check('stream: all survivors revealed after stream completes', (await page.locator('article').count()) === 3)
  check('stream: primary 迎 resolves last', (await page.locator('article').last().locator('span').first().textContent()) === '迎')
  check('no page errors (run 3)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 4: client-side hard timeout -> visible error, no hang ----------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  // Never respond — simulates Vercel killing the function with nothing sent.
  await page.route('**/api/select', () => { /* hang forever */ })

  await page.goto('http://localhost:5173/demo?engine_timeout_ms=1500', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await page.click('text=その一字を、探しにいく')
  check('timeout: spinner shows first', await page.locator('text=言葉を読んでいます').isVisible())
  await page.waitForSelector('text=時間切れになりました', { timeout: 8000 })
  check('timeout: visible error after deadline', true)
  check('timeout: spinner gone', (await page.locator('text=言葉を読んでいます').count()) === 0)
  check('timeout: back on elicitation (retry possible)', await page.locator('text=小さなことを、ひとつだけ').isVisible())
  check('no page errors (run 4)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 5: NDJSON error line surfaces as visible error ----------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/select', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson; charset=utf-8',
      body: JSON.stringify({ type: 'delta', chars: 210 }) + '\n' +
        JSON.stringify({ type: 'error', error: 'Engine failed: model output was not valid JSON' }) + '\n',
    }),
  )
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await page.click('text=その一字を、探しにいく')
  await page.waitForSelector('text=model output was not valid JSON', { timeout: 6000 })
  check('ndjson error line: surfaced to UI', true)
  check('ndjson error line: spinner gone', (await page.locator('text=言葉を読んでいます').count()) === 0)
  check('no page errors (run 5)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
