/* Readable order-book walls, position cost distribution and live tape statistics for the Academy Live Chart Lab.
 * - WALLS: every book level as a depth bar on the right edge of the chart, and each real wall as a wide band with a large price-and-size label.
 * - COST: an estimate of where holders bought (price-by-volume of the last year, aged by turnover): profit ratio, average cost, and the price zones holding 70% / 90% of shares.
 * - TAPE STATS: lift-the-offer / hit-the-bid / neutral volume, VWAP, price-by-volume, off-exchange share and the largest prints, from the live trade stream.
 * Educational display only: nothing here places a trade. */
(() => {
  if (window.__smlDepthTools) return;
  window.__smlDepthTools = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const whole = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');
  const compact = (v) => (Number.isFinite(v) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '–');
  const sym = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();

  const KEY = 'sml-depth-tools-v1';
  const S = { walls: true, cost: false, live: null, cx: null, cxSym: '', cxAt: 0, cxBusy: false };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.walls = v.walls !== false; S.cost = v.cost === true; } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ walls: S.walls, cost: S.cost })); } catch (_) { /* ignore */ } };

  const style = document.createElement('style');
  style.textContent = '#depth-layer{position:absolute;pointer-events:none;z-index:5;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}'
    + '.depth-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.depth-toggle.on{background:#12405a;border-color:#4dc3ff;color:#fff}'
    + '.academy-stats{margin-top:10px;border-top:1px solid #1b3540;padding-top:8px;font:600 .62rem system-ui,sans-serif;color:#c7d5dc}.academy-stats h4{margin:0 0 6px;font:800 .58rem ui-monospace;color:#86a2b0;letter-spacing:.06em}'
    + '.academy-stats .flow{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#16303a;margin:4px 0}.academy-stats .flow i{display:block;height:100%}'
    + '.academy-stats .cols{display:flex;justify-content:space-between;font:700 .6rem ui-monospace,monospace}.academy-stats .up{color:#5df0b0}.academy-stats .dn{color:#ff8ea1}.academy-stats .nu{color:#9fb4c0}'
    + '.academy-stats .kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0;font:600 .6rem ui-monospace,monospace}.academy-stats .kv span:nth-child(odd){color:#8fa6b3}'
    + '.academy-stats .pv{display:grid;grid-template-columns:52px 1fr 44px;gap:2px 6px;align-items:center;font:600 .58rem ui-monospace,monospace}.academy-stats .pv b{display:block;height:6px;border-radius:3px;background:#3a7fa6}.academy-stats .big{margin-top:4px;font:600 .58rem ui-monospace,monospace}'
    + '.academy-stats small{display:block;margin-top:5px;color:#6f8794;font-weight:500;font-size:.54rem;line-height:1.35}';
  document.head.appendChild(style);

  const toolbar = document.querySelector('.toolbar');
  const chartCanvas = $('chart');
  if (!toolbar || !chartCanvas) return;
  const mk = (id, label, title) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'depth-toggle'; b.textContent = label; b.title = title; toolbar.appendChild(b); return b; };
  const bWalls = mk('depth-walls', 'WALLS', 'Show the bid and ask walls and the order-book depth on the chart');
  const bCost = mk('depth-cost', 'COST', 'Show where holders bought: cost distribution, profit ratio and average cost');
  const layer = document.createElement('canvas'); layer.id = 'depth-layer';
  const lctx = layer.getContext('2d');

  /* ---------- cost distribution (estimated from daily volume, aged by turnover) ---------- */
  function computeCost(bars) {
    const b = bars.slice(-260).filter((x) => +x.h > 0 && +x.l > 0 && +x.v >= 0);
    if (b.length < 30) return null;
    let lo = Infinity, hi = -Infinity; for (const x of b) { lo = Math.min(lo, +x.l); hi = Math.max(hi, +x.h); }
    const BINS = 120, step = (hi - lo) / BINS || 1; const chips = new Array(BINS).fill(0);
    const vols = b.map((x) => +x.v).sort((p, q) => p - q), med = vols[Math.floor(vols.length / 2)] || 1;
    const floatEst = med * 30; // roughly how many shares change hands over a month of typical days
    for (const x of b) {
      const turn = Math.min(0.9, (+x.v || 0) / floatEst);
      for (let i = 0; i < BINS; i++) chips[i] *= 1 - turn;
      const l = +x.l, h = +x.h, mode = (l + h + (+x.c)) / 3, span = Math.max(h - l, step);
      let wsum = 0; const w = new Array(BINS).fill(0);
      for (let i = 0; i < BINS; i++) { const p = lo + (i + 0.5) * step; if (p < l - step || p > h + step) continue; const tri = p <= mode ? (p - l + step) / (mode - l + step) : (h + step - p) / (h + step - mode); w[i] = Math.max(0, tri); wsum += w[i]; }
      if (wsum <= 0) continue; const add = (+x.v || 0) / wsum; for (let i = 0; i < BINS; i++) chips[i] += w[i] * add;
    }
    const total = chips.reduce((p, q) => p + q, 0); if (!(total > 0)) return null;
    const last = +b[b.length - 1].c;
    let avg = 0, prof = 0; for (let i = 0; i < BINS; i++) { const p = lo + (i + 0.5) * step; avg += p * chips[i]; if (p <= last) prof += chips[i]; }
    const pct = (q) => { let acc = 0; for (let i = 0; i < BINS; i++) { acc += chips[i]; if (acc / total >= q) return lo + (i + 0.5) * step; } return hi; };
    const r90 = [pct(0.05), pct(0.95)], r70 = [pct(0.15), pct(0.85)];
    return { lo, hi, step, chips, max: Math.max(...chips), total, avg: avg / total, profit: prof / total, r70, r90, conc90: (r90[1] - r90[0]) / (r90[1] + r90[0]), last, days: b.length };
  }
  async function loadCost() {
    const s = sym(); if (S.cxBusy || (S.cxSym === s && Date.now() - S.cxAt < 10 * 60000)) return;
    S.cxBusy = true;
    try {
      const res = await fetch('/academy-activity/market?symbol=' + encodeURIComponent(s) + '&tf=1D', { cache: 'no-store' });
      const d = await res.json();
      S.cx = res.ok && d && Array.isArray(d.bars) ? computeCost(d.bars) : null; S.cxSym = s; S.cxAt = Date.now();
    } catch (_) { S.cx = null; }
    S.cxBusy = false; draw();
  }

  /* ---------- drawing ---------- */
  function pill(ctx, text, x, y, fg, bg, align) {
    ctx.font = '800 11px ui-monospace,monospace'; const w = ctx.measureText(text).width + 12, h = 17;
    const left = align === 'right' ? x - w : x; ctx.fillStyle = bg; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(left, y - h / 2, w, h, 5) : ctx.rect(left, y - h / 2, w, h)); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, left + 6, y + 0.5); return { left, w, h };
  }
  function walls(book) {
    const out = []; const side = (levels, kind) => {
      const sizes = levels.map((l) => Number(l.size)).filter((v) => v > 0).sort((a, b) => a - b); if (sizes.length < 4) return;
      const med = sizes[Math.floor(sizes.length / 2)];
      levels.forEach((l, i) => { const s = Number(l.size); if (s >= Math.max(2 * med, 100)) out.push({ kind, price: Number(l.price), size: s, mult: s / (med || 1), rank: i }); });
    };
    side(book.bids || [], 'bid'); side(book.asks || [], 'ask');
    return out.sort((a, b) => b.size - a.size).slice(0, 4);
  }
  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, h);
    if (!w || !h || !(S.walls || S.cost)) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M) return;
    const pad = M.pad, pw = M.pw, ph = M.ph, lo = M.lo, hi = M.hi, y = (v) => M.y(v);
    lctx.save(); lctx.beginPath(); lctx.rect(pad.l, pad.t, pw, ph); lctx.clip();

    // position cost distribution: horizontal bars growing from the left edge, green where holders are in profit, red where they are under water
    if (S.cost && S.cx && S.cxSym === sym()) {
      const c = S.cx, maxW = pw * 0.22;
      for (let i = 0; i < c.chips.length; i++) {
        const p = c.lo + (i + 0.5) * c.step; if (p < lo || p > hi) continue;
        const bw = (c.chips[i] / c.max) * maxW, yy = y(p), bh = Math.max(2, Math.abs(y(p - c.step / 2) - y(p + c.step / 2)));
        lctx.fillStyle = p <= c.last ? 'rgba(0,208,132,.38)' : 'rgba(255,84,112,.38)'; lctx.fillRect(pad.l, yy - bh / 2, bw, Math.max(1.5, bh - 0.5));
      }
      if (c.avg >= lo && c.avg <= hi) {
        const yy = y(c.avg); lctx.save(); lctx.setLineDash([6, 4]); lctx.strokeStyle = '#ffd166'; lctx.lineWidth = 1.4; lctx.beginPath(); lctx.moveTo(pad.l, yy); lctx.lineTo(pad.l + pw, yy); lctx.stroke(); lctx.restore();
        pill(lctx, 'AVG COST $' + num(c.avg), pad.l + 6, yy - 12, '#241a00', '#ffd166');
      }
      const card = ['COST DISTRIBUTION (est.)', Math.round(c.profit * 100) + '% of shares in profit', '90% held between $' + num(c.r90[0]) + ' and $' + num(c.r90[1]), '70% held between $' + num(c.r70[0]) + ' and $' + num(c.r70[1])];
      lctx.font = '700 10.5px ui-monospace,monospace'; const cw = Math.max(...card.map((t) => lctx.measureText(t).width)) + 14, chh = card.length * 15 + 8, cx = pad.l + 6, cy = pad.t + 30;
      lctx.fillStyle = 'rgba(8,16,24,.86)'; lctx.fillRect(cx, cy, cw, chh); lctx.strokeStyle = '#2b5362'; lctx.strokeRect(cx + .5, cy + .5, cw - 1, chh - 1);
      card.forEach((t, i) => { lctx.fillStyle = i === 0 ? '#86a2b0' : i === 1 ? (c.profit >= 0.5 ? '#5df0b0' : '#ff8ea1') : '#dbe6ec'; lctx.textAlign = 'left'; lctx.textBaseline = 'alphabetic'; lctx.fillText(t, cx + 7, cy + 15 + i * 15); });
    }

    // order-book walls and depth
    const L = S.live;
    if (S.walls && L && L.symbol === sym() && L.book && ((L.book.bids || []).length > 1 || (L.book.asks || []).length > 1)) {
      const levels = [].concat((L.book.bids || []).map((l) => ({ kind: 'bid', price: Number(l.price), size: Number(l.size) })), (L.book.asks || []).map((l) => ({ kind: 'ask', price: Number(l.price), size: Number(l.size) })));
      const maxSize = Math.max(...levels.map((l) => l.size), 1), maxW = pw * 0.2, right = pad.l + pw;
      for (const l of levels) { if (l.price < lo || l.price > hi) continue; const bw = Math.max(3, (l.size / maxSize) * maxW), yy = y(l.price); lctx.fillStyle = l.kind === 'bid' ? 'rgba(0,208,132,.55)' : 'rgba(255,84,112,.55)'; lctx.fillRect(right - bw, yy - 2.5, bw, 5); }
      const ws = walls(L.book).filter((wl) => wl.price >= lo && wl.price <= hi).sort((a, b) => y(a.price) - y(b.price));
      let lastY = -99; const spot = Number.isFinite(L.last) ? L.last : null;
      ws.forEach((wl) => {
        const yy = y(wl.price), col = wl.kind === 'bid' ? '0,208,132' : '255,84,112', hex = wl.kind === 'bid' ? '#00d084' : '#ff5470';
        lctx.fillStyle = 'rgba(' + col + ',.18)'; lctx.fillRect(pad.l, yy - 6, pw, 12);
        lctx.strokeStyle = hex; lctx.lineWidth = 1.6; lctx.beginPath(); lctx.moveTo(pad.l, yy); lctx.lineTo(right, yy); lctx.stroke();
        let ly = yy; if (Math.abs(ly - lastY) < 20) ly = lastY + 20; lastY = ly;
        const dist = spot ? ((wl.price / spot - 1) * 100) : null;
        pill(lctx, (wl.kind === 'bid' ? 'BID WALL ' : 'ASK WALL ') + whole(wl.size) + ' sh @ $' + num(wl.price) + (dist != null ? '  ' + (dist >= 0 ? '+' : '') + dist.toFixed(2) + '%' : ''), right - (maxW + 8), ly, '#04140d', hex, 'right');
      });
    }
    lctx.restore();
  }

  /* ---------- tape statistics panel (under the time & sales) ---------- */
  function paintStats() {
    const L = S.live, panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-stats');
    if (!box) { box = document.createElement('div'); box.className = 'academy-stats'; const tape = document.querySelector('.academy-tape'); (tape || panel).after(box); }
    const st = L && L.symbol === sym() ? L.stats : null;
    if (!st || !st.count) { box.innerHTML = '<h4>TRADE STATISTICS · LIVE</h4><small>Collecting trades. The lift / hit split, VWAP and volume by price fill in as prints arrive.</small>'; return; }
    const tot = Math.max(1, st.buy + st.sell + st.neu), pb = st.buy / tot * 100, ps = st.sell / tot * 100, pn = 100 - pb - ps;
    const maxPv = Math.max(...st.pv.map((p) => p.vol), 1);
    const since = new Date(st.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    box.innerHTML = '<h4>TRADE STATISTICS · LIVE SINCE ' + esc(since) + '</h4>'
      + '<div class="cols"><span class="up">↑ LIFT ' + compact(st.buy) + '</span><span class="nu">◆ ' + compact(st.neu) + '</span><span class="dn">↓ HIT ' + compact(st.sell) + '</span></div>'
      + '<div class="flow"><i style="width:' + pb.toFixed(1) + '%;background:#00d084"></i><i style="width:' + pn.toFixed(1) + '%;background:#6f8794"></i><i style="width:' + ps.toFixed(1) + '%;background:#ff5470"></i></div>'
      + '<div class="kv"><span>Buying vs selling</span><span class="' + (pb >= ps ? 'up' : 'dn') + '">' + pb.toFixed(0) + '% lift · ' + ps.toFixed(0) + '% hit</span>'
      + '<span>Average price (VWAP)</span><span>$' + num(st.vwap) + '</span><span>Trades · volume</span><span>' + whole(st.count) + ' · ' + compact(st.vol) + '</span>'
      + '<span>Trades in the last minute</span><span>' + whole(st.rate60) + '</span>'
      + '<span>Off-exchange (dark pool) share</span><span>' + (st.vol > 0 ? (st.offVol / st.vol * 100).toFixed(0) : 0) + '% · ' + whole(st.offN) + ' prints</span></div>'
      + '<h4 style="margin-top:8px">VOLUME BY PRICE</h4><div class="pv">' + st.pv.slice().sort((a, b) => b.price - a.price).map((p) => '<span>' + num(p.price) + '</span><b style="width:' + Math.max(4, p.vol / maxPv * 100).toFixed(0) + '%"></b><span>' + compact(p.vol) + '</span>').join('') + '</div>'
      + (st.big.length ? '<div class="big"><h4 style="margin-top:8px">BIGGEST PRINTS</h4>' + st.big.slice(0, 3).map((b) => '<div class="' + (b.dir === 'B' ? 'up' : b.dir === 'S' ? 'dn' : 'nu') + '">' + (b.dir === 'B' ? '↑' : b.dir === 'S' ? '↓' : '◆') + ' ' + whole(b.size) + ' @ $' + num(b.price) + (b.off ? ' · off-exchange' : '') + '</div>').join('') + '</div>' : '')
      + '<small>Lift = trade at the ask, hit = trade at the bid, neutral = between. Counted from the live stream since this ticker was opened. Educational only.</small>';
  }

  function sync() { bWalls.classList.toggle('on', S.walls); bCost.classList.toggle('on', S.cost); }
  bWalls.addEventListener('click', () => { S.walls = !S.walls; save(); sync(); draw(); });
  bCost.addEventListener('click', () => { S.cost = !S.cost; save(); sync(); if (S.cost) void loadCost(); draw(); });
  window.addEventListener('sml-live-data', () => { S.live = window.smlLive || null; if (!window.smlChartGesture) { draw(); } paintStats(); });
  window.addEventListener('sml-chart-view', () => { if (S.walls || S.cost) draw(); });
  window.addEventListener('resize', draw);
  setInterval(() => { if (S.cost) void loadCost(); }, 60000);
  sync(); if (S.cost) void loadCost(); draw();
})();
