/* SML Go Live — real encoder feedback for the streamer.
   The Creator Studio "Stream Health" panel only watched the browser's camera/mic,
   so an OBS broadcast landing on the ingest server showed "Encoder: Waiting" forever.
   This polls the server truth (sml-live/v1/status + the HLS playlist) and drives:
     - the Encoder row (Waiting → CONNECTED · 1080p · segs)
     - a live "ENCODER" banner card with the ingest URL, uptime, segment count,
       "watch page" link, and last-publish verdict
     - the readiness ring % (encoder connected = ready) */
(function () {
  'use strict';
  if (window.__smlGoLiveEncoderBooted) return;
  window.__smlGoLiveEncoderBooted = true;

  var HANDLE = (window.SML_GL_HANDLE || 'grandmasterobi');
  var NONCE = (window.wpApiSettings && window.wpApiSettings.nonce) || window.SML_GL_NONCE || '';
  var state = { live: false, since: 0, segs: 0, seq: 0, playback: '', lastCheck: 0, err: '', height: 0, ingest: '' };

  function api(path) {
    var h = {};
    if (NONCE) h['X-WP-Nonce'] = NONCE;
    return fetch('/wp-json' + path, { credentials: 'same-origin', headers: h, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function fmtDur(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
  }
  function q(sel) { return document.querySelector(sel); }
  function findRow(label) {
    var rows = document.querySelectorAll('.gl-health-row');
    for (var i = 0; i < rows.length; i++) {
      var sp = rows[i].querySelector('span');
      if (sp && sp.textContent.trim().toLowerCase() === label) return rows[i];
    }
    return null;
  }

  /* ---------- banner card (injected above the health rows) ---------- */
  var card;
  function ensureCard() {
    if (card && card.isConnected) return card;
    var row = findRow('encoder');
    if (!row) return null;
    var host = row.parentElement;
    card = document.createElement('div');
    card.id = 'sml-gl-encoder';
    card.style.cssText = 'margin:0 0 12px;border-radius:12px;border:1px solid #1c2833;background:linear-gradient(180deg,#0d151f,#0a0f16);padding:12px 14px;display:flex;flex-direction:column;gap:8px;font-family:inherit';
    host.parentElement.insertBefore(card, host);
    return card;
  }
  function paintCard() {
    var c = ensureCard();
    if (!c) return;
    var live = state.live;
    var dotCol = live ? '#00ff88' : (state.err ? '#ffb454' : '#ff566e');
    var head = live ? 'ENCODER CONNECTED' : (state.err ? 'ENCODER CHECK FAILED' : 'ENCODER NOT CONNECTED');
    var sub = live
      ? 'Receiving your broadcast' + (state.height ? ' · ' + state.height + 'p' : '') + ' · ' + state.segs + ' segments buffered · on air ' + fmtDur((Date.now() / 1000) - state.since)
      : (state.err ? state.err : 'Press Start Streaming in OBS. Server: ' + (state.ingest || 'rtmp://live.stockmarketloop.com/live'));
    c.innerHTML =
      '<div style="display:flex;align-items:center;gap:9px">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:' + dotCol + ';box-shadow:0 0 10px ' + dotCol + '88;' + (live ? 'animation:smlGlPulse 1.4s ease-in-out infinite' : '') + '"></span>' +
        '<b style="font-size:11px;letter-spacing:.14em;color:' + (live ? '#00ff88' : '#e6edf5') + '">' + head + '</b>' +
        '<span style="margin-left:auto;font:600 10px/1 ui-monospace,Menlo,monospace;color:#5c6771">' + (state.lastCheck ? 'checked ' + Math.round((Date.now() - state.lastCheck) / 1000) + 's ago' : '') + '</span>' +
      '</div>' +
      '<div style="font-size:12px;line-height:1.5;color:' + (live ? '#c7d6e3' : '#98a3ad') + '">' + sub + '</div>' +
      (live ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">' +
        '<a href="/live/" target="_blank" rel="noopener" style="font:700 10px/1 inherit;letter-spacing:.06em;color:#04060a;background:#00ff88;border-radius:8px;padding:8px 11px;text-decoration:none">OPEN WATCH PAGE ↗</a>' +
        '<span style="font:500 10px/1 ui-monospace,Menlo,monospace;color:#5c6771;padding:8px 0">stream #' + state.seq + '</span>' +
      '</div>' : '') ;
    if (!q('#sml-gl-pulse-style')) {
      var st = document.createElement('style'); st.id = 'sml-gl-pulse-style';
      st.textContent = '@keyframes smlGlPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}';
      document.head.appendChild(st);
    }
  }

  /* ---------- Encoder row + readiness ring ---------- */
  function paintRow() {
    var row = findRow('encoder');
    if (!row) return;
    var b = row.querySelector('b'), ic = row.querySelector('i');
    if (b) {
      b.textContent = state.live ? 'Connected' + (state.height ? ' · ' + state.height + 'p' : '') : (state.err ? 'Unreachable' : 'Waiting');
      b.className = state.live ? 'gl-ok' : 'gl-muted';
      b.style.color = state.live ? '#00ff88' : '';
    }
    if (ic) { ic.className = state.live ? 'gl-on' : 'gl-off'; ic.style.color = state.live ? '#00ff88' : ''; }
    /* the ring: when the encoder is connected the stream IS ready regardless of browser cam/mic */
    if (state.live) {
      var ring = row.parentElement && row.parentElement.parentElement ? row.parentElement.parentElement.querySelector('svg circle[stroke-dasharray]') : null;
      if (ring) { ring.setAttribute('stroke-dashoffset', '0'); ring.setAttribute('stroke', '#00ff88'); }
      var texts = row.parentElement && row.parentElement.parentElement ? row.parentElement.parentElement.querySelectorAll('svg text') : [];
      if (texts.length >= 2) { texts[0].textContent = '100%'; texts[1].textContent = 'On air'; texts[1].setAttribute('fill', '#00ff88'); }
      var hint = row.parentElement && row.parentElement.parentElement ? row.parentElement.parentElement.querySelector('.gl-hint, p, small') : null;
      if (hint && /start the preview/i.test(hint.textContent)) hint.textContent = 'OBS is connected — your broadcast is on the ingest server and playing on the watch page.';
    }
  }

  /* ---------- poll ---------- */
  var seenSeq = 0;
  function poll() {
    if (document.hidden) return;
    api('/sml-live/v1/status').then(function (res) {
      state.lastCheck = Date.now();
      if (!res.j || res.status >= 400) { state.err = res.status === 401 || res.status === 403 ? 'Sign in as the streamer to see encoder status.' : 'Status endpoint unavailable (' + res.status + ').'; state.live = false; paint(); return; }
      state.err = '';
      state.ingest = res.j.ingest_url || state.ingest;
      var wasLive = state.live;
      state.live = !!res.j.is_live;
      if (state.live) {
        var t = Date.parse(String(res.j.live_started_at || '').replace(' ', 'T') + 'Z');
        state.since = isNaN(t) ? (state.since || Date.now() / 1000) : t / 1000;
        if (!wasLive) seenSeq++;
        state.seq = seenSeq || 1;
      } else { state.segs = 0; state.height = 0; }
      /* playlist depth = proof of actual video flowing, not just a handshake */
      return api('/sml-live/v1/feeds/' + HANDLE).then(function (f) {
        var slot = f.j && (f.j.slots || []).filter(function (s) { return s.live && s.playback; })[0];
        if (!slot) { state.playback = ''; state.segs = 0; paint(); return; }
        state.playback = slot.playback;
        return fetch(slot.playback, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (txt) {
          var segs = (txt.match(/\.ts\b/g) || []).length;
          state.segs = segs;
          if (segs && !state.height) probeHeight(slot.playback);
          paint();
        }).catch(function () { paint(); });
      });
    }).catch(function () { state.err = 'Could not reach the site.'; state.lastCheck = Date.now(); paint(); });
  }
  /* height read once per stream via a hidden probe player */
  function probeHeight(url) {
    if (probeHeight._busy) return; probeHeight._busy = true;
    var v = document.createElement('video'); v.muted = true; v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;bottom:0;right:0';
    document.body.appendChild(v);
    var done = function () { if (v.videoHeight) state.height = v.videoHeight; try { v.pause(); v.src = ''; v.remove(); } catch (e) {} probeHeight._busy = false; paint(); };
    v.addEventListener('loadedmetadata', done, { once: true });
    setTimeout(function () { if (v.isConnected) done(); }, 8000);
    if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; v.load(); }
    else if (window.Hls && window.Hls.isSupported()) { var h = new Hls(); h.loadSource(url); h.attachMedia(v); }
    else { var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'; s.onload = function () { var h2 = new Hls(); h2.loadSource(url); h2.attachMedia(v); }; document.head.appendChild(s); }
  }
  function paint() { paintCard(); paintRow(); }

  var tries = 0;
  var boot = setInterval(function () {
    tries++;
    if (findRow('encoder')) { clearInterval(boot); paint(); poll(); setInterval(poll, 5000); setInterval(paint, 1000); }
    else if (tries > 60) clearInterval(boot);
  }, 500);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
