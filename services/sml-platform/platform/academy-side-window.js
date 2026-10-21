/* The quote column as a tool window (desktop). The column that shows the price, the book and the tape also holds the tools that read
 * the stock: BUY/SELL, DARK POOL, SHORT SALE, SENTIMENT, the Smart-money map (SMC) and MEM ALGO. Until now the SMC card and the MEM
 * ALGO panel were fixed to the screen on top of that column, so they floated when the page scrolled, and the other boxes were
 * stacked in the column all at once. Now the column has a tab bar under the price and shows ONE of them at a time, in the column's
 * own flow, so it scrolls with the page like everything else:
 *
 *   QUOTE (book and tape)  .  BUY/SELL  .  DARK POOL  .  SHORT SALE  .  SENTIMENT  .  SMC  .  MEM ALGO
 *
 * Turning a tool on from the toolbar opens its tab; turning it off returns to QUOTE; a tab turns its tool on. The tools keep their
 * own state and data: this file only decides which one the column shows. Phones use academy-mobile-shell.js instead. */
(() => {
  if (window.__smlSideWindow) return;
  window.__smlSideWindow = 1;
  const MQ = window.matchMedia('(max-width:720px)');
  const byId = (id) => document.getElementById(id);
  const isOn = (b) => !!b && (b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true');

  /* tab id, label, the tool's own toggle ('' = none), and the column's children that belong to it */
  const TABS = [
    { id: 'quote', label: 'QUOTE', btn: '', mods: ['.book', '.academy-depth', '.academy-tape'] },
    { id: 'buysell', label: 'BUY/SELL', btn: 'buysell-toggle', mods: ['.academy-buysell'] },
    { id: 'dark', label: 'DARK POOL', btn: 'darkpool-toggle', mods: ['.academy-darkpool'] },
    { id: 'short', label: 'SHORT SALE', btn: 'shortsale-toggle', mods: ['.academy-shortsale'] },
    { id: 'sent', label: 'SENTIMENT', btn: 'sentiment-toggle', mods: ['.academy-depth'] },
    { id: 'smc', label: 'SMC', btn: 'smc-toggle', mods: ['#smc-card'] },
    { id: 'algo', label: 'MEM ALGO', btn: 'mem-algo-toggle', mods: ['#mem-algo-panel'] },
    { id: 'intent', label: 'INTENT', btn: 'intent-btn', mods: ['#intent-panel'] },
    { id: 'targets', label: 'TARGETS', btn: 'targets-toggle', mods: ['#targets-panel'] }
  ];
  const S = { tab: 'quote' };
  const side = () => document.querySelector('main .side');

  /* the rules */
  const rules = [];
  const A = 'html body.sml-sw';
  /* every tool that is on shows in the column at once, stacked under the quote (the column scrolls); nothing is hidden by tab */
  rules.push(A + '[data-sw-any] main .side>.academy-side-fill{display:none!important}');
  /* the two cards that floated: now ordinary blocks in the column */
  rules.push(A + ' main .side>#smc-card,' + A + ' main .side>#mem-algo-panel,' + A + ' main .side>#intent-panel,' + A + ' main .side>#targets-panel{position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:auto!important;height:auto!important;max-height:none!important;margin:6px 0 10px!important;z-index:auto!important;box-shadow:none!important}');
  rules.push('#side-win{display:none}');
  rules.push(A + ' #side-win{display:none!important;flex-wrap:wrap;gap:4px;margin:8px 0 6px;padding:0 0 8px;border-bottom:1px solid #16303b}');
  rules.push(A + ' #side-win button{padding:5px 8px;border:1px solid #2b4b5a;border-radius:7px;background:#0d1b25;color:#a9c3d0;font:800 .58rem ui-monospace,monospace;letter-spacing:.05em;cursor:pointer;white-space:nowrap}');
  rules.push(A + ' #side-win button:hover{border-color:#6fb8e0;color:#fff}');
  rules.push(A + ' #side-win button.on{background:#0b3b2e;border-color:#00c47d;color:#7ef0bd}');
  rules.push(A + ' #side-win button.live:not(.on):after{content:"";display:inline-block;width:5px;height:5px;margin-left:5px;border-radius:50%;background:#00c47d;vertical-align:middle}');
  const style = document.createElement('style'); style.id = 'academy-side-window'; style.textContent = rules.join('\n'); document.head.appendChild(style);

  let bar = null, obs = null;
  function build() {
    const col = side(); if (!col) return false;
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'side-win'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Quote and tools');
      bar.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-sw]'); if (b) setTab(b.dataset.sw, true); });
    }
    const anchor = col.querySelector('#change') || col.querySelector('#price') || col.querySelector('#label');
    if (anchor && bar.previousElementSibling !== anchor) anchor.after(bar);
    return true;
  }
  const visible = (b) => !!b && getComputedStyle(b).display !== 'none';
  function paint() {
    if (!bar) return;
    const tabs = TABS.filter((t) => !t.btn || visible(byId(t.btn)));
    bar.innerHTML = tabs.map((t) => '<button type="button" role="tab" data-sw="' + t.id + '" class="' + (t.id === S.tab ? 'on' : (t.btn && isOn(byId(t.btn)) ? 'live' : '')) + '">' + t.label + '</button>').join('');
    document.body.dataset.sw = S.tab;
    const any = TABS.some((t) => t.btn && isOn(byId(t.btn))); if (any) document.body.setAttribute('data-sw-any', '1'); else document.body.removeAttribute('data-sw-any');
  }
  function setTab(id, fromTab) {
    const t = TABS.find((x) => x.id === id) || TABS[0];
    S.tab = t.id;
    if (fromTab && t.btn) { const b = byId(t.btn); if (b && !isOn(b)) b.click(); }
    if (t.id === 'smc') setTimeout(() => { const o = byId('smc-card') && byId('smc-card').querySelector('span[data-min]'); if (o && /open/i.test(o.textContent)) o.click(); }, 450);
    paint();
  }
  /* a tool turned on or off from the toolbar (or anywhere) moves the column to it, or back to the quote */
  function watch() {
    if (obs) obs.disconnect();
    obs = new MutationObserver((records) => {
      for (const r of records) {
        const b = r.target, t = TABS.find((x) => x.btn && x.btn === b.id); if (!t) continue;
        if (isOn(b)) { if (S.tab !== t.id) setTab(t.id); setTimeout(() => { const m = t.mods.map((q) => document.querySelector('main .side>' + q)).find(Boolean); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 500); } else if (S.tab === t.id) setTab('quote');
        else paint();
      }
    });
    for (const t of TABS) { const b = t.btn && byId(t.btn); if (b) obs.observe(b, { attributes: true, attributeFilter: ['class', 'aria-pressed'] }); }
  }
  let timer = null, watched = 0;
  function tick() {
    if (!document.body.classList.contains('sml-sw')) return;
    if (!build()) return;
    const now = TABS.filter((t) => t.btn && byId(t.btn)).length;
    if (now !== watched) { watched = now; watch(); }
    /* the column is the tool window: the SMC card and the MEM ALGO panel sit in it (their own placement code mounts them) */
    const col = side();
    for (const [bid, pid] of [['intent-btn', 'intent-panel'], ['targets-toggle', 'targets-panel']]) { const ip = byId(pid); if (ip && col && isOn(byId(bid)) && ip.parentElement !== col) { col.appendChild(ip); ip.scrollIntoView && ip.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
    const t = TABS.find((x) => x.id === S.tab);
    if (t && t.btn && !isOn(byId(t.btn))) S.tab = 'quote';
    paint();
  }
  function enable() {
    document.body.classList.add('sml-sw');
    if (!timer) timer = setInterval(tick, 1200);
    tick();
  }
  function disable() {
    const st = document.querySelector('.academy-chart-stage'); for (const pid of ['intent-panel', 'targets-panel']) { const ip = byId(pid); if (ip && st && ip.parentElement !== st) st.appendChild(ip); }
    document.body.classList.remove('sml-sw'); delete document.body.dataset.sw; document.body.removeAttribute('data-sw-any');
    if (timer) { clearInterval(timer); timer = null; }
    if (obs) { obs.disconnect(); obs = null; watched = 0; }
    if (bar) { bar.remove(); bar = null; }
  }
  const sync = () => (MQ.matches ? disable() : enable());
  if (MQ.addEventListener) MQ.addEventListener('change', sync); else if (MQ.addListener) MQ.addListener(sync);
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync);
  window.smlSideWindow = { tab: setTab, state: () => ({ tab: S.tab }), tabs: TABS.map((t) => t.id) };
})();
