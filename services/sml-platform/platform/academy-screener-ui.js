/* Screener panel inside the Indicator Engine, which now sits directly under the live chart.
 * Two views over the server's market sweep (/academy-activity/screener, academy-screener.js):
 *   BY INDICATOR — pick any screened indicator and a timeframe (1H, 1D, 1W, 1M, 1Q, 1Y) and see
 *                  which tracked tickers read bullish and which read bearish on it right now;
 *                  clicking a chip in the engine's own catalog selects it here too.
 *   BY HORIZON   — day / swing / mid-term / long-term: the tickers MEM ALGO leans long on (go long)
 *                  and leans short on (short it), ranked by signal grade, recency and whether the
 *                  latest chart formation agrees, each with a CALL / PUT button that asks the
 *                  options lab for the most liquid, best-priced contract for that lean.
 * Clicking a ticker loads it on the chart. Educational only: nothing here places a trade. */
(() => {
  if (window.__smlScreenerUi) return;
  window.__smlScreenerUi = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => (Number.isFinite(v) ? '$' + Number(v).toFixed(2) : '—');
  const pct = (v) => (Number.isFinite(v) ? '<span class="' + (v >= 0 ? 'up' : 'dn') + '">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%</span>' : '');

  const style = document.createElement('style');
  style.textContent = '#academy-screener-toggle.on{background:#00b878;color:#001d13;border-color:#00b878}'
    + '.academy-screener{display:none;border-top:1px solid #193343;padding:8px 10px;color:#dcebf4;font:600 .66rem system-ui,sans-serif}.academy-screener.open{display:block}'
    + '.academy-screener .scr-tabs{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.academy-screener .scr-tabs button,.academy-screener .scr-pills button{border:1px solid #315064;background:#0a1822;color:#c9dce8;padding:4px 8px;border-radius:5px;font:800 .6rem ui-monospace,monospace;cursor:pointer}.academy-screener .scr-tabs button.on,.academy-screener .scr-pills button.on{background:#00b878;color:#001d13;border-color:#00b878}'
    + '.academy-screener .scr-meta{margin-left:auto;color:#7f97a4;font:700 .58rem ui-monospace,monospace}.academy-screener .scr-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.academy-screener .scr-controls label{color:#85d9ff;font:800 .6rem ui-monospace,monospace}.academy-screener select{background:#061019;border:1px solid #315064;color:#e7f4fb;border-radius:5px;padding:4px 6px;margin-left:6px;font:700 .62rem system-ui}'
    + '.academy-screener .scr-pills{display:flex;gap:4px;flex-wrap:wrap}.academy-screener .scr-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}.academy-screener h4{margin:0 0 4px;font:800 .6rem ui-monospace,monospace;letter-spacing:.05em}.academy-screener h4.up,.academy-screener .up{color:#22e69b}.academy-screener h4.dn,.academy-screener .dn{color:#ff778b}'
    + '.academy-screener ul{list-style:none;margin:0;padding:0;max-height:220px;overflow:auto}.academy-screener li{display:flex;gap:8px;align-items:center;padding:3px 0;border-top:1px solid rgba(42,66,78,.5)}.academy-screener li:first-child{border-top:0}.academy-screener .scr-sym{border:1px solid #2d566b;background:#102735;color:#fff;padding:2px 7px;border-radius:4px;font:800 .62rem ui-monospace,monospace;cursor:pointer}.academy-screener .scr-name{flex:1;color:#9fb7c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.6rem}'
    + '.academy-screener .scr-opt{border:1px solid #6a4fa0;background:#17112a;color:#cdb6ff;padding:2px 7px;border-radius:4px;font:800 .58rem ui-monospace,monospace;cursor:pointer}.academy-screener .scr-empty{color:#5d7085;font-size:.6rem}'
    + '.academy-screener .scr-suggest{margin-top:8px;padding:8px;border:1px solid #3a3160;border-radius:7px;background:#0e0a1c;color:#dbe6ec;font:600 .64rem/1.4 system-ui}.academy-screener .scr-suggest b{color:#cdb6ff;margin-right:6px}'
    + '.academy-screener .scr-opt:hover,.academy-screener .scr-opt:focus-visible{background:#2a1d4d;border-color:#9a7fe0;color:#fff}.academy-screener .scr-opt.on{background:#7a5cff;border-color:#b9a4ff;color:#fff}.academy-screener .scr-opt:active{transform:translateY(1px)}'
    + '.academy-screener li.scr-card{display:block;margin:4px 0 6px;padding:8px;border:1px solid #3a3160;border-radius:8px;background:#0e0a1c;color:#dbe6ec;font:600 .64rem/1.4 system-ui}.academy-screener .scr-card p{margin:4px 0}.academy-screener .scr-head{display:flex;gap:8px;align-items:center}.academy-screener .scr-head b{color:#cdb6ff;font:800 .62rem ui-monospace,monospace;letter-spacing:.04em}.academy-screener .scr-head em{margin-left:auto;font-style:normal;color:#7ef0bd;font-weight:800}.academy-screener .scr-wait{color:#cdb6ff}'
    + '.academy-screener .scr-cons{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin:6px 0}.academy-screener .scr-con{display:flex;flex-direction:column;gap:2px;padding:7px;border:1px solid #2a2450;border-radius:7px;background:#120d24}.academy-screener .scr-con.best{border-color:#7a5cff;background:#18113a}.academy-screener .scr-con b{color:#9d8be0;font:800 .5rem ui-monospace,monospace;letter-spacing:.06em}.academy-screener .scr-con strong{color:#fff;font-size:.74rem}.academy-screener .scr-con span{color:#aab9c4;font-weight:600}.academy-screener .scr-flags{color:#ffcf8a}.academy-screener .scr-card small{display:block;margin-top:4px;color:#6f8794;font-weight:500;font-size:.54rem}'
    + '.academy-screener .scr-con[data-expiry]{cursor:pointer;transition:border-color .12s,background .12s}.academy-screener .scr-con[data-expiry]:hover,.academy-screener .scr-con[data-expiry]:focus-visible{border-color:#7a5cff;background:#1c1533;outline:none}.academy-screener .scr-open{margin-top:2px;font:800 .54rem ui-monospace,monospace;font-style:normal;letter-spacing:.08em;color:#b9a4ff}'
    + '.academy-screener .scr-shares{margin:6px 0 0;padding:6px 8px;border:1px solid #17403a;border-radius:7px;background:#0e1a1a;display:flex;flex-wrap:wrap;gap:3px 10px}.academy-screener .scr-shares b{flex:1 1 100%;color:#7ef0bd;font:800 .54rem ui-monospace,monospace;letter-spacing:.05em}.academy-screener .scr-shares span{color:#cfe3ec;font:700 .6rem ui-monospace,monospace}.academy-screener .scr-shares .stp{color:#ff8fa3}.academy-screener .scr-src{color:#8fa5b1;font-size:.56rem}'
    + '.academy-screener .scr-note{margin:8px 0 0;color:#7f97a4;font:500 .56rem/1.4 system-ui}@media(max-width:700px){.academy-screener .scr-cols{grid-template-columns:1fr}}';
  document.head.appendChild(style);

  const S = { data: null, view: 'indicator', tf: '1D', indicator: 'EMA', horizon: 'swing', session: String(window.smlAcademySessionToken || ''), busy: null, error: '' };
  window.addEventListener('sml-academy-session', (e) => { S.session = String((e.detail && e.detail.sessionToken) || ''); paint(); });

  function boot(tries) {
    const box = document.querySelector('.academy-intelligence');
    if (!box) { if (tries < 200) setTimeout(() => boot(tries + 1), 150); return; }
    mount(box);
  }
  function mount(box) {
    const head = box.querySelector('.academy-intel-head') || box;
    const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'academy-screener-toggle'; btn.textContent = 'Screener'; btn.title = 'Which tickers read bullish or bearish on an indicator and timeframe, and what to go long, short, call or put on per horizon'; head.appendChild(btn);
    const panel = document.createElement('div'); panel.className = 'academy-screener'; panel.id = 'academy-screener';
    (box.querySelector('.academy-active-indicators') || head).after(panel);
    const setOpen = (open) => { panel.classList.toggle('open', open); btn.classList.toggle('on', open); if (open && !S.data) void load(); };
    btn.onclick = () => setOpen(!panel.classList.contains('open'));
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', (e) => { if (e.target && e.target.id === 'academy-screener-indicator') { S.indicator = e.target.value; paint(); } });
    // picking an indicator in the engine's catalog also screens the market by it
    box.addEventListener('click', (e) => { const chip = e.target.closest && e.target.closest('[data-indicator]'); if (!chip || !S.data) return; const name = chip.dataset.indicator; if (S.data.indicators.includes(name)) { S.indicator = name; S.view = 'indicator'; setOpen(true); paint(); } });
    void load();
    setInterval(() => { void load(); }, 5 * 60000);
  }
  async function load() {
    try {
      const res = await fetch('/academy-activity/screener', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'unavailable');
      S.data = d; S.error = '';
      if (!d.indicators.includes(S.indicator)) S.indicator = d.indicators[0] || '';
    } catch (_) { S.error = 'Screener data is temporarily unavailable.'; }
    paint();
  }
  /* everything connects to the chart: the interval picked in the engine is the interval the chart shows (the chart's own button does the work, so the URL, the active pill and every overlay follow) */
  function syncChart(tf) {
    try {
      const btn = document.querySelector('.intervals button[data-tf="' + String(tf).replace(/"/g, '') + '"]');
      if (btn && !btn.classList.contains('active')) btn.click();
    } catch (_) { /* the chart keeps its interval */ }
  }
  function onClick(e) {
    const t = e.target.closest && e.target.closest('[data-tf],[data-view],[data-horizon],[data-load],[data-option]'); if (!t) return;
    if (t.dataset.tf) { S.tf = t.dataset.tf; syncChart(S.tf); paint(); }
    else if (t.dataset.view) { S.view = t.dataset.view; paint(); }
    else if (t.dataset.horizon) { S.horizon = t.dataset.horizon; S.busy = null; const h = S.data && S.data.horizons && S.data.horizons[S.horizon]; if (h && h.tf) syncChart(h.tf); paint(); }
    else if (t.dataset.load) { const sym = document.getElementById('symbol'), go = document.getElementById('load'); if (sym && go) { sym.value = t.dataset.load; go.click(); } }
    else if (t.dataset.option) {
      const side = t.dataset.side === 'put' ? 'put' : 'call';
      if (S.busy && S.busy.symbol === t.dataset.option && S.busy.side === side) { S.busy = null; paint(); return; } // a second tap folds the suggestions away
      void suggest(t.dataset.option, side);
    }
  }
  /* The read: the live session token (it was read once at load before, and sessions last 15 minutes, so a token that expired or arrived late
     failed every click), a renewal on 401, a one-minute client cache, a warm-up on hover so the click is instant, and a single automatic retry
     when the options feed says it is busy. */
  const token = () => String(window.smlAcademySessionToken || S.session || '');
  const optCache = new Map();
  const optKey = (symbol, side) => symbol + '|' + side + '|' + S.horizon;
  async function fetchOption(symbol, side, warm) {
    const url = (tok) => fetch('/academy-activity/screener/option?symbol=' + encodeURIComponent(symbol) + '&side=' + side + '&horizon=' + encodeURIComponent(S.horizon) + (warm ? '&warm=1' : ''), { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
    let tok = token(), res = await url(tok);
    if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) { tok = fresh; S.session = fresh; res = await url(tok); } }
    const d = await res.json().catch(() => null);
    return { res, d };
  }
  const warmTimers = new Map();
  function warm(symbol, side) {
    if (!token()) return;
    const k = optKey(symbol, side), hit = optCache.get(k);
    if (hit && Date.now() - hit.at < 60_000) return;
    clearTimeout(warmTimers.get(k));
    warmTimers.set(k, setTimeout(() => { warmTimers.delete(k); fetchOption(symbol, side, true).catch(() => {}); }, 180));
  }
  function show(symbol, side, d) {
    const s = d.suggestion || {}, picked = s.verdict === 'CALL' || s.verdict === 'PUT';
    S.busy = { symbol, side, verdict: s.verdict, sug: picked ? s : null, shares: d.shares || null, source: d.source || null, noOptions: !!s.noOptions, text: picked ? (s.strength ? s.strength + ' — ' : '') + (s.summary || '') : (s.reason || 'No suitable contract right now.') };
  }
  async function suggest(symbol, side, retried) {
    if (!token()) { S.busy = { symbol, side, text: 'Unlock Academy Tools first so Discord can verify private Academy access.' }; paint(); return; }
    const k = optKey(symbol, side), hit = optCache.get(k);
    if (hit && Date.now() - hit.at < 60_000) { show(symbol, side, hit.d); paint(); scrollCard(); return; }
    S.busy = { symbol, side, text: 'Checking the options chain…' }; paint();
    try {
      const { res, d } = await fetchOption(symbol, side, false);
      if (!S.busy || S.busy.symbol !== symbol || S.busy.side !== side) return; // the member moved on
      if (res.ok && d && d.ok) { optCache.set(k, { at: Date.now(), d }); if (optCache.size > 60) optCache.delete(optCache.keys().next().value); show(symbol, side, d); }
      else if (res.status === 429 && !retried) {
        const wait = Math.min(15, Math.max(3, Number(d && d.retryAfterSec) || 6));
        S.busy = { symbol, side, shares: d && d.shares || null, text: 'The options feed is busy: retrying in ' + wait + ' seconds…' }; paint();
        setTimeout(() => { if (S.busy && S.busy.symbol === symbol && S.busy.side === side) void suggest(symbol, side, true); }, wait * 1000);
        return;
      } else S.busy = { symbol, side, shares: d && d.shares || null, text: (d && d.detail) || 'Options data is temporarily unavailable. Tap again in a moment.' };
    } catch (_) { S.busy = { symbol, side, text: 'No connection. Tap again in a moment.' }; }
    paint(); scrollCard();
  }
  /* a suggested contract opens in the options chain: the chart goes to that ticker, the chain to that expiration and strike, and the contract loads into the price calculator (academy-options-dock.js listens) */
  function openContract(el) {
    const strike = Number(el.dataset.strike);
    if (!el.dataset.sym || !el.dataset.expiry || !Number.isFinite(strike)) return;
    window.dispatchEvent(new CustomEvent('sml-open-contract', { detail: { symbol: el.dataset.sym, side: el.dataset.side === 'put' ? 'put' : 'call', expiry: el.dataset.expiry, strike } }));
  }
  document.addEventListener('click', (e) => { const c = e.target.closest && e.target.closest('.academy-screener .scr-con[data-expiry]'); if (c) openContract(c); });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const c = e.target.closest && e.target.closest('.academy-screener .scr-con[data-expiry]'); if (c) { e.preventDefault(); openContract(c); } });
  function scrollCard() { const card = document.getElementById('academy-screener-suggest'); if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  document.addEventListener('pointerover', (e) => { const b = e.target.closest && e.target.closest('.academy-screener .scr-opt'); if (b) warm(b.dataset.option, b.dataset.side === 'put' ? 'put' : 'call'); });
  document.addEventListener('focusin', (e) => { const b = e.target.closest && e.target.closest('.academy-screener .scr-opt'); if (b) warm(b.dataset.option, b.dataset.side === 'put' ? 'put' : 'call'); });

  const row = (s, close, chg) => '<li><button type="button" class="scr-sym" data-load="' + esc(s.symbol) + '">' + esc(s.symbol) + '</button><span class="scr-name">' + esc(s.name || '') + '</span><span>' + money(close) + ' ' + pct(chg) + '</span></li>';
  const cdol = (v) => (Number.isFinite(v) ? '$' + Number(v).toFixed(2) : '–');
  const cname = (c, side) => new Date(c.expiry + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' + cdol(c.strike) + ' ' + side;
  const ccard = (c, side, best, sym) => '<div class="scr-con' + (best ? ' best' : '') + '" role="button" tabindex="0" data-sym="' + esc(sym) + '" data-side="' + esc(side) + '" data-expiry="' + esc(c.expiry) + '" data-strike="' + esc(c.strike) + '" title="Open this contract in the options chain and the price calculator"><b>' + esc(best ? 'BEST FIT' : 'ALSO CONSIDER') + '</b><strong>' + esc(cname(c, side)) + '</strong><span>' + esc(c.dte) + ' days · about ' + esc(cdol(c.costPerContract)) + ' a contract</span><span>Breaks even ' + esc(cdol(c.breakeven)) + (Number.isFinite(c.needPct) ? ' (' + (side === 'call' ? '+' : '-') + (c.needPct * 100).toFixed(1) + '%)' : '') + '</span><span>Delta ' + (Number.isFinite(c.delta) ? c.delta.toFixed(2) : '–') + ' · open interest ' + esc(c.oi) + (Number.isFinite(c.returnAtTarget) ? ' · ' + (c.returnAtTarget > 0 ? '~' + Math.round(c.returnAtTarget * 100) + '% at T1' : 'loses at T1') : '') + (Number.isFinite(c.returnAtTarget2) && c.returnAtTarget2 > 0 ? ' · ~' + Math.round(c.returnAtTarget2 * 100) + '% at T2' : '') + '</span><em class="scr-open">OPEN IN CHAIN \u203a</em></div>';
  const sharesHtml = (b, side) => {
    const sh = b.shares; if (!sh || !Array.isArray(sh.targets) || !sh.targets.length) return '';
    return '<div class="scr-shares"><b>' + (b.noOptions ? 'PLAN FOR THE SHARES' : 'SHARES, IN CASE YOU SKIP THE CONTRACT') + ' · ' + esc(sh.horizon) + ' · ' + esc(sh.direction.toUpperCase()) + '</b>' + sh.targets.map((t, i) => '<span>T' + (i + 1) + ' ' + esc(cdol(t.price)) + ' (' + (sh.direction === 'short' ? '-' : '+') + Math.abs(t.pct).toFixed(1) + '%, ' + esc(t.prob) + '% odds)</span>').join('') + '<span class="stp">STOP ' + esc(cdol(sh.stop.price)) + ' (' + (sh.direction === 'short' ? '+' : '-') + sh.stop.pct.toFixed(1) + '%)</span></div>';
  };
  const suggestCard = (b) => {
    const side = b.side === 'put' ? 'put' : 'call';
    let inner;
    if (!b.verdict && !b.sug && /…$/.test(b.text)) inner = '<div class="scr-wait">' + esc(b.text) + '</div>' + sharesHtml(b, side);
    else if (b.sug) {
      const g = b.sug;
      inner = '<div class="scr-head"><b>' + esc(b.symbol) + ' ' + esc(side.toUpperCase()) + 'S TO CONSIDER</b><em>' + esc(g.strength || '') + '</em></div>'
        + (g.reason ? '<p>' + esc(g.reason) + '</p>' : '') + '<div class="scr-cons">' + (g.contract ? ccard(g.contract, side, true, b.symbol) : '') + (Array.isArray(g.alternatives) ? g.alternatives.map((c) => ccard(c, side, false, b.symbol)).join('') : '') + '</div>'
        + (Array.isArray(g.flags) && g.flags.length ? '<p class="scr-flags">Watch: ' + esc(g.flags.join('; ')) + '.</p>' : '')
        + (g.targetUsed ? '<p class="scr-src">Judged against the first target ' + esc(cdol(g.targetUsed.first)) + (g.targetUsed.second ? ' and the second ' + esc(cdol(g.targetUsed.second)) : '') + ' (' + esc(g.targetUsed.source) + ').' + (b.source && b.source.ageSec > 20 ? ' Chain read ' + esc(b.source.ageSec) + 's ago' + (b.source.stale ? ' (the feed is slow, so this is the last good read)' : '') + '.' : '') + '</p>' : '')
        + sharesHtml(b, side);
    } else inner = '<div class="scr-head"><b>' + esc(b.symbol) + ' ' + esc(side.toUpperCase()) + (b.verdict ? ' · ' + esc(b.verdict) : '') + '</b></div><p>' + esc(b.text) + '</p>' + sharesHtml(b, side);
    return '<li class="scr-card" id="academy-screener-suggest">' + inner + '<small>Educational analysis, not investment advice or a recommendation to trade. Options can lose their entire value. Tap a contract to open it in the chain. Tap ' + esc(side.toUpperCase()) + ' again to close.</small></li>';
  };
  const hrow = (s, h, dir) => {
    const side = dir > 0 ? 'call' : 'put', on = S.busy && S.busy.symbol === s.symbol && S.busy.side === side, loading = on && !S.busy.verdict && !S.busy.sug && /…$/.test(S.busy.text);
    return '<li><button type="button" class="scr-sym" data-load="' + esc(s.symbol) + '">' + esc(s.symbol) + '</button><span class="scr-name">' + (h.grade ? 'grade ' + esc(h.grade) + ' · ' : '') + esc(h.bias) + (h.pattern ? ' · ' + esc(String(h.pattern.name || '').replace(/_/g, ' ')) + ' (' + esc(h.pattern.status) + ')' : '') + '</span><button type="button" class="scr-opt' + (on ? ' on' : '') + '" aria-expanded="' + (on ? 'true' : 'false') + '" data-option="' + esc(s.symbol) + '" data-side="' + side + '">' + (loading ? '…' : side.toUpperCase()) + '</button></li>' + (on ? suggestCard(S.busy) : '');
  };

  function paint() {
    const panel = document.getElementById('academy-screener'); if (!panel) return;
    const d = S.data;
    const tabs = '<div class="scr-tabs"><button type="button" data-view="indicator" class="' + (S.view === 'indicator' ? 'on' : '') + '">BY INDICATOR</button><button type="button" data-view="horizon" class="' + (S.view === 'horizon' ? 'on' : '') + '">BY HORIZON · LONG / SHORT</button><span class="scr-meta">'
      + (d && d.updatedAt ? 'updated ' + new Date(d.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · ' + d.symbols.length + ' symbols' : esc(S.error || 'loading…')) + '</span></div>';
    if (!d) { panel.innerHTML = tabs + '<p class="scr-note">' + esc(S.error || 'Loading the market sweep…') + '</p>'; return; }
    let body = '';
    if (S.view === 'indicator') {
      const tfs = d.timeframes.map((tf) => '<button type="button" data-tf="' + esc(tf) + '" class="' + (tf === S.tf ? 'on' : '') + '">' + esc(tf.toUpperCase()) + '</button>').join('');
      const sel = '<select id="academy-screener-indicator">' + d.indicators.map((n) => '<option' + (n === S.indicator ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>';
      const rows = d.symbols.map((s) => ({ s, st: s.byTf && s.byTf[S.tf] })).filter((x) => x.st && x.st.states && x.st.states[S.indicator]);
      const list = (state) => rows.filter((x) => x.st.states[S.indicator] === state).map((x) => row(x.s, x.st.close, x.st.changePct)).join('') || '<li class="scr-empty">none right now</li>';
      body = '<div class="scr-controls"><label>Indicator' + sel + '</label><div class="scr-pills">' + tfs + '</div></div>'
        + '<div class="scr-cols"><div><h4 class="up">BULLISH · ' + esc(S.indicator) + ' · ' + esc(S.tf.toUpperCase()) + '</h4><ul>' + list('bull') + '</ul></div><div><h4 class="dn">BEARISH · ' + esc(S.indicator) + ' · ' + esc(S.tf.toUpperCase()) + '</h4><ul>' + list('bear') + '</ul></div></div>'
        + '<p class="scr-note">' + (Array.isArray(d.nonDirectional) && d.nonDirectional.length ? esc(d.nonDirectional.join(', ')) + ' measure how much price moves, not which way, so they are not screened. ' : '') + 'A reading describes the last candle on that timeframe for the tickers the scanner tracks. Educational only.</p>';
    } else {
      const hs = Object.entries(d.horizons || {}).map(([k, h]) => '<button type="button" data-horizon="' + esc(k) + '" class="' + (k === S.horizon ? 'on' : '') + '">' + esc(String(h.label).toUpperCase()) + ' · ' + esc(String(h.tf).toUpperCase()) + '</button>').join('');
      const reads = d.symbols.map((s) => ({ s, h: s.horizons && s.horizons[S.horizon] })).filter((x) => x.h);
      const side = (dir) => reads.filter((x) => x.h.dir === dir).sort((a, b) => b.h.strength - a.h.strength).map((x) => hrow(x.s, x.h, dir)).join('') || '<li class="scr-empty">none right now</li>';
      body = '<div class="scr-pills">' + hs + '</div><div class="scr-cols"><div><h4 class="up">GO LONG · MEM ALGO leans up</h4><ul>' + side(1) + '</ul></div><div><h4 class="dn">SHORT · MEM ALGO leans down</h4><ul>' + side(-1) + '</ul></div></div>'
        + '<p class="scr-note"><strong>Educational only, not investment advice.</strong> These lists describe what price has already done; they are not recommendations to buy, sell or short. Ranked by MEM ALGO signal grade, how recent the signal is, and whether the latest chart formation agrees. CALL / PUT asks the options lab for the most liquid, best-priced contract that fits that lean. Educational only: nothing here places a trade.</p>';
    }
    panel.innerHTML = tabs + body;
  }
  /* and the other way: an interval picked on the chart is the one the engine screens */
  window.addEventListener('sml-academy-market', () => {
    try {
      const tf = (window.smlAcademyChartState && window.smlAcademyChartState().tf) || '';
      if (S.data && S.data.timeframes && S.data.timeframes.includes(tf) && tf !== S.tf) { S.tf = tf; paint(); }
    } catch (_) { /* the chart is not ready */ }
  });
  boot(0);
})();
