/* Smart-money INTENT: where the big money is placed and what it is doing, drawn on the chart and explained in a panel.
   The INTENT button in the chart toolbar asks /academy-activity/intent for the read (academy-smart-intent.js on the server fuses
   the Massive tape, the moomoo book, the dark-pool prints, the gamma walls, the SMC map and the volume profile). The layer draws
   the liquidity map: every level the feeds agree on, as a line with a pill naming its sources and role (support / resistance /
   target / trap), thicker the more sources agree. The panel shows the phase (accumulation, markup, distribution, markdown, trap),
   the evidence, the formulas with their live values (VPIN, Kyle's lambda, persistence, footprint, iceberg, spoof, DIX) and what
   would flip the read. Refreshes every 20 s while open. Canvas layer, so snapshots carry it. */
(function boot(tries) {
  if (window.__smlSmartIntent) return;
  const stage = document.querySelector('.academy-chart-stage'), toolbar = document.querySelector('.toolbar'), chartCanvas = document.getElementById('chart');
  if (!stage || !toolbar || !chartCanvas) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlSmartIntent = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const symbolNow = () => { try { return String((window.smlAcademyChartState && window.smlAcademyChartState().symbol) || (document.getElementById('symbol') || {}).value || 'SPY').toUpperCase(); } catch (_) { return 'SPY'; } };
  const tfNow = () => { try { const M = window.smlChartModel && window.smlChartModel(); return (M && M.tf) || (window.smlAcademyChartState && window.smlAcademyChartState().tf) || '5m'; } catch (_) { return '5m'; } };
  const S = { on: false, data: null, busy: false, err: '', at: 0, key: '' };
  const ROLE = { support: '#35e6a0', resistance: '#ff6b86', target: '#6fb8ff', trap: '#ffb454' };
  const PHASE = { accumulation: '#35e6a0', markup: '#2fd4c5', distribution: '#ff6b86', markdown: '#ff8f6b', trap: '#ffb454', undecided: '#8fa5b1' };

  const css = document.createElement('style');
  css.textContent = '#intent-btn{margin-left:4px;padding:5px 9px;border:1px solid #2e7d6a;border-radius:7px;background:#0b1f1b;color:#8ff1c5;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#intent-btn.on{background:#128a66;color:#fff;border-color:#35e6a0}'
    + '#intent-layer{position:absolute;pointer-events:none;z-index:6;background:none!important;border:0!important;border-radius:0;box-shadow:none}'
    + '#intent-panel{position:absolute;right:8px;top:26px;z-index:9;width:min(330px,calc(100% - 24px));max-height:calc(100% - 40px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;display:none;background:rgba(7,14,20,.95);border:1px solid #1f5a4a;border-radius:10px;color:#dbe6ec;font:500 .66rem/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}#intent-panel.open{display:block}'
    + '#intent-panel .ih{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid #1b3540;position:sticky;top:0;background:rgba(7,14,20,.98)}#intent-panel .ih b{font:900 .7rem ui-monospace,monospace;letter-spacing:.08em;color:#8ff1c5}#intent-panel .ih small{color:#7f98a6;font:700 .56rem ui-monospace,monospace}#intent-panel .ih button{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px;cursor:pointer;line-height:1}'
    + '#intent-panel .ib{padding:8px 10px}'
    + '#intent-panel .phase{display:flex;align-items:center;gap:8px;margin:0 0 6px}#intent-panel .phase b{font:900 .92rem system-ui;letter-spacing:.04em;text-transform:uppercase}#intent-panel .phase span{color:#7f98a6;font:700 .58rem ui-monospace,monospace}'
    + '#intent-panel .bar{height:6px;border-radius:999px;background:#13232b;overflow:hidden;margin:0 0 7px}#intent-panel .bar i{display:block;height:100%}'
    + '#intent-panel .read{margin:0 0 8px;padding:7px 9px;border-radius:8px;background:#0b1620;border:1px solid #1d3550;color:#eaf5f8;font-size:.7rem;line-height:1.5}'
    + '#intent-panel h4{margin:9px 0 4px;color:#8ff1c5;font:900 .58rem ui-monospace,monospace;letter-spacing:.1em}'
    + '#intent-panel .ev{margin:0 0 4px;padding:5px 7px;border-left:3px solid #35e6a0;background:#0a1118;border-radius:0 7px 7px 0}#intent-panel .ev.s{border-left-color:#ff6b86}#intent-panel .ev.n{border-left-color:#3a4f5a;color:#9fb3bd}'
    + '#intent-panel .lv{display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;margin:0 0 4px;padding:5px 7px;border-radius:7px;background:#0a1118;border:1px solid #17323d}#intent-panel .lv b{font:900 .7rem ui-monospace,monospace}#intent-panel .lv small{display:block;color:#7f98a6;font-size:.56rem}#intent-panel .lv .g{padding:1px 6px;border-radius:5px;font:900 .56rem ui-monospace,monospace;color:#041a12}'
    + '#intent-panel .fm{display:grid;grid-template-columns:1fr 1fr;gap:5px}#intent-panel .fm div{padding:6px 7px;border-radius:7px;background:#0a1118;border:1px solid #17323d;min-width:0}#intent-panel .fm b{display:block;font:900 .56rem ui-monospace,monospace;color:#8ff1c5;letter-spacing:.06em}#intent-panel .fm em{display:block;font:900 .82rem ui-monospace,monospace;font-style:normal;color:#fff;margin:2px 0 1px}#intent-panel .fm span{display:block;color:#9fb3bd;font-size:.56rem;line-height:1.35}#intent-panel .fm .na em{color:#4e6572}'
    + '#intent-panel .chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 0}#intent-panel .chips span{padding:2px 6px;border-radius:999px;background:#13232b;color:#9fb3bd;font:800 .52rem ui-monospace,monospace}#intent-panel .chips span.ok{background:#0d3a2a;color:#3ef0a8}'
    + '#intent-panel .flip{margin:8px 0 0;padding:6px 8px;border-radius:7px;background:#2a1a0e;border:1px solid #6b4a22;color:#ffd3a6;font-size:.62rem}'
    + '#intent-panel .err{margin:6px 0;padding:6px 8px;border-radius:7px;background:#2a1118;border:1px solid #6b2234;color:#ffb3c0;font-weight:700}'
    + '#intent-panel .note{margin:8px 0 0;color:#5f7784;font-size:.54rem}'
    + '@media(max-width:700px){#intent-panel{right:6px;left:6px;width:auto;top:auto;bottom:34px;max-height:48%}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'intent-btn'; btn.textContent = 'INTENT'; btn.title = 'Smart-money intent: where the big money is placed and what it is doing (VPIN, Kyle lambda, icebergs, spoofs, dark pool, liquidity map)'; toolbar.appendChild(btn);
  const layer = document.createElement('canvas'); layer.id = 'intent-layer'; stage.appendChild(layer); const ctx = layer.getContext('2d');
  const panel = document.createElement('aside'); panel.id = 'intent-panel'; panel.setAttribute('aria-label', 'Smart-money intent'); stage.appendChild(panel);
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => panel.addEventListener(ev, (e) => e.stopPropagation()));

  async function fetchRead() {
    const sym = symbolNow(), tf = tfNow(), key = sym + '|' + tf;
    if (S.busy) return; S.busy = true; S.key = key;
    try {
      let t = token(); if (!t) { S.err = 'Unlock the Academy tools to read smart-money intent.'; S.data = null; return; }
      const read = (tok) => fetch('/academy-activity/intent?symbol=' + encodeURIComponent(sym) + '&tf=' + encodeURIComponent(tf), { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
      let res = await read(t);
      /* sessions last 15 minutes: a 401 renews the session once (silently) and reads again */
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) { t = fresh; res = await read(t); } }
      const j = await res.json().catch(() => null);
      if (key !== S.key) return;
      if (!res.ok || !j || !j.ok) { S.err = j && j.error === 'academy_access_required' ? 'Intent is an Academy member tool.' : 'Could not read intent right now' + (j && j.error ? ' (' + j.error + ')' : '') + '.'; return; }
      S.data = j; S.err = ''; S.at = Date.now();
    } catch (_) { S.err = 'No connection.'; }
    finally { S.busy = false; paint(); draw(); }
  }

  /* ---- the layer: the liquidity map on the candles ---- */
  function draw() {
    const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
    layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!S.on || !S.data || !S.data.map || !S.data.map.ok || !w || !h) return;
    const M = window.smlChartModel && window.smlChartModel(); if (!M || M.symbol !== S.data.symbol) return;
    const pad = M.pad, right = pad.l + M.pw, top = pad.t, ph = M.priceH || M.ph;
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, top, M.pw, ph); ctx.clip();
    const levels = S.data.map.levels.slice().sort((a, b) => a.score - b.score);
    for (const l of levels) {
      if (l.price < M.lo || l.price > M.hi) continue;
      const y = M.y(l.price), col = ROLE[l.role] || '#9fb3bd', thick = Math.min(4, 1 + l.score * 0.45);
      if (l.hi > l.lo) { const y1 = M.y(l.hi), y2 = M.y(l.lo); ctx.fillStyle = col + '22'; ctx.fillRect(pad.l, Math.min(y1, y2), M.pw, Math.max(2, Math.abs(y2 - y1))); }
      ctx.strokeStyle = col; ctx.lineWidth = thick; ctx.setLineDash(l.grade === 'A' ? [] : l.grade === 'B' ? [8, 4] : [3, 4]); ctx.globalAlpha = l.grade === 'D' ? 0.55 : 0.9;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const text = l.grade + ' · ' + l.role.toUpperCase() + ' ' + l.price + ' · ' + l.sources.slice(0, 3).map(nameOf).join(' + ') + (l.sources.length > 3 ? ' +' + (l.sources.length - 3) : '');
      ctx.font = '800 10px ui-monospace,monospace'; const tw = ctx.measureText(text).width + 12, bx = right - tw - 6, by = y - 9;
      ctx.fillStyle = 'rgba(7,14,20,.92)'; ctx.strokeStyle = col; ctx.lineWidth = 1; roundRect(bx, by, tw, 17, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(text, bx + 6, by + 12);
    }
    /* icebergs: hidden size marks at the price; spoofs: hollow marks */
    const ice = S.data.formulas && S.data.formulas.iceberg; if (ice && ice.ok) for (const l of ice.levels) { if (l.price < M.lo || l.price > M.hi) continue; const y = M.y(l.price), col = l.hidden === 'buyer' ? '#35e6a0' : '#ff6b86'; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pad.l + 10, y - 6); ctx.lineTo(pad.l + 16, y); ctx.lineTo(pad.l + 10, y + 6); ctx.lineTo(pad.l + 4, y); ctx.closePath(); ctx.fill(); ctx.font = '800 9px ui-monospace,monospace'; ctx.fillText('ICEBERG ' + l.hidden.toUpperCase() + ' ' + l.ratio + 'x', pad.l + 20, y + 3); }
    const sp = S.data.formulas && S.data.formulas.spoof; if (sp && sp.ok) for (const e of sp.events.slice(-3)) { if (e.price < M.lo || e.price > M.hi) continue; const y = M.y(e.price), col = '#ffb454'; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pad.l + 10, y, 5, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = col; ctx.font = '800 9px ui-monospace,monospace'; ctx.fillText('PULLED ' + e.side.toUpperCase() + ' ' + e.size.toLocaleString('en-US'), pad.l + 20, y + 3); }
    /* phase stamp */
    const it = S.data.intent; if (it) { const col = PHASE[it.phase] || '#8fa5b1', text = 'INTENT: ' + it.phase.toUpperCase() + (it.side !== 'neither' ? ' · ' + it.side.toUpperCase() : '') + ' · ' + it.strength; ctx.font = '900 12px ui-monospace,monospace'; const tw = ctx.measureText(text).width + 16; ctx.fillStyle = 'rgba(7,14,20,.9)'; ctx.strokeStyle = col; ctx.lineWidth = 1.5; roundRect(pad.l + 8, top + 8, tw, 22, 6); ctx.fill(); ctx.stroke(); ctx.fillStyle = col; ctx.fillText(text, pad.l + 16, top + 23); }
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }
  const NAMES = { orderBlock: 'OB', fvg: 'FVG', eqh: 'EQH', eql: 'EQL', wall: 'WALL', iceberg: 'ICEBERG', darkPool: 'DARK', callWall: 'CALL WALL', putWall: 'PUT WALL', gammaFlip: 'FLIP', poc: 'POC', vah: 'VAH', val: 'VAL', hvn: 'HVN', vwap: 'VWAP', swing: 'SWING' };
  const nameOf = (s) => NAMES[s] || s.toUpperCase();

  /* ---- the panel ---- */
  function fmCard(key, title, f, value, meaning) {
    if (!f || !f.ok) return '<div class="na"><b>' + title + '</b><em>—</em><span>' + esc(f && f.reason ? f.reason.replace(/_/g, ' ') : 'no data') + '</span></div>';
    return '<div title="' + esc((S.data.glossary || {})[key] || '') + '"><b>' + title + '</b><em>' + esc(value) + '</em><span>' + esc(meaning) + '</span></div>';
  }
  function paint() {
    panel.classList.toggle('open', S.on); btn.classList.toggle('on', S.on);
    if (!S.on) return;
    const d = S.data, it = d && d.intent, f = (d && d.formulas) || {};
    let h = '<div class="ih"><b>INTENT · $' + esc(d ? d.symbol : symbolNow()) + '</b><small>' + (S.busy ? 'reading…' : S.at ? 'as of ' + new Date(S.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '') + '</small><button type="button" data-close="1" aria-label="Close">×</button></div><div class="ib">';
    if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
    if (it) {
      const col = PHASE[it.phase] || '#8fa5b1';
      h += '<div class="phase"><b style="color:' + col + '">' + esc(it.phase) + '</b><span>' + (it.side === 'neither' ? 'no side yet' : it.side + ' positioned') + ' · strength ' + it.strength + '</span></div>';
      h += '<div class="bar"><i style="width:' + it.strength + '%;background:' + col + '"></i></div>';
      h += '<div class="read">' + esc(it.read) + '</div>';
      const pf = d.present || {};
      h += '<div class="chips"><span class="' + (pf.tape !== 'none' ? 'ok' : '') + '">tape: ' + esc(pf.tape || 'none') + '</span><span class="' + (pf.book ? 'ok' : '') + '">book</span><span class="' + (pf.darkPool ? 'ok' : '') + '">dark pool</span><span class="' + (pf.gamma ? 'ok' : '') + '">gamma</span><span class="' + (pf.smc ? 'ok' : '') + '">smc</span><span>' + d.trades + ' prints</span></div>';
      h += '<h4>WHAT THEY ARE DOING</h4>' + it.evidence.map((e) => '<div class="ev ' + (e.w > 0 ? '' : e.w < 0 ? 's' : 'n') + '">' + esc(e.text) + '</div>').join('');
      if (d.map && d.map.ok && d.map.levels.length) {
        h += '<h4>WHERE THEY ARE · LIQUIDITY MAP</h4>';
        const near = d.map.levels.slice().sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, 8);
        h += near.map((l) => '<div class="lv"><span class="g" style="background:' + (ROLE[l.role] || '#9fb3bd') + '">' + l.grade + '</span><div><b style="color:' + (ROLE[l.role] || '#9fb3bd') + '">' + l.price + ' · ' + esc(l.role) + '</b><small>' + esc(l.labels.slice(0, 4).join(' + ')) + '</small></div><small>' + (l.distancePct > 0 ? '+' : '') + l.distancePct + '%' + (l.distanceAtr != null ? '<br>' + l.distanceAtr + ' ATR' : '') + '</small></div>').join('');
      }
      h += '<h4>THE FORMULAS · LIVE</h4><div class="fm">'
        + fmCard('vpin', 'VPIN', f.vpin, f.vpin && f.vpin.ok ? f.vpin.vpin + ' ' + f.vpin.band : '', f.vpin && f.vpin.ok ? (f.vpin.trend > 0.05 ? 'toxicity rising' : f.vpin.trend < -0.05 ? 'toxicity easing' : 'steady') + ' · ' + f.vpin.buckets + ' buckets of ' + f.vpin.bucket.toLocaleString('en-US') : '')
        + fmCard('lambda', 'KYLE λ', f.lambda, f.lambda && f.lambda.ok ? f.lambda.lambda + ' bps' : '', f.lambda && f.lambda.ok ? f.lambda.band + ' · per ' + f.lambda.unit + ' · R² ' + f.lambda.r2 : '')
        + fmCard('persistence', 'PERSISTENCE', f.persistence, f.persistence && f.persistence.ok ? f.persistence.acf : '', f.persistence && f.persistence.ok ? f.persistence.band + ' · ' + f.persistence.side + ' side' : '')
        + fmCard('footprint', 'FOOTPRINT', f.footprint, f.footprint && f.footprint.ok ? Math.round(f.footprint.largeShare * 100) + '% big' : '', f.footprint && f.footprint.ok ? f.footprint.who + ' · big prints lean ' + f.footprint.side + ' · odd lots ' + Math.round(f.footprint.oddShare * 100) + '%' : '')
        + fmCard('iceberg', 'ICEBERG', f.iceberg, f.iceberg && f.iceberg.ok ? (f.iceberg.side === 'none' ? 'none' : 'hidden ' + f.iceberg.side) : '', f.iceberg && f.iceberg.ok ? (f.iceberg.levels.length ? f.iceberg.levels.slice(0, 2).map((l) => l.price + ' (' + l.ratio + 'x)').join(', ') : 'nothing refilling beyond what it shows') : '')
        + fmCard('spoof', 'SPOOF', f.spoof, f.spoof && f.spoof.ok ? f.spoof.count + ' pulled' : '', f.spoof && f.spoof.ok ? f.spoof.intent : '')
        + fmCard('darkPool', 'DARK DIX', f.darkPool, f.darkPool && f.darkPool.ok && f.darkPool.dix != null ? Math.round(f.darkPool.dix * 100) + '%' : 'n/a', f.darkPool && f.darkPool.ok ? f.darkPool.band + (f.darkPool.offShare != null ? ' · ' + f.darkPool.offShare + '% off-exchange' : '') : '')
        + (d.profile ? '<div title="' + esc((d.glossary || {}).map || '') + '"><b>VALUE AREA</b><em>' + d.profile.val + ' – ' + d.profile.vah + '</em><span>POC ' + d.profile.poc + (it.valuePos != null ? ' · price at ' + Math.round(it.valuePos * 100) + '% of value' : '') + '</span></div>' : '')
        + '</div>';
      h += '<div class="flip"><b>FLIPS IF:</b> ' + esc(d.invalidation) + '</div>';
      h += '<div class="note">Hover a formula for how it is computed. Dealer and dark-pool positioning are inferred from prints, not observed orders. Educational, not a trade signal.</div>';
    } else if (!S.err) h += '<div class="read">Reading the tape, the book, the dark pool and the options walls…</div>';
    h += '</div>';
    panel.innerHTML = h;
  }

  /* ---- events ---- */
  btn.addEventListener('click', () => { S.on = !S.on; paint(); if (S.on) fetchRead(); else draw(); });
  panel.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-close]'); if (t) { S.on = false; paint(); draw(); } });
  window.addEventListener('sml-chart-view', () => { try { draw(); } catch (_) { /* chart not ready */ } });
  window.addEventListener('sml-academy-market', () => { const key = symbolNow() + '|' + tfNow(); if (key !== S.key && S.on) { S.data = null; paint(); setTimeout(fetchRead, 300); } });
  setInterval(() => { if (S.on && !document.hidden && Date.now() - S.at > 19_000) fetchRead(); }, 5_000);
  window.smlSmartIntent = { open: () => { if (!S.on) btn.click(); }, state: () => S.data };
})(0);
