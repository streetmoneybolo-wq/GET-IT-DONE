/* Options desk for the Academy Live Chart Lab.
 *  CHAIN  a toolbar switch that puts the stock's options chain where the candles are (the whole chart stage), and brings the
 *         candles back with one more click. The chain is the same verified College Options Chain Lab, moved, not copied.
 *  MINI   double-click a call or a put in the chain (wherever the chain is) and that contract's own chart opens in the insight
 *         column (where the SMART MONEY MAP and MEM ALGO panels open): the contract's premium as candles, its last and change,
 *         the row's bid / ask / mid / volume / open interest / IV / delta, a timeframe row, and one-click Buy / Sell buttons
 *         for the brokers chosen in Settings. Hedge ideas can open it too ('sml-option-mini').
 *  Server: GET /academy-activity/option-bars?contract=<OCC>&tf=5m (members). Needs window.SmlOptionContract and the chain. */
(function boot(tries) {
  if (window.__smlOptionsDesk) return;
  const OC = window.SmlOptionContract;
  const stage = document.querySelector('.academy-chart-stage'), toolbar = document.querySelector('.toolbar'), chartSec = document.querySelector('main .chart');
  const chain = document.getElementById('options-chain'), grid = document.getElementById('options-grid');
  if (!OC || !stage || !toolbar || !chartSec || !chain || !grid) { if (tries < 150) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlOptionsDesk = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const s = String(v == null ? '' : v).trim(); if (!s || s === '—' || s === '–') return null; const n = Number(s.replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
  const money = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(d));
  const symbolNow = () => String(($('symbol') || {}).value || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10) || 'SPY';
  const expiryNow = () => { const exp = $('options-expiry'); const m = /[0-9]{4}-[0-9]{2}-[0-9]{2}/.exec(exp ? (exp.value || (exp.selectedOptions && exp.selectedOptions[0] || {}).textContent || '') : ''); return m ? m[0] : ''; };

  const css = document.createElement('style');
  css.textContent = '#chain-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#chain-toggle.on{background:#12405a;border-color:#4dc3ff;color:#fff}'
    /* the chain takes the stage's grid cell; the stage (candles and every layer on them) is hidden, not removed, so nothing re-mounts */
    + '#chain-stage{display:none;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid #1b3540;border-radius:8px;background:#0a1118}'
    + 'body.sml-chain-on main .chart>.academy-chart-stage{display:none!important}body.sml-chain-on #chain-stage{display:block}body.dock-open main .chart>#chain-stage{grid-column:1}'
    + '#chain-stage>.options-chain{margin:0;border:0;border-radius:0;background:transparent}#chain-stage .options-table-wrap{max-height:none}'
    + '#chain-stage .chain-back{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid #1b3540;color:#8fa6b3;font:700 .64rem system-ui}#chain-stage .chain-back button{border:1px solid #4dc3ff;border-radius:6px;background:#12405a;color:#fff;font:800 .62rem ui-monospace,monospace;padding:4px 9px;cursor:pointer}'
    + '.options-dock.chain-away{grid-template-columns:1fr}'
    /* the contract mini chart: a card in the insight column (or the chart dock when it has room); phones get a bottom sheet */
    + '#opt-mini{position:absolute;right:74px;top:26px;z-index:9;width:min(300px,calc(100% - 96px));max-height:calc(100% - 60px);overflow:auto;background:rgba(9,15,24,.96);border:1px solid #2f6cf5;border-radius:10px;color:#dbe6ec;font:600 .64rem/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5);display:none}#opt-mini.open{display:block}'
    + '#opt-mini header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #1d3a5a}#opt-mini header b{font:800 .64rem ui-monospace,monospace;color:#9cc8ff;letter-spacing:.06em}#opt-mini header span.x{margin-left:auto;color:#8fa6b3;cursor:pointer;font-weight:800;padding:0 4px}#opt-mini header span.x:hover{color:#fff}'
    + '#opt-mini .nm{padding:7px 9px 0;color:#fff;font:800 .74rem system-ui}#opt-mini .nm code{display:block;color:#ffd166;font:700 .6rem ui-monospace,monospace;margin-top:2px}'
    + '#opt-mini .px{display:flex;align-items:baseline;gap:8px;padding:4px 9px 0}#opt-mini .px b{font:800 1.25rem ui-monospace,monospace;color:#fff}#opt-mini .px i{font-style:normal;font:800 .66rem ui-monospace,monospace}#opt-mini .px i.up{color:#52e6ad}#opt-mini .px i.down{color:#ff778b}#opt-mini .px small{color:#7f97a4;font-weight:600}'
    + '#opt-mini .tfs{display:flex;gap:4px;padding:6px 9px 0}#opt-mini .tfs button{border:1px solid #2b5362;border-radius:5px;background:#0d1a24;color:#9ed3e6;font:800 .58rem ui-monospace,monospace;padding:3px 7px;cursor:pointer}#opt-mini .tfs button.on{background:#12405a;border-color:#4dc3ff;color:#fff}#opt-mini .tfs small{margin-left:auto;color:#6f8794;font-weight:600;align-self:center}'
    + '#opt-mini canvas{display:block;width:calc(100% - 18px);height:150px;margin:6px 9px 0;border:1px solid #13262f;border-radius:7px;background:#07111a;cursor:crosshair}'
    + '#opt-mini .msg{padding:8px 9px 0;color:#8fa6b3;font-weight:500}#opt-mini .kv{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 6px;padding:7px 9px 0}#opt-mini .kv span{color:#7f97a4;font-size:.56rem;display:block}#opt-mini .kv b{font:800 .64rem ui-monospace,monospace;color:#eaf3f6}'
    + '#opt-mini .om-trade{padding:8px 9px 0}#opt-mini .om-trade h6{margin:0 0 4px;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em;color:#7f97a4}#opt-mini .om-trade .om-row{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:5px}'
    + '#opt-mini .om-trade button{border:1px solid;border-radius:6px;font:800 .62rem system-ui;padding:6px 9px;cursor:pointer;white-space:nowrap;flex:1 1 auto}#opt-mini .om-trade button.sell{filter:saturate(.7) brightness(.92)}'
    + '#opt-mini .om-trade button.big{flex:1 1 45%;padding:9px;font-size:.72rem}#opt-mini .om-trade button.alert{border-color:#1f8a5f;background:#0b2219;color:#7dffc4}'
    + '#opt-mini .hint{padding:6px 9px 8px;color:#6f8794;font-weight:500;font-size:.56rem;line-height:1.4}#opt-mini .hint.ok{color:#a8ffd8}'
    /* while the chain has the stage (which is hidden), a card the dock does not hold sits at the top of the chain instead */
    + '#chain-stage>#opt-mini{position:static;width:auto;max-height:none;margin:6px;display:none}#chain-stage>#opt-mini.open{display:block}'
    + '#opt-mini .om-tools{display:flex;flex-wrap:wrap;gap:4px;padding:6px 9px 0}#opt-mini .om-tools button{border:1px solid #2b5362;border-radius:5px;background:#0d1a24;color:#9ed3e6;font:800 .56rem ui-monospace,monospace;letter-spacing:.03em;padding:3px 6px;cursor:pointer}#opt-mini .om-tools button.on{background:#1c3444;border-color:#6fb8e0;color:#fff}#opt-mini .om-tools button.stock{border-style:dashed;color:#c9d6de}#opt-mini .om-tools button:disabled{opacity:.38;cursor:not-allowed}#opt-mini .om-tools i{flex-basis:100%;font-style:normal;color:#5f7986;font:800 .5rem ui-monospace,monospace;letter-spacing:.1em;margin-top:2px}'
    + '#opt-mini .om-read{padding:4px 9px 0;color:#9ed3e6;font:600 .58rem system-ui;line-height:1.35}#opt-mini header .om-home{margin-left:auto;border:1px solid #2b5362;border-radius:5px;background:#0d1a24;color:#9ed3e6;font:800 .54rem ui-monospace,monospace;padding:2px 6px;cursor:pointer}'
    + '@media(max-width:700px){#opt-mini{right:8px;top:auto;bottom:34px;max-height:60%}}';
  document.head.appendChild(css);

  /* ---------- CHAIN: the chain takes the stage ---------- */
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'chain-toggle'; btn.textContent = 'CHAIN'; btn.title = 'Show this stock’s options chain where the chart is (click again for the candles)'; btn.setAttribute('aria-pressed', 'false');
  const anchor = $('heat-toggle') || $('depth-toggle') || $('smc-toggle');
  if (anchor && anchor.parentElement === toolbar) anchor.after(btn); else toolbar.appendChild(btn);
  const chainStage = document.createElement('div'); chainStage.id = 'chain-stage'; chainStage.setAttribute('aria-label', 'Options chain in place of the chart');
  const back = document.createElement('div'); back.className = 'chain-back'; back.innerHTML = '<button type="button" data-chain-back="1">◀ CANDLES</button><span>Options chain for <b data-chain-sym style="color:#fff"></b> · double-click a call or a put for its own chart and Buy / Sell buttons</span>';
  chainStage.appendChild(back);
  stage.after(chainStage);
  const CH = { on: false, home: null };
  function setChain(on) {
    CH.on = !!on;
    btn.classList.toggle('on', CH.on); btn.setAttribute('aria-pressed', String(CH.on));
    document.body.classList.toggle('sml-chain-on', CH.on);
    const dock = $('options-dock');
    if (CH.on) {
      if (chain.parentElement !== chainStage) { CH.home = { parent: chain.parentElement, next: chain.nextSibling }; chainStage.appendChild(chain); }
      if (dock) dock.classList.add('chain-away');
      back.querySelector('[data-chain-sym]').textContent = '$' + symbolNow();
      /* nothing loaded yet: load the chain for the chart's symbol (the dock does the same once a session exists) */
      const load = $('load-options');
      if (load && !load.disabled && !grid.querySelector('tr') && window.smlAcademySessionToken) load.click();
    } else {
      if (CH.home && CH.home.parent && chain.parentElement === chainStage) { const h = CH.home; if (h.next && h.next.parentElement === h.parent) h.parent.insertBefore(chain, h.next); else h.parent.appendChild(chain); }
      if (dock) dock.classList.remove('chain-away');
    }
    if (card.parentElement === stage || card.parentElement === chainStage) rehome();
    setTimeout(() => window.dispatchEvent(new Event('resize')), 30); setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
  }
  btn.addEventListener('click', () => setChain(!CH.on));
  chainStage.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-chain-back]')) setChain(false); });
  window.addEventListener('sml-academy-market', () => { if (CH.on) back.querySelector('[data-chain-sym]').textContent = '$' + symbolNow(); });

  /* ---------- MINI: one contract's own chart ---------- */
  const TFS = ['1m', '5m', '15m', '1h', '1D'];
  const card = document.createElement('aside'); card.id = 'opt-mini'; card.setAttribute('aria-label', 'Options contract chart'); stage.appendChild(card);
  const M = { c: null, row: null, tf: '5m', bars: [], asOf: 0, msg: '', busy: false, timer: 0, hover: null, hint: '', hintOk: false, stale: false, geo: null, target: null, tools: [], home: 'chain', plan: null, planKey: '' };
  /* tools on the contract chart (academy-option-mini-tools.js decides which make sense) and where the card lives when the chain is below the chart */
  const TOOLS = () => window.SmlOptionMiniTools || null;
  try { const saved = JSON.parse(localStorage.getItem('sml-opt-mini-tools') || 'null'); M.tools = TOOLS() ? TOOLS().normalizeEnabled(Array.isArray(saved) ? saved : TOOLS().DEFAULTS) : []; } catch (_) { M.tools = TOOLS() ? TOOLS().DEFAULTS.slice() : []; }
  try { if (localStorage.getItem('sml-opt-mini-home') === 'chart') M.home = 'chart'; } catch (_) { /* ignore */ }
  const phoneNow = () => window.matchMedia('(max-width:700px)').matches;
  /* beside the chain = inside the options dock's sticky side column, so chain, calculator and contract chart share one screen */
  const chainSide = () => (!CH.on && M.home !== 'chart' && !phoneNow()) ? $('options-side') : null;
  const planKey = () => M.tools.join(',') + '|' + M.tf + '|' + M.bars.length + '|' + (M.bars.length ? M.bars[M.bars.length - 1].t + ':' + M.bars[M.bars.length - 1].c : '');
  try { const t = localStorage.getItem('sml-opt-mini-tf'); if (TFS.includes(t)) M.tf = t; } catch (_) { /* ignore */ }
  const openCard = () => card.classList.add('open');
  /* where the card lives when neither the dock nor the quote column has it: the stage, or the top of the chain while the chain has the stage */
  const home = () => (CH.on ? chainStage : stage);
  function rehome() { const h = home(); if (card.parentElement === h) return; if (h === chainStage) back.after(card); else stage.appendChild(card); }
  function closeCard() { card.classList.remove('open'); clearTimeout(M.timer); M.c = null; M.target = null; M.geo = null; CLEAR.forEach((k) => { card.style[k] = ''; }); if (!(window.smlChartDock && window.smlChartDock.holds(card))) rehome(); }
  /* same placement as MEM ALGO: the chart dock owns the card when it has room; otherwise it pops over the quote column; phones keep the sheet */
  const CLEAR = ['position', 'left', 'top', 'width', 'height', 'maxHeight', 'right', 'bottom', 'zIndex'];
  function place() {
    if (!M.c) return;
    const side = chainSide();
    if (side) { card.classList.add('dock-stay'); CLEAR.forEach((k) => { card.style[k] = ''; }); if (card.parentElement !== side) side.appendChild(card); return; }
    card.classList.remove('dock-stay');
    const dk = window.smlChartDock;
    if (dk && (dk.holds(card) || dk.room())) { if (card.style.position) CLEAR.forEach((k) => { card.style[k] = ''; }); return; }
    if (window.matchMedia('(max-width:700px)').matches) { CLEAR.forEach((k) => { card.style[k] = ''; }); rehome(); return; }
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 80 && getComputedStyle(el).display !== 'none' ? r : null; };
    const r = vis(document.querySelector('.side')) || vis($('academy-alerts'));
    if (!r) { CLEAR.forEach((k) => { card.style[k] = ''; }); rehome(); return; }
    if (card.parentElement !== document.body) document.body.appendChild(card);
    Object.assign(card.style, { position: 'fixed', left: Math.round(r.left) + 'px', top: Math.round(r.top) + 'px', width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px', maxHeight: 'none', right: 'auto', zIndex: '2147483150' });
  }
  window.addEventListener('resize', place); setInterval(place, 1500);

  function show(contract, row) {
    if (!contract) return;
    const same = M.c && OC.occSymbol(M.c) === OC.occSymbol(contract);
    M.c = contract; M.row = row || M.row || null;
    if (!same) { M.bars = []; M.asOf = 0; M.msg = 'Loading the contract’s candles…'; M.hint = ''; M.stale = false; M.target = null; M.geo = null; }
    openCard(); paint(); place();
    /* opened beside the chain while that part of the page is off screen: bring the pair into view rather than leave the member hunting */
    if (chainSide() && card.parentElement === chainSide()) { const r = card.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) { try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { card.scrollIntoView(); } } }
    if (!same || Date.now() - M.asOf > 15000) void load();
  }
  async function load() {
    if (!M.c || M.busy) return;
    clearTimeout(M.timer);
    const occ = OC.occSymbol(M.c), tf = M.tf;
    let token = window.smlAcademySessionToken;
    if (!token) { M.msg = 'Sign in to the Academy to see this contract’s chart.'; paint(); M.timer = setTimeout(load, 4000); return; }
    M.busy = true;
    try {
      const url = '/academy-activity/option-bars?contract=' + encodeURIComponent(occ) + '&tf=' + encodeURIComponent(tf);
      let res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { token = await window.smlAcademyReauth(); if (token) res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' }); }
      const j = await res.json().catch(() => null);
      if (!M.c || OC.occSymbol(M.c) !== occ || M.tf !== tf) return;
      if (j && j.ok) { M.bars = Array.isArray(j.bars) ? j.bars : []; M.asOf = Date.now(); M.stale = !!j.stale; M.msg = M.bars.length ? '' : 'No trades have printed for this contract on this timeframe yet.'; }
      else M.msg = res.status === 403 ? 'Contract charts are part of the full Academy.' : res.status === 503 ? 'Contract candles are not available right now.' : 'That contract could not be charted.';
    } catch (_) { M.msg = 'Contract candles are not available right now.'; }
    finally { M.busy = false; }
    paint();
    M.timer = setTimeout(load, document.hidden ? 60000 : (M.tf === '1D' ? 60000 : 20000));
  }

  function paint() {
    if (!M.c) return;
    const c = M.c, r = M.row || {}, bars = M.bars, last = bars.length ? bars[bars.length - 1] : null;
    const prev = bars.length > 1 ? bars[bars.length - 2].c : (last ? last.o : null);
    const lastPx = last ? last.c : (r.mid != null ? r.mid : null);
    const chg = last && prev != null && prev > 0 ? (last.c - prev) / prev : null;
    /* one Buy and one Sell on the member's broker, with a small picker to change the broker (never a row of four) */
    const P = window.smlBuyPrefs, brokers = P ? P.tradeBrokers() : [], prefs = P ? P.get() : { sell: true };
    const tradeBtn = (b, side) => '<button type="button" data-go="' + b.key + '" data-side="' + side + '" class="' + side + ' big" style="color:' + b.color + ';background:' + b.bg + ';border-color:' + b.border + '" title="' + esc(side === 'buy' ? 'Buy to open on ' + b.name : 'Sell on ' + b.name) + '">' + (side === 'buy' ? 'BUY' : 'SELL') + ' · ' + esc(b.name) + '</button>';
    const T = TOOLS();
    if (T && M.tools.length && bars.length) { if (M.planKey !== planKey()) { M.plan = T.plan(bars, M.tools, { smartMoney: window.SmlSmartMoney, levels: window.SmlSessionLevels, patterns: window.SmlPatterns }); M.planKey = planKey(); } } else { M.plan = null; M.planKey = ''; }
    const readLine = T && M.plan ? T.readLine(M.plan) : '';
    const toolRow = T ? '<div class="om-tools">' + T.TOOLS.filter((t) => t.group !== 'stock').map((t) => '<button type="button" data-tool="' + t.id + '" class="' + (M.tools.includes(t.id) ? 'on' : '') + '"' + (t.ok ? '' : ' disabled') + ' title="' + esc(t.why) + '">' + t.label + '</button>').join('')
      + '<i>FOR THE STOCK</i>' + T.TOOLS.filter((t) => t.group === 'stock').map((t) => '<button type="button" class="stock" data-stock="' + esc(t.target) + '" data-label="' + esc(t.label) + '" title="' + esc(t.why) + '">' + t.label + ' \u2197</button>').join('') + '</div>' : '';
    const homeBtn = (!CH.on && $('options-side') && !phoneNow()) ? '<button type="button" class="om-home" data-home="1" title="' + (M.home === 'chart' ? 'Move this chart down beside the options chain' : 'Move this chart up beside the stock chart') + '">' + (M.home === 'chart' ? '\u2193 by the chain' : '\u2191 by the chart') + '</button>' : '';
    const trade = brokers.length ? '<div class="om-row">' + tradeBtn(brokers[0], 'buy') + (prefs.sell ? tradeBtn(brokers[0], 'sell') : '') + '</div><small style="color:#7f97a4">on ' + (P && P.switcher ? P.switcher() : esc(brokers[0].name)) + '</small>' : '';
    card.innerHTML = '<header><b>CONTRACT CHART</b>' + homeBtn + '<span class="x" data-x="1" title="Close">×</span></header>'
      + '<div class="nm">' + esc(OC.describe(c)) + '<code>' + esc(OC.occSymbol(c)) + '</code></div>'
      + '<div class="px"><b>' + esc(money(lastPx)) + '</b>' + (chg != null ? '<i class="' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '+' : '') + (chg * 100).toFixed(1) + '%</i>' : '') + '<small>' + (last ? 'last trade · ' + esc(money(last.c * 100, 0)) + ' per contract' : r.mid != null ? 'mid from the chain' : '') + (M.stale ? ' · stale' : '') + '</small></div>'
      + '<div class="tfs">' + TFS.map((t) => '<button type="button" data-tf="' + t + '" class="' + (t === M.tf ? 'on' : '') + '">' + t + '</button>').join('') + '<small>' + (bars.length ? bars.length + ' candles' : '') + '</small></div>'
      + '<canvas width="10" height="10" aria-label="Candles of the contract’s price. Click a premium to set a Click-to-Alert target for this contract." title="Click a premium to alert this contract at that price"></canvas>'
      + toolRow + (readLine ? '<div class="om-read">' + esc(readLine) + '</div>' : '')
      + (M.msg ? '<div class="msg">' + esc(M.msg) + '</div>' : '')
      + '<div class="kv"><div><span>Bid</span><b>' + esc(money(r.bid)) + '</b></div><div><span>Ask</span><b>' + esc(money(r.ask)) + '</b></div><div><span>Mid</span><b>' + esc(money(r.mid)) + '</b></div><div><span>Spread</span><b>' + (r.bid != null && r.ask != null ? esc(money(r.ask - r.bid)) : '—') + '</b></div>'
      + '<div><span>Volume</span><b>' + esc(r.volume == null ? '—' : r.volume) + '</b></div><div><span>Open int.</span><b>' + esc(r.oi == null ? '—' : r.oi) + '</b></div><div><span>IV</span><b>' + esc(r.iv == null ? '—' : r.iv) + '</b></div><div><span>Delta</span><b>' + esc(r.delta == null ? '—' : r.delta) + '</b></div></div>'
      + '<div class="om-trade">' + trade + '<div class="om-row" style="margin-top:4px"><button type="button" class="alert" data-alert="1">🔔 Alert this contract</button><button type="button" data-copy="1" style="border-color:#3a6fb0;background:#0d1f33;color:#9cc8ff">Copy symbol</button></div></div>'
      + '<div class="hint' + (M.hintOk ? ' ok' : '') + '">' + esc(M.hint || 'Click a premium on the chart to set a Click-to-Alert target for this contract. Buy and Sell open your broker on this contract’s stock (or its chain) and copy the contract symbol; nothing is traded from the Academy.') + '</div>';
    drawChart();
  }
  function drawChart() {
    const cv = card.querySelector('canvas'); if (!cv) return;
    const w = cv.clientWidth || 280, h = cv.clientHeight || 150, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const bars = M.bars.slice(-120); if (!bars.length) { ctx.fillStyle = '#5f7784'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(M.busy ? 'loading…' : 'no candles yet', w / 2, h / 2); return; }
    const padL = 4, padR = 46, padT = 8, padB = 16, volH = 22, pw = w - padL - padR, ph = h - padT - padB - volH;
    let lo = Infinity, hi = -Infinity, vmax = 0; for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); vmax = Math.max(vmax, b.v || 0); }
    if (!(hi > lo)) { hi = lo + Math.max(0.01, lo * 0.01); lo -= Math.max(0.01, lo * 0.01); }
    const span = hi - lo; lo -= span * 0.05; hi += span * 0.05;
    const step = pw / bars.length, bw = Math.max(1, Math.min(9, step * 0.68));
    const x = (i) => padL + i * step + step / 2, y = (p) => padT + (hi - p) / (hi - lo) * ph;
    M.geo = { padL, padR, padT, pw, ph, lo, hi };
    ctx.strokeStyle = 'rgba(66,120,150,.18)'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const p = lo + (hi - lo) * k / 4, yy = y(p); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + pw, yy); ctx.stroke(); ctx.fillStyle = '#7f97a4'; ctx.font = '700 9px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(p.toFixed(p >= 100 ? 1 : 2), padL + pw + 4, yy); }
    bars.forEach((b, i) => {
      const up = b.c >= b.o, col = up ? '#00d084' : '#ff5470', xx = x(i);
      if (vmax > 0) { ctx.fillStyle = up ? 'rgba(0,208,132,.25)' : 'rgba(255,84,112,.25)'; const vh = ((b.v || 0) / vmax) * volH; ctx.fillRect(xx - bw / 2, h - padB - vh, bw, vh); }
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(xx, y(b.h)); ctx.lineTo(xx, y(b.l)); ctx.stroke();
      ctx.fillStyle = col; const yo = y(b.o), yc = y(b.c); ctx.fillRect(xx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    });
    /* the tools the member switched on, drawn in this chart's own geometry (academy-option-mini-tools.js) */
    if (M.plan && TOOLS()) { try { TOOLS().draw(ctx, M.geo, bars, M.bars.length - bars.length, M.plan); } catch (_) { /* a tool must never take the candles down */ } }
    /* the alert target the member clicked on this chart: green above the last premium, red below */
    if (M.target != null && M.target >= lo && M.target <= hi) {
      const lastC = bars[bars.length - 1].c, col = M.target >= lastC ? '#35e6a0' : '#ff6b86', ty = y(M.target);
      ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + pw, ty); ctx.stroke(); ctx.restore();
      ctx.font = '800 9px ui-monospace,monospace'; const tt = 'ALERT ' + M.target.toFixed(2), tw = ctx.measureText(tt).width + 8; ctx.fillStyle = col; ctx.fillRect(padL + 4, ty - 8, tw, 15); ctx.fillStyle = '#031a10'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(tt, padL + 8, ty);
    }
    const last = bars[bars.length - 1]; ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(padL, y(last.c)); ctx.lineTo(padL + pw, y(last.c)); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#ffd166'; ctx.fillRect(padL + pw + 1, y(last.c) - 7, padR - 2, 14); ctx.fillStyle = '#1a1305'; ctx.font = '800 9px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.fillText(last.c.toFixed(2), padL + pw + 4, y(last.c));
    const tfmt = (t) => { const d = new Date(t); return M.tf === '1D' ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
    ctx.fillStyle = '#6f8794'; ctx.font = '700 9px ui-monospace,monospace'; ctx.textBaseline = 'alphabetic';
    [0, Math.floor(bars.length / 2), bars.length - 1].forEach((i, k) => { ctx.textAlign = k === 0 ? 'left' : k === 1 ? 'center' : 'right'; ctx.fillText(tfmt(bars[i].t), k === 0 ? padL : k === 1 ? padL + pw / 2 : padL + pw, h - 4); });
    if (M.hover != null && bars[M.hover]) { const b = bars[M.hover], xx = x(M.hover); ctx.strokeStyle = 'rgba(200,220,235,.5)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, h - padB); ctx.stroke(); ctx.setLineDash([]); const txt = tfmt(b.t) + '  O ' + b.o.toFixed(2) + ' H ' + b.h.toFixed(2) + ' L ' + b.l.toFixed(2) + ' C ' + b.c.toFixed(2) + (b.v ? ' V ' + b.v : ''); ctx.font = '700 9px ui-monospace,monospace'; const tw = ctx.measureText(txt).width + 8; ctx.fillStyle = 'rgba(7,17,26,.92)'; ctx.fillRect(Math.min(padL, padL + pw - tw), padT, tw, 14); ctx.fillStyle = '#eaf3f6'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, Math.min(padL, padL + pw - tw) + 4, padT + 7); }
  }
  card.addEventListener('mousemove', (e) => { const cv = e.target.closest && e.target.closest('canvas'); if (!cv) { if (M.hover != null) { M.hover = null; drawChart(); } return; } const bars = M.bars.slice(-120); if (!bars.length) return; const r = cv.getBoundingClientRect(), pw = r.width - 50; const i = Math.max(0, Math.min(bars.length - 1, Math.floor((e.clientX - r.left - 4) / (pw / bars.length)))); if (i !== M.hover) { M.hover = i; drawChart(); } });
  card.addEventListener('mouseleave', () => { if (M.hover != null) { M.hover = null; drawChart(); } });
  const say = (text, ok) => { M.hint = text; M.hintOk = !!ok; const h = card.querySelector('.hint'); if (h) { h.textContent = text; h.className = 'hint' + (ok ? ' ok' : ''); } };
  /* click a premium on the contract chart: that premium becomes the alert target; Click-to-Alert reads the contract and turns it into the stock target */
  const expiryOf = (c) => c.year + '-' + String(c.month).padStart(2, '0') + '-' + String(c.day).padStart(2, '0');
  card.addEventListener('click', (e) => {
    const cv = e.target.closest && e.target.closest('canvas'); if (!cv || !M.c || !M.geo || !M.bars.length) return;
    const r = cv.getBoundingClientRect(), g = M.geo, yy = e.clientY - r.top;
    if (yy < g.padT - 4 || yy > g.padT + g.ph + 4) return;
    const premium = Math.max(0.01, Math.round((g.hi - (yy - g.padT) / g.ph * (g.hi - g.lo)) * 100) / 100);
    M.target = premium; drawChart();
    window.dispatchEvent(new CustomEvent('sml-click-alert-contract', { detail: { type: M.c.side, strike: M.c.strike, expiry: expiryOf(M.c), symbol: M.c.symbol, premiumTarget: premium } }));
    say('Alert target: this contract at ' + money(premium) + '. Click-to-Alert is turning that into the stock target and the horizon.', true);
  });
  card.addEventListener('click', async (e) => {
    const t = e.target.closest ? e.target.closest('[data-x],[data-tf],[data-go],[data-alert],[data-copy],[data-tool],[data-stock],[data-home]') : null; if (!t || !M.c) return;
    if (t.dataset.x) { closeCard(); return; }
    if (t.dataset.tool) { const T = TOOLS(); if (!T || t.disabled) return; const id = t.dataset.tool; M.tools = T.normalizeEnabled(M.tools.includes(id) ? M.tools.filter((x) => x !== id) : M.tools.concat(id)); try { localStorage.setItem('sml-opt-mini-tools', JSON.stringify(M.tools)); } catch (_) { /* ignore */ } paint(); return; }
    if (t.dataset.stock) { const b = document.querySelector(t.dataset.stock); if (b) { b.click(); say(t.dataset.label + ' opened on the main chart for $' + symbolNow() + ' \u2014 it reads the stock, not this contract.', true); } else say(t.dataset.label + ' is not available on this chart right now.', false); return; }
    if (t.dataset.home) { M.home = M.home === 'chart' ? 'chain' : 'chart'; try { localStorage.setItem('sml-opt-mini-home', M.home); } catch (_) { /* ignore */ } if (M.home === 'chart') { card.classList.remove('dock-stay'); rehome(); } place(); paint(); try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* ignore */ } return; }
    if (t.dataset.tf) { M.tf = t.dataset.tf; try { localStorage.setItem('sml-opt-mini-tf', M.tf); } catch (_) { /* ignore */ } M.bars = []; M.asOf = 0; M.msg = 'Loading…'; paint(); void load(); return; }
    if (t.dataset.copy) { const ok = window.smlBuyPrefs ? await window.smlBuyPrefs.copy(OC.occSymbol(M.c)) : false; say(ok ? 'Copied ' + OC.occSymbol(M.c) + '.' : 'Select the symbol above and copy it.', ok); return; }
    if (t.dataset.alert) { window.dispatchEvent(new CustomEvent('sml-click-alert-contract', { detail: { type: M.c.side, strike: M.c.strike, expiry: M.c.year + '-' + String(M.c.month).padStart(2, '0') + '-' + String(M.c.day).padStart(2, '0'), symbol: M.c.symbol, autoTarget: true } })); say('Click-to-Alert is reading this contract.', true); return; }
    if (t.dataset.go) {
      const P = window.smlBuyPrefs; if (!P) return;
      const out = await P.go(t.dataset.go, { contract: M.c, side: t.dataset.side });
      if (out) say((out.copied ? 'Copied ' + OC.occSymbol(M.c) + '. ' : '') + out.note, out.copied);
    }
  });
  window.addEventListener('sml-buy-prefs', () => { if (M.c) paint(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && M.c && Date.now() - M.asOf > 15000) void load(); });
  /* the chain moved to another symbol: a card for the old one would mislead */
  window.addEventListener('sml-academy-market', () => { if (M.c && M.c.symbol !== symbolNow().replace(/[^A-Z0-9.]/g, '').slice(0, 6)) closeCard(); });

  /* the row's live numbers from the chain's cells: call columns are IV, delta, gamma, theta, vega, volume, OI, bid, ask, mid; the put side mirrors them */
  function rowOf(tr, side) {
    const c = tr.cells, t = (i) => (c[i] ? c[i].textContent.trim() : ''), n = (i) => num(t(i));
    return side === 'call' ? { iv: t(0) || null, delta: t(1) || null, volume: t(5) || null, oi: t(6) || null, bid: n(7), ask: n(8), mid: n(9) }
      : { mid: n(11), bid: n(12), ask: n(13), oi: t(14) || null, volume: t(15) || null, delta: t(19) || null, iv: t(20) || null };
  }
  function fromRow(td) {
    const tr = td && td.parentElement; if (!tr || !tr.cells || tr.cells.length < 21 || td.cellIndex === 10) return null;
    const strike = num(tr.cells[10].textContent), expiry = expiryNow(); if (strike == null || !expiry) return null;
    const side = td.cellIndex > 10 ? 'put' : 'call';
    return { contract: OC.contract({ symbol: symbolNow(), expiry, strike, side }), row: rowOf(tr, side) };
  }
  /* double-click a contract -> its chart (the options ALERT mode keeps its own double-click, see academy-options-dock.js) */
  window.addEventListener('sml-option-mini', (e) => {
    const d = e.detail || {};
    if (d.td) { const f = fromRow(d.td); if (f && f.contract) show(f.contract, f.row); return; }
    const c = OC.contract({ symbol: d.symbol || symbolNow(), expiry: d.expiry, strike: d.strike, side: d.side || d.type });
    if (c) show(c, d.row || (d.mid != null ? { mid: d.mid, bid: d.bid, ask: d.ask, iv: d.iv, delta: d.delta, oi: d.oi, volume: d.volume } : null));
  });
  window.smlOptionMini = { show: (contract, row) => show(contract, row), close: closeCard, open: () => !!M.c, chain: setChain, chainOn: () => CH.on,
    /* preview(bars, contract): paints the given candles without a session, so the tools can be checked by eye */
    preview: (bars, contract) => { if (!contract || !Array.isArray(bars)) return false; M.c = contract; M.bars = bars; M.asOf = Date.now(); M.msg = ''; clearTimeout(M.timer); openCard(); paint(); place(); return true; },
    tools: () => M.tools.slice(), home: () => M.home };
})(0);
