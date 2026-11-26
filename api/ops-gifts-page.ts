// The owner's gift maker page /ops/gifts/new (Ticket 8, 2026-11-25): the form, the finished gift (character, line, poem, four pictures, the receiver's link with a copy button) and the list of outreach
// gifts. Owner only (the same gate as /ops); no link to it exists anywhere on the site. Words in ja, en and zh-Hant (zh-Hans from it); the server sends them embedded, the script below draws them.
// Plain ES5-style JavaScript in one string: it builds the page with textContent (nothing the owner or the engine wrote is ever put in as HTML).

import { toSimplified } from '../engine/script.ts'

type Dict = Record<string, string>

const en: Dict = {
  title: 'Owner gift maker',
  sub: 'One moment becomes a finished free gift, from you. Nothing is sold, charged or e-mailed, and it is not counted as a customer order.',
  f_moment: 'The moment', f_moment_ph: 'One concrete scene, in the receiver\'s language…', f_language: 'Language', f_receiver: 'For', f_receiver_ph: 'e.g. Ms. Matsumoto', f_sender: 'From', f_style: 'Poem style', f_tag: 'Batch tag', f_tag_ph: 'e.g. outreach-2026-11',
  style_default: 'Default for the language', style_tanka: 'Tanka', style_haiku: 'Haiku', style_tang: 'Tang poem', style_ci: 'Song ci', style_en: 'Free verse',
  lang_ja: '日本語', lang_en: 'English', 'lang_zh-Hant': '繁體中文', 'lang_zh-Hans': '简体中文',
  make: 'Make the gift', making: 'Making the gift… this takes a minute or two.', again: 'Make another',
  done: 'The gift is made', char: 'Character', word: 'English word', line: 'Line', poem: 'Poem',
  pictures: 'Pictures', pic_ready: '{n} of 4 ready', pic_drawing: 'still being drawn… this page keeps looking', pic_failed: 'none could be drawn', pic_no_script: 'no pictures for this moment (a plain film)',
  link_receiver: 'Receiver\'s link', link_sender: 'Sender\'s page', copy: 'Copy', copied: 'Copied', open: 'Open',
  list: 'Outreach gifts', c_tag: 'Tag', c_receiver: 'For', c_char: 'Character', c_date: 'Date', c_opened: 'Opened', c_link: 'Link', yes: 'yes', no: 'no', none: 'No outreach gifts yet.', today: '{n} of {max} today',
  err_generic: 'The gift could not be made. Please try again.', err_needs_more: 'The moment needs one more concrete scene. {q}', err_limit: 'Today\'s owner gifts are all used.', err_auth: 'Please sign in again.', err_moment: 'Write the moment first.', err_poem: 'The poem could not be written. Try again.', err_engine: 'The engine could not read the moment. Try again.',
  note: 'Owner only. Not linked from anywhere.',
}
const ja: Dict = {
  title: '贈りもの作成（オーナー用）',
  sub: 'ひとつの瞬間から、あなたからの無料の贈りものを完成させます。販売・請求・メール送信はなく、お客様の注文には数えません。',
  f_moment: '瞬間', f_moment_ph: '具体的なひとつの場面を、受け取る方の言語で…', f_language: '言語', f_receiver: '宛先', f_receiver_ph: '例：松本先生', f_sender: '贈り主', f_style: '詩の形', f_tag: 'バッチ名', f_tag_ph: '例：outreach-2026-11',
  style_default: '言語の標準', style_tanka: '短歌', style_haiku: '俳句', style_tang: '漢詩', style_ci: '宋詞', style_en: '自由詩',
  lang_ja: '日本語', lang_en: 'English', 'lang_zh-Hant': '繁體中文', 'lang_zh-Hans': '简体中文',
  make: '贈りものを作る', making: '作っています… 1〜2分かかります。', again: 'もうひとつ作る',
  done: '贈りものができました', char: '一字', word: '英語のことば', line: '一行', poem: '詩',
  pictures: '絵', pic_ready: '4枚中{n}枚できました', pic_drawing: '描いている途中です… このページが見守ります', pic_failed: '描けませんでした', pic_no_script: 'この瞬間の絵はありません（絵のない映像です）',
  link_receiver: '受け取る人のリンク', link_sender: '贈る人のページ', copy: 'コピー', copied: 'コピーしました', open: '開く',
  list: 'アウトリーチの贈りもの', c_tag: 'タグ', c_receiver: '宛先', c_char: '一字', c_date: '日付', c_opened: '開封', c_link: 'リンク', yes: 'はい', no: 'いいえ', none: 'まだありません。', today: '本日 {n}／{max}',
  err_generic: '贈りものを作れませんでした。もう一度お試しください。', err_needs_more: '瞬間に、もうひとつ具体的な場面が必要です。{q}', err_limit: '本日の上限に達しました。', err_auth: 'もう一度ログインしてください。', err_moment: '先に瞬間を書いてください。', err_poem: '詩を書けませんでした。もう一度お試しください。', err_engine: '瞬間を読み取れませんでした。もう一度お試しください。',
  note: 'オーナー専用。どこからもリンクされていません。',
}
const zhHant: Dict = {
  title: '贈禮製作（站主專用）',
  sub: '把一個瞬間做成一份完整的免費禮物，由你送出。不販售、不收費、不寄信，也不計入客人的訂單。',
  f_moment: '瞬間', f_moment_ph: '一個具體的場景，用收禮人的語言…', f_language: '語言', f_receiver: '收禮人', f_receiver_ph: '例如：松本老師', f_sender: '送禮人', f_style: '詩的形式', f_tag: '批次標籤', f_tag_ph: '例如：outreach-2026-11',
  style_default: '依語言預設', style_tanka: '短歌', style_haiku: '俳句', style_tang: '唐詩', style_ci: '宋詞', style_en: '自由詩',
  lang_ja: '日本語', lang_en: 'English', 'lang_zh-Hant': '繁體中文', 'lang_zh-Hans': '简体中文',
  make: '製作禮物', making: '正在製作… 需要一兩分鐘。', again: '再做一份',
  done: '禮物完成了', char: '字', word: '英文單詞', line: '一句', poem: '詩',
  pictures: '圖畫', pic_ready: '4 張中已完成 {n} 張', pic_drawing: '還在繪製中… 本頁會持續查看', pic_failed: '沒有畫成', pic_no_script: '這個瞬間沒有圖畫（純文字影片）',
  link_receiver: '收禮人的連結', link_sender: '送禮人的頁面', copy: '複製', copied: '已複製', open: '開啟',
  list: '外聯禮物', c_tag: '標籤', c_receiver: '收禮人', c_char: '字', c_date: '日期', c_opened: '已開啟', c_link: '連結', yes: '是', no: '否', none: '還沒有。', today: '今天 {n}／{max}',
  err_generic: '禮物沒有做成，請再試一次。', err_needs_more: '這個瞬間還需要再多一個具體的場景。{q}', err_limit: '今天的額度已用完。', err_auth: '請重新登入。', err_moment: '請先寫下瞬間。', err_poem: '詩沒有寫成，請再試一次。', err_engine: '無法讀取這個瞬間，請再試一次。',
  note: '僅限站主。沒有任何連結指向這裡。',
}
const zhHans: Dict = Object.fromEntries(Object.entries(zhHant).map(([k, v]) => [k, k.startsWith('lang_') ? v : toSimplified(v)]))

export const OWNER_GIFT_DICT: Record<string, Dict> = { en, ja, 'zh-Hant': zhHant, 'zh-Hans': zhHans }
export const OWNER_GIFT_KEYS = Object.keys(en)

const CSS = `:root{--bg:#efe6d2;--ink:#2a221b;--card:#fff;--line:#d7ccb4;--soft:#8a8070;--accent:#b7410e}
*{box-sizing:border-box}body{font:15px/1.6 system-ui,'Hiragino Sans','Noto Sans JP','Noto Sans TC',sans-serif;margin:0;color:var(--ink);background:var(--bg)}
header{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;border-bottom:1px solid var(--line)}
h1{font-size:1.25rem;margin:0;font-weight:600}h2{font-size:1.05rem;margin:1.8rem 0 .6rem;font-weight:600}
main{padding:0 1.2rem 3rem;max-width:960px;margin:0 auto}
.langs{display:flex;gap:.3rem;flex-wrap:wrap}.langs button{font:inherit;padding:.25rem .7rem;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;cursor:pointer}
.langs button[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.note{color:var(--soft);font-size:.85rem}
form{display:grid;gap:.8rem;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem}
label{display:grid;gap:.25rem;font-size:.85rem;color:var(--soft)}
textarea,input,select{font:inherit;color:var(--ink);padding:.45rem .6rem;border:1px solid var(--line);border-radius:6px;background:#fff;width:100%}
textarea{min-height:9rem;resize:vertical}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.8rem}
button.go{font:inherit;font-weight:600;padding:.6rem 1.2rem;border:0;border-radius:999px;background:var(--accent);color:#fff;cursor:pointer;justify-self:start}
button.go[disabled]{opacity:.5;cursor:default}
button.sm{font:inherit;font-size:.85rem;padding:.2rem .7rem;border:1px solid var(--line);background:var(--card);border-radius:999px;cursor:pointer}
#status{min-height:1.5rem;margin:.6rem 0}#status.err{color:#8e1f14;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem;display:grid;gap:.7rem}
.glyph{font-size:4rem;line-height:1;font-family:'Hiragino Mincho ProN','Noto Serif JP','Noto Serif TC',serif}
.pics{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}.pics img,.pics div{width:100%;aspect-ratio:4/5;object-fit:cover;border:1px solid var(--line);border-radius:4px;background:#e8dfca}
.linkrow{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.linkrow input{flex:1 1 18rem;font-size:.85rem}
.poem{white-space:pre-line;font-family:'Hiragino Mincho ProN','Noto Serif JP','Noto Serif TC',serif}
table{border-collapse:collapse;width:100%;background:var(--card)}th,td{border:1px solid var(--line);padding:.3rem .5rem;text-align:left;font-size:.88rem}.wide{overflow-x:auto}
@media(max-width:560px){.pics{grid-template-columns:repeat(2,1fr)}header{padding:.7rem 1rem}main{padding:0 1rem 3rem}}`

const jsonForScript = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const CLIENT_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('d').textContent);
  var KEY = 'ichirei-owner-gifts-lang', lang = 'en';
  try { var s = localStorage.getItem(KEY); if (D.langs.indexOf(s) >= 0) lang = s; } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  function t(k, v) { var s = (D.dict[lang] || {})[k]; if (s === undefined) s = D.dict.en[k]; if (s === undefined) return ''; if (v) for (var n in v) s = s.split('{' + n + '}').join(v[n]); return s; }
  function el(tag, props, kids) { var e = document.createElement(tag); if (props) for (var k in props) { if (k === 'text') e.textContent = props[k]; else e.setAttribute(k, props[k]); } (kids || []).forEach(function (c) { if (c) e.appendChild(c); }); return e; }
  var made = null, polling = null, busy = false, today = null, statusKey = null, statusErr = false;
  function setStatus(key, err, v) { statusKey = key ? [key, v] : null; statusErr = !!err; var s = $('status'); s.textContent = key ? t(key, v) : ''; s.className = err ? 'err' : ''; }
  function chrome() {
    document.documentElement.setAttribute('lang', lang);
    document.title = t('title'); $('title').textContent = t('title'); $('sub').textContent = t('sub'); $('note').textContent = t('note');
    var lb = $('langs'); lb.textContent = '';
    D.langs.forEach(function (l) { var b = el('button', { type: 'button', 'data-lang': l, 'aria-pressed': String(l === lang), text: D.names[l] }); lb.appendChild(b); });
    ['moment', 'language', 'receiver', 'sender', 'style', 'tag'].forEach(function (k) { $('l_' + k).firstChild.textContent = t('f_' + k); });
    $('moment').setAttribute('placeholder', t('f_moment_ph')); $('receiver').setAttribute('placeholder', t('f_receiver_ph')); $('tag').setAttribute('placeholder', t('f_tag_ph'));
    ['ja', 'en', 'zh-Hant', 'zh-Hans'].forEach(function (l) { $('opt_' + l).textContent = t('lang_' + l); });
    ['default', 'tanka', 'haiku', 'tang', 'ci', 'en'].forEach(function (k) { $('sty_' + k).textContent = t('style_' + k); });
    $('make').textContent = t('make'); $('list_title').textContent = t('list');
    if (statusKey) $('status').textContent = t(statusKey[0], statusKey[1]);
  }
  function copyBtn(inputEl) {
    var b = el('button', { type: 'button', class: 'sm', 'data-testid': 'copy', text: t('copy') });
    b.addEventListener('click', function () {
      var v = inputEl.value;
      var done = function () { b.textContent = t('copied'); setTimeout(function () { b.textContent = t('copy'); }, 1500); };
      try { navigator.clipboard.writeText(v).then(done, function () { inputEl.select(); document.execCommand('copy'); done(); }); } catch (e) { inputEl.select(); try { document.execCommand('copy'); } catch (x) {} done(); }
    });
    return b;
  }
  function linkRow(label, url, testid) {
    var inp = el('input', { type: 'text', readonly: 'readonly', value: url, 'data-testid': testid, 'aria-label': label });
    return el('div', null, [el('div', { class: 'note', text: label }), el('div', { class: 'linkrow' }, [inp, copyBtn(inp), el('a', { href: url, target: '_blank', rel: 'noopener', text: t('open') })])]);
  }
  function picState(g) {
    if (g.pictures_state === 'ready') return t('pic_ready', { n: g.pictures_drawn });
    if (g.pictures_state === 'failed') return t('pic_failed');
    if (g.pictures_state === 'no_script') return t('pic_no_script');
    return t('pic_drawing');
  }
  function drawResult() {
    var box = $('result'); box.textContent = '';
    if (!made) return;
    var g = made;
    var pics = el('div', { class: 'pics', 'data-testid': 'result-pictures' }, [0, 1, 2, 3].map(function (i) { return g.picture_urls[i] ? el('img', { src: g.picture_urls[i], alt: '', 'data-testid': 'result-picture' }) : el('div', { 'data-testid': 'result-picture-pending' }); }));
    var card = el('div', { class: 'card', 'data-testid': 'result-card' }, [
      el('h2', { text: t('done'), style: 'margin:0' }),
      el('div', null, [el('div', { class: 'note', text: t('char') }), el('div', { class: 'glyph', 'data-testid': 'result-glyph', text: g.glyph }), el('div', { 'data-testid': 'result-reading', text: g.reading }), g.en_word ? el('div', { 'data-testid': 'result-en-word', text: t('word') + ': ' + g.en_word }) : null]),
      el('div', null, [el('div', { class: 'note', text: t('line') }), el('div', { 'data-testid': 'result-line', text: g.line })]),
      g.poem ? el('div', null, [el('div', { class: 'note', text: t('poem') }), el('div', { class: 'poem', 'data-testid': 'result-poem', text: g.poem.lines.join('\n') })]) : null,
      el('div', null, [el('div', { class: 'note', text: t('pictures') + ' — ' + picState(g) }), pics]),
      linkRow(t('link_receiver'), g.receiver_link, 'result-receiver-link'),
      linkRow(t('link_sender'), g.sender_page, 'result-sender-page'),
    ]);
    box.appendChild(card);
  }
  function drawList(rows) {
    var box = $('list'); box.textContent = '';
    if (!rows.length) { box.appendChild(el('p', { class: 'note', 'data-testid': 'list-none', text: t('none') })); return; }
    var head = el('tr', null, ['c_tag', 'c_receiver', 'c_char', 'c_date', 'c_opened', 'c_link'].map(function (k) { return el('th', { text: t(k) }); }));
    var body = rows.map(function (r) {
      var inp = el('input', { type: 'hidden', value: r.receiver_link });
      var cp = copyBtn(inp);
      return el('tr', { 'data-testid': 'list-row', 'data-id': r.id }, [
        el('td', { text: r.tag || '—' }), el('td', { text: r.receiver || '—' }), el('td', { text: r.glyph + (r.reading ? ' ' + r.reading : '') }),
        el('td', { text: String(r.created_at).slice(0, 16).replace('T', ' ') }), el('td', { 'data-col': 'opened', text: r.opened ? t('yes') : t('no') }), el('td', null, [inp, cp]),
      ]);
    });
    box.appendChild(el('div', { class: 'wide' }, [el('table', { 'data-testid': 'list' }, [el('thead', null, [head]), el('tbody', null, body)])]));
  }
  function loadList() {
    fetch('/ops/api/gifts', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      today = j.today; if (today) $('today').textContent = t('today', { n: today.n, max: today.max });
      drawList(j.gifts || []);
    }).catch(function () {});
  }
  function stopPoll() { if (polling) { clearTimeout(polling); polling = null; } }
  function poll(id, n) {
    stopPoll();
    if (!made || made.id !== id || made.pictures_state !== 'drawing' || n > 40) return;
    polling = setTimeout(function () {
      fetch('/ops/api/gifts/' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && made && made.id === id) { made = j; drawResult(); loadList(); }
        poll(id, n + 1);
      }).catch(function () { poll(id, n + 1); });
    }, 6000);
  }
  function errKey(code, status) {
    if (status === 401 || status === 403) return 'err_auth';
    if (code === 'daily_limit') return 'err_limit';
    if (code === 'moment_needs_more') return 'err_needs_more';
    if (code === 'missing_moment') return 'err_moment';
    if (code === 'poem_failed') return 'err_poem';
    if (code === 'engine_failed') return 'err_engine';
    return 'err_generic';
  }
  function make(ev) {
    ev.preventDefault();
    if (busy) return;
    var moment = $('moment').value.trim();
    if (!moment) { setStatus('err_moment', true); return; }
    busy = true; $('make').disabled = true; made = null; stopPoll(); drawResult(); setStatus('making', false);
    var body = { moment: moment, language: $('language').value, receiver: $('receiver').value.trim(), sender: $('sender').value.trim(), poem_style: $('style').value, tag: $('tag').value.trim() };
    fetch('/ops/api/gifts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (x) {
        busy = false; $('make').disabled = false;
        if (x.ok && x.j && x.j.receiver_link) { made = x.j; setStatus(null); drawResult(); loadList(); poll(made.id, 0); return; }
        setStatus(errKey(x.j && x.j.code, x.status), true, { q: (x.j && x.j.follow_up_question) || '' });
      })
      .catch(function () { busy = false; $('make').disabled = false; setStatus('err_generic', true); });
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('#langs button') : null;
    if (b) { lang = b.getAttribute('data-lang'); try { localStorage.setItem(KEY, lang); } catch (e) {} chrome(); drawResult(); loadList(); }
  });
  $('f').addEventListener('submit', make);
  chrome(); loadList();
})();
`

/** The page: the form, an empty result, an empty list (the script fills them). The owner gate has already been passed. */
export function ownerGiftsPage(): string {
  const data = { langs: ['en', 'ja', 'zh-Hant', 'zh-Hans'], names: { en: 'English', ja: '日本語', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文' }, dict: OWNER_GIFT_DICT }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${en.title}</title><style>${CSS}</style></head><body>` +
    `<header><h1 id="title">${en.title}</h1><div class="langs" id="langs" role="group" aria-label="language"></div></header>` +
    `<main><p class="note" id="sub"></p>` +
    `<form id="f" data-testid="gift-form" autocomplete="off">` +
    `<label id="l_moment"><span></span><textarea id="moment" name="moment" data-testid="gift-moment"></textarea></label>` +
    `<div class="row">` +
    `<label id="l_language"><span></span><select id="language" name="language" data-testid="gift-language"><option id="opt_ja" value="ja"></option><option id="opt_en" value="en"></option><option id="opt_zh-Hant" value="zh-Hant"></option><option id="opt_zh-Hans" value="zh-Hans"></option></select></label>` +
    `<label id="l_receiver"><span></span><input id="receiver" name="receiver" maxlength="20" data-testid="gift-receiver"></label>` +
    `<label id="l_sender"><span></span><input id="sender" name="sender" maxlength="20" value="Brian" data-testid="gift-sender"></label>` +
    `</div><div class="row">` +
    `<label id="l_style"><span></span><select id="style" name="poem_style" data-testid="gift-style"><option id="sty_default" value="default"></option><option id="sty_tanka" value="tanka"></option><option id="sty_haiku" value="haiku"></option><option id="sty_tang" value="tang"></option><option id="sty_ci" value="ci"></option><option id="sty_en" value="en"></option></select></label>` +
    `<label id="l_tag"><span></span><input id="tag" name="tag" maxlength="40" data-testid="gift-tag"></label>` +
    `</div><button class="go" type="submit" id="make" data-testid="gift-make"></button></form>` +
    `<div id="status" role="status" aria-live="polite" data-testid="gift-status"></div><div id="result"></div>` +
    `<h2 id="list_title"></h2><p class="note" id="today" data-testid="gift-today"></p><div id="list"></div><p class="note" id="note"></p></main>` +
    `<script type="application/json" id="d">${jsonForScript(data)}</script><script>${CLIENT_JS}</script></body></html>`
}
