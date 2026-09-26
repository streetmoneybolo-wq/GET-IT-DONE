/* LOOP-KICK inside Discord.
   Academy mode: a LOOP-KICK button in the header bar opens the real hosted phone
   in a panel pinned over the quote column (never the chart), phone-width becomes a
   bottom sheet. Standalone mode (the Connect app's /loop-kick Activity) renders it
   full screen. The phone iframe loads through Discord's URL mapping at
   /.proxy/loop-kick/ and receives its short-lived site session by postMessage after
   it announces sml-loop-kick:ready; the session silently re-mints before expiry.
   Members without a linked+verified stockmarketloop.com account get a card that
   sends them to connect (external browser) — nothing else works until then.
   This module never writes to Discord: no DMs, no channel posts. */
(function () {
  if (window.__smlLoopKickModule) return;
  window.__smlLoopKickModule = true;

  var CFG = window.SML_LOOP_KICK_ACTIVITY || {};
  var STANDALONE = !!CFG.standalone;
  var SESSION_ROUTE = CFG.sessionRoute || '/academy-activity/loop-kick/session';
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
    if (d.type === 'sml-loop-kick:ready' || d.type === 'sml-loop-kick:auth-needed') {
      S.frameReady = true;
      var stale = !S.token || (S.expiresAt && S.expiresAt * 1000 <= Date.now() + 5000);
      if (d.type === 'sml-loop-kick:auth-needed' || stale) {
        S.token = '';
        refreshToken();
      } else {
        sendAuth();
      }
      if (S.open) tellFrame('open');
    } else if (d.type === 'sml-loop-kick:notifications') {
      paintBadge(Number(d.unread) || 0);
    } else if (d.type === 'sml-loop-kick:external') {
      /* the phone cannot leave Discord's sandbox itself (e.g. phone-alert setup) */
      var url = String(d.url || '');
      if (!EXTERNAL_OK.test(url)) return;
      if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url);
      else { try { window.open(url, '_blank', 'noopener'); } catch (e) {} }
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
        if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url);
        else { try { window.open(url, '_blank', 'noopener'); } catch (e) {} }
      };
      S.lastCard = key;
    }
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
      panel.appendChild(frame);
      S.frame = frame;
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
        showCard('Connect your account', 'LOOP-KICK runs on your stockmarketloop.com account. Create one (free) and connect your Discord to use it here.', 'Connect on stockmarketloop.com', j.connect_url || 'https://stockmarketloop.com/connect-discord/');
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
