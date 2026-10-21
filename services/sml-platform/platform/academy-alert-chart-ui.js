/* ALERT CHART, the page side (server: academy-trader-alerts.js). One renderer used in two places: a trader's profile page
   (their chart: the threads, and for the owner a post form, update forms and the channel / price settings) and the
   Alerts desk's TRADERS tab (the feed: alerts from the charts a member follows, then recent free alerts from everyone,
   with a Post button that starts from the ticker and price on the chart). Every alert shows the peak gain since the
   alert, the gain now, how long the peak took and which targets were hit; a premium alert the viewer has not bought
   keeps those numbers and hides the ticker, the levels and the thread. Follow (with a push opt-in) and Subscribe sit
   on every chart. Educational posts by members, not advice. */
(() => {
  if (window.smlAlertChart) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const PLANS = [['day', '1 day'], ['week', '1 week'], ['month', '1 month'], ['year', '1 year'], ['lifetime', 'Lifetime']];
  const css = document.createElement('style');
  css.textContent = '.ac{font:500 .7rem/1.45 system-ui,sans-serif;color:#dbe6ec}.ac h6{margin:0 0 6px;font:800 .56rem ui-monospace,monospace;letter-spacing:.14em;color:#7ef0bd;text-transform:uppercase}'
    + '.ac .ac-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 8px}.ac .ac-top .sp{flex:1}.ac .ac-stat{display:inline-flex;flex-direction:column;padding:4px 8px;border:1px solid #1b3540;border-radius:8px;background:#0b151d;min-width:64px}.ac .ac-stat span{color:#7f98a6;font:700 .5rem ui-monospace,monospace;letter-spacing:.08em}.ac .ac-stat b{color:#fff;font:800 .76rem ui-monospace,monospace}'
    + '.ac button.ac-b{border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .6rem ui-monospace,monospace;padding:5px 9px;cursor:pointer;letter-spacing:.04em}.ac button.ac-b.acc{background:#00c47d;border-color:#00c47d;color:#042217}.ac button.ac-b.on{background:#123d31;border-color:#2d5a3f;color:#7dffc4}.ac button.ac-b.gold{background:#3a2d10;border-color:#8a6a1c;color:#ffcf7a}.ac button:disabled{opacity:.5;cursor:default}'
    + '.ac .ac-row{position:relative;margin:0 0 8px;padding:9px 11px;border:1px solid #1b3540;border-radius:10px;background:#0a1118}.ac .ac-row.locked{border-style:dashed;border-color:#8a6a1c}.ac .ac-row.closed{opacity:.85}'
    + '.ac .ac-h{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.ac .ac-h .sym{font:900 .9rem ui-monospace,monospace;color:#fff;cursor:pointer}.ac .ac-h .sym.lock{color:#ffcf7a;cursor:default}.ac .ac-h .side{padding:1px 6px;border-radius:999px;font:800 .54rem ui-monospace,monospace;letter-spacing:.08em}.ac .ac-h .side.long{background:#0d3a2a;color:#3ef0a8}.ac .ac-h .side.short{background:#3a0f1a;color:#ff9fb0}.ac .ac-h .ch{color:#9fb3be;font:700 .56rem ui-monospace,monospace}.ac .ac-h .ch.prem{color:#ffcf7a}.ac .ac-h .who{color:#9ed3e6;font-weight:800;cursor:pointer}.ac .ac-h .when{margin-left:auto;color:#6f8794;font:600 .56rem ui-monospace,monospace}'
    + '.ac .ac-m{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px;margin:7px 0 0}.ac .ac-m div{padding:5px 7px;border-radius:8px;background:#0b151d;border:1px solid #142a34}.ac .ac-m span{display:block;color:#7f98a6;font:700 .5rem ui-monospace,monospace;letter-spacing:.08em}.ac .ac-m b{font:800 .78rem ui-monospace,monospace;color:#fff}.ac .up{color:#52e6ad!important}.ac .dn{color:#ff778b!important}'
    + '.ac .ac-lv{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0 0;font:700 .6rem ui-monospace,monospace}.ac .ac-lv span{padding:2px 7px;border-radius:6px;background:#0b151d;border:1px solid #142a34;color:#cfe0e8}.ac .ac-lv span.hit{background:#0d3a2a;border-color:#1f6b44;color:#7dffc4}.ac .ac-lv span.stop{color:#ff9fb0}'
    + '.ac .ac-note{margin:6px 0 0;color:#cfe0e8;white-space:pre-wrap;word-break:break-word}.ac .ac-th{margin:7px 0 0;padding-left:10px;border-left:2px solid #1f3a46}.ac .ac-u{margin:0 0 5px;font-size:.66rem}.ac .ac-u i{font-style:normal;padding:1px 6px;border-radius:999px;font:800 .52rem ui-monospace,monospace;letter-spacing:.06em;margin-right:5px;background:#16303a;color:#9fd3e8}.ac .ac-u i.pt_hit{background:#0d3a2a;color:#7dffc4}.ac .ac-u i.close{background:#2e2410;color:#ffcf7a}.ac .ac-u i.sell{background:#1b2d4a;color:#9cc8ff}.ac .ac-u small{color:#6f8794;margin-left:6px}'
    + '.ac .ac-acts{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0}.ac .ac-lockmsg{margin:6px 0 0;color:#ffcf7a;font-size:.64rem}'
    + '.ac form{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin:8px 0;padding:10px;border:1px solid #2d5a3f;border-radius:10px;background:#0b151d}.ac form label{display:flex;flex-direction:column;gap:3px;color:#8fa6b3;font:700 .54rem ui-monospace,monospace;letter-spacing:.08em}.ac form input,.ac form select,.ac form textarea{border:1px solid #2b5362;border-radius:6px;background:#0d1a24;color:#fff;padding:6px 7px;font:600 .72rem system-ui,sans-serif}.ac form textarea{min-height:48px;resize:vertical}.ac form .full{grid-column:1/-1}.ac form .btns{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.ac form .msg{color:#ff9fb0;font-size:.62rem}'
    + '.ac .ac-set .chs{display:flex;flex-direction:column;gap:4px}.ac .ac-set .chs label{flex-direction:row;align-items:center;gap:6px;color:#dbe6ec;font:600 .66rem system-ui,sans-serif}.ac .ac-set .chs input[type=text]{flex:1}.ac .ac-empty{padding:12px;color:#7f98a6;text-align:center;border:1px dashed #1b3540;border-radius:10px}'
    + '.ac .ac-plans{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 0}.ac .ac-plans button{border:1px solid #8a6a1c;border-radius:7px;background:#1d1708;color:#ffcf7a;font:800 .6rem ui-monospace,monospace;padding:5px 8px;cursor:pointer}'
    + '.ac .ac-seller{padding:9px 10px;border:1px dashed #8a6a1c;border-radius:9px;background:#120f08}.ac .ac-seller.ok{border-style:solid;border-color:#2d5a3f;background:#0b1a13}.ac .ac-seller h6{color:#ffcf7a}.ac .ac-seller.ok h6{color:#7ef0bd}.ac .ac-seller p{margin:0 0 7px;color:#dbe6ec;font:500 .66rem/1.45 system-ui,sans-serif}.ac .ac-seller label.ck{flex-direction:row;align-items:flex-start;gap:7px;margin:0 0 6px;color:#cfe0e8;font:500 .64rem/1.4 system-ui,sans-serif;letter-spacing:0;text-transform:none}.ac .ac-seller label.ck input{margin-top:2px}.ac .ac-seller .btns{margin-top:4px}';
  document.head.appendChild(css);

  const money = (c) => '$' + (Number(c || 0) / 100).toFixed(2);
  const pct = (v) => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
  const cls = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
  const dur = (ms) => { if (ms == null) return '–'; const m = Math.round(ms / 60000); if (m < 60) return m + 'm'; const h = Math.round(m / 60); if (h < 48) return h + 'h'; return Math.round(h / 24) + 'd'; };
  const ago = (iso) => { const d = (Date.now() - Date.parse(iso)) / 60000; if (d < 1) return 'now'; if (d < 60) return Math.round(d) + 'm'; if (d < 36 * 60) return Math.round(d / 60) + 'h'; return Math.round(d / 1440) + 'd'; };
  const KIND = { update: 'UPDATE', pt_hit: 'PT SMASHED', sell: 'SELL', close: 'CLOSED' };
  async function api(path, method, body) {
    const t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    const go = (tok) => fetch('/academy-activity/trader-alerts' + (path || ''), { method: method || 'GET', headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    try {
      let res = await go(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
      const j = await res.json().catch(() => null); return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' });
    } catch (_) { return { ok: false, error: 'network' }; }
  }
  const nav = (sym) => { if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(sym); };
  const openProfile = (id) => { if (window.smlAcademyProfile && window.smlAcademyProfile.open) void window.smlAcademyProfile.open(id); };
  /* the browser's push permission, through the Academy's push opt-in (academy-pt-notify.js); outside Discord's app only */
  const askPush = () => { try { const n = window.smlAcademyPtNotify; if (n && typeof n.enablePush === 'function') void n.enablePush(); } catch (_) {} };
  const chartSymbol = () => { const i = document.getElementById('symbol'); return i ? String(i.value || '').toUpperCase() : ''; };
  const chartPrice = () => { const p = document.getElementById('price'); const n = p ? Number(String(p.textContent || '').replace(/[^0-9.]/g, '')) : NaN; return Number.isFinite(n) && n > 0 ? n : ''; };

  function rowHtml(a, { own = false, showWho = false } = {}) {
    const m = a.metrics || {};
    let h = '<div class="ac-row' + (a.locked ? ' locked' : '') + (a.status === 'closed' ? ' closed' : '') + '" data-id="' + esc(a.id) + '"><div class="ac-h">'
      + (a.locked ? '<span class="sym lock">🔒 PREMIUM</span>' : '<span class="sym" data-ac="nav" data-sym="' + esc(a.symbol) + '">$' + esc(a.symbol) + '</span>')
      + '<span class="side ' + esc(a.side) + '">' + (a.side === 'short' ? 'SHORT' : 'LONG') + '</span>'
      + '<span class="ch' + (a.premium ? ' prem' : '') + '">' + esc(a.channelName || a.channel) + (a.premium ? ' · premium' : '') + '</span>'
      + (showWho && a.authorId ? '<span class="who" data-ac="profile" data-user="' + esc(a.authorId) + '">' + esc(a.authorName || 'trader') + (a.followed ? ' ✓' : '') + '</span>' : '')
      + (a.status === 'closed' ? '<span class="ch">closed</span>' : '') + '<span class="when">' + esc(ago(a.createdAt)) + '</span></div>';
    h += '<div class="ac-m"><div><span>PEAK SINCE ALERT</span><b class="' + cls(m.peakPct) + '">' + pct(m.peakPct) + '</b></div><div><span>' + (a.status === 'closed' ? 'AT CLOSE' : 'NOW') + '</span><b class="' + cls(m.currentPct) + '">' + pct(m.currentPct) + '</b></div><div><span>TIME TO PEAK</span><b>' + dur(m.timeToPeakMs) + '</b></div><div><span>TARGETS HIT</span><b>' + (m.targetsHit != null ? m.targetsHit + ' / ' + m.targetsTotal : '–') + '</b></div></div>';
    if (a.locked) {
      h += '<div class="ac-lockmsg">Ticker, levels and the thread are for subscribers of this chart.</div>';
    } else {
      h += '<div class="ac-lv"><span>ENTRY ' + esc(a.entry) + '</span>' + (a.targets || []).map((t, i) => '<span class="' + (t.hit ? 'hit' : '') + '">PT' + (i + 1) + ' ' + esc(t.price) + (t.pct != null ? ' (' + pct(t.pct) + ')' : '') + (t.hit ? ' ✓' : '') + '</span>').join('') + (a.stop != null ? '<span class="stop">STOP ' + esc(a.stop) + (a.stopPct != null ? ' (' + pct(a.stopPct) + ')' : '') + '</span>' : '') + (a.closePrice != null ? '<span>CLOSED ' + esc(a.closePrice) + '</span>' : '') + '</div>';
      if (a.note) h += '<div class="ac-note">' + esc(a.note) + '</div>';
      if ((a.updates || []).length) h += '<div class="ac-th">' + a.updates.map((u) => '<div class="ac-u"><i class="' + esc(u.kind) + '">' + (KIND[u.kind] || 'UPDATE') + (u.kind === 'pt_hit' && u.targetIndex != null ? ' PT' + (u.targetIndex + 1) : '') + '</i>' + (u.price != null ? '<b>' + esc(u.price) + '</b> ' : '') + esc(u.body) + '<small>' + esc(ago(u.createdAt)) + '</small></div>').join('') + '</div>';
      if (own && a.status !== 'closed') h += '<div class="ac-acts"><button type="button" class="ac-b" data-ac="upd" data-id="' + esc(a.id) + '" data-kind="pt_hit">PT smashed</button><button type="button" class="ac-b" data-ac="upd" data-id="' + esc(a.id) + '" data-kind="sell">Sell update</button><button type="button" class="ac-b" data-ac="upd" data-id="' + esc(a.id) + '" data-kind="update">Update</button><button type="button" class="ac-b" data-ac="upd" data-id="' + esc(a.id) + '" data-kind="close">Close position</button></div><div class="ac-updslot"></div>';
    }
    return h + '</div>';
  }
  function updateForm(a, kind) {
    const targets = (a.targets || []).map((t, i) => '<option value="' + i + '">PT' + (i + 1) + ' ' + esc(t.price) + (t.hit ? ' (hit)' : '') + '</option>').join('');
    return '<form data-ac-form="update" data-id="' + esc(a.id) + '" data-kind="' + esc(kind) + '">'
      + (kind === 'pt_hit' ? '<label>TARGET<select name="targetIndex">' + targets + '</select></label>' : '')
      + '<label>PRICE' + (kind === 'update' ? ' (optional)' : '') + '<input name="price" type="number" step="0.0001" min="0" placeholder="' + esc(a.last != null ? a.last : '') + '"></label>'
      + '<label class="full">' + (kind === 'close' ? 'CLOSING NOTE' : 'NOTE') + '<textarea name="body" maxlength="1200" placeholder="' + (kind === 'pt_hit' ? 'PT smashed, trimming here…' : kind === 'sell' ? 'Sold a third, trailing the rest…' : kind === 'close' ? 'Out, final read…' : 'What changed…') + '"></textarea></label>'
      + '<div class="btns"><button type="button" class="ac-b acc" data-ac="send-upd">Post ' + esc(KIND[kind].toLowerCase()) + '</button><button type="button" class="ac-b" data-ac="cancel-upd">Cancel</button><span class="msg"></span></div></form>';
  }
  function postForm(settings, pre) {
    const chans = (settings && settings.channels || [{ key: 'main', name: 'Main' }]).map((c) => '<option value="' + esc(c.key) + '">' + esc(c.name) + (c.premium ? ' (premium)' : '') + '</option>').join('');
    return '<form data-ac-form="post"><label>TICKER<input name="symbol" maxlength="10" value="' + esc(pre && pre.symbol || '') + '" placeholder="NVDA" style="text-transform:uppercase"></label>'
      + '<label>SIDE<select name="side"><option value="long">Long</option><option value="short">Short</option></select></label>'
      + '<label>ENTRY<input name="entry" type="number" step="0.0001" min="0" value="' + esc(pre && pre.entry || '') + '"></label>'
      + '<label>TARGETS (comma)<input name="targets" placeholder="110, 115, 120"></label>'
      + '<label>STOP (optional)<input name="stop" type="number" step="0.0001" min="0"></label>'
      + '<label>CHANNEL<select name="channel">' + chans.replace('value="' + esc(pre && pre.channel || '') + '"', 'value="' + esc(pre && pre.channel || '') + '" selected') + '</select></label>'
      + '<label class="full">NOTE<textarea name="note" maxlength="1200" placeholder="Why this alert: the setup, the plan, the risk…"></textarea></label>'
      + '<div class="btns"><button type="button" class="ac-b acc" data-ac="send-post">Post alert</button><button type="button" class="ac-b" data-ac="cancel-post">Cancel</button><span class="msg"></span></div></form>';
  }
  /* GET PAID: the trader's seller status on stockmarketloop.com and, until it is ready, the consents and the Stripe onboarding button */
  function sellerHtml(st) {
    const s = st || {};
    if (s.configured === false) return '<div class="full ac-seller"><h6>GET PAID · stockmarketloop.com</h6><p>Paid subscriptions are not switched on for this Academy yet. Premium channels stay locked to everyone until they are.</p></div>';
    if (s.ready) return '<div class="full ac-seller ok"><h6>GET PAID · stockmarketloop.com</h6><p>✓ Connected. Subscribers pay on stockmarketloop.com; you receive each payment less the 6% processing fee. Subscriptions, refunds and disputes are handled there.</p></div>';
    let h = '<div class="full ac-seller"><h6>GET PAID · stockmarketloop.com</h6>';
    if (!s.linked) h += '<p>Link your Discord to your stockmarketloop.com account first, then come back here.</p><div class="btns"><button type="button" class="ac-b gold" data-ac="site-link" data-url="' + esc(s.connectUrl || 'https://stockmarketloop.com/connect-discord/') + '">Link my stockmarketloop.com account</button></div>';
    else {
      if (s.stripe && s.stripe.connected && !s.stripe.ready) h += '<p>Stripe still needs details from you before you can take paid subscribers. Press the button to continue where you left off.</p>';
      else h += '<p>Premium channels are sold through stockmarketloop.com, the same way it sells Discord group memberships. Tick the terms, then connect Stripe (a few minutes, identity and bank details).</p>';
      if (!s.consented) h += '<label class="ck"><input type="checkbox" name="c_terms"> I accept the stockmarketloop.com seller terms. My alerts are educational content, not financial advice.</label>'
        + '<label class="ck"><input type="checkbox" name="c_fee"> stockmarketloop.com processes every payment and keeps a 6% processing fee; the rest is paid to my Stripe account.</label>'
        + '<label class="ck"><input type="checkbox" name="c_disputes"> If a subscriber disputes a charge, the disputed amount is held back from me, and if the dispute is lost a dispute fee of 15% of the disputed amount is paid to stockmarketloop.com. Both may be debited from my Stripe balance.</label>'
        + '<label class="ck"><input type="checkbox" name="c_activity"> I will keep my chart active. A chart with no alert or update for more than 30 days is treated as not fulfilling the subscription, which gives me low chances of winning a dispute.</label>';
      h += '<div class="btns"><button type="button" class="ac-b gold" data-ac="stripe-connect">' + (s.stripe && s.stripe.connected ? 'Continue Stripe setup' : 'Get paid with Stripe') + '</button><span class="msg"></span></div>';
    }
    return h + '</div>';
  }
  function settingsForm(s, seller) {
    const chans = (s.channels || []).concat(s.channels.length < 6 ? [{ key: '', name: '', premium: false }] : []);
    return '<form class="ac-set" data-ac-form="settings"><div class="full chs"><h6>CHANNELS · tick premium to sell access</h6>' + chans.map((c, i) => '<label><input type="checkbox" name="prem' + i + '"' + (c.premium ? ' checked' : '') + '> premium <input type="text" name="ch' + i + '" maxlength="40" value="' + esc(c.name) + '" placeholder="' + (i === chans.length - 1 && !c.name ? 'New channel name' : '') + '"></label>').join('') + '</div>'
      + '<div class="full"><h6>PREMIUM PRICES · what a subscriber pays on stockmarketloop.com (you receive it less the 6% processing fee)</h6></div>'
      + PLANS.map(([k, l]) => '<label>' + l.toUpperCase() + ' (USD)<input name="price_' + k + '" type="number" step="0.01" min="0" value="' + ((s.prices && s.prices[k]) ? (s.prices[k] / 100).toFixed(2) : '') + '" placeholder="0 = not offered"></label>').join('')
      + '<label class="full">ABOUT THIS CHART<textarea name="about" maxlength="400" placeholder="What you post, how often, your style…">' + esc(s.about || '') + '</textarea></label>'
      + sellerHtml(seller)
      + '<div class="btns"><button type="button" class="ac-b acc" data-ac="save-set">Save</button><button type="button" class="ac-b" data-ac="cancel-set">Cancel</button><span class="msg"></span></div></form>';
  }
  const openOut = (url) => { if (!url) return; if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };

  function chartHtml(d, host) {
    const o = (mounts.get(host) || {}).opts || {};
    if (o.channel) { // one room channel: just its alerts (a trading room channel of type alerts), plus the owner's post button
      const list = d.alerts.filter((a) => a.channel === o.channel);
      return (d.viewer.own ? '<div class="ac-top"><span class="sp"></span><button type="button" class="ac-b acc" data-ac="new">+ Post alert</button></div>' : '') + '<div class="ac-slot"></div>'
        + (list.length ? list.map((a) => rowHtml(a, { own: d.viewer.own })).join('') : '<div class="ac-empty">' + (d.viewer.own ? 'No alerts in this channel yet. Post your first one: ticker, entry, targets, stop and why.' : 'No alerts in this channel yet.') + '</div>');
    }
    const t = d.trader, v = d.viewer, s = t.settings || {};
    const prices = PLANS.filter(([k]) => s.prices && s.prices[k] > 0);
    let h = '<div class="ac-top"><h6 style="margin:0">ALERT CHART</h6>'
      + '<span class="ac-stat"><span>ALERTS</span><b>' + t.alerts + '</b></span><span class="ac-stat"><span>OPEN</span><b>' + t.open + '</b></span><span class="ac-stat"><span>WIN RATE</span><b>' + (t.winRatePct == null ? '–' : t.winRatePct + '%') + '</b></span><span class="ac-stat"><span>AVG PEAK</span><b class="' + cls(t.avgPeakPct) + '">' + pct(t.avgPeakPct) + '</b></span><span class="ac-stat"><span>FOLLOWERS</span><b>' + t.followers + '</b></span>'
      + '<span class="ac-stat"><span>STATUS</span><b class="' + (t.active ? 'up' : 'dn') + '">' + (t.active ? 'active' : t.lastPostAt ? 'quiet ' + t.inactiveDays + 'd' : 'no posts') + '</b></span><span class="sp"></span>';
    if (v.own) h += '<button type="button" class="ac-b acc" data-ac="new">+ Post alert</button><button type="button" class="ac-b" data-ac="settings">⚙ Channels &amp; prices</button>';
    else {
      h += '<button type="button" class="ac-b' + (v.following ? ' on' : ' acc') + '" data-ac="follow">' + (v.following ? '✓ Following chart' : '+ Follow chart') + '</button>';
      if (v.following) h += '<button type="button" class="ac-b' + (v.push ? ' on' : '') + '" data-ac="push" title="A push the moment a new alert or update lands">' + (v.push ? '🔔 Push on' : '🔕 Push off') + '</button>';
      if (s.premium) h += v.access && v.access.ok ? '<button type="button" class="ac-b on" disabled>★ Subscribed' + (v.access.until ? ' until ' + new Date(v.access.until).toLocaleDateString() : '') + '</button>' : '<button type="button" class="ac-b gold" data-ac="subscribe">★ Subscribe</button>';
    }
    h += '</div>';
    if (s.about) h += '<p style="margin:0 0 8px;color:#9fb3be">' + esc(s.about) + '</p>';
    if (!v.own && s.premium && !(v.access && v.access.ok) && host.dataset.showPlans) h += '<div class="ac-plans">' + (prices.length ? prices.map(([k, l]) => '<button type="button" data-ac="checkout" data-plan="' + k + '">' + l + ' · ' + money(s.prices[k]) + '</button>').join('') : '<span style="color:#7f98a6">No prices set yet.</span>') + '</div><p style="margin:4px 0 8px;color:#7f98a6;font-size:.6rem">Paid on stockmarketloop.com, which handles subscriptions, refunds and disputes. Educational content, not advice.</p>';
    h += '<div class="ac-slot"></div>';
    h += d.alerts.length ? d.alerts.map((a) => rowHtml(a, { own: v.own })).join('') : '<div class="ac-empty">' + (v.own ? 'No alerts yet. Post your first one: ticker, entry, targets, stop and why.' : 'No alerts on this chart yet.') + '</div>';
    return h;
  }
  function feedHtml(d, host) {
    let h = '<div class="ac-cm"></div><div class="ac-top"><h6 style="margin:0">TRADERS’ ALERT CHARTS</h6><span class="sp"></span><button type="button" class="ac-b acc" data-ac="new" title="Post to your own Alert Chart, starting from the chart on screen">+ Post alert</button><button type="button" class="ac-b" data-ac="mine">My chart</button></div><div class="ac-slot"></div>';
    h += d.alerts.length ? d.alerts.map((a) => rowHtml(a, { own: false, showWho: true })).join('') : '<div class="ac-empty">No trader alerts yet. Follow a trader’s Alert Chart from their profile, or post your own.</div>';
    return h;
  }

  /* mount(host, { traderId }) renders one trader's chart; mount(host, { feed: true }) renders the member's feed */
  const mounts = new WeakMap();
  async function mount(host, opts = {}) {
    if (!host) return;
    const st = mounts.get(host) || { opts, data: null, settings: null };
    st.opts = opts; mounts.set(host, st);
    host.classList.add('ac');
    if (!token()) { host.innerHTML = '<div class="ac-empty">Sign in to the Academy to see Alert Charts.</div>'; return; }
    host.innerHTML = '<div class="ac-empty">Loading alerts…</div>';
    const r = opts.feed ? await api('/feed') : await api('?user=' + encodeURIComponent(opts.traderId || ''));
    if (!r.ok) { host.innerHTML = '<div class="ac-empty">' + esc(r.error === 'alert_chart_disabled' ? 'Alert Charts are switched off right now.' : 'Could not load alerts (' + (r.error || 'error') + ').') + '</div>'; return; }
    st.data = r;
    host.innerHTML = opts.feed ? feedHtml(r, host) : chartHtml(r, host);
    if (opts.feed && window.smlCommunity) void window.smlCommunity.strip(host.querySelector('.ac-cm'), { title: 'TRADERS TO FOLLOW', limit: 8 });
    if (!host.__acBound) { host.__acBound = true; bind(host); }
  }
  const refresh = (host) => { const st = mounts.get(host); if (st) return mount(host, st.opts); };
  function bind(host) {
    host.addEventListener('click', async (e) => {
      const b = e.target.closest ? e.target.closest('[data-ac]') : null; if (!b || !host.contains(b)) return;
      const st = mounts.get(host) || {}; const d = st.data || {}; const act = b.dataset.ac;
      const slot = host.querySelector('.ac-slot');
      if (act === 'nav') { nav(b.dataset.sym); return; }
      if (act === 'profile') { openProfile(b.dataset.user); return; }
      if (act === 'mine') { openProfile(''); return; }
      if (act === 'new') { const s = st.settings || (await api('/settings')).settings; st.settings = s; slot.innerHTML = postForm(s, st.opts.feed ? { symbol: chartSymbol(), entry: chartPrice() } : { channel: st.opts.channel || '' }); slot.querySelector('input[name=symbol]').focus(); return; }
      if (act === 'cancel-post' || act === 'cancel-set') { slot.innerHTML = ''; return; }
      if (act === 'settings') { const [sr, seller] = await Promise.all([api('/settings'), api('/seller')]); const s = sr.settings || st.settings; st.settings = s; st.seller = seller; slot.innerHTML = settingsForm(s, seller); return; }
      if (act === 'site-link') { openOut(b.dataset.url); toast('Link your Discord on stockmarketloop.com, then open Channels & prices again.'); return; }
      if (act === 'stripe-connect') {
        const f = b.closest('form'), msg = f.querySelector('.ac-seller .msg'); const ck = (n) => { const i = f.querySelector('[name=' + n + ']'); return i ? i.checked : true; };
        if (!(ck('c_terms') && ck('c_fee') && ck('c_disputes') && ck('c_activity'))) { msg.textContent = 'Tick every line to continue.'; return; }
        b.disabled = true; const r = await api('/seller', 'POST', { terms: true, fee: true, disputes: true, activity: true }); b.disabled = false;
        if (r.ok && r.url) { openOut(r.url); toast('Stripe onboarding opened. Finish it there, then come back: your chart can take paid subscribers.'); return; }
        if (r.error === 'site_not_linked') { openOut(r.connectUrl); msg.textContent = 'Link your stockmarketloop.com account first (opened).'; return; }
        msg.textContent = { academy_access_required: 'Selling is for Academy members.', billing_unconfigured: 'Paid subscriptions are not switched on yet.', consent_required: 'Tick every line to continue.' }[r.error] || 'Could not start Stripe setup (' + (r.error || 'error') + ').'; return;
      }
      if (act === 'send-post') {
        const f = b.closest('form'), msg = f.querySelector('.msg'); const g = (n) => f.querySelector('[name=' + n + ']').value;
        b.disabled = true;
        const r = await api('', 'POST', { symbol: g('symbol'), side: g('side'), entry: g('entry'), targets: g('targets'), stop: g('stop'), channel: g('channel'), note: g('note') });
        b.disabled = false;
        if (!r.ok) { msg.textContent = { invalid_symbol: 'Check the ticker.', invalid_entry: 'Entry must be a price.', targets_required: 'Add at least one target.', targets_wrong_side: 'Targets must be beyond the entry for that side.', stop_wrong_side: 'The stop must be on the losing side of the entry.', academy_access_required: 'Alert Charts are for Academy members.', rate_limited: 'Slow down a little.' }[r.error] || 'Could not post (' + (r.error || 'error') + ').'; return; }
        slot.innerHTML = ''; await refresh(host); toast('Alert posted to your chart' + (st.opts.feed ? '; it shows in the feed and on your profile.' : '.')); return;
      }
      if (act === 'upd') {
        const row = b.closest('.ac-row'), a = (d.alerts || []).find((x) => x.id === b.dataset.id); if (!row || !a) return;
        row.querySelector('.ac-updslot').innerHTML = updateForm(a, b.dataset.kind); return;
      }
      if (act === 'cancel-upd') { const f = b.closest('form'); if (f) f.remove(); return; }
      if (act === 'send-upd') {
        const f = b.closest('form'), msg = f.querySelector('.msg'); const body = { kind: f.dataset.kind, body: f.querySelector('[name=body]').value, price: f.querySelector('[name=price]').value };
        if (f.dataset.kind === 'pt_hit') body.targetIndex = Number(f.querySelector('[name=targetIndex]').value);
        b.disabled = true; const r = await api('/' + encodeURIComponent(f.dataset.id) + '/update', 'POST', body); b.disabled = false;
        if (!r.ok) { msg.textContent = { body_required: 'Write the update.', invalid_target: 'Pick a target.', already_closed: 'This alert is closed.' }[r.error] || 'Could not post (' + (r.error || 'error') + ').'; return; }
        await refresh(host); return;
      }
      if (act === 'save-set') {
        const f = b.closest('form'), msg = f.querySelector('.msg');
        const channels = []; for (let i = 0; i < 7; i++) { const n = f.querySelector('[name=ch' + i + ']'); if (!n) break; const name = n.value.trim(); if (name) channels.push({ name, premium: f.querySelector('[name=prem' + i + ']').checked }); }
        const prices = {}; for (const [k] of PLANS) { const v = Number(f.querySelector('[name=price_' + k + ']').value); prices[k] = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0; }
        b.disabled = true; const r = await api('/settings', 'POST', { channels, prices, about: f.querySelector('[name=about]').value }); b.disabled = false;
        if (!r.ok) { msg.textContent = 'Could not save.'; return; }
        st.settings = r.settings; await refresh(host); toast('Alert Chart settings saved.'); return;
      }
      if (act === 'follow') {
        const on = !(d.viewer && d.viewer.following);
        const r = await api('/follow', 'POST', { trader: d.trader.id, on, push: on ? true : null });
        if (r.ok) { await refresh(host); toast(on ? 'Following this Alert Chart. Push is on for new alerts.' : 'Unfollowed this chart.'); if (on) askPush(); }
        return;
      }
      if (act === 'push') { const r = await api('/follow', 'POST', { trader: d.trader.id, on: true, push: !(d.viewer && d.viewer.push) }); if (r.ok) { await refresh(host); if (r.push) askPush(); } return; }
      if (act === 'subscribe') { host.dataset.showPlans = '1'; host.innerHTML = chartHtml(d, host); host.querySelector('.ac-plans') && host.querySelector('.ac-plans').scrollIntoView({ block: 'nearest' }); return; }
      if (act === 'checkout') {
        b.disabled = true; const r = await api('/checkout', 'POST', { trader: d.trader.id, plan: b.dataset.plan }); b.disabled = false;
        if (r.ok && r.url) { openOut(r.url); toast('Checkout opened on stockmarketloop.com. Your access turns on here once it is paid.'); }
        else toast({ checkout_unavailable: 'Premium checkout is not connected yet. Ask the trader how to subscribe for now.', seller_not_ready: 'This trader has not finished setting up payouts on stockmarketloop.com yet.', plan_not_offered: 'That plan is not offered on this chart.', own_chart: 'That is your own chart.', rate_limited: 'Slow down a little.' }[r.error] || 'Could not start checkout (' + (r.error || 'error') + ').');
      }
    });
  }
  function toast(text) { let t = document.getElementById('ac-toast'); if (!t) { t = document.createElement('div'); t.id = 'ac-toast'; t.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483400;max-width:min(92vw,520px);padding:9px 14px;border-radius:10px;background:#0d2318;border:1px solid #2d5a3f;color:#dffbee;font:700 .7rem system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)'; document.body.appendChild(t); } t.textContent = text; t.style.display = 'block'; clearTimeout(t.__h); t.__h = setTimeout(() => { t.style.display = 'none'; }, 3200); }
  window.smlAlertChart = { mount, refresh, rowHtml, api };
})();
