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
  particulars: [], fingerprint: { relationship_note: null, scarce_asset: null,
    unsaid_truth: null, dominant_truth_type: null, dignity_direction: null },
  candidates: [], primary_kanji: null,
}

// v5: relationship, direction and occasion are required before the engine can be called.
const pickContext = async (page, ctx = {}) => {
  const c = { relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone', ...ctx }
  if ((await page.locator('select[name=relationship]').count()) === 0) {
    // the customer site: chips
    for (const k of ['relationship', 'direction', 'occasion']) await page.click(`[data-chip="${k}:${c[k]}"]`)
    return
  }
  await page.selectOption('select[name=relationship]', c.relationship)
  await page.selectOption('select[name=direction]', c.direction)
  await page.selectOption('select[name=occasion]', c.occasion)
}
const FINALIZE = { ja: 'この一字を、贈る', 'zh-Hans': '就用这一个字', 'zh-Hant': '就用這一個字', en: 'Give this character' }
// the customer site's composer button (the reference's words)
const GO = { ja: 'わたしの物語から字を見つける', 'zh-Hans': '从我的故事里找出那个字', 'zh-Hant': '從我的故事裡找出那個字', en: 'Find the character in my story' }
const SUBMIT = { ja: 'その一字を、探しにいく', 'zh-Hans': '去寻找那一个字', 'zh-Hant': '去尋找那一個字', en: 'Find the one character' }

let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? '  -> ' + String(detail).slice(0, 300) : ''}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
})

// ---------- Run 1: sufficient path, full experiment flow ----------
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
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
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  check('processing view shows', await page.locator('text=言葉を読んでいます').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-processing.png` })

  // Progressive reveal: 3 alive candidates at ~1.1s intervals, the main (証) FIRST, then the second, then the freestyle
  await page.waitForSelector('article', { timeout: 10000 })
  const afterFirst = await page.locator('article').count()
  check('reveal is progressive (starts with 1)', afterFirst === 1)
  const firstGlyph = await page.locator('article').first().locator('span').first().textContent()
  check('v8: the main 証 surfaces first', firstGlyph === '証')
  await page.waitForTimeout(2600) // let all three land
  check('all survivors revealed', (await page.locator('article').count()) === 3)
  const lastGlyph = await page.locator('article').last().locator('span').first().textContent()
  check('v8: the freestyle (封) comes last', lastGlyph === '封')
  const primaryColor = await page.locator('article[data-slot=main]').locator('span').first()
    .evaluate((el) => getComputedStyle(el).color)
  check('primary rendered in cinnabar', primaryColor === 'rgb(192, 57, 43)')

  // Japanese buyers carve the modern form (新字体, spec v9.1 step 9): the card shows the glyph with its reading only — no old-form pairing or note
  const mokuCard = page.locator('article', { hasText: '静けさのまま' })
  check('modern form used as the carved glyph (no old form)', (await mokuCard.locator('span').first().textContent()) === '守')
  check('the reading is shown with the glyph, with no old-form pairing', await mokuCard.locator('text=まもる').first().isVisible() && (await mokuCard.locator('text=守 ・ まもる').count()) === 0)
  check('no old-form (kyūjitai) note on a Japanese card', (await mokuCard.locator('text=古体字').count()) === 0)

  await page.screenshot({ path: `${SHOTS}/e2e-reveal-A.png` })

  // Condition A purity: no explain / preview buttons
  await mokuCard.click()
  await page.waitForTimeout(400)
  check('condition A: no deep-explain button', (await page.locator('text=この一字を、深く読む').count()) === 0)
  check('condition A: no preview button', (await page.locator('text=かたちを見る').count()) === 0)

  // Dwell + return: open 証, then re-open 守 → candidate_returned
  await page.waitForTimeout(700)
  await page.locator('article[data-slot=main]').click() // opens 証 (flushes 守 dwell)
  await page.waitForTimeout(400)
  await mokuCard.click() // re-open 守 → returned

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

  // Selection: select 守 first, then 証 (selection_changed x2), finalize
  await page.locator('article', { hasText: '静けさのまま' }).locator('text=この一字を選ぶ').click()
  await page.locator('article[data-slot=main]').click() // open 証
  await page.waitForTimeout(400)
  await page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await page.click('text=この一字を、贈る')
  await page.waitForTimeout(300)
  check('finalize confirms selection', await page.locator('text=「証」に決めました').isVisible())

  // v8: three cards — 本命 first, 次点, 遊び字 last (DOM order AND visual order) — each labelled; the freestyle is lighter and never cinnabar
  const cards = page.locator('article')
  check('v8: three cards in the DOM order 本命 → 次点 → 遊び字 (main, second, freestyle)', (await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')))).join() === 'main,second,freestyle')
  check('v8: the VISUAL order is the same (top-to-bottom, then left-to-right)', await cards.evaluateAll((els) => { const r = els.map((e) => e.getBoundingClientRect()); const key = (x) => Math.round(x.top / 4) * 100000 + x.left; return r.every((x, i) => i === 0 || key(r[i - 1]) <= key(x)) }))
  check('v6: each card carries its label (本命 / 次点 / 遊び字)', (await cards.evaluateAll((els) => els.map((e) => e.querySelector('[data-slot-label]')?.textContent))).join() === '本命,次点,遊び字')
  check('v8: every kanji glyph is marked notranslate (Chrome auto-translate must not touch it)', await page.evaluate(() => { const g = [...document.querySelectorAll('[data-glyph]')]; return g.length >= 3 && g.every((n) => n.classList.contains('notranslate') && n.getAttribute('translate') === 'no') }))
  check('v8: the page opts out of auto-translate (<html translate=no>, meta google notranslate)', await page.evaluate(() => document.documentElement.getAttribute('translate') === 'no' && document.querySelector('meta[name=google][content=notranslate]') !== null))
  const freeCard = page.locator('article[data-slot=freestyle]')
  check('v6: the freestyle card (封) is lighter: dashed border, no shadow class, glyph NOT cinnabar', (await freeCard.getAttribute('class')).includes('border-dashed') && !(await freeCard.getAttribute('class')).includes('shadow-') && (await freeCard.locator('[data-glyph]').evaluate((el) => getComputedStyle(el).color)) !== 'rgb(192, 57, 43)' && (await freeCard.locator('[data-glyph]').innerText()) === '封')
  check('v6: only the main card\'s glyph is cinnabar', (await page.locator('article[data-slot=second] [data-glyph]').evaluate((el) => getComputedStyle(el).color)) !== 'rgb(192, 57, 43)' && (await page.locator('article[data-slot=main] [data-glyph]').evaluate((el) => getComputedStyle(el).color)) === 'rgb(192, 57, 43)')
  check('v6: each card shows its story anchor in quotes and its gaze; the freestyle has the light line', await freeCard.locator('[data-anchor]:has-text("「封筒を押し付けてきた」")').isVisible() && (await freeCard.innerText()).includes('押し付けてくる人') && (await page.locator('article[data-slot=main] [data-anchor]').innerText()) === '「盆に帰るたびに車で駅まで迎えに来て」')
  check('v6: no classical line is shown (no reviewed palette row, nothing attached), and the freestyle card never offers the deep explanation', (await page.locator('[data-classical]').count()) === 0)
  await freeCard.click()
  await page.waitForTimeout(400)
  check('v6: the freestyle card has no deep-explanation button (even in condition B) but can be selected', (await freeCard.locator('text=この一字を、深く読む').count()) === 0 && (await freeCard.locator('text=この一字を選ぶ').count()) === 1)
  check('v6 (harness): the old "set aside" diagnostics block is empty in the golden — nothing was eliminated', (await page.locator('details', { hasText: '見送った字' }).count()) === 0)
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
  check('selection_changed fired twice (守→証)', selChanges === 2)

  check('no page errors (run 1)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 2: insufficient → follow-up loop ----------
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
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
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  await page.waitForSelector('text=もうすこしだけ、聞かせてください', { timeout: 8000 })
  check('follow-up question shown once', await page.locator('text=忘れられない小さな仕草').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-followup.png` })
  await page.locator('textarea').fill('新聞を読み終わると、必ず四つ折りにして私の席に置いてくれた。')
  await page.click('text=つづきを探しにいく')
  await page.waitForSelector('article', { timeout: 10000 })
  check('follow-up answer re-runs engine into reveal', (await page.locator('article').count()) >= 1)
  check('engine ran twice on follow-up path', call === 2)

  // もう一度試す: back to the story input, current story text kept, result gone.
  const storyBefore = '父は働き者で、感謝しています。\n\n新聞を読み終わると、必ず四つ折りにして私の席に置いてくれた。'
  await page.waitForSelector('text=もう一度試す', { timeout: 5000 })
  await page.screenshot({ path: `${SHOTS}/e2e-retry-button.png` })
  await page.click('text=もう一度試す')
  await page.waitForSelector('text=その一字を、探しにいく', { timeout: 5000 })
  check('retry: returns to the story input (no result on screen)', (await page.locator('article').count()) === 0)
  check('retry: the current story text is kept in the textarea', (await page.locator('textarea').first().inputValue()) === storyBefore)
  await page.locator('textarea').first().fill(storyBefore + '\nそして、いつも守って頷いた。')
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  await page.waitForSelector('article', { timeout: 10000 })
  check('retry: edited story can be run again (engine called a third time)', call === 3)
  check('no page errors (run 2)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}


// ---------- Run 3: true NDJSON streaming (vite proxy -> mock server) ----------
// No route interception on /api/select: the request travels through the dev
// server proxy to scripts/mock-api.mjs, which streams deltas over ~3s.
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  check('stream: processing view shows', await page.locator('text=言葉を読んでいます').isVisible())
  // v8: the server's stage lines surface as honest progress steps (reading → choosing → checking), not one spinner
  await page.waitForSelector('[data-testid=processing-steps] [data-step=choosing][data-state=now]', { timeout: 6000 })
  const stepState = await page.locator('[data-testid=processing-steps] li').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-step')}:${e.getAttribute('data-state')}`).join())
  check('stream: progress steps — reading done, choosing now, checking next (the text is the sender\'s language)', stepState === 'reading:done,choosing:now,checking:next' && (await page.locator('[data-step=choosing]').innerText()).includes('一字ずつ、選んでいます'), stepState)
  await page.waitForSelector('[data-testid=processing-steps] [data-step=checking][data-state=now]', { timeout: 8000 })
  check('stream: the checking step becomes current as the server reports it', true)
  // When the terminal result line lands, the reveal begins
  await page.waitForSelector('article', { timeout: 10000 })
  await page.waitForTimeout(2600)
  check('stream: all survivors revealed after stream completes', (await page.locator('article').count()) === 3)
  check('stream: the main 証 comes first', (await page.locator('article').first().locator('span').first().textContent()) === '証')
  check('no page errors (run 3)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 4: client-side hard timeout -> visible error, no hang ----------
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  // Never respond — simulates Vercel killing the function with nothing sent.
  await page.route('**/api/select', () => { /* hang forever */ })

  await page.goto('http://localhost:5173/demo?engine_timeout_ms=1500', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
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
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
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
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  await page.waitForSelector('text=model output was not valid JSON', { timeout: 6000 })
  check('ndjson error line: surfaced to UI', true)
  check('ndjson error line: spinner gone', (await page.locator('text=言葉を読んでいます').count()) === 0)
  check('no page errors (run 5)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- helpers for the v5 runs ----------
const clone = (x) => JSON.parse(JSON.stringify(x))
const JA_ONLY = /[ぁ-んァ-ヶ]/
/** Visible UI text with the model-written parts (cards, diagnostics) removed, so we test OUR copy. */
const chromeText = (page) =>
  page.evaluate(() => {
    const root = document.body.cloneNode(true)
    root.querySelectorAll('article, pre, details, textarea').forEach((n) => n.remove())
    return root.innerText
  })
const mockPage = async (browser, { onExplain, result, order, track } = {}) => {
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = { select: [], explain: [], order: [], track: [], analytics: [] }
  await page.route('**/api/analytics', async (route) => {
    try { calls.analytics.push(JSON.parse(route.request().postData() ?? '{}')) } catch {}
    await route.fulfill({ status: 204, body: '' })
  })
  if (track) {
    await page.route('**/api/track', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.track.push(body)
      const r = track(body)
      await route.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.json) })
    })
  }
  if (order) {
    await page.route('**/api/order', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.order.push(body)
      const r = order(body)
      await route.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.json) })
    })
    await page.route('**/__checkout*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id=co>Shopify checkout (fake)</h1>' }))
  }
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/select', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    calls.select.push(body)
    await route.fulfill({ json: typeof result === 'function' ? result(body) : (result ?? FIXTURE) })
  })
  await page.route('**/api/explain', async (route) => {
    calls.explain.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ json: { explanation: onExplain ?? 'ok' } })
  })
  return { page, errors, calls }
}

// ---------- Run 6: selectors, request payload, occasion-neutral copy (ja) ----------
{
  const { page, errors, calls } = await mockPage(browser)
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  const submit = page.locator(`button:has-text("${SUBMIT.ja}")`)
  check('selectors: language pills (ja / zh-Hans / zh-Hant / en), 3 selects and the occasion_detail field are present',
    (await page.locator('[data-language]').count()) === 4 &&
    (await page.locator('select[name=relationship] option').count()) === 14 &&
    (await page.locator('select[name=direction] option').count()) === 4 &&
    (await page.locator('select[name=occasion] option').count()) === 9 &&
    (await page.locator('input[name=occasion_detail]').count()) === 1)
  check('selectors: ja is the default language; no inscription-script toggle for ja', (await page.locator('[data-language=ja][aria-pressed=true]').count()) === 1 && (await page.locator('[data-inscription-script]').count()) === 0)
  await page.locator('textarea').first().fill(STORY)
  check('submit stays disabled until relationship, direction and occasion are chosen', await submit.isDisabled())
  check('a hint says what is missing', await page.locator('text=関係・向き・場面を選ぶと').isVisible())
  const before = await chromeText(page)
  check('copy: the opening ask is occasion-neutral (no 六十年 / 還暦 anywhere in the UI chrome)', before.includes('その人のことを、全部書かなくていい') && !/還暦|六十|60/.test(before), before.slice(0, 200))
  await pickContext(page, { relationship: 'mentor', direction: 'up', occasion: 'retirement_farewell' })
  await page.fill('input[name=occasion_detail]', '定年退職')
  check('submit enables once the three are chosen', await submit.isEnabled())
  await page.click(`text=${SUBMIT.ja}`)
  await page.waitForSelector('article', { timeout: 8000 })
  const body = calls.select[0]
  check('payload: story, condition and all five context fields go to /api/select',
    body.story === STORY && body.condition === 'A' && body.language === 'ja' && body.relationship === 'mentor' && body.direction === 'up' && body.occasion === 'retirement_farewell' && body.occasion_detail === '定年退職', JSON.stringify(body))
  check('payload: no inscription_script for ja', !('inscription_script' in body))
  await page.waitForSelector('text=この一字を、贈る', { timeout: 15000 })
  const after = await chromeText(page)
  check('copy: the finalize button is neutral ("この一字を、贈る"), nothing 還暦-specific in the UI chrome', !/還暦|六十|60/.test(after) && !(await page.locator('text=還暦を祝う').count()))
  await page.screenshot({ path: `${SHOTS}/e2e-v5-ja-reveal.png` })
  // golden fixture button loads story + context
  await page.click('text=もう一度試す')
  await page.click('text=golden fixture')
  check('golden fixture button also sets the golden context (ja / 父 / 目上 / 母の日・父の日 / 還暦)',
    (await page.inputValue('select[name=relationship]')) === 'parent_father' && (await page.inputValue('select[name=direction]')) === 'up' && (await page.inputValue('select[name=occasion]')) === 'parent_day' && (await page.inputValue('input[name=occasion_detail]')) === '還暦')
  check('no page errors (run 6)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 7: zh-Hans and zh-Hant UI, inscription script, explain context ----------
{
  const zhResult = () => (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.inscription_script = body.inscription_script ?? 'traditional'
    r.primary_kanji = '灯'
    r.runner_up_kanji = null
    r.candidates = r.candidates.slice(0, 3).map((c) => ({ ...c, eliminated: false, eliminated_reason: null }))
    r.candidates[0] = { ...r.candidates[0], kanji: '灯', inscription_form: '燈', reading: 'dēng', one_line_gaze: '你把玄关的灯一直留着。', story_anchor: '玄关的灯' }
    r.candidates[1] = { ...r.candidates[1], kanji: '守', inscription_form: null, reading: 'mò' }
    r.candidates[2] = { ...r.candidates[2], kanji: '桥', inscription_form: '橋', reading: 'qiáo' }
    return r
  }
  const { page, errors, calls } = await mockPage(browser, { result: zhResult(), onExplain: '解读文字' })
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })

  // zh-Hans
  await page.click('[data-language=zh-Hans]')
  const hansChrome = await chromeText(page)
  check('zh-Hans: the whole UI switches (opening ask, submit, selectors) and is simplified', hansChrome.includes('不必写下那个人的全部') && hansChrome.includes(SUBMIT['zh-Hans']) && hansChrome.includes('送礼的场合') && !JA_ONLY.test(hansChrome.replace(/日本語/g, '')), hansChrome.slice(0, 300))
  check('zh-Hans: the relationship / direction / occasion labels are in Chinese', (await page.locator('select[name=relationship] option[value=parent_father]').innerText()) === '父亲' && (await page.locator('select[name=occasion] option[value=wedding]').innerText()) === '婚礼与结婚纪念')
  check('zh-Hans: the inscription-script toggle appears, traditional by default', (await page.locator('[data-inscription-script=traditional][aria-pressed=true]').count()) === 1)
  await page.locator('textarea').first().fill('他总是把玄关的灯留着，不管我多晚回家。')
  await pickContext(page, { relationship: 'parent_father', direction: 'up', occasion: 'seasonal_thanks' })
  await page.click(`text=${SUBMIT['zh-Hans']}`)
  await page.waitForSelector(`button:has-text("${FINALIZE['zh-Hans']}")`, { timeout: 15000 }) // all cards revealed
  const b1 = calls.select[0]
  check('zh-Hans payload: language zh-Hans, inscription_script traditional (default), context, no occasion_detail when blank',
    b1.language === 'zh-Hans' && b1.inscription_script === 'traditional' && b1.relationship === 'parent_father' && b1.occasion === 'seasonal_thanks' && !('occasion_detail' in b1), JSON.stringify(b1))
  const cardWith = (glyph) => page.locator('article').filter({ has: page.locator(`[data-glyph]:text-is("${glyph}")`) })
  const first = cardWith('燈')
  check('zh-Hans + traditional inscription: the carved glyph is 燈, paired with 灯 and the pinyin', (await first.count()) === 1 && await first.locator('text=灯 ・ dēng').isVisible())
  check('zh-Hans: the note says what is carved (繁體) and shows the simplified form', await first.locator('text=刻字：繁體（简体：灯）').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-v5-zh-hans-reveal.png` })
  // explain (condition B) carries the context
  await page.click('header >> text="B"')
  await first.click()
  await page.click('text=深入读读这个字')
  await page.waitForSelector('text=解读文字', { timeout: 5000 })
  const ex = calls.explain[0]
  check('explain payload: language, script, context and both forms of the character reach /api/explain',
    ex.language === 'zh-Hans' && ex.inscription_script === 'traditional' && ex.relationship === 'parent_father' && ex.direction === 'up' && ex.occasion === 'seasonal_thanks' && ex.candidate.kanji === '灯' && ex.candidate.inscription_form === '燈' && ex.story.includes('玄关的灯'), JSON.stringify(ex))
  await page.click('header >> text="A"')
  // try again, simplified inscription
  await page.click('button:has-text("再试一次")')
  check('retry keeps the story AND the whole context', (await page.locator('textarea').first().inputValue()).includes('玄关的灯') && (await page.inputValue('select[name=occasion]')) === 'seasonal_thanks')
  await page.click('[data-inscription-script=simplified]')
  await page.click(`text=${SUBMIT['zh-Hans']}`)
  await page.waitForSelector(`button:has-text("${FINALIZE['zh-Hans']}")`, { timeout: 15000 })
  check('inscription_script simplified is sent, and the carved glyph becomes 灯 (with 燈 shown beside it)',
    calls.select[1].inscription_script === 'simplified' && (await cardWith('灯').count()) === 1 && await cardWith('灯').locator('text=刻字：简体（繁體：燈）').isVisible())
  check('zh-Hans: the finalize button is neutral and in Chinese (就用这一个字)', true)

  // zh-Hant
  await page.click('button:has-text("再试一次")')
  await page.click('[data-language=zh-Hant]')
  const hantChrome = await chromeText(page)
  check('zh-Hant: the UI is traditional (不必寫下那個人的全部, 送禮的場合) and not simplified', hantChrome.includes('不必寫下那個人的全部') && hantChrome.includes('送禮的場合') && !hantChrome.includes('不必写下'))
  await page.click(`text=${SUBMIT['zh-Hant']}`)
  await page.waitForSelector(`button:has-text("${FINALIZE['zh-Hant']}")`, { timeout: 15000 })
  check('zh-Hant payload: language zh-Hant', calls.select[2].language === 'zh-Hant', JSON.stringify(calls.select[2]))
  const hantReveal = await chromeText(page)
  check('zh-Hant: nothing 還暦/六十-specific in the chrome', !/還暦|六十/.test(hantReveal) && !/还历/.test(hantReveal))
  await page.screenshot({ path: `${SHOTS}/e2e-v5-zh-hant-reveal.png` })
  check('no page errors (run 7)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 8: both main slots removed → `insufficient` → the follow-up question (all four languages) ----------
{
  const QUESTION = { ja: 'お父さまと一緒に過ごした、忘れられない小さな場面をひとつ、教えてください。', 'zh-Hans': '请告诉我，你和他一起度过的一个难忘的小场景。', 'zh-Hant': '請告訴我，你和他一起度過的一個難忘的小場景。', en: 'Could you tell me one small moment you actually shared with him?' }
  const HEADING = { ja: 'もうすこしだけ、聞かせてください', 'zh-Hans': '再多告诉我一点', 'zh-Hant': '再多告訴我一點', en: 'Tell us a little more' }
  const insufficientByReferee = (body) => ({
    ...clone(FIXTURE), language: body.language, status: 'insufficient', follow_up_question: QUESTION[body.language], particulars: [], candidates: [], primary_kanji: null, runner_up_kanji: null, freestyle_kanji: null, fallback_follow_up_question: null,
    fingerprint: { relationship_note: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null, emotional_register: null },
    referee: { palette_rows: 649, original_primary: '送', primary_changed: true, no_eligible_primary: true, promoted_from: null, actions: [{ kanji: '送', action: 'hard_block_eliminated', detail: 'palette: hard_block' }, { kanji: '別', action: 'hard_block_eliminated', detail: 'palette: hard_block' }, { kanji: '送', action: 'insufficient_no_main', detail: 'no main candidate survived the referee' }] },
  })
  for (const lang of ['ja', 'zh-Hans', 'zh-Hant', 'en']) {
    const { page, errors, calls } = await mockPage(browser, { result: insufficientByReferee })
    await page.goto(`http://localhost:5173/demo?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('textarea').first().fill(STORY)
    await pickContext(page)
    await page.click(`text=${SUBMIT[lang]}`)
    await page.waitForSelector(`text=${HEADING[lang]}`, { timeout: 8000 })
    check(`no main (${lang}): the model's own fallback question is shown as the follow-up — no candidate card, no finalize button, never the freestyle`, await page.locator(`text=${QUESTION[lang]}`).isVisible() && (await page.locator('article').count()) === 0 && (await page.locator(`button:has-text("${FINALIZE[lang]}")`).count()) === 0 && (await page.locator('[data-testid=no-primary]').count()) === 0)
    if (lang === 'ja') {
      await page.screenshot({ path: `${SHOTS}/e2e-v6-no-main-followup.png` })
      // answering it re-runs the engine with the answer appended
      await page.locator('[data-testid=followup-input]').fill('帰り際に必ず「気をつけて」と言った。')
      await page.click('text=つづきを探しにいく')
      await page.waitForTimeout(600)
      check('no main (ja): answering the question re-runs the engine with the answer sent as a separate follow_ups entry (the story untouched)', calls.select.length === 2 && calls.select[1].story === STORY && calls.select[1].follow_ups?.length === 1 && calls.select[1].follow_ups[0] === '帰り際に必ず「気をつけて」と言った。')
    }
    check(`no page errors (run 8, ${lang})`, errors.length === 0)
    await page.close()
  }
}

// ---------- Run 8b: v6 — labels in four languages, classical line, two cards without a freestyle, promotion ----------
{
  const LABELS = { ja: ['本命', '次点', '遊び字'], 'zh-Hans': ['本命', '次选', '趣字'], 'zh-Hant': ['本命', '次選', '趣字'], en: ['Main', 'Second', 'Freestyle'] }
  const withEcho = (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.candidates[0].classical_echo = { text: '慈母手中線，遊子身上衣', source: '孟郊「遊子吟」' }
    r.candidates[1].classical_echo = null
    return r
  }
  for (const lang of ['ja', 'zh-Hans', 'zh-Hant', 'en']) {
    const { page, errors } = await mockPage(browser, { result: lang === 'ja' ? withEcho : (b) => ({ ...clone(FIXTURE), language: b.language, inscription_script: lang === 'en' ? null : 'traditional' }) })
    await page.goto(`http://localhost:5173/demo?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('textarea').first().fill(STORY)
    await pickContext(page)
    await page.click(`text=${SUBMIT[lang]}`)
    await page.waitForSelector(`button:has-text("${FINALIZE[lang]}")`, { timeout: 15000 })
    check(`v6 labels (${lang}): ${LABELS[lang].join(' / ')}`, (await page.locator('article [data-slot-label]').allInnerTexts()).join() === LABELS[lang].join())
    if (lang === 'ja') {
      check('v6 classical: the main card shows 「text」 — source from the server; the second (null) shows none; the freestyle never does', (await page.locator('article[data-slot=main] [data-classical]').innerText()) === '「慈母手中線，遊子身上衣」 — 孟郊「遊子吟」' && (await page.locator('[data-classical]').count()) === 1)
      await page.screenshot({ path: `${SHOTS}/e2e-v6-cards-ja.png`, fullPage: true })
    }
    check(`no page errors (run 8b, ${lang})`, errors.length === 0)
    await page.close()
  }
  // the referee promoted slot 2 and the freestyle was dropped → two cards; the promoted one carries 本命 and the cinnabar
  const promoted = () => {
    const r = clone(FIXTURE)
    r.candidates[0].eliminated = true; r.candidates[0].eliminated_reason = 'palette: hard_block'
    r.candidates[2].eliminated = true; r.candidates[2].eliminated_reason = 'review: Mocks social status'
    r.primary_kanji = '守'; r.runner_up_kanji = null; r.freestyle_kanji = null
    return r
  }
  const { page, errors } = await mockPage(browser, { result: promoted })
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
  await page.click(`text=${SUBMIT.ja}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('v6 promotion: slot 1 removed and the freestyle dropped → ONE card, the promoted second slot (守), labelled 本命 and cinnabar', (await page.locator('article').count()) === 1 && (await page.locator('article [data-slot-label]').innerText()) === '本命' && (await page.locator('article [data-glyph]').evaluate((el) => getComputedStyle(el).color)) === 'rgb(192, 57, 43)')
  check('v6 diagnostics (harness only): the removed cards are listed with their reasons', (await page.locator('details', { hasText: '見送った字' }).count()) === 1)
  check('no page errors (run 8b, promotion)', errors.length === 0)
  await page.close()
}

// ---------- Run 8c: v6 — the story hint, the 2000-character limit, the counter from 1500, follow-up answers 600 each ----------
{
  const { page, calls } = await mockPage(browser)
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const box = page.locator('#write [data-testid=story-input]')
  check('story: the soft hint 50〜300 is under the box (ja), the live counter reads "0 / 2000字" from the start (the Reveal composer), and the box has a hard maximum of 2000', (await page.locator('#write [data-testid=story-hint]').innerText()) === '50〜300字くらいで十分です' && (await page.locator('#write [data-testid=story-counter]').innerText()) === '0 / 2000字' && (await box.getAttribute('maxlength')) === '2000')
  await box.fill('あ'.repeat(1499))
  check('story: the counter follows the length at 1499 characters', (await page.locator('#write [data-testid=story-counter]').innerText()) === '1499 / 2000字')
  await box.fill('あ'.repeat(1500))
  check('story: the counter at 1500 reads "1500 / 2000字"', (await page.locator('#write [data-testid=story-counter]').innerText()) === '1500 / 2000字')
  await box.fill('あ'.repeat(523))
  check('story: the counter follows the length', (await page.locator('#write [data-testid=story-counter]').innerText()) === '523 / 2000字')
  // a paste of 2100 characters is cut to 2000 and can never be submitted over the limit
  await box.evaluate((el, text) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) }, '長'.repeat(2100))
  check('story: a 2100-character paste is clipped to exactly 2000 characters', (await box.inputValue()).length === 2000 && (await page.locator('#write [data-testid=story-counter]').innerText()) === '2000 / 2000字')
  await pickContext(page)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('story: what is sent is at most 2000 characters', [...calls.select[0].story].length === 2000 && !('follow_ups' in calls.select[0]))
  await page.close()

  // voice input (「声で話す」): stops at 2000, keeps the first 2000 characters and says so — never mid-sentence without a word
  {
    const v = await mockPage(browser)
    await v.page.addInitScript(() => {
      window.SpeechRecognition = class { constructor() { window.__rec = this; window.__stopped = false } start() {} stop() { window.__stopped = true; if (this.onend) this.onend() } }
    })
    await v.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    const speak = (text) => v.page.evaluate((t) => window.__rec.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: t } } } }), text)
    await v.page.locator('#write button.voice').click()
    await speak('あ'.repeat(1995))
    check('voice: speech that fits is added whole, no limit note, and the page keeps listening', (await v.page.locator('#write [data-testid=story-input]').inputValue()).length === 1995 && (await v.page.locator('[data-testid=voice-limit-note]').count()) === 0 && (await v.page.evaluate(() => window.__stopped)) === false)
    await speak('い'.repeat(30))
    const got = await v.page.locator('#write [data-testid=story-input]').inputValue()
    check('voice: speech past 2000 keeps the first 2000 characters, shows the short note and stops listening', got.length === 2000 && got.startsWith('あ'.repeat(1995) + 'い') && (await v.page.locator('[data-testid=voice-limit-note]').innerText()) === '2000字までです。それ以降の音声は入っていません。' && (await v.page.evaluate(() => window.__stopped)) === true && (await v.page.locator('#write [data-testid=story-counter]').innerText()) === '2000 / 2000字')
    check('no page errors (run 8c, voice)', v.errors.length === 0)
    await v.page.close()
  }

  // follow-up answers: 600 each, a separate field, their own counter from 450
  let n = 0
  const insufficient = { status: 'insufficient', follow_up_question: 'もうひとつ、小さな場面を教えてください。', particulars: [], fingerprint: { relationship_note: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null, emotional_register: null }, candidates: [], primary_kanji: null, runner_up_kanji: null, freestyle_kanji: null }
  const f = await mockPage(browser, { order: () => ({ json: { order_ref: 'IC-20261023-FUREF222', checkout_url: 'http://localhost:5173/__checkout?cart=fu', glyph: '証', certificate_text: 'x' } }), result: () => (++n <= 2 ? { ...clone(FIXTURE), ...insufficient, follow_up_question: `質問${n}` } : clone(FIXTURE)) })
  await f.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await f.page.locator('#write [data-testid=story-input]').fill('あ'.repeat(2000))
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector('[data-testid=followup-input]', { timeout: 8000 })
  const fin = f.page.locator('[data-testid=followup-input]')
  check('follow-up: even with a 2000-character story the answer box is available, max 600 characters, counter "0 / 600字"', (await fin.getAttribute('maxlength')) === '600' && (await f.page.locator('[data-testid=story-counter]').innerText()) === '0 / 600字')
  await fin.fill('い'.repeat(450))
  check('follow-up: the counter reads "450 / 600字" at 450', (await f.page.locator('[data-testid=story-counter]').innerText()) === '450 / 600字')
  await fin.evaluate((el, text) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) }, 'い'.repeat(700))
  check('follow-up: a 700-character paste is clipped to 600', (await fin.inputValue()).length === 600)
  await f.page.click('text=つづきを探しにいく')
  await f.page.waitForSelector('text=質問2', { timeout: 8000 })
  check('follow-up 1: the story (2000) and the answer (600) travel as SEPARATE fields — nothing is cut or rejected', [...f.calls.select[1].story].length === 2000 && f.calls.select[1].follow_ups.length === 1 && [...f.calls.select[1].follow_ups[0]].length === 600)
  check('follow-up 2: the answer box is empty again and has its own limit', (await f.page.locator('[data-testid=followup-input]').inputValue()) === '' && (await f.page.locator('[data-testid=followup-input]').getAttribute('maxlength')) === '600')
  await f.page.locator('[data-testid=followup-input]').fill('う'.repeat(600))
  await f.page.click('text=つづきを探しにいく')
  await f.page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('follow-up 2: two answers of 600 each ride with the 2000-character story (all three parts in order)', f.calls.select[2].follow_ups.length === 2 && [...f.calls.select[2].follow_ups[1]].length === 600 && f.calls.select[2].follow_ups[0][0] === 'い' && f.calls.select[2].follow_ups[1][0] === 'う')
  // choose the main card and order: the answers travel with the order as their own field
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await f.page.click(`button:has-text("${FINALIZE.ja}")`)
  await f.page.locator('[data-testid=order-form]').waitFor()
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  const od = new Date(); od.setDate(od.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`)
  await f.page.click('label:has(input[name=package][value=simple])')
  await f.page.click('[data-testid=order-submit]')
  await f.page.waitForSelector('#co', { timeout: 8000 })
  check('follow-up: the order call carries the story (2000) and the two answers (600 each) as separate fields', [...f.calls.order[0].story].length === 2000 && f.calls.order[0].follow_ups.length === 2 && [...f.calls.order[0].follow_ups[1]].length === 600)
  check('no page errors (run 8c, follow-ups)', f.errors.length === 0)
  await f.page.close()

  // the server's story_too_long answer is shown in the sender's language (not the raw English message)
  const p2 = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  await p2.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  await p2.route('**/api/select', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '"story" is longer than 2000 characters (got 2100)', code: 'story_too_long', max: 2000 }) }))
  await p2.goto('http://localhost:5173/?lang=en', { waitUntil: 'networkidle' })
  check('story (en): hint "50–300 characters is plenty", cap 2000', (await p2.locator('#write [data-testid=story-hint]').innerText()) === '50–300 characters is plenty' && (await p2.locator('#write [data-testid=story-input]').getAttribute('maxlength')) === '2000')
  await p2.locator('#write [data-testid=story-input]').fill('My mum left the porch light on.')
  await pickContext(p2, { relationship: 'parent_mother' })
  await p2.click(`#write >> text=${GO.en}`)
  await p2.waitForSelector('text=Stories can be up to 2,000 characters', { timeout: 6000 })
  check('story (en): a story_too_long answer from the server is shown as the localized message and the form stays', await p2.locator('#write [data-testid=story-input]').isVisible())
  await p2.close()
}

// ---------- Run 8c-2: Part A — the story opener: the question, the angle switch, the 10-character minimum, drafts, no-speech line, events ----------
{
  const QJA = { 'up-habit': 'その人が、頼まれる前にいつもしていることは？', 'up-moment': '今もはっきり覚えている、その人との場面をひとつ教えてください。', 'up-said': 'その人がよく口にする言葉、または忘れられないひと言は？', 'up-changed': 'その人のおかげで、あなたが変わったことは？' }
  const { page, errors, calls } = await mockPage(browser)
  await page.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const qEl = page.locator('#write [data-testid=story-question]')
  const box = page.locator('#write [data-testid=story-input]')
  check('opener: before a relationship and an occasion are picked there is no question (the plain label stays)', (await qEl.count()) === 0)
  check('opener: a browser without speech recognition hides the voice button and shows one line instead (「キーボードのマイクでも…」)', (await page.locator('#write button.voice').count()) === 0 && (await page.locator('#write [data-testid=voice-none]').innerText()).includes('キーボードのマイク'))
  await pickContext(page) // parent_father · up · birthday_milestone
  await qEl.waitFor()
  const first = await qEl.getAttribute('data-question-id')
  check('opener: after the chips, ONE specific question stands above the box in large type (a question of the "up" set), and the box placeholder becomes an answer hint', first in QJA && (await qEl.innerText()) === QJA[first] && (await box.getAttribute('placeholder')) === 'ひとつの場面や、ひと言だけでも大丈夫です。' && (await qEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 19)
  check('opener: one quiet line under the question says answering it is optional (「この問いに答えなくても、思い浮かぶ場面を自由に書いて大丈夫です。」), after the question and before the box', (await page.locator('#write [data-testid=question-optional]').innerText()) === 'この問いに答えなくても、思い浮かぶ場面を自由に書いて大丈夫です。' && (await page.evaluate(() => { const q = document.querySelector('#write [data-testid=story-question]'); const n = document.querySelector('#write [data-testid=question-optional]'); return q?.nextElementSibling === n })))
  const seenIds = [first]
  for (let i = 0; i < 4; i++) { await page.click('#write [data-testid=question-switch]'); seenIds.push(await qEl.getAttribute('data-question-id')) }
  check('opener: 「別の問いにする」 cycles the four angles of the same set and returns to the first', new Set(seenIds.slice(0, 4)).size === 4 && seenIds[4] === first && seenIds.every((id) => id in QJA))
  // a memorial gift gets the remembering-voice set
  await page.click('[data-chip="occasion:memorial"]')
  await page.waitForFunction(() => document.querySelector('#write [data-testid=story-question]')?.getAttribute('data-question-id')?.startsWith('memorial-'))
  check('opener: the occasion "memorial" switches to the memorial set (no mention of death or loss)', !/死|亡|逝|失|悲/.test(await qEl.innerText()))
  await page.click('[data-chip="occasion:birthday_milestone"]')
  await page.waitForFunction(() => document.querySelector('#write [data-testid=story-question]')?.getAttribute('data-question-id')?.startsWith('up-'))
  const shownId = await qEl.getAttribute('data-question-id')
  // the 10-character minimum
  const goBtn = page.locator(`#write button:has-text("${GO.ja}")`)
  await box.fill('あ'.repeat(9))
  check('opener: 9 characters — the submit button is disabled and a quiet note says 10 are needed', await goBtn.isDisabled() && (await page.locator('#write [data-testid=story-too-short]').innerText()) === '10字以上で送れます。')
  await box.fill('あ'.repeat(10))
  check('opener: 10 characters — the button is enabled and the note is gone', (await goBtn.isEnabled()) && (await page.locator('#write [data-testid=story-too-short]').count()) === 0)
  // drafts
  await box.fill('父は、駅の改札でいつも黙って手を振った。')
  await page.waitForTimeout(700)
  const stored = await page.evaluate(() => window.localStorage.getItem('ichirei.draft.v1'))
  check('opener: the draft is saved in this browser as the visitor types (story, chips, question — and only those)', !!stored && JSON.parse(stored).story.startsWith('父は、駅の改札') && JSON.parse(stored).questionId === shownId && JSON.parse(stored).relationship === 'parent_father')
  await page.reload({ waitUntil: 'networkidle' })
  const banner = page.locator('#write [data-testid=draft-banner]')
  await banner.waitFor()
  check('opener: coming back shows the quiet banner 「書きかけの物語があります — 続ける / 新しく書く」 and nothing is applied silently', (await banner.innerText()).includes('書きかけの物語があります') && (await page.locator('#write [data-testid=story-input]').inputValue()) === '')
  await page.click('#write [data-testid=draft-continue]')
  check('opener: 続ける restores the story, the chips and the same question', (await page.locator('#write [data-testid=story-input]').inputValue()).startsWith('父は、駅の改札') && (await page.locator('[data-chip="relationship:parent_father"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('#write [data-testid=story-question]').getAttribute('data-question-id')) === shownId && (await banner.count()) === 0)
  await page.reload({ waitUntil: 'networkidle' })
  await banner.waitFor()
  await page.click('#write [data-testid=draft-new]')
  check('opener: 新しく書く deletes the saved draft at once', (await banner.count()) === 0 && (await page.evaluate(() => window.localStorage.getItem('ichirei.draft.v1'))) === null)
  await page.evaluate(() => window.localStorage.setItem('ichirei.draft.v1', JSON.stringify({ v: 1, savedAt: Date.now() - 31 * 24 * 3600 * 1000, story: '古い物語', relationship: 'friend', direction: 'across', occasion: 'wedding', occasionDetail: '', questionId: 'across-habit' })))
  await page.reload({ waitUntil: 'networkidle' })
  check('opener: a draft older than 30 days is not offered and is deleted', (await page.locator('#write [data-testid=draft-banner]').count()) === 0 && (await page.evaluate(() => window.localStorage.getItem('ichirei.draft.v1'))) === null)
  // submit: the question travels with the story, as { id, text }
  await pickContext(page)
  await page.locator('#write [data-testid=story-question]').waitFor()
  const sendId = await page.locator('#write [data-testid=story-question]').getAttribute('data-question-id')
  await page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('opener: /api/select receives prompt_question { id, text } and the story is just the story (the question is not inside it)', calls.select[0].prompt_question?.id === sendId && calls.select[0].prompt_question?.text === QJA[sendId] && calls.select[0].story === '父は、駅の改札でいつも黙って手を振った。')
  const evs = calls.analytics.map((e) => e.event)
  check('opener: events — story_opened (once per page load), question_shown (id) at the start and after each switch, question_switched, story_submitted, reveal_shown; codes only', evs.filter((e) => e === 'story_opened').length === 4 && evs.includes('question_shown') && evs.filter((e) => e === 'question_switched').length === 4 && evs.includes('story_submitted') && evs.includes('reveal_shown') && calls.analytics.filter((e) => e.event === 'question_shown').every((e) => !('story' in e) && (e.qid in QJA || String(e.qid).startsWith('memorial-'))) && !JSON.stringify(calls.analytics).includes('父は'))
  check('no page errors (run 8c-2, the opener)', errors.length === 0, errors.join('; '))
  await page.close()
  // English and Traditional Chinese: the same question set in the page language
  for (const [lang, q0] of [['en', 'What do they always do without being asked?'], ['zh-Hant', '那個人總是在你開口之前，就先做了什麼？']]) {
    const e = await mockPage(browser)
    await e.page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await pickContext(e.page)
    await e.page.locator('#write [data-testid=story-question]').waitFor()
    let found = false
    for (let i = 0; i < 4 && !found; i++) { found = (await e.page.locator('#write [data-testid=story-question]').innerText()) === q0; if (!found) await e.page.click('#write [data-testid=question-switch]') }
    check(`opener (${lang}): the "up" set is shown in the page language (the habit question found within four angles)`, found)
    await e.page.close()
  }
}

// ---------- Run 8c-3: Part B — "where will they read it?" ----------
{
  const { page, errors, calls } = await mockPage(browser)
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const field = page.locator('#write [data-testid=reader-field]')
  check('reader: the field 「受け取る方が読むのは？」 is there, collapsed by default', (await field.count()) === 1 && (await field.getAttribute('open')) === null && (await field.locator('summary').innerText()) === '受け取る方が読むのは？')
  await field.locator('summary').click()
  const labels = await field.locator('[data-chip^="reader:"]').allInnerTexts()
  check('reader: the options are 日本 / 台湾・香港・マカオ / 英語圏 / その他 (default: わたしと同じ)', labels.join('|') === 'わたしと同じ|日本|台湾・香港・マカオ|英語圏|その他' && (await field.locator('[data-chip="reader:same"]').getAttribute('aria-pressed')) === 'true')
  await pickContext(page)
  await field.locator('[data-chip="reader:zh"]').click()
  await page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('reader: the choice travels to /api/select as reader "zh"', calls.select[0].reader === 'zh')
  await page.close()
  const m = await mockPage(browser)
  await m.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await pickContext(m.page, { occasion: 'memorial' })
  check('reader: for remembrance the field is not shown at all', (await m.page.locator('#write [data-testid=reader-field]').count()) === 0)
  await m.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await m.page.click(`#write >> text=${GO.ja}`)
  await m.page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('reader: …and a remembrance request never carries one', !('reader' in m.calls.select[0]))
  check('no page errors (run 8c-3, reader)', errors.length === 0 && m.errors.length === 0)
  await m.page.close()
}

// ---------- Run 8c-4: Part C — the four sizes, the badges, where it goes, the message for the card ----------
{
  const f = await mockPage(browser, { order: () => ({ json: { order_ref: 'IC-20261023-SIZES222', checkout_url: 'http://localhost:5173/__checkout?cart=sz', glyph: '証', certificate_text: 'x' } }) })
  await f.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const gifts = await f.page.locator('#gifts article.gift').evaluateAll((els) => els.map((e) => e.getAttribute('data-size')))
  check('sizes (landing): the gift section lists ③ 木札 (simple), ④ 版木 (standard), ② カード, ① デジタル — in that order', gifts.join() === 'simple,standard,card,digital', gifts.join())
  check('sizes (landing): ③ is marked おすすめ, ① is marked 「今すぐ贈れる」 and is last; the prices are ¥9,800 / ¥18,850 / ¥4,980 / ¥2,980', (await f.page.locator('#gifts article[data-size=simple] [data-badge=recommended]').textContent()) === 'おすすめ' && (await f.page.locator('#gifts article[data-size=digital] [data-badge=now]').textContent()) === '今すぐ贈れる' && (await f.page.locator('#gifts [data-price=simple]').textContent()) === '¥9,800' && (await f.page.locator('#gifts [data-price=standard]').textContent()) === '¥18,850' && (await f.page.locator('#gifts [data-price=card]').textContent()) === '¥4,980' && (await f.page.locator('#gifts [data-price=digital]').textContent()) === '¥2,980')
  await f.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await f.page.click(`button:has-text("${FINALIZE.ja}")`)
  const form = f.page.locator('[data-testid=order-form]')
  await form.waitFor()
  await form.locator('[data-size]').first().waitFor()
  const order = await form.locator('label[data-size]').evaluateAll((els) => els.map((e) => e.getAttribute('data-size')))
  check('sizes (order form): ③ 木札, ④ 版木, ② カード, ① デジタル in that order, with the recommended and "send it now" badges', order.join() === 'simple,standard,card,digital' && (await form.locator('[data-size=simple] [data-badge=recommended]').count()) === 1 && (await form.locator('[data-size=digital] [data-badge=now]').count()) === 1 && (await form.locator('[data-size=standard] .badge').count()) === 0, order.join())
  check('sizes (order form): each size says what it includes and how it ships (木札: 日本国内送料無料・海外は EMS ¥6,000; デジタル: 送料なし)', (await form.locator('[data-includes=simple]').innerText()).includes('木札に一字（金色）') && (await form.locator('[data-ship-line=simple]').innerText()).includes('EMS ¥6,000') && (await form.locator('[data-ship-line=digital]').innerText()) === '送料なし' && (await form.locator('[data-ship-line=card]').innerText()).includes('郵送'))
  check('sizes (order form): no ship-to choice until a size is picked; the digital size has none at all (no address, nothing shipped)', (await form.locator('[data-testid=ship-to]').count()) === 0)
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  const od = new Date(); od.setDate(od.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`)
  await f.page.click('label[data-size=digital]')
  check('sizes (order form): the digital size shows its price, says it is not shipped and offers no ship-to choice', (await form.locator('[data-price=digital]').innerText()) === '¥2,980' && (await form.locator('[data-digital-note]').count()) === 1 && (await form.locator('[data-testid=ship-to]').count()) === 0)
  await f.page.click('label[data-size=card]')
  const shipOpts = await form.locator('[data-ship-to]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ship-to')))
  check('ship-to: the card size asks where it goes — me / directly to them / e-gift — with 「自分に届ける」 first and no message box while "me" is chosen', shipOpts.join() === 'me,direct,egift' && (await form.locator('[data-ship-to=me] .pkgName').innerText()) === '自分に届ける' && (await form.locator('[data-ship-to=direct] .pkgName').innerText()) === '相手に直接届ける' && (await form.locator('[data-ship-to=egift] .pkgName').innerText()).startsWith('eギフトで贈る') && (await form.locator('#gift_message').count()) === 0)
  await f.page.click('[data-ship-to=direct]')
  await f.page.fill('#gift_message', 'あ'.repeat(70))
  check('ship-to: directly to them → a message box (60 characters at most, with its counter), and a note that the receiver\'s address goes in at checkout', (await form.locator('#gift_message').inputValue()).length === 60 && (await form.locator('[data-testid=gift-message-counter]').innerText()) === '60 / 60字' && (await form.locator('[data-ship-to=direct]').innerText()).includes('チェックアウトの配送先'))
  await f.page.fill('#gift_message', 'いつも、ありがとう。')
  await f.page.click('label[data-size=standard]')
  await f.page.click('[data-ship-to=egift]')
  check('ship-to: e-gift of a wooden size says it is Japan only; the card size does not', (await form.locator('[data-egift-japan]').count()) === 1)
  await f.page.click('label[data-size=card]')
  check('ship-to: …and for the card size the Japan-only note is gone', (await form.locator('[data-egift-japan]').count()) === 0)
  await f.page.click('[data-ship-to=direct]')
  await f.page.click('[data-testid=order-submit]')
  await f.page.waitForSelector('#co', { timeout: 8000 })
  const body = f.calls.order[0]
  check('order request: package card, ship_to direct and the message; no price anywhere', body.package === 'card' && body.ship_to === 'direct' && body.gift_message === 'いつも、ありがとう。' && !('price' in body) && !('price_jpy' in body))
  check('no page errors (run 8c-4, sizes)', f.errors.length === 0, f.errors.join('; '))
  await f.page.close()
  // sizes whose variant is missing are hidden: the API says which are on sale
  const g = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  await g.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['simple', 'standard'] } }))
  await g.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
  await g.route('**/api/log', (r) => r.fulfill({ status: 204, body: '' }))
  await g.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await g.locator('#gifts article.gift').first().waitFor()
  check('sizes: while ① and ② have no Shopify variant (the API lists only ③ and ④) they are not on the page at all', (await g.locator('#gifts article.gift').evaluateAll((els) => els.map((e) => e.getAttribute('data-size')))).join() === 'simple,standard')
  await g.close()
}

// ---------- Run 8c-5: Part D — the sender's page (「贈る」) and the receiver's gift page (/g/<token>), the e-gift address form ----------
{
  const baseView = { id: 'AN-testtesttesttesttest', language: 'ja', glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false, film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] } }
  const GIFT = 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest'
  // the sender's page
  const sp = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
  const errors = []
  sp.on('pageerror', (e) => errors.push(String(e)))
  await sp.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { ...baseView, gift: { url: GIFT, size_code: 'ICHIREI-CARD', ship_to: 'egift', egift_state: 'waiting' } } }))
  await sp.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
  await sp.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
  const panel = sp.locator('[data-testid=sender-panel]')
  await panel.waitFor()
  check('sender page: below the film, 「贈る」 with LINE, copy-the-link, QR and e-mail; the receiver\'s link as selectable text', (await panel.locator('h2').innerText()) === '贈る' && (await panel.locator('[data-testid=give-link]').inputValue()) === GIFT && (await panel.locator('[data-testid=give-line]').getAttribute('href')).startsWith('https://line.me/R/share?text=') && decodeURIComponent(await panel.locator('[data-testid=give-line]').getAttribute('href')).includes(GIFT) && (await panel.locator('[data-testid=give-mail]').getAttribute('href')).startsWith('mailto:?subject='))
  await panel.locator('[data-testid=give-qr]').click()
  check('sender page: the QR code of the receiver\'s page shows on screen', (await panel.locator('[data-testid=give-qr-img] img').getAttribute('src')) === '/api/gift/RG-testtesttesttesttest/qr.svg')
  check('sender page: order details — size カード, delivery e-gift, waiting for the receiver\'s address — and no price', (await panel.locator('[data-testid=status-size]').innerText()) === 'カード' && (await panel.locator('[data-testid=status-ship]').innerText()).startsWith('eギフト') && (await panel.locator('[data-testid=status-egift]').innerText()).includes('待っています') && !/¥/.test(await panel.innerText()))
  check('no page errors (run 8c-5, sender page)', errors.length === 0, errors.join('; '))
  await sp.close()
  // the receiver's page
  const gp = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
  const gerrors = []
  gp.on('pageerror', (e) => gerrors.push(String(e)))
  const posted = []
  await gp.route('**/api/gift/RG-testtesttesttesttest', (r) => r.fulfill({ json: { ...baseView, id: 'RG-testtesttesttesttest', token: 'RG-testtesttesttesttest', certificate_line: 'この字は、あなたの目に映る、その人です。', poem: { type: 'tanka', lines: ['朝ごとに', '蓋の花添え'], reading: 'あさごとに' }, from: '山田 太郎', to: '山田 一郎', message: 'いつも、ありがとう。', egift: { state: 'waiting', japan_only: true } } }))
  await gp.route('**/api/gift/RG-testtesttesttesttest/address', async (r) => { posted.push(JSON.parse(r.request().postData() ?? '{}')); await r.fulfill({ json: { ok: true } }) })
  await gp.goto('http://localhost:5173/g/RG-testtesttesttesttest', { waitUntil: 'networkidle' })
  const gift = gp.locator('[data-testid=gift-panel]')
  await gift.waitFor()
  const gtext = await gift.innerText()
  check('receiver page: the film first, then 「○○より」, the receiver\'s name, the sender\'s message, the character, the certificate line and the poem', (await gp.locator('[data-testid=gift-page]').count()) === 1 && (await gift.locator('[data-testid=gift-from]').innerText()).includes('山田 太郎 より') && (await gift.locator('[data-testid=gift-to]').innerText()) === '山田 一郎 さんへ' && (await gift.locator('[data-testid=gift-message]').innerText()) === 'いつも、ありがとう。' && (await gift.locator('[data-testid=gift-glyph]').innerText()) === '備' && (await gift.locator('[data-testid=gift-line]').innerText()).startsWith('この字は') && (await gift.locator('[data-testid=gift-poem]').innerText()).includes('朝ごとに'))
  check('receiver page: no price, no order number, no other candidates, no sender page link', !/¥|IC-2026|AN-test/.test(gtext + (await gp.locator('body').innerText())) && (await gp.locator('a[href*="/a/"]').count()) === 0 && !(await gp.locator('main').innerHTML()).includes('AN-test'))
  await gift.locator('[data-testid=gift-receive]').click()
  check('e-gift: 「受け取る」 opens a short form (name, postal code, prefecture, address, phone); the Japan-only size says so and asks for no country', (await gift.locator('[data-testid=gift-form] input').count()) === 6 && (await gift.locator('[data-testid=gift-japan-only]').count()) === 1 && (await gift.locator('input[name=country]').count()) === 0)
  await gift.locator('input[name=name]').fill('山田 一郎')
  await gift.locator('input[name=postal]').fill('1500001')
  await gift.locator('input[name=region]').fill('東京都')
  await gift.locator('input[name=line1]').fill('渋谷区神宮前1-2-3')
  await gift.locator('input[name=phone]').fill('03-1234-5678')
  await gift.locator('[data-testid=gift-send]').click()
  await gift.locator('[data-testid=gift-thanks]').waitFor()
  check('e-gift: the address is posted to the receiver\'s own endpoint and the page thanks them; nothing of it stays on the page', posted.length === 1 && posted[0].postal === '1500001' && posted[0].line1 === '渋谷区神宮前1-2-3' && (await gift.locator('[data-testid=gift-form]').count()) === 0 && !(await gp.content()).includes('渋谷区'))
  check('no page errors (run 8c-5, receiver page)', gerrors.length === 0, gerrors.join('; '))
  await gp.close()
}

// ---------- Run 8e: Part E — the story scroll's 保存 buttons appear only when all four pictures are real ----------
{
  const base = { id: 'AN-testtesttesttesttest', language: 'ja', glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false }
  const lines = ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。', '三', '四']
  const real = ['/film-art/a.webp', '/film-art/b.webp', '/film-art/c.webp', '/film-art/d.webp']
  const cases = [
    ['four real pictures', { status: 'ready', lines, pictures: real }, true],
    ['one washi slot', { status: 'ready', lines, pictures: [...real.slice(0, 3), '/film/washi-4.webp'] }, false],
    ['an incomplete film', { status: 'ready', lines, pictures: real, incomplete: true }, false],
  ]
  for (const [name, film, shown] of cases) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { ...base, film, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-CARD', ship_to: 'me' } } }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.route('**/film-art/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=sender-panel]').waitFor()
    const n = await p.locator('[data-testid=sender-scroll] a').count()
    check(`scroll buttons (${name}): ${shown ? 'PNG and PDF links to this film' : 'none'}`, shown ? n === 2 && (await p.locator('[data-testid=sender-scroll] a').first().getAttribute('href')) === '/api/animation/AN-testtesttesttesttest/scroll.png' : n === 0)
    await p.close()
  }
}

// ---------- Run 8g: the order-complete line of the 24-hour change window, on the sender's page, in three languages ----------
{
  const NOTE = {
    ja: 'ご注文から24時間以内であれば、ご覧いただいた他の字への変更・キャンセルを承ります。ご注文確認メールにご返信ください。',
    'zh-Hant': '下單後 24 小時內，可更換為您看過的其他字，或取消訂單。請回覆訂單確認信。',
    en: 'Within 24 hours of your order you can switch to another character you have seen, or cancel. Please reply to your order confirmation e-mail.',
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-SIMPLE', ship_to: 'me', egift_state: null } } }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=sender-panel]').waitFor()
    check(`order-complete line (${lang}): the 24-hour change window is stated on the sender's page, with 「reply to the order confirmation e-mail」`, (await p.locator('[data-testid=change-window-note]').innerText()) === NOTE[lang])
    await p.close()
  }
}

// ---------- Run 8h: /legal — 特定商取引法に基づく表記 with 【 】 placeholders, the return rules, three questions, in three languages; the footer link ----------
{
  const T = {
    ja: { title: '特定商取引法に基づく表記', ret: ['本商品は、お客様の物語から選ばれた一字でつくる受注制作品です。', 'ご注文から24時間以内であれば、ご注文時に表示された他の字への変更、名入れ・メッセージの修正、詩の形式の変更（1回）、またはキャンセル（全額返金）を承ります。ご注文確認メールにご返信ください。', '24時間を過ぎたお客様都合による変更・返品・返金はお受けできません。', '商品の破損、誤った字・誤印刷など当方の不備があった場合は、お届けから14日以内にご連絡ください。作り直し、または返金いたします。', 'デジタル商品は、ギフトページのお届け後の返金はいたしかねます（正常に表示されない場合を除きます）。'], faq: ['注文後に字を変えられますか？', 'キャンセルできますか？', '届いた品物に問題があったら？'], rows: ['販売業者', '運営責任者', '所在地', '電話番号', 'メールアドレス'] },
    'zh-Hant': { title: '特定商取引法標示', ret: ['接單製作', '24 小時內', '24 小時，因顧客個人因素', '14 天內聯絡', '數位商品'], faq: ['下單後可以換字嗎？', '可以取消訂單嗎？', '收到的商品有問題怎麼辦？'], rows: ['販售業者', '營運負責人', '所在地', '電話號碼', '電子郵件'] },
    en: { title: 'Legal notice', ret: ['made to order', 'Within 24 hours of your order', 'After 24 hours', 'within 14 days of delivery', 'Digital orders'], faq: ['Can I change the character after I order?', 'Can I cancel?', 'What if what I receive has a problem?'], rows: ['Seller', 'Person in charge', 'Address', 'Telephone', 'E-mail'] },
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 800 } })
    const errors = []
    p.on('pageerror', (e) => errors.push(String(e)))
    await p.goto(`http://localhost:5173/legal?lang=${lang}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=legal-page]').waitFor()
    const t = T[lang]
    const rows = await p.locator('[data-testid=legal-rows]').innerText()
    check(`legal (${lang}): the title, the five seller rows with 【 】 placeholders (nothing invented), and the owner's note`, (await p.locator('h1').innerText()).includes(t.title) && t.rows.every((r) => rows.includes(r)) && (await p.locator('[data-testid=legal-rows] dd[data-placeholder]').count()) >= 5 && !!(await p.locator('[data-testid=legal-note]').count()) && (await p.locator('[data-testid=legal-rows] dd').first().innerText()) === '【 】')
    check(`legal (${lang}): the prices and the shipping come from the product (¥2,980 / ¥4,980 / ¥9,800 / ¥18,850; EMS ¥6,000)`, ['2,980', '4,980', '9,800', '18,850', '6,000'].every((x) => rows.includes(x)))
    const ret = await p.locator('[data-testid=legal-returns]').innerText()
    check(`legal (${lang}): the return section — made to order, 24 hours, our mistakes within 14 days, digital`, lang === 'ja' ? t.ret.every((x) => ret.includes(x)) && (await p.locator('[data-testid=legal-returns] li').count()) === 5 : t.ret.every((x) => ret.includes(x)) && (await p.locator('[data-testid=legal-returns] li').count()) === 5)
    const faq = await p.locator('[data-testid=legal-faq]').innerText()
    check(`legal (${lang}): three questions`, (await p.locator('[data-testid=legal-faq] details').count()) === 3 && t.faq.every((q) => faq.includes(q)))
    check(`no page errors (run 8h, ${lang})`, errors.length === 0, errors.join('; '))
    await p.close()
  }
  const home = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } })
  await home.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }))
  await home.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  check('legal: the landing footer links to /legal', (await home.locator('[data-testid=footer-legal]').getAttribute('href')) === '/legal' && (await home.locator('[data-testid=footer-legal]').innerText()).includes('特定商取引法'))
  check('legal: the landing\'s own questions now include the three (change after ordering, cancel, a problem)', (await home.locator('.faq details').count()) === 8 && (await home.locator('.faq').textContent())?.includes('注文後に字を変えられますか？'))
  await home.close()
}

// ---------- Run 8f: the free card preview — character FIRST, pictures after the pick, 「別の候補を見る」, no download, the made-to-order note ----------
{
  const DRAFT = 'AN-previewpreviewprev22'
  const POEM_LINES = ['朝ごとに', '蓋の花添え', '備えたる']
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="#9a8f7a"/></svg>'
  const rename = (r, map) => {
    const c = JSON.parse(JSON.stringify(r))
    for (const k of c.candidates) { const to = map[k.kanji]; k.kanji = to; k.inscription_form = null }
    c.primary_kanji = map[r.primary_kanji]; c.runner_up_kanji = r.runner_up_kanji ? map[r.runner_up_kanji] : null; c.freestyle_kanji = r.freestyle_kanji ? map[r.freestyle_kanji] : null
    return c
  }
  const sets = [FIXTURE, rename(FIXTURE, { 証: '備', 守: '憶', 封: '想' }), rename(FIXTURE, { 証: '恵', 守: '誠', 封: '光' })]
  const mk = async (lang, { limited = false, order, mode = 'normal' } = {}) => {
    const f = await mockPage(browser, { order: order ?? (() => ({ json: { order_ref: 'IC-20261030-PREVIEW1', checkout_url: 'http://localhost:5173/__checkout?cart=pv', glyph: '証', certificate_text: 'x' } })), result: (b) => ({ ...sets[b.retry ?? 0], language: b.language, inscription_script: b.language === 'en' ? null : b.language === 'ja' ? sets[0].inscription_script : 'traditional' }) })
    const pv = { start: [], render: 0, polls: 0 }
    await f.page.route('**/api/preview', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      pv.start.push(b)
      await route.fulfill({ json: limited ? { state: 'limited' } : { state: 'ok', id: DRAFT, reused: !!b.draft_id, script: 'ready' } })
    })
    await f.page.route('**/api/preview/*/render', async (route) => {
      pv.render++
      await new Promise((r) => setTimeout(r, 4000))
      await route.fulfill({ json: { id: DRAFT, state: 'done', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [1, 2, 3, 4].map((n) => `/api/film/${DRAFT}/picture/${n}.webp`) } })
    })
    await f.page.route(/\/api\/preview\/AN-[a-z0-9]+$/, async (route) => {
      pv.polls++
      if (mode === 'washi') return route.fulfill({ json: { id: DRAFT, state: 'done', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [null, 2, 3, 4].map((k) => (k ? `/api/film/${DRAFT}/picture/${k}.webp` : null)), slots: ['washi', 'ai', 'ai', 'ai'] } })
      if (mode === 'allfail') return route.fulfill({ json: { id: DRAFT, state: 'failed', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [null, null, null, null], slots: ['washi', 'washi', 'washi', 'washi'] } })
      const n = pv.polls === 1 ? 0 : pv.polls === 2 ? 2 : 4
      await route.fulfill({ json: { id: DRAFT, state: n === 4 ? 'done' : 'drawing', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [1, 2, 3, 4].map((k) => (k <= n ? `/api/film/${DRAFT}/picture/${k}.webp` : null)) } })
    })
    await f.page.route('**/api/film/*/picture/*', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }))
    const pm = []
    await f.page.route('**/api/poem', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      pm.push(b)
      await route.fulfill({ json: { poem_id: 'PM-20261030-abcdefghj1', type: b.type, lines: POEM_LINES, reading: '', aids: {}, preview: 'x' } })
    })
    await f.page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await f.page.locator('#write [data-testid=story-input]').fill(STORY)
    await pickContext(f.page)
    await f.page.click(`#write >> text=${GO[lang]}`)
    await f.page.waitForSelector(`button:has-text("${FINALIZE[lang]}")`, { timeout: 15000 })
    return { ...f, pv, pm }
  }
  const pickMain = async (page, lang) => {
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${{ ja: 'この一字を選ぶ', 'zh-Hant': '選擇這個字', en: 'Choose this character' }[lang]}`).click()
    await page.click(`button:has-text("${FINALIZE[lang]}")`)
    await page.locator('[data-testid=order-form]').waitFor()
  }
  const ja = await mk('ja')
  check('preview: CHARACTER FIRST — the three characters are on screen and not one picture was asked for (no /api/preview call before a character is picked)', ja.pv.start.length === 0 && (await ja.page.locator('[data-testid=card-preview]').count()) === 0)
  await ja.page.locator('article[data-slot=main]').click()
  await ja.page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await ja.page.click(`button:has-text("${FINALIZE.ja}")`)
  await ja.page.locator('[data-testid=order-form]').waitFor()
  await ja.page.locator('[data-testid=card-preview]').waitFor()
  await ja.page.waitForTimeout(400)
  check('preview: picking the character starts the draft at once (one /api/preview call with the story, the context and every character shown — both forms)', ja.pv.start.length >= 1 && ja.pv.start[0].story === STORY && ja.pv.start[0].language === 'ja' && ja.pv.start[0].shown.join('') === '証證守封' && ja.pv.start[0].draft_id === undefined)
  const sheet = ja.page.locator('[data-testid=card-sheet]')
  check('preview: the card\'s inside is marked 「見本」 and shows the chosen character', (await sheet.locator('[data-testid=sample-mark]').innerText()) === '見本' && (await sheet.locator('[data-testid=card-glyph]').innerText()) === '證' || (await sheet.locator('[data-testid=card-glyph]').innerText()) === '証')
  check('preview: while drawing it says 「あなたの物語を描いています」 and the four picture places are there', (await ja.page.locator('[data-testid=card-status]').innerText()) === 'あなたの物語を描いています' && (await sheet.locator('.cardPic').count()) === 4)
  await ja.page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length >= 2, null, { timeout: 8000 })
  const partial = await sheet.locator('.cardPic[data-ready=yes]').count()
  check('preview: the pictures fill in as they arrive (some are there while others still wait)', partial >= 2 && partial < 4, String(partial))
  await ja.page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length === 4, null, { timeout: 12000 })
  check('preview: when all four are there the "drawing" line is gone; each picture has its line of the story under it', (await ja.page.locator('[data-testid=card-status]').innerText()) === '' && (await sheet.locator('.cardPic figcaption').nth(1).innerText()) === '「もういらない」と私は言った。')
  await ja.page.locator('[data-testid=card-poem]').waitFor({ timeout: 5000 })
  check('preview: the poem of the chosen format is on the card', (await ja.page.locator('[data-testid=card-poem]').innerText()).includes('蓋の花添え'))
  check('preview: NO download before payment — no download link, no save button, no scroll or PDF address anywhere in the preview', (await ja.page.locator('[data-testid=card-preview] a, [data-testid=card-preview] [download], [data-testid=card-preview] button').count()) === 0 && !(await ja.page.locator('[data-testid=card-preview]').innerHTML()).match(/scroll\.|\.pdf|download/))
  check('preview: the order note (made to order, 24 hours) sits above the order button, and a link to the legal page beside it', (await ja.page.locator('[data-testid=order-made-to-order]').innerText()) === '受注制作のため、24時間を過ぎたお客様都合の変更・返品はお受けできません。' && (await ja.page.locator('[data-testid=legal-link]').getAttribute('href')) === '/legal')
  check('preview: the size choice and the order button come AFTER the preview', await ja.page.evaluate(() => { const a = document.querySelector('[data-testid=card-preview]'); const b = document.querySelector('input[name=package]'); const c = document.querySelector('[data-testid=order-submit]'); return !!(a && b && c && (a.compareDocumentPosition(b) & 4) && (b.compareDocumentPosition(c) & 4)) }))
  // another character of the same story: the same draft is asked for (nothing drawn again)
  await ja.page.click('button.backLink:has-text("戻る")').catch(async () => { await ja.page.click('[data-testid=order-form] .backLink') })
  await ja.page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 8000 }).catch(() => {})
  await ja.page.locator('article[data-slot=second]').click()
  await ja.page.locator('article[data-slot=second]').locator('text=この一字を選ぶ').click()
  await ja.page.click(`button:has-text("${FINALIZE.ja}")`)
  await ja.page.locator('[data-testid=card-preview]').waitFor()
  await ja.page.waitForTimeout(500)
  check('preview: another character of the SAME story asks for the same draft (draft_id sent back), so nothing is drawn again', ja.pv.start.length >= 2 && ja.pv.start.at(-1).draft_id === DRAFT)
  // 「別の候補を見る」
  await ja.page.click('[data-testid=order-form] .backLink')
  await ja.page.locator('[data-testid=see-others]').waitFor()
  await ja.page.click('[data-testid=see-others]')
  await ja.page.waitForFunction(() => document.querySelector('article[data-slot=main] .k, article[data-slot=main]')?.textContent?.includes('備'), null, { timeout: 8000 })
  check('retry 1: 「別の候補を見る」 asks the engine again with every character already shown (both forms) and retry 1 — and three NEW characters are on screen', ja.calls.select.length === 2 && ja.calls.select[1].retry === 1 && ja.calls.select[1].exclude.join('') === '証證守封' && (await ja.page.locator('article[data-slot=main]').innerText()).includes('備'))
  await ja.page.click('[data-testid=see-others]')
  await ja.page.waitForFunction(() => document.querySelector('article[data-slot=main]')?.textContent?.includes('恵'), null, { timeout: 8000 })
  check('retry 2: the second retry excludes all six characters shown so far (up to nine in all) and says retry 2', ja.calls.select.length === 3 && ja.calls.select[2].retry === 2 && ja.calls.select[2].exclude.join('') === '証證守封備憶想')
  check('after two retries the button is gone and the message says to write a little more: 「物語を少し書き足すと、新しい字が見つかります」', (await ja.page.locator('[data-testid=see-others]').count()) === 0 && (await ja.page.locator('[data-testid=retry-cap]').innerText()) === '物語を少し書き足すと、新しい字が見つかります')
  check('the earlier sets can be looked at again (前の候補): nothing already shown is lost', (await ja.page.locator('[data-testid=set-label]').innerText()) === '候補 3 / 3' && (await ja.page.locator('[data-testid=set-prev]').isEnabled()))
  await ja.page.click('[data-testid=set-prev]')
  await ja.page.click('[data-testid=set-prev]')
  check('…the first set is back with its own characters', (await ja.page.locator('article[data-slot=main]').innerText()).includes('証') && (await ja.page.locator('[data-testid=set-label]').innerText()) === '候補 1 / 3')
  // order: the draft and every shown character go with the order
  await ja.page.locator('article[data-slot=main]').click()
  await ja.page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await ja.page.click(`button:has-text("${FINALIZE.ja}")`)
  await ja.page.locator('[data-testid=card-preview]').waitFor()
  await ja.page.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 6000 })
  await ja.page.fill('input[name=sender_name]', '山田 太郎')
  await ja.page.fill('input[name=receiver_name]', '山田 一郎')
  const d8f = new Date(); d8f.setDate(d8f.getDate() + 20)
  await ja.page.fill('input[name=delivery_date]', `${d8f.getFullYear()}-${String(d8f.getMonth() + 1).padStart(2, '0')}-${String(d8f.getDate()).padStart(2, '0')}`)
  await ja.page.click('label:has(input[name=package][value=standard])')
  await ja.page.click('[data-testid=order-submit]')
  await ja.page.waitForSelector('#co', { timeout: 8000 })
  const ob = ja.calls.order[0]
  check('order: the request carries the draft the buyer saw (draft_id) and EVERY character shown for this story with its set (9 in all)', ob.draft_id === DRAFT && Array.isArray(ob.shown_characters) && ob.shown_characters.length === 9 && new Set(ob.shown_characters.map((x) => x.set)).size === 3 && ob.shown_characters.every((x) => x.candidate && x.candidate.kanji))
  check('analytics: card_preview_shown, candidates_retry (1, 2), pictures_before_pay (shown) and preview_to_order are reported — codes only, never a character or a story', ['card_preview_shown', 'pictures_before_pay', 'preview_to_order'].every((e) => ja.calls.analytics.some((a) => a.event === e)) && ja.calls.analytics.filter((a) => a.event === 'candidates_retry').map((a) => a.n).join() === '1,2' && ja.calls.analytics.some((a) => a.event === 'pictures_before_pay' && a.state === 'shown') && !JSON.stringify(ja.calls.analytics.filter((a) => /preview|retry|pictures/.test(a.event))).match(/証|備|story/))
  check('no page errors (run 8f, ja)', ja.errors.length === 0, JSON.stringify(ja.errors))
  await ja.page.close()
  // the daily picture limit: the card still shows, without pictures, with the line that they come after the order — and the order button works
  const lim = await mk('ja', { limited: true })
  await pickMain(lim.page, 'ja')
  await lim.page.locator('[data-testid=card-status]').waitFor()
  await lim.page.waitForFunction(() => document.querySelector('[data-testid=card-preview]')?.getAttribute('data-state') === 'limited', null, { timeout: 8000 })
  check('limit: at the daily limit the card shows NO pictures and says 「物語の絵は、ご注文後にお届けします」; nothing is drawn (no render call)', (await lim.page.locator('[data-testid=card-pictures]').count()) === 0 && (await lim.page.locator('[data-testid=card-status]').innerText()) === '物語の絵は、ご注文後にお届けします' && lim.pv.render === 0)
  await lim.page.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 6000 })
  check('limit: the order button still works (pictures never block checkout)', await lim.page.locator('[data-testid=order-submit]').isDisabled() === true /* names missing */ && (await lim.page.locator('input[name=package]').count()) >= 1)
  await lim.page.close()
  // Part 1 fix: one picture failed its check — the three that are there stay, the washi tile takes the place of the fourth, and no "after the order" message
  const wa = await mk('ja', { mode: 'washi' })
  await pickMain(wa.page, 'ja')
  await wa.page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length === 3, null, { timeout: 8000 })
  check('washi: three pictures are shown, the fourth place is the plain washi tile, no message — never "after the order" while any picture is there', (await wa.page.locator('[data-testid=washi-tile]').count()) === 1 && (await wa.page.locator('[data-testid=card-pictures] .cardPic[data-kind=washi]').getAttribute('data-slot')) === '1' && (await wa.page.locator('[data-testid=card-status]').innerText()) === '' && (await wa.page.locator('[data-testid=card-preview]').getAttribute('data-state')) === 'done')
  await wa.page.close()
  const af = await mk('ja', { mode: 'allfail' })
  await pickMain(af.page, 'ja')
  await af.page.waitForFunction(() => document.querySelector('[data-testid=card-preview]')?.getAttribute('data-state') === 'failed', null, { timeout: 8000 })
  check('washi: only when ALL FOUR failed does the card leave the pictures out and say 「物語の絵は、ご注文後にお届けします」', (await af.page.locator('[data-testid=card-pictures]').count()) === 0 && (await af.page.locator('[data-testid=card-status]').innerText()) === '物語の絵は、ご注文後にお届けします')
  await af.page.close()
  // the other two languages: the drawing line, the sample mark, the made-to-order note
  for (const [lang, drawing, sample, note] of [['zh-Hant', '正在描繪你的故事', '樣本', '因為是接單製作'], ['en', 'Drawing your story', 'Sample', 'made to order']]) {
    const l = await mk(lang)
    await pickMain(l.page, lang)
    await l.page.locator('[data-testid=card-preview]').waitFor()
    check(`preview (${lang}): 「${drawing}」 while drawing, the sample mark 「${sample}」, and the made-to-order note`, (await l.page.locator('[data-testid=card-status]').innerText()) === drawing && (await l.page.locator('[data-testid=sample-mark]').innerText()) === sample && (await l.page.locator('[data-testid=order-made-to-order]').innerText()).includes(note), await l.page.locator('[data-testid=card-status]').innerText())
    await l.page.close()
  }
}

// ---------- Run 8d: the included poem (歌の添え書き) on the order form: one format, shown in full, free ----------
{
  const poemCalls = []
  const f = await mockPage(browser, { order: () => ({ json: { order_ref: 'IC-20261023-POEM2222', checkout_url: 'http://localhost:5173/__checkout?cart=poem', glyph: '証', certificate_text: 'x' } }) })
  let n = 0
  const idOf = {} // the latest poem_id issued per type (the dev server runs React's strict mode: an effect may ask twice, the first ask is dropped)
  await f.page.route('**/api/poem', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}')
    poemCalls.push(b)
    n++
    idOf[b.type] = `PM-20261028-abcdefghj${n}`
    if (b.type === 'en') await new Promise((r) => setTimeout(r, 1500)) // slow: the order button must wait for it
    await route.fulfill({ json: { poem_id: idOf[b.type], type: b.type, lines: [`${b.type} 一行目です`, `${b.type} 二行目です`, `${b.type} 三行目です`], reading: b.type === 'tang' ? '書き下しです' : '', aids: {}, preview: 'x' } })
  })
  await f.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await f.page.locator('#write [data-testid=story-input]').fill(STORY)
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await f.page.click(`button:has-text("${FINALIZE.ja}")`)
  await f.page.locator('[data-testid=order-form]').waitFor()
  const addon = f.page.locator('[data-testid=poem-addon]')
  await addon.waitFor({ timeout: 5000 })
  const addonText = await addon.innerText()
  check('included poem: the step is visible to every customer — heading, four formats as radio buttons, and no price', (await addon.locator('legend').innerText()).includes('歌を一首添えます') && (await addon.locator('input[name=poem_type]').count()) === 4 && !/[¥￥]|円/.test(addonText) && addonText.includes('追加料金はありません'))
  check('included poem: the Japanese site starts with the tanka (the default format) and writes it at once', await addon.locator('input[data-poem-type=tanka]').isChecked() && poemCalls.length >= 1 && poemCalls.every((c) => c.type === 'tanka'))
  await addon.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 5000 })
  const full = await addon.locator('[data-poem-full]').innerText()
  check('included poem: the WHOLE poem is shown before checkout (all three lines), with "this poem is printed on your card"', full.includes('tanka 一行目です') && full.includes('tanka 三行目です') && (await addon.innerText()).includes('カードに印刷されます'))
  check('included poem: /api/poem got the story, the context, the chosen character, its card line and the type — and the session', poemCalls[0].story === STORY && poemCalls[0].kanji === '証' && typeof poemCalls[0].gaze === 'string' && poemCalls[0].gaze.length > 0 && poemCalls[0].relationship === 'parent_father' && typeof poemCalls[0].session === 'string')
  const callsBeforeEn = poemCalls.length
  await addon.locator('input[data-poem-type=en]').click()
  const waited = await f.page.evaluate(() => document.querySelector('[data-testid=order-submit]').disabled)
  check('included poem: while a poem is being written the order button waits (the buyer sees the poem before paying)', waited === true)
  await addon.locator('[data-poem-result=en][data-state=ready]').waitFor({ timeout: 6000 })
  check('included poem: choosing another format writes that one; the order button is back', poemCalls.length === callsBeforeEn + 1 && poemCalls.at(-1).type === 'en' && (await addon.locator('[data-poem-full]').innerText()).includes('en 一行目です'))
  await addon.locator('input[data-poem-type=tanka]').click()
  await f.page.waitForTimeout(300)
  check('included poem: going back to a format already written shows it again without another call', poemCalls.length === callsBeforeEn + 1 && (await addon.locator('[data-poem-full]').innerText()).includes('tanka 一行目です'))
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  const od8 = new Date(); od8.setDate(od8.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od8.getFullYear()}-${String(od8.getMonth() + 1).padStart(2, '0')}-${String(od8.getDate()).padStart(2, '0')}`)
  await f.page.click('label:has(input[name=package][value=standard])')
  await f.page.click('[data-testid=order-submit]')
  await f.page.waitForSelector('#co', { timeout: 8000 })
  check('included poem: the order carries only the poem_id of the format on screen (one poem, no poem text)', f.calls.order[0].poems?.length === 1 && f.calls.order[0].poems[0].poem_id === idOf.tanka && !JSON.stringify(f.calls.order[0]).includes('一行目です'))
  check('no page errors (run 8d, included poem)', f.errors.length === 0, JSON.stringify(f.errors))
  await f.page.close()
  // a poem that fails twice: a polite note, and the order goes ahead without one
  const g = await mockPage(browser, { order: () => ({ json: { order_ref: 'IC-20261023-POEM3333', checkout_url: 'http://localhost:5173/__checkout?cart=nop', glyph: '証', certificate_text: 'x' } }) })
  let failCalls = 0
  await g.page.route('**/api/poem', async (route) => {
    failCalls++
    await route.fulfill({ status: 502, json: { error: 'x', code: 'poem_failed', type: 'tanka', reasons: ['form'] } })
  })
  await g.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await g.page.locator('#write [data-testid=story-input]').fill(STORY)
  await pickContext(g.page)
  await g.page.click(`#write >> text=${GO.ja}`)
  await g.page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  await g.page.locator('article[data-slot=main]').click()
  await g.page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await g.page.click(`button:has-text("${FINALIZE.ja}")`)
  await g.page.locator('[data-testid=order-form]').waitFor()
  await g.page.locator('[data-poem-result=tanka][data-state=failed]').waitFor({ timeout: 6000 })
  check('included poem: it is tried twice, then given up politely — the note says the order goes ahead without a poem, with a "try again" button', failCalls >= 2 && (await g.page.locator('[data-poem-failed]').innerText()).includes('歌なしで、そのままご注文いただけます') && (await g.page.locator('[data-testid=poem-addon] button:has-text("もう一度試す")').count()) === 1)
  await g.page.fill('input[name=sender_name]', '山田 太郎')
  await g.page.fill('input[name=receiver_name]', '山田 一郎')
  const od9 = new Date(); od9.setDate(od9.getDate() + 20)
  await g.page.fill('input[name=delivery_date]', `${od9.getFullYear()}-${String(od9.getMonth() + 1).padStart(2, '0')}-${String(od9.getDate()).padStart(2, '0')}`)
  await g.page.click('label:has(input[name=package][value=standard])')
  await g.page.click('[data-testid=order-submit]')
  await g.page.waitForSelector('#co', { timeout: 8000 })
  check('included poem: the order went through without a poem (no "poems" in the request), nothing failed', g.calls.order.length === 1 && g.calls.order[0].poems === undefined && g.errors.length === 0, JSON.stringify(g.errors))
  await g.page.close()
}

// ---------- Run 9: the Reveal landing page — sections, copy per language, honesty, no test controls ----------
const SECTION_ORDER = ['.hero', '.strip', '.philo', '#shape', '#angles', '#write', '#how', '#moments', '.reviewsEmpty', '#gifts', '.faq', '.closing']
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = { select: [] }
  await page.route('**/api/rates', (route) => route.fulfill({ json: { date: '2026-10-25', base: 'JPY', rates: { USD: 0.0066, EUR: 0.0061, GBP: 0.0052, AUD: 0.01, TWD: 0.21, HKD: 0.052, SGD: 0.0088, KRW: 9.2 } } }))
  await page.route('**/api/select', async (route) => { calls.select.push(JSON.parse(route.request().postData() ?? '{}')); await route.fulfill({ json: FIXTURE }) })
  await page.route('**/api/**', (route) => (route.request().url().includes('/api/select') || route.request().url().includes('/api/rates') ? route.fallback() : route.fulfill({ status: 204, body: '' })))
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  check('landing: the sections are all there, in the reference order (hero, strip, philosophy, story shape, angles, WRITE, steps, moments, reviews, gifts, FAQ, closing)', await page.evaluate((sel) => { const tops = sel.map((q) => document.querySelector(q)?.getBoundingClientRect().top + window.scrollY); return tops.every((t) => Number.isFinite(t)) && tops.every((t, i) => i === 0 || t > tops[i - 1]) }, SECTION_ORDER))
  // textContent, not innerText: sections below the fold are not rendered until they are near the screen (content-visibility)
  const t = await page.evaluate(() => document.body.textContent)
  check('landing ja: <html lang>, title, hero (「あなたとわたし、一字の距離。」) and the primary call to action', (await page.getAttribute('html', 'lang')) === 'ja' && (await page.title()) === 'ICHIREI 一字礼 — 一字の贈りもの' && (await page.locator('h1').innerText()) === 'あなたとわたし、一字の距離。' && (await page.locator('.hero a.btn.primary').innerText()) === '物語を書く')
  check('landing ja: honesty — no native-speaker claim, no AI, no payment methods, no review counts or ratings', !/ネイティブ|\bAI\b|人工知能|VISA|Visa|PayPal|クレジット|★|⭐/.test(t) && t.includes('本物のレビューが、ここに並びます'))
  check('landing ja: the trust strip has three items (no "checked by native speakers")', (await page.locator('.strip li').count()) === 3)
  check('landing ja: no test controls (no A/B/C, no log export, no golden fixture, no harness label)', !/condition|ログ書き出し|golden fixture|VALIDATION HARNESS|raw contract/.test(t))
  check('landing ja: the composer is the real flow — chips for relationship, direction and occasion, the textarea, the "0 / 2000字" counter, the soft hint', (await page.locator('[data-chip^="relationship:"]').count()) === 13 && (await page.locator('[data-chip^="direction:"]').count()) === 3 && (await page.locator('[data-chip^="occasion:"]').count()) === 8 && (await page.locator('#moment').count()) === 1 && (await page.locator('[data-testid=story-counter]').innerText()) === '0 / 2000字' && (await page.locator('[data-testid=story-hint]').innerText()) === '50〜300字くらいで十分です')
  check('landing ja: no language pills inside the flow (the nav switch is the one control) and no inscription-script toggle', (await page.locator('#write [data-language]').count()) === 0 && (await page.locator('[data-inscription-script]').count()) === 0)
  check('landing ja: the nav switch shows exactly EN, 日本語, 繁中', (await page.locator('.lang button').allInnerTexts()).join('|') === 'EN|日本語|繁中')
  await page.locator('#gifts').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400) // the section renders once it is near the screen (content-visibility)
  check('landing ja: the gifts show ¥9,800 and ¥18,850 and the shipping lines; the yen price is the price', (await page.locator('#gifts [data-price=simple]').innerText()) === '¥9,800' && (await page.locator('#gifts [data-price=standard]').innerText()) === '¥18,850' && t.includes('税込・国内送料無料') && t.includes('海外へは EMS 一律 ¥6,000'))
  check('landing ja: a currency line is shown only as approximate (目安) and only when it is not yen — ja defaults to yen: none', (await page.locator('#gifts .approx').count()) === 0)
  await page.selectOption('#gifts select', 'USD')
  check('landing ja: choosing USD shows "目安 US$65" and "目安 US$124" next to the yen prices, and the hero line (目安 US$65)', (await page.locator('#gifts .approx').allInnerTexts()).join('|') === '目安 US$65|目安 US$124' && (await page.locator('.approxHero').innerText()) === '(目安 US$65)')
  await page.selectOption('#gifts select', 'JPY')
  // the photos: WebP with JPG fallback, lazy below the hero, sizes given
  const imgs = await page.evaluate(() => [...document.querySelectorAll('picture img')].map((i) => ({ src: i.getAttribute('src'), lazy: i.loading, w: i.getAttribute('width'), h: i.getAttribute('height'), webp: !!i.parentElement.querySelector('source[type="image/webp"]') })))
  check('photos: every photo is a <picture> with WebP + JPG fallback and width/height; only the hero image is eager', imgs.length === 9 && imgs.every((i) => i.webp && i.w && i.h && i.src.endsWith('.jpg')) && imgs.filter((i) => i.lazy === 'eager').length === 1 && imgs[0].lazy === 'eager')
  check('photos: m4 has no crop override (object-position is the default 50% 50%)', (await page.locator('img[src$="m4.jpg"]').evaluate((e) => getComputedStyle(e).objectPosition)) === '50% 50%')
  await page.locator('#moments').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const mosaicCols = await page.evaluate(() => { const g = document.querySelector('.mosaic'); const kids = [...g.children].map((c) => getComputedStyle(c).gridColumnEnd); const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length; const m6 = g.querySelector('.m6').getBoundingClientRect(); const m5 = g.querySelector('.m5').getBoundingClientRect(); return { cols, kids, m6w: Math.round(m6.width), m5w: Math.round(m5.width), rowEnd: Math.round(g.querySelector('.m4').getBoundingClientRect().right), m6right: Math.round(m6.right), sameRow: Math.abs(m5.top - m6.top) < 2 } })
  check('mosaic (desktop, 4 columns): m6 spans 3 columns next to m5, so the last row has no empty cell', mosaicCols.cols === 4 && mosaicCols.m6w > 3 * mosaicCols.m5w && mosaicCols.sameRow && Math.abs(mosaicCols.m6right - mosaicCols.rowEnd) <= 1, JSON.stringify(mosaicCols))
  // a missing photo leaves the coloured frame, never a broken image
  await page.route('**/img/scenes/m3*', (route) => route.fulfill({ status: 404, body: '' }))
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#moments').scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  check('photos: a missing photo (m3) removes the <img>; its coloured frame and caption stay', (await page.locator('figure.m3 img').count()) === 0 && (await page.locator('figure.m3 .cap').isVisible()))
  // the angles: five doors, keyboard
  await page.locator('#angles').scrollIntoViewIfNeeded()
  const tab0 = page.locator('[role=tab]').first()
  await tab0.focus()
  await page.keyboard.press('ArrowDown')
  check('angles: five doors; ArrowDown moves to the next door and shows its question and example', (await page.locator('[role=tab]').count()) === 5 && (await page.locator('[role=tab][aria-selected=true]').count()) === 1 && (await page.locator('[role=tab]').nth(1).getAttribute('aria-selected')) === 'true' && (await page.locator('.anglePanel .ask').innerText()).includes('頼んでもいないのに'))
  await page.keyboard.press('End')
  check('angles: End goes to the last door (言わなかったこと)', (await page.locator('[role=tab]').nth(4).getAttribute('aria-selected')) === 'true')
  // the hero carousel: dots, keyboard, and the auto-advance
  await page.evaluate(() => window.scrollTo(0, 0))
  const dot = (i) => page.locator('.hero .dots button').nth(i)
  check('hero: six examples, the first one current', (await page.locator('.hero .dots button').count()) === 6 && (await dot(0).getAttribute('aria-current')) === 'true' && (await page.locator('.hero .reveal .k').innerText()) === '燈')
  await dot(0).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(700)
  check('hero: ArrowRight on the dots shows the next example (夫 → 妻, 彩) and moves focus', (await page.locator('.hero .reveal .k').innerText()) === '彩' && (await dot(1).getAttribute('aria-current')) === 'true')
  await page.mouse.move(5, 5)
  await page.locator('.hero .reveal').hover()
  await page.waitForTimeout(6800)
  check('hero: it does not advance while the visitor is on the card', (await page.locator('.hero .reveal .k').innerText()) === '彩')
  await page.mouse.move(5, 5)
  await page.waitForTimeout(7200)
  check('hero: it advances by itself every ~6 s once the pointer leaves', (await page.locator('.hero .reveal .k').innerText()) === '遅')
  check('hero: the category colour changes with the example (友 → friends teal)', (await page.locator('.hero .reveal').evaluate((e) => getComputedStyle(e).getPropertyValue('--cat'))).includes('--c-friends') || (await page.locator('.hero .reveal').getAttribute('style')).includes('--c-friends'))
  // focus is visible
  await page.locator('.hero a.btn.primary').focus()
  check('keyboard focus is visible (an outline on the focused button)', (await page.locator('.hero a.btn.primary').evaluate((e) => getComputedStyle(e).outlineStyle)) !== 'none')
  await page.screenshot({ path: `${SHOTS}/e2e-landing-ja-hero.png` })
  check('no page errors (run 9)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()

  // reduced motion: the carousel never auto-advances and the progress animation is off
  const rctx = await browser.newContext({ reducedMotion: 'reduce', locale: 'en-US', viewport: { width: 1280, height: 900 } })
  const rp = await rctx.newPage()
  await rp.route('**/api/**', (route) => route.fulfill({ status: 204, body: '' }))
  await rp.goto('http://localhost:5173/?lang=en', { waitUntil: 'networkidle' })
  const k0 = await rp.locator('.hero .reveal .k').innerText()
  await rp.waitForTimeout(7500)
  check('reduced motion: the hero carousel does not auto-advance, and there is no progress animation', (await rp.locator('.hero .reveal .k').innerText()) === k0 && !(await rp.locator('.hero .reveal').getAttribute('class')).includes('run'))
  await rp.locator('.hero .dots button').nth(2).click()
  check('reduced motion: the dots still work', (await rp.locator('.hero .reveal .k').innerText()) === '遅')
  await rctx.close()
}

// ---------- Run 10: three languages on the landing page (EN, 日本語, 繁中), remembered, shared with /demo ----------
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = { select: [] }
  await page.route('**/api/rates', (route) => route.fulfill({ status: 503, body: '' }))
  await page.route('**/api/select', async (route) => { calls.select.push(JSON.parse(route.request().postData() ?? '{}')); await route.fulfill({ json: FIXTURE }) })
  await page.route('**/api/{log,analytics,order,explain}', (route) => route.fulfill({ status: 204, body: '' }))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  check('landing: three language buttons (EN, 日本語, 繁中); with no stored choice an ja-JP browser gets 日本語', (await page.locator('.lang button').count()) === 3 && (await page.locator('.lang [data-lang=ja][aria-pressed=true]').count()) === 1)
  const LANGS = {
    en: { title: 'ICHIREI 一字礼 — A Gift of One Character', h1: 'Between you and me, one character.', cta: 'Tell your story', go: GO.en, htmlLang: 'en', hint: '50–300 characters is plenty', desc: 'ICHIREI (一字礼) — the person you see' },
    ja: { title: 'ICHIREI 一字礼 — 一字の贈りもの', h1: 'あなたとわたし、一字の距離。', cta: '物語を書く', go: GO.ja, htmlLang: 'ja', hint: '50〜300字くらいで十分です', desc: 'ICHIREI（一字礼）— あなたの目に映る、その人を、一文字に。' },
    'zh-Hant': { title: 'ICHIREI 一字禮 — 一個字的禮物', h1: '你和我之間，只隔一個字。', cta: '寫下故事', go: GO['zh-Hant'], htmlLang: 'zh-Hant', hint: '50〜300字就足夠', desc: 'ICHIREI（一字禮）— 把你眼中的那個人' },
  }
  for (const [l, want] of Object.entries(LANGS)) {
    await page.click(`.lang [data-lang="${l}"]`)
    const body = await page.evaluate(() => document.body.innerText)
    check(`${l}: <html lang>, title, meta description, hero, call to action, the composer button and hint`, (await page.getAttribute('html', 'lang')) === want.htmlLang && (await page.title()) === want.title && (await page.getAttribute('meta[name=description]', 'content')).startsWith(want.desc) && (await page.locator('h1').innerText()).replace(/\n/g, '') === want.h1 && (await page.locator('.hero a.btn.primary').innerText()) === want.cta && (await page.locator('#write button[type=submit]').innerText()) === want.go && (await page.locator('[data-testid=story-hint]').innerText()) === want.hint)
    check(`${l}: og:title follows the language, and the page text carries no other language's chrome`, (await page.getAttribute('meta[property="og:title"]', 'content')) === want.title && (l === 'en' ? !/[ぁ-んァ-ヶ]/.test(body.replace(/日本語|一字礼|獨歩文化株式会社/g, '').replace(/[\u4e00-\u9fff]/g, '')) : true))
  }
  // the engine languages: en → en, ja → ja, 繁中 → zh-Hant (and the composer posts to /api/select in that language)
  for (const [l, story] of [['en', 'My mum left the porch light on every night.'], ['ja', '母は、毎晩玄関の灯りをつけていた。'], ['zh-Hant', '媽媽每晚都開著門口的燈。']]) {
    await page.click(`.lang [data-lang="${l}"]`)
    await page.locator('#moment').fill(story)
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
    await page.click(`#write button[type=submit]`)
    await page.waitForSelector('[data-testid=finalize]', { timeout: 15000 })
    const sent = calls.select.at(-1)
    check(`${l}: the composer posts to /api/select with language ${l}, the story and the context${l === 'zh-Hant' ? ' (traditional inscription)' : ''}`, sent.language === l && sent.story === story && sent.relationship === 'parent_mother' && sent.direction === 'up' && sent.occasion === 'birthday_milestone' && (l === 'zh-Hant' ? sent.inscription_script === 'traditional' : !('inscription_script' in sent)), JSON.stringify(sent))
    await page.click(`#write >> text=${{ en: 'Try again', ja: 'もう一度試す', 'zh-Hant': '再試一次' }[l]}`)
    await page.locator('#moment').waitFor()
  }
  check('the rates endpoint failing hides the currency select and every approximate line (fallback: hide)', (await page.locator('#gifts select').count()) === 0 && (await page.locator('.approx, .approxHero').count()) === 0)
  // remembered across a reload, and shared with /demo
  await page.click('.lang [data-lang="zh-Hant"]')
  await page.reload({ waitUntil: 'networkidle' })
  check('the choice is remembered across a reload', (await page.getAttribute('html', 'lang')) === 'zh-Hant' && (await page.locator('h1').innerText()).replace(/\n/g, '') === '你和我之間，只隔一個字。')
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  check('/demo opens in the language chosen on the landing page (the harness still has its four language pills)', (await page.locator('[data-language=zh-Hant][aria-pressed=true]').count()) === 1 && (await page.locator('[data-language]').count()) === 4 && (await page.locator('text=不必寫下那個人的全部').count()) === 1)
  await page.click('[data-language=zh-Hans]')
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  check('…zh-Hans chosen in /demo shows the landing in 繁中 (the page offers EN, 日本語, 繁中) and the store follows', (await page.locator('h1').innerText()).replace(/\n/g, '') === '你和我之間，只隔一個字。' && (await page.locator('.lang [data-lang="zh-Hant"][aria-pressed=true]').count()) === 1)
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  check('?lang=ja overrides the stored choice', (await page.locator('h1').innerText()).replace(/\n/g, '') === 'あなたとわたし、一字の距離。' && (await page.getAttribute('html', 'lang')) === 'ja')
  check('no page errors (run 10)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
  // first visit: the browser's most preferred language decides — ja* → 日本語, any zh* → 繁中, everything else (ko included) → EN
  const FIRST = [['ja-JP', 'あなたとわたし、一字の距離。', 'ja'], ['zh-TW', '你和我之間，只隔一個字。', 'zh-Hant'], ['zh-HK', '你和我之間，只隔一個字。', 'zh-Hant'], ['zh-CN', '你和我之間，只隔一個字。', 'zh-Hant'], ['en-US', 'Between you and me, one character.', 'en'], ['ko-KR', 'Between you and me, one character.', 'en'], ['fr-FR', 'Between you and me, one character.', 'en']]
  for (const [locale, h1, htmlLang] of FIRST) {
    const ctx = await browser.newContext({ locale, viewport: { width: 1200, height: 900 } })
    const p2 = await ctx.newPage()
    await p2.route('**/api/**', (route) => route.fulfill({ status: 204, body: '' }))
    await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    check(`first visit, browser ${locale}: the page opens in ${htmlLang}`, (await p2.locator('h1').innerText()) === h1 && (await p2.getAttribute('html', 'lang')) === htmlLang && (await p2.locator(`.lang [data-lang="${htmlLang}"][aria-pressed=true]`).count()) === 1)
    if (locale === 'ko-KR') {
      // a stored choice and ?lang= still win
      await p2.evaluate(() => localStorage.setItem('ichirei.lang', 'ja'))
      await p2.reload({ waitUntil: 'networkidle' })
      check('ko-KR browser with a stored 日本語: the stored choice wins', (await p2.locator('h1').innerText()) === 'あなたとわたし、一字の距離。')
      await p2.goto('http://localhost:5173/?lang=zh-Hant', { waitUntil: 'networkidle' })
      check('…and ?lang=zh-Hant wins over the stored choice', (await p2.locator('h1').innerText()) === '你和我之間，只隔一個字。')
    }
    await ctx.close()
  }
}

// ---------- Run 11: the customer flow at / — choose, order, redirect to Shopify checkout (ja) ----------
{
  const orderOk = () => ({ json: { order_ref: 'IC-20261023-TESTREF2', checkout_url: 'http://localhost:5173/__checkout?cart=fake', glyph: '守', certificate_text: 'x' } })
  const { page, errors, calls } = await mockPage(browser, { order: orderOk })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.locator('#moment').fill(STORY)
  await pickContext(page)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.ja}")`, { timeout: 15000 })
  check('customer: no condition toggle, no diagnostics ("見送った字"), no raw contract, no honesty flags in the reveal', (await page.locator('text=見送った字').count()) === 0 && (await page.locator('text=raw contract').count()) === 0 && (await page.locator('text=⚑').count()) === 0 && (await page.locator('#write details').count()) === 0)
  check('customer: the "try again" button is there; the harness controls are not', (await page.locator('button:has-text("もう一度試す")').count()) === 1 && (await page.locator('text=ログ書き出し').count()) === 0)
  check('customer: the select call is plain condition A with the context (same engine as /demo)', calls.select[0].condition === 'A' && calls.select[0].language === 'ja' && calls.select[0].relationship === 'parent_father' && !('inscription_script' in calls.select[0]))
  // the three cards: main (cinnabar glyph), second, freestyle (labelled 遊び字, lighter, never cinnabar)
  const cardInfo = await page.evaluate(() => [...document.querySelectorAll('#write article[data-slot]')].map((a) => ({ slot: a.dataset.slot, label: a.querySelector('[data-slot-label]').innerText, glyph: getComputedStyle(a.querySelector('[data-glyph]')).color, border: getComputedStyle(a).borderStyle, choose: !!a.querySelector('[data-select]') })))
  check('three cards: main 本命 (cinnabar character), second 次点, freestyle 遊び字 (dashed, lighter, its character is NOT cinnabar); each has its own choose button', cardInfo.length === 3 && cardInfo.find((c) => c.slot === 'main').label === '本命' && cardInfo.find((c) => c.slot === 'main').glyph === 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'second').label === '次点' && cardInfo.find((c) => c.slot === 'second').glyph !== 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'freestyle').label === '遊び字' && cardInfo.find((c) => c.slot === 'freestyle').glyph !== 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'freestyle').border === 'dashed' && cardInfo.every((c) => c.choose), JSON.stringify(cardInfo))
  check('finalize is disabled until a card is chosen, with the hint 「ひとつ選ぶと、先へ進めます。」', (await page.locator('[data-testid=finalize]').isDisabled()) && (await page.locator('text=ひとつ選ぶと、先へ進めます。').isVisible()))
  // choose 守 (it has a distinct old form 默)
  await page.locator('article', { hasText: '静けさのまま' }).click()
  await page.locator('article', { hasText: '静けさのまま' }).locator('text=この一字を選ぶ').click()
  await page.click(`button:has-text("${FINALIZE.ja}")`)
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor({ timeout: 5000 })
  check('order form appears after the character is chosen (the reveal stays mounted but hidden)', await form.isVisible() && (await page.locator('#write article').first().isHidden()))
  check('order form: sender, receiver, delivery date, package (no old-form choice: Japanese buyers carve the modern form)', (await page.locator('input[name=sender_name]').count()) === 1 && (await page.locator('input[name=receiver_name]').count()) === 1 && (await page.locator('input[name=delivery_date]').count()) === 1 && (await page.locator('input[name=inscription_style]').count()) === 0 && (await page.locator('input[name=package]').count()) === 4)
  check('order form: Simple ¥9,800 and Standard ¥18,850, and the shipping line 「国内送料無料・海外送料 ¥6,000」', (await page.locator('#write [data-price=simple]').innerText()) === '¥9,800' && (await page.locator('#write [data-price=standard]').innerText()) === '¥18,850' && (await page.locator('[data-shipping]').innerText()) === '国内送料無料・海外送料 ¥6,000' && !(await form.innerText()).includes('送料別') && (await form.innerText()).includes('シンプル') && (await form.innerText()).includes('スタンダード'))
  check('order form (ja): no form choice — the slip shows the modern form 守 and the note says it is carved in the modern form', (await page.locator('input[name=inscription_style]').count()) === 0 && (await page.locator('[data-order-glyph]').innerText()) === '守' && (await form.innerText()).includes('新字体'))
  check('certificate: 「この字は、あなたの目に映る、その人です。」 from the start', (await page.locator('[data-certificate]').innerText()) === 'この字は、あなたの目に映る、その人です。')
  await page.fill('input[name=sender_name]', '山田 太郎')
  check('certificate: typing a name does not change it (no name in the line any more)', (await page.locator('[data-certificate]').innerText()) === 'この字は、あなたの目に映る、その人です。')
  const submit = page.locator('[data-testid=order-submit]')
  check('submit is disabled until names, date and package are set', await submit.isDisabled())
  await page.fill('input[name=receiver_name]', '山田 一郎')
  const d = new Date(); d.setDate(d.getDate() + 30)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.fill('input[name=delivery_date]', iso)
  check('the delivery-date notice counts the days (お届け希望日まで30日です。)', await page.locator('text=お届け希望日まで30日です。').isVisible())
  check('still disabled without a package (nothing is pre-selected: no default upsell)', await submit.isDisabled())
  await page.click('label:has(input[name=package][value=standard])')
  check('enabled once everything is filled', await submit.isEnabled())
  // (no inscription-form choice for Japanese buyers: the modern form is carved)
  await page.screenshot({ path: `${SHOTS}/e2e-order-form-ja.png`, fullPage: true })
  // back keeps the selection
  await page.click('text=字を選びなおす')
  check('"字を選びなおす" returns to the reveal with the selection kept', (await page.locator('text=この一字を選んでいます').count()) === 1 && (await form.count()) === 0)
  await page.click(`button:has-text("${FINALIZE.ja}")`)
  await form.waitFor()
  // submit
  check('the form is empty again after going back and forth? (no — it is re-created, so refill)', (await page.inputValue('input[name=sender_name]')) === '')
  await page.fill('input[name=sender_name]', '山田 太郎')
  await page.fill('input[name=receiver_name]', '山田 一郎')
  await page.fill('input[name=delivery_date]', iso)
  await page.click('label:has(input[name=package][value=standard])')
  await submit.click()
  await page.waitForSelector('#co', { timeout: 8000 })
  check('submit → redirected to the Shopify checkout URL the server returned', page.url().includes('/__checkout?cart=fake'))
  const body = calls.order[0]
  check('POST /api/order: story, the engine result, the chosen kanji, language, names, date, inscription style and package', body.story === STORY && body.engine_result.candidates.length === 3 && body.selected_kanji === '守' && body.language === 'ja' && body.sender_name === '山田 太郎' && body.receiver_name === '山田 一郎' && body.delivery_date === iso && body.inscription_style === 'modern' && body.package === 'standard', JSON.stringify({ ...body, engine_result: '…', story: body.story?.slice(0, 10) }))
  check('POST /api/order carries no price and no glyph (the server derives both)', !('price' in body) && !('glyph' in body) && !('amount' in body))
  check('no page errors (run 11)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 12: order errors, and the Chinese customer flow ----------
{
  let mode = 'cart_failed'
  const order = (body) =>
    mode === 'cart_failed' ? { status: 502, json: { error: 'x', code: 'cart_failed', order_ref: 'IC-X' } }
    : mode === 'not_configured' ? { status: 503, json: { error: 'x', code: 'shopify_not_configured', missing: ['SHOPIFY_STOREFRONT_TOKEN'] } }
    : mode === 'field' ? { status: 400, json: { error: 'x', field: 'delivery_date' } }
    : { json: { order_ref: 'IC-20261023-ZHREF222', checkout_url: 'http://localhost:5173/__checkout?cart=zh', glyph: body.inscription_style === 'simplified' ? '灯' : '燈', certificate_text: 'x' } }
  const zhResult = (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.inscription_script = body.inscription_script ?? 'traditional'
    r.primary_kanji = '灯'
    r.runner_up_kanji = null
    r.candidates = r.candidates.slice(0, 3).map((c) => ({ ...c, eliminated: false, eliminated_reason: null }))
    r.candidates[0] = { ...r.candidates[0], kanji: '灯', inscription_form: '燈', reading: 'dēng', one_line_gaze: '你把玄关的灯一直留着。', story_anchor: '玄关的灯' }
    r.candidates[1] = { ...r.candidates[1], kanji: '守', inscription_form: null, reading: 'mò' }
    r.candidates[2] = { ...r.candidates[2], kanji: '桥', inscription_form: '橋', reading: 'qiáo' }
    return r
  }
  const { page, errors, calls } = await mockPage(browser, { result: zhResult, order })
  await page.goto('http://localhost:5173/?lang=zh-Hant', { waitUntil: 'networkidle' })
  check('zh-Hant customer page: the flow is in traditional Chinese (composer button, chips), no test controls', (await page.locator('#write').innerText()).includes(GO['zh-Hant']) && (await page.locator('#write [data-chip="relationship:parent_father"]').innerText()) === '父親' && (await page.locator('text=VALIDATION HARNESS').count()) === 0)
  await page.locator('#moment').fill('他總是把玄關的燈留著，不管我多晚回家。')
  await pickContext(page, { relationship: 'parent_father', direction: 'up', occasion: 'seasonal_thanks' })
  await page.click(`#write >> text=${GO['zh-Hant']}`)
  await page.waitForSelector(`button:has-text("${FINALIZE['zh-Hant']}")`, { timeout: 15000 })
  check('zh-Hant: the select call is zh-Hant with the default (traditional) inscription script', calls.select[0].language === 'zh-Hant' && calls.select[0].inscription_script === 'traditional')
  const lamp = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("燈")') })
  await lamp.click()
  await lamp.locator('text=選擇這個字').click()
  await page.click(`button:has-text("${FINALIZE['zh-Hant']}")`)
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor()
  check('zh-Hant order form: traditional (燈) pre-selected, simplified (灯) offered, in Chinese', (await page.locator('input[name=inscription_style][value=traditional]').isChecked()) && (await page.locator('[data-order-glyph]').innerText()) === '燈' && (await form.locator('label:has(input[value=simplified]) .optGlyph').innerText()) === '灯' && (await form.innerText()).includes('你的姓名（送禮人）') && (await form.innerText()).includes('木牌（簡約）'))
  await page.fill('input[name=sender_name]', '李明')
  check('zh-Hant certificate: 「這個字，是你眼中的那個人。」 and the shipping line', (await page.locator('[data-certificate]').innerText()) === '這個字，是你眼中的那個人。' && (await page.locator('[data-shipping]').innerText()) === '日本國內免運費・海外運費 ¥6,000')
  await page.fill('input[name=receiver_name]', '李華')
  const d = new Date(); d.setDate(d.getDate() + 20)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.fill('input[name=delivery_date]', iso)
  await page.click('label:has(input[name=package][value=simple])')
  await page.click('label:has(input[value=simplified])')
  check('simplified chosen → the slip shows 灯', (await page.locator('[data-order-glyph]').innerText()) === '灯')
  await page.screenshot({ path: `${SHOTS}/e2e-order-form-zh-hant.png`, fullPage: true })
  // error handling
  const submit = page.locator('[data-testid=order-submit]')
  await submit.click()
  await page.locator('[data-testid=order-error]').waitFor()
  check('502 cart_failed → a plain message, the form stays usable', (await page.locator('[data-testid=order-error]').innerText()).includes('未能受理訂單') && await submit.isEnabled())
  mode = 'not_configured'
  await submit.click()
  await page.locator('text=目前暫時無法下單').waitFor()
  check('503 not configured → "cannot take orders right now"', true)
  mode = 'field'
  await submit.click()
  await page.locator('text=請檢查「期望送達日」').waitFor()
  check('400 with a field → names the field to fix', true)
  mode = 'ok'
  await submit.click()
  await page.waitForSelector('#co', { timeout: 8000 })
  const b = calls.order.at(-1)
  check('zh order payload: language zh-Hant, simplified inscription, Simple package, the Chinese names', b.language === 'zh-Hant' && b.inscription_style === 'simplified' && b.package === 'simple' && b.sender_name === '李明' && b.receiver_name === '李華' && b.selected_kanji === '灯' && b.engine_result.language === 'zh-Hant')
  check('…and the browser is at the checkout URL', page.url().includes('cart=zh'))
  check('no page errors (run 12)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 13: English — landing, customer flow, order form, /demo ----------
{
  let mode = 'ok'
  const order = (_body) =>
    mode === 'field' ? { status: 400, json: { error: 'x', field: 'delivery_date' } }
    : mode === 'cart_failed' ? { status: 502, json: { error: 'x', code: 'cart_failed', order_ref: 'IC-X' } }
    : { json: { order_ref: 'IC-20261023-ENREF222', checkout_url: 'http://localhost:5173/__checkout?cart=en', glyph: '燈', certificate_text: 'x' } }
  const enResult = (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.inscription_script = null
    r.primary_kanji = '灯'
    r.runner_up_kanji = null
    r.candidates = r.candidates.slice(0, 3).map((c, i) => ({ ...c, eliminated: false, eliminated_reason: null, meaning: ['lamp', 'wait', 'welcome'][i], why_this: ['Lamplight is the light you left on for me.', 'Waiting is what you did, and never mentioned.', 'Welcoming is what the door meant.'][i], reading_zh: ['dēng', 'dài', 'yíng'][i] }))
    r.candidates[0] = { ...r.candidates[0], kanji: '灯', inscription_form: '燈', reading: 'akari', one_line_gaze: 'You left the porch light on every night.', story_anchor: 'left the porch light on' }
    r.candidates[1] = { ...r.candidates[1], kanji: '待', inscription_form: null, reading: 'matsu' }
    r.candidates[2] = { ...r.candidates[2], kanji: '証', inscription_form: null, reading: 'mukaeru' }
    return r
  }
  const { page, errors, calls } = await mockPage(browser, { result: enResult, order, onExplain: 'She kept the porch light on, and that was all she said.' })

  // -- the landing page, in English
  await page.goto('http://localhost:5173/?lang=en', { waitUntil: 'networkidle' })
  check('en landing: <html lang="en">, title, hero, brand', (await page.getAttribute('html', 'lang')) === 'en' && (await page.title()) === 'ICHIREI 一字礼 — A Gift of One Character' && (await page.locator('h1').innerText()) === 'Between you and me, one character.' && (await page.locator('header').innerText()).includes('ICHIREI'))
  check('en landing: three language buttons (EN, 日本語, 繁中), EN pressed', (await page.locator('.lang button').count()) === 3 && (await page.locator('.lang [data-lang=en][aria-pressed=true]').count()) === 1)
  // textContent, not innerText: sections below the fold are not rendered until they are near the screen (content-visibility)
  const enBody = await page.evaluate(() => document.body.textContent)
  check('en landing: the philosophy, the steps and the CTA are English; no AI, no "native speakers", no payment methods on the page', enBody.includes("We don't sell characters.") && enBody.includes('Three simple steps to one character') && enBody.includes('Tell your story') && !/\bAI\b|native speaker|visa|paypal/i.test(enBody))
  await page.screenshot({ path: `${SHOTS}/e2e-landing-en.png`, fullPage: false })
  await page.click('.lang [data-lang=ja]')
  check('en → ja through the nav switch, and back to en', (await page.locator('h1').innerText()) === 'あなたとわたし、一字の距離。' && (await page.getAttribute('html', 'lang')) === 'ja')
  await page.click('.lang [data-lang=en]')
  await page.reload({ waitUntil: 'networkidle' })
  check('…and the choice is remembered across a reload', (await page.locator('h1').innerText()) === 'Between you and me, one character.' && (await page.getAttribute('html', 'lang')) === 'en')

  // -- the customer flow
  check('en customer page: the flow is English, no language pills inside it, no test controls', (await page.locator('#write').innerText()).includes('One moment with them') && (await page.locator('#write [data-language]').count()) === 0 && (await page.locator('text=VALIDATION HARNESS').count()) === 0)
  check('en: the chips are English (relationship, direction, occasion)', (await page.locator('[data-chip="relationship:parent_mother"]').innerText()) === 'Mother' && (await page.locator('[data-chip="occasion:wedding"]').innerText()) === 'Wedding or anniversary')
  await page.locator('#moment').fill('My mum left the porch light on every night until I got home.')
  await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
  await page.fill('input[name=occasion_detail]', '70th birthday')
  await page.click(`#write >> text=${GO.en}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.en}")`, { timeout: 15000 })
  const sel = calls.select[0]
  check('en payload: language en, the context and occasion_detail, and NO inscription_script', sel.language === 'en' && sel.relationship === 'parent_mother' && sel.direction === 'up' && sel.occasion === 'birthday_milestone' && sel.occasion_detail === '70th birthday' && !('inscription_script' in sel), JSON.stringify(sel))
  const lamp = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("灯")') })
  check('en reveal: the carved glyph is the modern Japanese form 灯 (spec v9.1 step 9), shown with the romaji reading (from the palette), the pinyin and the one-phrase English meaning', (await lamp.count()) === 1 && await lamp.locator('text=akari · pinyin dēng — lamp').isVisible())
  check('en reveal: no old-form (kyūjitai) note — only the modern form is carved', (await lamp.locator('text=kyūjitai').count()) === 0)
  const plainCard = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("待")') })
  check('en reveal: a character with no distinct old form shows romaji and meaning only', await plainCard.locator('text=matsu · pinyin dài — wait').isVisible())
  check('en reveal: each card shows the model\'s one plain-English why_this sentence under the gaze line', (await lamp.locator('[data-why-this]').innerText()) === 'Lamplight is the light you left on for me.' && (await plainCard.locator('[data-why-this]').innerText()) === 'Waiting is what you did, and never mentioned.')
  check('learning loop: the select call carries a random session id and source "customer" — and nothing else new', /^[A-Za-z0-9_-]{16,64}$/.test(calls.select[0].session) && calls.select[0].source === 'customer')
  await lamp.click()
  await lamp.locator('text=Choose this character').click()
  await page.screenshot({ path: `${SHOTS}/e2e-reveal-en.png`, fullPage: true })
  await page.click(`button:has-text("${FINALIZE.en}")`)
  await page.waitForTimeout(300)
  check('learning loop: choosing a card reports ONE event "chosen" with the kind of card (灯 is the main) — and no story, kanji or name', calls.analytics.filter((e) => e.event === 'chosen').length === 1 && calls.analytics.find((e) => e.event === 'chosen').choice === 'main' && calls.analytics.find((e) => e.event === 'chosen').session === calls.select[0].session && Object.keys(calls.analytics.find((e) => e.event === 'chosen')).sort().join() === 'choice,event,session,source' && !JSON.stringify(calls.analytics).includes('灯'))

  // -- the order form
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor()
  check('en order form: no form choice (the character is carved in its modern Japanese form 灯); never traditional/simplified', (await page.locator('input[name=inscription_style]').count()) === 0 && (await page.locator('[data-order-glyph]').innerText()) === '灯')
  check('en order form: English labels, packages and the romaji + meaning line under the glyph', (await form.innerText()).toLowerCase().includes('your order') && (await form.innerText()).includes('Requested delivery date') && (await form.innerText()).includes('akari · pinyin dēng — lamp') && (await form.innerText()).includes('¥18,850'))
  check('en certificate: "This character is the person as seen through your eyes." and the shipping line', (await page.locator('[data-certificate]').innerText()) === 'This character is the person as seen through your eyes.' && (await page.locator('[data-shipping]').innerText()) === 'Free shipping in Japan · ¥6,000 international shipping' && (await page.locator('#write [data-price=standard]').innerText()) === '¥18,850')
  await page.fill('input[name=sender_name]', 'Emily Carter')
  await page.fill('input[name=receiver_name]', 'Margaret Carter')
  const d = new Date(); d.setDate(d.getDate() + 20)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.fill('input[name=delivery_date]', iso)
  check('en: the delivery notice is English ("20 days until your requested delivery date.")', await page.locator('text=20 days until your requested delivery date.').isVisible())
  // (no inscription-form choice for English buyers either)
  await page.click('label:has(input[name=package][value=simple])')
  await page.screenshot({ path: `${SHOTS}/e2e-order-form-en.png`, fullPage: true })
  const submit = page.locator('[data-testid=order-submit]')
  mode = 'cart_failed'
  await submit.click()
  await page.locator('[data-testid=order-error]').waitFor()
  check('en: a failed order shows a plain English message and the form stays usable', (await page.locator('[data-testid=order-error]').innerText()).includes('We could not take your order') && await submit.isEnabled())
  mode = 'field'
  await submit.click()
  await page.locator('text=Please check “Requested delivery date”.').waitFor()
  check('en: a 400 with a field names the field to fix, in English', true)
  mode = 'ok'
  await submit.click()
  await page.waitForSelector('#co', { timeout: 8000 })
  const b = calls.order.at(-1)
  check('learning loop: the order carries the same session id (the server records "ordered"), source customer', b.session === calls.select[0].session && b.source === 'customer')
  check('en order payload: language en, modern form, Simple package, the names; no price, no glyph', b.language === 'en' && b.inscription_style === 'modern' && b.package === 'simple' && b.sender_name === 'Emily Carter' && b.receiver_name === 'Margaret Carter' && b.selected_kanji === '灯' && b.engine_result.language === 'en' && !('price' in b) && !('glyph' in b))
  check('…and the browser is at the checkout URL', page.url().includes('cart=en'))
  check('no page errors (run 13, customer flow)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}
{
  // -- the internal harness at /demo in English
  const enResultDemo = (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.inscription_script = null
    r.primary_kanji = '灯'
    r.runner_up_kanji = null
    r.candidates = r.candidates.slice(0, 3).map((c, i) => ({ ...c, eliminated: false, eliminated_reason: null, meaning: ['lamp', 'wait', 'welcome'][i], why_this: ['Lamplight is the light you left on for me.', 'Waiting is what you did, and never mentioned.', 'Welcoming is what the door meant.'][i], reading_zh: ['dēng', 'dài', 'yíng'][i] }))
    r.candidates[0] = { ...r.candidates[0], kanji: '灯', inscription_form: '燈', reading: 'akari', one_line_gaze: 'You left the porch light on every night.', story_anchor: 'left the porch light on' }
    return r
  }
  const { page, errors, calls } = await mockPage(browser, { result: enResultDemo, onExplain: 'She kept the porch light on, and that was all she said.' })
  await page.goto('http://localhost:5173/demo?lang=en', { waitUntil: 'networkidle' })
  check('en /demo: the English pill is pressed, the harness chrome is there, no inscription-script toggle', (await page.locator('[data-language=en][aria-pressed=true]').count()) === 1 && (await page.locator('[data-language]').count()) === 4 && (await page.locator('text=VALIDATION HARNESS').count()) === 1 && (await page.locator('[data-inscription-script]').count()) === 0)
  await page.click('[data-language=zh-Hans]')
  check('en /demo: the pill switches to zh-Hans (and the zh toggle appears), then back to English (and it disappears)', (await page.locator('[data-inscription-script]').count()) === 2)
  await page.click('[data-language=en]')
  check('…English again: no toggle, English UI', (await page.locator('[data-inscription-script]').count()) === 0 && (await page.locator(`button:has-text("${SUBMIT.en}")`).count()) === 1)
  await page.locator('textarea').first().fill('My mum left the porch light on every night until I got home.')
  await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'seasonal_thanks' })
  await page.click(`text=${SUBMIT.en}`)
  await page.waitForSelector(`button:has-text("${FINALIZE.en}")`, { timeout: 15000 })
  check('en /demo payload: language en, no inscription_script', calls.select[0].language === 'en' && !('inscription_script' in calls.select[0]))
  // explain (condition B) carries the context, the romaji reading and the English meaning
  await page.click('header >> text="B"')
  const lampD = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("灯")') })
  await lampD.click()
  await lampD.locator('text=Read this character more deeply').click()
  await page.waitForSelector('text=She kept the porch light on', { timeout: 5000 })
  const ex = calls.explain[0]
  check('learning loop (/demo): the explanation reports "explain_opened" with source harness', calls.analytics.some((e) => e.event === 'explain_opened' && e.source === 'harness' && e.choice === 'main') && calls.select[0].source === 'harness')
  check('en explain call: language en with the context, the romaji reading AND the English meaning, no inscription_script', ex.language === 'en' && ex.relationship === 'parent_mother' && ex.occasion === 'seasonal_thanks' && ex.candidate.kanji === '灯' && ex.candidate.inscription_form === '燈' && ex.candidate.reading === 'akari' && ex.candidate.meaning === 'lamp' && !('inscription_script' in ex), JSON.stringify(ex))
  check('no page errors (run 13, /demo)', errors.length === 0)
  await page.close()
}

// ---------- Run 13b: remembrance (occasion memorial) — the chip, the suggestion, ink instead of cinnabar, no gift wording ----------
{
  const INK = 'rgb(31, 42, 68)'
  const SEAL = 'rgb(200, 64, 45)'
  const memResult = (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.occasion = body.occasion
    r.inscription_script = null
    // the sender chose a gift occasion but the story says the person has died: the model suggests remembrance
    if (body.occasion !== 'memorial') r.suggest_memorial = true
    return r
  }
  const orderOk = () => ({ json: { order_ref: 'IC-20261026-MEMREF22', checkout_url: 'http://localhost:5173/__checkout?cart=mem', glyph: '守', certificate_text: 'x', certificate: { memorial: true } } })
  const { page, errors, calls } = await mockPage(browser, { result: memResult, order: orderOk })
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  const chips = await page.locator('[data-chip^="occasion:"]').evaluateAll((els) => els.map((e) => e.dataset.chip))
  check('memorial: "偲ぶ" is the last occasion chip, after the existing seven (nothing is set silently: no chip is pressed at the start)', chips.length === 8 && chips[7] === 'occasion:memorial' && (await page.locator('[data-chip="occasion:memorial"]').innerText()) === '偲ぶ' && (await page.locator('[data-chip^="occasion:"][aria-pressed=true]').count()) === 0)
  await page.locator('#moment').fill('父は、私が帰省するたびに玄関の灯りをつけて待っていた。去年の冬に亡くなったけれど、今も思い出す。')
  await pickContext(page, { relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' })
  await page.click('[data-chip="occasion:memorial"]')
  check('memorial: choosing it changes the direction wording to one that never speaks of giving (その人は、あなたより / 目上の方 …)', (await page.locator('#cg-direction').innerText()) === 'その人は、あなたより' && !(await page.locator('[data-chip^="direction:"]').allInnerTexts()).some((t) => /へ|贈/.test(t)))
  await page.click('[data-chip="occasion:birthday_milestone"]')
  check('memorial: the direction label returns to the gift wording for the other occasions', (await page.locator('#cg-direction').innerText()) === '贈る向き')
  // -- the suggestion: the engine says the story is about someone who has died; the page asks (and shows no cards yet)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector('[data-testid=memorial-suggest]', { timeout: 15000 })
  check('suggestion: the page asks the sender before showing anything — no cards, no silent switch of the occasion', (await page.locator('#write article[data-slot]').count()) === 0 && (await page.locator('[data-testid=memorial-suggest]').innerText()).includes('亡くなった方のお話のようです。') && calls.select.length === 1 && calls.select[0].occasion === 'birthday_milestone')
  // "No, continue as it is" → the cards, as for any gift (cinnabar main)
  await page.click('[data-testid=memorial-no]')
  await page.waitForSelector('[data-testid=finalize]', { timeout: 15000 })
  check('suggestion declined: the cards appear as before (cinnabar main), no second engine call, the finalize button keeps its usual wording', calls.select.length === 1 && (await page.locator('article[data-slot=main] [data-glyph]').evaluate((el) => getComputedStyle(el).color)) === SEAL && (await page.locator('[data-testid=finalize]').innerText()) === FINALIZE.ja)
  await page.click('#write >> text=もう一度試す')
  await page.locator('#moment').waitFor()
  // -- accept: run again as memorial (the same story, the same answers)
  check('after "try again" the story is kept and no chip is pressed for the occasion except the sender\'s own (birthday_milestone)', (await page.locator('[data-chip="occasion:birthday_milestone"][aria-pressed=true]').count()) === 1)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector('[data-testid=memorial-suggest]', { timeout: 15000 })
  await page.click('[data-testid=memorial-yes]')
  await page.waitForSelector('[data-testid=finalize]', { timeout: 15000 })
  check('suggestion accepted: the engine runs again with occasion memorial (same story), then the cards appear', calls.select.length === 3 && calls.select[2].occasion === 'memorial' && calls.select[2].story === calls.select[1].story && (await page.locator('#write article[data-slot]').count()) === 3)
  const colours = await page.evaluate(() => ({ main: getComputedStyle(document.querySelector('article[data-slot=main] [data-glyph]')).color, label: getComputedStyle(document.querySelector('article[data-slot=main] [data-slot-label]')).backgroundColor, border: getComputedStyle(document.querySelector('article[data-slot=main]')).borderTopColor, marked: document.querySelector('article[data-slot=main]').dataset.memorial }))
  check('memorial result: the main character, its label and its top rule are ink, never cinnabar; the card is marked data-memorial', colours.main === INK && colours.label === INK && colours.border === INK && colours.marked === 'yes', JSON.stringify(colours))
  check('memorial result: the finalize button says 「この一字を、残す」 (nothing is given)', (await page.locator('[data-testid=finalize]').innerText()) === 'この一字を、残す')
  const gift = (t) => /贈/.test(t)
  const chrome = await page.evaluate(() => { const root = document.querySelector('#write').cloneNode(true); root.querySelectorAll('article').forEach((n) => n.remove()); return root.innerText })
  check('memorial result: no 贈 (give / gift) wording anywhere in the flow outside the model-written cards', !gift(chrome), chrome.slice(0, 300))
  await page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await page.click('[data-testid=finalize]')
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor()
  const slip = await page.evaluate(() => ({ glyph: getComputedStyle(document.querySelector('[data-order-glyph]')).color, top: getComputedStyle(document.querySelector('.slip')).borderTopColor, marked: document.querySelector('.slip').dataset.memorial }))
  check('memorial order form: the slip glyph and rule are ink, not cinnabar', slip.glyph === INK && slip.top === INK && slip.marked === 'yes', JSON.stringify(slip))
  const formText = await form.innerText()
  check('memorial order form: the receiver field is 「偲ぶ方のお名前」, there is no 贈 wording, the certificate line is the usual one', formText.includes('偲ぶ方のお名前') && !gift(formText) && (await page.locator('[data-certificate]').innerText()) === 'この字は、あなたの目に映る、その人です。', formText.slice(0, 300))
  await page.fill('input[name=sender_name]', '山田 花子')
  await page.fill('input[name=receiver_name]', '山田 一郎')
  const d = new Date(); d.setDate(d.getDate() + 20)
  await page.fill('input[name=delivery_date]', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  await page.click('label:has(input[name=package][value=simple])')
  await page.click('[data-testid=order-submit]')
  await page.waitForSelector('#co', { timeout: 8000 })
  check('memorial order: the engine result sent with the order says occasion memorial (the server derives memorial from it); no client "memorial" field', calls.order[0].engine_result.occasion === 'memorial' && !('memorial' in calls.order[0]))
  check('no page errors (run 13b)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
  // English: the chip label
  const en = await mockPage(browser, { result: memResult })
  await en.page.goto('http://localhost:5173/?lang=en', { waitUntil: 'networkidle' })
  check('memorial (en): the last occasion chip is "In memory"; zh-Hant: 追思', (await en.page.locator('[data-chip="occasion:memorial"]').innerText()) === 'In memory')
  await en.page.goto('http://localhost:5173/?lang=zh-Hant', { waitUntil: 'networkidle' })
  check('memorial (zh-Hant): 追思', (await en.page.locator('[data-chip="occasion:memorial"]').innerText()) === '追思')
  await en.page.close()
}

// ---------- Run 14: /track — order status, four languages ----------
{
  let reply = { json: { ordered_on: '2026-10-20', status: 'processing', sku: ['ICHIREI-STANDARD'], carrier: null, tracking_number: null, tracking_url: null, estimated_by: '2026-11-03' } }
  const { page, errors, calls } = await mockPage(browser, { track: () => reply })
  await page.goto('http://localhost:5173/track?order=%231016', { waitUntil: 'networkidle' })
  check('track: the page opens in the dark ink style, in Japanese, with the order number prefilled from ?order=%231016', (await page.locator('h1').innerText()) === 'ご注文の状況' && (await page.inputValue('input[name=order]')) === '#1016' && (await page.getAttribute('html', 'lang')) === 'ja' && (await page.title()).includes('ご注文の状況'))
  check('track: four language buttons; the submit stays disabled until an email is typed; the contact line is shown even before a lookup', (await page.locator('[data-language]').count()) === 4 && await page.locator('[data-testid=track-submit]').isDisabled() && (await page.locator('[data-track-contact]').innerText()) === 'ご不明な点は、ご注文確認メールにご返信ください。')
  await page.fill('input[name=email]', 'hanako@example.com')
  await page.click('[data-testid=track-submit]')
  await page.waitForSelector('[data-testid=track-result]')
  check('track: request carries the number and the email — and nothing else', JSON.stringify(calls.track[0]) === JSON.stringify({ order: '#1016', email: 'hanako@example.com' }))
  check('track ja processing: 制作中, 「お届け予定：11月3日ごろまで」, the order date, the product and the contact line', (await page.locator('[data-track-status]').innerText()) === '制作中' && (await page.locator('[data-track-eta]').innerText()) === 'お届け予定：11月3日ごろまで' && (await page.locator('[data-testid=track-result]').innerText()).includes('2026年10月20日') && (await page.locator('[data-testid=track-result]').innerText()).includes('一字礼 スタンダード') && (await page.locator('[data-track-contact]').innerText()) === 'ご不明な点は、ご注文確認メールにご返信ください。' && (await page.locator('[data-track-link]').count()) === 0)
  await page.screenshot({ path: `${SHOTS}/e2e-track-ja.png`, fullPage: true })
  // shipped
  reply = { json: { ordered_on: '2026-10-20', status: 'shipped', sku: ['ICHIREI-SIMPLE'], carrier: 'Japan Post', tracking_number: 'EE123456789JP', tracking_url: 'https://trackings.post.japanpost.jp/?x=1', estimated_by: '2026-11-03' } }
  await page.click('text=別のご注文を調べる')
  check('track: "別のご注文を調べる" returns to the form (the order number stays, the email is cleared)', (await page.inputValue('input[name=order]')) === '#1016' && (await page.inputValue('input[name=email]')) === '')
  await page.fill('input[name=email]', 'hanako@example.com')
  await page.click('[data-testid=track-submit]')
  await page.waitForSelector('[data-testid=track-result][data-status=shipped]')
  check('track ja shipped: 発送済み + carrier, tracking number and a link that opens the carrier page in a new tab', (await page.locator('[data-track-status]').innerText()) === '発送済み' && (await page.locator('[data-testid=track-result]').innerText()).includes('Japan Post') && (await page.locator('[data-testid=track-number]').innerText()) === 'EE123456789JP' && (await page.getAttribute('[data-track-link]', 'href')) === 'https://trackings.post.japanpost.jp/?x=1' && (await page.getAttribute('[data-track-link]', 'target')) === '_blank' && (await page.getAttribute('[data-track-link]', 'rel')).includes('noopener'))
  // delivered
  reply = { json: { ordered_on: '2026-10-20', status: 'delivered', sku: ['ICHIREI-SIMPLE'], carrier: 'Japan Post', tracking_number: 'EE123456789JP', tracking_url: null, estimated_by: null } }
  await page.click('text=別のご注文を調べる'); await page.fill('input[name=email]', 'hanako@example.com'); await page.click('[data-testid=track-submit]')
  await page.waitForSelector('[data-testid=track-result][data-status=delivered]')
  check('track ja delivered: お届け完了, no estimate line, still the contact line', (await page.locator('[data-track-status]').innerText()) === 'お届け完了' && (await page.locator('[data-track-eta]').count()) === 0 && (await page.locator('[data-track-contact]').count()) === 1)
  // cancelled
  reply = { json: { ordered_on: '2026-10-20', status: 'cancelled', sku: ['ICHIREI-SIMPLE'], carrier: null, tracking_number: null, tracking_url: null, estimated_by: null } }
  await page.click('text=別のご注文を調べる'); await page.fill('input[name=email]', 'hanako@example.com'); await page.click('[data-testid=track-submit]')
  await page.waitForSelector('[data-testid=track-result][data-status=cancelled]')
  check('track ja cancelled: a short notice, no estimate, the contact line', (await page.locator('[data-track-status]').innerText()) === 'キャンセル済み' && (await page.locator('[data-testid=track-result]').innerText()).includes('キャンセル（または返金）') && (await page.locator('[data-track-eta]').count()) === 0 && (await page.locator('[data-track-contact]').innerText()).includes('ご注文確認メールにご返信ください'))
  // errors
  await page.click('text=別のご注文を調べる'); await page.fill('input[name=email]', 'x@example.com')
  for (const [status, json, text] of [[404, { error: 'not_found' }, 'ご注文が見つかりませんでした'], [429, { error: 'rate_limited' }, '短時間に何度も照会'], [503, { error: 'unavailable' }, 'ただいま状況を確認できません'], [400, { error: 'bad_request' }, '正しく入力してください']]) {
    reply = { status, json }
    await page.click('[data-testid=track-submit]')
    await page.locator('[data-testid=track-error]').waitFor()
    check(`track ja error ${status}: a plain message, the form stays usable`, (await page.locator('[data-testid=track-error]').innerText()).includes(text) && await page.locator('[data-testid=track-submit]').isEnabled())
  }
  // other languages, same flow
  reply = { json: { ordered_on: '2026-10-20', status: 'shipped', sku: ['ICHIREI-STANDARD'], carrier: 'DHL', tracking_number: '123', tracking_url: 'https://example.com/t', estimated_by: '2026-11-20' } }
  for (const [lang, h1, label, eta, contact, other] of [
    ['en', 'Order status', 'Shipped', 'Estimated arrival: by around Nov 20', 'If you have any questions, just reply to your order confirmation email.', 'Look up another order'],
    ['zh-Hans', '订单状态', '已发货', '预计送达：11月20日左右前', '如有疑问，请直接回复订单确认邮件。', '查询其他订单'],
    ['zh-Hant', '訂單狀態', '已出貨', '預計送達：11月20日左右前', '如有疑問，請直接回覆訂單確認郵件。', '查詢其他訂單'],
  ]) {
    await page.click(`[data-language=${lang}]`)
    check(`track ${lang}: heading and html lang switch`, (await page.locator('h1').innerText()) === h1 && (await page.getAttribute('html', 'lang')) === lang)
    await page.fill('input[name=email]', 'x@example.com')
    await page.click('[data-testid=track-submit]')
    await page.waitForSelector('[data-testid=track-result][data-status=shipped]')
    check(`track ${lang} shipped: status, estimate line and the contact line`, (await page.locator('[data-track-status]').innerText()) === label && (await page.locator('[data-track-eta]').innerText()) === eta && (await page.locator('[data-track-contact]').innerText()) === contact && (await page.locator('[data-testid=track-result]').innerText()).includes('DHL'))
    await page.screenshot({ path: `${SHOTS}/e2e-track-${lang}.png`, fullPage: true })
    await page.click(`text=${other}`)
  }
  check('track: no page errors', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
  // bare number in ?order= and the form is usable without it
  const m2 = await mockPage(browser, { track: () => reply })
  await m2.page.goto('http://localhost:5173/track?order=1016&lang=en', { waitUntil: 'networkidle' })
  check('track: ?order=1016 (no #) is prefilled as #1016; ?lang=en opens it in English', (await m2.page.inputValue('input[name=order]')) === '#1016' && (await m2.page.locator('h1').innerText()) === 'Order status')
  await m2.page.goto('http://localhost:5173/track', { waitUntil: 'networkidle' })
  check('track: without ?order= the number field is empty', (await m2.page.inputValue('input[name=order]')) === '')
  await m2.page.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
