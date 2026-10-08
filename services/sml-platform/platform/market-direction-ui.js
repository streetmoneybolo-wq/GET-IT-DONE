/* Market Direction panel (display only). The same file is used by the Academy and by the stockmarketloop.com
 * analyst dashboard, each with its own data route: window.SmlMarketDirectionUI.mount({ host, id, load(mode) }).
 * Educational market read: no read is certain and nothing here places a trade. */
(function () {
  if (window.SmlMarketDirectionUI) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var css = '.smd{border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dbe7ec;font:500 12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;margin:10px 0}'
    + '.smd-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:9px 12px;border-bottom:1px solid #1b3540}.smd-title{font:900 12px ui-monospace,monospace;letter-spacing:.06em;color:#eaf5f8}'
    + '.smd-tabs{display:flex;gap:4px}.smd-tabs button{border:1px solid #284654;border-radius:7px;background:#0d1a22;color:#9fb6c1;padding:4px 10px;font:800 11px system-ui;cursor:pointer}.smd-tabs button.on{border-color:#00c47d;color:#7ef0bd;background:#0b2a20}'
    + '.smd-meta{margin-left:auto;color:#7b93a0;font:700 10px ui-monospace,monospace}.smd-body{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:0}@media(max-width:900px){.smd-body{grid-template-columns:1fr}}'
    + '.smd-col{padding:10px 12px;min-width:0}.smd-col+.smd-col{border-left:1px solid #13262f}@media(max-width:900px){.smd-col+.smd-col{border-left:0;border-top:1px solid #13262f}}'
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
    + '.smd-flip{margin:0;padding-left:16px;color:#cfe0e7}.smd-foot{padding:8px 12px;border-top:1px solid #13262f;color:#5f7784;font-size:10.5px}.smd-empty{padding:18px 12px;color:#8fa6b3;text-align:center}';
  var LEVELS = { pdh: 'Prior day high', pdl: 'Prior day low', pdc: 'Prior close', preHigh: 'Pre-market high', preLow: 'Pre-market low', open: 'Open', orHigh: 'Opening range high', orLow: 'Opening range low', vwap: 'VWAP', ema20: '20-day avg', ema50: '50-day avg', ema200: '200-day avg', high20: '20-day high', low20: '20-day low', lastWeekHigh: 'Last week high', lastWeekLow: 'Last week low' };
  var SESSION = { pre: 'PRE-MARKET', open: 'MARKET OPEN', after: 'AFTER HOURS', closed: 'MARKET CLOSED' };
  var pill = function (c) { if (!c.available) return '<span class="smd-pill na">–</span>'; var s = c.score; return '<span class="smd-pill ' + (s >= 2 ? 'p2' : s === 1 ? 'p1' : s === 0 ? 'p0' : s === -1 ? 'n1' : 'n2') + '">' + (s > 0 ? '+' + s : s) + '</span>'; };
  var color = function (b) { return b >= 20 ? '#00c47d' : b <= -20 ? '#ff5d6c' : '#cfd9de'; };
  var ago = function (t) { var s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : Math.round(s / 60) + 'm ago'; };

  function mount(opts) {
    if (!document.getElementById('smd-css')) { var st = document.createElement('style'); st.id = 'smd-css'; st.textContent = css; document.head.appendChild(st); }
    var root = document.createElement('section');
    root.className = 'smd'; root.id = opts.id;
    root.setAttribute('aria-label', 'Market direction');
    if (opts.before) opts.host.insertBefore(root, opts.before); else opts.host.appendChild(root);
    var KEY = 'smd-mode';
    var mode = 'day'; try { mode = localStorage.getItem(KEY) === 'swing' ? 'swing' : 'day'; } catch (e) { /* default */ }
    var data = {}, err = '', timer = 0;
    function paint() {
      var r = data[mode];
      var head = '<div class="smd-head"><span class="smd-title">MARKET DIRECTION</span><span class="smd-tabs"><button type="button" data-m="day" class="' + (mode === 'day' ? 'on' : '') + '">Day trading</button><button type="button" data-m="swing" class="' + (mode === 'swing' ? 'on' : '') + '">Swing trading</button></span>'
        + '<span class="smd-meta">' + (r ? (SESSION[r.session] || '') + ' · updated ' + ago(r.asOf) : '') + '</span></div>';
      if (!r) { root.innerHTML = head + '<div class="smd-empty">' + esc(err || 'Reading the market…') + '</div>'; return; }
      var comps = r.components.map(function (c) { return '<div class="smd-row' + (c.available ? '' : ' off') + '">' + pill(c) + '<div><b>' + esc(c.label) + '</b>' + c.reasons.map(function (x) { return '<small>' + esc(x) + '</small>'; }).join('') + '</div></div>'; }).join('');
      var lv = Object.keys(LEVELS).filter(function (k) { return r.levels && r.levels[k] != null; }).map(function (k) { return '<span><em>' + LEVELS[k] + '</em><strong>$' + esc(r.levels[k]) + '</strong></span>'; });
      if (r.options && r.options.callWall) lv.push('<span><em>Call wall (OI)</em><strong>$' + esc(r.options.callWall.strike) + '</strong></span>');
      if (r.options && r.options.putWall) lv.push('<span><em>Put wall (OI)</em><strong>$' + esc(r.options.putWall.strike) + '</strong></span>');
      root.innerHTML = head + '<div class="smd-body"><div class="smd-col">'
        + '<div class="smd-read"><span class="smd-label" style="color:' + color(r.bias) + '">' + esc(r.label) + '</span><span class="smd-sub">' + (r.bias > 0 ? '+' : '') + r.bias + ' · ' + r.confidence + '% of the evidence agrees · ' + r.coverage + '% of sources live</span></div>'
        + '<div class="smd-gauge"><i style="left:' + ((r.bias + 100) / 2) + '%"></i></div><div class="smd-scale"><span>BEARISH</span><span>NEUTRAL</span><span>BULLISH</span></div>'
        + '<div class="smd-h" style="margin-top:10px">WHAT IT IS BUILT FROM</div>' + comps + '</div>'
        + '<div class="smd-col"><div class="smd-h">' + (mode === 'day' ? 'PRE-MARKET / INTRADAY CHECKLIST' : 'SWING CHECKLIST') + '</div><ul class="smd-check">' + r.checklist.map(function (x) { return '<li class="' + esc(x.status) + '">' + esc(x.text) + '</li>'; }).join('') + '</ul>'
        + (lv.length ? '<div class="smd-h">KEY LEVELS · SPY</div><div class="smd-levels">' + lv.join('') + '</div>' : '')
        + (r.flips && r.flips.length ? '<div class="smd-h">WHAT WOULD CHANGE THE READ</div><ul class="smd-flip">' + r.flips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '')
        + '</div></div><div class="smd-foot">' + esc(r.proxies) + ' ' + esc(r.disclaimer) + '</div>';
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
