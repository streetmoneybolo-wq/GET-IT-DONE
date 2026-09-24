/* MEM ALGO panel + chart overlay for the Academy Live Chart Lab. Loaded after academy-mem-algo.js (window.MemAlgoEngine).
   Reads the chart's own state (window.smlAcademyChartState) and draws on a transparent canvas above it; it never touches the chart's drawing code. */
(() => {
  const E = window.MemAlgoEngine;
  const chartCanvas = document.getElementById('chart');
  const host = chartCanvas && chartCanvas.parentElement;
  if (!E || !chartCanvas || !host || window.__memAlgoUi) return;
  window.__memAlgoUi = true;

  const KEY = 'sml-mem-algo-v1';
  const S = { on: false, mode: 'day', overlays: { ema: true, signals: true, levels: true, book: true }, of: null, ofBusy: false, ofErr: '', params: { day: {}, swing: {} }, data: null, sigKey: '', loading: false, error: '', open: false };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { S.on = !!saved.on; S.mode = E.STRATEGIES[saved.mode] ? saved.mode : 'day'; Object.assign(S.overlays, saved.overlays || {}); S.params = { day: (saved.params && saved.params.day) || {}, swing: (saved.params && saved.params.swing) || {} }; S.open = !!saved.on; } } catch (_) { /* storage can be blocked inside Discord */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, mode: S.mode, overlays: S.overlays, params: S.params })); } catch (_) { /* ignore */ } };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
  const pct = (v, d = 1) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) + '%' : '–');
  const rr = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + 'R' : '–');
  const q = () => new URLSearchParams(location.search);
  const tf = () => q().get('tf') || '5m';
  const symbol = () => { try { return String(window.smlAcademyChartState().symbol || q().get('symbol') || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const fmtTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const css = document.createElement('style');
  css.textContent = `
#mem-algo-toggle{margin-left:4px;padding:5px 10px;border:1px solid #2b5c4c;border-radius:7px;background:#0e1f1a;color:#52e6ad;font:800 .66rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}
#mem-algo-toggle.on{background:#00d084;color:#04140d;border-color:#00d084}
#mem-algo-layer{position:absolute;pointer-events:none;z-index:4;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}
#mem-algo-panel{position:absolute;right:14px;top:58px;z-index:7;width:min(340px,calc(100% - 28px));max-height:calc(100% - 76px);overflow:auto;background:#0b141c;border:1px solid #23495a;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.55);color:#dbe6ec;font:13px/1.45 system-ui,sans-serif;display:none}
#mem-algo-panel.open{display:block}
#mem-algo-panel header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1b3540}
#mem-algo-panel header b{font:900 .8rem ui-monospace,monospace;letter-spacing:.08em;color:#52e6ad}
#mem-algo-panel header small{color:#7f98a6;font-size:.62rem}
#mem-algo-panel header button{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px;cursor:pointer}
.mem-tabs{display:flex;gap:6px;padding:10px 12px 0}
.mem-tabs button{flex:1;padding:7px 6px;border:1px solid #23495a;border-radius:8px;background:#0a1118;color:#b8c9d3;font:700 .72rem system-ui;cursor:pointer}
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
@media(max-width:520px){#mem-algo-panel{right:8px;left:8px;width:auto;top:52px}}`;
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
    S.data = E.analyze(S.raw.bars, S.mode, S.params[S.mode]);
    S.idx = new Map(); S.raw.bars.forEach((b, i) => S.idx.set(Number(b.t), i));
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
      recompute();
    } catch (_) {
      S.error = S.data ? '' : 'Live candles are not available right now. Trying again…';
      if (!S.retry) { S.retry = setTimeout(() => { S.retry = 0; refresh(true); }, 4000); }
    }
    S.loading = false; paint(); draw();
  }

  function stat(label, value, cls) { return '<div class="mem-stat"><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>'; }
  function splitRow(name, s) { return '<tr><td>' + name + '</td><td>' + s.trades + '</td><td>' + (s.winRate == null ? '–' : Math.round(s.winRate * 100) + '%') + '</td><td>' + rr(s.expectancyR) + '</td></tr>'; }

  function paint() {
    toggle.classList.toggle('on', S.on);
    panel.classList.toggle('open', S.on && S.open);
    if (!(S.on && S.open)) return;
    const st = E.STRATEGIES[S.mode], d = S.data, p = E.resolveParams(S.mode, S.params[S.mode]);
    const tfNow = tf(), fitTf = st.tfHint.indexOf(tfNow) >= 0;
    let html = '<header><b>MEM ALGO</b><small>Educational simulation · no orders are placed</small><button type="button" data-mem="close" aria-label="Close">×</button></header>';
    html += '<div class="mem-tabs">' + Object.keys(E.STRATEGIES).map((k) => '<button type="button" data-mem-mode="' + k + '" class="' + (S.mode === k ? 'on' : '') + '">' + esc(E.STRATEGIES[k].label) + '</button>').join('') + '</div>';
    html += '<div class="mem-sec"><p class="mem-blurb" style="margin-top:0">' + esc(st.blurb) + '</p>' + (fitTf ? '' : '<div class="mem-warn" style="margin-top:8px">' + esc(st.label) + ' is built for ' + esc(st.tfHint[0]) + '–' + esc(st.tfHint[st.tfHint.length - 1]) + ' candles. You are on ' + esc(tfNow) + ', so treat these numbers as a rough guide.</div>') + '</div>';
    html += '<div class="mem-sec" id="mem-of"></div>';
    if (S.error) html += '<div class="mem-sec"><div class="mem-warn">' + esc(S.error) + '</div></div>';
    if (!d) { html += '<div class="mem-sec">Loading candles for $' + esc(symbol()) + '…</div>'; }
    else {
      const biasMap = { long: ['long', 'LONG BIAS'], short: ['short', 'SHORT BIAS'], pullback: ['flat', 'PULLBACK IN UPTREND'], bounce: ['flat', 'BOUNCE IN DOWNTREND'], warming: ['flat', 'WARMING UP'] };
      const b = biasMap[d.bias] || biasMap.warming, L = d.latest;
      html += '<div class="mem-sec"><h5>Right now · $' + esc(symbol()) + ' · ' + esc(tfNow) + '</h5><span class="mem-chip ' + b[0] + '">' + b[1] + '</span>';
      if (d.open) html += '<div class="mem-sig"><b class="' + (d.open.dir > 0 ? 'buy' : 'sell') + '">Paper trade open · ' + (d.open.dir > 0 ? 'LONG' : 'SHORT') + '</b><br>Entry ' + num(d.open.entry) + ' · Stop ' + num(d.open.stop) + ' · Target ' + num(d.open.target) + '<br>Unrealized ' + '<span class="' + (d.open.unrealizedR >= 0 ? 'mem-pos' : 'mem-neg') + '">' + rr(d.open.unrealizedR) + '</span><div class="mem-grade" id="mem-grade" data-dir="' + d.open.dir + '"></div></div>';
      else if (L) html += '<div class="mem-sig"><b class="' + (L.dir > 0 ? 'buy' : 'sell') + '">Last signal · ' + (L.dir > 0 ? 'BUY' : 'SELL') + '</b> ' + esc(fmtTime(L.t)) + '<br>Price ' + num(L.price) + ' · Stop ' + num(L.stop) + ' · Target ' + num(L.target) + '<br><span class="mem-blurb">Risk ' + num(Math.abs(L.price - L.stop)) + ' to make ' + num(Math.abs(L.target - L.price)) + ' (' + num(p.targetAtr / p.stopAtr, 1) + ' : 1). A signal is a closed-candle event; the paper trade enters on the next open.</span><div class="mem-grade" id="mem-grade" data-dir="' + L.dir + '"></div></div>';
      else html += '<div class="mem-sec" style="padding:8px 0 0"><span class="mem-blurb">No signal in the candles loaded. That is normal — the model waits for a clean, confirmed cross.</span></div>';
      html += '</div>';
      if (!d.enoughData) html += '<div class="mem-sec"><div class="mem-warn">Only ' + d.bars + ' candles are loaded and this mode needs about ' + (d.warm + 30) + ' to warm up its averages. Try a shorter-period timeframe or another ticker.</div></div>';
      else {
        const s = d.stats;
        html += '<div class="mem-sec"><h5>Paper backtest · ' + d.bars + ' candles</h5><div class="mem-grid">'
          + stat('Trades', s.trades) + stat('Win rate', s.winRate == null ? '–' : Math.round(s.winRate * 100) + '%')
          + stat('Avg win / loss', s.trades ? rr(s.avgWinR) + ' / ' + rr(s.avgLossR) : '–')
          + stat('Expectancy', rr(s.expectancyR), s.expectancyR > 0 ? 'mem-pos' : (s.expectancyR < 0 ? 'mem-neg' : ''))
          + stat('Profit factor', s.profitFactor == null ? '–' : (s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)))
          + stat('Max drawdown', '−' + num(s.maxDrawdownPct, 1) + '%', s.maxDrawdownPct > 15 ? 'mem-neg' : '')
          + stat('Return (1% risk)', pct(s.returnPct), s.returnPct >= 0 ? 'mem-pos' : 'mem-neg') + stat('Buy & hold', pct(d.buyHoldPct))
          + '</div><p class="mem-blurb">Costs of ' + p.costBps + ' bps per side are included. R means multiples of the amount risked on each trade.</p>'
          + (s.trades < 20 ? '<div class="mem-warn" style="margin-top:8px">Only ' + s.trades + ' trades. Small samples flatter or punish any strategy — do not read too much into them.</div>' : '') + '</div>';
        html += '<div class="mem-sec"><h5>Is it robust? In-sample vs out-of-sample</h5><table class="mem-split"><thead><tr><th></th><th>Trades</th><th>Win</th><th>Expectancy</th></tr></thead><tbody>' + splitRow('First 70% (tuned on)', d.inSample) + splitRow('Last 30% (unseen)', d.outOfSample) + '</tbody></table><p class="mem-blurb">If the unseen part is much worse than the first part, the setup was probably fitted to old data.</p></div>';
      }
    }
    html += '<div class="mem-sec"><h5>Show on chart</h5>'
      + [['ema', 'EMA lines'], ['signals', 'Buy / sell markers'], ['levels', 'Stop & target levels'], ['book', 'Level 2 book walls']].map((o) => '<label class="mem-row"><input type="checkbox" data-mem-ov="' + o[0] + '"' + (S.overlays[o[0]] ? ' checked' : '') + '> ' + o[1] + '</label>').join('') + '</div>';
    const fields = [['fast', 'Fast EMA'], ['slow', 'Slow EMA'], ['trend', 'Trend EMA'], ['atr', 'ATR length'], ['minSep', 'Price gap to slow EMA (×ATR)'], ['confirm', 'Confirm bars'], ['stopAtr', 'Stop (×ATR)'], ['targetAtr', 'Target (×ATR)'], ['maxHold', 'Max hold (candles)'], ['costBps', 'Cost (bps/side)']];
    html += '<div class="mem-sec"><details><summary>Settings</summary><div class="mem-set">' + fields.map((f) => '<label>' + f[1] + '<input type="number" step="any" data-mem-p="' + f[0] + '" value="' + esc(p[f[0]]) + '"></label>').join('') + '</div><button type="button" class="mem-btn" data-mem="reset">Reset to defaults</button></details></div>';
    html += '<div class="mem-sec"><details><summary>How MEM ALGO decides</summary><ul><li>Fast EMA crossing the slow EMA starts a setup.</li><li>It must stay crossed for ' + p.confirm + ' closed candles — the signal fires on the last of them, never on the cross candle.</li><li>Longs only above the trend EMA, shorts only below it.</li><li>Price must be at least ' + p.minSep + '× ATR away from the slow EMA, so flat, choppy crossovers are ignored.</li><li>Stop ' + p.stopAtr + '× ATR, target ' + p.targetAtr + '× ATR from the entry.</li>' + (p.session ? '<li>Ignores the first ' + p.session.skipOpen + ' and last ' + p.session.skipClose + ' minutes of the regular session and all off-hours candles.</li>' : '') + '<li>Backtest enters on the next candle\'s open; if one candle touches both stop and target it counts as a loss.</li></ul></details></div>';
    html += '<div class="mem-foot">Educational simulation on closed candles. Past results do not predict future returns. Not financial advice, and nothing here places a trade.</div>';
    panel.innerHTML = html;
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
      h += '<p class="mem-blurb">Level 2 is a reading of what buyers and sellers are doing, not a prediction. Every signal is being recorded with what price did next, so it can be measured before anyone relies on it.</p>';
    }
    box.innerHTML = h;
    const g = panel.querySelector('#mem-grade');
    if (g) { const dir = Number(g.dataset.dir), gr = o && o.grades ? (dir > 0 ? o.grades.long : o.grades.short) : null; g.innerHTML = gr ? 'Level 2 vs this ' + (dir > 0 ? 'BUY' : 'SELL') + ': <b class="' + gr.grade + '">' + gradeText[gr.grade] + '</b> <span class="mem-blurb">' + esc(gr.reason) + '</span>' : ''; }
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
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.devicePixelRatio || 1;
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
      [['fast', '#4dd8ff', 1.4], ['slow', '#ffa94d', 1.4], ['trend', 'rgba(170,185,195,.75)', 2]].forEach(([k, color, lw]) => {
        lctx.beginPath(); let started = false;
        for (let j = 0; j < view.length; j++) { const a = ai(j); const v = a == null ? NaN : ind[k][a]; if (!Number.isFinite(v)) { started = false; continue; } if (started) lctx.lineTo(x(j), y(v)); else { lctx.moveTo(x(j), y(v)); started = true; } }
        lctx.strokeStyle = color; lctx.lineWidth = lw; lctx.stroke();
      });
    }
    if (S.overlays.signals) {
      lctx.font = '800 9px ui-monospace,monospace'; lctx.textAlign = 'center';
      for (let j = 0; j < view.length; j++) {
        const a = ai(j); if (a == null) continue;
        const sg = d.signals.find((s) => s.i === a); if (!sg) continue;
        const buy = sg.dir > 0, px = x(j), py = buy ? y(+view[j].l) + 12 : y(+view[j].h) - 12;
        lctx.fillStyle = buy ? '#00d084' : '#ff5470'; lctx.beginPath();
        if (buy) { lctx.moveTo(px, py - 7); lctx.lineTo(px - 6, py + 4); lctx.lineTo(px + 6, py + 4); } else { lctx.moveTo(px, py + 7); lctx.lineTo(px - 6, py - 4); lctx.lineTo(px + 6, py - 4); }
        lctx.closePath(); lctx.fill(); lctx.fillText(buy ? 'BUY' : 'SELL', px, buy ? py + 15 : py - 10);
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
        if (price < lo || price > hi) return; const yy = y(price);
        lctx.save(); lctx.setLineDash([5, 4]); lctx.strokeStyle = color; lctx.lineWidth = 1; lctx.beginPath(); lctx.moveTo(pad.l, yy); lctx.lineTo(pad.l + pw, yy); lctx.stroke(); lctx.restore();
        lctx.fillStyle = color; lctx.font = '700 9px ui-monospace,monospace'; lctx.textAlign = 'left'; lctx.fillText(label + ' ' + price.toFixed(2), pad.l + 4, yy - 3);
      });
    }
  }

  // ---- events ----
  toggle.addEventListener('click', () => { if (S.on && S.open) { S.on = false; S.open = false; } else { S.on = true; S.open = true; } save(); paint(); draw(); if (S.on) { refresh(true); pollOF(); } });
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mem],[data-mem-mode]'); if (!t) return;
    if (t.dataset.mem === 'close') { S.open = false; paint(); return; }
    if (t.dataset.mem === 'reset') { S.params[S.mode] = {}; save(); recompute(); paint(); draw(); return; }
    if (t.dataset.memMode) { S.mode = t.dataset.memMode; save(); recompute(); paint(); draw(); }
  });
  panel.addEventListener('change', (e) => {
    const ov = e.target.closest('[data-mem-ov]'), pr = e.target.closest('[data-mem-p]');
    if (ov) { S.overlays[ov.dataset.memOv] = ov.checked; save(); draw(); }
    if (pr) { S.params[S.mode][pr.dataset.memP] = pr.value; save(); recompute(); paint(); draw(); }
  });
  let last = '';
  (function frame() { // redraw whenever the chart moves (drag, zoom, new candles, resize)
    try {
      const st = window.smlAcademyChartState(), lastBar = st.bars[st.bars.length - 1];
      const sig = [st.bars.length, lastBar && lastBar.t, lastBar && lastBar.c, st.offset, st.scale, chartCanvas.clientWidth, chartCanvas.clientHeight, S.on, S.data && S.data.bars, S.of && S.of.asOf].join('|');
      if (sig !== last) { last = sig; draw(); }
      if (S.on && S.sigKey !== symbol() + ':' + tf() && !S.loading) refresh(true);
    } catch (_) { /* chart not ready yet */ }
    requestAnimationFrame(frame);
  })();
  setInterval(() => { if (S.on) refresh(false); }, 20000);
  setInterval(pollOF, 2500);
  window.addEventListener('sml-academy-market', () => { if (S.on) setTimeout(() => refresh(true), 300); });
  paint(); if (S.on) { refresh(true); pollOF(); }
})();
