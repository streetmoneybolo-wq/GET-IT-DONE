/* Phone workspace for the Academy Live Chart Lab (<=720px). Loaded after academy-mobile-compact.js. Desktop is untouched.
 *
 * On a phone every tool used to open as a sheet or a floating panel over the chart (the quote column, MEM ALGO, SIRE, the
 * Smart-money map, Ticker Talk), and the twenty tool buttons were one long scrolling rail. This file turns the phone into a
 * workspace laid out like a stock page: QUOTES (the default) and STOCK along the bottom, and under the symbol and price a tab
 * strip (Chart, Flow, Options, Algo, Comments), each tab with its related modules as sub-tabs. Every panel sits in the page
 * flow UNDER the chart instead of on top of it:
 *
 *   QUOTES   the default: the live quotes (scanner) on top, the Academy chat below
 *   CHART    the full chart; the chart tools (WALLS COST HEAT SMC INTENT) as chips
 *   FLOW     QUOTE+BOOK . BUY/SELL . DARK POOL . SHORT SALE . SENTIMENT . SQUEEZE
 *   OPTIONS  CHAIN . CALCULATOR . CONTRACT (the breakdown of the contract you picked)
 *   ALGO     MEM ALGO . SMC . SIRE . MARKET . EARNINGS . CATALYSTS . PAPER . CHALLENGE
 *   TALK     COMMENTS (Ticker Talk for the stock on the chart) . CHAT
 *
 * The chart stays at the top of every tool tab at a compact height; the tab's modules sit below it and the page scrolls, so
 * an insight or a breakdown never hides a candle. This file owns no data: a chip turns the tool's own button on (so its state
 * and fetching stay where they were) and the CSS decides what is shown. The old tool rail, the quote bottom sheet and the
 * below-the-chart view cycle are hidden on a phone because these tabs replace them. */
(() => {
  if (window.__smlMobileShell) return;
  window.__smlMobileShell = 1;
  const MQ = window.matchMedia('(max-width:720px)');
  const byId = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TABS = [
    { id: 'quotes', label: 'QUOTES', ico: '📈' },
    { id: 'chart', label: 'CHART', ico: '🕯' },
    { id: 'flow', label: 'FLOW', ico: '🌊' },
    { id: 'options', label: 'OPTIONS', ico: '⚙' },
    { id: 'algo', label: 'ALGO', ico: '🧠' },
    { id: 'talk', label: 'TALK', ico: '💬' }
  ];
  /* sub-tabs. `btn` is the tool's own toggle (turned on when the sub-tab opens); on the CHART tab the chips are the toggles themselves */
  const SUBS = {
    chart: [['walls', 'WALLS', 'depth-walls'], ['cost', 'COST', 'depth-cost'], ['heat', 'HEAT', 'heat-toggle'], ['smc', 'SMC', 'smc-toggle'], ['levels', 'LEVELS', 'levels-toggle'], ['intent', 'INTENT', 'intent-btn'], ['targets', 'TARGETS', 'targets-toggle']],
    flow: [['quote', 'QUOTE · BOOK', ''], ['buysell', 'BUY/SELL', 'buysell-toggle'], ['dark', 'DARK POOL', 'darkpool-toggle'], ['short', 'SHORT SALE', 'shortsale-toggle'], ['sent', 'SENTIMENT', 'sentiment-toggle'], ['squeeze', 'SQUEEZE', 'squeeze-btn']],
    options: [['chain', 'CHAIN', ''], ['calc', 'CALCULATOR', ''], ['contract', 'CONTRACT', '']],
    algo: [['mem', 'MEM ALGO', 'mem-algo-toggle'], ['smc', 'SMC', 'smc-toggle'], ['sire', 'SIRE', 'sire-toggle'], ['market', 'MARKET', ''], ['earn', 'EARNINGS', 'earnings-toggle'], ['cat', 'CATALYSTS', 'catalysts-toggle'], ['paper', 'PAPER', 'paper-toggle'], ['chal', 'CHALLENGE', 'challenge-toggle']],
    talk: [['comments', 'COMMENTS', 'talk-btn'], ['chat', 'CHAT', ''], ['edition', 'EDITION', 'edition-btn']]
  };
  const STOCK_TABS = [['chart', 'Chart'], ['flow', 'Flow'], ['options', 'Options'], ['algo', 'Algo'], ['talk', 'Comments']];
  const S = { tab: 'chart', stock: 'chart', sub: { flow: 'quote', options: 'chain', algo: 'mem', talk: 'comments' } };
  const isOn = (b) => !!b && (b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true');
  const shown = (b) => !!b && getComputedStyle(b).display !== 'none';
  const ensureOn = (id) => { const b = byId(id); if (b && !isOn(b)) b.click(); };
  const ensureOff = (id) => { const b = byId(id); if (b && isOn(b)) b.click(); };

  const A = 'html body.sml-ms';
  const css = [
    ':root{--ms-nav-h:54px;--ms-sub-h:0px}',
    A + '{padding-bottom:calc(env(safe-area-inset-bottom,0px) + var(--sml-inset-bottom,0px))!important}',
    /* what the tabs replace */
    /* the hover mini chart is a mouse feature: a tap loads the symbol on the chart tab instead */
    A + ' #sml-scan-pop{display:none!important}',
    A + ' main .bar{overflow-x:auto;scrollbar-width:none}' + A + ' main .bar::-webkit-scrollbar{display:none}',
    A + ' #tool-rail,' + A + ' #tool-quote-btn,' + A + ' #tool-quote-close,' + A + ' .academy-view-cycle,' + A + ' #academy-below>.below-title{display:none!important}',
    /* The tab bar and the sub-tab bar sit in the page directly under the chart, never fixed to the bottom of the window: a fixed bar inside the
       Discord app floated up over the candles when the page was pulled past its top. They start at the chart's lower edge and, once the chart has scrolled
       away, pin to the top of the window so they stay in reach; they never sit over the chart. */
    '#ms-nav{display:none}' + A + ' #ms-nav{position:sticky;top:var(--sml-inset-top,0px);grid-column:1/-1;width:100%;margin:6px 0 0;z-index:9000;display:flex;height:var(--ms-nav-h);background:#08121a;border-top:1px solid #1f3a46;border-bottom:1px solid #1f3a46;box-shadow:0 8px 24px rgba(0,0,0,.45)}',
    A + ' #ms-nav button{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:0;background:none;color:#7f97a4;font:800 .5rem ui-monospace,monospace;letter-spacing:.06em;padding:4px 0}',
    A + ' #ms-nav button i{font-style:normal;font-size:1.05rem;line-height:1;filter:grayscale(.7)}',
    A + ' #ms-nav button.on{color:#7ef0bd;box-shadow:inset 0 2px 0 #00c47d;background:#0b1d22}' + A + ' #ms-nav button.on i{filter:none}',
    '#ms-sub{display:none}' + A + ' #ms-sub.has{position:sticky;top:calc(var(--sml-inset-top,0px) + var(--ms-nav-h));grid-column:1/-1;width:100%;box-sizing:border-box;z-index:8999;display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:6px 8px;background:#0a1620;border-top:1px solid #1b3540}',
    A + ' #ms-sub::-webkit-scrollbar{display:none}' + A + ' #ms-sub button{flex:none;height:30px;padding:0 11px;border:1px solid #2b4b5a;border-radius:15px;background:#0d1b25;color:#a9c3d0;font:800 .6rem ui-monospace,monospace;letter-spacing:.05em;white-space:nowrap}',
    A + ' #ms-sub button.on{background:#0b3b2e;border-color:#00c47d;color:#7ef0bd}' + A + ' #ms-sub button.lit{border-color:#3fd9a0;color:#d8fff0}',
    /* the floating round buttons ride above the bars */
    A + ' #sml-settings-btn,' + A + ' #aa-btn,' + A + ' #academy-profile-btn,' + A + ' #academy-ask-btn,' + A + ' #lb-btn{opacity:0!important;pointer-events:none!important}',
    '#ms-more{display:none}' + A + ' #ms-more.open{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;grid-column:1/-1;margin:8px;z-index:9001;padding:10px;background:#0a1620;border:1px solid #2b5362;border-radius:14px;box-shadow:0 -12px 40px rgba(0,0,0,.6)}',
    A + ' #ms-more button{display:flex;align-items:center;gap:8px;padding:12px 10px;border:1px solid #2b4b5a;border-radius:10px;background:#0d1b25;color:#d6e6ee;font:800 .72rem system-ui,sans-serif;text-align:left}',
    A + ' #ms-more button i{font-style:normal;font-size:1.1rem}',
    /* the quote column is never a bottom sheet: it is an in-flow module of the FLOW tab */
    A + '.sml-quote-open main .side{position:static!important;height:auto!important;max-height:none!important;border:0!important;box-shadow:none!important;z-index:auto!important}',
    A + ' main .side{display:none!important}',
  ];
  /* ---- every tool tab: the chart stays on top, compact, and the tab's modules flow beneath it ---- */
  const T = (tab, rest) => A + '[data-ms-tab=' + tab + '] ' + rest;
  const TS = (tab, sub, rest) => A + '[data-ms-tab=' + tab + '][data-ms-sub=' + sub + '] ' + rest;
  const tool = (rest) => ['flow', 'options', 'algo', 'talk'].map((t) => T(t, rest)).join(',');
  css.push(
    tool('main .chart') + '{display:flex!important;flex-direction:column!important;grid-template-rows:none!important;height:auto!important;min-height:0!important}',
    tool('main .chart>*') + '{flex:none;min-width:0}',
    T('quotes', 'main') + ',' + T('quotes', 'main .shell') + ',' + T('quotes', 'main .chart') + '{height:auto!important;min-height:0!important}',
    T('quotes', 'main .chart') + '{display:block!important;padding-bottom:0!important}',
    tool('main .chart .academy-chart-stage') + ',' + tool('main .chart>canvas#chart') + '{height:calc(clamp(190px,31svh,270px) + var(--ms-extra,0px))!important;min-height:0!important}',
    tool('main .chart>.academy-chart-tools') + ',' + tool('main .toolbar .academy-brokers') + ',' + tool('.academy-intelligence') + '{display:none!important}',
    /* the stock tabs sit right under the symbol and price, like a stock page: Chart . Flow . Options . Algo . Comments */
    '#ms-top{display:none}' + A + ':not([data-ms-tab=quotes]) #ms-top{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:0 4px;margin:0 0 2px;border-bottom:1px solid #16303b;background:#07101a}',
    A + ' #ms-top::-webkit-scrollbar{display:none}' + A + ' #ms-top button{flex:1 0 auto;position:relative;padding:10px 12px 9px;border:0;background:none;color:#8fa6b3;font:700 .86rem system-ui,sans-serif;white-space:nowrap}',
    A + ' #ms-top button.on{color:#fff;font-weight:900}' + A + ' #ms-top button.on:after{content:"";position:absolute;left:30%;right:30%;bottom:0;height:3px;border-radius:2px;background:#00c47d}',
    T('chart', 'main .chart') + '{display:flex!important;flex-direction:column!important;grid-template-rows:none!important;height:auto!important;min-height:0!important}',
    T('chart', 'main .chart>*') + '{flex:none;min-width:0}',
    /* ---- QUOTES (the default): quotes on top, chat below, no page scroll ---- */
    T('quotes', 'main .chart>:not(.toolbar)') + ',' + T('quotes', 'main .shell>.side') + ',' + T('quotes', '.academy-intelligence') + ',' + T('quotes', '#academy-below>:not(#academy-scanner-host):not(.academy-chat)') + '{display:none!important}',
    T('quotes', 'main .toolbar>:not(#symbol):not(.quote-chip)') + '{display:none!important}',
    T('quotes', '#academy-below') + '{display:flex!important;flex-direction:column;gap:6px;padding:6px 6px 0!important;overflow:hidden;height:calc(100svh - var(--ms-top,96px) - var(--ms-nav-h) - env(safe-area-inset-bottom,0px))}',
    T('quotes', '#academy-scanner-host') + '{flex:1 1 52%;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}',
    T('quotes', '.academy-chat') + ',' + T('chat-full', '.academy-chat') + '{flex:1 1 48%;min-height:0;margin:0!important;display:flex!important;flex-direction:column}',
    T('quotes', '.academy-chat-log') + '{flex:1 1 auto;height:auto!important;min-height:0}',
    T('quotes', '.academy-chat.sml-empty') + '{flex:0 0 auto}' + T('quotes', '.academy-chat.sml-empty .academy-chat-log') + '{flex:0 0 auto;height:64px!important}',
    T('quotes', '#academy-scanner-host') + '{flex:1 1 auto}',
    /* ---- CHART: the full chart; the deck under it is not shown ---- */
    T('chart', '#academy-below') + ',' + T('chart', 'main .shell>.side') + '{display:none!important}',
    /* ---- FLOW: the quote column in flow, one box at a time ---- */
    T('flow', '#academy-below') + '{display:none!important}',
    T('flow', 'main .shell>.side') + '{display:flex!important;position:static!important;flex-direction:column;width:auto!important;height:auto!important;max-height:none!important;margin:6px 4px 0;padding:8px 10px!important;border:1px solid #1f3a46!important;border-radius:12px!important;background:#0a141c;box-shadow:none!important}',
    T('flow', 'main .side>*') + '{display:none!important}',
    TS('flow', 'quote', 'main .side>:is(#label,#price,#change,.book,.academy-depth,.academy-tape,.academy-stats)') + '{display:block!important}',
    TS('flow', 'buysell', 'main .side>.academy-buysell') + ',' + TS('flow', 'dark', 'main .side>.academy-darkpool') + ',' + TS('flow', 'short', 'main .side>.academy-shortsale') + '{display:block!important}',
    TS('flow', 'sent', 'main .side>.academy-depth') + '{display:block!important}',
    TS('flow', 'sent', 'main .side>.academy-depth>*:not(.academy-sentiment)') + '{display:none!important}',
    TS('flow', 'squeeze', 'main .side>#label') + '{display:block!important}',
    /* ---- OPTIONS: chain / calculator in the deck, the picked contract in the quote column ---- */
    T('options', '#academy-below>:not(#options-dock)') + '{display:none!important}',
    T('options', '#academy-below') + '{display:block!important;padding:6px!important}',
    T('options', '#options-dock') + '{display:grid!important}',
    TS('options', 'chain', '#options-dock>.opt-calc') + ',' + TS('options', 'calc', '#options-dock>#options-chain') + '{display:none!important}',
    TS('options', 'contract', '#academy-below') + '{display:none!important}',
    T('options', 'main .shell>.side') + '{display:none!important}',
    TS('options', 'contract', 'main .shell>.side') + '{display:flex!important;position:static!important;flex-direction:column;width:auto!important;height:auto!important;max-height:none!important;margin:6px 4px 0;padding:8px 10px!important;border:1px solid #1f3a46!important;border-radius:12px!important;background:#0a141c;box-shadow:none!important}',
    TS('options', 'contract', 'main .side>*:not(#options-focus)') + '{display:none!important}',
    A + '.ms-focus-empty[data-ms-tab=options][data-ms-sub=contract] main .shell>.side:before{content:"Tap a contract in CHAIN and its breakdown lands here.";display:block;color:#7f97a4;font:600 .72rem/1.5 system-ui}',
    /* ---- ALGO: the chart-section panels and the deck panels, one at a time ---- */
    T('algo', '#academy-below>*') + '{display:none!important}',
    T('algo', '#academy-below') + '{display:block!important;padding:6px!important}',
    T('algo', 'main .shell>.side') + '{display:none!important}',
    TS('algo', 'market', '#academy-below>:is(.academy-market-trio,#academy-hedge,#candle-recap)') + ',' + TS('algo', 'earn', '#academy-below>#earnings-panel') + ',' + TS('algo', 'cat', '#academy-below>#catalysts-panel') + ',' + TS('algo', 'paper', '#academy-below>#paper-panel') + ',' + TS('algo', 'chal', '#academy-below>#challenge-panel') + '{display:block!important}',
    TS('algo', 'market', '#academy-below>.academy-market-trio') + '{display:grid!important}',
    /* panels that lived over the chart: in flow, only in their own sub-tab */
    A + ':not([data-ms-tab=algo]) :is(#mem-algo-panel,#mem-scn-strip,#sire-panel,#ms-slot-smc){display:none!important}',
    A + '[data-ms-tab=algo]:not([data-ms-sub=mem]) :is(#mem-algo-panel,#mem-scn-strip),' + A + '[data-ms-tab=algo]:not([data-ms-sub=sire]) #sire-panel,' + A + '[data-ms-tab=algo]:not([data-ms-sub=smc]) #ms-slot-smc{display:none!important}',
    A + ' main .chart #mem-algo-panel,' + A + '.chart-lock main .chart #sire-panel{position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:auto!important;max-height:none!important;margin:6px 0 0!important;z-index:auto!important;grid-column:1!important;box-shadow:none!important}',
    /* the Intent and Targets read-outs: an in-flow card right under the chart on the CHART tab, never a sheet over the candles */
    '#ms-slot-tools{display:none}' + A + '[data-ms-tab=chart] #ms-slot-tools{display:block;grid-column:1;margin:6px 0 0;min-width:0}',
    A + ' #ms-slot-tools>#intent-panel,' + A + ' #ms-slot-tools>#targets-panel{position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:auto!important;max-height:none!important;z-index:auto!important;margin:0 0 6px!important;overflow:visible!important;box-shadow:none!important;background:#07111a!important}',
    A + ' #ms-slot-smc{grid-column:1;margin:6px 0 0;min-width:0}' + A + ' #ms-slot-smc #smc-card{position:static!important;width:auto!important;max-height:none!important;right:auto!important;margin:0}',
    A + ' #sire-panel{font-size:.68rem!important;max-height:56svh!important;overflow:auto!important;margin:6px 0 0!important}',
    A + ' #sire-panel header{position:sticky!important;top:0!important}',
    /* ---- TALK: Ticker Talk for the stock in flow, or the full chat ---- */
    T('talk', '#academy-below') + '{display:none!important}',
    TS('talk', 'chat', '#academy-below') + '{display:flex!important;flex-direction:column;padding:6px!important;height:calc(100svh - var(--ms-top,96px) - var(--ms-nav-h) - var(--ms-sub-h) - env(safe-area-inset-bottom,0px) - 8px)}',
    TS('talk', 'chat', '#academy-below>:not(.academy-chat)') + '{display:none!important}',
    TS('talk', 'chat', '.academy-chat') + '{flex:1 1 auto;min-height:0;margin:0!important;display:flex!important;flex-direction:column}',
    TS('talk', 'chat', '.academy-chat-log') + '{flex:1 1 auto;height:auto!important;min-height:0}',
    TS('talk', 'comments', 'main .shell>.side') + '{display:flex!important;position:static!important;flex-direction:column;width:auto!important;height:auto!important;max-height:none!important;margin:6px 4px 0;padding:8px 10px!important;border:1px solid #1f3a46!important;border-radius:12px!important;background:#0a141c;box-shadow:none!important}',
    TS('talk', 'comments', 'main .side>*:not(#label):not(#price):not(#change):not(#talk-panel)') + '{display:none!important}',
    TS('talk', 'chat', 'main .shell>.side') + '{display:none!important}',
    A + ' #talk-panel.sheet{position:static!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;z-index:auto!important;height:calc(100svh - var(--ms-top,96px) - var(--ms-nav-h) - var(--ms-sub-h) - 70px)!important;min-height:300px;margin:6px 0 0!important;border:0!important;border-radius:10px!important;box-shadow:none!important}'
  );
  /* outside a phone width these bars never show, and the tab strip never takes a row in the chart's grid */
  css.unshift('html body:not(.sml-ms) #ms-nav,html body:not(.sml-ms) #ms-sub,html body:not(.sml-ms) #ms-more,html body:not(.sml-ms) #ms-top{display:none!important}');
  const style = document.createElement('style'); style.id = 'academy-mobile-shell';
  style.textContent = css[0] + '\n@media(max-width:720px){' + css.slice(1).join('\n') + '}';
  document.head.appendChild(style);

  let nav = null, sub = null, more = null, top = null;
  function build() {
    if (nav) return;
    nav = document.createElement('nav'); nav.id = 'ms-nav'; nav.setAttribute('aria-label', 'Academy sections');
    nav.innerHTML = '<button type="button" data-tab="quotes"><i>\uD83D\uDCC8</i>QUOTES</button><button type="button" data-stock="1"><i>\uD83D\uDD6F</i>STOCK</button><button type="button" data-proxy="academy-alerts-fab"><i>\uD83D\uDD14</i>ALERTS</button><button type="button" data-proxy="lesson-toggle"><i>\uD83C\uDF93</i>LESSONS</button><button type="button" data-more="1"><i>\u22EF</i>MORE</button>';
    top = document.createElement('div'); top.id = 'ms-top'; top.setAttribute('role', 'tablist');
    top.innerHTML = STOCK_TABS.map(([id, label]) => '<button type="button" role="tab" data-tab="' + id + '">' + label + '</button>').join('');
    top.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
    more = document.createElement('div'); more.id = 'ms-more';
    more.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-fab]'); if (!b) return; setMore(false); if (b.dataset.fab === '__tour') { if (window.smlTour) window.smlTour.start(true); return; } if (b.dataset.fab === '__room') { if (window.smlRoom) window.smlRoom.mine(); return; } const t = byId(b.dataset.fab); if (t) t.click(); });
    sub = document.createElement('div'); sub.id = 'ms-sub'; sub.setAttribute('role', 'tablist');
    place();
    nav.addEventListener('click', (e) => { const m = e.target.closest && e.target.closest('button[data-more]'); if (m) { setMore(!more.classList.contains('open')); return; } const px = e.target.closest && e.target.closest('button[data-proxy]'); if (px) { setMore(false); const t = byId(px.dataset.proxy); if (t) t.click(); return; } const st = e.target.closest && e.target.closest('button[data-stock]'); if (st) { setMore(false); setTab(S.tab === 'quotes' ? S.stock : S.tab); return; } const b = e.target.closest && e.target.closest('button[data-tab]'); if (b) { setMore(false); setTab(b.dataset.tab); } });
    sub.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-sub]'); if (b) pickSub(b.dataset.sub); });
  }
  const FABS = [['__tour', '\uD83E\uDDED', 'Take the tour'], ['sml-settings-btn', '\u2699', 'Settings'], ['academy-profile-btn', '\uD83D\uDC64', 'My profile'], ['__room', '\uD83C\uDFDB', 'My trading room'], ['aa-btn', 'Aa', 'Appearance'], ['lb-btn', '\uD83C\uDFC6', 'Leaderboard'], ['academy-ask-btn', '\uD83D\uDCAC', 'Ask the Academy']];
  function setMore(on) {
    if (!more) return;
    if (on) more.innerHTML = FABS.filter(([id]) => (id === '__tour' ? !!window.smlTour : id === '__room' ? !!window.smlRoom : byId(id) && getComputedStyle(byId(id)).display !== 'none')).map(([id, ico, label]) => '<button type="button" data-fab="' + id + '"><i>' + ico + '</i>' + esc(label) + '</button>').join('');
    more.classList.toggle('open', !!on);
    const mb = nav && nav.querySelector('[data-more]'); if (mb) mb.classList.toggle('on', !!on);
  }
  /* the bars live right after the chart card, in order: the tabs, their sub-tabs, the MORE sheet; anything else that lands between is moved past */
  function place() {
    const chart = document.querySelector('main .chart'); if (!chart || !nav) return;
    if (chart.nextElementSibling !== nav) chart.after(nav);
    if (nav.nextElementSibling !== sub) nav.after(sub);
    if (sub.nextElementSibling !== more) sub.after(more);
  }
  /* a slot under the chart for the Smart-money map card (academy-smart-money-ui.js moves its card in) */
  function slots() {
    const chart = document.querySelector('main .chart'); if (!chart) return;
    place();
    const tb = chart.querySelector(':scope>.toolbar');
    if (top && tb && document.body.classList.contains('sml-ms') && top.previousElementSibling !== tb) tb.after(top);
    if (!byId('ms-slot-smc')) { const d = document.createElement('div'); d.id = 'ms-slot-smc'; chart.appendChild(d); }
    if (!byId('ms-slot-tools')) { const d = document.createElement('div'); d.id = 'ms-slot-tools'; chart.appendChild(d); }
    dockPanels();
  }
  /* The Intent and Targets panels are made inside the chart stage (they float over it on a desktop). On the phone workspace they move
     into the slot under the chart, and scroll into view when they open, so a read-out never covers a candle. */
  const PANELS = ['intent-panel', 'targets-panel'], wasOpen = {};
  function dockPanels() {
    const slot = byId('ms-slot-tools'); if (!slot || !document.body.classList.contains('sml-ms')) return;
    for (const id of PANELS) {
      const p = byId(id); if (!p) continue;
      if (p.parentElement !== slot) slot.appendChild(p);
      const open = p.classList.contains('open');
      if (open && !wasOpen[id] && S.tab === 'chart' && p.scrollIntoView) { try { p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* older browsers */ } }
      wasOpen[id] = open;
    }
  }
  function undockPanels() {
    const st = document.querySelector('.academy-chart-stage');
    for (const id of PANELS) { const p = byId(id); if (p && st && p.parentElement !== st) st.appendChild(p); wasOpen[id] = false; }
    const slot = byId('ms-slot-tools'); if (slot) slot.remove();
  }
  function measure() {
    const bar = document.querySelector('main .toolbar') || document.querySelector('main .bar');
    if (bar) { const r = bar.getBoundingClientRect(); document.documentElement.style.setProperty('--ms-top', Math.max(60, Math.round(r.bottom + window.scrollY)) + 'px'); }
    document.documentElement.style.setProperty('--ms-sub-h', sub && sub.classList.contains('has') ? Math.round(sub.getBoundingClientRect().height || 44) + 'px' : '0px');
  }
  function renderSub() {
    const list = (SUBS[S.tab] || []).filter(([, , btn]) => !btn || (byId(btn) && shown(byId(btn))) || btn === 'talk-btn');
    sub.classList.toggle('has', list.length > 0);
    sub.innerHTML = list.map(([id, label, btn]) => {
      const on = S.tab === 'chart' ? isOn(byId(btn)) : S.sub[S.tab] === id;
      return '<button type="button" role="tab" data-sub="' + id + '" class="' + (on ? 'on' : '') + '">' + esc(label) + (S.tab !== 'chart' && btn && isOn(byId(btn)) && !on ? ' ●' : '') + '</button>';
    }).join('');
  }
  function apply() {
    const body = document.body;
    body.dataset.msTab = S.tab; body.dataset.msSub = S.sub[S.tab] || '';
    body.classList.toggle('ms-tool', ['flow', 'options', 'algo', 'talk'].includes(S.tab));
    nav.querySelectorAll('button[data-tab],button[data-stock]').forEach((b) => b.classList.toggle('on', b.dataset.stock ? S.tab !== 'quotes' : b.dataset.tab === S.tab));
    if (top) top.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    renderSub(); measure();
  }
  function setTab(id) {
    if (!TABS.some((t) => t.id === id)) return;
    const leaving = S.tab;
    S.tab = id; if (id !== 'quotes') S.stock = id;
    /* leaving a tab closes what it switched on that would otherwise take room elsewhere */
    if (leaving === 'talk' && id !== 'talk') { const p = byId('talk-panel'); if (p && p.classList.contains('open')) ensureOff('talk-btn'); }
    if (id === 'options') { ensureOff('chain-toggle'); const v = document.querySelector('.academy-view-cycle [data-view="options"]'); if (v) v.click(); }
    if (id === 'talk' && S.sub.talk === 'comments') ensureOn('talk-btn');
    if (id === 'algo') enter('algo', S.sub.algo);
    if (id === 'flow') enter('flow', S.sub.flow);
    apply();
    try { window.scrollTo(0, 0); } catch (_) { /* ignore */ }
  }
  /* the sub-tab's own tool is switched on so its data loads */
  function enter(tab, id) {
    const row = (SUBS[tab] || []).find((r) => r[0] === id); if (!row) return;
    const btn = row[2];
    if (btn && btn !== 'squeeze-btn') ensureOn(btn);
    if (btn === 'squeeze-btn') { const b = byId(btn); if (b && !isOn(b)) b.click(); }
    if (tab === 'algo' && id === 'smc') setTimeout(() => { const o = byId('smc-card') && byId('smc-card').querySelector('span[data-min]'); if (o && /open/i.test(o.textContent)) o.click(); }, 450);
    if (tab === 'algo' && id === 'earn') { const v = document.querySelector('.academy-view-cycle [data-view="earnings"]'); if (v) v.click(); }
    if (tab === 'talk' && id === 'comments') ensureOn('talk-btn');
    if (tab === 'talk' && id === 'chat') { const p = byId('talk-panel'); if (p && p.classList.contains('open')) ensureOff('talk-btn'); }
  }
  function pickSub(id) {
    if (S.tab === 'chart') { const row = SUBS.chart.find((r) => r[0] === id); const b = row && byId(row[2]); if (b) b.click(); setTimeout(() => { renderSub(); }, 80); return; }
    S.sub[S.tab] = id; enter(S.tab, id); apply();
  }

  /* a tap on a quote row loads the symbol (the scanner's own handler); the chart tab shows it */
  function wire() {
    const host = byId('academy-scanner-host');
    if (host && !host.__msWired) {
      host.__msWired = 1;
      host.addEventListener('click', (e) => { if (S.tab === 'quotes' && e.target.closest && e.target.closest('#academy-scan-body tr')) setTimeout(() => setTab('chart'), 220); });
    }
  }
  function tick() {
    if (!document.body.classList.contains('sml-ms')) return;
    slots(); wire(); rememberSymbol();
    document.body.classList.remove('sml-quote-open'); // the old quote sheet never opens on a phone
    const f = byId('options-focus'); document.body.classList.toggle('ms-focus-empty', !f || getComputedStyle(f).display === 'none' || !f.textContent.trim());
    renderSub(); measure();
  }
  /* the last stock the member left the Academy on: remembered while they use it, and restored when it opens with no symbol in its address */
  const LAST = 'sml-last-symbol', SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
  const lastSymbol = () => { try { const v = String(localStorage.getItem(LAST) || '').toUpperCase(); return SYM.test(v) ? v : ''; } catch (_) { return ''; } };
  /* only a stock the chart actually has candles for is remembered, so a typo or a delisted name never becomes the next start */
  function rememberSymbol() {
    const si = byId('symbol'); if (!si || document.activeElement === si) return;
    const v = String(si.value || '').trim().toUpperCase(); if (!SYM.test(v)) return;
    const m = window.smlChartModel && window.smlChartModel(); if (!m || String(m.symbol || '').toUpperCase() !== v || !(m.N > 0)) return;
    try { if (localStorage.getItem(LAST) !== v) localStorage.setItem(LAST, v); } catch (_) { /* storage can be blocked */ }
  }
  /* Opened with no symbol in its address: switch to the last stock with the chart's own in-page navigation. Never a reload: a second
     load inside Discord's frame never finishes its sign-in, which left the Academy stuck without its chart. */
  (function restoreSymbol() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('symbol') || u.searchParams.has('popout') || u.searchParams.has('perf')) return;
      const last = lastSymbol(); if (!last || last === 'SPY') return;
      let tries = 0;
      const go = () => { if (typeof window.smlAcademyNavigateMarket === 'function') { try { window.smlAcademyNavigateMarket(last); } catch (_) { /* the chart keeps SPY */ } return; } if (++tries < 40) setTimeout(go, 500); };
      setTimeout(go, 1200);
    } catch (_) { /* the Academy opens on its own default */ }
  })();
  /* Fit: on the tool tabs the chart takes whatever height the panel under it leaves free, so a short panel never strands an empty band
     above the sub-tab bar; a long panel gives it back (the chart never goes below its normal size). */
  let extra = 0;
  function fit() {
    const root = document.documentElement;
    if (!document.body.classList.contains('sml-ms')) return;
    const tool = ['flow', 'options', 'algo', 'talk'].includes(S.tab);
    if (!tool) { if (extra) { extra = 0; root.style.removeProperty('--ms-extra'); } return; }
    const free = window.innerHeight - Math.ceil(document.body.getBoundingClientRect().bottom + window.scrollY);
    if (Math.abs(free) < 6) return;
    const next = Math.max(0, Math.min(Math.round(window.innerHeight * 0.3), extra + free));
    if (next !== extra) { extra = next; root.style.setProperty('--ms-extra', extra + 'px'); }
  }
  let timer = null;
  function enable() {
    document.body.classList.add('sml-ms'); build(); slots();
    if (!timer) timer = setInterval(() => { tick(); fit(); }, 1200);
    apply(); tick();
  }
  function disable() {
    document.body.classList.remove('sml-ms', 'ms-tool', 'sml-quote-open'); delete document.body.dataset.msTab; delete document.body.dataset.msSub;
    for (const id of ['ms-top', 'ms-nav', 'ms-sub', 'ms-more']) { const el = byId(id); if (el) el.remove(); }
    nav = sub = more = top = null; /* the slot under the chart goes too: the chart's own grid is left exactly as it was */
    undockPanels();
    const slot = byId('ms-slot-smc'); if (slot) { const c = byId('smc-card'); if (c && slot.contains(c)) { const st = document.querySelector('.academy-chart-stage'); if (st) st.appendChild(c); } slot.remove(); }
    document.documentElement.style.removeProperty('--ms-top'); document.documentElement.style.removeProperty('--ms-extra'); document.documentElement.style.removeProperty('--ms-sub-h');
    if (timer) { clearInterval(timer); timer = null; }
  }
  setInterval(rememberSymbol, 2500);
  const sync = () => (MQ.matches ? enable() : disable());
  if (MQ.addEventListener) MQ.addEventListener('change', sync); else if (MQ.addListener) MQ.addListener(sync);
  window.addEventListener('resize', () => { if (MQ.matches) measure(); });
  window.addEventListener('orientationchange', () => setTimeout(measure, 250));
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync);
  window.smlMobileShell = { tab: setTab, sub: pickSub, state: () => ({ tab: S.tab, sub: { ...S.sub } }), tabs: TABS.map((t) => t.id) };
})();
