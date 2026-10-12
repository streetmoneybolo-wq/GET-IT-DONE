/* StockMarketLoop app shell: an installable web app (phone, tablet, desktop) over the App API at /v1/app.
 * Everything data comes from that API: sign-in with the member's stockmarketloop.com account, live scanner,
 * watchlist quotes, charts, news, web push. Tokens live in this browser only (localStorage); the refresh token
 * rotates on every use as the API requires. */
(() => {
  'use strict';
  const API = '/v1/app', VERSION = '1.0.0', AUTH_KEY = 'sml-app-auth-v1', WATCH_KEY = 'sml-app-watch-v1', DEVICE_KEY = 'sml-app-device-v1';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } };
  const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } };
  const px = (v) => (!Number.isFinite(Number(v)) ? '–' : Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
  const pct = (v, plus = true) => (!Number.isFinite(Number(v)) ? '–' : (plus && v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const whole = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-US') : '–');
  const compact = (v) => (!Number.isFinite(Number(v)) ? '–' : v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : 'flat');
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

  /* ---------- device + auth ---------- */
  let device = read(DEVICE_KEY, null);
  if (!device || !device.id) { device = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)), name: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'web', platform: 'web', appVersion: VERSION }; write(DEVICE_KEY, device); }
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let auth = read(AUTH_KEY, null);
  const signedIn = () => !!(auth && auth.refreshToken);
  const saveAuth = (a) => { auth = a; write(AUTH_KEY, a); };
  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (!auth || !auth.refreshToken) return false;
      const r = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: auth.refreshToken }) }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (r && r.ok && j && j.ok) { saveAuth({ ...auth, accessToken: j.accessToken, accessExpiresAt: j.accessExpiresAt, refreshToken: j.refreshToken, refreshExpiresAt: j.refreshExpiresAt, sessionId: j.sessionId }); return true; }
      if (r && (r.status === 401 || r.status === 403)) signOut(true);
      return false;
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }
  const tokenFresh = () => auth && auth.accessToken && Date.parse(auth.accessExpiresAt || 0) - Date.now() > 20_000;
  async function token() { if (!signedIn()) return ''; if (!tokenFresh()) await refresh(); return auth && auth.accessToken || ''; }
  /* JSON call with bearer, one refresh-and-retry on token_expired; other 401s mean the session is gone */
  async function api(path, { method = 'GET', body, retry = true, auth: needAuth = true } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (needAuth) { const t = await token(); if (!t) return { ok: false, error: 'authorization_required', status: 401 }; headers.authorization = 'Bearer ' + t; }
    let r; try { r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); } catch (_) { return { ok: false, error: 'offline', status: 0 }; }
    const j = await r.json().catch(() => ({ ok: false, error: 'bad_response' }));
    if (r.status === 401 && needAuth) {
      if (j && j.error === 'token_expired' && retry && await refresh()) return api(path, { method, body, retry: false });
      if (j && j.error !== 'token_expired') signOut(true);
    }
    return { ...j, status: r.status, ok: r.ok && j && j.ok !== false };
  }
  async function signOut(silent) {
    const old = auth; saveAuth(null); closeStreams();
    if (old && old.refreshToken && !silent) fetch(API + '/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: old.refreshToken }) }).catch(() => {});
    if (silent) toast('Signed out. Please sign in again.');
    route();
  }

  /* ---------- shell ---------- */
  const app = $('#app');
  let toastTimer = 0;
  function toast(text) { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); } el.textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3200); }
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; const b = $('#install-btn'); if (b) b.style.display = ''; });
  const TABS = [['markets', 'Markets', '📈'], ['watch', 'Watch', '★'], ['alerts', 'Alerts', '🔔'], ['academy', 'Academy', '🎓'], ['me', 'Me', '👤']];
  function frame(view, body, { live = false } = {}) {
    app.innerHTML = '<header class="top"><h1>STOCKMARKETLOOP</h1><span class="sp"></span>' + (live ? '<span class="pill live">LIVE</span>' : '<span class="pill" id="pill">' + esc(auth && auth.user ? (auth.user.displayName || auth.user.login) : '') + '</span>') + '</header>'
      + '<main>' + body + '</main>'
      + '<nav class="tabs">' + TABS.map(([k, label, icon]) => '<a href="#/' + k + '" class="' + (view === k ? 'on' : '') + '"><span class="i">' + icon + '</span>' + label + '</a>').join('') + '</nav>';
  }
  const installCard = () => (standalone ? '' : installPrompt ? '<div class="install"><span>📲</span><span class="sp"><b>Install StockMarketLoop</b><br><small class="muted">Opens full screen with its own icon.</small></span><button class="btn go sm" id="install-btn">Install</button></div>'
    : ios ? '<div class="install"><span>📲</span><span class="sp"><b>Add to Home Screen</b><br><small class="muted">In Safari: Share → Add to Home Screen. Alerts need the installed app.</small></span></div>' : '');

  /* ---------- login ---------- */
  function renderLogin(state = {}) {
    app.innerHTML = '<main><div class="login"><div class="mark"></div><h1>StockMarketLoop</h1><p class="sub">Sign in with your stockmarketloop.com account</p>'
      + (state.msg ? '<div class="msg ' + (state.tone || 'err') + '">' + esc(state.msg) + '</div>' : '')
      + '<form id="login"><label class="field"><span>USERNAME OR EMAIL</span><input name="login" autocomplete="username" required value="' + esc(state.login || '') + '"></label>'
      + '<label class="field"><span>PASSWORD</span><input name="password" type="password" autocomplete="current-password" required></label>'
      + (state.twoStep ? '<label class="field"><span>TWO-STEP CODE' + (state.hint ? ' · sent to ' + esc(state.hint) : state.method ? ' · ' + esc(state.method) : '') + '</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required></label>' : '')
      + '<button class="btn go w" type="submit">' + (state.twoStep ? 'Verify and sign in' : 'Sign in') + '</button></form>'
      + '<p class="small muted" style="margin-top:14px">No account? <a href="https://stockmarketloop.com/" target="_blank" rel="noopener">Join on stockmarketloop.com</a>. Purchases happen on the website.</p>'
      + installCard() + '</div></main>';
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, body = { login: f.login.value.trim(), password: f.password.value, device };
      if (f.code) body.code = f.code.value.trim();
      const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
      let r; try { r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (_) { renderLogin({ login: body.login, msg: 'You are offline. Try again when connected.' }); return; }
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { saveAuth({ accessToken: j.accessToken, accessExpiresAt: j.accessExpiresAt, refreshToken: j.refreshToken, refreshExpiresAt: j.refreshExpiresAt, sessionId: j.sessionId, user: j.user || null }); location.hash = '#/markets'; route(); return; }
      if (j.error === 'two_step_required') { renderLogin({ login: body.login, twoStep: true, method: j.method, hint: j.hint, msg: j.method === 'email' ? 'A code was emailed to you. Enter it below.' : 'Enter the code from your authenticator app.', tone: 'info' }); return; }
      const why = { invalid_credentials: 'That username or password is not right.', two_step_invalid: 'That code was not right. Try again.', account_blocked: 'This account is blocked. Contact support on stockmarketloop.com.', rate_limited: 'Too many attempts. Wait ' + (j.retryAfterSec || 60) + ' seconds.', app_auth_unconfigured: 'Sign-in is not available right now. Try again later.' }[j.error] || ('Sign-in failed (' + (j.error || r.status) + ').');
      renderLogin({ login: body.login, twoStep: j.error === 'two_step_invalid', method: j.method, hint: j.hint, msg: why });
    };
    const ib = $('#install-btn'); if (ib) ib.onclick = () => installPrompt && installPrompt.prompt();
  }

  /* ---------- streams ---------- */
  const streams = new Set();
  function closeStreams() { for (const s of streams) { try { s.close(); } catch (_) { /* gone */ } } streams.clear(); }
  /* an EventSource that carries the access token in the URL (a browser cannot set a header on it) and reconnects with backoff */
  function openStream(path, handlers) {
    let es = null, closed = false, delay = 1000;
    const ctl = { close() { closed = true; if (es) es.close(); streams.delete(ctl); } };
    (async function connect() {
      if (closed) return;
      const t = await token(); if (!t) return;
      es = new EventSource(API + path + (path.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(t));
      for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => { let d; try { d = JSON.parse(e.data); } catch (_) { return; } fn(d); });
      es.onopen = () => { delay = 1000; if (handlers.__open) handlers.__open(); };
      es.onerror = () => { es.close(); if (closed) return; setTimeout(connect, delay); delay = Math.min(30_000, delay * 2); if (handlers.__down) handlers.__down(); };
    })();
    streams.add(ctl); return ctl;
  }

  /* ---------- markets (live scanner) ---------- */
  const SC = { rows: new Map(), sort: 'c', dir: -1, live: false, at: 0, session: '' };
  function scannerRows() {
    const key = SC.sort, list = [...SC.rows.values()].filter((r) => r.s);
    // dir -1: biggest first (the default); dir 1: smallest first
    list.sort((a, b) => ((Number(b[key]) || 0) - (Number(a[key]) || 0)) * -SC.dir || String(a.s).localeCompare(String(b.s)));
    return list;
  }
  function scannerTable() {
    const cols = [['p', 'PRICE'], ['c', 'CHG%'], ['r3', 'S.I.R.E.'], ['rv', 'RVOL'], ['v', 'VOL']];
    const rows = scannerRows().slice(0, 60);
    if (!rows.length) return '<div class="skel"></div><div class="skel"></div><div class="skel"></div><p class="small muted">' + (SC.live ? 'No rows yet.' : 'Connecting to the live scanner…') + '</p>';
    return '<table class="sc"><thead><tr><th>SYMBOL</th>' + cols.map(([k, l]) => '<th data-sort="' + k + '" class="' + (SC.sort === k ? 'on' : '') + '">' + l + (SC.sort === k ? (SC.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>').join('') + '</tr></thead><tbody>'
      + rows.map((r) => '<tr data-sym="' + esc(r.s) + '" class="' + (r.__f ? 'flash' : '') + '"><td class="sym">' + esc(r.s) + (r.n ? '<small>' + esc(r.n) + '</small>' : '') + '</td><td>' + px(r.p) + '</td><td class="' + tone(r.c) + '">' + pct(r.c) + '</td><td class="' + tone(r.r3) + '">' + (Number.isFinite(Number(r.r3)) ? pct(r.r3) : '–') + '</td><td>' + (Number.isFinite(Number(r.rv)) ? Number(r.rv).toFixed(1) + 'x' : '–') + '</td><td>' + compact(Number(r.v)) + '</td></tr>').join('') + '</tbody></table>';
  }
  let scStream = null, scPaint = 0;
  function paintScanner() { const box = $('#scanner'); if (!box) return; box.innerHTML = scannerTable(); const st = $('#sc-status'); if (st) st.textContent = (SC.live ? 'live' : 'reconnecting') + (SC.session ? ' · ' + SC.session : '') + (SC.at ? ' · ' + ago(SC.at) : ''); }
  function renderMarkets() {
    frame('markets', installCard() + '<div class="card"><h2>LIVE SCANNER <small id="sc-status">connecting…</small></h2><p class="small muted" style="margin:0 0 8px">Ranked by what you tap: change, S.I.R.E. 3-minute rate, relative volume or volume. Tap a row for the chart.</p><div id="scanner"></div></div>', { live: true });
    paintScanner();
    $('#scanner').onclick = (e) => { const th = e.target.closest('th[data-sort]'); if (th) { if (SC.sort === th.dataset.sort) SC.dir = -SC.dir; else { SC.sort = th.dataset.sort; SC.dir = -1; } paintScanner(); return; } const tr = e.target.closest('tr[data-sym]'); if (tr) location.hash = '#/t/' + tr.dataset.sym; };
    const ib = $('#install-btn'); if (ib) ib.onclick = () => installPrompt && installPrompt.prompt();
    if (!scStream) scStream = openStream('/scanner/stream', {
      snapshot: (d) => { SC.rows = new Map((d.rows || []).map((r) => [r.s, r])); SC.live = true; SC.at = Date.now(); SC.session = d.session || ''; paintScanner(); },
      tick: (d) => { for (const r of d.rows || []) { const cur = SC.rows.get(r.s) || { s: r.s }; Object.assign(cur, r); cur.__f = true; SC.rows.set(r.s, cur); setTimeout(() => { cur.__f = false; }, 800); } SC.at = Date.now(); if (Date.now() - scPaint > 700) { scPaint = Date.now(); paintScanner(); } },
      error: (d) => { toast('Scanner: ' + (d.error || 'unavailable')); },
      __down: () => { SC.live = false; paintScanner(); }
    });
  }

  /* ---------- watchlist ---------- */
  let watch = (read(WATCH_KEY, null) || ['SPY', 'QQQ', 'NVDA', 'TSLA']).filter((s) => SYMBOL.test(s)).slice(0, 20);
  const saveWatch = () => write(WATCH_KEY, watch);
  const WQ = new Map(); let wStream = null, wKey = '';
  function watchHtml() {
    if (!watch.length) return '<p class="small muted">Your watchlist is empty. Add a symbol above.</p>';
    return '<div class="watch">' + watch.map((s) => { const q = WQ.get(s) || {}; const chg = q.chg; return '<div class="it" data-sym="' + s + '"><b>' + s + '</b><span class="ba">' + (q.bid ? px(q.bid) + ' × ' + px(q.ask) : (q.warming ? 'warming…' : '')) + '</span><span class="px ' + tone(chg) + '">' + (q.last ? px(q.last) : '–') + (Number.isFinite(chg) ? '<br><small>' + pct(chg) + '</small>' : '') + '</span><button class="btn sm" data-rm="' + s + '" title="Remove">✕</button></div>'; }).join('') + '</div>';
  }
  function paintWatch() { const b = $('#watch'); if (b) b.innerHTML = watchHtml(); }
  function openWatchStream() {
    const key = watch.join(','); if (wStream && wKey === key) return; if (wStream) { wStream.close(); wStream = null; }
    if (!watch.length) return; wKey = key;
    wStream = openStream('/stream?symbols=' + encodeURIComponent(key), {
      snapshot: (d) => { const q = WQ.get(d.symbol) || {}; Object.assign(q, { last: d.last, bid: d.quote && d.quote.bid, ask: d.quote && d.quote.ask, warming: !!d.warming, open: d.stats && d.stats.open }); WQ.set(d.symbol, q); paintWatch(); },
      trade: (d) => { const q = WQ.get(d.symbol) || {}; q.last = d.p; q.warming = false; WQ.set(d.symbol, q); if (!q.__t || Date.now() - q.__t > 500) { q.__t = Date.now(); paintWatch(); } },
      quote: (d) => { const q = WQ.get(d.symbol) || {}; q.bid = d.bid; q.ask = d.ask; WQ.set(d.symbol, q); }
    });
  }
  async function fillChanges() {
    // day change for each watched symbol from its daily candles (the stream carries price only)
    for (const s of watch) { if (WQ.get(s) && Number.isFinite(WQ.get(s).chg)) continue; const r = await api('/tickers/' + s + '/candles?tf=1D'); const bars = r.ok && r.bars || []; if (bars.length >= 2) { const q = WQ.get(s) || {}; q.prevClose = bars[bars.length - 2].c; q.chg = q.last ? (q.last - q.prevClose) / q.prevClose * 100 : (bars[bars.length - 1].c - q.prevClose) / q.prevClose * 100; WQ.set(s, q); paintWatch(); } }
  }
  function renderWatch() {
    frame('watch', '<div class="card"><h2>WATCHLIST <small>' + watch.length + ' of 20 · live</small></h2><form class="addrow" id="addw"><input name="s" placeholder="Add a symbol (e.g. AAPL)" maxlength="10" autocapitalize="characters" autocomplete="off"><button class="btn go">Add</button></form></div><div id="watch">' + watchHtml() + '</div>', { live: true });
    $('#addw').onsubmit = (e) => { e.preventDefault(); const s = e.target.s.value.trim().toUpperCase(); if (!SYMBOL.test(s)) { toast('That is not a valid symbol.'); return; } if (!watch.includes(s)) { if (watch.length >= 20) { toast('The watchlist holds 20 symbols.'); return; } watch.push(s); saveWatch(); } e.target.reset(); paintWatch(); openWatchStream(); fillChanges(); };
    $('#watch').onclick = (e) => { const rm = e.target.closest('[data-rm]'); if (rm) { watch = watch.filter((x) => x !== rm.dataset.rm); saveWatch(); paintWatch(); openWatchStream(); return; } const it = e.target.closest('[data-sym]'); if (it) location.hash = '#/t/' + it.dataset.sym; };
    openWatchStream(); fillChanges();
  }

  /* ---------- ticker: quote, chart, news ---------- */
  const TK = { sym: '', tf: read('sml-app-tf', '5m'), bars: [], quote: null, timer: 0, news: null };
  function drawChart(canvas, bars) {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    const list = bars.slice(-120); if (list.length < 2) { ctx.fillStyle = '#8fb0a2'; ctx.font = '13px system-ui'; ctx.fillText('No candles yet.', 12, 24); return; }
    const padL = 8, padR = 56, padT = 10, padB = 22, pw = W - padL - padR, ph = H - padT - padB;
    let lo = Infinity, hi = -Infinity; for (const b of list) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); } if (!(hi > lo)) { hi = lo + 1; }
    const y = (p) => padT + (hi - p) / (hi - lo) * ph, cw = pw / list.length;
    ctx.strokeStyle = '#173a2c'; ctx.lineWidth = 1; ctx.fillStyle = '#8fb0a2'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) { const p = hi - (hi - lo) * i / 4, yy = y(p); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + pw, yy); ctx.stroke(); ctx.fillText(px(p), padL + pw + 6, yy + 3); }
    list.forEach((b, i) => { const x = padL + i * cw + cw / 2, up = b.c >= b.o; ctx.strokeStyle = ctx.fillStyle = up ? '#19e36b' : '#ff6b7f'; ctx.beginPath(); ctx.moveTo(x, y(b.h)); ctx.lineTo(x, y(b.l)); ctx.stroke(); const top = y(Math.max(b.o, b.c)), hgt = Math.max(1, Math.abs(y(b.o) - y(b.c))); ctx.fillRect(x - Math.max(1, cw * 0.35), top, Math.max(2, cw * 0.7), hgt); });
    const last = list[list.length - 1]; ctx.fillStyle = '#e6f2ec'; ctx.font = '11px ui-monospace,monospace'; ctx.fillText(new Date(list[0].t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: TK.tf.endsWith('m') || TK.tf.endsWith('h') ? 'numeric' : undefined }), padL, H - 6); ctx.textAlign = 'right'; ctx.fillText(new Date(last.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: TK.tf.endsWith('m') || TK.tf.endsWith('h') ? 'numeric' : undefined }), padL + pw, H - 6);
  }
  function paintQuote() {
    const q = TK.quote, el = $('#quote'); if (!el) return;
    if (!q || q.warming || !q.last) { el.innerHTML = '<span class="muted">Warming up the live quote…</span>'; return; }
    const prev = TK.bars.length >= 2 && TK.tf === '1D' ? TK.bars[TK.bars.length - 2].c : (TK.prevClose || null);
    const chg = prev ? (q.last - prev) / prev * 100 : null;
    el.innerHTML = '<span class="last">' + px(q.last) + '</span>' + (chg != null ? '<span class="chg ' + tone(chg) + '">' + pct(chg) + '</span>' : '') + (q.quote && q.quote.bid ? '<span class="ba">bid ' + px(q.quote.bid) + ' × ' + whole(q.quote.bs) + ' · ask ' + px(q.quote.ask) + ' × ' + whole(q.quote.as) + '</span>' : '');
  }
  async function loadTicker(sym) {
    const [q, c] = await Promise.all([api('/tickers/' + sym + '/quote'), api('/tickers/' + sym + '/candles?tf=' + encodeURIComponent(TK.tf))]);
    if (TK.sym !== sym) return;
    TK.quote = q.ok ? q : null; TK.bars = c.ok && Array.isArray(c.bars) ? c.bars : [];
    if (TK.tf !== '1D') { const d = await api('/tickers/' + sym + '/candles?tf=1D'); if (TK.sym === sym && d.ok && d.bars && d.bars.length >= 2) TK.prevClose = d.bars[d.bars.length - 2].c; } else TK.prevClose = null;
    paintQuote(); const cv = $('#chart'); if (cv) drawChart(cv, TK.bars);
    const src = $('#csrc'); if (src) src.textContent = c.ok ? (TK.bars.length + ' candles · ' + (c.source || 'platform')) : ('Chart unavailable: ' + (c.detail || c.error || 'try another timeframe'));
    if (TK.news === null) { const n = await api('/tickers/' + sym + '/news'); if (TK.sym !== sym) return; TK.news = n.ok ? (n.articles || []) : []; const nl = $('#news'); if (nl) nl.innerHTML = TK.news.length ? TK.news.slice(0, 12).map((a) => '<li><a href="' + esc(a.url || '#') + '" target="_blank" rel="noopener">' + esc(a.title || a.headline || 'Article') + '</a><small>' + esc(a.source || a.publisher || '') + (a.publishedAt || a.date || a.time ? ' · ' + esc(a.publishedAt || a.date || a.time) : '') + '</small></li>').join('') : '<li class="muted small">No recent news for ' + sym + '.</li>'; }
  }
  function renderTicker(sym) {
    TK.sym = sym; TK.news = null; TK.quote = null; TK.bars = [];
    const inWatch = watch.includes(sym);
    frame('markets', '<div class="cols"><div><div class="card"><div class="row"><h2 style="margin:0;font-size:1.3rem;color:#fff;letter-spacing:0">' + esc(sym) + '</h2><span class="sp"></span><button class="btn sm" id="star">' + (inWatch ? '★ Watching' : '☆ Watch') + '</button><button class="btn sm" id="alertbtn" title="Price alerts come from the Academy app">⚡ Alert</button></div><div class="quote" id="quote" style="margin:8px 0"><span class="muted">Loading…</span></div>'
      + '<div class="seg" id="tfs">' + ['1m', '5m', '15m', '1h', '1D', '1W'].map((t) => '<button data-tf="' + t + '" class="' + (TK.tf === t ? 'on' : '') + '">' + t + '</button>').join('') + '</div><canvas class="chart" id="chart" style="margin-top:8px"></canvas><p class="small muted" id="csrc" style="margin:6px 0 0">Loading candles…</p></div></div>'
      + '<div><div class="card"><h2>NEWS</h2><ul class="news" id="news"><li><div class="skel"></div><div class="skel"></div></li></ul></div></div></div>', { live: true });
    $('#star').onclick = () => { if (watch.includes(sym)) watch = watch.filter((x) => x !== sym); else if (watch.length < 20) watch.push(sym); else { toast('The watchlist holds 20 symbols.'); return; } saveWatch(); $('#star').textContent = watch.includes(sym) ? '★ Watching' : '☆ Watch'; };
    $('#alertbtn').onclick = () => { window.open('https://stockmarketloop.com/academy/?symbol=' + encodeURIComponent(sym), '_blank', 'noopener'); };
    $('#tfs').onclick = (e) => { const b = e.target.closest('[data-tf]'); if (!b) return; TK.tf = b.dataset.tf; write('sml-app-tf', TK.tf); $('#tfs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.tf === TK.tf)); loadTicker(sym); };
    loadTicker(sym);
    clearInterval(TK.timer); TK.timer = setInterval(() => { if (TK.sym === sym && !document.hidden) loadTicker(sym); }, 15_000);
    window.onresize = () => { const cv = $('#chart'); if (cv) drawChart(cv, TK.bars); };
  }

  /* ---------- alerts (web push) ---------- */
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(t, (c) => c.charCodeAt(0)); };
  async function pushState() { if (!pushOk) return { on: false, why: 'This browser does not support push.' }; try { const reg = await navigator.serviceWorker.getRegistration('/app/'); const sub = reg && await reg.pushManager.getSubscription(); return { on: !!sub && Notification.permission === 'granted', sub }; } catch (_) { return { on: false }; } }
  async function pushOn() {
    if (!pushOk) return 'This browser does not support push notifications.';
    if (ios && !standalone) return 'On iPhone and iPad, alerts only work from the installed app: Share → Add to Home Screen, then open it from the icon.';
    const perm = await Notification.requestPermission(); if (perm !== 'granted') return perm === 'denied' ? 'Notifications are blocked for this app in your browser settings.' : 'Notifications were not allowed.';
    const k = await api('/push/vapid-key', { auth: false }); if (!k.ok) return 'Push is not available right now.';
    const reg = await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.publicKey) });
    const j = sub.toJSON(); const r = await api('/push/devices', { method: 'POST', body: { platform: 'web', token: j.endpoint, keys: j.keys, deviceId: device.id, appVersion: VERSION } });
    return r.ok ? '' : 'Could not register this device (' + (r.error || r.status) + ').';
  }
  async function pushOff() { const st = await pushState(); if (st.sub) { await api('/push/devices', { method: 'DELETE', body: { token: st.sub.endpoint } }).catch(() => {}); await st.sub.unsubscribe().catch(() => {}); } }
  async function renderAlerts() {
    frame('alerts', '<div class="card"><h2>PUSH ALERTS</h2><p class="small muted">Price-target hits, new targets and group alerts from stockmarketloop.com reach this device even when the app is closed.</p><div id="pushbox"><div class="skel"></div></div></div>'
      + '<div class="card"><h2>DEVICES</h2><div id="devices"><div class="skel"></div></div></div>'
      + '<div class="card"><h2>ACADEMY ALERTS</h2><p class="small muted">Click-to-Alert, the alerts desk and the buy-signal radar live in the Making Easy Money Academy app in Discord.</p><a class="btn w" style="display:block;text-align:center;text-decoration:none" href="https://discord.com/" target="_blank" rel="noopener">Open Discord</a></div>');
    const paint = async () => {
      const st = await pushState(); const box = $('#pushbox'); if (!box) return;
      box.innerHTML = (st.why ? '<div class="msg info">' + esc(st.why) + '</div>' : '') + '<div class="row"><span class="sp"><b>' + (st.on ? 'On for this device' : 'Off on this device') + '</b></span><button class="btn ' + (st.on ? '' : 'go') + '" id="pushtog">' + (st.on ? 'Turn off' : 'Turn on') + '</button></div>' + (st.on ? '<button class="btn sm" id="pushtest" style="margin-top:10px">Send a test notification</button>' : '');
      $('#pushtog').onclick = async () => { $('#pushtog').disabled = true; if (st.on) { await pushOff(); toast('Push alerts off on this device.'); } else { const err = await pushOn(); if (err) toast(err); else toast('Push alerts on.'); } paint(); devices(); };
      const t = $('#pushtest'); if (t) t.onclick = async () => { t.disabled = true; t.textContent = 'Sending…'; const r = await api('/push/test', { method: 'POST', body: { title: 'StockMarketLoop', body: 'Push is working on this device.' } }); t.disabled = false; t.textContent = 'Send a test notification'; toast(r.ok ? 'Sent to ' + (r.sent || 0) + ' device' + (r.sent === 1 ? '' : 's') + '.' : 'Test failed: ' + (r.error || r.status)); };
    };
    const devices = async () => { const r = await api('/push/devices'); const el = $('#devices'); if (!el) return; const list = r.ok ? (r.devices || []) : []; el.innerHTML = list.length ? list.map((d) => '<div class="sess"><span class="sp">' + esc(d.platform || 'web') + (d.appVersion ? ' · v' + esc(d.appVersion) : '') + '<small>' + (d.lastSeenAt || d.createdAt ? 'seen ' + ago(Date.parse(d.lastSeenAt || d.createdAt)) : '') + (d.disabledReason ? ' · disabled: ' + esc(d.disabledReason) : '') + '</small></span></div>').join('') : '<p class="small muted">No devices registered yet.</p>'; };
    paint(); devices();
  }

  /* ---------- academy ---------- */
  function renderAcademy() {
    frame('academy', '<div class="card"><h2>MAKING EASY MONEY ACADEMY</h2><p>The Live Chart Lab, MEM ALGO, options chain, Click-to-Alert, the alerts desk and the live chat run inside the Academy app in Discord.</p><a class="btn go w" style="display:block;text-align:center;text-decoration:none;margin:8px 0" href="https://discord.com/" target="_blank" rel="noopener">Open Discord</a><a class="btn w" style="display:block;text-align:center;text-decoration:none" href="https://stockmarketloop.com/" target="_blank" rel="noopener">stockmarketloop.com</a></div>');
  }

  /* ---------- me ---------- */
  async function renderMe() {
    frame('me', '<div class="card"><div class="me" id="me"><div class="av">…</div><div><b>Loading…</b></div></div></div><div class="card"><h2>LOOP BUCKS & GROUPS</h2><div class="kv" id="mekv"><div class="skel"></div></div></div><div class="card"><h2>SIGNED-IN DEVICES</h2><div id="sess"><div class="skel"></div></div></div><div class="card"><button class="btn w" id="out">Sign out on this device</button><button class="btn w danger" id="outall" style="margin-top:8px">Sign out everywhere</button><p class="small muted" style="margin:10px 0 0">StockMarketLoop app v' + VERSION + ' · <a href="https://stockmarketloop.com/" target="_blank" rel="noopener">stockmarketloop.com</a></p></div>');
    $('#out').onclick = () => { pushOff().catch(() => {}); signOut(false); };
    $('#outall').onclick = async () => { if (!confirm('Sign out of StockMarketLoop on every device?')) return; await api('/auth/logout-all', { method: 'POST', body: {} }); pushOff().catch(() => {}); signOut(true); };
    const r = await api('/me'); const me = $('#me'); if (!me) return;
    if (r.ok && r.user) {
      const u = r.user; saveAuth({ ...auth, user: u });
      me.innerHTML = (u.avatar ? '<img src="' + esc(u.avatar) + '" alt="">' : '<div class="av">' + esc(String(u.displayName || u.login || '?').slice(0, 1).toUpperCase()) + '</div>') + '<div><b>' + esc(u.displayName || u.login) + '</b><span>@' + esc(u.handle || u.login) + (u.profileUrl ? ' · <a href="' + esc(u.profileUrl) + '" target="_blank" rel="noopener">profile</a>' : '') + '</span></div>';
      const ex = r.extras || {}, lb = ex.loopBucks || ex.wallet || r.wallet || null;
      const bal = lb && (lb.balance != null ? lb.balance : lb.bucks != null ? lb.bucks : lb.total);
      $('#mekv').innerHTML = '<span>Loop Bucks</span><span>' + (bal != null ? whole(bal) : '–') + '</span><span>Groups</span><span>' + ((r.groups || []).map((g) => esc(g.name) + (g.role ? ' (' + esc(g.role) + ')' : '')).join(', ') || 'none') + '</span><span>Two-step sign-in</span><span>' + (u.twoStep && u.twoStep.enabled ? 'on' : 'off') + '</span><span>Email</span><span>' + esc(u.email || '') + (u.emailVerified ? ' ✓' : '') + '</span>';
    } else me.innerHTML = '<div class="av">!</div><div><b>Could not load your profile</b><span>' + esc(r.error || '') + '</span></div>';
    const s = await api('/auth/sessions'); const box = $('#sess'); if (!box) return;
    box.innerHTML = s.ok ? (s.sessions || []).map((x) => '<div class="sess"><span class="sp">' + esc((x.device && (x.device.name || x.device.platform)) || 'device') + (x.current ? ' · <b class="up">this device</b>' : '') + '<small>last used ' + ago(Date.parse(x.lastUsedAt || x.createdAt)) + '</small></span>' + (x.current ? '' : '<button class="btn sm danger" data-revoke="' + esc(x.id) + '">Revoke</button>') + '</div>').join('') : '<p class="small muted">Could not load sessions.</p>';
    box.onclick = async (e) => { const b = e.target.closest('[data-revoke]'); if (!b) return; b.disabled = true; await api('/auth/sessions/' + encodeURIComponent(b.dataset.revoke), { method: 'DELETE' }); renderMe(); };
  }

  /* ---------- router ---------- */
  function route() {
    clearInterval(TK.timer); window.onresize = null;
    if (!signedIn()) { closeStreams(); scStream = null; wStream = null; renderLogin(); return; }
    const h = location.hash.replace(/^#\/?/, '') || 'markets';
    if (h !== 'markets' && scStream) { scStream.close(); scStream = null; }
    if (h !== 'watch' && wStream) { wStream.close(); wStream = null; }
    if (h.startsWith('t/')) { const sym = h.slice(2).toUpperCase(); if (SYMBOL.test(sym)) { renderTicker(sym); return; } }
    if (h === 'watch') renderWatch(); else if (h === 'alerts') renderAlerts(); else if (h === 'academy') renderAcademy(); else if (h === 'me') renderMe(); else renderMarkets();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && signedIn()) { const h = location.hash.replace(/^#\/?/, '') || 'markets'; if (h === 'markets' && !scStream) renderMarkets(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'sml-open' && m.url) { try { const u = new URL(m.url, location.href); if (u.hash) location.hash = u.hash; } catch (_) { /* ignore */ } } });
  route();
  if (signedIn() && !tokenFresh()) refresh();
})();
