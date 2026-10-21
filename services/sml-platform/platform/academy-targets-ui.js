/* PRICE TARGETS: pick a direction and a horizon and get three targets with odds, a stop, and the reasons, drawn on the chart.
   The TARGETS button in the chart toolbar asks /academy-activity/targets (academy-target-engine.js on the server). AUTO weighs the other tools
   (MEM ALGO's horizons, smart-money intent, sentiment, trend) and says which way the evidence leans; LONG or SHORT overrides it. The ladder comes
   from how far this stock's own moves have actually gone over that horizon, scaled to how it is moving now, and snapped to the levels in the way.
   Every suggestion is judged later by the server, and the engine tunes itself from the results: the panel says how many it has judged.
   Educational analysis of what the stock has done, not advice, and nothing here places a trade. */
(function boot(tries) {
  if (window.__smlTargetsUi) return;
  const stage = document.querySelector('.academy-chart-stage'), toolbar = document.querySelector('.toolbar'), chartCanvas = document.getElementById('chart');
  if (!stage || !toolbar || !chartCanvas) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlTargetsUi = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const symbolNow = () => { try { return String((window.smlAcademyChartState && window.smlAcademyChartState().symbol) || (document.getElementById('symbol') || {}).value || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const fmt = (p) => (Number(p) >= 10 ? Number(p).toFixed(2) : Number(p) >= 1 ? Number(p).toFixed(3) : Number(p).toFixed(4));
  const KEY = 'sml-targets-prefs';
  const prefs = (() => { try { const j = JSON.parse(localStorage.getItem(KEY) || '{}'); return { dir: ['auto', 'long', 'short'].includes(j.dir) ? j.dir : 'auto', horizon: ['day', 'swing', 'position'].includes(j.horizon) ? j.horizon : 'swing', draw: j.draw !== false }; } catch (_) { return { dir: 'auto', horizon: 'swing', draw: true }; } })();
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ } };
  const S = { on: false, data: null, busy: false, err: '', at: 0, key: '' };

  const css = document.createElement('style');
  css.textContent = '#targets-toggle{margin-left:4px;padding:5px 9px;border:1px solid #7a5cff;border-radius:7px;background:#17112a;color:#cdb6ff;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#targets-toggle.on{background:#6a4fe0;color:#fff;border-color:#b9a4ff}'
    + '#targets-layer{position:absolute;pointer-events:none;z-index:6;background:none!important;border:0!important}'
    + '#targets-panel{position:absolute;right:8px;top:26px;z-index:9;width:min(340px,calc(100% - 24px));max-height:calc(100% - 40px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;display:none;background:rgba(10,8,22,.96);border:1px solid #3a3160;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.55);color:#dbe6ec;font:600 .66rem/1.45 system-ui,sans-serif}#targets-panel.open{display:block}'
    + '#targets-panel .th{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid #2a2450;position:sticky;top:0;background:rgba(10,8,22,.98)}#targets-panel .th b{font:900 .7rem ui-monospace,monospace;letter-spacing:.06em;color:#cdb6ff}#targets-panel .th i{margin-left:auto;font-style:normal;cursor:pointer;color:#9fb3bd;font-size:.9rem}'
    + '#targets-panel .tb{padding:8px 10px}#targets-panel .pills{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}#targets-panel .pills button{padding:3px 8px;border:1px solid #3a3160;border-radius:999px;background:#120d24;color:#b9a4ff;font:800 .56rem ui-monospace,monospace;letter-spacing:.05em;cursor:pointer}#targets-panel .pills button.on{background:#6a4fe0;border-color:#b9a4ff;color:#fff}#targets-panel .pills span{align-self:center;color:#6f8794;font:800 .52rem ui-monospace,monospace;margin-right:2px}'
    + '#targets-panel .lean{margin:0 0 7px;padding:6px 8px;border-radius:8px;background:#120d24;border:1px solid #2a2450;color:#d6c9ff}#targets-panel .lean b{color:#fff}'
    + '#targets-panel .px{font:900 1rem system-ui;color:#fff;margin:0 0 6px}#targets-panel .px small{font:700 .58rem ui-monospace,monospace;color:#8fa5b1;margin-left:6px}'
    + '#targets-panel .tg{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;margin:0 0 5px;padding:6px 8px;border-radius:8px;background:#0e1a1a;border:1px solid #17403a}#targets-panel .tg.stop{background:#1a0e12;border-color:#4a1d28}#targets-panel .tg.short{background:#1a0e12;border-color:#4a1d28}'
    + '#targets-panel .tg b{font:900 .62rem ui-monospace,monospace;color:#7ef0bd}#targets-panel .tg.stop b,#targets-panel .tg.short b{color:#ff8fa3}#targets-panel .tg strong{font:900 .8rem system-ui;color:#fff}#targets-panel .tg em{font-style:normal;font:800 .6rem ui-monospace,monospace;color:#cfe3ec}'
    + '#targets-panel .tg .bar{grid-column:1/-1;height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}#targets-panel .tg .bar i{display:block;height:100%;background:#35e6a0}#targets-panel .tg.short .bar i{background:#ff6b86}#targets-panel .tg small{grid-column:1/-1;color:#8fa5b1;font-weight:600;font-size:.58rem}'
    + '#targets-panel .note{margin:5px 0 0;padding:5px 8px;border-radius:7px;background:#2a1a0e;border:1px solid #6b4a22;color:#ffd3a6}#targets-panel .ig{margin:5px 0 0;padding:5px 8px;border-radius:7px;background:#0e1a2a;border:1px solid #1d3550;color:#bfe0ff}'
    + '#targets-panel .learn{margin:7px 0 0;color:#9d8be0;font-size:.58rem}#targets-panel .fine{margin:6px 0 0;color:#5f7784;font-size:.54rem}#targets-panel .err{margin:6px 0;padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700}'
    + '@media(max-width:700px){#targets-panel{right:6px;left:6px;width:auto;top:auto;bottom:34px;max-height:52%}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'targets-toggle'; btn.textContent = 'TARGETS'; btn.title = 'Price targets: pick a direction and a horizon and get three targets with odds and a stop, drawn on the chart. The engine tunes itself from how its past suggestions did.'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'targets-layer'; stage.appendChild(layer); const ctx = layer.getContext('2d');
  const panel = document.createElement('aside'); panel.id = 'targets-panel'; panel.setAttribute('aria-label', 'Price targets'); stage.appendChild(panel);
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));

  async function fetchRead() {
    const sym = symbolNow(), key = sym + '|' + prefs.dir + '|' + prefs.horizon;
    if (S.busy) return; S.busy = true; S.key = key;
    try {
      let t = token(); if (!t) { S.err = 'Unlock the Academy tools to get price targets.'; S.data = null; return; }
      const read = (tok) => fetch('/academy-activity/targets?symbol=' + encodeURIComponent(sym) + '&direction=' + prefs.dir + '&horizon=' + prefs.horizon, { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
      let res = await read(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) { t = fresh; res = await read(t); } }
      const j = await res.json().catch(() => null);
      if (key !== S.key) return;
      if (!res.ok || !j || !j.ok) { S.data = null; S.err = j && j.error === 'academy_access_required' ? 'Price targets are an Academy member tool.' : (j && j.detail) || ('Could not build targets right now' + (j && j.error ? ' (' + j.error.replace(/_/g, ' ') + ')' : '') + '.'); return; }
      S.data = j; S.err = ''; S.at = Date.now();
    } catch (_) { S.err = 'No connection.'; }
    finally { S.busy = false; paint(); draw(); }
  }

  function paint() {
    panel.classList.toggle('open', S.on); btn.classList.toggle('on', S.on);
    if (!S.on) return;
    const d = S.data, short = d && d.direction === 'short';
    const pill = (group, id, label, on) => '<button type="button" data-' + group + '="' + id + '" class="' + (on ? 'on' : '') + '">' + label + '</button>';
    let h = '<div class="th"><b>PRICE TARGETS · $' + esc(symbolNow()) + '</b><i data-close="1" title="Close">&#10005;</i></div><div class="tb">';
    h += '<div class="pills"><span>DIRECTION</span>' + pill('dir', 'auto', 'AUTO', prefs.dir === 'auto') + pill('dir', 'long', 'LONG', prefs.dir === 'long') + pill('dir', 'short', 'SHORT', prefs.dir === 'short') + '</div>';
    h += '<div class="pills"><span>HORIZON</span>' + pill('hz', 'day', 'DAY', prefs.horizon === 'day') + pill('hz', 'swing', 'SWING', prefs.horizon === 'swing') + pill('hz', 'position', 'POSITION', prefs.horizon === 'position') + '<span style="margin-left:auto"></span>' + pill('draw', '1', prefs.draw ? 'ON CHART' : 'HIDDEN', prefs.draw) + '</div>';
    if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
    if (d) {
      if (d.auto) h += '<div class="lean">Evidence leans <b>' + esc(d.auto.direction.toUpperCase()) + '</b>' + (d.auto.clear ? '' : ' (weakly: no clear side, so read both)') + (d.auto.why && d.auto.why.length ? ': ' + esc(d.auto.why.join('; ')) + '.' : '.') + '</div>';
      h += '<div class="px">$' + fmt(d.price) + '<small>' + esc(d.horizonLabel) + ' · ' + esc(d.direction.toUpperCase()) + ' · ' + esc(d.session) + ' · confidence ' + esc(d.confidence) + '</small></div>';
      for (const t of d.targets) h += '<div class="tg' + (short ? ' short' : '') + '"><b>T' + t.n + '</b><strong>$' + fmt(t.price) + '</strong><em>' + (short ? '-' : '+') + Math.abs(t.pct).toFixed(1) + '% · ' + t.prob + '% odds</em><div class="bar"><i style="width:' + t.prob + '%"></i></div><small>' + esc(t.basis) + ' · R:R ' + esc(d.rr[t.n - 1]) + '</small></div>';
      h += '<div class="tg stop"><b>STOP</b><strong>$' + fmt(d.stop.price) + '</strong><em>' + (short ? '+' : '-') + d.stop.pct.toFixed(1) + '%' + (d.stop.hitRate != null ? ' · hit ' + d.stop.hitRate + '% of the time' : '') + '</em><small>' + esc(d.stop.basis) + '</small></div>';
      for (const n of d.notes || []) h += '<div class="note">' + esc(n) + '</div>';
      if (d.ignition && d.ignition.active) h += '<div class="ig"><b>IGNITION · ' + esc(d.ignition.state.toUpperCase()) + '</b> ' + esc(d.ignition.note) + '</div>';
      const L = d.learning || {};
      h += '<div class="learn">Built from ' + esc(d.sample.windows) + ' windows of this stock\'s own history. The engine has judged ' + esc(L.judged || 0) + ' earlier suggestions (' + esc(L.bucketJudged || 0) + ' in this kind of setup) and tunes its targets and odds from them.</div>';
      h += '<div class="fine">' + esc(d.disclaimer) + '</div>';
    } else if (!S.err) h += '<div class="lean">Reading this stock\'s moves, the levels in the way and what the other tools say…</div>';
    h += '</div>';
    panel.innerHTML = h;
  }

  /* ---- the layer: the ladder on the candles ---- */
  function pill(text, x, y, col) {
    ctx.font = '800 10px ui-monospace,monospace'; const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(8,6,18,.92)'; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w, y - 9, w, 17, 5) : ctx.rect(x - w, y - 9, w, 17); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(text, x - w + 6, y + 4);
  }
  function draw() {
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || !prefs.draw || !S.data || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.symbol !== S.data.symbol) return;
    const pad = M.pad, right = pad.l + M.pw, top = pad.t, ph = M.priceH || M.ph, short = S.data.direction === 'short';
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, top, M.pw, ph); ctx.clip();
    const line = (price, col, label, dash) => {
      if (price < M.lo || price > M.hi) return;
      const y = M.y(price); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
      pill(label, right - 6, y, col);
    };
    const tcol = short ? '#ff8fa3' : '#7ef0bd';
    for (const t of S.data.targets) line(t.price, tcol, 'T' + t.n + ' ' + fmt(t.price) + ' · ' + t.prob + '%', [7, 4]);
    line(S.data.stop.price, '#ff5470', 'STOP ' + fmt(S.data.stop.price), [3, 4]);
    ctx.restore();
  }

  /* ---- events ---- */
  btn.addEventListener('click', () => { S.on = !S.on; paint(); if (S.on) fetchRead(); else draw(); });
  panel.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-close],[data-dir],[data-hz],[data-draw]'); if (!t) return;
    if (t.dataset.close) { S.on = false; paint(); draw(); return; }
    if (t.dataset.dir) prefs.dir = t.dataset.dir; else if (t.dataset.hz) prefs.horizon = t.dataset.hz; else if (t.dataset.draw) { prefs.draw = !prefs.draw; savePrefs(); paint(); draw(); return; }
    savePrefs(); S.data = null; S.err = ''; paint(); fetchRead();
  });
  window.addEventListener('sml-chart-view', () => { try { draw(); } catch (_) { /* chart not ready */ } });
  window.addEventListener('sml-academy-market', () => { const key = symbolNow() + '|' + prefs.dir + '|' + prefs.horizon; if (key !== S.key && S.on) { S.data = null; paint(); draw(); setTimeout(fetchRead, 300); } });
  setInterval(() => { if (S.on && !document.hidden && Date.now() - S.at > 59_000) fetchRead(); }, 5_000);
  window.smlTargets = { open: () => { if (!S.on) btn.click(); }, state: () => S.data };
})(0);
