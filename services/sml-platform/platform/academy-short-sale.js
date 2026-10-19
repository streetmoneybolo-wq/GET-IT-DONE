/* Daily short-sale analysis panel for the Academy Live Chart Lab, fed by the Academy's own
 * short-data lookup (/academy-activity/data/short, gated behind Discord OAuth + a paid tier, same
 * as the options chain and earnings). Two distinct things can come back from that lookup and both
 * are shown when present: a daily short-VOLUME history ({volume:[{date,short,total,ratio}]}, the
 * FINRA-style feed also used by the news engine's short-volume trigger) and short INTEREST
 * ({summary:{avg_ratio}, interest:[{days_to_cover,...}]}, the bi-monthly settlement figure the
 * alerts desk's risk grader already reads). Educational display only: nothing here places a trade. */
(() => {
  if (window.__smlShortSale) return;
  window.__smlShortSale = true;
  const num = (v, d = 1) => (Number.isFinite(v) ? Number(v).toFixed(d) : '–');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const whole = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');
  const sym = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();
  const clean = (v) => String(v || 'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 10) || 'SPY';

  const KEY = 'sml-short-sale-v1';
  const S = { on: false, session: '', symbol: '', data: null, loading: false, error: '', ins: null, insSymbol: '', insLoading: false, insAt: 0 };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };

  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  const style = document.createElement('style');
  style.textContent = '.shortsale-toggle{margin-left:4px;padding:5px 9px;border:1px solid #62402b;border-radius:7px;background:#241505;color:#e6b99e;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.shortsale-toggle.on{background:#5a2a12;border-color:#ff9f6b;color:#fff}'
    + '.academy-shortsale{margin-top:10px;border-top:1px solid #1b3540;padding-top:8px;font:600 .62rem system-ui,sans-serif;color:#c7d5dc}.academy-shortsale h4{margin:0 0 6px;font:800 .58rem ui-monospace;color:#86a2b0;letter-spacing:.06em}'
    + '.academy-shortsale .kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0;font:600 .6rem ui-monospace,monospace}.academy-shortsale .kv span:nth-child(odd){color:#8fa6b3}'
    + '.academy-shortsale .day{display:grid;grid-template-columns:56px 1fr 40px;gap:2px 6px;align-items:center;margin:2px 0;font:600 .58rem ui-monospace,monospace}.academy-shortsale .day b{display:block;height:7px;border-radius:3px;background:#ff9f6b}'
    + '.academy-shortsale .warn{color:#ffd166}.academy-shortsale .lo{color:#5df0b0}'
    + '.academy-shortsale small{display:block;margin-top:5px;color:#6f8794;font-weight:500;font-size:.54rem;line-height:1.35}'
    /* the insight: two scores, the short-volume-vs-price strip, the verdicts */
    + '.academy-shortsale .si-scores{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}.academy-shortsale .si-score{padding:6px 7px;border:1px solid #2a3a44;border-radius:7px;background:rgba(255,255,255,.03)}.academy-shortsale .si-score span{display:block;font:800 .5rem ui-monospace,monospace;letter-spacing:.08em;color:#8fa6b3}.academy-shortsale .si-score b{display:block;font:800 1rem ui-monospace,monospace;color:#fff}.academy-shortsale .si-score i{display:block;height:4px;border-radius:2px;background:#1b2a35;margin-top:4px;overflow:hidden}.academy-shortsale .si-score i em{display:block;height:100%}'
    + '.academy-shortsale .si-strip{display:grid;grid-template-columns:repeat(10,1fr);gap:2px;align-items:end;height:40px;margin:4px 0 2px}.academy-shortsale .si-strip b{display:block;border-radius:2px 2px 0 0;background:#e6b99e;opacity:.85}.academy-shortsale .si-strip b.dn{background:#ff778b}.academy-shortsale .si-strip b.up{background:#5df0b0}'
    + '.academy-shortsale .si-v{margin:6px 0 0;padding:6px 8px;border-left:3px solid #4a5a66;background:rgba(255,255,255,.03);border-radius:0 6px 6px 0;font:600 .58rem/1.4 system-ui,sans-serif;color:#dbe6ec}.academy-shortsale .si-v.up{border-color:#00d084}.academy-shortsale .si-v.down{border-color:#ff5470}.academy-shortsale .si-v.flat{border-color:#ffd166}.academy-shortsale .si-v b{display:block;font:800 .52rem ui-monospace,monospace;letter-spacing:.08em;color:#8fa6b3;margin-bottom:2px}.academy-shortsale .si-v ul{margin:3px 0 0;padding-left:12px;color:#b8c9d3;font-weight:500}'
    + '.academy-shortsale .si-src{margin-top:4px;color:#6f8794;font:700 .5rem ui-monospace,monospace;letter-spacing:.04em}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'shortsale-toggle'; btn.className = 'shortsale-toggle'; btn.textContent = 'SHORT SALE'; btn.title = 'Daily short-sale volume and short-interest analysis'; toolbar.appendChild(btn);

  // The session arrives well after live polling starts; forget any earlier attempt so the first authenticated lookup actually runs and repaints.
  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.symbol = ''; S.data = null; S.error = ''; if (S.on) { void load(); paint(); } });

  function pickDays(volumeRows) {
    return volumeRows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10)
      .map((r) => ({ date: r.date, short: Number(r.short), total: Number(r.total), ratio: Number(r.ratio) }));
  }
  function trendNote(days) {
    if (days.length < 3) return '';
    const r = days.slice(0, 3).map((d) => d.ratio);
    if (Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2]) && r[0] > r[1] && r[1] > r[2] && r[0] - r[2] >= 5) return 'Short volume has risen for 3 straight sessions (' + r[2].toFixed(0) + '% → ' + r[0].toFixed(0) + '%) — a building trend, not just one heavy day.';
    if (Number.isFinite(r[0]) && Number.isFinite(r[2]) && r[2] > r[0] && r[2] - r[0] >= 5) return 'Short volume has fallen for 3 straight sessions (' + r[2].toFixed(0) + '% → ' + r[0].toFixed(0) + '%).';
    return '';
  }

  async function load() {
    if (S.loading || !S.session) return; // without a session the route can only answer 401: nothing to remember yet
    const symbol = clean(sym());
    // One attempt per symbol: a failed or empty lookup is remembered as such, otherwise every
    // repaint would re-fetch (paint -> load -> paint) and hammer the gated route in a loop.
    if (S.symbol === symbol && (S.data || S.error)) return;
    S.loading = true; S.error = ''; S.symbol = symbol;
    try {
      const res = await fetch('/academy-activity/data/short?symbol=' + encodeURIComponent(symbol), { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'unavailable');
      S.data = payload.data;
      if (!S.data) S.error = 'No short-sale data was returned for this ticker.';
    } catch (_) { S.error = 'Short-sale data is temporarily unavailable.'; S.data = null; }
    S.loading = false; paint();
  }

  /* the insight (academy-short-insight.js): the short feed read with the Level 3 book, the Massive tape, the flow ledger and the chain */
  async function loadInsight(symbol) {
    if (S.insLoading || !S.session) return;
    S.insLoading = true; S.insSymbol = symbol;
    try {
      const res = await fetch('/academy-activity/short-insight?symbol=' + encodeURIComponent(symbol), { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' });
      const j = await res.json().catch(() => null);
      S.ins = j && j.ok ? j : { ok: false, error: (j && j.error) || ('http_' + res.status) };
    } catch (_) { S.ins = { ok: false, error: 'network' }; }
    S.insAt = Date.now(); S.insLoading = false; paint();
  }
  const pcts = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '–');
  function insightHtml() {
    const d = S.ins;
    if (!d) return '<h4 style="margin-top:8px">SHORT INSIGHT</h4><small>Reading the book, the tape and the ledger…</small>';
    if (!d.ok) return '<h4 style="margin-top:8px">SHORT INSIGHT</h4><small>' + esc(d.error === 'academy_access_required' ? 'Part of the full Academy.' : 'Not available right now.') + '</small>';
    if (!d.available) return '';
    const sc = (label, s, tone) => '<div class="si-score"><span>' + label + '</span><b>' + (s.score == null ? '–' : s.score) + '</b><i><em style="width:' + (s.score || 0) + '%;background:' + (tone === 'down' ? '#ff5470' : '#00d084') + '"></em></i></div>';
    let h = '<h4 style="margin-top:8px">SHORT INSIGHT</h4><div class="si-scores">' + sc('SHORTS PRESSING', d.pressing, 'down') + sc('SQUEEZE RISK', d.squeeze, 'up') + '</div>';
    const svp = d.shortVsPrice;
    if (svp && svp.days && svp.days.length) {
      const max = Math.max(...svp.days.map((x) => x.ratio || 0), 1);
      h += '<div class="si-strip" title="Short volume ratio per day; red = the stock fell that day, green = it rose">' + svp.days.slice(-10).map((x) => '<b class="' + (x.retPct == null ? '' : x.retPct < -0.2 ? 'dn' : x.retPct > 0.2 ? 'up' : '') + '" style="height:' + Math.max(8, (x.ratio || 0) / max * 100).toFixed(0) + '%" title="' + esc(x.date) + ': ' + esc(x.ratio) + '% short, ' + pcts(x.retPct) + '"></b>').join('') + '</div>'
        + '<div class="kv"><span>Short volume vs price</span><span class="' + (svp.tone === 'down' ? 'warn' : svp.tone === 'up' ? 'lo' : '') + '">' + esc(svp.tone === 'down' ? 'pressing' : svp.tone === 'up' ? 'absorbed' : svp.tone === 'flat' ? 'elevated' : 'ordinary') + '</span>' + (svp.trendPts != null ? '<span>10-day short ratio trend</span><span>' + esc(pcts(svp.trendPts).replace('%', ' pts')) + '</span>' : '') + (svp.corr != null ? '<span>Ratio ↔ return correlation</span><span>' + esc(svp.corr) + '</span>' : '') + '</div><small>' + esc(svp.label) + '</small>';
    }
    if (d.interest && d.interest.label) h += '<div class="kv"><span>Short interest ' + esc(d.interest.since ? d.interest.since.slice(5) + ' → ' + d.interest.to.slice(5) : '') + '</span><span class="' + (d.interest.tone === 'up' ? 'lo' : d.interest.tone === 'down' ? 'warn' : '') + '">' + esc(pcts(d.interest.siChangePct)) + '</span>' + (d.interest.priceChangePct != null ? '<span>Price over the same span</span><span>' + esc(pcts(d.interest.priceChangePct)) + '</span>' : '') + '</div><small>' + esc(d.interest.label) + '</small>';
    const v = d.verdict || {};
    const block = (title, x) => (x ? '<div class="si-v ' + esc(x.tone) + '"><b>' + title + '</b>' + esc(x.call) + (x.reasons && x.reasons.length ? '<ul>' + x.reasons.slice(0, 3).map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '') + (x.invalidation ? '<small>Wrong if: ' + esc(x.invalidation) + '</small>' : '') + '</div>' : '');
    h += block('FOR A SHORT SELLER', v.shortSeller) + block('FOR A LONG (SQUEEZE?)', v.long);
    const src = d.sources || {};
    h += '<div class="si-src">READ FROM: ' + [src.short ? 'FINRA short feed' : '', src.candles ? 'daily candles' : '', src.level3 ? 'Level 3 book' : (src.level2 ? 'Level 2 book' : ''), src.tape ? 'Massive tape' : '', src.flowDays ? 'flow ledger' : '', src.chain ? 'options chain' : ''].filter(Boolean).join(' · ') + '</div>';
    return h;
  }
  function paint() {
    const panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-shortsale');
    if (!box) { box = document.createElement('div'); box.className = 'academy-shortsale'; const anchor = document.querySelector('.academy-darkpool') || document.querySelector('.academy-buysell') || document.querySelector('.academy-stats') || document.querySelector('.academy-tape') || panel; anchor.after(box); }
    if (!S.on) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (S.symbol !== clean(sym())) { S.data = null; S.error = ''; }
    if (!S.session) { box.innerHTML = '<h4>SHORT SALE</h4><small>Unlock Academy Tools first so Discord can verify private Academy access.</small>'; return; }
    if (S.loading) { box.innerHTML = '<h4>SHORT SALE</h4><small>Loading…</small>'; return; }
    if (S.error) { box.innerHTML = '<h4>SHORT SALE</h4><small>' + S.error + '</small>'; return; }
    if (!S.data) { void load(); box.innerHTML = '<h4>SHORT SALE</h4><small>Loading…</small>'; return; }

    const d = S.data, parts = [];
    const volumeRows = Array.isArray(d.volume) ? d.volume : [];
    if (volumeRows.length) {
      const days = pickDays(volumeRows);
      const maxRatio = Math.max(...days.map((x) => x.ratio || 0), 1);
      parts.push('<h4>DAILY SHORT VOLUME</h4>' + days.map((x) => '<div class="day"><span>' + esc(x.date) + '</span><b style="width:' + Math.max(4, (x.ratio || 0) / maxRatio * 100).toFixed(0) + '%"></b><span class="' + (x.ratio >= 45 ? 'warn' : 'lo') + '">' + num(x.ratio, 0) + '%</span></div>').join(''));
      const note = trendNote(days); if (note) parts.push('<small>' + note + '</small>');
    }
    const summary = d.summary, interest = Array.isArray(d.interest) ? d.interest : [];
    if (summary || interest.length) {
      const avg = summary && Number.isFinite(Number(summary.avg_ratio)) ? Number(summary.avg_ratio) : null;
      const latest = interest[0] || {};
      const dtc = Number.isFinite(Number(latest.days_to_cover)) ? Number(latest.days_to_cover) : null;
      parts.push('<h4 style="margin-top:6px">SHORT INTEREST</h4><div class="kv">'
        + '<span>Average short volume ratio</span><span>' + (avg != null ? num(avg, 0) + '%' : '–') + '</span>'
        + '<span>Days to cover</span><span>' + (dtc != null ? num(dtc, 1) : '–') + '</span>'
        + (latest.shares_short != null ? '<span>Shares short</span><span>' + whole(Number(latest.shares_short)) + '</span>' : '')
        + '</div>');
    }
    const symNow = clean(sym());
    if ((S.insSymbol !== symNow || (S.ins && S.ins.ok && Date.now() - S.insAt > 60000)) && !S.insLoading) { if (S.insSymbol !== symNow) S.ins = null; void loadInsight(symNow); }
    if (!parts.length) { box.innerHTML = '<h4>SHORT SALE</h4><small>No short-sale data was returned for this ticker.</small>' + insightHtml(); return; }
    box.innerHTML = parts.join('') + insightHtml() + '<small>Short volume = shares sold short that day ÷ total volume that day (not the same as short interest, which settles twice a month). High or rising short volume does not by itself predict direction. Educational only.</small>';
  }

  function sync() { btn.classList.toggle('on', S.on); }
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.data = null; S.error = ''; S.symbol = ''; if (S.session) void load(); } paint(); }); // turning the panel on is the one deliberate retry
  window.addEventListener('sml-live-data', () => { if (S.on && S.symbol !== clean(sym())) void load(); });
  sync(); paint();
})();
