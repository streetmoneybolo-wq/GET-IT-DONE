/* MEM ALGO Scenarios: the panel cards and the chart layer. Loaded after academy-mem-algo-ui.js.
   The MEM ALGO panel asks this module for its "Scenarios" section (window.smlMemScenarios.sectionHtml) and hands it the clicks
   (window.smlMemScenarios.onClick). The chosen scenario is drawn on its own transparent canvas over the chart the way a finance
   professor draws it: the zones that matter, the levels in the way, a numbered price path from the entry into the projection
   area, the stop with the invalidation note, the scenario's title card and the member's own pick marked for the snapshot.
   Educational: a schematic of one possible route, never a forecast. */
(() => {
  const X = window.SmlMemScenarios, SM = window.SmlSmartMoney, PT = window.SmlPatterns, E = window.MemAlgoEngine;
  const chartCanvas = document.getElementById('chart');
  const host = chartCanvas && chartCanvas.parentElement;
  if (!X || !SM || !E || !chartCanvas || !host || window.__memScenariosUi) return;
  window.__memScenariosUi = true;

  const KEY = 'sml-mem-scn-v1';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const px = (v) => (Number.isFinite(v) ? (v >= 1 ? v.toFixed(2) : v.toFixed(4)) : '–');
  const S = { key: '', result: null, shown: null, picks: {}, busy: false, error: '', openCard: null };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.picks) S.picks = v.picks; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ picks: S.picks })); } catch (_) { /* ignore */ } };

  const css = document.createElement('style');
  css.textContent = `
#mem-scn-layer{position:absolute;pointer-events:none;z-index:6;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}
#mem-algo-panel .scn-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}
#mem-algo-panel .scn-head h5{margin:0}
#mem-algo-panel .scn-head em{font-style:normal;color:#52e6ad;font:700 .62rem ui-monospace,monospace;letter-spacing:.04em}
#mem-algo-panel .scn-intro{margin:0 0 8px;color:#9fb3be;font-size:.7rem;line-height:1.45}
#mem-algo-panel .scn{display:block;width:100%;margin:0 0 6px;padding:8px 9px;border:1px solid #17323d;border-radius:9px;background:#0a1118;color:#dbe6ec;text-align:left;cursor:pointer;font:inherit}
#mem-algo-panel .scn:hover{border-color:#2b5c4c}
#mem-algo-panel .scn.on{border-color:#ffd166;background:#1a1a0f;box-shadow:0 0 0 1px rgba(255,209,102,.35) inset}
#mem-algo-panel .scn .top{display:flex;align-items:center;gap:7px}
#mem-algo-panel .scn .rank{flex:none;width:20px;height:20px;border-radius:50%;background:#12362b;color:#3ef0a8;font:900 .66rem ui-monospace,monospace;display:grid;place-items:center}
#mem-algo-panel .scn.on .rank{background:#ffd166;color:#1a1300}
#mem-algo-panel .scn b{font:800 .74rem system-ui;color:#fff;flex:1;min-width:0}
#mem-algo-panel .scn .tag{font:800 .54rem ui-monospace,monospace;letter-spacing:.06em;color:#7f98a6;border:1px solid #23495a;border-radius:999px;padding:2px 6px}
#mem-algo-panel .scn .pick{font:800 .54rem ui-monospace,monospace;letter-spacing:.06em;color:#1a1300;background:#ffd166;border-radius:999px;padding:2px 6px}
#mem-algo-panel .scn .fit{margin:5px 0 4px;height:6px;border-radius:4px;background:#16303a;overflow:hidden}
#mem-algo-panel .scn .fit i{display:block;height:100%;background:linear-gradient(90deg,#00d084,#52e6ad)}
#mem-algo-panel .scn .meta{display:flex;flex-wrap:wrap;gap:4px 10px;font:700 .6rem ui-monospace,monospace;color:#9fb3be}
#mem-algo-panel .scn .meta i{font-style:normal;color:#dbe6ec}
#mem-algo-panel .scn .sum{margin:5px 0 0;color:#b8c9d3;font-size:.68rem;line-height:1.45}
#mem-algo-panel .scn-detail{margin:-2px 0 8px;padding:8px 10px;border:1px solid #2b2a16;border-radius:0 0 9px 9px;background:#0f0f0a;font-size:.68rem;color:#c9d6de;line-height:1.5}
#mem-algo-panel .scn-detail ol{margin:4px 0 6px;padding-left:18px}#mem-algo-panel .scn-detail ol li{margin:0 0 4px}
#mem-algo-panel .scn-detail ul{margin:4px 0 6px;padding-left:16px;color:#9fb3be}
#mem-algo-panel .scn-detail .inv{padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700}
#mem-algo-panel .scn-detail .opt{margin-top:6px;padding:6px 8px;border-radius:7px;background:#0d1f33;border:1px solid #1d3550;color:#9cc8ff}
#mem-algo-panel .scn-detail h6{margin:6px 0 2px;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em;color:#7f98a6;text-transform:uppercase}
#mem-algo-panel .scn-actions{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 2px}
#mem-algo-panel .scn-actions button{padding:6px 9px;border:1px solid #23495a;border-radius:7px;background:#0a1118;color:#b8c9d3;font:700 .64rem system-ui;cursor:pointer}
#mem-algo-panel .scn-actions button.gold{border-color:#ffd166;color:#ffd166}
#mem-algo-panel .scn-actions button.green{border-color:#00d084;color:#3ef0a8}
#mem-algo-panel .scn-note{margin:4px 0 0;color:#6f8794;font-size:.6rem}`;
  document.head.appendChild(css);

  const layer = document.createElement('canvas'); layer.id = 'mem-scn-layer'; host.appendChild(layer);
  const ctx = layer.getContext('2d');

  const mode = () => { const st = window.smlMemAlgoState && window.smlMemAlgoState(); return st ? st.mode : 'day'; };
  const memData = () => { const st = window.smlMemAlgoState && window.smlMemAlgoState(); return st && st.data ? st.data : null; };
  const pickKey = (M) => M.symbol + ':' + mode();

  /* ---- compute the five scenarios for the chart's own candles; memoised on symbol, interval, mode and the last candle ---- */
  function compute(force) {
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.N < 40) { S.result = null; return null; }
    const raw = memData();
    const key = [M.symbol, M.tf, mode(), M.N, M.bars[M.N - 1] && M.bars[M.N - 1].t, raw && raw.open ? raw.open.entry : '', raw ? raw.bias : ''].join('|');
    if (!force && S.result && key === S.key) return S.result;
    try {
      const bars = M.bars.map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 }));
      const analysis = SM.analyze(bars);
      let patterns = null; try { patterns = PT && PT.detect ? PT.detect(bars) : null; } catch (_) { patterns = null; }
      const st = E.STRATEGIES[mode()] || E.STRATEGIES.day;
      const params = Object.assign({}, E.resolveParams ? E.resolveParams(mode(), {}, M.tf) : st.params, { dirs: st.dirs });
      S.result = X.build({ bars, mode: mode(), analysis, model: raw, patterns, params });
      S.result.patterns = patterns; S.error = '';
    } catch (e) { S.result = null; S.error = 'The scenarios could not be built on this chart.'; }
    S.key = key;
    /* keep the drawn scenario if its id survived the refresh, else clear it */
    if (S.shown && !(S.result && S.result.scenarios.some((x) => x.id === S.shown))) { S.shown = null; draw(); }
    return S.result;
  }

  /* ---- the panel section ---- */
  function sectionHtml() {
    const r = compute(false);
    const M = window.smlChartModel && window.smlChartModel();
    const st = E.STRATEGIES[mode()] || {};
    let h = '<div class="mem-sec" id="mem-scn"><div class="scn-head"><h5>Scenarios · top 5</h5><em>' + esc(st.label || mode()) + (r ? ' · ' + (r.side === 'long' ? 'LONG' : 'SHORT') : '') + '</em></div>';
    h += '<p class="scn-intro">The five most likely ways a <b>' + esc(st.label || mode()) + '</b> on $' + esc(M ? M.symbol : '') + ' could play out from here, built from this chart\'s structure, zones, liquidity and patterns. Tap one to draw it on the chart, then pick the one you believe and snap it.</p>';
    if (!r || !r.ok) return h + '<div class="mem-warn">' + esc(S.error || 'Not enough candles on this interval to build scenarios yet.') + '</div></div>';
    const myPick = M ? S.picks[pickKey(M)] : null;
    for (const sc of r.scenarios) {
      const on = S.shown === sc.id, picked = myPick === sc.id;
      h += '<button type="button" class="scn' + (on ? ' on' : '') + '" data-mem-scn="show:' + esc(sc.id) + '">'
        + '<span class="top"><span class="rank">' + sc.rank + '</span><b>' + esc(sc.title) + '</b>' + (picked ? '<span class="pick">MY PICK</span>' : '') + '<span class="tag">' + esc(sc.tag) + '</span></span>'
        + '<span class="fit"><i style="width:' + sc.fit + '%"></i></span>'
        + '<span class="meta"><span>fit <i>' + sc.fit + '</i></span><span>entry <i>' + px(sc.entry) + '</i></span><span>stop <i>' + px(sc.stop) + '</i></span><span>target <i>' + px(sc.target) + '</i></span>' + (sc.rr != null ? '<span>R:R <i>' + sc.rr.toFixed(1) + '</i></span>' : '') + '</span>'
        + '<span class="sum">' + esc(sc.summary) + '</span></button>';
      if (on) {
        h += '<div class="scn-detail"><h6>The route, step by step</h6><ol>' + sc.steps.map((s2) => '<li>' + esc(s2.text) + '</li>').join('') + '</ol>'
          + '<div class="inv">' + esc(sc.invalidation.text) + '</div>'
          + '<h6>Why this chart supports it</h6><div>' + esc(sc.why) + '</div>'
          + '<h6>What to learn from it</h6><ul>' + sc.teach.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>'
          + '<div class="opt"><b>Options version:</b> ' + esc(sc.options.side) + ', ' + esc(sc.options.expiry) + '; strike ' + esc(sc.options.strike) + '. Educational, not a recommendation.</div>'
          + '<div class="scn-actions">'
          + '<button type="button" class="gold" data-mem-scn="pick:' + esc(sc.id) + '">' + (picked ? '✓ My pick' : 'Pick this one') + '</button>'
          + '<button type="button" class="green" data-mem-scn="snap">Snap to Discord</button>'
          + '<button type="button" data-mem-scn="png">Save PNG</button>'
          + '<button type="button" data-mem-scn="clear">Clear chart</button></div></div>';
      }
    }
    h += '<p class="scn-note">Fit scores how well this chart supports each route (not a probability). Schematic paths, not forecasts. Educational only.</p></div>';
    return h;
  }

  /* ---- clicks from the panel ---- */
  function onClick(action) {
    const [what, id] = String(action || '').split(':');
    const M = window.smlChartModel && window.smlChartModel();
    if (what === 'show') { S.shown = S.shown === id ? null : id; if (S.shown) makeRoom(); draw(); return true; }
    if (what === 'pick') { if (M) { S.picks[pickKey(M)] = S.picks[pickKey(M)] === id ? null : id; save(); draw(); } return true; }
    if (what === 'clear') { S.shown = null; draw(); return true; }
    if (what === 'snap') { const b = document.getElementById('snap-toggle'); if (b) b.click(); return true; }
    if (what === 'png') { savePng(); return true; }
    return false;
  }

  /* scroll the chart so the projection area to the right of the last candle is wide enough to read */
  function makeRoom() {
    const pro = window.smlChartPro, M = window.smlChartModel && window.smlChartModel();
    const sc = current(); if (!pro || !pro.setView || !M || !sc) return;
    const future = sc.window.future + 3;
    const n = Math.max(M.slots, Math.ceil(future / 0.33) + 4);
    pro.setView(n, M.N + future);
  }
  function current() { const r = S.result; return r && S.shown ? r.scenarios.find((x) => x.id === S.shown) || null : null; }

  function savePng() {
    const cap = window.smlSnapshotCapture; if (typeof cap !== 'function') { const b = document.getElementById('snap-toggle'); if (b) b.click(); return; }
    const shot = cap(); if (!shot || !shot.url) return;
    const sc = current(), a = document.createElement('a');
    a.href = shot.url; a.download = shot.symbol + '-' + mode() + '-' + (sc ? sc.id : 'scenario') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---- drawing ---- */
  const ZONE = { OB: ['77,195,255', '255,170,60'], FVG: ['0,208,132', '255,84,112'], GAP: ['255,209,102', '255,209,102'], RANGE: ['0,208,132', '255,84,112'] };
  function pill(x, y, text, color, bg, size, align) {
    ctx.font = '800 ' + (size || 10) + 'px ui-monospace,monospace';
    const w = ctx.measureText(text).width + 10, h = (size || 10) + 7;
    let lx = x; if (align === 'right') lx = x - w; else if (align === 'center') lx = x - w / 2;
    ctx.fillStyle = bg || 'rgba(7,16,24,.92)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, y - h / 2, w, h, 4) : ctx.rect(lx, y - h / 2, w, h); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, lx + 5, y + 0.5);
    return { x: lx, y: y - h / 2, w, h };
  }
  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const sc = current(); if (!sc || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const pad = M.pad, right = pad.l + M.pw, bottom = pad.t + (M.priceH || M.ph), half = M.step / 2;
    const x = (i) => M.x(i), y = (p) => M.y(p), lo = M.lo, hi = M.hi, inY = (p) => p >= lo && p <= hi;
    const s = sc.side === 'long' ? 1 : -1, accent = s > 0 ? '#35e6a0' : '#ff6b86';
    const layout = window.SmlChartLayout;
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, M.pw, M.priceH || M.ph); ctx.clip();

    /* projection area: everything right of the last candle */
    const x0 = x(sc.window.i0) + half, xe = Math.min(right, x(sc.window.iEnd) + half);
    if (xe > x0) {
      ctx.fillStyle = 'rgba(255,209,102,.045)'; ctx.fillRect(x0, pad.t, xe - x0, bottom - pad.t);
      ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,209,102,.35)'; ctx.beginPath(); ctx.moveTo(x0, pad.t); ctx.lineTo(x0, bottom); ctx.stroke(); ctx.restore();
      ctx.font = '800 9px ui-monospace,monospace'; ctx.fillStyle = 'rgba(255,209,102,.7)'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('PROJECTION · ' + sc.window.future + ' candles', x0 + 5, bottom - 6);
    }

    /* zones */
    const labels = [];
    for (const z of sc.zones) {
      if (!(inY(z.top) || inY(z.bottom))) continue;
      const col = (ZONE[z.kind] || ZONE.OB)[z.dir > 0 ? 0 : 1];
      const x1 = Math.max(pad.l, x(z.from) - half), x2 = xe;
      ctx.fillStyle = 'rgba(' + col + ',.16)'; ctx.fillRect(x1, y(z.top), x2 - x1, y(z.bottom) - y(z.top));
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(' + col + ',.8)'; ctx.lineWidth = 1.2; ctx.strokeRect(x1, y(z.top), x2 - x1, y(z.bottom) - y(z.top)); ctx.restore();
      labels.push({ x: Math.max(x1 + 4, x0 - 150), y: y(z.top) + 9, text: z.label.toUpperCase(), color: 'rgb(' + col + ')', size: 9 });
    }
    /* the pattern the idea leans on */
    if (sc.patternId && S.result && S.result.patterns && S.result.patterns.ok) {
      const pat = S.result.patterns.charts.find((c) => c.id === sc.patternId);
      if (pat) { ctx.save(); ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 2; ctx.setLineDash([]); for (const l of pat.lines || []) { ctx.beginPath(); ctx.moveTo(x(l.i1), y(l.p1)); ctx.lineTo(x(l.i2), y(l.p2)); ctx.stroke(); } ctx.restore(); labels.push({ x: x(pat.startIdx), y: y(pat.points && pat.points.length ? Math.max(...pat.points.map((q) => q.p)) : pat.level) - 10, text: pat.name.toUpperCase(), color: '#c084fc', size: 9 }); }
    }
    /* levels: entry, stop, targets and the idea's own levels */
    const lines = [{ price: sc.entry, label: 'ENTRY ' + px(sc.entry), color: '#ffffff', dash: [6, 4], width: 1.2 }, { price: sc.stop, label: 'STOP ' + px(sc.stop), color: '#ff5470', dash: [6, 4], width: 1.4 }, { price: sc.target, label: 'TARGET ' + px(sc.target), color: '#00d084', dash: [6, 4], width: 1.4 }];
    if (sc.target2 != null) lines.push({ price: sc.target2, label: 'T2 ' + px(sc.target2), color: '#00d084', dash: [2, 4], width: 1 });
    for (const l of sc.levels) if (![sc.entry, sc.stop, sc.target].some((p) => Math.abs(p - l.price) < 1e-9)) lines.push({ price: l.price, label: l.label.toUpperCase() + ' ' + px(l.price), color: l.kind === 'liquidity' ? '#6bd0ff' : l.kind === 'vwap' ? '#ffd166' : l.kind === 'ema' ? '#ffa94d' : '#b9c8d1', dash: [1, 4], width: 1 });
    for (const l of lines) {
      if (!inY(l.price)) continue; const yy = y(l.price);
      ctx.save(); ctx.setLineDash(l.dash); ctx.strokeStyle = l.color; ctx.lineWidth = l.width; ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.restore();
      labels.push({ x: right - 4, y: yy, text: l.label, color: l.color, size: 9, align: 'right', pill: true });
    }
    /* invalidation band under the stop */
    if (inY(sc.stop)) { const yy = y(sc.stop); ctx.fillStyle = 'rgba(255,84,112,.08)'; if (s > 0) ctx.fillRect(x0, yy, Math.max(0, xe - x0), Math.max(0, bottom - yy)); else ctx.fillRect(x0, pad.t, Math.max(0, xe - x0), Math.max(0, yy - pad.t)); }

    /* the path: a white halo under a thick accent line, dashed because it is a projection */
    const pts = sc.path.map((p) => ({ x: x(p.i), y: y(p.p) }));
    if (pts.length > 1) {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.setLineDash([9, 6]); ctx.strokeStyle = accent; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.setLineDash([]);
      /* arrow head at the end */
      const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - 11 * Math.cos(ang - 0.45), b.y - 11 * Math.sin(ang - 0.45)); ctx.lineTo(b.x - 11 * Math.cos(ang + 0.45), b.y - 11 * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    /* numbered steps */
    sc.steps.forEach((st, k) => {
      const cx = x(st.i), cy = y(st.p);
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 6.3); ctx.fillStyle = k === 0 ? '#ffffff' : accent; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#071018'; ctx.font = '900 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(st.n), cx, cy + 0.5);
      const short = st.text.split(/[.:]/)[0].replace(/^Entry [0-9.]+/, 'Entry').slice(0, 34);
      labels.push({ x: cx + 14, y: cy + (k % 2 ? 14 : -14), text: st.n + ' · ' + short, color: '#eaf3f6', size: 9, pill: true });
    });
    /* labels, nudged apart when the chart layout helper is present */
    const boxes = labels.map((l) => { ctx.font = '800 ' + l.size + 'px ui-monospace,monospace'; const tw = ctx.measureText(l.text).width + 10; return { x: l.align === 'right' ? l.x - tw : l.x, y: l.y - (l.size + 7) / 2, w: tw, h: l.size + 7, label: l }; });
    const placed = layout && layout.avoidOverlap ? layout.avoidOverlap(boxes) : boxes;
    for (const b of placed) { const l = b.label; if (l.pill || l.align === 'right') pill(b.x, b.y + b.h / 2, l.text, l.color, 'rgba(7,16,24,.92)', l.size, 'left'); else { ctx.font = '800 ' + l.size + 'px ui-monospace,monospace'; ctx.fillStyle = l.color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(l.text, b.x, b.y + b.h / 2); } }
    ctx.restore();

    /* title card, top-left: what is drawn, how well the chart supports it, and the member's own call */
    const M2 = window.smlChartModel(); const st = E.STRATEGIES[sc.mode] || {};
    const picked = S.picks[M2.symbol + ':' + sc.mode] === sc.id;
    const t1 = 'SCENARIO ' + sc.rank + ' · ' + sc.title.toUpperCase(), t2 = (st.label || sc.mode) + ' · ' + (sc.side === 'long' ? 'LONG' : 'SHORT') + ' · fit ' + sc.fit + (sc.rr != null ? ' · R:R ' + sc.rr.toFixed(1) : ''), t3 = sc.invalidation.text.replace(/ \(.*\)$/, '');
    ctx.font = '900 11px system-ui,sans-serif'; const w1 = ctx.measureText(t1).width; ctx.font = '700 9.5px ui-monospace,monospace'; const w2 = Math.max(ctx.measureText(t2).width, ctx.measureText(t3).width);
    const cw = Math.min(M.pw - 20, Math.max(w1, w2) + 22), ch = picked ? 64 : 52, cx0 = pad.l + 8, cy0 = pad.t + 8;
    ctx.fillStyle = 'rgba(7,16,24,.93)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx0, cy0, cw, ch, 8) : ctx.rect(cx0, cy0, cw, ch); ctx.fill(); ctx.strokeStyle = picked ? '#ffd166' : accent; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '900 11px system-ui,sans-serif'; ctx.fillStyle = accent; ctx.fillText(t1, cx0 + 10, cy0 + 17);
    ctx.font = '700 9.5px ui-monospace,monospace'; ctx.fillStyle = '#dbe6ec'; ctx.fillText(t2, cx0 + 10, cy0 + 31); ctx.fillStyle = '#ffb3c0'; ctx.fillText(t3, cx0 + 10, cy0 + 44);
    if (picked) { ctx.fillStyle = '#ffd166'; ctx.font = '900 9.5px ui-monospace,monospace'; ctx.fillText('★ MY PICK out of the 5 · MEM ALGO SCENARIOS', cx0 + 10, cy0 + 57); }
  }

  window.addEventListener('sml-chart-view', () => { try { draw(); } catch (_) { /* chart not ready */ } });
  window.addEventListener('sml-mem-algo-state', () => { const r = compute(false); if (r) draw(); });
  window.addEventListener('sml-academy-market', () => { S.shown = null; setTimeout(() => { compute(true); draw(); }, 400); });
  window.smlMemScenarios = { sectionHtml, onClick, compute, draw, current, clear: () => { S.shown = null; draw(); } };
})();
