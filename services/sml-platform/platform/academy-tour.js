/* First-time walkthrough for the Academy (desktop and phone). A spotlight tour: the page dims, one control is lit at a time, and a
 * card says what it is, what it does and why it matters. It starts by itself ONCE for a member who has never seen it (after the
 * intro video), can be skipped at any step ("Skip tour" is the opt-out and is remembered), and can be run again from MORE on a
 * phone or the TOUR button on desktop (window.smlTour.start(true)). Steps whose control is not on screen are skipped, so the same
 * list works for every layout; phones use their own list (the bottom bar, the stock tabs). This file owns no data. */
(() => {
  if (window.__smlTour) return;
  window.__smlTour = 1;
  const KEY = 'sml-academy-tour-v1';
  const PHONE = () => window.matchMedia('(max-width:720px)').matches;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const seen = () => { try { return !!localStorage.getItem(KEY); } catch (_) { return false; } };
  const mark = (v) => { try { localStorage.setItem(KEY, v); } catch (_) { /* storage can be blocked: the tour then offers itself each visit, never twice in one */ } };

  const DESK = [
    { id: 'welcome', t: 'Welcome to the Academy', b: 'A live trading lab: real-time charts, order flow, dark pool prints, short-sale data, options and a signal engine, all in one place and all explained as you go. This takes about a minute.', adv: true },
    { id: 'symbol', s: 'input#symbol', t: 'Pick any stock', b: 'Type a ticker and press Enter or Load. The whole page follows the stock you pick: the chart, the quote column and every tool.' },
    { id: 'timeframe', s: '.intervals, .toolbar .intervals', t: 'Choose the timeframe', b: '1 minute for day trades up to 1 year for the big picture. The chart keeps your zoom when you switch.' },
    { id: 'chart', s: '.academy-chart-stage', t: 'The live chart', b: 'Drag to scan the past. Scroll to zoom. Drag the price axis on the right to stretch the scale. Hover for the exact open, high, low and close.', pad: 4 },
    { id: 'group-chart', s: '#tool-rail .tg[data-group=chart]', t: 'CHART tools', b: 'Draw what the big players are doing right on the candles: WALLS (big resting orders), COST (where holders are underwater), HEAT (order-book heat map), SMC (smart-money zones) and INTENT (the likely aim of the flow).' },
    { id: 'smc', s: '#smc-toggle', t: 'SMC: tap a zone, get the read', b: 'Switch SMC on, then click any zone on the chart. A full breakdown opens beside the chart (never over it): what the zone is, the evidence for it and a plain conclusion.' },
    { id: 'group-flow', s: '#tool-rail .tg[data-group=flow]', t: 'FLOW: who is buying and selling', b: 'BUY/SELL pressure, DARK POOL block prints, SHORT SALE data and SENTIMENT. This is the money behind the move, not just the price.' },
    { id: 'group-desk', s: '#tool-rail .tg[data-group=desk]', t: 'DESK panels', b: 'CHAIN opens the options chain. MEM ALGO shows five trade plans with entries, stops and targets. SIRE ranks movers, EARNINGS and CATALYSTS show what is coming.' },
    { id: 'side', s: 'main .side', pre: () => { const e = document.querySelector('main .side'); if (e) e.scrollTop = 0; }, t: 'Quote and book', b: 'Live price, the bid and ask, depth and the top of the scanner. Click a scanner row to load that stock on the chart.' },
    { id: 'scanner', s: '#academy-scanner-host', t: 'The live market scanner', b: 'Scan US stocks, ETFs, options and premarket movers. Sort by change or volume and click any row.' },
    { id: 'lessons', s: '#lesson-toggle', t: 'Lessons', b: 'Short narrated lessons that teach each concept on a live chart, from how a candle works to reading order flow.' },
    { id: 'alerts', s: '#academy-alerts-fab', t: 'Alerts desk', b: 'Trade alerts from your servers and traders you follow, scored and tracked. Open it to see entries, targets and how they played out.' },
    { id: 'ready', t: 'You are ready', b: 'Everything here is educational: it shows what the market did and what the data says, never a promise. Reopen this tour any time from the TOUR button.', last: true }
  ];
  const PHONE_STEPS = [
    { id: 'p-welcome', t: 'Welcome to the Academy', b: 'A live trading lab in your pocket: real-time charts, order flow, dark pool prints, options and a signal engine. A one-minute tour.', adv: true },
    { id: 'p-chart', s: '.academy-chart-stage', t: 'Your chart', b: 'Drag to scan, pinch to zoom, drag the price axis to stretch it. This stays on top while you read everything else.', pre: () => tab('chart'), pad: 4 },
    { id: 'p-symbol', s: 'input#symbol', t: 'Pick any stock', b: 'Type a ticker and press Go. The chart and every tab follow it, and the Academy remembers it for next time.' },
    { id: 'p-timeframe', s: '.chart>.intervals', t: 'Timeframe', b: '1 minute to 1 year, right under the chart.' },
    { id: 'p-tools', s: '#ms-sub', t: 'Chart tools', b: 'WALLS, COST, HEAT, SMC and INTENT draw what the big players are doing straight on the candles. Tap one to switch it on.', pre: () => tab('chart') },
    { id: 'p-tabs', s: '#ms-top', t: 'Stock tabs', b: 'Chart, Flow, Options, Algo and Comments. Each tab keeps its related tools together, and the chart stays visible above them.' },
    { id: 'p-flow', s: '#ms-top button[data-tab=flow]', t: 'Flow', b: 'Buy and sell pressure, dark pool prints, short-sale data and sentiment for this stock.', pre: () => tab('flow') },
    { id: 'p-algo', s: '#ms-top button[data-tab=algo]', t: 'Algo and SMC', b: 'MEM ALGO trade plans and the smart-money map. Tap a zone on the chart and its full breakdown opens right under it.', pre: () => tab('algo') },
    { id: 'p-talk', s: '#ms-top button[data-tab=talk]', t: 'Comments', b: 'What other traders are saying about this stock.', pre: () => tab('talk') },
    { id: 'p-quotes', s: '#ms-nav button[data-tab=quotes]', t: 'Quotes and chat', b: 'The live market scanner on top and the Academy chat below. Tap a row to put that stock on the chart.', pre: () => tab('chart') },
    { id: 'p-nav', s: '#ms-nav', t: 'Alerts and lessons', b: 'ALERTS opens the alerts desk. LESSONS teaches each concept on a live chart.' },
    { id: 'p-more', s: '#ms-nav button[data-more]', t: 'More', b: 'Settings, your profile, appearance and this tour, any time.' },
    { id: 'p-ready', t: 'You are ready', b: 'Everything here is educational: it shows what the market did and what the data says, never a promise. Replay this from More.', last: true }
  ];


  /* The guided tour speaks in the Academy's own voice (the same ElevenLabs voice as the lessons). Only ids go to the server; the
   * text it voices lives in academy/tour-content.js. Audio is fetched once per line and kept for the page's life, the next step
   * is fetched while this one plays, and every failure (no voice configured, rate limit, autoplay refused) leaves a silent tour. */
  const VKEY = 'sml-academy-tour-voice';
  const voice = (() => {
    let audio = null, token = 0, downUntil = 0;
    const blobs = new Map();
    const muted = () => { try { return localStorage.getItem(VKEY) === 'off'; } catch (_) { return false; } };
    const setMuted = (m) => { try { localStorage.setItem(VKEY, m ? 'off' : 'on'); } catch (_) { /* ignore */ } if (m) stop(); };
    const stop = () => { token += 1; if (audio) { try { audio.pause(); } catch (_) { /* ignore */ } audio = null; } };
    const blobFor = (kind, id) => {
      const key = kind + ':' + id;
      if (!blobs.has(key)) {
        const t = String(window.smlAcademySessionToken || '');
        const p = fetch('/academy-activity/tour-speech?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id), { headers: t ? { authorization: 'Bearer ' + t } : {}, cache: 'force-cache' })
          .then((r) => { if (!r.ok) { if (r.status === 503) downUntil = Date.now() + 300000; throw new Error('voice'); } return r.blob(); })
          .catch((e) => { blobs.delete(key); throw e; });
        blobs.set(key, p);
        while (blobs.size > 24) blobs.delete(blobs.keys().next().value);
      }
      return blobs.get(key);
    };
    const preload = (kind, id) => { if (!muted() && Date.now() > downUntil && id) blobFor(kind, id).catch(() => {}); };
    /* resolves 'playing' | 'blocked' (autoplay refused: a tap will start it) | 'off' (muted or no voice); opts.onend fires when the line finishes */
    async function play(kind, id, opts) {
      opts = opts || {};
      stop();
      if (!opts.force && muted()) return 'off';
      if (Date.now() < downUntil) return 'off';
      const mine = token;
      let blob; try { blob = await blobFor(kind, id); } catch (_) { return 'off'; }
      if (mine !== token) return 'off';
      const url = URL.createObjectURL(blob), a = new Audio(url);
      audio = a;
      a.onended = () => { URL.revokeObjectURL(url); if (audio === a) audio = null; if (opts.onend) opts.onend(); };
      try { await a.play(); return 'playing'; } catch (_) { return 'blocked'; }
    }
    return { play, stop, preload, muted, setMuted, available: () => Date.now() >= downUntil };
  })();
  window.smlTourVoice = voice;

  const tab = (id) => { try { if (window.smlMobileShell) window.smlMobileShell.tab(id); } catch (_) { /* ignore */ } };
  const css = '#sml-tour{position:fixed;inset:0;z-index:2147483640;font:500 14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#e6eef2}'
    + '#sml-tour .tr-block{position:absolute;inset:0}'
    + '#sml-tour .tr-hole{position:absolute;border-radius:12px;box-shadow:0 0 0 100vmax rgba(3,8,14,.82);outline:2px solid #00e29a;outline-offset:3px;transition:left .25s,top .25s,width .25s,height .25s;pointer-events:none;animation:tr-pulse 1.8s ease-in-out infinite}'
    + '@keyframes tr-pulse{0%,100%{outline-color:#00e29a}50%{outline-color:rgba(0,226,154,.35)}}'
    + '#sml-tour .tr-dim{position:absolute;inset:0;background:rgba(3,8,14,.82)}'
    + '#sml-tour .tr-card{position:absolute;width:min(360px,calc(100vw - 24px));padding:16px 16px 14px;border:1px solid #2b5362;border-radius:14px;background:#0a1620;box-shadow:0 18px 50px rgba(0,0,0,.65)}'
    + '#sml-tour .tr-k{font:800 .62rem ui-monospace,monospace;letter-spacing:.12em;color:#00c47d;margin:0 0 6px}'
    + '#sml-tour h3{margin:0 0 6px;font-size:1.05rem;line-height:1.25;color:#fff}#sml-tour p{margin:0 0 12px;color:#c4d4dc}'
    + '#sml-tour ul{margin:0 0 12px;padding-left:18px;color:#c4d4dc}#sml-tour li{margin:3px 0}'
    + '#sml-tour .tr-row{display:flex;align-items:center;gap:8px}#sml-tour .tr-sp{flex:1}'
    + '#sml-tour button{border:1px solid #2b5362;border-radius:9px;background:#10222d;color:#dcebf2;padding:9px 13px;font:800 .78rem system-ui,sans-serif;cursor:pointer}'
    + '#sml-tour .tr-menu{width:min(440px,calc(100vw - 24px))}#sml-tour button.tr-opt{display:block;width:100%;margin:0 0 7px;padding:10px 12px;text-align:left;font-weight:600}#sml-tour button.tr-opt b{display:block;color:#fff;font-size:.86rem}#sml-tour button.tr-opt span{display:block;margin-top:2px;color:#9db3bf;font-weight:500;font-size:.74rem;line-height:1.35}#sml-tour button.tr-opt:hover{border-color:#00c47d}#sml-tour button.tr-vox{padding:9px 10px;min-width:40px}#sml-tour button.tr-go{background:#00c47d;border-color:#00c47d;color:#04140d}#sml-tour button.tr-skip{border-color:transparent;background:none;color:#8fa6b3;padding:9px 4px}'
    + '#sml-tour .tr-dots{display:flex;gap:4px;margin:0 0 10px}#sml-tour .tr-dots i{width:16px;height:3px;border-radius:2px;background:#1c3340}#sml-tour .tr-dots i.on{background:#00c47d}'
    + '#tour-btn{flex:none;padding:4px 8px;border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}'
    + '@media(prefers-reduced-motion:reduce){#sml-tour .tr-hole{animation:none;transition:none}}';
  const style = document.createElement('style'); style.id = 'academy-tour-css'; style.textContent = css; document.head.appendChild(style);

  let root = null, steps = [], i = 0, running = false, mode = 'main', pbTitle = '';
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const find = (sel) => { for (const part of String(sel).split(',')) { const el = $(part.trim()); if (visible(el)) return el; } return null; };

  function render() {
    if (!root) return;
    const st = steps[i];
    voice.stop();
    if (st.pre) { try { st.pre(); } catch (_) { /* ignore */ } }
    const draw = () => {
      if (!root) return;
      let el = st.s ? find(st.s) : null;
      if (st.s && !el && st.soft) { place(st, null); return; }
      if (st.s && !el) { if (i < steps.length - 1) { i += 1; render(); } else finish('done'); return; }
      if (el) { const r0 = el.getBoundingClientRect(); const fixed = getComputedStyle(el).position === 'fixed' || !!el.closest('#ms-nav,#ms-sub,#ms-top'); if (!fixed && (r0.top < 60 || r0.bottom > innerHeight - 80)) el.scrollIntoView({ block: 'center', behavior: 'instant' }); }
      requestAnimationFrame(() => { if (el) el = uncover(el); place(st, el); });
    };
    setTimeout(draw, st.pre ? 380 : 30);
  }
  /* a spotlight must sit on the thing it names: when another module is stacked over the control (a panel the member left open), that panel is hidden for
   * the length of the step and restored after; if something still covers it the step falls back to a plain card with no hole, never a hole over the wrong thing */
  const hidden = [];
  function unhide() { while (hidden.length) { const [n, v] = hidden.pop(); n.style.visibility = v; } }
  function blockerOf(el) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const prev = root ? root.style.visibility : ''; if (root) root.style.visibility = 'hidden';
    const h = document.elementFromPoint(x, y); if (root) root.style.visibility = prev;
    if (!h || el.contains(h) || h.contains(el)) return null;
    let b = h; while (b.parentElement && b.parentElement !== document.body && !b.parentElement.contains(el)) b = b.parentElement;
    return b === document.body || b === document.documentElement ? null : b;
  }
  function uncover(el) {
    unhide();
    for (let k = 0; k < 3; k += 1) { const b = blockerOf(el); if (!b) return el; hidden.push([b, b.style.visibility]); b.style.visibility = 'hidden'; }
    return blockerOf(el) ? null : el;
  }
  window.smlExposed = (el) => !!el && !blockerOf(el);
  function place(st, el) {
    if (!root) return;
    const n = i + 1, tot = steps.length;
    root.innerHTML = '<div class="tr-block"></div>' + (el ? '<div class="tr-hole"></div>' : '<div class="tr-dim"></div>')
      + '<div class="tr-card" role="dialog" aria-label="Academy tour"><div class="tr-k">' + (mode === 'main' ? 'STEP ' + n + ' OF ' + tot : esc(String(pbTitle).toUpperCase()) + ' \u00b7 ' + n + '/' + tot) + '</div><div class="tr-dots">' + steps.map((_, k) => '<i class="' + (k <= i ? 'on' : '') + '"></i>').join('') + '</div>'
      + '<h3>' + esc(st.t) + '</h3><p>' + esc(st.b) + '</p>'
      + (st.adv ? '<ul><li>Live charts with the smart-money map</li><li>Order flow, dark pool and short-sale data</li><li>Options chain and five-mode trade plans</li><li>Lessons, alerts and a paper-trading account</li></ul>' : '')
      + '<div class="tr-row">' + (i > 0 ? '<button type="button" data-a="back">Back</button>' : '<button type="button" class="tr-skip" data-a="skip">' + (mode === 'main' ? 'Skip tour' : 'Close') + '</button>') + '<span class="tr-sp"></span>' + (st.id && window.__smlTourCatalog ? '<button type="button" class="tr-vox" data-a="vox" aria-label="Voice on or off" title="Hear this step in the Academy voice"></button>' : '') + (i > 0 && !st.last ? '<button type="button" class="tr-skip" data-a="skip">Skip</button>' : '') + '<button type="button" class="tr-go" data-a="' + (st.last ? 'done' : 'next') + '">' + (st.last ? (mode === 'main' ? 'Start exploring' : 'Done') : i === 0 ? (mode === 'main' ? 'Start the tour' : 'Begin') : 'Next') + '</button></div></div>';
    const card = root.querySelector('.tr-card'), hole = root.querySelector('.tr-hole');
    if (el && hole) {
      const r = el.getBoundingClientRect(), pad = st.pad == null ? 6 : st.pad;
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(innerWidth - 8, r.width + pad * 2), h = Math.min(innerHeight - 8, r.height + pad * 2);
      Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      const cw = card.offsetWidth, ch = card.offsetHeight, below = y + h + 14 + ch <= innerHeight - 8, above = y - 14 - ch >= 8;
      let cy = below ? y + h + 14 : above ? y - 14 - ch : Math.max(8, innerHeight - ch - 12);
      let cx = Math.min(Math.max(8, x + w / 2 - cw / 2), innerWidth - cw - 8);
      if (!below && !above) cx = Math.min(Math.max(8, x + w / 2 - cw / 2), innerWidth - cw - 8);
      Object.assign(card.style, { left: cx + 'px', top: cy + 'px' });
    } else {
      Object.assign(card.style, { left: Math.max(8, (innerWidth - card.offsetWidth) / 2) + 'px', top: Math.max(8, (innerHeight - card.offsetHeight) / 2) + 'px' });
    }
    const go = card.querySelector('.tr-go'); if (go) go.focus({ preventScroll: true });
    speak(st);
  }
  /* narrate the step in the Academy voice; the speaker button mutes it (remembered), or taps to start a line the browser would not autoplay */
  function voxPaint(state) { const b = root && root.querySelector('.tr-vox'); if (!b) return; b.dataset.s = state; b.textContent = state === 'playing' ? '\uD83D\uDD0A' : state === 'blocked' ? '\u25B6 Hear it' : '\uD83D\uDD07'; }
  function speak(st) {
    if (!st.id) return;
    const at = i;
    voxPaint(voice.muted() || !voice.available() ? 'off' : 'playing');
    voice.play('step', st.id).then((state) => { if (running && i === at) voxPaint(state === 'off' && !voice.muted() ? 'off' : state); });
    const nx = steps[i + 1]; if (nx && nx.id) voice.preload('step', nx.id);
  }
  function onVox() {
    const st = steps[i]; if (!st || !st.id) return;
    const b = root.querySelector('.tr-vox'), state = b && b.dataset.s;
    if (state === 'playing') { voice.setMuted(true); voxPaint('off'); return; }
    voice.setMuted(false); voxPaint('playing');
    voice.play('step', st.id, { force: true }).then((r) => { if (running && steps[i] === st) voxPaint(r); });
  }
  function onClick(e) {
    const b = e.target.closest && e.target.closest('button[data-a]'); if (!b) { e.stopPropagation(); return; }
    e.stopPropagation();
    const a = b.dataset.a;
    if (a === 'next') { if (i < steps.length - 1) { i += 1; render(); } else finish('done'); }
    else if (a === 'back') { if (i > 0) { i -= 1; render(); } }
    else if (a === 'vox') onVox();
    else if (a === 'pb') { const n = b.dataset.n; finish('menu'); start(true, n); }
    else if (a === 'skip') finish('skipped');
    else finish('done');
  }
  function onKey(e) {
    if (!running) return;
    if (mode === 'menu') { if (e.key === 'Escape') { finish('skipped'); e.preventDefault(); } return; }
    if (e.key === 'Escape') { finish('skipped'); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.target.closest && e.target.closest('button') && e.key === 'Enter') return; if (i < steps.length - 1) { i += 1; render(); } e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { if (i > 0) { i -= 1; render(); } e.preventDefault(); }
  }
  const onResize = () => { if (running) render(); };
  /* a clean stage: any tool panel the member had open (SQUEEZE, CHAIN, ...) is switched off for the tour and switched back on after, so a step about the quote
   * column shows the quote column and not a tall module inside it */
  const reopen = [];
  const isOn = (b) => b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true';
  function calm() {
    const cat = window.__smlTourCatalog && window.__smlTourCatalog.tools || {};
    Object.keys(cat).forEach((id) => { const b = document.getElementById(id); if (b && /-(toggle|btn)$|^depth-/.test(id) && id !== 'lesson-toggle' && id !== 'academy-alerts-fab' && isOn(b)) { reopen.push(id); b.click(); } });
    const g = document.getElementById('tool-guide'); if (g && g.classList.contains('open')) { const gb = document.getElementById('tool-guide-btn'); if (gb) gb.click(); }
    return reopen.length;
  }
  function restore() { reopen.splice(0).forEach((id) => { const b = document.getElementById(id); if (b && !isOn(b)) b.click(); }); }
  /* playbooks: the guided walkthroughs in academy/tour-playbooks.js. The words come from the catalog, the controls each step points at from
   * window.smlTourTargets (academy-playbooks.js); a step whose control is not on this layout is still read, as a plain card */
  function playbookSteps(name) {
    const pb = window.__smlTourCatalog && window.__smlTourCatalog.playbooks && window.__smlTourCatalog.playbooks[name]; if (!pb) return null;
    const T = window.smlTourTargets || {};
    const out = pb.steps.map((st) => Object.assign({ id: st.id, t: st.t, b: st.b, soft: true }, T[st.id] || {}));
    out[out.length - 1].last = true; pbTitle = pb.title; return out;
  }
  function menu() {
    const cat = window.__smlTourCatalog.playbooks, rows = Object.keys(cat);
    mode = 'menu'; running = true; steps = []; i = 0;
    root = document.createElement('div'); root.id = 'sml-tour'; root.addEventListener('click', onClick, true); document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    root.innerHTML = '<div class="tr-block"></div><div class="tr-dim"></div><div class="tr-card tr-menu" role="dialog" aria-label="Choose a walkthrough"><div class="tr-k">LEARN THE ACADEMY</div><h3>What do you want to learn?</h3>'
      + '<button type="button" class="tr-opt" data-a="pb" data-n="main"><b>The quick tour</b><span>1 min \u00b7 the layout, the chart and the main tools</span></button>'
      + rows.map((n) => '<button type="button" class="tr-opt" data-a="pb" data-n="' + esc(n) + '"><b>' + esc(cat[n].title) + '</b><span>' + esc(cat[n].mins) + ' min \u00b7 ' + esc(cat[n].blurb) + '</span></button>').join('')
      + '<div class="tr-row"><span class="tr-sp"></span><button type="button" class="tr-skip" data-a="skip">Close</button></div></div>';
    const card = root.querySelector('.tr-card'); Object.assign(card.style, { left: Math.max(8, (innerWidth - card.offsetWidth) / 2) + 'px', top: Math.max(8, (innerHeight - card.offsetHeight) / 2) + 'px', maxHeight: 'calc(100dvh - 16px)', overflow: 'auto' });
  }
  function start(force, name) {
    if (running) return;
    if (!force && seen()) return;
    const cat = window.__smlTourCatalog || {};
    if (force && !name && cat.playbooks) { menu(); return; }
    mode = name && name !== 'main' ? name : 'main';
    if (mode === 'main') { if (force && window.smlAutoTour) window.smlAutoTour.reset(); steps = PHONE() ? PHONE_STEPS : DESK; }
    else { steps = playbookSteps(mode); if (!steps) { mode = 'main'; return; } }
    i = 0; running = true;
    root = document.createElement('div'); root.id = 'sml-tour'; root.addEventListener('click', onClick, true); document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize);
    if (calm()) setTimeout(() => { if (running) render(); }, 350); else render();
  }
  /* panels a walkthrough opened for its steps are closed again when it ends, so the page is left as it was found */
  const opened = [];
  window.smlTourEnsure = (panelSel, openerSel) => {
    const p = $(panelSel); if (p && visible(p)) return;
    const o = $(openerSel); if (o) { o.click(); opened.push([panelSel, openerSel]); }
  };
  function finish(how) {
    const was = mode; running = false; if (was === 'main') mark(how); voice.stop(); unhide();
    opened.splice(0).reverse().forEach(([ps, os]) => { const p = $(ps), o = $(os); if (p && visible(p) && o) o.click(); });
    restore(); mode = 'main';
    document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize);
    if (root) { root.remove(); root = null; }
    if (was === 'main') { if (PHONE()) tab('chart'); try { window.scrollTo(0, 0); } catch (_) { /* ignore */ } }
  }

  /* a TOUR button on desktop (next to GUIDE) to run it again */
  function addButton() {
    const tail = $('#tool-rail .tail'); if (!tail || $('#tour-btn')) return !!$('#tour-btn');
    const b = document.createElement('button'); b.type = 'button'; b.id = 'tour-btn'; b.textContent = 'TOUR'; b.title = 'A guided tour of the Academy';
    b.addEventListener('click', () => start(true)); tail.insertBefore(b, tail.firstChild); return true;
  }
  /* first time: wait for the intro video to finish and the page to settle, then begin */
  function arm(tries) {
    addButton();
    if (seen()) return;
    const intro = $('#academy-intro'), introUp = intro && getComputedStyle(intro).display !== 'none' && intro.getBoundingClientRect().height > 0;
    const ready = document.readyState === 'complete' && !introUp && (PHONE() ? !!$('#ms-nav') : !!$('#tool-rail'));
    if (ready) { setTimeout(() => { if (!seen() && !running) start(false); }, 900); return; }
    if (tries < 120) setTimeout(() => arm(tries + 1), 700);
  }
  window.smlTour = { start, seen, running: () => running, run: (name) => start(true, name), reset: () => { try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } } };
  if (new URLSearchParams(location.search).has('popout')) return;
  setTimeout(() => arm(0), 1500);
})();
