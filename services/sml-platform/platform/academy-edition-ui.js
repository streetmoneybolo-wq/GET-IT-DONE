/* Editions for the Academy Live Chart Lab: a TRADER / ANALYST button on the toolbar and its card. A Trader sees the market tools;
   an Analyst also gets the publishing side (Click-to-Alert into their server, the ARTICLE button, the Alert Chart seller tools) and
   the checklist that unlocks it: the stockmarketloop.com account link, their own Discord bot for the alerts (token pasted here,
   stored encrypted on the server, never shown again), the seller setup. The choice is saved on the server (/academy-activity/edition)
   and mirrored in localStorage so the page opens in the right edition before the first answer arrives. */
(function boot(tries) {
  if (window.__smlEditionUi) return;
  if (!document.querySelector('.toolbar')) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlEditionUi = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toolbar = document.querySelector('.toolbar');
  const KEY = 'sml-edition-v1';
  const S = { edition: 'trader', open: false, data: null, busy: false, msg: '', loaded: '' };
  try { const v = localStorage.getItem(KEY); if (v === 'analyst' || v === 'trader') S.edition = v; } catch (_) { /* storage can be blocked */ }

  const css = document.createElement('style');
  css.textContent = '#edition-btn{margin-left:4px;padding:5px 9px;border:1px solid #8a6a1f;border-radius:7px;background:#2a1f0b;color:#ffd166;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#edition-btn.analyst{border-color:#c879ff;background:#1d0f2a;color:#e4c6ff}'
    + '#edition-card{position:fixed;right:12px;top:58px;z-index:2147483300;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;background:#0a101a;border:1px solid #3a3160;border-radius:12px;color:#dbe6ec;font:600 .68rem/1.45 system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.6);display:none}'
    + '#edition-card header{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #2a2547}#edition-card header b{font:800 .7rem ui-monospace,monospace;letter-spacing:.06em;color:#e4c6ff}#edition-card header span{margin-left:auto;cursor:pointer;color:#8fa6b3;padding:0 4px}'
    + '#edition-card .pick{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 11px}#edition-card .pick button{padding:10px 8px;border:1px solid #2c3a52;border-radius:10px;background:#121a28;color:#c9d6de;text-align:left;cursor:pointer}#edition-card .pick button b{display:block;font:800 .72rem ui-monospace,monospace;letter-spacing:.05em;margin-bottom:3px}#edition-card .pick button.on{border-color:#c879ff;background:#1d0f2a;color:#f1e6ff}#edition-card .pick button.on.trader{border-color:#ffd166;background:#2a1f0b;color:#fff3d6}'
    + '#edition-card h6{margin:0;padding:8px 11px 4px;font:800 .6rem ui-monospace,monospace;letter-spacing:.08em;color:#8fa6b3}#edition-card ul{list-style:none;margin:0;padding:0 11px 8px}#edition-card li{margin:0 0 7px;padding:7px 9px;border-radius:9px;background:#0f1622;border:1px solid #1f2a3a}#edition-card li.done{border-color:#1f8a5f}#edition-card li b{display:block;color:#e6eef2}#edition-card li b::before{content:"○ ";color:#8fa6b3}#edition-card li.done b::before{content:"● ";color:#00d084}#edition-card li small{display:block;color:#9fb3bd;font-weight:500}#edition-card li a{color:#7dd3ff}'
    + '#edition-card .bot{padding:0 11px 10px}#edition-card .bot .who{display:flex;align-items:center;gap:8px;margin:0 0 6px}#edition-card .bot img{width:28px;height:28px;border-radius:50%}#edition-card input{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #2c3a52;border-radius:8px;background:#0b1119;color:#e6eef2;font:600 .66rem ui-monospace,monospace}#edition-card .row{display:flex;gap:6px;margin-top:6px}#edition-card .row button,#edition-card .row a{flex:1;padding:7px 8px;border:1px solid #3a3160;border-radius:8px;background:#17112a;color:#cdb6ff;font:800 .62rem ui-monospace,monospace;letter-spacing:.05em;cursor:pointer;text-align:center;text-decoration:none}#edition-card .row button.danger{border-color:#5a2733;color:#ff8ea1;background:#2a0f16}'
    + '#edition-card .msg{padding:0 11px 8px;color:#ffd166;font-weight:600}#edition-card .note{padding:0 11px 10px;color:#6f8794;font-weight:500;font-size:.56rem}'
    + 'body.sml-edition-trader #click-alert-toggle,body.sml-edition-trader #article-btn{display:none!important}'
    + '@media(max-width:700px){#edition-card{right:6px;left:6px;width:auto;top:auto;bottom:60px;max-height:70vh}}';
  document.head.appendChild(css);
  const apply = () => { document.body.classList.toggle('sml-edition-analyst', S.edition === 'analyst'); document.body.classList.toggle('sml-edition-trader', S.edition !== 'analyst'); btn.textContent = S.edition === 'analyst' ? 'ANALYST' : 'TRADER'; btn.classList.toggle('analyst', S.edition === 'analyst'); };

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'edition-btn'; btn.title = 'Edition: Trader (the market tools) or Analyst (plus publishing: your trading room, Click-to-Alert, your own bot, the Article Desk)'; toolbar.appendChild(btn);
  const card = document.createElement('aside'); card.id = 'edition-card'; card.setAttribute('aria-label', 'Academy edition'); document.body.appendChild(card);
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => card.addEventListener(ev, (e) => e.stopPropagation()));
  apply();

  const token = () => window.smlAcademySessionToken || '';
  async function api(path, method, body) {
    let t = token(); if (!t) return { ok: false, error: 'no_session' };
    const go = (tok) => fetch('/academy-activity/' + path, { method: method || 'GET', headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    try {
      let res = await go(t);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
      const j = await res.json().catch(() => null);
      return j || { ok: false, error: 'bad_answer', status: res.status };
    } catch (_) { return { ok: false, error: 'no_connection' }; }
  }
  async function load(force) {
    const t = token(); if (!t || (!force && S.loaded === t)) return;
    const r = await api('edition');
    if (r && r.ok) { S.loaded = t; S.data = r; if (r.edition === 'analyst' || r.edition === 'trader') { S.edition = r.edition; try { localStorage.setItem(KEY, S.edition); } catch (_) { /* ignore */ } } apply(); }
    if (S.open) paint();
  }
  async function choose(edition) {
    if (S.busy || edition === S.edition) return;
    S.busy = true; S.msg = '';
    const r = await api('edition', 'POST', { edition });
    S.busy = false;
    if (r && r.ok) { S.edition = r.edition; try { localStorage.setItem(KEY, S.edition); } catch (_) { /* ignore */ } apply(); await load(true); if (window.smlToolRail && window.smlToolRail.collect) { try { window.smlToolRail.collect(); } catch (_) { /* ignore */ } } }
    else S.msg = r && r.error === 'academy_access_required' ? 'The Analyst edition needs Academy access.' : 'Could not save the edition' + (r && r.error ? ' (' + r.error + ')' : '') + '.';
    paint();
  }
  async function saveBot() {
    const input = card.querySelector('input[data-token]'); const v = input ? String(input.value || '').trim() : '';
    if (!v) { S.msg = 'Paste the bot token first.'; paint(); return; }
    S.busy = true; S.msg = 'Checking the token with Discord...'; paint();
    const r = await api('persona', 'POST', { token: v });
    S.busy = false;
    S.msg = r && r.ok ? 'Saved. ' + (r.bot && r.bot.username ? r.bot.username : 'Your bot') + ' now carries your alerts where it is in the server.' : (r && r.detail) || 'Could not save the bot' + (r && r.error ? ' (' + r.error + ')' : '') + '.';
    await load(true); paint();
  }
  async function removeBot() {
    S.busy = true; const r = await api('persona', 'DELETE'); S.busy = false;
    S.msg = r && r.ok ? 'Removed. The StockMarketLoop Connect bot carries your alerts again.' : 'Could not remove the bot.';
    await load(true); paint();
  }

  function paint() {
    card.style.display = S.open ? 'block' : 'none';
    if (!S.open) return;
    const d = S.data, a = d && d.analyst ? d.analyst : null, eds = d && d.editions ? d.editions : null;
    const pick = (k, label, blurb) => '<button type="button" data-pick="' + k + '" class="' + (S.edition === k ? 'on ' + k : '') + '"><b>' + esc(label) + '</b>' + esc(blurb) + '</button>';
    let html = '<header><b>EDITION</b><span data-close="1" title="Close">&#10005;</span></header><div class="pick">'
      + pick('trader', 'TRADER', eds ? eds.trader.blurb : 'The chart, the desks, the alerts and the rooms you follow.')
      + pick('analyst', 'ANALYST', eds ? eds.analyst.blurb : 'Trader plus the publishing side.') + '</div>';
    if (S.msg) html += '<div class="msg">' + esc(S.msg) + '</div>';
    if (S.edition === 'analyst') {
      if (!a) html += '<div class="note">Loading your analyst setup...</div>';
      else {
        html += '<h6>ANALYST SETUP</h6><ul>' + a.steps.map((s) => '<li class="' + (s.done ? 'done' : '') + '"><b>' + esc(s.label) + (s.optional && !s.done ? ' <small style="display:inline;color:#6f8794">optional</small>' : '') + '</b><small>' + esc(s.detail) + (s.url && !s.done ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener">Connect now &#8599;</a>' : '') + '</small></li>').join('') + '</ul>';
        const b = a.bot;
        html += '<h6>YOUR BOT FOR THE ALERTS</h6><div class="bot">';
        if (b && b.available && b.bot) {
          html += '<div class="who">' + (b.bot.avatar ? '<img src="' + esc(b.bot.avatar) + '" alt="">' : '') + '<div><b>' + esc(b.bot.username || 'Your bot') + '</b><small style="color:#9fb3bd;display:block">' + (b.own === 'owner' ? 'Set on the server by the owner.' : 'In ' + (b.guilds ? b.guilds.length : 0) + ' server' + (b.guilds && b.guilds.length === 1 ? '' : 's') + ' you are also in' + (b.guilds && b.guilds.length ? ': ' + esc(b.guilds.slice(0, 4).map((g) => g.name).join(', ')) : '') + '.') + '</small></div></div>';
          if (b.own !== 'owner') html += '<div class="row">' + (b.inviteUrl ? '<a href="' + esc(b.inviteUrl) + '" target="_blank" rel="noopener">Invite it to a server &#8599;</a>' : '') + '<button type="button" data-remove="1" class="danger"' + (S.busy ? ' disabled' : '') + '>Remove my bot</button></div>';
        } else if (b && !b.configured) {
          html += '<small style="color:#9fb3bd">Storing a bot token is not set up on this server yet (the owner sets SML_PERSONA_ENCRYPTION_KEY). Until then the StockMarketLoop Connect bot posts your alerts.</small>';
        } else {
          html += '<small style="color:#9fb3bd;display:block;margin-bottom:6px">Make a bot in the Discord Developer Portal (Applications, New Application, Bot), copy its token and paste it here. It is checked with Discord, stored encrypted and never shown again. Then invite it to your server with the link that appears.</small>'
            + '<input type="password" data-token="1" placeholder="Bot token" autocomplete="off" spellcheck="false"><div class="row"><button type="button" data-save="1"' + (S.busy ? ' disabled' : '') + '>Save my bot</button></div>';
        }
        html += '</div>';
        html += '<div class="note">Without your own bot, the StockMarketLoop Connect bot posts your alerts: invite it to your server and let it view, post and attach files in your alert channels. Alerts are members\' opinions, not advice; nothing here places a trade.</div>';
      }
    } else html += '<div class="note">Switch to ANALYST to run your own trading room, post Click-to-Alert into your server, sell premium channels and write letters.</div>';
    if (window.smlAcademySeats) {
      const held = window.smlAcademySeats.held();
      html += '<h6>FOR YOUR SERVER</h6><div class="note" style="padding-bottom:4px">Put the members you choose on Trader: seats, by the month, one price each. You pick who sits in them, and you can move a seat to someone else at any time.</div>'
        + '<div class="row"><button type="button" data-seats="1">' + (held ? 'Team seats &#183; ' + held.used + '/' + held.seats : 'Buy team seats') + '</button></div>';
    }
    card.innerHTML = html;
  }
  card.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick],[data-close],[data-save],[data-remove],[data-seats]'); if (!t) return;
    if (t.dataset.close) { S.open = false; paint(); return; }
    if (t.dataset.seats) { S.open = false; paint(); window.smlAcademySeats.open(); return; }
    if (t.dataset.pick) { void choose(t.dataset.pick); return; }
    if (t.dataset.save) { void saveBot(); return; }
    if (t.dataset.remove) { void removeBot(); }
  });
  btn.addEventListener('click', () => { S.open = !S.open; S.msg = ''; paint(); if (S.open) void load(false); });
  document.addEventListener('pointerdown', (e) => { if (S.open && !card.contains(e.target) && e.target !== btn) { S.open = false; paint(); } }, true);
  window.addEventListener('sml-academy-market', () => { void load(false); });
  setTimeout(() => { void load(false); }, 1200);
  window.smlEdition = { get: () => S.edition, open: () => { S.open = true; paint(); void load(false); }, reload: () => load(true) };
})(0);
