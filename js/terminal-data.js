/*!
 * SML Terminal — Phase B data wiring for the artifact shell.
 * Replaces the design's sample numbers with REAL quotes from the site's own
 * /wp-json/sml/v1/quote endpoint (single connection, 8s poll, stale-aware).
 * Slots are discovered by their LABELS at runtime (VOLUME / VWAP / BID / ASK /
 * SPREAD / High / Low / Open / Prev close / Last), so a re-exported design keeps
 * working. Alert count wired from /sml/v1/ticker-alerts. No fabricated values:
 * anything we can't fetch keeps an em-dash, never a fake number.
 */
(function () {
  'use strict';
  if (!/[?&]tv2=1(&|$)/.test(location.search)) return;
  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';

  function fmtM(v) { if (v == null) return '—'; v = Number(v); if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(v); }
  function f2(v) { return v == null ? '—' : Number(v).toFixed(2); }

  function leaves(scope) { return [].filter.call(scope.querySelectorAll('span,div,p,b,strong,em'), function (e) { return e.children.length === 0; }); }
  function findLeaf(scope, rx) { var L = leaves(scope); for (var i = 0; i < L.length; i++) { if (rx.test((L[i].textContent || '').trim())) return L[i]; } return null; }
  // value cell = the numeric leaf nearest a label leaf (same cell container)
  function valueFor(label) {
    var p = label, hops = 0;
    while (p && hops < 3) {
      p = p.parentElement; hops++;
      if (!p) break;
      var cands = leaves(p).filter(function (e) { return e !== label && /[0-9]/.test(e.textContent || ''); });
      if (cands.length) return cands[0];
    }
    return null;
  }
  function setTxt(el, txt) { if (el && el.textContent !== txt) el.textContent = txt; }

  function boot(root) {
    var shell = root.querySelector(':scope > :last-child') || root;
    var zones = shell.children.length >= 4 ? shell : root; // [header, strip, tabs, body]
    var strip = zones.children[1] || root;
    var body = zones.children[3] || root;
    var rail = body.children[1] || body;

    // ---- one-time identity substitution ($SPY tokens + company name) ----
    leaves(root).forEach(function (e) {
      var t = (e.textContent || '').trim();
      if (t === '$SPY') e.textContent = '$' + SYM;
      else if (t.indexOf('$SPY') >= 0 && t.length < 90) e.textContent = t.split('$SPY').join('$' + SYM);
    });
    fetch('/wp-json/sml/v1/ticker-card?symbol=' + SYM).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.name || d.name === d.symbol) return;
      var nameEl = findLeaf(strip, /State Street SPDR|ETF Trust/i) || findLeaf(strip, /^[A-Z][A-Za-z0-9 .,&'()-]{8,60}$/);
      setTxt(nameEl, d.name);
    }).catch(function () {});

    // ---- locate quote slots by label ----
    var slots = {};
    function grab(scope, rx, key) { var l = findLeaf(scope, rx); if (l) { var v = valueFor(l); if (v) slots[key] = v; } }
    grab(strip, /^VOLUME$/i, 'volume');
    grab(strip, /^VWAP$/i, 'vwap');
    grab(strip, /^BID \/ ASK$/i, 'bidask');
    grab(strip, /^SPREAD$/i, 'spread');
    slots.prevInline = findLeaf(strip, /^Prev close/i);            // label+value in one leaf
    // big last price: the largest-font numeric leaf in the strip
    var big = null, bigSize = 0;
    leaves(strip).forEach(function (e) { var t = (e.textContent || '').trim(); if (/^[0-9]{1,5}\.[0-9]{2}$/.test(t)) { var fs = parseFloat(getComputedStyle(e).fontSize) || 0; if (fs > bigSize) { bigSize = fs; big = e; } } });
    slots.last = big;
    slots.change = findLeaf(strip, /^[+−-][0-9.,]+ \([+−-]?[0-9.,]+%\)$/);
    // rail "Quotes" card
    grab(rail, /^High$/, 'qHigh'); grab(rail, /^Low$/, 'qLow'); grab(rail, /^Open$/, 'qOpen');
    grab(rail, /^Volume$/, 'qVolume'); grab(rail, /^Prev close$/, 'qPrev'); grab(rail, /^Last$/, 'qLast');
    grab(rail, /^(Avg \(VWAP\)|VWAP|Avg)$/i, 'qVwap'); grab(rail, /^Bid$/, 'qBid'); grab(rail, /^Ask$/, 'qAsk');

    // ---- live quote: one poller, stale-aware, never fabricates ----
    function apply(q) {
      if (!q || q.symbol !== SYM) return;
      setTxt(slots.last, f2(q.current));
      if (slots.change) {
        var up = (q.change || 0) >= 0;
        setTxt(slots.change, (up ? '+' : '') + f2(q.change) + ' (' + (up ? '+' : '') + (q.percentChange == null ? '—' : Number(q.percentChange).toFixed(2)) + '%)');
        slots.change.style.color = up ? '#00e07a' : '#ff4757';
      }
      if (slots.last) slots.last.title = (q.stale ? 'Delayed/stale · ' : 'Live · ') + 'source: ' + (q.source || 'n/a');
      setTxt(slots.volume, fmtM(q.volume));
      setTxt(slots.vwap, f2(q.vwap));
      setTxt(slots.bidask, f2(q.bid) + ' / ' + f2(q.ask));
      setTxt(slots.spread, (q.ask != null && q.bid != null) ? (q.ask - q.bid).toFixed(2) : '—');
      if (slots.prevInline) setTxt(slots.prevInline, 'Prev close ' + f2(q.previousClose));
      setTxt(slots.qHigh, f2(q.high)); setTxt(slots.qLow, f2(q.low)); setTxt(slots.qOpen, f2(q.open));
      setTxt(slots.qVolume, fmtM(q.volume)); setTxt(slots.qPrev, f2(q.previousClose)); setTxt(slots.qLast, f2(q.current));
      setTxt(slots.qVwap, f2(q.vwap)); setTxt(slots.qBid, f2(q.bid)); setTxt(slots.qAsk, f2(q.ask));
    }
    function poll() {
      fetch('/wp-json/sml/v1/quote?symbol=' + SYM, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); }).then(apply).catch(function () {});
    }
    poll(); setInterval(poll, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

    // ---- alert box count (real) ----
    fetch('/wp-json/sml/v1/ticker-alerts?symbol=' + SYM, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (d) {
        var n = (d && d.alerts) ? d.alerts.length : 0;
        var c = findLeaf(rail, /^\d+ ACTIVE$/i) || findLeaf(root, /^\d+ ACTIVE$/i);
        setTxt(c, n + ' ACTIVE');
      }).catch(function () {});

    // banner reflects progress honestly
    var ban = root.querySelector(':scope > div');
    if (ban && /PREVIEW SHELL/.test(ban.textContent || '')) {
      ban.textContent = 'PREVIEW — live quote + alerts wired to real data. Chart, feed and remaining panels still show design samples; they wire in the next phases.';
    }
  }

  var tries = 0;
  var t = setInterval(function () {
    var r = document.getElementById('sml-tv2-root');
    if (r && r.getAttribute('data-artifact') === '1' && r.children.length > 1) { clearInterval(t); boot(r); }
    else if (++tries > 60) clearInterval(t);
  }, 300);
})();
