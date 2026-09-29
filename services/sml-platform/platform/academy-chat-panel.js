/* The Academy trading-desk chat panel: injected into the Activity page below the options chain
 * lab, next to the scanner. Four switchable channels (Day Trade, Swing Trade, Short Sale, Options
 * Trading) over the WebSocket at /academy-activity/chat (see academy-chat.js on the server). This
 * file only renders and wires the socket — every rule (length cap, rate limit, who can delete
 * what) is enforced server-side; this is trust-but-verify UI, not the source of truth. */
(() => {
  if (window.__smlAcademyChatPanel) return;
  window.__smlAcademyChatPanel = 1;

  const CHANNELS = [['day', 'Day Trade'], ['swing', 'Swing Trade'], ['short', 'Short Sale'], ['options', 'Options Trading']];

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
    + '.academy-chat-msg .del:hover{color:#ff778b}'
    + '.academy-chat-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #1b3540}'
    + '.academy-chat-form input{flex:1;background:#0d1720;border:1px solid #294554;border-radius:6px;color:#eaf5f8;padding:8px 10px;font:.72rem system-ui;min-width:0}'
    + '.academy-chat-form button{border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:900;padding:8px 14px;cursor:pointer}'
    + '@media(max-width:720px){.academy-chat-log{height:220px}}';
  document.head.appendChild(style);

  const section = document.createElement('section');
  section.className = 'academy-chat';
  section.innerHTML = '<div class="academy-chat-tabs"></div><div class="academy-chat-log"><p class="academy-chat-empty">Connecting…</p></div>'
    + '<form class="academy-chat-form"><input maxlength="500" placeholder="Message the desk…" autocomplete="off"><button type="submit">Send</button></form>';
  const tabsEl = section.querySelector('.academy-chat-tabs');
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

  let ws = null, current = null, queue = [], selfId = '';
  const escapeHtml = (s) => { const d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; };
  const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

  function renderMessage(m) {
    const empty = logEl.querySelector('.academy-chat-empty'); if (empty) empty.remove();
    const row = document.createElement('div'); row.className = 'academy-chat-msg'; row.dataset.id = m.id;
    row.innerHTML = '<b>' + escapeHtml(m.authorName || 'Member') + '</b><span>' + escapeHtml(m.body) + '</span><time>' + timeOf(m.createdAt) + '</time>';
    if (String(m.discordId) === selfId) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'del'; del.textContent = 'delete';
      del.onclick = () => send({ type: 'delete', id: m.id });
      row.appendChild(del);
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
    ws.onopen = () => { status.textContent = 'LIVE'; while (queue.length) ws.send(queue.shift()); join(current || 'day'); };
    ws.onclose = () => { status.textContent = 'RECONNECTING'; setTimeout(connect, 3000); };
    ws.onerror = () => {};
    ws.onmessage = (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'history' && msg.channel === current) { logEl.innerHTML = ''; if (!msg.messages.length) logEl.innerHTML = '<p class="academy-chat-empty">No messages yet — be the first.</p>'; msg.messages.forEach(renderMessage); }
      else if (msg.type === 'message' && msg.channel === current) renderMessage(msg.message);
      else if (msg.type === 'deleted' && msg.channel === current) { const row = logEl.querySelector('[data-id="' + msg.id + '"]'); if (row) row.remove(); }
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

  window.addEventListener('sml-academy-session', connect);
  if (window.smlAcademySessionToken) connect();
})();
