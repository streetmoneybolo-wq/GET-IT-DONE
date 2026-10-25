/* Candle recap on the chart: click a day, week, month, quarter or year candle and the whole period opens as a window —
 * the candle itself, conviction (volume, range), context (trend, 52-week position), the smart-money map, off-exchange / dark
 * pool share and short volume per session (FINRA), sentiment, and the master read that scores it all. Route
 * /academy-activity/candle-recap. Recorded data, educational, never advice. */
(function boot(tries) {
  if (window.__smlCandleRecap) return;
  const stage = document.querySelector('.academy-chart-stage'), below = document.getElementById('academy-below');
  if (!stage || !below || !window.smlChartModel) { if (tries < 150) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlCandleRecap = true;
  const TFS = ['1D', '1W', '1M', '1Q', '1Y'];
  const PAD = { l: 12, r: 64, t: 18, b: 24 };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const px = (v) => (num(v) == null ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (v, d = 2) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%');
  const big = (v) => (num(v) == null ? '—' : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)));
  const tf = () => new URLSearchParams(location.search).get('tf') || '5m';
  const symbol = () => { try { return String(window.smlChartModel().symbol || '').toUpperCase(); } catch (_) { return String((document.getElementById('symbol') || {}).value || 'SPY').toUpperCase(); } };
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');

  const css = document.createElement('style');
  css.textContent = '#candle-recap{display:none;padding:14px;border:1px solid #2a3f5a;border-radius:12px;background:radial-gradient(900px 300px at 0 0,#13233a 0,#080e18 55%);color:#dbe6f2;font:600 .72rem/1.45 system-ui,sans-serif;margin:0 0 18px}#candle-recap.open{display:block}'
    + '#candle-recap h2{margin:0;font:800 .95rem ui-monospace,monospace;color:#e8f0ff}#candle-recap .hd{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin:0 0 10px}#candle-recap .hd .sub{color:#8aa0bd;font:700 .6rem ui-monospace,monospace;letter-spacing:.05em}'
    + '#candle-recap .hd .px{margin-left:auto;text-align:right}#candle-recap .hd .px b{display:block;font:900 1.3rem/1.1 ui-monospace,monospace;color:#fff}#candle-recap .hd .px i{font-style:normal;font:800 .66rem ui-monospace,monospace}'
    + '#candle-recap .badge{display:inline-block;padding:4px 10px;border-radius:999px;font:900 .62rem ui-monospace,monospace;letter-spacing:.08em}#candle-recap .badge.bullish{background:#0f3a20;color:#5df0b0;border:1px solid #1f8a5f}#candle-recap .badge.bearish{background:#3a0f14;color:#ff8ea1;border:1px solid #a4485a}#candle-recap .badge.neutral{background:#26343d;color:#c5d3db;border:1px solid #4a5a66}'
    + '#candle-recap .sim{display:inline-block;padding:2px 8px;border-radius:5px;background:#1d2a3a;color:#9ab;font:800 .54rem ui-monospace,monospace;letter-spacing:.08em}'
    + '#candle-recap .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}#candle-recap .card{padding:10px 12px;border:1px solid #1f2f45;border-radius:10px;background:rgba(10,18,30,.85)}#candle-recap .card.wide{grid-column:1/-1}#candle-recap h3{margin:0 0 8px;font:800 .62rem ui-monospace,monospace;color:#7fd6f0;letter-spacing:.08em}#candle-recap h3 small{color:#6f8794;font-weight:600;letter-spacing:0;margin-left:6px}'
    + '#candle-recap .dpread{margin:6px 0 2px;padding:6px 8px;border:1px solid rgba(201,158,230,.35);border-left:3px solid #c99ee6;border-radius:8px;background:rgba(201,158,230,.06)}#candle-recap .dpread b{display:block;font:700 .62rem ui-monospace,monospace;color:#e6d3f3;margin-bottom:4px}#candle-recap .dpread p{margin:3px 0;font:.6rem/1.35 ui-monospace,monospace;color:#c8d6de}#candle-recap .dpread p i{font-style:normal;font-weight:700;color:#c99ee6}'
    + '#candle-recap .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:6px;margin:0 0 8px}#candle-recap .kpi{padding:6px 8px;border:1px solid #1f2f45;border-radius:8px;background:#0b1424}#candle-recap .kpi span{display:block;color:#7f95b1;font:700 .52rem ui-monospace,monospace;letter-spacing:.05em}#candle-recap .kpi b{display:block;font:800 .82rem ui-monospace,monospace;color:#eef4ff;margin-top:2px}#candle-recap .kpi b.up{color:#5df0b0}#candle-recap .kpi b.dn{color:#ff8ea1}'
    + '#candle-recap .m{margin:5px 0}#candle-recap .m span{display:flex;justify-content:space-between;color:#9fb3c8;font:700 .56rem ui-monospace,monospace}#candle-recap .m i{display:block;height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}#candle-recap .m i b{display:block;height:100%;border-radius:0 3px 3px 0;min-width:2px}#candle-recap .m i u{position:absolute;top:-2px;bottom:-2px;width:2px;background:#ffd166}'
    + '#candle-recap .candle{position:relative;height:26px;margin:6px 0 10px;border-radius:6px;background:#0e1a2c}#candle-recap .candle .rng{position:absolute;top:11px;height:4px;left:2%;right:2%;background:#2a3f5a;border-radius:2px}#candle-recap .candle .body{position:absolute;top:5px;height:16px;border-radius:3px}#candle-recap .candle .lbl{position:absolute;top:-14px;font:700 .5rem ui-monospace,monospace;color:#7f95b1}'
    + '#candle-recap ul{margin:0;padding-left:16px}#candle-recap li{margin:0 0 4px;color:#c9d6e5}#candle-recap li.up{color:#9ff0c0}#candle-recap li.dn{color:#ffb3c0}#candle-recap li.warn{color:#ffe0a0}'
    + '#candle-recap .days{display:flex;gap:2px;align-items:flex-end;height:40px;margin:6px 0}#candle-recap .days i{flex:1;max-width:24px;background:#3987e5;border-radius:4px 4px 0 0;min-height:2px}#candle-recap .days i.hot{background:#d95926}'
    + '#candle-recap table{width:100%;border-collapse:collapse;font:600 .62rem ui-monospace,monospace}#candle-recap td,#candle-recap th{padding:4px 5px;text-align:left;border-bottom:1px solid rgba(31,47,69,.7)}#candle-recap th{color:#7f95b1;font-weight:700}#candle-recap td.r{text-align:right}'
    + '#candle-recap .scen{display:grid;grid-template-columns:1fr 1fr;gap:8px}#candle-recap .scen div{padding:8px;border-radius:8px;border:1px solid #1f2f45}#candle-recap .scen .bull{border-color:#1f8a5f;background:#0b1f15}#candle-recap .scen .bear{border-color:#a4485a;background:#2a0b10}#candle-recap .scen b{display:block;margin-bottom:3px;font:800 .58rem ui-monospace,monospace;letter-spacing:.06em}'
    + '#candle-recap .note{margin-top:8px;color:#7f95b1;font-size:.58rem;font-weight:500}#candle-recap .x{float:right;border:1px solid #2b4b5a;border-radius:6px;background:#0c1821;color:#cfe3ea;font:800 11px/1 system-ui;padding:4px 7px;cursor:pointer}'
    + '#candle-recap-hint{display:none;color:#7fd6f0;font:700 .56rem ui-monospace,monospace;margin-left:4px}#candle-recap-hint.on{display:inline}#candle-recap-hint{white-space:nowrap;flex:none}@media(max-width:720px){#candle-recap-hint.on{display:none}}'
    + 'body.sml-recap-tf .academy-chart-stage{cursor:pointer}';
  document.head.appendChild(css);

  const el = document.createElement('section'); el.id = 'candle-recap'; el.setAttribute('data-sml-module', 'candle-recap'); el.setAttribute('data-sml-module-label', 'Candle recap'); el.setAttribute('aria-label', 'Candle recap');
  const title = below.querySelector('.below-title'); if (title) title.insertAdjacentElement('afterend', el); else below.prepend(el);
  el.addEventListener('click', (e) => { if (e.target.closest('.x')) { el.classList.remove('open'); if (window.smlAcademyCustomize && window.smlAcademyCustomize.windows().includes('candle-recap')) window.smlAcademyCustomize.close('candle-recap'); } });
  const hint = document.createElement('span'); hint.id = 'candle-recap-hint'; hint.textContent = 'click a candle for its full recap';
  const tools = document.querySelector('.academy-chart-tools'); if (tools) tools.appendChild(hint);
  const paintHint = () => { const on = TFS.includes(tf()); hint.classList.toggle('on', on); document.body.classList.toggle('sml-recap-tf', on); };
  paintHint(); setInterval(paintHint, 1500);

  /* ---------- the click (a press without a drag, on the plot, cursor tool, recap timeframes) ---------- */
  let down = null;
  stage.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; down = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }; }, true);
  stage.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (!d || d.id !== e.pointerId || Date.now() - d.t > 450 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    if (!TFS.includes(tf())) return;
    const P = window.smlChartPro; if (P && P.view && P.view.tool !== 'cursor') return;
    if (e.target.closest && e.target.closest('.academy-pro-panel,.academy-pro-palette,.academy-interval-stats,#mem-algo-panel,#smc-card,button,input,select,a')) return;
    const m = window.smlChartModel(); if (!m) return;
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < PAD.l || x > m.w - PAD.r || y < PAD.t || y > m.h - PAD.b) return;
    const idx = Math.round(m.idxAt(x)); if (!(idx >= 0 && idx < m.N)) return;
    const bar = m.bars[idx]; if (!bar) return;
    void open(bar);
  }, true);

  let busy = false;
  async function open(bar) {
    const token = window.smlAcademySessionToken;
    el.classList.add('open');
    if (!token) { el.innerHTML = '<button type="button" class="x">×</button><h2>CANDLE RECAP</h2><p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; show(); return; }
    if (busy) return; busy = true;
    el.innerHTML = '<button type="button" class="x">×</button><h2>' + esc(symbol()) + ' · ' + esc(tf()) + '</h2><p class="note">Reading the full record for this candle…</p>';
    show();
    try {
      const q = new URLSearchParams({ symbol: symbol(), tf: tf(), t: String(bar.t), o: String(bar.o), h: String(bar.h), l: String(bar.l), c: String(bar.c), v: String(bar.v || 0) });
      const res = await fetch('/academy-activity/candle-recap?' + q.toString(), { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { el.innerHTML = '<button type="button" class="x">×</button><h2>' + esc(symbol()) + ' · ' + esc(tf()) + '</h2><p class="note">' + esc(j.detail || ('No recap right now (' + (j.error || res.status) + ').')) + '</p>'; return; }
      render(j);
    } catch (_) { el.innerHTML = '<button type="button" class="x">×</button><h2>CANDLE RECAP</h2><p class="note">The server did not answer.</p>'; }
    finally { busy = false; }
  }
  function show() {
    if (typeof window.smlAcademyFloat === 'function' && !(matchMedia('(pointer:coarse)').matches || innerWidth < 760)) { void window.smlAcademyFloat('candle-recap'); }
    else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- rendering ---------- */
  const meter = (label, value, max, color, markAt) => '<div class="m"><span><em>' + label + '</em><em>' + value.text + '</em></span><i><b style="width:' + Math.round(Math.max(0, Math.min(1, value.v / max)) * 100) + '%;background:' + color + '"></b>' + (markAt != null ? '<u style="left:' + Math.round(Math.max(0, Math.min(1, markAt / max)) * 100) + '%" title="typical"></u>' : '') + '</i></div>';
  const kpi = (label, value, c) => '<div class="kpi"><span>' + label + '</span><b class="' + (c || '') + '">' + value + '</b></div>';
  function candleBar(s) {
    const span = s.h - s.l || 1, L = (v) => 2 + ((v - s.l) / span) * 96;
    const a = L(Math.min(s.o, s.c)), b = L(Math.max(s.o, s.c));
    return '<div class="candle"><span class="lbl" style="left:2%">LOW ' + px(s.l) + '</span><span class="lbl" style="right:2%">HIGH ' + px(s.h) + '</span><div class="rng"></div><div class="body" style="left:' + a.toFixed(1) + '%;width:' + Math.max(0.8, b - a).toFixed(1) + '%;background:' + (s.c >= s.o ? '#00d084' : '#ff5470') + '"></div></div>';
  }
  function render(j) {
    const s = j.stats, r = j.read, p = j.period, up = (s.changePct != null ? s.changePct : s.bodyPct) >= 0;
    const smc = j.smc, off = j.offExchange, sh = j.shortSale, se = j.sentiment, cd = j.candle, intra = j.intraday;
    const li = (f) => '<li class="' + esc(f.tone) + '">' + esc(f.text) + '</li>';
    el.innerHTML = '<button type="button" class="x" title="Close">×</button>'
      + '<div class="hd"><div><h2>' + esc(j.symbol) + ' · ' + esc(p.label) + '</h2><div class="sub">' + esc(p.kind.toUpperCase()) + ' CANDLE · ' + esc(p.from) + (p.to !== p.from ? ' → ' + esc(p.to) : '') + ' · ' + s.sessions + ' session' + (s.sessions === 1 ? '' : 's') + (p.includesToday ? ' · STILL FORMING' : '') + ' <span class="sim">RECORDED DATA · EDUCATIONAL</span></div></div>'
      + '<div><span class="badge ' + esc(r.bias) + '">' + esc(r.bias.toUpperCase()) + ' · ' + r.confidence + '%</span><div class="sub" style="margin-top:4px">' + esc(r.headline) + '</div></div>'
      + '<div class="px"><b>' + px(s.c) + '</b><i class="' + cls(s.changePct) + '">' + pct(s.changePct) + ' vs prior close</i><br><i style="color:#8aa0bd">O ' + px(s.o) + ' · H ' + px(s.h) + ' · L ' + px(s.l) + ' · V ' + big(s.v) + '</i></div></div>'
      + '<div class="grid">'
      // the candle
      + '<div class="card"><h3>THE CANDLE</h3>' + candleBar(s)
      + meter('Close location in range', { v: s.closeLoc, text: Math.round(s.closeLoc * 100) + '% up from the low' }, 1, s.closeLoc >= 0.5 ? '#00d084' : '#ff5470')
      + meter('Body', { v: s.bodyRatio, text: Math.round(s.bodyRatio * 100) + '% of range' }, 1, '#7fd6f0')
      + meter('Upper wick', { v: s.upperWick, text: Math.round(s.upperWick * 100) + '%' }, 1, '#ff9f43') + meter('Lower wick', { v: s.lowerWick, text: Math.round(s.lowerWick * 100) + '%' }, 1, '#ff9f43')
      + '<div class="kpis">' + kpi('VS PRIOR', esc(s.relation || '—').toUpperCase()) + kpi('GAP AT OPEN', pct(s.gapPct), cls(s.gapPct)) + kpi('BODY MOVE', pct(s.bodyPct), cls(s.bodyPct)) + kpi('RANGE', pct(s.rangePct)) + '</div>'
      + (cd && (cd.names.length || cd.charts.length) ? '<ul>' + cd.names.map((n) => '<li class="' + (n.dir > 0 ? 'up' : n.dir < 0 ? 'dn' : 'warn') + '">' + esc(n.name) + ' · ' + Math.round(n.strength * 100) + '%' + (n.note ? ' · ' + esc(n.note) : '') + '</li>').join('') + cd.charts.map((c) => '<li class="' + (c.dir === 'bull' ? 'up' : c.dir === 'bear' ? 'dn' : 'warn') + '">' + esc(String(c.name).replace(/_/g, ' ')) + ' · ' + esc(c.status) + ' ' + Math.round(c.confidence * 100) + '%' + (c.target ? ' · target ' + px(c.target) : '') + '</li>').join('') + '</ul>' : '<p class="note">No named candle or chart pattern completed on this candle.</p>') + '</div>'
      // conviction
      + '<div class="card"><h3>CONVICTION</h3>'
      + meter('Volume vs 20-session average', { v: s.rvol || 0, text: s.rvol != null ? s.rvol.toFixed(2) + 'x' : '—' }, 3, s.rvol >= 1.5 ? '#ff9f43' : '#7fd6f0', 1)
      + meter('Range vs average true range', { v: s.rangeAtr || 0, text: s.rangeAtr != null ? s.rangeAtr.toFixed(2) + 'x ATR ' + px(s.atr) : '—' }, 3, s.rangeAtr >= 1.5 ? '#ff9f43' : '#7fd6f0', 1)
      + '<div class="kpis">' + kpi('AVG DAY VOLUME', big(s.avgDayVol)) + (s.sessions > 1 ? kpi('UP / DOWN DAYS', s.ups + ' / ' + s.downs) + kpi('BEST DAY', pct(s.bestDay.pct) + '<small style="display:block;color:#7f95b1">' + esc(s.bestDay.date) + '</small>', 'up') + kpi('WORST DAY', pct(s.worstDay.pct) + '<small style="display:block;color:#7f95b1">' + esc(s.worstDay.date) + '</small>', 'dn') + kpi('MAX DRAWDOWN', pct(s.maxDrawdownPct), 'dn') : '') + '</div>'
      + (intra ? '<h3>INSIDE THE DAY<small>5-minute record</small></h3><div class="kpis">' + kpi('HIGH AT', esc(intra.highAt)) + kpi('LOW AT', esc(intra.lowAt)) + kpi('FIRST HOUR', intra.firstHourShare != null ? Math.round(intra.firstHourShare * 100) + '% of volume' : '—') + kpi('LAST HOUR', intra.lastHourShare != null ? Math.round(intra.lastHourShare * 100) + '% of volume' : '—') + kpi('VWAP', px(intra.vwap)) + '</div>' + (intra.read.length ? '<ul>' + intra.read.map((x) => '<li class="' + esc(x.tone) + '">' + esc(x.text) + '</li>').join('') + '</ul>' : '') : '') + '</div>'
      // context
      + '<div class="card"><h3>CONTEXT</h3><div class="kpis">' + kpi('20 SMA', px(s.sma20) + (s.sma20 != null ? '<small style="display:block" class="' + cls(s.c - s.sma20) + '">' + (s.c >= s.sma20 ? 'close above' : 'close below') + '</small>' : '')) + kpi('50 SMA', px(s.sma50) + (s.sma50 != null ? '<small style="display:block" class="' + cls(s.c - s.sma50) + '">' + (s.c >= s.sma50 ? 'close above' : 'close below') + '</small>' : '')) + kpi('200 SMA', px(s.sma200) + (s.sma200 != null ? '<small style="display:block" class="' + cls(s.c - s.sma200) + '">' + (s.c >= s.sma200 ? 'close above' : 'close below') + '</small>' : '')) + kpi('20 SMA SLOPE', pct(s.slope20Pct) + ' / 5 sessions', cls(s.slope20Pct)) + kpi('STREAK GOING IN', s.streakBefore ? Math.abs(s.streakBefore) + ' ' + (s.streakBefore > 0 ? 'up' : 'down') : 'none') + (s.nextChangePct != null ? kpi('WHAT CAME NEXT', pct(s.nextChangePct), cls(s.nextChangePct)) : kpi('WHAT CAME NEXT', 'not yet')) + '</div>'
      + meter('Position in the 52-week range', { v: s.pos52 || 0, text: s.pos52 != null ? Math.round(s.pos52 * 100) + '% · ' + px(s.lo52) + ' to ' + px(s.hi52) : '—' }, 1, '#c46bff') + '</div>'
      // smart money
      + '<div class="card"><h3>SMART MONEY MAP</h3>' + (smc ? '<div class="kpis">' + kpi('STRUCTURE', smc.events.length ? smc.events.map((e) => e.type + ' ' + (e.dir > 0 ? '▲' : '▼') + ' ' + px(e.level)).join(', ') : 'no break on this candle') + kpi('LIQUIDITY', smc.sweeps.length ? smc.sweeps.map((x) => 'swept ' + x.kind + ' ' + px(x.level)).join(', ') : (smc.openLiquidity.length ? smc.openLiquidity.map((x) => x.kind + ' ' + px(x.level)).join(', ') + ' resting' : '—')) + kpi('IMBALANCE', smc.fvgs.length ? smc.fvgs.map((g) => (g.dir > 0 ? 'bull ' : 'bear ') + px(g.bottom) + '-' + px(g.top) + (g.filled ? ' (filled)' : '')).join(', ') : 'none left') + kpi('ORDER BLOCKS', smc.orderBlocks.length ? smc.orderBlocks.map((o) => (o.dir > 0 ? 'demand ' : 'supply ') + px(o.bottom) + '-' + px(o.top)).join(', ') : '—') + kpi('RANGE', smc.range ? (smc.range.pos > 0.5 ? 'PREMIUM' : 'DISCOUNT') + ' ' + Math.round(Math.max(0, Math.min(1, smc.range.pos)) * 100) + '%' : '—') + kpi('VWAP', smc.vwap ? px(smc.vwap.level) + (smc.vwap.above ? ' · above' : ' · below') : '—', smc.vwap ? (smc.vwap.above ? 'up' : 'dn') : '') + '</div><ul>' + smc.read.map((x) => '<li class="' + esc(x.tone) + '">' + esc(x.text) + '</li>').join('') + '</ul>' : '<p class="note">Not enough bars on this timeframe for a structure read.</p>') + '</div>'
      // off exchange
      + '<div class="card"><h3>DARK POOL · OFF-EXCHANGE<small>' + esc(off.source) + '</small></h3>'
      + meter('Off-exchange share of volume', { v: off.share || 0, text: off.share != null ? Math.round(off.share * 100) + '% (typical ~' + Math.round(off.typical * 100) + '%)' : 'no file for these sessions' }, 1, off.share >= off.typical + 0.1 ? '#ff9f43' : '#7fd6f0', off.typical)
      + (off.days.length ? '<div class="days">' + off.days.map((d) => '<i class="' + (d.share != null && d.share >= off.typical + 0.1 ? 'hot' : '') + '" style="height:' + Math.round(Math.max(0.05, Math.min(1, d.share || 0)) * 100) + '%" title="' + esc(d.date) + ' · ' + (d.share != null ? Math.round(d.share * 100) + '% off-exchange' : '') + ' · ' + big(d.offExchange) + ' sh"></i>').join('') + '</div><p class="note">' + off.covered + ' of ' + off.of + ' sessions covered. Each bar = one session\'s off-exchange share.</p>' : '')
      + (off.today ? '<div class="kpis">' + kpi('TODAY LIVE', off.today.offSharePct != null ? Math.round(off.today.offSharePct) + '% off-exchange' : (off.today.share != null ? Math.round(off.today.share * 100) + '% off-exchange' : '—')) + (off.today.blocks && off.today.blocks.count != null ? kpi('BLOCK PRINTS', String(off.today.blocks.count)) : '') + (off.today.prints != null ? kpi('PRINTS', big(off.today.prints)) : '') + '</div>' : '')
      + (off.today && off.today.read ? '<div class="dpread"><b>' + esc(off.today.read.headline) + '</b>' + (off.today.read.steps || []).map((st, i) => '<p><i>' + (i + 1) + '. ' + esc(st.k) + '</i> ' + esc(st.text) + '</p>').join('') + '</div>' : '') + '</div>'
      // short sale
      + '<div class="card"><h3>SHORT SALE<small>' + esc(sh.source) + '</small></h3>'
      + meter('Short volume share of off-exchange prints', { v: sh.ratio || 0, text: sh.ratio != null ? Math.round(sh.ratio * 100) + '%' + (sh.baselineRatio != null ? ' (normal ' + Math.round(sh.baselineRatio * 100) + '%)' : '') : '—' }, 1, sh.baselineRatio != null && sh.ratio >= sh.baselineRatio + 0.08 ? '#ff9f43' : '#7fd6f0', sh.baselineRatio)
      + (sh.days.length ? '<div class="days">' + sh.days.map((d) => '<i class="' + (sh.baselineRatio != null && d.ratio >= sh.baselineRatio + 0.08 ? 'hot' : '') + '" style="height:' + Math.round(Math.max(0.05, Math.min(1, d.ratio || 0)) * 100) + '%" title="' + esc(d.date) + ' · ' + (d.ratio != null ? Math.round(d.ratio * 100) + '% short' : '') + '"></i>').join('') + '</div>' : '')
      + '<div class="kpis">' + kpi('SHORT VOLUME', big(sh.shortVolume)) + (sh.interest ? kpi('AVG SHORT RATIO (FEED)', sh.interest.avgRatio != null ? Math.round(sh.interest.avgRatio * (sh.interest.avgRatio > 1 ? 1 : 100)) + '%' : '—') + kpi('DAYS TO COVER', sh.interest.daysToCover != null ? sh.interest.daysToCover.toFixed(1) : '—') : '') + '</div></div>'
      // sentiment
      + '<div class="card"><h3>SENTIMENT</h3>' + (se ? meter('Composite score', { v: (se.score + 1) / 2, text: (se.score >= 0 ? '+' : '') + Math.round(se.score * 100) + (se.label ? ' · ' + se.label : '') }, 1, se.score >= 0 ? '#00d084' : '#ff5470', 0.5)
        + (se.components ? '<div class="kpis">' + Object.keys(se.components).map((k) => { const c = se.components[k]; const v = c && num(c.score); return kpi(k.toUpperCase(), v == null ? (c && c.reason ? esc(String(c.reason).replace(/_/g, ' ')) : '—') : (v >= 0 ? '+' : '') + Math.round(v * 100), v == null ? '' : cls(v)); }).join('') + '</div>' : '')
        + '<div class="kpis">' + kpi('PERIOD AVERAGE', se.periodAvg != null ? (se.periodAvg >= 0 ? '+' : '') + Math.round(se.periodAvg * 100) + ' (' + se.periodPoints + ' reads)' : 'no memory for this period') + kpi('COVERAGE', se.coverage != null ? se.coverage + '%' : '—') + kpi('CROWDED LONG', se.crowdedLong ? 'YES' : 'no', se.crowdedLong ? 'dn' : '') + '</div>'
        + (se.ai && se.ai.summary ? '<p class="note">' + esc(se.ai.summary) + '</p>' : '') + '<p class="note">' + esc(se.note) + '</p>' : '<p class="note">Sentiment service not available for this read.</p>') + '</div>'
      // master read
      + '<div class="card wide"><h3>MASTER READ<small>every part above, scored together</small></h3><div class="hd"><span class="badge ' + esc(r.bias) + '">' + esc(r.bias.toUpperCase()) + ' · confidence ' + r.confidence + '%</span><span class="sub">' + esc(r.headline) + ' · score ' + (r.score >= 0 ? '+' : '') + r.score + ' over ' + r.factors.length + ' factors</span></div>'
      + '<ul>' + r.factors.map(li).join('') + '</ul>'
      + '<h3 style="margin-top:10px">LEVELS THAT MATTER</h3><table><thead><tr><th>Level</th><th class="r">Price</th><th>Why</th></tr></thead><tbody>' + r.levels.map((l) => '<tr><td>' + esc(l.label) + '</td><td class="r">' + px(l.price) + '</td><td>' + esc(l.why) + '</td></tr>').join('') + '</tbody></table>'
      + '<h3 style="margin-top:10px">TWO SCENARIOS</h3><div class="scen"><div class="bull"><b>IF BUYERS FOLLOW THROUGH</b>' + esc(r.scenarios.bull) + '</div><div class="bear"><b>IF IT FAILS</b>' + esc(r.scenarios.bear) + '</div></div>'
      + '<p class="note">' + esc(r.note) + ' ' + esc(j.disclaimer) + '</p></div>'
      + '</div>';
  }
})(0);
