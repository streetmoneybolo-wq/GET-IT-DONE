/* RESET for the Academy window. Some computers draw the Activity black or frozen (graphics driver trouble, a stale saved layout, an old cached file).
   A RESET button sits next to TOUR and GUIDE (or in the corner when the toolbar is not there):
     Reset            clears the saved layout and view settings, the cached files and service workers, then reloads
     Reset + Lite     the same, and from then on draws with lighter graphics (no blur, shadows or animation, charts at normal resolution)
   Chart drawings, the theme, lesson progress and the chat are kept (progress and chat live on the server).
   Lite mode can be switched off from the same card. ?reset=1 on the address does a Reset at load. Educational tool; nothing here touches an account. */
(function () {
  if (window.__smlReset) return;
  window.__smlReset = true;
  var LITE = 'sml-lite';
  var CLEAR = ['sml-academy-layout-v2', 'sml-chart-quality', 'sml-chart-dpr-cap', 'sml-chart-view', 'sml-chart-clean', 'sml-chart-lock', 'sml-compact', 'sml-desk-layout', 'sml-desk-area',
    'sml-below-view-v1', 'sml-rail-tab', 'sml-dir-open', 'sml-fold-calc', 'sml-opt-mini-tf', 'sml-mem-scn-strip', 'sml-academy-gate-reload', 'sml-academy-resume', 'sml-live-data', 'sml-academy-popout-v1'];
  var get = function (k) { try { return localStorage.getItem(k); } catch (_) { return null; } };
  var set = function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* storage can be blocked */ } };
  var lite = get(LITE) === '1';
  if (lite) document.documentElement.classList.add('sml-lite');

  var css = document.createElement('style');
  css.textContent = 'html.sml-lite *,html.sml-lite *::before,html.sml-lite *::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important;box-shadow:none!important;text-shadow:none!important;will-change:auto!important}'
    + '#sml-reset-btn{flex:none;padding:4px 8px;border:1px solid #6b4a22;border-radius:7px;background:#1a130a;color:#ffcf7a;font:800 .6rem ui-monospace,monospace;letter-spacing:.04em;cursor:pointer}'
    + '#sml-reset-btn.corner{position:fixed;left:6px;bottom:6px;z-index:2147483200;opacity:.75}'
    + '#sml-reset-card{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483640;width:min(340px,calc(100vw - 24px));box-sizing:border-box;padding:10px 12px;border-radius:10px;background:rgba(10,16,24,.98);border:1px solid #8a6a1c;color:#e6eef2;font:600 .66rem/1.45 system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.5)}'
    + '#sml-reset-card b{color:#ffcf7a}#sml-reset-card .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}#sml-reset-card button{flex:1 1 auto;padding:6px 8px;border-radius:7px;border:1px solid #2a4a58;background:#0d1a24;color:#e6eef2;font:800 .62rem ui-monospace,monospace;cursor:pointer}#sml-reset-card button.go{background:#3a2d10;border-color:#8a6a1c;color:#ffd166}';
  document.head.appendChild(css);

  function wipe() {
    for (var i = 0; i < CLEAR.length; i++) set(CLEAR[i], null);
    try { sessionStorage.clear(); } catch (_) { /* ignore */ }
    var jobs = [];
    try { if (window.caches && caches.keys) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (_) { /* ignore */ }
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (_) { /* ignore */ }
    return Promise.race([Promise.all(jobs.map(function (p) { return p.catch(function () { return null; }); })), new Promise(function (r) { setTimeout(r, 2500); })]);
  }
  /* the page is loaded again with a changing query, so no copy kept by Discord or the browser is reused */
  function reload() {
    var u = new URL(location.href); u.searchParams.delete('reset'); u.searchParams.set('r', String(Date.now()));
    try { location.replace(u.toString()); } catch (_) { location.reload(); }
  }
  function doReset(withLite) {
    if (withLite === true) set(LITE, '1'); else if (withLite === false) set(LITE, null);
    wipe().then(reload, reload);
  }
  window.smlReset = { run: doReset, lite: function () { return get(LITE) === '1'; } };

  var card = null;
  function close() { if (card) { card.remove(); card = null; } }
  function open() {
    if (card) { close(); return; }
    card = document.createElement('div'); card.id = 'sml-reset-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Reset the Academy');
    var on = get(LITE) === '1';
    card.innerHTML = '<b>RESET THE ACADEMY</b><div>Blank, black or stuck? This clears the saved layout and cached files and reloads. Your drawings, theme and progress are kept.</div>'
      + '<div class="row"><button type="button" class="go" data-r="reset">Reset</button>'
      + (on ? '<button type="button" data-r="full">Reset + full graphics</button>' : '<button type="button" data-r="lite">Reset + Lite mode</button>')
      + '<button type="button" data-r="cancel">Cancel</button></div>'
      + (on ? '<div style="margin-top:6px;color:#a8c2b8">Lite mode is on: no blur, shadows or animation.</div>' : '<div style="margin-top:6px;color:#a8c2b8">Lite mode draws lighter graphics, which helps on computers that show a black window.</div>');
    card.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-r]'); if (!b) return;
      var k = b.dataset.r;
      if (k === 'cancel') { close(); return; }
      b.disabled = true; b.textContent = 'Resetting…';
      doReset(k === 'lite' ? true : k === 'full' ? false : undefined);
    });
    document.body.appendChild(card);
  }

  var btn = null;
  function mount() {
    if (btn && document.body.contains(btn)) return true;
    var tail = document.querySelector('#tool-rail .tail');
    if (!tail) return false;
    btn = document.createElement('button'); btn.type = 'button'; btn.id = 'sml-reset-btn'; btn.textContent = lite ? 'RESET · LITE' : 'RESET'; btn.title = 'Blank or stuck? Clear the saved layout and cached files and reload';
    btn.addEventListener('click', open); tail.appendChild(btn); return true;
  }
  /* the toolbar may not exist when something is badly wrong, so a small corner button stands in */
  function fallback() {
    if (document.getElementById('sml-reset-btn')) return;
    btn = document.createElement('button'); btn.type = 'button'; btn.id = 'sml-reset-btn'; btn.className = 'corner'; btn.textContent = 'RESET'; btn.title = 'Blank or stuck? Clear the saved layout and cached files and reload';
    btn.addEventListener('click', open); document.body.appendChild(btn);
  }
  var tries = 0;
  (function wait() { if (mount()) return; if (++tries < 24) setTimeout(wait, 250); else fallback(); })();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  if (location.search.indexOf('reset=1') >= 0) doReset(undefined);
})();
