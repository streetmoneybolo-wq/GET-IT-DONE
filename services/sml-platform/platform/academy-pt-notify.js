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
  const open = (u) => { try { window.focus(); } catch (_) { /* fine */ } if (window.smlAlertsDesk && window.smlAlertsDesk.openAlert) window.smlAlertsDesk.openAlert(u.id, u.symbol); else if (window.smlAcademyNavigateMarket) window.smlAcademyNavigateMarket(u.symbol); };
  const up = (u) => u.side !== 'short';
  const stopLine = (u) => (u.stopRange ? '🚨 Stop ' + (up(u) ? 'raised: below' : 'lowered: above') + ' $' + px(u.stopRange.low) + '–$' + px(u.stopRange.high) + (u.stopWas ? ' (was ' + u.stopWas + ')' : '') : '');

  function card(u) {
    const el = document.createElement('section');
    el.className = 'sml-pt'; el.setAttribute('role', 'status');
    const ladder = typeof window.smlAcademyPtLadder === 'function' ? window.smlAcademyPtLadder(u, 0, [u]) : '';
    const chips = (u.signals || []).slice(0, 6).map((x) => { const c = TONE[x.tone] || TONE.ok; return '<span style="background:' + c[0] + ';color:' + c[1] + '">' + esc(x.text) + '</span>'; }).join('');
    const perm = 'Notification' in window && Notification.permission === 'default';
    el.innerHTML = '<div class="sml-pt-top"><b>🎯 NEW PRICE TARGET SET</b><small>PT ' + esc(u.n) + ' smashed</small><button type="button" class="sml-pt-x" aria-label="Dismiss">✕</button></div>'
      + '<div class="sml-pt-body"><div class="sml-pt-sym"><strong>' + esc(u.symbol) + '</strong><em>$' + px(u.previous) + ' →</em><span>$' + px(u.target) + ' (' + (up(u) ? '+' : '−') + esc(u.pct) + '%)</span></div>'
      + (u.stopRange ? '<div class="sml-pt-stop">' + esc(stopLine(u)) + '</div>' : '') + ladder
      + (chips ? '<div class="sml-pt-chips">' + chips + '</div>' : '') + (u.story ? '<p class="sml-pt-story">' + esc(u.story) + '</p>' : '') + '</div>'
      + '<div class="sml-pt-act"><button type="button" class="go" data-a="open">Open alert</button>' + (u.story ? '<button type="button" data-a="more">Read all</button>' : '') + (perm ? '<button type="button" data-a="perm">Desktop pop-ups</button>' : '') + '</div>'
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
      if (b.dataset.a === 'perm') Notification.requestPermission().then((r) => { b.textContent = r === 'granted' ? 'Desktop pop-ups on' : 'Desktop pop-ups blocked'; b.disabled = true; }).catch(() => {});
    });
    const st = host(); st.insertBefore(el, st.firstChild);
    while (st.children.length > 3) st.lastChild.remove();
    arm();
  }
  function desktop(u) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
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
  window.smlAcademyPtNotify = { poll, preview: (u) => card(u) };
})();
