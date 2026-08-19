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

  /* ---------- state ---------- */
  var S = { rt: null, gate: null, lb: null, live: null, ga4: null, letters: null, subs: null, lsettings: null, uploads: null, groups: [], view: 'main' };

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

  /* ---------- boot: load everything, then decide sections by ownership ---------- */
  Promise.all([
    api('/sml-members/v1/creator-studio/realtime'),
    api('/sml-creator-gate/v1/status'),
    api('/sml-lb/v1/me'),
    api('/sml-live/v1/status'),
    api('/sml-creator-analytics/v1/audience?range=28')
  ]).then(function (r) {
    if (r[0].status === 401 || r[1].status === 401) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
    S.rt = r[0].ok ? r[0].j : null; S.gate = r[1].ok ? r[1].j : {}; S.lb = r[2].ok ? r[2].j : null; S.live = r[3].ok ? r[3].j : null; S.ga4 = r[4].ok ? r[4].j : null;
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
    });
  });
  function refreshRealtime() { api('/sml-members/v1/creator-studio/realtime').then(function (r) { if (r.ok && r.j && S.view === 'main') { S.rt = r.j; renderMain(); } }); }

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

    // KPI row (real: views / impressions / engagement over 28 days, from the realtime series)
    var kpis = '<div class="ca-grid ca-g3">' +
      kpi('Views (28 days)', fmt(ov.views), delta(series, 'views', ov.views), spark(series.map(function (s) { return n(s.views); }), CSS_ACC), 'refreshes 60 s') +
      kpi('Impressions (28 days)', fmt(ov.impressions), delta(series, 'impressions', ov.impressions), spark(series.map(function (s) { return n(s.impressions); }), CSS_C2), 'CTR ' + pct(ov.ctr)) +
      kpi('Engagement (28 days)', fmt(ov.engagement), delta(series, 'engagement', ov.engagement), spark(series.map(function (s) { return n(s.engagement); }), CSS_C4), 'likes · comments · saves') +
      '</div>';

    // Audience row: aggregate GA4 only. City rows below the server's privacy
    // threshold are omitted by the server and are never inferred here.
    var ga = S.ga4 && S.ga4.configured && S.ga4.available !== false ? S.ga4 : null;
    var countries = ga && Array.isArray(ga.countries) ? ga.countries : [];
    var cities = ga && Array.isArray(ga.cities) ? ga.cities : [];
    var liveAudience = ga && ga.live && ga.live.available ? n(ga.live.count) : null;
	var liveNeedsPresence = !!(ga && ga.live && ga.live.reason === 'creator_realtime_requires_first_party_presence');
    function audienceBars(items, nameKey, valueKey, cap) {
      items = (items || []).slice(0, cap || 8); var max = 1;
      items.forEach(function (x) { max = Math.max(max, n(x[valueKey])); });
      return '<div class="ca-audience-bars">' + items.map(function (x) {
        var label = x[nameKey] || 'Unknown'; if (nameKey === 'city' && x.country) label += ', ' + x.country;
        return '<div class="ca-audience-row"><span>' + esc(label) + '</span><i><b style="width:' + Math.max(2, Math.round(n(x[valueKey]) / max * 100)) + '%"></b></i><strong>' + fmt(x[valueKey]) + '</strong></div>';
      }).join('') + '</div>';
    }
    var liveCard = '<div class="ca-card"><h3>Live right now<span class="ca-fresh">' + (isLive ? 'streaming' : 'not streaming') + '</span></h3>' +
      '<div style="display:flex;align-items:baseline;gap:10px"><div class="ca-big ' + (isLive ? 'acc' : '') + '">' + (liveAudience != null ? fmt(liveAudience) : (isLive ? 'LIVE' : '—')) + '</div><div class="ca-live' + (isLive ? '' : ' off') + '"><span class="b"></span>' + (isLive ? 'ON AIR' : 'OFFLINE') + '</div></div>' +
      '<div class="ca-sub" style="margin-top:6px">' + (isLive ? 'Started ' + esc(ago(S.live.live_started_at)) + (liveAudience != null ? ' · Active visitors in the last 30 minutes.' : (liveNeedsPresence ? ' · Creator-specific realtime presence is not connected yet.' : '. Audience totals are still collecting.')) : 'Go live from Creator Studio.' + (liveNeedsPresence ? ' Creator-specific realtime presence is not connected yet.' : '')) + '</div>' +
      (isLive ? '' : '<div style="margin-top:10px"><a class="ca-btn2" href="/go-live/">Go Live →</a></div>') + '</div>';
    var audience = '<div class="ca-grid ca-g21">' +
      '<div class="ca-card"><h3>Where your audience is<span class="ca-fresh">country + city aggregates</span></h3>' + (cities.length ? audienceBars(cities, 'city', 'users', 12) : (countries.length ? audienceBars(countries, 'country', 'users', 12) : empty(ga ? 'Not enough data yet' : 'Audience analytics not connected yet', ga ? 'GA4 is connected, but no city has reached the privacy threshold yet.' : 'Audience analytics needs GA4 collection. No visitor is ever shown individually.'))) + '</div>' +
      '<div class="ca-col">' + liveCard + '<div class="ca-card"><h3>Top countries</h3>' + (countries.length ? audienceBars(countries, 'country', 'users', 7) : empty(ga ? 'Not enough data yet' : 'Not connected yet', ga ? 'Countries appear after GA4 has reportable audience activity.' : 'Appears with audience analytics.')) + '</div></div></div>';

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
    var rows = content.slice().sort(function (a, b) { return n(b.views) - n(a.views); });
    var thumbs = {}; (S.uploads || []).forEach(function (u) { if (u.watch_url) thumbs[u.watch_url] = u.thumbnail; });
    var contentTable = rows.length ? '<table><thead><tr><th>Content</th><th>Kind</th><th class="num">Views</th><th class="num">Impr.</th><th class="num">CTR</th></tr></thead><tbody>' +
      rows.slice(0, 12).map(function (c, i) {
        var kind = /video/i.test(c.type) ? 'video' : (/letter/i.test(c.type) ? 'letter' : (/post/i.test(c.type) ? 'post' : 'publication'));
        var th = thumbs[c.url] ? '<img class="ca-thumb" src="' + esc(thumbs[c.url]) + '" alt="">' : '';
        return '<tr class="click" data-content="' + i + '"><td>' + th + '<span class="ca-title">' + esc(c.title || 'Untitled') + '</span><div class="ca-sub">' + esc((c.url || '').replace(/^https?:\/\/[^/]+/, '')) + (c.ticker ? ' · $' + esc(c.ticker) : '') + '</div></td><td><span class="ca-tag ' + kind + '">' + kind + '</span></td><td class="num">' + fmt(c.views) + '</td><td class="num">' + fmt(c.impressions) + '</td><td class="num">' + pct(c.ctr) + '</td></tr>';
      }).join('') + '</tbody></table>' : empty('No content yet', 'Upload a video or publish a letter and it appears here with views, impressions and CTR.');
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
    var contentRow = '<div class="ca-grid ca-g32"><div class="ca-card"><h3>Top content<span class="ca-fresh">28 days</span></h3>' + contentTable + '</div>' +
      '<div class="ca-col"><div class="ca-card"><h3>Where visitors came from</h3>' + (sources.length ? '<table>' + sources.slice(0, 8).map(function (s) { return '<tr><td>' + esc(s.source || s.name || '') + '</td><td class="num">' + fmt(s.sessions || s.views || s.count) + '</td></tr>'; }).join('') + '</table>' : empty('Not enough data yet', 'Traffic sources appear once the site’s analytics has enough visits to report — nothing is shown below the privacy threshold.')) + '</div>' +
      '<div class="ca-card"><h3>New this week</h3>' + (newWeek ? '<div class="ca-big">' + newWeek + '</div><div class="ca-sub">new uploads and letters in the last 7 days</div>' : empty('Not enough data yet', 'Nothing published in the last 7 days. New content shows here once it’s reached the reporting threshold.')) + '</div></div></div>';

    // revenue + wallet (real engine values; honest labels)
    var revCard = '<div class="ca-grid ca-g4">' +
      '<div class="ca-card gold"><h3 class="gold">Creator revenue (28d)</h3><div class="ca-big gold">' + money(ov.creator_revenue_usd) + '</div><div class="ca-sub">RPM ' + money(ov.rpm) + ' · CPM ' + money(ov.cpm) + '</div></div>' +
      '<div class="ca-card"><h3>Video ad revenue</h3><div class="ca-big">' + money(ov.video_creator_revenue_usd) + '</div><div class="ca-sub">' + (vid.enabled ? 'creator share ' + esc(vid.creator_share_percent) + '%' : esc(vid.message || 'Video ad analytics not enabled yet')) + '</div></div>' +
      '<div class="ca-card"><h3>Group ad revenue</h3><div class="ca-big">' + money(ov.group_ad_creator_revenue_usd) + '</div><div class="ca-sub">' + (gad.creator_share_percent != null ? 'your share · ' + esc(gad.creator_share_percent) + '% of verified group ad revenue' : 'from groups you own or admin') + '</div></div>' +
      '<div class="ca-card"><h3>Loop Wallet<span class="ca-fresh">' + (wallet.stripe_connected ? 'Stripe connected' : 'Stripe not connected') + '</span></h3><div class="ca-big">' + fmt(wallet.available_balance) + ' <span class="ca-sub">LB available</span></div><div class="ca-sub">' + fmt(wallet.pending_balance) + ' pending · ' + fmt(wallet.lifetime_earnings) + ' lifetime</div>' + (wallet.transactions_url ? '<div style="margin-top:8px"><a class="ca-btn2" href="' + esc(wallet.transactions_url) + '">Manage wallet →</a></div>' : '') + '</div>' +
      '</div>';

    root.innerHTML = '<div class="ca-wrap">' + header(rt) + '<main class="ca-main">' + kpis + audience + kindsCard + groupsCard + contentRow + (lettersCard || '') + revCard +
      '<div class="ca-foot">Counts are aggregated — individual visits are never shown. Revenue figures come from StockMarketLoop’s ad-revenue system as reported for your account.</div></main></div>';

    root.querySelectorAll('tr[data-content]').forEach(function (tr) { tr.addEventListener('click', function () { renderContent(rows[Number(tr.getAttribute('data-content'))]); }); });
    root.querySelectorAll('tr[data-group]').forEach(function (tr) { tr.addEventListener('click', function () { renderGroup(S.groups[Number(tr.getAttribute('data-group'))]); }); });
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
