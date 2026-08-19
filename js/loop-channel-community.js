/* SML Loop Channel — Community (Posts / Live chat) + YOUR TICKERS chips.
   Design: Loop Channel.dc.html (COMMUNITY block, YOUR TICKERS row, ticker popovers).
   Data (all real):
     posts/votes/replies/chat  → sml-channel/v1/channel/{h}/community, /community/post|vote|reply|manage, /chat
     the channel's other public content (videos, chart/stream posts) → channel payload .posts (read-only rows)
     YOUR TICKERS → sml-members/v1/watchlist (the viewer's own; hidden when empty or signed out)
     ticker popover → sml/v1/ticker-card?symbol= (price, % change, 30-pt sparkline)
   Exposed as window.SML_CH_COMMUNITY.mount(ctx) and called by loop-channel.js. */
(function () {
  'use strict';
  var API = null, ROOT = null, HANDLE = '', ME = null, OWNER = false, esc = null, ago = null, safeImage = null, fmt = null;
  var S = { view: 'posts', posts: [], legacy: [], chat: [], viewer: null, canPost: false, open: {}, chatOpen: {}, draft: '', chatDraft: '', chatSince: 0, chatTimer: null, err: '', ticker: '', tickers: [], videos: [] };
  var el = function (sel) { return ROOT.querySelector(sel); };

  /* ---------- ticker tokens + popover ---------- */
  var TCACHE = {};
  function segs(text) {
    return esc(text).replace(/(^|[\s(])\$([A-Za-z]{1,6})\b/g, function (m, pre, sym) { return pre + '<span class="lch-tk" data-tk="' + sym.toUpperCase() + '">$' + sym.toUpperCase() + '</span>'; });
  }
  function tickerCard(sym) {
    if (TCACHE[sym]) return Promise.resolve(TCACHE[sym]);
    return API('/sml/v1/ticker-card?symbol=' + encodeURIComponent(sym)).then(function (r) { if (r.ok && r.j && r.j.symbol) { TCACHE[sym] = r.j; return r.j; } return null; });
  }
  function spark(points, up) {
    if (!points || points.length < 2) return '';
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points), span = (max - min) || 1;
    var pts = points.map(function (v, i) { return (i / (points.length - 1) * 190).toFixed(1) + ',' + (44 - ((v - min) / span) * 40 + 1).toFixed(1); }).join(' ');
    return '<svg width="100%" height="46" viewBox="0 0 190 46" preserveAspectRatio="none" style="display:block"><polyline points="' + pts + '" fill="none" stroke="' + (up ? '#00ff88' : '#ff5e6e') + '" stroke-width="1.6"></polyline></svg>';
  }
  var pop;
  function showPop(anchor, sym) {
    hidePop();
    pop = document.createElement('div'); pop.className = 'lch-tkpop'; pop.innerHTML = '<span class="s">' + esc(sym) + '</span><span class="lch-muted" style="font-size:9px">loading…</span>';
    document.body.appendChild(pop); placePop(anchor);
    tickerCard(sym).then(function (c) {
      if (!pop || pop.getAttribute('data-sym') !== sym) return;
      if (!c) { pop.innerHTML = '<span class="s">' + esc(sym) + '</span><span class="lch-muted" style="font-size:9px">No quote available</span>'; return; }
      var up = (+c.change || 0) >= 0, chg = (up ? '+' : '') + (+c.percentChange || 0).toFixed(2) + '%';
      pop.innerHTML = '<span style="display:flex;align-items:baseline;justify-content:space-between"><span class="s">' + esc(c.symbol) + '</span><span style="display:flex;align-items:baseline;gap:7px"><span class="px">' + esc(fmtPx(c.current)) + '</span><span class="chg ' + (up ? 'up' : 'dn') + '">' + esc(chg) + '</span></span></span>' +
        (c.name ? '<span class="lch-muted" style="font-size:9px">' + esc(c.name) + '</span>' : '') + spark(c.sparkline, up) +
        '<span style="display:flex;align-items:center;justify-content:space-between"><span class="lch-muted" style="font-size:8px;letter-spacing:.06em">' + (c.stale ? 'DELAYED' : 'INTRADAY · LIVE') + '</span><a href="/stock-chart/?symbol=' + encodeURIComponent(c.symbol) + '" style="font:700 9px/1 var(--chfont);color:#00ccff">🚪 Open terminal →</a></span>';
      placePop(anchor);
    });
    pop.setAttribute('data-sym', sym);
  }
  function fmtPx(v) { v = +v || 0; return v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toFixed(2); }
  function placePop(anchor) {
    if (!pop) return; var r = anchor.getBoundingClientRect(); var w = 238;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    pop.style.left = left + 'px';
    var below = r.bottom + 9 + 130 < window.innerHeight; pop.style.top = (below ? r.bottom + 9 : Math.max(8, r.top - 9 - pop.offsetHeight)) + window.scrollY + 'px';
  }
  function hidePop() { if (pop) { pop.remove(); pop = null; } }
  var popTimer;
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('.lch-tk, .lch-tkchip'); if (!t) return; clearTimeout(popTimer); showPop(t, t.getAttribute('data-tk')); });
  document.addEventListener('mouseout', function (e) { var t = e.target.closest && e.target.closest('.lch-tk, .lch-tkchip'); if (!t) return; popTimer = setTimeout(function () { if (!(pop && pop.matches(':hover'))) hidePop(); }, 220); });
  document.addEventListener('click', function (e) { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.lch-tk, .lch-tkchip'))) hidePop(); });

  /* ---------- YOUR TICKERS chips (viewer's watchlist) → filters LATEST by ticker ---------- */
  function loadTickers() {
    var mount = el('#ch-tickers'); if (!mount) return;
    if (!ME) { mount.innerHTML = ''; return; }
    API('/sml-members/v1/watchlist').then(function (r) {
      var list = (r.ok && r.j && (r.j.watchlist || r.j.items || r.j.symbols)) || [];
      S.tickers = list.map(function (x) { return String(typeof x === 'string' ? x : (x.symbol || x.ticker || x.sym || '')).toUpperCase().replace(/^\$/, ''); }).filter(Boolean).slice(0, 8);
      renderTickers();
      S.tickers.slice(0, 8).forEach(function (sym) { tickerCard(sym).then(function () { renderTickers(); }); });
    });
  }
  function renderTickers() {
    var mount = el('#ch-tickers'); if (!mount) return;
    if (!S.tickers.length) { mount.innerHTML = ''; return; }
    mount.innerHTML = '<div class="lch-tkrow"><span class="lch-tkrow-h">YOUR TICKERS</span>' + S.tickers.map(function (sym) {
      var c = TCACHE[sym]; var up = c ? (+c.change || 0) >= 0 : true;
      var chg = c ? ((up ? '+' : '') + (+c.percentChange || 0).toFixed(2) + '%') : '';
      return '<span class="lch-tkchip' + (S.ticker === sym ? ' on' : '') + '" data-tk="' + esc(sym) + '" title="Show ' + esc(sym) + ' videos"><b>' + esc(sym) + '</b>' + (chg ? '<i class="' + (up ? 'up' : 'dn') + '">' + esc(chg) + '</i>' : '') + '</span>';
    }).join('') + '<span class="lch-tkrow-n">from your watchlist</span></div>';
    Array.prototype.forEach.call(mount.querySelectorAll('.lch-tkchip'), function (chip) {
      chip.onclick = function () { var sym = chip.getAttribute('data-tk'); S.ticker = S.ticker === sym ? '' : sym; hidePop(); renderTickers(); if (window.SML_CH_ORBIT_FILTER) window.SML_CH_ORBIT_FILTER(S.ticker); };
    });
  }

  /* ---------- community ---------- */
  function person(u) {
    u = u || {}; var av = safeImage(u.avatar);
    return '<span class="lch-cav"' + (av ? ' style="background-image:url(&quot;' + esc(av) + '&quot;)"' : '') + '></span><span class="lch-cuser">' + esc(u.name || u.handle || 'Member') + '</span>' +
      (u.isCreator ? '<span class="lch-cbadge creator">CREATOR</span>' : '') + (u.isMod ? '<span class="lch-cbadge mod">' + esc((window.SML_CH_MOD_ROLE || 'MOD').toUpperCase()) + '</span>' : '');
  }
  function linkCard(url) {
    var host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
    return '<a class="lch-clink" href="' + esc(url) + '" target="_blank" rel="noopener"><span class="d">' + esc(host) + '</span><span class="t">' + esc(url.length > 70 ? url.slice(0, 70) + '…' : url) + '</span><span class="a">↗</span></a>';
  }
  function postRow(p) {
    var open = !!S.open[p.id];
    var body = p.body || ''; if (p.link) body = body.replace(p.link, '').trim();
    return '<div class="lch-cpost" data-post="' + p.id + '">' +
      '<div class="lch-cvote"><button class="up' + (p.myVote === 1 ? ' on' : '') + '" data-vote="1" aria-label="Upvote">▲</button><span class="score' + (p.score > 0 ? ' pos' : p.score < 0 ? ' neg' : '') + '">' + fmt(p.score) + '</span><button class="dn' + (p.myVote === -1 ? ' on' : '') + '" data-vote="-1" aria-label="Downvote">▼</button></div>' +
      '<div class="lch-cbody">' +
        '<div class="lch-chead">' + person(p.user) + (p.user && p.user.isCreator ? '<span class="lch-cbadge ann">📣 ANNOUNCEMENT</span>' : '') + (p.pinned ? '<span class="lch-cbadge pin">📌 PINNED</span>' : '') + '<span class="lch-cwhen">' + esc(ago(p.at)) + '</span>' +
          (OWNER || p.canDelete ? '<span class="lch-cmenu">' + (OWNER ? '<button data-manage="' + (p.pinned ? 'unpin' : 'pin') + '">' + (p.pinned ? 'Unpin' : 'Pin') + '</button>' : '') + (p.canDelete ? '<button data-manage="delete">Remove</button>' : '') + '</span>' : '') + '</div>' +
        (p.title ? '<div class="lch-ctitle">' + segs(p.title) + '</div>' : '') +
        (body ? '<div class="lch-ctext">' + segs(body) + '</div>' : '') +
        (p.link ? linkCard(p.link) : '') +
        '<div class="lch-cactions"><button data-toggle="1">💬 ' + (p.replies.length ? p.replies.length + (p.replies.length === 1 ? ' reply' : ' replies') : 'Reply') + '</button><button data-share="1">⤴ Share</button></div>' +
        (open ? '<div class="lch-creplies">' + p.replies.map(function (r) { return '<div class="lch-creply"><span class="lch-cav sm"' + (safeImage(r.user.avatar) ? ' style="background-image:url(&quot;' + esc(r.user.avatar) + '&quot;)"' : '') + '></span><div><div class="lch-chead">' + '<span class="lch-cuser">' + esc(r.user.name) + '</span>' + (r.user.isCreator ? '<span class="lch-cbadge creator">CREATOR</span>' : '') + '<span class="lch-cwhen">' + esc(ago(r.at)) + '</span></div><div class="lch-ctext sm">' + segs(r.body) + '</div></div></div>'; }).join('') +
          (ME ? '<div class="lch-creplybox"><input type="text" placeholder="Reply…" maxlength="1000"><button data-reply="1">Reply</button></div>' : '<span class="lch-muted" style="font-size:10px">Sign in to reply</span>') + '</div>' : '') +
      '</div></div>';
  }
  function legacyRow(p) {
    var tags = (p.tickers || []).slice(0, 4).map(function (t) { return '$' + String(t).replace(/^\$/, ''); }).join(' ');
    var image = safeImage(p.image);
    var inner = '<div class="lch-chead"><span class="lch-cbadge kind">' + esc(String(p.kind || 'post').replace(/_/g, ' ')) + '</span><span class="lch-cwhen">' + esc(ago(p.date)) + '</span></div>' +
      (p.title ? '<div class="lch-ctitle">' + segs(p.title) + '</div>' : '') + (p.body ? '<div class="lch-ctext">' + segs(p.body) + '</div>' : '') +
      (image ? '<span class="lch-cimg" style="background-image:url(&quot;' + esc(image) + '&quot;)"></span>' : '') + (tags ? '<div class="lch-ctext sm">' + segs(tags) + '</div>' : '');
    return '<div class="lch-cpost legacy"><div class="lch-cvote muted">·</div><div class="lch-cbody">' + (p.url ? '<a class="lch-clegacy" href="' + esc(p.url) + '">' + inner + '</a>' : inner) + '</div></div>';
  }
  function chatRow(m, replies) {
    var open = !!S.chatOpen[m.id];
    return '<div class="lch-cmsg" data-msg="' + m.id + '"><span class="lch-cav sm"' + (safeImage(m.user.avatar) ? ' style="background-image:url(&quot;' + esc(m.user.avatar) + '&quot;)"' : '') + '></span><div class="lch-cmsg-b">' +
      '<div class="lch-chead"><span class="lch-cuser">' + esc(m.user.name) + '</span>' + (m.user.isCreator ? '<span class="lch-cbadge creator">CREATOR</span>' : '') + (m.user.isMod ? '<span class="lch-cbadge mod">MOD</span>' : '') + '<span class="lch-cwhen">' + esc(ago(m.at)) + '</span></div>' +
      '<div class="lch-ctext sm">' + segs(m.body) + '</div>' +
      (replies.length ? '<button class="lch-cthread" data-thread="1">' + (open ? 'Hide' : 'Show') + ' ' + replies.length + (replies.length === 1 ? ' reply' : ' replies') + '</button>' : '') +
      (ME ? '<button class="lch-cthread" data-replyto="1">Reply</button>' : '') +
      (ME && (OWNER || (m.user && m.user.id === (S.viewer && S.viewer.id)) || (S.viewer && S.viewer.isMod)) ? '<button class="lch-cthread" style="color:#5d7085" data-cdel="1">Remove</button>' : '') +
      (open ? '<div class="lch-creplies">' + replies.map(function (r) { return '<div class="lch-creply"><span class="lch-cav sm"' + (safeImage(r.user.avatar) ? ' style="background-image:url(&quot;' + esc(r.user.avatar) + '&quot;)"' : '') + '></span><div><div class="lch-chead"><span class="lch-cuser">' + esc(r.user.name) + '</span><span class="lch-cwhen">' + esc(ago(r.at)) + '</span></div><div class="lch-ctext sm">' + segs(r.body) + '</div></div></div>'; }).join('') + '</div>' : '') +
      '</div></div>';
  }
  function render() {
    var mount = el('#ch-community'); if (!mount) return;
    var postsOn = S.view === 'posts';
    var count = S.posts.length + S.legacy.length;
    var meta = postsOn ? (count ? count + (count === 1 ? ' post' : ' posts') : 'be the first to post') : (S.chat.length ? S.chat.length + ' messages' : 'always on, even off-stream');
    var html = '<section class="lch-community"><div class="lch-section-h"><span class="t gold">▮ COMMUNITY</span><span class="meta">' + esc(meta) + '</span><div class="rule"></div>' +
      '<div class="lch-cswitch"><button class="' + (postsOn ? 'on' : '') + '" data-view="posts">‹ Posts</button><button class="' + (!postsOn ? 'on' : '') + '" data-view="chat">Live chat ›</button></div></div>' +
      '<div class="lch-cbox">';
    if (postsOn) {
      html += (ME ? '<div class="lch-ccompose"><span class="lch-cav"' + (S.viewer && safeImage(S.viewer.avatar) ? ' style="background-image:url(&quot;' + esc(S.viewer.avatar) + '&quot;)"' : '') + '></span><input id="ch-cdraft" type="text" maxlength="2000" placeholder="' + (OWNER ? 'Post an announcement to your community…' : 'Share a thought with the community…') + '" value="' + esc(S.draft) + '"><button id="ch-cpost" class="lch-cbtn"' + (S.draft.trim() ? '' : ' disabled') + '>Post</button></div>' : '<div class="lch-ccompose"><span class="lch-muted" style="font-size:11px">Sign in to post in this community.</span></div>') +
        (S.err ? '<div class="lch-cerr">' + esc(S.err) + '</div>' : '') +
        S.posts.map(postRow).join('') + S.legacy.map(legacyRow).join('') +
        (!count ? '<div class="lch-cempty">' + (OWNER ? 'Your first post shows up here for every visitor — announcements get the CREATOR badge.' : 'No posts yet.') + '</div>' : '');
    } else {
      var top = S.chat.filter(function (m) { return !m.parent; }); var byParent = {};
      S.chat.forEach(function (m) { if (m.parent) { (byParent[m.parent] = byParent[m.parent] || []).push(m); } });
      html += '<div class="lch-cchat-h"><span class="dot"></span><span>CHANNEL LIVE CHAT</span><span class="lch-muted" style="font-size:8px">threaded · always on, even off-stream</span></div>' +
        '<div class="lch-cchat" id="ch-cchat">' + (top.length ? top.map(function (m) { return chatRow(m, byParent[m.id] || []); }).join('') : '<div class="lch-cempty">Quiet in here — say hi.</div>') + '</div>' +
        (S.err ? '<div class="lch-cerr">' + esc(S.err) + '</div>' : '') +
        (ME ? '<div class="lch-cchat-in">' + (S.replyTo ? '<span class="lch-creplyto">replying · <button data-cancelreply="1">✕</button></span>' : '') + '<input id="ch-chdraft" type="text" maxlength="500" placeholder="Chat with the community…" value="' + esc(S.chatDraft) + '"><button id="ch-chsend" class="lch-cbtn">Send</button></div>' : '<div class="lch-cchat-in"><span class="lch-muted" style="font-size:11px">Sign in to chat.</span></div>');
    }
    html += '</div></section>';
    mount.innerHTML = html;
    bind();
    if (!postsOn) { var box = el('#ch-cchat'); if (box) box.scrollTop = box.scrollHeight; }
  }
  function bind() {
    var mount = el('#ch-community');
    Array.prototype.forEach.call(mount.querySelectorAll('[data-view]'), function (b) { b.onclick = function () { S.view = b.getAttribute('data-view'); S.err = ''; render(); if (S.view === 'chat') startChat(); else stopChat(); }; });
    var d = el('#ch-cdraft'); if (d) { d.oninput = function () { S.draft = d.value; el('#ch-cpost').disabled = !S.draft.trim(); }; d.onkeydown = function (e) { if (e.key === 'Enter' && S.draft.trim()) submitPost(); }; }
    var pb = el('#ch-cpost'); if (pb) pb.onclick = submitPost;
    Array.prototype.forEach.call(mount.querySelectorAll('.lch-cpost[data-post]'), function (row) {
      var id = +row.getAttribute('data-post');
      Array.prototype.forEach.call(row.querySelectorAll('[data-vote]'), function (b) { b.onclick = function () { vote(id, +b.getAttribute('data-vote')); }; });
      var tg = row.querySelector('[data-toggle]'); if (tg) tg.onclick = function () { S.open[id] = !S.open[id]; render(); if (S.open[id]) { var i = row.querySelector('.lch-creplybox input'); } };
      var sh = row.querySelector('[data-share]'); if (sh) sh.onclick = function () { share(sh, location.origin + location.pathname + '#post-' + id); };
      Array.prototype.forEach.call(row.querySelectorAll('[data-manage]'), function (b) { b.onclick = function () { manage(id, b.getAttribute('data-manage')); }; });
      var rb = row.querySelector('[data-reply]'); if (rb) { var inp = row.querySelector('.lch-creplybox input'); rb.onclick = function () { reply(id, inp.value); }; inp.onkeydown = function (e) { if (e.key === 'Enter') reply(id, inp.value); }; }
    });
    var cd = el('#ch-chdraft'); if (cd) { cd.oninput = function () { S.chatDraft = cd.value; }; cd.onkeydown = function (e) { if (e.key === 'Enter') sendChat(); }; }
    var cs = el('#ch-chsend'); if (cs) cs.onclick = sendChat;
    Array.prototype.forEach.call(mount.querySelectorAll('.lch-cmsg'), function (row) {
      var id = +row.getAttribute('data-msg');
      var t = row.querySelector('[data-thread]'); if (t) t.onclick = function () { S.chatOpen[id] = !S.chatOpen[id]; render(); };
      var r = row.querySelector('[data-replyto]'); if (r) r.onclick = function () { S.replyTo = id; render(); var i = el('#ch-chdraft'); if (i) i.focus(); };
      var dl = row.querySelector('[data-cdel]'); if (dl) dl.onclick = function () { if (!confirm('Remove this message?')) return; API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/chat/manage', { method: 'POST', body: JSON.stringify({ message_id: id }) }).then(function (r) { if (r.ok && r.j && r.j.chat) { S.chat = r.j.chat; render(); } else fail(r, 'Could not remove.'); }); };
    });
    var cr = mount.querySelector('[data-cancelreply]'); if (cr) cr.onclick = function () { S.replyTo = 0; render(); };
  }
  function share(btn, url) {
    var done = function () { var t = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(function () { btn.textContent = t; }, 1500); };
    if (navigator.share) navigator.share({ url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () {});
  }
  function fail(r, fallback) { S.err = (r && r.j && r.j.message) || fallback; render(); setTimeout(function () { S.err = ''; render(); }, 3500); }
  function submitPost() {
    if (!S.draft.trim()) return; var body = S.draft;
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/community/post', { method: 'POST', body: JSON.stringify({ body: body }) }).then(function (r) {
      if (r.ok && r.j && r.j.posts) { S.draft = ''; S.posts = r.j.posts; S.err = ''; render(); } else fail(r, 'Could not post.');
    });
  }
  function vote(id, dir) {
    if (!ME) { location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
    var p = S.posts.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var next = p.myVote === dir ? 0 : dir; var prev = { s: p.score, v: p.myVote };
    p.score += next - p.myVote; p.myVote = next; render();
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/community/vote', { method: 'POST', body: JSON.stringify({ post_id: id, dir: next }) }).then(function (r) {
      if (r.ok && r.j) { p.score = r.j.score; p.myVote = r.j.myVote; } else { p.score = prev.s; p.myVote = prev.v; }
      render();
    });
  }
  function reply(id, text) {
    text = (text || '').trim(); if (!text) return;
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/community/reply', { method: 'POST', body: JSON.stringify({ post_id: id, body: text }) }).then(function (r) {
      if (r.ok && r.j && r.j.posts) { S.posts = r.j.posts; S.open[id] = true; render(); } else fail(r, 'Could not reply.');
    });
  }
  function manage(id, action) {
    if (action === 'delete' && !confirm('Remove this post?')) return;
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/community/manage', { method: 'POST', body: JSON.stringify({ post_id: id, action: action }) }).then(function (r) {
      if (r.ok && r.j && r.j.posts) { S.posts = r.j.posts; render(); } else fail(r, 'Could not update the post.');
    });
  }
  function sendChat() {
    var text = (S.chatDraft || '').trim(); if (!text) return;
    var since = S.chat.length ? S.chat[S.chat.length - 1].id : 0;
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/chat', { method: 'POST', body: JSON.stringify({ body: text, parent: S.replyTo || 0, since: since }) }).then(function (r) {
      if (r.ok && r.j && r.j.chat) { S.chatDraft = ''; if (S.replyTo) { S.chatOpen[S.replyTo] = true; } S.replyTo = 0; mergeChat(r.j.chat); render(); } else fail(r, 'Could not send.');
    });
  }
  function mergeChat(rows) {
    var seen = {}; S.chat.forEach(function (m) { seen[m.id] = true; });
    rows.forEach(function (m) { if (!seen[m.id]) { S.chat.push(m); seen[m.id] = true; } });
    if (S.chat.length > 300) S.chat = S.chat.slice(-300);
  }
  function pollChat() {
    if (document.hidden) return;
    var since = S.chat.length ? S.chat[S.chat.length - 1].id : 0;
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/chat?since=' + since).then(function (r) { if (r.ok && r.j && r.j.chat && r.j.chat.length) { mergeChat(r.j.chat); if (S.view === 'chat') render(); } });
  }
  function startChat() { stopChat(); S.chatTimer = setInterval(pollChat, 6000); }
  function stopChat() { if (S.chatTimer) { clearInterval(S.chatTimer); S.chatTimer = null; } }

  function load(legacyPosts) {
    S.legacy = Array.isArray(legacyPosts) ? legacyPosts : [];
    render();
    API('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE) + '/community').then(function (r) {
      if (!r.ok || !r.j) return; /* backend not deployed yet → keeps showing the read-only rows */
      S.posts = r.j.posts || []; S.chat = r.j.chat || []; S.viewer = r.j.viewer || null; S.canPost = !!r.j.canPost; render();
    });
  }

  window.SML_CH_COMMUNITY = {
    mount: function (ctx) {
      API = ctx.api; ROOT = ctx.root; HANDLE = ctx.handle; ME = ctx.me; OWNER = !!ctx.owner; esc = ctx.esc; ago = ctx.ago; safeImage = ctx.safeImage; fmt = ctx.fmt;
      load(ctx.legacyPosts); loadTickers();
    },
    setOwner: function (v) { OWNER = !!v; render(); },
    clearTicker: function () { S.ticker = ''; renderTickers(); },
    setVideos: function (v) { S.videos = v || []; }
  };
})();
