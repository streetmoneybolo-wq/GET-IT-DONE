/* Alerts desk on the group Live Chart: the trader's posted alerts with risk grade, plan, progress and the options read, the same desk the
   Academy shows. Opens from an ALERTS button on the chart's control row; clicking an alert switches the chart to that ticker.
   Premium members (and owners/admins) see the alerts; other members see how many are open. Educational; places no trades. */
(function () {
  'use strict';
  var C = window.SMLCAT_ALERTS; if (!C || window.__smlCatAlerts) return;
  window.__smlCatAlerts = true;
  var KEY = 'sml-cat-alerts-v1';
  var S = { open: false, tab: 'all', alerts: [], teaser: null, asOf: 0, err: '', openId: null, detail: null, busy: false };
  try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.open = !!v.open; if (v.tab) S.tab = v.tab; } } catch (e) { /* storage blocked */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ open: S.open, tab: S.tab })); } catch (e) { /* ignore */ } }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function px(v) { return v == null || !isFinite(v) ? '–' : (Math.abs(v) < 1 ? Number(v).toFixed(3) : Number(v).toFixed(2)); }
  function pc(v) { return v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }
  function ago(t) { var s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; }
  var BAND = { LOW: '#19c37d', MODERATE: '#9bd93c', ELEVATED: '#ffb020', HIGH: '#ff6a3d', EXTREME: '#ff2d55' };
  var ACT = { HOLD: ['HOLD', '#7fa6bf', '#0c1a24'], RAISE_TARGET: ['RAISE TARGET', '#19e36b', '#03150c'], PARTIAL: ['TAKE PARTIAL', '#ffb020', '#221500'], SELL: ['SELL', '#ff5470', '#2a0509'] };
  var OPT = { CALL: '#19e36b', PUT: '#ff5470', WAIT: '#ffb020', NONE: '#7f97a4' };

  var css = document.createElement('style'); css.id = 'sml-dashboard-chart-alerts-css';
  css.textContent = '#sml-cat-alerts{position:fixed;top:0;right:0;bottom:0;z-index:2147482000;width:min(360px,92vw);display:flex;flex-direction:column;background:#0a1118;border-left:1px solid #1b3540;color:#dcebf4;font:600 12px/1.4 system-ui,sans-serif;box-shadow:-12px 0 30px rgba(0,0,0,.45)}'
    + '#sml-cat-alerts header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1b3540}#sml-cat-alerts header b{font:800 12px ui-monospace,monospace;color:#42f5b3;letter-spacing:.06em}#sml-cat-alerts header small{color:#6f8794}#sml-cat-alerts header button{margin-left:auto;border:1px solid #23495a;border-radius:6px;background:#0d1a24;color:#eaf5f8;font:800 13px system-ui;padding:3px 9px;cursor:pointer}'
    + '#sml-cat-alerts .tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid #16303b}#sml-cat-alerts .tabs button{flex:1;padding:5px 4px;border:1px solid #23495a;border-radius:6px;background:#0d1a24;color:#a9bfcb;font:800 11px system-ui;cursor:pointer}#sml-cat-alerts .tabs button.on{background:#12362b;border-color:#00d084;color:#fff}'
    + '#sml-cat-alerts .list{flex:1;overflow:auto;padding:8px}#sml-cat-alerts .row{border:1px solid #1b3540;border-radius:9px;background:#0c1620;margin:0 0 7px;padding:8px 9px;cursor:pointer}#sml-cat-alerts .row:hover{border-color:#2f6a7f}#sml-cat-alerts .row.cur{border-color:#42f5b3}'
    + '#sml-cat-alerts .top{display:flex;align-items:center;gap:6px}#sml-cat-alerts .av{width:22px;height:22px;border-radius:50%;object-fit:cover;background:#17303c}#sml-cat-alerts .risk{padding:2px 6px;border-radius:999px;font:800 10px ui-monospace,monospace;color:#061019}#sml-cat-alerts .sym{font:800 14px ui-monospace,monospace;color:#fff}#sml-cat-alerts .mut{color:#7f97a4}'
    + '#sml-cat-alerts .pxv{margin-left:auto;text-align:right;font:700 12px ui-monospace,monospace}#sml-cat-alerts .up{color:#5df0b0}#sml-cat-alerts .dn{color:#ff8ea1}'
    + '#sml-cat-alerts .bar{position:relative;height:5px;border-radius:3px;background:#17303c;margin:8px 0 4px}#sml-cat-alerts .bar i{position:absolute;top:-2px;width:2px;height:9px}#sml-cat-alerts .bar em{position:absolute;top:-3px;width:9px;height:11px;margin-left:-4px;border-radius:2px;background:#fff}'
    + '#sml-cat-alerts .lv{display:flex;justify-content:space-between;color:#8fa6b3;font:600 10px ui-monospace,monospace}#sml-cat-alerts .act{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}#sml-cat-alerts .chip{padding:2px 7px;border-radius:5px;font:800 10px ui-monospace,monospace}#sml-cat-alerts .opt{padding:2px 7px;border-radius:5px;border:1px solid;font:800 10px ui-monospace,monospace}'
    + '#sml-cat-alerts .why{color:#a9bfcb;font-size:11px}#sml-cat-alerts .det{margin-top:8px;border-top:1px solid #1d3a48;padding-top:7px;cursor:default}#sml-cat-alerts .det h5{margin:8px 0 4px;font:800 10px ui-monospace,monospace;color:#86a2b0;letter-spacing:.06em}#sml-cat-alerts .det ul{margin:0;padding-left:15px;font-weight:500;font-size:11px;color:#c5d3db}'
    + '#sml-cat-alerts .empty{padding:18px 12px;text-align:center;color:#8fa6b3;line-height:1.5}#sml-cat-alerts .note{padding:8px 12px;color:#6f8794;font-size:10px;line-height:1.4;border-top:1px solid #16303b}';
  document.head.appendChild(css);

  var panel = null, btn = null;
  function api(q) { return fetch(C.rest + '?group_id=' + encodeURIComponent(C.groupId) + (q || ''), { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': C.nonce, Accept: 'application/json' } }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'unavailable'); return j; }); }); }
  function chartSym() { var A = window.SMLLC && window.SMLLC.api; return String((A && A.symbol && A.symbol()) || '').toUpperCase(); }
  function switchChart(sym) {
    if (typeof window.__smlDashboardSetSymbol === 'function') { try { window.__smlDashboardSetSymbol(sym); return; } catch (e) { /* fall back to the input */ } }
    var f = document.getElementById('csym'); if (!f) return;
    f.value = sym; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
    var form = f.form; var go = (form && form.querySelector('button[type="submit"],button')) || (f.parentElement && f.parentElement.querySelector('button'));
    if (go) go.click(); else f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  function list() { return S.alerts.filter(function (a) { return S.tab === 'all' || a.channel === S.tab; }); }
  function bar(a) {
    var lo = Math.min(a.entry, a.low != null ? a.low : a.entry, a.price != null ? a.price : a.entry, a.plan.stop), hi = Math.max(a.plan.target, a.target0, a.high != null ? a.high : a.target0, a.price != null ? a.price : a.entry);
    var at = function (v) { return Math.max(0, Math.min(100, (v - lo) / Math.max(1e-9, hi - lo) * 100)); };
    return '<div class="bar"><i style="left:' + at(a.plan.stop) + '%;background:#ff5470"></i><i style="left:' + at(a.entry) + '%;background:#7fa6bf"></i><i style="left:' + at(a.plan.target) + '%;background:#19e36b"></i>' + (a.price != null ? '<em style="left:' + at(a.price) + '%"></em>' : '') + '</div>'
      + '<div class="lv"><span>stop ' + px(a.plan.stop) + '</span><span>entry ' + px(a.entry) + '</span><span>target ' + px(a.plan.target) + '</span></div>';
  }
  function detailHtml(a) {
    var d = S.detail && S.detail.id === a.id ? S.detail : null;
    if (!d) return '<div class="det"><span class="mut">Loading the full breakdown…</span></div>';
    var h = '<div class="det" data-stop="1"><h5>WHAT THE PLAN SAYS</h5><ul>' + (d.plan.reasons || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    if (d.risk.flags && d.risk.flags.length) h += '<h5>FLAGS</h5><ul>' + d.risk.flags.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    if (d.checklist) h += '<h5>COMPANY CHECKLIST</h5><ul>' + d.checklist.items.map(function (i) { return '<li>' + (i.ok === true ? '✓ ' : i.ok === false ? '✗ ' : '– ') + esc(i.l) + (i.d ? ': ' + esc(i.d) : '') + '</li>'; }).join('') + '</ul>';
    if (d.options && d.options.available) h += '<h5>OPTIONS READ</h5><ul><li><b style="color:' + (OPT[d.options.verdict] || '#ccc') + '">' + esc(d.options.verdict) + '</b> ' + esc(d.options.summary || d.options.reason || '') + '</li>' + (d.options.flags || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
    var sig = []; if (d.algo) sig.push('MEM ALGO: ' + d.algo.label); if (d.flow) sig.push('Order book (' + d.flow.source + '): ' + d.flow.bias); if (d.sector) sig.push('Sector: ' + d.sector.name);
    if (sig.length) h += '<h5>SIGNALS</h5><ul>' + sig.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    h += '<h5>ORIGINAL ALERT · ' + esc(d.author || '') + '</h5><div class="mut" style="font:500 11px ui-monospace,monospace;word-break:break-word">' + esc(d.raw) + '</div>';
    return h + '</div>';
  }
  function row(a) {
    var act = ACT[a.plan.action] || ACT.HOLD, col = BAND[a.risk.band] || '#888';
    var o = a.options && a.options.available ? '<span class="opt" style="color:' + (OPT[a.options.verdict] || '#ccc') + ';border-color:' + (OPT[a.options.verdict] || '#ccc') + '">' + esc(a.options.verdict === 'CALL' || a.options.verdict === 'PUT' ? a.options.verdict : a.options.verdict === 'WAIT' ? 'OPTIONS: WAIT' : 'NO OPTIONS') + '</span>' : '';
    return '<div class="row' + (chartSym() === a.symbol ? ' cur' : '') + '" data-id="' + esc(a.id) + '" data-sym="' + esc(a.symbol) + '">'
      + '<div class="top">' + (a.avatar ? '<img class="av" src="' + esc(a.avatar) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '<span class="risk" style="background:' + col + '">' + a.risk.score + ' ' + esc(String(a.risk.label || '').toUpperCase()) + '</span><span class="sym">' + esc(a.symbol) + '</span><span class="mut">' + ago(a.at) + '</span>'
      + '<span class="pxv">$' + px(a.price) + '<br><span class="' + ((a.sincePct || 0) >= 0 ? 'up' : 'dn') + '">' + pc(a.sincePct) + ' since alert</span></span></div>'
      + bar(a) + '<div class="act"><span class="chip" style="background:' + act[1] + ';color:' + act[2] + '">' + act[0] + '</span>' + o + '<span class="why">' + esc((a.plan.reasons || [])[0] || '') + '</span></div>'
      + (S.openId === a.id ? detailHtml(a) : '') + '</div>';
  }
  function paint() {
    if (btn) btn.classList.toggle('on', S.open);
    if (!S.open) { if (panel) panel.style.display = 'none'; return; }
    if (!panel) {
      panel = document.createElement('aside'); panel.id = 'sml-cat-alerts'; panel.setAttribute('aria-label', 'Alerts desk'); document.body.appendChild(panel);
      panel.addEventListener('click', onClick);
    }
    panel.style.display = 'flex';
    var body;
    if (S.err && !S.alerts.length && !S.teaser) body = '<div class="empty">' + esc(S.err) + '</div>';
    else if (S.teaser) body = '<div class="empty"><b style="font-size:22px;color:#fff">' + S.teaser.count + '</b><br>open alert' + (S.teaser.count === 1 ? '' : 's') + ' on the desk right now' + (S.teaser.closed ? ' · ' + S.teaser.closed + ' closed' : '') + '.<br><br>Premium members see every alert with its risk grade, plan, stop and target.</div>';
    else body = list().length ? list().map(row).join('') : '<div class="empty">' + (S.busy ? 'Loading the alerts…' : 'No alerts in this list right now.') + '</div>';
    panel.innerHTML = '<header><b>ALERTS DESK</b><small>' + (S.asOf ? 'updated ' + ago(S.asOf) + ' ago' : '') + '</small><button type="button" data-act="close" aria-label="Close alerts">✕</button></header>'
      + (S.teaser ? '' : '<div class="tabs">' + [['all', 'All'], ['swings', 'Swings'], ['longterm', 'Long-Term']].map(function (t) { return '<button type="button" data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>')
      + '<div class="list">' + body + '</div><div class="note">Educational analysis of posted alerts. Not advice; nothing here places a trade.</div>';
  }
  function onClick(e) {
    var t = e.target.closest('[data-tab]'); if (t) { S.tab = t.getAttribute('data-tab'); save(); paint(); return; }
    if (e.target.closest('[data-act="close"]')) { S.open = false; save(); paint(); return; }
    if (e.target.closest('[data-stop]')) return;
    var r = e.target.closest('.row'); if (!r) return;
    var id = r.getAttribute('data-id'), sym = r.getAttribute('data-sym');
    if (chartSym() !== sym) switchChart(sym);
    if (S.openId === id) { S.openId = null; S.detail = null; paint(); return; }
    S.openId = id; S.detail = null; paint();
    api('&detail=' + encodeURIComponent(id)).then(function (j) { if (S.openId === id) { S.detail = j.alert; paint(); } }).catch(function () { /* the summary stays */ });
  }
  function load() {
    if (document.hidden || S.busy) return;
    S.busy = true;
    api('').then(function (j) {
      S.err = ''; S.asOf = j.asOf || Date.now();
      if (j.locked || j.view === 'teaser') { S.teaser = j.teaser || { count: 0, closed: 0 }; S.alerts = []; }
      else { S.teaser = null; S.alerts = j.alerts || []; }
      if (btn) btn.textContent = 'ALERTS' + (S.teaser ? ' · ' + S.teaser.count : S.alerts.length ? ' · ' + S.alerts.length : '');
    }).catch(function (e) { S.err = e && e.message ? e.message : 'The alerts desk is reconnecting…'; })
      .then(function () { S.busy = false; paint(); });
  }
  var tries = 0;
  (function mount() {
    var bar = document.getElementById('sml-cat-toolbar');
    if (!bar) { if (++tries < 240) setTimeout(mount, 150); return; }
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sml-cat-btn'; btn.textContent = 'ALERTS'; btn.title = 'Alerts desk: the trader\'s posted alerts with risk grade and plan';
    btn.addEventListener('click', function (e) { e.preventDefault(); S.open = !S.open; save(); paint(); if (S.open) load(); });
    bar.insertBefore(btn, bar.firstChild);
    load(); setInterval(load, 20000); setInterval(function () { if (S.open && !window.smlChartGesture) paint(); }, 30000);
  })();
})();
