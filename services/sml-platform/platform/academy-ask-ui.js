/* Ask Obi (owner only): paste any question, get the answer in Grandmaster-Obi's voice built from the Academy's own
   material, and copy it to paste anywhere. The button appears only after the server confirms the signed-in account is
   the owner; the route refuses everyone else, so nothing here is a secret. Desktop: a panel under the top bar; phones: a
   bottom sheet. Ctrl/Cmd+Enter asks. The last ten answers stay for the session. */
(() => {
  if (window.__smlAcademyAsk) return;
  window.__smlAcademyAsk = 1;
  const token = () => String(window.smlAcademySessionToken || '');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { owner: false, busy: false, open: false, history: [], checked: '' };
  try { S.history = JSON.parse(sessionStorage.getItem('sml-ask-history') || '[]').slice(0, 10); } catch (_) { S.history = []; }

  const css = document.createElement('style');
  css.textContent = '#academy-ask-btn{position:fixed;right:10px;bottom:132px;z-index:2147483198;display:none;border:1px solid #2a4a58;border-radius:999px;background:#0d1a24;color:#e6eef2;padding:7px 12px;font:800 .7rem system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5)}#academy-ask-btn.on{display:inline-block}'
    + '#academy-ask{position:fixed;top:50px;right:10px;z-index:2147482600;width:min(560px,calc(100vw - 20px));max-height:calc(100dvh - 64px);display:none;flex-direction:column;border:1px solid #285060;border-radius:12px;background:linear-gradient(160deg,#081219,#0c1b25);color:#e6eef2;box-shadow:0 18px 50px rgba(0,0,0,.6);font:500 .8rem/1.5 system-ui,-apple-system,sans-serif;overflow:hidden}'
    + '#academy-ask.open{display:flex}'
    + '#academy-ask .ak-top{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.07)}#academy-ask .ak-top b{font:800 .7rem ui-monospace,monospace;letter-spacing:.08em;color:#00c47d}#academy-ask .ak-top .sp{flex:1}'
    + '#academy-ask .ak-x{border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.04);color:#e6eef2;padding:4px 9px;font:800 .66rem system-ui;cursor:pointer}'
    + '#academy-ask .ak-body{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:9px}'
    + '#academy-ask textarea{width:100%;min-height:86px;max-height:40vh;resize:vertical;box-sizing:border-box;padding:9px 10px;border:1px solid #2b4b5a;border-radius:9px;background:#07111a;color:#e6eef2;font:600 .8rem/1.45 system-ui;outline:none}#academy-ask textarea:focus{border-color:#00c47d}'
    + '#academy-ask .ak-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#academy-ask .ak-row small{color:#7f95a1;font-size:.66rem}'
    + '#academy-ask .ak-go{border:0;border-radius:9px;background:#00c47d;color:#04140d;padding:8px 14px;font:800 .72rem system-ui;cursor:pointer}#academy-ask .ak-go[disabled]{opacity:.55;cursor:wait}'
    + '#academy-ask .ak-btn{border:1px solid rgba(255,255,255,.14);border-radius:9px;background:rgba(255,255,255,.04);color:#e6eef2;padding:7px 11px;font:800 .68rem system-ui;cursor:pointer}#academy-ask .ak-btn:hover{border-color:#00c47d;color:#fff}'
    + '#academy-ask .ak-ans{position:relative;padding:12px 12px 10px;border:1px solid rgba(0,196,125,.3);border-radius:10px;background:rgba(0,196,125,.06);white-space:pre-wrap;font:500 .84rem/1.6 Georgia,"Times New Roman",serif;color:#eaf4f7;-webkit-user-select:text;user-select:text}'
    + '#academy-ask .ak-ans.err{border-color:rgba(255,120,120,.4);background:rgba(255,80,80,.07);color:#ffc9c9;font-family:system-ui}'
    + '#academy-ask .ak-src{color:#7f95a1;font-size:.66rem;line-height:1.5}'
    + '#academy-ask .ak-hist{border-top:1px solid rgba(255,255,255,.07);padding-top:8px}#academy-ask .ak-hist h6{margin:0 0 6px;font:800 .62rem ui-monospace,monospace;letter-spacing:.08em;color:#7f95a1}#academy-ask .ak-hist button{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(255,255,255,.03);color:#cfe3ea;padding:6px 9px;margin:0 0 5px;font:600 .7rem system-ui;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#academy-ask .ak-wait{color:#9fb6c2;font-size:.72rem}#academy-ask .ak-wait i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#00c47d;margin-right:7px;animation:akblink 1s ease-in-out infinite}@keyframes akblink{50%{opacity:.25}}'
    + '@media(max-width:720px){#academy-ask{top:auto;bottom:0;right:0;left:0;width:auto;max-height:86dvh;border-radius:14px 14px 0 0}#academy-ask-btn{bottom:176px}}';
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'academy-ask-btn'; btn.textContent = '💬 Ask Obi'; btn.title = 'Paste a question, get the answer in your voice'; document.body.appendChild(btn);
  const panel = document.createElement('div'); panel.id = 'academy-ask'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ask Obi');
  panel.innerHTML = '<div class="ak-top"><b>💬 ASK OBI · OWNER</b><span class="sp"></span><button type="button" class="ak-x" data-ak="close">✕</button></div>'
    + '<div class="ak-body"><textarea data-ak="q" placeholder="Paste any question a member asked (or your own)…" maxlength="2000"></textarea>'
    + '<div class="ak-row"><button type="button" class="ak-go" data-ak="go">Answer it</button><button type="button" class="ak-btn" data-ak="paste">Paste question</button><button type="button" class="ak-btn" data-ak="clear">Clear</button><small>Ctrl+Enter asks · answers come from the Academy lessons, in your voice</small></div>'
    + '<div data-ak="out"></div><div class="ak-hist" data-ak="hist" hidden></div></div>';
  document.body.appendChild(panel);
  const q = panel.querySelector('[data-ak="q"]'), out = panel.querySelector('[data-ak="out"]'), hist = panel.querySelector('[data-ak="hist"]'), go = panel.querySelector('[data-ak="go"]');

  const toast = (t) => { if (window.smlAcademyToast) { window.smlAcademyToast(t); return; } let el = document.getElementById('sml-clip-toast'); if (!el) { el = document.createElement('div'); el.id = 'sml-clip-toast'; document.body.appendChild(el); } el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 1800); };
  async function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* fall through */ }
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
  }
  function saveHistory() { try { sessionStorage.setItem('sml-ask-history', JSON.stringify(S.history.slice(0, 10))); } catch (_) { /* fine */ } }
  function paintHistory() {
    if (!S.history.length) { hist.hidden = true; return; }
    hist.hidden = false;
    hist.innerHTML = '<h6>EARLIER THIS SESSION</h6>' + S.history.map((h, i) => '<button type="button" data-ak="hist-item" data-i="' + i + '" title="' + esc(h.q) + '">' + esc(h.q) + '</button>').join('');
  }
  function showAnswer(item) {
    out.innerHTML = '<div class="ak-ans" data-ak="ans">' + esc(item.answer) + '</div>'
      + '<div class="ak-row"><button type="button" class="ak-go" data-ak="copy">Copy answer</button><button type="button" class="ak-btn" data-ak="copyqa">Copy question + answer</button><button type="button" class="ak-btn" data-ak="again">Ask again</button></div>'
      + (item.sources && item.sources.length ? '<div class="ak-src">Drawn from: ' + item.sources.map((s) => esc(s.title) + ' (' + esc(s.source) + ')').join(' · ') + '</div>' : '<div class="ak-src">No lesson matched directly; answered from how the Academy teaches.</div>');
    out._item = item;
  }
  function showError(code, detail) {
    const say = { owner_only: 'This tool is for the owner account only.', integration_unconfigured: 'Claude is not set up on the server (ANTHROPIC_API_KEY).', rate_limited: 'Easy, that is a lot of questions in one minute. Give it a moment.', provider_rate_limited: 'Claude is busy right now. Try again in a few seconds.', empty_question: 'Paste or type a question first.', authorization_required: 'Sign in to the Academy first.' };
    out.innerHTML = '<div class="ak-ans err">' + esc(say[code] || 'The answer did not come back (' + (code || 'error') + '). Try again in a moment.') + (detail ? '\n' + esc(detail) : '') + '</div>';
  }
  async function askNow() {
    const text = q.value.trim();
    if (!text) { showError('empty_question'); return; }
    if (S.busy) return;
    S.busy = true; go.disabled = true; out.innerHTML = '<div class="ak-wait"><i></i>Reading the lessons and writing it the way you would say it…</div>';
    try {
      const res = await fetch('/academy-activity/ask', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() }, body: JSON.stringify({ question: text, symbol: (() => { try { const st = window.smlAcademyChartState && window.smlAcademyChartState(); return st && st.symbol ? String(st.symbol) : ''; } catch (_) { return ''; } })() }), cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) { showError(j && j.error, j && j.detail); return; }
      const item = { q: text, answer: j.answer, sources: j.sources || [], at: Date.now() };
      S.history.unshift(item); S.history = S.history.slice(0, 10); saveHistory(); paintHistory();
      showAnswer(item);
    } catch (_) { showError('offline'); } finally { S.busy = false; go.disabled = false; }
  }
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ak]'); if (!b) return;
    const a = b.dataset.ak;
    if (a === 'close') setOpen(false);
    else if (a === 'go') askNow();
    else if (a === 'clear') { q.value = ''; out.innerHTML = ''; q.focus(); }
    else if (a === 'paste') { try { const t = await navigator.clipboard.readText(); if (t) { q.value = t.slice(0, 2000); q.focus(); } else toast('Nothing on the clipboard'); } catch (_) { toast('Tap in the box and paste with Ctrl+V or long-press'); q.focus(); } }
    else if (a === 'copy' && out._item) { toast((await copyText(out._item.answer)) ? 'Answer copied' : 'Select the text and copy it'); }
    else if (a === 'copyqa' && out._item) { toast((await copyText('Q: ' + out._item.q + '\n\n' + out._item.answer)) ? 'Question and answer copied' : 'Select the text and copy it'); }
    else if (a === 'again') askNow();
    else if (a === 'hist-item') { const h = S.history[Number(b.dataset.i)]; if (h) { q.value = h.q; showAnswer(h); } }
  });
  q.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); askNow(); } });
  function setOpen(on) { S.open = on; panel.classList.toggle('open', on); if (on) { paintHistory(); setTimeout(() => q.focus(), 50); } }
  btn.addEventListener('click', () => setOpen(!S.open));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) setOpen(false); });

  /* the button shows only once the server says this account is the owner */
  async function check() {
    const t = token(); if (!t || S.checked === t) return; S.checked = t;
    try { const res = await fetch('/academy-activity/ask', { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); const j = await res.json().catch(() => null); S.owner = Boolean(res.ok && j && j.owner); } catch (_) { S.owner = false; }
    btn.classList.toggle('on', S.owner);
    if (!S.owner) setOpen(false);
  }
  window.addEventListener('sml-academy-session', () => setTimeout(check, 400));
  if (token()) check();
  window.smlAcademyAsk = { open: () => setOpen(true), check };
})();
