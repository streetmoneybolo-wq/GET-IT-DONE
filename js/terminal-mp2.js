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
    var el = document.createElement('div');
    el.className = 'tv2-mp2'; el.setAttribute('data-tv2-keep', '1');   /* not a design card — terminal-adopt.js skips it */
    el.innerHTML =
      '<div class="tv2-mp2-h"><span class="t">Market position</span><span class="d" id="tv2mp2-range">' + esc(SYM) + '</span></div>' +
      '<div class="tv2-mp2-body" id="tv2mp2-body"><div class="tv2-mp2-empty">Loading market position…</div></div>';
    return el;
  }

  function render(el, d) {
    var body = el.querySelector('#tv2mp2-body');
    var range = el.querySelector('#tv2mp2-range');
    if (d.from && d.to) range.textContent = fmtDate(d.from) + ' – ' + fmtDate(d.to);

    var bins = Array.isArray(d.bins) ? d.bins : [];
    var lo = Number(d.lo), hi = Number(d.hi), cur = Number(d.current);
    var H = 190, N = bins.length;
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

  function boot() {
    var main = document.querySelector('#sml-tv2-root [data-tv2-zone="main"]');
    if (!main || !main.children.length) return false;
    var chartCard = main.children[0];
    var el = card();
    chartCard.insertAdjacentElement('afterend', el);
    load(el);
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
