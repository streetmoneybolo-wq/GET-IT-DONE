/* SML Terminal — Short sale analysis (REAL FINRA data).
   The design's rail card ("Short sale analysis · FINRA daily short volume ·
   Volume/Ratio") shipped with sample numbers and was hidden because no data
   owner existed. WPCode #7218 (wpcode/short-sale-api.php) now serves
   sml-short/v1/short?symbol=… from the site's Massive/Polygon feed (FINRA daily
   short volume + bi-monthly short interest). This card is built from that
   endpoint only; if it reports available:false the card is not rendered. */
(function () {
  'use strict';
  if (window.__smlTerminalShortBooted) return;
  window.__smlTerminalShortBooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtDate(iso) { var d = new Date(String(iso) + 'T00:00:00'); return isNaN(d) ? String(iso) : (d.getMonth() + 1) + '/' + d.getDate(); }
  function fmtLong(iso) { var d = new Date(String(iso) + 'T00:00:00'); return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function abbr(n) { n = Number(n) || 0; var a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(Math.round(n)); }

  var CSS = '' +
    '.tv2-ss{border:1px solid #16202b;border-radius:10px;background:#080c12;overflow:hidden}' +
    '.tv2-ss-h{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #131c26}' +
    '.tv2-ss-h .t{font:700 12px/1 Archivo,sans-serif;color:#e6edf3}.tv2-ss-h .d{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-ss-body{padding:12px 16px 16px;display:flex;flex-direction:column;gap:12px}' +
    '.tv2-ss-row{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
    '.tv2-ss-row .k{font:400 10px/1.4 Archivo,sans-serif;color:#5d7085}' +
    '.tv2-ss-seg{display:flex;gap:3px;background:#0d141c;border:1px solid #16202b;border-radius:20px;padding:3px}' +
    '.tv2-ss-seg button{font:500 11px/1 Archivo,sans-serif;color:#8fa3b5;background:transparent;border:none;padding:7px 13px;border-radius:20px;cursor:pointer}' +
    '.tv2-ss-seg button.on{color:#04060a;background:#ff7a45}' +
    '.tv2-ss-chart{position:relative;height:150px;display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid #0e1620}' +
    '.tv2-ss-grid{position:absolute;left:0;right:0;border-top:1px solid #0e1620;pointer-events:none}' +
    '.tv2-ss-col{position:relative;flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end}' +
    '.tv2-ss-col .tot{position:absolute;left:0;right:0;bottom:0;background:#1d2b39;border-radius:2px 2px 0 0}' +
    '.tv2-ss-col .sh{position:absolute;left:0;right:0;bottom:0;background:#ff7a45;border-radius:2px 2px 0 0;opacity:.95}' +
    '.tv2-ss-col .rt{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,#ff9a6b,#ff7a45);border-radius:2px 2px 0 0}' +
    '.tv2-ss-col:hover .tip{display:block}' +
    '.tv2-ss-col .tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);white-space:nowrap;background:#0d141c;border:1px solid #1d2b39;border-radius:6px;padding:6px 8px;font:500 10px/1.5 "IBM Plex Mono",monospace;color:#c9d6e2;z-index:3}' +
    '.tv2-ss-axis{display:flex;justify-content:space-between;font:500 9px/1 "IBM Plex Mono",monospace;color:#4c5d6d}' +
    '.tv2-ss-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.tv2-ss-stat{border:1px solid #1d2b39;border-radius:8px;background:#0b1119;padding:12px 14px;display:flex;flex-direction:column;gap:6px}' +
    '.tv2-ss-stat .v{font:700 18px/1 "IBM Plex Mono",monospace;color:#ff7a45}.tv2-ss-stat .v.c{color:#00ccff}' +
    '.tv2-ss-stat .k{font:500 10px/1 Archivo,sans-serif;color:#8fa3b5}.tv2-ss-stat .s{font:400 10px/1.4 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-ss-lean{margin:0;font:400 11px/1.6 Archivo,sans-serif;color:#a9bccd}.tv2-ss-lean b{color:#ff7a45;font-weight:700}' +
    '.tv2-ss-note{font:400 10px/1.5 Archivo,sans-serif;color:#4c5d6d;border-top:1px solid #131c26;padding-top:10px}' +
    '.tv2-ss-legend{display:flex;gap:12px;font:500 9px/1 "IBM Plex Mono",monospace;color:#5d7085}.tv2-ss-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}';

  function card() {
    var el = document.createElement('div');
    el.className = 'tv2-ss'; el.setAttribute('data-tv2-keep', '1'); el.setAttribute('data-tv2-short', '1');
    el.innerHTML = '<div class="tv2-ss-h"><span class="t">Short sale analysis</span><span class="d" id="tv2ss-range">' + esc(SYM) + '</span></div><div class="tv2-ss-body" id="tv2ss-body"></div>';
    return el;
  }

  function render(el, d) {
    var vol = Array.isArray(d.volume) ? d.volume : [], intr = Array.isArray(d.interest) ? d.interest : [];
    var body = el.querySelector('#tv2ss-body'), range = el.querySelector('#tv2ss-range');
    range.textContent = vol.length ? (vol.length + ' sessions') : (intr.length ? 'short interest' : esc(SYM));
    var mode = 'vol';
    var latest = vol[vol.length - 1] || null, li = intr[0] || null;
    var sum = d.summary || null;
    function chartHTML() {
      if (!vol.length) return '<div class="tv2-ss-note" style="border:0;padding:0">FINRA daily short volume isn’t published for ' + esc(SYM) + ' right now.</div>';
      var maxTot = 0, maxR = 0;
      vol.forEach(function (v) { if (v.total > maxTot) maxTot = v.total; if (v.ratio > maxR) maxR = v.ratio; });
      var cols = vol.map(function (v) {
        var tip = '<span class="tip">' + esc(fmtLong(v.date)) + ' · short ' + abbr(v.short) + ' / ' + abbr(v.total) + ' · ' + Number(v.ratio).toFixed(1) + '%</span>';
        if (mode === 'vol') {
          var th = maxTot ? (v.total / maxTot * 100) : 0, sh = maxTot ? (v.short / maxTot * 100) : 0;
          return '<div class="tv2-ss-col"><div class="tot" style="height:' + th.toFixed(2) + '%"></div><div class="sh" style="height:' + sh.toFixed(2) + '%"></div>' + tip + '</div>';
        }
        var rh = maxR ? (v.ratio / maxR * 100) : 0;
        return '<div class="tv2-ss-col"><div class="rt" style="height:' + rh.toFixed(2) + '%"></div>' + tip + '</div>';
      }).join('');
      var grid = [0, 33.3, 66.6].map(function (p) { return '<div class="tv2-ss-grid" style="top:' + p + '%"></div>'; }).join('');
      var legend = mode === 'vol'
        ? '<div class="tv2-ss-legend"><span><i style="background:#ff7a45"></i>short volume</span><span><i style="background:#1d2b39"></i>total volume</span></div>'
        : '<div class="tv2-ss-legend"><span><i style="background:#ff7a45"></i>short volume as % of total (peak ' + (maxR ? maxR.toFixed(1) : '—') + '%)</span></div>';
      return '<div class="tv2-ss-chart">' + grid + cols + '</div><div class="tv2-ss-axis"><span>' + esc(fmtDate(vol[0].date)) + '</span><span>' + esc(fmtDate(vol[vol.length - 1].date)) + '</span></div>' + legend;
    }
    function paint() {
      body.innerHTML =
        '<div class="tv2-ss-row"><span class="k">FINRA daily short volume</span>' +
        '<div class="tv2-ss-seg"><button type="button" data-m="vol"' + (mode === 'vol' ? ' class="on"' : '') + '>Volume</button><button type="button" data-m="ratio"' + (mode === 'ratio' ? ' class="on"' : '') + '>Ratio</button></div></div>' +
        chartHTML() +
        '<div class="tv2-ss-stats">' +
        '<div class="tv2-ss-stat"><span class="v">' + (latest ? Number(latest.ratio).toFixed(1) + '%' : '—') + '</span><span class="k">Short volume</span><span class="s">' + (latest ? abbr(latest.short) + ' of ' + abbr(latest.total) + ' · ' + esc(fmtLong(latest.date)) : 'not published') + '</span></div>' +
        '<div class="tv2-ss-stat"><span class="v c">' + (li ? abbr(li.short_interest) : '—') + '</span><span class="k">Short interest</span><span class="s">' + (li ? ((li.days_to_cover != null ? Number(li.days_to_cover).toFixed(2) + ' days to cover · ' : '') + 'settled ' + esc(fmtLong(li.date))) : 'not published') + '</span></div>' +
        '</div>' +
        (sum ? '<p class="tv2-ss-lean">Short volume averaged <b>' + Number(sum.avg_ratio).toFixed(1) + '%</b> of tape over the window, peaking at <b>' + Number(sum.peak_ratio).toFixed(1) + '%</b> on ' + esc(fmtLong(sum.peak_date)) + '.</p>' : '') +
        '<div class="tv2-ss-note">Short volume is not short interest: much of it is market-maker hedging and intraday activity that is closed the same day. Short interest is the open short position reported to FINRA twice a month. Source: FINRA via the site’s market-data feed.</div>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-m]'), function (b) { b.onclick = function () { mode = b.getAttribute('data-m'); paint(); }; });
    }
    paint();
  }

  function mount(el) {
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail) return false;
    /* the design's sample short-sale card (hidden by terminal-adopt.js) marks the slot */
    var sample = null;
    Array.prototype.forEach.call(rail.children, function (c) { if (!sample && !c.hasAttribute('data-tv2-short') && /Short sale analysis/i.test(c.textContent || '')) sample = c; });
    if (sample) sample.insertAdjacentElement('afterend', el); else rail.appendChild(el);
    return true;
  }

  var DATA = null, EL = null;
  function place() {
    if (!DATA) return;
    if (EL && document.contains(EL)) return;
    EL = card(); if (mount(EL)) render(EL, DATA);
  }
  function load(attempt) {
    attempt = attempt || 0;
    fetch('/wp-json/sml-short/v1/short?symbol=' + encodeURIComponent(SYM) + '&days=20', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) { if (!d || !d.available) return; DATA = d; place(); })
      .catch(function () { if (attempt < 3) setTimeout(function () { load(attempt + 1); }, [4000, 8000, 18000][attempt]); /* else: no data → no card (never fake FINRA numbers) */ });
  }
  function boot() {
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail || !rail.children.length) return false;
    if (!document.getElementById('tv2-ss-css')) { var st = document.createElement('style'); st.id = 'tv2-ss-css'; st.textContent = CSS; document.head.appendChild(st); }
    load(0);
    /* the shell / data modules may re-render the rail after we mount — put the card back */
    try { if (window.MutationObserver) { var mo = new MutationObserver(function () { if (DATA && (!EL || !document.contains(EL))) place(); }); mo.observe(rail, { childList: true }); var zoneParent = rail.parentElement; if (zoneParent) mo.observe(zoneParent, { childList: true, subtree: true }); } } catch (e) {}
    var k = 0; var iv = setInterval(function () { place(); if (++k > 40) clearInterval(iv); }, 1500);   /* belt and braces for the first minute */
    return true;
  }

  var tries = 0;
  var t = setInterval(function () {
    var ok = false;
    try { ok = boot(); } catch (e) {}
    if (ok || ++tries > 60) clearInterval(t);
  }, 300);
})();

/* Rail media card (js/terminal-media.js) rides along with this module — same
   commit-pinned CDN base, no WPCode change needed. */
(function () {
  var me = document.currentScript || Array.prototype.filter.call(document.scripts, function (s) { return /terminal-short\.js/.test(s.src); })[0];
  if (!me || !me.src || document.querySelector('script[src*="terminal-media.js"]')) return;
  var s = document.createElement('script'); s.src = me.src.replace(/terminal-short\.js.*$/, 'terminal-media.js'); s.async = true; document.head.appendChild(s);
})();
