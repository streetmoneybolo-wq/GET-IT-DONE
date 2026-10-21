/* ACADEMY EVOLVE, the page side. Two jobs. (1) Beacons: which tools members open (from the tool rail and the floating
   pills), what kind of screen they are on, how long a visit lasts and any page error, posted in small batches to
   /academy-activity/evolve/event so the Academy can learn from its own use. Nothing identifies the member: no ids,
   no names, no symbols. (2) The owner's EVOLVE panel: the latest brief, the proposal queue (approve, dismiss, mark
   shipped), today's live digest and the knobs the system turns, with a Run brief button. The panel shows only once
   the server confirms the owner account; the beacons run for everyone. The live quote poll reads its cadence from
   /academy-activity/evolve/config, one of the knobs. */
(function boot(tries) {
  if (window.__smlEvolve) return;
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) { if (tries < 120) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlEvolve = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const phone = () => window.matchMedia('(max-width:720px)').matches;
  const inDiscord = new URLSearchParams(location.search).has('frame_id');

  /* ---- beacons ---- */
  const queue = []; let flushTimer = 0; const t0 = Date.now();
  function send(ev) { queue.push(Object.assign({ phone: phone(), discord: inDiscord }, ev)); if (queue.length >= 12) flush(); else if (!flushTimer) flushTimer = setTimeout(flush, 4000); }
  function flush(final) {
    clearTimeout(flushTimer); flushTimer = 0;
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue.splice(0, 40) });
    try {
      if (final && navigator.sendBeacon) { navigator.sendBeacon('/academy-activity/evolve/event', new Blob([body], { type: 'application/json' })); return; }
      fetch('/academy-activity/evolve/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch (_) {}
  }
  send({ kind: 'visit' });
  const TOOL_IDS = /^(depth-walls|depth-cost|heat-toggle|smc-toggle|intent-btn|targets-toggle|buysell-toggle|darkpool-toggle|shortsale-toggle|sentiment-toggle|squeeze-btn|chain-toggle|mem-algo-toggle|sire-toggle|earnings-toggle|catalysts-toggle|paper-toggle|challenge-toggle|talk-btn|snap-toggle|click-alert-toggle|tool-guide-btn|tool-quote-btn|academy-alerts-fab|academy-profile-btn|aa-btn|sml-settings-btn|academy-ask-btn|lesson-toggle|academy-lk-btn|evolve-btn|academy-pro-draw|academy-pro-patterns|academy-select-range|academy-screener-toggle)$/;
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[id]') : null; if (!b || !TOOL_IDS.test(b.id)) return;
    setTimeout(() => send({ kind: 'tool', id: b.id, on: !(b.classList.contains('on') === false && b.getAttribute('aria-pressed') === 'false') }), 60);
  }, true);
  window.addEventListener('error', (e) => send({ kind: 'error', message: String((e && e.message) || '').slice(0, 160) }));
  window.addEventListener('unhandledrejection', (e) => send({ kind: 'error', message: 'unhandled: ' + String(e && e.reason && (e.reason.message || e.reason) || '').slice(0, 140) }));
  const leave = () => { send({ kind: 'leave', ms: Date.now() - t0 }); flush(true); };
  window.addEventListener('pagehide', leave); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

  /* ---- the live poll cadence, from the knobs ---- */
  fetch('/academy-activity/evolve/config', { cache: 'no-store' }).then((r) => r.json()).then((c) => { if (c && c.ok) { window.smlEvolveConfig = c; window.dispatchEvent(new CustomEvent('sml-evolve-config', { detail: c })); } }).catch(() => {});

  /* ---- the owner's panel ---- */
  const S = { owner: false, open: false, data: null, busy: false, checked: '', msg: '' };
  const css = document.createElement('style');
  css.textContent = '#evolve-btn{display:none;margin-left:4px;padding:5px 9px;border:1px solid #2d5a3f;border-radius:7px;background:#0d2318;color:#7dffc4;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#evolve-btn.show{display:inline-block}#evolve-btn.on{background:#1f6b44;color:#fff}'
    + '#evolve-panel{position:fixed;top:50px;right:10px;z-index:2147483150;width:min(820px,calc(100vw - 20px));max-height:calc(100dvh - 64px);display:none;flex-direction:column;background:#0b141c;border:1px solid #2d5a3f;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6);color:#dbe6ec;font:500 .7rem/1.45 system-ui,sans-serif;overflow:hidden}#evolve-panel.open{display:flex}'
    + '#evolve-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #1b3540;flex:none;flex-wrap:wrap}#evolve-panel header b{font:900 .78rem ui-monospace,monospace;letter-spacing:.06em;color:#7dffc4}#evolve-panel header small{color:#7f98a6}#evolve-panel header button{border:1px solid #2b5362;border-radius:6px;background:#0d1a24;color:#9ed3e6;font:800 .62rem ui-monospace,monospace;padding:4px 8px;cursor:pointer}#evolve-panel header .x{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px}'
    + '#evolve-panel .body{overflow:auto;padding:8px 12px 12px}#evolve-panel h4{margin:10px 0 5px;font:800 .6rem ui-monospace,monospace;letter-spacing:.1em;color:#5f7986}#evolve-panel p{margin:0 0 6px}'
    + '#evolve-panel .sum{padding:9px 11px;border:1px solid #1f3a46;border-radius:9px;background:#0d1a24;color:#dbe6ec;font-size:.72rem}'
    + '#evolve-panel .pr{display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:start;padding:8px 10px;margin:0 0 6px;border:1px solid #1b3540;border-radius:9px;background:#0b151d}#evolve-panel .pr b{font-size:.74rem;color:#fff}#evolve-panel .pr .tag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font:800 .54rem ui-monospace,monospace;background:#16303a;color:#9fd3e8}#evolve-panel .pr .tag.approved{background:#123d31;color:#7dffc4}#evolve-panel .pr .tag.building{background:#3a2d10;color:#ffcf7a}#evolve-panel .pr .tag.high{background:#3a0f1a;color:#ff9fb0}'
    + '#evolve-panel .pr .why{color:#9fb3be;font-size:.64rem}#evolve-panel .pr .act{display:flex;gap:4px;flex-wrap:wrap;justify-content:end}#evolve-panel .pr .act button{border:1px solid #2b5362;border-radius:6px;background:#0d1a24;color:#9ed3e6;font:800 .56rem ui-monospace,monospace;padding:3px 7px;cursor:pointer}'
    + '#evolve-panel table{width:100%;border-collapse:collapse;font:600 .62rem ui-monospace,monospace}#evolve-panel th,#evolve-panel td{padding:4px 6px;text-align:right;border-bottom:1px solid rgba(42,66,78,.5);white-space:nowrap}#evolve-panel th{color:#8fa6b3;font-weight:700}#evolve-panel td:first-child,#evolve-panel th:first-child{text-align:left}'
    + '#evolve-panel .kn{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px}#evolve-panel .kn div{padding:6px 8px;border:1px solid #1b3540;border-radius:8px;background:#0b151d}#evolve-panel .kn b{display:block;color:#fff;font:800 .7rem ui-monospace,monospace}#evolve-panel .kn small{color:#7f98a6}#evolve-panel .kn em{display:block;font-style:normal;color:#ffcf7a;font-size:.56rem}'
    + '#evolve-panel .st{padding:6px 0;color:#8fa6b3;font:700 .6rem ui-monospace,monospace}'
    + '@media(max-width:720px){#evolve-panel{top:auto;bottom:6px;left:6px;right:6px;width:auto;max-height:76vh}#evolve-panel .pr{grid-template-columns:1fr}}';
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'evolve-btn'; btn.textContent = 'EVOLVE'; btn.title = 'What the Academy learned from its own use, and what it proposes to build next (owner)'; toolbar.appendChild(btn);
  const panel = document.createElement('section'); panel.id = 'evolve-panel'; panel.setAttribute('aria-label', 'Academy Evolve'); document.body.appendChild(panel);

  async function api(path, method, body) {
    const t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    try { const res = await fetch('/academy-activity/evolve' + (path || ''), { method: method || 'GET', headers: Object.assign({ authorization: 'Bearer ' + t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); const j = await res.json().catch(() => null); return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' }); } catch (_) { return { ok: false, error: 'network' }; }
  }
  const ago = (ms) => { if (!ms) return 'never'; const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const n1 = (v) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '–');
  function paint() {
    panel.classList.toggle('open', S.open); btn.classList.toggle('on', S.open);
    if (!S.open) return;
    const d = S.data, b = d && d.brief, t = d && d.today;
    let h = '<header><b>ACADEMY EVOLVE</b><small>' + (d ? 'brief ' + ago(d.lastBriefAt) + (d.aiOn ? ' · Claude on' : ' · rules only (no ANTHROPIC_API_KEY)') : '') + '</small><button type="button" data-run="1">Run brief now</button><button type="button" data-refresh="1">Refresh</button><button type="button" class="x" data-close="1" aria-label="Close">×</button></header><div class="body">';
    if (S.msg) h += '<div class="st">' + esc(S.msg) + '</div>';
    if (!d) { h += '<div class="st">Loading…</div></div>'; panel.innerHTML = h; return; }
    h += '<h4>YESTERDAY, IN ONE READ' + (b ? ' · ' + esc(b.day) + ' · ' + esc(b.model) : '') + '</h4><div class="sum">' + (b ? esc(b.summary) : 'No brief yet. Run one, or wait for the quiet hour.') + '</div>';
    h += '<h4>PROPOSALS · ' + d.proposals.length + ' open</h4>';
    if (!d.proposals.length) h += '<div class="st">Nothing in the queue.</div>';
    for (const p of d.proposals) h += '<div class="pr"><div><b>' + esc(p.title) + '</b><span class="tag ' + esc(p.status) + '">' + esc(p.status) + '</span><span class="tag">' + esc(p.size) + '</span><span class="tag ' + (p.risk === 'high' ? 'high' : '') + '">' + esc(p.risk) + ' risk</span><span class="tag">' + esc(p.area) + '</span><div class="why"><b style="font-size:.6rem;color:#9fb3be">Evidence</b> ' + esc(p.evidence) + '<br><b style="font-size:.6rem;color:#9fb3be">Change</b> ' + esc(p.change) + '<br><b style="font-size:.6rem;color:#9fb3be">Effect</b> ' + esc(p.effect) + '</div></div><div class="act">' + (p.status !== 'approved' ? '<button type="button" data-set="approved" data-id="' + esc(p.id) + '">Approve</button>' : '') + '<button type="button" data-set="shipped" data-id="' + esc(p.id) + '">Shipped</button><button type="button" data-set="dismissed" data-id="' + esc(p.id) + '">Dismiss</button></div></div>';
    if (d.done && d.done.length) h += '<div class="st">Shipped: ' + d.done.map((p) => esc(p.title)).join(' · ') + '</div>';
    h += '<h4>TODAY SO FAR</h4><table><thead><tr><th>Route</th><th>Calls</th><th>Err %</th><th>Timeouts</th><th>p50</th><th>p95</th></tr></thead><tbody>'
      + (t.busiest || []).slice(0, 8).map((r) => '<tr><td>' + esc(r.route) + '</td><td>' + r.n + '</td><td>' + n1(r.errPct) + '</td><td>' + r.timeouts + '</td><td>' + r.p50 + '</td><td>' + r.p95 + '</td></tr>').join('') + '</tbody></table>';
    h += '<div class="st">' + t.visits.count + ' visits · ' + t.devices.phone + ' on phones · ' + t.devices.discord + ' in Discord · avg ' + n1(t.visits.avgMinutes) + ' min · memory max ' + t.memory.rssMax + ' MB · loop p99 max ' + t.memory.loopP99Max + ' ms</div>';
    if (t.tools && t.tools.length) h += '<div class="st">Tools: ' + t.tools.slice(0, 10).map((x) => esc(x.id) + ' ' + x.opens).join(' · ') + '</div>';
    if (t.errors && t.errors.length) h += '<div class="st">Page errors: ' + t.errors.slice(0, 3).map((x) => esc(x.message) + ' (' + x.n + ')').join(' · ') + '</div>';
    h += '<h4>KNOBS · the system turns these inside their rails</h4><div class="kn">' + Object.entries(d.knobs).map(([k, v]) => '<div><b>' + esc(k) + '</b>' + v.value + ' ' + esc(v.unit) + ' <small>(' + v.min + '–' + v.max + ')</small>' + (v.pinned ? '<em>pinned by you</em>' : '') + '<small><br>' + esc(v.about) + '</small></div>').join('') + '</div>';
    if (d.turns && d.turns.length) h += '<div class="st">Recent turns: ' + d.turns.slice(0, 5).map((x) => esc(x.knob) + ' ' + x.from + '→' + x.to + ' (' + esc(x.reason) + ')').join(' · ') + '</div>';
    h += '</div>';
    panel.innerHTML = h;
  }
  async function load() {
    if (S.busy) return; S.busy = true;
    const r = await api('');
    S.busy = false;
    if (!r.ok) { S.msg = r.error === 'owner_only' ? 'This panel is for the owner account.' : 'Could not load (' + (r.error || 'error') + ').'; paint(); return; }
    S.msg = ''; S.data = r; paint();
  }
  function setOpen(on) { S.open = on; paint(); if (on) load(); }
  btn.addEventListener('click', () => setOpen(!S.open));
  panel.addEventListener('click', async (e) => {
    const t = e.target.closest ? e.target.closest('[data-close],[data-refresh],[data-run],[data-set]') : null; if (!t) return;
    if (t.dataset.close) { setOpen(false); return; }
    if (t.dataset.refresh) { load(); return; }
    if (t.dataset.run) { S.msg = 'Running the brief…'; paint(); const r = await api('/run', 'POST', {}); S.msg = r.ok ? 'Brief done.' : 'Brief failed (' + (r.error || 'error') + ').'; load(); return; }
    if (t.dataset.set) { const r = await api('/proposal', 'POST', { id: t.dataset.id, status: t.dataset.set }); if (!r.ok) { S.msg = 'Could not update (' + (r.error || 'error') + ').'; paint(); } load(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) setOpen(false); });
  async function check() {
    const t = token(); if (!t || S.checked === t) return; S.checked = t;
    const r = await api('?probe=1');
    S.owner = Boolean(r.ok && r.owner); if (S.owner) window.smlOwner = true;
    btn.classList.toggle('show', S.owner);
    if (!S.owner) setOpen(false);
  }
  window.addEventListener('sml-academy-session', () => setTimeout(check, 700));
  if (token()) check();
  window.smlEvolve = { send, flush, open: () => setOpen(true), check, state: () => ({ owner: S.owner, open: S.open, queued: queue.length }) };
})(0);
