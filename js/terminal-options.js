/*!
 * SML Terminal — OPTIONS tab, styled EXACTLY like the site's original options
 * module (its own sml-opt CSS, re-scoped to #sml-opt2): green CALLS / blue
 * STRIKE / red PUTS sticky headers, ITM shading, glowing ATM row, expiry pill
 * bar — plus the module's signature GOLD premium pane as the price calculator:
 *   - click any contract side → the calculator loads it (auto-recompute)
 *   - gold sliders: what-if stock price · date scrub to expiry · IV
 *   - decay-curve canvas: theoretical value across time with scrub marker
 *   - Black-Scholes (r 4.5% disclosed), intrinsic/time, Δ/θ, model-vs-market edge
 *   - StockMarketLoop lockup on the pane; NO provider labels anywhere.
 * Data: the site's own chain endpoint (credentials). Zeroed anon pricing is
 * shown as "—" with an honest note — values are never fabricated.
 */
(function () {
  'use strict';
  if (!/[?&]tv2=1(&|$)/.test(location.search)) return;
  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  var LOGO = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@3560eef3c519/img/loop-logo.png';
  var R = 0.045;

  var self = document.currentScript;
  var BASE = self && self.src ? self.src.replace(/js\/terminal-options\.js.*$/, '') : '';

  /* ---------- Black-Scholes ---------- */
  function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  function ncdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
  function npdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
  function bs(type, S, K, T, iv) {
    if (T <= 0) { var i0 = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S); return { price: i0, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), theta: 0 }; }
    var sq = iv * Math.sqrt(T), d1 = (Math.log(S / K) + (R + iv * iv / 2) * T) / sq, d2 = d1 - sq, price, delta;
    if (type === 'call') { price = S * ncdf(d1) - K * Math.exp(-R * T) * ncdf(d2); delta = ncdf(d1); }
    else { price = K * Math.exp(-R * T) * ncdf(-d2) - S * ncdf(-d1); delta = ncdf(d1) - 1; }
    var theta = (-(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) - (type === 'call' ? 1 : -1) * R * K * Math.exp(-R * T) * ncdf((type === 'call' ? 1 : -1) * d2)) / 365;
    return { price: Math.max(0, price), delta: delta, theta: theta };
  }

  /* ---------- state / data ---------- */
  var st = { spot: null, exp: null, expirations: [], contracts: [], sel: null, S: null, iv: 0.20, dayT: null, note: '', chg: null, pct: null };
  function f2(v) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(2); }
  function mk(v) { return (v == null || v === 0) ? null : Number(v); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function fetchQuote() {
    return fetch('/wp-json/sml/v1/quote?symbol=' + SYM, { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (q) { if (q && q.current) { st.spot = q.current; st.chg = q.change; st.pct = q.percentChange; if (st.S == null) st.S = q.current; } }).catch(function () {});
  }
  function fetchChain(exp) {
    var u = '/wp-json/sml-members/v1/market-data/options?symbol=' + SYM + (exp ? '&expiration=' + exp : '');
    return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      // REST error (e.g. "The market-data plan does not authorize this dataset")
      // → surface the endpoint's own words, never an empty fake chain
      if (d && d.code && d.message) { st.err = d.message; st.expirations = []; st.contracts = []; return; }
      st.err = '';
      st.expirations = d.expirations || [];
      st.exp = d.expiration || exp;
      st.contracts = (d.contracts || []).filter(function (c) { return c && c.strike; });
      if (mk(d.underlying)) { st.spot = d.underlying; if (st.S == null) st.S = d.underlying; }
      var priced = st.contracts.some(function (c) { return mk(c.last) || mk(c.bid) || mk(c.ask) || mk(c.iv); });
      st.note = priced ? '' : 'Live option marks unavailable on this session — model running on the IV slider.';
      if (exp && st.exp !== exp) st.note = 'Feed served ' + st.exp + '. ' + st.note;
    });
  }
  // model horizon = the expiration the user PICKED in the pill bar (the chain is
  // displayed under that header). If the feed served a different expiry's marks
  // (anon sessions ignore the param), market-derived numbers are suppressed.
  function daysToExp() { if (!st.exp) return 0; return Math.max(0, Math.ceil((new Date(st.exp + 'T21:00:00Z') - Date.now()) / 864e5)); }
  function expMatch() { return !!(st.sel && st.sel.expiration === st.exp); }

  /* ---------- render: original layout ---------- */
  function render(view) {
    var up = (st.chg || 0) >= 0;
    var html =
      '<div id="sml-opt2">' +
        '<div class="hdr3"><div class="hL">' +
          '<div class="tk3">$' + esc(SYM) + '</div>' +
          '<div class="hmeta"><div class="hname">Options Command Center</div><div class="hsub">Chain · theoretical pricing · time decay</div></div>' +
          '<div class="hpx3"><div class="pxbig3' + (up ? '' : ' dn2') + '">' + f2(st.spot) + '</div>' +
          '<div class="pxchg3 ' + (up ? 'gpos' : 'gneg') + '">' + (st.chg == null ? '' : ((up ? '+' : '') + f2(st.chg) + ' (' + (up ? '+' : '') + f2(st.pct) + '%)')) + '</div></div>' +
        '</div><div class="hR">' +
          '<div class="stat3"><div class="sl">Expiration</div><div class="sv">' + esc(st.exp || '—') + '</div><div class="sv2">' + (st.sel ? daysToExp() + ' days out' : (st.contracts.length + ' contracts')) + '</div></div>' +
          '<div class="stat3"><div class="sl">Session</div><div class="sv"><span class="dot on"></span> ' + (st.contracts.length ? 'Chain loaded' : 'Chain unavailable') + '</div><div class="sv2">' + (st.contracts.length ? (st.note ? 'model mode' : 'live marks') : 'this session') + '</div></div>' +
        '</div></div>' +
        (st.note ? '<div class="subline orng" style="padding:0 4px 8px">' + esc(st.note) + '</div>' : '');
    if (!st.contracts.length) {
      // no chain for this symbol on this session — say exactly why, show nothing fake
      html += '<div class="empty" style="padding:28px 16px;text-align:center">' +
        esc(st.err || 'No option contracts were returned for this symbol on this session.') +
        '<div style="margin-top:8px;font-size:11px;color:#7f93b5">Signed-in members may have access to this chain.</div></div></div>';
      view.innerHTML = html;
      return;
    }
    html +=
        '<div class="explab vfl">Expirations</div><div class="expbar" data-o-exp></div>' +
        '<div class="chwrap"><table><thead>' +
          '<tr><th class="hcalls" colspan="4">CALLS</th><th class="hstrike">STRIKE</th><th class="hputs" colspan="4">PUTS</th></tr>' +
          '<tr><th>BID</th><th>ASK</th><th>LAST</th><th>IV</th><th></th><th>IV</th><th>LAST</th><th>ASK</th><th>BID</th></tr>' +
        '</thead><tbody data-o-body></tbody></table></div>' +
        '<div class="panes3">' +
          '<div class="pane gold" data-o-calc></div>' +
          '<div class="pane"><div class="ph"><span>DECAY CURVE</span><span class="tabs2"><button class="on">THEORETICAL</button></span></div>' +
            '<canvas data-o-curve width="520" height="240"></canvas>' +
            '<div class="legend"><span><i style="background:#f5c95c"></i>model value over time</span><span><span class="dsh" style="border-color:#7f93b5"></span>intrinsic</span><span><i style="background:#2f7bff"></i>your date</span></div></div>' +
          '<div class="pane"><div class="ph"><span>CONTRACT METRICS</span></div><div data-o-metrics class="cards6" style="grid-template-columns:1fr 1fr"></div></div>' +
        '</div>' +
      '</div>';
    view.innerHTML = html;

    // expiry pills
    var bar = view.querySelector('[data-o-exp]');
    var today = new Date().toISOString().slice(0, 10);
    st.expirations.filter(function (x) { return x >= today || x === st.exp; }).forEach(function (x) {
      var b = document.createElement('button'); b.textContent = x; if (x === st.exp) b.className = 'on';
      b.addEventListener('click', function () { fetchChain(x).then(function () { st.sel = null; st.dayT = null; render(view); }); });
      bar.appendChild(b);
    });
    var on = bar.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });

    // chain rows
    var tb = view.querySelector('[data-o-body]');
    var byStrike = {}; st.contracts.forEach(function (c) { (byStrike[c.strike] = byStrike[c.strike] || {})[c.type] = c; });
    var strikes = Object.keys(byStrike).map(Number).sort(function (a, b) { return a - b; });
    if (st.spot && strikes.length > 50) {
      strikes.sort(function (a, b) { return Math.abs(a - st.spot) - Math.abs(b - st.spot); });
      strikes = strikes.slice(0, 50).sort(function (a, b) { return a - b; });
    }
    var atmK = null;
    if (st.spot) strikes.forEach(function (k) { if (atmK == null || Math.abs(k - st.spot) < Math.abs(atmK - st.spot)) atmK = k; });
    strikes.forEach(function (k) {
      var c = byStrike[k].call, p = byStrike[k].put;
      var tr = document.createElement('tr');
      var cls = [];
      if (st.spot) { if (k < st.spot) cls.push('itmC'); if (k > st.spot) cls.push('itmP'); if (k === atmK) cls.push('atm'); }
      tr.className = cls.join(' ');
      function v(x) { return x == null ? '—' : f2(x); }
      tr.innerHTML =
        '<td class="cs pm">' + (c ? v(mk(c.bid)) : '') + '</td><td class="cs pm">' + (c ? v(mk(c.ask)) : '') + '</td><td class="cs">' + (c ? v(mk(c.last)) : '') + '</td><td class="cs mut">' + (c && mk(c.iv) ? (c.iv * 100).toFixed(1) + '%' : '—') + '</td>' +
        '<td class="k">' + k + '</td>' +
        '<td class="ps mut">' + (p && mk(p.iv) ? (p.iv * 100).toFixed(1) + '%' : '—') + '</td><td class="ps">' + (p ? v(mk(p.last)) : '') + '</td><td class="ps pm">' + (p ? v(mk(p.ask)) : '') + '</td><td class="ps pm">' + (p ? v(mk(p.bid)) : '') + '</td>';
      tr.addEventListener('click', function (ev) {
        var rect = tr.getBoundingClientRect();
        var side = (ev.clientX - rect.left) < rect.width / 2 ? 'call' : 'put';
        var pick = byStrike[k][side] || byStrike[k][side === 'call' ? 'put' : 'call'];
        if (pick) { st.sel = pick; st.dayT = null; if (mk(pick.iv)) st.iv = pick.iv; paintCalc(view); }
      });
      tb.appendChild(tr);
    });

    paintCalc(view);
  }

  /* ---------- the GOLD calculator pane + curve + metrics ---------- */
  function paintCalc(view) {
    var pane = view.querySelector('[data-o-calc]');
    var curve = view.querySelector('[data-o-curve]');
    var metrics = view.querySelector('[data-o-metrics]');
    if (!pane) return;
    if (!st.sel) {
      pane.innerHTML = '<div class="ph"><span>⚡ PRICE CALCULATOR</span><img src="' + LOGO + '" style="height:20px"></div>' +
        '<div class="subline">Click a contract in the chain — calls on the left, puts on the right. The calculator loads it instantly.</div>' +
        '<div class="empty">No contract selected.</div>';
      if (metrics) metrics.innerHTML = '<div class="empty" style="grid-column:1/-1">—</div>';
      if (curve) { var g0 = curve.getContext('2d'); g0.clearRect(0, 0, curve.width, curve.height); }
      return;
    }
    var c = st.sel, D = daysToExp();
    if (st.dayT == null) st.dayT = D;
    var S = st.S || st.spot || c.strike;
    var out = bs(c.type, S, c.strike, st.dayT / 365, st.iv);
    var intr = c.type === 'call' ? Math.max(0, S - c.strike) : Math.max(0, c.strike - S);
    var timeVal = Math.max(0, out.price - intr);
    // market comparisons only when the served contract really is this expiry
    var mid = expMatch() ? ((mk(c.bid) && mk(c.ask)) ? (c.bid + c.ask) / 2 : mk(c.last)) : null;
    var edge = mid ? ((out.price - mid) / mid * 100) : null;
    var scrubDate = new Date(Date.now() + (D - st.dayT) * 864e5).toISOString().slice(0, 10);

    pane.innerHTML =
      '<div class="ph"><span>⚡ ' + esc(SYM) + ' ' + esc(st.exp) + ' ' + (c.type === 'call' ? 'CALL' : 'PUT') + ' $' + c.strike + '</span><img src="' + LOGO + '" style="height:20px"></div>' +
      '<div class="bigv" data-g-price>$' + f2(out.price) + '</div>' +
      '<div class="subline">theoretical value at $' + f2(S) + ' on ' + scrubDate + (edge != null ? ' · <b class="' + (edge > 0 ? 'gpos' : 'gneg') + '">model ' + (edge > 0 ? '+' : '') + edge.toFixed(1) + '% vs market $' + f2(mid) + '</b>' : '') + '</div>' +
      '<div class="gcal">' +
        '<div class="gc"><div class="v">$' + f2(intr) + '</div><div class="l">Intrinsic</div></div>' +
        '<div class="gc"><div class="v">$' + f2(timeVal) + '</div><div class="l">Time val</div></div>' +
        '<div class="gc"><div class="v">' + out.delta.toFixed(2) + '</div><div class="l">Delta</div></div>' +
        '<div class="gc"><div class="v">' + f2(out.theta) + '</div><div class="l">Theta/d</div></div>' +
        '<div class="gc"><div class="v">' + st.dayT + 'd</div><div class="l">To expiry</div></div>' +
      '</div>' +
      '<div class="vfl">Stock price — what if · $<span data-g-s>' + f2(S) + '</span></div>' +
      '<input data-g-sr type="range" min="' + Math.round((st.spot || S) * 0.75) + '" max="' + Math.round((st.spot || S) * 1.25) + '" step="0.5" value="' + S + '">' +
      '<div class="vfl" style="margin-top:8px">Date — scrub to expiry · ' + esc(scrubDate) + '</div>' +
      '<input data-g-dr type="range" min="0" max="' + D + '" step="1" value="' + (D - st.dayT) + '">' +
      '<div class="vfl" style="margin-top:8px">Implied volatility · <span data-g-iv>' + (st.iv * 100).toFixed(0) + '%</span>' + (mk(c.iv) ? ' <span class="mut">(market)</span>' : ' <span class="mut">(your setting)</span>') + '</div>' +
      '<input data-g-ivr type="range" min="5" max="150" step="1" value="' + Math.round(st.iv * 100) + '">' +
      '<div class="ginfo">' +
        '<div><div class="l">Spot now</div><div class="v">$' + f2(st.spot) + '</div></div>' +
        '<div><div class="l">Strike</div><div class="v">$' + c.strike + '</div></div>' +
        '<div><div class="l">Model</div><div class="v" style="font-size:10px;line-height:1.4">Black-Scholes<br>r 4.5% · est. only</div></div>' +
      '</div>';

    pane.querySelector('[data-g-sr]').addEventListener('input', function () { st.S = Number(this.value); paintCalc(view); });
    pane.querySelector('[data-g-dr]').addEventListener('input', function () { st.dayT = D - Number(this.value); paintCalc(view); });
    pane.querySelector('[data-g-ivr]').addEventListener('input', function () { st.iv = Number(this.value) / 100; paintCalc(view); });

    // metrics cards
    if (metrics) {
      var m = expMatch(); // never show another expiry's marks as this contract's
      metrics.innerHTML =
        '<div class="k6 blu"><div><div class="v">' + (m && mk(c.iv) ? (c.iv * 100).toFixed(1) + '%' : '—') + '</div><div class="l">MARKET IV</div></div></div>' +
        '<div class="k6 ' + (edge == null ? 'blu' : (edge > 0 ? 'grn' : 'red')) + '"><div><div class="v">' + (edge == null ? '—' : (edge > 0 ? '+' : '') + edge.toFixed(1) + '%') + '</div><div class="l">MODEL VS MKT</div></div></div>' +
        '<div class="k6 grn"><div><div class="v">' + (m && c.volume ? c.volume : '—') + '</div><div class="l">VOLUME</div></div></div>' +
        '<div class="k6 blu"><div><div class="v">' + (m && c.open_interest ? c.open_interest : '—') + '</div><div class="l">OPEN INT</div></div></div>';
    }

    // decay curve
    if (curve) {
      var g = curve.getContext('2d'), W = curve.width, H = curve.height;
      g.clearRect(0, 0, W, H);
      var pts = [], max = 0, N = Math.max(D, 1);
      for (var d = 0; d <= N; d++) { var pv = bs(c.type, S, c.strike, (N - d) / 365, st.iv).price; pts.push(pv); if (pv > max) max = pv; }
      max = Math.max(max, intr, 0.01) * 1.12;
      function X(i) { return 34 + (W - 44) * (i / N); }
      function Y(v) { return H - 22 - (H - 40) * (v / max); }
      // grid
      g.strokeStyle = '#101a2c'; g.lineWidth = 1;
      for (var gy = 0; gy <= 4; gy++) { var yy = 18 + (H - 40) * gy / 4; g.beginPath(); g.moveTo(34, yy); g.lineTo(W - 10, yy); g.stroke(); }
      // intrinsic dashed
      g.setLineDash([5, 4]); g.strokeStyle = '#7f93b5'; g.beginPath(); g.moveTo(34, Y(intr)); g.lineTo(W - 10, Y(intr)); g.stroke(); g.setLineDash([]);
      // value curve (gold with glow)
      g.shadowColor = 'rgba(245,185,66,.5)'; g.shadowBlur = 8;
      g.strokeStyle = '#f5c95c'; g.lineWidth = 2.2; g.beginPath();
      pts.forEach(function (pv, i) { var x = X(i), y = Y(pv); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.stroke(); g.shadowBlur = 0;
      // scrub marker
      var mi = D - st.dayT;
      g.fillStyle = '#2f7bff'; g.beginPath(); g.arc(X(mi), Y(pts[mi] || 0), 4.5, 0, 7); g.fill();
      g.strokeStyle = 'rgba(47,123,255,.4)'; g.beginPath(); g.moveTo(X(mi), 18); g.lineTo(X(mi), H - 22); g.stroke();
      // axis labels
      g.fillStyle = '#7f93b5'; g.font = '10px ui-monospace,monospace';
      g.fillText('$' + max.toFixed(0), 2, 22); g.fillText('$0', 2, H - 20);
      g.fillText('today', 34, H - 6); g.fillText(st.exp || '', W - 78, H - 6);
    }
  }

  /* ---------- artifact tab wiring ---------- */
  function boot(root) {
    var shell = root.querySelector(':scope > :last-child');
    while (shell && shell.children.length === 1) shell = shell.children[0];
    if (!shell || shell.children.length < 4) return false;
    var tabsZone = shell.children[2], body = shell.children[3];
    if (root.__optionsWired) return true;
    var labels = {};
    [].forEach.call(tabsZone.querySelectorAll('*'), function (e) {
      var t = (e.textContent || '').trim();
      if (e.children.length === 0 && /^(Overview|Options|Research|News)$/.test(t)) labels[t] = e;
    });
    if (!labels.Options || !labels.Overview) return false;
    root.__optionsWired = true;

    if (BASE && !document.getElementById('sml-opt2-css')) {
      var lk = document.createElement('link'); lk.id = 'sml-opt2-css'; lk.rel = 'stylesheet';
      lk.href = BASE + 'css/terminal-options.css'; document.head.appendChild(lk);
    }

    // one view container per non-Overview tab; Overview = the artifact body itself
    var views = {};
    ['Options', 'Research', 'News'].forEach(function (n) {
      var v = document.createElement('div');
      v.setAttribute('data-tv2-view', n.toLowerCase());
      v.style.cssText = 'display:none;padding:16px 24px 24px';
      body.parentNode.insertBefore(v, body.nextSibling);
      views[n] = v;
    });
    var view = views.Options;
    view.setAttribute('data-tv2-options-view', '1');

    // adopted legacy views must stay visible even if the legacy tab controller
    // later writes inline display:none (stylesheet !important beats inline)
    var stg = document.createElement('style');
    stg.textContent =
      '[data-tv2-view] .sml-pro-view{display:block!important}' +
      // the legacy page kills this panel as a live-feed duplicate; inside the
      // News tab it IS the content — un-kill it here only (scope outranks their !important)
      '[data-tv2-view] .sml-pro-panel.sml-lf-kill{display:block!important}' +
      '[data-tv2-view="research"] .tv2-rgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:16px;align-items:start}' +
      '@media(max-width:1100px){[data-tv2-view="research"] .tv2-rgrid{grid-template-columns:1fr}}' +
      '[data-tv2-view] .tv2-rcard{background:#0d141c;border:1px solid #16202b;border-radius:12px;padding:14px 16px;min-width:0}' +
      '[data-tv2-view] #sml-profile-host{max-width:none!important;margin:0!important}';
    document.head.appendChild(stg);

    function legacyTab(rx) {
      var bs = [].slice.call(document.querySelectorAll('.sml-pro-tabs button'));
      return bs.filter(function (b) { return rx.test((b.textContent || '').trim()); })[0] || null;
    }
    // click the legacy tab so its module lazy-mounts, then move the mounted
    // element into the design container (retry ~6s; adopt whatever state exists)
    function adoptLegacy(clickRx, getEl, readyFn, target) {
      var b = legacyTab(clickRx);
      if (b) { try { b.click(); } catch (e) {} }
      var n = 0, t = setInterval(function () {
        var el = getEl();
        if (el && (readyFn(el) || n > 24)) { clearInterval(t); target.appendChild(el); }
        else if (++n > 30) clearInterval(t);
      }, 250);
    }
    function loadResearch(v) {
      v.innerHTML = '<div class="tv2-rgrid">' +
        '<div class="tv2-rcard" data-r-tech></div>' +
        '<div class="tv2-rcard" data-r-prof></div></div>';
      // Technical Sentiment gauge: already booted, idle in the hidden legacy rail
      var g = document.getElementById('sml-tech-host');
      if (g) v.querySelector('[data-r-tech]').appendChild(g);
      else v.querySelector('[data-r-tech]').style.display = 'none';
      // Company Profile: the legacy Research view (adopt the WHOLE view — the
      // moveprofile observer keeps #sml-profile-host inside it, so no tug-of-war)
      adoptLegacy(/^Research$/i,
        function () { return document.querySelector('.sml-terminal .sml-pro-view[data-pro-view="technicals"]'); },
        function (el) { return !!el.querySelector('#sml-profile-host .sml-cp'); },
        v.querySelector('[data-r-prof]'));
    }
    function loadNews(v) {
      v.innerHTML = '<div class="tv2-rcard" data-n-host></div>';
      adoptLegacy(/^News$/i,
        function () { return document.querySelector('.sml-terminal .sml-pro-view[data-pro-view="news"]'); },
        function (el) { return !!el.querySelector('.sml-pro-panel'); },
        v.querySelector('[data-n-host]'));
    }

    function activate(name) {
      body.style.display = (name === 'Overview') ? '' : 'none';
      Object.keys(views).forEach(function (n) { views[n].style.display = (n === name) ? 'block' : 'none'; });
      Object.keys(labels).forEach(function (k) { labels[k].style.color = (k === name) ? '#00ff88' : ''; labels[k].style.cursor = 'pointer'; });
      if (name === 'Research' && !views.Research.__loaded) { views.Research.__loaded = true; loadResearch(views.Research); }
      if (name === 'News' && !views.News.__loaded) { views.News.__loaded = true; loadNews(views.News); }
      if (name === 'Options' && !view.__loaded) {
        view.__loaded = true;
        view.innerHTML = '<div style="font:400 12px ui-monospace,monospace;color:#8fa3b5">Loading the ' + SYM + ' chain…</div>';
        Promise.all([fetchQuote(), fetchChain(null)]).then(function () {
          var today = new Date().toISOString().slice(0, 10);
          if (st.exp && st.exp < today) {
            var next = (st.expirations || []).filter(function (x) { return x >= today; })[0];
            if (next) return fetchChain(next).then(function () { render(view); });
          }
          render(view);
        }).catch(function () {
          view.innerHTML = '<div style="font:400 12px ui-monospace,monospace;color:#ffb454">The options feed didn’t respond — try again shortly.</div>';
          view.__loaded = false;
        });
      }
    }
    Object.keys(labels).forEach(function (k) {
      labels[k].style.cursor = 'pointer';
      labels[k].addEventListener('click', function () { activate(k); });
    });
    return true;
  }

  var tries = 0;
  var t = setInterval(function () {
    var r = document.getElementById('sml-tv2-root'); var ok = false;
    try { ok = r && r.getAttribute('data-artifact') === '1' && boot(r); } catch (e) {}
    if (ok || ++tries > 60) clearInterval(t);
  }, 300);
})();
