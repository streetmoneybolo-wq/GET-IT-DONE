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
  /* Inside the Discord mobile app the top strip of the Activity sits under
     Discord's own sheet controls and never receives taps. Discord tells us the
     platform in the launch URL (platform=mobile); the header gets that strip as
     padding so its buttons land below it. */
  const params = new URLSearchParams(location.search);
  const discordMobile = params.get('platform') === 'mobile' || (params.has('frame_id') && window.matchMedia('(max-width:720px)').matches && ('ontouchstart' in window));
  if (discordMobile) document.documentElement.classList.add('academy-discord-mobile');
  const style = document.createElement('style');
  style.id = 'academy-mobile-compact';
  style.textContent = 'html.academy-discord-mobile body main .bar{padding-top:calc(48px + env(safe-area-inset-top,0px))}'
    + 'html.academy-discord-mobile body main{height:calc(100vh - 78px - 48px - env(safe-area-inset-top,0px));height:calc(100svh - 78px - 48px - env(safe-area-inset-top,0px))}'
    + '@media ' + MQ + '{'
    /* the chart canvas must not swallow vertical swipes: pan-y lets a finger scroll the page past the chart while horizontal drags, taps and pinches still reach the chart */
    + 'body main .chart canvas#chart,body main .chart .academy-chart-stage,body main .chart .academy-chart-stage canvas{touch-action:pan-y!important}'
    + 'body main{overscroll-behavior:auto}'
    /* header: one tight row of controls; the title shrinks instead of the buttons wrapping */
    + 'body main .bar{gap:5px 6px;padding:6px 8px;flex-wrap:wrap}'
    + 'body main .bar strong{flex:1 1 auto;min-width:0;font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'body main .bar .lesson-toggle{margin-left:0;padding:5px 8px;font-size:.66rem}body main .bar #lesson-toggle{margin-left:auto}'
    + 'body main .bar .status{font-size:.6rem}'
    + 'body main .bar #academy-lk-btn{padding:5px 8px;font-size:.66rem}'
    + 'body main .bar #academy-alerts-fab{position:static;padding:5px 8px;font-size:.66rem;border-radius:6px;box-shadow:none;gap:5px}body main .bar #academy-alerts-fab i{width:7px;height:7px}'
    /* the Signals pill (owner) sits in the header beside Alerts instead of floating over the bottom nav and the indicator chips */
    + 'body main .bar #sml-sig-fab{position:static!important;z-index:auto!important;left:auto;bottom:auto;margin:0;padding:5px 8px;font-size:.66rem;border-radius:6px;box-shadow:none;white-space:nowrap}'
    + 'body main .bar #academy-auth-notice{order:99;padding:.15rem 0 0;font-size:.66rem;line-height:1.3;gap:.4rem}'
    /* the chart stage: every pixel saved above goes to the candles */
    + 'body main{height:calc(100vh - 64px);height:calc(100svh - 64px)}body main .chart{padding:4px}body main .chart canvas#chart{min-height:260px}'
    /* no Load button on a phone: Enter / Go on the keyboard, or leaving the ticker box, loads the symbol */
    + 'body main .toolbar{gap:4px 5px;padding:5px 6px}body main .toolbar input#symbol{width:74px;padding:5px 6px;font-size:.78rem}body main .toolbar #load{display:none}'
    + 'body main .toolbar .quote-chip{font-size:.6rem}body main .toolbar #company{display:none}'
    /* the intervals live under the chart's date axis; the quote statistics take their place above the chart as one scrolling row */
    + 'body main .shell{grid-template-columns:minmax(0,1fr)!important}body main .shell>*{min-width:0}'
    + 'body main .chart{min-width:0;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto auto minmax(0,1fr) auto!important}body main .chart>*{min-width:0}body main .toolbar{min-width:0;max-width:100%}'
    + 'body main .chart>.intervals{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:3px;margin:4px 0 0;padding:0 2px 1px;scrollbar-width:none;-webkit-overflow-scrolling:touch}body main .chart>.intervals::-webkit-scrollbar{display:none}'
    + 'body main .chart>.intervals button{flex:none;padding:4px 8px;font-size:.66rem}'
    + 'body main .toolbar .depth-toggle,body main .toolbar #mem-algo-toggle,body main .toolbar #smc-toggle{order:2;padding:4px 8px;font-size:.62rem}'
    /* the three broker links share their own row, evenly (a ~30% basis each forces the shared line break) */
    + 'body main .toolbar .academy-brokers{order:3;flex:1 1 100%;display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;gap:4px;min-width:0}body main .toolbar .academy-brokers::-webkit-scrollbar{display:none}body main .toolbar .academy-brokers button{flex:0 0 auto;white-space:nowrap}'
    + 'body main .toolbar button.academy-broker-buy{flex:1 1 30%;justify-content:center;min-width:0;padding:4px 6px;font-size:.62rem}'
    /* the chart stage gets a fixed share of the screen so it can never spill over the intervals row beneath it */
    + 'body main{height:auto!important;min-height:0}body main .shell{overflow:visible}body main .chart .academy-chart-stage{height:clamp(240px,50vh,470px);height:clamp(240px,50svh,470px);min-height:0}body main .chart>canvas#chart{height:clamp(240px,50vh,470px);height:clamp(240px,50svh,470px);min-height:0}'
    + 'body main .chart .academy-chart-tools{flex-wrap:nowrap;overflow-x:auto;gap:4px;padding:4px 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}body main .chart .academy-chart-tools::-webkit-scrollbar{display:none}'
    + 'body main .chart .academy-chart-tools label,body main .chart .academy-chart-tools span{display:none}'
    + 'body main .chart .academy-chart-tools select,body main .chart .academy-chart-tools button{flex:none;height:26px;padding:2px 7px;font-size:.6rem;white-space:nowrap}'
    + 'body main .chart .academy-pro-palette{left:6px;right:6px;top:auto;bottom:8px}'
    /* compact pass. Controls used to be ~22px tall so the candles got the screen; the owner asked for
       bigger tap targets on phones (2026-10-25), so every tappable control in these rows is now 34-38px -
       short of the 44px guideline on purpose, since four rows at 44px would push the first candle well down
       the screen, but comfortably past the 20px that was missing taps. The chart stage keeps its fixed
       share of the screen, so the page scrolls a little more rather than the chart shrinking. The top-bar
       pills grow in height only: at their old widths MEM, Lessons, Unlock, LOOP-KICK, Alerts and LIVE just
       fit one row at 375px, and 3px more padding each pushed Alerts onto a row of its own. */
    + 'body main .bar{gap:3px 4px;padding:4px 6px;flex-wrap:nowrap}body main .bar strong{font-size:.66rem;flex:0 1 auto}body main .bar .dot{width:.4rem;height:.4rem}'
    + 'body main .bar .lesson-toggle,body main .bar #academy-lk-btn,body main .bar #academy-alerts-fab,body main .bar #sml-sig-fab{flex:none;height:34px;padding:0 7px;font-size:.58rem;line-height:32px;border-width:1px;box-shadow:none}'
    + 'body main .bar #lesson-toggle{margin-left:auto}body main .bar .status{font-size:.5rem;flex:none}'
    + 'html.academy-discord-mobile body main .bar{flex-wrap:wrap}'
    + 'body main .bar #academy-auth-notice{flex:1 1 100%;font-size:.58rem;padding:0}'
    + 'body main .toolbar{gap:3px 4px;padding:3px 5px}body main .toolbar input#symbol{height:36px;padding:0 8px;font-size:.8rem}body main .toolbar .quote-chip{font-size:.56rem}'
    + 'body main .toolbar .depth-toggle,body main .toolbar #mem-algo-toggle,body main .toolbar #smc-toggle{height:36px;padding:0 10px;font-size:.62rem;line-height:34px}'
    + 'body main .toolbar button.academy-broker-buy{height:36px;padding:0 8px;font-size:.64rem;border-width:1px}'
    + 'body main .chart .academy-chart-tools{padding:4px 6px;gap:5px}body main .chart .academy-chart-tools select,body main .chart .academy-chart-tools button{height:38px;padding:0 10px;font-size:.64rem}'
    + 'body main .chart>.intervals{margin:4px 0 0;gap:4px}body main .chart>.intervals button{min-height:36px;padding:0 11px;font-size:.68rem}body main .chart>.intervals select{min-height:36px;font-size:.68rem}'
    /* three controls other modules drop into these rows with their own inline or lazy styles: the MIDDAY pill
       (click-alert-ui), the DATA chip (data-chip) and Unlock Tools in the top bar. Same tap size as their neighbours. */
    + 'body main .toolbar #midday-report-toggle{height:36px;line-height:24px}body main .toolbar .data-chip{min-height:34px;padding:0 10px;font-size:.62rem}body main .bar #academy-unlock{height:34px;line-height:32px;padding:0 7px}'
    + 'body main .chart{padding:3px}'
    /* below the chart */
    + 'body .academy-below{padding:10px 8px;min-height:0}body .academy-below .below-title{margin:0 0 8px;font-size:.66rem}'
    + 'body .academy-below .options-chain{margin-top:10px;padding:10px}body .academy-below .options-chain h2{font-size:.82rem;margin:0 0 3px}body .academy-below .options-chain p{font-size:.66rem;line-height:1.4}'
    + 'body .academy-below .options-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:end}body .academy-below .options-actions label{flex:1 1 45%;font-size:.6rem}body .academy-below .options-chain button{margin-top:6px;padding:7px 10px;font-size:.7rem}'
    + 'body .academy-below .options-glossary{margin-top:8px;padding:8px;font-size:.62rem;line-height:1.45}'
    + 'body .academy-below .options-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}body .academy-below .options-table{font-size:.6rem;min-width:0}body .academy-below .options-table th,body .academy-below .options-table td{padding:5px 4px;white-space:nowrap}'
    + 'body .academy-below .options-table th:nth-child(-n+7),body .academy-below .options-table td:nth-child(-n+7),body .academy-below .options-table th:nth-child(n+15),body .academy-below .options-table td:nth-child(n+15){display:none}'
    + 'body .academy-below .options-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}body .academy-below .options-summary span{font-size:.58rem}body .academy-below .options-summary b{font-size:.72rem}'
    + 'body .academy-below .options-contract{grid-template-columns:1fr}body .academy-below .options-contract article{padding:8px}body .academy-below .options-contract h3{font-size:.66rem}body .academy-below .options-contract p{font-size:.62rem}'
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
    + 'body #academy-profile-btn,body #aa-btn{font-size:0!important;width:36px;height:36px;padding:0!important;border-radius:50%!important;opacity:.88}body #academy-profile-btn:before{content:"\\1F464";font-size:16px;line-height:36px}body #aa-btn:before{content:"Aa";font-size:12px;font-weight:900;line-height:36px}'
    + 'body .academy-below .academy-scan-table{min-width:0;width:100%;table-layout:fixed;font-size:.62rem;font-variant-numeric:tabular-nums}body .academy-below .academy-scan-table th[data-sort=symbol]{width:25%}body .academy-below .academy-scan-table th[data-sort=price],body .academy-below .academy-scan-table th[data-sort=changePct],body .academy-below .academy-scan-table th[data-sort=volume]{width:25%}body .academy-below .academy-scan-table td{overflow:hidden;text-overflow:clip}body .academy-below{padding-bottom:92px}'
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
      const short = 'MEM';
      if (phone && title.textContent !== short) title.textContent = short;
      else if (!phone && title.textContent !== title.dataset.full) title.textContent = title.dataset.full;
    }
    /* "Unlock Academy Tools" / "Close Academy Tools" are shortened on a phone so the header fits one row */
    const unlock = document.getElementById('academy-unlock');
    if (unlock) {
      const t = unlock.textContent;
      if (phone && /Academy Tools/.test(t)) unlock.textContent = t.replace('Academy Tools', 'Tools');
      else if (!phone && /^(Unlock|Close) Tools$/.test(t)) unlock.textContent = t.replace('Tools', 'Academy Tools');
    }
    /* "Buy INTC on Robinhood ↗" ×3 cannot share a phone row; the short broker names can */
    for (const b of document.querySelectorAll('.academy-broker-buy')) {
      b.classList.toggle('academy-broker-short', phone);
      const want = phone ? b.dataset.short : b.dataset.full;
      if (want && b.textContent !== want) b.textContent = want;
    }
    /* intervals: under the chart on a phone, back in the toolbar on a wide screen */
    const intervals = document.querySelector('main .intervals');
    const chart = document.querySelector('main .chart');
    const stage = chart && (chart.querySelector(':scope > .academy-chart-stage') || chart.querySelector(':scope > canvas#chart'));
    const toolbar = document.querySelector('main .toolbar');
    if (intervals && chart && stage && toolbar) {
      if (phone && intervals.parentElement !== chart) stage.insertAdjacentElement('afterend', intervals);
      else if (!phone && intervals.parentElement !== toolbar) {
        const company = toolbar.querySelector('#company');
        if (company) company.insertAdjacentElement('afterend', intervals); else toolbar.appendChild(intervals);
      }
    }
    /* with the Load button hidden, leaving the ticker box loads what was typed (Enter already does) */
    const symbolInput = document.getElementById('symbol');
    if (symbolInput && !symbolInput.dataset.mobileLoad) {
      symbolInput.dataset.mobileLoad = '1';
      symbolInput.setAttribute('enterkeyhint', 'go');
      symbolInput.setAttribute('autocapitalize', 'characters');
      symbolInput.addEventListener('change', () => {
        if (!mq.matches) return;
        const typed = symbolInput.value.trim().toUpperCase();
        const current = String(new URLSearchParams(location.search).get('symbol') || '').toUpperCase();
        const load = document.getElementById('load');
        if (typed && typed !== current && load) load.click();
      });
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
    /* the Signals pill (owner): in the header beside Alerts on a phone; a desktop floats it or docks it in the bar rail */
    const sig = document.getElementById('sml-sig-fab');
    if (sig && bar) {
      if (phone && sig.parentElement !== bar) {
        const alerts = document.getElementById('academy-alerts-fab');
        if (alerts && alerts.parentElement === bar) alerts.insertAdjacentElement('afterend', sig); else bar.appendChild(sig);
      } else if (!phone && sig.parentElement === bar) {
        document.body.appendChild(sig);
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
  /* live ticks rewrite scanner and SIRE cells many times a second; those never change the layout this file manages, so they must not trigger a pass */
  const observer = new MutationObserver((records) => { if (records.every((r) => { const t = r.target && (r.target.nodeType === 1 ? r.target : r.target.parentElement); return t && t.closest && t.closest('.academy-scan-table, #sire-panel, .academy-scan-pages, #academy-scan-count'); })) return; schedule(); });
  observer.observe(document.body, { childList: true, subtree: true });
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', schedule); else mq.addListener(schedule);
  window.addEventListener('resize', () => { clearTimeout(apply.r); apply.r = setTimeout(apply, 120); });
})();
