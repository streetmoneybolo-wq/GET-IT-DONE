/* SML Terminal — NATIVE live feed (Phase 2, replaces the adopted legacy #sml-lf).
   Sources (all the site's own endpoints, nothing invented):
     StockMarketLoop  GET  /wp-json/sml/v1/stream?symbol=        → {messages:[{id,user,side,t,body}]}  (poll 3s)
                      POST /wp-json/sml/v1/stream {symbol, body, side:'bull'|'bear'}  (X-WP-Nonce; signed-in)
     moomoo           GET  /wp-json/sml-ticker-community/v1/moomoo?symbol= → {posts:[{moomoo_name,avatar_url,profile_url,text,date,source_url}],community_url,message}
     Webull           GET  /wp-json/sml-members/v1/webull-feed?symbol=     → {posts:[…],community_url,message}
     Stocktwits       external link (the legacy tab did the same — no API)
     🎙 Voice Room    proxies the legacy #live-voice-room controls (its WebRTC client is the one
                      system we still let boot; it stays hidden)
   Sets window.SML_TV2_NATIVE_FEED=1 synchronously so terminal-adopt.js does not move #sml-lf. */
(function () {
  'use strict';
  if (window.__smlTerminalFeedBooted) return;
  window.__smlTerminalFeedBooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;
  window.SML_TV2_NATIVE_FEED = 1;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  var NONCE = (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var LOGGED = document.body.classList.contains('logged-in');
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function rel(ts) { var t = typeof ts === 'number' ? (ts < 2e10 ? ts * 1000 : ts) : Date.parse(String(ts).replace(' ', 'T')); if (isNaN(t)) return ''; var d = Math.max(0, (Date.now() - t) / 1000); if (d < 60) return 'now'; if (d < 3600) return Math.floor(d / 60) + 'm'; if (d < 86400) return Math.floor(d / 3600) + 'h'; return Math.floor(d / 86400) + 'd'; }
  function linkify(text) { /* $TICKER → terminal link, urls → links (rel noopener), everything else escaped */
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener nofollow">' + u.replace(/^https?:\/\//, '').slice(0, 40) + '</a>'; })
      .replace(/\$([A-Za-z]{1,6})\b/g, function (m, s) { return '<a class="tk" href="/stock-chart/?symbol=' + s.toUpperCase() + '">$' + s.toUpperCase() + '</a>'; });
  }

  var CSS = '' +
    '.tv2-lf{display:flex;flex-direction:column;gap:12px}' +
    '.tv2-lf-tabs{display:flex;gap:6px;flex-wrap:wrap}' +
    '.tv2-lf-tab{font:600 11px/1 Archivo,sans-serif;color:#8fa3b5;background:#0d141c;border:1px solid #16202b;border-radius:999px;padding:8px 14px;cursor:pointer}' +
    '.tv2-lf-tab.on{color:#04060a;background:#00ff88;border-color:#00ff88}' +
    '.tv2-lf-pane{display:none;flex-direction:column;gap:10px}.tv2-lf-pane.on{display:flex}' +
    '.tv2-lf-comp{border:1px solid #16202b;border-radius:10px;background:#0b1119;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '.tv2-lf-comp textarea{width:100%;min-height:64px;resize:vertical;background:#080c12;border:1px solid #16202b;border-radius:8px;color:#e6edf3;font:400 13px/1.5 Archivo,sans-serif;padding:10px;box-sizing:border-box}' +
    '.tv2-lf-comp textarea:focus{outline:none;border-color:#00ff88}' +
    '.tv2-lf-comp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.tv2-lf-side{font:600 11px/1 Archivo,sans-serif;border-radius:999px;padding:7px 12px;cursor:pointer;border:1px solid #16202b;background:transparent;color:#8fa3b5}' +
    '.tv2-lf-side.bull.on{color:#04060a;background:#00ff88;border-color:#00ff88}.tv2-lf-side.bear.on{color:#fff;background:#ff4757;border-color:#ff4757}' +
    '.tv2-lf-post{margin-left:auto;font:700 12px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border:none;border-radius:999px;padding:9px 16px;cursor:pointer}.tv2-lf-post[disabled]{opacity:.5;cursor:default}' +
    '.tv2-lf-note{font:500 10.5px/1.5 "IBM Plex Mono",monospace;color:#5d7085}.tv2-lf-note.err{color:#ff859f}' +
    '.tv2-lf-gate{border:1px dashed #1d2b39;border-radius:10px;padding:14px;font:500 12px/1.6 Archivo,sans-serif;color:#8fa3b5}.tv2-lf-gate a{color:#00ff88;font-weight:700}' +
    '.tv2-lf-list{display:flex;flex-direction:column;gap:8px;max-height:560px;overflow:auto;padding-right:4px}' +
    '.tv2-lf-msg{display:flex;gap:10px;border:1px solid #131c26;border-radius:10px;background:#0b1119;padding:10px 12px}' +
    '.tv2-lf-av{width:34px;height:34px;border-radius:50%;flex:none;background:#131c26 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font:700 12px Archivo,sans-serif;color:#00ff88}' +
    '.tv2-lf-bd{flex:1;min-width:0}.tv2-lf-meta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}' +
    '.tv2-lf-user{font:700 12px/1 Archivo,sans-serif;color:#e6edf3}.tv2-lf-user a{color:inherit;text-decoration:none}.tv2-lf-time{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-lf-badge{font:700 9px/1 "IBM Plex Mono",monospace;letter-spacing:.08em;border-radius:999px;padding:3px 7px}.tv2-lf-badge.bull{color:#04060a;background:#00ff88}.tv2-lf-badge.bear{color:#fff;background:#ff4757}' +
    '.tv2-lf-text{font:400 13px/1.55 Archivo,sans-serif;color:#c9d6e2;margin-top:4px;word-break:break-word}.tv2-lf-text a{color:#00ccff}.tv2-lf-text a.tk{color:#00ff88;font-weight:700}' +
    '.tv2-lf-src{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085;margin-top:6px}.tv2-lf-src a{color:#5d7085}' +
    '.tv2-lf-empty{padding:18px 14px;font:500 12px/1.6 "IBM Plex Mono",monospace;color:#5d7085;text-align:center;border:1px dashed #1d2b39;border-radius:10px}' +
    '.tv2-lf-ext{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #16202b;border-radius:10px;background:#0b1119;padding:12px 14px;font:500 12px/1.5 Archivo,sans-serif;color:#8fa3b5}.tv2-lf-ext a{color:#00ff88;font-weight:700;white-space:nowrap}' +
    '.tv2-lf-voice{padding:18px 16px;background:#0d141c;border:1px solid #134a33;border-radius:10px}' +
    '.tv2-lf-voice h4{margin:0 0 4px;font:600 13px Archivo,sans-serif;color:#e6edf3}.tv2-lf-voice .st{font:400 11px/1.5 "IBM Plex Mono",monospace;color:#8fa3b5;margin-bottom:12px}' +
    '.tv2-lf-voice .row{display:flex;gap:10px;flex-wrap:wrap}.tv2-lf-voice button{padding:8px 18px;border-radius:999px;font:600 12px Archivo,sans-serif;cursor:pointer;border:1px solid #1c2833;background:#131c26;color:#8fa3b5}' +
    '.tv2-lf-voice button.join{border-color:#134a33;background:linear-gradient(180deg,#00ff88,#00c86b);color:#04120b}.tv2-lf-voice button.leave{border-color:#4a1d24;background:#1a0d10;color:#ff4757}';

  var S = { tab: 'sml', msgs: [], seen: {}, side: 'bull', pollT: null, mm: null, wb: null };

  function card(root) {
    var el = document.createElement('div'); el.className = 'tv2-lf'; el.setAttribute('data-tv2-keep', '1');
    el.innerHTML =
      '<div class="tv2-lf-tabs">' + [['sml', 'StockMarketLoop'], ['moomoo', 'moomoo'], ['stocktwits', 'Stocktwits'], ['webull', 'Webull'], ['voice', '🎙 Voice Room']].map(function (t) { return '<button type="button" class="tv2-lf-tab' + (t[0] === S.tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="tv2-lf-pane on" data-pane="sml">' +
        (LOGGED ? '<div class="tv2-lf-comp"><textarea id="tv2lf-text" maxlength="600" placeholder="Share your take on $' + esc(SYM) + '…"></textarea><div class="tv2-lf-comp-row"><button type="button" class="tv2-lf-side bull on" data-side="bull">Bullish</button><button type="button" class="tv2-lf-side bear" data-side="bear">Bearish</button><span class="tv2-lf-note" id="tv2lf-note"></span><button type="button" class="tv2-lf-post" id="tv2lf-post">Post</button></div></div>'
                : '<div class="tv2-lf-gate"><a href="/login/?redirect_to=' + encodeURIComponent(location.href) + '">Sign in</a> to post on the $' + esc(SYM) + ' stream. Reading is open to everyone.</div>') +
        '<div class="tv2-lf-list" id="tv2lf-list"><div class="tv2-lf-empty">Loading the $' + esc(SYM) + ' stream…</div></div>' +
      '</div>' +
      '<div class="tv2-lf-pane" data-pane="moomoo"><div class="tv2-lf-list" id="tv2lf-mm"><div class="tv2-lf-empty">Loading moomoo posts…</div></div></div>' +
      '<div class="tv2-lf-pane" data-pane="stocktwits"><div class="tv2-lf-ext"><span>Stocktwits conversation for $' + esc(SYM) + ' opens on stocktwits.com (no on-site feed).</span><a href="https://stocktwits.com/symbol/' + encodeURIComponent(SYM) + '" target="_blank" rel="noopener nofollow">Open Stocktwits ↗</a></div></div>' +
      '<div class="tv2-lf-pane" data-pane="webull"><div class="tv2-lf-list" id="tv2lf-wb"><div class="tv2-lf-empty">Loading Webull posts…</div></div></div>' +
      '<div class="tv2-lf-pane" data-pane="voice"><div class="tv2-lf-voice"><h4>Live Voice Room</h4><div class="st" id="tv2lf-vstatus">Connecting to the room system…</div><div class="row"><button type="button" class="join" data-v="join">Join</button><button type="button" data-v="listen">Listen only</button><button type="button" data-v="mute">Mute</button><button type="button" class="leave" data-v="leave">Leave</button></div></div></div>';
    return el;
  }

  function avatarHTML(name, url) { return url ? '<div class="tv2-lf-av" style="background-image:url(\'' + esc(url) + '\')"></div>' : '<div class="tv2-lf-av">' + esc(String(name || '?').replace(/^@/, '').slice(0, 2).toUpperCase()) + '</div>'; }
  function userOf(m) { var u = m.user; if (u && typeof u === 'object') return { name: u.display_name || u.name || u.handle || u.login || 'member', handle: u.handle || u.public_handle || '', avatar: u.avatar || u.avatar_url || '', url: u.url || u.profile_url || '' }; return { name: String(u || m.handle || m.author || 'member'), handle: '', avatar: m.avatar || m.avatar_url || '', url: '' }; }

  function renderStream(el) {
    var list = el.querySelector('#tv2lf-list');
    if (!S.msgs.length) { list.innerHTML = '<div class="tv2-lf-empty">No posts on the $' + esc(SYM) + ' stream yet' + (LOGGED ? ' — be the first.' : '.') + '</div>'; return; }
    list.innerHTML = S.msgs.map(function (m) {
      var u = userOf(m); var side = (m.side === 'bear' || m.side === 'bearish') ? 'bear' : ((m.side === 'bull' || m.side === 'bullish') ? 'bull' : '');
      return '<div class="tv2-lf-msg" data-id="' + esc(m.id) + '">' + avatarHTML(u.name, u.avatar) + '<div class="tv2-lf-bd"><div class="tv2-lf-meta"><span class="tv2-lf-user">' + (u.url ? '<a href="' + esc(u.url) + '">' : '') + esc(u.name.replace(/^@/, '')) + (u.url ? '</a>' : '') + '</span>' + (side ? '<span class="tv2-lf-badge ' + side + '">' + (side === 'bull' ? 'BULLISH' : 'BEARISH') + '</span>' : '') + '<span class="tv2-lf-time">' + esc(rel(m.t || m.time || m.created || m.at)) + '</span></div><div class="tv2-lf-text">' + linkify(m.body || m.text || m.message || '') + '</div></div></div>';
    }).join('');
  }
  var firstLoad = true;
  function pollStream(el) {
    if (document.hidden && !firstLoad) return;   /* always fetch once; background tabs skip the 3s polls */
    firstLoad = false;
    fetch('/wp-json/sml/v1/stream?symbol=' + encodeURIComponent(SYM), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var ms = (j && (j.messages || j.items || j.posts)) || [];
        /* newest first, dedupe by id */
        var out = [], seen = {};
        ms.forEach(function (m) { var id = String(m.id != null ? m.id : (m.t || '') + (m.body || '').slice(0, 20)); if (seen[id]) return; seen[id] = 1; out.push(m); });
        out.sort(function (a, b) { var ta = Number(a.t) || Date.parse(a.t) || 0, tb = Number(b.t) || Date.parse(b.t) || 0; return tb - ta; });
        S.msgs = out; renderStream(el);
      }).catch(function () { if (!S.msgs.length) el.querySelector('#tv2lf-list').innerHTML = '<div class="tv2-lf-empty">The stream is not responding right now.</div>'; });
  }
  function post(el) {
    var ta = el.querySelector('#tv2lf-text'), btn = el.querySelector('#tv2lf-post'), note = el.querySelector('#tv2lf-note');
    var body = (ta.value || '').trim(); if (!body) { note.textContent = 'Write something first.'; note.className = 'tv2-lf-note err'; return; }
    btn.disabled = true; note.textContent = 'Posting…'; note.className = 'tv2-lf-note';
    fetch('/wp-json/sml/v1/stream', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE }, body: JSON.stringify({ symbol: SYM, body: body, side: S.side }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { note.textContent = (res.j && res.j.message) || 'Could not post.'; note.className = 'tv2-lf-note err'; return; }
        ta.value = ''; note.textContent = 'Posted.'; note.className = 'tv2-lf-note'; pollStream(el);
      }).catch(function () { btn.disabled = false; note.textContent = 'Could not reach the stream.'; note.className = 'tv2-lf-note err'; });
  }

  function renderExternal(el, id, data, label) {
    var list = el.querySelector(id);
    var posts = (data && data.posts) || [];
    var foot = data && data.community_url ? '<div class="tv2-lf-ext"><span>' + esc(label) + ' community for $' + esc(SYM) + '</span><a href="' + esc(data.community_url) + '" target="_blank" rel="noopener nofollow">Open on ' + esc(label) + ' ↗</a></div>' : '';
    if (!posts.length) { list.innerHTML = '<div class="tv2-lf-empty">' + esc((data && data.message) || ('No ' + label + ' posts for $' + SYM + ' right now.')) + '</div>' + foot; return; }
    list.innerHTML = posts.map(function (p) {
      var name = p.moomoo_name || p.author || p.user || p.name || label;
      return '<div class="tv2-lf-msg">' + avatarHTML(name, p.avatar_url || p.avatar) + '<div class="tv2-lf-bd"><div class="tv2-lf-meta"><span class="tv2-lf-user">' + (p.profile_url ? '<a href="' + esc(p.profile_url) + '" target="_blank" rel="noopener nofollow">' : '') + esc(name) + (p.profile_url ? '</a>' : '') + '</span><span class="tv2-lf-time">' + esc(rel(p.date || p.time || p.created)) + '</span></div><div class="tv2-lf-text">' + linkify(p.text || p.body || '') + '</div>' + (p.source_url ? '<div class="tv2-lf-src"><a href="' + esc(p.source_url) + '" target="_blank" rel="noopener nofollow">view on ' + esc(label) + ' ↗</a></div>' : '') + '</div></div>';
    }).join('') + foot;
  }
  function loadExternal(el, kind) {
    var url = kind === 'moomoo' ? '/wp-json/sml-ticker-community/v1/moomoo?symbol=' : '/wp-json/sml-members/v1/webull-feed?symbol=';
    var id = kind === 'moomoo' ? '#tv2lf-mm' : '#tv2lf-wb', label = kind === 'moomoo' ? 'moomoo' : 'Webull';
    fetch(url + encodeURIComponent(SYM), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { renderExternal(el, id, j, label); })
      .catch(function () { el.querySelector(id).innerHTML = '<div class="tv2-lf-empty">' + label + ' is not responding right now.</div>'; });
  }

  /* voice: proxy the hidden legacy room's controls (the WebRTC client keeps working) */
  function wireVoice(el) {
    var st = el.querySelector('#tv2lf-vstatus'); var timer = null;
    function room() { return document.getElementById('live-voice-room'); }
    function legacyBtn(rx) { var r = room(); if (!r) return null; var bs = [].slice.call(r.querySelectorAll('button, [role="button"], a')); return bs.filter(function (b) { return rx.test((b.textContent || '').trim()); })[0] || null; }
    function mirror() { var r = room(); if (!r) { st.textContent = 'The voice room system is not loaded on this page.'; return; } var t = (r.innerText || '').replace(/\s+/g, ' ').trim(); st.textContent = t ? t.slice(0, 160) : 'Room idle.'; }
    el.querySelector('.tv2-lf-voice').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-v]'); if (!b) return;
      var map = { join: /join/i, listen: /listen/i, mute: /mute|unmute/i, leave: /leave|exit/i };
      var lb = legacyBtn(map[b.getAttribute('data-v')]);
      if (lb) { try { lb.click(); } catch (e) {} setTimeout(mirror, 400); } else st.textContent = 'That control isn’t available right now (the room system hasn’t offered it yet).';
    });
    return { start: function () { mirror(); timer = setInterval(mirror, 1500); }, stop: function () { if (timer) clearInterval(timer); timer = null; } };
  }

  function wire(el) {
    var voice = wireVoice(el);
    el.querySelector('.tv2-lf-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      S.tab = b.getAttribute('data-tab');
      Array.prototype.forEach.call(el.querySelectorAll('.tv2-lf-tab'), function (x) { x.classList.toggle('on', x === b); });
      Array.prototype.forEach.call(el.querySelectorAll('.tv2-lf-pane'), function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === S.tab); });
      if (S.tab === 'moomoo' && !S.mm) { S.mm = 1; loadExternal(el, 'moomoo'); }
      if (S.tab === 'webull' && !S.wb) { S.wb = 1; loadExternal(el, 'webull'); }
      if (S.tab === 'voice') voice.start(); else voice.stop();
    });
    Array.prototype.forEach.call(el.querySelectorAll('.tv2-lf-side'), function (b) { b.addEventListener('click', function () { S.side = b.getAttribute('data-side'); Array.prototype.forEach.call(el.querySelectorAll('.tv2-lf-side'), function (x) { x.classList.toggle('on', x === b); }); }); });
    var pb = el.querySelector('#tv2lf-post'); if (pb) pb.addEventListener('click', function () { post(el); });
    var ta = el.querySelector('#tv2lf-text'); if (ta) ta.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post(el); });
    pollStream(el); S.pollT = setInterval(function () { pollStream(el); }, 3000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pollStream(el); });
  }

  function mount() {
    var main = document.querySelector('#sml-tv2-root [data-tv2-zone="main"]');
    if (!main || main.children.length < 3) return false;
    /* the design's feed card = the first DESIGN card whose text mentions "Live feed" */
    var cardEl = null;
    Array.prototype.forEach.call(main.children, function (c) { if (!cardEl && !c.hasAttribute('data-tv2-keep') && !/(^|\s)tv2-/.test(c.className || '') && /live feed/i.test(c.textContent || '')) cardEl = c; });
    if (!cardEl) return false;
    if (cardEl.querySelector('.tv2-lf')) return true;
    if (!document.getElementById('tv2-lf-css')) { var st = document.createElement('style'); st.id = 'tv2-lf-css'; st.textContent = CSS; document.head.appendChild(st); }
    /* keep the design card's header row, hide its sample body, mount ours */
    var kids = [].slice.call(cardEl.children);
    for (var i = 1; i < kids.length; i++) if (!kids[i].hasAttribute('data-tv2-keep')) kids[i].style.display = 'none';
    var el = card(); cardEl.appendChild(el); wire(el);
    return true;
  }
  var tries = 0;
  var t = setInterval(function () { var ok = false; try { ok = mount(); } catch (e) {} if (ok || ++tries > 60) clearInterval(t); }, 250);
})();
