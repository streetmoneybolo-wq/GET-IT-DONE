/* Academy chart tools on the site's LoopCharts chart (analyst dashboard, and every group page, which embeds the same dashboard).
   Adds only what the site chart did not already have: the smart-money map, MEM ALGO strategies, named candlesticks, a bar-close countdown
   and an options price calculator. Uses the engine's public window.SMLLC.api and draws on one overlay canvas, repainted by the engine's
   own render hook. Refuses to run on demo candles. Educational: describes what price did; places no orders. */
(function () {
  'use strict';
  if (window.__smlChartAcademyTools) return;
  window.__smlChartAcademyTools = true;

  var SM = window.SmlSmartMoney, PAT = window.SmlPatterns, MEM = window.MemAlgoEngine, OPT = window.SmlOptionsCalc;
  var KEY = 'sml-cat-v1';
  var S = { smc: false, mem: false, candles: false, mode: 'swing', a: null, key: '', mem_r: null, cand: null, panel: null };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { S.smc = !!saved.smc; S.mem = !!saved.mem; S.candles = !!saved.candles; if (saved.mode) S.mode = saved.mode; } } catch (e) { /* storage blocked */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ smc: S.smc, mem: S.mem, candles: S.candles, mode: S.mode })); } catch (e) { /* ignore */ } }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var TF_MS = { '1m': 6e4, '2m': 12e4, '3m': 18e4, '5m': 3e5, '10m': 6e5, '15m': 9e5, '30m': 18e5, '45m': 27e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '1d': 864e5, '1D': 864e5 };

  var css = document.createElement('style');
  css.id = 'sml-dashboard-chart-academy-tools-css';
  css.textContent = '.sml-cat-layer{position:absolute;inset:0;pointer-events:none;z-index:6}'
    + '.sml-cat-btn{margin-left:6px;padding:4px 9px;border:1px solid #2f4a5c;border-radius:6px;background:#0f1c26;color:#bfe3f2;font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer}'
    + '.sml-cat-btn.on{background:#1d6b52;border-color:#3fd69a;color:#fff}.sml-cat-btn.smc.on{background:#5a3fc0;border-color:#a58bff}'
    + '.sml-cat-sel{margin-left:4px;padding:3px 4px;border:1px solid #2f4a5c;border-radius:6px;background:#0f1c26;color:#dfeef5;font:700 11px system-ui}'
    + '.sml-cat-card{position:absolute;left:8px;top:8px;z-index:8;width:min(300px,calc(100% - 90px));max-height:calc(100% - 50px);overflow:auto;background:rgba(9,15,24,.94);border:1px solid #2c3e4c;border-radius:10px;color:#dbe6ec;font:600 12px/1.4 system-ui,sans-serif;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.45)}'
    + '.sml-cat-card header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #22323e;cursor:pointer}.sml-cat-card header b{font:800 11px ui-monospace,monospace;letter-spacing:.06em;color:#9fe1c3}.sml-cat-card header span{margin-left:auto;color:#7f97a4;font-size:11px}'
    + '.sml-cat-card ul{list-style:none;margin:0;padding:7px 9px}.sml-cat-card li{margin:0 0 6px;padding-left:8px;border-left:3px solid #4a5a66}.sml-cat-card li.up{border-color:#00d084}.sml-cat-card li.down{border-color:#ff5470}.sml-cat-card li.warn{border-color:#ffd166}'
    + '.sml-cat-card .kv{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:7px 9px}.sml-cat-card .kv span:nth-child(odd){color:#8fa6b3}'
    + '.sml-cat-card small{display:block;padding:0 9px 8px;color:#6f8794;font-weight:500;font-size:10.5px}'
    + '.sml-cat-opt{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:300px;background:#0b1620;border:1px solid #2b5362;border-radius:12px;color:#e6f0f5;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}'
    + '.sml-cat-opt header{display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid #22323e}.sml-cat-opt header b{font:800 11px ui-monospace,monospace;letter-spacing:.06em;color:#9fe1c3}.sml-cat-opt header button{margin-left:auto;border:0;background:none;color:#8fa6b3;font-size:16px;cursor:pointer}'
    + '.sml-cat-opt .g{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:9px 10px}.sml-cat-opt label{display:flex;flex-direction:column;gap:2px;color:#8fa6b3;font-size:11px}.sml-cat-opt input,.sml-cat-opt select{padding:5px 6px;border:1px solid #2f4a5c;border-radius:6px;background:#0f1c26;color:#fff;font:700 12px system-ui}'
    + '.sml-cat-opt .out{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:0 10px 10px}.sml-cat-opt .out span:nth-child(odd){color:#8fa6b3}.sml-cat-opt small{display:block;padding:0 10px 10px;color:#6f8794;font-size:10.5px}'
    /* Narrow charts (the group Live Chart embed, small windows): the chart's own control row overlapped itself. Let it wrap and give the timeframes their own full row. */
    + '@media(max-width:1000px){html body .sml-lc-shell .sml-lc-toolbar{flex-wrap:wrap!important;row-gap:6px!important;height:auto!important;min-height:34px}html body .sml-lc-shell .sml-lc-toolbar>*{flex-shrink:0!important}html body .sml-lc-shell .sml-lc-toolbar>.sml-lc-timeframes.sml-lc-timeframes{flex:1 0 100%!important;order:999!important;max-width:none!important;width:auto!important;overflow:visible!important;flex-wrap:wrap!important;gap:4px!important}html body .sml-lc-shell .sml-lc-toolbar .sml-lc-timeframes>*{flex-shrink:0!important}html body .sml-lc-shell .sml-lc-toolbar .sml-sw-terminal-add,html body .sml-lc-shell .sml-lc-toolbar .sml-lc-source{white-space:nowrap}}'
    + '@media(max-width:700px){.sml-cat-card{width:calc(100% - 16px);top:auto;bottom:8px;max-height:42%}.sml-cat-opt{left:8px;right:8px;width:auto}}';
  document.head.appendChild(css);

  var A = null, host = null, layer = null, canvas = null, ctx = null, card = null;

  function barsMs() {
    var raw = A.bars() || [];
    var out = new Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      var b = raw[i], t = Number(b.t);
      out[i] = { t: t < 1e12 ? t * 1000 : t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 };
    }
    return out;
  }
  function tf() { return String(A.timeframe() || ''); }
  function memTf() { var t = tf().toLowerCase(); return /^1d|d$/.test(t) ? '1D' : /^1w|w$/.test(t) ? '1W' : t; }
  function isDemo() { return A.quality && A.quality() === 'demo'; }

  /* ---------------- toolbar ---------------- */
  function btn(label, cls, title, on, click) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'sml-cat-btn ' + cls + (on ? ' on' : ''); b.textContent = label; b.title = title;
    b.addEventListener('click', function (e) { e.preventDefault(); click(b); }); return b;
  }
  function buildToolbar() {
    var head = document.getElementById('chead');
    var bar = head || (function () { var d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 6px;flex-wrap:wrap'; host.parentNode.insertBefore(d, host); return d; })();
    var wrap = document.createElement('span'); wrap.id = 'sml-cat-toolbar'; wrap.style.cssText = 'display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px';
    wrap.appendChild(btn('SMC', 'smc', 'Smart-money map: imbalances, structure, order blocks, liquidity, VWAP bands, absorption', S.smc, function (b) { S.smc = !S.smc; b.classList.toggle('on', S.smc); save(); refresh(true); }));
    wrap.appendChild(btn('MEM ALGO', 'mem', 'MEM ALGO strategies with signals, stop/target and a backtest', S.mem, function (b) { S.mem = !S.mem; b.classList.toggle('on', S.mem); sel.style.display = S.mem ? '' : 'none'; save(); refresh(true); }));
    var sel = document.createElement('select'); sel.className = 'sml-cat-sel'; sel.title = 'MEM ALGO strategy'; sel.style.display = S.mem ? '' : 'none';
    var modes = MEM && MEM.STRATEGIES ? Object.keys(MEM.STRATEGIES) : [];
    modes.forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = MEM.STRATEGIES[k].label || k; if (k === S.mode) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { S.mode = sel.value; save(); refresh(true); });
    wrap.appendChild(sel);
    wrap.appendChild(btn('CANDLES', 'cand', 'Name every candlestick pattern on the visible candles', S.candles, function (b) { S.candles = !S.candles; b.classList.toggle('on', S.candles); save(); refresh(true); }));
    wrap.appendChild(btn('OPTIONS CALC', 'opt', 'Options price and Greeks calculator', false, function () { openCalc(); }));
    bar.appendChild(wrap);
  }

  /* ---------------- analysis (cached per chart state) ---------------- */
  function refresh(force) {
    var bars = barsMs(), n = bars.length;
    var last = n ? bars[n - 1] : null;
    var k = A.symbol() + '|' + tf() + '|' + n + '|' + (last ? last.t + ':' + last.c : '') + '|' + S.mode;
    if (!force && k === S.key) { paint(); return; }
    S.key = k;
    S.a = (S.smc && SM && n >= 25 && !isDemo()) ? SM.analyze(bars) : null;
    S.mem_r = null;
    if (S.mem && MEM && n >= 60 && !isDemo()) { try { S.mem_r = MEM.analyze(bars, S.mode, {}, memTf(), {}); } catch (e) { S.mem_r = null; } }
    S.cand = (S.candles && PAT && n >= 20 && !isDemo()) ? (PAT.detect(bars) || {}).candles || [] : null;
    paintCard();
    paint();
  }

  /* ---------------- side card (SMC read + MEM ALGO stats) ---------------- */
  var cardOpen = true;
  function paintCard() {
    var parts = [];
    if (isDemo() && (S.smc || S.mem || S.candles)) parts.push('<ul><li class="warn">This chart is showing sample candles, so the tools are paused until real data loads.</li></ul>');
    if (S.smc && S.a) {
      var lines = SM.read(S.a);
      parts.push('<ul>' + (lines.length ? lines.map(function (l) { return '<li class="' + esc(l.tone) + '">' + esc(l.text) + '</li>'; }).join('') : '<li>Not enough candles to read structure yet.</li>') + '</ul>');
    }
    if (S.mem && S.mem_r) {
      var r = S.mem_r, st = r.stats || {}, oos = r.outOfSample || {};
      var bias = { long: 'Bullish', short: 'Bearish', pullback: 'Pullback in an uptrend', bounce: 'Bounce in a downtrend', warming: 'Warming up' }[r.bias] || r.bias;
      var pct = function (v) { return v == null ? '–' : Math.round(v * 100) + '%'; };
      var rr = function (v) { return v == null ? '–' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + 'R'; };
      parts.push('<div class="kv"><span>MEM ALGO · ' + esc((MEM.STRATEGIES[S.mode] || {}).label || S.mode) + '</span><span>' + esc(bias) + '</span>'
        + '<span>Latest signal</span><span>' + (r.latest ? (r.latest.dir > 0 ? 'BUY' : 'SELL') + (r.latest.conf ? ' · ' + esc(r.latest.conf.grade) : '') : 'none') + '</span>'
        + '<span>Trades tested</span><span>' + (st.trades || 0) + '</span><span>Win rate</span><span>' + pct(st.winRate) + '</span>'
        + '<span>Average per trade</span><span>' + rr(st.expectancyR) + '</span><span>Unseen data (last 30%)</span><span>' + pct(oos.winRate) + ' · ' + rr(oos.expectancyR) + '</span></div>'
        + (r.enoughData ? '' : '<small>Too few candles for a reliable backtest on this timeframe.</small>'));
    } else if (S.mem && !isDemo()) parts.push('<div class="kv"><span>MEM ALGO</span><span>needs at least 60 candles</span></div>');
    if (S.candles && S.cand) parts.push('<div class="kv"><span>Candlestick patterns</span><span>' + S.cand.length + ' found</span></div>');
    if (!parts.length) { if (card) card.style.display = 'none'; return; }
    if (!card) {
      card = document.createElement('aside'); card.className = 'sml-cat-card';
      card.addEventListener('click', function (e) { if (e.target.closest('header')) { cardOpen = !cardOpen; paintCard(); } });
      host.appendChild(card);
    }
    card.style.display = 'block';
    card.innerHTML = '<header><b>ACADEMY TOOLS</b><span>' + (cardOpen ? 'hide' : 'show') + '</span></header>' + (cardOpen ? parts.join('') + '<small>Educational: shows what price did and how a rule-based model would have traded it. Not advice.</small>' : '');
  }

  /* ---------------- drawing ---------------- */
  function size() {
    var w = host.clientWidth, h = host.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { w: w, h: h };
  }
  function text(t, x, y, color, align, sz) { ctx.font = '800 ' + (sz || 10) + 'px ui-monospace,monospace'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(t, x, y); }
  function box(x1, y1, x2, y2, fill, stroke, dash) { var l = Math.min(x1, x2), t = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.max(1.5, Math.abs(y2 - y1)); ctx.fillStyle = fill; ctx.fillRect(l, t, w, h); if (stroke) { ctx.save(); if (dash) ctx.setLineDash(dash); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(l + .5, t + .5, w - 1, h - 1); ctx.restore(); } }

  function paint() {
    if (!canvas) return;
    var dim = size();
    var v = A.view(); if (!v || !v.spacing) return;
    var bars = A.bars() || [], n = bars.length; if (!n) return;
    var from = Math.max(0, v.from), to = Math.min(n, v.to);
    var x = function (i) { return A.barX(i - v.from); }, y = function (p) { return A.priceY(p); };
    var left = v.pad.left, right = dim.w - v.pad.right, top = v.pad.top, bottom = v.priceBottom;
    var inY = function (p) { return p >= v.yMin && p <= v.yMax; }, vis = function (i) { return i >= from - 1 && i <= to + 1; };
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();

    if (S.smc && S.a) {
      var a = S.a, half = v.spacing / 2;
      // VWAP + 1/2 deviation bands
      var line = function (get, style, w, dash) { ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); var pen = false, prevDay = null; for (var i = from; i < to; i++) { var q = a.vwap[i]; if (!q) { pen = false; continue; } var tt = Number(bars[i].t), d = SM.dayKey(tt < 1e12 ? tt * 1000 : tt); if (a.intraday && d !== prevDay) pen = false; prevDay = d; var py = y(get(q)); if (!pen) { ctx.moveTo(x(i), py); pen = true; } else ctx.lineTo(x(i), py); } ctx.stroke(); ctx.restore(); };
      line(function (q) { return q.vwap + 2 * q.sd; }, 'rgba(255,209,102,.28)', 1, [3, 4]); line(function (q) { return q.vwap - 2 * q.sd; }, 'rgba(255,209,102,.28)', 1, [3, 4]);
      line(function (q) { return q.vwap + q.sd; }, 'rgba(255,209,102,.45)', 1); line(function (q) { return q.vwap - q.sd; }, 'rgba(255,209,102,.45)', 1);
      // open imbalances closest to price
      a.fvg.filter(function (g) { return g.filledAt == null && vis(g.i) && (inY(g.top) || inY(g.bottom)); })
        .sort(function (p, q) { return Math.abs((p.top + p.bottom) / 2 - a.last) - Math.abs((q.top + q.bottom) / 2 - a.last); }).slice(0, 8)
        .forEach(function (g) { var x1 = Math.max(left, x(g.i - 1) - half), c = g.dir > 0 ? '0,208,132' : '255,84,112'; box(x1, y(g.top), right, y(g.bottom), 'rgba(' + c + ',.11)', 'rgba(' + c + ',.55)', [2, 3]); text('FVG', Math.min(right - 28, x1 + 3), y(g.top) + 7, 'rgb(' + c + ')', 'left', 9); });
      // order blocks still intact
      a.structure.orderBlocks.filter(function (o) { return o.invalidAt == null && (inY(o.top) || inY(o.bottom)); }).slice(-4)
        .forEach(function (o) { var x1 = Math.max(left, x(o.i) - half), c = o.dir > 0 ? '77,195,255' : '255,170,60'; box(x1, y(o.top), right, y(o.bottom), 'rgba(' + c + ',.14)', 'rgba(' + c + ',.7)'); text(o.dir > 0 ? 'DEMAND' : 'SUPPLY', Math.min(right - 50, x1 + 3), y(o.top) + 8, 'rgb(' + c + ')', 'left', 9); });
      // resting liquidity
      a.liquidity.forEach(function (l) { if (l.takenAt != null || !inY(l.level)) return; var col = l.kind === 'EQH' ? '#ff9f6b' : '#6bd0ff', yy = y(l.level); ctx.save(); ctx.setLineDash([1, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(Math.max(left, x(l.first)), yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.restore(); text(l.kind + ' x' + l.count + (l.sweptAt != null ? ' swept' : ' · stops'), right - 6, yy + (l.kind === 'EQH' ? -8 : 9), col, 'right', 9); });
      // structure breaks
      a.structure.events.filter(function (e) { return vis(e.idx) && inY(e.level); }).slice(-6).forEach(function (e) { var x1 = Math.max(left, x(e.fromIdx)), x2 = x(e.idx), yy = y(e.level), col = e.dir > 0 ? '#5df0b0' : '#ff8ea1'; ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x2, yy); ctx.stroke(); ctx.restore(); text(e.type, (x1 + x2) / 2, yy + (e.dir > 0 ? -8 : 9), col, 'center', 9); });
      // absorption: heavy volume, no progress
      a.flags.filter(function (f) { return f.kind === 'absorption' && vis(f.i); }).forEach(function (f) { var px = x(f.i), py = y(+bars[f.i].l) + 12; ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 5, py); ctx.closePath(); ctx.fill(); text('ABS', px, py + 13, '#ffd166', 'center', 8); });
    }

    if (S.mem && S.mem_r) {
      var r = S.mem_r, ind = r.ind;
      [['fast', '#4dd8ff', 1.4], ['slow', '#ffa94d', 1.4], ['trend', 'rgba(170,185,195,.8)', 2]].forEach(function (s) {
        var arr = ind[s[0]]; if (!arr) return; ctx.save(); ctx.strokeStyle = s[1]; ctx.lineWidth = s[2]; ctx.beginPath(); var pen = false;
        for (var i = from; i < to; i++) { var val = arr[i]; if (!isFinite(val)) { pen = false; continue; } if (!pen) { ctx.moveTo(x(i), y(val)); pen = true; } else ctx.lineTo(x(i), y(val)); }
        ctx.stroke(); ctx.restore();
      });
      r.signals.forEach(function (sg) {
        if (!vis(sg.i)) return; var buy = sg.dir > 0, px = x(sg.i), py = buy ? y(+bars[sg.i].l) + 12 : y(+bars[sg.i].h) - 12;
        ctx.fillStyle = buy ? '#00d084' : '#ff5470'; ctx.beginPath();
        if (buy) { ctx.moveTo(px, py - 7); ctx.lineTo(px - 6, py + 4); ctx.lineTo(px + 6, py + 4); } else { ctx.moveTo(px, py + 7); ctx.lineTo(px - 6, py - 4); ctx.lineTo(px + 6, py - 4); }
        ctx.closePath(); ctx.fill(); text((buy ? 'BUY' : 'SELL') + (sg.conf ? ' ' + sg.conf.grade : ''), px, buy ? py + 14 : py - 12, buy ? '#00d084' : '#ff5470', 'center', 9);
      });
      var lv = r.open ? { stop: r.open.stop, target: r.open.target } : (r.latest && r.bars - 1 - r.latest.i <= 30 ? { stop: r.latest.stop, target: r.latest.target } : null);
      if (lv) [['STOP', lv.stop, '#ff5470'], ['TARGET', lv.target, '#00d084']].forEach(function (q) { if (q[1] == null || !inY(q[1])) return; var yy = y(q[1]); ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = q[2]; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.restore(); text(q[0] + ' ' + Number(q[1]).toFixed(2), left + 4, yy - 7, q[2], 'left', 9); });
    }

    if (S.candles && S.cand) {
      var placed = {};
      S.cand.forEach(function (c) {
        if (!vis(c.i)) return; var b = bars[c.i]; var up = c.dir === 'bullish', down = c.dir === 'bearish';
        var col = up ? '#5df0b0' : down ? '#ff8ea1' : '#cbd5dc'; var py = up ? y(+b.l) + 22 : y(+b.h) - 22; var slot = c.i + (up ? 'u' : 'd'); var k2 = placed[slot] = (placed[slot] || 0) + 1;
        text(c.label, x(c.i), py + (up ? 1 : -1) * (k2 - 1) * 11, col, 'center', 9);
      });
    }
    ctx.restore();

    // bar-close countdown under the right axis (the only always-on piece)
    var ms = TF_MS[tf()] || TF_MS[tf().toLowerCase()];
    var lastBar = bars[n - 1];
    if (ms && lastBar && ms < 864e5) {
      var t0 = Number(lastBar.t); t0 = t0 < 1e12 ? t0 * 1000 : t0;
      var leftMs = t0 + ms - Date.now();
      if (leftMs > 0 && leftMs <= ms) {
        var s2 = Math.floor(leftMs / 1000), lbl = (s2 >= 3600 ? Math.floor(s2 / 3600) + ':' : '') + String(Math.floor(s2 % 3600 / 60)).padStart(2, '0') + ':' + String(s2 % 60).padStart(2, '0');
        var yy = Math.min(bottom - 8, y(+lastBar.c) + 17);
        ctx.font = '700 10px ui-monospace,monospace'; var w = ctx.measureText(lbl).width + 8;
        ctx.fillStyle = '#17303c'; ctx.fillRect(right + 1, yy - 8, w, 16); text(lbl, right + 5, yy, '#9fb4c0', 'left', 10);
      }
    }
  }

  /* ---------------- options calculator ---------------- */
  var calcEl = null;
  function openCalc() {
    if (!OPT) return;
    if (calcEl) { calcEl.style.display = 'block'; run(); return; }
    calcEl = document.createElement('div'); calcEl.className = 'sml-cat-opt';
    var bars = A.bars() || [], last = bars.length ? +bars[bars.length - 1].c : 100;
    calcEl.innerHTML = '<header><b>OPTIONS CALCULATOR · ' + esc(A.symbol()) + '</b><button type="button" aria-label="Close">×</button></header>'
      + '<div class="g"><label>Type<select data-k="type"><option value="call">Call</option><option value="put">Put</option></select></label>'
      + '<label>Stock price<input data-k="S" type="number" step="0.01" value="' + last.toFixed(2) + '"></label>'
      + '<label>Strike<input data-k="K" type="number" step="0.5" value="' + (Math.round(last * 1.05 * 2) / 2).toFixed(2) + '"></label>'
      + '<label>Days to expiry<input data-k="days" type="number" step="1" value="30"></label>'
      + '<label>Implied vol %<input data-k="iv" type="number" step="1" value="45"></label>'
      + '<label>Rate %<input data-k="r" type="number" step="0.1" value="4.3"></label></div>'
      + '<div class="out"></div><small>Black-Scholes estimate for education. Real option prices also depend on supply, demand and early exercise.</small>';
    document.body.appendChild(calcEl);
    calcEl.querySelector('header button').addEventListener('click', function () { calcEl.style.display = 'none'; });
    calcEl.addEventListener('input', run);
    run();
  }
  function run() {
    var g = function (k) { return calcEl.querySelector('[data-k="' + k + '"]').value; };
    var type = g('type'), S0 = +g('S'), K = +g('K'), T = Math.max(0, +g('days')) / 365, iv = +g('iv') / 100, r = +g('r') / 100;
    var p = OPT.price(type, S0, K, T, r, 0, iv);
    var out = calcEl.querySelector('.out');
    if (!p) { out.innerHTML = '<span>Check the inputs</span><span></span>'; return; }
    var be = type === 'call' ? K + p.price : K - p.price;
    var f = function (v, d) { return isFinite(v) ? Number(v).toFixed(d == null ? 2 : d) : '–'; };
    out.innerHTML = '<span>Price per share</span><span>$' + f(p.price) + '</span><span>Cost per contract</span><span>$' + f(p.price * 100, 0) + '</span>'
      + '<span>Breakeven at expiry</span><span>$' + f(be) + '</span><span>Chance it ends in the money</span><span>' + f(p.probITM * 100, 0) + '%</span>'
      + '<span>Delta · Gamma</span><span>' + f(p.delta, 3) + ' · ' + f(p.gamma, 4) + '</span><span>Theta per day · Vega</span><span>' + f(p.theta, 3) + ' · ' + f(p.vega, 3) + '</span>';
  }

  /* ---------------- mount ---------------- */
  var tries = 0;
  (function mount() {
    A = window.SMLLC && window.SMLLC.api;
    host = A && A.host && A.host();
    if (!A || typeof A.onRender !== 'function' || !host || !document.contains(host)) { if (++tries < 200) setTimeout(mount, 150); return; }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    layer = document.createElement('div'); layer.className = 'sml-cat-layer';
    canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); canvas.style.position = 'absolute'; canvas.style.left = '0'; canvas.style.top = '0';
    layer.appendChild(canvas); host.appendChild(layer);
    buildToolbar();
    A.onRender(function () { refresh(false); });
    setInterval(function () { if (!document.hidden) paint(); }, 1000); // keeps the countdown ticking between renders
    refresh(true);
  })();
})();
