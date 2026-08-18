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
  var PROFILE_HANDLE = '';
  /* OWNER = this viewer owns THIS channel. Server says so on the channel payload
     (owner:true); the loader's SML_CH_ME.handle is the fallback. Never ADMIN —
     admin preview must not unlock another creator's Studio. */
  var OWNER = !!(ME && ME.handle && ME.handle.toLowerCase() === HANDLE.toLowerCase());
  var CH = { profile: {}, appearance: {}, stats: {} };

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
      '<span class="lch-vanity" id="ch-vanity" style="display:' + (OWNER ? 'none' : '') + '">stockmarketloop.com/channel/' + esc(HANDLE) + '</span>' +
      '<button class="lch-editbtn" id="ch-edit" style="display:' + (OWNER ? '' : 'none') + '">✎ EDIT CHANNEL</button>' +
      '<a class="lch-golive" id="ch-golive" href="/go-live/" style="display:' + (OWNER ? '' : 'none') + '">● GO LIVE</a>' +
    '</div></div>' +

    '<div class="lch-body">' +
      '<div class="lch-side">' +
        '<div class="lch-idcard"><div class="lch-idcard-bg lch-slot" id="ch-bg" data-slot="backdrop" data-ph="Backdrop — image or GIF"></div><div class="lch-idcard-fade"></div>' +
          '<div class="lch-idcard-tl"></div><div class="lch-idcard-tr"></div>' +
          '<div class="lch-idcard-in">' +
            '<div class="lch-avwrap"><div class="lch-avring"></div><div class="lch-av lch-slot" id="ch-av" data-slot="avatar" data-ph="Avatar">' + esc((HANDLE || 'SL').slice(0, 2).toUpperCase()) + '</div>' +
              '<span class="lch-avlive" id="ch-live" style="display:none">LIVE</span></div>' +
            '<div class="lch-idname"><span class="nm" id="ch-name">' + esc(HANDLE || '—') + '</span><span class="hd" id="ch-handle">@' + esc(HANDLE) + '</span><span class="tg" id="ch-tagline" style="display:none"></span></div>' +
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
        '<div id="ch-about"></div>' +
      '</div>' +
    '</div>' +
    '<div id="ch-studio-mount"></div>' +
    '<input type="file" id="ch-file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none">' +
    (ADMIN && !OWNER ? '<div class="lch-adminbar"><b>LOOP CHANNEL</b><span>admin preview</span><a href="?ch=0">exit</a></div>' : '');
  if (OWNER) root.classList.add('lch-owner');

  /* ---------- identity: same sources the watch pages already use ---------- */
  function loadIdentity(profileHandle) {
    if (!profileHandle) return;
    PROFILE_HANDLE = profileHandle;
    api('/sml-live/v1/feeds/' + encodeURIComponent(profileHandle)).then(function (res) {
      var c = res.j && res.j.creator;
      var live = !!(res.j && res.j.live);
      el('#ch-live').style.display = live ? '' : 'none';
      el('#ch-golive').style.display = 'none'; /* owner-only, decided in a later phase once we can detect ownership */
      if (c && c.name) { el('#ch-name').textContent = c.name; }
    }).catch(function () {});
    api('/sml-lb/v1/card/' + encodeURIComponent(profileHandle)).then(function (res) {
      /* profile photo is only the FALLBACK — a channel avatar set via /create-channel/
         or the Studio always wins */
      if (CH.profile && safeImage(CH.profile.avatar)) return;
      var j = res.j || {};
      var url = (j.profile && j.profile.photo) || j.photo || j.avatar || (j.profile && j.profile.avatar) || '';
      if (url && /^https:/.test(url)) {
        el('#ch-av').style.backgroundImage = 'url(' + url + ')';
        el('#ch-av').textContent = ''; el('#ch-av').classList.remove('empty');
      }
    }).catch(function () {});
    /* follow relationship + count: sml-members/v1/follow — shape unverified without
       a live session, so this is best-effort and stays honestly blank on failure
       rather than guessing a number. Revisit once admin browser access confirms it. */
    api('/sml-members/v1/follow?handle=' + encodeURIComponent(profileHandle)).then(function (res) {
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
    if (!PROFILE_HANDLE) return;
    var on = el('#ch-sub').classList.contains('on');
    api('/sml-members/v1/follow', { method: 'POST', body: JSON.stringify({ handle: PROFILE_HANDLE, follow: !on }) })
      .then(function (res) { if (res.ok) paintSub(!on); });
  };

  /* ---------- appearance: the creator's saved theme/images/links, applied for
     EVERY viewer (this is what makes the design the default for all users, not
     an owner-only preview). Source: channel payload .profile + .appearance. ---------- */
  var ICONS = {
    x: '<svg width="13" height="13" viewBox="0 0 24 24" fill="#c7d6e3"><path d="M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 5.9-7zm-1.3 19.4h2L6.6 3.3H4.4l13.2 17.3z"/></svg>',
    youtube: '<svg width="15" height="11" viewBox="0 0 24 17" fill="#c7d6e3"><path d="M23.5 2.7A3 3 0 0 0 21.4.5C19.5 0 12 0 12 0S4.5 0 2.6.5A3 3 0 0 0 .5 2.7 31 31 0 0 0 0 8.5a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-5.8 31 31 0 0 0-.5-5.8zM9.6 12.2V4.8l6.2 3.7-6.2 3.7z"/></svg>',
    site: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c7d6e3" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>'
  };
  function linkHref(v, kind) {
    v = String(v || '').trim(); if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (kind === 'x') return 'https://x.com/' + v.replace(/^@/, '');
    if (kind === 'youtube') return 'https://youtube.com/' + (v[0] === '@' ? v : '@' + v);
    return 'https://' + v;
  }
  function slotBg(node, url, ph) {
    if (!node) return;
    node.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
    node.classList.toggle('empty', !url);
    if (ph) node.setAttribute('data-ph', ph);
  }
  function applyAppearance() {
    var a = CH.appearance || {}, p = CH.profile || {};
    ST.accent = a.accent || ST.accent; ST.font = a.font || ST.font; applyTheme();
    if (p.name) el('#ch-name').textContent = p.name;
    var tg = el('#ch-tagline'); tg.textContent = p.tagline || ''; tg.style.display = p.tagline ? '' : 'none';
    slotBg(el('#ch-bg'), safeImage(p.backdrop));
    if (safeImage(p.avatar)) { el('#ch-av').style.backgroundImage = 'url("' + p.avatar + '")'; el('#ch-av').textContent = ''; el('#ch-av').classList.remove('empty'); }
    else el('#ch-av').classList.add('empty');
    renderLinks(); renderHomeGroup(); renderAbout();
  }
  function renderLinks() {
    var p = CH.profile || {}, a = CH.appearance || {}, links = p.links || {}, aff = a.aff || [];
    var socials = ['x', 'youtube', 'site'].filter(function (k) { return links[k]; }).map(function (k) {
      return '<a class="lch-social" href="' + esc(linkHref(links[k], k)) + '" title="' + esc(k === 'x' ? 'X' : k === 'youtube' ? 'YouTube' : 'Website') + '" target="_blank" rel="noopener">' + ICONS[k] + '</a>';
    }).join('');
    el('#ch-socials').innerHTML = socials; el('#ch-socials').style.display = socials ? '' : 'none';
    var banners = '';
    for (var i = 0; i < 2; i++) {
      var b = aff[i] || {}; var has = b.url || b.image || (OWNER);
      if (!has) continue;
      var img = safeImage(b.image);
      banners += '<a class="lch-banner" href="' + esc(b.url || '#') + '" title="' + esc(b.label || '') + '"' + (b.url ? ' target="_blank" rel="noopener sponsored"' : ' onclick="return false"') + '><div class="lch-banner-box"><div class="lch-banner-bg lch-slot' + (img ? '' : ' empty') + '" data-slot="aff' + (i + 1) + '" data-ph="Link ' + (i + 1) + ' banner — image or GIF, full width"' + (img ? ' style="background-image:url(&quot;' + esc(img) + '&quot;)"' : '') + '></div><div class="lch-banner-fade"></div>' +
        (b.url ? '<span class="lch-banner-ad">AD</span><span class="lch-banner-lb">' + esc(b.label || b.url) + ' ↗</span>' : '') + '</div></a>';
    }
    el('#ch-banners').innerHTML = banners;
    el('#ch-links').style.display = (socials || banners) ? '' : 'none';
    bindSlots();
  }
  function renderHomeGroup() {
    var hg = (CH.appearance && CH.appearance.home_group) || {};
    if (!hg.url && !OWNER) { el('#ch-hg').innerHTML = ''; return; }
    var img = safeImage(hg.image);
    var first = ((CH.profile && CH.profile.name) || HANDLE || 'CREATOR').split(' ')[0].toUpperCase();
    el('#ch-hg').innerHTML = '<a class="lch-hg" href="' + esc(hg.url || '#') + '"' + (hg.url ? '' : ' onclick="return false"') + '><div class="lch-hg-box"><div class="lch-hg-bg lch-slot' + (img ? '' : ' empty') + '" data-slot="group" data-ph="Home group banner"' + (img ? ' style="background-image:url(&quot;' + esc(img) + '&quot;)"' : '') + '></div><div class="lch-hg-fade"></div>' +
      '<div class="lch-hg-row"><b>' + esc(hg.name || (OWNER ? 'Set your home group in ✎ Edit Channel' : '')) + '</b><span>' + esc(hg.members || '') + '</span></div></div>' +
      '<div class="lch-hg-ft"><span class="tag">' + esc(first) + '\'S HOME GROUP</span><span class="open">' + (hg.url ? 'Open →' : '') + '</span></div></a>';
    bindSlots();
  }
  function renderAbout() {
    var p = CH.profile || {};
    var about = p.about || '';
    if (!about && !OWNER) { el('#ch-about').innerHTML = ''; return; }
    var joined = p.created_at ? new Date(p.created_at) : null;
    var meta = 'Joined Loop' + (joined && !isNaN(joined) ? ' · ' + joined.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');
    var body = about ? esc(about).replace(/(^|\s)(#[A-Za-z0-9_]+)/g, '$1<span class="tag">$2</span>') : '<span class="lch-muted">Tell viewers what your channel covers — ✎ Edit Channel → Channel.</span>';
    el('#ch-about').innerHTML = '<section class="lch-about"><div class="lch-section-h"><span class="t muted">▮ ABOUT</span><div class="rule"></div></div><p class="lch-about-body">' + body + '</p><span class="lch-about-meta">' + esc(meta) + '</span></section>';
  }

  /* ---------- owner image slots: click or drop an image/GIF straight onto the
     backdrop, avatar, either link banner or the home-group banner (design's
     image-slot behaviour). Uploads to sml-channel/v1/media; viewers see the
     result on next load; the owner sees it immediately. ---------- */
  var pendingSlot = '';
  function uploadTo(kind, file) {
    if (!file || !/^image\//.test(file.type)) return;
    var node = root.querySelector('[data-slot="' + kind + '"]'); if (node) node.classList.add('busy');
    var fd = new FormData(); fd.append('file', file); fd.append('kind', kind);
    var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE;
    fetch('/wp-json/sml-channel/v1/media', { method: 'POST', credentials: 'same-origin', headers: h, body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (node) node.classList.remove('busy');
        if (!res.ok) { flash((res.j && res.j.message) || 'Upload failed.'); return; }
        var url = res.j.url || '';
        if (kind === 'avatar') { CH.profile.avatar = url; }
        else if (kind === 'backdrop') { CH.profile.backdrop = url; }
        else if (kind === 'group') { CH.appearance.home_group = CH.appearance.home_group || {}; CH.appearance.home_group.image = url; }
        else if (kind === 'aff1' || kind === 'aff2') { CH.appearance.aff = CH.appearance.aff || [{}, {}]; CH.appearance.aff[kind === 'aff1' ? 0 : 1].image = url; }
        applyAppearance(); flash('Saved.');
      }).catch(function () { if (node) node.classList.remove('busy'); flash('Upload failed.'); });
  }
  function bindSlots() {
    if (!OWNER) return;
    Array.prototype.forEach.call(root.querySelectorAll('.lch-slot'), function (node) {
      if (node.__bound) return; node.__bound = true;
      node.title = 'Click or drop an image / GIF';
      node.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pendingSlot = node.getAttribute('data-slot'); el('#ch-file').value = ''; el('#ch-file').click(); });
      node.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); node.classList.add('drag'); });
      node.addEventListener('dragleave', function () { node.classList.remove('drag'); });
      node.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); node.classList.remove('drag'); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; uploadTo(node.getAttribute('data-slot'), f); });
    });
  }
  el('#ch-file').onchange = function () { if (pendingSlot && this.files[0]) uploadTo(pendingSlot, this.files[0]); };
  var flashT;
  function flash(msg) {
    var s = el('#ch-sync'); if (!s) return;
    var prev = '● CHANNEL FEED SYNCED';
    s.textContent = '● ' + msg.toUpperCase(); clearTimeout(flashT); flashT = setTimeout(function () { s.textContent = prev; }, 2200);
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
    api('/sml-channel/v1/channel/' + encodeURIComponent(HANDLE)).then(function (channelRes) {
      if (!channelRes.ok) throw new Error('channel unavailable');
      var channel = channelRes.j || {}; var creator = channel.creator || {};
      var profileHandle = creator.profile_handle || '';
      var videos = Array.isArray(channel.videos) ? channel.videos : []; var posts = Array.isArray(channel.posts) ? channel.posts : [];
      CH.profile = channel.profile || {}; CH.appearance = channel.appearance || {}; CH.stats = channel.stats || {};
      if (channel.owner && !OWNER) { OWNER = true; root.classList.add('lch-owner'); el('#ch-edit').style.display = ''; el('#ch-golive').style.display = ''; el('#ch-vanity').style.display = 'none'; }
      var shownName = CH.profile.name || creator.name;
      if (shownName) { document.title = shownName + ' | Loop Channel'; el('#ch-name').textContent = shownName; }
      applyAppearance();
      loadIdentity(profileHandle); loadNewsletter(profileHandle);
      var stats = channel.stats || {}; if (stats.videos != null) el('#ch-videos').textContent = fmt(stats.videos); if (stats.views != null) el('#ch-views').textContent = fmt(stats.views);
      renderOrbit(videos); renderCommunity(posts);
      return profileHandle ? api('/sml-live/v1/feeds/' + encodeURIComponent(profileHandle)).then(function (feedRes) { return loadHero(feedRes.ok ? (feedRes.j || {}) : {}, videos[0]); }) : loadHero({}, videos[0]);
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
  function loadNewsletter(profileHandle) {
    if (!profileHandle) return;
    api('/sml-loopletters/v1/issues?handle=' + encodeURIComponent(profileHandle)).then(function (res) {
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
        api('/sml-loopletters/v1/subscribe', { method: 'POST', body: JSON.stringify({ handle: profileHandle }) }).then(function (r) {
          if (r.ok) { subbed = true; var b = el('#ch-nlsub'); b.classList.add('on'); b.textContent = '✓ Subscribed'; }
        });
      };
    }).catch(function () {});
  }

  /* ---------- Channel Studio drawer (owner-only) ----------
     Everything here persists for real via sml-channel/v1/settings (+ /media for
     images) and is served to every viewer on the channel payload — matching the
     design's promise "changes apply live across your whole channel — every
     viewer sees them instantly". Handle changes still go through
     sml-channel/v1/handle (namespace rules live there).
     Moderation config is stored, but carrying it into live-stream chat is a
     separate integration that hasn't been wired yet — the tab says so. */
  var ACCENTS = ['#00ff88', '#00ccff', '#ffd166', '#ff6b4a', '#673aff', '#ff2e66', '#7affc0', '#4c9eff'];
  var FONTS = ['Archivo', 'Space Grotesk', 'Rajdhani', 'Orbitron', 'Exo 2', 'Chakra Petch', 'Oxanium', 'Sora', 'Manrope', 'Outfit', 'Barlow', 'Saira', 'Kanit', 'Play', 'Syne', 'Unbounded', 'Michroma', 'Audiowide'];
  var ST = {
    tab: 'theme', accent: '#00ff88', font: 'Archivo',
    aff1Label: '', aff1Url: '', aff2Label: '', aff2Url: '',
    hgUrl: '', hgName: '', hgMembers: '',
    modRole: 'Mod', mods: [], modDraft: '',
    bw: [], bwDraft: '', bl: [], blDraft: '',
    chName: '', chTagline: '', chAbout: '', lSite: '', lX: '', lYt: '',
    chHandle: (ME && ME.handle) || '', handleNote: '', nameNote: '', saveNote: ''
  };
  function applyTheme() {
    root.style.setProperty('--accent', ST.accent);
    root.style.setProperty('--chfont', (ST.font.indexOf(' ') > -1 ? "'" + ST.font + "'" : ST.font) + ',sans-serif');
  }
  function syncStudioFromChannel() {
    var a = CH.appearance || {}, p = CH.profile || {}, aff = a.aff || [], hg = a.home_group || {}, m = a.moderation || {}, l = p.links || {};
    ST.aff1Label = (aff[0] && aff[0].label) || ''; ST.aff1Url = (aff[0] && aff[0].url) || '';
    ST.aff2Label = (aff[1] && aff[1].label) || ''; ST.aff2Url = (aff[1] && aff[1].url) || '';
    ST.hgUrl = hg.url || ''; ST.hgName = hg.name || ''; ST.hgMembers = hg.members || '';
    ST.modRole = m.role || 'Mod'; ST.mods = (m.mods || []).slice(); ST.bw = (m.words || []).slice(); ST.bl = (m.links || []).slice();
    ST.chName = p.name || el('#ch-name').textContent; ST.chTagline = p.tagline || ''; ST.chAbout = p.about || '';
    ST.lSite = l.site || ''; ST.lX = l.x || ''; ST.lYt = l.youtube || '';
  }
  function studioHTML() {
    var tabs = [['theme', 'Theme'], ['links', 'Links'], ['mod', 'Moderation'], ['chan', 'Channel']];
    var body = '';
    if (ST.tab === 'theme') {
      body = '<div class="lch-f-group"><span class="lch-f-label">ACCENT COLOR</span><div class="lch-swatches">' +
        ACCENTS.map(function (c) { return '<button class="lch-swatch' + (c === ST.accent ? ' on' : '') + '" data-acc="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">CHANNEL FONT</span><div class="lch-fontchips">' +
        FONTS.map(function (f) { return '<button class="lch-fontchip' + (f === ST.font ? ' on' : '') + '" data-font="' + esc(f) + '" style="font-family:\'' + f + '\',sans-serif">' + esc(f) + '</button>'; }).join('') + '</div></div>' +
        '<span class="lch-f-note">changes apply live across your whole channel — every viewer sees them instantly</span>' +
        '<span class="lch-pending" id="ch-theme-save-note" style="display:' + (ST.saveNote ? '' : 'none') + '">' + esc(ST.saveNote) + '</span>';
    } else if (ST.tab === 'links') {
      body = '<div class="lch-f-group"><span class="lch-f-label">LINK 1</span><input class="lch-f-input" id="ch-aff1l" placeholder="Display text (or leave the raw link)" value="' + esc(ST.aff1Label) + '"><input class="lch-f-input mono" id="ch-aff1u" placeholder="https://…" value="' + esc(ST.aff1Url) + '"><button class="lch-f-add ghost" data-upload="aff1">⬆ Banner image / GIF</button></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">LINK 2</span><input class="lch-f-input" id="ch-aff2l" placeholder="Display text" value="' + esc(ST.aff2Label) + '"><input class="lch-f-input mono" id="ch-aff2u" placeholder="https://…" value="' + esc(ST.aff2Url) + '"><button class="lch-f-add ghost" data-upload="aff2">⬆ Banner image / GIF</button></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">SOCIAL LINKS</span><input class="lch-f-input mono" id="ch-lx" placeholder="X / Twitter — @handle or URL" value="' + esc(ST.lX) + '"><input class="lch-f-input mono" id="ch-lyt" placeholder="YouTube — @handle or URL" value="' + esc(ST.lYt) + '"><input class="lch-f-input mono" id="ch-lsite" placeholder="Website — https://…" value="' + esc(ST.lSite) + '"></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">HOME GROUP</span><input class="lch-f-input" id="ch-hgname" placeholder="Group name" value="' + esc(ST.hgName) + '"><input class="lch-f-input mono" id="ch-hgurl" placeholder="/groups/your-group/ or full URL" value="' + esc(ST.hgUrl) + '"><input class="lch-f-input mono" id="ch-hgmem" placeholder="Members label, e.g. 12.4K (optional)" value="' + esc(ST.hgMembers) + '"><button class="lch-f-add ghost" data-upload="group">⬆ Group banner</button></div>' +
        '<span class="lch-f-note">banner images: you can also drag an image or GIF straight onto each banner in the sidebar — it fills the full module width</span>' +
        '<span class="lch-pending" id="ch-theme-save-note" style="display:' + (ST.saveNote ? '' : 'none') + '">' + esc(ST.saveNote) + '</span>';
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
        '<span class="lch-f-note">saved to your channel · carry-over into live-stream chat is not wired yet</span>' +
        '<span class="lch-pending" id="ch-theme-save-note" style="display:' + (ST.saveNote ? '' : 'none') + '">' + esc(ST.saveNote) + '</span>';
    } else {
      body = '<div class="lch-f-group"><span class="lch-f-label">CHANNEL NAME</span><input class="lch-f-input" id="ch-namein" value="' + esc(ST.chName) + '" maxlength="60"><span class="lch-f-note">' + esc(ST.nameNote) + '</span></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">TAGLINE</span><input class="lch-f-input" id="ch-tagin" value="' + esc(ST.chTagline) + '" maxlength="120" placeholder="One line under your channel name"></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">ABOUT</span><textarea class="lch-f-input" id="ch-aboutin" rows="4" maxlength="600" placeholder="What you cover, how often, and who it\'s for. #hashtags highlight.">' + esc(ST.chAbout) + '</textarea></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">@ LOOP CHANNEL HANDLE</span><div class="lch-f-row"><input class="lch-f-input mono" id="ch-handlein" value="' + esc(ST.chHandle) + '" placeholder="Choose a separate channel handle"><button class="lch-f-add" id="ch-handlesave">Save</button></div><span class="lch-f-note' + (ST.handleNote.indexOf('taken') > -1 || ST.handleNote.indexOf('unavailable') > -1 ? ' warn' : '') + '">' + esc(ST.handleNote) + '</span></div>' +
        '<div class="lch-f-group"><span class="lch-f-label">IMAGES & GIFS</span><div class="lch-f-row"><button class="lch-f-add ghost" data-upload="avatar">⬆ Avatar</button><button class="lch-f-add ghost" data-upload="backdrop">⬆ Card backdrop</button></div><span class="lch-f-note">or drag & drop anywhere they live: the backdrop behind your avatar card · avatar · both link banners · home-group banner (GIFs autoplay)</span></div>' +
        '<span class="lch-pending">Your Loop Channel handle is separate from your profile handle. Clearing and saving it disables your channel.</span>' +
        '<span class="lch-pending" id="ch-theme-save-note" style="display:' + (ST.saveNote ? '' : 'none') + '">' + esc(ST.saveNote) + '</span>';
    }
    return '<div class="lch-scrim" id="ch-scrim"></div><div class="lch-studio">' +
      '<div class="lch-studio-h"><div><span class="t">✎ Channel studio</span><span class="s">creator-only · viewers never see this</span></div><button class="lch-studio-x" id="ch-studio-x">✕</button></div>' +
      '<div class="lch-studio-tabs">' + tabs.map(function (t) { return '<button class="lch-studio-tab' + (t[0] === ST.tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="lch-studio-body">' + body + '</div></div>';
  }
  function renderStudio() {
    el('#ch-studio-mount').innerHTML = studioHTML();
    el('#ch-scrim').onclick = closeStudio;
    el('#ch-studio-x').onclick = closeStudio;
    Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (b) { b.onclick = function () { ST.tab = b.getAttribute('data-tab'); renderStudio(); }; });
    /* upload buttons inside the drawer reuse the same slot uploader as drag-drop */
    Array.prototype.forEach.call(root.querySelectorAll('[data-upload]'), function (b) { b.onclick = function () { pendingSlot = b.getAttribute('data-upload'); el('#ch-file').value = ''; el('#ch-file').click(); }; });
    if (ST.tab === 'theme') {
      Array.prototype.forEach.call(root.querySelectorAll('[data-acc]'), function (b) { b.onclick = function () { ST.accent = b.getAttribute('data-acc'); applyTheme(); saveSettings({ accent: ST.accent }); renderStudio(); }; });
      Array.prototype.forEach.call(root.querySelectorAll('[data-font]'), function (b) { b.onclick = function () { ST.font = b.getAttribute('data-font'); applyTheme(); saveSettings({ font: ST.font }); renderStudio(); }; });
    } else if (ST.tab === 'links') {
      var linkSave = function () {
        ST.aff1Label = el('#ch-aff1l').value; ST.aff1Url = el('#ch-aff1u').value; ST.aff2Label = el('#ch-aff2l').value; ST.aff2Url = el('#ch-aff2u').value;
        ST.lX = el('#ch-lx').value; ST.lYt = el('#ch-lyt').value; ST.lSite = el('#ch-lsite').value;
        ST.hgName = el('#ch-hgname').value; ST.hgUrl = el('#ch-hgurl').value; ST.hgMembers = el('#ch-hgmem').value;
        saveSettings({ aff: [{ label: ST.aff1Label, url: ST.aff1Url }, { label: ST.aff2Label, url: ST.aff2Url }], links: { x: ST.lX, youtube: ST.lYt, site: ST.lSite }, home_group: { name: ST.hgName, url: ST.hgUrl, members: ST.hgMembers } });
      };
      ['aff1l', 'aff1u', 'aff2l', 'aff2u', 'lx', 'lyt', 'lsite', 'hgname', 'hgurl', 'hgmem'].forEach(function (id) { var inp = el('#ch-' + id); if (inp) inp.onchange = linkSave; });
    } else if (ST.tab === 'mod') {
      var modSave = function () { saveSettings({ moderation: { role: ST.modRole, mods: ST.mods, words: ST.bw, links: ST.bl } }); };
      Array.prototype.forEach.call(root.querySelectorAll('[data-rmmod]'), function (b) { b.onclick = function () { ST.mods.splice(+b.getAttribute('data-rmmod'), 1); modSave(); renderStudio(); }; });
      Array.prototype.forEach.call(root.querySelectorAll('[data-rmbw]'), function (b) { b.onclick = function () { ST.bw.splice(+b.getAttribute('data-rmbw'), 1); modSave(); renderStudio(); }; });
      Array.prototype.forEach.call(root.querySelectorAll('[data-rmbl]'), function (b) { b.onclick = function () { ST.bl.splice(+b.getAttribute('data-rmbl'), 1); modSave(); renderStudio(); }; });
      el('#ch-modrole').onchange = function () { ST.modRole = el('#ch-modrole').value || 'Mod'; modSave(); renderStudio(); };
      el('#ch-moddraft').oninput = function () { ST.modDraft = el('#ch-moddraft').value; };
      el('#ch-modadd').onclick = function () { if (ST.modDraft.trim()) { ST.mods.push(ST.modDraft.trim().replace(/^@/, '')); ST.modDraft = ''; modSave(); renderStudio(); } };
      el('#ch-bwdraft').oninput = function () { ST.bwDraft = el('#ch-bwdraft').value; };
      el('#ch-bwadd').onclick = function () { if (ST.bwDraft.trim()) { ST.bw.push(ST.bwDraft.trim()); ST.bwDraft = ''; modSave(); renderStudio(); } };
      el('#ch-bldraft').oninput = function () { ST.blDraft = el('#ch-bldraft').value; };
      el('#ch-bladd').onclick = function () { if (ST.blDraft.trim()) { ST.bl.push(ST.blDraft.trim()); ST.blDraft = ''; modSave(); renderStudio(); } };
    } else {
      el('#ch-namein').onchange = function () {
        ST.chName = el('#ch-namein').value.trim();
        if (!ST.chName) { ST.nameNote = 'Enter a channel name.'; renderStudio(); return; }
        saveSettings({ name: ST.chName }, function (ok) { ST.nameNote = ok ? 'Saved.' : 'Could not save — try again.'; renderStudio(); });
      };
      el('#ch-tagin').onchange = function () { ST.chTagline = el('#ch-tagin').value; saveSettings({ tagline: ST.chTagline }); };
      el('#ch-aboutin').onchange = function () { ST.chAbout = el('#ch-aboutin').value; saveSettings({ about: ST.chAbout }); };
      var handleTimer;
      el('#ch-handlein').oninput = function () {
        ST.chHandle = el('#ch-handlein').value.trim();
        clearTimeout(handleTimer);
        handleTimer = setTimeout(function () {
          if (!ST.chHandle) { ST.handleNote = 'Save an empty handle to disable your channel.'; renderStudio(); return; }
          api('/sml-channel/v1/handle-availability?handle=' + encodeURIComponent(ST.chHandle)).then(function (r) {
            var j = r.j || {};
            var avail = j.available != null ? j.available : j.is_available;
            ST.handleNote = ST.chHandle === ((ME && ME.handle) || '') ? 'This is your current channel handle.' : (avail ? 'Available.' : 'That handle is unavailable.');
            renderStudio();
          });
        }, 400);
      };
      el('#ch-handlesave').onclick = function () {
        ST.chHandle = el('#ch-handlein').value.trim();
        ST.handleNote = 'Saving…'; renderStudio();
        api('/sml-channel/v1/handle', { method: 'POST', body: JSON.stringify({ handle: ST.chHandle }) }).then(function (r) {
          if (!r.ok) { ST.handleNote = (r.j && r.j.message) || 'Could not save the channel handle.'; renderStudio(); return; }
          var saved = (r.j && r.j.handle) || '';
          if (ME) ME.handle = saved;
          ST.chHandle = saved;
          ST.handleNote = saved ? 'Saved. Opening your channel preview…' : 'Channel disabled.';
          renderStudio();
          if (saved) window.location.assign('/channel/' + encodeURIComponent(saved) + '/?ch=1');
        });
      };
    }
  }
  /* one real endpoint for everything the Studio edits; the response carries the
     canonical profile+appearance so the page re-renders exactly what viewers get */
  function saveSettings(patch, cb) {
    ST.saveNote = 'Saving…'; var note = el('#ch-theme-save-note'); if (note) { note.style.display = ''; note.textContent = ST.saveNote; }
    api('/sml-channel/v1/settings', { method: 'POST', body: JSON.stringify(patch) }).then(function (r) {
      if (r.ok && r.j) { CH.appearance = r.j.appearance || CH.appearance; CH.profile = r.j.profile || CH.profile; applyAppearance(); }
      ST.saveNote = r.ok ? 'Saved — live for every viewer.' : ((r.j && r.j.message) || 'Could not save (' + r.status + ').');
      note = el('#ch-theme-save-note'); if (note) { note.style.display = ''; note.textContent = ST.saveNote; }
      if (cb) cb(!!r.ok);
    }).catch(function () { ST.saveNote = 'Could not reach the site.'; note = el('#ch-theme-save-note'); if (note) { note.style.display = ''; note.textContent = ST.saveNote; } if (cb) cb(false); });
  }
  function openStudio() { if (!OWNER) return; syncStudioFromChannel(); ST.saveNote = ''; renderStudio(); document.addEventListener('keydown', studioEsc); }
  function closeStudio() { el('#ch-studio-mount').innerHTML = ''; document.removeEventListener('keydown', studioEsc); }
  function studioEsc(e) { if (e.key === 'Escape') closeStudio(); }
  el('#ch-edit').onclick = openStudio;

  loadChannelContent();
})();
