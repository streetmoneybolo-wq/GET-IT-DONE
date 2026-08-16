/* SML Loop Channel — creator profile/hub
   Mounts on /channel/{handle}/ pages. Separate page/root from the Immersive
   Profile (which stays at /{handle}/) — see the routing decision in project
   memory. Reuses css/loop-channel.css. Identity, live/latest hero, creator-
   scoped video orbit, community, newsletter and Channel Studio all render
   from confirmed public APIs or deliberately hide when real data is absent. */
(function () {
  'use strict';
  var root = document.getElementById('sml-ch-root');
  if (!root || root.__booted) return;
  root.__booted = true;
  var ADMIN = (typeof window.SML_CH_ADMIN !== 'undefined') ? !!window.SML_CH_ADMIN : false;
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
      '<button class="lch-editbtn" id="ch-edit" style="display:' + (ADMIN ? '' : 'none') + '">✎ EDIT CHANNEL</button>' +
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
        '<div id="ch-orbit"></div>' +
        '<div id="ch-community"></div>' +
        '<div id="ch-nl"></div>' +
      '</div>' +
    '</div>' +
    '<div id="ch-studio-mount"></div>' +
    (ADMIN ? '<div class="lch-adminbar"><b>LOOP CHANNEL</b><span>admin tools</span><a href="?ch=0">exit</a></div>' : '');

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

  /* ---------- creator content: one public, author-scoped adapter over the
     real video library + existing community stores. Nothing here falls back
     to the global rail because that would misattribute another creator's work. */
  function ago(value) {
    var t = Date.parse(value || ''); if (!t) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function safeImage(url) { return url && /^https:\/\//i.test(url) ? url : ''; }
  function videoHero(video) {
    if (!video) return;
    var bg = safeImage(video.thumbnail);
    el('#ch-hero').innerHTML = '<a class="lch-hero latest" href="' + esc(video.watch_url) + '"><div class="lch-hero-box"><div class="lch-hero-bg"' +
      (bg ? ' style="background-image:url(&quot;' + esc(bg) + '&quot;)"' : '') + '></div><div class="lch-hero-shade"></div>' +
      '<div class="lch-hero-badge latest"><span>NEW VIDEO</span></div><span class="lch-hero-meta">' + esc(video.views_label || '') + '</span>' +
      '<div class="lch-hero-foot"><span class="lch-hero-title">' + esc(video.title || 'Watch video') + '</span><span class="lch-hero-cta">WATCH →</span></div></div></a>';
  }
  function loadHero(feed, latest) {
    if (feed && feed.live) {
      return api('/sml-lw/v1/presence?handle=' + encodeURIComponent(HANDLE)).then(function (pres) {
        var n = (pres.j && pres.j.count) || 0;
        el('#ch-hero').innerHTML = '<a class="lch-hero live" href="/live/"><div class="lch-hero-box"><div class="lch-hero-bg"></div>' +
          '<div class="lch-hero-badge"><span class="dot"></span><span>LIVE</span></div><span class="lch-hero-meta">' + n + ' watching</span>' +
          '<div class="lch-hero-foot"><span class="lch-hero-title">' + esc(el('#ch-name').textContent || HANDLE) + ' is live on Stock Market Loop</span>' +
          '<span class="lch-hero-cta">JOIN STREAM →</span></div></div></a>';
      });
    }
    videoHero(latest);
    return Promise.resolve();
  }
  function renderOrbit(videos) {
    var mount = el('#ch-orbit');
    if (!videos.length) { mount.innerHTML = ''; return; }
    var active = 0;
    mount.innerHTML = '<section class="lch-orbit"><div class="lch-section-h"><span class="t">▮ LATEST CONTENT</span><span class="meta">' + videos.length + ' videos</span><div class="rule"></div></div>' +
      '<div class="lch-orbit-stage"><div class="lch-orbit-ring">' + videos.slice(0, 10).map(function (v, i) {
        var bg = safeImage(v.thumbnail);
        return '<a class="lch-orbit-card" data-orbit="' + i + '" href="' + esc(v.watch_url) + '" aria-label="' + esc(v.title) + '"><span class="pic"' +
          (bg ? ' style="background-image:url(&quot;' + esc(bg) + '&quot;)"' : '') + '></span><span class="shade"></span><span class="dur">' + esc(v.duration || '') + '</span>' +
          '<span class="copy"><b>' + esc(v.title || 'Untitled video') + '</b><small>' + esc(v.views_label || '') + (v.created_at ? ' · ' + esc(ago(v.created_at)) : '') + '</small></span></a>';
      }).join('') + '</div><button class="lch-orbit-arrow prev" type="button" aria-label="Previous video">‹</button><button class="lch-orbit-arrow next" type="button" aria-label="Next video">›</button></div>' +
      '<div class="lch-orbit-status"><b></b><span></span></div></section>';
    var cards = Array.prototype.slice.call(mount.querySelectorAll('.lch-orbit-card'));
    function paint() {
      var count = cards.length;
      cards.forEach(function (card, i) {
        var delta = i - active;
        if (delta > count / 2) delta -= count; if (delta < -count / 2) delta += count;
        var angle = delta * Math.min(42, 300 / count);
        card.style.setProperty('--orbit-angle', angle + 'deg');
        card.style.setProperty('--orbit-depth', (Math.abs(delta) * -58) + 'px');
        card.classList.toggle('on', delta === 0); card.tabIndex = delta === 0 ? 0 : -1;
      });
      var v = videos[active]; mount.querySelector('.lch-orbit-status b').textContent = v.title || 'Untitled video';
      mount.querySelector('.lch-orbit-status span').textContent = (v.views_label || '') + (v.created_at ? ' · ' + ago(v.created_at) : '');
    }
    function move(by) { active = (active + by + cards.length) % cards.length; paint(); }
    mount.querySelector('.prev').onclick = function () { move(-1); }; mount.querySelector('.next').onclick = function () { move(1); };
    cards.forEach(function (card, i) { card.onclick = function (e) { if (i !== active) { e.preventDefault(); active = i; paint(); } }; });
    mount.onkeydown = function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); move(1); } };
    paint();
  }
  function renderCommunity(posts) {
    var mount = el('#ch-community');
    if (!posts.length) { mount.innerHTML = ''; return; }
    mount.innerHTML = '<section class="lch-community"><div class="lch-section-h"><span class="t">▮ COMMUNITY</span><span class="meta">latest posts</span><div class="rule"></div></div><div class="lch-post-grid">' +
      posts.slice(0, 8).map(function (p) {
        var tags = (p.tickers || []).slice(0, 4).map(function (t) { return '<span>$' + esc(String(t).replace(/^\$/, '')) + '</span>'; }).join('');
        var likes = p.metrics && (p.metrics.likes != null ? p.metrics.likes : p.metrics.like_count);
        var image = safeImage(p.image);
        var body = p.body || ''; var inner = '<span class="kind">' + esc(String(p.kind || 'post').replace(/_/g, ' ')) + '</span><time>' + esc(ago(p.date)) + '</time>' +
          (image ? '<span class="image" style="background-image:url(&quot;' + esc(image) + '&quot;)"></span>' : '') +
          (p.title ? '<b class="title">' + esc(p.title) + '</b>' : '') + (body ? '<span class="body">' + esc(body) + '</span>' : '') +
          (tags ? '<span class="tickers">' + tags + '</span>' : '') + (likes != null ? '<span class="metrics">♥ ' + fmt(likes) + '</span>' : '');
        return p.url ? '<a class="lch-post" href="' + esc(p.url) + '">' + inner + '</a>' : '<article class="lch-post">' + inner + '</article>';
      }).join('') + '</div></section>';
  }
  function loadChannelContent() {
    if (!HANDLE) return;
    Promise.all([api('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE)), api('/sml-live/v1/feeds/' + encodeURIComponent(HANDLE))]).then(function (all) {
      var channel = all[0].ok ? (all[0].j || {}) : {}; var feed = all[1].ok ? (all[1].j || {}) : {};
      var videos = Array.isArray(channel.videos) ? channel.videos : []; var posts = Array.isArray(channel.posts) ? channel.posts : [];
      var stats = channel.stats || {}; if (stats.videos != null) el('#ch-videos').textContent = fmt(stats.videos); if (stats.views != null) el('#ch-views').textContent = fmt(stats.views);
      renderOrbit(videos); renderCommunity(posts); return loadHero(feed, videos[0]);
    }).catch(function () { el('#ch-sync').textContent = '● CHANNEL FEED UNAVAILABLE'; });
  }

  /* ---------- newsletter: sml-loopletters/v1/issues is genuinely creator-scoped
     and public (404s "no such publication" rather than 401 when a creator hasn't
     set one up — confirmed via curl, not a guess). Hides cleanly when there's
     nothing real to show instead of rendering a fake empty state. */
  function nlField(it, names, fallback) {
    for (var i = 0; i < names.length; i++) { if (it[names[i]] != null && it[names[i]] !== '') return it[names[i]]; }
    return fallback;
  }
  function loadNewsletter() {
    if (!HANDLE) return;
    api('/sml-loopletters/v1/issues?handle=' + encodeURIComponent(HANDLE)).then(function (res) {
      var issues = (res.j && (res.j.issues || res.j.items || res.j.letters)) || [];
      if (!issues.length) return;
      var base = res.j.base || res.j.home_url || res.j.url || '';
      issues = issues.slice(0, 7);
      var cards = issues.map(function (it) {
        var url = nlField(it, ['url', 'permalink', 'link'], base || '#');
        var cover = nlField(it, ['cover', 'image', 'thumbnail'], '');
        var title = nlField(it, ['title', 'subject', 'name'], 'Untitled issue');
        var date = nlField(it, ['date', 'published', 'sent_at', 'created'], '');
        var tag = nlField(it, ['topic', 'tag', 'category'], '');
        return '<a class="lch-nl-card" href="' + esc(url) + '" target="_blank" rel="noopener"><div class="lch-nl-cover"' + (cover && /^https:/.test(cover) ? ' style="background-image:url(' + esc(cover) + ')"' : '') + '></div>' +
          '<span class="tt">' + esc(title) + '</span><span class="dt">' + esc(date) + (tag ? ' · ' + esc(tag) : '') + '</span></a>';
      }).join('');
      el('#ch-nl').innerHTML = '<div class="lch-nl"><div class="lch-nl-h"><span class="t">▮ NEWSLETTER</span><span class="meta">' + issues.length + ' issues</span><div class="rule"></div>' +
        (base ? '<a class="lch-nl-more" href="' + esc(base) + '" target="_blank" rel="noopener">🚪 See more</a>' : '') +
        '<button class="lch-nl-sub" id="ch-nlsub">✉ Subscribe</button></div>' +
        '<div class="lch-nl-row">' + cards + '</div></div>';
      var subbed = false;
      el('#ch-nlsub').onclick = function () {
        if (!ME) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
        api('/sml-loopletters/v1/subscribe', { method: 'POST', body: JSON.stringify({ handle: HANDLE }) }).then(function (r) {
          if (r.ok) { subbed = true; var b = el('#ch-nlsub'); b.classList.add('on'); b.textContent = '✓ Subscribed'; }
        });
      };
    }).catch(function () {});
  }

  /* ---------- Channel Studio drawer ----------
     Real, confirmed-working right now: channel name (sml-display-name/v1/save)
     and handle availability checking (sml-members/v1/handle-availability).
     Theme + Links attempt sml-social-profile/v1/settings (GET+POST both exist,
     but the field shape is unverified — no live session to confirm against —
     so saves there are best-effort and surfaced honestly if they fail.
     Moderation has NO backend anywhere in the site's public route list: the
     tab is fully built and interactive but stays local-only with a visible
     "not saved yet" note rather than pretending to persist.
     NOTE: "EDIT CHANNEL" currently gates on admin-preview mode (ADMIN), not on
     real viewer-owns-this-channel detection — that needs SML_CH_ME to carry
     the viewer's own handle so it can be compared against HANDLE. */
  var ACCENTS = ['#00ff88', '#00ccff', '#ffd166', '#ff6b4a', '#673aff', '#ff2e66', '#7affc0', '#4c9eff'];
  var FONTS = ['Archivo', 'Space Grotesk', 'Rajdhani', 'Orbitron', 'Exo 2', 'Chakra Petch', 'Oxanium', 'Sora', 'Manrope', 'Outfit', 'Barlow', 'Saira', 'Kanit', 'Play', 'Syne', 'Unbounded', 'Michroma', 'Audiowide'];
  var ST = {
    tab: 'theme', accent: '#00ff88', font: 'Archivo',
    aff1Label: '', aff1Url: '', aff2Label: '', aff2Url: '',
    modRole: 'Mod', mods: [], modDraft: '',
    bw: [], bwDraft: '', bl: [], blDraft: '',
    chName: '', chHandle: HANDLE, handleNote: '', nameNote: ''
  };
  function applyTheme() {
    root.style.setProperty('--accent', ST.accent);
    root.style.setProperty('--chfont', (ST.font.indexOf(' ') > -1 ? "'" + ST.font + "'" : ST.font) + ',sans-serif');
  }
  function studioHTML() {
    var tabs = [['theme', 'Theme'], ['links', 'Links'], ['mod', 'Moderation'], ['chan', 'Channel']];
    var body = '';
    if (ST.tab === 'theme') {
      body = '<div class="lch-f-group"><span class="lch-f-label">ACCENT COLOR</span><div class="lch-swatches">' +
        ACCENTS.map(function (c) { return '<button class="lch-swatch' + (c === ST.accent ? ' on' : '') + '" data-acc="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">CHANNEL FONT</span><div class="lch-fontchips">' +
        FONTS.map(function (f) { return '<button class="lch-fontchip' + (f === ST.font ? ' on' : '') + '" data-font="' + esc(f) + '" style="font-family:\'' + f + '\',sans-serif">' + esc(f) + '</button>'; }).join('') + '</div></div>' +
        '<span class="lch-f-note">changes apply live to this preview immediately · saving to your account is unverified until a real session confirms the settings endpoint (see note below)</span>' +
        '<span class="lch-pending" id="ch-theme-save-note" style="display:none"></span>';
    } else if (ST.tab === 'links') {
      body = '<div class="lch-f-group"><span class="lch-f-label">LINK 1</span><input class="lch-f-input" id="ch-aff1l" placeholder="Display text" value="' + esc(ST.aff1Label) + '"><input class="lch-f-input mono" id="ch-aff1u" placeholder="https://…" value="' + esc(ST.aff1Url) + '"></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">LINK 2</span><input class="lch-f-input" id="ch-aff2l" placeholder="Display text" value="' + esc(ST.aff2Label) + '"><input class="lch-f-input mono" id="ch-aff2u" placeholder="https://…" value="' + esc(ST.aff2Url) + '"></div>' +
        '<span class="lch-f-note">banner images upload from the sidebar directly · social icons connect in account settings</span>';
    } else if (ST.tab === 'mod') {
      body = '<div class="lch-f-group"><span class="lch-f-label">MOD ROLE NAME</span><input class="lch-f-input" id="ch-modrole" value="' + esc(ST.modRole) + '"></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">MODERATORS</span>' +
        ST.mods.map(function (m, i) { return '<div class="lch-modrow"><span>' + esc(m) + '</span><span class="role">' + esc(ST.modRole.toUpperCase()) + '</span><button class="kill" data-rmmod="' + i + '">✕</button></div>'; }).join('') +
        '<div class="lch-f-row"><input class="lch-f-input" id="ch-moddraft" placeholder="@username" value="' + esc(ST.modDraft) + '"><button class="lch-f-add" id="ch-modadd">Add</button></div></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">BANNED WORDS</span><div class="lch-swatches">' +
        ST.bw.map(function (w, i) { return '<button class="lch-chipban" data-rmbw="' + i + '">' + esc(w) + ' ✕</button>'; }).join('') + '</div>' +
        '<div class="lch-f-row"><input class="lch-f-input" id="ch-bwdraft" placeholder="Add a word or phrase" value="' + esc(ST.bwDraft) + '"><button class="lch-f-add" id="ch-bwadd">Ban</button></div></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">BANNED LINKS</span><div class="lch-swatches">' +
        ST.bl.map(function (l, i) { return '<button class="lch-chipban" data-rmbl="' + i + '">' + esc(l) + ' ✕</button>'; }).join('') + '</div>' +
        '<div class="lch-f-row"><input class="lch-f-input mono" id="ch-bldraft" placeholder="Domain or pattern, e.g. t.me/*" value="' + esc(ST.blDraft) + '"><button class="lch-f-add" id="ch-bladd">Ban</button></div></div>' +
        '<span class="lch-pending">this tab has no storage backend yet on the site — nothing here persists past a page refresh. Flagging so it doesn\'t look silently broken.</span>';
    } else {
      body = '<div class="lch-f-group"><span class="lch-f-label">CHANNEL NAME</span><input class="lch-f-input" id="ch-namein" value="' + esc(ST.chName) + '"><span class="lch-f-note">' + esc(ST.nameNote) + '</span></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">@ HANDLE</span><input class="lch-f-input mono" id="ch-handlein" value="' + esc(ST.chHandle) + '"><span class="lch-f-note' + (ST.handleNote.indexOf('taken') > -1 ? ' warn' : '') + '">' + esc(ST.handleNote) + '</span></div>' +
        '<span class="lch-pending">handle-availability checking is real (sml-members/v1/handle-availability). Actually saving a changed handle needs a write endpoint that isn\'t confirmed yet — checking only, for now.</span>';
    }
    return '<div class="lch-scrim" id="ch-scrim"></div><div class="lch-studio">' +
      '<div class="lch-studio-h"><div><span class="t">✎ Channel studio</span><span class="s">admin preview · viewers never see this</span></div><button class="lch-studio-x" id="ch-studio-x">✕</button></div>' +
      '<div class="lch-studio-tabs">' + tabs.map(function (t) { return '<button class="lch-studio-tab' + (t[0] === ST.tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="lch-studio-body">' + body + '</div></div>';
  }
  function renderStudio() {
    el('#ch-studio-mount').innerHTML = studioHTML();
    el('#ch-scrim').onclick = closeStudio;
    el('#ch-studio-x').onclick = closeStudio;
    Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (b) { b.onclick = function () { ST.tab = b.getAttribute('data-tab'); renderStudio(); }; });
    if (ST.tab === 'theme') {
      Array.prototype.forEach.call(root.querySelectorAll('[data-acc]'), function (b) { b.onclick = function () { ST.accent = b.getAttribute('data-acc'); applyTheme(); saveProfileSettings(); renderStudio(); }; });
      Array.prototype.forEach.call(root.querySelectorAll('[data-font]'), function (b) { b.onclick = function () { ST.font = b.getAttribute('data-font'); applyTheme(); saveProfileSettings(); renderStudio(); }; });
    } else if (ST.tab === 'links') {
      ['aff1l', 'aff1u', 'aff2l', 'aff2u'].forEach(function (id) {
        var inp = el('#ch-' + id); if (!inp) return;
        inp.onchange = function () {
          if (id === 'aff1l') ST.aff1Label = inp.value; else if (id === 'aff1u') ST.aff1Url = inp.value;
          else if (id === 'aff2l') ST.aff2Label = inp.value; else ST.aff2Url = inp.value;
          saveProfileSettings();
        };
      });
    } else if (ST.tab === 'mod') {
      Array.prototype.forEach.call(root.querySelectorAll('[data-rmmod]'), function (b) { b.onclick = function () { ST.mods.splice(+b.getAttribute('data-rmmod'), 1); renderStudio(); }; });
      Array.prototype.forEach.call(root.querySelectorAll('[data-rmbw]'), function (b) { b.onclick = function () { ST.bw.splice(+b.getAttribute('data-rmbw'), 1); renderStudio(); }; });
      Array.prototype.forEach.call(root.querySelectorAll('[data-rmbl]'), function (b) { b.onclick = function () { ST.bl.splice(+b.getAttribute('data-rmbl'), 1); renderStudio(); }; });
      el('#ch-modrole').onchange = function () { ST.modRole = el('#ch-modrole').value || 'Mod'; renderStudio(); };
      el('#ch-moddraft').oninput = function () { ST.modDraft = el('#ch-moddraft').value; };
      el('#ch-modadd').onclick = function () { if (ST.modDraft.trim()) { ST.mods.push(ST.modDraft.trim().replace(/^@/, '')); ST.modDraft = ''; renderStudio(); } };
      el('#ch-bwdraft').oninput = function () { ST.bwDraft = el('#ch-bwdraft').value; };
      el('#ch-bwadd').onclick = function () { if (ST.bwDraft.trim()) { ST.bw.push(ST.bwDraft.trim()); ST.bwDraft = ''; renderStudio(); } };
      el('#ch-bldraft').oninput = function () { ST.blDraft = el('#ch-bldraft').value; };
      el('#ch-bladd').onclick = function () { if (ST.blDraft.trim()) { ST.bl.push(ST.blDraft.trim()); ST.blDraft = ''; renderStudio(); } };
    } else {
      el('#ch-namein').onchange = function () {
        ST.chName = el('#ch-namein').value;
        api('/sml-display-name/v1/save', { method: 'POST', body: JSON.stringify({ name: ST.chName }) }).then(function (r) {
          ST.nameNote = r.ok ? 'Saved.' : ((r.j && r.j.message) || 'Could not save — try again.');
          if (r.ok) el('#ch-name').textContent = ST.chName;
          renderStudio();
        });
      };
      var handleTimer;
      el('#ch-handlein').oninput = function () {
        ST.chHandle = el('#ch-handlein').value.trim();
        clearTimeout(handleTimer);
        handleTimer = setTimeout(function () {
          if (!ST.chHandle) return;
          api('/sml-members/v1/handle-availability?handle=' + encodeURIComponent(ST.chHandle)).then(function (r) {
            var j = r.j || {};
            var avail = j.available != null ? j.available : j.is_available;
            ST.handleNote = ST.chHandle === HANDLE ? 'This is your current handle.' : (avail ? 'Available.' : 'That handle is taken.');
            renderStudio();
          });
        }, 400);
      };
    }
  }
  function saveProfileSettings() {
    var note = el('#ch-theme-save-note');
    api('/sml-social-profile/v1/settings', { method: 'POST', body: JSON.stringify({ accent: ST.accent, font: ST.font, aff1_label: ST.aff1Label, aff1_url: ST.aff1Url, aff2_label: ST.aff2Label, aff2_url: ST.aff2Url }) })
      .then(function (r) {
        if (!note) return;
        note.style.display = '';
        note.textContent = r.ok ? 'Saved to your account.' : 'Live preview updated, but saving failed (' + r.status + ') — the settings endpoint shape hasn\'t been confirmed with a real session yet.';
      });
  }
  function openStudio() { if (!ST.chName) ST.chName = el('#ch-name').textContent; renderStudio(); document.addEventListener('keydown', studioEsc); }
  function closeStudio() { el('#ch-studio-mount').innerHTML = ''; document.removeEventListener('keydown', studioEsc); }
  function studioEsc(e) { if (e.key === 'Escape') closeStudio(); }
  el('#ch-edit').onclick = openStudio;

  loadIdentity(); loadHomeGroup(); loadLinks(); loadChannelContent(); loadNewsletter();
})();
