/* Signal radar panel (owner only): MEM ALGO buy signals across the market from /academy-activity/signals, with a 10-15% price
 * target and a one-tap Click-to-Alert. Polls every 30 s; a 403 (not the owner) removes the panel for good. New signals slide
 * in as cards with a chime. Nothing here decides anything: the server scores the signals, Click-to-Alert posts them. */
(() => {
  if (window.__smlSignalRadar) return;
  window.__smlSignalRadar = 1;
  const SEEN = 'sml-signal-seen-v1', SINCE = 'sml-signal-since-v1', OPEN = 'sml-signal-open-v1';
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const px = (v) => (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };

  const css = document.createElement('style');
  css.textContent = '#sml-sig-fab{position:fixed;left:12px;bottom:58px;z-index:2147483240;border:1px solid #1f8a5f;border-radius:999px;background:#07211a;color:#7dffc4;padding:8px 13px;font:800 .66rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5)}#sml-sig-fab.new{background:#00c47d;color:#032318;animation:smlSigPulse 1.2s ease-in-out 3}@keyframes smlSigPulse{50%{transform:scale(1.06)}}'
    + '#sml-sig{position:fixed;left:12px;bottom:98px;z-index:2147483241;width:min(400px,calc(100vw - 24px));max-height:min(72vh,640px);display:flex;flex-direction:column;background:rgba(7,13,20,.98);border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);color:#dfe9ee;font:600 .68rem/1.4 system-ui,sans-serif;overflow:hidden}'
    + '#sml-sig header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #16382b;background:#0a1d16}#sml-sig header b{font:800 .7rem ui-monospace,monospace;color:#7dffc4;letter-spacing:.06em}#sml-sig header small{color:#7f95a1;font-weight:600}#sml-sig header button{margin-left:auto;background:none;border:0;color:#7f95a1;cursor:pointer;font-size:.9rem}'
    + '#sml-sig .tabs{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid #16382b}#sml-sig .tabs button{border:1px solid #294554;border-radius:5px;background:#101e27;color:#9eb2bc;padding:4px 9px;font:800 .6rem ui-monospace,monospace;cursor:pointer}#sml-sig .tabs button.on{border-color:#00c47d;background:#0b3b2e;color:#7ef0bd}'
    + '#sml-sig .list{overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}#sml-sig .empty{color:#7f95a1;padding:14px 4px;text-align:center}'
    + '#sml-sig .sg{border:1px solid #1b3540;border-radius:10px;background:#0a1118;padding:9px 10px}#sml-sig .sg.fresh{border-color:#00c47d;box-shadow:inset 0 0 0 1px rgba(0,196,125,.25)}'
    + '#sml-sig .sg .top{display:flex;align-items:center;gap:8px}#sml-sig .sg .top strong{font:900 .95rem ui-monospace,monospace;color:#fff;cursor:pointer}#sml-sig .sg .top .st{font:800 .56rem ui-monospace,monospace;letter-spacing:.08em;padding:2px 6px;border-radius:4px;background:#13293a;color:#8fb8ff}#sml-sig .sg .top .st.day{background:#2a1f0b;color:#ffd166}#sml-sig .sg .top .gr{font:900 .62rem ui-monospace,monospace;color:#7ef0bd}#sml-sig .sg .top time{margin-left:auto;color:#5d7085;font-size:.58rem}'
    + '#sml-sig .sg .nums{display:flex;gap:10px;margin:6px 0 4px;flex-wrap:wrap}#sml-sig .sg .nums span{color:#7f95a1}#sml-sig .sg .nums b{color:#eaf3f7}#sml-sig .sg .nums b.pt{color:#7ef0bd}#sml-sig .sg .nums b.stp{color:#ff9fb0}'
    + '#sml-sig .sg ul{list-style:none;margin:4px 0;padding:0}#sml-sig .sg li{padding-left:8px;border-left:2px solid #2c4a56;color:#b9c8d1;font-weight:500;margin:2px 0}'
    + '#sml-sig .sg .act{display:flex;gap:6px;margin-top:6px}#sml-sig .sg .act button{border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;padding:6px 9px;font:800 .62rem system-ui;cursor:pointer}#sml-sig .sg .act button.go{background:#00c47d;border-color:#7dffc4;color:#032318}'
    + '#sml-sig .foot{padding:6px 10px;border-top:1px solid #16382b;color:#5d7085;font-size:.55rem;font-weight:500}'
    + '#sml-sig-cards{position:fixed;left:12px;bottom:102px;z-index:2147483242;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 24px))}#sml-sig-cards .sg{border:1px solid #00c47d;border-radius:10px;background:rgba(7,19,14,.98);padding:9px 10px;box-shadow:0 12px 30px rgba(0,0,0,.6);color:#dfe9ee;font:600 .68rem/1.4 system-ui,sans-serif}#sml-sig-cards .sg .x{float:right;background:none;border:0;color:#7f95a1;cursor:pointer}'
    + '@media(max-width:720px){#sml-sig{left:8px;right:8px;width:auto;bottom:48px;max-height:70vh}#sml-sig-cards{width:calc(100vw - 16px);left:8px}}';
  document.head.appendChild(css);

  const S = { on: false, signals: [], tab: 'all', open: !!read(OPEN, false), seen: read(SEEN, []), since: Number(read(SINCE, 0)) || 0, fresh: new Set(), status: null, timer: 0 };
  let fab = null, panel = null, cards = null, ctxA = null;
  function chime() {
    try {
      ctxA = ctxA || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctxA.createOscillator(), g = ctxA.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(880, ctxA.currentTime); o.frequency.setValueAtTime(1175, ctxA.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, ctxA.currentTime); g.gain.exponentialRampToValueAtTime(0.08, ctxA.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctxA.currentTime + 0.35);
      o.connect(g).connect(ctxA.destination); o.start(); o.stop(ctxA.currentTime + 0.36);
    } catch (_) { /* audio may be blocked until the first tap */ }
  }
  const chart = (sym) => { if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(sym); };
  const alert = (sig) => { if (typeof window.smlClickAlertPrefill === 'function') window.smlClickAlertPrefill({ symbol: sig.symbol, target: sig.target, mode: 'auto' }); else chart(sig.symbol); };
  function sigHtml(sig, fresh) {
    return '<div class="sg' + (fresh ? ' fresh' : '') + '" data-id="' + esc(sig.id) + '"><div class="top"><strong data-sym="' + esc(sig.symbol) + '">' + esc(sig.symbol) + '</strong><span class="st ' + esc(sig.style) + '">' + esc(sig.label || sig.style).toUpperCase() + '</span><span class="gr">' + esc(sig.grade) + ' · ' + esc(sig.score) + '</span><time>' + ago(sig.at) + '</time></div>'
      + '<div class="nums"><span>Entry <b>$' + px(sig.entry) + '</b></span><span>PT <b class="pt">$' + px(sig.target) + ' (+' + esc(sig.pct) + '%)</b></span><span>Stop <b class="stp">$' + px(sig.stop) + '</b></span>' + (sig.relVolume ? '<span>Vol <b>' + Number(sig.relVolume).toFixed(1) + 'x</b></span>' : '') + (sig.changePct != null ? '<span>Today <b>' + (sig.changePct >= 0 ? '+' : '') + Number(sig.changePct).toFixed(1) + '%</b></span>' : '') + '</div>'
      + '<ul>' + (sig.why || []).slice(0, 4).map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>'
      + '<div class="act"><button type="button" class="go" data-a="alert">⚡ Click to Alert</button><button type="button" data-a="chart">Chart</button></div></div>';
  }
  function render() {
    if (!panel) return;
    panel.style.display = S.open ? '' : 'none';
    const list = S.signals.filter((s) => S.tab === 'all' || s.style === S.tab);
    panel.querySelector('.list').innerHTML = list.length ? list.map((s) => sigHtml(s, S.fresh.has(s.id))).join('') : '<div class="empty">No buy signals yet. The radar reads the market every minute during the session.</div>';
    panel.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const st = S.status; panel.querySelector('header small').textContent = st ? (st.universe ? st.universe + ' names · ' : '') + (st.styles && st.styles.length ? st.styles.join(' + ') : 'market closed') : '';
    if (fab) fab.textContent = 'SIGNALS · ' + S.signals.length;
  }
  function mount() {
    if (fab) return;
    fab = document.createElement('button'); fab.type = 'button'; fab.id = 'sml-sig-fab'; fab.textContent = 'SIGNALS'; fab.title = 'MEM ALGO buy signals across the market (owner)';
    fab.addEventListener('click', () => { S.open = !S.open; write(OPEN, S.open); S.fresh.clear(); fab.classList.remove('new'); if (cards) cards.innerHTML = ''; render(); });
    document.body.appendChild(fab);
    panel = document.createElement('aside'); panel.id = 'sml-sig';
    panel.innerHTML = '<header><b>🟢 BUY SIGNAL RADAR</b><small></small><button type="button" aria-label="Close">✕</button></header><div class="tabs"><button type="button" data-tab="all">ALL</button><button type="button" data-tab="day">DAY TRADES</button><button type="button" data-tab="swing">SWING</button></div><div class="list"></div><div class="foot">MEM ALGO buy signals, grade A/B, with a +10% (day) / +15% (swing) target from the signal price. Educational, not financial advice.</div>';
    panel.querySelector('header button').addEventListener('click', () => { S.open = false; write(OPEN, false); render(); });
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('button[data-tab]'); if (t) { S.tab = t.dataset.tab; render(); return; }
      const sym = e.target.closest('[data-sym]'); if (sym) { chart(sym.dataset.sym); return; }
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const el = b.closest('[data-id]'), sig = S.signals.find((s) => s.id === (el && el.dataset.id)); if (!sig) return;
      if (b.dataset.a === 'alert') alert(sig); else chart(sig.symbol);
    });
    document.body.appendChild(panel);
    cards = document.createElement('div'); cards.id = 'sml-sig-cards'; document.body.appendChild(cards);
    cards.addEventListener('click', (e) => {
      if (e.target.closest('.x')) { e.target.closest('.sg').remove(); return; }
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const el = b.closest('[data-id]'), sig = S.signals.find((s) => s.id === (el && el.dataset.id)); if (!sig) return;
      if (b.dataset.a === 'alert') alert(sig); else chart(sig.symbol); el.remove();
    });
    render();
  }
  function announce(fresh) {
    if (!cards) return;
    for (const sig of fresh.slice(-3)) { const w = document.createElement('div'); w.innerHTML = sigHtml(sig, true); const el = w.firstChild; const x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.textContent = '✕'; el.insertBefore(x, el.firstChild); cards.insertBefore(el, cards.firstChild); setTimeout(() => el.remove(), 45000); }
    while (cards.children.length > 3) cards.lastChild.remove();
    fab.classList.add('new'); chime();
    if ((document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted') {
      try { const s = fresh[fresh.length - 1]; const n = new Notification('🟢 BUY SIGNAL ' + s.symbol + ' · ' + (s.label || s.style), { body: 'Entry $' + px(s.entry) + ' → PT $' + px(s.target) + ' (+' + s.pct + '%). ' + (s.why && s.why[0] ? s.why[0] : ''), tag: 'sml-signal-' + s.id }); n.onclick = () => { try { window.focus(); } catch (_) { /* fine */ } alert(s); n.close(); }; } catch (_) { /* fine */ }
    }
  }
  async function poll() {
    const token = window.smlAcademySessionToken; if (!token || S.off) return;
    const url = '/academy-activity/signals?since=' + (S.since || (Date.now() - 24 * 3_600_000));
    try {
      let res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const t = await window.smlAcademyReauth(); if (t) res = await fetch(url, { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); }
      if (res.status === 403) { S.off = true; clearInterval(S.timer); if (fab) fab.remove(); if (panel) panel.remove(); if (cards) cards.remove(); return; } // not the owner: no panel at all
      if (!res.ok) return;
      const j = await res.json(); if (!j || !j.ok) return;
      mount();
      S.status = j.status || null;
      const have = new Map(S.signals.map((s) => [s.id, s]));
      for (const s of j.signals || []) have.set(s.id, s);
      S.signals = [...have.values()].sort((a, b) => b.at - a.at).slice(0, 120);
      const fresh = (j.signals || []).filter((s) => !S.seen.includes(s.id)).sort((a, b) => a.at - b.at);
      if (fresh.length) {
        S.seen = S.seen.concat(fresh.map((s) => s.id)).slice(-400); write(SEEN, S.seen);
        if (S.since) { fresh.forEach((s) => S.fresh.add(s.id)); announce(fresh); } // first load after a fresh start: no fanfare for old signals
      }
      S.since = Math.max(S.since, ...(j.signals || []).map((s) => s.at), S.since || Date.now() - 24 * 3_600_000); write(SINCE, S.since);
      render();
    } catch (_) { /* next poll */ }
  }
  const start = () => { if (S.timer) return; setTimeout(poll, 4000); S.timer = setInterval(poll, 30000); };
  window.addEventListener('sml-academy-session', start);
  if (window.smlAcademySessionToken) start();
  window.smlSignalRadar = { state: S, reload: poll };
})();
