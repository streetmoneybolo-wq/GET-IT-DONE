/* Alerts desk for the Academy Live Chart Lab: the trader's alerts in a window beside the chart at all times.
   Each alert shows a low-to-high risk grade, its progress to target, and a plan that updates itself (hold / raise target / take partial profits / sell).
   Long-term alerts add a compact yes/no company checklist. Click an alert and the chart switches to it; open it for the full reasoning.
   Members only: it uses the same Academy session as the options chain. Educational analysis, not advice. */
(function boot(tries) {
  const shell = document.querySelector('.shell');
  const side = document.querySelector('.shell > .side');
  if (window.__smlAlertsUi) return;
  if (!shell || !side) { if (tries < 100) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlAlertsUi = true;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const px = (v) => (v == null || !Number.isFinite(v) ? '–' : (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)));
  const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
  const BAND = { LOW: '#19c37d', MODERATE: '#9bd93c', ELEVATED: '#ffb020', HIGH: '#ff6a3d', EXTREME: '#ff2d55' };
  const ACT = { HOLD: ['HOLD', '#7fa6bf', '#0c1a24'], RAISE_TARGET: ['RAISE TARGET', '#19e36b', '#03150c'], PARTIAL: ['TAKE PARTIAL', '#ffb020', '#221500'], SELL: ['SELL', '#ff5470', '#2a0509'] };

  const S = { alerts: [], feed: {}, tab: 'all', hidden: false, open: null, detail: null, session: '', asOf: 0, error: '', loading: false, sheet: false };
  const KEY = 'sml-alerts-desk-v1';
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && ['all', 'swings', 'longterm'].includes(saved.tab)) S.tab = saved.tab; if (saved && saved.hidden === true) S.hidden = true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ tab: S.tab, hidden: S.hidden })); } catch (_) { /* ignore */ } };

  const style = document.createElement('style');
  style.textContent = '#academy-alerts{display:flex;flex-direction:column;min-height:0;overflow:hidden;background:#0a1118;border-left:1px solid #1b3540;color:#dcebf4;font:600 .68rem system-ui,sans-serif}'
    + '#academy-alerts header{display:flex;align-items:center;gap:6px;padding:8px 9px 6px;border-bottom:1px solid #1b3540;flex-wrap:wrap}#academy-alerts header b{font:800 .7rem ui-monospace,monospace;color:#42f5b3;letter-spacing:.06em}#academy-alerts header small{margin-left:auto;color:#6f8794;font-weight:600}'
    + '#academy-alerts .aa-tabs{display:flex;gap:4px;padding:6px 9px;border-bottom:1px solid #16303b}#academy-alerts .aa-tabs button{flex:1;padding:5px 4px;border:1px solid #23495a;border-radius:6px;background:#0d1a24;color:#a9bfcb;font:800 .62rem system-ui;cursor:pointer}#academy-alerts .aa-tabs button.on{background:#12362b;border-color:#00d084;color:#fff}'
    + '#academy-alerts .aa-list{flex:1;overflow:auto;overscroll-behavior:contain;padding:6px 7px 10px;scrollbar-width:thin}'
    + '#academy-alerts .aa-row{border:1px solid #1b3540;border-radius:9px;background:#0c1620;margin:0 0 6px;cursor:pointer;padding:7px 8px}#academy-alerts .aa-row:hover{border-color:#2f6a7f}#academy-alerts .aa-row.cur{border-color:#42f5b3;box-shadow:0 0 0 1px rgba(66,245,179,.25)}#academy-alerts .aa-row.open{background:#0e1c28}'
    + '#academy-alerts .aa-top{display:flex;align-items:center;gap:6px}#academy-alerts .aa-risk{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:999px;font:800 .56rem ui-monospace,monospace;color:#061019;white-space:nowrap}#academy-alerts .aa-sym{font:800 .86rem ui-monospace,monospace;color:#fff}'
    + '#academy-alerts .aa-px{margin-left:auto;text-align:right;font:700 .7rem ui-monospace,monospace}#academy-alerts .up{color:#5df0b0}#academy-alerts .dn{color:#ff8ea1}#academy-alerts .mut{color:#7f97a4}'
    + '#academy-alerts .aa-bar{position:relative;height:5px;border-radius:3px;background:#17303c;margin:7px 0 4px}#academy-alerts .aa-bar i{position:absolute;top:-2px;width:2px;height:9px;background:#ffd166}#academy-alerts .aa-bar em{position:absolute;top:-3px;width:9px;height:11px;margin-left:-4px;border-radius:2px;background:#fff}'
    + '#academy-alerts .aa-lv{display:flex;justify-content:space-between;color:#8fa6b3;font:600 .58rem ui-monospace,monospace}'
    + '#academy-alerts .aa-act{display:flex;align-items:center;gap:6px;margin-top:6px}#academy-alerts .aa-chip{padding:2px 7px;border-radius:5px;font:800 .58rem ui-monospace,monospace;white-space:nowrap}#academy-alerts .aa-why{color:#a9bfcb;font-weight:600;font-size:.62rem;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '#academy-alerts .aa-chk{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;align-items:center}#academy-alerts .aa-chk span{display:inline-block;padding:1px 4px;border-radius:4px;font:800 .54rem ui-monospace,monospace;background:#17303c;color:#8fa6b3}#academy-alerts .aa-chk .y{background:#0d3a2b;color:#5df0b0}#academy-alerts .aa-chk .n{background:#40151d;color:#ff8ea1}#academy-alerts .aa-chk b{margin-left:auto;font:800 .6rem ui-monospace,monospace;color:#dcebf4}'
    + '#academy-alerts .aa-det{margin-top:8px;border-top:1px solid #1d3a48;padding-top:7px;cursor:default}#academy-alerts .aa-det h5{margin:8px 0 4px;font:800 .56rem ui-monospace,monospace;color:#86a2b0;letter-spacing:.08em}'
    + '#academy-alerts .aa-f{display:grid;grid-template-columns:96px 1fr;gap:1px 6px;align-items:center;margin-bottom:4px}#academy-alerts .aa-f .aa-meter{height:5px;border-radius:3px;background:#17303c;overflow:hidden}#academy-alerts .aa-f .aa-meter i{display:block;height:100%}#academy-alerts .aa-f small{grid-column:1/3;color:#7f97a4;font-weight:500;font-size:.58rem;line-height:1.3}#academy-alerts .aa-f.na{opacity:.5}'
    + '#academy-alerts .aa-det ul{margin:0;padding:0 0 0 14px;color:#c5d3db;font-weight:500;font-size:.62rem;line-height:1.45}#academy-alerts .aa-raw{color:#8fa6b3;font:500 .58rem ui-monospace,monospace;word-break:break-word}#academy-alerts .aa-note{padding:8px 9px;color:#6f8794;font-weight:500;font-size:.56rem;line-height:1.4;border-top:1px solid #16303b}'
    + '#academy-alerts .aa-empty{padding:16px 10px;color:#8fa6b3;font-weight:600;line-height:1.5;text-align:center}#academy-alerts .aa-empty button{margin-top:8px;padding:7px 12px;border:0;border-radius:8px;background:#00c47d;color:#042217;font:800 .7rem system-ui;cursor:pointer}#academy-alerts .aa-warn{margin:6px 7px 0;padding:6px 8px;border:1px solid #6a4a1a;border-radius:8px;background:#211609;color:#ffd08a;font-weight:600;font-size:.6rem}'
    + '#academy-alerts .aa-swap{margin-left:4px;padding:3px 7px;border:1px solid #23495a;border-radius:6px;background:#0d1a24;color:#a9bfcb;font:800 .58rem system-ui;cursor:pointer}'
    + '#academy-alerts .aa-av{width:22px;height:22px;border-radius:50%;object-fit:cover;background:#17303c;flex:none;border:1px solid #2b5362}#academy-alerts .aa-av.none{display:none}#academy-alerts .aa-who{color:#8fa6b3;font:600 .58rem system-ui;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#academy-alerts .aa-opt{padding:2px 7px;border-radius:5px;font:800 .58rem ui-monospace,monospace;white-space:nowrap;border:1px solid}#academy-alerts .aa-oc{margin:0 0 6px;padding:7px 8px;border:1px solid #23495a;border-radius:8px;background:#0b1a24;line-height:1.4;font-weight:500;font-size:.62rem;color:#c5d3db}#academy-alerts .aa-oc b{color:#fff}#academy-alerts .aa-og{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:6px 0}#academy-alerts .aa-og div{background:#10232f;border-radius:6px;padding:4px 6px;font:700 .62rem ui-monospace,monospace;color:#fff}#academy-alerts .aa-og small{display:block;color:#7f97a4;font:600 .5rem system-ui;letter-spacing:.05em}'
    + '#academy-alerts .aa-close{margin-left:auto;padding:3px 9px;border:1px solid #23495a;border-radius:6px;background:#0d1a24;color:#eaf5f8;font:800 .7rem system-ui;cursor:pointer}'
    + '#academy-alerts-fab{display:none;position:fixed;left:10px;bottom:14px;z-index:2147481000;align-items:center;gap:6px;padding:9px 13px;border:1px solid #2b5362;border-radius:999px;background:#0b1620;color:#eaf5f8;font:800 .72rem system-ui;box-shadow:0 6px 20px rgba(0,0,0,.5);cursor:pointer}#academy-alerts-fab i{width:9px;height:9px;border-radius:50%;background:#19c37d}'
    // wide: a third column between the chart and the quote panel
    + '@media(min-width:1280px){body:not(.academy-lesson-open):not(.alerts-hidden) .shell{grid-template-columns:minmax(0,1fr) 300px 330px!important}#academy-alerts .aa-swap{display:none}}'
    // medium: the alerts take the quote column; a button swaps back
    + '@media(min-width:721px) and (max-width:1279px){body:not(.academy-lesson-open):not(.alerts-quote):not(.alerts-hidden) .shell{grid-template-columns:minmax(0,1fr) 320px!important}body:not(.academy-lesson-open):not(.alerts-quote):not(.alerts-hidden) .shell>.side{display:none!important}body.alerts-quote #academy-alerts{display:none!important}}'
    + '@media(min-width:721px){body.alerts-hidden #academy-alerts{display:none!important}body.alerts-hidden:not(.academy-lesson-open) #academy-alerts-fab{display:flex}}'
    + 'body.academy-lesson-open #academy-alerts,body.academy-lesson-open #academy-alerts-fab{display:none!important}'
    // phones: a floating button opens the desk as a bottom sheet
    + '@media(max-width:720px){#academy-alerts .aa-swap{display:none}#academy-alerts header small{margin-left:6px}#academy-alerts{display:none}body:not(.academy-lesson-open) #academy-alerts.sheet{display:flex;position:fixed;left:0;right:0;bottom:0;height:72vh;z-index:2147482000;border-left:0;border-top:1px solid #2b5362;border-radius:14px 14px 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.6)}'
    + 'body:not(.academy-lesson-open) #academy-alerts-fab{display:flex}}';
  document.head.appendChild(style);

  const panel = document.createElement('aside'); panel.id = 'academy-alerts'; panel.setAttribute('aria-label', 'Alerts desk');
  shell.insertBefore(panel, side);
  const fab = document.createElement('button'); fab.id = 'academy-alerts-fab'; fab.type = 'button'; document.body.appendChild(fab);

  function setHidden(v) { S.hidden = v; document.body.classList.toggle('alerts-hidden', v); if (!v) document.body.classList.remove('alerts-quote'); save(); paint(); window.dispatchEvent(new Event('resize')); }
  document.body.classList.toggle('alerts-hidden', S.hidden);
  const filtered = () => S.alerts.filter((a) => S.tab === 'all' || a.channel === S.tab);
  const chartSymbol = () => String(new URLSearchParams(location.search).get('symbol') || '').toUpperCase();

  function progressBar(a) {
    const lo = Math.min(a.entry, a.low != null ? a.low : a.entry, a.price != null ? a.price : a.entry), hi = Math.max(a.plan.target, a.target0, a.high != null ? a.high : a.target0, a.price != null ? a.price : a.entry);
    const span = Math.max(1e-9, hi - lo), at = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
    return '<div class="aa-bar" title="entry, stop, target and where price is now"><i style="left:' + at(a.entry) + '%;background:#7fa6bf"></i><i style="left:' + at(a.plan.stop) + '%;background:#ff5470"></i><i style="left:' + at(a.target0) + '%"></i>'
      + (a.plan.target !== a.target0 ? '<i style="left:' + at(a.plan.target) + '%;background:#19e36b"></i>' : '') + (a.price != null ? '<em style="left:' + at(a.price) + '%"></em>' : '') + '</div>'
      + '<div class="aa-lv"><span>stop ' + px(a.plan.stop) + '</span><span>entry ' + px(a.entry) + '</span><span>target ' + px(a.plan.target) + (a.plan.target !== a.target0 ? '↑' : '') + '</span></div>';
  }
  function rowHtml(a) {
    const act = ACT[a.plan.action] || ACT.HOLD, col = BAND[a.risk.band] || '#888', cur = chartSymbol() === a.symbol, open = S.open === a.id;
    const chk = a.checklist ? '<div class="aa-chk">' + a.checklist.items.map((i) => '<span class="' + (i.ok === true ? 'y' : i.ok === false ? 'n' : '') + '" title="' + esc(i.l + (i.ok === true ? ': yes' : i.ok === false ? ': no' : ': unknown')) + '">' + (i.ok === true ? '✓' : i.ok === false ? '✗' : '–') + ' ' + esc(shortLabel(i.k)) + '</span>').join('') + '<b>' + a.checklist.yes + '/' + (a.checklist.yes + a.checklist.no) + ' yes</b></div>' : '';
    let html = '<div class="aa-row' + (cur ? ' cur' : '') + (open ? ' open' : '') + '" data-id="' + esc(a.id) + '" data-sym="' + esc(a.symbol) + '">'
      + '<div class="aa-top">' + (a.avatar ? '<img class="aa-av" src="' + esc(a.avatar) + '" alt="" loading="lazy" title="' + esc(a.author) + '">' : '') + '<span class="aa-risk" style="background:' + col + '" title="Risk ' + a.risk.score + ' of 100">' + a.risk.score + ' ' + esc(a.risk.label.toUpperCase()) + '</span><span class="aa-sym">' + esc(a.symbol) + '</span><span class="mut">' + ago(a.at) + '</span><span class="aa-who" title="posted by ' + esc(a.author) + '">' + esc(a.author) + '</span>'
      + '<span class="aa-px"><span>$' + px(a.price) + '</span> <span class="' + ((a.chgPct || 0) >= 0 ? 'up' : 'dn') + '">' + (a.chgPct == null ? '' : (a.chgPct >= 0 ? '+' : '') + a.chgPct.toFixed(1) + '%') + '</span><br><span class="' + ((a.sincePct || 0) >= 0 ? 'up' : 'dn') + '" title="since the alert">' + pc(a.sincePct) + ' since alert</span></span></div>'
      + progressBar(a)
      + '<div class="aa-act"><span class="aa-chip" style="background:' + act[1] + ';color:' + act[2] + '">' + act[0] + (a.plan.action === 'RAISE_TARGET' || a.plan.action === 'PARTIAL' ? ' → ' + px(a.plan.target) : '') + '</span>' + optChip(a) + '<span class="aa-why">' + esc(a.plan.reasons[0] || '') + '</span></div>' + chk;
    if (open) html += detailHtml(a);
    return html + '</div>';
  }
  const OPT = { CALL: ['#19e36b', 'CALL'], PUT: ['#ff5470', 'PUT'], WAIT: ['#ffb020', 'OPTIONS: WAIT'], NONE: ['#7f97a4', 'NO OPTIONS'] };
  function optChip(a) {
    const o = a.options; if (!o || !o.available) return '';
    const m = OPT[o.verdict] || OPT.NONE;
    const label = o.verdict === 'CALL' || o.verdict === 'PUT' ? m[1] + (o.strength ? ' · ' + (o.strength === 'Worth a look' ? 'consider' : 'marginal') : '') : m[1];
    return '<span class="aa-opt" style="color:' + m[0] + ';border-color:' + m[0] + '" title="Options contract consideration: open the alert for details">' + esc(label) + '</span>';
  }
  function optionsHtml(o) {
    if (!o) return '';
    const m = OPT[o.verdict] || OPT.NONE;
    let h = '<h5>OPTIONS CONTRACT CONSIDERATION</h5><div class="aa-oc"><b style="color:' + m[0] + '">' + (o.verdict === 'CALL' || o.verdict === 'PUT' ? esc(o.verdict) + ' · ' + esc(o.strength || '') : o.verdict === 'WAIT' ? 'WAIT' : 'NO CONTRACT') + '</b> ' + esc(o.summary || o.reason || '');
    if (o.contract) {
      const c = o.contract;
      h += '<div class="aa-og"><div><small>COST</small>$' + c.costPerContract + '</div><div><small>BREAKEVEN</small>$' + px(c.breakeven) + '</div><div><small>DELTA</small>' + c.delta.toFixed(2) + '</div>'
        + '<div><small>BID / ASK</small>' + px(c.bid) + ' / ' + px(c.ask) + '</div><div><small>OPEN INT</small>' + c.oi + '</div><div><small>IV</small>' + (c.iv != null ? Math.round(c.iv * 100) + '%' : '–') + '</div></div>';
      if (o.reason) h += '<div>' + esc(o.reason) + '.</div>';
      if (o.flags && o.flags.length) h += '<ul style="margin-top:4px">' + o.flags.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>';
      if (o.alternatives && o.alternatives.length) h += '<div class="mut" style="margin-top:4px">Also fits: ' + o.alternatives.map((x) => esc(x.dte + 'd $' + x.strike + ' ' + x.type.toLowerCase() + ' (~$' + x.costPerContract + ', delta ' + x.delta.toFixed(2) + ')')).join(' · ') + '</div>';
    }
    return h + '<div class="mut" style="margin-top:4px">Educational analysis. Options can lose their entire value, and nothing here places a trade.</div></div>';
  }
  const SHORT = { profit: 'Profit', growth: 'Sales', cash: 'Cash flow', debt: 'Debt', liquidity: 'Cash>debt', dilution: 'No dilution', size: 'Size', trend: 'Trend', value: 'Value' };
  const shortLabel = (k) => SHORT[k] || k;
  function detailHtml(a) {
    const d = S.detail && S.detail.id === a.id ? S.detail : null;
    if (!d) return '<div class="aa-det"><span class="mut">Loading the full breakdown…</span></div>';
    let h = '<div class="aa-det" data-stop="1">';
    h += '<h5>WHAT THE PLAN SAYS</h5><ul>' + d.plan.reasons.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>';
    h += '<div class="aa-lv" style="margin-top:4px"><span>new target ' + px(d.plan.target) + '</span><span>stop ' + px(d.plan.stop) + '</span><span>high since ' + px(d.high) + '</span></div>';
    if (d.risk.flags && d.risk.flags.length) h += '<h5>FLAGS</h5><ul>' + d.risk.flags.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>';
    h += '<h5>RISK BREAKDOWN · ' + d.risk.score + ' / 100' + (d.risk.coverage < 60 ? ' · ' + d.risk.coverage + '% of data found' : '') + '</h5>';
    h += (d.factors || []).slice().sort((x, y) => (y.available ? y.weight * y.risk : -1) - (x.available ? x.weight * x.risk : -1)).map((f) => '<div class="aa-f' + (f.available ? '' : ' na') + '"><span>' + esc(f.label) + '</span><div class="aa-meter"><i style="width:' + Math.round((f.available ? f.risk : 0) * 100) + '%;background:' + riskColor(f.risk) + '"></i></div><small>' + esc(f.detail) + '</small></div>').join('');
    if (d.options && d.options.available) h += optionsHtml(d.options);
    if (d.checklist) h += '<h5>COMPANY CHECKLIST</h5><ul>' + d.checklist.items.map((i) => '<li>' + (i.ok === true ? '✓ ' : i.ok === false ? '✗ ' : '– ') + '<b>' + esc(i.l) + '</b>: ' + esc(i.d || '') + '</li>').join('') + '</ul>';
    const sig = [];
    if (d.algo) sig.push('MEM ALGO: ' + d.algo.label); if (d.flow) sig.push('Order book (' + d.flow.source + '): ' + d.flow.bias); if (d.sector) sig.push('Sector: ' + d.sector.name + (d.sector.chgPct != null ? ' ' + (d.sector.chgPct >= 0 ? '+' : '') + d.sector.chgPct.toFixed(1) + '% today' : ''));
    if (sig.length) h += '<h5>SIGNALS</h5><ul>' + sig.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>';
    if (d.news && d.news.length) h += '<h5>NEWS</h5><ul>' + d.news.map((n) => '<li>' + (/^https:\/\//.test(n.url) ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer" style="color:#7fd4ff">' + esc(n.title) + '</a>' : esc(n.title)) + '</li>').join('') + '</ul>';
    if (d.chatter && d.chatter.length) h += '<h5>CHATTER</h5><ul>' + d.chatter.map((c) => '<li>' + esc(c.sentiment ? c.sentiment + ': ' : '') + esc(c.text) + '</li>').join('') + '</ul>';
    if (d.planLog && d.planLog.length > 1) h += '<h5>PLAN HISTORY</h5><ul>' + d.planLog.slice().reverse().map((p) => '<li>' + esc((ACT[p.action] || ACT.HOLD)[0]) + (p.target ? ' · target ' + px(p.target) : '') + ' · ' + ago(p.t) + ' ago' + (p.price ? ' at $' + px(p.price) : '') + '</li>').join('') + '</ul>';
    h += '<h5>ORIGINAL ALERT · posted by ' + esc(d.author) + '</h5><div class="aa-raw">' + esc(d.raw) + '</div>';
    return h + '</div>';
  }
  const riskColor = (r) => (r >= 0.85 ? BAND.EXTREME : r >= 0.65 ? BAND.HIGH : r >= 0.45 ? BAND.ELEVATED : r >= 0.25 ? BAND.MODERATE : BAND.LOW);

  function paint() {
    const list = filtered();
    const worst = S.alerts.reduce((m, a) => Math.max(m, a.risk.score), 0);
    const bandOfWorst = worst >= 85 ? 'EXTREME' : worst >= 65 ? 'HIGH' : worst >= 45 ? 'ELEVATED' : worst >= 25 ? 'MODERATE' : 'LOW';
    fab.innerHTML = '<i style="background:' + (S.alerts.length ? BAND[bandOfWorst] : '#6f8794') + '"></i>Alerts' + (S.alerts.length ? ' · ' + S.alerts.length : '');
    const swapBtn = '<button type="button" class="aa-swap" data-act="swap" title="Show the quote and order book instead">Quote</button>';
    const closeBtn = '<button type="button" class="aa-close" data-act="close" aria-label="Close alerts">✕</button>';
    let head = '<header><b>ALERTS DESK</b>' + swapBtn + closeBtn + '<small>' + (S.asOf ? 'updated ' + ago(S.asOf) + ' ago' : '') + '</small></header>'
      + '<div class="aa-tabs">' + [['all', 'All'], ['swings', 'Swings'], ['longterm', 'Long-Term']].map(([k, l]) => '<button type="button" data-tab="' + k + '" class="' + (S.tab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    let body;
    if (!S.session) body = '<div class="aa-empty">The alerts desk is for verified Academy members.<br><button type="button" data-act="unlock">Unlock Academy Tools</button></div>';
    else if (S.error && !S.alerts.length) body = '<div class="aa-empty">' + esc(S.error) + '</div>';
    else if (!list.length) body = '<div class="aa-empty">' + (S.loading ? 'Loading the alerts…' : S.alerts.length ? 'No alerts in this list right now.' : 'No recent alerts yet. New ones appear here the moment they are posted.') + '</div>';
    else body = list.map(rowHtml).join('');
    const warn = ['swings', 'longterm'].filter((k) => S.feed[k] && S.feed[k].ok === false && (S.tab === 'all' || S.tab === k)).map((k) => '<div class="aa-warn">' + (k === 'swings' ? 'Swings' : 'Long-Term') + ' feed is reconnecting' + (S.feed[k].error ? ' (' + esc(S.feed[k].error) + ')' : '') + '. What is shown may be behind.</div>').join('');
    const scrollTop = (panel.querySelector('.aa-list') || {}).scrollTop || 0;
    panel.innerHTML = head + warn + '<div class="aa-list">' + body + '</div><div class="aa-note">Educational analysis of posted alerts: risk grade, plan and checklist come from public data, MEM ALGO, order-book pressure and chatter. Not advice; nothing here places a trade.</div>';
    const l = panel.querySelector('.aa-list'); if (l) l.scrollTop = scrollTop;
  }

  async function api(path) {
    const res = await fetch(path, { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' });
    if (res.status === 401 && window.smlAcademyReauth) { const fresh = await window.smlAcademyReauth(); if (fresh) { S.session = fresh; return fetch(path, { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' }); } }
    return res;
  }
  async function load() {
    if (!S.session || S.loading || document.hidden) return;
    S.loading = true;
    try {
      const res = await api('/academy-activity/alerts'); const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j && j.error || 'alerts_unavailable');
      S.alerts = j.alerts || []; S.feed = j.feed || {}; S.asOf = j.asOf; S.error = '';
      if (S.open && !S.alerts.some((a) => a.id === S.open)) { S.open = null; S.detail = null; }
    } catch (e) { S.error = e && e.message === 'alerts_disabled' ? 'The alerts desk is switched off right now.' : 'The alerts desk is reconnecting…'; }
    S.loading = false; paint();
    if (S.open) refreshDetail();
  }
  async function refreshDetail() {
    const id = S.open; if (!id) return;
    try { const res = await api('/academy-activity/alerts?detail=' + encodeURIComponent(id)); const j = await res.json(); if (res.ok && j.ok && S.open === id) { S.detail = j.alert; paint(); } } catch (_) { /* the summary stays */ }
  }

  // a poster with no picture, or a blocked one, just loses the round image
  panel.addEventListener('error', (e) => { if (e.target && e.target.classList && e.target.classList.contains('aa-av')) e.target.classList.add('none'); }, true);
  panel.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; save(); paint(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'unlock') { const u = document.getElementById('academy-unlock'); if (u) u.click(); }
      if (act.dataset.act === 'swap') { document.body.classList.add('alerts-quote'); }
      if (act.dataset.act === 'close') { if (window.matchMedia('(max-width:720px)').matches) { S.sheet = false; panel.classList.remove('sheet'); } else setHidden(true); }
      return;
    }
    if (e.target.closest('[data-stop]')) return;
    const row = e.target.closest('.aa-row'); if (!row) return;
    const id = row.dataset.id, sym = row.dataset.sym;
    if (window.smlAcademyNavigateMarket && chartSymbol() !== sym) window.smlAcademyNavigateMarket(sym);
    if (S.open === id) { S.open = null; S.detail = null; paint(); }
    else { S.open = id; S.detail = null; paint(); refreshDetail(); }
    if (window.matchMedia('(max-width:720px)').matches && chartSymbol() !== sym) { S.sheet = false; panel.classList.remove('sheet'); }
  });
  fab.addEventListener('click', () => { if (S.hidden && !window.matchMedia('(max-width:720px)').matches) { setHidden(false); return; } S.sheet = !S.sheet; panel.classList.toggle('sheet', S.sheet); paint(); });
  // the quote panel gets a way back to the alerts on medium screens
  const back = document.createElement('button'); back.type = 'button'; back.className = 'aa-swap'; back.textContent = '← Alerts'; back.style.cssText = 'display:none;margin:0 0 8px';
  side.insertBefore(back, side.firstChild);
  const syncBack = () => { back.style.display = document.body.classList.contains('alerts-quote') && window.matchMedia('(min-width:721px) and (max-width:1279px)').matches ? 'inline-block' : 'none'; };
  back.addEventListener('click', () => { document.body.classList.remove('alerts-quote'); syncBack(); });
  new MutationObserver(syncBack).observe(document.body, { attributes: true, attributeFilter: ['class'] }); window.addEventListener('resize', syncBack);

  window.addEventListener('sml-academy-session', (e) => { const t = String((e.detail && e.detail.sessionToken) || ''); if (t) { S.session = t; load(); } });
  window.addEventListener('popstate', paint);
  setInterval(() => { if (window.smlChartGesture) return; load(); }, 15000);
  setInterval(() => { if (!window.smlChartGesture) paint(); }, 30000); // keeps the "ago" labels honest and the highlighted row on the chart symbol
  paint();
  window.smlAlertsDesk = { state: S, reload: load };
})(0);
