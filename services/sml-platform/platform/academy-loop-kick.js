/* LOOP-KICK inside Discord.
   Academy mode: a pulsing LOOP-KICK button in the header bar opens the real hosted
   phone as a floating device, exactly like the launcher on stockmarketloop.com: no
   box around it, a transparent window behind it (the chart stays clickable around
   the phone), and a grip above the screen to drag it anywhere; the spot is
   remembered. Phone-width keeps it docked at the bottom. Standalone mode (the
   Connect app's /loop-kick Activity) renders it full screen. The phone iframe loads through Discord's URL mapping at
   /.proxy/loop-kick/ and receives its short-lived site session by postMessage after
   it announces sml-loop-kick:ready; the session silently re-mints before expiry.
   Members without a linked stockmarketloop.com account connect right here: they sign
   in with their site password (the platform checks it with the site and stores the
   link), or take a signed link that finishes on the site after they register.
   An unverified email still sends them to the site — nothing else works until then.
   This module never writes to Discord: no DMs, no channel posts. */
(function () {
  if (window.__smlLoopKickModule) return;
  window.__smlLoopKickModule = true;

  var CFG = window.SML_LOOP_KICK_ACTIVITY || {};
  var STANDALONE = !!CFG.standalone;
  var SESSION_ROUTE = CFG.sessionRoute || '/academy-activity/loop-kick/session';
  /* one-tap connection (site password sign-in here, or a signed link that finishes on the site) */
  var CONNECT_ROUTE = CFG.connectRoute || '/academy-activity/loop-kick/connect';
  var CONNECT_LINK_ROUTE = CFG.connectLinkRoute || '/academy-activity/loop-kick/connect-link';
  var SITE_CONNECT_URL = 'https://stockmarketloop.com/connect-discord/';
  var FRAME_PATH = '/.proxy/loop-kick/?embed=1&peer=loop&peerName=Loop';
  var EXTERNAL_OK = /^https:\/\/(stockmarketloop-loop-kick\.onrender\.com\/enable-alerts\.html|stockmarketloop\.com\/|www\.youtube\.com\/watch\?v=[\w-]{8,14}$|youtu\.be\/[\w-]{8,14}$)/;

  var S = {
    open: false, frame: null, panel: null, badge: null, button: null,
    token: '', expiresAt: 0, refreshTimer: null, frameReady: false,
    lastCard: '', minting: false,
    grip: null, surface: '', surfaceBox: null, pos: null, dragging: null
  };
  var POS_KEY = 'academy-lk-pos';
  var PHONE_W = 430, PHONE_H = 790;

  function el(q) { return document.querySelector(q); }

  function activitySession() { return String(window.smlAcademySessionToken || ''); }

  function frameOrigin() {
    if (!S.frame) return '';
    try { return new URL(S.frame.getAttribute('src') || FRAME_PATH, location.href).origin; } catch (e) { return ''; }
  }

  /* ---- session mint against the platform (which calls the site's HMAC route) ---- */
  function mint(retried) {
    if (S.minting) return Promise.resolve(null);
    S.minting = true;
    return fetch(SESSION_ROUTE, { headers: { authorization: 'Bearer ' + activitySession() }, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); })
      .then(function (res) {
        S.minting = false;
        if (res.status === 401 && !retried && typeof window.smlAcademyReauth === 'function') {
          /* activity session lapsed: silent Discord re-auth, then one retry */
          return Promise.resolve(window.smlAcademyReauth()).then(function () { return mint(true); });
        }
        return res;
      })
      .catch(function () { S.minting = false; return null; });
  }

  function scheduleRefresh() {
    if (S.refreshTimer) clearTimeout(S.refreshTimer);
    var at = S.expiresAt * 1000 - Date.now() - 60000;
    S.refreshTimer = setTimeout(function () { refreshToken(); }, Math.max(15000, at));
  }

  function refreshToken() {
    mint(false).then(function (res) {
      if (res && res.j && res.j.ok && res.j.token) {
        S.token = res.j.token; S.expiresAt = Number(res.j.expires_at) || 0;
        sendAuth();
        if (S.open) tellFrame('open');
        scheduleRefresh();
      } else {
        scheduleRefresh(); /* transient failure: try again in a minute */
      }
    });
  }

  function sendAuth() {
    if (!S.frame || !S.frame.contentWindow || !S.token) return;
    var origin = frameOrigin();
    if (!origin) return;
    S.frame.contentWindow.postMessage({ type: 'sml-loop-kick:auth', version: 1, token: S.token, expires_at: S.expiresAt }, origin);
  }

  /* give the freshly loaded phone its session and ask it to unfold; a few repeats cover a slow start */
  function kick() {
    if (!S.open || !S.token) return;
    [0, 400, 1500, 3500].forEach(function (ms) { setTimeout(function () { if (S.open && S.token) { sendAuth(); tellFrame('open'); } }, ms); });
  }

  function tellFrame(kind) {
    if (!S.frame || !S.frame.contentWindow) return;
    var origin = frameOrigin();
    if (!origin) return;
    S.frame.contentWindow.postMessage({ type: 'sml-loop-kick:' + kind, version: 1 }, origin);
  }

  window.addEventListener('message', function (event) {
    if (!S.frame || event.source !== S.frame.contentWindow) return;
    if (event.origin !== frameOrigin()) return;
    var d = event.data || {};
    if (d && typeof d.type === 'string' && d.type.indexOf('sml-loop-kick:') === 0 && !S.heard) {
      S.heard = true;
      /* the phone is awake: whatever the page wants it to carry (the Academy notifications feed) can be handed over now */
      try { window.dispatchEvent(new CustomEvent('sml-loop-kick-frame', { detail: { ready: true } })); } catch (e) { /* old browser */ }
    }
    if (d.type === 'sml-loop-kick:ready' || d.type === 'sml-loop-kick:auth-needed') {
      S.frameReady = true;
      var stale = !S.token || (S.expiresAt && S.expiresAt * 1000 <= Date.now() + 5000);
      if (d.type === 'sml-loop-kick:auth-needed' || stale) {
        /* at most one forced re-mint per 15 s: a site that keeps refusing tokens
           must not turn the phone's 401 nudges into a mint storm */
        if (!S.lastRemint || Date.now() - S.lastRemint > 15000) {
          S.lastRemint = Date.now();
          S.token = '';
          refreshToken();
        }
      } else {
        sendAuth();
      }
      if (S.open) tellFrame('open');
    } else if (d.type === 'sml-loop-kick:surface') {
      /* the phone starts folded and only unfolds on 'open'. It never sends a ready message, so the first surface report is the
         cue: if the member opened the panel and the phone is still folded, hand it the session and tell it to open. */
      S.frameReady = true;
      S.surface = String(d.surface || '');
      fitSurfaces(d.surfaces);
      if (S.open && d.surface !== 'expanded' && d.surface !== 'closed' && S.token && (S.unfoldTries || 0) < 6) { S.unfoldTries = (S.unfoldTries || 0) + 1; sendAuth(); tellFrame('open'); }
      if (d.surface === 'expanded') S.unfoldTries = 0;
      if (d.surface === 'expanded' || d.surface === 'folded') S.sawOpen = true;
      /* the member closed the phone with its own ✕ (or Escape): hide the whole device, like the site does; the header button
         reopens it. The phone also reports 'closed' once while booting, before it has ever unfolded — that one is not a close. */
      if (d.surface === 'closed' && S.sawOpen && S.open && !STANDALONE && S.frame && S.frame.style.display !== 'none') closePanel();
    } else if (typeof d.type === 'string' && d.type.indexOf('sml-loop-kick:academy-') === 0) {
      /* the phone acting on an Academy notification it was handed (read, open, follow back, ack): the feed module answers */
      try { window.dispatchEvent(new CustomEvent('sml-loop-kick-academy', { detail: d })); } catch (e) { /* old browser */ }
    } else if (d.type === 'sml-loop-kick:notifications') {
      /* the phone counts the Academy notifications it was handed inside its own unread: the badge must not add them twice */
      S.phoneHasAcademy = d.academyUnread != null;
      paintBadge(Number(d.unread) || 0);
    } else if (d.type === 'sml-loop-kick:external') {
      /* the phone cannot leave Discord's sandbox itself (e.g. phone-alert setup) */
      var url = String(d.url || '');
      if (!EXTERNAL_OK.test(url)) return;
      openExternal(url);
    }
  });

  /* the header badge counts the phone's unread (what the phone reports) together with the Academy's own notifications
     (academy-social-notify-ui.js: followers, wall comments, posts by followed traders, likes) */
  function paintBadge(unread) { S.phoneUnread = Number(unread) || 0; renderBadge(); }
  function renderBadge() {
    if (!S.badge) return;
    var n = (S.phoneUnread || 0) + (S.phoneHasAcademy ? 0 : (S.academyUnread || 0));
    S.badge.textContent = n > 99 ? '99+' : String(n);
    S.badge.style.display = n > 0 ? '' : 'none';
  }
  function announce(open) { try { window.dispatchEvent(new CustomEvent('sml-loop-kick-panel', { detail: { open: !!open } })); } catch (e) { /* old browser */ } }

  /* ---- panel: a transparent floating window; only the phone's own surfaces catch the pointer ---- */
  var css = document.createElement('style');
  css.textContent =
    '@keyframes academyLkPulse{0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,.55)}50%{box-shadow:0 0 0 10px rgba(0,255,136,0)}}' +
    '@keyframes academyLkSweep{0%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(230%) skewX(-18deg)}}' +
    '#academy-lk-panel{display:none;position:fixed;z-index:2147483100;width:min(' + PHONE_W + 'px,100vw);height:min(' + PHONE_H + 'px,100dvh);background:none;border:0;box-shadow:none;overflow:visible;pointer-events:none}' +
    '#academy-lk-panel.on{display:block}' +
    '#academy-lk-panel iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:auto;color-scheme:dark}' +
    '#academy-lk-grip{position:absolute;left:0;right:0;top:0;height:26px;display:none;align-items:center;justify-content:space-between;gap:8px;padding:0 6px 0 10px;border-radius:999px;background:rgba(8,14,20,.86);border:1px solid rgba(0,255,136,.28);box-shadow:0 8px 24px rgba(0,0,0,.45);backdrop-filter:blur(6px);font:800 10px/1 system-ui,sans-serif;letter-spacing:1px;color:#9fe8c0;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;pointer-events:auto}' +
    '#academy-lk-panel.on.phone #academy-lk-grip{display:flex}' +
    '#academy-lk-grip.dragging{cursor:grabbing}' +
    '#academy-lk-grip i{font-style:normal;color:#4f6b7a;letter-spacing:-1px;margin-right:6px}' +
    '#academy-lk-grip button{background:none;border:0;color:#7e92a8;font-size:14px;line-height:1;cursor:pointer;padding:3px 6px}' +
    '#academy-lk-grip button:hover{color:#fff}' +
    '#academy-lk-card{position:absolute;left:0;right:0;bottom:0;padding:26px 20px;color:#cfdbe8;font:400 13px/1.6 system-ui,sans-serif;text-align:center;background:#070b12;border:1px solid #1b2837;border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.55);pointer-events:auto}' +
    '#academy-lk-card b{display:block;font-size:14px;margin-bottom:8px;color:#fff}' +
    '#academy-lk-card button{margin-top:14px;background:#22d97a;color:#04170d;border:0;border-radius:9px;padding:11px 18px;font:700 12px/1 system-ui,sans-serif;cursor:pointer}' +
    '#academy-lk-card button[disabled]{opacity:.55;cursor:default}' +
    '#academy-lk-card .lk-card-x{position:absolute;right:8px;top:6px;margin:0;background:none;color:#7e92a8;font-size:15px;padding:4px 7px}' +
    '#academy-lk-connect{display:block;max-width:300px;margin:16px auto 0;text-align:left}' +
    '#academy-lk-connect input{display:block;width:100%;box-sizing:border-box;margin:0 0 8px;padding:11px 12px;border-radius:9px;border:1px solid #243245;background:#0b1119;color:#fff;font:400 13px/1.2 system-ui,sans-serif}' +
    '#academy-lk-connect input:focus{outline:none;border-color:#22d97a}' +
    '#academy-lk-connect button{width:100%;margin-top:4px}' +
    '#academy-lk-connect .lk-msg{min-height:18px;margin:10px 0 0;font-size:12px;color:#ffb3bd;text-align:center}' +
    '#academy-lk-connect .lk-msg.ok{color:#9fe8c0}' +
    '#academy-lk-connect .lk-alt{display:block;margin:14px 0 0;background:none;border:0;padding:0;color:#7fb4ff;font:400 12px/1.4 system-ui,sans-serif;text-decoration:underline;cursor:pointer;width:auto;margin-left:auto;margin-right:auto}' +
    /* the header button loops like the launcher on stockmarketloop.com: a green ring that keeps breathing and a light sweep */
    '#academy-lk-btn{position:relative;overflow:hidden;isolation:isolate;border:1px solid #22d97a;border-radius:999px;background:linear-gradient(140deg,#00e07a,#009c55);color:#04170d;font-weight:900;animation:academyLkPulse 2.6s ease-in-out infinite}' +
    '#academy-lk-btn::after{content:"";position:absolute;top:-40%;bottom:-40%;left:0;width:38%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0));animation:academyLkSweep 2.6s linear infinite;pointer-events:none;z-index:-1}' +
    '#academy-lk-btn.on{background:#0b2d1f;color:#9fe8c0;animation:none}' +
    '#academy-lk-btn.on::after{display:none}' +
    '@media (prefers-reduced-motion:reduce){#academy-lk-btn,#academy-lk-btn::after{animation:none}}' +
    '#academy-lk-badge{position:absolute;top:-6px;right:-8px;background:#ff566e;color:#fff;border-radius:999px;font:700 9px/1 system-ui,sans-serif;padding:3px 5px;display:none;z-index:1}' +
    (STANDALONE
      ? '#academy-lk-panel{inset:0;width:auto;height:auto}#academy-lk-card{left:16px;right:16px;top:50%;bottom:auto;transform:translateY(-50%)}'
      : '@media (max-width:700px){#academy-lk-panel.on{left:0!important;right:0!important;bottom:0!important;top:auto!important;width:100vw;height:min(' + PHONE_H + 'px,100dvh)}#academy-lk-grip{cursor:default}}');
  document.head.appendChild(css);

  function buildPanel() {
    if (S.panel) return S.panel;
    var panel = document.createElement('div');
    panel.id = 'academy-lk-panel';
    panel.innerHTML =
      (STANDALONE ? '' : '<div id="academy-lk-grip" title="Drag to move"><span><i>⋮⋮</i>LOOP-KICK</span><button type="button" id="academy-lk-close" title="Close">✕</button></div>') +
      '<div id="academy-lk-card" style="display:none"></div>';
    document.body.appendChild(panel);
    S.panel = panel;
    S.grip = panel.querySelector('#academy-lk-grip');
    var close = panel.querySelector('#academy-lk-close');
    if (close) close.onclick = function (ev) { ev.stopPropagation(); closePanel(); };
    if (S.grip) makeDraggable(S.grip);
    restorePosition();
    return panel;
  }

  function showCard(title, message, buttonLabel, url) {
    var panel = buildPanel();
    var card = panel.querySelector('#academy-lk-card');
    card.style.display = '';
    panel.classList.remove('phone');
    if (S.frame) S.frame.style.display = 'none';
    var key = title + '|' + url;
    if (S.lastCard !== key) {
      card.innerHTML = '<b></b><span></span><div><button></button></div>' + cardCloseHtml();
      wireCardClose(card);
      card.querySelector('b').textContent = title;
      card.querySelector('span').textContent = message;
      var go = card.querySelector('button');
      go.textContent = buttonLabel;
      go.onclick = function () {
        if (url === '#') { S.lastCard = ''; openPanel(); return; }
        openExternal(url);
      };
      S.lastCard = key;
    }
  }

  function openExternal(url) {
    if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url);
    else { try { window.open(url, '_blank', 'noopener'); } catch (e) {} }
  }

  /* "Connect your account": sign in with the stockmarketloop.com password right here. The platform checks it with the
     site and stores Discord ↔ member; the phone then loads on the next mint. Members without an account take the signed
     link, which finishes the connection on the site after they register. No link code, no slash command. */
  function showConnect(j) {
    var panel = buildPanel();
    var card = panel.querySelector('#academy-lk-card');
    card.style.display = '';
    panel.classList.remove('phone');
    if (S.frame) S.frame.style.display = 'none';
    if (S.lastCard === 'connect') return;
    S.lastCard = 'connect';
    var siteUrl = (j && j.connect_url) || SITE_CONNECT_URL;
    card.innerHTML =
      cardCloseHtml() +
      '<b>Connect your stockmarketloop.com account</b>' +
      '<span>LOOP-KICK runs on your stockmarketloop.com account. Sign in once and it is connected to this Discord. No code to copy, nothing to type in Discord.</span>' +
      '<form id="academy-lk-connect" autocomplete="on">' +
        '<input name="login" placeholder="Username or email" autocomplete="username" maxlength="120" required>' +
        '<input name="password" type="password" placeholder="Password" autocomplete="current-password" maxlength="512" required>' +
        '<input name="code" placeholder="Two-step code" autocomplete="one-time-code" inputmode="numeric" maxlength="32" style="display:none">' +
        '<button type="submit">Connect</button>' +
        '<p class="lk-msg"></p>' +
        '<button type="button" class="lk-alt">No account yet? Create one on stockmarketloop.com</button>' +
      '</form>';
    wireCardClose(card);
    var form = card.querySelector('#academy-lk-connect');
    var msg = form.querySelector('.lk-msg');
    var codeInput = form.querySelector('input[name=code]');
    var submit = form.querySelector('button[type=submit]');
    function say(text, ok) { msg.textContent = text || ''; msg.className = 'lk-msg' + (ok ? ' ok' : ''); }
    function fallback(text) {
      /* the site cannot take the sign-in right now: keep the classic page one tap away */
      say(text || 'Sign-in is unavailable right now. You can connect on stockmarketloop.com instead.');
      submit.textContent = 'Connect on stockmarketloop.com';
      submit.type = 'button';
      submit.onclick = function () { openExternal(siteUrl); };
    }
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var login = String(form.login.value || '').trim();
      var password = String(form.password.value || '');
      var code = String(codeInput.value || '').trim();
      if (!login || !password) { say('Enter your stockmarketloop.com username and password.'); return; }
      submit.disabled = true; say('Connecting…', true);
      fetch(CONNECT_ROUTE, { method: 'POST', headers: { authorization: 'Bearer ' + activitySession(), 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ login: login, password: password, code: code }) })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, j: b || {} }; }, function () { return { status: r.status, j: {} }; }); })
        .then(function (res) {
          submit.disabled = false;
          var b = res.j;
          if (b.ok) {
            form.password.value = ''; codeInput.value = '';
            say('Connected' + (b.user && b.user.handle ? ' as @' + b.user.handle : '') + '. Opening LOOP-KICK…', true);
            S.lastCard = '';
            setTimeout(function () { openPanel(); }, 600);
            return;
          }
          switch (b.error) {
            case 'two_step_required':
              codeInput.style.display = ''; codeInput.focus();
              say(b.method === 'email' ? 'Enter the sign-in code we just emailed to ' + (b.hint || 'your address') + '.' : 'Enter the code from your authenticator app.');
              break;
            case 'two_step_invalid': codeInput.style.display = ''; codeInput.focus(); say('That code did not match. Try again.'); break;
            case 'invalid_credentials': say('Wrong username or password.'); break;
            case 'rate_limited': say('Too many tries. Wait ' + Math.max(1, Math.ceil((Number(b.retryAfterSec) || 900) / 60)) + ' minutes and try again.'); break;
            case 'account_blocked': say('This stockmarketloop.com account cannot sign in right now.'); break;
            case 'discord_already_linked': say('This Discord account is already connected to a different stockmarketloop.com account. Disconnect it on the site first.'); break;
            case 'authorization_required': say('Your Academy session lapsed. Close and reopen LOOP-KICK.'); break;
            case 'academy_access_required': say('LOOP-KICK is part of the paid Academy.'); break;
            case 'invalid_request': say('Enter your stockmarketloop.com username and password.'); break;
            default: fallback();
          }
        })
        .catch(function () { submit.disabled = false; fallback(); });
    };
    form.querySelector('.lk-alt').onclick = function () {
      say('Opening stockmarketloop.com…', true);
      fetch(CONNECT_LINK_ROUTE, { headers: { authorization: 'Bearer ' + activitySession() }, cache: 'no-store' })
        .then(function (r) { return r.json(); }, function () { return null; })
        .then(function (b) {
          openExternal(b && b.ok && /^https:\/\/stockmarketloop\.com\//.test(String(b.url || '')) ? b.url : siteUrl);
          say('Finish on stockmarketloop.com, then come back and tap LOOP-KICK again.', true);
        });
    };
    setTimeout(function () { try { form.login.focus(); } catch (e) {} }, 50);
  }

  function showPhone() {
    var panel = buildPanel();
    panel.querySelector('#academy-lk-card').style.display = 'none';
    panel.classList.add('phone');
    S.lastCard = '';
    if (!S.frame) {
      var frame = document.createElement('iframe');
      frame.id = 'academy-lk-frame';
      frame.setAttribute('allow', 'microphone; camera; autoplay');
      frame.setAttribute('allowtransparency', 'true');
      frame.setAttribute('title', 'LOOP-KICK');
      frame.setAttribute('src', FRAME_PATH);
      frame.addEventListener('load', function () { kick(); });
      panel.appendChild(frame);
      S.frame = frame;
      S.heard = false;
      /* if the phone never answers, the Discord URL mapping for /loop-kick is probably missing or wrong: say so instead of showing whatever loaded */
      setTimeout(function () {
        if (S.open && S.frame === frame && !S.heard) {
          frame.style.display = 'none';
          showCard('LOOP-KICK did not load here', 'The phone could not be reached from inside the Academy. You can open LOOP-KICK on stockmarketloop.com instead.', 'Open on stockmarketloop.com', 'https://stockmarketloop.com/');
        }
      }, 12000);
    }
    S.frame.style.display = '';
    fitSurfaces(S.surfaceBox ? [S.surfaceBox] : null);
    if (S.frameReady && S.token) { sendAuth(); tellFrame('open'); }
  }

  function cardCloseHtml() { return STANDALONE ? '' : '<button type="button" class="lk-card-x" title="Close">✕</button>'; }
  function wireCardClose(card) {
    var x = card.querySelector('.lk-card-x');
    if (x) x.onclick = function (ev) { ev.stopPropagation(); closePanel(); };
  }

  /* The phone reports the rectangles of its screen and deck (and of its dock pill when closed). The frame is clipped to
     their union, so everything around the device stays transparent AND clickable, and the grip sits just above the screen. */
  function fitSurfaces(list) {
    if (!S.frame || STANDALONE) return;
    var rects = (list || []).filter(function (r) { return r && r.width > 0 && r.height > 0; });
    if (!rects.length) { S.frame.style.clipPath = ''; S.surfaceBox = null; placeGrip(null); return; }
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, radius = 30;
    rects.forEach(function (r) {
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.width); y2 = Math.max(y2, r.y + r.height);
      radius = Math.min(radius, Number(r.radius) || 16);
    });
    var box = { x: Math.max(0, Math.floor(x1) - 1), y: Math.max(0, Math.floor(y1) - 1), width: Math.ceil(x2 - x1) + 2, height: Math.ceil(y2 - y1) + 2, radius: radius };
    S.surfaceBox = box;
    var w = S.frame.clientWidth || PHONE_W, h = S.frame.clientHeight || PHONE_H;
    S.frame.style.clipPath = 'inset(' + box.y + 'px ' + Math.max(0, w - box.x - box.width) + 'px ' + Math.max(0, h - box.y - box.height) + 'px ' + box.x + 'px round ' + radius + 'px)';
    placeGrip(box);
  }

  function placeGrip(box) {
    if (!S.grip) return;
    if (!box) { S.grip.style.left = ''; S.grip.style.right = ''; S.grip.style.top = ''; return; }
    var panelW = S.panel ? S.panel.clientWidth : PHONE_W;
    S.grip.style.left = box.x + 'px';
    S.grip.style.right = Math.max(0, panelW - box.x - box.width) + 'px';
    S.grip.style.top = Math.max(0, box.y - 30) + 'px';
  }

  /* ---- floating position: bottom-right like the site, draggable by the grip, remembered per browser ---- */
  function isNarrow() { return window.matchMedia('(max-width:700px)').matches; }

  function applyPosition() {
    if (!S.panel || STANDALONE) return;
    var st = S.panel.style;
    if (isNarrow() || !S.pos) { st.left = ''; st.top = ''; st.right = '26px'; st.bottom = '26px'; if (isNarrow()) { st.right = ''; st.bottom = ''; } return; }
    var w = S.panel.offsetWidth || PHONE_W, h = S.panel.offsetHeight || PHONE_H;
    var x = Math.min(Math.max(0, S.pos.x), Math.max(0, window.innerWidth - w));
    var y = Math.min(Math.max(0, S.pos.y), Math.max(0, window.innerHeight - h));
    st.right = ''; st.bottom = ''; st.left = Math.round(x) + 'px'; st.top = Math.round(y) + 'px';
  }

  function restorePosition() {
    try {
      var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && isFinite(saved.x) && isFinite(saved.y)) S.pos = { x: Number(saved.x), y: Number(saved.y) };
    } catch (e) { S.pos = null; }
    applyPosition();
  }

  function savePosition() {
    try { if (S.pos) localStorage.setItem(POS_KEY, JSON.stringify(S.pos)); } catch (e) { /* private mode */ }
  }

  function makeDraggable(grip) {
    grip.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      if (ev.target && ev.target.closest && ev.target.closest('button')) return;
      if (isNarrow()) return;
      var r = S.panel.getBoundingClientRect();
      S.dragging = { id: ev.pointerId, dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      grip.classList.add('dragging');
      try { grip.setPointerCapture(ev.pointerId); } catch (e) {}
      /* the iframe would swallow the pointer the moment it crosses it */
      if (S.frame) S.frame.style.pointerEvents = 'none';
      ev.preventDefault();
    });
    grip.addEventListener('pointermove', function (ev) {
      if (!S.dragging || ev.pointerId !== S.dragging.id) return;
      S.pos = { x: ev.clientX - S.dragging.dx, y: ev.clientY - S.dragging.dy };
      applyPosition();
    });
    function end(ev) {
      if (!S.dragging || (ev && ev.pointerId !== S.dragging.id)) return;
      S.dragging = null;
      grip.classList.remove('dragging');
      if (S.frame) S.frame.style.pointerEvents = '';
      savePosition();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
  }

  window.addEventListener('resize', function () { applyPosition(); fitSurfaces(S.surfaceBox ? [S.surfaceBox] : null); });

  function closePanel() {
    S.open = false;
    if (S.panel) S.panel.classList.remove('on');
    if (S.button) { S.button.classList.remove('on'); S.button.setAttribute('aria-expanded', 'false'); }
    tellFrame('close');
    announce(false);
  }

  function openPanel() {
    S.open = true;
    S.sawOpen = false;
    buildPanel().classList.add('on');
    if (S.button) { S.button.classList.add('on'); S.button.setAttribute('aria-expanded', 'true'); }
    applyPosition();
    announce(true);
    mint(false).then(function (res) {
      if (!res || !res.j) { showCard('LOOP-KICK is unavailable', 'The connection could not be made. Try again in a moment.', 'Retry', '#'); return; }
      var j = res.j;
      if (j.ok && j.token) {
        S.token = j.token; S.expiresAt = Number(j.expires_at) || 0;
        scheduleRefresh();
        showPhone();
      } else if (j.error === 'not_linked') {
        showConnect(j);
      } else if (j.error === 'not_verified') {
        showCard('Verify your email', 'Your stockmarketloop.com account still needs its email code. Verify it, then come back.', 'Verify now', j.verify_url || 'https://stockmarketloop.com/register/');
      } else {
        showCard('LOOP-KICK is unavailable', 'The messenger cannot be reached right now. Try again shortly.', 'Retry', '#');
      }
    });
  }

  function toggle() { if (S.open) closePanel(); else openPanel(); }

  /* what the Academy notifications feed (academy-social-notify-ui.js) needs: the panel to sit in, the grip for its bell,
     whether the phone is open, and a way to add its unread count to the header badge */
  window.smlLoopKick = {
    open: openPanel, close: closePanel, toggle: toggle,
    isOpen: function () { return S.open; },
    panel: buildPanel, grip: function () { return S.grip; }, standalone: STANDALONE,
    setAcademyUnread: function (n) { S.academyUnread = Math.max(0, Number(n) || 0); renderBadge(); },
    /* hand the phone something (the Academy notifications): true when it was sent to a loaded phone */
    send: function (kind, payload) {
      if (!S.frame || !S.frame.contentWindow || !S.heard) return false;
      var origin = frameOrigin(); if (!origin) return false;
      try { S.frame.contentWindow.postMessage(Object.assign({ type: 'sml-loop-kick:' + kind, version: 1 }, payload || {}), origin); return true; } catch (e) { return false; }
    }
  };

  /* ---- entry points ---- */
  if (STANDALONE) {
    function bootStandalone() {
      if (!activitySession()) return; /* wait for the Discord handshake */
      openPanel();
    }
    if (activitySession()) bootStandalone();
    window.addEventListener('sml-academy-session', bootStandalone, { once: true });
  } else {
    function ensureButton() {
      if (document.getElementById('academy-lk-btn')) return;
      var bar = document.querySelector('.bar');
      if (!bar) return;
      var btn = document.createElement('button');
      btn.id = 'academy-lk-btn';
      btn.type = 'button';
      btn.textContent = 'LOOP-KICK';
      btn.title = 'Your stockmarketloop.com messages and alerts';
      btn.setAttribute('aria-expanded', 'false');
      var ref = bar.querySelector('#status');
      bar.insertBefore(btn, ref || null);
      var badge = document.createElement('span');
      badge.id = 'academy-lk-badge';
      btn.appendChild(badge);
      S.badge = badge;
      S.button = btn;
      btn.onclick = toggle;
    }
    ensureButton();
    new MutationObserver(ensureButton).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
