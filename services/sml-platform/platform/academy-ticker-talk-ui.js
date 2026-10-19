/* Ticker Talk: the comment section for the ticker on the chart. A TALK button in the chart toolbar shows how many comments the
   ticker has. Open, the section takes the quote column right under the share price and change line: everything else in that
   column (book, tape, depth, meta) steps aside while it is open, and the column widens when the screen has room. The composer
   is one compact bar; tapping it opens a big editor. Double-tapping a comment (or its expand button) opens the whole comment
   in a big reader with its pictures, cards and replies. The list is endless: it pages back by id as you scroll, picks up new
   comments every 45 s, and off-screen comments are not laid out (content-visibility). Members write with "# heading", **bold**,
   $TICKER cashtags (tap to load that chart), @mentions (type @ and pick), pictures, and links that become cards:
   stockmarketloop.com channels, videos, live streams and articles, YouTube videos, news from other sites. Discord links are
   refused. Phones (no quote column) get a full-height sheet instead. */
(function boot(tries) {
  if (window.__smlTickerTalk) return;
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar')) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlTickerTalk = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar');
  const token = () => String(window.smlAcademySessionToken || '');
  const symbolNow = () => { try { return String((window.smlAcademyChartState && window.smlAcademyChartState().symbol) || ($('symbol') || {}).value || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const openOutside = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* blocked */ } } };
  const DISCORD = /https?:\/\/([a-z0-9-]+\.)*(discord\.gg|discord\.com|discordapp\.com|discordapp\.net|discord\.new|dsc\.gg|discord\.me|discord\.io)(\/|$|\s)/i;
  const PAGE = 20, PHONE = '(max-width:720px)';
  const idGt = (a, b) => { a = String(a); b = String(b); return a.length === b.length ? a > b : a.length > b.length; };

  const S = { open: false, symbol: symbolNow(), rows: [], index: new Map(), hasMore: false, count: null, busy: false, loadingOlder: false, before: '',
    draft: '', images: [], replyTo: null, mentions: new Map(), menu: null, viewer: null, msg: '', msgOk: false, editor: false, view: null, mounted: '' };

  const css = document.createElement('style');
  css.textContent = `
#talk-btn{margin-left:4px;padding:5px 9px;border:1px solid #3b6b8f;border-radius:7px;background:#0c1a26;color:#9fd0ff;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer;white-space:nowrap}#talk-btn.on{background:#1b4a6e;color:#fff;border-color:#5fa8e0}#talk-btn i{font-style:normal;opacity:.85}
/* the quote column while the section is open: price and change stay, the rest steps aside, the column widens when there is room */
.side.talk-open>*:not(#label):not(#price):not(#change):not(#talk-panel){display:none!important}
.side.talk-open>#talk-panel{flex:1 1 auto!important;min-height:0}
@media(min-width:1100px){body.talk-open:not(.academy-lesson-open) .shell{grid-template-columns:minmax(0,1fr) min(400px,38%)!important}}
@media(min-width:900px) and (max-width:1099px){body.talk-open:not(.academy-lesson-open) .shell{grid-template-columns:minmax(0,1fr) min(340px,40%)!important}}
#talk-panel{display:none;flex-direction:column;min-height:0;margin-top:8px;padding-top:7px;border-top:1px solid #1b3540;color:#dbe6ec;font:400 .76rem/1.45 system-ui,sans-serif}
#talk-panel.open{display:flex}
#talk-panel.sheet{position:fixed;left:0;right:0;bottom:0;top:52px;z-index:2147483000;margin:0;padding:8px 8px 0;border:0;border-top:1px solid #2a4d66;border-radius:14px 14px 0 0;background:#0b141c;box-shadow:0 -14px 40px rgba(0,0,0,.6)}
#talk-panel .tk-head{display:flex;align-items:center;gap:8px;flex:none;padding:0 0 6px}
#talk-panel .tk-head b{font:900 .72rem ui-monospace,monospace;letter-spacing:.08em;color:#9fd0ff}#talk-panel .tk-head small{color:#7f98a6;font:700 .6rem ui-monospace,monospace}#talk-panel .tk-head button{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:20px;line-height:1;cursor:pointer;padding:0 2px}#talk-panel .tk-head button:hover{color:#fff}
#talk-panel .tk-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 2px 6px 0}
#talk-panel .tk-status{padding:10px 6px;color:#7f98a6;text-align:center;font:700 .62rem ui-monospace,monospace}#talk-panel .tk-status:empty{display:none}
#talk-panel .tk-sentinel{height:1px}
/* compact composer: one bar; tap to open the editor */
#talk-panel .tk-bar{flex:none;display:flex;align-items:center;gap:5px;padding:7px 0 8px;border-top:1px solid #1b3540;background:inherit}
#talk-panel .tk-bar .tk-say{flex:1 1 auto;min-width:0;text-align:left;padding:8px 10px;border:1px solid #23495a;border-radius:999px;background:#0b1620;color:#7f98a6;font:600 .7rem system-ui;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#talk-panel .tk-bar .tk-say.has{color:#fff}#talk-panel .tk-bar .tk-say:hover{border-color:#5fa8e0}
#talk-panel .tk-bar .tk-ic{flex:none;width:32px;height:32px;border:1px solid #23495a;border-radius:50%;background:#0b1620;color:#b8c9d3;font-size:14px;cursor:pointer;display:grid;place-items:center}#talk-panel .tk-bar .tk-ic:hover{border-color:#5fa8e0;color:#fff}
#talk-panel .tk-msg{flex:none;margin:0 0 6px;padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700;font-size:.66rem}#talk-panel .tk-msg.ok{background:#0d2a1e;border-color:#1f6a4e;color:#9fe8c0}#talk-panel .tk-msg:empty{display:none}
/* comments */
.tk-c{margin:0 0 7px;padding:8px 9px;border:1px solid #17323d;border-radius:10px;background:#0a1118;content-visibility:auto;contain-intrinsic-size:auto 120px;cursor:default}.tk-c.new{animation:tkIn .5s ease}.tk-c.hi,.tk-r.hi{border-color:#5fa8e0}
@keyframes tkIn{from{background:#12304a}to{background:#0a1118}}
.tk-c .who,.tk-r .who{display:flex;align-items:center;gap:7px;margin:0 0 4px}.tk-c .ava,.tk-r .ava{width:22px;height:22px;border-radius:50%;background:#1b4a6e;color:#fff;display:grid;place-items:center;font:800 .62rem system-ui;flex:none}.tk-c .nm,.tk-r .nm{font:800 .72rem system-ui;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tk-c .when,.tk-r .when{margin-left:auto;color:#6f8794;font:700 .56rem ui-monospace,monospace;flex:none}
.tk-c .txt,.tk-r .txt{color:#dbe6ec;white-space:pre-wrap;word-break:break-word}.tk-c .txt h3,.tk-r .txt h3{margin:4px 0 2px;font:900 .9rem system-ui;color:#fff}.tk-c .txt h4,.tk-r .txt h4{margin:4px 0 2px;font:800 .78rem system-ui;color:#e6f1f5}
#talk-panel .tk-c>.txt{display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}#talk-panel .tk-r>.txt{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.tk-c .ct,.tk-r .ct{display:inline-block;padding:1px 6px;border-radius:999px;background:#0d3a2a;color:#3ef0a8;font:800 .64rem ui-monospace,monospace;cursor:pointer;border:0}.tk-c .ct:hover,.tk-r .ct:hover{background:#12513a}
.tk-c .mn,.tk-r .mn{color:#9cc8ff;font-weight:800}.tk-c .mn.me,.tk-r .mn.me{background:#1b4a6e;border-radius:4px;padding:0 3px;color:#fff}
.tk-c .pics,.tk-r .pics{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 0}.tk-c .pics img,.tk-r .pics img{max-width:100%;max-height:160px;border-radius:8px;border:1px solid #1b2a35;background:#070d14;cursor:zoom-in}
.tk-card{display:flex;gap:8px;margin:6px 0 0;padding:6px;border:1px solid #1d3550;border-radius:9px;background:#0b1620;cursor:pointer;text-decoration:none;color:inherit}.tk-card:hover{border-color:#5fa8e0}
.tk-card .th{flex:none;width:84px;height:56px;border-radius:6px;background:#0d1f33;display:grid;place-items:center;color:#9cc8ff;font-size:18px;overflow:hidden}.tk-card .th img{width:100%;height:100%;object-fit:cover;display:block}
.tk-card .tt{min-width:0}.tk-card .tt b{display:-webkit-box;font:800 .68rem system-ui;color:#fff;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}.tk-card .tt small{display:block;margin-top:2px;color:#7f98a6;font:700 .56rem ui-monospace,monospace;letter-spacing:.04em}
.tk-card .kind{display:inline-block;margin-right:5px;padding:1px 5px;border-radius:4px;background:#1b4a6e;color:#fff;font:800 .52rem ui-monospace,monospace}.tk-card .kind.live{background:#7a1230}.tk-card .kind.youtube{background:#8a1010}.tk-card .kind.watch,.tk-card .kind.channel{background:#12513a}
.tk-acts{display:flex;gap:10px;margin:6px 0 0}.tk-acts button{background:none;border:0;padding:0;color:#7f98a6;font:800 .6rem ui-monospace,monospace;cursor:pointer}.tk-acts button:hover{color:#fff}
.tk-r{margin:6px 0 0 12px;padding:6px 8px;border-left:2px solid #1d3550;background:#070d14;border-radius:0 8px 8px 0}
#talk-panel .tk-more-r{display:block;margin:5px 0 0 12px;background:none;border:0;padding:0;color:#9cc8ff;font:800 .6rem ui-monospace,monospace;cursor:pointer}
/* the editor and the reader: pop-outs over the page */
.tk-modal{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(2,8,14,.72);backdrop-filter:blur(3px)}
.tk-modal .tk-box{position:relative;display:flex;flex-direction:column;width:min(680px,100%);max-height:min(88vh,860px);border:1px solid #2a4d66;border-radius:14px;background:#0b141c;box-shadow:0 24px 70px rgba(0,0,0,.65);color:#dbe6ec;font:400 .88rem/1.5 system-ui,sans-serif;overflow:hidden}
.tk-modal .tk-mh{display:flex;align-items:center;gap:10px;flex:none;padding:12px 16px;border-bottom:1px solid #1b3540}.tk-modal .tk-mh b{font:900 .84rem ui-monospace,monospace;letter-spacing:.08em;color:#9fd0ff}.tk-modal .tk-mh small{color:#7f98a6;font:700 .64rem ui-monospace,monospace}.tk-modal .tk-mh .tk-x{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:24px;line-height:1;cursor:pointer}.tk-modal .tk-mh .tk-x:hover{color:#fff}
.tk-modal .tk-mb{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:14px 16px}
.tk-modal .tk-mf{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 16px 12px;border-top:1px solid #1b3540;background:#0a1118}
.tk-ed{position:relative}
.tk-ed textarea{display:block;width:100%;box-sizing:border-box;min-height:200px;max-height:48vh;resize:vertical;padding:12px 13px;border:1px solid #23495a;border-radius:10px;background:#0b1620;color:#fff;font:400 .92rem/1.5 system-ui,sans-serif}.tk-ed textarea:focus{outline:none;border-color:#5fa8e0}
.tk-ed .tk-reply-to{display:flex;align-items:center;gap:6px;margin:0 0 8px;padding:7px 10px;border-radius:8px;background:#0d1f33;border:1px solid #1d3550;color:#9cc8ff;font-size:.72rem}.tk-ed .tk-reply-to button{margin-left:auto;background:none;border:0;color:#9cc8ff;cursor:pointer;font-size:14px}
.tk-ed .tk-pending{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.tk-ed .tk-pending span{position:relative;width:76px;height:76px;border-radius:8px;overflow:hidden;border:1px solid #23495a}.tk-ed .tk-pending img{width:100%;height:100%;object-fit:cover}.tk-ed .tk-pending button{position:absolute;right:2px;top:2px;width:18px;height:18px;border:0;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:11px;line-height:18px;padding:0;cursor:pointer}
.tk-ed .tk-help{margin:8px 0 0;color:#6f8794;font-size:.64rem}
.tk-modal .tk-mf button{padding:7px 11px;border:1px solid #23495a;border-radius:7px;background:#0b1620;color:#b8c9d3;font:800 .68rem ui-monospace,monospace;cursor:pointer}.tk-modal .tk-mf button:hover{border-color:#5fa8e0;color:#fff}
.tk-modal .tk-mf .tk-send{margin-left:auto;background:#1b4a6e;border-color:#5fa8e0;color:#fff;font:800 .76rem system-ui;padding:8px 16px}.tk-modal .tk-mf .tk-send[disabled]{opacity:.5}.tk-modal .tk-mf .tk-cancel{background:none}
.tk-modal .tk-msg{width:100%;margin:0;padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700;font-size:.7rem}.tk-modal .tk-msg.ok{background:#0d2a1e;border-color:#1f6a4e;color:#9fe8c0}.tk-modal .tk-msg:empty{display:none}
.tk-ed .mm{position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:3;background:#0b1620;border:1px solid #2a4d66;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.5);overflow:hidden}.tk-ed .mm button{display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:none;color:#dbe6ec;font:700 .78rem system-ui;cursor:pointer}.tk-ed .mm button.on,.tk-ed .mm button:hover{background:#1b4a6e;color:#fff}.tk-ed .mm .mm-none{padding:8px 12px;color:#7f98a6;font-size:.7rem}
/* the reader: one comment, full size */
.tk-view .tk-c{content-visibility:visible;contain-intrinsic-size:auto;cursor:default;border:0;padding:0;margin:0;background:none}.tk-view .tk-c>.txt,.tk-view .tk-r>.txt{display:block;-webkit-line-clamp:unset;overflow:visible;font-size:.95rem;line-height:1.55}
.tk-view .tk-c .txt h3{font-size:1.2rem}.tk-view .tk-c .txt h4{font-size:1rem}.tk-view .ava{width:34px;height:34px;font-size:.85rem}.tk-view .nm{font-size:.9rem}.tk-view .when{font-size:.66rem}
.tk-view .pics img{max-height:none;max-width:100%;cursor:default}.tk-view .tk-card .th{width:128px;height:84px}.tk-view .tk-card .tt b{font-size:.84rem}.tk-view .tk-acts{display:none}
.tk-view .tk-r{margin:10px 0 0 0;padding:10px 12px;border-left:3px solid #1d3550;border-radius:0 10px 10px 0}.tk-view .tk-r>.txt{font-size:.86rem}.tk-view .tk-replies-h{margin:16px 0 4px;color:#7f98a6;font:800 .66rem ui-monospace,monospace;letter-spacing:.08em}
@media(max-width:720px){.tk-modal{padding:0;align-items:flex-end}.tk-modal .tk-box{width:100%;max-height:94vh;border-radius:14px 14px 0 0}.tk-ed textarea{min-height:150px}}`;
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'talk-btn'; btn.title = 'Ticker Talk: the comment section for this ticker'; toolbar.appendChild(btn);
  const panel = document.createElement('section'); panel.id = 'talk-panel'; panel.setAttribute('aria-label', 'Ticker Talk');
  panel.innerHTML = '<div class="tk-head"><b>TALK</b><small></small><button type="button" data-close="1" aria-label="Close">×</button></div><div class="tk-msg"></div><div class="tk-body"><div class="tk-list"></div><div class="tk-status"></div><div class="tk-sentinel"></div></div><div class="tk-bar"><button type="button" class="tk-say" data-editor="1"></button><button type="button" class="tk-ic" data-pic="1" title="Add a picture">🖼</button></div>';
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif'; file.multiple = true; file.style.display = 'none'; document.body.appendChild(file);
  const head = panel.querySelector('.tk-head'), msgEl = panel.querySelector('.tk-msg'), bodyEl = panel.querySelector('.tk-body'), listEl = panel.querySelector('.tk-list'), statusEl = panel.querySelector('.tk-status'), sentinel = panel.querySelector('.tk-sentinel'), sayBtn = panel.querySelector('.tk-say');

  /* ---- placement: the quote column, right under the price; phones get a sheet ---- */
  const side = () => document.querySelector('main .side');
  const bump = () => { try { window.dispatchEvent(new Event('resize')); } catch (_) { /* ignore */ } };
  function mount() {
    const col = side(), phone = window.matchMedia(PHONE).matches || !col;
    const want = phone ? 'sheet' : 'side';
    if (!S.open) { if (S.mounted) { panel.classList.remove('open', 'sheet'); panel.remove(); if (col) col.classList.remove('talk-open'); document.body.classList.remove('talk-open'); S.mounted = ''; bump(); } return; }
    if (S.mounted === want) return;
    panel.classList.toggle('sheet', phone);
    if (phone) { if (col) col.classList.remove('talk-open'); document.body.classList.remove('talk-open'); document.body.appendChild(panel); }
    else { const after = col.querySelector('#change') || col.querySelector('#price') || col.querySelector('#label'); if (after) after.insertAdjacentElement('afterend', panel); else col.prepend(panel); col.classList.add('talk-open'); document.body.classList.add('talk-open'); }
    panel.classList.add('open'); S.mounted = want; bump();
  }
  window.addEventListener('resize', () => { if (S.open) mount(); });

  /* ---- API ---- */
  async function api(path, { method = 'GET', body = null, raw = null, type = '' } = {}) {
    const t = token(); if (!t) return { ok: false, status: 401, error: 'authorization_required' };
    const headers = { authorization: 'Bearer ' + t }; if (body) headers['content-type'] = 'application/json'; if (raw) headers['content-type'] = type || 'application/octet-stream';
    try {
      const res = await fetch('/academy-activity/talk' + path, { method, headers, body: body ? JSON.stringify(body) : raw, cache: 'no-store' });
      let json = null; try { json = await res.json(); } catch (_) { json = null; }
      return Object.assign({ status: res.status }, json || { ok: false, error: 'bad_response' });
    } catch (_) { return { ok: false, status: 0, error: 'network' }; }
  }
  const WHY = { authorization_required: 'Unlock the Academy tools (sign in with Discord) to join Ticker Talk.', discord_links_not_allowed: 'Discord links are not allowed here.', slow_down: 'Easy: one comment at a time. Try again in a minute.', too_many_today: 'You have hit the hourly limit. Back soon.', empty_body: 'Write something first.', file_too_large: 'That picture is too big (1.5 MB max).', not_an_image: 'Only PNG, JPEG, WEBP or GIF pictures.', parent_not_found: 'That comment is gone.', image_not_found: 'A picture did not upload. Try again.', network: 'No connection right now.' };
  const why = (r) => WHY[r && r.error] || ('That did not work (' + esc((r && r.error) || (r && r.status)) + ').');
  function say(text, ok) { S.msg = text || ''; S.msgOk = !!ok; msgEl.textContent = S.msg; msgEl.classList.toggle('ok', !!ok); const em = document.querySelector('#talk-editor .tk-msg'); if (em) { em.textContent = S.msg; em.classList.toggle('ok', !!ok); } }

  /* ---- the list: reset, page back, pick up new ---- */
  function remember(c) { S.index.set(String(c.id), c); for (const r of (c.replies || [])) S.index.set(String(r.id), c); }
  async function load(reset) {
    if (S.busy) return; S.busy = true;
    const sym = S.symbol;
    if (reset) { S.rows = []; S.index.clear(); S.before = ''; S.hasMore = false; listEl.innerHTML = ''; statusEl.textContent = 'Loading…'; }
    else { S.loadingOlder = true; statusEl.textContent = 'Loading older…'; }
    const r = await api('/' + encodeURIComponent(sym) + '?limit=' + PAGE + (S.before ? '&before=' + encodeURIComponent(S.before) : ''));
    S.busy = false; S.loadingOlder = false;
    if (sym !== S.symbol || !S.open) return;
    if (!r.ok) { say(why(r)); statusEl.textContent = reset ? '' : 'Could not load more. Scroll to retry.'; return; }
    S.viewer = r.viewer || null; S.count = r.count; S.hasMore = !!r.hasMore;
    const fresh = (r.comments || []).filter((c) => !S.index.has(String(c.id)));
    fresh.forEach(remember); S.rows = S.rows.concat(fresh);
    S.before = S.rows.length ? S.rows[S.rows.length - 1].id : '';
    if (fresh.length) listEl.insertAdjacentHTML('beforeend', fresh.map((c) => commentHtml(c, false)).join(''));
    statusEl.textContent = S.rows.length ? (S.hasMore ? '' : 'You have read them all.') : 'No comments on $' + S.symbol + ' yet. Start the conversation.';
    paintHead(); paintButton();
    if (S.hasMore && bodyEl.scrollHeight <= bodyEl.clientHeight + 40) load(false);
  }
  async function loadNewer() {
    if (S.busy || !S.open) return;
    const sym = S.symbol;
    const r = await api('/' + encodeURIComponent(sym) + '?limit=' + PAGE);
    if (sym !== S.symbol || !S.open || !r.ok) return;
    S.viewer = r.viewer || S.viewer; S.count = r.count;
    const top = S.rows.length ? S.rows[0].id : '';
    const fresh = [], changed = [];
    for (const c of (r.comments || [])) {
      const have = S.index.get(String(c.id));
      if (!have) { if (!top || idGt(c.id, top)) fresh.push(c); }
      else if (have.id === c.id && ((have.replies || []).length !== (c.replies || []).length)) changed.push(c);
    }
    if (fresh.length) {
      const h0 = bodyEl.scrollHeight, s0 = bodyEl.scrollTop;
      fresh.forEach(remember); S.rows = fresh.concat(S.rows);
      listEl.insertAdjacentHTML('afterbegin', fresh.map((c) => commentHtml(c, false, true)).join(''));
      if (s0 > 8) bodyEl.scrollTop = s0 + (bodyEl.scrollHeight - h0);
      statusEl.textContent = S.hasMore ? '' : 'You have read them all.';
    }
    for (const c of changed) { const i = S.rows.findIndex((x) => x.id === c.id); if (i >= 0) { S.rows[i] = c; remember(c); replaceRow(c); if (S.view === c.id) paintView(); } }
    paintHead(); paintButton();
  }
  async function refreshCount() { const r = await api('/' + encodeURIComponent(S.symbol) + '/count'); if (r.ok && r.symbol === S.symbol) { S.count = r.count; paintButton(); paintHead(); } }
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && S.open && S.hasMore && !S.busy) load(false); }, { root: bodyEl, rootMargin: '400px 0px' }) : null;
  if (io) io.observe(sentinel);
  bodyEl.addEventListener('scroll', () => { if (!io && S.open && S.hasMore && !S.busy && bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 300) load(false); }, { passive: true });

  /* ---- rendering ---- */
  const when = (iso) => { const d = new Date(iso), diff = (Date.now() - d.getTime()) / 60000; if (diff < 1) return 'now'; if (diff < 60) return Math.round(diff) + 'm'; if (diff < 36 * 60) return Math.round(diff / 60) + 'h'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const whenLong = (iso) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return when(iso); } };
  const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
  function bodyHtml(c) {
    const selfId = S.viewer ? String(S.viewer.id) : '';
    let text = String(c.body || '');
    if ((c.links || []).length) text = text.replace(URL_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const lines = text.split('\n').map((line) => {
      let h = esc(line);
      h = h.replace(/\*\*([^*]{1,200})\*\*/g, '<b>$1</b>');
      h = h.replace(/\$([A-Za-z]{1,5})(?![A-Za-z0-9])/g, (m0, t) => '<button type="button" class="ct" data-sym="' + t.toUpperCase() + '">$' + t.toUpperCase() + '</button>');
      for (const u of (c.mentions || [])) { if (!u || !u.name) continue; const needle = esc('@' + u.name); h = h.split(needle).join('<span class="mn' + (String(u.id) === selfId ? ' me' : '') + '">' + needle + '</span>'); }
      if (/^## /.test(line)) return '<h4>' + h.slice(3) + '</h4>';
      if (/^# /.test(line)) return '<h3>' + h.slice(2) + '</h3>';
      return h;
    });
    let out = '<div class="txt">' + lines.join('\n').replace(/\n(<h[34]>)/g, '$1').replace(/(<\/h[34]>)\n/g, '$1') + '</div>';
    if ((c.images || []).length) out += '<div class="pics">' + c.images.map((id) => '<img src="/academy-activity/talk/image/' + esc(id) + '?t=' + encodeURIComponent(token() || '') + '" alt="" loading="lazy" data-zoom="' + esc(c.id) + '">').join('') + '</div>';
    for (const l of (c.links || [])) {
      const kind = String(l.kind || 'link'), label = { watch: 'VIDEO', channel: 'CHANNEL', live: 'LIVE', letter: 'LOOP LETTER', profile: 'PROFILE', article: 'STOCKMARKETLOOP', youtube: 'YOUTUBE', link: 'LINK' }[kind] || 'LINK';
      const th = l.image ? '<img src="/academy-activity/talk/link-image?u=' + encodeURIComponent(l.image) + '&t=' + encodeURIComponent(token() || '') + '" alt="" loading="lazy">' : (kind === 'youtube' || kind === 'watch' || kind === 'live' ? '▶' : kind === 'channel' ? '📺' : '🔗');
      out += '<a class="tk-card" href="' + esc(l.url) + '" data-ext="' + esc(l.url) + '"><span class="th">' + th + '</span><span class="tt"><b>' + esc(l.title || l.url) + '</b><small><span class="kind ' + esc(kind) + '">' + label + '</span>' + esc(l.site || '') + '</small></span></a>';
    }
    return out;
  }
  function who(c, long) { return '<div class="who"><span class="ava">' + esc(String(c.authorName || 'M').slice(0, 1).toUpperCase()) + '</span><span class="nm">' + esc(c.authorName || 'Member') + '</span><span class="when">' + (long ? whenLong(c.createdAt) : when(c.createdAt)) + '</span></div>'; }
  function acts(c, isReply) {
    const mine = S.viewer && String(c.authorId) === String(S.viewer.id), canDel = mine || (S.viewer && S.viewer.elevated);
    return '<div class="tk-acts">' + (isReply ? '' : '<button type="button" data-reply="' + esc(c.id) + '" data-name="' + esc(c.authorName || '') + '">Reply' + (c.replies && c.replies.length ? ' · ' + c.replies.length : '') + '</button>')
      + '<button type="button" data-view="' + esc(isReply ? S.index.get(String(c.id)) && S.index.get(String(c.id)).id || c.id : c.id) + '" data-focus="' + esc(c.id) + '" title="Open full size">Expand ⤢</button>'
      + (canDel ? '<button type="button" data-del="' + esc(c.id) + '">Delete</button>' : '') + '</div>';
  }
  function commentHtml(c, isReply, fresh) {
    const replies = c.replies || [], shown = isReply ? [] : replies.slice(0, 2);
    return '<div class="' + (isReply ? 'tk-r' : 'tk-c') + (fresh ? ' new' : '') + '" data-id="' + esc(c.id) + '"' + (isReply ? '' : ' title="Double-click to open full size"') + '>' + who(c) + bodyHtml(c) + acts(c, isReply)
      + shown.map((r) => commentHtml(r, true)).join('')
      + (replies.length > shown.length ? '<button type="button" class="tk-more-r" data-view="' + esc(c.id) + '">Show all ' + replies.length + ' replies</button>' : '') + '</div>';
  }
  function replaceRow(c) { const el = listEl.querySelector('.tk-c[data-id="' + CSS.escape(String(c.id)) + '"]'); if (el) el.outerHTML = commentHtml(c, false); }
  function paintButton() { btn.textContent = ''; btn.insertAdjacentHTML('beforeend', '<i>💬</i> TALK $' + esc(S.symbol) + (S.count != null ? ' · ' + S.count : '')); btn.classList.toggle('on', S.open); }
  function paintHead() { head.querySelector('b').textContent = '$' + S.symbol + ' TALK'; head.querySelector('small').textContent = S.count == null ? '' : S.count + ' comment' + (S.count === 1 ? '' : 's'); }
  function paintBar() {
    const d = S.draft.trim(), n = S.images.length;
    sayBtn.classList.toggle('has', !!(d || n || S.replyTo));
    sayBtn.textContent = S.replyTo ? '↩ Replying to ' + (S.replyTo.name || 'comment') + (d ? ': ' + d : '…') : d ? d : n ? n + ' picture' + (n === 1 ? '' : 's') + ' ready. Add words…' : 'Say something about $' + S.symbol + '…';
  }

  /* the pop-outs keep chart hotkeys and pan/zoom from firing while a member types or scrolls in them */
  function escAll() { if (S.editor) closeEditor(); else if (S.view) closeView(); }
  function shield(el) { ['pointerdown', 'wheel'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation())); el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && !S.menu && !(e.target && e.target.tagName === 'TEXTAREA')) { e.preventDefault(); escAll(); } }); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') escAll(); });

  /* ---- the editor: a big box to write in ---- */
  function openEditor() {
    if (S.editor) { const ta = document.querySelector('#talk-editor textarea'); if (ta) ta.focus(); return; }
    S.editor = true;
    const m = document.createElement('div'); m.className = 'tk-modal'; m.id = 'talk-editor';
    m.innerHTML = '<div class="tk-box" role="dialog" aria-label="Write a comment"><div class="tk-mh"><b></b><small></small><button type="button" class="tk-x" data-close-editor="1" aria-label="Close">×</button></div><div class="tk-mb"><div class="tk-ed"><div class="tk-reply-to-slot"></div><textarea maxlength="2000" placeholder="Use # for a heading, $TICKER to tag a stock, @ to tag a member, **bold**, paste a link for a card."></textarea><div class="tk-pending-slot"></div><p class="tk-help">Links to stockmarketloop.com channels, videos, live streams and articles, YouTube videos and news become cards. No Discord links. Ctrl/⌘ + Enter posts.</p></div></div><div class="tk-mf"><button type="button" data-ins="# " title="Heading">H</button><button type="button" data-ins="$" title="Tag a ticker">$</button><button type="button" data-ins="@" title="Tag a member">@</button><button type="button" data-ins="**" title="Bold">B</button><button type="button" data-pic="1" title="Add a picture">🖼 Picture</button><button type="button" class="tk-cancel" data-close-editor="1">Cancel</button><button type="button" class="tk-send" data-send="1">Post</button><div class="tk-msg"></div></div></div>';
    document.body.appendChild(m); shield(m);
    const ta = m.querySelector('textarea'); ta.value = S.draft; ta.addEventListener('input', () => { S.draft = ta.value; });
    watchMentions(ta);
    paintEditor(); say(S.msg, S.msgOk);
    setTimeout(() => { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) { /* ignore */ } }, 30);
  }
  function paintEditor() {
    const m = $('talk-editor'); if (!m) return;
    m.querySelector('.tk-mh b').textContent = S.replyTo ? 'REPLY · $' + S.symbol : 'COMMENT · $' + S.symbol;
    m.querySelector('.tk-mh small').textContent = S.replyTo ? 'to ' + (S.replyTo.name || 'a comment') : 'everyone watching $' + S.symbol + ' sees it';
    m.querySelector('.tk-reply-to-slot').innerHTML = S.replyTo ? '<div class="tk-reply-to">Replying to <b>' + esc(S.replyTo.name || 'comment') + '</b><button type="button" data-cancel-reply="1" aria-label="Cancel reply">✕</button></div>' : '';
    m.querySelector('.tk-pending-slot').innerHTML = S.images.length ? '<div class="tk-pending">' + S.images.map((im) => '<span><img src="' + esc(im.preview) + '" alt=""><button type="button" data-unpic="' + esc(im.id) + '">✕</button></span>').join('') + '</div>' : '';
    paintBar();
  }
  function closeEditor() { const m = $('talk-editor'); if (m) m.remove(); S.editor = false; closeMenu(); paintBar(); }
  function insert(txt) { const ta = document.querySelector('#talk-editor textarea'); if (!ta) return; const a = ta.selectionStart || 0, b = ta.selectionEnd || a; const v = ta.value; if (txt === '**') { ta.value = v.slice(0, a) + '**' + v.slice(a, b) + '**' + v.slice(b); ta.setSelectionRange(a + 2, b + 2); } else { const lineStart = txt === '# ' && a > 0 && v[a - 1] !== '\n' ? '\n' : ''; ta.value = v.slice(0, a) + lineStart + txt + v.slice(b); ta.setSelectionRange(a + lineStart.length + txt.length, a + lineStart.length + txt.length); } S.draft = ta.value; ta.focus(); ta.dispatchEvent(new Event('input')); }
  async function send() {
    const body = S.draft.trim();
    if (!body && !S.images.length) { say(WHY.empty_body); return; }
    if (DISCORD.test(body)) { say(WHY.discord_links_not_allowed); return; }
    const sendBtn = document.querySelector('#talk-editor .tk-send'); if (sendBtn) sendBtn.disabled = true;
    const mentions = []; for (const [name, id] of S.mentions) if (body.indexOf('@' + name) >= 0) mentions.push({ id, name });
    const sym = S.symbol, replyTo = S.replyTo;
    const r = await api('/' + encodeURIComponent(sym), { method: 'POST', body: { body, parentId: replyTo ? replyTo.id : null, imageIds: S.images.map((im) => im.id), mentions } });
    if (sendBtn) sendBtn.disabled = false;
    if (!r.ok) { say(why(r)); return; }
    S.draft = ''; S.images = []; S.mentions.clear(); S.replyTo = null;
    closeEditor(); say('Posted.', true); setTimeout(() => { if (S.msg === 'Posted.') say(''); }, 2500);
    if (sym !== S.symbol) return;
    if (replyTo) { const p = S.rows.find((x) => x.id === replyTo.id); if (p) { p.replies = (p.replies || []).concat([r.comment]); remember(p); replaceRow(p); if (S.view === p.id) paintView(); } }
    else { remember(r.comment); S.rows.unshift(r.comment); listEl.insertAdjacentHTML('afterbegin', commentHtml(r.comment, false, true)); bodyEl.scrollTop = 0; statusEl.textContent = S.hasMore ? '' : 'You have read them all.'; }
    S.count = (S.count || 0) + 1; paintHead(); paintButton();
  }
  async function addPictures(files) {
    for (const f of Array.from(files || []).slice(0, 4 - S.images.length)) {
      if (f.size > 1_500_000) { say(WHY.file_too_large); continue; }
      const bytes = await f.arrayBuffer();
      const r = await api('/image', { method: 'POST', raw: bytes, type: f.type || 'application/octet-stream' });
      if (!r.ok) { say(why(r)); continue; }
      S.images.push({ id: r.id, preview: URL.createObjectURL(f) }); say('');
    }
    if (!S.editor) openEditor(); else paintEditor();
  }
  function startReply(id, name) { S.replyTo = { id, name }; paintBar(); openEditor(); paintEditor(); }
  async function remove(id) {
    if (!confirm('Delete this comment?')) return;
    const r = await api('/' + encodeURIComponent(S.symbol) + '/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) { say(why(r)); return; }
    const root = S.rows.find((x) => x.id === id);
    if (root) { S.rows = S.rows.filter((x) => x.id !== id); S.index.delete(String(id)); for (const rr of (root.replies || [])) S.index.delete(String(rr.id)); const el = listEl.querySelector('.tk-c[data-id="' + CSS.escape(String(id)) + '"]'); if (el) el.remove(); S.count = Math.max(0, (S.count || 1) - 1 - (root.replies || []).length); if (S.view === id) closeView(); }
    else { const p = S.index.get(String(id)); if (p) { p.replies = (p.replies || []).filter((x) => x.id !== id); S.index.delete(String(id)); replaceRow(p); S.count = Math.max(0, (S.count || 1) - 1); if (S.view === p.id) paintView(); } }
    S.before = S.rows.length ? S.rows[S.rows.length - 1].id : '';
    paintHead(); paintButton();
    if (!S.rows.length) statusEl.textContent = 'No comments on $' + S.symbol + ' yet. Start the conversation.';
  }

  /* ---- the reader: one comment, full size, with all its replies ---- */
  function openView(id, focusId) {
    const c = S.index.get(String(id)); if (!c) return;
    S.view = c.id;
    let m = $('talk-view');
    if (!m) { m = document.createElement('div'); m.className = 'tk-modal tk-view'; m.id = 'talk-view'; m.innerHTML = '<div class="tk-box" role="dialog" aria-label="Comment"><div class="tk-mh"><b></b><small></small><button type="button" class="tk-x" data-close-view="1" aria-label="Close">×</button></div><div class="tk-mb"></div><div class="tk-mf"></div></div>'; document.body.appendChild(m); shield(m); }
    paintView(focusId);
  }
  function paintView(focusId) {
    const m = $('talk-view'), c = S.view && S.index.get(String(S.view)); if (!m) return; if (!c) { closeView(); return; }
    const mine = S.viewer && String(c.authorId) === String(S.viewer.id), canDel = mine || (S.viewer && S.viewer.elevated), replies = c.replies || [];
    m.querySelector('.tk-mh b').textContent = '$' + S.symbol + ' TALK';
    m.querySelector('.tk-mh small').textContent = (c.authorName || 'Member') + ' · ' + whenLong(c.createdAt);
    m.querySelector('.tk-mb').innerHTML = '<div class="tk-c" data-id="' + esc(c.id) + '">' + who(c, true) + bodyHtml(c) + '</div>'
      + (replies.length ? '<div class="tk-replies-h">' + replies.length + ' REPL' + (replies.length === 1 ? 'Y' : 'IES') + '</div>' + replies.map((r) => '<div class="tk-r' + (focusId && String(r.id) === String(focusId) ? ' hi' : '') + '" data-id="' + esc(r.id) + '">' + who(r, true) + bodyHtml(r) + ((S.viewer && String(r.authorId) === String(S.viewer.id)) || (S.viewer && S.viewer.elevated) ? '<div class="tk-acts" style="display:flex"><button type="button" data-del="' + esc(r.id) + '">Delete</button></div>' : '') + '</div>').join('') : '');
    m.querySelector('.tk-mf').innerHTML = '<button type="button" data-reply="' + esc(c.id) + '" data-name="' + esc(c.authorName || '') + '">↩ Reply</button>' + (canDel ? '<button type="button" data-del="' + esc(c.id) + '">Delete</button>' : '') + '<button type="button" class="tk-cancel" data-close-view="1" style="margin-left:auto">Close</button>';
    if (focusId) { const el = m.querySelector('.tk-r[data-id="' + CSS.escape(String(focusId)) + '"]'); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 20); }
  }
  function closeView() { const m = $('talk-view'); if (m) m.remove(); S.view = null; }

  /* ---- @mentions: type @ and pick a member ---- */
  function mentionQuery(inp) { const caret = inp.selectionStart == null ? inp.value.length : inp.selectionStart; const upTo = String(inp.value || '').slice(0, caret); const at = upTo.lastIndexOf('@'); if (at < 0 || (at > 0 && !/\s/.test(upTo[at - 1]))) return null; const q = upTo.slice(at + 1); if (q.length > 24 || /\s/.test(q)) return null; return { at, q }; }
  function closeMenu() { if (S.menu) { S.menu.el.remove(); S.menu = null; } }
  function paintMenu() { if (!S.menu) return; const m = S.menu; m.el.innerHTML = m.items.length ? m.items.map((u, i) => '<button type="button" class="' + (i === m.idx ? 'on' : '') + '" data-pick="' + i + '">@' + esc(u.name) + '</button>').join('') : '<div class="mm-none">' + (m.loading ? 'Searching members…' : 'No member matches') + '</div>'; }
  let menuTimer = 0;
  function openMenu(inp, q) {
    if (!S.menu || S.menu.input !== inp) { closeMenu(); const el = document.createElement('div'); el.className = 'mm'; (inp.closest('.tk-ed') || inp.parentElement).appendChild(el); el.addEventListener('mousedown', (e) => { const b = e.target.closest && e.target.closest('[data-pick]'); if (b) { e.preventDefault(); pick(Number(b.dataset.pick)); } }); S.menu = { input: inp, el, q: null, items: [], idx: 0, loading: true }; }
    if (S.menu.q !== q) { S.menu.q = q; S.menu.loading = true; S.menu.idx = 0; S.menu.items = []; paintMenu(); clearTimeout(menuTimer); menuTimer = setTimeout(async () => { const r = await api('/members?q=' + encodeURIComponent(q)); if (S.menu && S.menu.q === q) { S.menu.items = r.ok ? (r.users || []) : []; S.menu.loading = false; paintMenu(); } }, 180); }
  }
  function pick(i) { const u = S.menu && S.menu.items[i]; if (!u) return; const inp = S.menu.input, m = mentionQuery(inp); if (!m) { closeMenu(); return; } const caret = inp.selectionStart == null ? inp.value.length : inp.selectionStart; const before = inp.value.slice(0, m.at) + '@' + u.name + ' '; inp.value = before + inp.value.slice(caret); S.draft = inp.value; S.mentions.set(u.name, String(u.id)); try { inp.setSelectionRange(before.length, before.length); } catch (_) { /* ignore */ } closeMenu(); inp.focus(); }
  function watchMentions(inp) {
    if (inp.dataset.mm) return; inp.dataset.mm = '1';
    const refresh = () => { const m = mentionQuery(inp); if (m) openMenu(inp, m.q); else if (S.menu && S.menu.input === inp) closeMenu(); };
    inp.addEventListener('input', refresh); inp.addEventListener('click', refresh);
    inp.addEventListener('blur', () => setTimeout(() => { if (S.menu && S.menu.input === inp && document.activeElement !== inp) closeMenu(); }, 150));
    inp.addEventListener('keydown', (e) => {
      if (S.menu && S.menu.input === inp) { const n = Math.max(1, S.menu.items.length); if (e.key === 'ArrowDown') { e.preventDefault(); S.menu.idx = (S.menu.idx + 1) % n; paintMenu(); return; } if (e.key === 'ArrowUp') { e.preventDefault(); S.menu.idx = (S.menu.idx - 1 + n) % n; paintMenu(); return; } if ((e.key === 'Enter' || e.key === 'Tab') && S.menu.items.length) { e.preventDefault(); pick(S.menu.idx); return; } if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; } }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
      if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
    });
  }

  /* ---- events: the panel, the editor and the reader share one handler ---- */
  function openPanel() { S.open = true; say(''); mount(); paintHead(); paintButton(); paintBar(); load(true); }
  function closePanel() { S.open = false; closeMenu(); closeEditor(); closeView(); mount(); paintButton(); }
  btn.addEventListener('click', () => { if (S.open) closePanel(); else openPanel(); });
  function onClick(e) {
    const t = e.target.closest ? e.target.closest('[data-close],[data-editor],[data-close-editor],[data-close-view],[data-reply],[data-cancel-reply],[data-del],[data-ins],[data-pic],[data-send],[data-unpic],[data-sym],[data-ext],[data-view],[data-zoom]') : null;
    if (!t) { if (e.target.classList && e.target.classList.contains('tk-modal')) { if (e.target.id === 'talk-view') closeView(); else closeEditor(); } return; }
    const d = t.dataset;
    if (d.close) { closePanel(); return; }
    if (d.editor) { openEditor(); return; }
    if (d.closeEditor) { closeEditor(); return; }
    if (d.closeView) { closeView(); return; }
    if (d.reply) { startReply(d.reply, d.name); return; }
    if (d.cancelReply) { S.replyTo = null; paintEditor(); return; }
    if (d.del) { remove(d.del); return; }
    if (d.ins) { insert(d.ins); return; }
    if (d.pic) { file.value = ''; file.click(); return; }
    if (d.send) { send(); return; }
    if (d.unpic) { S.images = S.images.filter((im) => im.id !== d.unpic); paintEditor(); return; }
    if (d.sym) { e.preventDefault(); if (window.smlAcademyNavigateMarket) window.smlAcademyNavigateMarket(d.sym); return; }
    if (d.ext) { e.preventDefault(); openOutside(d.ext); return; }
    if (d.view) { openView(d.view, d.focus); return; }
    if (d.zoom) { if (!t.closest('.tk-view')) { const root = S.index.get(String(d.zoom)); if (root) openView(root.id, root.id !== d.zoom ? d.zoom : ''); } }
  }
  panel.addEventListener('click', onClick);
  panel.addEventListener('dblclick', (e) => { if (e.target.closest('button,a,img,textarea')) return; const el = e.target.closest('.tk-r,.tk-c'); if (!el) return; e.preventDefault(); const root = S.index.get(String(el.dataset.id)); if (root) openView(root.id, el.classList.contains('tk-r') ? el.dataset.id : ''); try { getSelection().removeAllRanges(); } catch (_) { /* ignore */ } });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#talk-editor,#talk-view')) onClick(e); });
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));
  file.addEventListener('change', () => { if (file.files && file.files.length) addPictures(file.files); });
  window.addEventListener('sml-academy-market', () => { const sym = symbolNow(); if (sym === S.symbol) return; S.symbol = sym; S.count = null; S.replyTo = null; closeView(); say(''); paintButton(); paintBar(); if (S.open) { paintHead(); load(true); } else refreshCount(); });
  setInterval(() => { if (document.hidden) return; if (S.open) loadNewer(); else refreshCount(); }, 45_000);
  paintButton(); paintBar(); refreshCount();
  window.smlTickerTalk = { open: () => { if (!S.open) openPanel(); }, close: () => { if (S.open) closePanel(); }, state: () => ({ symbol: S.symbol, open: S.open, count: S.count, loaded: S.rows.length }) };
})(0);
