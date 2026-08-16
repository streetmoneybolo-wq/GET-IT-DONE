/* SML Loop Channel — P1 shell (admin preview ?ch=1)
   Mounts on /channel/{handle}/ pages. Separate page/root from the Immersive
   Profile (which stays at /{handle}/) — see the routing decision in project
   memory. Reuses css/loop-channel.css. P1 scope: nav + sidebar identity card
   (real avatar/name/handle via the same sources live-watch.js uses) + links
   module + home-group card (honestly gated, no fabricated data). Hero,
   content orbital, community, newsletter and the Channel Studio drawer land
   in later phases. */
(function () {
  'use strict';
  var root = document.getElementById('sml-ch-root');
  if (!root || root.__booted) return;
  root.__booted = true;
  var ADMIN = (typeof window.SML_CH_ADMIN !== 'undefined') ? !!window.SML_CH_ADMIN : true;
  var NONCE = window.SML_CH_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var ME = window.SML_CH_ME || null;
  var HANDLE = (location.pathname.match(/\/channel\/([A-Za-z0-9_.]+)\/?/) || [])[1] || '';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(sel) { return root.querySelector(sel); }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'same-origin'; opts.headers = opts.headers || {};
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    return fetch('/wp-json' + path, opts).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function cdnBase() { var sc = document.querySelector('script[src*="loop-channel.js"]'); return sc ? sc.src.replace(/js\/loop-channel\.js.*$/, '') : ''; }
  var logo = cdnBase() ? '<img src="' + cdnBase() + 'img/loop-logo.png" alt="Stock Market Loop">' : '<span style="font:800 13px/1 Archivo,sans-serif;color:#00ff88">STOCK MARKET LOOP</span>';
  var fmt = function (n) { n = +n || 0; return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); };

  root.style.setProperty('--accent', '#00ff88');
  root.style.setProperty('--chfont', 'Archivo,system-ui,sans-serif');
  document.body.classList.add('lch-on');

  root.innerHTML =
    '<div class="lch-nav"><div class="lch-nav-l">' +
      '<a class="lch-logo" href="/" title="StockMarketLoop — home">' + logo + '<span class="lch-logo-div"></span><span class="lch-logo-live"><span class="dot"></span><span>STUDIO</span></span></a>' +
      '<div class="lch-nav-links"><a href="/stock-chart/?symbol=SPY">Terminal</a><a href="/watch/">Watch</a><a class="on" href="#">Channel</a><a href="/groups/">Rooms</a></div>' +
    '</div><div class="lch-nav-r">' +
      '<span class="lch-sync" id="ch-sync">● CHANNEL FEED SYNCED</span>' +
      '<span class="lch-vanity" id="ch-vanity" style="display:none">loop.tv/@' + esc(HANDLE) + '</span>' +
      '<button class="lch-editbtn" id="ch-edit" style="display:none">✎ EDIT CHANNEL</button>' +
      '<button class="lch-golive" id="ch-golive" style="display:none">● GO LIVE</button>' +
    '</div></div>' +

    '<div class="lch-body">' +
      '<div class="lch-side">' +
        '<div class="lch-idcard"><div class="lch-idcard-bg" id="ch-bg"></div><div class="lch-idcard-fade"></div>' +
          '<div class="lch-idcard-tl"></div><div class="lch-idcard-tr"></div>' +
          '<div class="lch-idcard-in">' +
            '<div class="lch-avwrap"><div class="lch-avring"></div><div class="lch-av" id="ch-av">' + esc((HANDLE || 'SL').slice(0, 2).toUpperCase()) + '</div>' +
              '<span class="lch-avlive" id="ch-live" style="display:none">LIVE</span></div>' +
            '<div class="lch-idname"><span class="nm" id="ch-name">' + esc(HANDLE || '—') + '</span><span class="hd" id="ch-handle">@' + esc(HANDLE) + '</span></div>' +
            '<div class="lch-idbtns"><button class="lch-sub" id="ch-sub">Subscribe</button><button class="lch-bell" id="ch-bell" title="Notify me">🔔</button></div>' +
            '<div class="lch-stats">' +
              '<div class="lch-stat"><b id="ch-followers" style="color:var(--accent)">—</b><span>FOLLOWERS</span></div>' +
              '<div class="lch-stat"><b id="ch-videos">—</b><span>VIDEOS</span></div>' +
              '<div class="lch-stat"><b id="ch-views" style="color:#00ccff">—</b><span>LOOP VIEWS</span></div>' +
            '</div>' +
          '</div></div>' +

        '<div class="lch-links" id="ch-links" style="display:none"><span class="lch-links-h">▮ LINKS</span>' +
          '<div class="lch-socials" id="ch-socials"></div>' +
          '<div id="ch-banners"></div></div>' +

        '<div id="ch-hg"></div>' +
      '</div>' +

      '<div class="lch-content">' +
        '<div id="ch-hero"></div>' +
        '<div class="lch-soon" id="ch-latest-soon">Latest content orbital and community land in the next build phase.</div>' +
      '</div>' +
    '</div>' +
    (ADMIN ? '<div class="lch-adminbar"><b>LOOP CHANNEL</b><span>P1 preview</span><a href="?ch=0">exit</a></div>' : '');

  /* ---------- identity: same sources the watch pages already use ---------- */
  function loadIdentity() {
    if (!HANDLE) return;
    api('/sml-live/v1/feeds/' + HANDLE).then(function (res) {
      var c = res.j && res.j.creator;
      var live = !!(res.j && res.j.live);
      el('#ch-live').style.display = live ? '' : 'none';
      el('#ch-golive').style.display = 'none'; /* owner-only, decided in a later phase once we can detect ownership */
      if (c && c.name) { el('#ch-name').textContent = c.name; }
    }).catch(function () {});
    api('/sml-lb/v1/card/' + HANDLE).then(function (res) {
      var j = res.j || {};
      var url = (j.profile && j.profile.photo) || j.photo || j.avatar || (j.profile && j.profile.avatar) || '';
      if (url && /^https:/.test(url)) {
        el('#ch-av').style.backgroundImage = 'url(' + url + ')';
        el('#ch-av').textContent = '';
      }
    }).catch(function () {});
    /* follow relationship + count: sml-members/v1/follow — shape unverified without
       a live session, so this is best-effort and stays honestly blank on failure
       rather than guessing a number. Revisit once admin browser access confirms it. */
    api('/sml-members/v1/follow?handle=' + encodeURIComponent(HANDLE)).then(function (res) {
      var j = res.j || {};
      var count = j.followers != null ? j.followers : (j.count != null ? j.count : null);
      if (count != null) el('#ch-followers').textContent = fmt(count);
      var following = !!(j.following || j.is_following || j.followed);
      paintSub(following);
    }).catch(function () {});
  }
  function paintSub(on) {
    var b = el('#ch-sub');
    b.classList.toggle('on', on);
    b.textContent = on ? 'Subscribed' : 'Subscribe';
  }
  el('#ch-sub').onclick = function () {
    if (!ME) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
    var on = el('#ch-sub').classList.contains('on');
    api('/sml-members/v1/follow', { method: 'POST', body: JSON.stringify({ handle: HANDLE, follow: !on }) })
      .then(function (res) { if (res.ok) paintSub(!on); });
  };

  /* home-group + links: honestly gated until the settings source is confirmed in P5 */
  function loadHomeGroup() {
    var hg = window.SML_CH_HOME_GROUP;
    if (!hg || !hg.url) return;
    el('#ch-hg').innerHTML = '<a class="lch-hg" href="' + esc(hg.url) + '"><div class="lch-hg-box"><div class="lch-hg-bg"' + (hg.banner ? ' style="background-image:url(' + esc(hg.banner) + ')"' : '') + '></div><div class="lch-hg-fade"></div>' +
      '<div class="lch-hg-row"><b>' + esc(hg.name || '') + '</b><span>' + (hg.members ? fmt(hg.members) : '') + '</span></div></div>' +
      '<div class="lch-hg-ft"><span class="tag">' + esc((HANDLE || 'CREATOR').toUpperCase()) + '\'S HOME GROUP</span><span class="open">Open →</span></div></a>';
  }
  function loadLinks() {
    var links = window.SML_CH_LINKS;
    if (!links) return;
    var socials = (links.socials || []).map(function (s) {
      return '<a class="lch-social" href="' + esc(s.url) + '" title="' + esc(s.label || '') + '" target="_blank" rel="noopener">' + (s.icon || '') + '</a>';
    }).join('');
    if (socials) el('#ch-socials').innerHTML = socials;
    var banners = (links.banners || []).slice(0, 2).map(function (b) {
      return '<a class="lch-banner" href="' + esc(b.url) + '" title="' + esc(b.label || '') + '" target="_blank" rel="noopener sponsored"><div class="lch-banner-box"><div class="lch-banner-bg"' + (b.image ? ' style="background-image:url(' + esc(b.image) + ')"' : '') + '></div><div class="lch-banner-fade"></div><span class="lch-banner-ad">AD</span><span class="lch-banner-lb">' + esc(b.label || b.url) + ' ↗</span></div></a>';
    }).join('');
    if (banners) el('#ch-banners').innerHTML = banners;
    if (socials || banners) el('#ch-links').style.display = '';
  }

  /* ---------- hero: live case only for now — real feeds + presence data exist.
     "Latest video" fallback and the content orbital need a creator-scoped video
     list endpoint that doesn't exist yet in the public API surface (checked:
     the rail endpoint ignores handle/creator params and returns one global
     feed; no wp/v2 video post type is registered). Left as the placeholder
     below until that's found or built. */
  function loadHero() {
    if (!HANDLE) return;
    api('/sml-live/v1/feeds/' + HANDLE).then(function (res) {
      if (!res.j || !res.j.live) return;
      api('/sml-lw/v1/presence?handle=' + HANDLE).then(function (pres) {
        var n = (pres.j && pres.j.count) || 0;
        el('#ch-hero').innerHTML = '<a class="lch-hero live" href="/live/"><div class="lch-hero-box"><div class="lch-hero-bg"></div>' +
          '<div class="lch-hero-badge"><span class="dot"></span><span>LIVE</span></div>' +
          '<span class="lch-hero-meta">' + n + ' watching</span>' +
          '<div class="lch-hero-foot"><span class="lch-hero-title">' + esc(el('#ch-name').textContent || HANDLE) + ' is live on Stock Market Loop</span>' +
          '<span class="lch-hero-cta">JOIN STREAM →</span></div></div></a>';
      }).catch(function () {});
    }).catch(function () {});
  }

  loadIdentity(); loadHomeGroup(); loadLinks(); loadHero();
})();
