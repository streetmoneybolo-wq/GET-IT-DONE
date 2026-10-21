/* TRADING ROOM, the page side (server: academy-trading-room.js). A trader's profile is the front door; the room is behind it:
   a small Discord server inside the Academy, easier to use. Left: the channels in groups, with a lock on the ones you have not
   unlocked. Middle: the channel (a chat, notes, announcements, or the trader's alerts). Right: what the room is and what your
   membership is. Free members follow the trader (the everyone role); paid members hold a tier. The owner sets everything up in
   the room's own settings: a template to start from, then every channel's name, type and access, the tiers and their prices.
   Exposed as window.smlRoom = { open(ownerId, channelId?), door(host, { ownerId, own }) }. Educational posts by members, not advice. */
(() => {
  if (window.smlRoom) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const PLANS = [['day', '1 day'], ['week', '1 week'], ['month', '1 month'], ['year', '1 year'], ['lifetime', 'Lifetime']];
  const ICON = { announce: '📢', chat: '💬', notes: '📝', alerts: '📈' };
  const TYPE = { announce: 'Announcements', chat: 'Chat', notes: 'Notes', alerts: 'Alerts' };
  const ACCESS = { public: 'Public', members: 'Free members', paid: 'Paid' };
  const money = (c) => '$' + (Number(c || 0) / 100).toFixed(Number(c) % 100 ? 2 : 0);
  const ago = (iso) => { const d = (Date.now() - Date.parse(iso)) / 60000; if (d < 1) return 'now'; if (d < 60) return Math.round(d) + 'm'; if (d < 36 * 60) return Math.round(d / 60) + 'h'; return Math.round(d / 1440) + 'd'; };
  const openOut = (url) => { if (!url) return; if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  const openProfile = (id) => { if (window.smlAcademyProfile && window.smlAcademyProfile.open) void window.smlAcademyProfile.open(id); };
  async function api(path, method, body) {
    const t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    const go = (tok) => fetch('/academy-activity/room' + (path || ''), { method: method || 'GET', headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    try {
      let res = await go(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
      const j = await res.json().catch(() => null); return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' });
    } catch (_) { return { ok: false, error: 'network' }; }
  }
  function toast(text) { let t = document.getElementById('rm-toast'); if (!t) { t = document.createElement('div'); t.id = 'rm-toast'; t.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483600;max-width:min(92vw,520px);padding:9px 14px;border-radius:10px;background:#0d2a22;border:1px solid #1f8a5f;color:#dffcf0;font:700 .72rem system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5)'; document.body.appendChild(t); } t.textContent = text; t.style.display = 'block'; clearTimeout(t.__t); t.__t = setTimeout(() => { t.style.display = 'none'; }, 5200); }
  const ERR = { locked: 'That channel is locked for your membership.', read_only: 'Only the owner posts in this channel.', slow_mode: 'Slow mode: wait a moment before posting again.', empty: 'Write something first.', rate_limited: 'Slow down a little.', no_room: 'This room is closed.', checkout_unavailable: 'Paid checkout is not connected yet.', seller_not_ready: 'The owner has not finished setting up payouts yet.', plan_not_offered: 'That plan is not for sale.', not_premium: 'That tier is not for sale.', own_chart: 'That is your own room.', academy_access_required: 'Setting up a room is for Academy members.' };

  const css = document.createElement('style');
  css.textContent = '#sml-room{position:fixed;inset:0;z-index:2147483200;display:none;background:#070c11;color:#dbe6ec;font:500 13px/1.45 system-ui,sans-serif}#sml-room.open{display:flex;flex-direction:column}'
    + '#sml-room .rm-bar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #1b3540;background:#0b141c}#sml-room .rm-bar b{font:900 .78rem ui-monospace,monospace;letter-spacing:.06em;color:#9ed3e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#sml-room .rm-bar .sp{flex:1}'
    + '#sml-room button.rb{border:1px solid #2b5362;border-radius:8px;background:#0d1a24;color:#9ed3e6;font:800 .66rem ui-monospace,monospace;padding:6px 11px;cursor:pointer;letter-spacing:.04em;white-space:nowrap}#sml-room button.rb:hover{border-color:#6fb8e0;color:#fff}#sml-room button.rb.acc{background:#00c47d;border-color:#00c47d;color:#032318}#sml-room button.rb.gold{background:#2a1f08;border-color:#c9992a;color:#ffd878}#sml-room button.rb.on{border-color:#1f8a5f;color:#7ef0bd}#sml-room button.rb:disabled{opacity:.5;cursor:default}'
    + '#sml-room .rm-body{flex:1;min-height:0;display:grid;grid-template-columns:236px minmax(0,1fr) 270px}'
    + '#sml-room .rm-rail{min-height:0;overflow:auto;border-right:1px solid #1b3540;background:#09111a;padding:10px 8px;scrollbar-width:thin}#sml-room .rm-rail h3{margin:0 4px 2px;font:900 .86rem system-ui;color:#fff}#sml-room .rm-rail .tag{margin:0 4px 10px;color:#8fa6b3;font-size:.64rem}'
    + '#sml-room .rm-role{display:inline-block;margin:0 4px 10px;padding:2px 9px;border-radius:999px;font:800 .58rem ui-monospace,monospace;letter-spacing:.06em;background:#16232b;color:#cfe0e7}#sml-room .rm-role.owner{background:#3a2c08;color:#ffd878}#sml-room .rm-role.paid{background:#0d3a2b;color:#7ef0bd}#sml-room .rm-role.member{background:#10303f;color:#9ed3e6}'
    + '#sml-room .rm-cat{margin:12px 4px 3px;font:800 .56rem ui-monospace,monospace;letter-spacing:.12em;color:#5f7986}#sml-room .rm-ch{display:flex;align-items:center;gap:7px;width:100%;margin:1px 0;padding:6px 8px;border:0;border-radius:7px;background:none;color:#a9bdc8;font:600 .76rem system-ui;text-align:left;cursor:pointer}#sml-room .rm-ch:hover{background:rgba(158,211,230,.07);color:#fff}#sml-room .rm-ch.on{background:rgba(0,196,125,.14);color:#fff}#sml-room .rm-ch .lk{margin-left:auto;font-size:.7rem}#sml-room .rm-ch.locked{color:#7a8c96}#sml-room .rm-ch .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#sml-room .rm-foot{margin:14px 4px 0;padding-top:10px;border-top:1px solid #16303b;display:flex;flex-direction:column;gap:6px}'
    + '#sml-room .rm-main{min-width:0;min-height:0;display:flex;flex-direction:column}#sml-room .rm-ch-h{flex:none;display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:1px solid #16303b}#sml-room .rm-ch-h b{font:800 .86rem system-ui;color:#fff}#sml-room .rm-ch-h small{color:#8fa6b3;font-size:.68rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#sml-room .rm-pill{padding:1px 8px;border-radius:999px;background:#16232b;color:#9fb6c1;font:800 .54rem ui-monospace,monospace;letter-spacing:.06em;white-space:nowrap}#sml-room .rm-pill.paid{background:#2a1f08;color:#ffd878}#sml-room .rm-pill.public{background:#0d3a2b;color:#7ef0bd}'
    + '#sml-room .rm-feed{flex:1;min-height:0;overflow:auto;padding:10px 14px;scrollbar-width:thin}#sml-room .rm-msg{display:grid;grid-template-columns:34px 1fr;gap:10px;padding:6px 0}#sml-room .rm-msg img{width:34px;height:34px;border-radius:50%;background:#16232b;object-fit:cover}#sml-room .rm-msg .h{display:flex;gap:8px;align-items:baseline}#sml-room .rm-msg .h b{color:#fff;font-size:.78rem;cursor:pointer}#sml-room .rm-msg .h i{font-style:normal;color:#ffd878;font-size:.62rem;font-weight:800}#sml-room .rm-msg .h span{color:#6f8794;font-size:.62rem}#sml-room .rm-msg .t{white-space:pre-wrap;word-break:break-word;color:#dbe6ec}#sml-room .rm-msg .t a{color:#7fd0ff}'
    + '#sml-room .rm-msg .x{margin-left:auto;display:none;gap:4px}#sml-room .rm-msg:hover .x{display:flex}#sml-room .rm-msg .x button{border:0;background:none;color:#8fa6b3;cursor:pointer;font-size:.7rem}#sml-room .rm-msg .x button:hover{color:#fff}#sml-room .rm-msg.pin{background:rgba(255,216,120,.05);border-left:2px solid #c9992a;padding-left:8px}'
    + '#sml-room .rm-note{padding:12px 14px;margin:0 0 10px;border:1px solid #1b3540;border-radius:10px;background:#0a1118}#sml-room .rm-note .t{white-space:pre-wrap;word-break:break-word}#sml-room .rm-note .h{display:flex;gap:8px;align-items:baseline;margin:0 0 5px;color:#7f98a6;font-size:.64rem}'
    + '#sml-room .rm-comp{flex:none;display:flex;gap:8px;align-items:flex-end;padding:9px 14px;border-top:1px solid #16303b;background:#09111a}#sml-room .rm-comp textarea{flex:1;min-height:38px;max-height:120px;resize:vertical;border:1px solid #284654;border-radius:9px;background:#0d1720;color:#fff;font:500 .8rem system-ui;padding:8px 10px}#sml-room .rm-comp small{color:#6f8794;font-size:.6rem;align-self:center}'
    + '#sml-room .rm-lock{margin:auto;max-width:440px;text-align:center;padding:26px 20px}#sml-room .rm-lock .big{font-size:2.2rem}#sml-room .rm-lock h4{margin:8px 0 4px;color:#fff;font-size:1rem}#sml-room .rm-lock p{margin:0 0 12px;color:#9fb3be}'
    + '#sml-room .rm-side{min-height:0;overflow:auto;border-left:1px solid #1b3540;background:#09111a;padding:12px;scrollbar-width:thin}#sml-room .rm-side h5{margin:14px 0 6px;font:800 .56rem ui-monospace,monospace;letter-spacing:.12em;color:#5f7986}#sml-room .rm-side h5:first-child{margin-top:0}#sml-room .rm-side p{margin:0 0 6px;color:#9fb3be;font-size:.7rem;white-space:pre-wrap}'
    + '#sml-room .rm-tier{margin:0 0 8px;padding:9px 10px;border:1px solid #2a3a44;border-radius:10px;background:#0b151d}#sml-room .rm-tier.mine{border-color:#1f8a5f;background:#0b1a13}#sml-room .rm-tier b{display:block;color:#fff;font-size:.8rem}#sml-room .rm-tier ul{margin:5px 0 7px;padding-left:16px;color:#9fb3be;font-size:.68rem}#sml-room .rm-plans{display:flex;flex-wrap:wrap;gap:5px}#sml-room .rm-plans button{border:1px solid #8a6a1c;border-radius:7px;background:#1d1708;color:#ffd878;font:800 .6rem ui-monospace,monospace;padding:5px 8px;cursor:pointer}#sml-room .rm-plans button:hover{background:#2a2008}'
    + '#sml-room .rm-stats{display:flex;gap:8px;flex-wrap:wrap}#sml-room .rm-stats div{padding:5px 9px;border:1px solid #1b3540;border-radius:8px;background:#0b151d}#sml-room .rm-stats span{display:block;color:#7f98a6;font:700 .5rem ui-monospace,monospace;letter-spacing:.08em}#sml-room .rm-stats b{color:#fff;font:900 .9rem ui-monospace,monospace}'
    + '#sml-room .rm-set{flex:1;min-height:0;overflow:auto;padding:14px 18px;scrollbar-width:thin}#sml-room .rm-set h4{margin:18px 0 8px;font:900 .72rem ui-monospace,monospace;letter-spacing:.1em;color:#9ed3e6}#sml-room .rm-set h4:first-child{margin-top:0}#sml-room .rm-set label{display:flex;flex-direction:column;gap:3px;margin:0 0 8px;color:#8fa6b3;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em}'
    + '#sml-room .rm-set input,#sml-room .rm-set select,#sml-room .rm-set textarea{border:1px solid #284654;border-radius:7px;background:#0d1720;color:#fff;font:500 .76rem system-ui;padding:6px 8px;min-width:0}#sml-room .rm-set textarea{min-height:56px;resize:vertical}'
    + '#sml-room .rm-adv{margin:0 0 6px;padding:7px 10px;border-radius:8px;border:1px solid #2a3a44;background:#0b151d;font-size:.72rem}#sml-room .rm-adv.todo{border-color:#8a6a1c;background:#120f08;color:#ffe3a3}#sml-room .rm-adv.warn{border-color:#8a3a2c;background:#150c0a;color:#ffc2b4}#sml-room .rm-adv.tip{color:#b7e8d6}'
    + '#sml-room .rm-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}#sml-room .rm-tpl button{text-align:left;border:1px solid #284654;border-radius:10px;background:#0b151d;color:#dbe6ec;padding:9px 11px;cursor:pointer;font:600 .7rem system-ui}#sml-room .rm-tpl button b{display:block;color:#fff;margin:0 0 3px}#sml-room .rm-tpl button:hover{border-color:#00c47d}'
    + '#sml-room .rm-cate{margin:0 0 10px;padding:9px 10px;border:1px solid #1b3540;border-radius:10px;background:#0a1118}#sml-room .rm-cate>.r{display:flex;gap:6px;align-items:center;margin:0 0 7px}#sml-room .rm-cate>.r input{flex:1;font-weight:800;letter-spacing:.06em}#sml-room .rm-che{display:grid;grid-template-columns:minmax(110px,1.3fr) minmax(104px,1fr) minmax(104px,1fr) minmax(104px,1fr) auto;gap:6px;align-items:center;margin:0 0 5px}#sml-room .rm-che.hd{color:#5f7986;font:800 .5rem ui-monospace,monospace;letter-spacing:.1em}'
    + '#sml-room .rm-tiers .rm-tc{margin:0 0 10px;padding:10px;border:1px solid #1b3540;border-radius:10px;background:#0a1118}#sml-room .rm-pr{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px}#sml-room .rm-sellerbox{padding:10px 12px;border:1px dashed #8a6a1c;border-radius:10px;background:#120f08;color:#ffe3a3;font-size:.72rem}#sml-room .rm-sellerbox.ok{border:1px solid #1f8a5f;background:#0b1a13;color:#bff3dd}'
    + '#sml-room .rm-members .m{display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #12232c;font-size:.74rem}#sml-room .rm-members .m span{color:#7f98a6;font-size:.62rem}'
    + '#sml-room .rm-savebar{position:sticky;bottom:0;display:flex;gap:8px;align-items:center;padding:10px 0;background:linear-gradient(0deg,#070c11 70%,transparent)}#sml-room .rm-savebar .msg{color:#ffd878;font-size:.7rem}'
    + '.rm-door{border:1px solid #1f4a3a;border-radius:12px;background:linear-gradient(135deg,#0b1a13,#0a121a);padding:12px 14px;color:#dbe6ec;font:500 .76rem/1.45 system-ui,sans-serif}.rm-door h6{margin:0 0 6px;font:800 .56rem ui-monospace,monospace;letter-spacing:.14em;color:#7ef0bd}.rm-door .t{font:900 1rem system-ui;color:#fff}.rm-door .g{color:#9fb3be;margin:2px 0 8px}.rm-door .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 0}.rm-door .chip{padding:2px 9px;border-radius:999px;background:#10202a;border:1px solid #1b3540;color:#cfe0e7;font:700 .62rem system-ui}.rm-door .chip.lock{border-style:dashed;color:#ffd878}'
    + '.rm-door button{border:1px solid #2b5362;border-radius:8px;background:#0d1a24;color:#9ed3e6;font:800 .66rem ui-monospace,monospace;padding:6px 11px;cursor:pointer;letter-spacing:.04em}.rm-door button.acc{background:#00c47d;border-color:#00c47d;color:#032318}.rm-door button.gold{background:#2a1f08;border-color:#c9992a;color:#ffd878}.rm-door button.on{border-color:#1f8a5f;color:#7ef0bd}'
    + '@media(max-width:900px){#sml-room .rm-body{grid-template-columns:minmax(0,1fr)}#sml-room .rm-rail,#sml-room .rm-side{display:none}#sml-room.nav .rm-rail{display:block;position:absolute;left:0;top:44px;bottom:0;width:min(82vw,300px);z-index:3;box-shadow:12px 0 40px rgba(0,0,0,.6)}#sml-room.info .rm-side{display:block;position:absolute;right:0;top:44px;bottom:0;width:min(86vw,320px);z-index:3;box-shadow:-12px 0 40px rgba(0,0,0,.6)}#sml-room .rm-che{grid-template-columns:1fr 1fr}#sml-room .rm-mob{display:inline-block!important}}'
    + '#sml-room .rm-mob{display:none}';
  document.head.appendChild(css);

  const root = document.createElement('div'); root.id = 'sml-room'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Trading room'); document.body.appendChild(root);
  const S = { owner: '', d: null, ch: '', content: null, timer: 0, edit: null, members: null, seller: null, busy: false, sig: '' };

  const tierName = (d, id) => { const t = (d.tiers || []).find((x) => x.id === id); return t ? t.name : ''; };
  const channelOf = (d, id) => { for (const c of d.categories || []) for (const x of c.channels) if (x.id === id) return x; return null; };
  const firstOpen = (d) => { for (const c of d.categories || []) for (const x of c.channels) if (x.canRead) return x.id; for (const c of d.categories || []) if (c.channels[0]) return c.channels[0].id; return ''; };
  const roleLabel = (d) => (d.role.kind === 'owner' ? 'OWNER' : d.role.kind === 'paid' ? (d.role.tierName || 'PAID').toUpperCase() : d.role.kind === 'member' ? (d.room.memberRole || 'Member').toUpperCase() : d.role.kind === 'banned' ? 'LIMITED' : 'VISITOR');

  /* ---------- rail, side ---------- */
  function railHtml(d) {
    let h = '<h3>' + esc(d.room.name) + '</h3>' + (d.room.tagline ? '<div class="tag">' + esc(d.room.tagline) + '</div>' : '') + '<span class="rm-role ' + esc(d.role.kind) + '">' + esc(roleLabel(d)) + '</span>';
    for (const c of d.categories) {
      h += '<div class="rm-cat">' + esc(c.name) + '</div>';
      for (const x of c.channels) h += '<button type="button" class="rm-ch' + (S.ch === x.id ? ' on' : '') + (x.canRead ? '' : ' locked') + '" data-ch="' + esc(x.id) + '"><span>' + (ICON[x.type] || '#') + '</span><span class="nm">' + esc(x.name) + '</span>' + (x.canRead ? '' : '<span class="lk">🔒</span>') + '</button>';
    }
    if (!d.categories.length) h += '<div class="tag" style="margin-top:12px">' + (d.role.kind === 'owner' ? 'No channels yet. Open Room settings and pick a template.' : 'This room has no channels yet.') + '</div>';
    h += '<div class="rm-foot">' + (d.role.kind === 'owner' ? '<button type="button" class="rb acc" data-go="settings">⚙ Room settings</button><button type="button" class="rb" data-go="members">👥 Members</button>' : '') + '<button type="button" class="rb" data-go="profile">👤 ' + esc(d.owner.name || 'Profile') + '</button></div>';
    return h;
  }
  function planButtons(t) { return '<div class="rm-plans">' + PLANS.filter(([k]) => t.prices && t.prices[k]).map(([k, l]) => '<button type="button" data-buy="' + esc(t.id) + '" data-plan="' + k + '">' + l + ' · ' + money(t.prices[k]) + '</button>').join('') + '</div>'; }
  function sideHtml(d) {
    const own = d.role.kind === 'owner', paid = d.role.kind === 'paid';
    let h = '<h5>ABOUT THIS ROOM</h5>' + (d.room.about ? '<p>' + esc(d.room.about) + '</p>' : '<p style="color:#6f8794">' + (own ? 'Add a short description in Room settings.' : 'No description yet.') + '</p>')
      + '<div class="rm-stats"><div><span>MEMBERS</span><b>' + (d.stats.members || 0) + '</b></div>' + (own ? '<div><span>PAID</span><b>' + (d.stats.paid || 0) + '</b></div>' : '') + '<div><span>CHANNELS</span><b>' + (d.stats.channels || 0) + '</b></div></div>';
    if (!own) {
      h += '<h5>YOUR MEMBERSHIP</h5>';
      if (d.role.kind === 'visitor') h += '<p>You are looking from outside. Following is free and opens the free channels.</p><button type="button" class="rb acc" data-act="join">+ Join free</button>';
      else if (d.role.kind === 'member') h += '<p>You are a free member (' + esc(d.room.memberRole) + ').</p><button type="button" class="rb" data-act="leave">Leave room</button>';
      else if (paid) h += '<p>' + esc(d.role.tierName || 'Paid') + ' member' + (d.role.until ? ' until ' + new Date(d.role.until).toLocaleDateString() : ' for life') + '.</p>';
      else h += '<p>Your access to this room is limited by the owner.</p>';
      const sale = (d.tiers || []).filter((t) => t.forSale);
      if (sale.length) h += '<h5>PAID TIERS</h5>' + sale.map((t) => '<div class="rm-tier' + (paid && d.role.tier === t.id ? ' mine' : '') + '"><b>' + esc(t.name) + '</b>' + (t.perks.length ? '<ul>' + t.perks.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') + planButtons(t) + '</div>').join('');
      else if ((d.categories || []).some((c) => c.channels.some((x) => x.access === 'paid'))) h += '<h5>PAID TIERS</h5><p style="color:#6f8794">Paid access is not for sale yet.</p>';
    } else if (d.advice && d.advice.length) h += '<h5>NEXT STEPS</h5>' + d.advice.slice(0, 3).map((a) => '<div class="rm-adv ' + esc(a.level) + '">' + esc(a.text) + '</div>').join('');
    return h;
  }

  /* ---------- the channel ---------- */
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => '<a href="' + u + '" data-url="' + u + '" rel="noopener">' + u + '</a>');
  function msgHtml(p, d, asNote) {
    const own = d.role.kind === 'owner', can = own || p.mine;
    if (asNote) return '<div class="rm-note' + (p.pinned ? ' pin' : '') + '" data-id="' + esc(p.id) + '"><div class="h"><b style="color:#fff">' + esc(p.authorName) + '</b><span>' + esc(ago(p.createdAt)) + '</span>' + (own ? '<span style="margin-left:auto"><button type="button" class="rb" data-del="' + esc(p.id) + '">Delete</button></span>' : '') + '</div><div class="t">' + linkify(p.body) + '</div></div>';
    return '<div class="rm-msg' + (p.pinned ? ' pin' : '') + '" data-id="' + esc(p.id) + '"><img alt="" loading="lazy" src="/academy-activity/avatar?user=' + encodeURIComponent(p.authorId) + '&t=' + encodeURIComponent(token()) + '"><div><div class="h"><b data-user="' + esc(p.authorId) + '">' + esc(p.authorName) + '</b>' + (p.owner ? '<i>★ OWNER</i>' : '') + '<span>' + esc(ago(p.createdAt)) + '</span>'
      + (can ? '<span class="x">' + (own ? '<button type="button" data-pin="' + esc(p.id) + '" data-on="' + (p.pinned ? '0' : '1') + '" title="Pin">📌</button>' : '') + '<button type="button" data-del="' + esc(p.id) + '" title="Delete">🗑</button></span>' : '') + '</div><div class="t">' + linkify(p.body) + '</div></div></div>';
  }
  function lockHtml(c, unlock) {
    const d = S.d; let h = '<div class="rm-lock"><div class="big">🔒</div><h4>' + esc(c ? c.name : 'This channel') + ' is locked</h4><p>' + esc(unlock ? unlock.text : 'Not open for your membership.') + '</p>';
    if (unlock && unlock.need === 'follow') h += '<button type="button" class="rb acc" data-act="join">+ Join free</button>';
    else if (unlock && unlock.need === 'paid') {
      const sale = (d.tiers || []).filter((t) => t.forSale && (!unlock.tier || (d.tiers.findIndex((x) => x.id === t.id) >= d.tiers.findIndex((x) => x.id === unlock.tier))));
      if (d.role.kind === 'visitor') h += '<p style="margin-top:-4px">You can join free first, then upgrade any time.</p><button type="button" class="rb" data-act="join">+ Join free</button> ';
      h += sale.length ? sale.map((t) => '<div class="rm-tier" style="text-align:left;margin-top:10px"><b>' + esc(t.name) + '</b>' + (t.perks.length ? '<ul>' + t.perks.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') + planButtons(t) + '</div>').join('') : '<p style="color:#8fa6b3;margin-top:10px">Paid access is not for sale yet.</p>';
    }
    return h + '</div>';
  }
  function channelHtml(d) {
    const c = channelOf(d, S.ch); if (!c) return '<div class="rm-lock"><div class="big">💬</div><h4>Pick a channel</h4><p>Choose one from the list on the left.</p></div>';
    const acc = '<span class="rm-pill ' + (c.access === 'paid' ? 'paid' : c.access === 'public' ? 'public' : '') + '">' + esc(c.access === 'paid' ? (c.minTierName ? c.minTierName + ' and up' : 'PAID') : (ACCESS[c.access] || c.access).toUpperCase()) + '</span>';
    let h = '<div class="rm-ch-h"><button type="button" class="rb rm-mob" data-go="nav">☰</button><b>' + (ICON[c.type] || '#') + ' ' + esc(c.name) + '</b>' + acc + '<small>' + esc(c.about || TYPE[c.type]) + '</small><span style="flex:1"></span><button type="button" class="rb rm-mob" data-go="info">ⓘ</button></div>';
    const k = S.content;
    if (!k) return h + '<div class="rm-feed"><p style="color:#7f98a6">Loading…</p></div>';
    if (!k.ok) return h + '<div class="rm-feed" style="display:flex">' + lockHtml(c, k.unlock) + '</div>';
    if (c.type === 'alerts') return h + '<div class="rm-feed"><div class="rm-alerts ac-host"></div></div>';
    const note = c.type === 'notes' || c.type === 'announce';
    h += '<div class="rm-feed">' + (k.posts.length ? k.posts.map((p) => msgHtml(p, d, note)).join('') : '<p style="color:#7f98a6">' + (c.canWrite ? 'No messages yet. Start the conversation.' : 'Nothing posted here yet.') + '</p>') + '</div>';
    if (c.canWrite) h += '<div class="rm-comp"><textarea maxlength="1500" placeholder="' + (note ? 'Write a ' + (c.type === 'announce' ? 'announcement' : 'note') + '…' : 'Message #' + esc(c.name)) + '" data-comp></textarea><button type="button" class="rb acc" data-send>Send</button></div>';
    else if (!c.canWrite && c.type === 'chat') h += '<div class="rm-comp"><small>' + (d.role.kind === 'visitor' ? 'Join free to chat here.' : 'You can read this channel.') + '</small></div>';
    return h;
  }

  /* ---------- settings (owner) ---------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function chRow(c, ci, hi, tiers) {
    const sel = (name, opts, cur) => '<select data-f="' + name + '">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
    return '<div class="rm-che" data-ci="' + ci + '" data-hi="' + hi + '"><input data-f="name" maxlength="30" value="' + esc(c.name) + '" placeholder="channel-name">'
      + sel('type', Object.entries(TYPE), c.type) + sel('access', Object.entries(ACCESS), c.access)
      + (c.access === 'paid' && tiers.length > 1 ? sel('minTier', [['', 'Any paid tier']].concat(tiers.map((t) => [t.id, t.name + ' and up'])), c.minTier || '') : (c.type === 'chat' ? sel('slowSec', [['0', 'No slow mode'], ['3', 'Slow 3s'], ['10', 'Slow 10s'], ['30', 'Slow 30s'], ['60', 'Slow 60s']], String(c.slowSec || 0)) : '<span></span>'))
      + '<span><button type="button" class="rb" data-mv="up" title="Move up">↑</button> <button type="button" class="rb" data-mv="down" title="Move down">↓</button> <button type="button" class="rb" data-mv="del" title="Remove">✕</button></span></div>';
  }
  function sellerBox(sel) {
    const s = sel || {};
    if (s.configured === false) return '<div class="rm-sellerbox">Paid subscriptions are not switched on for this Academy yet. Paid channels stay locked to everyone until they are.</div>';
    if (s.ready) return '<div class="rm-sellerbox ok">✓ Payouts connected. Members pay on stockmarketloop.com; you receive each payment less the 6% processing fee. Subscriptions, refunds and disputes are handled there.</div>';
    let h = '<div class="rm-sellerbox"><b>GET PAID · stockmarketloop.com</b><p style="margin:5px 0 8px">';
    if (!s.linked) h += 'Link your Discord to your stockmarketloop.com account first, then come back.</p><button type="button" class="rb gold" data-act="site-link" data-url="' + esc(s.connectUrl || 'https://stockmarketloop.com/connect-discord/') + '">Link my stockmarketloop.com account</button>';
    else {
      h += (s.stripe && s.stripe.connected && !s.stripe.ready ? 'Stripe still needs details from you. Continue where you left off.' : 'Paid tiers are sold through stockmarketloop.com. Tick the lines, then connect Stripe (a few minutes: identity and bank details).') + '</p>';
      if (!s.consented) h += ['I accept the stockmarketloop.com seller terms. What I post is educational content, not financial advice.', 'stockmarketloop.com processes every payment and keeps a 6% processing fee; the rest is paid to my Stripe account.', 'If a member disputes a charge, the disputed amount is held back from me, and if the dispute is lost a dispute fee of 15% of the disputed amount is paid to stockmarketloop.com.', 'I will keep my room active. A room with no alert or update for more than 30 days is treated as not fulfilling the subscription, which gives me low chances of winning a dispute.'].map((t, i) => '<label style="flex-direction:row;gap:7px;font:500 .7rem system-ui;letter-spacing:0;color:#ffe3a3"><input type="checkbox" data-ck="' + i + '"> ' + esc(t) + '</label>').join('');
      h += '<button type="button" class="rb gold" data-act="stripe">' + (s.stripe && s.stripe.connected ? 'Continue Stripe setup' : 'Get paid with Stripe') + '</button> <span class="msg" data-sm></span>';
    }
    return h + '</div>';
  }
  function settingsHtml(d) {
    const e = S.edit; const tiers = e.tiers;
    let h = '<div class="rm-set"><h4>1 · YOUR ROOM</h4>'
      + '<label>ROOM NAME<input data-r="name" maxlength="60" value="' + esc(e.name) + '" placeholder="' + esc(d.owner.name ? d.owner.name + '’s room' : 'My trading room') + '"></label>'
      + '<label>ONE-LINE PITCH<input data-r="tagline" maxlength="120" value="' + esc(e.tagline) + '" placeholder="Day-trade alerts, a live chat and the plan every morning"></label>'
      + '<label>ABOUT<textarea data-r="about" maxlength="700" placeholder="Who you are, how you trade, what members get">' + esc(e.about) + '</textarea></label>'
      + '<label>NAME FOR FREE MEMBERS (like the everyone role)<input data-r="memberRole" maxlength="24" value="' + esc(e.memberRole) + '"></label>'
      + '<label style="flex-direction:row;align-items:center;gap:8px;color:#dbe6ec;font:700 .76rem system-ui;letter-spacing:0"><input type="checkbox" data-r="enabled"' + (e.enabled ? ' checked' : '') + '> Room is open (it shows on your profile and people can join)</label>';
    h += '<h4>2 · START FROM A TEMPLATE (you can change everything after)</h4><div class="rm-tpl">' + (d.templates || []).map((t) => '<button type="button" data-tpl="' + esc(t.key) + '"><b>' + esc(t.label) + '</b>' + esc(t.blurb) + '</button>').join('') + '</div>';
    h += '<h4>3 · CHANNELS · who can see each one</h4><p style="margin:0 0 8px;color:#8fa6b3;font-size:.7rem"><b style="color:#7ef0bd">Public</b> anyone can read it, even before joining. <b style="color:#9ed3e6">Free members</b> everyone who follows you. <b style="color:#ffd878">Paid</b> members of a tier (and a higher tier opens the lower ones). Chat is the only type members can post in.</p>';
    e.categories.forEach((c, ci) => {
      h += '<div class="rm-cate" data-cat="' + ci + '"><div class="r"><input data-cf="name" maxlength="30" value="' + esc(c.name) + '"><button type="button" class="rb" data-cmv="up">↑</button><button type="button" class="rb" data-cmv="down">↓</button><button type="button" class="rb" data-cmv="del">Remove group</button></div>'
        + '<div class="rm-che hd"><span>NAME</span><span>TYPE</span><span>WHO CAN SEE IT</span><span>' + (tiers.length > 1 ? 'LOWEST TIER' : 'OPTION') + '</span><span></span></div>' + c.channels.map((x, hi) => chRow(x, ci, hi, tiers)).join('')
        + '<button type="button" class="rb" data-addch="' + ci + '">+ Add channel</button></div>';
    });
    h += '<button type="button" class="rb" data-addcat>+ Add group</button>';
    h += '<h4>4 · PAID TIERS · what members can buy</h4><div class="rm-tiers">' + (tiers.length ? '' : '<p style="margin:0 0 8px;color:#8fa6b3;font-size:.72rem">No paid tier yet. Free channels work without one. Add a tier when you want to charge.</p>');
    tiers.forEach((t, ti) => {
      h += '<div class="rm-tc" data-tier="' + ti + '"><div style="display:flex;gap:6px;margin:0 0 8px"><input data-tf="name" style="flex:1;font-weight:800" maxlength="30" value="' + esc(t.name) + '" placeholder="Tier name"><button type="button" class="rb" data-tmv="up">↑</button><button type="button" class="rb" data-tmv="down">↓</button><button type="button" class="rb" data-tmv="del">Remove</button></div>'
        + '<label>WHAT THEY GET (one per line)<textarea data-tf="perks" placeholder="Every premium alert&#10;The members-only chat">' + esc((t.perks || []).join('\n')) + '</textarea></label>'
        + '<div class="rm-pr">' + PLANS.map(([k, l]) => '<label>' + l.toUpperCase() + ' (USD)<input type="number" min="0" step="0.01" data-pf="' + k + '" value="' + (t.prices && t.prices[k] ? (t.prices[k] / 100).toFixed(2) : '') + '" placeholder="not offered"></label>').join('') + '</div>'
        + '<div style="margin-top:2px;color:#7f98a6;font-size:.64rem">Leave a price empty to not offer that length. Minimum $1. You receive each payment less the 6% processing fee. Suggestions: <button type="button" class="rb" data-sug="29">$29/mo</button> <button type="button" class="rb" data-sug="49">$49/mo</button> <button type="button" class="rb" data-sug="99">$99/mo</button></div></div>';
    });
    h += (tiers.length < 4 ? '<button type="button" class="rb" data-addtier>+ Add a paid tier</button>' : '') + '</div>';
    h += '<h4>5 · GET PAID</h4>' + sellerBox(S.seller || d.seller);
    h += '<h4>WHAT IS MISSING</h4>' + ((d.advice || []).length ? d.advice.map((a) => '<div class="rm-adv ' + esc(a.level) + '">' + esc(a.text) + '</div>').join('') : '<div class="rm-adv tip">Nothing missing.</div>');
    h += '<div class="rm-savebar"><button type="button" class="rb acc" data-save>Save room</button><button type="button" class="rb" data-go="back">Back to the room</button><span class="msg" data-msg></span></div></div>';
    return '<div class="rm-ch-h"><button type="button" class="rb rm-mob" data-go="nav">☰</button><b>⚙ Room settings</b><small>Only you see this</small></div>' + h;
  }
  function readEdit() {
    const q = root.querySelector('.rm-set'); if (!q || !S.edit) return;
    const e = S.edit;
    q.querySelectorAll('[data-r]').forEach((i) => { const k = i.dataset.r; e[k] = i.type === 'checkbox' ? i.checked : i.value; });
    q.querySelectorAll('.rm-cate').forEach((cel) => {
      const ci = Number(cel.dataset.cat), c = e.categories[ci]; if (!c) return; c.name = cel.querySelector('[data-cf=name]').value;
      cel.querySelectorAll('.rm-che[data-ci]').forEach((row) => { const x = c.channels[Number(row.dataset.hi)]; if (!x) return; row.querySelectorAll('[data-f]').forEach((i) => { const k = i.dataset.f; x[k] = k === 'slowSec' ? Number(i.value) || 0 : i.value; }); });
    });
    q.querySelectorAll('.rm-tc').forEach((tel) => {
      const t = e.tiers[Number(tel.dataset.tier)]; if (!t) return; t.name = tel.querySelector('[data-tf=name]').value; t.perks = tel.querySelector('[data-tf=perks]').value.split('\n').map((x) => x.trim()).filter(Boolean);
      t.prices = t.prices || {}; tel.querySelectorAll('[data-pf]').forEach((i) => { const v = Number(i.value); t.prices[i.dataset.pf] = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0; });
    });
  }
  const slug = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

  /* ---------- members (owner) ---------- */
  function membersHtml() {
    const m = S.members; let h = '<div class="rm-ch-h"><button type="button" class="rb rm-mob" data-go="nav">☰</button><b>👥 Members</b><small>Only you see this</small></div><div class="rm-set rm-members">';
    if (!m) return h + '<p style="color:#7f98a6">Loading…</p></div>';
    h += '<p style="color:#9fb3be;font-size:.72rem">Limiting a member closes everything except your public channels. It does not refund a paid member: if you remove someone who paid, settle it with them on stockmarketloop.com.</p>';
    h += m.members.length ? m.members.map((x) => '<div class="m"><b style="color:#fff;cursor:pointer" data-user="' + esc(x.id) + '">' + esc(x.name) + '</b><span>' + (x.kind === 'paid' ? '★ ' + esc(x.tierName || 'Paid') + ' · ' + esc(x.plan) + (x.until ? ' until ' + new Date(x.until).toLocaleDateString() : ' · lifetime') : esc('Free member')) + (x.banned ? ' · LIMITED' : '') + '</span><span style="flex:1"></span><button type="button" class="rb" data-ban="' + esc(x.id) + '" data-on="' + (x.banned ? '0' : '1') + '">' + (x.banned ? 'Restore' : 'Limit') + '</button></div>').join('') : '<p style="color:#7f98a6">Nobody has joined yet. Share your profile.</p>';
    return h + '</div>';
  }

  /* ---------- paint ---------- */
  function paint(keepFeed) {
    const d = S.d; if (!d) return;
    const title = d.room.name; root.querySelector('.rm-bar b').textContent = '🏛 ' + title;
    root.querySelector('.rm-rail').innerHTML = railHtml(d);
    root.querySelector('.rm-side').innerHTML = sideHtml(d);
    const main = root.querySelector('.rm-main');
    if (S.ch === '__settings' && S.edit) { main.innerHTML = settingsHtml(d); return; }
    if (S.ch === '__members') { main.innerHTML = membersHtml(); return; }
    if (keepFeed) return;
    main.innerHTML = channelHtml(d);
    const feed = main.querySelector('.rm-feed'); if (feed) feed.scrollTop = feed.scrollHeight;
    const host = main.querySelector('.rm-alerts');
    if (host && window.smlAlertChart) void window.smlAlertChart.mount(host, { traderId: S.owner, channel: S.ch });
  }
  async function loadRoom(keep) {
    const r = await api('?owner=' + encodeURIComponent(S.owner));
    if (!r.ok) { root.querySelector('.rm-main').innerHTML = '<div class="rm-lock"><div class="big">🏛</div><h4>' + (r.error === 'no_room' ? 'This room is closed' : 'Could not open the room') + '</h4><p>' + esc(ERR[r.error] || 'Try again in a moment.') + '</p></div>'; root.querySelector('.rm-rail').innerHTML = ''; root.querySelector('.rm-side').innerHTML = ''; return false; }
    S.d = r; S.seller = r.seller || S.seller; if (!keep || !channelOf(r, S.ch)) { if (S.ch !== '__settings' && S.ch !== '__members') S.ch = S.ch && channelOf(r, S.ch) ? S.ch : firstOpen(r); }
    return true;
  }
  async function loadChannel(first) {
    const d = S.d; if (!d || !S.ch || S.ch.startsWith('__')) return;
    const c = channelOf(d, S.ch); if (!c) return;
    if (first) { S.content = null; S.sig = ''; paint(); }
    const id = S.ch, r = await api('/channel?owner=' + encodeURIComponent(S.owner) + '&channel=' + encodeURIComponent(id));
    if (S.ch !== id) return;
    const sig = r.ok ? (c.type === 'alerts' ? 'alerts' : r.posts.map((p) => p.id + (p.pinned ? 'p' : '')).join(',')) : 'locked:' + (r.error || '');
    if (!first && sig === S.sig) return;
    S.content = r; S.sig = sig; paint();
  }
  function tick() { clearTimeout(S.timer); if (!root.classList.contains('open')) return; S.timer = setTimeout(async () => { if (!document.hidden && S.ch && !S.ch.startsWith('__') && !root.querySelector('[data-comp]:focus')) await loadChannel(false); tick(); }, 6000); }

  async function openRoom(ownerId, channelId) {
    if (!token()) { toast('Sign in to the Academy first.'); return; }
    const id = String(ownerId || ''); if (!/^\d{15,25}$/.test(id)) return;
    S.owner = id; S.ch = channelId || ''; S.content = null; S.edit = null; S.members = null; S.sig = '';
    root.className = 'open'; root.innerHTML = '<div class="rm-bar"><b>🏛 Trading room</b><span class="sp"></span><button type="button" class="rb" data-go="close">✕ Close</button></div><div class="rm-body"><div class="rm-rail"></div><div class="rm-main"><div class="rm-feed"><p style="color:#7f98a6">Opening the room…</p></div></div><div class="rm-side"></div></div>';
    if (!(await loadRoom(false))) return;
    paint(); await loadChannel(true); tick();
  }
  function close() { root.classList.remove('open', 'nav', 'info'); clearTimeout(S.timer); S.d = null; }

  async function afterJoin(r, msg) { if (r.ok) { toast(msg); await loadRoom(true); await loadChannel(true); } else toast(ERR[r.error] || 'Could not do that (' + (r.error || 'error') + ').'); }
  async function buy(tier, plan) {
    const r = await api('/checkout', 'POST', { owner: S.owner, tier, plan });
    if (r.ok && r.url) { openOut(r.url); toast('Checkout opened on stockmarketloop.com. Your access turns on here once it is paid.'); }
    else toast(ERR[r.error] || 'Could not start checkout (' + (r.error || 'error') + ').');
  }
  async function saveRoom(btn) {
    readEdit(); const e = S.edit, msg = root.querySelector('[data-msg]'); btn.disabled = true;
    const payload = clone(e); payload.tiers.forEach((t) => { t.id = t.id || slug(t.name); }); payload.categories.forEach((c) => { c.id = c.id || slug(c.name); c.channels.forEach((x) => { x.id = x.id || slug(x.name); }); });
    const r = await api('/settings', 'POST', { room: payload }); btn.disabled = false;
    if (!r.ok) { msg.textContent = ERR[r.error] || 'Could not save (' + (r.error || 'error') + ').'; return; }
    toast('Room saved.'); await loadRoom(true); S.edit = clone(S.d.settings); S.ch = '__settings'; paint();
  }

  root.addEventListener('click', async (ev) => {
    const t = ev.target; const q = (sel) => (t.closest ? t.closest(sel) : null);
    if (q('a[data-url]')) { ev.preventDefault(); openOut(q('a[data-url]').dataset.url); return; }
    const user = q('[data-user]'); if (user && !q('button')) { openProfile(user.dataset.user); return; }
    const go = q('[data-go]');
    if (go) {
      const g = go.dataset.go;
      if (g === 'close') { close(); return; }
      if (g === 'nav') { root.classList.toggle('nav'); root.classList.remove('info'); return; }
      if (g === 'info') { root.classList.toggle('info'); root.classList.remove('nav'); return; }
      if (g === 'profile') { close(); openProfile(S.owner); return; }
      if (g === 'back') { S.ch = firstOpen(S.d); S.edit = null; paint(); await loadChannel(true); return; }
      if (g === 'settings') { await loadRoom(true); S.edit = clone(S.d.settings); S.ch = '__settings'; root.classList.remove('nav'); paint(); return; }
      if (g === 'members') { S.ch = '__members'; S.members = null; root.classList.remove('nav'); paint(); S.members = await api('/members'); paint(); return; }
    }
    const chb = q('[data-ch]'); if (chb) { S.ch = chb.dataset.ch; S.edit = null; root.classList.remove('nav'); await loadChannel(true); return; }
    const act = q('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'join') { act.disabled = true; await afterJoin(await api('/follow', 'POST', { owner: S.owner, on: true, push: true }), 'You joined the room (free). New alerts will notify you.'); return; }
      if (a === 'leave') { await afterJoin(await api('/follow', 'POST', { owner: S.owner, on: false }), 'You left the room.'); return; }
      if (a === 'site-link') { openOut(act.dataset.url); toast('Link your Discord on stockmarketloop.com, then reopen Room settings.'); return; }
      if (a === 'stripe') {
        const box = act.closest('.rm-sellerbox'), msg = box.querySelector('[data-sm]'), cks = [...box.querySelectorAll('[data-ck]')];
        if (cks.some((c) => !c.checked)) { msg.textContent = 'Tick every line to continue.'; return; }
        act.disabled = true; const r = await (async () => { const tk = token(); const res = await fetch('/academy-activity/trader-alerts/seller', { method: 'POST', headers: { authorization: 'Bearer ' + tk, 'content-type': 'application/json' }, body: JSON.stringify({ terms: true, fee: true, disputes: true, activity: true }) }); return res.json().catch(() => ({ ok: false })); })(); act.disabled = false;
        if (r.ok && r.url) { openOut(r.url); toast('Stripe onboarding opened. Finish it there, then come back: your room can take paid members.'); return; }
        if (r.error === 'site_not_linked') { openOut(r.connectUrl); msg.textContent = 'Link your stockmarketloop.com account first (opened).'; return; }
        msg.textContent = ERR[r.error] || 'Could not start Stripe setup (' + (r.error || 'error') + ').'; return;
      }
    }
    const buyb = q('[data-buy]'); if (buyb) { buyb.disabled = true; await buy(buyb.dataset.buy, buyb.dataset.plan); buyb.disabled = false; return; }
    if (q('[data-send]')) {
      const ta = root.querySelector('[data-comp]'), body = ta.value.trim(); if (!body) return; const btn = q('[data-send]'); btn.disabled = true;
      const r = await api('/post', 'POST', { owner: S.owner, channel: S.ch, body }); btn.disabled = false;
      if (!r.ok) { toast(ERR[r.error] || 'Could not send (' + (r.error || 'error') + ').'); return; }
      ta.value = ''; await loadChannel(true); const ta2 = root.querySelector('[data-comp]'); if (ta2) ta2.focus(); return;
    }
    const del = q('[data-del]'); if (del) { const r = await api('/delete', 'POST', { owner: S.owner, id: del.dataset.del }); if (r.ok) await loadChannel(true); else toast(ERR[r.error] || 'Could not delete.'); return; }
    const pin = q('[data-pin]'); if (pin) { const r = await api('/pin', 'POST', { owner: S.owner, id: pin.dataset.pin, on: pin.dataset.on === '1' }); if (r.ok) await loadChannel(true); return; }
    const ban = q('[data-ban]'); if (ban) { const r = await api('/ban', 'POST', { member: ban.dataset.ban, on: ban.dataset.on === '1' }); if (r.ok) { S.members = await api('/members'); paint(); } return; }
    /* settings editing */
    if (S.ch === '__settings' && S.edit) {
      const e = S.edit;
      const tpl = q('[data-tpl]');
      if (tpl) { if (e.categories.some((c) => c.channels.length) && !window.confirm('Replace your current channels and tiers with this template? (Prices you entered will be cleared.)')) return; const r = await api('/template', 'POST', { key: tpl.dataset.tpl }); if (r.ok) { await loadRoom(true); S.edit = clone(S.d.settings); S.ch = '__settings'; paint(); toast('Template applied. Change anything you like, then Save.'); } else toast(ERR[r.error] || 'Could not apply the template.'); return; }
      if (q('[data-save]')) { await saveRoom(q('[data-save]')); return; }
      const mv = q('[data-mv]'); if (mv) { readEdit(); const row = mv.closest('.rm-che'), ci = Number(row.dataset.ci), hi = Number(row.dataset.hi), list = e.categories[ci].channels; if (mv.dataset.mv === 'del') list.splice(hi, 1); else { const j = hi + (mv.dataset.mv === 'up' ? -1 : 1); if (j >= 0 && j < list.length) [list[hi], list[j]] = [list[j], list[hi]]; } paint(); return; }
      const add = q('[data-addch]'); if (add) { readEdit(); const c = e.categories[Number(add.dataset.addch)], n = c.channels.length + 1; c.channels.push({ id: '', name: 'new-channel-' + n, type: 'chat', access: 'members', minTier: '', about: '', slowSec: 0 }); paint(); return; }
      if (q('[data-addcat]')) { readEdit(); e.categories.push({ id: '', name: 'NEW GROUP', channels: [] }); paint(); return; }
      const cmv = q('[data-cmv]'); if (cmv) { readEdit(); const ci = Number(cmv.closest('.rm-cate').dataset.cat); if (cmv.dataset.cmv === 'del') { if (!e.categories[ci].channels.length || window.confirm('Remove this group and its channels?')) e.categories.splice(ci, 1); } else { const j = ci + (cmv.dataset.cmv === 'up' ? -1 : 1); if (j >= 0 && j < e.categories.length) [e.categories[ci], e.categories[j]] = [e.categories[j], e.categories[ci]]; } paint(); return; }
      if (q('[data-addtier]')) { readEdit(); e.tiers.push({ id: '', name: 'Premium', perks: [], prices: { day: 0, week: 0, month: 0, year: 0, lifetime: 0 }, color: '' }); paint(); return; }
      const tmv = q('[data-tmv]'); if (tmv) { readEdit(); const ti = Number(tmv.closest('.rm-tc').dataset.tier); if (tmv.dataset.tmv === 'del') e.tiers.splice(ti, 1); else { const j = ti + (tmv.dataset.tmv === 'up' ? -1 : 1); if (j >= 0 && j < e.tiers.length) [e.tiers[ti], e.tiers[j]] = [e.tiers[j], e.tiers[ti]]; } paint(); return; }
      const sug = q('[data-sug]'); if (sug) { readEdit(); const ti = Number(sug.closest('.rm-tc').dataset.tier), m = Number(sug.dataset.sug); const p = e.tiers[ti].prices; p.month = m * 100; p.week = Math.round(m * 0.35) * 100; p.year = Math.round(m * 8.5) * 100; paint(); return; }
    }
  });
  root.addEventListener('change', (ev) => {
    if (S.ch !== '__settings' || !S.edit) return;
    const f = ev.target && ev.target.dataset && ev.target.dataset.f; if (f === 'access' || f === 'type') { readEdit(); paint(); }
  });
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && ev.target && ev.target.matches && ev.target.matches('[data-comp]')) { ev.preventDefault(); const b = root.querySelector('[data-send]'); if (b) b.click(); } if (ev.key === 'Escape' && root.classList.contains('open')) close(); });

  /* ---------- the front door, on a trader's profile ---------- */
  async function door(host, { ownerId, own } = {}) {
    if (!host) return; const id = String(ownerId || '');
    if (!token() || !/^\d{15,25}$/.test(id)) { host.innerHTML = ''; return; }
    host.classList.add('rm-door-host');
    const r = await api('?owner=' + encodeURIComponent(id));
    if (!r.ok) {
      if (r.error === 'no_room' || r.status === 404) { host.innerHTML = ''; return; }
      host.innerHTML = ''; return;
    }
    const d = r, owner = d.role.kind === 'owner';
    if (owner && !d.room.enabled) {
      host.innerHTML = '<div class="rm-door"><h6>YOUR TRADING ROOM</h6><div class="t">Open a room behind this profile</div><div class="g">Free channels for the people who follow you, paid channels for the ones who subscribe. Chat, alerts, notes: you choose what is free and what is paid. Start from a template and change anything.</div><div class="row"><button type="button" class="acc" data-d="settings">Set up my room</button></div></div>';
    } else {
      const locked = d.categories.flatMap((c) => c.channels).filter((x) => !x.canRead).length, open = d.categories.flatMap((c) => c.channels).filter((x) => x.canRead);
      const sale = (d.tiers || []).filter((t) => t.forSale);
      const low = sale.map((t) => ({ t, m: t.prices.month || t.prices.week || t.prices.day || t.prices.year || t.prices.lifetime })).sort((a, b) => a.m - b.m)[0];
      host.innerHTML = '<div class="rm-door"><h6>TRADING ROOM' + (owner ? ' · YOURS' : '') + '</h6><div class="t">' + esc(d.room.name) + '</div>' + (d.room.tagline ? '<div class="g">' + esc(d.room.tagline) + '</div>' : '')
        + '<div class="row"><span class="chip">' + d.stats.members + ' member' + (d.stats.members === 1 ? '' : 's') + '</span><span class="chip">' + open.length + ' open channel' + (open.length === 1 ? '' : 's') + '</span>' + (locked ? '<span class="chip lock">🔒 ' + locked + ' for ' + (sale.length ? 'paid' : 'members') + '</span>' : '') + (low ? '<span class="chip lock">★ from ' + money(low.m) + '</span>' : '') + (d.role.kind !== 'visitor' && !owner ? '<span class="chip">' + esc(roleLabel(d)) + '</span>' : '') + '</div>'
        + '<div class="row"><button type="button" class="acc" data-d="enter">Enter the room</button>'
        + (owner ? '<button type="button" data-d="settings">⚙ Room settings</button>' : d.role.kind === 'visitor' ? '<button type="button" data-d="join">+ Join free</button>' : '')
        + (!owner && sale.length && d.role.kind !== 'paid' ? '<button type="button" class="gold" data-d="enter-paid">★ See paid tiers</button>' : '') + '</div></div>';
    }
    if (!host.__rmBound) {
      host.__rmBound = true;
      host.addEventListener('click', async (e) => {
        const b = e.target.closest ? e.target.closest('[data-d]') : null; if (!b) return; const a = b.dataset.d;
        if (a === 'enter' || a === 'enter-paid') { void openRoom(id); return; }
        if (a === 'settings') { await openRoom(id); const g = root.querySelector('[data-go=settings]'); if (g) g.click(); return; }
        if (a === 'join') { b.disabled = true; const j = await api('/follow', 'POST', { owner: id, on: true, push: true }); if (j.ok) { toast('You joined the room (free).'); void door(host, { ownerId: id, own }); } else toast(ERR[j.error] || 'Could not join.'); }
      });
    }
  }
  const selfId = () => { try { const part = token().split('.')[1] || ''; const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/')); const json = decodeURIComponent(Array.from(bin).map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')); const c = JSON.parse(json); return String(c.u || c.sub || ''); } catch (_) { return ''; } };
  window.smlRoom = { open: openRoom, door, close, mine: () => openRoom(selfId()), isOpen: () => root.classList.contains('open') };
  /* a link straight into a room: ?room=<owner id>[&channel=<id>] */
  try { const qs = new URLSearchParams(location.search), rid = qs.get('room'); if (rid) setTimeout(() => openRoom(rid, qs.get('channel') || ''), 2500); } catch (_) { /* ignore */ }
})();
