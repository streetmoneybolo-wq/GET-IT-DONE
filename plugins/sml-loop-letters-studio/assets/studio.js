/* Loop Letters Studio: a drawer on the writer page for media, look, share card, SEO, checklist, templates and scheduling. */
(function () {
  'use strict';
  var C = window.smlLLStudio || {};
  if (!C.base || document.getElementById('lls-drawer')) { return; }

  /* ---------- which letter is open ---------- */
  var LETTER_ID = null, INFO = null, D = null, dirty = {}, saveTimer = null, checkCache = null;
  var qs = new URLSearchParams(location.search);
  if (qs.get('letter')) { LETTER_ID = qs.get('letter'); }
  (function wrapFetch() {
    var of = window.fetch;
    if (!of || of.__llsWrapped) { return; }
    window.fetch = function (input) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var m = /\/sml-letters\/v1\/letters\/(\d+)\b/.exec(url);
        if (m && m[1] !== LETTER_ID) { LETTER_ID = m[1]; window.setTimeout(onLetterChange, 50); }
      } catch (e) {}
      return of.apply(this, arguments);
    };
    window.fetch.__llsWrapped = true;
  })();

  /* ---------- helpers ---------- */
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (sel, root) { return (root || drawer).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || drawer).querySelectorAll(sel)); };
  var api = function (path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' };
    if (C.nonce) { h['X-WP-Nonce'] = C.nonce; }
    var body;
    if (opts.form) { body = opts.form; } else if (opts.body) { h['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    return fetch((opts.base || C.base) + path, { method: opts.method || (body ? 'POST' : 'GET'), credentials: 'same-origin', cache: 'no-store', headers: h, body: body })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Request failed'); e.data = j; throw e; } return j; }); });
  };
  var get = function (path) { var o = D; path.split('.').forEach(function (k) { o = o == null ? undefined : o[k]; }); return o; };
  var set = function (path, value) {
    var keys = path.split('.'), o = D, p = dirty;
    for (var i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; p[keys[i]] = p[keys[i]] || {}; p = p[keys[i]]; }
    o[keys[keys.length - 1]] = value; p[keys[keys.length - 1]] = value;
    status('Saving…'); window.clearTimeout(saveTimer); saveTimer = window.setTimeout(flush, 650);
  };
  var flush = function () {
    if (!LETTER_ID || !Object.keys(dirty).length) { return Promise.resolve(); }
    var patch = dirty; dirty = {};
    return api('/letter/' + LETTER_ID, { body: patch }).then(function (j) { INFO = j; D = j.data; status('Saved', true); checkCache = null; refreshPreviews(); }).catch(function (e) { status(e.message || 'Save failed', false, true); });
  };
  var status = function (msg, ok, err) { var el = $('#lls-status'); if (el) { el.innerHTML = err ? '<span class="err">' + esc(msg) + '</span>' : ok ? '<b>' + esc(msg) + '</b>' : esc(msg); } };
  var mmss = function (s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
  var mediaDuration = function (file) {
    return new Promise(function (resolve) {
      if (!/^(video|audio)\//.test(file.type)) { resolve(0); return; }
      var el = document.createElement(file.type.indexOf('video') === 0 ? 'video' : 'audio');
      var url = URL.createObjectURL(file);
      var done = function (v) { URL.revokeObjectURL(url); resolve(v); };
      el.preload = 'metadata';
      el.onloadedmetadata = function () { done(isFinite(el.duration) ? el.duration : 0); };
      el.onerror = function () { done(0); };
      window.setTimeout(function () { done(0); }, 6000);
      el.src = url;
    });
  };
  var editorDoc = function () { var t = document.querySelector('[data-title]'), s = document.querySelector('[data-subtitle]'); return { title: t ? t.value : '', subtitle: s ? s.value : '' }; };

  /* ---------- shell ---------- */
  var fab = document.createElement('button');
  fab.id = 'lls-fab'; fab.type = 'button'; fab.innerHTML = '<i></i><span>Studio</span><b id="lls-fab-score"></b>';
  var drawer = document.createElement('aside');
  drawer.id = 'lls-drawer'; drawer.setAttribute('aria-label', 'Letter studio');
  var TABS = [['media', 'Media'], ['look', 'Look'], ['card', 'Share card'], ['seo', 'SEO'], ['check', 'Checklist'], ['templates', 'Templates'], ['publish', 'Publish']];
  drawer.innerHTML = '<div class="lls-d-head"><h3>Letter <span>Studio</span></h3><small id="lls-d-sub"></small><span class="lls-d-sp"></span><button type="button" class="lls-d-close" aria-label="Close">×</button></div>'
    + '<div class="lls-d-tabs">' + TABS.map(function (t, i) { return '<button type="button" data-tab="' + t[0] + '"' + (i === 0 ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>'
    + '<div class="lls-d-body">' + TABS.map(function (t, i) { return '<div class="lls-d-pane' + (i === 0 ? ' on' : '') + '" data-pane="' + t[0] + '"></div>'; }).join('') + '</div>'
    + '<div class="lls-d-foot"><span id="lls-status">Ready</span><span class="lls-d-sp"></span><a id="lls-preview-link" class="lls-btn" target="_blank" rel="noopener" href="#" hidden>Preview</a></div>';
  document.body.appendChild(fab); document.body.appendChild(drawer);
  fab.addEventListener('click', function () { drawer.classList.toggle('open'); if (drawer.classList.contains('open')) { onLetterChange(); } });
  $('.lls-d-close').addEventListener('click', function () { drawer.classList.remove('open'); });
  $('.lls-d-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) { return; }
    $$('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
    $$('.lls-d-pane').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === b.getAttribute('data-tab')); });
    if (b.getAttribute('data-tab') === 'check') { renderCheck(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('open')) { drawer.classList.remove('open'); } });

  function onLetterChange() {
    if (!LETTER_ID) { renderEmpty(); return; }
    if (INFO && String(INFO.id) === String(LETTER_ID)) { return; }
    status('Loading…');
    api('/letter/' + LETTER_ID).then(function (j) { INFO = j; D = j.data; dirty = {}; checkCache = null; renderAll(); status('Ready', true); loadScore(); }).catch(function (e) { status(e.message, false, true); });
  }
  function renderEmpty() {
    $$('.lls-d-pane').forEach(function (p) { p.innerHTML = '<div class="lls-d-empty"><b>Open a letter first</b>Pick a letter from your list, or start a new one, and the Studio attaches to it.</div>'; });
    $('#lls-d-sub').textContent = '';
  }
  function renderAll() {
    $('#lls-d-sub').textContent = '#' + INFO.id + ' · ' + INFO.status;
    var pv = $('#lls-preview-link'); pv.href = INFO.url; pv.hidden = false;
    renderMedia(); renderLook(); renderCard(); renderSeo(); renderTemplates(); renderPublish();
    $('[data-pane="check"]').innerHTML = '<div class="lls-d-empty">Loading checklist…</div>';
  }
  function refreshPreviews() { renderSerp(); renderSocial(); renderCardPreview(); }

  /* ---------- shared controls ---------- */
  var seg = function (path, opts) { var v = get(path); return '<div class="lls-seg" data-seg="' + path + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '"' + (v === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>'; };
  var chips = function (path, opts) { var v = get(path) || []; return '<div class="lls-chips" data-chips="' + path + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '"' + (v.indexOf(o[0]) !== -1 ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>'; };
  var toggle = function (path, label, hint) { return '<div class="lls-toggle"><div>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><button type="button" class="lls-sw' + (get(path) ? ' on' : '') + '" data-toggle="' + path + '" role="switch" aria-checked="' + (get(path) ? 'true' : 'false') + '"></button></div>'; };
  var text = function (path, label, opts) { opts = opts || {}; var v = get(path) || ''; return '<div class="lls-f"><label>' + label + (opts.max ? ' <span data-count="' + path + '">' + String(v).length + '/' + opts.max + '</span>' : '') + '</label>' + (opts.multi ? '<textarea data-f="' + path + '" placeholder="' + esc(opts.ph || '') + '"' + (opts.max ? ' maxlength="' + opts.max + '"' : '') + '>' + esc(v) + '</textarea>' : '<input type="text" data-f="' + path + '" value="' + esc(v) + '" placeholder="' + esc(opts.ph || '') + '"' + (opts.max ? ' maxlength="' + opts.max + '"' : '') + '>') + (opts.hint ? '<div class="hint">' + opts.hint + '</div>' : '') + '</div>'; };
  var color = function (path, label) { var v = get(path) || ''; var sw = ['#38f58a', '#5ad1ff', '#ffb454', '#ff6b6b', '#c084fc', '#f5d90a', '#ffffff']; return '<div class="lls-f"><label>' + label + '</label><div class="lls-color"><input type="color" data-color="' + path + '" value="' + esc(v || '#38f58a') + '"><input type="text" data-f="' + path + '" value="' + esc(v) + '" placeholder="Publication accent"></div><div class="lls-swatches" style="margin-top:8px">' + sw.map(function (c) { return '<button type="button" data-swatch="' + path + '" data-v="' + c + '" style="background:' + c + '"' + (v === c ? ' class="on"' : '') + '></button>'; }).join('') + '</div></div>'; };
  var uploader = function (purpose, label, accept, hint) { return '<label class="lls-up" data-up="' + purpose + '"><input type="file" accept="' + accept + '"><div><b>' + label + '</b><br>' + hint + '</div></label>'; };
  var mediaRow = function (kind, url, meta, clearPath) { if (!url) { return ''; } var thumb = kind === 'video' ? '<video src="' + esc(url) + '" muted playsinline preload="metadata"></video>' : kind === 'audio' ? '' : '<img src="' + esc(url) + '" alt="">'; return '<div class="lls-media">' + thumb + '<div class="meta"><b>' + esc(url.split('/').pop()) + '</b>' + esc(meta || '') + (kind === 'audio' ? '<audio controls preload="none" src="' + esc(url) + '"></audio>' : '') + '</div>' + (clearPath ? '<button type="button" class="x" data-clear="' + clearPath + '" aria-label="Remove">×</button>' : '') + '</div>'; };

  drawer.addEventListener('click', function (e) {
    var t = e.target;
    var b = t.closest('[data-seg] button'); if (b) { var sp = b.parentNode.getAttribute('data-seg'); $$('button', b.parentNode).forEach(function (x) { x.classList.toggle('on', x === b); }); set(sp, b.getAttribute('data-v')); afterSeg(sp, b.getAttribute('data-v')); return; }
    var c = t.closest('[data-chips] button'); if (c) { c.classList.toggle('on'); var cp = c.parentNode.getAttribute('data-chips'); set(cp, $$('button.on', c.parentNode).map(function (x) { return x.getAttribute('data-v'); })); return; }
    var sw = t.closest('[data-toggle]'); if (sw) { var on = !sw.classList.contains('on'); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); set(sw.getAttribute('data-toggle'), on); return; }
    var s = t.closest('[data-swatch]'); if (s) { var p = s.getAttribute('data-swatch'); set(p, s.getAttribute('data-v')); $$('[data-swatch="' + p + '"]').forEach(function (x) { x.classList.toggle('on', x === s); }); var inp = $('[data-f="' + p + '"]'); if (inp) { inp.value = s.getAttribute('data-v'); } var ci = $('[data-color="' + p + '"]'); if (ci) { ci.value = s.getAttribute('data-v'); } return; }
    var x = t.closest('[data-clear]'); if (x) { var cl = x.getAttribute('data-clear'); cl.split(',').forEach(function (k) { set(k, k.indexOf('id') !== -1 ? 0 : ''); }); x.closest('.lls-media').remove(); return; }
    var act = t.closest('[data-act]'); if (act) { actions[act.getAttribute('data-act')](act); }
  });
  drawer.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches('[data-f]')) { var p = t.getAttribute('data-f'); set(p, t.value); var cnt = $('[data-count="' + p + '"]'); if (cnt) { var max = Number(cnt.textContent.split('/')[1]); cnt.textContent = t.value.length + '/' + max; cnt.className = t.value.length > max * 0.95 ? 'warn' : ''; } if (p.indexOf('seo.') === 0 || p.indexOf('card.') === 0) { window.clearTimeout(refreshPreviews.t); refreshPreviews.t = window.setTimeout(refreshPreviews, 250); } return; }
    if (t.matches('[data-color]')) { var cp = t.getAttribute('data-color'); set(cp, t.value); var ti = $('[data-f="' + cp + '"]'); if (ti) { ti.value = t.value; } return; }
  });
  drawer.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('select[data-f]')) { set(t.getAttribute('data-f'), t.value); refreshPreviews(); return; }
    if (t.matches('.lls-up input[type=file]')) { upload(t.closest('.lls-up'), t.files[0]); t.value = ''; }
  });
  $$('.lls-d-body').forEach(function (bodyEl) {
    bodyEl.addEventListener('dragover', function (e) { var u = e.target.closest('.lls-up'); if (u) { e.preventDefault(); u.classList.add('over'); } });
    bodyEl.addEventListener('dragleave', function (e) { var u = e.target.closest('.lls-up'); if (u) { u.classList.remove('over'); } });
    bodyEl.addEventListener('drop', function (e) { var u = e.target.closest('.lls-up'); if (u) { e.preventDefault(); u.classList.remove('over'); if (e.dataTransfer.files[0]) { upload(u, e.dataTransfer.files[0]); } } });
  });
  function afterSeg(path, v) {
    if (path === 'audio.mode' || path === 'immersive.bg_mode' || path === 'card.bg' || path === 'immersive.level') { flush().then(function () { if (path.indexOf('card') === 0) { renderCard(); } else if (path.indexOf('audio') === 0) { renderMedia(); } else { renderLook(); } }); }
  }

  /* ---------- uploads ---------- */
  function upload(box, file) {
    if (!file || !LETTER_ID) { return; }
    var purpose = box.getAttribute('data-up');
    var limits = { intro: 40, audio: 60, bg: 25, cover: 12, cardbg: 12, poster: 12 };
    if (file.size > (limits[purpose] || 12) * 1048576) { status('That file is over ' + limits[purpose] + ' MB.', false, true); return; }
    box.classList.add('busy'); status('Checking ' + file.name + '…');
    mediaDuration(file).then(function (seconds) {
      if (purpose === 'intro' && seconds > 15.6) { box.classList.remove('busy'); status('Intro videos are 15 seconds or less. Yours is ' + mmss(seconds) + '. Trim it and try again.', false, true); return; }
      if (purpose === 'intro' && !seconds) { status('Could not read the video length; uploading anyway.'); }
      var fd = new FormData(); fd.append('file', file); fd.append('purpose', purpose); fd.append('seconds', String(seconds || 0));
      status('Uploading ' + file.name + '…');
      return api('/letter/' + LETTER_ID + '/upload', { form: fd }).then(function (j) {
        D = j.data; status('Uploaded', true); checkCache = null;
        if (purpose === 'cover') { var ce = document.querySelector('[data-cover-url]'); if (ce) { ce.value = j.url; ce.dispatchEvent(new Event('input', { bubbles: true })); } }
        if (purpose === 'cardbg') { renderCard(); } else if (purpose === 'bg') { renderLook(); } else { renderMedia(); }
        if (purpose === 'cover') { renderCardPreview(); renderSocial(); }
      }).catch(function (e) { status(e.message || 'Upload failed', false, true); }).then(function () { box.classList.remove('busy'); });
    });
  }

  /* ---------- panes ---------- */
  function renderMedia() {
    var intro = get('intro') || {}, audio = get('audio') || {}, cover = get('cover') || {};
    var coverUrl = cover.url || INFO.cover_url || '';
    var pane = $('[data-pane="media"]');
    pane.innerHTML = '<div class="lls-f"><b>Cover image</b>' + uploader('cover', 'Drop a cover image', 'image/*', 'JPG, PNG or WebP · 1200 × 630 or larger. This is the image search engines and social feeds show.') + mediaRow('image', coverUrl, '', 'cover.url,cover.id') + '</div>'
      + '<div class="lls-f"><b>15 second intro video</b><div class="hint" style="margin:-2px 0 8px">Plays once when a reader opens the letter, then the letter appears. Sound starts muted; the reader taps to hear it. Crawlers never see it, so it never hurts indexing.</div>'
      + uploader('intro', 'Drop an intro clip', 'video/mp4,video/webm,video/quicktime', 'MP4 or WebM · 15 seconds max · under 40 MB. Vertical or widescreen both work.')
      + mediaRow('video', intro.url, intro.seconds ? mmss(intro.seconds) + ' long' : '', 'intro.url,intro.id,intro.seconds')
      + (intro.url ? toggle('intro.enabled', 'Show the intro', 'Turn off to keep the clip but skip it for readers.') + uploader('poster', 'Optional poster frame', 'image/*', 'Shown while the clip loads. Same size as the cover.') + mediaRow('image', intro.poster, '', 'intro.poster') : '') + '</div>'
      + '<div class="lls-f"><b>Audio</b><div class="hint" style="margin:-2px 0 8px">A voice read of the letter, or a song from YouTube by link. Only the sound plays; nothing else from the video appears.</div>'
      + seg('audio.mode', [['none', 'None'], ['upload', 'Upload voice'], ['youtube', 'YouTube link']]) + '</div>'
      + (audio.mode === 'upload' ? uploader('audio', 'Drop your audio', 'audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac,.m4a,.mp3,.wav,.ogg', 'MP3, M4A, WAV or OGG · under 60 MB. Record it on your phone and read the letter in your own voice.') + mediaRow('audio', audio.url, audio.seconds ? mmss(audio.seconds) : '', 'audio.url,audio.id,audio.seconds') : '')
      + (audio.mode === 'youtube' ? text('audio.youtube', 'YouTube link', { ph: 'https://www.youtube.com/watch?v=…', hint: 'Paste the video link. Readers get a play button and hear the track; the video itself stays hidden.' }) : '')
      + (audio.mode !== 'none' ? text('audio.title', 'Track title', { ph: audio.mode === 'youtube' ? 'Soundtrack for this letter' : 'Listen to this letter', max: 120 }) + toggle('audio.autoplay', 'Start after the intro', 'Only when the reader already pressed play on the intro sound; browsers block silent autoplay otherwise.') : '');
  }
  function renderLook() {
    var pane = $('[data-pane="look"]'), imm = get('immersive') || {};
    pane.innerHTML = '<div class="lls-f"><b>Immersion</b><div class="hint" style="margin:-2px 0 8px">The same motion layer as the profile pages: particles, shapes and 3D objects behind the letter, reacting to the audio and the scroll. Everything stays behind the text and switches off for readers who asked their device for less motion.</div>'
      + seg('immersive.level', [['off', 'Off'], ['calm', 'Calm'], ['alive', 'Alive'], ['max', 'Max']]) + '</div>'
      + (imm.level && imm.level !== 'off' ? '<div class="lls-f"><label>Effects</label>' + chips('immersive.effects', [['particles', 'Particles'], ['aurora', 'Aurora'], ['grid', 'Grid floor'], ['orbs', 'Orbs'], ['rain', 'Rain'], ['ticker', 'Ticker tape'], ['scan', 'Scan line'], ['spotlight', 'Cursor light'], ['noise', 'Film noise']]) + '</div>'
        + '<div class="lls-f"><label>2D shapes</label>' + chips('immersive.shapes', [['rings', 'Rings'], ['triangles', 'Triangles'], ['squares', 'Squares'], ['hex', 'Hexagons'], ['lines', 'Lines'], ['candles', 'Candles']]) + '</div>'
        + '<div class="lls-f"><label>3D objects</label>' + chips('immersive.objects', [['cube', 'Cube'], ['sphere', 'Sphere'], ['torus', 'Torus'], ['pyramid', 'Pyramid'], ['octa', 'Octahedron'], ['coin', 'Coin'], ['bull', 'Bull']]) + '</div>'
        + '<div class="lls-f"><label>Texture</label>' + seg('immersive.texture', [['none', 'None'], ['grain', 'Grain'], ['paper', 'Paper'], ['carbon', 'Carbon'], ['mesh', 'Mesh']]) + '</div>'
        + color('immersive.accent', 'Accent colour')
        + '<div class="lls-f"><label>Background</label>' + seg('immersive.bg_mode', [['none', 'None'], ['cover', 'Cover image'], ['image', 'Upload image'], ['video', 'Upload video']]) + '</div>'
        + (imm.bg_mode === 'image' || imm.bg_mode === 'video' ? uploader('bg', imm.bg_mode === 'video' ? 'Drop a background loop' : 'Drop a background image', imm.bg_mode === 'video' ? 'video/mp4,video/webm' : 'image/*', imm.bg_mode === 'video' ? 'Short silent MP4 or WebM, under 25 MB. It loops behind the letter.' : 'A wide image, under 25 MB. It sits behind a dark scrim so the text stays readable.') + mediaRow(imm.bg_mode === 'video' ? 'video' : 'image', imm.bg_url, '', 'immersive.bg_url,immersive.bg_id') : '')
        + toggle('immersive.pulse', 'Pulse with the audio', 'The headline glows and the layer breathes on the beat when a reader plays the voice or the track.')
        : '')
      + '<div class="lls-f" style="margin-top:18px"><b>Reader tools</b>'
      + toggle('reader.toc', 'Table of contents', 'Built from your headings. Readers jump; search engines see structure.')
      + toggle('reader.levels_card', 'Levels in the side rail', 'The first two levels blocks pinned beside the letter.')
      + toggle('reader.reactions', 'Reactions', 'Bullish, bearish, fire, smart. One tap, no sign-in, counted once per reader.')
      + toggle('reader.highlights', 'Highlight to share', 'Selecting a sentence offers a quote card for X or the clipboard.')
      + toggle('reader.subscribe_box', 'Subscribe box', 'Under the letter, with your publication copy.')
      + toggle('reader.next_issue', 'Previous and next issue', 'Keeps readers inside your publication.')
      + toggle('reader.share_bar', 'Share bar', 'X, Threads, LinkedIn, copy link and the share card download.')
      + '</div>';
  }
  function renderCard() {
    var pane = $('[data-pane="card"]'), card = get('card') || {};
    pane.innerHTML = '<div id="lls-card-prev" class="lls-card-prev"></div><div class="lls-card-ratios" id="lls-card-ratios"></div>'
      + '<div class="lls-row" style="margin-bottom:16px"><button type="button" class="lls-btn primary" data-act="card">Generate card</button><button type="button" class="lls-btn" data-act="card-copy">Copy image link</button></div>'
      + '<div class="lls-f"><label>Layout</label>' + seg('card.template', [['headline', 'Headline'], ['chart', 'Chart'], ['levels', 'Levels'], ['quote', 'Quote']]) + '<div class="hint">Chart draws the first ticker\'s last three months. Levels uses your first levels block. Quote uses your first quote block or the summary.</div></div>'
      + '<div class="lls-f"><label>Theme</label>' + seg('card.theme', [['dark', 'Dark'], ['green', 'Green'], ['slate', 'Slate'], ['ink', 'Paper']]) + '</div>'
      + text('card.kicker', 'Kicker', { ph: INFO.publication.name, max: 60 })
      + text('card.title', 'Card headline', { ph: INFO.title, max: 140, hint: 'Leave empty to use the letter title.' })
      + text('card.subtitle', 'Card subtitle', { ph: INFO.subtitle || 'One line under the headline', max: 160 })
      + color('card.accent', 'Accent colour')
      + '<div class="lls-f"><label>Background</label>' + seg('card.bg', [['cover', 'Cover image'], ['upload', 'Upload'], ['none', 'Plain']]) + '</div>'
      + (card.bg === 'upload' ? uploader('cardbg', 'Drop a card background', 'image/*', 'Any wide image. It is darkened so the headline reads.') + mediaRow('image', card.bg_url, '', 'card.bg_url,card.bg_id') : '')
      + toggle('card.show_tickers', 'Ticker chips') + toggle('card.show_price', 'Live price change on the chips', 'Fetched when you generate, so regenerate before you post.') + toggle('card.show_avatar', 'Your avatar or logo');
    renderCardPreview();
  }
  var ratio = 'wide';
  function renderCardPreview() {
    var prev = $('#lls-card-prev'), rat = $('#lls-card-ratios'); if (!prev || !rat) { return; }
    var imgs = (get('card.images')) || {};
    var have = imgs.wide || imgs.standard || imgs.square;
    rat.innerHTML = [['wide', '1200 × 630'], ['standard', '1200 × 900'], ['square', '1200 × 1200']].map(function (r) { return '<a href="' + esc(imgs[r[0]] || '#') + '" data-ratio="' + r[0] + '" ' + (imgs[r[0]] ? 'download target="_blank"' : '') + ' class="' + (ratio === r[0] ? 'on' : '') + '">' + r[1] + '</a>'; }).join('');
    $$('[data-ratio]', rat).forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); ratio = a.getAttribute('data-ratio'); renderCardPreview(); }); });
    prev.style.aspectRatio = ratio === 'wide' ? '1200/630' : ratio === 'standard' ? '1200/900' : '1/1';
    prev.innerHTML = have && imgs[ratio] ? '<img src="' + esc(imgs[ratio]) + '?v=' + esc(get('card.hash') || '') + '" alt="Share card preview">' : (have ? 'This ratio has not been rendered yet. Generate again.' : 'No card yet. Set the layout and press Generate card.');
  }
  function renderSeo() {
    var pane = $('[data-pane="seo"]');
    var types = [['NewsArticle', 'News article'], ['AnalysisNewsArticle', 'Analysis'], ['OpinionNewsArticle', 'Opinion'], ['ReportageNewsArticle', 'Reportage'], ['Article', 'Article'], ['BlogPosting', 'Blog post']];
    pane.innerHTML = '<div id="lls-serp" class="lls-serp"></div>'
      + text('seo.meta_title', 'Search title', { ph: INFO.title, max: 70, hint: 'What Google shows. Lead with the ticker or the claim. Empty uses the letter title.' })
      + text('seo.meta_desc', 'Description', { ph: 'One concrete sentence a searcher would click.', max: 160, multi: true })
      + text('seo.keyword', 'Focus phrase', { ph: 'NVDA earnings preview', max: 80, hint: 'The phrase a reader types. Use it once in the title, the description and the first paragraph.' })
      + text('seo.news_keywords', 'News keywords', { ph: 'Nvidia, semiconductors, options', max: 200, hint: 'Up to ten, comma separated. Sent as news_keywords to Google News.' })
      + '<div class="lls-f"><label>Schema type</label><select data-f="seo.schema_type">' + types.map(function (t) { return '<option value="' + t[0] + '"' + (get('seo.schema_type') === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select><div class="hint">News article is the right default for a dated market letter. Opinion and Analysis are News subtypes and still qualify for Google News.</div></div>'
      + '<div id="lls-social" class="lls-social-prev"></div>'
      + text('seo.og_title', 'Social title', { ph: INFO.title, max: 90 }) + text('seo.og_desc', 'Social description', { ph: 'Shown under the card on X, LinkedIn and Discord.', max: 200, multi: true })
      + toggle('seo.noindex', 'Hide from search engines', 'For a letter you do not want indexed. Readers with the link still see it.')
      + '<div class="lls-note" style="margin-top:16px">Every published letter carries NewsArticle schema with your byline, the share image in three ratios, canonical URL, the publication feed, and sits in the news sitemap for 48 hours and the full sitemap after. Bing and Yahoo are pinged through IndexNow the moment you publish.</div>';
    renderSerp(); renderSocial();
  }
  function renderSerp() {
    var el = $('#lls-serp'); if (!el) { return; }
    var doc = editorDoc();
    var t = get('seo.meta_title') || doc.title || INFO.title || 'Letter title';
    var d = get('seo.meta_desc') || INFO.subtitle || 'Write a description so Google does not pick one for you.';
    el.innerHTML = '<div class="u">' + esc(INFO.url.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</div><div class="t">' + esc(t) + '</div><div class="d">' + esc(new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' — ' + d) + '</div>';
  }
  function renderSocial() {
    var el = $('#lls-social'); if (!el) { return; }
    var doc = editorDoc(), imgs = get('card.images') || {};
    var img = imgs.wide || (get('cover.url')) || INFO.cover_url || '';
    el.innerHTML = (img ? '<img src="' + esc(img) + '" alt="">' : '<div style="aspect-ratio:1200/630;display:grid;place-items:center;color:#6f7f92">No share image yet</div>') + '<div><small>' + esc(location.host) + '</small><b>' + esc(get('seo.og_title') || get('seo.meta_title') || doc.title || INFO.title) + '</b><span>' + esc(get('seo.og_desc') || get('seo.meta_desc') || INFO.subtitle || '') + '</span></div>';
  }
  function loadScore() {
    if (!LETTER_ID) { return; }
    api('/letter/' + LETTER_ID + '/check').then(function (j) { checkCache = j; var fs = $('#lls-fab-score'); fs.textContent = j.score + '%'; fab.classList.toggle('lls-fab-score-good', j.score >= 80); if ($('[data-tab="check"]').classList.contains('on')) { renderCheck(); } }).catch(function () {});
  }
  function renderCheck() {
    var pane = $('[data-pane="check"]'); if (!INFO) { return; }
    var draw = function (j) {
      pane.innerHTML = '<div class="lls-score"><div class="ring" style="--p:' + j.score + '"><b>' + j.score + '</b></div><div class="txt"><b>' + (j.score >= 80 ? 'Ready for search and social' : j.score >= 55 ? 'Nearly there' : 'Needs work before it travels') + '</b><span>' + j.words + ' words · ' + j.read_minutes + ' min read · readability ' + j.flesch + '</span></div><span class="lls-d-sp"></span><button type="button" class="lls-btn" data-act="recheck">Refresh</button></div>'
        + '<ul class="lls-check">' + j.items.map(function (it) { return '<li class="' + it.level + (it.ok ? ' ok' : '') + '"><i>' + (it.ok ? '✓' : '!') + '</i><div><b>' + esc(it.label) + '</b><span>' + esc(it.hint) + '</span></div></li>'; }).join('') + '</ul>';
    };
    if (checkCache) { draw(checkCache); return; }
    pane.innerHTML = '<div class="lls-d-empty">Checking…</div>';
    api('/letter/' + LETTER_ID + '/check').then(function (j) { checkCache = j; $('#lls-fab-score').textContent = j.score + '%'; draw(j); }).catch(function (e) { pane.innerHTML = '<div class="lls-d-empty">' + esc(e.message) + '</div>'; });
  }

  /* ---------- templates: inserted through the editor's own buttons so autosave sees them ---------- */
  var TEMPLATES = [
    { name: 'Morning brief', what: 'What moved overnight, three things to watch, one level that matters. Five minutes to write, every day.', tag: 'daily', blocks: [
      ['heading', 'What moved overnight'], ['paragraph', 'Futures, the dollar, yields and the one headline that matters, in four sentences.'],
      ['heading', 'Three things I am watching today'], ['list', 'First setup and why\nSecond setup and why\nThe risk event on the calendar'],
      ['heading', 'The level that matters'], ['levels', { symbol: 'SPY', entry: '', stop: '', timeframe: 'Today' }],
      ['paragraph', 'How I will trade it: the trigger, the invalidation, the size.'], ['disclosure', { position: 'no position', size: '' }] ] },
    { name: 'Trade idea', what: 'One ticker, the thesis, the levels, the catalyst, the risk. The format readers forward.', tag: 'single ticker', blocks: [
      ['heading', 'The setup in one line'], ['paragraph', 'What the chart and the flow are saying about $TICKER right now.'],
      ['ticker_card', { symbol: 'NVDA' }], ['chart', { symbol: 'NVDA', range: '3M' }],
      ['heading', 'Why now'], ['paragraph', 'The catalyst, the timing, the positioning. Numbers, not adjectives.'],
      ['heading', 'The plan'], ['levels', { symbol: 'NVDA', entry: '', stop: '', timeframe: 'Swing' }], ['alert_button', { symbol: 'NVDA', trigger: 'above', price: '' }],
      ['heading', 'What would make me wrong'], ['paragraph', 'The invalidation and what I do when it hits.'], ['disclosure', { position: 'long NVDA', size: 'starter' }] ] },
    { name: 'Earnings preview', what: 'Expectations, the expected move, three scenarios, how you are positioned.', tag: 'event', blocks: [
      ['heading', 'The numbers the street expects'], ['list', 'Revenue consensus and whisper\nEPS consensus and whisper\nGuidance range'],
      ['heading', 'The expected move'], ['paragraph', 'What the options market is pricing, the last eight reactions, and whether that is cheap or rich.'],
      ['heading', 'Three scenarios'], ['list', 'Beat and raise: where it goes and what I do\nIn line: the trap\nMiss: the level I buy'],
      ['chart', { symbol: 'NVDA', range: '6M' }], ['heading', 'How I am positioned'], ['disclosure', { position: 'no position', size: '' }] ] },
    { name: 'Weekly outlook', what: 'Sunday letter: the week that was, the calendar ahead, the sectors in play, the watchlist.', tag: 'weekly', blocks: [
      ['heading', 'The week that was'], ['paragraph', 'What worked, what did not, and the one lesson.'],
      ['heading', 'The calendar ahead'], ['list', 'Monday\nTuesday\nWednesday\nThursday\nFriday'],
      ['heading', 'Sectors in play'], ['paragraph', 'Where the money rotated and whether it holds.'],
      ['heading', 'The watchlist'], ['watchlist_button', { symbols: ['SPY', 'QQQ', 'NVDA'] }], ['paragraph', 'One sentence on each name and the level that puts it in play.'],
      ['paywall_marker'], ['heading', 'For paying readers: my positions and orders'], ['paragraph', 'Full book, sizes and the orders working this week.'] ] },
    { name: 'Deep dive', what: 'Long form on one company or theme: the business, the numbers, the bear case, the valuation, the verdict.', tag: 'long form', blocks: [
      ['heading', 'The short version'], ['paragraph', 'The thesis in three sentences, so the skimmer gets it too.'],
      ['heading', 'The business'], ['paragraph', 'How it makes money and what actually drives the margin.'],
      ['heading', 'The numbers'], ['list', 'Growth\nMargins\nCash flow\nBalance sheet'],
      ['heading', 'The bear case'], ['paragraph', 'Steelman it. Readers trust a letter that argues against itself.'],
      ['heading', 'Valuation'], ['paragraph', 'What you pay, what you get, versus the peers.'],
      ['heading', 'Verdict'], ['quote', 'The one sentence a reader should remember.'], ['disclosure', { position: 'no position', size: '' }] ] },
    { name: 'Post-mortem', what: 'A trade that went wrong, what the plan was, what happened, what changes. The most-read letters are honest ones.', tag: 'lesson', blocks: [
      ['heading', 'The plan'], ['paragraph', 'Entry, stop, target, the reason.'], ['heading', 'What happened'], ['paragraph', 'The tape, minute by minute if it matters.'],
      ['heading', 'What I got wrong'], ['list', 'The thing I saw and ignored\nThe size\nThe timing'], ['heading', 'What changes'], ['paragraph', 'The rule I am adding and how readers can use it.'] ] }
  ];
  function renderTemplates() {
    var pane = $('[data-pane="templates"]');
    pane.innerHTML = '<div class="lls-note">Templates add blocks at the end of the letter through the editor, so autosave sees them. Fill the brackets, delete what you do not need.</div><div class="lls-tpl">' + TEMPLATES.map(function (t, i) { return '<button type="button" data-act="tpl" data-i="' + i + '"><b>' + t.name + '</b><span>' + t.what + '</span><small>' + t.blocks.length + ' blocks · ' + t.tag + '</small></button>'; }).join('') + '</div>';
  }
  function insertTemplate(t) {
    var root = document.getElementById('le-root'); if (!root || !root.querySelector('[data-add]')) { status('Open the letter editor first.', false, true); return; }
    var i = 0;
    var step = function () {
      if (i >= t.blocks.length) { status('Template added', true); return; }
      var b = t.blocks[i++]; var type = b[0], fill = b[1];
      var btn = root.querySelector('[data-add="' + type + '"]'); if (!btn) { step(); return; }
      btn.click();
      window.setTimeout(function () {
        var blocks = root.querySelectorAll('.le-block'); var host = blocks[blocks.length - 1]; if (!host) { step(); return; }
        var fire = function (el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
        if (typeof fill === 'string') { var ta = host.querySelector('[data-txt],[data-list]'); if (ta) { fire(ta, fill); } }
        else if (fill && typeof fill === 'object') { Object.keys(fill).forEach(function (k) { var inp = host.querySelector(k === 'symbols' ? '[data-symbols]' : '[data-f="' + k + '"]'); if (inp) { fire(inp, Array.isArray(fill[k]) ? fill[k].join(', ') : fill[k]); } }); }
        step();
      }, 40);
    };
    step();
  }

  /* ---------- publish pane ---------- */
  function renderPublish() {
    var pane = $('[data-pane="publish"]');
    var now = new Date(Date.now() + 3600000); now.setMinutes(0, 0, 0);
    var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    pane.innerHTML = '<div class="lls-f"><b>Schedule</b><div class="hint" style="margin:-2px 0 8px">Pick the moment it goes out. Weekday mornings before the open are read most; Sunday evening works for weekly letters. The site time zone is ' + esc(C.tz || 'UTC') + '.</div>'
      + '<input type="datetime-local" id="lls-when" value="' + local + '" min="' + local + '"><div class="lls-row" style="margin-top:8px"><button type="button" class="lls-btn primary" data-act="schedule">Schedule</button></div><div class="hint" id="lls-sched-note"></div></div>'
      + '<div class="lls-f"><b>After publishing</b><div class="lls-kv">'
      + '<b>Canonical</b><a href="' + esc(INFO.url) + '" target="_blank" rel="noopener">' + esc(INFO.url) + '</a>'
      + '<b>News sitemap</b><a href="' + esc(INFO.sitemaps.news) + '" target="_blank" rel="noopener">' + esc(INFO.sitemaps.news.replace(C.home, '/')) + '</a>'
      + '<b>Full sitemap</b><a href="' + esc(INFO.sitemaps.full) + '" target="_blank" rel="noopener">' + esc(INFO.sitemaps.full.replace(C.home, '/')) + '</a>'
      + '<b>Letters feed</b><a href="' + esc(INFO.sitemaps.feed) + '" target="_blank" rel="noopener">' + esc(INFO.sitemaps.feed.replace(C.home, '/')) + '</a>'
      + '</div></div>'
      + '<div class="lls-note">Publishing pings IndexNow (Bing, Yahoo, DuckDuckGo and partners) with the letter URL and refreshes both sitemaps. Google News and Discover pick up the news sitemap on their own crawl; the one-time step that helps most is adding the site in Google Publisher Center and listing the news sitemap in Search Console.</div>'
      + (C.isAdmin ? '<div class="lls-row"><button type="button" class="lls-btn" data-act="ping">Resubmit latest 20 to IndexNow</button></div><div class="hint" id="lls-ping-note"></div>' : '');
  }

  var actions = {
    card: function (btn) {
      btn.disabled = true; status('Rendering three ratios…');
      flush().then(function () { return api('/letter/' + LETTER_ID + '/card', { body: { force: true } }); })
        .then(function (j) { D = j.data; status(j.cached ? 'Card unchanged' : 'Card rendered', true); renderCardPreview(); renderSocial(); checkCache = null; loadScore(); })
        .catch(function (e) { status(e.message || 'Could not render', false, true); }).then(function () { btn.disabled = false; });
    },
    'card-copy': function (btn) { var imgs = get('card.images') || {}; var u = imgs[ratio] || imgs.wide; if (!u) { status('Generate the card first.', false, true); return; } (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.resolve()).then(function () { status('Image link copied', true); }); },
    recheck: function () { checkCache = null; renderCheck(); loadScore(); },
    tpl: function (btn) { insertTemplate(TEMPLATES[Number(btn.getAttribute('data-i'))]); },
    schedule: function (btn) {
      var when = $('#lls-when').value, note = $('#lls-sched-note'); if (!when) { return; }
      var iso = new Date(when).toISOString();
      btn.disabled = true; note.textContent = 'Scheduling…';
      flush().then(function () { return api('/letters/' + LETTER_ID + '/publish', { base: C.lettersBase, body: { schedule_at: iso } }); })
        .then(function (j) { note.textContent = 'Scheduled for ' + new Date(j.schedule_at || iso).toLocaleString() + '. The site publishes it, pings IndexNow and refreshes the sitemaps on its own.'; INFO.status = 'scheduled'; $('#lls-d-sub').textContent = '#' + INFO.id + ' · scheduled'; })
        .catch(function (e) { note.textContent = (e.data && e.data.data && e.data.data.issues ? e.data.data.issues.join(' ') : e.message) || 'Could not schedule.'; })
        .then(function () { btn.disabled = false; });
    },
    ping: function (btn) { btn.disabled = true; api('/ping', { body: {} }).then(function (j) { $('#lls-ping-note').textContent = 'Submitted ' + j.submitted + ' URLs. IndexNow answered ' + (j.indexnow && j.indexnow.code ? j.indexnow.code : 'n/a') + '.'; }).catch(function (e) { $('#lls-ping-note').textContent = e.message; }).then(function () { btn.disabled = false; }); }
  };

  /* keep the SERP preview honest while the writer types in the editor itself */
  document.addEventListener('input', function (e) { if (e.target.matches && (e.target.matches('[data-title]') || e.target.matches('[data-subtitle]'))) { window.clearTimeout(renderSerp.t); renderSerp.t = window.setTimeout(function () { renderSerp(); renderSocial(); }, 300); } });
  window.addEventListener('beforeunload', function () { if (Object.keys(dirty).length) { flush(); } });

  /* arriving from a letter's Edit link: open that letter in the editor list once it renders */
  if (qs.get('letter')) {
    var tries = 0, want = qs.get('letter');
    var openIt = function () {
      var row = document.querySelector('[data-open="' + want + '"]');
      if (row) { row.click(); drawer.classList.add('open'); return; }
      if (++tries < 40) { window.setTimeout(openIt, 250); }
    };
    openIt();
  }
  if (LETTER_ID) { onLetterChange(); } else { renderEmpty(); }
})();
