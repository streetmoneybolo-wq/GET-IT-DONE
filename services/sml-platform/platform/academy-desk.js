/* Trading Desk: a single pop-out window where multiple Academy modules live as drag/resize panels.
 * Opens when ?popout=desk. Sets __smlDeskMode so academy-popout-ui.js skips its solo boot. */
(() => {
  const POP = window.smlAcademyPopout || '';
  if (POP !== 'desk') return;
  window.__smlDeskMode = true;

  const MODULES = [
    ['chart', 'Chart', 'section.chart'],
    ['direction', 'Market Direction', '#academy-direction'],
    ['unusual-volume', 'Unusual Volume', '#academy-unusual-volume'],
    ['sml-vix', 'SML VIX', '#academy-sml-vix'],
    ['alerts', 'Alerts Desk', '#academy-alerts'],
    ['quote', 'Quote', 'aside.side'],
    ['quote-stats', 'Quote Statistics', '.academy-quote-stats'],
    ['book', 'Top of Book', 'aside.side .book'],
    ['level2', 'Level 2', '.academy-depth'],
    ['tape', 'Time & Sales', '.academy-tape'],
    ['trade-stats', 'Trade Statistics', '.academy-stats'],
    ['buy-sell', 'Buy / Sell', '.academy-buysell'],
    ['dark-pool', 'Dark Pool', '.academy-darkpool'],
    ['short-sale', 'Short Sale', '.academy-shortsale'],
    ['sentiment', 'Sentiment', '.academy-sentiment'],
    ['sire', 'S.I.R.E.', '#sire-panel'],
    ['mem-algo', 'MEM ALGO', '#mem-algo-panel'],
    ['hedge', 'Hedge & Income', '#academy-hedge'],
    ['indicators', 'Indicators', 'section.academy-intelligence'],
    ['screener', 'Screener', '#academy-screener'],
    ['earnings', 'Earnings', '#earnings-panel'],
    ['options', 'Options Chain', '#options-chain'],
    ['calculator', 'Options Calc', 'section.opt-calc'],
    ['scanner', 'Live Scanner', 'section.academy-scanner'],
    ['scanner-intel', 'Scanner Intel', 'section.academy-rank-lab'],
    ['chat', 'Chat', 'section.academy-chat'],
    ['class', 'Class', '#lesson']
  ];
  const labelOf = (id) => (MODULES.find(([m]) => m === id) || [])[1] || id;
  const selectorOf = (id) => (MODULES.find(([m]) => m === id) || [])[2] || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const symbol = () => {
    try { const s = window.smlAcademyChartState && window.smlAcademyChartState().symbol; if (s) return String(s).toUpperCase(); } catch (_) { /* fall back */ }
    const input = document.getElementById('symbol');
    return String((input && input.value) || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();
  };
  const session = async () => window.smlAcademySessionToken || (typeof window.smlAcademyReauth === 'function' ? await window.smlAcademyReauth() : '');
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private window */ } } };

  /* --- Module activation (mirrors the OPEN map from academy-popout-ui.js) --- */
  const clickView = (label) => { const b = [...document.querySelectorAll('.academy-view-cycle button')].find((x) => String(x.textContent || '').trim().toUpperCase().indexOf(label) === 0); if (b && !b.classList.contains('on')) b.click(); };
  const loadChain = () => { const grid = document.getElementById('options-grid'); const btn = document.getElementById('load-options'); if (btn && window.smlAcademySessionToken && grid && !grid.querySelector('tr td')) btn.click(); };
  const toggleOn = (sel) => { const b = document.querySelector(sel); if (b && !b.classList.contains('on')) b.click(); };
  const OPEN = {
    earnings: () => { clickView('EARNINGS'); toggleOn('#earnings-toggle'); },
    'scanner-intel': () => clickView('SCANNER INTELLIGENCE'),
    options: () => { clickView('OPTIONS CHAIN'); loadChain(); },
    calculator: () => clickView('OPTIONS CHAIN'),
    'mem-algo': () => { const p = document.getElementById('mem-algo-panel'); const t = document.getElementById('mem-algo-toggle'); if (t && (!p || String(p.innerText || '').replace('⧉', '').trim().length < 5)) t.click(); },
    sire: () => { const sp = window.smlSirePanel; if (sp && sp.state && !sp.state.open) sp.open(); },
    screener: () => { const sc = document.getElementById('academy-screener'); if (sc && getComputedStyle(sc).display === 'none') { const t = document.getElementById('academy-screener-toggle'); if (t) t.click(); } },
    alerts: () => { const a = document.getElementById('academy-alerts'); if (a && getComputedStyle(a).display === 'none') { const f = document.getElementById('academy-alerts-fab'); if (f) f.click(); } },
    'dark-pool': () => toggleOn('#darkpool-toggle'),
    'buy-sell': () => toggleOn('#buysell-toggle'),
    'short-sale': () => toggleOn('#shortsale-toggle'),
    sentiment: () => toggleOn('#sentiment-toggle')
  };

  async function activateModule(id) {
    const sel = selectorOf(id);
    if (!sel) return null;
    if (OPEN[id]) {
      for (let i = 0; i < 12; i++) {
        try { OPEN[id](); } catch (_) { /* retry */ }
        const el = document.querySelector(sel);
        if (el && String(el.innerText || '').replace('⧉', '').trim().length > 3) break;
        await new Promise(r => setTimeout(r, 700));
      }
    }
    const started = Date.now();
    return new Promise(resolve => {
      const tick = () => { const el = document.querySelector(sel); if (el) resolve(el); else if (Date.now() - started > 18000) resolve(null); else setTimeout(tick, 250); };
      tick();
    });
  }

  /* --- State --- */
  const panels = new Map();
  let activeId = null, zTop = 10, drag = null, resize = null;
  const MIN_W = 180, MIN_H = 100, HDR = 26, TOOL_H = 72;

  /* --- CSS --- */
  const css = document.createElement('style');
  css.textContent = '#sml-desk{position:fixed;inset:0;z-index:2147483000;background:#060a10;display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif}'
    + '#sml-desk-bar{height:34px;background:#0a1020;display:flex;align-items:center;padding:0 14px;gap:10px;border-bottom:1px solid #1a2940;flex-shrink:0;user-select:none}'
    + '#sml-desk-bar .sym{color:#7ef0bd;font:800 13px/1 system-ui;letter-spacing:.5px}'
    + '#sml-desk-bar .link{font:700 11px/1 system-ui;color:#4b6b7a;cursor:pointer;padding:2px 6px;border:1px solid #1e3040;border-radius:5px}'
    + '#sml-desk-bar .link.on{color:#7ef0bd;border-color:#1a5a40}'
    + '#sml-desk-bar .pin{color:#ff9f43;font-size:14px}'
    + '#sml-desk-bar .name{color:#5a7a8a;font:700 11px/1 system-ui;margin-left:auto}'
    + '#sml-desk-tools{height:38px;background:#0c1424;display:flex;align-items:center;padding:0 10px;gap:5px;border-bottom:1px solid #1a2940;flex-shrink:0;overflow-x:auto;overflow-y:hidden}'
    + '#sml-desk-tools::-webkit-scrollbar{height:0}'
    + '.sml-dp{font:700 10px/1 system-ui;color:#9ab;padding:4px 8px;border:1px solid #1e3040;border-radius:5px;background:#0a1424;cursor:pointer;white-space:nowrap;user-select:none;display:flex;align-items:center;gap:4px}'
    + '.sml-dp.on{border-color:#2a6b50;color:#7ef0bd}'
    + '.sml-dp .x{font-size:13px;color:#5a7a8a;margin-left:2px}'
    + '.sml-dp .x:hover{color:#ff6b6b}'
    + '.sml-db{font:800 11px/1 system-ui;color:#cde;padding:5px 9px;border:1px solid #2b4b5a;border-radius:6px;background:#0c1821;cursor:pointer;white-space:nowrap;user-select:none}'
    + '.sml-db:hover{border-color:#00c47d;color:#7ef0bd}'
    + '.sml-dsep{width:1px;height:20px;background:#1a2940;flex-shrink:0}'
    + '#sml-desk-area{position:relative;flex:1;overflow:hidden}'
    + '.sml-pn{position:absolute;display:flex;flex-direction:column;border:1px solid #1a2940;border-radius:4px;background:#080e18;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.4);transition:border-color .15s}'
    + '.sml-pn.on{border-color:#2a6b50;box-shadow:0 2px 16px rgba(0,196,125,.12)}'
    + '.sml-ph{height:' + HDR + 'px;background:#0a1424;display:flex;align-items:center;padding:0 8px;gap:6px;border-bottom:1px solid #12203066;cursor:grab;flex-shrink:0;user-select:none}'
    + '.sml-ph:active{cursor:grabbing}'
    + '.sml-ph .lbl{font:700 10px/1 system-ui;color:#8aa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.sml-ph .cls{font:700 14px/1 system-ui;color:#5a7a8a;cursor:pointer;padding:0 2px}'
    + '.sml-ph .cls:hover{color:#ff6b6b}'
    + '.sml-pb{flex:1;overflow:auto;position:relative}'
    + '.sml-pb>*{width:100%!important;max-width:none!important;position:relative!important}'
    + '.sml-pb>.sml-dk-chart{display:flex!important;flex-direction:column!important;height:100%!important}'
    + '.sml-pb .academy-chart-stage{flex:1 1 auto!important;height:auto!important;min-height:180px}'
    + '.sml-pb>aside.side{width:100%!important;min-width:0!important;max-height:none!important}'
    + '.sml-rr{position:absolute;right:-3px;top:0;bottom:12px;width:6px;cursor:ew-resize;z-index:2}'
    + '.sml-rb2{position:absolute;bottom:-3px;left:0;right:12px;height:6px;cursor:ns-resize;z-index:2}'
    + '.sml-rc{position:absolute;right:-3px;bottom:-3px;width:14px;height:14px;cursor:nwse-resize;z-index:3}'
    + '#sml-desk-pick{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483100;width:min(420px,92vw);max-height:80vh;overflow-y:auto;background:#0a1424;border:1px solid #2a4a60;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.7);padding:16px}'
    + '#sml-desk-pick h3{margin:0 0 12px;font:800 14px/1.2 system-ui;color:#dfe}'
    + '.sml-pm{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;font:700 12px system-ui;color:#bcd}'
    + '.sml-pm:hover{background:#12232e}'
    + '.sml-pm.off{opacity:.35;cursor:default;pointer-events:none}'
    + '.sml-pm .p{margin-left:auto;font:800 16px system-ui;color:#00c47d}'
    + '#sml-desk-bk{position:fixed;inset:0;z-index:2147483099;background:rgba(0,0,0,.5)}'
    + '#sml-desk-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483200;padding:9px 16px;border:1px solid #1f8a5f;border-radius:9px;background:#071a13;color:#c9f6e2;font:700 12px/1.4 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.55);pointer-events:none;display:none}'
    + '#sml-desk-auth{position:fixed;left:0;right:0;top:0;z-index:2147483350;padding:10px 14px;background:#3a1d07;border-bottom:1px solid #ff9f43;color:#ffd7a1;font:700 13px/1.4 system-ui;text-align:center}';
  document.head.appendChild(css);

  /* --- Toast --- */
  let toastTm = 0;
  const toast = (text) => {
    let t = document.getElementById('sml-desk-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sml-desk-toast'; document.body.appendChild(t); }
    t.textContent = text; t.style.display = 'block';
    clearTimeout(toastTm); toastTm = setTimeout(() => { t.style.display = 'none'; }, 3500);
  };

  /* --- Build desk DOM --- */
  const desk = document.createElement('div');
  desk.id = 'sml-desk';

  const titleBar = document.createElement('div');
  titleBar.id = 'sml-desk-bar';
  titleBar.innerHTML = '<span class="pin">📌</span><span class="sym">' + esc(symbol()) + '</span>'
    + '<span class="link on" data-a="link" title="All panels follow the same ticker">🔗 Linked</span>'
    + '<span class="name">MEM Academy — Trading Desk</span>';
  desk.appendChild(titleBar);
  setInterval(() => { const s = titleBar.querySelector('.sym'); if (s) s.textContent = symbol(); }, 2000);
  titleBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a="link"]');
    if (!btn) return;
    const on = btn.classList.toggle('on');
    btn.textContent = on ? '🔗 Linked' : '⛓ Unlinked';
  });

  const tools = document.createElement('div');
  tools.id = 'sml-desk-tools';
  tools.innerHTML = '<span class="sml-dsep"></span>'
    + '<button type="button" class="sml-db" data-a="add">＋ Window</button>'
    + '<button type="button" class="sml-db" data-a="save">💾 Save Layout</button>'
    + '<button type="button" class="sml-db" data-a="academy" title="Load the windows you arranged inside the Academy">⟲ Academy layout</button>'
    + '<button type="button" class="sml-db app" data-a="app" title="Install the desk as its own app window: no browser bars, drag it to any screen" style="display:none">⬇ Open as app</button>';
  desk.appendChild(tools);
  tools.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    if (!btn) return;
    if (btn.dataset.a === 'add') showPicker();
    if (btn.dataset.a === 'save') void saveLayout();
    if (btn.dataset.a === 'academy') void loadAcademyLayout();
    if (btn.dataset.a === 'app') void installApp();
  });

  /* --- The desk as an app window (installed web app): its own window outside Discord, no browser bars, on any screen.
     The desk swaps the page's manifest for its own (start_url = this desk), the browser offers "Install", and from
     then on the desk link Discord opens lands in that app window; the pop-out renewal key in this browser signs it in. --- */
  const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch (_) { return false; } };
  let installPrompt = null;
  const paintInstall = () => {
    const b = tools.querySelector('[data-a="app"]'); if (!b) return;
    b.style.display = standalone() ? 'none' : '';
    b.textContent = installPrompt ? '⬇ Open as app' : '⬇ Open as app';
    const badge = titleBar.querySelector('.app-badge');
    if (standalone() && !badge) { const sp = document.createElement('span'); sp.className = 'link on app-badge'; sp.textContent = '▣ App window'; sp.title = 'This desk runs as its own app window'; titleBar.insertBefore(sp, titleBar.querySelector('.name')); }
  };
  function useDeskManifest() {
    try {
      let link = document.querySelector('link[rel="manifest"]');
      if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
      link.href = '/academy-activity/desk.webmanifest';
      let theme = document.querySelector('meta[name="theme-color"]');
      if (!theme) { theme = document.createElement('meta'); theme.name = 'theme-color'; document.head.appendChild(theme); }
      theme.content = '#0a1020';
      const t = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (t) t.content = 'Trading Desk';
      if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration('/academy-activity/').then((r) => { if (!r) return navigator.serviceWorker.register('/academy-activity/push-sw.js', { scope: '/academy-activity/' }); }).catch(() => { /* install still works without it in current browsers */ });
    } catch (_) { /* nothing to swap */ }
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; paintInstall(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed. The desk now opens as its own app window: no browser bars, drag it to any screen. Pop out the desk from the Academy and it lands there.'); paintInstall(); });
  async function installApp() {
    if (standalone()) { toast('This desk already runs as its own app window.'); return; }
    if (installPrompt) {
      const ev = installPrompt; installPrompt = null;
      try { ev.prompt(); const r = await ev.userChoice; if (r && r.outcome !== 'accepted') { installPrompt = ev; toast('No problem. Click ⬇ Open as app whenever you want the desk as its own window.'); } }
      catch (_) { toast('Your browser did not offer the install. Use the install icon at the right end of the address bar, or the browser menu → Install.'); }
      return;
    }
    const ua = navigator.userAgent || '';
    const how = /Edg\//.test(ua) ? 'Edge: menu (…) → Apps → Install this site as an app.' : /Chrome\//.test(ua) ? 'Chrome: click the install icon at the right end of the address bar (or menu ⋮ → Cast, save and share → Install page as app).' : /Safari/.test(ua) && !/Chrome/.test(ua) ? 'Safari: File → Add to Dock.' : 'Use your browser menu → Install (Chrome and Edge support this).';
    toast('Make the desk its own app window. ' + how + ' After that, popping the desk out from the Academy opens it there.');
  }

  /* what the customize script (academy-customize.js) drives in desk mode */
  const setSize = (id, { w, h } = {}) => {
    const s = panels.get(id); if (!s) return;
    if (Number.isFinite(w) && w > 0) { s.w = Math.max(MIN_W, Math.round(w)); s.pn.style.width = s.w + 'px'; }
    if (Number.isFinite(h) && h > 0) { s.h = Math.max(MIN_H, Math.round(h)); s.pn.style.height = s.h + 'px'; }
    const aw = area.clientWidth || innerWidth, ah = area.clientHeight || innerHeight;
    if (s.x + s.w > aw) { s.x = Math.max(0, aw - s.w); s.pn.style.left = s.x + 'px'; }
    if (s.y + s.h > ah) { s.y = Math.max(0, ah - s.h); s.pn.style.top = s.y + 'px'; }
    focusPanel(id); dispatchEvent(new Event('resize'));
  };
  window.smlAcademyDesk = {
    panels: () => [...panels.keys()], has: (id) => panels.has(id),
    get: (id) => { const s = panels.get(id); return s ? { id, x: s.x, y: s.y, w: s.w, h: s.h, pn: s.pn, bd: s.bd, el: s.el } : null; },
    add: (id) => addPanel(id), remove: (id) => removePanel(id), focus: (id) => focusPanel(id), setSize, area: () => ({ w: area.clientWidth || innerWidth, h: area.clientHeight || innerHeight }),
    save: () => saveLayout(), pick: () => showPicker(), modules: () => MODULES.map(([id, label]) => ({ id, label })), labelOf, standalone, install: installApp
  };

  const area = document.createElement('div');
  area.id = 'sml-desk-area';
  desk.appendChild(area);

  /* --- Toolbar pills --- */
  function refreshPills() {
    tools.querySelectorAll('.sml-dp').forEach(p => p.remove());
    const sep = tools.querySelector('.sml-dsep');
    for (const [id] of panels) {
      const pill = document.createElement('span');
      pill.className = 'sml-dp' + (id === activeId ? ' on' : '');
      pill.innerHTML = esc(labelOf(id)) + '<span class="x" data-rm="' + esc(id) + '" title="Remove">×</span>';
      pill.addEventListener('click', (e) => {
        const rm = e.target.dataset.rm;
        if (rm) { removePanel(rm); return; }
        focusPanel(id);
      });
      sep ? tools.insertBefore(pill, sep) : tools.appendChild(pill);
    }
  }

  /* --- Panel CRUD --- */
  async function addPanel(id, frac) {
    if (panels.has(id)) { focusPanel(id); return; }
    const aw = area.clientWidth || innerWidth;
    const ah = area.clientHeight || (innerHeight - TOOL_H);
    const x = frac ? frac.x * aw : (panels.size % 3) * 0.33 * aw;
    const y = frac ? frac.y * ah : 0;
    const w = frac ? frac.w * aw : (id === 'chart' && panels.size === 0 ? aw * 0.6 : aw * 0.4);
    const h = frac ? frac.h * ah : (panels.size === 0 ? ah : ah * 0.5);

    const pn = document.createElement('div');
    pn.className = 'sml-pn';
    pn.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + Math.max(MIN_W, w) + 'px;height:' + Math.max(MIN_H, h) + 'px;z-index:' + (++zTop);

    const hd = document.createElement('div');
    hd.className = 'sml-ph';
    hd.innerHTML = '<span class="lbl">' + esc(labelOf(id)) + '</span><span class="cls" title="Remove">×</span>';
    hd.querySelector('.cls').addEventListener('click', () => removePanel(id));
    pn.appendChild(hd);

    const bd = document.createElement('div');
    bd.className = 'sml-pb';
    pn.appendChild(bd);

    for (const [cls, dir] of [['sml-rr', 'r'], ['sml-rb2', 'b'], ['sml-rc', 'rb']]) {
      const handle = document.createElement('div');
      handle.className = cls;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); focusPanel(id);
        const s = panels.get(id);
        resize = { id, sx: e.clientX, sy: e.clientY, ow: s.w, oh: s.h, d: dir };
      });
      pn.appendChild(handle);
    }

    hd.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cls')) return;
      e.preventDefault(); focusPanel(id);
      const r = pn.getBoundingClientRect();
      const ar = area.getBoundingClientRect();
      drag = { id, sx: e.clientX, sy: e.clientY, ox: r.left - ar.left, oy: r.top - ar.top };
    });
    pn.addEventListener('mousedown', () => focusPanel(id), true);

    const placeholder = document.createElement('span');
    placeholder.style.display = 'none';
    panels.set(id, { x, y, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h), pn, bd, el: null, placeholder });
    area.appendChild(pn);
    focusPanel(id);
    refreshPills();

    const el = await activateModule(id);
    if (!el) { bd.innerHTML = '<div style="padding:20px;color:#5a7a8a;text-align:center;font:700 12px system-ui">' + esc(labelOf(id)) + ' is loading…</div>'; return; }
    const s = panels.get(id);
    if (!s) return;
    s.el = el;
    el.before(placeholder);
    if (getComputedStyle(el).display === 'none') el.style.setProperty('display', 'block', 'important');
    bd.appendChild(el);
    el.style.setProperty('height', '100%', 'important');
    el.classList.add('sml-pop-show');
    if (id === 'chart') el.classList.add('sml-dk-chart');
    setTimeout(() => dispatchEvent(new Event('resize')), 100);
    setTimeout(() => dispatchEvent(new Event('resize')), 500);
  }

  function removePanel(id) {
    const s = panels.get(id);
    if (!s) return;
    if (s.el && s.placeholder.parentElement) {
      s.placeholder.replaceWith(s.el);
      s.el.style.removeProperty('height');
      s.el.classList.remove('sml-pop-show', 'sml-dk-chart');
    }
    s.pn.remove();
    panels.delete(id);
    if (activeId === id) { const it = panels.keys().next(); activeId = it.done ? null : it.value; }
    refreshPills();
    toast(labelOf(id) + ' removed.');
  }

  function focusPanel(id) {
    activeId = id;
    for (const [pid, s] of panels) s.pn.classList.toggle('on', pid === id);
    const s = panels.get(id);
    if (s) s.pn.style.zIndex = ++zTop;
    refreshPills();
  }

  /* --- Drag & Resize --- */
  document.addEventListener('mousemove', (e) => {
    if (drag) {
      const s = panels.get(drag.id);
      if (s) {
        s.x = drag.ox + e.clientX - drag.sx;
        s.y = Math.max(0, drag.oy + e.clientY - drag.sy);
        s.pn.style.left = s.x + 'px';
        s.pn.style.top = s.y + 'px';
      }
    }
    if (resize) {
      const s = panels.get(resize.id);
      if (s) {
        const dx = e.clientX - resize.sx, dy = e.clientY - resize.sy;
        if (resize.d.includes('r')) { s.w = Math.max(MIN_W, resize.ow + dx); s.pn.style.width = s.w + 'px'; }
        if (resize.d.includes('b')) { s.h = Math.max(MIN_H, resize.oh + dy); s.pn.style.height = s.h + 'px'; }
        dispatchEvent(new Event('resize'));
      }
    }
  });
  document.addEventListener('mouseup', () => {
    if (drag || resize) dispatchEvent(new Event('resize'));
    drag = null; resize = null;
  });

  /* --- Layout persistence --- */
  function serialize() {
    const aw = area.clientWidth || 1, ah = area.clientHeight || 1;
    const out = [];
    for (const [id, s] of panels) out.push({ id, x: +(s.x / aw).toFixed(4), y: +(s.y / ah).toFixed(4), w: +(s.w / aw).toFixed(4), h: +(s.h / ah).toFixed(4) });
    return { panels: out, v: 1 };
  }

  async function saveLayout() {
    const layout = serialize();
    store.set('sml-desk-layout', layout);
    try {
      const token = await session();
      if (token) {
        const r = await fetch('/academy-activity/desk/layout', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(layout), cache: 'no-store' });
        if (r.ok) { toast('Layout saved — ' + panels.size + ' panel' + (panels.size === 1 ? '' : 's') + '.' + (standalone() ? '' : ' Want it as its own app window outside Discord? Click ⬇ Open as app.')); return; }
      }
    } catch (_) { /* fall back to local */ }
    toast('Layout saved locally — ' + panels.size + ' panel' + (panels.size === 1 ? '' : 's') + '.');
  }

  async function fetchLayout(scope) {
    const token = await session(); if (!token) return null;
    const r = await fetch('/academy-activity/desk/layout' + (scope ? '?scope=' + scope : ''), { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (!r.ok) return null; const d = await r.json(); return d.ok && d.layout && Array.isArray(d.layout.panels) ? d.layout : null;
  }
  /* the desk's own layout first; without one, the windows the member arranged inside the Academy (same fractions of the screen) */
  async function loadLayout() {
    try {
      const own = await fetchLayout('');
      if (own && own.panels.length) return own;
      const academy = await fetchLayout('activity');
      if (academy && academy.panels.length) { toast('Loaded the windows from your Academy layout.'); return academy; }
    } catch (_) { /* fall through */ }
    return store.get('sml-desk-layout', null);
  }
  async function loadAcademyLayout() {
    let layout = null; try { layout = await fetchLayout('activity'); } catch (_) { layout = null; }
    if (!layout || !layout.panels.length) { toast('No Academy layout saved yet. Open windows inside the Academy first.'); return; }
    for (const id of [...panels.keys()]) removePanel(id);
    for (const p of layout.panels) await addPanel(p.id, p);
    toast('Academy layout loaded: ' + layout.panels.length + ' window' + (layout.panels.length === 1 ? '' : 's') + '. Drag, resize, add, then Save Layout to keep this desk.');
  }

  /* --- Module picker --- */
  function showPicker() {
    if (document.getElementById('sml-desk-pick')) return;
    const bk = document.createElement('div');
    bk.id = 'sml-desk-bk'; bk.addEventListener('click', hidePicker); document.body.appendChild(bk);
    const pk = document.createElement('div');
    pk.id = 'sml-desk-pick';
    pk.innerHTML = '<h3>Add Module to Desk</h3>';
    for (const [id, label] of MODULES) {
      const has = panels.has(id);
      const row = document.createElement('div');
      row.className = 'sml-pm' + (has ? ' off' : '');
      row.innerHTML = esc(label) + (has ? '' : '<span class="p">+</span>');
      if (!has) row.addEventListener('click', () => { hidePicker(); void addPanel(id); });
      pk.appendChild(row);
    }
    document.body.appendChild(pk);
  }
  function hidePicker() {
    const a = document.getElementById('sml-desk-pick'); if (a) a.remove();
    const b = document.getElementById('sml-desk-bk'); if (b) b.remove();
  }

  /* --- Auth status (same messages as popout-ui watchAuth) --- */
  function watchAuth() {
    const msgs = { popout_expired: 'This window has expired. Close it and open the desk again from the Academy.', access_ended: 'Your Academy access has ended.', academy_role_required: 'Your Academy access has ended.' };
    const paint = () => {
      const code = (document.body && document.body.dataset.academyAuth) || '';
      let box = document.getElementById('sml-desk-auth');
      if (!msgs[code]) { if (box) box.remove(); return; }
      if (!box) { box = document.createElement('div'); box.id = 'sml-desk-auth'; box.setAttribute('role', 'alert'); document.body.appendChild(box); }
      box.textContent = msgs[code];
    };
    new MutationObserver(paint).observe(document.body, { attributes: true, attributeFilter: ['data-academy-auth'] });
    paint();
  }

  /* --- Boot --- */
  const ready = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  ready(async () => {
    watchAuth();
    document.body.appendChild(desk);
    useDeskManifest(); paintInstall(); setTimeout(paintInstall, 1500);
    document.title = 'Trading Desk \xb7 ' + symbol() + ' — MEM Academy';

    for (let i = 0; i < 60 && !window.smlAcademySessionToken; i++) await new Promise(r => setTimeout(r, 250));

    const layout = await loadLayout();
    if (layout && layout.panels && layout.panels.length) {
      for (const p of layout.panels) await addPanel(p.id, p);
    } else {
      await addPanel('chart');
    }

    let deskLastAuth = Date.now();
    const deskRenewIfStale = () => { if (typeof window.smlAcademyReauth !== 'function') return; if (Date.now() - deskLastAuth > 13 * 60 * 1000) { deskLastAuth = Date.now(); window.smlAcademyReauth(); } };
    setInterval(deskRenewIfStale, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) deskRenewIfStale(); });
    window.addEventListener('focus', deskRenewIfStale);
    window.addEventListener('pageshow', deskRenewIfStale);
    setInterval(() => { document.title = 'Trading Desk \xb7 ' + symbol() + ' — MEM Academy'; }, 3000);
  });
})();
