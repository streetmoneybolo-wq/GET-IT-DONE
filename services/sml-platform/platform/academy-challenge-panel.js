/* CHALLENGE for the Academy Live Chart Lab: Grandmaster-obi's $1,000 -> $100,000 portfolio. MEM ALGO raises the ideas, the
 * owner takes them with one click, the paper-trading simulator holds the money, and the engine manages the exits. The tool
 * is the owner's only: the button appears once the server confirms the owner, members follow the trades in Discord. The
 * owner also gets a pop-up here whenever a new idea lands (and a push / Discord DM from the server). The
 * account is SIMULATED on real prices: no real money, no advice. Routes under /academy-activity/challenge. */
(() => {
  if (window.__smlChallenge) return;
  window.__smlChallenge = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const usd = (v, d = 2) => (num(v) == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  const KEY = 'sml-challenge-v2';
  const S = { on: false, session: String(window.smlAcademySessionToken || ''), data: null, err: '', busy: false, prevTitle: '', owner: false, timer: 0, msg: '', seen: new Set(), lastIdeaT: 0, pollT: 0 };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.on = v.on === true; S.lastIdeaT = Number(v.lastIdeaT) || 0; } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, lastIdeaT: S.lastIdeaT })); } catch (_) { /* ignore */ } };
  const toolbar = document.querySelector('.toolbar'); if (!toolbar) return;
  const auth = () => ({ authorization: 'Bearer ' + S.session, 'content-type': 'application/json' });

  const style = document.createElement('style');
  style.textContent = '.challenge-toggle{margin-left:4px;padding:5px 9px;border:1px solid #1d4a5a;border-radius:7px;background:#051a22;color:#7fd6f0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.challenge-toggle.on{background:#0f4a5e;border-color:#6be6ff;color:#fff}'
    + '#challenge-panel{padding:14px;border:1px solid #163542;border-radius:10px;background:#07111a;color:#d8ecf4;font:600 .72rem system-ui,sans-serif;margin:0 0 18px}#challenge-panel h2{margin:0 0 4px;font:800 .8rem ui-monospace,monospace;color:#6be6ff;letter-spacing:.03em}'
    + '#challenge-panel .sim{display:inline-block;margin:0 0 10px;padding:2px 8px;border-radius:5px;background:#5a1d1d;color:#ffb3b3;font:800 .6rem ui-monospace,monospace;letter-spacing:.08em}'
    + '#challenge-panel .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:8px 0 12px}#challenge-panel .kpi{padding:8px 10px;border:1px solid #163542;border-radius:8px;background:#0b1a25}#challenge-panel .kpi span{display:block;color:#7fa3b3;font:700 .58rem ui-monospace,monospace;letter-spacing:.05em}#challenge-panel .kpi b{display:block;font:800 .95rem ui-monospace,monospace;color:#e8f6fb;margin-top:2px}#challenge-panel .kpi b.up{color:#52e6ad}#challenge-panel .kpi b.dn{color:#ff778b}'
    + '#challenge-panel .bar{height:10px;border-radius:5px;background:#0e2633;overflow:hidden;margin:4px 0 12px}#challenge-panel .bar i{display:block;height:100%;background:linear-gradient(90deg,#1f8fff,#6be6ff)}'
    + '#challenge-panel canvas{width:100%;height:150px;display:block;border:1px solid #163542;border-radius:8px;background:#0b1a25;margin:0 0 12px}'
    + '#challenge-panel .idea{border:1px solid #2a4a1d;border-radius:8px;padding:10px;margin:0 0 8px;background:#0b1f12}#challenge-panel .idea.new{border-color:#52e6ad;box-shadow:0 0 0 1px rgba(82,230,173,.25)}#challenge-panel .idea.taken{border-color:#1f8fff;background:#0b1a25}#challenge-panel .idea.closed,#challenge-panel .idea.expired,#challenge-panel .idea.skipped{opacity:.7}#challenge-panel .idea b{color:#9ff0b0}#challenge-panel .idea .st{float:right;font:800 .58rem ui-monospace,monospace;color:#7fa3b3;letter-spacing:.06em}#challenge-panel .idea .legs{font:700 .64rem ui-monospace,monospace;color:#bfe3cf;margin:4px 0}#challenge-panel .idea .why{color:#a9c7b8;font-size:.63rem}'
    + '#challenge-panel .idea button{margin:6px 6px 0 0;padding:6px 12px;border-radius:6px;font:800 .64rem ui-monospace,monospace;cursor:pointer;border:1px solid #52e6ad;background:#145a2a;color:#fff}#challenge-panel .idea button.skip{border-color:#5a1d1d;background:#2a0b0b;color:#ffb3b3}'
    + '#challenge-panel table{width:100%;border-collapse:collapse;font:600 .66rem ui-monospace,monospace}#challenge-panel th,#challenge-panel td{padding:5px 5px;text-align:right;border-bottom:1px solid rgba(22,53,66,.7)}#challenge-panel th{color:#7fa3b3;font-weight:700}#challenge-panel td:first-child,#challenge-panel th:first-child{text-align:left}#challenge-panel td.up{color:#52e6ad}#challenge-panel td.dn{color:#ff778b}'
    + '#challenge-panel h3{margin:10px 0 6px;font:800 .66rem ui-monospace,monospace;color:#9ad7ea;letter-spacing:.05em}#challenge-panel ul{margin:0;padding-left:18px;color:#b9d3dd;font-size:.64rem;line-height:1.5}#challenge-panel .log div{color:#b9d3dd;font-size:.63rem;padding:2px 0;border-bottom:1px solid rgba(22,53,66,.4)}#challenge-panel .note{margin-top:10px;color:#7fa3b3;font-size:.62rem;line-height:1.4;font-weight:500}#challenge-panel .msg{color:#ffd66b;font-size:.64rem;margin:0 0 8px}'
    + '#challenge-panel button.reset,#challenge-panel button.share{margin-top:8px;margin-right:6px;padding:4px 9px;border:1px solid #5a1d1d;border-radius:6px;background:#2a0b0b;color:#ffb3b3;font:800 .6rem ui-monospace,monospace;cursor:pointer}#challenge-panel button.share{border-color:#1d4a5a;background:#051a22;color:#7fd6f0}'
    + '#challenge-toast{position:fixed;right:14px;bottom:14px;z-index:2147483200;max-width:340px;padding:12px 14px;border:1px solid #52e6ad;border-radius:10px;background:#0b1f12;color:#e8fbee;font:600 .7rem system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}#challenge-toast b{color:#9ff0b0;font-family:ui-monospace,monospace}#challenge-toast button{margin:8px 6px 0 0;padding:6px 12px;border-radius:6px;font:800 .64rem ui-monospace,monospace;cursor:pointer;border:1px solid #52e6ad;background:#145a2a;color:#fff}#challenge-toast button.skip{border-color:#5a1d1d;background:#2a0b0b;color:#ffb3b3}#challenge-toast button.later{border-color:#1d4a5a;background:#051a22;color:#7fd6f0}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'challenge-toggle'; btn.className = 'challenge-toggle'; btn.textContent = 'CHALLENGE'; btn.title = "Grandmaster-obi's $1,000 to $100,000 portfolio: MEM ALGO's ideas, taken by hand, paper-traded on real prices (simulated)"; btn.style.display = 'none'; toolbar.appendChild(btn);
  const showForOwner = () => { btn.style.display = S.owner ? '' : 'none'; if (!S.owner && S.on) { S.on = false; save(); sync(); paint(); } };
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.data = null; S.err = ''; if (S.on) { void load(); paint(); } startPoll(); });

  async function load() {
    if (!S.session || S.busy) return;
    S.busy = true; S.err = '';
    try {
      const res = await fetch('/academy-activity/challenge', { headers: auth(), cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'unavailable');
      S.data = payload; S.owner = Boolean(payload.me && payload.me.owner); showForOwner();
    } catch (_) { S.err = 'The challenge is not available right now.'; }
    S.busy = false; paint();
  }
  async function act(path, body) {
    S.msg = 'Working…'; paint();
    try { const res = await fetch('/academy-activity/challenge/' + path, { method: 'POST', headers: auth(), body: JSON.stringify(body || {}) }); const j = await res.json().catch(() => ({})); S.msg = j.ok ? (path === 'take' ? 'Taken: bought ' + j.trade.qty + ' ' + j.trade.desc + ' @ ' + usd(j.trade.price) : path === 'skip' ? 'Skipped.' : 'Done.') : (j.message || ('Not done: ' + (j.error || 'unavailable'))); }
    catch (_) { S.msg = 'The server did not answer.'; }
    S.data = null; await load();
  }

  /* the channel card: one click renders the account picture on the server and posts it; the channel id is asked for once */
  async function share() {
    let channelId = ''; try { channelId = localStorage.getItem('sml-challenge-channel') || ''; } catch (_) { /* ignore */ }
    const note = window.prompt('Add a line to the post (optional):', '') ; if (note === null) return;
    const post = async () => { const res = await fetch('/academy-activity/challenge/share', { method: 'POST', headers: auth(), body: JSON.stringify({ channelId: channelId || undefined, note }) }); return { status: res.status, j: await res.json().catch(() => ({})) }; };
    S.msg = 'Rendering the card and posting…'; paint();
    try {
      let r = await post();
      if (!r.j.ok && r.j.error === 'no_channel') { channelId = String(window.prompt('Paste the Discord channel id for the challenge posts (right-click the channel → Copy Channel ID):', '') || '').trim(); if (!/^\d{5,25}$/.test(channelId)) { S.msg = 'No channel id given.'; paint(); return; } try { localStorage.setItem('sml-challenge-channel', channelId); } catch (_) { /* ignore */ } r = await post(); }
      S.msg = r.j.ok ? 'Posted the card to the channel.' : (r.j.message || ('Not posted: ' + (r.j.error || 'unavailable')));
    } catch (_) { S.msg = 'The server did not answer.'; }
    paint();
  }
  /* owner pop-up for new ideas, polled every minute whether or not the panel is open */
  function startPoll() { if (S.pollT || !S.session) return; S.pollT = setInterval(pollIdeas, 60_000); setTimeout(pollIdeas, 4_000); }
  async function pollIdeas() {
    if (!S.session || document.hidden) return;
    try {
      const res = await fetch('/academy-activity/challenge/ideas?since=' + S.lastIdeaT, { headers: auth(), cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (res.status === 403) { clearInterval(S.pollT); S.pollT = -1; S.owner = false; showForOwner(); return; }
      if (!res.ok || !j.ok) return;
      S.owner = Boolean(j.me && j.me.owner); showForOwner();
      const fresh = (j.ideas || []).filter((i) => i.status === 'new' && !S.seen.has(i.id)).sort((a, b) => a.t - b.t);
      for (const i of j.ideas || []) S.lastIdeaT = Math.max(S.lastIdeaT, i.t);
      save();
      if (fresh.length) { fresh.forEach((i) => S.seen.add(i.id)); toast(fresh[fresh.length - 1], fresh.length); }
    } catch (_) { /* quiet */ }
  }
  function toast(i, n) {
    let el = document.getElementById('challenge-toast'); if (!el) { el = document.createElement('div'); el.id = 'challenge-toast'; document.body.appendChild(el); }
    el.innerHTML = '<div><b>1K→100K idea' + (n > 1 ? ' (+' + (n - 1) + ' more)' : '') + '</b></div><div style="margin-top:4px">BUY <b>' + esc(i.symbol) + '</b> · ' + esc(i.mode) + ' · grade ' + esc(i.grade) + ' ' + i.score + '<br>' + i.qty + ' shares near ' + usd(i.entry) + ' · stop ' + usd(i.stop) + (i.target ? ' · target ' + usd(i.target) : '') + '<br><span style="color:#a9c7b8">' + esc(i.reason || '') + '</span></div>'
      + (S.owner ? '<button type="button" data-take="' + i.id + '">TAKE IT</button><button type="button" class="skip" data-skip="' + i.id + '">SKIP</button>' : '') + '<button type="button" class="later" data-later="1">' + (S.owner ? 'LATER' : 'OK') + '</button>';
    el.onclick = (e) => { const t = e.target; if (t.dataset.take) { void act('take', { id: Number(t.dataset.take) }); el.remove(); if (!S.on) { S.on = true; save(); sync(); paint(); } } else if (t.dataset.skip) { void act('skip', { id: Number(t.dataset.skip) }); el.remove(); } else if (t.dataset.later) el.remove(); };
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (_) { /* ignore */ }
  }

  function panel() {
    let el = document.getElementById('challenge-panel');
    if (!el) {
      el = document.createElement('section'); el.id = 'challenge-panel'; el.setAttribute('aria-label', 'MEM ALGO challenge portfolio (simulated)');
      const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
      if (dock && dock.parentElement) dock.parentElement.insertBefore(el, dock); else document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-act]'); if (!t) return;
        if (t.dataset.act === 'take') void act('take', { id: Number(t.dataset.id) });
        else if (t.dataset.act === 'skip') void act('skip', { id: Number(t.dataset.id) });
        else if (t.dataset.act === 'reset') { if (window.confirm('Reset the challenge to $1,000 and wipe its ideas and history?')) void act('reset', {}); }
        else if (t.dataset.act === 'share') void share();
      });
    }
    return el;
  }
  function drawCurve(canvas, points, deposits) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600, h = 150;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!points || points.length < 2) { c.fillStyle = '#7fa3b3'; c.font = '700 11px ui-monospace,monospace'; c.fillText('The curve starts with the first trade.', 10, 20); return; }
    const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1, vals = points.map((p) => p.value);
    const lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
    const x = (t) => 8 + (w - 16) * ((t - t0) / Math.max(1, t1 - t0)), y = (v) => h - 8 - (h - 16) * ((v - lo) / Math.max(1e-9, hi - lo));
    let dep = 0; const steps = (deposits || []).slice().sort((a, b) => a.t - b.t);
    c.strokeStyle = '#2f5566'; c.setLineDash([3, 3]); c.beginPath(); let started = false;
    for (const p of points) { while (steps.length && steps[0].t <= p.t) dep += steps.shift().amount; const yy = y(Math.max(lo, Math.min(hi, dep))); if (!started) { c.moveTo(x(p.t), yy); started = true; } else c.lineTo(x(p.t), yy); }
    c.stroke(); c.setLineDash([]);
    c.strokeStyle = '#6be6ff'; c.lineWidth = 1.6; c.beginPath(); points.forEach((p, i) => { if (i) c.lineTo(x(p.t), y(p.value)); else c.moveTo(x(p.t), y(p.value)); }); c.stroke();
    c.fillStyle = '#9ad7ea'; c.font = '700 10px ui-monospace,monospace'; c.fillText('$' + Math.round(hi), 10, 12); c.fillText('$' + Math.round(lo), 10, h - 4);
  }
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
  function ideaHtml(i) {
    const status = i.status === 'new' ? 'NEW · expires ' + when(i.expiresAt) : i.status === 'taken' ? 'TAKEN @ ' + usd(i.fill) : i.status === 'closed' ? 'CLOSED · ' + esc(i.exitReason) + (i.realized != null ? ' · ' + usd(i.realized) : '') : i.status.toUpperCase();
    return '<div class="idea ' + esc(i.status) + '"><span class="st">' + status + '</span><b>BUY ' + esc(i.symbol)
      + '</b> · ' + esc(i.mode) + ' · grade ' + esc(i.grade) + ' ' + i.score + ' · ' + when(i.t)
      + '<div class="legs">' + i.qty + ' shares near ' + usd(i.entry) + ' (' + usd(i.notional) + ') · stop ' + usd(i.stop) + ' · risk ' + usd(i.riskDollars) + (i.target ? ' · target ' + usd(i.target) : '') + (i.trail ? ' · trails ' + i.trail + ' ATR' : '') + '</div>'
      + '<div class="why">' + esc(i.reason || '') + '</div>'
      + (i.status === 'new' && S.owner ? '<button type="button" data-act="take" data-id="' + i.id + '">TAKE IT</button><button type="button" class="skip" data-act="skip" data-id="' + i.id + '">SKIP</button>' : '') + '</div>';
  }
  function paint() {
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    const title = document.querySelector('.below-title');
    const others = ['earnings-panel', 'catalysts-panel', 'paper-panel'];
    if (!S.on) { const el = document.getElementById('challenge-panel'); if (el) el.style.display = 'none'; if (dock && !others.some((id) => { const x = document.getElementById(id); return x && x.style.display !== 'none'; })) dock.style.display = ''; if (title && S.prevTitle) { title.textContent = S.prevTitle; S.prevTitle = ''; } clearInterval(S.timer); S.timer = 0; return; }
    if (dock) dock.style.display = 'none';
    others.forEach((id) => { const x = document.getElementById(id); if (x) x.style.display = 'none'; });
    if (title && !S.prevTitle) { S.prevTitle = title.textContent; title.textContent = 'CHALLENGE · $1,000 → $100,000 · SIMULATED'; }
    if (!S.timer) S.timer = setInterval(() => { if (S.on && !document.hidden && !S.busy) { S.data = null; void load(); } }, 60_000);
    const el = panel(); el.style.display = '';
    if (!S.session) { el.innerHTML = '<h2>CHALLENGE</h2><p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; return; }
    if (!S.data && !S.err && !S.busy) void load();
    if (S.err && !S.data) { el.innerHTML = '<h2>CHALLENGE</h2><p class="note">' + esc(S.err) + '</p>'; return; }
    const d = S.data; if (!d) { el.innerHTML = '<h2>CHALLENGE</h2><p class="note">Loading…</p>'; return; }
    const s = d.paper.summary, r = d.rules;
    const kpi = (label, value, c) => '<div class="kpi"><span>' + label + '</span><b class="' + (c || '') + '">' + value + '</b></div>';
    const pending = d.ideas.filter((i) => i.status === 'new'), rest = d.ideas.filter((i) => i.status !== 'new');
    el.innerHTML = '<h2>' + esc(d.name) + '</h2><span class="sim">SIMULATED · NOT REAL MONEY · NOT ADVICE</span>' + (S.msg ? '<div class="msg">' + esc(S.msg) + '</div>' : '')
      + '<div class="kpis">' + kpi('ACCOUNT', usd(s.equity)) + kpi('PUT IN', usd(s.deposited, 0)) + kpi('RESULT', usd(s.pnl), cls(s.pnl)) + kpi('RETURN', pct(s.returnPct), cls(s.returnPct)) + kpi('CASH', usd(s.cash)) + kpi('TODAY', s.today && s.today.change != null ? usd(s.today.change) : '—', cls(s.today ? s.today.change : 0)) + kpi('OPEN', s.positions.length) + kpi('TRADES', s.closedTrades + (s.winRate != null ? ' · ' + s.winRate + '% won' : '')) + kpi('MAX DRAWDOWN', s.maxDrawdownPct + '%', s.maxDrawdownPct >= 10 ? 'dn' : '') + '</div>'
      + '<div>Progress to ' + usd(r.goal, 0) + ': <b>' + d.progressPct + '%</b></div><div class="bar"><i style="width:' + Math.max(0.5, d.progressPct) + '%"></i></div>'
      + '<canvas id="challenge-curve"></canvas>'
      + '<h3>IDEAS WAITING' + (pending.length ? ' (' + pending.length + ')' : '') + '</h3>' + (pending.length ? pending.map(ideaHtml).join('') : '<p class="note">None right now. MEM ALGO is scanning every five minutes in market hours; an idea needs the full confluence to score ' + r.minScore + '+.</p>')
      + '<h3>OPEN POSITIONS</h3>' + (s.positions.length ? '<table><thead><tr><th>Ticker</th><th>Qty</th><th>Entry</th><th>Price</th><th>Stop</th><th>Target</th><th>P&amp;L</th><th>Grade</th></tr></thead><tbody>' + s.positions.map((p) => { const o = (d.open || []).find((x) => x.symbol === p.symbol) || {}; return '<tr><td>' + esc(p.symbol) + '</td><td>' + p.qty + '</td><td>' + usd(p.avg) + '</td><td>' + usd(p.mark) + '</td><td>' + (o.stop ? usd(o.stop) : '—') + '</td><td>' + (o.target ? usd(o.target) : '—') + '</td><td class="' + cls(p.pnl) + '">' + usd(p.pnl) + (p.pnlPct != null ? ' (' + pct(p.pnlPct) + ')' : '') + '</td><td>' + (o.grade ? esc(o.grade) + ' ' + o.score : '—') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="note">Flat.</p>')
      + '<h3>IDEA HISTORY</h3>' + (rest.length ? rest.slice(0, 12).map(ideaHtml).join('') : '<p class="note">No ideas yet.</p>')
      + '<h3>JOURNAL</h3><div class="log">' + (d.log.length ? d.log.map((l) => '<div>' + when(l.t) + ' · ' + esc(l.text) + '</div>').join('') : '<div>Waiting for the first market-hours scan.</div>') + '</div>'
      + '<h3>THE RULES</h3><ul><li>Starts with ' + usd(d.paper.summary.deposited ? d.paper.deposits[d.paper.deposits.length - 1].amount : 1000, 0) + '; ' + usd(r.weeklyDeposit, 0) + ' added on the first open day of every week.</li><li>MEM ALGO raises an idea only when the full confluence scores ' + r.minScore + '+ (grade A, or a strong B); nothing is bought until the owner clicks TAKE IT.</li><li>Each idea is sized so the stop costs ' + (r.riskPerTrade.swing * 100) + '% of the account (' + (r.riskPerTrade.day * 100) + '% for day trades); at most ' + r.maxPositions + ' names and ' + (r.maxPositionPct * 100) + '% of the account in one; no borrowing, no shorting.</li><li>No ideas on names reporting earnings within ' + r.earningsBlackoutDays + ' days, or when the market read is below ' + r.noNewLongsBelowBias + '.</li><li>Taken ideas are managed by the engine: stop (gap-aware), target, trailing stop, max hold, the day session\'s close, or MEM ALGO\'s own exit signal, sold in the paper account at the real bid.</li><li>Ideas not taken expire (' + Math.round((r.ideaTtlMs ? r.ideaTtlMs.day : 7200000) / 3600000) + ' h for day trades, 2 days for swings).</li></ul>'
      + (S.owner ? '<button type="button" class="share" data-act="share">Post the card to the Discord channel</button><button type="button" class="reset" data-act="reset">Reset challenge (owner)</button>' : '')
      + '<p class="note">' + esc(d.disclaimer) + ' Last scan ' + when(d.lastTick) + '. Trade the account by hand in PAPER TRADE → CHALLENGE.</p>';
    const cv = document.getElementById('challenge-curve'); if (cv) drawCurve(cv, d.paper.equity, d.paper.deposits);
  }
  const sync = () => btn.classList.toggle('on', S.on);
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.data = null; S.msg = ''; if (S.session) void load(); } paint(); });
  sync(); startPoll();
  (function boot(tries) { if (S.on && !document.getElementById('options-dock') && !document.getElementById('options-chain') && tries < 60) { setTimeout(() => boot(tries + 1), 200); return; } paint(); })(0);
})();
