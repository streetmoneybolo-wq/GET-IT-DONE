/* View cycle for the panel under the chart: OPTIONS CHAIN -> EARNINGS -> SCANNER INTELLIGENCE.
 * One of the three is on screen at a time (the live scanner table stays put above them), and a
 * single NEXT button walks round them in that order, so the related data sits in one place and
 * the page is not three tall boxes stacked. This file owns no data: it shows and hides the options
 * dock, the earnings panel (via that module's own toggle, so its state stays in one place) and the
 * scanner-intelligence box, and remembers the last view. Educational display only. */
(() => {
  if (window.__smlBelowCycle) return;
  window.__smlBelowCycle = true;
  const VIEWS = [['options', 'OPTIONS CHAIN'], ['earnings', 'EARNINGS'], ['intel', 'SCANNER INTELLIGENCE']];
  const KEY = 'sml-below-view-v1';
  let view = 'options';
  try { const v = localStorage.getItem(KEY); if (VIEWS.some(([k]) => k === v)) view = v; } catch (_) { /* storage can be blocked */ }

  const style = document.createElement('style');
  style.textContent = '.academy-view-cycle{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 10px}.academy-view-cycle button{border:1px solid #315064;background:#0a1822;color:#c9dce8;padding:6px 10px;border-radius:6px;font:800 .64rem ui-monospace,monospace;letter-spacing:.05em;cursor:pointer}.academy-view-cycle button.on{background:#00b878;color:#001d13;border-color:#00b878}.academy-view-cycle .next{margin-left:auto;background:#12405a;border-color:#4dc3ff;color:#fff}';
  document.head.appendChild(style);

  const bar = document.createElement('div'); bar.className = 'academy-view-cycle'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Options, earnings and scanner intelligence');
  bar.innerHTML = VIEWS.map(([k, label]) => '<button type="button" role="tab" data-view="' + k + '">' + label + '</button>').join('') + '<button type="button" class="next" data-next="1" title="Show the next view">NEXT &#9656;</button>';
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  function place() {
    if (bar.isConnected) return true;
    const below = document.getElementById('academy-below'), title = below && below.querySelector('.below-title');
    if (!below) return false;
    (title ? title.after(bar) : below.prepend(bar));
    return true;
  }
  function apply() {
    if (!place()) return;
    const earnBtn = document.getElementById('earnings-toggle'), earnOn = !!(earnBtn && earnBtn.classList.contains('on'));
    // the earnings module owns its own on/off state; only click it when it disagrees with the chosen view
    if (earnBtn && earnOn !== (view === 'earnings')) earnBtn.click();
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    if (view !== 'earnings') show(dock, view === 'options'); // in the earnings view that module hides the dock itself
    show(document.querySelector('.academy-rank-lab'), view === 'intel');
    bar.querySelectorAll('[data-view]').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  }
  function set(next) { view = next; try { localStorage.setItem(KEY, view); } catch (_) { /* ignore */ } apply(); }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    if (b.dataset.view) set(b.dataset.view);
    else if (b.dataset.next) set(VIEWS[(VIEWS.findIndex(([k]) => k === view) + 1) % VIEWS.length][0]);
  });
  // the options dock, earnings panel and intelligence box all mount asynchronously, and the earnings toggle can also be pressed from the TOOLS menu: settle on the chosen view for a while, then stay in sync with that toggle
  let ticks = 0;
  const timer = setInterval(() => {
    apply(); ticks += 1;
    const earnBtn = document.getElementById('earnings-toggle');
    if (earnBtn && !earnBtn.__cycleSync) { earnBtn.__cycleSync = true; earnBtn.addEventListener('click', () => setTimeout(() => { const on = earnBtn.classList.contains('on'); if (on && view !== 'earnings') set('earnings'); else if (!on && view === 'earnings') set('options'); }, 0)); }
    if (ticks > 40 && bar.isConnected) clearInterval(timer);
  }, 500);
  apply();
})();
