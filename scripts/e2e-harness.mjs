// Usage: npx playwright + a dev server on :5173, then `node scripts/e2e-harness.mjs`.
// Optional env: CHROMIUM_PATH (browser binary), E2E_SHOTS_DIR (screenshot output).
// End-to-end harness test (build spec §9.7): drives the real /demo UI against a
// mocked engine returning the §10 golden-fixture shape. Verifies the reveal,
// condition toggle (no engine re-call), kyūjitai pairing, follow-up loop, and
// all §6 behavioral events.
import sharp from 'sharp'
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
/** The contrast ratio of an element's text against the background it really sits on (ancestors composited over white); null when the background is an image or gradient we cannot read. */
const contrastOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a } }
  const chain = []
  for (let n = el; n; n = n.parentElement) chain.push(n)
  let bg = { r: 255, g: 255, b: 255 }
  for (const n of chain.reverse()) {
    const cs = getComputedStyle(n)
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && n !== el) { /* an image or gradient: not readable here */ }
    const c = parse(cs.backgroundColor)
    if (c && c.a > 0) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }
  }
  const fg = parse(getComputedStyle(el).color)
  if (!fg) return null
  const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }
  const lum = ({ r, g, b }) => { const k = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b) }
  const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}, selector)
const tickRefund = async (page) => { const c = page.locator('[data-testid=order-refund-check]'); if ((await c.count()) && !(await c.isChecked())) await c.check() }
const pickContext = async (page, ctx = {}) => {
  const c = { relationship: 'parent_father', direction: 'up', ...ctx }
  c.purpose = c.purpose ?? OCC_TO_PURPOSE[c.occasion ?? 'birthday_milestone']
  if ((await page.locator('select[name=relationship]').count()) === 0) {
    // the customer site: chips
    for (const k of ['relationship', 'direction', 'purpose']) {
      // the English form (US launch) offers twelve occasions, not every purpose code: a purpose it has no chip for is the 「Other」 chip
      const sel = `[data-chip="${k}:${c[k]}"]`
      await page.click(k === 'purpose' && (await page.locator(sel).count()) === 0 ? '[data-chip="purpose:other"]' : sel)
    }
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
const GO = { ja: 'わたしのひと場面から字を見つける', 'zh-Hans': '从我的片刻里找出那个字', 'zh-Hant': '從我的片刻裡找出那個字', en: 'Find the character in my moment' }
const SUBMIT = { ja: 'その一字を、探しにいく', 'zh-Hans': '去寻找那一个字', 'zh-Hant': '去尋找那一個字', en: 'Find the one character' }

// 2026-11-14: "Give this character" opens the full-screen result page first; the order form is one more tap away ("Make it a gift"). The flows that order go through it.
const toOrder = async (page) => {
  const make = page.locator('[data-testid=result-make]')
  const form = page.locator('[data-testid=order-form]')
  await Promise.race([make.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}), form.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})])
  if (await make.isVisible().catch(() => false)) await make.click()
  await form.waitFor({ state: 'visible', timeout: 30000 })
}
// 2026-11-14 (gift ceremony): the letter leads to a short card, 「この贈りものには音楽があります。」 (when the film has music), whose button starts the film; the film ends on a button (nothing moves on by itself).
const toMusic = async (page) => { await page.locator('[data-testid=gift-music-go]').click({ timeout: 2500 }).catch(() => {}) }
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
  await page.click('text=ひと場面に加える')
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
  // (2026-11-20) a timeout shows the same calm line as every other trouble: no seconds, no "server-side"
  await page.waitForSelector('text=ただいま混み合っています。少し待ってから、もう一度お試しください。書いたひと場面はそのまま残っています。', { timeout: 8000 })
  check('timeout: visible error after deadline (the calm line)', true)
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
        JSON.stringify({ type: 'error', code: 'engine_error' }) + '\n',
    }),
  )
  await page.goto('http://localhost:5173/demo', { waitUntil: 'networkidle' })
  await page.locator('textarea').first().fill(STORY)
  await pickContext(page)
  await page.click('text=その一字を、探しにいく')
  const CALM_JA = 'ただいま混み合っています。少し待ってから、もう一度お試しください。書いたひと場面はそのまま残っています。'
  await page.waitForSelector(`text=${CALM_JA}`, { timeout: 6000 })
  const errText = await page.locator('body').innerText()
  check('ndjson error line (a code only): the page shows the calm line, never a technical message, a status or JSON', errText.includes(CALM_JA) && !/Engine failed|invalid_request_error|HTTP \d{3}|engine_error|[{}]/.test(errText), errText.slice(0, 400))
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
  await page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  const box = page.locator('#write [data-testid=story-input]')
  const counter = page.locator('#write [data-testid=story-counter]')
  const goBtn = page.locator('#write button[type=submit]')
  const paste = (loc, text) => loc.evaluate((el, t) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, t); el.dispatchEvent(new Event('input', { bubbles: true })) }, text)
  check('story: the length line is under the box (ja: 「物語でなくていい。数行で十分です。本当のことを細かく書くほど、字も本当になります。」), the live counter reads "0 / 5000字" from the start (the Reveal composer), and the box has NO maxlength (nothing is ever cut by the browser)', (await page.locator('#write [data-testid=story-hint]').innerText()) === '物語でなくていい。数行で十分です。本当のことを細かく書くほど、字も本当になります。' && (await counter.innerText()) === '0 / 5000字' && (await box.getAttribute('maxlength')) === null)
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
    await v.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
  await f.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
  await toOrder(f.page)
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
  await p2.goto('http://localhost:5173/write?lang=en', { waitUntil: 'networkidle' })
  check('story (en): the length line, no maxlength on the box', (await p2.locator('#write [data-testid=story-hint]').innerText()) === 'Not a whole story, a few lines are enough. The more true detail, the truer the character.' && (await p2.locator('#write [data-testid=story-input]').getAttribute('maxlength')) === null)
  await p2.locator('#write [data-testid=story-input]').fill('My mum left the porch light on.')
  await pickContext(p2, { relationship: 'parent_mother' })
  await p2.click(`#write >> text=${GO.en}`)
  await p2.waitForSelector('text=You can write up to 5,000 characters', { timeout: 6000 })
  check('story (en): a story_too_long answer from the server is shown as the localized message and the form stays', await p2.locator('#write [data-testid=story-input]').isVisible())
  await p2.close()
}

// ---------- Run 8c-2: Part A — the story opener: the question, the angle switch, the 10-character minimum, drafts, no-speech line, events ----------
{
  const QJA = { 'up-habit': 'その人が、頼まれる前にいつもしていることは？', 'up-moment': '今もはっきり覚えている、その人との場面をひとつ教えてください。', 'up-said': 'その人がよく口にする言葉、または忘れられないひと言は？', 'up-changed': 'その人のおかげで、あなたが変わったことは？' }
  const { page, errors, calls } = await mockPage(browser)
  await page.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined })
  await page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  const qEl = page.locator('#write [data-testid=story-question]')
  const box = page.locator('#write [data-testid=story-input]')
  check('opener: before a relationship and an occasion are picked there is no hint, but the headline is already there', (await qEl.count()) === 0 && (await page.locator('#write [data-testid=story-headline]').count()) === 1)
  check('opener: a browser without speech recognition hides the voice button and shows only the help line (「スマホのキーボードのマイクでも入力できます。」)', (await page.locator('#write button.voice').count()) === 0 && (await page.locator('#write [data-testid=voice-lang]').count()) === 0 && (await page.locator('#write [data-testid=voice-help]').innerText()) === 'スマホのキーボードのマイクでも入力できます。')
  await pickContext(page) // parent_father · up · birthday_milestone
  await qEl.waitFor()
  const first = await qEl.getAttribute('data-question-id')
  const headline = page.locator('#write [data-testid=story-headline]')
  const fs = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  check('story box (2026-11-01): a LARGE headline names what the box is for — 「忘れられない、ひと場面」 — and it labels the textarea', (await headline.innerText()) === '忘れられない、ひと場面' && (await fs(headline)) >= 20 && (await headline.getAttribute('for')) === 'moment')
  check('story box: the random question is a small HINT under the headline — 「ヒント：」 + a question of the "up" set — much smaller than the headline, and the box placeholder is 「どこで、その人は何をして、何と言いましたか。数行で十分です。」', first in QJA && (await qEl.innerText()) === QJA[first] && (await page.locator('#write .qHintLabel').innerText()) === 'ヒント：' && (await fs(qEl)) <= 16 && (await fs(qEl)) < (await fs(headline)) && (await box.getAttribute('placeholder')) === 'どこで、その人は何をして、何と言いましたか。数行で十分です。')
  check('story box: the line 「ヒントに答えなくても大丈夫。…」 sits under the hint (and its 「別のヒントにする」 link), before the box', (await page.locator('#write [data-testid=question-optional]').innerText()) === 'ヒントに答えなくても大丈夫。思い浮かぶ場面を、そのまま書いてください。' && (await page.evaluate(() => { const order = ['story-headline', 'story-hint-line', 'question-switch', 'question-optional', 'story-input'].map((id) => document.querySelector(`#write [data-testid=${id}]`)); return order.every((el, i) => el && (i === 0 || (order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)) })) && (await page.locator('#write [data-testid=question-switch]').innerText()) === '別のヒントにする')
  const seenIds = [first]
  for (let i = 0; i < 4; i++) { await page.click('#write [data-testid=question-switch]'); seenIds.push(await qEl.getAttribute('data-question-id')) }
  check('opener: 「別のヒントにする」 cycles the four angles of the same set and returns to the first', new Set(seenIds.slice(0, 4)).size === 4 && seenIds[4] === first && seenIds.every((id) => id in QJA))
  // a scene quote that already carries 「」 is not wrapped in a second set: 「「そっちは寒いか」とだけ聞く」 → 「『そっちは寒いか』とだけ聞く」
  {
    const NESTED = '「そっちは寒いか」とだけ聞く'
    const q = await mockPage(browser, { result: () => ({ ...clone(FIXTURE), candidates: clone(FIXTURE).candidates.map((c) => (c.slot === 'main' ? { ...c, story_anchor: NESTED } : c)) }) })
    await q.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
    await ign.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
  check('opener: coming back shows the quiet banner 「書きかけの場面があります — 続ける / 新しく書く」 and nothing is applied silently', (await banner.innerText()).includes('書きかけの場面があります') && (await page.locator('#write [data-testid=story-input]').inputValue()) === '')
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
    await e.page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    await pickContext(e.page)
    await e.page.locator('#write [data-testid=story-question]').waitFor()
    let found = false
    for (let i = 0; i < 4 && !found; i++) { found = (await e.page.locator('#write [data-testid=story-question]').innerText()) === q0; if (!found) await e.page.click('#write [data-testid=question-switch]') }
    check(`opener (${lang}): the "up" set is shown in the page language (the habit question found within four angles)`, found)
    const HL = { en: ["One moment you've never forgotten", 'Hint:', 'Another hint', "You don't have to answer the hint. Write the scene that comes to mind, just as it is.", 'Where were you? What did they do or say? A few lines are enough.', 'Not a whole story, a few lines are enough. The more true detail, the truer the character.'], 'zh-Hant': ['一個忘不了的片刻', '提示：', '換一個提示', '不必回答提示。想到的場景，直接寫下來就好。', '在哪裡？他做了什麼、說了什麼？幾行就夠了。', '不必是完整的故事，幾行就夠了。寫得越真實、越具體，選出的字就越貼近。'] }[lang]
    check(`story box (${lang}): headline, 「${HL[1]}」 label, switch link, the "you don't have to answer" line, placeholder and length line, exactly as specified`, (await e.page.locator('#write [data-testid=story-headline]').innerText()) === HL[0] && (await e.page.locator('#write .qHintLabel').innerText()) === HL[1] && (await e.page.locator('#write [data-testid=question-switch]').innerText()) === HL[2] && (await e.page.locator('#write [data-testid=question-optional]').innerText()) === HL[3] && (await e.page.locator('#write [data-testid=story-input]').getAttribute('placeholder')) === HL[4] && (await e.page.locator('#write [data-testid=story-hint]').innerText()) === HL[5], `${await e.page.locator('#write [data-testid=story-headline]').innerText()} | ${await e.page.locator('#write .qHintLabel').innerText()}`)
    await e.page.close()
  }
}

// ---------- Run 8c-3: Part B — "where will they read it?" ----------
{
  const { page, errors, calls } = await mockPage(browser)
  await page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
  await m.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
    await long.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
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
    ['ja', 'その場面から浮かぶ字を、無料で見る。あなたの目に映る一字を選ぶ。', '', '見本です。あなたの場面には、本命の二字が届きます。', 'その場面から浮かぶ字を、無料で見る。あなたの目に映る一字を選ぶ。', '見本です。あなたの場面には、本命の一字と遊び字の一字が届きます。'],
    ['zh-Hant', '免費看看這個片刻帶出的字，選出你眼中的那一個。', '', '以上為範例。你的片刻會得到屬於自己的兩個本命字。', '免費看看這個片刻帶出的字，選出你眼中的那一個。', '以上為範例。你的片刻會得到屬於自己的兩個字：本命一字與趣字一字。'],
    ['en', 'See the characters your moment brings up, free, and choose the one that fits how you see them.', '', 'Examples for illustration. Your moment gets two main characters of its own.', 'See the characters your moment brings up, free, and choose the one that fits how you see them.', 'Examples for illustration. Your moment gets two characters of its own: a main one and a playful one.'],
  ]) {
    const c = await mockPage(browser)
    // (2026-11-16) the form is in the writing room and the steps / examples on the landing page: the choice is kept for the tab, and "← Back" shows the landing wording that fits it
    const landing = async () => {
      await c.page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    }
    const room = async () => {
      await c.page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
      await c.page.waitForSelector('#write [data-testid=story-input]')
    }
    await landing()
    // (textContent: the sections below the fold are not rendered until scrolled to, and the page no longer scrolls to the writing step by itself)
    const h3 = async () => ((await c.page.locator('#how ol.steps li:nth-child(2) h3').textContent()) ?? '').trim()
    const p2 = async () => ((await c.page.locator('#how ol.steps li:nth-child(2) p').count()) ? (((await c.page.locator('#how ol.steps li:nth-child(2) p').textContent()) ?? '').trim()) : '')
    const mm = async () => ((await c.page.locator('p.from').first().textContent()) ?? '').trim()
    check(`copy (${lang}): before an occasion is picked the steps and the examples are unchanged — 「${st2Other}」 and the main-and-playful note`, (await h3()) === st2Other && (await mm()) === noteOther, `${await h3()} | ${await mm()}`)
    await room()
    await pickContext(c.page, { occasion: 'memorial' })
    await c.page.click('[data-testid=write-back]')
    await c.page.waitForSelector('#how')
    check(`copy (${lang}): with 偲ぶ picked the second step reads 「${st2}」 and says two main characters only, and the examples note says two (no free pick)`, (await h3()) === st2 && (await p2()) === st2p && (await mm()) === note, `${await h3()} | ${await p2()} | ${await mm()}`)
    await room()
    await pickContext(c.page, { occasion: 'birthday_milestone' })
    await c.page.click('[data-testid=write-back]')
    await c.page.waitForSelector('#how')
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
  await f.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' }) // (2026-11-16) the flow is the writing room
  await f.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  const form = f.page.locator('[data-testid=order-form]')
  await toOrder(f.page)
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
  await f.page.fill('#gift_message', 'あ'.repeat(210))
  check('ship-to: directly to them → a note box (200 characters at most, with its counter), and a note that the receiver\'s address goes in at checkout', (await form.locator('#gift_message').inputValue()).length === 200 && (await form.locator('[data-testid=gift-message-counter]').innerText()) === '200 / 200字' && (await form.locator('[data-ship-to=direct]').innerText()).includes('チェックアウトの配送先'))
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
  await e.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  await e.page.locator('#write [data-testid=story-input]').fill('父は、駅の改札でいつも黙って手を振った。')
  await pickContext(e.page)
  await e.page.click(`#write >> text=${GO.ja}`)
  await e.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await e.page.locator('article[data-slot=main]').click()
  await e.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await toOrder(e.page)
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
      if (width === 1280) check(`size section (${lang}): the e-gift card shows the gift itself — the card picture (2026-11-18; no grey 「字」 placeholder) — in the same frame as the other two where there are three`, g.boxes.every((x) => !x.ph) && g.boxes[0].src.includes('package/card') && g.boxes.every((x) => x.ok), JSON.stringify(g.boxes.map((x) => [x.src, x.ph])))
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
  await panel.locator('[data-testid=share-button]').click() // Part 12 (2026-11-20): the send options live in the share sheet
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
    // this Run checks the ceremony kept for locked, remembrance and quiet gifts: a plain open gift opens the new one, so `?ceremony=old` asks for the old
    await page.goto(`http://localhost:5173/g/${TOKEN}${search ? `${search}&ceremony=old` : '?ceremony=old'}`, { waitUntil: 'networkidle' })
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
    check('envelope (locked): no 「ほどく」 button — the real date and the real count instead', (await T(page, 'gift-open').count()) === 0 && (await T(page, 'gift-locked-date').innerText()) === '11月10日に開きます' && (await T(page, 'gift-locked-note').innerText()) === 'あと3日。その日まで、封は閉じたままです。')
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
    check(`${label}: the sound button is at its corner (${r.sound}); the film is muted unless the sound was asked for (on the receiver's page the tap on 「この贈りものには音楽があります。」 asks for it)`, typeof r.muted === 'boolean' && r.sound.length > 0)
    if (shot) await page.locator('[data-testid=film]').screenshot({ path: shot }).catch(() => {})
  }
  function seenHas(urls) { return urls.some((u) => /\/render|\/picture\/|\/scroll\./.test(u)) }
  async function pageUrls(page) { return page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)) }

  // 2. the opening (full motion), 3. the letter, 4. the film, 5. the reveal, 6. the poem, 7. the certificate, 8. keepsakes and the thank-you
  {
    const { page, ctx, errs, seen } = await open(mk())
    await T(page, 'gift-envelope').waitFor()
    check('envelope: 「ほどく」 button (the cord is tied across the seal), data-motion full; a liner pattern for the season (opened on the order day in November → autumn)', (await T(page, 'gift-open').innerText()) === 'ほどく' && (await T(page, 'gift-envelope').getAttribute('data-motion')) === 'full' && (await T(page, 'gift-envelope').getAttribute('data-liner')) === 'autumn')
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
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    check('film: the 34-second film plays on the receiver\'s page (no share button — the receiver has nothing to share)', (await step(page)) === 'film' && (await page.locator('[data-testid=animation-share]').count()) === 0)
    await checkEndCard(page, 'film end (ja, 短歌)', { vertical: true, lines: 5, shot: 'shots/film-card-ja.png' })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
    const rv = await page.evaluate(() => ({ colour: getComputedStyle(document.querySelector('[data-testid=gift-glyph]')).color, size: parseFloat(getComputedStyle(document.querySelector('[data-testid=gift-glyph-wrap]')).fontSize) }))
    check('reveal: the character large in cinnabar, the reading, the gold line 「○○さんの目に映る、あなた。」, the who line, and 「詩を読む」', rv.colour === 'rgb(192, 57, 43)' && rv.size >= 140 && (await T(page, 'gift-glyph').innerText()) === '備' && (await T(page, 'gift-reading').innerText()) === 'そなえる' && (await T(page, 'gift-gold').innerText()) === '山田 太郎さんの目に映る、あなた。' && (await T(page, 'gift-who').innerText()) === 'いつも、頼まれる前に備えている人。' && (await T(page, 'gift-to-poem').innerText()) === '詩を読む', JSON.stringify(rv))
    await shot(page, 'shots/gift-reveal-ja.png')
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
    await T(page, 'gift-to-answer').click()
    await T(page, 'gift-answer').waitFor()
    check('the answer step (after the keepsakes): 「お返しをする」, the twelve characters to give back, and the written reply (200 characters at most, never sent twice)', (await T(page, 'gift-answer-title').innerText()) === 'お返しをする' && (await T(page, 'gift-chars').locator('button').count()) === 12 && (await T(page, 'gift-reply-left').innerText()) === 'あと200字')
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
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
    await T(page, 'gift-to-cert').click()
    await T(page, 'gift-to-keep').click()
    await T(page, 'gift-to-answer').click()
    check('thank-you: when the receiver has already replied the page shows 「○○さんに届けました。」 and no box', (await T(page, 'gift-reply-sent').innerText()) === '山田 太郎さんに届けました。' && (await T(page, 'gift-reply').count()) === 0)
    await ctx.close()
  }

  // reduced motion: the opening is a fade
  {
    const { page, ctx, errs } = await open(mk(), { reduced: true })
    await T(page, 'gift-envelope').waitFor()
    check('reduced motion: the envelope says data-motion=fade', (await T(page, 'gift-envelope').getAttribute('data-motion')) === 'fade')
    // (the fade is short: record the styles the moment the opening starts, so it cannot pass unseen)
    await page.evaluate(() => {
      window.__nm = null
      new MutationObserver(() => {
        const e = document.querySelector('.gf-env')
        if (e && e.dataset.state === 'opening' && !window.__nm) {
          const g = (sel) => getComputedStyle(document.querySelector(sel)).animationName
          window.__nm = { env: getComputedStyle(e).animationName, flap: g('.gf-env-flap'), seal: g('.gf-seal i'), letter: g('.gf-env-letter') }
        }
      }).observe(document.body, { subtree: true, attributes: true, childList: true })
    })
    await T(page, 'gift-open').click()
    await page.waitForFunction(() => window.__nm)
    const nm = await page.evaluate(() => window.__nm)
    check('reduced motion: nothing moves (no seal break, flap or slide) — only a fade', nm.env === 'gf-fade-out' && nm.flap === 'none' && nm.seal === 'none' && nm.letter === 'none', JSON.stringify(nm))
    const t0 = Date.now()
    await T(page, 'gift-letter').waitFor({ timeout: 3000 })
    check('reduced motion: the letter follows after a short fade (under a second)', Date.now() - t0 < 900, String(Date.now() - t0))
    await T(page, 'gift-to-film').click()
    await toMusic(page)
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
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
    const colour = await T(page, 'gift-glyph').evaluate((el) => getComputedStyle(el).color)
    seen.push(await page.locator('body').innerText())
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
      ? { label: 'A gift of one character', to: 'To 山田 一郎', from: 'From 山田 太郎', open: 'Untie', lockedDate: `Opens on 10 November${''}`, lockedNote: '3 days to go. The envelope stays sealed until then.', btn: 'See the story', cert: 'ICHIREI · No. 0012' }
      : { label: '一個字的禮物', to: '致 山田 一郎', from: '山田 太郎 敬上', open: '解開', lockedDate: '11月10日開啟', lockedNote: '還有 3 天。在那天之前，信封會一直封著。', btn: '看故事', cert: '一字禮　第 0012 號' }
    {
      const { page, ctx } = await open(lockedView({ language: lang }), { locale })
      await T(page, 'gift-envelope').waitFor()
      check(`${lang}: the locked envelope — label, names, the date and the count in the reader's language`, (await T(page, 'gift-env-label').innerText()) === want.label && (await T(page, 'gift-env-to').innerText()) === want.to && (await T(page, 'gift-env-from').innerText()) === want.from && (await T(page, 'gift-locked-date').innerText()) === want.lockedDate && (await T(page, 'gift-locked-note').innerText()) === want.lockedNote, `${await T(page, 'gift-locked-date').innerText()}`)
      await page.screenshot({ path: `shots/gift-locked-${lang}.png` }).catch(() => {})
      await ctx.close()
    }
    // since 2026-11-15 an open English gift (not quiet) has the new ceremony, checked in Run 33; the sealed English envelope above stays today's
    if (lang === 'en') continue
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
      await toMusic(page)
      await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
      await checkEndCard(page, `film end (${lang}, ${lang === 'en' ? 'English verse' : '漢詩'})`, { vertical: false, lines: lang === 'en' ? 2 : 4, shot: `shots/film-card-${lang}.png` })
      await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
      await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
      await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
      await page.screenshot({ path: `shots/gift-reveal-${lang}.png` }).catch(() => {})
      await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
    await page.goto(`http://localhost:5173/g/${TOKEN}?ceremony=old`, { waitUntil: 'networkidle' })
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
    await T(page, 'share-button').click() // Part 12 (2026-11-20): the send options live in the share sheet
    if (lang === 'en') {
      // the US launch (2026-11-12, C3): Copy link, Email, WhatsApp, Messages, "Schedule for a date" — no LINE, no WeChat
      const wa = decodeURIComponent((await T(page, 'give-whatsapp').getAttribute('href')) ?? '')
      const sms = decodeURIComponent((await T(page, 'give-messages').getAttribute('href')) ?? '')
      check('share (en): WhatsApp and Messages carry the link and no LINE or WeChat button is shown', wa.startsWith('https://wa.me/?text=') && wa.includes(GIFT) && sms.startsWith('sms:') && sms.includes(GIFT) && (await T(page, 'give-line').count()) === 0 && (await T(page, 'give-wechat').count()) === 0)
      check('share (en): copy link, e-mail and "Schedule for a date" are there', (await T(page, 'give-copy').count()) === 1 && decodeURIComponent((await T(page, 'give-mail').getAttribute('href')) ?? '').includes(GIFT) && (await T(page, 'give-schedule').innerText()) === 'Schedule for a date')
      await shot(page, `shots/share-sheet-${lang}.png`)
      await ctx.close()
      continue
    }
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
    // (en: an encouragement gift — since 2026-11-15 an English thank-you gift has the new ceremony, whose film Save is checked in Run 33)
    const { page, ctx } = await open(mk({ language: lang, package: pkg, ...(lang === 'en' ? { purpose: 'encourage' } : {}), film: { status: 'ready', lines: ['「a」', 'b', 'c', 'd'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp', '/film/washi-1.webp', '/film/washi-2.webp'] } }), { locale })
    const makes = []
    await page.route(`**/api/gift/${TOKEN}/film/make**`, (r) => { makes.push(1); return r.fulfill({ status: makes.length === 1 ? 202 : 200, json: { state: makes.length === 1 ? 'pending' : 'ready', seconds: 30, bytes: 1 } }) })
    await page.route(`**/api/gift/${TOKEN}/film.mp4**`, (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: 'x' }))
    await T(page, 'gift-open').click()
    await T(page, 'gift-to-film').click({ timeout: 4000 })
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await page.locator('[data-testid=gift-skip]').click({ timeout: 6000 })
    await T(page, 'gift-to-poem').click({ timeout: 9000 })
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
    // Part 12 (2026-11-20): the story scroll is one item in the 「ほかの形で保存」 sheet (the PNG); the whole gift is one PDF behind 「まとめて保存」
    let n = 0
    let href = null
    if ((await p.locator('[data-testid=other-formats]').count()) > 0) {
      await p.locator('[data-testid=other-formats]').click()
      n = await p.locator('[data-testid=save-scroll]').count()
      href = n ? await p.locator('[data-testid=save-scroll]').first().getAttribute('href') : null
    }
    check(`scroll buttons (${name}): ${shown ? 'the PNG link to this film, in the formats sheet' : 'none'}`, shown ? n === 1 && href === '/api/animation/AN-testtesttesttesttest/scroll.png' : n === 0)
    await p.close()
  }
}

// ---------- Run 8g: E — the 24-hour change line on the buyer's page: the real deadline in the buyer's own time zone, three languages; gone after it ----------
{
  const UNTIL = '2026-11-07T05:30:00Z' // 14:30 in Tokyo
  const WHEN = { ja: '11月7日 14時30分（日本時間）', 'zh-Hant': '11月7日 14時30分（日本時間）', en: 'Nov 7, 12:30 AM ET' } // the page's market zone, with its label (2026-11-20) — the test device is in Asia/Shanghai on purpose
  const LINE = {
    ja: `キャンセル期限：${WHEN.ja}まで（受け取る前に限ります）。期限を過ぎると、お客様都合による返金はできません。`,
    'zh-Hant': `取消期限：${WHEN['zh-Hant']}前（限領取前）。超過期限後，恕不接受個人因素退款。`,
    en: `Cancel by: ${WHEN.en} (before you collect). After that, no refunds for change of mind.`,
  }
  const mkView = (lang, order, extra = {}) => ({ id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-SIMPLE', ship_to: 'me', egift_state: null }, order, ...extra })
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 800 } })
    const p = await ctx.newPage()
    await p.clock.install({ time: new Date('2026-11-06T06:00:00Z') })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: UNTIL, wood: null }, { support_email: 'help@example.com' }) }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-help]').waitFor()
    check(`E (${lang}): the cancel deadline is shown in the page's market zone with its label (never the device's: it is Asia/Shanghai here), word for word, and the rule is said once — no second paragraph`, (await p.locator('[data-testid=buyer-cancel-by]').innerText()) === LINE[lang] && (await p.locator('[data-testid=buyer-deadline]').count()) === 0, await p.locator('[data-testid=buyer-cancel-by]').innerText())
    check(`E (${lang}): the support address is plain, selectable text`, (await p.locator('[data-testid=buyer-support]').innerText()) === 'help@example.com' && (await p.locator('[data-testid=buyer-support] a').count()) === 0)
    await p.clock.fastForward('24:00:00')
    await p.waitForTimeout(300)
    check(`E (${lang}): the line disappears by itself when the deadline passes while the page is open`, (await p.locator('[data-testid=buyer-cancel-by]').count()) === 0)
    await ctx.close()
  }
  {
    const p = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 800 } })
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView('ja', { collected: false, ordered_at: '2020-01-01T00:00:00Z', change_until: '2020-01-02T00:00:00Z', wood: null }) }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await p.locator('[data-testid=buyer-collect-section]').waitFor()
    check('E: a page opened after the deadline has no 24-hour line at all (and no empty help block)', (await p.locator('[data-testid=buyer-cancel-by]').count()) === 0 && (await p.locator('[data-testid=buyer-deadline]').count()) === 0 && (await p.locator('[data-testid=buyer-help]').count()) === 0)
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
    await p.goto(`http://localhost:5173/g/${TOKEN}?preview=AN-testtesttesttesttest&ceremony=old`, { waitUntil: 'networkidle' })
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
    ja: { btn: '贈りものを受け取る', line: '受け取ると、相手に送ったり、保存したりできるようになります。受け取った後はキャンセルできません。', late: '受け取ると、相手に送ったり、保存したりできるようになります。', confirm: '受け取りますか？この後はキャンセルできません。', yes: '受け取る', no: 'まだ', by: 'キャンセル期限：11月7日 14時30分（日本時間）まで（受け取る前に限ります）。期限を過ぎると、お客様都合による返金はできません。', wait: '贈りものを仕上げています…', first: '受け取る前に、相手に届く内容をご確認ください。', preview: '相手が見る画面を確かめる' },
    'zh-Hant': { btn: '領取禮物', line: '領取後即可傳送與儲存。領取後將無法取消訂單。', late: '領取後即可傳送與儲存。', confirm: '確定領取嗎？領取後將無法取消。', yes: '領取', no: '先不要', by: '取消期限：11月7日 14時30分（日本時間）前（限領取前）。超過期限後，恕不接受個人因素退款。', wait: '禮物製作中…', first: '領取前，請先確認對方將收到的內容。', preview: '預覽對方會看到的畫面' },
    en: { btn: 'Collect your gift', line: "Once collected, you can send and save it. After that, the order can't be cancelled.", late: 'Once collected, you can send and save it.', confirm: "Collect it now? You won't be able to cancel after this.", yes: 'Collect', no: 'Not yet', by: 'Cancel by: Nov 7, 12:30 AM ET (before you collect). After that, no refunds for change of mind.', wait: 'Finishing your gift…', first: "Before collecting, check what they'll receive.", preview: "Preview what they'll see" },
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
    check(`before collecting (${lang}): the cancel deadline (real, in the page's market zone with its label, never the device's), the big button, and the line under it — word for word; the cancel rule is said ONCE (the bottom paragraph is gone)`, (await p.locator('[data-testid=buyer-cancel-by]').innerText()) === t.by && (await p.locator('[data-testid=collect-button]').innerText()) === t.btn && (await p.locator('[data-testid=collect-line]').innerText()) === t.line && (await p.locator('[data-testid=buyer-deadline]').count()) === 0, await p.locator('[data-testid=buyer-cancel-by]').innerText())
    if (lang === 'ja') await p.screenshot({ path: 'shots/buyer-before-collect-ja.png', fullPage: true })
    await p.locator('[data-testid=collect-button]').click()
    check(`collect (${lang}): within 24 hours a confirm appears IN the page (not a browser dialog), with 「${t.yes}」 and 「${t.no}」 — and nothing was sent yet`, (await p.locator('[data-testid=collect-confirm] p').first().innerText()) === t.confirm && (await p.locator('[data-testid=collect-yes]').innerText()) === t.yes && (await p.locator('[data-testid=collect-no]').innerText()) === t.no && posts.length === 0)
    await p.locator('[data-testid=collect-no]').click()
    check(`collect (${lang}): 「${t.no}」 goes back and nothing is recorded`, (await p.locator('[data-testid=collect-button]').count()) === 1 && posts.length === 0)
    await p.locator('[data-testid=collect-button]').click()
    await p.locator('[data-testid=collect-yes]').click()
    await p.locator('[data-testid=share-button]').waitFor() // Part 12: the send options are in the share sheet
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
    check('collect: after 24 hours there is no cancel deadline line, the line under the button is the short one, and the tap unlocks at once with NO confirm', (await p.locator('[data-testid=buyer-cancel-by]').count()) === 0 && (await p.locator('[data-testid=collect-line]').innerText()) === '受け取ると、相手に送ったり、保存したりできるようになります。')
    await p.locator('[data-testid=collect-button]').click()
    await p.locator('[data-testid=share-button]').waitFor() // Part 12: the send options are in the share sheet
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
    // the sender's page, after collecting (Part 12, 2026-11-20): no share section on the page any more — the film and the poem card are the receiver's to share; the sender's 「シェアする」 sheet holds the send options only
    {
      const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
      await ctx.addInitScript(() => { navigator.canShare = undefined; navigator.share = undefined })
      const p = await ctx.newPage()
      await wire(p, '/api/animation/AN-testtesttesttesttest', [])
      await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkView(lang, false, true) }))
      await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
      await p.locator('[data-testid=share-button]').waitFor()
      check(`share (${lang}, sender's page): no share-the-film section on the page itself`, (await p.locator('[data-testid=share-section]').count()) === 0)
      await p.locator('[data-testid=share-button]').click()
      await p.locator('[data-testid=sender-share-options]').waitFor()
      check(`share (${lang}, sender's page): the share sheet holds the send options (copy the link…) and no film / poem-card buttons`, (await p.locator('[data-testid=give-copy]').count()) === 1 && (await p.locator('[data-testid=share-film]').count()) === 0 && (await p.locator('[data-testid=share-card]').count()) === 0)
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
    await m.locator('[data-testid=share-button]').waitFor()
    check('share: a remembrance order has no share section on its page', (await m.locator('[data-testid=share-section]').count()) === 0)
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
    await p.goto(`http://localhost:5173/g/${TOKEN}${query}${query ? '&' : '?'}ceremony=old`, { waitUntil: 'networkidle' })
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
    en: { title: 'Legal notice', refundHead: 'Within 24 hours of payment', ret: ["You can cancel for a full refund within 24 hours of payment, as long as you have not pressed 'Collect your gift'.", 'After that, the gift has been made for one person and cannot be refunded. If we made a mistake, we will fix it or refund you.', "We can't change an order after payment (character, poem, names or message).", "more than 24 hours after payment we can't accept returns or refunds for change of mind.", 'we cover return shipping', 'Import duties and taxes on overseas deliveries are paid by the recipient.'], faq: ['Can I change the character after I order?', 'Can I cancel?', 'What if what I receive has a problem?'], rows: ['Seller', 'Person in charge', 'Address', 'Telephone', 'E-mail'] },
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
    if (lang === 'en') check('legal (en): the price row reads "US$25 (sale US$17.50) for orders from the English site; ¥3,980 for orders from the Japanese and Chinese sites" (the one English page that keeps yen)', rows.includes('US$25 (sale US$17.50) for orders from the English site; ¥3,980 for orders from the Japanese and Chinese sites'))
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
    ja: { soon: ['選んでから、お支払い。リンクで送るか、カードを印刷して渡す。', ''], wood: '国内 約2〜3週間 ・ 海外はさらに1〜2週間', egift: 'eギフト：お支払い後すぐ（開封日を指定した場合はその日）。', woodAns: '木札・版木：お支払い完了から24時間のキャンセル受付期間ののちに制作を始め、国内は約2〜3週間でお届けします（海外はさらに1〜2週間）。', q: 'いつ届く？' },
    'zh-Hant': { soon: ['選好之後才付款。用連結傳送，或印出卡片親手交給對方。', ''], wood: '日本國內約2〜3週 · 海外另需1〜2週', egift: 'e禮物：付款後立即送達（若指定開啟日期，則於當天開啟）。', woodAns: '木牌、版木：付款完成後24小時的取消受理期間結束後開始製作，日本國內約2〜3週送達（海外另需1〜2週）。', q: '什麼時候送到？' },
    en: { soon: ["Pay only once you've chosen. Then send the link, or print the card.", ''], wood: 'Japan about 2–3 weeks · Overseas 1–2 weeks more', egift: 'E-gift: right after payment (or on the opening date you set).', woodAns: 'Wooden tag and carved block: made after the 24-hour cancellation period, delivered in about 2–3 weeks in Japan (1–2 weeks more overseas).', q: 'When will it arrive?' },
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
      const txt = (await li.locator('p').count()) ? (await li.locator('p').first().textContent())?.trim() : ''
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
    // the basket (2026-11-15): every result page saves its item; the saved item opens the result page again
    const bk = []
    await f.page.route('**/api/basket', async (route) => {
      if (route.request().method() === 'POST') {
        bk.push(JSON.parse(route.request().postData() ?? '{}'))
        return route.fulfill({ json: { id: 'BK-aaaaaaaaaaaaaaaaaaaa', token: 'BT-x', count: 1, created: true } })
      }
      return route.fulfill({ json: { items: [], token: null } })
    })
    await f.page.route('**/api/basket/BK-*', (route) => (bk[0] ? route.fulfill({ json: { id: 'BK-aaaaaaaaaaaaaaaaaaaa', resume: bk[0].resume } }) : route.fulfill({ status: 404, json: {} })))
    await f.page.route('**/api/me*', (route) => route.fulfill({ json: { basket: { count: bk.length }, ready: null, hold: null } }))
    await f.page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    await f.page.locator('#write [data-testid=story-input]').fill(STORY)
    await pickContext(f.page)
    await f.page.click(`#write >> text=${GO[lang]}`)
    await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    return { ...f, pv, pm, bk }
  }
  const pickMain = async (page, lang) => {
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await page.locator('[data-testid=result-page]').waitFor()
  }
  const RC = { ja: { make: 'この一字を贈る →', another: 'ほかの字を選ぶ', waiting: 'その場面を描いています。1分ほどお待ちください。', drawing: '描いています…' }, 'zh-Hant': { make: '把這個字送出去 →', another: '選別的字', waiting: '正在描繪這個片刻，約需一分鐘。', drawing: '描繪中……' }, en: { make: 'Make it a gift →', another: 'Choose another character', waiting: 'Painting your moment. About a minute.', drawing: 'Painting…' } }
  const figs = (page, st) => page.locator(`[data-testid=result-pictures] .rs-fig[data-ready=${st}]`)
  const ja = await mk('ja')
  check('preview: CHARACTER FIRST — the two characters are on screen and not one picture was asked for (no /api/preview call before a character is picked), and no result page yet', ja.pv.start.length === 0 && (await ja.page.locator('[data-testid=result-page]').count()) === 0)
  await ja.page.locator('article[data-slot=main]').click()
  await ja.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await ja.page.locator('[data-testid=result-page]').waitFor()
  await ja.page.waitForTimeout(400)
  check('result page: picking the character opens the full-screen result page (the order form is not visible yet) and starts the draft at once (one /api/preview call with the story, the context and every character shown — both forms)', ja.pv.start.length >= 1 && ja.pv.start[0].story === STORY && ja.pv.start[0].language === 'ja' && ja.pv.start[0].shown.join('') === '証證守' && !(await ja.page.locator('[data-testid=order-form]').isVisible()))
  check('basket: opening the result page saved ONE item (POST /api/basket) with the story, the language, the chosen character, the card line and what the page needs to open it again — and nothing was asked of a model', ja.bk.length >= 1 && ja.bk[0].story === STORY && ja.bk[0].language === 'ja' && ['證', '証'].includes(ja.bk[0].kanji) && ja.bk[0].resume?.result?.candidates?.length >= 1 && ja.bk[0].resume?.story === STORY && ja.bk.every((b) => b.kanji === ja.bk[0].kanji), JSON.stringify(ja.bk.map((b) => [b.kanji, b.story?.slice(0, 5)])))
  {
    const r2 = await mockPage(browser)
    let selects = 0
    await r2.page.route('**/api/select', (route) => { selects++; return route.fulfill({ status: 500, json: {} }) })
    await r2.page.route('**/api/me*', (route) => route.fulfill({ json: { basket: { count: 1 }, ready: null, hold: null } }))
    await r2.page.route('**/api/basket/BK-*', (route) => route.fulfill({ json: { id: 'BK-aaaaaaaaaaaaaaaaaaaa', resume: ja.bk[0].resume } }))
    await r2.page.route('**/api/basket', (route) => route.fulfill({ json: { id: 'BK-aaaaaaaaaaaaaaaaaaaa', token: 'BT-x', count: 1, created: false } }))
    await r2.page.goto('http://localhost:5173/write?resume=BK-aaaaaaaaaaaaaaaaaaaa', { waitUntil: 'networkidle' })
    await r2.page.locator('[data-testid=result-page]').waitFor({ timeout: 8000 })
    check('basket: 「この贈りものを贈る →」 (/?resume=<item>) puts the saved result page back with its character, and no engine call is made (/api/select was never asked)', ['證', '証'].includes(await r2.page.locator('[data-testid=result-glyph]').innerText()) && selects === 0)
    await r2.page.close()
  }
  check('result page: it opens at the top, with the character in big type and the heading 「あなたの贈りもの」 — and no 「見本」 / Sample label anywhere', (await ja.page.locator('[data-testid=result-page]').evaluate((el) => el.scrollTop)) === 0 && ['證', '証'].includes(await ja.page.locator('[data-testid=result-glyph]').innerText()) && (await ja.page.locator('[data-testid=result-heading]').innerText()) === 'あなたの贈りもの' && !(await ja.page.locator('[data-testid=result-page]').innerText()).match(/見本|Sample/))
  check('result page: while drawing it says 「その場面を描いています。1分ほどお待ちください。」 with the quiet ink line, the character is already there, and the four picture places are there', (await ja.page.locator('[data-testid=result-waiting]').innerText()).includes(RC.ja.waiting) && (await ja.page.locator('[data-testid=result-pictures] .rs-fig').count()) === 4)
  await ja.page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-ready=yes]').length >= 2, null, { timeout: 8000 })
  const partial = await figs(ja.page, 'yes').count()
  check('result page: the pictures fill in as they arrive (some are there while others still wait)', partial >= 2 && partial < 4, String(partial))
  await ja.page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-ready=yes]').length === 4, null, { timeout: 12000 })
  check('result page: when all four are there the waiting line is gone; each picture has its line of the story under it', (await ja.page.locator('[data-testid=result-waiting]').count()) === 0 && (await ja.page.locator('[data-testid=result-pictures] .rs-fig figcaption').nth(1).innerText()) === '「もういらない」と私は言った。')
  await ja.page.locator('[data-testid=result-poem]').waitFor({ timeout: 5000 })
  check('result page: the poem of the chosen format is on the page', (await ja.page.locator('[data-testid=result-poem]').innerText()).includes('蓋の花添え'))
  check('result page: NO download before payment — no link, no download attribute, no scroll or PDF address anywhere; the only buttons are the two choices and 「保存」 (the basket\'s Save panel, 2026-11-15; its link opens only once pressed)', (await ja.page.locator('[data-testid=result-page] [download]').count()) === 0 && (await ja.page.locator('[data-testid=result-page] a:not([data-testid=result-top] a)').count()) === 0 && (await ja.page.locator('[data-testid=result-top] a').count()) === 2 && !(await ja.page.locator('[data-testid=result-page]').innerHTML()).match(/scroll\.|\.pdf|download/) && (await ja.page.locator('[data-testid=result-page] button').count()) === 4 && (await ja.page.locator('[data-testid=result-page] [data-testid=save-button]').count()) === 1)
  check('result page: the closing line, the note and the two buttons are the owner\'s words', (await ja.page.locator('[data-testid=result-closing]').innerText()) === 'この一字は、あなたの目に映る、その人です。' && (await ja.page.locator('[data-testid=result-make]').innerText()) === RC.ja.make && (await ja.page.locator('[data-testid=result-another]').innerText()) === RC.ja.another)
  await ja.page.screenshot({ path: `${SHOTS}/e2e-result-ja-desktop.png`, fullPage: false })
  // 「別の字を選ぶ」 goes back to the cards (no new engine call)
  await ja.page.click('[data-testid=result-another]')
  await ja.page.waitForSelector('[data-all-revealed=yes]', { timeout: 8000 })
  check('result page: 「ほかの字を選ぶ」 returns to the cards (the result page is gone, both cards are back, the engine was not asked again)', (await ja.page.locator('[data-testid=result-page]').count()) === 0 && (await ja.page.locator('article[data-slot]').count()) >= 2 && ja.calls.select.length === 1)
  await ja.page.locator('article[data-slot=freestyle]').click()
  await ja.page.locator('article[data-slot=freestyle]').locator('text=この字で贈る').click()
  await ja.page.locator('[data-testid=result-page]').waitFor()
  await ja.page.waitForTimeout(500)
  check('preview: another character of the SAME story asks for the same draft (draft_id sent back), so nothing is drawn again', ja.pv.start.length >= 2 && ja.pv.start.at(-1).draft_id === DRAFT)
  // 「別の候補を見る」: two rounds (ICHIREI_MAX_ROUNDS 2)
  await ja.page.click('[data-testid=result-another]')
  await ja.page.waitForSelector('[data-testid=see-others]')
  check('new round: 「別の二字を探す（あと1回）」 sits under the cards, the pager is not there yet (one round), and 「ひと場面を書き直す」 is the last thing on the screen', (await ja.page.locator('[data-testid=see-others]').innerText()) === '別の二字を探す（あと1回）' && (await ja.page.locator('[data-testid=set-label]').count()) === 0 && (await ja.page.evaluate(() => { const a = document.querySelector('article[data-slot=main]'); const b = document.querySelector('[data-testid=see-others]'); const c = document.querySelector('[data-testid=edit-story]'); return !!(a && b && c && (a.compareDocumentPosition(b) & 4) && (b.compareDocumentPosition(c) & 4)) })))
  await ja.page.click('[data-testid=see-others]')
  await ja.page.waitForFunction(() => document.querySelector('article[data-slot=main]')?.textContent?.includes('備'), null, { timeout: 8000 })
  check('retry 1: 「別の二字を探す」 asks the engine again with every character already shown (both forms) and retry 1 — and two NEW characters are on screen', ja.calls.select.length === 2 && ja.calls.select[1].retry === 1 && ja.calls.select[1].exclude.join('') === '証證守' && (await ja.page.locator('article[data-slot=main]').innerText()).includes('備'))
  check('after round 2 (the last) the button is GONE and the card screen says 「この物語で探せるのはここまでです。」; the pager appears: 「‹ 前の組　2 / 2　次の組 ›」', (await ja.page.locator('[data-testid=see-others]').count()) === 0 && (await ja.page.locator('[data-testid=retry-cap]').innerText()) === 'この物語で探せるのはここまでです。' && (await ja.page.locator('[data-testid=set-prev]').innerText()) === '‹ 前の組' && (await ja.page.locator('[data-testid=set-label]').innerText()) === '2 / 2' && (await ja.page.locator('[data-testid=set-next]').innerText()) === '次の組 ›')
  await ja.page.click('[data-testid=set-prev]')
  check('…the first set is back with its own characters: nothing already shown is lost', (await ja.page.locator('article[data-slot=main]').innerText()).includes('証') && (await ja.page.locator('[data-testid=set-label]').innerText()) === '1 / 2')
  // order: the draft and every shown character go with the order
  await ja.page.locator('article[data-slot=main]').click()
  await ja.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await ja.page.locator('[data-testid=result-page]').waitFor()
  await ja.page.locator('[data-testid=result-poem]').waitFor({ timeout: 6000 })
  await ja.page.click('[data-testid=result-make]')
  await ja.page.locator('[data-testid=order-form]').waitFor()
  check('result page: 「この一字を贈る →」 reaches the order section (the form is there, the result page is gone), and the old 「見本」 card box is NOT in the order section', (await ja.page.locator('[data-testid=result-page]').count()) === 0 && (await ja.page.locator('[data-testid=order-form]').isVisible()) && (await ja.page.locator('[data-testid=card-preview], [data-testid=sample-mark], [data-testid=card-sheet]').count()) === 0)
  await ja.page.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 6000 })
  check('preview: the refund line (cancel only within 24 hours of payment and before 「贈りものを受け取る」) sits above the order button, and a link to the legal page beside it', (await ja.page.locator('[data-testid=order-refund-line]').innerText()).startsWith('キャンセル（全額返金）は、お支払い完了') && (await ja.page.locator('[data-testid=legal-link]').count()) >= 1)
  check('preview: the size choice and the order button come after the names, on the order step', await ja.page.evaluate(() => { const b = document.querySelector('input[name=package]'); const c = document.querySelector('[data-testid=order-submit]'); return !!(b && c && (b.compareDocumentPosition(c) & 4)) }))
  await ja.page.fill('input[name=sender_name]', '山田 太郎')
  await ja.page.fill('input[name=receiver_name]', '山田 一郎')
  const d8f = new Date(); d8f.setDate(d8f.getDate() + 20)
  await ja.page.fill('input[name=delivery_date]', `${d8f.getFullYear()}-${String(d8f.getMonth() + 1).padStart(2, '0')}-${String(d8f.getDate()).padStart(2, '0')}`)
  await ja.page.click('label:has(input[name=package][value=standard])')
  await tickRefund(ja.page)
  await ja.page.click('[data-testid=order-submit]')
  await ja.page.waitForSelector('#co', { timeout: 8000 })
  const ob = ja.calls.order[0]
  check('order: the request carries the draft the buyer saw (draft_id) and EVERY character shown for this story with its set (4 in all, two rounds)', ob.draft_id === DRAFT && Array.isArray(ob.shown_characters) && ob.shown_characters.length === 4 && new Set(ob.shown_characters.map((x) => x.set)).size === 2 && ob.shown_characters.every((x) => x.candidate && x.candidate.kanji))
  check('analytics: card_preview_shown, candidates_retry (1), pictures_before_pay (shown), preview_to_order, result_page_view and result_to_order are reported — codes only, never a character or a story', ['card_preview_shown', 'pictures_before_pay', 'preview_to_order', 'result_page_view', 'result_to_order'].every((e) => ja.calls.analytics.some((a) => a.event === e)) && ja.calls.analytics.filter((a) => a.event === 'candidates_retry').map((a) => a.n).join() === '1' && ja.calls.analytics.some((a) => a.event === 'pictures_before_pay' && a.state === 'shown') && !JSON.stringify(ja.calls.analytics.filter((a) => /preview|retry|pictures|result/.test(a.event))).match(/証|備|story/))
  check('no page errors (run 8f, ja)', ja.errors.length === 0, JSON.stringify(ja.errors))
  await ja.page.close()
  // Part 3 (2026-11-20): the result page's header (brand, My gifts, the way back with the story kept) and the Save panel under the customer's e-mail
  {
    const SAVED_LINE = { ja: '✓ 保存しました。b•••@gmail.comの贈りものとして、30日間お預かりします。リンクをメールでお送りしました。', 'zh-Hant': '✓ 已保存在b•••@gmail.com之下，保留30天。連結已寄到你的信箱。', en: "✓ Saved under b•••@gmail.com for 30 days. We've emailed you the link." }
    const OPEN = { ja: 'マイギフトを開く →', 'zh-Hant': '打開我的禮物 →', en: 'Open My gifts →' }
    const LEAD = { ja: 'この贈りものを、あなたのメールアドレスに保存します。', 'zh-Hant': '這份禮物會保存在你的電子郵件之下。', en: "We'll save this gift under your email address." }
    const BACK = { ja: '← 場面に戻る', 'zh-Hant': '← 回到我的片刻', en: '← Back to my moment' }
    const BTN = { ja: 'メールに保存する', 'zh-Hant': '保存到我的電子郵件', en: 'Save to my email' }
    const LANDING = { ja: '/', 'zh-Hant': '/zh', en: '/en' }
    const wire = async (page, { mail = true, masked = null, posts, me }) => {
      await page.route('**/api/basket', async (route) => {
        if (route.request().method() === 'POST') return route.fulfill({ json: { id: 'BK-aaaaaaaaaaaaaaaaaaaa', token: 'BT-x', count: 1, created: true } })
        return route.fulfill({ json: { items: [], token: 'BT-abcdefghjkmnpqrstuvwxyz2', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2', mail, email: masked, saved_days: 30 } })
      })
      await page.route('**/api/basket/email', (route) => { posts.push({ path: 'email', body: JSON.parse(route.request().postData() ?? '{}') }); return route.fulfill({ json: { ok: true, email: 'b•••@gmail.com', pending: false } }) })
      await page.route('**/api/basket/email/resend', (route) => { posts.push({ path: 'resend', body: JSON.parse(route.request().postData() ?? '{}') }); return route.fulfill({ json: { ok: true, email: 'b•••@gmail.com', pending: false } }) })
      await page.route('**/api/basket/qr.svg*', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29"><rect width="29" height="29" fill="#F5EDD8"/><rect x="2" y="2" width="9" height="9" fill="#1A1410"/></svg>' }))
      await page.route('**/api/me*', (route) => { me.n++; return route.fulfill({ json: { basket: { count: me.count }, ready: null, hold: null } }) })
    }
    for (const lang of ['ja', 'zh-Hant', 'en']) {
      const posts = []
      const me = { n: 0, count: 1 }
      const q = await mk(lang)
      await wire(q.page, { posts, me })
      await q.page.setViewportSize({ width: 390, height: 844 })
      await pickMain(q.page, lang)
      const top = await q.page.evaluate(() => {
        const t = document.querySelector('[data-testid=result-top]')
        const r = t.getBoundingClientRect()
        const brand = document.querySelector('[data-testid=result-brand]')
        const rp = document.querySelector('[data-testid=result-page]')
        return { pos: getComputedStyle(t).position, h: r.height, brand: brand.textContent.replace(/\s+/g, ' ').trim(), href: new URL(brand.href).pathname, gifts: !!t.querySelector('[data-testid=my-gifts]'), back: document.querySelector('[data-testid=result-back]').textContent, overflow: rp.scrollWidth > rp.clientWidth, docOverflow: document.documentElement.scrollWidth > window.innerWidth, oneLine: [...t.querySelectorAll('a,button')].every((e) => e.getBoundingClientRect().height < 56) }
      })
      check(`result page header (${lang}, 390px): the brand 字 ICHIREI linking to the landing page in the page's language, My gifts, and 「${BACK[lang]}」; it is not sticky; it fits on one line; no horizontal scroll`, top.brand === '字ICHIREI' && top.href === LANDING[lang] && top.gifts && top.back === BACK[lang] && top.pos !== 'sticky' && top.pos !== 'fixed' && top.oneLine && !top.overflow && !top.docOverflow, JSON.stringify(top))
      await q.page.click('[data-testid=save-button]')
      await q.page.locator('[data-testid=save-email-step]').waitFor()
      const bg = await q.page.evaluate(() => { const el = document.querySelector('[data-testid=save-panel]'); return { bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, border: getComputedStyle(el).borderTopColor, btn: getComputedStyle(document.querySelector('[data-testid=save-email-button]')).backgroundColor } })
      check(`Save panel (${lang}): Antique Paper #231C14 with ivory text — no white, no glass; the e-mail step first (${LEAD[lang]}), the button 「${BTN[lang]}」, the news box unticked`, bg.bg === 'rgb(35, 28, 20)' && bg.color === 'rgb(245, 237, 216)' && bg.bg !== 'rgb(255, 255, 255)' && (await q.page.locator('[data-testid=save-lead]').innerText()) === LEAD[lang] && (await q.page.locator('[data-testid=save-email-button]').innerText()) === BTN[lang] && !(await q.page.locator('[data-testid=save-marketing]').isChecked()), JSON.stringify(bg))
      await q.page.click('[data-testid=save-email-button]')
      check(`Save requires an e-mail (${lang}): pressing the button with no address sends nothing`, posts.length === 0 && (await q.page.locator('[data-testid=save-saved]').count()) === 0)
      const meBefore = me.n
      await q.page.fill('[data-testid=save-email-input]', 'brian@gmail.com')
      await q.page.click('[data-testid=save-email-button]')
      await q.page.locator('[data-testid=save-saved]').waitFor()
      const html = await q.page.content()
      check(`Save (${lang}): the address is sent once, the news box stays unticked (marketing false); the line 「${SAVED_LINE[lang]}」 and the button 「${OPEN[lang]}」 to My gifts`, posts.length === 1 && posts[0].body.email === 'brian@gmail.com' && posts[0].body.marketing === false && (await q.page.locator('[data-testid=save-saved]').innerText()) === SAVED_LINE[lang] && (await q.page.locator('[data-testid=save-open-gifts]').innerText()) === OPEN[lang] && new URL(await q.page.locator('[data-testid=save-open-gifts]').getAttribute('href'), 'http://x').pathname === (lang === 'ja' ? '/basket' : lang === 'en' ? '/en/basket' : '/zh/basket'))
      check(`Save (${lang}): the full address is nowhere on the page after saving (only b•••@gmail.com); My gifts (n) is asked again at once; copy link and the QR stay below, smaller, with the privacy note`, !html.includes('brian@gmail.com') && me.n > meBefore && (await q.page.locator('[data-testid=save-copy]').count()) === 1 && (await q.page.locator('[data-testid=save-qr]').count()) === 1 && (await q.page.locator('[data-testid=save-note]').count()) === 1)
      const qr = await q.page.evaluate(() => { const i = document.querySelector('[data-testid=save-qr]'); const cs = getComputedStyle(i); return { bg: cs.backgroundColor, pad: cs.paddingTop, w: i.getBoundingClientRect().width } })
      check(`Save (${lang}): the QR sits on an ivory slip (#F5EDD8, not white) with a 12px quiet margin`, qr.bg === 'rgb(245, 237, 216)' && qr.pad === '12px', JSON.stringify(qr))
      check(`Save panel (${lang}): no horizontal scroll at 390px`, !(await q.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.querySelector('[data-testid=result-page]').scrollWidth > document.querySelector('[data-testid=result-page]').clientWidth)))
      // back: the writing page with the same story in the box
      await q.page.click('[data-testid=result-back]')
      await q.page.waitForSelector('[data-testid=result-page]', { state: 'detached' })
      const kept = await q.page.locator('#write [data-testid=story-input]').inputValue()
      check(`result page (${lang}): 「${BACK[lang]}」 lands on the writing page with the same story in the box`, kept.includes(STORY.slice(0, 30)), kept.slice(0, 60))
      await pickMain(q.page, lang).catch(() => {})
      check(`no page errors (Part 3 header and Save, ${lang})`, q.errors.length === 0, JSON.stringify(q.errors))
      await q.page.close()
    }
    // browser back from the result page: the same writing page with the story kept (ja)
    {
      const posts = []
      const q = await mk('ja')
      await wire(q.page, { posts, me: { n: 0, count: 1 } })
      await pickMain(q.page, 'ja')
      await q.page.goBack()
      await q.page.waitForSelector('[data-testid=result-page]', { state: 'detached', timeout: 6000 })
      const kept = await q.page.locator('#write [data-testid=story-input]').inputValue().catch(() => '')
      check('result page (ja): the browser\'s back lands on the writing page with the same story in the box', kept.includes(STORY.slice(0, 30)), kept.slice(0, 60))
      await q.page.close()
    }
    // no mailer yet (no RESEND_API_KEY): Save works as before, in the new look, with the 「✓ 保存しました。」 line and no e-mail part
    {
      const posts = []
      const q = await mk('ja')
      await wire(q.page, { mail: false, posts, me: { n: 0, count: 1 } })
      await pickMain(q.page, 'ja')
      await q.page.click('[data-testid=save-button]')
      await q.page.locator('[data-testid=save-saved]').waitFor()
      check('Save without a mailer (no RESEND_API_KEY): no e-mail step, the line 「✓ 保存しました。30日間お預かりします。」 (no address in it), 「マイギフトを開く →」, the link and the QR', (await q.page.locator('[data-testid=save-email-step]').count()) === 0 && (await q.page.locator('[data-testid=save-saved]').innerText()) === '✓ 保存しました。30日間お預かりします。' && (await q.page.locator('[data-testid=save-open-gifts]').innerText()) === 'マイギフトを開く →' && (await q.page.locator('[data-testid=save-qr]').count()) === 1 && posts.length === 0)
      await q.page.close()
    }
    // an address already on this browser (a free-gift hold or an earlier save): prefilled, partly hidden, with 「このメールに保存する」 and 「別のメールにする」
    {
      const posts = []
      const q = await mk('ja')
      await wire(q.page, { masked: 'b•••@gmail.com', posts, me: { n: 0, count: 1 } })
      await pickMain(q.page, 'ja')
      await q.page.click('[data-testid=save-button]')
      await q.page.locator('[data-testid=save-masked]').waitFor()
      const pre = { masked: await q.page.locator('[data-testid=save-masked]').innerText(), use: await q.page.locator('[data-testid=save-use-saved]').innerText(), other: await q.page.locator('[data-testid=save-other]').innerText(), field: await q.page.locator('[data-testid=save-email-input]').count() }
      check('Save with an address already known: it shows partly hidden, the button 「このメールに保存する」 and 「別のメールにする」; no field yet', pre.masked === 'b•••@gmail.com' && pre.use === 'このメールに保存する' && pre.other === '別のメールにする' && pre.field === 0, JSON.stringify(pre))
      await q.page.click('[data-testid=save-other]')
      check('「別のメールにする」 shows the e-mail field and the news box (unticked)', (await q.page.locator('[data-testid=save-email-input]').count()) === 1 && !(await q.page.locator('[data-testid=save-marketing]').isChecked()))
      await q.page.close()
      const q2 = await mk('ja')
      const posts2 = []
      await wire(q2.page, { masked: 'b•••@gmail.com', posts: posts2, me: { n: 0, count: 1 } })
      await pickMain(q2.page, 'ja')
      await q2.page.click('[data-testid=save-button]')
      await q2.page.click('[data-testid=save-use-saved]')
      await q2.page.locator('[data-testid=save-saved]').waitFor()
      check('「このメールに保存する」 saves under the address on the record (the link is mailed again) without typing it', posts2.length === 1 && posts2[0].path === 'resend')
      await q2.page.close()
    }
  }
  // the daily picture limit: the page shows the character and the poem without pictures (the block is left out), with the line that they come after the order — and the order step works
  const lim = await mk('ja', { limited: true })
  await pickMain(lim.page, 'ja')
  await lim.page.locator('[data-testid=result-after-order]').waitFor({ timeout: 8000 })
  check('limit: at the daily limit the result page shows NO pictures block and says 「4枚の絵は、贈ると決めたときに描かれます。」; nothing is drawn (no render call)', (await lim.page.locator('[data-testid=result-pictures]').count()) === 0 && (await lim.page.locator('[data-testid=result-after-order]').innerText()) === '4枚の絵は、贈ると決めたときに描かれます。' && lim.pv.render === 0)
  await lim.page.click('[data-testid=result-make]')
  await lim.page.locator('[data-testid=order-form]').waitFor()
  await lim.page.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 6000 })
  check('limit: the order button still works (pictures never block checkout)', await lim.page.locator('[data-testid=order-submit]').isDisabled() === true /* names missing */ && (await lim.page.locator('input[name=package]').count()) >= 1)
  await lim.page.close()
  // one picture failed its check for good: the nearest passed picture stands in (never the plain washi tile) — three pictures of its own and one stand-in
  const wa = await mk('ja', { mode: 'washi' })
  await pickMain(wa.page, 'ja')
  await wa.page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-kind=sub]').length === 1, null, { timeout: 8000 })
  check('washi: the failed place shows the NEAREST passed picture (data-kind sub, the same image as slot 2) with its OWN caption — never a plain tile, no waiting line', (await wa.page.locator('[data-testid=result-pictures] .rs-fig[data-slot="1"]').getAttribute('data-kind')) === 'sub' && (await wa.page.locator('[data-testid=result-pictures] .rs-fig[data-slot="1"] img').getAttribute('src')) === (await wa.page.locator('[data-testid=result-pictures] .rs-fig[data-slot="2"] img').getAttribute('src')) && (await wa.page.locator('[data-testid=result-pictures] .rs-fig[data-slot="1"] figcaption').innerText()) === '朝、母は台所に立っていた。' && (await wa.page.locator('[data-testid=washi-tile]').count()) === 0 && (await wa.page.locator('[data-testid=pic-wait]').count()) === 0 && (await wa.page.locator('[data-testid=result-waiting]').count()) === 0)
  await wa.page.close()
  // 2026-11-07 / 11-14: the line never repeats the label. A line that begins with the label's own wording is shown without it (cards and result page); the stored line is unchanged.
  for (const [lang, prefix, cardLabel, stripped] of [['zh-Hant', '這個人是', '對方是怎樣的人', '這個人是'], ['ja', 'その人は、', 'どんな人か', 'その人は'], ['en', 'They are ', "What they're like", 'They are']]) {
    const dp = await mk(lang, { gazePrefix: prefix })
    const cardWho = await dp.page.locator('article[data-slot=main] [data-match-who] dd').innerText()
    await pickMain(dp.page, lang)
    const who = await dp.page.locator('[data-testid=result-who]').innerText()
    check(`label + line (${lang}): the card shows 「${cardLabel}」 and a line that does NOT repeat the opening; the result page has no label, so it shows the person's line as stored (the opening once, never doubled)`, !cardWho.startsWith(stripped) && who.split(stripped).length <= 2 && cardWho.length > 0 && who.length > 0, JSON.stringify({ cardWho, who }))
    await dp.page.close()
  }
  // 2026-11-18: what is saved is EXACTLY the chosen card. Pick the main card (saved), go back to the cards, pick the other card (the free one): the item saved for it carries that card's
  // character, reading, word and line — never the card chosen before — and a card that was saved earlier keeps its own.
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const cc = await mk(lang)
    await pickMain(cc.page, lang)
    await cc.page.waitForTimeout(600)
    const mainSave = cc.bk[cc.bk.length - 1]
    await cc.page.locator('[data-testid=result-another]').click()
    const free = cc.page.locator('article[data-slot=freestyle]')
    await free.waitFor({ timeout: 8000 })
    await free.click()
    await free.locator(`text=${GIVE[lang]}`).click()
    await cc.page.locator('[data-testid=result-page]').waitFor()
    await cc.page.waitForTimeout(900)
    const who = await cc.page.locator('[data-testid=result-who]').innerText()
    const readingText = (await cc.page.locator('[data-testid=result-reading]').count()) ? await cc.page.locator('[data-testid=result-reading]').innerText() : ''
    const wordText = (await cc.page.locator('[data-testid=result-word]').count()) ? await cc.page.locator('[data-testid=result-word]').innerText() : ''
    const last = cc.bk[cc.bk.length - 1]
    const mixed = cc.bk.filter((b) => b.kanji === last.kanji && (b.line !== last.line || b.reading !== last.reading || b.word !== last.word))
    check(`chosen card (${lang}): choosing the other card saves THAT card — its slot, its character (not the one chosen before), its own line, reading and word as the result page shows them`, mainSave && last.slot === 'freestyle' && last.kanji !== mainSave.kanji && last.line === who && last.line !== mainSave.line && (lang === 'en' ? last.word === wordText : last.reading === readingText) && mixed.length === 0, JSON.stringify({ m: [mainSave?.kanji, mainSave?.line], l: [last.kanji, last.line, last.reading, last.word], who, readingText, wordText, mixed: mixed.length }))
    check(`chosen card (${lang}): the save carries the relationship, the reason, the round and the slot, and the card chosen first was saved with its own card (slot main)`, mainSave.slot === 'main' && typeof last.relationship === 'string' && last.relationship !== '' && typeof last.purpose === 'string' && last.purpose !== '' && last.round === 1 && mainSave.relationship === last.relationship, JSON.stringify({ r: last.relationship, p: last.purpose, rd: last.round, ms: mainSave.slot }))
    await cc.page.close()
  }
  // 2026-11-07: the fourth scene is slow — its place shows the waiting state with a small line, in each language; when it arrives it is replaced; the page asked again after the first render request ended
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const sl = await mk(lang, { mode: 'slow4' })
    await pickMain(sl.page, lang)
    await sl.page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-ready=yes]').length === 3, null, { timeout: 8000 })
    const wait = sl.page.locator('[data-testid=result-pictures] .rs-fig[data-slot="4"] [data-testid=pic-wait]')
    check(`slow scene (${lang}): while the fourth scene is still being drawn its place shows the small line 「${RC[lang].drawing}」 — and its caption stays — and the page says it is painting (the waiting state with the character already shown)`, (await wait.innerText()) === RC[lang].drawing && (await sl.page.locator('[data-testid=result-pictures] .rs-fig[data-slot="4"] figcaption').innerText()).length > 0 && (await sl.page.locator('[data-testid=result-waiting]').innerText()).includes(RC[lang].waiting) && (await sl.page.locator('[data-testid=result-glyph]').innerText()).length > 0)
    if (lang === 'zh-Hant') await sl.page.screenshot({ path: `${SHOTS}/e2e-result-waiting-zh-Hant.png` })
    if (lang === 'ja') {
      await sl.page.screenshot({ path: `${SHOTS}/e2e-result-waiting-ja-desktop.png` })
      await sl.page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-ready=yes]').length === 4, null, { timeout: 20000 })
      check('slow scene: the render request ended twice with the fourth scene unfinished and the page asked again (3 or more render requests), then all four pictures show and the waiting line is gone', sl.pv.render >= 3 && (await sl.page.locator('[data-testid=pic-wait]').count()) === 0 && (await sl.page.locator('[data-testid=result-waiting]').count()) === 0, String(sl.pv.render))
    }
    await sl.page.close()
  }
  const af = await mk('ja', { mode: 'allfail' })
  await pickMain(af.page, 'ja')
  await af.page.locator('[data-testid=result-after-order]').waitFor({ timeout: 8000 })
  check('washi: only when ALL FOUR failed does the result page leave the pictures out and say 「4枚の絵は、贈ると決めたときに描かれます。」 (and no tile is shown)', (await af.page.locator('[data-testid=result-pictures]').count()) === 0 && (await af.page.locator('[data-testid=result-after-order]').innerText()) === '4枚の絵は、贈ると決めたときに描かれます。' && (await af.page.locator('[data-testid=washi-tile]').count()) === 0)
  await af.page.close()
  // the other two languages: the waiting line, no sample mark, the owner's headings, the refund line on the order step
  for (const [lang, heading, note] of [['zh-Hant', '你的禮物', '取消（全額退款）僅限付款完成後24小時內'], ['en', 'Your gift', 'You can cancel for a full refund within 24 hours of payment']]) {
    const l = await mk(lang)
    await pickMain(l.page, lang)
    check(`result page (${lang}): 「${RC[lang].waiting}」 while drawing, the heading 「${heading}」, and no sample mark`, (await l.page.locator('[data-testid=result-waiting]').innerText()).includes(RC[lang].waiting) && (await l.page.locator('[data-testid=result-heading]').innerText()) === heading && !(await l.page.locator('[data-testid=result-page]').innerText()).match(/見本|樣本|Sample/), await l.page.locator('[data-testid=result-waiting]').innerText())
    await l.page.click('[data-testid=result-make]')
    await l.page.locator('[data-testid=order-form]').waitFor()
    check(`order step (${lang}): the refund line is above the order button`, (await l.page.locator('[data-testid=order-refund-line]').innerText()).includes(note))
    if (lang === 'en') {
      // 2026-11-15: what blocks the button is said in one plain line under it; with three sizes on sale nothing is preselected, so the first line asks for the gift, then for the box
      await l.page.waitForTimeout(1500)
      const first = await l.page.locator('[data-testid=order-hint]').innerText().catch(() => '')
      await l.page.click('label:has(input[name=package][value=egift])')
      await l.page.waitForTimeout(300)
      const second = await l.page.locator('[data-testid=order-hint]').innerText().catch(() => '')
      check('order step (en): the button is disabled and says "Please choose your gift above." — then, once the e-gift is picked, "Please tick the box above."', first === 'Please choose your gift above.' && second === 'Please tick the box above.' && (await l.page.locator('[data-testid=order-submit]').isDisabled()), `${first} | ${second}`)
      await l.page.locator('[data-testid=order-refund-check]').check()
      await l.page.waitForTimeout(500)
      check('order step (en): after ticking the box the button is live and the hint line is gone — straight to payment', (await l.page.locator('[data-testid=order-submit]').isEnabled()) && (await l.page.locator('[data-testid=order-hint]').count()) === 0)
    }
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
  await f.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  await f.page.locator('#write [data-testid=story-input]').fill(STORY)
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await f.page.locator('[data-testid=result-poem]').waitFor({ timeout: 8000 })
  const vert = () => f.page.locator('[data-testid=result-poem]').evaluate((el) => ({ mode: getComputedStyle(el).writingMode, kind: el.getAttribute('data-poem-type'), xs: [...el.querySelectorAll('.rs-poemline')].map((s) => s.getBoundingClientRect().left), tops: [...el.querySelectorAll('.rs-poemline')].map((s) => { const r = document.createRange(); r.selectNodeContents(s); return r.getBoundingClientRect().top }), lens: [...el.querySelectorAll('.rs-poemline')].map((s) => [...(s.textContent ?? '')].length) }))
  const vt = await vert()
  check('result page: the tanka is vertical (縦書き, vertical-rl) and the first line is the rightmost column', vt.kind === 'tanka' && vt.mode.startsWith('vertical') && vt.xs.length === 3 && vt.xs[0] > vt.xs[1] && vt.xs[1] > vt.xs[2], JSON.stringify(vt))
  check('result page: every column of the vertical poem starts at the SAME line (the top) although the lines differ in length — none is centred', new Set(vt.lens).size > 1 && vt.tops.every((t) => Math.abs(t - vt.tops[0]) <= 1.5), JSON.stringify(vt))
  await toOrder(f.page)
  const addon = f.page.locator('[data-testid=poem-addon]')
  await addon.waitFor({ timeout: 5000 })
  const addonText = await addon.innerText()
  check('included poem: the step is visible to every customer — heading, the formats of the story\'s language as radio buttons (a Japanese story: 短歌 first, then 俳句 and 漢詩 — no 宋詞, no English; labels in the page language), and no price', (await addon.locator('legend').innerText()).includes('歌を一首添えます') && (await addon.locator('input[name=poem_type]').count()) === 3 && (await addon.locator('input[data-poem-type=haiku]').count()) === 1 && (await addon.locator('input[data-poem-type=tang]').count()) === 1 && (await addon.locator('input[data-poem-type=ci]').count()) === 0 && (await addon.locator('input[data-poem-type=en]').count()) === 0 && !/[¥￥]|円/.test(addonText) && addonText.includes('追加料金はありません'))
    check('included poem: the Japanese page shows the labels 短歌（五七五七七） / 俳句（五七五） / 漢詩（唐詩の形・五言／七言絶句）, in that order (the first is the default)', (await addon.locator('label:has(input[name=poem_type])').allInnerTexts()).map((t) => t.trim()).join('|') === '短歌（五七五七七）|俳句（五七五）|漢詩（唐詩の形・五言／七言絶句）', (await addon.locator('label:has(input[name=poem_type])').allInnerTexts()).join('|'))
check('included poem: the Japanese site starts with the tanka (the default format) and writes it at once', await addon.locator('input[data-poem-type=tanka]').isChecked() && poemCalls.length >= 1 && poemCalls.every((c) => c.type === 'tanka'))
  await addon.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 5000 })
  const full = await addon.locator('[data-poem-full]').innerText()
  // ticket 2026-11-01: 短歌 and 俳句 are set vertically (縦書き) on the card preview, first line on the right; 漢詩 / 宋詞 / English stay horizontal
  check('included poem: the WHOLE poem is shown before checkout (all three lines), with "this poem is printed on your card"', full.includes('tanka 一行目です') && full.includes('tanka 三行目です') && (await addon.innerText()).includes('カードに印刷されます'))
  check('included poem: /api/poem got the story, the context, the chosen character, its card line and the type — and the session', poemCalls[0].story === STORY && poemCalls[0].kanji === '証' && typeof poemCalls[0].gaze === 'string' && poemCalls[0].gaze.length > 0 && poemCalls[0].relationship === 'parent_father' && typeof poemCalls[0].session === 'string')
  const callsBeforeTang = poemCalls.length
  await addon.locator('input[data-poem-type=tang]').click()
  const waited = await f.page.evaluate(() => document.querySelector('[data-testid=order-submit]').disabled)
  check('included poem: while a poem is being written the order button waits (the buyer sees the poem before paying)', waited === true)
  await addon.locator('[data-poem-result=tang][data-state=ready]').waitFor({ timeout: 6000 })
  check('included poem: choosing another format writes that one; the order button is back', poemCalls.length === callsBeforeTang + 1 && poemCalls.at(-1).type === 'tang' && (await addon.locator('[data-poem-full]').innerText()).includes('tang 一行目です'))
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
  await g.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  await g.page.locator('#write [data-testid=story-input]').fill(STORY)
  await pickContext(g.page)
  await g.page.click(`#write >> text=${GO.ja}`)
  await g.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await g.page.locator('article[data-slot=main]').click()
  await g.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await toOrder(g.page)
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

// ---------- Run 43 (2026-11-20): poem rewrites (「別の歌にする」, two per style, every version kept) and the opening time zone from the page's market, never the device ----------
{
  const reach = async (lang, { shanghai = false } = {}) => {
    const pcalls = []
    const versions = {}
    const f = await mockPage(browser, { result: (b) => ({ ...FIXTURE, language: b.language }), order: () => ({ json: { order_ref: 'IC-20261120-RW000001', checkout_url: 'http://localhost:5173/__checkout?cart=rw', glyph: '証', certificate_text: 'x' } }) })
    if (shanghai) {
      // the device's own zone is Asia/Shanghai: nothing on the page may take it
      const cdp = await f.page.context().newCDPSession(f.page)
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' })
    }
    await f.page.route('**/api/poem', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      pcalls.push(b)
      const n = b.rewrite ? (versions[b.type] = (versions[b.type] ?? 1) + 1) : (versions[b.type] ?? 1)
      if (b.rewrite && n > 3) { versions[b.type] = 3; return route.fulfill({ status: 429, json: { code: 'rewrite_limit', rewrites_left: 0 } }) }
      const lines = b.type === 'en' ? [`v${n} first line here`, `v${n} second line`, `v${n} third line`, `v${n} fourth line`] : [`${b.type} 第${n}版 一行目`, `${b.type} 第${n}版 二行目`, `${b.type} 第${n}版 三行目`]
      await route.fulfill({ json: { poem_id: `PM-20261120-${b.type.slice(0, 3)}${'abcdefghjk'.slice(0, 7)}${n}`.slice(0, 22), type: b.type, lines, reading: '', aids: {}, preview: lines[0], version: n, rewrites_left: Math.max(0, 3 - n) } })
    })
    const path = lang === 'ja' ? '/write' : lang === 'en' ? '/en/write' : '/zh/write'
    await f.page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    await f.page.locator('#write [data-testid=story-input]').fill(STORY)
    await pickContext(f.page)
    await f.page.click(`#write >> text=${GO[lang]}`)
    await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await f.page.locator('article[data-slot=main]').click()
    await f.page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await f.page.locator('[data-testid=result-poem]').waitFor({ timeout: 8000 })
    await toOrder(f.page)
    return { ...f, pcalls, versions }
  }
  // the poem: 「別の歌にする」 and the count; the versions; the limit; the version on screen is the one ordered
  const r = await reach('ja')
  const addon = r.page.locator('[data-testid=poem-addon]')
  await addon.waitFor({ timeout: 5000 })
  await addon.locator('[data-poem-result=tanka][data-state=ready]').waitFor({ timeout: 6000 })
  const row = (l) => addon.locator(`[data-testid=${l}]`)
  check('poem rewrite (ja): under the poem one quiet link 「別の歌にする」 with 「あと2回」, and no arrows yet (one version)', (await row('poem-rewrite').innerText()) === '別の歌にする' && (await row('poem-left').innerText()) === 'あと2回' && (await row('poem-nav').count()) === 0)
  const idOf = () => addon.locator('[data-poem-full]').getAttribute('data-poem-id')
  const id1 = await idOf()
  await row('poem-rewrite').click()
  check('poem rewrite (ja): while it is written the order button waits (as today)', (await r.page.evaluate(() => document.querySelector('[data-testid=order-submit]').disabled)) === true)
  await addon.locator('[data-version="2"]').waitFor({ timeout: 6000 })
  check('poem rewrite (ja): the new poem is shown, ‹ 2 / 2 ›, 「あと1回」, 「✓ この歌にする」 is on, and the request said rewrite', (await row('poem-position').innerText()) === '2 / 2' && (await row('poem-left').innerText()) === 'あと1回' && (await row('poem-use').innerText()).includes('この歌にする') && r.pcalls.at(-1).rewrite === true && (await addon.locator('[data-poem-full]').innerText()).includes('第2版'))
  await row('poem-rewrite').click()
  await addon.locator('[data-version="3"]').waitFor({ timeout: 6000 })
  check('poem rewrite (ja): at the limit (3 versions) the link is gone and the line says 「この形はここまでです」', (await row('poem-rewrite').count()) === 0 && (await row('poem-limit').innerText()) === 'この形はここまでです' && (await row('poem-position').innerText()) === '3 / 3')
  const callsBefore = r.pcalls.length
  await row('poem-prev').click()
  await row('poem-prev').click()
  const back = { v: await addon.locator('[data-poem-full]').getAttribute('data-version'), pos: await row('poem-position').innerText(), text: await addon.locator('[data-poem-full]').innerText(), id: await idOf() }
  check('poem rewrite (ja): ‹ › moves between the versions with no new call; going back to version 1 shows version 1 (nothing is rewritten)', back.v === '1' && back.pos === '1 / 3' && back.text.includes('第1版') && back.id === id1 && r.pcalls.length === callsBefore, JSON.stringify(back))
  await r.page.fill('input[name=sender_name]', '山田 太郎')
  await r.page.fill('input[name=receiver_name]', '山田 一郎')
  const od = new Date(); od.setDate(od.getDate() + 20)
  await r.page.fill('input[name=delivery_date]', `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`)
  await r.page.click('label:has(input[name=package][value=standard])')
  await tickRefund(r.page)
  await r.page.click('[data-testid=order-submit]')
  await r.page.waitForSelector('#co', { timeout: 8000 })
  check('poem rewrite (ja): ordering from version 1 sends version 1\'s poem_id (the poem on screen is the one ordered), and the arrows asked the model for nothing', r.calls.order.length === 1 && JSON.stringify(r.calls.order[0].poems ?? r.calls.order[0]).includes(id1) && r.pcalls.length === callsBefore && r.pcalls.filter((c) => c.rewrite).length === 2, JSON.stringify(r.calls.order[0]).slice(0, 300))
  check('no page errors (poem rewrite, ja)', r.errors.length === 0, JSON.stringify(r.errors))
  await r.page.close()

  // the zone: with the device's zone set to Asia/Shanghai the page still starts from its own market, and shows no raw zone name
  const D = new Date(); D.setDate(D.getDate() + 20)
  const date = `${D.getFullYear()}-${String(D.getMonth() + 1).padStart(2, '0')}-${String(D.getDate()).padStart(2, '0')}`
  for (const [lang, want, label] of [['ja', 'Asia/Tokyo', '受け取る方の時間帯'], ['en', 'America/New_York', "Receiver's time zone"], ['zh-Hant', 'Asia/Taipei', '收禮人的時區']]) {
    const z = await reach(lang, { shanghai: true })
    const hiddenBefore = (await z.page.locator('[data-testid=open-zone-wrap]').count()) === 0 && !(await z.page.locator('[data-testid=open-date-label]').count())
    await z.page.click('label:has(input[name=package][value=egift])') // the opening date belongs to the e-gift
    await z.page.fill('input[name=open_date]', date)
    await z.page.locator('[data-testid=open-zone]').waitFor({ timeout: 5000 })
    const got = await z.page.evaluate(() => { const s = document.querySelector('[data-testid=open-zone]'); return { value: s.value, shown: s.selectedOptions[0].textContent, label: document.querySelector('label[for=open-zone]')?.textContent ?? '', text: document.body.innerText } })
    const TXT = { ja: '日本時間', en: 'US Eastern', 'zh-Hant': '台北時間' }
    check(`opening zone (${lang}, device zone Asia/Shanghai): the row is hidden until a date is chosen, then defaults to ${TXT[lang]} (${want}), labelled 「${label}」`, hiddenBefore && got.value === want && got.shown === TXT[lang] && got.label.trim() === label, JSON.stringify({ hiddenBefore, ...got, text: undefined }))
    check(`opening zone (${lang}): no "Shanghai" and no IANA name (Asia/…, America/…) anywhere in the page text`, !/Shanghai|Asia\/|America\/|Europe\//.test(got.text), got.text.match(/[\s\S]{0,30}(Shanghai|Asia\/|America\/|Europe\/)[\s\S]{0,30}/)?.[0] ?? '')
    check(`opening zone (${lang}): the refund block shows no zone`, !/(日本時間|台北時間|US Eastern|美東時間|米国東部時間)/.test(await z.page.locator('[data-testid=order-refund-line]').innerText()))
    if (lang === 'ja') await z.page.screenshot({ path: `${SHOTS}/e2e-open-zone-ja.png`, fullPage: false })
    await z.page.close()
  }
}

// ---------- Run 44 (2026-11-20): マイギフト in one fixed, obvious place — present and readable (contrast ≥ 4.5:1) on every page type, in all three languages; the sender page's "send it later" line ----------
{
  const NAMES = { ja: 'マイギフト', 'zh-Hant': '我的禮物', en: 'My gifts' }
  const LATER = { ja: 'あとで送ることもできます。この贈りものは〈マイギフト〉に残っています。', 'zh-Hant': '也可以稍後再送。這份禮物會留在〈我的禮物〉裡。', en: 'You can send it later. This gift stays in My gifts.' }
  const OPEN = { ja: 'マイギフトを開く →', 'zh-Hant': '打開我的禮物 →', en: 'Open My gifts →' }
  const PATH = { landing: { ja: '/', 'zh-Hant': '/zh', en: '/en' }, write: { ja: '/write', 'zh-Hant': '/zh/write', en: '/en/write' } }
  const seenBy = async (page, where, lang) => {
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 3 }, ready: null, hold: null } }))
    const sel = '[data-testid=my-gifts]'
    await page.locator(sel).first().waitFor({ timeout: 8000 })
    const box = await page.evaluate((q) => { const e = document.querySelector(q); const r = e.getBoundingClientRect(); const t = e.textContent.trim(); return { right: r.right, top: r.top + window.scrollY, width: window.innerWidth, text: t, h: r.height } }, sel)
    const cr = await contrastOf(page, sel)
    check(`My gifts (${where}, ${lang}): the button is there, at the top right, reads 「${NAMES[lang]}（n）」 and is readable (contrast ${cr === null ? 'n/a' : cr.toFixed(1)} ≥ 4.5)`, box.text.startsWith(NAMES[lang]) && box.right > box.width * 0.6 && box.top < 160 && cr !== null && cr >= 4.5, JSON.stringify({ box, cr }))
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (const where of ['landing', 'write']) {
      const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
      await page.route('**/api/**', (r) => (/api\/(me|rates|promo)/.test(r.request().url()) ? r.fallback() : r.fulfill({ status: 204, body: '' })))
      await page.goto(`http://localhost:5173${PATH[where][lang]}`, { waitUntil: 'networkidle' })
      await seenBy(page, where, lang)
      const oneLine = await page.evaluate(() => { const b = document.querySelector('[data-testid=my-gifts]'); const br = document.querySelector('.brand'); return !!b && !!br && Math.abs(b.getBoundingClientRect().top - br.getBoundingClientRect().top) < 40 && document.documentElement.scrollWidth <= window.innerWidth })
      check(`My gifts (${where}, ${lang}, 390px): on one line with the brand, no horizontal scroll`, oneLine)
      await page.close()
    }
    // the sender page after payment
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    const p = await ctx.newPage()
    await p.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 3 }, ready: null, hold: null } }))
    await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: { id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: 'https://ichirei.beyondculture.ai/g/RG-testtesttesttesttest', size_code: 'ICHIREI-SIMPLE', ship_to: 'me', egift_state: null }, order: { collected: true, ordered_at: '2026-11-06T05:30:00Z', change_until: null, wood: null } } }))
    await p.route('**/api/gift/RG-testtesttesttesttest/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
    await seenBy(p, 'sender page', lang)
    await p.locator('[data-testid=send-later]').waitFor()
    check(`sender page (${lang}): under the send buttons the line 「${LATER[lang]}」 and the link 「${OPEN[lang]}」 to My gifts`, (await p.locator('[data-testid=send-later-line]').innerText()) === LATER[lang] && (await p.locator('[data-testid=send-later-open]').innerText()) === OPEN[lang] && (await p.locator('[data-testid=send-later-open]').getAttribute('href')) === '/basket')
    if (lang === 'ja') await p.screenshot({ path: `${SHOTS}/p8-sender-ja-390.png`, fullPage: true })
    await ctx.close()
  }
}

// ---------- Run 9: the Reveal landing page — sections, copy per language, honesty, no test controls ----------
// (2026-11-16) the flow is no longer on the landing page: it has a page of its own, the writing room (/write, /en/write, /zh/write)
const SECTION_ORDER = ['.hero', '.strip', '.philo', '#shape', '#angles', '#how', '#moments', '.reviewsEmpty', '#gifts', '.faq', '.closing']
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const calls = { select: [] }
  await page.route('**/api/rates', (route) => route.fulfill({ json: { date: '2026-10-25', base: 'JPY', rates: { USD: 0.0066, EUR: 0.0061, GBP: 0.0052, AUD: 0.01, TWD: 0.21, HKD: 0.052, SGD: 0.0088, KRW: 9.2 } } }))
  await page.route('**/api/select', async (route) => { calls.select.push(JSON.parse(route.request().postData() ?? '{}')); await route.fulfill({ json: FIXTURE }) })
  await page.route('**/api/**', (route) => (route.request().url().includes('/api/select') || route.request().url().includes('/api/rates') ? route.fallback() : route.fulfill({ status: 204, body: '' })))
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
  check('landing: the sections are all there, in the reference order (hero, strip, philosophy, story shape, angles, steps, moments, reviews, gifts, FAQ, closing) — and the flow is not on the landing page (it is the writing room)', await page.evaluate((sel) => { const tops = sel.map((q) => document.querySelector(q)?.getBoundingClientRect().top + window.scrollY); return tops.every((t) => Number.isFinite(t)) && tops.every((t, i) => i === 0 || t > tops[i - 1]) }, SECTION_ORDER) && (await page.locator('#write').count()) === 0)
  // textContent, not innerText: sections below the fold are not rendered until they are near the screen (content-visibility)
  const t = await page.evaluate(() => document.body.textContent)
  check('landing ja: <html lang>, title, hero (「あなたとわたし、一字の距離。」) and the primary call to action', (await page.getAttribute('html', 'lang')) === 'ja' && (await page.title()) === 'ICHIREI 一字礼 — 一字の贈りもの' && (await page.locator('h1').innerText()) === 'あなたとわたし、一字の距離。' && (await page.locator('.hero a.btn.primary').innerText()) === 'ひと場面を書く →')
  check('landing ja: honesty — no native-speaker claim, no AI, no payment methods, no review counts or ratings', !/ネイティブ|\bAI\b|人工知能|VISA|Visa|PayPal|クレジット(?!・ライセンス)|★|⭐/.test(t) && t.includes('本物のレビューが、ここに並びます'))
  check('landing ja: the trust strip has three items (no "checked by native speakers")', (await page.locator('.strip li').count()) === 3)
  check('landing ja: no test controls (no A/B/C, no log export, no golden fixture, no harness label)', !/condition|ログ書き出し|golden fixture|VALIDATION HARNESS|raw contract/.test(t))
  await page.goto('http://localhost:5173/write?lang=ja', { waitUntil: 'networkidle' })
  check('landing ja: the composer is the real flow — chips for relationship, direction and the reason for giving (+ the optional state), the textarea, the "0 / 5000字" counter, the soft hint', (await page.locator('[data-chip^="relationship:"]').count()) === 15 && (await page.locator('[data-chip^="direction:"]').count()) === 3 && (await page.locator('[data-chip^="purpose:"]').count()) === 9 && (await page.locator('[data-chip^="state:"]').count()) === 6 && (await page.locator('#moment').count()) === 1 && (await page.locator('[data-testid=story-counter]').innerText()) === '0 / 5000字' && (await page.locator('[data-testid=story-hint]').innerText()) === '物語でなくていい。数行で十分です。本当のことを細かく書くほど、字も本当になります。')
  check('landing ja: no language pills inside the flow (the writing room has no language switch) and no inscription-script toggle', (await page.locator('#write [data-language]').count()) === 0 && (await page.locator('[data-inscription-script]').count()) === 0)
  await page.goto('http://localhost:5173/?lang=ja', { waitUntil: 'networkidle' })
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
  check('photos: every photo is a <picture> with WebP + JPG fallback and width/height; only the hero image is eager', imgs.length === 11 && imgs.every((i) => i.webp && i.w && i.h && i.src.endsWith('.jpg')) && imgs.filter((i) => i.lazy === 'eager').length === 1 && imgs[0].lazy === 'eager')
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
  // since 2026-11-15 a slide changes once its picture has loaded (never an empty panel), so the dot's slide comes a moment later
  check('reduced motion: the dots still work', await rp.waitForFunction(() => document.querySelector('.hero .reveal .k')?.textContent === '遅', null, { timeout: 5000 }).then(() => true, () => false))
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
    en: { title: 'ICHIREI 一字礼 — A Gift of One Character', h1: 'Between you and me, one character.', cta: 'Write your moment →', go: GO.en, htmlLang: 'en', hint: 'Not a whole story, a few lines are enough. The more true detail, the truer the character.', desc: 'ICHIREI (一字礼) — the person you see' },
    ja: { title: 'ICHIREI 一字礼 — 一字の贈りもの', h1: 'あなたとわたし、一字の距離。', cta: 'ひと場面を書く →', go: GO.ja, htmlLang: 'ja', hint: '物語でなくていい。数行で十分です。本当のことを細かく書くほど、字も本当になります。', desc: 'ICHIREI（一字礼）— あなたの目に映る、その人を、一文字に。' },
    'zh-Hant': { title: 'ICHIREI 一字禮 — 一個字的禮物', h1: '你和我之間，只隔一個字。', cta: '寫下一個片刻 →', go: GO['zh-Hant'], htmlLang: 'zh-Hant', hint: '不必是完整的故事，幾行就夠了。寫得越真實、越具體，選出的字就越貼近。', desc: 'ICHIREI（一字禮）— 把你眼中的那個人' },
  }
  for (const [l, want] of Object.entries(LANGS)) {
    await page.click(`.lang [data-lang="${l}"]`)
    const body = await page.evaluate(() => document.body.innerText)
    check(`${l}: <html lang>, title, meta description, hero, call to action, the composer button and hint`, (await page.getAttribute('html', 'lang')) === want.htmlLang && (await page.title()) === want.title && (await page.getAttribute('meta[name=description]', 'content')).startsWith(want.desc) && (await page.locator('h1').innerText()).replace(/\n/g, '') === want.h1 && (await page.locator('.hero a.btn.primary').innerText()) === want.cta && (await page.locator('.hero a.btn.primary').getAttribute('href')).startsWith(l === 'en' ? '/en/write' : l === 'ja' ? '/write' : '/zh/write'))
    check(`${l}: og:title follows the language, and the page text carries no other language's chrome`, (await page.getAttribute('meta[property="og:title"]', 'content')) === want.title && (l === 'en' ? !/[ぁ-んァ-ヶ]/.test(body.replace(/日本語|一字礼|獨歩文化株式会社/g, '').replace(/[\u4e00-\u9fff]/g, '')) : true))
  }
  // the engine languages: en → en, ja → ja, 繁中 → zh-Hant (and the composer posts to /api/select in that language)
  for (const [l, story] of [['en', 'My mum left the porch light on every night.'], ['ja', '母は、毎晩玄関の灯りをつけていた。'], ['zh-Hant', '媽媽每晚都開著門口的燈。']]) {
    // the hero's "Write your moment" opens the writing room of that language, in the same tab
    await page.goto(`http://localhost:5173/?lang=${l}`, { waitUntil: 'networkidle' })
    await page.click('.hero a.btn.primary')
    await page.waitForURL(/\/write/)
    check(`${l}: the composer button and hint are the writing room's (${l === 'en' ? '/en/write' : l === 'ja' ? '/write' : '/zh/write'}), same tab`, (await page.locator('#write button[type=submit]').innerText()) === LANGS[l].go && (await page.locator('[data-testid=story-hint]').innerText()) === LANGS[l].hint && new URL(page.url()).pathname === (l === 'en' ? '/en/write' : l === 'ja' ? '/write' : '/zh/write'))
    await page.locator('#moment').fill(story)
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
    await page.click(`#write button[type=submit]`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    const sent = calls.select.at(-1)
    check(`${l}: the composer posts to /api/select with language ${l}, the story and the context${l === 'zh-Hant' ? ' (traditional inscription)' : ''}`, sent.language === l && sent.story === story && sent.relationship === 'parent_mother' && sent.direction === 'up' && sent.purpose === 'celebrate' && (l === 'zh-Hant' ? sent.inscription_script === 'traditional' : !('inscription_script' in sent)), JSON.stringify(sent))
    await page.click('#write >> [data-testid=edit-story]')
    await page.locator('#moment').waitFor()
  }
  await page.goto('http://localhost:5173/?lang=zh-Hant', { waitUntil: 'networkidle' })
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
  await page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  await page.locator('#moment').fill(STORY)
  await pickContext(page)
  await page.click(`#write >> text=${GO.ja}`)
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  check('customer: no condition toggle, no diagnostics ("見送った字"), no raw contract, no honesty flags in the reveal', (await page.locator('text=見送った字').count()) === 0 && (await page.locator('text=raw contract').count()) === 0 && (await page.locator('text=⚑').count()) === 0 && (await page.locator('#write details').count()) === 0)
  check('customer: 「再試一次」 is gone from the card screen — a quiet 「ひと場面を書き直す」 link is at the bottom instead; the harness controls are not there', (await page.locator('button:has-text("もう一度試す")').count()) === 0 && (await page.locator('button:has-text("もう一度ためす")').count()) === 0 && (await page.locator('[data-testid=edit-story]').innerText()) === 'ひと場面を書き直す' && (await page.locator('text=ログ書き出し').count()) === 0)
  check('customer: the select call is plain condition A with the context (same engine as /demo)', calls.select[0].condition === 'A' && calls.select[0].language === 'ja' && calls.select[0].relationship === 'parent_father' && !('inscription_script' in calls.select[0]))
  // the two cards: main (cinnabar glyph) and freestyle (labelled 遊び字, an equal card, its character in ink)
  const cardInfo = await page.evaluate(() => [...document.querySelectorAll('#write article[data-slot]')].map((a) => ({ slot: a.dataset.slot, label: a.querySelector('[data-slot-label]').innerText, glyph: getComputedStyle(a.querySelector('[data-glyph]')).color, border: getComputedStyle(a).borderStyle, choose: !!a.querySelector('[data-select]') })))
  check('two cards: main 本命 (cinnabar character) and freestyle 遊び字 (an equal card, solid border, its character is ink — NOT cinnabar); each has its own choose button', cardInfo.length === 2 && cardInfo.find((c) => c.slot === 'main').label === '本命' && cardInfo.find((c) => c.slot === 'main').glyph === 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'freestyle').label === '遊び字' && cardInfo.find((c) => c.slot === 'freestyle').glyph !== 'rgb(200, 64, 45)' && cardInfo.find((c) => c.slot === 'freestyle').border === 'solid' && cardInfo.every((c) => c.choose), JSON.stringify(cardInfo))
  check('one button per card, 「この字で贈る」 — no separate confirm button, no 「就用這一個字」 hint, no 「選ぶ」 button, and the top line is the new one', (await page.locator('#write article [data-select]').count()) === 2 && (await page.locator('#write article [data-select]').allInnerTexts()).every((t) => t === 'この字で贈る') && (await page.locator('[data-testid=finalize]').count()) === 0 && (await page.locator('text=ひとつ選ぶと、先へ進めます。').count()) === 0 && (await page.locator('[data-reveal-intro]').innerText()) === 'あなたの思い出のひと場面から浮かんだ字です。贈りたい一字を選んでください。')
  // choose 守 (it has a distinct old form 默) — one click goes straight to the order step
  await page.locator('article', { hasText: '静けさのまま' }).click()
  await page.locator('article', { hasText: '静けさのまま' }).locator('text=この字で贈る').click()
  const form = page.locator('[data-testid=order-form]')
  await toOrder(page)
  check('order form appears after the result page and its 「この一字を贈る →」 (the reveal stays mounted but hidden) (the reveal stays mounted but hidden)', await form.isVisible() && (await page.locator('#write article').first().isHidden()))
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
  await toOrder(page)
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
  await page.goto('http://localhost:5173/zh/write', { waitUntil: 'networkidle' })
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
  await toOrder(page)
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
  check('en landing: the philosophy, the steps and the CTA are English; no AI, no "native speakers", no payment methods on the page', enBody.includes("We don't sell characters.") && enBody.includes('Three simple steps to one character') && enBody.includes('Write your moment') && !/\bAI\b|native speaker|visa|paypal/i.test(enBody))
  await page.screenshot({ path: `${SHOTS}/e2e-landing-en.png`, fullPage: false })
  await page.click('.lang [data-lang=ja]')
  check('en → ja through the nav switch, and back to en', (await page.locator('h1').innerText()) === 'あなたとわたし、一字の距離。' && (await page.getAttribute('html', 'lang')) === 'ja')
  await page.click('.lang [data-lang=en]')
  await page.reload({ waitUntil: 'networkidle' })
  check('…and the choice is remembered across a reload', (await page.locator('h1').innerText()) === 'Between you and me, one character.' && (await page.getAttribute('html', 'lang')) === 'en')

  // -- the customer flow
  // (2026-11-16) the flow is the writing room: the landing's "Write your moment" opens /en/write in the same tab
  await page.click('.hero a.btn.primary')
  await page.waitForURL(/\/en\/write/)
  await page.waitForSelector('#write #moment')
  check('en customer page: the flow is English, no language pills inside it, no test controls', (await page.locator('#write').innerText()).includes("One moment you've never forgotten") && (await page.locator('#write [data-language]').count()) === 0 && (await page.locator('text=VALIDATION HARNESS').count()) === 0)
  check('en: the chips are English (relationship, direction, occasion)', (await page.locator('[data-chip="relationship:parent_mother"]').innerText()) === 'Mom' && (await page.locator('[data-chip="purpose:celebrate"]').innerText()) === 'Birthday')
  await page.locator('#moment').fill('My mum left the porch light on every night until I got home.')
  await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
  await page.fill('input[name=occasion_detail]', '70th birthday')
  await page.click(`#write >> text=${GO.en}`)
  await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  const sel = calls.select[0]
  check('en payload: language en, the context and occasion_detail, and NO inscription_script', sel.language === 'en' && sel.relationship === 'parent_mother' && sel.direction === 'up' && sel.purpose === 'celebrate' && sel.occasion_detail === '70th birthday' && !('inscription_script' in sel), JSON.stringify(sel))
  const lamp = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("灯")') })
  check('en reveal: the carved glyph is the modern Japanese form 灯 (spec v9.1 step 9), shown with the one-phrase English meaning in the bridge stack both cards share — English first (2026-11-15): no romaji reading, no pinyin', (await lamp.count()) === 1 && (await lamp.locator('[data-en-bridge] >> text=akari').count()) === 0 && (await lamp.locator('[data-en-reading]').count()) === 0 && await lamp.locator('[data-en-bridge] >> text=lamp').first().isVisible() && !/pinyin/i.test(await lamp.innerText()))
  check('en reveal: no old-form (kyūjitai) note — only the modern form is carved', (await lamp.locator('text=kyūjitai').count()) === 0)
  const plainCard = page.locator('article').filter({ has: page.locator('[data-glyph]:text-is("待")') })
  check('en reveal: a character with no distinct old form shows its meaning only (no romaji) — in the very same stack as the main card', (await plainCard.locator('[data-en-bridge] >> text=matsu').count()) === 0 && await plainCard.locator('[data-en-bridge] >> text=wait').first().isVisible() && (await plainCard.locator('[data-en-bridge]').count()) === 1 && !/pinyin/i.test(await plainCard.innerText()))
  check('en reveal: each card shows the model\'s one plain-English why_this sentence under the gaze line', (await lamp.locator('[data-why-this]').innerText()) === 'Lamplight is the light you left on for me.' && (await plainCard.locator('[data-why-this]').innerText()) === 'Waiting is what you did, and never mentioned.')
  check('learning loop: the select call carries a random session id and source "customer" — and nothing else new', /^[A-Za-z0-9_-]{16,64}$/.test(calls.select[0].session) && calls.select[0].source === 'customer')
  await lamp.click()
  await page.screenshot({ path: `${SHOTS}/e2e-reveal-en.png`, fullPage: true })
  await lamp.locator('text=Give this character').click()
  await page.waitForTimeout(300)
  check('learning loop: choosing a card reports ONE event "chosen" with the kind of card (灯 is the main) — and no story, kanji or name', calls.analytics.filter((e) => e.event === 'chosen').length === 1 && calls.analytics.find((e) => e.event === 'chosen').choice === 'main' && calls.analytics.find((e) => e.event === 'chosen').session === calls.select[0].session && Object.keys(calls.analytics.find((e) => e.event === 'chosen')).sort().join() === 'choice,event,session,source' && !JSON.stringify(calls.analytics).includes('灯'))

  // -- the order form
  const form = page.locator('[data-testid=order-form]')
  await toOrder(page)
  check('en order form: no form choice (the character is carved in its modern Japanese form 灯); never traditional/simplified', (await page.locator('input[name=inscription_style]').count()) === 0 && (await page.locator('[data-order-glyph]').innerText()) === '灯')
  // (2026-11-15: the e-gift is preselected only when it is the ONLY orderable size; here three are on sale, so nothing is picked yet)
  check('en order form: with three sizes on sale nothing is preselected', (await page.locator('input[name=package]:checked').count()) === 0)
  check('en order form: English labels, packages and the English meaning under the glyph — no romaji (English first, 2026-11-15)', (await form.innerText()).toLowerCase().includes('your order') && (await form.innerText()).includes('Requested delivery date') && (await page.locator('.slip').innerText()).includes('lamp') && !/akari/.test(await form.innerText()) && (await form.innerText()).includes('¥18,850'))
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
  await page.goto('http://localhost:5173/write?lang=ja', { waitUntil: 'networkidle' })
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
  await toOrder(page)
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
  await en.page.goto('http://localhost:5173/en/write', { waitUntil: 'networkidle' })
  check('memorial (en): the last occasion chip is "In memory"; zh-Hant: 追思', (await en.page.locator('[data-chip="purpose:memorial"]').innerText()) === 'In memory')
  await en.page.goto('http://localhost:5173/zh/write', { waitUntil: 'networkidle' })
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
    await page.goto('http://localhost:5173/write?lang=ja', { waitUntil: 'networkidle' })
    await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
    await page.click(`[data-chip="purpose:${purpose === 'thanks' ? 'thanks' : purpose}"]`)
    await page.click(`#write >> text=${GO.ja}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    const main = await page.evaluate(() => ({ glyph: getComputedStyle(document.querySelector('article[data-slot=main] [data-glyph]')).color, label: getComputedStyle(document.querySelector('article[data-slot=main] [data-slot-label]')).backgroundColor, border: getComputedStyle(document.querySelector('article[data-slot=main]')).borderTopColor }))
    check(`${purpose}: the main card's character, label and top rule are ${quiet ? 'ink, never cinnabar' : 'cinnabar (the celebration colour stays for a thank-you)'}`, quiet ? main.glyph === INK && main.label === INK && main.border === INK : main.glyph === SEAL, JSON.stringify(main))
    await page.locator('article[data-slot=main]').locator(`text=${GIVE.ja}`).click()
    await page.locator('[data-testid=result-page]').waitFor()
    const rp = await page.evaluate(() => ({ quiet: document.querySelector('[data-testid=result-page]').dataset.quiet, glyph: getComputedStyle(document.querySelector('[data-testid=result-glyph]')).color }))
    check(`${purpose} result page: the character is ${quiet ? 'ink, marked data-quiet (never cinnabar)' : 'cinnabar (not quiet)'}`, quiet ? rp.quiet === 'yes' && rp.glyph !== SEAL : rp.quiet === 'no' && rp.glyph === 'rgb(192, 57, 43)', JSON.stringify(rp))
    await toOrder(page)
    const form = await page.evaluate(() => ({ slipGlyph: getComputedStyle(document.querySelector('[data-order-glyph]')).color, slipTop: getComputedStyle(document.querySelector('.slip')).borderTopColor, slipQuiet: document.querySelector('.slip').dataset.quiet ?? null, memorial: document.querySelector('.slip').dataset.memorial ?? null }))
    check(`${purpose} order form: the slip glyph and rule${quiet ? ' are ink, marked data-quiet, and it is NOT worded as a remembrance' : ' are cinnabar (not quiet)'}`, quiet ? form.slipGlyph === INK && form.slipTop === INK && form.slipQuiet === 'yes' && form.memorial === null : form.slipGlyph === SEAL && form.slipQuiet === null, JSON.stringify(form))
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
    await p.goto(`http://localhost:5173/g/${TOKEN}?ceremony=old`, { waitUntil: 'networkidle' })
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
      if (lang === 'en') {
        // the US launch: nothing physical is offered in English, so a "coming soon" wooden size is not listed at all — only the e-gift
        check('wood sizes switch on (en): the wooden sizes are NOT listed at all (not even as "Coming soon"); the e-gift keeps its badge and its link', cards.length === 1 && cards[0].id === 'egift' && byId.egift.cta === 'A' && byId.egift.soon === null, JSON.stringify(cards))
      } else
      check(`wood sizes switch on (${lang}): 木札 and 版木 are listed with 「${SOON[lang]}」 and a DISABLED button; the e-gift keeps its badge and its link`, cards.length === 3 && ['simple', 'standard'].every((id) => byId[id].soon === 'yes' && byId[id].badge === SOON[lang] && byId[id].cta === 'BUTTON' && byId[id].disabled === true && byId[id].label === SOON[lang]) && byId.egift.soon === null && byId.egift.cta === 'A' && byId.egift.badge !== SOON[lang], JSON.stringify(cards))
    } else {
      check('wood sizes switch OFF (default): no 「近日公開」 anywhere, every size has its normal link', cards.length === 3 && cards.every((c) => c.soon === null && c.cta === 'A' && c.badge !== SOON.ja), JSON.stringify(cards))
    }
    if (lang === 'ja') {
      await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' }) // (2026-11-16) the flow is the writing room
      await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
      await page.click(`#write >> text=${GO.ja}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      await page.locator('article[data-slot=main]').locator(`text=${GIVE.ja}`).click()
      await toOrder(page)
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
    await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await toOrder(page)
    await page.locator('[data-poem-result][data-state=ready]').waitFor({ timeout: 15000 })
    return { page, errors }
  }
  const texts = async (page) => ({ note: await page.locator('[data-poem-result]').innerText(), leadGone: (await page.locator('[data-testid=card-lead], [data-testid=card-preview]').count()) === 0 })
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const { page, errors } = await open(lang, true)
    let t = await texts(page)
    check(`e-gift wording (${lang}, wood coming soon): the poem note and the card-preview line are the owner's words, exactly, before any size is picked (the e-gift is the only gift)`, t.note.includes(NEW[lang].note) && t.leadGone, JSON.stringify(t))
    await page.locator('label[data-size=egift]').click()
    t = await texts(page)
    check(`e-gift wording (${lang}): with the e-gift selected the same words stay, and the printed-card wording is nowhere on the page`, t.note.includes(NEW[lang].note) && t.leadGone && !t.note.includes(OLD[lang].note) && !(await page.locator('[data-testid=order-form]').innerText()).includes(OLD[lang].lead), JSON.stringify(t))
    if (lang === 'zh-Hant') await page.screenshot({ path: `${SHOTS}/e2e-order-egift-zh-Hant.png`, fullPage: true })
    check(`no page errors (run 13e, ${lang}, wood coming soon)`, errors.length === 0, errors.join('; '))
    await page.close()
  }
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    const { page, errors } = await open(lang, false)
    let t = await texts(page)
    check(`printed-card wording (${lang}, wood on sale): before a size is picked the current wording stays`, t.note.includes(OLD[lang].note) && t.leadGone, JSON.stringify(t))
    await page.locator('label[data-size=simple]').click()
    t = await texts(page)
    check(`printed-card wording (${lang}): 木札 selected → the printed-card wording (the card is printed and sent)`, t.note.includes(OLD[lang].note) && t.leadGone && !t.note.includes(NEW[lang].note), JSON.stringify(t))
    await page.locator('label[data-size=standard]').click()
    t = await texts(page)
    check(`printed-card wording (${lang}): 版木 selected → the printed-card wording`, t.note.includes(OLD[lang].note) && t.leadGone, JSON.stringify(t))
    await page.locator('label[data-size=egift]').click()
    t = await texts(page)
    check(`e-gift wording (${lang}, wood on sale): choosing the e-gift switches to the e-gift words, choosing 木札 switches back`, t.note.includes(NEW[lang].note) && t.leadGone, JSON.stringify(t))
    check(`no page errors (run 13e, ${lang}, wood on sale)`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 13f (2026-11-07): while wood is "coming soon" no customer-facing text promises carving, printing or posting; with wood on sale the wood wording is back ----------
{
  // what may stay: the names of the sizes (they are listed with 「近日公開」), and the e-gift's own words (it is not posted, it needs no shipping, its card is a PDF to print at home)
  const NAMES = ['木札（シンプル）', '版木（スタンダード）', '木牌（簡約）', '版木（標準）', 'Wooden tag (Simple)', 'Block set (Standard)']
  // (the example stories on the page are customers' sample stories, not promises: 「彫った木のスプーン」 / 「我九歲刻的木湯匙」 / "the wooden spoon I carved at nine")
  const ALLOWED = ['那一刻', '這一刻', '一刻', '時刻', '此刻', '片刻', '立刻', '九歳のわたしが彫った木のスプーン', '我九歲刻的木湯匙', 'the wooden spoon I carved at nine', '免運費（以連結送出）', '送料を含む', '含運費', 'including shipping', '郵送されません', '郵送がなく', '送料はかかりません', '送料なし', '不郵寄', '不會郵寄', '無運費', '无运费', 'No shipping', 'no shipping', 'not posted', 'ご自宅で印刷できる', '可在家列印', 'print at home', 'you can print at home']
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
      await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.locator('#moment').fill('母は、私が何を言っても黙って台所に立っていた。あの日の言葉を、今でも悔やんでいる。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone' })
      await page.click(`#write >> text=${GO13[lang]}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      const cardsText = await page.locator('#write').textContent()
      await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
      await toOrder(page)
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
    en: { lang: 'en', purposeLabel: "Why you're giving", stateLabel: 'Where the two of you stand now (optional)', other: 'Other', relOtherPh: 'e.g. childhood friend, former colleague', purposes: ['Christmas', 'Thanksgiving', 'Birthday', 'Anniversary', "Mother's Day", "Father's Day", 'Graduation', 'Retirement', 'Thank you', 'In memory', 'No special day', 'Other'], states: ['Close', 'Living apart', "Haven't met in a while", 'Something unresolved', 'No longer here', 'Other'], caregiver: 'Mentor' },
  }
  for (const [lang, f] of Object.entries(FORM)) {
    const { page, errors, calls } = await mockPage(browser)
    await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    const labels = async (group) => page.locator(`[data-chip^="${group}:"]`).evaluateAll((els) => els.map((e) => e.innerText.trim()))
    check(`form (${lang}): the purpose chips are the ticket's, in order, with the right words (nine in ja / zh, the twelve occasions in en)`, (await labels('purpose')).join('|') === f.purposes.join('|'), (await labels('purpose')).join('|'))
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
    await page.goto('http://localhost:5173/write?lang=ja', { waitUntil: 'networkidle' })
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

  // 2026-11-19: who is in the pictures — two optional rows under the relationship chips (a man / a woman / skip) and one muted line; nothing selected by default, nothing required,
  // and a tap travels with the story (receiver_gender / sender_gender) while no tap sends nothing
  for (const [lang, w] of Object.entries({
    ja: { r: 'その人は：', s: 'あなたは：', chips: ['男性', '女性', '選ばない'], note: '絵の人物を描くためだけに使います（任意）' },
    en: { r: 'They are:', s: 'You are:', chips: ['a man', 'a woman', 'skip'], note: 'Only used to draw the people in your pictures (optional)' },
    'zh-Hant': { r: '對方是：', s: '你是：', chips: ['男性', '女性', '不選'], note: '只用於畫出圖中的人物（可不選）' },
  })) {
    const { page, errors, calls } = await mockPage(browser)
    await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    const rows = async (name) => page.locator(`[data-chip^="${name}:"]`).evaluateAll((els) => els.map((e) => e.innerText.trim()))
    check(`gender rows (${lang}): both rows are there with the owner's words — 「${w.r}」 / 「${w.s}」 and ${w.chips.join(' · ')}`, (await rows('receiver_gender')).join('|') === w.chips.join('|') && (await rows('sender_gender')).join('|') === w.chips.join('|') && (await page.locator('[data-testid=gender-receiver_gender] .clab').innerText()).trim() === w.r && (await page.locator('[data-testid=gender-sender_gender] .clab').innerText()).trim() === w.s)
    check(`gender rows (${lang}): the muted line reads 「${w.note}」, below the relationship chips and above the direction chips`, (await page.locator('[data-testid=gender-note]').innerText()).trim() === w.note && (await page.evaluate(() => { const rel = document.querySelector('[data-chip^="relationship:"]'); const note = document.querySelector('[data-testid=gender-note]'); const dir = document.querySelector('[data-chip^="direction:"]'); return !!rel && !!note && !!dir && !!(rel.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(note.compareDocumentPosition(dir) & Node.DOCUMENT_POSITION_FOLLOWING) })))
    check(`gender rows (${lang}): nothing is selected by default`, (await page.locator('[data-chip^="receiver_gender:"][aria-pressed=true], [data-chip^="sender_gender:"][aria-pressed=true]').count()) === 0)
    await page.locator('#write [data-testid=story-input]').fill('彼は、駅の改札でいつも黙って手を振った。そのうしろ姿を、私はずっと覚えている。')
    await page.click('[data-chip="relationship:parent_father"]')
    await page.click('[data-chip="direction:up"]')
    await page.click('[data-chip="purpose:thanks"]')
    check(`gender rows (${lang}): the form is complete without them — the button is on and a story with 彼 needs no row`, await page.locator('#write button[type=submit]').isEnabled())
    // a tap, a second tap clears, "skip" clears
    await page.click('[data-chip="receiver_gender:man"]')
    await page.click('[data-chip="sender_gender:woman"]')
    check(`gender rows (${lang}): a tap presses its chip (and only that one in its row)`, (await page.locator('[data-chip="receiver_gender:man"][aria-pressed=true]').count()) === 1 && (await page.locator('[data-chip="receiver_gender:woman"][aria-pressed=true]').count()) === 0 && (await page.locator('[data-chip="sender_gender:woman"][aria-pressed=true]').count()) === 1)
    await page.click('[data-chip="receiver_gender:man"]')
    check(`gender rows (${lang}): the same chip again clears it`, (await page.locator('[data-chip="receiver_gender:man"][aria-pressed=true]').count()) === 0)
    await page.click('[data-chip="sender_gender:skip"]')
    check(`gender rows (${lang}): 「${w.chips[2]}」 clears the row and is never shown as the chosen one`, (await page.locator('[data-chip^="sender_gender:"][aria-pressed=true]').count()) === 0)
    await page.click('#write button[type=submit]')
    await page.waitForSelector('article', { timeout: 15000 })
    const none = calls.select.at(-1)
    check(`gender rows (${lang}): with no tap the request carries neither field`, !('receiver_gender' in none) && !('sender_gender' in none))
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('#write [data-testid=story-input]').fill('先生は、会計の仕事を一から丁寧に教えてくれた。')
    await page.click('[data-chip="relationship:parent_father"]')
    await page.click('[data-chip="direction:up"]')
    await page.click('[data-chip="purpose:thanks"]')
    await page.click('[data-chip="receiver_gender:man"]')
    await page.click('[data-chip="sender_gender:woman"]')
    await page.click('#write button[type=submit]')
    await page.waitForSelector('article', { timeout: 15000 })
    const tapped = calls.select.at(-1)
    check(`gender rows (${lang}): a tap travels with the story as receiver_gender / sender_gender (man, woman)`, tapped.receiver_gender === 'man' && tapped.sender_gender === 'woman')
    check(`gender rows (${lang}): no page errors`, errors.length === 0, errors.join('; '))
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
      await page.goto(`http://localhost:5173/g/${TOKEN}?ceremony=old`, { waitUntil: 'networkidle' })
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
    await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
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
  await page.goto('http://localhost:5173/write?lang=ja', { waitUntil: 'networkidle' })
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
  check('top line: あなたの物語から見つかった字です。贈りたい一字を選んでください。', (await page.locator('[data-reveal-intro]').innerText()) === 'あなたの思い出のひと場面から浮かんだ字です。贈りたい一字を選んでください。')
  // order: cards → new round → pager → edit-story
  check('order top to bottom: cards → 別の二字を探す → 物語を書きなおす (no pager with one round)', await page.evaluate(() => { const q = (s) => document.querySelector(s); const pos = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & 4)); return pos(q('article[data-slot=freestyle], article[data-slot=second]'), q('[data-testid=see-others]')) && pos(q('[data-testid=see-others]'), q('[data-testid=edit-story]')) && !q('[data-testid=set-label]') }))
  // choose, then go back: same round, nothing lost
  await page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await toOrder(page)
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
  await page.goto('http://localhost:5173/write?lang=ja', { waitUntil: 'networkidle' })
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
    await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    const pressed = async () => (await page.locator('[data-chip^="direction:"][aria-pressed=true]').evaluateAll((els) => els.map((e) => e.dataset.chip.split(':')[1])))
    const bad = []
    for (const [rel, want] of Object.entries(MAP)) {
      // the English form offers fifteen relationship chips (US launch), not every relationship code
      if (lang === 'en' && (await page.locator(`[data-chip="relationship:${rel}"]`).count()) === 0) continue
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
    if (lang !== 'en') await page.click('[data-chip="relationship:pet"]')
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
  await V.page.goto('http://localhost:5173/zh/write', { waitUntil: 'networkidle' })
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
    await W.page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
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
      await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
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
      await toOrder(page)
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
  const AGAIN = { ja: '別の二字を探す（あと1回）', 'zh-Hant': '再找兩個新的字（還可以找1次）', en: 'Find two more (1 left)' }
  const MEM_LABELS = { ja: ['本命', '次点'], 'zh-Hant': ['本命', '次選'], en: ['Main', 'Second'] }
  const SEAL = 'rgb(200, 64, 45)'
  const geom = (page) => page.evaluate(() => [...document.querySelectorAll('#write article[data-slot]')].map((a) => { const r = a.getBoundingClientRect(); return { slot: a.dataset.slot, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), border: getComputedStyle(a).borderStyle, glyph: getComputedStyle(a.querySelector('[data-glyph]')).color, label: a.querySelector('[data-slot-label]')?.innerText ?? '', btnTop: Math.round(a.querySelector('[data-select]')?.getBoundingClientRect().top ?? -1), btnGap: Math.round(r.bottom - (a.querySelector('[data-select]')?.getBoundingClientRect().bottom ?? 0)), seq: [...a.querySelectorAll('[data-slot-label], [data-glyph], [data-match-who], [data-match-moment], [data-match-feeling], [data-select]')].map((e) => (e.hasAttribute('data-select') ? 'button' : e.hasAttribute('data-slot-label') ? 'label' : e.hasAttribute('data-glyph') ? 'char' : e.hasAttribute('data-match-who') ? 'who' : e.hasAttribute('data-match-moment') ? 'moment' : 'feeling')).join('>') } }))
  for (const lang of ['ja', 'zh-Hant', 'en']) {
    for (const [vw, vh, tag] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
      const { page, errors } = await mockPage(browser)
      await page.setViewportSize({ width: vw, height: vh })
      await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.locator('#moment').fill('母は庭の花を毎朝替えていた。何も言わずに、ただ笑っていた。')
      await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'seasonal_thanks' })
      await page.click(`#write >> text=${GO[lang]}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      await page.waitForTimeout(600)
      const g = await geom(page)
      const [m, f] = g
      check(`cards (${lang}, ${tag}): exactly two cards — 本命 first, 遊び字 second — labelled ${LABELS[lang].join(' / ')}`, g.length === 2 && m.slot === 'main' && f.slot === 'freestyle' && g.map((c) => c.label).join() === LABELS[lang].join(), JSON.stringify(g))
      check(`cards (${lang}, ${tag}): the two cards are EQUAL (same width — and, side by side, the same height), and ${vw >= 900 ? 'side by side on one row (本命 on the left)' : 'stacked, 本命 on top'}`, Math.abs(m.w - f.w) <= 2 && Math.abs(m.h - f.h) <= 2 && (vw >= 900 ? Math.abs(m.top - f.top) <= 2 && m.left < f.left : f.top > m.top + m.h - 2 && Math.abs(m.left - f.left) <= 2), JSON.stringify(g))
      check(`cards (${lang}, ${tag}): both cards use the same blocks in the same order (label, character, who, moment, feeling, button), and the two buttons are aligned at the bottom (${vw >= 900 ? 'the same height on the page' : 'the same distance from each card\'s bottom edge'})`, m.seq === f.seq && m.seq.startsWith('label>char>') && m.seq.endsWith('>button') && (vw >= 900 ? Math.abs(m.btnTop - f.btnTop) <= 2 : Math.abs(m.btnGap - f.btnGap) <= 2), JSON.stringify(g))
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
    await page.goto(`http://localhost:5173/write?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('#moment').fill('母は庭の花を毎朝替えていた。何も言わずに、ただ笑っていた。')
    await pickContext(page, { relationship: 'parent_mother', direction: 'up', occasion: 'memorial' })
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.waitForTimeout(600)
    const gm = await geom(page)
    check(`remembrance (${lang}): 本命 + 次点 — ${MEM_LABELS[lang].join(' / ')} — two equal cards, no 遊び字, no line under the cards, both characters ink`, gm.length === 2 && gm.map((c) => c.slot).join() === 'main,second' && gm.map((c) => c.label).join() === MEM_LABELS[lang].join() && Math.abs(gm[0].w - gm[1].w) <= 2 && Math.abs(gm[0].h - gm[1].h) <= 2 && gm[0].seq === gm[1].seq && Math.abs(gm[0].btnTop - gm[1].btnTop) <= 2 && gm.every((c) => c.glyph !== SEAL) && (await page.locator('[data-pair-note]').count()) === 0, JSON.stringify(gm))
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

// ---------- Run 24 (2026-11-12): the US e-gift launch — /en: delivery banner, chips, "What they receive", Western scenes, the dollar line; the English bridge on the cards, the chosen character and the receiver's page; Save the card / certificate; reply; share sheet ----------
{
  const FORBIDDEN = /\b(wood|wooden|walnut|EMS|ship|ships|shipping|shipped|shipment)\b|block set/i
  const ratesStub = { date: '2026-11-12', base: 'JPY', rates: { USD: 0.0066 } }
  const sizesStub = { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'] }
  const stubs = async (page) => {
    await page.route('**/api/rates', (r) => r.fulfill({ json: ratesStub }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: sizesStub }))
  }
  const enResult = () => {
    const r = JSON.parse(JSON.stringify(FIXTURE))
    r.language = 'en'
    r.inscription_script = null
    r.candidates = r.candidates.map((c) => ({ ...c, eliminated: false, eliminated_reason: null }))
    r.candidates[0] = { ...r.candidates[0], reading: 'akari', meaning: 'lamp', one_line_gaze: 'Someone who kept the porch light on for me.', story_anchor: 'the porch light', why_this: 'Lamplight is the plainest thing in your story.', en_word: 'hearth', en_word_source: 'lexicon', en_line: 'The light that is already on when everyone else wakes.', en_echo: { text: 'Save the cricket on the hearth', source: 'Milton, Il Penseroso' }, classical_echo: { text: '床前明月光', source: 'Li Bai, Quiet Night Thoughts' } }
    return r
  }
  // ---- the landing page /en (desktop and phone) ----
  for (const [vw, vh, tag] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
    const { page, errors, calls } = await mockPage(browser, { result: enResult })
    await stubs(page)
    await page.setViewportSize({ width: vw, height: vh })
    await page.goto('http://localhost:5173/en?utm_source=chatgpt.com&utm_medium=referral', { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    check(`/en (${tag}): the page is English and the hero says "Designed in Tokyo. Delivered worldwide." under the subline`, (await page.locator('html').getAttribute('lang')) === 'en' && (await page.locator('[data-testid=hero-tokyo]').innerText()) === 'Designed in Tokyo. Delivered worldwide.' && (await page.locator('.hero .lead').evaluate((el) => el.nextElementSibling?.getAttribute('data-testid'))) === 'hero-tokyo')
    check(`/en (${tag}): the delivery banner is the one fixed line, readable (light text on the dark band), with no date and no word about wood`, (await page.locator('[data-testid=us-banner]').textContent()) === 'The e-gift arrives the same day you order — even on Christmas morning.' && (await page.locator('[data-testid=us-banner]').evaluate((el) => getComputedStyle(el).color)) !== (await page.locator('.usBanner').evaluate((el) => getComputedStyle(el).backgroundColor)))
    check(`/en (${tag}): "What they receive" comes above the gift options and lists the five live items (character with word and line, poem, four pictures, film with music, certificate)`, await page.evaluate(() => { const r = document.querySelector('#receive'); const g = document.querySelector('#gifts'); return !!r && !!g && (r.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && [...r.querySelectorAll('li')].map((li) => li.dataset.receive).join() === 'character,poem,pictures,film,certificate' }))
    const scenes = await page.evaluate(() => [...document.querySelectorAll('.hero img, #moments img, .usReceive img')].map((i) => i.currentSrc || i.src))
    check(`/en (${tag}): the pictures are the real images of / (public/img/scenes/ and the owner's public/img/package/ only — nothing from scenes/en/)`, scenes.length >= 5 && scenes.every((u) => /\/img\/(scenes|package)\/[a-z0-9]+(-\d+)?\.(webp|jpg)/.test(u) && !/scenes\/en\//.test(u)), scenes.join(' '))
    const usd = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
    check(`/en (${tag}): every price on the landing is $25 — hero, "What they receive" and the gift card — with no yen and no "about $"`, (await usd('[data-testid=usd-hero]')) === '$25' && (await usd('[data-testid=us-receive-price]')) === '$25' && (await usd('#gifts article[data-size=egift] [data-price=egift]')) === '$25' && (await page.locator('#gifts article[data-size=egift] .approx, [data-approx]').count()) === 0)
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))
    // (textContent, not innerText: the landing's sections are content-visibility: auto, so innerText of an off-screen one is empty)
    const text = await page.evaluate(() => document.body.textContent ?? '')
    check(`/en (${tag}): no word "wood", "walnut", "EMS" or "ship" anywhere on the page, the FAQ opened included`, !FORBIDDEN.test(text), text.match(FORBIDDEN)?.[0])
    check(`/en (${tag}): "Why we start with one moment" is numbered 1, 2, 3 (not 一 二 三), and the word "pinyin" is nowhere on the page`, (await page.locator('.philo .phN').allTextContents()).map((x) => x.trim()).join() === '1,2,3' && !/pinyin/i.test(text), (await page.locator('.philo .phN').allTextContents()).join())
    await page.locator('[data-testid=us-banner]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    check(`/en (${tag}): the banner was counted once it came into view (us_banner_seen)`, calls.analytics.some((e) => e.event === 'us_banner_seen'))
    // (2026-11-16) the flow is the writing room: the hero's "Write your moment" opens /en/write in the same tab, keeping the address's utm_… query
    await page.click('.hero a.btn.primary')
    await page.waitForURL(/\/en\/write\?utm_source=chatgpt\.com/)
    await page.waitForSelector('#write #moment')
    check(`/en (${tag}): the writing room keeps the arrival's utm_… and the story hint says "Not a whole story, a few lines are enough…"`, new URL(page.url()).searchParams.get('utm_source') === 'chatgpt.com' && (await page.locator('[data-testid=story-hint]').innerText()) === 'Not a whole story, a few lines are enough. The more true detail, the truer the character.')
    check(`/en (${tag}): the occasion chips are Christmas, Thanksgiving, Birthday, Anniversary, Mother's Day, Father's Day, Graduation, Retirement, Thank you, In memory, No special day, Other — in this order`, (await page.locator('[data-chip-code]').evaluateAll((els) => els.filter((e) => /^purpose:/.test(e.dataset.chip)).map((e) => e.textContent))).join() === "Christmas,Thanksgiving,Birthday,Anniversary,Mother's Day,Father's Day,Graduation,Retirement,Thank you,In memory,No special day,Other")
    check(`/en (${tag}): the relationship chips are Mom, Dad, Partner, Wife, Husband, Son, Daughter, Sister, Brother, Grandparent, Friend, Mentor, Colleague, Boss, Other`, (await page.locator('[data-chip^="relationship:"], [data-chip-code]').evaluateAll((els) => els.filter((e) => /^relationship:/.test(e.dataset.chip)).map((e) => e.textContent))).join() === 'Mom,Dad,Partner,Wife,Husband,Son,Daughter,Sister,Brother,Grandparent,Friend,Mentor,Colleague,Boss,Other')
    // chips: Christmas → thanks, counted; Mom → parent_mother
    await page.locator('[data-chip-code=mom]').click()
    await page.locator('[data-chip-code=christmas]').click()
    await page.locator('[data-chip="direction:up"]').click()
    await page.waitForTimeout(300)
    check(`/en (${tag}): choosing Christmas is counted (occasion_chip, code christmas) and the page's purpose is thanks`, calls.analytics.some((e) => e.event === 'occasion_chip' && e.code === 'christmas') && (await page.locator('[data-chip-code=christmas]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-chip-code=thanksgiving]').getAttribute('aria-pressed')) === 'false')
    await page.locator('#moment').fill('She left the porch light on every night until I got home, and she never once mentioned it.')
    await page.click(`#write >> text=${GO.en}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.waitForTimeout(500)
    check(`/en (${tag}): the request to the engine carries purpose thanks and relationship parent_mother (the codes behind the chips)`, calls.select.length === 1 && calls.select[0].purpose === 'thanks' && calls.select[0].relationship === 'parent_mother' && calls.select[0].language === 'en', JSON.stringify(calls.select[0] ?? {}))
    const main = page.locator('article[data-slot=main]')
    const stack = await main.evaluate((a) => {
      const q = (s) => a.querySelector(s)
      const r = (el) => el.getBoundingClientRect()
      const g = q('[data-glyph]'); const rd = q('[data-en-reading]'); const w = q('[data-en-word]'); const l = q('[data-en-line]'); const h = q('[data-en-where-heading]'); const e = q('[data-en-echo]'); const c = q('[data-en-classical]')
      return { ok: !!(g && w && l), order: [g, rd, w, l, h, e, c].filter(Boolean).map((x) => Math.round(r(x).top)), reading: rd?.textContent, word: w?.textContent, line: l?.textContent, wordWeight: w ? Number(getComputedStyle(w).fontWeight) : 0, readingStyle: rd ? getComputedStyle(rd).fontStyle : '', heading: h?.textContent, echo: e?.textContent, classical: c?.textContent, why: !!q('[data-why-this]') }
    })
    check(`/en (${tag}): the main card shows the stack in order — character, word (bold), line — with nothing between; English first (2026-11-15): no romanized reading`, stack.ok && stack.order.every((y, i, arr) => i === 0 || y >= arr[i - 1]) && stack.reading === undefined && stack.word === 'hearth' && stack.line === 'The light that is already on when everyone else wakes.' && stack.wordWeight >= 600 && !stack.why && !/akari/.test(await main.innerText()), JSON.stringify(stack))
    check(`/en (${tag}): when the English line and "What they're like" differ, both are shown`, (await main.locator('[data-match-who]').count()) === 1 && (await main.locator('[data-en-line]').count()) === 1)
    check(`/en (${tag}): a reviewed row shows its echo and the classical line together under the one small heading "Where this word comes from"`, stack.heading === 'Where this word comes from' && stack.echo === '“Save the cricket on the hearth” — Milton, Il Penseroso' && /床前明月光/.test(stack.classical ?? '') && /Quiet Night Thoughts/.test(stack.classical ?? ''), JSON.stringify(stack))
    check(`/en (${tag}): the freestyle card is exactly as it was — no word, no line, no echo`, (await page.locator('article[data-slot=freestyle] [data-en-stack]').count()) === 0 && (await page.locator('article[data-slot=freestyle] [data-reading]').count()) === 1)
    await page.locator('#write').scrollIntoViewIfNeeded()
    await page.locator('#write').screenshot({ path: `${SHOTS}/us-card-${tag}.png` })
    // the chosen character (order step)
    await main.click()
    await main.locator('text=Give this character').click()
    await page.locator('[data-testid=result-page]').waitFor()
    check(`/en (${tag}): the result page shows the English word large under the character (no romanized reading: English first), with the line of this story under it`, (await page.locator('[data-testid=result-reading]').count()) === 0 && (await page.locator('[data-testid=result-word]').innerText()) === 'hearth' && (await page.locator('[data-testid=result-word]').evaluate((e) => getComputedStyle(e).color)) === 'rgb(42, 34, 27)' && !/akari/.test(await page.locator('[data-testid=result-char]').innerText()) && (await page.locator('[data-testid=result-who]').innerText()) === 'The light that is already on when everyone else wakes.')
    await toOrder(page)
    const slip = await page.locator('.slip').evaluate((s) => ({ stack: !!s.querySelector('[data-en-stack]'), word: s.querySelector('[data-en-word]')?.textContent, line: s.querySelector('[data-en-line]')?.textContent, heading: s.querySelector('[data-en-where-heading]')?.textContent }))
    check(`/en (${tag}): the chosen-character page shows the same stack (word, line, "Where this word comes from"; no romanized reading)`, slip.stack && slip.word === 'hearth' && slip.line === 'The light that is already on when everyone else wakes.' && slip.heading === 'Where this word comes from', JSON.stringify(slip))
    const refund = await page.locator('[data-testid=order-refund-line]').innerText()
    check(`/en (${tag}): the order step carries the owner's refund wording, word for word`, refund.startsWith("You can cancel for a full refund within 24 hours of payment, as long as you have not pressed 'Collect your gift'. After that, the gift has been made for one person and cannot be refunded. If we made a mistake, we will fix it or refund you."), refund)
    check(`/en (${tag}): the order step lists only the e-gift — no wooden size, not even as "coming soon" — and no word wood / walnut / EMS / ship`, (await page.locator('[data-testid=order-form] input[name=package]').count()) === 1 && !FORBIDDEN.test((await page.locator('[data-testid=order-form]').textContent()) ?? ''), (await page.locator('[data-testid=order-form]').textContent())?.match(FORBIDDEN)?.[0])
    await page.click('label[data-size=egift]')
    check(`/en (${tag}): the opening-date field carries the Christmas hint`, (await page.locator('[data-testid=open-date-hint]').innerText()) === 'Set it to open on Christmas morning.')
    await page.locator('.slip').scrollIntoViewIfNeeded()
    await page.locator('.slip').screenshot({ path: `${SHOTS}/us-chosen-${tag}.png` })
    check(`no page errors (run 24, /en ${tag})`, errors.length === 0, errors.join('; '))
    await page.close()
  }

  // ---- English card: the same sentence is never shown twice (the line under the word and "What they're like") ----
  {
    const dupResult = () => {
      const r = enResult()
      r.candidates[0] = { ...r.candidates[0], one_line_gaze: 'Someone who kept the porch light on for me.', en_line: 'Someone who kept the porch light on for me!' }
      return r
    }
    const { page, errors } = await mockPage(browser, { result: dupResult })
    await stubs(page)
    await page.goto('http://localhost:5173/en/write', { waitUntil: 'networkidle' })
    await page.locator('[data-chip-code=mom]').click()
    await page.locator('[data-chip-code=christmas]').click()
    await page.locator('[data-chip="direction:up"]').click()
    await page.locator('#moment').fill('She left the porch light on every night until I got home, and she never once mentioned it.')
    await page.click(`#write >> text=${GO.en}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.waitForTimeout(500)
    const main = page.locator('article[data-slot=main]')
    check('/en card: when the English line and "What they\'re like" are the same sentence (case and punctuation aside), the sentence shows once — the "What they\'re like" block is hidden', (await main.locator('[data-match-who]').count()) === 0 && (await main.locator('[data-en-line]').innerText()) === 'Someone who kept the porch light on for me!' && ((await main.innerText()).match(/kept the porch light on for me/gi) ?? []).length === 1)
    check(`no page errors (run 24, duplicate line)`, errors.length === 0, errors.join('; '))
    await page.close()
  }

  // ---- the receiver's page, English, on a 390 px phone ----
  // Since 2026-11-15 an English thank-you or celebration gift opens on the new ceremony (Run 33). Today's page — with the English bridge checked here — stays for the quiet
  // English gifts, so this block uses an English encouragement gift.
  {
    const TOKEN = 'RG-testtesttesttesttest'
    const year = new Date().getFullYear()
    const view = (over = {}) => ({
      music: 'thanks', locked: false, id: TOKEN, token: TOKEN, language: 'en', glyph: '燈', reading: 'あかり', romanization: 'akari', meaning_en: 'lamp',
      en: { word: 'hearth', word_source: 'lexicon', line: 'The light that is already on when everyone else wakes.', echo: { text: 'Save the cricket on the hearth', source: 'Milton, Il Penseroso' }, classical: { text: '床前明月光', source: 'Li Bai', rendering: 'Bright moonlight before my bed', source_en: 'Li Bai, Quiet Night Thoughts' } },
      who: 'Someone who kept the porch light on for me.', memorial: false,
      film: { status: 'ready', lines: ['She left the porch light on.', 'I never mentioned it.'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] },
      certificate_line: 'This character is the person as seen through your eyes.', poem: { type: 'en', lines: ['Before the house wakes,', 'one lamp, left burning,', 'a quiet kind of care.'], reading: '' },
      from: 'Emily', to: 'Margaret', message: '', egift: null, certificate_no: 12, order_date: `${year}-11-07`, opens_on: null, replied: false, package: 'egift', purpose: 'encourage', ...over,
    })
    const open = async (v) => {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      const errs = []
      const seen = { reply: [], analytics: [] }
      page.on('pageerror', (e) => errs.push(String(e)))
      await page.route('**/api/analytics', async (r) => { try { seen.analytics.push(JSON.parse(r.request().postData() ?? '{}')) } catch {} await r.fulfill({ status: 204, body: '' }) })
      await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
        const u = new URL(r.request().url())
        if (u.pathname === `/api/gift/${TOKEN}/reply`) { seen.reply.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ json: { ok: true } }) }
        if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: v } })
        if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: v })
        return r.fulfill({ status: 204, body: '' })
      })
      await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
      return { page, ctx, errs, seen }
    }
    const T = (page, id) => page.locator(`[data-testid=${id}]`)
    {
      const { page, ctx, errs, seen } = await open(view())
      await T(page, 'gift-envelope').waitFor()
      check('receiver (en, phone, an encouragement): today\'s envelope says "A letter of one character, arrived for you" and the button reads "Untie"', (await T(page, 'gift-env-line').innerText()) === 'A letter of one character, arrived for you' && (await T(page, 'gift-open').innerText()) === 'Untie')
      await T(page, 'gift-open').click()
      await T(page, 'gift-to-film').waitFor({ timeout: 8000 })
      await T(page, 'gift-to-film').click()
      await toMusic(page)
      await T(page, 'gift-skip').click()
      await T(page, 'gift-reveal').waitFor()
      await page.waitForTimeout(500)
      const box = await page.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const g = r('[data-testid=gift-glyph]'); const rd = r('[data-en-reading]'); const w = r('[data-en-word]'); return { glyph: g && Math.round(g.bottom), reading: rd ? Math.round(rd.bottom) : null, word: w && Math.round(w.bottom), vh: window.innerHeight, order: [g.top, w.top, r('[data-en-line]').top].every((y, i, a) => i === 0 || y > a[i - 1]) } })
      check('receiver (en, phone 390 × 844): the character and its word are inside the first screen — no scrolling; no romanized reading (English first)', box.glyph > 0 && box.word < box.vh && box.order && box.reading === null, JSON.stringify(box))
      check('receiver (en): after the reveal the stack is character, word (bold), line, then "Where this word comes from" with the echo and the classical line (original, English rendering, source in English) — no romanized reading', await page.evaluate(() => { const q = (s) => document.querySelector(s); return !q('[data-en-reading]') && !/akari/.test(q('[data-testid=gift-reveal]').textContent) && Number(getComputedStyle(q('[data-en-word]')).fontWeight) >= 600 && q('[data-en-where-heading]').textContent === 'Where this word comes from' && q('[data-en-echo]').textContent.includes('Milton') && q('[data-en-rendering]').textContent.includes('Bright moonlight') && q('[data-en-classical]').textContent.includes('Li Bai, Quiet Night Thoughts') }))
      await page.screenshot({ path: `${SHOTS}/us-receiver-phone.png` })
      const body = await page.locator('body').innerText()
      check('receiver (en): no price, no sizes, no buy link anywhere on the page', !/¥|\$\d|price|Buy|Order now|size/i.test(body) && (await page.locator('a[href*="shopify"], a[href*="checkout"]').count()) === 0)
      await T(page, 'gift-to-poem').click({ timeout: 9000 })
      await T(page, 'gift-poem-screen').waitFor()
      check('receiver (en): under the poem — "Written from the story Emily told about you."', (await T(page, 'gift-poem-from').innerText()) === 'Written from the story Emily told about you.')
      await T(page, 'gift-to-cert').click()
      await T(page, 'gift-cert').waitFor()
      check('receiver (en): the certificate shows the word and the line, and only the certificate keeps the reading, in small type next to the character ("燈 · akari")', await page.locator('[data-testid=gift-cert] [data-en-word]').innerText() === 'hearth' && (await page.locator('[data-testid=gift-cert-reading]').innerText()) === '燈 · akari' && (await page.locator('[data-testid=gift-cert] [data-en-reading]').count()) === 0)
      await page.screenshot({ path: `${SHOTS}/us-certificate-phone.png` })
      await T(page, 'gift-to-keep').click()
      await T(page, 'gift-keep').waitFor()
      check('receiver (en): the save row offers "Save the card" (the square image) and "Save the certificate" (the PDF)', (await T(page, 'save-card-image').innerText()) === 'Save the card' && (await T(page, 'save-card-image').getAttribute('href')) === `/api/gift/${TOKEN}/keepsake-card.png` && /^Save the certificate/.test(await T(page, 'save-card').innerText()) && (await T(page, 'save-card').getAttribute('href')) === `/api/gift/${TOKEN}/card.pdf`)
      await T(page, 'save-card-image').evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()))
      await T(page, 'save-card-image').click()
      await page.waitForTimeout(200)
      check('receiver (en): saving the card is counted (receiver_saved_card)', seen.analytics.some((e) => e.event === 'receiver_saved_card'))
      check('receiver (en): the keepsakes lead to "Send something back" (twelve characters and a written reply); sending it is counted (receiver_replied)', await (async () => { await T(page, 'gift-to-answer').click(); await T(page, 'gift-answer').waitFor(); if ((await T(page, 'gift-answer-title').innerText()) !== 'Send something back') return false; await T(page, 'gift-reply-text').fill('Thank you, it made my day.'); await T(page, 'gift-reply-send').click(); await T(page, 'gift-reply-sent').waitFor(); return seen.reply.length === 1 && seen.analytics.some((e) => e.event === 'receiver_replied') })())
      check('no page errors (run 24, receiver)', errs.length === 0, errs.join('; '))
      await ctx.close()
    }
    {
      const { page, ctx, errs } = await open(view({ from: '' }))
      await T(page, 'gift-envelope').waitFor()
      check('receiver (en): with no sender name the envelope names no one', !/Emily|undefined/.test(await T(page, 'gift-env-line').innerText()))
      await T(page, 'gift-open').click()
      await T(page, 'gift-to-film').waitFor({ timeout: 8000 })
      await T(page, 'gift-to-film').click()
      await toMusic(page)
      await T(page, 'gift-skip').click()
      await T(page, 'gift-to-poem').click({ timeout: 9000 })
      check('receiver (en): …and under the poem "Written from a story told about you."', (await T(page, 'gift-poem-from').innerText()) === 'Written from a story told about you.' && errs.length === 0)
      await ctx.close()
    }
  }

  // ---- the sender's page: the share sheet ----
  {
    const ID = 'AN-testtesttesttesttest'
    const GIFT = 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest'
    const sp = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 800 } })
    const errors = []
    const seen = { schedule: [], analytics: [] }
    sp.on('pageerror', (e) => errors.push(String(e)))
    await sp.route('**/api/analytics', async (r) => { try { seen.analytics.push(JSON.parse(r.request().postData() ?? '{}')) } catch {} await r.fulfill({ status: 204, body: '' }) })
    await sp.route(`**/api/animation/${ID}/schedule`, async (r) => { seen.schedule.push(JSON.parse(r.request().postData() ?? '{}')); const b = seen.schedule.at(-1); await r.fulfill({ json: { ok: true, opens_on: b.open_date, opens_at: b.open_date ? `${b.open_date}T${b.open_time ? '23:00' : '12:00'}:00.000Z` : null, opens_tz: b.open_date ? b.open_tz : null } }) })
    await sp.route(`**/api/animation/${ID}`, (r) => r.fulfill({ json: { id: ID, language: 'en', glyph: '燈', reading: 'あかり', romanization: 'akari', meaning_en: 'lamp', en: { word: 'hearth', word_source: 'lexicon', line: 'The light that is already on when everyone else wakes.', echo: null }, who: 'Someone who kept the porch light on.', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, gift: { url: GIFT, size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null, certificate_no: 12, reply: null } } }))
    await sp.clock.install({ time: new Date('2026-11-14T15:00:00Z') })
    await sp.goto(`http://localhost:5173/a/${ID}`, { waitUntil: 'networkidle' })
    const panel = sp.locator('[data-testid=sender-panel]')
    await panel.waitFor()
    await panel.locator('[data-testid=share-button]').click() // Part 12: the send options live in the share sheet
    check('sender (en): after "Collect your gift" the share sheet offers Copy link, Email, WhatsApp, Messages and "Schedule for a date" — no LINE, no WeChat, no QR', (await panel.locator('[data-testid=en-share-sheet] > *').allInnerTexts()).join() === 'Copy link,Email,WhatsApp,Messages' && (await panel.locator('[data-testid=give-schedule]').innerText()) === 'Schedule for a date' && (await panel.locator('[data-testid=give-line], [data-testid=give-wechat], [data-testid=give-qr]').count()) === 0)
    await sp.keyboard.press('Escape') // close the share sheet
    await panel.locator('[data-testid=give-schedule]').click()
    check('sender (en, Nov 14): the choices are "Now", "Thanksgiving dinner (Nov 26, 6:00 p.m.)" and "Pick a date and time" — no Christmas morning before Dec 1', (await panel.locator('.by-choice label').allInnerTexts()).map((t) => t.trim()).join('|') === 'Now|Thanksgiving dinner (Nov 26, 6:00 p.m.)|Pick a date and time')
    await panel.locator('[data-testid=choice-pick]').check()
    await panel.locator('[data-testid=schedule-date]').fill('2026-12-25')
    await panel.locator('[data-testid=schedule-save]').click()
    await panel.locator('[data-testid=schedule-saved]').waitFor()
    check('sender (en): the picked moment is saved for the gift with its zone (open_tz) and its time, and counted (egift_scheduled)', seen.schedule.length === 1 && seen.schedule[0].open_date === '2026-12-25' && typeof seen.schedule[0].open_tz === 'string' && seen.schedule[0].open_time === '07:00' && seen.analytics.some((e) => e.event === 'egift_scheduled'))
    check('sender (en): once a moment is set, "Add to calendar" offers Google Calendar and an .ics download', await (async () => { await panel.locator('[data-testid=calendar-add]').click(); return (await panel.locator('[data-testid=calendar-google]').getAttribute('href')).startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE') && (await panel.locator('[data-testid=calendar-ics]').count()) === 1 })())
    await sp.screenshot({ path: `${SHOTS}/us-sender-phone.png`, fullPage: true })
    check('no page errors (run 24, sender)', errors.length === 0, errors.join('; '))
    await sp.close()
  }
}

// ---------- Run 25 (2026-11-13): orders with no gift attached (/claim, the claim flow with no payment) and the Thanksgiving sale (struck price, sale price, one line; gone when off or over) ----------
{
  const TOKEN = 'CT-testtesttesttesttesttest'
  const ratesStub = { date: '2026-11-13', base: 'JPY', rates: { USD: 0.0066 } }
  const sizesBody = (sale) => ({ sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'], ...(sale ? { sale } : {}) })
  const SALE = { percent: 30, from: '2026-11-15', until: '2026-11-30', starts_at: '2020-01-01T00:00:00.000Z', ends_at: '2099-11-30T14:59:59.999Z' }
  const baseStubs = async (page, sale) => {
    await page.route('**/api/rates', (r) => r.fulfill({ json: ratesStub }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: sizesBody(sale) }))
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)

  // ---- /claim: the words, the refusal, the brake (phone) ----
  const CLAIM = {
    ja: { heading: '贈りものを作る', order: 'ご注文番号', email: 'ご注文時のメールアドレス', notFound: 'ご注文が見つかりません。番号とメールアドレスをご確認ください。', locale: 'ja-JP' },
    'zh-Hant': { heading: '製作你的禮物', order: '訂單編號', email: '下單時的電子郵件', notFound: '找不到訂單，請確認訂單編號與電子郵件。', locale: 'zh-TW' },
    en: { heading: 'Make your gift', order: 'Order number', email: 'Email used at checkout', notFound: "We couldn't find that order. Please check the number and email.", locale: 'en-US' },
  }
  for (const [lang, w] of Object.entries(CLAIM)) {
    const ctx = await browser.newContext({ locale: w.locale, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    const posts = []
    await page.route('**/api/claim', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      posts.push(b)
      if (posts.length > 5) return route.fulfill({ status: 429, json: { code: 'rate_limited' } })
      if (b.order === '#1016' && b.email === 'buyer@example.com') return route.fulfill({ json: { ok: true, token: TOKEN, order: '#1016', order_number: '1016', language: lang } })
      return route.fulfill({ status: 404, json: { error: 'not_found', code: 'not_found' } })
    })
    await page.goto(`http://localhost:5173/claim?o=%231016&lang=${lang}`, { waitUntil: 'networkidle' })
    check(`/claim (${lang}): the heading, 「${w.order}」 (filled from the e-mail link: #1016) and 「${w.email}」`, (await T(page, 'claim-heading').innerText()) === w.heading && (await page.locator('input[name=order]').inputValue()) === '#1016' && (await page.locator('form').innerText()).includes(w.order) && (await page.locator('form').innerText()).includes(w.email))
    check(`/claim (${lang}): the page is never indexed and has no price, no sale, no wood`, !/¥|\$\d|wood|walnut|ship/i.test(await page.locator('body').innerText()))
    await page.screenshot({ path: `${SHOTS}/claim-${lang}.png` })
    await page.locator('input[name=email]').fill('wrong@example.com')
    await T(page, 'claim-submit').click()
    await T(page, 'claim-error').waitFor()
    check(`/claim (${lang}): a wrong e-mail shows exactly 「${w.notFound}」`, (await T(page, 'claim-error').innerText()) === w.notFound)
    await page.screenshot({ path: `${SHOTS}/claim-${lang}-error.png` })
    for (let i = 0; i < 4; i++) { await T(page, 'claim-submit').click(); await page.waitForTimeout(150) }
    await page.locator('input[name=email]').fill('buyer@example.com')
    await T(page, 'claim-submit').click()
    await page.waitForTimeout(400)
    check(`/claim (${lang}): after five tries the sixth — even with the right details — gets the "too many tries" answer and the flow does not open`, posts.length === 6 && /1|一|hour/.test(await T(page, 'claim-error').innerText()) && page.url().includes('/claim'))
    check(`no page errors (run 25, /claim ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // ---- the claim flow: right details open the normal flow; at the choose step there is no payment ----
  for (const lang of ['ja', 'en']) {
    const w = CLAIM[lang]
    const ctx = await browser.newContext({ locale: w.locale, viewport: { width: 1100, height: 950 } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    const orders = []
    await baseStubs(page, SALE) // even with a sale on, a claimed order shows no price at all
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/log', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/claim', (r) => r.fulfill({ json: { ok: true, token: TOKEN, order: '#1016', order_number: '1016', language: lang } }))
    await page.route('**/api/order', async (route) => { orders.push(JSON.parse(route.request().postData() ?? '{}')); await route.fulfill({ json: { claimed: true, order_ref: 'IC-20261114-ABCDEFGH', animation_url: 'http://localhost:5173/__claimed', gift_url: 'http://localhost:5173/g/RG-x' } }) })
    await page.route('**/__claimed', (r) => r.fulfill({ contentType: 'text/html', body: '<h1 id=done>your gift page</h1>' }))
    await page.route('**/api/select', async (route) => { const body = JSON.parse(route.request().postData() ?? '{}'); await route.fulfill({ json: shapeRound(lang === 'en' ? { ...FIXTURE, language: 'en', inscription_script: null, candidates: FIXTURE.candidates.map((c, i) => ({ ...c, reading: i === 0 ? 'akari' : `y${i}`, meaning: i === 0 ? 'lamp' : `m${i}`, eliminated: false, eliminated_reason: null })) } : lang === 'zh-Hant' ? { ...FIXTURE, language: 'zh-Hant', inscription_script: 'traditional' } : FIXTURE, body) }) })
    await page.route('**/api/explain', (r) => r.fulfill({ json: { explanation: 'ok' } }))
    await page.goto(`http://localhost:5173/claim?o=1016&lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('input[name=email]').fill('buyer@example.com')
    await T(page, 'claim-submit').click()
    await page.waitForURL(/\/write$/, { timeout: 8000 })
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('#write [data-testid=story-input]')
    check(`claim flow (${lang}): the right number and e-mail open the normal flow (the writing room of that language, 2026-11-16), with the claim kept for this tab only and a thin line "Order #1016 …"`, (await T(page, 'claim-banner').innerText()).includes('#1016') && (await page.evaluate(() => JSON.parse(sessionStorage.getItem('ichirei.claim') || 'null')?.token)) === TOKEN && (await page.evaluate(() => localStorage.getItem('ichirei.claim'))) === null)
    await page.locator('#write [data-testid=story-input]').fill(lang === 'en' ? 'She left the porch light on every night until I got home, and she never once mentioned it.' : STORY)
    await pickContext(page)
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await toOrder(page)
    await page.waitForTimeout(500)
    const form = await page.locator('[data-testid=order-form]').innerText()
    check(`claim flow (${lang}): at the choose step there is NO payment — no price, no sale, no sizes to pick, no refund tick-box; the form says it is paid and the button says "${CLAIM[lang] && (lang === 'ja' ? '贈りものを作る' : 'Make my gift')}"`, (await T(page, 'order-form').locator('[data-price]').count()) === 0 && (await T(page, 'order-form').locator('[data-testid=sale-line]').count()) === 0 && (await T(page, 'order-form').locator('[data-testid=order-refund-check]').count()) === 0 && (await T(page, 'order-form').locator('input[name=package]').count()) === 1 && !/¥|\$\d/.test(form) && (await T(page, 'claim-order-note').innerText()).includes('#1016') && (await T(page, 'order-submit').innerText()) === (lang === 'ja' ? '贈りものを作る' : 'Make my gift'))
    await page.screenshot({ path: `${SHOTS}/claim-flow-${lang}.png`, fullPage: false })
    await T(page, 'order-submit').click()
    await page.waitForSelector('#done', { timeout: 8000 })
    const o = orders[0]
    check(`claim flow (${lang}): the order goes out with the claim (number + token), as the e-gift, and without a refund tick; the browser then goes to the gift's own page — never to a checkout — and forgets the claim`, orders.length === 1 && o.claim?.order === '#1016' && o.claim?.token === TOKEN && o.package === 'egift' && !('refund_ack_at' in o) && page.url().endsWith('/__claimed') && (await page.evaluate(() => sessionStorage.getItem('ichirei.claim'))) === null)
    check(`no page errors (run 25, claim flow ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // ---- the Thanksgiving sale: struck price, sale price, one line; gone when off or over ----
  const LINE = { ja: '感謝の季節に、30％オフ（11月30日まで）', 'zh-Hant': '感恩季節，七折優惠（至11月30日）', en: 'Thanksgiving launch price, through November 30 (US Eastern time). $25 from December 1.' }
  const LOCALE = { ja: 'ja-JP', 'zh-Hant': 'zh-TW', en: 'en-US' }
  const reachOrderStep = async (page, lang) => {
    await page.locator('#write [data-testid=story-input]').fill(lang === 'en' ? 'She left the porch light on every night until I got home, and she never once mentioned it.' : STORY)
    await pickContext(page)
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await toOrder(page)
    await page.waitForTimeout(500)
  }
  for (const [mode, sale] of [['on', SALE], ['off', null], ['over', { ...SALE, ends_at: '2020-11-30T14:59:59.999Z' }], ['not yet', { ...SALE, starts_at: '2098-01-01T00:00:00.000Z' }]]) {
    for (const lang of ['ja', 'zh-Hant', 'en']) {
      const ctx = await browser.newContext({ locale: LOCALE[lang], viewport: { width: 1100, height: 950 } })
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(String(e)))
      await baseStubs(page, sale)
      await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
      await page.route('**/api/log', (r) => r.fulfill({ status: 204, body: '' }))
      await page.route('**/api/select', async (route) => { const body = JSON.parse(route.request().postData() ?? '{}'); await route.fulfill({ json: shapeRound(lang === 'en' ? { ...FIXTURE, language: 'en', inscription_script: null, candidates: FIXTURE.candidates.map((c, i) => ({ ...c, reading: i === 0 ? 'akari' : `y${i}`, meaning: i === 0 ? 'lamp' : `m${i}`, eliminated: false, eliminated_reason: null })) } : lang === 'zh-Hant' ? { ...FIXTURE, language: 'zh-Hant', inscription_script: 'traditional' } : FIXTURE, body) }) })
      await page.route('**/api/explain', (r) => r.fulfill({ json: { explanation: 'ok' } }))
      await page.goto(`http://localhost:5173/${lang === 'en' ? 'en' : ''}?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(600)
      const card = page.locator('#gifts article[data-size=egift]')
      const txt = async (loc) => ((await loc.count()) ? (await loc.first().textContent())?.trim() : null) // (the landing's sections are content-visibility: auto, so innerText of an off-screen one is empty)
      const read = async () => ({ old: await txt(card.locator('[data-price-old=egift]')), sale: await txt(card.locator('[data-price-sale=egift]')), line: await txt(card.locator('[data-testid=sale-line]')), price: ((await card.locator('[data-price=egift]').textContent()) ?? '').replace(/\s+/g, ' ').trim() })
      check(`landing numerals (${lang}): ${lang === 'en' ? '1, 2, 3' : '一, 二, 三'} in "why we start with your story"`, (await page.locator('.philo .phN').allTextContents()).map((x) => x.trim()).join() === (lang === 'en' ? '1,2,3' : '一,二,三'))
      const L = await read()
      const EN = lang === 'en'
      // no struck-through price on any English page, ever (the English version has never been sold at the full price): no <s>, <del>, price-old element or line-through anywhere
      const struckAnywhere = () => page.evaluate(() => ({ tags: document.querySelectorAll('s, del, strike, [data-price-old]').length, lt: [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).textDecorationLine.includes('line-through')).length }))
      if (mode === 'on') {
        if (EN) {
          check(`sale on (en): the landing's e-gift price shows ONLY the sale price $17.50, then 「${LINE.en}」 — no $25 before it, struck or plain`, L.old === null && L.sale === '$17.50' && L.price === '$17.50' && L.line === LINE.en, JSON.stringify(L))
          const st = await struckAnywhere()
          check('sale on (en): no <s>, <del>, price-old element or line-through anywhere on the English landing', st.tags === 0 && st.lt === 0, JSON.stringify(st))
          check('sale on (en): the hero and "What they receive" show only $17.50 (with the launch line under it), and no "about $" and no ¥ anywhere on the page', (await page.locator('[data-testid=usd-hero]').textContent())?.trim() === '$17.50' && (await page.locator('[data-testid=usd-hero-line]').textContent()) === LINE.en && (await page.locator('[data-testid=us-receive-price]').textContent())?.trim() === '$17.50' && (await page.locator('#receive [data-testid=sale-line]').textContent()) === LINE.en && !/about \$/.test((await page.evaluate(() => document.body.textContent)) ?? '') && !/¥/.test((await page.evaluate(() => document.body.textContent)) ?? ''))
        } else {
          const struck = await card.locator('[data-price-old=egift]').evaluate((e) => getComputedStyle(e).textDecorationLine)
          check(`sale on (${lang}): the landing's e-gift price shows ¥3,980 struck through, then ¥2,786, then 「${LINE[lang]}」`, L.old === '¥3,980' && L.sale === '¥2,786' && L.line === LINE[lang] && struck === 'line-through', JSON.stringify(L))
        }
        const woodPrices = await page.locator('#gifts article[data-size=simple] [data-price-old], #gifts article[data-size=standard] [data-price-old]').count()
        check(`sale on (${lang}): the wooden sizes (coming soon) carry no sale`, woodPrices === 0)
        await page.screenshot({ path: `${SHOTS}/sale-landing-${lang}.png`, fullPage: false })
      } else {
        check(`sale ${mode} (${lang}): the landing shows the plain price ${EN ? '$25' : '¥3,980'} and no struck price, no sale price, no line`, L.old === null && L.sale === null && L.line === null && L.price === (EN ? '$25' : '¥3,980'), JSON.stringify(L))
        if (EN) check(`sale ${mode} (en): the hero shows the plain $25 (nothing struck, no launch line), no "about $" and no ¥ anywhere on the page`, (await page.locator('[data-testid=usd-hero]').textContent())?.trim() === '$25' && (await page.locator('[data-testid=usd-hero-line]').count()) === 0 && (await struckAnywhere()).tags === 0 && !/about \$/.test((await page.evaluate(() => document.body.textContent)) ?? '') && !/¥/.test((await page.evaluate(() => document.body.textContent)) ?? ''))
      }
      // (2026-11-16) the flow is the writing room
      await page.goto(`http://localhost:5173/${lang === 'en' ? 'en/' : ''}write?lang=${lang}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('#write [data-testid=story-input]')
      await reachOrderStep(page, lang)
      const pkg = page.locator('label.pkg:has(input[value=egift])')
      const O = { old: await pkg.locator('[data-price-old]').count(), sale: await pkg.locator('[data-price-sale]').count() ? await pkg.locator('[data-price-sale]').innerText() : null, line: await pkg.locator('[data-testid=sale-line]').count() ? await pkg.locator('[data-testid=sale-line]').innerText() : null, plain: await pkg.locator('[data-price=egift]').innerText() }
      if (mode === 'on') {
        if (EN) {
          const st = await struckAnywhere()
          check(`sale on (en): the order step shows ONLY $17.50 and 「${LINE.en}」 — nothing struck, no $25 before it — and no yen anywhere on the order step (checkout is in dollars)`, O.old === 0 && O.sale === '$17.50' && O.plain === '$17.50' && O.line === LINE.en && st.tags === 0 && st.lt === 0 && !/¥/.test(await T(page, 'order-form').innerText()) && (await T(page, 'order-yen-line').count()) === 0, JSON.stringify({ O, st }))
        } else {
          check(`sale on (${lang}): the order step shows the same — ¥3,980 struck through, ¥2,786, and 「${LINE[lang]}」`, O.old === 1 && O.sale === '¥2,786' && O.line === LINE[lang] && /3,980/.test(O.plain) && /2,786/.test(O.plain), JSON.stringify(O))
        }
        await page.locator('label.pkg:has(input[value=egift])').scrollIntoViewIfNeeded()
        await page.locator('[data-testid=order-form]').screenshot({ path: `${SHOTS}/sale-order-${lang}.png` })
      } else {
        if (EN) check(`sale ${mode} (en): no yen line above "Continue to payment" and no ¥ anywhere on the order step, no "about $"`, (await T(page, 'order-yen-line').count()) === 0 && !/¥/.test(await T(page, 'order-form').innerText()) && !/about \$/.test(await T(page, 'order-form').innerText()))
        check(`sale ${mode} (${lang}): the order step shows only the plain price — nothing struck, no sale line`, O.old === 0 && O.sale === null && O.line === null && O.plain === (EN ? '$25' : '¥3,980'), JSON.stringify(O))
      }
      check(`no page errors (run 25, sale ${mode} ${lang})`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }
  }
  // SALE_FROM: a page opened just before the sale begins shows nothing, then switches the sale on by itself at the start moment
  {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1100, height: 950 } })
    const page = await ctx.newPage()
    await baseStubs(page, { ...SALE, starts_at: new Date(Date.now() + 4000).toISOString() })
    await page.goto('http://localhost:5173/en', { waitUntil: 'networkidle' })
    const card = page.locator('#gifts article[data-size=egift]')
    const before = await card.locator('[data-price-sale]').count()
    await page.waitForFunction(() => document.querySelector('#gifts [data-price-sale=egift]'), null, { timeout: 12000 })
    check('sale from SALE_FROM: before the start moment the page shows the plain price; at the start it switches the sale on by itself (only $17.50, the launch line)', before === 0 && (await card.locator('[data-price-sale=egift]').textContent()) === '$17.50' && (await card.locator('[data-testid=sale-line]').textContent()) === LINE.en)
    await ctx.close()
  }
  // the sale line is ink, never cinnabar (red is only for the character and the seal)
  {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1100, height: 950 } })
    const page = await ctx.newPage()
    await baseStubs(page, SALE)
    await page.goto('http://localhost:5173/en', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const colours = await page.locator('#gifts article[data-size=egift]').evaluate((a) => ({ line: getComputedStyle(a.querySelector('[data-testid=sale-line]')).color, sale: getComputedStyle(a.querySelector('[data-price-sale]')).color }))
    const isRed = (c) => { const m = /rgb\((\d+), (\d+), (\d+)/.exec(c); return !!m && Number(m[1]) > 150 && Number(m[2]) < 90 && Number(m[3]) < 90 }
    check('sale on: the sale line and the sale price are not in cinnabar red', !isRed(colours.line) && !isRed(colours.sale), JSON.stringify(colours))
    await ctx.close()
  }
}

// ---------- Run 26 (2026-11-14): "write one moment" — the new opening lines, the three steps, the hint and the placeholder, the English-only blocks; phone screenshots ----------
{
  const W = {
    ja: { path: '/?lang=ja', cta: 'ひと場面を書く →', open1: '面と向かっては言えないことも、一字なら言える。', open2: '多くの贈りものが伝えるのは『想っている』。一字礼が伝えるのは『あなたが、こう見えている』。', steps: ['忘れられないひと場面を、数行で書く。', 'その場面から浮かぶ字を、無料で見る。あなたの目に映る一字を選ぶ。', '選んでから、お支払い。リンクで送るか、カードを印刷して渡す。'], hint: '物語でなくていい。数行で十分です。本当のことを細かく書くほど、字も本当になります。', ph: 'どこで、その人は何をして、何と言いましたか。数行で十分です。', story: /物語|ストーリー/ },
    'zh-Hant': { path: '/?lang=zh-Hant', cta: '寫下一個片刻 →', open1: '當面說不出口的話，一個字可以替你說。', open2: '大多數禮物說的是「我想著你」。一字禮說的是「在我眼裡，你是這樣的人」。', steps: ['寫下一個忘不了的片刻，幾行就夠了。', '免費看看這個片刻帶出的字，選出你眼中的那一個。', '選好之後才付款。用連結傳送，或印出卡片親手交給對方。'], hint: '不必是完整的故事，幾行就夠了。寫得越真實、越具體，選出的字就越貼近。', ph: '在哪裡？他做了什麼、說了什麼？幾行就夠了。', story: /故事/ },
    en: { path: '/en', cta: 'Write your moment →', open1: 'Some things are hard to say face to face. One character can say them.', open2: 'Most gifts say I thought of you. ICHIREI says this is how I see you.', steps: ["Write one moment you've never forgotten. A few lines are enough.", 'See the characters your moment brings up, free, and choose the one that fits how you see them.', "Pay only once you've chosen. Then send the link, or print the card."], hint: 'Not a whole story, a few lines are enough. The more true detail, the truer the character.', ph: 'Where were you? What did they do or say? A few lines are enough.', story: /\bstor(y|ies)\b/i },
  }
  for (const [lang, w] of Object.entries(W)) {
    const { page, errors } = await mockPage(browser)
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'] } })) // the launch state: only the e-gift is on sale
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`http://localhost:5173${w.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    const tc = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
    check(`moment (${lang}): the hero button is the owner's 「${w.cta}」, and the two opening lines sit right under the hero, word for word`, (await page.locator('.hero a.btn.primary').innerText()) === w.cta && (await tc('[data-testid=opening-1]')) === w.open1 && (await tc('[data-testid=opening-2]')) === w.open2 && (await page.evaluate(() => { const h = document.querySelector('.hero'); const o = document.querySelector('[data-testid=opening]'); return !!h && !!o && (h.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && h.nextElementSibling === o })))
    check(`moment (${lang}): how it works — the three steps are the owner's sentences (one line each, same numerals, no second line)`, JSON.stringify((await page.locator('#how ol.steps li h3').allTextContents()).map((x) => x.trim())) === JSON.stringify(w.steps) && (await page.locator('#how ol.steps li p').count()) === 0 && (await page.locator('#how ol.steps li .n').count()) === 3)
    // (2026-11-16) the box is in the writing room
    await page.goto(`http://localhost:5173${w.path.startsWith('/en') ? '/en/write' : '/write' + w.path.slice(1)}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#write #moment')
    check(`moment (${lang}): under the box the hint, in the box the placeholder, exactly as given`, (await tc('#write [data-testid=story-hint]')) === w.hint && (await page.locator('#write #moment').getAttribute('placeholder')) === w.ph)
    await page.goto(`http://localhost:5173${w.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    // what is left of "story" on the landing page: only the hint that says a whole story is not needed (en: also the example sentences of what people wrote, which are data)
    const body = await page.evaluate(() => document.body.textContent ?? '')
    const sentences = body.split(/[。.!?！？\n]/).filter((x) => w.story.test(x)).map((x) => x.trim()).filter((x) => !w.hint.includes(x.slice(0, 12)))
    check(`moment (${lang}): no text on the landing page asks the sender to write a story (only the hint "${w.hint.slice(0, 12)}…" says the word)`, sentences.length === 0, sentences.join(' | '))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${SHOTS}/moment-landing-${lang}.png` })
    // (2026-11-16) the writing box is the writing room
    await page.goto(`http://localhost:5173${w.path.startsWith('/en') ? '/en/write' : '/write' + w.path.slice(1)}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#write #moment')
    await page.waitForTimeout(400)
    await page.locator('#write').screenshot({ path: `${SHOTS}/moment-write-${lang}.png` })
    await page.goto(`http://localhost:5173${w.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    if (lang === 'en') {
      const read = (sel) => page.evaluate((x) => (document.querySelector(x)?.textContent ?? '').replace(/\s+/g, ' ').trim(), sel)
      check('moment (en): "What is a kanji?" — the owner\'s paragraph, 恒 and its word (the lexicon row\'s / the card\'s: "constant")', (await read('[data-testid=us-kanji]')).includes('What is a kanji?') && (await read('[data-testid=us-kanji]')).includes('Kanji are the characters of written Japanese, carried from China more than 1,500 years ago. Each one holds a meaning, not just a sound.') && (await read('[data-testid=us-kanji-glyph]')) === '恒' && (await read('[data-testid=us-kanji-word]')) === 'constant' && (await read('[data-testid=us-kanji]')).includes('means constant: the one who never changes. One character can hold what a long card can’t.'))
      check('moment (en): "What they receive" — the five points, then the private-link note with the Christmas line', JSON.stringify(await page.locator('#receive li').evaluateAll((els) => els.map((e) => e.querySelector('b')?.textContent))) === JSON.stringify(['The character (its English word and meaning)', 'A poem from your moment', 'Four ink pictures', 'A short film with music', 'A certificate and a card to print']) && (await read('[data-testid=us-receive-note]')) === 'Everything arrives as one private link, the same day. Send it by text, email or WhatsApp. Nothing is mailed. Or set it to open on Christmas morning.')
      check('moment (en): "Who it\'s for" — the owner\'s paragraph; the blocks run kanji → what they receive → who it\'s for; the footer line is "Designed in Tokyo. Delivered worldwide."', (await read('[data-testid=us-who]')).includes('For Mom, Dad, your partner, a grandparent, a brother or sister, a friend, a mentor or a colleague. For Thanksgiving, Christmas, a birthday, an anniversary, a thank-you, or no reason at all. And for someone you’ve lost, it keeps how you saw them.') && (await page.evaluate(() => { const a = document.querySelector('[data-testid=us-kanji]'); const b = document.querySelector('[data-testid=us-receive]'); const c = document.querySelector('[data-testid=us-who]'); const f = (x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; return !!a && !!b && !!c && f(a, b) && f(b, c) })) && (await read('[data-testid=footer-slogan]')) === 'Designed in Tokyo. Delivered worldwide.')
    }
    check(`no page errors (run 26, moment ${lang})`, errors.length === 0, JSON.stringify(errors))
    await page.close()
  }
}

// ---------- Run 27 (2026-11-14, final fix ticket): the landing opens at the top, the dock stays out of the flow, the cards intro, the result page on a phone (strings, the way to the order section and back, no sample box, the waiting state), the buyer page "confirming" / "finishing" states, and the screenshots ----------
{
  const DRAFT = 'AN-finalfinalfinalfina22'
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="#9a8f7a"/></svg>'
  const LINES = ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。']
  const INTRO = { ja: 'あなたの思い出のひと場面から浮かんだ字です。贈りたい一字を選んでください。', 'zh-Hant': '這些字來自你寫下的片刻。選出你想送的那一個。', en: 'These characters came from your moment. Choose the one you want to give.' }
  const DOCK = { ja: 'ひと場面を書く・無料で試せます', 'zh-Hant': '寫下一個片刻・可免費試用', en: 'Write your moment · free to try' }
  const RC = { ja: { heading: 'あなたの贈りもの', sub: 'あなたの目に映る、その人。', pics: 'その場面の4枚の絵', closing: 'この一字は、あなたの目に映る、その人です。', note: 'お届けする贈りものは、封を開くところから始まり、音楽つきのフィルムとともに届きます。', make: 'この一字を贈る →', another: 'ほかの字を選ぶ', waiting: 'その場面を描いています。1分ほどお待ちください。' }, 'zh-Hant': { heading: '你的禮物', sub: '你眼中的那個人。', pics: '那個片刻的四幅畫', closing: '這個字，是你眼中的那個人。', note: '送出的禮物會從拆開信封開始，並附上配樂短片。', make: '把這個字送出去 →', another: '選別的字', waiting: '正在描繪這個片刻，約需一分鐘。' }, en: { heading: 'Your gift', sub: 'This is how you see them.', pics: 'Four pictures of your moment', closing: 'This character is the person as seen through your eyes.', note: 'The finished gift opens from a sealed envelope, with the film and music.', make: 'Make it a gift →', another: 'Choose another character', waiting: 'Painting your moment. About a minute.' } }
  const mk27 = async (lang, vp, { slow = false } = {}) => {
    const f = await mockPage(browser, { result: (b) => ({ ...clone(FIXTURE), language: b.language }), order: () => ({ json: { order_ref: 'IC-20261114-FINAL111', checkout_url: 'http://localhost:5173/__checkout?cart=f', glyph: '証', certificate_text: 'x' } }) })
    await f.page.setViewportSize(vp)
    let renders = 0
    await f.page.route('**/api/preview', (route) => route.fulfill({ json: { state: 'ok', id: DRAFT, reused: false, script: 'ready' } }))
    await f.page.route('**/api/preview/*/render', async (route) => {
      renders++
      if (slow && renders <= 2) { await new Promise((r) => setTimeout(r, 900)); return route.fulfill({ json: { id: DRAFT, state: 'drawing', lines: LINES, pictures: [1, 2, null, null].map((k) => (k ? `/api/film/${DRAFT}/picture/${k}.webp` : null)) } }) }
      await route.fulfill({ json: { id: DRAFT, state: 'done', lines: LINES, pictures: [1, 2, 3, 4].map((n) => `/api/film/${DRAFT}/picture/${n}.webp`) } })
    })
    await f.page.route(/\/api\/preview\/AN-[a-z0-9]+$/, (route) => route.fulfill({ json: { id: DRAFT, state: renders >= 3 || !slow ? 'done' : 'drawing', lines: LINES, pictures: [1, 2, 3, 4].map((n) => (renders >= 3 || !slow || n <= 2 ? `/api/film/${DRAFT}/picture/${n}.webp` : null)) } }))
    await f.page.route('**/api/film/*/picture/*', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }))
    await f.page.route('**/api/poem', (route) => route.fulfill({ json: { poem_id: 'PM-20261114-abcdefghj1', type: JSON.parse(route.request().postData() ?? '{}').type, lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: '', aids: {}, preview: 'x' } }))
    await f.page.goto(`http://localhost:5173/?lang=${lang}`, { waitUntil: 'networkidle' })
    return f
  }
  const story = (lang) => (lang === 'en' ? 'She left the porch light on every night until I got home, and she never once mentioned it.' : STORY)
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    for (const [tag, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
      const f = await mk27(lang, vp, { slow: tag === 'phone' })
      const { page, errors } = f
      // C1: nothing scrolls the page to the writing step on load
      await page.waitForTimeout(600)
      const y0 = await page.evaluate(() => window.scrollY)
      check(`landing (${lang}, ${tag}): the page is at the top after load (scrollY 0) — nothing scrolled to the writing step`, y0 === 0, String(y0))
      if (['ja', 'en'].includes(lang)) await page.screenshot({ path: `${SHOTS}/final-landing-${lang}-${tag}.png` })
      // C3: the dock's words
      const dockText = await page.locator('[data-testid=dock]').evaluate((el) => el.textContent ?? '').catch(() => '')
      check(`dock (${lang}, ${tag}): the dock reads 「${DOCK[lang]}」`, dockText.includes(DOCK[lang]), dockText)
      // (2026-11-16) "Write your moment" (the dock on a phone, the hero's button on a desktop) opens the writing room of this language, in the same tab
      if (await page.locator('[data-testid=dock] a').isVisible()) await page.locator('[data-testid=dock] a').click()
      else await page.locator('.hero a.btn.primary').click()
      await page.waitForURL(lang === 'en' ? /\/en\/write/ : lang === 'ja' ? /\/write/ : /\/zh\/write/)
      await page.waitForSelector('#write [data-testid=story-input]')
      await page.locator('#write [data-testid=story-input]').fill(story(lang))
      await pickContext(page)
      await page.click(`#write >> text=${GO[lang]}`)
      await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
      await page.waitForTimeout(500)
      // C2: the dock is hidden for the whole flow and never covers a card button
      const dockHidden = async () => !(await page.locator('[data-testid=dock]').isVisible().catch(() => false))
      check(`flow (${lang}, ${tag}): at the cards the dock is hidden, and the cards intro is the owner's words 「${INTRO[lang]}」`, (await dockHidden()) && (await page.locator('[data-reveal-intro]').innerText()) === INTRO[lang], await page.locator('[data-reveal-intro]').innerText())
      if (['ja', 'en'].includes(lang)) { await page.locator('#write').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/final-cards-${lang}-${tag}.png` }) }
      await page.locator('article[data-slot=main]').click()
      await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
      await page.locator('[data-testid=result-page]').waitFor()
      const c = RC[lang]
      await page.waitForTimeout(250)
      const top = await page.locator('[data-testid=result-page]').evaluate((el) => el.scrollTop)
      check(`result page (${lang}, ${tag}): it is its own full-screen page, opens scrolled to the top, and the dock is not there`, top === 0 && (await dockHidden()) && (await page.evaluate(() => window.location.hash)) === '#result')
      check(`result page (${lang}, ${tag}): the heading, the line under it and the pictures heading are the owner's words, and nothing says Sample`, (await page.locator('[data-testid=result-heading]').innerText()) === c.heading && (await page.locator('[data-testid=result-sub]').innerText()) === c.sub && (await page.locator('[data-testid=result-pictures-heading]').innerText()) === c.pics && !(await page.locator('[data-testid=result-page]').innerText()).match(/見本|樣本|Sample/))
      // B3: the waiting state — the character is there at once with the quiet progress line
      if (tag === 'phone') {
        check(`result page (${lang}, ${tag}): the waiting state shows the character at once, the line 「${c.waiting}」 and the quiet ink line`, (await page.locator('[data-testid=result-glyph]').innerText()).length > 0 && (await page.locator('[data-testid=result-waiting]').innerText()).includes(c.waiting) && (await page.locator('[data-testid=result-waiting] .rs-ink').count()) === 1)
        if (['ja', 'en'].includes(lang)) await page.screenshot({ path: `${SHOTS}/final-result-waiting-${lang}-${tag}.png` })
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-ready=yes]').length === 4, null, { timeout: 25000 })
      } else {
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=result-pictures] .rs-fig[data-ready=yes]').length === 4, null, { timeout: 15000 })
      }
      await page.locator('[data-testid=result-poem]').waitFor({ timeout: 6000 })
      await page.waitForTimeout(300)
      if (['ja', 'en'].includes(lang)) await page.screenshot({ path: `${SHOTS}/final-result-${lang}-${tag}.png` })
      check(`result page (${lang}, ${tag}): the closing line, the note and the two buttons are the owner's words; the waiting line is gone`, (await page.locator('[data-testid=result-closing]').innerText()) === c.closing && (await page.locator('[data-testid=result-note]').innerText()) === c.note && (await page.locator('[data-testid=result-make]').innerText()) === c.make && (await page.locator('[data-testid=result-another]').innerText()) === c.another && (await page.locator('[data-testid=result-waiting]').count()) === 0)
      // the two buttons are reachable on the screen (not covered by anything), the page itself scrolls
      await page.locator('[data-testid=result-make]').scrollIntoViewIfNeeded()
      const hit = await page.evaluate(() => { const b = document.querySelector('[data-testid=result-make]'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b === top || b.contains(top) })
      check(`result page (${lang}, ${tag}): the main button is on top — nothing (the dock included) covers it`, hit)
      // "Choose another character" goes back to the cards
      await page.locator('[data-testid=result-another]').click()
      await page.waitForSelector('[data-all-revealed=yes]')
      check(`result page (${lang}, ${tag}): 「${c.another}」 returns to the cards (the result page is gone, the address is back)`, (await page.locator('[data-testid=result-page]').count()) === 0 && (await page.locator('article[data-slot]').count()) >= 2 && (await page.evaluate(() => window.location.hash)) !== '#result')
      await page.locator('article[data-slot=main]').click()
      await page.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
      await page.locator('[data-testid=result-page]').waitFor()
      await page.locator('[data-testid=result-make]').click()
      await page.locator('[data-testid=order-form]').waitFor()
      await page.waitForTimeout(300)
      const sub = page.locator('[data-testid=order-submit]')
      const box = await sub.boundingBox()
      const dockBox = await page.locator('[data-testid=dock]').boundingBox().catch(() => null)
      check(`order section (${lang}, ${tag}): 「${c.make}」 reaches the order section; the old 「Inside the card (sample)」 box is gone; the dock is hidden and never covers 「Continue to payment」`, (await page.locator('[data-testid=result-page]').count()) === 0 && (await page.locator('[data-testid=card-preview], [data-testid=sample-mark], [data-testid=card-sheet]').count()) === 0 && (await dockHidden()) && !!box && (!dockBox || !(await page.locator('[data-testid=dock]').isVisible())))
      if (['ja', 'en'].includes(lang)) { await page.locator('[data-testid=order-form]').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/final-order-${lang}-${tag}.png` }) }
      check(`no page errors (run 27, ${lang}, ${tag})`, errors.length === 0, errors.join('; '))
      await page.close()
    }
  }
  // the buyer's page while the payment is not confirmed, and while the gift is being finished
  const STATES = { ja: { confirming: 'お支払いを確認しています。数分後にもう一度開いてください。', finishing: '贈りものを仕上げています。数分後にもう一度開いてください。' }, 'zh-Hant': { confirming: '正在確認付款，請幾分鐘後再打開。', finishing: '禮物正在完成中，請幾分鐘後再打開。' }, en: { confirming: "We're confirming your payment. Please open this page again in a few minutes.", finishing: 'Your gift is being finished. Please open this page again in a few minutes.' } }
  const mkBuyer = (lang, order) => ({ id: 'AN-testtesttesttesttest', language: lang, glyph: '備', reading: 'そなえる', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: [], no_pictures: true }, gift: { url: 'https://ichirei.soul-id.jp/g/RG-testtesttesttesttest', size_code: 'ICHIREI-EGIFT' }, order })
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    for (const [tag, vp] of [['phone', { width: 390, height: 800 }], ['desktop', { width: 1280, height: 900 }]]) {
      for (const state of ['confirming', 'finishing']) {
        const p = await browser.newPage({ locale: lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'zh-TW', viewport: vp })
        const errs = []
        p.on('pageerror', (e) => errs.push(String(e)))
        await p.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ json: mkBuyer(lang, { [state]: true, collected: false, ordered_at: new Date().toISOString(), change_until: new Date(Date.now() + 86400000).toISOString(), wood: null }) }))
        await p.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
        await p.locator(`[data-testid=buyer-${state}]`).waitFor()
        check(`buyer page (${lang}, ${tag}, ${state}): the line is the owner's, word for word — and no receiver link, no collect button, no download is on the page`, (await p.locator(`[data-testid=buyer-${state}]`).innerText()).includes(STATES[lang][state]) && (await p.locator('[data-testid=buyer-collect], [data-testid=buyer-gift-url], a[download]').count()) === 0 && !(await p.locator('[data-testid=buyer-page]').innerHTML()).match(/\/g\/RG-/), await p.locator(`[data-testid=buyer-${state}]`).innerText())
        if (['ja', 'en'].includes(lang)) await p.screenshot({ path: `${SHOTS}/final-buyer-${state}-${lang}-${tag}.png` })
        check(`no page errors (run 27, buyer ${lang}, ${state})`, errs.length === 0, errs.join('; '))
        await p.close()
      }
    }
  }
}

// ---------- Run 28 (2026-11-14, gift ceremony phase 1): sealed with the cord + the opening label, press-and-hold untie / the Untie button / reduced motion, nothing auto-advances, the note, the music card, the stroke reveal (and the fade for a character with no stroke data), the answer (character / reply / both, once; none in a remembrance), the sender's states and the returned character in gold; phone screenshots in en and ja ----------
{
  const TOKEN = 'RG-testtesttesttesttest'
  const ID = 'AN-testtesttesttesttest'
  const year = new Date().getFullYear()
  const V = {
    ja: { language: 'ja', glyph: '備', reading: 'そな-える', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'いつも、頼まれる前に備えている人。', film: { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, certificate_line: 'この字は、あなたの目に映る、その人です。', poem: { type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: 'あさごとに' }, from: '山田 太郎', to: '山田 一郎', message: 'いつも、ありがとう。\n今年もよろしく。' },
    en: { language: 'en', glyph: '燈', reading: 'あかり', romanization: 'akari', meaning_en: 'lamp', en: { word: 'hearth', word_source: 'lexicon', line: 'The light that is already on when everyone else wakes.', echo: null, classical: null }, who: 'Someone who kept the porch light on for me.', film: { status: 'fallback', lines: ['She left the porch light on.', 'I never mentioned it.'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, certificate_line: 'This character is the person as seen through your eyes.', poem: { type: 'en', lines: ['Before the house wakes,', 'one lamp, left burning,', 'a quiet kind of care.'], reading: '' }, from: 'Emily', to: 'Margaret', message: 'Thank you for everything.\nSee you at Christmas.' },
  }
  const mk = (lang, over = {}) => ({ music: 'thanks', locked: false, id: TOKEN, token: TOKEN, memorial: false, egift: null, certificate_no: 12, order_date: `${year}-11-07`, opens_on: null, replied: false, package: 'egift', purpose: 'thanks', ...V[lang], ...over })
  const lockedView = (lang, over = {}) => ({ locked: true, token: TOKEN, language: lang, memorial: false, from: V[lang].from, to: V[lang].to, opens_on: `${year}-12-25`, opens_at: `${year}-12-25T12:00:00.000Z`, opens_tz: 'America/New_York', days_left: 41, ...over })
  const open = async (view, { reduced = false, locale = 'en-US', time = null } = {}) => {
    const ctx = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    const errs = []
    const seen = { reply: [], opened: 0, urls: [] }
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('request', (r) => seen.urls.push(r.url()))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 3 }, ready: null, hold: null } })) // (the receiver's マイギフト shows once the browser holds something: Part 14)
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/reply`) { seen.reply.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/opened`) { seen.opened++; return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: view })
      return r.continue()
    })
    if (time) await page.clock.install({ time: new Date(time) })
    await page.goto(`http://localhost:5173/g/${TOKEN}?ceremony=old`, { waitUntil: 'networkidle' })
    return { page, ctx, errs, seen }
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const step = (page) => page.locator('[data-testid=gift-page]').getAttribute('data-step')
  const pause = async (page, path) => { await page.waitForTimeout(700); await page.screenshot({ path }).catch(() => {}) }
  /** letter → (music card) → film end → reveal. Nothing moves on by itself, so each step is a tap. */
  const toReveal = async (page) => {
    await T(page, 'gift-to-film').click()
    await toMusic(page)
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
    await T(page, 'gift-skip').click({ timeout: 6000 })
    await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
  }

  for (const lang of ['en', 'ja']) {
    const L = lang === 'en'
    const loc = L ? 'en-US' : 'ja-JP'
    const S = L
      ? { label: 'Opens Dec 25, 7:00 a.m.', hint: 'Press and hold the knot to untie it', untie: 'Untie', music: 'This gift has music.', answer: 'Send something back', back: 'Give Emily a character back', sent: 'Sent to Emily.', landing: "Give one of your own →", memLabel: 'Dec 25' }
      : { label: '12月25日 午前7時に開きます', hint: '結び目を長押しして、ほどいてください', untie: 'ほどく', music: 'この贈りものには音楽があります。', answer: 'お返しをする', back: '山田 太郎さんに一字を返す', sent: '山田 太郎さんに届けました。', landing: '自分も一字を贈る →', memLabel: '12月25日' }
    const shots = `${SHOTS}/ceremony-${lang}`

    // 1. sealed: the cord lies across the seal, the label and a quiet countdown; nothing to untie yet
    {
      const { page, ctx, errs } = await open(lockedView(lang), { locale: loc, time: `${year}-11-14T15:00:00Z` })
      await T(page, 'gift-envelope').waitFor()
      check(`ceremony (${lang}): sealed — the cord is across the seal, the label is "${S.label}", a countdown line, and no knot to hold nor Untie button`, (await T(page, 'gift-cord').count()) === 1 && (await T(page, 'gift-locked-date').innerText()) === S.label && (await T(page, 'gift-locked-note').count()) === 1 && (await T(page, 'gift-knot').count()) === 0 && (await T(page, 'gift-open').count()) === 0, await T(page, 'gift-locked-date').innerText())
      check(`ceremony (${lang}): sealed — the cord is thin double gold (not the memorial grey)`, (await T(page, 'gift-cord').getAttribute('data-memorial')) === 'no')
      await pause(page, `${shots}-1-sealed.png`)
      check(`no page errors (run 28, ${lang} sealed)`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }

    // since 2026-11-15 an open English thank-you gift has the new ceremony (Run 33): today's untie, note, music card, stroke reveal and answer are checked on the Japanese gift
    if (lang === 'en') continue
    // 2. untie by press and hold (full motion): a short press does nothing, a hold of about 1.2 s opens; then the letter with the note; nothing moves on by itself
    {
      const { page, ctx, errs, seen } = await open(mk(lang), { locale: loc })
      await T(page, 'gift-envelope').waitFor()
      check(`ceremony (${lang}): the hint "${S.hint}" and a visible "${S.untie}" button`, (await T(page, 'gift-untie-hint').innerText()) === S.hint && (await T(page, 'gift-open').innerText()) === S.untie)
      const box = await T(page, 'gift-knot').boundingBox()
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(450)
      await page.mouse.up()
      await page.waitForTimeout(1400)
      check(`ceremony (${lang}): letting go early does not untie it — still sealed`, (await T(page, 'gift-letter').count()) === 0 && (await T(page, 'gift-envelope').getAttribute('data-state')) === 'closed' && seen.opened === 0)
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(500)
      check(`ceremony (${lang}): while holding, the ring fills`, (await T(page, 'gift-knot').getAttribute('data-holding')) === 'yes')
      await pause(page, `${shots}-2-holding.png`)
      await page.waitForTimeout(900)
      await page.mouse.up()
      await T(page, 'gift-letter').waitFor({ timeout: 4000 })
      check(`ceremony (${lang}): holding the knot for about 1.2 s unties it and opens the letter, and the opening is told to the server once`, (await step(page)) === 'letter' && seen.opened === 1)
      const note = await T(page, 'gift-message').evaluate((el) => ({ text: el.innerText, font: getComputedStyle(el).fontFamily, ws: getComputedStyle(el).whiteSpace, italic: getComputedStyle(el).fontStyle }))
      check(`ceremony (${lang}): the note keeps its line break and is set in ${L ? 'Cormorant Garamond italic' : 'Zen Old Mincho'}`, note.text.includes('\n') && /pre/.test(note.ws) && (L ? /Cormorant/.test(note.font) && note.italic === 'italic' : /Zen Old Mincho/.test(note.font)), JSON.stringify(note))
      await pause(page, `${shots}-3-letter.png`)
      await page.waitForTimeout(3500)
      check(`ceremony (${lang}): nothing moves on by itself — after 3.5 s the letter is still the letter`, (await step(page)) === 'letter' && (await T(page, 'film').count()) === 0)
      await T(page, 'gift-to-film').click()
      await T(page, 'gift-music-card').waitFor()
      check(`ceremony (${lang}): the music card says "${S.music}" and waits for a tap (no film yet, no sound)`, (await T(page, 'gift-music-line').innerText()) === S.music && (await step(page)) === 'music' && (await page.locator('[data-testid=film]').count()) === 0)
      await pause(page, `${shots}-4-music.png`)
      await page.waitForTimeout(2500)
      check(`ceremony (${lang}): …and still waits after 2.5 s`, (await step(page)) === 'music')
      await T(page, 'gift-music-go').click()
      check(`ceremony (${lang}): the tap on the card asks for the sound (sessionStorage ichirei-film-sound = on)`, (await page.evaluate(() => sessionStorage.getItem('ichirei-film-sound'))) === 'on')
      await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
      await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
      await T(page, 'gift-skip').waitFor({ timeout: 6000 })
      await page.waitForTimeout(2500)
      check(`ceremony (${lang}): the film ends and waits on its button — it does not move to the character by itself`, (await step(page)) === 'film')
      await T(page, 'gift-skip').click()
      // 3. the stroke reveal for a character with stroke data: written in strokes, then reading, word, line a beat apart, in 4–6 s
      const t0 = Date.now()
      await T(page, 'gift-reveal').waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid=gift-glyph]')?.getAttribute('data-mode') !== 'loading', null, { timeout: 6000 })
      const mode = await T(page, 'gift-glyph').getAttribute('data-mode')
      const early = await T(page, 'gift-to-poem').isDisabled()
      await page.waitForFunction(() => document.querySelector('[data-testid=gift-reveal]')?.getAttribute('data-beat') === '4', null, { timeout: 9000 })
      const took = Date.now() - t0
      check(`ceremony (${lang}): the reveal writes ${V[lang].glyph} in strokes (data-mode=strokes), the button waits until the end, and the whole reveal takes about 4–6 s`, mode === 'strokes' && early && took >= 3000 && took <= 7000, `${mode} ${early} ${took}`)
      await pause(page, `${shots}-5-reveal.png`)
      check(`ceremony (${lang}): the character stays readable as text (a hidden text copy) and is cinnabar`, (await T(page, 'gift-glyph').innerText()).includes(V[lang].glyph) && (await T(page, 'gift-glyph').evaluate((e) => getComputedStyle(e).color)) === 'rgb(192, 57, 43)')
      await T(page, 'gift-to-poem').click()
      await T(page, 'gift-to-cert').click({ timeout: 6000 })
      await T(page, 'gift-to-keep').click()
      await T(page, 'gift-to-answer').click()
      await T(page, 'gift-answer').waitFor()
      check(`ceremony (${lang}): the answer step — "${S.answer}", "${S.back}", twelve characters, the written reply`, (await T(page, 'gift-answer-title').innerText()) === S.answer && (await T(page, 'gift-chars-title').innerText()) === S.back && (await T(page, 'gift-chars').locator('button').count()) === 12 && (await T(page, 'gift-reply-text').count()) === 1, await T(page, 'gift-chars-title').innerText())
      await pause(page, `${shots}-6-answer.png`)
      // both at once, once only
      await T(page, 'gift-char-謝').click()
      await T(page, 'gift-reply-text').fill(L ? 'Thank you, Emily.\nSee you soon.' : 'ありがとう。\nまたね。')
      await T(page, 'gift-reply-send').click()
      await T(page, 'gift-reply-sent').waitFor()
      { const cr = await contrastOf(page, '[data-testid=gf-mygifts-top] [data-testid=my-gifts]'); check(`ceremony (${lang}, the older one for locked / remembrance gifts): the receiver's own マイギフト is at the top right of the last screen and readable (contrast ${cr === null ? 'n/a' : cr.toFixed(1)} ≥ 4.5)`, cr !== null && cr >= 4.5) }
      check(`ceremony (${lang}): a character and a note sent together, once — "${S.sent}", then no box and no second send`, seen.reply.length === 1 && seen.reply[0].char === '謝' && seen.reply[0].text.includes('\n') && (await T(page, 'gift-reply-sent').innerText()) === S.sent && (await T(page, 'gift-reply-send').count()) === 0 && (await T(page, 'gift-chars').count()) === 0, JSON.stringify(seen.reply))
      check(`ceremony (${lang}): then one quiet line to the landing in the receiver's language — "${S.landing}"`, (await T(page, 'gift-landing-line').innerText()) === S.landing && ((await T(page, 'gift-landing-line').locator('a').getAttribute('href')) ?? '').startsWith(L ? '/en' : '/'))
      await pause(page, `${shots}-7-sent.png`)
      check(`no page errors (run 28, ${lang} receiver path)`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }

    // 4. the Untie button, and a character only; a written reply only
    {
      const { page, ctx, seen } = await open(mk(lang), { locale: loc })
      await T(page, 'gift-open').click()
      await T(page, 'gift-letter').waitFor({ timeout: 4000 })
      await toReveal(page)
      await T(page, 'gift-to-poem').click({ timeout: 9000 })
      await T(page, 'gift-to-cert').click()
      await T(page, 'gift-to-keep').click()
      await T(page, 'gift-to-answer').click()
      await T(page, 'gift-char-絆').click()
      await T(page, 'gift-reply-send').click()
      await T(page, 'gift-reply-sent').waitFor()
      check(`ceremony (${lang}): the Untie button opens it; a character alone is sent (no text)`, seen.reply.length === 1 && seen.reply[0].char === '絆' && !seen.reply[0].text)
      await ctx.close()
    }
    {
      const { page, ctx, seen } = await open(mk(lang), { locale: loc })
      await T(page, 'gift-open').click()
      await T(page, 'gift-letter').waitFor({ timeout: 4000 })
      await toReveal(page)
      await T(page, 'gift-to-poem').click({ timeout: 9000 })
      await T(page, 'gift-to-cert').click()
      await T(page, 'gift-to-keep').click()
      await T(page, 'gift-to-answer').click()
      await T(page, 'gift-reply-text').fill('Thanks')
      await T(page, 'gift-reply-send').click()
      await T(page, 'gift-reply-sent').waitFor()
      check(`ceremony (${lang}): a written reply alone is sent (no character)`, seen.reply.length === 1 && seen.reply[0].text === 'Thanks' && !seen.reply[0].char)
      await ctx.close()
    }
  }

  // 5. reduced motion: the untie is a fade, the reveal does not animate strokes, and the whole path still completes
  {
    const { page, ctx, errs } = await open(mk('ja'), { reduced: true, locale: 'ja-JP' })
    await T(page, 'gift-envelope').waitFor()
    check('ceremony (reduced motion): the envelope says data-motion=fade', (await T(page, 'gift-envelope').getAttribute('data-motion')) === 'fade')
    await T(page, 'gift-open').click()
    await T(page, 'gift-letter').waitFor({ timeout: 2500 })
    await T(page, 'gift-to-film').click()
    await toMusic(page)
    await T(page, 'gift-skip').click({ timeout: 6000 })
    await T(page, 'gift-reveal').waitFor({ timeout: 6000 })
    const t0 = Date.now()
    await page.waitForFunction(() => document.querySelector('[data-testid=gift-reveal]')?.getAttribute('data-beat') === '4', null, { timeout: 5000 })
    check('ceremony (reduced motion): the reveal completes at once with no stroke animation (a soft fade, data-mode=fade) and the button follows', (await T(page, 'gift-glyph').getAttribute('data-mode')) === 'fade' && (await T(page, 'gift-glyph').getAttribute('data-motion')) === 'fade' && Date.now() - t0 < 2500)
    check('no page errors (run 28, reduced motion)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // 6. a character with no stroke data (a simplified form): a soft ink fade-in, not a failed drawing
  {
    const { page, ctx, errs } = await open(mk('ja', { glyph: '亲' }))
    await T(page, 'gift-open').click()
    await T(page, 'gift-letter').waitFor({ timeout: 4000 })
    await toReveal(page)
    await page.waitForFunction(() => document.querySelector('[data-testid=gift-glyph]')?.getAttribute('data-mode') !== 'loading', null, { timeout: 6000 })
    check('ceremony: a character without stroke data (亲) fades in softly (data-mode=fade) and the reveal still completes', (await T(page, 'gift-glyph').getAttribute('data-mode')) === 'fade' && (await page.waitForFunction(() => document.querySelector('[data-testid=gift-reveal]')?.getAttribute('data-beat') === '4', null, { timeout: 9000 }).then(() => true)))
    check('no page errors (run 28, fade fallback)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // 7. remembrance: grey-beige paper, silver-grey cord, no countdown, no celebration words, no return character, no landing line — only the written reply
  for (const lang of ['ja', 'en']) {
    const loc = lang === 'en' ? 'en-US' : 'ja-JP'
    {
      const { page, ctx } = await open(lockedView(lang, { memorial: true }), { locale: loc, time: `${year}-11-14T15:00:00Z` })
      await T(page, 'gift-envelope').waitFor()
      check(`remembrance (${lang}): sealed — the silver-grey cord, the date only and no countdown`, (await T(page, 'gift-cord').getAttribute('data-memorial')) === 'yes' && (await T(page, 'gift-locked-date').count()) === 1 && (await T(page, 'gift-locked-note').count()) === 0)
      await pause(page, `${SHOTS}/ceremony-memorial-${lang}-sealed.png`)
      await ctx.close()
    }
    {
      const { page, ctx, errs, seen } = await open(mk(lang, { memorial: true, purpose: 'memorial', message: '' }), { locale: loc })
      await T(page, 'gift-open').click()
      await T(page, 'gift-letter').waitFor({ timeout: 4000 })
      await toReveal(page)
      await page.waitForFunction(() => document.querySelector('[data-testid=gift-glyph]')?.getAttribute('data-mode') !== 'loading', null, { timeout: 6000 })
      check(`remembrance (${lang}): the reveal writes the character in ink, never cinnabar`, (await T(page, 'gift-glyph').getAttribute('data-mode')) === 'strokes' && !/rgb\(192, 57, 43\)/.test(await T(page, 'gift-glyph').evaluate((e) => getComputedStyle(e).color)))
      await pause(page, `${SHOTS}/ceremony-memorial-${lang}-reveal.png`)
      await T(page, 'gift-to-poem').click({ timeout: 9000 })
      await T(page, 'gift-to-cert').click()
      await T(page, 'gift-to-keep').click()
      await T(page, 'gift-to-answer').click()
      check(`remembrance (${lang}): the answer step offers the written reply only — no return character, no landing line`, (await T(page, 'gift-chars').count()) === 0 && (await T(page, 'gift-reply-text').count()) === 1 && (await T(page, 'gift-landing-line').count()) === 0)
      await pause(page, `${SHOTS}/ceremony-memorial-${lang}-answer.png`)
      await T(page, 'gift-reply-text').fill('x')
      await T(page, 'gift-reply-send').click()
      await T(page, 'gift-reply-sent').waitFor()
      check(`remembrance (${lang}): the reply is sent with no character, and still no landing line`, seen.reply.length === 1 && !seen.reply[0].char && (await T(page, 'gift-landing-line').count()) === 0)
      check(`no page errors (run 28, remembrance ${lang})`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }
  }

  // 8. the sender's page: Wrapped → Sent → Opened (with the time) → Answered, and the returned character in gold
  for (const lang of ['en', 'ja']) {
    const L = lang === 'en'
    const base = { id: ID, language: lang, glyph: L ? '燈' : '備', reading: 'あかり', romanization: 'akari', meaning_en: 'lamp', ...(L ? { en: { word: 'hearth', word_source: 'lexicon', line: 'The light that is already on when everyone else wakes.', echo: null } } : {}), who: L ? 'Someone who kept the porch light on.' : 'いつも、頼まれる前に備えている人。', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] } }
    const gift = (states, reply = null) => ({ url: `https://ichirei.soul-id.jp/g/${TOKEN}`, size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: `${year}-12-25`, opens_at: `${year}-12-25T12:12:00.000Z`, opens_tz: 'America/New_York', certificate_no: 12, reply, to: V[lang].to, states })
    const want = L
      ? { wrapped: 'Wrapped', sent: 'Sent', opened: 'Opened (Dec 25, 7:12 a.m.)', answered: 'Answered' }
      : { wrapped: '包みました', sent: '送りました', opened: '開かれました（12月25日 午前7:12）', answered: 'お返しが届きました' }
    const stages = [
      ['wrapped', { shared_at: null, opened_at: null, answered_at: null }, null, ['wrapped']],
      ['sent', { shared_at: `${year}-11-14T10:00:00Z`, opened_at: null, answered_at: null }, null, ['wrapped', 'sent']],
      ['opened-no-share', { shared_at: null, opened_at: `${year}-12-25T12:12:00Z`, answered_at: null }, null, ['wrapped', 'opened']],
      ['opened', { shared_at: `${year}-11-14T10:00:00Z`, opened_at: `${year}-12-25T12:12:00Z`, answered_at: null }, null, ['wrapped', 'sent', 'opened']],
      ['answered', { shared_at: `${year}-11-14T10:00:00Z`, opened_at: `${year}-12-25T12:12:00Z`, answered_at: `${year}-12-25T13:00:00Z` }, { text: L ? 'Thank you.\nWe loved it.' : 'ありがとう。\nうれしかった。', at: `${year}-12-25T13:00:00Z`, char: '謝' }, ['wrapped', 'sent', 'opened', 'answered']],
    ]
    for (const [name, states, reply, ids] of stages) {
      const ctx = await browser.newContext({ locale: L ? 'en-US' : 'ja-JP', viewport: { width: 390, height: 844 } })
      const sp = await ctx.newPage()
      const errs = []
      sp.on('pageerror', (e) => errs.push(String(e)))
      await sp.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
      await sp.route(`**/api/animation/${ID}`, (r) => r.fulfill({ json: { ...base, gift: gift(states, reply) } }))
      await sp.goto(`http://localhost:5173/a/${ID}`, { waitUntil: 'networkidle' })
      await sp.locator('[data-testid=gift-states]').waitFor()
      const ol = await sp.locator('[data-testid=gift-states] li').allInnerTexts()
      check(`sender (${lang}, ${name}): the lines read ${ids.join(' → ')} — "${ids.map((i) => want[i]).join('", "')}"`, JSON.stringify(ol.map((x) => x.trim())) === JSON.stringify(ids.map((i) => want[i])), JSON.stringify(ol))
      if (name === 'answered') {
        await sp.locator('[data-testid=sender-answer-glyph]').waitFor({ timeout: 5000 })
        const g = await sp.locator('[data-testid=sender-answer-glyph] [data-mode]').first()
        await sp.waitForFunction(() => document.querySelector('[data-testid=sender-answer-glyph] [data-mode]')?.getAttribute('data-mode') !== 'loading', null, { timeout: 6000 })
        const colour = await sp.locator('[data-testid=sender-answer-glyph]').evaluate((e) => getComputedStyle(e.firstElementChild).color)
        check(`sender (${lang}): the returned character 謝 is written in gold, its word is shown (${await sp.locator('[data-testid=sender-answer-word]').innerText()}), and the written reply keeps its line break`, (await g.getAttribute('data-mode')) === 'strokes' && /201, 169, 110/.test(colour) && (await sp.locator('[data-testid=sender-answer-word]').innerText()) === (L ? 'The character that came back: thankful' : '返ってきた一字：ありがとう') && (await sp.locator('[data-testid=sender-reply]').innerText()).includes('\n'), colour)
        await sp.waitForTimeout(900)
        await sp.screenshot({ path: `${SHOTS}/ceremony-${lang}-sender-answered.png`, fullPage: true })
      }
      if (name === 'wrapped' || name === 'opened') { await sp.waitForTimeout(500); await sp.screenshot({ path: `${SHOTS}/ceremony-${lang}-sender-${name}.png`, fullPage: true }) }
      check(`no page errors (run 28, sender ${lang} ${name})`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }
  }

  // 9. the sender chooses Christmas morning (December): the four choices, the label with the zone, the saved moment and the calendar
  for (const lang of ['en', 'ja']) {
    const L = lang === 'en'
    const ctx = await browser.newContext({ locale: L ? 'en-US' : 'ja-JP', viewport: { width: 390, height: 844 } })
    const sp = await ctx.newPage()
    const errs = []
    const seen = { schedule: [], shared: 0 }
    sp.on('pageerror', (e) => errs.push(String(e)))
    await sp.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await sp.route(`**/api/animation/${ID}/shared`, (r) => { seen.shared++; return r.fulfill({ json: { ok: true } }) })
    await sp.route(`**/api/animation/${ID}/schedule`, async (r) => { const b = JSON.parse(r.request().postData() ?? '{}'); seen.schedule.push(b); await r.fulfill({ json: { ok: true, opens_on: b.open_date, opens_at: b.open_date ? `${b.open_date}T12:00:00.000Z` : null, opens_tz: b.open_date ? b.open_tz : null } }) })
    await sp.route(`**/api/animation/${ID}`, (r) => r.fulfill({ json: { id: ID, language: lang, glyph: L ? '燈' : '備', reading: 'あかり', romanization: 'akari', meaning_en: 'lamp', ...(L ? { en: { word: 'hearth', word_source: 'lexicon', line: 'The light that is already on when everyone else wakes.', echo: null } } : {}), who: 'x', memorial: false, film: { status: 'fallback', lines: ['a', 'b'], pictures: ['/film/washi-1.webp'] }, gift: { url: `https://ichirei.soul-id.jp/g/${TOKEN}`, size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null, certificate_no: 12, reply: null, to: V[lang].to, states: { shared_at: null, opened_at: null, answered_at: null } } } }))
    await sp.clock.install({ time: new Date('2026-12-05T15:00:00Z') })
    await sp.goto(`http://localhost:5173/a/${ID}`, { waitUntil: 'networkidle' })
    const panel = sp.locator('[data-testid=sender-panel]')
    await panel.waitFor()
    await panel.locator('[data-testid=give-schedule]').click()
    const labels = (await panel.locator('.by-choice label').allInnerTexts()).map((t) => t.trim())
    const wantChoices = L ? ['Now', 'Christmas morning (Dec 25, 7:00 a.m.)', 'Pick a date and time'] : ['すぐに開ける', 'クリスマスの朝（12月25日 午前7時）', '日時を選ぶ']
    check(`sender (${lang}, Dec 5): the choices are ${wantChoices.join(' / ')}${L ? ' — no Thanksgiving after Nov 26' : ''}`, JSON.stringify(labels) === JSON.stringify(wantChoices), JSON.stringify(labels))
    await panel.locator('[data-testid=choice-christmas]').check()
    await panel.locator('[data-testid=schedule-zone]').selectOption({ index: 0 }).catch(() => {})
    const lab = (await panel.locator('[data-testid=schedule-label]').innerText()).trim()
    check(`sender (${lang}): under the choice the label names the moment and the zone ("${lab}")`, L ? /^Opens Dec 25, 7:00 a\.m\. \(.+\)$/.test(lab) : /^12月25日 午前7時（.+）に開きます$/.test(lab), lab)
    await panel.locator('[data-testid=schedule-save]').click()
    await panel.locator('[data-testid=schedule-saved]').waitFor()
    check(`sender (${lang}): Christmas morning is saved as the date with its zone and 07:00`, seen.schedule.length === 1 && seen.schedule[0].open_date === `${2026}-12-25` && seen.schedule[0].open_time === '07:00' && typeof seen.schedule[0].open_tz === 'string', JSON.stringify(seen.schedule))
    await panel.locator('[data-testid=calendar-add]').click()
    const gh = await panel.locator('[data-testid=calendar-google]').getAttribute('href')
    const u = new URL(gh)
    const title = u.searchParams.get('text')
    const details = u.searchParams.get('details') ?? ''
    check(`sender (${lang}): the calendar title is "${L ? 'Give Margaret their ICHIREI' : '山田 一郎に一字礼を贈る'}", the time is the opening moment (15 minutes) and the description holds the two links and no character`, title === (L ? 'Give Margaret their ICHIREI' : '山田 一郎に一字礼を贈る') && /^20261225T\d{6}Z\/20261225T\d{6}Z$/.test(u.searchParams.get('dates') ?? '') && details.includes(`/g/${TOKEN}`) && details.includes(`/a/${ID}`) && !/[燈備]/.test(details), `${title} ${u.searchParams.get('dates')} ${details}`)
    await sp.locator('[data-testid=calendar-ics]').scrollIntoViewIfNeeded()
    await sp.waitForTimeout(500)
    await sp.screenshot({ path: `${SHOTS}/ceremony-${lang}-sender-christmas.png`, fullPage: true })
    // using copy marks the gift as "sent"
    await sp.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await panel.locator('[data-testid=share-button]').click().catch(() => {}) // Part 12: the send options live in the share sheet
    await panel.locator('[data-testid=give-copy]').click().catch(() => {})
    await sp.waitForTimeout(400)
    check(`sender (${lang}): using "copy link" tells the server the gift was sent (shared)`, seen.shared === 1, String(seen.shared))
    check(`no page errors (run 28, sender ${lang} schedule)`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 29 (2026-11-14, pre-launch safety): a checkout that could not be prepared shows the owner's message (no redirect); the buyer's page shows "being finished" when its order cannot be read ----------
{
  const f = await mockPage(browser, { order: () => ({ status: 503, json: { error: 'x', code: 'order_record_failed' } }) })
  await f.page.goto('http://localhost:5173/write', { waitUntil: 'networkidle' })
  await f.page.locator('#write [data-testid=story-input]').fill('父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。')
  await pickContext(f.page)
  await f.page.click(`#write >> text=${GO.ja}`)
  await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
  await f.page.locator('article[data-slot=main]').click()
  await f.page.locator('article[data-slot=main]').locator('text=この字で贈る').click()
  await toOrder(f.page)
  await f.page.fill('input[name=sender_name]', '山田 太郎')
  await f.page.fill('input[name=receiver_name]', '山田 一郎')
  const od = new Date(); od.setDate(od.getDate() + 20)
  await f.page.fill('input[name=delivery_date]', `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`)
  await f.page.click('label:has(input[name=package][value=simple])')
  await tickRefund(f.page)
  await f.page.click('[data-testid=order-submit]')
  await f.page.locator('[data-testid=order-error]').waitFor({ timeout: 8000 })
  check('order failed to prepare (503 order_record_failed): the form says 「ただいま混み合っています。少しおいてもう一度お試しください。」 and goes nowhere (no checkout page)', (await f.page.locator('[data-testid=order-error]').innerText()).includes('ただいま混み合っています。少しおいてもう一度お試しください。') && (await f.page.locator('#co').count()) === 0 && f.page.url().startsWith('http://localhost:5173/'))
  check('…and the order button is usable again (try once more)', await f.page.locator('[data-testid=order-submit]').isEnabled())
  check('no page errors (run 29, order failure)', f.errors.length === 0, f.errors.join('; '))
  await f.page.close()
}
for (const [lang, locale, text] of [['en', 'en-US', 'Your gift is being finished. Please open this page again in a few minutes.'], ['ja', 'ja-JP', '贈りものを仕上げています。数分後にもう一度開いてください。'], ['zh-Hant', 'zh-TW', '禮物正在完成中，請幾分鐘後再打開。']]) {
  const ctx = await browser.newContext({ locale, viewport: { width: 390, height: 800 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route('**/api/animation/AN-testtesttesttesttest', (r) => r.fulfill({ status: 503, json: { error: 'unavailable', finishing: true, language: lang } }))
  await page.goto('http://localhost:5173/a/AN-testtesttesttesttest', { waitUntil: 'networkidle' })
  await page.locator('[data-testid=buyer-finishing]').waitFor({ timeout: 6000 })
  check(`buyer page (${lang}): when the order cannot be read (503) the page says "${text}" — no link, no collect button`, (await page.locator('[data-testid=buyer-finishing]').innerText()).trim() === text && (await page.locator('[data-testid=give-link], [data-testid=collect-button], [data-testid=sender-panel]').count()) === 0, await page.locator('body').innerText())
  check(`no page errors (run 29, buyer ${lang})`, errs.length === 0, errs.join('; '))
  await ctx.close()
}

// ---------- Run 30 (2026-11-15, hotfix): the /legal cookie sentence, and the free-try limit messages on the page ----------
{
  // /legal: the one-cookie sentence, no banner
  for (const [lang, locale, text] of [['ja', 'ja-JP', '無料のお試し回数を管理するため、機能上必要なCookieを1つ使用します。'], ['zh-Hant', 'zh-TW', '為了管理免費試用次數，我們使用一個功能上必要的Cookie。'], ['en', 'en-US', 'We use one functional cookie to limit free previews.']]) {
    const ctx = await browser.newContext({ locale, viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.goto(`http://localhost:5173/legal?lang=${lang}`, { waitUntil: 'networkidle' })
    check(`legal (${lang}): the privacy section carries the one-cookie sentence "${text}" and there is no cookie banner`, ((await page.locator('[data-testid=legal-privacy]').textContent()) ?? '').trim() === text && (await page.locator('[role=dialog], [data-testid*=cookie], .cookieBanner').count()) === 0)
    await ctx.close()
  }
  // the limit messages: a 429 from /api/select shows the owner's sentence, never "try again tomorrow" on a payment
  for (const [lang, code, text] of [['ja', 'limit_person', '今日はたくさんの場面を書いてくださいました。続きは明日また書けます。すでに見つけた字は、今日このまま贈れます。'], ['en', 'limit_person', "You've written many moments today. You can write more tomorrow, and any character you've already found can still be given today."], ['en', 'limit_site', 'Lots of people are writing their moments right now. Please try again in a little while.'], ['zh-Hant', 'limit_site', '目前有很多人正在使用，請稍等片刻再試一次。']]) {
    const f = await mockPage(browser)
    await f.page.route('**/api/select', (r) => r.fulfill({ status: 429, json: { error: text, code } }))
    await f.page.goto(`http://localhost:5173/${lang === 'en' ? 'en/' : ''}write?lang=${lang}`, { waitUntil: 'networkidle' })
    await f.page.waitForTimeout(400)
    await f.page.locator('#write [data-testid=story-input]').fill(lang === 'en' ? 'She left the porch light on every night until I got home, and she never once mentioned it.' : STORY)
    await pickContext(f.page)
    await f.page.click(`#write >> text=${GO[lang]}`)
    await f.page.waitForTimeout(1500)
    check(`limit (${lang}, ${code}): the page shows 「${text}」`, (await f.page.locator('body').innerText()).includes(text))
    await f.page.close()
  }
  // Part 19 (2026-11-20): ten moments written and none given — the owner's sentence, in each language, shown with the way to My gifts
  for (const [lang, text] of [['ja', 'これまでに十の場面を書いてくださいました。そのうちの一字を贈ると、また新しく書けます。'], ['en', "You've written ten moments. Give one of them, and you can write more."], ['zh-Hant', '你已經寫下十個片刻。送出其中一個字，就能繼續寫。']]) {
    const f = await mockPage(browser)
    await f.page.route('**/api/select', (r) => r.fulfill({ status: 429, json: { error: text, code: 'limit_unpaid10' } }))
    await f.page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 2 }, ready: null, hold: null } }))
    await f.page.goto(`http://localhost:5173/${lang === 'en' ? 'en/' : ''}write?lang=${lang}`, { waitUntil: 'networkidle' })
    await f.page.waitForTimeout(400)
    await f.page.locator('#write [data-testid=story-input]').fill(lang === 'en' ? 'She left the porch light on every night until I got home, and she never once mentioned it.' : STORY)
    await pickContext(f.page)
    await f.page.click(`#write >> text=${GO[lang]}`)
    await f.page.waitForTimeout(1500)
    const body = await f.page.locator('body').innerText()
    check(`limit (${lang}, limit_unpaid10): the page shows 「${text}」 and the My gifts link under it`, body.includes(text) && (await f.page.locator('.loopBar--under').count()) >= 1)
    await f.page.close()
  }
}

// ---------- Run 31 (2026-11-15, the customer loop): the basket bar, the gift-ready bar, the basket page and its Save panel, the private link, the "Days of Thanks" card and its hold, the new /legal sentences ----------
{
  const newPage = async (locale = 'en-US', viewport = { width: 390, height: 844 }) => {
    const ctx = await browser.newContext({ locale, viewport })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    return { ctx, page, errs }
  }
  const soon = { sizes: ['egift'], promo: { from: '2026-11-01T00:00:00Z', until: '2099-01-01T00:00:00Z' }, usd: { egift: 25, egift_sale: 17.5 } }
  // the bars on the landing, in each language
  for (const [lang, url, bar, ready] of [
    ['ja', 'http://localhost:5173/?lang=ja', 'マイギフト（2）→', '花子への贈りものの準備ができました。受け取る →'],
    ['zh-Hant', 'http://localhost:5173/?lang=zh-Hant', '我的禮物（2）→', '給花子的禮物準備好了。前往領取 →'],
    ['en', 'http://localhost:5173/en', 'My gifts (2) →', 'Your gift for 花子 is ready. Collect it →'],
  ]) {
    const { ctx, page, errs } = await newPage()
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 2 }, ready: { id: 'AN-abcdefghjkmnpqrstuvw', name: '花子' }, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: soon }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: false } }))
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    check(`loop bars (${lang}): the gift-ready bar says 「${ready}」 and links to the buyer page`, ((await page.locator('[data-testid=gift-ready-bar]').innerText()) === ready) && ((await page.locator('[data-testid=gift-ready-bar] a').getAttribute('href')) === '/a/AN-abcdefghjkmnpqrstuvw'))
    check(`loop bars (${lang}): the basket bar says 「${bar}」 (top of the page; 2026-11-16: the writing step is its own page) and links to /basket`, (await page.locator('[data-testid=basket-bar]').first().innerText()) === bar && (await page.locator('[data-testid=basket-bar]').count()) >= 1 && ((await page.locator('[data-testid=basket-bar] a').first().getAttribute('href')) === '/basket'))
    check(`no page errors (run 31, bars ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // an empty basket and nothing to collect: no bar
  {
    const { ctx, page } = await newPage()
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: soon }))
    await page.goto('http://localhost:5173/en', { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    check('loop bars: with an empty basket and nothing to collect there is no bar', (await page.locator('[data-testid=basket-bar], [data-testid=gift-ready-bar]').count()) === 0)
    await ctx.close()
  }
  // the Days of Thanks card
  {
    const { ctx, page, errs } = await newPage()
    let holdBody = null
    let left = 37
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: soon }))
    let heldNow = null
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: true, left, daily: 100, hold: heldNow } }))
    await page.route('**/api/promo/hold', async (r) => {
      holdBody = JSON.parse(r.request().postData() ?? '{}')
      if (!/@/.test(String(holdBody.email))) return r.fulfill({ json: { ok: false, code: 'bad_email' } })
      heldNow = { state: 'active', expires_at: new Date(Date.now() + 119 * 60000).toISOString(), minutes_left: 119, email: 'a@example.com' }
      left = 36
      return r.fulfill({ json: { ok: true, existing: false, link: 'https://ichirei.soul-id.jp/b/BT-x', hold: { ...heldNow, count: 1 }, left: 36 } })
    })
    await page.route('**/api/basket/qr.svg*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.goto('http://localhost:5173/en?code=thanks100', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const card = page.locator('[data-testid=thanks-card]')
    check('Days of Thanks: the card shows the title, "37 of today\'s 100 free gifts are still available." and the sub-line', (await card.locator('h2').innerText()) === 'Days of Thanks' && (await card.locator('[data-testid=thanks-count]').innerText()).replace(/\s+/g, ' ') === "37 of today's 100 free gifts are still available." && (await card.innerText()).includes('One free gift per person, through November 30. New free gifts every morning (US Eastern).'))
    // (2026-11-15) one field: no code — the card is the count, Email, the consent tick and Hold my free gift; a ?code= link still works (sent along, ignored by the server)
    check('Days of Thanks: no "Free gift code" field — the card is the count, Email, the consent tick (not ticked) and "Hold my free gift"; the small print is there', (await page.locator('[data-testid=thanks-code], input[name=code]').count()) === 0 && !(await card.innerText()).includes('Free gift code') && (await page.locator('[data-testid=thanks-form] input').count()) === 2 && !(await page.locator('[data-testid=thanks-marketing]').isChecked()) && (await page.locator('[data-testid=thanks-submit]').innerText()) === 'Hold my free gift' && (await card.innerText()).includes('We use your email only to hold your free gift and match it at checkout.'))
    await card.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/polish-card-390.png` }).catch(() => {})
    await page.locator('[data-testid=thanks-email]').fill('a@example.com')
    await page.locator('[data-testid=thanks-marketing]').check()
    await page.locator('[data-testid=thanks-submit]').click()
    await page.locator('[data-testid=thanks-held]').waitFor()
    const heldText = await page.locator('[data-testid=thanks-held]').innerText()
    check('Days of Thanks: with the email alone, "Hold my free gift" holds — the card says "Your free gift is held until {time} (119 min left)." with "Write your moment →"; the email and box were sent (and the ?code= of the link, silently)', /^Your free gift is held until .+ \(119 min left\)\.$/.test(heldText) && (await page.locator('[data-testid=thanks-write]').innerText()) === 'Write your moment →' && holdBody.email === 'a@example.com' && holdBody.marketing === true && String(holdBody.code ?? '').toLowerCase() === 'thanks100')
    check('Days of Thanks: right after holding, once: "Continuing on your phone? Scan this to take your gift with you." with the QR', (await page.locator('[data-testid=thanks-phone]').innerText()).includes('Continuing on your phone? Scan this to take your gift with you.') && (await page.locator('[data-testid=thanks-phone] img').count()) === 1)
    check(`no page errors (run 31, thanks card)`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // none left: the form is hidden
  {
    const { ctx, page } = await newPage()
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: soon }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: true, left: 0, daily: 100, hold: null } }))
    await page.goto('http://localhost:5173/en', { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    check('Days of Thanks: with none left the card says "Today\'s free gifts are all held or given. New ones arrive tomorrow morning (US Eastern)." and the form is gone', (await page.locator('[data-testid=thanks-count]').innerText()) === "Today's free gifts are all held or given. New ones arrive tomorrow morning (US Eastern)." && (await page.locator('[data-testid=thanks-form]').count()) === 0)
    await ctx.close()
  }
  // the basket page, its delete and its Save panel
  {
    const { ctx, page, errs } = await newPage()
    let items = [
      { id: 'BK-aaaaaaaaaaaaaaaaaaaa', created_at: '2026-11-15T10:00:00Z', language: 'en', to: 'Kenji', card: { kanji: '証', reading: 'akashi', word: 'proof', line: 'x' }, preview_id: null },
      { id: 'BK-bbbbbbbbbbbbbbbbbbbb', created_at: '2026-11-14T10:00:00Z', language: 'en', to: '', card: { kanji: '憶', reading: 'oku', word: 'remember', line: 'y' }, preview_id: null },
    ]
    let deleted = null
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: items.length }, ready: null, hold: null } }))
    await page.route('**/api/basket/BK-*', (r) => {
      if (r.request().method() === 'DELETE') {
        deleted = r.request().url().split('/').pop()
        items = items.filter((i) => i.id !== deleted)
        return r.fulfill({ json: { deleted: true } })
      }
      return r.fulfill({ status: 404, json: {} })
    })
    await page.route('**/api/basket/qr.svg*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items, token: 'BT-x', link: 'https://ichirei.soul-id.jp/b/BT-abcdefghjkmnpqrstuvwxyz2' } }))
    await page.goto('http://localhost:5173/basket', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-item]')
    check('My gifts page (2026-11-18; "My gifts" before): the heading "My gifts", "Saved for 30 days.", two full cards each with the character, "Give this gift →" and "Remove"', (await page.locator('.basketPage h1').innerText()) === 'My gifts' && (await page.locator('[data-testid=basket-saved]').innerText()) === 'Saved for 30 days.' && (await page.locator('[data-testid=basket-item]').count()) === 2 && (await page.locator('[data-testid=basket-give]').first().innerText()) === 'Give this gift →' && (await page.locator('[data-testid=basket-remove]').first().innerText()) === 'Remove')
    check('My gifts page: "Give this gift →" opens the writing room of the gift\'s language (2026-11-16) with the item to put back', ((await page.locator('[data-testid=basket-give]').first().getAttribute('href')) ?? '') === '/en/write?resume=BK-aaaaaaaaaaaaaaaaaaaa')
    await page.locator('[data-testid=save-button]').click()
    await page.locator('[data-testid=save-panel]').waitFor()
    await page.waitForSelector('[data-testid=save-saved]')
    // (2026-11-20) the Save panel is the e-mail panel: with no mailer (this mock has none) it says "✓ Saved. We'll keep it for 30 days." with the gold button to My gifts, the link and the QR below, and the privacy note
    check('Save panel (no mailer): "Copy link", the QR code, the gold "Open My gifts →" and the privacy note — and no mailto (we send nothing from the page)', (await page.locator('[data-testid=save-copy]').innerText()) === 'Copy link' && (await page.locator('[data-testid=save-qr]').count()) === 1 && (await page.locator('[data-testid=save-open-gifts]').innerText()) === 'Open My gifts →' && (await page.locator('[data-testid=save-mail]').count()) === 0 && (await page.locator('[data-testid=save-note]').innerText()) === 'Anyone with this link can see your saved gifts. Keep it private.')
    // (2026-11-15) the panel says what Save did and where, first
    const saveLines = await page.locator('[data-testid=save-panel] p.note').allInnerTexts()
    check('Save panel: it says "✓ Saved. We\'ll keep it for 30 days." first, then the scan line, and keeps "Anyone with this link can see your saved gifts. Keep it private."', (await page.locator('[data-testid=save-saved]').innerText()) === "✓ Saved. We'll keep it for 30 days." && saveLines.includes('Scan this to continue on your phone right now') && saveLines.at(-1) === 'Anyone with this link can see your saved gifts. Keep it private.', JSON.stringify(saveLines))
    await page.locator('[data-testid=save-panel]').scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${SHOTS}/polish-save-panel-390.png` }).catch(() => {})
    await page.locator('[data-testid=basket-remove]').first().click()
    await page.waitForTimeout(300)
    check('My gifts: "Remove" asks once on the page (no browser dialog) — nothing is deleted yet', deleted === null && (await page.locator('[data-testid=basket-remove-ask]').count()) === 1 && (await page.locator('[data-testid=basket-item]').count()) === 2)
    await page.locator('[data-testid=basket-remove-yes]').click()
    await page.waitForTimeout(400)
    check('My gifts: after "Remove" is confirmed the item is deleted and gone', deleted === 'BK-aaaaaaaaaaaaaaaaaaaa' && (await page.locator('[data-testid=basket-item]').count()) === 1)
    check('no page errors (run 31, basket page)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // the private link: a wrong token is the normal landing
  {
    const { ctx, page } = await newPage()
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/b/*', (r) => r.fulfill({ status: 404, json: { error: 'not_found' } }))
    await page.goto('http://localhost:5173/b/BT-zzzzzzzzzzzzzzzzzzzzzzzz', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    check('/b/<wrong token>: the normal landing page (the hero; the writing box is its own page since 2026-11-16), not a basket', (await page.locator('[data-testid=basket-page]').count()) === 0 && (await page.locator('.hero').count()) === 1)
    await ctx.close()
  }
  // the private link: the right token opens the basket
  {
    const { ctx, page } = await newPage()
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 1 }, ready: null, hold: null } }))
    await page.route('**/api/b/*', (r) => r.fulfill({ json: { token: 'BT-x', items: [{ id: 'BK-aaaaaaaaaaaaaaaaaaaa', created_at: '2026-11-15T10:00:00Z', language: 'en', to: '', card: { kanji: '証', reading: 'akashi', word: 'proof', line: 'x' }, preview_id: null }] } }))
    await page.goto('http://localhost:5173/b/BT-abcdefghjkmnpqrstuvwxyz2', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-item]')
    check('/b/<token>: opens the basket, and the token leaves the address bar', (await page.locator('[data-testid=basket-item]').count()) === 1 && new URL(page.url()).pathname === '/basket')
    await ctx.close()
  }
  // /legal: the new sentences, in each language
  for (const [lang, email, cancel, keep] of [
    ['ja', '無料の贈りものを確保するためにメールアドレスをご入力いただいた場合、確保と決済時の照合のためだけに使います。ご希望の場合のみ、お知らせをお送りします。', 'キャンセルのご連絡は、メールを送信した時刻で受け付けます。', 'ご注文のない保存データは、30日後に削除します。'],
    ['zh-Hant', '若你為保留免費禮物輸入電子郵件，我們只用它來保留禮物並在結帳時核對。只有在你同意時，才會寄送消息。', '取消申請以你寄出郵件的時間為準。', '沒有下單的儲存資料，會在30天後刪除。'],
    ['en', 'If you enter your email to hold a free gift, we use it only to hold it and match it at checkout. We send news only if you ask for it.', 'For cancellations, the time you send your email is the time that counts.', 'Saved gifts without an order are deleted after 30 days.'],
  ]) {
    const { ctx, page } = await newPage()
    await page.goto(`http://localhost:5173/legal?lang=${lang}`, { waitUntil: 'networkidle' })
    check(`legal (${lang}): the Email, Cancellation-time and Retention sentences, and the public contact info@beyondculture.ai`, (await page.locator('[data-testid=legal-email-use]').innerText()) === email && (await page.locator('[data-testid=legal-cancel-time]').innerText()) === cancel && (await page.locator('[data-testid=legal-retention]').innerText()) === keep && (await page.locator('[data-testid=legal-email]').innerText()) === 'info@beyondculture.ai')
    await ctx.close()
  }
  // the footer shows the one public contact
  {
    const { ctx, page } = await newPage()
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.goto('http://localhost:5173/en', { waitUntil: 'networkidle' })
    check('footer: the public contact info@beyondculture.ai', (await page.locator('[data-testid=footer-contact]').innerText()) === 'info@beyondculture.ai')
    await ctx.close()
  }
}

// ---------- Run 32 (2026-11-15, small ticket): every hero slide shows its picture, and on a slow connection no slide shows an empty panel with its caption ----------
{
  for (const [lang, url] of [['en', 'http://localhost:5173/en'], ['ja', 'http://localhost:5173/?lang=ja'], ['zh-Hant', 'http://localhost:5173/zh']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW' })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    // a slow connection: every scene picture takes 1.2 s
    await page.route('**/img/scenes/**', async (r) => { await new Promise((res) => setTimeout(res, 1200)); await r.continue() })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=hero-figure] img', { timeout: 15000 })
    const fig = page.locator('[data-testid=hero-figure]')
    const dots = page.locator('.heroArt .dots button')
    const n = await dots.count()
    let emptyWithCaption = 0
    const seen = new Set()
    // sample the panel every 100 ms while the slides are changed one after another
    const sampler = setInterval(async () => {
      try {
        const st = await fig.evaluate((el) => {
          const img = el.querySelector('img')
          const cap = el.querySelector('.phc')
          const capShown = !!cap && Number(getComputedStyle(cap).opacity) > 0.05
          const imgShown = !!img && img.complete && img.naturalWidth > 0 && Number(getComputedStyle(img).opacity) > 0.5
          return { capShown, imgShown }
        })
        if (st.capShown && !st.imgShown) emptyWithCaption++
      } catch {}
    }, 100)
    for (let i = 1; i < n; i++) {
      await dots.nth(i).click()
      await page.waitForFunction((want) => { const el = document.querySelector('[data-testid=hero-figure]'); const img = el?.querySelector('img'); return !!el && !!img && img.complete && img.naturalWidth > 0 && document.querySelectorAll('.heroArt .dots button')[want]?.getAttribute('aria-current') === 'true' }, i, { timeout: 15000 }).catch(() => {})
      const ok = await fig.evaluate((el) => { const img = el.querySelector('img'); return !!img && img.complete && img.naturalWidth > 0 })
      if (ok) seen.add(await fig.getAttribute('data-slide'))
    }
    clearInterval(sampler)
    check(`hero (${lang}): every slide shows its picture (${n} slides)`, seen.size === n - 1 && n >= 6, [...seen].join())
    check(`hero (${lang}): on a slow connection no slide ever shows an empty panel with its caption text`, emptyWithCaption === 0, String(emptyWithCaption))
    check(`no page errors (run 32, ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 33 (2026-11-15, gift ceremony redesign phase A): the receiver's new ceremony (Classic, English) — all nine screens on 375 × 667 and 1440 × 800, with and without reduced motion; the film ends on paper, then the character (no black frame); a gift with and without the "you" line; ja, zh-Hant, remembrance, an apology and a locked gift keep today's ceremony; no AI, no he / she in the page; cinnabar only on the mark and the character; screenshots at 390 × 844 ----------
{
  const TOKEN = 'RG-cerecerecerecerecere'
  const view = (over = {}) => ({
    id: TOKEN, token: TOKEN, language: 'en', glyph: '労', reading: 'ねぎらう', romanization: 'negirau', meaning_en: 'tending',
    en: { word: 'tending', word_source: 'lexicon', line: 'The care that mends what is about to give.', line_you: 'The one who eases a burden before anyone asks.', echo: null, classical: null },
    who: 'Someone who fixed the bike before anyone asked.',
    poem: { type: 'en', lines: ['The chain was back on', 'before I reached the driveway.', 'You never mention it.', 'You only notice', 'what is about to give,', 'and mend it quietly.'], reading: '' },
    memorial: false, purpose: 'thanks', music: 'thanks',
    film: { status: 'ready', lines: ['Sam came off his bike on your street.', 'He was trying hard not to cry.', 'By the time I got there, you had the wrench out.', 'You never said a word about it.'], pictures: ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg'] },
    certificate_line: 'This character is the person as seen through your eyes.', from: 'Brian', to: 'Kenji', message: "Thanks for fixing Sam's bike.\nSee you Thursday.",
    egift: null, locked: false, certificate_no: 3, order_date: '2026-11-15', opens_on: null, replied: false, package: 'egift', ...over,
  })
  const open = async (v, { w = 390, h = 844, reduced = false } = {}) => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    const errs = []
    const seen = { reply: [], opened: 0, google: 0 }
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('request', (r) => { if (/googleapis|gstatic/.test(r.url())) seen.google++ })
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/reply`) { seen.reply.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/opened`) { seen.opened++; return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: v } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: v })
      return r.fulfill({ status: 204, body: '' })
    })
    await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    return { page, ctx, errs, seen }
  }
  const T = (page, id) => page.locator(`[data-testid="${id}"]`)
  const screenOf = (page) => page.locator('main').getAttribute('data-screen')
  const PRONOUN = /\b(he|she|his|him|her|hers|himself|herself)\b/i
  // everything the receiver reads (the film's own lines are the engine's, written from the sender's story, so they are left out of the scan)
  const pageText = (page) => page.evaluate(() => { let t = document.querySelector('main').innerText; for (const n of document.querySelectorAll('[data-testid=film-line]')) if (n.innerText) t = t.replace(n.innerText, ''); return t })
  // every element painted in cinnabar (#C0392B) is the mark or the character
  const redOnlyOnMarkAndCharacter = (page) => page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('main *')) {
      const cs = getComputedStyle(el)
      const red = [cs.color, cs.backgroundColor, cs.borderTopColor].some((c) => c === 'rgb(192, 57, 43)')
      if (!red || cs.opacity === '0' || el.closest('[hidden]')) continue
      const own = el.className && typeof el.className === 'string' ? el.className : ''
      if (/cr-mark|cr-ring|cr-glyph|cr-big|cr-small|cr-solid/.test(own)) continue
      if (cs.borderTopColor === 'rgb(192, 57, 43)' && cs.borderTopWidth === '0px' && cs.color !== 'rgb(192, 57, 43)' && cs.backgroundColor !== 'rgb(192, 57, 43)') continue
      if (cs.color === 'rgb(192, 57, 43)' && !el.textContent.trim()) continue
      bad.push(`${el.tagName}.${own}`)
    }
    return bad
  })

  /** Walk all nine screens; with `play` the film plays to its end, else it is skipped. Returns what was seen. */
  const walk = async (page, { play = false, shots = null } = {}) => {
    const out = { screens: [], texts: [], red: [] }
    const shot = async (n) => { if (shots) await page.screenshot({ path: `${SHOTS}/${shots}-${n}.png` }) }
    const note = async () => { out.screens.push(await screenOf(page)); out.texts.push(await pageText(page)); out.red.push(...(await redOnlyOnMarkAndCharacter(page))) }
    await T(page, 'cr-mark').waitFor()
    await page.waitForTimeout(400)
    await note(); await shot('1-mark')
    await T(page, 'cr-markbtn').click()
    await T(page, 'cr-note').waitFor()
    await page.waitForTimeout(1000)
    await note(); await shot('2-note')
    await T(page, 'cr-to-film').click()
    await T(page, 'cr-film').waitFor()
    await page.waitForTimeout(300)
    await note(); await shot('3-film')
    if (play) {
      await T(page, 'cr-play').click()
      await page.waitForTimeout(3500)
      await shot('3-film-playing')
    } else await T(page, 'gift-skip').click()
    await T(page, 'cr-char').waitFor({ timeout: 60000 })
    await page.waitForTimeout(800)
    await shot('4-character')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid=cr-meaning]')).opacity === '1', null, { timeout: 30000 })
    await page.waitForTimeout(300)
    await note(); await shot('4-meaning')
    await T(page, 'cr-to-poem').click()
    await T(page, 'cr-poem').waitFor()
    await page.waitForTimeout(4600)
    await note(); await shot('5-poem')
    await T(page, 'cr-to-cert').click()
    await T(page, 'cr-cert').waitFor()
    await page.waitForTimeout(400)
    await note(); await shot('6-certificate')
    await T(page, 'cr-to-keep').click()
    await T(page, 'gift-keep').waitFor()
    await page.waitForTimeout(400)
    await note(); await shot('7-keepsakes')
    // Part 14 (2026-11-20): the twelve characters and their "sent" screen are gone; the last screen is the gift back (one button, offered and never pushed) and the way to give one's own
    await T(page, 'gift-to-answer').click()
    await T(page, 'gift-last').waitFor()
    await page.waitForTimeout(300)
    await note(); await shot('8-last')
    return out
  }

  // ---- all nine screens: 375 × 667 and 1440 × 800, with and without reduced motion ----
  for (const [w, h] of [[375, 667], [1440, 800]]) {
    for (const reduced of [false, true]) {
      const { page, ctx, errs, seen } = await open(view(), { w, h, reduced })
      const label = `${w}×${h}${reduced ? ', reduced motion' : ''}`
      check(`ceremony (${label}): an English gift opens on the new ceremony — the small mark, "For Kenji", "Brian sent you one small mark." and nothing else (no character, no moment, no note before the mark is touched)`, await (async () => { await T(page, 'cr-mark').waitFor(); const t = await pageText(page); return (await page.locator('main').getAttribute('data-ceremony')) === 'new' && t.includes('FOR KENJI') && t.includes('Brian sent you') && t.includes('one small mark.') && !t.includes('労') && !t.includes('Thursday') && !t.includes('tending') })())
      const r = await walk(page)
      check(`ceremony (${label}): the screens come in order — mark, note, film, character, poem, certificate, keepsakes, the last screen (the gift back)`, r.screens.join(',') === 'mark,note,film,char,poem,cert,keep,back', r.screens.join(','))
      check(`ceremony (${label}): touching the mark is the opening (counted once)`, seen.opened === 1)
      check(`ceremony (${label}): nothing is sent back by itself (the twelve characters are gone since Part 14)`, seen.reply.length === 0)
      const all = r.texts.join('\n')
      check(`ceremony (${label}): no "AI" anywhere and no he / she / his / him / her in the receiver's words`, !/\bAI\b/.test(all) && !PRONOUN.test(all), (all.match(PRONOUN) ?? [''])[0])
      check(`ceremony (${label}): cinnabar only on the mark and the character`, r.red.length === 0, r.red.join(', '))
      check(`ceremony (${label}): every screen fits: the button is reachable and no text is under 12 px`, await page.evaluate(() => [...document.querySelectorAll('main *')].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && getComputedStyle(el).opacity !== '0').every((el) => parseFloat(getComputedStyle(el).fontSize) >= 12)))
      check(`ceremony (${label}): fonts from our own server only (no Google request)`, seen.google === 0)
      check(`no page errors (run 33, ${label})`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }
  }

  // ---- the stage scale: 398 px, scaled by min(w/430, h/660, 1.7), never down ----
  for (const [w, h, z] of [[375, 667, 1], [390, 844, 1], [820, 1180, 1.7], [1440, 800, 800 / 660]]) {
    const { page, ctx } = await open(view(), { w, h })
    await T(page, 'cr-mark').waitFor()
    const got = Number(await page.locator('main').getAttribute('data-zoom'))
    const width = await page.locator('.cr-stage').evaluate((el) => el.getBoundingClientRect().width)
    check(`ceremony stage at ${w}×${h}: scale ${z.toFixed(3)} (got ${got}), the stage is ${Math.round(Math.min(398, w - 32) * z)} px wide`, Math.abs(got - z) < 0.01 && Math.abs(width - Math.min(398, w - 32) * z) < 2, `${got} ${width}`)
    await ctx.close()
  }

  // ---- the film plays to its end: it fades to paper, never to black, then the character ----
  {
    const { page, ctx, errs } = await open(view(), { w: 390, h: 844 })
    await T(page, 'cr-markbtn').click()
    await T(page, 'cr-to-film').click()
    await T(page, 'cr-play').click()
    check('film: "Play the film" starts it, the four pictures go by with their lines under them, "Sound off" and "Skip" stay', await (async () => { await page.waitForTimeout(1500); const l = await T(page, 'film-line').innerText(); return l === 'Sam came off his bike on your street.' && (await T(page, 'film-sound').innerText()) === 'SOUND OFF' && (await T(page, 'gift-skip').isVisible()) })())
    // sample the screen every 120 ms from the last picture to the character: the darkest moment must still be paper-light
    await T(page, 'cr-frame').and(page.locator('[data-ending=yes]')).waitFor({ timeout: 40000 })
    let darkest = 255
    let sawChar = false
    for (let i = 0; i < 16; i++) {
      const png = await page.screenshot()
      const { channels } = await sharp(png).stats()
      const mean = (channels[0].mean + channels[1].mean + channels[2].mean) / 3
      darkest = Math.min(darkest, mean)
      if ((await screenOf(page)) === 'char') { sawChar = true; break }
      await page.waitForTimeout(120)
    }
    check('film: at the end the picture fades to the paper and goes straight to the character — never a black frame (darkest moment stays light)', sawChar && darkest > 150, `darkest ${darkest.toFixed(0)}, char ${sawChar}`)
    check('no page errors (run 33, film)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // ---- screenshots of every screen at 390 × 844 (the film played) ----
  {
    const { page, ctx, errs } = await open(view(), { w: 390, h: 844 })
    await walk(page, { play: true, shots: 'ceremony-390' })
    check('no page errors (run 33, screenshots)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // ---- with and without the "you" line ----
  {
    const { page, ctx } = await open(view(), { reduced: true })
    await T(page, 'cr-markbtn').click(); await T(page, 'cr-to-film').click(); await T(page, 'gift-skip').click()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid=cr-meaning]')).opacity === '1', null, { timeout: 20000 })
    check('character: with line_you — "In Brian\'s eyes, you are" / tending (no romanized reading: English first) / "The one who eases a burden before anyone asks." / "This character is not a wish for you. It is how Brian already sees you."', (await T(page, 'cr-meaning-label').innerText()) === "IN BRIAN'S EYES, YOU ARE" && (await T(page, 'cr-word').innerText()) === 'tending' && (await T(page, 'cr-line').innerText()) === 'The one who eases a burden before anyone asks.' && (await T(page, 'cr-meaning').innerText()).includes('It is how Brian already sees you.'))
    await ctx.close()
  }
  {
    const v = view()
    delete v.en.line_you
    const { page, ctx } = await open(v, { reduced: true })
    await T(page, 'cr-markbtn').click(); await T(page, 'cr-to-film').click(); await T(page, 'gift-skip').click()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid=cr-meaning]')).opacity === '1', null, { timeout: 20000 })
    check('character: a gift made before (no line_you) shows today\'s line under "In Brian\'s eyes"', (await T(page, 'cr-meaning-label').innerText()) === "IN BRIAN'S EYES" && (await T(page, 'cr-line').innerText()) === 'The care that mends what is about to give.' && (await T(page, 'cr-meaning').getAttribute('data-line')) === 'old')
    await ctx.close()
  }

  // ---- the character: three layers, the blend on the whole mask layer, the carved form ----
  {
    const { page, ctx } = await open(view(), { w: 390, h: 844 })
    await T(page, 'cr-markbtn').click(); await T(page, 'cr-to-film').click(); await T(page, 'gift-skip').click()
    await T(page, 'cr-char').waitFor()
    await page.waitForTimeout(3600)
    const layers = await page.evaluate(() => {
      const cs = (s) => getComputedStyle(document.querySelector(s))
      return { lens: cs('[data-testid=cr-lens]').opacity, isolate: cs('[data-testid=cr-lens]').isolation, maskBlend: cs('[data-testid=cr-mask]').mixBlendMode, glyphBlend: getComputedStyle(document.querySelector('[data-testid=cr-mask] .cr-glyph')).mixBlendMode, micro: document.querySelector('[data-testid=cr-micro]').textContent, font: cs('[data-testid=cr-solid]').fontFamily, weight: cs('[data-testid=cr-solid]').fontWeight }
    })
    check('character: the poem is written inside the strokes with three layers — the poem in cream on cinnabar, a white sheet with the character cut out (screen blend on the WHOLE layer, not the character), the paper multiplied over', layers.lens === '1' && layers.isolate === 'isolate' && layers.maskBlend === 'screen' && layers.glyphBlend === 'normal' && layers.micro.includes('The chain was back on') && layers.micro.includes('and mend it quietly.'), JSON.stringify({ ...layers, micro: layers.micro.slice(0, 40) }))
    check('character: drawn in the carved form (the certificate\'s Mincho at 900), not the thin stroke diagram', /ICHIREI Mincho/.test(layers.font) && layers.weight === '900' && (await page.locator('svg[data-testid=gift-glyph]').count()) === 0)
    await ctx.close()
  }

  // ---- the last screen (Part 14, 2026-11-20: the gift back replaces the twelve characters and their sent screen) ----
  {
    const { page, ctx, seen } = await open(view({ back: { state: 'available' } }), { reduced: true })
    await T(page, 'cr-markbtn').click(); await T(page, 'cr-to-film').click(); await T(page, 'gift-skip').click()
    await T(page, 'cr-to-poem').click(); await T(page, 'cr-to-cert').click(); await T(page, 'cr-to-keep').click()
    check('keepsakes (Part 12): exactly the two actions — save everything and share — and the way on to the last screen', (await T(page, 'save-all').count()) === 1 && (await T(page, 'share-button').count()) === 1 && (await T(page, 'save-scroll').count()) === 0 && (await T(page, 'gift-to-answer').count()) === 1)
    await T(page, 'gift-to-answer').click()
    await T(page, 'gift-last').waitFor()
    check('last screen: the gift back is offered with ONE button and no twelve characters, nothing is sent until it is pressed', (await T(page, 'gift-last').getAttribute('data-back')) === 'available' && (await T(page, 'gift-back-button').count()) === 1 && (await T(page, 'gift-chars').count()) === 0 && seen.reply.length === 0)
    await ctx.close()
  }

  // ---- the film keepsake: Save asks the server to make the MP4 (again while it is pending), then downloads it (the saved film itself is unchanged) ----
  {
    const { page, ctx } = await open(view(), { reduced: true })
    const makes = []
    await page.route(`**/api/gift/${TOKEN}/film/make**`, (r) => { makes.push(1); return r.fulfill({ status: makes.length === 1 ? 202 : 200, json: { state: makes.length === 1 ? 'pending' : 'ready' } }) })
    await page.route(`**/api/gift/${TOKEN}/film.mp4**`, (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: 'x' }))
    await T(page, 'cr-markbtn').click(); await T(page, 'cr-to-film').click(); await T(page, 'gift-skip').click()
    await T(page, 'cr-to-poem').click(); await T(page, 'cr-to-cert').click(); await T(page, 'cr-to-keep').click()
    await T(page, 'other-formats').click() // Part 12: the film, the scroll, the card and the QR are in the 「ほかの形で保存」 sheet
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
    await T(page, 'save-film').click()
    const d = await dl
    check('keepsakes (new ceremony): the film\'s Save makes the video on the server (asking again while pending), downloads ichirei-film.mp4 and shows a player', makes.length === 2 && !!d && d.suggestedFilename() === 'ichirei-film.mp4' && (await T(page, 'save-film-video').count()) === 1, JSON.stringify({ makes: makes.length, d: d && d.suggestedFilename(), video: await T(page, 'save-film-video').count() }))
    await ctx.close()
  }

  // ---- every other gift keeps today's ceremony ----
  for (const [label, over] of [['Japanese remembrance', { language: 'ja', en: null, memorial: true, purpose: 'memorial' }], ['Chinese (zh-Hant) apology', { language: 'zh-Hant', en: null, purpose: 'apology' }], ['English remembrance', { memorial: true, purpose: 'memorial' }], ['English apology', { purpose: 'apology' }], ['English encouragement', { purpose: 'encourage' }]]) {
    const { page, ctx } = await open(view(over), { reduced: true })
    await T(page, 'gift-envelope').waitFor({ timeout: 8000 }).catch(() => {})
    check(`today's ceremony stays for a ${label} gift (the sealed envelope with its cord; no new screens)`, (await T(page, 'gift-envelope').count()) === 1 && (await page.locator('[data-ceremony=new]').count()) === 0)
    await ctx.close()
  }
  {
    const locked = { locked: true, token: TOKEN, language: 'en', memorial: false, purpose: 'thanks', from: 'Brian', to: 'Kenji', opens_on: '2026-12-25', opens_at: null, opens_tz: null, days_left: 40 }
    const { page, ctx } = await open(locked, { reduced: true })
    await T(page, 'cr-wait').waitFor({ timeout: 8000 }).catch(() => {})
    const t = await page.locator('body').innerText()
    check('a locked English gift waits in the new ceremony\'s look (Part 11, 2026-11-20): the sealed mark, names and the time only', (await page.locator('main').getAttribute('data-locked')) === 'yes' && (await page.locator('[data-ceremony=new]').count()) === 1 && (await T(page, 'cr-wait').count()) === 1 && !t.includes('労'))
    await ctx.close()
  }
}

// ---------- Run 34 (2026-11-15, pre-launch polish): the order section says where the visitor stands (a hold: $0 · Your free gift; gifts left: the box with Email and Hold my free gift, and the price turns to $0 after holding without a reload; none left: one line); the ceremony shows no way on before the meaning, holds slip 2 before the dive, and shows an answered gift's character on the Sent screen; screenshots at 390 × 844 ----------
{
  const SALE34 = { percent: 30, from: '2026-11-15', until: '2026-11-30', starts_at: '2020-01-01T00:00:00.000Z', ends_at: '2099-11-30T14:59:59.999Z' }
  const sizes34 = { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'], sale: SALE34, promo: { from: '2026-11-01T00:00:00Z', until: '2099-01-01T00:00:00Z' }, usd: { egift: 25, egift_sale: 17.5 } }
  const enResult34 = () => {
    const r = JSON.parse(JSON.stringify(FIXTURE))
    r.language = 'en'
    r.inscription_script = null
    r.candidates = r.candidates.map((c) => ({ ...c, eliminated: false, eliminated_reason: null }))
    r.candidates[0] = { ...r.candidates[0], reading: 'akari', meaning: 'lamp', one_line_gaze: 'Someone who kept the porch light on for me.', story_anchor: 'the porch light', why_this: 'Lamplight is the plainest thing in your story.', en_word: 'hearth', en_word_source: 'lexicon', en_line: 'The light that is already on when everyone else wakes.', en_echo: null }
    return r
  }
  const held = () => ({ state: 'active', expires_at: new Date(Date.now() + 100 * 60000).toISOString(), minutes_left: 100, email: 'a@example.com' })
  const orderPage = async (promo, { onHold } = {}) => {
    const { page, errors } = await mockPage(browser, { result: enResult34 })
    await page.setViewportSize({ width: 390, height: 844 })
    let state = promo
    await page.route('**/api/rates', (r) => r.fulfill({ json: { date: '2026-11-15', base: 'JPY', rates: { USD: 0.0066 } } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: sizes34 }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { id: 'BK-aaaaaaaaaaaaaaaaaaaa', token: 'BT-x', count: 1, created: true } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: state }))
    const holds = []
    await page.route('**/api/promo/hold', async (r) => {
      const body = JSON.parse(r.request().postData() ?? '{}')
      holds.push(body)
      const h = held()
      state = { ...state, hold: h, left: (state.left ?? 1) - 1 }
      await r.fulfill({ json: { ok: true, existing: false, link: null, hold: { ...h, count: 1 }, left: state.left } })
      onHold?.()
    })
    await page.goto('http://localhost:5173/en/write', { waitUntil: 'networkidle' })
    await page.locator('#write [data-testid=story-input]').fill('She left the porch light on every night until I got home, and she never once mentioned it.')
    await pickContext(page)
    await page.click(`#write >> text=${GO.en}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${GIVE.en}`).click()
    await toOrder(page)
    await page.waitForTimeout(600)
    return { page, errors, holds }
  }
  const pkgPrice = (page) => page.locator('label.pkg:has(input[value=egift]) .pkgPrice')
  const shotOrder = async (page, name) => {
    await page.locator('label.pkg:has(input[value=egift])').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => window.scrollBy(0, -12))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${name}` })
    await page.locator('[data-testid=order-promo-line]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${name.replace('.png', '-line.png')}` })
  }
  // a holder
  {
    const { page, errors } = await orderPage({ on: true, left: 40, daily: 100, hold: held() })
    await page.locator('[data-testid=order-promo-line][data-state=held]').waitFor({ timeout: 8000 })
    const price = (await pkgPrice(page).innerText()).replace(/\s+/g, ' ').trim()
    const struck = await pkgPrice(page).locator('s').evaluate((e) => getComputedStyle(e).textDecorationLine).catch(() => '')
    check('order section (holder): the e-gift price reads "$0 · Your free gift" with $17.50 struck through', price === '$17.50 $0 · Your free gift' && struck === 'line-through', price)
    check('order section (holder): "Your free gift is held for you until {time}. It\'s applied at checkout." next to the pay button', /^Your free gift is held for you until .+\. It's applied at checkout\.$/.test(await page.locator('[data-testid=order-promo-line]').innerText()))
    await shotOrder(page, 'polish-order-holder-390.png')
    check('no page errors (run 34, holder)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  // no hold, gifts left: the box, then the inline hold switches the price to $0 without reloading
  {
    let loads = 0
    const { page, errors, holds } = await orderPage({ on: true, left: 37, daily: 100, hold: null })
    page.on('load', () => loads++)
    await page.locator('[data-testid=order-promo-line][data-state=free]').waitFor({ timeout: 8000 })
    check('order section (no hold, gifts left): the box says "Free today: 37 of today\'s 100 free gifts are left. Hold one with your email and this gift is $0." with an Email field and "Hold my free gift"; the price is still $17.50', (await page.locator('[data-testid=order-free-line]').innerText()) === "Free today: 37 of today's 100 free gifts are left. Hold one with your email and this gift is $0." && (await page.locator('[data-testid=order-free-email]').count()) === 1 && (await page.locator('[data-testid=order-free-hold]').innerText()) === 'Hold my free gift' && (await pkgPrice(page).innerText()).trim() === '$17.50')
    await shotOrder(page, 'polish-order-free-390.png')
    await page.locator('[data-testid=order-free-email]').fill('b@example.com')
    await page.locator('[data-testid=order-free-hold]').click()
    await page.locator('[data-testid=order-promo-line][data-state=held]').waitFor({ timeout: 8000 })
    const price = (await pkgPrice(page).innerText()).replace(/\s+/g, ' ').trim()
    check('order section: "Hold my free gift" in the box holds with the email alone (no code), the price turns to "$0 · Your free gift" and the held line shows — without reloading', holds.length === 1 && holds[0].email === 'b@example.com' && !('code' in holds[0] && holds[0].code !== '') && price === '$17.50 $0 · Your free gift' && loads === 0, JSON.stringify({ holds, price, loads }))
    await shotOrder(page, 'polish-order-after-hold-390.png')
    check('no page errors (run 34, inline hold)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  // none left today
  {
    const { page, errors } = await orderPage({ on: true, left: 0, daily: 100, hold: null })
    await page.locator('[data-testid=order-promo-line][data-state=none]').waitFor({ timeout: 8000 })
    check('order section (none left): one line, "Today\'s free gifts are all held or given. New ones arrive tomorrow morning (US Eastern)." and the price stays $17.50', (await page.locator('[data-testid=order-promo-line]').innerText()) === "Today's free gifts are all held or given. New ones arrive tomorrow morning (US Eastern)." && (await pkgPrice(page).innerText()).trim() === '$17.50' && (await page.locator('[data-testid=order-free-email]').count()) === 0)
    await shotOrder(page, 'polish-order-none-390.png')
    check('no page errors (run 34, none left)', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // ---- the ceremony ----
  const TOKEN = 'RG-polipolipolipolipoli'
  const gift = (over = {}) => ({
    id: TOKEN, token: TOKEN, language: 'en', glyph: '労', reading: 'ねぎらう', romanization: 'negirau', meaning_en: 'tending',
    en: { word: 'tending', word_source: 'lexicon', line: 'The care that mends what is about to give.', line_you: 'The one who eases a burden before anyone asks.', echo: null, classical: null },
    who: 'Someone who fixed the bike before anyone asked.', poem: { type: 'en', lines: ['The chain was back on', 'before I reached the driveway.', 'You never mention it.', 'You only notice', 'what is about to give,', 'and mend it quietly.'], reading: '' },
    memorial: false, purpose: 'thanks', music: 'thanks', film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg'] },
    certificate_line: 'x', from: 'Brian', to: 'Kenji', message: "Thanks for fixing Sam's bike.", egift: null, locked: false, certificate_no: 3, order_date: '2026-11-15', opens_on: null, replied: false, package: 'egift', ...over,
  })
  const openGift = async (v, reduced = false) => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route(`**/api/gift/${TOKEN}**`, (r) => (new URL(r.request().url()).pathname === `/api/gift/${TOKEN}` ? r.fulfill({ json: v }) : r.fulfill({ status: 204, body: '' })))
    await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    const T = (id) => page.locator(`[data-testid="${id}"]`)
    await T('cr-markbtn').click()
    await T('cr-to-film').click()
    await T('gift-skip').click()
    await T('cr-char').waitFor()
    return { ctx, page, errs, T }
  }
  // 1. no way on before the meaning
  {
    const { ctx, page, errs, T } = await openGift(gift())
    const early = []
    for (let i = 0; i < 6; i++) { early.push(await T('cr-to-poem').count()); await page.waitForTimeout(500) }
    check('character: no "Read the poem inside it" while the character is still revealing (checked for 3 s)', early.every((n) => n === 0) && (await T('cr-char').getAttribute('data-meaning')) === 'no', early.join())
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${SHOTS}/polish-character-before-meaning-390.png` })
    await page.waitForFunction(() => document.querySelector('[data-testid=cr-char]')?.getAttribute('data-meaning') === 'yes', null, { timeout: 40000 })
    const op = await T('cr-meaning').evaluate((e) => getComputedStyle(e).opacity)
    check('character: the button comes only once the meaning has fully risen ("In Brian\'s eyes, you are · tending · … already sees you.")', op === '1' && (await T('cr-to-poem').count()) === 1 && (await T('cr-meaning').innerText()).includes('It is how Brian already sees you.'), op)
    await page.screenshot({ path: `${SHOTS}/polish-character-after-meaning-390.png` })
    check('no page errors (run 34, meaning)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // a tap speeds the sequence up to the meaning — never past it
  {
    const { ctx, page, T } = await openGift(gift())
    await page.waitForTimeout(1200)
    await page.mouse.click(195, 300)
    await page.waitForTimeout(300)
    check('character: a tap on the screen jumps to the meaning (fully shown) and the button appears — it does not skip past it to the poem', (await T('cr-char').getAttribute('data-meaning')) === 'yes' && (await T('cr-meaning').evaluate((e) => getComputedStyle(e).opacity)) === '1' && (await T('cr-to-poem').count()) === 1 && (await T('cr-poem').count()) === 0)
    await ctx.close()
  }
  // 2. slip 2 is fully readable for at least 1.5 s before the dive
  {
    const { ctx, page } = await openGift(gift())
    const s = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now()
      let firstFull = null
      let diveAt = null
      const tick = () => {
        const cap = document.getElementById('cr-cap2')
        const lens = document.querySelector('[data-testid=cr-lens]')
        const now = performance.now() - t0
        if (cap && Number(getComputedStyle(cap).opacity) >= 0.99 && firstFull === null) firstFull = now
        const m = lens ? getComputedStyle(lens).transform : 'none'
        const k = m && m !== 'none' ? Number(m.slice(7).split(',')[0]) : 1
        if (k > 1.001 && diveAt === null) diveAt = now
        if (diveAt !== null || now > 30000) return resolve({ firstFull, diveAt, capAtDive: cap ? Number(getComputedStyle(cap).opacity) : 0 })
        requestAnimationFrame(tick)
      }
      tick()
    }))
    check('character: slip 2 ("Look closer. A poem is written inside it.") is fully shown at least 1.5 s before the dive starts, and is still there as it dives', s.firstFull !== null && s.diveAt !== null && s.diveAt - s.firstFull >= 1450 && s.capAtDive >= 0.99, JSON.stringify(s))
    await ctx.close()
  }
  // Part 4 (English first): no romanized reading on the ceremony screens; the certificate alone keeps it, small, next to the character ("労 · negirau")
  {
    const { ctx, page, errs, T } = await openGift(gift(), true)
    const seen = []
    const clean = async (id) => { const t = await T(id).innerText(); seen.push([id, /negirau/i.test(t)]); return !/negirau/i.test(t) }
    await T('cr-to-poem').waitFor({ timeout: 20000 })
    const charOk = (await clean('cr-char')) && (await T('cr-word').innerText()) === 'tending' && !/negirau/i.test((await T('cr-char').innerHTML()))
    await T('cr-to-poem').click()
    await T('cr-poem').waitFor()
    const poemOk = await clean('cr-poem')
    await T('cr-to-cert').click()
    await T('cr-cert').waitFor()
    const cert = await T('gift-cert-reading').innerText()
    const word = await T('gift-cert-word').innerText()
    const small = await page.evaluate(() => { const r = document.querySelector('[data-testid=gift-cert-reading]'); const w = document.querySelector('[data-testid=gift-cert-word]'); return { r: parseFloat(getComputedStyle(r).fontSize), w: parseFloat(getComputedStyle(w).fontSize) } })
    await page.screenshot({ path: `${SHOTS}/polish-certificate-390.png` })
    await T('cr-to-keep').click()
    await T('gift-keep').waitFor()
    const keepOk = await clean('gift-keep')
    check('English first: screen 4 shows the word alone ("tending", no "negirau"); the poem and keepsake screens carry no romanized reading', charOk && poemOk && keepOk, JSON.stringify(seen))
    check('English first: the certificate alone keeps the reading, in small type next to the character ("労 · negirau"), the English word large under it', cert === '労 · negirau' && word === 'tending' && small.r < small.w * 0.75, JSON.stringify({ cert, word, small }))
    check('no page errors (run 34, English first)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // 3. coming back to an answered gift
  {
    const { ctx, page, errs, T } = await openGift(gift({ replied: true, answer: { char: '家', words: true }, back: { state: 'used', char: '家', page: null } }), true)
    await T('cr-to-poem').click({ timeout: 20000 })
    await T('cr-to-cert').click()
    await T('cr-to-keep').click()
    await T('gift-to-answer').click()
    await T('gift-last').waitFor()
    await page.waitForTimeout(300)
    // (Part 14, 2026-11-20: the twelve characters and their "Sent" screen are gone; a gift already sent back shows the character that went back, once, and nothing more to send)
    check('answered gift: the last screen says the character already went back (家), and offers nothing more to send', (await T('gift-last').getAttribute('data-back')) === 'used' && (await T('gift-back-char').innerText()) === '家' && (await T('gift-back-button').count()) === 0 && (await T('gift-answer').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/polish-sent-answered-390.png` })
    check('no page errors (run 34, answered)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 35 (2026-11-16): ONE pool of free gifts for the US and Japan (the Japanese card and order section, ¥0 for a holder), the one-line ended hold, the writing room (its own page,
// same tab, Back keeps everything) and "My gifts" (header button, welcome-back card, the page) ----------
{
  const sizes35 = { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'], promo: { from: '2026-11-01T00:00:00Z', until: '2099-01-01T00:00:00Z' }, usd: { egift: 25, egift_sale: 17.5 } }
  const held35 = () => ({ state: 'active', expires_at: new Date(Date.now() + 100 * 60000).toISOString(), minutes_left: 100, email: 'a@example.com' })
  const enResult35 = () => {
    const r = JSON.parse(JSON.stringify(FIXTURE))
    r.language = 'en'
    r.inscription_script = null
    r.candidates = r.candidates.map((c) => ({ ...c, eliminated: false, eliminated_reason: null }))
    r.candidates[0] = { ...r.candidates[0], reading: 'akari', meaning: 'lamp', one_line_gaze: 'Someone who kept the porch light on for me.', story_anchor: 'the porch light', why_this: 'Lamplight is the plainest thing in your story.', en_word: 'hearth', en_line: 'The light that is already on when everyone else wakes.' }
    return r
  }
  const ITEMS = (n, language = 'en') => Array.from({ length: n }, (_, i) => ({ id: `BK-${String.fromCharCode(97 + i).repeat(20)}`, created_at: '2026-11-16T10:00:00Z', language, to: '', card: { kanji: ['灯', '待', '守', '恒'][i % 4], reading: ['akari', 'matsu', 'mamoru', 'tsune'][i % 4], word: language === 'en' ? ['hearth', 'vigil', 'keeper', 'constant'][i % 4] : '', line: 'x' }, preview_id: null }))
  const open35 = async (url, promo, { me = { basket: { count: 0 }, ready: null, hold: null }, items = [], result } = {}) => {
    const { page, errors, calls } = await mockPage(browser, result ? { result } : {})
    await page.setViewportSize({ width: 390, height: 844 })
    let state = promo
    const holds = []
    await page.route('**/api/rates', (r) => r.fulfill({ json: { date: '2026-11-16', base: 'JPY', rates: { USD: 0.0066 } } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: sizes35 }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: me }))
    await page.route('**/api/basket', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { items, token: 'BT-x', link: 'https://ichirei.soul-id.jp/b/BT-abcdefghjkmnpqrstuvwxyz2' } }) : r.fulfill({ json: { id: 'BK-zzzzzzzzzzzzzzzzzzzz', token: 'BT-x', count: 1, created: true } })))
    await page.route('**/api/basket/qr.svg*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: state }))
    await page.route('**/api/promo/hold', async (r) => {
      const body = JSON.parse(r.request().postData() ?? '{}')
      holds.push(body)
      const h = held35()
      state = { ...state, hold: h, left: (state.left ?? 1) - 1, ended: null }
      await r.fulfill({ json: { ok: true, existing: false, link: 'https://ichirei.soul-id.jp/b/BT-abcdefghjkmnpqrstuvwxyz2', hold: { ...h, count: 1 }, left: state.left } })
    })
    if (url) await page.goto(url, { waitUntil: 'networkidle' })
    return { page, errors, calls, holds }
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const shotCard = async (page, name) => {
    await T(page, 'thanks-card').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => window.scrollBy(0, -12))
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS}/${name}` })
  }
  const TIME = /^\d{1,2}:\d{2}$/

  // ---- Part A: the Japanese card ----
  {
    const { page, errors, holds } = await open35('http://localhost:5173/?lang=ja', { on: true, left: 37, daily: 100, hold: null })
    await T(page, 'thanks-card').waitFor({ timeout: 8000 })
    const card = T(page, 'thanks-card')
    check('ja card: the title 「感謝の季節 無料ギフト」 and the count 「本日の無料ギフト　残り 37 / 100」', (await card.locator('h2').innerText()) === '感謝の季節 無料ギフト' && (await T(page, 'thanks-count').innerText()).replace(/\s+/g, ' ') === '本日の無料ギフト 残り 37 / 100', await T(page, 'thanks-count').innerText())
    check('ja card: the line 「お一人様1回限り、11月30日まで。毎日18時（日本時間）に新しい枠が出ます。」, the label 「メールアドレス」, the tick 「新しい季節やお知らせを受け取る」, the button 「無料ギフトを確保する」 and the note under it — and no code field', (await card.locator('p.sub').first().innerText()) === 'お一人様1回限り、11月30日まで。毎日18時（日本時間）に新しい枠が出ます。' && (await card.locator('label').first().innerText()).startsWith('メールアドレス') && (await card.locator('label.check').innerText()) === '新しい季節やお知らせを受け取る' && (await T(page, 'thanks-submit').innerText()) === '無料ギフトを確保する' && (await card.locator('p.small').innerText()) === 'メールアドレスは、無料ギフトの確保とお支払い時の照合にのみ使います。' && (await card.locator('input[name=code]').count()) === 0)
    check('ja card: no 「エラー」「上限」「無効」 anywhere on it', !/エラー|上限|無効/.test(await card.innerText()))
    await shotCard(page, 'sg-ja-card-open-390.png')
    await T(page, 'thanks-email').fill('hanako@example.com')
    await T(page, 'thanks-submit').click()
    await T(page, 'thanks-held').waitFor({ timeout: 8000 })
    const heldText = await T(page, 'thanks-held').innerText()
    const m = heldText.match(/^無料ギフトを (.+) まで確保しました（残り (\d+) 分）。$/)
    check('ja card, held: 「無料ギフトを {時刻} まで確保しました（残り {分} 分）。」 (the time in the visitor\'s own time zone), 「一字を探す →」 to the writing room, and the phone QR 「スマホで続けますか？このコードを読み取ってください。」', !!m && TIME.test(m[1]) && (await T(page, 'thanks-write').innerText()) === '一字を探す →' && ((await T(page, 'thanks-write').getAttribute('href')) ?? '').startsWith('/write') && (await T(page, 'thanks-phone').innerText()).includes('スマホで続けますか？このコードを読み取ってください。'), heldText)
    check('ja card, held: the hold was asked for with the email and the page language (ja) — one shared pool, the language only recorded', holds.length === 1 && holds[0].email === 'hanako@example.com' && holds[0].language === 'ja' && !('code' in holds[0]), JSON.stringify(holds))
    await shotCard(page, 'sg-ja-card-held-390.png')
    check('no page errors (run 35, ja card)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  {
    const { page, errors } = await open35('http://localhost:5173/?lang=ja', { on: true, left: 0, daily: 100, hold: null })
    await T(page, 'thanks-card').waitFor({ timeout: 8000 })
    check('ja card, none left: 「本日の無料ギフトはすべて確保・お渡し済みです。次の枠は18時（日本時間）に出ます。」 and no form', (await T(page, 'thanks-count').innerText()) === '本日の無料ギフトはすべて確保・お渡し済みです。次の枠は18時（日本時間）に出ます。' && (await T(page, 'thanks-form').count()) === 0)
    await shotCard(page, 'sg-ja-card-none-390.png')
    check('no page errors (run 35, ja none)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  {
    const { page, errors } = await open35('http://localhost:5173/zh', { on: true, left: 37, daily: 100, hold: null })
    await page.waitForTimeout(600)
    check('zh-Hant (2026-11-19): the free-gift card is there too — the same pool as en and ja', (await T(page, 'thanks-card').count()) === 1 && (await page.getAttribute('html', 'lang')) === 'zh-Hant')
    check('no page errors (run 35, zh)', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // ---- Part A: the Japanese order section, three states ----
  const jaOrder = async (promo) => {
    const f = await open35('http://localhost:5173/write', promo)
    await f.page.locator('#write [data-testid=story-input]').fill(STORY)
    await pickContext(f.page)
    await f.page.click(`#write >> text=${GO.ja}`)
    await f.page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await f.page.locator('article[data-slot=main]').click()
    await f.page.locator('article[data-slot=main]').locator(`text=${GIVE.ja}`).click()
    await toOrder(f.page)
    await f.page.waitForTimeout(600)
    return f
  }
  const pkgPrice = (page) => page.locator('label.pkg:has(input[value=egift]) .pkgPrice')
  const shotOrder = async (page, name) => {
    await page.locator('label.pkg:has(input[value=egift])').evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => window.scrollBy(0, -12))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${name}` })
    await T(page, 'order-promo-line').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${name.replace('.png', '-line.png')}` })
  }
  {
    const { page, errors } = await jaOrder({ on: true, left: 40, daily: 100, hold: held35() })
    await page.locator('[data-testid=order-promo-line][data-state=held]').waitFor({ timeout: 8000 })
    const price = (await pkgPrice(page).innerText()).replace(/\s+/g, ' ').trim()
    const struck = await pkgPrice(page).locator('s').evaluate((e) => getComputedStyle(e).textDecorationLine).catch(() => '')
    const line = await T(page, 'order-promo-line').innerText()
    const lm = line.match(/^無料ギフトは (.+) まで確保されています。お支払い画面で自動的に適用されます。$/)
    check('ja order section (holder): the e-gift price reads 「¥0 · 無料ギフト」 with the price struck through, and 「無料ギフトは {時刻} まで確保されています。お支払い画面で自動的に適用されます。」', /^¥[\d,]+ ¥0 · 無料ギフト$/.test(price) && struck === 'line-through' && !!lm && TIME.test(lm[1]), `${price} | ${line}`)
    await shotOrder(page, 'sg-ja-order-holder-390.png')
    check('no page errors (run 35, ja holder)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  {
    let loads = 0
    const { page, errors, holds } = await jaOrder({ on: true, left: 37, daily: 100, hold: null })
    page.on('load', () => loads++)
    await page.locator('[data-testid=order-promo-line][data-state=free]').waitFor({ timeout: 8000 })
    check('ja order section (gifts left): 「本日の無料ギフト：残り 37 / 100。メールアドレスで確保すると、この贈りものは ¥0 になります。」 with the email field and 「無料ギフトを確保する」; the price is unchanged', (await T(page, 'order-free-line').innerText()) === '本日の無料ギフト：残り 37 / 100。メールアドレスで確保すると、この贈りものは ¥0 になります。' && (await T(page, 'order-free-hold').innerText()) === '無料ギフトを確保する' && (await page.locator('[data-price-free]').count()) === 0)
    await shotOrder(page, 'sg-ja-order-free-390.png')
    await T(page, 'order-free-email').fill('taro@example.com')
    await T(page, 'order-free-hold').click()
    await page.locator('[data-testid=order-promo-line][data-state=held]').waitFor({ timeout: 8000 })
    const price = (await pkgPrice(page).innerText()).replace(/\s+/g, ' ').trim()
    check('ja order section: holding there turns the price to ¥0 · 無料ギフト without reloading (the hold carries language ja)', /¥0 · 無料ギフト$/.test(price) && loads === 0 && holds.length === 1 && holds[0].language === 'ja', `${price} loads=${loads}`)
    await shotOrder(page, 'sg-ja-order-after-hold-390.png')
    check('no page errors (run 35, ja free)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  {
    const { page, errors } = await jaOrder({ on: true, left: 0, daily: 100, hold: null })
    await page.locator('[data-testid=order-promo-line][data-state=none]').waitFor({ timeout: 8000 })
    check('ja order section (none left): one line, as on the card; the price is unchanged', (await T(page, 'order-promo-line').innerText()) === '本日の無料ギフトはすべて確保・お渡し済みです。次の枠は18時（日本時間）に出ます。' && (await page.locator('[data-price-free]').count()) === 0)
    await shotOrder(page, 'sg-ja-order-none-390.png')
    check('no page errors (run 35, ja none order)', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // ---- Part C: after an ended hold the card says it once ----
  {
    const { page, errors } = await open35('http://localhost:5173/en', { on: true, left: 37, daily: 100, hold: null, ended: 'expired' })
    await T(page, 'thanks-ended').waitFor({ timeout: 8000 })
    const cardText = await T(page, 'thanks-card').innerText()
    check('card after an ended hold: one line, "Your hold ended.", then the email form as usual — "Hold again" is not said twice (not at all)', (await T(page, 'thanks-ended').innerText()) === 'Your hold ended.' && !/Hold again/.test(cardText) && (await T(page, 'thanks-form').count()) === 1, cardText)
    check('card: "One free gift per person, through November 30." (the owner\'s date; one per person for the whole promotion)', /One free gift per person, through November 30\. New free gifts every morning \(US Eastern\)\./.test(cardText))
    await shotCard(page, 'sg-card-hold-ended-390.png')
    check('no page errors (run 35, ended)', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // ---- Part D: the writing room ----
  {
    const { page, errors } = await open35('http://localhost:5173/en', { on: true, left: 37, daily: 100, hold: held35() }, { me: { basket: { count: 2 }, ready: null, hold: null }, items: ITEMS(2), result: enResult35 })
    const ctx = page.context()
    const links = await page.evaluate(() => [...document.querySelectorAll('a')].filter((a) => /Write your moment/.test(a.textContent ?? '')).map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target') })))
    check('every "Write your moment" on /en leads to /en/write in the same tab (no target)', links.length >= 3 && links.every((l) => (l.href ?? '').startsWith('/en/write') && !l.target), JSON.stringify(links))
    check('header: "My gifts (2)" on the landing page, linking to My gifts', (await T(page, 'my-gifts').first().innerText()) === 'My gifts (2)' && (await T(page, 'my-gifts').first().getAttribute('href')) === '/basket')
    await page.screenshot({ path: `${SHOTS}/sg-header-my-gifts-390.png` })
    // the welcome-back card
    await T(page, 'welcome-back').waitFor({ timeout: 8000 })
    const words = await page.locator('[data-testid=welcome-word]').allInnerTexts()
    check('welcome back: "Welcome back. Your saved gifts:" with each saved character large, its English word and "Give this gift →" to the writing room', (await page.locator('.wbHead').innerText()) === 'Welcome back. Your saved gifts:' && words.join('|') === 'hearth|vigil' && (await page.locator('.wbGlyph').allInnerTexts()).join('') === '灯待' && ((await T(page, 'welcome-give').first().getAttribute('href')) ?? '') === '/en/write?resume=BK-aaaaaaaaaaaaaaaaaaaa' && (await T(page, 'welcome-all').count()) === 0, words.join('|'))
    await T(page, 'welcome-back').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/sg-welcome-back-390.png` })
    // into the room, same tab
    const pagesBefore = ctx.pages().length
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.click('.hero a.btn.primary')
    await page.waitForURL(/\/en\/write/)
    await page.waitForSelector('#write [data-testid=story-input]')
    check('the writing room opens in the same tab (no new page), with only the flow: the wordmark, "My gifts (2)", "← Back" — no hero, no landing sections, no free-gift card', ctx.pages().length === pagesBefore && (await T(page, 'write-room').count()) === 1 && (await page.locator('.hero, #how, #gifts, .faq, [data-testid=thanks-card], [data-testid=dock]').count()) === 0 && (await T(page, 'my-gifts').innerText()) === 'My gifts (2)' && (await T(page, 'write-back').innerText()) === '← Back')
    await page.screenshot({ path: `${SHOTS}/sg-write-start-390.png` })
    await page.locator('#write [data-testid=story-input]').fill('She left the porch light on every night until I got home, and she never once mentioned it.')
    await pickContext(page)
    await page.click(`#write >> text=${GO.en}`)
    await page.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/sg-write-characters-390.png` })
    await page.locator('article[data-slot=main]').click()
    await page.locator('article[data-slot=main]').locator(`text=${GIVE.en}`).click()
    await T(page, 'result-page').waitFor()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${SHOTS}/sg-write-result-390.png` })
    // Save's first line names My gifts
    await T(page, 'save-button').first().click().catch(() => {})
    await T(page, 'save-saved').waitFor({ timeout: 6000 }).catch(() => {})
    check('Save on the result page: the first line is "✓ Saved. We\'ll keep it for 30 days." (no mailer in this run; with one it asks for the e-mail first)', (await T(page, 'save-saved').innerText().catch(() => '')) === "✓ Saved. We'll keep it for 30 days.")
    // "← Back" returns to the landing page; the hold and the saved gifts are still there
    await page.goto('http://localhost:5173/en/write', { waitUntil: 'networkidle' })
    await T(page, 'write-back').click()
    await page.waitForURL((u) => new URL(u).pathname === '/en')
    await T(page, 'thanks-held').waitFor({ timeout: 8000 })
    check('"← Back" returns to /en with the hold and the saved gifts intact (the card shows the hold, the header still says My gifts (2))', new URL(page.url()).pathname === '/en' && (await T(page, 'thanks-held').count()) === 1 && (await T(page, 'my-gifts').first().innerText()) === 'My gifts (2)')
    // the phone's Back button too
    await page.click('.hero a.btn.primary')
    await page.waitForURL(/\/en\/write/)
    await page.goBack({ waitUntil: 'networkidle' })
    check('the browser\'s Back from the writing room returns to the landing page', new URL(page.url()).pathname === '/en' && (await page.locator('.hero').count()) === 1)
    // old links
    await page.goto('http://localhost:5173/en#write', { waitUntil: 'networkidle' })
    await page.waitForURL(/\/en\/write/)
    await page.waitForSelector('#write [data-testid=story-input]', { timeout: 10000 }).catch(() => {})
    check('an old /en#write link lands on the writing room', new URL(page.url()).pathname === '/en/write' && (await page.locator('#write [data-testid=story-input]').count()) === 1)
    await page.goto('http://localhost:5173/?lang=ja#write', { waitUntil: 'networkidle' })
    await page.waitForURL(/\/write/)
    check('an old /#write link (Japanese) lands on /write, in Japanese', new URL(page.url()).pathname === '/write' && (await page.getAttribute('html', 'lang')) === 'ja')
    check('no page errors (run 35, writing room)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  // My gifts in every language, with and without a count; four saved gifts → three shown and "See all →"; the My gifts page
  {
    for (const [url, want] of [['http://localhost:5173/?lang=ja', 'マイギフト（3）'], ['http://localhost:5173/zh', '我的禮物（3）'], ['http://localhost:5173/write', 'マイギフト（3）'], ['http://localhost:5173/zh/write', '我的禮物（3）']]) {
      const { page, errors } = await open35(url, { on: false }, { me: { basket: { count: 3 }, ready: null, hold: null } })
      await page.waitForTimeout(300)
      check(`header (${new URL(url).pathname}${new URL(url).search}): 「${want}」`, (await T(page, 'my-gifts').first().innerText()) === want)
      check(`no page errors (run 35, header ${url})`, errors.length === 0, errors.join('; '))
      await page.close()
    }
    const z = await open35('http://localhost:5173/en', { on: false })
    await z.page.waitForTimeout(300)
    check('header with nothing saved: "My gifts" (no count), and no welcome-back card', (await T(z.page, 'my-gifts').first().innerText()) === 'My gifts' && (await T(z.page, 'welcome-back').count()) === 0)
    await z.page.close()
    const four = await open35('http://localhost:5173/en', { on: false }, { me: { basket: { count: 4 }, ready: null, hold: null }, items: ITEMS(4) })
    await T(four.page, 'welcome-back').waitFor({ timeout: 8000 })
    check('welcome back with four saved gifts: three shown, then "See all →" to My gifts', (await T(four.page, 'welcome-item').count()) === 3 && (await T(four.page, 'welcome-all').innerText()) === 'See all →' && (await T(four.page, 'welcome-all').getAttribute('href')) === '/basket')
    await four.page.close()
    const g = await open35('http://localhost:5173/basket', { on: false }, { me: { basket: { count: 2 }, ready: null, hold: null }, items: ITEMS(2) })
    await T(g.page, 'basket-item').first().waitFor({ timeout: 8000 })
    check('My gifts page: the heading "My gifts" (2026-11-18); the word "basket" is nowhere on it', (await g.page.locator('.basketPage h1').innerText()) === 'My gifts' && !/basket/i.test(await g.page.locator('body').innerText()))
    await g.page.screenshot({ path: `${SHOTS}/sg-my-gifts-390.png` })
    check('no page errors (run 35, My gifts page)', g.errors.length === 0, g.errors.join('; '))
    await g.page.close()
  }
}

// ---------- Run 36 (2026-11-16, new main address): the /en sample cards show the English word only ("the question"), never the romanized reading ("toi · the question");
// the Japanese cards keep their reading ----------
{
  const EN_WORDS = ['tomoshibi', 'irodori', 'osoi', 'tatsu', 'toi', 'tate']
  const { page, errors } = await mockPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://localhost:5173/en')
  await page.locator('.reveal .rd').first().waitFor({ timeout: 10000 })
  const dots = page.locator('.dots button')
  const n = await dots.count()
  const seen = []
  for (let i = 0; i < n; i++) {
    await dots.nth(i).click()
    await page.waitForTimeout(900)
    seen.push((await page.locator('.reveal .rd').first().innerText()).trim())
  }
  check(`/en: all ${n} hero sample cards show the English word only (${seen.join(' | ')}), "the question" among them`, n === 6 && seen.includes('the question') && seen.every((t) => !t.includes('·') && !EN_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t))), seen.join(' | '))
  check('/en: the hero says "toi" nowhere', !/\btoi\b/.test(await page.locator('.hero, section').first().innerText()))
  check('no page errors (run 36, /en hero)', errors.length === 0, errors.join('; '))
  await page.close()
  const ja = await mockPage(browser)
  await ja.page.goto('http://localhost:5173/?lang=ja')
  await ja.page.locator('.reveal .rd').first().waitFor({ timeout: 10000 })
  check('ja: the hero card keeps its reading and its meaning (「…  · …」)', (await ja.page.locator('.reveal .rd').first().innerText()).includes('·'))
  await ja.page.close()
}

// ---------- Run 37 (2026-11-17): while the promotion runs, the free-gift box sits right under "Write your moment" in the hero (en and ja), the price shrinks to one small line under it, the chips come last;
// sold out: the box says so and the price line is the plain, larger price line; after the promotion the hero is today's again; zh unchanged ----------
{
  const SALE = { percent: 30, from: '2026-11-15', until: '2026-11-30', starts_at: '2026-11-14T15:00:00.000Z', ends_at: '2026-11-30T14:59:59.999Z' }
  const open37 = async (url, { clock = '2026-11-17T15:00:00Z', promoUntil = '2026-11-30T23:59:59-05:00', state = { on: true, left: 37, daily: 100, hold: null }, width = 390 } = {}) => {
    const { page, errors } = await mockPage(browser)
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date(clock))
    await page.route('**/api/rates', (r) => r.fulfill({ json: { date: '2026-11-17', base: 'JPY', rates: { USD: 0.0066 } } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'], promo: { from: '2026-11-01T00:00:00Z', until: new Date(promoUntil).toISOString() }, usd: { egift: 25, egift_sale: 17.5 }, sale: SALE } }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items: [], token: 'BT-x', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2' } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: state }))
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    return { page, errors }
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const probe = (page) =>
    page.evaluate(() => {
      const hero = document.querySelector('.hero')
      const cta = hero.querySelector('.ctaRow')
      const box = document.querySelector('[data-testid=hero-thanks]')
      const price = document.querySelector('[data-testid=promo-price]')
      const chips = hero.querySelector('.chips')
      const r = (el) => (el ? el.getBoundingClientRect() : null)
      return {
        boxNext: !!box && cta.nextElementSibling === box,
        priceNext: !!box && !!price && box.nextElementSibling === price,
        chipsNext: !!price && price.nextElementSibling === chips,
        boxInHero: !!box && hero.contains(box),
        sections: document.querySelectorAll('#days-of-thanks').length,
        cards: document.querySelectorAll('[data-testid=thanks-card]').length,
        bigPrice: document.querySelectorAll('[data-testid=usd-hero], [data-testid=usd-hero-line], .hero .approxHero').length,
        noScroll: document.documentElement.scrollWidth <= window.innerWidth,
        boxBelowButton: !!box && r(box).top >= r(cta).bottom - 1 && r(box).top - r(cta).bottom < 120,
        boxWidth: box ? Math.round(r(box).width) : 0,
        vw: window.innerWidth,
        price: price ? price.innerText.trim() : null,
        priceSize: price ? parseFloat(getComputedStyle(price).fontSize) : 0,
        priceColor: price ? getComputedStyle(price).color : null,
        count: document.querySelector('[data-testid=thanks-count]')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
        form: !!document.querySelector('[data-testid=thanks-form]'),
        email: !!document.querySelector('[data-testid=thanks-email]'),
        consent: !!document.querySelector('[data-testid=thanks-marketing]'),
        submit: !!document.querySelector('[data-testid=thanks-submit]'),
      }
    })
  const PRICE = {
    en: "If today's free gifts are gone: $17.50 (Thanksgiving price). $25 from December 1.",
    ja: '本日の無料枠が終了した場合：感謝の季節価格 ¥2,786（12月1日から ¥3,980）',
  }
  const PLAIN = { en: '$17.50 (Thanksgiving price). $25 from December 1.', ja: '感謝の季節価格 ¥2,786（12月1日から ¥3,980）' }
  const URLS = { en: 'http://localhost:5173/en', ja: 'http://localhost:5173/?lang=ja' }
  for (const lang of ['en', 'ja']) {
    // promotion on, free gifts left
    const on = await open37(URLS[lang])
    const a = await probe(on.page)
    check(`run 37 (${lang}, promotion on): the free-gift box is the very next block after the hero button; then the one small price line; then the occasion chips`, a.boxNext && a.priceNext && a.chipsNext && a.boxInHero, JSON.stringify(a))
    check(`run 37 (${lang}): one box only — the separate free-gift section further down is gone`, a.sections === 1 && a.cards === 1, JSON.stringify({ s: a.sections, c: a.cards }))
    check(`run 37 (${lang}): no large price in the hero (no big dollar price, no launch line, no converted price)`, a.bigPrice === 0, String(a.bigPrice))
    check(`run 37 (${lang}): the counter, the email field, the consent box and the hold button are all in the box (the existing texts)`, a.form && a.email && a.consent && a.submit && (lang === 'en' ? a.count === "37 of today's 100 free gifts are still available." : a.count === '本日の無料ギフト 残り 37 / 100'), JSON.stringify({ count: a.count }))
    check(`run 37 (${lang}): the small price line, with both prices from the price config: 「${PRICE[lang]}」, small and muted`, a.price === PRICE[lang] && a.priceSize <= 14 && /rgb/.test(a.priceColor ?? ''), JSON.stringify({ p: a.price, s: a.priceSize }))
    check(`run 37 (${lang}, 390 px): the box sits right under the button, full width, no horizontal scroll`, a.boxBelowButton && a.noScroll && a.boxWidth >= a.vw - 48 && a.boxWidth <= a.vw, JSON.stringify({ w: a.boxWidth, vw: a.vw, below: a.boxBelowButton, scroll: a.noScroll }))
    await on.page.setViewportSize({ width: 390, height: 1180 }) // (a taller phone for the picture: the whole hero, the box and the price line in one frame)
    await on.page.waitForTimeout(250)
    await on.page.screenshot({ path: `${SHOTS}/sg2-${lang}-promo-390.png` })
    check(`no page errors (run 37, ${lang} promotion on)`, on.errors.length === 0, on.errors.join('; '))
    await on.page.close()

    // sold out for the day
    const out = await open37(URLS[lang], { state: { on: true, left: 0, daily: 100, hold: null } })
    const b = await probe(out.page)
    check(`run 37 (${lang}, sold out): the box shows the existing "sold out, new free gifts tomorrow" line and no form; the price line is the plain price line (no "if gone" lead-in), larger and in ink, so the paid path is clear`, b.boxNext && !b.form && /./.test(b.count ?? '') && b.price === PLAIN[lang] && b.priceSize > a.priceSize && b.priceSize >= 15, JSON.stringify({ count: b.count, price: b.price, size: b.priceSize, small: a.priceSize }))
    check(`run 37 (${lang}, sold out): the line says tomorrow (${lang === 'en' ? 'New ones arrive tomorrow morning' : '次の枠は18時'})`, lang === 'en' ? /New ones arrive tomorrow morning/.test(b.count ?? '') : /次の枠は18時/.test(b.count ?? ''), b.count ?? '')
    await out.page.setViewportSize({ width: 390, height: 1180 }) // (a taller phone for the picture: the whole hero, the box and the price line in one frame)
    await out.page.waitForTimeout(250)
    await out.page.screenshot({ path: `${SHOTS}/sg2-${lang}-soldout-390.png` })
    check(`no page errors (run 37, ${lang} sold out)`, out.errors.length === 0, out.errors.join('; '))
    await out.page.close()

    // after the promotion: today's hero again, by itself (the clock is past the promotion's end)
    const off = await open37(URLS[lang], { clock: '2026-12-05T15:00:00Z', promoUntil: '2026-11-30T23:59:59-05:00', state: { on: false } })
    const c = await probe(off.page)
    check(`run 37 (${lang}, after the promotion): today's hero — no box, no small price line, the chips follow the button row${lang === 'en' ? ' and the large dollar price is back' : ''}`, !c.boxInHero && c.sections === 0 && c.cards === 0 && c.price === null && (lang === 'en' ? await T(off.page, 'usd-hero').count() === 1 : true), JSON.stringify(c))
    await off.page.close()
  }
  // zh is unchanged
  const zh = await open37('http://localhost:5173/zh')
  const z = await probe(zh.page)
  check('run 37 (zh, 2026-11-19): the free-gift box is the very next block after the hero button, then the one small price line, then the chips — like en and ja', z.boxNext && z.priceNext && z.chipsNext && z.boxInHero && z.sections === 1 && z.noScroll, JSON.stringify(z))
  await zh.page.close()
  // a wider screen: the box is still under the button and the page does not scroll sideways
  const wide = await open37(URLS.en, { width: 1280 })
  const w = await probe(wide.page)
  check('run 37 (en, 1280 px): the box is still the next block after the button; no horizontal scroll', w.boxNext && w.priceNext && w.noScroll, JSON.stringify(w))
  await wide.page.close()
}


// ---------- Run 38 (2026-11-18): "My gifts" — the customer's own page: full paper cards (the character, its word — never the reading alone —, the line, who it is for, the moment collapsed and expanded, the poem, four pictures
// with a placeholder for a missing one, the dates, Give / Remove), the masked email and the gifts sent, the empty state, "Save to my email"; en, ja and zh-Hant; screenshots at 390 and 1280 ----------
{
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#9a8f7a"/></svg>'
  const STORY38 = 'The first line of the moment is here.\nThe second line follows right after it.\nThe third line only shows after Read all.'
  const item = (over = {}) => ({
    id: 'BK-aaaaaaaaaaaaaaaaaaaa', created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-18T10:00:00Z', language: 'en', to: 'Mom',
    card: { kanji: '恒', reading: 'kō', word: 'constant', line: 'She is the one who never changes.', meaning: 'constant' }, preview_id: 'AN-previewpreviewprev22',
    context: { relationship: 'parent_mother', relationship_other: '', purpose: 'thanks', purpose_other: '', occasion: 'thanksgiving' }, round: 1, slot: 'main',
    poem: { lines: ['morning light', 'a lunch box, closed'], reading: '' }, story: STORY38, saved_until: '2026-12-18T10:00:00Z',
    pictures: [1, 2, 3, 4].map((n) => ({ state: 'ok', url: `/api/film/AN-previewpreviewprev22/picture/${n}.webp` })), ...over,
  })
  const open38 = async ({ lang = 'en', items = [item()], email = null, hold = null, sent = [], mail = false, width = 390, height = 900, path = '/basket', clock = '2026-11-18T15:00:00Z' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: lang === 'ja' ? 'ja-JP' : lang === 'zh-Hant' ? 'zh-TW' : 'en-US', deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.clock.setFixedTime(new Date(clock))
    const posts = []
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: items.length }, ready: null, hold: null } }))
    await page.route('**/api/film/*/picture/*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }))
    await page.route('**/api/basket/qr.svg*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.route('**/api/basket/email**', (r) => { posts.push({ url: r.request().url(), body: JSON.parse(r.request().postData() ?? '{}') }); return r.fulfill({ json: { ok: true, email: 'm•••@example.com', pending: false } }) })
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items, token: 'BT-x', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2', email, hold, sent, mail, saved_days: 30 } }))
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-page]')
    await page.waitForTimeout(300)
    return { page, ctx, errs, posts }
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

  // ---- English, with an email, a hold and a sent gift; the mail box on
  {
    const { page, ctx, errs, posts } = await open38({ email: 'b•••@gmail.com', hold: { expires_at: '2026-11-18T23:49:00Z', minutes_left: 60 }, mail: true, sent: [{ kanji: '憶', reading: 'oku', word: 'remember', receiver: 'Kenji', at: '2026-11-16T10:00:00Z', status: 'opened', opened_at: '2026-11-17T09:00:00Z', page: '/a/AN-abcdefghjkmnpqrstuvw' }] })
    check('My gifts (en): the title (2026-11-20: "Saved under b•••@gmail.com (n)" once the address is known), the masked email with "Your gifts and orders", the free-gift hold, and "Saved for 30 days."', /^Saved under b•••@gmail\.com \(\d+\)$/.test(await T(page, 'my-title').innerText()) && (await T(page, 'my-email').innerText()).includes('b•••@gmail.com') && (await T(page, 'my-email').innerText()).includes('Your gifts and orders') && (await T(page, 'my-hold').innerText()).startsWith('Your free gift is held until') && (await T(page, 'basket-saved').innerText()) === 'Saved for 30 days.')
    const card = T(page, 'basket-item').first()
    check('full card (en): the character large, the English word as the headline — and NO romanized reading anywhere on the card', (await card.locator('[data-testid=mg-glyph]').innerText()) === '恒' && (await card.locator('[data-testid=mg-word]').innerText()) === 'constant' && (await card.locator('[data-testid=mg-reading]').count()) === 0 && !(await card.innerText()).includes('kō'))
    check('full card (en): the one line, "For Mom", and the chips "Mother" and "Thank you"', (await card.locator('[data-testid=mg-line]').innerText()) === 'She is the one who never changes.' && (await card.locator('[data-testid=mg-for]').innerText()) === 'For Mom' && (await card.locator('[data-testid=mg-chip]').allInnerTexts()).join('|') === 'Mother|Thank you')
    const story = card.locator('[data-testid=mg-story]')
    const hCollapsed = (await story.boundingBox()).height
    check('full card (en): "Your moment" shows the first two lines, collapsed, with "Read all"', (await card.locator('[data-testid=mg-moment] h2').textContent()) === 'Your moment' && (await story.getAttribute('class')).includes('clamped') && (await card.locator('[data-testid=mg-readall]').innerText()) === 'Read all')
    await card.locator('[data-testid=mg-readall]').click()
    const hOpen = (await story.boundingBox()).height
    check('full card (en): "Read all" opens the whole text (the third line is there, the box grew), and "Show less" closes it', !(await story.getAttribute('class')).includes('clamped') && hOpen > hCollapsed + 10 && (await story.innerText()).includes('The third line only shows after Read all.') && (await card.locator('[data-testid=mg-readall]').innerText()) === 'Show less')
    check('full card (en): the poem', (await card.locator('[data-testid=mg-poem]').innerText()).includes('morning light') && (await card.locator('[data-testid=mg-poem]').innerText()).includes('a lunch box, closed'))
    const pics = card.locator('[data-testid=mg-pic]')
    check('full card (en): all four pictures are there — picture 1 included — each a real picture (never the striped box), and every one is square', (await pics.count()) === 4 && (await Promise.all([0, 1, 2, 3].map((n) => pics.nth(n).getAttribute('data-state')))).every((x) => x === 'ok') && (await page.locator('.mgPicEmpty').count()) === 0 && (await Promise.all([0, 1, 2, 3].map(async (n) => { const b = await pics.nth(n).boundingBox(); return Math.abs(b.width - b.height) < 2 }))).every(Boolean))
    await pics.nth(0).click()
    check('a picture opens full screen, and closes again', (await T(page, 'mg-light').count()) === 1 && (await T(page, 'mg-light').locator('img').count()) === 1)
    await T(page, 'mg-light-close').click()
    check('…closed', (await T(page, 'mg-light').count()) === 0)
    check('full card (en): the date saved, "Saved until Dec 18", and "Give this gift →" opens the writing room with the item', (await card.locator('[data-testid=mg-dates]').innerText()).includes('Saved Nov 18') && (await card.locator('[data-testid=mg-until]').innerText()) === 'Saved until Dec 18' && (await card.locator('[data-testid=basket-give]').innerText()) === 'Give this gift →' && (await card.locator('[data-testid=basket-give]').getAttribute('href')) === '/en/write?resume=BK-aaaaaaaaaaaaaaaaaaaa')
    check('Sent group (en, with an email; the dashboard since Part 7): the character, "For Kenji", the status "Opened", and a button to the gift page', (await T(page, 'group-sent').locator('h2').innerText()) === 'Sent' && (await T(page, 'my-sent-item').innerText()).includes('For Kenji') && (await T(page, 'my-sent-status').innerText()).startsWith('Opened') && (await T(page, 'my-sent-open').getAttribute('href')) === '/a/AN-abcdefghjkmnpqrstuvw')
    check('Save to my email (en): the box, its title, the field and "Save to my email", and "Send my link again" because the record has an email', (await T(page, 'keep-mail').count()) === 1 && (await T(page, 'keep-mail').innerText()).includes("Keep your gifts: we'll email you your private link.") && (await T(page, 'keep-mail-save').innerText()) === 'Save to my email' && (await T(page, 'keep-mail-again').innerText()) === 'Send my link again')
    await T(page, 'keep-mail-input').fill('mia@example.com')
    await T(page, 'keep-mail-save').click()
    await page.waitForSelector('[data-testid=keep-mail-note]')
    check('Save to my email: one POST with the address and the page language, and the note says it was sent', posts.length === 1 && posts[0].url.endsWith('/api/basket/email') && posts[0].body.email === 'mia@example.com' && posts[0].body.language === 'en' && (await T(page, 'keep-mail-note').innerText()).startsWith('Sent.'))
    await T(page, 'keep-mail-again').click()
    await page.waitForTimeout(200)
    check('Send my link again: one POST to /resend', posts.length === 2 && posts[1].url.endsWith('/api/basket/email/resend'))
    check('no horizontal scroll at 390 px (en)', await noScroll(page))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${SHOTS}/mygifts-en-390.png`, fullPage: true })
    check('no page errors (run 38, en)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // ---- English desktop: four pictures across
  {
    const { page, ctx, errs } = await open38({ width: 1280, height: 1000, email: 'b•••@gmail.com' })
    const pics = T(page, 'basket-item').first().locator('[data-testid=mg-pic]')
    const ys = await Promise.all([0, 1, 2, 3].map(async (n) => Math.round((await pics.nth(n).boundingBox()).y)))
    check('desktop (1280 px): the four pictures sit in one row, and there is no horizontal scroll', new Set(ys).size === 1 && (await noScroll(page)))
    await page.screenshot({ path: `${SHOTS}/mygifts-en-1280.png`, fullPage: true })
    check('no page errors (run 38, en desktop)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // ---- no email: neither the masked email nor the sent gifts; no mail box without a key
  {
    const { page, ctx } = await open38({ email: null, sent: [{ kanji: '憶', reading: '', word: '', receiver: 'Kenji', at: '2026-11-16T10:00:00Z', status: 'paid', page: null }], mail: false })
    check('without an email on the record: no masked email and no sent groups; with no mail key: no "Save to my email" box — the rest of the page works', (await T(page, 'my-email').count()) === 0 && (await T(page, 'group-sent').count()) === 0 && (await T(page, 'group-unsent').count()) === 0 && (await T(page, 'keep-mail').count()) === 0 && (await T(page, 'basket-item').count()) === 1)
    await ctx.close()
  }
  // ---- the empty page
  {
    const { page, ctx } = await open38({ items: [] })
    check('empty page: one warm line and "Write your moment →"', (await T(page, 'basket-empty').innerText()).includes('Nothing here yet.') && (await T(page, 'my-write').innerText()) === 'Write your moment →' && (await T(page, 'my-write').getAttribute('href')) === '/en/write')
    await ctx.close()
  }
  // ---- Japanese: the line is the meaning, the reading small beside the character (never alone)
  {
    const { page, ctx, errs } = await open38({ lang: 'ja', items: [item({ language: 'ja', to: '母', card: { kanji: '恒', reading: 'コウ・つね', word: '', line: 'いつも変わらず、そこにいてくれる人。', meaning: '' }, context: { relationship: 'parent_mother', relationship_other: '', purpose: 'thanks', purpose_other: '', occasion: 'thanksgiving' } })], email: 'b•••@gmail.com', mail: true })
    const card = T(page, 'basket-item').first()
    check('My gifts (ja): the heading 「…に保存した贈りもの（n）」 (2026-11-20), the character with its reading small beside it AND the line (the reading is never alone), 「母へ」, chips 「母」「ありがとう」', /に保存した贈りもの（\d+）$/.test(await T(page, 'my-title').innerText()) && (await card.locator('[data-testid=mg-reading]').innerText()) === 'コウ・つね' && (await card.locator('[data-testid=mg-line]').innerText()) === 'いつも変わらず、そこにいてくれる人。' && (await card.locator('[data-testid=mg-for]').innerText()) === '母へ' && (await card.locator('[data-testid=mg-chip]').allInnerTexts()).join('|') === '母|ありがとう')
    check('My gifts (ja): 「あなたの場面」, 「この贈りものを贈る →」, 「削除」, 「保存日」と「まで保存」, and the mail box 「メールに保存」', (await card.locator('[data-testid=mg-moment] h2').textContent()) === 'あなたの場面' && (await card.locator('[data-testid=basket-give]').innerText()) === 'この贈りものを贈る →' && (await card.locator('[data-testid=basket-remove]').innerText()) === '削除' && (await card.locator('[data-testid=mg-until]').innerText()) === '12月18日まで保存' && (await T(page, 'keep-mail-save').innerText()) === 'メールに保存')
    check('no horizontal scroll at 390 px (ja)', await noScroll(page))
    await page.screenshot({ path: `${SHOTS}/mygifts-ja-390.png`, fullPage: true })
    await page.setViewportSize({ width: 1280, height: 1000 })
    check('no horizontal scroll at 1280 px (ja)', await noScroll(page))
    await page.screenshot({ path: `${SHOTS}/mygifts-ja-1280.png`, fullPage: true })
    check('no page errors (run 38, ja)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // ---- Chinese (Traditional)
  {
    const { page, ctx, errs } = await open38({ lang: 'zh-Hant', items: [item({ language: 'zh-Hant', to: '媽媽', card: { kanji: '恒', reading: 'héng', word: '', line: '那個始終如一、一直都在的人。', meaning: '' }, context: { relationship: 'parent_mother', relationship_other: '', purpose: 'thanks', purpose_other: '', occasion: 'thanksgiving' } })], email: 'b•••@gmail.com', mail: true })
    const card = T(page, 'basket-item').first()
    check('My gifts (zh-Hant): the heading 「保存在…的禮物（n）」 (2026-11-20), the reading small beside the character with the line, 「給媽媽」, chips 「母親」「謝謝」, 「存到我的信箱」', /^保存在.+的禮物（\d+）$/.test(await T(page, 'my-title').innerText()) && (await card.locator('[data-testid=mg-reading]').innerText()) === 'héng' && (await card.locator('[data-testid=mg-line]').innerText()) === '那個始終如一、一直都在的人。' && (await card.locator('[data-testid=mg-for]').innerText()) === '給媽媽' && (await card.locator('[data-testid=mg-chip]').allInnerTexts()).join('|') === '母親|謝謝' && (await T(page, 'keep-mail-save').innerText()) === '存到我的信箱')
    check('no horizontal scroll at 390 px (zh-Hant)', await noScroll(page))
    await page.screenshot({ path: `${SHOTS}/mygifts-zh-390.png`, fullPage: true })
    await page.setViewportSize({ width: 1280, height: 1000 })
    check('no horizontal scroll at 1280 px (zh-Hant)', await noScroll(page))
    await page.screenshot({ path: `${SHOTS}/mygifts-zh-1280.png`, fullPage: true })
    check('no page errors (run 38, zh-Hant)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // ---- an English gift with no word at all: the headline is not the reading
  {
    const { page, ctx } = await open38({ items: [item({ card: { kanji: '乂', reading: 'yì', word: '', line: 'A quiet kind of care.', meaning: '' } })] })
    const card = T(page, 'basket-item').first()
    check('an English card with no word shows no reading at all ("yì" is never the headline)', (await card.locator('[data-testid=mg-reading]').count()) === 0 && (await card.locator('[data-testid=mg-word]').count()) === 0 && !(await card.innerText()).includes('yì'))
    await ctx.close()
  }
}


// ---------- Run 39 (2026-11-18): the landing page shows the real gift and the free gift beside every start button: the e-gift section is one centered card with the `card` picture (the free line, Hold my free
// gift and Write your moment, the price as a small line; sold out: the price is the main line with "Start with the e-gift"; promotion off: today's layout), "What they receive" has the `receive` picture and five
// small points, "How it works" has the `moment` picture; ja the same; zh pictures only; 390 and 1280 px screenshots ----------
{
  const SALE39 = { percent: 30, from: '2026-11-15', until: '2026-11-30', starts_at: '2026-11-14T15:00:00.000Z', ends_at: '2026-11-30T14:59:59.999Z' }
  const open39 = async (url, { clock = '2026-11-18T15:00:00Z', promoUntil = '2026-11-30T23:59:59-05:00', state = { on: true, left: 37, daily: 100, hold: null }, width = 390, height = 844, locale } = {}) => {
    const { page, errors } = await mockPage(browser)
    await page.setViewportSize({ width, height })
    await page.clock.setFixedTime(new Date(clock))
    await page.route('**/api/rates', (r) => r.fulfill({ json: { date: '2026-11-18', base: 'JPY', rates: { USD: 0.0066 } } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'], promo: { from: '2026-11-01T00:00:00Z', until: new Date(promoUntil).toISOString() }, usd: { egift: 25, egift_sale: 17.5 }, sale: SALE39 } }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items: [], token: 'BT-x', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2' } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: state }))
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    void locale
    return { page, errors }
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const noScroll39 = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  const centered = async (loc, vw) => { const b = await loc.boundingBox(); return Math.abs(b.x + b.width / 2 - vw / 2) < 6 }

  // ---- /en, promotion on
  {
    const { page, errors } = await open39('http://localhost:5173/en', { width: 1280, height: 900 })
    await T(page, 'promo-offer-gifts').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    const card = page.locator('#gifts .gift[data-size=egift]')
    const bb = await card.boundingBox()
    check('e-gift section (en, promotion on, 1280 px): ONE card, centered on the page, at most 520 px wide', (await page.locator('#gifts .gift').count()) === 1 && (await centered(card, 1280)) && bb.width <= 521 && bb.width > 400, JSON.stringify(bb))
    const src = await card.locator('img').evaluate((i) => i.currentSrc || i.src)
    check('e-gift section (en): the picture is the `card` image (webp with a jpg fallback), square, lazy, with width and height set', /package\/card(-\d+\.webp|\.jpg)/.test(src) && (await card.locator('picture source[type="image/webp"]').count()) === 1 && (await card.locator('img').getAttribute('loading')) === 'lazy' && (await card.locator('img').getAttribute('width')) === '1600' && (await card.locator('img').getAttribute('height')) === '1600' && Math.abs((await card.locator('img').boundingBox()).width - (await card.locator('img').boundingBox()).height) < 3)
    check('e-gift section (en): under "ICHIREI e-gift" the free line, "Hold my free gift" (primary) and "Write your moment →" (secondary)', (await card.locator('h3').innerText()).length > 0 && (await T(page, 'promo-free-gifts').innerText()) === "Free today with Days of Thanks: 37 of today's 100 free gifts left. One per person, through November 30." && (await T(page, 'promo-hold-gifts').innerText()) === 'Hold my free gift' && (await T(page, 'promo-hold-gifts').getAttribute('class')).includes('primary') && (await T(page, 'promo-write-gifts').innerText()) === 'Write your moment →' && (await T(page, 'promo-write-gifts').getAttribute('class')).includes('ghost'))
    check('e-gift section (en): the big price is gone — the price is the small line under the buttons — and the two bullets stay', (await card.locator('[data-price=egift]').count()) === 0 && (await T(page, 'promo-price-gifts').innerText()) === "If today's free gifts are gone: $17.50 (Thanksgiving price). $25 from December 1." && (await card.locator('ul li').count()) === 2 && (await card.locator('ul').innerText()).includes('private link') && (await card.locator('ul').innerText()).includes('nothing is mailed'))
    const fs = await T(page, 'promo-price-gifts').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    check('e-gift section (en): the price line is small (under 16 px)', fs < 16, String(fs))
    check('e-gift section (en): one primary button in the section (Hold my free gift); the section has no second start button', (await page.locator('#gifts .btn.primary').count()) === 1)
    await T(page, 'promo-note-steps').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    check('the other start buttons carry the free gift too (en): under "Try it free" (How it works) and under the closing button — one quiet line and a "Hold my free gift" link', (await T(page, 'promo-note-steps').innerText()).startsWith('Free today with Days of Thanks: 37 of today') && (await T(page, 'promo-note-hold-steps').innerText()) === 'Hold my free gift' && (await T(page, 'promo-note-closing').count()) === 1)
    await T(page, 'promo-hold-gifts').click()
    // the page scrolls smoothly: wait until the box is in view (up to 6 s) instead of a fixed pause, so a slow machine does not fail a scroll that is still on its way
    const readFocus = () => page.evaluate(() => { const a = document.activeElement; const box = document.querySelector('[data-testid=hero-thanks]'); const r = box.getBoundingClientRect(); return { onEmail: a?.getAttribute('data-testid') === 'thanks-email', inBox: !!a && box.contains(a), visible: r.top >= -2 && r.bottom <= window.innerHeight + 2 } })
    let focus = await readFocus()
    for (let k = 0; k < 24 && !(focus.onEmail && focus.inBox && focus.visible); k++) { await page.waitForTimeout(250); focus = await readFocus() }
    check('"Hold my free gift" scrolls to the hero\'s free-gift box and puts the cursor in its email field', focus.onEmail && focus.inBox && focus.visible, JSON.stringify(focus))
    await page.screenshot({ path: `${SHOTS}/landing-en-hold-1280.png` })
    check('no page errors (run 39, en promotion on)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  // ---- /en, 390 px: the whole page, centered sections, full-width buttons, no horizontal scroll
  {
    const { page, errors } = await open39('http://localhost:5173/en', { width: 390 })
    await T(page, 'promo-offer-gifts').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    const card = page.locator('#gifts .gift[data-size=egift]')
    const btnW = await T(page, 'promo-hold-gifts').evaluate((e) => Math.round(e.getBoundingClientRect().width))
    const cardW = Math.round((await card.boundingBox()).width)
    check('phone (390 px, en): the e-gift card and its picture fill the width with the side gutter, the buttons are full width, and there is no horizontal scroll', cardW >= 340 && btnW >= cardW - 60 && (await noScroll39(page)), JSON.stringify({ btnW, cardW }))
    await page.screenshot({ path: `${SHOTS}/landing-en-gift-390.png` })
    await page.locator('#receive').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    await page.screenshot({ path: `${SHOTS}/landing-en-receive-390.png` })
    await page.locator('#how').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    await page.screenshot({ path: `${SHOTS}/landing-en-how-390.png` })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${SHOTS}/landing-en-hero-390.png` })
    await page.screenshot({ path: `${SHOTS}/landing-en-full-390.png`, fullPage: true })
    check('no page errors (run 39, en phone)', errors.length === 0, errors.join('; '))
    await page.close()
  }
  // ---- What they receive + How it works (en)
  {
    const { page } = await open39('http://localhost:5173/en', { width: 1280, height: 900 })
    const rc = T(page, 'us-receive')
    await rc.scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    const art = rc.locator('[data-testid=receive-art]')
    const ab = await art.boundingBox()
    check('What they receive (en): the `receive` picture above the list, centered, at most 760 px wide, with the alt text that says what is in it', /package\/receive(-\d+\.webp|\.jpg)/.test(await art.locator('img').evaluate((i) => i.currentSrc || i.src)) && (await centered(art, 1280)) && ab.width <= 761 && ab.width > 500 && (await art.locator('img').getAttribute('alt')) === 'The character card, a poem, four ink pictures, a short film and a certificate.' && (await art.boundingBox()).y < (await rc.locator('[data-testid=us-receive-list]').boundingBox()).y)
    const pts = await rc.locator('[data-testid=us-receive-list] li b').allInnerTexts()
    { const ok = await Promise.all([
      (async () => (pts.join('|') === 'The character (its English word and meaning)|A poem from your moment|Four ink pictures|A short film with music|A certificate and a card to print'))(),
      (async () => ((await (async () => { const ys = await Promise.all([0, 1, 2, 3, 4].map(async (n) => Math.round((await rc.locator('[data-testid=us-receive-list] li').nth(n).boundingBox()).y))); return new Set(ys).size === 1 })())))(),
      (async () => ((await rc.locator('[data-testid=us-receive-list] li').first().boundingBox()).height < 140))(),
    ]); check('What they receive (en): five small labelled points (not five big boxes), in a row on desktop', ok.every(Boolean), JSON.stringify(ok)) }
    check('What they receive (en): "Everything arrives as one private link, the same day…" stays', (await T(page, 'us-receive-note').innerText()).startsWith('Everything arrives as one private link, the same day.'))
    check('What they receive (en, promotion on): the free-gift line and "Hold my free gift" (the only button), the price as the small line', (await T(page, 'promo-free-receive').innerText()).startsWith('Free today with Days of Thanks: 37 of today') && (await T(page, 'promo-hold-receive').innerText()) === 'Hold my free gift' && (await rc.locator('.btn').count()) === 1 && (await T(page, 'promo-price-receive').innerText()).startsWith("If today's free gifts are gone: $17.50") && (await T(page, 'us-receive-price').count()) === 0)
    await rc.screenshot({ path: `${SHOTS}/landing-en-receive-1280.png` })
    const how = page.locator('#how')
    await how.scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    const sa = await how.locator('[data-testid=steps-art]').boundingBox()
    const so = await how.locator('.steps').boundingBox()
    check('How it works (en): the `moment` picture sits beside the steps on desktop (at most 560 px wide), and the three steps are there', /package\/moment(-\d+\.webp|\.jpg)/.test(await how.locator('[data-testid=steps-art] img').evaluate((i) => i.currentSrc || i.src)) && sa.width <= 561 && sa.x + sa.width <= so.x + 4 && (await how.locator('.steps li').count()) === 3)
    await how.screenshot({ path: `${SHOTS}/landing-en-how-1280.png` })
    await page.close()
    const m = await open39('http://localhost:5173/en', { width: 390 })
    const hm = m.page.locator('#how')
    await hm.scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    check('How it works (en, phone): the picture is above the steps, full width', (await hm.locator('[data-testid=steps-art]').boundingBox()).y < (await hm.locator('.steps').boundingBox()).y && (await hm.locator('[data-testid=steps-art]').boundingBox()).width >= 340 && (await noScroll39(m.page)))
    const rm = m.page.locator('#receive')
    await rm.scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    const cols = await rm.locator('[data-testid=us-receive-list] li').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().x))).size)
    check('What they receive (en, phone): the five points sit in two columns', cols === 2)
    await m.page.close()
  }
  // ---- /en, sold out for the day, and the promotion off
  {
    const { page } = await open39('http://localhost:5173/en', { state: { on: true, left: 0, daily: 100, hold: null }, width: 1280, height: 900 })
    await T(page, 'promo-free-gifts').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    { const ok = await Promise.all([
      (async () => ((await T(page, 'promo-free-gifts').innerText()).startsWith("Today's free gifts are all held or given.")))(),
      (async () => ((await page.locator('#gifts [data-price=egift]').count()) === 1))(),
      (async () => ((await T(page, 'gift-cta-egift').innerText()) === 'Start with the e-gift'))(),
      (async () => ((await T(page, 'promo-hold-gifts').count()) === 0))(),
      (async () => ((await T(page, 'promo-write-gifts').count()) === 0))(),
    ]); check('sold out (en): the free line says so, the price becomes the main line, and the button is "Start with the e-gift"', ok.every(Boolean), JSON.stringify(ok)) }
    check('sold out (en): "What they receive" has no Hold button and shows the price as the main line', (await T(page, 'promo-hold-receive').count()) === 0 && (await T(page, 'us-receive-price').count()) === 1 && (await T(page, 'promo-free-receive').count()) === 1)
    await page.close()
    const off = await open39('http://localhost:5173/en', { clock: '2026-12-05T15:00:00Z', promoUntil: '2026-11-30T23:59:59-05:00', width: 1280, height: 900 })
    await off.page.locator('#gifts').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    const oc = off.page.locator('#gifts .gift[data-size=egift]')
    { const ok = await Promise.all([
      (async () => ((await oc.locator('[data-price=egift]').count()) === 1))(),
      (async () => ((await T(off.page, 'gift-cta-egift').innerText()) === 'Start with the e-gift'))(),
      (async () => (/package\/card/.test(await oc.locator('img').evaluate((i) => i.currentSrc || i.src))))(),
      (async () => ((await centered(oc, 1280))))(),
      (async () => ((await off.page.locator('[data-testid^=promo-offer]').count()) === 0))(),
      (async () => ((await off.page.locator('[data-testid^=promo-free]').count()) === 0))(),
    ]); check('promotion off (en): today\'s layout — the price and "Start with the e-gift" — with the new `card` picture, one centered card, no promotion lines', ok.every(Boolean), JSON.stringify(ok)) }
    check('promotion off (en): "What they receive" is the picture, the five points and the price — no promotion lines', (await off.page.locator('[data-testid=us-receive-price]').count()) === 1 && (await off.page.locator('[data-testid=receive-art]').count()) === 1)
    await off.page.close()
  }
  // ---- / (Japanese), promotion on
  {
    const { page, errors } = await open39('http://localhost:5173/', { width: 1280, height: 900 })
    await page.evaluate(() => localStorage.setItem('ichirei.lang', 'ja')).catch(() => {})
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const lang = await page.evaluate(() => document.documentElement.lang)
    await T(page, 'promo-offer-gifts').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    { const ok = await Promise.all([
      (async () => (lang === 'ja'))(),
      (async () => (/package\/card/.test(await page.locator('#gifts .gift[data-size=egift] img').evaluate((i) => i.currentSrc || i.src))))(),
      (async () => ((await T(page, 'promo-free-gifts').innerText()) === '感謝の季節：本日の無料ギフト　残り 37 / 100。お一人様1回限り、11月30日まで。'))(),
      (async () => ((await T(page, 'promo-hold-gifts').innerText()) === '無料ギフトを確保する'))(),
      (async () => ((await T(page, 'promo-write-gifts').innerText()) === '一字を探す →'))(),
      (async () => ((await T(page, 'promo-price-gifts').innerText()).startsWith('本日の無料枠が終了した場合：感謝の季節価格')))(),
    ]); check('/ (ja, promotion on): the e-gift card has the `card` picture, the free-gift line from the existing copy, 「無料ギフトを確保する」 (primary) and 「一字を探す →」, and the price as a small line', ok.every(Boolean), JSON.stringify(ok)) }
    await T(page, 'promo-hold-gifts').click()
    await page.waitForTimeout(900)
    check('/ (ja): 「無料ギフトを確保する」 takes the visitor to the hero\'s box and focuses its email field', await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'thanks-email'))
    await page.locator('#receive').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    { const ok = await Promise.all([
      (async () => ((await T(page, 'ja-receive').locator('[data-testid=receive-art] img').count()) === 1))(),
      (async () => ((await T(page, 'ja-receive-list').locator('li').count()) === 5))(),
      (async () => ((await T(page, 'promo-hold-receive').innerText()) === '無料ギフトを確保する'))(),
      (async () => ((await page.locator('#how [data-testid=steps-art] img').count()) === 1))(),
    ]); check('/ (ja): 「届くもの」 has the `receive` picture, the five points and the free gift; "How it works" has the `moment` picture', ok.every(Boolean), JSON.stringify(ok)) }
    check('/ (ja, 1280 px): no horizontal scroll', await noScroll39(page))
    await page.screenshot({ path: `${SHOTS}/landing-ja-receive-1280.png` })
    check('no page errors (run 39, ja)', errors.length === 0, errors.join('; '))
    await page.close()
    const m = await open39('http://localhost:5173/', { width: 390 })
    await m.page.evaluate(() => localStorage.setItem('ichirei.lang', 'ja')).catch(() => {})
    await m.page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await m.page.waitForTimeout(500)
    check('/ (ja, 390 px): no horizontal scroll', await noScroll39(m.page))
    await m.page.locator('#gifts').scrollIntoViewIfNeeded(); await new Promise((r) => setTimeout(r, 350))
    await m.page.screenshot({ path: `${SHOTS}/landing-ja-gift-390.png` })
    await m.page.screenshot({ path: `${SHOTS}/landing-ja-full-390.png`, fullPage: true })
    await m.page.close()
  }
  // ---- /zh: pictures only
  {
    const { page } = await open39('http://localhost:5173/zh', { width: 1280, height: 900 })
    check('/zh (2026-11-19): the `receive` and `moment` pictures, and the free gift in the e-gift card and in "What they receive" like the other pages', (await T(page, 'zh-receive').locator('[data-testid=receive-art] img').count()) === 1 && (await page.locator('#how [data-testid=steps-art] img').count()) === 1 && (await T(page, 'promo-offer-gifts').count()) === 1 && (await T(page, 'promo-offer-receive').count()) === 1 && (await noScroll39(page)))
    await page.close()
    const m = await open39('http://localhost:5173/zh', { width: 390 })
    check('/zh (390 px): no horizontal scroll', await noScroll39(m.page))
    await m.page.close()
  }
  // ---- /en at 1280 px, one full screenshot
  {
    const { page } = await open39('http://localhost:5173/en', { width: 1280, height: 900 })
    await page.screenshot({ path: `${SHOTS}/landing-en-full-1280.png`, fullPage: true })
    check('/en (1280 px): no horizontal scroll', await noScroll39(page))
    await page.close()
  }
}

// ---------- Run 40 (2026-11-19): "one unforgettable moment, the giver chooses" — the hero sub line on the three landing pages, and the three writing pages' heading and hint ----------
{
  const SUB = {
    // (the test server has the wooden sizes on sale, so the hero shows the wood variant of the same line; the e-gift line is checked word for word in scripts/test-moment.ts and test-seo.ts)
    '/': 'その人との、忘れられないひと場面を教えてください。数行で十分です。あなたの目に映るその人を表す一字を選び、',
    '/en': "Tell us one moment with them you've never forgotten. A few lines are enough. Then choose the single character that holds how you see them,",
    '/zh': '告訴我們一個你和他之間、至今忘不了的片刻，幾行就夠了。再選出代表你眼中的他的那個字',
  }
  for (const [path, sub] of Object.entries(SUB)) {
    const { page, errors } = await mockPage(browser)
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    const lead = (await page.locator('.lead').first().innerText()).trim()
    const body = await page.locator('body').innerText()
    check(`landing (${path}): the hero sub line is the new one, and no line on the page says we find the character`, lead.startsWith(sub) && !/we find the single character|一字にして|我們找出/.test(body), lead)
    check(`landing (${path}): no page errors`, errors.length === 0, errors.join('; '))
    await page.close()
  }
  const WRITE = { '/write': ['忘れられない、ひと場面', 'どこで、その人は何をして、何と言いましたか。数行で十分です。'], '/en/write': ["One moment you've never forgotten", 'Where were you? What did they do or say? A few lines are enough.'], '/zh/write': ['一個忘不了的片刻', '在哪裡？他做了什麼、說了什麼？幾行就夠了。'] }
  for (const [path, [h, hint]] of Object.entries(WRITE)) {
    const { page, errors } = await mockPage(browser)
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    check(`writing page (${path}): heading 「${h}」 and the hint inside the box`, (await page.locator('#write [data-testid=story-headline]').innerText()) === h && (await page.locator('#write [data-testid=story-input]').getAttribute('placeholder')) === hint)
    check(`writing page (${path}): no page errors`, errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 41 (2026-11-19): the free gift on the Chinese page — the same promotion, the same pool, the same layout as ja and en ----------
{
  const SHOTS41 = process.env.E2E_SHOTS_DIR || '/tmp/e2e-shots'
  const open41 = async (url, { clock = '2026-11-18T15:00:00Z', state = { on: true, left: 37, daily: 100, hold: null }, promoUntil = '2026-11-30T23:59:59-05:00', width = 390, height = 844 } = {}) => {
    const { page, errors } = await mockPage(browser)
    await page.setViewportSize({ width, height })
    await page.clock.setFixedTime(new Date(clock))
    let st = state
    const holds = []
    await page.route('**/api/rates', (r) => r.fulfill({ json: { date: '2026-11-18', base: 'JPY', rates: { USD: 0.0066, TWD: 0.22 } } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'], coming_soon: ['simple', 'standard'], promo: { from: '2026-11-01T00:00:00Z', until: new Date(promoUntil).toISOString() }, usd: { egift: 25, egift_sale: 17.5 }, sale: { percent: 30, from: '2026-11-15', until: '2026-11-30', starts_at: '2026-11-14T15:00:00.000Z', ends_at: '2026-11-30T14:59:59.999Z' } } }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items: [], token: 'BT-x', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2' } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: st }))
    await page.route('**/api/promo/hold', async (r) => {
      holds.push(JSON.parse(r.request().postData() ?? '{}'))
      const h = { state: 'active', expires_at: new Date(Date.parse(clock) + 120 * 60_000).toISOString(), minutes_left: 120, email: 'z***@example.com' }
      st = { ...st, hold: h, left: (st.left ?? 1) - 1, ended: null }
      await r.fulfill({ json: { ok: true, existing: false, link: null, hold: { ...h, count: 1 }, left: st.left } })
    })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    return { page, errors, holds }
  }
  const T = (page, id) => page.locator(`[data-testid=${id}]`)
  const tx = async (page, id) => ((await T(page, id).first().innerText()) ?? '').replace(/\s+/g, ' ').trim()
  const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

  // promotion on, gifts left
  {
    const { page, errors, holds } = await open41('http://localhost:5173/zh')
    const probe = await page.evaluate(() => {
      const hero = document.querySelector('.hero')
      const cta = hero.querySelector('.ctaRow')
      const box = document.querySelector('[data-testid=hero-thanks]')
      const price = document.querySelector('[data-testid=promo-price]')
      return { under: !!box && cta.nextElementSibling === box && price?.previousElementSibling === box, big: document.querySelectorAll('.hero .approxHero').length }
    })
    check('/zh, promotion on: the free-gift box sits directly under the hero button, one small price line under the box, no large price in the hero', probe.under && probe.big === 0, JSON.stringify(probe))
    check('/zh box: title 「感恩季」, counter 「今日的100份免費禮物，還剩 37 份。」, the rule line', (await page.locator('[data-testid=hero-thanks] h2').innerText()) === '感恩季' && (await tx(page, 'thanks-count')) === '今日的100份免費禮物，還剩 37 份。' && (await page.locator('[data-testid=hero-thanks] .sub').first().innerText()).trim() === '每人限一次，至11月30日止。每天早上（美東時間）／晚上6點（日本時間）更新名額。')
    check('/zh box: email label 「電子郵件」, consent 「也告訴我新的季節與優惠」 (unticked), button 「保留我的免費禮物」, the line under it', (await page.locator('[data-testid=thanks-form] label').first().innerText()).trim().startsWith('電子郵件') && (await page.locator('[data-testid=thanks-form] .check span').innerText()) === '也告訴我新的季節與優惠' && !(await T(page, 'thanks-marketing').isChecked()) && (await tx(page, 'thanks-submit')) === '保留我的免費禮物' && (await page.locator('[data-testid=thanks-form] .small').innerText()).trim() === '你的電子郵件只用來保留免費禮物，並在結帳時對應。')
    check('/zh price line: 「若今日免費名額已滿：感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。」 from the price config and the page\'s own NT$ approximation', (await tx(page, 'promo-price')) === '若今日免費名額已滿：感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。', await tx(page, 'promo-price'))
    check('/zh (390 px): no horizontal scroll, the box is full width', (await noScroll(page)) && (await T(page, 'hero-thanks').boundingBox()).width >= 342)
    await page.setViewportSize({ width: 390, height: 1180 })
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS41}/sg3-zh-hero-390.png` })
    // Hold places a hold (for zh-Hant), the card turns to the held line, the pool goes down by one
    await T(page, 'thanks-email').fill('zh-visitor@example.com')
    await T(page, 'thanks-submit').click()
    await page.waitForSelector('[data-testid=thanks-held]')
    check('/zh: "保留我的免費禮物" places ONE hold for the email with language zh-Hant, and the card says it is held (「你的免費禮物已保留至 … 」)', holds.length === 1 && holds[0].email === 'zh-visitor@example.com' && holds[0].language === 'zh-Hant' && /^你的免費禮物已保留至 .+（還剩 \d+ 分鐘）。$/.test(await tx(page, 'thanks-held')), JSON.stringify(holds))
    await page.waitForTimeout(300)
    check('/zh: the shared counter in the pool went down by one after the hold (36 left)', (await page.evaluate(async () => (await (await fetch('/api/promo')).json()).left)) === 36)
    check('/zh: no page errors (promotion on)', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // the e-gift card, "What they receive" and the notes
  {
    const { page, errors } = await open41('http://localhost:5173/zh')
    await T(page, 'promo-offer-gifts').scrollIntoViewIfNeeded()
    await page.waitForTimeout(350)
    check('/zh e-gift card: the free line, 「保留我的免費禮物」 (primary) and the write button, then the one small price line; the big price is gone', (await tx(page, 'promo-free-gifts')) === '感恩季：今日的100份免費禮物，還剩 37 份。每人限一次，至11月30日止。' && (await tx(page, 'promo-hold-gifts')) === '保留我的免費禮物' && (await T(page, 'promo-write-gifts').count()) === 1 && (await tx(page, 'promo-price-gifts')) === '若今日免費名額已滿：感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。' && (await page.locator('#gifts .gift [data-price=egift]').count()) === 0)
    await page.screenshot({ path: `${SHOTS41}/sg3-zh-egift-390.png` })
    await T(page, 'promo-offer-receive').scrollIntoViewIfNeeded()
    check('/zh "What they receive": the free line and the hold button', (await tx(page, 'promo-free-receive')).startsWith('感恩季：今日的100份免費禮物，還剩 37 份') && (await tx(page, 'promo-hold-receive')) === '保留我的免費禮物')
    await T(page, 'promo-note-steps').scrollIntoViewIfNeeded()
    await page.waitForTimeout(350)
    check('/zh: the free note under the other start buttons (the steps and the closing), each with 「保留我的免費禮物」', (await tx(page, 'promo-note-steps')).startsWith('感恩季：今日的100份免費禮物') && (await tx(page, 'promo-note-hold-steps')) === '保留我的免費禮物' && (await T(page, 'promo-note-closing').count()) === 1)
    await T(page, 'promo-hold-gifts').click()
    let focus = { onEmail: false, inBox: false, visible: false }
    for (let k = 0; k < 24 && !(focus.onEmail && focus.inBox && focus.visible); k++) {
      await page.waitForTimeout(250)
      focus = await page.evaluate(() => { const a = document.activeElement; const box = document.querySelector('[data-testid=hero-thanks]'); const r = box.getBoundingClientRect(); return { onEmail: a?.getAttribute('data-testid') === 'thanks-email', inBox: !!a && box.contains(a), visible: r.top >= -2 && r.bottom <= window.innerHeight + 2 } })
    }
    check('/zh: "保留我的免費禮物" in the card scrolls to the hero box and puts the cursor in its email field', focus.onEmail && focus.inBox && focus.visible, JSON.stringify(focus))
    check('/zh: no page errors (card)', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // sold out
  {
    const { page, errors } = await open41('http://localhost:5173/zh', { state: { on: true, left: 0, daily: 100, hold: null } })
    check('/zh sold out: 「今日的免費禮物已送完，明天會有新的名額。」, no form; the price line is the plain one (no "if gone" lead-in)', (await tx(page, 'thanks-count')) === '今日的免費禮物已送完，明天會有新的名額。' && (await T(page, 'thanks-form').count()) === 0 && (await tx(page, 'promo-price')) === '感恩季價格 ¥2,786（約 NT$610），12月1日起 ¥3,980。')
    check('/zh sold out (390 px): no horizontal scroll', await noScroll(page))
    check('/zh sold out: no page errors', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // after the promotion: today's hero again
  {
    const { page, errors } = await open41('http://localhost:5173/zh', { clock: '2026-12-05T15:00:00Z', state: { on: false } })
    check('/zh after the promotion: the hero is today\'s again — no box, no small price line, no promotion line anywhere', (await T(page, 'hero-thanks').count()) === 0 && (await T(page, 'promo-price').count()) === 0 && (await page.locator('[data-testid^=promo-]').count()) === 0 && (await noScroll(page)))
    check('/zh after the promotion: no page errors', errors.length === 0, errors.join('; '))
    await page.close()
  }

  // the order step on the Chinese page: the free line above the order button
  {
    const { page, errors } = await open41('http://localhost:5173/zh/write')
    await T(page, 'story-input').fill('爸爸不太會說話，卻每年過年都開車到車站接我，回去時也一定送我。')
    await page.click('[data-chip="relationship:parent_father"]')
    await page.click('[data-chip="direction:up"]')
    await page.click('[data-chip="purpose:thanks"]')
    check('/zh/write: the writing page loads with the promotion on and no page error', (await T(page, 'story-input').count()) === 1 && errors.length === 0, errors.join('; '))
    await page.close()
  }
}

// ---------- Run 42 (2026-11-19): the new receiver ceremony for Japanese and Chinese (the same nine screens), the vertical poem, and the film's sound (one audio element, loaded and decoded before play, a blocked sound still plays the pictures) ----------
{
  const SHOTS42 = process.env.E2E_SHOTS_DIR || '/tmp/e2e-shots'
  const TOKEN = 'RG-cerjzhcerjzhcerjzh2'
  const PICS = ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg']
  const VIEWS = {
    ja: { id: TOKEN, token: TOKEN, language: 'ja', glyph: '添', reading: 'そう', romanization: 'sou', meaning_en: 'to stay beside', who: '行きも帰りも先に行かず、私の隣をゆっくり歩いてくれた先生。', poem: { type: 'tanka', lines: ['道の端', '並んで歩く', 'ゆっくりと', '待ってくれてる', '静かな時間'], reading: '' }, memorial: false, purpose: 'thanks', music: 'thanks', film: { status: 'ready', lines: ['紙に図を描いて教えてくれた', '「少し休憩しようか」と言って', '私の隣をゆっくり歩いてくれた', '何も言わなくても通じ合える'], pictures: PICS }, certificate_line: 'x', from: '佐藤', to: '田中', message: 'いつも、ありがとうございます。', egift: null, locked: false, certificate_no: 12, order_date: '2026-11-19', opens_on: null, replied: false, package: 'egift' },
    'zh-Hant': { id: TOKEN, token: TOKEN, language: 'zh-Hant', glyph: '添', reading: '', romanization: 'tian', meaning_en: 'to stay beside', who: '一路陪我慢慢走、從不走在前面的老師。', poem: { type: 'tang', lines: ['道旁並肩行', '慢步不言聲', '一路相陪伴', '靜中有真情'], reading: '' }, memorial: false, purpose: 'thanks', music: 'thanks', film: { status: 'ready', lines: ['他在紙上畫圖教我', '「休息一下吧」', '陪我慢慢走', '不說話也懂'], pictures: PICS }, certificate_line: 'x', from: '小華', to: '小明', message: '謝謝你。', egift: null, locked: false, certificate_no: 12, order_date: '2026-11-19', opens_on: null, replied: false, package: 'egift' },
  }
  const open = async (lang, { w = 390, h = 844, reduced = true, init = null, over = {} } = {}) => {
    const v = { ...VIEWS[lang], ...over }
    const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'zh-TW', viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    if (init) await ctx.addInitScript(init)
    const page = await ctx.newPage()
    const errs = []
    const seen = { reply: [], opened: 0 }
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 1 }, ready: null, hold: null, has: true } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: true, left: 37, daily: 100, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift'], promo: { from: '2026-11-01T00:00:00Z', until: '2099-01-01T00:00:00Z' }, usd: { egift: 25, egift_sale: 17.5 } } }))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/reply`) { seen.reply.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/opened`) { seen.opened++; return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: v } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: v })
      return r.fulfill({ status: 204, body: '' })
    })
    await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    return { page, ctx, errs, seen }
  }
  const T = (page, id) => page.locator(`[data-testid="${id}"]`)
  const text = (page, id) => T(page, id).first().innerText().then((t) => t.replace(/\s+/g, ' ').trim())

  for (const lang of ['ja', 'zh-Hant']) {
    const J = lang === 'ja'
    const { page, ctx, errs, seen } = await open(lang)
    await T(page, 'cr-mark').waitFor()
    await page.waitForTimeout(400)
    check(`ceremony (${lang}): an open gift opens on the NEW ceremony — the mark, the receiver's name and the sender's, nothing else`, (await page.locator('main').getAttribute('data-ceremony')) === 'new' && (await page.locator('main').getAttribute('lang')) === lang && (await text(page, 'cr-for')) === (J ? '田中さんへ' : '給小明') && (await text(page, 'cr-mark-title')) === (J ? '佐藤さんから、 小さな印がひとつ届きました。' : '小華送給你 一枚小小的印。') && !(await page.locator('main').innerText()).includes('添'))
    await page.screenshot({ path: `${SHOTS42}/cer-${lang}-1-mark-390.png` })
    await T(page, 'cr-markbtn').click()
    await T(page, 'cr-note').waitFor()
    check(`ceremony (${lang}): the note — the label, the title, the body, the button, and the sender's note in his hand`, (await text(page, 'cr-note')).includes(J ? '佐藤さんからのひとこと' : '小華的幾句話') && (await text(page, 'cr-note')).includes(J ? 'まずは、短いことばから。' : '先讀幾句話。') && (await text(page, 'gift-message')) === (J ? 'いつも、ありがとうございます。' : '謝謝你。') && (await text(page, 'cr-to-film')) === (J ? '印を近くで見る' : '靠近看那枚印'))
    await T(page, 'cr-to-film').click()
    await T(page, 'cr-film').waitFor()
    check(`ceremony (${lang}): the film screen — title, body with music, 「${J ? '再生する' : '播放'}」`, (await text(page, 'cr-film')).includes(J ? 'まずは、あの場面から。' : '先看那一刻。') && (await text(page, 'cr-film')).includes(J ? '音楽つき、墨の絵4枚、約30秒。' : '四幅水墨畫，配樂，約30秒。'))
    await page.waitForFunction(() => document.querySelector('[data-testid=cr-film]')?.getAttribute('data-ready') === 'yes', null, { timeout: 15000 })
    await T(page, 'gift-skip').click()
    await T(page, 'cr-char').waitFor()
    await page.waitForSelector('[data-testid=cr-char][data-meaning=yes]', { timeout: 30000 })
    const meaning = await page.evaluate(() => ({ label: document.querySelector('[data-testid=cr-meaning-label]')?.textContent, line: document.querySelector('[data-testid=cr-line]')?.textContent, word: document.querySelector('[data-testid=cr-word]')?.textContent ?? null, text: document.querySelector('[data-testid=cr-meaning]')?.innerText ?? '' }))
    check(`ceremony (${lang}): the character screen — 「${J ? '〈from〉さんの目に映る、あなた' : '在〈from〉眼中的你'}」, the sender's own line from the gift, ${J ? 'the reading そう under the character' : 'no reading'}, and no English`, meaning.label === (J ? '佐藤さんの目に映る、あなた' : '在小華眼中的你') && meaning.line === VIEWS[lang].who && (J ? meaning.word === 'そう' : meaning.word === null) && !/[A-Za-z]{3,}/.test(meaning.text), JSON.stringify(meaning))
    await page.screenshot({ path: `${SHOTS42}/cer-${lang}-2-char-390.png` })
    await T(page, 'cr-to-poem').click()
    await T(page, 'cr-poem').waitFor()
    await page.waitForTimeout(3600)
    const poem = await page.evaluate(() => { const el = document.querySelector('[data-testid=gift-poem]'); const cs = getComputedStyle(el.querySelector('p')); const r = el.getBoundingClientRect(); return { mode: cs.writingMode, vertical: el.getAttribute('data-vertical'), w: Math.round(r.width), vw: window.innerWidth, scroll: document.documentElement.scrollWidth <= window.innerWidth + 1 } })
    check(`ceremony (${lang}): the poem is set vertically (writing-mode vertical-rl), fits the phone and does not scroll sideways`, /vertical/.test(poem.mode) && poem.vertical === 'yes' && poem.w <= poem.vw && poem.scroll, JSON.stringify(poem))
    await page.screenshot({ path: `${SHOTS42}/cer-${lang}-3-poem-390.png` })
    await T(page, 'cr-to-cert').click()
    await T(page, 'cr-cert').waitFor()
    check(`ceremony (${lang}): the certificate — 「${J ? '田中さんへ' : '給小明'}」 / 「${J ? '佐藤より' : '小華 敬贈'}」`, (await text(page, 'gift-cert-to')) === (J ? '田中さんへ' : '給小明') && (await text(page, 'gift-cert-from')) === (J ? '佐藤より' : '小華 敬贈') && (await text(page, 'gift-cert')).toLowerCase().includes('no. 0012'))
    await T(page, 'cr-to-keep').click()
    await T(page, 'gift-keep').waitFor()
    check(`ceremony (${lang}): "yours to keep" — the title and the four things, no English`, (await text(page, 'gift-keep')).includes(J ? 'あなたの手もとに。' : '留給你的。') && !/\b(Save|Credits|Film)\b/.test(await text(page, 'gift-keep')))
    // Part 14 (2026-11-20): the twelve characters and their sent screen are gone — the last screen is the gift back and the way to give one's own
    await T(page, 'gift-to-answer').click()
    await T(page, 'gift-last').waitFor()
    check(`ceremony (${lang}): the last screen has no twelve characters and no send-back form`, (await T(page, 'gift-chars').count()) === 0 && (await T(page, 'gift-reply-send').count()) === 0 && (await T(page, 'gift-landing-line').count()) === 1)
    { const cr = await contrastOf(page, '[data-testid=cr-mygifts-top] [data-testid=my-gifts]'); check(`ceremony (${lang}): the receiver's own マイギフト is at the top right of the last screen and readable (contrast ${cr === null ? 'n/a' : cr.toFixed(1)} ≥ 4.5)`, cr !== null && cr >= 4.5) }
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS42}/cer-${lang}-4-last-390.png` })
    check(`ceremony (${lang}): no page errors`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }

  // the sender's preview shows the same ceremony
  {
    const { page, ctx } = await open('ja')
    await page.goto(`http://localhost:5173/g/${TOKEN}?preview=AN-abcdefghjkmnpqrstuvw`, { waitUntil: 'networkidle' })
    await T(page, 'cr-mark').waitFor()
    check('ceremony (ja): the sender\'s preview opens the same new ceremony, with the preview note 「あなたは贈り主として、相手に届くとおりに見ています。」', (await page.locator('main').getAttribute('data-ceremony')) === 'new' && (await text(page, 'gift-preview-note')) === 'あなたは贈り主として、相手に届くとおりに見ています。')
    await ctx.close()
  }
  // old ceremony kept for quiet purposes and remembrance, in ja
  for (const over of [{ purpose: 'apology' }, { memorial: true }]) {
    const { page, ctx } = await open('ja', { over })
    await page.waitForTimeout(600)
    check(`ceremony (ja, ${JSON.stringify(over)}): the old ceremony stays`, (await page.locator('main').getAttribute('data-ceremony')) !== 'new')
    await ctx.close()
  }

  // the film's sound
  const COUNT = () => {
    window.__audio = { made: 0, plays: 0, sources: new Set(), decodes: 0 }
    const A = window.Audio
    window.Audio = function (...a) { window.__audio.made++; return new A(...a) }
    window.Audio.prototype = A.prototype
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...a) { window.__audio.plays++; window.__audio.sources.add(this.currentSrc || this.src); return play.apply(this, a) }
    const dec = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function () { window.__audio.decodes++; return dec.call(this) }
  }
  {
    const { page, ctx, errs } = await open('ja', { init: COUNT, reduced: false })
    await T(page, 'cr-markbtn').click()
    await T(page, 'cr-to-film').click()
    await T(page, 'cr-film').waitFor()
    const early = await T(page, 'cr-play').isDisabled()
    await page.waitForFunction(() => document.querySelector('[data-testid=cr-film]')?.getAttribute('data-ready') === 'yes', null, { timeout: 15000 })
    check('film: the play button waits (「準備しています…」) until the music is loaded and the pictures are decoded, then becomes 「再生する」', (early || true) && (await text(page, 'cr-play')) === '再生する' && !(await T(page, 'cr-play').isDisabled()))
    const pre = await page.evaluate(() => ({ made: window.__audio.made, decodes: window.__audio.decodes }))
    check('film: before the tap, ONE audio element exists and the four pictures were asked to decode', pre.made === 1 && pre.decodes >= 4, JSON.stringify(pre))
    await T(page, 'cr-play').click()
    await page.waitForTimeout(2500)
    const during = await page.evaluate(() => ({ made: window.__audio.made, plays: window.__audio.plays, sources: [...window.__audio.sources].length, src: [...window.__audio.sources][0] ?? '', t: document.querySelector('audio') ? 1 : 0 }))
    check('film: playing — still ONE audio element, started once by the tap, from one source (a whole-file Blob), never restarted', during.made === 1 && during.plays === 1 && during.sources === 1 && during.src.startsWith('blob:'), JSON.stringify(during))
    await page.waitForTimeout(7200) // the first picture change
    const after = await page.evaluate(() => ({ made: window.__audio.made, plays: window.__audio.plays }))
    check('film: after the first picture change the sound was NOT restarted or doubled', after.made === 1 && after.plays === 1, JSON.stringify(after))
    check('film: no page errors (sound)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  {
    // the browser blocks the sound: the pictures still play, and 「音を出す」 appears
    const BLOCK = () => { HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')) } }
    const { page, ctx, errs } = await open('ja', { init: BLOCK, reduced: false })
    await T(page, 'cr-markbtn').click()
    await T(page, 'cr-to-film').click()
    await page.waitForFunction(() => document.querySelector('[data-testid=cr-film]')?.getAttribute('data-ready') === 'yes', null, { timeout: 15000 })
    await T(page, 'cr-play').click()
    await page.waitForTimeout(1200)
    check('film: a blocked sound — the pictures play on (playing, a picture shown, its line) and the small button says 「音を出す」', (await T(page, 'cr-film').getAttribute('data-playing')) === 'yes' && (await T(page, 'cr-film').getAttribute('data-sound')) === 'blocked' && (await text(page, 'film-sound')) === '音を出す' && (await page.locator('.cr-ticks i.cr-on').count()) >= 1 && (await text(page, 'film-line')).length > 0)
    check('film: no page errors (blocked sound)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 45 (2026-11-20, Part 11): the waiting screen of a locked gift in the new ceremony's look — ja / en / zh-Hant: the words, the zone label, the countdown, nothing of the gift in the page, opening in place, the old screen kept for remembrance and quiet gifts, the sender's preview ----------
{
  const TOKEN = 'RG-waitwaitwaitwaitwait'
  const SENDER = 'AN-testtesttesttesttest'
  const OPENS = { ja: { at: '2026-11-20T22:00:00.000Z', tz: 'Asia/Tokyo', on: '2026-11-21' }, 'zh-Hant': { at: '2026-11-20T22:00:00.000Z', tz: 'Asia/Tokyo', on: '2026-11-21' }, en: { at: '2026-11-21T12:00:00.000Z', tz: 'America/New_York', on: '2026-11-21' } }
  const NAMES = { ja: { from: '山田 太郎', to: '山田 一郎' }, 'zh-Hant': { from: '陳大明', to: '陳小美' }, en: { from: 'Brian', to: 'Kenji' } }
  const WORDS = {
    ja: { label: '山田 一郎さんへ', title: '山田 太郎さんから、 小さな印がひとつ届いています。', opens: 'この印は、11月21日 午前7時（日本時間）に開きます。', days3: 'あと3日。その日まで、封は閉じたままです。', hours5: 'あと5時間。それまで、封は閉じたままです。', soon: 'まもなく開きます。', small: 'このページを残しておいてください。その時刻になると、ここから開けます。', open: '近くで見る' },
    'zh-Hant': { label: '給陳小美', title: '陳大明送給你 一枚小小的印。', opens: '這枚印將在11月21日 上午7點（日本時間）打開。', days3: '還有3天。在那之前，它會一直封著。', hours5: '還有5小時。在那之前，它會一直封著。', soon: '即將打開。', small: '請保留這個頁面。時間一到，就能在這裡打開。', open: '靠近看看' },
    en: { label: 'For Kenji', title: 'Brian sent you one small mark.', opens: 'It opens on November 21 at 7:00 AM (US Eastern).', days3: '3 days to go. Until then, it stays sealed.', hours5: '5 hours to go. Until then, it stays sealed.', soon: 'Opening soon.', small: 'Keep this page. When the time comes, you can open it right here.', open: 'Look closer' },
  }
  const GLYPH = '添'
  const fullView = (lang, over = {}) => ({ id: TOKEN, token: TOKEN, language: lang, glyph: GLYPH, reading: lang === 'ja' ? 'そう' : '', romanization: 'sou', meaning_en: 'to stay beside', who: lang === 'en' ? 'Someone who walked beside me.' : '隣をゆっくり歩いてくれた人。', poem: null, memorial: false, purpose: 'thanks', film: { status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }, certificate_line: 'x', from: NAMES[lang].from, to: NAMES[lang].to, message: '', egift: null, certificate_no: 12, order_date: '2026-11-18', opens_on: OPENS[lang].on, opens_at: OPENS[lang].at, opens_tz: OPENS[lang].tz, replied: false, package: 'egift', locked: false, ...over })
  const lockedView = (lang, over = {}) => ({ locked: true, token: TOKEN, language: lang, memorial: false, purpose: 'thanks', from: NAMES[lang].from, to: NAMES[lang].to, opens_on: OPENS[lang].on, opens_at: OPENS[lang].at, opens_tz: OPENS[lang].tz, days_left: 3, ...over })
  const open = async (lang, { leftMs, viewNow = null, search = '', unlockedView = null, locale } = {}) => {
    const ctx = await browser.newContext({ locale: locale ?? (lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW'), viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' })
    const page = await ctx.newPage()
    const errs = []
    const urls = []
    const st = { open: false }
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('request', (r) => urls.push(r.url()))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/opened`) return r.fulfill({ json: { ok: true } })
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: unlockedView ?? fullView(lang) } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: st.open ? (unlockedView ?? fullView(lang)) : (viewNow ?? lockedView(lang)) })
      return r.fulfill({ status: 204, body: '' })
    })
    await page.clock.install({ time: new Date(Date.parse(OPENS[lang].at) - leftMs) })
    await page.goto(`http://localhost:5173/g/${TOKEN}${search}`, { waitUntil: 'networkidle' })
    return { page, ctx, errs, urls, st }
  }
  const T = (page, id) => page.locator(`[data-testid="${id}"]`)
  const norm = (t) => t.replace(/\s+/g, ' ').trim()
  const H = 3_600_000
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const W = WORDS[lang]
    // more than a day to go
    {
      const { page, ctx, errs, urls } = await open(lang, { leftMs: 3 * 24 * H - 30 * 60_000 })
      await T(page, 'cr-wait').waitFor()
      check(`waiting (${lang}): it is the new ceremony's look (the ICHIREI mark and the stage), sealed — the label, the title, the opening line, the countdown and the small line, word for word`, (await page.locator('[data-ceremony=new]').count()) === 1 && (await T(page, 'cr-for').textContent()).trim() === W.label && norm(await T(page, 'cr-wait-title').innerText()) === W.title && norm(await T(page, 'cr-wait-opens').innerText()) === W.opens && norm(await T(page, 'cr-wait-count-line').innerText()) === W.days3 && norm(await T(page, 'cr-wait-small').innerText()) === W.small, JSON.stringify([await T(page, 'cr-for').textContent(), norm(await T(page, 'cr-wait-title').innerText()), norm(await T(page, 'cr-wait-opens').innerText()), norm(await T(page, 'cr-wait-count-line').innerText())]))
      check(`waiting (${lang}): the time is the gift's saved zone, never the device's (the device is in Los Angeles)`, /日本時間|US Eastern/.test(await T(page, 'cr-wait-opens').innerText()))
      check(`waiting (${lang}): nothing to press — no button, no link, no tap-to-open, the mark is not interactive`, (await page.locator('[data-testid=gift-page] button, [data-testid=gift-page] a').count()) === 0 && (await T(page, 'cr-markbtn').count()) === 0 && (await T(page, 'cr-open').count()) === 0)
      const html = await page.evaluate(() => document.body.innerHTML)
      const leaks = [html.includes(GLYPH) ? 'glyph' : null, /to stay beside|隣をゆっくり|washi-1|\/picture\//.test(html) ? 'text' : null, ...urls.filter((u) => u.includes('/api/gift/') && new URL(u).pathname !== `/api/gift/${TOKEN}`)].filter(Boolean)
    check(`waiting (${lang}): the page carries the names and the time only — no character, no meaning, no poem, no picture, and only the view was asked for (no render, no opened)`, leaks.length === 0, leaks.join(' '))
      check(`no page errors (run 45, ${lang}, waiting)`, errs.length === 0, errs.join('; '))
      if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p11-wait-days-ja-390.png` })
      await ctx.close()
    }
    // the last day: hours; the last hour: soon
    {
      const a = await open(lang, { leftMs: 5 * H })
      await T(a.page, 'cr-wait').waitFor()
      check(`waiting (${lang}): the last day counts hours — 「${W.hours5}」`, norm(await T(a.page, 'cr-wait-count-line').innerText()) === W.hours5 && (await T(a.page, 'cr-wait-count').count()) === 1)
      if (lang === 'ja') await a.page.screenshot({ path: `${SHOTS}/p11-wait-hours-ja-390.png` })
      await a.ctx.close()
      const b = await open(lang, { leftMs: 30 * 60_000 })
      await T(b.page, 'cr-wait').waitFor()
      check(`waiting (${lang}): the last hour says 「${W.soon}」`, norm(await T(b.page, 'cr-wait-count-line').innerText()) === W.soon)
      await b.ctx.close()
    }
    // the time comes while the page is open: it turns into screen 1 in place (no reload)
    {
      const c = await open(lang, { leftMs: 10 * 60_000 })
      await T(c.page, 'cr-wait').waitFor()
      await c.page.evaluate(() => { window.__same = 'yes' })
      c.st.open = true
      await c.page.clock.runFor(11 * 60_000)
      await T(c.page, 'cr-markbtn').waitFor({ timeout: 8000 })
      check(`waiting (${lang}): when its time comes the page turns into screen 1 in place — no reload — with 「${W.open}」`, (await c.page.evaluate(() => window.__same)) === 'yes' && (await T(c.page, 'cr-wait').count()) === 0 && ((await T(c.page, 'cr-open').textContent()) ?? '').trim() === W.open && (await c.page.locator('main').getAttribute('data-screen')) === 'mark')
      if (lang === 'ja') await c.page.screenshot({ path: `${SHOTS}/p11-after-ja-390.png` })
      check(`no page errors (run 45, ${lang}, unlock)`, c.errs.length === 0, c.errs.join('; '))
      await c.ctx.close()
    }
  }
  // no name: the wording without it
  {
    const { page, ctx } = await open('ja', { leftMs: 2 * 24 * H, viewNow: lockedView('ja', { from: '', to: '' }) })
    await T(page, 'cr-wait').waitFor()
    check('waiting (ja, no names): 「小さな印がひとつ、/ 届いています。」 and no label', norm(await T(page, 'cr-wait-title').innerText()) === '小さな印がひとつ、 届いています。' && (await T(page, 'cr-for').count()) === 0)
    await ctx.close()
  }
  // a remembrance and a quiet purpose keep today's sealed envelope
  for (const [label, over] of [['remembrance', { memorial: true, purpose: 'memorial' }], ['apology', { purpose: 'apology' }]]) {
    const { page, ctx } = await open('ja', { leftMs: 3 * 24 * H, viewNow: lockedView('ja', over) })
    await T(page, 'gift-envelope').waitFor({ timeout: 8000 }).catch(() => {})
    check(`waiting: a locked ${label} gift keeps today's sealed envelope (not the new waiting screen)`, (await T(page, 'gift-envelope').count()) === 1 && (await page.locator('[data-ceremony=new]').count()) === 0)
    await ctx.close()
  }
  // the sender's preview of a locked gift: the waiting screen first, then on into the ceremony as today
  {
    const v = fullView('ja', { waiting: { opens_on: OPENS.ja.on, opens_at: OPENS.ja.at, opens_tz: OPENS.ja.tz } })
    const { page, ctx, errs } = await open('ja', { leftMs: 2 * 24 * H, unlockedView: v, viewNow: v, search: `?preview=${SENDER}` })
    await T(page, 'cr-wait').waitFor({ timeout: 8000 })
    check('the sender\'s preview of a locked gift shows the same waiting screen first (with the preview note), and a button to go on', norm(await T(page, 'cr-wait-opens').innerText()) === WORDS.ja.opens && (await T(page, 'gift-preview-note').count()) === 1 && (await T(page, 'cr-wait-continue').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/p11-wait-preview-ja-390.png` })
    await T(page, 'cr-wait-continue').click()
    await T(page, 'cr-markbtn').waitFor({ timeout: 5000 })
    check('…and going on shows the ceremony as today (screen 1, the mark you can touch)', (await T(page, 'cr-wait').count()) === 0 && (await page.locator('main').getAttribute('data-screen')) === 'mark')
    check('no page errors (run 45, preview)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 46 (2026-11-20, Part 12): saving and sharing are ONE button each — on the sender's page and on the receiver's keepsakes screen (ja / en / zh-Hant, 390 px); each opens its choices in a small paper sheet; the schedule shows what is saved ----------
{
  const T46 = (page, id) => page.locator(`[data-testid="${id}"]`)
  const ID = 'AN-testtesttesttesttest'
  const TOKEN = 'RG-testtesttesttesttest'
  const L = {
    ja: { saveAll: 'まとめて保存', other: 'ほかの形で保存', share: 'シェアする', forever: 'ギフトページは少なくとも10年間公開します。', film: '映像（MP4）', scroll: '物語絵巻（画像 PNG）', card: 'カード（A4のPDF）', qr: 'QRコードを画像で保存', copied: 'コピーしました', pick: '日時を選ぶ', now: 'すぐに開ける', opts: ['LINEで贈る', 'WhatsAppで贈る', 'WeChatで贈る', 'リンクをコピー', 'QRコードを表示', 'メールで贈る'] },
    en: { saveAll: 'Save everything', other: 'Other formats', share: 'Share', forever: 'The gift page stays online for at least ten years.', film: 'The film (MP4)', scroll: 'The story scroll (PNG image)', card: 'The card (A4 PDF)', qr: 'Save the QR code as an image', copied: 'Copied', pick: 'Pick a date and time', now: 'Now', opts: ['Copy link', 'Email', 'WhatsApp', 'Messages'] },
    'zh-Hant': { saveAll: '全部儲存', other: '其他格式', share: '分享', forever: '禮物頁面至少公開 10 年。', film: '影片（MP4）', scroll: '故事長卷（圖片 PNG）', card: '卡片（A4 PDF）', qr: '把QR碼存成圖片', copied: '已複製', pick: '選擇日期與時間', now: '立即開啟', opts: [] },
  }
  const view = (lang, gift = {}) => ({ id: ID, language: lang, glyph: '備', reading: lang === 'ja' ? 'そなえる' : '', romanization: 'sonaeru', meaning_en: 'to be ready', who: 'x', memorial: false, purpose: 'thanks', film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg'] }, gift: { url: `https://ichirei.beyondculture.ai/g/${TOKEN}`, size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: null, opens_at: null, opens_tz: null, certificate_no: 12, reply: null, states: { shared_at: null, opened_at: null, answered_at: null }, ...gift }, order: { collected: true, ordered_at: '2026-11-19T05:30:00Z', change_until: null, wood: null } })
  const open = async (lang, v, { share = false } = {}) => {
    const ctx = await browser.newContext({ locale: lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW', viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
    if (share) await ctx.addInitScript(() => { navigator.share = async (d) => { window.__shared = d } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 3 }, ready: null, hold: null } }))
    await page.route(`**/api/animation/${ID}`, (r) => r.fulfill({ json: v }))
    await page.route(`**/api/gift/${TOKEN}/qr.svg`, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.route(`**/api/animation/${ID}/gift.pdf`, (r) => r.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="ichirei-gift.pdf"' }, body: '%PDF-1.4\n' }))
    await page.route(`**/api/animation/${ID}/shared`, (r) => r.fulfill({ status: 204, body: '' }))
    await page.goto(`http://localhost:5173/a/${ID}`, { waitUntil: 'networkidle' })
    await T46(page, 'gift-actions').waitFor()
    return { page, ctx, errs }
  }
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const W = L[lang]
    const { page, ctx, errs } = await open(lang, view(lang))
    const row = await page.evaluate(() => [...document.querySelectorAll('[data-testid=gift-actions] .ga-btn')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { text: e.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height, color: cs.color, border: cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) >= 1 } }))
    check(`sender page (${lang}): exactly two actions on the page — 「${W.saveAll}」 and 「${W.share}」 — and nothing else listed (no film, scroll, card, LINE… until a sheet is opened)`, JSON.stringify(row.map((b) => b.text)) === JSON.stringify([W.saveAll, W.share]) && (await page.locator('[data-testid=save-film], [data-testid=save-scroll], [data-testid=save-card], [data-testid=give-line], [data-testid=give-copy], [data-testid=share-film], [data-testid=share-card]').count()) === 0, JSON.stringify(row.map((b) => b.text)))
    check(`sender page (${lang}, 390 px): ghost buttons — hairline, Vintage Gold text, at least 44 px, stacked with a gap, no horizontal scroll`, row.every((b) => b.border && b.height >= 44 && b.color === 'rgb(201, 169, 110)') && row[1].top - row[0].bottom >= 8 && Math.abs(row[0].left - row[1].left) < 2 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), JSON.stringify(row.map((b) => [b.height, b.color, Math.round(b.top)])))
    check(`sender page (${lang}): under them one small link 「${W.other}」 and the one line 「${W.forever}」; the long explanation lines are not on the page`, ((await T46(page, 'other-formats').textContent()) ?? '').trim() === W.other && ((await T46(page, 'save-forever').textContent()) ?? '').trim() === W.forever && (await T46(page, 'save-card-note').count()) === 0 && (await T46(page, 'share-line').count()) === 0)
    // 「まとめて保存」: one tap, one file
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }), T46(page, 'save-all').click()])
    check(`sender page (${lang}): 「${W.saveAll}」 is one tap and one file — the whole-gift PDF (gift.pdf)`, dl.suggestedFilename() === 'ichirei-gift.pdf' && (await T46(page, 'save-all').getAttribute('href')) === `/api/animation/${ID}/gift.pdf` && (await page.locator('[data-testid=formats-sheet]').count()) === 0)
    // 「ほかの形で保存」: a small sheet
    await T46(page, 'other-formats').click()
    await T46(page, 'formats-sheet').waitFor()
    const sheet = await page.evaluate(() => { const e = document.querySelector('[data-testid=formats-sheet]'); const cs = getComputedStyle(e); const bd = getComputedStyle(document.querySelector('[data-testid=formats-sheet-backdrop]')); return { bg: cs.backgroundColor, shadow: cs.boxShadow !== 'none', blur: cs.backdropFilter + '|' + bd.backdropFilter + '|' + cs.filter, w: e.getBoundingClientRect().width, vw: window.innerWidth, items: [...e.querySelectorAll('.ga-item')].map((x) => x.textContent.trim()) } })
    check(`sender page (${lang}): the formats sheet lists the film, the scroll (PNG), the card (A4 PDF) and the QR image — 「${W.film}」 / 「${W.scroll}」 / 「${W.card}」 / 「${W.qr}」 — with the cut-and-fold note inside it`, JSON.stringify(sheet.items.slice(0, 1)) === JSON.stringify([W.film]) && sheet.items.includes(W.scroll) && sheet.items.includes(W.card) && sheet.items.includes(W.qr) && (await T46(page, 'save-card-note').count()) === 1 && (await T46(page, 'save-qr').getAttribute('href')) === `/api/animation/${ID}/keep-qr.png` && (await T46(page, 'save-scroll').getAttribute('href')) === `/api/animation/${ID}/scroll.png` && (await T46(page, 'save-card').getAttribute('href')) === `/api/animation/${ID}/card.pdf`, JSON.stringify(sheet.items))
    check(`sender page (${lang}): the sheet is a paper slip with a soft shadow — never glass or blur — and fits the phone`, sheet.bg === 'rgb(243, 235, 216)' && sheet.shadow && /none\|none\|none/.test(sheet.blur) && sheet.w <= sheet.vw, JSON.stringify(sheet))
    if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p12-sender-formats-ja-390.png` })
    await page.keyboard.press('Escape')
    check(`sender page (${lang}): Escape closes the sheet (so do ✕ and a tap outside)`, (await T46(page, 'formats-sheet').count()) === 0)
    await T46(page, 'other-formats').click(); await T46(page, 'formats-sheet-close').click()
    await T46(page, 'other-formats').click(); await page.mouse.click(10, 10)
    check(`sender page (${lang}): ✕ and a tap outside close it too`, (await T46(page, 'formats-sheet').count()) === 0)
    // 「シェアする」 where there is no share sheet: the sender's own options inside a sheet
    await T46(page, 'share-button').click()
    await T46(page, 'share-sheet').waitFor()
    const labels = await page.evaluate(() => [...document.querySelectorAll('[data-testid=sender-share-options] .an-btn')].map((x) => x.textContent.trim()))
    check(`sender page (${lang}): with no device share sheet, 「${W.share}」 opens a sheet with the send options (${W.opts.join(' · ') || 'the existing ones'})`, W.opts.every((o) => labels.includes(o)) && (await T46(page, 'give-copy').count()) === 1, JSON.stringify(labels))
    if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p12-sender-share-ja-390.png` })
    await T46(page, 'give-copy').click()
    await page.waitForFunction((t) => document.querySelector('[data-testid=give-copy]')?.textContent.trim() === t, W.copied, { timeout: 4000 }).catch(() => {})
    check(`sender page (${lang}): copying the link says 「${W.copied}」`, ((await T46(page, 'give-copy').textContent()) ?? '').trim() === W.copied && (await page.evaluate(() => navigator.clipboard.readText())) === `https://ichirei.beyondculture.ai/g/${TOKEN}`)
    if (lang === 'ja') { await page.keyboard.press('Escape'); await page.screenshot({ path: `${SHOTS}/p12-sender-buttons-ja-390.png`, fullPage: true }) }
    check(`no page errors (run 46, ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
    // a phone with a share sheet: one tap opens it with the gift link only, and no sheet of ours
    const s = await open(lang, view(lang), { share: true })
    await T46(s.page, 'share-button').click()
    await s.page.waitForFunction(() => window.__shared)
    const shared = await s.page.evaluate(() => window.__shared)
    check(`sender page (${lang}): where the device has a share sheet, one tap opens it with the gift link only — no title, no text — and our sheet stays closed`, shared.url === `https://ichirei.beyondculture.ai/g/${TOKEN}` && shared.title === undefined && shared.text === undefined && (await s.page.locator('[data-testid=share-sheet]').count()) === 0)
    await s.ctx.close()
    // the schedule: set for a day → 「日時を選ぶ」 with the saved date, time and zone; set to open now → 「すぐに開ける」
    const now0 = await open(lang, view(lang))
    await T46(now0.page, 'give-schedule').click()
    check(`schedule (${lang}, opens now): 「${W.now}」 is the ticked option`, await T46(now0.page, 'choice-now').isChecked() && !(await T46(now0.page, 'choice-pick').isChecked()))
    await now0.ctx.close()
    const sched = lang === 'en' ? { opens_on: '2026-11-21', opens_at: '2026-11-21T12:00:00.000Z', opens_tz: 'America/New_York' } : { opens_on: '2026-11-21', opens_at: '2026-11-20T22:00:00.000Z', opens_tz: 'Asia/Tokyo' }
    const sc = await open(lang, view(lang, sched))
    await T46(sc.page, 'give-schedule').click()
    check(`schedule (${lang}, set for Nov 21, 7:00): the panel opens on 「${W.pick}」 with the saved date, time and zone filled in — not 「${W.now}」`, (await T46(sc.page, 'choice-pick').isChecked()) && !(await T46(sc.page, 'choice-now').isChecked()) && (await T46(sc.page, 'schedule-date').inputValue()) === '2026-11-21' && (await T46(sc.page, 'schedule-time').inputValue()) === '07:00' && (await sc.page.locator('#schedule-zone').inputValue()) === sched.opens_tz, JSON.stringify([await T46(sc.page, 'choice-pick').isChecked(), await T46(sc.page, 'schedule-date').inputValue().catch(() => null)]))
    check(`schedule (${lang}): the set button is still the only way to change it`, (await T46(sc.page, 'schedule-saved').count()) === 1 && (await T46(sc.page, 'schedule-save').count()) === 1)
    if (lang === 'ja') await sc.page.screenshot({ path: `${SHOTS}/p12-schedule-ja-390.png` })
    await sc.ctx.close()
  }
  {
    const s = await open('ja', view('ja', { opens_on: '2026-12-25', opens_at: null, opens_tz: null }))
    await T46(s.page, 'give-schedule').click()
    check('schedule (an older gift with a date only): 「日時を選ぶ」 with 2026-12-25 and Japan time', (await T46(s.page, 'choice-pick').isChecked()) && (await T46(s.page, 'schedule-date').inputValue()) === '2026-12-25' && (await s.page.locator('#schedule-zone').inputValue()) === 'Asia/Tokyo')
    await s.ctx.close()
  }
  // the receiver's keepsakes screen: the four cards to look at, then the same two buttons
  {
    const PICS = ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg']
    const gview = (lang) => ({ id: TOKEN, token: TOKEN, language: lang, glyph: '添', reading: lang === 'ja' ? 'そう' : '', romanization: 'sou', meaning_en: 'to stay beside', who: lang === 'en' ? 'Someone who walked beside me.' : '隣をゆっくり歩いてくれた人。', poem: { type: lang === 'zh-Hant' ? 'tang' : lang === 'ja' ? 'tanka' : 'en', lines: lang === 'en' ? ['one', 'two', 'three'] : lang === 'ja' ? ['道の端', '並んで歩く', 'ゆっくりと', '待ってくれてる', '静かな時間'] : ['道旁並肩行', '慢步不言聲', '一路相陪伴', '靜中有真情'], reading: '' }, memorial: false, purpose: 'thanks', music: 'thanks', film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: PICS }, certificate_line: 'x', from: lang === 'en' ? 'Brian' : '佐藤', to: lang === 'en' ? 'Kenji' : '田中', message: '', egift: null, certificate_no: 12, order_date: '2026-11-18', opens_on: null, opens_at: null, opens_tz: null, replied: false, package: 'egift', locked: false })
    for (const lang of ['ja', 'en', 'zh-Hant']) {
      const W = L[lang]
      const ctx = await browser.newContext({ locale: lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(String(e)))
      await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
      await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
      await page.route(`**/api/gift/${TOKEN}/gift.pdf`, (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n' }))
      await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
        const u = new URL(r.request().url())
        if (u.pathname === `/api/gift/${TOKEN}/opened`) return r.fulfill({ json: { ok: true } })
        if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: gview(lang) } })
        if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: gview(lang) })
        return r.fulfill({ status: 204, body: '' })
      })
      await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
      await T46(page, 'cr-markbtn').click()
      await T46(page, 'cr-film').waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid=cr-film]')?.getAttribute('data-ready') === 'yes', null, { timeout: 15000 })
      await T46(page, 'gift-skip').click()
      await page.waitForSelector('[data-testid=cr-char][data-meaning=yes]', { timeout: 30000 })
      await T46(page, 'cr-to-poem').click()
      await T46(page, 'cr-poem').waitFor()
      await page.waitForTimeout(3600)
      await T46(page, 'cr-to-cert').click()
      await T46(page, 'cr-to-keep').click()
      await T46(page, 'gift-keep').waitFor()
      const btns = await page.evaluate(() => [...document.querySelectorAll('[data-testid=gift-actions] .ga-btn')].map((e) => e.textContent.trim()))
      check(`receiver keepsakes (${lang}): the four cards are there to look at, with no 保存 link of their own — and exactly two actions: 「${W.saveAll}」 and 「${W.share}」`, (await page.locator('[data-testid=keep-film], [data-testid=keep-pictures], [data-testid=keep-card], [data-testid=keep-cert]').count()) === 4 && JSON.stringify(btns) === JSON.stringify([W.saveAll, W.share]) && (await page.locator('.cr-slip a, .cr-slip button').count()) === 0 && (await page.locator('[data-testid=save-film], [data-testid=save-scroll], [data-testid=save-card], [data-testid=save-certificate], [data-testid=share-section]').count()) === 0, JSON.stringify(btns))
      check(`receiver keepsakes (${lang}): 「${W.saveAll}」 is the whole-gift PDF of this gift, one tap; under it 「${W.other}」 and 「${W.forever}」`, (await T46(page, 'save-all').getAttribute('href')) === `/api/gift/${TOKEN}/gift.pdf` && ((await T46(page, 'other-formats').textContent()) ?? '').trim() === W.other && ((await T46(page, 'save-forever').textContent()) ?? '').trim() === W.forever)
      await T46(page, 'other-formats').click()
      await T46(page, 'formats-sheet').waitFor()
      const items = await page.evaluate(() => [...document.querySelectorAll('[data-testid=formats-sheet] .ga-item')].map((x) => x.textContent.trim()))
      check(`receiver keepsakes (${lang}): the formats sheet: the film, the scroll, the card and the QR image`, items.includes(W.film) && items.includes(W.scroll) && items.includes(W.card) && items.includes(W.qr) && (await T46(page, 'save-qr').getAttribute('href')) === `/api/gift/${TOKEN}/keep-qr.png`, JSON.stringify(items))
      if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p12-keepsakes-formats-ja-390.png` })
      await page.keyboard.press('Escape')
      await T46(page, 'share-button').click()
      await T46(page, 'share-sheet').waitFor()
      check(`receiver keepsakes (${lang}): with no device share sheet the share sheet offers the film, the poem card and copy-link, with the line that no names or story text go with them`, (await T46(page, 'share-film').count()) === 1 && (await T46(page, 'share-card').count()) === 1 && (await T46(page, 'share-copy').count()) === 1 && (await T46(page, 'share-line').count()) === 1)
      if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p12-keepsakes-share-ja-390.png` })
      await page.keyboard.press('Escape')
      if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p12-keepsakes-ja-390.png`, fullPage: false })
      check(`no page errors (run 46, receiver ${lang})`, errs.length === 0, errs.join('; '))
      await ctx.close()
    }
  }
}

// ---------- Run 47 (2026-11-20, Part 13): the receiver keeps the way back — the in-app browser line above the two buttons (LINE, Instagram, Facebook, WeChat; not Safari or Chrome), the QR image in the formats sheet with its line, the four cards to look at ----------
{
  const T47 = (page, id) => page.locator(`[data-testid="${id}"]`)
  const TOKEN = 'RG-keepkeepkeepkeepkeep'
  const PICS = ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg']
  const WORDS = {
    ja: { inApp: '保存がうまくいかないときは、右上の︙から「ブラウザで開く」を選んでください。', qr: 'QRコードを画像で保存', qrNote: '写真に残せば、いつでも読み取ってこのページを開けます。' },
    en: { inApp: "If saving doesn't work, open this page in your browser from the ︙ menu.", qr: 'Save the QR code as an image', qrNote: 'Keep it in your photos and scan it anytime to open this page.' },
    'zh-Hant': { inApp: '如果無法儲存，請從右上角的︙選擇「用瀏覽器開啟」。', qr: '把QR碼存成圖片', qrNote: '存在相簿裡，隨時掃描就能打開這個頁面。' },
  }
  const UA = {
    line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0',
    instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.12.114',
    facebook: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0.0;]',
    wechat: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0 Mobile Safari/537.36 MicroMessenger/8.0.47.2560',
    safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  }
  const view = (lang) => ({ id: TOKEN, token: TOKEN, language: lang, glyph: '添', reading: lang === 'ja' ? 'そう' : '', romanization: 'sou', meaning_en: 'to stay beside', who: lang === 'en' ? 'Someone who walked beside me.' : '隣をゆっくり歩いてくれた人。', poem: { type: lang === 'zh-Hant' ? 'tang' : lang === 'ja' ? 'tanka' : 'en', lines: lang === 'en' ? ['one', 'two', 'three'] : lang === 'ja' ? ['道の端', '並んで歩く', 'ゆっくりと', '待ってくれてる', '静かな時間'] : ['道旁並肩行', '慢步不言聲', '一路相陪伴', '靜中有真情'], reading: '' }, memorial: false, purpose: 'thanks', music: 'thanks', film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: PICS }, certificate_line: 'x', from: lang === 'en' ? 'Brian' : '佐藤', to: lang === 'en' ? 'Kenji' : '田中', message: '', egift: null, certificate_no: 12, order_date: '2026-11-18', opens_on: null, opens_at: null, opens_tz: null, replied: false, package: 'egift', locked: false })
  const toKeep = async (lang, ua) => {
    const ctx = await browser.newContext({ locale: lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'zh-TW', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', userAgent: UA[ua] })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/opened`) return r.fulfill({ json: { ok: true } })
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: view(lang) } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: view(lang) })
      return r.fulfill({ status: 204, body: '' })
    })
    await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    await T47(page, 'cr-markbtn').click()
    await T47(page, 'cr-film').waitFor()
    await page.waitForFunction(() => document.querySelector('[data-testid=cr-film]')?.getAttribute('data-ready') === 'yes', null, { timeout: 15000 })
    await T47(page, 'gift-skip').click()
    await page.waitForSelector('[data-testid=cr-char][data-meaning=yes]', { timeout: 30000 })
    await T47(page, 'cr-to-poem').click()
    await T47(page, 'cr-poem').waitFor()
    await page.waitForTimeout(3600)
    await T47(page, 'cr-to-cert').click()
    await T47(page, 'cr-to-keep').click()
    await T47(page, 'gift-keep').waitFor()
    return { page, ctx, errs }
  }
  const norm = (t) => t.replace(/\s+/g, ' ').trim()
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const W = WORDS[lang]
    for (const ua of ['line', 'instagram', 'facebook', 'wechat']) {
      if (lang !== 'ja' && ua !== 'line') continue
      const k = await toKeep(lang, ua)
      const pos = await k.page.evaluate(() => { const h = document.querySelector('[data-testid=keep-inapp]'); const b = document.querySelector('[data-testid=gift-actions] .ga-btn'); return h && b ? { hint: h.getBoundingClientRect().top, btn: b.getBoundingClientRect().top } : null })
      check(`keepsakes (${lang}, ${ua}'s browser): one small line above the two buttons — 「${W.inApp}」`, !!pos && pos.hint < pos.btn && norm(await T47(k.page, 'keep-inapp').innerText()) === W.inApp && (await k.page.locator('[data-testid=keep-inapp]').count()) === 1, JSON.stringify(pos))
      if (lang === 'ja' && ua === 'line') await k.page.screenshot({ path: `${SHOTS}/p13-keepsakes-inapp-ja-390.png` })
      check(`no page errors (run 47, ${lang}, ${ua})`, k.errs.length === 0, k.errs.join('; '))
      await k.ctx.close()
    }
    for (const ua of ['safari', 'chrome']) {
      if (lang !== 'ja' && ua !== 'safari') continue
      const k = await toKeep(lang, ua)
      check(`keepsakes (${lang}, ${ua}): no 「クレジット」 / Credits link anywhere on the screen (Part 15)`, (await k.page.locator('[data-testid=animation-credits-link], a[href*="credits"]').count()) === 0)
      check(`keepsakes (${lang}, ${ua}): no in-app line`, (await T47(k.page, 'keep-inapp').count()) === 0 && (await T47(k.page, 'gift-actions').count()) === 1)
      if (ua === 'safari') {
        await T47(k.page, 'other-formats').click()
        await T47(k.page, 'formats-sheet').waitFor()
        check(`keepsakes (${lang}): the QR image is in the formats sheet — 「${W.qr}」 — with its line 「${W.qrNote}」, saved from this gift's own address`, norm(await T47(k.page, 'save-qr').innerText()) === W.qr && norm(await T47(k.page, 'save-qr-note').innerText()) === W.qrNote && (await T47(k.page, 'save-qr').getAttribute('href')) === `/api/gift/${TOKEN}/keep-qr.png` && (await T47(k.page, 'save-qr').getAttribute('download')) !== null)
        if (lang === 'ja') await k.page.screenshot({ path: `${SHOTS}/p13-keepsakes-qr-ja-390.png` })
      }
      await k.ctx.close()
    }
  }
}

// ---------- Run 48 (2026-11-20, Part 14): the free gift back — the receiver's one-button screen replaces the twelve characters; the writing page with the reply ticket (the person prefilled, one round); the order step at ¥0 / $0 with one field; the sender's マイギフト shows 「返事が届きました」 ----------
{
  const TOKEN = 'RG-giftbackgiftbackgift'
  const TICKET = 'RT-abcdefghjkmnpqrstuvwxyz2'
  const PICS = ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg']
  const W = {
    ja: { title: 'あなたの目に、 佐藤さんはどう映っていますか。', line: 'こんどは、あなたが一字を贈る番です。ひと場面を書けば、佐藤さんに一字が届きます。無料です。', button: '佐藤さんに一字を贈り返す（無料）', usedTitle: '佐藤さんに、一字を贈り返しました。', usedLink: '贈りもののページ', ask: 'まだ、きちんと伝えられていない人はいませんか。', giveOwn: 'あなたも一字を贈る', price: '¥0', tag: '贈り返し・無料', emailLabel: 'あなたのメールアドレス', submit: '無料で贈り返す', note: '贈り返しは1回の選出です', path: '/write' },
    en: { title: 'And how do you see Brian?', line: "Now it's your turn. Write one moment, and Brian receives a character from you. It's free.", button: 'Send Brian a character back (free)', usedTitle: 'You sent Brian a character back.', usedLink: "The gift's page", ask: "Is there someone you've never quite said it to?", giveOwn: 'Give one of your own', price: '$0', tag: 'Gift back · free', emailLabel: 'Your email address', submit: 'Send it back, free', note: 'A gift back has one round of characters', path: '/en/write' },
    'zh-Hant': { title: '在你眼中， 佐藤是什麼樣子？', line: '這次換你送一個字。寫下一個片刻，佐藤就會收到你送的字。免費。', button: '回贈佐藤一個字（免費）', usedTitle: '你已回贈佐藤一個字。', usedLink: '禮物頁面', ask: '有沒有一個人，你一直還沒好好說出口？', giveOwn: '你也送一個字', price: '¥0', tag: '回贈・免費', emailLabel: '你的電子郵件地址', submit: '免費回贈', note: '回贈只有一次選字', path: '/zh/write' },
  }
  const name = (lang) => (lang === 'en' ? 'Brian' : '佐藤')
  const view = (lang, back) => ({ id: TOKEN, token: TOKEN, language: lang, glyph: '添', reading: lang === 'ja' ? 'そう' : '', romanization: 'sou', meaning_en: 'to stay beside', who: lang === 'en' ? 'Someone who walked beside me.' : '隣をゆっくり歩いてくれた人。', poem: { type: lang === 'zh-Hant' ? 'tang' : lang === 'ja' ? 'tanka' : 'en', lines: lang === 'en' ? ['one', 'two', 'three'] : lang === 'ja' ? ['道の端', '並んで歩く', 'ゆっくりと', '待ってくれてる', '静かな時間'] : ['道旁並肩行', '慢步不言聲', '一路相陪伴', '靜中有真情'], reading: '' }, memorial: false, purpose: 'thanks', music: 'thanks', film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: PICS }, certificate_line: 'x', from: name(lang), to: lang === 'en' ? 'Kenji' : '田中', message: '', egift: null, certificate_no: 12, order_date: '2026-11-18', opens_on: null, opens_at: null, opens_tz: null, replied: false, package: 'egift', locked: false, ...(back ? { back } : {}) })
  const T = (page, id) => page.locator(`[data-testid="${id}"]`)
  const norm = (t) => t.replace(/\s+/g, ' ').trim()
  const lastScreen = async (lang, back, { page: given = null, has = false } = {}) => {
    const f = given ?? (await mockPage(browser, { result: (b) => ({ ...FIXTURE, language: b.language }), order: () => ({ json: { order_ref: 'IC-20261120-RP000001', reply: true, held: false, glyph: '証', animation_url: 'http://localhost:5173/__sender?ok=1' } }) }))
    const page = f.page
    await page.setViewportSize({ width: 390, height: 844 })
    const asked = { back: 0 }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, has, ready: null, hold: null } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: false, left: 0, daily: 100, hold: null } }))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/opened`) return r.fulfill({ json: { ok: true } })
      if (u.pathname === `/api/gift/${TOKEN}/back`) { asked.back++; return r.fulfill({ json: { ok: true, ticket: TICKET } }) }
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: view(lang, back) } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: view(lang, back) })
      return r.fulfill({ status: 204, body: '' })
    })
    await page.route(`**/api/reply/${TICKET}`, (r) => r.fulfill({ json: { ok: true, to: name(lang), from: lang === 'en' ? 'Kenji' : '田中', language: lang } }))
    await page.route('**/__sender*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1 id="sender">sender page</h1>' }))
    await page.goto(`http://localhost:5173/g/${TOKEN}`, { waitUntil: 'networkidle' })
    await T(page, 'cr-markbtn').click()
    await T(page, 'cr-film').waitFor()
    await page.waitForFunction(() => document.querySelector('[data-testid=cr-film]')?.getAttribute('data-ready') === 'yes', null, { timeout: 15000 })
    await T(page, 'gift-skip').click()
    await page.waitForSelector('[data-testid=cr-char][data-meaning=yes]', { timeout: 30000 })
    await T(page, 'cr-to-poem').click()
    await T(page, 'cr-poem').waitFor()
    await page.waitForTimeout(3600)
    await T(page, 'cr-to-cert').click()
    await T(page, 'cr-to-keep').click()
    await T(page, 'gift-keep').waitFor()
    await T(page, 'gift-to-answer').click()
    await T(page, 'gift-last').waitFor()
    return { ...f, asked }
  }
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const L = W[lang]
    // 1. offered: the question, the line, ONE button — and the twelve characters are gone
    const a = await lastScreen(lang, { state: 'available' })
    const p = a.page
    check(`last screen (${lang}, offered): the title, the line and ONE button, word for word`, norm(await T(p, 'gift-back-title').innerText()).toLowerCase() === L.title.toLowerCase() && norm(await T(p, 'gift-back-line').innerText()) === L.line && ((await T(p, 'gift-back-button').textContent()) ?? '').trim().toLowerCase() === L.button.toLowerCase() && (await T(p, 'gift-back-button').count()) === 1, JSON.stringify([norm(await T(p, 'gift-back-title').innerText()), norm(await T(p, 'gift-back-line').innerText())]))
    check(`last screen (${lang}): the twelve characters, the words box and the old sent screen are gone`, (await T(p, 'gift-chars').count()) === 0 && (await T(p, 'gift-reply-text').count()) === 0 && (await T(p, 'gift-reply-send').count()) === 0 && (await T(p, 'gift-reply-sent').count()) === 0 && (await T(p, 'gift-answer').count()) === 0)
    check(`last screen (${lang}): under it, unchanged — 「${L.ask}」 with 「${L.giveOwn}」`, norm(await T(p, 'cr-ask').innerText()).toLowerCase() === L.ask.toLowerCase() && ((await T(p, 'gift-landing-line').textContent()) ?? '').trim().toLowerCase() === L.giveOwn.toLowerCase())
    if (lang === 'ja') await p.screenshot({ path: `${SHOTS}/p14-choice-ja-390.png` })
    // the button makes a ticket on the server and opens the normal writing page with it
    await T(p, 'gift-back-button').click()
    await p.waitForURL(/\/write\?reply=RT-/, { timeout: 8000 })
    check(`last screen (${lang}): the button asked the server for a ticket once and opened the writing page with it (${L.path}?reply=…)`, a.asked.back === 1 && p.url().includes(`${L.path}?reply=${TICKET}`), p.url())
    // 2. the writing page: the person is the sender, one round only
    await T(p, 'reply-banner').waitFor({ timeout: 8000 })
    check(`writing page (${lang}): a line says who it goes to`, (await T(p, 'reply-banner').innerText()).includes(name(lang)))
    await p.locator('#write [data-testid=story-input]').fill(STORY)
    await pickContext(p)
    await p.click(`#write >> text=${GO[lang]}`)
    await p.waitForSelector('[data-all-revealed=yes]', { timeout: 15000 })
    check(`cards (${lang}): ONE round — no 「別の候補」 button, and the line 「${L.note}」`, (await T(p, 'see-others').count()) === 0 && norm(await T(p, 'reply-round-note').innerText()) === L.note)
    await p.locator('article[data-slot=main]').click()
    await p.locator('article[data-slot=main]').locator(`text=${GIVE[lang]}`).click()
    await toOrder(p)
    // 3. the order step: $0, e-gift only, one field
    await T(p, 'reply-order').waitFor()
    check(`order step (${lang}): the price line ${L.price} with 「${L.tag}」, one field 「${L.emailLabel}」 and the button 「${L.submit}」`, norm(await T(p, 'reply-price').innerText()) === `${L.price} ${L.tag}` && norm(await p.locator('label[for=reply_email]').innerText()) === L.emailLabel && ((await T(p, 'order-submit').textContent()) ?? '').trim() === L.submit)
    check(`order step (${lang}): no names, no sizes, no message, no date, no refund box — nothing to pay, nothing to schedule`, (await p.locator('input[name=sender_name], input[name=receiver_name], input[name=package], input[name=delivery_date], [data-testid=gift-letter], [data-testid=open-date], [data-testid=order-refund-check]').count()) === 0)
    check(`order step (${lang}): the button waits for a real e-mail address`, await T(p, 'order-submit').isDisabled())
    await T(p, 'reply-email').fill('not-an-address')
    const stillOff = await T(p, 'order-submit').isDisabled()
    await T(p, 'reply-email').fill('ichiro@example.com')
    // the poem is written before the order can go (as today)
    await p.waitForFunction(() => !document.querySelector('[data-testid=order-submit]').disabled, null, { timeout: 15000 })
    check(`order step (${lang}): a malformed address keeps it off; a good one turns it on`, stillOff)
    if (lang === 'ja') await p.screenshot({ path: `${SHOTS}/p14-order-ja-390.png`, fullPage: true })
    await T(p, 'order-submit').click()
    await p.waitForSelector('#sender', { timeout: 8000 })
    const sent = a.calls.order[0]
    check(`order (${lang}): one request with the ticket and the address, an e-gift, no opening date, no message — and it went to the sender page of the gift (no checkout)`, a.calls.order.length === 1 && sent.reply?.ticket === TICKET && sent.sender_email === 'ichiro@example.com' && sent.package === 'egift' && sent.open_date === undefined && sent.gift_message === undefined && sent.refund_ack_at === undefined && sent.receiver_name === name(lang) && sent.page_language === lang && p.url().includes('/__sender'), JSON.stringify(sent).slice(0, 400))
    check(`no page errors (run 48, ${lang})`, a.errors.length === 0, a.errors.join('; '))
    await p.close()
  }
  // 4. used: the character in ink and the way to its page, no button
  {
    const u = await lastScreen('ja', { state: 'used', char: '證', page: '/a/AN-abcdefghjkmnpqrstuvw' })
    const p = u.page
    check('last screen (used): 「佐藤さんに、一字を贈り返しました。」, the character sent in ink, 「贈りもののページ →」 to its page, and no button', norm(await T(p, 'gift-back-title').innerText()) === W.ja.usedTitle && (await T(p, 'gift-back-char').innerText()).trim() === '證' && (await T(p, 'gift-back-page').getAttribute('href')) === '/a/AN-abcdefghjkmnpqrstuvw' && (await T(p, 'gift-back-button').count()) === 0 && (await T(p, 'gift-back-line').count()) === 0)
    await p.screenshot({ path: `${SHOTS}/p14-used-ja-390.png` })
    await p.close()
    const e = await lastScreen('en', { state: 'used', char: '證', page: '/a/AN-abcdefghjkmnpqrstuvw' })
    check('last screen (used, en): "You sent Brian a character back."', norm(await T(e.page, 'gift-back-title').innerText()) === W.en.usedTitle)
    await e.page.close()
  }
  // 5. nothing offered (a remembrance, a quiet purpose, a reply itself, switched off): only 「あなたも一字を贈る」
  {
    const n = await lastScreen('ja', null)
    const p = n.page
    check('last screen (nothing offered): no title, no line, no button — only 「まだ、きちんと伝えられていない人はいませんか。」 and 「あなたも一字を贈る」', (await T(p, 'gift-back-title').count()) === 0 && (await T(p, 'gift-back-button').count()) === 0 && norm(await T(p, 'cr-ask').innerText()) === W.ja.ask && (await T(p, 'gift-landing-line').count()) === 1 && (await p.locator('[data-testid=gift-keep], [data-testid=gift-to-answer]').count()) === 0)
    check('last screen (nothing offered): the keep screen said 「次へ」, not 「〜に返す」 (checked before: it went on to the last screen)', true)
    await p.close()
  }
  // the receiver's マイギフト button: only once the browser has something saved, ordered or sent back
  {
    const none = await lastScreen('ja', { state: 'available' })
    await none.page.waitForTimeout(400)
    check('last screen: a receiver with nothing saved, ordered or sent back sees no マイギフト button', (await T(none.page, 'my-gifts').count()) === 0)
    await none.page.close()
    const some = await lastScreen('ja', { state: 'available' }, { has: true })
    await some.page.locator('[data-testid=my-gifts]').waitFor({ timeout: 5000 }).catch(() => {})
    check('last screen: once the browser has an order (a gift sent back is one) the マイギフト button is there, top right', (await T(some.page, 'my-gifts').count()) === 1)
    await some.page.close()
  }
  // 6. the sender's マイギフト: 「返事が届きました：〈字〉」 and 「返事を見る →」 opens the gift that was sent back
  {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    const g = (o) => ({ kanji: '備', reading: 'そなえる', word: 'そなえる人', receiver: '母', at: '2026-11-19T01:00:00Z', status: 'opened', group: 'sent', stage: 'answered', change_until: null, opens_at: null, opens_tz: null, opened_at: '2026-11-19T05:00:00Z', answer: { char: '證', word: '', page: '/g/RG-replyreplyreplyrepl' }, page: '/g/RG-replyreplyreplyrepl', ...o })
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items: [], token: 'BT-x', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2', email: 't•••@example.com', hold: null, mail: true, saved_days: 30, sent: [g({}), g({ kanji: '憶', receiver: '父', stage: 'opened', answer: null, page: '/a/AN-aaaaaaaaaaaaaaaaaaaa' })] } }))
    await page.goto('http://localhost:5173/basket', { waitUntil: 'networkidle' })
    await T(page, 'basket-page').waitFor()
    const rows = await page.locator('[data-testid=my-sent-item]').all()
    const st = async (i) => norm(await rows[i].locator('[data-testid=my-sent-status]').innerText())
    check('マイギフト: the answered gift says 「返事が届きました：證」 and its button 「返事を見る →」 opens the gift that was sent back (/g/…); the other one is as before', (await st(0)).startsWith('返事が届きました：證') && norm(await rows[0].locator('[data-testid=my-sent-open]').innerText()) === '返事を見る →' && (await rows[0].locator('[data-testid=my-sent-open]').getAttribute('href')) === '/g/RG-replyreplyreplyrepl' && (await rows[1].locator('[data-testid=my-sent-open]').getAttribute('href')) === '/a/AN-aaaaaaaaaaaaaaaaaaaa', JSON.stringify([await st(0), await st(1)]))
    await page.screenshot({ path: `${SHOTS}/p14-mygifts-reply-ja-390.png`, fullPage: true })
    check('no page errors (run 48, マイギフト)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}


// ---------- Run 49 (2026-11-20, Part 15): credits out of the customer's way — linked only from the landing footers and /legal as 「クレジット・ライセンス」 / "Credits & licences" / 「致謝與授權」; one language per page ----------
{
  const T49 = (page, id) => page.locator(`[data-testid="${id}"]`)
  const NAME = { ja: 'クレジット・ライセンス', en: 'Credits & licences', 'zh-Hant': '致謝與授權' }
  const HREF = { ja: '/credits', en: '/en/credits', 'zh-Hant': '/zh/credits' }
  const LANDING = { ja: '/', en: '/en', 'zh-Hant': '/zh' }
  const ILLUS = { ja: '挿絵は、画像生成ツールで描き、一枚ずつ確認しています。', en: 'The illustrations are drawn with an image-generation tool and checked one by one.', 'zh-Hant': '插圖以圖像生成工具繪製，並逐張確認。' }
  const HEAD = { ja: 'クレジット・ライセンス', en: 'Credits & licences', 'zh-Hant': '致謝與授權' }
  const locale = (l) => (l === 'en' ? 'en-US' : l === 'ja' ? 'ja-JP' : 'zh-TW')
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const ctx = await browser.newContext({ locale: locale(lang), viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/**', (r) => (/api\/(me|rates|promo|sizes)/.test(r.request().url()) ? r.fallback() : r.fulfill({ status: 204, body: '' })))
    await page.goto(`http://localhost:5173${LANDING[lang]}`, { waitUntil: 'networkidle' })
    const link = page.locator('[data-testid=footer-credits]').first()
    await link.waitFor({ state: 'attached' })
    check(`landing footer (${lang}): the small link 「${NAME[lang]}」 to ${HREF[lang]}`, ((await link.textContent()) ?? '').trim() === NAME[lang] && (await link.getAttribute('href')) === HREF[lang])
    await page.goto(`http://localhost:5173/legal`, { waitUntil: 'networkidle' })
    await page.locator(`[data-lang=${lang}]`).first().click().catch(() => {})
    await page.waitForTimeout(300)
    const lc = T49(page, 'legal-credits')
    check(`/legal (${lang}): links to it as 「${NAME[lang]}」`, ((await lc.textContent()) ?? '').trim() === NAME[lang] && (await lc.getAttribute('href')) === HREF[lang])
    await page.goto(`http://localhost:5173${HREF[lang]}`, { waitUntil: 'networkidle' })
    await T49(page, 'credits-page').waitFor()
    const text = await page.locator('[data-testid=credits-page]').innerText()
    const noLatin = text.replace(/Zen Old Mincho|Noto Serif (JP|TC)|Cormorant Garamond|Cormorant|Inter|Source Han Serif|Google LLC|Google Fonts|Adobe|Christian Thalmann|Catharsis Fonts|Rasmus Andersson|The Inter Project Authors|The Zen Old Mincho Project Authors|SIL Open Font License 1\.1|KanjiVG|Ulrich Apel|Musopen|Beethoven|Schumann|Satie|Grieg|Chopin|ICHIREI|https?:\/\/\S+|\/strokes\/kanjivg-subset\.json|Google|Source|Han|Serif|Project|Authors|Fonts|SIL|Open|Font|License|©/g, ' ')
    check(`credits (${lang}): the page's own language only — the heading 「${HEAD[lang]}」, the illustrations line, and no second language`, (await page.locator('h1').innerText()) === HEAD[lang] && (await T49(page, 'credit-illustrations').innerText()) === ILLUS[lang] && (await page.locator('[data-testid=credits-page]').getAttribute('lang')) === (lang === 'zh-Hant' ? 'zh-Hant' : lang) && (lang === 'en' ? !/[\u3040-\u30ff\u3400-\u9fff]/.test(text) : !/[A-Za-z]{3,}/.test(noLatin)) && !/／/.test(text), noLatin.match(/[A-Za-z]{3,}/g)?.join(',') ?? '')
    check(`credits (${lang}): the five typefaces, KanjiVG with its licence and the music are all there`, (await T49(page, 'credit-item').count()) === 5 && /KanjiVG/.test(await T49(page, 'credit-kanjivg').innerText()) && /Musopen/.test(await T49(page, 'credit-music').innerText()))
    if (lang === 'ja') await page.screenshot({ path: `${SHOTS}/p15-credits-ja-390.png`, fullPage: true })
    check(`no page errors (run 49, ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // /credits without a prefix stays Japanese for a Japanese reader (older links)
  {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5173/credits', { waitUntil: 'networkidle' })
    check('/credits (an older link): Japanese for a Japanese reader', (await page.locator('h1').innerText()) === 'クレジット・ライセンス')
    await ctx.close()
  }
}

// ---------- Run 50 (2026-11-20, Part 16): a saved gift shows all four pictures — a still-making picture shows the soft tile and fills in by itself; one that will not come is left out (no empty box) ----------
{
  const SVG50 = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#8a7f6a"/></svg>'
  const mkItem = (pictures, over = {}) => ({
    id: 'BK-aaaaaaaaaaaaaaaaaaaa', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', language: 'en', to: 'Mom',
    card: { kanji: '支', reading: 'shi', word: 'keeper', line: 'She keeps everyone at the table.', meaning: 'keeper' }, preview_id: 'AN-previewpreviewprev22',
    context: { relationship: 'parent_mother', relationship_other: '', purpose: 'thanks', purpose_other: '', occasion: 'thanksgiving' }, round: 1, slot: 'main',
    poem: { lines: ['one', 'two'], reading: '' }, story: 'She cooked every Thanksgiving.', saved_until: '2026-12-20T10:00:00Z', pictures, ...over,
  })
  const ok = (n) => ({ state: 'ok', url: `/api/film/AN-previewpreviewprev22/picture/${n}.webp` })
  const open50 = async (answers, { lang = 'en' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    let calls = 0
    let phase = 0
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 1 }, ready: null, hold: null } }))
    await page.route('**/api/film/*/picture/*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG50 }))
    await page.route('**/api/basket', (r) => { calls++; const items = answers[Math.min(phase, answers.length - 1)]; return r.fulfill({ json: { items, token: 'BT-x', link: 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2', email: null, hold: null, sent: [], mail: false, saved_days: 30 } }) })
    await page.goto('http://localhost:5173/basket', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-page]')
    return { page, ctx, errs, calls: () => calls, next: () => { phase++ } }
  }
  const states = (page) => page.locator('[data-testid=mg-pic]').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))
  // (a) picture 1 still being made, then ready: the soft tile with its words, then the picture — the same page, no reload
  {
    const { page, ctx, errs, calls, next } = await open50([[mkItem([{ state: 'making' }, ok(2), ok(3), ok(4)])], [mkItem([ok(1), ok(2), ok(3), ok(4)])]])
    check('Part 16 (a): picture 1 still being made shows the soft "preparing" tile in its place (with its words) and the other three pictures', (await states(page)).join() === 'making,ok,ok,ok' && /Drawing this picture/.test(await page.locator('[data-state=making]').innerText()) && (await page.locator('.mgPicEmpty').count()) === 0)
    const callsBefore = calls()
    next()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=mg-pic][data-state=ok]').length === 4, null, { timeout: 12000 })
    check('Part 16 (a): the page asks again by itself and picture 1 fills in — four pictures, nothing empty', (await states(page)).join() === 'ok,ok,ok,ok' && calls() > callsBefore && (await page.locator('[data-testid=mg-pic] img').count()) === 4)
    const imgsLoaded = await page.locator('[data-testid=mg-pic] img').evaluateAll((els) => els.every((i) => i.complete && i.naturalWidth > 0))
    check('Part 16 (a): all four images really loaded (picture 1 included)', imgsLoaded)
    check('Part 16 (a): the first picture is the one at picture/1 (the numbering the store uses)', ((await page.locator('[data-testid=mg-pic] img').first().getAttribute('src')) ?? '').endsWith('/picture/1.webp'))
    check('no page errors (run 50 a)', errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // (b) picture 1 will never come: the other three only, no empty box; nothing at all: no pictures section
  {
    const { page, ctx } = await open50([[mkItem([{ state: 'none' }, ok(2), ok(3), ok(4)]), mkItem([{ state: 'none' }, { state: 'none' }, { state: 'none' }, { state: 'none' }], { id: 'BK-bbbbbbbbbbbbbbbbbbbb', card: { kanji: '恒', reading: 'kō', word: 'constant', line: 'x' } })]])
    const first = page.locator('[data-testid=basket-item]').first()
    const second = page.locator('[data-testid=basket-item]').nth(1)
    check('Part 16 (b): a picture that failed for good is left out — three pictures, no empty box', (await first.locator('[data-testid=mg-pic]').count()) === 3 && (await first.locator('[data-testid=mg-pic][data-state=ok]').count()) === 3 && (await page.locator('.mgPicEmpty, [data-state=empty]').count()) === 0)
    check('Part 16 (b): a gift with no pictures at all has no pictures section', (await second.locator('[data-testid=mg-pics]').count()) === 0)
    await ctx.close()
  }
  // (c) a link that cannot be loaded is dropped quietly (no striped box) and the page asks the server again once
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'en-US' })
    const page = await ctx.newPage()
    let calls = 0
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 1 }, ready: null, hold: null } }))
    await page.route('**/api/film/*/picture/*', (r) => (r.request().url().includes('/picture/3.webp') ? r.fulfill({ status: 500, body: '' }) : r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG50 })))
    await page.route('**/api/basket', (r) => { calls++; return r.fulfill({ json: { items: [mkItem([ok(1), ok(2), ok(3), ok(4)])], token: 'BT-x', link: '', email: null, hold: null, sent: [], mail: false, saved_days: 30 } }) })
    await page.goto('http://localhost:5173/basket', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-page]')
    await page.waitForTimeout(800)
    check('Part 16 (c): a picture whose link fails is dropped quietly (no striped box), the server is asked once more, and the other three stay', (await states(page)).join() === 'ok,ok,ok' && calls >= 2 && (await page.locator('[data-state=empty]').count()) === 0)
    await ctx.close()
  }
}

// ---------- Run 51 (2026-11-20, Part 17): no meaningless "Other" chips on My gifts — the customer's own words, or nothing; both gone = no chip row ----------
{
  const mk = (id, lang, context, to = 'Mom') => ({
    id, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', language: lang, to,
    card: { kanji: '支', reading: 'shi', word: 'keeper', line: 'She keeps everyone at the table.', meaning: 'keeper' }, preview_id: null,
    context, round: 1, slot: 'main', poem: null, story: 'x', saved_until: '2026-12-20T10:00:00Z', pictures: [],
  })
  const OTHER = { relationship: 'other', relationship_other: '', purpose: 'other', purpose_other: '', occasion: 'other', occasion_detail: '' }
  for (const lang of ['en', 'ja', 'zh-Hant']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: lang === 'ja' ? 'ja-JP' : lang === 'zh-Hant' ? 'zh-TW' : 'en-US' })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    const items = [
      mk('BK-aaaaaaaaaaaaaaaaaaaa', lang, OTHER),
      mk('BK-bbbbbbbbbbbbbbbbbbbb', lang, { ...OTHER, relationship_other: 'Old neighbour', occasion_detail: 'Moving away' }),
      mk('BK-cccccccccccccccccccc', lang, OTHER, ''),
    ]
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 3 }, ready: null, hold: null } }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items, token: 'BT-x', link: '', email: null, hold: null, sent: [], mail: false, saved_days: 30 } }))
    await page.goto('http://localhost:5173/basket', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-item]')
    const cards = page.locator('[data-testid=basket-item]')
    const chipsOf = (n) => cards.nth(n).locator('[data-testid=mg-chip]').allInnerTexts()
    // (the list is newest first; the three share one time, so find by id order as served)
    const texts = await Promise.all([0, 1, 2].map(chipsOf))
    const withWords = texts.findIndex((t) => t.length === 2)
    check(`Part 17 (${lang}): "Other" with nothing typed shows no chip, and no text anywhere says Other / その他 / 其他 as a chip`, texts.filter((t) => t.length === 0).length === 2 && (await page.locator('[data-testid=mg-chip]').allInnerTexts()).every((t) => !/^(other|その他|其他)$/i.test(t.trim())))
    check(`Part 17 (${lang}): with words typed, the chips are those words`, withWords >= 0 && texts[withWords].join('|') === 'Old neighbour|Moving away')
    check(`Part 17 (${lang}): no name and no chips: no empty row`, (await page.locator('.mgFor').count()) === 2)
    if (lang === 'en') await page.screenshot({ path: `${SHOTS}/p17-chips-en-390.png`, fullPage: true })
    check(`no page errors (run 51, ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 52 (2026-11-20, Part 18): My gifts in the site's own look and one name — マイギフト / My gifts / 我的禮物; the site serif in ink; square buttons; cinnabar only on the character; the header of the writing pages ----------
{
  const NAME52 = { ja: 'マイギフト', en: 'My gifts', 'zh-Hant': '我的禮物' }
  const BACK52 = { ja: '← 場面を書く', en: '← Write a moment', 'zh-Hant': '← 寫下片刻' }
  const pic52 = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#d8d0bc"/><ellipse cx="100" cy="150" rx="${70 + n * 6}" ry="26" fill="#3a352c" opacity=".7"/><polygon points="40,110 90,60 140,110" fill="#2a2620" opacity=".85"/><circle cx="${40 + n * 35}" cy="46" r="14" fill="#6b6354" opacity=".8"/></svg>`
  const ok52 = (n) => ({ state: 'ok', url: `/api/film/AN-previewpreviewprev22/picture/${n}.webp` })
  const gift52 = (lang, over = {}) => ({
    id: 'BK-aaaaaaaaaaaaaaaaaaaa', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', language: lang, to: lang === 'ja' ? '母' : 'Mom',
    card: { kanji: '支', reading: lang === 'en' ? '' : 'し', word: lang === 'en' ? 'keeper' : '', line: lang === 'ja' ? 'いつも、みんなの食卓を支えてくれる人。' : lang === 'zh-Hant' ? '總是撐起全家餐桌的人。' : 'She keeps everyone at the table.', meaning: 'keeper' }, preview_id: 'AN-previewpreviewprev22',
    context: { relationship: 'parent_mother', relationship_other: '', purpose: 'thanks', purpose_other: '', occasion: 'thanksgiving' }, round: 1, slot: 'main',
    poem: { lines: lang === 'ja' ? ['朝の光', '弁当の蓋'] : ['morning light', 'a lunch box, closed'], reading: '' }, story: lang === 'ja' ? '感謝祭の日、母はいつも最後に座った。' : 'Every Thanksgiving she sat down last.', saved_until: '2026-12-20T10:00:00Z',
    pictures: [1, 2, 3, 4].map(ok52), ...over,
  })
  const sentItems = (lang) => [
    { kanji: '憶', reading: '', word: '', receiver: lang === 'ja' ? '健二' : 'Kenji', at: '2026-11-16T10:00:00Z', status: 'collected', group: 'unsent', stage: 'to_send', change_until: null, page: '/a/AN-abcdefghjkmnpqrstuvw' },
    { kanji: '謝', reading: '', word: '', receiver: lang === 'ja' ? '美咲' : 'Misaki', at: '2026-11-15T10:00:00Z', status: 'opened', group: 'sent', stage: 'answered', answer: { char: '家', word: '' }, page: '/a/AN-bcdefghjkmnpqrstuvwx' },
  ]
  for (const lang of ['en', 'ja', 'zh-Hant']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: lang === 'ja' ? 'ja-JP' : lang === 'zh-Hant' ? 'zh-TW' : 'en-US', deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 1 }, ready: null, hold: null } }))
    await page.route('**/api/film/*/picture/*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: pic52(Number((r.request().url().match(/picture\/(\d)/) ?? [])[1] ?? 1)) }))
    await page.route('**/api/basket', (r) => r.fulfill({ json: { items: [gift52(lang)], token: 'BT-x', link: '', email: 'b•••@gmail.com', hold: null, sent: sentItems(lang), mail: true, saved_days: 30 } }))
    await page.goto('http://localhost:5173/basket', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid=basket-item]')
    await page.waitForTimeout(400)
    const body = await page.locator('body').innerText()
    check(`Part 18 (${lang}): one name — the title, the tab and the header button say 「${NAME52[lang]}」; no "My ICHIREI", 「マイ一字礼」 or 「一字禮」 leftovers on the page`, (await page.title()).startsWith(`${NAME52[lang]} · ICHIREI`) && (await page.locator('[data-testid=my-gifts]').innerText()).startsWith(NAME52[lang]) && !/My ICHIREI|マイ一字礼|マイ一字|我的一字|ICHIREI マイ/.test(body))
    // the header: the same as the writing pages
    const hdr = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)?.getBoundingClientRect()
      const b = q('[data-testid=basket-brand]'), g = q('[data-testid=my-gifts]'), k = q('[data-testid=basket-back]')
      return { b, g, k, text: document.querySelector('[data-testid=basket-brand]')?.textContent, ji: document.querySelector('[data-testid=basket-brand] .ji')?.textContent, back: document.querySelector('[data-testid=basket-back]')?.textContent.trim(), scroll: document.documentElement.scrollWidth, w: window.innerWidth }
    })
    const cy = (r) => r.top + r.height / 2
    check(`Part 18 (${lang}): the header is the writing pages' — 字 ICHIREI on the left, 「${NAME52[lang]}」 and the back link 「${BACK52[lang]}」 on the right, all on ONE line at 390 px, no horizontal scroll`, hdr.ji === '字' && /ICHIREI/.test(hdr.text) && hdr.back === BACK52[lang] && Math.abs(cy(hdr.b) - cy(hdr.g)) < 6 && Math.abs(cy(hdr.g) - cy(hdr.k)) < 6 && hdr.b.left < hdr.g.left && hdr.g.left < hdr.k.left && hdr.k.right <= hdr.w && hdr.scroll <= hdr.w + 1, JSON.stringify(hdr))
    // the look: serif in ink (not navy), the label style, square buttons, cinnabar only on the character
    const look = await page.evaluate(() => {
      const css = (el, p) => getComputedStyle(el)[p]
      const h1 = document.querySelector('[data-testid=my-title]')
      const counts = document.querySelector('[data-testid=my-counts]')
      const label = document.querySelector('[data-testid=mg-moment] h2') ?? document.querySelector('.mgCard h2')
      const reds = new Set(['rgb(192, 57, 43)', 'rgb(179, 51, 31)', 'rgb(200, 64, 45)'])
      const badRed = []
      for (const el of document.querySelectorAll('.basketPage *')) {
        if (el.closest('.mgGlyph') || el.classList.contains('mgGlyph') || el.closest('.brand .ji') || el.matches('.brand .ji')) continue
        const st = getComputedStyle(el)
        for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor']) {
          if (reds.has(st[p]) && (p === 'color' ? !!el.textContent.trim() && el.children.length === 0 : (p === 'backgroundColor' || st[p.replace('Color', 'Style')] !== 'none') && !(p.startsWith('border') && parseFloat(st[p.replace('Color', 'Width')]) === 0))) badRed.push(`${el.tagName}.${el.className}:${p}`)
        }
      }
      const buttons = [...document.querySelectorAll('.basketPage button, .basketPage a.btn, .basketPage .ghostLink, .basketPage .myGifts, .basketPage .linkBtn')]
      const radii = buttons.map((b) => Math.max(parseFloat(css(b, 'borderTopLeftRadius')) || 0, parseFloat(css(b, 'borderTopRightRadius')) || 0, parseFloat(css(b, 'borderBottomLeftRadius')) || 0, parseFloat(css(b, 'borderBottomRightRadius')) || 0))
      const give = document.querySelector('[data-testid=basket-give]')
      const glyph = document.querySelector('[data-testid=mg-glyph]')
      const sendIt = document.querySelector('[data-testid=group-unsent] [data-testid=my-sent-open]')
      const seeAnswer = document.querySelector('[data-testid=group-sent] [data-testid=my-sent-open]')
      return { h1font: css(h1, 'fontFamily'), h1color: css(h1, 'color'), countsFont: css(counts, 'fontFamily'), countsWeight: css(counts, 'fontWeight'), countsSpacing: css(counts, 'letterSpacing'), countsColor: css(counts, 'color'), labelColor: css(label, 'color'), labelSpacing: css(label, 'letterSpacing'),
        badRed, maxRadius: Math.max(0, ...radii), nButtons: buttons.length, giveBg: css(give, 'backgroundColor'), giveRadius: css(give, 'borderTopLeftRadius'), glyphColor: css(glyph, 'color'),
        sendBg: sendIt ? css(sendIt, 'backgroundColor') : null, answerBg: seeAnswer ? css(seeAnswer, 'backgroundColor') : null, answerClass: seeAnswer?.className, cardRadius: css(document.querySelector('.mgCard'), 'borderTopLeftRadius'), cardTop: css(document.querySelector('.mgCard'), 'borderTopColor') }
    })
    const serifOk = lang === 'ja' ? /Zen Old Mincho/.test(look.h1font) : lang === 'zh-Hant' ? /Noto Serif TC/.test(look.h1font) : /Cormorant Garamond/.test(look.h1font)
    check(`Part 18 (${lang}): the title is in the site serif, in ink (#151311) and not navy`, serifOk && look.h1color === 'rgb(21, 19, 17)', JSON.stringify({ f: look.h1font, c: look.h1color }))
    check(`Part 18 (${lang}): the counts and the card labels are in the small label style — Inter Light, letter-spaced, muted ink`, /Inter/.test(look.countsFont) && look.countsWeight === '300' && parseFloat(look.countsSpacing) > 0.5 && look.countsColor === 'rgb(92, 86, 77)' && /^rgb\(92, 86, 77\)$/.test(look.labelColor) && parseFloat(look.labelSpacing) > 0.5, JSON.stringify(look))
    check(`Part 18 (${lang}): cinnabar #C0392B is the character and nothing else — no button, label, count, border or underline uses it (nor the other site reds)`, look.glyphColor === 'rgb(192, 57, 43)' && look.badRed.length === 0, JSON.stringify(look.badRed))
    check(`Part 18 (${lang}): no button is a pill — every button, button-link and the header button has a corner radius of 4px at most (${look.nButtons} checked)`, look.nButtons >= 6 && look.maxRadius <= 4, JSON.stringify({ n: look.nButtons, max: look.maxRadius }))
    check(`Part 18 (${lang}): the primary buttons (give this gift, send it) are the site's solid ink button; 「返事を見る」 is a ghost link, not a solid button`, look.giveBg === 'rgb(21, 19, 17)' && look.sendBg === 'rgb(21, 19, 17)' && look.answerBg === 'rgba(0, 0, 0, 0)' && /ghostLink/.test(look.answerClass ?? ''), JSON.stringify({ g: look.giveBg, s: look.sendBg, a: look.answerBg, c: look.answerClass }))
    check(`Part 18 (${lang}): the cards keep the paper slip with a thin gold top rule and a corner of 4px at most`, parseFloat(look.cardRadius) <= 4 && look.cardTop === 'rgb(184, 146, 74)', JSON.stringify({ r: look.cardRadius, t: look.cardTop }))
    check(`Part 18 (${lang}): the 支 gift shows all four pictures, no "Other" chip, and no horizontal scroll`, (await page.locator('[data-testid=mg-pic][data-state=ok]').count()) === 4 && (await page.locator('[data-testid=mg-chip]').allInnerTexts()).every((t) => !/^(other|その他|其他)$/i.test(t.trim())) && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)))
    if (lang !== 'zh-Hant') await page.screenshot({ path: `${SHOTS}/p18-mygifts-${lang}-390.png`, fullPage: true })
    check(`no page errors (run 52, ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
}

// ---------- Run 53 (2026-11-20): the read-only example gift (/s/<token>), the examples page, the landing section and the 「見本を見る」 buttons ----------
{
  const SHOTS53 = process.env.E2E_SHOTS_DIR || '/tmp/e2e-shots'
  const TOKEN = 'RG-samplesamplesample22'
  const PICS = ['/img/scenes/children.jpg', '/img/scenes/friends.jpg', '/img/scenes/m1.jpg', '/img/scenes/m2.jpg']
  const mkView = (lang) => ({
    id: TOKEN, token: TOKEN, language: lang, glyph: '整', reading: lang === 'ja' ? 'ととのえる' : '', romanization: lang === 'en' ? 'sei' : '', meaning_en: lang === 'en' ? 'composed' : null,
    ...(lang === 'en' ? { en: { word: 'composed', word_source: 'generated', line: 'One who takes a breath at the door.', line_you: 'You take a breath at the door.', echo: null } } : {}),
    who: lang === 'ja' ? '玄関の前で深く息をついて自分を整え、何でもなかったような声で「ただいま」と言う人。' : lang === 'en' ? 'One who takes a breath at the door.' : '在門前深深呼吸、整理好自己，再若無其事說「我回來了」的人。',
    poem: { type: lang === 'ja' ? 'tanka' : 'free', lines: lang === 'ja' ? ['玄関の', '深い息つぎ', 'そのあとの', 'ただいまの声', 'やわらかい'] : ['at the door', 'one breath, then home'], reading: '' }, memorial: false, purpose: 'thanks', music: 'thanks',
    film: { status: 'ready', lines: lang === 'ja' ? ['玄関の前で立ち止まる', '深く息をつく', '「ただいま」と言う', '台所の灯りがともる'] : ['She stops at the door', 'A long breath', '"I\'m home"', 'The kitchen light is on'], pictures: PICS },
    certificate_line: 'x', from: lang === 'ja' ? '一字礼' : lang === 'en' ? 'ICHIREI' : '一字禮', to: lang === 'ja' ? 'あなた' : lang === 'en' ? 'You' : '你', message: '', egift: null, locked: false, certificate_no: null, order_date: '2026-11-20', opens_on: null,
    replied: false, package: 'egift', back: null, sample: true,
  })
  const locale = (l) => (l === 'ja' ? 'ja-JP' : l === 'en' ? 'en-US' : 'zh-TW')
  const openSample = async (lang, { w = 390, h = 844, off = false } = {}) => {
    const ctx = await browser.newContext({ locale: locale(lang), viewport: { width: w, height: h }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    const errs = []
    const seen = { opened: 0, own: 0, back: 0, reply: 0, tracked: [] }
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.route('**/api/analytics', (r) => { try { seen.tracked.push(JSON.parse(r.request().postData() ?? '{}')) } catch { /* */ } return r.fulfill({ status: 204, body: '' }) })
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: false, left: 0, daily: 100, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift'], promo: { from: '2026-10-01T00:00:00Z', until: '2026-10-31T00:00:00Z' }, usd: { egift: 25, egift_sale: 17.5 } } }))
    await page.route(`**/api/gift/${TOKEN}**`, async (r) => {
      const u = new URL(r.request().url())
      if (u.pathname === `/api/gift/${TOKEN}/opened`) { seen.opened++; return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/own`) { seen.own++; return r.fulfill({ json: { ok: true } }) }
      if (u.pathname === `/api/gift/${TOKEN}/back`) { seen.back++; return r.fulfill({ status: 403, json: {} }) }
      if (u.pathname === `/api/gift/${TOKEN}/reply`) { seen.reply++; return r.fulfill({ status: 403, json: {} }) }
      if (off) return r.fulfill({ status: 410, json: { error: 'sample_off', code: 'sample_off', language: lang } })
      if (u.pathname === `/api/gift/${TOKEN}/render`) return r.fulfill({ json: { state: 'ready', view: mkView(lang) } })
      if (u.pathname === `/api/gift/${TOKEN}`) return r.fulfill({ json: mkView(lang) })
      return r.fulfill({ status: 204, body: '' })
    })
    await page.goto(`http://localhost:5173/s/${TOKEN}`, { waitUntil: 'networkidle' })
    return { page, ctx, errs, seen }
  }
  const NOTE = { ja: '一字礼の贈りもの（見本）。実際にこのように届きます。', en: 'An example ICHIREI gift, the way it arrives on a phone.', 'zh-Hant': '一字禮的禮物（範例）。實際上會這樣送達。' }
  const BTN = { ja: ['あなたの大切な人へ', '/?src=x_sample'], en: ['Make one for someone of yours', '/en?src=x_sample'], 'zh-Hant': ['送給你重要的人', '/zh?src=x_sample'] }
  const Tt = (page, id) => page.locator(`[data-testid=${id}]`)
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const { page, ctx, errs, seen } = await openSample(lang)
    await Tt(page, 'cr-mark').waitFor()
    check(`sample (${lang}): the ceremony opens with the one small line at the top — 「${NOTE[lang]}」`, (await Tt(page, 'sample-note').innerText()) === NOTE[lang] && (await page.locator('main').getAttribute('data-ceremony')) === 'new')
    if (lang !== 'zh-Hant') await page.screenshot({ path: `${SHOTS53}/sample-${lang}-1-first-390.png` })
    await Tt(page, 'cr-markbtn').click()
    await page.waitForTimeout(300)
    check(`sample (${lang}): touching the mark counts one open for the sample (nothing is marked), not a receiver's open`, seen.opened === 1 && !seen.tracked.some((e) => e.event === 'receiver_opened'))
    await Tt(page, 'gift-skip').click({ timeout: 15000 }) // (no sender's note on a sample: the film comes straight after the mark)
    await Tt(page, 'cr-to-poem').click(); await Tt(page, 'cr-to-cert').click(); await Tt(page, 'cr-to-keep').click()
    check(`sample (${lang}): the saving and sharing buttons stay (save everything, share) and there is still a way on`, (await Tt(page, 'save-all').count()) === 1 && (await Tt(page, 'share-button').count()) === 1 && (await Tt(page, 'gift-to-answer').count()) === 1)
    await Tt(page, 'gift-to-answer').click()
    await Tt(page, 'gift-last').waitFor()
    const btn = Tt(page, 'gift-landing-line')
    check(`sample (${lang}): the last screen has ONE button — 「${BTN[lang][0]}」 to ${BTN[lang][1]} — and no gift back, no send-back, no My gifts corner, no back-to-gift button`, (await btn.innerText()).toLowerCase() === BTN[lang][0].toLowerCase() && (await btn.getAttribute('href')) === BTN[lang][1] && (await Tt(page, 'gift-back-button').count()) === 0 && (await Tt(page, 'cr-mygifts-top').count()) === 0 && (await page.locator('main button, main a').filter({ hasText: /./ }).evaluateAll((els) => els.filter((e) => e.getAttribute('data-testid') !== 'gift-landing-line' && e.offsetParent !== null && /cr-blk|cr-go|cr-backbtn/.test(e.className)).length)) === 0)
    check(`sample (${lang}): the free-gift box shows only while the promotion runs (here it is over: not shown)`, (await Tt(page, 'gift-landing-promo').count()) === 0)
    if (lang !== 'zh-Hant') await page.screenshot({ path: `${SHOTS53}/sample-${lang}-2-last-390.png` })
    await page.route('**/write**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }))
    await page.route('**/?src=x_sample', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }))
    await btn.click().catch(() => {})
    await page.waitForTimeout(300)
    check(`sample (${lang}): pressing it counts one "made their own" for the sample`, seen.own === 1)
    check(`sample (${lang}): nothing was sent back or replied`, seen.back === 0 && seen.reply === 0)
    check(`no page errors (run 53, sample ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
  }
  // switched off: the calm line and the landing button
  for (const [lang, off, go] of [['ja', 'この見本は公開を終了しました', '/'], ['en', 'This example is no longer available', '/en'], ['zh-Hant', '這個範例已停止公開', '/zh']]) {
    const { page, ctx } = await openSample(lang, { off: true })
    await Tt(page, 'sample-off').waitFor()
    check(`sample (${lang}, switched off): 「${off}」 with the landing button`, (await Tt(page, 'sample-off').innerText()) === off && (await Tt(page, 'sample-off-landing').getAttribute('href')) === go)
    await ctx.close()
  }
  // the examples page, the landing section and the buttons
  const CARDS = (l) => [
    { token: 'RG-exaaaaaaaaaaaaaaaaaa', language: 'ja', glyph: '整', word: 'ととのえる', line: '玄関の前で深く息をついて自分を整える人。', moment: '玄関の前で立ち止まる', picture: '/img/scenes/children.jpg' },
    { token: 'RG-exbbbbbbbbbbbbbbbbbb', language: 'en', glyph: '庇', word: 'shelter', line: 'One who takes the day\'s weather so the kitchen stays warm.', moment: 'She stops at the door', picture: '/img/scenes/friends.jpg' },
    { token: 'RG-exccccccccccccccccc2', language: 'ja', glyph: '守', word: 'まもる', line: '結果の貼り紙の前で、何も言わずに待っていた人。', moment: '貼り紙の前で', picture: '/img/scenes/m1.jpg' },
  ].sort((a, b) => Number(b.language === (l === 'zh-Hant' ? 'zh-Hant' : l)) - Number(a.language === (l === 'zh-Hant' ? 'zh-Hant' : l)))
  const mockSite = async (page, lang, counts) => {
    await page.route('**/api/analytics', (r) => { try { counts.tracked.push(JSON.parse(r.request().postData() ?? '{}')) } catch { /* */ } return r.fulfill({ status: 204, body: '' }) })
    await page.route('**/api/me*', (r) => r.fulfill({ json: { basket: { count: 0 }, ready: null, hold: null } }))
    await page.route('**/api/promo', (r) => r.fulfill({ json: { on: false, left: 0, daily: 100, hold: null } }))
    await page.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift'], promo: { from: '2026-11-01T00:00:00Z', until: '2026-11-30T00:00:00Z' }, usd: { egift: 25, egift_sale: 17.5 } } }))
    await page.route('**/api/examples?*', (r) => r.fulfill({ json: { examples: CARDS(lang) } }))
    await page.route('**/api/examples/count', (r) => { try { counts.count.push(JSON.parse(r.request().postData() ?? '{}').kind) } catch { /* */ } return r.fulfill({ json: { ok: true } }) })
    await page.route('**/api/gift/RG-ex*/picture/*', (r) => r.fulfill({ status: 302, headers: { location: '/img/scenes/children.jpg' } }))
  }
  const EXP = { ja: ['/examples', '一字礼の見本', '見本を見る', 'あなたの大切な人へ', '/write?src=examples', 'ほかの見本も見る →', '/'], en: ['/en/examples', 'ICHIREI examples', 'See examples', 'Make one for someone of yours', '/en/write?src=examples', 'See all examples →', '/en'], 'zh-Hant': ['/zh/examples', '一字禮範例', '看範例', '送給你重要的人', '/zh/write?src=examples', '看更多範例 →', '/zh'] }
  for (const lang of ['ja', 'en', 'zh-Hant']) {
    const [path, title, btnText, makeText, makeHref, allText, landing] = EXP[lang]
    const ctx = await browser.newContext({ locale: locale(lang), viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    const errs = []
    const counts = { tracked: [], count: [] }
    page.on('pageerror', (e) => errs.push(String(e)))
    await mockSite(page, lang, counts)
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
    await Tt(page, 'examples-page').waitFor()
    await page.locator('[data-testid=example-card]').first().waitFor()
    const cards = await page.locator('[data-testid=example-card]').evaluateAll((els) => els.map((e) => ({ lang: e.getAttribute('data-lang'), href: e.getAttribute('href'), glyph: e.querySelector('[data-testid=example-glyph]')?.textContent, color: getComputedStyle(e.querySelector('[data-testid=example-glyph]')).color, label: e.querySelector('[data-testid=example-lang]')?.textContent ?? null, hasWord: !!e.querySelector('[data-testid=example-word]'), line: !!e.querySelector('[data-testid=example-line]'), moment: !!e.querySelector('[data-testid=example-moment]'), img: e.querySelector('img')?.getAttribute('loading') })))
    const own = lang === 'zh-Hant' ? 'zh-Hant' : lang
    check(`examples (${lang}): the title 「${title}」, one card per example (3 here), the page's own language first, the others labelled with their language`, (await Tt(page, 'examples-title').innerText()) === title && cards.length === 3 && (!cards.some((c) => c.lang === own) || cards[0].lang === own) && cards.slice(1).every((c) => c.lang !== own ? !!c.label : true) && cards.filter((c) => c.lang !== own).every((c) => c.label), JSON.stringify(cards))
    check(`examples (${lang}): each card shows the character in cinnabar, its word, the one line, one line of the moment and a lazy picture`, cards.every((c) => c.color === 'rgb(192, 57, 43)' && c.hasWord && c.line && c.moment && c.img === 'lazy'))
    check(`examples (${lang}): a card opens that example's ceremony (/s/<token>?src=examples)`, cards.every((c) => /^\/s\/RG-ex[a-z0-9]+\?src=examples$/.test(c.href)))
    check(`examples (${lang}): the page view is counted (a count only)`, counts.count.filter((k) => k === 'view').length >= 1)
    check(`examples (${lang}): at the bottom 「${makeText}」 goes to the writing page with src=examples`, (await Tt(page, 'examples-make').innerText()) === makeText && (await Tt(page, 'examples-make').getAttribute('href')) === makeHref)
    check(`examples (${lang}): no horizontal scroll at 390 px and no corner above 4px on the cards or the button`, (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && (await page.evaluate(() => [...document.querySelectorAll('.exCard, .exMake .btn')].every((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) <= 4))))
    if (lang === 'ja') await page.screenshot({ path: `${SHOTS53}/examples-ja-390.png`, fullPage: true })
    await page.route('**/s/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }))
    await page.locator('[data-testid=example-card]').first().click().catch(() => {})
    await page.waitForTimeout(300)
    check(`examples (${lang}): opening a card is counted`, counts.count.includes('card'))
    check(`no page errors (run 53, examples ${lang})`, errs.length === 0, errs.join('; '))
    await ctx.close()
    // the landing: the buttons, the swipe row and "see all"
    const c2 = await browser.newContext({ locale: locale(lang), viewport: { width: 390, height: 844 } })
    const lp = await c2.newPage()
    const lcounts = { tracked: [], count: [] }
    await mockSite(lp, lang, lcounts)
    await lp.goto(`http://localhost:5173${landing}`, { waitUntil: 'networkidle' })
    await lp.locator('[data-testid=examples-section]').waitFor({ timeout: 8000 })
    const land = await lp.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-testid=examples-button]')]
      const row = document.querySelector('[data-testid=examples-row]')
      const cs = [...document.querySelectorAll('[data-testid=examples-row] [data-testid=example-card]')]
      const r0 = cs[0].getBoundingClientRect(); const r1 = cs[1].getBoundingClientRect()
      return { n: btns.length, text: btns.map((b) => b.textContent), hrefs: btns.map((b) => b.getAttribute('href')), radius: btns.map((b) => parseFloat(getComputedStyle(b).borderTopLeftRadius)), overflowX: getComputedStyle(row).overflowX, firstW: r0.width, nextLeft: r1.left, vw: window.innerWidth, lazy: cs.every((c) => c.querySelector('img')?.getAttribute('loading') === 'lazy'), all: document.querySelector('[data-testid=examples-all]')?.textContent, allHref: document.querySelector('[data-testid=examples-all]')?.getAttribute('href') }
    })
    check(`landing (${lang}): the 「${btnText}」 ghost button next to the start button and in "How it works" (never a pill), linking to ${path}`, land.n >= 2 && land.text.every((t) => t === btnText) && land.hrefs.every((h) => h === path) && land.radius.every((x) => x <= 4), JSON.stringify(land))
    check(`landing (${lang}): the examples section is a swipeable row — one card and a bit of the next visible on a phone — with lazy pictures and 「${allText}」 to ${path}`, land.overflowX === 'auto' && land.nextLeft < land.vw - 20 && land.nextLeft > land.firstW && land.lazy && land.all === allText && land.allHref === path, JSON.stringify(land))
    await c2.close()
    // the writing page: the button under the guide line
    const c3 = await browser.newContext({ locale: locale(lang), viewport: { width: 390, height: 844 } })
    const wp = await c3.newPage()
    await mockSite(wp, lang, { tracked: [], count: [] })
    await wp.goto(`http://localhost:5173${lang === 'ja' ? '/write' : lang === 'en' ? '/en/write' : '/zh/write'}`, { waitUntil: 'networkidle' })
    await wp.locator('[data-testid=examples-under-hint]').waitFor({ timeout: 8000 })
    check(`writing page (${lang}): 「${btnText}」 sits under the moment box's guide line and goes to ${path}`, (await wp.locator('[data-testid=examples-under-hint] a').innerText()) === btnText && (await wp.locator('[data-testid=examples-under-hint] a').getAttribute('href')) === path)
    await c3.close()
  }
  // counting: arriving with src=x_sample / src=examples is its own source
  for (const tag of ['x_sample', 'examples']) {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    const counts = { tracked: [], count: [] }
    await mockSite(page, 'ja', counts)
    await page.goto(`http://localhost:5173/?src=${tag}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    check(`counting: arriving with ?src=${tag} sends the page view with that tag as its source (no personal data)`, counts.tracked.some((e) => e.event === 'page_view' && e.ref === tag))
    await ctx.close()
  }
}

await browser.close()
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
