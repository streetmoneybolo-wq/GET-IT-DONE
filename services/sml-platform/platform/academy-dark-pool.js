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
    const L = window.smlLive; if (!L || L.symbol !== sym() || !Array.isArray(L.tape) || !L.tape.length) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const pad = M.pad, y = (v) => M.y(v), x = (i) => M.x(i), lo = M.lo, hi = M.hi;
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, M.pw, M.priceH || M.ph); ctx.clip(); // price pane only: never through the volume bars
    const off = L.tape.filter((t) => t.off && t.price >= lo && t.price <= hi);
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
    const L = window.smlLive, st = L && L.symbol === sym() ? L.stats : null;
    if (!st || !st.count) { box.innerHTML = '<h4>DARK POOL</h4><small>Collecting trades. Off-exchange prints fill in as they arrive.</small>'; return; }
    const pct = st.vol > 0 ? (st.offVol / st.vol * 100) : 0;
    const recent = (L.tape || []).filter((t) => t.off).slice(0, 6);
    const big = (st.big || []).filter((b) => b.off).slice(0, 3);
    box.innerHTML = '<h4>DARK POOL · ' + pct.toFixed(0) + '% OF VOLUME</h4>'
      + '<div class="kv"><span>Off-exchange volume</span><span>' + whole(st.offVol) + ' sh · ' + whole(st.offN) + ' prints</span>'
      + '<span>Lit volume</span><span>' + whole(st.vol - st.offVol) + ' sh</span></div>'
      + (big.length ? '<h4 style="margin-top:6px">LARGEST OFF-EXCHANGE PRINTS</h4>' + big.map((b) => '<div class="row"><i>' + new Date(b.t).toLocaleTimeString('en-US', { hour12: false }) + '</i><span>$' + num(b.price) + ' × ' + whole(b.size) + '</span></div>').join('') : '')
      + (recent.length ? '<h4 style="margin-top:6px">RECENT OFF-EXCHANGE PRINTS</h4>' + recent.map((t) => '<div class="row"><i>' + new Date(t.t).toLocaleTimeString('en-US', { hour12: false }) + '</i><span>$' + num(t.price) + ' × ' + whole(t.size) + '</span></div>').join('') : '')
      + '<small>Off-exchange (dark pool / ATS) prints are reported to the tape but not shown on a public exchange order book at the time they trade. They can reflect large, already-arranged trades. Educational only.</small>';
  }

  function sync() { btn.classList.toggle('on', S.on); }
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); draw(); paintPanel(); });
  window.addEventListener('sml-live-data', () => { if (!window.smlChartGesture) draw(); paintPanel(); });
  // The chart is wrapped into its stage by a script that loads after this one, so the layer must follow it there even while the tool is off (draw() re-parents first).
  window.addEventListener('sml-chart-view', () => draw());
  window.addEventListener('resize', draw);
  sync(); draw(); paintPanel();
})();
