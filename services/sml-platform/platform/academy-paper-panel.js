/* PAPER TRADE for the Academy Live Chart Lab: a SIMULATED brokerage account on real prices. A toolbar toggle swaps the options
 * dock for a ticket (stock or option, buy or sell, any session a price exists in), the positions and P&L, a P&L calendar whose
 * days open a recap (the market, the account, what it says), and the trade log. Two accounts: MINE (every member) and the
 * CHALLENGE account (everyone can watch; only the owner trades it). Routes under /academy-activity/paper. Not real money. */
(() => {
  if (window.__smlPaper) return;
  window.__smlPaper = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const usd = (v, d = 2) => (num(v) == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  const chartSym = () => { try { return String(window.smlAcademyChartState().symbol || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); } catch (_) { return String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); } };
  const KEY = 'sml-paper-v1';
  const S = { on: false, account: 'me', session: String(window.smlAcademySessionToken || ''), data: {}, err: '', busy: false, prevTitle: '', owner: false, timer: 0, ticket: { kind: 'stock', side: 'buy', qty: '1', symbol: '', expiry: '', strike: '', right: 'C', note: '' }, chain: null, chainSym: '', month: new Date().toISOString().slice(0, 7), cal: null, dayRecap: null, msg: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.on = v.on === true; if (v.account === 'challenge') S.account = 'challenge'; } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, account: S.account })); } catch (_) { /* ignore */ } };
  const toolbar = document.querySelector('.toolbar'); if (!toolbar) return;

  const style = document.createElement('style');
  style.textContent = '.paper-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2a4a2a;border-radius:7px;background:#061a0a;color:#9ff0b0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.paper-toggle.on{background:#145a2a;border-color:#52e6ad;color:#fff}'
    + '#paper-panel{padding:14px;border:1px solid #1a3a24;border-radius:10px;background:#07120b;color:#dcf4e4;font:600 .72rem system-ui,sans-serif;margin:0 0 18px}#paper-panel h2{margin:0 0 4px;font:800 .8rem ui-monospace,monospace;color:#52e6ad;letter-spacing:.03em}'
    + '#paper-panel .sim{display:inline-block;margin:0 0 10px;padding:2px 8px;border-radius:5px;background:#5a1d1d;color:#ffb3b3;font:800 .6rem ui-monospace,monospace;letter-spacing:.08em}'
    + '#paper-panel .tabs{display:flex;gap:6px;margin:0 0 10px}#paper-panel .tabs button{padding:5px 10px;border:1px solid #1f4a2e;border-radius:6px;background:#0a1f12;color:#9fd6b4;font:800 .62rem ui-monospace,monospace;cursor:pointer}#paper-panel .tabs button.on{background:#145a2a;color:#fff;border-color:#52e6ad}'
    + '#paper-panel .ticket{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;padding:10px;border:1px solid #1a3a24;border-radius:8px;background:#0a1a10;margin:0 0 12px}#paper-panel .ticket label{display:block;color:#7fb393;font:700 .56rem ui-monospace,monospace;letter-spacing:.05em;margin-bottom:2px}#paper-panel .ticket input,#paper-panel .ticket select{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #1f4a2e;border-radius:5px;background:#07120b;color:#e8fbee;font:700 .68rem ui-monospace,monospace}'
    + '#paper-panel .ticket .seg{display:flex;gap:4px}#paper-panel .ticket .seg button{flex:1;padding:5px 0;border:1px solid #1f4a2e;border-radius:5px;background:#07120b;color:#9fd6b4;font:800 .6rem ui-monospace,monospace;cursor:pointer}#paper-panel .ticket .seg button.on{background:#145a2a;color:#fff;border-color:#52e6ad}#paper-panel .ticket .seg button.sell.on{background:#5a1d1d;border-color:#ff778b}'
    + '#paper-panel button.go{grid-column:1/-1;padding:8px;border:1px solid #52e6ad;border-radius:6px;background:#145a2a;color:#fff;font:800 .7rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#paper-panel button.go.sell{background:#5a1d1d;border-color:#ff778b}#paper-panel .msg{grid-column:1/-1;color:#ffd66b;font-size:.64rem}'
    + '#paper-panel .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;margin:8px 0 12px}#paper-panel .kpi{padding:8px 10px;border:1px solid #1a3a24;border-radius:8px;background:#0a1a10}#paper-panel .kpi span{display:block;color:#7fb393;font:700 .56rem ui-monospace,monospace;letter-spacing:.05em}#paper-panel .kpi b{display:block;font:800 .92rem ui-monospace,monospace;color:#e8fbee;margin-top:2px}#paper-panel .kpi b.up{color:#52e6ad}#paper-panel .kpi b.dn{color:#ff778b}'
    + '#paper-panel table{width:100%;border-collapse:collapse;font:600 .64rem ui-monospace,monospace;margin:0 0 10px}#paper-panel th,#paper-panel td{padding:5px 4px;text-align:right;border-bottom:1px solid rgba(26,58,36,.7)}#paper-panel th{color:#7fb393;font-weight:700}#paper-panel td:first-child,#paper-panel th:first-child{text-align:left}#paper-panel td.up{color:#52e6ad}#paper-panel td.dn{color:#ff778b}#paper-panel td button{padding:2px 7px;border:1px solid #5a1d1d;border-radius:4px;background:#2a0b0b;color:#ffb3b3;font:800 .58rem ui-monospace,monospace;cursor:pointer}'
    + '#paper-panel h3{margin:10px 0 6px;font:800 .66rem ui-monospace,monospace;color:#9fd6b4;letter-spacing:.05em}#paper-panel .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin:0 0 8px}#paper-panel .cal .h{color:#7fb393;font:700 .54rem ui-monospace,monospace;text-align:center}#paper-panel .cal .d{min-height:40px;padding:3px 4px;border:1px solid #1a3a24;border-radius:5px;background:#0a1a10;font:700 .56rem ui-monospace,monospace;color:#9fd6b4;cursor:pointer}#paper-panel .cal .d.up{background:#0f3a20;color:#9ff0b0}#paper-panel .cal .d.dn{background:#3a0f14;color:#ffb3b3}#paper-panel .cal .d.sel{outline:2px solid #52e6ad}#paper-panel .cal .d b{display:block;font-size:.6rem;color:#e8fbee}#paper-panel .cal .d.blank{border-color:transparent;background:transparent;cursor:default}'
    + '#paper-panel .calnav{display:flex;justify-content:space-between;align-items:center;margin:0 0 6px}#paper-panel .calnav button{padding:3px 8px;border:1px solid #1f4a2e;border-radius:5px;background:#0a1f12;color:#9fd6b4;font:800 .6rem ui-monospace,monospace;cursor:pointer}'
    + '#paper-panel .recap{padding:10px;border:1px solid #1a3a24;border-radius:8px;background:#0a1a10;margin:0 0 12px;font-size:.66rem;line-height:1.5}#paper-panel .recap b{color:#52e6ad}#paper-panel .note{margin-top:10px;color:#7fb393;font-size:.62rem;line-height:1.4;font-weight:500}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'paper-toggle'; btn.className = 'paper-toggle'; btn.textContent = 'PAPER TRADE'; btn.title = 'Simulated brokerage account on real prices: stocks and options, any session, P&L calendar'; toolbar.appendChild(btn);
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.data = {}; S.cal = null; S.err = ''; if (S.on) { void load(); paint(); } });
  const auth = () => ({ authorization: 'Bearer ' + S.session, 'content-type': 'application/json' });

  async function load() {
    if (!S.session || S.busy) return;
    S.busy = true; S.err = '';
    try {
      const res = await fetch('/academy-activity/paper?account=' + S.account, { headers: auth(), cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'unavailable');
      S.data[S.account] = payload; S.owner = Boolean(payload.me && payload.me.owner);
      const c = await fetch('/academy-activity/paper/calendar?account=' + S.account + '&month=' + S.month, { headers: auth(), cache: 'no-store' }); S.cal = c.ok ? await c.json() : null;
    } catch (_) { S.err = 'Paper trading is not available right now.'; }
    S.busy = false; paint();
  }
  async function loadChain(sym) {
    if (S.chainSym === sym && S.chain) return;
    S.chainSym = sym; S.chain = null; paint();
    try { const r = await fetch('/academy-activity/paper/chain?symbol=' + encodeURIComponent(sym), { headers: auth(), cache: 'no-store' }); const j = await r.json(); S.chain = r.ok && j.ok ? j : { ok: false, error: j.error || 'unavailable' }; } catch (_) { S.chain = { ok: false, error: 'unavailable' }; }
    if (S.chain.ok && S.chain.expirations.length && !S.chain.expirations.includes(S.ticket.expiry)) S.ticket.expiry = S.chain.expirations[0];
    paint();
  }
  async function submit(order) {
    S.msg = 'Sending…'; paint();
    try {
      const res = await fetch('/academy-activity/paper/order', { method: 'POST', headers: auth(), body: JSON.stringify({ account: S.account, ...order }) });
      const j = await res.json().catch(() => ({}));
      S.msg = j.ok ? 'Filled: ' + j.trade.side.toUpperCase() + ' ' + j.trade.qty + ' ' + j.trade.desc + ' @ ' + usd(j.trade.price) + (j.trade.fee ? ' (fee ' + usd(j.trade.fee) + ')' : '') + (j.realized ? ' · realized ' + usd(j.realized) : '') : (j.message || ('Not filled: ' + (j.error || 'unavailable')));
    } catch (_) { S.msg = 'Not filled: the server did not answer.'; }
    S.data[S.account] = null; await load();
  }
  async function recap(date) {
    S.dayRecap = { date, loading: true }; paint();
    try { const r = await fetch('/academy-activity/paper/day?account=' + S.account + '&date=' + date, { headers: auth(), cache: 'no-store' }); S.dayRecap = r.ok ? await r.json() : { date, error: true }; } catch (_) { S.dayRecap = { date, error: true }; }
    paint();
  }

  function panel() {
    let el = document.getElementById('paper-panel');
    if (!el) {
      el = document.createElement('section'); el.id = 'paper-panel'; el.setAttribute('aria-label', 'Paper trading (simulated)');
      const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
      if (dock && dock.parentElement) dock.parentElement.insertBefore(el, dock); else document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-act]'); if (!t) return;
        const a = t.dataset.act;
        if (a === 'account') { S.account = t.dataset.v; save(); S.cal = null; S.dayRecap = null; if (!S.data[S.account]) void load(); paint(); }
        else if (a === 'kind') { S.ticket.kind = t.dataset.v; if (S.ticket.kind === 'option') void loadChain(S.ticket.symbol || chartSym()); paint(); }
        else if (a === 'side') { S.ticket.side = t.dataset.v; paint(); }
        else if (a === 'right') { S.ticket.right = t.dataset.v; paint(); }
        else if (a === 'go') { const o = { kind: S.ticket.kind, symbol: S.ticket.symbol || chartSym(), side: S.ticket.side, qty: S.ticket.qty, note: S.ticket.note }; if (o.kind === 'option') { o.expiry = S.ticket.expiry; o.strike = S.ticket.strike; o.right = S.ticket.right; } void submit(o); }
        else if (a === 'close') { const p = (S.data[S.account].summary.positions || []).find((x) => x.key === t.dataset.v); if (p && window.confirm('Close ' + p.desc + ' (' + p.qty + ')?')) void submit({ kind: p.kind, symbol: p.symbol, side: p.qty > 0 ? 'sell' : 'buy', qty: Math.abs(p.qty), expiry: p.expiry, strike: p.strike, right: p.right, note: 'close' }); }
        else if (a === 'month') { const [y, m] = S.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(t.dataset.v), 1)); S.month = d.toISOString().slice(0, 7); S.cal = null; S.dayRecap = null; void load(); }
        else if (a === 'day') void recap(t.dataset.v);
        else if (a === 'reset') { if (window.confirm('Reset this paper account to $1,000 and wipe its history?')) { fetch('/academy-activity/paper/reset', { method: 'POST', headers: auth(), body: JSON.stringify({ account: S.account }) }).then(() => { S.data[S.account] = null; void load(); }); } }
      });
      el.addEventListener('input', (e) => { const f = e.target.dataset && e.target.dataset.field; if (!f) return; S.ticket[f] = e.target.value; if (f === 'symbol' && S.ticket.kind === 'option') { clearTimeout(S.chainT); S.chainT = setTimeout(() => loadChain(String(S.ticket.symbol || chartSym()).toUpperCase()), 500); } });
      el.addEventListener('change', (e) => { const f = e.target.dataset && e.target.dataset.field; if (f) { S.ticket[f] = e.target.value; paint(); } });
    }
    return el;
  }
  const kpi = (label, value, cls) => '<div class="kpi"><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>';
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
  function ticketHtml(canTrade) {
    const t = S.ticket, sym = t.symbol || chartSym();
    let opt = '';
    if (t.kind === 'option') {
      const c = S.chain;
      if (!c) opt = '<div class="msg">Loading the chain for ' + esc(sym) + '…</div>';
      else if (!c.ok) opt = '<div class="msg">No options chain for ' + esc(sym) + ' (' + esc(c.error) + ').</div>';
      else {
        const strikes = (c.rows || []).filter((r) => r.expiry === t.expiry).map((r) => r.strike);
        if (strikes.length && !strikes.includes(Number(t.strike))) { const spot = num(c.spot) || strikes[Math.floor(strikes.length / 2)]; t.strike = String(strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a))); }
        const row = (c.rows || []).find((r) => r.expiry === t.expiry && r.strike === Number(t.strike)), leg = row ? (t.right === 'P' ? row.put : row.call) : null;
        opt = '<div><label>EXPIRY</label><select data-field="expiry">' + c.expirations.map((x) => '<option' + (x === t.expiry ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>'
          + '<div><label>STRIKE</label><select data-field="strike">' + strikes.map((x) => '<option' + (x === Number(t.strike) ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>'
          + '<div><label>RIGHT</label><div class="seg"><button type="button" data-act="right" data-v="C" class="' + (t.right === 'C' ? 'on' : '') + '">CALL</button><button type="button" data-act="right" data-v="P" class="' + (t.right === 'P' ? 'on' : '') + '">PUT</button></div></div>'
          + '<div><label>QUOTE</label><div style="padding:5px 0;font:700 .68rem ui-monospace,monospace">' + (leg ? usd(leg.bid) + ' × ' + usd(leg.ask) + (leg.oi ? ' · OI ' + leg.oi : '') : '—') + '</div></div>';
      }
    }
    return '<div class="ticket"><div><label>SYMBOL</label><input data-field="symbol" value="' + esc(sym) + '" maxlength="10"></div>'
      + '<div><label>TYPE</label><div class="seg"><button type="button" data-act="kind" data-v="stock" class="' + (t.kind === 'stock' ? 'on' : '') + '">STOCK</button><button type="button" data-act="kind" data-v="option" class="' + (t.kind === 'option' ? 'on' : '') + '">OPTION</button></div></div>'
      + '<div><label>SIDE</label><div class="seg"><button type="button" data-act="side" data-v="buy" class="' + (t.side === 'buy' ? 'on' : '') + '">BUY</button><button type="button" data-act="side" data-v="sell" class="sell ' + (t.side === 'sell' ? 'on' : '') + '">SELL</button></div></div>'
      + '<div><label>' + (t.kind === 'option' ? 'CONTRACTS' : 'SHARES') + '</label><input data-field="qty" value="' + esc(t.qty) + '" inputmode="decimal"></div>'
      + opt + '<div><label>NOTE</label><input data-field="note" value="' + esc(t.note) + '" maxlength="120" placeholder="why this trade"></div>'
      + (canTrade ? '<button type="button" class="go ' + (t.side === 'sell' ? 'sell' : '') + '" data-act="go">PAPER TRADE · ' + t.side.toUpperCase() + ' ' + esc(sym) + '</button>' : '<div class="msg">Only the owner trades the challenge account. Switch to MINE to trade your own.</div>')
      + (S.msg ? '<div class="msg">' + esc(S.msg) + '</div>' : '') + '</div>';
  }
  function calendarHtml() {
    const c = S.cal; if (!c) return '<p class="note">Loading the calendar…</p>';
    const [y, m] = c.month.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), start = first.getUTCDay();
    const byDate = Object.fromEntries((c.days || []).map((d) => [d.date, d]));
    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((h) => '<div class="h">' + h + '</div>').join('');
    for (let i = 0; i < start; i++) cells += '<div class="d blank"></div>';
    for (let d = 1; d <= days; d++) { const date = c.month + '-' + String(d).padStart(2, '0'), x = byDate[date], v = x ? (x.change != null ? x.change : x.realized) : null; cells += '<div class="d ' + (v != null ? cls(v) : '') + (S.dayRecap && S.dayRecap.date === date ? ' sel' : '') + '" data-act="day" data-v="' + date + '">' + d + (x ? '<b>' + (v >= 0 ? '+' : '') + usd(v, 0) + '</b>' + (x.trades ? '<span>' + x.trades + ' fill' + (x.trades > 1 ? 's' : '') + '</span>' : '') : '') + '</div>'; }
    return '<div class="calnav"><button type="button" data-act="month" data-v="-1">◀</button><b>' + first.toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' · ' + (c.total >= 0 ? '+' : '') + usd(c.total) + ' · ' + c.green + ' green / ' + c.red + ' red</b><button type="button" data-act="month" data-v="1">▶</button></div><div class="cal">' + cells + '</div>';
  }
  function recapHtml() {
    const r = S.dayRecap; if (!r) return '<p class="note">Click a day for its recap.</p>';
    if (r.loading) return '<div class="recap">Loading ' + esc(r.date) + '…</div>';
    if (r.error) return '<div class="recap">No recap for ' + esc(r.date) + '.</div>';
    const mk = r.market, a = r.account;
    return '<div class="recap"><b>' + esc(r.date) + '</b>' + (mk && mk.ok ? '<div>Market: SPY ' + pct(mk.spyChangePct) + (mk.label ? ', read ' + esc(mk.label) : '') + (mk.vix != null ? ', VIX ' + mk.vix : '') + (mk.note ? '. ' + esc(mk.note) : '') + '</div>' : '<div>Market: no read stored for this day.</div>')
      + '<div>Account: ' + (a.change != null ? (a.change >= 0 ? 'up ' : 'down ') + usd(Math.abs(a.change)) + ' on the day' : 'no change recorded') + ', ' + usd(a.realized) + ' realized, ' + a.trades.length + ' fill' + (a.trades.length === 1 ? '' : 's') + (a.symbols.length ? ' in ' + a.symbols.join(', ') : '') + '.</div>'
      + (a.trades.length ? '<div>' + a.trades.map((t) => when(t.t) + ' ' + t.side.toUpperCase() + ' ' + t.qty + ' ' + esc(t.desc) + ' @ ' + usd(t.price) + (t.realized ? ' (' + usd(t.realized) + ')' : '')).join('<br>') + '</div>' : '')
      + '<div>' + (r.insight || []).map(esc).join(' ') + '</div></div>';
  }
  function paint() {
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    const title = document.querySelector('.below-title');
    const others = ['earnings-panel', 'catalysts-panel', 'challenge-panel'];
    if (!S.on) { const el = document.getElementById('paper-panel'); if (el) el.style.display = 'none'; if (dock && !others.some((id) => { const x = document.getElementById(id); return x && x.style.display !== 'none'; })) dock.style.display = ''; if (title && S.prevTitle) { title.textContent = S.prevTitle; S.prevTitle = ''; } clearInterval(S.timer); S.timer = 0; return; }
    if (dock) dock.style.display = 'none';
    others.forEach((id) => { const x = document.getElementById(id); if (x) x.style.display = 'none'; });
    if (title && !S.prevTitle) { S.prevTitle = title.textContent; title.textContent = 'PAPER TRADE · SIMULATED'; }
    if (!S.timer) S.timer = setInterval(() => { if (S.on && !document.hidden && !S.busy) { S.data[S.account] = null; void load(); } }, 60_000);
    const el = panel(); el.style.display = '';
    const tabs = '<div class="tabs"><button type="button" data-act="account" data-v="me" class="' + (S.account === 'me' ? 'on' : '') + '">MINE</button><button type="button" data-act="account" data-v="challenge" class="' + (S.account === 'challenge' ? 'on' : '') + '">CHALLENGE</button></div>';
    if (!S.session) { el.innerHTML = '<h2>PAPER TRADE</h2>' + tabs + '<p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; return; }
    if (!S.data[S.account] && !S.err && !S.busy) void load();
    const d = S.data[S.account];
    if (S.err && !d) { el.innerHTML = '<h2>PAPER TRADE</h2>' + tabs + '<p class="note">' + esc(S.err) + '</p>'; return; }
    if (!d) { el.innerHTML = '<h2>PAPER TRADE</h2>' + tabs + '<p class="note">Loading…</p>'; return; }
    const s = d.summary, canTrade = S.account === 'me' || S.owner;
    el.innerHTML = '<h2>PAPER TRADE · ' + esc(d.name) + '</h2><span class="sim">SIMULATED · NOT REAL MONEY · NOT ADVICE</span>' + tabs + ticketHtml(canTrade)
      + '<div class="kpis">' + kpi('ACCOUNT', usd(s.equity)) + kpi('CASH', usd(s.cash)) + kpi('TODAY', s.today && s.today.change != null ? usd(s.today.change) : usd(s.today ? s.today.realized : 0), cls(s.today ? (s.today.change != null ? s.today.change : s.today.realized) : 0)) + kpi('OPEN P&L', usd(s.unrealized), cls(s.unrealized)) + kpi('REALIZED', usd(s.realizedTotal), cls(s.realizedTotal)) + kpi('RETURN', pct(s.returnPct), cls(s.returnPct)) + kpi('WIN RATE', s.winRate == null ? '—' : s.winRate + '% of ' + s.closedTrades) + kpi('MAX DD', s.maxDrawdownPct + '%') + kpi('SESSION', esc(d.session)) + '</div>'
      + '<h3>POSITIONS</h3>' + (s.positions.length ? '<table><thead><tr><th>Contract</th><th>Qty</th><th>Avg</th><th>Mark</th><th>Value</th><th>P&amp;L</th><th></th></tr></thead><tbody>' + s.positions.map((p) => '<tr><td>' + esc(p.desc) + '</td><td>' + p.qty + '</td><td>' + usd(p.avg) + '</td><td>' + usd(p.mark) + '</td><td>' + usd(p.value) + '</td><td class="' + cls(p.pnl) + '">' + usd(p.pnl) + (p.pnlPct != null ? ' (' + pct(p.pnlPct) + ')' : '') + '</td><td>' + (canTrade ? '<button type="button" data-act="close" data-v="' + esc(p.key) + '">Close</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="note">Flat.</p>')
      + '<h3>P&amp;L CALENDAR</h3>' + calendarHtml() + recapHtml()
      + '<h3>TRADES</h3>' + (d.trades.length ? '<table><thead><tr><th>When</th><th>Side</th><th>Qty</th><th>Contract</th><th>Price</th><th>Session</th><th>Realized</th><th>Note</th></tr></thead><tbody>' + d.trades.map((t) => '<tr><td>' + when(t.t) + '</td><td>' + t.side.toUpperCase() + '</td><td>' + t.qty + '</td><td>' + esc(t.desc) + '</td><td>' + usd(t.price) + '</td><td>' + esc(t.session) + '</td><td class="' + cls(t.realized) + '">' + (t.realized ? usd(t.realized) : '—') + '</td><td>' + esc(t.note || '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="note">No trades yet.</p>')
      + (canTrade && S.account === 'me' ? '<button type="button" class="paper-toggle" data-act="reset">Reset my paper account</button>' : '')
      + '<p class="note">' + esc(d.disclaimer) + ' Buys fill at the ask and sells at the bid when a quote exists, else the last price with 5 bps slippage; options cost $0.65 a contract and settle at intrinsic value on expiry. Pre- and after-market fills need a price in that session.</p>';
  }
  const sync = () => btn.classList.toggle('on', S.on);
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.ticket.symbol = chartSym(); S.msg = ''; S.data = {}; if (S.session) void load(); } paint(); });
  window.addEventListener('sml-live-data', () => { if (S.on && !S.ticket.symbol) paint(); });
  sync();
  (function boot(tries) { if (S.on && !document.getElementById('options-dock') && !document.getElementById('options-chain') && tries < 60) { setTimeout(() => boot(tries + 1), 200); return; } paint(); })(0);
})();
