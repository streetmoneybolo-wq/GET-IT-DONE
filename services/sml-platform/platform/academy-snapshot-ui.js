/* Quick Snapshot for the Academy Live Chart Lab. One tap on SNAP photographs the chart exactly as the member sees it (candles, their drawings, the smart-money zones,
   whatever overlays are on) and posts it to the Discord channel they chose. The first time, a small picker asks for the server and channel; after that the button
   posts at once (Shift-click, or "change" in the confirmation, to pick again). The server re-checks that the member and the Academy app may post and attach images
   there. Educational: a picture of a chart, nothing more. */
(function boot(tries) {
  if (window.__smlSnapshotUi) return;
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar') || !document.getElementById('chart')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlSnapshotUi = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar'), stage = document.querySelector('.academy-chart-stage'), base = $('chart');
  const KEY = 'sml-snapshot-dest';
  const S = { dest: null, guilds: [], channels: [], guildId: '', channelId: '', shot: null, busy: false, panel: false, msg: '', tone: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.channelId) { S.dest = v; S.guildId = String(v.guildId || ''); S.channelId = String(v.channelId); } } catch (_) { /* storage can be blocked */ }
  const saveDest = () => { try { localStorage.setItem(KEY, JSON.stringify(S.dest)); } catch (_) { /* ignore */ } };

  const css = document.createElement('style');
  css.textContent = '#snap-toggle{margin-left:4px;padding:5px 9px;border:1px solid #3a6fb0;border-radius:7px;background:#0d1f33;color:#9cc8ff;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#snap-toggle:hover{background:#15304d}#snap-toggle:disabled{opacity:.55;cursor:wait}'
    + '#snap-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483400;max-width:min(92vw,520px);padding:9px 14px;border-radius:10px;background:rgba(7,13,20,.97);border:1px solid #3a6fb0;color:#dbe6ec;font:700 .7rem/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6)}#snap-toast.ok{border-color:#1f8a5f;color:#a8ffd8}#snap-toast.err{border-color:#6b2234;color:#ffb3c0}#snap-toast button{margin-left:8px;border:0;background:none;color:#9cc8ff;font:inherit;text-decoration:underline;cursor:pointer}'
    + '#snap-panel{position:fixed;right:12px;bottom:12px;z-index:2147483250;width:min(360px,calc(100vw - 24px));background:rgba(7,13,20,.98);border:1px solid #3a6fb0;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.65);color:#dbe6ec;font:600 .68rem/1.42 system-ui,sans-serif;max-height:calc(100vh - 24px);overflow:auto}'
    + '#snap-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #1d3550;background:#0a1828}#snap-panel header b{font:800 .72rem ui-monospace,monospace;color:#9cc8ff;letter-spacing:.06em}#snap-panel header button{margin-left:auto;border:0;background:transparent;color:#9fb3be;font:800 .9rem system-ui;cursor:pointer}'
    + '#snap-panel .body{padding:10px 12px}#snap-panel img{display:block;width:100%;border-radius:8px;border:1px solid #1b2a35;margin:0 0 8px;background:#070d14}#snap-panel select,#snap-panel input[type=text],#snap-panel button.act{width:100%;margin:3px 0;padding:7px 8px;border-radius:8px;border:1px solid #2a4a58;background:#0d1a24;color:#e6eef2;font:700 .68rem system-ui,sans-serif;box-sizing:border-box}#snap-panel button.act{background:#3a8bff;border-color:#8cc0ff;color:#04121f;font-weight:900;cursor:pointer}#snap-panel button.act:disabled{opacity:.5;cursor:not-allowed}'
    + '#snap-panel .msg{margin:6px 0;padding:7px 9px;border-radius:8px;font-weight:700;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0}#snap-panel small{display:block;margin-top:6px;color:#6f8794;font-weight:500;font-size:.56rem}@media(max-width:700px){#snap-panel{left:8px;right:8px;bottom:8px;width:auto}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'snap-toggle'; btn.textContent = 'SNAP'; btn.title = 'Snapshot the chart and post it to your Discord channel (Shift-click to choose the channel)'; toolbar.appendChild(btn);
  const toast = document.createElement('div'); toast.id = 'snap-toast'; toast.style.display = 'none'; document.body.appendChild(toast);
  const panel = document.createElement('aside'); panel.id = 'snap-panel'; panel.style.display = 'none'; document.body.appendChild(panel);
  let toastTimer = 0;
  function say(html, tone, ms) { clearTimeout(toastTimer); toast.className = tone || ''; toast.innerHTML = html; toast.style.display = 'block'; toastTimer = setTimeout(() => { toast.style.display = 'none'; }, ms || 5000); }

  const token = () => String(window.smlAcademySessionToken || '');
  async function api(path, body) {
    const t = token(); if (!t) return { ok: false, status: 401, error: 'authorization_required' };
    const res = await fetch('/academy-activity/snapshot/' + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ authorization: 'Bearer ' + t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let json = null; try { json = await res.json(); } catch (_) { json = null; }
    return Object.assign({ status: res.status }, json || { ok: false, error: 'bad_response' });
  }
  const WHY = {
    authorization_required: 'Sign in with Discord (Unlock Academy Tools) to share snapshots.', invalid_image: 'The snapshot could not be used. Try again.', channel_unavailable: 'The Academy app is not installed in that server, or the channel was not found.',
    you_cannot_post_there: 'You do not have permission to send messages in that channel.', you_cannot_attach_there: 'You do not have permission to attach images in that channel.',
    app_cannot_post_there: 'The Academy app cannot send images in that channel. Ask a server admin to allow it, or pick another channel.', rate_limited: 'You are snapping too quickly. Try again in a few minutes.',
    snapshot_disabled: 'Snapshots are not available right now.', temporarily_unavailable: 'Something went wrong. Try again in a moment.'
  };
  const why = (r) => r.detail || WHY[r.error] || 'That did not work (' + esc(r.error || r.status) + ').';

  /* ---------- the picture: every visible canvas of the chart stage, stacked as on screen, under a one-line header ---------- */
  const visible = (c) => { const st = getComputedStyle(c); return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0 && c.width > 0 && c.height > 0; };
  function capture() {
    const sr = stage.getBoundingClientRect(); if (!sr.width || !sr.height) return null;
    const dpr = base.clientWidth ? base.width / base.clientWidth : (window.devicePixelRatio || 1);
    const scale = Math.min(1, 1600 / (sr.width * dpr)), f = scale * dpr, head = Math.round(46 * scale * dpr), foot = Math.round(22 * scale * dpr);
    const out = document.createElement('canvas'); out.width = Math.max(320, Math.round(sr.width * f)); out.height = Math.max(220, Math.round(sr.height * f) + head + foot);
    const g = out.getContext('2d'); g.fillStyle = '#0a1118'; g.fillRect(0, 0, out.width, out.height);
    for (const c of stage.querySelectorAll('canvas')) {
      if (!visible(c)) continue; const r = c.getBoundingClientRect();
      try { g.drawImage(c, (r.left - sr.left) * f, head + (r.top - sr.top) * f, r.width * f, r.height * f); } catch (_) { /* a canvas that cannot be read is skipped */ }
    }
    const M = window.smlChartModel && window.smlChartModel(), sym = M ? M.symbol : String(($('symbol') || {}).value || 'SPY').toUpperCase(), tf = M ? M.tf : '';
    const last = M && M.bars && M.bars.length ? M.bars[M.N - 1] : null, u = scale * dpr;
    g.fillStyle = '#0b1520'; g.fillRect(0, 0, out.width, head); g.fillStyle = '#35e6a0'; g.fillRect(0, head - Math.max(2, 2 * u), out.width, Math.max(2, 2 * u));
    g.textBaseline = 'middle'; g.font = '800 ' + Math.round(18 * u) + 'px system-ui,sans-serif'; g.fillStyle = '#ffffff'; g.fillText('$' + sym + (tf ? ' · ' + tf : ''), 14 * u, head / 2 - 1 * u);
    let when = ''; try { when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (_) { when = ''; }
    g.textAlign = 'right'; g.font = '700 ' + Math.round(13 * u) + 'px system-ui,sans-serif'; g.fillStyle = '#9fb3be'; g.fillText((last ? '$' + (last.c >= 1 ? last.c.toFixed(2) : last.c.toFixed(4)) + ' · ' : '') + when, out.width - 14 * u, head / 2 - 1 * u);
    g.textAlign = 'left'; g.font = '600 ' + Math.round(10.5 * u) + 'px system-ui,sans-serif'; g.fillStyle = '#6f8794'; g.fillText('Making Easy Money Academy · Live Chart Lab · educational, not financial advice', 14 * u, out.height - foot / 2);
    return { url: out.toDataURL('image/png'), symbol: sym, tf };
  }

  /* ---------- posting ---------- */
  async function post(note) {
    if (!S.shot || !S.channelId) return;
    S.busy = true; btn.disabled = true; renderPanel();
    const r = await api('send', { channelId: S.channelId, image: S.shot.url, symbol: S.shot.symbol, tf: S.shot.tf, note: note || '' });
    S.busy = false; btn.disabled = false;
    if (r.ok) {
      const ch = S.channels.find((c) => c.id === S.channelId), g = S.guilds.find((x) => x.id === S.guildId);
      S.dest = { guildId: S.guildId, channelId: S.channelId, channelName: r.channelName || (ch && ch.name) || (S.dest && S.dest.channelName) || 'your channel', guildName: (g && g.name) || (S.dest && S.dest.guildName) || '' }; saveDest();
      S.panel = false; S.msg = ''; renderPanel(); say('📸 Posted to <b>#' + esc(S.dest.channelName) + '</b>' + (S.dest.guildName ? ' in ' + esc(S.dest.guildName) : '') + ' <button type="button" data-snap="change">change</button>', 'ok', 6000);
    } else {
      S.msg = why(r); if (S.dest) { S.dest = null; try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } }
      S.panel = true; renderPanel(); say(esc(S.msg), 'err', 6000);
    }
  }
  async function loadGuilds() {
    const r = await api('status?current=' + encodeURIComponent(S.guildId || '')); S.guilds = r.ok ? (r.guilds || []) : [];
    if (!r.ok) { S.msg = why(r); }
    if (!S.guilds.some((g) => g.id === S.guildId)) { const cur = S.guilds.find((g) => g.current) || S.guilds[0]; S.guildId = cur ? cur.id : ''; S.channelId = ''; }
    await loadChannels();
  }
  async function loadChannels() {
    S.channels = []; if (!S.guildId) return;
    const r = await api('channels?guild=' + encodeURIComponent(S.guildId)); S.channels = r.ok ? (r.channels || []) : [];
    if (!S.channels.some((c) => c.id === S.channelId)) S.channelId = '';
  }
  function renderPanel() {
    if (!S.panel) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let h = '<header><b>SNAPSHOT TO DISCORD</b><button type="button" data-snap="close" aria-label="Close">×</button></header><div class="body">';
    if (!token()) h += '<div class="msg">' + esc(WHY.authorization_required) + '</div>';
    else {
      if (S.shot) h += '<img alt="Chart snapshot preview" src="' + esc(S.shot.url) + '">';
      h += '<select data-snap="guild"><option value="">Choose a server…</option>' + S.guilds.map((g) => '<option value="' + esc(g.id) + '"' + (g.id === S.guildId ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select>';
      h += '<select data-snap="channel"' + (S.guildId ? '' : ' disabled') + '><option value="">' + (S.guildId ? (S.channels.length ? 'Choose a channel…' : 'No channel where you and the app can post images') : 'Pick a server first') + '</option>' + S.channels.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === S.channelId ? ' selected' : '') + '>#' + esc(c.name) + (c.category ? ' · ' + esc(c.category) : '') + '</option>').join('') + '</select>';
      h += '<input type="text" data-snap="note" maxlength="140" placeholder="Add a note (optional)">';
      h += '<button type="button" class="act" data-snap="post"' + (S.busy || !S.channelId || !S.shot ? ' disabled' : '') + '>' + (S.busy ? 'Posting…' : 'Post snapshot') + '</button>';
    }
    if (S.msg) h += '<div class="msg">' + esc(S.msg) + '</div>';
    h += '<small>Posted by the Academy app with your name. Your choice is remembered, so the next tap on SNAP posts straight away.</small></div>';
    panel.innerHTML = h;
  }
  async function openPicker() { S.panel = true; S.msg = ''; renderPanel(); await loadGuilds(); renderPanel(); }

  btn.addEventListener('click', async (e) => {
    if (S.busy) return;
    if (!token()) { S.shot = null; S.panel = true; renderPanel(); return; }
    let shot; try { shot = capture(); } catch (_) { shot = null; }
    if (!shot) { say('The chart could not be captured. Try again.', 'err'); return; }
    S.shot = shot;
    if (S.dest && S.dest.channelId && !e.shiftKey) { S.guildId = S.dest.guildId; S.channelId = S.dest.channelId; say('📸 Posting to #' + esc(S.dest.channelName) + '…', '', 4000); await post(''); return; }
    await openPicker();
  });
  panel.addEventListener('click', (e) => { const a = e.target.closest('[data-snap]'); if (!a) return; const k = a.dataset.snap; if (k === 'close') { S.panel = false; renderPanel(); } else if (k === 'post') { const n = panel.querySelector('[data-snap=note]'); void post(n ? n.value : ''); } });
  panel.addEventListener('change', async (e) => { const k = e.target && e.target.dataset && e.target.dataset.snap; if (k === 'guild') { S.guildId = e.target.value; S.channelId = ''; S.channels = []; renderPanel(); await loadChannels(); renderPanel(); } else if (k === 'channel') { S.channelId = e.target.value; renderPanel(); } });
  toast.addEventListener('click', (e) => { if (e.target.closest('[data-snap=change]')) { S.dest = null; try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } toast.style.display = 'none'; if (!S.shot) { try { S.shot = capture(); } catch (_) { S.shot = null; } } void openPicker(); } });
})(0);
