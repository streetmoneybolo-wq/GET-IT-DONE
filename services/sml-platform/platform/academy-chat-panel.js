/* The Academy trading-desk chat panel: injected into the Activity page below the options chain
 * lab, next to the scanner. A Global room (the default) plus four switchable topic channels (Day
 * Trade, Swing Trade, Short Sale, Options Trading) over the WebSocket at /academy-activity/chat
 * (see academy-chat.js on the server). This
 * file only renders and wires the socket — every rule (length cap, rate limit, who can delete
 * what) is enforced server-side; this is trust-but-verify UI, not the source of truth. */
(() => {
  if (window.__smlAcademyChatPanel) return;
  window.__smlAcademyChatPanel = 1;

  const CHANNELS = [['global', 'Global Chat'], ['day', 'Day Trade'], ['swing', 'Swing Trade'], ['short', 'Short Sale'], ['options', 'Options Trading']];

  const style = document.createElement('style');
  style.textContent = '.academy-chat{border:1px solid #1b3540;border-radius:10px;background:#0a1118;margin-top:18px;overflow:hidden}'
    + '.academy-chat-tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid #1b3540;flex-wrap:wrap;align-items:center}'
    + '.academy-chat-tabs button{border:1px solid #294554;border-radius:5px;background:#101e27;color:#9eb2bc;padding:6px 10px;font:800 .68rem ui-monospace;cursor:pointer}'
    + '.academy-chat-tabs button.on{border-color:#00c47d;background:#0b3b2e;color:#7ef0bd}'
    + '.academy-chat-status{margin-left:auto;color:#8fa5b1;font:700 .6rem ui-monospace}'
    + '.academy-chat-log{height:280px;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px}'
    + '.academy-chat-empty{color:#5d7085;font:.68rem system-ui;padding:8px 0}'
    + '.academy-chat-msg{font:.72rem/1.4 system-ui;color:#dfe9ee;word-break:break-word}'
    + '.academy-chat-msg b{color:#7ef0bd;margin-right:6px}'
    + '.academy-chat-msg time{color:#5d7085;font-size:.6rem;margin-left:6px}'
    + '.academy-chat-msg .del{background:none;border:0;color:#5d7085;cursor:pointer;margin-left:6px;font-size:.62rem;padding:0}'
    + '.academy-chat-msg .del:hover{color:#ff778b}.academy-chat-msg .rep{background:none;border:0;color:#5d7085;cursor:pointer;margin-left:6px;font-size:.62rem;padding:0}.academy-chat-msg .rep:hover{color:#ffd166}.academy-chat-msg .rep:disabled{color:#3a4a56;cursor:default}'
    + '.academy-chat-muted{color:#5d7085;font:.62rem system-ui;padding:4px 12px;border-top:1px solid #16303e}.academy-chat-muted button{background:none;border:0;color:#7ef0bd;cursor:pointer;font:inherit;text-decoration:underline;margin-left:4px}'
    + '.academy-chat-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #1b3540}'
    + '.academy-chat-form input{flex:1;background:#0d1720;border:1px solid #294554;border-radius:6px;color:#eaf5f8;padding:8px 10px;font:.72rem system-ui;min-width:0}'
    + '.academy-chat-form button{border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:900;padding:8px 14px;cursor:pointer}'
    + '.academy-chat-msg .ava{display:inline-block;width:20px;height:20px;border-radius:50%;margin-right:6px;vertical-align:-5px;background:#17303b;color:#7ef0bd;font:800 .6rem/20px system-ui;text-align:center;overflow:hidden;cursor:pointer;object-fit:cover}'
    + '.academy-chat-msg .nm{color:#7ef0bd;font-weight:700;margin-right:6px;cursor:pointer}.academy-chat-msg .nm:hover{text-decoration:underline}'
    + '#academy-profile-card{position:fixed;z-index:2147483300;width:min(300px,calc(100vw - 16px));background:#0a1118;border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.65);color:#dbe6ec;font:600 .68rem/1.4 system-ui,sans-serif;overflow:hidden}'
    + '#academy-profile-card .bn{height:46px;background:linear-gradient(135deg,#0b3b2e,#13293a)}#academy-profile-card .hd{display:flex;gap:10px;align-items:flex-end;margin:-24px 12px 0}'
    + '#academy-profile-card .big{width:56px;height:56px;border-radius:50%;border:3px solid #0a1118;background:#17303b;object-fit:cover;flex:none}#academy-profile-card .who{padding-bottom:2px;min-width:0}#academy-profile-card .who b{display:block;font:800 .82rem system-ui;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#academy-profile-card .who span{color:#8fa5b1;font-weight:600}'
    + '#academy-profile-card .sec{margin:10px 12px 0;padding-top:8px;border-top:1px solid #16303e}#academy-profile-card .sec h6{margin:0 0 5px;font:800 .56rem ui-monospace,monospace;letter-spacing:.08em;color:#7ef0bd}'
    + '#academy-profile-card .btns{display:flex;flex-wrap:wrap;gap:6px}#academy-profile-card button{border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;padding:6px 9px;font:800 .64rem system-ui;cursor:pointer}#academy-profile-card button.go{background:#00c47d;border-color:#7dffc4;color:#032318}#academy-profile-card button.dc{background:#5865f2;border-color:#8e98ff;color:#fff}#academy-profile-card button:hover{filter:brightness(1.12)}'
    + '#academy-profile-card .note{color:#7f95a1;font-weight:500;margin:4px 0 0}#academy-profile-card .ft{margin:10px 12px 12px;color:#6f8794;font-weight:500;font-size:.54rem}'
    + '@media(max-width:720px){.academy-chat-log{height:220px}}';
  document.head.appendChild(style);

  const section = document.createElement('section');
  section.className = 'academy-chat';
  section.innerHTML = '<div class="academy-chat-tabs"></div><div class="academy-chat-log"><p class="academy-chat-empty">Connecting…</p></div>'
    + '<form class="academy-chat-form"><input maxlength="500" placeholder="Message the desk…" autocomplete="off"><button type="submit">Send</button></form>';
  const tabsEl = section.querySelector('.academy-chat-tabs');
  const mutedEl = document.createElement('div'); mutedEl.className = 'academy-chat-muted'; mutedEl.style.display = 'none'; section.insertBefore(mutedEl, section.querySelector('form'));
  const status = document.createElement('span'); status.className = 'academy-chat-status'; status.textContent = 'CONNECTING';
  const logEl = section.querySelector('.academy-chat-log');
  const form = section.querySelector('form');
  const input = section.querySelector('input');

  const buttons = new Map();
  for (const [key, label] of CHANNELS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.channel = key;
    b.onclick = () => join(key);
    tabsEl.appendChild(b);
    buttons.set(key, b);
  }
  tabsEl.appendChild(status);

  function place() {
    if (section.isConnected) return;
    const host = document.getElementById('academy-below');
    if (host) host.appendChild(section);
  }
  place();
  if (!section.isConnected) {
    const observer = new MutationObserver(() => { place(); if (section.isConnected) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const NAME_KEY = 'sml-academy-chat-name';
  /* Prefers the member's real Discord display name (fetched server-side during sign-in, see
     academy-oauth.js's fetchDisplayName); only asks for a self-chosen nickname when that is
     unavailable (the name lookup failed, or this session predates the feature). */
  function displayName() {
    const real = String(window.smlAcademyDisplayName || '').trim();
    if (real) return real.slice(0, 40);
    let name = ''; try { name = localStorage.getItem(NAME_KEY) || ''; } catch (_) { /* private mode etc. */ }
    if (!name) {
      try { name = (window.prompt('Pick a display name for the trading-desk chat (other members will see it):', '') || '').trim().slice(0, 40); } catch (_) { /* ignore */ }
      if (name) { try { localStorage.setItem(NAME_KEY, name); } catch (_) { /* ignore */ } }
    }
    return name || 'Member';
  }
  /* Reads the member id out of the session token purely to decide whether to show a delete
     button on a message — cosmetic only. The server independently enforces who may actually
     delete what; nothing here is a security check. */
  function selfIdFromToken(token) {
    try {
      const part = String(token || '').split('.')[1] || '';
      const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
      const json = decodeURIComponent(Array.from(bin).map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
      return String(JSON.parse(json).u || '');
    } catch (_) { return ''; }
  }

  /* Muting is a per-viewer choice kept in this browser: it hides a member's messages from you and tells the server nothing. */
  const MUTE_KEY = 'sml-academy-chat-muted';
  let muted = {}; try { muted = JSON.parse(localStorage.getItem(MUTE_KEY) || '{}') || {}; } catch (_) { muted = {}; }
  const saveMuted = () => { try { localStorage.setItem(MUTE_KEY, JSON.stringify(muted)); } catch (_) { /* ignore */ } };
  function paintMuted() {
    const ids = Object.keys(muted);
    mutedEl.style.display = ids.length ? '' : 'none';
    mutedEl.innerHTML = ids.length ? 'Muted: ' + ids.map((id) => escapeHtml(muted[id]) + '<button type="button" data-unmute="' + escapeHtml(id) + '">unmute</button>').join(' · ') : '';
  }
  mutedEl.onclick = (e) => { const id = e.target && e.target.dataset && e.target.dataset.unmute; if (id) { delete muted[id]; saveMuted(); paintMuted(); if (current) join(current); } };
  let ws = null, current = null, queue = [], selfId = '';
  const escapeHtml = (s) => { const d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; };
  const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

  /* ---------- avatars and the profile card ---------- */
  const avatarCache = new Map(), cardCache = new Map();
  const authHeaders = () => ({ authorization: 'Bearer ' + String(window.smlAcademySessionToken || '') });
  /* the Activity page may only load images from its own origin, so the avatar is fetched through the Academy's server and shown from a data: URL */
  function avatarFor(id) {
    if (avatarCache.has(id)) return avatarCache.get(id);
    const p = fetch('/academy-activity/avatar?user=' + encodeURIComponent(id), { headers: authHeaders() }).then((r) => (r.ok ? r.blob() : null)).then((blob) => (blob ? new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => resolve(''); fr.readAsDataURL(blob); }) : '')).catch(() => '');
    avatarCache.set(id, p);
    return p;
  }
  function paintAvatar(el, id) {
    if (!el || !window.smlAcademySessionToken) return;
    avatarFor(id).then((url) => { if (url && el.isConnected) { const img = document.createElement('img'); img.className = 'ava'; img.dataset.uid = id; img.alt = ''; img.src = url; el.replaceWith(img); } });
  }
  function cardFor(id) {
    if (cardCache.has(id)) return cardCache.get(id);
    const p = fetch('/academy-activity/profile?user=' + encodeURIComponent(id), { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.ok ? j.card : null)).catch(() => null);
    cardCache.set(id, p);
    p.then((c) => { if (!c) setTimeout(() => cardCache.delete(id), 15000); });
    return p;
  }
  const openUrl = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  const cardEl = document.createElement('div'); cardEl.id = 'academy-profile-card'; cardEl.style.display = 'none'; document.body.appendChild(cardEl);
  let cardFor_ = '', hideTimer = 0, showTimer = 0;
  const hideCard = () => { cardEl.style.display = 'none'; cardFor_ = ''; };
  function cardHtml(c, id, img) {
    const d = c.discord || {}, site = c.site || {};
    const you = id === selfId;
    let h = '<div class="bn"' + (d.accentColor ? ' style="background:' + escapeHtml(d.accentColor) + '"' : '') + '></div><div class="hd">' + (img ? '<img class="big" alt="" src="' + escapeHtml(img) + '">' : '<span class="big"></span>') + '<div class="who"><b>' + escapeHtml(d.name || d.username || 'Member') + '</b><span>' + (d.username ? '@' + escapeHtml(d.username) : '') + '</span></div></div>';
    h += '<div class="sec"><h6>DISCORD</h6><div class="btns"><button type="button" class="dc" data-open="' + escapeHtml(d.profileUrl || '') + '">' + (you ? 'Open my Discord profile' : 'Add on Discord') + '</button></div><p class="note">' + (you ? 'This is you.' : 'Opens their Discord profile, where the Add Friend button is.') + '</p></div>';
    if (site.linked) {
      h += '<div class="sec"><h6>STOCKMARKETLOOP.COM</h6><b style="color:#fff">' + escapeHtml(site.name || site.handle) + '</b> <span style="color:#8fa5b1">@' + escapeHtml(site.handle) + '</span><div class="btns" style="margin-top:6px">'
        + (site.profileUrl ? '<button type="button" class="go" data-open="' + escapeHtml(site.profileUrl) + '">' + (you ? 'My profile' : 'Follow profile') + '</button>' : '')
        + (site.channel ? '<button type="button" data-open="' + escapeHtml(site.channel.url) + '">' + (you ? 'My channel' : 'Follow channel') + '</button>' : '')
        + (site.group ? '<button type="button" data-open="' + escapeHtml(site.group.url) + '">' + (you ? 'My group' : 'Join ' + escapeHtml(site.group.name || 'group')) + (site.group.members ? ' · ' + escapeHtml(site.group.members) : '') + '</button>' : '')
        + '</div><p class="note">Following happens on stockmarketloop.com, where you are signed in.</p></div>';
    } else {
      h += '<div class="sec"><h6>STOCKMARKETLOOP.COM</h6><p class="note" style="margin:0">' + (site.unavailable ? 'The StockMarketLoop profile could not be reached right now.' : 'Not linked to a StockMarketLoop profile yet.') + '</p></div>';
    }
    return h + '<div class="ft">Public profile details only.</div>';
  }
  async function showCard(id, anchor) {
    clearTimeout(hideTimer); cardFor_ = id;
    const [card, img] = await Promise.all([cardFor(id), avatarFor(id)]);
    if (cardFor_ !== id || !card || !anchor.isConnected) return;
    cardEl.innerHTML = cardHtml(card, id, img); cardEl.style.display = 'block';
    const r = anchor.getBoundingClientRect(), w = cardEl.offsetWidth || 300, h = cardEl.offsetHeight || 220;
    let x = r.left, y = r.bottom + 6; if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8; if (x < 8) x = 8; if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    cardEl.style.left = Math.round(x) + 'px'; cardEl.style.top = Math.round(y) + 'px';
  }
  const idOf = (t) => { const el = t && t.closest ? t.closest('[data-uid]') : null; return el && logEl.contains(el) ? el : null; };
  logEl.addEventListener('mouseover', (e) => { const el = idOf(e.target); if (!el || !window.smlAcademySessionToken) return; clearTimeout(hideTimer); clearTimeout(showTimer); showTimer = setTimeout(() => { void showCard(el.dataset.uid, el); }, 260); });
  logEl.addEventListener('mouseout', (e) => { if (!idOf(e.target)) return; clearTimeout(showTimer); hideTimer = setTimeout(hideCard, 220); });
  cardEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  cardEl.addEventListener('mouseleave', () => { hideTimer = setTimeout(hideCard, 220); });
  // touch has no hover: a tap on a name or avatar opens the card, a tap anywhere else closes it
  logEl.addEventListener('click', (e) => { const el = idOf(e.target); if (el && window.smlAcademySessionToken) { clearTimeout(hideTimer); void showCard(el.dataset.uid, el); } });
  document.addEventListener('click', (e) => { if (cardEl.style.display !== 'none' && !cardEl.contains(e.target) && !idOf(e.target)) hideCard(); });
  cardEl.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b && b.dataset.open) openUrl(b.dataset.open); });
  logEl.addEventListener('scroll', hideCard, { passive: true });

  function renderMessage(m) {
    if (muted[String(m.discordId)]) return;
    const empty = logEl.querySelector('.academy-chat-empty'); if (empty) empty.remove();
    const row = document.createElement('div'); row.className = 'academy-chat-msg'; row.dataset.id = m.id;
    row.innerHTML = '<span class="ava" data-uid="' + escapeHtml(String(m.discordId)) + '">' + escapeHtml(String(m.authorName || 'M').slice(0, 1).toUpperCase()) + '</span><b class="nm" data-uid="' + escapeHtml(String(m.discordId)) + '">' + escapeHtml(m.authorName || 'Member') + '</b><span>' + escapeHtml(m.body) + '</span><time>' + timeOf(m.createdAt) + '</time>';
    paintAvatar(row.querySelector('.ava'), String(m.discordId));
    if (String(m.discordId) === selfId) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'del'; del.textContent = 'delete';
      del.onclick = () => send({ type: 'delete', id: m.id });
      row.appendChild(del);
    } else if (selfId) {
      const rep = document.createElement('button');
      rep.type = 'button'; rep.className = 'rep'; rep.textContent = 'report'; rep.title = 'Send this message to the moderators';
      rep.onclick = () => { send({ type: 'report', id: m.id }); rep.disabled = true; rep.textContent = 'reporting…'; };
      const mute = document.createElement('button');
      mute.type = 'button'; mute.className = 'rep'; mute.textContent = 'mute'; mute.title = 'Hide this member\'s messages from you';
      mute.onclick = () => { muted[String(m.discordId)] = String(m.authorName || 'Member').slice(0, 40); saveMuted(); paintMuted(); if (current) join(current); };
      row.append(rep, mute);
    }
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function send(payload) {
    const json = JSON.stringify(payload);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(json); else queue.push(json);
  }
  function join(key) {
    current = key;
    for (const [k, b] of buttons) b.classList.toggle('on', k === key);
    logEl.innerHTML = '<p class="academy-chat-empty">Loading…</p>';
    send({ type: 'join', channel: key });
  }

  function connect() {
    const token = window.smlAcademySessionToken;
    if (!token) { status.textContent = 'SIGN IN FIRST'; return; }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    selfId = selfIdFromToken(token);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = proto + '://' + location.host + '/academy-activity/chat?token=' + encodeURIComponent(token) + '&name=' + encodeURIComponent(displayName());
    try { ws = new WebSocket(url); } catch (_) { status.textContent = 'OFFLINE'; return; }
    ws.onopen = () => { status.textContent = 'LIVE'; while (queue.length) ws.send(queue.shift()); join(current || 'global'); };
    ws.onclose = () => { status.textContent = 'RECONNECTING'; setTimeout(connect, 3000); };
    ws.onerror = () => {};
    ws.onmessage = (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'history' && msg.channel === current) { logEl.innerHTML = ''; if (!msg.messages.length) logEl.innerHTML = '<p class="academy-chat-empty">No messages yet — be the first.</p>'; msg.messages.forEach(renderMessage); }
      else if (msg.type === 'message' && msg.channel === current) renderMessage(msg.message);
      else if (msg.type === 'deleted' && msg.channel === current) { const row = logEl.querySelector('[data-id="' + msg.id + '"]'); if (row) row.remove(); }
      else if (msg.type === 'reported') { const row = logEl.querySelector('[data-id="' + msg.id + '"] .rep'); if (row) row.textContent = 'reported'; }
      else if (msg.type === 'error') status.textContent = String(msg.error || 'error').toUpperCase().replace(/_/g, ' ');
    };
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    send({ type: 'message', body });
    input.value = '';
  };

  paintMuted();
  window.addEventListener('sml-academy-session', connect);
  if (window.smlAcademySessionToken) connect();
})();
