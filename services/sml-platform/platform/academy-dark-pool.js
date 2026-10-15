/* Dark pool / off-exchange print markers for the Academy Live Chart Lab. The massive stream already
 * classifies every trade as lit or off-exchange (SIP exchange code 4, or a Trade Reporting Facility
 * indicator — real trade-condition data, not a synthetic estimate) and ships it in the live tape;
 * this layer is purely presentation: it marks each off-exchange print on the chart at its own time
 * and price, and keeps a running panel of the dark-pool share of volume, recent off-exchange prints
 * and the largest ones. Educational display only: nothing here places a trade. */
(() => {
  if (window.__smlDarkPool) return;
  window.__smlDarkPool = true;
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 2) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const whole = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const sym = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();

  const KEY = 'sml-dark-pool-v1';
  const S = { on: false, seen: new Set() };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };

  const toolbar = document.querySelector('.toolbar');
  const chartCanvas = $('chart');
  if (!toolbar || !chartCanvas) return;

  const style = document.createElement('style');
  style.textContent = '#darkpool-layer{position:absolute;pointer-events:none;z-index:6;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}'
    + '.darkpool-toggle{margin-left:4px;padding:5px 9px;border:1px solid #4a2b62;border-radius:7px;background:#160d24;color:#c99ee6;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.darkpool-toggle.on{background:#4a1a6a;border-color:#b06bff;color:#fff}'
    + '.academy-darkpool{margin-top:10px;border-top:1px solid #1b3540;padding-top:8px;font:600 .62rem system-ui,sans-serif;color:#c7d5dc}.academy-darkpool h4{margin:0 0 6px;font:800 .58rem ui-monospace;color:#86a2b0;letter-spacing:.06em}'
    + '.academy-darkpool .kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0;font:600 .6rem ui-monospace,monospace}.academy-darkpool .kv span:nth-child(odd){color:#8fa6b3}'
    + '.academy-darkpool .row{display:flex;justify-content:space-between;gap:6px;padding:2px 0;font:.6rem ui-monospace;border-bottom:1px solid rgba(42,66,78,.35);color:#c99ee6}.academy-darkpool .row i{font-style:normal;color:#6f8794}'
    + '.academy-darkpool .read{margin:6px 0;padding:6px 8px;border:1px solid rgba(201,158,230,.35);border-left-width:3px;border-radius:6px;background:rgba(201,158,230,.06)}.academy-darkpool .read b{display:block;font:700 .62rem ui-monospace,monospace;color:#e6d3f3;margin-bottom:4px}.academy-darkpool .read p{margin:3px 0;font:.6rem/1.35 ui-monospace,monospace;color:#c8d6de}.academy-darkpool .read p i{font-style:normal;font-weight:700;color:#c99ee6;margin-right:4px}.academy-darkpool .read.unusual{border-left-color:#ff9f43}.academy-darkpool .read.heavy{border-left-color:#c99ee6}.academy-darkpool .read.quiet{border-left-color:#6f8794}.academy-darkpool .read details{margin-top:4px}.academy-darkpool .read summary{cursor:pointer;font:600 .56rem ui-monospace,monospace;color:#8fa6b3}.academy-darkpool .read small{display:block;color:#8fa6b3;margin:2px 0}.academy-darkpool .row .tag{color:#ff9f43;margin-left:4px}'
    + '.academy-darkpool small{display:block;margin-top:5px;color:#6f8794;font-weight:500;font-size:.54rem;line-height:1.35}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'darkpool-toggle'; btn.className = 'darkpool-toggle'; btn.textContent = 'DARK POOL'; btn.title = 'Off-exchange (dark pool) prints: where they traded and how much of today’s volume they are'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'darkpool-layer'; const ctx = layer.getContext('2d');

  /* Finds the bar a raw trade timestamp belongs to (the last bar whose own start time is at or
     before t), so an off-exchange print can be placed on the chart by time rather than by bar
     index. bars must be ascending by .t (as chart bars always are). */
  function barIndexForTime(bars, t) {
    if (!bars || !bars.length) return -1;
    if (t < bars[0].t) return 0;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  // The server keeps its own list of recent off-exchange prints (deeper than the shared tape); older servers only have the tape.
  const offPrints = (L) => (L.stats && Array.isArray(L.stats.offTape) && L.stats.offTape.length ? L.stats.offTape : (L.tape || []).filter((t) => t.off));

  function marker(x, y, color) {
    ctx.save(); ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath();
    ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = '#f0e6ff'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }

  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || !w || !h) return;
    const L = window.smlLive; if (!L || L.symbol !== sym() || !offPrints(L).length) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const pad = M.pad, y = (v) => M.y(v), x = (i) => M.x(i), lo = M.lo, hi = M.hi;
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, M.pw, M.priceH || M.ph); ctx.clip(); // price pane only: never through the volume bars
    const off = offPrints(L).filter((t) => t.price >= lo && t.price <= hi);
    for (const t of off) {
      const i = barIndexForTime(M.bars, t.t); if (i < 0 || i < M.start - 1 || i > M.end + 1) continue;
      marker(x(i), y(t.price), t.size >= 500 ? '#e05dff' : '#a06bd0');
    }
    ctx.restore();
  }

  function paintPanel() {
    const panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-darkpool');
    if (!box) { box = document.createElement('div'); box.className = 'academy-darkpool'; const buysell = document.querySelector('.academy-buysell'), stats = document.querySelector('.academy-stats'), tape = document.querySelector('.academy-tape'); (buysell || stats || tape || panel).after(box); }
    if (!S.on) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (DP.sym !== sym()) void loadSession(true);
    const L = window.smlLive, st = L && L.symbol === sym() ? L.stats : null;
    let h = sessionHtml(DP.data && DP.sym === sym() ? DP.data : null);
    if (st && st.count) {
      const pct = st.vol > 0 ? (st.offVol / st.vol * 100) : 0;
      const recent = offPrints(L).slice(0, 6);
      h += '<h4 style="margin-top:8px">LIVE SINCE YOU OPENED · ' + pct.toFixed(0) + '% OF VOLUME</h4>'
        + '<div class="kv"><span>Off-exchange</span><span>' + whole(st.offVol) + ' sh · ' + whole(st.offN) + ' prints</span><span>Lit</span><span>' + whole(st.vol - st.offVol) + ' sh</span></div>'
        + (recent.length ? recent.map((t) => '<div class="row"><i>' + new Date(t.t).toLocaleTimeString('en-US', { hour12: false }) + '</i><span>$' + num(t.price) + ' × ' + whole(t.size) + '</span></div>').join('') : '<small>Off-exchange prints appear here as they arrive.</small>');
    } else h += '<small style="margin-top:6px">Live prints: collecting. Off-exchange prints appear here as they arrive during the session.</small>';
    box.innerHTML = h;
  }

  /* Session-wide read from the trade record (server: /academy-activity/dark-pool), refreshed every minute while the tool is on */
  const DP = { sym: '', data: null, at: 0, busy: false, err: '' };
  async function loadSession(force) {
    const s = sym();
    if (DP.busy || (!force && DP.sym === s && Date.now() - DP.at < 60000)) return;
    DP.busy = true;
    try {
      const headers = window.smlAcademySessionToken ? { authorization: 'Bearer ' + window.smlAcademySessionToken } : {};
      const r = await fetch('/academy-activity/dark-pool?symbol=' + encodeURIComponent(s), { cache: 'no-store', headers });
      const j = await r.json().catch(() => null);
      DP.sym = s; DP.at = Date.now(); DP.data = r.ok && j && j.ok ? j : null; DP.err = r.ok ? '' : (j && (j.detail || j.error)) || ('HTTP ' + r.status);
    } catch (_) { DP.sym = s; DP.at = Date.now(); DP.data = null; DP.err = 'offline'; }
    DP.busy = false; paintPanel();
  }
  const money = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
  const hhmm = (t) => new Date(t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  function sessionHtml(d) {
    if (!d) return '<h4>DARK POOL · TODAY</h4><small>' + (DP.busy ? 'Reading today\'s trade record…' : DP.err ? 'Trade record unavailable: ' + DP.err : 'Reading today\'s trade record…') + '</small>';
    if (!d.available) return '<h4>DARK POOL · TODAY</h4><small>' + (d.detail || (d.reason === 'too_few_prints' ? 'Only ' + whole(d.prints) + ' prints in the record so far: not enough to read.' : 'No prints in the trade record yet.')) + '</small>';
    const vs = d.offSharePct == null ? '' : d.offSharePct >= d.typicalSharePct + 10 ? ' · HIGH' : d.offSharePct <= d.typicalSharePct - 15 ? ' · LOW' : ' · normal';
    let h = '<h4>DARK POOL · TODAY · ' + (d.offSharePct == null ? '–' : d.offSharePct.toFixed(0)) + '% OF VOLUME' + vs + '</h4>';
    h += '<div class="kv"><span>Window</span><span>' + d.window.label + '</span>'
      + '<span>Off-exchange</span><span>' + whole(d.offVolume) + ' sh · ' + whole(d.offPrints) + ' prints</span>'
      + '<span>Typical share</span><span>about ' + d.typicalSharePct + '%</span>'
      + (d.blocks && d.blocks.count ? '<span>Blocks (' + d.blocks.rule + ')</span><span>' + whole(d.blocks.count) + ' · ' + whole(d.blocks.volume) + ' sh · ' + (d.blocks.sharePct == null ? '–' : d.blocks.sharePct.toFixed(0) + '% of off-exchange') + '</span>' : '<span>Blocks (' + (d.blocks ? d.blocks.rule : '10,000+ sh') + ')</span><span>none in this window</span>')
      + (d.lean ? '<span>Lean (tick rule)</span><span>' + (d.lean.offExchange > 0.25 ? 'buy side' : d.lean.offExchange < -0.25 ? 'sell side' : 'balanced') + (d.lean.lit != null ? ' · lit ' + (d.lean.lit > 0.25 ? 'buy side' : d.lean.lit < -0.25 ? 'sell side' : 'balanced') : '') + '</span>' : '') + '</div>';
    if (d.blocks && d.blocks.note) h += '<small>' + esc(d.blocks.note) + '</small>';
    if (d.read) {
      h += '<div class="read ' + String(d.read.verdict || '').toLowerCase() + '"><b>' + esc(d.read.headline) + '</b>'
        + (d.read.steps || []).map((st, i) => '<p><i>' + (i + 1) + '. ' + esc(st.k) + '</i>' + esc(st.text) + '</p>').join('')
        + '<details><summary>HOW TO READ THESE PRINTS</summary>' + (d.read.glossary || []).map((g) => '<small>' + esc(g) + '</small>').join('') + '</details></div>';
    }
    const yx = d.read && d.read.vsYesterday && d.read.vsYesterday.largestRatio != null ? d.read.vsYesterday.largestRatio : null;
    if (d.largest && d.largest.length) h += '<h4 style="margin-top:6px">LARGEST OFF-EXCHANGE PRINTS</h4>' + d.largest.slice(0, 5).map((b, i) => '<div class="row"><i>' + hhmm(b.t) + '</i><span>$' + num(b.price) + ' × ' + whole(b.size) + ' · $' + money(b.notional) + (b.dir === 'B' ? ' ▲' : b.dir === 'S' ? ' ▼' : '') + (i === 0 && yx != null && (yx >= 1.15 || yx <= 0.87) ? '<em class="tag">' + (yx >= 1.95 ? yx.toFixed(1).replace(/\.0$/, '') + 'x' : yx >= 1.15 ? '+' + Math.round((yx - 1) * 100) + '%' : '-' + Math.round((1 - yx) * 100) + '%') + ' vs yesterday\'s biggest</em>' : '') + '</span></div>').join('');
    if (d.afterHours && d.afterHours.largest && d.afterHours.largest.length) h += "<h4 style=\"margin-top:6px\">REPORTED AFTER YESTERDAY'S CLOSE</h4>" + d.afterHours.largest.map((b) => '<div class="row"><i>' + hhmm(b.t) + '</i><span>$' + num(b.price) + ' × ' + whole(b.size) + ' · $' + money(b.notional) + (b.dir === 'B' ? ' ▲' : b.dir === 'S' ? ' ▼' : '') + '</span></div>').join('') + '<small>' + esc(d.afterHours.note) + '</small>';
    if (d.levels && d.levels.length) h += '<h4 style="margin-top:6px">WHERE IT PRINTED</h4>' + d.levels.map((l) => '<div class="row"><i>$' + num(l.price) + '</i><span>' + whole(l.volume) + ' sh · ' + whole(l.prints) + ' prints · ' + l.lean + '</span></div>').join('');
    if (d.byHour && d.byHour.length > 1) h += '<h4 style="margin-top:6px">OFF-EXCHANGE SHARE BY HOUR</h4>' + d.byHour.map((x) => '<div class="row"><i>' + x.hour + '</i><span>' + (x.offSharePct == null ? '–' : x.offSharePct.toFixed(0) + '%') + ' of ' + whole(x.volume) + ' sh</span></div>').join('');
    h += '<small>' + d.note + ' ' + d.caveat + '</small>';
    return h;
  }
  function sync() { btn.classList.toggle('on', S.on); if (S.on) void loadSession(true); }
  setInterval(() => { if (S.on) void loadSession(false); }, 15000);
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); draw(); paintPanel(); });
  window.addEventListener('sml-live-data', () => { if (!window.smlChartGesture) draw(); paintPanel(); });
  // The chart is wrapped into its stage by a script that loads after this one, so the layer must follow it there even while the tool is off (draw() re-parents first).
  window.addEventListener('sml-chart-view', () => draw());
  window.addEventListener('resize', draw);
  sync(); draw(); paintPanel();
})();
