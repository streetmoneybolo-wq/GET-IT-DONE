/* SML Go Live — Loop Channel creation entry point.
   /channel/{handle}/ only renders publicly once a creator has explicitly set a
   sml_channel_handle (separate from their profile handle — see project notes on
   why these can never collide). There was no UI anywhere for a creator to set
   that field, so this adds a small card to the Creator Studio Go Live console:
   pick a handle, live-checked against sml-channel/v1/handle-availability
   (rejects collisions with existing profile handles too), save via
   POST sml-channel/v1/handle, then link straight to the live page. */
(function () {
  'use strict';
  if (window.__smlGoLiveChannelBooted) return;
  window.__smlGoLiveChannelBooted = true;

  var NONCE = (window.SML_GL_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '');
  var S = { handle: '', status: '', statusKind: '', saving: false, saved: '' };

  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'same-origin'; opts.headers = opts.headers || {};
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    opts.cache = 'no-store';
    return fetch('/wp-json' + path, opts).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
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
    card.style.cssText = 'margin:0 0 12px;border-radius:12px;border:1px solid #1c2833;background:linear-gradient(180deg,#0d151f,#0a0f16);padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-family:inherit';
    if (anchor) anchor.insertAdjacentElement('afterend', card);
    else row.parentElement.insertAdjacentElement('beforebegin', card);
    return card;
  }

  function paint() {
    var c = ensureCard(); if (!c) return;
    if (S.saved) {
      c.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
        '<div style="display:flex;flex-direction:column;gap:3px"><b style="font:700 11px/1 Archivo,sans-serif;color:#00ff88">✓ Loop Channel live</b>' +
        '<span style="font:400 9px/1 \'IBM Plex Mono\',monospace;color:#5d7085">/channel/' + esc(S.saved) + '/</span></div>' +
        '<a href="/channel/' + esc(S.saved) + '/" target="_blank" rel="noopener" style="font:700 10px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border-radius:8px;padding:9px 13px;text-decoration:none;white-space:nowrap">Open →</a></div>';
      return;
    }
    var statusColor = S.statusKind === 'ok' ? '#00ff88' : S.statusKind === 'bad' ? '#ff5e6e' : '#5d7085';
    c.innerHTML = '<div style="display:flex;flex-direction:column;gap:3px"><b style="font:700 11px/1 Archivo,sans-serif;color:#e6edf3">▮ Loop Channel</b>' +
      '<span style="font:400 9px/1.5 \'IBM Plex Mono\',monospace;color:#4c5d6d">a public hub page for your videos and posts — separate from your profile handle, pick a new one here</span></div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<div style="display:flex;align-items:center;border:1px solid #1c2833;border-radius:8px;background:#0a121b;overflow:hidden;flex:1">' +
      '<span style="font:600 12px/1 \'IBM Plex Mono\',monospace;color:#4c5d6d;padding:11px 2px 11px 12px">@</span>' +
      '<input id="sml-glc-in" type="text" value="' + esc(S.handle) + '" placeholder="yourhandle" maxlength="30" style="flex:1;border:none;background:none;color:#7ae6ff;font:600 12px/1 \'IBM Plex Mono\',monospace;padding:11px 12px 11px 2px;outline:none">' +
      '</div><button id="sml-glc-save" style="font:700 10px/1 Archivo,sans-serif;color:' + ((S.statusKind !== 'ok' || S.saving) ? '#5d7085;background:#0a121b;border:1px solid #1c2833;cursor:not-allowed' : '#04060a;background:#00ff88;border:none;cursor:pointer') + ';border-radius:8px;padding:11px 15px;white-space:nowrap" ' + ((S.statusKind !== 'ok' || S.saving) ? 'disabled' : '') + '>' + (S.saving ? 'Saving…' : 'Create channel') + '</button></div>' +
      '<span style="font:400 9px/1.5 \'IBM Plex Mono\',monospace;color:' + statusColor + '">' + esc(S.status) + '</span>';
    var inp = q('#sml-glc-in');
    inp.oninput = function () { S.handle = inp.value; scheduleCheck(); };
    inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    q('#sml-glc-save').onclick = save;
  }

  var checkTimer;
  function scheduleCheck() {
    S.status = ''; S.statusKind = '';
    clearTimeout(checkTimer);
    var h = S.handle.trim().replace(/^@/, '');
    if (h.length < 3) { if (h.length) { S.status = 'At least 3 characters.'; S.statusKind = 'bad'; } paint(); return; }
    checkTimer = setTimeout(function () {
      api('/sml-channel/v1/handle-availability?handle=' + encodeURIComponent(h)).then(function (r) {
        if (S.handle.trim().replace(/^@/, '') !== h) return; /* stale response */
        if (!r.ok) { S.status = (r.j && r.j.message) || 'Could not check that handle.'; S.statusKind = 'bad'; paint(); return; }
        var j = r.j || {}; var avail = j.available != null ? j.available : j.is_available;
        S.status = avail ? 'Available.' : ((j.message) || 'That handle is taken.');
        S.statusKind = avail ? 'ok' : 'bad';
        paint();
      }).catch(function () { S.status = 'Could not reach the site.'; S.statusKind = 'bad'; paint(); });
    }, 400);
  }
  function save() {
    if (S.statusKind !== 'ok' || S.saving) return;
    var h = S.handle.trim().replace(/^@/, '');
    S.saving = true; paint();
    api('/sml-channel/v1/handle', { method: 'POST', body: JSON.stringify({ handle: h }) }).then(function (r) {
      S.saving = false;
      if (r.ok) { S.saved = h; paint(); }
      else { S.status = (r.j && r.j.message) || 'Could not save — try again.'; S.statusKind = 'bad'; paint(); }
    });
  }

  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (findRow('encoder')) { clearInterval(boot); paint(); setInterval(function () { if (!card || !card.isConnected) paint(); }, 1000); }
    else if (tries > 60) clearInterval(boot);
  }, 500);
})();
