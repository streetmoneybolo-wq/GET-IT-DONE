/* S.I.R.E. live momentum panel for the Academy Live Chart Lab.
   A SIRE button beside SMC opens a panel on the right of the chart; the chart shifts left to make room.
   Columns: TICKER · S.I.R.E. (3-minute %) · 1M % (the last minute's burst) · RVOL (volume vs normal) · DAY %.
   Every cell flashes neon green when its value rises and bright red when it falls. Tapping a column header
   ranks by that column (tap again to flip the order); tapping a row loads that ticker on the chart.
   Data: the Academy scanner feed (/academy-activity/scanner), refreshed every 2 s while the panel is open. */
(() => {
  if (window.__smlSirePanel) return;
  window.__smlSirePanel = 1;
  const KEY = 'sml-sire-open';
  const COLS = [
    ['symbol', 'TICKER', (r) => r.symbol],
    ['sire', 'S.I.R.E', (r) => num(r.changeRate3min)],
    ['m1', '1M %', (r) => num(r.changeRate1min)],
    ['rvol', 'RVOL', (r) => num(r.rvol) || num(r.volumeRatio)],
    ['day', 'DAY %', (r) => num(r.changePct)]
  ];
  const S = { open: false, sort: 'sire', dir: -1, rows: [], prev: new Map(), timer: 0, busy: false };
  try { S.open = localStorage.getItem(KEY) === '1'; } catch (_) { /* storage can be blocked inside Discord */ }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  const fmt = (key, v) => {
    if (key === 'symbol') return v;
    if (v == null) return '–';
    if (key === 'rvol') return v.toFixed(v >= 10 ? 0 : 1) + '×';
    return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 1 : 2);
  };

  const css = document.createElement('style');
  css.textContent = '#sire-toggle{margin-left:4px;padding:5px 9px;border:1px solid #1f7a55;border-radius:7px;background:#07180f;color:#5dffb0;font:900 .64rem ui-monospace,monospace;letter-spacing:.08em;cursor:pointer}#sire-toggle.on{background:#39ff14;border-color:#39ff14;color:#031a03}'
    + 'body.sire-open main .chart{grid-template-columns:minmax(0,1fr) var(--sire-w,300px)!important}body.sire-open main .chart>*{grid-column:1/-1}'
    + 'body.sire-open main .chart>.academy-chart-stage,body.sire-open main .chart>canvas#chart,body.sire-open main .chart>.intervals{grid-column:1}'
    + '#sire-panel{display:none;grid-column:2!important;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;margin-left:4px;border:1px solid #1d4a37;border-radius:8px;background:#050b08;color:#e9f7f0;font:700 .66rem ui-monospace,monospace;scrollbar-width:thin}'
    + 'body.sire-open #sire-panel{display:block}'
    + '#sire-panel header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:6px 7px;background:#07130d;border-bottom:1px solid #1d4a37}#sire-panel header b{color:#39ff14;letter-spacing:.08em}#sire-panel header small{margin-left:auto;color:#6f8f80;font-weight:600}#sire-panel header i{width:6px;height:6px;border-radius:50%;background:#39ff14;box-shadow:0 0 8px #39ff14}'
    + '#sire-panel table{width:100%;border-collapse:collapse;table-layout:fixed}#sire-panel th{position:sticky;top:29px;z-index:1;padding:5px 3px;background:#07130d;color:#8fb8a4;font-size:.56rem;text-align:right;cursor:pointer;white-space:nowrap;border-bottom:1px solid #1d4a37;user-select:none}#sire-panel th:first-child,#sire-panel td:first-child{text-align:left;padding-left:6px}'
    + '#sire-panel th.on{color:#39ff14}#sire-panel th.on:after{content:" ▼";font-size:.5rem}#sire-panel th.on.asc:after{content:" ▲"}'
    + '#sire-panel td{padding:4px 3px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:clip;border-bottom:1px solid rgba(29,74,55,.45);transition:background-color .6s ease,color .6s ease}'
    + '#sire-panel tr{cursor:pointer}#sire-panel tr:hover td{background:rgba(57,255,20,.06)}#sire-panel tr.cur td:first-child{color:#39ff14}'
    + '#sire-panel td.pos{color:#39ff14}#sire-panel td.neg{color:#ff1744}'
    + '#sire-panel td.flash-up{background:#39ff14!important;color:#021a02!important;transition:none}#sire-panel td.flash-down{background:#ff1744!important;color:#fff!important;transition:none}'
    + '#sire-panel .sire-empty{padding:14px 8px;color:#8fb8a4;font-weight:600;line-height:1.45;text-align:center}'
    + '@media(max-width:720px){body.sire-open{--sire-w:176px}#sire-panel{font-size:.58rem;margin-left:3px}#sire-panel th{font-size:.46rem;padding:4px 1px;top:25px;letter-spacing:-.02em}#sire-panel th.on:after{content:""}#sire-panel td{padding:3px 2px}#sire-panel header{padding:4px 5px}#sire-panel header small{display:none}'
    + 'main .toolbar #sire-toggle{order:2;height:20px;padding:0 7px;font-size:.54rem;line-height:18px}}';
  document.head.appendChild(css);

  function boot(tries) {
    const toolbar = document.querySelector('main .toolbar');
    const chart = document.querySelector('main .chart');
    if (!toolbar || !chart) { if (tries < 80) setTimeout(() => boot(tries + 1), 150); return; }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'sire-toggle'; btn.textContent = 'SIRE';
    btn.title = 'Live S.I.R.E. momentum ranking: 3-minute %, 1-minute %, relative volume and day %';
    const smc = document.getElementById('smc-toggle');
    if (smc && smc.parentElement === toolbar) smc.insertAdjacentElement('afterend', btn); else toolbar.appendChild(btn);

    const panel = document.createElement('aside');
    panel.id = 'sire-panel'; panel.setAttribute('aria-label', 'Live S.I.R.E. momentum ranking');
    panel.innerHTML = '<header><i></i><b>S.I.R.E. LIVE</b><small>tap a column to rank</small></header><table><colgroup><col style="width:23%"><col style="width:21%"><col style="width:19%"><col style="width:17%"><col style="width:20%"></colgroup><thead><tr>'
      + COLS.map(([k, label]) => '<th data-k="' + k + '">' + label + '</th>').join('') + '</tr></thead><tbody></tbody></table><div class="sire-empty" hidden>Waiting for the live scanner…</div>';
    chart.appendChild(panel);
    const tbody = panel.querySelector('tbody'), empty = panel.querySelector('.sire-empty');

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

    function setOpen(open) {
      S.open = open;
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (_) { /* ignore */ }
      btn.classList.toggle('on', open);
      document.body.classList.toggle('sire-open', open);
      if (open) { placeRows(); render(); tick(); } else clearRows();
      window.dispatchEvent(new Event('resize')); // the chart re-measures its narrower column
    }
    btn.addEventListener('click', () => setOpen(!S.open));
    panel.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th'); if (!th) return;
      const k = th.dataset.k;
      if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = k === 'symbol' ? 1 : -1; }
      render();
    });
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-s]'); if (!tr) return;
      if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(tr.dataset.s);
    });

    const chartSymbol = () => String(new URLSearchParams(location.search).get('symbol') || (document.getElementById('symbol') || {}).value || '').toUpperCase();
    function render() {
      if (!S.open) return;
      panel.querySelectorAll('th').forEach((th) => { th.classList.toggle('on', th.dataset.k === S.sort); th.classList.toggle('asc', th.dataset.k === S.sort && S.dir > 0); });
      const col = COLS.find((c) => c[0] === S.sort) || COLS[1];
      const rows = S.rows.filter((r) => r && r.symbol).slice();
      rows.sort((a, b) => {
        const x = col[2](a), y = col[2](b);
        if (col[0] === 'symbol') return String(x).localeCompare(String(y)) * S.dir;
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (x - y) * S.dir;
      });
      const top = rows.slice(0, 40), cur = chartSymbol();
      empty.hidden = top.length > 0;
      const existing = new Map(Array.from(tbody.children).map((tr) => [tr.dataset.s, tr]));
      const frag = document.createDocumentFragment();
      for (const r of top) {
        let tr = existing.get(r.symbol);
        if (!tr) { tr = document.createElement('tr'); tr.dataset.s = r.symbol; tr.innerHTML = COLS.map(() => '<td></td>').join(''); }
        existing.delete(r.symbol);
        tr.classList.toggle('cur', r.symbol === cur);
        const before = S.prev.get(r.symbol) || {};
        const now = {};
        COLS.forEach(([k, , get], i) => {
          const td = tr.children[i], v = get(r);
          now[k] = v;
          td.textContent = fmt(k, v);
          if (k === 'symbol') return;
          td.classList.toggle('pos', v != null && (k === 'rvol' ? v >= 2 : v > 0));
          td.classList.toggle('neg', v != null && k !== 'rvol' && v < 0);
          const was = before[k];
          if (v != null && was != null && v !== was) {
            td.classList.remove('flash-up', 'flash-down'); void td.offsetWidth;
            td.classList.add(v > was ? 'flash-up' : 'flash-down');
            clearTimeout(td._t); td._t = setTimeout(() => td.classList.remove('flash-up', 'flash-down'), 650);
          }
        });
        S.prev.set(r.symbol, now);
        frag.appendChild(tr);
      }
      existing.forEach((tr) => tr.remove());
      tbody.appendChild(frag);
    }

    function take(rows) { if (Array.isArray(rows) && rows.length) { S.rows = rows; render(); } }
    async function tick() {
      if (!S.open || S.busy || document.hidden) return;
      S.busy = true;
      try {
        const res = await fetch('/academy-activity/scanner', { cache: 'no-store' });
        const body = await res.json();
        if (res.ok && body && Array.isArray(body.rows)) take(body.rows);
      } catch (_) { /* the next tick retries */ }
      S.busy = false;
    }
    window.addEventListener('sml-academy-scanner-update', () => { if (window.smlAcademyScannerRows) take(window.smlAcademyScannerRows()); });
    window.addEventListener('popstate', render);
    window.addEventListener('resize', () => { if (S.open) placeRows(); });
    S.timer = setInterval(tick, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    if (window.smlAcademyScannerRows) take(window.smlAcademyScannerRows());
    if (S.open) setOpen(true);
    window.smlSirePanel = { state: S, open: () => setOpen(true), close: () => setOpen(false) };
  }
  boot(0);
})();
