/* Loop Channels: answers the channel app's API calls from the page, places the banner and background,
   swaps the server paint for the app once it has mounted, and runs the creator's Design studio. */
(function () {
  'use strict';
  var C = window.SML_LC; if (!C) { return; }
  var D = C.design || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. the API answers are already here ---------- */
  (function shim() {
    var pre = C.preload || {}, used = {};
    var keys = Object.keys(pre); if (!keys.length) { return; }
    var norm = function (u) { try { var a = new URL(u, location.origin); var p = a.pathname.replace(/^\/wp-json/, ''); var h = a.searchParams.get('handle'); return p + (h ? '?handle=' + h : ''); } catch (e) { return String(u); } };
    var of = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = (init && init.method) || 'GET';
        if (method === 'GET' && /\/wp-json/.test(url)) {
          var k = norm(url);
          if (pre[k] !== undefined && !used[k]) {
            used[k] = true;
            return Promise.resolve(new Response(JSON.stringify(pre[k]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
  })();

  /* ---------- 2. when the app has mounted, move our layers into place and retire the first paint ---------- */
  var app = { mounted: false, failed: false };
  function placeBanner() {
    var banner = $('#sml-lc-banner'), root = $('#sml-ch-root'), nav = root && root.querySelector('.lch-nav');
    if (!banner || !root || !nav) { return; }
    if (banner.parentNode !== root) { nav.insertAdjacentElement('afterend', banner); }
  }
  function adopt() {
    /* the legacy stylesheet hides every body child except its root: our layers live inside the root from here on */
    var root = $('#sml-ch-root'); if (!root) { return; }
    var bg = $('#sml-lc-bg'); if (bg && bg.parentNode !== root) { root.insertBefore(bg, root.firstChild); }
    ['#sml-lc-fab', '#sml-lc-studio'].forEach(function (s) { var el = $(s); if (el && el.parentNode !== root) { root.appendChild(el); } });
    placeBanner();
  }
  function watch() {
    var root = $('#sml-ch-root'), t0 = Date.now();
    var tick = function () {
      var body = root && root.querySelector('.lch-body');
      var sync = root && root.querySelector('#ch-sync');
      if (body && !app.mounted) {
        app.mounted = true; adopt();
        document.documentElement.classList.add('lc-app-on');
        mountFx();
      }
      if (sync && /UNAVAILABLE/i.test(sync.textContent || '') && !app.failed) {
        app.failed = true; document.documentElement.classList.remove('lc-app-on'); document.documentElement.classList.add('lc-app-failed'); document.body.classList.remove('lch-on');
      }
      if (!app.mounted && Date.now() - t0 > 9000) { document.documentElement.classList.add('lc-app-failed'); document.body.classList.remove('lch-on'); return; }
      if (Date.now() - t0 < 15000) { window.setTimeout(tick, app.mounted ? 500 : 60); }
    };
    tick();
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', watch); } else { watch(); }
  window.addEventListener('scroll', function () { document.documentElement.style.setProperty('--lc-scroll', String(window.scrollY)); }, { passive: true });

  /* ---------- 3. immersive layer, borrowed from Loop Letters ---------- */
  var fxLoaded = false;
  function mountFx() {
    var fx = D.effects || {};
    if (!C.fx || !fx.level || fx.level === 'off' || reduced) { return; }
    var bg = $('#sml-lc-bg'); if (bg) { bg.hidden = false; if (!bg.querySelector('#lls-fx-canvas')) { var cv = document.createElement('canvas'); cv.id = 'lls-fx-canvas'; cv.className = 'lc-fx-canvas'; bg.appendChild(cv); } }
    document.body.classList.add('lc-fx');
    if (fxLoaded) { return; } fxLoaded = true;
    window.smlLLS = { immersive: { level: fx.level, effects: fx.effects || [], shapes: fx.shapes || [], objects: fx.objects || [], pulse: !!fx.pulse }, accent: cssVar('--lc-accent'), tickers: C.tickers || [] };
    var s = document.createElement('script'); s.src = C.fx; s.defer = true; document.body.appendChild(s);
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  /* ---------- 4. design, applied live ---------- */
  var RADIUS = { sharp: '4px', soft: '12px', round: '22px' }, WIDTH = { narrow: '1100px', standard: '1420px', wide: '1720px' }, BH = { short: '160px', medium: '260px', tall: '380px' };
  function hexRgb(h) { h = String(h || '').replace('#', ''); if (h.length !== 6) { return '0,255,136'; } return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16); }
  function varsCss(d) {
    var p = C.presets[d.preset] || C.presets.midnight, accent = d.accent || C.accent || '#00ff88', font = d.font || cssVarFont();
    var fontv = (font.indexOf(' ') > -1 ? "'" + font + "'" : font) + ',system-ui,sans-serif';
    var css = ':root{--lc-bg:' + p.bg + ';--lc-surface:' + p.surface + ';--lc-surface2:' + p.surface2 + ';--lc-line:' + p.line + ';--lc-text:' + p.text + ';--lc-text2:' + p.text2 + ';--lc-muted:' + p.muted + ';--lc-accent:' + accent + ';--lc-accent-rgb:' + hexRgb(accent) + ';--lc-accent2:' + p.accent2 + ';--lc-font:' + fontv + ';--lc-radius:' + (RADIUS[d.radius] || '12px') + ';--lc-width:' + (WIDTH[d.width] || '1420px') + ';--lc-banner-h:' + (BH[d.banner.height] || '260px') + ';--lc-banner-fit:' + d.banner.fit + ';--lc-banner-pos:' + d.banner.position + ';--lc-bg-blur:' + (d.background.blur | 0) + 'px;--lc-bg-dim:' + ((d.background.dim | 0) / 100) + '}';
    css += 'body.lch-on{background:var(--lc-bg)!important}#sml-ch-root{--accent:var(--lc-accent)!important;--chfont:var(--lc-font)!important;max-width:none}#sml-ch-root .lch-body{max-width:var(--lc-width)}';
    (d.layout.order || []).forEach(function (k, i) { css += '#ch-' + k + ',#sml-lc-' + k + (k === 'playlists' ? ',#ch-playlists' : '') + '{order:' + (i + 1) + '}'; });
    (d.layout.hidden || []).forEach(function (k) { css += '#ch-' + k + (k === 'playlists' ? ',#ch-playlists' : '') + '{display:none!important}'; });
    return css;
  }
  var fontMemo = '';
  function cssVarFont() { if (!fontMemo) { fontMemo = (cssVar('--lc-font').split(',')[0] || 'Archivo').replace(/^'|'$/g, ''); } return fontMemo; }
  var legacyCss = null;
  function themedCss(preset) {
    var p = C.presets[preset]; if (!p || preset === 'midnight' || !legacyCss) { return ''; }
    var map = { '#04060a': p.bg, '#05080d': p.bg, '#080c12': p.bg, '#0a121b': p.surface, '#0a0d13': p.surface, '#0b1119': p.surface, '#0d1a15': p.surface, '#0d151f': p.surface2, '#101c26': p.surface2, '#0a1420': p.surface2, '#081420': p.surface2, '#0d2030': p.surface2, '#16202b': p.line, '#1c2833': p.line, '#131c26': p.line, '#10161f': p.line, '#101923': p.line, '#20303f': p.line, '#2a3a49': p.line, '#1b3a4d': p.line, '#e6edf3': p.text, '#fff': p.text, '#ffffff': p.text, '#c7d6e3': p.text2, '#8fa3b5': p.text2, '#a8dcf0': p.text2, '#5d7085': p.muted, '#4c5d6d': p.muted, '#3d4f5f': p.muted, '#00ccff': p.accent2, '#7ae6ff': p.accent2 };
    var out = legacyCss.replace(/#[0-9a-fA-F]{3,6}\b/g, function (m) { return map[m.toLowerCase()] || m; });
    if (p.light) { out = out.replace(/rgba\((?:4,6,10|7,11,16|8,12,18)\s*,\s*([0-9.]+)\)/g, 'rgba(255,255,255,$1)'); }
    return out;
  }
  function bodyClasses(d) {
    var b = document.body, p = C.presets[d.preset] || {};
    b.className = b.className.replace(/\blc-(preset|radius|sidebar|videos)-[a-z]+\b/g, '').replace(/\blc-(light|has-banner|has-bg|bg-fixed|fx)\b/g, '').replace(/\s+/g, ' ');
    b.classList.add('lc-preset-' + d.preset, 'lc-radius-' + d.radius, 'lc-sidebar-' + d.layout.sidebar, 'lc-videos-' + d.layout.videos);
    if (p.light) { b.classList.add('lc-light'); }
    if (d.banner.mode !== 'none') { b.classList.add('lc-has-banner'); }
    if (d.background.mode !== 'none') { b.classList.add('lc-has-bg'); if (d.background.fixed) { b.classList.add('lc-bg-fixed'); } }
    if (d.effects.level && d.effects.level !== 'off') { b.classList.add('lc-fx'); }
    var tc = $('meta[name="theme-color"]'); if (tc && p.bg) { tc.setAttribute('content', p.bg); }
  }
  function bannerHtml(d) {
    var b = d.banner; if (b.mode === 'none') { return ''; }
    var inner = '';
    if (b.mode === 'image' && b.url) { inner = '<img class="lc-banner-media" src="' + esc(b.url) + '" alt="">'; }
    else if (b.mode === 'video' && b.url) { inner = '<video class="lc-banner-media" autoplay muted loop playsinline' + (b.poster ? ' poster="' + esc(b.poster) + '"' : '') + ' src="' + esc(b.url) + '"></video>'; }
    else if (b.mode === 'gradient') { inner = '<div class="lc-banner-media lc-banner-gradient"></div>'; }
    var text = b.overlay ? '<div class="lc-banner-text"><b>' + esc(b.title || C.name) + '</b>' + (b.subtitle ? '<span>' + esc(b.subtitle) + '</span>' : '') + '</div>' : '';
    return inner + '<div class="lc-banner-fade"></div>' + text;
  }
  function bgHtml(d) {
    var bg = d.background, src = bg.mode === 'banner' ? d.banner.url : bg.url, inner = '';
    if ((bg.mode === 'image' || bg.mode === 'banner') && src) { inner = '<div class="lc-bg-media" style="background-image:url(' + esc(src) + ')"></div>'; }
    else if (bg.mode === 'video' && src) { inner = '<video class="lc-bg-media" autoplay muted loop playsinline src="' + esc(src) + '"></video>'; }
    else if (bg.mode === 'pattern') { inner = '<div class="lc-bg-media lc-pattern-' + esc(bg.pattern) + '"></div>'; }
    return inner + '<div class="lc-bg-dim"></div><canvas id="lls-fx-canvas" class="lc-fx-canvas"></canvas>';
  }
  function applyDesign(d, opts) {
    opts = opts || {};
    var st = $('#sml-lc-vars'); if (st) { st.textContent = varsCss(d); }
    bodyClasses(d);
    var banner = $('#sml-lc-banner');
    if (d.banner.mode === 'none') { if (banner) { banner.remove(); } }
    else {
      if (!banner) { banner = document.createElement('div'); banner.id = 'sml-lc-banner'; var ssr = $('#sml-lc-ssr'); if (ssr) { ssr.insertBefore(banner, ssr.firstChild); } else { document.body.insertBefore(banner, document.body.firstChild); } }
      banner.className = 'lc-banner lc-banner-' + d.banner.height;
      if (opts.banner !== false) { banner.innerHTML = bannerHtml(d); }
      placeBanner();
    }
    var bg = $('#sml-lc-bg');
    if (bg) { bg.hidden = d.background.mode === 'none' && !(d.effects.level && d.effects.level !== 'off'); bg.className = 'lc-bg lc-bg-' + d.background.mode; if (opts.bg !== false) { bg.innerHTML = bgHtml(d); } }
    if (opts.preset) {
      var th = $('#sml-lc-theme');
      var apply = function () { var css = themedCss(d.preset); if (!th) { th = document.createElement('style'); th.id = 'sml-lc-theme'; var ch = $('#sml-ch-css'); (ch ? ch.parentNode : document.head).insertBefore(th, ch ? ch.nextSibling : null); } th.textContent = css; };
      if (legacyCss === null) { var link = $('#sml-ch-css'); fetch(link ? link.href : '').then(function (r) { return r.text(); }).then(function (t) { legacyCss = t; apply(); }).catch(function () { legacyCss = ''; }); } else { apply(); }
    }
    if (d.effects.level && d.effects.level !== 'off') { if (window.smlLLS) { window.smlLLS.immersive = { level: d.effects.level, effects: d.effects.effects || [], shapes: d.effects.shapes || [], objects: d.effects.objects || [], pulse: !!d.effects.pulse }; } if (app.mounted) { mountFx(); } }
    if (opts.font && d.font) { var id = 'lc-font-' + d.font.replace(/\W+/g, '-'); if (!document.getElementById(id)) { var l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(d.font) + ':wght@400;600;700;800&display=swap'; document.head.appendChild(l); } }
  }

  /* ---------- 5. Design studio (owner only) ---------- */
  if (!C.owner) { return; }
  var api = function (path, opts) {
    opts = opts || {}; var h = { Accept: 'application/json', 'X-WP-Nonce': C.nonce }; var body;
    if (opts.form) { body = opts.form; } else if (opts.body) { h['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    return fetch(C.base + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: h, body: body }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { throw new Error(j.message || 'Request failed'); } return j; }); });
  };
  var saveTimer = null, dirty = false;
  function status(msg, ok, err) { var el = $('#lcs-status'); if (el) { el.innerHTML = err ? '<span class="err">' + esc(msg) + '</span>' : ok ? '<b>' + esc(msg) + '</b>' : esc(msg); } }
  function save() { dirty = true; status('Saving…'); window.clearTimeout(saveTimer); saveTimer = window.setTimeout(function () { api('/design', { body: D }).then(function (j) { D = j.design; C.design = D; dirty = false; status('Saved. Signed-out visitors see it within five minutes.', true); }).catch(function (e) { status(e.message, false, true); }); }, 600); }
  function set(path, value, opts) { var keys = path.split('.'), o = D; for (var i = 0; i < keys.length - 1; i++) { o = o[keys[i]] = o[keys[i]] || {}; } o[keys[keys.length - 1]] = value; applyDesign(D, opts || {}); save(); }
  function get(path) { var o = D; path.split('.').forEach(function (k) { o = o == null ? undefined : o[k]; }); return o; }

  var fab = document.createElement('button'); fab.id = 'sml-lc-fab'; fab.type = 'button'; fab.innerHTML = '<i></i><span>Design channel</span>';
  var drawer = document.createElement('aside'); drawer.id = 'sml-lc-studio'; drawer.setAttribute('aria-label', 'Channel design');
  var TABS = [['theme', 'Theme'], ['banner', 'Banner'], ['background', 'Background'], ['layout', 'Layout'], ['effects', 'Effects'], ['seo', 'Search']];
  drawer.innerHTML = '<div class="lcs-head"><h3>Channel <span>design</span></h3><span class="lcs-sp"></span><button type="button" class="lcs-close" aria-label="Close">×</button></div><div class="lcs-tabs">' + TABS.map(function (t, i) { return '<button type="button" data-tab="' + t[0] + '"' + (i === 0 ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div><div class="lcs-body" id="lcs-body"></div><div class="lcs-foot"><span id="lcs-status">Changes show here at once and save on their own.</span></div>';
  document.body.appendChild(fab); document.body.appendChild(drawer);
  var tab = 'theme';
  fab.addEventListener('click', function () { drawer.classList.toggle('open'); if (drawer.classList.contains('open')) { render(); } });
  $('.lcs-close', drawer).addEventListener('click', function () { drawer.classList.remove('open'); });
  $('.lcs-tabs', drawer).addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (!b) { return; } tab = b.getAttribute('data-tab'); $$('[data-tab]', drawer).forEach(function (x) { x.classList.toggle('on', x === b); }); render(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { drawer.classList.remove('open'); } });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  var seg = function (path, opts) { var v = get(path); return '<div class="lcs-seg" data-seg="' + path + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '"' + (v === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>'; };
  var chips = function (path, opts) { var v = get(path) || []; return '<div class="lcs-chips" data-chips="' + path + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '"' + (v.indexOf(o[0]) !== -1 ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>'; };
  var toggle = function (path, label, hint) { var on = !!get(path); return '<div class="lcs-toggle"><div>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><button type="button" class="lcs-sw' + (on ? ' on' : '') + '" data-toggle="' + path + '" role="switch" aria-checked="' + on + '"></button></div>'; };
  var text = function (path, label, ph, max) { return '<div class="lcs-f"><label>' + label + '</label><input type="text" data-f="' + path + '" value="' + esc(get(path) || '') + '" placeholder="' + esc(ph || '') + '"' + (max ? ' maxlength="' + max + '"' : '') + '></div>'; };
  var range = function (path, label, min, max, unit) { return '<div class="lcs-f"><label>' + label + ' <span>' + esc(get(path)) + (unit || '') + '</span></label><input type="range" data-range="' + path + '" min="' + min + '" max="' + max + '" value="' + esc(get(path)) + '"></div>'; };
  var up = function (kind, label, accept, hint) { return '<label class="lcs-up" data-up="' + kind + '"><input type="file" accept="' + accept + '"><div><b>' + label + '</b><br>' + hint + '</div></label>'; };
  var media = function (url, kind, isVideo) { if (!url) { return ''; } return '<div class="lcs-media">' + (isVideo ? '<video src="' + esc(url) + '" muted playsinline preload="metadata"></video>' : '<img src="' + esc(url) + '" alt="">') + '<div class="meta">' + esc(url.split('/').pop()) + '</div><button type="button" class="x" data-remove="' + kind + '" aria-label="Remove">×</button></div>'; };

  function render() {
    var body = $('#lcs-body'), h = '';
    if (tab === 'theme') {
      h += '<div class="lcs-f"><label>Preset</label><div class="lcs-presets">' + Object.keys(C.presets).map(function (k) { var p = C.presets[k]; return '<button type="button" class="lcs-preset' + (D.preset === k ? ' on' : '') + '" data-preset="' + k + '" style="--p-bg:' + p.bg + ';--p-surface:' + p.surface + ';--p-line:' + p.line + ';--p-accent:' + (D.accent || C.accent) + ';--p-text:' + p.text + '"><span>' + esc(p.label) + '</span></button>'; }).join('') + '</div><div class="hint">Every surface, line and text colour on the channel follows the preset. Paper and Snow are light themes.</div></div>';
      var sw = ['#00ff88', '#00ccff', '#ffd166', '#ff6b4a', '#673aff', '#ff2e66', '#7affc0', '#4c9eff', '#f5d90a', '#ffffff'];
      h += '<div class="lcs-f"><label>Accent colour <span>any colour</span></label><div class="lcs-color"><input type="color" data-color="accent" value="' + esc(D.accent || C.accent || '#00ff88') + '"><input type="text" data-f="accent" value="' + esc(D.accent || '') + '" placeholder="' + esc(C.accent) + ' (channel default)"></div><div class="lcs-swatches">' + sw.map(function (c) { return '<button type="button" data-swatch="' + c + '" style="background:' + c + '"' + (D.accent === c ? ' class="on"' : '') + '></button>'; }).join('') + '</div></div>';
      h += '<div class="lcs-f"><label>Font</label><select data-select="font"><option value="">Channel default</option>' + C.fonts.map(function (f) { return '<option value="' + esc(f) + '"' + (D.font === f ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select></div>';
      h += '<div class="lcs-f"><label>Corners</label>' + seg('radius', [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']]) + '</div>';
      h += '<div class="lcs-f"><label>Page width</label>' + seg('width', [['narrow', 'Narrow'], ['standard', 'Standard'], ['wide', 'Wide']]) + '</div>';
    } else if (tab === 'banner') {
      var b = D.banner;
      h += '<div class="lcs-f"><label>Channel banner</label>' + seg('banner.mode', [['none', 'None'], ['image', 'Image / GIF'], ['video', 'Video'], ['gradient', 'Gradient']]) + '<div class="hint">A full-width banner under the channel bar, across the whole page. 2400 × 600 looks sharp on every screen.</div></div>';
      if (b.mode === 'image' || b.mode === 'video') { h += up('banner', b.mode === 'video' ? 'Drop a banner video' : 'Drop a banner image or GIF', b.mode === 'video' ? 'video/mp4,video/webm' : 'image/*', b.mode === 'video' ? 'MP4 or WebM, silent, under 40 MB. It loops.' : 'JPG, PNG, WebP or GIF under 40 MB.') + media(b.url, 'banner', b.mode === 'video'); }
      if (b.mode === 'video') { h += up('poster', 'Poster frame (optional)', 'image/*', 'Shown while the video loads and on slow connections.') + media(b.poster, 'poster', false); }
      if (b.mode !== 'none') {
        h += '<div class="lcs-f"><label>Height</label>' + seg('banner.height', [['short', 'Short'], ['medium', 'Medium'], ['tall', 'Tall']]) + '</div>';
        h += '<div class="lcs-f"><label>Fit</label>' + seg('banner.fit', [['cover', 'Fill'], ['contain', 'Fit inside']]) + '</div>';
        h += '<div class="lcs-f"><label>Focus</label>' + seg('banner.position', [['top', 'Top'], ['center', 'Centre'], ['bottom', 'Bottom']]) + '</div>';
        h += toggle('banner.overlay', 'Name over the banner', 'Your channel name and tagline on the lower left.');
        if (b.overlay) { h += text('banner.title', 'Banner title', C.name, 80) + text('banner.subtitle', 'Banner line', 'Optional line under the title', 140); }
      }
    } else if (tab === 'background') {
      var g = D.background;
      h += '<div class="lcs-f"><label>Page background</label>' + seg('background.mode', [['none', 'None'], ['image', 'Image'], ['video', 'Video'], ['pattern', 'Pattern'], ['banner', 'Use banner']]) + '<div class="hint">Sits behind the whole channel, under a dimming layer so everything stays readable.</div></div>';
      if (g.mode === 'image' || g.mode === 'video') { h += up('background', g.mode === 'video' ? 'Drop a background loop' : 'Drop a background image', g.mode === 'video' ? 'video/mp4,video/webm' : 'image/*', 'Under 40 MB. Wide images work best.') + media(g.url, 'background', g.mode === 'video'); }
      if (g.mode === 'pattern') { h += '<div class="lcs-f"><label>Pattern</label>' + seg('background.pattern', [['grid', 'Grid'], ['dots', 'Dots'], ['diagonal', 'Diagonal'], ['noise', 'Noise'], ['candles', 'Candles']]) + '</div>'; }
      if (g.mode !== 'none') { h += range('background.dim', 'Dim', 0, 95, '%') + range('background.blur', 'Blur', 0, 30, 'px') + toggle('background.fixed', 'Parallax', 'The background drifts slower than the page.'); }
    } else if (tab === 'layout') {
      h += '<div class="lcs-f"><label>Sidebar</label>' + seg('layout.sidebar', [['left', 'Left'], ['right', 'Right'], ['stack', 'On top']]) + '</div>';
      h += '<div class="lcs-f"><label>Videos</label>' + seg('layout.videos', [['orbit', '3D orbit'], ['grid', 'Grid'], ['list', 'List']]) + '</div>';
      h += '<div class="lcs-f"><label>Sections <span>order and visibility</span></label><div class="lcs-order">' + (D.layout.order || []).map(function (k, i, arr) { var hid = (D.layout.hidden || []).indexOf(k) !== -1; return '<div class="' + (hid ? 'hidden' : '') + '"><span>' + esc(C.sections[k] || k) + '</span><button type="button" data-move="' + k + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" data-move="' + k + '" data-dir="1"' + (i === arr.length - 1 ? ' disabled' : '') + '>↓</button><button type="button" data-hide="' + k + '" title="' + (hid ? 'Show' : 'Hide') + '">' + (hid ? '◌' : '●') + '</button></div>'; }).join('') + '</div><div class="hint">Sections that have nothing to show stay hidden on their own.</div></div>';
    } else if (tab === 'effects') {
      var e = D.effects;
      h += '<div class="lcs-f"><label>Motion layer</label>' + seg('effects.level', [['off', 'Off'], ['calm', 'Calm'], ['alive', 'Alive'], ['max', 'Max']]) + '<div class="hint">' + (C.fx ? 'The same particles, shapes and 3D objects as Loop Letters and the profile pages, behind the channel. Off for readers who asked their device for less motion.' : 'The Loop Letters Studio plugin provides the motion engine; it is not active, so this stays visual-only.') + '</div></div>';
      if (e.level !== 'off') {
        h += '<div class="lcs-f"><label>Effects</label>' + chips('effects.effects', [['particles', 'Particles'], ['aurora', 'Aurora'], ['grid', 'Grid floor'], ['orbs', 'Orbs'], ['rain', 'Rain'], ['ticker', 'Ticker tape'], ['scan', 'Scan line'], ['spotlight', 'Cursor light'], ['noise', 'Film noise']]) + '</div>';
        h += '<div class="lcs-f"><label>2D shapes</label>' + chips('effects.shapes', [['rings', 'Rings'], ['triangles', 'Triangles'], ['squares', 'Squares'], ['hex', 'Hexagons'], ['lines', 'Lines'], ['candles', 'Candles']]) + '</div>';
        h += '<div class="lcs-f"><label>3D objects</label>' + chips('effects.objects', [['cube', 'Cube'], ['sphere', 'Sphere'], ['torus', 'Torus'], ['pyramid', 'Pyramid'], ['octa', 'Octahedron'], ['coin', 'Coin'], ['bull', 'Bull']]) + '</div>';
        h += toggle('effects.pulse', 'Pulse with audio', 'When a letter or stream on the page plays sound, the layer breathes with it.');
      }
    } else {
      h += '<div class="lcs-note">Your channel page is indexable now: it has a real title, description, canonical link, ProfilePage and VideoObject schema, and a share image. It is listed in the channels sitemap.</div>';
      h += text('seo.title', 'Search title', C.name + ' (@' + C.handle + ') · Loop Channel', 90) + '<div class="lcs-f"><label>Description</label><textarea data-f="seo.description" rows="3" maxlength="200" placeholder="One line that says what the channel covers and for whom.">' + esc(D.seo.description || '') + '</textarea></div>' + toggle('seo.noindex', 'Hide from search engines');
    }
    body.innerHTML = h;
  }
  drawer.addEventListener('click', function (e) {
    var t = e.target, b;
    if ((b = t.closest('[data-seg] button'))) { var sp = b.parentNode.getAttribute('data-seg'); set(sp, b.getAttribute('data-v'), { preset: sp === 'preset' }); render(); return; }
    if ((b = t.closest('[data-chips] button'))) { b.classList.toggle('on'); set(b.parentNode.getAttribute('data-chips'), $$('button.on', b.parentNode).map(function (x) { return x.getAttribute('data-v'); })); return; }
    if ((b = t.closest('[data-toggle]'))) { var on = !b.classList.contains('on'); set(b.getAttribute('data-toggle'), on); render(); return; }
    if ((b = t.closest('[data-preset]'))) { set('preset', b.getAttribute('data-preset'), { preset: true }); render(); return; }
    if ((b = t.closest('[data-swatch]'))) { set('accent', b.getAttribute('data-swatch')); render(); return; }
    if ((b = t.closest('[data-move]'))) { var k = b.getAttribute('data-move'), dir = +b.getAttribute('data-dir'), ord = D.layout.order.slice(), i = ord.indexOf(k); if (i > -1 && i + dir >= 0 && i + dir < ord.length) { ord.splice(i, 1); ord.splice(i + dir, 0, k); set('layout.order', ord); render(); } return; }
    if ((b = t.closest('[data-hide]'))) { var hk = b.getAttribute('data-hide'), hid = (D.layout.hidden || []).slice(), hi = hid.indexOf(hk); if (hi > -1) { hid.splice(hi, 1); } else { hid.push(hk); } set('layout.hidden', hid); render(); return; }
    if ((b = t.closest('[data-remove]'))) { var kind = b.getAttribute('data-remove'); api('/media', { body: { kind: kind, remove: true } }).then(function (j) { D = j.design; C.design = D; applyDesign(D); render(); status('Removed', true); }).catch(function (er) { status(er.message, false, true); }); return; }
  });
  drawer.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches('[data-f]')) { set(t.getAttribute('data-f'), t.value, { banner: t.getAttribute('data-f').indexOf('banner') === 0 }); return; }
    if (t.matches('[data-color]')) { set('accent', t.value); var ti = $('[data-f="accent"]', drawer); if (ti) { ti.value = t.value; } return; }
    if (t.matches('[data-range]')) { var p = t.getAttribute('data-range'); set(p, +t.value, { bg: false }); var lab = t.previousElementSibling && t.previousElementSibling.querySelector('span'); if (lab) { lab.textContent = t.value + (p.indexOf('blur') > -1 ? 'px' : '%'); } return; }
  });
  drawer.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('select[data-select]')) { set(t.getAttribute('data-select'), t.value, { font: true }); return; }
    if (t.matches('.lcs-up input[type=file]')) { upload(t.closest('.lcs-up'), t.files[0]); t.value = ''; }
  });
  function upload(box, file) {
    if (!file) { return; }
    var kind = box.getAttribute('data-up');
    if (file.size > 40 * 1048576) { status('Keep it under 40 MB.', false, true); return; }
    box.classList.add('busy'); status('Uploading ' + file.name + '…');
    var fd = new FormData(); fd.append('file', file); fd.append('kind', kind);
    api('/media', { form: fd }).then(function (j) { D = j.design; C.design = D; applyDesign(D, { preset: false }); render(); status('Uploaded and live.', true); }).catch(function (er) { status(er.message || 'Upload failed', false, true); }).then(function () { box.classList.remove('busy'); });
  }
})();
