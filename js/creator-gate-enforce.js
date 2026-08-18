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

  var loader = document.getElementById('sml-cg-js');
  var NONCE = (window.wpApiSettings && window.wpApiSettings.nonce) || window.SML_CG_NONCE || (loader && loader.dataset.nonce) || '';
  function api(path) {
    var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE;
    return fetch('/wp-json' + path, { credentials: 'same-origin', headers: h, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }

  function blockingOverlay(label, needsRegistration, allowLetter) {
    var old = document.getElementById('sml-cg-block');
    if (old) old.remove();
    var o = document.createElement('div');
    o.id = 'sml-cg-block';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147482000;background:#04060a;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Archivo,sans-serif';
    o.innerHTML =
      '<div style="max-width:420px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px">' +
      '<span style="font:700 9px/1 Archivo,sans-serif;letter-spacing:.14em;color:#5d7085">CREATOR REQUIREMENT</span>' +
      '<h2 style="font:800 20px/1.3 Archivo,sans-serif;color:#e6edf3;margin:0">' + label + '</h2>' +
      '<p style="font:400 12px/1.6 Archivo,sans-serif;color:#8fa3b5;margin:0">This is a one-time setup — name, date of birth, city, state, phone, and email, then pick a handle.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">' +
      '<button id="sml-cg-block-channel" style="font:700 12px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border:none;border-radius:8px;padding:14px 22px;cursor:pointer">' + (needsRegistration ? 'Register + create Channel' : 'Create a Loop Channel') + '</button>' +
      (allowLetter ? '<button id="sml-cg-block-letter" style="font:700 12px/1 Archivo,sans-serif;color:#e6edf3;background:#101923;border:1px solid #2a3a49;border-radius:8px;padding:14px 22px;cursor:pointer">' + (needsRegistration ? 'Register + create Letter' : 'Create a Loop Letter') + '</button>' : '') +
      '</div>' +
      '<a href="/" style="font:600 11px/1 Archivo,sans-serif;color:#5d7085;text-decoration:none">← Back to home</a>' +
      '</div>';
    document.documentElement.appendChild(o);
    document.body.style.overflow = 'hidden';
  }

  function checkingOverlay() {
    var old = document.getElementById('sml-cg-block');
    if (old) old.remove();
    var o = document.createElement('div');
    o.id = 'sml-cg-block';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147482000;background:#04060a;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Archivo,sans-serif';
    o.innerHTML = '<div style="text-align:center"><span style="font:700 10px/1 Archivo,sans-serif;letter-spacing:.14em;color:#5d7085">CHECKING CREATOR ACCESS</span></div>';
    document.documentElement.appendChild(o);
    if (document.body) document.body.style.overflow = 'hidden';
    document.documentElement.dataset.smlCgEnforce = 'checking';
  }

  function allowPage() {
    var old = document.getElementById('sml-cg-block');
    if (old) old.remove();
    if (document.body) document.body.style.overflow = '';
    document.documentElement.dataset.smlCgEnforce = 'allowed';
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

  function verificationFailure() {
    document.documentElement.dataset.smlCgEnforce = 'verification-failed';
    blockingOverlay('We could not verify your creator access', false, false);
    var ch = document.getElementById('sml-cg-block-channel');
    if (ch) { ch.textContent = 'Retry'; ch.onclick = function () { window.location.reload(); }; }
  }

  function check() {
    api('/sml-creator-gate/v1/status').then(function (res) {
      if (res.status === 401) {
        document.documentElement.dataset.smlCgEnforce = 'login-required';
        window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.href);
        return;
      }
      if (!res.ok) { verificationFailure(); return; }
      var j = res.j || {};
      var entitlement = NEEDS_CHANNEL_ONLY ? !!j.hasChannel : !!(j.hasChannel || j.hasLetter);
      if (j.registered && entitlement) { allowPage(); return; }
      var showGate = function () {
        var label = NEEDS_CHANNEL_ONLY ? 'You need a Loop Channel to continue' : 'You need a Loop Channel or Loop Letter to continue';
        if (!j.registered) label = 'Complete creator registration to continue';
        blockingOverlay(label, !j.registered, !NEEDS_CHANNEL_ONLY);
        ensureCreatorGateJs(function () {
          var channel = document.getElementById('sml-cg-block-channel');
          var letter = document.getElementById('sml-cg-block-letter');
          if (channel) channel.onclick = function () { if (window.__smlCreatorGateStart) window.__smlCreatorGateStart('channel'); };
          if (letter) letter.onclick = function () { if (window.__smlCreatorGateStart) window.__smlCreatorGateStart('letter'); };
        });
      };
      showGate();
    }).catch(verificationFailure);
  }

  checkingOverlay();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true });
  else check();
})();
