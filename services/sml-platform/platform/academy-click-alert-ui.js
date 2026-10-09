/* Click-to-Alert for the Academy Live Chart Lab (a separate paid add-on).
   Turn it on and choose what you are alerting. STOCK: click a price on the chart; the entry is locked to the live price at that moment and the clicked price
   is the target. OPTION: pick call or put, the expiration and the strike right here (no need to open the chain); the target comes from the contract and a chart
   click can still override it. Either way the Academy's data picks the horizon (day / swing / mid / long), checks the next earnings date and this week's news
   against the alert's window, shows why, and lets the member post the alert, in GrandMaster-Obi's layout, to a Discord channel they can post in.
   The server decides everything that matters (entitlement, the live price, the horizon, the catalyst check, permissions); this panel only shows it.
   Educational: nothing here places a trade. */
(function boot(tries) {
  if (window.__smlClickAlertUi) return;
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar') || !document.getElementById('chart')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlClickAlertUi = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar'), canvas = $('chart'), stage = document.querySelector('.academy-chart-stage');
  const KEY = 'sml-click-alert-dest';
  const S = { asMe: true, on: false, busy: false, target: null, entry: null, side: null, data: null, status: null, guilds: [], channels: [], guildId: '', channelId: '', pingPref: true, images: true, scn: null, msg: '', msgTone: '', sent: false, symbol: '', contract: null, opt: null, mode: 'auto', smashedFor: '', optMode: false, autoTarget: false, symNote: '', kind: '', pick: { type: '', expiry: '', strike: '' }, chain: null, chainBusy: false, chainErr: '', cat: null };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.guildId = String(v.guildId || ''); S.channelId = String(v.channelId || ''); } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ guildId: S.guildId, channelId: S.channelId })); } catch (_) { /* ignore */ } };

  const css = document.createElement('style');
  css.textContent = '#click-alert-toggle{margin-left:4px;padding:5px 9px;border:1px solid #1f8a5f;border-radius:7px;background:#0b2219;color:#7dffc4;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#click-alert-toggle.on{background:#00c47d;border-color:#7dffc4;color:#032318}'
    + '#ca-layer{position:absolute;pointer-events:none;z-index:5;background:transparent;border:0;min-height:0;max-width:none}'
    + '.ca-armed #chart{cursor:crosshair!important}'
    + '#ca-hint{position:absolute;left:50%;top:8px;transform:translateX(-50%);z-index:8;padding:6px 12px;border-radius:999px;background:rgba(3,34,24,.94);border:1px solid #1f8a5f;color:#a8ffd8;font:700 .66rem system-ui,sans-serif;pointer-events:none;white-space:nowrap}'
    + '#ca-panel{position:fixed;right:12px;bottom:12px;z-index:2147483250;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:rgba(7,13,20,.98);border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.65);color:#dbe6ec;font:600 .68rem/1.42 system-ui,sans-serif}'
    + '#ca-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #16382b;background:#0a1d16}#ca-panel header b{font:800 .72rem ui-monospace,monospace;color:#7dffc4;letter-spacing:.06em}#ca-panel header button{margin-left:auto;border:0;background:transparent;color:#9fb3be;font:800 .9rem system-ui;cursor:pointer}'
    + '#ca-panel .body{padding:10px 12px}#ca-panel .row{display:flex;justify-content:space-between;gap:10px;padding:2px 0}#ca-panel .row span{color:#7f95a1}#ca-panel .row b{color:#eaf3f7}'
    + '#ca-panel .hz{margin:8px 0;padding:9px 10px;border-radius:9px;background:#0d2a20;border:1px solid #1f8a5f}#ca-panel .hz b{display:block;font:800 .95rem system-ui;color:#7dffc4}#ca-panel .hz span{color:#a8c2b8;font-weight:600}'
    + '#ca-panel ul{list-style:none;margin:6px 0;padding:0}#ca-panel li{margin:0 0 4px;padding-left:9px;border-left:3px solid #2c4a56;color:#c1cfd7;font-weight:500}'
    + '#ca-panel pre{margin:6px 0;padding:8px;border-radius:8px;background:#05090e;border:1px solid #1b2a35;color:#dfe9ee;font:500 .62rem/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto}'
    + '#ca-panel select,#ca-panel button.act{width:100%;margin:3px 0;padding:7px 8px;border-radius:8px;border:1px solid #2a4a58;background:#0d1a24;color:#e6eef2;font:700 .68rem system-ui,sans-serif}#ca-panel button.act{background:#00c47d;border-color:#7dffc4;color:#032318;font-weight:900;cursor:pointer}#ca-panel button.act:disabled{opacity:.5;cursor:not-allowed}'
    + '#ca-panel label.chk{display:flex;gap:6px;align-items:center;margin:4px 0;color:#b9c8d1}#ca-panel .msg{margin:6px 0;padding:7px 9px;border-radius:8px;font-weight:700}#ca-panel .msg.err{background:#2a1118;border:1px solid #6b2234;color:#ffb3c0}#ca-panel .msg.ok{background:#0d2a20;border:1px solid #1f8a5f;color:#a8ffd8}#ca-panel .msg.info{background:#101c28;border:1px solid #2a4a58;color:#c1d5e0}'
    + '#ca-panel .scn{margin:8px 0}#ca-panel .scn img{display:block;width:100%;border-radius:8px;border:1px solid #1b2a35;margin:0 0 6px;background:#070d14}#ca-panel .scn h6{margin:0 0 4px;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;color:#7dffc4}'
    + '#ca-panel .prevhead{margin:10px 0 4px;color:#7f95a1;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em}#ca-panel .dprev{background:#313338;border-radius:8px;padding:10px 12px;color:#dbdee1;font:400 .7rem/1.4 system-ui,sans-serif}#ca-panel .dwho{display:flex;align-items:center;gap:6px;margin-bottom:4px}#ca-panel .dav{width:22px;height:22px;border-radius:50%;background:#5865f2;color:#fff;font:800 .62rem/22px system-ui;text-align:center}#ca-panel .dwho b{color:#fff;font-size:.72rem}#ca-panel .dwho i{font:800 .5rem system-ui;font-style:normal;background:#5865f2;color:#fff;border-radius:3px;padding:1px 4px}#ca-panel .dwho time{color:#949ba4;font-size:.56rem}#ca-panel .dbody{white-space:pre-wrap;word-break:break-word}#ca-panel .dbody .mn{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:3px;padding:0 2px}#ca-panel .dpics{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}#ca-panel .dpics figure{margin:0}#ca-panel .dpics img{width:100%;border-radius:6px;border:1px solid #1e1f22;display:block}#ca-panel .dpics figcaption{color:#00a8fc;font-size:.52rem;margin-top:2px}#ca-panel .prevto{margin:6px 0;color:#b9c8d1;font-size:.64rem}#ca-panel small{display:block;margin-top:6px;color:#6f8794;font-weight:500;font-size:.56rem}#ca-panel .seg{display:flex;gap:6px;margin:6px 0}#ca-panel .seg button{flex:1;padding:9px 6px;border:1px solid #2a4a58;border-radius:9px;background:#0d1a24;color:#dbe6ec;font:800 .7rem system-ui,sans-serif;cursor:pointer}#ca-panel .seg button.on{background:#0d2a20;border-color:#7dffc4;color:#7dffc4}#ca-panel .seg button.put.on{background:#2a1118;border-color:#ff6b86;color:#ffb3c0}#ca-panel .pick{margin:6px 0 2px;padding:9px 10px;border-radius:9px;background:#0a1a24;border:1px solid #1e3a4a}#ca-panel .pick b{display:block;margin-bottom:4px;color:#eaf3f7;font:800 .7rem system-ui}#ca-panel .pick h6{margin:8px 0 2px;color:#7f95a1;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em}#ca-panel .cat{margin:8px 0;padding:9px 10px;border-radius:9px;border:1px solid #2a4a58;background:#0b1620}#ca-panel .cat.supports{border-color:#1f8a5f;background:#0d2a20}#ca-panel .cat.caution{border-color:#6a4a1a;background:#211609}#ca-panel .cat.against{border-color:#6b2234;background:#2a1118}#ca-panel .cat h6{margin:0 0 4px;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em;color:#7f95a1}#ca-panel .cat b.v{display:block;font:800 .74rem system-ui;color:#eaf3f7;margin-bottom:4px}#ca-panel .cat .chip{display:inline-block;padding:1px 6px;border-radius:999px;font:800 .54rem ui-monospace,monospace;letter-spacing:.06em;margin-right:4px}#ca-panel .cat .chip.up{background:#12362b;color:#7dffc4}#ca-panel .cat .chip.down{background:#3a1420;color:#ffb3c0}#ca-panel .cat .chip.flat{background:#1b2a35;color:#b9c8d1}#ca-panel .cat li a{color:#9fd3ff;text-decoration:none}@media(max-width:700px){#ca-panel{left:8px;right:8px;bottom:8px;width:auto;max-height:78vh}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'click-alert-toggle'; btn.textContent = 'ALERT'; btn.title = 'Click-to-Alert: click a price on the chart to set the target, then post the alert to Discord'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'ca-layer'; const ctx = layer.getContext('2d');
  const hint = document.createElement('div'); hint.id = 'ca-hint'; hint.style.display = 'none'; hint.textContent = 'Stock alert: click a price on the chart to set your target. Entry is the live price.';
  const panel = document.createElement('aside'); panel.id = 'ca-panel'; panel.style.display = 'none'; document.body.appendChild(panel);

  const token = () => String(window.smlAcademySessionToken || '');
  const sym = () => { const M = window.smlChartModel && window.smlChartModel(); return M ? M.symbol : String(($('symbol') || {}).value || 'SPY').toUpperCase(); };
  /* The Academy session lasts 15 minutes and browsers pause a hidden window, so it is often expired when you come back. Renew it quietly (the same Discord sign-in the
     Activity already did, no prompt) instead of telling the member to sign in again, and retry the request once. */
  let renewing = null, lastSessionAt = Date.now();
  window.addEventListener('sml-academy-session', () => { lastSessionAt = Date.now(); });
  function renew() {
    if (!renewing) {
      renewing = Promise.resolve(typeof window.smlAcademyReauth === 'function' ? window.smlAcademyReauth() : '').catch(() => '').then((t) => { renewing = null; return t; });
    }
    return renewing;
  }
  async function raw(path, body) {
    const t = token();
    const res = await fetch('/academy-activity/click-alert/' + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ authorization: 'Bearer ' + t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let json = null; try { json = await res.json(); } catch (_) { json = null; }
    return Object.assign({ status: res.status }, json || { ok: false, error: 'bad_response' });
  }
  async function api(path, body) {
    if (!token()) { await renew(); if (!token()) return { ok: false, status: 401, error: 'authorization_required' }; }
    let r = await raw(path, body);
    if (r.status === 401) {
      const fresh = await renew();
      if (fresh || token()) r = await raw(path, body);
    }
    return r;
  }
  /* coming back to the window: renew an old session before anything is asked of it */
  async function wake() {
    if (!S.on || document.hidden) return;
    if (!token() || Date.now() - lastSessionAt > 8 * 60_000) await renew();
    if (S.on && token()) { await loadStatus(); if (S.target != null && S.data && !S.busy && !S.sent) void reading(); }
  }
  document.addEventListener('visibilitychange', () => { void wake(); });
  window.addEventListener('focus', () => { void wake(); });
  /* every alert goes to @everyone unless the member unticks it or the channel does not allow it (the member or the app lacks Mention Everyone there) */
  const pingOn = () => { const ch = S.channels.find((c) => c.id === S.channelId); return S.pingPref !== false && !!(ch && ch.mentionEveryone); };
  const price = (v) => (Number.isFinite(+v) ? (+v >= 1 ? (+v).toFixed(2) : (+v).toFixed(4)) : '-');
  const WHY = {
    authorization_required: 'Sign in with Discord (Unlock Academy Tools) to use Click-to-Alert.',
    click_alert_subscription_required: 'Click-to-Alert is an add-on. Unlock it below in one tap.',
    not_linked: 'Link your StockMarketLoop account to Discord first.',
    not_verified: 'Verify your StockMarketLoop email first.',
    not_group_manager: 'Your StockMarketLoop account is not a manager of the alert group.',
    site_publishing_unavailable: 'StockMarketLoop group publishing is unavailable. Choose a Discord channel instead.',
    click_alert_not_configured: 'Click-to-Alert is not switched on yet.',
    click_alert_disabled: 'Click-to-Alert is not available right now.',
    target_too_close: 'That target is too close to the live price. Click further away.',
    target_too_far: 'That target is too far from the live price.',
    not_enough_history: 'There is not enough price history on this symbol to estimate a horizon.',
    no_live_price: 'There is no live price for this symbol right now.',
    invalid_symbol: 'That symbol cannot be used.',
    you_cannot_post_there: 'You do not have permission to send messages in that channel.',
    app_cannot_post_there: 'The Academy app cannot send messages in that channel. Ask a server admin to allow it, or pick another channel.',
    channel_unavailable: 'The Academy app is not installed in that server, or the channel was not found.',
    rate_limited: 'You are sending alerts too quickly. Try again later.',
    duplicate_alert: 'You just sent this exact alert.',
    temporarily_unavailable: 'Something went wrong. Try again in a moment.',
    options_unavailable: 'The options chain is not available for this symbol right now.',
    contract_not_found: 'That contract is not in the live chain right now. Pick it again.',
    contract_not_priced: 'That contract has no live quote. Pick a strike closer to the money.',
    contract_expired: 'That contract expires today or has expired.',
    contract_conflicts_with_target: 'A call needs a target above the live price and a put a target below it.'
  };
  const explainErr = (r) => r.detail || WHY[r.error] || 'That did not work (' + esc(r.error || r.status) + ').';

  /* ---------- the chart marks: entry and target lines ---------- */
  function draw() {
    if (canvas.parentElement && layer.parentElement !== canvas.parentElement) canvas.parentElement.appendChild(layer);
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = canvas.offsetLeft + 'px'; layer.style.top = canvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || S.target == null || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.symbol !== S.symbol) return;
    const left = M.pad.l, right = M.pad.l + M.pw;
    const line = (p, color, label) => {
      const y = M.y(p); if (y < M.pad.t || y > M.pad.t + (M.priceH || M.ph)) return;
      ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.restore();
      ctx.font = '800 10px ui-monospace,monospace'; const t = label + ' ' + price(p), tw = ctx.measureText(t).width + 10;
      ctx.fillStyle = color; ctx.fillRect(left + 6, y - 9, tw, 18); ctx.fillStyle = '#021810'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, left + 11, y);
    };
    if (S.entry != null) line(S.entry, '#4dc3ff', 'ENTRY');
    line(S.target, S.side === 'short' ? '#ff6b86' : '#35e6a0', 'TARGET');
    if (S.data && Number.isFinite(S.data.stop)) line(S.data.stop, '#ffb04a', 'STOP');
  }
  window.addEventListener('sml-chart-view', () => { if (S.on) draw(); });
  window.addEventListener('resize', () => { if (S.on) draw(); });

  /* ---------- the panel ---------- */
  const row = (k, v) => '<div class="row"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
  /* Unlock without leaving the chart: spend Loop Bucks on a plan, or subscribe with a card. */
  const TOPUP = window.SML_LB_TOPUP_URL || 'https://stockmarketloop.com/';
  const openOut = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  const BLOCK = { not_linked: 'Link your StockMarketLoop account to this Discord account first.', not_verified: 'Verify your StockMarketLoop email first.', profile_incomplete: 'Finish your StockMarketLoop profile first.', two_step_required: 'Turn on two-step sign-in on StockMarketLoop first.' };
  async function loadPass() {
    const t = token(); if (!t) return;
    try { const res = await fetch('/academy-activity/passes/status?product=click_alert', { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); S.pass = res.ok ? await res.json() : { error: true }; } catch (_) { S.pass = { error: true }; }
    render();
  }
  function unlockHtml() {
    let h = '';
    const p = S.pass;
    if (p && p.ok && (p.catalog || []).length) {
      if (p.balance != null) h += '<div class="row"><span>Your Loop Bucks</span><b>' + esc(p.balance) + '</b></div>';
      if (p.blocked && BLOCK[p.blocked]) h += '<div class="msg err">' + esc(BLOCK[p.blocked]) + '</div><button type="button" class="act" data-ca="out" data-url="' + esc(p.url || TOPUP) + '">Fix it on StockMarketLoop</button>';
      else h += p.catalog.map((c) => '<button type="button" class="act" data-ca="buy" data-plan="' + esc(c.plan) + '"' + (S.buying ? ' disabled' : '') + '>' + esc(c.label) + ' · ' + esc(c.price) + ' Loop Bucks</button>').join('') + '<button type="button" class="act" data-ca="out" data-url="' + esc(TOPUP) + '">Add Loop Bucks</button>';
    }
    if (p && p.subscribeUrl) h += '<button type="button" class="act" data-ca="out" data-url="' + esc(p.subscribeUrl) + '">Subscribe with a card</button>';
    if (!h) return '<div class="msg info">Click-to-Alert is a separate add-on from the Academy plan. Subscribe to it to unlock.</div>' + (S.pass ? '' : '<div class="msg info">Checking your options…</div>');
    h = '<div class="msg info"><b>Unlock Click-to-Alert</b><br>It is an add-on to your Academy plan. Pick one:</div>' + h;
    if (S.passMsg) h += '<div class="msg ' + (/^Unlocked/.test(S.passMsg) ? 'ok' : 'err') + '">' + esc(S.passMsg) + '</div>';
    return h;
  }
  async function buyPass(plan) {
    if (S.buying) return; S.buying = true; S.passMsg = ''; render();
    S.orderKeys = S.orderKeys || {}; S.orderKeys[plan] = S.orderKeys[plan] || Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b + 256).toString(16).slice(-2)).join('');
    try {
      const res = await fetch('/academy-activity/passes/buy?product=click_alert', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() }, body: JSON.stringify({ plan, orderKey: S.orderKeys[plan] }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) { delete S.orderKeys[plan]; S.passMsg = 'Unlocked. Click a price on the chart to start.'; S.buying = false; await loadStatus(); await loadPass(); return; }
      delete S.orderKeys[plan];
      S.passMsg = j.error === 'insufficient_funds' ? 'You need ' + j.needed + ' Loop Bucks and have ' + j.balance + '. Add Loop Bucks and try again.' : (BLOCK[j.error] || 'That did not go through. Try again in a minute; you are never charged twice.');
    } catch (_) { S.passMsg = 'Connection problem. Try again; a retry will not charge you twice.'; }
    S.buying = false; await loadPass();
  }

  const usd = (v) => (Number.isFinite(+v) ? (+v < 0 ? '-$' : '$') + Math.abs(+v).toFixed(2) : 'n/a');
  const pct = (v) => (Number.isFinite(+v) ? (+v >= 0 ? '+' : '-') + Math.abs(+v).toFixed(0) + '%' : 'n/a');
  function optionsHtml() {
    const o = S.opt;
    if (!o) return S.kind === 'stock' ? '<button type="button" class="act ghost" data-ca="kind" data-kind="option">Make it an options alert instead</button>' : '';
    const c = o.contract, e = o.estimates, t = e.atTarget;
    return '<div class="hz"><b>' + esc(c.name) + '</b><span>' + usd(c.mid) + ' per share · $' + esc(c.perContract) + ' per contract · ' + esc(c.dte) + ' days left</span></div>'
      + row('Bid × ask', usd(c.bid) + ' × ' + usd(c.ask)) + row('Breakeven at expiry', usd(e.breakeven) + ' (' + pct(e.breakevenMovePct) + ' stock move)')
      + row('Worth at your target', usd(t.base) + ' (' + pct(t.basePct) + ') · fast ' + pct(t.fastPct) + ' · slow ' + pct(t.slowPct)) + row('Worth at the stop', usd(e.atStop.value) + ' (' + pct(e.atStop.pct) + ')')
      + row('Delta · theta/day · vega', esc(c.delta) + ' · ' + usd(c.thetaPerDay) + ' · ' + usd(c.vegaPer1pct)) + row('IV · chance in the money', esc(c.iv) + '% · ' + esc(c.probITMPct) + '%')
      + row('Liquidity', esc(c.liquidity) + ' · OI ' + esc(c.oi == null ? 'n/a' : c.oi) + ' · vol ' + esc(c.volume == null ? 'n/a' : c.volume))
      + '<ul>' + (o.warnings || []).map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul><button type="button" class="act ghost" data-ca="repick">Change the contract</button><button type="button" class="act ghost" data-ca="nocontract">Use the stock alert instead</button>';
  }

  /* ---------- the contract picker: call or put, then the expiration, then the strike ---------- */
  function fmtExp(iso) { const d = new Date(iso + 'T12:00:00'); if (Number.isNaN(d.valueOf())) return iso; const days = Math.max(0, Math.ceil((new Date(iso + 'T23:59:59') - new Date()) / 86400000)); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + days + ' DTE'; }
  function pickerHtml() {
    const P = S.pick, C = S.chain, type = P.type;
    let h = '<div class="pick"><b>Options alert' + (S.symbol ? ' · ' + esc(S.symbol) : '') + '</b>';
    h += '<h6>1 · CALL OR PUT</h6><div class="seg"><button type="button" data-ca="ptype" data-type="call" class="' + (type === 'call' ? 'on' : '') + '">📈 CALL</button><button type="button" data-ca="ptype" data-type="put" class="put ' + (type === 'put' ? 'on' : '') + '">📉 PUT</button></div>';
    h += '<h6>2 · EXPIRATION</h6>';
    if (S.chainErr) h += '<div class="msg err">' + esc(S.chainErr) + '</div>';
    else if (!C) h += '<div class="msg info">Loading the options chain…</div>';
    else h += '<select data-ca="pexp"' + (type ? '' : ' disabled') + '><option value="">' + (type ? 'Choose an expiration…' : 'Pick call or put first') + '</option>' + (C.expirations || []).map((e) => '<option value="' + esc(e) + '"' + (e === P.expiry ? ' selected' : '') + '>' + esc(fmtExp(e)) + '</option>').join('') + '</select>';
    h += '<h6>3 · STRIKE</h6>';
    if (C && type && P.expiry) {
      const rows = (C.rows || []).filter((r) => r.expiry === P.expiry && r[type] && r[type].mid > 0);
      if (S.chainBusy) h += '<div class="msg info">Loading ' + esc(fmtExp(P.expiry)) + ' strikes…</div>';
      else if (!rows.length) h += '<div class="msg info">No priced ' + type + 's for that expiration. Try another.</div>';
      else {
        const spot = Number(C.price), atm = spot > 0 ? rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), rows[0]) : null;
        h += '<select data-ca="pstrike"><option value="">Choose a strike…</option>' + rows.map((r) => { const m = r[type]; const inMoney = spot > 0 && (type === 'call' ? r.strike < spot : r.strike > spot); return '<option value="' + esc(r.strike) + '"' + (String(r.strike) === String(P.strike) ? ' selected' : '') + '>$' + esc(price(r.strike)) + ' · ' + usd(m.mid) + (r === atm ? ' · ATM' : inMoney ? ' · ITM' : ' · OTM') + (m.delta != null ? ' · Δ ' + esc(Math.abs(m.delta).toFixed(2)) : '') + (m.oi != null ? ' · OI ' + esc(m.oi) : '') + '</option>'; }).join('') + '</select>';
        if (spot > 0) h += '<small>Live price $' + esc(price(spot)) + '. ATM = at the money, ITM = in the money, OTM = out of the money. Δ is how much the contract moves per $1 in the stock.</small>';
      }
    } else h += '<div class="msg info">' + (type ? 'Pick an expiration to see its strikes.' : 'Pick call or put, then an expiration.') + '</div>';
    h += '<button type="button" class="act ghost" data-ca="kind" data-kind="stock">Make it a stock alert instead</button></div>';
    return h;
  }
  function catalystsHtml() {
    const c = S.cat; if (!c) return '';
    const chip = (t) => '<span class="chip ' + (t > 0 ? 'up' : t < 0 ? 'down' : 'flat') + '">' + (t > 0 ? 'BULLISH' : t < 0 ? 'BEARISH' : 'NEUTRAL') + '</span>';
    let h = '<div class="cat ' + esc(c.verdict) + '"><h6>CATALYST CHECK · EARNINGS + NEWS</h6><b class="v">' + esc(c.headline) + '</b>';
    if (c.earnings) h += row('Next earnings', esc(c.earnings.date) + ' · ' + (c.earnings.daysAway <= 0 ? 'today' : c.earnings.daysAway === 1 ? 'tomorrow' : 'in ' + esc(c.earnings.daysAway) + ' days') + (c.earnings.beforeExpiry ? ' · BEFORE EXPIRY' : c.earnings.inWindow ? ' · INSIDE THE WINDOW' : ' · after the window'));
    else h += row('Next earnings', 'not found');
    h += row('News this week', c.news && c.news.count ? esc(c.news.count) + ' item' + (c.news.count === 1 ? '' : 's') + ' · ' + esc(c.news.positive) + ' bullish · ' + esc(c.news.negative) + ' bearish' + (c.news.alarm ? ' · ' + esc(c.news.alarm) + ' red-flag' : '') : 'none found');
    h += '<ul>' + (c.reasons || []).map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>';
    if (c.news && c.news.items && c.news.items.length) h += '<ul>' + c.news.items.slice(0, 4).map((n) => '<li>' + chip(n.tone) + (n.url ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' + esc(n.title) + '</a>' : esc(n.title)) + '</li>').join('') + '</ul>';
    if (c.riskBump) h += '<small>The risk grade was raised one notch because of this.</small>';
    return h + '</div>';
  }
  async function loadChain(expiry) {
    const symbol = S.symbol || sym();
    S.symbol = symbol;
    if (S.chain && S.chain.symbol === symbol && (!expiry || (S.chain.loaded || []).includes(expiry))) return;
    S.chainBusy = true; S.chainErr = ''; if (!(S.chain && S.chain.symbol === symbol)) S.chain = null; render();
    const r = await api('chain?symbol=' + encodeURIComponent(symbol) + (expiry ? '&expiry=' + encodeURIComponent(expiry) : ''));
    S.chainBusy = false;
    if (!r.ok) { S.chainErr = explainErr(r); if (r.entitlement) S.status = Object.assign({ ok: true }, r.entitlement, { guilds: S.guilds }); render(); return; }
    if (S.chain && S.chain.symbol === symbol) {
      const have = new Set(S.chain.rows.map((x) => x.expiry + '|' + x.strike));
      for (const x of r.rows || []) if (!have.has(x.expiry + '|' + x.strike)) S.chain.rows.push(x);
      S.chain.rows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
      S.chain.loaded = [...new Set([...(S.chain.loaded || []), ...(r.loaded || [])])]; S.chain.expirations = [...new Set([...(S.chain.expirations || []), ...(r.expirations || [])])].sort(); if (r.price != null) S.chain.price = r.price;
    } else S.chain = { symbol, price: r.price, expirations: r.expirations || [], loaded: r.loaded || [], rows: r.rows || [] };
    render();
  }
  function pickContract() {
    const P = S.pick; if (!P.type || !P.expiry || !(Number(P.strike) > 0)) return;
    S.contract = { type: P.type, strike: Number(P.strike), expiry: P.expiry }; S.autoTarget = true; S.symNote = ''; S.target = null; S.entry = null; S.data = null; S.opt = null; S.cat = null; S.msg = '';
    if (S.status && S.status.ok && S.status.entitled) { if (!S.busy) void reading(); else S.queued = true; }
    else void loadStatus().then(() => { if (S.status && S.status.entitled && S.contract) void reading(); });
    render(); draw();
  }
  window.addEventListener('sml-click-alert-contract', (e) => {
    const d = e.detail || {};
    /* options ALERT mode (the chain's 🔔 ALERT button): no chart click needed, the server derives the stock target from the contract */
    if (d.autoTarget) {
      if (!S.on) { S.msg = ''; setOn(true, { quiet: true }); }
      S.optMode = true;
      const chartSym = sym(), chainSym = String(d.symbol || chartSym).toUpperCase();
      S.symNote = chainSym !== chartSym ? 'The options chain shows ' + chainSym + ' while the chart shows ' + chartSym + ', so this alert is for ' + chainSym + ' (the chain).' : '';
      S.kind = 'option'; S.pick = { type: d.type, expiry: d.expiry, strike: String(d.strike) };
      S.symbol = chainSym; S.contract = { type: d.type, strike: d.strike, expiry: d.expiry }; S.autoTarget = true; S.target = null; S.entry = null; S.data = null; S.opt = null; S.msg = '';
      if (S.status && S.status.ok && S.status.entitled) { if (!S.busy) void reading(); else S.queued = true; }
      else void loadStatus().then(() => { if (S.status && S.status.entitled && S.autoTarget) void reading(); });
      render(); draw(); return;
    }
    if (!S.on) { S.msg = ''; setOn(true); }
    if (S.target == null || !S.data) { S.msg = 'First click a price on the chart to set the stock target, then double-click the contract.'; S.msgTone = 'info'; render(); return; }
    if (S.busy) return;
    S.contract = { type: d.type, strike: d.strike, expiry: d.expiry }; void reading();
  });
  // the chain's 🔔 ALERT button: opening the panel shows the member at once whether they have the add-on (and how to unlock it if not)
  window.addEventListener('sml-options-alert-mode', (e) => {
    const on = !!(e.detail && e.detail.on);
    S.optMode = on;
    if (on) { S.kind = 'option'; if (!S.on) { S.msg = ''; setOn(true, { quiet: true }); } else { render(); void loadStatus(); void loadChain(); } }
    else render();
  });

  function render() {
    if (!S.on) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let html = '<header><b>CLICK-TO-ALERT</b><button type="button" data-ca="close" aria-label="Close">×</button></header><div class="body">';
    if (!token()) html += '<div class="msg info">' + esc(WHY.authorization_required) + '</div>';
    else if (S.status && S.status.ok === false) html += '<div class="msg err">' + esc(explainErr(S.status)) + '</div>';
    else if (S.status && !S.status.configured) html += '<div class="msg info">' + esc(WHY.click_alert_not_configured) + '</div>';
    else if (S.status && !S.status.entitled) html += unlockHtml();
    else if (S.busy && !S.data && S.autoTarget && S.contract) html += '<div class="msg info">Reading the ' + esc(S.symbol) + ' ' + esc(S.contract.expiry) + ' ' + esc(S.contract.strike) + ' ' + esc(S.contract.type) + ', setting a target from it and checking earnings and news…</div>';
    else if (!S.kind && S.target == null && !S.contract) html += '<div class="pick"><b>What are you alerting?</b><div class="seg"><button type="button" data-ca="kind" data-kind="stock">📈 STOCK</button><button type="button" data-ca="kind" data-kind="option">🎯 OPTION</button></div><small>Stock: click a price on the chart for the target. Option: pick call or put, the expiration and the strike here; the target comes from the contract.</small></div>';
    else if (S.kind === 'option' && !S.contract && S.target == null) html += pickerHtml();
    else if (S.target == null && !(S.autoTarget && S.contract)) html += '<div class="msg info">Click a price on the chart. The entry locks to the live price and your click becomes the target.</div>';
    else if (S.busy && !S.data) html += '<div class="msg info">Reading ' + esc(S.symbol) + ' across the Academy data…</div>';
    if (S.symNote && S.contract) html += '<div class="msg info">' + esc(S.symNote) + '</div>';
    const d = S.data;
    if (d) {
      html += row('Symbol', esc(d.symbol) + ' · ' + (d.side === 'short' ? 'SHORT' : 'LONG')) + row('Entry (live price, locked)', '$' + price(d.entry)) + row(d.autoTarget ? 'Target (from the contract)' : 'Target (your click)', '$' + price(d.target) + ' (' + (d.movePct >= 0 ? '+' : '') + d.movePct + '%)');
      if (d.autoTarget && d.targetBasis) html += row('Why this target', esc(d.targetBasis)) + '<div class="msg info">Click a price on the chart to use your own target for this contract instead.</div>';
      html += '<div class="hz"><b>' + esc(d.horizonLabel.toUpperCase()) + '</b><span>' + esc(d.horizonSpan) + ' · ' + esc(d.confidence) + ' confidence · about ' + (d.expectedDays.mid < 1 ? 'under a day' : (d.expectedDays.mid < 10 ? d.expectedDays.mid.toFixed(1) : Math.round(d.expectedDays.mid)) + ' trading days') + '</span></div>';
      html += row('Stop (suggested)', '$' + price(d.stop) + ' · ' + esc(d.stopBasis)) + row('Risk', esc(String(d.risk).toUpperCase()));
      html += '<ul>' + d.rationale.filter((t) => !(S.cat && S.cat.reasons && S.cat.reasons.includes(t))).map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
      html += catalystsHtml();
      html += optionsHtml();
      const ch = S.channels.find((c) => c.id === S.channelId);
      const canAsMe = !!(ch && ch.asMe);
      html += '<select data-ca="guild"><option value="">Choose a server…</option>' + S.guilds.map((g) => '<option value="' + esc(g.id) + '"' + (g.id === S.guildId ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select>';
      html += '<select data-ca="channel"' + (S.guildId ? '' : ' disabled') + '><option value="">' + (S.guildId ? (S.channels.length ? 'Choose a channel…' : 'No channel where you and the app can post') : 'Pick a server first') + '</option>' + S.channels.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === S.channelId ? ' selected' : '') + '>#' + esc(c.name) + (c.category ? ' · ' + esc(c.category) : '') + '</option>').join('') + '</select>';
      html += '<div class="msg ' + (d.smashed ? 'ok' : 'info') + '">' + (d.smashed ? (d.smashed.prevTarget ? 'Your earlier alert on ' + esc(d.symbol) + ' hit its $' + price(d.smashed.prevTarget) + ' target. This posts as PT SMASHED with the new target.' : 'This posts as PT SMASHED.') : 'Posts as a new alert.') + '</div>'
        + '<select data-ca="mode" aria-label="Alert type"><option value="auto"' + (S.mode === 'auto' ? ' selected' : '') + '>Alert type: automatic</option><option value="new"' + (S.mode === 'new' ? ' selected' : '') + '>Always a new alert</option><option value="smashed"' + (S.mode === 'smashed' ? ' selected' : '') + '>PT SMASHED update</option></select>';
      html += '<label class="chk"><input type="checkbox" data-ca="ping"' + (pingOn() ? ' checked' : '') + (ch && ch.mentionEveryone ? '' : ' disabled') + '> Ping @everyone' + (ch && !ch.mentionEveryone ? ' (not allowed in this channel)' : '') + '</label>';
      if (S.scn) html += '<label class="chk"><input type="checkbox" data-ca="images"' + (S.images ? ' checked' : '') + (S.scn.pngAvailable ? '' : ' disabled') + '> Attach the two scenario charts' + (S.scn.pngAvailable ? '' : ' (picture engine unavailable)') + '</label>';
      html += '<label class="chk"><input type="checkbox" data-ca="asme"' + (S.asMe && canAsMe ? ' checked' : '') + (canAsMe ? '' : ' disabled') + '> Post under my name and picture' + (ch && !canAsMe ? ' (this channel only lets the app post as itself)' : '') + '</label>';
      /* what Discord will show: the message as posted by the app, the two charts when attached, and where it is going */
      const gname = (S.guilds.find((g) => g.id === S.guildId) || {}).name, cname = ch ? ch.name : '';
      const asMeNow = S.asMe && canAsMe, who = asMeNow ? (window.smlAcademyDisplayName || 'You') : 'Academy';
      const shown = (pingOn() ? d.alertTextWithMention : d.alertText) + String.fromCharCode(10, 10) + '⏱ ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET · price at alert $' + price(d.entry) + (asMeNow ? '' : String.fromCharCode(10) + '-# Sent by ' + (window.smlAcademyDisplayName || 'an Academy member') + ' with Click-to-Alert');
      const body = esc(shown).replace(/@everyone/g, '<span class="mn">@everyone</span>');
      const pics = S.scn && S.images && S.scn.pngAvailable ? '<div class="dpics">' + S.scn.images.map((im, i) => '<figure><img alt="' + esc(im.alt) + '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(im.svg) + '"><figcaption>scenario-' + (i + 1) + '.png</figcaption></figure>').join('') + '</div>' : '';
      html += '<div class="prevhead">PREVIEW · THIS IS WHAT WILL BE POSTED</div><div class="dprev"><div class="dwho"><span class="dav">' + esc(String(who).slice(0, 1).toUpperCase()) + '</span><b>' + esc(who) + '</b><i>APP</i><time>Today</time></div><div class="dbody">' + body + '</div>' + pics + '</div>';
      html += '<div class="prevto">' + (cname ? 'Posting to <b>#' + esc(cname) + '</b>' + (gname ? ' in <b>' + esc(gname) + '</b>' : '') : 'Choose a server and channel above to send it.') + (pingOn() && ch && ch.mentionEveryone ? ' · pings @everyone' : '') + (asMeNow ? '<br>Shows your name and picture. Discord adds a small APP tag to posts like this; only you typing it yourself avoids that.' : '') + '</div>';
      html += '<button type="button" class="act" data-ca="send"' + (S.busy || !S.channelId || S.sent ? ' disabled' : '') + '>' + (S.sent ? 'Alert sent' : S.busy ? 'Working…' : (ch ? 'Send to #' + esc(ch.name) : 'Send alert to Discord')) + '</button>';
      html += '<button type="button" class="act ghost" data-ca="self"' + (S.channelId ? '' : ' disabled') + '>Or post it myself (copy text, open the channel)</button>';
    }
    if (S.msg && !(S.status && S.status.ok !== false && !S.status.entitled)) html += '<div class="msg ' + esc(S.msgTone || 'info') + '">' + esc(S.msg) + '</div>';
    html += '<small>Educational estimate from the Academy’s data. It is not a prediction, financial advice, or a trade instruction. The alert is posted by the Academy app and shows your name.</small></div>';
    panel.innerHTML = html;
  }

  async function loadStatus() {
    if (!token()) { S.status = null; render(); return; }
    S.status = await api('status?current=' + encodeURIComponent(S.guildId || ''));
    S.guilds = S.status && S.status.ok ? (S.status.guilds || []) : [];
    if (!S.guilds.some((g) => g.id === S.guildId)) { const cur = S.guilds.find((g) => g.current) || S.guilds[0]; S.guildId = cur ? cur.id : ''; S.channelId = ''; }
    if (S.guildId) await loadChannels();
    render();
    if (S.status && S.status.ok !== false && !S.status.entitled && S.status.configured !== false && !S.pass) void loadPass();
  }
  async function loadChannels() {
    S.channels = [];
    if (!S.guildId) return;
    const r = await api('channels?guild=' + encodeURIComponent(S.guildId));
    S.channels = r.ok ? (r.channels || []) : [];
    if (!S.channels.some((c) => c.id === S.channelId)) S.channelId = '';
  }
  async function reading() {
    S.busy = true; S.data = null; S.scn = null; S.msg = ''; S.sent = false; render();
    const auto = !!(S.autoTarget && S.contract);
    const r = await api('preview', Object.assign({ symbol: S.symbol, mode: S.mode }, auto ? { autoTarget: true } : { target: S.target }, S.contract ? { contract: S.contract } : {}));
    S.busy = false; S.opt = r.ok ? (r.options || null) : null; S.cat = r.ok ? (r.catalysts || null) : null;
    if (S.queued) { S.queued = false; void reading(); return; } // a newer contract was double-clicked while this one was being read
    if (auto && r.ok && r.analysis) S.target = r.analysis.target;
    if (!r.ok && auto) { S.msg = explainErr(r); S.msgTone = 'err'; if (r.entitlement) S.status = Object.assign({ ok: true }, r.entitlement, { guilds: S.guilds }); S.data = null; S.entry = null; render(); draw(); return; }
    if (!r.ok && S.contract && /^(contract_|options_)/.test(String(r.error || r.code || ''))) { const why = explainErr(r); S.contract = null; await reading(); S.msg = why; S.msgTone = 'err'; render(); return; }
    if (!r.ok) { S.msg = explainErr(r); S.msgTone = 'err'; if (r.entitlement) S.status = Object.assign({ ok: true }, r.entitlement, { guilds: S.guilds }); S.data = null; S.entry = null; render(); draw(); return; }
    S.data = r.analysis; S.scn = r.scenarios && r.scenarios.available ? r.scenarios : null; S.entry = r.analysis.entry; S.side = r.analysis.side; S.msg = ''; render(); draw();
  }

  /* a click (not a drag or a pinch) on the plot sets the target */
  let down = null;
  // the chart captures the pointer on press, so where the press landed is judged at pointerdown
  stage.addEventListener('pointerdown', (e) => { down = S.on && e.target && e.target.tagName === 'CANVAS' ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }, { capture: true, passive: true }); // capture: the chart's own press handler stops the event
  stage.addEventListener('pointerup', (e) => {
    if (!S.on || !down) return; const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || Date.now() - d.t > 600) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < M.pad.l || x > M.pad.l + M.pw || y < M.pad.t || y > M.pad.t + (M.priceH || M.ph)) return;
    const p = M.hi - (y - M.pad.t) / M.ph * (M.hi - M.lo); if (!(p > 0)) return;
    // a contract picked in options ALERT mode stays: the click only replaces the target derived from it (same symbol only)
    if (S.autoTarget && S.contract && S.symbol === M.symbol) { S.autoTarget = false; S.symNote = ''; } else { S.contract = null; S.opt = null; S.autoTarget = false; S.symNote = ''; S.kind = 'stock'; }
    S.symbol = M.symbol; S.target = Math.round(p * (p >= 1 ? 100 : 10000)) / (p >= 1 ? 100 : 10000);
    if (S.status && S.status.ok && S.status.entitled) { void reading(); } else { void loadStatus().then(() => { if (S.status && S.status.entitled) void reading(); }); }
    render(); draw();
  }, { passive: true });

  panel.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-ca]'); if (!a) return; const k = a.dataset.ca;
    if (k === 'close') { const wasOpt = S.optMode; setOn(false); if (wasOpt) window.dispatchEvent(new CustomEvent('sml-options-alert-mode-set', { detail: { on: false } })); return; }
    if (k === 'self') {
      const text = (pingOn() ? S.data.alertTextWithMention : S.data.alertText) || '';
      let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch (_) { try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); copied = document.execCommand('copy'); ta.remove(); } catch (_2) { /* ignore */ } }
      S.msg = copied ? 'Alert text copied. Paste it in the channel yourself and it posts from your own account.' : 'Select the preview text and copy it, then paste it in the channel yourself.'; S.msgTone = 'info'; render();
      if (S.guildId && S.channelId) openOut('https://discord.com/channels/' + S.guildId + '/' + S.channelId);
      return;
    }
    if (k === 'nocontract') { S.contract = null; S.autoTarget = false; S.symNote = ''; S.kind = 'stock'; if (S.target != null) void reading(); else { S.data = null; S.opt = null; S.cat = null; render(); draw(); } return; }
    if (k === 'kind') {
      const kind = a.dataset.kind === 'option' ? 'option' : 'stock';
      S.kind = kind; S.msg = '';
      if (kind === 'stock') { S.contract = null; S.autoTarget = false; S.symNote = ''; S.pick = { type: '', expiry: '', strike: '' }; if (S.target == null) { S.data = null; S.opt = null; S.cat = null; } if (hint.parentElement !== stage) stage.appendChild(hint); hint.style.display = 'block'; setTimeout(() => { hint.style.display = 'none'; }, 6000); if (S.target != null) void reading(); }
      else { hint.style.display = 'none'; S.symbol = sym(); S.pick = { type: S.pick.type || '', expiry: '', strike: '' }; if (S.target == null) { S.data = null; S.opt = null; S.cat = null; } void loadChain(); }
      render(); draw(); return;
    }
    if (k === 'ptype') { S.pick.type = a.dataset.type === 'put' ? 'put' : 'call'; S.pick.strike = ''; render(); return; }
    if (k === 'repick') { S.contract = null; S.autoTarget = false; S.kind = 'option'; S.pick.strike = ''; S.target = null; S.entry = null; S.data = null; S.opt = null; S.cat = null; S.msg = ''; S.sent = false; render(); draw(); void loadChain(S.pick.expiry || ''); return; }
    if (k === 'out') { if (a.dataset.url) openOut(a.dataset.url); return; }
    if (k === 'buy') { void buyPass(a.dataset.plan); return; }
    if (k === 'send') {
      if (S.busy || !S.channelId || !S.data) return;
      S.busy = true; S.msg = ''; render();
      const auto = !!(S.autoTarget && S.contract);
      const r = await api('send', Object.assign({ symbol: S.symbol, mode: S.mode, channelId: S.channelId, mention: !!pingOn(), images: !!S.images, asMe: !!S.asMe }, auto ? { autoTarget: true } : { target: S.target }, S.contract ? { contract: S.contract } : {}));
      S.busy = false;
      if (r.ok && auto && r.analysis && Number.isFinite(+r.analysis.target) && +r.analysis.target !== +S.target) { S.target = +r.analysis.target; draw(); }
      if (r.ok) { S.sent = true; S.msg = (r.postedAs === 'member' ? 'Posted under your name' : 'Posted to Discord as the Academy app') + (r.mentioned ? ' with @everyone' : r.mentionRequestedButNotAllowed ? ' (without @everyone: not allowed in that channel)' : '') + (r.imagesAttached ? ', with the 2 scenario charts.' : r.imagesSkipped === 'no_permission' ? '. The charts were left off: you or the app cannot attach files in that channel.' : r.imagesSkipped === 'unavailable' ? '. The charts could not be made this time.' : '.'); S.msgTone = 'ok'; save(); }
      else { S.msg = explainErr(r); S.msgTone = 'err'; }
      render();
    }
  });
  panel.addEventListener('change', async (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.ca; if (!k) return;
    if (k === 'guild') { S.guildId = e.target.value; S.channelId = ''; S.channels = []; S.sent = false; render(); await loadChannels(); save(); render(); }
    else if (k === 'channel') { S.channelId = e.target.value; S.sent = false; save(); const ch = S.channels.find((c) => c.id === S.channelId); render(); }
    else if (k === 'pexp') { S.pick.expiry = e.target.value; S.pick.strike = ''; render(); if (S.pick.expiry) void loadChain(S.pick.expiry); }
    else if (k === 'pstrike') { S.pick.strike = e.target.value; render(); pickContract(); }
    else if (k === 'mode') { S.mode = e.target.value; void reading(); }
    else if (k === 'ping') { S.pingPref = !!e.target.checked; render(); }
    else if (k === 'images') { S.images = !!e.target.checked; render(); }
    else if (k === 'asme') { S.asMe = !!e.target.checked; render(); }
  });

  function setOn(on, { quiet = false } = {}) {
    S.on = !!on; btn.classList.toggle('on', S.on); document.body.classList.toggle('ca-armed', S.on);
    if (S.on) { if (quiet) S.kind = 'option'; else S.kind = ''; void loadStatus(); }
    else { hint.style.display = 'none'; S.target = null; S.entry = null; S.data = null; S.msg = ''; S.sent = false; S.contract = null; S.opt = null; S.cat = null; S.autoTarget = false; S.optMode = false; S.symNote = ''; S.queued = false; S.kind = ''; S.pick = { type: '', expiry: '', strike: '' }; S.chainErr = ''; }
    render(); draw();
  }
  btn.addEventListener('click', () => setOn(!S.on));
  window.addEventListener('sml-academy-session', () => { if (S.on) void loadStatus(); });
  render();
})(0);
