/* Loop Bucks access: when the Discord role check turns a member away, the sign-in answer carries a short-lived buy ticket.
 * This panel uses it to show the plans, the member's Loop Bucks balance and anything still blocking a purchase
 * (account link, email, profile, two-step), then charges the wallet through the Academy server and reloads once access is granted.
 * Nothing is charged until a plan button is pressed; the server does all the checks. */
(() => {
  if (window.__smlAcademyLb) return;
  window.__smlAcademyLb = 1;
  const TOPUP = window.SML_LB_TOPUP_URL || 'https://stockmarketloop.com/';
  let ticket = '', state = null, busy = false, orderKeys = {}, message = '';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const open = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  const key = () => { const a = new Uint8Array(12); try { crypto.getRandomValues(a); } catch (_) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); } return Array.from(a, (b) => (b + 256).toString(16).slice(-2)).join(''); };

  const style = document.createElement('style');
  style.textContent = '#lb-btn{position:fixed;left:10px;bottom:10px;z-index:2147483200;border:1px solid #1f8a5f;border-radius:999px;background:#0b3b2e;color:#7ef0bd;padding:8px 14px;font:800 .72rem system-ui;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.5);display:none}'
    + '#lb-panel{position:fixed;left:10px;bottom:54px;z-index:2147483201;width:min(340px,calc(100vw - 20px));max-height:calc(100dvh - 70px);overflow:auto;background:#0a1118;border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.65);color:#dbe6ec;font:600 .72rem/1.45 system-ui,sans-serif;padding:12px;display:none}'
    + '#lb-panel h4{margin:0 0 4px;font:800 .84rem system-ui}#lb-panel .sub{color:#8fa5b1;font-weight:500;margin:0 0 8px}'
    + '#lb-panel .bal{font:800 .8rem ui-monospace,monospace;color:#7ef0bd;margin:6px 0}'
    + '#lb-panel .plan{display:flex;justify-content:space-between;align-items:center;width:100%;margin:5px 0;border:1px solid #294554;border-radius:8px;background:#0d1a24;color:#e6eef2;padding:9px 10px;font:800 .7rem system-ui;cursor:pointer}'
    + '#lb-panel .plan:hover{border-color:#00c47d}#lb-panel .plan:disabled{opacity:.5;cursor:default}#lb-panel .plan i{font-style:normal;color:#ffd166}'
    + '#lb-panel .warn{background:#2a1d08;border:1px solid #6b4a12;border-radius:8px;padding:8px;color:#ffd9a0;margin:6px 0}#lb-panel .ok{background:#0b3b2e;border:1px solid #1f8a5f;border-radius:8px;padding:8px;color:#7ef0bd;margin:6px 0}'
    + '#lb-panel .go{border:0;border-radius:7px;background:#00c47d;color:#032318;font:900 .7rem system-ui;padding:7px 12px;cursor:pointer;margin:4px 6px 0 0}#lb-panel .ghost{border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;font:800 .68rem system-ui;padding:6px 10px;cursor:pointer;margin-top:4px}'
    + '#lb-panel .note{color:#7f95a1;font-weight:500;font-size:.6rem;margin-top:8px}';
  document.head.appendChild(style);
  const btn = document.createElement('button'); btn.id = 'lb-btn'; btn.type = 'button'; btn.textContent = 'Get access with Loop Bucks';
  const panel = document.createElement('div'); panel.id = 'lb-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Academy access with Loop Bucks');
  document.body.appendChild(panel); document.body.appendChild(btn);

  const BLOCK = {
    not_linked: ['Link your StockMarketLoop account to this Discord account first.', 'Link my account'],
    not_verified: ['Verify your StockMarketLoop email first.', 'Verify my email'],
    profile_incomplete: ['Finish filling out your StockMarketLoop profile.', 'Complete my profile'],
    two_step_required: ['Turn on two-step sign-in for your StockMarketLoop account.', 'Turn on two-step']
  };
  const when = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (_) { return ''; } };
  function paint() {
    let h = '<h4>Academy access with Loop Bucks</h4><p class="sub">Load Loop Bucks on stockmarketloop.com, then spend them here.</p>';
    if (!state) h += '<p class="sub">Loading…</p>';
    else if (state.error) h += '<div class="warn">Could not load your account right now. Try again in a minute.</div>';
    else {
      if (state.balance != null) h += '<div class="bal">Your balance: ' + esc(state.balance) + ' Loop Bucks</div>';
      if (state.pass) h += '<div class="ok">Your pass is active' + (state.pass.expiresAt ? ' until ' + esc(when(state.pass.expiresAt)) : ' for life') + '.</div>';
      if (state.blocked && BLOCK[state.blocked]) h += '<div class="warn">' + esc(BLOCK[state.blocked][0]) + '</div><button type="button" class="go" data-open="' + esc(state.url || TOPUP) + '">' + esc(BLOCK[state.blocked][1]) + '</button>';
      else {
        h += (state.catalog || []).map((p) => '<button type="button" class="plan" data-plan="' + esc(p.plan) + '"' + (busy ? ' disabled' : '') + '><span>' + esc(p.label) + '</span><i>' + esc(p.price) + ' Loop Bucks</i></button>').join('');
        if (!(state.catalog || []).length) h += '<div class="warn">Loop Bucks passes are not on sale yet.</div>';
        h += '<button type="button" class="ghost" data-open="' + esc(TOPUP) + '">Add Loop Bucks</button>';
      }
    }
    if (message) h += '<div class="' + (/^Access unlocked/.test(message) ? 'ok' : 'warn') + '">' + esc(message) + '</div>';
    h += '<p class="note">Passes stack: buying again extends your time. Lifetime never expires.</p>';
    panel.innerHTML = h;
  }
  async function api(path, init) {
    const res = await fetch('/academy-activity/passes/' + path, Object.assign({ headers: Object.assign({ 'x-academy-ticket': ticket }, (init && init.headers) || {}) }, init || {}));
    let data = null; try { data = await res.json(); } catch (_) { data = null; }
    return { res, data: data || {} };
  }
  async function refresh() { try { const r = await api('status'); state = r.res.ok ? r.data : { error: r.data.error || 'unavailable' }; } catch (_) { state = { error: 'unavailable' }; } paint(); }
  async function buy(plan) {
    if (busy) return; busy = true; message = ''; paint();
    orderKeys[plan] = orderKeys[plan] || key();
    try {
      const r = await api('buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, orderKey: orderKeys[plan] }) });
      if (r.res.ok && r.data.ok) { message = 'Access unlocked. Reloading the Academy…'; delete orderKeys[plan]; paint(); setTimeout(() => { try { location.reload(); } catch (_) { /* ignore */ } }, 1500); return; }
      const code = r.data.error || 'failed';
      if (code === 'insufficient_funds') { message = 'You need ' + r.data.needed + ' Loop Bucks and have ' + r.data.balance + '. Add Loop Bucks and try again.'; delete orderKeys[plan]; }
      else if (BLOCK[code]) { message = BLOCK[code][0]; state = Object.assign({}, state, { blocked: code, url: r.data.url || (state && state.url) }); delete orderKeys[plan]; }
      else if (code === 'already_lifetime') message = 'You already have lifetime access.';
      else message = 'That did not go through and nothing was charged twice. Try again in a minute.';
    } catch (_) { message = 'Connection problem. Try again; a retry will not charge you twice.'; }
    busy = false; await refresh();
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
    if (b.dataset.plan) void buy(b.dataset.plan); else if (b.dataset.open) open(b.dataset.open);
  });
  btn.onclick = () => { const on = panel.style.display !== 'block'; panel.style.display = on ? 'block' : 'none'; if (on) { paint(); void refresh(); } };

  /* The refused sign-in answer is the only place the ticket arrives, so read it as it goes by. */
  const baseFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const p = baseFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/academy-activity/token') !== -1) p.then((res) => res.clone().json().then((j) => { if (j && j.buy && j.buy.ticket && !j.ok) { ticket = String(j.buy.ticket); btn.style.display = 'block'; } }).catch(() => {})).catch(() => {});
    } catch (_) { /* never break the page's own request */ }
    return p;
  };
})();
