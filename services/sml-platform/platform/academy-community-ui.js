/* The engagement layer, page side (server: academy-community.js). Four things, on phones and desktops alike:
   1. TRADERS TO FOLLOW: a strip of the week's most active traders (alerts, comments, followers) with one-tap Follow, at
      the top of Ticker Talk and of the Alerts desk's Traders tab. Follow does both follows (profile and Alert Chart).
   2. A FOLLOWING tab in Ticker Talk: one stream of what the traders a member follows said and posted, across every
      ticker; tap a comment to open it on its chart, tap an alert to open the trader's chart.
   3. Starter prompts when a ticker has no comments yet, and a "be the first to reply" nudge on quiet comments.
   4. The inbox: replies to your comments, new followers, targets smashed on charts you follow, as toasts with one tap
      (Open, Follow back), polled every minute and remembered so nothing shows twice. */
(() => {
  if (window.smlCommunity) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const css = document.createElement('style');
  css.textContent = '.cm-strip{display:flex;gap:6px;overflow-x:auto;padding:6px 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.cm-strip::-webkit-scrollbar{display:none}'
    + '.cm-card{flex:none;width:150px;padding:8px;border:1px solid #1b3540;border-radius:10px;background:#0b151d;color:#dbe6ec;font:500 .62rem/1.35 system-ui,sans-serif}.cm-card .top{display:flex;align-items:center;gap:6px}.cm-card .ava{width:26px;height:26px;border-radius:50%;background:#17303b;color:#7ef0bd;font:800 .66rem/26px system-ui;text-align:center;flex:none;object-fit:cover;cursor:pointer}.cm-card b{display:block;color:#fff;font-size:.68rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.cm-card small{display:block;color:#7f98a6;margin:3px 0 6px;min-height:2.6em}'
    + '.cm-card button{width:100%;border:1px solid #00c47d;border-radius:7px;background:#00c47d;color:#042217;font:800 .6rem ui-monospace,monospace;padding:5px 6px;cursor:pointer}.cm-card button.on{background:#123d31;border-color:#2d5a3f;color:#7dffc4}'
    + '.cm-head{display:flex;align-items:center;gap:6px;margin:2px 0 0}.cm-head h6{margin:0;font:800 .54rem ui-monospace,monospace;letter-spacing:.14em;color:#7ef0bd}.cm-head .sp{flex:1}.cm-head button{border:0;background:none;color:#6f8794;font:700 .56rem ui-monospace,monospace;cursor:pointer}'
    + '.cm-tabs{display:flex;gap:4px;margin:0 0 6px}.cm-tabs button{flex:1;padding:5px 6px;border:1px solid #1f3a46;border-radius:7px;background:#0b151d;color:#9fb3be;font:800 .6rem ui-monospace,monospace;cursor:pointer}.cm-tabs button.on{background:#1c3444;border-color:#6fb8e0;color:#fff}'
    + '.cm-item{margin:0 0 7px;padding:8px 9px;border:1px solid #17323d;border-radius:10px;background:#0a1118;cursor:pointer}.cm-item .m{display:flex;gap:7px;align-items:center;font:700 .6rem ui-monospace,monospace;color:#8fa6b3}.cm-item .m b{color:#fff}.cm-item .m .sym{color:#3ef0a8}.cm-item .m .k{padding:1px 6px;border-radius:999px;background:#16303a;color:#9fd3e8}.cm-item .m .k.alert{background:#2e2410;color:#ffcf7a}.cm-item .m .when{margin-left:auto;color:#6f8794}.cm-item p{margin:4px 0 0;color:#dbe6ec;font:500 .7rem/1.4 system-ui,sans-serif;white-space:pre-wrap;word-break:break-word}.cm-item .pct{font:800 .66rem ui-monospace,monospace}.cm-item .up{color:#52e6ad}.cm-item .dn{color:#ff778b}'
    + '.cm-empty{padding:12px;color:#7f98a6;text-align:center;border:1px dashed #1b3540;border-radius:10px;font:500 .66rem system-ui,sans-serif}'
    + '.cm-starters{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}.cm-starters button{border:1px solid #23495a;border-radius:999px;background:#0b1620;color:#b8c9d3;font:600 .62rem system-ui,sans-serif;padding:5px 9px;cursor:pointer}.cm-starters button:hover{border-color:#5fa8e0;color:#fff}'
    + '.cm-nudge{display:inline-block;margin-left:6px;color:#ffcf7a;font:700 .56rem ui-monospace,monospace}'
    + '#cm-toasts{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:2147483450;display:flex;flex-direction:column;gap:6px;width:min(94vw,440px);pointer-events:none}.cm-toast{pointer-events:auto;display:flex;gap:8px;align-items:center;padding:9px 11px;border-radius:10px;background:#0d1a24;border:1px solid #2b5362;color:#dbe6ec;font:600 .66rem/1.35 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.55)}.cm-toast b{color:#fff}.cm-toast button{flex:none;border:1px solid #00c47d;border-radius:7px;background:#00c47d;color:#042217;font:800 .58rem ui-monospace,monospace;padding:4px 8px;cursor:pointer}.cm-toast .x{border:0;background:none;color:#7f98a6;font-size:16px;padding:0 2px}'
    + '@media(max-width:720px){.cm-card{width:138px}#cm-toasts{bottom:96px}}';
  document.head.appendChild(css);

  async function api(path, method, body) {
    const t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    const go = (tok) => fetch('/academy-activity/community' + path, { method: method || 'GET', headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    try { let res = await go(t); if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const f = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (f) res = await go(f); } const j = await res.json().catch(() => null); return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' }); } catch (_) { return { ok: false, error: 'network' }; }
  }
  const openProfile = (id) => { if (window.smlAcademyProfile && window.smlAcademyProfile.open) void window.smlAcademyProfile.open(id); };
  const ago = (iso) => { const d = (Date.now() - Date.parse(iso)) / 60000; if (d < 1) return 'now'; if (d < 60) return Math.round(d) + 'm'; if (d < 36 * 60) return Math.round(d / 60) + 'h'; return Math.round(d / 1440) + 'd'; };
  const pct = (v) => (v == null || !Number.isFinite(v) ? '' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
  function avatarInto(el, id) { if (typeof window.smlAcademyAvatar !== 'function' || !token()) return; window.smlAcademyAvatar(id).then((url) => { if (!url || !el.isConnected) return; const img = document.createElement('img'); img.className = 'ava'; img.alt = ''; img.src = url; img.dataset.uid = id; img.setAttribute('data-cm', 'profile'); img.dataset.user = id; el.replaceWith(img); }); }

  /* ---- 1. traders to follow ---- */
  const followed = new Set();
  async function strip(host, { title = 'TRADERS TO FOLLOW', limit = 8 } = {}) {
    if (!host || !token()) return;
    const key = 'cm-strip-hidden'; let hidden = false; try { hidden = sessionStorage.getItem(key) === '1'; } catch (_) {}
    const r = await api('/suggest?limit=' + limit);
    if (!r.ok || !r.traders || !r.traders.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="cm-head"><h6>' + esc(title) + '</h6><span class="sp"></span><button type="button" data-cm="toggle">' + (hidden ? 'show' : 'hide') + '</button></div>' + (hidden ? '' : '<div class="cm-strip">' + r.traders.map((t) => '<div class="cm-card" data-id="' + esc(t.id) + '"><div class="top"><span class="ava" data-cm="profile" data-user="' + esc(t.id) + '">' + esc(String(t.name || 'T').slice(0, 1).toUpperCase()) + '</span><b data-cm="profile" data-user="' + esc(t.id) + '">' + esc(t.name) + '</b></div><small>' + esc(t.reason) + '</small><button type="button" data-cm="follow" data-user="' + esc(t.id) + '"' + (followed.has(t.id) ? ' class="on"' : '') + '>' + (followed.has(t.id) ? '✓ Following' : '+ Follow') + '</button></div>').join('') + '</div>');
    host.querySelectorAll('.cm-card .ava').forEach((el) => avatarInto(el, el.dataset.user));
    if (!host.__cmBound) { host.__cmBound = true; host.addEventListener('click', async (e) => {
      const b = e.target.closest ? e.target.closest('[data-cm]') : null; if (!b) return;
      if (b.dataset.cm === 'toggle') { try { sessionStorage.setItem(key, hidden ? '0' : '1'); } catch (_) {} strip(host, { title, limit }); return; }
      if (b.dataset.cm === 'profile') { openProfile(b.dataset.user); return; }
      if (b.dataset.cm === 'follow') {
        const on = !followed.has(b.dataset.user); b.disabled = true;
        const r2 = await api('/follow', 'POST', { user: b.dataset.user, on }); b.disabled = false;
        if (!r2.ok) { toastText('Could not follow right now.'); return; }
        if (on) followed.add(b.dataset.user); else followed.delete(b.dataset.user);
        b.classList.toggle('on', on); b.textContent = on ? '✓ Following' : '+ Follow';
        if (on) toastText('Following. Their comments and alerts now show in your Following feed.');
      }
    }); }
  }

  /* ---- 2. the Following stream ---- */
  async function followingInto(host) {
    if (!host || !token()) return;
    host.innerHTML = '<div class="cm-empty">Loading…</div>';
    const r = await api('/following?limit=40');
    if (!r.ok) { host.innerHTML = '<div class="cm-empty">Could not load (' + esc(r.error || 'error') + ').</div>'; return; }
    if (!r.following) { host.innerHTML = '<div class="cm-empty">You are not following anyone yet. Follow a trader above and their comments and alerts land here.</div>'; return; }
    if (!r.items.length) { host.innerHTML = '<div class="cm-empty">The ' + r.following + ' trader' + (r.following === 1 ? '' : 's') + ' you follow have not posted lately.</div>'; return; }
    host.innerHTML = r.items.map((it) => it.kind === 'comment'
      ? '<div class="cm-item" data-cm="open-comment" data-sym="' + esc(it.symbol) + '" data-id="' + esc(it.id) + '"><div class="m"><b data-cm="profile" data-user="' + esc(it.authorId) + '">' + esc(it.authorName || 'trader') + '</b><span class="k">' + (it.parentId ? 'reply' : 'comment') + '</span><span class="sym">$' + esc(it.symbol) + '</span>' + (it.replyCount ? '<span>' + it.replyCount + ' repl' + (it.replyCount === 1 ? 'y' : 'ies') + '</span>' : '') + '<span class="when">' + esc(ago(it.at)) + '</span></div><p>' + esc(it.body) + (it.images ? ' 🖼' : '') + '</p></div>'
      : '<div class="cm-item" data-cm="open-chart" data-user="' + esc(it.authorId) + '"><div class="m"><b data-cm="profile" data-user="' + esc(it.authorId) + '">' + esc(it.authorName || 'trader') + '</b><span class="k alert">' + (it.lastUpdate ? ({ pt_hit: 'PT SMASHED', sell: 'SELL', close: 'CLOSED', update: 'UPDATE' }[it.lastUpdate.kind] || 'ALERT') : 'ALERT') + '</span>' + (it.locked ? '<span class="sym">🔒 premium</span>' : '<span class="sym">$' + esc(it.symbol) + '</span><span>' + (it.side === 'short' ? 'short' : 'long') + '</span>') + (it.metrics && it.metrics.peakPct != null ? '<span class="pct ' + (it.metrics.peakPct > 0 ? 'up' : 'dn') + '">peak ' + pct(it.metrics.peakPct) + '</span>' : '') + '<span class="when">' + esc(ago(it.at)) + '</span></div>' + (it.lastUpdate && it.lastUpdate.body ? '<p>' + esc(it.lastUpdate.body) + '</p>' : '') + '</div>').join('');
    if (!host.__cmBound) { host.__cmBound = true; host.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-cm]') : null; if (!b) return;
      if (b.dataset.cm === 'profile') { e.stopPropagation(); openProfile(b.dataset.user); return; }
      if (b.dataset.cm === 'open-comment') { if (window.smlTickerTalk && window.smlTickerTalk.openComment) void window.smlTickerTalk.openComment(b.dataset.sym, b.dataset.id); return; }
      if (b.dataset.cm === 'open-chart') openProfile(b.dataset.user);
    }); }
  }

  /* ---- 3. starters and nudges ---- */
  const STARTERS = (sym) => ['What is your read on $' + sym + ' into the close?', 'Where is the level that matters on $' + sym + ' today?', 'Anyone holding $' + sym + ' overnight? Why or why not?', 'What would make you flip your bias on $' + sym + '?'];
  function startersHtml(sym) { return '<div class="cm-starters">' + STARTERS(sym).map((s) => '<button type="button" data-cm-starter="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>'; }

  /* ---- 4. the inbox ---- */
  let toasts = null;
  function toastEl() { if (!toasts) { toasts = document.createElement('div'); toasts.id = 'cm-toasts'; document.body.appendChild(toasts); } return toasts; }
  function toastText(text) { showToast('<span>' + esc(text) + '</span>', null); }
  function showToast(html, action) {
    const t = document.createElement('div'); t.className = 'cm-toast'; t.innerHTML = html + (action ? '<button type="button" data-act="1">' + esc(action.label) + '</button>' : '') + '<button type="button" class="x" data-x="1" aria-label="Dismiss">×</button>';
    t.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) { t.remove(); return; } if (e.target.closest('[data-act]') && action) { action.run(); t.remove(); } });
    toastEl().appendChild(t); while (toastEl().children.length > 3) toastEl().firstChild.remove();
    setTimeout(() => { if (t.isConnected) t.remove(); }, action ? 14000 : 5000);
  }
  const SEEN_KEY = 'sml-cm-inbox-since';
  let polling = false;
  async function pollInbox() {
    if (polling || !token() || document.hidden) return; polling = true;
    let since = ''; try { since = localStorage.getItem(SEEN_KEY) || ''; } catch (_) {}
    const r = await api('/inbox' + (since ? '?since=' + encodeURIComponent(since) : ''));
    polling = false;
    if (!r.ok) return;
    try { localStorage.setItem(SEEN_KEY, new Date(r.asOf || Date.now()).toISOString()); } catch (_) {}
    if (!since) return; /* the first look only marks the moment; nothing from before counts as news */
    for (const ev of (r.events || []).slice(0, 3)) {
      const who = '<b>' + esc(ev.fromName || 'A trader') + '</b>';
      if (ev.kind === 'reply') showToast(who + ' replied to your $' + esc(ev.symbol) + ' comment: <i>' + esc(ev.body) + '</i>', { label: 'Open', run: () => { if (window.smlTickerTalk && window.smlTickerTalk.openComment) void window.smlTickerTalk.openComment(ev.symbol, ev.rootId); } });
      else if (ev.kind === 'follow') showToast(who + ' started following you.', { label: 'Follow back', run: async () => { const x = await api('/follow', 'POST', { user: ev.from, on: true }); toastText(x.ok ? 'Following back.' : 'Could not follow right now.'); } });
      else if (ev.kind === 'pt_hit') showToast(who + ' smashed a target on $' + esc(ev.symbol) + (ev.pct != null ? ' (peak ' + esc(pct(ev.pct)) + ')' : '') + '.', { label: 'Open chart', run: () => openProfile(ev.from) });
      else if (ev.kind === 'closed') showToast(who + ' closed the $' + esc(ev.symbol) + ' alert.', { label: 'Open chart', run: () => openProfile(ev.from) });
      else if (ev.kind === 'alert') showToast(who + ' posted a new ' + esc(ev.side || '') + ' alert on $' + esc(ev.symbol) + '.', { label: 'Open chart', run: () => openProfile(ev.from) });
    }
  }
  setInterval(pollInbox, 60_000);
  window.addEventListener('sml-academy-session', () => setTimeout(pollInbox, 2500));
  if (token()) setTimeout(pollInbox, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollInbox(); });

  window.smlCommunity = { strip, following: followingInto, startersHtml, toast: toastText, api, followed };
})();
