/* Toolbar navigation for the Academy Live Chart Lab. Every chart tool (WALLS, COST, SMC, MEM ALGO,
 * SIRE, BUY/SELL, DARK POOL, SHORT SALE, EARNINGS) adds its own toggle button straight to
 * `.toolbar`, and each one is independently useful — but a flat, ever-growing row of them is
 * exactly the "hard to navigate" problem: nothing groups the two order-book tools next to each
 * other, or separates a chart overlay from a data panel. This file does no analysis of its own; it
 * only reparents the buttons those files already created into three labeled groups behind one
 * TOOLS menu, in the order a trader actually reaches for them: read the chart (overlays), read the
 * order flow, then check the underlying's data. Reparenting a button keeps its click handler and
 * state exactly as they were — nothing about how a tool works changes, only where its button lives. */
(() => {
  if (window.__smlToolbarNav) return;
  window.__smlToolbarNav = true;

  const GROUPS = [
    { key: 'overlays', label: 'CHART OVERLAYS', ids: ['depth-walls', 'depth-cost', 'smc-toggle'] },
    { key: 'flow', label: 'ORDER FLOW', ids: ['buysell-toggle', 'darkpool-toggle', 'shortsale-toggle'] },
    { key: 'analysis', label: 'ANALYSIS', ids: ['mem-algo-toggle', 'sire-toggle', 'earnings-toggle'] },
  ];
  const ALL_IDS = GROUPS.flatMap((g) => g.ids);

  const style = document.createElement('style');
  style.textContent = '#tools-nav-toggle{margin-left:6px;padding:5px 9px;border:1px solid #3a4a56;border-radius:7px;background:#0d1a24;color:#cfe0e8;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#tools-nav-toggle.on{background:#1c3444;border-color:#6fb8e0;color:#fff}'
    + '#tools-nav-menu{position:absolute;z-index:2147483500;margin-top:6px;padding:8px;border:1px solid #2b5362;border-radius:9px;background:rgba(8,16,24,.98);box-shadow:0 12px 30px rgba(0,0,0,.5);display:none;min-width:200px}'
    + '#tools-nav-menu.open{display:block}#tools-nav-menu .tool-group{margin:0 0 8px}#tools-nav-menu .tool-group:last-child{margin-bottom:0}'
    + '#tools-nav-menu .tool-group b{display:block;margin:0 0 4px;font:800 .56rem ui-monospace,monospace;color:#6f8794;letter-spacing:.08em}'
    + '#tools-nav-menu .tool-group .row{display:flex;flex-wrap:wrap;gap:4px}'
    + '#tools-nav-menu .tool-group .row button{margin-left:0 !important}'
    + '#tools-nav-empty{color:#6f8794;font:600 .6rem ui-monospace,monospace;padding:4px 2px}';
  document.head.appendChild(style);

  function boot(tries) {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
    const found = ALL_IDS.filter((id) => document.getElementById(id));
    // Wait for at least one real tool button to exist before building the menu (an empty TOOLS
    // button that never gets anything to show would just be more clutter), but don't wait forever:
    // some tool files boot slowly, and the trader should not lose the menu entirely.
    if (!found.length && tries < 100) { setTimeout(() => boot(tries + 1), 150); return; }
    if (document.getElementById('tools-nav-toggle')) { collect(); return; }

    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.id = 'tools-nav-toggle'; trigger.textContent = 'TOOLS ▾';
    trigger.title = 'Chart overlays, order flow and analysis tools';
    toolbar.appendChild(trigger);

    const menu = document.createElement('div'); menu.id = 'tools-nav-menu';
    menu.innerHTML = GROUPS.map((g) => '<div class="tool-group" data-group="' + g.key + '"><b>' + g.label + '</b><div class="row"></div></div>').join('');
    document.body.appendChild(menu);

    function place() {
      const r = trigger.getBoundingClientRect();
      menu.style.left = Math.round(r.left) + 'px'; menu.style.top = Math.round(r.bottom + window.scrollY) + 'px';
    }
    function toggleMenu(open) {
      const next = open == null ? !menu.classList.contains('open') : open;
      menu.classList.toggle('open', next); trigger.classList.toggle('on', next);
      if (next) place();
    }
    trigger.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    // choosing a tool closes the menu, so the panel it opens never has to sit on top of (or under) an open menu
    menu.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) setTimeout(() => toggleMenu(false), 0); });
    document.addEventListener('click', (e) => { if (menu.classList.contains('open') && !menu.contains(e.target) && e.target !== trigger) toggleMenu(false); });
    window.addEventListener('resize', () => { if (menu.classList.contains('open')) place(); });

    collect();
    // Tool buttons that boot slowly (retry loops waiting on other DOM) may not exist yet: keep
    // sweeping for a while so a late button still ends up in its group instead of stranded on the
    // bare toolbar.
    let sweeps = 0;
    const sweep = setInterval(() => { collect(); sweeps += 1; if (sweeps > 60) clearInterval(sweep); }, 500);
  }

  function collect() {
    const menu = document.getElementById('tools-nav-menu'); if (!menu) return;
    for (const g of GROUPS) {
      const row = menu.querySelector('.tool-group[data-group="' + g.key + '"] .row');
      for (const id of g.ids) {
        const btn = document.getElementById(id);
        if (btn && btn.parentElement !== row) row.appendChild(btn);
      }
    }
  }

  boot(0);
})();
