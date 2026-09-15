/* SML Go Live — Multi-screen stream setup (up to 3 screens).
   A creator can stream up to 3 separate feeds that viewers see as a multi-screen
   layout on the watch page. Each screen is its OWN plain single stream — no special
   software: point any source (a phone app, a second OBS/computer, or a co-host) at
   the same server with that screen's key. Screen 1 carries the audio.

   Backend contract (sml-live/v1):
     GET  /slots            -> { count, keys:[{slot,label,key}], live:[slots] }
     POST /slots {count}    -> sets how many screens (1-3), returns new keys
     GET  /feeds/{handle}   -> { live, count, slots:[{slot,live,playback}], creator }
   Keys are one base key + suffixes: SCREEN 1 = base, SCREEN 2 = base+"-b", 3 = base+"-c".
   Delivered by the sml-go-live-multiscreen plugin, which prints #sml-gl-multiscreen +
   window.SML_GL_NONCE / SML_GL_HANDLE on /go-live/. Falls back to the old encoder-card
   anchor if the container is absent. */
(function () {
  'use strict';
  if (window.__smlGoLiveScreensBooted) return;
  window.__smlGoLiveScreensBooted = true;

  var HANDLE = (window.SML_GL_HANDLE || 'grandmasterobi');
  var NONCE = (window.SML_GL_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '');
  var INGEST = (window.SML_GL_INGEST || 'rtmp://live.stockmarketloop.com/live');
  var S = { count: 1, keys: [null, null, null], live: {}, revealed: {}, open: true, busy: false, loaded: false };

  function req(path, opts) {
    var h = { 'Accept': 'application/json' }; if (NONCE) h['X-WP-Nonce'] = NONCE;
    opts = opts || {}; opts.credentials = 'same-origin'; opts.cache = 'no-store'; opts.headers = h;
    if (opts.body && typeof opts.body !== 'string') { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    return fetch('/wp-json' + path, opts).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; });
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function mask(k) { k = String(k || ''); return k.length > 10 ? k.slice(0, 7) + '••••••••' + k.slice(-3) : '••••••'; }
  function copy(text, btn) {
    var t = btn.textContent, done = function () { btn.textContent = 'Copied ✓'; btn.style.color = '#00ff88'; setTimeout(function () { btn.textContent = t; btn.style.color = ''; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    else { fallback(text); done(); }
  }
  function fallback(text) { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }

  var LABELS = ['SCREEN 1 · main (audio)', 'SCREEN 2', 'SCREEN 3'];
  var HINTS = [
    'Your primary feed — this is the one that carries the audio on the watch page.',
    'A second angle or source, e.g. charts. Viewers can tap it to watch it big.',
    'A third angle or source, e.g. order flow. Viewers can tap it to watch it big.'
  ];

  /* ---- mount ---- */
  var card;
  function findEncoderRow() {
    var rows = document.querySelectorAll('.gl-health-row');
    for (var i = 0; i < rows.length; i++) { var sp = rows[i].querySelector('span'); if (sp && sp.textContent.trim().toLowerCase() === 'encoder') return rows[i]; }
    return null;
  }
  function ensureCard() {
    if (card && card.isConnected) return card;
    card = document.createElement('div');
    card.id = 'sml-gl-screens';
    card.style.cssText = 'min-width:0;margin:0 0 14px;border-radius:14px;border:1px solid #1c2833;background:linear-gradient(180deg,#0d151f,#0a0f16);padding:14px 15px;display:flex;flex-direction:column;gap:11px;font-family:inherit;color:#e6edf5';
    var host = document.getElementById('sml-gl-multiscreen');
    if (host) { host.innerHTML = ''; host.appendChild(card); return card; }
    var enc = document.getElementById('sml-gl-encoder');
    if (enc && enc.isConnected) { card.style.gridColumn = '1/-1'; enc.insertAdjacentElement('afterend', card); return card; }
    var row = findEncoderRow();
    if (row) { card.style.gridColumn = '1/-1'; row.parentElement.insertAdjacentElement('beforebegin', card); return card; }
    // Sit at the top of the Go Live wizard so it is prominent and never lost.
    var cs = document.querySelector('.cs-card');
    if (cs && cs.parentElement) { cs.parentElement.insertBefore(card, cs); return card; }
    var main = document.querySelector('#cs-content, main, .cs-shell');
    if (main) { main.insertBefore(card, main.firstChild); return card; }
    return null;
  }

  function segBtn(n) {
    var on = S.count === n;
    return '<button data-count="' + n + '"' + (S.busy ? ' disabled' : '') +
      ' style="flex:1;font:700 12px/1 inherit;padding:9px 0;cursor:' + (S.busy ? 'wait' : 'pointer') + ';border:1px solid ' + (on ? '#00ff88' : '#1c2833') + ';background:' + (on ? 'linear-gradient(180deg,#0c2a1e,#0a1f16)' : '#0b1119') + ';color:' + (on ? '#00ff88' : '#98a3ad') + ';border-radius:9px">' + n + (n === 1 ? ' screen' : ' screens') + '</button>';
  }

  function paint() {
    var c = ensureCard(); if (!c) return;
    var liveCount = Object.keys(S.live).filter(function (k) { return S.live[k]; }).length;
    var badgeTxt = liveCount >= 2 ? liveCount + ' SCREENS LIVE · viewers see the ' + liveCount + '-up layout'
      : (liveCount === 1 ? '1 screen live' : 'no screens live yet');
    var head = '<div style="display:flex;align-items:center;gap:9px;cursor:pointer" data-toggle="1">' +
      '<b style="font-size:12px;letter-spacing:.12em">▦ MULTI-SCREEN STREAM</b>' +
      '<span style="font:700 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:' + (liveCount >= 2 ? '#00ff88' : '#5c6771') + ';border:1px solid ' + (liveCount >= 2 ? '#134a33' : '#1c2833') + ';border-radius:20px;padding:4px 8px">' + badgeTxt + '</span>' +
      '<span style="margin-left:auto;font-size:11px;color:#98a3ad">' + (S.open ? 'hide ▴' : 'set up ▾') + '</span></div>';

    var body = '';
    if (S.open) {
      body += '<div style="font-size:12.5px;line-height:1.55;color:#aab6c2">Stream more than one angle at once. Pick how many screens you want, then send a plain stream to each key — from a phone, a second computer, or a co-host. Viewers watch one big with sound and can tap any other to swap. Two or more live screens flip the watch page into the multi-screen layout automatically.</div>';

      // Screen count picker
      body += '<div><div style="font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:#5c6771;margin-bottom:6px">HOW MANY SCREENS?</div>' +
        '<div style="display:flex;gap:7px">' + segBtn(1) + segBtn(2) + segBtn(3) + '</div>' +
        '<div style="font-size:10.5px;color:#5c6771;margin-top:5px">You can always stream fewer than you turn on. Screen 1 is required and carries the audio.</div></div>';

      if (!S.loaded) {
        body += '<div style="font-size:11.5px;color:#5c6771;padding:4px 0">Loading your stream keys…</div>';
      } else if (!S.keys[0]) {
        body += '<div style="font-size:11.5px;color:#ffb454;border:1px solid #3a2c12;background:#160f04;border-radius:10px;padding:10px 12px;line-height:1.5">No stream key yet. Start a stream once from the Go&nbsp;Live wizard to create your key, then come back here to add screens.</div>';
      } else {
        body += '<div style="display:flex;flex-direction:column;gap:8px">';
        for (var i = 0; i < S.count; i++) {
          var k = S.keys[i], live = !!S.live[i + 1];
          body += '<div style="display:flex;flex-direction:column;gap:6px;border:1px solid ' + (live ? '#134a33' : '#1c2833') + ';border-radius:11px;background:' + (live ? '#0c1a16' : '#0b1119') + ';padding:10px 12px">' +
            '<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:' + (live ? '#00ff88' : '#2d3a47') + ';' + (live ? 'box-shadow:0 0 8px #00ff8888;' : '') + '"></span>' +
            '<b style="font-size:10.5px;letter-spacing:.1em;color:' + (live ? '#00ff88' : '#c7d6e3') + '">' + LABELS[i] + '</b>' +
            '<span style="margin-left:auto;font:700 9px/1 ui-monospace,Menlo,monospace;color:' + (live ? '#00ff88' : '#5c6771') + '">' + (live ? 'CONNECTED' : 'not connected') + '</span></div>' +
            '<div style="font-size:10.5px;color:#5c6771">' + HINTS[i] + '</div>' +
            (k ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
              '<code style="font:500 10.5px/1 ui-monospace,Menlo,monospace;color:#c7d6e3;background:#070b10;border:1px solid #1c2833;border-radius:6px;padding:8px 9px;flex:1;min-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(S.revealed[i] ? k.key : mask(k.key)) + '</code>' +
              '<button data-reveal="' + i + '" style="font:600 10px/1 inherit;color:#98a3ad;background:#101821;border:1px solid #1c2833;border-radius:6px;padding:8px 9px;cursor:pointer">' + (S.revealed[i] ? 'Hide' : 'Show') + '</button>' +
              '<button data-copy="' + i + '" style="font:700 10px/1 inherit;color:#04060a;background:#00ff88;border:none;border-radius:6px;padding:8px 11px;cursor:pointer">Copy key</button></div>'
              : '<div style="font-size:10.5px;color:#5c6771">Key loads once your base stream key exists.</div>') +
            '</div>';
        }
        body += '</div>';
        // Shared server line
        body += '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><span style="font-size:10.5px;color:#5c6771">Server (same for every screen):</span>' +
          '<code style="font:500 10.5px/1 ui-monospace,Menlo,monospace;color:#c7d6e3;background:#070b10;border:1px solid #1c2833;border-radius:6px;padding:7px 9px">' + esc(INGEST) + '</code>' +
          '<button data-copysrv="1" style="font:600 10px/1 inherit;color:#98a3ad;background:#101821;border:1px solid #1c2833;border-radius:6px;padding:7px 9px;cursor:pointer">Copy</button></div>';
      }

      // Easy path (default open)
      body += '<div style="border-top:1px solid #131c26;padding-top:10px">' +
        '<div style="font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:#00ff88;margin-bottom:7px">THE EASY WAY — ONE STREAM PER SCREEN</div>' +
        '<ol style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.7;color:#aab6c2">' +
        '<li><b style="color:#c7d6e3">Pick your screens above</b> (2 or 3).</li>' +
        '<li>For each screen, use any streaming source — a phone app like <b style="color:#c7d6e3">Larix Broadcaster</b> or <b style="color:#c7d6e3">Streamlabs</b>, a second computer running OBS, or a co-host. Each one just needs a normal single stream.</li>' +
        '<li>In that source, set <b style="color:#c7d6e3">Server</b> = the address above and <b style="color:#c7d6e3">Stream key</b> = that screen\'s key. Hit go live.</li>' +
        '<li>Watch the dots turn green. Screen 1 = your voice; the others are extra angles viewers can tap.</li>' +
        '</ol></div>';

      // Advanced path (collapsed) — one computer, OBS multi-output
      body += '<details style="border-top:1px solid #131c26;padding-top:9px"><summary style="cursor:pointer;font-size:11.5px;font-weight:600;color:#c7d6e3">Advanced: send all screens from one computer (OBS Multiple Output)</summary>' +
        '<ol style="margin:8px 0 0;padding-left:18px;font-size:11.5px;line-height:1.7;color:#98a3ad">' +
        '<li>Build a <b style="color:#c7d6e3">scene</b> per screen in OBS (e.g. Cam, Charts, Order flow).</li>' +
        '<li>Open <b style="color:#c7d6e3">Docks → Multiple Output</b> (the obs-multi-rtmp panel).</li>' +
        '<li>Add one target per screen: the server above + that screen\'s key, and pick its scene under <b style="color:#c7d6e3">Video</b>.</li>' +
        '<li>Keep SCREEN 1 as your normal Start Streaming output (it carries audio); start the others from the dock.</li>' +
        '</ol><div style="margin-top:8px;font-size:10.5px;color:#5c6771">Each screen is a full encode + upload (~4.5 Mbps at 1080p). Three screens ≈ 13.5 Mbps up — drop to ~2.5 Mbps/screen on weaker connections.</div></details>';
    }

    c.innerHTML = head + body;
    var tg = c.querySelector('[data-toggle]'); if (tg) tg.onclick = function () { S.open = !S.open; paint(); };
    Array.prototype.forEach.call(c.querySelectorAll('[data-count]'), function (b) { b.onclick = function () { setCount(+b.getAttribute('data-count')); }; });
    Array.prototype.forEach.call(c.querySelectorAll('[data-copy]'), function (b) { b.onclick = function () { var k = S.keys[+b.getAttribute('data-copy')]; if (k) copy(k.key, b); }; });
    Array.prototype.forEach.call(c.querySelectorAll('[data-reveal]'), function (b) { b.onclick = function () { var i = +b.getAttribute('data-reveal'); S.revealed[i] = !S.revealed[i]; paint(); }; });
    var cs = c.querySelector('[data-copysrv]'); if (cs) cs.onclick = function () { copy(INGEST, cs); };
  }

  function applySlots(j) {
    var ks = (j && j.keys) || [];
    S.keys = [1, 2, 3].map(function (n) { var m = ks.filter(function (k) { return +k.slot === n; })[0]; return m || null; });
    if (j && typeof j.count === 'number') S.count = Math.max(1, Math.min(3, j.count));
    var liveArr = (j && j.live) || [];
    liveArr.forEach(function (l) { var n = typeof l === 'object' ? +l.slot : +l; if (n) S.live[n] = true; });
    S.loaded = true;
  }
  function loadKeys() {
    req('/sml-live/v1/slots').then(function (res) { applySlots(res.j); paint(); }).catch(function () { S.loaded = true; paint(); });
  }
  function setCount(n) {
    if (S.busy || n === S.count) { if (n === S.count) return; }
    S.busy = true; paint();
    req('/sml-live/v1/slots', { method: 'POST', body: { count: n } }).then(function (res) {
      S.busy = false;
      if (res.j && res.j.keys) { applySlots(res.j); } else { S.count = n; }
      paint();
    }).catch(function () { S.busy = false; S.count = n; paint(); });
  }
  function pollLive() {
    if (document.hidden) return;
    req('/sml-live/v1/feeds/' + encodeURIComponent(HANDLE)).then(function (f) {
      var live = {};
      ((f.j && f.j.slots) || []).forEach(function (s) { if (s.live && s.playback) live[+s.slot] = true; });
      var changed = JSON.stringify(live) !== JSON.stringify(S.live);
      S.live = live;
      if (changed) paint();
    }).catch(function () {});
  }

  function start() {
    paint();          // render shell immediately (shows the picker + "loading")
    loadKeys();
    pollLive();
    setInterval(pollLive, 40000);
    // Creator Studio re-renders can orphan the card — re-mount if it falls out.
    setInterval(function () { if (!card || !card.isConnected) paint(); }, 1500);
  }

  // Boot as soon as our container OR the go-live page shell is present.
  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (document.getElementById('sml-gl-multiscreen') || document.getElementById('sml-gl-encoder') || findEncoderRow() || document.querySelector('.cs-card')) {
      clearInterval(boot); start();
    } else if (tries > 80) { clearInterval(boot); }
  }, 400);
})();
