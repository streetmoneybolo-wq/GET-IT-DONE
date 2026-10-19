/* ACADEMY notifications inside LOOP-KICK (server: academy-social-notify.js, GET /academy-activity/notify).
   A member hears about four things, plus replies, right in their LOOP-KICK: a new follower, a comment on their Trading
   Wall, a post by someone they follow (a Ticker Talk comment on a ticker, a message in a live chat room), and a like on
   their comment. The feed is a panel attached to the floating phone (to its left on a desktop, a sheet above it on a
   phone-width screen): a 🔔 bell on the phone's grip opens it, it opens by itself when the phone is opened with news
   waiting, and the LOOP-KICK button's badge counts the Academy's unread together with the phone's. Every item has one
   tap: view the profile or follow back, open your wall, open the comment on its chart, open the chat room. Items are
   read once the feed has been seen. Polled every 45 s while the page is visible. In the Connect app's standalone
   LOOP-KICK Activity the feed shows the same list; actions that need the Academy page are not offered there. */
(function boot(tries) {
  if (window.__smlSocialNotifyUi) return;
  var LK = window.smlLoopKick;
  if (!LK || !document.body) { if (tries < 150) setTimeout(function () { boot(tries + 1); }, 200); return; }
  window.__smlSocialNotifyUi = true;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var token = function () { return String(window.smlAcademySessionToken || ''); };
  var ago = function (iso) { var d = (Date.now() - Date.parse(iso)) / 60000; if (!(d >= 0)) return ''; if (d < 1) return 'now'; if (d < 60) return Math.round(d) + 'm'; if (d < 36 * 60) return Math.round(d / 60) + 'h'; return Math.round(d / 1440) + 'd'; };
  var S = { items: [], unread: 0, more: false, shown: false, seenIds: {}, polling: false, readTimer: 0, followed: {}, firstLoad: true, host: null, bell: null, lastAsk: 0 };
  var STANDALONE = !!LK.standalone;

  var css = document.createElement('style');
  css.textContent = ''
    + '#academy-lk-feed{position:absolute;right:100%;top:0;margin-right:10px;width:min(300px,calc(100vw - 24px));max-height:100%;display:none;flex-direction:column;background:#070b12;border:1px solid #1b2837;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.55);color:#cfdbe8;font:400 12px/1.45 system-ui,sans-serif;pointer-events:auto;overflow:hidden;color-scheme:dark}'
    + '#academy-lk-feed.on{display:flex}'
    + '#academy-lk-feed .hd{display:flex;align-items:center;gap:8px;padding:9px 10px 8px 12px;border-bottom:1px solid #16212d;font:900 10px/1 ui-monospace,monospace;letter-spacing:1.4px;color:#9fe8c0}'
    + '#academy-lk-feed .hd .sp{flex:1}#academy-lk-feed .hd button{background:none;border:0;color:#7e92a8;font:800 10px/1 ui-monospace,monospace;cursor:pointer;padding:3px 6px;letter-spacing:.6px}#academy-lk-feed .hd button:hover{color:#fff}'
    + '#academy-lk-feed .hd .n{background:#ff566e;color:#fff;border-radius:999px;font:800 9px/1 system-ui;padding:3px 6px}'
    + '#academy-lk-feed .ls{overflow:auto;overscroll-behavior:contain;padding:6px 8px 8px;display:flex;flex-direction:column;gap:5px;min-height:60px;max-height:calc(100dvh - 120px)}'
    + '.lk-nt{display:flex;gap:8px;align-items:flex-start;padding:8px 9px;border:1px solid #14202b;border-radius:11px;background:#0a111a}.lk-nt.new{border-color:#1f5a40;background:#0b1a16}'
    + '.lk-nt .ava{flex:none;width:30px;height:30px;border-radius:50%;background:#14303a;color:#9fe8c0;display:flex;align-items:center;justify-content:center;font:900 13px/1 system-ui;overflow:hidden;object-fit:cover}'
    + '.lk-nt .bd{flex:1;min-width:0}.lk-nt .tx{color:#dbe6ec}.lk-nt .tx b{color:#fff}.lk-nt .tx i{color:#b8c9d3;font-style:normal;word-break:break-word}.lk-nt .tx em{color:#7ef0bd;font-style:normal;font-weight:800}'
    + '.lk-nt .mt{display:flex;align-items:center;gap:8px;margin-top:5px;font:700 10px/1 ui-monospace,monospace;color:#6f8794}.lk-nt .mt .sp{flex:1}'
    + '.lk-nt .mt button{border:1px solid #244a3a;border-radius:7px;background:#0d2a21;color:#7dffc4;font:800 10px/1 ui-monospace,monospace;padding:5px 8px;cursor:pointer}.lk-nt .mt button.dim{border-color:#22323f;background:#0f1a24;color:#9fb3be}.lk-nt .mt button[disabled]{opacity:.55;cursor:default}'
    + '#academy-lk-feed .empty{padding:18px 12px;text-align:center;color:#7f98a6;font-size:11.5px}#academy-lk-feed .more{margin:2px 0 0;border:1px dashed #22323f;border-radius:9px;background:none;color:#9fb3be;font:800 10px/1 ui-monospace,monospace;padding:8px;cursor:pointer}'
    + '#academy-lk-bell{position:relative;background:none;border:0;color:#9fe8c0;font:800 10px/1 ui-monospace,monospace;cursor:pointer;padding:3px 6px;letter-spacing:.4px}#academy-lk-bell .n{display:none;margin-left:3px;background:#ff566e;color:#fff;border-radius:999px;font:800 8px/1 system-ui;padding:2px 4px;vertical-align:1px}#academy-lk-bell.has .n{display:inline-block}'
    + '@media (max-width:700px){#academy-lk-feed{position:fixed;left:8px;right:8px;top:auto;bottom:8px;width:auto;margin:0;max-height:62dvh;z-index:2147483150}}'
    + (STANDALONE ? '#academy-lk-bell{position:fixed;left:10px;top:10px;z-index:2147483150;background:rgba(8,14,20,.86);border:1px solid rgba(0,255,136,.28);border-radius:999px;padding:7px 10px}#academy-lk-feed{position:fixed;left:8px;top:44px;right:auto;bottom:auto;margin:0;max-height:calc(100dvh - 60px);z-index:2147483150}' : '');
  document.head.appendChild(css);

  function ensureUi() {
    var panel = LK.panel();
    if (!S.host) {
      S.host = document.createElement('section');
      S.host.id = 'academy-lk-feed'; S.host.setAttribute('aria-label', 'Academy notifications');
      S.host.innerHTML = '<div class="hd"><span>ACADEMY</span><span class="n" style="display:none"></span><span class="sp"></span><button type="button" data-read="1" title="Mark everything read">READ ALL</button><button type="button" data-hide="1" title="Hide">✕</button></div><div class="ls"></div>';
      S.host.addEventListener('click', onClick);
      ['pointerdown', 'wheel', 'keydown'].forEach(function (ev) { S.host.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      panel.appendChild(S.host);
    }
    if (!S.bell) {
      var bell = document.createElement('button'); bell.type = 'button'; bell.id = 'academy-lk-bell'; bell.title = 'Academy notifications'; bell.innerHTML = '🔔<span class="n"></span>';
      bell.addEventListener('click', function (e) { e.stopPropagation(); toggleFeed(); });
      bell.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      var grip = typeof LK.grip === 'function' ? LK.grip() : null;
      if (grip) { var close = grip.querySelector('#academy-lk-close'); grip.insertBefore(bell, close || null); } else panel.appendChild(bell);
      S.bell = bell;
    }
  }

  /* ---- what each item says and what its one tap does ---- */
  var hasAcademy = function () { return !STANDALONE; };
  function textOf(it) {
    var who = '<b>' + esc(it.actorName || 'A trader') + '</b>', r = it.ref || {}, q = it.body ? ' <i>“' + esc(it.body.slice(0, 120)) + (it.body.length > 120 ? '…' : '') + '”</i>' : '';
    switch (it.kind) {
      case 'follow': return who + ' started following you.';
      case 'wall_comment': return who + ' wrote on your Trading Wall:' + q;
      case 'post': return r.source === 'chat' ? who + ' posted in <em>#' + esc(r.room || 'chat') + '</em>:' + q : who + ' posted on <em>$' + esc(r.symbol || '') + '</em>:' + q;
      case 'like': return who + ' liked your ' + (r.kind === 'wall' ? 'wall ' : '') + 'comment' + (r.symbol ? ' on <em>$' + esc(r.symbol) + '</em>' : '') + ':' + q;
      case 'reply': return who + ' replied to your <em>$' + esc(r.symbol || '') + '</em> comment:' + q;
      default: return who + ' did something.';
    }
  }
  function actionsOf(it) {
    if (!hasAcademy()) return '';
    var r = it.ref || {};
    switch (it.kind) {
      case 'follow': return '<button type="button" data-act="profile" data-user="' + esc(it.actorId) + '" class="dim">View profile</button>' + (S.followed[it.actorId] ? '<button type="button" disabled>Following</button>' : '<button type="button" data-act="followback" data-user="' + esc(it.actorId) + '">Follow back</button>');
      case 'wall_comment': return '<button type="button" data-act="mywall">Open my wall</button>';
      case 'post': return r.source === 'chat' ? '<button type="button" data-act="chat" data-room="' + esc(r.room || '') + '">Open chat</button>' : '<button type="button" data-act="talk" data-symbol="' + esc(r.symbol || '') + '" data-id="' + esc(r.id || '') + '">Open on $' + esc(r.symbol || '') + '</button>';
      case 'like': return r.kind === 'wall' ? '<button type="button" data-act="profile" data-user="' + esc(r.profileId || '') + '">Open the wall</button>' : '<button type="button" data-act="talk" data-symbol="' + esc(r.symbol || '') + '" data-id="' + esc(r.rootId || r.id || '') + '">Open on $' + esc(r.symbol || '') + '</button>';
      case 'reply': return '<button type="button" data-act="talk" data-symbol="' + esc(r.symbol || '') + '" data-id="' + esc(r.rootId || r.id || '') + '">Open on $' + esc(r.symbol || '') + '</button>';
      default: return '';
    }
  }
  function itemHtml(it) {
    var initial = esc(String(it.actorName || 'A').slice(0, 1).toUpperCase());
    return '<div class="lk-nt' + (it.read ? '' : ' new') + '" data-nid="' + esc(it.id) + '"><span class="ava" data-uid="' + esc(it.actorId || '') + '">' + initial + '</span><div class="bd"><div class="tx">' + textOf(it) + '</div><div class="mt"><span>' + esc(ago(it.createdAt)) + '</span><span class="sp"></span>' + actionsOf(it) + '</div></div></div>';
  }
  function paintAvatars() {
    if (typeof window.smlAcademyAvatar !== 'function' || !token() || !S.host) return;
    S.host.querySelectorAll('span.ava[data-uid]').forEach(function (el) {
      var id = el.dataset.uid; if (!/^\d{15,25}$/.test(id)) return;
      window.smlAcademyAvatar(id).then(function (url) { if (!url || !el.isConnected) return; var img = document.createElement('img'); img.className = 'ava'; img.alt = ''; img.src = url; el.replaceWith(img); });
    });
  }
  function paint() {
    if (!S.host) return;
    var n = S.host.querySelector('.hd .n'); n.textContent = S.unread > 99 ? '99+' : String(S.unread); n.style.display = S.unread > 0 ? '' : 'none';
    var ls = S.host.querySelector('.ls');
    ls.innerHTML = S.items.length ? S.items.map(itemHtml).join('') + (S.more ? '<button type="button" class="more" data-more="1">Older</button>' : '') : '<div class="empty">Nothing yet. New followers, wall comments, posts by the traders you follow and likes on your comments show up here.</div>';
    paintAvatars();
    if (S.bell) { S.bell.classList.toggle('has', S.unread > 0); S.bell.querySelector('.n').textContent = S.unread > 99 ? '99+' : String(S.unread); }
    if (typeof LK.setAcademyUnread === 'function') LK.setAcademyUnread(S.unread);
  }

  /* ---- reading ---- */
  async function api(path, method, body) {
    var t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    var go = function (tok) { return fetch(path, { method: method || 'GET', headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); };
    try {
      var res = await go(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { var f = await Promise.resolve(window.smlAcademyReauth()).catch(function () { return ''; }); if (f) res = await go(f); }
      var j = await res.json().catch(function () { return null; });
      return j || { ok: false, error: 'http_' + res.status };
    } catch (_) { return { ok: false, error: 'offline' }; }
  }
  async function poll(force) {
    if (S.polling || !token()) return; if (document.hidden && !force) return;
    S.polling = true;
    var r = await api('/academy-activity/notify?limit=30');
    S.polling = false;
    if (!r.ok) return;
    S.items = r.items || []; S.unread = Number(r.unread) || 0; S.more = !!r.more;
    paint();
    if (S.unread > 0 && LK.isOpen && LK.isOpen() && !S.shown && !S.dismissed) showFeed(); // the phone is open and there is news: show it
    if (S.shown) scheduleRead();
  }
  function scheduleRead() {
    clearTimeout(S.readTimer);
    if (!S.unread) return;
    S.readTimer = setTimeout(async function () {
      if (!S.shown || document.hidden) return;
      var r = await api('/academy-activity/notify/read', 'POST', { all: true });
      if (r.ok) { S.unread = Number(r.unread) || 0; S.items.forEach(function (it) { it.read = true; }); if (S.bell) { S.bell.classList.toggle('has', S.unread > 0); } if (typeof LK.setAcademyUnread === 'function') LK.setAcademyUnread(S.unread); var n = S.host && S.host.querySelector('.hd .n'); if (n) n.style.display = S.unread > 0 ? '' : 'none'; }
    }, 2500);
  }
  async function loadOlder() {
    if (!S.items.length) return;
    var last = S.items[S.items.length - 1];
    var r = await api('/academy-activity/notify?limit=30&before=' + encodeURIComponent(last.id));
    if (!r.ok) return;
    S.items = S.items.concat(r.items || []); S.more = !!r.more; paint();
  }

  /* ---- showing ---- */
  function showFeed() { ensureUi(); S.shown = true; S.host.classList.add('on'); paint(); scheduleRead(); }
  function hideFeed() { S.shown = false; S.dismissed = true; if (S.host) S.host.classList.remove('on'); clearTimeout(S.readTimer); }
  function toggleFeed() { if (S.shown) hideFeed(); else { S.dismissed = false; showFeed(); void poll(true); } }

  async function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-hide],[data-read],[data-more],[data-act]') : null;
    if (!t) return;
    e.stopPropagation();
    var d = t.dataset;
    if (d.hide) { hideFeed(); return; }
    if (d.more) { t.disabled = true; await loadOlder(); return; }
    if (d.read) { var r = await api('/academy-activity/notify/read', 'POST', { all: true }); if (r.ok) { S.unread = 0; S.items.forEach(function (it) { it.read = true; }); paint(); } return; }
    var act = d.act;
    if (act === 'profile' && d.user) { if (window.smlAcademyProfile && window.smlAcademyProfile.open) { hideFeed(); void window.smlAcademyProfile.open(d.user); } return; }
    if (act === 'mywall') { if (window.smlAcademyProfile && window.smlAcademyProfile.me) { hideFeed(); void window.smlAcademyProfile.me(); } return; }
    if (act === 'followback' && d.user) {
      t.disabled = true;
      var fr = await api('/academy-activity/community/follow', 'POST', { user: d.user, on: true });
      if (fr.ok) { S.followed[d.user] = true; t.textContent = 'Following'; } else { t.disabled = false; t.textContent = 'Try again'; }
      return;
    }
    if (act === 'talk' && d.symbol) { if (window.smlTickerTalk && window.smlTickerTalk.openComment) { hideFeed(); void window.smlTickerTalk.openComment(d.symbol, d.id); } else if (window.smlAcademyNavigateMarket) { hideFeed(); window.smlAcademyNavigateMarket(d.symbol); } return; }
    if (act === 'chat') { if (typeof window.smlAcademyChatOpen === 'function') { hideFeed(); window.smlAcademyChatOpen(d.room || 'global'); } return; }
  }

  /* ---- entry points ---- */
  window.addEventListener('sml-loop-kick-panel', function (e) {
    var open = e && e.detail && e.detail.open;
    if (open) { ensureUi(); S.dismissed = false; void poll(true); if (S.unread > 0) showFeed(); }
    else hideFeed();
  });
  window.addEventListener('sml-academy-session', function () { setTimeout(function () { void poll(true); }, 1500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) void poll(); });
  setInterval(function () { void poll(); }, 45_000);
  if (token()) setTimeout(function () { void poll(true); }, 1500);
  if (LK.isOpen && LK.isOpen()) ensureUi();
  if (STANDALONE) { ensureUi(); }
  window.smlAcademyNotify = { poll: function () { return poll(true); }, show: showFeed, hide: hideFeed, toggle: toggleFeed, state: function () { return { items: S.items.slice(), unread: S.unread, shown: S.shown }; } };
})(0);
