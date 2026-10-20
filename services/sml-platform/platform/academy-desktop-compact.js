/* Desktop compaction: no dead space in the header or the quote column, however the modules change.
 *   - the broker buttons say "Buy on moomoo" (the symbol box beside them already names the stock), so the interval buttons fit on the
 *     first toolbar row instead of wrapping to a second row with empty space on both sides;
 *   - the "Live 5m candles" caption steps aside on desktop (the chart's own corner already says it);
 *   - TOUR and GUIDE move to the top bar and the data-status chip to the chart-tools row, so the toolbar has no row of its own for them;
 *   - tools in the quote column (SMC, MEM ALGO, BUY/SELL, DARK POOL, SHORT SALE) grow to fill the column, so a short panel never
 *     leaves an empty strip under it, and the scanner list under the quote shows as many rows as the column has room for.
 * Phones keep their own workspace (academy-mobile-shell.js). */
(() => {
  if (window.__smlDesktopCompact) return;
  window.__smlDesktopCompact = 1;
  const MQ = window.matchMedia('(max-width:720px)');
  const css = document.createElement('style');
  css.id = 'academy-desktop-compact';
  const A = 'html body.sml-dc';
  css.textContent = [
    A + ' main .toolbar #company{display:none!important}',
    A + ' .sml-dc-tail{display:flex;align-items:center;gap:4px;margin:0 8px 0 0;flex:none}',
    A + ' .sml-dc-chip{margin-left:auto;flex:none}',
    A + ' main .side{min-height:0}',
    A + ' main .side>:is(#smc-card,#mem-algo-panel,.academy-buysell,.academy-darkpool,.academy-shortsale){flex:0 0 auto}',
    A + ' main .side>.academy-side-fill{flex:1 1 0;min-height:60px}'
  ].join('\n');
  document.head.appendChild(css);

  const tb = () => document.querySelector('main .toolbar');
  function shorten() {
    for (const b of document.querySelectorAll('.toolbar button.academy-broker-buy')) {
      if (b.classList.contains('academy-broker-short')) continue;
      const m = /on (.+?) ↗/.exec(b.dataset.full || b.textContent || '');
      if (m) { const t = 'Buy on ' + m[1] + ' ↗'; if (b.textContent !== t) b.textContent = t; }
    }
  }
  /* where each piece lives while the desktop layout is on, and the way home for the phone layout */
  const homes = new Map();
  function relocate(el, to, before) {
    if (!el || !to) return;
    if (!homes.has(el)) homes.set(el, { parent: el.parentElement, next: el.nextSibling });
    if (el.parentElement !== to || (before && el.nextSibling !== before)) to.insertBefore(el, before || null);
  }
  function restore(el) {
    const h = homes.get(el); if (!h) return; homes.delete(el);
    if (h.parent) h.parent.insertBefore(el, h.next && h.next.parentElement === h.parent ? h.next : null);
  }
  function moveTail(on) {
    const rail = document.getElementById('tool-rail'), tail = rail && rail.querySelector('.tail') || document.querySelector('.sml-dc-tail');
    const head = document.querySelector('body > main > .bar, main .bar');
    const chip = document.querySelector('.toolbar .data-chip, .data-chip');
    const tools = document.querySelector('.academy-chart-tools');
    if (on) {
      if (tail && head && tail.querySelector('#tour-btn')) { tail.classList.add('sml-dc-tail'); relocate(tail, head, head.lastElementChild); }
      if (chip && tools) { chip.classList.add('sml-dc-chip'); relocate(chip, tools, null); }
    } else {
      if (tail) { tail.classList.remove('sml-dc-tail'); restore(tail); }
      if (chip) { chip.classList.remove('sml-dc-chip'); restore(chip); }
    }
  }
  /* the broker buttons rewrite their own text when the symbol changes: shorten it again at once */
  let mo = null;
  function watch() {
    const bar = tb(); if (mo || !bar) return;
    mo = new MutationObserver(() => { if (document.body.classList.contains('sml-dc')) shorten(); });
    mo.observe(bar, { childList: true, characterData: true, subtree: true });
  }
  let timer = null;
  function tick() { if (!document.body.classList.contains('sml-dc')) return; shorten(); moveTail(true); watch(); }
  function enable() { document.body.classList.add('sml-dc'); tick(); if (!timer) timer = setInterval(tick, 1500); }
  function disable() { document.body.classList.remove('sml-dc'); moveTail(false); if (timer) { clearInterval(timer); timer = null; } }
  const sync = () => (MQ.matches ? disable() : enable());
  if (MQ.addEventListener) MQ.addEventListener('change', sync); else if (MQ.addListener) MQ.addListener(sync);
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync);
})();
