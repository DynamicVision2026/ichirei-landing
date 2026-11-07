// The words of the owner dashboard /ops/stats in four languages: 日本語 (default) · English · 繁體中文 · 简体中文. The labels of the owner's table are used exactly; the ones the ticket did not list
// are written here in the same register. zh-Hans is NEVER typed by hand: it is the zh-Hant column converted with OpenCC (engine/script.ts). Data values (characters, order numbers, amounts) never change with the language.

import { toSimplified } from './script.ts'

export const STATS_LANGS = ['ja', 'en', 'zh-Hant', 'zh-Hans'] as const
export type StatsLang = (typeof STATS_LANGS)[number]
export const STATS_LANG_NAMES: Record<StatsLang, string> = { ja: '日本語', en: 'English', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文' }

type Dict = Record<string, string>

const ja: Dict = {
  title: '一字礼 ダッシュボード',
  p_today: '今日', p_d7: '7日間', p_d30: '30日間', p_all: '全期間',
  visits: 'ページ訪問', stories: '物語を書いた', cards: '字に出会った', paid: 'ご注文（支払済）', revenue: '売上', ai_cost: 'AI費用（推定）',
  funnel: '流れ（どこで離れているか）',
  step_visits: 'ページ訪問', step_chips: '関係・理由を選んだ', step_story: '物語を送った', step_cards: '字に出会った', step_give: 'この字で贈る', step_paid: 'お支払い完了', step_collect: '受け取った', step_open: '相手が開封', step_share: 'SNSでシェア',
  daily: '日別：訪問とご注文', source: 'どこから / 言語', src_direct: '直接・検索', src_other: 'その他',
  src_instagram: 'Instagram', src_facebook: 'Facebook', src_x: 'X', src_line: 'LINE', src_xhs: '小紅書',
  lang_ja: '日本語', lang_zh: '繁體中文', lang_en: 'English',
  orders: 'ご注文一覧（最新50件）',
  col_time: '日時', col_order: '注文番号', col_gift: '贈り方', col_char: '一字', col_type: '種類', col_lang: '言語', col_purpose: '理由', col_amount: '金額', col_collected: '受け取り', col_opened: '開封', col_status: '状態',
  yes: '済', no: '未',
  status_done: '完了', status_cancellable: 'キャンセル可（あと{h}時間）', status_refunded: 'キャンセル・返金済', status_unpaid: '未入金',
  privacy_note: '物語の本文・お名前は表示しません。',
  // my own labels (not in the ticket's table)
  visits_social: 'うちSNS経由 {n}%', of_visits: '訪問の{n}%', avg_secs: '平均{n}秒', of_seers: '字に出会った人の{n}%', cancels: 'キャンセル {n}件', of_revenue: '売上の{n}%', no_data: '—',
  choice_title: '選ばれた字：本命 / 遊び字', choice_note: '支払い済みのご注文のうち', used_rounds: '2回目・3回目を使った人', round2: '2回目', round3: '3回目',
  slot_main: '本命', slot_free: '遊び字', slot_second: '次点',
  top10: '本命（メインの字）上位10（直近30日）', top_rank: '順位', top_char: '字', top_count: '回数', top_share: '割合', top_runs: '全{n}回',
  free_title: '遊び字の出どころ（直近30日）', free_round: 'ラウンド', free_first: '最初の五候補から', free_retry: 'やり直し', free_runner: '他のカードの予備', free_none: '出なかった', free_total: '合計（{n}回）', free_reasons: '理由',
  daily_visits: '訪問', daily_orders: 'ご注文', none: 'なし', detail: '詳細', loading_failed: '集計を読み込めませんでした。', back_to_ops: '← 注文一覧（/ops）',
  gift_egift: 'eギフト', gift_simple: '木札', gift_standard: '版木', gift_other: 'その他', memorial_mark: '偲ぶ',
  sources_visits: '訪問', sources_orders: 'ご注文', payments_unverified: '⚠ Shopifyから入金を確認できませんでした。ご注文は作成時刻で数えています。',
  cost_note: '推定：記録したAI呼び出しのトークン数と絵の枚数に、設定ファイルの単価を掛けた概算です。',
  pur_celebrate: 'お祝い', pur_thanks: 'ありがとう', pur_apology: 'ごめんね・仲直り', pur_encourage: '応援・お見舞い', pur_farewell: '門出・送別', pur_reconnect: 'ご無沙汰・再会', pur_confess: '想いを伝える', pur_memorial: '偲ぶ', pur_other: 'その他',
  lang_switch: '言語',
}

const en: Dict = {
  title: 'ICHIREI dashboard',
  p_today: 'Today', p_d7: '7 days', p_d30: '30 days', p_all: 'All time',
  visits: 'Page visits', stories: 'Stories written', cards: 'Saw characters', paid: 'Paid orders', revenue: 'Revenue', ai_cost: 'AI cost (est.)',
  funnel: 'Funnel (where people drop off)',
  step_visits: 'Page visits', step_chips: 'Chose relationship & purpose', step_story: 'Sent story', step_cards: 'Saw characters', step_give: 'Chose a character', step_paid: 'Paid', step_collect: 'Collected', step_open: 'Receiver opened', step_share: 'Shared on social',
  daily: 'Daily visits and orders', source: 'Sources / languages', src_direct: 'Direct & search', src_other: 'Other',
  src_instagram: 'Instagram', src_facebook: 'Facebook', src_x: 'X', src_line: 'LINE', src_xhs: 'Xiaohongshu',
  lang_ja: '日本語', lang_zh: '繁體中文', lang_en: 'English',
  orders: 'Latest 50 orders',
  col_time: 'Time', col_order: 'Order', col_gift: 'Gift', col_char: 'Character', col_type: 'Type', col_lang: 'Language', col_purpose: 'Purpose', col_amount: 'Amount', col_collected: 'Collected', col_opened: 'Opened', col_status: 'Status',
  yes: 'Yes', no: 'No',
  status_done: 'Complete', status_cancellable: 'Cancellable ({h} h left)', status_refunded: 'Cancelled & refunded', status_unpaid: 'Unpaid',
  privacy_note: 'Story text and names are never shown.',
  visits_social: '{n}% from social', of_visits: '{n}% of visits', avg_secs: 'avg {n} s', of_seers: '{n}% of those who saw characters', cancels: '{n} cancelled', of_revenue: '{n}% of revenue', no_data: '—',
  choice_title: 'Chosen: main / playful', choice_note: 'Among paid orders', used_rounds: 'Used round 2 / round 3', round2: 'Round 2', round3: 'Round 3',
  slot_main: 'Main', slot_free: 'Playful', slot_second: 'Second',
  top10: 'Top 10 main characters (last 30 days)', top_rank: 'Rank', top_char: 'Character', top_count: 'Count', top_share: 'Share', top_runs: '{n} runs',
  free_title: 'Where the playful character came from (last 30 days)', free_round: 'Round', free_first: 'From the first five', free_retry: 'Retry', free_runner: 'Spare from the main call', free_none: 'None', free_total: 'Total ({n} runs)', free_reasons: 'Reasons',
  daily_visits: 'Visits', daily_orders: 'Orders', none: 'None', detail: 'Details', loading_failed: 'Could not load the figures.', back_to_ops: '← Order list (/ops)',
  gift_egift: 'e-gift', gift_simple: 'Wooden tag', gift_standard: 'Print block', gift_other: 'Other', memorial_mark: 'In memory',
  sources_visits: 'Visits', sources_orders: 'Orders', payments_unverified: '⚠ Payments could not be confirmed with Shopify. Orders are counted by the time they were made.',
  cost_note: 'Estimate: logged AI-call tokens and picture counts multiplied by the prices in the config file.',
  pur_celebrate: 'Celebrate', pur_thanks: 'Thank you', pur_apology: 'Sorry / making up', pur_encourage: 'Encourage / get well', pur_farewell: 'Farewell / new start', pur_reconnect: 'Keep in touch / meeting again', pur_confess: 'Say it at last', pur_memorial: 'In memory', pur_other: 'Other',
  lang_switch: 'Language',
}

const zhHant: Dict = {
  title: '一字禮 儀表板',
  p_today: '今天', p_d7: '7天', p_d30: '30天', p_all: '全部期間',
  visits: '頁面造訪', stories: '寫下故事', cards: '看到字', paid: '已付款訂單', revenue: '營收', ai_cost: 'AI 成本（估計）',
  funnel: '流程（在哪裡流失）',
  step_visits: '頁面造訪', step_chips: '選了關係與理由', step_story: '送出故事', step_cards: '看到字', step_give: '選定要送的字', step_paid: '完成付款', step_collect: '已領取', step_open: '對方已開啟', step_share: '分享到社群',
  daily: '每日造訪與訂單', source: '來源 / 語言', src_direct: '直接・搜尋', src_other: '其他',
  src_instagram: 'Instagram', src_facebook: 'Facebook', src_x: 'X', src_line: 'LINE', src_xhs: '小紅書',
  lang_ja: '日本語', lang_zh: '繁體中文', lang_en: 'English',
  orders: '最新50筆訂單',
  col_time: '時間', col_order: '訂單編號', col_gift: '方案', col_char: '字', col_type: '類型', col_lang: '語言', col_purpose: '理由', col_amount: '金額', col_collected: '領取', col_opened: '開啟', col_status: '狀態',
  yes: '是', no: '否',
  status_done: '完成', status_cancellable: '可取消（剩{h}小時）', status_refunded: '已取消並退款', status_unpaid: '未付款',
  privacy_note: '不顯示故事內容與姓名。',
  visits_social: '其中社群 {n}%', of_visits: '佔造訪的{n}%', avg_secs: '平均{n}秒', of_seers: '佔看到字的人的{n}%', cancels: '取消 {n}筆', of_revenue: '佔營收的{n}%', no_data: '—',
  choice_title: '被選的字：本命 / 趣字', choice_note: '已付款訂單中', used_rounds: '使用第2次、第3次的人', round2: '第2次', round3: '第3次',
  slot_main: '本命', slot_free: '趣字', slot_second: '次選',
  top10: '本命（主要的字）前10名（近30天）', top_rank: '名次', top_char: '字', top_count: '次數', top_share: '比例', top_runs: '共{n}次',
  free_title: '趣字的來源（近30天）', free_round: '回合', free_first: '來自最初的五個候選', free_retry: '重新詢問', free_runner: '本命候選的備用', free_none: '沒有出現', free_total: '合計（{n}次）', free_reasons: '原因',
  daily_visits: '造訪', daily_orders: '訂單', none: '無', detail: '詳情', loading_failed: '無法讀取統計。', back_to_ops: '← 訂單列表（/ops）',
  gift_egift: 'e禮物', gift_simple: '木牌', gift_standard: '版木', gift_other: '其他', memorial_mark: '追思',
  sources_visits: '造訪', sources_orders: '訂單', payments_unverified: '⚠ 無法向 Shopify 確認付款。訂單以建立時間計算。',
  cost_note: '估計：已記錄的 AI 呼叫 token 數與圖片張數，乘上設定檔中的單價。',
  pur_celebrate: '祝福', pur_thanks: '謝謝', pur_apology: '道歉・和好', pur_encourage: '加油・探望', pur_farewell: '送別・新旅程', pur_reconnect: '久違・重逢', pur_confess: '傳達心意', pur_memorial: '追思', pur_other: '其他',
  lang_switch: '語言',
}

// OpenCC's Taiwan phrase table turns 社群 (social platforms) into 社区 (neighbourhood), which says something else: the one label it spoils is kept as the converter's plain character mapping gives it.
export const ZH_HANS_KEEP: Dict = { step_share: '分享到社群' }

const DICTS: Record<StatsLang, Dict> = {
  ja,
  en,
  'zh-Hant': zhHant,
  // zh-Hans = the zh-Hant column through OpenCC (never typed by hand); proper names and data words that must not change are left as they are by the converter
  'zh-Hans': Object.fromEntries(Object.entries(zhHant).map(([k, v]) => [k, ZH_HANS_KEEP[k] ?? toSimplified(v)])),
}

export const STATS_KEYS: string[] = Object.keys(ja)
export const statsDict = (lang: StatsLang): Dict => DICTS[lang]
export const statsDicts = (): Record<StatsLang, Dict> => DICTS
