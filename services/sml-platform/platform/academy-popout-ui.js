/* Pop-out modules. Every Academy module gets a ⧉ button; it opens that module alone in the member's browser
 * (from Discord through openExternalLink, from an open pop-out with a plain window), so it can sit on any screen.
 * A pop-out is the whole Academy page showing just one module, so every module keeps all its live logic and any
 * new module only needs a line in MODULES (or a data-sml-module attribute).
 *
 * What a pop-out adds for a trader:
 *   - Linked tickers: windows on the same link follow each other (click a scanner row, the chart on the other screen
 *     switches). Each window can unlink.
 *   - Keep on top (Chrome/Edge): the module floats above other apps, e.g. a scanner over a broker platform.
 *   - Alerts window: a desktop notification and a chime for each new alert, even while another app is in front.
 *   - Layouts: save the windows you have open (module, size, screen position) and reopen them all later. */
(() => {
  if (window.__smlPopoutUi) return;
  window.__smlPopoutUi = 1;

  const MODULES = [
    ['chart', 'Chart', 'section.chart'],
    ['direction', 'Market direction', '#academy-direction'],
    ['alerts', 'Alerts desk', '#academy-alerts'],
    ['quote', 'Quote & order book', 'aside.side'],
    ['quote-stats', 'Quote statistics', '.academy-quote-stats'],
    ['book', 'Top of book', 'aside.side .book'],
    ['level2', 'Level 2', '.academy-depth'],
    ['tape', 'Time & sales', '.academy-tape'],
    ['trade-stats', 'Trade statistics', '.academy-stats'],
    ['buy-sell', 'Buy / sell pressure', '.academy-buysell'],
    ['dark-pool', 'Dark pool', '.academy-darkpool'],
    ['short-sale', 'Short sale', '.academy-shortsale'],
    ['options-focus', 'Options focus', '#options-focus'],
    ['sire', 'S.I.R.E.', '#sire-panel'],
    ['mem-algo', 'MEM ALGO', '#mem-algo-panel'],
    ['indicators', 'Indicator engine', 'section.academy-intelligence'],
    ['screener', 'Screener', '#academy-screener'],
    ['earnings', 'Earnings', '#earnings-panel'],
    ['options', 'Options chain', '#options-chain'],
    ['calculator', 'Options calculator', 'section.opt-calc'],
    ['scanner', 'Live scanner', 'section.academy-scanner'],
    ['scanner-intel', 'Scanner intelligence', 'section.academy-rank-lab'],
    ['chat', 'Chat', 'section.academy-chat'],
    ['class', 'Class', '#lesson']
  ];
  const POP = window.smlAcademyPopout || '';
  const ME = Math.random().toString(36).slice(2, 12);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* fine */ } } };
  const modules = () => {
    const list = MODULES.map(([id, label, sel]) => ({ id, label, el: document.querySelector(sel) }));
    document.querySelectorAll('[data-sml-module]').forEach((el) => { const id = String(el.getAttribute('data-sml-module') || ''); if (/^[a-z0-9-]{2,24}$/.test(id) && !list.some((m) => m.id === id)) list.push({ id, label: el.getAttribute('data-sml-module-label') || id, el }); });
    return list;
  };
  const labelOf = (id) => { const m = modules().find((x) => x.id === id); return m ? m.label : id; };
  const symbol = () => { try { const s = window.smlAcademyChartState && window.smlAcademyChartState().symbol; if (s) return String(s).toUpperCase(); } catch (_) { /* fall back */ } const input = document.getElementById('symbol'); return String(input && input.value || new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase(); };
  const coarse = () => matchMedia('(pointer:coarse)').matches || innerWidth < 760;

  const css = document.createElement('style');
  css.textContent = '.sml-pop-btn{position:absolute;top:5px;right:5px;z-index:30;width:24px;height:22px;display:grid;place-items:center;border:1px solid #2b4b5a;border-radius:6px;background:rgba(9,17,24,.88);color:#9fe8c8;font:800 13px/1 system-ui;cursor:pointer;opacity:.55;transition:opacity .15s}'
    + '.sml-pop-btn:hover,.sml-pop-btn:focus-visible{opacity:1;border-color:#00c47d;outline:none}*:hover>.sml-pop-btn{opacity:.95}'
    + 'html.sml-popout,html.sml-popout body{overflow:hidden!important;height:100%!important}'
    + '.sml-pop-hide{display:none!important}.sml-pop-show{display:block!important}.sml-pop-path{transform:none!important;filter:none!important;contain:none!important;animation:none!important}'
    + '.sml-pop-solo{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;overflow:auto!important;z-index:1!important}'
    + '.sml-pop-solo.chart{display:flex!important;flex-direction:column!important}.sml-pop-solo.chart .academy-chart-stage{flex:1 1 auto!important;height:auto!important;min-height:220px}'
    + 'html.sml-popout .sml-pop-btn{display:none}'
    + '#sml-pop-bar{position:fixed;top:6px;right:6px;z-index:2147483300;display:flex;gap:4px;align-items:center;padding:3px;border:1px solid #23404d;border-radius:9px;background:rgba(6,12,18,.92);font:800 11px/1 system-ui,sans-serif;color:#cfe3ea;opacity:.35;transition:opacity .15s}'
    + '#sml-pop-bar:hover,#sml-pop-bar:focus-within{opacity:1}#sml-pop-bar button{border:1px solid #2b4b5a;border-radius:6px;background:#0c1821;color:#dcecf2;padding:5px 7px;font:inherit;cursor:pointer}#sml-pop-bar button.on{border-color:#00c47d;color:#7ef0bd}'
    + '#sml-pop-menu{position:fixed;top:40px;right:6px;z-index:2147483301;max-height:70vh;overflow:auto;min-width:210px;padding:6px;border:1px solid #23404d;border-radius:9px;background:#08111a;box-shadow:0 10px 30px rgba(0,0,0,.6);font:700 12px system-ui,sans-serif;color:#dcecf2}#sml-pop-menu button{display:block;width:100%;text-align:left;border:0;background:none;color:inherit;padding:7px 8px;border-radius:6px;font:inherit;cursor:pointer}#sml-pop-menu button:hover{background:#12232e}#sml-pop-menu small{display:block;padding:6px 8px 2px;color:#7b93a0;font-weight:600}'
    + '#sml-pop-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483400;max-width:min(520px,92vw);padding:9px 13px;border:1px solid #1f8a5f;border-radius:9px;background:#071a13;color:#c9f6e2;font:700 12px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.55)}'
    + '#sml-pop-hold{display:grid;place-items:center;height:100%;color:#7b93a0;font:700 13px system-ui;text-align:center;padding:20px}';
  document.head.appendChild(css);

  let toastTimer = 0;
  const toast = (text) => { let t = document.getElementById('sml-pop-toast'); if (!t) { t = document.createElement('div'); t.id = 'sml-pop-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = text; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4200); };

  /* ---------- open a module in its own window ---------- */
  const session = async () => window.smlAcademySessionToken || (typeof window.smlAcademyReauth === 'function' ? await window.smlAcademyReauth() : '');
  const sizeFor = (id) => ({ chart: [1100, 680], scanner: [1100, 700], options: [1000, 700], chat: [460, 720], alerts: [420, 760], level2: [360, 640], tape: [360, 640] }[id] || [520, 620]);
  function openHere(id, place) {
    const [w, h] = place ? [place.w, place.h] : sizeFor(id);
    const feat = 'popup,width=' + Math.round(w) + ',height=' + Math.round(h) + (place ? ',left=' + Math.round(place.x) + ',top=' + Math.round(place.y) : '');
    return window.open('/academy-activity/?popout=' + encodeURIComponent(id) + '&symbol=' + encodeURIComponent(symbol()), 'sml-pop-' + id + '-' + Math.random().toString(36).slice(2, 7), feat);
  }
  async function popOut(id) {
    if (POP) { if (!openHere(id)) toast('Your browser blocked the new window. Allow pop-ups for this site and try again.'); return; }
    let token = await session();
    if (!token) { toast('Sign in to the Academy first, then pop the module out.'); return; }
    const ask = (t) => fetch('/academy-activity/popout/ticket', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ module: id, symbol: symbol() }), cache: 'no-store' });
    let res = await ask(token);
    if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { token = await window.smlAcademyReauth(); if (token) res = await ask(token); }
    let p = {};
    try { p = await res.json(); } catch (_) { /* handled below */ }
    if (!res.ok || !p.url) { toast(p.error === 'rate_limited' ? 'Too many windows at once. Wait a moment and try again.' : 'Could not open that window right now. Try again in a moment.'); return; }
    const opened = typeof window.smlAcademyOpenExternal === 'function' ? await window.smlAcademyOpenExternal(p.url) : !!window.open(p.url, '_blank', 'noopener');
    toast(opened ? labelOf(id) + ' opens in your browser. Drag it to any screen; it stays live and follows your ticker.' : 'Discord did not open the window. Try the button again.');
    startBus();
  }

  /* ---------- the ⧉ buttons (inside Discord, and inside a pop-out for modules nested in it) ---------- */
  function addButtons() {
    if (coarse()) return;
    for (const m of modules()) {
      const el = m.el;
      if (!el || el.querySelector(':scope > .sml-pop-btn') || (POP && m.id === POP)) continue;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sml-pop-btn'; b.textContent = '⧉';
      b.title = 'Pop out ' + m.label + ': its own window you can drag to another screen';
      b.setAttribute('aria-label', 'Pop out ' + m.label);
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void popOut(m.id); });
      el.appendChild(b);
      place(b);
    }
  }
  /* never cover a module's own controls: try the top-right corner, then step left, then the bottom-right */
  const SPOTS = [[5, 5], [5, 33], [5, 61], [5, 89], [5, 117], [5, 145], ['b', 5]];
  function covers(b) {
    const r = b.getBoundingClientRect();
    if (!r.width) return false;
    for (const c of b.parentElement.querySelectorAll('button,a,select,input,[role=button]')) {
      if (c === b || c.classList.contains('sml-pop-btn')) continue;
      const q = c.getBoundingClientRect();
      if (q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) return true;
    }
    return false;
  }
  function place(b) {
    for (const [top, right] of SPOTS) {
      b.style.top = top === 'b' ? 'auto' : top + 'px'; b.style.bottom = top === 'b' ? '5px' : 'auto'; b.style.right = right + 'px';
      if (!covers(b)) return;
    }
  }
  let scanQueued = false;
  const queueScan = () => { if (scanQueued) return; scanQueued = true; setTimeout(() => { scanQueued = false; addButtons(); }, 400); };
  // layouts shift as panels open and close: re-check now and then, never on every live tick
  setInterval(() => { if (!document.hidden) document.querySelectorAll('.sml-pop-btn').forEach((b) => { if (covers(b)) place(b); }); }, 5000);

  /* ---------- linked tickers across a member's windows ---------- */
  const LINK_KEY = 'sml-pop-link:' + (POP || 'main');
  let linked = store.get(LINK_KEY, true), applying = false, lastSym = '', busOn = false, busStop = false;
  const bornAt = Date.now();
  async function publish(sym) {
    const s = String(sym || '').toUpperCase();
    if (!linked || applying || !s || s === lastSym || Date.now() - bornAt < 4000) { lastSym = s || lastSym; return; }
    lastSym = s;
    const token = window.smlAcademySessionToken;
    if (!token) return;
    fetch('/academy-activity/popout/bus', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ symbol: s, from: ME }), cache: 'no-store' }).catch(() => {});
  }
  function hookNavigate() {
    const nav = window.smlAcademyNavigateMarket;
    if (typeof nav !== 'function') { setTimeout(hookNavigate, 500); return; }
    if (nav.__smlPop) return;
    const wrapped = function (value) { const out = nav.apply(this, arguments); void publish(value); return out; };
    wrapped.__smlPop = 1;
    window.smlAcademyNavigateMarket = wrapped;
  }
  function onBus(msg) {
    if (!msg || msg.type !== 'symbol' || msg.from === ME || !linked) return;
    const s = String(msg.symbol || '').toUpperCase();
    if (!s || s === symbol()) { lastSym = s; return; }
    lastSym = s; applying = true;
    try { if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(s); } finally { setTimeout(() => { applying = false; }, 300); }
    if (POP) document.title = labelOf(POP) + ' · ' + s + ' — MEM Academy';
  }
  async function startBus() {
    if (busOn) return;
    busOn = true;
    let wait = 1000;
    while (!busStop) {
      const token = window.smlAcademySessionToken || await session().catch(() => '');
      if (!token) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      try {
        const res = await fetch('/academy-activity/popout/bus', { headers: { authorization: 'Bearer ' + token, accept: 'text/event-stream' }, cache: 'no-store' });
        if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { await window.smlAcademyReauth(); continue; }
        if (!res.ok || !res.body) throw new Error('bus ' + res.status);
        wait = 1000;
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
            if (data) { try { onBus(JSON.parse(data)); } catch (_) { /* skip a bad line */ } }
          }
        }
      } catch (_) { /* reconnect below */ }
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30000);
    }
  }

  /* ---------- pop-out window: show one module, and its toolbar ---------- */
  let soloEl = null;
  const CLUTTER = '#lb-btn,#aa-btn,#academy-alerts-fab,#academy-back-to-chart,#lk-launch,#academy-lk-btn';
  function solo(el) {
    soloEl = el;
    el.classList.add('sml-pop-solo');
    if (getComputedStyle(el).display === 'none') el.style.setProperty('display', 'block', 'important');
    let child = el, n = el.parentElement;
    while (n && n !== document.documentElement) {
      n.classList.add('sml-pop-path');
      if (getComputedStyle(n).display === 'none') n.style.setProperty('display', 'block', 'important');
      // inside the page, hide every other block; at the top level hide only the other page sections, so the
      // module's own menus, tooltips and drawers (fixed overlays on <body>) keep working
      const others = n === document.body ? 'main,section' : '*';
      for (const c of n.children) if (c !== child && c.matches(others) && !c.matches('script,style,#sml-pop-bar,#sml-pop-menu,#sml-pop-toast')) c.classList.add('sml-pop-hide');
      child = n; n = n.parentElement;
    }
    new MutationObserver(() => { document.querySelectorAll(CLUTTER).forEach((x) => x.classList.add('sml-pop-hide')); }).observe(document.body, { childList: true });
    document.querySelectorAll(CLUTTER).forEach((x) => x.classList.add('sml-pop-hide'));
    document.title = labelOf(POP) + ' · ' + symbol() + ' — MEM Academy';
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 600);
  }
  function waitFor(id, ms) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => { const m = modules().find((x) => x.id === id); if (m && m.el) { resolve(m.el); return; } if (Date.now() - started > ms) { resolve(null); return; } setTimeout(tick, 200); };
      tick();
    });
  }

  async function keepOnTop(btn) {
    if (!('documentPictureInPicture' in window)) { toast('Keep on top works in Chrome and Edge on a computer.'); return; }
    if (!soloEl) return;
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: Math.max(320, Math.min(soloEl.offsetWidth || 520, 1000)), height: Math.max(240, Math.min(soloEl.offsetHeight || 520, 800)) });
      document.querySelectorAll('style,link[rel="stylesheet"]').forEach((s) => pip.document.head.appendChild(s.cloneNode(true)));
      pip.document.documentElement.className = document.documentElement.className;
      pip.document.body.className = document.body.className;
      pip.document.title = document.title;
      const hold = document.createElement('div');
      hold.id = 'sml-pop-hold'; hold.textContent = labelOf(POP) + ' is floating on top. Close the floating window to bring it back here.';
      soloEl.before(hold);
      pip.document.body.appendChild(soloEl);
      btn.classList.add('on');
      pip.addEventListener('resize', () => window.dispatchEvent(new Event('resize')));
      pip.addEventListener('pagehide', () => { hold.replaceWith(soloEl); btn.classList.remove('on'); window.dispatchEvent(new Event('resize')); }, { once: true });
      window.dispatchEvent(new Event('resize'));
    } catch (_) { toast('The browser did not allow a floating window here.'); }
  }

  /* alerts window: desktop notification + chime for each new alert */
  let notifyOn = store.get('sml-pop-notify', false);
  function chime() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.2, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.5); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.5); } catch (_) { /* silent */ } }
  function watchAlerts(el) {
    const seen = new Set([...el.querySelectorAll('[data-id]')].map((r) => r.getAttribute('data-id')));
    new MutationObserver(() => {
      for (const r of el.querySelectorAll('[data-id]')) {
        const id = r.getAttribute('data-id');
        if (seen.has(id)) continue;
        seen.add(id);
        if (!notifyOn) continue;
        chime();
        const text = String(r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        try { if (window.Notification && Notification.permission === 'granted') new Notification('New alert · MEM Academy', { body: text, tag: 'mem-alert-' + id }); } catch (_) { /* window still chimes */ }
      }
    }).observe(el, { childList: true, subtree: true });
  }

  /* layouts: every pop-out window reports where it sits; Save keeps that set, Open reopens it */
  const WINS = 'sml-pop-wins', LAYOUT = 'sml-pop-layout';
  function heartbeat() {
    const all = store.get(WINS, {});
    const t = Date.now();
    for (const k of Object.keys(all)) if (t - all[k].t > 15000) delete all[k];
    all[ME] = { mod: POP, x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, t };
    store.set(WINS, all);
  }
  function saveLayout() {
    heartbeat();
    const all = Object.values(store.get(WINS, {})).filter((w) => Date.now() - w.t < 15000);
    store.set(LAYOUT, all);
    toast('Layout saved: ' + all.length + ' window' + (all.length === 1 ? '' : 's') + ' (' + all.map((w) => labelOf(w.mod)).join(', ') + ').');
  }
  let pendingOpen = [];
  async function openLayout() {
    const saved = store.get(LAYOUT, []);
    if (!saved.length) { toast('No saved layout yet. Open your windows, place them, then press Save layout.'); return; }
    if (!pendingOpen.length) {
      const open = Object.values(store.get(WINS, {})).filter((w) => Date.now() - w.t < 15000).map((w) => w.mod);
      pendingOpen = saved.filter((w) => !open.includes(w.mod));
      try { if (window.getScreenDetails) await window.getScreenDetails(); } catch (_) { /* windows open on this screen instead */ }
    }
    while (pendingOpen.length) {
      const w = pendingOpen[0];
      if (!openHere(w.mod, w)) { toast('Press Open layout again to open the next window (' + pendingOpen.length + ' left).'); return; }
      pendingOpen.shift();
    }
    toast('Layout opened.');
  }

  function bar() {
    const b = document.createElement('div');
    b.id = 'sml-pop-bar';
    b.innerHTML = '<button type="button" data-a="link" title="Follow the ticker of your other linked windows">🔗 Linked</button>'
      + '<button type="button" data-a="top" title="Float this window above other apps (Chrome, Edge)">📌 On top</button>'
      + (POP === 'alerts' ? '<button type="button" data-a="notify" title="Desktop notification and a chime for each new alert">🔔 Alerts</button>' : '')
      + '<button type="button" data-a="add" title="Open another module in its own window">＋ Window</button>'
      + '<button type="button" data-a="layout" title="Save or reopen your window layout">▦ Layout</button>';
    document.body.appendChild(b);
    const paint = () => { const l = b.querySelector('[data-a="link"]'); l.classList.toggle('on', !!linked); l.textContent = linked ? '🔗 Linked' : '⛓ Unlinked'; const n = b.querySelector('[data-a="notify"]'); if (n) n.classList.toggle('on', !!notifyOn); };
    paint();
    const closeMenu = () => { const m = document.getElementById('sml-pop-menu'); if (m) m.remove(); };
    const menu = (html, onPick) => { closeMenu(); const m = document.createElement('div'); m.id = 'sml-pop-menu'; m.innerHTML = html; m.addEventListener('click', (e) => { const x = e.target.closest('[data-pick]'); if (x) { closeMenu(); onPick(x.getAttribute('data-pick')); } }); document.body.appendChild(m); setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('click', off); } }), 0); };
    b.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const what = a.getAttribute('data-a');
      if (what === 'link') { linked = !linked; store.set(LINK_KEY, linked); paint(); toast(linked ? 'Linked: this window follows your other linked windows.' : 'Unlinked: this window keeps its own ticker.'); }
      if (what === 'top') void keepOnTop(a);
      if (what === 'notify') {
        if (!notifyOn && window.Notification && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (_) { /* chime only */ } }
        notifyOn = !notifyOn; store.set('sml-pop-notify', notifyOn); paint();
        toast(notifyOn ? 'You will get a desktop notification and a chime for each new alert.' : 'Alert notifications off.');
      }
      if (what === 'add') menu('<small>Open in its own window</small>' + modules().filter((m) => m.el && m.id !== POP).map((m) => '<button type="button" data-pick="' + esc(m.id) + '">' + esc(m.label) + '</button>').join(''), (id) => { if (!openHere(id)) toast('Your browser blocked the new window. Allow pop-ups for this site.'); });
      if (what === 'layout') menu('<button type="button" data-pick="save">Save layout (the windows open now)</button><button type="button" data-pick="open">Open saved layout</button><small>Layouts remember each window\'s module, size and screen.</small>', (x) => { if (x === 'save') saveLayout(); else void openLayout(); });
    });
  }

  /* the page's sign-in messages live in the top bar, which a pop-out hides: show the ones that matter here */
  function watchAuth() {
    const say = { popout_expired: 'This window has expired. Close it and pop the module out again from the Academy in Discord.', access_ended: 'Your Academy access has ended, so this window stopped updating.', academy_role_required: 'Your Academy access has ended, so this window stopped updating.' };
    const paint = () => {
      const code = document.body.dataset.academyAuth || '';
      let box = document.getElementById('sml-pop-auth');
      if (!say[code]) { if (box) box.remove(); return; }
      if (!box) { box = document.createElement('div'); box.id = 'sml-pop-auth'; box.setAttribute('role', 'alert'); box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483350;padding:10px 14px;background:#3a1d07;border-bottom:1px solid #ff9f43;color:#ffd7a1;font:700 13px/1.4 system-ui,sans-serif;text-align:center'; document.body.appendChild(box); }
      box.textContent = say[code];
    };
    new MutationObserver(paint).observe(document.body, { attributes: true, attributeFilter: ['data-academy-auth'] });
    paint();
  }

  /* modules that only appear after a click on the full page (a view tab, a toggle): the window makes that click */
  const clickView = (label) => { const b = [...document.querySelectorAll('.academy-view-cycle button')].find((x) => String(x.textContent || '').trim().toUpperCase().indexOf(label) === 0); if (b && !b.classList.contains('on')) b.click(); };
  const OPEN = {
    earnings: () => clickView('EARNINGS'),
    'scanner-intel': () => clickView('SCANNER INTELLIGENCE'),
    options: () => clickView('OPTIONS CHAIN'),
    calculator: () => clickView('OPTIONS CHAIN'),
    'mem-algo': () => { const p = document.getElementById('mem-algo-panel'); const t = document.getElementById('mem-algo-toggle'); if (t && (!p || String(p.innerText || '').replace('⧉', '').trim().length < 5)) t.click(); },
    // panels with their own on/off state only fetch data while they are switched on
    sire: () => { const sp = window.smlSirePanel; if (sp && sp.state && !sp.state.open) sp.open(); },
    screener: () => { const sc = document.getElementById('academy-screener'); if (sc && getComputedStyle(sc).display === 'none') { const t = document.getElementById('academy-screener-toggle'); if (t) t.click(); } },
    alerts: () => { const a = document.getElementById('academy-alerts'); if (a && getComputedStyle(a).display === 'none') { const f = document.getElementById('academy-alerts-fab'); if (f) f.click(); } }
  };
  const READY = { sire: () => !!(window.smlSirePanel && window.smlSirePanel.state && window.smlSirePanel.state.open) };
  const hasContent = (id) => { const m = modules().find((x) => x.id === id); return !!(m && m.el && String(m.el.innerText || '').replace('⧉', '').trim().length > 4); };

  async function bootPopout() {
    watchAuth();
    const ready = () => (READY[POP] ? READY[POP]() : hasContent(POP));
    if (OPEN[POP]) for (let i = 0; i < 15 && !(i > 0 && ready()); i++) { try { OPEN[POP](); } catch (_) { /* try again */ } await new Promise((r) => setTimeout(r, 800)); }
    const el = await waitFor(POP, 20000);
    if (!el) { document.body.insertAdjacentHTML('beforeend', '<div id="sml-pop-hold" style="position:fixed;inset:0;z-index:2147483000;background:#070b10">' + esc(labelOf(POP)) + ' could not be found on this page. Close this window and pop it out again from the Academy.</div>'); return; }
    solo(el);
    bar();
    // panels that fill only when there is data (dark pool, short sale...) say so instead of showing a blank window
    const wait = document.createElement('div');
    wait.id = 'sml-pop-wait';
    wait.style.cssText = 'position:fixed;inset:0;z-index:2;display:none;place-items:center;padding:24px;text-align:center;color:#7b93a0;font:700 13px/1.5 system-ui,sans-serif;pointer-events:none';
    document.body.appendChild(wait);
    const checkEmpty = () => { const empty = !String(el.innerText || '').replace('⧉', '').trim(); wait.textContent = labelOf(POP) + ' for ' + symbol() + ' is waiting for data. It fills in by itself as soon as there is activity.'; wait.style.display = empty ? 'grid' : 'none'; };
    // the full page may hide a view later (its tabs remember the last one): keep this window's module and its parents shown
    const keepShown = () => { let n = el; while (n && n !== document.body) { if (getComputedStyle(n).display === 'none') n.classList.add('sml-pop-show'); n = n.parentElement; } };
    let keepQueued = false;
    keepShown(); new MutationObserver(() => { if (keepQueued) return; keepQueued = true; requestAnimationFrame(() => { keepQueued = false; keepShown(); }); }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'hidden'] });
    checkEmpty(); setInterval(checkEmpty, 2000);
    if (POP === 'alerts') watchAlerts(el);
    heartbeat(); setInterval(heartbeat, 4000);
    addEventListener('pagehide', () => { const all = store.get(WINS, {}); delete all[ME]; store.set(WINS, all); busStop = true; });
    // keep the session fresh: 15-minute sessions, renewed (and access re-checked) every 12 minutes
    setInterval(() => { if (typeof window.smlAcademyReauth === 'function') window.smlAcademyReauth(); }, 12 * 60 * 1000);
    hookNavigate();
    void startBus();
  }

  const ready = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  ready(() => {
    if (POP) { void bootPopout(); return; }
    addButtons();
    new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
    hookNavigate();
    // the Discord window joins the link once signed in, so a pop-out's ticker clicks move the chart here too
    const join = () => { if (window.smlAcademySessionToken) void startBus(); };
    window.addEventListener('sml-academy-session', join);
    join();
  });
})();
