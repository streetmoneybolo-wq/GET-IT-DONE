/* ARTICLE DESK (owner only): a toolbar button that opens the desk. Type a ticker or a market topic, press WRITE, and the
   desk reads everything the Academy knows about the name (the insights, the smart-money intent, the short and earnings
   reads, the dark pool, the filings, the headlines), writes the piece with its live chart and modules, and hands back
   three things to copy into a Loop Letter: the article HTML, its CSS, and the SEO head (meta tags and JSON-LD). A
   preview renders the finished page in a sandboxed frame. WRITE + FILE also files the piece as a draft letter under
   the byline. The button shows once the server confirms the owner account; the route refuses everyone else. */
(function boot(tries) {
  if (window.__smlArticleDesk) return;
  var toolbar = document.querySelector('.toolbar');
  if (!toolbar) { if (tries < 120) setTimeout(function () { boot(tries + 1); }, 200); return; }
  window.__smlArticleDesk = true;
  var NL = String.fromCharCode(10);
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var token = function () { return String(window.smlAcademySessionToken || ''); };
  var S = { owner: false, open: false, busy: false, result: null, tab: 'preview', checked: '' };
  var css = document.createElement('style');
  css.textContent = '#article-btn{display:none;margin-left:4px;padding:5px 9px;border:1px solid #3d5a2a;border-radius:7px;background:#14230f;color:#b9f08a;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#article-btn.on{background:#1f3a14;color:#dcffb8}'
    + '#article-panel{position:fixed;top:50px;right:10px;z-index:2147483150;width:min(980px,calc(100vw - 20px));max-height:calc(100dvh - 64px);display:none;flex-direction:column;background:#0b141c;border:1px solid #3d5a2a;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);color:#dfe9ee;font:600 .68rem system-ui,sans-serif}#article-panel.open{display:flex}'
    + '#article-panel header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #1b3540;flex:none}#article-panel header b{font:900 .78rem ui-monospace,monospace;letter-spacing:.06em;color:#b9f08a}#article-panel header input{flex:1 1 160px;min-width:120px;padding:6px 9px;border:1px solid #294554;border-radius:7px;background:#0e1a24;color:#fff;font:800 .72rem ui-monospace,monospace;text-transform:uppercase}'
    + '#article-panel header button{padding:6px 10px;border:1px solid #294554;border-radius:7px;background:#132019;color:#dfe9ee;font:800 .62rem ui-monospace,monospace;letter-spacing:.04em;cursor:pointer}#article-panel header button.go{background:linear-gradient(180deg,#22ff77,#00b84a);color:#03140a;border:0}#article-panel header button:disabled{opacity:.5;cursor:wait}#article-panel header .x{margin-left:auto;background:transparent;border:0;color:#8fa6b3;font-size:1rem}'
    + '#article-panel .st{padding:6px 12px;color:#8fa6b3;font:700 .6rem ui-monospace,monospace;border-bottom:1px solid #13262f;min-height:26px}#article-panel .st .bar{display:inline-block;vertical-align:middle;width:120px;height:6px;margin-left:8px;border-radius:3px;background:#13262f;overflow:hidden}#article-panel .st .bar i{display:block;height:100%;width:30%;background:#52e6ad;animation:ad-slide 1.4s infinite}@keyframes ad-slide{0%{margin-left:-30%}100%{margin-left:100%}}'
    + '#article-panel .meta{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;border-bottom:1px solid #13262f;color:#c7d5dc}#article-panel .meta b{color:#fff}#article-panel .meta a{color:#8ee8c1}'
    + '#article-panel .tabs{display:flex;gap:4px;padding:6px 10px 0;border-bottom:1px solid #13262f}#article-panel .tabs button{padding:6px 10px;border:1px solid #1b3540;border-bottom:0;border-radius:7px 7px 0 0;background:#0e1a24;color:#8fa6b3;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#article-panel .tabs button.on{background:#14230f;color:#dcffb8;border-color:#3d5a2a}'
    + '#article-panel .body{flex:1 1 auto;min-height:260px;overflow:auto;display:flex;flex-direction:column}#article-panel .pane{display:none;flex:1 1 auto;flex-direction:column;min-height:0}#article-panel .pane.on{display:flex}#article-panel .pane .bar2{display:flex;gap:6px;align-items:center;padding:6px 10px;border-bottom:1px solid #13262f;color:#8fa6b3}#article-panel .pane .bar2 button{padding:5px 9px;border:1px solid #294554;border-radius:6px;background:#132019;color:#dfe9ee;font:800 .58rem ui-monospace,monospace;cursor:pointer}#article-panel .pane .bar2 button.done{border-color:#52e6ad;color:#52e6ad}'
    + '#article-panel textarea{flex:1 1 auto;min-height:240px;width:100%;resize:none;border:0;padding:10px;background:#07101a;color:#c7e8d6;font:500 .62rem ui-monospace,monospace;line-height:1.45;white-space:pre;overflow:auto}#article-panel .frame{flex:1 1 auto;min-height:420px;border:0;background:#0b1119;width:100%}'
    + '#article-panel .note{padding:6px 12px;color:#7f98a6;font:600 .56rem system-ui,sans-serif;border-top:1px solid #13262f}'
    + '@media(max-width:720px){#article-panel{top:auto;bottom:6px;left:6px;right:6px;width:auto;max-height:82vh}}';
  document.head.appendChild(css);
  var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'article-btn'; btn.textContent = 'ARTICLE'; btn.title = 'Article Desk: write a market news piece on a ticker or a topic from the Academy data, with its live chart, modules, HTML, CSS and SEO head (owner)'; toolbar.appendChild(btn);
  var panel = document.createElement('section'); panel.id = 'article-panel'; panel.setAttribute('aria-label', 'Article Desk');
  panel.innerHTML = '<header><b>ARTICLE DESK</b><input type="text" data-subject="1" placeholder="Ticker or topic (NVDA, oil, the fed)" maxlength="40"><button type="button" class="go" data-write="1">WRITE</button><button type="button" data-file="1" title="Write and file it as a Loop Letter draft under the byline">WRITE + FILE</button><button type="button" class="x" data-close="1" aria-label="Close">&times;</button></header>'
    + '<div class="st"></div><div class="meta"></div>'
    + '<div class="tabs"><button type="button" data-tab="preview" class="on">PREVIEW</button><button type="button" data-tab="html">HTML</button><button type="button" data-tab="css">CSS</button><button type="button" data-tab="head">SEO HEAD</button><button type="button" data-tab="page">FULL PAGE</button></div>'
    + '<div class="body"><div class="pane on" data-pane="preview"></div>'
    + '<div class="pane" data-pane="html"><div class="bar2"><span>The article: paste into a Loop Letter custom code block (or the HTML block). The chart and modules are inside.</span><button type="button" data-copy="html">COPY HTML</button><button type="button" data-dl="html">DOWNLOAD</button></div><textarea readonly spellcheck="false"></textarea></div>'
    + '<div class="pane" data-pane="css"><div class="bar2"><span>The stylesheet: paste into the custom code block CSS field.</span><button type="button" data-copy="css">COPY CSS</button><button type="button" data-dl="css">DOWNLOAD</button></div><textarea readonly spellcheck="false"></textarea></div>'
    + '<div class="pane" data-pane="head"><div class="bar2"><span>The SEO head: title, description, canonical, Open Graph, Twitter, NewsArticle + FAQPage + Breadcrumb JSON-LD.</span><button type="button" data-copy="head">COPY HEAD</button><button type="button" data-dl="head">DOWNLOAD</button></div><textarea readonly spellcheck="false"></textarea></div>'
    + '<div class="pane" data-pane="page"><div class="bar2"><span>The whole page as one file.</span><button type="button" data-copy="page">COPY PAGE</button><button type="button" data-dl="page">DOWNLOAD .HTML</button></div><textarea readonly spellcheck="false"></textarea></div></div>'
    + '<div class="note">Everything here is drawn from the Academy data desk at the moment you press WRITE. The piece labels its speculation, argues against itself and names the line that proves it wrong. Not financial advice.</div>';
  document.body.appendChild(panel);
  var el = { st: panel.querySelector('.st'), meta: panel.querySelector('.meta'), input: panel.querySelector('[data-subject]'), write: panel.querySelector('[data-write]'), file: panel.querySelector('[data-file]'), preview: panel.querySelector('[data-pane="preview"]') };
  var pane = function (k) { return panel.querySelector('[data-pane="' + k + '"]'); };
  var area = function (k) { var p = pane(k); return p ? p.querySelector('textarea') : null; };
  var frame = null;

  function status(text, busy) { el.st.innerHTML = esc(text) + (busy ? '<span class="bar"><i></i></span>' : ''); }
  function setTab(k) { S.tab = k; panel.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === k); }); panel.querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === k); }); }
  function symbolOnPage() { var i = document.getElementById('symbol'); return i && i.value ? String(i.value).toUpperCase() : ''; }
  function openPanel() { S.open = true; panel.classList.add('open'); btn.classList.add('on'); if (!el.input.value) el.input.value = symbolOnPage(); el.input.focus(); }
  function closePanel() { S.open = false; panel.classList.remove('open'); btn.classList.remove('on'); }

  function packageOf(r) { return r && r.article ? r.article : null; }
  function paint(r) {
    S.result = r;
    var a = packageOf(r);
    if (!a) { el.meta.innerHTML = ''; return; }
    var filed = r.filed || null;
    el.meta.innerHTML = '<span><b>' + esc(a.title) + '</b></span><span>' + esc(String(r.story && r.story.angle || '')) + ' · ' + esc(String(a.lean || '')) + ' · PT $' + esc(a.pt) + ' (' + (a.ptPct >= 0 ? '+' : '') + esc(a.ptPct) + '%)</span><span>' + esc(a.wordCount) + ' words · ' + esc(a.readMinutes) + ' min</span><span>' + esc((a.modules || []).length) + ' modules · ' + esc((a.links || []).length) + ' links</span>'
      + (filed ? '<span>' + (filed.error ? 'filing failed: ' + esc(filed.error) : (filed.published ? 'published' : 'draft filed') + (filed.url ? ' · <a href="' + esc(filed.url) + '" target="_blank" rel="noopener">open the letter</a>' : '')) + '</span>' : '')
      + (r.dossier ? '<span title="which Academy reads were available for this piece">reads: ' + esc(Object.keys(r.dossier).filter(function (k) { return r.dossier[k]; }).join(', ')) + '</span>' : '');
    area('html').value = a.html || ''; area('css').value = a.css || ''; area('head').value = a.head || ''; area('page').value = a.document || '';
    el.preview.innerHTML = '';
    frame = document.createElement('iframe'); frame.className = 'frame'; frame.setAttribute('sandbox', 'allow-scripts allow-popups'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.title = 'Article preview';
    frame.srcdoc = a.document || '';
    el.preview.appendChild(frame);
    setTab('preview');
  }

  async function api(path, body) {
    var t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    try {
      var res = await fetch('/academy-activity/articles' + (path || ''), { method: body ? 'POST' : 'GET', headers: Object.assign({ authorization: 'Bearer ' + t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      var j = await res.json().catch(function () { return null; });
      return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' });
    } catch (e) { return { ok: false, error: 'network' }; }
  }
  async function write(file) {
    if (S.busy) return;
    var subject = String(el.input.value || '').trim();
    if (!subject) { status('Type a ticker or a topic first.'); el.input.focus(); return; }
    S.busy = true; el.write.disabled = true; el.file.disabled = true;
    status((file ? 'Writing and filing ' : 'Writing ') + subject.toUpperCase() + ': reading the Academy desks, drawing the chart, composing the piece (20 to 60 seconds)', true);
    var t0 = Date.now();
    var r = await api('/write', { symbol: subject, file: !!file, publish: false });
    S.busy = false; el.write.disabled = false; el.file.disabled = false;
    if (!r.ok) {
      var why = r.error === 'no_data' ? 'no price history for that name' : r.error === 'no_angle' ? 'no setup strong enough to write about right now (the desk would rather publish nothing)' : r.error === 'invalid_symbol' ? 'that is not a ticker or a topic the desk knows' : r.error === 'owner_only' ? 'owner account only' : r.error === 'story_desk_off' ? 'the Article Desk is switched off on the server' : (r.error || 'failed');
      status('Could not write ' + subject.toUpperCase() + ': ' + why + '.');
      return;
    }
    paint(r);
    status('Done in ' + Math.round((Date.now() - t0) / 1000) + ' s. ' + (file ? (r.filed && r.filed.url ? 'Filed as a draft letter.' : 'Composed; filing did not return a URL.') : 'Composed. Copy the HTML, the CSS and the SEO head from the tabs.'));
  }
  function copy(k, b) {
    var a = area(k); if (!a) return;
    var done = function () { b.classList.add('done'); var was = b.textContent; b.textContent = 'COPIED'; setTimeout(function () { b.classList.remove('done'); b.textContent = was; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(a.value).then(done, function () { a.focus(); a.select(); }); } else { a.focus(); a.select(); try { document.execCommand('copy'); done(); } catch (e) { /* the text is selected */ } }
  }
  function download(k) {
    var a = area(k), r = S.result; if (!a || !r) return;
    var name = (r.article && r.article.slug ? r.article.slug : 'article') + (k === 'css' ? '.css' : k === 'head' ? '-head.html' : k === 'page' ? '.html' : '-article.html');
    var blob = new Blob([a.value], { type: k === 'css' ? 'text/css' : 'text/html' });
    var u = URL.createObjectURL(blob), link = document.createElement('a'); link.href = u; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }

  btn.addEventListener('click', function () { if (S.open) closePanel(); else openPanel(); });
  panel.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
    if (t.dataset.close) closePanel();
    else if (t.dataset.write) write(false);
    else if (t.dataset.file) write(true);
    else if (t.dataset.tab) setTab(t.dataset.tab);
    else if (t.dataset.copy) copy(t.dataset.copy, t);
    else if (t.dataset.dl) download(t.dataset.dl);
  });
  el.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); write(false); } });

  /* the button shows only for the owner: the status route answers 200 for the owner and 403 for everyone else */
  async function check() {
    var t = token(); if (!t || S.checked === t) return; S.checked = t;
    var r = await api('');
    S.owner = !!(r && r.ok);
    btn.style.display = S.owner ? 'inline-block' : 'none';
    if (S.owner && r.day) status('Desk ready. Today: ' + (r.count || 0) + ' filed.' + (r.log && r.log[0] ? ' Last: ' + String(r.log[0].text || '').slice(0, 90) : ''));
  }
  check();
  window.addEventListener('sml-academy-session', check);
  setInterval(check, 15000);
  window.smlArticleDesk = { open: openPanel, close: closePanel, write: write, state: function () { return { owner: S.owner, open: S.open, busy: S.busy, title: S.result && S.result.article ? S.result.article.title : '' }; } };
})(0);
