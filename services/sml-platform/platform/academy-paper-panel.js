/* PAPER TRADE for the Academy Live Chart Lab: a SIMULATED brokerage account on real prices, shown as a portfolio profile.
 * The panel is the account's profile (name, value, today, all-time) with switchable focuses, each one a visual read of the
 * same data: OVERVIEW (equity curve + key numbers), ALLOCATION (where the money sits, as a donut), PERFORMANCE (daily P&L
 * bars, win/loss, the stats that matter), CALENDAR (P&L calendar whose days open a recap), ACTIVITY (fills and the log) and
 * TRADE (the ticket: stock or option, buy or sell, any session a price exists in). Accounts: MINE (every member) and the
 * owner's CHALLENGE account (owner only). Routes under /academy-activity/paper. Not real money. */
(() => {
  if (window.__smlPaper) return;
  window.__smlPaper = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const usd = (v, d = 2) => (num(v) == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  const dateOf = (t) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const chartSym = () => { try { return String(window.smlAcademyChartState().symbol || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); } catch (_) { return String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); } };
  const KEY = 'sml-paper-v2';
  const FOCUS = [['overview', 'OVERVIEW'], ['allocation', 'ALLOCATION'], ['performance', 'PERFORMANCE'], ['calendar', 'CALENDAR'], ['activity', 'ACTIVITY'], ['trade', 'TRADE']];
  const PALETTE = ['#52e6ad', '#6be6ff', '#ffd66b', '#ff9f43', '#c46bff', '#ff778b', '#9aa7b8', '#7fd6f0', '#9ff0b0', '#ffb3b3'];
  const S = { on: false, account: 'me', focus: 'overview', session: String(window.smlAcademySessionToken || ''), data: {}, err: '', busy: false, prevTitle: '', owner: false, timer: 0, ticket: { kind: 'stock', side: 'buy', qty: '1', symbol: '', expiry: '', strike: '', right: 'C', note: '' }, chain: null, chainSym: '', month: new Date().toISOString().slice(0, 7), cal: null, dayRecap: null, msg: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.on = v.on === true; if (v.account === 'challenge') S.account = 'challenge'; if (FOCUS.some(([k]) => k === v.focus)) S.focus = v.focus; } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, account: S.account, focus: S.focus })); } catch (_) { /* ignore */ } };
  const toolbar = document.querySelector('.toolbar'); if (!toolbar) return;

  const style = document.createElement('style');
  style.textContent = '.paper-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2a4a2a;border-radius:7px;background:#061a0a;color:#9ff0b0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.paper-toggle.on{background:#145a2a;border-color:#52e6ad;color:#fff}'
    + '#paper-panel{padding:14px;border:1px solid #1a3a24;border-radius:12px;background:radial-gradient(1200px 400px at 10% -10%,#0d2a18 0,#07120b 55%);color:#dcf4e4;font:600 .72rem system-ui,sans-serif;margin:0 0 18px}#paper-panel h2{margin:0;font:800 .95rem ui-monospace,monospace;color:#e8fbee;letter-spacing:.03em}'
    + '#paper-panel .sim{display:inline-block;padding:2px 8px;border-radius:5px;background:#5a1d1d;color:#ffb3b3;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em}'
    /* profile header */
    + '#paper-panel .pf{display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;padding:12px 14px;border:1px solid #1f4a2e;border-radius:12px;background:linear-gradient(135deg,rgba(20,90,42,.35),rgba(7,18,11,.2));margin:0 0 10px}'
    + '#paper-panel .av{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(from 200deg,#52e6ad,#6be6ff,#145a2a,#52e6ad);color:#04110c;font:900 1rem ui-monospace,monospace;box-shadow:0 0 24px rgba(82,230,173,.35)}'
    + '#paper-panel .who .sub{color:#7fb393;font:700 .58rem ui-monospace,monospace;letter-spacing:.05em;margin-top:3px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}'
    + '#paper-panel .acct{display:inline-flex;gap:4px}#paper-panel .acct button{padding:3px 8px;border:1px solid #1f4a2e;border-radius:5px;background:#0a1f12;color:#9fd6b4;font:800 .56rem ui-monospace,monospace;cursor:pointer}#paper-panel .acct button.on{background:#145a2a;color:#fff;border-color:#52e6ad}'
    + '#paper-panel .eq{text-align:right}#paper-panel .eq span{display:block;color:#7fb393;font:700 .56rem ui-monospace,monospace;letter-spacing:.06em}#paper-panel .eq b{display:block;font:900 1.5rem/1.1 ui-monospace,monospace;color:#e8fbee;text-shadow:0 0 18px rgba(82,230,173,.25)}#paper-panel .eq i{display:block;font:800 .62rem ui-monospace,monospace;font-style:normal;margin-top:2px}'
    + '#paper-panel .up{color:#52e6ad}#paper-panel .dn{color:#ff778b}#paper-panel .ring{width:74px;height:74px}'
    /* focus switch */
    + '#paper-panel .focus{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 12px}#paper-panel .focus button{padding:6px 11px;border:1px solid #1f4a2e;border-radius:999px;background:#0a1f12;color:#9fd6b4;font:800 .6rem ui-monospace,monospace;letter-spacing:.05em;cursor:pointer}#paper-panel .focus button.on{background:linear-gradient(135deg,#145a2a,#1b7a3a);color:#fff;border-color:#52e6ad;box-shadow:0 0 14px rgba(82,230,173,.25)}'
    /* tiles + charts */
    + '#paper-panel .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:0 0 12px}#paper-panel .kpi{padding:9px 11px;border:1px solid #1a3a24;border-radius:10px;background:rgba(10,26,16,.85)}#paper-panel .kpi span{display:block;color:#7fb393;font:700 .54rem ui-monospace,monospace;letter-spacing:.06em}#paper-panel .kpi b{display:block;font:800 .95rem ui-monospace,monospace;color:#e8fbee;margin-top:3px}#paper-panel .kpi b.up{color:#52e6ad}#paper-panel .kpi b.dn{color:#ff778b}#paper-panel .kpi small{display:block;color:#7fb393;font:600 .54rem ui-monospace,monospace;margin-top:2px}'
    + '#paper-panel .viz{position:relative;border:1px solid #1a3a24;border-radius:12px;background:linear-gradient(180deg,#0a1a10,#07120b);padding:10px;margin:0 0 12px}#paper-panel .viz h3{margin:0 0 6px}#paper-panel .viz canvas{width:100%;display:block}#paper-panel .viz .lg{position:absolute;top:10px;right:12px;color:#7fb393;font:700 .54rem ui-monospace,monospace;text-align:right;line-height:1.5}'
    + '#paper-panel .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:820px){#paper-panel .two{grid-template-columns:1fr}#paper-panel .pf{grid-template-columns:auto 1fr;}#paper-panel .eq{text-align:left;grid-column:2}#paper-panel .ring{grid-column:1}}'
    + '#paper-panel .legend{display:grid;gap:5px;margin-top:8px}#paper-panel .legend div{display:grid;grid-template-columns:12px 1fr auto auto;gap:8px;align-items:center;font:700 .62rem ui-monospace,monospace;color:#cfe9d8}#paper-panel .legend i{width:12px;height:12px;border-radius:3px;display:block}#paper-panel .legend .bar{grid-column:2/5;height:5px;border-radius:3px;background:#0e2a18;overflow:hidden}#paper-panel .legend .bar b{display:block;height:100%}'
    + '#paper-panel h3{margin:10px 0 6px;font:800 .64rem ui-monospace,monospace;color:#9fd6b4;letter-spacing:.06em}'
    /* ticket */
    + '#paper-panel .ticket{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;padding:10px;border:1px solid #1a3a24;border-radius:10px;background:#0a1a10;margin:0 0 12px}#paper-panel .ticket label{display:block;color:#7fb393;font:700 .56rem ui-monospace,monospace;letter-spacing:.05em;margin-bottom:2px}#paper-panel .ticket input,#paper-panel .ticket select{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #1f4a2e;border-radius:5px;background:#07120b;color:#e8fbee;font:700 .68rem ui-monospace,monospace}'
    + '#paper-panel .ticket .seg{display:flex;gap:4px}#paper-panel .ticket .seg button{flex:1;padding:5px 0;border:1px solid #1f4a2e;border-radius:5px;background:#07120b;color:#9fd6b4;font:800 .6rem ui-monospace,monospace;cursor:pointer}#paper-panel .ticket .seg button.on{background:#145a2a;color:#fff;border-color:#52e6ad}#paper-panel .ticket .seg button.sell.on{background:#5a1d1d;border-color:#ff778b}'
    + '#paper-panel button.go{grid-column:1/-1;padding:9px;border:1px solid #52e6ad;border-radius:7px;background:linear-gradient(135deg,#145a2a,#1b7a3a);color:#fff;font:800 .72rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#paper-panel button.go.sell{background:linear-gradient(135deg,#5a1d1d,#7a2a2a);border-color:#ff778b}#paper-panel .msg{grid-column:1/-1;color:#ffd66b;font-size:.64rem}'
    /* tables, calendar, recap */
    + '#paper-panel table{width:100%;border-collapse:collapse;font:600 .64rem ui-monospace,monospace;margin:0 0 10px}#paper-panel th,#paper-panel td{padding:5px 4px;text-align:right;border-bottom:1px solid rgba(26,58,36,.7)}#paper-panel th{color:#7fb393;font-weight:700}#paper-panel td:first-child,#paper-panel th:first-child{text-align:left}#paper-panel td.up{color:#52e6ad}#paper-panel td.dn{color:#ff778b}#paper-panel td button{padding:2px 7px;border:1px solid #5a1d1d;border-radius:4px;background:#2a0b0b;color:#ffb3b3;font:800 .58rem ui-monospace,monospace;cursor:pointer}'
    + '#paper-panel .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin:0 0 8px}#paper-panel .cal .h{color:#7fb393;font:700 .54rem ui-monospace,monospace;text-align:center}#paper-panel .cal .d{min-height:42px;padding:3px 4px;border:1px solid #1a3a24;border-radius:6px;background:#0a1a10;font:700 .56rem ui-monospace,monospace;color:#9fd6b4;cursor:pointer}#paper-panel .cal .d.up{background:linear-gradient(180deg,#0f3a20,#0b2a18);color:#9ff0b0}#paper-panel .cal .d.dn{background:linear-gradient(180deg,#3a0f14,#2a0b10);color:#ffb3b3}#paper-panel .cal .d.sel{outline:2px solid #52e6ad}#paper-panel .cal .d b{display:block;font-size:.6rem;color:#e8fbee}#paper-panel .cal .d.blank{border-color:transparent;background:transparent;cursor:default}'
    + '#paper-panel .calnav{display:flex;justify-content:space-between;align-items:center;margin:0 0 6px}#paper-panel .calnav button{padding:3px 8px;border:1px solid #1f4a2e;border-radius:5px;background:#0a1f12;color:#9fd6b4;font:800 .6rem ui-monospace,monospace;cursor:pointer}'
    + '#paper-panel .recap{padding:10px;border:1px solid #1a3a24;border-radius:10px;background:#0a1a10;margin:0 0 12px;font-size:.66rem;line-height:1.5}#paper-panel .recap b{color:#52e6ad}#paper-panel .note{margin-top:10px;color:#7fb393;font-size:.62rem;line-height:1.4;font-weight:500}#paper-panel .log div{color:#b9d3dd;font-size:.63rem;padding:3px 0;border-bottom:1px solid rgba(26,58,36,.5)}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'paper-toggle'; btn.className = 'paper-toggle'; btn.textContent = 'PAPER TRADE'; btn.title = 'Simulated brokerage account on real prices: your portfolio profile, with visual focuses, a P&L calendar and a trade ticket'; toolbar.appendChild(btn);
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.data = {}; S.cal = null; S.err = ''; if (S.on) { void load(); paint(); } });
  const auth = () => ({ authorization: 'Bearer ' + S.session, 'content-type': 'application/json' });

  async function load() {
    if (!S.session || S.busy) return;
    S.busy = true; S.err = '';
    try {
      const res = await fetch('/academy-activity/paper?account=' + S.account, { headers: auth(), cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (res.status === 403 && S.account === 'challenge') { S.account = 'me'; S.owner = false; save(); S.busy = false; return load(); }
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
        else if (a === 'focus') { S.focus = t.dataset.v; save(); if (S.focus === 'trade' && S.ticket.kind === 'option') void loadChain(S.ticket.symbol || chartSym()); paint(); }
        else if (a === 'kind') { S.ticket.kind = t.dataset.v; if (S.ticket.kind === 'option') void loadChain(S.ticket.symbol || chartSym()); paint(); }
        else if (a === 'side') { S.ticket.side = t.dataset.v; paint(); }
        else if (a === 'right') { S.ticket.right = t.dataset.v; paint(); }
        else if (a === 'go') { const o = { kind: S.ticket.kind, symbol: S.ticket.symbol || chartSym(), side: S.ticket.side, qty: S.ticket.qty, note: S.ticket.note }; if (o.kind === 'option') { o.expiry = S.ticket.expiry; o.strike = S.ticket.strike; o.right = S.ticket.right; } void submit(o); }
        else if (a === 'close') { const p = (S.data[S.account].summary.positions || []).find((x) => x.key === t.dataset.v); if (p && window.confirm('Close ' + p.desc + ' (' + p.qty + ')?')) void submit({ kind: p.kind, symbol: p.symbol, side: p.qty > 0 ? 'sell' : 'buy', qty: Math.abs(p.qty), expiry: p.expiry, strike: p.strike, right: p.right, note: 'close' }); }
        else if (a === 'month') { const [y, m] = S.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(t.dataset.v), 1)); S.month = d.toISOString().slice(0, 7); S.cal = null; S.dayRecap = null; void load(); }
        else if (a === 'day') void recap(t.dataset.v);
        else if (a === 'reset') { if (window.confirm('Reset this paper account to ' + (S.account === 'challenge' ? '$1,000' : '$25,000') + ' and wipe its history?')) { fetch('/academy-activity/paper/reset', { method: 'POST', headers: auth(), body: JSON.stringify({ account: S.account }) }).then(() => { S.data[S.account] = null; void load(); }); } }
      });
      el.addEventListener('input', (e) => { const f = e.target.dataset && e.target.dataset.field; if (!f) return; S.ticket[f] = e.target.value; if (f === 'symbol' && S.ticket.kind === 'option') { clearTimeout(S.chainT); S.chainT = setTimeout(() => loadChain(String(S.ticket.symbol || chartSym()).toUpperCase()), 500); } });
      el.addEventListener('change', (e) => { const f = e.target.dataset && e.target.dataset.field; if (f) { S.ticket[f] = e.target.value; paint(); } });
    }
    return el;
  }
  const kpi = (label, value, c, small) => '<div class="kpi"><span>' + label + '</span><b class="' + (c || '') + '">' + value + '</b>' + (small ? '<small>' + small + '</small>' : '') + '</div>';
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');

  /* ---------- canvases: equity curve, donut, daily bars (no libraries) ---------- */
  function setup(canvas, h) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = h + 'px';
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    return { c, w, h };
  }
  function drawCurve(canvas, points, deposits) {
    const { c, w, h } = setup(canvas, 170);
    if (!points || points.length < 2) { c.fillStyle = '#7fb393'; c.font = '700 11px ui-monospace,monospace'; c.fillText('The curve starts with the first trade.', 12, 24); return; }
    const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1, vals = points.map((p) => p.value);
    const lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
    const x = (t) => 10 + (w - 20) * ((t - t0) / Math.max(1, t1 - t0)), y = (v) => h - 12 - (h - 24) * ((v - lo) / Math.max(1e-9, hi - lo));
    for (let i = 1; i < 4; i++) { c.strokeStyle = 'rgba(26,58,36,.6)'; c.beginPath(); c.moveTo(10, 12 + (h - 24) * i / 4); c.lineTo(w - 10, 12 + (h - 24) * i / 4); c.stroke(); }
    let dep = 0; const steps = (deposits || []).slice().sort((a, b) => a.t - b.t);
    c.strokeStyle = '#2f5566'; c.setLineDash([3, 3]); c.beginPath(); let started = false;
    for (const p of points) { while (steps.length && steps[0].t <= p.t) dep += steps.shift().amount; const yy = y(Math.max(lo, Math.min(hi, dep))); if (!started) { c.moveTo(x(p.t), yy); started = true; } else c.lineTo(x(p.t), yy); }
    c.stroke(); c.setLineDash([]);
    const last = vals[vals.length - 1], up = last >= vals[0], col = up ? '#52e6ad' : '#ff778b';
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, up ? 'rgba(82,230,173,.35)' : 'rgba(255,119,139,.35)'); g.addColorStop(1, 'rgba(7,18,11,0)');
    c.beginPath(); points.forEach((p, i) => { if (i) c.lineTo(x(p.t), y(p.value)); else c.moveTo(x(p.t), y(p.value)); }); c.lineTo(x(t1), h - 12); c.lineTo(x(t0), h - 12); c.closePath(); c.fillStyle = g; c.fill();
    c.strokeStyle = col; c.lineWidth = 2; c.shadowColor = col; c.shadowBlur = 8; c.beginPath(); points.forEach((p, i) => { if (i) c.lineTo(x(p.t), y(p.value)); else c.moveTo(x(p.t), y(p.value)); }); c.stroke(); c.shadowBlur = 0;
    c.fillStyle = col; c.beginPath(); c.arc(x(t1), y(last), 3.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9fd6b4'; c.font = '700 10px ui-monospace,monospace'; c.fillText(usd(hi, 0), 12, 11); c.fillText(usd(lo, 0), 12, h - 2);
  }
  function drawDonut(canvas, slices, title, sub) {
    const { c, w, h } = setup(canvas, 190);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8, r = R * 0.64;
    const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
    if (!(total > 0)) { c.fillStyle = '#7fb393'; c.font = '700 11px ui-monospace,monospace'; c.textAlign = 'center'; c.fillText('Nothing to show yet.', cx, cy); return; }
    let a = -Math.PI / 2;
    slices.forEach((s) => { const v = Math.max(0, s.value); if (!v) return; const b = a + (v / total) * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a, b); c.closePath(); c.fillStyle = s.color; c.shadowColor = s.color; c.shadowBlur = 6; c.fill(); c.shadowBlur = 0; a = b; });
    c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#e8fbee'; c.textAlign = 'center'; c.font = '900 15px ui-monospace,monospace'; c.fillText(title, cx, cy + 1);
    c.fillStyle = '#7fb393'; c.font = '700 9px ui-monospace,monospace'; c.fillText(sub, cx, cy + 15);
  }
  function drawBars(canvas, days) {
    const { c, w, h } = setup(canvas, 150);
    const vals = days.map((d) => (d.change != null ? d.change : d.realized) || 0);
    if (!days.length) { c.fillStyle = '#7fb393'; c.font = '700 11px ui-monospace,monospace'; c.fillText('No closed day in this month yet.', 12, 24); return; }
    const m = Math.max(1e-9, ...vals.map(Math.abs)), mid = h / 2, bw = Math.max(3, (w - 20) / days.length - 3);
    c.strokeStyle = 'rgba(26,58,36,.9)'; c.beginPath(); c.moveTo(10, mid); c.lineTo(w - 10, mid); c.stroke();
    days.forEach((d, i) => { const v = vals[i], x = 10 + i * ((w - 20) / days.length), bh = (mid - 14) * Math.abs(v) / m; c.fillStyle = v >= 0 ? '#52e6ad' : '#ff778b'; c.shadowColor = c.fillStyle; c.shadowBlur = 6; c.fillRect(x, v >= 0 ? mid - bh : mid, bw, Math.max(1, bh)); c.shadowBlur = 0; });
    c.fillStyle = '#9fd6b4'; c.font = '700 9px ui-monospace,monospace'; c.fillText('+' + usd(m, 0), 12, 11); c.fillText('-' + usd(m, 0), 12, h - 3);
    c.textAlign = 'right'; c.fillText(days[0].date.slice(5) + ' → ' + days[days.length - 1].date.slice(5), w - 12, 11);
  }
  function ring(valuePct, label, color) {
    const v = Math.max(0, Math.min(100, Number(valuePct) || 0)), r = 30, cN = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 74 74" aria-label="' + esc(label) + '"><circle cx="37" cy="37" r="' + r + '" fill="none" stroke="#0e2a18" stroke-width="7"/><circle cx="37" cy="37" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (cN * v / 100).toFixed(1) + ' ' + cN.toFixed(1) + '" transform="rotate(-90 37 37)" style="filter:drop-shadow(0 0 4px ' + color + ')"/><text x="37" y="35" text-anchor="middle" fill="#e8fbee" font-family="ui-monospace,monospace" font-size="12" font-weight="900">' + Math.round(v) + '%</text><text x="37" y="47" text-anchor="middle" fill="#7fb393" font-family="ui-monospace,monospace" font-size="6.5" font-weight="700">' + esc(label) + '</text></svg>';
  }

  /* ---------- stats from the fills ---------- */
  function stats(d) {
    const closes = (d.trades || []).filter((t) => t.realized != null && t.realized !== 0 && !t.opening);
    const wins = closes.filter((t) => t.realized > 0), losses = closes.filter((t) => t.realized < 0);
    const sum = (a) => a.reduce((s, t) => s + t.realized, 0);
    const gw = sum(wins), gl = Math.abs(sum(losses));
    const avgW = wins.length ? gw / wins.length : 0, avgL = losses.length ? gl / losses.length : 0;
    const n = closes.length, winRate = n ? wins.length / n * 100 : null;
    return { n, wins: wins.length, losses: losses.length, winRate, avgW, avgL, profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), expectancy: n ? (gw - gl) / n : null, largestW: wins.length ? Math.max(...wins.map((t) => t.realized)) : 0, largestL: losses.length ? Math.min(...losses.map((t) => t.realized)) : 0, fees: (d.trades || []).reduce((s, t) => s + (t.fee || 0), 0) };
  }

  /* ---------- focus bodies ---------- */
  function overviewHtml(d) {
    const s = d.summary, st = stats(d);
    return '<div class="kpis">' + kpi('CASH', usd(s.cash), '', 'buying power') + kpi('OPEN P&amp;L', usd(s.unrealized), cls(s.unrealized), s.positions.length + ' open') + kpi('REALIZED', usd(s.realizedTotal), cls(s.realizedTotal), st.n + ' closed') + kpi('PUT IN', usd(s.deposited, 0), '', 'start + deposits') + kpi('WIN RATE', st.winRate == null ? '—' : Math.round(st.winRate) + '%', '', st.wins + 'W / ' + st.losses + 'L') + kpi('MAX DRAWDOWN', s.maxDrawdownPct + '%', s.maxDrawdownPct >= 10 ? 'dn' : '') + kpi('FEES', usd(st.fees), '', 'options $0.65 / contract') + kpi('SESSION', esc(d.session).toUpperCase(), '', 'as of ' + when(d.asOf)) + '</div>'
      + '<div class="viz"><h3>ACCOUNT VALUE OVER TIME</h3><span class="lg">— value<br>┄ money put in</span><canvas id="paper-curve"></canvas></div>';
  }
  function allocationHtml(d, canTrade) {
    const s = d.summary;
    const slices = s.positions.map((p, i) => ({ label: p.desc, value: Math.abs(p.value), color: PALETTE[i % PALETTE.length], pnl: p.pnl, pnlPct: p.pnlPct, kind: p.kind, qty: p.qty }));
    slices.push({ label: 'Cash', value: Math.max(0, s.cash), color: '#1f4a2e', pnl: null });
    const total = slices.reduce((a, x) => a + x.value, 0) || 1;
    const stocks = s.positions.filter((p) => p.kind !== 'option').reduce((a, p) => a + Math.abs(p.value), 0), opts = s.positions.filter((p) => p.kind === 'option').reduce((a, p) => a + Math.abs(p.value), 0);
    const longs = s.positions.filter((p) => p.qty > 0).length, shorts = s.positions.filter((p) => p.qty < 0).length;
    return '<div class="two"><div class="viz"><h3>WHERE THE MONEY SITS</h3><canvas id="paper-donut"></canvas><div class="legend">' + slices.map((x) => '<div><i style="background:' + x.color + '"></i><span>' + esc(x.label) + '</span><span>' + Math.round(x.value / total * 100) + '%</span><span class="' + (x.pnl == null ? '' : cls(x.pnl)) + '">' + (x.pnl == null ? usd(x.value) : usd(x.pnl) + (x.pnlPct != null ? ' (' + pct(x.pnlPct) + ')' : '')) + '</span><div class="bar"><b style="width:' + Math.max(1, Math.round(x.value / total * 100)) + '%;background:' + x.color + '"></b></div></div>').join('') + '</div></div>'
      + '<div><div class="kpis"><div class="kpi"><span>INVESTED</span><b>' + Math.round((total - Math.max(0, s.cash)) / total * 100) + '%</b><small>' + usd(total - Math.max(0, s.cash)) + ' of ' + usd(total) + '</small></div>' + kpi('STOCKS vs OPTIONS', (stocks + opts > 0 ? Math.round(stocks / (stocks + opts) * 100) + '% / ' + Math.round(opts / (stocks + opts) * 100) + '%' : '—'), '', usd(stocks) + ' / ' + usd(opts)) + kpi('LONG / SHORT', longs + ' / ' + shorts, '', 'positions') + kpi('LARGEST', s.positions.length ? esc(s.positions.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0].desc) : '—', '', s.positions.length ? Math.round(Math.abs(s.positions.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0].value) / total * 100) + '% of the account' : '') + '</div>'
      + '<h3>POSITIONS</h3>' + positionsHtml(d, canTrade) + '</div></div>';
  }
  function performanceHtml(d) {
    const st = stats(d), c = S.cal, days = c ? (c.days || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
    const pf = st.profitFactor == null ? '—' : st.profitFactor === Infinity ? '∞' : st.profitFactor.toFixed(2);
    return '<div class="two"><div class="viz"><h3>DAILY P&amp;L · ' + (c ? esc(new Date(Date.UTC(Number(c.month.slice(0, 4)), Number(c.month.slice(5, 7)) - 1, 1)).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' })) : '') + '</h3><div class="calnav"><button type="button" data-act="month" data-v="-1">◀</button><b>' + (c ? (c.total >= 0 ? '+' : '') + usd(c.total) + ' · ' + c.green + ' green / ' + c.red + ' red' : '…') + '</b><button type="button" data-act="month" data-v="1">▶</button></div><canvas id="paper-bars"></canvas></div>'
      + '<div class="viz"><h3>WINS vs LOSSES</h3><canvas id="paper-wl"></canvas><div class="legend"><div><i style="background:#52e6ad"></i><span>Winning closes</span><span>' + st.wins + '</span><span class="up">' + usd(st.avgW) + ' avg</span></div><div><i style="background:#ff778b"></i><span>Losing closes</span><span>' + st.losses + '</span><span class="dn">' + usd(-st.avgL) + ' avg</span></div></div></div></div>'
      + '<div class="kpis">' + kpi('PROFIT FACTOR', pf, st.profitFactor > 1 ? 'up' : st.profitFactor != null && st.profitFactor < 1 ? 'dn' : '', 'gross wins ÷ gross losses') + kpi('EXPECTANCY', st.expectancy == null ? '—' : usd(st.expectancy), cls(st.expectancy), 'per closed trade') + kpi('BEST TRADE', usd(st.largestW), 'up') + kpi('WORST TRADE', usd(st.largestL), st.largestL < 0 ? 'dn' : '') + kpi('BEST DAY', c && c.best ? usd(c.best.change != null ? c.best.change : c.best.realized) : '—', 'up', c && c.best ? c.best.date : '') + kpi('WORST DAY', c && c.worst ? usd(c.worst.change != null ? c.worst.change : c.worst.realized) : '—', c && c.worst && (c.worst.change != null ? c.worst.change : c.worst.realized) < 0 ? 'dn' : '', c && c.worst ? c.worst.date : '') + kpi('RETURN', pct(d.summary.returnPct), cls(d.summary.returnPct), 'on money put in') + kpi('MAX DRAWDOWN', d.summary.maxDrawdownPct + '%', d.summary.maxDrawdownPct >= 10 ? 'dn' : '', 'peak to trough') + '</div>'
      + (days.length ? '' : '<p class="note">Daily bars fill in as days close with positions marked or trades closed.</p>');
  }
  function positionsHtml(d, canTrade) {
    const s = d.summary;
    return s.positions.length ? '<table><thead><tr><th>Contract</th><th>Qty</th><th>Avg</th><th>Mark</th><th>Value</th><th>P&amp;L</th><th></th></tr></thead><tbody>' + s.positions.map((p) => '<tr><td>' + esc(p.desc) + '</td><td>' + p.qty + '</td><td>' + usd(p.avg) + '</td><td>' + usd(p.mark) + '</td><td>' + usd(p.value) + '</td><td class="' + cls(p.pnl) + '">' + usd(p.pnl) + (p.pnlPct != null ? ' (' + pct(p.pnlPct) + ')' : '') + '</td><td>' + (canTrade ? '<button type="button" data-act="close" data-v="' + esc(p.key) + '">Close</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="note">Flat: no open positions.</p>';
  }
  function activityHtml(d) {
    return '<h3>FILLS</h3>' + (d.trades.length ? '<table><thead><tr><th>When</th><th>Side</th><th>Qty</th><th>Contract</th><th>Price</th><th>Session</th><th>Realized</th><th>Note</th></tr></thead><tbody>' + d.trades.map((t) => '<tr><td>' + when(t.t) + '</td><td>' + t.side.toUpperCase() + '</td><td>' + t.qty + '</td><td>' + esc(t.desc) + '</td><td>' + usd(t.price) + '</td><td>' + esc(t.session) + '</td><td class="' + cls(t.realized) + '">' + (t.realized ? usd(t.realized) : '—') + '</td><td>' + esc(t.note || '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="note">No fills yet. Open TRADE to place the first paper trade.</p>')
      + '<h3>ACCOUNT LOG</h3><div class="log">' + ((d.log || []).length ? d.log.map((l) => '<div>' + when(l.t) + ' · ' + esc(l.text) + '</div>').join('') : '<div>Nothing logged yet.</div>') + '</div>'
      + '<h3>DEPOSITS</h3>' + ((d.deposits || []).length ? '<table><thead><tr><th>When</th><th>Kind</th><th>Amount</th></tr></thead><tbody>' + d.deposits.map((x) => '<tr><td>' + when(x.t) + '</td><td>' + esc(x.kind) + '</td><td>' + usd(x.amount) + '</td></tr>').join('') + '</tbody></table>' : '');
  }
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
    const r = S.dayRecap; if (!r) return '<p class="note">Click a day for its recap: the market that day, your activity and results, and what the account\'s P&amp;L says.</p>';
    if (r.loading) return '<div class="recap">Loading ' + esc(r.date) + '…</div>';
    if (r.error) return '<div class="recap">No recap for ' + esc(r.date) + '.</div>';
    const mk = r.market, a = r.account;
    return '<div class="recap"><b>' + esc(r.date) + '</b>' + (mk && mk.ok ? '<div>Market: SPY ' + pct(mk.spyChangePct) + (mk.label ? ', read ' + esc(mk.label) : '') + (mk.vix != null ? ', VIX ' + mk.vix : '') + (mk.note ? '. ' + esc(mk.note) : '') + '</div>' : '<div>Market: no read stored for this day.</div>')
      + '<div>Account: ' + (a.change != null ? (a.change >= 0 ? 'up ' : 'down ') + usd(Math.abs(a.change)) + ' on the day' : 'no change recorded') + ', ' + usd(a.realized) + ' realized, ' + a.trades.length + ' fill' + (a.trades.length === 1 ? '' : 's') + (a.symbols.length ? ' in ' + a.symbols.join(', ') : '') + '.</div>'
      + (a.trades.length ? '<div>' + a.trades.map((t) => when(t.t) + ' ' + t.side.toUpperCase() + ' ' + t.qty + ' ' + esc(t.desc) + ' @ ' + usd(t.price) + (t.realized ? ' (' + usd(t.realized) + ')' : '')).join('<br>') + '</div>' : '')
      + '<div>' + (r.insight || []).map(esc).join(' ') + '</div></div>';
  }

  function headerHtml(d) {
    const s = d.summary, st = stats(d);
    const initials = String(d.name || 'P').split(/\s+/).map((w) => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'P';
    const today = s.today ? (s.today.change != null ? s.today.change : s.today.realized) : 0;
    const accounts = '<span class="acct"><button type="button" data-act="account" data-v="me" class="' + (S.account === 'me' ? 'on' : '') + '">MINE</button>' + (S.owner ? '<button type="button" data-act="account" data-v="challenge" class="' + (S.account === 'challenge' ? 'on' : '') + '">CHALLENGE</button>' : '') + '</span>';
    const ringPct = st.winRate != null ? st.winRate : Math.max(0, Math.min(100, s.returnPct));
    return '<div class="pf"><div class="av">' + esc(initials) + '</div><div class="who"><h2>' + esc(d.name) + '</h2><div class="sub"><span class="sim">SIMULATED · NOT REAL MONEY</span>' + accounts + '<span>opened ' + dateOf(d.createdAt) + '</span><span>' + esc(d.session).toUpperCase() + ' SESSION</span></div></div>'
      + '<div class="eq"><span>ACCOUNT VALUE</span><b>' + usd(s.equity) + '</b><i class="' + cls(today) + '">' + (today >= 0 ? '+' : '') + usd(today) + ' today</i><i class="' + cls(s.pnl) + '">' + (s.pnl >= 0 ? '+' : '') + usd(s.pnl) + ' · ' + pct(s.returnPct) + ' all time</i></div>'
      + ring(ringPct, st.winRate != null ? 'WIN RATE' : 'RETURN', st.winRate != null ? (st.winRate >= 50 ? '#52e6ad' : '#ffd66b') : (s.returnPct >= 0 ? '#52e6ad' : '#ff778b')) + '</div>';
  }

  function paint() {
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    const title = document.querySelector('.below-title');
    const others = ['earnings-panel', 'catalysts-panel', 'challenge-panel'];
    if (!S.on) { const el = document.getElementById('paper-panel'); if (el) el.style.display = 'none'; if (dock && !others.some((id) => { const x = document.getElementById(id); return x && x.style.display !== 'none'; })) dock.style.display = ''; if (title && S.prevTitle) { title.textContent = S.prevTitle; S.prevTitle = ''; } clearInterval(S.timer); S.timer = 0; return; }
    if (dock) dock.style.display = 'none';
    others.forEach((id) => { const x = document.getElementById(id); if (x) x.style.display = 'none'; });
    if (title && !S.prevTitle) { S.prevTitle = title.textContent; title.textContent = 'PAPER TRADE · PORTFOLIO · SIMULATED'; }
    if (!S.timer) S.timer = setInterval(() => { if (S.on && !document.hidden && !S.busy) { S.data[S.account] = null; void load(); } }, 60_000);
    const el = panel(); el.style.display = '';
    if (!S.session) { el.innerHTML = '<h2>PAPER TRADE</h2><p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; return; }
    if (!S.data[S.account] && !S.err && !S.busy) void load();
    const d = S.data[S.account];
    if (S.err && !d) { el.innerHTML = '<h2>PAPER TRADE</h2><p class="note">' + esc(S.err) + '</p>'; return; }
    if (!d) { el.innerHTML = '<h2>PAPER TRADE</h2><p class="note">Loading your portfolio…</p>'; return; }
    const canTrade = S.account === 'me' || S.owner;
    const focus = '<div class="focus">' + FOCUS.map(([k, l]) => '<button type="button" data-act="focus" data-v="' + k + '" class="' + (S.focus === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    let body = '';
    if (S.focus === 'overview') body = overviewHtml(d);
    else if (S.focus === 'allocation') body = allocationHtml(d, canTrade);
    else if (S.focus === 'performance') body = performanceHtml(d);
    else if (S.focus === 'calendar') body = '<h3>P&amp;L CALENDAR</h3>' + calendarHtml() + recapHtml();
    else if (S.focus === 'activity') body = activityHtml(d);
    else body = ticketHtml(canTrade) + '<h3>POSITIONS</h3>' + positionsHtml(d, canTrade) + (canTrade && S.account === 'me' ? '<button type="button" class="paper-toggle" data-act="reset">Reset my paper account</button>' : '');
    el.innerHTML = headerHtml(d) + focus + body
      + '<p class="note">' + esc(d.disclaimer) + ' Buys fill at the ask and sells at the bid when a quote exists, else the last price with 5 bps slippage; options cost $0.65 a contract and settle at intrinsic value on expiry. Pre- and after-market fills need a price in that session.</p>';
    const cv = document.getElementById('paper-curve'); if (cv) drawCurve(cv, d.equity, d.deposits);
    const dn = document.getElementById('paper-donut'); if (dn) { const s = d.summary; const slices = s.positions.map((p, i) => ({ value: Math.abs(p.value), color: PALETTE[i % PALETTE.length] })); slices.push({ value: Math.max(0, s.cash), color: '#1f4a2e' }); drawDonut(dn, slices, usd(s.equity, 0), s.positions.length + ' position' + (s.positions.length === 1 ? '' : 's') + ' + cash'); }
    const br = document.getElementById('paper-bars'); if (br) drawBars(br, S.cal ? (S.cal.days || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : []);
    const wl = document.getElementById('paper-wl'); if (wl) { const st = stats(d); drawDonut(wl, [{ value: st.wins, color: '#52e6ad' }, { value: st.losses, color: '#ff778b' }], st.winRate == null ? '—' : Math.round(st.winRate) + '%', st.n + ' closed trade' + (st.n === 1 ? '' : 's')); }
  }
  const sync = () => btn.classList.toggle('on', S.on);
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.ticket.symbol = chartSym(); S.msg = ''; S.data = {}; if (S.session) void load(); } paint(); });
  window.addEventListener('sml-live-data', () => { if (S.on && !S.ticket.symbol) paint(); });
  window.addEventListener('resize', () => { if (S.on && S.data[S.account]) paint(); });
  sync();
  (function boot(tries) { if (S.on && !document.getElementById('options-dock') && !document.getElementById('options-chain') && tries < 60) { setTimeout(() => boot(tries + 1), 200); return; } paint(); })(0);
})();
