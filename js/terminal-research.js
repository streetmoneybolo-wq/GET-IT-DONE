/* SML Terminal — NATIVE Research + News tabs (Phase 2, replaces the adopted legacy
   technicals/profile view and the adopted legacy news panel).
   Data (site endpoints only):
     company   /wp-json/sml/v1/company2?symbol=              name/description/marketCap/shares/employees/listDate/website/address
     history   /wp-json/sml/v1/history?symbol=&tf=1D         → technical readings computed HERE (RSI/MACD/KDJ/Bollinger/MA trend)
     earnings  /wp-json/sml-terminal-guard/v1/earnings?symbol= next date, latest period, revenue/eps/net income, filings, earnings_news
     financials/wp-json/sml-members/v1/market-data/fundamentals?symbol= datasets income_statement/balance_sheet/cash_flow/ratios
     filings   /wp-json/sml-members/v1/market-data/filings?symbol=
     news      /wp-json/sml-members/v1/news-feed?symbol=      the site's own coverage (title/excerpt/url/image/date_label/author)
   Exposes window.SML_TV2_RESEARCH.load(container) and window.SML_TV2_NEWS.load(container);
   terminal-options.js calls them instead of adopting legacy views. Every card shows the
   endpoint's own empty/error state — nothing is invented. */
(function () {
  'use strict';
  if (window.SML_TV2_RESEARCH) return;
  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  var NONCE = (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function big(n) { if (n == null || n === '' || isNaN(n)) return '—'; n = Number(n); var a = Math.abs(n); var s = n < 0 ? '-' : ''; if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T'; if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K'; return s + a.toFixed(a < 10 ? 2 : 0); }
  function f2(n) { return (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toFixed(2); }
  function pct(n) { return (n == null || n === '' || isNaN(n)) ? '—' : (Number(n) * (Math.abs(n) < 1.5 ? 100 : 1)).toFixed(1) + '%'; }
  function dstr(s) { if (!s) return '—'; var d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? String(s) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  function get(u) { return fetch(u, { credentials: 'same-origin', headers: NONCE ? { 'X-WP-Nonce': NONCE } : {} }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: false, status: r.status, j: null }; }); }); }

  var CSS = '' +
    '.tv2-rs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}@media(max-width:1000px){.tv2-rs{grid-template-columns:1fr}}' +
    '.tv2-rs-card{background:#0d141c;border:1px solid #16202b;border-radius:12px;padding:14px 16px;min-width:0}.tv2-rs-card.wide{grid-column:1/-1}' +
    '.tv2-rs-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}.tv2-rs-h b{font:700 12px/1 Archivo,sans-serif;color:#e6edf3;letter-spacing:.02em}.tv2-rs-h span{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-rs-name{font:700 18px/1.2 Archivo,sans-serif;color:#e6edf3}.tv2-rs-sub{font:500 10.5px/1.5 "IBM Plex Mono",monospace;color:#5d7085;margin-bottom:8px}' +
    '.tv2-rs-desc{font:400 12.5px/1.65 Archivo,sans-serif;color:#a9bccd;max-height:7.6em;overflow:hidden;position:relative}.tv2-rs-desc.open{max-height:none}.tv2-rs-more{font:600 11px Archivo,sans-serif;color:#00ff88;background:none;border:none;cursor:pointer;padding:6px 0}' +
    '.tv2-rs-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}@media(max-width:600px){.tv2-rs-facts{grid-template-columns:repeat(2,1fr)}}' +
    '.tv2-rs-fact{border:1px solid #131c26;border-radius:8px;background:#0b1119;padding:9px 10px}.tv2-rs-fact .k{font:500 9.5px/1 "IBM Plex Mono",monospace;color:#5d7085;letter-spacing:.08em;text-transform:uppercase}.tv2-rs-fact .v{font:700 13px/1.3 "IBM Plex Mono",monospace;color:#e6edf3;margin-top:4px;word-break:break-word}.tv2-rs-fact .v a{color:#00ccff;text-decoration:none}' +
    '.tv2-rs-tech{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tv2-rs-tech .t{border:1px solid #131c26;border-radius:8px;background:#0b1119;padding:10px}.tv2-rs-tech .t .k{font:500 9.5px/1 "IBM Plex Mono",monospace;color:#5d7085;letter-spacing:.08em;text-transform:uppercase}.tv2-rs-tech .t .v{font:700 15px/1.2 "IBM Plex Mono",monospace;margin-top:4px}.tv2-rs-tech .t .s{font:500 10px/1.4 Archivo,sans-serif;color:#8fa3b5;margin-top:2px}' +
    '.bullc{color:#00ff88}.bearc{color:#ff4757}.neutc{color:#ffd166}' +
    '.tv2-rs-gauge{display:flex;align-items:center;gap:12px;margin-bottom:10px}.tv2-rs-gauge .bar{flex:1;height:8px;border-radius:4px;background:linear-gradient(90deg,#ff4757,#ffd166,#00ff88);position:relative}.tv2-rs-gauge .bar i{position:absolute;top:-4px;width:4px;height:16px;background:#fff;border-radius:2px;transform:translateX(-2px);box-shadow:0 0 6px #fff}.tv2-rs-gauge b{font:700 12px/1 Archivo,sans-serif;white-space:nowrap}' +
    '.tv2-rs-table{width:100%;border-collapse:collapse;font:500 11px/1.4 "IBM Plex Mono",monospace}.tv2-rs-table th{font:600 9.5px/1 Archivo,sans-serif;color:#5d7085;text-align:right;padding:6px 6px;border-bottom:1px solid #131c26;letter-spacing:.06em;text-transform:uppercase}.tv2-rs-table th:first-child,.tv2-rs-table td:first-child{text-align:left;color:#8fa3b5;font-family:Archivo,sans-serif}.tv2-rs-table td{color:#e6edf3;text-align:right;padding:6px 6px;border-bottom:1px solid #0e1620}.tv2-rs-table td.neg{color:#ff4757}' +
    '.tv2-rs-tabs{display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap}.tv2-rs-tabs button{font:600 10.5px/1 Archivo,sans-serif;color:#8fa3b5;background:#0b1119;border:1px solid #16202b;border-radius:999px;padding:7px 11px;cursor:pointer}.tv2-rs-tabs button.on{color:#04060a;background:#00ff88;border-color:#00ff88}' +
    '.tv2-rs-list{display:flex;flex-direction:column;gap:8px}.tv2-rs-row{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #0e1620;padding:7px 0;font:500 11.5px/1.4 Archivo,sans-serif;color:#c9d6e2}.tv2-rs-row a{color:#00ccff;text-decoration:none}.tv2-rs-row .d{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085;white-space:nowrap}' +
    '.tv2-rs-empty{font:500 11.5px/1.6 "IBM Plex Mono",monospace;color:#5d7085;padding:10px 0}.tv2-rs-empty.err{color:#ff859f}' +
    '.tv2-nw{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}' +
    '.tv2-nw-card{background:#0d141c;border:1px solid #16202b;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;text-decoration:none;color:inherit}.tv2-nw-card:hover{border-color:#1d2b39}' +
    '.tv2-nw-img{aspect-ratio:16/9;background:#0b1119 center/cover no-repeat}.tv2-nw-bd{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px}' +
    '.tv2-nw-t{font:700 13.5px/1.35 Archivo,sans-serif;color:#e6edf3}.tv2-nw-x{font:400 12px/1.55 Archivo,sans-serif;color:#8fa3b5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.tv2-nw-m{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085;display:flex;gap:10px;flex-wrap:wrap;margin-top:auto}.tv2-nw-m b{color:#00ff88;font-weight:700}' +
    '.tv2-nw-h{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 12px}.tv2-nw-h b{font:700 13px Archivo,sans-serif;color:#e6edf3}.tv2-nw-h span{font:500 10px "IBM Plex Mono",monospace;color:#5d7085}';
  function css() { if (!document.getElementById('tv2-rs-css')) { var st = document.createElement('style'); st.id = 'tv2-rs-css'; st.textContent = CSS; document.head.appendChild(st); } }

  /* ---------- technical readings from daily bars ---------- */
  function techFromBars(b) {
    var c = b.map(function (x) { return x.c; }), n = c.length; if (n < 60) return null;
    function smaAt(p) { var s = 0; for (var i = n - p; i < n; i++) s += c[i]; return s / p; }
    function emaArr(p) { var k = 2 / (p + 1), e = c[0], out = [e]; for (var i = 1; i < n; i++) { e = c[i] * k + e * (1 - k); out.push(e); } return out; }
    var g = 0, l = 0; for (var i = n - 14; i < n; i++) { var d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } var rsi = l === 0 ? 100 : 100 - 100 / (1 + (g / 14) / (l / 14));
    var e12 = emaArr(12), e26 = emaArr(26), macdLine = e12.map(function (v, i) { return v - e26[i]; }); var sig = (function () { var k = 2 / 10, e = macdLine[0], out = [e]; for (var i = 1; i < macdLine.length; i++) { e = macdLine[i] * k + e * (1 - k); out.push(e); } return out; })(); var macd = macdLine[n - 1], macdSig = sig[n - 1], hist = macd - macdSig;
    /* KDJ 9,3,3: RSV over 9 sessions, K = smoothed RSV, D = smoothed K (seeded at 50 like the classic formula) */
    var K = 50, D = 50, J = 50;
    for (var ki = 9; ki < n; ki++) { var lo9 = Infinity, hi9 = -Infinity; for (var kj = ki - 8; kj <= ki; kj++) { lo9 = Math.min(lo9, b[kj].l); hi9 = Math.max(hi9, b[kj].h); } var rsv = hi9 > lo9 ? (c[ki] - lo9) / (hi9 - lo9) * 100 : 50; K = (2 / 3) * K + (1 / 3) * rsv; D = (2 / 3) * D + (1 / 3) * K; J = 3 * K - 2 * D; }
    var m20 = smaAt(20), sd = 0; for (i = n - 20; i < n; i++) sd += Math.pow(c[i] - m20, 2); sd = Math.sqrt(sd / 20); var bbPos = sd ? (c[n - 1] - m20) / (2 * sd) : 0; /* -1..+1 = lower..upper band */
    var m50 = smaAt(50), m200 = n >= 200 ? smaAt(200) : null, px = c[n - 1];
    var score = 0;
    score += rsi > 70 ? -1 : rsi < 30 ? 1 : (rsi > 55 ? .5 : rsi < 45 ? -.5 : 0);
    score += hist > 0 ? 1 : -1;
    score += K > 80 ? -.5 : K < 20 ? .5 : (K > 50 ? .5 : -.5);
    score += bbPos > .9 ? -.5 : bbPos < -.9 ? .5 : (bbPos > 0 ? .25 : -.25);
    score += px > m50 ? 1 : -1; if (m200) score += px > m200 ? 1 : -1;
    var max = m200 ? 5.5 : 4.5; var norm = score / max; /* -1..1 */
    var label = norm > .5 ? 'Strong buy' : norm > .15 ? 'Buy' : norm < -.5 ? 'Strong sell' : norm < -.15 ? 'Sell' : 'Neutral';
    return { rsi: rsi, macd: macd, macdSig: macdSig, hist: hist, K: K, D: D, J: J, bbPos: bbPos, m20: m20, m50: m50, m200: m200, px: px, norm: norm, label: label, asOf: b[n - 1].t };
  }
  function techHTML(t) {
    if (!t) return '<div class="tv2-rs-empty">Not enough daily history to compute technical readings for $' + esc(SYM) + '.</div>';
    var cls = function (v) { return v > 0 ? 'bullc' : v < 0 ? 'bearc' : 'neutc'; };
    var pos = Math.round((t.norm + 1) / 2 * 100);
    return '<div class="tv2-rs-gauge"><div class="bar"><i style="left:' + pos + '%"></i></div><b class="' + cls(t.norm) + '">' + esc(t.label) + '</b></div>' +
      '<div class="tv2-rs-tech">' +
      '<div class="t"><div class="k">RSI 14</div><div class="v ' + (t.rsi > 70 ? 'bearc' : t.rsi < 30 ? 'bullc' : 'neutc') + '">' + t.rsi.toFixed(1) + '</div><div class="s">' + (t.rsi > 70 ? 'overbought' : t.rsi < 30 ? 'oversold' : 'neutral zone') + '</div></div>' +
      '<div class="t"><div class="k">MACD 12·26·9</div><div class="v ' + cls(t.hist) + '">' + t.macd.toFixed(2) + '</div><div class="s">signal ' + t.macdSig.toFixed(2) + ' · hist ' + (t.hist >= 0 ? '+' : '') + t.hist.toFixed(2) + '</div></div>' +
      '<div class="t"><div class="k">KDJ 9·3·3</div><div class="v ' + (t.K > 80 ? 'bearc' : t.K < 20 ? 'bullc' : 'neutc') + '">K ' + t.K.toFixed(0) + '</div><div class="s">D ' + t.D.toFixed(0) + ' · J ' + t.J.toFixed(0) + '</div></div>' +
      '<div class="t"><div class="k">Bollinger 20·2</div><div class="v ' + (t.bbPos > .9 ? 'bearc' : t.bbPos < -.9 ? 'bullc' : 'neutc') + '">' + (t.bbPos >= 0 ? '+' : '') + (t.bbPos * 100).toFixed(0) + '%</div><div class="s">of band width from the middle (' + f2(t.m20) + ')</div></div>' +
      '<div class="t"><div class="k">vs MA 50</div><div class="v ' + cls(t.px - t.m50) + '">' + f2(t.m50) + '</div><div class="s">price ' + (t.px > t.m50 ? 'above' : 'below') + '</div></div>' +
      '<div class="t"><div class="k">vs MA 200</div><div class="v ' + (t.m200 ? cls(t.px - t.m200) : 'neutc') + '">' + (t.m200 ? f2(t.m200) : '—') + '</div><div class="s">' + (t.m200 ? 'price ' + (t.px > t.m200 ? 'above' : 'below') : 'needs 200 sessions') + '</div></div>' +
      '</div><div class="tv2-rs-empty" style="padding:8px 0 0">Computed from daily closes as of ' + esc(dstr(new Date(t.asOf).toISOString().slice(0, 10))) + ' · not investment advice.</div>';
  }

  /* ---------- financial tables ---------- */
  function finTable(rows, spec) {
    if (!rows || !rows.length) return '<div class="tv2-rs-empty">Not reported for $' + esc(SYM) + ' (funds/ETFs don’t file financial statements).</div>';
    var cols = rows.slice(0, 4);
    var head = '<tr><th></th>' + cols.map(function (r) { return '<th>' + esc((r.fiscal_year ? 'FY' + String(r.fiscal_year).slice(-2) : '') + (r.fiscal_quarter ? ' Q' + r.fiscal_quarter : '') || dstr(r.period_end || r.date)) + '</th>'; }).join('') + '</tr>';
    var body = spec.map(function (s) { return '<tr><td>' + esc(s[1]) + '</td>' + cols.map(function (r) { var v = r[s[0]]; var neg = typeof v === 'number' && v < 0; return '<td class="' + (neg ? 'neg' : '') + '">' + (s[2] ? s[2](v) : big(v)) + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<div style="overflow:auto"><table class="tv2-rs-table">' + head + body + '</table></div>';
  }
  var FIN = {
    income: [['revenue', 'Revenue'], ['gross_profit', 'Gross profit'], ['operating_income', 'Operating income'], ['net_income_loss_attributable_common_shareholders', 'Net income'], ['basic_earnings_per_share', 'EPS (basic)', f2]],
    balance: [['total_assets', 'Total assets'], ['total_current_assets', 'Current assets'], ['total_current_liabilities', 'Current liabilities'], ['total_liabilities', 'Total liabilities'], ['total_equity', 'Total equity']],
    cash: [['net_cash_from_operating_activities', 'Operating cash flow'], ['net_cash_from_investing_activities', 'Investing cash flow'], ['net_cash_from_financing_activities', 'Financing cash flow'], ['purchase_of_property_plant_equipment', 'Capex'], ['free_cash_flow', 'Free cash flow']],
    ratios: [['price_to_earnings', 'P/E', f2], ['price_to_book', 'P/B', f2], ['price_to_sales', 'P/S', f2], ['ev_to_ebitda', 'EV/EBITDA', f2], ['return_on_equity', 'ROE', pct], ['return_on_assets', 'ROA', pct], ['debt_to_equity', 'Debt/Equity', f2], ['dividend_yield', 'Dividend yield', pct], ['current', 'Current ratio', f2]]
  };

  function loadResearch(v) {
    css();
    v.innerHTML = '<div class="tv2-rs">' +
      '<div class="tv2-rs-card" data-r="company"><div class="tv2-rs-h"><b>COMPANY PROFILE</b><span>$' + esc(SYM) + '</span></div><div class="tv2-rs-empty">Loading…</div></div>' +
      '<div class="tv2-rs-card" data-r="tech"><div class="tv2-rs-h"><b>TECHNICAL SENTIMENT</b><span>daily · computed on-site</span></div><div class="tv2-rs-empty">Loading daily history…</div></div>' +
      '<div class="tv2-rs-card" data-r="earn"><div class="tv2-rs-h"><b>EARNINGS</b><span id="tv2rs-earn-src"></span></div><div class="tv2-rs-empty">Loading…</div></div>' +
      '<div class="tv2-rs-card" data-r="filings"><div class="tv2-rs-h"><b>SEC FILINGS</b><span>latest</span></div><div class="tv2-rs-empty">Loading…</div></div>' +
      '<div class="tv2-rs-card wide" data-r="fin"><div class="tv2-rs-h"><b>FINANCIALS</b><span>reported statements</span></div><div class="tv2-rs-tabs"><button class="on" data-f="income">Income</button><button data-f="balance">Balance sheet</button><button data-f="cash">Cash flow</button><button data-f="ratios">Key ratios</button></div><div data-fin-body class="tv2-rs-empty">Loading…</div></div>' +
      '</div>';
    var q = function (sel) { return v.querySelector(sel); };
    /* company */
    get('/wp-json/sml/v1/company2?symbol=' + encodeURIComponent(SYM)).then(function (r) {
      var c = q('[data-r="company"]'); var d = r.ok && r.j && !r.j.error ? r.j : null;
      if (!d || !(d.name || d.description)) { c.innerHTML = c.firstElementChild.outerHTML + '<div class="tv2-rs-empty">' + esc((r.j && (r.j.message || r.j.error)) || 'No company profile is available for $' + SYM + '.') + '</div>'; return; }
      var hq = [d.city, d.state, d.country].filter(Boolean).join(', ');
      var site = d.website ? String(d.website).replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
      c.innerHTML = c.firstElementChild.outerHTML + '<div class="tv2-rs-name">' + esc(d.name || SYM) + '</div><div class="tv2-rs-sub">' + esc([d.symbol || SYM, d.market, d.type, d.currency].filter(Boolean).join(' · ')) + '</div>' +
        (d.description ? '<div class="tv2-rs-desc" id="tv2rs-desc">' + esc(d.description) + '</div><button type="button" class="tv2-rs-more" id="tv2rs-more">Read more</button>' : '') +
        '<div class="tv2-rs-facts">' + [['Market cap', big(d.marketCap)], ['Shares', big(d.shares)], ['Employees', d.employees ? Number(d.employees).toLocaleString() : '—'], ['Listed', dstr(d.listDate)], ['HQ', hq || '—'], ['Website', site ? '<a href="' + esc(d.website) + '" target="_blank" rel="noopener nofollow">' + esc(site.slice(0, 28)) + '</a>' : '—']].map(function (f) { return '<div class="tv2-rs-fact"><div class="k">' + f[0] + '</div><div class="v">' + f[1] + '</div></div>'; }).join('') + '</div>';
      var more = q('#tv2rs-more'), desc = q('#tv2rs-desc'); if (more) more.addEventListener('click', function () { desc.classList.toggle('open'); more.textContent = desc.classList.contains('open') ? 'Show less' : 'Read more'; });
    });
    /* technicals from daily bars */
    get('/wp-json/sml/v1/history?symbol=' + encodeURIComponent(SYM) + '&tf=1D').then(function (r) {
      var c = q('[data-r="tech"]'); var bars = r.ok && r.j && Array.isArray(r.j.bars) ? r.j.bars : [];
      c.innerHTML = c.firstElementChild.outerHTML + (bars.length ? techHTML(techFromBars(bars)) : '<div class="tv2-rs-empty">Daily history isn’t available for $' + esc(SYM) + ' right now.</div>');
    });
    /* earnings */
    get('/wp-json/sml-terminal-guard/v1/earnings?symbol=' + encodeURIComponent(SYM)).then(function (r) {
      var c = q('[data-r="earn"]'); var d = r.ok && r.j ? r.j : null;
      if (!d || (!d.next_earnings_date && d.revenue == null && d.eps == null)) { c.innerHTML = c.firstElementChild.outerHTML + '<div class="tv2-rs-empty">' + esc((d && d.errors && d.errors[0]) || (r.j && r.j.message) || 'No earnings data is available for $' + SYM + '.') + '</div>'; return; }
      var src = q('#tv2rs-earn-src'); if (src) src.textContent = d.source_label || '';
      c.innerHTML = c.firstElementChild.outerHTML + '<div class="tv2-rs-facts" style="margin-top:0">' + [['Next earnings', dstr(d.next_earnings_date)], ['Latest period', d.latest_period || '—'], ['Revenue', big(d.revenue)], ['EPS', f2(d.eps)], ['Net income', big(d.net_income)], ['Updated', d.updated_at ? dstr(d.updated_at) : '—']].map(function (f) { return '<div class="tv2-rs-fact"><div class="k">' + f[0] + '</div><div class="v">' + f[1] + '</div></div>'; }).join('') + '</div>' +
        ((d.earnings_news || []).length ? '<div class="tv2-rs-list" style="margin-top:10px">' + d.earnings_news.slice(0, 5).map(function (n) { return '<div class="tv2-rs-row"><a href="' + esc(n.url || n.link || '#') + '" target="_blank" rel="noopener">' + esc(n.title || n.headline || 'Earnings note') + '</a><span class="d">' + esc(dstr(n.date || n.published)) + '</span></div>'; }).join('') + '</div>' : '');
    });
    /* filings */
    get('/wp-json/sml-members/v1/market-data/filings?symbol=' + encodeURIComponent(SYM)).then(function (r) {
      var c = q('[data-r="filings"]'); var list = r.ok && r.j && Array.isArray(r.j.filings) ? r.j.filings : [];
      c.innerHTML = c.firstElementChild.outerHTML + (list.length ? '<div class="tv2-rs-list">' + list.slice(0, 8).map(function (f) { return '<div class="tv2-rs-row"><span><a href="' + esc(f.filing_url || '#') + '" target="_blank" rel="noopener nofollow">' + esc(f.form_type || 'Filing') + '</a> <span style="color:#5d7085">' + esc((f.issuer_name || '').slice(0, 40)) + '</span></span><span class="d">' + esc(dstr(f.filing_date)) + '</span></div>'; }).join('') + '</div>' : '<div class="tv2-rs-empty">' + esc((r.j && r.j.message) || (r.status === 401 || r.status === 403 ? 'Sign in to view SEC filings.' : 'No filings found for $' + SYM + '.')) + '</div>');
    });
    /* financials */
    /* newest-first statements via the terminal data API (the members fundamentals route
       returns one oldest record per dataset); falls back to that route if this one is absent */
    get('/wp-json/sml-short/v1/financials?symbol=' + encodeURIComponent(SYM) + '&limit=8').then(function (r) {
      if (r.ok && r.j && r.j.datasets) return r;
      return get('/wp-json/sml-members/v1/market-data/fundamentals?symbol=' + encodeURIComponent(SYM));
    }).then(function (r) {
      var body = q('[data-fin-body]'); var ds = r.ok && r.j && r.j.datasets ? r.j.datasets : null;
      if (!ds) { body.className = 'tv2-rs-empty'; body.textContent = (r.j && r.j.message) || (r.status === 401 || r.status === 403 ? 'Sign in to view financial statements.' : 'Financial statements are not available for $' + SYM + '.'); return; }
      var byDate = function (arr) { return (arr || []).slice().sort(function (a, b) { return String(b.period_end || b.date || '').localeCompare(String(a.period_end || a.date || '')); }); };   /* newest period first */
      var data = { income: byDate(ds.income_statement), balance: byDate(ds.balance_sheet), cash: byDate(ds.cash_flow), ratios: byDate(ds.ratios) };
      var show = function (k) { body.className = ''; body.innerHTML = finTable(data[k], FIN[k]); };
      show('income');
      q('[data-r="fin"] .tv2-rs-tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-f]'); if (!b) return; Array.prototype.forEach.call(q('[data-r="fin"] .tv2-rs-tabs').children, function (x) { x.classList.toggle('on', x === b); }); show(b.getAttribute('data-f')); });
    });
  }

  function loadNews(v) {
    css();
    v.innerHTML = '<div class="tv2-nw-h"><b>$' + esc(SYM) + ' coverage on Stock Market Loop</b><span id="tv2nw-count"></span></div><div class="tv2-nw" id="tv2nw-grid"><div class="tv2-rs-empty">Loading…</div></div>';
    get('/wp-json/sml-members/v1/news-feed?symbol=' + encodeURIComponent(SYM)).then(function (r) {
      var grid = v.querySelector('#tv2nw-grid'); var arts = r.ok && r.j && Array.isArray(r.j.articles) ? r.j.articles : [];
      var cnt = v.querySelector('#tv2nw-count'); if (cnt) cnt.textContent = arts.length ? arts.length + ' articles' : '';
      if (!arts.length) { grid.innerHTML = '<div class="tv2-rs-empty">' + esc((r.j && r.j.message) || 'No Stock Market Loop articles mention $' + SYM + ' yet.') + '</div>'; return; }
      grid.innerHTML = arts.map(function (a) {
        return '<a class="tv2-nw-card" href="' + esc(a.url || a.link || '#') + '">' + (a.image ? '<div class="tv2-nw-img" style="background-image:url(\'' + esc(a.image) + '\')"></div>' : '') + '<div class="tv2-nw-bd"><div class="tv2-nw-t">' + esc(a.title || '') + '</div>' + (a.excerpt ? '<div class="tv2-nw-x">' + esc(String(a.excerpt).replace(/<[^>]+>/g, '')) + '</div>' : '') + '<div class="tv2-nw-m">' + (a.author ? '<span>' + esc(a.author) + '</span>' : '') + '<span>' + esc(a.date_label || dstr(a.date)) + '</span>' + (a.comment_count ? '<span>' + a.comment_count + ' comments</span>' : '') + ((a.tickers || []).length ? '<span>' + a.tickers.slice(0, 4).map(function (t) { return '<b>$' + esc(String(t).replace(/^\$/, '')) + '</b>'; }).join(' ') + '</span>' : '') + '</div></div></a>';
      }).join('');
    });
  }

  window.SML_TV2_RESEARCH = { load: loadResearch };
  window.SML_TV2_NEWS = { load: loadNews };
})();
