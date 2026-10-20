/* One tool at a time, and click away to close. The Academy's tool panels (SMC, MEM ALGO, BUY/SELL, DARK POOL, SHORT SALE, SENTIMENT,
 * CHAIN, SIRE, EARNINGS, CATALYSTS, PAPER TRADE, INTENT, SNAP, GUIDE) used to open on top of each other. Now turning one on turns the
 * others off, and a tap or click anywhere outside a floating popup (SNAP, GUIDE, INTENT, SIRE, and the SMC or MEM card when they float)
 * closes it, on desktop and on phones. ALERT (an armed click-to-alert mode) and the chat are left alone, and Esc closes the popup too. */
(() => {
  if (window.__smlOneAtATime) return;
  window.__smlOneAtATime = 1;
  const byId = (id) => document.getElementById(id);
  const shown = (e) => { if (!e) return false; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20; };
  const isOn = (b) => !!b && (b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true');
  /* the tools that take turns: its button, its panel */
  const TOOLS = [
    ['smc-toggle', 'smc-card'], ['mem-algo-toggle', 'mem-algo-panel'], ['buysell-toggle', ''], ['darkpool-toggle', ''], ['shortsale-toggle', ''],
    ['sentiment-toggle', ''], ['chain-toggle', 'chain-stage'], ['sire-toggle', 'sire-panel'], ['earnings-toggle', ''], ['catalysts-toggle', 'catalysts-panel'],
    ['paper-toggle', 'paper-panel'], ['intent-btn', 'intent-panel'], ['snap-toggle', 'snap-panel'], ['tool-guide-btn', 'tool-guide']
  ].map(([btn, panel]) => ({ btn, panel }));
  const open = (t) => { const b = byId(t.btn); return isOn(b) || (!!t.panel && shown(byId(t.panel))); };
  const close = (t) => {
    const b = byId(t.btn); if (!b || !open(t)) return;
    b.click();
    /* the SNAP panel is opened by its button but closed by its own x */
    const p = t.panel && byId(t.panel);
    if (t.btn === 'snap-toggle' && p && shown(p)) { const x = p.querySelector('header button'); if (x) x.click(); if (shown(p)) p.style.display = 'none'; }
  };
  /* turning a tool on closes every other tool (capture phase: before the tool's own handler runs) */
  document.addEventListener('click', (e) => {
    const hit = e.target.closest && e.target.closest('button[id],a[id]'); if (!hit) return;
    const me = TOOLS.find((t) => t.btn === hit.id); if (!me || open(me)) return;
    for (const t of TOOLS) if (t !== me) close(t);
  }, true);
  /* floating popups close on an outside tap */
  const FLOAT = [
    { id: 'snap-panel', t: 'snap-toggle' }, { id: 'tool-guide', t: 'tool-guide-btn' }, { id: 'intent-panel', t: 'intent-btn' }, { id: 'sire-panel', t: 'sire-toggle' },
    { id: 'smc-card', t: 'smc-toggle', onlyFixed: true }, { id: 'mem-algo-panel', t: 'mem-algo-toggle', onlyFixed: true }
  ];
  const floating = (f) => { const e = byId(f.id); if (!shown(e)) return null; const p = getComputedStyle(e).position; return (f.onlyFixed ? p === 'fixed' : p === 'fixed' || p === 'absolute') ? e : null; };
  const SAFE = '#sml-tour,select,input,textarea,#ms-nav,#ms-sub,#ms-more,#ca-panel,#talk-panel,.sml-modal,[role=dialog]';
  function away(e) {
    const el = e.target; if (!el || !el.closest) return;
    if (el.closest(SAFE) || el.closest('.toolbar button[id],.academy-chart-tools button[id]')) return;
    for (const f of FLOAT) {
      const p = floating(f); if (!p || p.contains(el)) continue;
      const b = byId(f.t); if (b && b.contains(el)) continue;
      if (b) close({ btn: f.t, panel: f.id }); else p.style.display = 'none';
    }
    const more = byId('ms-more'); if (more && more.classList.contains('open') && !more.contains(el)) more.classList.remove('open');
  }
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; for (const f of FLOAT) if (floating(f)) close({ btn: f.t, panel: f.id }); });
  window.smlOneAtATime = { tools: TOOLS.map((t) => t.btn), open: () => TOOLS.filter(open).map((t) => t.btn), closeAll: () => TOOLS.forEach(close) };
})();
