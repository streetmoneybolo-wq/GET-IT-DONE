/* Ticker Talk: the comment section for the ticker on the chart. A TALK button in the chart toolbar shows how many comments the
   ticker has; it opens a panel beside the plot (the chart dock when there is room, over the quote column otherwise, a bottom
   sheet on phones) with the comments and a composer. Members write with "# heading", **bold**, $TICKER cashtags (tap to load that
   chart), @mentions (type @ and pick), pictures, and links that become cards: stockmarketloop.com channels, videos, live streams
   and articles, YouTube videos, news from other sites. Discord links are refused. Replies hang under their comment. */
(function boot(tries) {
  if (window.__smlTickerTalk) return;
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar')) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlTickerTalk = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar'), host = document.querySelector('main .chart') || document.body;
  const token = () => String(window.smlAcademySessionToken || '');
  const symbolNow = () => { try { return String((window.smlAcademyChartState && window.smlAcademyChartState().symbol) || ($('symbol') || {}).value || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const openOutside = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* blocked */ } } };
  const DISCORD = /https?:\/\/([a-z0-9-]+\.)*(discord\.gg|discord\.com|discordapp\.com|discordapp\.net|discord\.new|dsc\.gg|discord\.me|discord\.io)(\/|$|\s)/i;

  const S = { open: false, symbol: symbolNow(), rows: [], hasMore: false, count: null, busy: false, msg: '', replyTo: null, images: [], viewer: null, before: '', mentions: new Map(), menu: null };

  const css = document.createElement('style');
  css.textContent = `
#talk-btn{margin-left:4px;padding:5px 9px;border:1px solid #3b6b8f;border-radius:7px;background:#0c1a26;color:#9fd0ff;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer;white-space:nowrap}#talk-btn.on{background:#1b4a6e;color:#fff;border-color:#5fa8e0}#talk-btn i{font-style:normal;opacity:.85}
#talk-panel{position:absolute;right:14px;top:58px;z-index:7;width:min(360px,calc(100% - 28px));max-height:calc(100% - 76px);display:none;flex-direction:column;background:#0b141c;border:1px solid #2a4d66;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.55);color:#dbe6ec;font:400 .74rem/1.45 system-ui,sans-serif;overflow:hidden}
#talk-panel.open{display:flex}
#talk-panel header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1b3540;flex:none}
#talk-panel header b{font:900 .8rem ui-monospace,monospace;letter-spacing:.06em;color:#9fd0ff}#talk-panel header small{color:#7f98a6;font-size:.62rem}#talk-panel header button{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px;cursor:pointer}
#talk-panel .tk-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:8px 10px}
#talk-panel .tk-compose{flex:none;padding:8px 10px 10px;border-top:1px solid #1b3540;background:#0a1118;position:relative}
#talk-panel textarea{display:block;width:100%;box-sizing:border-box;min-height:58px;max-height:160px;resize:vertical;padding:8px 9px;border:1px solid #23495a;border-radius:8px;background:#0b1620;color:#fff;font:400 .74rem/1.4 system-ui,sans-serif}
#talk-panel textarea:focus{outline:none;border-color:#5fa8e0}
#talk-panel .tk-tools{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 0;align-items:center}
#talk-panel .tk-tools button{padding:5px 8px;border:1px solid #23495a;border-radius:6px;background:#0b1620;color:#b8c9d3;font:800 .62rem ui-monospace,monospace;cursor:pointer}#talk-panel .tk-tools button:hover{border-color:#5fa8e0;color:#fff}
#talk-panel .tk-tools .tk-send{margin-left:auto;background:#1b4a6e;border-color:#5fa8e0;color:#fff;font:800 .68rem system-ui}#talk-panel .tk-tools .tk-send[disabled]{opacity:.5}
#talk-panel .tk-help{margin:5px 0 0;color:#6f8794;font-size:.58rem}
#talk-panel .tk-msg{margin:6px 0 0;padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700;font-size:.66rem}#talk-panel .tk-msg.ok{background:#0d2a1e;border-color:#1f6a4e;color:#9fe8c0}
#talk-panel .tk-reply-to{display:flex;align-items:center;gap:6px;margin:0 0 6px;padding:5px 8px;border-radius:7px;background:#0d1f33;border:1px solid #1d3550;color:#9cc8ff;font-size:.64rem}#talk-panel .tk-reply-to button{margin-left:auto;background:none;border:0;color:#9cc8ff;cursor:pointer}
#talk-panel .tk-pending{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 0}#talk-panel .tk-pending span{position:relative;width:52px;height:52px;border-radius:7px;overflow:hidden;border:1px solid #23495a}#talk-panel .tk-pending img{width:100%;height:100%;object-fit:cover}#talk-panel .tk-pending button{position:absolute;right:1px;top:1px;width:16px;height:16px;border:0;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:10px;line-height:16px;padding:0;cursor:pointer}
#talk-panel .tk-c{margin:0 0 8px;padding:8px 9px;border:1px solid #17323d;border-radius:10px;background:#0a1118}
#talk-panel .tk-c .who{display:flex;align-items:center;gap:7px;margin:0 0 4px}#talk-panel .tk-c .ava{width:22px;height:22px;border-radius:50%;background:#1b4a6e;color:#fff;display:grid;place-items:center;font:800 .62rem system-ui;flex:none}#talk-panel .tk-c .nm{font:800 .7rem system-ui;color:#fff}#talk-panel .tk-c .when{margin-left:auto;color:#6f8794;font:700 .56rem ui-monospace,monospace}
#talk-panel .tk-c .txt{color:#dbe6ec;white-space:pre-wrap;word-break:break-word}#talk-panel .tk-c .txt h3{margin:4px 0 2px;font:900 .86rem system-ui;color:#fff}#talk-panel .tk-c .txt h4{margin:4px 0 2px;font:800 .76rem system-ui;color:#e6f1f5}
#talk-panel .tk-c .ct{display:inline-block;padding:1px 6px;border-radius:999px;background:#0d3a2a;color:#3ef0a8;font:800 .62rem ui-monospace,monospace;cursor:pointer;border:0}#talk-panel .tk-c .ct:hover{background:#12513a}
#talk-panel .tk-c .mn{color:#9cc8ff;font-weight:800}#talk-panel .tk-c .mn.me{background:#1b4a6e;border-radius:4px;padding:0 3px;color:#fff}
#talk-panel .tk-c .pics{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 0}#talk-panel .tk-c .pics img{max-width:100%;max-height:220px;border-radius:8px;border:1px solid #1b2a35;background:#070d14;cursor:zoom-in}#talk-panel .tk-c .pics img.big{max-height:none}
#talk-panel .tk-card{display:flex;gap:8px;margin:6px 0 0;padding:6px;border:1px solid #1d3550;border-radius:9px;background:#0b1620;cursor:pointer;text-decoration:none;color:inherit}#talk-panel .tk-card:hover{border-color:#5fa8e0}
#talk-panel .tk-card .th{flex:none;width:84px;height:56px;border-radius:6px;background:#0d1f33 center/cover no-repeat;display:grid;place-items:center;color:#9cc8ff;font-size:18px;overflow:hidden}#talk-panel .tk-card .th img{width:100%;height:100%;object-fit:cover;display:block}
#talk-panel .tk-card .tt{min-width:0}#talk-panel .tk-card .tt b{display:block;font:800 .68rem system-ui;color:#fff;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}#talk-panel .tk-card .tt small{display:block;margin-top:2px;color:#7f98a6;font:700 .56rem ui-monospace,monospace;letter-spacing:.04em}
#talk-panel .tk-card .kind{display:inline-block;margin-right:5px;padding:1px 5px;border-radius:4px;background:#1b4a6e;color:#fff;font:800 .52rem ui-monospace,monospace}#talk-panel .tk-card .kind.live{background:#7a1230}#talk-panel .tk-card .kind.youtube{background:#8a1010}#talk-panel .tk-card .kind.watch,#talk-panel .tk-card .kind.channel{background:#12513a}
#talk-panel .tk-acts{display:flex;gap:10px;margin:6px 0 0}#talk-panel .tk-acts button{background:none;border:0;padding:0;color:#7f98a6;font:800 .6rem ui-monospace,monospace;cursor:pointer}#talk-panel .tk-acts button:hover{color:#fff}
#talk-panel .tk-r{margin:6px 0 0 14px;padding:6px 8px;border-left:2px solid #1d3550;background:#070d14;border-radius:0 8px 8px 0}
#talk-panel .tk-more{display:block;width:100%;margin:2px 0 8px;padding:7px;border:1px solid #23495a;border-radius:8px;background:#0a1118;color:#b8c9d3;font:700 .66rem system-ui;cursor:pointer}
#talk-panel .tk-empty{padding:18px 8px;color:#7f98a6;text-align:center}
#talk-panel .mm{position:absolute;left:10px;right:10px;bottom:100%;margin-bottom:-6px;z-index:3;background:#0b1620;border:1px solid #2a4d66;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.5);overflow:hidden}#talk-panel .mm button{display:block;width:100%;text-align:left;padding:7px 10px;border:0;background:none;color:#dbe6ec;font:700 .7rem system-ui;cursor:pointer}#talk-panel .mm button.on,#talk-panel .mm button:hover{background:#1b4a6e;color:#fff}#talk-panel .mm .mm-none{padding:7px 10px;color:#7f98a6;font-size:.64rem}
@media(max-width:700px){#talk-panel{position:fixed;left:6px;right:6px;bottom:6px;top:auto;width:auto;max-height:62vh;z-index:2147483000}}`;
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'talk-btn'; btn.title = 'Ticker Talk: the comment section for this ticker'; toolbar.appendChild(btn);
  const panel = document.createElement('aside'); panel.id = 'talk-panel'; panel.setAttribute('aria-label', 'Ticker Talk'); host.appendChild(panel);
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif'; file.multiple = true; file.style.display = 'none'; document.body.appendChild(file);

  /* ---- placement: the chart dock when it has room, else over the quote column; phones keep the bottom sheet ---- */
  const CLEAR = ['position', 'left', 'top', 'width', 'height', 'maxHeight', 'right', 'bottom', 'zIndex'];
  function place() {
    if (!S.open) return;
    const dk = window.smlChartDock;
    if (dk && (dk.holds(panel) || dk.room())) { if (panel.style.position) CLEAR.forEach((k) => { panel.style[k] = ''; }); return; }
    if (window.matchMedia('(max-width:700px)').matches) { CLEAR.forEach((k) => { panel.style[k] = ''; }); return; }
    const visible = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 80 && getComputedStyle(el).display !== 'none' ? r : null; };
    const r = visible(document.querySelector('.side')) || visible($('academy-alerts'));
    if (!r) { CLEAR.forEach((k) => { panel.style[k] = ''; }); return; }
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    Object.assign(panel.style, { position: 'fixed', left: Math.round(r.left) + 'px', top: Math.round(r.top) + 'px', width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px', maxHeight: 'none', right: 'auto', zIndex: '2147483100' });
  }
  window.addEventListener('resize', place); setInterval(place, 1500);

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

  async function load(reset) {
    if (S.busy) return; S.busy = true; if (reset) { S.rows = []; S.before = ''; S.hasMore = false; }
    const sym = S.symbol;
    const r = await api('/' + encodeURIComponent(sym) + '?limit=20' + (S.before ? '&before=' + encodeURIComponent(S.before) : ''));
    S.busy = false;
    if (sym !== S.symbol) return;
    if (!r.ok) { S.msg = why(r); paint(); return; }
    S.rows = reset ? r.comments : S.rows.concat(r.comments); S.hasMore = !!r.hasMore; S.count = r.count; S.viewer = r.viewer || null;
    S.before = S.rows.length ? S.rows[S.rows.length - 1].id : '';
    paintButton(); paint();
  }
  async function refreshCount() { const r = await api('/' + encodeURIComponent(S.symbol) + '/count'); if (r.ok && r.symbol === S.symbol) { S.count = r.count; paintButton(); } }

  /* ---- rendering ---- */
  const when = (iso) => { const d = new Date(iso), diff = (Date.now() - d.getTime()) / 60000; if (diff < 1) return 'now'; if (diff < 60) return Math.round(diff) + 'm'; if (diff < 36 * 60) return Math.round(diff / 60) + 'h'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
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
      if (/^## /.test(line)) return '<h4>' + h.slice(6) + '</h4>';
      if (/^# /.test(line)) return '<h3>' + h.slice(5) + '</h3>';
      return h;
    });
    let out = '<div class="txt">' + lines.join('\n').replace(/\n(<h[34]>)/g, '$1').replace(/(<\/h[34]>)\n/g, '$1') + '</div>';
    if ((c.images || []).length) out += '<div class="pics">' + c.images.map((id) => '<img src="/academy-activity/talk/image/' + esc(id) + '?t=' + encodeURIComponent(token() || '') + '" alt="" loading="lazy" data-zoom="1">').join('') + '</div>';
    for (const l of (c.links || [])) {
      const kind = String(l.kind || 'link'), label = { watch: 'VIDEO', channel: 'CHANNEL', live: 'LIVE', letter: 'LOOP LETTER', profile: 'PROFILE', article: 'STOCKMARKETLOOP', youtube: 'YOUTUBE', link: 'LINK' }[kind] || 'LINK';
      const th = l.image ? '<img src="/academy-activity/talk/link-image?u=' + encodeURIComponent(l.image) + '&t=' + encodeURIComponent(token() || '') + '" alt="" loading="lazy">' : (kind === 'youtube' || kind === 'watch' || kind === 'live' ? '▶' : kind === 'channel' ? '📺' : '🔗');
      out += '<a class="tk-card" href="' + esc(l.url) + '" data-ext="' + esc(l.url) + '"><span class="th">' + th + '</span><span class="tt"><b>' + esc(l.title || l.url) + '</b><small><span class="kind ' + esc(kind) + '">' + label + '</span>' + esc(l.site || '') + '</small></span></a>';
    }
    return out;
  }
  function commentHtml(c, isReply) {
    const mine = S.viewer && String(c.authorId) === String(S.viewer.id), canDel = mine || (S.viewer && S.viewer.elevated);
    return '<div class="' + (isReply ? 'tk-r' : 'tk-c') + '" data-id="' + esc(c.id) + '"><div class="who"><span class="ava">' + esc(String(c.authorName || 'M').slice(0, 1).toUpperCase()) + '</span><span class="nm">' + esc(c.authorName || 'Member') + '</span><span class="when">' + when(c.createdAt) + '</span></div>'
      + bodyHtml(c)
      + '<div class="tk-acts">' + (isReply ? '' : '<button type="button" data-reply="' + esc(c.id) + '" data-name="' + esc(c.authorName || '') + '">Reply' + (c.replies && c.replies.length ? ' · ' + c.replies.length : '') + '</button>') + (canDel ? '<button type="button" data-del="' + esc(c.id) + '">Delete</button>' : '') + '</div>'
      + (isReply ? '' : (c.replies || []).map((r) => commentHtml(r, true)).join('')) + '</div>';
  }
  function paintButton() { btn.textContent = ''; btn.insertAdjacentHTML('beforeend', '<i>💬</i> TALK $' + esc(S.symbol) + (S.count != null ? ' · ' + S.count : '')); btn.classList.toggle('on', S.open); }
  function paint() {
    panel.classList.toggle('open', S.open); paintButton(); place();
    if (!S.open) return;
    const bodyEl = panel.querySelector('.tk-body');
    const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
    const draft = panel.querySelector('textarea') ? panel.querySelector('textarea').value : '';
    let h = '<header><b>$' + esc(S.symbol) + ' TALK</b><small>' + (S.count == null ? '' : S.count + ' comment' + (S.count === 1 ? '' : 's')) + '</small><button type="button" data-close="1" aria-label="Close">×</button></header>';
    h += '<div class="tk-body">' + (S.rows.length ? S.rows.map((c) => commentHtml(c, false)).join('') : '<div class="tk-empty">' + (S.busy ? 'Loading…' : 'No comments on $' + esc(S.symbol) + ' yet. Start the conversation.') + '</div>') + (S.hasMore ? '<button type="button" class="tk-more" data-more="1">Load older comments</button>' : '') + '</div>';
    h += '<div class="tk-compose">' + (S.replyTo ? '<div class="tk-reply-to">Replying to <b>' + esc(S.replyTo.name || 'comment') + '</b><button type="button" data-cancel-reply="1">✕</button></div>' : '')
      + '<textarea placeholder="Say something about $' + esc(S.symbol) + '… use # for a heading, $TICKER to tag a stock, @ to tag a member, paste a link" maxlength="2000">' + esc(draft) + '</textarea>'
      + (S.images.length ? '<div class="tk-pending">' + S.images.map((im) => '<span><img src="' + esc(im.preview) + '" alt=""><button type="button" data-unpic="' + esc(im.id) + '">✕</button></span>').join('') + '</div>' : '')
      + '<div class="tk-tools"><button type="button" data-ins="# " title="Heading">H</button><button type="button" data-ins="$" title="Tag a ticker">$</button><button type="button" data-ins="@" title="Tag a member">@</button><button type="button" data-ins="**" title="Bold">B</button><button type="button" data-pic="1" title="Add a picture">🖼</button><button type="button" class="tk-send" data-send="1">Post</button></div>'
      + '<p class="tk-help">Links to stockmarketloop.com channels, videos, live streams and articles, YouTube videos and news become cards. No Discord links.</p>'
      + (S.msg ? '<div class="tk-msg' + (S.msgOk ? ' ok' : '') + '">' + esc(S.msg) + '</div>' : '') + '</div>';
    panel.innerHTML = h;
    const nb = panel.querySelector('.tk-body'); if (nb) nb.scrollTop = scrollTop;
    const ta = panel.querySelector('textarea'); if (ta) watchMentions(ta);
  }

  /* ---- composer actions ---- */
  function insert(txt) { const ta = panel.querySelector('textarea'); if (!ta) return; const a = ta.selectionStart || 0, b = ta.selectionEnd || a; const v = ta.value; if (txt === '**') { ta.value = v.slice(0, a) + '**' + v.slice(a, b) + '**' + v.slice(b); ta.setSelectionRange(a + 2, b + 2); } else { const lineStart = txt === '# ' && a > 0 && v[a - 1] !== '\n' ? '\n' : ''; ta.value = v.slice(0, a) + lineStart + txt + v.slice(b); ta.setSelectionRange(a + lineStart.length + txt.length, a + lineStart.length + txt.length); } ta.focus(); ta.dispatchEvent(new Event('input')); }
  async function send() {
    const ta = panel.querySelector('textarea'); const body = ta ? ta.value.trim() : '';
    if (!body && !S.images.length) { S.msg = WHY.empty_body; S.msgOk = false; paint(); return; }
    if (DISCORD.test(body)) { S.msg = WHY.discord_links_not_allowed; S.msgOk = false; paint(); return; }
    const sendBtn = panel.querySelector('.tk-send'); if (sendBtn) sendBtn.disabled = true;
    const mentions = []; for (const [name, id] of S.mentions) if (body.indexOf('@' + name) >= 0) mentions.push({ id, name });
    const r = await api('/' + encodeURIComponent(S.symbol), { method: 'POST', body: { body, parentId: S.replyTo ? S.replyTo.id : null, imageIds: S.images.map((im) => im.id), mentions } });
    if (!r.ok) { S.msg = why(r); S.msgOk = false; paint(); return; }
    if (ta) ta.value = '';
    S.images = []; S.msg = 'Posted.'; S.msgOk = true; S.mentions.clear();
    if (S.replyTo) { const p = S.rows.find((x) => x.id === S.replyTo.id); if (p) p.replies.push(r.comment); S.replyTo = null; } else { S.rows.unshift(r.comment); }
    S.count = (S.count || 0) + 1; paint(); setTimeout(() => { if (S.msg === 'Posted.') { S.msg = ''; paint(); } }, 2500);
  }
  async function addPictures(files) {
    for (const f of Array.from(files || []).slice(0, 4 - S.images.length)) {
      if (f.size > 1_500_000) { S.msg = WHY.file_too_large; S.msgOk = false; paint(); continue; }
      const bytes = await f.arrayBuffer();
      const r = await api('/image', { method: 'POST', raw: bytes, type: f.type || 'application/octet-stream' });
      if (!r.ok) { S.msg = why(r); S.msgOk = false; paint(); continue; }
      S.images.push({ id: r.id, preview: URL.createObjectURL(f) }); S.msg = ''; paint();
    }
  }

  /* ---- @mentions: type @ and pick a member ---- */
  function mentionQuery(inp) { const caret = inp.selectionStart == null ? inp.value.length : inp.selectionStart; const upTo = String(inp.value || '').slice(0, caret); const at = upTo.lastIndexOf('@'); if (at < 0 || (at > 0 && !/\s/.test(upTo[at - 1]))) return null; const q = upTo.slice(at + 1); if (q.length > 24 || /\s/.test(q)) return null; return { at, q }; }
  function closeMenu() { if (S.menu) { S.menu.el.remove(); S.menu = null; } }
  function paintMenu() { if (!S.menu) return; const m = S.menu; m.el.innerHTML = m.items.length ? m.items.map((u, i) => '<button type="button" class="' + (i === m.idx ? 'on' : '') + '" data-pick="' + i + '">@' + esc(u.name) + '</button>').join('') : '<div class="mm-none">' + (m.loading ? 'Searching members…' : 'No member matches') + '</div>'; }
  let menuTimer = 0;
  function openMenu(inp, q) {
    if (!S.menu || S.menu.input !== inp) { closeMenu(); const el = document.createElement('div'); el.className = 'mm'; panel.querySelector('.tk-compose').appendChild(el); el.addEventListener('mousedown', (e) => { const b = e.target.closest && e.target.closest('[data-pick]'); if (b) { e.preventDefault(); pick(Number(b.dataset.pick)); } }); S.menu = { input: inp, el, q: null, items: [], idx: 0, loading: true }; }
    if (S.menu.q !== q) { S.menu.q = q; S.menu.loading = true; S.menu.idx = 0; S.menu.items = []; paintMenu(); clearTimeout(menuTimer); menuTimer = setTimeout(async () => { const r = await api('/members?q=' + encodeURIComponent(q)); if (S.menu && S.menu.q === q) { S.menu.items = r.ok ? (r.users || []) : []; S.menu.loading = false; paintMenu(); } }, 180); }
  }
  function pick(i) { const u = S.menu && S.menu.items[i]; if (!u) return; const inp = S.menu.input, m = mentionQuery(inp); if (!m) { closeMenu(); return; } const caret = inp.selectionStart == null ? inp.value.length : inp.selectionStart; const before = inp.value.slice(0, m.at) + '@' + u.name + ' '; inp.value = before + inp.value.slice(caret); S.mentions.set(u.name, String(u.id)); try { inp.setSelectionRange(before.length, before.length); } catch (_) { /* ignore */ } closeMenu(); inp.focus(); }
  function watchMentions(inp) {
    if (inp.dataset.mm) return; inp.dataset.mm = '1';
    const refresh = () => { const m = mentionQuery(inp); if (m) openMenu(inp, m.q); else if (S.menu && S.menu.input === inp) closeMenu(); };
    inp.addEventListener('input', refresh); inp.addEventListener('click', refresh);
    inp.addEventListener('blur', () => setTimeout(() => { if (S.menu && S.menu.input === inp && document.activeElement !== inp) closeMenu(); }, 150));
    inp.addEventListener('keydown', (e) => {
      if (S.menu && S.menu.input === inp) { const n = Math.max(1, S.menu.items.length); if (e.key === 'ArrowDown') { e.preventDefault(); S.menu.idx = (S.menu.idx + 1) % n; paintMenu(); return; } if (e.key === 'ArrowUp') { e.preventDefault(); S.menu.idx = (S.menu.idx - 1 + n) % n; paintMenu(); return; } if ((e.key === 'Enter' || e.key === 'Tab') && S.menu.items.length) { e.preventDefault(); pick(S.menu.idx); return; } if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; } }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    });
  }

  /* ---- events ---- */
  btn.addEventListener('click', () => { S.open = !S.open; if (S.open) { S.msg = ''; paint(); load(true); } else { closeMenu(); paint(); } });
  panel.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-close],[data-more],[data-reply],[data-cancel-reply],[data-del],[data-ins],[data-pic],[data-send],[data-unpic],[data-sym],[data-ext],[data-zoom]') : null; if (!t) return;
    if (t.dataset.close) { S.open = false; closeMenu(); paint(); return; }
    if (t.dataset.more) { load(false); return; }
    if (t.dataset.reply) { S.replyTo = { id: t.dataset.reply, name: t.dataset.name }; paint(); const ta = panel.querySelector('textarea'); if (ta) ta.focus(); return; }
    if (t.dataset.cancelReply) { S.replyTo = null; paint(); return; }
    if (t.dataset.del) { const id = t.dataset.del; if (!confirm('Delete this comment?')) return; api('/' + encodeURIComponent(S.symbol) + '/' + encodeURIComponent(id), { method: 'DELETE' }).then((r) => { if (!r.ok) { S.msg = why(r); S.msgOk = false; paint(); return; } const root = S.rows.find((x) => x.id === id); if (root) { S.rows = S.rows.filter((x) => x.id !== id); S.count = Math.max(0, (S.count || 1) - 1 - (root.replies || []).length); } else for (const p of S.rows) { const n = p.replies.length; p.replies = p.replies.filter((x) => x.id !== id); if (p.replies.length !== n) S.count = Math.max(0, (S.count || 1) - 1); } paint(); }); return; }
    if (t.dataset.ins) { insert(t.dataset.ins); return; }
    if (t.dataset.pic) { file.value = ''; file.click(); return; }
    if (t.dataset.send) { send(); return; }
    if (t.dataset.unpic) { S.images = S.images.filter((im) => im.id !== t.dataset.unpic); paint(); return; }
    if (t.dataset.sym) { e.preventDefault(); if (window.smlAcademyNavigateMarket) window.smlAcademyNavigateMarket(t.dataset.sym); return; }
    if (t.dataset.ext) { e.preventDefault(); openOutside(t.dataset.ext); return; }
    if (t.dataset.zoom) { t.classList.toggle('big'); }
  });
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));
  file.addEventListener('change', () => { if (file.files && file.files.length) addPictures(file.files); });
  window.addEventListener('sml-academy-market', () => { const sym = symbolNow(); if (sym === S.symbol) return; S.symbol = sym; S.count = null; S.replyTo = null; S.images = []; S.msg = ''; paintButton(); if (S.open) load(true); else refreshCount(); });
  setInterval(() => { if (!document.hidden) { if (S.open && !S.busy) load(true); else refreshCount(); } }, 60_000);
  paintButton(); refreshCount();
  window.smlTickerTalk = { open: () => { if (!S.open) btn.click(); }, state: () => ({ symbol: S.symbol, open: S.open, count: S.count }) };
})(0);
