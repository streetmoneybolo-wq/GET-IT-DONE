/* Top-bar rail for the Academy's floating buttons. On a desktop-width page the Alerts, Signals, Loop Bucks,
   Profile and Customize pills no longer float over the page corners (where they covered the indicator chips
   and the Browse button): they sit in one slim rail at the right end of the top bar, and the panels they open
   drop down from under the bar. Phones keep the floating pills and bottom sheets. Display only. */
(() => {
  if (window.__smlBarRail) return;
  window.__smlBarRail = true;
  const IDS = ['academy-alerts-fab', 'sml-sig-fab', 'lb-btn', 'academy-ask-btn', 'academy-profile-btn', 'aa-btn'];
  const wide = () => window.matchMedia('(min-width:721px)').matches;
  const style = document.createElement('style');
  style.textContent = '.bar-rail{display:none}'
    + '@media(min-width:721px){.bar-rail{display:flex;gap:5px;align-items:center;margin-left:2px;flex-wrap:nowrap}'
    /* a flex item keeps its z-index even when static: without auto the docked pills would float above the full-screen profile */
    + '.bar-rail>button{position:static!important;z-index:auto!important;padding:4px 9px!important;font-size:.63rem!important;line-height:1.2!important;box-shadow:none!important;border-radius:7px!important;margin:0!important;white-space:nowrap}'
    + '.bar-rail>button#academy-alerts-fab i{width:7px;height:7px}'
    /* the panels those buttons open hang under the bar instead of rising from a corner */
    + '#aa-panel,#lb-panel,#sml-sig,#academy-ask{top:50px!important;bottom:auto!important;left:auto!important;right:10px!important;max-height:calc(100dvh - 64px)!important}}';
  document.head.appendChild(style);
  let rail = null;
  function home() {
    if (rail) return rail;
    const bar = document.querySelector('main .bar'); if (!bar) return null;
    rail = document.createElement('span'); rail.className = 'bar-rail';
    const status = bar.querySelector('#status');
    if (status) bar.insertBefore(rail, status); else bar.appendChild(rail);
    return rail;
  }
  function dock() {
    if (!wide()) return;
    const r = home(); if (!r) return;
    for (const id of IDS) { const b = document.getElementById(id); if (b && b.parentNode !== r) r.appendChild(b); }
  }
  dock();
  if (typeof MutationObserver === 'function') new MutationObserver(dock).observe(document.body, { childList: true });
  else setTimeout(dock, 1500);
})();
