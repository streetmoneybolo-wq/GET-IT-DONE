/*!
 * SML Terminal — OPTIONS tab: real chain + what-if price calculator.
 *  - Chain from the site's own moomoo-backed endpoint (credentials; structure
 *    always real, pricing real when the session is entitled — zeros are shown
 *    as "—" and the model runs on user-adjustable IV, never fabricated marks).
 *  - Click a contract → the calculator loads it and auto-recomputes.
 *  - Date scrubber: today → expiration (theoretical price through time decay).
 *  - Underlying price input + slider: what-if before expiry.
 *  - Black-Scholes (r = 4.5% disclosed), intrinsic/time split, delta/theta.
 *  - "Edge" readout: model value vs market mid → rich/cheap %, when marks exist.
 *  - StockMarketLoop lockup on the panel; NO provider (MASSIVE/moomoo) labels.
 */
(function () {
  'use strict';
  if (!/[?&]tv2=1(&|$)/.test(location.search)) return;
  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  var LOGO = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@3560eef3c519/img/loop-logo.png';
  var R = 0.045; // risk-free, disclosed in the UI

  /* ---------- Black-Scholes ---------- */
  function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  function ncdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
  function npdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
  function bs(type, S, K, T, iv) {
    if (T <= 0) { var intr = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S); return { price: intr, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), theta: 0 }; }
    var sq = iv * Math.sqrt(T);
    var d1 = (Math.log(S / K) + (R + iv * iv / 2) * T) / sq, d2 = d1 - sq;
    var price, delta;
    if (type === 'call') { price = S * ncdf(d1) - K * Math.exp(-R * T) * ncdf(d2); delta = ncdf(d1); }
    else { price = K * Math.exp(-R * T) * ncdf(-d2) - S * ncdf(-d1); delta = ncdf(d1) - 1; }
    var theta = (-(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) - (type === 'call' ? 1 : -1) * R * K * Math.exp(-R * T) * ncdf((type === 'call' ? 1 : -1) * d2)) / 365;
    return { price: Math.max(0, price), delta: delta, theta: theta };
  }

  /* ---------- state ---------- */
  var st = { spot: null, exp: null, expirations: [], contracts: [], sel: null, S: null, iv: 0.20, dayT: null, note: '' };
  function f2(v) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(2); }
  function mk(v) { return (v == null || v === 0) ? null : Number(v); }

  function fetchQuote() {
    return fetch('/wp-json/sml/v1/quote?symbol=' + SYM, { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (q) { if (q && q.current) { st.spot = q.current; if (st.S == null) st.S = q.current; } }).catch(function () {});
  }
  function fetchChain(exp) {
    var u = '/wp-json/sml-members/v1/market-data/options?symbol=' + SYM + (exp ? '&expiration=' + exp : '');
    return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      st.expirations = d.expirations || [];
      st.exp = d.expiration || exp;
      st.contracts = (d.contracts || []).filter(function (c) { return c && c.strike; });
      if (mk(d.underlying)) { st.spot = d.underlying; if (st.S == null) st.S = d.underlying; }
      var priced = st.contracts.some(function (c) { return mk(c.last) || mk(c.bid) || mk(c.ask) || mk(c.iv); });
      st.note = priced ? '' : 'Market pricing not available on this session — model running on your IV setting.';
      if (exp && st.exp !== exp) st.note = 'Feed returned ' + st.exp + ' — expiry selection limited on this session. ' + st.note;
    });
  }

  /* ---------- UI ---------- */
  var css = 'ui-monospace,Menlo,Consolas,monospace';
  function el(tag, style, html) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (html != null) e.innerHTML = html; return e; }

  function daysToExp() { if (!st.sel) return 0; return Math.max(0, Math.ceil((new Date(st.sel.expiration + 'T21:00:00Z') - Date.now()) / 864e5)); }

  function render(view) {
    view.innerHTML = '';
    // header: SML lockup + title + expiry select (NO provider labels anywhere)
    var head = el('div', 'display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap');
    head.appendChild(el('img', 'height:30px;width:auto')).src = LOGO;
    head.appendChild(el('div', 'font:700 16px Archivo,sans-serif;color:#e6edf3', '$' + SYM + ' OPTIONS'));
    var sel = document.createElement('select');
    sel.style.cssText = 'background:#131c26;border:1px solid #1c2833;border-radius:8px;color:#e6edf3;padding:7px 10px;font:600 12px ' + css;
    st.expirations.forEach(function (x) { var o = document.createElement('option'); o.value = x; o.textContent = x; if (x === st.exp) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { fetchChain(sel.value).then(function () { st.sel = null; render(view); }); });
    head.appendChild(sel);
    if (st.note) head.appendChild(el('div', 'font:400 10.5px ' + css + ';color:#ffb454', st.note));
    view.appendChild(head);

    var wrap = el('div', 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap');
    view.appendChild(wrap);

    // ---- chain ----
    var chain = el('div', 'flex:1 1 480px;min-width:0;background:#0d141c;border:1px solid #16202b;border-radius:10px;overflow:hidden');
    chain.appendChild(el('div', 'font:600 10px ' + css + ';letter-spacing:.14em;color:#8fa3b5;padding:9px 12px;border-bottom:1px solid #16202b;background:#080c12', 'CHAIN · ' + (st.exp || '—') + ' · CLICK A CONTRACT'));
    var scroller = el('div', 'max-height:520px;overflow:auto');
    var tbl = el('table', 'width:100%;border-collapse:collapse;font:400 11.5px ' + css + ';color:#d5e2ee');
    tbl.innerHTML = '<thead><tr style="color:#5d7085;font-size:9.5px;letter-spacing:.1em">' +
      '<th style="padding:6px 8px;text-align:right">CALL BID</th><th style="padding:6px 8px;text-align:right">ASK</th><th style="padding:6px 8px;text-align:right">IV</th>' +
      '<th style="padding:6px 10px;text-align:center;color:#8fa3b5">STRIKE</th>' +
      '<th style="padding:6px 8px;text-align:right">IV</th><th style="padding:6px 8px;text-align:right">BID</th><th style="padding:6px 8px;text-align:right">PUT ASK</th></tr></thead>';
    var tb = document.createElement('tbody');
    var byStrike = {};
    st.contracts.forEach(function (c) { (byStrike[c.strike] = byStrike[c.strike] || {})[c.type] = c; });
    var strikes = Object.keys(byStrike).map(Number).sort(function (a, b) { return a - b; });
    // center around spot: show ~40 strikes nearest the money
    if (st.spot && strikes.length > 44) {
      strikes.sort(function (a, b) { return Math.abs(a - st.spot) - Math.abs(b - st.spot); });
      strikes = strikes.slice(0, 44).sort(function (a, b) { return a - b; });
    }
    strikes.forEach(function (k) {
      var c = byStrike[k].call, p = byStrike[k].put;
      var tr = document.createElement('tr');
      tr.style.cssText = 'border-top:1px solid #10161d;cursor:pointer';
      var atm = st.spot && Math.abs(k - st.spot) < (st.spot * 0.0035);
      if (atm) tr.style.background = 'rgba(0,255,136,.05)';
      function cell(v, align, color) { return '<td style="padding:5px 8px;text-align:' + align + ';color:' + (color || '#d5e2ee') + '">' + v + '</td>'; }
      tr.innerHTML =
        cell(c ? (mk(c.bid) ? f2(c.bid) : '—') : '', 'right', '#00e07a') + cell(c ? (mk(c.ask) ? f2(c.ask) : '—') : '', 'right', '#00e07a') + cell(c && mk(c.iv) ? (c.iv * 100).toFixed(1) + '%' : '—', 'right', '#5d7085') +
        cell('<b style="color:#e6edf3">' + k + '</b>', 'center') +
        cell(p && mk(p.iv) ? (p.iv * 100).toFixed(1) + '%' : '—', 'right', '#5d7085') + cell(p ? (mk(p.bid) ? f2(p.bid) : '—') : '', 'right', '#ff4757') + cell(p ? (mk(p.ask) ? f2(p.ask) : '—') : '', 'right', '#ff4757');
      tr.addEventListener('click', function (ev) {
        var x = ev.clientX - tr.getBoundingClientRect().left;
        var side = x < tr.getBoundingClientRect().width / 2 ? 'call' : 'put';
        var pick = byStrike[k][side] || byStrike[k][side === 'call' ? 'put' : 'call'];
        if (pick) { st.sel = pick; st.dayT = null; if (mk(pick.iv)) st.iv = pick.iv; render(view); calcScroll(); }
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); scroller.appendChild(tbl); chain.appendChild(scroller); wrap.appendChild(chain);

    // ---- calculator ----
    var calc = el('div', 'flex:0 1 380px;background:#0d141c;border:1px solid #134a33;border-radius:10px;padding:14px 16px', '');
    calc.setAttribute('data-tv2-calc', '1');
    wrap.appendChild(calc);
    renderCalc(calc);
    function calcScroll() { try { calc.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {} }
  }

  function renderCalc(calc) {
    if (!st.sel) {
      calc.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><img src="' + LOGO + '" style="height:24px"><b style="font:700 13px Archivo,sans-serif;color:#e6edf3">PRICE CALCULATOR</b></div>' +
        '<div style="font:400 12px ' + css + ';color:#8fa3b5;line-height:1.6">Click any contract in the chain to load it. Scrub the date to expiry and shift the stock price to see the theoretical value — your edge before you enter.</div>';
      return;
    }
    var c = st.sel, D = daysToExp();
    if (st.dayT == null) st.dayT = D;
    var T = st.dayT / 365;
    var out = bs(c.type, st.S || st.spot || c.strike, c.strike, T, st.iv);
    var S = st.S || st.spot || c.strike;
    var intrinsic = c.type === 'call' ? Math.max(0, S - c.strike) : Math.max(0, c.strike - S);
    var timeVal = Math.max(0, out.price - intrinsic);
    var mid = (mk(c.bid) && mk(c.ask)) ? (c.bid + c.ask) / 2 : mk(c.last);
    var edge = mid ? ((out.price - mid) / mid * 100) : null;

    calc.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><img src="' + LOGO + '" style="height:24px">' +
      '<b style="font:700 13px Archivo,sans-serif;color:#e6edf3">' + SYM + ' ' + c.expiration + ' ' + (c.type === 'call' ? 'CALL' : 'PUT') + ' $' + c.strike + '</b></div>' +
      '<div style="font:700 30px ' + css + ';color:#00ff88;letter-spacing:-.02em" data-c-price>$' + f2(out.price) + '</div>' +
      '<div style="font:400 10.5px ' + css + ';color:#5d7085;margin:2px 0 12px">theoretical value · intrinsic $' + f2(intrinsic) + ' + time $' + f2(timeVal) + ' · Δ ' + out.delta.toFixed(2) + ' · θ ' + f2(out.theta) + '/day' + (edge != null ? (' · <span style="color:' + (edge > 0 ? '#00e07a' : '#ff4757') + '">model ' + (edge > 0 ? '+' : '') + edge.toFixed(1) + '% vs market $' + f2(mid) + '</span>') : '') + '</div>' +
      '<label style="display:block;font:600 9.5px ' + css + ';letter-spacing:.12em;color:#8fa3b5;margin-bottom:3px">STOCK PRICE — WHAT IF · $<span data-c-s>' + f2(S) + '</span></label>' +
      '<input data-c-srange type="range" min="' + (Math.round((st.spot || S) * 0.75)) + '" max="' + (Math.round((st.spot || S) * 1.25)) + '" step="0.5" value="' + S + '" style="width:100%;accent-color:#00ff88;margin-bottom:12px">' +
      '<label style="display:block;font:600 9.5px ' + css + ';letter-spacing:.12em;color:#8fa3b5;margin-bottom:3px">DATE — SCRUB TO EXPIRY · <span data-c-d>' + st.dayT + '</span> DAYS LEFT (' + new Date(Date.now() + (D - st.dayT) * 864e5).toISOString().slice(0, 10) + ')</label>' +
      '<input data-c-drange type="range" min="0" max="' + D + '" step="1" value="' + (D - st.dayT) + '" style="width:100%;accent-color:#00ccff;margin-bottom:12px">' +
      '<label style="display:block;font:600 9.5px ' + css + ';letter-spacing:.12em;color:#8fa3b5;margin-bottom:3px">IMPLIED VOLATILITY · <span data-c-iv>' + (st.iv * 100).toFixed(0) + '%</span>' + (mk(c.iv) ? ' (market)' : ' (your setting)') + '</label>' +
      '<input data-c-ivrange type="range" min="5" max="150" step="1" value="' + Math.round(st.iv * 100) + '" style="width:100%;accent-color:#8fa3b5;margin-bottom:8px">' +
      '<div style="font:400 9.5px ' + css + ';color:#4c5d6d">model: Black-Scholes · rate 4.5% · educational estimate, not advice</div>';

    calc.querySelector('[data-c-srange]').addEventListener('input', function () { st.S = Number(this.value); renderCalc(calc); });
    calc.querySelector('[data-c-drange]').addEventListener('input', function () { st.dayT = D - Number(this.value); renderCalc(calc); });
    calc.querySelector('[data-c-ivrange]').addEventListener('input', function () { st.iv = Number(this.value) / 100; renderCalc(calc); });
  }

  /* ---------- artifact tab wiring ---------- */
  function boot(root) {
    var shell = root.querySelector(':scope > :last-child');
    while (shell && shell.children.length === 1) shell = shell.children[0];
    if (!shell || shell.children.length < 4) return false;
    var tabsZone = shell.children[2], body = shell.children[3];
    if (root.__optionsWired) return true;
    // find the artifact's static tab labels
    var labels = {};
    [].forEach.call(tabsZone.querySelectorAll('*'), function (e) {
      var t = (e.textContent || '').trim();
      if (e.children.length === 0 && /^(Overview|Options|Research|News)$/.test(t)) labels[t] = e;
    });
    if (!labels.Options || !labels.Overview) return false;
    root.__optionsWired = true;

    var view = el('div', 'display:none;padding:16px 24px 24px');
    view.setAttribute('data-tv2-options-view', '1');
    body.parentNode.insertBefore(view, body.nextSibling);

    function activate(name) {
      var showOpt = name === 'Options';
      body.style.display = showOpt ? 'none' : '';
      view.style.display = showOpt ? 'block' : 'none';
      Object.keys(labels).forEach(function (k) {
        labels[k].style.color = (k === name) ? '#00ff88' : '';
        labels[k].style.cursor = 'pointer';
      });
      if (showOpt && !view.__loaded) {
        view.__loaded = true;
        view.innerHTML = '<div style="font:400 12px ' + css + ';color:#8fa3b5">Loading the ' + SYM + ' chain…</div>';
        Promise.all([fetchQuote(), fetchChain(null)]).then(function () { render(view); }).catch(function () {
          view.innerHTML = '<div style="font:400 12px ' + css + ';color:#ffb454">The options feed didn’t respond — try again shortly.</div>';
          view.__loaded = false;
        });
      }
    }
    Object.keys(labels).forEach(function (k) {
      labels[k].style.cursor = 'pointer';
      labels[k].addEventListener('click', function () {
        if (k === 'Options' || k === 'Overview') activate(k);
        // Research/News stay on Overview for now (wired in a later phase)
      });
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
