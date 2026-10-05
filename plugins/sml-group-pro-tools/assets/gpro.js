/* SML Group Pro Tools front end. Panels: Dashboard, Setups, Absorption, Options, Dark Pool, Sentiment.
 * Everything from the server is escaped before it touches the page. Educational context only. */
(function () {
  'use strict';
  var CFG = window.SML_GPRO || {};
  if (!CFG.api || !CFG.groupId || window.__smlGpro) return;
  window.__smlGpro = true;

  var preview = CFG.level === 'preview';
  var S = { open: false, tab: 'dashboard', symbol: (CFG.ticker || (CFG.watchlist && CFG.watchlist[0]) || 'SPY'), data: {}, loading: false, timer: null, opt: { view: '', horizonDays: 30, shares: '', cost: '' }, list: (CFG.watchlist || []).slice() };
  var TABS = [['dashboard', 'Dashboard'], ['setups', 'Setups'], ['absorption', 'Absorption'], ['options', 'Options'], ['darkpool', 'Dark pool'], ['sentiment', 'Sentiment']];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v.toFixed(d == null ? 2 : d) : '-'; }
  function money(v) { return typeof v === 'number' && isFinite(v) ? (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US') : '-'; }
  function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }

  /* ------------------------------------------------------------------ api */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'X-WP-Nonce': CFG.nonce };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(CFG.api + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'The tool is temporarily unavailable.'); return j; }); });
  }
  function run(tool, extra) {
    var body = { group_id: CFG.groupId, tool: tool };
    for (var k in extra) body[k] = extra[k];
    return api('run', { method: 'POST', body: body });
  }

  /* ------------------------------------------------------------------ shell */
  var root, bodyEl, tabsEl, symEl, titleEl;
  function build() {
    root = el('<div id="sml-gpro" role="dialog" aria-modal="true" aria-label="Group pro tools"><div class="gp-win">' +
      '<div class="gp-head"><div class="gp-title">Pro Tools<small>Live Academy data for this group</small></div>' +
      '<input class="sym" maxlength="10" placeholder="Ticker" aria-label="Ticker"><button type="button" class="gp-go">Load</button><button type="button" class="gp-x" aria-label="Close">Close</button></div>' +
      '<div class="gp-tabs" role="tablist"></div><div class="gp-body"></div></div></div>');
    document.body.appendChild(root);
    bodyEl = root.querySelector('.gp-body'); tabsEl = root.querySelector('.gp-tabs'); symEl = root.querySelector('input.sym'); titleEl = root.querySelector('.gp-title');
    TABS.forEach(function (t) { var b = document.createElement('button'); b.type = 'button'; b.className = 'gp-tab'; b.setAttribute('data-tab', t[0]); b.textContent = t[1]; tabsEl.appendChild(b); });
    tabsEl.addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) go(b.getAttribute('data-tab')); });
    root.querySelector('.gp-x').addEventListener('click', close);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    root.querySelector('.gp-go').addEventListener('click', loadSymbol);
    symEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadSymbol(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) close(); });
    bodyEl.addEventListener('click', onBodyClick);
    bodyEl.addEventListener('change', onBodyChange);
  }
  function open(tab) { if (!root) build(); S.open = true; root.classList.add('open'); symEl.value = S.symbol; go(tab || S.tab); }
  function close() { S.open = false; if (root) root.classList.remove('open'); stopTimer(); }
  function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
  function cleanSym(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10); }
  function loadSymbol() { var s = cleanSym(symEl.value); if (!s) return; S.symbol = s; S.data = {}; if (S.tab === 'dashboard') S.tab = 'setups'; go(S.tab); }
  function go(tab) {
    S.tab = tab; stopTimer();
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    paint();
    if (tab === 'absorption' || tab === 'darkpool') S.timer = setInterval(function () { if (S.open && !document.hidden) fetchTab(true); }, 8000);
  }

  /* ------------------------------------------------------------------ data per tab */
  function fetchTab(quiet) {
    var tab = S.tab, key = tab + ':' + S.symbol, p;
    if (tab === 'dashboard') p = run('dashboard', {});
    else if (tab === 'setups') p = run('setups', { symbol: S.symbol });
    else if (tab === 'absorption') p = run('absorption', { symbol: S.symbol });
    else if (tab === 'darkpool') p = run('darkpool', { symbol: S.symbol });
    else if (tab === 'sentiment') p = run('sentiment', { symbol: S.symbol });
    else if (tab === 'options') { var o = S.opt, params = {}; if (o.view) params.view = o.view; params.horizonDays = Number(o.horizonDays) || 30; if (Number(o.shares) > 0) params.shares = Number(o.shares); if (Number(o.cost) > 0) params.cost = Number(o.cost); key = 'options:' + S.symbol + ':' + JSON.stringify(params); p = run('strategies', { symbol: S.symbol, params: params }); }
    if (!p) return;
    if (!quiet) { S.loading = true; paintBody(); }
    p.then(function (d) { S.data[key] = { d: d }; }).catch(function (e) { S.data[key] = { err: e.message }; }).then(function () { S.loading = false; if (S.open && S.tab === tab) paintBody(); });
  }
  function current() {
    var tab = S.tab, key = tab + ':' + S.symbol;
    if (tab === 'options') { var o = S.opt, params = {}; if (o.view) params.view = o.view; params.horizonDays = Number(o.horizonDays) || 30; if (Number(o.shares) > 0) params.shares = Number(o.shares); if (Number(o.cost) > 0) params.cost = Number(o.cost); key = 'options:' + S.symbol + ':' + JSON.stringify(params); }
    return S.data[key];
  }

  function paint() {
    if (S.tab === 'dashboard') { titleEl.firstChild.textContent = 'Pro Tools'; symEl.style.display = 'none'; root.querySelector('.gp-go').style.display = 'none'; }
    else { symEl.style.display = ''; root.querySelector('.gp-go').style.display = ''; symEl.value = S.symbol; }
    var c = current();
    if (!c) fetchTab(false);
    paintBody();
  }

  function paintBody() {
    var c = current(), h = '';
    if (preview) h += '<div class="gp-prev">You are seeing the preview. Group Premium members, analysts and managers get the full breakdown.</div>';
    if (S.loading && !c) h += '<p class="gp-muted">Loading live data...</p>';
    else if (c && c.err) h += '<div class="gp-err">' + esc(c.err) + '</div>';
    else if (c && c.d) h += RENDER[S.tab](c.d);
    else h += '<p class="gp-muted">Loading...</p>';
    h += '<p class="gp-disc">Educational context from live market data. Not financial advice, not a prediction and not an order. Data can be delayed or wrong; check your broker before acting.</p>';
    bodyEl.innerHTML = h;
  }

  /* ------------------------------------------------------------------ renderers */
  var RENDER = {};

  RENDER.dashboard = function (d) {
    var h = '';
    if (CFG.canCurate) h += '<div class="gp-wl"><input class="wl" style="flex:1;min-width:200px" value="' + esc(S.list.join(', ')) + '" placeholder="Group tickers, comma separated (max 12)" aria-label="Group tickers"><button type="button" class="gp-btn pri" data-act="savelist">Save list</button></div>';
    var rows = d.rows || [];
    if (!rows.length) return h + '<p class="gp-muted">' + esc(d.note || 'No tickers on this group\'s list yet.') + (CFG.canCurate ? '' : ' Ask an analyst or the owner to add some.') + '</p>';
    h += '<table><thead><tr><th>Ticker</th><th>Price</th><th>Day</th><th>Sentiment</th><th>Absorption</th><th>Dark pool</th><th>Setup</th><th>Earnings</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      if (r.error) { h += '<tr><td>' + esc(r.symbol) + '</td><td colspan="7" class="gp-muted">unavailable</td></tr>'; return; }
      var st = r.setup, ab = r.absorption, se = r.sentiment;
      h += '<tr class="click" data-sym="' + esc(r.symbol) + '"><td><b>' + esc(r.symbol) + '</b></td><td>' + num(r.price) + '</td><td class="' + cls(r.changePct) + '">' + (r.changePct == null ? '-' : (r.changePct > 0 ? '+' : '') + num(r.changePct) + '%') + '</td>' +
        '<td class="' + (se ? cls(se.score) : '') + '">' + (se ? (se.score > 0 ? '+' : '') + esc(se.score) : '-') + '</td>' +
        '<td class="' + (ab ? cls(ab.score) : '') + '">' + (ab ? (ab.score > 0 ? '+' : '') + esc(ab.score) : '-') + '</td>' +
        '<td>' + (r.darkPool && r.darkPool.offSharePct != null ? esc(r.darkPool.offSharePct) + '%' : '-') + '</td>' +
        '<td>' + (st ? '<span class="badge ' + esc(st.side) + '">' + esc(st.side) + ' ' + esc(st.horizon) + '</span> <span class="badge ' + esc(st.grade) + '">' + esc(st.grade) + '</span>' : '-') + '</td>' +
        '<td>' + (r.earnings ? (r.earnings.daysAway <= 7 ? '<span class="neg">' + esc(r.earnings.daysAway) + 'd</span>' : esc(r.earnings.daysAway) + 'd') : '-') + '</td></tr>';
    });
    h += '</tbody></table><p class="gp-muted" style="font-size:11px">Tap a row to open its setups. Sentiment and absorption run from -100 to +100.</p>';
    return h;
  };

  function evHtml(list) {
    if (!list || !list.length) return '';
    return '<ul class="ev">' + list.map(function (e) { return '<li class="' + esc(e.tone) + '"><b>' + esc(e.label) + ':</b> ' + esc(e.detail) + '</li>'; }).join('') + '</ul>';
  }
  RENDER.setups = function (d) {
    if (d.available === false) return '<p class="gp-muted">' + esc(d.reason === 'not_enough_history' ? 'Not enough price history for this ticker to build setups.' : d.reason === 'no_live_price' ? 'No live price for this ticker right now.' : 'Setups are unavailable.') + '</p>';
    var h = '<p><b>' + esc(d.symbol) + '</b> ' + num(d.price) + ' <span class="gp-muted">' + esc(d.summary || '') + '</span></p><div class="gp-grid">';
    (d.cards || []).forEach(function (c) {
      h += '<div class="gp-card"><h3>' + esc(c.label) + ' <span class="gp-muted" style="font:500 11px system-ui">' + esc(c.span) + '</span></h3>';
      if (!c.available) { h += '<p class="gp-muted">' + esc(c.reason === 'not_enough_history' ? 'Not enough history on this timeframe.' : 'Unavailable.') + '</p></div>'; return; }
      if (c.side === 'neutral') { h += '<p class="gp-muted">' + esc(c.summary) + '</p>' + evHtml(c.evidence) + '</div>'; return; }
      h += '<div><span class="badge ' + esc(c.side) + '">' + (c.side === 'short' ? 'Short setup' : 'Long setup') + '</span> <span class="badge ' + esc(c.scoreGrade) + '">grade ' + esc(c.scoreGrade) + '</span>' + (c.score != null && !c.preview ? ' <span class="gp-muted">score ' + esc(c.score) + '</span>' : '') + '</div>';
      if (c.entry == null) { h += '<p>' + esc(c.summary) + '</p></div>'; return; } // preview card
      h += '<div class="kv"><span>Entry</span><span>' + num(c.entry) + '</span><span>Stop</span><span class="neg">' + num(c.stop) + ' (' + num(c.stopPct) + '%) ' + esc(c.stopBasis) + '</span>';
      (c.targets || []).forEach(function (t, i) { h += '<span>Target ' + (i + 1) + '</span><span class="pos">' + num(t.price) + ' (' + (t.pct > 0 ? '+' : '') + num(t.pct) + '%) ' + esc(t.why) + (t.rr ? ', ' + num(t.rr, 1) + 'R' : '') + '</span>'; });
      h += '<span>Risk band</span><span>' + esc(c.risk) + '</span></div>';
      h += evHtml(c.evidence);
      if (c.levelsInTheWay && c.levelsInTheWay.length) h += '<p class="gp-muted" style="font-size:11px">In the way: ' + c.levelsInTheWay.map(function (l) { return esc(l.price) + ' ' + esc(l.why); }).join(', ') + '</p>';
      h += '<div class="gp-note">' + esc(c.invalidation) + '</div>';
      if (c.shortNote) h += '<p class="gp-muted" style="font-size:11px">' + esc(c.shortNote) + '</p>';
      h += '</div>';
    });
    return h + '</div>' + (d.preview ? '<p class="gp-muted">' + esc(d.note) + '</p>' : '');
  };

  RENDER.absorption = function (d) {
    if (d.available === false) return '<p class="gp-muted">' + (d.reason === 'too_few_prints' ? 'Not enough live prints yet for ' + esc(d.symbol) + ' (' + esc(d.prints || 0) + '). The meter needs the symbol to be actively trading during market hours.' : 'The meter is unavailable.') + '</p>';
    var pos = Math.max(1, Math.min(99, 50 + d.score / 2));
    var h = '<div class="big ' + cls(d.score) + '">' + (d.score > 0 ? '+' : '') + esc(d.score) + '</div><div><b>' + esc(d.label) + '</b></div>' +
      '<div class="meter"><i style="left:' + pos + '%"></i></div><div class="meter-scale"><span>Sellers absorbing</span><span>Nothing clear</span><span>Buyers absorbing</span></div>';
    h += '<p style="margin-top:12px">' + esc(d.explain || '') + '</p><div class="kv"><span>Window</span><span>last ' + esc(d.windowMin) + ' minutes, ' + esc(d.prints) + ' prints</span><span>Held for</span><span>' + esc(d.persistedWindows) + ' consecutive window' + (d.persistedWindows === 1 ? '' : 's') + '</span>';
    if (d.level) h += '<span>Volume-weighted price</span><span>' + num(d.level) + '</span>';
    if (d.tape) h += '<span>Aggressive buying</span><span>' + (d.tape.aggressiveBuyPct == null ? '-' : esc(d.tape.aggressiveBuyPct) + '%') + ' of tagged volume</span><span>Price change</span><span class="' + cls(d.tape.priceChangePct) + '">' + (d.tape.priceChangePct > 0 ? '+' : '') + esc(d.tape.priceChangePct) + '%</span>';
    if (d.orderBook) h += '<span>Order book</span><span>' + esc(d.orderBook.state) + ' (strength ' + num(d.orderBook.strength, 2) + ')</span>';
    if (d.agreement != null) h += '<span>Tape and book</span><span>' + (d.agreement ? 'agree' : 'disagree') + '</span>';
    h += '</div>';
    if (d.history) h += '<div class="gp-note">Recorded history: ' + esc(d.history.signals) + ' similar order-book signals, ' + esc(d.history.hitRatePct) + '% moved the signal\'s way five minutes later (average ' + (d.history.avgMoveAfter5mPct > 0 ? '+' : '') + esc(d.history.avgMoveAfter5mPct) + '%). A signal that works 55% of the time still fails often.</div>';
    return h + '<p class="gp-muted" style="font-size:11px">Updates every few seconds while this tab is open. Prints are classified by the tick rule (up-tick = buy, down-tick = sell).</p>';
  };

  function payoffSvg(pts, be) {
    if (!pts || pts.length < 3) return '';
    var w = 400, ht = 120, pad = 6, ys = pts.map(function (p) { return p.pl; }), lo = Math.min.apply(null, ys.concat([0])), hi = Math.max.apply(null, ys.concat([0])), rng = (hi - lo) || 1;
    var X = function (i) { return pad + (i / (pts.length - 1)) * (w - 2 * pad); }, Y = function (v) { return pad + (1 - (v - lo) / rng) * (ht - 2 * pad); };
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.pl).toFixed(1); }).join(' ');
    var zero = Y(0).toFixed(1), mid = X(Math.floor(pts.length / 2)).toFixed(1);
    return '<svg class="payoff" viewBox="0 0 ' + w + ' ' + ht + '" preserveAspectRatio="none" aria-label="Profit and loss at expiry"><line x1="0" x2="' + w + '" y1="' + zero + '" y2="' + zero + '" stroke="#2a4a5c" stroke-dasharray="4 3"/><line x1="' + mid + '" x2="' + mid + '" y1="0" y2="' + ht + '" stroke="#2a3b48" stroke-dasharray="2 4"/><path d="' + path + '" fill="none" stroke="#33b7ef" stroke-width="2"/></svg>';
  }
  RENDER.options = function (d) {
    var o = S.opt;
    var h = '<div class="gp-wl"><select data-opt="view" aria-label="View"><option value=""' + (o.view === '' ? ' selected' : '') + '>View: from best setup</option><option value="bullish"' + (o.view === 'bullish' ? ' selected' : '') + '>Bullish</option><option value="bearish"' + (o.view === 'bearish' ? ' selected' : '') + '>Bearish</option><option value="neutral"' + (o.view === 'neutral' ? ' selected' : '') + '>Neutral</option></select>' +
      '<input data-opt="horizonDays" type="number" min="7" max="400" style="width:96px" value="' + esc(o.horizonDays) + '" aria-label="Days to hold"><span class="gp-muted" style="align-self:center">days</span>' +
      '<input data-opt="shares" type="number" min="0" style="width:110px" placeholder="Shares held" value="' + esc(o.shares) + '" aria-label="Shares held"><input data-opt="cost" type="number" min="0" step="0.01" style="width:110px" placeholder="Your cost" value="' + esc(o.cost) + '" aria-label="Your cost per share"></div>';
    if (d.available === false) return h + '<p class="gp-muted">' + esc({ no_chain: 'No options chain is available for this ticker right now.', no_usable_expiry: 'No usable expiration found.', no_priced_contracts: 'No contracts with live prices near the levels these structures need.' }[d.reason] || 'Options strategies are unavailable.') + '</p>';
    h += '<p><b>' + esc(d.symbol) + '</b> ' + num(d.spot) + ' <span class="gp-muted">expiry ' + esc(d.expiry) + ' (' + esc(d.days) + ' days), view ' + esc(d.view) + (d.holdsShares ? ', with your shares' : '') + '. ' + esc(d.viewSource === 'chosen' ? '' : 'View taken from the best-fit setup.') + '</span></p><div class="gp-grid">';
    (d.strategies || []).forEach(function (s) {
      h += '<div class="gp-card"><h3>' + esc(s.name) + ' <span class="badge ' + esc(s.kind) + '">' + esc(s.kind) + '</span></h3><p class="gp-muted" style="margin:0 0 6px">' + esc(s.why) + '</p>';
      if (!s.legs) { h += '</div>'; return; } // preview
      h += '<table><tbody>' + s.legs.map(function (l) { return '<tr><td>' + (l.qty > 0 ? 'Buy ' : 'Sell ') + Math.abs(l.qty) + ' ' + esc(l.type) + '</td><td>' + num(l.strike) + '</td><td>' + num(l.price) + '</td></tr>'; }).join('') + '</tbody></table>';
      h += payoffSvg(s.payoff, s.breakevens);
      h += '<div class="kv"><span>' + (s.costType === 'credit' ? 'Credit' : 'Cost') + '</span><span>' + money(Math.abs(s.netCost)) + '</span><span>Max profit</span><span class="pos">' + (s.unlimitedProfit ? 'unlimited' : money(s.maxProfit)) + '</span><span>Max loss</span><span class="neg">' + money(s.maxLoss) + '</span>' +
        '<span>Breakeven</span><span>' + (s.breakevens && s.breakevens.length ? s.breakevens.map(function (b) { return num(b); }).join(' / ') : '-') + '</span>' +
        (s.chanceOfProfit != null ? '<span>Chance of profit</span><span>about ' + esc(s.chanceOfProfit) + '%</span>' : '') +
        '<span>Net delta</span><span>' + num(s.greeks.delta, 0) + ' shares' + (s.exposure && s.exposure.leverage ? ', ' + num(s.exposure.leverage, 1) + 'x leverage' : '') + (s.exposure && s.exposure.vsOwnedShares != null ? ', ' + Math.round(s.exposure.vsOwnedShares * 100) + '% of your shares\' exposure' : '') + '</span>' +
        '<span>Time decay</span><span>' + money(s.greeks.thetaPerDay) + '/day</span></div>';
      (s.warnings || []).forEach(function (w) { h += '<div class="gp-note">' + esc(w) + '</div>'; });
      h += '</div>';
    });
    return h + '</div>' + (d.preview ? '<p class="gp-muted">' + esc(d.note) + '</p>' : '') + '<p class="gp-muted" style="font-size:11px">' + esc(d.disclaimer || '') + '</p>';
  };

  RENDER.darkpool = function (d) {
    if (d.available === false) return '<p class="gp-muted">' + (d.reason === 'too_few_prints' ? 'Not enough prints yet (' + esc(d.prints || 0) + ').' : 'No live prints for this ticker yet. Open it once and it starts collecting.') + '</p>';
    var share = d.offSharePct == null ? 0 : d.offSharePct;
    var h = '<div class="big">' + (d.offSharePct == null ? '-' : esc(d.offSharePct) + '%') + '</div><div>of volume printed off-exchange <span class="gp-muted">(typical about ' + esc(d.typicalSharePct) + '%)</span></div>' +
      '<div class="bar"><b style="width:' + Math.min(100, share) + '%"></b><u style="left:' + esc(d.typicalSharePct) + '%"></u></div><p>' + esc(d.note) + '</p>';
    if (d.lean) h += '<p>' + esc(d.lean.label) + '</p>';
    h += '<div class="gp-grid"><div class="gp-card"><h3>Where off-exchange volume clusters</h3><table><thead><tr><th>Price</th><th>Volume</th><th>Prints</th><th>Lean</th></tr></thead><tbody>' +
      ((d.levels || []).length ? d.levels.map(function (l) { return '<tr><td>' + num(l.price) + '</td><td>' + esc(l.volume.toLocaleString('en-US')) + '</td><td>' + esc(l.prints) + '</td><td><span class="badge ' + (l.lean === 'buy' ? 'buy' : l.lean === 'sell' ? 'sell' : '') + '">' + esc(l.lean) + '</span></td></tr>'; }).join('') : '<tr><td colspan="4" class="gp-muted">' + (d.preview ? 'Premium' : 'none yet') + '</td></tr>') + '</tbody></table></div>' +
      '<div class="gp-card"><h3>Largest off-exchange prints</h3><table><thead><tr><th>Price</th><th>Shares</th><th>Value</th></tr></thead><tbody>' +
      ((d.largest || []).length ? d.largest.map(function (p) { return '<tr><td>' + num(p.price) + '</td><td>' + esc(p.size.toLocaleString('en-US')) + '</td><td>' + money(p.notional) + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="gp-muted">' + (d.preview ? 'Premium' : 'none yet') + '</td></tr>') + '</tbody></table></div></div>';
    h += '<div class="gp-note">' + esc(d.caveat) + '</div>';
    if (CFG.watchlist && CFG.watchlist.length && !d.preview) h += '<p><button type="button" class="gp-btn" data-act="leaders">Compare the group\'s tickers</button></p><div class="leaders"></div>';
    return h;
  };

  RENDER.sentiment = function (d) {
    if (d.available === false) return '<p class="gp-muted">Not enough sources are answering to give an honest reading for ' + esc(d.symbol) + ' (' + esc(d.coverage || 0) + '% coverage).</p>';
    var h = '<div class="big ' + cls(d.score) + '">' + (d.scorePct > 0 ? '+' : '') + esc(d.scorePct) + '</div><div><b>' + esc(String(d.label).toUpperCase()) + '</b> <span class="gp-muted">' + esc(d.coverage) + '% of sources</span></div>' +
      '<div class="meter"><i style="left:' + Math.max(1, Math.min(99, 50 + d.score * 50)) + '%"></i></div><div class="meter-scale"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div><div class="gp-grid" style="margin-top:12px">';
    ['news', 'social', 'options', 'market'].forEach(function (k) {
      var c = d.components && d.components[k]; if (!c) return;
      h += '<div class="gp-card"><h3>' + esc(k.toUpperCase()) + (c.available ? ' <span class="' + cls(c.score) + '">' + (c.score > 0 ? '+' : '') + Math.round(c.score * 100) + '</span>' : ' <span class="gp-muted">not available</span>') + '</h3>';
      if (c.available) {
        if (k === 'news') h += '<p class="gp-muted">' + esc(c.n) + ' headlines, ' + esc(c.bull) + ' up, ' + esc(c.bear) + ' down</p>' + (c.drivers || []).map(function (x) { return '<div style="font-size:12px">' + esc(x.title) + '</div>'; }).join('');
        if (k === 'social') h += '<p class="gp-muted">' + esc(c.bull) + ' bullish, ' + esc(c.bear) + ' bearish' + (c.velocityRatio != null ? ', ' + esc(c.velocityRatio) + 'x normal chatter' : '') + '</p>';
        if (k === 'options') h += '<p class="gp-muted">' + (c.putCall && c.putCall.volume != null ? 'put/call volume ' + esc(c.putCall.volume) : '') + (c.maxPain != null ? ', max pain ' + esc(c.maxPain) : '') + '</p>';
        if (k === 'market') h += '<p class="gp-muted">' + esc(c.detail || '') + '</p>';
      } else h += '<p class="gp-muted">' + esc(c.reason || '') + '</p>';
      h += '</div>';
    });
    h += '</div>';
    (d.notes || []).forEach(function (n) { h += '<div class="gp-note">' + esc(n) + '</div>'; });
    return h;
  };

  /* ------------------------------------------------------------------ events */
  function onBodyClick(e) {
    var row = e.target.closest('tr[data-sym]');
    if (row) { S.symbol = row.getAttribute('data-sym'); S.data = {}; symEl.value = S.symbol; go('setups'); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'savelist') {
      var inp = bodyEl.querySelector('input.wl'); b.disabled = true;
      api('watchlist', { method: 'POST', body: { group_id: CFG.groupId, symbols: inp ? inp.value : '' } }).then(function (r) { S.list = r.symbols || []; CFG.watchlist = S.list; delete S.data['dashboard:' + S.symbol]; Object.keys(S.data).forEach(function (k) { if (k.indexOf('dashboard') === 0) delete S.data[k]; }); go('dashboard'); }).catch(function (er) { b.disabled = false; alert(er.message); });
    }
    if (act === 'leaders') {
      b.disabled = true; var box = bodyEl.querySelector('.leaders');
      run('leaders', { symbols: CFG.watchlist }).then(function (r) { box.innerHTML = '<table><thead><tr><th>Ticker</th><th>Off-exchange</th><th>Prints</th><th>Lean</th></tr></thead><tbody>' + (r.rows || []).map(function (x) { return '<tr><td>' + esc(x.symbol) + '</td><td>' + esc(x.offSharePct) + '%</td><td>' + esc(x.prints) + '</td><td>' + esc(x.lean || '') + '</td></tr>'; }).join('') + '</tbody></table><p class="gp-muted" style="font-size:11px">' + esc(r.caveat || '') + '</p>'; b.disabled = false; }).catch(function (er) { box.innerHTML = '<div class="gp-err">' + esc(er.message) + '</div>'; b.disabled = false; });
    }
  }
  function onBodyChange(e) {
    var t = e.target.closest('[data-opt]'); if (!t) return;
    S.opt[t.getAttribute('data-opt')] = t.value; fetchTab(false);
  }

  /* ------------------------------------------------------------------ entry point */
  function mountButton() {
    if (document.getElementById('sml-gpro-btn')) return true;
    var host = document.querySelector('.sml-gshell__side-actions') || document.querySelector('.sml-gshell__main-head');
    if (!host) return false;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'sml-gpro-btn'; b.textContent = 'Pro Tools'; b.title = 'Setups, absorption, options strategies, dark pool and the group dashboard';
    b.addEventListener('click', function () { open(); });
    host.appendChild(b); return true;
  }
  var tries = 0, t0 = setInterval(function () { tries += 1; if (mountButton() || tries > 12) { clearInterval(t0); if (!document.getElementById('sml-gpro-btn')) { var f = document.createElement('button'); f.type = 'button'; f.id = 'sml-gpro-btn'; f.className = 'floating'; f.textContent = 'Pro Tools'; f.addEventListener('click', function () { open(); }); document.body.appendChild(f); } } }, 500);
  if (window.MutationObserver) new MutationObserver(function () { if (!document.getElementById('sml-gpro-btn') && document.querySelector('.sml-gshell__side-actions')) mountButton(); }).observe(document.body, { childList: true, subtree: true });
  window.smlGroupProTools = { open: open };
})();
