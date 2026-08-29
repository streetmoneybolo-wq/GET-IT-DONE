/*!
 * SML Market Monitor — the live unusual-activity tape at /market-monitor/.
 * Rows come from two REAL sources, merged: the Render tape engine (computed
 * from quote snapshots the server already fetches — GET /api/tape) and the
 * last-24h Signal News detections (GET sml-mm/v1/signals). Nothing here is
 * simulated; a closed market shows an honest quiet state.
 */
(function () {
  'use strict';
  var CFG = window.SML_MM || {};
  var root = document.getElementById('sml-mm-root');
  if (!root || !CFG.tape) return;

  var FAM = {
    SHARP_RISE: { label: 'Sharp Rise', cls: 'up' },
    SHARP_FALL: { label: 'Sharp Fall', cls: 'dn' },
    SKYROCKET: { label: 'Skyrocket', cls: 'up' },
    NOSEDIVE: { label: 'Nosedive', cls: 'dn' },
    RISE7: { label: 'Rise 7%+', cls: 'up' },
    FALL7: { label: 'Fall 7%+', cls: 'dn' },
    HVOL_UP: { label: '(↑) Huge Volume', cls: 'up' },
    HVOL_DN: { label: '(↓) Huge Volume', cls: 'dn' },
    TOP_REV: { label: 'Top Reversal', cls: 'dn' },
    BOT_REB: { label: 'Bottom Rebound', cls: 'up' },
    SIGNAL: { label: 'Signal News', cls: 'sig' }
  };
  var GROUPS = [
    { key: 'moves', label: 'Price Moves', fams: ['SHARP_RISE', 'SHARP_FALL', 'SKYROCKET', 'NOSEDIVE'] },
    { key: 'seven', label: '7%+ Moves', fams: ['RISE7', 'FALL7'] },
    { key: 'vol', label: 'Volume', fams: ['HVOL_UP', 'HVOL_DN'] },
    { key: 'rev', label: 'Reversals', fams: ['TOP_REV', 'BOT_REB'] },
    { key: 'sig', label: 'Signal News', fams: ['SIGNAL'] }
  ];
  var NAMES = {
    SPY: 'S&P 500 ETF', QQQ: 'Nasdaq-100 ETF', IWM: 'Russell 2000 ETF', DIA: 'Dow 30 ETF',
    SOXX: 'Semiconductor ETF', BTC: 'Bitcoin', NVDA: 'NVIDIA', AAPL: 'Apple', TSLA: 'Tesla',
    MSFT: 'Microsoft', AMD: 'AMD', META: 'Meta', AMZN: 'Amazon', GOOGL: 'Alphabet',
    NFLX: 'Netflix', COIN: 'Coinbase', PLTR: 'Palantir'
  };

  var state = { events: [], signals: [], counts: { bull: 0, bear: 0 }, session: null, filters: null, lastRenderKey: '' };
  try { state.filters = JSON.parse(localStorage.getItem('sml_mm_filters') || 'null'); } catch (e) { /* fresh */ }
  if (!state.filters || typeof state.filters !== 'object') {
    state.filters = {}; GROUPS.forEach(function (g) { state.filters[g.key] = true; });
  }

  function famGroup(f) {
    for (var i = 0; i < GROUPS.length; i++) { if (GROUPS[i].fams.indexOf(f) >= 0) return GROUPS[i].key; }
    return 'moves';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
    catch (e) { return ''; }
  }
  function fmtVol(v) {
    if (!isFinite(v)) return '';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }
  function fmtPct(p) { return (p > 0 ? '+' : '') + Number(p).toFixed(2) + '%'; }

  function shell() {
    var chips = GROUPS.map(function (g) {
      return '<button class="mm-chip" data-g="' + g.key + '" aria-pressed="' + (state.filters[g.key] ? 'true' : 'false') + '">' + esc(g.label) + '</button>';
    }).join('');
    root.innerHTML =
      '<header class="mm-top"><a class="mm-brand" href="/">SML</a>' +
      '<div class="mm-title"><span class="mm-dot" id="mm-dot"></span>Market Monitor</div>' +
      '<div class="mm-session" id="mm-session">&mdash;</div></header>' +
      '<div class="mm-chips">' + chips + '</div>' +
      '<div class="mm-tablewrap"><table class="mm-table"><thead><tr>' +
      '<th>Time</th><th>Symbol</th><th class="mm-name">Name</th><th>Unusual Activity</th><th>Data</th>' +
      '</tr></thead><tbody id="mm-rows"></tbody></table>' +
      '<div class="mm-empty" id="mm-empty" hidden></div></div>' +
      '<footer class="mm-stats"><div class="mm-gauge"><div class="mm-gauge-bull" id="mm-gbull"></div><div class="mm-gauge-bear" id="mm-gbear"></div></div>' +
      '<div class="mm-statrow"><span class="mm-bull">Bullish Events <b id="mm-nbull">0</b></span>' +
      '<span class="mm-note">tracked live symbols + Signal News &middot; not investment advice</span>' +
      '<span class="mm-bear">Bearish Events <b id="mm-nbear">0</b></span></div></footer>';
    root.addEventListener('click', function (ev) {
      var chip = ev.target.closest ? ev.target.closest('.mm-chip') : null;
      if (!chip) return;
      var g = chip.getAttribute('data-g');
      state.filters[g] = !state.filters[g];
      chip.setAttribute('aria-pressed', state.filters[g] ? 'true' : 'false');
      try { localStorage.setItem('sml_mm_filters', JSON.stringify(state.filters)); } catch (e) { /* fine */ }
      state.lastRenderKey = '';
      render();
    });
  }

  function rows() {
    var out = [];
    state.events.forEach(function (e) {
      if (!FAM[e.family]) return;
      out.push({ ts: e.ts, sym: e.sym, family: e.family, pct: e.pct, move: e.move, vol: e.vol, url: '/stock-chart/?symbol=' + encodeURIComponent(e.sym) });
    });
    state.signals.forEach(function (s) {
      out.push({ ts: (s.ts || 0) * 1000, sym: s.sym || '', family: 'SIGNAL', title: s.title || '', url: s.url || '#' });
    });
    out = out.filter(function (r) { return state.filters[famGroup(r.family)]; });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out.slice(0, 200);
  }

  function render() {
    // session badge + clock always update, even when the row list is unchanged
    var sess = document.getElementById('mm-session');
    if (state.session && sess) {
      sess.textContent = (state.session.open ? 'Market Open' : 'Market Closed') + ' · ' + state.session.et + ' ET';
      sess.className = 'mm-session ' + (state.session.open ? 'open' : 'closed');
      document.getElementById('mm-dot').className = 'mm-dot' + (state.session.open ? ' live' : '');
    }
    var list = rows();
    var key = list.length + ':' + (list[0] ? list[0].ts + list[0].sym + list[0].family : '') + ':' + state.signals.length + ':' + state.counts.bull + ':' + state.counts.bear;
    if (key === state.lastRenderKey) return;
    state.lastRenderKey = key;

    var body = document.getElementById('mm-rows');
    var empty = document.getElementById('mm-empty');
    body.innerHTML = list.map(function (r) {
      var f = FAM[r.family];
      var num = function (x) { return typeof x === 'number' && isFinite(x); };
      var data;
      if (r.family === 'SIGNAL') data = '<span class="mm-sigtitle">' + esc(r.title) + '</span>';
      else if (r.family === 'HVOL_UP' || r.family === 'HVOL_DN') data = esc(fmtVol(r.vol)) + (num(r.pct) ? ' / ' + esc(fmtPct(r.pct)) : '');
      else data = (num(r.pct) ? esc(fmtPct(r.pct)) : '&mdash;') + (num(r.move) ? ' <span class="mm-move">(' + esc(fmtPct(r.move)) + ' burst)</span>' : '');
      return '<tr class="mm-row ' + f.cls + '" data-href="' + esc(r.url) + '">' +
        '<td class="mm-time">' + esc(fmtTime(r.ts)) + '</td>' +
        '<td class="mm-sym">$' + esc(r.sym) + '</td>' +
        '<td class="mm-name">' + esc(NAMES[r.sym] || '') + '</td>' +
        '<td class="mm-fam">' + esc(f.label) + '</td>' +
        '<td class="mm-data">' + data + '</td></tr>';
    }).join('');
    empty.hidden = list.length > 0;
    if (!list.length) {
      var open = state.session && state.session.open;
      empty.textContent = open
        ? 'Watching for unusual activity… events appear here as they are detected.'
        : 'Market closed — the tape fills during market hours (9:30 AM–4:00 PM ET, Mon–Fri). Bitcoin and Signal News events can appear any time.';
    }
    var bull = state.counts.bull || 0, bear = state.counts.bear || 0, tot = Math.max(1, bull + bear);
    document.getElementById('mm-nbull').textContent = bull;
    document.getElementById('mm-nbear').textContent = bear;
    document.getElementById('mm-gbull').style.width = Math.round((bull / tot) * 100) + '%';
    document.getElementById('mm-gbear').style.width = Math.round((bear / tot) * 100) + '%';
  }

  root.addEventListener('click', function (ev) {
    var tr = ev.target.closest ? ev.target.closest('.mm-row') : null;
    if (tr && tr.getAttribute('data-href')) window.location.href = tr.getAttribute('data-href');
  });

  function pollTape() {
    if (document.hidden) return;
    fetch(CFG.tape, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) { state.events = d.events || []; state.counts = d.counts || state.counts; state.session = d.session || state.session; render(); }
    }).catch(function () { /* keep last state */ });
  }
  function pollQuotes() {
    // Feeds the Render tape ingest while someone watches. Honest cost note:
    // this set rarely matches another viewer's cache key exactly, so with the
    // tape open it adds ~1.3 Massive snapshot calls/min (45s cadence against
    // the server's 10s cache) — deliberately slow; detectors use 5-10 min
    // windows and don't need faster samples.
    if (document.hidden || !CFG.quotes) return;
    var syms = (CFG.syms || []).join(',');
    fetch(CFG.quotes + (syms ? '?symbols=' + encodeURIComponent(syms) : ''), { cache: 'no-store' }).catch(function () { /* fine */ });
  }
  function pollSignals() {
    if (document.hidden || !CFG.signals) return;
    fetch(CFG.signals, { cache: 'default' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) { state.signals = d.signals || []; render(); }
    }).catch(function () { /* keep last state */ });
  }

  shell();
  render();
  pollQuotes(); pollTape(); pollSignals();
  setInterval(pollQuotes, 45000);
  setInterval(pollTape, 10000);
  setInterval(pollSignals, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pollQuotes(); pollTape(); } });
})();
