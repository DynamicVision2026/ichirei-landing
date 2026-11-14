// The browser half of /ops/stats: draws every number from the embedded data with the words of the chosen language. No network call, no third party. The language
// is remembered in localStorage (inside try/catch); data values (characters, order numbers, amounts) never change with the language, the words around them do.
// The script is plain ES5-style JavaScript held in one string (the server sends it inline).

export const STATS_CLIENT_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('d').textContent);
  var KEY = 'ichirei-stats-lang', PKEY = 'ichirei-stats-period';
  var PERIODS = ['today', 'd7', 'd30', 'all'];
  var lang = 'ja', period = 'today';
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
  function money(o) { return yen(o.price_jpy) + (o.price_buyer ? ' (' + buyerAmt(o.price_buyer) + ')' : ''); }
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
    var SRC = ['direct', 'instagram', 'facebook', 'x', 'line', 'xhs', 'other'], LG = [['ja', 'lang_ja'], ['zh-Hant', 'lang_zh'], ['en', 'lang_en']];
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
      (D.verified ? '' : '<p class="warn">' + esc(t('payments_unverified')) + '</p>') +
      renderNumbers(s) + '<p class="note">' + esc(t('cost_note')) + '</p>' + renderChoice(s) + renderFunnel(s) + renderDaily(s) + renderSources(s) + renderOrders() +
      '<p class="note">' + esc(t('privacy_note')) + '</p>';
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
