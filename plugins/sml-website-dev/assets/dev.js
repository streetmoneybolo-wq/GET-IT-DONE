/* SML Website Dev panel. Administrators only (the server prints this file only for them and every route checks again).
   The EVOLVE button on every page opens the command center: Live bugs, Speed, Health, SEO & Index, Evolve, Competitors, Settings. */
(function () {
  'use strict';
  var C = window.SML_WD_ADMIN; if (!C || window.__smlWd) return; window.__smlWd = true;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)); };
  var ago = function (iso) { if (!iso) return 'never'; var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  var when = function (iso) { return iso ? new Date(iso).toLocaleString() : '—'; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function api(path, opts) {
    opts = opts || {};
    var o = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'X-WP-Nonce': C.nonce, 'content-type': 'application/json' }, credentials: 'same-origin' };
    if (opts.body) o.body = JSON.stringify(opts.body);
    return fetch(C.rest + path, o).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status)); return j; }); });
  }
  function toast(msg) { var t = document.createElement('div'); t.className = 'sml-wd-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  var ST = { tab: localStorage.getItem('sml-wd-tab') || 'live', open: false, lastId: 0, liveTimer: 0, overview: null, hours: 24 };
  try { ST.tab = localStorage.getItem('sml-wd-tab') || 'live'; } catch (_) {}

  /* ---------- shell ---------- */
  var TABS = [['live', 'Live bugs'], ['speed', 'Speed'], ['health', 'Health'], ['seo', 'SEO & Index'], ['evolve', 'Evolve'], ['competitors', 'Competitors'], ['settings', 'Settings']];
  function ring(score) {
    var c = 2 * Math.PI * 18, off = c * (1 - (score || 0) / 100), col = score >= 85 ? 'var(--green)' : score >= 60 ? 'var(--amber)' : 'var(--red)';
    return '<div class="sml-wd-ring" title="Health score"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--line2)" stroke-width="4"/><circle cx="22" cy="22" r="18" fill="none" stroke="' + col + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"/></svg><b>' + (score == null ? '–' : score) + '</b></div>';
  }
  function shellHTML() {
    var o = ST.overview || {};
    return '<div class="sml-wd-shell">' +
      '<div class="sml-wd-h">' + ring(o.score) + '<div><div class="t">Website Dev</div><div class="s">' + esc(C.host) + ' · ' + (o.asOf ? 'as of ' + when(o.asOf) : 'loading') + (o.aiOn ? ' · model on' : ' · rules only') + '</div></div><div class="grow"></div>' +
      '<div class="s sml-wd-mono" id="sml-wd-hsum"></div>' + (C.inline ? '' : '<button class="sml-wd-x" id="sml-wd-close" title="Close (Esc)">✕</button>') + '</div>' +
      '<div class="sml-wd-tabs">' + TABS.map(function (t) { return '<button class="sml-wd-tab' + (t[0] === ST.tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '<span class="b" id="sml-wd-b-' + t[0] + '" hidden></span></button>'; }).join('') + '</div>' +
      '<div class="sml-wd-body" id="sml-wd-body"><div class="sml-wd-empty">Loading…</div></div></div>';
  }
  var root;
  function mount() {
    if (C.inline) { root = $('#sml-wd-inline'); if (!root) return; }
    else {
      root = document.createElement('div'); root.id = 'sml-wd-panel'; document.body.appendChild(root);
      var fab = document.createElement('button'); fab.id = 'sml-wd-fab'; fab.type = 'button'; fab.innerHTML = '<span class="dot"></span>EVOLVE<span class="n" id="sml-wd-fab-n" hidden></span>'; fab.title = 'Website Dev: bugs, speed, health, Evolve (Ctrl+Shift+E)';
      fab.onclick = function () { ST.open ? close() : open(); };
      document.body.appendChild(fab);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ST.open) close(); if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); ST.open ? close() : open(); } });
    }
    root.innerHTML = shellHTML();
    bindShell();
    refreshOverview();
    if (C.inline) { open(); }
  }
  function bindShell() {
    var x = $('#sml-wd-close', root); if (x) x.onclick = close;
    $$('.sml-wd-tab', root).forEach(function (b) { b.onclick = function () { ST.tab = b.getAttribute('data-tab'); try { localStorage.setItem('sml-wd-tab', ST.tab); } catch (_) {} $$('.sml-wd-tab', root).forEach(function (t) { t.classList.toggle('on', t === b); }); render(); }; });
  }
  function open() { ST.open = true; if (!C.inline) { root.classList.add('open'); document.documentElement.style.overflow = 'hidden'; } render(); }
  function close() { ST.open = false; root.classList.remove('open'); document.documentElement.style.overflow = ''; clearTimeout(ST.liveTimer); }
  function refreshOverview() {
    api('/overview').then(function (o) {
      ST.overview = o;
      var h = $('.sml-wd-h', root); if (h) { h.querySelector('.sml-wd-ring').outerHTML = ring(o.score); h.querySelector('.s').textContent = C.host + ' · as of ' + when(o.asOf) + (o.aiOn ? ' · model on' : ' · rules only'); }
      var hs = $('#sml-wd-hsum', root); if (hs) hs.textContent = fmt(o.errors.total) + ' errors/24h · LCP ' + (o.vitals.lcp ? o.vitals.lcp.p75 + 'ms' : '–') + ' · server p95 ' + o.server.p95 + 'ms';
      badge('live', o.errors.distinct, o.errors.distinct === 0); badge('health', o.checks.summary.fail, o.checks.summary.fail === 0); badge('evolve', o.open, false);
      var fn = $('#sml-wd-fab-n'); var fab = $('#sml-wd-fab'); if (fab) { fab.classList.toggle('has-fail', o.checks.summary.fail > 0 || (o.errors.fatals && o.errors.fatals.length > 0)); } if (fn) { var n = o.checks.summary.fail + (o.errors.fatals ? o.errors.fatals.length : 0); fn.hidden = !n; fn.textContent = n; }
    }).catch(function (e) { var hs = $('#sml-wd-hsum', root); if (hs) hs.textContent = e.message; });
  }
  function badge(tab, n, good) { var b = $('#sml-wd-b-' + tab, root); if (!b) return; b.hidden = !n && !good; b.textContent = n ? n : '✓'; b.classList.toggle('ok', !!good); }
  function body(html) { var b = $('#sml-wd-body', root); if (b) b.innerHTML = html; return b; }
  function render() {
    clearTimeout(ST.liveTimer);
    var r = { live: renderLive, speed: renderSpeed, health: renderHealth, seo: renderSeo, evolve: renderEvolve, competitors: renderCompetitors, settings: renderSettings }[ST.tab] || renderLive;
    body('<div class="sml-wd-empty">Loading…</div>');
    r();
  }
  function sec(title, meta, actions) { return '<div class="sml-wd-sec"><h2>' + title + '</h2><div class="rule"></div>' + (meta ? '<span class="meta">' + meta + '</span>' : '') + (actions || '') + '</div>'; }
  function spark(series, key) {
    if (!series || !series.length) return '';
    var max = Math.max.apply(null, series.map(function (p) { return p[key]; }).concat([1])), w = 100 / series.length;
    return '<svg class="sml-wd-spark" viewBox="0 0 100 40" preserveAspectRatio="none">' + series.map(function (p, i) { var h = (p[key] / max) * 36; return '<rect x="' + (i * w + 0.5) + '" y="' + (40 - h) + '" width="' + (w - 1) + '" height="' + h + '" fill="' + (p[key] ? 'var(--red)' : 'var(--line2)') + '"><title>' + esc(p.h || p.at || '') + ': ' + p[key] + '</title></rect>'; }).join('') + '</svg>';
  }
  function kindPill(k) { var m = { js_error: 'error', js_rejection: 'error', php_fatal: 'fail', php_error: 'warn', rest_error: 'error', fetch: 'warn', resource: 'warn', http_404: 'info', a11y: 'info' }; return '<span class="sml-wd-pill ' + (m[k] || '') + '">' + esc(k.replace('_', ' ')) + '</span>'; }

  /* ---------- Live bugs ---------- */
  function renderLive() {
    Promise.all([api('/errors?hours=' + ST.hours + (ST.showResolved ? '&resolved=1' : '')), api('/live?limit=40')]).then(function (res) {
      var E = res[0], L = res[1]; ST.lastId = L.rows.length ? L.rows[0].id : ST.lastId;
      var o = ST.overview || { errors: { total: 0, distinct: 0, byKind: {} } };
      var byKind = Object.keys(o.errors.byKind || {}).map(function (k) { return kindPill(k) + ' <b class="sml-wd-mono">' + fmt(o.errors.byKind[k]) + '</b>'; }).join(' &nbsp; ');
      var html = '<div class="sml-wd-grid">' +
        '<div class="sml-wd-card"><h3>Errors, last 24 h</h3><div class="big">' + fmt(o.errors.total) + '</div><div class="sub">' + o.errors.distinct + ' distinct bugs</div></div>' +
        '<div class="sml-wd-card"><h3>By kind</h3><div style="font-size:12px;line-height:2">' + (byKind || '<span class="sml-wd-dim">nothing recorded yet</span>') + '</div></div>' +
        '<div class="sml-wd-card" style="grid-column:span 2"><h3>Errors per hour</h3>' + spark(E.series, 'n') + '</div></div>' +
        sec('Open bugs', E.rows.length + ' in ' + ST.hours + ' h', '<div class="sml-wd-row"><select id="sml-wd-hours" class="sml-wd-btn">' + [1, 6, 24, 72, 168].map(function (h) { return '<option value="' + h + '"' + (h === ST.hours ? ' selected' : '') + '>' + h + ' h</option>'; }).join('') + '</select><button class="sml-wd-btn sm" id="sml-wd-tog-res">' + (ST.showResolved ? 'Hide resolved' : 'Show resolved') + '</button></div>') +
        (E.rows.length ? E.rows.map(bugHTML).join('') : '<div class="sml-wd-empty">No bugs in this window. The beacon reports the moment one fires; this list refreshes itself.</div>') +
        sec('Live stream', 'newest first, auto-refresh') + '<table class="sml-wd-table" id="sml-wd-stream"><thead><tr><th>When</th><th>Kind</th><th>Where</th><th>What</th><th class="num">×</th></tr></thead><tbody>' + L.rows.map(streamRow).join('') + '</tbody></table>';
      var b = body(html);
      $('#sml-wd-hours', b).onchange = function () { ST.hours = Number(this.value); render(); };
      $('#sml-wd-tog-res', b).onclick = function () { ST.showResolved = !ST.showResolved; render(); };
      $$('[data-resolve]', b).forEach(function (btn) { btn.onclick = function () { var fp = btn.getAttribute('data-resolve'), un = btn.getAttribute('data-un') === '1'; btn.disabled = true; api('/resolve', { body: { fp: fp, resolve: !un } }).then(function () { toast(un ? 'Reopened' : 'Marked resolved; it comes back as "regressed" if it fires again'); render(); refreshOverview(); }).catch(function (e) { toast(e.message); btn.disabled = false; }); }; });
      pollLive();
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }
  function bugHTML(r) {
    var m = r.meta || {};
    var where = esc(r.url) + (m.source ? ' · <span class="sml-wd-dim">' + esc(m.source) + (m.line ? ':' + m.line : '') + '</span>' : '') + (m.target ? ' → <span class="sml-wd-dim">' + esc(m.target) + '</span>' : '') + (m.referer ? ' · from ' + esc(m.referer) : '') + (m.device ? ' · ' + esc(m.device) : '');
    return '<div class="sml-wd-bug ' + esc(r.level) + ' ' + esc(r.status) + '"><div><div class="sml-wd-row">' + kindPill(r.kind) + (r.status !== 'open' ? '<span class="sml-wd-pill ' + (r.status === 'regressed' ? 'info' : 'ok') + '">' + r.status + '</span>' : '') + '<span class="w">first ' + ago(r.first_at) + ' · last ' + ago(r.last_at) + '</span></div><div class="m">' + esc(r.message) + '</div><div class="w">' + where + '</div>' + (m.stack ? '<details><summary class="w">stack</summary><div class="sml-wd-mono sml-wd-wrap">' + esc(m.stack) + '</div></details>' : '') + '</div>' +
      '<div><div class="n">' + fmt(r.n) + '</div><button class="sml-wd-btn sm" data-resolve="' + esc(r.fp) + '" data-un="' + (r.status === 'resolved' ? 1 : 0) + '">' + (r.status === 'resolved' ? 'Reopen' : 'Resolve') + '</button></div></div>';
  }
  function streamRow(r, isNew) { var m = r.meta || {}; return '<tr' + (isNew ? ' class="new"' : '') + '><td class="sml-wd-mono sml-wd-dim">' + esc(ago(r.last_at)) + '</td><td>' + kindPill(r.kind) + '</td><td class="sml-wd-mono sml-wd-wrap">' + esc(r.url) + (m.target ? '<br><span class="sml-wd-dim">→ ' + esc(m.target) + '</span>' : '') + '</td><td class="sml-wd-wrap">' + esc(r.message) + '</td><td class="num">' + fmt(r.n) + '</td></tr>'; }
  function pollLive() {
    clearTimeout(ST.liveTimer);
    ST.liveTimer = setTimeout(function () {
      if (!ST.open || ST.tab !== 'live') return;
      api('/live?limit=20&since_id=' + ST.lastId).then(function (L) {
        var tb = $('#sml-wd-stream tbody', root);
        if (tb && L.rows.length) { ST.lastId = L.rows[0].id; tb.insertAdjacentHTML('afterbegin', L.rows.map(function (r) { return streamRow(r, true); }).join('')); while (tb.rows.length > 60) tb.deleteRow(-1); refreshOverview(); }
        pollLive();
      }).catch(pollLive);
    }, 8000);
  }

  /* ---------- Speed ---------- */
  function grade(g) { return g ? '<span class="sml-wd-pill ' + esc(g) + '">' + esc(g.replace('-', ' ')) + '</span>' : ''; }
  function renderSpeed() {
    api('/speed?hours=' + ST.hours).then(function (S) {
      var v = S.vitals || {};
      var tile = function (k, label, unit) { var x = v[k]; return '<div class="sml-wd-card"><h3>' + label + '</h3><div class="big">' + (x ? x.p75 + (unit || '') : '–') + '</div><div class="sub">' + (x ? grade(x.grade) + ' p75 of ' + x.n + ' views' : 'no samples yet') + '</div></div>'; };
      var html = '<div class="sml-wd-grid">' + tile('lcp', 'Largest Contentful Paint', ' ms') + tile('inp', 'Interaction to Next Paint', ' ms') + tile('cls', 'Cumulative Layout Shift') + tile('ttfb', 'Time to First Byte', ' ms') +
        '<div class="sml-wd-card"><h3>Server time</h3><div class="big">' + S.server.p95 + ' ms</div><div class="sub">p95 · p50 ' + S.server.p50 + ' ms · up to ' + S.server.maxQueries + ' queries · ' + S.server.n + ' requests</div></div>' +
        '<div class="sml-wd-card"><h3>Sampled views</h3><div class="big">' + fmt(S.views) + '</div><div class="sub">' + fmt(S.phones) + ' on phones · ' + S.longTasksPerView + ' long tasks per view</div></div></div>' +
        sec('Slowest pages for visitors', 'p75 per route') + table(['Route', 'Views', 'LCP', 'INP', 'CLS', 'TTFB'], S.routes.map(function (r) { return [esc(r.route), fmt(r.n), (r.lcp != null ? r.lcp + ' ' + grade(r.lcp_grade) : '–'), (r.inp != null ? r.inp + ' ' + grade(r.inp_grade) : '–'), (r.cls != null ? r.cls + ' ' + grade(r.cls_grade) : '–'), (r.ttfb != null ? r.ttfb + ' ' + grade(r.ttfb_grade) : '–')]; }), [0]) +
        sec('Slowest on the server', 'generation time, queries, peak memory') + table(['Route', 'Requests', 'p50 ms', 'p95 ms', 'Queries', 'MB'], S.server.slowest.map(function (r) { return [esc(r.route), fmt(r.n), r.p50, r.p95, r.queries, r.mem]; }), [0]) +
        sec('REST routes', 'the API the screens call') + table(['Route', 'Calls', 'p50 ms', 'p95 ms', '5xx %'], S.rest.map(function (r) { return [esc(r.route), fmt(r.n), r.p50, r.p95, r.errPct]; }), [0]) +
        '<p class="sml-wd-note">LCP, INP and CLS are Google\'s Core Web Vitals, graded on Google\'s lines (good / needs work / poor). Server time is what WordPress spent building the page before the first byte left; queries and memory say why. Visitor samples arrive at the beacon sample rate (an Evolve knob); administrators\' own views are always recorded.</p>';
      body(html);
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }
  function table(head, rows, textCols) {
    if (!rows.length) return '<div class="sml-wd-empty">No samples in this window yet.</div>';
    return '<table class="sml-wd-table"><thead><tr>' + head.map(function (h, i) { return '<th' + (textCols.indexOf(i) < 0 ? ' class="num"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (textCols.indexOf(i) < 0 ? ' class="num"' : ' class="sml-wd-mono sml-wd-wrap"') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  /* ---------- Health ---------- */
  function checkRow(r) { return '<div class="sml-wd-bug ' + (r.status === 'fail' ? 'error' : r.status === 'warn' ? 'warn' : 'resolved') + '"><div><div class="sml-wd-row"><span class="sml-wd-pill ' + esc(r.status) + '">' + esc(r.status) + '</span><b>' + esc(r.title) + '</b>' + (r.ms ? '<span class="w">' + r.ms + ' ms</span>' : '') + '</div><div class="w sml-wd-wrap">' + esc(r.detail) + '</div>' + (r.fix && r.status !== 'ok' ? '<div style="margin-top:4px;font-size:12.5px">↳ ' + esc(r.fix) + '</div>' : '') + (r.data && r.id === 'indexability' && r.data.length ? '<details><summary class="w">' + r.data.length + ' conflicts</summary><table class="sml-wd-table">' + r.data.map(function (c) { return '<tr><td class="sml-wd-mono">' + esc(c.map) + '</td><td class="sml-wd-mono sml-wd-wrap"><a class="sml-wd-link" target="_blank" rel="noopener" href="' + esc(C.home.replace(/\/$/, '') + c.url) + '">' + esc(c.url) + '</a></td><td class="sml-wd-wrap">' + esc(c.why) + '</td></tr>'; }).join('') + '</table></details>' : '') + (r.data && r.id === 'cdn-pins' ? '<details><summary class="w">pinned revisions</summary><div class="sml-wd-mono sml-wd-wrap">' + Object.keys(r.data).map(function (sha) { return '<div><a class="sml-wd-link" target="_blank" rel="noopener" href="' + esc(C.repo + '/commit/' + sha) + '">' + esc(sha.slice(0, 7)) + '</a> · ' + esc(r.data[sha].join(', ')) + '</div>'; }).join('') + '</div></details>' : '') + '</div></div>'; }
  function renderHealth() {
    api('/checks').then(function (R) {
      var c = R.checks || {}, rows = c.rows || [], s = c.summary || { ok: 0, warn: 0, fail: 0 };
      var order = { fail: 0, warn: 1, ok: 2 }; rows = rows.slice().sort(function (a, b) { return order[a.status] - order[b.status]; });
      var html = '<div class="sml-wd-grid"><div class="sml-wd-card"><h3>Failing</h3><div class="big" style="color:var(--red)">' + s.fail + '</div></div><div class="sml-wd-card"><h3>Warnings</h3><div class="big" style="color:var(--amber)">' + s.warn + '</div></div><div class="sml-wd-card"><h3>Passing</h3><div class="big" style="color:var(--green)">' + s.ok + '</div></div><div class="sml-wd-card"><h3>Last run</h3><div class="big" style="font-size:16px">' + (c.at ? ago(c.at) : 'never') + '</div><div class="sub">' + (c.at ? when(c.at) + ' · ' + c.ms + ' ms · ' + esc(c.reason) : 'runs hourly from cron') + '</div></div>' +
        '<div class="sml-wd-card" style="grid-column:span 2"><h3>Failing checks over time</h3>' + spark((R.history || []).map(function (h) { return { at: h.at, n: h.summary.fail }; }), 'n') + '</div></div>' +
        sec('Checks', rows.length + ' checks', '<button class="sml-wd-btn pri" id="sml-wd-run">Run checks now</button>') +
        (rows.length ? rows.map(checkRow).join('') : '<div class="sml-wd-empty">No run yet. Press Run checks now.</div>') +
        '<p class="sml-wd-note">The checks fetch the site from the outside the way a visitor or a crawler does: the watched pages, every sitemap and a sample of the URLs inside them (status, noindex, canonical, VideoObject), the REST index (a namespace that vanishes is a plugin that died, the WPCode outage signature), the jsDelivr pins the loaders print, the IndexNow key file, cron, duplicate active plugins, and the PHP runtime.</p>';
      var b = body(html);
      $('#sml-wd-run', b).onclick = function () { this.disabled = true; this.textContent = 'Running (up to 75 s)…'; api('/checks/run', { body: {} }).then(function () { toast('Checks finished'); render(); refreshOverview(); }).catch(function (e) { toast(e.message); render(); }); };
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }

  /* ---------- SEO & Index ---------- */
  function renderSeo() {
    api('/checks').then(function (R) {
      var rows = ((R.checks || {}).rows || []).filter(function (r) { return /robots|sitemaps|indexability|video-seo|indexnow|cdn-pins|page/.test(r.id); });
      var home = C.home.replace(/\/$/, '');
      var html = sec('Index status', 'from the last health run', '<div class="sml-wd-row"><a class="sml-wd-btn sm" target="_blank" rel="noopener" href="https://www.google.com/search?q=' + encodeURIComponent('site:' + C.host) + '">Google index check ↗</a><a class="sml-wd-btn sm" target="_blank" rel="noopener" href="https://www.bing.com/search?q=' + encodeURIComponent('site:' + C.host) + '">Bing index check ↗</a><a class="sml-wd-btn sm" target="_blank" rel="noopener" href="https://search.google.com/search-console">Search Console ↗</a><a class="sml-wd-btn sm" target="_blank" rel="noopener" href="' + esc(home) + '/sml-video-sitemap.xml">Video sitemap ↗</a><a class="sml-wd-btn sm" target="_blank" rel="noopener" href="' + esc(home) + '/sitemap_index.xml">Sitemap index ↗</a></div>') +
        (rows.length ? rows.map(checkRow).join('') : '<div class="sml-wd-empty">Run the health checks first.</div>') +
        '<p class="sml-wd-note">A URL only ranks when three things agree: it is in a sitemap, the page itself says index (no noindex meta or X-Robots-Tag), and the canonical points at itself. The indexability check fetches a sample from every sitemap and reports every disagreement, which is exactly the case where the Creator Studio\'s "Request indexing" button pings the engines for a page they will then refuse. Google takes no pings: it re-reads the sitemaps. IndexNow (Bing, Yahoo, DuckDuckGo, Naver, Seznam) takes pings only while the key file is served.</p>';
      body(html);
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }

  /* ---------- Evolve ---------- */
  function propHTML(p) {
    var acts = [];
    if (p.status === 'proposed') acts.push(['approved', 'Approve', 'pri']); if (p.status === 'approved') acts.push(['building', 'Building']); if (p.status !== 'shipped') acts.push(['shipped', 'Shipped']); if (p.status !== 'dismissed') acts.push(['dismissed', 'Dismiss', 'danger']);
    return '<div class="sml-wd-prop ' + esc(p.status) + '"><div class="sml-wd-row"><span class="sml-wd-pill ' + (p.status === 'approved' ? 'ok' : p.status === 'building' ? 'info' : '') + '">' + esc(p.status) + '</span><span class="sml-wd-pill">' + esc(p.area) + '</span><span class="sml-wd-pill">' + esc(p.size) + ' · ' + esc(p.risk) + ' risk</span><span class="sml-wd-pill">' + esc(p.model) + '</span><span class="sml-wd-dim" style="font-size:12px">' + esc(p.day) + ' · score ' + Number(p.score || 0).toFixed(2) + '</span></div>' +
      '<div class="t">' + esc(p.title) + '</div><p><span class="k">Evidence</span>' + esc(p.evidence) + '</p><p><span class="k">Change</span>' + esc(p.change) + '</p>' + (p.effect ? '<p><span class="k">Effect</span>' + esc(p.effect) + '</p>' : '') +
      (p.measured ? '<p><span class="k">Measured</span>' + esc(p.measured.metric) + ' ' + p.measured.before + ' → ' + p.measured.after + ' (' + (p.measured.impact > 0 ? '+' : '') + Math.round(p.measured.impact * 100) + '%)</p>' : '') +
      '<div class="acts">' + acts.map(function (a) { return '<button class="sml-wd-btn sm ' + (a[2] || '') + '" data-prop="' + esc(p.id) + '" data-status="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div></div>';
  }
  function renderEvolve() {
    api('/evolve').then(function (E) {
      var b = E.brief, t = E.today || {};
      var html = '<div class="sml-wd-grid">' +
        '<div class="sml-wd-card"><h3>Health today</h3><div class="big">' + (t.score != null ? t.score : '–') + '<span style="font-size:14px;color:var(--dim)">/100</span></div><div class="sub">' + fmt(t.views) + ' sampled views · ' + fmt(t.errors ? t.errors.total : 0) + ' errors · ' + (t.checks ? t.checks.fail : 0) + ' failing checks</div></div>' +
        '<div class="sml-wd-card"><h3>Last brief</h3><div class="big" style="font-size:16px">' + (b ? ago(b.at) : 'never') + '</div><div class="sub">' + (b ? esc(b.model) + ' · ' + esc(b.reason) + (b.modelError ? ' · model: ' + esc(b.modelError) : '') : (E.aiOn ? 'daily at the quiet hour' : 'rules brief daily; add a model key in Settings for the written brief')) + '</div></div>' +
        '<div class="sml-wd-card"><h3>Open proposals</h3><div class="big">' + E.proposals.length + '</div><div class="sub">' + E.shipped.length + ' shipped · ' + E.measured.length + ' measured</div></div>' +
        '<div class="sml-wd-card"><h3>Engine</h3><div class="sub" style="margin:0">' + (E.aiOn ? 'Claude (' + esc(E.model) + ') + rules' : 'rules only') + '<br>' + E.turns.length + ' recent knob turns</div><button class="sml-wd-btn pri" id="sml-wd-brief" style="margin-top:8px">Run brief now</button></div></div>' +
        sec('The brief', b ? b.day : '') + (b ? '<div class="sml-wd-brief">' + esc(b.summary) + '</div>' : '<div class="sml-wd-empty">No brief yet. Run brief now reads the last 24 hours and writes one.</div>') +
        sec('Proposals', 'approve, dismiss, or mark shipped; shipped ones are measured a week later') + (E.proposals.length ? E.proposals.map(propHTML).join('') : '<div class="sml-wd-empty">Nothing open.</div>') +
        (E.shipped.length ? sec('Shipped') + E.shipped.map(propHTML).join('') : '') +
        sec('Knobs', 'turned by the engine within rails; pin one to hold it') + Object.keys(E.knobs).map(function (k) { var x = E.knobs[k]; return '<div class="sml-wd-knob"><div><b class="sml-wd-mono">' + esc(k) + '</b><div class="about">' + esc(x.about) + ' · rail ' + x.min + '–' + x.max + ' ' + esc(x.unit) + '</div></div><input type="range" min="' + x.min + '" max="' + x.max + '" step="' + x.step + '" value="' + x.value + '" data-knob="' + esc(k) + '"><div class="sml-wd-row"><span class="v">' + x.value + ' ' + esc(x.unit) + '</span><label style="font-size:12px"><input type="checkbox" data-pin="' + esc(k) + '"' + (x.pinned ? ' checked' : '') + '> pinned</label></div></div>'; }).join('') +
        sec('What has paid off here', 'area weights, learned from measured outcomes') + Object.keys(E.weights).map(function (a) { return '<div class="sml-wd-row" style="margin:4px 0"><span class="sml-wd-mono" style="width:110px">' + esc(a) + '</span><div class="sml-wd-bar" style="flex:1"><i style="width:' + (E.weights[a] / 2 * 100) + '%"></i></div><span class="sml-wd-mono" style="width:40px;text-align:right">' + E.weights[a].toFixed(2) + '</span></div>'; }).join('') +
        (E.turns.length ? sec('Recent turns') + '<table class="sml-wd-table">' + E.turns.map(function (t) { return '<tr><td class="sml-wd-mono sml-wd-dim">' + esc(ago(t.at)) + '</td><td class="sml-wd-mono">' + esc(t.knob) + '</td><td class="num">' + t.from + ' → ' + t.to + '</td><td class="sml-wd-wrap">' + esc(t.reason) + '</td></tr>'; }).join('') + '</table>' : '') +
        '<p class="sml-wd-note">How it evolves: every day the engine digests the last 24 hours (errors, vitals, server time, the checks, what competitors shipped), turns its knobs inside their rails from that evidence, and writes a brief with three to seven proposals, each with the numbers behind it. The rules brief always runs; with a model key the written brief from Claude is added on top. When you mark a proposal shipped it snapshots that area\'s metric and measures the change a week later, nudging the area\'s weight, so the ordering of what it proposes next leans toward what has actually paid off on this site.</p>';
      var el = body(html);
      $('#sml-wd-brief', el).onclick = function () { this.disabled = true; this.textContent = 'Writing…'; api('/evolve/brief', { body: {} }).then(function (r) { toast(r.ok ? 'Brief written, ' + r.added + ' new proposals' : r.error); render(); refreshOverview(); }).catch(function (e) { toast(e.message); render(); }); };
      $$('[data-prop]', el).forEach(function (btn) { btn.onclick = function () { btn.disabled = true; api('/evolve/proposal', { body: { id: btn.getAttribute('data-prop'), status: btn.getAttribute('data-status') } }).then(function () { render(); refreshOverview(); }).catch(function (e) { toast(e.message); btn.disabled = false; }); }; });
      $$('[data-knob]', el).forEach(function (inp) { inp.onchange = function () { var k = inp.getAttribute('data-knob'); api('/evolve/knob', { body: { key: k, value: Number(inp.value) } }).then(function (r) { inp.closest('.sml-wd-knob').querySelector('.v').textContent = r.knob.value + ' ' + r.knob.unit; toast(k + ' set to ' + r.knob.value); }).catch(function (e) { toast(e.message); }); }; });
      $$('[data-pin]', el).forEach(function (inp) { inp.onchange = function () { api('/evolve/knob', { body: { key: inp.getAttribute('data-pin'), pinned: inp.checked } }).then(function () { toast(inp.checked ? 'Pinned: the engine leaves it alone' : 'Unpinned'); }).catch(function (e) { toast(e.message); }); }; });
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }

  /* ---------- Competitors ---------- */
  function renderCompetitors() {
    api('/competitors').then(function (R) {
      var c = R.competitors || {}; var items = c.items || [], gaps = c.gaps || [], parity = c.parity || [], caps = c.capabilities || [], src = c.sources || [];
      var ideaHTML = function (g) { return '<div class="sml-wd-prop"><div class="sml-wd-row"><span class="sml-wd-pill ' + (g.kind === 'gap' ? 'fail' : 'ok') + '">' + (g.kind === 'gap' ? 'gap' : 'we have this') + '</span><span class="sml-wd-pill">' + esc(g.focus) + '</span><span class="sml-wd-dim" style="font-size:12px">' + esc(g.source) + ' · ' + esc(ago(g.at)) + '</span></div><div class="t">' + esc(g.idea) + '</div><p><span class="k">They shipped</span><a class="sml-wd-link" target="_blank" rel="noopener" href="' + esc(g.link) + '">' + esc(g.title) + '</a></p><p><span class="k">For us</span>' + esc(g.change) + '</p><div class="acts"><button class="sml-wd-btn sm pri" data-promote="' + esc(encodeURIComponent(JSON.stringify({ title: g.idea, evidence: g.source + ': ' + g.title, change: g.change, area: 'competition', size: g.kind === 'gap' ? 'L' : 'M', risk: 'medium' }))) + '">Add to proposals</button></div></div>'; };
      var html = '<div class="sml-wd-grid"><div class="sml-wd-card"><h3>Last scan</h3><div class="big" style="font-size:16px">' + (c.at ? ago(c.at) : 'never') + '</div><div class="sub">' + src.filter(function (s) { return s.ok; }).length + ' of ' + src.length + ' feeds answered' + (c.errors && c.errors.length ? ' · ' + esc(c.errors.join(', ')) : '') + '</div></div><div class="sml-wd-card"><h3>Gaps</h3><div class="big" style="color:var(--red)">' + gaps.length + '</div><div class="sub">things they ship that this site has no layer for</div></div><div class="sml-wd-card"><h3>Parity, go further</h3><div class="big" style="color:var(--green)">' + parity.length + '</div><div class="sub">things this site already has</div></div><div class="sml-wd-card"><h3>Scan</h3><div class="sub" style="margin:0">every ' + ((ST.overview || {}).knobs ? '' : '') + 'few hours from cron</div><button class="sml-wd-btn pri" id="sml-wd-scan" style="margin-top:8px">Scan now</button></div></div>' +
        sec('What this site can do today', 'from its live REST namespaces') + '<div>' + caps.map(function (k) { return '<span class="sml-wd-cap ' + (k.have ? 'have' : 'gap') + '">' + (k.have ? '✓ ' : '○ ') + esc(k.capability) + '</span>'; }).join('') + '</div>' +
        sec('Gaps', gaps.length + ' ideas') + (gaps.length ? gaps.map(ideaHTML).join('') : '<div class="sml-wd-empty">No gaps found in the latest headlines.</div>') +
        sec('Parity: do it better', parity.length + ' ideas') + (parity.length ? parity.slice(0, 8).map(ideaHTML).join('') : '<div class="sml-wd-empty">Nothing yet.</div>') +
        sec('Latest from the competition', items.length + ' headlines') + '<table class="sml-wd-table">' + items.slice(0, 40).map(function (it) { return '<tr' + (it.new ? ' class="new"' : '') + '><td class="sml-wd-mono sml-wd-dim">' + esc(ago(it.at)) + '</td><td><b>' + esc(it.source) + '</b></td><td class="sml-wd-wrap"><a class="sml-wd-link" target="_blank" rel="noopener" href="' + esc(it.link) + '">' + esc(it.title) + '</a>' + (it.idea ? ' <span class="sml-wd-pill ' + (it.idea.kind === 'gap' ? 'fail' : 'ok') + '">' + esc(it.idea.focus) + '</span>' : '') + '</td></tr>'; }).join('') + '</table>' +
        '<p class="sml-wd-note">The watch reads the public product blogs of the platforms members compare this site to (the list is in Settings), maps each headline to the capabilities this site exposes through its own REST namespaces, and turns it into an idea: a gap when there is no layer for it here, parity-plus when there is. Add to proposals puts an idea in the Evolve queue, where it is weighed with everything else.</p>';
      var el = body(html);
      $('#sml-wd-scan', el).onclick = function () { this.disabled = true; this.textContent = 'Reading feeds…'; api('/competitors/scan', { body: {} }).then(function () { toast('Scan finished'); render(); }).catch(function (e) { toast(e.message); render(); }); };
      $$('[data-promote]', el).forEach(function (btn) { btn.onclick = function () { btn.disabled = true; api('/evolve/propose', { body: JSON.parse(decodeURIComponent(btn.getAttribute('data-promote'))) }).then(function (r) { toast(r.ok ? 'Added to the Evolve proposals' : 'Already proposed'); refreshOverview(); }).catch(function (e) { toast(e.message); btn.disabled = false; }); }; });
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    api('/settings').then(function (R) {
      var s = R.settings;
      var html = '<div class="sml-wd-form" style="max-width:760px">' + sec('Settings') +
        '<label><input type="checkbox" id="sml-wd-s-beacon"' + (s.beacon_enabled ? ' checked' : '') + '> Visitor beacon on (anonymous errors and Web Vitals)</label>' +
        '<label for="sml-wd-s-pages">Watched pages (one path per line; fetched by the health checks)</label><textarea id="sml-wd-s-pages">' + esc((s.watch_pages || []).join('\n')) + '</textarea>' +
        '<label for="sml-wd-s-comp">Competitor feeds (Name|feed URL, one per line)</label><textarea id="sml-wd-s-comp">' + esc((s.competitors || []).join('\n')) + '</textarea>' +
        '<label for="sml-wd-s-hour">Daily brief hour (UTC)</label><input type="number" id="sml-wd-s-hour" min="0" max="23" value="' + Number(s.brief_hour_utc) + '" style="max-width:120px">' +
        '<label for="sml-wd-s-model">Model for the written brief</label><input type="text" id="sml-wd-s-model" value="' + esc(s.anthropic_model) + '" style="max-width:320px">' +
        '<label for="sml-wd-s-key">Anthropic API key ' + (R.aiOn ? '<span class="sml-wd-pill ok">configured via ' + esc(R.aiSource) + '</span>' : '<span class="sml-wd-pill warn">not set: rules brief only</span>') + '</label><input type="password" id="sml-wd-s-key" placeholder="' + (R.aiOn ? 'leave blank to keep the current key' : 'sk-ant-…') + '" autocomplete="off" style="max-width:480px">' +
        '<p class="sml-wd-note">The key is stored as an option and never shown again. Safer still: define SML_WD_ANTHROPIC_KEY in wp-config.php and leave this blank. Without a key the engine runs the rules brief, which is grounded in the same telemetry.</p>' +
        '<div class="sml-wd-row" style="margin-top:14px"><button class="sml-wd-btn pri" id="sml-wd-save">Save settings</button>' + (R.aiOn && R.aiSource === 'option' ? '<button class="sml-wd-btn danger" id="sml-wd-clearkey">Remove stored key</button>' : '') + '<a class="sml-wd-btn" href="' + esc(C.adminUrl) + '">Open in wp-admin ↗</a></div>' +
        sec('About') + '<p class="sml-wd-note">SML Website Dev ' + esc(C.version) + '. Visitors run a small beacon that reports script errors, failed requests, broken assets, Web Vitals and an accessibility count to this site only; it stores paths, never query strings, cookies, names or ids. The server records PHP warnings and fatals, REST failures, 404s and request timings. Everything is bounded and pruned (retention is an Evolve knob). Shortcut: Ctrl+Shift+E.</p></div>';
      var el = body(html);
      $('#sml-wd-save', el).onclick = function () { var btn = this; btn.disabled = true; var payload = { beacon_enabled: $('#sml-wd-s-beacon', el).checked, watch_pages: $('#sml-wd-s-pages', el).value, competitors: $('#sml-wd-s-comp', el).value, brief_hour_utc: Number($('#sml-wd-s-hour', el).value), anthropic_model: $('#sml-wd-s-model', el).value }; var key = $('#sml-wd-s-key', el).value.trim(); if (key) payload.anthropic_key = key; api('/settings', { body: payload }).then(function () { toast('Saved'); render(); refreshOverview(); }).catch(function (e) { toast(e.message); btn.disabled = false; }); };
      var ck = $('#sml-wd-clearkey', el); if (ck) ck.onclick = function () { api('/settings', { body: { anthropic_key: '', clear_key: true } }).then(function () { toast('Key removed'); render(); }).catch(function (e) { toast(e.message); }); };
    }).catch(function (e) { body('<div class="sml-wd-empty">' + esc(e.message) + '</div>'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
