/* SML VOD Watch — uploaded-video watch page (fork of the live watch page design).
   Mounts on /watch/{videoId}/ pages rendered by sml-video-upload-studio: ADOPTS the
   page's existing <video> (source, poster) + OG/JSON-LD metadata (title, description,
   canonical, upload date), then renders the VOD design around it: ▶ UPLOAD dressing,
   green clock/duration, real like (reaction engine), share, About flip card, Comments
   module (sml-reactions comments), Recommended next (video-upload-studio rail), and
   honestly-gated home-group card + creator face cam. Reuses css/live-watch.css. */
(function () {
  'use strict';
  var root = document.getElementById('sml-vw-root');
  if (!root || root.__booted) return;
  root.__booted = true;
  var ADMIN = (typeof window.SML_VW_ADMIN !== 'undefined') ? !!window.SML_VW_ADMIN : true;
  var NONCE = window.SML_VW_NONCE || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var ME = window.SML_VW_ME || null; /* {id,name,avatar} from the snippet, when logged in */

  /* ---------- harvest the page (before we hide it) ---------- */
  function meta(p) { var m = document.querySelector('meta[property="' + p + '"]') || document.querySelector('meta[name="' + p + '"]'); return m ? m.getAttribute('content') || '' : ''; }
  var srcVideo = document.querySelector('video source[src], video[src]');
  var VID = {
    src: srcVideo ? (srcVideo.getAttribute('src') || '') : meta('og:video'),
    poster: (document.querySelector('video[poster]') || {}).getAttribute ? (document.querySelector('video[poster]').getAttribute('poster') || meta('og:image')) : meta('og:image'),
    title: meta('og:title') || document.title.replace(/\s*-\s*Stock Market Loop\s*$/, ''),
    desc: meta('og:description') || meta('description'),
    url: meta('og:url') || location.href.split('?')[0],
    id: (location.pathname.match(/\/watch\/([A-Za-z0-9_-]+)\/?/) || [])[1] || '',
    date: '', creator: '', handle: '', duration: 0, premiereAt: ''
  };
  /* premiere (scheduled upload): the server prints these while the premiere is upcoming or running */
  var PREM = { start: Date.parse(meta('sml:premiere-start') || '') || 0, dur: (+meta('sml:premiere-duration') || 0), chat: meta('sml:premiere-chat') || '' };
  function premPhase() { if (!PREM.start) return ''; var now = Date.now(); if (now < PREM.start) return 'upcoming'; if (now < PREM.start + PREM.dur * 1000) return 'live'; return ''; }
  try {
    var lds = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < lds.length; i++) {
      var j = JSON.parse(lds[i].textContent);
      var arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (var k = 0; k < arr.length; k++) {
        if (arr[k] && arr[k]['@type'] === 'VideoObject') {
          VID.date = arr[k].uploadDate || VID.date;
          if (arr[k].author) VID.creator = arr[k].author.name || VID.creator;
          /* scheduled upload: the server marks it with publication.BroadcastEvent.startDate and withholds the file */
          if (arr[k].publication) { var pub = Array.isArray(arr[k].publication) ? arr[k].publication[0] : arr[k].publication; if (pub && pub.startDate) VID.premiereAt = pub.startDate; }
          if (arr[k].duration) { var dm = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(arr[k].duration); if (dm) VID.duration = (+dm[1] || 0) * 3600 + (+dm[2] || 0) * 60 + (+dm[3] || 0); }
        }
      }
    }
  } catch (e) {}
  var pageVideo = document.querySelector('video');
  if (pageVideo) { try { pageVideo.pause(); } catch (e) {} }

  /* re-parent + takeover (same as the live page) */
  if (root.parentNode !== document.body) document.body.appendChild(root);
  document.body.classList.add('slw-on');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function hms(n) { n = Math.max(0, Math.floor(n || 0)); var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60, p = function (v) { return String(v).padStart(2, '0'); }; return (h ? h + ':' + p(m) : String(m)) + ':' + p(s); }
  function el(sel) { return root.querySelector(sel); }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'same-origin'; opts.headers = opts.headers || {};
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    return fetch('/wp-json' + path, opts).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function relTime(s2) { var t = Date.parse(String(s2 || '').replace(' ', 'T')); if (isNaN(t)) return ''; var d = Math.max(0, (Date.now() - t) / 1000); if (d < 60) return 'now'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; if (d < 86400 * 30) return Math.floor(d / 86400) + 'd ago'; return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function upDate(iso) { var t = Date.parse(iso || ''); if (isNaN(t)) return ''; return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(); }
  function cdnBase() { var sc = document.querySelector('script[src*="vod-watch.js"]'); return sc ? sc.src.replace(/js\/vod-watch\.js.*$/, '') : ''; }
  var logo = cdnBase() ? '<img src="' + cdnBase() + 'img/loop-logo.png" alt="Stock Market Loop">' : '<span style="font:800 13px/1 Archivo,sans-serif;color:#00ff88">STOCK MARKET LOOP</span>';

  /* ---------- markup ---------- */
  root.classList.add('slw-vod');
  root.innerHTML =
    '<div class="slw-amb"><div class="slw-amb-g"></div><div class="slw-amb-r"></div></div>' +
    /* the page's own nav bar (logo · STUDIO, Terminal/Watch/Live/Rooms, ticker search) was deleted for everyone on 2026-09-14 — the site header already carries navigation and search */
    '<div class="slw-content"><div class="slw-stage">' +
    '<div class="slw-main">' +
      '<div class="slw-player"><div class="slw-frame clear">' +
        '<div class="slw-media" id="slw-media"></div>' +
        '<div class="slw-topchips"><div class="slw-upchip"><span>▶ UPLOAD</span></div>' +
          '<div class="slw-viewchip"><span class="n" id="vw-views">—</span><span class="w">views</span></div></div>' +
        '<div id="vw-facecam"></div>' +
        '<div class="slw-titleblk"><div class="ep"><i></i><span id="vw-ep">UPLOAD</span></div>' +
          '<h1 id="vw-h1">' + esc(VID.title) + '</h1>' +
          '<div class="who"><span class="nm" id="vw-who">' + esc(VID.creator) + '</span><span class="sep"></span><span class="el"><span id="vw-clock2">0:00</span> / <span id="vw-dur2">' + (VID.duration ? hms(VID.duration) : '—') + '</span></span></div></div>' +
        '<div class="slw-ctl">' +
          '<div class="slw-prog" id="vw-prog"><div class="buf" id="vw-buf" style="width:0"></div><div class="fill" id="vw-fill" style="width:0"></div><div class="head" id="vw-head" style="left:0"></div></div>' +
          '<div class="slw-ctl-row"><div class="slw-ctl-l">' +
            '<button class="slw-btn-sq play" id="vw-play">▶</button>' +
            '<button class="slw-vol" id="vw-vol"><span class="g">◂))</span><span class="bar"><i></i></span></button>' +
            '<div class="slw-loopchip"><span>LOOP UPLOAD</span></div>' +
            '<span class="slw-vodclock"><span id="vw-clock">0:00</span> / <span id="vw-dur">' + (VID.duration ? hms(VID.duration) : '—') + '</span></span>' +
          '</div><div class="slw-ctl-r">' +
            '<button class="slw-btn-term" id="vw-term" style="display:none">Open terminal →</button>' +
            '<button class="slw-like" id="vw-like"><span class="g">👍</span> <span id="vw-likes">—</span></button>' +
            '<button class="slw-share" id="vw-share">⤴ Share</button>' +
            '<button class="slw-gear" id="vw-mini" title="Keep watching in Loop-Kick (mini player)">⧉</button>' +
            '<button class="slw-gear" id="vw-fs" title="Fullscreen">⛶</button>' +
          '</div></div>' +
        '</div>' +
      '</div></div>' +

      /* about card (single, no quote card on VOD) */
      '<div class="slw-inforow"><div class="slw-aboutwrap" style="flex:1 1 100%"><div class="slw-aboutflip" id="vw-flip">' +
        '<div class="slw-about"><div class="slw-about-h"><div class="slw-avatar" id="vw-av">' + esc((VID.creator || 'SL').slice(0, 2).toUpperCase()) + '</div>' +
          '<div class="slw-about-id"><span class="nm" id="vw-cname">' + esc(VID.creator || 'Stock Market Loop') + '</span><span class="fo" id="vw-cmeta"></span></div>' +
          '<a class="slw-sub" id="vw-profile" href="#" style="display:none;text-decoration:none;color:#04060a">View channel →</a></div>' +
        '<span class="slw-about-desc" id="vw-desc">' + esc(VID.desc) + '</span>' +
        '<div class="slw-about-f"><span class="cap">ABOUT THIS VIDEO</span><div class="ctl"><button class="slw-more" id="vw-more">More</button><span class="hint">disclaimer</span><button class="slw-flipbtn" data-flip="-1">‹</button><button class="slw-flipbtn" data-flip="1">›</button></div></div></div>' +
        '<div class="slw-about back"><div class="slw-disc-h"><b>DISCLAIMER</b><span>uploaded content</span></div>' +
        '<span class="slw-disc-t">Videos are for education and information only and are not investment advice or a recommendation to buy or sell any security. Quotes shown may be delayed. Creators speak for themselves.</span>' +
        '<div class="slw-about-f"><button class="slw-x" id="vw-more2">More</button><div class="ctl"><span class="hint">about</span><button class="slw-flipbtn" data-flip="-1">‹</button><button class="slw-flipbtn" data-flip="1">›</button></div></div></div>' +
      '</div></div></div>' +

      /* orbit ("From the host") — real photos, same media-library tagging as the live page */
      '<div class="slw-orbit-sec" id="vw-orbit-sec" style="display:none"><div class="oh"><span class="l">From the host</span><span class="r" id="vw-ocount2">— / —</span></div>' +
        '<div class="slw-orbit" id="vw-orbit" tabindex="0" role="region" aria-label="Host photos — use the left and right arrow keys to rotate">' +
          '<div class="slw-neb1"></div><div class="slw-neb2"></div><div class="slw-stars1"></div><div class="slw-stars2"></div><div class="slw-floor"></div>' +
          '<div class="slw-astroB"></div><div class="slw-astroC"></div>' +
          '<div class="slw-ring-persp"><div class="slw-ring" id="vw-ring"></div></div>' +
          '<div class="slw-astroA"></div>' +
          '<div class="slw-orbit-ctl"><button class="slw-orb-nav" id="vw-oprev" title="Previous image">‹</button>' +
          '<button class="slw-orb-pause" id="vw-opause" title="Pause rotation">❚❚ Pause</button>' +
          '<button class="slw-orb-nav" id="vw-onext" title="Next image">›</button>' +
          '<span class="slw-orb-count" id="vw-ocount">— / —</span></div></div>' +
        '<div class="slw-orbit-cap"><div class="l"><b id="vw-otitle"></b><span id="vw-osub"></span></div>' +
        '<div class="r"><button class="slw-btn2" id="vw-oenlarge">Enlarge</button><a class="slw-openlink" href="#" target="_blank" rel="noopener">Open link ↗</a></div></div>' +
      '</div>' +

      /* comments */
      '<div class="slw-cm" id="vw-cm"><div class="slw-cm-h"><div class="l"><b>Comments</b><span id="vw-cmcount">—</span></div>' +
        '<div class="r"><button class="slw-cm-sort on" data-sort="top">Top</button><button class="slw-cm-sort" data-sort="new">Newest</button></div></div>' +
        '<div class="slw-cm-gate" id="vw-cmgate" style="display:none"></div>' +
        '<div class="slw-cm-comp" id="vw-cmcomp"><div class="av" id="vw-cmav">' + (ME && ME.name ? esc(ME.name.slice(0, 2).toUpperCase()) : '?') + '</div>' +
          '<input type="text" id="vw-cmin" maxlength="1000" placeholder="Add a comment" autocomplete="off"><button class="slw-cm-post" id="vw-cmpost">Comment</button></div>' +
        '<div id="vw-cmlist"></div></div>' +
    '</div>' +

    /* rail */
    '<div class="slw-rail">' +
      '<div id="vw-chat" class="vw-chat" style="display:none"></div>' +
      '<div id="vw-camrail"></div>' +
      '<div class="slw-rec"><div class="slw-rec-h"><div class="l"><b>Recommended next</b><span>Live channels and uploads, picked from what you watch</span></div>' +
        '<div class="r"><a href="/watch/">Browse all →</a><span id="vw-recmeta"></span></div></div><div id="vw-rec"></div></div>' +
      '<div id="vw-hg"></div>' +
    '</div>' +
    '</div></div>' +
    '<div id="vw-lb-mount"></div><div id="vw-modal"></div>' +
    (ADMIN ? '<div class="slw-banner"><b>VOD WATCH</b><span>admin tools</span><a href="?vw=0">exit</a></div>' : '');

  /* ---------- player: adopt the page's video source ---------- */
  var media = el('#slw-media');
  var v = document.createElement('video');
  v.playsInline = true; v.preload = 'metadata';
  /* phones: the control bar sits under the video (css top:100%); the frame reserves its real height */
  (function () {
    if (!document.documentElement.classList.contains('sml-mobile') || !window.ResizeObserver) return;
    var ctl = root.querySelector('.slw-ctl'), frame = root.querySelector('.slw-frame');
    if (!ctl || !frame) return;
    var fit = function () { frame.style.setProperty('--slw-ctl-h', ctl.offsetHeight + 'px'); };
    new ResizeObserver(fit).observe(ctl); fit();
  })();
  if (VID.poster) v.poster = VID.poster;
  if (VID.src) v.src = VID.src;
  media.appendChild(v);
  /* ---------- premiere mode (owner design 2026-09-15): a scheduled upload acts like a live watch page ----------
     upcoming: countdown card over the poster + live chat; at zero the page reloads and the server serves the file.
     live: everyone plays in sync from the start time (seek-ahead disabled, drift corrected), LIVE badge, live chat.
     after start+duration: a normal video (seeking back on, chat stays as the premiere's chat). */
  var PHASE = premPhase();
  function fmtCountdown(ms) { var t = Math.max(0, Math.floor(ms / 1000)); var d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; var p = function (x) { return String(x).padStart(2, '0'); }; return (d ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(sec); }
  var premCard = null, premTimer = null;
  function paintPremiereChip(phase) {
    var chip = el('.slw-upchip'); if (!chip) return;
    chip.classList.toggle('prem-live', phase === 'live'); chip.classList.toggle('prem-up', phase === 'upcoming');
    chip.innerHTML = phase === 'live' ? '<span>● PREMIERE · LIVE</span>' : (phase === 'upcoming' ? '<span>◷ PREMIERE</span>' : '<span>▶ UPLOAD</span>');
    if (el('#vw-ep')) el('#vw-ep').textContent = phase === 'live' ? 'PREMIERING NOW' : (phase === 'upcoming' ? 'PREMIERE' : (VID.date ? 'UPLOADED ' + upDate(VID.date) : 'UPLOAD'));
  }
  if (PHASE === 'upcoming') {
    var when = new Date(PREM.start);
    var whenTxt = when.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    premCard = document.createElement('div');
    premCard.className = 'slw-premiere';
    premCard.innerHTML = '<div class="slw-premiere-in"><span class="slw-premiere-tag">PREMIERE · ' + esc(whenTxt) + '</span><b>' + esc(VID.title || 'Premiere') + '</b>' +
      /* no running countdown (owner 2026-09-23): the tag above carries the start date and time; the timer below still reloads at the start */
      '<span>It plays for everyone at the same time — live chat is open now.</span></div>';
    if (VID.poster) premCard.style.backgroundImage = 'url(' + VID.poster + ')';
    media.appendChild(premCard);
    root.classList.add('slw-premiere-on');
    premTimer = setInterval(function () {
      var left = PREM.start - Date.now();
      var cd = el('#vw-prem-cd'); if (cd) cd.textContent = fmtCountdown(left);
      if (left <= 0) { clearInterval(premTimer); location.replace(location.pathname + '?live=' + Date.now()); }   /* fresh copy: the server now serves the file */
    }, 1000);
  }
  var LIVE_SYNC = PHASE === 'live';
  /* stale page guard: a cached "upcoming" copy served after the start has no file — fetch a fresh one once */
  if (LIVE_SYNC && !VID.src) {
    var stale = 'slw-prem-refetch-' + VID.id;
    var tries = +(sessionStorage.getItem(stale) || 0);
    if (tries < 3) { sessionStorage.setItem(stale, String(tries + 1)); setTimeout(function () { location.replace(location.pathname + '?live=' + Date.now()); }, 1500); }
    LIVE_SYNC = false;
  }
  function liveEdge() { return Math.max(0, (Date.now() - PREM.start) / 1000); }
  function syncToEdge() { if (!LIVE_SYNC) return; var edge = liveEdge(); if (isFinite(v.duration) && v.duration > 0 && edge >= v.duration) { endLivePremiere(); return; } if (Math.abs(v.currentTime - edge) > 3) { try { v.currentTime = edge; } catch (e) {} } }
  function endLivePremiere() { LIVE_SYNC = false; root.classList.remove('slw-premiere-live'); paintPremiereChip(''); var j = el('#vw-prem-join'); if (j) j.remove(); }
  if (LIVE_SYNC) {
    root.classList.add('slw-premiere-live');
    var join = document.createElement('button');
    join.id = 'vw-prem-join'; join.className = 'slw-prem-join';
    join.innerHTML = '<b>▶ Join the premiere</b><span>playing live for everyone · started ' + hms(liveEdge()) + ' ago</span>';
    media.appendChild(join);
    join.onclick = function (e) { e.stopPropagation(); syncToEdge(); v.play().catch(function () {}); join.remove(); };
    v.addEventListener('loadedmetadata', syncToEdge);
    v.addEventListener('play', syncToEdge);
    setInterval(function () { if (LIVE_SYNC && !v.paused) syncToEdge(); if (LIVE_SYNC && Date.now() >= PREM.start + PREM.dur * 1000) endLivePremiere(); }, 10000);
  }
  paintPremiereChip(PHASE);
  var playing = false, muted = false;
  function paintPlay() { var b = el('#vw-play'); b.textContent = playing ? '❚❚' : '▶'; b.classList.toggle('play', !playing); }
  el('#vw-play').onclick = function () { if (v.paused) v.play().catch(function () {}); else v.pause(); };
  media.addEventListener('click', function () { if (v.paused) v.play().catch(function () {}); else v.pause(); });
  var frameEl = el('.slw-frame');
  v.addEventListener('play', function () { playing = true; paintPlay(); frameEl.classList.add('playing'); });
  v.addEventListener('pause', function () { playing = false; paintPlay(); frameEl.classList.remove('playing'); });
  v.addEventListener('loadedmetadata', function () { if (isFinite(v.duration)) { VID.duration = v.duration; el('#vw-dur').textContent = hms(v.duration); el('#vw-dur2').textContent = hms(v.duration); } });
  v.addEventListener('timeupdate', function () {
    var d = v.duration || VID.duration || 0;
    el('#vw-clock').textContent = hms(v.currentTime); el('#vw-clock2').textContent = hms(v.currentTime);
    if (d) { var pct = Math.min(100, v.currentTime / d * 100); el('#vw-fill').style.width = pct + '%'; el('#vw-head').style.left = pct + '%'; }
    if (v.buffered.length && d) el('#vw-buf').style.width = Math.min(100, v.buffered.end(v.buffered.length - 1) / d * 100) + '%';
  });
  el('#vw-prog').addEventListener('click', function (e) {
    var r = e.currentTarget.getBoundingClientRect(); var d = v.duration || VID.duration; if (!d) return;
    var target = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d;
    if (LIVE_SYNC) target = Math.min(target, liveEdge());   /* a premiere cannot be watched ahead of everyone else */
    v.currentTime = target;
  });
  el('#vw-vol').onclick = function () {
    muted = !muted; v.muted = muted;
    var b = el('#vw-vol'); b.className = 'slw-vol' + (muted ? ' muted' : '');
    b.innerHTML = muted ? '<span class="g">◂✕</span><span class="ml">MUTED</span>' : '<span class="g">◂))</span><span class="bar"><i></i></span>';
  };
  /* Mini player (owner call 2026-09-06): the video continues in the Loop-Kick Watch deck from this exact second. */
  el('#vw-mini').onclick = function () {
    var item = { kind: 'vod', id: VID.id || VID.url, title: VID.title, src: VID.src, poster: VID.poster, url: VID.url, creator: VID.creator, duration: VID.duration || 0, time: v.currentTime || 0 };
    if (!item.src) return;
    try { v.pause(); } catch (e) { /* nothing playing */ }
    if (window.SMLLoopKick && window.SMLLoopKick.watch) window.SMLLoopKick.watch(item);
    else { var b = document.getElementById('sml-hf-loop-kick'); if (b) b.click(); }
  };
  el('#vw-fs').onclick = function () { var p = el('.slw-player'); if (document.fullscreenElement) document.exitFullscreen(); else if (p.requestFullscreen) p.requestFullscreen(); };
  paintPlay();
  if (VID.date && !PHASE) el('#vw-ep').textContent = 'UPLOADED ' + upDate(VID.date);

  /* about flip + modal */
  var aboutDeg = 0;
  Array.prototype.forEach.call(root.querySelectorAll('.slw-flipbtn'), function (b) { b.onclick = function () { aboutDeg += 180 * (+b.getAttribute('data-flip')); el('#vw-flip').style.transform = 'rotateY(' + aboutDeg + 'deg)'; }; });
  function openModal() {
    el('#vw-modal').innerHTML = '<div class="slw-modal" id="vw-modal-bg"><div class="slw-modal-c"><div class="slw-modal-h"><b>About this video</b><button class="slw-x" id="vw-mx">Close ✕</button></div>' +
      '<span class="slw-modal-t">' + esc(VID.desc || 'No description.') + '</span>' +
      '<div class="disc"><b>DISCLAIMER</b><span>Videos are for education and information only and are not investment advice or a recommendation to buy or sell any security. Quotes shown may be delayed. Creators speak for themselves.</span></div></div></div>';
    el('#vw-mx').onclick = function () { el('#vw-modal').innerHTML = ''; };
    el('#vw-modal-bg').onclick = function (e) { if (e.target.id === 'vw-modal-bg') el('#vw-modal').innerHTML = ''; };
  }
  el('#vw-more').onclick = openModal; el('#vw-more2').onclick = openModal;

  /* ---------- premiere live chat: the shared live-chat store, room "premiere-{video id}" ---------- */
  (function () {
    if (!PREM.chat) return;
    var box = el('#vw-chat'); if (!box) return;
    var room = PREM.chat, busy = false;
    function stText() { var ph = premPhase(); return ph === 'live' ? 'live now' : (ph === 'upcoming' ? 'open before the start' : 'premiere chat'); }
    box.style.display = '';
    box.innerHTML = '<div class="vw-chat-h"><span class="dot"></span><b>Premiere chat</b><span class="st" id="vw-chat-st">' + stText() + '</span></div>' +
      '<div class="vw-chat-list" id="vw-chat-list"><div class="vw-chat-empty">Be the first to say something.</div></div>' +
      (ME ? '<div class="vw-chat-comp"><input type="text" id="vw-chat-in" maxlength="500" placeholder="Say something to the room" autocomplete="off"><button id="vw-chat-send" type="button">Send</button></div><div class="vw-chat-note" id="vw-chat-note" style="display:none"></div>'
          : '<div class="vw-chat-gate"><a href="/sign-up-sign-in/?redirect_to=' + encodeURIComponent(location.href) + '">Sign in</a> to join the premiere chat.</div>');
    function paint(list) {
      var wrap = el('#vw-chat-list'); if (!wrap || !list.length) return;
      var atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 30;
      wrap.innerHTML = list.map(function (m) {
        var name = String(m.display_name || m.name || 'Member');
        return '<div class="vw-chat-msg' + (m.message_type === 'superchat' ? ' sc' : '') + '"><span class="av">' + (m.avatar ? '<img src="' + esc(m.avatar) + '" alt="">' : esc(name.slice(0, 2).toUpperCase())) + '</span><div class="bd"><b>' + esc(name) + '</b><span class="t">' + esc(relTime(m.created_at)) + '</span><p>' + esc(m.body || m.message || '') + '</p></div></div>';
      }).join('');
      if (atBottom) wrap.scrollTop = wrap.scrollHeight;
    }
    function poll() {
      if (document.hidden) return;
      api('/sml-live-chat/v1/room/' + encodeURIComponent(room) + '/messages?limit=60').then(function (res) {
        var list = (res.j && (res.j.messages || res.j.items)) || [];
        if (list.length) paint(list);
        var st = el('#vw-chat-st'); if (st) st.textContent = stText();
      }).catch(function () {});
    }
    function send() {
      var input = el('#vw-chat-in'); if (!input || busy) return; var text = input.value.trim(); if (!text) return;
      busy = true; el('#vw-chat-send').textContent = '…';
      api('/sml-live-chat/v1/room/' + encodeURIComponent(room) + '/messages', { method: 'POST', body: JSON.stringify({ message: text }) }).then(function (res) {
        busy = false; el('#vw-chat-send').textContent = 'Send';
        var note = el('#vw-chat-note');
        if (res.ok) { input.value = ''; poll(); if (note) note.style.display = 'none'; }
        else if (note) { note.textContent = (res.j && res.j.message) || 'Could not send that.'; note.style.display = ''; }
      }).catch(function () { busy = false; el('#vw-chat-send').textContent = 'Send'; });
    }
    if (ME) { el('#vw-chat-send').onclick = send; el('#vw-chat-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); }); }
    else {
      /* Signed-out visitors can read the chat through a 25% tint; the card asks them to sign up or sign in (owner 2026-09-23). */
      var back = encodeURIComponent(location.pathname + location.search), ph0 = premPhase();
      var lock = document.createElement('div');
      lock.className = 'slw-lock';
      lock.innerHTML = '<div class="slw-lock-card" role="dialog" aria-label="Join the premiere chat">' +
        '<span class="slw-lock-k"><i></i>' + (ph0 === 'upcoming' ? 'PREMIERE CHAT IS OPEN' : (ph0 === 'live' ? 'PREMIERE · LIVE CHAT' : 'PREMIERE CHAT')) + '</span>' +
        '<b class="slw-lock-t">Join the conversation</b>' +
        '<span class="slw-lock-s">' + (ph0 === 'upcoming'
          ? 'Get in early: chat with viewers before the premiere starts, like the video, and be there when it begins.'
          : 'Viewers are talking right now. Chat, react and like the video with a free account.') + '</span>' +
        '<a class="slw-lock-p" href="/register/?redirect_to=' + back + '">Sign up free</a>' +
        '<a class="slw-lock-a" href="/login/?redirect_to=' + back + '">I already have an account</a></div>';
      lock.addEventListener('click', function (e) {
        if (e.target.closest('a')) { try { document.cookie = 'sml_return_to=' + encodeURIComponent(location.pathname + location.search) + ';path=/;max-age=1800;SameSite=Lax'; } catch (err) { /* land on home */ } }
      });
      box.style.position = 'relative';
      box.appendChild(lock);
      var lst = el('#vw-chat-list'); if (lst) lock.style.top = lst.offsetTop + 'px';
    }
    poll();
    setInterval(poll, premPhase() ? 4000 : 12000);
  })();

  /* ---------- orbit ("From the host") — real photos via WP media library, tagged sml-orbit-{creator handle} ---------- */
  var S = { oIdx: 0, oAngle: 0, oPlaying: true, oHover: false, oLightbox: false };
  var ringEl = el('#vw-ring');
  var OITEMS = [], N = 1, R = 290, ocards = ringEl.children;
  function buildOrbit(items) {
    OITEMS = items; N = Math.max(1, OITEMS.length); R = Math.max(290, N * 56);
    S.oIdx = 0; S.oAngle = 0;
    ringEl.innerHTML = OITEMS.map(function (o, i) {
      var media = '<img class="oimg" src="' + esc(o.img) + '" alt="' + esc(o.title || 'Host image') + '">' + (o.title ? '<span class="ocap">' + esc(o.title) + '</span>' : '');
      return '<div class="slw-ocard img" data-oi="' + i + '" role="button" aria-label="' + esc(o.title || 'Host image') + ' — image ' + (i + 1) + ' of ' + N + '">' + media + '</div>';
    }).join('');
    ocards = ringEl.children;
    Array.prototype.forEach.call(ocards, function (c) {
      c.onclick = function () {
        var i = +c.getAttribute('data-oi');
        if (i === S.oIdx) { openLightbox(); return; }
        var delta = ((i - S.oIdx) % N + N) % N; if (delta > N / 2) delta -= N;
        orbStep(delta);
      };
    });
    orbitPaint(false);
  }
  function orbitPaint(smooth) {
    for (var i = 0; i < N; i++) {
      var a = ((((i * (360 / N) - S.oAngle) % 360) + 540) % 360) - 180;
      var d = (Math.cos(a * Math.PI / 180) + 1) / 2;
      var c = ocards[i]; if (!c) continue;
      c.style.transition = smooth ? 'transform 1.05s linear, opacity 1.05s linear, box-shadow 1.05s linear, filter 1.05s linear' : 'transform .8s cubic-bezier(.22,.7,.25,1), opacity .8s ease, box-shadow .8s ease, filter .8s ease';
      c.style.transform = 'rotateY(' + a.toFixed(2) + 'deg) translateZ(' + R + 'px) rotateY(' + (-a * 0.62).toFixed(2) + 'deg) scale(' + (0.74 + 0.26 * d).toFixed(3) + ')';
      c.style.opacity = (0.22 + 0.78 * d).toFixed(2);
      c.style.filter = 'saturate(' + (0.6 + 0.4 * d).toFixed(2) + ') blur(' + ((1 - d) * 1.1).toFixed(2) + 'px)';
      c.style.zIndex = Math.round(d * 100);
      c.classList.toggle('active', i === S.oIdx);
      c.style.boxShadow = 'none';
    }
    var cur = OITEMS[S.oIdx] || { title: '', sub: '', link: '' };
    el('#vw-ocount').textContent = (S.oIdx + 1) + ' / ' + N;
    el('#vw-ocount2').textContent = (S.oIdx + 1) + ' / ' + N;
    el('#vw-otitle').textContent = cur.title || '';
    el('#vw-osub').textContent = cur.sub || '';
    var lk = root.querySelector('.slw-orbit-cap .slw-openlink');
    if (lk) { lk.style.display = cur.link ? '' : 'none'; if (cur.link) lk.href = cur.link; }
  }
  function orbStep(dir) {
    var step = 360 / N, k = Math.round(S.oAngle / step) + dir;
    S.oAngle = k * step; S.oIdx = ((k % N) + N) % N;
    orbitPaint(false);
  }
  el('#vw-oprev').onclick = function () { orbStep(-1); };
  el('#vw-onext').onclick = function () { orbStep(1); };
  el('#vw-opause').onclick = function () {
    S.oPlaying = !S.oPlaying; var b = el('#vw-opause');
    b.classList.toggle('paused', !S.oPlaying); b.innerHTML = S.oPlaying ? '❚❚ Pause' : '▶ Play';
  };
  var orbitEl = el('#vw-orbit');
  orbitEl.addEventListener('mouseenter', function () { S.oHover = true; });
  orbitEl.addEventListener('mouseleave', function () { S.oHover = false; });
  orbitEl.addEventListener('wheel', function (e) {
    e.preventDefault(); orbitEl.__acc = (orbitEl.__acc || 0) + e.deltaY;
    if (Math.abs(orbitEl.__acc) > 55) { orbStep(orbitEl.__acc > 0 ? 1 : -1); orbitEl.__acc = 0; }
  }, { passive: false });
  function openLightbox() {
    S.oLightbox = true;
    var cur = OITEMS[S.oIdx] || { img: '', title: '', sub: '', link: '' };
    var media = '<img src="' + esc(cur.img) + '" alt="' + esc(cur.title || 'Host image') + '" style="max-width:min(82vw,900px);max-height:70vh;width:auto;height:auto;display:block;border-radius:12px;filter:drop-shadow(0 30px 60px rgba(0,0,0,.85))">';
    el('#vw-lb-mount').innerHTML = '<div class="slw-lb" id="vw-lb"><div class="slw-lb-row">' +
      '<button class="slw-lb-nav" id="vw-lbp">‹</button>' + media + '<button class="slw-lb-nav" id="vw-lbn">›</button></div>' +
      '<div class="slw-lb-cap"><b>' + esc(cur.title || '') + '</b><span>' + esc(cur.sub || '') + (cur.sub ? ' · ' : '') + (S.oIdx + 1) + ' / ' + N + '</span></div>' +
      '<div class="slw-lb-btns">' + (cur.link ? '<a class="slw-lb-open" href="' + esc(cur.link) + '" target="_blank" rel="noopener">Open link ↗</a>' : '') + '<button class="slw-btn2" id="vw-lbx">Close (Esc)</button></div></div>';
    el('#vw-lbx').onclick = closeLightbox;
    el('#vw-lbp').onclick = function () { orbStep(-1); openLightbox(); };
    el('#vw-lbn').onclick = function () { orbStep(1); openLightbox(); };
  }
  function closeLightbox() { S.oLightbox = false; el('#vw-lb-mount').innerHTML = ''; }
  el('#vw-oenlarge').onclick = openLightbox;
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    var owns = S.oLightbox || S.oHover || orbitEl.contains(document.activeElement);
    if (!owns) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); orbStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); orbStep(1); }
  });
  setInterval(function () {
    if (S.oPlaying && !S.oHover && !S.oLightbox && !document.hidden && N > 1) {
      var step = 360 / N; S.oAngle += step / 5;
      S.oIdx = ((Math.round(S.oAngle / step) % N) + N) % N;
      orbitPaint(true);
    }
  }, 1000);
  function orbStrip(s2) { var d = document.createElement('div'); d.innerHTML = s2 || ''; return (d.textContent || '').trim(); }
  function orbLink(s2) { var m = orbStrip(s2).match(/https:\/\/\S+/); return m ? m[0] : ''; }
  function loadOrbitFor(handle) {
    if (!handle || loadOrbitFor.done === handle) return;
    loadOrbitFor.done = handle;
    var tag = 'sml-orbit-' + handle;
    fetch('/wp-json/wp/v2/media?search=' + encodeURIComponent(tag) + '&per_page=30&_fields=id,title,caption,description,source_url', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        var items = list.filter(function (m) { return m && m.source_url && m.title && String(m.title.rendered || '').indexOf(tag) === 0; })
          .sort(function (a, b) { return String(a.title.rendered).localeCompare(String(b.title.rendered)); })
          .slice(0, 5)
          .map(function (m) { return { id: m.id, img: m.source_url, title: orbStrip(m.caption && m.caption.rendered), sub: '', link: orbLink(m.description && m.description.rendered) }; });
        if (items.length) { buildOrbit(items); el('#vw-orbit-sec').style.display = ''; }
      }).catch(function () {});
  }

  /* ---------- like + share (reaction engine, long_video set) ---------- */
  var liked = false, CID = null; /* content_id resolves from the rail (numeric id) or falls back to the video slug hash */
  function likeCID() { return CID != null ? CID : VID.id; }
  /* The engine answers /summary with { items: { <numeric id>: { counts, mine } } } — the slug is turned into that id server-side
     (sml-watch-likes), so read the one item back. Reading j.counts made every video show 0 and forget your like on reload.
     Likes work while a premiere is still upcoming; the count stays after it starts. */
  var likeN = 0;
  function paintLikes() { el('#vw-likes').textContent = likeN.toLocaleString(); el('#vw-like').classList.toggle('on', liked); }
  function loadLikes() {
    api('/sml-reactions/v1/summary?content_type=long_video&content_id=' + encodeURIComponent(likeCID())).then(function (res) {
      var items = (res.j && res.j.items) || {};
      var it = Array.isArray(items) ? (items[0] || {}) : (items[Object.keys(items)[0]] || {});
      var counts = it.counts || {};
      likeN = Number(counts.like != null ? counts.like : 0) || 0;
      liked = it.mine === 'like';
      paintLikes();
    }).catch(function () { paintLikes(); });
  }
  el('#vw-like').onclick = function () {
    if (!ME) { if (nudgeLock()) return; gate('Sign in to like this video.'); return; }
    var was = liked;
    liked = !was; likeN = Math.max(0, likeN + (was ? -1 : 1)); paintLikes();
    var undo = function () { liked = was; likeN = Math.max(0, likeN + (was ? 1 : -1)); paintLikes(); };
    api('/sml-reactions/v1/react', { method: 'POST', body: JSON.stringify({ content_type: 'long_video', content_id: likeCID(), reaction: 'like' }) })
      .then(function (res) { if (res.ok) loadLikes(); else { undo(); if (res.status === 401) gate('Sign in to like this video.'); } })
      .catch(undo);
  };
  function nudgeLock() {
    var lock = document.querySelector('#vw-chat .slw-lock'); if (!lock) return false;
    lock.classList.remove('nudge'); void lock.offsetWidth; lock.classList.add('nudge');
    try { lock.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* older browsers */ }
    return true;
  }
  el('#vw-share').onclick = function () {
    var url = VID.url; var b = el('#vw-share');
    var done = function () { b.className = 'slw-share done'; b.innerHTML = '<span class="arm">💪</span> Shared'; };
    if (navigator.share) navigator.share({ title: VID.title, url: url }).then(done).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { done(); gate('Video link copied — paste it anywhere.'); });
  };
  function gate(msg) { var g = el('#vw-cmgate'); g.style.display = ''; g.innerHTML = msg; setTimeout(function () { paintGate(); }, 4000); }

  /* ---------- comments (sml-reactions/v1/comments) ---------- */
  var CM = { items: [], count: 0, sort: 'top', open: {}, page: 1, loggedIn: !!ME, creatorId: 0, focus: (function () { var m = /[?&]c=(\d+)/.exec(location.search); return m ? m[1] : ''; })(), focused: false };
  function cmMap(c) {
    var name = c.author || c.name || c.user || c.display_name || (c.user_name) || 'member';
    return { id: c.id, name: String(name), av: c.avatar || c.avatar_url || '', text: c.text || c.body || c.content || c.comment || '', at: c.at || c.time || c.created || c.date || '', likes: +(c.likes || c.like_count || 0), liked: !!c.liked, reactions: (c.reactions && typeof c.reactions === 'object') ? c.reactions : {}, myReaction: c.my_reaction || '', edited: !!c.edited, mine: !!c.mine, parent: c.parent || c.parent_id || 0, pinned: !!c.pinned, hl: !!c.highlighted, creator: !!c.creator, uid: +(c.user_id || 0), replies: (c.replies || []).map(cmMap) };
  }
  /* emoji reactions — order + glyphs must match sml_cc_reactions() in the mu-plugin */
  var RX = [['like', '👍'], ['love', '❤️'], ['fire', '🔥'], ['laugh', '😂'], ['insight', '💡']];
  function rxEmoji(k) { for (var i = 0; i < RX.length; i++) { if (RX[i][0] === k) return RX[i][1]; } return '👍'; }
  function rxTotal(c) { var n = 0, r = c.reactions || {}; for (var i = 0; i < RX.length; i++) { n += +r[RX[i][0]] || 0; } return n; }
  function rxBar(c) {
    var open = !!CM.open['x' + c.id];
    var mine = c.myReaction || '';
    var trig = '<button class="lk rxt' + (mine ? ' on' : '') + '" data-rx-open="' + esc(c.id) + '" aria-haspopup="true" aria-expanded="' + (open ? 'true' : 'false') + '" title="React">' + (mine ? rxEmoji(mine) : '👍') + '</button>';
    var pick = open ? '<span class="rxpick">' + RX.map(function (p) { return '<button class="rxo' + (mine === p[0] ? ' on' : '') + '" data-rx="' + esc(c.id) + '" data-rxk="' + p[0] + '" title="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</span>' : '';
    var r = c.reactions || {}, sum = '';
    for (var i = 0; i < RX.length; i++) { var n = +r[RX[i][0]] || 0; if (n > 0) { sum += '<button class="rxc' + (mine === RX[i][0] ? ' on' : '') + '" data-rx="' + esc(c.id) + '" data-rxk="' + RX[i][0] + '">' + RX[i][1] + ' ' + n + '</button>'; } }
    return '<span class="rxwrap">' + trig + pick + sum + '</span>';
  }
  function paintGate() {
    var g = el('#vw-cmgate'), comp = el('#vw-cmcomp');
    if (!CM.loggedIn) { g.style.display = ''; g.innerHTML = 'Sign in to join the conversation. <a href="/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname) + '">Sign in</a>'; comp.style.display = 'none'; }
    else { g.style.display = 'none'; comp.style.display = ''; }
  }
  function cmHTML(c, isReply) {
    var avS = c.av && /^https:/.test(c.av) ? ' style="background-image:url(' + esc(c.av) + ')"' : '';
    var ini = avS ? '' : esc(c.name.slice(0, 2).toUpperCase());
    var open = !!CM.open[c.id];
    var editing = !!CM.open['e' + c.id];
    var owner = !!(ME && CM.creatorId && +ME.id === +CM.creatorId);
    var tools = (owner ? '<button class="tl" data-flag="' + (c.pinned ? 'unpin' : 'pin') + '" data-fid="' + esc(c.id) + '">' + (c.pinned ? 'Unpin' : '📌 Pin') + '</button><button class="tl' + (c.hl ? ' on' : '') + '" data-flag="' + (c.hl ? 'unhighlight' : 'highlight') + '" data-fid="' + esc(c.id) + '">' + (c.hl ? '❤ Loved' : '♡ Love') + '</button>' : '') +
      (c.mine ? '<button class="tl" data-eopen="' + esc(c.id) + '">Edit</button>' : '') +
      (owner || c.mine ? '<button class="tl dl" data-flag="delete" data-fid="' + esc(c.id) + '">Delete</button>' : '');
    var textBlock = editing
      ? '<div class="cmedit"><textarea class="cmein" data-ein="' + esc(c.id) + '" maxlength="2000" rows="2">' + esc(c.text) + '</textarea><div class="cmedit-a"><button class="slw-cm-post ready" data-esave="' + esc(c.id) + '">Save</button><button class="cmedit-x" data-ecancel="' + esc(c.id) + '">Cancel</button></div></div>'
      : '<span class="tx">' + esc(c.text) + '</span>' + (c.edited ? '<i class="ed-tag">(edited)</i>' : '');
    var acts = '<div class="acts">' + rxBar(c) +
      (isReply ? '' : '<button class="rp" data-rp="' + esc(c.id) + '">Reply</button>') + tools +
      (!isReply && c.replies.length ? '<button class="tg" data-tg="' + esc(c.id) + '">' + (open ? 'Hide replies' : c.replies.length + (c.replies.length > 1 ? ' replies' : ' reply')) + '</button>' : '') + '</div>';
    return '<div class="' + (isReply ? 'cmr' : 'slw-cmt') + (c.pinned ? ' is-pinned' : '') + (c.hl ? ' is-hl' : '') + (CM.focus === String(c.id) ? ' is-focus' : '') + '" data-cid="' + esc(c.id) + '"><div class="av"' + avS + '>' + ini + '</div><div class="bd">' +
      (c.pinned ? '<div class="pin-tag">📌 Pinned by the creator</div>' : '') +
      '<div class="hd"><b>' + esc(c.name) + '</b>' + (c.creator ? '<i class="cr-tag">CREATOR</i>' : '') + (c.hl ? '<i class="hl-tag">❤ Loved by creator</i>' : '') + '<span>' + esc(relTime(c.at)) + '</span></div>' +
      textBlock + acts +
      (!isReply && (open || CM.open['r' + c.id]) ? '<div class="thread">' + c.replies.map(function (r) { return cmHTML(r, true); }).join('') +
        (CM.open['r' + c.id] ? '<div class="rcomp"><input type="text" data-rin="' + esc(c.id) + '" maxlength="1000" placeholder="Reply to ' + esc(c.name) + '"><button class="slw-cm-post ready" data-rsend="' + esc(c.id) + '">Reply</button></div>' : '') + '</div>' : '') +
      '</div></div>';
  }
  function renderCM() {
    var list = CM.items.slice();
    if (CM.sort === 'top') list.sort(function (a, b) { return (b.likes + b.replies.length * 2) - (a.likes + a.replies.length * 2); });
    else list.sort(function (a, b) { return Date.parse(String(b.at).replace(' ', 'T')) - Date.parse(String(a.at).replace(' ', 'T')); });
    list.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); }); /* the creator's pinned comment always leads */
    el('#vw-cmcount').textContent = CM.count.toLocaleString() + (CM.count === 1 ? ' comment' : ' comments');
    /* preserve any in-progress edit/reply text (and caret/focus) across the wholesale re-render */
    var draft = cmSnapshot();
    el('#vw-cmlist').innerHTML = list.length ? list.map(function (c) { return cmHTML(c, false); }).join('') : '<div class="slw-cm-empty">No comments yet. Start the conversation — the creator reads these.</div>';
    Array.prototype.forEach.call(root.querySelectorAll('.slw-cm-sort'), function (b) { b.classList.toggle('on', b.getAttribute('data-sort') === CM.sort); });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-tg]'), function (b) { b.onclick = function () { var id = b.getAttribute('data-tg'); CM.open[id] = !CM.open[id]; renderCM(); }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-rp]'), function (b) { b.onclick = function () { if (!CM.loggedIn) { gate('Sign in to reply.'); return; } var id = b.getAttribute('data-rp'); CM.open['r' + id] = !CM.open['r' + id]; CM.open[id] = true; renderCM(); var inp = el('[data-rin="' + id + '"]'); if (inp) inp.focus(); }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-rx-open]'), function (b) { b.onclick = function () { if (!CM.loggedIn) { gate('Sign in to react.'); return; } var id = b.getAttribute('data-rx-open'); CM.open['x' + id] = !CM.open['x' + id]; renderCM(); }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-rx]'), function (b) { b.onclick = function () { reactComment(b.getAttribute('data-rx'), b.getAttribute('data-rxk')); }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-flag]'), function (b) { b.onclick = function () { flagComment(b.getAttribute('data-fid'), b.getAttribute('data-flag')); }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-eopen]'), function (b) { b.onclick = function () { if (!CM.loggedIn) { gate('Sign in first.'); return; } var id = b.getAttribute('data-eopen'); CM.open['e' + id] = true; renderCM(); var t = el('[data-ein="' + id + '"]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-ecancel]'), function (b) { b.onclick = function () { CM.open['e' + b.getAttribute('data-ecancel')] = false; renderCM(); }; });
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-esave]'), function (b) {
      b.onclick = function () { var id = b.getAttribute('data-esave'); var t = el('[data-ein="' + id + '"]'); if (t && t.value.trim()) editComment(id, t.value.trim()); };
      var t = el('[data-ein="' + b.getAttribute('data-esave') + '"]'); if (t) t.onkeydown = function (e) { if (e.key === 'Escape') { CM.open['e' + b.getAttribute('data-esave')] = false; renderCM(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.value.trim()) editComment(b.getAttribute('data-esave'), t.value.trim()); };
    });
    if (CM.focus && !CM.focused) { var f = el('#vw-cmlist [data-cid="' + CM.focus + '"]'); if (f) { CM.focused = true; setTimeout(function () { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300); } }
    Array.prototype.forEach.call(el('#vw-cmlist').querySelectorAll('[data-rsend]'), function (b) {
      b.onclick = function () { var id = b.getAttribute('data-rsend'); var inp = el('[data-rin="' + id + '"]'); if (inp && inp.value.trim()) postComment(inp.value.trim(), id); };
      var inp = el('[data-rin="' + b.getAttribute('data-rsend') + '"]'); if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter' && inp.value.trim()) postComment(inp.value.trim(), b.getAttribute('data-rsend')); };
    });
    cmRestore(draft);
  }
  /* snapshot/restore the live text + caret of any open edit/reply input so a re-render never eats it */
  function cmSnapshot() {
    var snap = [], list = el('#vw-cmlist'); if (!list) return snap;
    Array.prototype.forEach.call(list.querySelectorAll('[data-ein],[data-rin]'), function (i) {
      var key = i.hasAttribute('data-ein') ? 'e:' + i.getAttribute('data-ein') : 'r:' + i.getAttribute('data-rin');
      var s = 0, e = 0; try { s = i.selectionStart; e = i.selectionEnd; } catch (x) {}
      snap.push({ key: key, val: i.value, s: s, e: e, foc: document.activeElement === i });
    });
    return snap;
  }
  function cmRestore(snap) {
    if (!snap || !snap.length) return;
    var list = el('#vw-cmlist'); if (!list) return;
    snap.forEach(function (o) {
      var i = list.querySelector((o.key.charAt(0) === 'e' ? '[data-ein="' : '[data-rin="') + o.key.slice(2) + '"]');
      if (!i) return;
      i.value = o.val;
      if (o.foc) { try { i.focus(); i.setSelectionRange(o.s, o.e); } catch (x) {} }
    });
  }
  function loadComments() {
    api('/sml-reactions/v1/comments?content_type=long_video&content_id=' + encodeURIComponent(likeCID()) + '&per_page=50').then(function (res) {
      var j = res.j || {}; var items = (j.items || j.comments || []).map(cmMap);
      if (j.creator_id) CM.creatorId = j.creator_id;
      /* a comment opened from a link stays visible: expand the thread it lives in */
      if (CM.focus) items.forEach(function (c) { if (String(c.id) === CM.focus && c.parent) CM.open[c.parent] = true; });
      /* thread flat lists by parent */
      var byId = {}, roots = [];
      items.forEach(function (c) { byId[c.id] = c; });
      items.forEach(function (c) { if (c.parent && byId[c.parent]) { byId[c.parent].replies.push(c); } else roots.push(c); });
      CM.items = roots; CM.count = j.count != null ? +j.count : items.length;
      renderCM();
    }).catch(function () { renderCM(); });
  }
  function postComment(text, parent) {
    var body = { content_type: 'long_video', content_id: likeCID(), text: text };
    if (parent) body.parent = parent;
    var attempt = function (b, next) {
      api('/sml-reactions/v1/comments', { method: 'POST', body: JSON.stringify(b) }).then(function (res) {
        if (res.ok) { el('#vw-cmin').value = ''; paintPost(); if (parent) CM.open['r' + parent] = false; loadComments(); }
        else if (res.status === 400 && next) next();
        else if (res.status === 401) gate('Sign in to comment.');
        else gate((res.j && res.j.message) || 'Comment did not post — try again.');
      });
    };
    attempt(body, function () { var b2 = Object.assign({}, body); delete b2.text; b2.body = text; attempt(b2, function () { var b3 = Object.assign({}, body); delete b3.text; b3.comment = text; attempt(b3, null); }); });
  }
  /* creator tools (pin / highlight / delete) — mu-plugin sml-creator-comments, also reachable from Creator Studio → Comments */
  function flagComment(id, action) {
    if (action === 'delete' && !window.confirm('Delete this comment?')) return;
    api('/sml-creator-comments/v1/watch-action', { method: 'POST', body: JSON.stringify({ id: id, action: action }) }).then(function (res) {
      if (res.ok) loadComments(); else gate((res.j && res.j.message) || 'That did not work.');
    });
  }
  /* emoji reactions — one per member per comment; same emoji again removes it, a different one switches */
  function reactComment(id, key) {
    if (!CM.loggedIn) { gate('Sign in to react.'); return; }
    CM.open['x' + id] = false;
    api('/sml-reactions/v1/react', { method: 'POST', body: JSON.stringify({ content_type: 'comment', content_id: id, reaction: key || 'like' }) }).then(function (res) {
      if (res.ok) loadComments(); else if (res.status === 401) gate('Sign in to react to comments.'); else { renderCM(); }
    });
  }
  /* edit-your-own — mu-plugin sml-creator-comments watch-action, author only */
  function editComment(id, text) {
    api('/sml-creator-comments/v1/watch-action', { method: 'POST', body: JSON.stringify({ id: id, action: 'edit', text: text }) }).then(function (res) {
      if (res.ok) { CM.open['e' + id] = false; loadComments(); } else if (res.status === 401) gate('Sign in first.'); else gate((res.j && res.j.message) || 'Edit did not save.');
    });
  }
  function paintPost() { var b = el('#vw-cmpost'); var has = !!el('#vw-cmin').value.trim(); b.classList.toggle('ready', has); }
  el('#vw-cmin').addEventListener('input', paintPost);
  el('#vw-cmin').addEventListener('keydown', function (e) { if (e.key === 'Enter' && el('#vw-cmin').value.trim()) postComment(el('#vw-cmin').value.trim(), 0); });
  el('#vw-cmpost').onclick = function () { var t = el('#vw-cmin').value.trim(); if (t) postComment(t, 0); };
  Array.prototype.forEach.call(root.querySelectorAll('.slw-cm-sort'), function (b) { b.onclick = function () { CM.sort = b.getAttribute('data-sort'); renderCM(); }; });
  if (ME && ME.avatar && /^https:/.test(ME.avatar)) { el('#vw-cmav').style.backgroundImage = 'url(' + ME.avatar + ')'; el('#vw-cmav').textContent = ''; }
  paintGate();

  /* ---------- live updates: new comments & replies appear without a reload ---------- */
  /* Never refresh while the viewer is mid-compose — it would clobber an in-progress
     comment/reply. cmBusy() is true when a compose input is FOCUSED, or when a reply input
     holds text. An open edit box is prefilled (never empty), so it counts only while focused —
     otherwise it would block the poll forever; cmSnapshot/cmRestore keep its text safe if a
     refresh does land while it sits open and unfocused. */
  function cmBusy() {
    var a = document.activeElement;
    if (a && (a.id === 'vw-cmin' || (a.hasAttribute && (a.hasAttribute('data-rin') || a.hasAttribute('data-ein'))))) return true;
    var ci = el('#vw-cmin'); if (ci && ci.value.trim()) return true;
    var busy = false, list = el('#vw-cmlist');
    if (list) Array.prototype.forEach.call(list.querySelectorAll('[data-rin]'), function (i) { if (i.value.trim()) busy = true; });
    return busy;
  }
  setInterval(function () { if (!document.hidden && !cmBusy()) loadComments(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !cmBusy()) loadComments(); });

  /* ---------- rail: recommended next from the upload-studio rail ---------- */
  function loadRail() {
    api('/sml-video-upload-studio/v1/rail' + (VID.id ? '?video=' + encodeURIComponent(VID.id) : '')).then(function (res) {
      var j = res.j || {}; var items = (j.up_next || []).concat(j.related || []);
      /* this video's own rail entry gives us views/creator/handle/duration */
      var me = items.filter(function (x) { return x.id === VID.id; })[0];
      if (me) {
        if (me.views != null) el('#vw-views').textContent = Number(me.views).toLocaleString();
        if (me.creator) { VID.creator = me.creator; el('#vw-who').textContent = me.creator; el('#vw-cname').textContent = me.creator; el('#vw-av').textContent = me.creator.slice(0, 2).toUpperCase(); }
        if (me.handle) { el('#vw-cmeta').textContent = '@' + me.handle + (me.ago ? ' · uploaded ' + me.ago : ''); loadOrbitFor(me.handle); }
        if (me.profile_url) { var p = el('#vw-profile'); p.href = me.profile_url; p.style.display = ''; }
        if (me.ticker) { var t = el('#vw-term'); t.textContent = 'Open $' + String(me.ticker).replace(/^\$/, '') + ' terminal →'; t.style.display = ''; t.onclick = function () { location.href = '/stock-chart/?symbol=' + encodeURIComponent(String(me.ticker).replace(/^\$/, '')); }; }
        if (me.duration && !VID.duration) { el('#vw-dur').textContent = me.duration; el('#vw-dur2').textContent = me.duration; }
      }
      var list = items.filter(function (x) { return x.id !== VID.id && x.title && x.watch_url && x.thumbnail && /^https:\/\//i.test(String(x.thumbnail)); }).slice(0, 8);
      el('#vw-rec').innerHTML = list.map(function (x) {
        return '<a class="slw-rv" href="' + esc(x.watch_url) + '" style="text-decoration:none"><div class="th"><div class="ar"></div><div class="ph" style="background-image:url(' + esc(x.thumbnail) + ');background-size:cover;background-position:center"></div>' +
          '<div class="badge">UPLOAD</div>' + (x.duration ? '<div class="dur">' + esc(x.duration) + '</div>' : '') + '</div>' +
          '<div class="bd"><span class="tt">' + esc(x.title) + '</span><div class="mt"><span class="d"></span><span>' + esc((x.views_label || (x.views != null ? Number(x.views).toLocaleString() + ' views' : '')) + (x.ago ? ' · ' + x.ago : '') + (x.creator ? ' · ' + x.creator : '')) + '</span></div></div></a>';
      }).join('') || '<div class="slw-cm-empty">More uploads land here as creators publish.</div>';
      el('#vw-recmeta').textContent = list.length ? list.length + ' picks' : '';
      /* the live desk, if it's on air, leads the rail */
      api('/sml-live/v1/feeds/grandmasterobi').then(function (f) {
        var live = f.j || {};
        var liveThumb = live.thumbnail || live.thumbnail_url || '';
        if (live.live && live.title && live.watch_url && /^https:\/\//i.test(String(liveThumb))) {
          var liveRow = '<a class="slw-rv" href="' + esc(live.watch_url) + '" style="text-decoration:none"><div class="th"><div class="ar"></div><div class="ph" style="background-image:url(' + esc(liveThumb) + ');background-size:cover;background-position:center"></div><div class="badge live">LIVE</div></div><div class="bd"><span class="tt">' + esc(live.title) + '</span><div class="mt"><span class="d live"></span><span>live now</span></div></div></a>';
          el('#vw-rec').insertAdjacentHTML('afterbegin', liveRow);
        }
      }).catch(function () {});
    }).catch(function () { el('#vw-rec').innerHTML = '<div class="slw-cm-empty">Recommendations unavailable right now.</div>'; });
  }
  /* home-group + face cam: honest gating until their data sources exist */
  function loadHomeGroup() {
    /* the creator's home group is a Creator Studio setting that doesn't exist yet;
       when SML_VW_HOME_GROUP is provided by the snippet, render the card */
    var hg = window.SML_VW_HOME_GROUP;
    if (!hg || !hg.url) return;
    el('#vw-hg').innerHTML = '<a class="slw-hg" href="' + esc(hg.url) + '" title="Open ' + esc(hg.name || 'group') + '"><div class="ban"><div class="fr"' + (hg.banner ? ' style="background-image:url(' + esc(hg.banner) + ')"' : '') + '></div><div class="fade"></div>' +
      '<span class="tag">' + esc((VID.creator || 'CREATOR').split(' ')[0].toUpperCase()) + '\'S HOME GROUP</span>' +
      '<div class="row"><b>' + esc(hg.name || '') + '</b><span>' + esc(hg.members ? Number(hg.members).toLocaleString() + ' members' : '') + '</span></div></div>' +
      '<div class="bd"><p>' + esc(hg.desc || '') + '</p><span>Open group →</span></div></a>';
  }
  function loadFaceCam() {
    /* a companion cam track (uploaded alongside the screen recording) — rendered only when present */
    var cam = window.SML_VW_FACECAM;
    if (!cam || !cam.src) return;
    el('#vw-facecam').innerHTML = '<div class="slw-facecam"><div class="fr"><video src="' + esc(cam.src) + '" muted playsinline></video></div><div class="lb"><b>CREATOR CAM</b><span>REC</span></div></div>';
    var cv = el('#vw-facecam video');
    v.addEventListener('play', function () { cv.currentTime = v.currentTime; cv.play().catch(function () {}); });
    v.addEventListener('pause', function () { cv.pause(); });
    v.addEventListener('seeked', function () { cv.currentTime = v.currentTime; });
  }

  loadRail(); loadLikes(); loadComments(); loadHomeGroup(); loadFaceCam();
})();
