/* Options dock for the Academy Live Chart Lab: puts the options chain right under the chart with a Black-Scholes price calculator beside it.
   The chain itself is the existing College Options Chain Lab (verified member data); this file moves it up, loads it for the symbol on the chart as soon as the member's Academy access is verified,
   and fills the calculator from whichever contract row the member clicks. Needs window.SmlOptionsCalc. */
(function boot(tries) {
  const chain = document.getElementById('options-chain');
  const below = document.getElementById('academy-below');
  const C = window.SmlOptionsCalc;
  if (window.__smlOptionsDock) return;
  if (!chain || !below || !C) { if (tries < 120) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlOptionsDock = true;

  const $ = (id) => document.getElementById(id);
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' && String(v).trim() !== '—' ? n : null; };
  const money = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fx = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  const spotLive = () => num(($('price') || {}).textContent);

  const style = document.createElement('style');
  style.textContent = '.options-dock{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:14px;align-items:start;margin:0 0 18px}.options-dock>.options-chain{margin-top:0;min-width:0}'
    + '.opt-calc{position:sticky;top:8px;padding:14px;border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dcebf4;font:600 .72rem system-ui,sans-serif}'
    + '.opt-calc h2{margin:0 0 8px;font:800 .8rem ui-monospace,monospace;color:#42f5b3;letter-spacing:.03em}.opt-calc .oc-side{display:flex;gap:6px;margin-bottom:10px}.opt-calc .oc-side button{flex:1;padding:7px;border:1px solid #2b5362;border-radius:6px;background:#10212b;color:#eaf5f8;font:800 .7rem system-ui;cursor:pointer}.opt-calc .oc-side button.on.call{background:#00c47d;color:#042217;border-color:#00c47d}.opt-calc .oc-side button.on.put{background:#ff5470;color:#2a0509;border-color:#ff5470}'
    + '.opt-calc .oc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.opt-calc label{display:flex;flex-direction:column;gap:3px;color:#8fa6b3;font-size:.62rem;font-weight:700}.opt-calc input{width:100%;padding:7px 8px;border:1px solid #2b5362;border-radius:6px;background:#061019;color:#f0f8fb;font:700 .8rem ui-monospace,monospace}.opt-calc input:focus{outline:2px solid #42f5b3;outline-offset:0}'
    + '.opt-calc .oc-row{display:flex;gap:6px;align-items:end}.opt-calc .oc-row label{flex:1}.opt-calc .oc-mini{padding:7px 9px;border:1px solid #2b5362;border-radius:6px;background:#10212b;color:#eaf5f8;font:800 .62rem system-ui;cursor:pointer;white-space:nowrap}'
    + '.opt-calc .oc-out{margin-top:12px;padding:10px;border:1px solid #1d3a48;border-radius:8px;background:#07121b}.opt-calc .oc-big{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.opt-calc .oc-big b{font:800 1.5rem ui-monospace,monospace;color:#fff}.opt-calc .oc-big span{color:#8fa6b3}'
    + '.opt-calc dl{display:grid;grid-template-columns:1fr auto;gap:3px 10px;margin:8px 0 0}.opt-calc dt{color:#8fa6b3}.opt-calc dd{margin:0;text-align:right;font-family:ui-monospace,monospace;color:#eaf5f8}'
    + '.opt-calc table{width:100%;border-collapse:collapse;margin-top:8px;font:600 .62rem ui-monospace,monospace}.opt-calc th,.opt-calc td{padding:3px 4px;text-align:right;border-bottom:1px solid rgba(42,66,78,.5)}.opt-calc th{color:#8fa6b3;font-weight:700}.opt-calc td.pos{color:#52e6ad}.opt-calc td.neg{color:#ff778b}.opt-calc tr.now td{background:rgba(66,245,179,.08)}'
    + '.opt-calc .oc-note{margin-top:8px;color:#7f97a4;font-size:.58rem;line-height:1.4;font-weight:500}.opt-calc .oc-hint{color:#ffd166;margin-top:6px;font-size:.6rem}#options-grid tr{cursor:pointer}#options-grid tr:hover td{background:rgba(66,245,179,.06)}'
    + '@media(max-width:1000px){.options-dock{grid-template-columns:1fr}.opt-calc{position:static}}';
  document.head.appendChild(style);

  const dock = document.createElement('div'); dock.className = 'options-dock'; dock.id = 'options-dock';
  const card = document.createElement('section'); card.className = 'opt-calc'; card.setAttribute('aria-label', 'Options price calculator');
  card.innerHTML = '<h2>OPTIONS PRICE CALCULATOR</h2>'
    + '<div class="oc-side"><button type="button" data-side="call" class="call on">CALL</button><button type="button" data-side="put" class="put">PUT</button></div>'
    + '<div class="oc-row"><label>Stock price<input id="oc-spot" inputmode="decimal" autocomplete="off"></label><button type="button" class="oc-mini" id="oc-live">Use live</button></div>'
    + '<div class="oc-grid" style="margin-top:8px"><label>Strike<input id="oc-strike" inputmode="decimal" autocomplete="off"></label><label>Days to expiry<input id="oc-days" inputmode="decimal" autocomplete="off"></label>'
    + '<label>Implied vol %<input id="oc-iv" inputmode="decimal" autocomplete="off"></label><label>Contracts<input id="oc-qty" inputmode="numeric" autocomplete="off"></label>'
    + '<label>Interest rate %<input id="oc-rate" inputmode="decimal" autocomplete="off"></label><label>Dividend yield %<input id="oc-div" inputmode="decimal" autocomplete="off"></label></div>'
    + '<div class="oc-row" style="margin-top:8px"><label>Market price paid / quoted (optional)<input id="oc-mkt" inputmode="decimal" autocomplete="off" placeholder="e.g. 3.20"></label><button type="button" class="oc-mini" id="oc-solve">Solve IV</button></div>'
    + '<div class="oc-out" id="oc-out" aria-live="polite"></div>'
    + '<div class="oc-hint" id="oc-hint">Click any row in the chain to load that contract here.</div>'
    + '<div class="oc-note">Black-Scholes model value for a European option. Real equity options can be American-style and trade at their own bid/ask, so treat this as a learning estimate, not a quote. Not investment advice.</div>';
  const first = below.querySelector('.below-title');
  if (first) first.after(dock); else below.prepend(dock);
  dock.appendChild(chain); dock.appendChild(card);
  const title = below.querySelector('.below-title'); if (title) title.textContent = 'OPTIONS CHAIN + PRICE CALCULATOR · SCANNER';

  const S = { side: 'call', touchedSpot: false };
  const el = { spot: $('oc-spot'), strike: $('oc-strike'), days: $('oc-days'), iv: $('oc-iv'), qty: $('oc-qty'), rate: $('oc-rate'), div: $('oc-div'), mkt: $('oc-mkt'), out: $('oc-out') };
  el.qty.value = '1'; el.rate.value = '4.3'; el.div.value = '0'; el.iv.value = '25'; el.days.value = '30';

  function seedFromLive() {
    const s = spotLive(); if (s == null) return;
    if (!S.touchedSpot) el.spot.value = s.toFixed(2);
    if (!el.strike.value) { const step = s >= 200 ? 5 : s >= 50 ? 1 : 0.5; el.strike.value = (Math.round(s / step) * step).toFixed(2); }
  }
  function read() {
    const g = (e) => { const v = Number(e.value); return e.value.trim() !== '' && Number.isFinite(v) ? v : null; };
    return { S: g(el.spot), K: g(el.strike), days: g(el.days), iv: g(el.iv), qty: g(el.qty), rate: g(el.rate), div: g(el.div), mkt: g(el.mkt) };
  }
  function render() {
    const v = read();
    if ([v.S, v.K, v.days, v.iv, v.rate, v.div].some((x) => x == null) || v.S <= 0 || v.K <= 0 || v.iv <= 0 || v.days < 0) { el.out.innerHTML = '<div class="oc-note">Fill in the stock price, strike, days to expiry and implied volatility.</div>'; return; }
    const T = v.days / 365, r = v.rate / 100, q = v.div / 100, sig = v.iv / 100, qty = Math.max(1, Math.round(v.qty || 1));
    const p = C.price(S.side, v.S, v.K, T, r, q, sig); if (!p) { el.out.innerHTML = '<div class="oc-note">Those numbers cannot be priced.</div>'; return; }
    const premium = v.mkt != null && v.mkt > 0 ? v.mkt : p.price;
    const be = C.breakeven(S.side, v.K, premium), moneyness = S.side === 'call' ? v.S - v.K : v.K - v.S;
    const rows = C.scenarios(S.side, v.S, v.K, T, r, q, sig, premium, qty);
    const cls = (x) => (x > 0.005 ? 'pos' : x < -0.005 ? 'neg' : '');
    el.out.innerHTML = '<div class="oc-big"><b>' + money(p.price) + '</b><span>model price per share · ' + money(p.price * 100 * qty) + ' for ' + qty + ' contract' + (qty > 1 ? 's' : '') + '</span></div>'
      + '<dl><dt>Intrinsic / extrinsic</dt><dd>' + money(p.intrinsic) + ' / ' + money(p.extrinsic) + '</dd>'
      + '<dt>' + (moneyness > 0 ? 'In the money by' : moneyness < 0 ? 'Out of the money by' : 'At the money') + '</dt><dd>' + (moneyness === 0 ? '—' : money(Math.abs(moneyness))) + '</dd>'
      + '<dt>Breakeven at expiry' + (v.mkt != null && v.mkt > 0 ? ' (your price)' : '') + '</dt><dd>' + money(be) + '</dd>'
      + '<dt>Chance of finishing in the money</dt><dd>' + (p.probITM * 100).toFixed(1) + '%</dd>'
      + '<dt>Delta</dt><dd>' + fx(p.delta) + '</dd><dt>Gamma</dt><dd>' + fx(p.gamma, 4) + '</dd><dt>Theta per day</dt><dd>' + fx(p.theta) + '</dd><dt>Vega per 1 vol point</dt><dd>' + fx(p.vega) + '</dd><dt>Rho per 1% rate</dt><dd>' + fx(p.rho) + '</dd></dl>'
      + '<table><thead><tr><th>Stock moves</th><th>Stock</th><th>Value now</th><th>P/L at expiry</th></tr></thead><tbody>'
      + rows.map((x) => '<tr' + (x.move === 0 ? ' class="now"' : '') + '><td>' + (x.move > 0 ? '+' : '') + (x.move * 100).toFixed(1) + '%</td><td>' + x.spot.toFixed(2) + '</td><td>' + money(x.valueNow) + '</td><td class="' + cls(x.plExpiry) + '">' + money(x.plExpiry, 0) + '</td></tr>').join('') + '</tbody></table>'
      + '<div class="oc-note">P/L assumes you bought ' + qty + ' contract' + (qty > 1 ? 's' : '') + ' at ' + money(premium) + (v.mkt != null && v.mkt > 0 ? ' (your price)' : ' (the model price)') + ' and held to expiry. Max loss is the premium: ' + money(premium * 100 * qty, 0) + '.</div>';
  }
  function solve() {
    const v = read(); const hint = $('oc-hint');
    if ([v.S, v.K, v.days, v.rate, v.div, v.mkt].some((x) => x == null) || v.days <= 0 || v.mkt <= 0) { hint.textContent = 'To solve implied volatility, enter the stock price, strike, days to expiry (above zero) and a market price.'; return; }
    const iv = C.impliedVol(S.side, v.S, v.K, v.days / 365, v.rate / 100, v.div / 100, v.mkt);
    if (iv == null) { hint.textContent = 'No volatility can produce that price (it may be below the option’s intrinsic value).'; return; }
    el.iv.value = (iv * 100).toFixed(1); hint.textContent = 'Implied volatility that matches ' + money(v.mkt) + ' is ' + (iv * 100).toFixed(1) + '%.'; render();
  }
  card.addEventListener('input', (e) => { if (e.target === el.spot) S.touchedSpot = true; render(); });
  card.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    if (b.dataset.side) { S.side = b.dataset.side; card.querySelectorAll('.oc-side button').forEach((x) => x.classList.toggle('on', x === b)); render(); }
    else if (b.id === 'oc-live') { S.touchedSpot = false; seedFromLive(); render(); }
    else if (b.id === 'oc-solve') solve();
  });

  // click a contract row in the chain -> load it into the calculator
  const daysTo = (text) => { const m = /\d{4}-\d{2}-\d{2}/.exec(String(text || '')); if (!m) return null; const end = new Date(m[0] + 'T21:00:00'); return Number.isNaN(end.valueOf()) ? null : Math.max(0, Math.ceil((end - new Date()) / 86400000)); };
  const grid = $('options-grid');
  if (grid) grid.addEventListener('click', (e) => {
    const td = e.target.closest && e.target.closest('td'), tr = td && td.parentElement; if (!tr || !tr.cells || tr.cells.length < 21) return;
    const idx = td.cellIndex, side = idx > 10 ? 'put' : 'call', c = tr.cells;
    const strike = num(c[10].textContent); if (strike == null) return;
    const ivCell = num(c[side === 'call' ? 0 : 20].textContent), mid = num(c[side === 'call' ? 9 : 11].textContent);
    S.side = side; card.querySelectorAll('.oc-side button').forEach((x) => x.classList.toggle('on', x.dataset.side === side));
    el.strike.value = strike.toFixed(2);
    const exp = $('options-expiry'), d = exp ? daysTo(exp.value || (exp.selectedOptions[0] || {}).textContent) : null; if (d != null) el.days.value = String(d);
    if (ivCell != null && ivCell > 0) el.iv.value = ivCell.toFixed(1).replace(/\.0$/, '');
    el.mkt.value = mid != null && mid > 0 ? mid.toFixed(2) : '';
    $('oc-hint').textContent = 'Loaded the ' + strike.toFixed(2) + ' ' + side + (d != null ? ' expiring in ' + d + ' days' : '') + '. Change any number to see how the price moves.';
    render();
  });

  // load the chain for the chart's symbol as soon as Academy access is verified, and again when the symbol changes
  let session = '', shownSymbol = '';
  const symbolNow = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();
  window.addEventListener('sml-academy-session', (e) => { session = String((e.detail && e.detail.sessionToken) || ''); shownSymbol = ''; });
  function autoLoad() {
    const btn = $('load-options'), sym = symbolNow();
    if (!btn || !session || btn.disabled || sym === shownSymbol) return;
    shownSymbol = sym; btn.click();
  }
  setInterval(() => { if (window.smlChartGesture) return; autoLoad(); seedFromLive(); if (!document.activeElement || !card.contains(document.activeElement)) render(); }, 1500);
  seedFromLive(); render();
})(0);
