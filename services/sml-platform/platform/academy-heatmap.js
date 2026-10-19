/* Order-book heat map for the Academy Live Chart Lab.
 *
 * Time across, price up, and at every point the shares resting in the book at that price at that moment: bids in teal, asks in rose,
 * brighter where more size sat. Walls show as bright horizontal bands that persist; a band that vanishes without the tape eating it
 * was pulled; a band price walks into and that holds is absorption; air pockets are the dark stretches price runs through. The mid
 * price is traced in white over the heat. Columns arrive from /academy-activity/heatmap (one every five seconds, twenty minutes deep)
 * and the layer keeps asking only for what it is missing.
 *
 * Drawn on intraday charts (1m to 30m); on slower charts twenty minutes is one candle and the layer says so instead. Educational display:
 * it shows where liquidity was, not where price will go. Pure helpers are exported for tests (module.exports / window.SmlHeatmap). */
(function () {
  const H = {};
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fin = Number.isFinite;

  /** The reference size for brightness: the 95th percentile of every level in the columns (so one giant wall does not dim the rest). */
  H.heatScale = function (columns) {
    const sizes = [];
    for (const c of columns || []) { for (const l of c.b || []) if (l[1] > 0) sizes.push(l[1]); for (const l of c.a || []) if (l[1] > 0) sizes.push(l[1]); }
    if (!sizes.length) return 1;
    sizes.sort((p, q) => p - q);
    return Math.max(1, sizes[Math.min(sizes.length - 1, Math.floor(0.95 * (sizes.length - 1)))]);
  };
  /** Brightness 0..1 on a log scale: log(1 + size) / log(1 + reference), so a level a tenth of the reference is still clearly visible. */
  H.intensity = function (size, ref) { if (!(size > 0) || !(ref > 0)) return 0; return clamp(Math.log(1 + size) / Math.log(1 + ref), 0, 1); };
  /** Sum a column's levels into price bins `binPrice` wide (so one screen row is one bin): Map of bin index -> { bid, ask }. */
  H.binColumn = function (column, binPrice) {
    const out = new Map(); if (!(binPrice > 0)) return out;
    const put = (levels, key) => { for (const l of levels || []) { if (!(l[1] > 0)) continue; const k = Math.round(l[0] / binPrice + 1e-9); const r = out.get(k) || { bid: 0, ask: 0 }; r[key] += l[1]; out.set(k, r); } };
    put(column.b, 'bid'); put(column.a, 'ask');
    return out;
  };
  /** Append newer columns to what the viewer holds, by time, without duplicates, keeping at most `max`. */
  H.mergeColumns = function (existing, incoming, max) {
    const have = existing ? existing.slice() : [];
    const lastT = have.length ? have[have.length - 1].t : -Infinity;
    for (const c of (incoming || []).slice().sort((p, q) => p.t - q.t)) if (c && fin(c.t) && c.t > lastT) have.push(c);
    const cap = max > 0 ? max : 240;
    return have.length > cap ? have.slice(have.length - cap) : have;
  };
  /** Colour for a side at a brightness: bids teal, asks rose; alpha rises with brightness. */
  H.colorFor = function (kind, a) {
    const v = clamp(a, 0, 1);
    if (kind === 'bid') return 'rgba(' + Math.round(20 + 40 * v) + ',' + Math.round(120 + 120 * v) + ',' + Math.round(110 + 90 * v) + ',' + (0.12 + 0.78 * v).toFixed(3) + ')';
    return 'rgba(' + Math.round(150 + 105 * v) + ',' + Math.round(50 + 60 * v) + ',' + Math.round(90 + 60 * v) + ',' + (0.12 + 0.78 * v).toFixed(3) + ')';
  };
  /** Chart intervals the map is drawn on, with their length in ms. */
  H.TF_MS = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '10m': 600_000, '15m': 900_000, '30m': 1_800_000 };

  if (typeof module === 'object' && module.exports) module.exports = H;
  if (typeof window !== 'undefined') window.SmlHeatmap = H;
  if (typeof document === 'undefined' || !document.getElementById || window.__smlHeatmap) return;
  const chartCanvas = document.getElementById('chart'), toolbar = document.querySelector('.toolbar');
  if (!chartCanvas || !toolbar) return;
  window.__smlHeatmap = true;

  const KEY = 'sml-heatmap-v1';
  const S = { on: false, sym: '', cols: [], ref: 1, tick: 0.01, everyMs: 5000, busy: false, err: '', note: '', hover: null, off: null, offKey: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };
  const q = () => new URLSearchParams(location.search);
  const sym = () => String(q().get('symbol') || 'SPY').toUpperCase();
  const tf = () => String(q().get('tf') || '5m');

  const style = document.createElement('style');
  style.textContent = '#heat-layer{position:absolute;pointer-events:none;z-index:3;background:transparent;border:0;border-radius:0;min-height:0;max-width:none;mix-blend-mode:screen}'
    + '#heat-toggle.on{background:#4a2a5a;border-color:#d08cff;color:#fff}';
  document.head.appendChild(style);
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'heat-toggle'; btn.className = 'depth-toggle'; btn.textContent = 'HEAT'; btn.title = 'Order-book heat map: where liquidity sat over the last twenty minutes (intraday charts)'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'heat-layer'; const ctx = layer.getContext('2d');

  async function poll() {
    if (!S.on || S.busy || document.hidden) return;
    const s = sym();
    if (s !== S.sym) { S.sym = s; S.cols = []; S.offKey = ''; }
    S.busy = true;
    try {
      const since = S.cols.length ? S.cols[S.cols.length - 1].t : 0;
      const r = await fetch('/academy-activity/heatmap?symbol=' + encodeURIComponent(s) + (since ? '&since=' + since : ''), { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok || !d || sym() !== s) { S.err = d && d.error === 'orderflow_disabled' ? 'The order-flow service is off.' : S.cols.length ? '' : 'Heat map not available right now.'; return; }
      if (d.tick) S.tick = d.tick; if (d.everyMs) S.everyMs = d.everyMs;
      if (!since && d.total && d.columns.length < d.total) S.cols = []; // a fresh full answer replaces whatever was held
      S.cols = H.mergeColumns(S.cols, d.columns, d.maxColumns || 240);
      S.ref = H.heatScale(S.cols);
      S.err = ''; S.note = !d.ready ? (d.closed ? 'No live book while the market is closed.' : 'Collecting the book: the first column lands in a few seconds.') : '';
    } catch (_) { if (!S.cols.length) S.err = 'Heat map not available right now.'; }
    finally { S.busy = false; S.offKey = ''; draw(); }
  }

  /* the heat itself is rendered once per (data, view) into an offscreen canvas; the on-screen draw composites it and adds the hover readout */
  function renderHeat(M, w, h, dpr) {
    const key = [S.cols.length, S.cols.length ? S.cols[S.cols.length - 1].t : 0, M.start, M.end, M.lo, M.hi, w, h, dpr].join('|');
    if (S.off && S.offKey === key) return S.off;
    const off = S.off && S.off.width === Math.round(w * dpr) && S.off.height === Math.round(h * dpr) ? S.off : document.createElement('canvas');
    off.width = Math.round(w * dpr); off.height = Math.round(h * dpr);
    const c = off.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const pad = M.pad, right = pad.l + M.pw, top = pad.t, bottom = M.priceBottom || (pad.t + M.ph);
    c.save(); c.beginPath(); c.rect(pad.l, top, M.pw, bottom - top); c.clip();
    const pxPerTick = Math.abs(M.y(M.lo) - M.y(M.lo + S.tick));
    const ticksPerRow = Math.max(1, Math.ceil(2 / Math.max(pxPerTick, 1e-6)));
    const binPrice = S.tick * ticksPerRow;
    const colW = Math.max(1.5, (S.everyMs / (M.dt || 60_000)) * M.step);
    const mids = [];
    for (const col of S.cols) {
      const xi = M.idxOfTime(col.t); if (!fin(xi)) continue;
      const x = M.x(xi) - colW / 2;
      if (x + colW < pad.l || x > right) continue;
      const bins = H.binColumn(col, binPrice);
      for (const [k, v] of bins) {
        const p = k * binPrice; if (p < M.lo || p > M.hi) continue;
        const y1 = M.y(p + binPrice / 2), y2 = M.y(p - binPrice / 2), hh = Math.max(1, y2 - y1);
        if (v.bid > 0) { c.fillStyle = H.colorFor('bid', H.intensity(v.bid, S.ref)); c.fillRect(x, y1, colW + 0.5, hh); }
        if (v.ask > 0) { c.fillStyle = H.colorFor('ask', H.intensity(v.ask, S.ref)); c.fillRect(x, y1, colW + 0.5, hh); }
      }
      if (col.b.length && col.a.length) mids.push([x + colW / 2, M.y((col.b[0][0] + col.a[0][0]) / 2)]);
    }
    if (mids.length > 1) { c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.2; c.beginPath(); mids.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); }
    c.restore();
    S.off = off; S.offKey = key;
    return off;
  }

  function legend(w) {
    const x = (window.smlChartModel().pad.l) + 8, y = window.smlChartModel().pad.t + 8, gw = 90;
    ctx.font = '800 9px ui-monospace,monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8,16,24,.82)'; ctx.fillRect(x - 4, y - 4, gw + 118, 22);
    for (let i = 0; i < gw; i++) { const a = i / gw; ctx.fillStyle = H.colorFor(i % 2 ? 'bid' : 'ask', a); ctx.fillRect(x + i, y + 2, 1, 10); }
    ctx.fillStyle = '#b9c8d1'; ctx.fillText('RESTING SIZE  dim → ' + Math.round(S.ref).toLocaleString() + '+', x + gw + 6, y + 7);
    void w;
  }

  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const pad = M.pad;
    const msg = (text) => { ctx.font = '700 10.5px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; const tw = ctx.measureText(text).width + 14; ctx.fillStyle = 'rgba(8,16,24,.86)'; ctx.fillRect(pad.l + 6, pad.t + 30, tw, 20); ctx.fillStyle = '#d08cff'; ctx.fillText(text, pad.l + 13, pad.t + 44); };
    if (!H.TF_MS[M.tf || tf()]) { msg('HEAT MAP · shows on 1m to 30m charts (twenty minutes of book is one candle here)'); return; }
    if (S.err) { msg('HEAT MAP · ' + S.err); return; }
    if (!S.cols.length) { msg('HEAT MAP · ' + (S.note || 'collecting the book…')); return; }
    const off = renderHeat(M, w, h, dpr);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore();
    legend(w);
    if (S.hover) {
      const { px, py } = S.hover;
      const t = M.timeOfIdx(M.idxAt(px)), price = M.priceAt(py);
      let best = null; for (const c of S.cols) if (!best || Math.abs(c.t - t) < Math.abs(best.t - t)) best = c;
      if (best && Math.abs(best.t - t) <= S.everyMs * 1.5) {
        const near = (levels) => { let b = null; for (const l of levels) if (!b || Math.abs(l[0] - price) < Math.abs(b[0] - price)) b = l; return b && Math.abs(b[0] - price) <= S.tick * 1.5 ? b : null; };
        const bl = near(best.b), al = near(best.a);
        const when = new Date(best.t).toLocaleTimeString('en-US', { hour12: false });
        const text = when + ' · ' + price.toFixed(2) + (bl ? ' · BID ' + Math.round(bl[1]).toLocaleString() : '') + (al ? ' · ASK ' + Math.round(al[1]).toLocaleString() : '') + (!bl && !al ? ' · no resting size here' : '');
        ctx.font = '800 10px ui-monospace,monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const tw = ctx.measureText(text).width + 12, bx = Math.min(px + 12, pad.l + M.pw - tw), by = clamp(py - 20, pad.t + 2, pad.t + M.ph - 20);
        ctx.fillStyle = 'rgba(8,16,24,.92)'; ctx.fillRect(bx, by, tw, 18); ctx.strokeStyle = '#d08cff'; ctx.strokeRect(bx + .5, by + .5, tw - 1, 17);
        ctx.fillStyle = bl && !al ? '#5df0b0' : al && !bl ? '#ff8ea1' : '#e4d8ff'; ctx.fillText(text, bx + 6, by + 9);
      }
    }
  }

  const stage = chartCanvas.parentElement || document;
  stage.addEventListener('mousemove', (e) => { if (!S.on || !S.cols.length) return; const r = chartCanvas.getBoundingClientRect(); S.hover = { px: e.clientX - r.left, py: e.clientY - r.top }; if (!window.smlChartGesture) draw(); }, { passive: true });
  stage.addEventListener('mouseleave', () => { if (S.hover) { S.hover = null; draw(); } }, { passive: true });
  btn.addEventListener('click', () => { S.on = !S.on; save(); btn.classList.toggle('on', S.on); S.offKey = ''; draw(); if (S.on) poll(); });
  btn.classList.toggle('on', S.on);
  window.addEventListener('sml-chart-view', () => { if (S.on && !window.smlChartGesture) draw(); });
  window.addEventListener('resize', () => { S.offKey = ''; draw(); });
  window.addEventListener('sml-academy-market', () => { S.cols = []; S.offKey = ''; S.hover = null; if (S.on) setTimeout(poll, 300); });
  setInterval(poll, 5000);
  draw(); if (S.on) poll();
})();
