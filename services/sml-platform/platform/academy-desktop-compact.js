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
    A + ' .academy-chart-stage>canvas{max-width:100%!important}' + A + ' main .side{min-height:0;overflow-x:hidden}' + A + ' main .side>*{min-width:0;max-width:100%;box-sizing:border-box}',
    /* the index strip on one line each (name and source side by side): the strip loses a third of its height */
    A + ' .indices{min-height:0}' + A + ' .indices .index{display:flex;align-items:baseline;gap:6px;padding-top:3px;padding-bottom:3px}' + A + ' .indices .index b,' + A + ' .indices .index small{display:inline;margin:0}',
    /* the tool rail fills its rows: groups share the width (no ragged empty end), buttons spread inside each group */
    A + ' #tool-rail .tg{flex:1 1 auto}' + A + ' #tool-rail .tg .row{flex:1 1 auto;justify-content:space-between}',
    /* on a narrower window the broker buttons are short ("moomoo ↗" after a BUY label) and the chart-tools hints step aside, so the intervals share the first row and the tools row stays one row */
    A + '.sml-dc-narrow .sml-dc-buylbl{display:inline-flex}' + A + ' .sml-dc-buylbl{display:none;align-items:center;color:#7f97a4;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em}',
    A + '.sml-dc-narrow .intervals{gap:3px!important;flex-wrap:nowrap}' + A + '.sml-dc-narrow .intervals button{padding:4px 6px!important;font-size:.68rem!important;min-width:0!important}' + A + '.sml-dc-narrow .intervals select{padding:4px 5px!important;font-size:.68rem!important;max-width:84px}',
    A + '.sml-dc-narrow .academy-chart-tools>span{display:none!important}' + A + '.sml-dc-narrow .academy-chart-tools{flex-wrap:nowrap}',
    A + ' main .side>:is(#smc-card,#mem-algo-panel,.academy-buysell,.academy-darkpool,.academy-shortsale){flex:0 0 auto}',
    A + ' main .side>.academy-side-fill{flex:1 1 0;min-height:60px}'
  ].join('\n');
  document.head.appendChild(css);

  const tb = () => document.querySelector('main .toolbar');
  const narrow = () => { const t = tb(); return !!t && t.clientWidth < 1500; };
  function shorten() {
    const nar = narrow();
    document.body.classList.toggle('sml-dc-narrow', nar);
    const buttons = [...document.querySelectorAll('.toolbar button.academy-broker-buy')];
    for (const b of buttons) {
      if (b.classList.contains('academy-broker-short')) continue;
      const m = /on (.+?) ↗/.exec(b.dataset.full || b.textContent || '') || /^(?:Buy )?(.+?) ↗$/.exec(b.textContent || '');
      if (m) { const t = nar ? m[1] + ' ↗' : 'Buy on ' + m[1] + ' ↗'; if (b.textContent !== t) b.textContent = t; }
    }
    let lbl = document.querySelector('.toolbar .sml-dc-buylbl');
    if (buttons.length && !lbl) { lbl = document.createElement('span'); lbl.className = 'sml-dc-buylbl'; lbl.textContent = 'BUY'; buttons[0].parentElement.insertBefore(lbl, buttons[0]); }
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
  function disable() { document.body.classList.remove('sml-dc', 'sml-dc-narrow'); const l = document.querySelector('.sml-dc-buylbl'); if (l) l.remove(); moveTail(false); if (timer) { clearInterval(timer); timer = null; } }
  window.addEventListener('resize', () => { if (document.body.classList.contains('sml-dc')) shorten(); });
  const sync = () => (MQ.matches ? disable() : enable());
  if (MQ.addEventListener) MQ.addEventListener('change', sync); else if (MQ.addListener) MQ.addListener(sync);
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync);
})();
