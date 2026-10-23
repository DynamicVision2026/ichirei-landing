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
  await page.selectOption('select[name=relationship]', c.relationship)
  await page.selectOption('select[name=direction]', c.direction)
  await page.selectOption('select[name=occasion]', c.occasion)
}
const COPY_TRY = { ja: 'もう一度試す', 'zh-Hans': '再试一次', 'zh-Hant': '再試一次' }
const FINALIZE = { ja: 'この一字を、贈る', 'zh-Hans': '就用这一个字', 'zh-Hant': '就用這一個字' }
const SUBMIT = { ja: 'その一字を、探しにいく', 'zh-Hans': '去寻找那一个字', 'zh-Hant': '去尋找那一個字' }

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
  await pickContext(page)
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
  await page.click('text=この一字を、贈る')
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
  await page.locator('textarea').first().fill(storyBefore + '\nそして、いつも黙って頷いた。')
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/log', (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
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
const mockPage = async (browser, { onExplain, result } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = { select: [], explain: [] }
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
  check('selectors: language pills (ja / zh-Hans / zh-Hant), 3 selects and the occasion_detail field are present',
    (await page.locator('[data-language]').count()) === 3 &&
    (await page.locator('select[name=relationship] option').count()) === 14 &&
    (await page.locator('select[name=direction] option').count()) === 4 &&
    (await page.locator('select[name=occasion] option').count()) === 8 &&
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
  check('golden fixture button also sets the golden context (ja / 父 / 目上 / 誕生日・節目 / 還暦)',
    (await page.inputValue('select[name=relationship]')) === 'parent_father' && (await page.inputValue('select[name=direction]')) === 'up' && (await page.inputValue('select[name=occasion]')) === 'birthday_milestone' && (await page.inputValue('input[name=occasion_detail]')) === '還暦')
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
    r.candidates[1] = { ...r.candidates[1], kanji: '默', inscription_form: null, reading: 'mò' }
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

// ---------- Run 8: no eligible primary → a clear message ----------
{
  const noPrimary = (alive) => () => {
    const r = clone(FIXTURE)
    r.primary_kanji = null
    r.runner_up_kanji = null
    r.candidates = r.candidates.map((c, i) => (i < alive ? { ...c, eliminated: false, eliminated_reason: null } : { ...c, eliminated: true, eliminated_reason: 'palette: hard_block' }))
    r.referee = { palette_rows: 649, original_primary: '迎', primary_changed: true, no_eligible_primary: true, promoted_from: null, actions: [{ kanji: '送', action: 'hard_block_eliminated', detail: 'palette: hard_block' }] }
    return r
  }
  for (const [lang, expect] of [['ja', '「この一字」と呼べる字が、まだ残っていません。'], ['zh-Hans', '目前没有可以称为“这一个字”的字了。'], ['zh-Hant', '目前沒有可以稱為「這一個字」的字了。']]) {
    const { page, errors } = await mockPage(browser, { result: noPrimary(0) })
    await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
    await page.click(`[data-language=${lang}]`)
    await page.locator('textarea').first().fill(STORY)
    await pickContext(page)
    await page.click(`text=${SUBMIT[lang]}`)
    await page.waitForSelector('[data-testid=no-primary]', { timeout: 8000 })
    const box = page.locator('[data-testid=no-primary]')
    check(`no primary (${lang}): a clear message is shown`, await box.locator(`text=${expect}`).isVisible())
    check(`no primary (${lang}): the removed characters are listed with the reason`, await box.locator('text=palette: hard_block').count() >= 1)
    check(`no primary (${lang}): no candidate card and no finalize button when nothing survived`, (await page.locator('article').count()) === 0 && (await page.locator('button:has-text("贈る")').count()) === 0)
    const retry = COPY_TRY[lang]
    check(`no primary (${lang}): the try-again button keeps the story`, await page.locator(`button:has-text("${retry}")`).isVisible())
    if (lang === 'ja') {
      await page.screenshot({ path: `${SHOTS}/e2e-v5-no-primary.png` })
      await page.click(`button:has-text("${retry}")`)
      check('no primary: try again returns to the input with the story kept', (await page.locator('textarea').first().inputValue()) === STORY)
    }
    check(`no page errors (run 8, ${lang})`, errors.length === 0)
    await page.close()
  }
  // some candidates survive but none may be primary → message + the survivors are still shown
  const { page, errors } = await mockPage(browser, { result: noPrimary(2) })
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
  await page.click(`text=${SUBMIT.ja}`)
  await page.waitForSelector('[data-testid=no-primary]', { timeout: 8000 })
  await page.waitForSelector('article', { timeout: 8000 })
  check('no primary with survivors: the message AND the surviving cards are shown (none is cinnabar-marked primary)', (await page.locator('[data-testid=no-primary]').isVisible()) && (await page.locator('article').count()) >= 1 && (await page.locator('article.ring-cinnabar\\/60').count()) === 0)
  check('no page errors (run 8, survivors)', errors.length === 0)
  await page.close()
}

// ---------- Run 9: landing page v5 (ja) — neutral copy, exact brief lines, delivery logic ----------
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/**', (route) => route.fulfill({ status: 204, body: '' }))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  const text = () => page.evaluate(() => document.body.innerText)
  check('landing ja: <html lang> is ja and the tab title is neutral', (await page.getAttribute('html', 'lang')) === 'ja' && (await page.title()) === 'ICHIREI 一字礼 — 一字の贈りもの')
  check('landing ja: hero title 「一字の贈りもの」, subtitle 「あなたの目に映る、その人を、一文字に。」', (await page.locator('h1').innerText()) === '一字の贈りもの' && (await page.locator('text=あなたの目に映る、その人を、一文字に。').count()) === 1)
  check('landing ja: the thesis line is on the page, verbatim', (await page.locator('[data-thesis]').innerText()) === '想いは、言葉にできなくてもいい。一文字が、あなたの見つめ方を映す。')
  check('landing ja: marquee reads 一字礼 · ICHIREI · 一字の贈りもの', (await page.getAttribute('section[aria-label]', 'aria-label')) === '一字礼 ICHIREI 一字の贈りもの' && (await page.locator('.marquee-track').first().innerText()).includes('一字礼 ・ ICHIREI ・ 一字の贈りもの'))
  const t = await text()
  check('landing ja: no 還暦 / 六十年 / 誕生日 anywhere on the page', !/還暦|六十|60歳|誕生日/.test(t), t.slice(0, 200))
  check('landing ja: the AI is invisible (no "AI" in any visible text)', !/\bAI\b|人工知能|アルゴリズム/.test(t))
  check('landing ja: process steps are neutral and the SENDER chooses', t.includes('言葉を、深く読む') && t.includes('あなたが選ぶ') && t.includes('一字が、贈りものになる') && !t.includes('還暦の記念'))
  const today = new Date()
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 4)
  const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
  await page.fill('input[type=date]', iso)
  check('landing ja: delivery notice reads 「お届け希望日まで4日です…」 (not 還暦まで)', await page.locator('text=お届け希望日まで4日です。特急仕上げ（3営業日）もご用意しています。').isVisible() && (await page.locator('text=お届け希望日').count()) >= 1)
  check('landing ja: the date field is labelled お届け希望日', (await page.locator('label:has-text("お届け希望日")').count()) === 1)
  await page.locator('#confirmation').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1600)
  check('landing ja: confirmation CTA 「この一字を、贈る」 and the certificate line', (await page.locator('button:has-text("この一字を、贈る")').count()) === 1 && (await page.locator('[data-certificate]').innerText()) === 'この字は、〇〇様の目に映る、あなたです。')
  check('landing ja: the sample glyph is carved in the old form, paired with the modern form and reading', (await page.locator('#confirmation .text-cinnabar').first().innerText()) === '燈' && (await page.locator('#confirmation').innerText()).includes('灯 ・ あかり'))
  check('landing ja: primary-only cinnabar — exactly one cinnabar candidate card in the showcase', (await page.locator('#candidate-showcase article.ring-cinnabar\\/60').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/e2e-landing-ja-confirmation.png` })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(4800)
  await page.screenshot({ path: `${SHOTS}/e2e-landing-ja-hero.png` })
  check('no page errors (run 9)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
}

// ---------- Run 10: three languages on the landing page, remembered, shared with /demo ----------
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/api/**', (route) => route.fulfill({ status: 204, body: '' }))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  check('landing: three language buttons in the nav, ja pressed by default', (await page.locator('nav [data-language]').count()) === 3 && (await page.locator('nav [data-language=ja][aria-pressed=true]').count()) === 1)
  await page.click('nav [data-language=zh-Hans]')
  check('zh-Hans: <html lang>, title, hero, thesis, brand', (await page.getAttribute('html', 'lang')) === 'zh-Hans' && (await page.title()) === 'ICHIREI 一字礼 — 一个字的礼物' && (await page.locator('h1').innerText()) === '一个字的礼物' && (await page.locator('[data-thesis]').innerText()) === '心意，不必说出口也可以。一个字，映出你看着对方的方式。')
  const hans = await page.evaluate(() => document.body.innerText)
  check('zh-Hans: no Japanese kana, no 还历/六十, no AI on the page (the 日本語 switch aside)', !/[ぁ-んァ-ヶ]/.test(hans.replace('日本語', '')) && !/还历|六十|\bAI\b/.test(hans))
  check('zh-Hans: marquee, steps, delivery label and CTA are Chinese', hans.includes('一字礼 ・ ICHIREI ・ 一个字的礼物') && hans.includes('由你来选') && hans.includes('期望送达日') && hans.includes('去寻找那一个字'))
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily)
  check('zh-Hans: the serif stack switches to Noto Serif SC (Chinese glyph shapes)', font.includes('Noto Serif SC'), font)
  await page.click('nav [data-language=zh-Hant]')
  check('zh-Hant: <html lang>, title, hero and brand (一字禮)', (await page.getAttribute('html', 'lang')) === 'zh-Hant' && (await page.title()) === 'ICHIREI 一字禮 — 一個字的禮物' && (await page.locator('h1').innerText()) === '一個字的禮物' && (await page.evaluate(() => document.body.innerText)).includes('一字禮 ・ ICHIREI ・ 一個字的禮物'))
  check('zh-Hant: the serif stack switches to Noto Serif TC', (await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily)).includes('Noto Serif TC'))
  await page.locator('#confirmation').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1600)
  check('zh-Hant: confirmation CTA, certificate line and the carved 燈 with 灯 ・ dēng', (await page.locator('#confirmation button:has-text("就用這一個字")').count()) === 1 && (await page.locator('[data-certificate]').innerText()) === '這個字，是〇〇眼中的你。' && (await page.locator('#confirmation').innerText()).includes('灯 ・ dēng'))
  await page.screenshot({ path: `${SHOTS}/e2e-landing-zh-hant-confirmation.png` })
  // remembered across a reload, and shared with /demo
  await page.reload({ waitUntil: 'networkidle' })
  check('the choice is remembered across a reload', (await page.getAttribute('html', 'lang')) === 'zh-Hant' && (await page.locator('h1').innerText()) === '一個字的禮物')
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  check('/demo opens in the language chosen on the landing page', (await page.locator('[data-language=zh-Hant][aria-pressed=true]').count()) === 1 && (await page.locator('text=不必寫下那個人的全部').count()) === 1)
  await page.click('[data-language=zh-Hans]')
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  check('…and a change made in /demo carries back to the landing page', (await page.locator('h1').innerText()) === '一个字的礼物')
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  check('?lang=ja overrides the stored choice', (await page.locator('h1').innerText()) === '一字の贈りもの' && (await page.getAttribute('html', 'lang')) === 'ja')
  check('no page errors (run 10)', errors.length === 0)
  if (errors.length) console.log('page errors:', errors)
  await page.close()
  // browser language zh-TW with nothing stored → traditional Chinese
  const ctx = await browser.newContext({ locale: 'zh-TW', viewport: { width: 1200, height: 900 } })
  const p2 = await ctx.newPage()
  await p2.route('**/api/**', (route) => route.fulfill({ status: 204, body: '' }))
  await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  check('a zh-TW browser with no stored choice gets zh-Hant; an en-US one gets ja', (await p2.locator('h1').innerText()) === '一個字的禮物')
  await ctx.close()
  const ctx2 = await browser.newContext({ locale: 'en-US', viewport: { width: 1200, height: 900 } })
  const p3 = await ctx2.newPage()
  await p3.route('**/api/**', (route) => route.fulfill({ status: 204, body: '' }))
  await p3.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  check('en-US browser → ja (the default)', (await p3.locator('h1').innerText()) === '一字の贈りもの')
  await ctx2.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
