/* SML Terminal — NATIVE chart (Phase 2, replaces the adopted LoopCharts canvas).
   Data: the site's own candles endpoint /wp-json/sml/v1/history?symbol&tf
   (tf ∈ 1m 5m 15m 1h 1D 1W; bars {t(ms),o,h,l,c,v,vw}) + the single quote poller
   in terminal-data.js (window event 'tv2:quote'). Renderer: TradingView
   Lightweight Charts (Apache-2.0) from jsDelivr — candles + volume, crosshair,
   last-price line, indicators computed here (MA20/MA50/EMA9/VWAP/Bollinger/RSI),
   live last-bar update from the quote. Honest states: while loading → "Loading";
   empty/failed → the endpoint's message; the hour feed is stale server-side for
   some symbols → the chart says so (bars' own timestamp) instead of pretending.
   Sets window.SML_TV2_NATIVE_CHART=1 synchronously so terminal-adopt.js does NOT
   move the legacy #sml-ws-left into the card. */
(function () {
  'use strict';
  if (window.__smlTerminalChartBooted) return;
  window.__smlTerminalChartBooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;
  window.SML_TV2_NATIVE_CHART = 1;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  var LIB = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';
  var TFS = [['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1h'], ['1D', '1D'], ['1W', '1W']];
  var IND = [['ma20', 'MA 20'], ['ma50', 'MA 50'], ['ema9', 'EMA 9'], ['vwap', 'VWAP'], ['bb', 'Bollinger'], ['rsi', 'RSI 14']];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var CSS = '' +
    '.tv2-ch{display:flex;flex-direction:column;gap:10px;min-height:520px}' +
    '.tv2-ch-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.tv2-ch-seg{display:flex;gap:2px;background:#0d141c;border:1px solid #16202b;border-radius:8px;padding:3px}' +
    '.tv2-ch-seg button{font:600 11px/1 Archivo,sans-serif;color:#8fa3b5;background:transparent;border:none;padding:7px 10px;border-radius:6px;cursor:pointer}' +
    '.tv2-ch-seg button.on{color:#04060a;background:#00ff88}' +
    '.tv2-ch-ind{position:relative}.tv2-ch-ind>button{font:600 11px/1 Archivo,sans-serif;color:#8fa3b5;background:#0d141c;border:1px solid #16202b;border-radius:8px;padding:9px 12px;cursor:pointer}' +
    '.tv2-ch-ind-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:5;background:#0d141c;border:1px solid #1d2b39;border-radius:10px;padding:8px;display:none;min-width:160px;box-shadow:0 12px 30px #000a}' +
    '.tv2-ch-ind.open .tv2-ch-ind-menu{display:block}' +
    '.tv2-ch-ind-menu label{display:flex;align-items:center;gap:8px;font:500 12px/1 Archivo,sans-serif;color:#c9d6e2;padding:7px 6px;border-radius:6px;cursor:pointer}.tv2-ch-ind-menu label:hover{background:#131c26}' +
    '.tv2-ch-sp{flex:1}' +
    '.tv2-ch-meta{font:500 10px/1.3 "IBM Plex Mono",monospace;color:#5d7085;text-align:right}' +
    '.tv2-ch-meta b{color:#8fa3b5;font-weight:600}' +
    '.tv2-ch-stage{position:relative;flex:1;min-height:430px;border:1px solid #16202b;border-radius:10px;background:#080c12;overflow:hidden}' +
    '.tv2-ch-main{position:absolute;left:0;right:0;top:0;bottom:0}' +
    '.tv2-ch-stage.has-rsi .tv2-ch-main{bottom:110px}.tv2-ch-rsi{position:absolute;left:0;right:0;bottom:0;height:110px;border-top:1px solid #131c26;display:none}.tv2-ch-stage.has-rsi .tv2-ch-rsi{display:block}' +
    '.tv2-ch-ohlc{position:absolute;left:12px;top:10px;z-index:3;font:500 10.5px/1.6 "IBM Plex Mono",monospace;color:#8fa3b5;pointer-events:none;text-shadow:0 1px 2px #000}' +
    '.tv2-ch-ohlc b{color:#e6edf3;font-weight:600}.tv2-ch-ohlc .up{color:#00ff88}.tv2-ch-ohlc .dn{color:#ff4757}' +
    '.tv2-ch-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 12px/1.6 "IBM Plex Mono",monospace;color:#5d7085;text-align:center;padding:24px;background:#080c12;z-index:4}' +
    '.tv2-ch-state[hidden]{display:none}' +
    '.tv2-ch-legend{display:flex;gap:14px;flex-wrap:wrap;font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}.tv2-ch-legend i{display:inline-block;width:10px;height:2px;margin-right:5px;vertical-align:middle}' +
    '.tv2-ch-sym{font:700 13px/1 Archivo,sans-serif;color:#e6edf3}.tv2-ch-sym span{color:#00ff88}' +
    '@media(max-width:700px){.tv2-ch{min-height:420px}.tv2-ch-stage{min-height:340px}.tv2-ch-seg button{padding:7px 8px;font-size:10px}}';

  var S = { tf: lsGet('tv2-chart-tf', '15m'), ind: (function () { try { var v = JSON.parse(lsGet('tv2-chart-ind', '["ma20","vwap"]')); return Array.isArray(v) ? v : ['ma20', 'vwap']; } catch (e) { return ['ma20', 'vwap']; } })(), bars: [], chart: null, rsiChart: null, series: {}, ready: false, lastQuote: null, tfMs: 0 };
  if (!TFS.some(function (t) { return t[0] === S.tf; })) S.tf = '15m';

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
  function loadLib() {
    return new Promise(function (res, rej) {
      if (window.LightweightCharts) return res();
      var s = document.createElement('script'); s.src = LIB; s.async = true; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('chart library blocked')); };
      document.head.appendChild(s);
    });
  }
  function tfToMs(tf) { return { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '1D': 86400e3, '1W': 604800e3 }[tf] || 900e3; }
  function fmtAge(ms) { var s = Math.max(0, Math.round(ms / 1000)); if (s < 90) return s + 's ago'; var m = Math.round(s / 60); if (m < 90) return m + 'm ago'; var h = Math.round(m / 60); if (h < 36) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; }
  function f2(n) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2); }
  function fmtV(n) { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(Math.round(n)); }

  /* ---- indicators (plain math, computed here) ---- */
  function sma(bars, n) { var out = [], sum = 0; for (var i = 0; i < bars.length; i++) { sum += bars[i].c; if (i >= n) sum -= bars[i - n].c; if (i >= n - 1) out.push({ time: bars[i].time, value: sum / n }); } return out; }
  function ema(bars, n) { var out = [], k = 2 / (n + 1), e = null; for (var i = 0; i < bars.length; i++) { e = e == null ? bars[i].c : bars[i].c * k + e * (1 - k); if (i >= n - 1) out.push({ time: bars[i].time, value: e }); } return out; }
  function vwapLine(bars) { /* session-less running VWAP from the bars' own vw (provider) or cumulative pv/v — honest: rolling over the loaded window */ var out = [], pv = 0, vv = 0; for (var i = 0; i < bars.length; i++) { var p = bars[i].vw || (bars[i].h + bars[i].l + bars[i].c) / 3; pv += p * (bars[i].v || 0); vv += (bars[i].v || 0); if (vv > 0) out.push({ time: bars[i].time, value: pv / vv }); } return out; }
  function boll(bars, n, k) { var up = [], lo = [], mid = []; for (var i = n - 1; i < bars.length; i++) { var s = 0; for (var j = i - n + 1; j <= i; j++) s += bars[j].c; var m = s / n, v = 0; for (j = i - n + 1; j <= i; j++) v += Math.pow(bars[j].c - m, 2); var sd = Math.sqrt(v / n); mid.push({ time: bars[i].time, value: m }); up.push({ time: bars[i].time, value: m + k * sd }); lo.push({ time: bars[i].time, value: m - k * sd }); } return { up: up, lo: lo, mid: mid }; }
  function rsi(bars, n) { var out = [], g = 0, l = 0; for (var i = 1; i < bars.length; i++) { var d = bars[i].c - bars[i - 1].c; var up = d > 0 ? d : 0, dn = d < 0 ? -d : 0; if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out.push({ time: bars[i].time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); } } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out.push({ time: bars[i].time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); } } return out; }

  function build(card) {
    Array.prototype.forEach.call(card.children, function (k) { if (!k.hasAttribute('data-tv2-keep')) k.style.display = 'none'; });
    var root = el('<div class="tv2-ch" data-tv2-keep="1">' +
      '<div class="tv2-ch-bar"><span class="tv2-ch-sym">$<span>' + esc(SYM) + '</span></span>' +
      '<div class="tv2-ch-seg tv2-ch-tf">' + TFS.map(function (t) { return '<button type="button" data-tf="' + t[0] + '"' + (t[0] === S.tf ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="tv2-ch-ind"><button type="button" class="tv2-ch-ind-btn">Indicators ▾</button><div class="tv2-ch-ind-menu">' + IND.map(function (i) { return '<label><input type="checkbox" data-ind="' + i[0] + '"' + (S.ind.indexOf(i[0]) >= 0 ? ' checked' : '') + '> ' + i[1] + '</label>'; }).join('') + '</div></div>' +
      '<button type="button" class="tv2-ch-seg tv2-ch-reset" style="padding:8px 12px;font:600 11px/1 Archivo,sans-serif;color:#8fa3b5;cursor:pointer">Reset view</button>' +
      '<span class="tv2-ch-sp"></span><div class="tv2-ch-meta" id="tv2ch-meta">Loading…</div></div>' +
      '<div class="tv2-ch-stage"><div class="tv2-ch-ohlc" id="tv2ch-ohlc"></div><div class="tv2-ch-main" id="tv2ch-main"></div><div class="tv2-ch-rsi" id="tv2ch-rsi"></div><div class="tv2-ch-state" id="tv2ch-state">Loading chart…</div></div>' +
      '<div class="tv2-ch-legend" id="tv2ch-legend"></div></div>');
    card.appendChild(root);
    return root;
  }

  var COLORS = { ma20: '#ffd166', ma50: '#ff7a45', ema9: '#c084fc', vwap: '#00ccff', bb: '#8fa3b5', rsi: '#00ff88' };

  function makeCharts(root) {
    var LW = window.LightweightCharts;
    var common = { layout: { background: { type: 'solid', color: '#080c12' }, textColor: '#8fa3b5', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 }, grid: { vertLines: { color: '#0e1620' }, horzLines: { color: '#0e1620' } }, crosshair: { mode: 0, vertLine: { color: '#2a3a4a', labelBackgroundColor: '#131c26' }, horzLine: { color: '#2a3a4a', labelBackgroundColor: '#131c26' } }, rightPriceScale: { borderColor: '#16202b' }, timeScale: { borderColor: '#16202b', timeVisible: true, secondsVisible: false }, localization: { priceFormatter: function (p) { return p >= 1000 ? p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.toFixed(2); } } };
    var main = root.querySelector('#tv2ch-main'), rsiEl = root.querySelector('#tv2ch-rsi');
    S.chart = LW.createChart(main, common);
    S.series.candles = S.chart.addCandlestickSeries({ upColor: '#00ff88', downColor: '#ff4757', borderUpColor: '#00ff88', borderDownColor: '#ff4757', wickUpColor: '#00ff88', wickDownColor: '#ff4757', priceLineColor: '#00ff88', lastValueVisible: true });
    S.series.volume = S.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    S.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    S.rsiChart = LW.createChart(rsiEl, Object.assign({}, common, { rightPriceScale: { borderColor: '#16202b', scaleMargins: { top: 0.1, bottom: 0.1 } }, timeScale: { borderColor: '#16202b', timeVisible: true, visible: false } }));
    S.series.rsi = S.rsiChart.addLineSeries({ color: COLORS.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
    S.series.rsi.createPriceLine({ price: 70, color: '#ff4757', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    S.series.rsi.createPriceLine({ price: 30, color: '#00ff88', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    /* keep the RSI pane's time axis in step with the main chart */
    S.chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) { if (r && S.rsiChart) S.rsiChart.timeScale().setVisibleLogicalRange(r); });
    var ro = new ResizeObserver(function () { resize(root); }); ro.observe(root.querySelector('.tv2-ch-stage'));
    S.chart.subscribeCrosshairMove(function (p) {
      var o = root.querySelector('#tv2ch-ohlc'); if (!o) return;
      var d = p && p.seriesData && p.seriesData.get(S.series.candles);
      var b = d || (S.bars.length ? S.bars[S.bars.length - 1] : null);
      if (!b) { o.innerHTML = ''; return; }
      var v = p && p.seriesData && p.seriesData.get(S.series.volume);
      var up = b.close >= b.open;
      o.innerHTML = '<b>$' + esc(SYM) + '</b> · ' + esc(S.tf) + ' &nbsp; O <b>' + f2(b.open) + '</b> H <b>' + f2(b.high) + '</b> L <b>' + f2(b.low) + '</b> C <b class="' + (up ? 'up' : 'dn') + '">' + f2(b.close) + '</b>' + (v && v.value != null ? ' &nbsp; Vol <b>' + fmtV(v.value) + '</b>' : (b.v != null ? ' &nbsp; Vol <b>' + fmtV(b.v) + '</b>' : ''));
    });
  }
  function resize(root) {
    if (!S.chart) return;
    var main = root.querySelector('#tv2ch-main'), rsiEl = root.querySelector('#tv2ch-rsi');
    S.chart.applyOptions({ width: main.clientWidth, height: main.clientHeight });
    if (S.rsiChart) S.rsiChart.applyOptions({ width: rsiEl.clientWidth, height: rsiEl.clientHeight });
  }

  function applyIndicators(root) {
    var on = function (k) { return S.ind.indexOf(k) >= 0; };
    var lines = { ma20: [sma(S.bars, 20)], ma50: [sma(S.bars, 50)], ema9: [ema(S.bars, 9)], vwap: [vwapLine(S.bars)] };
    var bb = boll(S.bars, 20, 2);
    function line(key, data, color, width, style) {
      var id = key; if (!S.series[id]) S.series[id] = S.chart.addLineSeries({ color: color, lineWidth: width || 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: style || 0 });
      S.series[id].setData(data); S.series[id].applyOptions({ visible: true });
    }
    ['ma20', 'ma50', 'ema9', 'vwap'].forEach(function (k) { if (on(k)) line(k, lines[k][0], COLORS[k], 1); else if (S.series[k]) S.series[k].applyOptions({ visible: false }); });
    if (on('bb')) { line('bbu', bb.up, COLORS.bb, 1, 2); line('bbl', bb.lo, COLORS.bb, 1, 2); line('bbm', bb.mid, '#4c5d6d', 1, 1); }
    else ['bbu', 'bbl', 'bbm'].forEach(function (k) { if (S.series[k]) S.series[k].applyOptions({ visible: false }); });
    var stage = root.querySelector('.tv2-ch-stage');
    if (on('rsi')) { stage.classList.add('has-rsi'); S.series.rsi.setData(rsi(S.bars, 14)); } else stage.classList.remove('has-rsi');
    resize(root);
    var leg = root.querySelector('#tv2ch-legend');
    leg.innerHTML = IND.filter(function (i) { return on(i[0]); }).map(function (i) { return '<span><i style="background:' + (COLORS[i[0]] || '#8fa3b5') + '"></i>' + i[1] + '</span>'; }).join('') + '<span><i style="background:#00ff88"></i>up</span><span><i style="background:#ff4757"></i>down</span>';
  }

  function setBars(root, bars, meta) {
    S.bars = bars.map(function (b) { return { time: Math.floor(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c, c: b.c, h: b.h, l: b.l, v: b.v, vw: b.vw }; });
    S.tfMs = tfToMs(S.tf);
    S.series.candles.setData(S.bars.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
    S.series.volume.setData(S.bars.map(function (b) { return { time: b.time, value: b.v || 0, color: b.close >= b.open ? 'rgba(0,255,136,.35)' : 'rgba(255,71,87,.35)' }; }));
    applyIndicators(root);
    var want = { '1m': 180, '5m': 160, '15m': 140, '1h': 160, '1D': 160, '1W': 160 }[S.tf] || 150;
    S.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, S.bars.length - want), to: S.bars.length + 3 });
    var last = S.bars[S.bars.length - 1];
    var m = root.querySelector('#tv2ch-meta');
    var age = last ? (Date.now() - last.time * 1000) : 0;
    var staleNote = last && age > Math.max(S.tfMs * 3, 2 * 3600e3) && age > 6 * 3600e3 ? ' · <b>last bar ' + fmtAge(age) + '</b>' : '';
    m.innerHTML = (meta.resultCount || S.bars.length) + ' bars · ' + esc(S.tf) + staleNote + (meta.quality ? ' · ' + esc(meta.quality) : '');
    root.querySelector('#tv2ch-state').hidden = true;
    S.ready = true;
    if (S.lastQuote) applyQuote(S.lastQuote);
    /* pre-paint guard: the real chart has painted — reveal the page */
    document.documentElement.classList.remove('sml-pp');
  }

  function load(root, attempt) {
    attempt = attempt || 0;
    var st = root.querySelector('#tv2ch-state'); st.hidden = false; st.textContent = 'Loading ' + SYM + ' · ' + S.tf + '…';
    fetch('/wp-json/sml/v1/history?symbol=' + encodeURIComponent(SYM) + '&tf=' + encodeURIComponent(S.tf), { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var bars = res.ok && res.j && Array.isArray(res.j.bars) ? res.j.bars.filter(function (b) { return b && b.t && b.o != null && b.c != null; }) : [];
        if (!bars.length) { st.textContent = (res.j && (res.j.message || res.j.error)) ? String(res.j.message || res.j.error) : 'No ' + S.tf + ' history is available for $' + SYM + ' right now.'; root.querySelector('#tv2ch-meta').textContent = '—'; return; }
        setBars(root, bars, res.j);
      })
      .catch(function () { if (attempt < 3) { setTimeout(function () { load(root, attempt + 1); }, [3000, 7000, 15000][attempt]); return; } st.textContent = 'The history feed is not responding right now.'; });
  }

  /* live: fold the latest quote into the last bar (or open a new bar when the
     timeframe boundary has passed) — the same single poller the strip uses */
  function applyQuote(q) {
    S.lastQuote = q;
    if (!S.ready || !S.bars.length || !q || q.current == null) return;
    var px = Number(q.current); if (!isFinite(px)) return;
    var last = S.bars[S.bars.length - 1];
    var now = Math.floor(Date.now() / 1000);
    var tfS = S.tfMs / 1000;
    var age = now - last.time;
    if (S.tf === '1D' || S.tf === '1W' || age < tfS * 2) {
      /* still inside/near the last bar → update it */
      last.close = px; last.c = px; if (px > last.high) last.high = px; if (px < last.low) last.low = px;
      S.series.candles.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
    } else if (age < tfS * 50) {
      var t = last.time + tfS * Math.floor(age / tfS);
      var nb = { time: t, open: px, high: px, low: px, close: px, c: px, h: px, l: px, v: 0 };
      S.bars.push(nb); S.series.candles.update({ time: t, open: px, high: px, low: px, close: px });
    }
  }
  window.addEventListener('tv2:quote', function (e) { try { applyQuote(e.detail); } catch (err) {} });

  function wire(root) {
    root.querySelector('.tv2-ch-tf').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tf]'); if (!b) return;
      S.tf = b.getAttribute('data-tf'); lsSet('tv2-chart-tf', S.tf);
      Array.prototype.forEach.call(root.querySelectorAll('.tv2-ch-tf button'), function (x) { x.classList.toggle('on', x === b); });
      S.ready = false; load(root, 0);
    });
    var ind = root.querySelector('.tv2-ch-ind');
    ind.querySelector('.tv2-ch-ind-btn').addEventListener('click', function (e) { e.stopPropagation(); ind.classList.toggle('open'); });
    document.addEventListener('click', function (e) { if (!ind.contains(e.target)) ind.classList.remove('open'); });
    ind.addEventListener('change', function (e) {
      var c = e.target.closest('input[data-ind]'); if (!c) return;
      var k = c.getAttribute('data-ind'); var i = S.ind.indexOf(k);
      if (c.checked && i < 0) S.ind.push(k); if (!c.checked && i >= 0) S.ind.splice(i, 1);
      lsSet('tv2-chart-ind', JSON.stringify(S.ind)); if (S.bars.length) applyIndicators(root);
    });
    root.querySelector('.tv2-ch-reset').addEventListener('click', function () { if (S.bars.length) { var want = 140; S.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, S.bars.length - want), to: S.bars.length + 3 }); } });
  }

  function boot() {
    var main = document.querySelector('#sml-tv2-root [data-tv2-zone="main"]');
    if (!main || !main.children.length) return false;
    var card = main.children[0];
    if (card.querySelector('.tv2-ch')) return true;
    if (!document.getElementById('tv2-ch-css')) { var st = document.createElement('style'); st.id = 'tv2-ch-css'; st.textContent = CSS; document.head.appendChild(st); }
    var root = build(card);
    loadLib().then(function () { makeCharts(root); wire(root); load(root, 0); })
      .catch(function () { root.querySelector('#tv2ch-state').textContent = 'The chart library could not load (network/CSP). Reload to retry.'; document.documentElement.classList.remove('sml-pp'); });
    return true;
  }
  var tries = 0;
  var t = setInterval(function () { var ok = false; try { ok = boot(); } catch (e) {} if (ok || ++tries > 60) clearInterval(t); }, 250);
})();
