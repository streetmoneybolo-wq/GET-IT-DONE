/* AUTO card for the owner: switch the simulated moomoo auto-trader on, pick dry or sim, set the guardrails, and hit the kill switch.
   The button only appears when /academy-activity/autotrade answers 200 (the owner). Simulated account only. */
(function boot(tries) {
  if (window.__smlAutoTradeUi) return;
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) { if (tries < 100) setTimeout(() => boot(tries + 1), 150); return; }
  window.__smlAutoTradeUi = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { open: false, d: null, msg: '' };
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'autotrade-btn'; btn.textContent = 'AUTO'; btn.style.cssText = 'display:none;margin-left:4px;padding:5px 9px;border:1px solid #1f8a5f;border-radius:7px;background:#0b2219;color:#7dffc4;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer'; btn.title = 'Auto-trade: MEM ALGO signals on your moomoo SIMULATED account'; toolbar.appendChild(btn);
  const card = document.createElement('aside'); card.id = 'autotrade-card'; card.style.cssText = 'position:fixed;right:12px;top:58px;z-index:2147483300;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;background:#0a101a;border:1px solid #1f8a5f;border-radius:12px;color:#dbe6ec;font:600 .68rem/1.45 system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.6);padding:10px 12px;display:none'; document.body.appendChild(card);
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => card.addEventListener(ev, (e) => e.stopPropagation()));
  async function api(body) {
    const t = window.smlAcademySessionToken || ''; if (!t) return null;
    const go = (tok) => fetch('/academy-activity/autotrade', { method: body ? 'POST' : 'GET', headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    try { let r = await go(t); if (r.status === 401 && window.smlAcademyReauth) { const f = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (f) r = await go(f); } if (r.status === 403) return { forbidden: true }; return await r.json(); } catch (_) { return null; }
  }
  async function load() { const d = await api(); if (d && d.ok) { S.d = d; btn.style.display = 'inline-block'; btn.style.background = d.settings.enabled ? '#00c47d' : '#0b2219'; btn.style.color = d.settings.enabled ? '#032318' : '#7dffc4'; } if (S.open) paint(); }
  function paint() {
    card.style.display = S.open ? 'block' : 'none'; if (!S.open || !S.d) return;
    const d = S.d, s = d.settings, num = (k, l, step) => '<label style="display:flex;justify-content:space-between;gap:8px;margin:4px 0">' + l + '<input data-k="' + k + '" type="number" step="' + step + '" value="' + esc(s[k]) + '" style="width:90px;background:#0b1119;color:#e6eef2;border:1px solid #2c3a52;border-radius:6px;padding:3px 5px"></label>';
    card.innerHTML = '<b style="font:800 .72rem ui-monospace,monospace;color:#7dffc4;letter-spacing:.06em">AUTO-TRADE · SIMULATED MOOMOO</b><span data-close="1" style="float:right;cursor:pointer;color:#8fa6b3">&#10005;</span>'
      + '<p style="margin:6px 0;color:#9fb3bd">' + (d.brokerConfigured ? (d.account ? 'Connected. Cash $' + Math.round(d.account.cash) + ', equity $' + Math.round(d.account.equity) + ', day P/L $' + Math.round(d.account.dayPnl) + '.' : 'Bridge configured but not answering' + (d.brokerError ? ' (' + esc(d.brokerError) + ')' : '') + '.') : 'Not connected. Set SML_MOOMOO_TRADE_BRIDGE and SML_MOOMOO_TRADE_SECRET (see tools/moomoo-sim-bridge).') + '</p>'
      + '<div style="display:flex;gap:6px;margin:6px 0"><button data-a="toggle" style="flex:1;padding:7px;border-radius:8px;border:1px solid #1f8a5f;background:' + (s.enabled ? '#00c47d' : '#0b2219') + ';color:' + (s.enabled ? '#032318' : '#7dffc4') + ';font:800 .64rem ui-monospace,monospace">' + (s.enabled ? 'ON' : 'OFF') + '</button>'
      + '<button data-a="mode" style="flex:1;padding:7px;border-radius:8px;border:1px solid #3a3160;background:#17112a;color:#cdb6ff;font:800 .64rem ui-monospace,monospace">' + (s.mode === 'sim' ? 'SENDING ORDERS (sim)' : 'DRY RUN (log only)') + '</button>'
      + '<button data-a="kill" style="padding:7px 10px;border-radius:8px;border:1px solid #5a2733;background:#2a0f16;color:#ff8ea1;font:800 .64rem ui-monospace,monospace">KILL</button></div>'
      + num('maxPositionUsd', 'Dollars per position', 50) + num('maxOpen', 'Max open positions', 1) + num('maxOrdersPerDay', 'Max orders per day', 1) + num('dailyLossUsd', 'Daily loss stop ($)', 10)
      + '<label style="display:flex;justify-content:space-between;margin:4px 0">Minimum grade<select data-k="minGrade" style="background:#0b1119;color:#e6eef2;border:1px solid #2c3a52;border-radius:6px"><option' + (s.minGrade === 'A' ? ' selected' : '') + '>A</option><option' + (s.minGrade === 'B' ? ' selected' : '') + '>B</option></select></label>'
      + (S.msg ? '<p style="color:#ffd166">' + esc(S.msg) + '</p>' : '') + '<div style="margin-top:8px;color:#9fb3bd">Today: ' + d.ordersToday + ' order(s)' + (d.haltedDay ? ', halted by the loss stop' : '') + (d.killed ? ', KILLED' : '') + '.</div>'
      + '<ul style="margin:6px 0 0;padding-left:16px;color:#c9d6de">' + d.log.slice(0, 8).map((l) => '<li>' + esc(new Date(l.at).toLocaleTimeString()) + ' ' + esc(l.kind) + (l.symbol ? ' ' + esc(l.symbol) : '') + (l.why ? ' (' + esc(l.why) + ')' : '') + (l.error ? ' ' + esc(l.error) : '') + '</li>').join('') + '</ul>'
      + '<small style="display:block;margin-top:8px;color:#6f8794">' + esc(d.note) + '</small>';
  }
  card.addEventListener('change', async (e) => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; const v = e.target.tagName === 'SELECT' ? e.target.value : Number(e.target.value); const r = await api({ [k]: v }); if (r && r.ok) S.d = r; paint(); });
  card.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-a],[data-close]'); if (!t) return;
    if (t.dataset.close) { S.open = false; paint(); return; }
    const s = S.d.settings; let body;
    if (t.dataset.a === 'toggle') body = { enabled: !s.enabled };
    else if (t.dataset.a === 'mode') { if (s.mode === 'dry' && !window.confirm('Send orders to your moomoo SIMULATED account? Nothing real is ever traded.')) return; body = { mode: s.mode === 'sim' ? 'dry' : 'sim' }; }
    else if (t.dataset.a === 'kill') body = { kill: true, flatten: window.confirm('Also sell the positions the auto-trader opened?') };
    const r = await api(body); if (r && r.ok) { S.d = r; S.msg = ''; } else S.msg = 'Could not save.'; await load(); paint();
  });
  btn.addEventListener('click', () => { S.open = !S.open; paint(); if (S.open) void load(); });
  setTimeout(() => { void load(); }, 1500); setInterval(() => { if (S.open) void load(); }, 20000);
})(0);
