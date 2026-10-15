/* Windows inside the Academy and per-module customization.
 *
 * ⧉ on a module now opens it as a window rendered inside the Activity itself (drag, resize, maximize, close) rather
 * than a browser tab; the ↗ button in that window's header still sends the module to the member's browser for a second
 * screen. Aa Customize → "Customize each module" puts a ⚙ on every module so each one is set on its own: accent colour,
 * text size, height, width, order on the page, hidden or floating. Windows and settings are saved per member on the
 * server (this browser keeps a copy) and come back the next time the Academy opens. */
(() => {
  if (window.__smlCustomize) return;
  window.__smlCustomize = 1;
  if (window.smlAcademyPopout) return; // a browser pop-out keeps its own toolbar (academy-popout-ui.js)

  const FALLBACK = [
    ['chart', 'Chart', 'section.chart'], ['direction', 'Market direction', '#academy-direction'], ['unusual-volume', 'Unusual volume', '#academy-unusual-volume'],
    ['sml-vix', 'SML VIX', '#academy-sml-vix'], ['alerts', 'Alerts desk', '#academy-alerts'], ['quote', 'Quote & order book', 'aside.side'],
    ['quote-stats', 'Quote statistics', '.academy-quote-stats'], ['book', 'Top of book', 'aside.side .book'], ['level2', 'Level 2', '.academy-depth'],
    ['tape', 'Time & sales', '.academy-tape'], ['trade-stats', 'Trade statistics', '.academy-stats'], ['buy-sell', 'Buy / sell pressure', '.academy-buysell'],
    ['dark-pool', 'Dark pool', '.academy-darkpool'], ['short-sale', 'Short sale', '.academy-shortsale'], ['sentiment', 'Sentiment', '.academy-sentiment'],
    ['sire', 'S.I.R.E.', '#sire-panel'], ['mem-algo', 'MEM ALGO', '#mem-algo-panel'], ['hedge', 'Hedge & income', '#academy-hedge'],
    ['indicators', 'Indicator engine', 'section.academy-intelligence'], ['screener', 'Screener', '#academy-screener'], ['earnings', 'Earnings', '#earnings-panel'],
    ['options', 'Options chain', '#options-chain'], ['calculator', 'Options calculator', 'section.opt-calc'], ['scanner', 'Live scanner', 'section.academy-scanner'],
    ['scanner-intel', 'Scanner intelligence', 'section.academy-rank-lab'], ['chat', 'Chat', 'section.academy-chat'], ['class', 'Class', '#lesson']
  ];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const modules = () => (typeof window.smlAcademyModules === 'function' ? window.smlAcademyModules() : FALLBACK.map(([id, label, sel]) => ({ id, label, el: document.querySelector(sel) })));
  const find = (id) => modules().find((m) => m.id === id) || null;
  const labelOf = (id) => { const m = find(id); return m ? m.label : id; };
  const coarse = () => matchMedia('(pointer:coarse)').matches || innerWidth < 760;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private window */ } } };
  const LOCAL = 'sml-academy-layout-v2';
  const HEIGHTS = [[0, 'Auto'], [240, 'Short'], [360, 'Medium'], [520, 'Tall'], [720, 'Max']];
  const ACCENTS = [['', 'Default'], ['#00c47d', 'Green'], ['#6c8cff', 'Blue'], ['#ff9f43', 'Orange'], ['#ff6b6b', 'Red'], ['#c46bff', 'Purple'], ['#ffe600', 'Yellow'], ['#9aa7b8', 'Grey']];
  const fire = () => { setTimeout(() => dispatchEvent(new Event('resize')), 60); setTimeout(() => dispatchEvent(new Event('resize')), 500); };

  const css = document.createElement('style');
  css.textContent = '#sml-wins{position:fixed;inset:0;z-index:2147481000;pointer-events:none}'
    + '.sml-w{position:absolute;pointer-events:auto;display:flex;flex-direction:column;min-width:220px;min-height:140px;background:#080e18;border:1px solid #1f3a4a;border-radius:8px;box-shadow:0 10px 36px rgba(0,0,0,.6);overflow:hidden}'
    + '.sml-w.on{border-color:#2a6b50}.sml-w.max{left:0!important;top:0!important;width:100%!important;height:100%!important;border-radius:0}'
    + '.sml-wh{height:28px;flex-shrink:0;display:flex;align-items:center;gap:5px;padding:0 6px 0 10px;background:#0a1424;border-bottom:1px solid #15283a;cursor:grab;user-select:none;touch-action:none}'
    + '.sml-wh:active{cursor:grabbing}.sml-wh .t{flex:1;font:800 11px/1 system-ui,sans-serif;color:#9fe8c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.sml-wh button{border:1px solid #23404d;border-radius:5px;background:#0c1821;color:#cfe3ea;font:800 11px/1 system-ui,sans-serif;padding:4px 6px;cursor:pointer;flex-shrink:0}'
    + '.sml-wh button:hover{border-color:#00c47d;color:#7ef0bd}'
    + '.sml-wb{flex:1;min-height:0;overflow:auto;position:relative}'
    + '.sml-wb>.sml-w-mod{width:100%!important;max-width:none!important;position:relative!important;margin:0!important}'
    + '.sml-wb>.sml-w-chart{display:flex!important;flex-direction:column!important;height:100%!important}.sml-wb .academy-chart-stage{flex:1 1 auto!important;height:auto!important;min-height:160px}'
    + '.sml-wb>aside.side{width:100%!important;min-width:0!important;max-height:none!important}'
    + '.sml-wb .sml-pop-btn{display:none!important}'
    + '.sml-wr{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 55%,#2a6b50 55%);touch-action:none}'
    + '.sml-wnote{padding:22px;text-align:center;color:#7b93a0;font:700 12px/1.5 system-ui,sans-serif}'
    + '.sml-w-slot{display:none}'
    /* customize mode */
    + '.sml-cz-chip{position:absolute;top:5px;left:5px;z-index:31;display:none;align-items:center;gap:4px;border:1px solid #2b4b5a;border-radius:6px;background:rgba(9,17,24,.92);color:#ffd27a;font:800 11px/1 system-ui,sans-serif;padding:4px 7px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)}'
    + 'body.sml-cz-on .sml-cz-chip{display:inline-flex}.sml-cz-chip:hover{border-color:#ffb020;color:#fff}.sml-cz-chip.inrow{position:static;height:27px}'
    + 'body.sml-cz-on .sml-cz-host{outline:1px dashed rgba(255,176,32,.55);outline-offset:-1px}'
    + '#sml-cz-bar{position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:2147483250;display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:min(900px,96vw);padding:7px 10px;border:1px solid #ffb020;border-radius:10px;background:rgba(26,19,5,.97);color:#ffe3b0;font:700 12px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6)}'
    + '#sml-cz-bar button{border:1px solid #6b5120;border-radius:6px;background:#2a1f08;color:#ffe3b0;font:800 11px/1 system-ui,sans-serif;padding:5px 8px;cursor:pointer}#sml-cz-bar button:hover{border-color:#ffb020;color:#fff}#sml-cz-bar button.done{background:#ffb020;color:#1a1305;border-color:#ffb020}'
    + '#sml-cz-panel{position:fixed;z-index:2147483260;width:min(300px,calc(100vw - 20px));max-height:calc(100dvh - 20px);overflow:auto;background:#0a1118;border:1px solid #ffb020;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.7);color:#dbe6ec;font:600 .72rem/1.4 system-ui,sans-serif;padding:12px}'
    + '#sml-cz-panel h4{margin:0 0 6px;font:800 .8rem system-ui,sans-serif;color:#ffd27a}#sml-cz-panel h6{margin:10px 0 5px;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em;color:#ffb020}'
    + '#sml-cz-panel .sw{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}#sml-cz-panel .sw button{border:2px solid #294554;border-radius:7px;padding:6px 2px;color:#fff;font:800 .58rem system-ui,sans-serif;cursor:pointer;background:#0d1a24}#sml-cz-panel .sw button.on{border-color:#fff}'
    + '#sml-cz-panel .opts{display:flex;flex-wrap:wrap;gap:5px}#sml-cz-panel .opts button{border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;padding:6px 8px;font:800 .62rem system-ui,sans-serif;cursor:pointer}#sml-cz-panel .opts button.on{border-color:#ffb020;color:#ffd27a}'
    + '#sml-cz-panel input[type=range]{width:100%}#sml-cz-panel .row{display:flex;gap:8px;align-items:center;margin-top:6px}#sml-cz-panel input[type=color]{width:38px;height:26px;border:0;background:none;padding:0}'
    + '#sml-cz-panel .ft{display:flex;gap:8px;margin-top:12px}#sml-cz-panel .ft button{flex:1;border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;padding:7px;font:800 .66rem system-ui,sans-serif;cursor:pointer}#sml-cz-panel .ft button.done{background:#ffb020;color:#1a1305;border-color:#ffb020}'
    + '#sml-cz-panel .note{color:#7f95a1;font-weight:500;font-size:.6rem;margin-top:8px}'
    + '.sml-cz-hidden{display:none!important}'
    + '.sml-cz-full{grid-column:1/-1!important;width:100%!important;max-width:none!important;flex:1 1 100%!important}'
    + '.sml-cz-accent{border-color:var(--sml-mod-accent)!important;box-shadow:inset 0 2px 0 0 var(--sml-mod-accent)!important}'
    + '.sml-cz-accent>h2,.sml-cz-accent>h3,.sml-cz-accent>h4,.sml-cz-accent>header,.sml-cz-accent>.hd,.sml-cz-accent>div:first-child>h2,.sml-cz-accent>div:first-child>h3,.sml-cz-accent>div:first-child>b{color:var(--sml-mod-accent)!important}'
    + '#sml-cz-toast{position:fixed;left:50%;bottom:52px;transform:translateX(-50%);z-index:2147483400;max-width:min(520px,92vw);padding:9px 13px;border:1px solid #1f8a5f;border-radius:9px;background:#071a13;color:#c9f6e2;font:700 12px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.55);display:none}';
  document.head.appendChild(css);

  let toastTm = 0;
  const toast = (text) => { let t = document.getElementById('sml-cz-toast'); if (!t) { t = document.createElement('div'); t.id = 'sml-cz-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = text; t.style.display = 'block'; clearTimeout(toastTm); toastTm = setTimeout(() => { t.style.display = 'none'; }, 3800); };

  /* ---------- state: windows + per-module settings, saved per member ---------- */
  let state = { v: 2, panels: [], modules: {} };
  let saveTm = 0, lastSaved = '';
  const settingsOf = (id) => state.modules[id] || (state.modules[id] = {});
  const prune = (id) => { const s = state.modules[id]; if (s && !Object.keys(s).length) delete state.modules[id]; };
  function save() { clearTimeout(saveTm); saveTm = setTimeout(() => { void flush(); }, 900); }
  async function flush() {
    state.panels = [...wins.keys()].map((id) => geometry(id));
    const body = JSON.stringify({ v: 2, scope: 'activity', panels: state.panels, modules: state.modules });
    if (body === lastSaved) return;
    lastSaved = body;
    store.set(LOCAL, state);
    const token = window.smlAcademySessionToken;
    if (!token) return;
    try { await fetch('/academy-activity/desk/layout?scope=activity', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body, cache: 'no-store' }); } catch (_) { /* the local copy stands in */ }
  }
  async function load() {
    const token = window.smlAcademySessionToken;
    if (token) {
      try {
        const r = await fetch('/academy-activity/desk/layout?scope=activity', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
        if (r.ok) { const d = await r.json(); if (d && d.ok && d.layout && typeof d.layout === 'object') return d.layout; }
      } catch (_) { /* fall through */ }
    }
    return store.get(LOCAL, null);
  }

  /* ---------- windows rendered inside the Activity ---------- */
  const wins = new Map(); // id -> { el, head, body, mod, slot, geom:{x,y,w,h}, max }
  let zTop = 10, drag = null, resizing = null;
  const layer = document.createElement('div'); layer.id = 'sml-wins';
  const SIZE = { chart: [0.62, 0.72], scanner: [0.7, 0.7], options: [0.7, 0.7], 'scanner-intel': [0.6, 0.6], chat: [0.3, 0.8], alerts: [0.3, 0.8], level2: [0.26, 0.7], tape: [0.26, 0.7], quote: [0.26, 0.7] };
  function geometry(id) { const w = wins.get(id); const g = w.geom; return { id, x: +(g.x / innerWidth).toFixed(4), y: +(g.y / innerHeight).toFixed(4), w: +(g.w / innerWidth).toFixed(4), h: +(g.h / innerHeight).toFixed(4) }; }
  function place(w) { w.el.style.left = Math.round(w.geom.x) + 'px'; w.el.style.top = Math.round(w.geom.y) + 'px'; w.el.style.width = Math.round(w.geom.w) + 'px'; w.el.style.height = Math.round(w.geom.h) + 'px'; }
  function focus(id) { for (const [k, w] of wins) w.el.classList.toggle('on', k === id); const w = wins.get(id); if (w) w.el.style.zIndex = String(++zTop); }

  function makeWindow(id, from) {
    const [fw, fh] = SIZE[id] || [0.4, 0.6];
    const n = wins.size;
    const geom = from
      ? { x: from.x * innerWidth, y: from.y * innerHeight, w: from.w * innerWidth, h: from.h * innerHeight }
      : { x: 24 + (n % 5) * 28, y: 48 + (n % 5) * 28, w: fw * innerWidth, h: fh * innerHeight };
    geom.w = clamp(geom.w, 220, innerWidth); geom.h = clamp(geom.h, 140, innerHeight);
    geom.x = clamp(geom.x, -geom.w + 80, innerWidth - 80); geom.y = clamp(geom.y, 0, innerHeight - 30);
    const el = document.createElement('div'); el.className = 'sml-w'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', labelOf(id));
    const head = document.createElement('div'); head.className = 'sml-wh';
    head.innerHTML = '<span class="t">' + esc(labelOf(id)) + '</span>'
      + '<button type="button" data-a="cz" title="Customize this module">⚙</button>'
      + (typeof window.smlAcademyPopBrowser === 'function' ? '<button type="button" data-a="browser" title="Send this module to your browser for another screen">↗</button>' : '')
      + '<button type="button" data-a="max" title="Fill the Academy">▢</button>'
      + '<button type="button" data-a="close" title="Put it back on the page">×</button>';
    const body = document.createElement('div'); body.className = 'sml-wb';
    const grip = document.createElement('div'); grip.className = 'sml-wr'; grip.title = 'Resize';
    el.append(head, body, grip);
    const slot = document.createElement('span'); slot.className = 'sml-w-slot';
    const w = { el, head, body, mod: null, slot, geom, max: false };
    wins.set(id, w);
    place(w); layer.appendChild(el); focus(id);

    head.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const a = b.getAttribute('data-a');
      if (a === 'close') unfloat(id);
      if (a === 'max') { w.max = !w.max; el.classList.toggle('max', w.max); b.textContent = w.max ? '❐' : '▢'; fire(); }
      if (a === 'browser') { unfloat(id); void window.smlAcademyPopBrowser(id); }
      if (a === 'cz') { if (!cz.on) czToggle(true); openPanel(id, b); }
    });
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || w.max) return;
      e.preventDefault(); focus(id);
      try { head.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      drag = { id, sx: e.clientX, sy: e.clientY, ox: geom.x, oy: geom.y };
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== id) return;
      geom.x = clamp(drag.ox + e.clientX - drag.sx, -geom.w + 80, innerWidth - 80);
      geom.y = clamp(drag.oy + e.clientY - drag.sy, 0, innerHeight - 30);
      place(w);
    });
    const endDrag = () => { if (drag && drag.id === id) { drag = null; fire(); save(); } };
    head.addEventListener('pointerup', endDrag); head.addEventListener('pointercancel', endDrag);
    grip.addEventListener('pointerdown', (e) => {
      if (w.max) return;
      e.preventDefault(); e.stopPropagation(); focus(id);
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      resizing = { id, sx: e.clientX, sy: e.clientY, ow: geom.w, oh: geom.h };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!resizing || resizing.id !== id) return;
      geom.w = clamp(resizing.ow + e.clientX - resizing.sx, 220, innerWidth); geom.h = clamp(resizing.oh + e.clientY - resizing.sy, 140, innerHeight);
      place(w); dispatchEvent(new Event('resize'));
    });
    const endResize = () => { if (resizing && resizing.id === id) { resizing = null; fire(); save(); } };
    grip.addEventListener('pointerup', endResize); grip.addEventListener('pointercancel', endResize);
    el.addEventListener('pointerdown', () => focus(id), true);
    return w;
  }

  const hasContent = (el) => !!el && String(el.innerText || '').replace(/[⧉⚙]/g, '').trim().length > 4;
  /* modules that only appear after a click (a view tab, a toggle): make that click, then wait for the element */
  async function obtain(id) {
    for (let i = 0; i < 12; i++) {
      try { if (typeof window.smlAcademyModuleOpen === 'function') window.smlAcademyModuleOpen(id); } catch (_) { /* try again */ }
      const m = find(id);
      if (m && m.el && (hasContent(m.el) || (typeof window.smlAcademyModuleReady === 'function' && window.smlAcademyModuleReady(id)))) return m.el;
      await sleep(700);
    }
    const started = Date.now();
    while (Date.now() - started < 9000) { const m = find(id); if (m && m.el) return m.el; await sleep(250); }
    return null;
  }

  async function float(id, from) {
    if (coarse()) { if (typeof window.smlAcademyPopBrowser === 'function') return window.smlAcademyPopBrowser(id); return; }
    if (wins.has(id)) { focus(id); return; }
    const w = makeWindow(id, from);
    const el = await obtain(id);
    if (!wins.has(id)) return; // closed while it was loading
    if (!el) { w.body.innerHTML = '<div class="sml-wnote">' + esc(labelOf(id)) + ' is not on the page right now. Open it from the toolbar first, then try again.</div>'; return; }
    w.mod = el;
    el.before(w.slot);
    if (getComputedStyle(el).display === 'none') el.style.setProperty('display', 'block', 'important');
    el.classList.add('sml-pop-show', 'sml-w-mod');
    if (id === 'chart') el.classList.add('sml-w-chart');
    if (el.classList.contains('sml-cz-h')) { el.style.removeProperty('height'); el.style.removeProperty('max-height'); }
    w.body.appendChild(el);
    el.style.setProperty('height', '100%', 'important');
    fire(); save();
    if (!from) toast(labelOf(id) + ' is now a window inside the Academy. Drag its title bar, pull the corner to resize, × puts it back.');
  }

  function unfloat(id) {
    const w = wins.get(id);
    if (!w) return;
    if (w.mod && w.slot.parentElement) {
      w.slot.replaceWith(w.mod);
      w.mod.style.removeProperty('height');
      w.mod.classList.remove('sml-pop-show', 'sml-w-mod', 'sml-w-chart');
      if (w.mod.dataset.smlOrdered) delete w.mod.dataset.smlOrdered;
    }
    w.el.remove();
    wins.delete(id);
    applyModule(id);
    fire(); save();
  }

  /* ---------- per-module settings ---------- */
  function applyModule(id) {
    const m = find(id); const el = m && m.el; if (!el) return;
    const s = state.modules[id] || {};
    el.classList.toggle('sml-cz-hidden', !!s.hidden);
    if (s.accent) { el.style.setProperty('--sml-mod-accent', s.accent); el.classList.add('sml-cz-accent'); } else { el.style.removeProperty('--sml-mod-accent'); el.classList.remove('sml-cz-accent'); }
    const scale = s.size && s.size !== 100 ? s.size / 100 : 0;
    if (id === 'chart') { el.style.fontSize = scale ? Math.round(scale * 100) + '%' : ''; } else { el.style.zoom = scale ? String(scale) : ''; }
    const floating = wins.has(id);
    if (s.height && !floating) { el.style.setProperty('height', s.height + 'px', 'important'); el.style.setProperty('max-height', s.height + 'px', 'important'); el.style.setProperty('overflow', 'auto', 'important'); el.classList.add('sml-cz-h'); }
    else if (el.classList.contains('sml-cz-h')) { if (!floating) el.style.removeProperty('height'); el.style.removeProperty('max-height'); el.style.removeProperty('overflow'); el.classList.remove('sml-cz-h'); }
    el.classList.toggle('sml-cz-full', s.width === 'full');
    if (Number.isInteger(s.order) && !el.dataset.smlOrdered && !floating) { el.dataset.smlOrdered = '1'; reorder(el, s.order); }
  }
  const siblingsOf = (el) => [...el.parentElement.children].filter((c) => !c.matches('script,style,.sml-w-slot'));
  function reorder(el, idx) {
    const parent = el.parentElement; if (!parent) return;
    const kids = siblingsOf(el).filter((c) => c !== el);
    const ref = kids[idx] || null;
    if (ref !== el.nextElementSibling || (!ref && el !== parent.lastElementChild)) parent.insertBefore(el, ref);
  }
  function move(id, dir) {
    const m = find(id); const el = m && m.el; if (!el || !el.parentElement || wins.has(id)) return;
    const kids = siblingsOf(el); const i = kids.indexOf(el);
    const j = i + dir; if (j < 0 || j >= kids.length) { toast(labelOf(id) + ' is already at the ' + (dir < 0 ? 'top' : 'bottom') + ' of its area.'); return; }
    el.parentElement.insertBefore(el, dir < 0 ? kids[j] : kids[j].nextSibling);
    settingsOf(id).order = siblingsOf(el).indexOf(el);
    el.dataset.smlOrdered = '1';
    fire(); save();
  }
  let applyQueued = false;
  function applyAll() { for (const id of Object.keys(state.modules)) applyModule(id); }
  const queueApply = () => { if (applyQueued) return; applyQueued = true; setTimeout(() => { applyQueued = false; applyAll(); if (cz.on) chips(); }, 500); };

  /* ---------- customize mode: a ⚙ on every module, one panel per module ---------- */
  const cz = { on: false, open: '' };
  function chips() {
    for (const m of modules()) {
      const el = m.el; if (!el) continue;
      const row = m.id === 'chart' ? document.querySelector('.academy-chart-tools') : null; // the chart's chip stays off the plot
      if (row ? row.querySelector('.sml-cz-chip[data-for="chart"]') : el.querySelector(':scope > .sml-cz-chip')) continue;
      if (!row && getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.classList.add('sml-cz-host');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sml-cz-chip' + (row ? ' inrow' : ''); b.dataset.for = m.id; b.textContent = '⚙ ' + m.label; b.title = 'Customize ' + m.label;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPanel(m.id, b); });
      (row || el).appendChild(b);
    }
  }
  function unchips() { document.querySelectorAll('.sml-cz-chip').forEach((b) => b.remove()); document.querySelectorAll('.sml-cz-host').forEach((el) => el.classList.remove('sml-cz-host')); }
  function bar() {
    let b = document.getElementById('sml-cz-bar');
    if (!b) { b = document.createElement('div'); b.id = 'sml-cz-bar'; document.body.appendChild(b); b.addEventListener('click', onBar); }
    const hidden = Object.keys(state.modules).filter((id) => state.modules[id].hidden);
    b.innerHTML = '<span>⚙ CUSTOMIZE MODE — click ⚙ on any module to set that module on its own.</span>'
      + hidden.map((id) => '<button type="button" data-show="' + esc(id) + '" title="Show it again">👁 ' + esc(labelOf(id)) + '</button>').join('')
      + '<button type="button" data-a="windows">▣ Windows</button><button type="button" data-a="reset">Reset all</button><button type="button" data-a="done" class="done">Done</button>';
  }
  function onBar(e) {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.getAttribute('data-show');
    if (id) { delete settingsOf(id).hidden; prune(id); applyModule(id); bar(); save(); toast(labelOf(id) + ' is back on the page.'); return; }
    const a = b.getAttribute('data-a');
    if (a === 'done') czToggle(false);
    if (a === 'windows') windowsMenu(b);
    if (a === 'reset') {
      const ids = Object.keys(state.modules); state.modules = {};
      for (const id of ids) applyModule(id);
      for (const id of [...wins.keys()]) unfloat(id);
      bar(); closePanel(); fire(); save(); toast('Every module is back to its default look and place.');
    }
  }
  function windowsMenu(anchor) {
    closePanel();
    const p = document.createElement('div'); p.id = 'sml-cz-panel';
    p.innerHTML = '<h4>▣ Windows</h4><p class="note">Open a module as a window inside the Academy. Each window remembers its place.</p><div class="opts">'
      + modules().filter((m) => m.el).map((m) => '<button type="button" data-float="' + esc(m.id) + '" class="' + (wins.has(m.id) ? 'on' : '') + '">' + esc(m.label) + '</button>').join('') + '</div>'
      + '<div class="ft"><button type="button" data-a="done" class="done">Done</button></div>';
    p.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('button'); if (!b) return; const id = b.getAttribute('data-float'); if (id) { if (wins.has(id)) unfloat(id); else void float(id); b.classList.toggle('on', wins.has(id)); } else if (b.getAttribute('data-a') === 'done') closePanel(); });
    document.body.appendChild(p); anchorPanel(p, anchor);
  }
  function anchorPanel(p, anchor) {
    const r = anchor ? anchor.getBoundingClientRect() : { left: 20, bottom: 20 };
    const w = p.offsetWidth || 300, h = p.offsetHeight || 300;
    p.style.left = Math.round(clamp(r.left, 8, innerWidth - w - 8)) + 'px';
    p.style.top = Math.round(clamp(r.bottom + 6, 8, innerHeight - h - 8)) + 'px';
  }
  function closePanel() { const p = document.getElementById('sml-cz-panel'); if (p) p.remove(); cz.open = ''; }
  function openPanel(id, anchor) {
    closePanel();
    cz.open = id;
    const p = document.createElement('div'); p.id = 'sml-cz-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Customize ' + labelOf(id));
    const paint = () => {
      const s = state.modules[id] || {};
      p.innerHTML = '<h4>⚙ ' + esc(labelOf(id)) + '</h4>'
        + '<h6>ACCENT</h6><div class="sw">' + ACCENTS.map(([v, l]) => '<button type="button" data-accent="' + esc(v) + '" class="' + ((s.accent || '') === v ? 'on' : '') + '" style="' + (v ? 'background:' + v + ';color:#06110d' : '') + '">' + esc(l) + '</button>').join('') + '</div>'
        + '<div class="row"><label>Any colour <input type="color" data-k="accent" value="' + esc(s.accent || '#00c47d') + '"></label></div>'
        + '<h6>TEXT SIZE · ' + (s.size || 100) + '%</h6><input type="range" min="70" max="150" step="5" data-k="size" value="' + (s.size || 100) + '">'
        + '<h6>HEIGHT</h6><div class="opts">' + HEIGHTS.map(([v, l]) => '<button type="button" data-height="' + v + '" class="' + ((s.height || 0) === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>'
        + '<h6>WIDTH</h6><div class="opts"><button type="button" data-width="" class="' + (s.width ? '' : 'on') + '">Auto</button><button type="button" data-width="full" class="' + (s.width === 'full' ? 'on' : '') + '">Full row</button></div>'
        + '<h6>PLACE</h6><div class="opts"><button type="button" data-a="up">▲ Move up</button><button type="button" data-a="down">▼ Move down</button><button type="button" data-a="float" class="' + (wins.has(id) ? 'on' : '') + '">' + (wins.has(id) ? '▣ Put back on page' : '▣ Float as window') + '</button><button type="button" data-a="hide">👁 Hide this module</button></div>'
        + '<div class="ft"><button type="button" data-a="reset">Reset this module</button><button type="button" data-a="done" class="done">Done</button></div>'
        + '<p class="note">Only ' + esc(labelOf(id)) + ' changes. Saved to your Academy account.</p>';
    };
    paint();
    p.addEventListener('click', (e) => {
      e.stopPropagation(); // paint() replaces the buttons, so the outside-click check below would see a detached target
      const b = e.target.closest('button'); if (!b) return;
      const s = settingsOf(id);
      if (b.hasAttribute('data-accent')) { const v = b.getAttribute('data-accent'); if (v) s.accent = v; else delete s.accent; }
      else if (b.hasAttribute('data-height')) { const v = Number(b.getAttribute('data-height')); if (v) s.height = v; else delete s.height; }
      else if (b.hasAttribute('data-width')) { const v = b.getAttribute('data-width'); if (v) s.width = v; else delete s.width; }
      else {
        const a = b.getAttribute('data-a');
        if (a === 'up') { move(id, -1); return; }
        if (a === 'down') { move(id, 1); return; }
        if (a === 'float') { if (wins.has(id)) unfloat(id); else void float(id); paint(); return; }
        if (a === 'hide') { s.hidden = true; applyModule(id); prune(id); bar(); save(); closePanel(); toast(labelOf(id) + ' hidden. Bring it back from the bar at the top.'); return; }
        if (a === 'reset') { delete state.modules[id]; applyModule(id); fire(); save(); paint(); toast(labelOf(id) + ' is back to default.'); return; }
        if (a === 'done') { closePanel(); return; }
      }
      prune(id); applyModule(id); fire(); save(); paint();
    });
    p.addEventListener('input', (e) => {
      const k = e.target && e.target.dataset && e.target.dataset.k; if (!k) return;
      const s = settingsOf(id);
      if (k === 'size') { const v = Number(e.target.value); if (v === 100) delete s.size; else s.size = v; const h = p.querySelector('h6:nth-of-type(2)'); if (h) h.textContent = 'TEXT SIZE · ' + (s.size || 100) + '%'; }
      if (k === 'accent') { s.accent = String(e.target.value || '').toLowerCase(); p.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-accent') === s.accent)); }
      prune(id); applyModule(id); save();
    });
    document.body.appendChild(p);
    anchorPanel(p, anchor);
  }
  function czToggle(on) {
    const next = on == null ? !cz.on : !!on;
    if (next === cz.on) { if (next) bar(); return; }
    cz.on = next;
    document.body.classList.toggle('sml-cz-on', cz.on);
    if (cz.on) { bar(); chips(); toast('Customize mode: every module now has a ⚙. Set each one on its own.'); }
    else { unchips(); closePanel(); const b = document.getElementById('sml-cz-bar'); if (b) b.remove(); void flush(); }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (document.getElementById('sml-cz-panel')) closePanel(); else if (cz.on) czToggle(false); } });
  document.addEventListener('click', (e) => { const p = document.getElementById('sml-cz-panel'); if (p && !p.contains(e.target) && !e.target.closest('.sml-cz-chip,#sml-cz-bar,.sml-wh')) closePanel(); });

  window.smlAcademyFloat = float;
  window.smlAcademyCustomize = { toggle: czToggle, isOn: () => cz.on, float, close: unfloat, windows: () => [...wins.keys()] };

  /* ---------- boot: restore the member's windows and settings ---------- */
  const ready = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  ready(async () => {
    document.body.appendChild(layer);
    for (let i = 0; i < 60 && !window.smlAcademySessionToken; i++) await sleep(250);
    const saved = await load();
    if (saved && typeof saved === 'object') {
      state = { v: 2, panels: Array.isArray(saved.panels) ? saved.panels : [], modules: saved.modules && typeof saved.modules === 'object' ? saved.modules : {} };
      lastSaved = JSON.stringify({ v: 2, scope: 'activity', panels: state.panels, modules: state.modules });
    }
    applyAll();
    new MutationObserver(queueApply).observe(document.body, { childList: true, subtree: true });
    if (!coarse()) for (const p of state.panels) { if (p && p.id) await float(p.id, p); }
    window.addEventListener('resize', () => { for (const w of wins.values()) { w.geom.x = clamp(w.geom.x, -w.geom.w + 80, innerWidth - 80); w.geom.y = clamp(w.geom.y, 0, innerHeight - 30); place(w); } });
  });
})();
