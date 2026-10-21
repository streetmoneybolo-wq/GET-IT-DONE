/* Toolbar navigation for the Academy Live Chart Lab. Every tool adds its own toggle straight to `.toolbar`, in whatever
 * order its script happened to boot, so the row became a flat, ever-growing line of twenty-odd buttons with no logic a
 * trader could follow. This file does no analysis of its own: it reparents the buttons those files already created into
 * one TOOL RAIL of four labeled groups, in the order a trader reaches for them, and keeps every tool visible:
 *
 *   CHART  what is drawn on the candles          WALLS · COST · HEAT · SMC · INTENT · TARGETS
 *   FLOW   who is buying and selling             BUY/SELL · DARK POOL · SHORT SALE · SENTIMENT · SQUEEZE (owner)
 *   DESK   the panels that take the lower deck   CHAIN · MEM ALGO · SIRE · EARNINGS · CATALYSTS · PAPER · CHALLENGE (owner)
 *   SHARE  talk about it, post it, be told       TALK · SNAP · ALERT
 *
 * Reparenting keeps each button's handler and state exactly as they were; nothing about how a tool works changes, only
 * where its button lives. The rail is one full-width line inside the toolbar (so the chart grid is untouched): on wide
 * screens the groups sit side by side; below 900px it becomes one scrolling row with the group names as dividers. A GUIDE
 * button lists every tool with the one-line explanation each already carries, and opens it on tap. On phones the quote
 * column is display:none, so the FLOW boxes it holds (buy/sell, dark pool, short sale, sentiment) were unreachable: a
 * QUOTE button there shows that column as a bottom sheet, and turning a FLOW tool on opens it. Late-booting buttons are
 * caught by a MutationObserver, so a tool that appears a minute in still lands in its group. */
(() => {
  if (window.__smlToolbarNav) return;
  window.__smlToolbarNav = true;

  const GROUPS = [
    { key: 'chart', label: 'CHART', hint: 'Drawn on the candles', ids: ['depth-walls', 'depth-cost', 'heat-toggle', 'smc-toggle', 'levels-toggle', 'intent-btn', 'targets-toggle'] },
    { key: 'flow', label: 'FLOW', hint: 'Who is buying and selling', ids: ['buysell-toggle', 'darkpool-toggle', 'shortsale-toggle', 'sentiment-toggle', 'squeeze-btn'] },
    { key: 'desk', label: 'DESK', hint: 'Panels that take the lower deck', ids: ['chain-toggle', 'mem-algo-toggle', 'sire-toggle', 'earnings-toggle', 'catalysts-toggle', 'paper-toggle', 'challenge-toggle'] },
    { key: 'share', label: 'SHARE', hint: 'Talk about it, post it, be told', ids: ['talk-btn', 'snap-toggle', 'click-alert-toggle', 'article-btn'] }
  ];
  const FLOW_BOXES = ['buysell-toggle', 'darkpool-toggle', 'shortsale-toggle', 'sentiment-toggle'];
  const ALL_IDS = GROUPS.flatMap((g) => g.ids);
  const phone = () => window.matchMedia('(max-width:720px)').matches;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = '#tool-rail{order:5;flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:stretch;gap:4px 6px;min-width:0;margin:2px 0 0;padding:3px 0 0;border-top:1px solid #16303b}'
    + '#tool-rail .tg{display:flex;align-items:center;gap:3px;padding:2px 5px 2px 3px;border:1px solid #16303b;border-radius:7px;background:#0b151d;min-width:0}'
    + '#tool-rail .tg>b{flex:none;padding:0 4px;color:#5f7986;font:800 .52rem ui-monospace,monospace;letter-spacing:.1em;cursor:default}'
    + '#tool-rail .tg .row{display:flex;flex-wrap:nowrap;gap:3px;min-width:0}'
    + '#tool-rail .tg .row>button{margin:0!important;order:0!important;white-space:nowrap;height:22px;padding:0 7px!important;font-size:.56rem!important;line-height:20px;letter-spacing:.03em}#tool-rail .tg:empty{display:none}'
    + '#tool-rail .tg.has-on{border-color:#2b5362}#tool-rail .tg.has-on>b{color:#9ed3e6}'
    + '#tool-rail .tail{margin-left:auto;display:flex;align-items:center;gap:4px}'
    + '#tool-guide-btn,#tool-quote-btn{flex:none;padding:4px 8px;border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}'
    + '#tool-guide-btn.on,#tool-quote-btn.on{background:#1c3444;border-color:#6fb8e0;color:#fff}#tool-quote-btn{display:none}'
    /* narrow: one scrolling line, the group names become dividers */
    + '@media(max-width:1100px){#tool-rail{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;gap:4px}#tool-rail::-webkit-scrollbar{display:none}'
    + '#tool-rail .tg{flex:none;border:0;background:none;padding:0;gap:2px}#tool-rail .tg .row{flex-wrap:nowrap}#tool-rail .tg>b{padding:0 3px 0 6px;border-left:1px solid #1f3a46}#tool-rail .tg:first-child>b{border-left:0;padding-left:2px}'
    + '#tool-rail .tail{margin-left:4px;flex:none}}'
    + '@media(max-width:720px){#tool-quote-btn{display:inline-block}'
    /* the quote column as a bottom sheet on phones, where it is otherwise display:none */
    + 'body.sml-quote-open main .side{display:flex!important;position:fixed;left:0;right:0;bottom:0;height:62dvh;z-index:2147483120;border-top:2px solid #2b5362;border-left:0;border-radius:14px 14px 0 0;box-shadow:0 -14px 40px rgba(0,0,0,.6);overflow:auto!important;padding-top:34px}'
    + 'body.sml-quote-open main .side>.academy-tape{flex:none;max-height:160px}'
    + '#tool-quote-close{display:none;position:fixed;left:0;right:0;bottom:calc(62dvh - 32px);z-index:2147483121;height:32px;border:0;border-radius:14px 14px 0 0;background:#13242d;color:#9ed3e6;font:800 .62rem ui-monospace,monospace;letter-spacing:.08em}body.sml-quote-open #tool-quote-close{display:block}}'
    /* desktop: the four groups are tabs on one line (the active group's buttons beside them), so the rail is one row, not two or three */
    + '@media(min-width:721px){#tool-rail{order:-1!important;max-width:100%;flex:0 1 auto!important;flex-wrap:nowrap!important;overflow:visible!important;margin:0!important;padding:0!important;border-top:0!important;align-items:center;gap:4px}'
    + '#tool-rail .tg{display:contents}#tool-rail .tg>b{order:0;cursor:pointer;padding:4px 9px;margin:0;border:1px solid #1f3a46!important;border-radius:6px;background:#0b151d;color:#7f98a6;font:800 .56rem ui-monospace,monospace;letter-spacing:.1em}'
    + '#tool-rail .tg>b:hover{color:#dbe6ec}#tool-rail .tg.sml-tab-on>b{background:#16303b;border-color:#2b6a86!important;color:#fff}#tool-rail .tg.has-on>b:after{content:" \\25CF";color:#52e6ad;font-size:.5rem}'
    + '#tool-rail .tg:not(.sml-tab-on)>.row{display:none}#tool-rail .tg>.row{order:2;padding:0 0 0 2px}#tool-rail .tail{order:3}}'
    /* the guide: every tool, its group and its own one-line explanation */
    + '#tool-guide{position:fixed;z-index:2147483300;top:50px;right:10px;width:min(560px,calc(100vw - 20px));max-height:calc(100dvh - 64px);display:none;flex-direction:column;background:#0b141c;border:1px solid #2b5362;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6);color:#dbe6ec;font:500 .7rem/1.4 system-ui,sans-serif;overflow:hidden}#tool-guide.open{display:flex}'
    + '#tool-guide header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #1b3540;flex:none}#tool-guide header b{font:900 .76rem ui-monospace,monospace;letter-spacing:.06em;color:#9ed3e6}#tool-guide header small{color:#7f98a6}#tool-guide header .x{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px;cursor:pointer}'
    + '#tool-guide .body{overflow:auto;padding:6px 10px 10px}#tool-guide h4{margin:8px 0 4px;font:800 .58rem ui-monospace,monospace;letter-spacing:.1em;color:#5f7986}#tool-guide h4 span{color:#8fa6b3;font-weight:600;letter-spacing:0;margin-left:6px}'
    + '#tool-guide .t{display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:start;padding:5px 6px;border-radius:7px;cursor:pointer}#tool-guide .t:hover{background:rgba(158,211,230,.07)}#tool-guide .t b{font:800 .62rem ui-monospace,monospace;color:#fff}#tool-guide .t b.on:after{content:" ●";color:#52e6ad}#tool-guide .t span{color:#9fb3be}'
    + '#tool-guide .foot{padding:8px 12px;border-top:1px solid #13262f;color:#6f8794;font-size:.58rem}'
    + '#tool-guide .tips{cursor:default}#tool-guide .tips span{display:flex;flex-wrap:wrap;gap:4px 6px}#tool-guide .tips a{color:#9ed3e6;text-decoration:none;font:700 .64rem system-ui,sans-serif;padding:2px 7px;border-radius:999px;background:rgba(158,211,230,.09)}#tool-guide .tips a:hover{background:rgba(0,226,154,.18);color:#00e29a}'
    + '@media(max-width:720px){#tool-guide{top:auto;bottom:0;left:0;right:0;width:auto;max-height:72dvh;border-radius:14px 14px 0 0}#tool-guide .t{grid-template-columns:84px 1fr}}';
  document.head.appendChild(style);

  let rail = null, guide = null, quoteBtn = null, quoteClose = null;
  function build(toolbar) {
    rail = document.createElement('div'); rail.id = 'tool-rail'; rail.setAttribute('aria-label', 'Chart tools');
    rail.innerHTML = GROUPS.map((g) => '<div class="tg" data-group="' + g.key + '"><b title="' + esc(g.hint) + '">' + g.label + '</b><div class="row"></div></div>').join('')
      + '<div class="tail"><button type="button" id="tool-quote-btn" title="Price, book, tape and the flow panels (the quote column)">QUOTE</button><button type="button" id="tool-guide-btn" title="What every tool does, in one line each">GUIDE</button></div>';
    toolbar.appendChild(rail);
    guide = document.createElement('section'); guide.id = 'tool-guide'; guide.setAttribute('aria-label', 'Tool guide'); document.body.appendChild(guide);
    quoteClose = document.createElement('button'); quoteClose.type = 'button'; quoteClose.id = 'tool-quote-close'; quoteClose.textContent = '▾ CLOSE QUOTE'; document.body.appendChild(quoteClose);
    rail.addEventListener('click', (e) => { const b = e.target.closest ? e.target.closest('.tg>b') : null; if (b) setTab(b.parentElement.dataset.group); });
    quoteBtn = rail.querySelector('#tool-quote-btn');
    const guideBtn = rail.querySelector('#tool-guide-btn');
    guideBtn.addEventListener('click', (e) => { e.stopPropagation(); setGuide(!guide.classList.contains('open')); });
    quoteBtn.addEventListener('click', () => setQuote(!document.body.classList.contains('sml-quote-open')));
    quoteClose.addEventListener('click', () => setQuote(false));
    guide.addEventListener('click', (e) => {
      const t = e.target.closest ? e.target.closest('[data-close],[data-tool],[data-tip],[data-walk]') : null; if (!t) return; e.preventDefault();
      if (t.dataset.close) { setGuide(false); return; }
      if (t.dataset.walk) { setGuide(false); if (window.smlTour && window.smlTour.run) window.smlTour.run(t.dataset.walk === 'menu' ? undefined : t.dataset.walk); return; }
      if (t.dataset.tip) { if (window.smlAutoTour && window.smlAutoTour.explain) { if (phone()) setGuide(false); window.smlAutoTour.explain(t.dataset.tip); } return; }
      const btn = document.getElementById(t.dataset.tool); if (btn) { showGroupOf(btn); btn.click(); setTimeout(paintGuide, 150); if (phone()) setGuide(false); }
    });
    document.addEventListener('click', (e) => { if (guide.classList.contains('open') && !guide.contains(e.target) && e.target !== guideBtn) setGuide(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (guide.classList.contains('open')) setGuide(false); else if (document.body.classList.contains('sml-quote-open')) setQuote(false); } });
    /* turning a FLOW tool on from a phone shows the column its box lives in */
    rail.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('button') : null; if (!b || !FLOW_BOXES.includes(b.id) || !phone()) return;
      setTimeout(() => { if (b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true') setQuote(true); }, 80);
    });
    window.addEventListener('resize', () => { if (!phone() && document.body.classList.contains('sml-quote-open')) setQuote(false); });
    /* the ● marks in the rail and the guide follow each tool's own on state */
    new MutationObserver(() => { clearTimeout(paint.t); paint.t = setTimeout(paint, 60); }).observe(rail, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-pressed'] });
  }
  /* the active tab: remembered, else the group that has a tool on, else CHART */
  function setTab(key) {
    if (!rail) return;
    const tgs = [...rail.querySelectorAll('.tg')]; if (!tgs.length) return;
    const pick = tgs.find((t) => t.dataset.group === key) || tgs[0];
    tgs.forEach((t) => t.classList.toggle('sml-tab-on', t === pick));
    try { localStorage.setItem('sml-rail-tab', pick.dataset.group); } catch (_) { /* ignore */ }
  }
  function initTab() {
    if (!rail || rail.querySelector('.tg.sml-tab-on')) return;
    let k = ''; try { k = localStorage.getItem('sml-rail-tab') || ''; } catch (_) { /* default */ }
    const on = [...rail.querySelectorAll('.tg.has-on')][0];
    setTab(on ? on.dataset.group : k || 'chart');
  }
  const showGroupOf = (b) => { const g = b && b.closest && b.closest('.tg'); if (g && !g.classList.contains('sml-tab-on')) setTab(g.dataset.group); };
  const isOn = (b) => b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true';
  function paint() {
    if (!rail) return;
    for (const g of rail.querySelectorAll('.tg')) g.classList.toggle('has-on', [...g.querySelectorAll('button')].some(isOn));
    if (guide && guide.classList.contains('open')) paintGuide();
  }
  function setQuote(on) { document.body.classList.toggle('sml-quote-open', on); if (quoteBtn) quoteBtn.classList.toggle('on', on); }
  function setGuide(on) { guide.classList.toggle('open', on); const b = document.getElementById('tool-guide-btn'); if (b) b.classList.toggle('on', on); if (on) paintGuide(); }
  /* every voiced tool tip, browsable and playable from here (academy/tour-content.js); owner-only tools stay out for everyone else */
  function tipsHtml() {
    const cat = window.__smlTourCatalog || {}, tools = cat.tools || {}, owner = !!window.smlOwner;
    const ids = Object.keys(tools).filter((id) => !(tools[id].ownerOnly && !owner));
    if (!ids.length) return '';
    const byGroup = {}; ids.forEach((id) => { (byGroup[tools[id].group || 'TOOL'] = byGroup[tools[id].group || 'TOOL'] || []).push(id); });
    const walks = Object.keys(cat.playbooks || {});
    return '<h4>VOICE TIPS<span>tap to hear and read it</span></h4>'
      + (walks.length ? '<div class="t" data-walk="menu"><b>WALKTHROUGHS</b><span>step-by-step guided lessons, ' + walks.length + ' of them</span></div>' : '')
      + Object.keys(byGroup).map((g) => '<div class="t tips"><b>' + esc(g) + '</b><span>' + byGroup[g].map((id) => '<a href="#" role="button" data-tip="' + esc(id) + '">&#9654; ' + esc(tools[id].name) + '</a>').join(' ') + '</span></div>').join('')
      + (walks.length ? '<h4>PLAYBOOKS<span>narrated, hands-on</span></h4><div class="t tips"><b>LEARN</b><span>' + walks.map((n) => '<a href="#" role="button" data-walk="' + esc(n) + '">&#9654; ' + esc(cat.playbooks[n].title) + '</a>').join(' ') + '</span></div>' : '');
  }
  function paintGuide() {
    const groups = GROUPS.map((g) => {
      const items = g.ids.map((id) => document.getElementById(id)).filter((b) => b && getComputedStyle(b).display !== 'none');
      if (!items.length) return '';
      return '<h4>' + g.label + '<span>' + esc(g.hint) + '</span></h4>' + items.map((b) => '<div class="t" data-tool="' + esc(b.id) + '"><b class="' + (isOn(b) ? 'on' : '') + '">' + esc(b.textContent.trim().slice(0, 18)) + '</b><span>' + esc((b.title || b.getAttribute('aria-label') || '').split(/\.\s|\(/)[0].slice(0, 140) || 'Opens ' + b.textContent.trim()) + '</span></div>').join('');
    }).join('');
    guide.innerHTML = '<header><b>TOOL GUIDE</b><small>tap a tool to open it · ● is on</small><button type="button" class="x" data-close="1" aria-label="Close">×</button></header><div class="body">' + (groups || '<div class="t"><span>The tools are still loading.</span></div>') + '</div>'
      + tipsHtml() + '<div class="foot">CHART tools draw on the candles · FLOW tools read who is buying and selling · DESK panels take the lower deck · SHARE posts and alerts. Pop any panel out with ⧉; Aa changes the look; ⚙ picks your buy buttons.</div>';
  }

  /* reparent every known button into its group; a button that boots late is caught by the observer below */
  function collect() {
    if (!rail) return;
    for (const g of GROUPS) {
      const row = rail.querySelector('.tg[data-group="' + g.key + '"] .row');
      const want = g.ids.map((id) => document.getElementById(id)).filter((b) => b && !b.dataset.ownerSlot);
      /* the designed order, whatever order the tools booted in; re-appending only when something is out of place */
      const have = [...row.children];
      if (want.length !== have.length || want.some((b, i) => have[i] !== b)) for (const b of want) row.appendChild(b);
    }
    initTab();
    paint();
  }

  function boot(tries) {
    const toolbar = document.querySelector('main .toolbar') || document.querySelector('.toolbar');
    if (!toolbar) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
    build(toolbar);
    collect();
    const obs = new MutationObserver((records) => { if (records.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && (ALL_IDS.includes(n.id) || (n.querySelector && ALL_IDS.some((id) => n.querySelector('#' + id))))))) collect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    let sweeps = 0;
    const sweep = setInterval(() => { collect(); sweeps += 1; if (sweeps > 40) clearInterval(sweep); }, 750);
  }
  boot(0);
  window.smlToolRail = { groups: GROUPS, collect, tab: setTab, showGroupOf, guide: setGuide, quote: setQuote };
})();
