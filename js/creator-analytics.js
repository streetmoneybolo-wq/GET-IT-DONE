/*!
 * SML Creator Analytics — /creator-studio/analytics/ rebuilt from the
 * "creator-dashboard.html" design on the site's REAL data. Per-user: every
 * section renders only for what the signed-in user owns (videos/channel,
 * Loop Letters, groups). Never fabricates: metrics the site does not track yet
 * (audience geography, traffic sources, watch time/retention, community-pool
 * eligibility) show explicit "not connected / not tracked yet" states.
 *
 * Sources (all same-origin REST with nonce):
 *   sml-members/v1/creator-studio/realtime   overview · 28-day series · content · revenue engine · wallet
 *   sml-video-upload-studio/v1/creator-dashboard   thumbnails for recent uploads
 *   sml-creator-gate/v1/status                 hasChannel / hasLetter / handles
 *   sml-letters/v1/mine · sml-loopletters/v1/subscribers · /settings   letters
 *   sml/v1/group?group_id · /group/roster · /group/posts · /group/performance   groups
 *   /groups/ (own page HTML, data-group-member="1")   which groups the user is in
 *   sml-lb/v1/me · sml-live/v1/status
 */
(function () {
  'use strict';
  if (window.__smlCreatorAnalyticsBooted) return;
  window.__smlCreatorAnalyticsBooted = true;

  var loader = document.getElementById('sml-ca-js');
  var NONCE = window.SML_CA_NONCE || (loader && loader.dataset.nonce) || window.SML_CG_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var LOGO = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@3560eef3c519/img/loop-logo.png';
  var BANNED_GROUPS = ['the-options-plug', 'spy-spy-highflyers']; // shadow-banned site-wide (see snippet 6873)
  var root = document.getElementById('sml-ca-root');
  if (!root) return;

  /* ---------- utils ---------- */
  function api(path) {
    var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE;
    var u = '/wp-json' + path + (path.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
    return fetch(u, { credentials: 'same-origin', headers: h, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); })
      .catch(function () { return { ok: false, status: 0, j: null }; });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function q(sel, r) { return (r || root).querySelector(sel); }
  function n(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function fmt(v) { v = n(v); if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return Math.round(v).toLocaleString(); }
  function money(v) { return '$' + n(v).toFixed(2); }
  function pct(v) { return n(v).toFixed(2) + '%'; }
  function ago(iso) { var t = Date.parse(iso); if (!t) return ''; var s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
  function within(iso, days) { var t = Date.parse(iso); return t && (Date.now() - t) < days * 86400e3; }
  function empty(title, body) { return '<div class="ca-empty"><b>' + esc(title) + '</b><small>' + esc(body) + '</small></div>'; }
  function cleanUrl(url) {
    try { var u = new URL(String(url || ''), location.origin); return u.origin.toLowerCase() + u.pathname.replace(/\/+$/, '/') ; }
    catch (e) { return String(url || '').split(/[?#]/)[0].replace(/\/+$/, '/'); }
  }
  function itemSeries(item) {
    var key = cleanUrl(item && item.url);
    return ((S.ga4 && S.ga4.itemSeries) || []).filter(function (r) { return r.kind === item.type && cleanUrl(r.url) === key; });
  }
  function trackedContent(engineRows) {
    var tracked = (S.ga4 && Array.isArray(S.ga4.items)) ? S.ga4.items : [];
    if (!tracked.length) return [];
    var byUrl = {};
    (engineRows || []).forEach(function (c) { if (c && c.url) byUrl[cleanUrl(c.url)] = c; });
    (S.uploads || []).forEach(function (u) { if (u && u.watch_url && !byUrl[cleanUrl(u.watch_url)]) byUrl[cleanUrl(u.watch_url)] = { title: u.title, url: u.watch_url, thumbnail: u.thumbnail, type: 'video' }; });
    return tracked.map(function (g) {
      var old = byUrl[cleanUrl(g.url)] || {};
      return Object.assign({}, old, {
        title: old.title || g.title || (g.kind.charAt(0).toUpperCase() + g.kind.slice(1)),
        type: g.kind,
        url: g.url,
        views: n(g.views),
        users: n(g.users),
        sessions: n(g.sessions),
        contentId: g.contentId || '',
        analyticsSource: 'ga4'
      });
    }).sort(function (a, b) { return n(b.views) - n(a.views); });
  }
  var CSS_ACC = 'oklch(0.72 0.17 165)', CSS_C2 = 'oklch(0.7 0.14 220)', CSS_C4 = 'oklch(0.78 0.14 85)', CSS_C3 = 'oklch(0.72 0.15 290)';

  // sparkline / line chart as inline SVG (no chart library — matches the design's viewBox SVGs)
  function pathFor(vals, w, h, pad) {
    pad = pad || 2; var max = Math.max.apply(null, vals.concat([1])); var N = vals.length;
    var pts = vals.map(function (v, i) { return [N > 1 ? (i / (N - 1)) * w : 0, h - pad - (h - pad * 2) * (v / max)]; });
    var d = ''; pts.forEach(function (p, i) { d += (i ? ' L ' : 'M ') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); });
    return { line: d, area: d + ' L ' + w + ' ' + h + ' L 0 ' + h + ' Z', max: max };
  }
  function spark(vals, color) {
    var w = 240, h = 36, p = pathFor(vals, w, h);
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="height:' + h + 'px;display:block" preserveAspectRatio="none"><path d="' + p.area + '" fill="' + color + '" opacity="0.12"></path><path d="' + p.line + '" fill="none" stroke="' + color + '" stroke-width="1.8" vector-effect="non-scaling-stroke"></path></svg>';
  }
  function lineChart(series, keys, colors, labelsFn) {
    // series: [{date, ...}], keys: metric names; y ticks + 4 date labels like the design
    var w = 640, h = 220, L = 42, B = 22, T = 10, R = 8, iw = w - L - R, ih = h - T - B;
    var max = 1; series.forEach(function (s) { keys.forEach(function (k) { max = Math.max(max, n(s[k])); }); });
    var out = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
    for (var g = 0; g <= 4; g++) { var y = T + ih * g / 4; out += '<line x1="' + L + '" y1="' + y + '" x2="' + (w - R) + '" y2="' + y + '" stroke="#252f3b" stroke-width="1"/>'; out += '<text x="' + (L - 6) + '" y="' + (y + 4) + '" font-size="10" fill="#8b98a9" text-anchor="end">' + fmt(max * (1 - g / 4)) + '</text>'; }
    keys.forEach(function (k, ki) {
      var d = '';
      series.forEach(function (s, i) { var x = L + (series.length > 1 ? iw * i / (series.length - 1) : 0), y = T + ih - ih * (n(s[k]) / max); d += (i ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1); });
      if (ki === 0) out += '<path d="' + d + ' L ' + (w - R) + ' ' + (T + ih) + ' L ' + L + ' ' + (T + ih) + ' Z" fill="' + colors[ki] + '" opacity="0.10"/>';
      out += '<path d="' + d + '" fill="none" stroke="' + colors[ki] + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    });
    [0, Math.floor(series.length / 3), Math.floor(series.length * 2 / 3), series.length - 1].forEach(function (i, j) {
      if (!series[i]) return; var x = L + (series.length > 1 ? iw * i / (series.length - 1) : 0);
      out += '<text x="' + x + '" y="' + (h - 6) + '" font-size="10" fill="#8b98a9" text-anchor="' + (j === 0 ? 'start' : (j === 3 ? 'end' : 'middle')) + '">' + esc(labelsFn(series[i])) + '</text>';
    });
    return out + '</svg>';
  }
  function dlabel(s) { var d = String(s.date || ''); var m = d.match(/^\d{4}-(\d{2})-(\d{2})/); if (!m) return d; return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m[1], 10) - 1] + ' ' + parseInt(m[2], 10); }
  function delta(series, key, total) {
    // honest comparison inside the 28-day window: last 14 days vs the 14 before
    if (!series || series.length < 4) return '';
    var half = Math.floor(series.length / 2), a = 0, b = 0;
    series.slice(half).forEach(function (s) { a += n(s[key]); }); series.slice(0, half).forEach(function (s) { b += n(s[key]); });
    if (!a && !b) return '<div class="ca-delta flat">' + (n(total) > 0 ? 'daily breakdown not reported for this metric' : 'no activity yet in this window') + '</div>';
    if (!b) return '<div class="ca-delta">▲ new activity · last ' + (series.length - half) + ' days</div>';
    var p = (a - b) / b * 100; var up = p >= 0;
    return '<div class="ca-delta' + (up ? '' : ' down') + '">' + (up ? '▲ +' : '▼ ') + p.toFixed(1) + '% · last ' + (series.length - half) + ' days vs prior ' + half + '</div>';
  }

  function healthPanel(ga, presence, trackedRows) {
    var tracking = ga && ga.itemTracking ? ga.itemTracking : {};
    var gaReady = !!ga;
    var itemReady = gaReady && tracking.available === true;
    var presenceReady = !!presence;
    var checked = tracking.checkedAt ? ago(tracking.checkedAt) : '';
    var statuses = [
      ['GA4 connection', gaReady, gaReady ? (ga.cached ? 'Connected · cached report' : 'Connected · fresh report') : 'Unavailable — historical analytics are not being reported'],
      ['Item attribution', itemReady, itemReady ? 'Active for Channels, videos, live streams, Letters, and articles' : 'Unavailable — item visits are not being attributed'],
      ['Realtime presence', presenceReady, presenceReady ? 'Connected · ' + fmt(presence.window || 90) + '-second activity window' : 'Unavailable — active viewers cannot be reported'],
      ['Processed items', itemReady, fmt((trackedRows || []).length) + ' item' + ((trackedRows || []).length === 1 ? '' : 's') + (checked ? ' · checked ' + checked : '')]
    ];
    return '<div class="ca-card ca-health"><h3>Analytics health<span class="ca-fresh">automatic checks</span></h3><div class="ca-health-grid">' + statuses.map(function (s) {
      return '<div class="ca-health-row"><span class="ca-health-dot ' + (s[1] ? 'ok' : 'bad') + '"></span><div><b>' + esc(s[0]) + '</b><small>' + esc(s[2]) + '</small></div></div>';
    }).join('') + '</div>' +
      (itemReady && !(trackedRows || []).length ? '<div class="ca-note">Tracking is working. No attributed item has finished GA4 processing yet; this is not reported as zero traffic.</div>' : '') +
      '</div>';
  }

  /* ---------- state ---------- */
  var S = { rt: null, gate: null, lb: null, live: null, ga4: null, presence: null, presenceHistory: [], shadow: null, adsense: null, letters: null, subs: null, lsettings: null, uploads: null, groups: [], view: 'main' };

  function rememberPresence(presence) {
    if (!presence || presence.count == null) return;
    S.presenceHistory.push({ at: Date.now(), count: n(presence.count) });
    if (S.presenceHistory.length > 30) S.presenceHistory = S.presenceHistory.slice(-30);
  }

  document.documentElement.classList.add('smlca-on'); document.body.classList.add('smlca-on');
  if (!document.getElementById('sml-ca-font')) { var f = document.createElement('link'); f.id = 'sml-ca-font'; f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap'; document.head.appendChild(f); }
  root.innerHTML = '<div class="ca-wrap">' + header(null) + '<div class="ca-loading">Loading your analytics…</div></div>';

  function header(rt) {
    var u = rt && rt.user || {}; var ov = rt && rt.overview || {};
    var initial = ((u.display_name || '?').trim().charAt(0) || '?').toUpperCase();
    var lb = S.lb || {};
    return '<header class="ca-header"><div class="ca-brand"><img src="' + LOGO + '" alt="Stock Market Loop"><span class="ca-crumb">/ Creator Studio / Analytics</span></div><div class="ca-sp"></div>' +
      (rt ? '<div class="ca-creator"><div class="ca-avatar">' + (u.avatar_url ? '<img src="' + esc(u.avatar_url) + '" alt="">' : esc(initial)) + '</div><div><b>' + esc(u.display_name || '') + '</b><span>' + (S.gate && S.gate.channelHandle ? '@' + esc(S.gate.channelHandle) : (S.gate && S.gate.letterHandle ? '@' + esc(S.gate.letterHandle) : 'creator')) + '</span></div>' +
        '<div class="ca-lb"><b>' + fmt(ov.loop_bucks != null ? ov.loop_bucks : (lb.balance || 0)) + '</b><span>Loop Bucks' + (lb.rank ? ' · #' + esc(lb.rank) : '') + '</span></div></div>' : '') +
      '<span class="ca-pill">Last 28 days</span><a class="ca-pill" href="/creator-studio/">Creator Studio ↗</a></header>';
  }

  function pulseSection(id, title, note, html) {
    return '<section class="ca-section" id="ca-' + esc(id) + '"><div class="ca-section-head"><h2>' + esc(title) + '</h2><span>' + esc(note || '') + '</span></div>' + html + '</section>';
  }

  function pulseShell(rt, content) {
    var u = rt && rt.user || {};
    var propertyName = (S.gate && (S.gate.channelHandle || S.gate.letterHandle)) ? '@' + (S.gate.channelHandle || S.gate.letterHandle) : 'creator property';
    var nav = [
      ['realtime', 'Realtime'], ['overview', 'Overview'], ['acquisition', 'Acquisition'],
      ['engagement', 'Engagement'], ['monetization', 'Monetization'], ['retention', 'Retention'],
      ['demographics', 'Demographics'], ['tech', 'Tech']
    ];
    return '<div class="ca-app"><aside class="ca-side"><a class="ca-side-logo" href="/"><span class="ca-pulse-mark">▲</span><span>Pulse <small>/ ' + esc(propertyName) + '</small></span></a>' +
      '<nav class="ca-nav">' + nav.map(function (x, i) { return '<a class="' + (i === 0 ? 'on' : '') + '" href="#ca-' + x[0] + '" data-ca-nav="' + x[0] + '"><span></span>' + x[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="ca-side-foot"><small>Property: ' + esc(propertyName) + '</small><small>GA4 data stream · creator scoped</small><a href="/creator-studio/">← Creator Studio</a></div></aside>' +
      '<div class="ca-work"><header class="ca-top"><div><span>Reports · All data</span><b>Analytics overview</b></div><div class="ca-sp"></div><span class="ca-live"><span class="b"></span>LIVE</span><button class="ca-pill" type="button" id="ca-range">Last 28 days⌄</button><button class="ca-pill" type="button" id="ca-compare">Compare</button><button class="ca-pill" type="button" id="ca-share">Share ↗</button></header>' +
      '<main class="ca-main">' + content + '<div class="ca-foot">Counts are aggregated. Individual visitors, IP addresses, and exact locations are never shown.</div></main></div></div>';
  }

  var COUNTRY_POINT = {
    US:[24,38],CA:[18,27],MX:[20,48],BR:[37,68],AR:[34,82],CL:[29,79],CO:[29,59],PE:[27,67],
    GB:[47,28],IE:[44,29],FR:[49,34],ES:[45,39],PT:[43,39],DE:[52,31],NL:[50,29],BE:[49,31],IT:[53,39],
    CH:[51,35],AT:[54,34],SE:[55,20],NO:[51,19],FI:[59,20],PL:[57,31],UA:[63,34],RO:[59,38],GR:[57,42],TR:[64,43],
    RU:[73,25],IN:[72,52],PK:[68,49],BD:[76,52],CN:[80,42],JP:[92,43],KR:[88,44],ID:[82,67],PH:[88,59],VN:[83,56],TH:[79,57],
    AU:[88,80],NZ:[98,88],ZA:[55,82],NG:[48,61],KE:[59,66],EG:[58,50],MA:[45,48],SA:[65,52],AE:[68,53],IL:[60,48]
  };
  function countryName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  }
  function liveLocationMap(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var max = 1; rows.forEach(function (r) { max = Math.max(max, n(r.viewers || r.users)); });
    var dots = rows.map(function (r) {
      var code = String(r.countryCode || '').toUpperCase(), p = COUNTRY_POINT[code];
      if (!p) return '';
      var count = n(r.viewers || r.users), radius = Math.max(1.8, Math.min(4.6, 1.8 + 2.8 * count / max));
      return '<g class="ca-map-dot"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + radius.toFixed(1) + '"></circle><circle class="ring" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (radius + 3).toFixed(1) + '"></circle><title>' + esc(countryName(code)) + ': ' + fmt(count) + ' active</title></g>';
    }).join('');
    return '<div class="ca-map"><svg viewBox="0 0 110 100" role="img" aria-label="Active users by country">' +
      '<path d="M5 19l14-9 16 4 7 10-8 8-9-3-7 9-9-4zM28 48l11 5 8 14-5 24-10-9-5-20zM45 18l16-7 19 6 17 10-7 13-17-2-8 9-12-7-9-12zM49 48l14-4 11 12-6 29-13 4-8-21zM78 57l11-8 13 8-3 12-13 3zM88 78l13-3 6 10-9 10-12-7z"></path>' + dots + '</svg>' +
      (rows.length ? '<div class="ca-map-note">Live country-level presence · hover a marker for its count</div>' : '<div class="ca-map-empty"><b>No located active viewers right now</b><span>The map updates as creator-page heartbeats arrive through the site CDN.</span></div>') + '</div>';
  }

  function presenceBars() {
    var values = S.presenceHistory.map(function (x) { return n(x.count); });
    var missing = Math.max(0, 30 - values.length), max = Math.max.apply(Math, [1].concat(values));
    var bars = [];
    for (var i = 0; i < missing; i++) bars.push('<i class="unknown" title="Awaiting sample"></i>');
    values.forEach(function (value) {
      var height = value ? Math.max(8, Math.round(value / max * 100)) : 3;
      bars.push('<i style="height:' + height + '%" title="' + fmt(value) + ' active"></i>');
    });
    return '<div class="ca-minute-chart"><div class="ca-minute-bars">' + bars.join('') + '</div><div class="ca-minute-axis"><span>Earlier</span><span>Now</span></div></div>';
  }

  /* ---------- boot: load everything, then decide sections by ownership ---------- */
  Promise.all([
    api('/sml-members/v1/creator-studio/realtime'),
    api('/sml-creator-gate/v1/status'),
    api('/sml-lb/v1/me'),
    api('/sml-live/v1/status'),
    api('/sml-creator-analytics/v1/audience?range=28'),
    api('/sml-creator-analytics/v1/presence'),
    api('/sml-creator-analytics/v1/monetization-shadow'),
    api('/sml-creator-analytics/v1/adsense-attribution/me')
  ]).then(function (r) {
    if (r[0].status === 401 || r[1].status === 401) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
    S.rt = r[0].ok ? r[0].j : null; S.gate = r[1].ok ? r[1].j : {}; S.lb = r[2].ok ? r[2].j : null; S.live = r[3].ok ? r[3].j : null; S.ga4 = r[4].ok ? r[4].j : null; S.presence = r[5].ok ? r[5].j : null; S.shadow = r[6].ok ? r[6].j : null; S.adsense = r[7].ok ? r[7].j : null;
    rememberPresence(S.presence);
    var more = [];
    var hasLetter = !!(S.gate && S.gate.hasLetter);
    more.push(api('/sml-letters/v1/mine')); more.push(api('/sml-loopletters/v1/subscribers')); more.push(hasLetter ? api('/sml-loopletters/v1/settings') : Promise.resolve({ ok: false }));
    more.push(api('/sml-video-upload-studio/v1/creator-dashboard'));
    more.push(loadGroups());
    return Promise.all(more).then(function (m) {
      S.letters = m[0].ok && m[0].j ? (m[0].j.letters || []) : []; S.subs = m[1].ok && m[1].j ? m[1].j.counts : null; S.lsettings = m[2].ok ? m[2].j : null;
      S.uploads = m[3].ok && m[3].j ? (m[3].j.recent_uploads || []) : [];
      S.groups = m[4] || [];
      renderMain();
      setInterval(refreshRealtime, 60000);
      setInterval(refreshPresence, 20000);
    });
  });
  function refreshRealtime() { api('/sml-members/v1/creator-studio/realtime').then(function (r) { if (r.ok && r.j && S.view === 'main') { S.rt = r.j; renderMain(); } }); }
  function refreshPresence() { api('/sml-creator-analytics/v1/presence').then(function (r) { if (r.ok && r.j) { S.presence = r.j; rememberPresence(S.presence); if (S.view === 'main') renderMain(); } }); }

  function loadGroups() {
    // the site has no "my groups" route; the Groups page marks membership on each tile
    return fetch('/groups/?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (h) {
      var ids = []; var re = /data-group-id="(\d+)"[^>]*data-group-member="1"|data-group-member="1"[^>]*data-group-id="(\d+)"/g, m;
      while ((m = re.exec(h))) { var id = m[1] || m[2]; if (id && ids.indexOf(id) === -1) ids.push(id); }
      ids = ids.slice(0, 8);
      return Promise.all(ids.map(function (id) {
        return Promise.all([api('/sml/v1/group?group_id=' + id), api('/sml/v1/group/roster?group_id=' + id), api('/sml/v1/group/posts?group_id=' + id), api('/sml/v1/group/performance?group_id=' + id)]).then(function (x) {
          var g = x[0].ok && x[0].j && x[0].j.group; if (!g) return null;
          if (BANNED_GROUPS.indexOf(g.slug) > -1) return null;
          var roster = x[1].ok ? x[1].j : {}; var posts = x[2].ok && x[2].j ? (x[2].j.posts || []) : []; var perf = x[3].ok && x[3].j ? x[3].j.performance : null;
          return { id: id, g: g, role: roster.myRole || (roster.isOwner ? 'owner' : 'member'), members: roster.members || [], posts28: posts.filter(function (p) { return within(p.created_at, 28); }).length, postsAll: posts.length, perf: perf };
        });
      })).then(function (arr) { return arr.filter(Boolean); });
    }).catch(function () { return []; });
  }

  /* ---------- MAIN VIEW ---------- */
  function renderMain() {
    S.view = 'main';
    var rt = S.rt || {}, ov = rt.overview || {}, series = rt.series || [], content = rt.content || [];
    var hasVideos = n(ov.video_count) > 0 || content.some(function (c) { return /video/i.test(c.type || ''); }) || !!(S.gate && S.gate.hasChannel);
    var hasLetters = !!(S.gate && S.gate.hasLetter) || (S.letters && S.letters.length > 0);
    var hasGroups = S.groups.length > 0;
    var isLive = !!(S.live && S.live.is_live);
    var eng = rt.ad_analytics || {}, vid = rt.video_analytics || {}, gad = rt.group_ad_analytics || {}, wallet = rt.wallet || {};

    if (!S.rt) {
      root.innerHTML = '<div class="ca-wrap">' + header(null) + '<div class="ca-onboard"><div class="ca-big">We couldn’t load your analytics</div><div class="ca-sub" style="margin-top:8px">The analytics service didn’t respond. <a href="' + esc(location.pathname) + '">Try again</a>.</div></div></div>';
      return;
    }
    if (!hasVideos && !hasLetters && !hasGroups) {
      root.innerHTML = '<div class="ca-wrap">' + header(rt) + '<div class="ca-onboard"><div class="ca-big">Nothing to analyze yet</div><div class="ca-sub" style="margin-top:8px">Analytics appear here for the things you own — a Loop Channel, Loop Letters, and groups you belong to.</div>' +
        '<div class="ca-row"><a class="ca-btn" href="/create-channel/">Create a Loop Channel</a><a class="ca-btn2" href="/groups/">Explore groups</a></div></div></div>';
      return;
    }

    // Pulse's overview strip, populated only by verified creator-owned totals.
    var ownedCount = n(ov.video_count) + n(ov.posts) + n(ov.chart_posts) + n((S.letters || []).length);
    var kpis = '<div class="ca-grid ca-kpi-grid">' +
      kpi('Views', fmt(ov.views), delta(series, 'views', ov.views), spark(series.map(function (s) { return n(s.views); }), CSS_ACC), '28 days') +
      kpi('Impressions', fmt(ov.impressions), delta(series, 'impressions', ov.impressions), spark(series.map(function (s) { return n(s.impressions); }), CSS_C2), '28 days') +
      kpi('Engagement', fmt(ov.engagement), delta(series, 'engagement', ov.engagement), spark(series.map(function (s) { return n(s.engagement); }), CSS_C4), '28 days') +
      kpi('CTR', pct(ov.ctr), '<div class="ca-sub">Clicks divided by verified impressions</div>', '', '28 days') +
      kpi('Followers', fmt(ov.followers), '<div class="ca-sub">' + fmt(ov.following) + ' following</div>', '', 'current') +
      kpi('Owned content', fmt(ownedCount), '<div class="ca-sub">Videos · letters · posts</div>', '', 'current') +
      kpi('Creator revenue', money(ov.creator_revenue_usd), '<div class="ca-sub">Verified creator share</div>', '', '28 days') +
      '</div>';

    // Audience row: aggregate GA4 only. City rows below the server's privacy
    // threshold are omitted by the server and are never inferred here.
    var ga = S.ga4 && S.ga4.configured && S.ga4.available !== false ? S.ga4 : null;
    var countries = ga && Array.isArray(ga.countries) ? ga.countries : [];
    var cities = ga && Array.isArray(ga.cities) ? ga.cities : [];
    var presence = S.presence && S.presence.available ? S.presence : null;
    var liveAudience = presence ? n(presence.count) : null;
    var liveKinds = presence && presence.byKind ? presence.byKind : {};
    var liveCountries = presence && Array.isArray(presence.countries) ? presence.countries : [];
    var liveBreakdown = Object.keys(liveKinds).filter(function (k) { return n(liveKinds[k]) > 0; }).map(function (k) { return fmt(liveKinds[k]) + ' ' + k; }).join(' · ');
    function audienceBars(items, nameKey, valueKey, cap) {
      items = (items || []).slice(0, cap || 8); var max = 1;
      items.forEach(function (x) { max = Math.max(max, n(x[valueKey])); });
      return '<div class="ca-audience-bars">' + items.map(function (x) {
        var label = x[nameKey] || 'Unknown'; if (nameKey === 'city' && x.country) label += ', ' + x.country;
        return '<div class="ca-audience-row"><span>' + esc(label) + '</span><i><b style="width:' + Math.max(2, Math.round(n(x[valueKey]) / max * 100)) + '%"></b></i><strong>' + fmt(x[valueKey]) + '</strong></div>';
      }).join('') + '</div>';
    }
    var realtimeSources = ga && Array.isArray(ga.sources) ? ga.sources : [];
    var gaKinds = ga && Array.isArray(ga.kinds) ? ga.kinds : [];
    var gaItems = ga && Array.isArray(ga.items) ? ga.items : [];
    var devices = ga && Array.isArray(ga.devices) ? ga.devices : [];
    var liveCountryRows = liveCountries.map(function (x) { return { country: countryName(x.countryCode), viewers: x.viewers }; });
    var liveCard = '<div class="ca-card ca-active-card"><h3>Users in the last ' + (presence ? fmt(presence.window) : '90') + ' seconds</h3>' +
      '<div class="ca-active-number"><div class="ca-big ' + (liveAudience > 0 ? 'acc' : '') + '">' + (liveAudience != null ? fmt(liveAudience) : '—') + '</div><div class="ca-live' + (isLive ? '' : ' off') + '"><span class="b"></span>' + (isLive ? 'ON AIR' : 'OFFLINE') + '</div></div>' +
      presenceBars() +
      '<div class="ca-sub">' + (presence ? (liveAudience > 0 ? 'Active across your creator pages' + (liveBreakdown ? ' · ' + esc(liveBreakdown) : '') : 'No active visitors in the current window.') : 'Creator presence is temporarily unavailable.') + '</div>' +
      '<div class="ca-device-block"><h4>Device category <span>28-day GA4 mix</span></h4>' + (devices.length ? audienceBars(devices, 'device', 'users', 4) : '<div class="ca-sub">Device data will appear after GA4 processes creator-attributed visits.</div>') + '</div>' +
      (isLive ? '' : '<a class="ca-text-link" href="/go-live/">Start a live stream →</a>') + '</div>';
    var audience = '<div class="ca-grid ca-rt-hero">' + liveCard +
      '<div class="ca-card ca-map-card"><h3>Active users by location<span class="ca-fresh">live · country level</span></h3>' + liveLocationMap(liveCountries) + '</div></div>' +
      '<div class="ca-grid ca-rt-mini">' +
        '<div class="ca-card ca-mini-card"><h3>Users by first source<span class="ca-fresh">28 days</span></h3>' + (realtimeSources.length ? audienceBars(realtimeSources, 'source', 'sessions', 5) : empty('Not enough data yet', 'Creator-scoped sources appear after GA4 processing.')) + '</div>' +
        '<div class="ca-card ca-mini-card"><h3>Users by content kind<span class="ca-fresh">28 days</span></h3>' + (gaKinds.length ? audienceBars(gaKinds, 'kind', 'users', 5) : (Object.keys(liveKinds).length ? audienceBars(Object.keys(liveKinds).map(function (k) { return { kind: k, users: liveKinds[k] }; }), 'kind', 'users', 5) : empty('No activity yet', 'Creator content categories appear here.'))) + '</div>' +
        '<div class="ca-card ca-mini-card"><h3>Views by page title<span class="ca-fresh">28 days</span></h3>' + (gaItems.length ? audienceBars(gaItems, 'title', 'views', 5) : empty('Not enough data yet', 'Tracked creator pages appear after attributed visits.')) + '</div>' +
        '<div class="ca-card ca-mini-card"><h3>Active countries<span class="ca-fresh">live</span></h3>' + (liveCountryRows.length ? audienceBars(liveCountryRows, 'country', 'viewers', 5) : empty('No located viewers', 'Country rows update with live presence.')) + '</div>' +
        '<div class="ca-card ca-mini-card"><h3>Key activity<span class="ca-fresh">28 days</span></h3><div class="ca-key-metrics"><div><b>' + fmt(ov.engagement) + '</b><span>engagements</span></div><div><b>' + fmt(ov.impressions) + '</b><span>impressions</span></div><div><b>' + pct(ov.ctr) + '</b><span>CTR</span></div></div></div>' +
      '</div>';

    // your content by kind (real counts of what you own)
    var kinds = [];
    if (hasVideos) kinds.push(['video', 'Videos', fmt(ov.video_count || (rt.video_library || {}).videos || 0), fmt(ov.video_views || ov.views) + ' views']);
    if (hasLetters) { var pub = (S.letters || []).filter(function (l) { return (l.status || '') === 'published'; }).length; kinds.push(['letter', 'Letters', fmt((S.letters || []).length), pub + ' published · ' + (S.subs ? fmt(S.subs.confirmed) + ' subscribers' : 'subscribers —')]); }
    if (n(ov.posts) + n(ov.chart_posts) > 0) kinds.push(['post', 'Posts', fmt(n(ov.posts) + n(ov.chart_posts)), fmt(ov.chart_posts) + ' chart posts']);
    if (hasGroups) kinds.push(['group', 'Groups', fmt(S.groups.length), fmt(ov.groups_created) + ' created by you']);
    kinds.push(['publication', 'Followers', fmt(ov.followers), fmt(ov.following) + ' following']);
    var kindsCard = '<div class="ca-card"><h3>Your content</h3><div class="ca-kinds">' + kinds.map(function (k) { return '<div class="ca-kind"><span class="ca-tag ' + k[0] + '">' + esc(k[1]) + '</span><div class="n">' + k[2] + '</div><div class="ca-sub">' + esc(k[3]) + '</div></div>'; }).join('') + '</div></div>';

    // groups table (real): role, members, posts 28d, ad revenue from the engine when it has any
    var groupsCard = '';
    if (hasGroups) {
      var gmap = {}; ((gad.groups) || []).forEach(function (g) { gmap[String(g.group_id || g.id)] = g; });
      groupsCard = '<div class="ca-card"><h3>Your groups<span class="ca-fresh">' + (gad.creator_share_percent != null ? 'engine: ' + esc(gad.creator_share_percent) + '% creator share of verified group ad revenue' : 'group ad revenue') + '</span></h3>' +
        '<table><thead><tr><th>Group</th><th>Your role</th><th class="num">Members</th><th class="num">Posts (28d)</th><th class="num">Group ad revenue</th><th class="num">Your share</th></tr></thead><tbody>' +
        S.groups.map(function (x, i) {
          var ge = gmap[String(x.id)];
          var rev = ge ? money(ge.verified_gross_usd || ge.gross_usd || 0) : '—';
          var share = ge ? money(ge.verified_creator_usd || ge.creator_usd || 0) : '—';
          return '<tr class="click" data-group="' + i + '"><td><span class="ca-title">' + esc(x.g.name) + '</span><div class="ca-sub">' + esc((x.g.url || ('/groups/' + x.g.slug + '/')).replace(/^https?:\/\/[^/]+/, '')) + (x.g.is_paid ? ' · paid' : '') + '</div></td><td><span class="ca-role ' + esc(x.role) + '">' + esc(x.role) + '</span></td><td class="num">' + fmt(x.g.member_count || x.members.length) + '</td><td class="num">' + fmt(x.posts28) + '</td><td class="num">' + rev + '</td><td class="num" style="color:var(--ca-gold);font-weight:700">' + share + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (gad.message ? '<div class="ca-note">' + esc(gad.message) + '</div>' : '') + '</div>';
    }

    // top content (real rows from the engine) + right column: traffic sources (real array, usually empty) + new this week (real)
    var gaRows = trackedContent(content);
    var rows = gaRows.length ? gaRows : content.slice().sort(function (a, b) { return n(b.views) - n(a.views); });
    var thumbs = {}; (S.uploads || []).forEach(function (u) { if (u.watch_url) thumbs[u.watch_url] = u.thumbnail; });
    var contentTable = rows.length && gaRows.length ? '<table><thead><tr><th>Content</th><th>Kind</th><th class="num">Tracked views</th><th class="num">Visitors</th><th class="num">Sessions</th></tr></thead><tbody>' +
      rows.slice(0, 20).map(function (c, i) {
        var kind = c.type || 'publication';
        var th = (c.thumbnail || thumbs[c.url]) ? '<img class="ca-thumb" src="' + esc(c.thumbnail || thumbs[c.url]) + '" alt="">' : '';
        return '<tr class="click" data-content="' + i + '"><td>' + th + '<span class="ca-title">' + esc(c.title || 'Untitled') + '</span><div class="ca-sub">' + esc((c.url || '').replace(/^https?:\/\/[^/]+/, '')) + '</div></td><td><span class="ca-tag ' + esc(kind) + '">' + esc(kind) + '</span></td><td class="num">' + fmt(c.views) + '</td><td class="num">' + fmt(c.users) + '</td><td class="num">' + fmt(c.sessions) + '</td></tr>';
      }).join('') + '</tbody></table><div class="ca-note">Item counts begin when creator attribution was enabled; earlier visits are not backfilled.</div>' : rows.length ? '<table><thead><tr><th>Content</th><th>Kind</th><th class="num">Views</th><th class="num">Impr.</th><th class="num">CTR</th></tr></thead><tbody>' +
      rows.slice(0, 12).map(function (c, i) {
        var kind = /video/i.test(c.type) ? 'video' : (/letter/i.test(c.type) ? 'letter' : (/post/i.test(c.type) ? 'post' : 'publication'));
        var th = thumbs[c.url] ? '<img class="ca-thumb" src="' + esc(thumbs[c.url]) + '" alt="">' : '';
        return '<tr class="click" data-content="' + i + '"><td>' + th + '<span class="ca-title">' + esc(c.title || 'Untitled') + '</span><div class="ca-sub">' + esc((c.url || '').replace(/^https?:\/\/[^/]+/, '')) + (c.ticker ? ' · $' + esc(c.ticker) : '') + '</div></td><td><span class="ca-tag ' + kind + '">' + kind + '</span></td><td class="num">' + fmt(c.views) + '</td><td class="num">' + fmt(c.impressions) + '</td><td class="num">' + pct(c.ctr) + '</td></tr>';
      }).join('') + '</tbody></table><div class="ca-note">Item-level GA4 tracking is active. This table will switch to tracked 28-day visits after the first attributed view is processed.</div>' : empty('No tracked content yet', 'Open a Channel, watch page, article, livestream, or published Loop Letter and its attributed visits will appear here after GA4 processes them.');
    // letters as content rows (title/status/words) when the engine has none of them
    var lettersCard = '';
    if (hasLetters) {
      var subs = S.subs || {};
      lettersCard = '<div class="ca-card"><h3>Loop Letters<span class="ca-fresh">' + (S.lsettings && S.lsettings.publicUrl ? '<a href="' + esc(S.lsettings.publicUrl) + '">' + esc((S.lsettings.name || 'publication')) + ' ↗</a>' : 'your publication') + '</span></h3>' +
        '<div class="ca-kinds" style="margin-bottom:12px">' +
          '<div class="ca-kind"><b>Subscribers</b><div class="n">' + fmt(subs.confirmed) + '</div><div class="ca-sub">' + fmt(subs.pending) + ' pending · ' + fmt(subs.unsubscribed) + ' unsubscribed</div></div>' +
          '<div class="ca-kind"><b>Letters</b><div class="n">' + fmt((S.letters || []).length) + '</div><div class="ca-sub">' + (S.letters || []).filter(function (l) { return l.status === 'published'; }).length + ' published</div></div>' +
          '<div class="ca-kind"><b>New this week</b><div class="n">' + (S.letters || []).filter(function (l) { return within(l.published_at || l.created_at || l.date, 7); }).length + '</div><div class="ca-sub">letters in the last 7 days</div></div>' +
        '</div>' +
        ((S.letters || []).length ? '<table><thead><tr><th>Letter</th><th>Status</th><th class="num">Words</th><th class="num">Read</th></tr></thead><tbody>' + (S.letters || []).slice(0, 8).map(function (l) {
          return '<tr><td><span class="ca-title">' + esc(l.title || 'Untitled') + '</span><div class="ca-sub">' + esc(l.content_type || '') + (l.price_lb ? ' · ' + fmt(l.price_lb) + ' LB' : '') + '</div></td><td><span class="ca-tag ' + (l.status === 'published' ? 'letter' : '') + '">' + esc(l.status || '') + '</span></td><td class="num">' + fmt(l.word_count) + '</td><td class="num">' + (l.read_minutes ? l.read_minutes + ' min' : '—') + '</td></tr>';
        }).join('') + '</tbody></table>' : empty('No letters yet', 'Write your first letter from Creator Studio.')) +
        '<div class="ca-note">Per-letter reads and open rates appear when letter analytics is connected.</div></div>';
    }
    var sources = ga && Array.isArray(ga.sources) && ga.sources.length ? ga.sources : (rt.traffic_sources || []);
    var newWeek = (S.uploads || []).filter(function (u) { return within(u.created_at, 7); }).length + (S.letters || []).filter(function (l) { return within(l.published_at || l.created_at || l.date, 7); }).length;
    var contentRow = '<div class="ca-grid ca-g32"><div class="ca-card"><h3>Top content<span class="ca-fresh">28 days · ' + (gaRows.length ? 'item tracking' : 'existing totals') + '</span></h3>' + contentTable + '</div>' +
      '<div class="ca-col"><div class="ca-card"><h3>Where visitors came from</h3>' + (sources.length ? '<table>' + sources.slice(0, 8).map(function (s) { return '<tr><td>' + esc(s.source || s.name || '') + '</td><td class="num">' + fmt(s.sessions || s.views || s.count) + '</td></tr>'; }).join('') + '</table>' : empty('Not enough data yet', 'Traffic sources appear once the site’s analytics has enough visits to report — nothing is shown below the privacy threshold.')) + '</div>' +
      '<div class="ca-card"><h3>New this week</h3>' + (newWeek ? '<div class="ca-big">' + newWeek + '</div><div class="ca-sub">new uploads and letters in the last 7 days</div>' : empty('Not enough data yet', 'Nothing published in the last 7 days. New content shows here once it’s reached the reporting threshold.')) + '</div></div></div>';

    var health = healthPanel(ga, presence, gaRows);

    // revenue + wallet (real engine values; honest labels)
    var revCard = '<div class="ca-grid ca-g4">' +
      '<div class="ca-card gold"><h3 class="gold">Creator revenue (28d)</h3><div class="ca-big gold">' + money(ov.creator_revenue_usd) + '</div><div class="ca-sub">RPM ' + money(ov.rpm) + ' · CPM ' + money(ov.cpm) + '</div></div>' +
      '<div class="ca-card"><h3>Video ad revenue</h3><div class="ca-big">' + money(ov.video_creator_revenue_usd) + '</div><div class="ca-sub">' + (vid.enabled ? 'creator share ' + esc(vid.creator_share_percent) + '%' : esc(vid.message || 'Video ad analytics not enabled yet')) + '</div></div>' +
      '<div class="ca-card"><h3>Group ad revenue</h3><div class="ca-big">' + money(ov.group_ad_creator_revenue_usd) + '</div><div class="ca-sub">' + (gad.creator_share_percent != null ? 'your share · ' + esc(gad.creator_share_percent) + '% of verified group ad revenue' : 'from groups you own or admin') + '</div></div>' +
      '<div class="ca-card"><h3>Loop Wallet<span class="ca-fresh">' + (wallet.stripe_connected ? 'Stripe connected' : 'Stripe not connected') + '</span></h3><div class="ca-big">' + fmt(wallet.available_balance) + ' <span class="ca-sub">LB available</span></div><div class="ca-sub">' + fmt(wallet.pending_balance) + ' pending · ' + fmt(wallet.lifetime_earnings) + ' lifetime</div>' + (wallet.transactions_url ? '<div style="margin-top:8px"><a class="ca-btn2" href="' + esc(wallet.transactions_url) + '">Manage wallet →</a></div>' : '') + '</div>' +
      '</div>';

    var sh = S.shadow;
    var adsh = S.adsense;
    var adsenseCard = adsh ? '<div class="ca-card"><h3>Google AdSense attribution<span class="ca-fresh">SHADOW ESTIMATE · payouts locked</span></h3><div class="ca-grid ca-g4">' +
      '<div class="ca-kind"><b>Mapped watch-page estimate</b><div class="n">' + money(adsh.mappedEstimatedUsd) + '</div><div class="ca-sub">' + fmt(adsh.mappedRows) + ' verified creator-owned URL rows</div></div>' +
      '<div class="ca-kind"><b>' + esc(adsh.shadowCreatorPercent) + '% policy preview</b><div class="n">' + money(adsh.shadowCreatorEstimatedUsd) + '</div><div class="ca-sub">reporting only · not payable</div></div>' +
      '<div class="ca-kind"><b>Quarantined rows</b><div class="n">' + fmt(adsh.quarantinedRows) + '</div><div class="ca-sub">unresolved or unsupported page URLs</div></div>' +
      '<div class="ca-kind"><b>Reporting connection</b><div class="n" style="font-size:16px">' + esc(adsh.connectionStatus) + '</div><div class="ca-sub">PAGE_URL attribution · no browser-side guessing</div></div>' +
      '</div><div class="ca-note">AdSense estimates can change after invalid-traffic adjustments. They stay outside Loop Wallet and the verified payout ledger until Google reporting is connected and a finalized settlement is explicitly approved.</div></div>' : '';
    var shadowCard = sh ? '<div class="ca-card gold"><h3 class="gold">Monetization reconciliation<span class="ca-fresh">SHADOW MODE · payouts locked</span></h3><div class="ca-grid ca-g4">' +
      '<div class="ca-kind"><b>Verified source total</b><div class="n">' + money(sh.sourceCreatorUsd) + '</div><div class="ca-sub">what the existing source records assign</div></div>' +
      '<div class="ca-kind"><b>' + esc(sh.creatorSharePercent) + '% creator policy</b><div class="n">' + money(sh.shadowCreatorUsd) + '</div><div class="ca-sub">audit-only shadow calculation</div></div>' +
      '<div class="ca-kind"><b>Difference</b><div class="n">' + money(sh.discrepancyUsd) + '</div><div class="ca-sub">' + (sh.reconciled ? 'source and policy reconcile' : 'requires review before payouts') + '</div></div>' +
      '<div class="ca-kind"><b>Pending review</b><div class="n">' + money((sh.lifecycle || {}).pendingUsd) + '</div><div class="ca-sub">' + fmt((sh.lifecycle || {}).pendingReviews) + ' locked review snapshots</div></div>' +
      '<div class="ca-kind"><b>Shadow approved</b><div class="n">' + money((sh.lifecycle || {}).approvedUsd) + '</div><div class="ca-sub">' + fmt((sh.lifecycle || {}).approvedReviews) + ' approvals · not payable</div></div>' +
      '<div class="ca-kind"><b>Safety checks</b><div class="n">' + fmt(sh.entries) + '</div><div class="ca-sub">immutable entries · ' + fmt(sh.excluded) + ' excluded · ' + fmt(sh.reversals) + ' reversals</div></div>' +
      '</div><div class="ca-note">Coverage now: verified group-ad events. Video: ' + esc((((sh.sourceReadiness || {}).videoAds || {}).status) || 'not connected') + '. Internal ads: ' + esc((((sh.sourceReadiness || {}).internalAds || {}).status) || 'not connected') + '. Unsupported revenue is quarantined and cannot enter review, Loop Wallet, or payouts.</div></div>' :
      '<div class="ca-card"><h3>Monetization reconciliation<span class="ca-fresh">not connected</span></h3>' + empty('Shadow ledger is unavailable', 'No earnings will be approved or paid until reconciliation is available.') + '</div>';

    var languages = ga && Array.isArray(ga.languages) ? ga.languages : [];
    var browsers = ga && Array.isArray(ga.browsers) ? ga.browsers : [];
    var operatingSystems = ga && Array.isArray(ga.operatingSystems) ? ga.operatingSystems : [];
    var demographics = '<div class="ca-grid ca-report-grid"><div class="ca-card"><h3>Countries<span class="ca-fresh">28 days</span></h3>' +
      (countries.length ? audienceBars(countries, 'country', 'users', 12) : empty(ga ? 'Not enough data yet' : 'Audience analytics unavailable', ga ? 'No country has reportable creator-attributed activity yet.' : 'Connect GA4 to report aggregated audience locations.')) + '</div>' +
      '<div class="ca-card"><h3>Languages<span class="ca-fresh">aggregated</span></h3>' + (languages.length ? audienceBars(languages, 'language', 'users', 10) : empty('Not enough data yet', 'Languages appear after GA4 processes creator-attributed visits.')) + '</div>' +
      '<div class="ca-card"><h3>Top cities<span class="ca-fresh">privacy threshold ≥ ' + fmt((ga && ga.privacyThreshold) || 10) + '</span></h3>' +
      (cities.length ? audienceBars(cities, 'city', 'users', 12) : empty('Not enough data yet', 'Cities remain hidden until the server privacy threshold is met.')) + '</div></div>';
    var retention = '<div class="ca-grid ca-g11"><div class="ca-card"><h3>Audience retention<span class="ca-fresh">video playback</span></h3>' +
      empty('Retention curve not tracked yet', 'This panel will remain empty until verified video progress events are connected. No retention values are estimated.') + '</div>' +
      '<div class="ca-card"><h3>Returning audience<span class="ca-fresh">cohorts</span></h3>' + empty('Cohort data not connected yet', 'Returning-viewer cohorts require a privacy-safe creator-scoped GA4 report.') + '</div></div>';
    var tech = '<div class="ca-grid ca-report-grid"><div class="ca-card"><h3>Device category<span class="ca-fresh">28 days</span></h3>' +
      (devices.length ? audienceBars(devices, 'device', 'users', 8) : empty('Not enough data yet', 'Device data appears after GA4 processing.')) + '</div>' +
      '<div class="ca-card"><h3>Browser<span class="ca-fresh">28 days</span></h3>' + (browsers.length ? audienceBars(browsers, 'browser', 'users', 10) : empty('Not enough data yet', 'Browser data appears after GA4 processing.')) + '</div>' +
      '<div class="ca-card"><h3>Operating system<span class="ca-fresh">28 days</span></h3>' + (operatingSystems.length ? audienceBars(operatingSystems, 'operatingSystem', 'users', 10) : empty('Not enough data yet', 'Operating-system data appears after GA4 processing.')) + '</div></div>';
    var dashboard =
      pulseSection('realtime', 'Realtime', 'Active creator-page viewers · updates every 20 seconds', audience) +
      pulseSection('overview', 'Overview', 'Last 28 days · your creator-owned content only', health + kpis + kindsCard) +
      pulseSection('acquisition', 'Acquisition', 'Traffic sources and creator-owned destinations', contentRow) +
      pulseSection('engagement', 'Engagement', 'Content, groups, and publications', groupsCard + (lettersCard || '')) +
      pulseSection('monetization', 'Monetization', 'Verified revenue, estimates, and payout safeguards', adsenseCard + shadowCard + revCard) +
      pulseSection('retention', 'Retention', 'Verified audience retention only · no fabricated curves', retention) +
      pulseSection('demographics', 'Demographics', 'Aggregated GA4 location · never individual visitors', demographics) +
      pulseSection('tech', 'Tech', 'Creator-attributed device and platform mix', tech);
    root.innerHTML = pulseShell(rt, dashboard);

    root.querySelectorAll('tr[data-content]').forEach(function (tr) { tr.addEventListener('click', function () { renderContent(rows[Number(tr.getAttribute('data-content'))]); }); });
    root.querySelectorAll('tr[data-group]').forEach(function (tr) { tr.addEventListener('click', function () { renderGroup(S.groups[Number(tr.getAttribute('data-group'))]); }); });
    root.querySelectorAll('[data-ca-nav]').forEach(function (link) { link.addEventListener('click', function () { root.querySelectorAll('[data-ca-nav]').forEach(function (x) { x.classList.toggle('on', x === link); }); }); });
    var shareButton = document.getElementById('ca-share');
    if (shareButton) shareButton.addEventListener('click', function () {
      var data = { title: document.title, text: 'My Stock Market Loop creator analytics', url: location.href };
      if (navigator.share) navigator.share(data).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { shareButton.textContent = 'Link copied ✓'; });
    });
    var compareButton = document.getElementById('ca-compare');
    if (compareButton) compareButton.addEventListener('click', function () { root.classList.toggle('ca-compare-mode'); compareButton.textContent = root.classList.contains('ca-compare-mode') ? 'Comparing ✓' : 'Compare'; document.getElementById('ca-overview').scrollIntoView({ behavior: 'smooth' }); });
    var rangeButton = document.getElementById('ca-range');
    if (rangeButton) rangeButton.addEventListener('click', function () { rangeButton.textContent = 'Last 28 days ✓'; rangeButton.title = 'The verified creator report currently supports a fixed 28-day range.'; });
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) { entries.forEach(function (entry) { if (!entry.isIntersecting) return; root.querySelectorAll('[data-ca-nav]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-ca-nav') === entry.target.id.replace('ca-', '')); }); }); }, { rootMargin: '-20% 0px -65% 0px' });
      root.querySelectorAll('.ca-section').forEach(function (section) { observer.observe(section); });
    }
    window.scrollTo(0, 0);
  }
  function kpi(label, big, deltaHtml, sparkHtml, fresh) {
    return '<div class="ca-card"><h3>' + esc(label) + '<span class="ca-fresh">' + esc(fresh) + '</span></h3><div class="ca-big">' + big + '</div>' + deltaHtml + '<div class="ca-spark">' + sparkHtml + '</div></div>';
  }
  function backBar(title, sub, tag) {
    return '<div class="ca-detail-head"><button class="ca-pill" id="ca-back">← Overview</button><div style="min-width:0"><div class="ca-dtitle">' + esc(title) + '</div><div class="ca-sub">' + esc(sub) + '</div></div>' + (tag ? '<span class="ca-tag ' + tag + '">' + tag + '</span>' : '') + '<div class="ca-sp"></div><span class="ca-pill">Last 28 days</span></div>';
  }

  /* ---------- CONTENT DRILL-DOWN ---------- */
  function renderContent(c) {
    S.view = 'content';
    var rt = S.rt || {}, series = rt.series || [], vid = rt.video_analytics || {}, isVideo = /video/i.test(c.type || '');
    var kind = isVideo ? 'video' : (/letter/i.test(c.type) ? 'letter' : 'post');
    var path = (c.url || '').replace(/^https?:\/\/[^/]+/, '');
    if (c.analyticsSource === 'ga4') {
      kind = c.type || kind;
      var ownSeries = itemSeries(c);
      var contentId = c.contentId || '';
      var active = 0;
      (((S.presence || {}).items) || []).forEach(function (p) { if (p.kind === kind && String(p.contentId) === String(contentId)) active += n(p.viewers); });
      var trackedHtml = '<div class="ca-wrap">' + header(rt) + '<main class="ca-main">' + backBar(c.title || 'Untitled', path, kind) +
        '<div class="ca-grid ca-g4">' +
          '<div class="ca-card"><h3>Tracked views</h3><div class="ca-big">' + fmt(c.views) + '</div><div class="ca-sub">creator-attributed page views in the last 28 days</div></div>' +
          '<div class="ca-card"><h3>Visitors</h3><div class="ca-big">' + fmt(c.users) + '</div><div class="ca-sub">aggregated GA4 users; no individual visitors are exposed</div></div>' +
          '<div class="ca-card"><h3>Sessions</h3><div class="ca-big">' + fmt(c.sessions) + '</div><div class="ca-sub">sessions containing an attributed view of this item</div></div>' +
          '<div class="ca-card"><h3>Active right now</h3><div class="ca-big ' + (active > 0 ? 'acc' : '') + '">' + fmt(active) + '</div><div class="ca-sub">first-party presence in the last ' + fmt((S.presence || {}).window || 90) + ' seconds</div></div>' +
        '</div>' +
        '<div class="ca-card"><h3>Daily item activity<span class="ca-fresh">tracked views · visitors · sessions</span></h3>' +
          (ownSeries.length ? '<div class="ca-chart">' + lineChart(ownSeries, ['views', 'users', 'sessions'], [CSS_ACC, CSS_C2, CSS_C3], dlabel) + '</div><div class="ca-legend"><span><i style="background:' + CSS_ACC + '"></i>views</span><span><i style="background:' + CSS_C2 + '"></i>visitors</span><span><i style="background:' + CSS_C3 + '"></i>sessions</span></div>' : empty('No daily activity yet', 'GA4 has not processed a creator-attributed view for this item in the selected window.')) +
        '</div>' +
        '<div class="ca-note">Tracking starts from the creator-attribution launch; older visits are intentionally not estimated or backfilled.</div>' +
        (c.url ? '<div><a class="ca-btn2" href="' + esc(c.url) + '">Open ' + esc(kind) + ' ↗</a></div>' : '') +
        '</main></div>';
      root.innerHTML = trackedHtml;
      q('#ca-back').addEventListener('click', renderMain);
      window.scrollTo(0, 0);
      return;
    }
    var html = '<div class="ca-wrap">' + header(rt) + '<main class="ca-main">' + backBar(c.title || 'Untitled', path, kind) +
      '<div class="ca-grid ca-g4">' +
        '<div class="ca-card"><h3>Views</h3><div class="ca-big">' + fmt(c.views) + '</div><div class="ca-sub">' + esc(c.status || '') + (c.ticker ? ' · $' + esc(c.ticker) : '') + '</div></div>' +
        '<div class="ca-card"><h3>Impressions · CTR</h3><div class="ca-big">' + fmt(c.impressions) + '</div><div class="ca-sub">' + pct(c.ctr) + ' click-through · ' + fmt(c.clicks) + ' clicks</div></div>' +
        '<div class="ca-card"><h3>Engagement</h3><div class="ca-big">' + fmt(n(c.likes) + n(c.comments)) + '</div><div class="ca-sub">' + fmt(c.likes) + ' likes · ' + fmt(c.comments) + ' comments</div></div>' +
        '<div class="ca-card gold"><h3 class="gold">Estimated earnings</h3><div class="ca-big gold">' + money(c.revenue) + '</div><div class="ca-sub">' + (vid.enabled ? 'creator share ' + esc(vid.creator_share_percent) + '%' : 'per the ad-revenue system for this item') + '</div></div>' +
      '</div>' +
      '<div class="ca-card"><h3>Daily views — all your content<span class="ca-fresh">per-item daily series arrives with item-level analytics</span></h3><div class="ca-chart">' + lineChart(series, ['views', 'impressions'], [CSS_ACC, CSS_C2], dlabel) + '</div><div class="ca-legend"><span><i style="background:' + CSS_ACC + '"></i>views</span><span><i style="background:' + CSS_C2 + '"></i>impressions</span></div></div>';
    if (isVideo) {
      html += '<div class="ca-grid ca-g4">' +
        '<div class="ca-card"><h3>Watch time</h3>' + empty('Not tracked yet', vid.message || 'Watch time arrives when video playback analytics is enabled.') + '</div>' +
        '<div class="ca-card"><h3>Avg view duration</h3>' + empty('Not tracked yet', 'Arrives with playback analytics.') + '</div>' +
        '<div class="ca-card"><h3>Impressions · CTR</h3><div class="ca-big">' + fmt(c.impressions) + '</div><div class="ca-sub">' + pct(c.ctr) + ' click-through from feeds</div></div>' +
        '<div class="ca-card gold"><h3 class="gold">Your estimated earnings</h3><div class="ca-big gold">' + money(c.revenue) + '</div><div class="ca-sub">' + (vid.enabled ? 'RPM ' + money(vid.totals && vid.totals.rpm) + ' · your ' + esc(vid.creator_share_percent) + '% share' : esc(vid.message || 'Video ad analytics not enabled yet')) + '</div></div></div>' +
        '<div class="ca-grid ca-g11"><div class="ca-card"><h3>Audience retention<span class="ca-fresh">% still watching</span></h3>' + empty('Not tracked yet', 'Retention curves need playback events from the video player — not enabled yet.') + '</div>' +
        '<div class="ca-card"><h3>Daily earnings<span class="ca-fresh">paid monthly · net to you</span></h3><div class="ca-chart">' + lineChart(series, ['revenue'], [CSS_C4], dlabel) + '</div><div class="ca-legend"><span><i style="background:' + CSS_C4 + '"></i>creator revenue (all content, USD)</span></div></div></div>';
    }
    html += '<div class="ca-grid ca-g21"><div class="ca-card"><h3>Audience map — this content</h3>' + empty('Not connected yet', 'Country and city aggregates for this item arrive with audience analytics.') + '</div>' +
      '<div class="ca-col"><div class="ca-card"><h3>Where visitors came from</h3>' + empty('Not enough data yet', 'Sources appear above the privacy threshold.') + '</div><div class="ca-card"><h3>Top cities<span class="ca-fresh">threshold ≥ 10</span></h3>' + empty('Not connected yet', 'Arrives with audience analytics.') + '</div></div></div>' +
      (c.url ? '<div><a class="ca-btn2" href="' + esc(c.url) + '">Open ' + (isVideo ? 'video' : 'item') + ' ↗</a></div>' : '') +
      '</main></div>';
    root.innerHTML = html;
    q('#ca-back').addEventListener('click', renderMain);
    window.scrollTo(0, 0);
  }

  /* ---------- GROUP DRILL-DOWN ---------- */
  function renderGroup(x) {
    S.view = 'group';
    var rt = S.rt || {}, gad = rt.group_ad_analytics || {}, g = x.g, perf = x.perf;
    var ge = null; (gad.groups || []).forEach(function (r) { if (String(r.group_id || r.id) === String(x.id)) ge = r; });
    var share = gad.creator_share_percent != null ? gad.creator_share_percent : null;
    var html = '<div class="ca-wrap">' + header(rt) + '<main class="ca-main">' + backBar(g.name, '/groups/' + g.slug + '/ · you are ' + x.role + (g.is_paid ? ' · paid group (' + fmt(g.monthly_price_loopbucks) + ' LB/mo)' : ''), 'group') +
      '<div class="ca-grid ca-g4">' +
        '<div class="ca-card"><h3>Members</h3><div class="ca-big">' + fmt(g.member_count || x.members.length) + '</div><div class="ca-sub">' + esc(x.role === 'owner' ? 'you own this group' : (x.role === 'admin' ? 'you help run this group' : 'you are a member')) + '</div></div>' +
        '<div class="ca-card"><h3>Posts (28d)</h3><div class="ca-big">' + fmt(x.posts28) + '</div><div class="ca-sub">' + fmt(x.postsAll) + ' recent posts loaded</div></div>' +
        '<div class="ca-card"><h3>Page ad revenue (28d)</h3><div class="ca-big">' + (ge ? money(ge.verified_gross_usd || ge.gross_usd) : money(0)) + '</div><div class="ca-sub">' + esc(ge ? 'verified on this group’s pages' : (gad.message || 'no verified group ad revenue yet')) + '</div></div>' +
        '<div class="ca-card gold"><h3 class="gold">Your estimated share</h3><div class="ca-big gold">' + (ge ? money(ge.verified_creator_usd || ge.creator_usd) : money(0)) + '</div><div class="ca-sub">' + (share != null ? 'engine rate today: ' + esc(share) + '% creator share' : 'per the ad-revenue system') + (x.role === 'member' ? ' · shares go to owners & admins' : '') + '</div></div>' +
      '</div>';
    if (perf) {
      html += '<div class="ca-card"><h3>Alert performance<span class="ca-fresh">' + (perf.updated_at ? 'updated ' + esc(ago(perf.updated_at)) : '') + '</span></h3><div class="ca-kinds">' +
        '<div class="ca-kind"><b>Win rate</b><div class="n">' + (perf.win_rate == null ? '—' : pct(perf.win_rate)) + '</div><div class="ca-sub">' + fmt(perf.wins) + ' wins · ' + fmt(perf.losses) + ' losses</div></div>' +
        '<div class="ca-kind"><b>Open alerts</b><div class="n">' + fmt(perf.open_alerts) + '</div><div class="ca-sub">' + fmt(perf.sample_size) + ' scored</div></div>' +
        '<div class="ca-kind"><b>Avg final return</b><div class="n">' + (perf.average_final_return_pct == null ? '—' : pct(perf.average_final_return_pct)) + '</div><div class="ca-sub">closed alerts</div></div>' +
        '<div class="ca-kind"><b>Best peak gain</b><div class="n">' + (perf.best_peak_gain_pct == null ? '—' : pct(perf.best_peak_gain_pct)) + '</div><div class="ca-sub">' + esc(perf.recent_loss == null ? '' : 'recent loss ' + pct(perf.recent_loss)) + '</div></div>' +
        '</div>' + (perf.methodology ? '<div class="ca-note">' + esc(perf.methodology) + '</div>' : '') + '</div>';
    }
    html += '<div class="ca-grid ca-g11"><div class="ca-card"><h3>Daily earnings — your share<span class="ca-fresh">paid monthly · net to you</span></h3>' + empty('No verified group ad revenue yet', gad.message || 'Daily earnings chart appears once this group’s pages generate verified ad revenue.') + '</div>' +
      '<div class="ca-card"><h3>Member growth</h3>' + empty('Not tracked yet', 'Member growth over time needs join-date history — the group roster reports current members only (' + fmt(g.member_count || x.members.length) + ').') + '</div></div>' +
      '<div class="ca-card"><h3>Community pool<span class="ca-fresh">planned: half of the group’s allocation</span></h3><div class="ca-sub">The community pool splits evenly between members who meet all four requirements at month end. <b style="color:var(--ca-text)">Eligibility tracking isn’t set up yet — these are the rules it will use.</b></div>' +
      '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">' +
        '<div class="ca-kind"><b>90+ days a member</b><div class="ca-sub">of this group before qualifying</div></div>' +
        '<div class="ca-kind"><b>No strikes, last 30 days</b><div class="ca-sub">community strikes reset every 30 days</div></div>' +
        '<div class="ca-kind"><b>Daily active that month</b><div class="ca-sub">on the site 15+ days, 2+ hours a day</div></div>' +
        '<div class="ca-kind"><b>10,000+ Loop Bucks earned</b><div class="ca-sub">all-time (or buy for $100)</div></div>' +
      '</div></div>' +
      '<div class="ca-card"><h3>Members<span class="ca-fresh">' + fmt(x.members.length) + ' loaded</span></h3>' + (x.members.length ? '<table><tbody>' + x.members.slice(0, 12).map(function (m) { return '<tr><td><span class="ca-title">' + esc(m.name || '') + '</span></td><td><span class="ca-role ' + esc(m.role || '') + '">' + esc(m.role || 'member') + '</span></td></tr>'; }).join('') + '</tbody></table>' : empty('No roster', 'The roster is empty or private.')) + '</div>' +
      '<div><a class="ca-btn2" href="' + esc(g.url || ('/groups/' + g.slug + '/')) + '">Open group ↗</a></div></main></div>';
    root.innerHTML = html;
    q('#ca-back').addEventListener('click', renderMain);
    window.scrollTo(0, 0);
  }
})();
