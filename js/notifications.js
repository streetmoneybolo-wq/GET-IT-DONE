/*!
 * SML Notifications — the LOOP-KICK header button becomes the member's
 * notification centre. Loaded for signed-in members by plugin sml-notify
 * (output-buffer inject, same jsDelivr pin as every other GET-IT-DONE module).
 *
 * Data: GET/POST /wp-json/sml-members/v1/notifications (the members plugin's own
 * store, enriched by sml-notify with actor identity + follow-back state).
 * Behaviour:
 *   - unread > 0  → the button blinks slowly between "LOOP-KICK" and
 *                   "NOTIFICATION", shows a count, and a click opens the panel
 *                   (the Loop-Kick messenger stays one click away inside it)
 *   - unread == 0 → the button is untouched and behaves as before
 */
(function () {
  'use strict';
  if (window.__smlNotifyBooted) return;
  window.__smlNotifyBooted = true;

  var CFG = window.SML_NOTIFY || {};
  var NONCE = CFG.nonce || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var ME = Number(CFG.me || (window.SML_ME && window.SML_ME.id) || 0) || 0;
  /* the SAME feed the Loop-Kick device's Alerts tab shows (messenger hub: members store + the app's own read marks), so the badge and the dropdown always agree */
  var API = '/wp-json/sml-mhub/v1/notifications';
  var POLL_MS = 40000;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(iso) { var t = Date.parse(iso || ''); if (isNaN(t)) return ''; var d = Math.max(0, (Date.now() - t) / 1000); if (d < 60) return 'now'; if (d < 3600) return Math.floor(d / 60) + 'm'; if (d < 86400) return Math.floor(d / 3600) + 'h'; return Math.floor(d / 86400) + 'd'; }
  function api(url, opts) {
    opts = opts || {}; opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'X-WP-Nonce': NONCE }, opts.headers || {});
    return fetch(url, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || ('HTTP ' + r.status)); return j; }); });
  }

  var CSS = '' +
    '.sml-nk-host{position:relative!important;overflow:visible!important}' +
    '.sml-nk-alt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:inherit;background:linear-gradient(180deg,#ff6b7a 0%,#ff4757 55%,#d9303f 100%);color:#fff;font-weight:800;letter-spacing:.4px;font-size:inherit;pointer-events:none;opacity:0;animation:smlNkBlink 2.8s steps(1,end) infinite;box-shadow:0 0 18px rgba(255,71,87,.55)}' +
    '@keyframes smlNkBlink{0%,49.9%{opacity:0}50%,100%{opacity:1}}' +
    '.sml-nk-badge{position:absolute;top:-7px;right:-7px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ff4757;color:#fff;font:800 11px/20px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0b131f;pointer-events:none;z-index:2}' +
    '.sml-nk-panel{position:fixed;z-index:2147483600;width:380px;max-width:calc(100vw - 16px);max-height:min(72vh,640px);display:none;flex-direction:column;background:linear-gradient(168deg,#1B2532 0%,#121A26 44%,#0B111A 100%);border:1px solid rgba(255,255,255,.09);border-top-color:rgba(255,255,255,.18);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.7);color:#E6EDF5;font-family:Inter,system-ui,sans-serif;overflow:hidden}' +
    '.sml-nk-panel.on{display:flex}' +
    '.sml-nk-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}' +
    '.sml-nk-head strong{font-size:14px;flex:1}.sml-nk-head strong em{font-style:normal;color:#ff4757;margin-left:6px;font-size:12px}' +
    '.sml-nk-head button{font:600 11px/1 Inter,system-ui,sans-serif;color:#8fa3b5;background:#0d141c;border:1px solid #16202b;border-radius:999px;padding:7px 10px;cursor:pointer}.sml-nk-head button:hover{color:#E6EDF5;border-color:#2a3d4b}' +
    '.sml-nk-list{overflow:auto;flex:1;display:flex;flex-direction:column}' +
    '.sml-nk-item{display:grid;grid-template-columns:36px 1fr auto;gap:10px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:start;text-decoration:none;color:inherit;cursor:pointer}' +
    '.sml-nk-item.unread{background:rgba(0,255,136,.05)}.sml-nk-item:hover{background:rgba(255,255,255,.04)}' +
    '.sml-nk-av{width:36px;height:36px;border-radius:50%;object-fit:cover;background:linear-gradient(160deg,#24323F,#0E1620);display:flex;align-items:center;justify-content:center;font:700 12px/1 Inter,system-ui,sans-serif;color:#38F58A;box-shadow:0 0 0 2px #0B131F,0 0 0 3px rgba(34,224,122,.6)}' +
    '.sml-nk-av img{width:36px;height:36px;border-radius:50%;object-fit:cover;display:block}' +
    '.sml-nk-body{min-width:0;font-size:13px;line-height:1.45;color:#CFDAE4;font-family:Inter,system-ui,sans-serif}.sml-nk-body a.who{color:#5DB9FF!important;font-weight:700;font-size:inherit;text-decoration:none;display:inline}.sml-nk-body a.who:hover{text-decoration:underline}' +
    '.sml-nk-meta{display:flex;gap:8px;align-items:center;margin-top:5px;font:600 11px/1 "IBM Plex Mono",monospace;color:#6B7C90}' +
    '.sml-nk-meta .t{color:#ff4757}.sml-nk-meta a{color:#00ff88;text-decoration:none}.sml-nk-meta a:hover{text-decoration:underline}' +
    '.sml-nk-side{display:flex;flex-direction:column;gap:6px;align-items:flex-end}' +
    '.sml-nk-fb{font:700 11px/1 Inter,system-ui,sans-serif;color:#04060a;background:linear-gradient(180deg,#6BFFB0 0%,#38F58A 46%,#17BC64 100%);border:1px solid rgba(20,170,90,.9);border-radius:999px;padding:7px 11px;cursor:pointer;white-space:nowrap}.sml-nk-fb[disabled]{opacity:.6;cursor:default}.sml-nk-fb.done{background:#0d141c;color:#8fa3b5;border-color:#16202b}' +
    '.sml-nk-empty{padding:28px 16px;text-align:center;color:#6B7C90;font-size:13px}' +
    '.sml-nk-foot{display:flex;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.08)}' +
    '.sml-nk-foot button{flex:1;font:700 12px/1 Inter,system-ui,sans-serif;color:#E6EDF5;background:#0d141c;border:1px solid #2a3d4b;border-radius:999px;padding:10px 12px;cursor:pointer}.sml-nk-foot button.pri{color:#04060a;background:linear-gradient(180deg,#6BFFB0 0%,#38F58A 46%,#17BC64 100%);border-color:rgba(20,170,90,.9)}' +
    '@media (prefers-reduced-motion:reduce){.sml-nk-alt{animation:none;opacity:1}}';

  var S = { items: [], unread: 0, btn: null, panel: null, alt: null, badge: null, timer: 0, following: null };

  function ensureCss() { if (document.getElementById('loopnotify-css')) return; var st = document.createElement('style'); st.id = 'loopnotify-css'; st.textContent = CSS; document.head.appendChild(st); }

  /* ---- Loop-Kick messenger: same open logic the header uses ---- */
  function openLoopKick() {
    var popup = document.getElementById('sml-loop-popup'), frame = document.getElementById('sml-loop-popup-frame');
    if (!popup) { var l = document.querySelector('.sml-loop-launcher'); if (l) l.click(); return; }
    if (frame) { var src = frame.getAttribute('src'), want = frame.dataset.src || src; if (!src && want) frame.setAttribute('src', want); }
    popup.hidden = false; document.body.classList.add('sml-loop-open');
    if (S.btn) S.btn.setAttribute('aria-expanded', 'true');
  }

  /* ---- button decoration ---- */
  function decorate() {
    var btn = S.btn; if (!btn) return;
    if (S.unread > 0) {
      btn.classList.add('sml-nk-host');
      if (!S.alt) { S.alt = document.createElement('span'); S.alt.className = 'sml-nk-alt'; S.alt.setAttribute('aria-hidden', 'true'); S.alt.textContent = 'NOTIFICATION'; btn.appendChild(S.alt); }
      if (!S.badge) { S.badge = document.createElement('span'); S.badge.className = 'sml-nk-badge'; btn.appendChild(S.badge); }
      S.badge.textContent = S.unread > 99 ? '99+' : String(S.unread);
      btn.setAttribute('data-sml-notify', String(S.unread));
      btn.setAttribute('aria-label', S.unread + ' new notification' + (S.unread === 1 ? '' : 's') + ' — open notifications');
    } else {
      btn.classList.remove('sml-nk-host');
      if (S.alt) { S.alt.remove(); S.alt = null; } if (S.badge) { S.badge.remove(); S.badge = null; }
      btn.removeAttribute('data-sml-notify'); btn.setAttribute('aria-label', 'Open LOOP-KICK');
    }
  }

  /* ---- panel ---- */
  function panel() {
    if (S.panel) return S.panel;
    var p = document.createElement('div'); p.className = 'sml-nk-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications');
    p.innerHTML = '<div class="sml-nk-head"><strong>Notifications<em data-nk-count></em></strong><button type="button" data-nk-read>Mark all read</button><button type="button" data-nk-close aria-label="Close">✕</button></div><div class="sml-nk-list" data-nk-list></div><div class="sml-nk-foot"><button type="button" class="pri" data-nk-kick>Open LOOP-KICK messages</button></div>';
    document.body.appendChild(p);
    p.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('[data-nk-close]')) { closePanel(); return; }
      if (t.closest('[data-nk-read]')) { markRead(); return; }
      if (t.closest('[data-nk-kick]')) { closePanel(); openLoopKick(); return; }
      var fb = t.closest('[data-nk-follow]');
      if (fb) { ev.preventDefault(); followBack(fb); return; }
      if (t.closest('a.who')) { markRead(true); return; } /* the actor's own profile link navigates by itself */
      var dm = t.closest('[data-nk-dm]');
      if (dm) { ev.preventDefault(); markRead(); closePanel(); openLoopKick(); return; }
      var item = t.closest('.sml-nk-item');
      if (item && !t.closest('a,button')) { var href = item.getAttribute('data-href'); markRead(true); if (href && href !== '#') location.href = href; }
    });
    document.addEventListener('click', function (ev) { if (S.panel && S.panel.classList.contains('on') && !S.panel.contains(ev.target) && !(S.btn && S.btn.contains(ev.target))) closePanel(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closePanel(); });
    p.addEventListener('keydown', function (ev) { if (ev.key !== 'Enter') return; var item = ev.target.closest('.sml-nk-item'); if (item && ev.target === item) item.click(); });
    window.addEventListener('resize', position);
    S.panel = p; return p;
  }
  function position() {
    if (!S.panel || !S.btn) return;
    var r = S.btn.getBoundingClientRect(); var w = Math.min(380, window.innerWidth - 16);
    S.panel.style.top = Math.round(r.bottom + 10) + 'px';
    S.panel.style.left = Math.max(8, Math.min(Math.round(r.right - w), window.innerWidth - w - 8)) + 'px';
  }
  function avatarHTML(a) { return a && a.avatar ? '<span class="sml-nk-av"><img src="' + esc(a.avatar) + '" alt="" referrerpolicy="no-referrer"></span>' : '<span class="sml-nk-av">' + esc(String((a && a.name) || 'S').replace(/^@/, '').slice(0, 2).toUpperCase()) + '</span>'; }
  function labelFor(type) { return ({ follow: 'FOLLOW', mention: 'TAGGED YOU', like: 'LIKE', chart_like: 'LIKE', stream_like: 'LIKE', comment: 'COMMENT', share: 'SHARE', gift: 'GIFT', dm: 'MESSAGE', video: 'NEW VIDEO', live: 'LIVE NOW', profile_chart: 'POST' })[type] || String(type || '').replace(/_/g, ' ').toUpperCase(); }
  function itemHTML(n) {
    var a = n.actor || {}; var msg = String(n.message || '');
    /* the actor's name (or the handle the message was written with) leads the sentence — make it the blue, clickable part */
    var lead = '';
    [a.name || '', a.handle || ''].forEach(function (cand) { if (!lead && cand && msg.toLowerCase().indexOf(String(cand).toLowerCase()) === 0) lead = msg.slice(0, cand.length); });
    var body = lead ? '<a class="who" href="' + esc(a.url || '#') + '"' + (a.id ? ' data-sml-user-id="' + esc(String(a.id)) + '"' : '') + '>' + esc(lead) + '</a>' + esc(msg.slice(lead.length)) : esc(msg);
    var isDm = n.type === 'dm';
    var link = isDm ? '#loop-kick' : (n.link || '#');
    var side = '';
    if (n.type === 'follow' && a.id && n.can_follow_back) side = '<button type="button" class="sml-nk-fb" data-nk-follow="' + esc(String(a.id)) + '">Follow back</button>';
    else if (n.type === 'follow' && a.id && n.can_follow_back === false) side = '<button type="button" class="sml-nk-fb done" disabled>Following</button>';
    var openLabel = ({ dm: 'Open messages', video: 'Watch', live: 'Watch live', follow: 'View profile', mention: 'View post', like: 'View post', comment: 'View post', share: 'View post', gift: 'View post', profile_chart: 'View post' })[n.type] || 'Open';
    return '<div class="sml-nk-item' + (n.read ? '' : ' unread') + '" role="link" tabindex="0" data-href="' + esc(link) + '"' + (isDm ? ' data-nk-dm="1"' : '') + '>' + avatarHTML(a) +
      '<span class="sml-nk-body">' + body + '<span class="sml-nk-meta"><span class="t">' + esc(labelFor(n.type)) + '</span><span>' + esc(ago(n.date)) + '</span><span>' + esc(openLabel) + ' →</span></span></span>' +
      '<span class="sml-nk-side">' + side + '</span></div>';
  }
  function render() {
    var p = panel(); var list = p.querySelector('[data-nk-list]'); var cnt = p.querySelector('[data-nk-count]');
    cnt.textContent = S.unread > 0 ? (S.unread + ' new') : '';
    list.innerHTML = S.items.length ? S.items.map(itemHTML).join('') : '<div class="sml-nk-empty">No notifications yet. Tags, likes, gifts, follows, messages, new videos and live streams from channels you follow will land here.</div>';
  }
  function openPanel() { render(); panel().classList.add('on'); position(); }
  function closePanel() { if (S.panel) S.panel.classList.remove('on'); }

  function followBack(btn) {
    var uid = Number(btn.getAttribute('data-nk-follow') || 0); if (!uid) return;
    btn.disabled = true; btn.textContent = 'Following…';
    api('/wp-json/sml-members/v1/follow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid, action: 'follow' }) })
      .then(function () { btn.textContent = 'Following'; btn.classList.add('done'); S.items.forEach(function (n) { if (n.actor && Number(n.actor.id) === uid) n.can_follow_back = false; }); })
      .catch(function (e) { btn.disabled = false; btn.textContent = 'Follow back'; alert(e.message || 'Could not follow right now.'); });
  }
  function markRead(silent) {
    if (!S.unread) return;
    S.unread = 0; S.items.forEach(function (n) { n.read = true; }); decorate(); if (!silent) render();
    api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_all' }) }).catch(function () {});
  }

  /* ---- data ---- */
  function poll() {
    if (document.hidden && S.items.length) return;
    api(API + '?_=' + Date.now()).then(function (j) {
      S.items = Array.isArray(j.items) ? j.items : (Array.isArray(j.notifications) ? j.notifications : []);
      var c = j.counts || {}; S.unread = j.unread_count != null ? (Number(j.unread_count) || 0) : (Number((c.general || {}).unread || 0) + Number((c.priority || {}).unread || 0));
      decorate(); if (S.panel && S.panel.classList.contains('on')) render();
    }).catch(function () {});
  }

  /* ---- attach to the header button (rendered by site-search.js / home-feed.js) ---- */
  function bind(btn) {
    S.btn = btn; ensureCss();
    /* owner call 2026-09-05: the LOOP-KICK click is NOT intercepted — notifications
       live inside the Loop-Kick app (the dropdown the owner built). This module only
       blinks the button, shows the count, and feeds the app (see bridge below). */
    decorate();
  }
  var tries = 0;
  var find = setInterval(function () {
    var btn = document.getElementById('sml-hf-loop-kick');
    if (btn) { clearInterval(find); bind(btn); poll(); S.timer = setInterval(poll, POLL_MS); document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); }); }
    else if (++tries > 120) clearInterval(find);
  }, 500);
  window.SMLNotify = { refresh: poll, open: openPanel, close: closePanel, state: S };
})();
