/* STANDING ALERT LEVELS on the chart (server: academy-alert-levels.js). When a member has an open alert on the ticker they are looking at, its
   current target, its entry and its stop stay drawn on the chart every time they come back, until the trade is over: a PT SMASHED follow-up moves the
   line to the new target, a reached target shows as HIT for a day, and a stopped or expired trade is gone. Nothing to switch on.

   How the line looks is decided by the data, not fixed:
     - weight: the closer price is to the target the heavier the line (3px inside 0.4%, 2.4px inside 1.5%, 1.9px inside 5%, 1.4px beyond), so the
       level that is about to matter is the one the eye finds;
     - colour: a long's target is green, a short's is red; the stop is amber; the entry is blue; a reached target is gold with a glow;
     - the path: a faint band from the entry to a live target shows the distance still to travel;
     - the label says what it is and how far: "ALERT TARGET 612.50 · 1.2% to go · 3h ago". Labels never sit on each other, and a level outside the
       visible price range becomes an arrow chip on the edge so it is never lost (the chart's smart range also widens to include a level in reach).
   Educational display of the member's own alerts; nothing here places a trade. */
(function boot(tries) {
  if (window.__smlAlertLevels) return;
  const stage = document.querySelector('.academy-chart-stage'), chartCanvas = document.getElementById('chart');
  if (!stage || !chartCanvas) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlAlertLevels = true;
  const token = () => String(window.smlAcademySessionToken || '');
  const symbolNow = () => { try { const M = window.smlChartModel && window.smlChartModel(); if (M && M.symbol) return String(M.symbol).toUpperCase(); } catch (_) { /* fall through */ } try { return String((window.smlAcademyChartState && window.smlAcademyChartState().symbol) || (document.getElementById('symbol') || {}).value || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const fmt = (p) => (Number(p) >= 10 ? Number(p).toFixed(2) : Number(p) >= 1 ? Number(p).toFixed(3) : Number(p).toFixed(4));
  const ago = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 60 ? m + 'm ago' : m < 48 * 60 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
  const S = { sym: '', levels: [], at: 0, busy: false };

  const layer = document.createElement('canvas'); layer.id = 'alert-levels-layer'; layer.style.cssText = 'position:absolute;pointer-events:none;z-index:7;background:none;border:0';
  const ctx = layer.getContext('2d');

  async function load(force) {
    const sym = symbolNow(); if (S.busy || !token()) return;
    if (!force && sym === S.sym && Date.now() - S.at < 45000) return;
    S.busy = true;
    try {
      const go = (tok) => fetch('/academy-activity/my-alert-levels?symbol=' + encodeURIComponent(sym), { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
      let res = await go(token());
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
      const j = await res.json().catch(() => null);
      if (symbolNow() !== sym) return;
      S.sym = sym; S.at = Date.now(); S.levels = j && j.ok && Array.isArray(j.levels) ? j.levels.filter((l) => l.symbol === sym) : [];
    } catch (_) { /* the lines simply stay as they were */ }
    finally { S.busy = false; try { if (window.smlChartPro) window.smlChartPro.setView(); } catch (_) { /* chart not ready */ } draw(); }
  }

  /* the smart range keeps a live target and its stop in view when they are within reach of the candles */
  (function reg(n) { if (window.smlChartLevels) { window.smlChartLevels.register('my-alerts', (s) => (S.sym === s ? S.levels.filter((l) => l.state === 'live').flatMap((l) => [l.target, l.stop].filter((v) => Number.isFinite(Number(v)) && v !== null).map(Number)) : [])); return; } if (n < 60) setTimeout(() => reg(n + 1), 500); })(0);

  const weight = (dist) => (dist <= 0.004 ? 3 : dist <= 0.015 ? 2.4 : dist <= 0.05 ? 1.9 : 1.4);
  function draw() {
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    if (layer.parentElement !== chartCanvas.parentElement && chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!w || !h || !S.levels.length) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.symbol !== S.sym) return;
    const left = M.pad.l, right = M.pad.l + M.pw, top = M.pad.t, bottom = M.pad.t + (M.priceH || M.ph);
    const last = M.bars && M.N ? Number(M.bars[M.N - 1].c) : null;
    const items = [];
    for (const l of S.levels) {
      const long = l.side !== 'short', hit = l.state === 'hit';
      const dist = last > 0 ? Math.abs(l.target - last) / last : 0.1;
      const toGo = last > 0 ? ((l.target - last) / last) * 100 * (long ? 1 : -1) : null;
      const tcol = hit ? '#ffd166' : long ? '#35e6a0' : '#ff6b86';
      items.push({ p: l.target, kind: 'target', color: tcol, width: hit ? 2.6 : weight(dist), dash: hit ? [] : [9, 5], glow: hit, text: (hit ? '✓ TARGET HIT ' : 'ALERT TARGET ') + fmt(l.target) + (hit ? '' : toGo != null ? ' · ' + Math.abs(toGo).toFixed(1) + '% ' + (toGo > 0 ? 'to go' : 'past') : '') + (l.alertedAt ? ' · ' + ago(l.alertedAt) : '') + (l.smashed ? ' · PT ' + (l.smashed + 1) : ''), strong: true, band: !hit ? l : null });
      if (Number.isFinite(l.stop) && l.stop > 0 && !hit) items.push({ p: l.stop, kind: 'stop', color: '#ffb04a', width: 1.5, dash: [3, 4], text: 'ALERT STOP ' + fmt(l.stop), strong: false });
      if (Number.isFinite(l.entry) && l.entry > 0) items.push({ p: l.entry, kind: 'entry', color: '#4dc3ff', width: 1, dash: [2, 4], text: 'ENTRY ' + fmt(l.entry), strong: false });
    }
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, M.pw, bottom - top); ctx.clip();
    /* the path: entry to target, faint */
    for (const it of items) if (it.band) { const y1 = M.y(it.band.entry), y2 = M.y(it.p); ctx.fillStyle = it.color.replace('#', '#') + '14'; ctx.fillRect(left, Math.min(y1, y2), M.pw, Math.abs(y2 - y1)); }
    for (const it of items) {
      const y = M.y(it.p); if (!(y >= top && y <= bottom)) continue;
      ctx.save(); if (it.glow) { ctx.shadowColor = it.color; ctx.shadowBlur = 10; }
      ctx.setLineDash(it.dash); ctx.lineWidth = it.width; ctx.strokeStyle = it.color; ctx.globalAlpha = it.strong ? 0.95 : 0.75;
      ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(right, Math.round(y) + 0.5); ctx.stroke(); ctx.restore(); it.y = y;
    }
    ctx.restore();
    /* labels, nudged apart so none sits on another; the strong ones win the best spot */
    const placed = [];
    const vis = items.filter((it) => it.y != null).sort((a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0) || a.y - b.y);
    for (const it of vis) {
      let ly = it.y;
      for (let tries2 = 0; tries2 < 8; tries2++) { const hitp = placed.find((q) => Math.abs(q - ly) < 15); if (hitp == null) break; ly = ly >= hitp ? hitp + 16 : hitp - 16; }
      ly = Math.max(top + 9, Math.min(bottom - 9, ly)); placed.push(ly);
      ctx.font = (it.strong ? '800 10.5px' : '700 9.5px') + ' ui-monospace,monospace'; const tw = ctx.measureText(it.text).width + 12;
      const x = right - tw - 6;
      ctx.fillStyle = it.strong ? it.color : 'rgba(8,16,24,.88)'; ctx.fillRect(x, ly - 8.5, tw, 17);
      if (!it.strong) { ctx.strokeStyle = it.color; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, ly - 8, tw - 1, 16); }
      ctx.fillStyle = it.strong ? '#04140d' : it.color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(it.text, x + 6, ly + 0.5);
    }
    /* a level above or below the visible range: an arrow chip on the edge, so a standing alert is never lost */
    let upN = 0, dnN = 0;
    for (const it of items.filter((q) => q.strong)) {
      const y = M.y(it.p); if (y >= top && y <= bottom) continue;
      const up = y < top, label = (up ? '▲ ' : '▼ ') + (it.kind === 'target' ? 'ALERT TARGET ' : '') + fmt(it.p);
      ctx.font = '800 10px ui-monospace,monospace'; const tw = ctx.measureText(label).width + 12, x = right - tw - 6, yy = up ? top + 4 + upN++ * 20 : bottom - 22 - dnN++ * 20;
      ctx.fillStyle = it.color; ctx.fillRect(x, yy, tw, 17); ctx.fillStyle = '#04140d'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 6, yy + 9);
    }
  }

  window.addEventListener('sml-chart-view', draw);
  window.addEventListener('resize', draw);
  window.addEventListener('sml-academy-market', () => { void load(false); draw(); });
  window.addEventListener('sml-academy-session', () => { void load(true); });
  setInterval(() => { if (!document.hidden) void load(false); }, 15000);
  window.smlAlertLevels = { refresh: () => load(true), levels: () => S.levels.slice(), draw };
  void load(true);
})(0);
