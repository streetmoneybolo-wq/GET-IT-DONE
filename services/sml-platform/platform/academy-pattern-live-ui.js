/* LIVE EXAMPLES for the pattern scanner. With the Patterns tool on, every chart pattern on the candles gets a small ▶ LIVE button
   next to its title pill, and every chart-pattern row in the scanner list gets one too. It opens a card of other stocks that are
   forming the same formation on the same interval right now (GET /academy-activity/pattern-live, which runs the Academy's
   detector over the tracked universe), ranked for teaching value: confident, still forming or just confirmed, recent, same
   direction. Each example is a small chart of the formation itself (candles, pivots, boundary lines, neckline, target) with the
   stock's name, price and status, and an OPEN button that loads that stock on this interval in one click. Refreshes while open. */
(function boot(tries) {
  if (window.__smlPatternLive) return;
  const stage = document.querySelector('.academy-chart-stage'), chartCanvas = document.getElementById('chart');
  if (!stage || !chartCanvas || !window.smlChartPro || typeof window.smlChartPro.patternPills !== 'function') { if (tries < 150) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlPatternLive = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const human = (n) => String(n || '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const money = (v) => (Number.isFinite(v) ? (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toFixed(v >= 1 ? 2 : 4)) : '—');
  const COL = { bull: '#00d084', bear: '#ff5470', neutral: '#ffd166' };
  const FAMILY = [[/head_and_shoulders/, '#c084fc'], [/double_/, '#ff9f43'], [/triple_/, '#f472b6'], [/triangle/, '#38bdf8'], [/wedge/, '#fbbf24'], [/flag|pennant/, '#34d399'], [/rectangle/, '#a3a3ff']];
  const familyColor = (type) => { for (const [re, c] of FAMILY) if (re.test(String(type || ''))) return c; return COL.neutral; };
  const S = { open: false, kind: 'chart', type: '', name: '', dir: '', tf: '', symbol: '', data: null, busy: false, err: '', at: 0, pins: new Map(), timer: 0 };

  const css = document.createElement('style');
  css.textContent = '.plive-pin{position:absolute;z-index:8;padding:2px 6px;border:1px solid #42f5b3;border-radius:5px;background:rgba(7,16,24,.94);color:#42f5b3;font:900 8.5px ui-monospace,monospace;letter-spacing:.06em;cursor:pointer;white-space:nowrap;transform:translateY(-50%);box-shadow:0 2px 8px rgba(0,0,0,.4)}.plive-pin:hover,.plive-pin.on{background:#128a66;color:#fff}'
    + '.academy-pro-panel .pit{position:relative;padding-right:52px}.academy-pro-panel .pit .plive{position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:2px 6px;border:1px solid #42f5b3;border-radius:5px;background:#0b2219;color:#42f5b3;font:900 8.5px ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.academy-pro-panel .pit .plive:hover{background:#128a66;color:#fff}'
    + '#plive-panel{position:absolute;right:8px;top:26px;z-index:10;width:min(340px,calc(100% - 24px));max-height:calc(100% - 40px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;display:none;background:rgba(7,14,20,.96);border:1px solid #1f5a4a;border-radius:10px;color:#dbe6ec;font:600 .64rem/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}#plive-panel.open{display:block}'
    + '#plive-panel .ph{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid #1b3540;position:sticky;top:0;background:rgba(7,14,20,.98)}#plive-panel .ph b{font:900 .66rem ui-monospace,monospace;letter-spacing:.06em;color:#42f5b3}#plive-panel .ph small{color:#7f98a6;font:700 .56rem ui-monospace,monospace}#plive-panel .ph button{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px;cursor:pointer;line-height:1}'
    + '#plive-panel .pb{padding:8px 10px}#plive-panel .sub{margin:0 0 8px;color:#9fb3bd;font-weight:500;font-size:.6rem}'
    + '#plive-panel .ex{margin:0 0 8px;padding:7px 8px;border:1px solid #17323d;border-radius:9px;background:#0a1118}#plive-panel .ex .top{display:flex;align-items:center;gap:6px;margin:0 0 4px}#plive-panel .ex .sym{font:900 .78rem ui-monospace,monospace;color:#fff}#plive-panel .ex .nm{color:#7f98a6;font-size:.56rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}#plive-panel .ex .px{font:800 .64rem ui-monospace,monospace;color:#eaf5f8}#plive-panel .ex .px i{font-style:normal;margin-left:4px}#plive-panel .ex .px i.up{color:#52e6ad}#plive-panel .ex .px i.down{color:#ff778b}'
    + '#plive-panel .ex canvas{display:block;width:100%;height:118px;border:1px solid #13262f;border-radius:7px;background:#07111a}'
    + '#plive-panel .ex .bot{display:flex;align-items:center;gap:6px;margin:5px 0 0}#plive-panel .ex .chip{padding:1px 6px;border-radius:9px;font:800 .54rem ui-monospace,monospace}#plive-panel .ex .chip.bull{background:#0d3a2b;color:#5df0b0}#plive-panel .ex .chip.bear{background:#3d1220;color:#ff8aa0}#plive-panel .ex .chip.neutral{background:#3a2e0d;color:#ffd166}#plive-panel .ex .st{color:#9fb3bd;font-size:.56rem;flex:1 1 auto}'
    + '#plive-panel .ex .open{padding:5px 10px;border:1px solid #42f5b3;border-radius:6px;background:#0b2219;color:#7dffc4;font:900 .6rem ui-monospace,monospace;cursor:pointer;white-space:nowrap}#plive-panel .ex .open:hover{background:#128a66;color:#fff}'
    + '#plive-panel .msg{padding:10px;color:#9fb3bd;text-align:center}#plive-panel .err{margin:6px 0;padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700}'
    + '#plive-panel .note{margin:6px 0 0;color:#5f7784;font-size:.52rem;font-weight:500}'
    + '@media(max-width:700px){#plive-panel{right:6px;left:6px;width:auto;top:auto;bottom:34px;max-height:52%}}';
  document.head.appendChild(css);

  const panel = document.createElement('aside'); panel.id = 'plive-panel'; panel.setAttribute('aria-label', 'Live pattern examples'); stage.appendChild(panel);
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));

  /* ---- the ▶ LIVE buttons: one by each pattern pill on the candles, one in each chart-pattern row of the list ---- */
  function placePins() {
    const pills = window.smlChartPro.patternPills(), M = window.smlChartModel && window.smlChartModel();
    const seen = new Set();
    if (M && pills.length) for (const p of pills) {
      seen.add(p.id);
      let el = S.pins.get(p.id);
      if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'plive-pin'; el.textContent = '▶ LIVE'; el.title = 'Other stocks forming this ' + human(p.name) + ' right now on ' + (M.tf || '') + ', one click away'; el.dataset.pid = p.id; stage.appendChild(el); S.pins.set(p.id, el); }
      el.dataset.kind = 'chart'; el.dataset.type = p.type; el.dataset.name = p.name; el.dataset.dir = p.dir;
      const x = chartCanvas.offsetLeft + p.x + p.w + 4, y = chartCanvas.offsetTop + p.y;
      el.style.left = Math.min(x, chartCanvas.offsetLeft + chartCanvas.clientWidth - 58) + 'px'; el.style.top = y + 'px'; el.style.display = '';
      el.classList.toggle('on', S.open && S.kind === 'chart' && S.type === p.type);
    }
    for (const [id, el] of S.pins) if (!seen.has(id)) { el.remove(); S.pins.delete(id); }
  }
  function decorateList() {
    const box = document.querySelector('.academy-pro-panel .plist'); if (!box) return;
    const found = window.smlChartPro.patterns(); const charts = found && found.charts ? found.charts : [];
    const candles = (found && found.candles ? found.candles : []).slice(-40), levels = found && found.levels ? found.levels : [], gaps = found && found.gaps ? found.gaps : [];
    box.querySelectorAll('.pit[data-id]').forEach((b) => {
      if (b.querySelector('.plive')) return;
      const id = String(b.dataset.id), k = Number(id.slice(1)), kind = id[0] === 'c' ? 'chart' : id[0] === 'k' ? 'candle' : id[0] === 'l' ? 'level' : id[0] === 'g' ? 'gap' : '';
      let d = null;
      if (kind === 'chart' && charts[k]) d = { kind, type: charts[k].type, name: charts[k].name, dir: charts[k].dir };
      else if (kind === 'candle' && candles[k]) d = { kind, type: candles[k].name, name: candles[k].label || candles[k].name, dir: candles[k].dir };
      else if (kind === 'level' && levels[k]) d = { kind, type: levels[k].kind, name: levels[k].kind === 'support' ? 'Support level' : 'Resistance level', dir: levels[k].kind === 'support' ? 'bull' : 'bear' };
      else if (kind === 'gap' && gaps[k]) d = { kind, type: gaps[k].dir === 'bull' ? 'gap_up' : 'gap_down', name: gaps[k].dir === 'bull' ? 'Gap up' : 'Gap down', dir: gaps[k].dir };
      if (!d) return;
      const s = document.createElement('span'); s.className = 'plive'; s.setAttribute('role', 'button'); s.textContent = '▶ LIVE'; s.title = 'Other stocks with this forming right now on this interval'; s.dataset.kind = d.kind; s.dataset.type = d.type; s.dataset.name = d.name; s.dataset.dir = d.dir; b.appendChild(s);
    });
  }
  stage.addEventListener('click', (e) => {
    const pin = e.target.closest && e.target.closest('.plive-pin'); if (pin) { e.preventDefault(); e.stopPropagation(); openFor(pin.dataset); return; }
    const row = e.target.closest && e.target.closest('.academy-pro-panel .pit .plive'); if (row) { e.preventDefault(); e.stopPropagation(); openFor(row.dataset); }
  }, true);
  const mo = new MutationObserver(() => decorateList());
  const watchList = () => { const pp = document.querySelector('.academy-pro-panel'); if (pp && !pp.dataset.pliveWatched) { pp.dataset.pliveWatched = '1'; mo.observe(pp, { childList: true, subtree: true }); decorateList(); } };
  window.addEventListener('sml-chart-view', () => { try { placePins(); watchList(); } catch (_) { /* chart not ready */ } });

  /* ---- the examples ---- */
  const tfNow = () => { try { const M = window.smlChartModel && window.smlChartModel(); return (M && M.tf) || '5m'; } catch (_) { return '5m'; } };
  const symNow = () => { try { const M = window.smlChartModel && window.smlChartModel(); return (M && M.symbol) || ''; } catch (_) { return ''; } };
  function openFor(d) {
    const type = String(d.type || ''), kind = String(d.kind || 'chart'); if (!type) return;
    if (S.open && S.type === type && S.kind === kind && S.tf === tfNow()) { close(); return; }
    S.open = true; S.kind = kind; S.type = type; S.name = String(d.name || type); S.dir = String(d.dir || ''); S.tf = tfNow(); S.symbol = symNow(); S.data = null; S.err = ''; S.at = 0;
    paint(); placePins(); void fetchExamples();
    clearInterval(S.timer); S.timer = setInterval(() => { if (S.open && !document.hidden) void fetchExamples(); }, 30_000);
  }
  function close() { S.open = false; clearInterval(S.timer); paint(); placePins(); }
  async function fetchExamples() {
    if (S.busy || !S.open) return; S.busy = true;
    const key = S.kind + '|' + S.type + '|' + S.tf;
    try {
      const t = token(); if (!t) { S.err = 'Unlock the Academy tools to see live examples.'; S.data = null; return; }
      const res = await fetch('/academy-activity/pattern-live?kind=' + encodeURIComponent(S.kind) + '&type=' + encodeURIComponent(S.type) + '&tf=' + encodeURIComponent(S.tf) + '&exclude=' + encodeURIComponent(S.symbol) + '&dir=' + encodeURIComponent(S.dir), { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (key !== S.kind + '|' + S.type + '|' + S.tf) return;
      if (!res.ok || !j || !j.ok) { S.err = res.status === 429 ? 'Scanning too often. One moment.' : 'Could not scan for examples right now.'; return; }
      S.data = j; S.err = ''; S.at = Date.now();
      if (j.partial && S.open) setTimeout(() => { if (S.open && S.kind + '|' + S.type + '|' + S.tf === key) void fetchExamples(); }, 4_000);
    } catch (_) { S.err = 'No connection.'; }
    finally { S.busy = false; paint(); }
  }
  function paint() {
    panel.classList.toggle('open', S.open); if (!S.open) return;
    const d = S.data;
    let h = '<div class="ph"><b>▶ FORMING NOW · ' + esc(human(S.name)) + '</b><small>' + esc(S.tf) + (S.busy ? ' · scanning…' : d ? ' · ' + d.scanned + ' of ' + d.universe + ' scanned' + (d.partial ? ' so far' : '') : '') + '</small><button type="button" data-close="1" aria-label="Close">×</button></div><div class="pb">';
    if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
    if (!d && !S.err) h += '<div class="msg">Scanning the Academy universe for a ' + esc(human(S.name)) + ' on ' + esc(S.tf) + '…</div>';
    if (d) {
      const ex = d.examples || [];
      h += '<div class="sub">' + (ex.length ? 'Stocks where this is forming on the last candles of the ' + esc(S.tf) + ' chart right now (not old or finished ones), best teaching examples first. Tap OPEN to load one here.' : 'No other tracked stock has a ' + esc(human(S.name)) + ' forming on ' + esc(S.tf) + ' right now. Try another interval, or come back in a few minutes: the scan refreshes.') + '</div>';
      h += ex.map((e, i) => { const p = e.pattern, col = COL[p.dir] || COL.neutral; return '<div class="ex" data-i="' + i + '"><div class="top"><span class="sym">$' + esc(e.symbol) + '</span><span class="nm">' + esc(e.name || '') + '</span><span class="px">' + esc(money(e.price)) + (e.changePct != null ? '<i class="' + (e.changePct >= 0 ? 'up' : 'down') + '">' + (e.changePct >= 0 ? '+' : '') + e.changePct.toFixed(2) + '%</i>' : '') + '</span></div><canvas width="10" height="10" aria-label="' + esc(human(p.name)) + ' forming on ' + esc(e.symbol) + '"></canvas><div class="bot"><span class="chip ' + esc(p.dir) + '">' + (p.dir === 'bull' ? 'BULLISH' : p.dir === 'bear' ? 'BEARISH' : 'NEUTRAL') + '</span><span class="st">' + esc(human(p.name)) + (e.exact ? '' : ' (same family)') + ' · ' + esc(p.status) + (p.kind === 'level' || p.kind === 'gap' ? '' : ' · ' + Math.round(p.confidence * 100) + '%') + (p.note ? ' · ' + esc(p.note) : '') + '</span><button type="button" class="open" data-open="' + esc(e.symbol) + '" style="border-color:' + col + '">OPEN ▸</button></div></div>'; }).join('');
      h += '<div class="note">Detected by the same scanner that reads your chart, on the same interval. Patterns are context, not signals.</div>';
    }
    h += '</div>';
    panel.innerHTML = h;
    if (d) (d.examples || []).forEach((e, i) => { const cv = panel.querySelector('.ex[data-i="' + i + '"] canvas'); if (cv) drawExample(cv, e); });
  }
  function drawExample(cv, e) {
    const w = cv.clientWidth || 300, h = cv.clientHeight || 118, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const bars = e.bars || []; if (!bars.length) return;
    const p = e.pattern, off = e.offset || 0, c = familyColor(p.type), dc = COL[p.dir] || COL.neutral;
    const padL = 4, padR = 40, padT = 8, padB = 6, pw = w - padL - padR, ph = h - padT - padB;
    let lo = Infinity, hi = -Infinity; for (const b of bars) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); }
    for (const q of (p.points || [])) { lo = Math.min(lo, q.p); hi = Math.max(hi, q.p); }
    if (Number.isFinite(p.target)) { lo = Math.min(lo, p.target); hi = Math.max(hi, p.target); }
    if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
    const sp = hi - lo; lo -= sp * 0.06; hi += sp * 0.06;
    const n = bars.length, slots = n + 6, step = pw / slots, bw = Math.max(1, Math.min(7, step * 0.66));
    const x = (i) => padL + (i - off) * step + step / 2, y = (v) => padT + (hi - v) / (hi - lo) * ph;
    ctx.strokeStyle = 'rgba(66,120,150,.18)'; ctx.lineWidth = 1; for (let k = 0; k <= 3; k++) { const yy = padT + ph * k / 3; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + pw, yy); ctx.stroke(); ctx.fillStyle = '#7f97a4'; ctx.font = '700 8px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(money(hi - (hi - lo) * k / 3), padL + pw + 3, yy); }
    bars.forEach((b, i) => { const up = b[4] >= b[1], col = up ? '#00d084' : '#ff5470', xx = x(off + i); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(xx, y(b[2])); ctx.lineTo(xx, y(b[3])); ctx.stroke(); ctx.fillStyle = col; ctx.fillRect(xx - bw / 2, Math.min(y(b[1]), y(b[4])), bw, Math.max(1, Math.abs(y(b[4]) - y(b[1])))); });
    /* candle patterns: a box around the bar(s) that form it; levels: the line and its touches; gaps: the open band */
    if (p.kind === 'candle') { const i0 = Number(p.bars[0]), i1 = Number(p.bars[1]); const xa = x(i0) - step / 2, xb = x(i1) + step / 2; let bl = Infinity, bh = -Infinity; for (let i = i0; i <= i1; i++) { const b = bars[i - off]; if (b) { bl = Math.min(bl, b[3]); bh = Math.max(bh, b[2]); } } if (Number.isFinite(bl)) { ctx.save(); ctx.strokeStyle = dc; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.strokeRect(xa - 2, y(bh) - 4, xb - xa + 4, y(bl) - y(bh) + 8); ctx.restore(); } }
    if (p.kind === 'level' && Number.isFinite(p.level)) { const ly = y(p.level); ctx.save(); ctx.strokeStyle = dc; ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + pw, ly); ctx.stroke(); ctx.restore(); ctx.fillStyle = dc; ctx.font = '800 8px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText((p.type === 'support' ? 'S ' : 'R ') + money(p.level) + ' ×' + (p.touches || ''), padL + pw - 2, ly - 2); }
    if (p.kind === 'gap' && Number.isFinite(p.from) && Number.isFinite(p.to)) { const ya = y(Math.max(p.from, p.to)), yb = y(Math.min(p.from, p.to)); ctx.fillStyle = dc + '33'; ctx.fillRect(x(Number(p.i)) - step / 2, ya, padL + pw - (x(Number(p.i)) - step / 2), Math.max(2, yb - ya)); ctx.strokeStyle = dc; ctx.lineWidth = 1; ctx.strokeRect(x(Number(p.i)) - step / 2, ya, padL + pw - (x(Number(p.i)) - step / 2), Math.max(2, yb - ya)); }
    /* the formation: tinted body between the boundary lines, the lines over a dark halo, the pivots, the neckline, the target */
    const lines = p.lines || [], pts = p.points || [], upper = lines.find((l) => l.role === 'upper'), lower = lines.find((l) => l.role === 'lower');
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (upper && lower) { ctx.fillStyle = c + '22'; ctx.beginPath(); ctx.moveTo(x(upper.i1), y(upper.p1)); ctx.lineTo(x(upper.i2), y(upper.p2)); ctx.lineTo(x(lower.i2), y(lower.p2)); ctx.lineTo(x(lower.i1), y(lower.p1)); ctx.closePath(); ctx.fill(); }
    const stroke = (dash, width) => { ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = width + 2; ctx.stroke(); ctx.setLineDash(dash); ctx.strokeStyle = c; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]); };
    lines.forEach((l) => { ctx.beginPath(); ctx.moveTo(x(l.i1), y(l.p1)); ctx.lineTo(x(l.i2), y(l.p2)); stroke(l.role === 'target' || l.role === 'projection' ? [3, 4] : l.role === 'neckline' ? [6, 4] : [], l.role === 'neckline' ? 1.8 : 1.7); });
    if (pts.length > 1 && !(upper && lower)) { ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(x(q.i), y(q.p)) : ctx.moveTo(x(q.i), y(q.p)))); ctx.globalAlpha = 0.6; stroke([], 1.3); ctx.globalAlpha = 1; }
    pts.forEach((q) => { ctx.beginPath(); ctx.arc(x(q.i), y(q.p), 3.2, 0, 6.3); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 1.5; ctx.stroke(); });
    if (Number.isFinite(p.target)) { const ty = y(p.target); ctx.setLineDash([3, 4]); ctx.strokeStyle = dc; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + pw, ty); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = dc; ctx.font = '800 8px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('TARGET ' + money(p.target), padL + pw - 2, ty - 2); }
    if (Number.isFinite(p.breakIdx) && p.breakIdx >= 0 && p.breakIdx >= off) { const bx = x(p.breakIdx), by = y(Number.isFinite(p.neckline) ? p.neckline : (Number.isFinite(p.level) ? p.level : bars[Math.min(bars.length - 1, p.breakIdx - off)][4])); ctx.fillStyle = dc; ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx + 5, by); ctx.lineTo(bx, by + 6); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = c; ctx.font = '900 9px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText((p.dir === 'bull' ? '▲ ' : p.dir === 'bear' ? '▼ ' : '◆ ') + human(p.name).toUpperCase() + ' · ' + String(p.status).toUpperCase(), padL + 4, padT + 2);
  }
  panel.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-close],[data-open]'); if (!t) return;
    if (t.dataset.close) { close(); return; }
    if (t.dataset.open) { const sym = t.dataset.open, tf = S.tf; if (typeof window.smlAcademyNavigateMarket === 'function') { void window.smlAcademyNavigateMarket(sym, tf); const pb = document.getElementById('academy-pro-patterns'); if (pb && !pb.classList.contains('on')) pb.click(); } }
  });
  window.addEventListener('sml-academy-market', () => { if (!S.open) return; const sym = symNow(), tf = tfNow(); if (tf !== S.tf) { S.tf = tf; S.symbol = sym; S.data = null; paint(); void fetchExamples(); } else if (sym !== S.symbol) { S.symbol = sym; void fetchExamples(); } });
  window.smlPatternLive = { open: (type, name, dir, kind) => openFor({ type, name, dir, kind: kind || 'chart' }), close, state: () => ({ open: S.open, type: S.type, tf: S.tf, examples: S.data ? S.data.examples.length : null }) };
})(0);
