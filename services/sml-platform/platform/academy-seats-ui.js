/* Team seats: the SEATS button on the Academy toolbar and its card.
 *
 * A Discord server owner buys seats by the month — one price per seat — and hands them to the
 * members they pick. A seat grants the Trader edition: the chart, the desks, the alerts and the
 * rooms, everything that reads the market. It does NOT grant Analyst (publishing, Click-to-Alert
 * into your own server, the Article Desk, charging for your alert channels), so the people you seat
 * still have a reason to buy Analyst themselves.
 *
 * Buying and changing the seat count are Stripe's job: /seats/checkout opens Checkout, /seats/portal
 * opens the billing portal, where changing the quantity IS changing the seat count (Stripe prorates
 * it). Assigning and releasing are ours: /academy-activity/seats.
 *
 * The card only appears once there is something to see — a live subscription, or the owner opening
 * it from the edition card's "Team seats" line — so a member who will never buy seats is not shown a
 * button for them.
 *
 * Stripe cannot run inside Discord's Activity iframe, so every Stripe URL goes out through
 * window.smlAcademyOpenExternal (the Activity's "open in browser"), never window.location.
 */
(function boot(tries) {
  if (window.__smlSeatsUi) return;
  if (!document.querySelector('.toolbar')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlSeatsUi = true;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ID = /^\d{15,25}$/;
  const S = { open: false, busy: false, msg: '', data: null, loaded: '', want: 5 };

  const css = document.createElement('style');
  css.textContent = '#seats-btn{margin-left:4px;padding:5px 9px;border:1px solid #1f6a52;border-radius:7px;background:#08201a;color:#7fe8c0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer;display:none}#seats-btn.on{display:inline-block}#seats-btn b{color:#fff}'
    + '#seats-card{position:fixed;right:12px;top:58px;z-index:2147483300;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;background:#07120f;border:1px solid #1f6a52;border-radius:12px;color:#dbe6ec;font:600 .68rem/1.45 system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.6);display:none}'
    + '#seats-card header{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #163a30}#seats-card header b{font:800 .7rem ui-monospace,monospace;letter-spacing:.06em;color:#7fe8c0}#seats-card header span{margin-left:auto;cursor:pointer;color:#8fa6b3;padding:0 4px}'
    + '#seats-card .meter{display:flex;align-items:baseline;gap:6px;padding:10px 11px 2px}#seats-card .meter i{font:800 1.5rem/1 ui-monospace,monospace;font-style:normal;color:#eafff6}#seats-card .meter small{color:#8fa6b3;font-weight:600}'
    + '#seats-card .bar{margin:6px 11px 0;height:6px;border-radius:999px;background:#0e241e;overflow:hidden}#seats-card .bar i{display:block;height:100%;background:#00d090}'
    + '#seats-card h6{margin:0;padding:11px 11px 4px;font:800 .6rem ui-monospace,monospace;letter-spacing:.08em;color:#6f9c8c}'
    + '#seats-card ul{list-style:none;margin:0;padding:0 11px}#seats-card li{display:flex;align-items:center;gap:8px;margin:0 0 6px;padding:6px 8px;border-radius:9px;background:#0b1a16;border:1px solid #16302a}#seats-card li b{color:#e6eef2;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#seats-card li small{color:#7f968d;font-weight:500}#seats-card li .sp{margin-left:auto}'
    + '#seats-card li button{border:1px solid #4a2630;border-radius:7px;background:#210e13;color:#ff9aab;font:800 .6rem ui-monospace,monospace;padding:4px 7px;cursor:pointer}'
    + '#seats-card .add{display:flex;gap:6px;padding:4px 11px 0}#seats-card input{flex:1;min-width:0;box-sizing:border-box;padding:7px 8px;border:1px solid #1d3b33;border-radius:8px;background:#081310;color:#e6eef2;font:600 .66rem ui-monospace,monospace}'
    + '#seats-card .add button,#seats-card .row button,#seats-card .row a{border:1px solid #1f6a52;border-radius:8px;background:#0c241d;color:#7fe8c0;font:800 .62rem ui-monospace,monospace;letter-spacing:.05em;padding:7px 10px;cursor:pointer;text-align:center;text-decoration:none}'
    + '#seats-card .row{display:flex;gap:6px;padding:10px 11px}#seats-card .row button{flex:1}#seats-card .row button.ghost{border-color:#24423a;color:#9fc3b7;background:#0a1714}'
    + '#seats-card .qty{display:flex;align-items:center;gap:6px;padding:4px 11px 0}#seats-card .qty input{flex:0 0 72px;text-align:center}#seats-card .qty small{color:#8fa6b3;font-weight:600}'
    + '#seats-card .msg{padding:0 11px 8px;color:#ffd166;font-weight:600}#seats-card .note{padding:0 11px 11px;color:#5f7a71;font-weight:500;font-size:.57rem}#seats-card .note b{color:#8fb3a7}'
    + '#seats-card .empty{padding:2px 11px 8px;color:#7f968d;font-weight:500}'
    + '@media(max-width:700px){#seats-card{right:6px;left:6px;width:auto;top:auto;bottom:60px;max-height:72vh}}';
  document.head.appendChild(css);

  const toolbar = document.querySelector('.toolbar');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'seats-btn';
  btn.title = 'Team seats: buy Academy seats by the month and give them to the members you choose';
  toolbar.appendChild(btn);
  const card = document.createElement('aside');
  card.id = 'seats-card'; card.setAttribute('aria-label', 'Team seats');
  document.body.appendChild(card);
  /* the chart owns pointer and key events; the card must keep its own */
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => card.addEventListener(ev, (e) => e.stopPropagation()));

  const token = () => window.smlAcademySessionToken || '';
  async function api(path, method, body) {
    const t = token(); if (!t) return { ok: false, error: 'no_session' };
    const go = (tok) => fetch('/academy-activity/' + path, {
      method: method || 'GET',
      headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    try {
      let res = await go(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') {
        const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => '');
        if (fresh) res = await go(fresh);
      }
      return (await res.json().catch(() => null)) || { ok: false, error: 'bad_answer', status: res.status };
    } catch (_) { return { ok: false, error: 'no_connection' }; }
  }

  const openOut = (url) => {
    if (typeof window.smlAcademyOpenExternal === 'function') { void window.smlAcademyOpenExternal(url); return; }
    try { window.open(url, '_blank', 'noopener'); } catch (_) { S.msg = 'Open this to finish: ' + url; paint(); }
  };

  async function load(force) {
    const t = token(); if (!t || (!force && S.loaded === t)) return;
    const r = await api('seats');
    if (r && r.ok) { S.loaded = t; S.data = r; if (r.seats > 0) S.want = r.seats; }
    reflect();
    if (S.open) paint();
  }
  /* the button shows itself once the member has seats; otherwise the edition card opens this */
  function reflect() {
    const d = S.data;
    const live = !!(d && d.live);
    btn.classList.toggle('on', live || S.open);
    btn.innerHTML = live ? 'SEATS <b>' + d.used + '/' + d.seats + '</b>' : 'SEATS';
  }

  const when = (iso) => {
    const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
    const days = Math.round((t - Date.now()) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  };

  function paint() {
    const d = S.data;
    const live = !!(d && d.live);
    const used = (d && d.used) || 0, total = (d && d.seats) || 0;
    const free = Math.max(0, total - used);
    let html = '<header><b>TEAM SEATS</b><span data-x="1" role="button" aria-label="Close">✕</span></header>';

    if (live) {
      html += '<div class="meter"><i>' + used + '/' + total + '</i><small>seats in use' + (free ? ' · ' + free + ' free' : ' · full') + '</small></div>'
        + '<div class="bar"><i style="width:' + (total ? Math.round((used / total) * 100) : 0) + '%"></i></div>'
        + '<h6>WHO HAS A SEAT</h6>';
      html += d.members.length
        ? '<ul>' + d.members.map((m) => '<li><b>' + esc(m.name || m.memberId) + '</b>'
          + (m.name ? '<small>' + esc(m.memberId) + '</small>' : '')
          + '<span class="sp"></span><button data-drop="' + esc(m.memberId) + '">REMOVE</button></li>').join('') + '</ul>'
        : '<p class="empty">Nobody yet. Paste a member\'s Discord user id below — in Discord, right-click them and Copy User ID.</p>';
      if (free) {
        html += '<div class="add"><input data-member placeholder="Discord user id" inputmode="numeric" autocomplete="off"><button data-assign="1">GIVE A SEAT</button></div>';
      } else {
        html += '<p class="empty">Every seat is taken. Remove someone, or add seats in Manage billing.</p>';
      }
      html += '<h6>BILLING</h6>'
        + '<p class="empty">Renews ' + esc(when(d.periodEnd) || 'monthly') + '. Changing the seat count is the quantity on your subscription, so Stripe charges the difference straight away.</p>'
        + '<div class="row"><button data-portal="1">MANAGE BILLING</button><button class="ghost" data-resync="1">REFRESH FROM STRIPE</button></div>';
    } else {
      html += '<h6>WHAT A SEAT IS</h6>'
        + '<p class="empty">One seat is one member, for a month. They get the <b>Trader</b> edition: the chart, every desk, the scanner, the alerts and the rooms — everything that reads the market. Seats do not include the Analyst side (publishing, Click-to-Alert into your own server, the Article Desk, charging for your alerts), so your people can still buy that themselves.</p>'
        + '<h6>HOW MANY</h6>'
        + '<div class="qty"><input data-want type="number" min="1" max="200" value="' + esc(S.want) + '"><small>seats, billed monthly. You can change this later; Stripe prorates it.</small></div>'
        + '<div class="row"><button data-buy="1">BUY SEATS</button></div>'
        + '<p class="note">You pick who sits in them after you pay, and you can move a seat to someone else at any time. Payment is taken by Stripe in your browser, not in Discord.</p>';
    }
    if (S.msg) html += '<p class="msg">' + esc(S.msg) + '</p>';
    if (S.busy) html += '<p class="empty">Working…</p>';
    card.innerHTML = html;
    card.style.display = S.open ? 'block' : 'none';
    reflect();
  }

  async function act(fn) {
    if (S.busy) return;
    S.busy = true; S.msg = ''; paint();
    try { await fn(); } finally { S.busy = false; paint(); }
  }

  const problem = (r, fallback) => {
    const map = {
      seats_billing_unconfigured: 'Seats are not on sale yet.',
      already_subscribed: 'You already have seats — use Manage billing to change how many.',
      no_seats_free: 'Every seat is taken. Remove someone, or add seats in Manage billing.',
      no_active_subscription: 'There is no live seat subscription on this account.',
      no_subscription: 'Nothing to manage yet — buy seats first.',
      invalid_member: 'That is not a Discord user id. Right-click the member in Discord and Copy User ID.',
      invalid_seats: 'Pick between 1 and 200 seats.',
      no_session: 'Sign in to the Academy first.',
      no_connection: 'No connection. Try again.'
    };
    return map[r && (r.error || r.code)] || fallback;
  };

  card.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-x],[data-buy],[data-portal],[data-resync],[data-assign],[data-drop]') : null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.x) { S.open = false; S.msg = ''; paint(); return; }

    if (t.dataset.buy) {
      const input = card.querySelector('[data-want]');
      const n = Math.round(Number(input && input.value));
      if (!Number.isFinite(n) || n < 1 || n > 200) { S.msg = 'Pick between 1 and 200 seats.'; paint(); return; }
      S.want = n;
      void act(async () => {
        const r = await api('seats/checkout', 'POST', { seats: n });
        if (r && r.ok && r.url) { openOut(r.url); S.msg = 'Stripe is open in your browser. This card updates when the payment lands.'; await load(true); }
        else S.msg = problem(r, 'Could not start the payment.');
      });
      return;
    }
    if (t.dataset.portal) {
      void act(async () => {
        const r = await api('seats/portal', 'POST', {});
        if (r && r.ok && r.url) { openOut(r.url); S.msg = 'Your billing page is open in the browser.'; }
        else S.msg = problem(r, 'Could not open billing.');
      });
      return;
    }
    if (t.dataset.resync) {
      void act(async () => {
        const r = await api('seats/resync', 'POST', {});
        if (r && r.ok) { S.data = r; S.msg = 'Up to date with Stripe.'; }
        else S.msg = problem(r, 'Could not read Stripe.');
      });
      return;
    }
    if (t.dataset.assign) {
      const input = card.querySelector('[data-member]');
      const id = String((input && input.value) || '').trim();
      if (!ID.test(id)) { S.msg = 'Paste the member\'s Discord user id (right-click them in Discord, Copy User ID).'; paint(); return; }
      void act(async () => {
        const r = await api('seats', 'POST', { action: 'assign', memberId: id });
        if (r && r.ok) { S.data = r; S.msg = r.already ? 'They already have a seat.' : 'Seat given. They have Trader access now.'; }
        else S.msg = problem(r, 'Could not give the seat.');
      });
      return;
    }
    if (t.dataset.drop) {
      const id = t.dataset.drop;
      void act(async () => {
        const r = await api('seats', 'POST', { action: 'release', memberId: id });
        if (r && r.ok) { S.data = r; S.msg = 'Seat freed. Their access stops now.'; }
        else S.msg = problem(r, 'Could not free the seat.');
      });
    }
  });

  btn.addEventListener('click', () => { S.open = !S.open; S.msg = ''; paint(); if (S.open) void load(true); });
  /* the edition card's "Team seats" line, and anything else, can open this */
  window.smlAcademySeats = {
    open() { S.open = true; S.msg = ''; paint(); void load(true); },
    refresh: () => load(true),
    held: () => (S.data && S.data.live ? { seats: S.data.seats, used: S.data.used } : null)
  };

  void load(false);
  /* the session arrives after the page does */
  let waits = 0;
  const waitForSession = setInterval(() => { if (token() || ++waits > 40) { clearInterval(waitForSession); void load(false); } }, 500);
  /* coming back from Stripe in the browser: re-read, the webhook has usually landed by now */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loaded) void load(true); });
})(0);
