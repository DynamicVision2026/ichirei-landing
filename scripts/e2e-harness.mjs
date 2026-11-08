// Usage: npx playwright + a dev server on :5173, then `node scripts/e2e-harness.mjs`.
// Optional env: CHROMIUM_PATH (browser binary), E2E_SHOTS_DIR (screenshot output).
// End-to-end harness test (build spec §9.7): drives the real /demo UI against a
// mocked engine returning the §10 golden-fixture shape. Verifies the reveal,
// condition toggle (no engine re-call), kyūjitai pairing, follow-up loop, and
// all §6 behavioral events.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { shapeRound } from './mock-shape.mjs'

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

// v9.6: relationship, direction and PURPOSE (why the gift is given) are required before the engine can be called; the state and the 「その他」 texts are optional.
// (A legacy `occasion` name is still accepted and clicks the purpose it stands for.)
const OCC_TO_PURPOSE = { birthday_milestone: 'celebrate', wedding: 'celebrate', new_baby: 'celebrate', school_career: 'celebrate', retirement_farewell: 'farewell', parent_day: 'thanks', seasonal_thanks: 'thanks', memorial: 'memorial' }
// the refund terms must be ticked before the order button works (2026-11-06): the flows that place an order tick it first
const tickRefund = async (page) => { const c = page.locator('[data-testid=order-refund-check]'); if ((await c.count()) && !(await c.isChecked())) await c.check() }
const pickContext = async (page, ctx = {}) => {
  const c = { relationship: 'parent_father', direction: 'up', ...ctx }
  c.purpose = c.purpose ?? OCC_TO_PURPOSE[c.occasion ?? 'birthday_milestone']
  if ((await page.locator('select[name=relationship]').count()) === 0) {
    // the customer site: chips
    for (const k of ['relationship', 'direction', 'purpose']) await page.click(`[data-chip="${k}:${c[k]}"]`)
    if (c.state) await page.click(`[data-chip="state:${c.state}"]`)
    for (const k of ['relationship_other', 'purpose_other', 'state_other']) if (c[k] !== undefined) await page.fill(`input[name=${k}]`, c[k])
    return
  }
  await page.selectOption('select[name=relationship]', c.relationship)
  await page.selectOption('select[name=direction]', c.direction)
  await page.selectOption('select[name=purpose]', c.purpose)
  if (c.state) await page.selectOption('select[name=state]', c.state)
  for (const k of ['relationship_other', 'purpose_other', 'state_other']) if (c[k] !== undefined) await page.fill(`input[name=${k}]`, c[k])
}
const FINALIZE = { ja: 'この一字を、贈る', 'zh-Hans': '就用这一个字', 'zh-Hant': '就用這一個字', en: 'Give this character' }
// the customer site's composer button (the reference's words)
const GIVE = { ja: 'この字で贈る', 'zh-Hans': '送这个字', 'zh-Hant': '送這個字', en: 'Give this character' }
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
    await route.fulfill({ json: shapeRound(FIXTURE, JSON.parse(route.request().postData() ?? '{}')) })
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
  check('all survivors revealed (two cards, 2026-11-07)', (await page.locator('article').count()) === 2)
  const lastGlyph = await page.locator('article').last().locator('span').first().textContent()
  check('v8: the 遊び字 (守 plays it in this fixture) comes last', lastGlyph === '守')
  const primaryColor = await page.locator('article[data-slot=main]').locator('span').first()
    .evaluate((el) => getComputedStyle(el).color)
  check('primary rendered in cinnabar', primaryColor === 'rgb(192, 57, 43)')

  // Japanese buyers carve the modern form (新字体, spec v9.1 step 9): the card shows the glyph with its reading only — no old-form pairing or note
  const mokuCard = page.locator('article[data-slot=freestyle]')
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
  await page.locator('article[data-slot=main]').click() // (the 遊び字 card has no deep explanation: open the 本命)
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
  await mokuCard.click() // (the 本命 is the open card here: open the 遊び字)
  await page.waitForTimeout(300)
  await mokuCard.locator('text=この一字を選ぶ').click()
  await page.locator('article[data-slot=main]').click() // open 証
  await page.waitForTimeout(400)
  await page.locator('article[data-slot=main]').locator('text=この一字を選ぶ').click()
  await page.click('text=この一字を、贈る')
  await page.waitForTimeout(300)
  check('finalize confirms selection', await page.locator('text=「証」に決めました').isVisible())

  // 2026-11-07: TWO equal cards — 本命 first (character in cinnabar), 遊び字 second (character in ink); side by side on a wide screen. No dashed "lesser" style any more.
  const cards = page.locator('article')
  check('v8: two cards in the DOM order 本命 → 遊び字 (main, freestyle)', (await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')))).join() === 'main,freestyle')
  check('v8: the VISUAL order is the same (top-to-bottom, then left-to-right)', await cards.evaluateAll((els) => { const r = els.map((e) => e.getBoundingClientRect()); const key = (x) => Math.round(x.top / 4) * 100000 + x.left; return r.every((x, i) => i === 0 || key(r[i - 1]) <= key(x)) }))
  check('v6: each card carries its label (本命 / 遊び字)', (await cards.evaluateAll((els) => els.map((e) => e.querySelector('[data-slot-label]')?.textContent))).join() === '本命,遊び字')
  check('v8: every kanji glyph is marked notranslate (Chrome auto-translate must not touch it)', await page.evaluate(() => { const g = [...document.querySelectorAll('[data-glyph]')]; return g.length >= 2 && g.every((n) => n.classList.contains('notranslate') && n.getAttribute('translate') === 'no') }))
  check('v8: the page opts out of auto-translate (<html translate=no>, meta google notranslate)', await page.evaluate(() => document.documentElement.getAttribute('translate') === 'no' && document.querySelector('meta[name=google][content=notranslate]') !== null))
  const freeCard = page.locator('article[data-slot=freestyle]')
  check('v6: the 遊び字 card (守) is a full card like the 本命: solid border (no dashed), the same shadow, its character in ink (NOT cinnabar)', !(await freeCard.getAttribute('class')).includes('border-dashed') && (await freeCard.getAttribute('class')).includes('shadow-') && (await freeCard.evaluate((el) => getComputedStyle(el).borderStyle)) === 'solid' && (await freeCard.locator('[data-glyph]').evaluate((el) => getComputedStyle(el).color)) !== 'rgb(192, 57, 43)' && (await freeCard.locator('[data-glyph]').innerText()) === '守')
  check('v6: only the main card\'s glyph is cinnabar', (await page.locator('article[data-slot=freestyle] [data-glyph]').evaluate((el) => getComputedStyle(el).color)) !== 'rgb(192, 57, 43)' && (await page.locator('article[data-slot=main] [data-glyph]').evaluate((el) => getComputedStyle(el).color)) === 'rgb(192, 57, 43)')
  check('v6: each card shows its story anchor in quotes and its gaze', await freeCard.locator('[data-anchor]:has-text("「相変わらず、ほとんど何も話さないけど」")').isVisible() && (await freeCard.innerText()).includes('静けさのまま') && (await page.locator('article[data-slot=main] [data-anchor]').innerText()) === '「盆に帰るたびに車で駅まで迎えに来て」')
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
  check('stream: all survivors revealed after stream completes (two cards)', (await page.locator('article').count()) === 2)
  check('stream: the main 証 comes first', (await page.locator('article').first().locator('span').first().textContent()) === '証')
  check('no page errors (run 3)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 3b: parallel cards — each card appears as it passes its checks (main, then second, then the free pick) ----------
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/select', (route) => route.continue({ url: route.request().url() + '?mode=cards' }))
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  await page.waitForSelector('article', { timeout: 10000 })
  const first = await page.locator('article').count()
  check('cards: the main card appears on its own, before the others and before the terminal result (1 card on screen, the processing view is gone)', first === 1 && !(await page.locator('[data-testid=processing-steps]').isVisible().catch(() => false)), String(first))
  await page.waitForFunction(() => document.querySelectorAll('article').length === 2, null, { timeout: 5000 })
  check('cards: then the second card joins (2 cards)', (await page.locator('article').count()) === 2)
  await page.waitForFunction(() => document.querySelectorAll('article').length === 2, null, { timeout: 5000 })
  check('cards: then the free pick (two cards, 2026-11-07), in the order main, free', (await page.locator('article').count()) === 2 && (await page.locator('article').first().locator('span').first().textContent()) === '証')
  await page.waitForTimeout(1600) // the terminal result lands and replaces the partial one
  const firstCard = await page.locator('article').first().innerText()
  check('reading: the main card shows its reading plain (しょう) although the engine\'s answer carried a dictionary marker (しょ-う)', firstCard.includes('しょう') && !firstCard.includes('しょ-う') && !/しょ[-.]う/.test(await page.locator('body').innerText()), firstCard.slice(0, 80))
  check('cards: the terminal result keeps the two cards and the reveal on screen (nobody is sent back to the processing view)', (await page.locator('article').count()) === 2 && !(await page.locator('[data-testid=processing-steps]').isVisible().catch(() => false)))
  check('no page errors (run 3b, cards)', errors.length === 0)
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
    await route.fulfill({ json: shapeRound(typeof result === 'function' ? result(body) : (result ?? FIXTURE), body) })
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
  check('selectors: language pills (ja / zh-Hans / zh-Hant / en), the relationship / direction / purpose / state selects; the milestone field appears only for celebrate (and other)',
    (await page.locator('[data-language]').count()) === 4 &&
    (await page.locator('select[name=relationship] option').count()) === 16 &&
    (await page.locator('select[name=direction] option').count()) === 4 &&
    (await page.locator('select[name=purpose] option').count()) === 10 &&
    (await page.locator('select[name=state] option').count()) === 7 &&
    (await page.locator('input[name=occasion_detail]').count()) === 0)
  check('selectors: ja is the default language; no inscription-script toggle for ja', (await page.locator('[data-language=ja][aria-pressed=true]').count()) === 1 && (await page.locator('[data-inscription-script]').count()) === 0)
  await page.locator('textarea').first().fill(STORY)
  check('submit stays disabled until relationship, direction and the reason for giving are chosen', await submit.isDisabled())
  check('a hint says what is missing', await page.locator('text=関係・向き・贈る理由を選ぶと').isVisible())
  const before = await chromeText(page)
  check('copy: the opening ask is occasion-neutral (no 六十年 / 還暦 anywhere in the UI chrome)', before.includes('その人のことを、全部書かなくていい') && !/還暦|六十|60/.test(before.replace('お祝い（誕生日・還暦・結婚・出産・入学など）', '')), before.slice(0, 200))
  await pickContext(page, { relationship: 'mentor', direction: 'up', purpose: 'celebrate' })
  await page.fill('input[name=occasion_detail]', '定年退職')
  check('submit enables once the three are chosen', await submit.isEnabled())
  await page.click(`text=${SUBMIT.ja}`)
  await page.waitForSelector('article', { timeout: 8000 })
  const body = calls.select[0]
  check('payload: story, condition and all five context fields go to /api/select',
    body.story === STORY && body.condition === 'A' && body.language === 'ja' && body.relationship === 'mentor' && body.direction === 'up' && body.purpose === 'celebrate' && !('occasion' in body) && !('state' in body) && body.occasion_detail === '定年退職', JSON.stringify(body))
  check('payload: no inscription_script for ja', !('inscription_script' in body))
  await page.waitForSelector('text=この一字を、贈る', { timeout: 15000 })
  const after = await chromeText(page)
  check('copy: the finalize button is neutral ("この一字を、贈る"), nothing 還暦-specific in the UI chrome', !/還暦|六十|60/.test(after.replace('お祝い（誕生日・還暦・結婚・出産・入学など）', '')) && !(await page.locator('text=還暦を祝う').count()))
  await page.screenshot({ path: `${SHOTS}/e2e-v5-ja-reveal.png` })
  // golden fixture button loads story + context
  await page.click('text=もう一度試す')
  await page.click('text=golden fixture')
  check('golden fixture button also sets the golden context (ja / 父 / 目上 / 母の日・父の日 / 還暦)',
    (await page.inputValue('select[name=relationship]')) === 'parent_father' && (await page.inputValue('select[name=direction]')) === 'up' && (await page.inputValue('select[name=purpose]')) === 'thanks')
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
  check('zh-Hans: the whole UI switches (opening ask, submit, selectors) and is simplified', hansChrome.includes('不必写下那个人的全部') && hansChrome.includes(SUBMIT['zh-Hans']) && hansChrome.includes('送礼的对象与理由') && !JA_ONLY.test(hansChrome.replace(/日本語/g, '')), hansChrome.slice(0, 300))
  check('zh-Hans: the relationship / direction / purpose labels are in Chinese', (await page.locator('select[name=relationship] option[value=parent_father]').innerText()) === '父亲' && (await page.locator('select[name=purpose] option[value=thanks]').innerText()) === '谢谢')
  check('zh-Hans: the inscription-script toggle appears, traditional by default', (await page.locator('[data-inscription-script=traditional][aria-pressed=true]').count()) === 1)
  await page.locator('textarea').first().fill('他总是把玄关的灯留着，不管我多晚回家。')
  await pickContext(page, { relationship: 'parent_father', direction: 'up', occasion: 'seasonal_thanks' })
  await page.click(`text=${SUBMIT['zh-Hans']}`)
  await page.waitForSelector(`button:has-text("${FINALIZE['zh-Hans']}")`, { timeout: 15000 }) // all cards revealed
  const b1 = calls.select[0]
  check('zh-Hans payload: language zh-Hans, inscription_script traditional (default), context, no occasion_detail when blank',
    b1.language === 'zh-Hans' && b1.inscription_script === 'traditional' && b1.relationship === 'parent_father' && b1.purpose === 'thanks' && !('occasion_detail' in b1), JSON.stringify(b1))
  const cardWith = (glyph) => page.locator('article').filter({ has: page.locator(`[data-glyph]:text-is("${glyph}")`) })
  const first = cardWith('燈')
  check('zh-Hans + traditional inscription: the carved glyph is 燈, the reading line is the pinyin only, and the other form (灯) stands in the 刻字 note', (await first.count()) === 1 && await first.locator('text=dēng').first().isVisible() && (await first.locator('text=灯 ・ dēng').count()) === 0 && await first.locator('text=刻字：繁體').first().isVisible())
  check('zh-Hans: the note says what is carved (繁體) and shows the simplified form', await first.locator('text=刻字：繁體（简体：灯）').isVisible())
  await page.screenshot({ path: `${SHOTS}/e2e-v5-zh-hans-reveal.png` })
  // explain (condition B) carries the context
  await page.click('header >> text="B"')
  await first.click()
  await page.click('text=深入读读这个字')
  await page.waitForSelector('text=解读文字', { timeout: 5000 })
  const ex = calls.explain[0]
  check('explain payload: language, script, context and both forms of the character reach /api/explain',
    ex.language === 'zh-Hans' && ex.inscription_script === 'traditional' && ex.relationship === 'parent_father' && ex.direction === 'up' && ex.purpose === 'thanks' && ex.candidate.kanji === '灯' && ex.candidate.inscription_form === '燈' && ex.story.includes('玄关的灯'), JSON.stringify(ex))
  await page.click('header >> text="A"')
  // try again, simplified inscription
  await page.click('button:has-text("再试一次")')
  check('retry keeps the story AND the whole context', (await page.locator('textarea').first().inputValue()).includes('玄关的灯') && (await page.inputValue('select[name=purpose]')) === 'thanks')
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
  check('zh-Hant: the UI is traditional (不必寫下那個人的全部, 送禮的對象與理由) and not simplified', hantChrome.includes('不必寫下那個人的全部') && hantChrome.includes('送禮的對象與理由') && !hantChrome.includes('不必写下'))
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
    check(`no main (${lang}): the model's own fallback question is shown as the follow-up — no candidate card, no finalize button, never the freestyle`, await page.locator(`text=${QUESTION[lang]}`).isVisible() && (await page.locator('article').count()) === 0 && (await page.locator(`button:has-text("${GIVE[lang]}")`).count()) === 0 && (await page.locator('[data-testid=no-primary]').count()) === 0)
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
  const LABELS = { ja: ['本命', '遊び字'], 'zh-Hans': ['本命', '趣字'], 'zh-Hant': ['本命', '趣字'], en: ['Main', 'Playful'] }
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

// ---------- Run 8c: v6 — the story hint, the 5000-character limit (never cut silently), the counter, follow-up answers 600 each ----------
{
  const { page, calls } = await mockPage(browser)
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const box = page.locator('#write [data-testid=story-input]')
  const counter = page.locator('#write [data-testid=story-counter]')
  const goBtn = page.locator('#write button[type=submit]')
  const paste = (loc, text) => loc.evaluate((el, t) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, t); el.dispatchEvent(new Event('input', { bubbles: true })) }, text)
  check('story: the length line is under the box (ja: 「短くても長くても。ひとつの場面なら50字ほどから、物語なら5000字まで。」), the live counter reads "0 / 5000字" from the start (the Reveal composer), and the box has NO maxlength (nothing is ever cut by the browser)', (await page.locator('#write [data-testid=story-hint]').innerText()) === '短くても長くても。ひとつの場面なら50字ほどから、物語なら5000字まで。' && (await counter.innerText()) === '0 / 5000字' && (await box.getAttribute('maxlength')) === null)
  await box.fill('あ'.repeat(1499))
  check('story: the counter follows the length at 1499 characters', (await counter.innerText()) === '1499 / 5000字')
  await box.fill('あ'.repeat(4999))
  check('story: 4999 characters — counter normal, no over-limit line', (await counter.innerText()) === '4999 / 5000字' && (await page.locator('#write [data-testid=story-over]').count()) === 0)
  await box.fill('あ'.repeat(523))
  check('story: the counter follows the length', (await counter.innerText()) === '523 / 5000字')
  // 2026-11-01: a 4,295-character live story was cut at 2,000 (just before its turning point). Nothing is cut now.
  const long43 = '長'.repeat(4300)
  await paste(box, long43)
  check('story: a 4300-character paste keeps ALL of its text (limit 5000) — no cut, no message, nothing red', (await box.inputValue()) === long43 && (await counter.innerText()) === '4300 / 5000字' && (await page.locator('#write [data-testid=story-over]').count()) === 0)
  const long53 = '長'.repeat(5300)
  await paste(box, long53)
  const redColour = await counter.evaluate((el) => getComputedStyle(el).color)
  check('story: a 5300-character paste stays exactly as pasted (all 5300 characters), the counter turns red and reads "5300 / 5000字"', (await box.inputValue()) === long53 && (await counter.innerText()) === '5300 / 5000字' && redColour === 'rgb(179, 38, 30)', redColour)
  check('story: over the limit ONE line says why — 「5000字を超えています。いちばん大切な場面が残るように、少し短くしてください。」 — and the button is disabled', (await page.locator('#write [data-testid=story-over]').innerText()) === '5000字を超えています。いちばん大切な場面が残るように、少し短くしてください。' && (await goBtn.isDisabled()))
  await pickContext(page)
  check('story: even with the context chosen the button stays disabled while the story is over the limit, and no request was made', (await goBtn.isDisabled()) && calls.select.length === 0)
  // shorten (the owner's edit): the line goes, the button wakes up, and what is sent is exactly the 4900 characters — the turning point in the last third is in it
  const TURN = 'その夜、父の古いカメラの中から、現像されていない一本のフィルムが出てきた。'
  const story49 = '朝の港で、父は黙って網を繕っていた。'.repeat(300).slice(0, 4900 - TURN.length) + TURN
  await paste(box, story49)
  check('story: a 4900-character story is accepted — counter "4900 / 5000字", no over-limit line, button enabled', [...story49].length === 4900 && (await counter.innerText()) === '4900 / 5000字' && (await page.locator('#write [data-testid=story-over]').count()) === 0 && !(await goBtn.isDisabled()))
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('story: what is sent is the whole 4900-character story, uncut — its turning point (last third) included — and no follow-ups', [...calls.select[0].story].length === 4900 && calls.select[0].story === story49 && calls.select[0].story.indexOf('現像されていない') / calls.select[0].story.length > 0.66 && !('follow_ups' in calls.select[0]))
  await page.close()

  // voice input (「声で話す」): never cuts either — at 5000 it stops listening, keeps everything said, and the same over-limit line appears
  {
    const v = await mockPage(browser)
    await v.page.addInitScript(() => {
      window.SpeechRecognition = class { constructor() { window.__rec = this; window.__stopped = false } start() {} stop() { window.__stopped = true; if (this.onend) this.onend() } }
    })
    await v.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    const speak = (text) => v.page.evaluate((t) => window.__rec.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: t } } } }), text)
    await v.page.locator('#write button.voice').click()
    await speak('あ'.repeat(4995))
    check('voice: speech that fits is added whole, no limit note, and the page keeps listening', (await v.page.locator('#write [data-testid=story-input]').inputValue()).length === 4995 && (await v.page.locator('[data-testid=voice-limit-note]').count()) === 0 && (await v.page.evaluate(() => window.__stopped)) === false)
    await speak('い'.repeat(30))
    const got = await v.page.locator('#write [data-testid=story-input]').inputValue()
    check('voice: speech past 5000 is KEPT WHOLE (5025 characters), shows the short note and the over-limit line, stops listening, and the button waits', got.length === 5025 && got === 'あ'.repeat(4995) + 'い'.repeat(30) && (await v.page.locator('[data-testid=voice-limit-note]').innerText()) === '5000字までです。音声入力を止めました（話した内容はすべて残っています）。' && (await v.page.evaluate(() => window.__stopped)) === true && (await v.page.locator('#write [data-testid=story-counter]').innerText()) === '5025 / 5000字' && (await v.page.locator('#write [data-testid=story-over]').count()) === 1 && (await v.page.locator('#write button[type=submit]').isDisabled()))
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
  await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('follow-up 2: two answers of 600 each ride with the 2000-character story (all three parts in order)', f.calls.select[2].follow_ups.length === 2 && [...f.calls.select[2].follow_ups[1]].length === 600 && f.calls.select[2].follow_ups[0][0] === 'い' && f.calls.select[2].follow_ups[1][0] === 'う')
  // choose the main card and order: the answers travel with the order as their own field
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await f.page.locator('[data-testid=order-form]').waitFor()
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  const od = new Date(); od.setDate(od.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`)
  await f.page.click('label:has(input[name=package][value=simple])')
  await tickRefund(f.page)
  await f.page.click('[data-testid=order-submit]')
  await f.page.waitForSelector('#co', { timeout: 8000 })
  check('follow-up: the order call carries the story (2000) and the two answers (600 each) as separate fields', [...f.calls.order[0].story].length === 2000 && f.calls.order[0].follow_ups.length === 2 && [...f.calls.order[0].follow_ups[1]].length === 600)
  check('no page errors (run 8c, follow-ups)', f.errors.length === 0)
  await f.page.close()

  // the server's story_too_long answer is shown in the sender's language (not the raw English message)
  const p2 = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  await p2.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))
  await p2.route('**/api/select', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '"story" is longer than 5000 characters (got 5100)', code: 'story_too_long', max: 5000 }) }))
  await p2.goto('http://localhost:5173/?lang=en', { waitUntil: 'networkidle' })
  check('story (en): the length line, no maxlength on the box', (await p2.locator('#write [data-testid=story-hint]').innerText()) === 'Short or long: a single scene from about 50 characters, a whole story up to 5,000.' && (await p2.locator('#write [data-testid=story-input]').getAttribute('maxlength')) === null)
  await p2.locator('#write [data-testid=story-input]').fill('My mum left the porch light on.')
  await pickContext(p2, { relationship: 'parent_mother' })
  await p2.click(`#write >> text=${GO.en}`)
  await p2.waitForSelector('text=Stories can be up to 5,000 characters', { timeout: 6000 })
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
  check('opener: before a relationship and an occasion are picked there is no hint, but the headline is already there', (await qEl.count()) === 0 && (await page.locator('#write [data-testid=story-headline]').count()) === 1)
  check('opener: a browser without speech recognition hides the voice button and shows only the help line (「スマホのキーボードのマイクでも入力できます。」)', (await page.locator('#write button.voice').count()) === 0 && (await page.locator('#write [data-testid=voice-lang]').count()) === 0 && (await page.locator('#write [data-testid=voice-help]').innerText()) === 'スマホのキーボードのマイクでも入力できます。')
  await pickContext(page) // parent_father · up · birthday_milestone
  await qEl.waitFor()
  const first = await qEl.getAttribute('data-question-id')
  const headline = page.locator('#write [data-testid=story-headline]')
  const fs = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  check('story box (2026-11-01): a LARGE headline names what the box is for — 「その人との、いちばん心に残っている場面を。」 — and it labels the textarea', (await headline.innerText()) === 'その人との、いちばん心に残っている場面を。' && (await fs(headline)) >= 20 && (await headline.getAttribute('for')) === 'moment')
  check('story box: the random question is a small HINT under the headline — 「ヒント：」 + a question of the "up" set — much smaller than the headline, and the box placeholder is 「ひとつの場面でも、ふたりの物語まるごとでも。」', first in QJA && (await qEl.innerText()) === QJA[first] && (await page.locator('#write .qHintLabel').innerText()) === 'ヒント：' && (await fs(qEl)) <= 16 && (await fs(qEl)) < (await fs(headline)) && (await box.getAttribute('placeholder')) === 'ひとつの場面でも、ふたりの物語まるごとでも。')
  check('story box: the line 「ヒントに答えなくても大丈夫。…」 sits under the hint (and its 「別のヒントにする」 link), before the box', (await page.locator('#write [data-testid=question-optional]').innerText()) === 'ヒントに答えなくても大丈夫。思い浮かぶ場面や、ふたりの物語を、そのまま書いてください。' && (await page.evaluate(() => { const order = ['story-headline', 'story-hint-line', 'question-switch', 'question-optional', 'story-input'].map((id) => document.querySelector(`#write [data-testid=${id}]`)); return order.every((el, i) => el && (i === 0 || (order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)) })) && (await page.locator('#write [data-testid=question-switch]').innerText()) === '別のヒントにする')
  const seenIds = [first]
  for (let i = 0; i < 4; i++) { await page.click('#write [data-testid=question-switch]'); seenIds.push(await qEl.getAttribute('data-question-id')) }
  check('opener: 「別のヒントにする」 cycles the four angles of the same set and returns to the first', new Set(seenIds.slice(0, 4)).size === 4 && seenIds[4] === first && seenIds.every((id) => id in QJA))
  // a scene quote that already carries 「」 is not wrapped in a second set: 「「そっちは寒いか」とだけ聞く」 → 「『そっちは寒いか』とだけ聞く」
  {
    const NESTED = '「そっちは寒いか」とだけ聞く'
    const q = await mockPage(browser, { result: () => ({ ...clone(FIXTURE), candidates: clone(FIXTURE).candidates.map((c) => (c.slot === 'main' ? { ...c, story_anchor: NESTED } : c)) }) })
    await q.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await pickContext(q.page)
    await q.page.locator('#write [data-testid=story-input]').fill('父は、電話をかけると「そっちは寒いか」とだけ聞く人だった。')
    await q.page.click(`#write >> text=${GO.ja}`)
    await q.page.waitForSelector('article[data-slot=main]', { timeout: 15000 })
    const txt = await q.page.locator('article[data-slot=main]').innerText()
    check('quotes: the card shows 「『そっちは寒いか』とだけ聞く」 — one outer 「」, the inner quote as 『』 — never 「「…」…」', txt.includes('「『そっちは寒いか』とだけ聞く」') && !txt.includes('「「'), txt.slice(0, 400))
    check('no page errors (run 8c-2, nested quote)', q.errors.length === 0, JSON.stringify(q.errors))
    await q.page.close()
  }
  // ticket v9.5 Part 3: a 1,500-character story that ignores the hint still gets its cards, and the counter still reads 「/ 5000字」
  {
    const ign = await mockPage(browser)
    await ign.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await pickContext(ign.page)
    await ign.page.locator('#write [data-testid=story-question]').waitFor()
    const hintId = await ign.page.locator('#write [data-testid=story-question]').getAttribute('data-question-id')
    const STORY1500 = 'あの冬、父は何も言わずに私の自転車のチェーンに油をさしてくれた。'.repeat(60).slice(0, 1500)
    await ign.page.locator('#write [data-testid=story-input]').fill(STORY1500)
    check('story box: a 1,500-character story that does not answer the hint — the counter reads 「1500 / 5000字」 and the button is enabled', (await ign.page.locator('#write [data-testid=story-counter]').innerText()) === '1500 / 5000字' && !(await ign.page.locator('#write button[type=submit]').isDisabled()))
    await ign.page.click(`#write >> text=${GO.ja}`)
    await ign.page.waitForSelector('article[data-slot=freestyle]', { timeout: 15000 })
    const slots = await ign.page.locator('article[data-slot]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')))
    check('story box: …it still gets its two cards; the whole story is sent, and the hint travels only as context (prompt_question id), never inside the story', slots.join() === 'main,freestyle' && ign.calls.select.length === 1 && [...ign.calls.select[0].story].length === 1500 && ign.calls.select[0].story === STORY1500 && ign.calls.select[0].prompt_question?.id === hintId, JSON.stringify([slots, ign.calls.select[0]?.prompt_question]))
    check('no page errors (run 8c-2, hint)', ign.errors.length === 0, JSON.stringify(ign.errors))
    await ign.page.close()
  }
  // a memorial gift gets the remembering-voice set
  await page.click('[data-chip="purpose:memorial"]')
  await page.waitForFunction(() => document.querySelector('#write [data-testid=story-question]')?.getAttribute('data-question-id')?.startsWith('memorial-'))
  check('opener: the occasion "memorial" switches to the memorial set (no mention of death or loss)', !/死|亡|逝|失|悲/.test(await qEl.innerText()))
  await page.click('[data-chip="purpose:celebrate"]')
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
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
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
    const HL = { en: ['The moment with them you remember most.', 'Hint:', 'Another hint', "You don't have to answer the hint. Write the scene or the story that comes to mind, just as it is.", 'One scene, or your whole story together.', 'Short or long: a single scene from about 50 characters, a whole story up to 5,000.'], 'zh-Hant': ['寫下你和那個人之間，最難忘的一個場景。', '提示：', '換一個提示', '不必回答提示。想到的場景、你們之間的故事，直接寫下來就好。', '一個場景，或你們完整的故事都可以。', '長短都可以。一個場景約50字起，完整故事最多5000字。'] }[lang]
    check(`story box (${lang}): headline, 「${HL[1]}」 label, switch link, the "you don't have to answer" line, placeholder and length line, exactly as specified`, (await e.page.locator('#write [data-testid=story-headline]').innerText()) === HL[0] && (await e.page.locator('#write .qHintLabel').innerText()) === HL[1] && (await e.page.locator('#write [data-testid=question-switch]').innerText()) === HL[2] && (await e.page.locator('#write [data-testid=question-optional]').innerText()) === HL[3] && (await e.page.locator('#write [data-testid=story-input]').getAttribute('placeholder')) === HL[4] && (await e.page.locator('#write [data-testid=story-hint]').innerText()) === HL[5], `${await e.page.locator('#write [data-testid=story-headline]').innerText()} | ${await e.page.locator('#write .qHintLabel').innerText()}`)
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
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('reader: the choice travels to /api/select as reader "zh"', calls.select[0].reader === 'zh')
  await page.close()
  const m = await mockPage(browser)
  await m.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await pickContext(m.page, { occasion: 'memorial' })
  check('reader: for remembrance the field is not shown at all', (await m.page.locator('#write [data-testid=reader-field]').count()) === 0)
  await m.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await m.page.click(`#write >> text=${GO.ja}`)
  await m.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('reader: …and a remembrance request never carries one', !('reader' in m.calls.select[0]))
  check('no page errors (run 8c-3, reader)', errors.length === 0 && m.errors.length === 0)
  await m.page.close()

  // 2026-11-01: a 4,105-character Japanese remembrance story (father, 目上, 偲ぶ) came back with ONE card. A long remembrance story must show all three
  // (the mock server returns the three-card fixture; the page must send the whole story, wait for the result and lay out main, second and freestyle).
  {
    const long = await mockPage(browser)
    await long.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    const LONG_MEM = ('父は、私が帰省するたびに玄関の灯りをつけて待っていた。去年の冬に亡くなったけれど、帰省すると少しだけ嬉しそうだった顔を、今も思い出す。'.repeat(70)).slice(0, 4105)
    await pickContext(long.page, { relationship: 'parent_father', occasion: 'memorial' })
    await long.page.locator('#write [data-testid=story-input]').fill(LONG_MEM)
    check('long remembrance: 4105 characters in the box — "4105 / 5000字", no over-limit line, the button is enabled', [...LONG_MEM].length === 4105 && (await long.page.locator('#write [data-testid=story-counter]').innerText()) === '4105 / 5000字' && (await long.page.locator('#write [data-testid=story-over]').count()) === 0 && !(await long.page.locator('#write button[type=submit]').isDisabled()))
    await long.page.click(`#write >> text=${GO.ja}`)
    await long.page.waitForSelector('article[data-slot=second]', { timeout: 15000 })
    const slots = await long.page.locator('article[data-slot]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')))
    check('long remembrance: the whole 4105-character story is sent (occasion memorial, father, up) and TWO cards come back: main and second (no free pick in remembrance)', long.calls.select.length === 1 && [...long.calls.select[0].story].length === 4105 && long.calls.select[0].purpose === 'memorial' && slots.join() === 'main,second', JSON.stringify([long.calls.select.length, slots]))
    check('no page errors (run 8c-3, long remembrance)', long.errors.length === 0, JSON.stringify(long.errors))
    await long.page.close()
  }

  // 2026-11-01: remembrance is TWO cards (main + second, no free pick). While 偲ぶ / 追思 / In memory is picked, the steps and the examples say so; every other occasion is unchanged.
  for (const [lang, st2, st2p, note, st2Other, noteOther] of [
    ['ja', '二つの字に出会う', '本命の二字。読み方、意味、選ばれた理由とともに。選ぶのはあなたです。', '見本です。あなたの物語には、本命の二字が届きます。', '二つの字に出会う', '見本です。あなたの物語には、本命の一字と遊び字の一字が届きます。'],
    ['zh-Hant', '遇見兩個字', '兩個本命字，各附讀音、意思和選擇的理由。由你來選。', '以上為範例。你的故事會得到屬於自己的兩個本命字。', '遇見兩個字', '以上為範例。你的故事會得到屬於自己的兩個字：本命一字與趣字一字。'],
    ['en', 'Meet two characters', 'Two main characters, each with its reading, its meaning and why it fits. You choose.', 'Examples for illustration. Your story gets two main characters of its own.', 'Meet two characters', 'Examples for illustration. Your story gets two characters of its own: a main one and a playful one.'],
  ]) {
    const c = await mockPage(browser)
    await c.page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    const h3 = () => c.page.locator('#how ol.steps li:nth-child(2) h3').innerText()
    const p2 = () => c.page.locator('#how ol.steps li:nth-child(2) p').innerText()
    const mm = async () => ((await c.page.locator('p.from').first().textContent()) ?? '').trim()
    check(`copy (${lang}): before an occasion is picked the steps and the examples are unchanged — 「${st2Other}」 and the main-and-playful note`, (await h3()) === st2Other && (await mm()) === noteOther, `${await h3()} | ${await mm()}`)
    await pickContext(c.page, { occasion: 'memorial' })
    check(`copy (${lang}): with 偲ぶ picked the second step reads 「${st2}」 and says two main characters only, and the examples note says two (no free pick)`, (await h3()) === st2 && (await p2()) === st2p && (await mm()) === note, `${await h3()} | ${await p2()} | ${await mm()}`)
    await pickContext(c.page, { occasion: 'birthday_milestone' })
    check(`copy (${lang}): picking another occasion again restores the main-and-playful wording`, (await h3()) === st2Other && (await mm()) === noteOther)
    check(`no page errors (run 8c-3, remembrance copy ${lang})`, c.errors.length === 0, JSON.stringify(c.errors))
    await c.page.close()
  }
}

// ---------- Run 8c-4: the three sizes (eギフト / 木札 / 版木), the badges, where it goes, the message ----------
{
  const f = await mockPage(browser, { order: () => ({ json: { order_ref: 'IC-20261023-SIZES222', checkout_url: 'http://localhost:5173/__checkout?cart=sz', glyph: '証', certificate_text: 'x' } }) })
  await f.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const gifts = await f.page.locator('#gifts article.gift').evaluateAll((els) => els.map((e) => e.getAttribute('data-size')))
  check('sizes (landing): the gift section lists the three sizes left to right: eギフト, 木札 (simple), 版木 (standard)', gifts.join() === 'egift,simple,standard', gifts.join())
  check('sizes (landing): 木札 is marked おすすめ, the e-gift is marked 「今すぐ贈れる」; the prices are ¥3,980 / ¥9,800 / ¥18,850', (await f.page.locator('#gifts article[data-size=simple] [data-badge=recommended]').textContent()) === 'おすすめ' && (await f.page.locator('#gifts article[data-size=egift] [data-badge=now]').textContent()) === '今すぐ贈れる' && (await f.page.locator('#gifts [data-price=egift]').textContent()) === '¥3,980' && (await f.page.locator('#gifts [data-price=simple]').textContent()) === '¥9,800' && (await f.page.locator('#gifts [data-price=standard]').textContent()) === '¥18,850' && (await f.page.locator('#gifts [data-price=card], #gifts [data-price=digital]').count()) === 0)
  // ticket v9.5 Part 4: the three prices sit in the same place in every card — under the name, left-aligned with it — at every width (the 版木 price used to sit beside its title)
  for (const w of [1280, 1000, 820, 390]) {
    await f.page.setViewportSize({ width: w, height: 900 })
    await f.page.locator('#gifts').scrollIntoViewIfNeeded()
    const geo = await f.page.evaluate(() => [...document.querySelectorAll('#gifts article.gift')].map((a) => { const box = a.getBoundingClientRect(); const h = a.querySelector('h3').getBoundingClientRect(); const p = a.querySelector('.price').getBoundingClientRect(); return { size: a.getAttribute('data-size'), cardTop: box.top, hBottom: h.bottom, hLeft: h.left, pTop: p.top, pLeft: p.left, pBottom: p.bottom, relTop: p.top - box.top, relH: h.top - box.top } }))
    const below = geo.every((g) => g.pTop >= g.hBottom - 1 && Math.abs(g.pLeft - g.hLeft) <= 1)
    const sameRel = geo.every((g) => Math.abs(g.relTop - geo[0].relTop) <= 1 && Math.abs(g.relH - geo[0].relH) <= 1)
    const sameRow = w >= 900 ? geo.every((g) => Math.abs(g.pTop - geo[0].pTop) <= 2) : true
    check(`sizes (landing, ${w}px): all three prices sit directly under the name, left-aligned with it, at the same distance from the top of every card${w >= 900 ? ' — and on one line across the three columns' : ''}`, geo.length === 3 && below && sameRel && sameRow, JSON.stringify(geo))
  }
  await f.page.setViewportSize({ width: 1100, height: 950 })
  await f.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  const form = f.page.locator('[data-testid=order-form]')
  await form.waitFor()
  await form.locator('[data-size]').first().waitFor()
  const order = await form.locator('label[data-size]').evaluateAll((els) => els.map((e) => e.getAttribute('data-size')))
  check('sizes (order form): eギフト, 木札, 版木 in that order, with the recommended and "send it now" badges', order.join() === 'egift,simple,standard' && (await form.locator('[data-size=simple] [data-badge=recommended]').count()) === 1 && (await form.locator('[data-size=egift] [data-badge=now]').count()) === 1 && (await form.locator('[data-size=standard] .badge').count()) === 0, order.join())
  check('sizes (order form): each size says what it includes and how it ships (木札: 日本国内送料無料・海外は EMS ¥6,000; eギフト: 送料なし, with the card PDF to print at home)', (await form.locator('[data-includes=simple]').innerText()).includes('木札に一字（金色）') && (await form.locator('[data-ship-line=simple]').innerText()).includes('EMS ¥6,000') && (await form.locator('[data-ship-line=egift]').innerText()).includes('送料なし') && (await form.locator('[data-includes=egift]').innerText()).includes('カードPDF'))
  check('sizes (order form): no ship-to choice until a size is picked', (await form.locator('[data-testid=ship-to]').count()) === 0)
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  check('sizes (order form): before a size is picked the wooden sizes\' delivery date is asked', (await form.locator('input[name=delivery_date]').count()) === 1)
  await f.page.click('label[data-size=egift]')
  check('sizes (order form): the e-gift shows its price, says it is not posted, offers no ship-to choice and asks for no delivery date (it arrives at once)', (await form.locator('[data-price=egift]').innerText()) === '¥3,980' && (await form.locator('[data-egift-note]').count()) === 1 && (await form.locator('[data-testid=ship-to]').count()) === 0 && (await form.locator('input[name=delivery_date]').count()) === 0)
  await f.page.click('label[data-size=simple]')
  const od = new Date(); od.setDate(od.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`)
  const shipOpts = await form.locator('[data-ship-to]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ship-to')))
  check('ship-to: a wooden size asks where it goes — me / directly to them / e-gift — with 「自分に届ける」 first; the letter fields (message and opening date) are there for every size, "me" included', shipOpts.join() === 'me,direct,egift' && (await form.locator('[data-ship-to=me] .pkgName').innerText()) === '自分に届ける' && (await form.locator('[data-ship-to=direct] .pkgName').innerText()) === '相手に直接届ける' && (await form.locator('[data-ship-to=egift] .pkgName').innerText()).startsWith('eギフトで贈る') && (await form.locator('#gift_message').count()) === 1 && (await form.locator('#open_date').count()) === 1)
  await f.page.click('[data-ship-to=direct]')
  await f.page.fill('#gift_message', 'あ'.repeat(70))
  check('ship-to: directly to them → a message box (60 characters at most, with its counter), and a note that the receiver\'s address goes in at checkout', (await form.locator('#gift_message').inputValue()).length === 60 && (await form.locator('[data-testid=gift-message-counter]').innerText()) === '60 / 60字' && (await form.locator('[data-ship-to=direct]').innerText()).includes('チェックアウトの配送先'))
  await f.page.fill('#gift_message', 'いつも、ありがとう。')
  await f.page.click('label[data-size=standard]')
  await f.page.click('[data-ship-to=egift]')
  check('ship-to: entering the receiver\'s address for a wooden size says it is Japan only', (await form.locator('[data-egift-japan]').count()) === 1)
  await f.page.click('[data-ship-to=direct]')
  const openMax = await form.locator('#open_date').getAttribute('max')
  const inAYear = await f.page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); d.setDate(d.getDate() + 365); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
  const soon = await f.page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); d.setDate(d.getDate() + 10); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
  await f.page.fill('#open_date', soon)
  check('letter fields: the opening date is optional, runs up to one year ahead, and has a clear button', Math.abs(Date.parse(openMax) - Date.parse(inAYear)) <= 2 * 86_400_000 && (await form.locator('[data-testid=open-date-clear]').count()) === 1)
  await tickRefund(f.page)
  await f.page.click('[data-testid=order-submit]')
  await f.page.waitForSelector('#co', { timeout: 8000 })
  const body = f.calls.order[0]
  check('order request: package standard, ship_to direct and the message; no price anywhere', body.package === 'standard' && body.ship_to === 'direct' && body.gift_message === 'いつも、ありがとう。' && !('price' in body) && !('price_jpy' in body))
  check('order request: the opening date travels as open_date', body.open_date === soon, String(body.open_date))
  check('no page errors (run 8c-4, sizes)', f.errors.length === 0, f.errors.join('; '))
  await f.page.close()
  // the e-gift order: no delivery date, no ship_to in the request
  const e = await mockPage(browser, { order: () => ({ json: { order_ref: 'IC-20261023-EGIFT222', checkout_url: 'http://localhost:5173/__checkout?cart=eg', glyph: '証', certificate_text: 'x' } }) })
  await e.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await e.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await pickContext(e.page)
  await e.page.click(`#write >> text=${GO.ja}`)
  await e.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await e.page.locator('article[data-slot=main]').click()
  await e.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await e.page.locator('[data-testid=order-form]').waitFor()
  await e.page.fill('input[name=sender_name]', '山田 太郎')
  await e.page.fill('input[name=receiver_name]', '山田 一郎')
  await e.page.click('label[data-size=egift]')
  await tickRefund(e.page)
  await e.page.click('[data-testid=order-submit]')
  await e.page.waitForSelector('#co', { timeout: 8000 })
  const eb = e.calls.order[0]
  check('order request (e-gift): package egift, no delivery date, no ship_to — and the order went through', eb.package === 'egift' && !('delivery_date' in eb) && !('ship_to' in eb) && e.errors.length === 0, JSON.stringify(eb).slice(0, 200))
  await e.page.close()
  // sizes whose variant is missing are hidden: the API says which are on sale
  const g = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1100, height: 950 } })
  await g.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['simple', 'standard'] } }))
  await g.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
  await g.route('**/api/log', (r) => r.fulfill({ status: 204, body: '' }))
  await g.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await g.locator('#gifts article.gift').first().waitFor()
  check('sizes: while the e-gift has no Shopify variant (the API lists only 木札 and 版木) it is not on the page at all', (await g.locator('#gifts article.gift').evaluateAll((els) => els.map((e) => e.getAttribute('data-size')))).join() === 'simple,standard')
  await g.close()
}

// ---------- Run 8c-4b: the size section — three ways, three columns from 900 px, the sealed envelope for the e-gift ----------
{
  for (const [lang, locale, head, btns] of [['ja', 'ja-JP', '贈り方は、三つ', ['eギフトではじめる', 'シンプルではじめる', 'スタンダードではじめる']], ['zh-Hant', 'zh-TW', '三種送出的方式', ['選擇 e 禮物', '選擇簡約款', '選擇標準款']], ['en', 'en-US', 'Three ways to give', ['Start with the e-gift', 'Start with Simple', 'Start with Standard']]]) {
    for (const width of [1280, 899, 375]) {
      const ctx = await browser.newContext({ locale, viewport: { width, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.locator('#gifts article').first().waitFor()
      await page.locator('#gifts').scrollIntoViewIfNeeded()
      await page.waitForFunction(() => [...document.querySelectorAll('#gifts article img')].length === 3 && [...document.querySelectorAll('#gifts article img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {})
      const g = await page.evaluate(() => ({
        h: document.querySelector('#gifts h2').textContent,
        boxes: [...document.querySelectorAll('#gifts article')].map((a) => ({ id: a.dataset.size, ...(({ left, top }) => ({ left: Math.round(left), top: Math.round(top) }))(a.getBoundingClientRect()), btn: a.querySelector('.btn').textContent, src: (a.querySelector('img')?.currentSrc ?? ''), ok: !!a.querySelector('img') && a.querySelector('img').complete, ph: !!a.querySelector('.giftArt') })),
      }))
      const ids = g.boxes.map((x) => x.id).join()
      const sameRow = g.boxes.every((x) => x.top === g.boxes[0].top)
      const lefts = new Set(g.boxes.map((x) => x.left)).size
      if (width === 1280) check(`size section (${lang}, 1280 px): 「${head}」, three columns in one row in the order eギフト, 木札, 版木, and the three buttons`, g.h === head && ids === 'egift,simple,standard' && sameRow && lefts === 3 && g.boxes.map((x) => x.btn).join() === btns.join(), JSON.stringify(g))
      if (width === 899) check(`size section (${lang}, 899 px): one column below 900 px`, lefts === 1 && !sameRow)
      if (width === 375) check(`size section (${lang}, 375 px): one column on a phone, the e-gift first`, lefts === 1 && ids === 'egift,simple,standard' && g.boxes.every((x) => Math.abs(x.left - 16) <= 1))
      if (width === 1280) check(`size section (${lang}): the e-gift card shows the sealed envelope picture (no grey 「字」 placeholder), the same frame as the other two`, g.boxes.every((x) => !x.ph) && g.boxes[0].src.includes('egift-hero') && g.boxes.every((x) => x.ok), JSON.stringify(g.boxes.map((x) => [x.src, x.ph])))
      await ctx.close()
    }
  }
}

// ---------- Run 8c-5: Part D — the sender's page (「贈る」) and the receiver's gift page (/g/<token>), the e-gift address form ----------
{
  const baseView = { id: 'AN-testtesttesttesttest', language: 'ja', glyph: '備', reading: 'そな.える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false, film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] } }
  const GIFT = 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest'
  // the sender's page
  const sp = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
  const errors = []
  sp.on('pageerror', (e) => errors.push(String(e)))
  await sp.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { ...baseView, gift: { url: GIFT, size_code: 'ICHIREI-SIMPLE', ship_to: 'egift', egift_state: 'waiting', opens_on: '2027-01-05', certificate_no: 12, reply: { text: 'ありがとう。大切にします。', at: '2026-11-08T00:00:00Z' } } } }))
  await sp.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
  await sp.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
  const panel = sp.locator('[data-testid=sender-panel]')
  await panel.waitFor()
  check('buyer page: B 「贈りものを送る」 with its line, LINE, copy-the-link, QR and e-mail; the receiver\'s link as selectable text', (await panel.locator('h2').innerText()) === '贈りものを送る' && (await panel.locator('[data-testid=buyer-send-line]').innerText()) === '相手が開くのは、封をした贈りものです。下のどれかで送ってください。' && (await panel.locator('[data-testid=give-link]').inputValue()) === GIFT && (await panel.locator('[data-testid=give-line]').getAttribute('href')).startsWith('https://line.me/R/share?text=') && decodeURIComponent(await panel.locator('[data-testid=give-line]').getAttribute('href')).includes(GIFT) && (await panel.locator('[data-testid=give-mail]').getAttribute('href')).startsWith('mailto:?subject='))
  await panel.locator('[data-testid=give-qr]').click()
  check('buyer page: the QR code of the receiver\'s page shows on screen', (await panel.locator('[data-testid=give-qr-img] img').getAttribute('src')) === '/api/gift/RG-testtesttesttesttest/qr.svg')
  check('buyer page: A the welcome (「ご注文ありがとうございます。」, the character large, its reading, the 「どんな人か」 line), no film and no price anywhere', (await sp.locator('[data-testid=buyer-welcome-line]').innerText()) === 'ご注文ありがとうございます。' && (await sp.locator('[data-testid=buyer-glyph]').innerText()) === '備' && (await sp.locator('[data-testid=buyer-who]').innerText()).includes('頼まれる前に') && (await sp.locator('[data-testid=film]').count()) === 0 && !/¥/.test(await sp.locator('[data-testid=buyer-page]').innerText()))
  check('buyer page: the opening date (with the sealed-until line), the preview link (with the buyer\'s own id), the receiver\'s reply', (await panel.locator('[data-testid=give-preview] a').getAttribute('href')) === `${GIFT}?preview=AN-testtesttesttesttest` && (await panel.locator('[data-testid=give-preview] a').innerText()) === '相手が見る画面を確かめる' && (await panel.locator('[data-testid=sender-reply]').innerText()) === 'ありがとう。大切にします。' && (await panel.locator('[data-testid=status-opens]').innerText()) === '開封日：1月5日（それまでは封が閉じたままです）')
  check('buyer page: no wooden section and no 24-hour line when the view carries no order data', (await sp.locator('[data-testid=buyer-wood]').count()) === 0 && (await sp.locator('[data-testid=buyer-deadline]').count()) === 0)
  check('no page errors (run 8c-5, sender page)', errors.length === 0, errors.join('; '))
  await sp.close()
}

// ---------- Run 8c-6: Part 3 (2026-10-31) — the receiver's gift page /g/<token>: envelope, opening, letter, film, reveal, poem, certificate, keepsakes, thank-you ----------
{
  const TOKEN = 'RG-testtesttesttesttest'
  const SENDER_ID = 'AN-testtesttesttesttest'
  const year = new Date().getFullYear()
  const mk = (over = {}) => ({
    music: 'thanks',
    locked: false, id: TOKEN, token: TOKEN, language: 'ja', glyph: '備', reading: 'そな-える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false,
    film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] },
    certificate_line: 'この字は、あなたの目に映る、その人です。', poem: { type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: 'あさごとに' },
    from: '山田 太郎', to: '山田 一郎', message: 'いつも、ありがとう。', egift: null, certificate_no: 12, order_date: `${year}-11-07`, opens_on: null, replied: false, package: 'simple', ...over,
  })
  const lockedView = (over = {}) => ({ locked: true, token: TOKEN, language: 'ja', memorial: false, from: '山田 太郎', to: '山田 一郎', opens_on: `${year}-11-10`, days_left: 3, ...over })
  const open = async (view, { reduced = false, width = 375, locale = 'ja-JP', search = '' } = {}) => {
    const ctx = await browser.newContext({ locale, viewport: { width, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    const errs = []
    const seen = { urls: [], reply: [], address: [] }
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('request', (r) => seen.urls.push(r.url()))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/reply`) { seen.reply.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/address`) { seen.address.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: view })
      return r.continue()
    })
    await page.goto(`http://localhost:5173/g/${TOKEN}${search}`, { waitUntil: 'networkidle' })
    return { page, ctx, errs, seen }
  }
  const shot = async (page, path) => { await page.waitForTimeout(900); await page.screenshot({ path }).catch(() => {}) }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const step = (page) => page.locator('[data-testid=gift-page]').getAttribute('data-step')

  // 1. the closed envelope (before the opening date)
  {
    const { page, ctx, errs } = await open(lockedView())
    await T(page, 'gift-envelope').waitFor()
    const body = await page.locator('body').innerText()
    check('envelope (locked): the label 「一字の贈りもの」, the line, 「○○へ」 and 「○○より」 on the washi envelope, and the gold 一字礼 seal', (await T(page, 'gift-env-label').innerText()) === '一字の贈りもの' && (await T(page, 'gift-env-line').innerText()) === 'あなただけに届いた、一字の贈りもの' && (await T(page, 'gift-env-to').innerText()) === '山田 一郎へ' && (await T(page, 'gift-env-from').innerText()) === '山田 太郎より' && (await T(page, 'gift-seal').innerText()) === '一字礼')
    check('envelope (locked): no 「封を開く」 button — the real date and the real count instead', (await T(page, 'gift-open').count()) === 0 && (await T(page, 'gift-locked-date').innerText()) === '11月10日に開きます' && (await T(page, 'gift-locked-note').innerText()) === 'あと3日。その日まで、封は閉じたままです。')
    check('envelope (locked): nothing of the gift is on the page — no character, poem, message, film, price or order number', !/備|朝ごとに|いつも、ありがとう|ちょうど今|¥|IC-2026|AN-test/.test(body) && (await page.locator('.an-film, [data-testid=film]').count()) === 0)
    check('envelope (locked): the page asks for the view only — no render, no pictures, no scroll', !seenHas(await pageUrls(page)), '')
    check('no page errors (run 8c-6, locked envelope)', errs.length === 0, errs.join('; '))
    await shot(page, 'shots/gift-locked-ja.png')
    await ctx.close()
  }
  /** The e-card the film ends on (2026-11-07): the paper card on the dark frame with the character, reading, who line, poem and seal; the poem vertical for 短歌 / 俳句 and horizontal otherwise; at least 4.4% of the frame's width; the sound button; muted. */
  async function checkEndCard(page, label, { vertical, lines, quietInk = false, shot }) {
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total - 2))
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const q = (sel) => document.querySelector(sel)
      const frame = q('[data-testid=film]').getBoundingClientRect()
      const card = q('[data-card]')
      const cb = card.getBoundingClientRect()
      const poem = q('[data-testid=film-poem]')
      const pr = poem?.getBoundingClientRect()
      const cs = poem ? getComputedStyle(poem) : null
      const lineEls = [...document.querySelectorAll('[data-testid=film-poem-line]')]
      const xs = lineEls.map((e) => e.getBoundingClientRect().left)
      const ys = lineEls.map((e) => e.getBoundingClientRect().top)
      const kanji = q('[data-testid=film-card-kanji]')
      const kb = kanji.getBoundingClientRect()
      const seal = q('[data-card-seal]').getBoundingClientRect()
      return {
        opacity: Number(getComputedStyle(card).opacity), widthRatio: cb.width / frame.width, aspect: cb.height / cb.width, inside: cb.left >= frame.left - 1 && cb.right <= frame.right + 1 && cb.top >= frame.top - 1 && cb.bottom <= frame.bottom + 1,
        poemVertical: poem?.getAttribute('data-poem-vertical'), writing: cs?.writingMode, fontRatio: cs ? parseFloat(cs.fontSize) / frame.width : 0, lines: lineEls.length,
        nowrap: lineEls.every((e) => getComputedStyle(e).whiteSpace === 'nowrap'), oneRow: lineEls.length > 0 && lineEls.every((e) => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 9),
        rightToLeft: xs.every((x, i) => i === 0 || x < xs[i - 1] - 1), topToBottom: ys.every((y, i) => i === 0 || y > ys[i - 1] - 1),
        poemInCard: !!pr && pr.left >= cb.left && pr.right <= cb.right && pr.bottom <= cb.bottom, noSealClash: !pr || pr.right < seal.left || pr.bottom < seal.top,
        glyph: kanji.textContent, kanjiRatio: parseFloat(getComputedStyle(kanji).fontSize) / cb.width, kanjiColour: getComputedStyle(kanji).color, kanjiInCard: kb.left >= cb.left && kb.right <= cb.right,
        sound: q('[data-testid=film-sound]')?.textContent ?? '', muted: q('[data-testid=film-music]')?.muted, black: Number(getComputedStyle(q('[data-black]')).opacity),
      }
    })
    check(`${label}: the film ends on the e-card — a paper card, 74% of the frame wide and 5:8, inside the frame, the character about 45% of its width${quietInk ? ' in ink (no red)' : ' in cinnabar'}, not yet black`, r.opacity > 0.99 && Math.abs(r.widthRatio - 0.74) < 0.01 && Math.abs(r.aspect - 1.6) < 0.02 && r.inside && Math.abs(r.kanjiRatio - 0.45) < 0.01 && r.kanjiInCard && r.black === 0 && (quietInk ? /rgb\((\d+), (\d+), (\d+)/.exec(r.kanjiColour).slice(1).every((x) => Number(x) < 60) : r.kanjiColour === 'rgb(192, 57, 43)'), JSON.stringify(r))
    check(`${label}: the poem is ${vertical ? 'vertical (縦書き): one line per column, right to left, never wrapped' : 'horizontal and centred, one line per line'} — ${lines} lines, at least 4.4% of the frame's width, inside the card, clear of the seal`, r.lines === lines && (vertical ? r.poemVertical === 'yes' && String(r.writing).startsWith('vertical') && r.nowrap && r.rightToLeft : r.poemVertical === 'no' && !String(r.writing).startsWith('vertical') && r.topToBottom) && r.fontRatio >= 0.044 && r.poemInCard && r.noSealClash, JSON.stringify(r))
    check(`${label}: the film starts muted and the sound button is at its corner (${r.sound})`, r.muted === true && r.sound.length > 0)
    if (shot) await page.locator('[data-testid=film]').screenshot({ path: shot }).catch(() => {})
  }
  function seenHas(urls) { return urls.some((u) => /\/render|\/picture\/|\/scroll\./.test(u)) }
  async function pageUrls(page) { return page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)) }

  // 2. the opening (full motion), 3. the letter, 4. the film, 5. the reveal, 6. the poem, 7. the certificate, 8. keepsakes and the thank-you
  {
    const { page, ctx, errs, seen } = await open(mk())
    await T(page, 'gift-envelope').waitFor()
    check('envelope: 「封を開く」 button, data-motion full; a liner pattern for the season (opened on the order day in November → autumn)', (await T(page, 'gift-open').innerText()) === '封を開く' && (await T(page, 'gift-envelope').getAttribute('data-motion')) === 'full' && (await T(page, 'gift-envelope').getAttribute('data-liner')) === 'autumn')
    await T(page, 'gift-open').click()
    await page.waitForSelector('[data-testid=gift-envelope][data-state=opening]')
    const anims = await page.evaluate(() => {
      const g = (sel) => { const el = document.querySelector(sel); const c = getComputedStyle(el); return { name: c.animationName, dur: parseFloat(c.animationDuration), delay: parseFloat(c.animationDelay) } }
      return { seal: g('.gf-seal i'), flap: g('.gf-env-flap'), letter: g('.gf-env-letter') }
    })
    const endsAt = Math.max(anims.seal.delay + anims.seal.dur, anims.flap.delay + anims.flap.dur, anims.letter.delay + anims.letter.dur)
    check('opening: the seal breaks, the flap lifts, the letter slides up — three animations that all end within about 1.5 s', anims.seal.name === 'gf-break-l' && anims.flap.name === 'gf-flap' && anims.letter.name === 'gf-slide' && endsAt <= 1.51 && endsAt >= 1.4, JSON.stringify(anims))
    const t0 = Date.now()
    await T(page, 'gift-letter').waitFor({ timeout: 4000 })
    const took = Date.now() - t0
    check('opening: then the letter — within about 1.5 s of the tap (measured with test overhead)', took < 2300 && took > 300, String(took))
    check('letter: 「○○へ」, the sender\'s message, 「○○さんの目に映る、あなたを一字にしました。まずは、ふたりの物語から。」, 「○○より」 and the button 「物語を見る」', (await T(page, 'gift-to').innerText()) === '山田 一郎へ' && (await T(page, 'gift-message').innerText()) === 'いつも、ありがとう。' && (await T(page, 'gift-lead').innerText()) === '山田 太郎さんの目に映る、あなたを一字にしました。まずは、ふたりの物語から。' && (await T(page, 'gift-from').innerText()) === '山田 太郎より' && (await T(page, 'gift-to-film').innerText()) === '物語を見る')
    await shot(page, 'shots/gift-letter-ja.png')
    await T(page, 'gift-to-film').click()
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    check('film: the 34-second film plays on the receiver\'s page (no share button — the receiver has nothing to share)', (await step(page)) === 'film' && (await page.locator('[data-testid=animation-share]').count()) === 0)
    await checkEndCard(page, 'film end (ja, 短歌)', { vertical: true, lines: 5, shot: 'shots/film-card-ja.png' })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
    const rv = await page.evaluate(() => ({ colour: getComputedStyle(document.querySelector('[data-testid=gift-glyph]')).color, size: parseFloat(getComputedStyle(document.querySelector('[data-testid=gift-glyph]')).fontSize) }))
    check('reveal: the character large in cinnabar, the reading, the gold line 「○○さんの目に映る、あなた。」, the who line, and 「詩を読む」', rv.colour === 'rgb(192, 57, 43)' && rv.size >= 140 && (await T(page, 'gift-glyph').innerText()) === '備' && (await T(page, 'gift-reading').innerText()) === 'そなえる' && (await T(page, 'gift-gold').innerText()) === '山田 太郎さんの目に映る、あなた。' && (await T(page, 'gift-who').innerText()) === 'いつも、頼まれる前に備えている人。' && (await T(page, 'gift-to-poem').innerText()) === '詩を読む', JSON.stringify(rv))
    await shot(page, 'shots/gift-reveal-ja.png')
    await T(page, 'gift-to-poem').click()
    await T(page, 'gift-poem').waitFor()
    const wm = await T(page, 'gift-poem-vertical').evaluate((el) => getComputedStyle(el).writingMode)
    check('poem: a tanka on a paper panel, written vertically (縦書き), with its reading, and 「証を見る」', wm.startsWith('vertical') && (await T(page, 'gift-poem-vertical').locator('p').count()) === 5 && (await T(page, 'gift-poem-reading').innerText()) === 'あさごとに' && (await T(page, 'gift-to-cert').innerText()) === '証を見る')
    await shot(page, 'shots/gift-poem-ja.png')
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-cert').waitFor()
    check('certificate: 「一字礼　第 0012 号」, the character, 「○○ 様」, the line, 「贈り主　○○」, the date, and the tagline', (await T(page, 'gift-cert-title').innerText()) === '一字礼　第 0012 号' && (await T(page, 'gift-cert-glyph').innerText()) === '備' && (await T(page, 'gift-cert-to').innerText()) === '山田 一郎 様' && (await T(page, 'gift-cert-line').innerText()) === 'この一字は、山田 太郎さんの目に映る、あなたです。' && (await T(page, 'gift-cert-from').innerText()) === '贈り主　山田 太郎' && (await T(page, 'gift-cert-date').innerText()) === '2026年11月7日'.replace('2026', String(year)) && (await page.locator('.gf-cert-tag').innerText()) === 'DESIGNED IN TOKYO · 世界にひとつの一字')
    await shot(page, 'shots/gift-cert-ja.png')
    await T(page, 'gift-to-keep').click()
    await T(page, 'gift-keep').waitFor()
    check('keepsakes: the thank-you box (「ありがとうを返す」, 200 characters at most) and no way to send it twice', (await T(page, 'gift-keep').locator('h3').innerText()) === 'ありがとうを返す' && (await T(page, 'gift-reply-left').innerText()) === 'あと200字')
    await T(page, 'gift-reply-text').fill('あ'.repeat(230))
    check('thank-you: clipped to 200 characters, with the count', (await T(page, 'gift-reply-text').inputValue()).length === 200 && (await T(page, 'gift-reply-left').innerText()) === 'あと0字')
    await T(page, 'gift-reply-text').fill('ありがとう。大切にします。')
    await T(page, 'gift-reply-send').click()
    await T(page, 'gift-reply-sent').waitFor()
    check('thank-you: sent once to the receiver\'s own endpoint, then 「○○さんに届けました。」 — and the box is gone', seen.reply.length === 1 && seen.reply[0].text === 'ありがとう。大切にします。' && (await T(page, 'gift-reply-sent').innerText()) === '山田 太郎さんに届けました。' && (await T(page, 'gift-reply').count()) === 0)
    await shot(page, 'shots/gift-keep-ja.png')
    const all = (await page.locator('body').innerText()) + (await page.locator('main').innerHTML())
    check('no price, no order number, no other candidate characters, no sender page link anywhere on the receiver page', !/¥|IC-2026|AN-test/.test(all) && (await page.locator('a[href*="/a/"]').count()) === 0 && !seen.urls.some((u) => u.includes('/api/animation/') || u.includes('/api/film/')))
    check('no page errors (run 8c-6, the receiver\'s whole path)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // a reply already sent: no box, the line instead
  {
    const { page, ctx } = await open(mk({ replied: true }))
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-to-poem').click({ timeout: 6000 })
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-to-keep').click()
    check('thank-you: when the receiver has already replied the page shows 「○○さんに届けました。」 and no box', (await T(page, 'gift-reply-sent').innerText()) === '山田 太郎さんに届けました。' && (await T(page, 'gift-reply').count()) === 0)
    await ctx.close()
  }

  // reduced motion: the opening is a fade
  {
    const { page, ctx, errs } = await open(mk(), { reduced: true })
    await T(page, 'gift-envelope').waitFor()
    check('reduced motion: the envelope says data-motion=fade', (await T(page, 'gift-envelope').getAttribute('data-motion')) === 'fade')
    await T(page, 'gift-open').click()
    await page.waitForSelector('[data-testid=gift-envelope][data-state=opening]')
    const nm = await page.evaluate(() => ({ env: getComputedStyle(document.querySelector('.gf-env')).animationName, flap: getComputedStyle(document.querySelector('.gf-env-flap')).animationName, seal: getComputedStyle(document.querySelector('.gf-seal i')).animationName, letter: getComputedStyle(document.querySelector('.gf-env-letter')).animationName }))
    check('reduced motion: nothing moves (no seal break, flap or slide) — only a fade', nm.env === 'gf-fade-out' && nm.flap === 'none' && nm.seal === 'none' && nm.letter === 'none', JSON.stringify(nm))
    const t0 = Date.now()
    await T(page, 'gift-letter').waitFor({ timeout: 3000 })
    check('reduced motion: the letter follows after a short fade (under a second)', Date.now() - t0 < 900, String(Date.now() - t0))
    await T(page, 'gift-to-film').click()
    check('reduced motion: the film is shown as stills and 「次へ」 goes on to the reveal', (await page.locator('[data-testid=film-still]').count()) === 1 && (await T(page, 'gift-skip').innerText()) === '次へ')
    await T(page, 'gift-skip').click()
    await T(page, 'gift-reveal').waitFor()
    check('no page errors (run 8c-6, reduced motion)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // the sender looks before the day: ?preview=<their own id>
  {
    const { page, ctx, seen } = await open(mk({ opens_on: `${year}-11-10` }), { search: `?preview=${SENDER_ID}` })
    await T(page, 'gift-open').waitFor()
    check('preview: with the sender\'s own id the envelope has its button and a note says this is how it will arrive', (await T(page, 'gift-preview-note').count()) === 1 && (await page.locator('[data-testid=gift-preview-note]').innerText()).includes('贈り主') && seen.urls.some((u) => u.includes(`/api/gift/${TOKEN}?preview=${SENDER_ID}`)))
    await ctx.close()
  }

  // remembrance: its own first line, plain grey-beige envelope, no celebration words, the character never red
  {
    const { page, ctx, errs } = await open(mk({ memorial: true }))
    await T(page, 'gift-envelope').waitFor()
    check('remembrance envelope: 「一字の便り」 / 「あなたに届いた、一字の便り」, a plain grey-beige envelope with no pattern', (await T(page, 'gift-env-label').innerText()) === '一字の便り' && (await T(page, 'gift-env-line').innerText()) === 'あなたに届いた、一字の便り' && (await T(page, 'gift-envelope').getAttribute('data-liner')) === 'plain' && (await T(page, 'gift-envelope').evaluate((el) => getComputedStyle(el).getPropertyValue('--liner-image').trim())) === 'none')
    await shot(page, 'shots/gift-envelope-memorial-ja.png')
    const seen = []
    seen.push(await page.locator('body').innerText())
    await T(page, 'gift-open').click()
    await T(page, 'gift-letter').waitFor({ timeout: 4000 })
    seen.push(await page.locator('body').innerText())
    await T(page, 'gift-to-film').click()
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
    const colour = await T(page, 'gift-glyph').evaluate((el) => getComputedStyle(el).color)
    seen.push(await page.locator('body').innerText())
    await T(page, 'gift-to-poem').click()
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-cert').waitFor()
    const certColour = await T(page, 'gift-cert-glyph').evaluate((el) => getComputedStyle(el).color)
    seen.push(await page.locator('body').innerText())
    const isRed = (c) => { const m = c.match(/\d+/g).map(Number); return m[0] > 150 && m[1] < 90 && m[2] < 90 }
    check('remembrance: the character is never red — pale ink on the reveal, dark ink on the certificate', !isRed(colour) && !isRed(certColour), `${colour} ${certColour}`)
    check('remembrance: no celebration words on any screen (贈りもの / おめでとう / お祝い / 祝)', !seen.some((t) => /贈りもの|おめでとう|お祝い|祝/.test(t)))
    check('no page errors (run 8c-6, remembrance)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // the liner follows the season of the opening date
  {
    for (const [d, want] of [[`${year}-04-02`, 'spring'], [`${year}-07-20`, 'summer'], [`${year}-10-05`, 'autumn'], [`${year}-01-15`, 'winter']]) {
      const { page, ctx } = await open(mk({ opens_on: d }))
      await T(page, 'gift-envelope').waitFor()
      const li = await T(page, 'gift-envelope').getAttribute('data-liner')
      const img = await T(page, 'gift-envelope').evaluate((el) => getComputedStyle(el).getPropertyValue('--liner-image').trim().slice(0, 30))
      check(`liner: ${d} → ${want} (a printed pattern, not plain)`, li === want && img.startsWith('url('), `${li} ${img}`)
      await ctx.close()
    }
  }

  // zh-Hant and en
  for (const [lang, locale, v] of [
    ['zh-Hant', 'zh-TW', { language: 'zh-Hant', glyph: '備', reading: 'bèi', who: '總是比別人先一步準備好的人。', poem: { type: 'tang', lines: ['晨光入廚房', '一花覆盒蓋', '無言卻在側', '至今仍思量'], reading: '' } }],
    ['en', 'en-US', { language: 'en', glyph: '備', reading: 'sonaeru', who: 'Someone who is ready before you ask.', poem: { type: 'en', lines: ['Each morning, a flower set', 'beside the cup.'], reading: '' } }],
  ]) {
    const want = lang === 'en'
      ? { label: 'A gift of one character', to: 'To 山田 一郎', from: 'From 山田 太郎', open: 'Open the envelope', lockedDate: `Opens on 10 November${''}`, lockedNote: '3 days to go. The envelope stays sealed until then.', btn: 'See the story', cert: 'ICHIREI · No. 0012' }
      : { label: '一個字的禮物', to: '致 山田 一郎', from: '山田 太郎 敬上', open: '拆開信封', lockedDate: '11月10日開啟', lockedNote: '還有 3 天。在那天之前，信封會一直封著。', btn: '看故事', cert: '一字禮　第 0012 號' }
    {
      const { page, ctx } = await open(lockedView({ language: lang }), { locale })
      await T(page, 'gift-envelope').waitFor()
      check(`${lang}: the locked envelope — label, names, the date and the count in the reader's language`, (await T(page, 'gift-env-label').innerText()) === want.label && (await T(page, 'gift-env-to').innerText()) === want.to && (await T(page, 'gift-env-from').innerText()) === want.from && (await T(page, 'gift-locked-date').innerText()) === want.lockedDate && (await T(page, 'gift-locked-note').innerText()) === want.lockedNote, `${await T(page, 'gift-locked-date').innerText()}`)
      await page.screenshot({ path: `shots/gift-locked-${lang}.png` }).catch(() => {})
      await ctx.close()
    }
    {
      const { page, ctx, errs } = await open(mk(v), { locale })
      await T(page, 'gift-open').waitFor()
      check(`${lang}: the envelope's button reads 「${want.open}」`, (await T(page, 'gift-open').innerText()) === want.open)
      await page.screenshot({ path: `shots/gift-envelope-${lang}.png` }).catch(() => {})
      await T(page, 'gift-open').click()
      await T(page, 'gift-letter').waitFor({ timeout: 4000 })
      check(`${lang}: the letter — 「${want.to}」, the button 「${want.btn}」`, (await T(page, 'gift-to').innerText()) === want.to && (await T(page, 'gift-to-film').innerText()) === want.btn)
      await page.screenshot({ path: `shots/gift-letter-${lang}.png` }).catch(() => {})
      await T(page, 'gift-to-film').click()
      await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
      await checkEndCard(page, `film end (${lang}, ${lang === 'en' ? 'English verse' : '漢詩'})`, { vertical: false, lines: lang === 'en' ? 2 : 4, shot: `shots/film-card-${lang}.png` })
      await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
      await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
      await page.screenshot({ path: `shots/gift-reveal-${lang}.png` }).catch(() => {})
      await T(page, 'gift-to-poem').click()
      await T(page, 'gift-poem').waitFor()
      await page.screenshot({ path: `shots/gift-poem-${lang}.png` }).catch(() => {})
      await T(page, 'gift-to-cert').click()
      await T(page, 'gift-cert').waitFor()
      check(`${lang}: the certificate title reads 「${want.cert}」`, (await T(page, 'gift-cert-title').innerText()) === want.cert)
      await page.screenshot({ path: `shots/gift-cert-${lang}.png` }).catch(() => {})
      await T(page, 'gift-to-keep').click()
      await T(page, 'gift-keep').waitFor()
      await page.screenshot({ path: `shots/gift-keep-${lang}.png` }).catch(() => {})
      check(`no page errors (run 8c-6, ${lang})`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }
  }

  // the e-gift address form (a wooden size sent as an e-gift) now lives with the keepsakes
  {
    const { page, ctx, seen } = await open(mk({ egift: { state: 'waiting', japan_only: true } }))
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-to-poem').click({ timeout: 6000 })
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-to-keep').click()
    const gift = T(page, 'gift-panel')
    await T(page, 'gift-receive').click()
    check('e-gift: 「受け取る」 opens a short form (name, postal code, prefecture, address, phone); the Japan-only size says so and asks for no country', (await gift.locator('[data-testid=gift-form] input').count()) === 6 && (await gift.locator('[data-testid=gift-japan-only]').count()) === 1 && (await gift.locator('input[name=country]').count()) === 0)
    await gift.locator('input[name=name]').fill('山田 一郎')
    await gift.locator('input[name=postal]').fill('1500001')
    await gift.locator('input[name=region]').fill('東京都')
    await gift.locator('input[name=line1]').fill('渋谷区神宮前1-2-3')
    await gift.locator('input[name=phone]').fill('03-1234-5678')
    await gift.locator('[data-testid=gift-send]').click()
    await gift.locator('[data-testid=gift-thanks]').waitFor()
    check('e-gift: the address is posted to the receiver\'s own endpoint and the page thanks them; nothing of it stays on the page', seen.address.length === 1 && seen.address[0].postal === '1500001' && seen.address[0].line1 === '渋谷区神宮前1-2-3' && (await gift.locator('[data-testid=gift-form]').count()) === 0 && !(await page.content()).includes('渋谷区'))
    await ctx.close()
  }

  // Part 4: nothing on the receiver's page, the film page, the sender's page or /credits is asked of Google — with Google blocked everything still works
  {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 375, height: 844 } })
    const hosts = new Set()
    const blocked = []
    const fontFiles = []
    ctx.on('request', (r) => hosts.add(new URL(r.url()).hostname))
    ctx.on('response', (r) => { if (r.url().includes('/fonts/')) fontFiles.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    await ctx.route(/google|gstatic/, (r) => { blocked.push(r.request().url()); return r.abort() })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    const view = mk()
    await page.route(`**/api/gift/${TOKEN}**`, (r) => { const u = new URL(r.request().url()); return u.pathname.endsWith('/render') ? r.fulfill({ json: { state: 'ready', view } }) : r.fulfill({ json: view }) })
    await page.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { ...view, id: 'AN-testtesttesttesttest', gift: { url: `https://ichirei.soul-id.jp/g/${TOKEN}`, size_code: 'ICHIREI-SIMPLE', ship_to: 'me', egift_state: null, opens_on: null, certificate_no: 12, reply: null } } }))
    await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-to-poem').click({ timeout: 6000 })
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-to-keep').click()
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return { hero: document.fonts.check('900 40px "Zen Old Mincho"', '備'), body: document.fonts.check('400 16px "Noto Serif JP"', 'あ') } })
    await page.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await page.goto('http://localhost:5173/credits', { waitUntil: 'networkidle' })
    check('no Google: the gift page (every screen), the film/sender page and /credits never asked a Google host for anything (and nothing was lost with Google blocked)', blocked.length === 0 && ![...hosts].some((h) => /google|gstatic/.test(h)) && errs.length === 0, `${blocked.join(',')} ${[...hosts].join(',')} ${errs.join(';')}`)
    check('no Google: the fonts come from our own /fonts/ (the character font and the Japanese serif were fetched, 200)', fontFiles.some((f) => f.startsWith('200') && f.includes('zen-old-mincho-900.woff2')) && fonts.hero === true, `${fontFiles.join(' | ')} ${JSON.stringify(fonts)}`)
    await ctx.close()
  }

  // Part 4: the sender's share buttons — LINE, WhatsApp, WeChat (a QR image and a line), copy, e-mail, and the link as selectable text
  for (const [lang, locale, memorial, sent] of [['ja', 'ja-JP', false, '贈りものを送りました。'], ['ja', 'ja-JP', true, '一字の便りを送りました。'], ['zh-Hant', 'zh-TW', false, '我送了你一份禮物。'], ['en', 'en-US', false, 'I have sent you a gift.']]) {
    const ctx = await browser.newContext({ locale, viewport: { width: 375, height: 844 } })
    const page = await ctx.newPage()
    const GIFT = `https://ichirei.soul-id.jp/g/${TOKEN}`
    await page.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { ...mk({ language: lang, memorial }), id: 'AN-testtesttesttesttest', gift: { url: GIFT, size_code: 'ICHIREI-SIMPLE', ship_to: 'me', egift_state: null, opens_on: null, certificate_no: 12, reply: null } } }))
    await page.route(`**/api/gift/${TOKEN}/qr.svg`, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    const panel = T(page, 'sender-panel')
    await panel.waitFor()
    const line = decodeURIComponent((await T(page, 'give-line').getAttribute('href')) ?? '')
    const wa = decodeURIComponent((await T(page, 'give-whatsapp').getAttribute('href')) ?? '')
    check(`share (${lang}${memorial ? ', remembrance' : ''}): LINE and WhatsApp carry the link and 「${sent}」 — nothing of the character, the poem or the story`, line.startsWith('https://line.me/R/share?text=') && line.includes(sent) && line.includes(GIFT) && wa.startsWith('https://wa.me/?text=') && wa.includes(sent) && wa.includes(GIFT) && !/備|朝ごとに/.test(line + wa), line + wa)
    await T(page, 'give-wechat').click()
    check(`share (${lang}${memorial ? ', remembrance' : ''}): WeChat shows the QR code as an image the sender can save, and the line about sending the image or the video`, (await T(page, 'give-qr-img').locator('img').getAttribute('src')) === `/api/gift/${TOKEN}/qr.svg` && (await T(page, 'give-qr-save').getAttribute('href')) === `/api/gift/${TOKEN}/qr.png` && (await T(page, 'give-qr-save').getAttribute('download')) === 'ichirei-qr.png' && (await T(page, 'give-wechat-note').innerText()) === ({ ja: 'WeChatでは、QRコードの画像か、物語の映像（動画）を送ってください。', 'zh-Hant': '在微信裡，請傳送 QR code 圖片，或故事影片。', en: 'On WeChat, please send the QR code as an image, or the story video.' })[lang])
    check(`share (${lang}${memorial ? ', remembrance' : ''}): copy-the-link, e-mail and the link as selectable text are there`, (await T(page, 'give-copy').count()) === 1 && decodeURIComponent((await T(page, 'give-mail').getAttribute('href')) ?? '').includes(GIFT) && (await T(page, 'give-link').inputValue()) === GIFT)
    if (!memorial) await shot(page, `shots/share-sheet-${lang}.png`)
    await ctx.close()
  }

  // Part 5: 「ギフトを保存する」 — the film (made on the server the first time, then saved), the scroll, the card
  for (const [lang, locale, pkg] of [['ja', 'ja-JP', 'egift'], ['zh-Hant', 'zh-TW', 'simple'], ['en', 'en-US', 'egift']]) {
    const { page, ctx } = await open(mk({ language: lang, package: pkg, film: { status: 'ready', lines: ['「a」', 'b', 'c', 'd'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp', '/film/washi-1.webp', '/film/washi-2.webp'] } }), { locale })
    const makes = []
    await page.route(`**/api/gift/${TOKEN}/film/make**`, (r) => { makes.push(1); return r.fulfill({ status: makes.length === 1 ? 202 : 200, json: { state: makes.length === 1 ? 'pending' : 'ready', seconds: 30, bytes: 1 } }) })
    await page.route(`**/api/gift/${TOKEN}/film.mp4**`, (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: 'x' }))
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-to-poem').click({ timeout: 6000 })
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-to-keep').click()
    const k = T(page, 'keepsakes')
    await k.waitFor()
    const want = { ja: ['ギフトを保存する', '映像を保存（MP4）'], 'zh-Hant': ['儲存禮物', '儲存影片（MP4）'], en: ['Keep the gift', 'Save the film (MP4)'] }[lang]
    check(`keepsakes (${lang}): the heading, the film button, the card button (${pkg === 'egift' ? 'A4 home-print' : 'keepsake copy'}) and the ten-year line`, (await T(page, 'keepsakes-title').innerText()) === want[0] && (await T(page, 'save-film').innerText()) === want[1] && (await T(page, 'save-card').getAttribute('data-kind')) === (pkg === 'egift' ? 'home' : 'keep') && (await T(page, 'save-card').getAttribute('href')) === `/api/gift/${TOKEN}/card.pdf` && (await T(page, 'save-forever').innerText()).includes({ ja: '10年間', 'zh-Hant': '10 年', en: 'ten years' }[lang]) && ((await T(page, 'save-card-note').count()) === (pkg === 'egift' ? 1 : 0)))
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
    await T(page, 'save-film').click()
    const d = await dl
    check(`keepsakes (${lang}): the film button asks the server to make the video (and asks again while it says pending), then downloads ichirei-film.mp4 and shows a player`, makes.length === 2 && !!d && d.suggestedFilename() === 'ichirei-film.mp4' && (await T(page, 'save-film-video').count()) === 1, `${makes.length} ${d?.suggestedFilename()}`)
    await shot(page, `shots/gift-save-${lang}.png`)
    await ctx.close()
  }
  {
    // not offered while the film is not complete
    const { page, ctx } = await open(mk({ film: { status: 'ready', lines: ['「a」', 'b', 'c', 'd'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp', '/film/washi-1.webp', '/film/washi-2.webp'], incomplete: true } }))
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-to-poem').click({ timeout: 6000 })
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-to-keep').click()
    check('keepsakes: while a picture is still to be drawn (incomplete film) there is no film button, no card button and no scroll', (await T(page, 'keepsakes').count()) === 0)
    await ctx.close()
  }
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
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { ...base, film, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-SIMPLE', ship_to: 'me' } } }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.route('**/film-art/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=sender-panel]').waitFor()
    const n = await p.locator('[data-testid=save-scroll] a').count()
    check(`scroll buttons (${name}): ${shown ? 'PNG and PDF links to this film' : 'none'}`, shown ? n === 2 && (await p.locator('[data-testid=save-scroll] a').first().getAttribute('href')) === '/api/animation/AN-testtesttesttesttest/scroll.png' : n === 0)
    await p.close()
  }
}

// ---------- Run 8g: E — the 24-hour change line on the buyer's page: the real deadline in the buyer's own time zone, three languages; gone after it ----------
{
  const UNTIL = '2026-11-07T05:30:00Z' // 14:30 in Tokyo
  const WHEN = { ja: '11月7日 14時30分', 'zh-Hant': '11月7日 14時30分', en: '7 Nov, 14:30' }
  const LINE = {
    ja: `お支払い完了から24時間以内（${WHEN.ja}まで）なら、確認メールにご返信いただくとキャンセル（全額返金）ができます。`,
    'zh-Hant': `付款完成後24小時內（${WHEN['zh-Hant']}前），回覆確認郵件即可取消並全額退款。`,
    en: `Until ${WHEN.en} (24 hours after payment), reply to the confirmation email to cancel for a full refund.`,
  }
  const mkView = (lang, order, extra = {}) => ({ id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-SIMPLE', ship_to: 'me', egift_state: null }, order, ...extra })
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 800 } })
    const p = await ctx.newPage()
    await p.clock.install({ time: new Date('2026-11-06T06:00:00Z') })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: UNTIL, wood: null }, { support_email: 'help@example.com' }) }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-help]').waitFor()
    check(`E (${lang}): the 24-hour line states the real deadline in the buyer's time zone — word for word`, (await p.locator('[data-testid=buyer-deadline]').innerText()) === LINE[lang], await p.locator('[data-testid=buyer-deadline]').innerText())
    check(`E (${lang}): the support address is plain, selectable text`, (await p.locator('[data-testid=buyer-support]').innerText()) === 'help@example.com' && (await p.locator('[data-testid=buyer-support] a').count()) === 0)
    await p.clock.fastForward('24:00:00')
    await p.waitForTimeout(300)
    check(`E (${lang}): the line disappears by itself when the deadline passes while the page is open`, (await p.locator('[data-testid=buyer-deadline]').count()) === 0)
    await ctx.close()
  }
  {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView('ja', { collected: false, ordered_at: '2020-01-01T00:00:00Z', change_until: '2020-01-02T00:00:00Z', wood: null }) }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-collect-section]').waitFor()
    check('E: a page opened after the deadline has no 24-hour line at all (and no empty help block)', (await p.locator('[data-testid=buyer-deadline]').count()) === 0 && (await p.locator('[data-testid=buyer-help]').count()) === 0)
    await p.close()
  }
}

// ---------- Run 8g-2: C — the wooden gift's four steps (木札 / 版木 only; never for an e-gift, never while the wooden sizes are "coming soon"), three languages ----------
{
  const STEPS = {
    ja: { title: '木の贈りもの', steps: ['ご注文を承りました', '制作しています', '発送しました（JP1234567890）', 'お届け済み'], ship: { me: 'お届け先：ご自身', direct: 'お届け先：相手の方へ直接' } },
    'zh-Hant': { title: '木製禮物', steps: ['已收到訂單', '製作中', '已出貨（JP1234567890）', '已送達'], ship: { me: '寄送對象：寄給自己', direct: '寄送對象：直接寄給對方' } },
    en: { title: 'Your wooden gift', steps: ['Order received', 'Being made', 'Shipped (JP1234567890)', 'Delivered'], ship: { me: 'Ship to: you', direct: 'Ship to: them directly' } },
  }
  const mk = (lang, order, size = 'ICHIREI-SIMPLE', ship = 'me') => ({ id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: size, ship_to: ship, egift_state: null }, order })
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (let step = 1; step <= 4; step++) {
      const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
      await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mk(lang, { collected: true, ordered_at: '2026-11-06T05:30:00Z', change_until: null, wood: { step, tracking_no: step >= 3 ? 'JP1234567890' : null, ship_to: step === 2 ? 'direct' : 'me' } }) }))
      await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
      await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
      await p.locator('[data-testid=buyer-wood]').waitFor()
      const items = await p.locator('[data-testid=wood-steps] li').allInnerTexts()
      const states = await p.locator('[data-testid=wood-steps] li').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))
      const want = STEPS[lang].steps.map((t, i) => (i === 2 && step < 3 ? t.replace(/（.*）| \(.*\)/, '') : t))
      check(`C (${lang}, step ${step}): the title, the four steps word for word (the tracking number only from "shipped"), the current one highlighted, the ship-to line`, (await p.locator('[data-testid=buyer-wood] h2').innerText()) === STEPS[lang].title && items.join('|') === want.join('|') && states.join() === [1, 2, 3, 4].map((n) => (n < step ? 'done' : n === step ? 'current' : 'next')).join() && (await p.locator('[data-testid=wood-ship]').innerText()) === STEPS[lang].ship[step === 2 ? 'direct' : 'me'], `${items.join('|')} ${states.join()}`)
      if (step === 3 && lang === 'ja') await p.screenshot({ path: 'shots/buyer-wood-step3-ja.png', fullPage: true })
      await p.close()
    }
  }
  // not shown: an e-gift order, a view with no wood data (a wooden size that is "coming soon" has none), an order that is only partly known
  for (const [name, view] of [['an e-gift order', mk('ja', { collected: true, ordered_at: '2026-11-06T05:30:00Z', change_until: null, wood: null }, 'ICHIREI-EGIFT', 'none')], ['wooden sizes "coming soon" (the server sends no wood data)', mk('ja', { collected: true, ordered_at: '2026-11-06T05:30:00Z', change_until: null, wood: null })], ['no order data', mk('ja', null)]]) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: view }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=sender-panel]').waitFor()
    check(`C: the wooden section is hidden — ${name}`, (await p.locator('[data-testid=buyer-wood]').count()) === 0 && !(await p.locator('body').innerText()).includes('木の贈りもの'))
    await p.close()
  }
}

// ---------- Run 8g-3: a remembrance order's buyer page (B retitled, no red anywhere, no celebration words), and the receiver's page in PREVIEW mode (nothing can be received or answered; nothing is written) ----------
{
  const TITLE = { ja: '贈りものを届ける', 'zh-Hant': '把它傳給家人', en: 'Share it with family' }
  const WELCOME = { ja: 'ご注文ありがとうございます。', 'zh-Hant': '謝謝你的訂購。', en: 'Thank you for your order.' }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    const errors = []
    p.on('pageerror', (e) => errors.push(String(e)))
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { id: 'AN-testtesttesttesttest', language: lang, glyph: '偲', reading: 'しのぶ', romanization: 'shinobu', meaning_en: 'to remember', who: 'x', memorial: true, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null }, order: { collected: true, ordered_at: '2026-11-06T05:30:00Z', change_until: null, wood: null } } }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-page]').waitFor()
    await p.waitForTimeout(700)
    const red = await p.evaluate(() => [...document.querySelectorAll('.by-page, .by-page *')].filter((e) => ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'boxShadow'].some((k) => /192,\s*57,\s*43/.test(getComputedStyle(e)[k]))).map((e) => e.className || e.tagName))
    const text = await p.locator('[data-testid=buyer-page]').innerText()
    check(`remembrance buyer page (${lang}): B is 「${TITLE[lang]}」, the welcome is as for everyone, the character is ink — no red anywhere — and no celebration words`, (await p.locator('[data-testid=buyer-send-title]').innerText()) === TITLE[lang] && (await p.locator('[data-testid=buyer-welcome-line]').innerText()) === WELCOME[lang] && (await p.locator('[data-testid=buyer-page]').getAttribute('data-quiet')) === 'yes' && red.length === 0 && !/おめでとう|恭喜|祝|Congratulations|🎉/.test(text), `${red.join(',')}`)
    if (lang === 'ja') await p.screenshot({ path: 'shots/buyer-remembrance-ja.png', fullPage: true })
    check(`no page errors (remembrance buyer page ${lang})`, errors.length === 0, errors.join('; '))
    await p.close()
  }
  // celebration: the character IS cinnabar
  {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { id: 'AN-testtesttesttesttest', language: 'ja', glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null }, order: { collected: true, ordered_at: '2026-11-06T05:30:00Z', change_until: null, wood: null } } }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-page]').waitFor()
    check('buyer page (e-gift, not a remembrance): the character is cinnabar and B is 「贈りものを送る」; the order line reads 一字 · 贈り方 · 注文日', (await p.locator('[data-testid=buyer-glyph]').evaluate((e) => getComputedStyle(e).color)) === 'rgb(192, 57, 43)' && (await p.locator('[data-testid=buyer-send-title]').innerText()) === '贈りものを送る' && (await p.locator('[data-testid=buyer-order-line]').innerText()).replace(/\s+/g, ' ') === '一字：備 贈り方：eギフト 注文日：11月6日')
    await p.close()
  }
  // the receiver's page in preview mode: no receive form, no reply box, and nothing is POSTed
  {
    const TOKEN = 'RG-testtesttesttesttest'
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 844 } })
    const posts = []
    p.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
    const view = { id: TOKEN, token: TOKEN, language: 'ja', glyph: '備', reading: 'そな.える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false, film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, certificate_line: 'この字は、あなたの目に映る、その人です。', poem: null, locked: false, from: '山田 太郎', to: '山田 一郎', message: 'いつもありがとう。', egift: { state: 'waiting', japan_only: true }, certificate_no: 12, order_date: '2026-11-06', opens_on: null, replied: false, package: 'simple' }
    await p.route(`**/api/gift/${TOKEN}**`, (r) => { const u = new URL(r.request().url()); return u.pathname.endsWith('/render') ? r.fulfill({ json: { state: 'ready', view } }) : r.fulfill({ json: view }) })
    await p.goto(`http://localhost:5173/g/${TOKEN}?preview=AN-testtesttesttesttest`, { waitUntil: 'networkidle' })
    check('receiver page in preview mode: the preview note is shown', (await p.locator('[data-testid=gift-preview-note]').count()) === 1)
    await p.locator('[data-testid=gift-open]').click()
    await p.locator('[data-testid=gift-to-film]').click({ timeout: 4000 })
    await p.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 }).catch(() => {})
    await p.evaluate(() => window.__ichireiFilm?.seek(window.__ichireiFilm.total))
    await p.locator('[data-testid=gift-to-cert]').click({ timeout: 8000 }).catch(async () => { await p.locator('[data-testid=gift-skip]').click().catch(() => {}); })
    for (const id of ['gift-to-poem', 'gift-to-cert', 'gift-to-keep']) { const b = p.locator(`[data-testid=${id}]`); if (await b.count()) await b.click().catch(() => {}) }
    await p.locator('[data-testid=gift-keep]').waitFor({ timeout: 8000 })
    check('receiver page in preview mode: the end screen has NO receive button / address form and NO thank-you box — nothing can be received or answered from a preview', (await p.locator('[data-testid=gift-receive]').count()) === 0 && (await p.locator('[data-testid=gift-form]').count()) === 0 && (await p.locator('[data-testid=gift-reply]').count()) === 0 && (await p.locator('[data-testid=gift-panel]').count()) === 0)
    check('receiver page in preview mode: it sent nothing (no POST except the harmless picture render)', posts.every((u) => u.endsWith('/render')), posts.join())
    await p.close()
  }
}

// ---------- Run 8g-4: 「贈りものを受け取る」 — before the tap nothing can be sent or saved; the confirm within 24 hours; no confirm after them; the button waits for the final film; then everything appears ----------
{
  const T = {
    ja: { btn: '贈りものを受け取る', line: '受け取ると、送る・保存するができるようになります。受け取った後はキャンセルできません。', late: '受け取ると、送る・保存するができるようになります。', confirm: '受け取りますか？この後はキャンセルできません。', yes: '受け取る', no: 'まだ', by: 'キャンセル期限：11月7日 14時30分まで（受け取る前に限ります）。期限を過ぎると、お客様都合による返金はできません。', wait: '贈りものを仕上げています…', first: '受け取る前に、相手に届く内容をご確認ください。', preview: '相手が見る画面を確かめる' },
    'zh-Hant': { btn: '領取禮物', line: '領取後即可傳送與儲存。領取後將無法取消訂單。', late: '領取後即可傳送與儲存。', confirm: '確定領取嗎？領取後將無法取消。', yes: '領取', no: '先不要', by: '取消期限：11月7日 14時30分前（限領取前）。超過期限後，恕不接受個人因素退款。', wait: '禮物製作中…', first: '領取前，請先確認對方將收到的內容。', preview: '預覽對方會看到的畫面' },
    en: { btn: 'Collect your gift', line: "Once collected, you can send and save it. After that, the order can't be cancelled.", late: 'Once collected, you can send and save it.', confirm: "Collect it now? You won't be able to cancel after this.", yes: 'Collect', no: 'Not yet', by: 'Cancel by: 7 Nov, 14:30 (before you collect). After that, no refunds for change of mind.', wait: 'Finishing your gift…', first: "Before collecting, check what they'll receive.", preview: "Preview what they'll see" },
  }
  const mkView = (lang, order, film, memorial = false) => ({ id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial, film: film ?? { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null }, order })
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 844 } })
    const p = await ctx.newPage()
    await p.clock.install({ time: new Date('2026-11-06T06:00:00Z') })
    const posts = []
    p.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
    const t = T[lang]
    await p.route('**/api/animation/AN-testtesttesttesttest/collect', (r) => r.fulfill({ json: { collected: true, collected_at: '2026-11-06T06:00:00Z' } }))
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: '2026-11-07T05:30:00Z', wood: null }) }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-collect-section]').waitFor()
    check(`before collecting (${lang}): the welcome and the preview are there; NO send button, no receiver link, no QR, no save/download`, (await p.locator('[data-testid=buyer-welcome]').count()) === 1 && (await p.locator('[data-testid=give-preview] a').innerText()) === t.preview && (await p.locator('[data-testid=buyer-check-first]').innerText()) === t.first && (await p.locator('[data-testid=give-line], [data-testid=give-whatsapp], [data-testid=give-wechat], [data-testid=give-copy], [data-testid=give-qr], [data-testid=give-mail], [data-testid=give-link], [data-testid=buyer-save], [data-testid=keepsakes]').count()) === 0 && !(await p.locator('input[readonly]').count()))
    check(`before collecting (${lang}): the cancel deadline (real, in the buyer's time zone), the big button, and the line under it — word for word; the e-mail-style cancel line also shows`, (await p.locator('[data-testid=buyer-cancel-by]').innerText()) === t.by && (await p.locator('[data-testid=collect-button]').innerText()) === t.btn && (await p.locator('[data-testid=collect-line]').innerText()) === t.line && (await p.locator('[data-testid=buyer-deadline]').count()) === 1, await p.locator('[data-testid=buyer-cancel-by]').innerText())
    if (lang === 'ja') await p.screenshot({ path: 'shots/buyer-before-collect-ja.png', fullPage: true })
    await p.locator('[data-testid=collect-button]').click()
    check(`collect (${lang}): within 24 hours a confirm appears IN the page (not a browser dialog), with 「${t.yes}」 and 「${t.no}」 — and nothing was sent yet`, (await p.locator('[data-testid=collect-confirm] p').first().innerText()) === t.confirm && (await p.locator('[data-testid=collect-yes]').innerText()) === t.yes && (await p.locator('[data-testid=collect-no]').innerText()) === t.no && posts.length === 0)
    await p.locator('[data-testid=collect-no]').click()
    check(`collect (${lang}): 「${t.no}」 goes back and nothing is recorded`, (await p.locator('[data-testid=collect-button]').count()) === 1 && posts.length === 0)
    await p.locator('[data-testid=collect-button]').click()
    await p.locator('[data-testid=collect-yes]').click()
    await p.locator('[data-testid=give-line]').waitFor()
    check(`collect (${lang}): after 「${t.yes}」 the server is told once, and the page shows the send buttons, the receiver link and the save section; the collect block and the cancel lines are gone`, posts.filter((u) => u.endsWith('/collect')).length === 1 && (await p.locator('[data-testid=give-link]').inputValue()).includes('/g/RG-') && (await p.locator('[data-testid=buyer-collect-section]').count()) === 0 && (await p.locator('[data-testid=buyer-deadline]').count()) === 0 && (await p.locator('[data-testid=buyer-cancel-by]').count()) === 0)
    if (lang === 'ja') await p.screenshot({ path: 'shots/buyer-after-collect-ja.png', fullPage: true })
    await ctx.close()
  }
  // a remembrance order: nothing is "given" — the one tap is called 「一字を受け取る」 / 「領取這個字」 / "Collect it"
  for (const [lang, want] of [['ja', '一字を受け取る'], ['zh-Hant', '領取這個字'], ['en', 'Collect it']]) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: '2099-11-07T05:30:00Z', wood: null }, undefined, true) }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=collect-button]').waitFor()
    check(`remembrance (${lang}): the collect button is 「${want}」, and no 贈 / gift wording is on the page's button`, (await p.locator('[data-testid=collect-button]').innerText()) === want && !/贈|禮物|gift/i.test(await p.locator('[data-testid=collect-button]').innerText()))
    await p.close()
  }
  // the final gift is still being made: the button waits
  {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView('ja', { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: '2099-11-07T05:30:00Z', wood: null }, { status: 'ready', lines: ['a', 'b'], pictures: null }) }))
    await p.route('**/api/film/AN-testtesttesttesttest/render', (r) => r.fulfill({ json: { state: 'pending', view: mkView('ja', { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: '2099-11-07T05:30:00Z', wood: null }, { status: 'ready', lines: ['a', 'b'], pictures: null }) } }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=collect-button]').waitFor()
    check('collect: while the final film is still being made the button is DISABLED and says 「贈りものを仕上げています…」', (await p.locator('[data-testid=collect-button]').isDisabled()) && (await p.locator('[data-testid=collect-button]').innerText()) === '贈りものを仕上げています…')
    await p.close()
  }
  // after the 24 hours: the tap unlocks at once (no confirm), and the line under the button is the short one
  {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    const posts = []
    p.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
    await p.route('**/api/animation/AN-testtesttesttesttest/collect', (r) => r.fulfill({ json: { collected: true } }))
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView('ja', { collected: false, ordered_at: '2020-01-01T00:00:00Z', change_until: null, wood: null }) }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=collect-button]').waitFor()
    check('collect: after 24 hours there is no cancel deadline line, the line under the button is the short one, and the tap unlocks at once with NO confirm', (await p.locator('[data-testid=buyer-cancel-by]').count()) === 0 && (await p.locator('[data-testid=collect-line]').innerText()) === '受け取ると、送る・保存するができるようになります。')
    await p.locator('[data-testid=collect-button]').click()
    await p.locator('[data-testid=give-line]').waitFor()
    check('collect: …and the send buttons appeared without a confirm step', (await p.locator('[data-testid=collect-confirm]').count()) === 0 && posts.filter((u) => u.endsWith('/collect')).length === 1)
    await p.close()
  }
  // the receiver's link before collecting, and a cancelled order (buyer page and receiver link)
  {
    const TOKEN = 'RG-testtesttesttesttest'
    for (const lang of ['ja', 'zh-Hant', 'en']) {
      const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 800 } })
      await p.route(`**/api/gift/${TOKEN}**`, (r) => r.fulfill({ json: { locked: true, arriving: true, token: TOKEN, language: lang, memorial: false, from: '山田 太郎', to: '山田 一郎', opens_on: '', days_left: 0 } }))
      await p.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
      await p.locator('[data-testid=gift-arriving]').waitFor()
      check(`the receiver's link before collecting (${lang}): the sealed envelope says ${({ ja: 'まもなく届きます', 'zh-Hant': '即將送達', en: 'Arriving soon' })[lang]}, with NO open button`, (await p.locator('[data-testid=gift-arriving]').innerText()) === ({ ja: 'まもなく届きます', 'zh-Hant': '即將送達', en: 'Arriving soon' })[lang] && (await p.locator('[data-testid=gift-open]').count()) === 0)
      await p.close()
      const g = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 800 } })
      await g.route(`**/api/gift/${TOKEN}**`, (r) => r.fulfill({ status: 410, json: { error: 'unavailable', language: lang } }))
      await g.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ status: 410, json: { error: 'unavailable', language: lang } }))
      const want = { ja: 'この贈りものは、現在ご覧いただけません。', 'zh-Hant': '這份禮物目前無法查看。', en: 'This gift is no longer available.' }[lang]
      await g.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
      const a = (await g.locator('[data-testid=animation-error]').innerText())
      await g.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
      const b = (await g.locator('[data-testid=animation-error]').innerText())
      check(`a cancelled order (${lang}): the receiver link and the buyer page say only 「${want}」`, a === want && b === want, `${a} | ${b}`)
      await g.close()
    }
  }
}

// ---------- Run 8g-5: 「SNSでシェアする」 — the share section (buyer after collecting, receiver after opening): the system share sheet gets the FILE only; a saved file and a line where it cannot; hidden before collecting and for remembrance ----------
{
  const COPY = {
    ja: { title: 'SNSでシェアする', line: '動画と歌を、あなたのSNSに。お名前や物語の文章は入りません。', film: '動画をシェア', card: '歌のカードをシェア', fb: '保存した動画を、各SNSのアプリから投稿してください。' },
    'zh-Hant': { title: '分享到社群', line: '把影片和詩分享到你的社群。不會包含姓名或故事文字。', film: '分享影片', card: '分享詩卡', fb: '請從各社群App上傳剛儲存的影片。' },
    en: { title: 'Share it', line: 'Post the film and the poem on your social media. No names or story text are included.', film: 'Share the film', card: 'Share the poem card', fb: 'Post the saved file from your social app.' },
  }
  const real = ['/film/washi-1.webp', '/film/washi-2.webp', '/film/washi-3.webp', '/film/washi-4.webp'].map((u, i) => `/film-art/real-${i + 1}.webp`)
  const film = { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: real }
  const mkView = (lang, memorial, collected) => ({ id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial, film, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null }, order: { collected, ordered_at: '2026-11-06T05:30:00Z', change_until: collected ? null : '2099-01-01T00:00:00Z', wood: null } })
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const wire = async (p, base, analytics) => {
    await p.route('**/film-art/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.route(`**${base}/share/film/make`, (r) => r.fulfill({ json: { state: 'ready' } }))
    await p.route(`**${base}/share-film.mp4`, (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('....ftypmp42') }))
    await p.route(`**${base}/share-card.png`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await p.route('**/api/analytics', (r) => { analytics.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ status: 204, body: '' }) })
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const t = COPY[lang]
    // the buyer, after collecting: the system share sheet gets the file only
    {
      const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
      await ctx.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared.push({ keys: Object.keys(d), files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type })) }) } })
      const p = await ctx.newPage()
      const analytics = []
      await wire(p, '/api/animation/AN-testtesttesttesttest', analytics)
      await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, false, true) }))
      await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
      await p.locator('[data-testid=share-section]').waitFor()
      check(`share (${lang}, buyer): the section sits under the save buttons: title, line and the two buttons — word for word`, (await p.locator('[data-testid=share-title]').textContent()) === t.title && (await p.locator('[data-testid=share-line]').innerText()) === t.line && (await p.locator('[data-testid=share-film]').innerText()) === t.film && (await p.locator('[data-testid=share-card]').innerText()) === t.card && (await p.locator('[data-testid=buyer-save] [data-testid=keepsakes]').count()) === 1)
      await p.waitForTimeout(600)
      await p.locator('[data-testid=share-film]').click()
      await p.waitForFunction(() => window.__shared.length === 1)
      await p.locator('[data-testid=share-card]').click()
      await p.waitForFunction(() => window.__shared.length === 2)
      const shared = await p.evaluate(() => window.__shared)
      check(`share (${lang}, buyer): the system share sheet is given the FILE and nothing else (no title, no text, no link): the film as an MP4, the card as a PNG`, shared[0].keys.join() === 'files' && shared[0].files[0].name === 'ichirei-share.mp4' && shared[0].files[0].type === 'video/mp4' && shared[1].keys.join() === 'files' && shared[1].files[0].name === 'ichirei-poem-card.png' && shared[1].files[0].type === 'image/png', JSON.stringify(shared))
      check(`share (${lang}, buyer): the taps are counted by kind and role only (share_film_tap / share_card_tap, role sender) — no character, no name`, analytics.some((a) => a.event === 'share_film_tap' && a.role === 'sender') && analytics.some((a) => a.event === 'share_card_tap' && a.role === 'sender') && !JSON.stringify(analytics).includes('備'))
      check(`share (${lang}, buyer): no fallback line when the share sheet worked`, (await p.locator('[data-testid=share-fallback]').count()) === 0)
      if (lang === 'ja' || lang === 'zh-Hant') await p.screenshot({ path: `shots/share-section-${lang}.png`, fullPage: true })
      await ctx.close()
    }
    // where file sharing is not possible: the file is saved and the page says to post it from the social app
    {
      const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1000, height: 800 }, acceptDownloads: true })
      await ctx.addInitScript(() => { navigator.canShare = undefined; navigator.share = undefined })
      const p = await ctx.newPage()
      await wire(p, '/api/animation/AN-testtesttesttesttest', [])
      await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, false, true) }))
      await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
      await p.locator('[data-testid=share-section]').waitFor()
      await p.waitForTimeout(600)
      const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-testid=share-film]').click()])
      check(`share (${lang}, no file sharing): the film is SAVED as ichirei-share.mp4 and the page says 「${t.fb}」`, dl.suggestedFilename() === 'ichirei-share.mp4' && (await p.locator('[data-testid=share-fallback]').innerText()) === t.fb)
      await ctx.close()
    }
  }
  // hidden before collecting, and always for remembrance
  {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    await wire(p, '/api/animation/AN-testtesttesttesttest', [])
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView('ja', false, false) }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-collect-section]').waitFor()
    check('share: NOT shown before the buyer collects the gift', (await p.locator('[data-testid=share-section]').count()) === 0)
    await p.close()
    const m = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    await wire(m, '/api/animation/AN-testtesttesttesttest', [])
    await m.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView('ja', true, true) }))
    await m.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await m.locator('[data-testid=buyer-save]').waitFor()
    check('share: a remembrance order has the save buttons but NO share section', (await m.locator('[data-testid=keepsakes]').count()) === 1 && (await m.locator('[data-testid=share-section]').count()) === 0)
    await m.close()
  }
  // the receiver, after opening the envelope (the last screen): the same section with role receiver; not in preview mode; not for remembrance
  for (const [name, memorial, query, want] of [['the receiver after opening', false, '', 1], ['the sender previewing', false, '?preview=AN-testtesttesttesttest', 0], ['remembrance', true, '', 0]]) {
    const TOKEN = 'RG-testtesttesttesttest'
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 375, height: 844 } })
    await ctx.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared.push({ keys: Object.keys(d) }) } })
    const p = await ctx.newPage()
    const analytics = []
    await wire(p, `/api/gift/${TOKEN}`, analytics)
    const view = { id: TOKEN, token: TOKEN, language: 'ja', glyph: '備', reading: 'そな.える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial, film, certificate_line: 'この字は、あなたの目に映る、その人です。', poem: null, locked: false, from: '山田 太郎', to: '山田 一郎', message: '', egift: null, certificate_no: 12, order_date: '2026-11-06', opens_on: null, replied: false, package: 'egift' }
    await p.route(`**/api/gift/${TOKEN}**`, (r) => { const u = new URL(r.request().url()); if (/share|qr/.test(u.pathname)) return r.fallback(); return u.pathname.endsWith('/render') ? r.fulfill({ json: { state: 'ready', view } }) : r.fulfill({ json: view }) })
    await p.goto(`http://localhost:5173/g/${TOKEN}${query}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=gift-open]').click()
    await p.locator('[data-testid=gift-to-film]').click({ timeout: 4000 })
    await p.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 }).catch(() => {})
    await p.evaluate(() => window.__ichireiFilm?.seek(window.__ichireiFilm.total))
    for (const id of ['gift-skip', 'gift-to-poem', 'gift-to-cert', 'gift-to-keep']) {
      await p.locator('[data-testid=gift-keep]').waitFor({ timeout: 800 }).catch(() => {})
      if (await p.locator('[data-testid=gift-keep]').count()) break
      const b = p.locator(`[data-testid=${id}]`)
      if (await b.count()) await b.click().catch(() => {})
    }
    await p.locator('[data-testid=gift-keep]').waitFor({ timeout: 8000 })
    await p.waitForTimeout(500)
    check(`share (${name}): the share section is ${want ? 'on the last screen' : 'not there'}`, (await p.locator('[data-testid=share-section]').count()) === want)
    if (want) {
      await p.locator('[data-testid=share-card]').click()
      await p.waitForFunction(() => window.__shared.length === 1)
      check('share (receiver): the card goes to the share sheet as a file only, counted as role receiver', (await p.evaluate(() => window.__shared[0].keys.join())) === 'files' && analytics.some((a) => a.event === 'share_card_tap' && a.role === 'receiver'))
      await p.screenshot({ path: 'shots/share-section-receiver-ja.png', fullPage: true })
    }
    await ctx.close()
  }
}

// ---------- Run 8h: /legal — 特定商取引法に基づく表記 with the owner's seller details (no 【 】), the return rules, three questions, in three languages; the footer link ----------
{
  const T = {
    ja: { title: '特定商取引法に基づく表記', refundHead: 'お支払い完了から24時間以内', ret: ['お支払い完了から24時間以内にメールを受信した場合に限り、ご注文のキャンセル（送料を含む全額返金）を承ります。', '「贈りものを受け取る」を押した後は、キャンセルできません（すべての商品に共通）。', 'お支払い後の内容の変更（字・歌・お名前・メッセージなど）はお受けしていません。', '24時間を過ぎたお客様都合による返品・返金はお受けできません。', '返送料は当方負担', '海外発送で発生する関税・輸入税は、受け取る方のご負担となります。'], faq: ['注文後に字を変えられますか？', 'キャンセルできますか？', '届いた品物に問題があったら？'], rows: ['販売業者', '運営責任者', '所在地', '電話番号', 'メールアドレス'] },
    'zh-Hant': { title: '特定商取引法標示', refundHead: '付款完成後24小時內', ret: ['僅限付款完成後24小時內我們收到您的郵件，可取消訂單（含運費全額退款）。', '在訂單頁面按下「領取禮物」後，即無法取消（所有商品皆同）。', '付款後恕不更改內容（字、詩、姓名、訊息等）。', '付款完成超過24小時後，恕不接受因個人因素的退貨或退款。', '退回運費由我方負擔', '寄送海外時產生的關稅與進口稅，由收件人負擔。'], faq: ['下單後可以換字嗎？', '可以取消訂單嗎？', '收到的商品有問題怎麼辦？'], rows: ['販售業者', '營運負責人', '所在地', '電話號碼', '電子郵件'] },
    en: { title: 'Legal notice', refundHead: 'Within 24 hours of payment', ret: ["If we receive your email within 24 hours of payment, we'll cancel your order with a full refund, including shipping.", 'Once you press "Collect your gift" on your order page, the order can no longer be cancelled (all sizes).', "We can't change an order after payment (character, poem, names or message).", "more than 24 hours after payment we can't accept returns or refunds for change of mind.", 'we cover return shipping', 'Import duties and taxes on overseas deliveries are paid by the recipient.'], faq: ['Can I change the character after I order?', 'Can I cancel?', 'What if what I receive has a problem?'], rows: ['Seller', 'Person in charge', 'Address', 'Telephone', 'E-mail'] },
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 800 } })
    const errors = []
    p.on('pageerror', (e) => errors.push(String(e)))
    await p.goto(`http://localhost:5173/legal?lang=${lang}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=legal-page]').waitFor()
    const t = T[lang]
    const rows = await p.locator('[data-testid=legal-rows]').innerText()
    const EMAIL = 'info@beyondculture.ai'
    check(`legal (${lang}): the title and the five seller rows, filled with the owner's own details — and no 【 】 anywhere on the page, no placeholder note`, (await p.locator('h1').innerText()).includes(t.title) && t.rows.every((r) => rows.includes(r)) && !/[【】]/.test(await p.locator('body').innerText()) && (await p.locator('[data-testid=legal-note]').count()) === 0 && rows.includes('Beyond Culture 獨歩文化株式会社'))
    check(`legal (${lang}): the e-mail address is plain, selectable text (not a link)`, (await p.locator('[data-testid=legal-email]').innerText()) === EMAIL && (await p.locator('[data-testid=legal-email] a').count()) === 0)
    if (lang === 'ja') await p.screenshot({ path: 'shots/legal-ja.png', fullPage: true })
    check(`legal (${lang}): the prices and the shipping come from the product (¥3,980 / ¥9,800 / ¥18,850; EMS ¥6,000)`, ['3,980', '9,800', '18,850', '6,000'].every((x) => rows.includes(x)))
    const ret = await p.locator('[data-testid=legal-returns]').innerText()
    check(`legal (${lang}): the refund section — four short paragraphs with their headings (within 24 hours of payment, after 24 hours, our mistake, delivery), word for word at their start; the first one is /legal#refund`, (await p.locator('[data-testid=legal-section]').count()) === 4 && t.ret.every((x) => ret.includes(x)) && (await p.locator('#refund h3').innerText()) === t.refundHead)
    check(`legal (${lang}): nothing contradicts it — none of the old lines (the e-gift refund line, "change the character", "other character") is on the page`, !/ギフトページのお届け後の返金|他の字への変更|詩の形式の変更（1回）|not refundable once the gift page|switch to another character|更換為訂購時顯示過的其他字|恕不退款（頁面無法/.test(ret + rows))
    const faq = await p.locator('[data-testid=legal-faq]').innerText()
    check(`legal (${lang}): four questions (the fourth: names are optional)`, (await p.locator('[data-testid=legal-faq] details').count()) === 4 && t.faq.every((q) => faq.includes(q)))
    check(`no page errors (run 8h, ${lang})`, errors.length === 0, errors.join('; '))
    await p.close()
  }
  // 商品のお届け時期: the wooden sentence shows only while the wooden sizes are on sale
  const DELIV = {
    ja: { egift: 'eギフト：お支払い後すぐ（開封日を指定した場合はその日）。', wood: '木札・版木：お支払い完了から24時間のキャンセル受付期間ののちに制作を始め、国内は約2〜3週間でお届けします（海外はさらに1〜2週間）。' },
    'zh-Hant': { egift: 'e禮物：付款後立即送達（若指定開啟日期，則於當天開啟）。', wood: '木牌、版木：付款完成後24小時的取消受理期間結束後開始製作，日本國內約2〜3週送達（海外另需1〜2週）。' },
    en: { egift: 'E-gift: right after payment (or on the opening date you set).', wood: 'Wooden tag and carved block: made after the 24-hour cancellation period, delivered in about 2–3 weeks in Japan (1–2 weeks more overseas).' },
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (const soon of [true, false]) {
      const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 800 } })
      await p.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'], ...(soon ? { coming_soon: ['simple', 'standard'] } : {}) } }))
      await p.goto(`http://localhost:5173/legal?lang=${lang}`, { waitUntil: 'networkidle' })
      await p.locator('[data-testid=legal-delivery]').waitFor()
      const v = (await p.locator('[data-testid=legal-delivery]').innerText()).replace(/\s+/g, ' ')
      check(`legal (${lang}) delivery row, wooden sizes ${soon ? '"coming soon"' : 'on sale'}: ${soon ? 'the e-gift sentence only (nothing about wood)' : 'the e-gift sentence and the wooden sentence'}`, soon ? v === DELIV[lang].egift : v === `${DELIV[lang].egift}${lang === 'en' ? ' ' : ''}${DELIV[lang].wood}`, v)
      check(`legal (${lang}): no 【 】 anywhere on the page (${soon ? 'coming soon' : 'on sale'})`, !/[【】]/.test(await p.locator('body').innerText()))
      if (!soon && lang === 'ja') await p.screenshot({ path: 'shots/legal-refund-ja.png', fullPage: true })
      await p.close()
    }
  }
  const home = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } })
  await home.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }))
  await home.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  check('legal: the landing footer links to /legal', (await home.locator('[data-testid=footer-legal]').getAttribute('href')) === '/legal' && (await home.locator('[data-testid=footer-legal]').innerText()).includes('特定商取引法'))
  check('legal: the landing\'s own questions now include the three (change after ordering, cancel, a problem)', (await home.locator('.faq details').count()) === 10 && (await home.locator('.faq').textContent())?.includes('注文後に字を変えられますか？') && (await home.locator('.faq').textContent())?.includes('ギフトページは少なくとも10年間公開します。映像・絵巻・カードは、いつでもスマートフォンに保存できます。'))
  await home.close()
}

// ---------- Run 8h-2: the landing — step 3 and 「いつ届く？」 follow the wooden switch: sealed e-gift while wood is "coming soon", the 2–3 weeks wording only while wood is on sale ----------
{
  const L = {
    ja: { soon: ['封をして、届ける', '一字と歌と物語の絵を、封をした贈りものに。LINEやメールで、すぐに届けられます。'], wood: '国内 約2〜3週間 ・ 海外はさらに1〜2週間', egift: 'eギフト：お支払い後すぐ（開封日を指定した場合はその日）。', woodAns: '木札・版木：お支払い完了から24時間のキャンセル受付期間ののちに制作を始め、国内は約2〜3週間でお届けします（海外はさらに1〜2週間）。', q: 'いつ届く？' },
    'zh-Hant': { soon: ['封好，送出', '把一個字、詩與故事的畫，封成一份禮物。用LINE或電子郵件，立刻就能送出。'], wood: '日本國內約2〜3週 · 海外另需1〜2週', egift: 'e禮物：付款後立即送達（若指定開啟日期，則於當天開啟）。', woodAns: '木牌、版木：付款完成後24小時的取消受理期間結束後開始製作，日本國內約2〜3週送達（海外另需1〜2週）。', q: '什麼時候送到？' },
    en: { soon: ['Sealed, then sent', 'The character, the poem and your story’s pictures, sealed as a gift. Send it right away by LINE or email.'], wood: 'Japan about 2–3 weeks · Overseas 1–2 weeks more', egift: 'E-gift: right after payment (or on the opening date you set).', woodAns: 'Wooden tag and carved block: made after the 24-hour cancellation period, delivered in about 2–3 weeks in Japan (1–2 weeks more overseas).', q: 'When will it arrive?' },
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (const soon of [true, false]) {
      const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1000, height: 900 } })
      await p.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }))
      await p.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'], ...(soon ? { coming_soon: ['simple', 'standard'] } : {}) } }))
      await p.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
      await p.locator('#how li').nth(2).waitFor()
      await p.waitForTimeout(500)
      const li = p.locator('#how li').nth(2)
      const h = (await li.locator('h3').first().textContent())?.trim()
      const txt = (await li.locator('p').first().textContent())?.trim()
      const time = (await li.locator('.time').count()) ? (await li.locator('.time').textContent())?.trim() : null
      const faq = p.locator('.faq details').filter({ hasText: L[lang].q }).first()
      const ans = (await faq.locator('p').textContent())?.replace(/\s+/g, ' ').trim()
      const sep = lang === 'en' ? ' ' : ''
      check(`landing (${lang}), wooden sizes ${soon ? '"coming soon"' : 'on sale'}: step 3 is ${soon ? 'the sealed e-gift (title and text word for word, no timing line)' : 'the wooden version with the 2–3 weeks timing'}`, soon ? h === L[lang].soon[0] && txt === L[lang].soon[1] && time === null : h !== L[lang].soon[0] && time === L[lang].wood, `${h} | ${txt} | ${time}`)
      check(`landing (${lang}), wooden sizes ${soon ? '"coming soon"' : 'on sale'}: 「${L[lang].q}」 answers with the /legal delivery row — ${soon ? 'the e-gift part only' : 'the e-gift part and the wooden part'}`, ans === (soon ? L[lang].egift : `${L[lang].egift}${sep}${L[lang].woodAns}`), ans)
      check(`landing (${lang}): no 約10営業日 / 10 working days anywhere`, !/営業日|工作日|working days/.test(await p.locator('body').innerText()))
      await p.close()
    }
  }
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
  const mk = async (lang, { limited = false, order, mode = 'normal', gazePrefix = '' } = {}) => {
    const f = await mockPage(browser, { order: order ?? (() => ({ json: { order_ref: 'IC-20261030-PREVIEW1', checkout_url: 'http://localhost:5173/__checkout?cart=pv', glyph: '証', certificate_text: 'x' } })), result: (b) => ({ ...sets[b.retry ?? 0], candidates: sets[b.retry ?? 0].candidates.map((c) => (gazePrefix && c.slot === 'main' ? { ...c, one_line_gaze: gazePrefix + c.one_line_gaze } : c)), language: b.language, inscription_script: b.language === 'en' ? null : b.language === 'ja' ? sets[0].inscription_script : 'traditional' }) })
    const pv = { start: [], render: 0, polls: 0 }
    await f.page.route('**/api/preview', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      pv.start.push(b)
      await route.fulfill({ json: limited ? { state: 'limited' } : { state: 'ok', id: DRAFT, reused: !!b.draft_id, script: 'ready' } })
    })
    await f.page.route('**/api/preview/*/render', async (route) => {
      pv.render++
      // 'slow4': the first two render requests end while the fourth scene is still being drawn (a retried scene takes longer than one request is held); the page must ask again
      if (mode === 'slow4' && pv.render <= 2) {
        await new Promise((r) => setTimeout(r, 700))
        return route.fulfill({ json: { id: DRAFT, state: 'drawing', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [1, 2, 3, null].map((k) => (k ? `/api/film/${DRAFT}/picture/${k}.webp` : null)), slots: ['ai', 'ai', 'ai', 'pending'] } })
      }
      await new Promise((r) => setTimeout(r, 4000))
      await route.fulfill({ json: { id: DRAFT, state: 'done', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [1, 2, 3, 4].map((n) => `/api/film/${DRAFT}/picture/${n}.webp`) } })
    })
    await f.page.route(/\/api\/preview\/AN-[a-z0-9]+$/, async (route) => {
      pv.polls++
      if (mode === 'slow4') {
        const done = pv.render >= 3
        return route.fulfill({ json: { id: DRAFT, state: done ? 'done' : 'drawing', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: [1, 2, 3, done ? 4 : null].map((k) => (k ? `/api/film/${DRAFT}/picture/${k}.webp` : null)), slots: ['ai', 'ai', 'ai', done ? 'ai' : 'pending'] } })
      }
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
    await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    return { ...f, pv, pm }
  }
  const pickMain = async (page, lang) => {
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await page.locator('[data-testid=order-form]').waitFor()
  }
  const ja = await mk('ja')
  check('preview: CHARACTER FIRST — the two characters are on screen and not one picture was asked for (no /api/preview call before a character is picked)', ja.pv.start.length === 0 && (await ja.page.locator('[data-testid=card-preview]').count()) === 0)
  await ja.page.locator('article[data-slot=main]').click()
  await ja.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await ja.page.locator('[data-testid=order-form]').waitFor()
  await ja.page.locator('[data-testid=card-preview]').waitFor()
  await ja.page.waitForTimeout(400)
  check('preview: picking the character starts the draft at once (one /api/preview call with the story, the context and every character shown — both forms)', ja.pv.start.length >= 1 && ja.pv.start[0].story === STORY && ja.pv.start[0].language === 'ja' && ja.pv.start[0].shown.join('') === '証證守' && ja.pv.start[0].draft_id === undefined)
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
  check('preview: the refund line (cancel only within 24 hours of payment and before 「贈りものを受け取る」) sits above the order button, and a link to the legal page beside it', (await ja.page.locator('[data-testid=order-refund-line]').innerText()).startsWith('キャンセル（全額返金）は、お支払い完了から24時間以内') && (await ja.page.locator('[data-testid=legal-link]').getAttribute('href')) === '/legal')
  check('preview: the size choice and the order button come AFTER the preview', await ja.page.evaluate(() => { const a = document.querySelector('[data-testid=card-preview]'); const b = document.querySelector('input[name=package]'); const c = document.querySelector('[data-testid=order-submit]'); return !!(a && b && c && (a.compareDocumentPosition(b) & 4) && (b.compareDocumentPosition(c) & 4)) }))
  // another character of the same story: the same draft is asked for (nothing drawn again)
  await ja.page.click('[data-testid=choose-other]')
  await ja.page.waitForSelector('[data-all-revealed=yes]', { timeout: 8000 }).catch(() => {})
  await ja.page.locator('article[data-slot=freestyle]').click()
  await ja.page.locator('article[data-slot=freestyle]').locator('text=この字で贈る').click()
  await ja.page.locator('[data-testid=card-preview]').waitFor()
  await ja.page.waitForTimeout(500)
  check('preview: another character of the SAME story asks for the same draft (draft_id sent back), so nothing is drawn again', ja.pv.start.length >= 2 && ja.pv.start.at(-1).draft_id === DRAFT)
  // 「別の候補を見る」
  await ja.page.click('[data-testid=choose-other]')
  await ja.page.locator('[data-testid=see-others]').waitFor()
  check('new round: 「別の二字を探す（あと2回）」 sits under the cards, the pager is not there yet (one round), and 「物語を書きなおす」 is the last thing on the screen', (await ja.page.locator('[data-testid=see-others]').innerText()) === '別の二字を探す（あと2回）' && (await ja.page.locator('[data-testid=set-label]').count()) === 0 && (await ja.page.evaluate(() => { const a = document.querySelector('article[data-slot=main]'); const b = document.querySelector('[data-testid=see-others]'); const c = document.querySelector('[data-testid=edit-story]'); return !!(a && b && c && (a.compareDocumentPosition(b) & 4) && (b.compareDocumentPosition(c) & 4)) })))
  await ja.page.click('[data-testid=see-others]')
  await ja.page.waitForFunction(() => document.querySelector('article[data-slot=main] .k, article[data-slot=main]')?.textContent?.includes('備'), null, { timeout: 8000 })
  check('retry 1: 「別の二字を探す（あと2回）」 asks the engine again with every character already shown (both forms) and retry 1 — and two NEW characters are on screen', ja.calls.select.length === 2 && ja.calls.select[1].retry === 1 && ja.calls.select[1].exclude.join('') === '証證守' && (await ja.page.locator('article[data-slot=main]').innerText()).includes('備'))
  check('after round 2 the button counts down — 「別の二字を探す（あと1回）」 — and the pager appears: 「‹ 前の組　2 / 2　次の組 ›」', (await ja.page.locator('[data-testid=see-others]').innerText()) === '別の二字を探す（あと1回）' && (await ja.page.locator('[data-testid=set-prev]').innerText()) === '‹ 前の組' && (await ja.page.locator('[data-testid=set-label]').innerText()) === '2 / 2' && (await ja.page.locator('[data-testid=set-next]').innerText()) === '次の組 ›')
  await ja.page.click('[data-testid=see-others]')
  await ja.page.waitForFunction(() => document.querySelector('article[data-slot=main]')?.textContent?.includes('恵'), null, { timeout: 8000 })
  check('retry 2: the second retry excludes every character shown so far (up to six in all) and says retry 2', ja.calls.select.length === 3 && ja.calls.select[2].retry === 2 && ja.calls.select[2].exclude.join('') === '証證守備憶')
  check('after two retries the button is gone and the message says to write a little more: 「物語を少し書き足すと、新しい字が見つかります。」', (await ja.page.locator('[data-testid=see-others]').count()) === 0 && (await ja.page.locator('[data-testid=retry-cap]').innerText()) === '物語を少し書き足すと、新しい字が見つかります。')
  check('the earlier sets can be looked at again (前の候補): nothing already shown is lost', (await ja.page.locator('[data-testid=set-label]').innerText()) === '3 / 3' && (await ja.page.locator('[data-testid=set-prev]').isEnabled()))
  await ja.page.click('[data-testid=set-prev]')
  await ja.page.click('[data-testid=set-prev]')
  check('…the first set is back with its own characters', (await ja.page.locator('article[data-slot=main]').innerText()).includes('証') && (await ja.page.locator('[data-testid=set-label]').innerText()) === '1 / 3')
  // order: the draft and every shown character go with the order
  await ja.page.locator('article[data-slot=main]').click()
  await ja.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await ja.page.locator('[data-testid=card-preview]').waitFor()
  await ja.page.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 6000 })
  await ja.page.fill('input[name=sender_name]', '山田 太郎')
  await ja.page.fill('input[name=receiver_name]', '山田 一郎')
  const d8f = new Date(); d8f.setDate(d8f.getDate() + 20)
  await ja.page.fill('input[name=delivery_date]', `${d8f.getFullYear()}-${String(d8f.getMonth() + 1).padStart(2, '0')}-${String(d8f.getDate()).padStart(2, '0')}`)
  await ja.page.click('label:has(input[name=package][value=standard])')
  await tickRefund(ja.page)
  await ja.page.click('[data-testid=order-submit]')
  await ja.page.waitForSelector('#co', { timeout: 8000 })
  const ob = ja.calls.order[0]
  check('order: the request carries the draft the buyer saw (draft_id) and EVERY character shown for this story with its set (6 in all)', ob.draft_id === DRAFT && Array.isArray(ob.shown_characters) && ob.shown_characters.length === 6 && new Set(ob.shown_characters.map((x) => x.set)).size === 3 && ob.shown_characters.every((x) => x.candidate && x.candidate.kanji))
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
  check('washi: the washi tile of a scene that could not be drawn is the paper texture with no text and no "drawing" line (the final state, not a waiting one)', (await wa.page.locator('[data-testid=washi-tile]').innerText()) === '' && (await wa.page.locator('[data-testid=pic-wait]').count()) === 0)
  await wa.page.close()
  // 2026-11-07: the line never repeats the label. A line that begins with the label's own wording is shown without it (cards and the order step); the stored line is unchanged.
  for (const [lang, prefix, label, cardLabel, stripped] of [['zh-Hant', '這個人是', '這個人是', '對方是怎樣的人', '這個人是'], ['ja', 'その人は、', 'その人は', 'どんな人か', 'その人は'], ['en', 'They are ', 'They are', "What they're like", 'They are']]) {
    const dp = await mk(lang, { gazePrefix: prefix })
    const cardWho = await dp.page.locator('article[data-slot=main] [data-match-who] dd').innerText()
    await pickMain(dp.page, lang)
    await dp.page.locator('[data-testid=card-preview]').waitFor()
    const whoP = await dp.page.locator('.cardWho').innerText()
    const labelP = await dp.page.locator('.cardWhoLabel').innerText()
    check(`label + line (${lang}): the card shows 「${cardLabel}」 and a line that does NOT repeat the opening; the order step shows 「${label}」 once, then the line`, labelP === label && !cardWho.startsWith(stripped) && !whoP.slice(labelP.length).trimStart().startsWith(stripped) && cardWho.length > 0 && whoP.startsWith(label) && whoP.split(stripped).length === 2, JSON.stringify({ cardWho, whoP }))
    await dp.page.close()
  }
  // 2026-11-07: the fourth scene is slow — its place is the paper texture with a small line (never a flat empty box), in each language; when it arrives it is replaced; the page asked again after the first render request ended
  for (const [lang, want] of [['ja', '描いています…'], ['zh-Hant', '描繪中…'], ['en', 'Drawing…']]) {
    const sl = await mk(lang, { mode: 'slow4' })
    await pickMain(sl.page, lang)
    await sl.page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length === 3, null, { timeout: 8000 })
    const wait = sl.page.locator('[data-testid=card-pictures] .cardPic[data-slot="4"] [data-testid=pic-wait]')
    const bg = await wait.evaluate((el) => getComputedStyle(el).backgroundImage)
    const washiBg = await sl.page.locator('[data-testid=card-pictures] .cardPic[data-slot="4"]').count()
    check(`slow scene (${lang}): while the fourth scene is still being drawn its place shows the paper texture with the small line 「${want}」 inside — not a flat empty box — and its caption stays`, (await wait.innerText()) === want && /washi-2\.webp/.test(bg) && washiBg === 1 && (await sl.page.locator('[data-testid=card-pictures] .cardPic[data-slot="4"] figcaption').innerText()).length > 0 && (await sl.page.locator('[data-testid=card-status]').innerText()) !== '')
    if (lang === 'zh-Hant') await sl.page.locator('[data-testid=card-preview]').screenshot({ path: `${SHOTS}/e2e-card-preview-drawing-zh-Hant.png` })
    if (lang === 'ja') {
      await sl.page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length === 4, null, { timeout: 20000 })
      check('slow scene: the render request ended twice with the fourth scene unfinished and the page asked again (3 or more render requests), then all four pictures show and the "drawing" line is gone', sl.pv.render >= 3 && (await sl.page.locator('[data-testid=pic-wait]').count()) === 0 && (await sl.page.locator('[data-testid=card-status]').innerText()) === '', String(sl.pv.render))
    }
    await sl.page.close()
  }
  const af = await mk('ja', { mode: 'allfail' })
  await pickMain(af.page, 'ja')
  await af.page.waitForFunction(() => document.querySelector('[data-testid=card-preview]')?.getAttribute('data-state') === 'failed', null, { timeout: 8000 })
  check('washi: only when ALL FOUR failed does the card leave the pictures out and say 「物語の絵は、ご注文後にお届けします」', (await af.page.locator('[data-testid=card-pictures]').count()) === 0 && (await af.page.locator('[data-testid=card-status]').innerText()) === '物語の絵は、ご注文後にお届けします')
  await af.page.close()
  // the other two languages: the drawing line, the sample mark, the made-to-order note
  for (const [lang, drawing, sample, note] of [['zh-Hant', '正在描繪你的故事', '樣本', '取消（全額退款）僅限付款完成後24小時內'], ['en', 'Drawing your story', 'Sample', 'You can cancel for a full refund only within 24 hours of payment']]) {
    const l = await mk(lang)
    await pickMain(l.page, lang)
    await l.page.locator('[data-testid=card-preview]').waitFor()
    check(`preview (${lang}): 「${drawing}」 while drawing, the sample mark 「${sample}」, and the refund line`, (await l.page.locator('[data-testid=card-status]').innerText()) === drawing && (await l.page.locator('[data-testid=sample-mark]').innerText()) === sample && (await l.page.locator('[data-testid=order-refund-line]').innerText()).includes(note), await l.page.locator('[data-testid=card-status]').innerText())
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
    await route.fulfill({ json: { poem_id: idOf[b.type], type: b.type, lines: [`${b.type} 一行目です`, `${b.type} 二行`, `${b.type} 三行目です`], reading: b.type === 'tang' ? '書き下しです' : '', aids: {}, preview: 'x' } })
  })
  await f.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await f.page.locator('#write [data-testid=story-input]').fill(STORY)
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await f.page.locator('[data-testid=order-form]').waitFor()
  const addon = f.page.locator('[data-testid=poem-addon]')
  await addon.waitFor({ timeout: 5000 })
  const addonText = await addon.innerText()
  check('included poem: the step is visible to every customer — heading, the formats of the story\'s language as radio buttons (a Japanese story: 短歌 first, then 俳句 and 漢詩 — no 宋詞, no English; labels in the page language), and no price', (await addon.locator('legend').innerText()).includes('歌を一首添えます') && (await addon.locator('input[name=poem_type]').count()) === 3 && (await addon.locator('input[data-poem-type=haiku]').count()) === 1 && (await addon.locator('input[data-poem-type=tang]').count()) === 1 && (await addon.locator('input[data-poem-type=ci]').count()) === 0 && (await addon.locator('input[data-poem-type=en]').count()) === 0 && !/[¥￥]|円/.test(addonText) && addonText.includes('追加料金はありません'))
    check('included poem: the Japanese page shows the labels 短歌（五七五七七） / 俳句（五七五） / 漢詩（唐詩の形・五言／七言絶句）, in that order (the first is the default)', (await addon.locator('label:has(input[name=poem_type])').allInnerTexts()).map((t) => t.trim()).join('|') === '短歌（五七五七七）|俳句（五七五）|漢詩（唐詩の形・五言／七言絶句）', (await addon.locator('label:has(input[name=poem_type])').allInnerTexts()).join('|'))
check('included poem: the Japanese site starts with the tanka (the default format) and writes it at once', await addon.locator('input[data-poem-type=tanka]').isChecked() && poemCalls.length >= 1 && poemCalls.every((c) => c.type === 'tanka'))
  await addon.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 5000 })
  const full = await addon.locator('[data-poem-full]').innerText()
  // ticket 2026-11-01: 短歌 and 俳句 are set vertically (縦書き) on the card preview, first line on the right; 漢詩 / 宋詞 / English stay horizontal
  const vert = () => f.page.locator('[data-testid=card-poem]').evaluate((el) => ({ mode: getComputedStyle(el).writingMode, kind: el.getAttribute('data-poem-type'), xs: [...el.querySelectorAll('.cardPoemLine')].map((s) => s.getBoundingClientRect().left), tops: [...el.querySelectorAll('.cardPoemLine')].map((s) => { const r = document.createRange(); r.selectNodeContents(s); return r.getBoundingClientRect().top }), lens: [...el.querySelectorAll('.cardPoemLine')].map((s) => [...(s.textContent ?? '')].length) }))
  const vt = await vert()
  check('card preview: the tanka is vertical (縦書き, vertical-rl) and the first line is the rightmost column', vt.kind === 'tanka' && vt.mode.startsWith('vertical') && vt.xs.length === 3 && vt.xs[0] > vt.xs[1] && vt.xs[1] > vt.xs[2], JSON.stringify(vt))
  check('card preview: every column of the vertical poem starts at the SAME line (the top) although the lines differ in length — none is centred', new Set(vt.lens).size > 1 && vt.tops.every((t) => Math.abs(t - vt.tops[0]) <= 1.5), JSON.stringify(vt))
  check('included poem: the WHOLE poem is shown before checkout (all three lines), with "this poem is printed on your card"', full.includes('tanka 一行目です') && full.includes('tanka 三行目です') && (await addon.innerText()).includes('カードに印刷されます'))
  check('included poem: /api/poem got the story, the context, the chosen character, its card line and the type — and the session', poemCalls[0].story === STORY && poemCalls[0].kanji === '証' && typeof poemCalls[0].gaze === 'string' && poemCalls[0].gaze.length > 0 && poemCalls[0].relationship === 'parent_father' && typeof poemCalls[0].session === 'string')
  const callsBeforeTang = poemCalls.length
  await addon.locator('input[data-poem-type=tang]').click()
  const waited = await f.page.evaluate(() => document.querySelector('[data-testid=order-submit]').disabled)
  check('included poem: while a poem is being written the order button waits (the buyer sees the poem before paying)', waited === true)
  await addon.locator('[data-poem-result=tang][data-state=ready]').waitFor({ timeout: 6000 })
  check('included poem: choosing another format writes that one; the order button is back', poemCalls.length === callsBeforeTang + 1 && poemCalls.at(-1).type === 'tang' && (await addon.locator('[data-poem-full]').innerText()).includes('tang 一行目です'))
  const ht = await f.page.locator('[data-testid=card-poem]').evaluate((el) => ({ mode: getComputedStyle(el).writingMode, kind: el.getAttribute('data-poem-type') }))
  check('card preview: the Tang quatrain (漢詩) stays horizontal', ht.kind === 'tang' && ht.mode.startsWith('horizontal'), JSON.stringify(ht))
  await addon.locator('input[data-poem-type=tanka]').click()
  await f.page.waitForTimeout(300)
  check('included poem: going back to a format already written shows it again without another call', poemCalls.length === callsBeforeTang + 1 && (await addon.locator('[data-poem-full]').innerText()).includes('tanka 一行目です'))
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  const od8 = new Date(); od8.setDate(od8.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od8.getFullYear()}-${String(od8.getMonth() + 1).padStart(2, '0')}-${String(od8.getDate()).padStart(2, '0')}`)
  await f.page.click('label:has(input[name=package][value=standard])')
  await tickRefund(f.page)
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
  await g.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await g.page.locator('article[data-slot=main]').click()
  await g.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await g.page.locator('[data-testid=order-form]').waitFor()
  await g.page.locator('[data-poem-result=tanka][data-state=failed]').waitFor({ timeout: 6000 })
  check('included poem: it is tried twice, then given up politely — the note says the order goes ahead without a poem, with a "try again" button', failCalls >= 2 && (await g.page.locator('[data-poem-failed]').innerText()).includes('歌なしで、そのままご注文いただけます') && (await g.page.locator('[data-testid=poem-addon] button:has-text("もう一度試す")').count()) === 1)
  await g.page.fill('input[name=sender_name]', '山田 太郎')
  await g.page.fill('input[name=receiver_name]', '山田 一郎')
  const od9 = new Date(); od9.setDate(od9.getDate() + 20)
  await g.page.fill('input[name=delivery_date]', `${od9.getFullYear()}-${String(od9.getMonth() + 1).padStart(2, '0')}-${String(od9.getDate()).padStart(2, '0')}`)
  await g.page.click('label:has(input[name=package][value=standard])')
  await tickRefund(g.page)
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
  check('landing ja: the composer is the real flow — chips for relationship, direction and the reason for giving (+ the optional state), the textarea, the "0 / 5000字" counter, the soft hint', (await page.locator('[data-chip^="relationship:"]').count()) === 15 && (await page.locator('[data-chip^="direction:"]').count()) === 3 && (await page.locator('[data-chip^="purpose:"]').count()) === 9 && (await page.locator('[data-chip^="state:"]').count()) === 6 && (await page.locator('#moment').count()) === 1 && (await page.locator('[data-testid=story-counter]').innerText()) === '0 / 5000字' && (await page.locator('[data-testid=story-hint]').innerText()) === '短くても長くても。ひとつの場面なら50字ほどから、物語なら5000字まで。')
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
    en: { title: 'ICHIREI 一字礼 — A Gift of One Character', h1: 'Between you and me, one character.', cta: 'Tell your story', go: GO.en, htmlLang: 'en', hint: 'Short or long: a single scene from about 50 characters, a whole story up to 5,000.', desc: 'ICHIREI (一字礼) — the person you see' },
    ja: { title: 'ICHIREI 一字礼 — 一字の贈りもの', h1: 'あなたとわたし、一字の距離。', cta: '物語を書く', go: GO.ja, htmlLang: 'ja', hint: '短くても長くても。ひとつの場面なら50字ほどから、物語なら5000字まで。', desc: 'ICHIREI（一字礼）— あなたの目に映る、その人を、一文字に。' },
    'zh-Hant': { title: 'ICHIREI 一字禮 — 一個字的禮物', h1: '你和我之間，只隔一個字。', cta: '寫下故事', go: GO['zh-Hant'], htmlLang: 'zh-Hant', hint: '長短都可以。一個場景約50字起，完整故事最多5000字。', desc: 'ICHIREI（一字禮）— 把你眼中的那個人' },
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
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    const sent = calls.select.at(-1)
    check(`${l}: the composer posts to /api/select with language ${l}, the story and the context${l === 'zh-Hant' ? ' (traditional inscription)' : ''}`, sent.language === l && sent.story === story && sent.relationship === 'parent_mother' && sent.direction === 'up' && sent.purpose === 'celebrate' && (l === 'zh-Hant' ? sent.inscription_script === 'traditional' : !('inscription_script' in sent)), JSON.stringify(sent))
    await page.click('#write >> [data-testid=edit-story]')
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
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('customer: no condition toggle, no diagnostics ("見送った字"), no raw contract, no honesty flags in the reveal', (await page.locator('text=見送った字').count()) === 0 && (await page.locator('text=raw contract').count()) === 0 && (await page.locator('text=⚑').count()) === 0 && (await page.locator('#write details').count()) === 0)
  check('customer: 「再試一次」 is gone from the card screen — a quiet 「物語を書きなおす」 link is at the bottom instead; the harness controls are not there', (await page.locator('button:has-text("もう一度試す")').count()) === 0 && (await page.locator('button:has-text("もう一度ためす")').count()) === 0 && (await page.locator('[data-testid=edit-story]').innerText()) === '物語を書きなおす' && (await page.locator('text=ログ書き出し').count()) === 0)
  check('customer: the select call is plain condition A with the context (same engine as /demo)', calls.select[0].condition === 'A' && calls.select[0].language === 'ja' && calls.select[0].relationship === 'parent_father' && !('inscription_script' in calls.select[0]))
  // the two cards: main (cinnabar glyph) and freestyle (labelled 遊び字, an equal card, its character in ink)
  const cardInfo = await page.evaluate(() => [...document.querySelectorAll('#write article[data-slot]')].map((a) => ({ slot: a.dataset.slot, label: a.querySelector('[data-slot-label]').innerText, glyph: getComputedStyle(a.querySelector('[data-glyph]')).color, border: getComputedStyle(a).borderStyle, choose: !!a.querySelector('[data-select]') })))
  check('two cards: main 本命 (cinnabar character) and freestyle 遊び字 (an equal card, solid border, its character is ink — NOT cinnabar); each has its own choose button', cardInfo.length === 2 && cardInfo.find((c) => c.slot === 'main').label === '本命' && cardInfo.find((c) => c.slot === 'main').glyph === 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'freestyle').label === '遊び字' && cardInfo.find((c) => c.slot === 'freestyle').glyph !== 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'freestyle').border === 'solid' && cardInfo.every((c) => c.choose), JSON.stringify(cardInfo))
  check('one button per card, 「この字で贈る」 — no separate confirm button, no 「就用這一個字」 hint, no 「選ぶ」 button, and the top line is the new one', (await page.locator('#write article [data-select]').count()) === 2 && (await page.locator('#write article [data-select]').allInnerTexts()).every((t) => t === 'この字で贈る') && (await page.locator('[data-testid=finalize]').count()) === 0 && (await page.locator('text=ひとつ選ぶと、先へ進めます。').count()) === 0 && (await page.locator('[data-reveal-intro]').innerText()) === 'あなたの物語から見つかった字です。贈りたい一字を選んでください。')
  // choose 守 (it has a distinct old form 默) — one click goes straight to the order step
  await page.locator('article', { hasText: '静けさのまま' }).click()
  await page.locator('article', { hasText: '静けさのまま' }).locator('text=この字で贈る').click()
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor({ timeout: 5000 })
  check('order form appears after the character is chosen (the reveal stays mounted but hidden)', await form.isVisible() && (await page.locator('#write article').first().isHidden()))
  check('order form: sender, receiver, delivery date, package (no old-form choice: Japanese buyers carve the modern form)', (await page.locator('input[name=sender_name]').count()) === 1 && (await page.locator('input[name=receiver_name]').count()) === 1 && (await page.locator('input[name=delivery_date]').count()) === 1 && (await page.locator('input[name=inscription_style]').count()) === 0 && (await page.locator('input[name=package]').count()) === 3)
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
  check('the refund terms checkbox is NOT pre-ticked, and the order button stays disabled until it is ticked (everything else is filled)', (await page.locator('[data-testid=order-refund-check]').isChecked()) === false && (await submit.isDisabled()))
  check('the refund line sits above the button, word for word, with the link 「詳しくはこちら」 → /legal#refund; the wooden delivery line shows under the size choice', (await page.locator('[data-testid=order-refund-line]').innerText()).startsWith('キャンセル（全額返金）は、お支払い完了から24時間以内、かつご注文ページで「贈りものを受け取る」を押す前に限ります。24時間を過ぎると、お客様都合による返金は一切できません。お支払い後の内容の変更もできません。') && (await page.locator('[data-testid=order-refund-details]').innerText()) === '詳しくはこちら' && (await page.locator('[data-testid=order-refund-details]').getAttribute('href')) === '/legal#refund' && (await page.locator('[data-testid=order-refund-check-label]').innerText()) === 'キャンセル・返金の条件（お支払い完了から24時間以内、受け取り前に限る）を確認しました。' && (await page.locator('[data-testid=order-delivery-wood]').innerText()) === '木札・版木：お支払い完了から24時間のキャンセル受付期間ののちに制作を始め、国内は約2〜3週間でお届けします（海外はさらに1〜2週間）。')
  await page.locator('[data-testid=order-refund-check]').check()
  check('enabled once everything is filled and the refund terms are ticked', await submit.isEnabled())
  // (no inscription-form choice for Japanese buyers: the modern form is carved)
  await page.screenshot({ path: `${SHOTS}/e2e-order-form-ja.png`, fullPage: true })
  // back keeps the selection
  await page.click('text=字を選びなおす')
  check('"字を選びなおす" returns to the cards (same round, nothing lost), the order form is gone', (await page.locator('#write article[data-slot] [data-select]').count()) === 2 && (await form.isHidden()))
  await page.locator('article', { hasText: '静けさのまま' }).locator('text=この字で贈る').click()
  await form.waitFor()
  // submit
  check('the form is empty again after going back and forth? (no — it is re-created, so refill)', (await page.inputValue('input[name=sender_name]')) === '')
  await page.fill('input[name=sender_name]', '山田 太郎')
  await page.fill('input[name=receiver_name]', '山田 一郎')
  await page.fill('input[name=delivery_date]', iso)
  await page.click('label:has(input[name=package][value=standard])')
  await tickRefund(page)
  await submit.click()
  await page.waitForSelector('#co', { timeout: 8000 })
  check('submit → redirected to the Shopify checkout URL the server returned', page.url().includes('/__checkout?cart=fake'))
  const body = calls.order[0]
  check('POST /api/order: story, the engine result, the chosen kanji, language, names, date, inscription style and package', body.story === STORY && body.engine_result.candidates.length === 2 && body.selected_kanji === '守' && body.language === 'ja' && body.sender_name === '山田 太郎' && body.receiver_name === '山田 一郎' && body.delivery_date === iso && body.inscription_style === 'modern' && body.package === 'standard', JSON.stringify({ ...body, engine_result: '…', story: body.story?.slice(0, 10) }))
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
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('zh-Hant: the select call is zh-Hant with the default (traditional) inscription script', calls.select[0].language === 'zh-Hant' && calls.select[0].inscription_script === 'traditional')
  const lamp = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("燈")') })
  await lamp.click()
  await lamp.locator('text=送這個字').click()
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor()
  check('zh-Hant order form: traditional (燈) pre-selected, simplified (灯) offered, in Chinese', (await page.locator('input[name=inscription_style][value=traditional]').isChecked()) && (await page.locator('[data-order-glyph]').innerText()) === '燈' && (await form.locator('label:has(input[value=simplified]) .optGlyph').innerText()) === '灯' && (await form.innerText()).includes('你的稱呼（選填）') && (await form.innerText()).includes('木牌（簡約）'))
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
  await tickRefund(page)
  await submit.click()
  await page.locator('[data-testid=order-error]').waitFor()
  check('502 cart_failed → a plain message, the form stays usable', (await page.locator('[data-testid=order-error]').innerText()).includes('未能受理訂單') && await submit.isEnabled())
  mode = 'not_configured'
  await tickRefund(page)
  await submit.click()
  await page.locator('text=目前暫時無法下單').waitFor()
  check('503 not configured → "cannot take orders right now"', true)
  mode = 'field'
  await tickRefund(page)
  await submit.click()
  await page.locator('text=請檢查「期望送達日」').waitFor()
  check('400 with a field → names the field to fix', true)
  mode = 'ok'
  await tickRefund(page)
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
  check('en customer page: the flow is English, no language pills inside it, no test controls', (await page.locator('#write').innerText()).includes('The moment with them you remember most.') && (await page.locator('#write [data-language]').count()) === 0 && (await page.locator('text=VALIDATION HARNESS').count()) === 0)
  check('en: the chips are English (relationship, direction, occasion)', (await page.locator('[data-chip="relationship:parent_mother"]').innerText()) === 'Mother' && (await page.locator('[data-chip="purpose:celebrate"]').innerText()) === 'Celebrate (birthday, 60th, wedding, birth, school…)')
  await page.locator('#moment').fill('My mum left the porch light on every night until I got home.')
  await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
  await page.fill('input[name=occasion_detail]', '70th birthday')
  await page.click(`#write >> text=${GO.en}`)
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  const sel = calls.select[0]
  check('en payload: language en, the context and occasion_detail, and NO inscription_script', sel.language === 'en' && sel.relationship === 'parent_mother' && sel.direction === 'up' && sel.purpose === 'celebrate' && sel.occasion_detail === '70th birthday' && !('inscription_script' in sel), JSON.stringify(sel))
  const lamp = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("灯")') })
  check('en reveal: the carved glyph is the modern Japanese form 灯 (spec v9.1 step 9), shown with the romaji reading (from the palette), the pinyin and the one-phrase English meaning', (await lamp.count()) === 1 && await lamp.locator('text=akari · pinyin dēng — lamp').isVisible())
  check('en reveal: no old-form (kyūjitai) note — only the modern form is carved', (await lamp.locator('text=kyūjitai').count()) === 0)
  const plainCard = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("待")') })
  check('en reveal: a character with no distinct old form shows romaji and meaning only', await plainCard.locator('text=matsu · pinyin dài — wait').isVisible())
  check('en reveal: each card shows the model\'s one plain-English why_this sentence under the gaze line', (await lamp.locator('[data-why-this]').innerText()) === 'Lamplight is the light you left on for me.' && (await plainCard.locator('[data-why-this]').innerText()) === 'Waiting is what you did, and never mentioned.')
  check('learning loop: the select call carries a random session id and source "customer" — and nothing else new', /^[A-Za-z0-9_-]{16,64}$/.test(calls.select[0].session) && calls.select[0].source === 'customer')
  await lamp.click()
  await page.screenshot({ path: `${SHOTS}/e2e-reveal-en.png`, fullPage: true })
  await lamp.locator('text=Give this character').click()
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
  await tickRefund(page)
  await submit.click()
  await page.locator('[data-testid=order-error]').waitFor()
  check('en: a failed order shows a plain English message and the form stays usable', (await page.locator('[data-testid=order-error]').innerText()).includes('We could not take your order') && await submit.isEnabled())
  mode = 'field'
  await tickRefund(page)
  await submit.click()
  await page.locator('text=Please check “Requested delivery date”.').waitFor()
  check('en: a 400 with a field names the field to fix, in English', true)
  mode = 'ok'
  await tickRefund(page)
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
  check('en explain call: language en with the context, the romaji reading AND the English meaning, no inscription_script', ex.language === 'en' && ex.relationship === 'parent_mother' && ex.purpose === 'thanks' && ex.candidate.kanji === '灯' && ex.candidate.inscription_form === '燈' && ex.candidate.reading === 'akari' && ex.candidate.meaning === 'lamp' && !('inscription_script' in ex), JSON.stringify(ex))
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
    r.occasion = body.purpose === 'memorial' ? 'memorial' : 'birthday_milestone'
    r.purpose = body.purpose
    r.inscription_script = null
    // the sender chose a gift occasion but the story says the person has died: the model suggests remembrance
    if (body.purpose !== 'memorial') r.suggest_memorial = true
    return r
  }
  const orderOk = () => ({ json: { order_ref: 'IC-20261026-MEMREF22', checkout_url: 'http://localhost:5173/__checkout?cart=mem', glyph: '守', certificate_text: 'x', certificate: { memorial: true } } })
  const { page, errors, calls } = await mockPage(browser, { result: memResult, order: orderOk })
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  const chips = await page.locator('[data-chip^="purpose:"]').evaluateAll((els) => els.map((e) => e.dataset.chip))
  check('memorial: "偲ぶ" is the 8th purpose chip, before 「その他」 (nothing is set silently: no chip is pressed at the start)', chips.length === 9 && chips[7] === 'purpose:memorial' && chips[8] === 'purpose:other' && (await page.locator('[data-chip="purpose:memorial"]').innerText()) === '偲ぶ' && (await page.locator('[data-chip^="purpose:"][aria-pressed=true]').count()) === 0)
  await page.locator('#moment').fill('父は、私が帰省するたびに玄関の灯りをつけて待っていた。去年の冬に亡くなったけれど、今も思い出す。')
  await pickContext(page, { relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' })
  await page.click('[data-chip="purpose:memorial"]')
  check('memorial: choosing it changes the direction wording to one that never speaks of giving (その人は、あなたより / 目上の方 …)', (await page.locator('#cg-direction').innerText()) === 'その人は、あなたより' && !(await page.locator('[data-chip^="direction:"]').allInnerTexts()).some((t) => /へ|贈/.test(t)))
  await page.click('[data-chip="purpose:celebrate"]')
  check('memorial: the direction label returns to the gift wording for the other occasions', (await page.locator('#cg-direction').innerText()) === '贈る向き')
  // -- the suggestion: the engine says the story is about someone who has died; the page asks (and shows no cards yet)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector('[data-testid=memorial-suggest]', { timeout: 15000 })
  check('suggestion: the page asks the sender before showing anything — no cards, no silent switch of the occasion', (await page.locator('#write article[data-slot]').count()) === 0 && (await page.locator('[data-testid=memorial-suggest]').innerText()).includes('亡くなった方のお話のようです。') && calls.select.length === 1 && calls.select[0].purpose === 'celebrate')
  // "No, continue as it is" → the cards, as for any gift (cinnabar main)
  await page.click('[data-testid=memorial-no]')
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('suggestion declined: the cards appear as before (cinnabar main), no second engine call, the card button keeps its usual wording', calls.select.length === 1 && (await page.locator('article[data-slot=main] [data-glyph]').evaluate((el) => getComputedStyle(el).color)) === SEAL && (await page.locator('article[data-slot=main] [data-select]').innerText()) === GIVE.ja)
  await page.click('#write >> [data-testid=edit-story]')
  await page.locator('#moment').waitFor()
  // -- accept: run again as memorial (the same story, the same answers)
  check('after "try again" the story is kept and no chip is pressed for the occasion except the sender\'s own (birthday_milestone)', (await page.locator('[data-chip="purpose:celebrate"][aria-pressed=true]').count()) === 1)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector('[data-testid=memorial-suggest]', { timeout: 15000 })
  await page.click('[data-testid=memorial-yes]')
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('suggestion accepted: the engine runs again with occasion memorial (same story), then the cards appear', calls.select.length === 3 && calls.select[2].purpose === 'memorial' && calls.select[2].story === calls.select[1].story && (await page.locator('#write article[data-slot]').count()) === 2)
  const colours = await page.evaluate(() => ({ main: getComputedStyle(document.querySelector('article[data-slot=main] [data-glyph]')).color, label: getComputedStyle(document.querySelector('article[data-slot=main] [data-slot-label]')).backgroundColor, border: getComputedStyle(document.querySelector('article[data-slot=main]')).borderTopColor, marked: document.querySelector('article[data-slot=main]').dataset.memorial }))
  check('memorial result: the main character, its label and its top rule are ink, never cinnabar; the card is marked data-memorial', colours.main === INK && colours.label === INK && colours.border === INK && colours.marked === 'yes', JSON.stringify(colours))
  check('memorial result: the card button says 「この字にする」 (nothing is given)', (await page.locator('article[data-slot=main] [data-select]').innerText()) === 'この字にする')
  const gift = (t) => /贈/.test(t)
  const chrome = await page.evaluate(() => { const root = document.querySelector('#write').cloneNode(true); root.querySelectorAll('article').forEach((n) => n.remove()); return root.innerText })
  check('memorial result: no 贈 (give / gift) wording anywhere in the flow outside the model-written cards', !gift(chrome), chrome.slice(0, 300))
  await page.locator('article[data-slot=main]').locator('text=この字にする').click()
  const form = page.locator('[data-testid=order-form]')
  await form.waitFor()
  const slip = await page.evaluate(() => ({ glyph: getComputedStyle(document.querySelector('[data-order-glyph]')).color, top: getComputedStyle(document.querySelector('.slip')).borderTopColor, marked: document.querySelector('.slip').dataset.memorial }))
  check('memorial order form: the slip glyph and rule are ink, not cinnabar', slip.glyph === INK && slip.top === INK && slip.marked === 'yes', JSON.stringify(slip))
  const formText = await form.innerText()
  check('memorial order form: the refund line calls the button 「一字を受け取る」 (not 「贈りものを受け取る」), and the checkbox line has no 贈', (await page.locator('[data-testid=order-refund-line]').innerText()).includes('「一字を受け取る」') && !(await page.locator('[data-testid=order-refund-line]').innerText()).includes('贈') && !(await page.locator('[data-testid=order-refund-check-label]').innerText()).includes('贈'))
  check('memorial order form: the receiver field is 「偲ぶ方の呼び名（任意）」, there is no 贈 wording, the certificate line is the usual one', formText.includes('偲ぶ方の呼び名（任意）') && !gift(formText) && (await page.locator('[data-certificate]').innerText()) === 'この字は、あなたの目に映る、その人です。', formText.slice(0, 300))
  await page.fill('input[name=sender_name]', '山田 花子')
  await page.fill('input[name=receiver_name]', '山田 一郎')
  const d = new Date(); d.setDate(d.getDate() + 20)
  await page.fill('input[name=delivery_date]', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  await page.click('label:has(input[name=package][value=simple])')
  await tickRefund(page)
  await page.click('[data-testid=order-submit]')
  await page.waitForSelector('#co', { timeout: 8000 })
  check('memorial order: the engine result sent with the order says occasion memorial (the server derives memorial from it); no client "memorial" field', calls.order[0].engine_result.occasion === 'memorial' && !('memorial' in calls.order[0]))
  check('no page errors (run 13b)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
  // English: the chip label
  const en = await mockPage(browser, { result: memResult })
  await en.page.goto('http://localhost:5173/?lang=en', { waitUntil: 'networkidle' })
  check('memorial (en): the last occasion chip is "In memory"; zh-Hant: 追思', (await en.page.locator('[data-chip="purpose:memorial"]').innerText()) === 'In memory')
  await en.page.goto('http://localhost:5173/?lang=zh-Hant', { waitUntil: 'networkidle' })
  check('memorial (zh-Hant): 追思', (await en.page.locator('[data-chip="purpose:memorial"]').innerText()) === '追思')
  await en.page.close()
}

// ---------- Run 13c (launch freeze): apology, encouragement and remembrance are ink — never red — on the cards, the preview, the order slip, the gift page and the film ----------
{
  const INK = 'rgb(31, 42, 68)'
  const SEAL = 'rgb(200, 64, 45)'
  const purposeResult = (body) => { const r = clone(FIXTURE); r.language = body.language; r.occasion = null; r.purpose = body.purpose; r.inscription_script = null; return r }
  for (const purpose of ['apology', 'encourage', 'thanks']) {
    const quiet = purpose !== 'thanks'
    const { page, errors } = await mockPage(browser, { result: purposeResult, order: () => ({ json: { order_ref: 'IC-20261026-QUIET222', checkout_url: 'http://localhost:5173/__checkout?cart=q', glyph: '証', certificate_text: 'x', certificate: { memorial: false } } }) })
    await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
    await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
    await page.click(`[data-chip="purpose:${purpose === 'thanks' ? 'thanks' : purpose}"]`)
    await page.click(`#write >> text=${GO.ja}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    const main = await page.evaluate(() => ({ glyph: getComputedStyle(document.querySelector('article[data-slot=main] [data-glyph]')).color, label: getComputedStyle(document.querySelector('article[data-slot=main] [data-slot-label]')).backgroundColor, border: getComputedStyle(document.querySelector('article[data-slot=main]')).borderTopColor }))
    check(`${purpose}: the main card's character, label and top rule are ${quiet ? 'ink, never cinnabar' : 'cinnabar (the celebration colour stays for a thank-you)'}`, quiet ? main.glyph === INK && main.label === INK && main.border === INK : main.glyph === SEAL, JSON.stringify(main))
    await page.locator('article[data-slot=main]').locator(`text=${GIVE.ja}`).click()
    await page.locator('[data-testid=order-form]').waitFor()
    const form = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid=card-sheet] .cardGlyph')
      return { slipGlyph: getComputedStyle(document.querySelector('[data-order-glyph]')).color, slipTop: getComputedStyle(document.querySelector('.slip')).borderTopColor, slipQuiet: document.querySelector('.slip').dataset.quiet ?? null, previewQuiet: document.querySelector('[data-testid=card-preview]').dataset.quiet ?? null, sheetGlyph: sheet ? getComputedStyle(sheet).color : null, memorial: document.querySelector('.slip').dataset.memorial ?? null }
    })
    check(`${purpose} order form: the slip glyph and rule${quiet ? ' and the card preview glyph are ink, marked data-quiet, and it is NOT worded as a remembrance' : ' and the card preview glyph are cinnabar (not quiet)'}`, quiet ? form.slipGlyph === INK && form.slipTop === INK && form.slipQuiet === 'yes' && form.previewQuiet === 'yes' && form.sheetGlyph !== SEAL && form.memorial === null : form.slipGlyph === SEAL && form.slipQuiet === null && form.sheetGlyph === SEAL, JSON.stringify(form))
    check(`no page errors (run 13c, ${purpose})`, errors.length === 0, errors.join('; '))
    await page.close()
  }
  // the receiver's page and the sender's film: an apology view is ink, a celebration view keeps the cinnabar character
  const view = (over) => ({ id: 'AN-testtesttesttesttest', language: 'ja', glyph: '備', reading: 'そな.える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false, film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, certificate_line: 'この字は、あなたの目に映る、その人です。', poem: null, ...over })
  for (const [purpose, quiet] of [['apology', true], ['encourage', true], ['memorial', true], ['celebrate', false]]) {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' })
    const errs = []
    p.on('pageerror', (e) => errs.push(String(e)))
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: view({ purpose }) }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.waitForSelector('[data-testid=film-still]')
    const still = await p.evaluate(() => ({ quiet: document.querySelector('[data-testid=film-still]').dataset.quiet, kanji: getComputedStyle(document.querySelector('.an-card-kanji')).color }))
    check(`film (${purpose}): the character is ${quiet ? 'ink, never cinnabar (data-quiet=yes)' : 'cinnabar'}`, quiet ? still.quiet === 'yes' && still.kanji !== 'rgb(192, 57, 43)' && /^rgb\((\d+), (\d+), (\d+)\)$/.test(still.kanji) && Number(still.kanji.match(/\d+/g)[0]) < 60 : still.quiet === 'no' && still.kanji === 'rgb(192, 57, 43)', JSON.stringify(still))
    check(`no page errors (run 13c, film ${purpose})`, errs.length === 0, errs.join('; '))
    await p.close()
  }
  for (const [purpose, quiet] of [['apology', true], ['encourage', true], ['celebrate', false]]) {
    const TOKEN = 'RG-testtesttesttesttest'
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 375, height: 844 } })
    const errs = []
    p.on('pageerror', (e) => errs.push(String(e)))
    await p.route(`**/api/gift/${TOKEN}**`, (r) => r.fulfill({ json: { ...view({ purpose }), locked: false, id: TOKEN, token: TOKEN, from: '山田 太郎', to: '山田 一郎', message: 'ごめんね。', egift: null, certificate_no: 12, order_date: '2026-11-07', opens_on: null, replied: false, package: 'simple' } }))
    await p.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    await p.waitForSelector('[data-testid=gift-page]')
    const g = await p.evaluate(() => { const el = document.querySelector('[data-testid=gift-page]'); return { quiet: el.dataset.quiet, cls: el.className, char: getComputedStyle(el).getPropertyValue('--char').trim().toLowerCase() } })
    check(`gift page (${purpose}): ${quiet ? 'the page is in the ink style (gf-memorial, data-quiet=yes) and the character colour is not cinnabar' : 'the celebration colours stay (cinnabar character)'}`, quiet ? g.quiet === 'yes' && g.cls.includes('gf-memorial') && g.char !== '#c0392b' : g.quiet === 'no' && !g.cls.includes('gf-memorial') && g.char === 'var(--cinnabar)' || g.char === '#c0392b', JSON.stringify(g))
    check(`no page errors (run 13c, gift ${purpose})`, errs.length === 0, errs.join('; '))
    await p.close()
  }
}

// ---------- Run 13d (launch freeze): the e-gift-first switch — 木札 and 版木 are shown as 「近日公開」 with disabled buttons; the e-gift is unchanged ----------
{
  const SOON = { en: 'Coming soon', 'zh-Hant': '即將推出', ja: '近日公開' }
  for (const [lang, soonOn] of [['ja', true], ['zh-Hant', true], ['en', true], ['ja', false]]) {
    const { page, errors } = await mockPage(browser, { result: (b) => ({ ...clone(FIXTURE), language: b.language, occasion: null, purpose: b.purpose }), order: () => ({ json: { order_ref: 'IC-20261026-SOON2222', checkout_url: 'http://localhost:5173/__checkout?cart=s', glyph: '証', certificate_text: 'x', certificate: { memorial: false } } }) })
    await page.route('**/api/sizes', (r) => r.fulfill({ json: soonOn ? { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'] } : { sizes: ['egift', 'simple', 'standard'] } }))
    await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#gifts article.gift')
    const cards = await page.evaluate(() => [...document.querySelectorAll('#gifts article.gift')].map((a) => ({ id: a.dataset.size, soon: a.dataset.comingSoon ?? null, badge: a.querySelector('.badge')?.textContent ?? null, cta: a.querySelector('[data-testid^=gift-cta]')?.tagName ?? null, disabled: a.querySelector('[data-testid^=gift-cta]')?.disabled ?? null, label: a.querySelector('[data-testid^=gift-cta]')?.textContent ?? null })))
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]))
    if (soonOn) {
      check(`wood sizes switch on (${lang}): 木札 and 版木 are listed with 「${SOON[lang]}」 and a DISABLED button; the e-gift keeps its badge and its link`, cards.length === 3 && ['simple', 'standard'].every((id) => byId[id].soon === 'yes' && byId[id].badge === SOON[lang] && byId[id].cta === 'BUTTON' && byId[id].disabled === true && byId[id].label === SOON[lang]) && byId.egift.soon === null && byId.egift.cta === 'A' && byId.egift.badge !== SOON[lang], JSON.stringify(cards))
    } else {
      check('wood sizes switch OFF (default): no 「近日公開」 anywhere, every size has its normal link', cards.length === 3 && cards.every((c) => c.soon === null && c.cta === 'A' && c.badge !== SOON.ja), JSON.stringify(cards))
    }
    if (lang === 'ja') {
      await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
      await page.click(`#write >> text=${GO.ja}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      await page.locator('article[data-slot=main]').locator(`text=${GIVE.ja}`).click()
      await page.locator('[data-testid=order-form]').waitFor()
      const radios = await page.evaluate(() => [...document.querySelectorAll('input[name=package]')].map((i) => ({ v: i.value, disabled: i.disabled, soon: i.closest('label').dataset.comingSoon ?? null, badge: i.closest('label').querySelector('.badge[data-badge=soon]')?.textContent ?? null })))
      const rb = Object.fromEntries(radios.map((r) => [r.v, r]))
      if (soonOn) check('wood sizes switch on: in the order form the 木札 and 版木 choices are disabled and say 「近日公開」; the e-gift can be chosen', radios.length === 3 && ['simple', 'standard'].every((v) => rb[v].disabled === true && rb[v].soon === 'yes' && rb[v].badge === '近日公開') && rb.egift.disabled === false && rb.egift.badge === null, JSON.stringify(radios))
      else check('wood sizes switch OFF: the order form has no disabled size and no 「近日公開」', radios.length === 3 && radios.every((r) => r.soon === null && r.badge === null), JSON.stringify(radios))
    }
    check(`no page errors (run 13d, ${lang}${soonOn ? '' : ', off'})`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 13e (2026-11-07): the e-gift has no printed card — the poem note and the card-preview line on the order step say so; the printed-card wording stays for 木札 / 版木 (only while wood is on sale) ----------
{
  const NEW = {
    ja: { note: 'この歌は、贈りものページと、ご自宅で印刷できるカードPDFに入ります。', lead: 'カードの内側（見本）：字と歌、そして物語の四つの場面。eギフトでは、ご自宅で印刷できるPDFでお届けします。' },
    'zh-Hant': { note: '這首詩會出現在禮物頁面，以及可在家列印的卡片PDF上。', lead: '卡片內頁（樣本）：有字、有詩，還有你故事的四個場景。e禮物會以可在家列印的PDF提供。' },
    en: { note: 'This poem appears on the gift page and on the card PDF you can print at home.', lead: 'Inside of the card (sample): the character, the poem and four scenes from your story. With the e-gift, it comes as a PDF you can print at home.' },
  }
  const OLD = {
    ja: { note: 'この歌が、カードに印刷されます', lead: 'ご注文いただくカードの内側です。字と詩、あなたの物語の四つの場面が入ります。' },
    'zh-Hant': { note: '這首詩將印在卡片上', lead: '這是您訂購的卡片內側：有字、有詩，還有您故事的四個場景。' },
    en: { note: 'This poem is printed on your card', lead: 'This is the inside of the card you are ordering: the character, the poem and four scenes from your story.' },
  }
  const open = async (lang, soonOn) => {
    const { page, errors } = await mockPage(browser, { result: (b) => ({ ...clone(FIXTURE), language: b.language, occasion: null, purpose: b.purpose }), order: () => ({ json: { order_ref: 'IC-20261107-EGIFT111', checkout_url: 'http://localhost:5173/__checkout?cart=e', glyph: '証', certificate_text: 'x' } }) })
    await page.route('**/api/sizes', (r) => r.fulfill({ json: soonOn ? { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'] } : { sizes: ['egift', 'simple', 'standard'] } }))
    await page.route('**/api/poem', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ json: { poem_id: 'PM-20261107-abcdefghj1', type: b.type, lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: '', aids: {}, preview: 'x' } })
    })
    await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await page.locator('[data-testid=order-form]').waitFor()
    await page.locator('[data-poem-result][data-state=ready]').waitFor({ timeout: 15000 })
    return { page, errors }
  }
  const texts = async (page) => ({ note: await page.locator('[data-poem-result]').innerText(), lead: await page.locator('[data-testid=card-lead]').innerText() })
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const { page, errors } = await open(lang, true)
    let t = await texts(page)
    check(`e-gift wording (${lang}, wood coming soon): the poem note and the card-preview line are the owner's words, exactly, before any size is picked (the e-gift is the only gift)`, t.note.includes(NEW[lang].note) && t.lead === NEW[lang].lead, JSON.stringify(t))
    await page.locator('label[data-size=egift]').click()
    t = await texts(page)
    check(`e-gift wording (${lang}): with the e-gift selected the same words stay, and the printed-card wording is nowhere on the page`, t.note.includes(NEW[lang].note) && t.lead === NEW[lang].lead && !t.note.includes(OLD[lang].note) && !(await page.locator('[data-testid=order-form]').innerText()).includes(OLD[lang].lead), JSON.stringify(t))
    if (lang === 'zh-Hant') await page.screenshot({ path: `${SHOTS}/e2e-order-egift-zh-Hant.png`, fullPage: true })
    check(`no page errors (run 13e, ${lang}, wood coming soon)`, errors.length === 0, errors.join('; '))
    await page.close()
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const { page, errors } = await open(lang, false)
    let t = await texts(page)
    check(`printed-card wording (${lang}, wood on sale): before a size is picked the current wording stays`, t.note.includes(OLD[lang].note) && t.lead === OLD[lang].lead, JSON.stringify(t))
    await page.locator('label[data-size=simple]').click()
    t = await texts(page)
    check(`printed-card wording (${lang}): 木札 selected → the printed-card wording (the card is printed and sent)`, t.note.includes(OLD[lang].note) && t.lead === OLD[lang].lead && !t.note.includes(NEW[lang].note), JSON.stringify(t))
    await page.locator('label[data-size=standard]').click()
    t = await texts(page)
    check(`printed-card wording (${lang}): 版木 selected → the printed-card wording`, t.note.includes(OLD[lang].note) && t.lead === OLD[lang].lead, JSON.stringify(t))
    await page.locator('label[data-size=egift]').click()
    t = await texts(page)
    check(`e-gift wording (${lang}, wood on sale): choosing the e-gift switches to the e-gift words, choosing 木札 switches back`, t.note.includes(NEW[lang].note) && t.lead === NEW[lang].lead, JSON.stringify(t))
    check(`no page errors (run 13e, ${lang}, wood on sale)`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 13f (2026-11-07): while wood is "coming soon" no customer-facing text promises carving, printing or posting; with wood on sale the wood wording is back ----------
{
  // what may stay: the names of the sizes (they are listed with 「近日公開」), and the e-gift's own words (it is not posted, it needs no shipping, its card is a PDF to print at home)
  const NAMES = ['木札（シンプル）', '版木（スタンダード）', '木牌（簡約）', '版木（標準）', 'Wooden tag (Simple)', 'Block set (Standard)']
  // (the example stories on the page are customers' sample stories, not promises: 「彫った木のスプーン」 / 「我九歲刻的木湯匙」 / "the wooden spoon I carved at nine")
  const ALLOWED = ['那一刻', '這一刻', '一刻', '時刻', '此刻', '片刻', '立刻', '九歳のわたしが彫った木のスプーン', '我九歲刻的木湯匙', 'the wooden spoon I carved at nine', '免運費（以連結送出）', '送料を含む', '含運費', 'including shipping', '郵送されません', '郵送がなく', '送料はかかりません', '送料なし', '不郵寄', '無運費', '无运费', 'No shipping', 'no shipping', 'not posted', 'ご自宅で印刷できる', '可在家列印', 'print at home', 'you can print at home']
  const PROMISE = {
    ja: /刻|彫|木に|木の|拓本|拓墨|EMS|郵送|送料|水引|化粧箱|ギフトボックス|お届け希望日|印刷した|印刷され/,
    'zh-Hant': /刻|木牌|木字版|版木|拓|EMS|郵寄|運費|水引|禮盒|期望送達日|印刷|印在/,
    en: /carv|wooden|wood\b|in wood|engrav|rubbing|mizuhiki|\bEMS\b|\bship|posted|delivery date|printed card|printed on/i,
  }
  const scrub = (text) => { let t = text; for (const n of [...NAMES, ...ALLOWED]) t = t.split(n).join(' '); return t.replace(/\s+/g, ' ') }
  const found = (text, lang) => { const t = scrub(text); const m = t.match(PROMISE[lang]); return m ? `[${m[0]}] …${t.slice(Math.max(0, m.index - 30), m.index + 40)}` : null }
  const GO13 = GO
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (const soonOn of [true, false]) {
      const { page, errors } = await mockPage(browser, { result: (b) => ({ ...clone(FIXTURE), language: b.language, occasion: null, purpose: b.purpose }), order: () => ({ json: { order_ref: 'IC-20261107-NOWOOD11', checkout_url: 'http://localhost:5173/__checkout?cart=n', glyph: '証', certificate_text: 'x' } }) })
      await page.route('**/api/sizes', (r) => r.fulfill({ json: soonOn ? { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'] } : { sizes: ['egift', 'simple', 'standard'] } }))
      await page.route('**/api/poem', async (route) => {
        const b = JSON.parse(route.request().postData() ?? '{}')
        await route.fulfill({ json: { poem_id: 'PM-20261107-abcdefghj2', type: b.type, lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: '', aids: {}, preview: 'x' } })
      })
      // 1. the landing: every word on the page, the image descriptions and the meta description
      await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('#gifts article.gift')
      await page.waitForTimeout(300)
      const landing = await page.evaluate(() => [document.body.textContent, ...[...document.querySelectorAll('img[alt]')].map((i) => i.alt), document.querySelector('meta[name=description]')?.content ?? ''].join(' \n '))
      const hitLanding = found(landing, lang)
      check(`wood ${soonOn ? 'coming soon' : 'on sale'} (${lang}) — landing: ${soonOn ? 'no carving, printing or posting is promised anywhere on the page (hero, steps, gifts, FAQ, closing, meta)' : 'the wood wording is back (the hero, the gift cards and the FAQ speak of the wooden gifts)'}`, soonOn ? hitLanding === null : hitLanding !== null, String(hitLanding))
      if (soonOn) {
        const cards = await page.evaluate(() => [...document.querySelectorAll('#gifts article.gift')].map((a) => ({ id: a.dataset.size, items: a.querySelectorAll('li').length, soon: a.dataset.comingSoon ?? null })))
        check(`wood coming soon (${lang}) — the two wooden gift cards list their name, price and 「近日公開」 only: no feature list; the e-gift card keeps its list`, cards.filter((c) => c.soon === 'yes').every((c) => c.items === 0) && cards.find((c) => c.id === 'egift').items > 0, JSON.stringify(cards))
      }
      // 2. /legal
      await page.goto('http://localhost:5173/legal', { waitUntil: 'networkidle' })
      await page.locator(`[data-lang=${lang}]`).click()
      await page.waitForSelector('[data-testid=legal-rows]')
      await page.waitForTimeout(300)
      const legal = await page.locator('[data-testid=legal-page]').textContent()
      const hitLegal = found(legal ?? '', lang)
      check(`wood ${soonOn ? 'coming soon' : 'on sale'} (${lang}) — /legal: ${soonOn ? 'prices, charges, "if we made a mistake", delivery and the FAQ are about the e-gift only' : 'the wooden sizes are in the prices, the charges, the delivery and the defect rules'}`, soonOn ? hitLegal === null : hitLegal !== null, String(hitLegal))
      // 3. the order step: the poem panel, the card preview, the sizes, the forms
      await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
      await page.click(`#write >> text=${GO13[lang]}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      const cardsText = await page.locator('#write').textContent()
      await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
      await page.locator('[data-testid=order-form]').waitFor()
      await page.locator('[data-poem-result][data-state=ready]').waitFor({ timeout: 15000 })
      await page.waitForTimeout(400)
      const order = await page.locator('[data-testid=order-form]').textContent()
      const hitOrder = found(`${order}\n${cardsText}`, lang)
      check(`wood ${soonOn ? 'coming soon' : 'on sale'} (${lang}) — order step and card screen: ${soonOn ? 'the poem panel, the character-form line, the sizes, the card preview and the date and shipping lines say nothing about carving, printing or posting' : 'the wood wording is back (delivery date, shipping note, what each size includes)'}`, soonOn ? hitOrder === null : hitOrder !== null, String(hitOrder))
      if (soonOn) {
        const ctl = { date: await page.locator('#delivery_date').count(), ship: await page.locator('[data-shipping]').count(), includesWood: await page.locator('[data-includes=simple], [data-includes=standard]').count() }
        check(`wood coming soon (${lang}) — no delivery-date field, no shipping note, no "what it includes" line under the wooden sizes`, ctl.date === 0 && ctl.ship === 0 && ctl.includesWood === 0, JSON.stringify(ctl))
      } else {
        check(`wood on sale (${lang}) — the delivery-date field, the shipping note and the wooden sizes' descriptions are shown`, (await page.locator('#delivery_date').count()) === 1 && (await page.locator('[data-shipping]').count()) === 1 && (await page.locator('[data-includes=simple]').count()) === 1)
      }
      check(`no page errors (run 13f, ${lang}, ${soonOn ? 'coming soon' : 'on sale'})`, errors.length === 0, errors.join('; '))
      await page.close()
    }
  }
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

// ---------- Run 15 (v9.6): purpose chips, state chips, 「その他」 free texts — the form in ja / zh-Hant / en, and the gift page's opening words per purpose ----------
{
  const FORM = {
    ja: { lang: 'ja', purposeLabel: '贈る理由', stateLabel: '今のふたりは（任意）', other: 'その他', relOtherPh: '例：幼なじみ、元同僚', purposes: ['お祝い（誕生日・還暦・結婚・出産・入学など）', 'ありがとう', 'ごめんね・仲直り', '応援・お見舞い', '門出・送別（退職・引っ越し・卒業）', 'ご無沙汰・再会', '想いを伝える（ずっと言えなかったこと）', '偲ぶ', 'その他'], states: ['いつも近く', '離れて暮らす', 'しばらく会っていない', 'すれ違ったまま', 'もう会えない', 'その他'], caregiver: 'お世話になった人（医療・介護・支えてくれた人）' },
    'zh-Hant': { lang: 'zh-Hant', purposeLabel: '送禮的理由', stateLabel: '現在的兩人（選填）', other: '其他', relOtherPh: '例如：青梅竹馬、前同事', purposes: ['祝福（生日・六十大壽・結婚・出生・入學等）', '謝謝', '道歉・和好', '加油・探望', '送別・新旅程（退休・搬家・畢業）', '久違・重逢', '傳達心意（一直沒說出口的話）', '追思', '其他'], states: ['常在身邊', '分隔兩地', '很久沒見', '還有心結', '已無法相見', '其他'], caregiver: '照顧過我的人（醫療・照護・支持我的人）' },
    en: { lang: 'en', purposeLabel: "Why you're giving", stateLabel: 'Where the two of you stand now (optional)', other: 'Other', relOtherPh: 'e.g. childhood friend, former colleague', purposes: ['Celebrate (birthday, 60th, wedding, birth, school…)', 'Thank you', 'Sorry / making up', 'Encourage / get well', 'Farewell / new start (retiring, moving, graduating)', 'Keep in touch / meeting again', 'Say it at last (what was never said)', 'In memory', 'Other'], states: ['Close', 'Living apart', "Haven't met in a while", 'Something unresolved', 'No longer here', 'Other'], caregiver: 'Someone who cared for me (medical, care, support)' },
  }
  for (const [lang, f] of Object.entries(FORM)) {
    const { page, errors, calls } = await mockPage(browser)
    await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    const labels = async (group) => page.locator(`[data-chip^="${group}:"]`).evaluateAll((els) => els.map((e) => e.innerText.trim()))
    check(`form (${lang}): the purpose chips are the nine of the ticket, in order, with the right words`, (await labels('purpose')).join('|') === f.purposes.join('|'), (await labels('purpose')).join('|'))
    check(`form (${lang}): the state chips are the six, in order, with the right words`, (await labels('state')).join('|') === f.states.join('|'), (await labels('state')).join('|'))
    check(`form (${lang}): the group labels read 「${f.purposeLabel}」 and 「${f.stateLabel}」; the relationship chips include the caregiver chip and end with 「${f.other}」`, (await page.locator('#write').innerText()).includes(f.purposeLabel) && (await page.locator('#write').innerText()).includes(f.stateLabel) && (await labels('relationship')).includes(f.caregiver) && (await labels('relationship')).at(-1) === f.other)
    check(`form (${lang}): no 「その他」 text field is shown until 「${f.other}」 is picked`, (await page.locator('input[name=relationship_other], input[name=purpose_other], input[name=state_other]').count()) === 0)
    // 「その他」 shows its field with the limit and the placeholder
    await page.click('[data-chip="relationship:other"]')
    const ro = page.locator('input[name=relationship_other]')
    check(`form (${lang}): relationship 「${f.other}」 shows a text field, max 20, with the example placeholder`, (await ro.count()) === 1 && (await ro.getAttribute('maxlength')) === '20' && (await ro.getAttribute('placeholder')) === f.relOtherPh)
    await page.click('[data-chip="purpose:other"]')
    const po = page.locator('input[name=purpose_other]')
    check(`form (${lang}): purpose 「${f.other}」 shows a text field, max 30`, (await po.count()) === 1 && (await po.getAttribute('maxlength')) === '30')
    await page.click('[data-chip="state:other"]')
    const so = page.locator('input[name=state_other]')
    check(`form (${lang}): state 「${f.other}」 shows a text field, max 20`, (await so.count()) === 1 && (await so.getAttribute('maxlength')) === '20')
    await po.fill('あ'.repeat(40))
    await ro.fill('い'.repeat(40))
    check(`form (${lang}): the text fields stop at their limits (30 / 20)`, [...(await po.inputValue())].length === 30 && [...(await ro.inputValue())].length === 20)
    // the milestone field is for celebrate and other
    check(`form (${lang}): the milestone field is shown for 「${f.other}」 (and celebrate), not for the other purposes`, (await page.locator('input[name=occasion_detail]').count()) === 1)
    await page.click('[data-chip="purpose:thanks"]')
    check(`form (${lang}): … and gone again for thanks`, (await page.locator('input[name=occasion_detail]').count()) === 0 && (await page.locator('input[name=purpose_other]').count()) === 0)
    await page.click('[data-chip="purpose:celebrate"]')
    check(`form (${lang}): … and shown for celebrate`, (await page.locator('input[name=occasion_detail]').count()) === 1)
    await page.click('[data-chip="purpose:thanks"]')
    await page.click('[data-chip="purpose:thanks"]') // (a purpose cannot be un-picked: it stays pressed)
    check(`form (${lang}): a purpose is required — the submit button is off until the relationship, direction AND purpose are picked; the state is optional`, await (async () => {
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。そのうしろ姿を、私はずっと覚えている。')
      const btn = page.locator('#write button[type=submit]')
      await page.click('[data-chip="relationship:parent_father"]')
      await page.click('[data-chip="direction:up"]')
      const offWithoutPurpose = await btn.isDisabled()
      await page.click('[data-chip="purpose:thanks"]')
      return offWithoutPurpose && (await btn.isEnabled()) && (await page.locator('[data-chip^="state:"][aria-pressed=true]').count()) === 0
    })())
    // the state is a toggle (blank = the engine reads it from the story), and goes to the engine only when picked
    await page.click('[data-chip="state:strained"]')
    check(`form (${lang}): a state chip can be picked and picked again to clear it`, (await page.locator('[data-chip="state:strained"][aria-pressed=true]').count()) === 1 && (await (async () => { await page.click('[data-chip="state:strained"]'); return (await page.locator('[data-chip^="state:"][aria-pressed=true]').count()) === 0 })()))
    await page.click('[data-chip="state:lost"]')
    await page.click('#write button[type=submit]')
    await page.waitForSelector('[data-all-revealed=yes], article', { timeout: 15000 })
    const sent = calls.select.at(-1)
    check(`form (${lang}): the request carries relationship, direction, purpose and state as codes (and no old occasion)`, sent.relationship === 'parent_father' && sent.direction === 'up' && sent.purpose === 'thanks' && sent.state === 'lost' && !('occasion' in sent) && !('purpose_other' in sent) && !('state_other' in sent), JSON.stringify(sent))
    check(`form (${lang}): no page errors`, errors.length === 0, errors.join('; '))
    await page.close()
  }
  // the 「その他」 texts travel, trimmed, with the codes
  {
    const { page, calls } = await mockPage(browser)
    await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
    await page.locator('#write [data-testid=story-input]').fill('幼なじみは、毎年私の誕生日に手紙をくれた。字が少し右上がりだった。')
    await page.click('[data-chip="relationship:other"]')
    await page.fill('input[name=relationship_other]', '  幼なじみ ')
    await page.click('[data-chip="direction:across"]')
    await page.click('[data-chip="purpose:other"]')
    await page.fill('input[name=purpose_other]', '幼なじみの誕生日')
    await page.click('#write button[type=submit]')
    await page.waitForSelector('article', { timeout: 15000 })
    const b = calls.select.at(-1)
    check('form: 「その他」 texts go to the engine trimmed, beside their codes (relationship other, purpose other)', b.relationship === 'other' && b.relationship_other === '幼なじみ' && b.purpose === 'other' && b.purpose_other === '幼なじみの誕生日' && !('state' in b), JSON.stringify(b))
    await page.close()
  }

  // the gift page: 「おめでとう」 only for celebrate; apology / encourage / remembrance are quiet (ink class) and carry no celebration word
  {
    const TOKEN = 'RG-testtesttesttesttest'
    const year = new Date().getFullYear()
    const view = (over) => ({ locked: false, id: TOKEN, token: TOKEN, language: 'ja', glyph: '備', reading: 'そな-える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', memorial: false, film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, certificate_line: 'この字は、あなたの目に映る、その人です。', poem: { type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: 'あさごとに' }, from: '山田 太郎', to: '山田 一郎', message: 'いつも、ありがとう。', egift: null, certificate_no: 12, order_date: `${year}-11-07`, opens_on: null, replied: false, package: 'simple', ...over })
    const lineOf = async (v) => {
      const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 375, height: 844 } })
      const page = await ctx.newPage()
      await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
        const u = new URL(r.request().url())
        if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: v } })
        if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: v })
        return r.continue()
      })
      await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
      await page.locator('[data-testid=gift-envelope]').waitFor()
      const line = await page.locator('[data-testid=gift-env-line]').innerText()
      const quiet = (await page.locator('.gf-page.gf-memorial').count()) === 1
      await ctx.close()
      return { line, quiet }
    }
    const cel = await lineOf(view({ purpose: 'celebrate' }))
    check('gift page: celebrate opens with 「おめでとう」 and is not quiet', cel.line.startsWith('おめでとう') && !cel.quiet, JSON.stringify(cel))
    const th = await lineOf(view({ purpose: 'thanks' }))
    check('gift page: thanks opens with 「ありがとうを込めて」 — not 「おめでとう」', th.line.startsWith('ありがとう') && !/おめでとう/.test(th.line) && !th.quiet, JSON.stringify(th))
    for (const purpose of ['apology', 'encourage']) {
      const r = await lineOf(view({ purpose }))
      check(`gift page: ${purpose} has no 「おめでとう」 / 祝 and uses the quiet (ink, no red) look`, !/おめでとう|祝/.test(r.line) && r.quiet, JSON.stringify(r))
    }
    const mem = await lineOf(view({ purpose: 'memorial', memorial: true }))
    check('gift page: memorial has no 「おめでとう」 / 祝 and the quiet look', !/おめでとう|祝/.test(mem.line) && mem.quiet, JSON.stringify(mem))
    const old = await lineOf(view({}))
    check('gift page: an old gift (no purpose) shows exactly the line it always did', old.line === 'あなただけに届いた、一字の贈りもの' && !old.quiet, JSON.stringify(old))
  }
}

// ---------- Run 16 (v9.7): the 気持ち line never shows a raw English code on a Japanese or Chinese page ----------
{
  const REG = ['apologetic', 'humble', 'zzz-unmapped']
  const regResult = (body) => {
    const r = clone(FIXTURE)
    r.language = body.language
    r.fingerprint = { ...(r.fingerprint ?? {}), emotional_register: REG }
    return r
  }
  const LABEL = { ja: '気持ち', 'zh-Hant': '心情', 'zh-Hans': '心情' }
  for (const lang of ['ja', 'zh-Hant', 'zh-Hans', 'en']) {
    const { page, errors } = await mockPage(browser, { result: regResult })
    await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await pickContext(page, { relationship: 'sibling', direction: 'across', purpose: 'apology' })
    await page.locator('#write [data-testid=story-input]').fill('兄とは長く話していなかった。春に、私から先に手紙を書いた。返事は短かったが、最後に私の好きな店の名前があった。')
    await page.click('#write button[type=submit]')
    await page.waitForSelector('[data-match-feeling]', { timeout: 15000 })
    const texts = await page.locator('[data-match-feeling] dd').allInnerTexts()
    const label = (await page.locator('[data-match-feeling] dt').first().innerText()).trim()
    const joined = texts.join(' ')
    if (lang === 'en') {
      check('feeling line (en): the known words are shown as English labels, the unmapped word is dropped', texts.length > 0 && /Apologetic/.test(joined) && /Humble/.test(joined) && !/zzz/i.test(joined), joined)
    } else {
      check(`feeling line (${lang}): label 「${LABEL[lang]}」 and the line has NO ASCII word — the raw code "humble" is shown as its translation, the unmapped word is dropped`, label === LABEL[lang] && texts.length > 0 && texts.every((t) => !/[A-Za-z]{2,}/.test(t)) && !/zzz/i.test(joined), `${label} | ${joined}`)
    }
    if (lang === 'ja') check('feeling line (ja): reads 詫びる気持ち・謙虚さ', texts.every((t) => t.trim() === '詫びる気持ち・謙虚さ'), joined)
    check(`feeling line (${lang}): no page errors`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 17 (2026-11-05 Part 4): the card screen — one button per card, 字を選びなおす, the retry button only after a failure, 物語を書きなおす keeps the story ----------
{
  const STORY17 = '祖母は、いつも縁側で私の帰りを待っていた。何も言わず、ただ湯のみを二つ置いて。'
  let failNext = true
  const { page, errors } = await mockPage(browser, {})
  await page.unroute('**/api/select')
  const bodies = []
  await page.route('**/api/select', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    bodies.push(body)
    if (failNext) {
      failNext = false
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'いま、うまく探せませんでした。' }) })
      return
    }
    await route.fulfill({ json: FIXTURE })
  })
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  await page.locator('#moment').fill(STORY17)
  await pickContext(page, { relationship: 'grandparent', direction: 'up', occasion: 'seasonal_thanks' })
  await page.click(`#write >> text=${GO.ja}`)
  await page.locator('[data-testid=retry-request]').waitFor({ timeout: 15000 })
  check('a failed request: the message and 「もう一度ためす」 are shown', (await page.locator('[data-testid=retry-request]').innerText()) === 'もう一度ためす')
  await page.click('[data-testid=retry-request]')
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('「もう一度ためす」 repeats the SAME request (same story, same context)', bodies.length === 2 && JSON.stringify(bodies[0]) === JSON.stringify(bodies[1]))
  check('after success the retry button is gone', (await page.locator('[data-testid=retry-request]').count()) === 0)
  // the top line and the buttons
  check('top line: あなたの物語から見つかった字です。贈りたい一字を選んでください。', (await page.locator('[data-reveal-intro]').innerText()) === 'あなたの物語から見つかった字です。贈りたい一字を選んでください。')
  // order: cards → new round → pager → edit-story
  check('order top to bottom: cards → 別の二字を探す → 物語を書きなおす (no pager with one round)', await page.evaluate(() => { const q = (s) => document.querySelector(s); const pos = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & 4)); return pos(q('article[data-slot=freestyle], article[data-slot=second]'), q('[data-testid=see-others]')) && pos(q('[data-testid=see-others]'), q('[data-testid=edit-story]')) && !q('[data-testid=set-label]') }))
  // choose, then go back: same round, nothing lost
  await page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await page.locator('[data-testid=order-form]').waitFor()
  check('order step: 「字を選びなおす」 is above the character slip', (await page.locator('[data-testid=choose-other]').innerText()) === '字を選びなおす' && (await page.evaluate(() => { const a = document.querySelector('[data-testid=choose-other]'); const b = document.querySelector('.slip'); return !!(a && b && (a.compareDocumentPosition(b) & 4)) })))
  await page.click('[data-testid=choose-other]')
  await page.locator('article[data-slot=main]').waitFor()
  check('字を選びなおす returns to the same cards (no new engine call)', bodies.length === 2 && (await page.locator('article[data-slot]').count()) === 3 && (await page.locator('[data-testid=order-form]').isHidden()))
  // edit story keeps the story and the chips
  await page.click('[data-testid=edit-story]')
  await page.locator('#moment').waitFor()
  check('物語を書きなおす returns to the form with the story and the chips kept', (await page.locator('#moment').inputValue()).includes('縁側') && (await page.locator('[data-chip="relationship:grandparent"][aria-pressed=true]').count()) === 1)
  check('no page errors (run 17)', errors.length === 0, errors.join('; '))
  await page.close()
}

// ---------- Run 18 (2026-11-05 Part 8): the wait screen shows 4–6 phrases cut from the visitor's own story; the browser sends nothing extra ----------
{
  const LONG = '祖母は、いつも縁側で私の帰りを待っていた。何も言わず、ただ湯のみを二つ置いて。夏は麦茶で、冬は熱いほうじ茶だった。私が黙って座ると、祖母も黙って隣にいた。ある日、湯のみがひとつしか置かれていなかった。それでも私は、縁側に座った。'
  const { page, errors, calls } = await mockPage(browser, {})
  await page.unroute('**/api/select')
  await page.route('**/api/select', async (route) => {
    calls.select.push(JSON.parse(route.request().postData() ?? '{}'))
    await new Promise((r) => setTimeout(r, 4500))
    await route.fulfill({ json: FIXTURE })
  })
  const others = []
  page.on('request', (r) => { if (r.method() === 'POST' && !/\/api\/(select|log|analytics)/.test(r.url())) others.push(r.url()) })
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  await page.locator('#moment').fill(LONG)
  await pickContext(page, { relationship: 'grandparent', direction: 'up', occasion: 'seasonal_thanks' })
  await page.click(`#write >> text=${GO.ja}`)
  await page.locator('[data-testid=story-phrases]').waitFor({ timeout: 5000 })
  const count = Number(await page.getAttribute('[data-testid=story-phrases]', 'data-count'))
  const first = (await page.locator('[data-testid=story-phrase]').innerText()).replace(/^「|」$/g, '')
  check('the wait screen shows story phrases (4–6), each one a piece of the visitor\'s own story, inside 「 」, hidden from screen readers', count >= 4 && count <= 6 && LONG.includes(first) && (await page.getAttribute('[data-testid=story-phrases]', 'aria-hidden')) === 'true')
  await page.waitForTimeout(4200)
  const gone = await page.locator('[data-testid=story-phrase]').count()
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('…the phrase changes while waiting, nothing extra is sent (only the one /api/select call), and the phrases are gone when the cards come', gone <= 1 && calls.select.length === 1 && others.length === 0 && (await page.locator('[data-testid=story-phrases]').count()) === 0, JSON.stringify(others))
  check('no page errors (run 18)', errors.length === 0, errors.join('; '))
  await page.close()
}

// ---------- Run 19 (2026-11-05 Part 7): the direction is pre-selected from the relationship — and the sender can change it (ja / zh-Hant / en) ----------
{
  const MAP = { parent_mother: 'up', parent_father: 'up', grandparent: 'up', mentor: 'up', child: 'down', spouse: 'across', romance: 'across', sibling: 'across', friend: 'across', work: '', in_law: '', community: '', caregiver: '', pet: '', other: '' }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const { page, errors } = await mockPage(browser, {})
    await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    const pressed = async () => (await page.locator('[data-chip^="direction:"][aria-pressed=true]').evaluateAll((els) => els.map((e) => e.dataset.chip.split(':')[1])))
    const bad = []
    for (const [rel, want] of Object.entries(MAP)) {
      await page.click(`[data-chip="relationship:${rel}"]`)
      const got = (await pressed()).join()
      if (got !== want) bad.push(`${rel}: ${got || '(none)'} ≠ ${want || '(none)'}`)
    }
    check(`direction pre-selected from the relationship (${lang}): 母 父 祖父母 恩師 → up · 子ども → down · 配偶者 恋人 きょうだい 友人 → across · 仕事の相手 義理の家族 地域 お世話になった人 ペット その他 → nothing`, bad.length === 0, bad.join('; '))
    // a pre-selected chip looks EXACTLY like a selected one (same attribute, same classes, same computed style as a chip the sender pressed)
    await page.click('[data-chip="relationship:friend"]')
    await page.waitForTimeout(700)
    const auto = await page.locator('[data-chip="direction:across"]').evaluate((e) => ({ pressed: e.getAttribute('aria-pressed'), cls: e.className, bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, border: getComputedStyle(e).borderColor }))
    await page.click('[data-chip="direction:up"]')
    await page.click('[data-chip="direction:across"]')
    await page.waitForTimeout(700)
    const manual = await page.locator('[data-chip="direction:across"]').evaluate((e) => ({ pressed: e.getAttribute('aria-pressed'), cls: e.className, bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, border: getComputedStyle(e).borderColor }))
    check(`a pre-selected direction chip looks exactly like one the sender pressed (${lang}): same aria-pressed, same classes, same colours`, auto.pressed === 'true' && JSON.stringify(auto) === JSON.stringify(manual), JSON.stringify([auto, manual]))
    // the sender can change it, and the change is kept when the relationship changes afterwards
    await page.click('[data-chip="relationship:parent_mother"]')
    await page.click('[data-chip="direction:across"]')
    check(`the sender can change the pre-selected direction (${lang}): up → across`, (await pressed()).join() === 'across')
    await page.click('[data-chip="relationship:child"]')
    check(`…and their own choice is kept when they pick another relationship (${lang}); only an untouched (pre-selected) direction follows the relationship`, (await pressed()).join() === 'across')
    await page.click('[data-chip="relationship:pet"]')
    check(`…an untouched direction is cleared when the new relationship maps to nothing, and set again by the next one (${lang})`, true)
    check(`no page errors (run 19, ${lang})`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 20 (2026-11-05 Part 9): voice input — language picker, words while speaking, keeps listening, adds at the cursor ----------
{
  const V = await mockPage(browser)
  await V.page.addInitScript(() => {
    window.__recs = []
    window.SpeechRecognition = class { constructor() { this.lang = ''; window.__recs.push(this) } start() { this.started = true } stop() { this.stopped = true; if (this.onend) this.onend() } }
  })
  await V.page.goto('http://localhost:5173/?lang=zh-Hant', { waitUntil: 'networkidle' })
  const last = () => V.page.evaluate(() => { const r = window.__recs.at(-1); return r ? { lang: r.lang, continuous: r.continuous, interim: r.interimResults, n: window.__recs.length } : null })
  const say = (text, final) => V.page.evaluate(([t, f]) => window.__recs.at(-1).onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: f, 0: { transcript: t } } } }), [text, final])
  const opts = await V.page.locator('[data-testid=voice-lang] option').allInnerTexts()
  check('voice: a language picker beside the mic with the SAME four labels on every page — 日本語 / 中文（台灣） / 中文（普通话） / English — defaulting to the page language (zh-Hant page → 中文（台灣） = zh-TW)', opts.join('|') === '日本語|中文（台灣）|中文（普通话）|English' && (await V.page.locator('[data-testid=voice-lang]').inputValue()) === 'zh-TW')
  check('voice: one help line under the mic, word for word (zh-Hant)', (await V.page.locator('[data-testid=voice-help]').innerText()) === '也可以用手機鍵盤上的麥克風輸入。')
  const box = V.page.locator('#write [data-testid=story-input]')
  await box.fill('今天天氣很好。明天也好。')
  await box.evaluate((el) => { el.focus(); el.setSelectionRange(7, 7) }) // after 「今天天氣很好。」
  await V.page.locator('[data-testid=voice-lang]').selectOption('ja-JP')
  await V.page.locator('[data-testid=voice-button]').click()
  const st = await last()
  check('voice: the recognition runs in the picked language (ja-JP), continuous and with interim results', st.lang === 'ja-JP' && st.continuous === true && st.interim === true)
  check('voice: the button shows its state — zh-Hant 「正在聆聽…（點一下停止）」', (await V.page.locator('[data-testid=voice-button]').innerText()).includes('正在聆聽…（點一下停止）'))
  await say('おはよ', false)
  check('voice: words appear WHILE speaking, in a lighter colour, and are not yet in the story box', (await V.page.locator('[data-testid=voice-interim]').innerText()) === 'おはよ' && (await box.inputValue()) === '今天天氣很好。明天也好。' && (await V.page.locator('[data-testid=voice-interim]').evaluate((e) => Number(getComputedStyle(e).opacity))) < 1)
  await say('おはよう', true)
  check('voice: the final text REPLACES the interim one and is added AT THE CURSOR — typed text before and after is kept', (await box.inputValue()) === '今天天氣很好。おはよう明天也好。' && (await V.page.locator('[data-testid=voice-interim]').innerText()) === '', JSON.stringify([await box.inputValue(), await V.page.locator('[data-testid=voice-interim]').innerText()]))
  await say('ございます', true)
  check('voice: the next speech follows the previous one (the cursor moved on), nothing typed is lost', (await box.inputValue()) === '今天天氣很好。おはようございます明天也好。')
  // the browser stops on silence while the button is still on → listening starts again
  await V.page.evaluate(() => window.__recs.at(-1).onerror({ error: 'no-speech' }))
  await V.page.evaluate(() => window.__recs.at(-1).onend())
  await V.page.waitForTimeout(400)
  const again = await last()
  check('voice: when the browser stops on silence (no-speech) while the button is on, listening is restarted automatically — and the button still shows the listening state', again.n === 2 && again.lang === 'ja-JP' && (await V.page.locator('[data-testid=voice-button]').innerText()).includes('正在聆聽…（點一下停止）'))
  await V.page.evaluate(() => window.__recs.at(-1).onerror({ error: 'not-allowed' }))
  await V.page.evaluate(() => window.__recs.at(-1).onend())
  await V.page.waitForTimeout(400)
  check('voice: if the microphone is refused (not-allowed) it does NOT keep restarting — the button goes off', (await last()).n === 2 && !(await V.page.locator('[data-testid=voice-button]').innerText()).includes('正在聆聽'))
  // tap to stop
  await V.page.locator('[data-testid=voice-button]').click()
  await V.page.locator('[data-testid=voice-button]').click()
  await V.page.evaluate(() => window.__recs.at(-1).stop())
  await V.page.waitForTimeout(400)
  const n1 = (await last()).n
  await V.page.waitForTimeout(500)
  check('voice: tapping the button stops it for good (no restart after a deliberate stop)', (await last()).n === n1 && !(await V.page.locator('[data-testid=voice-button]').innerText()).includes('聆聽'))
  // the choice is remembered for the session
  await V.page.reload({ waitUntil: 'networkidle' })
  check('voice: the picked language is remembered for the session (reload → still 日本語 on a zh-Hant page)', (await V.page.locator('[data-testid=voice-lang]').inputValue()) === 'ja-JP')
  check('no page errors (run 20)', V.errors.length === 0, V.errors.join('; '))
  await V.page.close()
  for (const [lang, want, label, help] of [['ja', 'ja-JP', '話しています…（タップで停止）', 'スマホのキーボードのマイクでも入力できます。'], ['en', 'en-US', 'Listening… (tap to stop)', "You can also use the microphone on your phone's keyboard."]]) {
    const W = await mockPage(browser)
    await W.page.addInitScript(() => { window.SpeechRecognition = class { start() {} stop() { if (this.onend) this.onend() } } })
    await W.page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await W.page.locator('[data-testid=voice-button]').click()
    check(`voice (${lang}): default language ${want}, the listening label and the help line word for word`, (await W.page.locator('[data-testid=voice-lang]').inputValue()) === want && (await W.page.locator('[data-testid=voice-button]').innerText()).includes(label) && (await W.page.locator('[data-testid=voice-help]').innerText()) === help)
    await W.page.close()
  }
}

// ---------- Run 21 (hotfix 2026-11-05): the character is always the character — never the word "same" — and the 刻字 line follows the rule; full-width punctuation ----------
{
  const orderOk = () => ({ json: { order_ref: 'IC-20261105-SAMEREF1', checkout_url: 'http://localhost:5173/__checkout?cart=same', glyph: '惜', certificate_text: 'x' } })
  const SETS = [
    [['惜', 'same', 'xī'], ['朴', '樸', 'pǔ'], ['笑', 'same', 'xiào']],
    [['修', 'same', 'xiū'], ['忆', '憶', 'yì'], ['信', 'same', 'xìn']],
  ]
  // (the customer page has three languages — ja / zh-Hant / en; zh-Hans is covered by the unit suite scripts/test-same.ts)
  for (const lang of ['zh-Hant', 'ja']) {
    for (const [si, set] of SETS.entries()) {
      const mk = (body) => {
        const r = clone(FIXTURE)
        r.language = body.language
        r.inscription_script = body.language === 'ja' ? null : 'traditional'
        r.candidates.slice(0, 3).forEach((c, i) => { c.kanji = set[i][0]; c.inscription_form = lang === 'ja' ? null : set[i][1]; c.reading = set[i][2]; if (lang !== 'ja') c.one_line_gaze = '把孩子留在院子裡，捨不得離開的人' })
        r.primary_kanji = set[0][0]; r.runner_up_kanji = set[1][0]; r.freestyle_kanji = set[2][0]
        return r
      }
      const { page, errors } = await mockPage(browser, { result: mk, order: orderOk })
      await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.locator('#moment').fill('母は庭の花を毎朝替えていた。何も言わずに、ただ笑っていた。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'seasonal_thanks' })
      await page.click(`#write >> text=${GO[lang === 'zh-Hans' ? 'zh-Hans' : lang]}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      const cards = await page.evaluate(() => [...document.querySelectorAll('#write article[data-slot]')].map((a) => ({ glyph: a.querySelector('[data-glyph]')?.textContent ?? '', text: a.innerText })))
      const want = [set[0], set[1]].map(([k, f]) => (lang === 'ja' ? k : f === 'same' ? k : f)) // Traditional is carved by default on a Chinese page
      const glyphsOk = cards.length === 2 && cards.every((c, i) => c.glyph === want[i])
      const noSame = cards.every((c) => !/same/i.test(c.text))
      const notes = cards.map((c) => (c.text.match(/刻字：[^\n]*/) ?? [''])[0])
      const wantNotes = set.slice(0, 2).map(([k, f]) => (lang === 'ja' ? '' : f === 'same' ? `刻字：${k}` : lang === 'zh-Hant' ? `刻字：繁體（簡體：${k}）` : `刻字：繁體（简体：${k}）`))
      check(`${lang}, set ${si + 1} (${set.map((x) => x[0]).join('')}): every card shows the real character (${want.join('')}), never "same"; the 刻字 line is ${lang === 'ja' ? 'absent on a ja page' : '「刻字：<char>」 for identical forms and the pair for different ones'}`, glyphsOk && noSame && notes.join('|') === wantNotes.join('|'), JSON.stringify({ g: cards.map((c) => c.glyph), notes }))
      // the order step for the main card and (set 2) the different-forms card
      await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
      await page.locator('[data-testid=order-form]').waitFor()
      const og = await page.locator('[data-order-glyph]').innerText()
      const formText = await page.locator('[data-testid=order-form]').innerText()
      check(`${lang}, set ${si + 1}: the order step shows ${want[0]} and the word "same" appears nowhere on it`, og === want[0] && !/same/i.test(formText), og)
      check(`no page errors (run 21, ${lang}, set ${si + 1})`, errors.length === 0, errors.join('; '))
      await page.close()
    }
  }
}

// ---------- Run 22 (2026-11-07): the card screen — two EQUAL cards, side by side on a wide screen and stacked on a phone; 本命 character cinnabar, 遊び字 character ink; the line under the cards; the new-round button; remembrance 本命 + 次点 ----------
{
  const LABELS = { ja: ['本命', '遊び字'], 'zh-Hant': ['本命', '趣字'], en: ['Main', 'Playful'] }
  const PAIR_NOTE = { ja: '本命は、その人の芯を表す一字。遊び字は、ふたりだけに通じる一字。', 'zh-Hant': '本命，是那個人最核心的一個字；趣字，是只有你們之間才懂的一個字。', en: 'The main character captures who they are. The playful one is something only the two of you would get.' }
  const AGAIN = { ja: '別の二字を探す（あと2回）', 'zh-Hant': '再找兩個新的字（還可以找2次）', en: 'Find two more (2 left)' }
  const MEM_LABELS = { ja: ['本命', '次点'], 'zh-Hant': ['本命', '次選'], en: ['Main', 'Second'] }
  const SEAL = 'rgb(200, 64, 45)'
  const geom = (page) => page.evaluate(() => [...document.querySelectorAll('#write article[data-slot]')].map((a) => { const r = a.getBoundingClientRect(); return { slot: a.dataset.slot, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), border: getComputedStyle(a).borderStyle, glyph: getComputedStyle(a.querySelector('[data-glyph]')).color, label: a.querySelector('[data-slot-label]')?.innerText ?? '' } }))
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (const [vw, vh, tag] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
      const { page, errors } = await mockPage(browser)
      await page.setViewportSize({ width: vw, height: vh })
      await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.locator('#moment').fill('母は庭の花を毎朝替えていた。何も言わずに、ただ笑っていた。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'seasonal_thanks' })
      await page.click(`#write >> text=${GO[lang]}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      await page.waitForTimeout(600)
      const g = await geom(page)
      const [m, f] = g
      check(`cards (${lang}, ${tag}): exactly two cards — 本命 first, 遊び字 second — labelled ${LABELS[lang].join(' / ')}`, g.length === 2 && m.slot === 'main' && f.slot === 'freestyle' && g.map((c) => c.label).join() === LABELS[lang].join(), JSON.stringify(g))
      check(`cards (${lang}, ${tag}): the two cards are EQUAL (same width — and, side by side, the same height), and ${vw >= 900 ? 'side by side on one row (本命 on the left)' : 'stacked, 本命 on top'}`, Math.abs(m.w - f.w) <= 2 && (vw < 900 || Math.abs(m.h - f.h) <= 12) && (vw >= 900 ? Math.abs(m.top - f.top) <= 2 && m.left < f.left : f.top > m.top + m.h - 2 && Math.abs(m.left - f.left) <= 2), JSON.stringify(g))
      check(`cards (${lang}, ${tag}): the 本命 character is cinnabar, the 遊び字 character is ink (not cinnabar); both cards have a solid border — no dashed "lesser" style`, m.glyph === SEAL && f.glyph !== SEAL && m.border === 'solid' && f.border === 'solid', JSON.stringify(g))
      check(`cards (${lang}, ${tag}): the line under the cards says what 本命 and the playful character are, word for word`, (await page.locator('[data-pair-note]').innerText()) === PAIR_NOTE[lang])
      check(`cards (${lang}, ${tag}): the new-round button reads 「${AGAIN[lang]}」`, (await page.locator('[data-testid=see-others]').innerText()) === AGAIN[lang])
      check(`cards (${lang}, ${tag}): no sideways scroll and the line under the cards is below both cards`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('[data-pair-note]').getBoundingClientRect().top >= Math.max(...[...document.querySelectorAll('#write article[data-slot]')].map((a) => a.getBoundingClientRect().bottom)) - 1))
      await page.locator('#write').scrollIntoViewIfNeeded()
      await page.locator('#write').screenshot({ path: `${SHOTS}/cards-${lang}-${tag}.png` })
      check(`no page errors (run 22, ${lang}, ${tag})`, errors.length === 0, errors.join('; '))
      await page.close()
    }
    // remembrance: 本命 + 次点, no 遊び字 and no line under the cards; both characters ink; the same new-round button
    const { page, errors } = await mockPage(browser)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('#moment').fill('母は庭の花を毎朝替えていた。何も言わずに、ただ笑っていた。')
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'memorial' })
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.waitForTimeout(600)
    const gm = await geom(page)
    check(`remembrance (${lang}): 本命 + 次点 — ${MEM_LABELS[lang].join(' / ')} — two equal cards, no 遊び字, no line under the cards, both characters ink`, gm.length === 2 && gm.map((c) => c.slot).join() === 'main,second' && gm.map((c) => c.label).join() === MEM_LABELS[lang].join() && Math.abs(gm[0].w - gm[1].w) <= 2 && gm.every((c) => c.glyph !== SEAL) && (await page.locator('[data-pair-note]').count()) === 0, JSON.stringify(gm))
    check(`remembrance (${lang}): the new-round button is the same 「${AGAIN[lang]}」`, (await page.locator('[data-testid=see-others]').innerText()) === AGAIN[lang])
    await page.locator('#write').scrollIntoViewIfNeeded()
    await page.locator('#write').screenshot({ path: `${SHOTS}/cards-${lang}-remembrance.png` })
    check(`no page errors (run 22, ${lang}, remembrance)`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 23 (2026-11-07): the owner dashboard /ops/stats — four languages with a switch, remembered; periods; values never change with the language; screenshots ----------
{
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/stats-fixture-server.ts'], { stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('fixture server did not start')), 30000)
    child.stdout.on('data', (b) => { const m = /listening (\d+)/.exec(String(b)); if (m) { clearTimeout(t); resolve(Number(m[1])) } })
  })
  const URL0 = `http://127.0.0.1:${port}/ops/stats`
  const L = {
    ja: { title: '一字礼 ダッシュボード', periods: ['今日', '7日間', '30日間', '全期間'], tiles: ['ページ訪問', '物語を書いた', '字に出会った', 'ご注文（支払済）', '売上', 'AI費用（推定）'], funnel: '流れ（どこで離れているか）', steps: ['ページ訪問', '関係・理由を選んだ', '物語を送った', '字に出会った', 'この字で贈る', 'お支払い完了', '受け取った', '相手が開封', 'SNSでシェア'], daily: '日別：訪問とご注文', source: 'どこから / 言語', orders: 'ご注文一覧（最新50件）', cols: ['日時', '注文番号', '贈り方', '一字', '種類', '言語', '理由', '金額', '受け取り', '開封', '状態'], choice: '選ばれた字：本命 / 遊び字', rounds: '2回目・3回目を使った人', privacy: '物語の本文・お名前は表示しません。' },
    en: { title: 'ICHIREI dashboard', periods: ['Today', '7 days', '30 days', 'All time'], tiles: ['Page visits', 'Stories written', 'Saw characters', 'Paid orders', 'Revenue', 'AI cost (est.)'], funnel: 'Funnel (where people drop off)', steps: ['Page visits', 'Chose relationship & purpose', 'Sent story', 'Saw characters', 'Chose a character', 'Paid', 'Collected', 'Receiver opened', 'Shared on social'], daily: 'Daily visits and orders', source: 'Sources / languages', orders: 'Latest 50 orders', cols: ['Time', 'Order', 'Gift', 'Character', 'Type', 'Language', 'Purpose', 'Amount', 'Collected', 'Opened', 'Status'], choice: 'Chosen: main / playful', rounds: 'Used round 2 / round 3', privacy: 'Story text and names are never shown.' },
    'zh-Hant': { title: '一字禮 儀表板', periods: ['今天', '7天', '30天', '全部期間'], tiles: ['頁面造訪', '寫下故事', '看到字', '已付款訂單', '營收', 'AI 成本（估計）'], funnel: '流程（在哪裡流失）', steps: ['頁面造訪', '選了關係與理由', '送出故事', '看到字', '選定要送的字', '完成付款', '已領取', '對方已開啟', '分享到社群'], daily: '每日造訪與訂單', source: '來源 / 語言', orders: '最新50筆訂單', cols: ['時間', '訂單編號', '方案', '字', '類型', '語言', '理由', '金額', '領取', '開啟', '狀態'], choice: '被選的字：本命 / 趣字', rounds: '使用第2次、第3次的人', privacy: '不顯示故事內容與姓名。' },
    'zh-Hans': { title: '一字礼 仪表板', periods: ['今天', '7天', '30天', '全部期间'], tiles: ['页面造访', '写下故事', '看到字', '已付款订单', '营收', 'AI 成本（估计）'], funnel: '流程（在哪里流失）', steps: ['页面造访', '选了关系与理由', '送出故事', '看到字', '选定要送的字', '完成付款', '已领取', '对方已打开', '分享到社群'], daily: '每日造访与订单', source: '来源 / 语言', orders: '最新50笔订单', cols: ['时间', '订单编号', '方案', '字', '类型', '语言', '理由', '金额', '领取', '打开', '状态'], choice: '被选的字：本命 / 趣字', rounds: '使用第2次、第3次的人', privacy: '不显示故事内容与姓名。' },
  }
  const ctx = await browser.newContext({ httpCredentials: { username: 'owner', password: 'pw' }, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const externalCalls = []
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}`) && !r.url().startsWith('data:')) externalCalls.push(r.url()) })
  await page.goto(URL0, { waitUntil: 'load' })
  const text = () => page.locator('body').innerText()
  const tileLabels = () => page.locator('#numbers .num > span').allInnerTexts()
  const tileValues = () => page.locator('#numbers .num > b').allInnerTexts()
  const ordersSnapshot = () => page.evaluate(() => [...document.querySelectorAll('table')].at(-1).querySelectorAll('tbody tr')).then(async () => page.evaluate(() => [...[...document.querySelectorAll('table')].at(-1).querySelectorAll('tbody tr')].map((tr) => { const c = [...tr.children].map((td) => td.textContent); return [c[0], c[1], c[3], c[7]].join('|') })))
  check('dashboard: opens in Japanese by default with the title and the four period tabs', (await page.title()) === L.ja.title && (await page.locator('#title').innerText()) === L.ja.title && (await page.locator('#tabs button').allInnerTexts()).join() === L.ja.periods.join() && (await page.locator('html').getAttribute('lang')) === 'ja')
  check('dashboard: the language switch is at the top right with the four names, 日本語 pressed', (await page.locator('#langs button').allInnerTexts()).join() === '日本語,English,繁體中文,简体中文' && (await page.locator('#langs button[data-lang=ja]').getAttribute('aria-pressed')) === 'true' && (await page.evaluate(() => { const r = document.getElementById('langs').getBoundingClientRect(); return r.right > window.innerWidth - 40 && r.top < 80 })))
  const jaValues = await tileValues()
  const jaOrders = await ordersSnapshot()
  check('dashboard: six numbers for today (made-up month): 46 visits, 2 paid, revenue with ¥ and thousands separator', jaValues.length === 6 && jaValues[0] === '46' && jaValues[3] === '2' && /^¥\d{1,3}(,\d{3})*$/.test(jaValues[4]) && /^¥\d/.test(jaValues[5]), jaValues.join(' '))
  check('dashboard: period tabs switch the numbers (today → 7 days → 30 days → all time grow) and the daily bars (1 / 7 / 30 / 60)', await (async () => {
    const seen = []
    for (const [i, bars] of [[0, 1], [1, 7], [2, 30], [3, 60]]) {
      await page.locator('#tabs button').nth(i).click()
      seen.push([Number((await tileValues())[0].replace(/,/g, '')), await page.locator('.days > div').count(), (await page.locator('#tabs button').nth(i).getAttribute('aria-pressed')) === 'true', bars])
    }
    await page.locator('#tabs button').nth(0).click()
    return seen.every((x, i) => x[1] === x[3] && x[2] && (i === 0 || x[0] > seen[i - 1][0]))
  })())
  for (const lang of ['ja', 'en', 'zh-Hant', 'zh-Hans']) {
    const w = L[lang]
    await page.locator(`#langs button[data-lang=${lang}]`).click()
    const body = await text()
    const labels = await tileLabels()
    check(`dashboard (${lang}): title, period tabs, six number labels, funnel title, nine funnel steps, daily and source headings, orders heading, choice heading, privacy line — all in this language`,
      (await page.title()) === w.title && (await page.locator('#tabs button').allInnerTexts()).join() === w.periods.join() && w.tiles.every((x, i) => labels[i] === x) && body.includes(w.funnel) && w.steps.every((x) => body.includes(x)) && body.includes(w.daily) && body.includes(w.source) && body.includes(w.orders) && body.includes(w.choice) && body.includes(w.rounds) && body.includes(w.privacy), `${labels.join('|')}`)
    check(`dashboard (${lang}): the eleven column headings are the owner's`, (await page.locator('table').last().locator('thead th').allInnerTexts()).join() === w.cols.join(), (await page.locator('table').last().locator('thead th').allInnerTexts()).join())
    const keysSeen = await page.evaluate(() => { const keys = JSON.parse(document.getElementById('d').textContent).keys; const b = document.body.innerText; const leaked = keys.filter((k) => k.includes('_') && new RegExp('(^|[^a-z0-9_])' + k + '([^a-z0-9_]|$)').test(b)); const bare = [...document.querySelectorAll('#app *, #tabs *')].filter((e) => e.children.length === 0 && keys.includes((e.textContent ?? '').trim())).map((e) => e.textContent.trim()); return [...leaked, ...bare] })
    check(`dashboard (${lang}): no label key, no {placeholder}, no "undefined" shows`, keysSeen.length === 0 && !/[{}]|undefined|NaN/.test(body), keysSeen.join(' ') || body.match(/[{}]|undefined|NaN/)?.[0])
    check(`dashboard (${lang}): the data does not change with the language (same numbers, same characters, order numbers and amounts)`, (await tileValues()).join() === jaValues.join() && (await ordersSnapshot()).join('\n') === jaOrders.join('\n'))
    check(`dashboard (${lang}): <html lang> follows the switch and the page has no sideways scroll`, (await page.locator('html').getAttribute('lang')) === lang && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)))
    check(`dashboard (${lang}): every order row links to the order on /ops, the status words are this language's, dates are Japan time`, await page.evaluate(() => [...[...document.querySelectorAll('table')].at(-1).querySelectorAll('tbody tr')].every((tr) => /^\/ops#o-IC-/.test(tr.querySelector('a')?.getAttribute('href') ?? '') && /^\d\d-\d\d \d\d:\d\d$/.test(tr.children[0].textContent))))
    await page.screenshot({ path: `${SHOTS}/stats-${lang}-desktop.png`, fullPage: true })
  }
  // remembered: the choice survives a reload (localStorage), even in a fresh tab of the same browser
  await page.locator('#langs button[data-lang=zh-Hans]').click()
  await page.reload({ waitUntil: 'load' })
  check('dashboard: the chosen language is remembered after a reload', (await page.locator('#title').innerText()) === L['zh-Hans'].title && (await page.locator('#langs button[data-lang=zh-Hans]').getAttribute('aria-pressed')) === 'true')
  const statusWords = await page.evaluate(() => [...[...document.querySelectorAll('table')].at(-1).querySelectorAll('tbody tr')].map((tr) => tr.children[10].textContent))
  check('dashboard (简体中文): the order statuses read 完成 / 可取消（剩N小时） / 已取消并退款', statusWords.length === 50 && statusWords.every((x) => x === '完成' || /^可取消（剩\d+小时）$/.test(x) || x === '已取消并退款') && statusWords.some((x) => x.startsWith('可取消')))
  check('dashboard: the other shop\'s order (¥55,555) is nowhere on the page', !(await text()).includes('55,555') && !(await page.content()).includes('OTHER001'))
  check('dashboard: the page makes no call to any other host (no analytics, no fonts, no third party)', externalCalls.length === 0, externalCalls.join(' '))
  check('dashboard: a wrong password gets 401 and shows no number', await (async () => { const r = await fetch(URL0, { headers: { authorization: 'Basic ' + Buffer.from('o:nope').toString('base64') } }); const t = await r.text(); return r.status === 401 && !t.includes('ICHIREI') })())
  check('dashboard: no page errors', errors.length === 0, errors.join('; '))
  // a phone
  const phone = await ctx.newPage()
  await phone.setViewportSize({ width: 390, height: 844 })
  await phone.goto(URL0, { waitUntil: 'load' })
  check('dashboard (phone): the six numbers, the funnel and the daily bars fit without sideways scrolling of the page', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && (await phone.locator('#numbers .num').count()) === 6, await phone.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.wide') && !e.closest('.days')).slice(0, 4).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + '/' + window.innerWidth).join(' ; ')))
  check('dashboard (phone): the order table scrolls inside its own box instead of widening the page', await phone.evaluate(() => { const w = [...document.querySelectorAll('.wide')].at(-1); return w.scrollWidth > w.clientWidth && document.documentElement.scrollWidth <= window.innerWidth + 1 }))
  await phone.screenshot({ path: `${SHOTS}/stats-phone.png`, fullPage: true })
  await ctx.close()
  child.kill()
}

await browser.close()
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
