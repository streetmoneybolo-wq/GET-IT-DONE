/* S.I.R.E. live momentum panel for the Academy Live Chart Lab.
   A SIRE button beside SMC opens a panel on the right of the chart; the chart shifts left to make room.
   Columns: TICKER · LAST · S.I.R.E. (3-minute %) · 1M % (the last minute's burst) · RVOL (volume vs normal) · DAY %.
   Cells stay the plain panel colour; a cell only flashes, neon green when its value rises or bright red when it falls, at the moment it changes.
   Tapping a column header ranks by that column (tap again to flip the order); tapping a row loads that ticker on the chart.
   Data: the live feed at /academy-activity/sire-stream (Server-Sent Events read through fetch, so the session header rides along):
   one snapshot, then only the cells that moved, trade by trade for the strongest movers. Cells are patched in place — never rebuilt —
   so each flash lands on exactly the cell that changed, and rows glide to their new rank instead of jumping. If the stream is not
   available the panel polls /academy-activity/scanner every 2 s, as before. */
(() => {
  if (window.__smlSirePanel) return;
  window.__smlSirePanel = 1;
  const KEY = 'sml-sire-open';
  const STREAM_URL = '/academy-activity/sire-stream';
  const POLL_URL = '/academy-activity/scanner';
  const TOP = 40;
  const COLS = [
    ['symbol', 'TICKER', (r) => r.symbol],
    ['last', 'LAST', (r) => num(r.price)],
    ['sire', 'S.I.R.E', (r) => num(r.changeRate3min)],
    ['m1', '1M %', (r) => num(r.changeRate1min)],
    ['rvol', 'RVOL', (r) => num(r.rvol) != null ? num(r.rvol) : num(r.volumeRatio)],
    ['day', 'DAY %', (r) => num(r.changePct)]
  ];
  const S = { open: false, sort: 'sire', dir: -1, rows: new Map(), shown: new Map(), timer: 0, busy: false, mode: 'idle', okAt: 0, stream: null, retryAt: 0, fails: 0, sortAt: 0, sortTimer: 0, frame: 0, dirty: new Set() };
  try { S.open = localStorage.getItem(KEY) === '1'; } catch (_) { /* storage can be blocked inside Discord */ }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  const fmt = (key, v) => {
    if (key === 'symbol') return v;
    if (v == null) return '–';
    if (key === 'last') return v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
    if (key === 'rvol') return v.toFixed(v >= 10 ? 0 : 1) + '×';
    return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 1 : 2);
  };
  /* A feed row (compact keys) or a scanner row, normalised to one shape. */
  const norm = (r) => r && (r.s || r.symbol) ? {
    symbol: String(r.s || r.symbol).toUpperCase(),
    price: num(r.p != null ? r.p : r.price), changePct: num(r.c != null ? r.c : r.changePct),
    changeRate3min: num(r.r3 != null ? r.r3 : r.changeRate3min), changeRate1min: num(r.r1 != null ? r.r1 : r.changeRate1min),
    rvol: num(r.rv != null ? r.rv : (r.rvol != null ? r.rvol : r.volumeRatio)), t: num(r.t) || 0
  } : null;

  const css = document.createElement('style');
  css.textContent = '#sire-toggle{margin-left:4px;padding:5px 9px;border:1px solid #1f7a55;border-radius:7px;background:#07180f;color:#5dffb0;font:900 .64rem ui-monospace,monospace;letter-spacing:.08em;cursor:pointer}#sire-toggle.on{background:#39ff14;border-color:#39ff14;color:#031a03}'
    + 'body.sire-open main .chart{grid-template-columns:minmax(0,1fr) var(--sire-w,332px)!important}body.sire-open main .chart>*{grid-column:1/-1}'
    + 'body.sire-open main .chart>.academy-chart-stage,body.sire-open main .chart>canvas#chart,body.sire-open main .chart>.intervals{grid-column:1}'
    + '#sire-panel{display:none;grid-column:2!important;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;margin-left:4px;border:1px solid #1d4a37;border-radius:8px;background:#050b08;color:#e9f7f0;font:700 .66rem ui-monospace,monospace;scrollbar-width:thin}'
    + 'body.sire-open #sire-panel{display:block}'
    + '#sire-panel header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:6px 7px;background:#07130d;border-bottom:1px solid #1d4a37}#sire-panel header b{color:#39ff14;letter-spacing:.08em}#sire-panel header small{margin-left:auto;color:#6f8f80;font-weight:600;letter-spacing:.04em}'
    + '#sire-panel header i{width:6px;height:6px;border-radius:50%;background:#6f8f80;transition:background .3s,box-shadow .3s}#sire-panel.live header i{background:#39ff14;box-shadow:0 0 8px #39ff14;animation:sire-pulse 1.6s ease-in-out infinite}#sire-panel.poll header i{background:#ffb020;box-shadow:0 0 6px #ffb020}#sire-panel.down header i{background:#ff1744}'
    + '@keyframes sire-pulse{0%,100%{opacity:1}50%{opacity:.45}}'
    + '#sire-panel table{width:100%;border-collapse:collapse;table-layout:fixed}#sire-panel th{position:sticky;top:29px;z-index:1;padding:5px 3px;background:#07130d;color:#8fb8a4;font-size:.56rem;text-align:right;cursor:pointer;white-space:nowrap;border-bottom:1px solid #1d4a37;user-select:none}#sire-panel th:first-child,#sire-panel td:first-child{text-align:left;padding-left:6px}'
    + '#sire-panel th.on{color:#39ff14}#sire-panel th.on:after{content:" ▼";font-size:.5rem}#sire-panel th.on.asc:after{content:" ▲"}'
    + '#sire-panel td{padding:4px 3px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:clip;border-bottom:1px solid rgba(29,74,55,.45);transition:background-color .7s ease-out,color .7s ease-out}'
    + '#sire-panel tr{cursor:pointer;will-change:transform}#sire-panel tr.move{transition:transform .45s cubic-bezier(.2,.7,.2,1)}#sire-panel tr:hover td{background:rgba(57,255,20,.06)}#sire-panel tr.cur td:first-child{color:#39ff14}'
    + '#sire-panel td.flash-up{background:#39ff14!important;color:#021a02!important;transition:none}#sire-panel td.flash-down{background:#ff1744!important;color:#fff!important;transition:none}'
    + '#sire-panel .sire-empty{padding:14px 8px;color:#8fb8a4;font-weight:600;line-height:1.45;text-align:center}'
    + '@media(max-width:720px){body.sire-open{--sire-w:176px}#sire-panel{font-size:.58rem;margin-left:3px}#sire-panel th{font-size:.46rem;padding:4px 1px;top:25px;letter-spacing:-.02em}#sire-panel th.on:after{content:""}#sire-panel td{padding:3px 2px}#sire-panel header{padding:4px 5px}#sire-panel header small{display:none}'
    + '#sire-panel .c-last{display:none}main .toolbar #sire-toggle{order:2;height:20px;padding:0 7px;font-size:.54rem;line-height:18px}}';
  document.head.appendChild(css);

  function boot(tries) {
    const toolbar = document.querySelector('main .toolbar');
    const chart = document.querySelector('main .chart');
    if (!toolbar || !chart) { if (tries < 80) setTimeout(() => boot(tries + 1), 150); return; }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'sire-toggle'; btn.textContent = 'SIRE';
    btn.title = 'Live S.I.R.E. momentum ranking: last price, 3-minute %, 1-minute %, relative volume and day %';
    const smc = document.getElementById('smc-toggle');
    if (smc && smc.parentElement === toolbar) smc.insertAdjacentElement('afterend', btn); else toolbar.appendChild(btn);

    const panel = document.createElement('aside');
    panel.id = 'sire-panel'; panel.setAttribute('aria-label', 'Live S.I.R.E. momentum ranking');
    panel.innerHTML = '<header><i></i><b>S.I.R.E. LIVE</b><small>connecting…</small></header><table><colgroup><col style="width:20%"><col class="c-last" style="width:17%"><col style="width:17%"><col style="width:15%"><col style="width:14%"><col style="width:17%"></colgroup><thead><tr>'
      + COLS.map(([k, label]) => '<th class="c-' + k + '" data-k="' + k + '">' + label + '</th>').join('') + '</tr></thead><tbody></tbody></table><div class="sire-empty" hidden>Waiting for the live scanner…</div>';
    chart.appendChild(panel);
    const tbody = panel.querySelector('tbody'), empty = panel.querySelector('.sire-empty'), note = panel.querySelector('header small');

    /* The panel sits beside the candle stage (and the interval row under it on a phone), never beside the toolbar. */
    function placeRows() {
      const stage = chart.querySelector(':scope > .academy-chart-stage') || chart.querySelector(':scope > canvas#chart');
      if (!stage) return;
      const kids = Array.from(chart.children).filter((el) => el !== panel && getComputedStyle(el).display !== 'none' && getComputedStyle(el).position !== 'absolute' && getComputedStyle(el).position !== 'fixed');
      const row = kids.indexOf(stage) + 1;
      const after = kids.slice(row).length;
      if (row > 0) panel.style.gridRow = row + ' / span ' + Math.max(1, after + 1);
      kids.forEach((el, i) => { el.style.gridRow = String(i + 1); });
    }
    function clearRows() { Array.from(chart.children).forEach((el) => { el.style.gridRow = ''; }); }

    function setMode(mode, text) {
      S.mode = mode;
      panel.classList.toggle('live', mode === 'live'); panel.classList.toggle('poll', mode === 'poll'); panel.classList.toggle('down', mode === 'down');
      note.textContent = text || (mode === 'live' ? 'streaming · tap a column to rank' : mode === 'poll' ? 'refreshing every 2 s' : mode === 'down' ? 'reconnecting…' : 'connecting…');
    }

    function setOpen(open) {
      S.open = open;
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (_) { /* ignore */ }
      btn.classList.toggle('on', open);
      document.body.classList.toggle('sire-open', open);
      if (open) { placeRows(); render(true); connect(); tick(); } else { clearRows(); closeStream(); }
      window.dispatchEvent(new Event('resize')); // the chart re-measures its narrower column
    }
    btn.addEventListener('click', () => setOpen(!S.open));
    panel.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th'); if (!th) return;
      const k = th.dataset.k;
      if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = k === 'symbol' ? 1 : -1; }
      render(true);
    });
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-s]'); if (!tr) return;
      if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(tr.dataset.s);
    });

    const chartSymbol = () => String(new URLSearchParams(location.search).get('symbol') || (document.getElementById('symbol') || {}).value || '').toUpperCase();

    function ranked() {
      const col = COLS.find((c) => c[0] === S.sort) || COLS[2];
      const list = Array.from(S.rows.values());
      list.sort((a, b) => {
        const x = col[2](a), y = col[2](b);
        if (col[0] === 'symbol') return String(x).localeCompare(String(y)) * S.dir;
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (x - y) * S.dir || a.symbol.localeCompare(b.symbol);
      });
      return list.slice(0, TOP);
    }

    function flash(td, up) {
      td.classList.remove('flash-up', 'flash-down'); void td.offsetWidth;
      td.classList.add(up ? 'flash-up' : 'flash-down');
      clearTimeout(td._t); td._t = setTimeout(() => td.classList.remove('flash-up', 'flash-down'), 700);
    }

    /* Writes one row's cells, flashing only a cell whose value moved. `was` is what the cells show now. */
    function paint(tr, r, was, quiet) {
      const now = {};
      COLS.forEach(([k, , get], i) => {
        const td = tr.children[i], v = get(r);
        now[k] = v;
        const text = fmt(k, v);
        if (td.textContent !== text) td.textContent = text;
        if (k === 'symbol' || quiet) return;
        const old = was ? was[k] : undefined;
        if (v != null && old != null && v !== old) flash(td, v > old);
      });
      S.shown.set(r.symbol, now);
    }

    /* Full pass: rank, add/remove rows, and glide moved rows to their new place (FLIP). */
    function render(immediate) {
      if (!S.open) return;
      panel.querySelectorAll('th').forEach((th) => { th.classList.toggle('on', th.dataset.k === S.sort); th.classList.toggle('asc', th.dataset.k === S.sort && S.dir > 0); });
      const top = ranked(), cur = chartSymbol();
      empty.hidden = top.length > 0 || S.mode === 'idle';
      const existing = new Map(Array.from(tbody.children).map((tr) => [tr.dataset.s, tr]));
      const before = new Map();
      if (!immediate) existing.forEach((tr, s) => before.set(s, tr.getBoundingClientRect().top));
      const frag = document.createDocumentFragment();
      for (const r of top) {
        let tr = existing.get(r.symbol), fresh = false;
        if (!tr) { tr = document.createElement('tr'); tr.dataset.s = r.symbol; tr.innerHTML = COLS.map(([k]) => '<td class="c-' + k + '"></td>').join(''); fresh = true; }
        existing.delete(r.symbol);
        tr.classList.toggle('cur', r.symbol === cur);
        paint(tr, r, fresh ? null : S.shown.get(r.symbol), fresh);
        frag.appendChild(tr);
      }
      existing.forEach((tr, s) => { tr.remove(); S.shown.delete(s); });
      tbody.appendChild(frag);
      S.dirty.clear();
      S.sortAt = Date.now();
      if (immediate || !before.size) return;
      const moved = [];
      Array.from(tbody.children).forEach((tr) => {
        const from = before.get(tr.dataset.s); if (from == null) return;
        const d = from - tr.getBoundingClientRect().top;
        if (Math.abs(d) < 1) return;
        tr.classList.remove('move'); tr.style.transform = 'translateY(' + d + 'px)'; moved.push(tr);
      });
      if (!moved.length) return;
      requestAnimationFrame(() => { moved.forEach((tr) => { tr.classList.add('move'); tr.style.transform = ''; }); setTimeout(() => moved.forEach((tr) => tr.classList.remove('move')), 500); });
    }

    /* Cheap pass between rankings: only the rows that ticked are touched, in place, so the flash lands on the moved cell. */
    function patchFrame() {
      S.frame = 0;
      if (!S.open) { S.dirty.clear(); return; }
      let needsRank = false;
      for (const s of S.dirty) {
        const r = S.rows.get(s), tr = tbody.querySelector('tr[data-s="' + s + '"]');
        if (!r) { if (tr) { tr.remove(); S.shown.delete(s); } continue; }
        if (!tr) { needsRank = true; continue; }
        paint(tr, r, S.shown.get(s), false);
      }
      S.dirty.clear();
      /* Re-rank at most once a second and only when the order can have changed, so rows glide instead of jitter. */
      const since = Date.now() - S.sortAt;
      if (needsRank || since > 1000) render(false);
      else if (!S.sortTimer) S.sortTimer = setTimeout(() => { S.sortTimer = 0; if (S.open) render(false); }, 1000 - since);
    }
    function schedule() { if (!S.frame) S.frame = requestAnimationFrame(patchFrame); }

    function replaceAll(list) {
      const next = new Map();
      for (const raw of list) { const r = norm(raw); if (r) next.set(r.symbol, r); }
      if (!next.size) return;
      S.rows = next;
      for (const s of S.shown.keys()) if (!next.has(s)) S.dirty.add(s);
      next.forEach((r, s) => { if (S.shown.has(s)) S.dirty.add(s); });
      render(!tbody.children.length);
    }
    function applyTicks(list) {
      for (const u of list) {
        if (!u || !u.s) continue;
        const s = String(u.s).toUpperCase();
        if (u.gone) { S.rows.delete(s); S.dirty.add(s); continue; }
        const r = S.rows.get(s) || { symbol: s, price: null, changePct: null, changeRate3min: null, changeRate1min: null, rvol: null, t: 0 };
        if (u.p !== undefined) r.price = num(u.p);
        if (u.c !== undefined) r.changePct = num(u.c);
        if (u.r3 !== undefined) r.changeRate3min = num(u.r3);
        if (u.r1 !== undefined) r.changeRate1min = num(u.r1);
        if (u.rv !== undefined) r.rvol = num(u.rv);
        if (u.t !== undefined) r.t = num(u.t) || r.t;
        S.rows.set(s, r); S.dirty.add(s);
      }
      schedule();
    }

    /* ---- the stream: SSE over fetch, so the Academy session header (added by the gate) rides along ---- */
    function closeStream() { if (S.stream) { try { S.stream.abort(); } catch (_) { /* closing */ } S.stream = null; } }
    async function connect() {
      if (!S.open || S.stream || document.hidden || !window.fetch || !window.ReadableStream || !window.AbortController) return;
      if (Date.now() < S.retryAt) return;
      const ctl = new AbortController(); S.stream = ctl;
      let res;
      try { res = await fetch(STREAM_URL, { cache: 'no-store', headers: { accept: 'text/event-stream' }, signal: ctl.signal }); }
      catch (_) { res = null; }
      if (!res || !res.ok || !res.body || !/text\/event-stream/.test(res.headers.get('content-type') || '')) {
        if (S.stream === ctl) S.stream = null;
        S.fails += 1; S.retryAt = Date.now() + (res && (res.status === 503 || res.status === 403) ? 60000 : Math.min(30000, 1000 * 2 ** Math.min(S.fails, 5)));
        setMode('poll'); tick();
        return;
      }
      setMode('live'); S.fails = 0; S.okAt = Date.now();
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n'); buf = parts.pop();
          for (const part of parts) {
            let event = 'message', data = '';
            for (const line of part.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
            S.okAt = Date.now();
            if (!data) continue;
            let body; try { body = JSON.parse(data); } catch (_) { continue; }
            if (event === 'snapshot' && body && Array.isArray(body.rows)) { replaceAll(body.rows); setMode('live', body.live ? 'streaming · tap a column to rank' : 'live scanner · tap a column to rank'); }
            else if (event === 'tick' && body && Array.isArray(body.rows)) applyTicks(body.rows);
            else if (event === 'error') break;
          }
        }
      } catch (_) { /* aborted or dropped: the loop below reconnects */ }
      if (S.stream === ctl) S.stream = null;
      if (S.open && !ctl.signal.aborted) { setMode('down'); S.retryAt = Date.now() + 1500; }
    }

    /* ---- the fallback poll (also the first paint while the stream connects) ---- */
    function take(rows) { if (Array.isArray(rows) && rows.length) replaceAll(rows); }
    async function tick() {
      if (!S.open || S.busy || document.hidden) return;
      if (S.mode === 'live' && Date.now() - S.okAt < 8000) return;
      S.busy = true;
      try {
        const res = await fetch(POLL_URL, { cache: 'no-store' });
        const body = await res.json();
        /* A stream that came up while this poll was in flight owns the rows now. */
        const streaming = S.mode === 'live' && Date.now() - S.okAt < 8000;
        if (res.ok && body && Array.isArray(body.rows) && !streaming) { take(body.rows); if (S.mode !== 'live') setMode('poll'); }
      } catch (_) { /* the next tick retries */ }
      S.busy = false;
    }
    window.addEventListener('sml-academy-scanner-update', () => { if (S.mode !== 'live' && window.smlAcademyScannerRows) take(window.smlAcademyScannerRows()); });
    window.addEventListener('popstate', () => render(true));
    window.addEventListener('resize', () => { if (S.open) placeRows(); });
    S.timer = setInterval(() => { if (!S.open || document.hidden) return; connect(); tick(); }, 2000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) closeStream(); else { S.retryAt = 0; connect(); tick(); } });
    if (window.smlAcademyScannerRows) take(window.smlAcademyScannerRows());
    if (S.open) setOpen(true);
    window.smlSirePanel = { state: S, open: () => setOpen(true), close: () => setOpen(false) };
  }
  boot(0);
})();
