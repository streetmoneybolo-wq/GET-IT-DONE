/* CATALYSTS for the Academy Live Chart Lab: a toolbar toggle that swaps the options dock for three tabs,
 *   EARNINGS  the best upcoming reports, what the options market prices vs what the stock has done, and the plays with their hedge
 *   FDA       upcoming decisions with an approval read, an impact read and the hedge for the play
 *   RADAR     names showing the fingerprints that precede surprise news
 * Everything comes from /academy-activity/earnings-playbook, /fda and /catalyst-radar (Discord session + paid tier). A tab whose
 * route is not live yet says so. Educational display only: nothing here places a trade. */
(() => {
  if (window.__smlCatalysts) return;
  window.__smlCatalysts = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pct = (v, d = 1) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%');
  const apct = (v, d = 1) => (num(v) == null ? '—' : Number(v).toFixed(d) + '%');
  const usd = (v) => (num(v) == null ? '—' : '$' + Number(v).toFixed(2));
  const sym = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();
  const KEY = 'sml-catalysts-v1';
  const S = { on: false, tab: 'earnings', session: String(window.smlAcademySessionToken || ''), data: { earnings: null, fda: null, radar: null }, err: {}, busy: {}, open: new Set(), prevTitle: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.on = v.on === true; if (['earnings', 'fda', 'radar'].includes(v.tab)) S.tab = v.tab; } } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on, tab: S.tab })); } catch (_) { /* ignore */ } };
  const toolbar = document.querySelector('.toolbar'); if (!toolbar) return;

  const style = document.createElement('style');
  style.textContent = '.catalysts-toggle{margin-left:4px;padding:5px 9px;border:1px solid #5a4a1c;border-radius:7px;background:#241c05;color:#f3d27a;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.catalysts-toggle.on{background:#6b530f;border-color:#ffd66b;color:#fff}'
    + '#catalysts-panel{padding:14px;border:1px solid #3a3118;border-radius:10px;background:#0f0d07;color:#efe6cf;font:600 .72rem system-ui,sans-serif;margin:0 0 18px}'
    + '#catalysts-panel h2{margin:0 0 8px;font:800 .8rem ui-monospace,monospace;color:#ffd66b;letter-spacing:.03em}'
    + '#catalysts-panel .tabs{display:flex;gap:6px;margin:0 0 10px}#catalysts-panel .tabs button{padding:5px 10px;border:1px solid #4a3d1a;border-radius:6px;background:#1a1507;color:#d9c48a;font:800 .62rem ui-monospace,monospace;cursor:pointer}#catalysts-panel .tabs button.on{background:#6b530f;color:#fff;border-color:#ffd66b}'
    + '#catalysts-panel table{width:100%;border-collapse:collapse;font:600 .66rem ui-monospace,monospace}#catalysts-panel th,#catalysts-panel td{padding:6px 5px;text-align:right;border-bottom:1px solid rgba(90,74,28,.45);vertical-align:top}#catalysts-panel th{color:#b9a56a;font-weight:700}#catalysts-panel td:first-child,#catalysts-panel th:first-child{text-align:left}'
    + '#catalysts-panel tr.row{cursor:pointer}#catalysts-panel tr.row:hover td{background:rgba(255,214,107,.06)}#catalysts-panel tr.open td{background:rgba(255,214,107,.08)}'
    + '#catalysts-panel .score{display:inline-block;min-width:34px;text-align:center;padding:2px 5px;border-radius:5px;font-weight:800}#catalysts-panel .score.a{background:#1f5a2a;color:#9ff0b0}#catalysts-panel .score.b{background:#4d4a12;color:#f3e27a}#catalysts-panel .score.c{background:#4a2a12;color:#f3b27a}#catalysts-panel .score.d{background:#4a1a1a;color:#ff9a9a}'
    + '#catalysts-panel .cheap{color:#52e6ad}#catalysts-panel .rich{color:#ff9a7a}#catalysts-panel .detail{padding:8px 10px 12px;background:#15110a;border-radius:8px;margin:6px 0 10px;font:600 .66rem system-ui,sans-serif;color:#efe6cf}'
    + '#catalysts-panel .play{border:1px solid #3a3118;border-radius:8px;padding:8px 10px;margin:8px 0;background:#0f0d07}#catalysts-panel .play b{color:#ffd66b}#catalysts-panel .play .legs{font:700 .64rem ui-monospace,monospace;color:#d9c48a;margin:4px 0}#catalysts-panel .play .hedge{color:#9ee6cb}#catalysts-panel .play .risk{color:#c9a68a}'
    + '#catalysts-panel h3.sub{margin:12px 0 4px;font:800 .66rem ui-monospace,monospace;color:#ffd66b;letter-spacing:.08em}#catalysts-panel .tag{display:inline-block;padding:1px 6px;border-radius:4px;background:#2a2410;color:#d9c48a;font:800 .58rem ui-monospace,monospace;margin-right:4px}'
    + '#catalysts-panel .note{margin-top:10px;color:#a3936a;font-size:.62rem;line-height:1.4;font-weight:500}#catalysts-panel a.chart{color:#ffd66b;text-decoration:none;font-weight:800}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'catalysts-toggle'; btn.className = 'catalysts-toggle'; btn.textContent = 'CATALYSTS'; btn.title = 'Earnings playbook, FDA decisions and the surprise-news radar'; toolbar.appendChild(btn);
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.data = { earnings: null, fda: null, radar: null }; S.err = {}; if (S.on) { void load(S.tab); paint(); } });

  /* the token lives 15 minutes and the session event can fire before this script listens: always prefer the live one */
  const live = () => { const t = String(window.smlAcademySessionToken || ''); if (t) S.session = t; return S.session; };
  const ROUTES = { earnings: '/academy-activity/earnings-playbook?days=14&limit=12', fda: '/academy-activity/fda?days=75&limit=20', radar: '/academy-activity/catalyst-radar' };
  async function load(tab) {
    live();
    if (!S.session || S.busy[tab]) return;
    S.busy[tab] = true; S.err[tab] = '';
    try {
      const go = (tok) => fetch(ROUTES[tab], { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
      let res = await go(S.session);
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); if (fresh) { S.session = String(fresh); res = await go(S.session); } }
      const payload = await res.json().catch(() => ({}));
      if (res.status === 404 || res.status === 503) { S.err[tab] = res.status === 404 ? 'This tab is not live yet.' : (payload.message || 'Not available right now. Try again in a minute.'); S.data[tab] = null; }
      else if (!res.ok || !payload.ok) throw new Error(payload.error || 'unavailable');
      else S.data[tab] = payload;
    } catch (_) { S.err[tab] = 'Temporarily unavailable.'; S.data[tab] = null; }
    S.busy[tab] = false; paint();
  }

  function panel() {
    let el = document.getElementById('catalysts-panel');
    if (!el) {
      el = document.createElement('section'); el.id = 'catalysts-panel'; el.setAttribute('aria-label', 'Catalysts: earnings, FDA, radar');
      const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
      if (dock && dock.parentElement) dock.parentElement.insertBefore(el, dock); else document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; save(); if (!S.data[S.tab]) void load(S.tab); paint(); return; }
        const r = e.target.closest('tr.row'); if (r && !e.target.closest('a')) { const k = r.dataset.key; if (S.open.has(k)) S.open.delete(k); else S.open.add(k); paint(); }
      });
    }
    return el;
  }
  const grade = (s) => (s >= 75 ? 'a' : s >= 60 ? 'b' : s >= 45 ? 'c' : 'd');
  const chartLink = (s) => '<a class="chart" href="?' + new URLSearchParams(Object.assign(Object.fromEntries(new URLSearchParams(location.search)), { symbol: s })).toString() + '" title="Open ' + esc(s) + ' on the chart">' + esc(s) + '</a>';

  function legsHtml(p) {
    if (Array.isArray(p.legs) && p.legs.length) return '<div class="legs">' + p.legs.map((l) => esc(l.action.toUpperCase()) + ' ' + esc(l.expiry || '') + ' ' + esc(l.strike) + ' ' + esc(l.type) + (l.mid != null ? ' @ ' + usd(l.mid) : '') + (l.oi ? ' · OI ' + l.oi : '')).join('<br>') + '</div>';
    if (p.plan) return '<div class="legs">' + Object.entries(p.plan).map(([k, v]) => esc(k) + ': ' + esc(v)).join('<br>') + '</div>';
    return '';
  }
  function playHtml(p) {
    const money = [p.credit != null ? 'credit ' + usd(p.credit) : null, p.debit != null ? 'cost ' + usd(p.debit) : null, p.maxLoss != null ? 'max loss ' + usd(p.maxLoss) : null, p.maxGain != null ? 'max gain ' + usd(p.maxGain) : null, p.maxGain === null && p.key === 'long_straddle' ? 'max gain open' : null, p.floor != null ? 'floor ' + usd(p.floor) + ' · cap ' + usd(p.cap) : null, Array.isArray(p.breakevens) && p.breakevens.length ? 'breakeven ' + p.breakevens.map(usd).join(' / ') : null].filter(Boolean).join(' · ');
    return '<div class="play"><span class="tag">' + esc(p.style) + '</span><span class="tag">' + esc(p.stance) + '</span><b>' + esc(p.name) + '</b><div>' + esc(p.why) + '</div>' + legsHtml(p) + (money ? '<div class="legs">' + esc(money) + '</div>' : '') + '<div class="hedge">Hedge: ' + esc(p.hedge) + '</div>' + (p.risks || []).map((r) => '<div class="risk">Risk: ' + esc(r) + '</div>').join('') + '</div>';
  }
  function earningsDetail(e) {
    const im = e.implied, h = e.history, m = e.mem;
    return '<tr><td colspan="8"><div class="detail">'
      + '<div><b>' + esc(e.name || e.symbol) + '</b> reports ' + esc(e.date) + (e.timing && e.timing !== 'UNSPECIFIED' ? ' (' + (e.timing === 'AMC' ? 'after the close' : 'before the open') + ')' : '') + ' · price ' + usd(e.price) + ' · ATR ' + usd(e.atr) + (e.epsEstimate != null ? ' · EPS est. ' + usd(e.epsEstimate) : '') + '</div>'
      + '<div>' + (im ? 'Options price a move of about <b>' + apct(im.impliedPct) + '</b> (ATM straddle ' + usd(im.straddle) + ' at ' + esc(im.expiry) + ', IV ' + (im.ivAtm != null ? im.ivAtm + '%' : '—') + ')' : 'No options chain covered the report') + '. '
      + (h && h.n ? 'Past ' + h.n + ' reports moved <b>' + apct(h.avgAbsPct) + '</b> on average (largest ' + apct(h.maxAbsPct) + ', ' + h.up + ' up / ' + h.down + ' down).' : 'No usable report history.') + ' <i>' + esc(e.read) + '</i></div>'
      + (m ? '<div>MEM ALGO (swing, daily): ' + esc(m.bias) + (m.latest ? ', last signal ' + (m.latest.dir > 0 ? 'BUY' : 'SELL') + (m.latest.conf ? ' grade ' + esc(m.latest.conf.grade) + ' (' + m.latest.conf.score + ')' : '') : '') + (m.winRate != null ? ' · backtest win rate ' + Math.round(m.winRate * 100) + '%' : '') + (e.sentiment != null ? ' · sentiment ' + pct(e.sentiment * 100, 0) : '') + '</div>' : '')
      + (h && h.moves && h.moves.length ? '<div class="legs">' + h.moves.map((x) => esc(x.date) + ' ' + pct(x.movePct)).join(' · ') + '</div>' : '')
      + (e.strategies || []).map(playHtml).join('')
      + (Array.isArray(e.hedgeIdeas) && e.hedgeIdeas.length ? '<div class="play"><b>Hedge &amp; Income planner</b>' + e.hedgeIdeas.map((i) => '<div>' + esc(i.name || i.title || i.kind || '') + (i.summary ? ': ' + esc(i.summary) : '') + '</div>').join('') + '</div>' : '')
      + '</div></td></tr>';
  }
  function earningsHtml() {
    const d = S.data.earnings;
    if (S.err.earnings) return '<p class="note">' + esc(S.err.earnings) + '</p>';
    if (!d) return '<p class="note">Loading the next two weeks of reports…</p>';
    if (!d.available || !d.events || !d.events.length) return '<p class="note">' + esc(d.reason === 'calendar_unavailable' ? 'The earnings calendar is not available right now.' : 'No liquid names report in the next ' + (d.window ? d.window.days : 14) + ' days.') + '</p>';
    const rows = d.events.map((e) => { const k = 'e:' + e.symbol + ':' + e.date; const open = S.open.has(k);
      return '<tr class="row' + (open ? ' open' : '') + '" data-key="' + esc(k) + '"><td>' + chartLink(e.symbol) + '</td><td>' + esc(e.date) + '</td><td>' + esc(e.timing === 'AMC' ? 'after' : e.timing === 'BMO' ? 'before' : '—') + '</td><td>' + (e.implied ? apct(e.implied.impliedPct) : '—') + '</td><td>' + (e.history && e.history.n ? apct(e.history.avgAbsPct) : '—') + '</td><td class="' + (e.edge == null ? '' : e.edge >= 1.25 ? 'cheap' : e.edge <= 0.8 ? 'rich' : '') + '">' + (e.edge == null ? '—' : e.edge >= 1.25 ? 'cheap' : e.edge <= 0.8 ? 'rich' : 'fair') + '</td><td>' + esc(e.mem ? e.mem.bias : '—') + '</td><td><span class="score ' + grade(e.score) + '">' + e.score + '</span></td></tr>' + (open ? earningsDetail(e) : ''); }).join('');
    return '<table><thead><tr><th>Ticker</th><th>Date</th><th>When</th><th>Priced move</th><th>Past avg</th><th>Premium</th><th>MEM read</th><th>Setup</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<p class="note">' + esc(d.window ? d.window.start + ' to ' + d.window.end + ', ' + d.considered + ' reports considered, ' + d.events.length + ' liquid enough to study. ' : '') + 'Click a row for the plays and the hedge for each. ' + esc(d.note || '') + '</p>';
  }
  function placeholderHtml(tab) { return '<p class="note">' + esc(S.err[tab] || 'Loading…') + '</p>'; }

  function fdaDetail(e) {
    const ap = e.approval, im = e.impact, pm = e.implied;
    const inputs = (list) => '<div class="legs">' + list.map((i) => esc(i.k) + ' <b>' + esc(i.v) + '</b>').join(' · ') + '</div>';
    return '<tr><td colspan="7"><div class="detail">'
      + '<div><b>' + esc(e.company || e.symbol) + '</b> · decision due ' + esc(e.date) + ' (' + e.daysAway + ' days) · price ' + usd(e.price) + (e.marketCap ? ' · size $' + (e.marketCap >= 1e9 ? (e.marketCap / 1e9).toFixed(1) + 'B' : Math.round(e.marketCap / 1e6) + 'M') : '') + (e.shortDays != null ? ' · short interest ' + e.shortDays + ' days to cover' : '') + '</div>'
      + '<div class="legs">' + esc(e.sentence) + '</div>'
      + '<div>Approval read <b>' + ap.pct + '%</b> (' + esc(ap.label) + ')' + inputs(ap.inputs) + '<i>' + esc(ap.note) + '</i></div>'
      + '<div>Impact read <b>' + im.score + '/100</b> (' + esc(im.label) + ')' + inputs(im.inputs) + (pm ? '<div>Options price about <b>' + apct(pm.impliedPct) + '</b> through ' + esc(pm.expiry) + ' (ATM straddle ' + usd(pm.straddle) + ').</div>' : '') + '</div>'
      + (e.plays || []).map(playHtml).join('')
      + (Array.isArray(e.hedgeIdeas) && e.hedgeIdeas.length ? '<div class="play"><b>Hedge &amp; Income planner</b>' + e.hedgeIdeas.map((i) => '<div>' + esc(i.name || i.title || i.kind || '') + (i.summary ? ': ' + esc(i.summary) : '') + '</div>').join('') + '</div>' : '')
      + '<div class="note">Source: ' + esc(e.source.form) + ' filed ' + esc(e.source.filed) + ' · <a class="chart" href="' + esc(e.source.url) + '" target="_blank" rel="noopener">read the release</a></div>'
      + '</div></td></tr>';
  }
  window.smlCatalystsRadar = function radarHtml(st) {
    const d = st.data.radar;
    if (st.err.radar) return '<p class="note">' + esc(st.err.radar) + '</p>';
    if (!d) return '<p class="note">Scanning the moving names for pre-announcement fingerprints… (first load can take a minute)</p>';
    if (!d.available || !d.rows || !d.rows.length) return '<p class="note">Nothing is showing the fingerprints right now.</p>';
    const rows = d.rows.map((x) => { const k = 'r:' + x.symbol; const open = st.open.has(k);
      const det = open ? '<tr><td colspan="7"><div class="detail"><div><b>' + esc(x.symbol) + '</b> · ' + usd(x.price) + ' (' + pct(x.changePct) + ' today)' + (x.relVol != null ? ' · volume ' + x.relVol + '× normal' : '') + (x.ivAtm != null && x.realizedVol != null ? ' · implied ' + Math.round(x.ivAtm) + '% vs realized ' + Math.round(x.realizedVol) + '%' : '') + '</div>'
        + '<div class="legs">' + (x.reasons.length ? x.reasons.map((r) => esc(r.k) + ' <b>+' + r.v + '</b>').join('<br>') : 'no fingerprints') + '</div>'
        + (x.news && x.news.drivers && x.news.drivers.length ? '<div>Latest news: ' + x.news.drivers.map((n) => esc(n.title)).join(' · ') + '</div>' : '')
        + '<div class="note">Lean: ' + esc(x.lean) + '. ' + (x.tags.length ? x.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') : '') + ' Nothing here knows what the news is; it only sees the market acting as if there is some. A protective put or a collar (see the EARNINGS tab plays) is the honest way to hold through an unknown.</div></div></td></tr>' : '';
      return '<tr class="row' + (open ? ' open' : '') + '" data-key="' + esc(k) + '"><td>' + chartLink(x.symbol) + '</td><td>' + pct(x.changePct) + '</td><td>' + (x.relVol != null ? x.relVol + '×' : '—') + '</td><td>' + esc(x.lean) + '</td><td>' + x.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</td><td>' + x.reasons.length + '</td><td><span class="score ' + grade(x.score) + '">' + x.score + '</span></td></tr>' + det; }).join('');
    return '<table><thead><tr><th>Ticker</th><th>Today</th><th>Rel. vol</th><th>Lean</th><th>Tags</th><th>Signs</th><th>Radar</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<p class="note">' + d.scanned + ' of ' + d.universe + ' moving names scanned. Click a row for the evidence. ' + esc(d.note || '') + '</p>';
  };
  window.smlCatalystsFda = function fdaHtml(st) {
    const d = st.data.fda;
    if (st.err.fda) return '<p class="note">' + esc(st.err.fda) + '</p>';
    if (!d) return '<p class="note">Reading the latest FDA filings on EDGAR… (first load can take a minute)</p>';
    if (!d.available || !d.events || !d.events.length) return '<p class="note">' + esc(d.reason === 'edgar_unavailable' ? 'EDGAR is not answering right now.' : 'No PDUFA dates found in the next ' + (d.window ? d.window.days : 60) + ' days.') + '</p>';
    const flag = (e) => [e.flags.priorityReview ? 'priority' : null, e.flags.breakthrough ? 'breakthrough' : null, e.flags.resubmission ? 'resubmission' : null, e.flags.supplemental ? 'supplemental' : null, e.flags.adcomPlanned ? 'AdCom' : null].filter(Boolean).map((f) => '<span class="tag">' + f + '</span>').join('');
    const row = (e) => { const k = 'f:' + e.symbol + ':' + e.date + ':' + e.kind; const open = st.open.has(k);
      const when = e.kind === 'anytime' ? '<td colspan="2"><span class="tag">ANY DAY</span> ' + esc(e.window ? e.window.label : '') + '</td>' : '<td>' + esc(e.date) + '</td><td>' + e.daysAway + 'd</td>';
      return '<tr class="row' + (open ? ' open' : '') + '" data-key="' + esc(k) + '"><td>' + chartLink(e.symbol) + '</td>' + when + '<td>' + flag(e) + '</td><td><span class="score ' + grade(e.approval.pct) + '">' + e.approval.pct + '%</span></td><td><span class="score ' + grade(e.impact.score) + '">' + e.impact.score + '</span></td><td>' + (e.implied ? apct(e.implied.impliedPct) : '—') + '</td></tr>' + (open ? fdaDetail(e) : ''); };
    const head = '<thead><tr><th>Ticker</th><th colspan="2">Decision</th><th>Review</th><th>Approval</th><th>Impact</th><th>Priced move</th></tr></thead>';
    const sched = d.events.filter((e) => e.kind !== 'anytime'), any = d.events.filter((e) => e.kind === 'anytime');
    return (sched.length ? '<h3 class="sub">SCHEDULED DECISIONS</h3><table>' + head + '<tbody>' + sched.map(row).join('') + '</tbody></table>' : '<p class="note">No exact PDUFA dates are on file through ' + esc(d.window ? d.window.end : '') + '.</p>')
      + (any.length ? '<h3 class="sub">COULD LAND ANY DAY</h3><p class="note">Pending applications whose date has passed without news, or whose company only gave a window. Approvals and rejections can be announced with no warning, often before the open or after the close.</p><table>' + head + '<tbody>' + any.map(row).join('') + '</tbody></table>' : '')
      + '<p class="note">' + sched.length + ' scheduled, ' + any.length + ' on watch. Click a row for the reads, the plays and the hedge for each. ' + esc(d.note || '') + '</p>';
  };

  function paint() {
    const dock = document.getElementById('options-dock') || document.getElementById('options-chain');
    const title = document.querySelector('.below-title');
    const earningsEl = document.getElementById('earnings-panel');
    if (!S.on) { const el = document.getElementById('catalysts-panel'); if (el) el.style.display = 'none'; if (dock && !(earningsEl && earningsEl.style.display !== 'none')) dock.style.display = ''; if (title && S.prevTitle) { title.textContent = S.prevTitle; S.prevTitle = ''; } return; }
    if (dock) dock.style.display = 'none';
    if (earningsEl) earningsEl.style.display = 'none';
    if (title && !S.prevTitle) { S.prevTitle = title.textContent; title.textContent = 'CATALYSTS · EARNINGS · FDA · RADAR'; }
    const el = panel(); el.style.display = '';
    const tabs = '<div class="tabs">' + [['earnings', 'EARNINGS'], ['fda', 'FDA'], ['radar', 'RADAR']].map(([k, l]) => '<button type="button" data-tab="' + k + '" class="' + (S.tab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    live();
    if (!S.session) { el.innerHTML = '<h2>CATALYSTS</h2>' + tabs + '<p class="note">Unlock Academy Tools first so Discord can verify private Academy access.</p>'; return; }
    if (!S.data[S.tab] && !S.err[S.tab] && !S.busy[S.tab]) void load(S.tab);
    el.innerHTML = '<h2>CATALYSTS</h2>' + tabs + (S.tab === 'earnings' ? earningsHtml() : S.tab === 'fda' ? (window.smlCatalystsFda ? window.smlCatalystsFda(S) : placeholderHtml('fda')) : (window.smlCatalystsRadar ? window.smlCatalystsRadar(S) : placeholderHtml('radar')));
  }
  window.smlCatalystsPaint = paint; window.smlCatalystsState = S;
  const sync = () => btn.classList.toggle('on', S.on);
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.data = { earnings: null, fda: null, radar: null }; S.err = {}; if (S.session) void load(S.tab); } paint(); });
  sync();
  (function boot(tries) { if (S.on && !document.getElementById('options-dock') && !document.getElementById('options-chain') && tries < 60) { setTimeout(() => boot(tries + 1), 200); return; } paint(); })(0);
})();
