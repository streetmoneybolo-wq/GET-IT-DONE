/* LOOP-KICK inside Discord.
   Academy mode: a LOOP-KICK button in the header bar opens the real hosted phone
   in a panel pinned over the quote column (never the chart), phone-width becomes a
   bottom sheet. Standalone mode (the Connect app's /loop-kick Activity) renders it
   full screen. The phone iframe loads through Discord's URL mapping at
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
  var EXTERNAL_OK = /^https:\/\/(stockmarketloop-loop-kick\.onrender\.com\/enable-alerts\.html|stockmarketloop\.com\/)/;

  var S = {
    open: false, frame: null, panel: null, badge: null, button: null,
    token: '', expiresAt: 0, refreshTimer: null, frameReady: false,
    lastCard: '', minting: false
  };

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
    if (d && typeof d.type === 'string' && d.type.indexOf('sml-loop-kick:') === 0) S.heard = true;
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
      if (S.open && d.surface !== 'expanded' && S.token && (S.unfoldTries || 0) < 6) { S.unfoldTries = (S.unfoldTries || 0) + 1; sendAuth(); tellFrame('open'); }
      if (d.surface === 'expanded') S.unfoldTries = 0;
    } else if (d.type === 'sml-loop-kick:notifications') {
      paintBadge(Number(d.unread) || 0);
    } else if (d.type === 'sml-loop-kick:external') {
      /* the phone cannot leave Discord's sandbox itself (e.g. phone-alert setup) */
      var url = String(d.url || '');
      if (!EXTERNAL_OK.test(url)) return;
      openExternal(url);
    }
  });

  function paintBadge(unread) {
    if (!S.badge) return;
    S.badge.textContent = unread > 99 ? '99+' : String(unread);
    S.badge.style.display = unread > 0 ? '' : 'none';
  }

  /* ---- panel ---- */
  var css = document.createElement('style');
  css.textContent =
    '#academy-lk-panel{display:none;flex-direction:column;background:#070b12;border:1px solid #1b2837;border-radius:14px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.55)}' +
    '#academy-lk-panel.on{display:flex}' +
    '#academy-lk-panel iframe{flex:1;width:100%;border:0;background:transparent}' +
    '#academy-lk-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#0b1119;border-bottom:1px solid #16202d;font:700 11px/1 system-ui,sans-serif;color:#9fe8c0;letter-spacing:.8px}' +
    '#academy-lk-head button{background:none;border:0;color:#7e92a8;font-size:15px;cursor:pointer;padding:2px 6px}' +
    '#academy-lk-card{padding:26px 20px;color:#cfdbe8;font:400 13px/1.6 system-ui,sans-serif;text-align:center}' +
    '#academy-lk-card b{display:block;font-size:14px;margin-bottom:8px;color:#fff}' +
    '#academy-lk-card button{margin-top:14px;background:#22d97a;color:#04170d;border:0;border-radius:9px;padding:11px 18px;font:700 12px/1 system-ui,sans-serif;cursor:pointer}' +
    '#academy-lk-card button[disabled]{opacity:.55;cursor:default}' +
    '#academy-lk-connect{display:block;max-width:300px;margin:16px auto 0;text-align:left}' +
    '#academy-lk-connect input{display:block;width:100%;box-sizing:border-box;margin:0 0 8px;padding:11px 12px;border-radius:9px;border:1px solid #243245;background:#0b1119;color:#fff;font:400 13px/1.2 system-ui,sans-serif}' +
    '#academy-lk-connect input:focus{outline:none;border-color:#22d97a}' +
    '#academy-lk-connect button{width:100%;margin-top:4px}' +
    '#academy-lk-connect .lk-msg{min-height:18px;margin:10px 0 0;font-size:12px;color:#ffb3bd;text-align:center}' +
    '#academy-lk-connect .lk-msg.ok{color:#9fe8c0}' +
    '#academy-lk-connect .lk-alt{display:block;margin:14px 0 0;background:none;border:0;padding:0;color:#7fb4ff;font:400 12px/1.4 system-ui,sans-serif;text-decoration:underline;cursor:pointer;width:auto;margin-left:auto;margin-right:auto}' +
    '#academy-lk-btn{position:relative}' +
    '#academy-lk-badge{position:absolute;top:-6px;right:-8px;background:#ff566e;color:#fff;border-radius:999px;font:700 9px/1 system-ui,sans-serif;padding:3px 5px;display:none}' +
    (STANDALONE
      ? '#academy-lk-panel{position:fixed;inset:0;border-radius:0;border:0;z-index:2147483100}'
      : '@media (max-width:700px){#academy-lk-panel.on{position:fixed;left:0;right:0;bottom:0;top:18vh;border-radius:16px 16px 0 0;z-index:2147483100}}');
  document.head.appendChild(css);

  function buildPanel() {
    if (S.panel) return S.panel;
    var panel = document.createElement('div');
    panel.id = 'academy-lk-panel';
    panel.innerHTML =
      '<div id="academy-lk-head"><span>LOOP-KICK</span>' + (STANDALONE ? '<span></span>' : '<button id="academy-lk-close" title="Close">✕</button>') + '</div>' +
      '<div id="academy-lk-card" style="display:none"></div>';
    document.body.appendChild(panel);
    S.panel = panel;
    var close = panel.querySelector('#academy-lk-close');
    if (close) close.onclick = function () { closePanel(); };
    return panel;
  }

  function showCard(title, message, buttonLabel, url) {
    var panel = buildPanel();
    var card = panel.querySelector('#academy-lk-card');
    card.style.display = '';
    if (S.frame) S.frame.style.display = 'none';
    var key = title + '|' + url;
    if (S.lastCard !== key) {
      card.innerHTML = '<b></b><span></span><div><button></button></div>';
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
    if (S.frame) S.frame.style.display = 'none';
    if (S.lastCard === 'connect') return;
    S.lastCard = 'connect';
    var siteUrl = (j && j.connect_url) || SITE_CONNECT_URL;
    card.innerHTML =
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
    S.lastCard = '';
    if (!S.frame) {
      var frame = document.createElement('iframe');
      frame.id = 'academy-lk-frame';
      frame.setAttribute('allow', 'microphone; camera; autoplay');
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
    if (S.frameReady && S.token) { sendAuth(); tellFrame('open'); }
  }

  /* pin over the quote column like the MEM ALGO panel; never the chart */
  function place() {
    if (STANDALONE || !S.panel || !S.open) return;
    if (window.matchMedia('(max-width:700px)').matches) {
      ['position', 'left', 'top', 'width', 'height', 'right', 'bottom', 'zIndex'].forEach(function (k) { S.panel.style[k] = ''; });
      return;
    }
    function visible(node) {
      if (!node) return null;
      var r = node.getBoundingClientRect();
      return r.width > 40 && r.height > 80 ? r : null;
    }
    var r = visible(document.querySelector('.side')) || visible(document.getElementById('academy-alerts'));
    if (!r) return;
    if (S.panel.parentElement !== document.body) document.body.appendChild(S.panel);
    S.panel.style.position = 'fixed';
    S.panel.style.left = Math.round(r.x) + 'px';
    S.panel.style.top = Math.round(r.y) + 'px';
    S.panel.style.width = Math.round(r.width) + 'px';
    S.panel.style.height = Math.round(r.height) + 'px';
    S.panel.style.zIndex = '2147483100';
  }
  window.addEventListener('resize', place);
  setInterval(place, 1500);

  function closePanel() {
    S.open = false;
    if (S.panel) S.panel.classList.remove('on');
    tellFrame('close');
  }

  function openPanel() {
    S.open = true;
    buildPanel().classList.add('on');
    place();
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
