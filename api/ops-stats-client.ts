// The browser half of /ops/stats: draws every number from the embedded data with the words of the chosen language. No network call, no third party. The language
// is remembered in localStorage (inside try/catch); data values (characters, order numbers, amounts) never change with the language, the words around them do.
// The script is plain ES5-style JavaScript held in one string (the server sends it inline).

export const STATS_CLIENT_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('d').textContent);
  var KEY = 'ichirei-stats-lang', PKEY = 'ichirei-stats-period';
  var PERIODS = ['today', 'd7', 'd30', 'all'];
  var lang = 'ja', period = 'd7';
  try { var s = localStorage.getItem(KEY); if (D.langs.indexOf(s) >= 0) lang = s; } catch (e) {}
  try { var p = sessionStorage.getItem(PKEY); if (PERIODS.indexOf(p) >= 0) period = p; } catch (e) {}
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function t(k, v) {
    var s = (D.dict[lang] || {})[k];
    if (s === undefined) s = D.dict.ja[k];
    if (s === undefined) return '';
    if (v) for (var n in v) s = s.split('{' + n + '}').join(v[n]);
    return s;
  }
  function num(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function yen(n) { return '¥' + num(n); }
  function buyerAmt(b) { var n = Number(b.amount); var v = isFinite(n) ? (Math.round(n) === n ? String(n) : n.toFixed(2)) : String(b.amount); return (b.currency === 'USD' ? '$' : b.currency + ' ') + v; }
  // revenue is the yen amount the shop settles; an order paid in another currency shows what the buyer paid beside it: ¥2,786 ($17.50)
  function money(o) { return yen(o.price_jpy) + (o.price_buyer ? ' (' + buyerAmt(o.price_buyer) + ')' : '') + (o.free ? ' · ' + t('free_mark') + (o.free_code ? ' ' + o.free_code : '') : ''); }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
  function jst(iso) { var ms = Date.parse(iso); if (!isFinite(ms)) return ''; return new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' '); }
  function giftOf(sku) { return { 'ICHIREI-EGIFT': t('gift_egift'), 'ICHIREI-SIMPLE': t('gift_simple'), 'ICHIREI-STANDARD': t('gift_standard') }[sku] || t('gift_other'); }
  function purposeOf(code) { return code ? t('pur_' + code) || code : '—'; }
  function slotOf(o) { return o.slot ? t('slot_' + o.slot) : '—'; }
  function tile(label, value, sub) { return '<div class="num"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><small>' + (sub ? esc(sub) : '&nbsp;') + '</small></div>'; }

  function renderNumbers(s) {
    var avg = s.avg_cards_secs == null ? t('no_data') : t('avg_secs', { n: s.avg_cards_secs });
    return '<div class="grid" id="numbers">' +
      tile(t('visits'), num(s.visits), t('visits_social', { n: pct(s.social_visits, s.visits) })) +
      tile(t('stories'), num(s.stories), t('of_visits', { n: pct(s.stories, s.visits) })) +
      tile(t('cards'), num(s.cards), avg) +
      tile(t('paid'), num(s.paid), t('of_seers', { n: pct(s.paid, s.cards) })) +
      tile(t('revenue'), yen(s.revenue_jpy), t('cancels', { n: s.cancelled })) +
      tile(t('ai_cost'), yen(s.ai_cost_jpy), t('of_revenue', { n: pct(s.ai_cost_jpy, s.revenue_jpy) })) + '</div>';
  }

  function renderChoice(s) {
    var c = s.choice, total = c.main + c.free + c.second;
    var parts = [t('slot_main') + ' ' + c.main + ' (' + pct(c.main, total) + '%)', t('slot_free') + ' ' + c.free + ' (' + pct(c.free, total) + '%)'];
    if (c.second) parts.push(t('slot_second') + ' ' + c.second + ' (' + pct(c.second, total) + '%)');
    var h = '<h2>' + esc(t('choice_title')) + '</h2><div class="grid">' +
      tile(t('choice_title'), parts.join(' / '), t('choice_note') + ' ' + total) +
      tile(t('used_rounds'), c.round2 + ' / ' + c.round3, t('round2') + ' ' + pct(c.round2, s.paid) + '% / ' + t('round3') + ' ' + pct(c.round3, s.paid) + '%') + '</div>';
    var m = D.main, f = D.free;
    h += '<div class="two"><div><h2>' + esc(t('top10')) + '</h2>';
    if (!m) h += '<p>' + esc(t('loading_failed')) + '</p>';
    else if (!m.top.length) h += '<p class="note">' + esc(t('none')) + '</p>';
    else {
      h += '<div class="wide"><table><thead><tr><th>' + esc(t('top_rank')) + '</th><th>' + esc(t('top_char')) + '</th><th class="n">' + esc(t('top_count')) + '</th><th class="n">' + esc(t('top_share')) + '</th></tr></thead><tbody>';
      m.top.forEach(function (r, i) { h += '<tr><td>' + (i + 1) + '</td><td class="k">' + esc(r.kanji) + '</td><td class="n">' + num(r.count) + '</td><td class="n">' + r.share + '%</td></tr>'; });
      h += '</tbody></table></div><p class="note">' + esc(t('top_runs', { n: num(m.runs) })) + '</p>';
    }
    h += '</div><div><h2>' + esc(t('free_title')) + '</h2>';
    if (!f) h += '<p>' + esc(t('loading_failed')) + '</p>';
    else {
      var row = function (label, v) { return '<tr><td>' + esc(label) + '</td><td class="n">' + v.first + '</td><td class="n">' + v.retry + '</td><td class="n">' + v.runner_up + '</td><td class="n">' + v.none + '</td></tr>'; };
      h += '<div class="wide"><table><thead><tr><th>' + esc(t('free_round')) + '</th><th class="n">' + esc(t('free_first')) + '</th><th class="n">' + esc(t('free_retry')) + '</th><th class="n">' + esc(t('free_runner')) + '</th><th class="n">' + esc(t('free_none')) + '</th></tr></thead><tbody>' +
        row('1', f.by_round[1]) + row('2', f.by_round[2]) + row('3', f.by_round[3]) + row(t('free_total', { n: num(f.runs) }), f.by_source) + '</tbody></table></div>';
      var rs = Object.keys(f.reasons).sort(function (a, b) { return f.reasons[b] - f.reasons[a]; }).map(function (k) { return esc(k) + ' ' + f.reasons[k]; }).join(' / ');
      h += '<p class="note">' + esc(t('free_reasons')) + ': ' + (rs || esc(t('none'))) + '</p>';
    }
    return h + '</div></div>';
  }

  function renderFunnel(s) {
    var f = s.funnel, steps = [['step_visits', f.visits], ['step_chips', f.chips], ['step_story', f.story], ['step_cards', f.cards], ['step_give', f.give], ['step_paid', f.paid], ['step_collect', f.collected], ['step_open', f.opened], ['step_share', f.shared]];
    var top = Math.max(1, f.visits), h = '<h2>' + esc(t('funnel')) + '</h2>';
    steps.forEach(function (st) {
      h += '<div class="bar"><span>' + esc(t(st[0])) + '</span><i style="width:' + Math.min(100, Math.max(0.5, (st[1] / top) * 100)) + '%"></i><em>' + num(st[1]) + ' (' + pct(st[1], top) + '%)</em></div>';
    });
    return h;
  }

  function renderDaily(s) {
    var max = 1;
    s.daily.forEach(function (d) { if (d.visits > max) max = d.visits; });
    var h = '<h2>' + esc(t('daily')) + '</h2><div class="days" role="img" aria-label="' + esc(t('daily')) + '">';
    s.daily.forEach(function (d) {
      h += '<div title="' + esc(d.day + ' · ' + t('daily_visits') + ' ' + d.visits + ' · ' + t('daily_orders') + ' ' + d.paid) + '"><b>' + (d.paid || '') + '</b><i style="height:' + Math.round((d.visits / max) * 100) + '%"></i><span>' + esc(d.day.slice(8)) + '</span></div>';
    });
    return h + '</div><p class="note">' + esc(t('daily_visits')) + ' ▇ / ' + esc(t('daily_orders')) + ' (' + esc(t('daily_orders')) + ': ' + 'n)</p>';
  }

  function renderSources(s) {
    var SRC = ['direct', 'instagram', 'facebook', 'x', 'line', 'xhs', 'x_sample', 'examples', 'other'], LG = [['ja', 'lang_ja'], ['zh-Hant', 'lang_zh'], ['en', 'lang_en']];
    var h = '<h2>' + esc(t('source')) + '</h2><div class="two"><div class="wide"><table><thead><tr><th></th><th class="n">' + esc(t('sources_visits')) + '</th><th class="n">' + esc(t('sources_orders')) + '</th></tr></thead><tbody>';
    SRC.forEach(function (k) { h += '<tr><td>' + esc(t('src_' + k)) + '</td><td class="n">' + num(s.sources.visits[k] || 0) + '</td><td class="n">' + num(s.sources.paid[k] || 0) + '</td></tr>'; });
    h += '</tbody></table></div><div class="wide"><table><thead><tr><th></th><th class="n">' + esc(t('sources_visits')) + '</th><th class="n">' + esc(t('sources_orders')) + '</th></tr></thead><tbody>';
    LG.forEach(function (l) { h += '<tr><td>' + esc(t(l[1])) + '</td><td class="n">' + num(s.languages.visits[l[0]] || 0) + '</td><td class="n">' + num(s.languages.paid[l[0]] || 0) + '</td></tr>'; });
    return h + '</tbody></table></div></div>';
  }

  function statusOf(o) {
    if (o.state === 'refund_due') return t('status_refund_due');
    if (o.state === 'waiting') return t('status_waiting', { d: o.days_left });
    if (o.state === 'cancelled' || o.state === 'refunded') return t('status_refunded');
    if (o.hours_left != null) return t('status_cancellable', { h: o.hours_left });
    return t('status_done');
  }
  function renderOrders() {
    var h = '<h2>' + esc(t('orders')) + '</h2><div class="wide"><table><thead><tr>';
    ['col_time', 'col_order', 'col_gift', 'col_char', 'col_type', 'col_lang', 'col_purpose', 'col_amount', 'col_collected', 'col_opened', 'col_status'].forEach(function (k) { h += '<th' + (k === 'col_amount' ? ' class="n"' : '') + '>' + esc(t(k)) + '</th>'; });
    h += '</tr></thead><tbody>';
    D.orders.forEach(function (o) {
      var cancelled = o.state === 'cancelled' || o.state === 'refunded';
      var lg = { ja: t('lang_ja'), en: t('lang_en'), 'zh-Hant': t('lang_zh'), 'zh-Hans': t('lang_zh') }[o.language] || o.language;
      h += '<tr' + (cancelled ? ' class="cancel"' : '') + '><td>' + esc(jst(o.paid_at || o.created_at)) + '</td><td><a href="/ops#o-' + esc(o.order_ref) + '">' + esc(o.order_ref.replace(/^[A-Z]+-/, '').slice(-8)) + '</a></td><td>' + esc(giftOf(o.size_code)) + (o.memorial ? ' · ' + esc(t('memorial_mark')) : '') + '</td><td class="k">' + esc(o.kanji) + '</td><td>' + esc(slotOf(o)) + '</td><td>' + esc(lg) + '</td><td>' + esc(purposeOf(o.purpose)) + '</td><td class="n">' + money(o) + '</td><td>' + esc(o.collected ? t('yes') : t('no')) + '</td><td>' + esc(o.opened ? t('yes') : t('no')) + '</td><td>' + esc(statusOf(o)) + '</td></tr>';
    });
    if (!D.orders.length) h += '<tr><td colspan="11">' + esc(t('none')) + '</td></tr>';
    return h + '</tbody></table></div>';
  }

  var HEALTH_CODES = ['en_cart_currency_mismatch', 'needs_attention', 'certificate_no_missing', 'gift_incomplete', 'picture_substituted', 'pictures_none', 'picture_empty', 'poem_failed', 'film_fallback', 'order_record_failed', 'limit_person', 'limit_unpaid10', 'limit_ip', 'signin_new', 'signin_back', 'signin_failed', 'account_delete_requested', 'limit_site', 'limit_pictures', 'promo_unavailable', 'consent_saved', 'consent_not_saved', 'held', 'hold_used', 'hold_expired', 'basket_saved', 'basket_link_opened'];
  var RED = { en_cart_currency_mismatch: 1, needs_attention: 1, certificate_no_missing: 1, order_record_failed: 1 };
  function renderHealth() {
    var H = D.health; if (!H) return '';
    var tot = H.total || {}, days = Object.keys(H.by_day || {}).sort().reverse().slice(0, 14);
    var h = '<h2>' + esc(t('health_title')) + '</h2><div class="wide"><table data-testid="health-table"><thead><tr><th></th><th class="n">30</th>';
    days.forEach(function (d) { h += '<th class="n">' + esc(d.slice(5)) + '</th>'; });
    h += '</tr></thead><tbody>';
    HEALTH_CODES.forEach(function (c) {
      var n = tot[c] || 0, red = RED[c] && n > 0;
      h += '<tr data-code="' + c + '"' + (red ? ' class="red"' : '') + '><td>' + esc(t('h_' + c)) + '</td><td class="n">' + n + '</td>';
      days.forEach(function (d) { h += '<td class="n">' + ((H.by_day[d] || {})[c] || 0) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    var drawn = tot.film_drawn || 0, bad = tot.film_blank_or_substituted || 0;
    h += '<p class="note" data-testid="health-rate">' + esc(t('h_rate')) + ': ' + (drawn ? Math.round(bad / drawn * 1000) / 10 + '% (' + bad + ' / ' + drawn + ')' : esc(t('no_data'))) + '</p>';
    var rs = H.reasons || {}, keys = Object.keys(rs).sort(function (a, b) { return rs[b] - rs[a]; });
    if (keys.length) { h += '<p class="note" data-testid="health-reasons">' + esc(t('h_reasons')) + ': ' + keys.map(function (k) { return esc(k) + ' ' + rs[k]; }).join(' · ') + '</p>'; }
    return h;
  }
  function renderPromo() {
    var P = D.promo; if (!P || !P.on) return '';
    var h = '<p class="note" data-testid="promo-free-today"><b>' + esc(t('free_today', { n: P.free_today })) + '</b></p>';
    if (P.days && P.days.length) {
      h += '<h2>' + esc(t('promo_days_title')) + '</h2><div class="wide"><table data-testid="promo-days"><thead><tr><th>' + esc(t('promo_day')) + '</th><th class="n">' + esc(t('promo_given')) + '</th><th class="n">' + esc(t('h_held')) + '</th><th class="n">' + esc(t('promo_left')) + '</th><th class="n">' + esc(t('promo_langs')) + '</th></tr></thead><tbody>';
      P.days.forEach(function (r) { h += '<tr data-day="' + esc(r.day) + '"><td>' + esc(r.day) + '</td><td class="n">' + r.given + '</td><td class="n">' + r.held + '</td><td class="n">' + r.left + '</td><td class="n" data-testid="promo-day-langs">' + (r.by_lang ? 'ja ' + r.by_lang.ja + ' · en ' + r.by_lang.en + ' · zh ' + r.by_lang.zh : '—') + '</td></tr>'; });
      h += '</tbody></table></div>';
    }
    var bc = (D.health && D.health.held_by_code) || {}, ks = Object.keys(bc).sort(function (a, b) { return bc[b] - bc[a]; });
    if (ks.length) h += '<p class="note" data-testid="promo-by-code">' + esc(t('promo_by_code')) + ': ' + ks.map(function (k) { return esc(k) + ' ' + bc[k]; }).join(' · ') + '</p>';
    return h;
  }
  function renderAttention() {
    var n = (D.attention && D.attention.count) || 0, red = ((D.health && D.health.total) || {}).en_cart_currency_mismatch || 0;
    if (!n && !red) return '';
    return '<p class="alert" role="alert" data-testid="attention-banner">' + (n ? esc(t('health_attention').replace('{n}', n)) : '') + (red ? ' ' + esc(t('h_en_cart_currency_mismatch')) + ': ' + red : '') + '</p>';
  }

  // Ticket 7: the Relationship Map tool — its own numbers, and the Tool -> purchase funnel (counts only)
  function jstDay(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
  function inPer(day) {
    if (period === 'all') return true;
    var now = Date.parse(D.now), n = period === 'today' ? 1 : period === 'd7' ? 7 : 30;
    return day >= jstDay(now - (n - 1) * 86400000) && day <= jstDay(now);
  }
  var STEPS = ['measured', 'clicked', 'landed', 'started', 'created', 'free', 'paid'];
  var GROUPS = ['near', 'middle', 'far', 'unknown'];
  function GROUPLABEL(g) { return { near: t('tf_near'), middle: t('tf_middle'), far: t('tf_far'), unknown: t('tf_unknown') }[g]; }
  function stepName(i) { return [t('tf_s1'), t('tf_s2'), t('tf_s3'), t('tf_s4'), t('tf_s5'), t('tf_s6'), t('tf_s7')][i]; }
  function zero() { return { measured: 0, clicked: 0, landed: 0, started: 0, created: 0, free: 0, paid: 0 }; }
  function add(a, r) { STEPS.forEach(function (k) { a[k] += r[k] || 0; }); }
  function rateCell(c, k, i) {
    var prev = k === 'free' || k === 'paid' ? c.created : i > 0 ? c[STEPS[i - 1]] : 0;
    if (i === 0) return '';
    return prev > 0 ? pct(c[k], prev) + '%' + (k === 'free' || k === 'paid' ? ' (&larr;5)' : '') : '&mdash;';
  }
  // The tool's own numbers (Part B, 2026-11-23): every field it sends, per day (UTC) and language, a totals row for the period, the "how close do you feel" pairs as a 7 x 7 table
  function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function inUtc(day) {
    if (period === 'all') return true;
    var now = Date.parse(D.now), n = period === 'today' ? 1 : period === 'd7' ? 7 : 30;
    return day >= utcDay(now - (n - 1) * 86400000) && day <= utcDay(now);
  }
  function addTo(a, b) { for (var k in b) a[k] = (a[k] || 0) + b[k]; return a; }
  function listOf(o, fmt) {
    var ks = Object.keys(o || {}).sort(), out = [];
    ks.forEach(function (k) { if (o[k]) out.push(esc(fmt ? fmt(k) : k) + '&nbsp;' + num(o[k])); });
    return out.length ? out.join(' · ') : '&mdash;';
  }
  function groupLabel(g) { return { family: t('tm_g_family'), partner: t('tm_g_partner'), friends: t('tm_g_friends'), work: t('tm_g_work'), clients: t('tm_g_clients') }[g] || g; }
  function usd(n) { return '$' + (n > 0 && n < 0.1 ? n.toFixed(4) : n.toFixed(2)); }
  function sumLevels(a, b) { return a.map(function (x, i) { return x + (b[i] || 0); }); }
  function groupClicks(c) {
    var ks = Object.keys(c || {}).sort(), out = [];
    ks.forEach(function (k) { out.push(esc(k) + '&nbsp;' + num(c[k].near) + '/' + num(c[k].middle) + '/' + num(c[k].far)); });
    return out.length ? out.join(' · ') : '&mdash;';
  }
  function emptyTotal() { return { starts: 0, shots: 0, taps: 0, readings: 0, costUsd: 0, results: [0, 0, 0, 0, 0, 0, 0], noResult: 0, noResultBy: {}, mapped: null, placed: {}, warmOpens: 0, clicks: {}, clicksByGroup: {} }; }
  function addRow(t0, r) {
    t0.starts += r.starts; t0.shots += r.shots; t0.taps += r.taps; t0.readings += r.readings; t0.costUsd += r.costUsd; t0.noResult += r.noResult; t0.warmOpens += r.warmOpens;
    t0.results = sumLevels(t0.results, r.results); addTo(t0.noResultBy, r.noResultBy || {}); addTo(t0.placed, r.placed || {}); addTo(t0.clicks, r.clicks || {});
    if (r.mapped != null) t0.mapped = (t0.mapped || 0) + r.mapped;
    var g = r.clicksByGroup || {}; for (var k in g) { var c = t0.clicksByGroup[k] || (t0.clicksByGroup[k] = { near: 0, middle: 0, far: 0 }); c.near += g[k].near; c.middle += g[k].middle; c.far += g[k].far; }
  }
  function sum7(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function renderToolMap() {
    var T = D.tool || {}, m = T.map;
    var h = '<h2 data-testid="tool-map-title">' + esc(t('tm_title')) + '</h2>';
    if (!m) return h + '<p class="warn" data-testid="tool-unavailable">' + esc(t('tm_unavailable')) + '</p>';
    var rows = (m.rows || []).filter(function (r) { return inUtc(r.day); }).sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : a.lang < b.lang ? -1 : 1; });
    if (!rows.length) return h + '<p class="note" data-testid="tool-map-none">' + esc(t('tm_none')) + '</p>';
    var tot = emptyTotal(), felt = {};
    rows.forEach(function (r) { addRow(tot, r); addTo(felt, r.felt || {}); });
    var h1 = '<h2 style="font-size:.95rem">' + esc(t('tm_sub_readings')) + '</h2><div class="wide"><table data-testid="tool-map"><thead><tr><th>' + esc(t('tm_day')) + '</th><th>' + esc(t('tm_lang')) + '</th><th class="n">' + esc(t('tm_starts')) + '</th><th class="n">' + esc(t('tm_shots')) + '</th><th class="n">' + esc(t('tm_taps')) + '</th><th class="n">' + esc(t('tm_readings')) + '</th><th class="n">' + esc(t('tm_cost')) + '</th>';
    for (var i = 1; i <= 7; i++) h1 += '<th class="n">' + i + '</th>';
    h1 += '<th class="n">' + esc(t('tm_results_total')) + '</th></tr></thead><tbody>';
    function line1(label, lang, r, cls) {
      var x = '<tr' + (cls ? ' class="' + cls + '"' : '') + (label.day ? ' data-day="' + esc(label.day) + '" data-lang="' + esc(lang) + '"' : '') + '><td>' + (label.day ? esc(label.day) : '<b>' + esc(label.text) + '</b>') + '</td><td>' + esc(lang || '') + '</td><td class="n">' + num(r.starts) + '</td><td class="n">' + num(r.shots) + '</td><td class="n">' + num(r.taps) + '</td><td class="n">' + num(r.readings) + '</td><td class="n">' + usd(r.costUsd) + '</td>';
      for (var j = 0; j < 7; j++) x += '<td class="n">' + num(r.results[j] || 0) + '</td>';
      return x + '<td class="n"><b>' + num(sum7(r.results)) + '</b></td></tr>';
    }
    rows.forEach(function (r) { h1 += line1({ day: r.day }, r.lang, r); });
    h1 += line1({ text: t('tm_totals') }, '', tot, 'total') + '</tbody></table></div>';
    var h2 = '<h2 style="font-size:.95rem">' + esc(t('tm_sub_actions')) + '</h2><div class="wide"><table data-testid="tool-map-actions"><thead><tr><th>' + esc(t('tm_day')) + '</th><th>' + esc(t('tm_lang')) + '</th><th class="n">' + esc(t('tm_noresult')) + '</th><th>' + esc(t('tm_noresult_by')) + '</th><th class="n">' + esc(t('tm_mapped')) + '</th><th>' + esc(t('tm_mapped_by')) + '</th><th class="n">' + esc(t('tm_warm')) + '</th><th>' + esc(t('tm_clicks')) + '</th><th>' + esc(t('tm_clicks_group')) + '</th></tr></thead><tbody>';
    function line2(label, lang, r, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + (label.day ? ' data-day="' + esc(label.day) + '" data-lang="' + esc(lang) + '"' : '') + '><td>' + (label.day ? esc(label.day) : '<b>' + esc(label.text) + '</b>') + '</td><td>' + esc(lang || '') + '</td><td class="n">' + num(r.noResult) + '</td><td class="l">' + listOf(r.noResultBy) + '</td><td class="n">' + (r.mapped == null ? '&mdash;' : num(r.mapped)) + '</td><td class="l">' + listOf(r.placed, groupLabel) + '</td><td class="n">' + num(r.warmOpens) + '</td><td class="l">' + listOf(r.clicks) + '</td><td class="l">' + groupClicks(r.clicksByGroup) + '</td></tr>';
    }
    rows.forEach(function (r) { h2 += line2({ day: r.day }, r.lang, r); });
    h2 += line2({ text: t('tm_totals') }, '', tot, 'total') + '</tbody></table></div>';
    var fm = '<h2 style="font-size:.95rem">' + esc(t('tm_felt')) + '</h2><div class="wide"><table data-testid="tool-felt"><thead><tr><th>' + esc(t('tm_felt_row')) + '</th>';
    for (var c = 1; c <= 7; c++) fm += '<th class="n">' + c + '</th>';
    fm += '</tr></thead><tbody>';
    for (var a = 1; a <= 7; a++) { fm += '<tr data-sense="' + a + '"><td><b>' + a + '</b></td>'; for (var b = 1; b <= 7; b++) fm += '<td class="n" data-pair="' + a + '|' + b + '">' + num(felt[a + '|' + b] || 0) + '</td>'; fm += '</tr>'; }
    fm += '</tbody></table></div>';
    return h + h1 + h2 + fm + '<p class="note">' + esc(t('tm_utc_note')) + ' ' + esc(t('tm_note')) + '</p>';
  }

  // The saved-map emails (owner only): asked of the server on its own request when the page opens or the period changes — never part of the page's data, never in a link; the search and the CSV happen here in the browser
  var SV = { key: null, state: 'idle', list: [], q: '' };
  var DAYS = { today: 1, d7: 7, d30: 30, all: 0 };
  function csvCell(v) { var s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function yesNo(b) { return b ? t('sv_yes') : t('sv_no'); }
  function svShort(iso) { return iso ? String(iso).slice(0, 16).replace('T', ' ') : '—'; }
  function svFiltered() { var q = SV.q.trim().toLowerCase(); return SV.list.filter(function (r) { return !q || r.email.toLowerCase().indexOf(q) >= 0 || String(r.lang || '').toLowerCase().indexOf(q) >= 0; }); }
  function renderSaversShell() {
    var h = '<h2 data-testid="savers-title">' + esc(t('sv_title')) + '</h2><div id="savers"></div>';
    return h;
  }
  function drawSavers() {
    var el = document.getElementById('savers'); if (!el) return;
    if (SV.state === 'loading' || SV.state === 'idle') { el.innerHTML = '<p class="note" data-testid="savers-loading">' + esc(t('sv_loading')) + '</p>'; return; }
    if (SV.state === 'down') { el.innerHTML = '<p class="warn" data-testid="savers-unavailable">' + esc(t('sv_unavailable')) + '</p>'; return; }
    var rows = svFiltered();
    var h = '<p class="note" data-testid="savers-count"><b>' + esc(t('sv_count', { n: num(rows.length) })) + '</b>' + (rows.length !== SV.list.length ? ' / ' + num(SV.list.length) : '') + ' · ' + esc(t('sv_note')) + '</p>';
    h += '<p><input type="search" id="sv-q" data-testid="savers-search" value="' + esc(SV.q) + '" placeholder="' + esc(t('sv_search')) + '" aria-label="' + esc(t('sv_search')) + '" autocomplete="off" style="font:inherit;padding:.3rem .6rem;border:1px solid var(--line);border-radius:6px;min-width:15rem"> <button type="button" id="sv-csv" data-testid="savers-csv" style="font:inherit;padding:.3rem .8rem;border:1px solid var(--line);background:var(--card);border-radius:999px;cursor:pointer">' + esc(t('sv_csv')) + '</button></p>';
    if (!rows.length) { el.innerHTML = h + '<p class="note" data-testid="savers-none">' + esc(t('sv_none')) + '</p>'; bindSavers(); return; }
    h += '<div class="wide"><table data-testid="savers"><thead><tr><th>' + esc(t('sv_email')) + '</th><th>' + esc(t('sv_lang')) + '</th><th>' + esc(t('sv_first')) + '</th><th>' + esc(t('sv_last')) + '</th><th class="n">' + esc(t('sv_keymails')) + '</th><th>' + esc(t('sv_reminders')) + '</th><th>' + esc(t('sv_news')) + '</th></tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr data-testid="saver-row"><td class="notranslate">' + esc(r.email) + '</td><td>' + esc(r.lang || '') + '</td><td>' + esc(svShort(r.first)) + '</td><td>' + esc(svShort(r.last)) + '</td><td class="n">' + num(r.count) + '</td><td data-col="reminders">' + esc(yesNo(r.reminders)) + '</td><td data-col="news">' + esc(yesNo(r.news)) + '</td></tr>'; });
    el.innerHTML = h + '</tbody></table></div>';
    bindSavers();
  }
  function bindSavers() {
    var q = document.getElementById('sv-q');
    if (q) q.addEventListener('input', function () { SV.q = q.value; var pos = q.selectionStart; drawSavers(); var n = document.getElementById('sv-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } });
    var b = document.getElementById('sv-csv');
    if (b) b.addEventListener('click', function () {
      var rows = svFiltered();
      var lines = ['email,language,first_saved_utc,last_saved_utc,key_mails_sent,reminders,news'].concat(rows.map(function (r) { return [r.email, r.lang || '', r.first || '', r.last || '', r.count, r.reminders ? 'yes' : 'no', r.news ? 'yes' : 'no'].map(csvCell).join(','); }));
      var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'saved-map-emails.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }
  function loadSavers() {
    var key = period; if (SV.key === key && SV.state !== 'idle') { drawSavers(); return; }
    SV.key = key; SV.state = 'loading'; SV.list = []; drawSavers();
    fetch('/ops/stats/savers?days=' + DAYS[period], { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (SV.key !== key) return;
      if (j && j.ok && j.savers) { SV.list = j.savers; SV.state = 'ok'; } else SV.state = 'down';
      drawSavers();
    }).catch(function () { if (SV.key === key) { SV.state = 'down'; drawSavers(); } });
  }

  function renderToolFunnel() {
    var rows = ((D.tool && D.tool.funnel) || []).filter(function (r) { return inPer(r.day); });
    var by = { near: zero(), middle: zero(), far: zero(), unknown: zero() }, all = zero(), lng = { ja: zero(), en: zero(), zh: zero() }, days = {};
    rows.forEach(function (r) { add(by[r.group] || by.unknown, r); add(all, r); add(lng[r.lang] || lng.ja, r); var d = days[r.day] || (days[r.day] = zero()); add(d, r); });
    var cols = GROUPS.filter(function (g) { return g !== 'unknown' || STEPS.some(function (k) { return by.unknown[k] > 0; }); });
    var h = '<h2 data-testid="tool-funnel-title">' + esc(t('tf_title')) + '</h2>';
    h += '<p class="note" data-testid="tool-headline"><b>' + esc(t('tf_headline')) + ': ' + num(all.measured) + ' &rarr; ' + num(all.paid) + (all.measured > 0 ? ' (' + (Math.round((all.paid / all.measured) * 1000) / 10) + '%)' : '') + '</b></p>';
    h += '<div class="wide"><table data-testid="tool-funnel"><thead><tr><th>' + esc(t('tf_step')) + '</th>';
    cols.forEach(function (g) { h += '<th class="n">' + esc(GROUPLABEL(g)) + '</th>'; });
    h += '<th class="n">' + esc(t('tf_all')) + '</th><th class="n">' + esc(t('tf_rate')) + '</th></tr></thead><tbody>';
    STEPS.forEach(function (k, i) {
      h += '<tr data-step="' + k + '"><td>' + (i + 1) + '. ' + esc(stepName(i)) + '</td>';
      cols.forEach(function (g) { h += '<td class="n" data-group="' + g + '">' + num(by[g][k]) + '</td>'; });
      h += '<td class="n" data-group="all">' + num(all[k]) + '</td><td class="n">' + rateCell(all, k, i) + '</td></tr>';
    });
    h += '</tbody></table></div><p class="note">' + esc(t('tf_note')) + '</p>';
    h += '<h2 style="font-size:.95rem">' + esc(t('tf_by_lang')) + '</h2><div class="wide"><table data-testid="tool-funnel-lang"><thead><tr><th>' + esc(t('tm_lang')) + '</th>';
    STEPS.forEach(function (k, i) { h += '<th class="n">' + (i + 1) + '</th>'; });
    h += '</tr></thead><tbody>';
    ['ja', 'en', 'zh'].forEach(function (l) { h += '<tr data-lang="' + l + '"><td>' + l + '</td>' + STEPS.map(function (k) { return '<td class="n">' + num(lng[l][k]) + '</td>'; }).join('') + '</tr>'; });
    h += '</tbody></table></div>';
    var dk = Object.keys(days).sort().reverse().slice(0, 14);
    if (dk.length) {
      h += '<h2 style="font-size:.95rem">' + esc(t('tf_by_day')) + '</h2><div class="wide"><table data-testid="tool-funnel-day"><thead><tr><th>' + esc(t('tf_day')) + '</th>';
      STEPS.forEach(function (k, i) { h += '<th class="n">' + (i + 1) + '</th>'; });
      h += '</tr></thead><tbody>';
      dk.forEach(function (d) { h += '<tr data-day="' + esc(d) + '"><td>' + esc(d) + '</td>' + STEPS.map(function (k) { return '<td class="n">' + num(days[d][k]) + '</td>'; }).join('') + '</tr>'; });
      h += '</tbody></table></div>';
    }
    return h;
  }
  function render() {
    var s = D.stats.periods[period];
    document.documentElement.lang = lang === 'zh-Hant' ? 'zh-Hant' : lang === 'zh-Hans' ? 'zh-Hans' : lang;
    document.title = t('title');
    document.getElementById('title').textContent = t('title');
    var back = document.getElementById('back'); back.textContent = t('back_to_ops');
    var lh = '';
    D.langs.forEach(function (l) { lh += '<button type="button" data-lang="' + l + '" aria-pressed="' + (l === lang) + '" lang="' + l + '">' + esc(D.lang_names[l]) + '</button>'; });
    document.getElementById('langs').innerHTML = lh;
    var th = '';
    PERIODS.forEach(function (p) { th += '<button type="button" data-period="' + p + '" aria-pressed="' + (p === period) + '">' + esc(t('p_' + p)) + '</button>'; });
    document.getElementById('tabs').innerHTML = th;
    document.getElementById('app').innerHTML =
      renderPromo() + renderAttention() + (D.verified ? '' : '<p class="warn">' + esc(t('payments_unverified')) + '</p>') +
      renderNumbers(s) + '<p class="note">' + esc(t('cost_note')) + '</p>' + renderChoice(s) + renderFunnel(s) + renderToolFunnel() + renderToolMap() + renderSaversShell() + renderDaily(s) + renderSources(s) + renderHealth() + renderOrders() +
      '<p class="note">' + esc(t('privacy_note')) + '</p>';
    loadSavers();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.dataset.lang) { lang = b.dataset.lang; try { localStorage.setItem(KEY, lang); } catch (x) {} render(); }
    else if (b.dataset.period) { period = b.dataset.period; try { sessionStorage.setItem(PKEY, period); } catch (x) {} render(); }
  });
  render();
})();
`
