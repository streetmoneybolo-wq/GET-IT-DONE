/* MEM ALGO panel + chart overlay for the Academy Live Chart Lab. Loaded after academy-mem-algo.js (window.MemAlgoEngine).
   Reads the chart's own state (window.smlAcademyChartState) and draws on a transparent canvas above it; it never touches the chart's drawing code. */
(() => {
  const E = window.MemAlgoEngine;
  const chartCanvas = document.getElementById('chart');
  const host = chartCanvas && chartCanvas.parentElement;
  if (!E || !chartCanvas || !host || window.__memAlgoUi) return;
  window.__memAlgoUi = true;

  const KEY = 'sml-mem-algo-v1';
  const S = { on: false, mode: 'day', overlays: { ema: true, signals: true, levels: true, book: true }, of: null, ofBusy: false, ofErr: '', params: { day: {}, swing: {}, mid: {}, long: {}, short: {} }, data: null, sigKey: '', loading: false, error: '', open: false };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { S.on = !!saved.on; S.mode = E.STRATEGIES[saved.mode] ? saved.mode : 'day'; Object.assign(S.overlays, saved.overlays || {}); Object.keys(E.STRATEGIES).forEach((k) => { S.params[k] = (saved.params && saved.params[k]) || {}; }); } } catch (_) { /* storage can be blocked inside Discord */ }
  S.open = false; // the panel never pops open on load: the quote column shows first and the toggle is one click away (saved overlays still draw)
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, mode: S.mode, overlays: S.overlays, params: S.params })); } catch (_) { /* ignore */ } };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
  const pct = (v, d = 1) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) + '%' : '–');
  const rr = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + 'R' : '–');
  const q = () => new URLSearchParams(location.search);
  const tf = () => q().get('tf') || '5m';
  const symbol = () => { try { return String(window.smlAcademyChartState().symbol || q().get('symbol') || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const fmtTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const preferredTf = (mode) => (E.preferredTf ? E.preferredTf(mode) : ((E.STRATEGIES[mode] || {}).bestTf || ((E.STRATEGIES[mode] || {}).tfHint || ['5m'])[0]));

  /* Turning MEM ALGO on, or picking a mode, puts the chart on the interval that mode is built for. Only ever called from those two clicks
     (never on load, never from a repaint), so it cannot loop; when the chart is already there nothing happens. Uses the same path as a
     member clicking the interval button, so every listener on those buttons (tick bars, pop-outs) sees a normal interval change. */
  function autoTf() {
    const target = preferredTf(S.mode);
    if (!target || tf() === target) { S.tfNote = null; return; }
    const btn = Array.from(document.querySelectorAll('.intervals [data-tf]')).find((b) => b.dataset.tf === target);
    S.tfNote = { tf: target, mode: S.mode };
    if (btn) btn.click();
    else if (window.smlAcademyNavigateMarket) window.smlAcademyNavigateMarket(symbol(), target);
    else { S.tfNote = null; return; }
    S.sigKey = ''; // the 500 ms watcher reloads candles for the new interval
  }

  /* What other panels (Hedge & Income) need from MEM ALGO: the mode and a simple read of direction and conviction. */
  function readState() {
    const d = S.data, st = E.STRATEGIES[S.mode] || {};
    let dir = 'neutral', strength = 50, levels = null;
    if (d) {
      const b = d.bias;
      dir = b === 'long' ? 'bull' : b === 'short' ? 'bear' : 'neutral';
      strength = b === 'long' || b === 'short' ? 65 : b === 'warming' ? 40 : 35;
      const open = d.open, sig = open && d.signals.length ? d.signals.filter((x) => x.i <= open.entryIdx).pop() : d.latest;
      if (sig && sig.conf && Number.isFinite(sig.conf.score)) strength = sig.conf.score;
      if (open && ((open.dir > 0 && dir === 'bear') || (open.dir < 0 && dir === 'bull'))) strength = Math.min(strength, 40);
      if (d.confluence && d.confluence.exitWatch && d.confluence.exitWatch.level === 'exit') strength = Math.min(strength, 30);
      if (open) levels = { dir: open.dir, entry: open.entry, stop: open.stop, target: open.target };
      else if (d.latest && d.bars - 1 - d.latest.i <= 30) levels = { dir: d.latest.dir, entry: d.latest.price, stop: d.latest.stop, target: d.latest.target };
    }
    return { on: S.on, open: S.open, mode: S.mode, label: st.label || S.mode, preferredTf: preferredTf(S.mode), chartTf: tf(), symbol: symbol(), bias: d ? d.bias : null, dir, strength: Math.round(strength), levels, data: d };
  }
  window.smlMemAlgoState = readState;
  let lastStateKey = '';
  function announce() {
    const s = readState(), key = [s.on, s.mode, s.symbol, s.dir, s.strength, s.levels ? s.levels.stop : ''].join('|');
    if (key === lastStateKey) return;
    lastStateKey = key;
    try { window.dispatchEvent(new CustomEvent('sml-mem-algo-state', { detail: s })); } catch (_) { /* old browsers */ }
  }

  const css = document.createElement('style');
  css.textContent = `
#mem-algo-toggle{margin-left:4px;padding:5px 10px;border:1px solid #2b5c4c;border-radius:7px;background:#0e1f1a;color:#52e6ad;font:800 .66rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}
#mem-algo-toggle.on{background:#00d084;color:#04140d;border-color:#00d084}
#mem-algo-panel .mem-conv{margin-top:8px;padding:8px 10px;border:1px solid #1d3a48;border-radius:8px;background:#07121b}#mem-algo-panel .mem-conv.warnbox{border-color:#a4485a}#mem-algo-panel .mem-conv ul{list-style:none;margin:6px 0 0;padding:0}#mem-algo-panel .mem-conv li{margin:0 0 5px;font-size:.72rem}#mem-algo-panel .mem-conv li span{display:inline-block;width:14px;font-weight:800}#mem-algo-panel .mem-conv li.ok span{color:#52e6ad}#mem-algo-panel .mem-conv li.no span{color:#ff778b}#mem-algo-panel .mem-conv li.na{opacity:.55}#mem-algo-panel .mem-conv em{float:right;font-style:normal;color:#8fa6b3}#mem-algo-panel .mem-conv small{color:#8fa6b3}
#mem-algo-layer{position:absolute;pointer-events:none;z-index:4;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}
#mem-algo-panel{position:absolute;right:14px;top:58px;z-index:7;width:min(340px,calc(100% - 28px));max-height:calc(100% - 76px);overflow:auto;background:#0b141c;border:1px solid #23495a;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.55);color:#dbe6ec;font:13px/1.45 system-ui,sans-serif;display:none}
#mem-algo-panel.open{display:block}
#mem-algo-panel header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1b3540}
#mem-algo-panel header b{font:900 .8rem ui-monospace,monospace;letter-spacing:.08em;color:#52e6ad}
#mem-algo-panel header small{color:#7f98a6;font-size:.62rem}
#mem-algo-panel header button{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px;cursor:pointer}
.mem-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0}
.mem-tabs button{flex:1 1 30%;padding:7px 6px;border:1px solid #23495a;border-radius:8px;background:#0a1118;color:#b8c9d3;font:700 .72rem system-ui;cursor:pointer}
.mem-tabs button.on{background:#12362b;border-color:#00d084;color:#fff}
.mem-sec{padding:10px 12px;border-bottom:1px solid #16303a}
.mem-sec h5{margin:0 0 6px;font:800 .62rem ui-monospace,monospace;letter-spacing:.09em;color:#7f98a6;text-transform:uppercase}
.mem-blurb{margin:8px 0 0;color:#9fb3be;font-size:.74rem}
.mem-chip{display:inline-block;padding:3px 9px;border-radius:999px;font:800 .68rem ui-monospace,monospace;letter-spacing:.05em}
.mem-chip.long{background:#0d3a2a;color:#3ef0a8}.mem-chip.short{background:#421a24;color:#ff7a92}.mem-chip.flat{background:#1c2b33;color:#9db4c0}
.mem-sig{margin-top:8px;padding:9px 10px;border:1px solid #1f4050;border-radius:9px;background:#0a1118}
.mem-sig b.buy{color:#3ef0a8}.mem-sig b.sell{color:#ff7a92}
.mem-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mem-stat{padding:7px 8px;border:1px solid #16303a;border-radius:8px;background:#0a1118}
.mem-stat span{display:block;color:#7f98a6;font-size:.6rem;text-transform:uppercase;letter-spacing:.06em}
.mem-stat b{font:800 .95rem ui-monospace,monospace}
.mem-pos{color:#3ef0a8}.mem-neg{color:#ff7a92}
.mem-warn{padding:8px 10px;border-radius:8px;background:#2b2412;color:#ffcf7a;font-size:.72rem}
.mem-row{display:flex;gap:8px;align-items:center;font-size:.74rem;color:#b8c9d3;margin:4px 0}
.mem-split{width:100%;border-collapse:collapse;font-size:.72rem}.mem-split td,.mem-split th{padding:4px 6px;border-top:1px solid #16303a;text-align:right}.mem-split th:first-child,.mem-split td:first-child{text-align:left}
.mem-set{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}.mem-set label{font-size:.66rem;color:#8ea6b2}.mem-set input{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #23495a;border-radius:6px;background:#0a1118;color:#eaf3f6;font:12px ui-monospace,monospace}
#mem-algo-panel details summary{cursor:pointer;color:#8fd3ff;font-size:.74rem}
#mem-algo-panel ul{margin:6px 0 0;padding-left:18px;color:#9fb3be;font-size:.72rem}
.mem-foot{padding:9px 12px;color:#7f98a6;font-size:.64rem}
.mem-tfnote{margin:0 0 8px;padding:6px 9px;border:1px solid #1f6a4e;border-radius:8px;background:#0b2219;color:#7ef0bd;font:700 .7rem/1.4 system-ui}
.mem-hedge-btn{border-color:#2b5c4c;color:#52e6ad}
.mem-btn{margin-top:6px;padding:5px 10px;border:1px solid #23495a;border-radius:7px;background:#0a1118;color:#b8c9d3;font:700 .68rem system-ui;cursor:pointer}
.mem-of-chip{display:inline-block;padding:3px 9px;border-radius:999px;font:800 .68rem ui-monospace,monospace;letter-spacing:.05em}
.mem-of-chip.bull{background:#0d3a2a;color:#3ef0a8}.mem-of-chip.bear{background:#421a24;color:#ff7a92}.mem-of-chip.flat{background:#1c2b33;color:#9db4c0}
.mem-meter{position:relative;height:7px;border-radius:4px;background:#16303a;margin:6px 0 2px;overflow:hidden}.mem-meter i{position:absolute;top:0;bottom:0}.mem-meter em{position:absolute;left:50%;top:-1px;bottom:-1px;width:1px;background:#3f6070}
.mem-of-row{padding:7px 0;border-top:1px solid #16303a;font-size:.72rem;color:#b8c9d3}.mem-of-row:first-of-type{border-top:0}.mem-of-row b{color:#eaf3f6}
.mem-ladder{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;font:11px ui-monospace,monospace}.mem-ladder div{position:relative;display:flex;justify-content:space-between;padding:2px 5px;overflow:hidden;border-radius:3px}
.mem-ladder .b i,.mem-ladder .a i{position:absolute;top:0;bottom:0;right:0;opacity:.28}.mem-ladder .b i{background:#00d084}.mem-ladder .a i{background:#ff5470}.mem-ladder span{position:relative}
.mem-ev{font-size:.7rem;color:#9fb3be;padding:3px 0}.mem-ev u{text-decoration:none;display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}.mem-ev u.bull{background:#00d084}.mem-ev u.bear{background:#ff5470}
.mem-grade{margin-top:7px;font-size:.72rem}.mem-grade b{padding:2px 8px;border-radius:999px;font:800 .64rem ui-monospace,monospace;letter-spacing:.04em}
.mem-grade .confirms{background:#0d3a2a;color:#3ef0a8}.mem-grade .disagrees{background:#421a24;color:#ff7a92}.mem-grade .neutral,.mem-grade .unavailable{background:#1c2b33;color:#9db4c0}
#mem-algo-panel .mem-bd{padding:8px 12px 4px;border-bottom:1px solid #16303a}
#mem-algo-panel .mem-bd h5{margin:0 0 6px;font:800 .62rem ui-monospace,monospace;letter-spacing:.09em;color:#7f98a6;text-transform:uppercase;display:flex;justify-content:space-between}
#mem-algo-panel .mem-bd h5 em{font-style:normal;color:#52e6ad;letter-spacing:.04em;text-transform:none;font-weight:700}
#mem-algo-panel .mem-bdr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;align-items:center;width:100%;margin:0 0 5px;padding:6px 8px;border:1px solid #17323d;border-radius:8px;background:#0a1118;color:#dbe6ec;font:inherit;text-align:left;cursor:pointer}
#mem-algo-panel .mem-bdr:hover{border-color:#2b5c4c}#mem-algo-panel .mem-bdr.on{border-color:#00d084;background:#0d211a}
#mem-algo-panel .mem-bdr b{font:800 .74rem system-ui;color:#fff;display:block}#mem-algo-panel .mem-bdr small{display:block;color:#7f98a6;font-size:.6rem;font-weight:600;letter-spacing:.02em}
#mem-algo-panel .mem-bdr .mem-chip{font-size:.6rem;padding:2px 7px;justify-self:start}
#mem-algo-panel .mem-bdr .sig{grid-column:1 / -1;font:600 .64rem/1.4 ui-monospace,monospace;color:#b8c9d3;text-align:left;border-top:1px solid #14282f;padding-top:4px}
#mem-algo-panel .mem-bdr .sig i{font-style:normal;font-weight:800}#mem-algo-panel .mem-bdr .sig i.up{color:#3ef0a8}#mem-algo-panel .mem-bdr .sig i.dn{color:#ff7a92}
#mem-algo-panel .mem-bdn{margin:2px 0 6px;color:#6f8794;font-size:.6rem}
@media(max-width:700px){#mem-algo-panel{position:fixed;left:6px;right:6px;bottom:6px;top:auto;width:auto;max-height:52vh;z-index:2147483000}}`;
  document.head.appendChild(css);

  // toolbar button + panel + overlay layer
  const toolbar = host.querySelector('.toolbar') || host;
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.id = 'mem-algo-toggle'; toggle.textContent = 'MEM ALGO'; toggle.title = 'Day & Swing trading model (educational simulation)';
  toolbar.appendChild(toggle);
  const panel = document.createElement('aside'); panel.id = 'mem-algo-panel'; panel.setAttribute('aria-label', 'MEM ALGO'); host.appendChild(panel);
  const layer = document.createElement('canvas'); layer.id = 'mem-algo-layer'; host.appendChild(layer);
  const lctx = layer.getContext('2d');

  function refreshUrl() { return '/academy-activity/market?symbol=' + encodeURIComponent(symbol()) + '&tf=' + encodeURIComponent(tf()); }
  function recompute() {
    if (!S.raw) return;
    // Day and Swing ship with no minimum in the engine (server-side scanners must not drop signals on sparse data); the panel, which has every data source, starts them at 45 until the member sets their own.
    const ov = Object.assign({}, S.params[S.mode] || {});
    if (ov.minScore == null && (S.mode === 'day' || S.mode === 'swing' || S.mode === 'short')) ov.minScore = 45;
    S.data = E.analyze(S.raw.bars, S.mode, ov, tf(), S.ctx || {});
    S.idx = new Map(); S.raw.bars.forEach((b, i) => S.idx.set(Number(b.t), i));
  }
  /* RUNNER HOLD (academy-runner.js): late in the session, should today's long day trade be held past the close under a
     trailing stop? Needs the daily candles, fetched once per symbol. Educational: it describes the rule, it places nothing. */
  const RD = { key: '', daily: null, at: 0, busy: false };
  const etKey = (ms) => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value; return p.year + '-' + p.month + '-' + p.day; };
  function loadDaily() {
    const sym = symbol(); if (RD.busy || (RD.key === sym && Date.now() - RD.at < 300000)) return; RD.busy = true;
    fetch('/academy-activity/market?symbol=' + encodeURIComponent(sym) + '&tf=1D', { cache: 'no-store' }).then((r) => r.json()).then((j) => { RD.key = sym; RD.daily = j && Array.isArray(j.bars) ? j.bars : []; RD.at = Date.now(); paint(); }).catch(() => { RD.at = Date.now(); }).finally(() => { RD.busy = false; });
  }
  function runnerHtml(d) {
    const R = window.SmlRunner; if (!R || !d || !E.INTRADAY || E.INTRADAY.indexOf(tf()) < 0 || !S.raw) return '';
    const L = d.latest, open = d.open && d.open.dir > 0 ? d.open : null;
    const entry = open ? open.entry : (L && L.dir > 0 ? L.price : null), stop = open ? open.stop : (L ? L.stop : null);
    if (!entry) return '';
    if (RD.key !== symbol() || !RD.daily) { loadDaily(); return '<div class="mem-conv"><b>Runner hold</b><br><small>Loading the daily candles…</small></div>'; }
    const now = Date.now(), today = etKey(now), bars = S.raw.bars.filter((b) => etKey(b.t) === today);
    if (bars.length < 6) return '';
    const hist = RD.daily.filter((b) => etKey(b.t) < today);
    const ctx = S.ctx || {};
    const earningsDays = ctx.earnings && ctx.earnings.daysAway != null ? Number(ctx.earnings.daysAway) : null;
    const bias = ctx.direction && ctx.direction.bias != null ? Number(ctx.direction.bias) : null;
    const mv = E.minutesET(now), mins = typeof mv === 'number' ? mv : Number(mv && mv.min); // the engine's helper answers { min, weekday }
    let q; try { q = R.qualify({ intraday: bars, daily: hist, entry, stop, earningsDays, marketBias: bias, minutesET: mins }); } catch (_) { return ''; }
    const inWindow = mins >= R.RULES.decideFromMinutesET && mins <= R.RULES.decideToMinutesET;
    return '<div class="mem-conv ' + (q.hold ? '' : (inWindow ? 'warnbox' : '')) + '"><b>Runner hold · ' + (q.hold ? 'HOLD A PIECE OVERNIGHT' : (inWindow ? 'CLOSE WITH THE SESSION' : 'score ' + q.score + ' / 100 so far')) + '</b><br><small>' + esc(q.summary) + '</small><ul>'
      + q.gates.map((g) => '<li class="no"><span>✗</span> ' + esc(g) + '</li>').join('')
      + q.reasons.map((r) => '<li class="' + (r.pts > 0 ? 'ok' : 'no') + '"><span>' + (r.pts > 0 ? '✓' : '✗') + '</span> ' + esc(r.text) + ' <em>' + (r.pts > 0 ? '+' : '') + r.pts + '</em></li>').join('') + '</ul>'
      + (q.plan ? '<small>The rule if held: book ' + Math.round(q.plan.sellPct * 100) + '% at the close, keep the rest with the stop at ' + q.plan.stopOvernight + ' (' + esc(q.plan.stopReason) + '). After that a trailing stop that only rises: 2.5 ATR under the high on an orderly run, 1.5 ATR once it goes parabolic, never under the prior day\'s low; two sessions without a new high lift it to the last low; a climax candle or a close below the prior day\'s low ends the hold. Educational simulation, not advice.</small>' : '') + '</div>';
  }
  // Confluence data: the next timeframe up, the benchmark (SPY) on the same timeframe, and the data services. Fetched once per symbol/timeframe.
  const HTF = { '1m': '5m', '3m': '15m', '5m': '15m', '10m': '30m', '15m': '1h', '30m': '2h', '1h': '4h', '2h': '1D', '4h': '1D', '1D': '1W', '1W': '1M' };
  async function loadCtx() {
    const st = E.STRATEGIES[S.mode]; if (!st || st.params.minScore == null) { S.ctx = null; return; }
    const sym = symbol(), t = tf(), key = sym + ':' + t;
    if (S.ctx && S.ctx.key === key) return;
    const ctx = { key, htf: null, bench: null, benchSelf: sym === 'SPY', patterns: window.SmlPatterns && window.SmlPatterns.detect ? (b) => window.SmlPatterns.detect(b) : null, patternCache: new Map(),
      signals: null, orderFlow: null, earnings: null, direction: null, sentiment: null, darkPool: null, gamma: null, institutional: null, filings: null, flowDays: null };
    S.ctx = ctx;
    const get = async (s2, tt) => { try { const r = await fetch('/academy-activity/market?symbol=' + encodeURIComponent(s2) + '&tf=' + encodeURIComponent(tt), { cache: 'no-store' }); const j = await r.json(); return r.ok && Array.isArray(j.bars) ? j.bars : null; } catch (_) { return null; } };
    const token = window.smlAcademySessionToken || '';
    const authGet = async (url) => { try { const r = await fetch(url, { cache: 'no-store', headers: token ? { authorization: 'Bearer ' + token } : {} }); return r.ok ? await r.json() : null; } catch (_) { return null; } };
    const mode = S.mode === 'swing' || S.mode === 'long' ? 'swing' : 'day';
    const [h, b, earn, dir, sent, dp, gx, inst, fil, fdw] = await Promise.all([
      HTF[t] ? get(sym, HTF[t]) : null,
      ctx.benchSelf ? null : get('SPY', t),
      authGet('/academy-activity/data/earnings?symbol=' + encodeURIComponent(sym)),
      authGet('/academy-activity/direction?mode=' + mode),
      authGet('/academy-activity/sentiment?symbol=' + encodeURIComponent(sym)),
      authGet('/academy-activity/dark-pool?symbol=' + encodeURIComponent(sym)),
      authGet('/academy-activity/gamma?symbol=' + encodeURIComponent(sym)),
      authGet('/academy-activity/institutional?symbol=' + encodeURIComponent(sym)),
      authGet('/academy-activity/filings?symbol=' + encodeURIComponent(sym)),
      authGet('/academy-activity/flow-days?symbol=' + encodeURIComponent(sym) + '&days=10')
    ]);
    if (S.ctx !== ctx) return;
    ctx.htf = h; ctx.bench = b;
    if (window.SmlMemSignals && S.raw && S.raw.bars) try { ctx.signals = window.SmlMemSignals.allVotes(S.raw.bars); } catch (_) { /* signals optional */ }
    if (S.of && S.of.ready !== false) ctx.orderFlow = S.of;
    if (earn && earn.ok && earn.data) {
      const DK = ['date', 'reportDate', 'fiscalDateEnding', 'period', 'reportedDate'];
      const AK = ['epsActual', 'actualEPS', 'eps_actual', 'actual'];
      const dates = []; const wk = (n, d) => { if (d > 5 || !n || dates.length > 20) return; if (Array.isArray(n)) { n.forEach((x) => wk(x, d + 1)); return; } if (typeof n !== 'object') return; const dk = DK.find((k) => typeof n[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(n[k])); if (dk) { dates.push({ d: n[dk].slice(0, 10), actual: AK.some((k) => n[k] != null && n[k] !== '') }); return; } Object.values(n).forEach((v) => wk(v, d + 1)); };
      wk(earn.data, 0);
      const today = new Date().toISOString().slice(0, 10), todayMs = Date.parse(today + 'T00:00:00Z');
      const upcoming = dates.filter((r) => r.d >= today && !r.actual).sort((a, b) => a.d.localeCompare(b.d));
      if (upcoming.length) ctx.earnings = { daysAway: Math.max(0, Math.round((Date.parse(upcoming[0].d + 'T00:00:00Z') - todayMs) / 86400000)) };
    }
    if (dir && dir.ok) ctx.direction = dir;
    if (sent && sent.ok) ctx.sentiment = sent;
    if (dp && dp.ok) ctx.darkPool = dp;
    if (gx && gx.ok) ctx.gamma = gx;
    if (inst && inst.ok) ctx.institutional = inst;
    if (fil && fil.ok) ctx.filings = fil;
    if (fdw && fdw.ok) ctx.flowDays = fdw;
    /* how the newer signals have done: one summary for every ticker, refreshed every five minutes */
    if (!S.outcomes || Date.now() - (S.outcomesAt || 0) > 300000) { S.outcomesAt = Date.now(); authGet('/academy-activity/signal-outcomes?days=30').then((o) => { if (o && o.ok) { S.outcomes = o; paintOF(); } }); }
    recompute(); paint(); draw();
  }
  async function refresh(force) {
    if (!S.on || S.loading) return;
    const key = symbol() + ':' + tf();
    if (!force && document.hidden && S.data) return;
    S.loading = true; S.sigKey = key; // mark as attempted first, so a failing feed is retried on a timer instead of every frame
    try {
      const r = await fetch(refreshUrl(), { cache: 'no-store' });
      const p = await r.json();
      if (!r.ok || !p || !Array.isArray(p.bars) || !p.bars.length) throw new Error('market');
      S.raw = { symbol: p.symbol, tf: p.tf, bars: p.bars }; S.error = '';
      recompute(); loadCtx();
    } catch (_) {
      S.error = S.data ? '' : 'Live candles are not available right now. Trying again…';
      if (!S.retry) { S.retry = setTimeout(() => { S.retry = 0; refresh(true); }, 4000); }
    }
    S.loading = false; paint(); draw();
  }

  function stat(label, value, cls) { return '<div class="mem-stat"><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>'; }
  function splitRow(name, s) { return '<tr><td>' + name + '</td><td>' + s.trades + '</td><td>' + (s.winRate == null ? '–' : Math.round(s.winRate * 100) + '%') + '</td><td>' + rr(s.expectancyR) + '</td></tr>'; }

  /* On desktop the panel pops up over the ticker's quote column (or the alerts column when that is what sits there), never over the chart. Phones keep the bottom sheet. */
  const CLEAR = ['position', 'left', 'top', 'width', 'height', 'maxHeight', 'right', 'bottom', 'zIndex'];
  function place() {
    if (!(S.on && S.open)) return;
    // the chart dock (academy-chart-dock.js) owns the panel whenever it has room: moving it over the quote column at the same
    // time made the two fight (dock, body, dock...) and the chart jumped with every swap
    const dk = window.smlChartDock;
    if (dk && (dk.holds(panel) || dk.room())) { if (panel.style.position) CLEAR.forEach((k) => { panel.style[k] = ''; }); return; }
    if (window.matchMedia('(max-width:700px)').matches) { ['position', 'left', 'top', 'width', 'height', 'maxHeight', 'right', 'bottom', 'zIndex'].forEach((k) => { panel.style[k] = ''; }); return; }
    const visible = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 80 && getComputedStyle(el).display !== 'none' ? r : null; };
    const r = visible(document.querySelector('.side')) || visible(document.getElementById('academy-alerts'));
    if (!r) { ['position', 'left', 'top', 'width', 'height', 'maxHeight', 'right', 'zIndex'].forEach((k) => { panel.style[k] = ''; }); return; }
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    Object.assign(panel.style, { position: 'fixed', left: Math.round(r.left) + 'px', top: Math.round(r.top) + 'px', width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px', maxHeight: 'none', right: 'auto', zIndex: '2147483100' });
  }
  window.addEventListener('resize', place);
  setInterval(place, 1500); // the columns move when the alerts panel opens or closes

  /* ---------- BREAKDOWN: all five models side by side for the ticker ----------
     Day Trade, Swing Trade, Mid Term, Long Term and the short model, each read on the candle size it is built for (preferredTf), with
     its bias, its open or latest signal and its own backtest numbers. The mode that is open in the panel uses the full analysis;
     the others use the candles alone (no extra data services), so the five rows load together in about the time of one request.
     Tap a row to open that model. */
  const BD = { key: '', rows: {}, at: 0, busy: false, err: '' };
  const BD_NAMES = { day: 'Day trade', swing: 'Swing trade', mid: 'Mid term', long: 'Long term', short: 'Short sale' };
  const BD_ORDER = ['day', 'swing', 'mid', 'long', 'short'].filter((k) => E.STRATEGIES[k]);
  async function loadBreakdown(force) {
    const sym = symbol();
    if (BD.busy || (!force && BD.key === sym && Date.now() - BD.at < 30000)) return;
    BD.busy = true;
    try {
      const tfs = [...new Set(BD_ORDER.map((k) => preferredTf(k)))];
      const got = await Promise.all(tfs.map(async (t) => { try { const r = await fetch('/academy-activity/market?symbol=' + encodeURIComponent(sym) + '&tf=' + encodeURIComponent(t), { cache: 'no-store' }); const j = await r.json(); return [t, r.ok && Array.isArray(j.bars) && j.bars.length ? j.bars : null]; } catch (_) { return [t, null]; } }));
      const bars = Object.fromEntries(got);
      if (symbol() !== sym) { BD.busy = false; return; }
      const rows = {};
      for (const k of BD_ORDER) {
        const t = preferredTf(k), b = bars[t];
        if (!b) { rows[k] = { tf: t, d: null }; continue; }
        const ov = {}; if (k === 'day' || k === 'swing' || k === 'short') ov.minScore = 45;
        try { rows[k] = { tf: t, d: E.analyze(b, k, Object.assign(ov, S.params[k] || {}), t, {}) }; } catch (_) { rows[k] = { tf: t, d: null }; }
      }
      BD.rows = rows; BD.key = sym; BD.at = Date.now(); BD.err = Object.values(rows).every((r) => !r.d) ? 'The candles for the breakdown are not available right now.' : '';
    } catch (_) { BD.err = 'The breakdown could not be loaded.'; BD.key = sym; BD.at = Date.now() - 20000; }
    BD.busy = false; paint();
  }
  function breakdownHtml() {
    if (BD.key !== symbol() && !BD.busy) void loadBreakdown(true); else if (Date.now() - BD.at > 30000 && !BD.busy) void loadBreakdown(false);
    const chip = (b) => { const m = { long: ['long', 'LONG'], short: ['short', 'SHORT'], pullback: ['flat', 'PULLBACK'], bounce: ['flat', 'BOUNCE'], warming: ['flat', 'WARMING'] }[b] || ['flat', 'NO READ']; return '<span class="mem-chip ' + m[0] + '">' + m[1] + '</span>'; };
    let h = '<div class="mem-bd"><h5><span>Breakdown · $' + esc(symbol()) + '</span><em>' + (BD.busy ? 'loading…' : 'all five models') + '</em></h5>';
    for (const k of BD_ORDER) {
      const own = S.data && k === S.mode && tf() === preferredTf(k) && BD.key === symbol();
      const r = BD.key === symbol() ? BD.rows[k] : null, d = own ? S.data : (r && r.d), t = r ? r.tf : preferredTf(k);
      let mid = chip(d ? d.bias : null), sig = '<span style="color:#6f8794">' + (BD.busy || !r ? 'reading…' : 'no candles') + '</span>';
      if (d) {
        if (!d.enoughData) sig = '<span style="color:#ffcf7a">needs more candles</span>';
        else if (d.open) sig = '<i class="' + (d.open.dir > 0 ? 'up' : 'dn') + '">' + (d.open.dir > 0 ? 'LONG' : 'SHORT') + ' open</i> · entry ' + num(d.open.entry) + '<br>stop ' + num(d.open.stop) + (d.open.target == null ? '' : ' · tgt ' + num(d.open.target));
        else if (d.latest) { const L = d.latest, ago = d.bars - 1 - L.i; sig = '<i class="' + (L.dir > 0 ? 'up' : 'dn') + '">' + (E.STRATEGIES[k].dirs === 'short' ? 'SHORT' : (L.dir > 0 ? 'BUY' : 'SELL')) + '</i> ' + (ago <= 0 ? 'now' : ago + ' bars ago') + ' · ' + num(L.price); }
        else sig = 'no signal in range';
        if (d.enoughData && d.stats) sig += '<br><span style="color:#7f98a6">' + d.stats.trades + ' trades · win ' + (d.stats.winRate == null ? '–' : Math.round(d.stats.winRate * 100) + '%') + ' · ' + rr(d.stats.expectancyR) + '</span>';
      }
      h += '<button type="button" class="mem-bdr' + (S.mode === k ? ' on' : '') + '" data-mem-mode="' + k + '"><span><b>' + esc(BD_NAMES[k] || E.STRATEGIES[k].label) + '</b><small>' + esc(t) + ' candles</small></span>' + mid + '<span class="sig">' + sig + '</span></button>';
    }
    return h + (BD.err ? '<div class="mem-warn">' + esc(BD.err) + '</div>' : '') + '<p class="mem-bdn">Each model is read on the candle size it is built for. Educational simulation, not a recommendation.</p></div>';
  }

  function paint() {
    toggle.classList.toggle('on', S.on);
    panel.classList.toggle('open', S.on && S.open);
    place();
    announce();
    if (!(S.on && S.open)) return;
    const st = E.STRATEGIES[S.mode], d = S.data, p = E.resolveParams(S.mode, S.params[S.mode] || {}, tf());
    const tfNow = tf(), fitTf = st.tfHint.indexOf(tfNow) >= 0;
    let html = '<header><b>MEM ALGO</b><small>Educational simulation · no orders are placed</small><button type="button" data-mem="close" aria-label="Close">×</button></header>';
    html += breakdownHtml();
    html += '<div class="mem-tabs">' + Object.keys(E.STRATEGIES).map((k) => '<button type="button" data-mem-mode="' + k + '" class="' + (S.mode === k ? 'on' : '') + '">' + esc(E.STRATEGIES[k].label) + '</button>').join('') + '</div>';
    if (S.tfNote && S.tfNote.seen && S.tfNote.tf !== tfNow) S.tfNote = null; // the member has since picked another interval
    if (S.tfNote && S.tfNote.tf === tfNow) S.tfNote.seen = true;
    const note = S.tfNote && S.tfNote.mode === S.mode && S.tfNote.tf === tfNow ?'<div class="mem-tfnote">Chart set to ' + esc(tfNow) + ' — the interval ' + esc(st.label) + ' is built for.</div>' : '';
    html += '<div class="mem-sec">' + note + '<p class="mem-blurb" style="margin-top:0">' + esc(st.blurb) + '</p><button type="button" class="mem-btn mem-hedge-btn" data-mem="hedge" title="Ways to protect this position or earn income on it with options">Hedge &amp; income ideas →</button>' + (fitTf ? '' : '<div class="mem-warn" style="margin-top:8px">' + esc(st.label) + ' is built for ' + esc(st.tfHint[0]) + '–' + esc(st.tfHint[st.tfHint.length - 1]) + ' candles. You are on ' + esc(tfNow) + ', so treat these numbers as a rough guide. <button type="button" class="mem-btn" data-mem-tf="' + esc(st.bestTf || st.tfHint[0]) + '" style="margin-top:6px">Switch chart to ' + esc(st.bestTf || st.tfHint[0]) + '</button></div>') + '</div>';
    /* the five scenarios for this trade type (academy-mem-scenarios-ui.js), right under the model's own read */
    if (window.smlMemScenarios && d) { try { html += window.smlMemScenarios.sectionHtml(); } catch (_) { /* the chart is not ready yet */ } }
    html += '<div class="mem-sec" id="mem-of"></div>';
    html += weekHtml();
    if (S.error) html += '<div class="mem-sec"><div class="mem-warn">' + esc(S.error) + '</div></div>';
    if (!d) { html += '<div class="mem-sec">Loading candles for $' + esc(symbol()) + '…</div>'; }
    else {
      const biasMap = { long: ['long', 'LONG BIAS'], short: ['short', 'SHORT BIAS'], pullback: ['flat', 'PULLBACK IN UPTREND'], bounce: ['flat', 'BOUNCE IN DOWNTREND'], warming: ['flat', 'WARMING UP'] };
      const b = biasMap[d.bias] || biasMap.warming, L = d.latest;
      html += '<div class="mem-sec"><h5>Right now · $' + esc(symbol()) + ' · ' + esc(tfNow) + '</h5><span class="mem-chip ' + b[0] + '">' + b[1] + '</span>';
      if (d.open) html += '<div class="mem-sig"><b class="' + (d.open.dir > 0 ? 'buy' : 'sell') + '">Signal open · ' + (d.open.dir > 0 ? 'LONG' : 'SHORT') + '</b><br>Entry ' + num(d.open.entry) + ' · ' + (p.trail ? 'Trailing stop ' : 'Stop ') + num(d.open.stop) + (d.open.target == null ? '' : ' · Target ' + num(d.open.target)) + '<br>Unrealized ' + '<span class="' + (d.open.unrealizedR >= 0 ? 'mem-pos' : 'mem-neg') + '">' + rr(d.open.unrealizedR) + '</span><div class="mem-grade" id="mem-grade" data-dir="' + d.open.dir + '"></div></div>';
      else if (L) html += '<div class="mem-sig"><b class="' + (L.dir > 0 ? 'buy' : 'sell') + '">Last signal · ' + (st.dirs === 'short' ? 'SHORT' : (L.dir > 0 ? 'BUY' : 'SELL')) + '</b> ' + esc(fmtTime(L.t)) + '<br>Price ' + num(L.price) + ' · ' + (p.trail ? 'Starting stop ' : 'Stop ') + num(L.stop) + (L.target == null ? '' : ' · Target ' + num(L.target)) + '<br><span class="mem-blurb">' + (L.target == null ? 'Risk ' + num(Math.abs(L.price - L.stop)) + ' to start; the stop then trails ' + p.trail + '× ATR behind the best price and the position is held until it is hit or the trend reverses.' : 'Risk ' + num(Math.abs(L.price - L.stop)) + ' to make ' + num(Math.abs(L.target - L.price)) + ' (' + num(p.targetAtr / p.stopAtr, 1) + ' : 1).') + ' A signal is a closed-candle event; it is counted from the next candle\'s open.</span><div class="mem-grade" id="mem-grade" data-dir="' + L.dir + '"></div></div>';
      else html += '<div class="mem-sec" style="padding:8px 0 0"><span class="mem-blurb">No signal in the candles loaded. That is normal — the model waits for a clean, confirmed cross.</span></div>';
      if (d.confluence) {
        const cf = d.confluence, open = d.open, sigForOpen = open && d.signals.length ? d.signals.filter((x) => x.i <= open.entryIdx).pop() : null, shown = open ? sigForOpen : L;
        if (shown && shown.conf) {
          html += '<div class="mem-conv"><b>Conviction ' + shown.conf.score + ' / 100 · grade ' + shown.conf.grade + '</b><ul>' + shown.conf.factors.map((f) => '<li class="' + (f.available ? (f.ok ? 'ok' : 'no') : 'na') + '"><span>' + (f.available ? (f.ok ? '✓' : '✗') : '–') + '</span> ' + esc(f.label) + ' <em>' + (f.available ? f.pts + '/' + f.max : 'n/a') + '</em><br><small>' + esc(f.detail) + '</small></li>').join('') + '</ul></div>';
        } else if (cf.skipped.length) {
          const s2 = cf.skipped[cf.skipped.length - 1];
          html += '<div class="mem-conv"><b>Last raw signal was skipped</b><br><small>' + esc(fmtTime(s2.t)) + ' scored ' + s2.score + ' (grade ' + s2.grade + '), below your minimum of ' + cf.minScore + '. Lower the minimum in Settings to see it.</small></div>';
        }
        if (S.mode === 'day') html += runnerHtml(d);
        if (cf.exitWatch) html += '<div class="mem-conv ' + (cf.exitWatch.level === 'exit' ? 'warnbox' : '') + '"><b>Exit watch · ' + (cf.exitWatch.level === 'clear' ? 'nothing flagged' : cf.exitWatch.level === 'exit' ? 'several warnings' : 'caution') + '</b>' + (cf.exitWatch.flags.length ? '<ul>' + cf.exitWatch.flags.map((f) => '<li class="no"><span>!</span> ' + esc(f) + '</li>').join('') + '</ul>' : '') + '</div>';
        if (!(cf.htf && (cf.bench || S.ctx && S.ctx.benchSelf))) html += '<div class="mem-blurb" style="margin-top:6px">' + (S.ctx && S.ctx.key ? 'Loading higher-timeframe and benchmark candles for extra confirmation…' : '') + '</div>';
      }
      html += '</div>';
      if (!d.enoughData) html += '<div class="mem-sec"><div class="mem-warn">Only ' + d.bars + ' candles are loaded and this mode needs about ' + (d.warm + 30) + ' to warm up its averages. Try a shorter-period timeframe or another ticker.</div></div>';
      else {
        const s = d.stats;
        html += '<div class="mem-sec"><h5>Backtest · ' + d.bars + ' candles</h5><div class="mem-grid">'
          + stat('Trades', s.trades) + stat('Win rate', s.winRate == null ? '–' : Math.round(s.winRate * 100) + '%')
          + stat('Avg win / loss', s.trades ? rr(s.avgWinR) + ' / ' + rr(s.avgLossR) : '–')
          + stat('Expectancy', rr(s.expectancyR), s.expectancyR > 0 ? 'mem-pos' : (s.expectancyR < 0 ? 'mem-neg' : ''))
          + stat('Profit factor', s.profitFactor == null ? '–' : (s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)))
          + stat('Max drawdown', '−' + num(s.maxDrawdownPct, 1) + '%', s.maxDrawdownPct > 15 ? 'mem-neg' : '')
          + (p.trail ? stat('Return (whole account)', pct(s.compoundPct), s.compoundPct >= 0 ? 'mem-pos' : 'mem-neg') + stat('Avg trade', pct(s.avgTradePct), s.avgTradePct >= 0 ? 'mem-pos' : 'mem-neg') : stat('Return (1% risk)', pct(s.returnPct), s.returnPct >= 0 ? 'mem-pos' : 'mem-neg')) + stat('Buy & hold', pct(d.buyHoldPct))
          + '</div><p class="mem-blurb">Costs of ' + p.costBps + ' bps per side are included. R means multiples of the amount risked on each trade.</p>'
          + (p.trail ? '<p class="mem-blurb">A hold strategy is in the market for long stretches and skips the rest, so it is judged against buy &amp; hold. Compare “Return (whole account)” with “Buy &amp; hold” — and note the drawdown.</p>' : '') + (s.trades < 20 ? '<div class="mem-warn" style="margin-top:8px">Only ' + s.trades + ' trades. Small samples flatter or punish any strategy — do not read too much into them.</div>' : '') + '</div>';
        if (d.confluence) {
          const cf = d.confluence, row = (name, x) => '<tr><td>' + name + '</td><td>' + x.trades + '</td><td>' + (x.winRate == null ? '–' : Math.round(x.winRate * 100) + '%') + '</td><td>' + rr(x.expectancyR) + '</td><td>' + (x.avgTradePct == null ? '–' : pct(x.avgTradePct)) + '</td></tr>';
          html += '<div class="mem-sec"><h5>Does confluence help? Measured on these candles</h5><table class="mem-split"><thead><tr><th></th><th>Trades</th><th>Win</th><th>Expect.</th><th>Avg trade</th></tr></thead><tbody>'
            + row('Every crossover signal', cf.all) + row('Only conviction ≥ ' + cf.minScore, cf.kept) + row('Grade A (75+)', cf.buckets.A) + row('Grade B (60–74)', cf.buckets.B) + row('Grade C (45–59)', cf.buckets.C) + row('Grade D (under 45)', cf.buckets.D) + '</tbody></table>'
            + '<p class="mem-blurb">If the filtered row is not better than the unfiltered row, the extra checks are not helping on this chart. With so few trades this is a sanity check, not proof — the same numbers on other tickers are worth comparing.</p></div>';
        }
        html += '<div class="mem-sec"><h5>Is it robust? In-sample vs out-of-sample</h5><table class="mem-split"><thead><tr><th></th><th>Trades</th><th>Win</th><th>Expectancy</th></tr></thead><tbody>' + splitRow('First 70% (tuned on)', d.inSample) + splitRow('Last 30% (unseen)', d.outOfSample) + '</tbody></table><p class="mem-blurb">If the unseen part is much worse than the first part, the setup was probably fitted to old data.</p></div>';
      }
    }
    html += '<div class="mem-sec"><h5>Show on chart</h5>'
      + [['ema', 'EMA lines'], ['signals', 'Buy / sell markers'], ['levels', 'Stop & target levels'], ['book', 'Level 2 book walls']].map((o) => '<label class="mem-row"><input type="checkbox" data-mem-ov="' + o[0] + '"' + (S.overlays[o[0]] ? ' checked' : '') + '> ' + o[1] + '</label>').join('') + '</div>';
    const fields = [['fast', 'Fast EMA'], ['slow', 'Slow EMA'], ['trend', 'Trend EMA'], ['atr', 'ATR length'], ['minSep', 'Price gap to slow EMA (×ATR)'], ['confirm', 'Confirm bars'], ['stopAtr', 'Stop (×ATR)'], ['targetAtr', 'Target (×ATR)'], ['minScore', 'Minimum conviction (0–100)'], ['trail', 'Trailing stop (×ATR)'], ['maxSep', 'Skip if stretched beyond (×ATR)'], ['maxHold', 'Max hold (candles)'], ['costBps', 'Cost (bps/side)']].filter((f) => p[f[0]] != null);
    html += '<div class="mem-sec"><details><summary>Settings</summary><div class="mem-set">' + fields.map((f) => '<label>' + f[1] + '<input type="number" step="any" data-mem-p="' + f[0] + '" value="' + esc(p[f[0]]) + '"></label>').join('') + '</div><button type="button" class="mem-btn" data-mem="reset">Reset to defaults</button></details></div>';
    /* the model's rules are not repeated here: the Settings section above shows every parameter the model runs on */
    html += '<div class="mem-foot">Educational simulation on closed candles. Past results do not predict future returns. Not financial advice, and nothing here places a trade.</div>';
    // Repaints arrive every few seconds (candle refreshes, the 20s timer). Replacing the markup would throw the reader back to the top
    // and fold the Settings / rules sections, so unchanged markup is left alone and otherwise the scroll position and open sections survive.
    if (html !== S.lastHtml) {
      const scrollTop = panel.scrollTop;
      const openSections = new Set(Array.from(panel.querySelectorAll('details[open] > summary')).map((s) => s.textContent));
      panel.innerHTML = html; S.lastHtml = html;
      panel.querySelectorAll('details').forEach((d) => { const s = d.querySelector('summary'); if (s && openSections.has(s.textContent)) d.open = true; });
      panel.scrollTop = scrollTop;
    }
    paintOF();
  }

  // ---- Level 2 order flow (server-side reading; the panel only displays it) ----
  const gradeText = { confirms: 'Book confirms', disagrees: 'Book disagrees', neutral: 'Book neutral', unavailable: 'Book unavailable' };
  function bar(score) { const w = Math.min(50, Math.abs(score) / 2); return '<div class="mem-meter"><em></em><i style="' + (score >= 0 ? 'left:50%;background:#00d084' : 'right:50%;background:#ff5470') + ';width:' + w + '%"></i></div>'; }
  function paintOF() {
    const box = panel.querySelector('#mem-of'); if (!box) return;
    const o = S.of && S.of.symbol === symbol() ? S.of : null;
    let h = '<h5>Order flow · Level 2</h5>';
    if (!o) h += '<div class="mem-blurb" style="margin-top:0">' + esc(S.ofErr || 'Reading the order book…') + '</div>';
    else if (o.closed && !o.ready) h += '<div class="mem-warn">The market is closed, so there is no live order book. Order flow updates during market hours.</div>';
    else if (!o.ready) h += '<div class="mem-blurb" style="margin-top:0">Collecting order flow… ' + (o.snapshots || 0) + ' of ' + (o.needed || 12) + ' book snapshots. It needs about half a minute of live data before it can read anything.</div>';
    else {
      const cls = o.bias === 'bullish' ? 'bull' : (o.bias === 'bearish' ? 'bear' : 'flat');
      h += '<span class="mem-of-chip ' + cls + '">' + esc(o.bias.toUpperCase()) + '</span> <span class="mem-blurb">score ' + (o.score > 0 ? '+' : '') + o.score + ' (−100 to +100)</span>' + bar(o.score);
      if (o.stale || o.closed || o.failing) h += '<div class="mem-warn" style="margin:6px 0">' + (o.closed ? 'The book has stopped updating (market closed?).' : 'Order flow is not updating right now, so it is not being graded.') + '</div>';
      const m = o.momentum, a = o.absorption;
      h += '<div class="mem-of-row"><b>Pulling &amp; stacking</b> · ' + esc(m.label) + ' (' + (m.score > 0 ? '+' : '') + m.score + ')' + bar(m.score) + 'Bid depth ×' + m.stackBid.toFixed(1) + ', ask depth ×' + m.stackAsk.toFixed(1) + ' vs normal' + (m.pulledAsk > 0.15 ? ' · <b>asks pulled ' + Math.round(m.pulledAsk * 100) + '%</b>' : '') + (m.pulledBid > 0.15 ? ' · <b>bids pulled ' + Math.round(m.pulledBid * 100) + '%</b>' : '') + '</div>';
      h += '<div class="mem-of-row"><b>Absorption</b> · ' + (a.state === 'bull' ? 'bullish — ' + a.sellVol.toLocaleString() + ' shares sold into the bid and price held' : (a.state === 'bear' ? 'bearish — ' + a.buyVol.toLocaleString() + ' shares bought into the ask and price stalled' : 'none right now')) + (a.iceberg ? '<br>Possible iceberg at <b>' + a.iceberg.price.toFixed(2) + '</b>: ' + Math.round(a.iceberg.vol).toLocaleString() + ' traded vs ' + Math.round(a.iceberg.shown).toLocaleString() + ' shown' : '') + '</div>';
      h += '<div class="mem-of-row"><b>Bid/ask flip</b> · ' + (o.flip ? (o.flip.side === 'bull' ? 'resistance flipped to support at ' : 'support flipped to resistance at ') + '<b>' + Number(o.flip.price).toFixed(2) + '</b> (' + Math.max(0, Math.round((Date.now() - o.flip.at) / 1000)) + 's ago)' : 'none right now') + '</div>';
      const maxSz = Math.max(1, ...o.book.bids.map((x) => x.size), ...o.book.asks.map((x) => x.size));
      h += '<div class="mem-ladder"><div style="grid-column:1/-1;color:#7f98a6;font-size:.6rem">TOP OF BOOK · spread ' + o.book.spread.toFixed(2) + '</div>'
        + '<div>' + o.book.bids.map((x) => '<div class="b"><i style="width:' + Math.round(x.size / maxSz * 100) + '%"></i><span>' + x.price.toFixed(2) + '</span><span>' + x.size.toLocaleString() + '</span></div>').join('') + '</div>'
        + '<div>' + o.book.asks.map((x) => '<div class="a"><i style="width:' + Math.round(x.size / maxSz * 100) + '%"></i><span>' + x.price.toFixed(2) + '</span><span>' + x.size.toLocaleString() + '</span></div>').join('') + '</div></div>';
      if ((o.events || []).length) h += '<div style="margin-top:8px">' + o.events.slice(0, 5).map((e) => '<div class="mem-ev"><u class="' + e.side + '"></u>' + esc(new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })) + ' · ' + esc(e.note) + '</div>').join('') + '</div>';
      h += depthHtml(o.depth);
      h += sweepHtml(o.sweepWall);
      h += measuredHtml(o.depth);
      h += '<p class="mem-blurb">Level 2 is a reading of what buyers and sellers are doing, not a prediction. Every signal is being recorded with what price did next, so it can be measured before anyone relies on it.</p>';
    }
    if (h !== S.lastOfHtml) {
      // The order-flow box sits above the signal and backtest sections; when it grows or shrinks, keep whatever the reader is looking at in place.
      const before = box.offsetHeight, above = panel.scrollTop > box.offsetTop;
      box.innerHTML = h; S.lastOfHtml = h;
      const delta = box.offsetHeight - before;
      if (delta && above) panel.scrollTop += delta;
    }
    const g = panel.querySelector('#mem-grade');
    if (g) { const dir = Number(g.dataset.dir), gr = o && o.grades ? (dir > 0 ? o.grades.long : o.grades.short) : null; g.innerHTML = gr ? 'Level 2 vs this ' + (dir > 0 ? 'BUY' : 'SELL') + ': <b class="' + gr.grade + '">' + gradeText[gr.grade] + '</b> <span class="mem-blurb">' + esc(gr.reason) + '</span>' : ''; }
  }
  /* ---- The week: the daily flow ledger (academy-flow-daily.js) read by academy-flow-read.js ----
     One bar per trading day (the day's delta ratio, buying up and selling down), the running CVD against price, the large-print,
     sweep and block leans, moomoo's institutional net, the book's daily pressure, then the week-says verdict for the open mode. */
  function weekHtml() {
    const W = S.ctx && S.ctx.flowDays, FRd = window.SmlFlowRead, d = S.data;
    if (!W || !W.ok || !W.window) return '';
    const w = W.window;
    let h = '<div class="mem-sec"><h5>The week · daily flow · $' + esc(symbol()) + '</h5>';
    if (!w.available || !W.days.length) return h + '<div class="mem-blurb" style="margin-top:0">No daily flow recorded for this ticker yet. The ledger fills in while members have it on the chart during market hours; SPY and QQQ are always recorded.</div></div>';
    const cls = w.score >= 25 ? 'bull' : w.score <= -25 ? 'bear' : 'flat';
    h += '<span class="mem-of-chip ' + cls + '">' + esc(w.label.toUpperCase()) + '</span> <span class="mem-blurb">' + (w.score > 0 ? '+' : '') + w.score + ' over ' + w.days + ' day' + (w.days === 1 ? '' : 's') + (w.partial ? ' (today still filling)' : '') + '</span>' + bar(w.score);
    const maxAbs = Math.max(0.2, ...W.days.map((x) => Math.abs(x.deltaRatio || 0)));
    h += '<div style="display:flex;gap:3px;align-items:flex-end;height:46px;margin:8px 0 2px;border-bottom:1px solid #1b3540">' + W.days.map((x) => { const r = x.deltaRatio || 0, hgt = Math.max(2, Math.round(Math.abs(r) / maxAbs * 40)); return '<div title="' + esc(x.day + ': delta ' + Math.round(r * 100) + '%, ' + (x.buy + x.sell).toLocaleString() + ' tagged shares' + (x.pressure != null ? ', pressure ' + x.pressure : '') + (x.partial ? ' (partial)' : '')) + '" style="flex:1;height:' + hgt + 'px;border-radius:2px 2px 0 0;background:' + (r >= 0 ? '#00d084' : '#ff5470') + (x.partial ? ';opacity:.55' : '') + '"></div>'; }).join('') + '</div>';
    h += '<div style="display:flex;justify-content:space-between;font:.56rem ui-monospace,monospace;color:#6f8794;margin-bottom:6px"><span>' + esc(W.days[0].day.slice(5)) + '</span><span>net ' + (w.cvd >= 0 ? 'bought ' : 'sold ') + esc(FRd ? FRd.fmtShares(Math.abs(w.cvd)) : String(Math.abs(w.cvd))) + '</span><span>' + esc(W.days[W.days.length - 1].day.slice(5)) + '</span></div>';
    h += (w.components || []).map((c) => '<div class="mem-ev"><u class="' + (c.pts >= 0 ? 'bull' : 'bear') + '"></u>' + esc(c.label) + ' <b>' + (c.pts > 0 ? '+' : '') + c.pts + '</b> · ' + esc(c.detail) + '</div>').join('');
    h += (w.lines || []).slice(0, 3).map((l) => '<div class="mem-ev" style="color:#9fb3be">' + esc(l) + '</div>').join('');
    const dirNow = d ? (d.open ? d.open.dir : (d.latest && d.bars - 1 - d.latest.i <= 30 ? d.latest.dir : 0)) : 0;
    if (FRd && dirNow) {
      const wr = FRd.weekRead(S.mode, dirNow, W), v = VERDICT[wr.verdict] || VERDICT.none;
      const what = d.open ? 'the open ' + (dirNow > 0 ? 'LONG' : 'SHORT') : 'the last ' + (dirNow > 0 ? 'BUY' : 'SELL') + ' signal';
      h += '<div class="mem-conv' + (wr.verdict === 'exit' || wr.verdict === 'trim' ? ' warnbox' : '') + '"><b>Week says · <span class="mem-of-chip ' + v[0] + '">' + v[1] + '</span> ' + esc((E.STRATEGIES[S.mode] || {}).label || S.mode) + ' · ' + esc(what) + '</b>'
        + (wr.reasons.length ? '<ul>' + wr.reasons.map((r) => '<li class="' + (r.tone === 'for' ? 'ok' : 'no') + '"><span>' + (r.tone === 'for' ? '✓' : '✗') + '</span> ' + esc(r.text) + '</li>').join('') + '</ul>' : '<br><small>Nothing in the week argues with the position.</small>')
        + '<small>' + esc(wr.note) + '</small></div>';
    }
    return h + '<p class="mem-bdn" style="margin:6px 0 0">Folded once a minute from the tape (Massive when watched, otherwise moomoo prints), the full-depth pressure, the Level 2 events and moomoo\'s size buckets. Educational, not a recommendation.</p></div>';
  }
  /* ---- How these have done (academy-signal-outcomes.js): every newer signal stamped when it fired and scored later; the rows that match
     what the book is saying right now come first, the rest fold under a summary. Under 20 measured samples is labelled as still collecting. ---- */
  const SIG_NAME = { pressure: 'Pressure', microprice: 'Microprice tilt', divergence: 'CVD divergence', large: 'Large prints', refill: 'Replenishment', week: 'The week' };
  const OUT_NAME = { breakout_confirmed: 'Sweep: breakout confirmed', sweep_absorbed: 'Sweep absorbed', false_break: 'Sweep: false break' };
  function measuredHtml(D) {
    const O = S.outcomes; if (!O || !O.ok) return '';
    const pct = (v) => (v == null ? '–' : Math.round(v * 100) + '%');
    const mv = (v) => (v == null ? '' : ' · avg ' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
    const row = (label, h, side) => { const m = h.measured || 0; return '<div class="mem-ev"><u class="' + side + '"></u>' + esc(label) + ' · ' + (m >= 20 ? '<b>' + pct(h.hitRate) + ' right</b>' + mv(h.avgPct) + ' · n=' + m : '<span style="color:#7f98a6">collecting (' + m + ' measured)</span>') + '</div>'; };
    const live = new Set();
    if (D && D.ready) { const sc = D.pressure.score; if (Math.abs(sc) >= 25) live.add('pressure:' + (sc > 0 ? 'bull' : 'bear')); if (Math.abs(D.book.microTilt) >= 0.3) live.add('microprice:' + (D.book.microTilt > 0 ? 'bull' : 'bear')); if (D.flow.divergence) live.add('divergence:' + (D.flow.divergence === 'bullish' ? 'bull' : 'bear')); }
    const depth = (O.depth || []).slice().sort((a, b) => (live.has(b.signal + ':' + b.side) ? 1 : 0) - (live.has(a.signal + ':' + a.side) ? 1 : 0) || b.n - a.n);
    let h = '<div class="mem-of-row"><b>How these have done</b> · <span class="mem-blurb">last ' + O.days + ' days, five minutes later</span>';
    const top = depth.filter((r) => live.has(r.signal + ':' + r.side)), rest = depth.filter((r) => !live.has(r.signal + ':' + r.side));
    if (!depth.length && !(O.sweeps || []).length && !(O.week || []).length) h += '<br><span class="mem-blurb">Nothing measured yet. Every signal that fires from now on is stamped and scored, and the numbers appear here as they come in.</span>';
    for (const r of top) h += row((SIG_NAME[r.signal] || r.signal) + ' ' + r.side + (r.bucket ? ' (' + r.bucket + ')' : '') + ' · on now', r.horizons.outcome_5m, r.side);
    for (const s of O.sweeps || []) h += row((OUT_NAME[s.outcome] || s.outcome) + ' ' + s.side, { measured: s.measured, hitRate: s.hitRate, avgPct: s.avgPct }, s.side);
    for (const r of O.week || []) h += row('The week ' + r.side + (r.bucket ? ' (' + r.bucket + ')' : '') + ' · 3 days later', r.horizons.outcome_3d, r.side);
    if (rest.length) h += '<details><summary>Every measured signal (' + rest.length + ')</summary>' + rest.map((r) => row((SIG_NAME[r.signal] || r.signal) + ' ' + r.side + (r.bucket ? ' (' + r.bucket + ')' : ''), r.horizons.outcome_5m, r.side)).join('') + '</details>';
    return h + '<small style="display:block;margin-top:4px;color:#6f8794">"Right" means price moved the signal\'s way from the moment it fired. Below 20 samples the number means little; the rule stays educational either way.</small></div>';
  }
  /* ---- Sweep versus wall (academy-sweep-wall.js): aggressive sweeps against the walls the Level 2 reader tracks, scored on the next snapshots ---- */
  const SW_LABEL = { breakout_confirmed: 'BREAKOUT CONFIRMED', sweep_absorbed: 'SWEEP ABSORBED', false_break: 'FALSE BREAK' };
  function sweepHtml(SW) {
    if (!SW) return '';
    const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'; };
    let h = '<div class="mem-of-row"><b>Sweep vs wall</b>';
    if (SW.read) h += ' · <span class="mem-of-chip ' + (SW.read.bias === 'bull' ? 'bull' : 'bear') + '">' + esc(SW_LABEL[SW.read.lastOutcome] || SW.read.lastOutcome) + '</span>';
    if (!SW.events.length && !SW.pending.length) h += '<br><span class="mem-blurb">No sweep has reached a tracked wall yet. When one does, the next snapshots decide: the wall eaten and price holding is a confirmed breakout; the wall refilling and price pushed back is a sweep absorbed.</span>';
    for (const p of SW.pending) h += '<div class="mem-ev"><u style="background:#ffd166"></u>watching: ' + (p.dir === 'B' ? 'buy' : 'sell') + ' sweep of ' + Number(p.sweepSize).toLocaleString() + ' into the ' + Number(p.wallSize).toLocaleString() + ' wall at ' + Number(p.wall).toFixed(2) + ' · held ' + p.held + ' snapshot' + (p.held === 1 ? '' : 's') + ' · ' + ago(p.since) + '</div>';
    for (const e of SW.events.slice(0, 5)) h += '<div class="mem-ev"><u class="' + e.side + '"></u><b>' + esc(SW_LABEL[e.outcome] || e.outcome) + '</b> ' + esc(ago(e.t)) + ' · ' + esc(e.note) + '</div>';
    return h + '</div>';
  }
  /* ---- Level 3: the full book (up to 60 levels with the orders behind each) and the tape, read by academy-depth-insights.js ----
     Pressure with its components, the walls and air pockets, then the hold / add / trim / exit read for the mode that is open and the
     direction of its open or latest signal, and the options timing for that side. */
  const VERDICT = { hold: ['flat', 'HOLD'], add: ['bull', 'ADD'], trim: ['bear', 'TRIM'], exit: ['bear', 'EXIT'], wait: ['flat', 'WAIT'], none: ['flat', 'NO READ'] };
  function depthHtml(D) {
    if (!D) return '';
    if (!D.ready) return '<div class="mem-of-row"><b>Level 3 · full book &amp; tape</b> · <span class="mem-blurb">' + esc(D.reason === 'closed' ? 'no book while the market is closed' : D.reason === 'warming' || D.reason === 'not_tracked' ? 'collecting the full book…' : 'not readable right now (' + (D.reason || '') + ')') + '</span></div>';
    const P = D.pressure, pcls = P.score >= 25 ? 'bull' : P.score <= -25 ? 'bear' : 'flat';
    let h = '<div class="mem-of-row"><b>Level 3 · full book &amp; tape</b> · <span class="mem-of-chip ' + pcls + '">' + esc(P.label.toUpperCase()) + '</span> <span class="mem-blurb">' + (P.score > 0 ? '+' : '') + P.score + ' (−100 to +100) · ' + D.book.levels.bid + '×' + D.book.levels.ask + ' levels</span>' + bar(P.score);
    h += P.components.map((c) => '<div class="mem-ev"><u class="' + (c.pts >= 0 ? 'bull' : 'bear') + '"></u>' + esc(c.label) + ' <b>' + (c.pts > 0 ? '+' : '') + c.pts + '</b> · ' + esc(c.detail) + '</div>').join('');
    h += D.read.lines.slice(1).map((l) => '<div class="mem-ev" style="color:' + (l.tone === 'up' ? '#9ff0cf' : l.tone === 'down' ? '#ffb3c0' : l.tone === 'warn' ? '#ffd166' : '#9fb3be') + '">' + esc(l.text) + '</div>').join('');
    h += '</div>';
    const DI = window.SmlDepthInsights, d = S.data;
    const dirNow = d ? (d.open ? d.open.dir : (d.latest && d.bars - 1 - d.latest.i <= 30 ? d.latest.dir : 0)) : 0;
    if (DI && d && dirNow) {
      const atr = d.ind && d.ind.atr ? d.ind.atr[d.bars - 1] : null;
      const hr = DI.holdRead(S.mode, dirNow, D, { price: D.book.mid, atr });
      const v = VERDICT[hr.verdict] || VERDICT.none, what = d.open ? 'the open ' + (dirNow > 0 ? 'LONG' : 'SHORT') : 'the last ' + (dirNow > 0 ? 'BUY' : 'SELL') + ' signal';
      h += '<div class="mem-conv' + (hr.verdict === 'exit' || hr.verdict === 'trim' ? ' warnbox' : '') + '"><b>Book says · <span class="mem-of-chip ' + v[0] + '">' + v[1] + '</span> ' + esc((E.STRATEGIES[S.mode] || {}).label || S.mode) + ' · ' + esc(what) + '</b>'
        + (hr.reasons.length ? '<ul>' + hr.reasons.map((r) => '<li class="' + (r.tone === 'for' ? 'ok' : 'no') + '"><span>' + (r.tone === 'for' ? '✓' : '✗') + '</span> ' + esc(r.text) + '</li>').join('') + '</ul>' : '<br><small>Nothing in the book or the tape argues with the position right now.</small>')
        + '<small>' + esc(hr.note) + '</small></div>';
      const op = DI.optionsRead(D, dirNow);
      h += '<div class="mem-conv"><b>Options timing · ' + (dirNow > 0 ? 'calls' : 'puts') + ' · <span class="mem-of-chip ' + (op.timing === 'good' ? 'bull' : op.timing === 'poor' ? 'bear' : 'flat') + '">' + esc(op.timing.toUpperCase()) + '</span></b><ul>' + op.why.map((w) => '<li class="na"><span>·</span> ' + esc(w) + '</li>').join('') + '</ul><small>Timing on the underlying\'s book only: strike, expiry and the Greeks are in Hedge &amp; income ideas.</small></div>';
    }
    return h;
  }
  async function pollOF() {
    if (!S.on || S.ofBusy || (document.hidden && S.of)) return;
    S.ofBusy = true;
    try {
      const r = await fetch('/academy-activity/orderflow?symbol=' + encodeURIComponent(symbol()), { cache: 'no-store' });
      const p = await r.json(); if (!r.ok) throw new Error('of');
      S.of = p; S.ofErr = '';
    } catch (_) { S.ofErr = 'Order flow is not available right now.'; }
    S.ofBusy = false; paintOF(); if (S.overlays.book) draw();
  }

  // ---- overlay drawing (mirrors the chart's own geometry so markers sit exactly on the candles) ----
  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer); // the chart is moved into its stage after this script starts
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, h);
    if (!S.on || !S.data || !w || !h) return;
    let st; try { st = window.smlAcademyChartState(); } catch (_) { return; }
    const bars = st.bars || []; if (!bars.length) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const pad = M.pad, pw = M.pw, ph = M.ph, view = M.view, lo = M.lo, hi = M.hi;
    const y = (v) => M.y(v), step = M.step, x = (j) => M.x(M.start + j);
    const d = S.data, ind = d.ind, ai = (j) => S.idx.get(Number(view[j].t));
    lctx.save(); lctx.beginPath(); lctx.rect(pad.l, pad.t, pw, ph); lctx.clip();
    if (S.overlays.ema) {
      // Price-derived lines stay inside the price pane: a long EMA sitting far under a rally must
      // stop at the pane edge, not run on through the volume bars below it.
      lctx.save(); lctx.beginPath(); lctx.rect(pad.l, pad.t, pw, M.priceH || ph); lctx.clip();
      [['fast', '#4dd8ff', 1.4], ['slow', '#ffa94d', 1.4], ['trend', 'rgba(170,185,195,.75)', 2]].forEach(([k, color, lw]) => {
        lctx.beginPath(); let started = false;
        for (let j = 0; j < view.length; j++) { const a = ai(j); const v = a == null ? NaN : ind[k][a]; if (!Number.isFinite(v)) { started = false; continue; } if (started) lctx.lineTo(x(j), y(v)); else { lctx.moveTo(x(j), y(v)); started = true; } }
        lctx.strokeStyle = color; lctx.lineWidth = lw; lctx.stroke();
      });
      lctx.restore();
    }
    if (S.overlays.signals) {
      lctx.font = '800 9px ui-monospace,monospace'; lctx.textAlign = 'center';
      for (let j = 0; j < view.length; j++) {
        const a = ai(j); if (a == null) continue;
        const sg = d.signals.find((s) => s.i === a); if (!sg) continue;
        const buy = sg.dir > 0, px = x(j), py = buy ? y(+view[j].l) + 12 : y(+view[j].h) - 12;
        lctx.fillStyle = buy ? '#00d084' : '#ff5470'; lctx.beginPath();
        if (buy) { lctx.moveTo(px, py - 7); lctx.lineTo(px - 6, py + 4); lctx.lineTo(px + 6, py + 4); } else { lctx.moveTo(px, py + 7); lctx.lineTo(px - 6, py - 4); lctx.lineTo(px + 6, py - 4); }
        lctx.closePath(); lctx.fill(); lctx.fillText((buy ? 'BUY' : 'SELL') + (sg.conf ? ' ' + sg.conf.grade : ''), px, buy ? py + 15 : py - 10);
      }
    }
    lctx.restore();
    if (S.overlays.book && S.of && S.of.symbol === symbol() && !S.of.stale && Array.isArray(S.of.walls)) {
      S.of.walls.forEach((wl) => {
        if (wl.price < lo || wl.price > hi) return; const yy = y(wl.price), color = wl.side === 'bid' ? '0,208,132' : '255,84,112';
        lctx.fillStyle = 'rgba(' + color + ',.16)'; lctx.fillRect(pad.l, yy - 2, pw, 4);
        lctx.fillStyle = 'rgb(' + color + ')'; lctx.font = '700 9px ui-monospace,monospace'; lctx.textAlign = 'right'; lctx.fillText((wl.side === 'bid' ? 'BID WALL ' : 'ASK WALL ') + Math.round(wl.size).toLocaleString(), pad.l + pw - 4, yy - 4);
      });
    }
    if (S.overlays.levels) {
      const lv = d.open ? { dir: d.open.dir, stop: d.open.stop, target: d.open.target, entry: d.open.entry } : (d.latest && d.bars - 1 - d.latest.i <= 30 ? { dir: d.latest.dir, stop: d.latest.stop, target: d.latest.target, entry: d.latest.price } : null);
      if (lv) [['STOP', lv.stop, '#ff5470'], ['TARGET', lv.target, '#00d084']].forEach(([label, price, color]) => {
        if (price == null || price < lo || price > hi) return; const yy = y(price);
        lctx.save(); lctx.setLineDash([5, 4]); lctx.strokeStyle = color; lctx.lineWidth = 1; lctx.beginPath(); lctx.moveTo(pad.l, yy); lctx.lineTo(pad.l + pw, yy); lctx.stroke(); lctx.restore();
        lctx.fillStyle = color; lctx.font = '700 9px ui-monospace,monospace'; lctx.textAlign = 'left'; lctx.fillText(label + ' ' + price.toFixed(2), pad.l + 4, yy - 3);
      });
    }
  }

  // ---- events ----
  toggle.addEventListener('click', () => {
    const wasOn = S.on;
    if (S.on && S.open) { S.on = false; S.open = false; S.tfNote = null; } else { S.on = true; S.open = true; }
    if (S.on && !wasOn) autoTf(); // switching MEM ALGO on puts the chart on the mode's interval (re-opening a closed panel does not)
    save(); paint(); draw(); if (S.on) { refresh(true); pollOF(); }
  });
  panel.addEventListener('click', (e) => {
    // the "Switch chart to <interval>" button carries data-mem-tf only, so the selector must name it or the click matches nothing
    const t = e.target.closest('[data-mem],[data-mem-mode],[data-mem-tf],[data-mem-scn]'); if (!t) return;
    if (t.dataset.memScn) { if (window.smlMemScenarios && window.smlMemScenarios.onClick(t.dataset.memScn)) { paint(); } return; }
    if (t.dataset.memTf) {
      const sy = symbol(), target = t.dataset.memTf;
      t.disabled = true; t.textContent = 'Switching to ' + target + '…';
      const done = () => { S.sigKey = ''; paint(); draw(); refresh(true); };
      if (window.smlAcademyNavigateMarket) Promise.resolve(window.smlAcademyNavigateMarket(sy, target)).then(done, done); else done();
      return;
    }
    if (t.dataset.mem === 'close') { S.open = false; paint(); return; }
    if (t.dataset.mem === 'hedge') { if (window.smlHedgePanel && window.smlHedgePanel.open) window.smlHedgePanel.open(readState()); return; }
    if (t.dataset.mem === 'reset') { S.params[S.mode] = {}; save(); recompute(); paint(); draw(); return; }
    if (t.dataset.memMode) { S.mode = t.dataset.memMode; if (window.smlMemScenarios) window.smlMemScenarios.clear(); autoTf(); save(); recompute(); loadCtx(); paint(); draw(); }
  });
  panel.addEventListener('change', (e) => {
    const ov = e.target.closest('[data-mem-ov]'), pr = e.target.closest('[data-mem-p]');
    if (ov) { S.overlays[ov.dataset.memOv] = ov.checked; save(); draw(); }
    if (pr) { S.params[S.mode][pr.dataset.memP] = pr.value; save(); recompute(); paint(); draw(); }
  });
  // Redraw in the SAME frame as the candles (the chart view model announces every change), instead of polling the chart 60 times a second.
  window.addEventListener('sml-chart-view', () => { try { if (window.smlPerfTime) window.smlPerfTime('memalgo', draw); else draw(); } catch (_) { /* chart not ready yet */ } });
  setInterval(() => { try { if (S.on && S.sigKey !== symbol() + ':' + tf() && !S.loading) refresh(true); } catch (_) { /* chart not ready yet */ } }, 500);
  setInterval(() => { if (S.on) refresh(false); }, 20000);
  setInterval(pollOF, 2500);
  window.addEventListener('sml-academy-market', () => { if (S.on) setTimeout(() => refresh(true), 300); });
  paint(); if (S.on) { refresh(true); pollOF(); }
})();
