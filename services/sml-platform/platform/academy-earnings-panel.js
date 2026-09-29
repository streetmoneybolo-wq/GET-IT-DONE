/* Earnings module for the Academy Live Chart Lab: a toolbar toggle that swaps the options chain
 * dock out for an earnings view of the same ticker, sourced from the already-wired but previously
 * unused /academy-activity/data/earnings bridge route (same Discord OAuth + paid-tier gate, same
 * verified-member data source, as the options chain). The provider's exact field names are not
 * pinned down anywhere else in this codebase (nothing called this route before), so rows are read
 * defensively by walking the payload for objects carrying any recognizable earnings field, the same
 * tolerant approach the options-chain script already uses for its own provider payloads.
 * Educational display only: nothing here places a trade. */
(() => {
  if (window.__smlEarnings) return;
  window.__smlEarnings = true;
  const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const clean = (v) => String(v || 'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 10) || 'SPY';
  const sym = () => clean(new URLSearchParams(location.search).get('symbol'));
  const pick = (object, keys) => { for (const key of keys) { const value = object && object[key]; if (value !== undefined && value !== null && value !== '') return value; } return null; };
  const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : '$' + Number(v).toFixed(2));
  const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(1) + '%');

  const KEY = 'sml-earnings-v1';
  const S = { on: false, session: '', symbol: '', rows: null, loading: false, error: '', prevTitle: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };

  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  const style = document.createElement('style');
  style.textContent = '.earnings-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2b6255;border-radius:7px;background:#052419;color:#9ee6cb;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.earnings-toggle.on{background:#0f5a41;border-color:#4dffc3;color:#fff}'
    + '#earnings-panel{padding:14px;border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dcebf4;font:600 .72rem system-ui,sans-serif;margin:0 0 18px}'
    + '#earnings-panel h2{margin:0 0 8px;font:800 .8rem ui-monospace,monospace;color:#42f5b3;letter-spacing:.03em}'
    + '#earnings-panel table{width:100%;border-collapse:collapse;font:600 .68rem ui-monospace,monospace}#earnings-panel th,#earnings-panel td{padding:6px 5px;text-align:right;border-bottom:1px solid rgba(42,66,78,.5)}#earnings-panel th{color:#8fa6b3;font-weight:700}'
    + '#earnings-panel td:first-child,#earnings-panel th:first-child{text-align:left}#earnings-panel td.pos{color:#52e6ad}#earnings-panel td.neg{color:#ff778b}#earnings-panel tr.next td{background:rgba(66,245,179,.08)}'
    + '#earnings-panel .note{margin-top:10px;color:#7f97a4;font-size:.62rem;line-height:1.4;font-weight:500}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'earnings-toggle'; btn.className = 'earnings-toggle'; btn.textContent = 'EARNINGS'; btn.title = 'Swap the options chain for the earnings calendar and history'; toolbar.appendChild(btn);
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); if (S.on) void load(); });

  function collectRows(value) {
    const found = [];
    const DATE_KEYS = ['date', 'reportDate', 'fiscalDateEnding', 'period', 'reportedDate'];
    const walk = (node) => {
      if (found.length >= 20 || !node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node !== 'object') return;
      if (DATE_KEYS.some((k) => node[k] != null)) { found.push(node); return; }
      Object.values(node).forEach(walk);
    };
    walk(value);
    return found;
  }
  function normalize(row) {
    const date = pick(row, ['date', 'reportDate', 'fiscalDateEnding', 'period', 'reportedDate']);
    const when = String(pick(row, ['time', 'hint', 'callTime']) || '').toLowerCase();
    return {
      date: date ? String(date).slice(0, 10) : 'Unknown',
      time: when.startsWith('b') ? 'Before open' : when.startsWith('a') ? 'After close' : '—',
      epsEstimate: num(pick(row, ['epsEstimate', 'estimatedEPS', 'eps_estimate', 'estimate'])),
      epsActual: num(pick(row, ['epsActual', 'actualEPS', 'eps_actual', 'actual', 'eps'])),
      revEstimate: num(pick(row, ['revenueEstimate', 'estimatedRevenue', 'revenue_estimate'])),
      revActual: num(pick(row, ['revenueActual', 'actualRevenue', 'revenue_actual', 'revenue'])),
      surprisePct: num(pick(row, ['surprisePercent', 'epsSurprisePercent', 'surprise_pct', 'surprise'])),
    };
  }

  async function load() {
    if (S.loading) return;
    const symbol = sym();
    // One attempt per symbol: rows stays an (empty) array after a failure so paint() shows the
    // error instead of treating "nothing loaded" as a reason to fetch again on every repaint.
    if (S.symbol === symbol && S.rows) return;
    S.loading = true; S.error = ''; S.symbol = symbol;
    try {
      const res = await fetch('/academy-activity/data/earnings?symbol=' + encodeURIComponent(symbol), { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'unavailable');
      const rows = collectRows(payload.data).map(normalize).sort((a, b) => a.date.localeCompare(b.date));
      S.rows = rows;
      if (!rows.length) S.error = 'The provider returned no recognized earnings records for this ticker.';
    } catch (_) { S.error = 'Earnings data is temporarily unavailable.'; S.rows = []; }
    S.loading = false; paint();
  }

  function panel() {
    let el = document.getElementById('earnings-panel');
    if (!el) {
      el = document.createElement('section'); el.id = 'earnings-panel'; el.setAttribute('aria-label', 'Earnings calendar and history');
      const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
      if (dock && dock.parentElement) dock.parentElement.insertBefore(el, dock); else document.body.appendChild(el);
    }
    return el;
  }

  function paint() {
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    const title = document.querySelector('.below-title');
    if (!S.on) {
      const el = document.getElementById('earnings-panel'); if (el) el.style.display = 'none';
      if (dock) dock.style.display = '';
      if (title && S.prevTitle) title.textContent = S.prevTitle;
      return;
    }
    if (dock) dock.style.display = 'none';
    if (title && !S.prevTitle) { S.prevTitle = title.textContent; title.textContent = 'EARNINGS · CALENDAR + HISTORY'; }
    const el = panel(); el.style.display = '';
    if (!S.session) { el.innerHTML = '<h2>EARNINGS</h2><p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; return; }
    if (S.symbol !== sym()) { S.rows = null; S.error = ''; }
    if (S.loading) { el.innerHTML = '<h2>EARNINGS</h2><p class="note">Loading…</p>'; return; }
    if (!S.rows) { void load(); el.innerHTML = '<h2>EARNINGS</h2><p class="note">Loading…</p>'; return; }
    if (S.error && !S.rows.length) { el.innerHTML = '<h2>EARNINGS</h2><p class="note">' + S.error + '</p>'; return; }
    const today = new Date().toISOString().slice(0, 10);
    const nextIdx = S.rows.findIndex((r) => r.date >= today);
    el.innerHTML = '<h2>EARNINGS · ' + sym() + '</h2><table><thead><tr><th>Date</th><th>When</th><th>EPS est.</th><th>EPS actual</th><th>Surprise</th><th>Revenue est.</th><th>Revenue actual</th></tr></thead><tbody>'
      + S.rows.map((r, i) => '<tr' + (i === nextIdx ? ' class="next"' : '') + '><td>' + r.date + '</td><td>' + r.time + '</td><td>' + money(r.epsEstimate) + '</td><td>' + money(r.epsActual) + '</td>'
        + '<td class="' + (r.surprisePct > 0 ? 'pos' : r.surprisePct < 0 ? 'neg' : '') + '">' + pct(r.surprisePct) + '</td><td>' + (r.revEstimate == null ? '—' : '$' + (r.revEstimate / 1e9).toFixed(2) + 'B') + '</td><td>' + (r.revActual == null ? '—' : '$' + (r.revActual / 1e9).toFixed(2) + 'B') + '</td></tr>').join('')
      + '</tbody></table><p class="note">' + (nextIdx >= 0 ? 'Highlighted row is the next scheduled report on or after today.' : 'No upcoming report date was returned; rows below are historical.') + ' Estimates and actuals come from the verified Academy data provider. A beat or miss on EPS is not, by itself, a signal to trade the underlying. Educational only.</p>';
  }

  function sync() { btn.classList.toggle('on', S.on); }
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.rows = null; S.error = ''; S.symbol = ''; if (S.session) void load(); } paint(); }); // turning the panel on is the one deliberate retry
  window.addEventListener('sml-live-data', () => { if (S.on && S.symbol !== sym()) void load(); });
  sync();
  // the options dock boots asynchronously; wait for it to exist (or give up and show the panel where it would have been) before doing the first paint
  (function boot(tries) { if (S.on && !document.getElementById('options-dock') && !document.getElementById('options-chain') && tries < 60) { setTimeout(() => boot(tries + 1), 200); return; } paint(); })(0);
})();
