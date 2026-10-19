/* CHART LOCK, a strict rule: nothing moves or shrinks the live chart. Panels and tools float over it or live in their own
   column; none of them may change the chart section's grid or size. The rule is on by default, everywhere the chart is drawn
   (the Activity, a window inside the Activity, a browser pop-out).
     - the chart dock (academy-chart-dock.js) asks smlChartLock before docking a panel beside the plot; locked, panels float
     - S.I.R.E. stops taking a grid column and floats over the right edge of the chart section instead
     - Ticker Talk keeps the quote column at its normal width instead of widening it
     - the CHAIN switch and the member's own Customize choices (the chart module's size, order, floating) are not touched:
       those are the member changing the layout on purpose, not a tool moving the chart
   Scrolling: a chart in a browser pop-out or an in-Activity window keeps a usable height and the window scrolls when it is
   shorter than that, instead of squeezing the plot to fit one screen.
   Owner escape hatch: localStorage sml-chart-lock = off (or window.smlChartLock.set(false)). */
(function () {
  if (window.__smlChartLock) return;
  window.__smlChartLock = true;
  const KEY = 'sml-chart-lock';
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (_) { on = true; }
  const css = document.createElement('style');
  css.id = 'sml-chart-lock-css';
  css.textContent = ''
    /* S.I.R.E. floats instead of taking a column */
    + 'html body.chart-lock.sire-open main .chart{grid-template-columns:minmax(0,1fr)!important}'
    + 'html body.chart-lock.sire-open main .chart>*{grid-column:1!important}'
    + 'html body.chart-lock #sire-panel{position:absolute!important;right:8px;top:62px;z-index:9;width:min(var(--sire-w,332px),calc(100% - 16px));max-height:calc(100% - 76px);grid-column:auto!important;margin-left:0;box-shadow:0 12px 36px rgba(0,0,0,.55)}'
    /* Ticker Talk keeps the quote column at its normal width */
    + 'html body.chart-lock.talk-open .shell{grid-template-columns:minmax(0,1fr) 238px!important}'
    /* the dock never opens under the lock (the dock script also asks, this is the belt to its braces) */
    + 'html body.chart-lock.dock-open main .chart{grid-template-columns:minmax(0,1fr)!important}'
    + 'html body.chart-lock.dock-open.sire-open main .chart{grid-template-columns:minmax(0,1fr)!important}'
    + 'html body.chart-lock #chart-dock{display:none!important}'
    /* a chart in a browser pop-out or an in-Activity window keeps a usable height; the window scrolls instead of squeezing the plot */
    + 'html.sml-popout .sml-pop-solo.chart .academy-chart-stage{min-height:max(360px,60vh)!important}'
    + 'html.sml-popout .sml-pop-solo{overflow:auto!important;overscroll-behavior:contain}'
    + '.sml-wb .academy-chart-stage{min-height:max(300px,45vh)!important}.sml-wb{overflow:auto!important}';
  document.head.appendChild(css);
  const apply = () => { document.body.classList.toggle('chart-lock', on); setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch (_) { /* ignore */ } }, 30); };
  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply);
  window.smlChartLock = {
    on: () => on,
    set: (v) => { on = v !== false; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (_) { /* ignore */ } apply(); return on; },
    rule: 'No module may move or resize the live chart: panels float or use their own column.'
  };
})();
