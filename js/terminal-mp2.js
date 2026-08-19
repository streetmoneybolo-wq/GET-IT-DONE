/* SML Terminal — Market Position v2.
   The legacy #sml-mp module renders a ~930px two-column layout (tall
   volume-profile canvas + stat cards) that never fit well anywhere on this
   page — replaced outright rather than patched. This is a brand-new card,
   built from the real public sml/v1/market-position endpoint (confirmed via
   the live page's own network requests — no other schema decoded, no
   assumption), styled from the design handoff (Ticker Terminal Export.html,
   "Market position" card), inserted directly under the chart card. */
(function () {
  'use strict';
  if (window.__smlTerminalMp2Booted) return;
  window.__smlTerminalMp2Booted = true;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtDate(iso) { var d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); }
  function num(n, dp) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(dp == null ? 3 : dp); }

  function card() {
    /* side-by-side row: compact Market position | Signals (both data-tv2-keep so
       terminal-adopt.js skips them) */
    var row = document.createElement('div');
    row.className = 'tv2-mpsig'; row.setAttribute('data-tv2-keep', '1');
    row.innerHTML =
      '<div class="tv2-mp2" data-tv2-keep="1">' +
        '<div class="tv2-mp2-h"><span class="t">Market position</span><span class="d" id="tv2mp2-range">' + esc(SYM) + '</span></div>' +
        '<div class="tv2-mp2-body" id="tv2mp2-body"><div class="tv2-mp2-empty">Loading market position…</div></div>' +
      '</div>' +
      '<div class="tv2-mp2 tv2-sig" data-tv2-keep="1">' +
        '<div class="tv2-mp2-h"><span class="t">Signals</span><span class="d" id="tv2sig-sum"></span></div>' +
        '<div class="tv2-sig-days" id="tv2sig-days"></div>' +
        '<div class="tv2-sig-body" id="tv2sig-body"><div class="tv2-mp2-empty">Computing signals…</div></div>' +
      '</div>';
    return row;
  }

  function render(el, d) {
    var body = el.querySelector('#tv2mp2-body');
    var range = el.querySelector('#tv2mp2-range');
    if (d.from && d.to) range.textContent = fmtDate(d.from) + ' – ' + fmtDate(d.to);

    var bins = Array.isArray(d.bins) ? d.bins : [];
    var lo = Number(d.lo), hi = Number(d.hi), cur = Number(d.current);
    var H = 150, N = bins.length;
    var barH = N ? Math.max(1.5, (H / N) - 0.6) : 0;
    var priceAt = function (t) { return hi - t * (hi - lo); }; // t=0 → hi (top), t=1 → lo (bottom)
    var topAt = function (price) { return hi > lo ? ((hi - price) / (hi - lo)) * H : 0; };

    var bars = bins.map(function (v, i) {
      var t = N > 1 ? i / (N - 1) : 0;
      var price = priceAt(t);
      var top = t * (H - barH);
      var w = Math.max(2, Math.min(1, v) * 100); // % of chart width
      var inProfit = cur ? price <= cur : true;
      var bg = inProfit ? 'linear-gradient(90deg,#0b5a3a,#00e07a)' : 'linear-gradient(90deg,#5a1a20,#ff4757)';
      return '<div class="tv2-mp2-bar" style="top:' + top.toFixed(1) + 'px;width:' + w.toFixed(1) + '%;height:' + barH.toFixed(1) + 'px;background:' + bg + '"></div>';
    }).join('');

    // reference lines (resistance/avg cost/support) can land within a few px of
    // each other — push their labels apart so they don't overlap, keeping each
    // line itself at its true price and just offsetting the text
    var refs = [
      { price: d.resistance, color: '#ff4757', label: 'Resistance' },
      { price: d.avgCost, color: '#ffb454', label: 'Avg cost' },
      { price: d.support, color: '#00ccff', label: 'Support' }
    ].filter(function (r) { return r.price != null && !isNaN(r.price) && hi > lo; })
     .map(function (r) { r.top = topAt(r.price); return r; })
     .sort(function (a, b) { return a.top - b.top; });
    var MIN_GAP = 13;
    if (refs.length) refs[0].labelTop = refs[0].top;
    for (var ri = 1; ri < refs.length; ri++) {
      refs[ri].labelTop = (refs[ri].top - refs[ri - 1].labelTop < MIN_GAP) ? refs[ri - 1].labelTop + MIN_GAP : refs[ri].top;
    }
    var refLines = refs.map(function (r) {
      var labelTop = r.labelTop < 16 ? r.labelTop : r.labelTop - 13;
      return '<div class="tv2-mp2-line" style="top:' + r.top.toFixed(1) + 'px;border-color:' + r.color + '"><span style="color:' + r.color + ';top:' + labelTop.toFixed(1) + 'px">' + esc(r.label) + ' ' + num(r.price) + '</span></div>';
    }).join('');

    var stats = [
      { k: 'Profit Ratio', v: d.profitRatio != null ? num(d.profitRatio, 2) + '%' : '—', c: '#00e07a' },
      { k: 'Resistance', v: num(d.resistance), c: '#ff4757' },
      { k: 'Average Cost', v: num(d.avgCost), c: '#ffb454' },
      { k: 'Support', v: num(d.support), c: '#00ccff' }
    ].map(function (s) {
      return '<div class="tv2-mp2-stat" style="border-color:' + s.c + '33"><span class="v" style="color:' + s.c + '">' + esc(s.v) + '</span><span class="k">' + esc(s.k) + '</span></div>';
    }).join('');

    var bullish = d.profitRatio != null && d.profitRatio >= 50;
    var lean = '';
    if (d.profitRatio != null && d.support != null && d.resistance != null) {
      lean = bullish
        ? '<b style="color:#00e07a">Bullish lean.</b> ' + num(d.profitRatio, 1) + '% of the float is in profit; holders above cost tend to hold. Watch support at ' + num(d.support) + '.'
        : '<b style="color:#ff4757">Bearish lean.</b> ' + num(100 - d.profitRatio, 1) + '% of the float is underwater; holders may cut losses. Watch resistance at ' + num(d.resistance) + '.';
    }

    var overlap = d.overlap != null ? Math.max(0, Math.min(100, d.overlap)) : null;
    var r90 = Array.isArray(d.r90) ? d.r90 : null;
    var r70 = Array.isArray(d.r70) ? d.r70 : null;

    body.innerHTML =
      '<div class="tv2-mp2-chart">' + bars + refLines + '</div>' +
      '<div class="tv2-mp2-stats">' + stats + '</div>' +
      (lean ? '<p class="tv2-mp2-lean">' + lean + '</p>' : '') +
      (overlap != null ? '<div class="tv2-mp2-ov"><div class="tv2-mp2-ov-h"><span class="k">Degree of overlap</span><span class="v">' + overlap + '%</span></div>' +
        '<div class="tv2-mp2-ov-bar"><i style="width:' + overlap + '%"></i></div>' +
        '<span class="tv2-mp2-ov-note">The greater the Degree of Overlap, the more concentrated the positions and the more moderate the stock price fluctuation.' +
        (r90 ? ' 90% range ' + num(r90[0]) + '–' + num(r90[1]) + '.' : '') + (r70 ? ' 70% range ' + num(r70[0]) + '–' + num(r70[1]) + '.' : '') + '</span></div>' : '');
  }

  function load(el, attempt) {
    attempt = attempt || 0;
    var to = new Date(), from = new Date(to.getTime() - 90 * 86400000);
    var fmt = function (dt) { return dt.toISOString().slice(0, 10); };
    fetch('/wp-json/sml/v1/market-position?symbol=' + encodeURIComponent(SYM) + '&from=' + fmt(from) + '&to=' + fmt(to), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) { render(el, d); })
      .catch(function () {
        /* transient (rate-limit / cold cache) → retry at 4s, 12s, 30s before giving up */
        if (attempt < 3) { setTimeout(function () { load(el, attempt + 1); }, [4000, 8000, 18000][attempt]); return; }
        el.querySelector('#tv2mp2-body').innerHTML = '<div class="tv2-mp2-empty">Market position isn’t available for ' + esc(SYM) + ' right now.</div>';
      });
  }

  /* ---- Signals: indicator intelligence computed from the site's own daily
     candles (/sml/v1/history?tf=1D). Plain math on real bars — nothing invented.
     The day pills pan the whole read-out back up to 5 trading days (bars are
     sliced locally, so panning is instant); every tile also carries a delta
     arrow vs the prior trading day so state changes stand out. */
  var SIG = { bars: null, day: 0, sel: null, btCache: {} };

  function fmtQty(n) { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(Math.round(n)); }
  function sigSmaAt(a, n, i) { if (i + 1 < n) return null; var s = 0; for (var j = i - n + 1; j <= i; j++) s += a[j]; return s / n; }
  function sigEmaSeries(a, n) { var out = [], k = 2 / (n + 1), e = null; for (var i = 0; i < a.length; i++) { e = e == null ? a[i] : a[i] * k + e * (1 - k); out.push(e); } return out; }
  function sigRsiAt(cl, n, i) {
    if (i < n) return null;
    var g = 0, l = 0;
    for (var j = 1; j <= n; j++) { var d = cl[j] - cl[j - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (j = n + 1; j <= i; j++) { var dd = cl[j] - cl[j - 1]; g = (g * (n - 1) + (dd > 0 ? dd : 0)) / n; l = (l * (n - 1) + (dd < 0 ? -dd : 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function sigAtrSeries(bars) {
    var out = [], atr = null;
    for (var i = 0; i < bars.length; i++) {
      var tr = i === 0 ? bars[0].h - bars[0].l : Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
      atr = atr == null ? tr : (atr * 13 + tr) / 14;
      out.push(atr);
    }
    return out;
  }
  function sigAdx(bars) { /* Wilder 14 — returns {adx,pdi,mdi} for the last bar */
    var n = 14;
    if (bars.length < n * 2 + 2) return null;
    var tr14 = 0, p14 = 0, m14 = 0, adx = null, dxSum = 0;
    var prev = bars[0];
    for (var i = 1; i < bars.length; i++) {
      var b = bars[i];
      var up = b.h - prev.h, dn = prev.l - b.l;
      var pdm = (up > dn && up > 0) ? up : 0;
      var mdm = (dn > up && dn > 0) ? dn : 0;
      var tr = Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c));
      if (i <= n) { tr14 += tr; p14 += pdm; m14 += mdm; }
      else { tr14 = tr14 - tr14 / n + tr; p14 = p14 - p14 / n + pdm; m14 = m14 - m14 / n + mdm; }
      if (i >= n) {
        var pdi = tr14 ? 100 * p14 / tr14 : 0, mdi = tr14 ? 100 * m14 / tr14 : 0;
        var dx = (pdi + mdi) ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
        if (i < n * 2) { dxSum += dx; if (i === n * 2 - 1) adx = dxSum / n; }
        else adx = adx == null ? dx : (adx * (n - 1) + dx) / n;
      }
      prev = b;
    }
    return { adx: adx, pdi: tr14 ? 100 * p14 / tr14 : 0, mdi: tr14 ? 100 * m14 / tr14 : 0 };
  }
  function sigStoch(bars) { /* slow stochastic 14,3,3 → {k,d} */
    if (bars.length < 22) return null;
    var raw = [];
    for (var i = 13; i < bars.length; i++) {
      var hi = -Infinity, lo = Infinity;
      for (var j = i - 13; j <= i; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; }
      raw.push(hi > lo ? (bars[i].c - lo) / (hi - lo) * 100 : 50);
    }
    var k3 = [];
    for (var q = 2; q < raw.length; q++) k3.push((raw[q] + raw[q - 1] + raw[q - 2]) / 3);
    if (k3.length < 3) return null;
    return { k: k3[k3.length - 1], d: (k3[k3.length - 1] + k3[k3.length - 2] + k3[k3.length - 3]) / 3 };
  }

  function computeAll(bars) {
    bars = bars.slice(-420); /* plenty for MA200 + 52w, keeps every pan instant */
    var cl = bars.map(function (b) { return b.c; });
    var i = cl.length - 1, last = cl[i];
    var tiles = [], bull = 0, bear = 0;
    function push(sec, name, val, chip, cls) { tiles.push({ sec: sec, n: name, v: val, chip: chip, cls: cls }); if (cls === 'bull') bull++; else if (cls === 'bear') bear++; }

    /* TREND */
    var ma20 = sigSmaAt(cl, 20, i), ma50 = sigSmaAt(cl, 50, i), ma200 = sigSmaAt(cl, 200, i);
    if (ma20 != null && ma50 != null) {
      var upT = last > ma20 && ma20 > ma50, dnT = last < ma20 && ma20 < ma50;
      push('Trend', 'MA 20 / 50', num(ma20, 2) + ' / ' + num(ma50, 2), upT ? 'Uptrend' : dnT ? 'Downtrend' : 'Mixed', upT ? 'bull' : dnT ? 'bear' : 'mid');
    }
    if (ma50 != null && ma200 != null) push('Trend', 'MA 50 / 200', num(ma50, 2) + ' / ' + num(ma200, 2), ma50 > ma200 ? 'Golden cross' : 'Death cross', ma50 > ma200 ? 'bull' : 'bear');
    var adx = sigAdx(bars);
    if (adx && adx.adx != null) {
      var dir = adx.pdi > adx.mdi;
      push('Trend', 'ADX 14', num(adx.adx, 1) + ' · +DI ' + num(adx.pdi, 1) + ' · −DI ' + num(adx.mdi, 1),
        adx.adx >= 25 ? (dir ? 'Strong uptrend' : 'Strong downtrend') : 'Weak / range',
        adx.adx >= 25 ? (dir ? 'bull' : 'bear') : 'mid');
    }

    /* MOMENTUM */
    var rsi = sigRsiAt(cl, 14, i);
    if (rsi != null) push('Momentum', 'RSI 14', num(rsi, 1),
      rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : rsi >= 55 ? 'Firm' : rsi <= 45 ? 'Soft' : 'Neutral',
      rsi >= 70 || rsi <= 30 ? 'warn' : rsi >= 55 ? 'bull' : rsi <= 45 ? 'bear' : 'mid');
    if (cl.length >= 35) {
      var e12 = sigEmaSeries(cl, 12), e26 = sigEmaSeries(cl, 26);
      var macd = []; for (var q2 = 0; q2 < cl.length; q2++) macd.push(e12[q2] - e26[q2]);
      var sl = sigEmaSeries(macd, 9);
      var m = macd[i], sg = sl[i], hist = m - sg;
      var crossed = i > 0 && ((m > sg) !== (macd[i - 1] > sl[i - 1]));
      push('Momentum', 'MACD 12·26·9', num(m, 2) + ' · hist ' + (hist >= 0 ? '+' : '') + num(hist, 2),
        m > sg ? (crossed ? 'Fresh bull cross' : 'Bullish') : (crossed ? 'Fresh bear cross' : 'Bearish'), m > sg ? 'bull' : 'bear');
    }
    var st = sigStoch(bars);
    if (st) push('Momentum', 'Stochastic 14·3·3', '%K ' + num(st.k, 1) + ' · %D ' + num(st.d, 1),
      st.k >= 80 ? 'Overbought' : st.k <= 20 ? 'Oversold' : st.k > st.d ? '%K above %D' : '%K below %D',
      st.k >= 80 || st.k <= 20 ? 'warn' : st.k > st.d ? 'bull' : 'bear');
    if (i >= 10) { var roc = (last - cl[i - 10]) / cl[i - 10] * 100; push('Momentum', 'ROC 10', (roc >= 0 ? '+' : '') + num(roc, 2) + '%', roc >= 0 ? 'Rising' : 'Falling', roc >= 0 ? 'bull' : 'bear'); }

    /* VOLATILITY */
    if (ma20 != null) {
      var dv = 0; for (var j2 = i - 19; j2 <= i; j2++) dv += Math.pow(cl[j2] - ma20, 2);
      var sd = Math.sqrt(dv / 20), bbU = ma20 + 2 * sd, bbL = ma20 - 2 * sd;
      var pb = bbU > bbL ? (last - bbL) / (bbU - bbL) : 0.5;
      var bw = ma20 ? (bbU - bbL) / ma20 * 100 : 0;
      push('Volatility', 'Bollinger 20·2σ', '%B ' + num(pb * 100, 0) + '% · width ' + num(bw, 1) + '%',
        pb > 1 ? 'Above upper' : pb < 0 ? 'Below lower' : bw < 4 ? 'Squeeze' : 'Within bands',
        pb > 1 || pb < 0 || bw < 4 ? 'warn' : 'mid');
    }
    var atrS = sigAtrSeries(bars);
    if (atrS.length > 6) {
      var atr = atrS[atrS.length - 1], atrPct = last ? atr / last * 100 : 0, atrPrev = atrS[atrS.length - 6];
      push('Volatility', 'ATR 14', num(atr, 2) + ' (' + num(atrPct, 2) + '%)',
        atr > atrPrev * 1.05 ? 'Vol rising' : atr < atrPrev * 0.95 ? 'Vol falling' : 'Vol steady', 'mid');
    }

    /* VOLUME */
    var pv = 0, tv = 0;
    for (var k2 = Math.max(0, i - 19); k2 <= i; k2++) { var b2 = bars[k2]; var px = (b2.vw != null ? b2.vw : (b2.h + b2.l + b2.c) / 3); pv += px * (b2.v || 0); tv += (b2.v || 0); }
    if (tv > 0) { var vw = pv / tv; push('Volume', '20-day VWAP', num(vw, 2), last >= vw ? 'Price above' : 'Price below', last >= vw ? 'bull' : 'bear'); }
    if (bars.length >= 25) {
      var obv = [0];
      for (var k3 = 1; k3 < bars.length; k3++) { var d3 = bars[k3].c - bars[k3 - 1].c; obv.push(obv[k3 - 1] + (d3 > 0 ? (bars[k3].v || 0) : d3 < 0 ? -(bars[k3].v || 0) : 0)); }
      var obvMa = sigSmaAt(obv, 20, obv.length - 1);
      if (obvMa != null) push('Volume', 'OBV vs 20-day', (obv[obv.length - 1] >= obvMa ? 'above' : 'below') + ' its average',
        obv[obv.length - 1] >= obvMa ? 'Accumulation' : 'Distribution', obv[obv.length - 1] >= obvMa ? 'bull' : 'bear');
    }
    if (tv > 0) {
      var avgV = tv / Math.min(20, i + 1), lastV = bars[i].v || 0, xV = avgV ? lastV / avgV : 0;
      push('Volume', 'Session volume', fmtQty(lastV) + ' · ' + num(xV, 2) + '× avg', xV >= 1.5 ? 'Heavy' : xV <= 0.5 ? 'Light' : 'Normal', xV >= 1.5 ? 'warn' : 'mid');
    }

    /* RANGE */
    if (bars.length >= 21) {
      var hi20 = -Infinity, lo20 = Infinity;
      for (var k4 = i - 20; k4 < i; k4++) { if (bars[k4].h > hi20) hi20 = bars[k4].h; if (bars[k4].l < lo20) lo20 = bars[k4].l; }
      if (last > hi20) push('Range', '20-day range', 'prior high ' + num(hi20, 2), 'Breakout high', 'bull');
      else if (last < lo20) push('Range', '20-day range', 'prior low ' + num(lo20, 2), 'Breakdown low', 'bear');
      else push('Range', '20-day range', num(lo20, 2) + ' – ' + num(hi20, 2), num((hi20 - last) / hi20 * 100, 1) + '% off high', 'mid');
    }
    if (bars.length >= 252) {
      var hi52 = -Infinity, lo52 = Infinity;
      for (var k5 = i - 251; k5 <= i; k5++) { if (bars[k5].h > hi52) hi52 = bars[k5].h; if (bars[k5].l < lo52) lo52 = bars[k5].l; }
      var offH = (hi52 - last) / hi52 * 100, offL = lo52 ? (last - lo52) / lo52 * 100 : 0;
      push('Range', '52-week range', num(lo52, 2) + ' – ' + num(hi52, 2),
        offH <= 1 ? 'At 52w high' : offL <= 1 ? 'At 52w low' : num(offH, 1) + '% off high',
        offH <= 1 ? 'bull' : offL <= 1 ? 'bear' : 'mid');
    }
    return { tiles: tiles, bull: bull, bear: bear, total: tiles.length };
  }

  function buildDayPills(row) {
    var host = row.querySelector('#tv2sig-days');
    var n = SIG.bars.length, html = '';
    for (var k = 5; k >= 0; k--) {
      var idx = n - 1 - k;
      if (idx < 40) continue;
      var d = new Date(SIG.bars[idx].t);
      var lbl = k === 0 ? 'Latest' : (d.getMonth() + 1) + '/' + d.getDate();
      html += '<button type="button" data-k="' + k + '" class="' + (k === SIG.day ? 'on' : '') + '">' + lbl + '</button>';
    }
    host.innerHTML = html;
    if (!host.__wired) {
      host.__wired = true;
      host.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-k]'); if (!b) return;
        SIG.day = Number(b.getAttribute('data-k')) || 0;
        buildDayPills(row); renderSignals(row);
      });
    }
  }

  /* ---- 1-year backtest: for every indicator, every session in the last 252
     trading days gets its state computed from the bars as they stood THAT day;
     clicking a tile shows how the next session went each time the indicator
     closed in its current state. Real history only — close-to-close moves. */
  function backtestStates(end) {
    if (SIG.btCache[end]) return SIG.btCache[end];
    var bars = SIG.bars.slice(0, end);
    var n = bars.length;
    var lookback = Math.min(252, n - 41);
    var states = [];
    for (var j = n - 1 - lookback; j < n - 1; j++) {
      var res = computeAll(bars.slice(0, j + 1));
      var map = {};
      res.tiles.forEach(function (t) { map[t.n] = t.chip; });
      states.push({ map: map, ret: bars[j].c ? bars[j + 1].c / bars[j].c - 1 : 0 });
    }
    SIG.btCache[end] = states;
    return states;
  }
  function btPanelHtml(cur, end) {
    var tile = null;
    for (var i2 = 0; i2 < cur.tiles.length; i2++) if (cur.tiles[i2].n === SIG.sel) tile = cur.tiles[i2];
    if (!tile) return '';
    var states = backtestStates(end);
    var hits = [], j2;
    for (j2 = 0; j2 < states.length; j2++) if (states[j2].map[tile.n] === tile.chip) hits.push(states[j2].ret);
    var rises = 0, falls = 0, sum = 0, maxR = null, maxF = null;
    for (j2 = 0; j2 < hits.length; j2++) {
      var r2 = hits[j2]; sum += r2;
      if (r2 > 0) rises++; if (r2 < 0) falls++;
      if (maxR == null || r2 > maxR) maxR = r2;
      if (maxF == null || r2 < maxF) maxF = r2;
    }
    var occ = hits.length;
    var pctf = function (x, sign) { return (sign && x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%'; };
    var head = '<div class="sig-bt"><div class="sig-bt-h"><span>' + esc(tile.n) + ' \u00b7 ' + esc(tile.chip) + '</span><button type="button" class="x" data-btclose title="Close backtest">\u2715</button></div>';
    if (!occ) return head + '<div class="sig-bt-s">This exact state did not occur in the previous ' + states.length + ' trading sessions \u2014 no year-long backtest to show.</div></div>';
    var rate = Math.round(rises / occ * 100);
    return head +
      '<div class="sig-bt-s">' + esc(tile.n) + ' closed \u201c' + esc(tile.chip) + '\u201d ' + occ + ' time' + (occ === 1 ? '' : 's') + ' over the last ' + states.length + ' sessions. The next session:</div>' +
      '<div class="sig-bt-grid">' +
        '<div class="big"><span class="pct ' + (rate >= 50 ? 'up' : 'dn') + '">' + rate + '%</span><span class="k">next-day rise rate</span></div>' +
        '<div class="st"><span>Occurrences</span><b>' + occ + '</b></div>' +
        '<div class="st"><span>Avg change</span><b class="' + (sum >= 0 ? 'up' : 'dn') + '">' + pctf(sum / occ, true) + '</b></div>' +
        '<div class="st"><span>Next-day rises</span><b class="up">' + rises + '</b></div>' +
        '<div class="st"><span>Max rise</span><b class="up">' + pctf(maxR, true) + '</b></div>' +
        '<div class="st"><span>Next-day falls</span><b class="dn">' + falls + '</b></div>' +
        '<div class="st"><span>Max fall</span><b class="dn">' + pctf(maxF, true) + '</b></div>' +
      '</div>' +
      '<div class="sig-bt-note">Backtest = every session in the last ' + states.length + ' trading days when ' + esc(tile.n) + ' closed in this exact state; \u201cnext-day\u201d is close\u2192close on the daily candles. For reference only \u2014 not investment advice.</div></div>';
  }

  function renderSignals(row) {
    var bars = SIG.bars; if (!bars) return;
    var end = bars.length - SIG.day;
    var body = row.querySelector('#tv2sig-body');
    if (end < 40) { body.innerHTML = '<div class="tv2-mp2-empty">Not enough daily history for ' + esc(SYM) + ' to compute signals.</div>'; return; }
    var cur = computeAll(bars.slice(0, end));
    var prev = end > 41 ? computeAll(bars.slice(0, end - 1)) : null;
    var rank = { bear: -1, warn: 0, mid: 0, bull: 1 };
    var prevMap = {};
    if (prev) prev.tiles.forEach(function (t) { prevMap[t.n] = t; });
    var score = cur.total ? Math.round((cur.bull - cur.bear) / cur.total * 100) : 0;
    var asOf = new Date(bars[end - 1].t);
    row.querySelector('#tv2sig-sum').textContent = cur.bull + ' bullish · ' + cur.bear + ' bearish' + (SIG.day > 0 ? ' · as of ' + (asOf.getMonth() + 1) + '/' + asOf.getDate() + ' close' : '');

    var bySec = {}, secOrder = [];
    cur.tiles.forEach(function (t) { if (!bySec[t.sec]) { bySec[t.sec] = []; secOrder.push(t.sec); } bySec[t.sec].push(t); });
    var html = '<div class="sig-gauge"><div class="sig-gauge-top"><span class="k">Composite bias</span><span class="v ' + (score > 15 ? 'bull' : score < -15 ? 'bear' : 'mid') + '">' + (score > 0 ? '+' : '') + score + '</span></div>' +
      '<div class="sig-gauge-track"><i style="left:' + (50 + score / 2) + '%"></i></div>' +
      '<div class="sig-gauge-lbl"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div></div>';
    secOrder.forEach(function (sec) {
      html += '<div class="sig-sec">' + esc(sec) + '</div><div class="sig-grid">';
      bySec[sec].forEach(function (t) {
        var pt = prevMap[t.n];
        var dd2 = pt ? (rank[t.cls] - rank[pt.cls]) : 0;
        var arrow = dd2 > 0 ? '<span class="dl up" title="improved vs the prior trading day">▲</span>' : dd2 < 0 ? '<span class="dl dn" title="weakened vs the prior trading day">▼</span>' : '';
        html += '<div class="sig-tile ' + t.cls + (SIG.sel === t.n ? ' sel' : '') + '" data-n="' + esc(t.n) + '" role="button" tabindex="0" title="Click for the 1-year backtest of this state"><div class="tt"><span class="n">' + esc(t.n) + '</span>' + arrow + '</div><div class="vv">' + esc(t.v) + '</div><div class="cc">' + esc(t.chip) + '</div></div>';
      });
      html += '</div>';
      if (SIG.sel && bySec[sec].some(function (t2) { return t2.n === SIG.sel; })) html += btPanelHtml(cur, end);
    });
    html += '<div class="tv2-sig-note">Every value is computed live from ' + esc(SYM) + ' daily candles (authoritative history). ▲▼ mark a state change vs the prior trading day. Click any indicator for its 1-year backtest. Indicator states, not advice.</div>';
    body.innerHTML = html;
    if (!body.__btWired) {
      body.__btWired = true;
      body.addEventListener('click', function (e) {
        if (e.target.closest('[data-btclose]')) { SIG.sel = null; renderSignals(row); return; }
        var tl = e.target.closest('.sig-tile[data-n]');
        if (!tl) return;
        var nm = tl.getAttribute('data-n');
        SIG.sel = SIG.sel === nm ? null : nm;
        renderSignals(row);
      });
      body.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tl = e.target.closest && e.target.closest('.sig-tile[data-n]');
        if (!tl) return;
        e.preventDefault();
        var nm = tl.getAttribute('data-n');
        SIG.sel = SIG.sel === nm ? null : nm;
        renderSignals(row);
      });
    }
  }

  function loadSignals(row, attempt) {
    attempt = attempt || 0;
    fetch('/wp-json/sml/v1/history?symbol=' + encodeURIComponent(SYM) + '&tf=1D', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var bars = (d && Array.isArray(d.bars)) ? d.bars.filter(function (b) { return b && b.c != null && b.h != null && b.l != null; }) : [];
        if (!bars.length) throw new Error('empty');
        SIG.bars = bars;
        SIG.btCache = {}; SIG.sel = null;
        buildDayPills(row);
        renderSignals(row);
      })
      .catch(function () {
        if (attempt < 3) { setTimeout(function () { loadSignals(row, attempt + 1); }, [4000, 8000, 18000][attempt]); return; }
        row.querySelector('#tv2sig-body').innerHTML = '<div class="tv2-mp2-empty">Signals aren\u2019t available for ' + esc(SYM) + ' right now \u2014 the daily history feed is not responding.</div>';
      });
  }

  function boot() {
    var main = document.querySelector('#sml-tv2-root [data-tv2-zone="main"]');
    if (!main || !main.children.length) return false;
    var chartCard = main.children[0];
    var el = card();
    chartCard.insertAdjacentElement('afterend', el);
    load(el.querySelector('.tv2-mp2'));
    loadSignals(el);
    return true;
  }

  var tries = 0;
  var t = setInterval(function () {
    var ok = false;
    try { ok = boot(); } catch (e) {}
    if (ok || ++tries > 60) clearInterval(t);
  }, 300);
})();

/* Short sale analysis card (js/terminal-short.js) rides along with this module so the
   WPCode go-live snippet needs no change — same commit-pinned CDN base. */
(function () {
  var me = document.currentScript || Array.prototype.filter.call(document.scripts, function (s) { return /terminal-mp2\.js/.test(s.src); })[0];
  if (!me || !me.src || document.querySelector('script[src*="terminal-short.js"]')) return;
  var s = document.createElement('script'); s.src = me.src.replace(/terminal-mp2\.js.*$/, 'terminal-short.js'); s.async = true; document.head.appendChild(s);
})();
