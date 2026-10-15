/* Loop Letters reader: intro video, audio dock, table of contents, reactions, highlights, sharing, subscribe. */
(function () {
  'use strict';
  var S = window.smlLLS || {};
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var api = function (path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' };
    if (opts.body) { h['Content-Type'] = 'application/json'; }
    if (S.nonce) { h['X-WP-Nonce'] = S.nonce; }
    return fetch(S.base + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { throw new Error(j.message || 'Request failed'); } return j; }); });
  };
  var setKick = function (v) { document.documentElement.style.setProperty('--lls-kick', String(Math.max(0, Math.min(1, v)))); };
  document.documentElement.classList.add('lls-html');

  /* ---------- intro video: plays once per session, the article is underneath the whole time ---------- */
  (function intro() {
    var box = $('lls-intro'), video = $('lls-intro-video');
    if (!box || !video) { return; }
    var key = 'lls-intro-' + S.letterId;
    var seen = false;
    try { seen = !!sessionStorage.getItem(key); } catch (e) {}
    if (seen || reduced) { box.remove(); return; }
    var done = false, timer = null;
    var finish = function () {
      if (done) { return; }
      done = true;
      try { sessionStorage.setItem(key, '1'); } catch (e) {}
      box.classList.add('leaving');
      document.body.classList.remove('lls-intro-open');
      try { video.pause(); } catch (e) {}
      window.setTimeout(function () { box.remove(); }, 520);
      document.dispatchEvent(new CustomEvent('lls:intro-done'));
    };
    box.hidden = false;
    document.body.classList.add('lls-intro-open');
    var cap = Math.min(16, Math.max(2, (S.intro && S.intro.seconds) || 15)) * 1000;
    var bar = $('lls-intro-progress');
    var tick = function () { if (video.duration) { bar.style.width = Math.min(100, (video.currentTime / Math.min(video.duration, 16)) * 100) + '%'; } };
    video.addEventListener('timeupdate', function () { tick(); if (video.currentTime >= 16) { finish(); } });
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    timer = window.setTimeout(finish, cap + 2500);
    $('lls-intro-skip').addEventListener('click', finish);
    var sound = $('lls-intro-sound');
    sound.addEventListener('click', function () {
      video.muted = !video.muted;
      sound.classList.toggle('on', !video.muted);
      sound.textContent = video.muted ? 'Sound on' : 'Sound off';
    });
    var p = video.play();
    if (p && p.catch) { p.catch(function () { window.clearTimeout(timer); window.setTimeout(finish, 1200); }); }
  })();

  /* ---------- progress bar (the base script also draws one; this keeps it accurate with the intro) ---------- */

  /* ---------- table of contents from the headings ---------- */
  (function toc() {
    var nav = $('lls-toc'), list = $('lls-toc-list'), article = $('lp-article');
    if (!nav || !list || !article) { return; }
    var heads = $$('h2, h3', article);
    if (heads.length < 2) { return; }
    var items = [];
    heads.forEach(function (h, i) {
      if (!h.id) { h.id = 'sec-' + (i + 1) + '-' + (h.textContent || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
      var li = document.createElement('li');
      var a = document.createElement('a'); a.href = '#' + h.id; a.textContent = h.textContent;
      if (h.tagName === 'H3') { li.style.paddingLeft = '10px'; }
      li.appendChild(a); list.appendChild(li); items.push({ h: h, li: li });
    });
    nav.hidden = false;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { items.forEach(function (it) { it.li.classList.toggle('on', it.h === en.target); }); } });
      }, { rootMargin: '-80px 0px -70% 0px' });
      items.forEach(function (it) { io.observe(it.h); });
    }
  })();

  /* ---------- live quotes in chips and rail (the base script fills data-lp-sym; this adds colour) ---------- */
  (function quotes() {
    var syms = (S.tickers || []).slice(0, 12);
    if (!syms.length || !S.quotes) { return; }
    fetch(S.quotes + '?symbols=' + encodeURIComponent(syms.join(','))).then(function (r) { return r.json(); }).then(function (j) {
      var q = (j && j.quotes) || {};
      $$('[data-lp-sym]').forEach(function (el) {
        var d = q[el.getAttribute('data-lp-sym')]; var em = el.querySelector('em');
        if (!d || !em || !d.last) { return; }
        var pct = Number(d.pct || 0);
        em.textContent = (d.last >= 1000 ? d.last.toFixed(0) : d.last.toFixed(2)) + ' ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
        em.classList.toggle('up', pct >= 0); em.classList.toggle('down', pct < 0);
      });
    }).catch(function () {});
  })();

  /* ---------- audio dock ---------- */
  (function audio() {
    var dock = $('lls-audio');
    if (!dock) { return; }
    var mode = dock.getAttribute('data-mode');
    var play = $('lls-audio-play'), fill = $('lls-audio-fill'), track = $('lls-audio-track'), wave = $('lls-audio-wave'), rate = $('lls-audio-rate'), vol = $('lls-audio-vol');
    var bars = [];
    if (wave) { for (var i = 0; i < 9; i++) { var b = document.createElement('span'); wave.appendChild(b); bars.push(b); } }
    var playing = false, raf = null;
    var paint = function (level, spectrum) {
      bars.forEach(function (b, i) { var v = spectrum ? spectrum[i] : (level * (0.5 + 0.5 * Math.sin(Date.now() / 160 + i))); b.style.height = Math.max(12, Math.min(100, v * 100)) + '%'; });
    };
    var idle = function () { paint(0.18); setKick(0); };
    idle();

    if (mode === 'upload') {
      var el = $('lls-audio-el'); if (!el) { return; }
      var ctx = null, analyser = null, data = null;
      var connect = function () {
        if (ctx || reduced) { return; }
        try {
          var AC = window.AudioContext || window.webkitAudioContext; if (!AC) { return; }
          ctx = new AC(); var src = ctx.createMediaElementSource(el); analyser = ctx.createAnalyser(); analyser.fftSize = 64; analyser.smoothingTimeConstant = 0.72;
          src.connect(analyser); analyser.connect(ctx.destination); data = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) { ctx = null; }
      };
      var loop = function () {
        if (!playing) { return; }
        if (analyser) {
          analyser.getByteFrequencyData(data);
          var spec = []; for (var i = 0; i < 9; i++) { spec.push(data[Math.min(data.length - 1, i * 2 + 1)] / 255); }
          var low = (data[1] + data[2] + data[3]) / (3 * 255);
          paint(0, spec); setKick(Math.pow(low, 1.6));
        } else { paint(0.6); setKick(0.3 + 0.3 * Math.abs(Math.sin(Date.now() / 300))); }
        if (el.duration) { fill.style.width = (el.currentTime / el.duration * 100) + '%'; }
        raf = window.requestAnimationFrame(loop);
      };
      play.addEventListener('click', function () {
        if (playing) { el.pause(); return; }
        connect(); if (ctx && ctx.state === 'suspended') { ctx.resume(); }
        el.play().catch(function () {});
      });
      el.addEventListener('play', function () { playing = true; dock.classList.add('playing'); play.setAttribute('aria-label', 'Pause'); loop(); document.dispatchEvent(new CustomEvent('lls:audio', { detail: { playing: true } })); });
      el.addEventListener('pause', function () { playing = false; dock.classList.remove('playing'); play.setAttribute('aria-label', 'Play'); window.cancelAnimationFrame(raf); idle(); document.dispatchEvent(new CustomEvent('lls:audio', { detail: { playing: false } })); });
      el.addEventListener('ended', function () { fill.style.width = '0%'; });
      track.addEventListener('click', function (e) { var r = track.getBoundingClientRect(); if (el.duration) { el.currentTime = el.duration * ((e.clientX - r.left) / r.width); } });
      var rates = [1, 1.25, 1.5, 2, 0.8], ri = 0;
      rate.addEventListener('click', function () { ri = (ri + 1) % rates.length; el.playbackRate = rates[ri]; rate.textContent = rates[ri] + '×'; });
      if (S.audio && S.audio.autoplay && !reduced) { document.addEventListener('lls:intro-done', function () { el.play().catch(function () {}); }, { once: true }); }
      return;
    }

    if (mode === 'youtube') {
      /* audio only: a 1-pixel player off screen, driven by postMessage, same as the profile pages */
      var yt = dock.getAttribute('data-yt'), frame = null, ready = false, muted = false, pos = 0, dur = 0, poll = null;
      var send = function (func, args) { if (frame && frame.contentWindow) { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*'); } };
      var mount = function () {
        if (frame) { return; }
        frame = document.createElement('iframe');
        frame.setAttribute('allow', 'autoplay; encrypted-media');
        frame.setAttribute('title', 'Letter soundtrack');
        frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;border:0';
        frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(yt) + '?enablejsapi=1&controls=0&playsinline=1&rel=0&loop=1&playlist=' + encodeURIComponent(yt) + '&origin=' + encodeURIComponent(location.origin);
        document.body.appendChild(frame);
        frame.addEventListener('load', function () { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'lls' }), '*'); ready = true; });
      };
      window.addEventListener('message', function (e) {
        if (!frame || e.source !== frame.contentWindow) { return; }
        var d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (er) { return; }
        if (!d) { return; }
        if (d.event === 'infoDelivery' && d.info) {
          if (d.info.currentTime != null) { pos = d.info.currentTime; }
          if (d.info.duration) { dur = d.info.duration; }
          if (d.info.playerState != null) { var st = d.info.playerState; var was = playing; playing = st === 1 || st === 3; if (was !== playing) { dock.classList.toggle('playing', playing); document.dispatchEvent(new CustomEvent('lls:audio', { detail: { playing: playing } })); } }
        }
      });
      var animate = function () {
        if (playing) { paint(0.55 + 0.25 * Math.abs(Math.sin(Date.now() / 220))); setKick(0.25 + 0.35 * Math.abs(Math.sin(Date.now() / 480))); if (dur) { fill.style.width = (pos / dur * 100) + '%'; } }
        else { idle(); }
        raf = window.requestAnimationFrame(animate);
      };
      animate();
      play.addEventListener('click', function () {
        mount();
        if (playing) { send('pauseVideo'); return; }
        var go = function () { send('setVolume', [80]); send(muted ? 'mute' : 'unMute'); send('playVideo'); };
        if (ready) { go(); } else { frame.addEventListener('load', function () { window.setTimeout(go, 400); }, { once: true }); }
      });
      if (vol) { vol.addEventListener('click', function () { muted = !muted; send(muted ? 'mute' : 'unMute'); vol.style.opacity = muted ? '.45' : '1'; }); }
      track.addEventListener('click', function (e) { var r = track.getBoundingClientRect(); if (dur) { send('seekTo', [dur * ((e.clientX - r.left) / r.width), true]); } });
    }
  })();

  /* ---------- reactions ---------- */
  (function reactions() {
    var box = $('lls-react'); if (!box) { return; }
    var mine = '';
    var render = function (counts) { $$('[data-react]', box).forEach(function (b) { var k = b.getAttribute('data-react'); b.classList.toggle('on', k === mine); var n = b.querySelector('[data-count]'); if (n && counts && counts[k] != null) { n.textContent = counts[k]; } }); };
    api('/letter/' + S.letterId + '/public').then(function (j) { mine = j.mine || ''; render(j.counts); }).catch(function () {});
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-react]'); if (!b) { return; }
      var k = b.getAttribute('data-react');
      mine = mine === k ? '' : k; render(null); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      api('/letter/' + S.letterId + '/react', { body: { kind: k } }).then(function (j) { mine = j.mine || ''; render(j.counts); }).catch(function () {});
    });
  })();

  /* ---------- share ---------- */
  var shareUrl = function (via) { var u = new URL(S.url || location.href); u.searchParams.set('ref', via); return u.toString(); };
  var openShare = function (kind, text) {
    var t = text || S.title || document.title, u = shareUrl(kind);
    var map = {
      x: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u),
      threads: 'https://www.threads.net/intent/post?text=' + encodeURIComponent(t + ' ' + u),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u)
    };
    if (map[kind]) { window.open(map[kind], '_blank', 'noopener,width=640,height=560'); }
  };
  var copy = function (text, btn) {
    var ok = function () { if (btn) { var old = btn.textContent; btn.textContent = 'Copied'; btn.classList.add('done'); window.setTimeout(function () { btn.textContent = old; btn.classList.remove('done'); }, 1600); } };
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(ok, ok); } else { ok(); }
  };
  (function share() {
    var bar = $('lls-share');
    if (bar) { bar.addEventListener('click', function (e) { var b = e.target.closest('[data-share]'); if (!b || b.tagName === 'A') { return; } var k = b.getAttribute('data-share'); if (k === 'copy') { copy(shareUrl('copy'), b); } else { openShare(k); } }); }
    var top = $('lls-share-top');
    if (top) { top.addEventListener('click', function () {
      if (navigator.share) { navigator.share({ title: S.title, text: S.title, url: shareUrl('share') }).catch(function () {}); }
      else { copy(shareUrl('copy'), top); }
    }); }
  })();

  /* ---------- highlight to share a quote ---------- */
  (function highlights() {
    if (!S.reader || !S.reader.highlights) { return; }
    var article = $('lp-article'), pop = $('lls-quote-pop'); if (!article || !pop) { return; }
    var current = '';
    var hide = function () { pop.hidden = true; };
    var show = function () {
      var sel = window.getSelection(); if (!sel || sel.isCollapsed) { hide(); return; }
      var text = String(sel.toString()).trim();
      if (text.length < 12 || text.length > 320 || !article.contains(sel.anchorNode)) { hide(); return; }
      var r = sel.getRangeAt(0).getBoundingClientRect();
      current = text;
      pop.hidden = false;
      pop.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
      pop.style.top = (r.top + window.scrollY - 8) + 'px';
    };
    document.addEventListener('selectionchange', function () { window.clearTimeout(show.t); show.t = window.setTimeout(show, 180); });
    document.addEventListener('mousedown', function (e) { if (!pop.contains(e.target)) { hide(); } });
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-quote]'); if (!b) { return; }
      var q = '“' + current + '” ' + (S.publication ? '- ' + S.publication : '');
      if (b.getAttribute('data-quote') === 'x') { openShare('x', q); } else { copy(q + ' ' + shareUrl('quote'), b); }
      hide();
    });
  })();

  /* ---------- subscribe ---------- */
  (function subscribe() {
    var form = $('lls-subscribe-form'), note = $('lls-subscribe-note'); if (!form) { return; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form), btn = form.querySelector('button');
      var body = { handle: fd.get('handle'), email: fd.get('email'), source: fd.get('source') || 'letter-page', letter_id: S.letterId };
      btn.disabled = true; note.className = 'lls-subscribe-note'; note.textContent = 'One moment.';
      fetch(S.subscribe, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { throw new Error(j.message || 'Could not subscribe'); } return j; }); })
        .then(function (j) { note.className = 'lls-subscribe-note ok'; note.textContent = j.message || 'Check your inbox to confirm.'; form.reset(); })
        .catch(function (er) { note.className = 'lls-subscribe-note err'; note.textContent = er.message || 'Could not subscribe.'; })
        .then(function () { btn.disabled = false; });
    });
  })();

  /* read, scroll and completion beacons are sent by the base letters script already loaded on this page */
})();
