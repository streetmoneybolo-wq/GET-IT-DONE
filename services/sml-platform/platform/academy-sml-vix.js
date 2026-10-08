/* Academy: SML VIX — a 30-day volatility index computed with the CBOE VIX method from live SPY options.
 * A chip in the top bar (level + move since the open, coloured by fear level) and a panel under the chart with the
 * day's readings, the two expirations it is built from and how to read it. Educational only. */
(() => {
  if (window.__smlAcademyVix) return;
  window.__smlAcademyVix = 1;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const zone = (l) => (l < 15 ? ['calm', '#00c47d'] : l <= 20 ? ['normal', '#cfd9de'] : l <= 25 ? ['elevated fear', '#ffb648'] : ['high fear', '#ff5d6c']);
  const css = document.createElement('style');
  css.textContent = '#academy-vix-chip{display:inline-flex;align-items:baseline;gap:6px;margin-left:8px;padding:3px 9px;border:1px solid #284654;border-radius:999px;background:#0b141b;color:#dbe7ec;font:800 11px ui-monospace,monospace;cursor:pointer}#academy-vix-chip:hover{border-color:#00c47d}#academy-vix-chip b{font-size:12px}#academy-vix-chip i{font-style:normal;font-weight:700}'
    + '.avx{border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dbe7ec;font:500 12px/1.45 system-ui,sans-serif;margin:10px 0;overflow:hidden}'
    + '.avx-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 40px 9px 12px;border-bottom:1px solid #1b3540}.avx-head b{font:900 12px ui-monospace,monospace;letter-spacing:.06em;color:#eaf5f8}.avx-head small{margin-left:auto;color:#7b93a0;font:700 10px ui-monospace,monospace}'
    + '.avx-body{display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:12px;padding:10px 12px}@media(max-width:700px){.avx-body{grid-template-columns:1fr}}'
    + '.avx-level{font:900 34px ui-monospace,monospace;line-height:1}.avx-zone{font:800 12px system-ui;margin-top:4px}.avx-chg{font:800 12px ui-monospace,monospace;margin-top:6px}.avx-terms{margin-top:8px;color:#8fa6b3;font-size:11px}'
    + '.avx canvas{width:100%;height:120px;display:block;border:1px solid #13262f;border-radius:8px;background:#0c161d}'
    + '.avx-scale{display:flex;gap:4px;margin-top:6px;font:700 10px ui-monospace,monospace}.avx-scale span{flex:1;padding:3px 0;text-align:center;border-radius:4px}'
    + '.avx-foot{padding:7px 12px;border-top:1px solid #13262f;color:#5f7784;font-size:10.5px}.avx-empty{padding:16px 12px;color:#8fa6b3;text-align:center}';
  document.head.appendChild(css);
  let chip = null, root = null, body = null, data = null, message = 'Loading…', timer = 0;

  function paintChip() {
    if (!chip) return;
    if (!data) { chip.innerHTML = 'SML VIX <b>–</b>'; return; }
    const [, col] = zone(data.level);
    const ch = data.change;
    chip.innerHTML = 'SML VIX <b style="color:' + col + '">' + esc(data.level.toFixed(2)) + '</b>' + (ch ? '<i style="color:' + (ch.change > 0 ? '#ff5d6c' : '#00c47d') + '">' + (ch.change > 0 ? '▲' : '▼') + Math.abs(ch.change).toFixed(2) + '</i>' : '');
    chip.title = 'SML VIX ' + data.level.toFixed(2) + ' (' + zone(data.level)[0] + '): 30-day volatility from live SPY options, CBOE VIX method. Click for details.';
  }
  function drawHistory(canvas) {
    const h = (data && data.history) || [];
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 400, ht = canvas.clientHeight || 120;
    canvas.width = w * dpr; canvas.height = ht * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, ht);
    if (h.length < 2) { ctx.fillStyle = '#5f7784'; ctx.font = '600 11px system-ui'; ctx.fillText('The day’s readings build up here, one every 2 minutes in market hours.', 10, ht / 2); return; }
    const vals = h.map((p) => p.level), lo = Math.min(...vals) - 0.3, hi = Math.max(...vals) + 0.3;
    const x = (i) => 8 + (i / (h.length - 1)) * (w - 16), y = (v) => ht - 10 - ((v - lo) / (hi - lo)) * (ht - 20);
    [15, 20, 25].forEach((lvl) => { if (lvl > lo && lvl < hi) { ctx.strokeStyle = '#1b3540'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, y(lvl)); ctx.lineTo(w, y(lvl)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#5f7784'; ctx.font = '700 9px ui-monospace'; ctx.fillText(String(lvl), w - 18, y(lvl) - 2); } });
    ctx.strokeStyle = zone(vals[vals.length - 1])[1]; ctx.lineWidth = 2; ctx.beginPath();
    h.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.level)) : ctx.moveTo(x(i), y(p.level)))); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x(h.length - 1), y(vals[vals.length - 1]), 3, 0, Math.PI * 2); ctx.fill();
  }
  function paint() {
    paintChip();
    if (!body) return;
    const head = '<div class="avx-head"><b>SML VIX</b><span style="color:#8fa6b3">30-day volatility · from live SPY options</span><small>' + (data ? (data.stale ? 'last reading · ' : '') + new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') + '</small></div>';
    if (!data) { body.innerHTML = head + '<div class="avx-empty">' + esc(message) + '</div>'; return; }
    const [name, col] = zone(data.level), ch = data.change;
    body.innerHTML = head + '<div class="avx-body"><div><div class="avx-level" style="color:' + col + '">' + esc(data.level.toFixed(2)) + '</div><div class="avx-zone" style="color:' + col + '">' + esc(name) + '</div>'
      + (ch ? '<div class="avx-chg" style="color:' + (ch.change > 0 ? '#ff5d6c' : '#00c47d') + '">' + (ch.change > 0 ? '▲ +' : '▼ ') + esc(ch.change) + ' (' + esc(ch.pct) + '%) since the open' + (ch.pct > 2 ? ' · fear rising' : ch.pct < -2 ? ' · fear easing' : '') + '</div>' : '<div class="avx-chg" style="color:#7b93a0">Change since the open starts at 9:30 ET</div>')
      + '<div class="avx-terms">' + (data.terms || []).map((t) => esc(t.expiry) + ': ' + esc(t.vol) + '% (' + esc(t.days) + ' days, ' + esc(t.strikes) + ' strikes)').join('<br>') + '</div>'
      + '<div class="avx-scale"><span style="background:#0b2a20;color:#7ef0bd">&lt;15 calm</span><span style="background:#16232b;color:#cfd9de">15–20</span><span style="background:#2e2410;color:#ffb648">20–25</span><span style="background:#40161c;color:#ff9aa4">25+ fear</span></div></div>'
      + '<div><canvas aria-label="Today’s SML VIX readings"></canvas></div></div>'
      + '<div class="avx-foot">Computed with the CBOE VIX method (two SPY expirations around 30 days, out-of-the-money options, blended to exactly 30 days). Tracks the official VIX closely but is not identical: VIX uses S&P 500 index options. Rising volatility usually comes with falling stocks. Educational only.</div>';
    drawHistory(body.querySelector('canvas'));
  }
  async function load() {
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(load, 5000); return; }
    let token = window.smlAcademySessionToken;
    if (!token) { message = 'Sign in to the Academy to see the SML VIX.'; paint(); timer = setTimeout(load, 5000); return; }
    try {
      let res = await fetch('/academy-activity/vix', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { token = await window.smlAcademyReauth(); if (token) res = await fetch('/academy-activity/vix', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' }); }
      const j = await res.json();
      if (j && j.ok && Number.isFinite(j.level)) data = j; else message = 'The SML VIX is not available right now (it needs the live SPY options feed).';
    } catch (_) { message = 'The SML VIX is not available right now.'; }
    paint();
    timer = setTimeout(load, 60000);
  }
  (function mount() {
    const bar = document.querySelector('main .dashbar');
    const host = document.getElementById('academy-below');
    if (!bar || !host) { setTimeout(mount, 300); return; }
    chip = document.createElement('button'); chip.type = 'button'; chip.id = 'academy-vix-chip';
    const state = bar.querySelector('.market-state');
    if (state) state.after(chip); else bar.appendChild(chip);
    root = document.createElement('section'); root.className = 'avx'; root.id = 'academy-sml-vix'; root.setAttribute('aria-label', 'SML VIX');
    body = document.createElement('div'); root.appendChild(body);
    const after = document.getElementById('academy-unusual-volume') || document.getElementById('academy-direction');
    if (after) after.after(root); else { const t = host.querySelector('.below-title'); host.insertBefore(root, t ? t.nextSibling : host.firstChild); }
    chip.addEventListener('click', () => root.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    window.addEventListener('resize', () => { const c = body && body.querySelector('canvas'); if (c && data) drawHistory(c); });
    paint(); load();
  })();
  window.addEventListener('sml-academy-session', () => load());
})();
