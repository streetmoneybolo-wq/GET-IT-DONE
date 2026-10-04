/* Click-to-Alert for the Academy Live Chart Lab (a separate paid add-on).
   Turn it on, click a price on the chart: the entry is locked to the live price at that moment and the clicked price is the target. The Academy's data picks the
   horizon (day / swing / mid / long), shows why, and lets the member post the alert, in GrandMaster-Obi's layout, to a Discord channel they can post in.
   The server decides everything that matters (entitlement, the live price, the horizon, permissions); this panel only shows it. Educational: nothing here places a trade. */
(function boot(tries) {
  if (window.__smlClickAlertUi) return;
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar') || !document.getElementById('chart')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlClickAlertUi = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar'), canvas = $('chart'), stage = document.querySelector('.academy-chart-stage');
  const KEY = 'sml-click-alert-dest';
  const S = { on: false, busy: false, target: null, entry: null, side: null, data: null, status: null, guilds: [], channels: [], guildId: '', channelId: '', ping: false, images: true, scn: null, msg: '', msgTone: '', sent: false, symbol: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.guildId = String(v.guildId || ''); S.channelId = String(v.channelId || ''); } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ guildId: S.guildId, channelId: S.channelId })); } catch (_) { /* ignore */ } };

  const css = document.createElement('style');
  css.textContent = '#click-alert-toggle{margin-left:4px;padding:5px 9px;border:1px solid #1f8a5f;border-radius:7px;background:#0b2219;color:#7dffc4;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#click-alert-toggle.on{background:#00c47d;border-color:#7dffc4;color:#032318}'
    + '#ca-layer{position:absolute;pointer-events:none;z-index:5;background:transparent;border:0;min-height:0;max-width:none}'
    + '.ca-armed #chart{cursor:crosshair!important}'
    + '#ca-hint{position:absolute;left:50%;top:8px;transform:translateX(-50%);z-index:8;padding:6px 12px;border-radius:999px;background:rgba(3,34,24,.94);border:1px solid #1f8a5f;color:#a8ffd8;font:700 .66rem system-ui,sans-serif;pointer-events:none;white-space:nowrap}'
    + '#ca-panel{position:fixed;right:12px;bottom:12px;z-index:2147483250;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:rgba(7,13,20,.98);border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.65);color:#dbe6ec;font:600 .68rem/1.42 system-ui,sans-serif}'
    + '#ca-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #16382b;background:#0a1d16}#ca-panel header b{font:800 .72rem ui-monospace,monospace;color:#7dffc4;letter-spacing:.06em}#ca-panel header button{margin-left:auto;border:0;background:transparent;color:#9fb3be;font:800 .9rem system-ui;cursor:pointer}'
    + '#ca-panel .body{padding:10px 12px}#ca-panel .row{display:flex;justify-content:space-between;gap:10px;padding:2px 0}#ca-panel .row span{color:#7f95a1}#ca-panel .row b{color:#eaf3f7}'
    + '#ca-panel .hz{margin:8px 0;padding:9px 10px;border-radius:9px;background:#0d2a20;border:1px solid #1f8a5f}#ca-panel .hz b{display:block;font:800 .95rem system-ui;color:#7dffc4}#ca-panel .hz span{color:#a8c2b8;font-weight:600}'
    + '#ca-panel ul{list-style:none;margin:6px 0;padding:0}#ca-panel li{margin:0 0 4px;padding-left:9px;border-left:3px solid #2c4a56;color:#c1cfd7;font-weight:500}'
    + '#ca-panel pre{margin:6px 0;padding:8px;border-radius:8px;background:#05090e;border:1px solid #1b2a35;color:#dfe9ee;font:500 .62rem/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto}'
    + '#ca-panel select,#ca-panel button.act{width:100%;margin:3px 0;padding:7px 8px;border-radius:8px;border:1px solid #2a4a58;background:#0d1a24;color:#e6eef2;font:700 .68rem system-ui,sans-serif}#ca-panel button.act{background:#00c47d;border-color:#7dffc4;color:#032318;font-weight:900;cursor:pointer}#ca-panel button.act:disabled{opacity:.5;cursor:not-allowed}'
    + '#ca-panel label.chk{display:flex;gap:6px;align-items:center;margin:4px 0;color:#b9c8d1}#ca-panel .msg{margin:6px 0;padding:7px 9px;border-radius:8px;font-weight:700}#ca-panel .msg.err{background:#2a1118;border:1px solid #6b2234;color:#ffb3c0}#ca-panel .msg.ok{background:#0d2a20;border:1px solid #1f8a5f;color:#a8ffd8}#ca-panel .msg.info{background:#101c28;border:1px solid #2a4a58;color:#c1d5e0}'
    + '#ca-panel .scn{margin:8px 0}#ca-panel .scn img{display:block;width:100%;border-radius:8px;border:1px solid #1b2a35;margin:0 0 6px;background:#070d14}#ca-panel .scn h6{margin:0 0 4px;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;color:#7dffc4}'
    + '#ca-panel small{display:block;margin-top:6px;color:#6f8794;font-weight:500;font-size:.56rem}@media(max-width:700px){#ca-panel{left:8px;right:8px;bottom:8px;width:auto;max-height:78vh}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'click-alert-toggle'; btn.textContent = 'ALERT'; btn.title = 'Click-to-Alert: click a price on the chart to set the target, then post the alert to Discord'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'ca-layer'; const ctx = layer.getContext('2d');
  const hint = document.createElement('div'); hint.id = 'ca-hint'; hint.style.display = 'none'; hint.textContent = 'Click a price on the chart to set your target. Entry is the live price.';
  const panel = document.createElement('aside'); panel.id = 'ca-panel'; panel.style.display = 'none'; document.body.appendChild(panel);

  const token = () => String(window.smlAcademySessionToken || '');
  const sym = () => { const M = window.smlChartModel && window.smlChartModel(); return M ? M.symbol : String(($('symbol') || {}).value || 'SPY').toUpperCase(); };
  async function api(path, body) {
    const t = token(); if (!t) return { ok: false, status: 401, error: 'authorization_required' };
    const res = await fetch('/academy-activity/click-alert/' + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ authorization: 'Bearer ' + t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let json = null; try { json = await res.json(); } catch (_) { json = null; }
    return Object.assign({ status: res.status }, json || { ok: false, error: 'bad_response' });
  }
  const price = (v) => (Number.isFinite(+v) ? (+v >= 1 ? (+v).toFixed(2) : (+v).toFixed(4)) : '-');
  const WHY = {
    authorization_required: 'Sign in with Discord (Unlock Academy Tools) to use Click-to-Alert.',
    click_alert_subscription_required: 'Click-to-Alert is a separate subscription from the Academy plan. Subscribe to the Click-to-Alert add-on to unlock it.',
    click_alert_not_configured: 'Click-to-Alert is not switched on yet.',
    click_alert_disabled: 'Click-to-Alert is not available right now.',
    target_too_close: 'That target is too close to the live price. Click further away.',
    target_too_far: 'That target is too far from the live price.',
    not_enough_history: 'There is not enough price history on this symbol to estimate a horizon.',
    no_live_price: 'There is no live price for this symbol right now.',
    invalid_symbol: 'That symbol cannot be used.',
    you_cannot_post_there: 'You do not have permission to send messages in that channel.',
    app_cannot_post_there: 'The Academy app cannot send messages in that channel. Ask a server admin to allow it, or pick another channel.',
    channel_unavailable: 'The Academy app is not installed in that server, or the channel was not found.',
    rate_limited: 'You are sending alerts too quickly. Try again later.',
    duplicate_alert: 'You just sent this exact alert.',
    temporarily_unavailable: 'Something went wrong. Try again in a moment.'
  };
  const explainErr = (r) => r.detail || WHY[r.error] || 'That did not work (' + esc(r.error || r.status) + ').';

  /* ---------- the chart marks: entry and target lines ---------- */
  function draw() {
    if (canvas.parentElement && layer.parentElement !== canvas.parentElement) canvas.parentElement.appendChild(layer);
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = canvas.offsetLeft + 'px'; layer.style.top = canvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || S.target == null || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.symbol !== S.symbol) return;
    const left = M.pad.l, right = M.pad.l + M.pw;
    const line = (p, color, label) => {
      const y = M.y(p); if (y < M.pad.t || y > M.pad.t + (M.priceH || M.ph)) return;
      ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.restore();
      ctx.font = '800 10px ui-monospace,monospace'; const t = label + ' ' + price(p), tw = ctx.measureText(t).width + 10;
      ctx.fillStyle = color; ctx.fillRect(left + 6, y - 9, tw, 18); ctx.fillStyle = '#021810'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, left + 11, y);
    };
    if (S.entry != null) line(S.entry, '#4dc3ff', 'ENTRY');
    line(S.target, S.side === 'short' ? '#ff6b86' : '#35e6a0', 'TARGET');
    if (S.data && Number.isFinite(S.data.stop)) line(S.data.stop, '#ffb04a', 'STOP');
  }
  window.addEventListener('sml-chart-view', () => { if (S.on) draw(); });
  window.addEventListener('resize', () => { if (S.on) draw(); });

  /* ---------- the panel ---------- */
  const row = (k, v) => '<div class="row"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
  function render() {
    if (!S.on) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let html = '<header><b>CLICK-TO-ALERT</b><button type="button" data-ca="close" aria-label="Close">×</button></header><div class="body">';
    if (!token()) html += '<div class="msg info">' + esc(WHY.authorization_required) + '</div>';
    else if (S.status && S.status.ok === false) html += '<div class="msg err">' + esc(explainErr(S.status)) + '</div>';
    else if (S.status && !S.status.configured) html += '<div class="msg info">' + esc(WHY.click_alert_not_configured) + '</div>';
    else if (S.status && !S.status.entitled) html += '<div class="msg info">' + esc(WHY.click_alert_subscription_required) + '</div>';
    else if (S.target == null) html += '<div class="msg info">Click a price on the chart. The entry locks to the live price and your click becomes the target.</div>';
    else if (S.busy && !S.data) html += '<div class="msg info">Reading ' + esc(S.symbol) + ' across the Academy data…</div>';
    const d = S.data;
    if (d) {
      html += row('Symbol', esc(d.symbol) + ' · ' + (d.side === 'short' ? 'SHORT' : 'LONG')) + row('Entry (live price, locked)', '$' + price(d.entry)) + row('Target (your click)', '$' + price(d.target) + ' (' + (d.movePct >= 0 ? '+' : '') + d.movePct + '%)');
      html += '<div class="hz"><b>' + esc(d.horizonLabel.toUpperCase()) + '</b><span>' + esc(d.horizonSpan) + ' · ' + esc(d.confidence) + ' confidence · about ' + (d.expectedDays.mid < 1 ? 'under a day' : (d.expectedDays.mid < 10 ? d.expectedDays.mid.toFixed(1) : Math.round(d.expectedDays.mid)) + ' trading days') + '</span></div>';
      html += row('Stop (suggested)', '$' + price(d.stop) + ' · ' + esc(d.stopBasis)) + row('Risk', esc(String(d.risk).toUpperCase()));
      html += '<ul>' + d.rationale.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
      if (S.scn) {
        html += '<div class="scn"><h6>SCENARIO CHARTS · POSTED WITH THE ALERT</h6>' + S.scn.images.map((im) => '<img alt="' + esc(im.alt) + '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(im.svg) + '">').join('') + '</div>';
        html += '<label class="chk"><input type="checkbox" data-ca="images"' + (S.images ? ' checked' : '') + (S.scn.pngAvailable ? '' : ' disabled') + '> Attach the two scenario charts' + (S.scn.pngAvailable ? '' : ' (picture engine unavailable)') + '</label>';
      }
      html += '<div style="color:#7f95a1;font-weight:700;margin-top:6px">ALERT PREVIEW</div><pre>' + esc(S.ping ? d.alertTextWithMention : d.alertText) + '</pre>';
      html += '<select data-ca="guild"><option value="">Choose a server…</option>' + S.guilds.map((g) => '<option value="' + esc(g.id) + '"' + (g.id === S.guildId ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select>';
      html += '<select data-ca="channel"' + (S.guildId ? '' : ' disabled') + '><option value="">' + (S.guildId ? (S.channels.length ? 'Choose a channel…' : 'No channel where you and the app can post') : 'Pick a server first') + '</option>' + S.channels.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === S.channelId ? ' selected' : '') + '>#' + esc(c.name) + (c.category ? ' · ' + esc(c.category) : '') + '</option>').join('') + '</select>';
      const ch = S.channels.find((c) => c.id === S.channelId);
      html += '<label class="chk"><input type="checkbox" data-ca="ping"' + (S.ping ? ' checked' : '') + (ch && ch.mentionEveryone ? '' : ' disabled') + '> Ping @everyone' + (ch && !ch.mentionEveryone ? ' (not allowed in this channel)' : '') + '</label>';
      html += '<button type="button" class="act" data-ca="send"' + (S.busy || !S.channelId || S.sent ? ' disabled' : '') + '>' + (S.sent ? 'Alert sent' : S.busy ? 'Working…' : 'Send alert to Discord') + '</button>';
    }
    if (S.msg) html += '<div class="msg ' + esc(S.msgTone || 'info') + '">' + esc(S.msg) + '</div>';
    html += '<small>Educational estimate from the Academy’s data. It is not a prediction, financial advice, or a trade instruction. The alert is posted by the Academy app and shows your name.</small></div>';
    panel.innerHTML = html;
  }

  async function loadStatus() {
    if (!token()) { S.status = null; render(); return; }
    S.status = await api('status?current=' + encodeURIComponent(S.guildId || ''));
    S.guilds = S.status && S.status.ok ? (S.status.guilds || []) : [];
    if (!S.guilds.some((g) => g.id === S.guildId)) { const cur = S.guilds.find((g) => g.current) || S.guilds[0]; S.guildId = cur ? cur.id : ''; S.channelId = ''; }
    if (S.guildId) await loadChannels();
    render();
  }
  async function loadChannels() {
    S.channels = [];
    if (!S.guildId) return;
    const r = await api('channels?guild=' + encodeURIComponent(S.guildId));
    S.channels = r.ok ? (r.channels || []) : [];
    if (!S.channels.some((c) => c.id === S.channelId)) S.channelId = '';
  }
  async function reading() {
    S.busy = true; S.data = null; S.scn = null; S.msg = ''; S.sent = false; render();
    const r = await api('preview', { symbol: S.symbol, target: S.target });
    S.busy = false;
    if (!r.ok) { S.msg = explainErr(r); S.msgTone = 'err'; if (r.entitlement) S.status = Object.assign({ ok: true }, r.entitlement, { guilds: S.guilds }); S.data = null; S.entry = null; render(); draw(); return; }
    S.data = r.analysis; S.scn = r.scenarios && r.scenarios.available ? r.scenarios : null; S.entry = r.analysis.entry; S.side = r.analysis.side; S.msg = ''; render(); draw();
  }

  /* a click (not a drag or a pinch) on the plot sets the target */
  let down = null;
  // the chart captures the pointer on press, so where the press landed is judged at pointerdown
  stage.addEventListener('pointerdown', (e) => { down = S.on && e.target && e.target.tagName === 'CANVAS' ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }, { capture: true, passive: true }); // capture: the chart's own press handler stops the event
  stage.addEventListener('pointerup', (e) => {
    if (!S.on || !down) return; const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || Date.now() - d.t > 600) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < M.pad.l || x > M.pad.l + M.pw || y < M.pad.t || y > M.pad.t + (M.priceH || M.ph)) return;
    const p = M.hi - (y - M.pad.t) / M.ph * (M.hi - M.lo); if (!(p > 0)) return;
    S.symbol = M.symbol; S.target = Math.round(p * (p >= 1 ? 100 : 10000)) / (p >= 1 ? 100 : 10000);
    if (S.status && S.status.ok && S.status.entitled) { void reading(); } else { void loadStatus().then(() => { if (S.status && S.status.entitled) void reading(); }); }
    render(); draw();
  }, { passive: true });

  panel.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-ca]'); if (!a) return; const k = a.dataset.ca;
    if (k === 'close') { setOn(false); return; }
    if (k === 'send') {
      if (S.busy || !S.channelId || !S.data) return;
      S.busy = true; S.msg = ''; render();
      const r = await api('send', { symbol: S.symbol, target: S.target, channelId: S.channelId, mention: !!S.ping, images: !!S.images });
      S.busy = false;
      if (r.ok) { S.sent = true; S.msg = 'Posted to Discord' + (r.mentioned ? ' with @everyone' : r.mentionRequestedButNotAllowed ? ' (without @everyone: not allowed in that channel)' : '') + (r.imagesAttached ? ', with the 2 scenario charts.' : r.imagesSkipped === 'no_permission' ? '. The charts were left off: you or the app cannot attach files in that channel.' : r.imagesSkipped === 'unavailable' ? '. The charts could not be made this time.' : '.'); S.msgTone = 'ok'; save(); }
      else { S.msg = explainErr(r); S.msgTone = 'err'; }
      render();
    }
  });
  panel.addEventListener('change', async (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.ca; if (!k) return;
    if (k === 'guild') { S.guildId = e.target.value; S.channelId = ''; S.channels = []; S.sent = false; render(); await loadChannels(); save(); render(); }
    else if (k === 'channel') { S.channelId = e.target.value; S.sent = false; save(); const ch = S.channels.find((c) => c.id === S.channelId); if (!ch || !ch.mentionEveryone) S.ping = false; render(); }
    else if (k === 'ping') { S.ping = !!e.target.checked; render(); }
    else if (k === 'images') { S.images = !!e.target.checked; render(); }
  });

  function setOn(on) {
    S.on = !!on; btn.classList.toggle('on', S.on); document.body.classList.toggle('ca-armed', S.on);
    if (S.on) { if (hint.parentElement !== stage) stage.appendChild(hint); hint.style.display = 'block'; setTimeout(() => { hint.style.display = 'none'; }, 6000); void loadStatus(); }
    else { hint.style.display = 'none'; S.target = null; S.entry = null; S.data = null; S.msg = ''; S.sent = false; }
    render(); draw();
  }
  btn.addEventListener('click', () => setOn(!S.on));
  window.addEventListener('sml-academy-session', () => { if (S.on) void loadStatus(); });
  render();
})(0);
