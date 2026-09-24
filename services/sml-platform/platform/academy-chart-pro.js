/* Chart Pro for the Academy Live Chart Lab: one shared view model (window.smlChartModel) that every layer draws from, plus the mechanics traders expect:
   drag the chart to scan left/right, grab the price axis to scale up/down, grab the time axis to zoom, pull the chart left to open empty space in front of the last candle,
   wheel / pinch zoom, keyboard, a crosshair with an OHLC readout, drawing tools (saved per symbol) and the pattern scanner (window.SmlPatterns).
   The older overlays (chart types, indicators, MEM ALGO) read the model instead of guessing the geometry, so everything stays aligned while the view moves. */
(function boot(tries) {
  const stage = document.querySelector('.academy-chart-stage');
  const baseCanvas = document.getElementById('chart');
  if (window.__smlChartPro) return;
  if (!stage || !baseCanvas || typeof window.smlAcademyChartState !== 'function') { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; } // the chart stage is built by a script that loads after this one
  window.__smlChartPro = true;

  const PAD = { l: 12, r: 64, t: 18, b: 24 };
  const DEFAULT_N = 105, MIN_N = 8;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fin = Number.isFinite;
  const q = () => new URLSearchParams(location.search);
  const tfNow = () => q().get('tf') || '5m';
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const baseState = window.smlAcademyChartState;
  const symNow = () => { try { return String(baseState().symbol || q().get('symbol') || 'SPY').toUpperCase(); } catch (_) { return String(q().get('symbol') || 'SPY').toUpperCase(); } };
  const rawBars = () => { try { const b = baseState().bars; return Array.isArray(b) ? b : []; } catch (_) { return []; } };

  const V = { n: DEFAULT_N, end: null, manual: null, key: '', lastN: 0, tool: 'cursor', magnet: true, crosshair: null, draft: null, selected: null, hover: null, patterns: false, patternFilter: { candles: true, charts: true, levels: true }, patternFocus: null };

  /* ---------- view model ---------- */
  let cache = null, cacheKey = '';
  function dtOf(bars) { const n = bars.length; if (n < 2) return 60000; const d = []; for (let i = Math.max(1, n - 60); i < n; i++) { const x = bars[i].t - bars[i - 1].t; if (x > 0) d.push(x); } d.sort((a, b) => a - b); return d.length ? d[Math.floor(d.length / 2)] : 60000; }
  function syncKey(bars) {
    const key = symNow() + ':' + tfNow();
    if (key !== V.key) { V.key = key; V.n = DEFAULT_N; V.end = null; V.manual = null; V.lastN = bars.length; V.selected = null; V.draft = null; V.patternFocus = null; loadDrawings(); return; }
    if (bars.length !== V.lastN) { // live update: stay glued to the live edge if the trader was there
      if (V.end != null && V.lastN && V.end >= V.lastN) V.end += bars.length - V.lastN;
      V.lastN = bars.length;
    }
  }
  function model() {
    const bars = rawBars(), N = bars.length, w = stage.clientWidth, h = stage.clientHeight;
    if (!N || !w || !h) return null;
    syncKey(bars);
    const n = Math.round(clamp(V.n, Math.min(MIN_N, N), N));
    V.n = n;
    const maxFuture = Math.floor(n * 0.9);
    const end = Math.round(clamp(V.end == null ? N + Math.max(3, Math.round(n * 0.05)) : V.end, n, N + maxFuture));
    if (V.end != null) V.end = end;
    const start = end - n;
    const last = bars[N - 1];
    const ck = [N, last && last.t, last && last.c, last && last.h, last && last.l, n, end, w, h, V.manual ? V.manual.lo + ':' + V.manual.hi : 'a'].join('|');
    if (cache && ck === cacheKey) return cache;
    const view = bars.slice(Math.max(0, start), Math.min(N, end));
    let lo = Infinity, hi = -Infinity;
    for (const b of view) { if (+b.l < lo) lo = +b.l; if (+b.h > hi) hi = +b.h; }
    if (!fin(lo) || !fin(hi)) { lo = 0; hi = 1; }
    if (hi === lo) { hi += 1; lo -= 1; }
    const autoLo = lo, autoHi = hi, mg = (hi - lo) * 0.06;
    lo -= mg; hi += mg;
    if (V.manual) { lo = V.manual.lo; hi = V.manual.hi; }
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b, step = pw / n, dt = dtOf(bars);
    const m = {
      bars, N, start, end, slots: n, view, lo, hi, autoLo, autoHi, manual: !!V.manual, pad: PAD, w, h, pw, ph, step, dt, tf: tfNow(), symbol: symNow(),
      x: (i) => PAD.l + (i - start + 0.5) * step,
      y: (p) => PAD.t + (hi - p) / (hi - lo) * ph,
      idxAt: (px) => (px - PAD.l) / step + start - 0.5,
      priceAt: (py) => hi - (py - PAD.t) / ph * (hi - lo),
      idxOfTime: (t) => idxOfTime(bars, dt, t),
      timeOfIdx: (i) => timeOfIdx(bars, dt, i)
    };
    cache = m; cacheKey = ck;
    return m;
  }
  function idxOfTime(bars, dt, t) {
    const N = bars.length; if (!N) return 0;
    if (t <= bars[0].t) return (t - bars[0].t) / dt;
    if (t >= bars[N - 1].t) return N - 1 + (t - bars[N - 1].t) / dt;
    let a = 0, b = N - 1; while (b - a > 1) { const mid = (a + b) >> 1; if (bars[mid].t <= t) a = mid; else b = mid; }
    return a + (t - bars[a].t) / Math.max(1, bars[b].t - bars[a].t);
  }
  function timeOfIdx(bars, dt, i) {
    const N = bars.length; if (!N) return 0;
    if (i <= 0) return bars[0].t + i * dt;
    if (i >= N - 1) return bars[N - 1].t + (i - (N - 1)) * dt;
    const a = Math.floor(i); return bars[a].t + (i - a) * (bars[a + 1].t - bars[a].t);
  }

  let raf = 0;
  function emit() { cache = null; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new Event('sml-chart-view')); drawPro(); }); }
  window.smlChartModel = model;
  window.smlAcademyChartState = () => {
    const s = baseState(), m = model();
    return m ? Object.assign({}, s, { offset: Math.max(0, m.N - m.end), scale: DEFAULT_N / m.slots, slots: m.slots, start: m.start, end: m.end, lo: m.lo, hi: m.hi }) : s;
  };
  const baseApply = window.smlAcademyApplyMarket;
  if (typeof baseApply === 'function') window.smlAcademyApplyMarket = (payload) => { const r = baseApply(payload); emit(); return r; };
  window.addEventListener('sml-academy-market', () => { patternsDirty = true; emit(); });

  /* ---------- view changes ---------- */
  const setView = (n, end) => { if (n != null) V.n = n; if (end != null) V.end = end; emit(); };
  function zoomX(factor, anchorIdx, m) {
    const nNew = clamp(Math.round(m.slots * factor), Math.min(MIN_N, m.N), m.N);
    if (anchorIdx == null) { setView(nNew, m.end); return; }
    const rel = (anchorIdx - m.start) / m.slots, startNew = anchorIdx - rel * nNew;
    setView(nNew, Math.round(startNew + nNew));
  }
  function zoomY(factor, anchorPrice, m) {
    const range = (m.hi - m.lo) * factor, p = anchorPrice == null ? (m.hi + m.lo) / 2 : anchorPrice;
    if (!(range > 1e-6)) return;
    const lo = p - (p - m.lo) * factor, hi = p + (m.hi - p) * factor;
    V.manual = { lo, hi }; emit();
  }
  const resetView = () => { V.n = DEFAULT_N; V.end = null; V.manual = null; emit(); };
  const goLatest = () => { const m = model(); if (m) { V.end = null; emit(); } };

  /* ---------- drawings ---------- */
  const DKEY = 'sml-chart-draw-v1';
  let drawings = [], undo = [];
  const uid = () => Math.random().toString(36).slice(2, 9);
  function loadDrawings() { try { const all = JSON.parse(localStorage.getItem(DKEY) || '{}'); drawings = Array.isArray(all[symNow()]) ? all[symNow()] : []; } catch (_) { drawings = []; } undo = []; }
  function saveDrawings() { try { const all = JSON.parse(localStorage.getItem(DKEY) || '{}'); all[symNow()] = drawings.filter((d) => d.type !== 'measure'); localStorage.setItem(DKEY, JSON.stringify(all)); } catch (_) { /* ignore */ } }
  const snapshot = () => { undo.push(JSON.stringify(drawings)); if (undo.length > 40) undo.shift(); };
  const TOOLS = [['cursor', 'Cursor', 0], ['trend', 'Trend line', 2], ['ray', 'Ray', 2], ['hline', 'Horizontal line', 1], ['vline', 'Vertical line', 1], ['rect', 'Box', 2], ['fib', 'Fib retracement', 2], ['measure', 'Measure', 2], ['text', 'Note', 1], ['range', 'Interval stats', 0]];
  const need = (t) => (TOOLS.find((x) => x[0] === t) || [0, 0, 0])[2];
  let color = '#ffd166';

  function pointAt(m, x, y, snap) {
    let idx = m.idxAt(x), price = m.priceAt(y);
    if (snap && V.magnet) {
      const i = Math.round(idx);
      if (i >= 0 && i < m.N) {
        const b = m.bars[i], px = m.x(i);
        let best = null;
        for (const p of [b.o, b.h, b.l, b.c]) { const d = Math.abs(m.y(+p) - y); if (d < 14 && (!best || d < best.d)) best = { d, p: +p }; }
        if (best && Math.abs(px - x) < m.step * 0.7 + 6) { idx = i; price = best.p; }
      }
    }
    return { t: Math.round(m.timeOfIdx(idx)), p: price };
  }
  const toPx = (m, pt) => ({ x: m.x(m.idxOfTime(pt.t)), y: m.y(pt.p) });
  function distSeg(px, py, a, b) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0; t = clamp(t, 0, 1); return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)); }
  function hit(m, x, y) {
    let best = null;
    for (let k = drawings.length - 1; k >= 0; k--) {
      const d = drawings[k], P = d.pts.map((p) => toPx(m, p)); let dist = 1e9;
      if (d.type === 'trend' || d.type === 'measure') dist = distSeg(x, y, P[0], P[1]);
      else if (d.type === 'ray') { const dx = P[1].x - P[0].x, dy = P[1].y - P[0].y, L = Math.hypot(dx, dy) || 1, far = { x: P[0].x + dx / L * 5000, y: P[0].y + dy / L * 5000 }; dist = distSeg(x, y, P[0], far); }
      else if (d.type === 'hline') dist = Math.abs(y - P[0].y);
      else if (d.type === 'vline') dist = Math.abs(x - P[0].x);
      else if (d.type === 'rect' || d.type === 'fib') { const x1 = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x), y1 = Math.min(P[0].y, P[1].y), y2 = Math.max(P[0].y, P[1].y); dist = Math.min(distSeg(x, y, { x: x1, y: y1 }, { x: x2, y: y1 }), distSeg(x, y, { x: x1, y: y2 }, { x: x2, y: y2 }), distSeg(x, y, { x: x1, y: y1 }, { x: x1, y: y2 }), distSeg(x, y, { x: x2, y: y1 }, { x: x2, y: y2 })); if (d.type === 'fib' && x >= x1 - 4 && x <= x2 + 4) for (const lv of FIB) { const yy = P[0].y + (P[1].y - P[0].y) * lv; dist = Math.min(dist, Math.abs(y - yy)); } }
      else if (d.type === 'text') dist = Math.hypot(x - P[0].x, y - P[0].y) - 10;
      if (dist < 7 && (!best || dist < best.dist)) best = { d, dist };
    }
    return best && best.d;
  }
  function anchorHit(m, d, x, y) { const P = d.pts.map((p) => toPx(m, p)); for (let i = 0; i < P.length; i++) if (Math.hypot(P[i].x - x, P[i].y - y) < 9) return i; return -1; }
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  /* ---------- pointer mechanics ---------- */
  const pointers = new Map();
  let D = null; // active drag
  const rel = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function zoneAt(m, x, y) { if (x > m.w - PAD.r) return 'yaxis'; if (y > m.h - PAD.b) return 'xaxis'; return 'plot'; }
  const uiTarget = (e) => e.target && e.target.closest && e.target.closest('.academy-pro-panel,.academy-pro-palette,.academy-interval-stats,#mem-algo-panel,button,input,select,textarea,a');
  stage.tabIndex = 0; stage.style.outline = 'none'; stage.style.touchAction = 'none';

  stage.addEventListener('pointerdown', (e) => {
    if (uiTarget(e)) return;
    const m = model(); if (!m) return;
    const { x, y } = rel(e), zone = zoneAt(m, x, y);
    pointers.set(e.pointerId, { x, y });
    stage.focus({ preventScroll: true });
    if (V.tool === 'range' && zone === 'plot') return; // interval stats keep their own drag
    e.preventDefault(); e.stopPropagation();
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; D = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, n0: m.slots, cx: (a.x + b.x) / 2, end0: m.end, m0: m }; return; }
    if (zone === 'yaxis') { D = { mode: 'yscale', y0: y, lo0: m.lo, hi0: m.hi, p0: m.priceAt(y), clickAt: Date.now() }; return; }
    if (zone === 'xaxis') { D = { mode: 'xscale', x0: x, n0: m.slots, end0: m.end, clickAt: Date.now() }; return; }
    const need_ = need(V.tool);
    if (need_) { // drawing
      const pt = pointAt(m, x, y, true);
      if (V.draft && V.draft.armed) { V.draft.pts[1] = pt; commitDraft(); return; }
      if (need_ === 1) { snapshot(); const d = { id: uid(), type: V.tool, pts: [pt], color }; if (V.tool === 'text') { let s = ''; try { s = window.prompt('Note text', '') || ''; } catch (_) { /* ignore */ } d.text = s.slice(0, 80) || 'Note'; } drawings.push(d); V.selected = d.id; saveDrawings(); V.tool = 'cursor'; syncPalette(); emit(); return; }
      V.draft = { id: uid(), type: V.tool, pts: [pt, pt], color, armed: false, x0: x, y0: y };
      D = { mode: 'draw' }; emit(); return;
    }
    // cursor: select / move drawings, otherwise pan
    const sel = drawings.find((d) => d.id === V.selected);
    if (sel) { const ai = anchorHit(m, sel, x, y); if (ai >= 0) { snapshot(); D = { mode: 'anchor', id: sel.id, ai }; return; } }
    const h = hit(m, x, y);
    if (h) { V.selected = h.id; snapshot(); D = { mode: 'move', id: h.id, last: pointAt(m, x, y, false), moved: false }; emit(); return; }
    if (V.selected) { V.selected = null; emit(); }
    D = { mode: 'pan', x0: x, y0: y, end0: m.end, lo0: m.lo, hi0: m.hi, step: m.step, ph: m.ph };
  }, true);

  stage.addEventListener('pointermove', (e) => {
    const m = model(); if (!m) return;
    const { x, y } = rel(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (!D) { V.crosshair = { x, y }; setCursor(m, x, y, e); emit(); return; }
    V.crosshair = { x, y };
    if (D.mode === 'pinch') { if (pointers.size >= 2) { const [a, b] = [...pointers.values()]; const f = D.d0 / (Math.hypot(a.x - b.x, a.y - b.y) || 1), nNew = clamp(Math.round(D.n0 * f), Math.min(MIN_N, m.N), m.N), c = D.m0.idxAt(D.cx), relp = (c - D.m0.start) / D.m0.slots; setView(nNew, Math.round(c - relp * nNew + nNew)); } return; }
    if (D.mode === 'pan') { const dx = x - D.x0; const end = D.end0 - dx / D.step; V.end = end; if (V.manual) { const dp = (y - D.y0) / D.ph * (D.hi0 - D.lo0); V.manual = { lo: D.lo0 + dp, hi: D.hi0 + dp }; } emit(); return; }
    if (D.mode === 'yscale') { const f = Math.exp((y - D.y0) / 220); const range = (D.hi0 - D.lo0) * f; if (range > 1e-6 && range < (D.hi0 - D.lo0) * 60) { V.manual = { lo: D.p0 - (D.p0 - D.lo0) * f, hi: D.p0 + (D.hi0 - D.p0) * f }; emit(); } return; }
    if (D.mode === 'xscale') { const nNew = clamp(Math.round(D.n0 * Math.exp(-(x - D.x0) / 220)), Math.min(MIN_N, m.N), m.N); setView(nNew, D.end0); return; }
    if (D.mode === 'draw' && V.draft) { V.draft.pts[1] = pointAt(m, x, y, true); if (Math.hypot(x - V.draft.x0, y - V.draft.y0) > 5) V.draft.moved = true; emit(); return; }
    if (D.mode === 'anchor') { const d = drawings.find((k) => k.id === D.id); if (d) { d.pts[D.ai] = pointAt(m, x, y, true); emit(); } return; }
    if (D.mode === 'move') { const d = drawings.find((k) => k.id === D.id); if (!d) return; const now = pointAt(m, x, y, false), dt = now.t - D.last.t, dp = now.p - D.last.p; d.pts = d.pts.map((p) => ({ t: p.t + dt, p: p.p + dp })); D.last = now; D.moved = true; emit(); }
  });

  function endDrag(e) {
    pointers.delete(e.pointerId);
    if (!D) return;
    const mode = D.mode;
    if (mode === 'draw' && V.draft) { if (V.draft.moved) commitDraft(); else V.draft.armed = true; }
    if ((mode === 'anchor' || mode === 'move')) { saveDrawings(); }
    if (mode === 'xscale' && Date.now() - D.clickAt < 250 && Math.abs((rel(e).x) - D.x0) < 3) resetView();
    if (mode === 'yscale' && Date.now() - D.clickAt < 250 && Math.abs((rel(e).y) - D.y0) < 3) { const now = Date.now(); if (V.lastAxisClick && now - V.lastAxisClick < 350) { V.manual = null; emit(); } V.lastAxisClick = now; }
    if (mode === 'pinch' && pointers.size) return;
    D = null;
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => { if (!D) { V.crosshair = null; emit(); } });
  stage.addEventListener('dblclick', (e) => { if (uiTarget(e)) return; const m = model(); if (!m) return; const { x, y } = rel(e), z = zoneAt(m, x, y); if (z === 'yaxis') { V.manual = null; emit(); } else if (z === 'xaxis') resetView(); });

  function commitDraft() {
    const d = V.draft; V.draft = null; D = null; if (!d) return;
    if (d.type !== 'measure') snapshot();
    const item = { id: d.id, type: d.type, pts: d.pts, color: d.color };
    drawings.push(item); V.selected = d.type === 'measure' ? null : d.id;
    if (d.type === 'measure') { V.measure = item; setTimeout(() => { drawings = drawings.filter((k) => k.id !== item.id); emit(); }, 6000); } else saveDrawings();
    if (!V.lockTool) V.tool = 'cursor';
    syncPalette(); emit();
  }

  stage.addEventListener('wheel', (e) => {
    if (uiTarget(e)) return;
    const m = model(); if (!m) return;
    e.preventDefault();
    const { x, y } = rel(e), zone = zoneAt(m, x, y);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / m.step; setView(null, m.end + d); return; }
    const f = Math.exp(clamp(e.deltaY, -120, 120) * 0.0016);
    if (zone === 'yaxis') zoomY(f, m.priceAt(y), m);
    else if (e.ctrlKey && V.manual) zoomY(f, m.priceAt(y), m);
    else zoomX(f, m.idxAt(Math.max(PAD.l, Math.min(m.w - PAD.r, x))), m);
  }, { passive: false });

  stage.addEventListener('keydown', (e) => {
    if (uiTarget(e) && e.target.tagName === 'INPUT') return;
    const m = model(); if (!m) return; let used = true;
    if (e.key === 'ArrowLeft') setView(null, m.end - (e.shiftKey ? 25 : 5));
    else if (e.key === 'ArrowRight') setView(null, m.end + (e.shiftKey ? 25 : 5));
    else if (e.key === '+' || e.key === '=') zoomX(0.8, null, m);
    else if (e.key === '-' || e.key === '_') zoomX(1.25, null, m);
    else if (e.key === 'Home') setView(null, m.slots);
    else if (e.key === 'End') goLatest();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    else if (e.key === 'Escape') { V.draft = null; V.tool = 'cursor'; D = null; syncPalette(); emit(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undoLast();
    else used = false;
    if (used) e.preventDefault();
  });

  function setCursor(m, x, y, e) {
    let c = 'crosshair';
    const zone = zoneAt(m, x, y);
    if (zone === 'yaxis') c = 'ns-resize'; else if (zone === 'xaxis') c = 'ew-resize';
    else if (V.tool === 'cursor') { c = hit(m, x, y) ? 'pointer' : (x > PAD.l + m.step * m.slots ? 'grab' : 'grab'); }
    else if (V.tool === 'range') c = 'col-resize';
    stage.style.cursor = c;
  }
  function deleteSelected() { if (!V.selected) return; snapshot(); drawings = drawings.filter((d) => d.id !== V.selected); V.selected = null; saveDrawings(); emit(); }
  function undoLast() { if (!undo.length) return; try { drawings = JSON.parse(undo.pop()); } catch (_) { return; } V.selected = null; saveDrawings(); emit(); }
  function clearAll() { if (!drawings.length) return; snapshot(); drawings = []; V.selected = null; saveDrawings(); emit(); }

  /* ---------- pro layer (crosshair, drawings, patterns) ---------- */
  const layer = document.createElement('canvas');
  layer.className = 'academy-pro-layer';
  stage.appendChild(layer);
  const lctx = layer.getContext('2d');
  const styleEl = document.createElement('style');
  styleEl.textContent = '.chart .academy-pro-layer{position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;pointer-events:none;background:transparent;border:0;min-height:0;max-width:none}'
    + '.academy-pro-palette{position:absolute;left:8px;right:72px;top:22px;z-index:7;display:none;flex-direction:row;flex-wrap:wrap;align-items:center;gap:3px;padding:5px;background:rgba(8,18,26,.94);border:1px solid #2b5362;border-radius:8px}.academy-pro-palette.open{display:flex}'
    + '.academy-pro-palette button{height:24px;border:1px solid #2b5362;border-radius:5px;background:#10212b;color:#eaf5f8;padding:2px 7px;font:800 .6rem system-ui;text-align:left;cursor:pointer}.academy-pro-palette button.on{background:#00c47d;color:#042217}.academy-pro-palette hr{border:0;border-left:1px solid #244052;margin:0 2px;height:18px}.academy-pro-palette input[type=color]{width:34px;height:22px;padding:0;border:1px solid #2b5362;background:#10212b;border-radius:5px}'
    + '.academy-pro-panel{position:absolute;left:8px;bottom:30px;z-index:7;width:min(262px,58%);max-height:56%;display:none;flex-direction:column;background:rgba(7,16,24,.95);border:1px solid #2b5362;border-radius:8px;color:#dcebf4;font:600 .64rem system-ui}.academy-pro-panel.open{display:flex}'
    + '.academy-pro-panel header{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #244052;font:800 .6rem ui-monospace;color:#8ee8c1;flex-wrap:wrap}.academy-pro-panel header label{color:#a6bcc8;font-weight:700;display:flex;gap:3px;align-items:center;cursor:pointer}.academy-pro-panel .plist{overflow:auto;padding:4px}'
    + '.academy-pro-panel .pit{display:block;width:100%;text-align:left;border:1px solid #1d3a48;background:#0b1a24;color:#dcebf4;border-radius:6px;padding:5px 7px;margin:0 0 4px;cursor:pointer;font:inherit}.academy-pro-panel .pit:hover,.academy-pro-panel .pit.on{border-color:#42f5b3}.academy-pro-panel .pit b{font-weight:800}.academy-pro-panel .pit small{display:block;color:#8ba2af;font-weight:600;margin-top:2px}'
    + '.academy-pro-panel .chip{display:inline-block;padding:1px 5px;border-radius:9px;font:800 .54rem ui-monospace;margin-left:4px}.academy-pro-panel .chip.bull{background:#0d3a2b;color:#5df0b0}.academy-pro-panel .chip.bear{background:#40151d;color:#ff8ea1}.academy-pro-panel .chip.neutral{background:#26343d;color:#c5d3db}'
    + '.academy-pro-panel .foot{padding:5px 8px;border-top:1px solid #244052;color:#7f97a4;font-weight:600;font-size:.56rem}';
  document.head.appendChild(styleEl);

  const timeLabel = (t, tf) => {
    const d = new Date(t);
    if (/^(1W|1M|1Q|1Y)$/.test(tf)) return tf === '1Y' ? String(d.getFullYear()) : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    if (tf === '1D') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
  };
  const fullTime = (t, tf) => { const d = new Date(t); return /^(1D|1W|1M|1Q|1Y)$/.test(tf) ? d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false }); };
  const fmt = (v, d = 2) => (fin(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const compact = (v) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(v) || 0);

  function drawPro() {
    const m = model(), dpr = window.devicePixelRatio || 1, w = stage.clientWidth, h = stage.clientHeight;
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, h);
    if (!m) return;
    lctx.save(); lctx.beginPath(); lctx.rect(PAD.l, PAD.t, m.pw, m.ph); lctx.clip();
    if (V.patterns) drawPatterns(m);
    drawDrawings(m);
    lctx.restore();
    drawAxisTags(m);
    drawCrosshair(m);
    drawReadout(m);
  }

  function segPx(m, d) { return d.pts.map((p) => toPx(m, p)); }
  function drawDrawings(m) {
    const all = V.draft ? drawings.concat([V.draft]) : drawings;
    for (const d of all) {
      const P = segPx(m, d), sel = d.id === V.selected, c = d.color || '#ffd166';
      lctx.strokeStyle = c; lctx.fillStyle = c; lctx.lineWidth = sel ? 2.4 : 1.6; lctx.setLineDash([]);
      if (d.type === 'trend' || d.type === 'measure') { lctx.beginPath(); lctx.moveTo(P[0].x, P[0].y); lctx.lineTo(P[1].x, P[1].y); lctx.stroke(); }
      else if (d.type === 'ray') { const dx = P[1].x - P[0].x, dy = P[1].y - P[0].y, L = Math.hypot(dx, dy) || 1; lctx.beginPath(); lctx.moveTo(P[0].x, P[0].y); lctx.lineTo(P[0].x + dx / L * 6000, P[0].y + dy / L * 6000); lctx.stroke(); }
      else if (d.type === 'hline') { lctx.beginPath(); lctx.moveTo(PAD.l, P[0].y); lctx.lineTo(m.w - PAD.r, P[0].y); lctx.stroke(); }
      else if (d.type === 'vline') { lctx.beginPath(); lctx.moveTo(P[0].x, PAD.t); lctx.lineTo(P[0].x, m.h - PAD.b); lctx.stroke(); }
      else if (d.type === 'rect') { const x1 = Math.min(P[0].x, P[1].x), y1 = Math.min(P[0].y, P[1].y); lctx.globalAlpha = 0.14; lctx.fillRect(x1, y1, Math.abs(P[1].x - P[0].x), Math.abs(P[1].y - P[0].y)); lctx.globalAlpha = 1; lctx.strokeRect(x1, y1, Math.abs(P[1].x - P[0].x), Math.abs(P[1].y - P[0].y)); }
      else if (d.type === 'fib') {
        const x1 = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x), a = d.pts[0].p, b = d.pts[1].p;
        lctx.font = '700 9px ui-monospace,monospace'; lctx.textAlign = 'left';
        FIB.forEach((lv, i) => { const p = a + (b - a) * lv, yy = m.y(p); lctx.globalAlpha = 0.85; lctx.beginPath(); lctx.moveTo(x1, yy); lctx.lineTo(x2, yy); lctx.stroke(); lctx.globalAlpha = 1; lctx.fillText((lv * 100).toFixed(1) + '%  ' + fmt(p), x1 + 4, yy - 3); if (i) { const y0 = m.y(a + (b - a) * FIB[i - 1]); lctx.globalAlpha = 0.06 + (i % 2) * 0.05; lctx.fillRect(x1, Math.min(y0, yy), x2 - x1, Math.abs(yy - y0)); lctx.globalAlpha = 1; } });
        lctx.setLineDash([4, 4]); lctx.globalAlpha = 0.6; lctx.beginPath(); lctx.moveTo(P[0].x, P[0].y); lctx.lineTo(P[1].x, P[1].y); lctx.stroke(); lctx.setLineDash([]); lctx.globalAlpha = 1;
      }
      else if (d.type === 'text') { lctx.font = '800 11px system-ui'; lctx.textAlign = 'left'; const t = d.text || 'Note', tw = lctx.measureText(t).width; lctx.fillStyle = 'rgba(7,16,24,.85)'; lctx.fillRect(P[0].x - 3, P[0].y - 12, tw + 8, 17); lctx.fillStyle = c; lctx.fillText(t, P[0].x + 1, P[0].y + 1); }
      if (d.type === 'measure') {
        const a = d.pts[0], b = d.pts[1], dp = b.p - a.p, pc = a.p ? dp / a.p * 100 : 0, bars = Math.round(m.idxOfTime(b.t) - m.idxOfTime(a.t)), col = dp >= 0 ? '#00d084' : '#ff5470';
        const text = (dp >= 0 ? '+' : '') + fmt(dp) + ' (' + (pc >= 0 ? '+' : '') + pc.toFixed(2) + '%) · ' + bars + ' bars';
        lctx.font = '800 10px ui-monospace,monospace'; lctx.textAlign = 'left'; const tw = lctx.measureText(text).width, bx = (P[0].x + P[1].x) / 2 - tw / 2 - 5, by = Math.min(P[0].y, P[1].y) - 24;
        lctx.fillStyle = 'rgba(7,16,24,.92)'; lctx.fillRect(bx, by, tw + 10, 18); lctx.strokeStyle = col; lctx.strokeRect(bx, by, tw + 10, 18); lctx.fillStyle = col; lctx.fillText(text, bx + 5, by + 12);
      }
      if (sel) { lctx.fillStyle = '#0a1219'; lctx.strokeStyle = '#42f5b3'; lctx.lineWidth = 1.6; for (const p of P) { lctx.beginPath(); lctx.rect(p.x - 4, p.y - 4, 8, 8); lctx.fill(); lctx.stroke(); } }
    }
  }

  function drawAxisTags(m) {
    // time axis
    lctx.save(); lctx.font = '10px ui-monospace,monospace'; lctx.textAlign = 'center'; lctx.fillStyle = '#78919d';
    const minGap = 78; let lastX = -1e9, lastLabel = '';
    for (let i = Math.max(0, m.start); i < Math.min(m.N, m.end); i++) {
      const x = m.x(i); if (x - lastX < minGap || x < PAD.l + 20 || x > m.w - PAD.r - 20) continue;
      const lab = timeLabel(m.bars[i].t, m.tf); if (lab === lastLabel) continue;
      lctx.fillText(lab, x, m.h - 9); lctx.strokeStyle = 'rgba(116,153,170,.5)'; lctx.beginPath(); lctx.moveTo(x, m.h - PAD.b); lctx.lineTo(x, m.h - PAD.b + 3); lctx.stroke(); lastX = x; lastLabel = lab;
    }
    lctx.restore();
    // last price tag
    const lb = m.bars[m.N - 1]; if (lb) {
      const y = m.y(+lb.c), up = +lb.c >= +lb.o, c = up ? '#00d084' : '#ff5470';
      if (y > PAD.t - 6 && y < m.h - PAD.b + 6) {
        lctx.save(); lctx.strokeStyle = c; lctx.globalAlpha = 0.55; lctx.setLineDash([3, 4]); lctx.beginPath(); lctx.moveTo(PAD.l, y); lctx.lineTo(m.w - PAD.r, y); lctx.stroke(); lctx.restore();
        tag(m.w - PAD.r + 1, y, fmt(+lb.c), c, '#04140e');
      }
    }
    if (V.manual) { lctx.save(); lctx.font = '800 9px ui-monospace,monospace'; lctx.fillStyle = '#ffd166'; lctx.textAlign = 'right'; lctx.fillText('MANUAL SCALE · dbl-click axis for auto', m.w - PAD.r - 6, PAD.t + 10); lctx.restore(); }
    if (m.end < m.N - 1) { lctx.save(); lctx.font = '800 9px ui-monospace,monospace'; lctx.fillStyle = '#7fd4ff'; lctx.textAlign = 'right'; lctx.fillText('HISTORY · End key = latest', m.w - PAD.r - 6, PAD.t + (V.manual ? 22 : 10)); lctx.restore(); }
  }
  function tag(x, y, text, bg, fg) { lctx.save(); lctx.font = '700 10px ui-monospace,monospace'; const tw = lctx.measureText(text).width; lctx.fillStyle = bg; lctx.fillRect(x, y - 8, Math.min(tw + 8, PAD.r - 2), 16); lctx.fillStyle = fg; lctx.textAlign = 'left'; lctx.fillText(text, x + 4, y + 3.5); lctx.restore(); }

  function drawCrosshair(m) {
    const c = V.crosshair; if (!c || D && D.mode === 'pinch') return;
    if (c.x < PAD.l || c.x > m.w - PAD.r || c.y < PAD.t || c.y > m.h - PAD.b) return;
    lctx.save(); lctx.strokeStyle = 'rgba(190,215,228,.45)'; lctx.setLineDash([4, 4]); lctx.lineWidth = 1;
    lctx.beginPath(); lctx.moveTo(PAD.l, c.y); lctx.lineTo(m.w - PAD.r, c.y); lctx.moveTo(c.x, PAD.t); lctx.lineTo(c.x, m.h - PAD.b); lctx.stroke(); lctx.restore();
    tag(m.w - PAD.r + 1, c.y, fmt(m.priceAt(c.y)), '#284554', '#e8f4fa');
    const i = Math.round(m.idxAt(c.x)), t = m.timeOfIdx(i), text = fullTime(t, m.tf);
    lctx.save(); lctx.font = '700 10px ui-monospace,monospace'; const tw = lctx.measureText(text).width + 10, x = clamp(c.x - tw / 2, PAD.l, m.w - PAD.r - tw); lctx.fillStyle = '#284554'; lctx.fillRect(x, m.h - PAD.b + 1, tw, 16); lctx.fillStyle = '#e8f4fa'; lctx.textAlign = 'left'; lctx.fillText(text, x + 5, m.h - PAD.b + 12.5); lctx.restore();
  }
  function drawReadout(m) {
    const c = V.crosshair; let i = m.N - 1; if (c && c.x >= PAD.l && c.x <= m.w - PAD.r) i = clamp(Math.round(m.idxAt(c.x)), 0, m.N - 1);
    const b = m.bars[i]; if (!b) return; const prev = m.bars[i - 1], chg = prev ? (+b.c - +prev.c) / +prev.c * 100 : 0, up = +b.c >= +b.o;
    const parts = [['O', fmt(+b.o)], ['H', fmt(+b.h)], ['L', fmt(+b.l)], ['C', fmt(+b.c)], [(chg >= 0 ? '+' : '') + chg.toFixed(2) + '%', ''], ['V', compact(b.v)]];
    lctx.save(); lctx.font = '700 10px ui-monospace,monospace'; lctx.textAlign = 'left'; let x = PAD.l + 4; const y = PAD.t - 5;
    const head = m.symbol + ' · ' + m.tf + ' · '; lctx.fillStyle = '#a9bfcb'; lctx.fillText(head, x, y); x += lctx.measureText(head).width;
    for (const [k, v] of parts) { lctx.fillStyle = '#7f98a6'; lctx.fillText(k, x, y); x += lctx.measureText(k).width + 2; if (v) { lctx.fillStyle = up ? '#5df0b0' : '#ff8ea1'; lctx.fillText(v, x, y); x += lctx.measureText(v).width + 8; } else x += 8; }
    lctx.restore();
  }

  /* ---------- patterns ---------- */
  let patternsDirty = true, found = null, foundKey = '';
  function runPatterns(m) {
    const P = window.SmlPatterns; if (!P || !P.detect) return null;
    const key = m.symbol + ':' + m.tf + ':' + m.N + ':' + (m.bars[m.N - 1] && m.bars[m.N - 1].c);
    if (found && key === foundKey && !patternsDirty) return found;
    try { found = P.detect(m.bars.map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 }))); } catch (_) { found = null; }
    foundKey = key; patternsDirty = false; renderPatternPanel(m); return found;
  }
  const human = (n) => String(n || '').replace(/_/g, ' ').replace(/[a-z]/g, (c) => c.toUpperCase());
  const COL = { bull: '#00d084', bear: '#ff5470', neutral: '#ffd166' };
  const abbr = (name) => { const w = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean); if (w.length === 1) return w[0].slice(0, 3); return w.map((x) => (/^three$/i.test(x) ? '3' : /^bullish$|^bearish$/i.test(x) ? '' : x[0].toUpperCase())).join('').slice(0, 4) || 'P'; };
  function drawPatterns(m) {
    const r = runPatterns(m); if (!r || !r.ok) return;
    const F = V.patternFilter;
    if (F.levels) (r.levels || []).forEach((lv) => { const y = m.y(lv.p); if (y < PAD.t || y > m.h - PAD.b) return; const c = lv.kind === 'support' ? '0,208,132' : '255,84,112'; lctx.save(); lctx.strokeStyle = 'rgba(' + c + ',.5)'; lctx.setLineDash([2, 5]); lctx.lineWidth = 1; lctx.beginPath(); lctx.moveTo(Math.max(PAD.l, m.x(lv.firstIdx)), y); lctx.lineTo(m.w - PAD.r, y); lctx.stroke(); lctx.fillStyle = 'rgba(' + c + ',.9)'; lctx.font = '700 8px ui-monospace,monospace'; lctx.textAlign = 'right'; lctx.fillText((lv.kind === 'support' ? 'S ' : 'R ') + fmt(lv.p) + ' ×' + lv.touches, m.w - PAD.r - 4, y - 2); lctx.restore(); });
    if (F.charts) (r.charts || []).forEach((p, k) => {
      if (p.endIdx < m.start - 40 && p.status !== 'confirmed') return;
      const c = COL[p.dir] || COL.neutral, focus = V.patternFocus === 'c' + k;
      lctx.save(); lctx.strokeStyle = c; lctx.fillStyle = c; lctx.lineWidth = focus ? 2.6 : 1.5; lctx.globalAlpha = focus ? 1 : 0.85;
      (p.lines || []).forEach((l) => { lctx.setLineDash(l.role === 'target' || l.role === 'projection' ? [2, 4] : l.role === 'neckline' ? [7, 4] : []); lctx.beginPath(); lctx.moveTo(m.x(l.i1), m.y(l.p1)); lctx.lineTo(m.x(l.i2), m.y(l.p2)); lctx.stroke(); });
      lctx.setLineDash([]);
      const pts = p.points || [];
      if (pts.length > 1 && !(p.lines && p.lines.length > 2)) { lctx.globalAlpha = 0.5; lctx.beginPath(); pts.forEach((q2, j) => { const x = m.x(q2.i), y = m.y(q2.p); j ? lctx.lineTo(x, y) : lctx.moveTo(x, y); }); lctx.stroke(); lctx.globalAlpha = focus ? 1 : 0.85; }
      pts.forEach((q2) => { const x = m.x(q2.i), y = m.y(q2.p); lctx.beginPath(); lctx.arc(x, y, 3, 0, 6.3); lctx.fill(); if (q2.label) { lctx.font = '700 8px ui-monospace,monospace'; lctx.textAlign = 'center'; lctx.fillText(q2.label, x, y + (q2.label === 'H' || /top|head|shoulder|peak|high/i.test(q2.label) ? -7 : 12)); } });
      if (fin(p.target)) { const ty = m.y(p.target); lctx.setLineDash([3, 5]); lctx.globalAlpha = 0.6; lctx.beginPath(); lctx.moveTo(m.x(p.endIdx), ty); lctx.lineTo(m.w - PAD.r, ty); lctx.stroke(); lctx.setLineDash([]); lctx.font = '700 8px ui-monospace,monospace'; lctx.textAlign = 'right'; lctx.fillText('TARGET ' + fmt(p.target), m.w - PAD.r - 4, ty - 2); }
      lctx.globalAlpha = 1; lctx.font = '800 10px system-ui'; lctx.textAlign = 'left';
      const lx = clamp(m.x(p.startIdx), PAD.l + 2, m.w - PAD.r - 130), ly = clamp(m.y(Math.max(...(pts.length ? pts.map((q2) => q2.p) : [p.level || 0]))) - 12, PAD.t + 10, m.h - PAD.b - 6);
      const label = human(p.name) + ' · ' + p.status + ' ' + Math.round(p.confidence * 100) + '%', tw = lctx.measureText(label).width;
      lctx.fillStyle = 'rgba(7,16,24,.88)'; lctx.fillRect(lx - 3, ly - 10, tw + 8, 15); lctx.fillStyle = c; lctx.fillText(label, lx + 1, ly + 1);
      lctx.restore();
    });
    if (F.candles) {
      lctx.save(); lctx.font = '800 8px ui-monospace,monospace'; lctx.textAlign = 'center';
      const seen = {};
      (r.candles || []).forEach((cp) => {
        const j = cp.i, x = m.x(j); if (x < PAD.l || x > m.w - PAD.r) return;
        const bar = m.bars[j]; if (!bar) return;
        const up = cp.dir === 'bull', c = COL[cp.dir] || COL.neutral, y = up ? m.y(+bar.l) + 12 + (seen[j] || 0) : m.y(+bar.h) - 6 - (seen[j] || 0);
        seen[j] = (seen[j] || 0) + 10; lctx.fillStyle = c; lctx.fillText((up ? '▲' : cp.dir === 'bear' ? '▼' : '◆') + abbr(human(cp.name)), x, y);
      });
      lctx.restore();
    }
  }
  function renderPatternPanel(m) {
    const box = panel && panel.querySelector('.plist'); if (!box) return;
    const r = found; if (!r || !r.ok) { box.innerHTML = '<div style="padding:8px;color:#8ba2af">Not enough candles to scan this interval yet.</div>'; return; }
    const items = [];
    (r.charts || []).forEach((p, k) => items.push({ id: 'c' + k, idx: p.endIdx, title: human(p.name), dir: p.dir, sub: p.status + ' · ' + Math.round(p.confidence * 100) + '% · ' + (p.note || ''), kind: 'chart' }));
    (r.candles || []).slice(-40).forEach((p, k) => items.push({ id: 'k' + k, idx: p.i, title: human(p.name), dir: p.dir, sub: fullTime(p.t, m.tf) + (p.note ? ' · ' + p.note : ''), kind: 'candle' }));
    (r.levels || []).forEach((p, k) => items.push({ id: 'l' + k, idx: p.lastIdx, title: (p.kind === 'support' ? 'Support ' : 'Resistance ') + fmt(p.p), dir: p.kind === 'support' ? 'bull' : 'bear', sub: p.touches + ' touches', kind: 'level' }));
    (r.gaps || []).forEach((p, k) => items.push({ id: 'g' + k, idx: p.i, title: (p.dir === 'bull' ? 'Gap up' : 'Gap down') + (p.filled ? ' (filled)' : ' (open)'), dir: p.dir, sub: fmt(p.from) + ' → ' + fmt(p.to), kind: 'gap' }));
    items.sort((a, b) => b.idx - a.idx);
    const head = panel.querySelector('.pcount'); if (head) head.textContent = items.length + ' found · ' + m.tf;
    box.innerHTML = items.length ? items.map((it) => '<button type="button" class="pit" data-idx="' + it.idx + '" data-id="' + it.id + '"><b>' + esc(it.title) + '</b><span class="chip ' + esc(it.dir) + '">' + (it.dir === 'bull' ? 'BULLISH' : it.dir === 'bear' ? 'BEARISH' : 'NEUTRAL') + '</span><small>' + esc(it.sub) + '</small></button>').join('') : '<div style="padding:8px;color:#8ba2af">No qualifying patterns on these candles right now. That is a real result: the scanner only reports shapes that pass its numeric rules.</div>';
  }
  let panel = null, palette = null;
  function buildPanel() {
    panel = document.createElement('section'); panel.className = 'academy-pro-panel';
    panel.innerHTML = '<header><span>PATTERN SCANNER</span><span class="pcount"></span><label><input type="checkbox" data-f="charts" checked>Chart</label><label><input type="checkbox" data-f="candles" checked>Candles</label><label><input type="checkbox" data-f="levels" checked>S/R</label></header><div class="plist"></div><div class="foot">Rule-matched shapes on the candles loaded for this interval. Shapes describe what price did — they are not predictions. Confirm with your own plan.</div>';
    stage.appendChild(panel);
    panel.addEventListener('change', (e) => { const f = e.target && e.target.dataset && e.target.dataset.f; if (f) { V.patternFilter[f] = e.target.checked; emit(); } });
    panel.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.pit'); if (!b) return; const m = model(); if (!m) return; const idx = +b.dataset.idx; V.patternFocus = b.dataset.id; panel.querySelectorAll('.pit').forEach((x) => x.classList.toggle('on', x === b)); const n = m.slots; setView(null, Math.round(clamp(idx + n / 2, n, m.N + Math.floor(n * 0.9)))); });
    ['pointerdown', 'wheel'].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));
  }
  function buildPalette() {
    palette = document.createElement('div'); palette.className = 'academy-pro-palette';
    palette.innerHTML = TOOLS.map((t) => '<button type="button" data-tool="' + t[0] + '">' + t[1] + '</button>').join('') + '<hr><button type="button" data-act="magnet" class="on">Magnet: on</button><button type="button" data-act="lock">Keep tool: off</button><button type="button" data-act="undo">Undo</button><button type="button" data-act="delete">Delete selected</button><button type="button" data-act="clear">Clear all</button><input type="color" value="#ffd166" aria-label="Drawing color">';
    stage.appendChild(palette);
    palette.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) { V.tool = V.tool === b.dataset.tool && b.dataset.tool !== 'cursor' ? 'cursor' : b.dataset.tool; V.draft = null; }
      else if (b.dataset.act === 'magnet') { V.magnet = !V.magnet; }
      else if (b.dataset.act === 'lock') { V.lockTool = !V.lockTool; }
      else if (b.dataset.act === 'undo') undoLast();
      else if (b.dataset.act === 'delete') deleteSelected();
      else if (b.dataset.act === 'clear') clearAll();
      syncPalette(); emit();
    });
    palette.addEventListener('input', (e) => { if (e.target.type === 'color') { color = e.target.value; const d = drawings.find((k) => k.id === V.selected); if (d) { d.color = color; saveDrawings(); emit(); } } });
    ['pointerdown', 'wheel'].forEach((ev) => palette.addEventListener(ev, (e) => e.stopPropagation()));
  }
  function syncPalette() {
    if (!palette) return;
    palette.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === V.tool));
    const mg = palette.querySelector('[data-act=magnet]'); if (mg) { mg.classList.toggle('on', V.magnet); mg.textContent = 'Magnet: ' + (V.magnet ? 'on' : 'off'); }
    const lk = palette.querySelector('[data-act=lock]'); if (lk) { lk.classList.toggle('on', !!V.lockTool); lk.textContent = 'Keep tool: ' + (V.lockTool ? 'on' : 'off'); }
    const rb = document.getElementById('academy-select-range'); if (rb) rb.classList.toggle('on', V.tool === 'range');
    const db = document.getElementById('academy-pro-draw'); if (db) db.classList.toggle('on', palette.classList.contains('open'));
  }

  /* ---------- toolbar buttons (inside the existing chart tools row so the chart's grid rows never change) ---------- */
  function mountToolbar() {
    const row = document.querySelector('.academy-chart-tools'); if (!row || document.getElementById('academy-pro-draw')) return !!document.getElementById('academy-pro-draw');
    const mk = (id, text, title) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = text; b.title = title; return b; };
    const draw = mk('academy-pro-draw', 'Draw', 'Drawing tools: trend line, ray, lines, box, fib, measure, note'), pat = mk('academy-pro-patterns', 'Patterns', 'Scan the candles on this interval for every chart and candlestick pattern'), auto = mk('academy-pro-auto', 'Auto scale', 'Return the price scale to automatic'), live = mk('academy-pro-latest', 'Latest', 'Jump to the newest candle (End)'), fit = mk('academy-pro-reset', 'Reset view', 'Reset zoom and scale');
    const rangeBtn = document.getElementById('academy-select-range'); if (rangeBtn) { rangeBtn.textContent = 'Interval stats'; rangeBtn.classList.remove('on'); rangeBtn.onclick = () => { V.tool = V.tool === 'range' ? 'cursor' : 'range'; V.draft = null; syncPalette(); emit(); }; }
    const hint = row.querySelector('span'); if (hint) hint.textContent = 'Drag to scan · drag the price axis to scale · wheel to zoom';
    row.insertBefore(fit, hint || null); row.insertBefore(live, fit); row.insertBefore(auto, live); if (window.SmlPatterns && window.SmlPatterns.detect) row.insertBefore(pat, auto); row.insertBefore(draw, row.contains(pat) ? pat : auto);
    draw.onclick = () => { palette.classList.toggle('open'); syncPalette(); };
    pat.onclick = () => { V.patterns = !V.patterns; pat.classList.toggle('on', V.patterns); panel.classList.toggle('open', V.patterns); patternsDirty = true; try { localStorage.setItem('sml-chart-patterns', V.patterns ? '1' : '0'); } catch (_) { /* ignore */ } const m = model(); if (m && V.patterns) runPatterns(m); emit(); };
    auto.onclick = () => { V.manual = null; emit(); }; live.onclick = goLatest; fit.onclick = resetView;
    try { if (localStorage.getItem('sml-chart-patterns') === '1') { V.patterns = true; pat.classList.add('on'); panel.classList.add('open'); } } catch (_) { /* ignore */ }
    return true;
  }
  buildPanel(); buildPalette(); loadDrawings(); syncPalette();
  let mtTries = 0; const mt = setInterval(() => { if (mountToolbar() || ++mtTries > 40) clearInterval(mt); }, 250);
  new ResizeObserver(() => emit()).observe(stage);
  window.addEventListener('resize', emit);
  window.smlChartPro = { view: V, model, resetView, goLatest, drawings: () => drawings.slice(), setTool: (t) => { V.tool = t; syncPalette(); emit(); } };
  emit();
})(0);
