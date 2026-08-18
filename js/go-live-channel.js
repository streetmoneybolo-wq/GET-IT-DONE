/* SML Go Live — Loop Channel status card.
   /channel/{handle}/ only renders publicly once a creator has explicitly set a
   sml_channel_handle (separate from their profile handle — see project notes on
   why these can never collide). Real creation now lives at /create-channel/
   (verified email, about, agreements — see creator-gate.js / create-channel-api.php);
   this card only reports status and links there. It used to let a creator POST
   sml-channel/v1/handle directly from an inline input, which claimed a channel
   handle with none of that onboarding attached — bypassing the real flow
   entirely. Fixed 2026-08-18: status-only, CTA links out, no direct claim here. */
(function () {
  'use strict';
  if (window.__smlGoLiveChannelBooted) return;
  window.__smlGoLiveChannelBooted = true;

  var NONCE = (window.SML_GL_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '');
  var S = { loaded: false, hasChannel: false, handle: '' };

  function api(path) {
    var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE;
    return fetch('/wp-json' + path, { credentials: 'same-origin', headers: h, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function q(sel) { return document.querySelector(sel); }
  function findRow(label) {
    var rows = document.querySelectorAll('.gl-health-row');
    for (var i = 0; i < rows.length; i++) { var sp = rows[i].querySelector('span'); if (sp && sp.textContent.trim().toLowerCase() === label) return rows[i]; }
    return null;
  }

  var card;
  function ensureCard() {
    if (card && card.isConnected) return card;
    var anchor = q('#sml-gl-screens') || q('#sml-gl-encoder');
    if (anchor && !anchor.isConnected) anchor = null;
    var row = findRow('encoder');
    if (!anchor && !row) return null;
    card = document.createElement('div');
    card.id = 'sml-gl-channel';
    /* span both columns of the .gl-health grid — see go-live-encoder.js */
    card.style.cssText = 'grid-column:1/-1;min-width:0;margin:0 0 12px;border-radius:12px;border:1px solid #1c2833;background:linear-gradient(180deg,#0d151f,#0a0f16);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-family:inherit';
    if (anchor) anchor.insertAdjacentElement('afterend', card);
    else row.parentElement.insertAdjacentElement('beforebegin', card);
    return card;
  }

  function paint() {
    var c = ensureCard(); if (!c) return;
    if (!S.loaded) { c.innerHTML = '<span style="font:400 10px/1 \'IBM Plex Mono\',monospace;color:#5d7085">Checking Loop Channel status…</span>'; return; }
    if (S.hasChannel) {
      c.innerHTML = '<div style="display:flex;flex-direction:column;gap:3px"><b style="font:700 11px/1 Archivo,sans-serif;color:#00ff88">✓ Loop Channel live</b>' +
        '<span style="font:400 9px/1 \'IBM Plex Mono\',monospace;color:#5d7085">/channel/' + esc(S.handle) + '/</span></div>' +
        '<a href="/channel/' + esc(S.handle) + '/" target="_blank" rel="noopener" style="font:700 10px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border-radius:8px;padding:9px 13px;text-decoration:none;white-space:nowrap">Open →</a>';
      return;
    }
    c.innerHTML = '<div style="display:flex;flex-direction:column;gap:3px"><b style="font:700 11px/1 Archivo,sans-serif;color:#e6edf3">▮ Loop Channel</b>' +
      '<span style="font:400 9px/1.5 \'IBM Plex Mono\',monospace;color:#4c5d6d">a public hub page for your videos and posts — separate from your profile handle</span></div>' +
      '<a href="/create-channel/" style="font:700 10px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border-radius:8px;padding:9px 13px;text-decoration:none;white-space:nowrap">Create a Loop Channel →</a>';
  }

  function load() {
    api('/sml-creator-gate/v1/status').then(function (r) {
      S.loaded = true;
      if (r.ok) { S.hasChannel = !!(r.j && r.j.hasChannel); S.handle = (r.j && r.j.channelHandle) || ''; }
      paint();
    });
  }

  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (findRow('encoder')) { clearInterval(boot); paint(); load(); setInterval(function () { if (!card || !card.isConnected) paint(); }, 1000); }
    else if (tries > 60) clearInterval(boot);
  }, 500);
})();
