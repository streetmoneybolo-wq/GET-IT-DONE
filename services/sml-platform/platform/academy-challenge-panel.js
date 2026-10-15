/* CHALLENGE for the Academy Live Chart Lab: Grandmaster-obi's $1,000 -> $100,000 MEM ALGO portfolio, a SIMULATED account on
 * real prices and real time with $100 added every Monday. Toolbar toggle swaps the options dock for the equity curve, the
 * numbers, open positions, the trade log and the rules. Everything from /academy-activity/challenge (Discord session).
 * Simulated and educational: nothing here is real money or advice. */
(() => {
  if (window.__smlChallenge) return;
  window.__smlChallenge = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const usd = (v, d = 2) => (num(v) == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  const KEY = 'sml-challenge-v1';
  const S = { on: false, session: String(window.smlAcademySessionToken || ''), data: null, err: '', busy: false, prevTitle: '', owner: false, timer: 0 };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };
  const toolbar = document.querySelector('.toolbar'); if (!toolbar) return;

  const style = document.createElement('style');
  style.textContent = '.challenge-toggle{margin-left:4px;padding:5px 9px;border:1px solid #1d4a5a;border-radius:7px;background:#051a22;color:#7fd6f0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.challenge-toggle.on{background:#0f4a5e;border-color:#6be6ff;color:#fff}'
    + '#challenge-panel{padding:14px;border:1px solid #163542;border-radius:10px;background:#07111a;color:#d8ecf4;font:600 .72rem system-ui,sans-serif;margin:0 0 18px}'
    + '#challenge-panel h2{margin:0 0 4px;font:800 .8rem ui-monospace,monospace;color:#6be6ff;letter-spacing:.03em}#challenge-panel .sim{display:inline-block;margin:0 0 10px;padding:2px 8px;border-radius:5px;background:#5a1d1d;color:#ffb3b3;font:800 .6rem ui-monospace,monospace;letter-spacing:.08em}'
    + '#challenge-panel .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:8px 0 12px}#challenge-panel .kpi{padding:8px 10px;border:1px solid #163542;border-radius:8px;background:#0b1a25}#challenge-panel .kpi span{display:block;color:#7fa3b3;font:700 .58rem ui-monospace,monospace;letter-spacing:.05em}#challenge-panel .kpi b{display:block;font:800 .95rem ui-monospace,monospace;color:#e8f6fb;margin-top:2px}#challenge-panel .kpi b.up{color:#52e6ad}#challenge-panel .kpi b.dn{color:#ff778b}'
    + '#challenge-panel .bar{height:10px;border-radius:5px;background:#0e2633;overflow:hidden;margin:4px 0 12px}#challenge-panel .bar i{display:block;height:100%;background:linear-gradient(90deg,#1f8fff,#6be6ff)}'
    + '#challenge-panel canvas{width:100%;height:150px;display:block;border:1px solid #163542;border-radius:8px;background:#0b1a25;margin:0 0 12px}'
    + '#challenge-panel table{width:100%;border-collapse:collapse;font:600 .66rem ui-monospace,monospace;margin:0 0 10px}#challenge-panel th,#challenge-panel td{padding:5px 5px;text-align:right;border-bottom:1px solid rgba(22,53,66,.7)}#challenge-panel th{color:#7fa3b3;font-weight:700}#challenge-panel td:first-child,#challenge-panel th:first-child{text-align:left}#challenge-panel td.up{color:#52e6ad}#challenge-panel td.dn{color:#ff778b}'
    + '#challenge-panel h3{margin:10px 0 6px;font:800 .66rem ui-monospace,monospace;color:#9ad7ea;letter-spacing:.05em}#challenge-panel ul{margin:0;padding-left:18px;color:#b9d3dd;font-size:.64rem;line-height:1.5}'
    + '#challenge-panel .log div{color:#b9d3dd;font-size:.63rem;padding:2px 0;border-bottom:1px solid rgba(22,53,66,.4)}#challenge-panel .note{margin-top:10px;color:#7fa3b3;font-size:.62rem;line-height:1.4;font-weight:500}'
    + '#challenge-panel button.reset{margin-top:8px;padding:4px 9px;border:1px solid #5a1d1d;border-radius:6px;background:#2a0b0b;color:#ffb3b3;font:800 .6rem ui-monospace,monospace;cursor:pointer}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'challenge-toggle'; btn.className = 'challenge-toggle'; btn.textContent = 'CHALLENGE'; btn.title = "Grandmaster-obi's $1,000 to $100,000 MEM ALGO portfolio (simulated)"; toolbar.appendChild(btn);
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.data = null; S.err = ''; if (S.on) { void load(); paint(); } });

  async function load() {
    if (!S.session || S.busy) return;
    S.busy = true; S.err = '';
    try {
      const res = await fetch('/academy-activity/challenge', { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'unavailable');
      S.data = payload; S.owner = Boolean(payload.me && payload.me.owner);
    } catch (_) { S.err = 'The challenge is not available right now.'; }
    S.busy = false; paint();
  }
  async function reset() {
    if (!S.owner || !window.confirm('Reset the challenge to $1,000 and wipe its history?')) return;
    try { await fetch('/academy-activity/challenge/reset', { method: 'POST', headers: { authorization: 'Bearer ' + S.session } }); } catch (_) { /* ignore */ }
    S.data = null; void load();
  }

  function panel() {
    let el = document.getElementById('challenge-panel');
    if (!el) {
      el = document.createElement('section'); el.id = 'challenge-panel'; el.setAttribute('aria-label', 'MEM ALGO challenge portfolio (simulated)');
      const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
      if (dock && dock.parentElement) dock.parentElement.insertBefore(el, dock); else document.body.appendChild(el);
      el.addEventListener('click', (e) => { if (e.target.closest('button.reset')) void reset(); });
    }
    return el;
  }
  function drawCurve(canvas, points, deposits) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600, h = 150;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!points || points.length < 2) { c.fillStyle = '#7fa3b3'; c.font = '700 11px ui-monospace,monospace'; c.fillText('The curve starts with the first market-hours tick.', 10, 20); return; }
    const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1, vals = points.map((p) => p.value);
    const lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
    const x = (t) => 8 + (w - 16) * ((t - t0) / Math.max(1, t1 - t0)), y = (v) => h - 8 - (h - 16) * ((v - lo) / Math.max(1e-9, hi - lo));
    // the money put in, as a step line, so the gap to the curve is the actual result
    let dep = 0; const steps = (deposits || []).slice().sort((a, b) => a.t - b.t);
    c.strokeStyle = '#2f5566'; c.setLineDash([3, 3]); c.beginPath(); let started = false;
    for (const p of points) { while (steps.length && steps[0].t <= p.t) dep += steps.shift().amount; const yy = y(Math.max(lo, Math.min(hi, dep))); if (!started) { c.moveTo(x(p.t), yy); started = true; } else c.lineTo(x(p.t), yy); }
    c.stroke(); c.setLineDash([]);
    c.strokeStyle = '#6be6ff'; c.lineWidth = 1.6; c.beginPath(); points.forEach((p, i) => { if (i) c.lineTo(x(p.t), y(p.value)); else c.moveTo(x(p.t), y(p.value)); }); c.stroke();
    c.fillStyle = '#9ad7ea'; c.font = '700 10px ui-monospace,monospace'; c.fillText('$' + Math.round(hi), 10, 12); c.fillText('$' + Math.round(lo), 10, h - 4);
  }

  function paint() {
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    const title = document.querySelector('.below-title');
    if (!S.on) { const el = document.getElementById('challenge-panel'); if (el) el.style.display = 'none'; const others = ['earnings-panel', 'catalysts-panel'].some((id) => { const x = document.getElementById(id); return x && x.style.display !== 'none'; }); if (dock && !others) dock.style.display = ''; if (title && S.prevTitle) { title.textContent = S.prevTitle; S.prevTitle = ''; } clearInterval(S.timer); S.timer = 0; return; }
    if (dock) dock.style.display = 'none';
    ['earnings-panel', 'catalysts-panel'].forEach((id) => { const x = document.getElementById(id); if (x) x.style.display = 'none'; });
    if (title && !S.prevTitle) { S.prevTitle = title.textContent; title.textContent = 'CHALLENGE · $1,000 → $100,000 · SIMULATED'; }
    if (!S.timer) S.timer = setInterval(() => { if (S.on && !document.hidden) void load(); }, 60_000);
    const el = panel(); el.style.display = '';
    if (!S.session) { el.innerHTML = '<h2>CHALLENGE</h2><p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; return; }
    if (!S.data && !S.err && !S.busy) void load();
    if (S.err) { el.innerHTML = '<h2>CHALLENGE</h2><p class="note">' + esc(S.err) + '</p>'; return; }
    const d = S.data; if (!d) { el.innerHTML = '<h2>CHALLENGE</h2><p class="note">Loading…</p>'; return; }
    const st = d.stats, r = d.rules;
    const kpi = (label, value, cls) => '<div class="kpi"><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>';
    el.innerHTML = '<h2>' + esc(d.name) + '</h2><span class="sim">SIMULATED · NOT REAL MONEY · NOT ADVICE</span>'
      + '<div class="kpis">' + kpi('ACCOUNT', usd(st.equity)) + kpi('PUT IN', usd(st.deposited, 0)) + kpi('RESULT', usd(st.pnl), st.pnl > 0 ? 'up' : st.pnl < 0 ? 'dn' : '') + kpi('RETURN', pct(st.returnPct), st.returnPct > 0 ? 'up' : st.returnPct < 0 ? 'dn' : '') + kpi('CASH', usd(st.cash)) + kpi('OPEN', st.openPositions + (st.hedged ? ' + hedge' : '')) + kpi('TRADES', st.trades + (st.winRate != null ? ' · ' + st.winRate + '% won' : '')) + kpi('MAX DRAWDOWN', st.maxDrawdownPct + '%', st.maxDrawdownPct >= 10 ? 'dn' : '') + kpi('DAY', st.days) + '</div>'
      + '<div>Progress to ' + usd(st.goal, 0) + ': <b>' + st.progressPct + '%</b></div><div class="bar"><i style="width:' + Math.max(0.5, st.progressPct) + '%"></i></div>'
      + '<canvas id="challenge-curve"></canvas>'
      + '<h3>OPEN POSITIONS</h3>' + (d.positions.length ? '<table><thead><tr><th>Ticker</th><th>Mode</th><th>Qty</th><th>Entry</th><th>Price</th><th>Stop</th><th>Target</th><th>P&amp;L</th><th>Grade</th></tr></thead><tbody>' + d.positions.map((p) => '<tr><td>' + esc(p.symbol) + (p.hedge ? ' (hedge)' : '') + '</td><td>' + esc(p.mode) + '</td><td>' + p.qty + '</td><td>' + usd(p.entry) + '</td><td>' + usd(p.price) + '</td><td>' + (p.stop ? usd(p.stop) : '—') + '</td><td>' + (p.target ? usd(p.target) : '—') + '</td><td class="' + (p.pnl > 0 ? 'up' : p.pnl < 0 ? 'dn' : '') + '">' + usd(p.pnl) + '</td><td>' + (p.grade ? esc(p.grade) + ' ' + p.score : '—') + '</td></tr>').join('') + '</tbody></table>' : '<p class="note">Flat. The model is waiting for a grade-A setup' + (st.exposurePct ? '' : ' — most of the time that is the right position') + '.</p>')
      + '<h3>CLOSED TRADES</h3>' + (d.trades.length ? '<table><thead><tr><th>Ticker</th><th>In</th><th>Out</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Why</th></tr></thead><tbody>' + d.trades.map((t) => '<tr><td>' + esc(t.symbol) + (t.hedge ? ' (hedge)' : '') + '</td><td>' + when(t.entryT) + '</td><td>' + when(t.exitT) + '</td><td>' + usd(t.entry) + '</td><td>' + usd(t.exit) + '</td><td class="' + (t.pnl > 0 ? 'up' : t.pnl < 0 ? 'dn' : '') + '">' + usd(t.pnl) + '</td><td>' + (t.R == null ? '—' : t.R) + '</td><td>' + esc(t.reason) + '</td></tr>').join('') + '</tbody></table>' : '<p class="note">No closed trades yet.</p>')
      + '<h3>JOURNAL</h3><div class="log">' + (d.log.length ? d.log.map((l) => '<div>' + when(l.t) + ' · ' + esc(l.text) + '</div>').join('') : '<div>Waiting for the first market-hours tick.</div>') + '</div>'
      + '<h3>THE RULES</h3><ul><li>Starts with ' + usd(r.start, 0) + '; ' + usd(r.weeklyDeposit, 0) + ' added on the first open day of every week, like a pay-day contribution.</li><li>Only takes BUY signals the full MEM ALGO confluence grades A (score ' + r.minScore + '+): every data source on the platform has to agree.</li><li>Each trade risks ' + (r.riskPerTrade.swing * 100) + '% of the account to its stop (' + (r.riskPerTrade.day * 100) + '% for day trades); at most ' + r.maxPositions + ' names and ' + (r.maxPositionPct * 100) + '% of the account in one; no borrowing, no shorting.</li><li>Skips anything reporting earnings within ' + r.earningsBlackoutDays + ' days; stops buying when the market read drops below ' + Math.abs(r.noNewLongsBelowBias || 30) + ' bearish.</li><li>Hedges ' + (r.hedge.sizePct * 100) + '% of exposure with ' + esc(r.hedge.etf) + ' when the market read falls to ' + r.hedge.triggerBias + ', and lifts it when the read recovers.</li><li>Exits on the stop, the target, a trailing stop, the max hold, the day session\'s close, or MEM ALGO\'s own exit signal. Fills at the next price with ' + r.slippageBps + ' bps slippage and ' + r.costBps + ' bps commission.</li></ul>'
      + (S.owner ? '<button type="button" class="reset">Reset challenge (owner)</button>' : '')
      + '<p class="note">' + esc(d.disclaimer) + ' Last tick ' + when(d.lastTick) + '.</p>';
    const cv = document.getElementById('challenge-curve'); if (cv) drawCurve(cv, d.equity, d.deposits);
  }
  const sync = () => btn.classList.toggle('on', S.on);
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.data = null; S.err = ''; if (S.session) void load(); } paint(); });
  sync();
  (function boot(tries) { if (S.on && !document.getElementById('options-dock') && !document.getElementById('options-chain') && tries < 60) { setTimeout(() => boot(tries + 1), 200); return; } paint(); })(0);
})();
