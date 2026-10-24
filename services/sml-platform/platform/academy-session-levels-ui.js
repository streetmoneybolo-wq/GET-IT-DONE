/* Session levels layer for the Academy Live Chart Lab. Draws what window.SmlSessionLevels computes from the chart's own bars (VWAP bands,
   the Initial Balance, the Asia / London / New York ranges, volume nodes, the last swing's Fibonacci levels) plus the dealer gamma walls the
   server already serves (/academy-activity/gamma), and tints every candle by its gamma regime. The LEVELS button on the toolbar turns it
   on; each line is a checkbox in its card. Educational: it shows where price is against the day's reference levels, not where it will go. */
(function boot(tries) {
  if (window.__smlSessionLevelsUi) return;
  const SL = window.SmlSessionLevels; if (!SL) return;
  if (!document.querySelector('.academy-chart-stage') || !document.querySelector('.toolbar')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlSessionLevelsUi = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar'), chartCanvas = $('chart'), stage = document.querySelector('.academy-chart-stage');
  if (!toolbar || !chartCanvas || !stage) return;

  const KEY = 'sml-levels-v1';
  const OPTS = [['vwap', 'VWAP + 1st / 2nd bands'], ['rth', 'Anchor VWAP at 09:30'], ['ib', 'Initial Balance'], ['sessions', 'Asia / London / New York'], ['profile', 'Volume nodes'], ['fib', 'Fib of last swing'], ['gamma', 'Call / put wall + flip'], ['regime', 'Colour candles by gamma']];
  const S = { on: false, min: true, o: { vwap: true, rth: false, ib: true, sessions: true, profile: false, fib: false, gamma: true, regime: true }, a: null, key: '', at: 0, g: null, gSym: '', gAt: 0, gErr: '', busy: false };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.on = v.on === true; Object.assign(S.o, v.o || {}); } } catch (_) { /* storage can be blocked inside Discord */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, o: S.o })); } catch (_) { /* ignore */ } };

  const css = document.createElement('style');
  css.textContent = '#levels-layer{position:absolute;pointer-events:none;z-index:4;background:transparent;border:0;border-radius:0;min-height:0;max-width:none}'
    + '#levels-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2f6f8a;border-radius:7px;background:#0d1f2a;color:#9fe3ff;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#levels-toggle.on{background:#1d7fa8;border-color:#6fd3ff;color:#fff}'
    + '#levels-card{position:absolute;right:74px;top:26px;z-index:9;width:min(270px,calc(100% - 96px));max-height:calc(100% - 60px);overflow:auto;background:#0a101a;border:1px solid #27465a;border-radius:10px;color:#dbe6ec;font:600 .64rem/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5);display:none;flex-direction:column}'
    + '#levels-card header{display:flex;align-items:center;gap:6px;padding:7px 9px;border-bottom:1px solid #1f3442;cursor:pointer}#levels-card header b{font:800 .66rem ui-monospace,monospace;color:#9fe3ff;letter-spacing:.06em}#levels-card header span{margin-left:auto;color:#8fa6b3;padding:0 2px}#levels-card header span:hover{color:#dff6ff}'
    + '#levels-card .opts{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;padding:7px 9px;border-bottom:1px solid #1f3442}#levels-card label{display:flex;gap:5px;align-items:center;color:#b9c8d1;font-weight:600;cursor:pointer}#levels-card input{accent-color:#4dc3ff}'
    + '#levels-card ul{list-style:none;margin:0;padding:7px 9px 8px}#levels-card li{margin:0 0 6px;padding-left:9px;border-left:3px solid #4a5a66;color:#c9d6de}#levels-card li.up{border-color:#00d084}#levels-card li.down{border-color:#ff5470}#levels-card li.warn{border-color:#ffd166}'
    + '#levels-card small{display:block;padding:0 9px 8px;color:#6f8794;font-weight:500;font-size:.54rem}@media(max-width:700px){#levels-card{right:8px;top:auto;bottom:34px;max-height:44%}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'levels-toggle'; btn.textContent = 'LEVELS'; btn.title = 'Session levels: VWAP bands, Initial Balance, Asia / London / New York ranges, volume nodes, fib, gamma walls'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'levels-layer'; const ctx = layer.getContext('2d');
  const card = document.createElement('aside'); card.id = 'levels-card'; stage.appendChild(card);
  ['pointerdown', 'wheel'].forEach((ev) => card.addEventListener(ev, (e) => e.stopPropagation()));

  const token = () => window.smlAcademySessionToken || '';
  const symbolNow = () => { const M = window.smlChartModel && window.smlChartModel(); return M ? M.symbol : ''; };
  function gammaInput() { const g = S.g; if (!g || !g.available) return null; return { callWall: g.callWall && g.callWall.strike, putWall: g.putWall && g.putWall.strike, flip: g.flipStrike, regime: g.regime }; }
  function analysis(M) {
    const last = M.bars[M.N - 1], key = M.symbol + ':' + M.tf + ':' + M.N + ':' + (last && last.t) + ':' + (S.o.rth ? 'rth' : 'day') + ':' + S.gAt;
    const stale = performance.now() - S.at > 900;
    if (!S.a || key !== S.key || (stale && last)) { S.a = SL.analyze(M.bars, { anchor: S.o.rth ? 'rth' : 'day', gamma: gammaInput() }); S.aSym = M.symbol; S.key = key; S.at = performance.now(); paintCard(); }
    return S.a;
  }

  /* the walls come from the options chain on the server; the free tier is told so instead of shown nothing */
  async function fetchGamma(force) {
    const sym = symbolNow(); if (!sym || S.busy) return;
    if (!force && S.gSym === sym && Date.now() - S.gAt < 5 * 60 * 1000) return;
    S.busy = true;
    try {
      let t = token(); if (!t) { S.gErr = 'Sign in to the Academy for the gamma walls.'; S.g = null; return; }
      const read = (tok) => fetch('/academy-activity/gamma?symbol=' + encodeURIComponent(sym), { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
      let res = await read(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) { t = fresh; res = await read(t); } }
      const j = await res.json().catch(() => null);
      if (sym !== symbolNow()) return;
      if (!res.ok || !j || !j.ok) { S.g = null; S.gErr = j && j.error === 'academy_access_required' ? 'Gamma walls are an Academy member tool.' : 'Gamma walls are not available right now.'; return; }
      S.g = j; S.gErr = j.available ? '' : 'No options chain for ' + sym + ', so no gamma walls.';
    } catch (_) { S.gErr = 'No connection for the gamma walls.'; }
    finally { S.busy = false; S.gSym = sym; S.gAt = Date.now(); S.key = ''; paintCard(); draw(); }
  }

  function paintCard() {
    if (!S.on) { card.style.display = 'none'; return; }
    card.style.display = 'flex';
    const lines = S.a ? SL.read(S.a) : [];
    card.innerHTML = '<header><b>SESSION LEVELS</b><span data-min="1" title="' + (S.min ? 'Open the card' : 'Minimise to a chip') + '">' + (S.min ? 'open' : '&#8211;') + '</span></header>'
      + (S.min ? '' : '<div class="opts">' + OPTS.map(([k, l]) => '<label><input type="checkbox" data-o="' + k + '"' + (S.o[k] ? ' checked' : '') + '>' + esc(l) + '</label>').join('') + '</div>'
        + '<ul>' + (lines.length ? lines.map((l) => '<li class="' + esc(l.tone) + '">' + esc(l.text) + '</li>').join('') : '<li>Not enough candles yet to place the levels.</li>') + (S.gErr && (S.o.gamma || S.o.regime) ? '<li class="warn">' + esc(S.gErr) + '</li>' : '') + '</ul>'
        + '<small>Educational: where price is against the day\'s reference levels. It does not predict where it will go. Dealer gamma is inferred from open interest, not observed.</small>');
  }
  card.addEventListener('click', (e) => { if (e.target.closest('[data-min]') || (S.min && e.target.closest('header'))) { S.min = !S.min; paintCard(); } });
  card.addEventListener('change', (e) => { const k = e.target && e.target.dataset && e.target.dataset.o; if (k) { S.o[k] = e.target.checked; save(); S.key = ''; if ((k === 'gamma' || k === 'regime') && S.o[k]) fetchGamma(false); draw(); } });
  btn.addEventListener('click', () => { S.on = !S.on; save(); btn.classList.toggle('on', S.on); S.key = ''; if (S.on && (S.o.gamma || S.o.regime)) fetchGamma(false); paintCard(); draw(); });
  btn.classList.toggle('on', S.on);
  window.addEventListener('sml-academy-market', () => { S.key = ''; if (S.on && (S.o.gamma || S.o.regime)) fetchGamma(symbolNow() !== S.gSym); });
  setInterval(() => { if (S.on && !document.hidden && (S.o.gamma || S.o.regime)) fetchGamma(false); }, 30_000);
  /* the chart's smart range keeps the Initial Balance and the walls on screen while this tool is on */
  (function reg(n) {
    if (window.smlChartLevels) {
      window.smlChartLevels.register('levels', (sym) => {
        if (!S.on || !S.a || sym !== S.aSym) return []; // never asks the chart for its model here: the model asks this for its levels, and the two would call each other forever
        const out = [];
        if (S.o.ib && S.a.ib.current) out.push(S.a.ib.current.hi, S.a.ib.current.lo);
        if (S.o.gamma && S.a.gamma) for (const l of S.a.gamma.levels) out.push(l.price);
        return out;
      });
      return;
    }
    if (n < 60) setTimeout(() => reg(n + 1), 500);
  })(0);

  const text = (t, x, y, color, align, size) => {
    size = Math.max(10, (size || 10) + 1); ctx.font = '800 ' + size + 'px ui-monospace,monospace'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(t).width, left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = 'rgba(6,11,18,.82)'; ctx.fillRect(left - 3, y - size / 2 - 2, w + 6, size + 4);
    ctx.fillStyle = color; ctx.fillText(t, x, y);
  };
  const hline = (x1, x2, yy, style, width, dash) => { ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x2, yy); ctx.stroke(); ctx.restore(); };
  const REGIME = { positive: '77,195,255', negative: '255,84,112', neutral: '200,121,255' };
  const SESSION_COL = { asia: '255,170,60', london: '120,150,255', newYork: '0,208,132', afterHours: '150,165,190' };

  function draw() {
    if (chartCanvas.parentElement && layer.parentElement !== chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.N < 5) return;
    const a = analysis(M); if (!a) return;
    const pad = M.pad, right = pad.l + M.pw, y = (p) => M.y(p), x = (i) => M.x(i), half = M.step / 2, lo = M.lo, hi = M.hi;
    const inY = (p) => p >= lo && p <= hi, s0 = Math.max(0, Math.floor(M.start)), s1 = Math.min(a.n - 1, Math.ceil(M.end));
    const clampY = (p) => Math.min(pad.t + (M.priceH || M.ph), Math.max(pad.t, y(p)));
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, M.pw, M.priceH || M.ph); ctx.clip(); // the price pane only, never the volume bars

    /* session ranges: a shaded box over each session's bars, its high and low carried to the right edge while the day lasts */
    if (S.o.sessions) {
      const day = a.sessions.length ? a.sessions[a.sessions.length - 1].day : null;
      for (const s of a.sessions) {
        if (s.endIdx < s0 - 1 || s.startIdx > s1 + 1 || s.key === 'afterHours') continue;
        const col = SESSION_COL[s.key] || '150,165,190', x1 = Math.max(pad.l, x(s.startIdx) - half), x2 = Math.min(right, x(s.endIdx) + half), y1 = clampY(s.hi), y2 = clampY(s.lo);
        ctx.fillStyle = 'rgba(' + col + ',.10)'; ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1.5, y2 - y1));
        ctx.save(); ctx.strokeStyle = 'rgba(' + col + ',.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(x1 + .5, y1 + .5, Math.max(1, x2 - x1) - 1, Math.max(1.5, y2 - y1) - 1); ctx.restore();
        if (s.day === day && s.key !== 'newYork') { if (inY(s.hi)) hline(x2, right, y(s.hi), 'rgba(' + col + ',.5)', 1, [2, 4]); if (inY(s.lo)) hline(x2, right, y(s.lo), 'rgba(' + col + ',.5)', 1, [2, 4]); }
        if (x2 - x1 > 34) text(s.name.toUpperCase() + ' ' + (s.range >= 1000 ? s.range.toFixed(0) : s.range.toFixed(2)), x1 + 4, y1 + 9, 'rgb(' + col + ')', 'left', 9);
        for (const sw of s.sweeps || []) if (sw.i >= s0 && sw.i <= s1 && inY(sw.price)) text((sw.side === 'high' ? '▲ ' : '▼ ') + (sw.session === 'asia' ? 'ASIA' : 'LONDON') + ' ' + sw.side.toUpperCase() + ' SWEPT', x(sw.i), y(sw.price) + (sw.side === 'high' ? -10 : 11), 'rgb(' + (SESSION_COL[sw.session] || col) + ')', 'center', 9);
      }
    }
    /* Initial Balance: the first hour's box, then its high and low across the rest of the day with the extensions dashed */
    if (S.o.ib) for (const d of a.ib.days.slice(-3)) {
      const i0 = M.idxOfTime ? M.idxOfTime(d.startT) : null, i1 = M.idxOfTime ? M.idxOfTime(d.endT) : null;
      if (i0 == null || i1 == null || i1 < s0 - 1 || i0 > s1 + 1) continue;
      const dayEnd = d === a.ib.current ? right : Math.min(right, x(Math.min(a.n - 1, d.lastIdx)) + half);
      const x1 = Math.max(pad.l, x(i0) - half), x2 = Math.min(right, x(i1) + half), yh = clampY(d.hi), yl = clampY(d.lo);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(x1, yh, Math.max(1, x2 - x1), Math.max(1.5, yl - yh));
      if (inY(d.hi)) hline(x1, dayEnd, y(d.hi), 'rgba(235,243,255,.85)', 1.4, [7, 4]);
      if (inY(d.lo)) hline(x1, dayEnd, y(d.lo), 'rgba(235,243,255,.85)', 1.4, [7, 4]);
      if (d.ext && d.complete) [['IB +1', d.ext.up1], ['IB +2', d.ext.up2], ['IB -1', d.ext.dn1], ['IB -2', d.ext.dn2]].forEach(([n, p]) => { if (!inY(p)) return; hline(x2, dayEnd, y(p), 'rgba(235,243,255,.35)', 1, [2, 5]); text(n, dayEnd - 4, y(p) - 7, 'rgba(235,243,255,.6)', 'right', 8); });
      if (inY(d.hi)) text('IB HIGH ' + (d.hi >= 1000 ? d.hi.toFixed(0) : d.hi.toFixed(2)), x1 + 4, y(d.hi) - 8, '#eef4ff', 'left', 9);
      if (inY(d.lo)) text('IB LOW ' + (d.lo >= 1000 ? d.lo.toFixed(0) : d.lo.toFixed(2)), x1 + 4, y(d.lo) + 9, '#eef4ff', 'left', 9);
      if (d.breakUp != null && d.breakUp >= s0 && d.breakUp <= s1) text('IB BREAK ▲', x(d.breakUp), y(M.bars[d.breakUp].h) - 10, '#5df0b0', 'center', 9);
      if (d.breakDown != null && d.breakDown >= s0 && d.breakDown <= s1) text('IB BREAK ▼', x(d.breakDown), y(M.bars[d.breakDown].l) + 11, '#ff8ea1', 'center', 9);
    }
    /* VWAP and its bands, the pen lifted at each session restart */
    if (S.o.vwap) {
      const vw = a.vwap;
      const line = (get, style, width, dash) => {
        ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.beginPath(); let pen = false;
        for (let i = s0; i <= s1; i++) { const v = vw[i]; if (!v || (i > 0 && !vw[i - 1])) pen = false; if (!v) continue; const py = y(get(v)); if (!pen) { ctx.moveTo(x(i), py); pen = true; } else ctx.lineTo(x(i), py); }
        ctx.stroke(); ctx.restore();
      };
      line((v) => v.up[1], 'rgba(200,121,255,.7)', 1.3, [3, 4]); line((v) => v.dn[1], 'rgba(200,121,255,.7)', 1.3, [3, 4]);
      line((v) => v.up[0], 'rgba(255,99,99,.8)', 1.4, null); line((v) => v.dn[0], 'rgba(255,99,99,.8)', 1.4, null); line((v) => v.vwap, '#ffd166', 2.4, null);
      const lv = vw[a.n - 1];
      if (lv) { if (inY(lv.vwap)) text('VWAP ' + (lv.vwap >= 1000 ? lv.vwap.toFixed(0) : lv.vwap.toFixed(2)), right - 6, y(lv.vwap) - 8, '#ffd166', 'right', 9); [['+1σ', lv.up[0]], ['+2σ', lv.up[1]], ['-1σ', lv.dn[0]], ['-2σ', lv.dn[1]]].forEach(([n, p]) => { if (inY(p)) text(n, right - 6, y(p) - 7, n[1] === '1' ? 'rgba(255,120,120,.9)' : 'rgba(210,150,255,.9)', 'right', 8); }); }
    }
    /* volume nodes on the right edge: the profile in grey, the value area tinted, HVN and LVN marked */
    if (S.o.profile && a.profile) {
      const p = a.profile, maxW = M.pw * 0.14;
      for (const b of p.bins) { if (b.price < lo || b.price > hi) continue; const inVa = b.price >= p.val && b.price <= p.vah; ctx.fillStyle = inVa ? 'rgba(255,140,60,.26)' : 'rgba(150,165,190,.14)'; const bw = b.vol / p.max * maxW, bh = Math.max(1.5, Math.abs(y(b.lo) - y(b.hi)) - 0.6); ctx.fillRect(right - bw, y(b.price) - bh / 2, bw, bh); }
      if (inY(p.poc)) { hline(right - maxW - 6, right, y(p.poc), '#ffb454', 1.6, null); text('POC', right - maxW - 10, y(p.poc), '#ffb454', 'right', 8); }
      for (const n of p.nodes) { if (!inY(n.price)) continue; const col = n.kind === 'hvn' ? '#ff9f43' : '#8ef6c6'; hline(right - maxW - 6, right, y(n.price), col, 1, n.kind === 'hvn' ? null : [2, 3]); text(n.kind.toUpperCase(), right - maxW - 10, y(n.price), col, 'right', 8); }
    }
    /* Fibonacci of the last swing, drawn from the swing's start to the right edge */
    if (S.o.fib && a.fib) {
      const f = a.fib, x1 = Math.max(pad.l, x(Math.min(f.start.i, f.end.i)));
      ctx.save(); ctx.strokeStyle = 'rgba(190,215,228,.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x(f.start.i), y(f.start.price)); ctx.lineTo(x(f.end.i), y(f.end.price)); ctx.stroke(); ctx.restore();
      for (const l of f.levels) {
        if (!inY(l.price)) continue; const key = l.ratio === 0.5 || l.ratio === 0.618 ? '#ffd166' : l.ratio > 1 ? 'rgba(200,121,255,.8)' : 'rgba(190,215,228,.6)';
        hline(x1, right, y(l.price), key, l.ratio === 0.618 ? 1.4 : 1, l.ratio > 1 ? [2, 4] : null);
        text((l.ratio * 100).toFixed(1) + '% ' + (l.price >= 1000 ? l.price.toFixed(0) : l.price.toFixed(2)), x1 + 4, y(l.price) - 7, key, 'left', 8);
      }
    }
    /* dealer gamma: the walls and the flip as lines with a pill at the right edge */
    if (S.o.gamma && a.gamma) for (const l of a.gamma.levels) {
      if (!inY(l.price)) continue; const col = l.key === 'callWall' ? '#4dc3ff' : l.key === 'putWall' ? '#ff5470' : '#c879ff';
      hline(pad.l, right, y(l.price), col, 1.6, [8, 5]);
      text(l.label + ' ' + (l.price >= 1000 ? l.price.toFixed(0) : l.price.toFixed(2)), right - 6, y(l.price) + (l.key === 'putWall' ? 9 : -8), col, 'right', 9);
    }
    /* the gamma regime on every candle: the body tinted blue above the flip, red below, purple at the flip, with a strip along the top */
    if (S.o.regime && a.gamma) {
      const bw = Math.max(1.5, M.step * 0.62), top = pad.t;
      for (let i = s0; i <= s1; i++) {
        const b = M.bars[i], r = a.gamma.regime[i]; if (!b || !r) continue; const col = REGIME[r] || REGIME.neutral;
        const yo = y(+b.o), yc = y(+b.c), bodyTop = Math.min(yo, yc), bodyH = Math.max(1.5, Math.abs(yc - yo));
        ctx.fillStyle = 'rgba(' + col + ',.55)'; ctx.fillRect(x(i) - bw / 2, bodyTop, bw, bodyH);
        ctx.fillStyle = 'rgba(' + col + ',.9)'; ctx.fillRect(x(i) - half, top, M.step, 3);
      }
      const last = a.gamma.regime[a.n - 1];
      if (last) text('GAMMA ' + last.toUpperCase(), pad.l + 6, top + 12, 'rgb(' + (REGIME[last] || REGIME.neutral) + ')', 'left', 9);
    }
    ctx.restore();
  }

  window.addEventListener('sml-chart-view', () => { if (S.on) draw(); });
  window.addEventListener('resize', () => { if (S.on) draw(); });
  if (S.on && (S.o.gamma || S.o.regime)) fetchGamma(false);
  paintCard(); draw();
})(0);
