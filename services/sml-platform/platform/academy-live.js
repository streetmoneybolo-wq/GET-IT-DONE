/* Tick-by-tick feed for the Academy Live Chart Lab. Polls /academy-activity/live about once a second and drives, from the same real prints:
   the forming candle (window.smlChartPro.liveTick), the price / bid / ask readouts, a Level 2 ladder that flashes as sizes change, and a time & sales tape of individual trades.
   It never blocks the chart: if the feed is down the page keeps its normal five-second refresh. */
(() => {
  if (window.__smlLiveTape) return;
  window.__smlLiveTape = true;
  const q = () => new URLSearchParams(location.search);
  const sym = () => String(q().get('symbol') || 'SPY').toUpperCase();
  const $ = (id) => document.getElementById(id);
  const fmt = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : '–');
  const size = (v) => Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(v) || 0);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const st = { symbol: '', lastT: 0, prev: { bids: {}, asks: {} }, freshAt: 0, failures: 0, lastBook: null };
  const style = document.createElement('style');
  style.textContent = '.academy-depth-row{transition:background .35s}.academy-depth-row.up{background:rgba(0,208,132,.28)}.academy-depth-row.down{background:rgba(255,84,112,.28)}.academy-depth-row.best span:first-child{font-weight:800;color:#fff}'
    + '.academy-depth h3 small{float:right;color:#5fd6a8;font-weight:700}.academy-depth h3 small.stale{color:#ffb454}'
    + '.academy-tape{margin-top:10px;border-top:1px solid #1b3540;padding-top:8px}.academy-tape h4{margin:0 0 5px;font:800 .58rem ui-monospace;color:#86a2b0}.academy-tape-row{display:flex;justify-content:space-between;gap:6px;padding:2px 0;font:.6rem ui-monospace;border-bottom:1px solid rgba(42,66,78,.35)}.academy-tape-row.B{color:#52e6ad}.academy-tape-row.S{color:#ff778b}.academy-tape-row.N{color:#b8c7d0}.academy-tape-row i{font-style:normal;color:#6f8794}';
  document.head.appendChild(style);

  function paintDepth(book, ageMs) {
    const panel = document.querySelector('.academy-depth'); if (!panel || !book) return;
    let grid = panel.querySelector('.academy-depth-grid');
    if (!grid) { const empty = panel.querySelector('.academy-depth-empty'); if (empty) empty.remove(); grid = document.createElement('div'); grid.className = 'academy-depth-grid'; panel.appendChild(grid); }
    const rows = 7;
    const col = (name, cls, levels, prev, key) => {
      const head = '<b class="' + cls + '">' + name + '</b>';
      const body = levels.slice(0, rows).map((l, i) => {
        const p = Number(l.price), s = Number(l.size), before = prev[p.toFixed(2)];
        const dir = before == null ? '' : s > before ? ' up' : s < before ? ' down' : '';
        return '<div class="academy-depth-row' + (i === 0 ? ' best' : '') + dir + '"><span>' + fmt(p) + '</span><span>' + size(s) + '</span></div>';
      }).join('');
      const next = {}; levels.forEach((l) => { next[Number(l.price).toFixed(2)] = Number(l.size); }); st.prev[key] = next;
      return '<div class="academy-depth-col">' + head + body + '</div>';
    };
    grid.innerHTML = col('BID', 'academy-depth-bid', book.bids, st.prev.bids, 'bids') + col('ASK', 'academy-depth-ask', book.asks, st.prev.asks, 'asks');
    const title = panel.querySelector('h3');
    if (title) { let s = title.querySelector('small'); if (!s) { s = document.createElement('small'); title.appendChild(s); } s.textContent = (ageMs / 1000).toFixed(1) + 's'; s.className = ageMs > 4000 ? 'stale' : ''; }
  }
  function paintTape(tape) {
    const panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-tape');
    if (!box) { box = document.createElement('div'); box.className = 'academy-tape'; box.innerHTML = '<h4>TIME &amp; SALES · INDIVIDUAL PRINTS</h4><div class="rows"></div>'; panel.after(box); }
    box.querySelector('.rows').innerHTML = tape.slice(0, 12).map((t) => '<div class="academy-tape-row ' + esc(t.dir) + '"><i>' + new Date(t.t).toLocaleTimeString('en-US', { hour12: false }) + '</i><span>' + fmt(t.price) + '</span><span>' + size(t.size) + '</span></div>').join('');
  }
  function paintQuote(d) {
    const bid = d.book.bids[0], ask = d.book.asks[0]; if (!bid || !ask) return;
    const b = Number(bid.price), a = Number(ask.price);
    const set = (id, text) => { const e = $(id); if (e && e.textContent !== text) e.textContent = text; };
    set('sell', fmt(b)); set('buy', fmt(a)); set('bidbook', fmt(b) + ' × ' + size(bid.size)); set('askbook', fmt(a) + ' × ' + size(ask.size)); set('spread', (a - b).toFixed(4));
    if (Number.isFinite(d.last)) {
      set('price', '$' + fmt(d.last));
      const m = window.smlChartModel && window.smlChartModel(); const prev = m && m.bars[m.N - 2];
      const ch = $('change'); if (ch && prev && +prev.c) { const delta = d.last - +prev.c, pct = delta / +prev.c * 100; ch.textContent = (delta >= 0 ? '▲ +' : '▼ ') + delta.toFixed(2) + ' (' + pct.toFixed(2) + '%)'; ch.style.color = delta >= 0 ? '#00d084' : '#ff5470'; }
    }
    const s = $('status'); if (s && s.textContent !== 'LIVE') s.textContent = 'LIVE';
  }
  // the base page rewrites bid/ask with a synthetic value on every refresh; put the real book back
  const baseRefresh = window.smlAcademyRefreshQuote;
  if (typeof baseRefresh === 'function') window.smlAcademyRefreshQuote = () => { baseRefresh(); if (st.lastBook && Date.now() - st.freshAt < 5000) paintQuote(st.lastBook); };

  async function once() {
    const symbol = sym();
    if (symbol !== st.symbol) { st.symbol = symbol; st.lastT = 0; st.prev = { bids: {}, asks: {} }; st.lastBook = null; }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await fetch('/academy-activity/live?symbol=' + encodeURIComponent(symbol), { cache: 'no-store', signal: ctl.signal });
      const d = await res.json();
      if (!res.ok || !d || !d.ready || sym() !== symbol) { st.failures = d && d.ready === false ? 0 : st.failures + 1; return; }
      st.failures = 0; st.freshAt = Date.now(); st.lastBook = d;
      let fresh = (d.tape || []).filter((t) => t.t > st.lastT).sort((a, b) => a.t - b.t);
      if (!st.lastT && fresh.length > 1) fresh = [Object.assign({}, fresh[fresh.length - 1], { size: 0 })]; // first look: take the price, don't replay history as volume
      if (window.smlChartPro && window.smlChartPro.liveTick) for (const t of fresh) window.smlChartPro.liveTick(t.price, t.size, t.t);
      if (fresh.length) st.lastT = fresh[fresh.length - 1].t;
      paintDepth(d.book, Math.max(0, (d.servedAt || 0) - (d.asOf || d.servedAt || 0)));
      paintTape(d.tape || []); paintQuote(d);
    } catch (_) { st.failures++; } finally { clearTimeout(timer); }
  }
  (function loop() { const wait = document.hidden ? 4000 : st.failures ? Math.min(8000, 1500 * st.failures) : 700; once().finally(() => setTimeout(loop, wait)); })();
})();
