/* Academy: "New price target set" pop-up. When the price-target engine smashes a target on an alert the member can see, a card slides in with the
 * old and new target, the raised stop, the target ladder, the chart readings behind it and the write-up in plain words. "Open alert" expands that
 * alert on the desk and charts it. With desktop notifications switched on (one click on the card), it also pops up while the Academy is in the
 * background. Every window of the Academy shares one "seen" list, so a target pops up once, not once per pop-out window. Educational only. */
(() => {
  if (window.__smlPtNotify) return;
  window.__smlPtNotify = 1;
  const SEEN = 'sml-pt-seen-v1', SINCE = 'sml-pt-since-v1';
  const popout = new URLSearchParams(location.search).has('popout');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const px = (v) => { v = Number(v); return !Number.isFinite(v) ? '–' : v >= 1 ? v.toFixed(2) : v.toFixed(4); };
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private window: the card still shows */ } };
  const css = document.createElement('style');
  css.textContent = '#sml-pt-stack{position:fixed;top:64px;right:14px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 28px));pointer-events:none}'
    + '@media(max-width:720px){#sml-pt-stack{top:auto;bottom:12px;right:12px;left:12px;width:auto}}'
    + '.sml-pt{pointer-events:auto;border:1px solid #1f6b4b;border-radius:12px;background:#08120f;color:#dbe7ec;font:500 12.5px/1.45 system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.55),0 0 0 1px rgba(25,227,107,.08);overflow:hidden;animation:smlPtIn .35s ease-out}'
    + '@keyframes smlPtIn{from{transform:translateY(-10px);opacity:0}to{transform:none;opacity:1}}@media(prefers-reduced-motion:reduce){.sml-pt{animation:none}}'
    + '.sml-pt-top{display:flex;align-items:center;gap:8px;padding:9px 12px;background:linear-gradient(90deg,#0b3b2e,#08120f);border-bottom:1px solid #16402f}.sml-pt-top b{font:900 11px ui-monospace,monospace;letter-spacing:.08em;color:#7ef0bd}.sml-pt-top small{margin-left:auto;color:#7b93a0;font:700 10px ui-monospace,monospace}'
    + '.sml-pt-x{border:0;background:none;color:#8fa6b3;font-size:15px;cursor:pointer;padding:0 2px}.sml-pt-x:hover,.sml-pt-x:focus-visible{color:#fff}'
    + '.sml-pt-body{padding:10px 12px}.sml-pt-sym{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.sml-pt-sym strong{font:900 20px ui-monospace,monospace;color:#fff}.sml-pt-sym span{font:800 13px ui-monospace,monospace;color:#19e36b}.sml-pt-sym em{font-style:normal;color:#8fa6b3;font:700 12px ui-monospace,monospace}'
    + '.sml-pt-stop{margin-top:3px;color:#ff9aa4;font:700 11.5px ui-monospace,monospace}.sml-pt-chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.sml-pt-chips span{padding:2px 7px;border-radius:999px;font:800 10px ui-monospace,monospace}'
    + '.sml-pt-story{margin:4px 0 0;color:#cfdde3;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.sml-pt.more .sml-pt-story{display:block}'
    + '.sml-pt-act{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 11px}.sml-pt-act button{border:1px solid #2b4b5a;border-radius:7px;background:#0c1821;color:#dcecf2;padding:6px 10px;font:800 11px system-ui;cursor:pointer}.sml-pt-act button.go{background:#00c47d;border-color:#00c47d;color:#042217}.sml-pt-act button:focus-visible{outline:2px solid #7ef0bd;outline-offset:1px}'
    + '.sml-pt-foot{padding:0 12px 9px;color:#5f7784;font-size:10px}';
  document.head.appendChild(css);
  const TONE = { good: ['#0b3b2e', '#7ef0bd'], ok: ['#16232b', '#cfd9de'], warn: ['#3a2a0c', '#ffcf7a'] };
  let stack = null;
  const host = () => { if (!stack) { stack = document.createElement('div'); stack.id = 'sml-pt-stack'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); } return stack; };

  function chime() {
    try {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      const ctx = new A(), t = ctx.currentTime;
      [880, 1318.5].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.35); o.connect(g).connect(ctx.destination); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.4); });
      setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch (_) { /* no sound is fine */ }
  }
  /* Push alerts: a service worker + Web Push subscription, so the notification arrives with the Academy closed (phone or desktop).
     iPhone/iPad: only for an Academy added to the Home Screen. Inside the Discord app the browser cannot hold a subscription, so the button says where to do it. */
  const inDiscord = /discordsays\.com$/i.test(location.hostname) || window.self !== window.top;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushCapable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !inDiscord;
  const push = { on: false, busy: false, note: '' };
  const authed = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (window.smlAcademySessionToken || '') }, body: JSON.stringify(body || {}) });
  const keyBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  const reg = () => navigator.serviceWorker.register('/academy-activity/push-sw.js', { scope: '/academy-activity/' });
  async function pushState() {
    if (!pushCapable) return false;
    try { const r = await navigator.serviceWorker.getRegistration('/academy-activity/'); const sub = r && await r.pushManager.getSubscription(); push.on = !!sub && Notification.permission === 'granted'; } catch (_) { push.on = false; }
    paintBell(); return push.on;
  }
  async function enablePush() {
    if (push.busy) return false;
    if (!pushCapable) { push.note = inDiscord ? 'Open the Academy in your browser (pop-out or link) to turn on push alerts.' : 'This browser does not support push alerts.'; paintBell(true); return false; }
    if (ios && !standalone) { push.note = 'On iPhone/iPad: tap Share → Add to Home Screen, open the Academy from that icon, then turn on push alerts.'; paintBell(true); return false; }
    if (!window.smlAcademySessionToken) { push.note = 'Sign in to the Academy first.'; paintBell(true); return false; }
    push.busy = true; paintBell();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s site settings.' : 'Notifications were not allowed.');
      const k = await (await fetch('/academy-activity/push/key', { cache: 'no-store' })).json();
      if (!k || !k.ok) throw new Error('Push alerts are not available right now.');
      const r = await reg(); await navigator.serviceWorker.ready;
      let sub = await r.pushManager.getSubscription();
      if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.publicKey) });
      const res = await authed('/academy-activity/push/subscribe', { subscription: sub.toJSON() });
      if (!res.ok) throw new Error('Could not save the subscription. Try again.');
      push.on = true; push.note = 'Push alerts on. A test notification is on its way.';
      authed('/academy-activity/push/test').catch(() => {});
    } catch (e) { push.note = String(e && e.message || e); }
    push.busy = false; paintBell(true); return push.on;
  }
  async function disablePush() {
    try { const r = await navigator.serviceWorker.getRegistration('/academy-activity/'); const sub = r && await r.pushManager.getSubscription(); if (sub) { await authed('/academy-activity/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } } catch (_) { /* gone already */ }
    push.on = false; push.note = 'Push alerts off on this device.'; paintBell(true);
  }
  let bell = null, tip = null, tipTimer = 0;
  function paintBell(showNote) {
    if (!bell) return;
    bell.textContent = push.busy ? '🔔 Turning on…' : push.on ? '🔔 Push alerts on' : '🔕 Push alerts';
    bell.setAttribute('aria-pressed', String(push.on));
    bell.style.borderColor = push.on ? '#00c47d' : '#284654'; bell.style.color = push.on ? '#7ef0bd' : '#dbe7ec';
    bell.title = push.on ? 'You get a phone/desktop notification for every new price target, even with the Academy closed. Click to turn off on this device.' : 'Get a phone/desktop notification for every new price target, even with the Academy closed.';
    if (showNote && push.note) { if (!tip) { tip = document.createElement('div'); tip.style.cssText = 'position:fixed;z-index:2147483001;max-width:300px;padding:8px 10px;border:1px solid #284654;border-radius:8px;background:#0b141b;color:#dbe7ec;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); } const b = bell.getBoundingClientRect(); tip.style.top = (b.bottom + 6) + 'px'; tip.style.left = Math.max(8, Math.min(innerWidth - 310, b.left)) + 'px'; tip.textContent = push.note; tip.hidden = false; clearTimeout(tipTimer); tipTimer = setTimeout(() => { tip.hidden = true; }, 7000); }
  }
  (function mountBell(tries) {
    const bar = document.querySelector('main .dashbar');
    if (!bar) { if (tries < 100) setTimeout(() => mountBell(tries + 1), 300); return; }
    bell = document.createElement('button'); bell.type = 'button'; bell.id = 'academy-push-btn';
    bell.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:3px 9px;border:1px solid #284654;border-radius:999px;background:#0b141b;color:#dbe7ec;font:800 11px ui-monospace,monospace;cursor:pointer';
    bell.addEventListener('click', () => (push.on ? disablePush() : enablePush()));
    const after = document.getElementById('academy-vix-chip') || bar.querySelector('.market-state');
    if (after) after.after(bell); else bar.appendChild(bell);
    paintBell(); pushState();
  })(0);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'sml-pt-open') open({ id: m.id, symbol: m.symbol });
    if (m.type === 'sml-pt-push' && m.update) { const seen = read(SEEN, []); const k = m.update.key + ':' + m.update.n; if (!seen.includes(k)) { write(SEEN, seen.concat(k).slice(-200)); card(m.update); chime(); } }
  });
  // arriving from a tapped notification: open that alert once the desk is ready
  (function fromLink() {
    const q = new URLSearchParams(location.search), id = q.get('ptalert'); if (!id) return;
    let tries = 0;
    (function wait() { const d = window.smlAlertsDesk; if (d && d.openAlert && d.state && d.state.alerts && d.state.alerts.length) { d.openAlert(id.replace(/[^0-9]/g, ''), q.get('symbol') || ''); return; } if (++tries < 60) setTimeout(wait, 500); })();
  })();
  const open = (u) => { try { window.focus(); } catch (_) { /* fine */ } if (window.smlAlertsDesk && window.smlAlertsDesk.openAlert) window.smlAlertsDesk.openAlert(u.id, u.symbol); else if (window.smlAcademyNavigateMarket) window.smlAcademyNavigateMarket(u.symbol); };
  const up = (u) => u.side !== 'short';
  const stopLine = (u) => (u.stopRange ? '🚨 Stop ' + (up(u) ? 'raised: below' : 'lowered: above') + ' $' + px(u.stopRange.low) + '–$' + px(u.stopRange.high) + (u.stopWas ? ' (was ' + u.stopWas + ')' : '') : '');

  function card(u) {
    const el = document.createElement('section');
    el.className = 'sml-pt'; el.setAttribute('role', 'status');
    const ladder = typeof window.smlAcademyPtLadder === 'function' ? window.smlAcademyPtLadder(u, 0, [u]) : '';
    const chips = (u.signals || []).slice(0, 6).map((x) => { const c = TONE[x.tone] || TONE.ok; return '<span style="background:' + c[0] + ';color:' + c[1] + '">' + esc(x.text) + '</span>'; }).join('');
    const perm = !push.on;
    el.innerHTML = '<div class="sml-pt-top"><b>🎯 NEW PRICE TARGET SET</b><small>PT ' + esc(u.n) + ' smashed</small><button type="button" class="sml-pt-x" aria-label="Dismiss">✕</button></div>'
      + '<div class="sml-pt-body"><div class="sml-pt-sym"><strong>' + esc(u.symbol) + '</strong><em>$' + px(u.previous) + ' →</em><span>$' + px(u.target) + ' (' + (up(u) ? '+' : '−') + esc(u.pct) + '%)</span></div>'
      + (u.stopRange ? '<div class="sml-pt-stop">' + esc(stopLine(u)) + '</div>' : '') + ladder
      + (chips ? '<div class="sml-pt-chips">' + chips + '</div>' : '') + (u.story ? '<p class="sml-pt-story">' + esc(u.story) + '</p>' : '') + '</div>'
      + '<div class="sml-pt-act"><button type="button" class="go" data-a="open">Open alert</button>' + (u.story ? '<button type="button" data-a="more">Read all</button>' : '') + (perm ? '<button type="button" data-a="perm">🔔 Turn on push alerts</button>' : '') + '</div>'
      + '<div class="sml-pt-foot">Automatic price-target update · educational, not financial advice</div>';
    let timer = 0;
    const close = () => { clearTimeout(timer); el.remove(); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(close, 30000); };
    el.addEventListener('mouseenter', () => clearTimeout(timer)); el.addEventListener('mouseleave', arm); el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('click', (e) => {
      if (e.target.closest('.sml-pt-x')) { close(); return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'open') { open(u); close(); }
      if (b.dataset.a === 'more') { el.classList.toggle('more'); b.textContent = el.classList.contains('more') ? 'Show less' : 'Read all'; clearTimeout(timer); }
      if (b.dataset.a === 'perm') { b.disabled = true; enablePush().then((on) => { b.textContent = on ? 'Push alerts on' : 'Not turned on'; }); }
    });
    const st = host(); st.insertBefore(el, st.firstChild);
    while (st.children.length > 3) st.lastChild.remove();
    arm();
  }
  function desktop(u) {
    if (push.on || !('Notification' in window) || Notification.permission !== 'granted') return; // with push on, the service worker shows it
    try {
      const n = new Notification('🎯 ' + u.symbol + ' new price target $' + px(u.target), { body: 'PT ' + u.n + ' $' + px(u.previous) + ' smashed. ' + (u.stopRange ? stopLine(u).replace('🚨 ', '') + '. ' : '') + (u.story ? u.story.split('. ').slice(1, 3).join('. ') : ''), tag: 'sml-pt-' + u.key + '-' + u.n });
      n.onclick = () => { open(u); n.close(); };
    } catch (_) { /* some browsers only allow notifications from a service worker */ }
  }

  let since = Number(read(SINCE, 0)) || 0;
  async function poll() {
    const token = window.smlAcademySessionToken;
    if (!token) return;
    if (!since) since = Date.now() - 2 * 3_600_000; // first visit: the last two hours only
    try {
      let res = await fetch('/academy-activity/pt-updates?since=' + since, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const t = await window.smlAcademyReauth(); if (t) res = await fetch('/academy-activity/pt-updates?since=' + since, { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); }
      if (!res.ok) return;
      const j = await res.json();
      if (!j || !j.ok) return;
      const seen = read(SEEN, []);
      const fresh = (j.updates || []).filter((u) => !seen.includes(u.key + ':' + u.n)).sort((a, b) => a.at - b.at);
      if (fresh.length) {
        write(SEEN, seen.concat(fresh.map((u) => u.key + ':' + u.n)).slice(-200));
        fresh.slice(-3).forEach((u) => { card(u); if (document.hidden || !document.hasFocus()) desktop(u); });
        chime();
        if (window.smlAlertsDesk && window.smlAlertsDesk.reload) window.smlAlertsDesk.reload();
      }
      since = Math.max(since, ...(j.updates || []).map((u) => u.at));
      write(SINCE, since);
    } catch (_) { /* next poll */ }
  }
  // the main window asks first; pop-out windows wait a little so the card shows where the member is looking
  setTimeout(function loop() { poll().finally(() => setTimeout(loop, document.hidden ? 120000 : 45000)); }, popout ? 15000 : 6000);
  window.addEventListener('sml-academy-session', () => setTimeout(poll, popout ? 9000 : 1500));
  window.addEventListener('sml-academy-session', () => pushState());
  window.smlAcademyPtNotify = { poll, preview: (u) => card(u), enablePush, disablePush };
})();
