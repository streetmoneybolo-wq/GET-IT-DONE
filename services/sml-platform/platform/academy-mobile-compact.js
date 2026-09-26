/* Phone layout for the Academy Live Chart Lab (≤720px). Loaded last, after every
   other Academy module. Several of those modules append their own <style> lazily
   (after data arrives), so every rule here carries extra specificity rather than
   relying on source order. Desktop is untouched.

   What it fixes on a phone:
   - the header and chart toolbar wrapped into five rows of controls plus hint
     text, pushing the first candle ~380px down the screen — intervals and chart
     tools become single scrollable rows, hints and labels that only make sense
     with a mouse are hidden, and the chart gets the height back;
   - the floating "Alerts" pill sat over the headings of whatever was scrolled
     beneath it — it now lives in the header next to LOOP-KICK;
   - the sections below the chart stacked every stat one per row (4+ screens of
     scrolling) — stat boxes go three-across, the options glossary folds into a
     details block, and the scanner shows the columns that fit instead of a
     940px-wide table that needs sideways scrolling. */
(() => {
  if (window.__smlAcademyMobileCompact) return;
  window.__smlAcademyMobileCompact = 1;
  const MQ = '(max-width:720px)';
  /* scanner columns that fit a phone, by the header's data-sort key */
  const SCAN_KEEP = ['symbol', 'price', 'changePct', 'volume'];
  const style = document.createElement('style');
  style.id = 'academy-mobile-compact';
  style.textContent = '@media ' + MQ + '{'
    /* header: one tight row of controls; the title shrinks instead of the buttons wrapping */
    + 'body main .bar{gap:5px 6px;padding:6px 8px;flex-wrap:wrap}'
    + 'body main .bar strong{flex:1 1 auto;min-width:0;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'body main .bar .lesson-toggle{margin-left:0;padding:5px 8px;font-size:.66rem}body main .bar #lesson-toggle{margin-left:auto}'
    + 'body main .bar .status{font-size:.6rem}'
    + 'body main .bar #academy-lk-btn{padding:5px 8px;font-size:.66rem}'
    + 'body main .bar #academy-alerts-fab{position:static;padding:5px 8px;font-size:.66rem;border-radius:6px;box-shadow:none;gap:5px}body main .bar #academy-alerts-fab i{width:7px;height:7px}'
    + 'body main .bar #academy-auth-notice{order:99;padding:.15rem 0 0;font-size:.66rem;line-height:1.3;gap:.4rem}'
    /* the chart stage: every pixel saved above goes to the candles */
    + 'body main{height:calc(100dvh - 64px)}body main .chart{padding:4px}body main .chart canvas#chart{min-height:300px}'
    + 'body main .toolbar{gap:4px 5px;padding:5px 6px}body main .toolbar input#symbol{width:66px;padding:5px 6px;font-size:.78rem}body main .toolbar #load{padding:5px 8px;font-size:.72rem}'
    + 'body main .toolbar .quote-chip{font-size:.6rem}body main .toolbar #company{display:none}'
    + 'body main .toolbar .intervals{order:1;flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;gap:3px;margin:0;padding-bottom:1px;scrollbar-width:none;-webkit-overflow-scrolling:touch}body main .toolbar .intervals::-webkit-scrollbar{display:none}'
    + 'body main .toolbar .intervals button{flex:none;padding:4px 7px;font-size:.66rem}'
    + 'body main .toolbar .depth-toggle,body main .toolbar #mem-algo-toggle,body main .toolbar #smc-toggle{order:2;padding:4px 8px;font-size:.62rem}'
    /* the moomoo link rides the toggles row instead of taking a row of its own */
    + 'body main .toolbar #academy-moomoo-buy{order:3;margin-left:auto;padding:4px 7px;font-size:.6rem}'
    + 'body main .chart .academy-chart-tools{flex-wrap:nowrap;overflow-x:auto;gap:4px;padding:4px 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}body main .chart .academy-chart-tools::-webkit-scrollbar{display:none}'
    + 'body main .chart .academy-chart-tools label,body main .chart .academy-chart-tools span{display:none}'
    + 'body main .chart .academy-chart-tools select,body main .chart .academy-chart-tools button{flex:none;height:26px;padding:2px 7px;font-size:.6rem;white-space:nowrap}'
    + 'body main .chart .academy-pro-palette{left:6px;right:6px;top:auto;bottom:8px}'
    /* below the chart */
    + 'body .academy-below{padding:10px 8px;min-height:0}body .academy-below .below-title{margin:0 0 8px;font-size:.66rem}'
    + 'body .academy-below .options-chain{margin-top:10px;padding:10px}body .academy-below .options-chain h2{font-size:.82rem;margin:0 0 3px}body .academy-below .options-chain p{font-size:.66rem;line-height:1.4}'
    + 'body .academy-below .options-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:end}body .academy-below .options-actions label{flex:1 1 45%;font-size:.6rem}body .academy-below .options-chain button{margin-top:6px;padding:7px 10px;font-size:.7rem}'
    + 'body .academy-below .options-glossary{margin-top:8px;padding:8px;font-size:.62rem;line-height:1.45}'
    + 'body .academy-mobile-glossary{margin-top:10px}body .academy-mobile-glossary summary{cursor:pointer;color:#ffca55;font:800 .66rem system-ui;list-style:none}body .academy-mobile-glossary summary::-webkit-details-marker{display:none}'
    + 'body .academy-mobile-glossary summary:before{content:"▸ ";color:#ffca55}body .academy-mobile-glossary[open] summary:before{content:"▾ "}'
    + 'body .academy-below .opt-calc{padding:10px}body .academy-below .opt-calc h2{font-size:.72rem;margin-bottom:6px}body .academy-below .opt-calc .oc-grid{gap:6px}body .academy-below .opt-calc input{padding:6px 7px;font-size:.74rem}'
    + 'body .academy-below .opt-calc .oc-out{margin-top:8px;padding:8px}body .academy-below .opt-calc .oc-big b{font-size:1.25rem}body .academy-below .opt-calc .oc-note{font-size:.56rem}'
    + 'body .academy-below .academy-mobile-stats{padding:8px;margin:0 0 10px}body .academy-below .academy-mobile-stats .academy-quote-stats-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:0 6px}body .academy-below .academy-quote-stat{padding:2px 1px}'
    + 'body .academy-below .academy-intelligence{margin:6px 0}'
    /* scanner: three stat boxes across, a scrollable filter row, and only the columns that fit */
    + 'body .academy-below .academy-scan-head{gap:6px;padding:8px 10px}body .academy-below .academy-scan-title{font-size:.7rem}'
    + 'body .academy-below .academy-scan-tabs{gap:3px;padding:6px 8px}body .academy-below .academy-scan-tabs button,body .academy-below .academy-scan-tools button,body .academy-below .academy-scan-pages button{padding:4px 7px;font-size:.6rem}'
    + 'body .academy-below .academy-scan-tools{flex-wrap:nowrap;overflow-x:auto;gap:5px;padding:6px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch}body .academy-below .academy-scan-tools::-webkit-scrollbar{display:none}'
    + 'body .academy-below .academy-scan-tools input{min-width:130px;flex:1 1 130px;height:28px}body .academy-below .academy-scan-tools select{flex:none;height:28px}'
    + 'body .academy-below .academy-monitor{grid-template-columns:repeat(3,minmax(0,1fr))}body .academy-below .academy-monitor span{padding:6px 8px;font-size:.54rem}body .academy-below .academy-monitor b{font-size:.68rem}'
    + 'body .academy-below .academy-scan-table{min-width:0;font-size:.62rem}body .academy-below .academy-scan-table th,body .academy-below .academy-scan-table td{padding:6px 5px}'
    + 'body .academy-below .academy-scan-table .academy-mobile-hide{display:none}'
    + 'body .academy-below .academy-scan-foot{padding:7px 8px;font-size:.58rem}body .academy-below .academy-pro-note{padding:5px 8px;font-size:.56rem}'
    + '}';
  document.head.appendChild(style);

  const mq = window.matchMedia(MQ);

  /* Hide scanner columns by header key, not position: the rank column only
     exists in some presets, and rows re-render on every sort, page and refresh. */
  function trimScanner(phone) {
    const table = document.querySelector('.academy-scan-table');
    if (!table) return;
    const heads = Array.from(table.querySelectorAll('thead th'));
    const hide = heads.map((th) => phone && !SCAN_KEEP.includes(String(th.dataset.sort || '')));
    heads.forEach((th, i) => th.classList.toggle('academy-mobile-hide', hide[i]));
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = row.children;
      if (cells.length !== heads.length) continue; // an empty-state or message row
      for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('academy-mobile-hide', hide[i]);
    }
  }

  function apply() {
    const phone = mq.matches;
    const bar = document.querySelector('main .bar');
    const title = bar && bar.querySelector('strong');
    if (title) {
      if (!title.dataset.full) title.dataset.full = title.textContent;
      const short = 'MEM Academy';
      if (phone && title.textContent !== short) title.textContent = short;
      else if (!phone && title.textContent !== title.dataset.full) title.textContent = title.dataset.full;
    }
    /* "Buy INTC on moomoo ↗" is too wide to share the toggles row; the short label fits beside SMC */
    const moomoo = document.getElementById('academy-moomoo-buy');
    if (moomoo) {
      const full = moomoo.textContent;
      if (phone) {
        if (!/^moomoo/.test(full)) { moomoo.dataset.full = full; moomoo.title = full; moomoo.textContent = 'moomoo ↗'; }
      } else if (/^moomoo/.test(full) && moomoo.dataset.full) {
        moomoo.textContent = moomoo.dataset.full;
      }
    }
    /* the Alerts button: in the header on a phone, floating on a desktop */
    const fab = document.getElementById('academy-alerts-fab');
    if (fab && bar) {
      if (phone && fab.parentElement !== bar) {
        const lk = document.getElementById('academy-lk-btn');
        if (lk && lk.parentElement === bar) lk.insertAdjacentElement('afterend', fab); else bar.appendChild(fab);
      } else if (!phone && fab.parentElement === bar) {
        document.body.appendChild(fab);
      }
    }
    /* the options glossary folds shut on a phone; it opens again on a wide screen */
    const glossary = document.querySelector('.options-glossary');
    if (glossary) {
      let details = glossary.closest('details.academy-mobile-glossary');
      if (phone && !details) {
        details = document.createElement('details');
        details.className = 'academy-mobile-glossary';
        const summary = document.createElement('summary');
        summary.textContent = 'How to read this lab';
        glossary.parentNode.insertBefore(details, glossary);
        details.appendChild(summary);
        details.appendChild(glossary);
        const lead = glossary.querySelector('strong');
        if (lead && /how to read/i.test(lead.textContent)) lead.remove();
      }
      if (details && !phone) details.open = true;
    }
    trimScanner(phone);
  }
  const schedule = () => { clearTimeout(apply.t); apply.t = setTimeout(apply, 60); };
  apply();
  /* the Alerts and LOOP-KICK buttons, the scanner and its rows are all created or re-rendered by other modules after load */
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', schedule); else mq.addListener(schedule);
  window.addEventListener('resize', () => { clearTimeout(apply.r); apply.r = setTimeout(apply, 120); });
})();
