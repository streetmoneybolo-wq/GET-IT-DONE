/* SQUEEZE (owner only): a toolbar button that lists the 100 names with the highest SQUEEZE RISK score across the active market
   (academy-squeeze-list.js over academy-short-insight.js). The button shows only once the server confirms the owner account;
   the route refuses everyone else. Tap a row to load that chart. Desktop: a panel under the top bar; phones: a bottom sheet.
   Built not to jump: the panel's frame is made once, rows are patched in place by symbol (a cell changes only when its text
   changes), and while a sweep runs the order on screen is frozen: the last complete list stays put with a progress line, and
   the new order is applied once, when the sweep completes. Only the very first sweep (nothing to show yet) fills in as it
   goes, in order of arrival, then sorts once at the end. */
(function boot(tries) {
  if (window.__smlSqueezeList) return;
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) { if (tries < 120) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlSqueezeList = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const S = { owner: false, open: false, data: null, busy: false, checked: '', timer: 0, msg: '', shown: null, shownAt: 0, order: [], sigs: new Map(), building: false, pending: null };
  const css = document.createElement('style');
  css.textContent = '#squeeze-btn{display:none;margin-left:4px;padding:5px 9px;border:1px solid #7a2634;border-radius:7px;background:#2a0e14;color:#ff9fb0;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#squeeze-btn.show{display:inline-block}#squeeze-btn.on{background:#7a2634;color:#fff}'
    + '#squeeze-panel{position:fixed;top:50px;right:10px;z-index:2147483150;width:min(760px,calc(100vw - 20px));max-height:calc(100dvh - 64px);display:none;flex-direction:column;background:#0b141c;border:1px solid #7a2634;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6);color:#dbe6ec;font:500 .7rem/1.4 system-ui,sans-serif;overflow:hidden}#squeeze-panel.open{display:flex}'
    + '#squeeze-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #1b3540;flex:none}#squeeze-panel header b{font:900 .78rem ui-monospace,monospace;letter-spacing:.06em;color:#ff9fb0}#squeeze-panel header small{color:#7f98a6}#squeeze-panel header button{border:1px solid #2b5362;border-radius:6px;background:#0d1a24;color:#9ed3e6;font:800 .62rem ui-monospace,monospace;padding:4px 8px;cursor:pointer}#squeeze-panel header button:disabled{opacity:.5;cursor:default}#squeeze-panel header .x{margin-left:auto;background:none;border:0;color:#7f98a6;font-size:18px}'
    + '#squeeze-panel .body{overflow:auto;padding:6px 10px 10px;overflow-anchor:none}#squeeze-panel table{width:100%;border-collapse:collapse;font:600 .66rem ui-monospace,monospace;table-layout:fixed}#squeeze-panel th,#squeeze-panel td{padding:5px 6px;text-align:right;border-bottom:1px solid rgba(42,66,78,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#squeeze-panel th{color:#8fa6b3;font-weight:700;position:sticky;top:0;background:#0b141c;z-index:1}#squeeze-panel td:first-child,#squeeze-panel th:first-child,#squeeze-panel td:nth-child(2),#squeeze-panel th:nth-child(2){text-align:left}'
    + '#squeeze-panel col.c-rk{width:28px}#squeeze-panel col.c-nm{width:150px}#squeeze-panel col.c-s{width:52px}#squeeze-panel col.c-n{width:44px}#squeeze-panel col.c-fl{width:76px}#squeeze-panel col.c-why{width:240px}'
    + '#squeeze-panel tbody tr{cursor:pointer;height:38px}#squeeze-panel tbody tr:hover td{background:rgba(255,159,176,.07)}#squeeze-panel td.sym{font-weight:900;color:#fff}#squeeze-panel td .nm{display:block;color:#738995;font:600 .54rem system-ui,sans-serif;max-width:150px;overflow:hidden;text-overflow:ellipsis}'
    + '#squeeze-panel .sc{display:inline-block;min-width:34px;padding:2px 6px;border-radius:999px;font:900 .64rem ui-monospace,monospace;text-align:center}#squeeze-panel .sc.hi{background:#3a0f1a;color:#ff9fb0}#squeeze-panel .sc.mid{background:#2e2410;color:#ffcf7a}#squeeze-panel .sc.lo{background:#16303a;color:#9fd3e8}'
    + '#squeeze-panel .up{color:#52e6ad}#squeeze-panel .dn{color:#ff778b}#squeeze-panel td small{color:#8fa6b3;font-size:.5rem}#squeeze-panel .lf{padding:0 4px;border-radius:4px;background:#123d31;color:#7dffc4!important;font-size:.48rem!important;vertical-align:middle}#squeeze-panel .why{display:block;color:#9fb3be;font:500 .56rem system-ui,sans-serif;white-space:normal;max-width:240px;max-height:2.6em;overflow:hidden}'
    + '#squeeze-panel .st{padding:6px 12px;color:#8fa6b3;font:700 .6rem ui-monospace,monospace;border-bottom:1px solid #13262f}#squeeze-panel .st:empty{display:none}#squeeze-panel .st .bar{display:inline-block;vertical-align:middle;width:90px;height:5px;margin-left:8px;border-radius:3px;background:#13262f;overflow:hidden}#squeeze-panel .st .bar i{display:block;height:100%;background:#ff9fb0;transition:width .4s}#squeeze-panel .note{padding:8px 12px;color:#6f8794;font:500 .56rem/1.4 system-ui,sans-serif;border-top:1px solid #13262f}'
    + '@media(max-width:720px){#squeeze-panel{top:auto;bottom:6px;left:6px;right:6px;width:auto;max-height:70vh}#squeeze-panel table{table-layout:auto}}';
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'squeeze-btn'; btn.textContent = 'SQUEEZE'; btn.title = 'Top 100 squeeze-risk names across the market, short squeeze and gamma squeeze (owner)'; toolbar.appendChild(btn);
  const panel = document.createElement('section'); panel.id = 'squeeze-panel'; panel.setAttribute('aria-label', 'Squeeze risk list');
  panel.innerHTML = '<header><b>SQUEEZE RISK · TOP 100</b><small class="asof"></small><button type="button" data-refresh="1">Rescan</button><button type="button" class="x" data-close="1" aria-label="Close">×</button></header><div class="st"></div>'
    + '<div class="body"><table><colgroup><col class="c-rk"><col class="c-nm"><col class="c-s"><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-fl"><col class="c-n"><col class="c-n"><col class="c-s"><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-fl"><col class="c-why"></colgroup>'
    + '<thead><tr><th>#</th><th>Name</th><th>Squeeze</th><th>Fuel</th><th>Spark</th><th title="GAMMA SQUEEZE: negative dealer gamma, calls stacked just above spot, the call wall, call buyers today, the gamma flip, hedge pressure, 0DTE. Dealers short those calls must buy stock as it rises.">Gamma</th><th>Trap</th><th title="The float: the supply shorts must buy back from. Micro under 5M, low under 20M, small under 50M.">Float</th><th>% Float</th><th title="Cover ratio: shares that must be bought back for every share freely available (short interest over the float that is not short). Above 1 = more owed than exist free.">Cover</th><th>Q</th><th>Pressing</th><th>Days to cover</th><th>Short vol</th><th>SI chg</th><th>Price vs 20d</th><th>Why</th></tr></thead>'
    + '<tbody></tbody></table></div><div class="note"></div>';
  document.body.appendChild(panel);
  const el = { asof: panel.querySelector('header .asof'), rescan: panel.querySelector('[data-refresh]'), st: panel.querySelector('.st'), tbody: panel.querySelector('tbody'), note: panel.querySelector('.note'), body: panel.querySelector('.body') };
  const openOut = (s) => { if (typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(s); };

  async function api(q) {
    const t = token(); if (!t) return { ok: false, error: 'authorization_required' };
    try { const res = await fetch('/academy-activity/squeeze-list' + (q || ''), { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' }); const j = await res.json().catch(() => null); return Object.assign({ status: res.status }, j || { ok: false, error: 'bad_response' }); } catch (_) { return { ok: false, error: 'network' }; }
  }
  const pc = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '–');
  const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
  const big = (v) => (!Number.isFinite(v) ? '–' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
  const cells = (r, rank) => '<td>' + rank + '</td><td class="sym">$' + esc(r.symbol) + (r.lane === 'low-float' ? ' <small class="lf" title="From the low-float lane of the scan">LF</small>' : '') + (r.name ? '<span class="nm">' + esc(r.name) + '</span>' : '') + '</td>'
    + '<td><span class="sc ' + (r.squeeze >= 70 ? 'hi' : r.squeeze >= 55 ? 'mid' : 'lo') + '">' + r.squeeze + '</span></td><td>' + (r.fuel == null ? '-' : r.fuel) + '</td><td>' + (r.spark == null ? '-' : r.spark) + '</td>'
    + '<td class="' + (r.gamma >= 65 ? 'up' : '') + '" title="' + esc((r.gammaBand || '') + (r.callWall ? ' · call wall ' + r.callWall.strike + ' (' + (r.callWall.distancePct >= 0 ? '+' : '') + r.callWall.distancePct + '%)' : '') + (r.putCallVol != null ? ' · put/call volume ' + r.putCallVol : '')) + '">' + (r.gamma == null ? '-' : r.gamma) + '</td>'
    + '<td class="' + (r.trap >= 50 ? 'dn' : '') + '">' + (r.trap == null ? '-' : r.trap) + '</td>'
    + '<td class="' + (r.floatKey === 'micro' || r.floatKey === 'low' ? 'up' : '') + '" title="' + esc(r.floatBand || '') + (r.floatTurn != null ? ' · turned ' + r.floatTurn + 'x today' : '') + '">' + big(r.floatShares) + (r.floatKey ? ' <small>' + esc(r.floatKey) + '</small>' : '') + '</td>'
    + '<td>' + (r.pctFloat == null ? '-' : n1(r.pctFloat) + '%') + '</td><td class="' + (r.coverRatio >= 1 ? 'up' : '') + '">' + (r.coverRatio == null ? '-' : r.coverRatio.toFixed(2)) + '</td>'
    + '<td title="' + esc(r.qstate ? 'Q-STATE: ' + r.qstate.dominant + ', squeeze ' + Math.round(r.qstate.squeeze * 100) + '%, entropy ' + r.qstate.entropy : '') + '">' + (r.qstate ? '<span class="sc ' + (r.qstate.dominant === 'squeeze' ? 'hi' : r.qstate.dominant === 'press' ? 'lo' : 'mid') + '">' + Math.round(r.qstate.squeeze * 100) + '%</span>' : '-') + '</td>'
    + '<td>' + (r.pressing == null ? '–' : r.pressing) + '</td><td>' + n1(r.daysToCover) + '</td><td>' + (r.shortRatio == null ? '–' : r.shortRatio.toFixed(0) + '%') + (r.shortRatioTrend != null ? ' <small class="' + (r.shortRatioTrend > 0 ? 'dn' : 'up') + '">' + (r.shortRatioTrend > 0 ? '▲' : '▼') + '</small>' : '') + '</td>'
    + '<td class="' + (r.siChangePct > 0 ? 'up' : r.siChangePct < 0 ? 'dn' : '') + '">' + pc(r.siChangePct) + '</td><td class="' + (r.aboveHigh ? 'up' : '') + '">' + (r.close == null ? '–' : r.close.toFixed(2)) + (r.aboveHigh ? ' ▲' : r.hi20 != null && r.close != null ? ' (' + pc((r.close / r.hi20 - 1) * 100) + ')' : '') + '</td>'
    + '<td><span class="why">' + esc((r.why || []).slice(0, 2).join(' · ') || r.call) + '</span></td>';

  /* rows patched in place by symbol; the order given is the order on screen */
  function patchRows(rows, order) {
    const by = new Map(rows.map((r) => [r.symbol, r]));
    const keep = new Set();
    let prev = null;
    order.forEach((sym, i) => {
      const r = by.get(sym); if (!r) return;
      keep.add(sym);
      let tr = el.tbody.querySelector('tr[data-sym="' + CSS.escape(sym) + '"]');
      if (!tr) { tr = document.createElement('tr'); tr.dataset.sym = sym; }
      const html = cells(r, i + 1);
      if (S.sigs.get(sym) !== html) { tr.innerHTML = html; S.sigs.set(sym, html); }
      const want = prev ? prev.nextSibling : el.tbody.firstChild;
      if (tr !== want) el.tbody.insertBefore(tr, want);
      prev = tr;
    });
    for (const tr of [...el.tbody.querySelectorAll('tr[data-sym]')]) if (!keep.has(tr.dataset.sym)) { S.sigs.delete(tr.dataset.sym); tr.remove(); }
    let empty = el.tbody.querySelector('tr.empty');
    if (!keep.size) { if (!empty) { empty = document.createElement('tr'); empty.className = 'empty'; el.tbody.appendChild(empty); } const t = S.building ? 'Reading…' : 'Nothing scored yet.'; if (empty.textContent !== t) empty.innerHTML = '<td colspan="17" style="text-align:center;color:#7f98a6;padding:16px">' + t + '</td>'; }
    else if (empty) empty.remove();
  }
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  function status(d) {
    if (S.msg) { el.st.textContent = S.msg; return; }
    if (!d) { el.st.textContent = ''; return; }
    let t = '', pct = null;
    if (d.building && d.phase === 'quick') { t = 'Sweep: pre-screening ' + d.quickTotal + ' names on fuel' + (d.quickCached ? ' (' + d.quickCached + ' from memory)' : '') + ' · ' + d.quickDone + ' done'; pct = d.quickTotal ? d.quickDone / d.quickTotal * 30 : 0; }
    else if (d.building) { t = 'Sweep: reading the top ' + d.total + ' in full (book, tape, chain, gamma) · ' + d.done + ' done'; pct = 30 + (d.total ? d.done / d.total * 70 : 0); }
    else if (d.error) t = d.error === 'no_universe' ? 'The scanner has no names right now.' : 'The last sweep failed; rescan.';
    if (d.building && d.paused) t += ' · paused a moment for memory';
    if (d.building) t += S.shown && S.shown.length ? ' · the list updates when the sweep completes' : ' · filling in';
    const html = esc(t) + (pct != null ? '<span class="bar"><i style="width:' + Math.round(pct) + '%"></i></span>' : '');
    if (el.st.innerHTML !== html) el.st.innerHTML = html;
  }
  function apply(d) {
    S.data = d; S.building = !!d.building;
    const have = S.shown && S.shown.length;
    if (d.building && have) {
      /* frozen: the last complete list stays put while the sweep runs */
      patchRows(S.shown, S.order);
    } else if (d.building) {
      /* first sweep ever: fill in by arrival, never re-sorted until it completes */
      const rows = d.rows || [];
      for (const r of rows) if (!S.order.includes(r.symbol)) S.order.push(r.symbol);
      S.pending = rows;
      patchRows(rows, S.order.filter((s) => rows.some((r) => r.symbol === s)));
    } else {
      const rows = (d.rows || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
      S.shown = rows; S.shownAt = d.asOf || Date.now(); S.order = rows.map((r) => r.symbol); S.pending = null;
      patchRows(rows, S.order);
    }
    status(d);
    setText(el.asof, d.asOf ? 'as of ' + new Date(S.shownAt || d.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (d.lastMs && !d.building ? ' · built in ' + Math.round(d.lastMs / 1000) + 's' : '') + (d.fromStore ? ' · last list' : '') : '');
    setText(el.note, (d.note || '') + ' Tap a row to load that chart; the SHORT SALE panel shows the full read.');
    el.rescan.disabled = !!d.building;
  }
  function paint() { panel.classList.toggle('open', S.open); btn.classList.toggle('on', S.open); if (S.open) status(S.data); }
  async function load(refresh) {
    if (S.busy) return; S.busy = true;
    const r = await api(refresh ? '?refresh=1' : '');
    S.busy = false;
    if (!r.ok) { S.msg = r.error === 'owner_only' ? 'This list is for the owner account.' : r.error === 'insight_unavailable' ? 'The short insight is not running on this server.' : 'Could not load the list right now.'; status(null); return; }
    S.msg = ''; apply(r);
    clearTimeout(S.timer);
    if (S.open && (r.building || r.fromStore || (!r.asOf && !r.error))) S.timer = setTimeout(() => load(false), r.phase === 'quick' ? 2500 : 4000);
  }
  function setOpen(on) { S.open = on; paint(); if (on) load(false); else clearTimeout(S.timer); }
  btn.addEventListener('click', () => setOpen(!S.open));
  panel.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-close],[data-refresh],tr[data-sym]') : null; if (!t) return;
    if (t.dataset.close) { setOpen(false); return; }
    if (t.dataset.refresh) { if (!t.disabled) load(true); return; }
    if (t.dataset.sym) { openOut(t.dataset.sym); if (window.matchMedia('(max-width:720px)').matches) setOpen(false); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) setOpen(false); });
  /* the button shows only once the server says this account is the owner; the list is fetched right away so the first open is instant */
  async function check() {
    const t = token(); if (!t || S.checked === t) return; S.checked = t;
    const r = await api('?probe=1');
    S.owner = Boolean(r.ok && r.owner);
    btn.classList.toggle('show', S.owner);
    if (!S.owner) setOpen(false); else if (!S.data) { const d = await api(''); if (d.ok) apply(d); }
  }
  window.addEventListener('sml-academy-session', () => setTimeout(check, 500));
  if (token()) check();
  window.smlSqueezeList = { open: () => setOpen(true), check, state: () => ({ owner: S.owner, open: S.open, rows: S.shown ? S.shown.length : el.tbody.querySelectorAll('tr[data-sym]').length, order: S.order.slice() }) };
})(0);
