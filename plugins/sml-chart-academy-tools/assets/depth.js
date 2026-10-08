/* Order-book walls, position cost distribution and tape statistics on the site's LoopCharts chart.
   Data: the dashboard's own Level 2 controller already polls /sml-scanner/v1/market-v2 (moomoo book + ticks). This file does NOT poll it again;
   it reads the same responses as they arrive, so the feed's upstream load is unchanged. Daily candles for the cost estimate come from the
   chart's own history service, once per symbol per 10 minutes. Educational display only. */
(function () {
  'use strict';
  if (window.__smlChartDepthTools) return;
  window.__smlChartDepthTools = true;

  var KEY = 'sml-cat-depth-v1';
  var S = { walls: false, cost: false, tape: false, book: null, bookSym: '', bookAt: 0, ticks: {}, tickSym: '', stats: null, cost: null, costSym: '', costAt: 0, costBusy: false };
  try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.walls = !!v.walls; S.cost = !!v.cost; S.tape = !!v.tape; } } catch (e) { /* storage blocked */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ walls: S.walls, cost: S.cost, tape: S.tape })); } catch (e) { /* ignore */ } }
  function num(v, d) { return isFinite(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }) : '–'; }
  function compact(v) { return isFinite(v) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '–'; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var A = null, host = null, canvas = null, ctx = null;
  function sym() { return String((A && A.symbol && A.symbol()) || '').toUpperCase(); }

  /* ---- live book + trades: the same request the Level 2 panel makes (same symbol/depth/ticks), so the server answers from its shared
     cache and the moomoo feed sees no extra load. Polled only while WALLS or TAPE is on and the tab is visible. ---- */
  function marketOpen() {
    try { var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()), c = {};
      p.forEach(function (x) { c[x.type] = x.value; }); var m = +c.hour * 60 + +c.minute; return ['Sat', 'Sun'].indexOf(c.weekday) < 0 && m >= 240 && m < 1200; } catch (e) { return true; }
  }
  var busy = false;
  function pull(force) {
    if (busy || document.hidden || !(S.walls || S.tape) || !sym()) return;
    var have = S.books && S.books[sym()];
    if (!force && !marketOpen() && have) return; // closed: one snapshot is enough
    busy = true;
    fetch('/wp-json/sml-scanner/v1/market-v2?symbol=' + encodeURIComponent(sym()) + '&depth=20&ticks=' + (marketOpen() ? 50 : 0) + '&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) ingest(d); }).catch(function () {}).then(function () { busy = false; });
  }
  setInterval(function () { pull(false); }, 4000);

  function ingest(d) {
    if (!d || !d.available || !d.book) return;
    var s = String(d.symbol || '').toUpperCase();
    // books are kept per symbol: the Level 2 panel and the chart can briefly be on different tickers
    S.books = S.books || {};
    S.books[s] = { book: d.book, at: Date.now(), last: d.snapshot ? Number(d.snapshot.current != null ? d.snapshot.current : d.snapshot.last_price) : null };
    if (s !== S.tickSym) { S.ticks = {}; S.tickSym = s; S.since = Date.now(); }
    (d.ticks || []).forEach(function (t) { if (t && t.id != null && !S.ticks[t.id]) S.ticks[t.id] = { t: Number(t.timestamp_ms) || Date.now(), price: Number(t.price), size: Number(t.size) || 0, dir: String(t.direction || '').toUpperCase() }; });
    var ids = Object.keys(S.ticks); if (ids.length > 5000) { ids.sort(function (a, b) { return S.ticks[a].t - S.ticks[b].t; }).slice(0, ids.length - 5000).forEach(function (k) { delete S.ticks[k]; }); }
    S.stats = stats();
    if (S.tape) paintTape();
    if (S.walls) paint();
  }

  /* ---- tape statistics from the ticks seen since this symbol was opened ---- */
  function stats() {
    var list = Object.keys(S.ticks).map(function (k) { return S.ticks[k]; }); if (!list.length) return null;
    var st = { count: 0, vol: 0, notional: 0, buy: 0, sell: 0, neu: 0, pv: {}, big: [], rate60: 0 }, now = Date.now();
    list.forEach(function (t) {
      st.count++; st.vol += t.size; st.notional += t.size * t.price;
      if (t.dir === 'BUY') st.buy += t.size; else if (t.dir === 'SELL') st.sell += t.size; else st.neu += t.size;
      var step = t.price >= 100 ? 0.5 : t.price >= 20 ? 0.1 : t.price >= 5 ? 0.05 : 0.01, k = (Math.round(t.price / step) * step).toFixed(2);
      st.pv[k] = (st.pv[k] || 0) + t.size;
      if (t.size * t.price >= 50000 && t.size >= 500) st.big.push(t);
      if (now - t.t < 60000) st.rate60++;
    });
    st.vwap = st.vol > 0 ? st.notional / st.vol : null;
    st.big.sort(function (a, b) { return b.size * b.price - a.size * a.price; }); st.big = st.big.slice(0, 3);
    st.pvList = Object.keys(st.pv).map(function (k) { return { price: +k, vol: st.pv[k] }; }).sort(function (a, b) { return b.vol - a.vol; }).slice(0, 8);
    return st;
  }

  function paintTape() {
    var panel = document.getElementById('l2'); if (!panel) return;
    var box = document.getElementById('sml-cat-tape');
    if (!S.tape) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'sml-cat-tape'; panel.appendChild(box); }
    var st = S.stats, symNow = sym();
    if (!st || S.tickSym !== symNow) { box.innerHTML = '<h4>TRADE STATISTICS · LIVE</h4><small>Collecting trades. The buy / sell split, VWAP and volume by price fill in as prints arrive (during market hours).</small>'; return; }
    var tot = Math.max(1, st.buy + st.sell + st.neu), pb = st.buy / tot * 100, ps = st.sell / tot * 100, pn = 100 - pb - ps, maxPv = Math.max.apply(null, st.pvList.map(function (p) { return p.vol; }).concat([1]));
    box.innerHTML = '<h4>TRADE STATISTICS · SINCE ' + esc(new Date(S.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) + '</h4>'
      + '<div class="cols"><span class="up">↑ AT ASK ' + compact(st.buy) + '</span><span class="nu">◆ ' + compact(st.neu) + '</span><span class="dn">↓ AT BID ' + compact(st.sell) + '</span></div>'
      + '<div class="flow"><i style="width:' + pb.toFixed(1) + '%;background:#00d084"></i><i style="width:' + pn.toFixed(1) + '%;background:#6f8794"></i><i style="width:' + ps.toFixed(1) + '%;background:#ff5470"></i></div>'
      + '<div class="kv"><span>Buying vs selling</span><span class="' + (pb >= ps ? 'up' : 'dn') + '">' + pb.toFixed(0) + '% · ' + ps.toFixed(0) + '%</span>'
      + '<span>Average price (VWAP)</span><span>$' + num(st.vwap) + '</span><span>Trades · shares</span><span>' + num(st.count, 0) + ' · ' + compact(st.vol) + '</span>'
      + '<span>Trades in the last minute</span><span>' + num(st.rate60, 0) + '</span></div>'
      + '<h4>VOLUME BY PRICE</h4><div class="pv">' + st.pvList.slice().sort(function (a, b) { return b.price - a.price; }).map(function (p) { return '<span>' + num(p.price) + '</span><b style="width:' + Math.max(4, p.vol / maxPv * 100).toFixed(0) + '%"></b><span>' + compact(p.vol) + '</span>'; }).join('') + '</div>'
      + (st.big.length ? '<h4>BIGGEST PRINTS</h4>' + st.big.map(function (b) { return '<div class="' + (b.dir === 'BUY' ? 'up' : b.dir === 'SELL' ? 'dn' : 'nu') + '">' + (b.dir === 'BUY' ? '↑' : b.dir === 'SELL' ? '↓' : '◆') + ' ' + num(b.size, 0) + ' @ $' + num(b.price) + '</div>'; }).join('') : '')
      + '<small>At ask = buyer paid the offer, at bid = seller hit the bid. Counted from the live trades seen since this ticker was opened. Educational only.</small>';
  }

  /* ---- cost distribution (estimated from a year of daily candles, aged by turnover) ---- */
  function computeCost(bars) {
    var b = bars.slice(-260).filter(function (x) { return +x.h > 0 && +x.l > 0 && +x.v >= 0; });
    if (b.length < 30) return null;
    var lo = Infinity, hi = -Infinity; b.forEach(function (x) { lo = Math.min(lo, +x.l); hi = Math.max(hi, +x.h); });
    var BINS = 120, step = (hi - lo) / BINS || 1, chips = new Array(BINS).fill(0);
    var vols = b.map(function (x) { return +x.v; }).sort(function (p, q) { return p - q; }), med = vols[Math.floor(vols.length / 2)] || 1, floatEst = med * 30;
    b.forEach(function (x) {
      var turn = Math.min(0.9, (+x.v || 0) / floatEst), i;
      for (i = 0; i < BINS; i++) chips[i] *= 1 - turn;
      var l = +x.l, h = +x.h, mode = (l + h + (+x.c)) / 3, wsum = 0, w = new Array(BINS).fill(0);
      for (i = 0; i < BINS; i++) { var p = lo + (i + 0.5) * step; if (p < l - step || p > h + step) continue; var tri = p <= mode ? (p - l + step) / (mode - l + step) : (h + step - p) / (h + step - mode); w[i] = Math.max(0, tri); wsum += w[i]; }
      if (wsum <= 0) return; var add = (+x.v || 0) / wsum; for (i = 0; i < BINS; i++) chips[i] += w[i] * add;
    });
    var total = chips.reduce(function (p, q) { return p + q; }, 0); if (!(total > 0)) return null;
    var last = +b[b.length - 1].c, avg = 0, prof = 0;
    for (var i = 0; i < BINS; i++) { var p = lo + (i + 0.5) * step; avg += p * chips[i]; if (p <= last) prof += chips[i]; }
    var pct = function (q) { var acc = 0; for (var j = 0; j < BINS; j++) { acc += chips[j]; if (acc / total >= q) return lo + (j + 0.5) * step; } return hi; };
    return { lo: lo, hi: hi, step: step, chips: chips, max: Math.max.apply(null, chips), avg: avg / total, profit: prof / total, r70: [pct(0.15), pct(0.85)], r90: [pct(0.05), pct(0.95)], last: last };
  }
  function loadCost() {
    var s = sym(); if (!s || S.costBusy || (S.costSym === s && Date.now() - S.costAt < 600000)) return;
    S.costBusy = true;
    fetch('https://stockmarketloop-loop-kick.onrender.com/api/history?symbol=' + encodeURIComponent(s) + '&tf=1D', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { S.costData = d && Array.isArray(d.bars) ? computeCost(d.bars) : null; S.costSym = s; S.costAt = Date.now(); })
      .catch(function () { S.costData = null; })
      .then(function () { S.costBusy = false; paint(); });
  }

  /* ---- drawing ---- */
  function pill(t, x, y, fg, bg, alignRight) {
    ctx.font = '800 11px ui-monospace,monospace'; var w = ctx.measureText(t).width + 12, h = 17, left = alignRight ? x - w : x;
    ctx.fillStyle = bg; ctx.fillRect(left, y - h / 2, w, h); ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, left + 6, y + 0.5);
  }
  function walls(book) {
    var out = [];
    var side = function (levels, kind) {
      var sizes = levels.map(function (l) { return Number(l.size); }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; }); if (sizes.length < 4) return;
      var med = sizes[Math.floor(sizes.length / 2)];
      levels.forEach(function (l) { var s = Number(l.size); if (s >= Math.max(2 * med, 100)) out.push({ kind: kind, price: Number(l.price), size: s }); });
    };
    side(book.bids || [], 'bid'); side(book.asks || [], 'ask');
    return out.sort(function (a, b) { return b.size - a.size; }).slice(0, 4);
  }
  function paint() {
    if (!canvas) return;
    var w = host.clientWidth, h = host.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!(S.walls || S.cost) || (A.quality && A.quality() === 'demo')) return;
    var v = A.view(); if (!v || !v.pad) return;
    var left = v.pad.left, right = w - v.pad.right, top = v.pad.top, bottom = v.priceBottom, pw = right - left;
    var y = function (p) { return A.priceY(p); }, inY = function (p) { return p >= v.yMin && p <= v.yMax; };
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, pw, bottom - top); ctx.clip();

    if (S.cost && S.costData && S.costSym === sym()) {
      var c = S.costData, maxW = pw * 0.22;
      for (var i = 0; i < c.chips.length; i++) {
        var p = c.lo + (i + 0.5) * c.step; if (!inY(p)) continue;
        var bw = c.chips[i] / c.max * maxW, yy = y(p), bh = Math.max(2, Math.abs(y(p - c.step / 2) - y(p + c.step / 2)));
        ctx.fillStyle = p <= c.last ? 'rgba(0,208,132,.36)' : 'rgba(255,84,112,.36)'; ctx.fillRect(left, yy - bh / 2, bw, Math.max(1.5, bh - 0.5));
      }
      if (inY(c.avg)) { var ya = y(c.avg); ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(left, ya); ctx.lineTo(right, ya); ctx.stroke(); ctx.restore(); pill('AVG COST $' + num(c.avg), left + 6, ya - 12, '#241a00', '#ffd166'); }
      var lines = ['COST DISTRIBUTION (est.)', Math.round(c.profit * 100) + '% of shares in profit', '90% held $' + num(c.r90[0]) + ' – $' + num(c.r90[1]), '70% held $' + num(c.r70[0]) + ' – $' + num(c.r70[1])];
      ctx.font = '700 10.5px ui-monospace,monospace'; var cw = Math.max.apply(null, lines.map(function (t) { return ctx.measureText(t).width; })) + 14, ch = lines.length * 15 + 8, cx = left + 6, cy = bottom - ch - 6;
      ctx.fillStyle = 'rgba(8,16,24,.88)'; ctx.fillRect(cx, cy, cw, ch); ctx.strokeStyle = '#2b5362'; ctx.strokeRect(cx + .5, cy + .5, cw - 1, ch - 1);
      lines.forEach(function (t, k) { ctx.fillStyle = k === 0 ? '#86a2b0' : k === 1 ? (c.profit >= 0.5 ? '#5df0b0' : '#ff8ea1') : '#dbe6ec'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, cx + 7, cy + 15 + k * 15); });
    }

    var bk = S.books && S.books[sym()];
    if (S.walls && bk && Date.now() - bk.at < 120000) {
      var book = bk.book, levels = [].concat((book.bids || []).map(function (l) { return { kind: 'bid', price: +l.price, size: +l.size }; }), (book.asks || []).map(function (l) { return { kind: 'ask', price: +l.price, size: +l.size }; }));
      var maxSize = Math.max.apply(null, levels.map(function (l) { return l.size; }).concat([1])), maxBar = pw * 0.2;
      levels.forEach(function (l) { if (!inY(l.price)) return; var bw = Math.max(3, l.size / maxSize * maxBar); ctx.fillStyle = l.kind === 'bid' ? 'rgba(0,208,132,.55)' : 'rgba(255,84,112,.55)'; ctx.fillRect(right - bw, y(l.price) - 2.5, bw, 5); });
      var lastY = -99, spot = bk.last;
      walls(book).filter(function (wl) { return inY(wl.price); }).sort(function (a, b) { return y(a.price) - y(b.price); }).forEach(function (wl) {
        var yy = y(wl.price), col = wl.kind === 'bid' ? '0,208,132' : '255,84,112', hex = wl.kind === 'bid' ? '#00d084' : '#ff5470';
        ctx.fillStyle = 'rgba(' + col + ',.18)'; ctx.fillRect(left, yy - 6, pw, 12);
        ctx.strokeStyle = hex; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
        var ly = Math.abs(yy - lastY) < 20 ? lastY + 20 : yy; lastY = ly;
        var dist = isFinite(spot) && spot ? (wl.price / spot - 1) * 100 : null;
        pill((wl.kind === 'bid' ? 'BID WALL ' : 'ASK WALL ') + num(wl.size, 0) + ' sh @ $' + num(wl.price) + (dist != null ? '  ' + (dist >= 0 ? '+' : '') + dist.toFixed(2) + '%' : ''), right - maxBar - 8, ly, '#04140d', hex, true);
      });
    }
    ctx.restore();
  }

  /* ---- mount ---- */
  var css = document.createElement('style');
  css.id = 'sml-dashboard-chart-depth-css';
  css.textContent = '#sml-cat-tape{margin:8px 10px 10px;padding-top:8px;border-top:1px solid #1d2b41;font:600 11px system-ui,sans-serif;color:#c7d5dc}#sml-cat-tape h4{margin:6px 0 4px;font:800 9px ui-monospace,monospace;color:#86a2b0;letter-spacing:.06em}'
    + '#sml-cat-tape .flow{display:flex;height:9px;border-radius:5px;overflow:hidden;background:#16303a;margin:4px 0}#sml-cat-tape .flow i{display:block;height:100%}'
    + '#sml-cat-tape .cols{display:flex;justify-content:space-between;font:700 10px ui-monospace,monospace}#sml-cat-tape .up{color:#5df0b0}#sml-cat-tape .dn{color:#ff8ea1}#sml-cat-tape .nu{color:#9fb4c0}'
    + '#sml-cat-tape .kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0;font:600 10px ui-monospace,monospace}#sml-cat-tape .kv span:nth-child(odd){color:#8fa6b3}'
    + '#sml-cat-tape .pv{display:grid;grid-template-columns:56px 1fr 44px;gap:2px 6px;align-items:center;font:600 10px ui-monospace,monospace}#sml-cat-tape .pv b{display:block;height:6px;border-radius:3px;background:#3a7fa6}'
    + '#sml-cat-tape small{display:block;margin-top:5px;color:#6f8794;font-weight:500;font-size:9.5px;line-height:1.35}';
  document.head.appendChild(css);

  var tries = 0;
  (function mount() {
    A = window.SMLLC && window.SMLLC.api; host = A && A.host && A.host();
    var bar = document.getElementById('sml-cat-toolbar');
    if (!A || !host || !document.contains(host) || !bar) { if (++tries < 240) setTimeout(mount, 150); return; }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var layer = document.createElement('div'); layer.className = 'sml-cat-layer';
    canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); canvas.style.position = 'absolute'; canvas.style.left = '0'; canvas.style.top = '0';
    layer.appendChild(canvas); host.appendChild(layer);
    var mk = function (label, key, title) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'sml-cat-btn' + (S[key] ? ' on' : ''); b.textContent = label; b.title = title;
      b.addEventListener('click', function (e) { e.preventDefault(); S[key] = !S[key]; b.classList.toggle('on', S[key]); save(); if (key === 'cost' && S.cost) loadCost(); if (key === 'tape') paintTape(); if (key === 'walls' || key === 'tape') pull(true); paint(); });
      bar.appendChild(b);
    };
    mk('WALLS', 'walls', 'Bid and ask walls from the live order book, drawn on the chart');
    mk('COST', 'cost', 'Where holders bought: cost distribution, profit ratio and average cost (estimated from a year of daily candles)');
    mk('TAPE', 'tape', 'Live trade statistics under the Level 2 book: buying vs selling, VWAP, volume by price, biggest prints');
    var lastSym = '';
    A.onRender(function () { if (S.cost) loadCost(); if (sym() !== lastSym) { lastSym = sym(); pull(true); } paint(); });
    setTimeout(function () { pull(true); }, 1500);
    if (S.cost) loadCost(); if (S.tape) paintTape(); paint();
  })();
})();
