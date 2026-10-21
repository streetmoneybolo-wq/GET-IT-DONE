/* Chart dock: the tool info panels (MEM ALGO, SMC map, Pattern scanner, Interval stats) open in a column beside the plot
 * instead of floating over the candles. The plot gets narrower while a panel is open and is never covered. The same grid
 * trick the S.I.R.E. panel uses (a second column on main .chart); with S.I.R.E. open too there are three columns.
 * Also the CLEAN switch (key H on the chart): hides every overlay in the stage, the dock and the corner buttons so only the
 * candles, the axes and the drawings remain. Phones keep their bottom sheets: nothing docks under 900 px. */
(function boot(tries) {
  if (window.__smlChartDock) return;
  const chart = document.querySelector('main .chart'), stage = document.querySelector('.academy-chart-stage');
  if (!chart || !stage) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlChartDock = true;

  const DOCKABLE = ['#mem-algo-panel', '#smc-card', '.academy-pro-panel', '.academy-interval-stats', '#intent-panel', '#opt-mini'];
  /* The dock takes about a third of the chart section (260 to 340 px) and only when the plot keeps at least 360 px; otherwise
     (phones, a narrow Activity with S.I.R.E. open) the panels float as before. */
  const SIRE_W = 332, MIN_PLOT = 360;
  /* CHART LOCK (academy-chart-lock.js): under the strict rule nothing may shrink the plot, so there is never room to dock */
  const locked = () => !!(window.smlChartLock && typeof window.smlChartLock.on === 'function' && window.smlChartLock.on());
  const room = () => {
    const avail = (chart.clientWidth || innerWidth) - (document.body.classList.contains('sire-open') ? SIRE_W : 0);
    const dockW = Math.min(340, Math.max(260, Math.round(avail * 0.36)));
    return { dockW, ok: !locked() && innerWidth >= 900 && avail - dockW >= MIN_PLOT };
  };
  const narrow = () => !room().ok;
  const CLEAN_KEY = 'sml-chart-clean';
  const css = document.createElement('style');
  css.textContent = 'body.dock-open main .chart{grid-template-columns:minmax(0,1fr) var(--dock-w,340px)!important}'
    + 'body.dock-open main .chart>.toolbar,body.dock-open main .chart>.academy-chart-tools,body.dock-open main .chart>#academy-tick-note{grid-column:1/-1!important}'
    + 'body.dock-open main .chart>.academy-chart-stage{grid-column:1!important}'
    + 'body.sire-open.dock-open main .chart{grid-template-columns:minmax(0,1fr) var(--dock-w,340px) var(--sire-w,332px)!important}'
    + 'body.sire-open.dock-open #sire-panel{grid-column:3!important}'
    + '#chart-dock{display:none;grid-column:2!important;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;margin-left:4px;flex-direction:column;gap:6px;scrollbar-width:thin}'
    + 'body.dock-open #chart-dock{display:flex}'
    /* nothing in the dock may be wider than the dock: it wraps instead of being cut off behind a sideways scroll bar */
    + '#chart-dock>*{min-width:0!important;max-width:100%!important;box-sizing:border-box;overflow-wrap:anywhere}#chart-dock button,#chart-dock select,#chart-dock input{max-width:100%;min-width:0}#chart-dock .om-row,#chart-dock .row{flex-wrap:wrap}#chart-dock .om-row>button{flex:1 1 7rem;white-space:normal}'
    + '#chart-dock>*{position:static!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;width:auto!important;max-width:none!important;max-height:none!important;margin:0!important;flex:0 0 auto;box-shadow:none!important}'
    + '#chart-dock>.academy-pro-panel.open{display:flex!important}#chart-dock>.academy-pro-panel .plist{max-height:46vh}'
    + '#chart-dock>#mem-algo-panel.open{display:block!important}'
    /* CLEAN: candles, axes and drawings only */
    + '#academy-chart-clean.on{background:#00c47d!important;color:#032318!important}'
    + 'body.chart-clean .academy-chart-stage>:not(canvas):not(.academy-pro-zone){display:none!important}'
    + 'body.chart-clean #chart-dock{display:none!important}'
    + 'body.chart-clean.dock-open:not(.sire-open) main .chart{grid-template-columns:minmax(0,1fr)!important}'
    + 'body.chart-clean.dock-open.sire-open main .chart{grid-template-columns:minmax(0,1fr) var(--sire-w,332px)!important}body.chart-clean.dock-open.sire-open #sire-panel{grid-column:2!important}'
    + 'body.chart-clean #lb-btn,body.chart-clean #academy-alerts-fab,body.chart-clean #sml-sig-fab,body.chart-clean #aa-btn,body.chart-clean #sml-pop-bar,body.chart-clean #sml-pt-stack{opacity:.15;transition:opacity .2s}'
    + 'body.chart-clean #lb-btn:hover,body.chart-clean #academy-alerts-fab:hover,body.chart-clean #sml-sig-fab:hover,body.chart-clean #aa-btn:hover,body.chart-clean #sml-pop-bar:hover,body.chart-clean #sml-pt-stack:hover{opacity:1}';
  document.head.appendChild(css);

  const dock = document.createElement('aside');
  dock.id = 'chart-dock'; dock.setAttribute('aria-label', 'Chart tool panels');
  chart.appendChild(dock);

  const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
  const fire = () => { setTimeout(() => dispatchEvent(new Event('resize')), 30); setTimeout(() => dispatchEvent(new Event('resize')), 400); };
  let wasOpen = false;
  function undock(el) {
    const h = el.__smlHome; if (!h || !h.parent) return;
    if (h.next && h.next.parentElement === h.parent) h.parent.insertBefore(el, h.next); else h.parent.appendChild(el);
    el.__smlHome = null;
  }
  function sweep() {
    const r = room();
    chart.style.setProperty('--dock-w', r.dockW + 'px');
    if (!r.ok) { [...dock.children].forEach(undock); }
    else {
      for (const sel of DOCKABLE) {
        /* the quote column is the tool window (academy-side-window.js): it keeps the SMC card and the MEM ALGO panel */
        if (document.body.classList.contains('sml-sw') && (sel === '#smc-card' || sel === '#mem-algo-panel' || sel === '#intent-panel')) continue;
        const el = document.querySelector(sel);
        if (!el || el.parentElement === dock || !visible(el)) continue;
        el.__smlHome = { parent: el.parentElement, next: el.nextSibling };
        dock.appendChild(el);
      }
    }
    const open = !narrow() && [...dock.children].some(visible);
    document.body.classList.toggle('dock-open', open);
    if (open !== wasOpen) { wasOpen = open; fire(); }
  }
  let queued = false;
  const queue = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; sweep(); }, 120); };
  /* panels with their own placement logic (MEM ALGO's place()) ask the dock first: when the dock has room it owns the panel */
  window.smlChartDock = { room: () => room().ok, holds: (el) => !!el && el.parentElement === dock, dock };
  new MutationObserver(queue).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true });
  window.addEventListener('resize', queue);

  /* CLEAN switch */
  let clean = false;
  try { clean = localStorage.getItem(CLEAN_KEY) === '1'; } catch (_) { /* fine */ }
  const tools = document.querySelector('.academy-chart-tools');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'academy-chart-clean'; btn.textContent = 'CLEAN'; btn.title = 'Only the candles, axes and your drawings (key H on the chart)';
  const apply = () => { document.body.classList.toggle('chart-clean', clean); btn.classList.toggle('on', clean); try { localStorage.setItem(CLEAN_KEY, clean ? '1' : '0'); } catch (_) { /* fine */ } fire(); };
  const toggle = () => { clean = !clean; apply(); };
  btn.addEventListener('click', toggle);
  if (tools) tools.appendChild(btn); else chart.querySelector('.toolbar')?.appendChild(btn);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'h' && e.key !== 'H') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (!t || !t.closest || !t.closest('main .chart') || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
    e.preventDefault(); toggle();
  });
  window.smlChartClean = () => clean;
  apply();
  sweep();
})(0);
