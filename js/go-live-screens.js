/* SML Go Live — Multi-screen stream setup (3 slots).
   The backend already issues 3 slot keys (sml-live/v1/slots: Main / Slot 2 / Slot 3);
   this surfaces them in the Creator Studio Go Live console with copy buttons, an OBS
   multi-rtmp guide, and live per-screen connection status. When 2+ slots are live the
   watch page auto-switches to the multi-screen layout (already deployed). */
(function () {
  'use strict';
  if (window.__smlGoLiveScreensBooted) return;
  window.__smlGoLiveScreensBooted = true;

  var HANDLE = (window.SML_GL_HANDLE || 'grandmasterobi');
  var NONCE = (window.SML_GL_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '');
  var INGEST = 'rtmp://live.stockmarketloop.com/live';
  var S = { keys: [], live: {}, playing: {}, revealed: {}, open: false };

  function api(path) {
    var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE;
    return fetch('/wp-json' + path, { credentials: 'same-origin', headers: h, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function q(sel) { return document.querySelector(sel); }
  function findRow(label) {
    var rows = document.querySelectorAll('.gl-health-row');
    for (var i = 0; i < rows.length; i++) { var sp = rows[i].querySelector('span'); if (sp && sp.textContent.trim().toLowerCase() === label) return rows[i]; }
    return null;
  }
  function mask(k) { k = String(k || ''); return k.length > 10 ? k.slice(0, 7) + '••••••••' + k.slice(-3) : '••••••'; }
  function copy(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = 'Copied ✓'; btn.style.color = '#00ff88'; setTimeout(function () { btn.textContent = t; btn.style.color = ''; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    else { fallback(text); done(); }
  }
  function fallback(text) { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }

  var LABELS = ['SCREEN 1 · main (audio)', 'SCREEN 2', 'SCREEN 3'];
  var HINTS = ['Your primary scene — the one that carries audio on the watch page.', 'Second scene, e.g. charts. Muted for viewers until they promote it.', 'Third scene, e.g. order flow / Discord. Muted until promoted.'];

  var card;
  function ensureCard() {
    if (card && card.isConnected) return card;
    var encCard = q('#sml-gl-encoder');
    if (encCard && !encCard.isConnected) encCard = null; /* orphaned by a re-render — anchor on the row instead */
    var row = findRow('encoder');
    if (!encCard && !row) return null;
    card = document.createElement('div');
    card.id = 'sml-gl-screens';
    /* span both columns of the .gl-health grid — see go-live-encoder.js */
    card.style.cssText = 'grid-column:1/-1;min-width:0;margin:0 0 12px;border-radius:12px;border:1px solid #1c2833;background:linear-gradient(180deg,#0d151f,#0a0f16);padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-family:inherit';
    if (encCard) {
      /* right after the encoder card */
      encCard.insertAdjacentElement('afterend', card);
    } else {
      /* encoder script absent: sit above the health rows */
      row.parentElement.insertAdjacentElement('beforebegin', card);
    }
    return card;
  }
  function paint() {
    var c = ensureCard(); if (!c) return;
    var liveCount = Object.keys(S.live).filter(function (k) { return S.live[k]; }).length;
    var head = '<div style="display:flex;align-items:center;gap:9px;cursor:pointer" data-toggle="1">' +
      '<b style="font-size:11px;letter-spacing:.14em;color:#e6edf5">▦ MULTI-SCREEN STREAM</b>' +
      '<span style="font:600 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:' + (liveCount >= 2 ? '#00ff88' : '#5c6771') + ';border:1px solid ' + (liveCount >= 2 ? '#134a33' : '#1c2833') + ';border-radius:20px;padding:4px 8px">' + (liveCount >= 2 ? liveCount + ' SCREENS LIVE · viewers see the ' + liveCount + '-up layout' : (liveCount === 1 ? '1 screen live · single player' : 'no screens live')) + '</span>' +
      '<span style="margin-left:auto;font-size:11px;color:#98a3ad">' + (S.open ? 'hide ▴' : 'set up ▾') + '</span></div>';
    var body = '';
    if (S.open) {
      body += '<div style="font-size:12px;line-height:1.55;color:#98a3ad">Send up to three scenes at once — one key per screen, all to the same server. Viewers get one screen big with audio and can tap any other screen to watch it big. Two or more live screens flip the watch page into the multi-screen layout automatically.</div>';
      body += '<div style="display:flex;flex-direction:column;gap:7px">';
      for (var i = 0; i < 3; i++) {
        var k = S.keys[i]; var live = !!S.live[i + 1];
        body += '<div style="display:flex;flex-direction:column;gap:5px;border:1px solid ' + (live ? '#134a33' : '#1c2833') + ';border-radius:10px;background:' + (live ? '#0c1a16' : '#0b1119') + ';padding:9px 11px">' +
          '<div style="display:flex;align-items:center;gap:8px"><span style="width:7px;height:7px;border-radius:50%;background:' + (live ? '#00ff88' : '#2d3a47') + ';' + (live ? 'box-shadow:0 0 8px #00ff8888;' : '') + '"></span>' +
          '<b style="font-size:10.5px;letter-spacing:.1em;color:' + (live ? '#00ff88' : '#c7d6e3') + '">' + LABELS[i] + '</b>' +
          '<span style="margin-left:auto;font:600 9px/1 ui-monospace,Menlo,monospace;color:' + (live ? '#00ff88' : '#5c6771') + '">' + (live ? 'CONNECTED' : 'not connected') + '</span></div>' +
          '<div style="font-size:10.5px;color:#5c6771">' + HINTS[i] + '</div>' +
          (k ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
            '<code style="font:500 10.5px/1 ui-monospace,Menlo,monospace;color:#c7d6e3;background:#070b10;border:1px solid #1c2833;border-radius:6px;padding:7px 9px;flex:1;min-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(S.revealed[i] ? k.key : mask(k.key)) + '</code>' +
            '<button data-reveal="' + i + '" style="font:600 10px/1 inherit;color:#98a3ad;background:#101821;border:1px solid #1c2833;border-radius:6px;padding:7px 9px;cursor:pointer">' + (S.revealed[i] ? 'Hide' : 'Show') + '</button>' +
            '<button data-copy="' + i + '" style="font:700 10px/1 inherit;color:#04060a;background:#00ff88;border:none;border-radius:6px;padding:8px 10px;cursor:pointer">Copy key</button></div>'
            : '<div style="font-size:10.5px;color:#ff566e">Key unavailable — sign in as the streamer.</div>') +
          '</div>';
      }
      body += '</div>';
      body += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-size:10.5px;color:#5c6771">Server (same for all three):</span><code style="font:500 10.5px/1 ui-monospace,Menlo,monospace;color:#c7d6e3;background:#070b10;border:1px solid #1c2833;border-radius:6px;padding:6px 8px">' + INGEST + '</code><button data-copysrv="1" style="font:600 10px/1 inherit;color:#98a3ad;background:#101821;border:1px solid #1c2833;border-radius:6px;padding:6px 9px;cursor:pointer">Copy</button></div>';
      body += '<details style="border-top:1px solid #131c26;padding-top:9px"><summary style="cursor:pointer;font-size:11.5px;font-weight:600;color:#c7d6e3">How to send 3 screens from OBS (Multiple Output plugin)</summary>' +
        '<ol style="margin:8px 0 0;padding-left:18px;font-size:11.5px;line-height:1.7;color:#98a3ad">' +
        '<li>Build three <b style="color:#c7d6e3">scenes</b> in OBS — e.g. <i>Cam</i>, <i>Charts</i>, <i>Order flow</i>.</li>' +
        '<li>Open <b style="color:#c7d6e3">Docks → Multiple Output</b> (the obs-multi-rtmp panel — already installed).</li>' +
        '<li>Add a target per screen: server <code style="color:#c7d6e3">' + INGEST + '</code>, paste that screen\'s key, and under <b style="color:#c7d6e3">Video</b> pick the scene for that screen.</li>' +
        '<li>Keep <b style="color:#c7d6e3">SCREEN 1</b> as your normal Start Streaming output (it carries the audio); start targets 2 and 3 from the dock.</li>' +
        '<li>Watch the dots above go green one by one. At two, the watch page switches to the multi-screen layout.</li>' +
        '</ol><div style="margin-top:8px;font-size:10.5px;color:#5c6771">Bandwidth note: each screen is a full encode + upload (~4,500 kbps each at 1080p). Three screens ≈ 13.5 Mbps upload. Drop to 2,500 kbps per screen on weaker connections.</div></details>';
    }
    c.innerHTML = head + body;
    var tg = c.querySelector('[data-toggle]'); if (tg) tg.onclick = function () { S.open = !S.open; paint(); };
    Array.prototype.forEach.call(c.querySelectorAll('[data-copy]'), function (b) { b.onclick = function () { var k = S.keys[+b.getAttribute('data-copy')]; if (k) copy(k.key, b); }; });
    Array.prototype.forEach.call(c.querySelectorAll('[data-reveal]'), function (b) { b.onclick = function () { var i = +b.getAttribute('data-reveal'); S.revealed[i] = !S.revealed[i]; paint(); }; });
    var cs = c.querySelector('[data-copysrv]'); if (cs) cs.onclick = function () { copy(INGEST, cs); };
  }
  function loadKeys() {
    api('/sml-live/v1/slots').then(function (res) {
      var ks = (res.j && res.j.keys) || [];
      S.keys = [1, 2, 3].map(function (n) { return ks.filter(function (k) { return +k.slot === n; })[0] || null; });
      var liveArr = (res.j && res.j.live) || [];
      S.live = {};
      liveArr.forEach(function (l) { var n = typeof l === 'object' ? +l.slot : +l; if (n) S.live[n] = true; });
      paint();
    }).catch(function () { paint(); });
  }
  function pollLive() {
    if (document.hidden) return;
    api('/sml-live/v1/feeds/' + HANDLE).then(function (f) {
      var live = {};
      ((f.j && f.j.slots) || []).forEach(function (s) { if (s.live && s.playback) live[+s.slot] = true; });
      var changed = JSON.stringify(live) !== JSON.stringify(S.live);
      S.live = live;
      if (changed) paint();
    }).catch(function () {});
  }
  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (findRow('encoder')) {
      clearInterval(boot); loadKeys(); pollLive(); setInterval(pollLive, 40000); /* multi-screen check every 40s (owner asked for 30-45s) */
      /* the Creator Studio wizard re-renders the health panel (step changes, previews) and
         orphans injected cards — re-mount whenever ours falls out of the document */
      setInterval(function () { if (!card || !card.isConnected) paint(); }, 1000);
    }
    else if (tries > 60) clearInterval(boot);
  }, 500);
})();
