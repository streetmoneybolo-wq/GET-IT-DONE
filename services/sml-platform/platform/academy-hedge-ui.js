/* Academy: HEDGE & INCOME. Options ideas for the position on the chart: protect it (protective put, put spread, collar), earn on it
 * (covered call, cash-secured put) or one directional contract, ranked by MEM ALGO's read. Server: GET /academy-activity/hedge (academy-hedge.js).
 * Shown under the chart while MEM ALGO is on, or from the "Hedge & income ideas" button in the MEM ALGO panel. Educational only. */
(() => {
  if (window.__smlAcademyHedge) return;
  window.__smlAcademyHedge = 1;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const px = (v) => (fin(v) ? '$' + v.toFixed(2) : '–');
  const usd = (v) => (fin(v) ? (v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2)) : '–');
  const pct = (v, d = 1) => (fin(v) ? (v * 100).toFixed(d) + '%' : '–');
  const dshort = (e) => { const t = Date.parse(e + 'T12:00:00Z'); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : e; };
  const chartSymbol = () => { try { const s = window.smlAcademyChartState && window.smlAcademyChartState().symbol; if (s) return String(s).toUpperCase(); } catch (_) { /* fall back */ } return String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); };
  const memState = () => { try { return typeof window.smlMemAlgoState === 'function' ? window.smlMemAlgoState() : null; } catch (_) { return null; } };
  const popout = () => document.documentElement.classList.contains('sml-popout');

  const css = document.createElement('style');
  css.textContent = '#academy-hedge{display:none;border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dbe7ec;font:500 12px/1.45 system-ui,sans-serif;margin:10px 0;overflow:hidden;position:relative}#academy-hedge.show{display:block}'
    + '.ahg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 64px 9px 12px;border-bottom:1px solid #1b3540}.ahg-head b{font:900 12px ui-monospace,monospace;letter-spacing:.08em;color:#52e6ad}.ahg-head span{color:#8fa6b3}.ahg-head small{margin-left:auto;color:#7b93a0;font:700 10px ui-monospace,monospace}'
    + '.ahg-x{position:absolute;top:6px;right:34px;background:none;border:0;color:#7f98a6;font-size:17px;cursor:pointer;line-height:1}'
    + '.ahg-form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:9px 12px;border-bottom:1px solid #13262f}.ahg-form label{display:flex;flex-direction:column;gap:3px;font:800 9.5px ui-monospace,monospace;letter-spacing:.07em;color:#7f98a6;text-transform:uppercase}'
    + '.ahg-form input,.ahg-form select{width:86px;box-sizing:border-box;padding:6px 7px;border:1px solid #23495a;border-radius:7px;background:#07111a;color:#eaf3f6;font:600 12px ui-monospace,monospace}.ahg-form button{padding:7px 12px;border:1px solid #00c47d;border-radius:7px;background:#0d2a20;color:#7ef0bd;font:800 11px system-ui;cursor:pointer}'
    + '.ahg-ctx{padding:8px 12px;border-bottom:1px solid #13262f;color:#b8c9d3;font-size:11.5px}.ahg-ctx i{font-style:normal;display:inline-block;padding:2px 8px;margin-right:6px;border-radius:999px;font:800 10px ui-monospace,monospace;letter-spacing:.05em}.ahg-ctx i.hedge{background:#3a2a12;color:#ffcf7a}.ahg-ctx i.income{background:#0d3a2a;color:#3ef0a8}.ahg-ctx small{display:block;color:#7b93a0;margin-top:3px}'
    + '.ahg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px;padding:10px 12px}'
    + '.ahg-card{border:1px solid #1b3540;border-radius:9px;background:#0b141c;padding:9px 10px;display:flex;flex-direction:column;gap:6px;min-width:0}.ahg-card.top{border-color:#00c47d}'
    + '.ahg-t{display:flex;align-items:center;gap:6px}.ahg-t b{font:800 12.5px system-ui;color:#eaf5f8}.ahg-t em{font-style:normal;font:800 9px ui-monospace,monospace;letter-spacing:.06em;color:#7b93a0;text-transform:uppercase}'
    + '.ahg-score{margin-left:auto;padding:2px 8px;border-radius:999px;font:900 11px ui-monospace,monospace}.ahg-score.hi{background:#0d3a2a;color:#3ef0a8}.ahg-score.mid{background:#2e2410;color:#ffcf7a}.ahg-score.lo{background:#2a1a20;color:#ff9aa4}'
    + '.ahg-legs{font:600 11px ui-monospace,monospace;color:#cfe3ea}.ahg-legs div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ahg-legs .s{color:#ffb3bf}.ahg-legs .b{color:#9fe8c8}'
    + '.ahg-kv{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:11px}.ahg-kv span{color:#7f98a6}.ahg-kv b{font:800 11.5px ui-monospace,monospace;color:#eaf3f6;text-align:right}.ahg-kv b.pos{color:#3ef0a8}.ahg-kv b.neg{color:#ff8a9c}'
    + '.ahg-greeks{display:flex;flex-wrap:wrap;gap:4px;font:700 10px ui-monospace,monospace;color:#9fb3be}.ahg-greeks span{padding:2px 6px;border:1px solid #16303a;border-radius:5px;background:#07111a}'
    + '.ahg-liq{padding:2px 7px;border-radius:5px;font:800 10px ui-monospace,monospace}.ahg-liq.A{background:#0d3a2a;color:#3ef0a8}.ahg-liq.B{background:#16303a;color:#9fd3e8}.ahg-liq.C{background:#2e2410;color:#ffcf7a}'
    + '.ahg-why{color:#c3d3db;font-size:11.5px}.ahg-when{color:#8fa6b3;font-size:10.5px}.ahg-card svg{width:100%;height:96px;display:block;border:1px solid #13262f;border-radius:7px;background:#07111a}'
    + '.ahg-msg{padding:16px 12px;color:#8fa6b3;text-align:center}.ahg-notes{padding:0 12px 6px;color:#ffcf7a;font-size:11px}.ahg-foot{padding:8px 12px;border-top:1px solid #13262f;color:#5f7784;font-size:10.5px}'
    + '@media(max-width:700px){.ahg-grid{grid-template-columns:1fr;padding:8px}.ahg-form{gap:6px}.ahg-form input,.ahg-form select{width:74px}.ahg-head small{margin-left:0;width:100%}}';
  document.head.appendChild(css);

  const S = { forced: false, dismissed: false, data: null, msg: 'Loading options…', busy: false, sym: '', over: {}, shares: 100, side: '', timer: 0, memKey: '' };
  let root = null, body = null;
  try { const v = Number(localStorage.getItem('sml-hedge-shares')); if (v > 0) S.shares = Math.min(1e6, Math.round(v)); } catch (_) { /* storage blocked */ }

  const visible = () => popout() || (!S.dismissed && (S.forced || !!(memState() || {}).on));
  function show() {
    if (!root) return;
    const v = visible();
    root.classList.toggle('show', v);
    if (!v || S.busy) return;
    const stale = S.data ? Date.now() - (S.data.asOf || 0) > 60000 : Date.now() - (S.tried || 0) > 15000; // a failed load is retried every 15 s, not every tick
    if (S.sym !== chartSymbol() || stale) load();
  }

  /* profit / loss at expiry for one idea at stock price s (same rules as the server's payoffAt) */
  function payoff(idea, s) {
    let pl = 0;
    if (idea.withStock) pl += (idea.side === 'short' ? -1 : 1) * (s - idea.entry) * idea.shares;
    for (const l of idea.legs) { const intr = l.type === 'call' ? Math.max(0, s - l.strike) : Math.max(0, l.strike - s); pl += (l.action === 'buy' ? intr - l.mid : l.mid - intr) * 100 * l.contracts; }
    return pl;
  }
  function sketch(idea, d) {
    const L = d.levels || {}, P = d.price, marks = [P, L.entry, L.target, L.stop].concat(idea.legs.map((l) => l.strike)).filter(fin);
    let lo = Math.min(...marks), hi = Math.max(...marks); const pad = (hi - lo) * 0.25 + P * 0.03; lo = Math.max(0.01, lo - pad); hi += pad;
    const W = 300, H = 96, n = 64, xs = [], ys = [];
    for (let i = 0; i <= n; i++) { const s = lo + ((hi - lo) * i) / n; xs.push(s); ys.push(payoff(idea, s)); }
    let yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys); if (yMax - yMin < 1) { yMax += 1; yMin -= 1; } const yp = (yMax - yMin) * 0.12; yMin -= yp; yMax += yp;
    const X = (s) => ((s - lo) / (hi - lo)) * W, Y = (v) => H - ((v - yMin) / (yMax - yMin)) * H, z = Y(0);
    const line = xs.map((s, i) => (i ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(ys[i]).toFixed(1)).join(' ');
    const area = line + ' L' + W + ' ' + z.toFixed(1) + ' L0 ' + z.toFixed(1) + ' Z';
    const id = 'ahg' + Math.random().toString(36).slice(2, 8);
    const vline = (v, color, label, dy) => (fin(v) && v > lo && v < hi ? '<line x1="' + X(v).toFixed(1) + '" x2="' + X(v).toFixed(1) + '" y1="0" y2="' + H + '" stroke="' + color + '" stroke-dasharray="3 3" stroke-width="1"/><text x="' + Math.min(W - 2, X(v) + 2).toFixed(1) + '" y="' + dy + '" fill="' + color + '" font-size="8" font-family="ui-monospace,monospace" font-weight="700">' + label + '</text>' : '');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Profit or loss at expiry for ' + esc(idea.name) + '">'
      + '<defs><clipPath id="' + id + 'u"><rect x="0" y="0" width="' + W + '" height="' + z.toFixed(1) + '"/></clipPath><clipPath id="' + id + 'd"><rect x="0" y="' + z.toFixed(1) + '" width="' + W + '" height="' + (H - z).toFixed(1) + '"/></clipPath></defs>'
      + '<path d="' + area + '" fill="rgba(0,196,125,.22)" clip-path="url(#' + id + 'u)"/><path d="' + area + '" fill="rgba(255,93,108,.2)" clip-path="url(#' + id + 'd)"/>'
      + '<line x1="0" x2="' + W + '" y1="' + z.toFixed(1) + '" y2="' + z.toFixed(1) + '" stroke="#3f6070" stroke-width="1"/>'
      + vline(L.stop, '#ff5d6c', 'STOP', 9) + vline(L.entry, '#9fb3be', 'ENTRY', 18) + vline(L.target, '#00c47d', 'TARGET', 27)
      + '<path d="' + line + '" fill="none" stroke="#e8f4f8" stroke-width="1.6" vector-effect="non-scaling-stroke"/>'
      + (fin(P) ? '<circle cx="' + X(P).toFixed(1) + '" cy="' + Y(payoff(idea, P)).toFixed(1) + '" r="2.6" fill="#ffd166"/>' : '')
      + '</svg>';
  }
  function card(idea, d, i) {
    const sc = idea.score >= 70 ? 'hi' : idea.score >= 45 ? 'mid' : 'lo';
    const net = idea.net || {}, credit = net.type === 'credit';
    const kv = [];
    kv.push([credit ? 'Credit / contract' : 'Cost / contract', '<b class="' + (credit ? 'pos' : '') + '">' + usd(net.perContract) + '</b>']);
    if (idea.contracts > 1) kv.push([credit ? 'Total credit' : 'Total cost', '<b class="' + (credit ? 'pos' : '') + '">' + usd(net.total) + '</b>']);
    if (fin(idea.costPctOfPosition)) kv.push(['Cost vs position', '<b>' + pct(Math.abs(idea.costPctOfPosition), 2) + '</b>']);
    if (fin(idea.protectedBelow)) kv.push(['Protected below', '<b>' + px(idea.protectedBelow) + '</b>']);
    if (fin(idea.protectedAbove)) kv.push(['Protected above', '<b>' + px(idea.protectedAbove) + '</b>']);
    if (fin(idea.protectionEnds)) kv.push(['Cover ends at', '<b>' + px(idea.protectionEnds) + '</b>']);
    if (fin(idea.cappedAt)) kv.push(['Upside capped at', '<b>' + px(idea.cappedAt) + '</b>']);
    if (idea.yield) { kv.push(['Yield (' + idea.yield.days + 'd)', '<b class="pos">' + pct(idea.yield.period, 2) + '</b>']); kv.push(['Annualized', '<b class="pos">' + pct(idea.yield.annualized, 0) + '</b>']); }
    if (fin(idea.probWorthless)) kv.push(['Expires worthless ≈', '<b>' + pct(idea.probWorthless, 0) + '</b>']);
    if (fin(idea.cashSecured)) kv.push(['Cash secured', '<b>' + usd(idea.cashSecured) + '</b>']);
    if (fin(idea.effectivePrice)) kv.push(['Own it at', '<b>' + px(idea.effectivePrice) + '</b>']);
    if (idea.maxLoss && fin(idea.maxLoss.total)) kv.push(['Max loss', '<b class="neg">' + usd(-idea.maxLoss.total) + '</b>']);
    if (idea.maxGain && fin(idea.maxGain.total)) kv.push(['Max gain', '<b class="pos">' + usd(idea.maxGain.total) + '</b>']);
    if (idea.maxPayout && fin(idea.maxPayout.total)) kv.push(['Max payout', '<b class="pos">' + usd(idea.maxPayout.total) + '</b>']);
    if ((idea.breakevens || []).length) kv.push(['Break-even', '<b>' + idea.breakevens.slice(0, 2).map(px).join(' / ') + '</b>']);
    if (fin(idea.thetaPerDay)) kv.push(['Theta / day', '<b class="' + (idea.thetaPerDay >= 0 ? 'pos' : 'neg') + '">' + usd(idea.thetaPerDay) + '</b>']);
    const g = idea.greeks || {}, l0 = idea.legs[0] || {};
    return '<article class="ahg-card' + (i === 0 ? ' top' : '') + '"><div class="ahg-t"><b>' + esc(idea.name) + '</b><em>' + esc(idea.group) + '</em><span class="ahg-score ' + sc + '" title="Fit score 0-100 for this position and MEM ALGO read">' + esc(idea.score) + '</span></div>'
      + '<div class="ahg-legs">' + idea.legs.map((l) => '<div class="' + (l.action === 'sell' ? 's' : 'b') + '">' + esc(l.action === 'buy' ? 'BUY' : 'SELL') + ' ' + esc(l.contracts) + ' × ' + esc(dshort(l.expiry)) + ' ' + esc(px(l.strike)) + ' ' + esc(String(l.type).toUpperCase()) + ' · ' + esc(l.dte) + 'd · mid ' + esc(px(l.mid)) + '</div>').join('') + '</div>'
      + '<div class="ahg-kv">' + kv.map(([k, v]) => '<span>' + esc(k) + '</span>' + v).join('') + '</div>'
      + '<div class="ahg-greeks"><span>Δ ' + esc(fin(g.delta) ? g.delta : '–') + '</span><span>Γ ' + esc(fin(g.gamma) ? g.gamma : '–') + '</span><span>Θ ' + esc(fin(g.theta) ? g.theta : '–') + '</span><span>V ' + esc(fin(g.vega) ? g.vega : '–') + '</span>' + (fin(l0.iv) ? '<span>IV ' + esc((l0.iv * 100).toFixed(0)) + '%</span>' : '') + '<span class="ahg-liq ' + esc(idea.liquidity.grade) + '" title="Worst bid/ask spread ' + esc(pct(idea.liquidity.worstSpreadPct, 1)) + ', lowest open interest ' + esc(idea.liquidity.minOi) + '">' + esc(idea.liquidity.grade) + ' · ' + esc(idea.liquidity.label) + '</span></div>'
      + sketch(idea, d)
      + '<div class="ahg-why">' + esc(idea.why) + '</div><div class="ahg-when"><b>When it fits:</b> ' + esc(idea.whenToUse) + '</div></article>';
  }
  function paint() {
    if (!body) return;
    const d = S.data, ms = memState() || {};
    const head = '<div class="ahg-head"><b>HEDGE &amp; INCOME</b><span>$' + esc(S.sym || chartSymbol()) + (ms.on ? ' · MEM ALGO ' + esc(ms.label) : '') + '</span><small>' + (d && d.asOf ? 'updated ' + new Date(d.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') + '</small></div>'
      + (popout() ? '' : '<button type="button" class="ahg-x" data-ahg="close" aria-label="Hide hedge and income ideas">×</button>');
    const L = (d && d.levels) || {};
    const val = (k) => (S.over[k] != null ? S.over[k] : fin(L[k]) ? L[k] : '');
    const side = S.side || (ms.mode === 'short' ? 'short' : 'long');
    const form = '<form class="ahg-form" data-ahg="form"><label>Shares<input name="shares" type="number" min="1" step="1" inputmode="numeric" value="' + esc(S.shares) + '"></label>'
      + '<label>Entry<input name="entry" type="number" step="any" inputmode="decimal" value="' + esc(val('entry')) + '"></label>'
      + '<label>Target<input name="target" type="number" step="any" inputmode="decimal" value="' + esc(val('target')) + '"></label>'
      + '<label>Stop<input name="stop" type="number" step="any" inputmode="decimal" value="' + esc(val('stop')) + '"></label>'
      + '<label>Position<select name="side"><option value="long"' + (side === 'long' ? ' selected' : '') + '>Long</option><option value="short"' + (side === 'short' ? ' selected' : '') + '>Short</option></select></label>'
      + '<button type="submit">Update</button></form>';
    let html = head + form;
    if (!d || !d.ok) html += '<div class="ahg-msg">' + esc(S.msg) + '</div>';
    else {
      const src = L.source === 'alert' ? 'levels from your alert desk' : L.source === 'atr' ? 'levels from MEM ALGO-style ATR (no alert on this ticker)' : 'your levels';
      html += '<div class="ahg-ctx"><i class="' + (d.lean.mode === 'hedge-first' ? 'hedge' : 'income') + '">' + (d.lean.mode === 'hedge-first' ? 'HEDGES FIRST' : 'INCOME FIRST') + '</i>' + esc(d.lean.reason)
        + '<small>Price ' + esc(px(d.price)) + ' · entry ' + esc(px(L.entry)) + ' · target ' + esc(px(L.target)) + ' · stop ' + esc(px(L.stop)) + ' · ' + esc(src) + ' · ' + esc(d.contracts) + ' contract' + (d.contracts > 1 ? 's' : '') + '</small></div>';
      if ((d.notes || []).length) html += '<div class="ahg-notes" style="padding-top:6px">' + d.notes.map(esc).join('<br>') + '</div>';
      html += d.ideas.length ? '<div class="ahg-grid">' + d.ideas.map((x, i) => card(x, d, i)).join('') + '</div>' : '<div class="ahg-msg">No contract in the loaded chain is liquid enough, or close enough to these levels, to suggest anything sensible right now.</div>';
      html += '<div class="ahg-foot">' + esc(d.disclaimer) + ' Chart: profit or loss at expiry across prices, with your entry, target and stop marked; the yellow dot is today’s price.</div>';
    }
    const focus = document.activeElement && body.contains(document.activeElement) && document.activeElement.name ? document.activeElement.name : '';
    if (focus) return; // never rebuild the form under someone typing in it
    body.innerHTML = html;
  }

  async function load() {
    clearTimeout(S.timer);
    const sym = chartSymbol();
    if (!visible()) return;
    S.tried = Date.now();
    if (document.hidden && S.data && S.sym === sym) { S.timer = setTimeout(load, 15000); return; }
    let token = window.smlAcademySessionToken;
    if (sym !== S.sym) { S.sym = sym; S.over = {}; S.data = null; S.msg = 'Loading options for $' + sym + '…'; paint(); }
    if (!token) { S.msg = 'Sign in to the Academy to see hedge and income ideas.'; paint(); S.timer = setTimeout(load, 5000); return; }
    const ms = memState() || {};
    const q = new URLSearchParams({ symbol: sym, shares: String(S.shares), horizon: ms.mode || 'swing', side: S.side || (ms.mode === 'short' ? 'short' : 'long') });
    if (ms.on) { q.set('dir', ms.dir || 'neutral'); q.set('strength', String(ms.strength == null ? 50 : ms.strength)); }
    ['entry', 'target', 'stop'].forEach((k) => { if (S.over[k] > 0) q.set(k, String(S.over[k])); });
    S.busy = true;
    try {
      const url = '/academy-activity/hedge?' + q.toString();
      let res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { token = await window.smlAcademyReauth(); if (token) res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' }); }
      const j = await res.json().catch(() => null);
      if (sym !== chartSymbol()) { S.busy = false; return load(); }
      if (j && j.ok) S.data = j;
      else { S.data = null; S.msg = (j && j.message) || (res.status === 403 ? 'Hedge & income ideas are part of the full Academy.' : 'Options ideas are not available right now. Trying again shortly.'); }
    } catch (_) { S.data = null; S.msg = 'Options ideas are not available right now. Trying again shortly.'; }
    S.busy = false;
    paint();
    S.timer = setTimeout(load, 60000);
  }

  (function mount() {
    const host = document.getElementById('academy-below');
    if (!host) { setTimeout(mount, 300); return; }
    root = document.createElement('section'); root.id = 'academy-hedge'; root.setAttribute('aria-label', 'Hedge and income ideas');
    body = document.createElement('div'); root.appendChild(body);
    const t = host.querySelector('.below-title'); host.insertBefore(root, t ? t.nextSibling : host.firstChild);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ahg="close"]'); if (!b) return;
      S.dismissed = true; S.forced = false; show();
    });
    root.addEventListener('submit', (e) => {
      const f = e.target.closest('[data-ahg="form"]'); if (!f) return;
      e.preventDefault();
      const v = (n) => { const x = Number(f.elements[n] && f.elements[n].value); return Number.isFinite(x) && x > 0 ? x : null; };
      S.shares = Math.min(1e6, Math.max(1, Math.round(v('shares') || 100)));
      try { localStorage.setItem('sml-hedge-shares', String(S.shares)); } catch (_) { /* storage blocked */ }
      const L = (S.data && S.data.levels) || {};
      ['entry', 'target', 'stop'].forEach((k) => { const x = v(k); if (x == null) delete S.over[k]; else if (S.over[k] != null || !fin(L[k]) || Math.abs(x - L[k]) > 1e-6) S.over[k] = x; });
      S.side = f.elements.side ? f.elements.side.value : '';
      if (document.activeElement && f.contains(document.activeElement)) document.activeElement.blur();
      load();
    });
    paint(); show();
  })();

  window.smlHedgePanel = {
    open() { S.forced = true; S.dismissed = false; show(); if (root) { load(); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    close() { S.forced = false; S.dismissed = true; show(); }
  };
  window.addEventListener('sml-mem-algo-state', (e) => {
    const s = (e && e.detail) || memState() || {};
    const key = [s.on, s.mode, s.dir, s.strength].join('|');
    if (s.on && S.memKey.split('|')[0] !== 'true') S.dismissed = false; // turning MEM ALGO on shows the panel again
    const changed = key !== S.memKey; S.memKey = key;
    show();
    if (changed && visible() && S.data && !S.busy) { clearTimeout(S.reloadSoon); S.reloadSoon = setTimeout(load, 600); }
  });
  window.addEventListener('sml-academy-market', () => { if (visible()) setTimeout(load, 400); });
  window.addEventListener('sml-academy-session', () => { if (visible()) load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible() && S.data && Date.now() - (S.data.asOf || 0) > 60000) load(); });
  setInterval(show, 1500); // catches a symbol change that did not fire the market event, MEM ALGO switched on before this loaded, and pop-out mode
})();
