/* SML Creator Gate — enforcement on /creator-studio/, /go-live/, /upload-video/.
   No confirmed access to those pages' own DOM/source, so this doesn't try to
   surgically hide their content — it drops a full-screen blocking overlay on
   top (self-contained, works regardless of what's underneath) until the
   requirement is met. Requires creator-gate.js to also be loaded on these
   pages (for the actual creation flow the CTA button opens). */
(function () {
  'use strict';
  if (window.__smlCreatorGateEnforceBooted) return;
  window.__smlCreatorGateEnforceBooted = true;

  var path = location.pathname.replace(/\/?$/, '/');
  var NEEDS_CHANNEL_ONLY = /\/(go-live|upload-video)\//.test(path);
  var NEEDS_EITHER = /\/creator-studio\//.test(path);
  if (!NEEDS_CHANNEL_ONLY && !NEEDS_EITHER) return;

  var NONCE = (window.wpApiSettings && window.wpApiSettings.nonce) || window.SML_CG_NONCE || '';
  function api(path) {
    var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE;
    return fetch('/wp-json' + path, { credentials: 'same-origin', headers: h, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }

  function blockingOverlay(label, cta) {
    var o = document.createElement('div');
    o.id = 'sml-cg-block';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#04060a;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Archivo,sans-serif';
    o.innerHTML =
      '<div style="max-width:420px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px">' +
      '<span style="font:700 9px/1 Archivo,sans-serif;letter-spacing:.14em;color:#5d7085">CREATOR REQUIREMENT</span>' +
      '<h2 style="font:800 20px/1.3 Archivo,sans-serif;color:#e6edf3;margin:0">' + label + '</h2>' +
      '<p style="font:400 12px/1.6 Archivo,sans-serif;color:#8fa3b5;margin:0">This is a one-time setup — name, date of birth, city, state, phone, and email, then pick a handle.</p>' +
      '<button id="sml-cg-block-cta" style="font:700 12px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border:none;border-radius:8px;padding:14px 22px;cursor:pointer">' + cta + '</button>' +
      '<a href="/" style="font:600 11px/1 Archivo,sans-serif;color:#5d7085;text-decoration:none">← Back to home</a>' +
      '</div>';
    document.documentElement.appendChild(o);
    document.body.style.overflow = 'hidden';
  }

  function ensureCreatorGateJs(cb) {
    if (window.__smlCreatorGateBooted) { cb(); return; }
    var sc = document.querySelector('script[src*="creator-gate.js"]');
    var base = sc ? sc.src.replace(/js\/creator-gate\.js.*$/, '') : (document.querySelector('script[src*="creator-gate-enforce.js"]') || {}).src;
    if (base && base.indexOf('creator-gate-enforce.js') > -1) base = base.replace(/js\/creator-gate-enforce\.js.*$/, '');
    if (!base) { cb(); return; }
    var s = document.createElement('script'); s.src = base + 'js/creator-gate.js';
    s.onload = cb; s.onerror = cb;
    document.head.appendChild(s);
  }

  /* hasLetter has no server-side check in sml-creator-gate/v1/status (that
     endpoint only knows sml_channel_handle) — checked here directly against
     the real loopletters endpoint instead of guessing its storage. */
  function hasLetter() {
    return api('/sml-loopletters/v1/settings').then(function (res) {
      if (!res.ok || !res.j) return false;
      var j = res.j;
      var handle = j.handle || (j.publication && j.publication.handle) || (j.settings && j.settings.handle);
      return !!handle;
    }).catch(function () { return false; });
  }

  function check() {
    api('/sml-creator-gate/v1/status').then(function (res) {
      if (res.status === 401) {
        window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.href);
        return;
      }
      if (!res.ok) return; // status check itself failed — fail open rather than lock everyone out on an outage
      var j = res.j || {};
      if (j.hasChannel) return; // channel alone satisfies both requirements
      var afterLetterCheck = function (letter) {
        var ok = NEEDS_CHANNEL_ONLY ? false : letter;
        if (ok) return;
        var label = NEEDS_CHANNEL_ONLY ? 'You need a Loop Channel to continue' : 'You need a Loop Channel or Loop Letter to continue';
        blockingOverlay(label, NEEDS_CHANNEL_ONLY ? 'Create a Loop Channel' : 'Create a Loop Channel or Letter');
        ensureCreatorGateJs(function () {
          var btn = document.getElementById('sml-cg-block-cta');
          if (btn) btn.onclick = function () { if (window.__smlCreatorGateStart) window.__smlCreatorGateStart('channel'); };
        });
      };
      if (NEEDS_CHANNEL_ONLY) afterLetterCheck(false);
      else hasLetter().then(afterLetterCheck);
    }).catch(function () {}); // network failure — fail open, don't lock out on a blip
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
})();
