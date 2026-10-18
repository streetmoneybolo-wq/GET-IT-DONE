/* Market Direction panel (display only). The same file is used by the Academy and by the stockmarketloop.com
 * analyst dashboard, each with its own data route: window.SmlMarketDirectionUI.mount({ host, id, load(mode) }).
 * Educational market read: no read is certain and nothing here places a trade. */
(function () {
  if (window.SmlMarketDirectionUI) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var css = '.smd{border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dbe7ec;font:500 12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;margin:10px 0}'
    + '.smd-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:9px 40px 9px 12px;border-bottom:1px solid #1b3540}.smd-title{font:900 12px ui-monospace,monospace;letter-spacing:.06em;color:#eaf5f8}'
    + '.smd-tabs{display:flex;gap:4px}.smd-tabs button{border:1px solid #284654;border-radius:7px;background:#0d1a22;color:#9fb6c1;padding:4px 10px;font:800 11px system-ui;cursor:pointer}.smd-tabs button.on{border-color:#00c47d;color:#7ef0bd;background:#0b2a20}'
    + '.smd-meta{margin-left:auto;color:#7b93a0;font:700 10px ui-monospace,monospace}.smd-body{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:0;align-items:start}@media(max-width:900px){.smd-body{grid-template-columns:1fr}}'
    + '.smd-v2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 18px;align-items:start;padding:0 12px 8px;border-top:1px solid #13262f}.smd-sec{min-width:0}.smd-sec.wide{grid-column:1/-1}.smd-v2 .smd-h{margin-top:10px}'
    + '.smd-col{padding:8px 12px;min-width:0}.smd-col+.smd-col{border-left:1px solid #13262f}@media(max-width:900px){.smd-col+.smd-col{border-left:0;border-top:1px solid #13262f}}'
    + '.smd-read{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.smd-label{font:900 20px system-ui}.smd-sub{color:#8fa6b3;font-weight:700}'
    + '.smd-gauge{position:relative;height:10px;margin:8px 0 4px;border-radius:6px;background:linear-gradient(90deg,#ff5d6c,#ff9f43 30%,#56687a 50%,#7ad3a8 70%,#00c47d)}.smd-gauge i{position:absolute;top:-4px;width:4px;height:18px;margin-left:-2px;border-radius:2px;background:#fff;box-shadow:0 0 0 2px #0a1118}'
    + '.smd-scale{display:flex;justify-content:space-between;color:#5f7784;font:700 9px ui-monospace,monospace}'
    + '.smd-row{display:grid;grid-template-columns:42px 1fr;gap:8px;padding:7px 0;border-top:1px solid #12232c}.smd-pill{display:grid;place-items:center;height:20px;border-radius:5px;font:900 10px ui-monospace,monospace}'
    + '.p2{background:#0b3a28;color:#7ef0bd}.p1{background:#0d2a21;color:#7ad3a8}.p0{background:#16232b;color:#9fb6c1}.n1{background:#2e1a1d;color:#ff9aa4}.n2{background:#40161c;color:#ff5d6c}.na{background:#111a20;color:#56687a}'
    + '.smd-row b{display:block;color:#e6f1f5;font-weight:800}.smd-row small{display:block;color:#8fa6b3}.smd-row.off b{color:#6c8290}'
    + '.smd-h{margin:10px 0 4px;color:#7b93a0;font:900 10px ui-monospace,monospace;letter-spacing:.06em}.smd-h:first-child{margin-top:0}'
    + '.smd-levels{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:4px}.smd-levels span{display:flex;justify-content:space-between;gap:6px;padding:4px 7px;border:1px solid #13262f;border-radius:6px;background:#0c161d}.smd-levels em{font-style:normal;color:#8fa6b3}.smd-levels strong{font:800 11px ui-monospace,monospace;color:#eaf5f8}'
    + '.smd-check{list-style:none;margin:0;padding:0}.smd-check li{display:flex;gap:7px;padding:4px 0;color:#cfe0e7}.smd-check li::before{flex:0 0 auto;width:16px;text-align:center;font-weight:900}'
    + '.smd-check .up::before{content:"▲";color:#00c47d}.smd-check .down::before{content:"▼";color:#ff5d6c}.smd-check .ok::before{content:"✓";color:#7ad3a8}.smd-check .warn::before{content:"!";color:#ffb648}'
    + '.smd-vix{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:8px 10px;margin-bottom:6px;border:1px solid #23404d;border-radius:8px;background:#0c161d}.smd-vix b{font:900 22px ui-monospace,monospace;color:#eaf5f8}.smd-vix .up{color:#ff5d6c}.smd-vix .dn{color:#00c47d}.smd-vix small{color:#8fa6b3;font-size:10.5px}'
    + '.smd-flip{margin:0;padding-left:16px;color:#cfe0e7}.smd-foot{padding:8px 12px;border-top:1px solid #13262f;color:#5f7784;font-size:10.5px}.smd-empty{padding:9px 12px;color:#8fa6b3;font-size:11.5px}'
    + '.smd-tbl{width:100%;border-collapse:collapse;font:600 10.5px ui-monospace,monospace}.smd-tbl th,.smd-tbl td{padding:3px 4px;border-bottom:1px solid #12232c;text-align:right;white-space:nowrap}.smd-tbl th{color:#7b93a0;font-weight:800}.smd-tbl td:first-child,.smd-tbl th:first-child{text-align:left}.smd-tbl .up{color:#00c47d}.smd-tbl .dn{color:#ff5d6c}.smd-tbl small{color:#8fa6b3;font-weight:600}'
    + '.smd-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px;margin:4px 0}.smd-kv span{display:flex;flex-direction:column;padding:4px 7px;border:1px solid #13262f;border-radius:6px;background:#0c161d}.smd-kv em{font-style:normal;color:#8fa6b3;font:700 9px ui-monospace,monospace;letter-spacing:.05em}.smd-kv strong{font:800 11px ui-monospace,monospace;color:#eaf5f8}.smd-kv strong.up{color:#00c47d}.smd-kv strong.dn{color:#ff5d6c}'
    + '.smd-regime{display:inline-block;padding:3px 8px;border-radius:5px;background:#16232b;color:#cfe0e7;font:900 10px ui-monospace,monospace;letter-spacing:.06em}.smd-note{color:#8fa6b3;font-size:10.5px;margin:3px 0 6px}.smd-ev{list-style:none;margin:0;padding:0}.smd-ev li{display:flex;gap:6px;padding:3px 0;color:#cfe0e7;border-top:1px solid #12232c}.smd-ev li b{color:#ffb648;font:800 10px ui-monospace,monospace;min-width:52px}';
  var LEVELS = { pdh: 'Prior day high', pdl: 'Prior day low', pdc: 'Prior close', preHigh: 'Pre-market high', preLow: 'Pre-market low', open: 'Open', orHigh: 'Opening range high', orLow: 'Opening range low', vwap: 'VWAP', ema20: '20-day avg', ema50: '50-day avg', ema200: '200-day avg', high20: '20-day high', low20: '20-day low', lastWeekHigh: 'Last week high', lastWeekLow: 'Last week low' };
  var SESSION = { pre: 'PRE-MARKET', open: 'MARKET OPEN', after: 'AFTER HOURS', closed: 'MARKET CLOSED' };
  var pill = function (c) { if (!c.available) return '<span class="smd-pill na">–</span>'; var s = c.score; return '<span class="smd-pill ' + (s >= 2 ? 'p2' : s === 1 ? 'p1' : s === 0 ? 'p0' : s === -1 ? 'n1' : 'n2') + '">' + (s > 0 ? '+' + s : s) + '</span>'; };
  var color = function (b) { return b >= 20 ? '#00c47d' : b <= -20 ? '#ff5d6c' : '#cfd9de'; };
  var ago = function (t) { var s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : Math.round(s / 60) + 'm ago'; };

  var pc = function (v, d) { return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d == null ? 2 : d) + '%'; };
  var sgn = function (v) { return v > 0 ? 'up' : v < 0 ? 'dn' : ''; };
  var kv = function (label, value, cls) { return '<span><em>' + label + '</em><strong class="' + (cls || '') + '">' + value + '</strong></span>'; };
  /* the v2 sections: who is pulling SPY, internals, volatility and positioning, cross-asset, base rates, catalysts, track record */
  function v2Html(r, mode) {
    var v = r.v2; if (!v) return '';
    var h = '';
    var sec = function (inner, wide) { return inner ? '<div class="smd-sec' + (wide ? ' wide' : '') + '">' + inner + '</div>' : ''; };
    var part = '';
    if (v.regime && v.regime.kind && v.regime.kind !== 'unknown') part += '<div class="smd-h">REGIME</div><span class="smd-regime">' + esc(String(v.regime.kind).toUpperCase().replace('-', ' ')) + '</span><div class="smd-note">' + esc((v.regime.reasons || [])[0] || '') + (v.expectedMove && v.expectedMove.impliedDailyPct != null ? ' Options imply a ' + esc(v.expectedMove.impliedDailyPct) + '% daily move; the average true range is ' + esc(v.expectedMove.atrPct) + '%.' : '') + '</div>';
    h += sec(part); part = '';
    var c = v.constituents;
    if (c && c.rows && c.rows.length) {
      part += '<div class="smd-h">WHO IS PULLING SPY · ' + esc(c.leadership).toUpperCase() + '</div><div class="smd-kv">' + kv('WEIGHTED MOVE', pc(c.weightedChangePct), sgn(c.weightedChangePct)) + kv('AVERAGE NAME', pc(c.equalChangePct), sgn(c.equalChangePct)) + kv('UP / DOWN', c.advancing + ' / ' + c.declining) + kv('TOP 5 SHARE', Math.round(c.top5Share * 100) + '%') + '</div>'
        + '<table class="smd-tbl"><thead><tr><th>Name</th><th>Weight</th><th>Move</th><th>Pull</th><th>Note</th></tr></thead><tbody>' + c.rows.slice(0, 10).map(function (x) { return '<tr><td>' + esc(x.symbol) + '</td><td>' + (x.weight * 100).toFixed(1) + '%</td><td class="' + sgn(x.changePct) + '">' + pc(x.changePct) + '</td><td>' + esc(x.pull) + '</td><td><small>' + esc(x.catalyst || (x.rvol != null ? x.rvol.toFixed(1) + 'x vol' : '') + (x.aboveVwap === false ? ' · under VWAP' : '')) + '</small></td></tr>'; }).join('') + '</tbody></table>';
      if (c.earningsSoon && c.earningsSoon.length) part += '<div class="smd-note">Earnings inside three days: ' + esc(c.earningsSoon.map(function (x) { return x.symbol + ' (' + x.earningsDays + 'd)'; }).join(', ')) + '. Heavyweight prints move the index after hours.</div>';
    }
    h += sec(part, true); part = '';
    var b = v.breadth, ro = v.rotation;
    if (b || ro) {
      part += '<div class="smd-h">INTERNALS</div><div class="smd-kv">';
      if (b) part += kv('ADVANCING / DECLINING', b.advancing + ' / ' + b.declining + (b.thrust ? ' · THRUST' : b.washout ? ' · WASHOUT' : ''), sgn(b.adRatio)) + (b.volRatio != null ? kv('UP-VOLUME SHARE', Math.round((b.volRatio + 1) / 2 * 100) + '%', sgn(b.volRatio)) : '');
      if (ro) part += kv('CYCLICALS vs DEFENSIVES', pc(ro.spreadPct), sgn(ro.spreadPct)) + (ro.equalVsCapPct != null ? kv('EQUAL vs CAP WEIGHT', pc(ro.equalVsCapPct), sgn(ro.equalVsCapPct)) : '') + (ro.smallCapsVsSpyPct != null ? kv('SMALL CAPS vs SPY', pc(ro.smallCapsVsSpyPct), sgn(ro.smallCapsVsSpyPct)) : '') + (ro.qqqVsSpyPct != null ? kv('QQQ vs SPY', pc(ro.qqqVsSpyPct), sgn(ro.qqqVsSpyPct)) : '');
      part += '</div>';
      if (ro && ro.sectors) part += '<div class="smd-note">' + esc(ro.sectors.map(function (x) { return x.etf + ' ' + (x.changePct >= 0 ? '+' : '') + x.changePct + '%'; }).join(' · ')) + '</div>';
    }
    h += sec(part); part = '';
    var vo = v.volatility, g = v.gamma;
    if (vo || g) {
      part += '<div class="smd-h">VOLATILITY &amp; POSITIONING</div><div class="smd-kv">';
      if (vo) part += kv('VIX', vo.level + (vo.changePct != null ? ' (' + pc(vo.changePct, 1) + ')' : ''), vo.changePct > 0 ? 'dn' : vo.changePct < 0 ? 'up' : '') + (vo.premium != null ? kv('IMPLIED − REALIZED', (vo.premium >= 0 ? '+' : '') + vo.premium + ' pts') : '');
      if (g) part += kv('DEALER GAMMA', esc(g.regime).toUpperCase(), g.regime === 'positive' ? 'up' : g.regime === 'negative' ? 'dn' : '') + (g.flip != null ? kv('GAMMA FLIP', '$' + g.flip) : '') + (g.callWall != null ? kv('CALL WALL', '$' + g.callWall) : '') + (g.putWall != null ? kv('PUT WALL', '$' + g.putWall) : '');
      part += '</div>' + (g && g.notes && g.notes.length ? '<div class="smd-note">' + esc(g.notes[0]) + '</div>' : '');
    }
    h += sec(part); part = '';
    var x = v.crossAsset;
    if (x && x.parts && x.parts.length) part += '<div class="smd-h">CROSS-ASSET RISK APPETITE</div><div class="smd-kv">' + x.parts.map(function (p) { return kv(p.label.toUpperCase(), pc(p.value) + ' · ' + p.read, sgn(p.key === 'dollar' ? -p.value : p.value)); }).join('') + '</div>';
    h += sec(part); part = '';
    var br = v.baseRates;
    if (br) {
      part += '<div class="smd-h">BASE RATES · WHAT SPY DID BEFORE</div><div class="smd-kv">';
      if (br.streak && br.streak.nextUpPct != null) part += kv('AFTER ' + br.streak.length + ' ' + (br.streak.dir > 0 ? 'UP' : 'DOWN') + ' SESSION' + (br.streak.length === 1 ? '' : 'S'), 'next up ' + br.streak.nextUpPct + '% of ' + br.streak.n + (br.streak.next5MeanPct != null ? ' · 5d ' + pc(br.streak.next5MeanPct) : ''), sgn(br.streak.nextUpPct - br.anyDayUpPct));
      if (br.gap && br.gap.followPct != null) part += kv('GAP ' + (br.gap.pct > 0 ? 'UP' : 'DOWN') + ' ' + Math.abs(br.gap.pct) + '%', 'followed ' + br.gap.followPct + '% of ' + br.gap.n);
      if (br.position && br.position.next5UpPct != null) part += kv('AT THE ' + br.position.at.toUpperCase(), '5d up ' + br.position.next5UpPct + '% of ' + br.position.n + ' · ' + pc(br.position.next5MeanPct));
      part += kv('ANY SESSION UP', br.anyDayUpPct + '% of ' + br.sessions) + '</div>';
    }
    h += sec(part); part = '';
    var ca = v.calendar;
    if (ca && ca.events && ca.events.length) part += '<div class="smd-h">CATALYSTS · NEXT 7 DAYS' + (ca.risk >= 0.6 ? ' · EVENT RISK HIGH' : '') + '</div><ul class="smd-ev">' + ca.events.slice(0, 8).map(function (e) { return '<li><b>' + (e.daysAway === 0 ? 'TODAY' : e.daysAway === 1 ? 'TOMORROW' : esc(e.date.slice(5))) + '</b><span>' + esc(e.label) + (e.impact >= 3 ? ' ·  high impact' : '') + '</span></li>'; }).join('') + '</ul>';
    h += sec(part); part = '';
    var k = r.calibration;
    if (k && k.forecasts) { var dd = k.day || {}, sw = k.swing || {}; part += '<div class="smd-h">TRACK RECORD · THIS READ VS WHAT SPY DID</div><div class="smd-kv">' + kv('DAY CALLS', dd.calls ? dd.hitRatePct + '% right of ' + dd.calls + (dd.last30 && dd.last30.calls ? ' · last 30: ' + dd.last30.hitRatePct + '%' : '') : 'no settled calls yet') + kv('SWING CALLS', sw.calls ? sw.hitRatePct + '% right of ' + sw.calls : 'no settled calls yet') + (dd.brier != null ? kv('BRIER (DAY)', dd.brier + ' · lower is better') : '') + '</div><div class="smd-note">A call counts when the bias is at least 15 either way; it is right when SPY closed that way next session (day) or five sessions later (swing).</div>'; }
    h += sec(part);
    return h ? '<div class="smd-v2">' + h + '</div>' : '';
  }

  function mount(opts) {
    if (!document.getElementById('smd-css')) { var st = document.createElement('style'); st.id = 'smd-css'; st.textContent = css; document.head.appendChild(st); }
    var root = document.createElement('section');
    root.className = 'smd'; root.id = opts.id;
    root.setAttribute('aria-label', 'Market direction');
    if (opts.before) opts.host.insertBefore(root, opts.before); else opts.host.appendChild(root);
    var body = document.createElement('div'); root.appendChild(body); // redraws stay inside, so a pop-out button on the panel is never wiped
    var KEY = 'smd-mode';
    var mode = 'day'; try { mode = localStorage.getItem(KEY) === 'swing' ? 'swing' : 'day'; } catch (e) { /* default */ }
    var data = {}, err = '', timer = 0;
    function paint() {
      var r = data[mode];
      var head = '<div class="smd-head"><span class="smd-title">MARKET DIRECTION</span><span class="smd-tabs"><button type="button" data-m="day" class="' + (mode === 'day' ? 'on' : '') + '">Day trading</button><button type="button" data-m="swing" class="' + (mode === 'swing' ? 'on' : '') + '">Swing trading</button></span>'
        + '<span class="smd-meta">' + (r ? (SESSION[r.session] || '') + ' · updated ' + ago(r.asOf) : '') + '</span></div>';
      if (!r) { body.innerHTML = head + '<div class="smd-empty">' + esc(err || 'Reading the market…') + '</div>'; return; }
      var comps = r.components.map(function (c) { return '<div class="smd-row' + (c.available ? '' : ' off') + '">' + pill(c) + '<div><b>' + esc(c.label) + '</b>' + c.reasons.map(function (x) { return '<small>' + esc(x) + '</small>'; }).join('') + '</div></div>'; }).join('');
      var lv = Object.keys(LEVELS).filter(function (k) { return r.levels && r.levels[k] != null; }).map(function (k) { return '<span><em>' + LEVELS[k] + '</em><strong>$' + esc(r.levels[k]) + '</strong></span>'; });
      if (r.options && r.options.callWall) lv.push('<span><em>Call wall (OI)</em><strong>$' + esc(r.options.callWall.strike) + '</strong></span>');
      if (r.options && r.options.putWall) lv.push('<span><em>Put wall (OI)</em><strong>$' + esc(r.options.putWall.strike) + '</strong></span>');
      body.innerHTML = head + '<div class="smd-body"><div class="smd-col">'
        + '<div class="smd-read"><span class="smd-label" style="color:' + color(r.bias) + '">' + esc(r.label) + '</span><span class="smd-sub">' + (r.bias > 0 ? '+' : '') + r.bias + ' · ' + r.confidence + '% of the evidence agrees · ' + r.coverage + '% of sources live</span></div>'
        + '<div class="smd-gauge"><i style="left:' + ((r.bias + 100) / 2) + '%"></i></div><div class="smd-scale"><span>BEARISH</span><span>NEUTRAL</span><span>BULLISH</span></div>'
        + '<div class="smd-h" style="margin-top:10px">WHAT IT IS BUILT FROM</div>' + comps + '</div>'
        + '<div class="smd-col">' + (r.vol ? '<div class="smd-h">SML VIX · 30-DAY VOLATILITY</div><div class="smd-vix"><b>' + esc(r.vol.level) + '</b>'
          + (r.vol.change ? '<span class="' + (r.vol.change.change > 0 ? 'up' : 'dn') + '">' + (r.vol.change.change > 0 ? '▲ +' : '▼ ') + esc(r.vol.change.change) + ' (' + esc(r.vol.change.pct) + '%) ' + (mode === 'day' ? 'since the open' : 'recently') + '</span>' : '')
          + '<small>' + esc((r.vol.terms || []).map(function (t) { return t.expiry + ': ' + t.vol + '% (' + t.strikes + ' strikes)'; }).join(' · ')) + (r.vol.stale ? ' · last reading' : '') + '</small><small>Computed with the CBOE VIX method from live SPY options. Under 15 calm · 15–20 normal · 20–25 elevated · over 25 high fear.</small></div>' : '')
        + '<div class="smd-h">' + (mode === 'day' ? 'PRE-MARKET / INTRADAY CHECKLIST' : 'SWING CHECKLIST') + '</div><ul class="smd-check">' + r.checklist.map(function (x) { return '<li class="' + esc(x.status) + '">' + esc(x.text) + '</li>'; }).join('') + '</ul>'
        + (lv.length ? '<div class="smd-h">KEY LEVELS · SPY</div><div class="smd-levels">' + lv.join('') + '</div>' : '')
        + (r.flips && r.flips.length ? '<div class="smd-h">WHAT WOULD CHANGE THE READ</div><ul class="smd-flip">' + r.flips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '')
        + '</div></div>' + v2Html(r, mode) + '<div class="smd-foot">' + esc(r.proxies) + ' ' + esc(r.disclaimer) + '</div>';
    }
    function load() {
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(load, 5000); return; }
      var m = mode;
      Promise.resolve(opts.load(m)).then(function (r) { if (r && r.ok) { data[m] = r; err = ''; } else if (!data[m]) err = (r && r.message) || 'The market read is not available right now.'; })
        .catch(function () { if (!data[m]) err = 'The market read is not available right now.'; })
        .then(function () { paint(); timer = setTimeout(load, m === 'day' ? 20000 : 120000); });
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      mode = b.getAttribute('data-m'); try { localStorage.setItem(KEY, mode); } catch (er) { /* fine */ }
      paint(); load();
    });
    setInterval(function () { if (!document.hidden && data[mode]) { var m = root.querySelector('.smd-meta'); if (m) m.textContent = (SESSION[data[mode].session] || '') + ' · updated ' + ago(data[mode].asOf); } }, 15000);
    paint(); load();
    root.smdReload = load;
    return root;
  }
  window.SmlMarketDirectionUI = { mount: mount };
})();
