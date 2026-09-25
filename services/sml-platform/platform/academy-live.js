/* Tick-by-tick feed for the Academy Live Chart Lab. Massive trades and quotes arrive over SSE as they happen; slower polling is fallback and refreshes moomoo Level 2:
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

  function paintDepth(book, ageMs, topOnly) {
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
    if (title) { let s = title.querySelector('small'); if (!s) { s = document.createElement('small'); title.appendChild(s); } s.textContent = topOnly ? 'TOP OF BOOK' : (ageMs / 1000).toFixed(1) + 's'; s.className = ageMs > 4000 ? 'stale' : ''; }
  }
  function paintTape(tape) {
    const panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-tape');
    if (!box) { box = document.createElement('div'); box.className = 'academy-tape'; box.innerHTML = '<h4>TIME &amp; SALES · INDIVIDUAL PRINTS</h4><div class="rows"></div>'; panel.after(box); }
    box.querySelector('.rows').innerHTML = tape.slice(0, 12).map((t) => '<div class="academy-tape-row ' + esc(t.dir) + '"><i>' + new Date(t.t).toLocaleTimeString('en-US', { hour12: false }) + '</i><span>' + fmt(t.price) + '</span><span>' + size(t.size) + '</span></div>').join('');
  }
  function paintQuote(d) {
    const rt = d.rt && d.rt.fresh ? d.rt : null;
    const bid = rt ? { price: rt.bid, size: rt.bs } : d.book.bids[0], ask = rt ? { price: rt.ask, size: rt.as } : d.book.asks[0]; if (!bid || !ask) return;
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
      if (window.smlChartGesture) { st.deferred = d; return; } // a finger is on the chart: keep the main thread free, apply this when it lifts
      st.deferred = null;
      apply(d);
    } catch (_) { st.failures++; } finally { clearTimeout(timer); }
  }
  function apply(d) {
    {
      let fresh = (d.tape || []).filter((t) => t.t > st.lastT).sort((a, b) => a.t - b.t);
      if (!st.lastT && fresh.length > 1) fresh = [Object.assign({}, fresh[fresh.length - 1], { size: 0 })]; // first look: take the price, don't replay history as volume
      if (window.smlChartPro && window.smlChartPro.liveTick) for (const t of fresh) window.smlChartPro.liveTick(t.price, t.size, t.t);
      if (fresh.length) st.lastT = fresh[fresh.length - 1].t;
      if (d.rt) st.rt = d.rt;
      if (d.book && ((d.book.bids && d.book.bids.length) || (d.book.asks && d.book.asks.length))) paintDepth(d.book, Math.max(0, (d.servedAt || 0) - (d.asOf || d.servedAt || 0)), !!d.topOnly);
      paintTape(d.tape || []); paintQuote(d);
      window.smlLive = d; window.dispatchEvent(new Event('sml-live-data'));
      window.smlLive = d; window.dispatchEvent(new Event('sml-live-data'));
    }
  }
  /* Push feed: every trade and quote as it happens (Server-Sent Events from the shared Massive connection). The polling above keeps running as the fallback and for the Level 2 ladder. */
  const sse = { es: null, symbol: '', okAt: 0, tape: [], seen: new Set(), retryAt: 0, raf: 0 };
  function closeStream() { if (sse.es) { try { sse.es.close(); } catch (_) { /* closing */ } } sse.es = null; }
  function schedulePaint() {
    if (sse.raf) return;
    sse.raf = requestAnimationFrame(() => {
      sse.raf = 0;
      const book = st.lastBook && st.lastBook.book ? st.lastBook.book : { bids: [], asks: [] };
      const last = sse.tape.length ? sse.tape[0].price : (st.lastBook && st.lastBook.last);
      paintQuote({ book, last, rt: st.rt });
      if (sse.tape.length) paintTape(sse.tape);
    });
  }
  function onTrade(t) {
    sse.okAt = Date.now();
    if (window.smlChartGesture || !t || !Number.isFinite(t.price)) return; // a finger is on the chart: the poll catches these up afterwards
    if (t.t < st.lastT) return;
    const key = t.t + '|' + t.price + '|' + t.size; if (sse.seen.has(key)) return;
    sse.seen.add(key); if (sse.seen.size > 300) sse.seen.delete(sse.seen.values().next().value);
    if (window.smlChartPro && window.smlChartPro.liveTick) window.smlChartPro.liveTick(t.price, t.size, t.t);
    st.lastT = Math.max(st.lastT, t.t); st.freshAt = Date.now();
    sse.tape.unshift(t); if (sse.tape.length > 30) sse.tape.length = 30;
    schedulePaint();
  }
  function openStream() {
    const symbol = sym();
    if (sse.es && sse.symbol === symbol) return;
    if (!sse.es && Date.now() < sse.retryAt && sse.symbol === symbol) return;
    closeStream(); if (!window.EventSource) return;
    sse.symbol = symbol; sse.tape = []; sse.seen = new Set();
    let es; try { es = new EventSource('/academy-activity/stream?symbol=' + encodeURIComponent(symbol)); } catch (_) { sse.retryAt = Date.now() + 60000; return; }
    sse.es = es;
    es.addEventListener('snapshot', (e) => { try { const d = JSON.parse(e.data); sse.okAt = Date.now(); if (d && d.rt) st.rt = d.rt; if (d && d.tape && d.tape.length) sse.tape = d.tape.slice(0, 30); } catch (_) { /* ignore */ } });
    es.addEventListener('trade', (e) => { try { onTrade(JSON.parse(e.data)); } catch (_) { /* ignore */ } });
    es.addEventListener('quote', (e) => { try { const q = JSON.parse(e.data); sse.okAt = Date.now(); st.rt = { bid: q.bid, ask: q.ask, bs: q.bs, as: q.as, t: q.t, fresh: true }; if (!window.smlChartGesture) schedulePaint(); } catch (_) { /* ignore */ } });
    es.onerror = () => { if (es.readyState === 2) { if (sse.es === es) sse.es = null; sse.retryAt = Date.now() + 30000; } };
  }
  (function loop() { if (st.deferred && !window.smlChartGesture) { const d = st.deferred; st.deferred = null; apply(d); } if (!document.hidden) openStream(); const pushing = sse.es && Date.now() - sse.okAt < 5000; const wait = document.hidden ? 4000 : st.failures ? Math.min(8000, 1500 * st.failures) : pushing ? 2500 : 700; once().finally(() => setTimeout(loop, wait)); })();
})();
