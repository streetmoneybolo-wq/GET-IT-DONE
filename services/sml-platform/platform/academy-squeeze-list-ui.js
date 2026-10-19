/* SQUEEZE (owner only): a toolbar button that lists the 20 names with the highest SQUEEZE RISK score across the active market
   (academy-squeeze-list.js over academy-short-insight.js). The button shows only once the server confirms the owner account;
   the route refuses everyone else. Tap a row to load that chart. Desktop: a panel under the top bar; phones: a bottom sheet. */
(function boot(tries) {
  if (window.__smlSqueezeList) return;
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) { if (tries < 120) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlSqueezeList = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const S = { owner: false, open: false, data: null, busy: false, checked: '', timer: 0, msg: '' };
  const css = document.createElement('style');
  css.textContent = '#squeeze-btn{display:none;margin-left:4px;padding:5px 9px;border:1px solid #7a2634;border-radius:7px;background:#2a0e14;color:#ff9fb0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#squeeze-btn.show{display:inline-block}#squeeze-btn.on{background:#7a2634;color:#fff}'
    + '#squeeze-panel{position:fixed;top:50px;right:10px;z-index:2147483150;width:min(760px,calc(100vw - 20px));max-height:calc(100dvh - 64px);display:none;flex-direction:column;background:#0b141c;border:1px solid #7a2634;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6);color:#dbe6ec;font:500 .7rem/1.4 system-ui,sans-serif;overflow:hidden}#squeeze-panel.open{display:flex}'
    + '#squeeze-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #1b3540;flex:none}#squeeze-panel header b{font:900 .78rem ui-monospace,monospace;letter-spacing:.06em;color:#ff9fb0}#squeeze-panel header small{color:#7f98a6}#squeeze-panel header button{border:1px solid #2b5362;border-radius:6px;background:#0d1a24;color:#9ed3e6;font:800 .62rem ui-monospace,monospace;padding:4px 8px;cursor:pointer}#squeeze-panel header .x{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px}'
    + '#squeeze-panel .body{overflow:auto;padding:6px 10px 10px}#squeeze-panel table{width:100%;border-collapse:collapse;font:600 .66rem ui-monospace,monospace}#squeeze-panel th,#squeeze-panel td{padding:5px 6px;text-align:right;border-bottom:1px solid rgba(42,66,78,.5);white-space:nowrap}#squeeze-panel th{color:#8fa6b3;font-weight:700;position:sticky;top:0;background:#0b141c}#squeeze-panel td:first-child,#squeeze-panel th:first-child,#squeeze-panel td:nth-child(2),#squeeze-panel th:nth-child(2){text-align:left}'
    + '#squeeze-panel tbody tr{cursor:pointer}#squeeze-panel tbody tr:hover td{background:rgba(255,159,176,.07)}#squeeze-panel td.sym{font-weight:900;color:#fff}#squeeze-panel td .nm{display:block;color:#738995;font:600 .54rem system-ui,sans-serif;max-width:160px;overflow:hidden;text-overflow:ellipsis}'
    + '#squeeze-panel .sc{display:inline-block;min-width:34px;padding:2px 6px;border-radius:999px;font:900 .64rem ui-monospace,monospace;text-align:center}#squeeze-panel .sc.hi{background:#3a0f1a;color:#ff9fb0}#squeeze-panel .sc.mid{background:#2e2410;color:#ffcf7a}#squeeze-panel .sc.lo{background:#16303a;color:#9fd3e8}'
    + '#squeeze-panel .up{color:#52e6ad}#squeeze-panel .dn{color:#ff778b}#squeeze-panel .why{display:block;color:#9fb3be;font:500 .56rem system-ui,sans-serif;white-space:normal;max-width:300px}'
    + '#squeeze-panel .st{padding:6px 12px;color:#8fa6b3;font:700 .6rem ui-monospace,monospace;border-bottom:1px solid #13262f}#squeeze-panel .note{padding:8px 12px;color:#6f8794;font:500 .56rem/1.4 system-ui,sans-serif;border-top:1px solid #13262f}'
    + '@media(max-width:720px){#squeeze-panel{top:auto;bottom:6px;left:6px;right:6px;width:auto;max-height:70vh}}';
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'squeeze-btn'; btn.textContent = 'SQUEEZE'; btn.title = 'Top 20 squeeze-risk names across the market (owner)'; toolbar.appendChild(btn);
  const panel = document.createElement('section'); panel.id = 'squeeze-panel'; panel.setAttribute('aria-label', 'Squeeze risk list'); document.body.appendChild(panel);
  const openOut = (s) => { if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(s); };

  async function api(q) {
    const t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    try { const res = await fetch('/academy-activity/squeeze-list' + (q || ''), { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); const j = await res.json().catch(() => null); return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' }); } catch (_) { return { ok: false, error: 'network' }; }
  }
  const pc = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '–');
  const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
  function paint() {
    panel.classList.toggle('open', S.open); btn.classList.toggle('on', S.open);
    if (!S.open) return;
    const d = S.data;
    let h = '<header><b>SQUEEZE RISK · TOP ' + ((d && d.limit) || 20) + '</b><small>' + (d && d.asOf ? 'as of ' + new Date(d.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') + '</small><button type="button" data-refresh="1">Rescan</button><button type="button" class="x" data-close="1" aria-label="Close">×</button></header>';
    if (d && d.building) h += '<div class="st">Scanning the active market: ' + d.done + ' of ' + d.total + ' names read' + (d.rows && d.rows.length ? ' (the list fills in as it goes)' : '') + '…</div>';
    else if (d && d.error) h += '<div class="st">' + esc(d.error === 'no_universe' ? 'The scanner has no names right now.' : 'The last scan failed; rescan.') + '</div>';
    if (S.msg) h += '<div class="st">' + esc(S.msg) + '</div>';
    const rows = (d && d.rows) || [];
    h += '<div class="body"><table><thead><tr><th>#</th><th>Name</th><th>Squeeze</th><th>Pressing</th><th>Days to cover</th><th>Short vol</th><th>SI chg</th><th>Price vs 20d</th><th>Why</th></tr></thead><tbody>'
      + rows.map((r) => '<tr data-sym="' + esc(r.symbol) + '"><td>' + r.rank + '</td><td class="sym">$' + esc(r.symbol) + (r.name ? '<span class="nm">' + esc(r.name) + '</span>' : '') + '</td><td><span class="sc ' + (r.squeeze >= 70 ? 'hi' : r.squeeze >= 55 ? 'mid' : 'lo') + '">' + r.squeeze + '</span></td><td>' + (r.pressing == null ? '–' : r.pressing) + '</td><td>' + n1(r.daysToCover) + '</td><td>' + (r.shortRatio == null ? '–' : r.shortRatio.toFixed(0) + '%') + (r.shortRatioTrend != null ? ' <small class="' + (r.shortRatioTrend > 0 ? 'dn' : 'up') + '">' + (r.shortRatioTrend > 0 ? '▲' : '▼') + '</small>' : '') + '</td><td class="' + (r.siChangePct > 0 ? 'up' : r.siChangePct < 0 ? 'dn' : '') + '">' + pc(r.siChangePct) + '</td><td class="' + (r.aboveHigh ? 'up' : '') + '">' + (r.close == null ? '–' : r.close.toFixed(2)) + (r.aboveHigh ? ' ▲' : r.hi20 != null && r.close != null ? ' (' + pc((r.close / r.hi20 - 1) * 100) + ')' : '') + '</td><td><span class="why">' + esc((r.why || []).slice(0, 2).join(' · ') || r.call) + '</span></td></tr>').join('')
      + (rows.length ? '' : '<tr><td colspan="9" style="text-align:center;color:#7f98a6;padding:16px">' + (d && d.building ? 'Reading…' : 'Nothing scored yet.') + '</td></tr>') + '</tbody></table></div>'
      + '<div class="note">' + esc((d && d.note) || '') + ' Tap a row to load that chart; the SHORT SALE panel shows the full read.</div>';
    panel.innerHTML = h;
  }
  async function load(refresh) {
    if (S.busy) return; S.busy = true;
    const r = await api(refresh ? '?refresh=1' : '');
    S.busy = false;
    if (!r.ok) { S.msg = r.error === 'owner_only' ? 'This list is for the owner account.' : r.error === 'insight_unavailable' ? 'The short insight is not running on this server.' : 'Could not load the list right now.'; paint(); return; }
    S.msg = ''; S.data = r; paint();
    clearTimeout(S.timer);
    if (S.open && (r.building || (!r.asOf && !r.error))) S.timer = setTimeout(() => load(false), 4000);
  }
  function setOpen(on) { S.open = on; paint(); if (on) load(false); else clearTimeout(S.timer); }
  btn.addEventListener('click', () => setOpen(!S.open));
  panel.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-close],[data-refresh],tr[data-sym]') : null; if (!t) return;
    if (t.dataset.close) { setOpen(false); return; }
    if (t.dataset.refresh) { load(true); return; }
    if (t.dataset.sym) { openOut(t.dataset.sym); if (window.matchMedia('(max-width:720px)').matches) setOpen(false); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) setOpen(false); });
  /* the button shows only once the server says this account is the owner */
  async function check() {
    const t = token(); if (!t || S.checked === t) return; S.checked = t;
    const r = await api('?probe=1');
    S.owner = Boolean(r.ok && r.owner);
    btn.classList.toggle('show', S.owner);
    if (!S.owner) setOpen(false);
  }
  window.addEventListener('sml-academy-session', () => setTimeout(check, 500));
  if (token()) check();
  window.smlSqueezeList = { open: () => setOpen(true), check, state: () => ({ owner: S.owner, open: S.open, rows: S.data ? S.data.rows.length : 0 }) };
})(0);
