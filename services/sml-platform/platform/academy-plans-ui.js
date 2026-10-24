/* "Pick a plan": the one place in the Activity where a member chooses what to buy.
 *
 * Until now there was no choice at all. The gate client's Get Academy access button called
 * startPurchase({sku_id: skus[0]}) - whichever SKU happened to be first - and the trial countdown's
 * single button threw the member out to a browser. This panel replaces both decisions with a list.
 *
 * WHERE THE PLANS COME FROM. Discord, not us: sdk.commands.getSkus() returns the live SKUs with
 * their names and prices, so what the member reads is what Discord will charge. window.SML_ACADEMY_GATE
 * .skuLevels only says which id is Trader and which is Analyst, because Discord does not know our
 * tiers. A price typed into this file would drift the day a SKU price changes, which is exactly the
 * trap the seats panel already avoids by reading its price back from Stripe.
 *
 * THREE THINGS A MEMBER CAN DO HERE:
 *   Trader   - buy it for themselves, in Discord, no browser trip
 *   Analyst  - the same, plus the publishing side
 *   Seats    - they run their own server and would rather cover their members: hands off to
 *              academy-seats-ui.js, which is a different purchase (Stripe, per seat, bought by an
 *              owner FOR other people). It is listed because a server owner looking at a trial
 *              ending is exactly the person who buys seats, but it is kept visually apart so nobody
 *              mistakes it for a cheaper way to buy their own access - it is the same $49.99.
 *
 * Access is never decided here. A finished purchase just calls window.smlAcademyOnEntitlement(),
 * which renews the session and lets the server re-read the tier from the entitlement.
 *
 * Outside Discord, or with no SKUs configured, the panel falls back to the external checkout link
 * the caller passes in, so the trial card never ends up with a dead button.
 *
 * NOTHING TOUCHES document.body AT LOAD. This ships with the gate script, which is the first script
 * in <head>, so at that moment document.body is null. The elements are built here but only attached
 * on the first open().
 */
(() => {
  if (window.smlAcademyPlans) return;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cfg = () => window.SML_ACADEMY_GATE || {};
  const sdk = () => window.smlAcademySdk;
  const S = { open: false, loaded: false, plans: null, busy: '', msg: '', fallbackUrl: '' };

  /* what each tier is for, in the member's words rather than ours */
  const COPY = {
    trader: { name: 'Trader', blurb: 'The chart, every desk, the scanner, Level&nbsp;2, options, the alerts and the rooms. Everything that reads the market.' },
    analyst: { name: 'Analyst', blurb: 'Everything in Trader, plus the publishing side: your own trading room, Click-to-Alert into your server, the Article Desk, and charging for your alert channels.' }
  };

  let mounted = false;
  const css = document.createElement('style');
  css.textContent = '#academy-plans{position:fixed;inset:0;z-index:2147483400;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(3,8,11,.72)}#academy-plans.open{display:flex}'
    + '#academy-plans .box{width:min(520px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:#0a1118;border:1px solid #1f6a52;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.7);color:#dbe6ec;font:500 .72rem/1.5 system-ui,sans-serif}'
    + '#academy-plans header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #163a30}#academy-plans header b{font:900 .74rem ui-monospace,monospace;letter-spacing:.07em;color:#7fe8c0}#academy-plans header button{margin-left:auto;border:0;background:transparent;color:#8fa6b3;font-size:1rem;cursor:pointer;padding:0 4px}'
    + '#academy-plans .lead{padding:11px 14px 2px;color:#9fb6c2}'
    + '#academy-plans ul{list-style:none;margin:0;padding:10px 14px;display:grid;gap:9px}'
    + '#academy-plans li{border:1px solid #1f2f3c;border-radius:11px;background:#0d1620;padding:11px 12px}#academy-plans li.pick{border-color:#1f6a52;background:#0b1c17}'
    + '#academy-plans .top{display:flex;align-items:baseline;gap:8px}#academy-plans .top b{font:900 .78rem ui-monospace,monospace;letter-spacing:.05em;color:#eafff6}#academy-plans .top i{font-style:normal;margin-left:auto;font:900 .82rem ui-monospace,monospace;color:#7fe8c0;white-space:nowrap}#academy-plans .top i small{color:#6f9c8c;font-weight:600;font-size:.62rem}'
    + '#academy-plans p{margin:5px 0 9px;color:#9fb6c2}'
    + '#academy-plans button.go{width:100%;border:1px solid #1f6a52;border-radius:8px;background:#0c241d;color:#7fe8c0;font:800 .68rem ui-monospace,monospace;letter-spacing:.05em;padding:9px;cursor:pointer}#academy-plans button.go:disabled{opacity:.55;cursor:default}#academy-plans li.pick button.go{background:#00c47d;border-color:#6ff3c2;color:#042217}'
    + '#academy-plans .team{margin:2px 14px 12px;padding:11px 12px;border:1px dashed #2b4a58;border-radius:11px;background:#0a141b}#academy-plans .team b{display:block;font:900 .68rem ui-monospace,monospace;letter-spacing:.05em;color:#cfe3ec;margin-bottom:3px}#academy-plans .team p{margin:0 0 8px}#academy-plans .team button{border:1px solid #2b4a58;border-radius:8px;background:#0d1a24;color:#cfe3ec;font:800 .64rem ui-monospace,monospace;padding:7px 11px;cursor:pointer}'
    + '#academy-plans .msg{padding:0 14px 10px;color:#ffd166;font-weight:600}#academy-plans .note{padding:0 14px 13px;color:#5f7a71;font-size:.6rem}'
    + '@media(max-width:560px){#academy-plans .box{max-height:calc(100dvh - 20px)}}';
  const wrap = document.createElement('div');
  wrap.id = 'academy-plans';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Choose a plan');
  /* the chart owns pointer and key events; the panel must keep its own */
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => wrap.addEventListener(ev, (e) => e.stopPropagation()));

  function mount() {
    if (mounted || !document.body) return mounted;
    mounted = true;
    (document.head || document.documentElement).appendChild(css);
    document.body.appendChild(wrap);
    return true;
  }

  const money = (p) => {
    const amount = Number(p && p.amount);
    if (!Number.isFinite(amount)) return '';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String((p && p.currency) || 'usd').toUpperCase() }).format(amount / 100); }
    catch (_) { return '$' + (amount / 100).toFixed(2); }
  };

  /* Ask Discord what it sells. Falls back to the configured ids with no price rather than showing
     nothing, because a member with a trial ending needs a way through even if getSkus is unavailable. */
  async function loadPlans() {
    if (S.loaded) return S.plans;
    S.loaded = true;
    const levels = (cfg() && cfg().skuLevels) || {};
    const ids = Object.keys(levels);
    if (!ids.length) { S.plans = []; return S.plans; }
    let live = [];
    try {
      const s = sdk();
      if (s && s.commands && typeof s.commands.getSkus === 'function') {
        const r = await s.commands.getSkus();
        live = (r && Array.isArray(r.skus) ? r.skus : []);
      }
    } catch (_) { /* no SDK, or Discord refused: fall through to the ids we were given */ }
    const byId = new Map(live.map((s) => [String(s.id), s]));
    S.plans = ids.map((id) => {
      const level = String(levels[id] || '').toLowerCase();
      const copy = COPY[level] || { name: level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Academy access', blurb: '' };
      const found = byId.get(String(id));
      return { id: String(id), level, name: (found && found.name) || copy.name, blurb: copy.blurb, price: found ? money(found.price) : '' };
    }).sort((a, b) => (a.level === 'trader' ? -1 : b.level === 'trader' ? 1 : 0));
    return S.plans;
  }

  async function buy(id) {
    const s = sdk();
    if (!s || !s.commands || typeof s.commands.startPurchase !== 'function') {
      S.msg = 'Purchases are only available inside Discord. Use the link below instead.';
      paint(); return;
    }
    S.busy = id; S.msg = ''; paint();
    try {
      await s.commands.startPurchase({ sku_id: id });
      /* access is decided server-side from the entitlement; this just makes the page notice */
      try { if (typeof window.smlAcademyOnEntitlement === 'function') window.smlAcademyOnEntitlement(); } catch (_) { /* ignore */ }
      S.msg = 'Thanks. Your access updates as soon as Discord confirms the purchase.';
    } catch (_) {
      S.msg = 'That purchase did not go through. Nothing was charged.';
    }
    S.busy = ''; paint();
  }

  const openOut = (url) => {
    if (!url) return;
    if (typeof window.smlAcademyOpenExternal === 'function') { void window.smlAcademyOpenExternal(url); return; }
    try { window.open(url, '_blank', 'noopener'); } catch (_) { /* blocked */ }
  };

  function paint() {
    const plans = S.plans || [];
    let html = '<div class="box"><header><b>KEEP YOUR ACCESS</b><button type="button" data-x="1" aria-label="Close">✕</button></header>'
      + '<p class="lead">Pick what fits. Both are billed monthly through Discord and you can stop them whenever you like.</p>';

    if (plans.length) {
      html += '<ul>' + plans.map((p) => '<li class="' + (p.level === 'trader' ? 'pick' : '') + '">'
        + '<div class="top"><b>' + esc(p.name) + '</b>' + (p.price ? '<i>' + esc(p.price) + ' <small>/month</small></i>' : '') + '</div>'
        + (p.blurb ? '<p>' + p.blurb + '</p>' : '')
        + '<button type="button" class="go" data-buy="' + esc(p.id) + '"' + (S.busy ? ' disabled' : '') + '>'
        + (S.busy === p.id ? 'OPENING…' : 'GET ' + esc(p.name.toUpperCase())) + '</button></li>').join('') + '</ul>';
    } else {
      html += '<ul><li><div class="top"><b>Academy access</b></div><p>Open checkout in your browser to pick a plan.</p>'
        + '<button type="button" class="go" data-out="1">OPEN CHECKOUT</button></li></ul>';
    }

    /* a different purchase, for a different person: kept apart so it is never read as a cheaper
       way to buy your own access */
    if (window.smlAcademySeats) {
      html += '<div class="team"><b>RUN YOUR OWN SERVER?</b>'
        + '<p>Cover the members you choose instead of asking them to pay. Seats are bought by the seat, monthly, and you decide who sits in each one.</p>'
        + '<button type="button" data-seats="1">TEAM SEATS →</button></div>';
    }

    if (S.msg) html += '<p class="msg">' + esc(S.msg) + '</p>';
    if (plans.length && S.fallbackUrl) html += '<p class="note">Trouble buying in Discord? <button type="button" data-out="1" style="border:0;background:transparent;color:#7dd3ff;font:inherit;text-decoration:underline;cursor:pointer;padding:0">Open checkout in your browser</button> instead.</p>';
    html += '</div>';
    wrap.innerHTML = html;
    wrap.classList.toggle('open', S.open);
  }

  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) { S.open = false; paint(); return; }
    const t = e.target && e.target.closest ? e.target.closest('[data-x],[data-buy],[data-out],[data-seats]') : null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.dataset.x) { S.open = false; S.msg = ''; paint(); return; }
    if (t.dataset.out) { openOut(S.fallbackUrl); return; }
    if (t.dataset.seats) { S.open = false; paint(); try { window.smlAcademySeats.open(); } catch (_) { /* ignore */ } return; }
    if (t.dataset.buy) void buy(t.dataset.buy);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) { S.open = false; paint(); } });

  window.smlAcademyPlans = {
    /* `fallbackUrl` is the caller's external checkout link, used when Discord cannot sell */
    async open(fallbackUrl) {
      if (!mount()) return;
      S.fallbackUrl = String(fallbackUrl || S.fallbackUrl || '');
      S.open = true; S.msg = '';
      paint();
      await loadPlans();
      paint();
    },
    close() { S.open = false; paint(); },
    /* true when there is something to show beyond the plain external link */
    available: () => Boolean((cfg() && cfg().skuLevels && Object.keys(cfg().skuLevels).length) || window.smlAcademySeats)
  };
})();
