// Usage: npx playwright + a dev server on :5173, then `node scripts/e2e-harness.mjs`.
// Optional env: CHROMIUM_PATH (browser binary), E2E_SHOTS_DIR (screenshot output).
// End-to-end harness test (build spec §9.7): drives the real /demo UI against a
// mocked engine returning the §10 golden-fixture shape. Verifies the reveal,
// condition toggle (no engine re-call), kyūjitai pairing, follow-up loop, and
// all §6 behavioral events.
import { chromium } from 'playwright'

const SHOTS = process.env.E2E_SHOTS_DIR ?? '.'
const STORY =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

const FIXTURE = {
  status: 'sufficient',
  follow_up_question: null,
  particulars: [
    '駅までの送り迎え、二十年', '「金は要るか」と封筒', 'ほとんど何も話さない',
  ],
  fingerprint: {
    relationship: '子 → 父',
    scarce_asset: '駅での無言の送り迎え、二十年',
    unsaid_truth: '心配だと一度も言わないのに、一度も一人で発たせなかった。',
    dominant_truth_type: 'Role',
    dignity_direction: '沈黙を冷たさではなく、行動で示す愛情として開く',
  },
  candidates: [
    { kanji: '迎', reading: 'むかえ', kyujitai_form: null, truth_type: 'Role',
      one_line_gaze: 'あなたは二十年、私の帰りをいつも駅で迎えてくれた。理由は、一度も言わずに。',
      story_anchor: '盆に帰るたびに車で駅まで迎えに来て',
      unique_truth: '会いに来るという行為そのもの。還暦を迎える、の一字でもある。',
      eliminated: false, eliminated_reason: null,
      suitability_flag: '一字で刻んだときの自然さは要確認（パレット照合待ち）' },
    { kanji: '黙', reading: 'もく', kyujitai_form: '默', truth_type: 'Hidden Cost',
      one_line_gaze: 'あなたは言葉の代わりに、静けさのまま、そこにいてくれた。',
      story_anchor: '相変わらず、ほとんど何も話さないけど',
      unique_truth: '語らないことで支え続けた歳月。',
      eliminated: false, eliminated_reason: null, suitability_flag: null },
    { kanji: '駅', reading: 'えき', kyujitai_form: '驛', truth_type: 'Private Symbol',
      one_line_gaze: 'あなたの心配は、いつもあの駅の改札で待っていた。',
      story_anchor: '駅まで送ってくれて',
      unique_truth: 'ふたりの物語の舞台。', eliminated: false,
      eliminated_reason: null,
      suitability_flag: '単独の刻印としては弱い（場所の名詞にとどまる）' },
    { kanji: '送', reading: 'おくり', kyujitai_form: null, truth_type: 'Hidden Cost',
      one_line_gaze: 'あなたは一度も、私を一人で発たせなかった。',
      story_anchor: '帰りも必ず送ってくれる', unique_truth: '見送りの持続。',
      eliminated: true,
      eliminated_reason: 'ゲート3（日本語の自然さ）：見送る・葬送の連想があり、存命の祝いに不向き。',
      suitability_flag: '葬送の連想' },
    { kanji: '厳', reading: 'げん', kyujitai_form: '嚴', truth_type: 'Essence',
      one_line_gaze: '厳しさの奥で、あなたはずっと心配していた。',
      story_anchor: '父は口下手で厳しくて', unique_truth: '表向きの気質。',
      eliminated: true,
      eliminated_reason: 'ゲート4（尊厳の境界）：人を「厳しい」という評決に閉じ込める。',
      suitability_flag: null },
    { kanji: '愛', reading: 'あい', kyujitai_form: null, truth_type: 'Essence',
      one_line_gaze: 'あなたはずっと家族を愛してくれた。',
      story_anchor: '封筒を押し付けてきた', unique_truth: 'なし（汎用）。',
      eliminated: true,
      eliminated_reason: 'ゲート1（置換テスト）：どの家族にも当てはまる。隔離規則違反。',
      suitability_flag: null },
  ],
  primary_kanji: '迎',
}

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

await browser.close()
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
