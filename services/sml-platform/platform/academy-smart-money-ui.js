/* Smart-money map layer for the Academy Live Chart Lab. Draws what window.SmlSmartMoney finds (gaps, structure, order blocks, liquidity, VWAP, volume profile, absorption)
   on the chart and explains it in plain sentences. Educational: it shows what price did, not what it will do. */
(function boot(tries) {
  if (window.__smlSmartMoneyUi) return;
  const SM = window.SmlSmartMoney; if (!SM) return;
  // the chart stage is built by a script that loads after this one: wait for it
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlSmartMoneyUi = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar'), chartCanvas = $('chart'), stage = document.querySelector('.academy-chart-stage');
  if (!toolbar || !chartCanvas || !stage) return;

  const KEY = 'sml-smc-v1';
  const OPTS = [['fvg', 'Imbalances (FVG)'], ['struct', 'Structure (BOS / CHoCH)'], ['ob', 'Order blocks'], ['liq', 'Liquidity (equal highs / lows)'], ['gaps', 'Opening gaps'], ['vwap', 'VWAP + bands'], ['pd', 'Premium / discount'], ['profile', 'Volume profile'], ['flags', 'Absorption']];
  const S = { on: false, collapsed: window.innerWidth < 720, o: { fvg: true, struct: true, ob: true, liq: true, gaps: true, vwap: true, pd: false, profile: false, flags: true }, a: null, key: '', at: 0, hits: [], tip: null, tipKey: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.on = v.on === true; Object.assign(S.o, v.o || {}); } } catch (_) { /* storage can be blocked */ }
  S.collapsed = true; // the map starts as a chip on the chart; expanding it over the quote column is a deliberate click each session
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, collapsed: S.collapsed, o: S.o })); } catch (_) { /* ignore */ } };

  const css = document.createElement('style');
  css.textContent = '#smc-layer{position:absolute;pointer-events:none;z-index:4;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}'
    + '#smc-toggle{margin-left:4px;padding:5px 9px;border:1px solid #6a4fa0;border-radius:7px;background:#17112a;color:#cdb6ff;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#smc-toggle.on{background:#6a4fd0;border-color:#a58bff;color:#fff}'
    + '#smc-card{position:absolute;right:74px;top:26px;z-index:9;width:min(270px,calc(100% - 96px));max-height:calc(100% - 60px);overflow:auto;background:rgba(9,15,24,.94);border:1px solid #3a3160;border-radius:10px;color:#dbe6ec;font:600 .64rem/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}'
    + '#smc-card header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #2a2547;cursor:pointer}#smc-card header b{font:800 .66rem ui-monospace,monospace;color:#cdb6ff;letter-spacing:.06em}#smc-card header span{margin-left:auto;color:#8fa6b3}'
    + '#smc-card .opts{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;padding:7px 9px;border-bottom:1px solid #2a2547}#smc-card label{display:flex;gap:5px;align-items:center;color:#b9c8d1;font-weight:600;cursor:pointer}#smc-card input{accent-color:#8b6dff}'
    + '#smc-card ul{list-style:none;margin:0;padding:7px 9px 8px}#smc-card li{margin:0 0 6px;padding-left:9px;border-left:3px solid #4a5a66;color:#c9d6de}#smc-card li.up{border-color:#00d084}#smc-card li.down{border-color:#ff5470}#smc-card li.warn{border-color:#ffd166}'
    + '#smc-card small{display:block;padding:0 9px 8px;color:#6f8794;font-weight:500;font-size:.54rem}@media(max-width:700px){#smc-card{right:8px;top:auto;bottom:34px;max-height:44%}}';
  css.textContent += '#smc-tip{position:fixed;z-index:2147483300;width:min(340px,calc(100vw - 16px));max-height:min(78vh,560px);overflow:hidden;pointer-events:none;background:rgba(7,12,20,.97);border:1px solid #6a4fa0;border-radius:11px;box-shadow:0 10px 34px rgba(0,0,0,.6);color:#dbe6ec;font:600 .66rem/1.42 system-ui,sans-serif;padding:0}'
    + '#smc-tip h5{margin:0;padding:8px 11px;background:#17112a;border-bottom:1px solid #2a2547;font:800 .72rem system-ui,sans-serif;color:#e4d8ff;letter-spacing:.02em}#smc-tip .k{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:7px 11px;border-bottom:1px solid #1d2a36}#smc-tip .k span{color:#7f95a1;font-weight:600}#smc-tip .k b{color:#e6eef2;font-weight:700;text-align:right}'
    + '#smc-tip .ev{list-style:none;margin:0;padding:6px 11px 4px}#smc-tip .ev li{margin:0 0 4px;padding-left:9px;border-left:3px solid #4a5a66;color:#c1cfd7;font-weight:500}#smc-tip .ev li.for{border-color:#00d084}#smc-tip .ev li.against{border-color:#ff5470}'
    + '#smc-tip .cl{margin:4px 9px 8px;padding:8px 10px;border-radius:8px;background:#121a28;border:1px solid #2c3a52}#smc-tip .cl b{display:inline-block;margin-bottom:3px;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em}#smc-tip .cl.bullish b{color:#5df0b0}#smc-tip .cl.bearish b{color:#ff8ea1}#smc-tip .cl.neutral b{color:#ffd166}'
    + '#smc-tip small{display:block;padding:0 11px 8px;color:#6f8794;font-weight:500;font-size:.54rem}@media(max-width:700px){#smc-tip{left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto;max-height:46vh}}';
  css.textContent += '#smc-card .cl-overall{margin:7px 9px 0;padding:7px 9px;border-radius:8px;background:#121a28;border:1px solid #2c3a52;color:#c9d6de;font-weight:600}#smc-card .cl-overall b{font:800 .58rem ui-monospace,monospace;letter-spacing:.05em}#smc-card .cl-overall.bullish b{color:#5df0b0}#smc-card .cl-overall.bearish b{color:#ff8ea1}#smc-card .cl-overall.neutral b{color:#ffd166}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'smc-toggle'; btn.textContent = 'SMC'; btn.title = 'Smart-money map: gaps, structure, order blocks, liquidity, VWAP and more'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'smc-layer'; const ctx = layer.getContext('2d');
  const card = document.createElement('aside'); card.id = 'smc-card'; card.style.display = 'none'; stage.appendChild(card);

  function analysis(M) {
    const last = M.bars[M.N - 1], key = M.symbol + ':' + M.tf + ':' + M.N + ':' + (last && last.t);
    const stale = performance.now() - S.at > 900;
    if (!S.a || key !== S.key || (stale && last)) { S.a = SM.analyze(M.bars); S.key = key; S.at = performance.now(); paintCard(); }
    return S.a;
  }
  /* Expanded, the card pops up over the ticker's quote column (never over the chart); collapsed it is a small chip on the chart. Phones keep the bottom sheet. */
  function place() {
    const reset = () => { ['position', 'left', 'top', 'width', 'height', 'maxHeight', 'right', 'zIndex'].forEach((k) => { card.style[k] = ''; }); if (card.parentElement !== stage) stage.appendChild(card); };
    if (!S.on) return;
    if (S.collapsed || window.matchMedia('(max-width:700px)').matches) { reset(); return; }
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 80 && getComputedStyle(el).display !== 'none' ? r : null; };
    const r = vis(document.querySelector('.side')) || vis(document.getElementById('academy-alerts'));
    if (!r) { reset(); return; }
    if (card.parentElement !== document.body) document.body.appendChild(card);
    Object.assign(card.style, { position: 'fixed', left: Math.round(r.left) + 'px', top: Math.round(r.top) + 'px', width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px', maxHeight: 'none', right: 'auto', zIndex: '2147483200' });
  }
  window.addEventListener('resize', place); setInterval(place, 1500);
  function paintCard() {
    if (!S.on) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const lines = S.a ? SM.read(S.a) : [];
    const EXm = window.SmlSmcExplain, Mm = window.smlChartModel && window.smlChartModel(), ov = EXm && S.a && Mm ? EXm.overall(S.a, Mm.bars, { flow: flow() }) : null;
    card.innerHTML = '<header data-h="1"><b>SMART MONEY MAP</b><span>' + (S.collapsed ? 'show' : 'hide') + '</span></header>'
      + (S.collapsed ? '' : '<div class="opts">' + OPTS.map(([k, l]) => '<label><input type="checkbox" data-o="' + k + '"' + (S.o[k] ? ' checked' : '') + '>' + esc(l) + '</label>').join('') + '</div>'
        + (ov ? '<div class="cl-overall ' + esc(ov.bias) + '"><b>MAP READ: ' + esc(ov.bias.toUpperCase()) + ' · ' + esc(ov.confidence.toUpperCase()) + '</b> ' + esc(ov.purpose) + '</div>' : '')
        + '<ul>' + (lines.length ? lines.map((l) => '<li class="' + esc(l.tone) + '">' + esc(l.text) + '</li>').join('') : '<li>Not enough candles yet to read structure.</li>') + '</ul>'
        + '<small>Educational: this describes what price has done. It does not predict what it will do.</small>');
    place();
  }
  card.addEventListener('click', (e) => { if (e.target.closest('[data-h]')) { S.collapsed = !S.collapsed; save(); paintCard(); } });
  card.addEventListener('change', (e) => { const k = e.target && e.target.dataset && e.target.dataset.o; if (k) { S.o[k] = e.target.checked; save(); draw(); } });
  btn.addEventListener('click', () => { S.on = !S.on; save(); btn.classList.toggle('on', S.on); S.key = ''; paintCard(); draw(); });
  btn.classList.toggle('on', S.on);

  const rect = (x1, y1, x2, y2, fill, stroke, dash) => { const l = Math.min(x1, x2), t = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.max(1.5, Math.abs(y2 - y1)); ctx.fillStyle = fill; ctx.fillRect(l, t, w, h); if (stroke) { ctx.save(); if (dash) ctx.setLineDash(dash); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(l + .5, t + .5, w - 1, h - 1); ctx.restore(); } };
  const text = (t, x, y, color, align, size = 10) => { ctx.font = '800 ' + size + 'px ui-monospace,monospace'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(t, x, y); };

  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    S.hits = [];
    if (!S.on || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.N < 25) return;
    const a = analysis(M); if (!a) return;
    const pad = M.pad, right = pad.l + M.pw, y = (p) => M.y(p), x = (i) => M.x(i), half = M.step / 2, lo = M.lo, hi = M.hi;
    const inY = (p) => p >= lo && p <= hi, visI = (i) => i >= M.start - 1 && i <= M.end + 1;
    const zoneHit = (kind, index, x1, y1, x2, y2) => { S.hits.push({ kind, index, x1: Math.min(x1, x2) - 2, x2: Math.max(x1, x2) + 2, y1: Math.min(y1, y2) - 3, y2: Math.max(y1, y2) + 3, area: Math.abs(x2 - x1) * Math.abs(y2 - y1) }); };
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, M.pw, M.priceH || M.ph); ctx.clip(); // price pane only: never through the volume bars

    if (S.o.pd && a.range) {
      const x0 = Math.max(pad.l, x(a.range.fromIdx) - half), yh = y(a.range.hi), ye = y(a.range.eq), yl = y(a.range.lo);
      rect(x0, yh, right, ye, 'rgba(255,84,112,.06)'); rect(x0, ye, right, yl, 'rgba(0,208,132,.06)');
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(190,215,228,.55)'; ctx.beginPath(); ctx.moveTo(x0, ye); ctx.lineTo(right, ye); ctx.stroke(); ctx.restore();
      text('EQ 50%', x0 + 4, ye - 7, '#b9c8d1'); text('PREMIUM', x0 + 4, yh + 9, 'rgba(255,140,160,.8)'); text('DISCOUNT', x0 + 4, yl - 8, 'rgba(90,240,176,.8)');
    }
    // Gaps, FVGs and order blocks all describe price zones and commonly land in the same area at
    // once, so their labels are collected here and placed together with shared collision
    // avoidance instead of each category writing text with no idea another one is in the same
    // spot. Their boxes are also capped to MAX_ZONE_BARS ahead of their origin bar (never past the
    // chart's own end either way) so one zone can never balloon into something that, at a high
    // zoom, dwarfs the handful of candles it is meant to annotate.
    const MAX_ZONE_BARS = 30;
    const layout = window.SmlChartLayout;
    const boundEnd = (originI, naturalEndI) => (layout ? layout.boundZoneEndBar(originI, naturalEndI, MAX_ZONE_BARS) : naturalEndI);
    const zoneLabels = [];
    if (S.o.gaps) for (const g of a.gaps.slice(-6)) {
      const endI = g.filledAt != null ? g.filledAt : boundEnd(g.i, M.end), x1 = Math.max(pad.l, x(g.i) - half), x2 = Math.min(right, x(endI));
      if (x2 <= pad.l || !(inY(g.top) || inY(g.bottom))) continue;
      zoneHit('gap', a.gaps.indexOf(g), x1, y(g.top), x2, y(g.bottom));
      const open = g.filledAt == null; rect(x1, y(g.top), x2, y(g.bottom), open ? 'rgba(255,209,102,.13)' : 'rgba(255,209,102,.05)', open ? 'rgba(255,209,102,.7)' : null, [3, 3]);
      zoneLabels.push({ x: x1 + 4, y: y(g.top) + 8, size: 10, text: 'GAP ' + (g.pct >= 0 ? '+' : '') + (g.pct * 100).toFixed(1) + '%' + (open ? '' : ' filled'), color: open ? '#ffd166' : 'rgba(255,209,102,.55)' });
    }
    if (S.o.fvg) {
      const list = a.fvg.filter((g) => g.filledAt == null && visI(g.i) && (inY(g.top) || inY(g.bottom))).sort((p, q) => Math.abs((p.top + p.bottom) / 2 - a.last) - Math.abs((q.top + q.bottom) / 2 - a.last)).slice(0, 8);
      for (const g of list) {
        const x1 = Math.max(pad.l, x(g.i - 1) - half), x2 = Math.min(right, x(boundEnd(g.i, M.end))), col = g.dir > 0 ? '0,208,132' : '255,84,112';
        zoneHit('fvg', a.fvg.indexOf(g), x1, y(g.top), x2, y(g.bottom));
        rect(x1, y(g.top), x2, y(g.bottom), 'rgba(' + col + ',.11)', 'rgba(' + col + ',.55)', [2, 3]);
        zoneLabels.push({ x: Math.min(x2 - 30, x1 + 3), y: y(g.top) + 7, size: 9, text: 'FVG', color: 'rgb(' + col + ')' });
      }
    }
    if (S.o.ob) {
      const list = a.structure.orderBlocks.filter((o) => o.invalidAt == null && (inY(o.top) || inY(o.bottom))).slice(-4);
      for (const o of list) {
        const x1 = Math.max(pad.l, x(o.i) - half), x2 = Math.min(right, x(boundEnd(o.i, M.end))), col = o.dir > 0 ? '77,195,255' : '255,170,60';
        zoneHit('ob', a.structure.orderBlocks.indexOf(o), x1, y(o.top), x2, y(o.bottom));
        rect(x1, y(o.top), x2, y(o.bottom), 'rgba(' + col + ',.14)', 'rgba(' + col + ',.7)');
        zoneLabels.push({ x: Math.min(x2 - 52, x1 + 3), y: y(o.top) + 8, size: 9, text: o.dir > 0 ? 'DEMAND' : 'SUPPLY', color: 'rgb(' + col + ')' });
      }
    }
    if (zoneLabels.length) {
      const boxes = zoneLabels.map((l) => { ctx.font = '800 ' + l.size + 'px ui-monospace,monospace'; return { x: l.x, y: l.y - l.size, w: ctx.measureText(l.text).width + 4, h: l.size + 4, label: l }; });
      const placed = layout ? layout.avoidOverlap(boxes) : boxes;
      placed.forEach((b) => text(b.label.text, b.x, b.y + b.label.size, b.label.color, 'left', b.label.size));
    }
    if (S.o.liq) for (const l of a.liquidity) {
      if (l.takenAt != null || !inY(l.level)) continue;
      const x1 = Math.max(pad.l, x(l.first)), yy = y(l.level), col = l.kind === 'EQH' ? '#ff9f6b' : '#6bd0ff';
      zoneHit('liq', a.liquidity.indexOf(l), x1, yy - 5, right, yy + 5); if (l.sweptAt != null && visI(l.sweptAt)) zoneHit('liq', a.liquidity.indexOf(l), x(l.sweptAt) - 26, yy - 24, x(l.sweptAt) + 26, yy + 24);
      ctx.save(); ctx.setLineDash([1, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.restore();
      text(l.kind + ' x' + l.count + (l.sweptAt != null ? ' swept' : ' · stops'), right - 6, yy + (l.kind === 'EQH' ? -8 : 9), col, 'right', 9);
      if (l.sweptAt != null && visI(l.sweptAt)) text(l.kind === 'EQH' ? '▼ sweep' : '▲ sweep', x(l.sweptAt), y(l.level) + (l.kind === 'EQH' ? -16 : 18), col, 'center', 9);
    }
    if (S.o.struct) for (const e of a.structure.events.filter((v) => visI(v.idx)).slice(-6)) {
      if (!inY(e.level)) continue; const x1 = Math.max(pad.l, x(e.fromIdx)), x2 = x(e.idx), yy = y(e.level), col = e.dir > 0 ? '#5df0b0' : '#ff8ea1';
      zoneHit('structure', a.structure.events.indexOf(e), x1, yy - 11, x2, yy + 11);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x2, yy); ctx.stroke(); ctx.restore();
      text(e.type, (x1 + x2) / 2, yy + (e.dir > 0 ? -8 : 9), col, 'center', 9);
    }
    if (S.o.vwap) {
      const vw = a.vwap, s0 = Math.max(0, Math.floor(M.start)), s1 = Math.min(a.n - 1, Math.ceil(M.end));
      const line = (get, style, width, dash) => { ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.beginPath(); let pen = false, prevDay = null; for (let i = s0; i <= s1; i++) { const v = vw[i]; if (!v) { pen = false; continue; } const d = SM.dayKey(M.bars[i].t); if (a.intraday && d !== prevDay) pen = false; prevDay = d; const py = y(get(v)); if (!pen) { ctx.moveTo(x(i), py); pen = true; } else ctx.lineTo(x(i), py); } ctx.stroke(); ctx.restore(); };
      line((v) => v.vwap + 2 * v.sd, 'rgba(255,209,102,.30)', 1, [3, 4]); line((v) => v.vwap - 2 * v.sd, 'rgba(255,209,102,.30)', 1, [3, 4]);
      line((v) => v.vwap + v.sd, 'rgba(255,209,102,.5)', 1, null); line((v) => v.vwap - v.sd, 'rgba(255,209,102,.5)', 1, null); line((v) => v.vwap, '#ffd166', 1.8, null);
      const lv = vw[a.n - 1]; if (lv && inY(lv.vwap)) text('VWAP ' + lv.vwap.toFixed(2), right - 6, y(lv.vwap) - 8, '#ffd166', 'right', 9);
    }
    if (S.o.profile) {
      const view = M.bars.slice(Math.max(0, Math.floor(M.start)), Math.min(M.N, Math.ceil(M.end))), p = SM.volumeProfile(view, 44);
      if (p) {
        const maxW = M.pw * 0.16;
        for (let i = 0; i < p.vol.length; i++) { const pr = p.lo + (i + 0.5) * p.step; if (pr < lo || pr > hi) continue; const inVa = pr >= p.val && pr <= p.vah; ctx.fillStyle = inVa ? 'rgba(120,150,255,.24)' : 'rgba(150,165,190,.14)'; const bw = p.vol[i] / p.max * maxW, bh = Math.max(1.5, Math.abs(y(pr - p.step / 2) - y(pr + p.step / 2)) - 0.6); ctx.fillRect(right - bw, y(pr) - bh / 2, bw, bh); }
        [['POC', p.poc, '#ffd166', null], ['VAH', p.vah, 'rgba(160,180,255,.9)', [3, 3]], ['VAL', p.val, 'rgba(160,180,255,.9)', [3, 3]]].forEach(([n, pr, c, dash]) => { if (!inY(pr)) return; ctx.save(); if (dash) ctx.setLineDash(dash); ctx.strokeStyle = c; ctx.lineWidth = n === 'POC' ? 1.4 : 1; ctx.beginPath(); ctx.moveTo(right - maxW - 6, y(pr)); ctx.lineTo(right, y(pr)); ctx.stroke(); ctx.restore(); text(n + ' ' + pr.toFixed(2), right - maxW - 10, y(pr), c, 'right', 9); });
      }
    }
    if (S.o.flags) for (const f of a.flags.filter((v) => v.kind === 'absorption' && visI(v.i))) { const b = M.bars[f.i]; const px = x(f.i), py = y(+b.l) + 12; ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 5, py); ctx.closePath(); ctx.fill(); text('ABS', px, py + 13, '#ffd166', 'center', 8); }
    ctx.restore();
  }

  /* ---------- hover: the full details and a conclusion for whatever the pointer is on ---------- */
  const tipEl = document.createElement('div'); tipEl.id = 'smc-tip'; tipEl.style.display = 'none'; document.body.appendChild(tipEl);
  function hideTip() { if (tipEl) { tipEl.style.display = 'none'; } S.tipKey = ''; }
  function flow() { const L = window.smlLive, M = window.smlChartModel && window.smlChartModel(); const st = L && M && L.symbol === M.symbol ? L.stats : null; if (!st) return null; const buy = st.buy300 || st.buy60 || 0, sell = st.sell300 || st.sell60 || 0; return buy + sell > 0 ? { buy, sell } : null; }
  function tipHtml(r) {
    const facts = r.facts.map((f) => '<span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b>').join('');
    const ev = r.evidence.map((e) => '<li class="' + esc(e.tone) + '">' + esc(e.text) + '</li>').join('');
    const c = r.conclusion;
    return '<h5>' + esc(r.title) + '</h5><div class="k">' + facts + '</div><ul class="ev">' + ev + '</ul>'
      + '<div class="cl ' + esc(c.bias) + '"><b>CONCLUSION: ' + esc(c.bias.toUpperCase()) + ' · ' + esc(c.confidence.toUpperCase()) + ' CONFIDENCE</b><br>' + esc(c.summary) + '</div><small>' + esc((r.notes[r.notes.length - 1]) || '') + '</small>';
  }
  function showTip(hit, cx, cy) {
    const EX = window.SmlSmcExplain, M = window.smlChartModel && window.smlChartModel(); if (!EX || !M || !S.a) return;
    const key = hit.kind + ':' + hit.index + ':' + M.N;
    if (key !== S.tipKey) {
      const r = EX.explain(S.a, M.bars, hit.kind, hit.index, { flow: flow() }); if (!r) { hideTip(); return; }
      tipEl.innerHTML = tipHtml(r); S.tipKey = key;
    }
    tipEl.style.display = 'block';
    const vw = window.innerWidth, vh = window.innerHeight, w = tipEl.offsetWidth || 320, h = tipEl.offsetHeight || 260;
    let x = cx + 16, y = cy + 14; if (x + w > vw - 8) x = Math.max(8, cx - w - 16); if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hitAt(px, py) {
    let best = null;
    for (const h of S.hits) if (px >= h.x1 && px <= h.x2 && py >= h.y1 && py <= h.y2 && (!best || h.area < best.area)) best = h;
    return best;
  }
  const onMove = (e) => {
    if (!S.on || !S.hits.length || (e.buttons && e.buttons !== 0) || (e.target && e.target.tagName !== 'CANVAS')) { if (S.tipKey) hideTip(); return; }
    const r = chartCanvas.getBoundingClientRect(), hit = hitAt(e.clientX - r.left, e.clientY - r.top);
    if (hit) showTip(hit, e.clientX, e.clientY); else if (S.tipKey) hideTip();
  };
  // the chart's own interaction canvas sits on top of the base canvas inside the stage, so the stage hears the pointer
  stage.addEventListener('mousemove', onMove, { passive: true });
  stage.addEventListener('mouseleave', hideTip, { passive: true });
  stage.addEventListener('wheel', hideTip, { passive: true });
  // touch: a tap on a zone opens its details, a tap anywhere else closes them
  let down = null;
  stage.addEventListener('pointerdown', (e) => { down = e.pointerType === 'touch' && e.target && e.target.tagName === 'CANVAS' ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }, { capture: true, passive: true });
  stage.addEventListener('pointerup', (e) => {
    if (!down || !S.on) { down = null; return; } const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = Date.now() - down.t < 450; down = null;
    if (moved > 8 || !quick) return;
    const r = chartCanvas.getBoundingClientRect(), hit = hitAt(e.clientX - r.left, e.clientY - r.top);
    if (hit) { S.tipKey = ''; showTip(hit, e.clientX, e.clientY); tipEl.style.pointerEvents = 'auto'; } else hideTip();
  }, { passive: true });
  tipEl.addEventListener('click', hideTip);

  window.addEventListener('sml-chart-view', () => { if (S.on) draw(); });
  window.addEventListener('resize', () => { if (S.on) draw(); });
  paintCard(); draw();
})(0);
