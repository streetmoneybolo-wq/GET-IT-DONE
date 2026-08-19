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

  /* ---- Signals: standard indicator states computed from the site's own daily
     candles (/sml/v1/history?tf=1D) — plain math on real bars, nothing invented. */
  function sigSma(cl, n, i) { if (i + 1 < n) return null; var s = 0; for (var j = i - n + 1; j <= i; j++) s += cl[j]; return s / n; }
  function sigEmaSeries(cl, n) { var out = [], k = 2 / (n + 1), e = null; for (var i = 0; i < cl.length; i++) { e = e == null ? cl[i] : cl[i] * k + e * (1 - k); out.push(e); } return out; }
  function sigRsi(cl, n) {
    if (cl.length < n + 1) return null;
    var g = 0, l = 0;
    for (var i = 1; i <= n; i++) { var d = cl[i] - cl[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (i = n + 1; i < cl.length; i++) { var dd = cl[i] - cl[i - 1]; g = (g * (n - 1) + (dd > 0 ? dd : 0)) / n; l = (l * (n - 1) + (dd < 0 ? -dd : 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function computeSignals(bars) {
    var cl = bars.map(function (b) { return b.c; });
    var i = cl.length - 1, last = cl[i];
    var rows = [], bull = 0, bear = 0;
    function push(name, val, chip, cls) { rows.push({ n: name, v: val, chip: chip, cls: cls }); if (cls === 'bull') bull++; if (cls === 'bear') bear++; }

    var ma20 = sigSma(cl, 20, i), ma50 = sigSma(cl, 50, i);
    if (ma20 != null && ma50 != null) {
      var cls = last > ma20 && ma20 > ma50 ? 'bull' : (last < ma20 && ma20 < ma50 ? 'bear' : 'mid');
      push('Trend · MA20 / MA50', 'MA20 ' + num(ma20, 2) + ' · MA50 ' + num(ma50, 2),
        cls === 'bull' ? 'Uptrend' : cls === 'bear' ? 'Downtrend' : 'Mixed', cls);
    }
    var rsi = sigRsi(cl, 14);
    if (rsi != null) {
      push('Momentum · RSI 14', num(rsi, 1),
        rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : 'Neutral',
        rsi >= 70 ? 'bear' : rsi <= 30 ? 'bull' : 'mid');
    }
    if (cl.length >= 35) {
      var e12 = sigEmaSeries(cl, 12), e26 = sigEmaSeries(cl, 26);
      var macd = e12.map(function (v, k) { return v - e26[k]; });
      var sigLine = sigEmaSeries(macd, 9);
      var m = macd[i], sg = sigLine[i], hist = m - sg;
      push('MACD · 12 26 9', num(m, 2) + ' · hist ' + (hist >= 0 ? '+' : '') + num(hist, 2),
        m > sg ? 'Bullish' : 'Bearish', m > sg ? 'bull' : 'bear');
    }
    if (ma20 != null && cl.length >= 20) {
      var v = 0; for (var j = i - 19; j <= i; j++) v += Math.pow(cl[j] - ma20, 2);
      var sd = Math.sqrt(v / 20), up = ma20 + 2 * sd, lo = ma20 - 2 * sd;
      var pb = up > lo ? (last - lo) / (up - lo) : 0.5;
      push('Bollinger · 20 2\u03c3', '%B ' + num(pb * 100, 0) + '%',
        pb > 1 ? 'Above upper band' : pb < 0 ? 'Below lower band' : 'Within bands',
        pb > 1 || pb < 0 ? 'warn' : 'mid');
    }
    var pv = 0, vv = 0;
    for (var k2 = Math.max(0, i - 19); k2 <= i; k2++) { var b = bars[k2]; var px = (b.vw != null ? b.vw : (b.h + b.l + b.c) / 3); pv += px * (b.v || 0); vv += (b.v || 0); }
    if (vv > 0) {
      var vw = pv / vv;
      push('20-day VWAP', num(vw, 2), last >= vw ? 'Price above' : 'Price below', last >= vw ? 'bull' : 'bear');
    }
    if (bars.length >= 21) {
      var hi20 = -Infinity, lo20 = Infinity;
      for (var k3 = i - 20; k3 < i; k3++) { if (bars[k3].h > hi20) hi20 = bars[k3].h; if (bars[k3].l < lo20) lo20 = bars[k3].l; }
      if (last > hi20) push('20-day range', 'prior high ' + num(hi20, 2), 'New 20d high', 'bull');
      else if (last < lo20) push('20-day range', 'prior low ' + num(lo20, 2), 'New 20d low', 'bear');
      else push('20-day range', num(lo20, 2) + ' \u2013 ' + num(hi20, 2), num(((hi20 - last) / hi20) * 100, 1) + '% off high', 'mid');
    }
    return { rows: rows, bull: bull, bear: bear };
  }
  function renderSignals(row, bars) {
    var body = row.querySelector('#tv2sig-body');
    var sum = row.querySelector('#tv2sig-sum');
    var r = computeSignals(bars);
    if (!r.rows.length) { body.innerHTML = '<div class="tv2-mp2-empty">Not enough daily history for ' + esc(SYM) + ' to compute signals.</div>'; return; }
    sum.textContent = r.bull + ' bullish \u00b7 ' + r.bear + ' bearish';
    body.innerHTML = r.rows.map(function (x) {
      return '<div class="tv2-sig-row"><span class="n">' + esc(x.n) + '</span><span class="v">' + esc(x.v) + '</span><span class="c ' + x.cls + '">' + esc(x.chip) + '</span></div>';
    }).join('') +
    '<div class="tv2-sig-note">Computed live from ' + esc(SYM) + ' daily candles (authoritative history). Indicator states, not advice.</div>';
  }
  function loadSignals(row, attempt) {
    attempt = attempt || 0;
    fetch('/wp-json/sml/v1/history?symbol=' + encodeURIComponent(SYM) + '&tf=1D', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var bars = (d && Array.isArray(d.bars)) ? d.bars.filter(function (b) { return b && b.c != null; }) : [];
        if (!bars.length) throw new Error('empty');
        renderSignals(row, bars);
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
