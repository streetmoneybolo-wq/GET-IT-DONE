/* EARNINGS INSIGHT, drawn under the earnings calendar when the EARNINGS switch is on (academy-earnings-panel.js).
 * Server: GET /academy-activity/earnings-insight?symbol= (academy-earnings-insight.js). What it shows, all from reported figures:
 *   - the last eight quarters as charts: revenue and operating income bars with YoY labels; gross, operating and net margin lines;
 *     the cost stack (cost of revenue, R&D, SG&A, other) as a share of revenue
 *   - the model of the next report (revenue, costs, operating income, EPS) with its own error band, beside the street's estimate
 *   - the signals in plain sentences (growth, margins, costs, bookings, inventory, cash, the priced move, short interest, filings)
 *   - the AI brief (drivers, costs, margins, what to watch, beat / in-line / miss) when the server has it
 * Educational only: nothing here predicts the result or places a trade. */
(() => {
  if (window.__smlEarningsInsight) return;
  window.__smlEarningsInsight = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const sym = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 10) || 'SPY';
  const big = (v) => { if (v == null || !Number.isFinite(Number(v))) return '—'; const a = Math.abs(v), s = v < 0 ? '-' : ''; return s + '$' + (a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : String(Math.round(a))); };
  const pc = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%');
  const p0 = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d) + '%');
  const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : '$' + Number(v).toFixed(2));

  const css = document.createElement('style');
  css.textContent = '#earnings-insight{margin-top:14px;padding-top:12px;border-top:1px solid #1b3540}#earnings-insight h3{margin:0 0 8px;font:800 .72rem ui-monospace,monospace;color:#42f5b3;letter-spacing:.06em}#earnings-insight h4{margin:12px 0 6px;font:800 .6rem ui-monospace,monospace;letter-spacing:.1em;color:#8fa6b3}'
    + '#earnings-insight .ei-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px}#earnings-insight .ei-kpis div{padding:7px 9px;border-radius:8px;background:rgba(255,255,255,.035);border:1px solid #16303a}#earnings-insight .ei-kpis span{display:block;font:800 .52rem ui-monospace,monospace;letter-spacing:.08em;color:#7f95a1}#earnings-insight .ei-kpis b{display:block;font:800 .92rem ui-monospace,monospace;color:#fff;margin-top:2px}#earnings-insight .ei-kpis small{color:#8fa6b3;font:700 .56rem ui-monospace,monospace}#earnings-insight .up{color:#52e6ad}#earnings-insight .down{color:#ff778b}#earnings-insight .flat{color:#ffd166}'
    + '#earnings-insight .ei-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-top:8px}#earnings-insight .ei-chart{border:1px solid #16303a;border-radius:9px;background:#07111a;padding:8px}#earnings-insight .ei-chart b{display:block;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em;color:#9ed3e6;margin-bottom:4px}#earnings-insight canvas{display:block;width:100%;height:170px}'
    + '#earnings-insight .ei-model{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}#earnings-insight table{width:100%;border-collapse:collapse;font:600 .66rem ui-monospace,monospace}#earnings-insight th,#earnings-insight td{padding:5px 6px;text-align:right;border-bottom:1px solid rgba(42,66,78,.5)}#earnings-insight th{color:#8fa6b3;font-weight:700}#earnings-insight td:first-child,#earnings-insight th:first-child{text-align:left;color:#c7d5dc}'
    + '#earnings-insight .ei-sig{list-style:none;margin:0;padding:0}#earnings-insight .ei-sig li{margin:0 0 6px;padding:6px 9px;border-left:3px solid #4a5a66;background:rgba(255,255,255,.03);border-radius:0 7px 7px 0;color:#dbe6ec;font:500 .68rem/1.45 system-ui,sans-serif}#earnings-insight .ei-sig li.up{border-color:#00d084}#earnings-insight .ei-sig li.down{border-color:#ff5470}#earnings-insight .ei-sig li.flat{border-color:#ffd166}'
    + '#earnings-insight .ei-ai{border:1px solid #2f6cf5;border-radius:10px;background:#0b1424;padding:10px 12px;color:#dbe6ec;font:500 .68rem/1.5 system-ui,sans-serif}#earnings-insight .ei-ai h5{margin:0 0 6px;font:800 .78rem system-ui,sans-serif;color:#fff}#earnings-insight .ei-ai h6{margin:8px 0 3px;font:800 .54rem ui-monospace,monospace;letter-spacing:.1em;color:#9cc8ff}#earnings-insight .ei-ai ul{margin:0;padding-left:16px}#earnings-insight .ei-ai .sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px}#earnings-insight .ei-ai .sc div{padding:6px 8px;border-radius:7px;background:rgba(255,255,255,.04)}#earnings-insight .ei-ai .sc b{display:block;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em}#earnings-insight .ei-ai .sc .b b{color:#52e6ad}#earnings-insight .ei-ai .sc .i b{color:#ffd166}#earnings-insight .ei-ai .sc .m b{color:#ff778b}#earnings-insight .ei-ai small{display:block;margin-top:6px;color:#7f95a1}'
    + '#earnings-insight .note{margin-top:10px;color:#7f97a4;font-size:.6rem;line-height:1.4;font-weight:500}#earnings-insight .ei-news a{color:#9cc8ff;text-decoration:none}#earnings-insight .ei-news li{margin:0 0 3px;font:600 .64rem system-ui,sans-serif}';
  document.head.appendChild(css);

  const S = { symbol: '', data: null, loading: false, error: '', painted: '' };
  const openOut = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* blocked */ } } };

  async function load(symbol) {
    if (S.loading || !token()) return;
    S.loading = true; S.error = ''; S.symbol = symbol; S.data = null; paint();
    try {
      let res = await fetch('/academy-activity/earnings-insight?symbol=' + encodeURIComponent(symbol), { headers: { authorization: 'Bearer ' + token() }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const t = await window.smlAcademyReauth(); if (t) res = await fetch('/academy-activity/earnings-insight?symbol=' + encodeURIComponent(symbol), { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); }
      const j = await res.json().catch(() => null);
      if (!j || !j.ok) S.error = res.status === 403 ? 'Earnings insight is part of the full Academy.' : res.status === 429 ? 'Slow down a moment, then try again.' : 'Earnings insight is not available right now.';
      else S.data = j;
    } catch (_) { S.error = 'Earnings insight is not available right now.'; }
    S.loading = false; paint();
  }

  /* ---- charts ---- */
  function canvasCtx(cv) { const w = cv.clientWidth || 300, h = cv.clientHeight || 170, dpr = window.devicePixelRatio || 1; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); return { c, w, h }; }
  const V = window.smlViz; /* the chart kit: validated palette, thin rounded bars with gaps, hairline grids, hover */
  const qLabel = (q) => q.label.replace(' FY', "'");
  function barsChart(cv, qs) {
    const { c, w, h } = V.setup(cv); const padL = 46, padR = 8, padT = 18, padB = 20;
    const r = V.columns(c, { x0: padL, x1: w - padR, yTop: padT, yBot: h - padB, fmt: (v) => big(v).replace('$', ''), items: qs.map((q) => ({ label: qLabel(q), values: [q.revenue, q.opIncome == null ? NaN : q.opIncome], colors: [V.T.series[0], q.opIncome >= 0 ? V.T.up : V.T.down] })) });
    V.legend(c, padL, 7, [{ name: 'revenue', color: V.T.series[0] }, { name: 'operating income (green profit, red loss)', color: V.T.up }]);
    const last = qs[qs.length - 1];
    if (last && last.yoy && last.yoy.revenue != null) { const g = r.geoms.filter((q) => q.i === qs.length - 1 && q.k === 0)[0]; if (g) { c.fillStyle = V.T.ink2; c.font = V.T.font; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(pc(last.yoy.revenue, 0) + ' YoY', g.x + g.w / 2, g.y0 - 15); } }
    V.hover(cv, (px) => { const g = V.hitColumn(r.geoms, px); if (!g) return null; const q = qs[g.i]; const rows = [{ label: 'revenue' + (q.yoy && q.yoy.revenue != null ? ' · ' + pc(q.yoy.revenue, 0) + ' YoY' : ''), value: big(q.revenue), color: V.T.series[0] }]; if (q.opIncome != null) rows.push({ label: 'operating income', value: big(q.opIncome), color: q.opIncome >= 0 ? V.T.up : V.T.down }); return { title: q.label, rows }; });
  }
  function linesChart(cv, qs) {
    const { c, w, h } = V.setup(cv); const padL = 40, padR = 10, padT = 18, padB = 20, pw = w - padL - padR, ph = h - padT - padB;
    const series = [['grossMarginPct', V.T.series[0], 'gross'], ['opMarginPct', V.T.series[2], 'operating'], ['netMarginPct', V.T.series[3], 'net'], ['fcfMarginPct', V.T.series[6], 'FCF']];
    const vals = qs.flatMap((q) => series.map(([k]) => q[k])).filter(Number.isFinite); if (!vals.length) return;
    const tk = V.ticks(Math.min(0, ...vals), Math.max(...vals), 4), lo = tk.lo, hi = tk.hi;
    const x = (i) => padL + (qs.length === 1 ? pw / 2 : i / (qs.length - 1) * pw), y = (v) => padT + (hi - v) / (hi - lo || 1) * ph;
    V.grid(c, padL, w - padR, tk.ticks.map((v) => ({ y: y(v), label: v.toFixed(0) + '%' })));
    if (lo < 0) V.baseline(c, padL, w - padR, y(0));
    const live = series.filter(([k]) => qs.some((q) => Number.isFinite(q[k])));
    live.forEach(([k, col]) => V.line(c, qs.map((q, i) => (Number.isFinite(q[k]) ? [x(i), y(q[k])] : null)), { color: col, width: 2, markers: true, marker: false }));
    V.legend(c, padL, 7, live.map(([, col, name]) => ({ name, color: col, line: true })));
    c.fillStyle = V.T.ink2; c.font = V.T.font; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; qs.forEach((q, i) => { if (qs.length <= 8 || i % 2 === 0) c.fillText(qLabel(q), x(i), h - 6); });
    const xs = qs.map((_, i) => x(i));
    V.hover(cv, (px) => { const i = V.nearestX(xs, px); if (i < 0) return null; const q = qs[i]; return { title: q.label, rows: live.map(([k, col, name]) => ({ label: name + ' margin', value: p0(q[k]), color: col, line: true })) }; });
  }
  function costChart(cv, qs) {
    const { c, w, h } = V.setup(cv); const padL = 40, padR = 8, padT = 18, padB = 20;
    const parts = [['cogsPct', V.T.series[1], 'cost of revenue'], ['rdPct', V.T.series[0], 'R&D'], ['sgaPct', V.T.series[6], 'SG&A']];
    const other = (q) => (Number.isFinite(q.opexPct) && Number.isFinite(q.rdPct) && Number.isFinite(q.sgaPct) ? Math.max(0, q.opexPct - q.rdPct - q.sgaPct) : 0);
    const items = qs.map((q) => ({ label: qLabel(q), parts: parts.map(([k]) => (Number.isFinite(q[k]) ? Math.max(0, q[k]) : 0)).concat([other(q) > 0.2 ? other(q) : 0]) }));
    const r = V.stacks(c, { x0: padL, x1: w - padR, yTop: padT, yBot: h - padB, hi: 100, fmt: (v) => v + '%', colors: parts.map(([, col]) => col).concat([V.T.neutral]), items });
    const last = qs[qs.length - 1], lastItem = items[items.length - 1];
    if (last && Number.isFinite(last.opMarginPct) && lastItem) { c.fillStyle = V.T.ink; c.font = V.T.fontBold; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('op margin ' + last.opMarginPct.toFixed(0) + '%', padL + (items.length - 0.5) * r.slot, lastItem.top - 4); }
    V.legend(c, padL, 7, parts.map(([, col, name]) => ({ name, color: col })).concat([{ name: 'other opex', color: V.T.neutral }]));
    V.hover(cv, (px) => { const g = V.hitColumn(r.geoms, px); if (!g) return null; const q = qs[g.i]; const rows = parts.map(([k, col, name]) => ({ label: name, value: p0(q[k], 0), color: col })); if (other(q) > 0.2) rows.push({ label: 'other opex', value: p0(other(q), 0), color: V.T.neutral }); if (Number.isFinite(q.opMarginPct)) rows.push({ label: 'operating margin', value: p0(q.opMarginPct, 0), color: q.opMarginPct >= 0 ? V.T.up : V.T.down }); return { title: q.label + ' · share of revenue', rows }; });
  }

  function html(d) {
    const qs = d.quarters.slice(-8), last = qs[qs.length - 1], t = d.trend || {}, m = d.model, bt = d.backtest || {}, st = d.street || {}, nx = d.next;
    const tone = (v, eps = 0.3) => (v == null ? '' : v > eps ? 'up' : v < -eps ? 'down' : 'flat');
    let h = '<h3>EARNINGS INSIGHT · $' + esc(d.symbol) + (nx && nx.date ? ' · next report ' + esc(nx.date) + (nx.timing && nx.timing !== 'UNSPECIFIED' ? ' ' + esc(nx.timing) : '') : '') + '</h3>';
    h += '<div class="ei-kpis">'
      + '<div><span>REVENUE · ' + esc(last.label) + '</span><b>' + big(last.revenue) + '</b><small class="' + tone(last.yoy.revenue) + '">' + pc(last.yoy.revenue) + ' YoY</small></div>'
      + '<div><span>GROSS MARGIN</span><b>' + p0(last.grossMarginPct) + '</b><small class="' + tone(last.grossMarginYoyPts) + '">' + pc(last.grossMarginYoyPts) + ' pts YoY</small></div>'
      + '<div><span>OPERATING MARGIN</span><b>' + p0(last.opMarginPct) + '</b><small class="' + tone(last.opMarginYoyPts) + '">' + pc(last.opMarginYoyPts) + ' pts YoY</small></div>'
      + '<div><span>EPS (DILUTED)</span><b>' + money(last.eps) + '</b><small class="' + tone(last.yoy.eps, 1) + '">' + pc(last.yoy.eps) + ' YoY</small></div>'
      + '<div><span>FREE CASH FLOW</span><b>' + big(last.fcf) + '</b><small>' + p0(last.fcfMarginPct) + ' of revenue</small></div>'
      + '<div><span>OP. LEVERAGE</span><b>' + (t.incrementalMarginAvg == null ? '—' : '$' + t.incrementalMarginAvg.toFixed(2)) + '</b><small>per extra $1 of revenue</small></div>'
      + '</div>';
    h += '<div class="ei-charts"><div class="ei-chart"><b>SALES AND OPERATING INCOME</b><canvas data-ei="bars"></canvas></div><div class="ei-chart"><b>MARGINS</b><canvas data-ei="lines"></canvas></div><div class="ei-chart"><b>COSTS AS A SHARE OF REVENUE</b><canvas data-ei="cost"></canvas></div></div>';
    if (m) {
      const row = (name, a, b, fmt) => '<tr><td>' + name + '</td><td>' + fmt(a) + '</td><td>' + (b == null ? '—' : fmt(b)) + '</td></tr>';
      const gapRev = st.next && st.next.revenueEstimate > 0 ? (m.revenue / st.next.revenueEstimate - 1) * 100 : null, gapEps = st.next && st.next.epsEstimate != null && m.eps != null && Math.abs(st.next.epsEstimate) > 0.01 ? (m.eps - st.next.epsEstimate) / Math.abs(st.next.epsEstimate) * 100 : null;
      h += '<h4>MODEL OF THE NEXT REPORT · ' + esc(m.label) + '</h4><div class="ei-model"><div><table><thead><tr><th>Line</th><th>Model</th><th>Street</th></tr></thead><tbody>'
        + row('Revenue', m.revenue, st.next ? st.next.revenueEstimate : null, big) + row('Growth YoY', m.growthPct, null, (v) => pc(v)) + row('Cost of revenue', m.cogs, null, big) + row('Gross margin', m.grossMarginPct, null, (v) => p0(v)) + row('R&D', m.rd, null, big) + row('SG&A', m.sga, null, big) + row('Operating income', m.opIncome, null, big) + row('Operating margin', m.opMarginPct, null, (v) => p0(v)) + row('Net income', m.netIncome, null, big) + row('EPS', m.eps, st.next ? st.next.epsEstimate : null, money)
        + '</tbody></table></div><div>'
        + '<table><thead><tr><th>How the method did</th><th>Model</th><th>Actual</th><th>Error</th></tr></thead><tbody>' + (bt.rows || []).map((r) => '<tr><td>' + esc(r.label) + ' revenue</td><td>' + big(r.revenue.model) + '</td><td>' + big(r.revenue.actual) + '</td><td class="' + (Math.abs(r.revenue.errPct) <= 3 ? 'up' : Math.abs(r.revenue.errPct) <= 8 ? 'flat' : 'down') + '">' + pc(r.revenue.errPct) + '</td></tr>' + (r.eps.model != null ? '<tr><td>' + esc(r.label) + ' EPS</td><td>' + money(r.eps.model) + '</td><td>' + money(r.eps.actual) + '</td><td class="' + (r.eps.errPct == null ? '' : Math.abs(r.eps.errPct) <= 5 ? 'up' : Math.abs(r.eps.errPct) <= 12 ? 'flat' : 'down') + '">' + pc(r.eps.errPct) + '</td></tr>' : '')).join('') + '</tbody></table>'
        + '<p class="note">Band: revenue within about ' + p0(bt.revenueMapePct) + (bt.epsMapePct != null ? ', EPS within about ' + p0(bt.epsMapePct) : '') + ' on the last ' + (bt.n || 0) + ' reports.' + (gapRev != null || gapEps != null ? ' Against the street: ' + [gapRev != null ? 'revenue ' + pc(gapRev) : '', gapEps != null ? 'EPS ' + pc(gapEps) : ''].filter(Boolean).join(', ') + '.' : ' No street estimate on file for the next report.') + (st.n ? ' Beat the EPS estimate ' + st.beats + ' of the last ' + st.n + '.' : '') + '</p>'
        + '</div></div>';
    } else h += '<p class="note">Fewer than five reported quarters on file: no model yet.</p>';
    h += '<h4>WHAT THE NUMBERS SAY</h4><ul class="ei-sig">' + (d.signals || []).map((s) => '<li class="' + esc(s.tone) + '">' + esc(s.text) + '</li>').join('') + '</ul>';
    const ai = d.ai;
    if (ai && ai.available) {
      h += '<h4>AI BRIEF</h4><div class="ei-ai"><h5>' + esc(ai.headline) + '</h5>'
        + (ai.drivers.length ? '<h6>WHAT IS MOVING SALES</h6><ul>' + ai.drivers.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
        + (ai.costs.length ? '<h6>COSTS</h6><ul>' + ai.costs.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
        + (ai.margins.length ? '<h6>MARGINS</h6><ul>' + ai.margins.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
        + (ai.watch.length ? '<h6>WHAT TO WATCH IN THE REPORT</h6><ul>' + ai.watch.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
        + '<h6>SCENARIOS</h6><div class="sc"><div class="b"><b>BEAT</b>' + esc(ai.scenarios.beat) + '</div><div class="i"><b>IN LINE</b>' + esc(ai.scenarios.inline) + '</div><div class="m"><b>MISS</b>' + esc(ai.scenarios.miss) + '</div></div>'
        + '<small>Confidence: ' + esc(ai.confidence || '—') + '. Written by the Academy’s AI from the figures above only; it does not know the result.</small></div>';
    } else if (ai && ai.reason === 'ai_unconfigured') h += '<p class="note">The AI brief is off on this server (no AI key configured). The signals above are computed from the reported figures.</p>';
    if (d.news && d.news.length) h += '<h4>RECENT HEADLINES</h4><ul class="ei-news">' + d.news.map((n) => '<li><a href="' + esc(n.url) + '" data-ei-out="' + esc(n.url) + '">' + esc(n.title) + '</a></li>').join('') + '</ul>';
    h += '<p class="note">' + esc(d.note || '') + '</p>';
    return h;
  }

  function host() {
    const panel = document.getElementById('earnings-panel'); if (!panel || panel.style.display === 'none') return null;
    let el = document.getElementById('earnings-insight'); if (!el) { el = document.createElement('div'); el.id = 'earnings-insight'; panel.appendChild(el); el.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('[data-ei-out]'); if (a) { e.preventDefault(); openOut(a.dataset.eiOut); } }); }
    else if (el.parentElement !== panel) panel.appendChild(el);
    return el;
  }
  function paint() {
    const el = host(); if (!el) return;
    if (S.loading) { el.innerHTML = '<h3>EARNINGS INSIGHT</h3><p class="note">Reading the last eight quarters…</p>'; S.painted = ''; return; }
    if (S.error) { el.innerHTML = '<h3>EARNINGS INSIGHT</h3><p class="note">' + esc(S.error) + '</p>'; S.painted = ''; return; }
    const d = S.data; if (!d) return;
    if (!d.available) { el.innerHTML = '<h3>EARNINGS INSIGHT · $' + esc(d.symbol) + '</h3><p class="note">No quarterly statements on file for this ticker yet.</p>'; S.painted = ''; return; }
    const key = d.symbol + ':' + d.asOf; if (S.painted === key && el.querySelector('canvas')) return;
    el.innerHTML = html(d); S.painted = key;
    const qs = d.quarters.slice(-8);
    const draw = () => { const b = el.querySelector('[data-ei="bars"]'), l = el.querySelector('[data-ei="lines"]'), c = el.querySelector('[data-ei="cost"]'); if (b) barsChart(b, qs); if (l) linesChart(l, qs); if (c) costChart(c, qs); };
    draw(); setTimeout(draw, 300);
  }
  /* follow the EARNINGS switch: when its panel is on screen, the insight for the chart's ticker loads under it */
  setInterval(() => {
    const panel = document.getElementById('earnings-panel');
    const on = panel && panel.style.display !== 'none' && panel.offsetParent !== null && !!token();
    if (!on) return;
    const s = sym();
    if (s !== S.symbol && !S.loading) { void load(s); return; }
    if (S.data && S.painted !== S.data.symbol + ':' + S.data.asOf) paint();
    else if (S.data && !document.getElementById('earnings-insight')) { S.painted = ''; paint(); }
  }, 1000);
  window.addEventListener('resize', () => { if (S.data) { S.painted = ''; paint(); } });
  window.smlEarningsInsight = { reload: () => { S.symbol = ''; }, state: () => ({ symbol: S.symbol, loaded: !!S.data }) };
})();
