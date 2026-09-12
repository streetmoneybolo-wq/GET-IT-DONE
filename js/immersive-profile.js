/*!
 * SML Immersive Profile v2.0.0 — beat-reactive multi-world Profile Pulse page.
 * Vanilla JS, no dependencies. Reads window.SML_PROFILE, renders the whole page
 * into #sml-immersive-profile-root.
 *
 * Design source: "Immersive Profile.dc.html" (updated / approved).
 * Music: YOUTUBE ONLY — no hosted audio, no WebAudio FFT. The pulse is a BEAT
 * CLOCK locked to the YouTube player's playback position (same contract as the
 * site's deployed Profile Pulse snippet 6485: it publishes --kick/--bass/--mid
 * plus the canonical --sml-pulse / data-sml-pulse). YouTube is cross-origin and
 * exposes no audio data, so motion is beat-TIMED at an assumed BPM, not a live
 * spectrum.
 *
 * Two playback modes (cfg.useExistingPlayer):
 *   false (default) — own hidden youtube-nocookie iframe from cfg.music.url.
 *   true            — attach (listen only) to an existing #sml-profile-music-player
 *                     on the page (the site's music module) so no second player runs.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    name: '', handle: '', roles: [],
    avatarUrl: '', bannerUrl: '', backgroundUrl: '', bannerVideoUrl: '', backgroundVideoUrl: '',
    editUrl: '', visitorUrl: '',
    isOwner: true,            /* demo/non-profile mounts keep the full UI; profile pages set the real value */
    followUid: 0, isFollowing: false,
    stats: [], tickers: [], about: [], friends: [], friendsTotal: 0, posts: [], socials: [], moduleVisibility: {},
    bio: '',
    disclaimer: 'Market data and content on Stock Market Loop are for informational purposes only and do not constitute investment advice.',
    orbitalPhotos: ['', '', '', '', '', ''],           // 6 URLs (ring)  — orbital media 0..5
    galleryPhotos: ['', '', '', '', '', '', '', ''],   // 8 URLs (grid)  — orbital media 6..13
    orbitalVideos: ['', '', ''],                       // 3 URLs (ring)  — orbital_video 0..2
    galleryVideos: ['', '', '', '', '', ''],           // 6 URLs (grid)  — orbital_video 3..8
    contact: { email: '', phone: '', optIn: true },
    music: { url: '', title: 'Profile track' },
    useExistingPlayer: false,
    bpm: 120,
    pulse: 'Immersive',
    shapes: ['dot', 'ring', 'diamond', 'plus', 'sparkle', 'note', 'dollar', 'candle'],
    fx: ['Rain'],
    texture: 'Glass',
    particleDensity: 60, bannerShake: true, orbitalSize: 300, autoplay: false
  };

  var SHAPES = [
    ['dot', '● Dot'], ['ring', '○ Ring'], ['vinyl', '◉ Vinyl'], ['diamond', '◆ Diamond'],
    ['plus', '✚ Plus'], ['cross', '✕ Cross'], ['tri', '▲ Triangle'], ['square', '■ Square'],
    ['pill', '▭ Pill'], ['hex', '⬡ Hexagon'], ['star', '★ Star'], ['sparkle', '✦ Sparkle'],
    ['note', '♪ Note'], ['notes', '♫ Notes'], ['dollar', '$ Dollar'], ['percent', '% Percent'],
    ['up', '↑ Arrow up'], ['down', '↓ Arrow down'], ['candle', '▮ Candlestick'], ['spark', '⌁ Sparkline'],
    ['bars', '▥ EQ bars'], ['heart', '♥ Heart'], ['bolt', 'ϟ Bolt'], ['moon', '☾ Moon'],
    ['wave', '∿ Wave'], ['arc', '◠ Arc']
  ];
  var GLYPHS = { dollar: '$', percent: '%', note: '♪', notes: '♫', up: '↑', down: '↓', heart: '♥', moon: '☾', wave: '∿', bolt: 'ϟ' };
  var LEVELS = ['Off', 'Subtle', 'Balanced', 'Immersive'];
  var MULTS = { Off: 0, Subtle: 0.35, Balanced: 0.7, Immersive: 1 };
  var COLS = ['#38F58A', '#38F58A', '#38F58A', '#3d8bfd', '#ffb020', '#ff5c7a', '#b98cff'];
  var FXDEFS = ['Rain', 'Waves', 'Quantum', 'Fog', 'Snow', 'Dust', 'Embers', 'Lightning', 'Glitch', 'Energy'];
  var WORLDS = ['PROFILE', 'PHOTOS', 'VIDEOS', 'POSTS', 'CONTACT'];
  var TEX = {
    Glass: 'rgba(17,24,35,.72)',
    Carbon: 'repeating-linear-gradient(45deg,#10161f 0 3px,#0b1119 3px 6px)',
    Brushed: 'linear-gradient(90deg,#141c27,#1a2432 20%,#141c27 40%,#1c2634 60%,#141c27 80%,#18202c)',
    Holo: 'linear-gradient(135deg,rgba(56,245,138,.14),rgba(61,139,253,.14) 35%,rgba(185,140,255,.16) 70%,rgba(56,245,138,.12))'
  };
  /* Looks library (mu-plugin sml-immersive-library): 2D glyphs, drawn objects, 3D objects,
     reactive graphs, textures and screen-FX presets. Inline on profile pages as
     window.SML_IL_CATALOG; fetched otherwise. Everything merges into the same lists the
     dock, the Studio and the engine whitelist already use. */
  var CAT = { shapes: {}, tex: {}, fx: {}, applied: false, version: '' };
  function isNew(d) { if (!d) return false; var t = Date.parse(d); return t && (Date.now() - t) < 21 * 864e5; }
  function applyCatalog(c) {
    if (!c || typeof c !== 'object' || CAT.applied) return;
    CAT.applied = true; CAT.version = String(c.version || '');
    var have = {}; SHAPES.forEach(function (d) { have[d[0]] = 1; });
    (c.shapes || []).forEach(function (it) {
      if (!it || !it.id || have[it.id]) return; have[it.id] = 1;
      CAT.shapes[it.id] = it; SHAPES.push([it.id, it.label || it.id]);
      if (it.kind === 'glyph' && it.glyph) GLYPHS[it.id] = it.glyph;
    });
    (c.textures || []).forEach(function (t) { if (t && t.name && t.css && !TEX[t.name]) { TEX[t.name] = t.css; CAT.tex[t.name] = t; } });
    (c.fx || []).forEach(function (f) { if (f && f.name && FXDEFS.indexOf(f.name) < 0) { FXDEFS.push(f.name); CAT.fx[f.name] = f; } });
  }
  if (window.SML_IL_CATALOG) applyCatalog(window.SML_IL_CATALOG);
  var FRAME_ID = 'sml-profile-music-player';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(s) { if (!isFinite(s)) s = 0; s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function ytId(u) {
    var s = String(u || '').trim(), m;
    if ((m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/))) return m[1];
    if ((m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))) return m[1];
    if ((m = s.match(/\/embed\/([A-Za-z0-9_-]{11})/))) return m[1];
    if ((m = s.match(/\/shorts\/([A-Za-z0-9_-]{11})/))) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return '';
  }
  function merge() {
    var user = window.SML_PROFILE || {}, out = {};
    for (var k in DEFAULTS) {
      var v = user[k];
      var empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      /* content arrays: an empty real value STAYS empty (sections hide) — never demo data */
      var CONTENT = { stats: 1, tickers: 1, about: 1, friends: 1, posts: 1, socials: 1, roles: 1 };
      out[k] = (empty && !CONTENT[k]) ? DEFAULTS[k] : (v == null ? DEFAULTS[k] : v);
    }
    if (user.music && user.music.url) out.music = { url: user.music.url, title: user.music.title || DEFAULTS.music.title };
    if (user.__media) out.__media = user.__media; /* real media lists (orbital / orbital_video) — needed by the pickers */
    if (user.immersive && typeof user.immersive === 'object') out.immersive = user.immersive; /* owner's saved look (profile pages) */
    if (user.contact) out.contact = { email: user.contact.email || '', phone: user.contact.phone || '', optIn: user.contact.optIn !== false };
    return out;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  var onLsSet = null;                      /* owner hook: immersive keys → profile engine (see persistImmersive) */
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} if (onLsSet) { try { onLsSet(k); } catch (e) {} } }
  /* The profile-engine bridge (unified-profile.js) seeds these localStorage keys
     from settings.immersive_profile on every load, for every viewer. So an OWNER
     changing them here (Arrange order, orbital sizes/scales, texture, screen FX,
     shapes, pulse, beat sensitivity, contact opt-in, reactive parts) must write
     them back — otherwise the change lives only in this browser and visitors
     never see it. Debounced; merges over the current server object. */
  var IMMERSIVE_KEYS = { 'sml_profile_pulse_level': 1, 'sml-pulse-shapes': 1, 'sml-screen-fx-list': 1, 'sml-card-texture': 1, 'sml-section-order': 1, 'sml-orbital-item-scales': 1, 'sml-orbital-photo-size': 1, 'sml-orbital-video-size': 1, 'sml-contact-optin': 1, 'sml-beat-sens': 1, 'sml-immersive-components': 1, 'sml-immersive-element-reactions': 1 };
  var persistT = null, persistBusy = false, persistAgain = false;
  function immersiveFromLocal(baseObj) {
    var im = {}; for (var k in (baseObj || {})) im[k] = baseObj[k];
    var g = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var j = function (k) { try { var v = JSON.parse(g(k)); return v == null ? undefined : v; } catch (e) { return undefined; } };
    var v;
    if ((v = g('sml_profile_pulse_level')) != null) im.pulse = String(v).toLowerCase();
    if ((v = j('sml-pulse-shapes')) !== undefined) im.shapes = v;
    if ((v = j('sml-screen-fx-list')) !== undefined) im.effects = v;
    if ((v = g('sml-card-texture')) != null) im.texture = v;
    if ((v = j('sml-section-order')) !== undefined) im.section_order = v;
    if ((v = j('sml-orbital-item-scales')) !== undefined) im.item_scales = v;
    if ((v = g('sml-orbital-photo-size')) != null && !isNaN(parseInt(v, 10))) im.photo_size = parseInt(v, 10);
    if ((v = g('sml-orbital-video-size')) != null && !isNaN(parseInt(v, 10))) im.video_size = parseInt(v, 10);
    if ((v = g('sml-contact-optin')) != null) im.contact_opt_in = v !== '0';
    if ((v = g('sml-beat-sens')) != null && !isNaN(parseFloat(v))) im.beat_sensitivity = parseFloat(v);
    if ((v = j('sml-immersive-components')) !== undefined) im.components = v;
    if ((v = j('sml-immersive-element-reactions')) !== undefined) im.element_reactions = v;
    return im;
  }
  function persistImmersive() {
    var U = window.SML_PROFILE_UNIFIED || {};
    if (!(U.isOwner && U.nonce && U.customRest)) return;
    if (persistBusy) { persistAgain = true; return; }
    var settings = {}; for (var k in (U.settings || {})) settings[k] = U.settings[k];
    settings.immersive_profile = immersiveFromLocal(U.immersive || settings.immersive_profile || {});
    try { if (JSON.stringify(settings.immersive_profile) === JSON.stringify(U.immersive || (U.settings && U.settings.immersive_profile) || null)) return; } catch (e) {}
    persistBusy = true;
    fetch(U.customRest, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': U.nonce }, body: JSON.stringify({ settings: settings }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (saved) {
        if (saved && saved.settings) { U.settings = saved.settings; if (saved.settings.immersive_profile) U.immersive = saved.settings.immersive_profile; }
        else { U.settings = settings; U.immersive = settings.immersive_profile; }
      }, function () {})
      .then(function () { persistBusy = false; if (persistAgain) { persistAgain = false; persistImmersive(); } });
  }
  var persistArmed = false;
  window.addEventListener('sml-live-preview-start', function () { clearTimeout(persistT); persistAgain = false; });
  function schedulePersist() {
    if (!persistArmed) return;                                   /* boot-time chip sync from the bridge is not a user change */
    var lpe = document.querySelector('.sml-lpe'); if (lpe && !lpe.hidden) return;   /* Live preview drawer open: it owns save/cancel */
    clearTimeout(persistT); persistT = setTimeout(persistImmersive, 1200);
  }
  function lsJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }

  var CSS = '' +
    '.sip-root{--kick:0;--bkick:0;--bass:0;--mid:0;--high:0;--lane-kick:0;--lane-sub:0;--lane-snare:0;--lane-hat:0;--lane-accent:0;--lane-swell:0;--sip-l:0;--sip-a:1;--sip-badge-lift:0px;--card-bg:rgba(17,24,35,.72);min-height:100vh;background:radial-gradient(1100px 560px at 72% -8%,rgba(1,167,125,.16) 0%,rgba(7,13,20,0) 62%),#070d14;color:#E6EDF5;font-family:var(--sip-fb,"IBM Plex Sans"),"IBM Plex Sans",sans-serif;overflow-x:hidden;position:relative;box-sizing:border-box;}' +
    /* ---- Reaction engine: lane classes + movement library ------------------
       An element opts in by getting two classes (sip-ln-<lane>, sip-mv-<move>)
       and one inline var (--sip-a, amplitude) via applyMovement(). Everything
       here is a static rule driven by --sip-l/--sip-a — no @keyframes, no
       per-frame JS per element, so it composes cleanly with elements whose
       transform/filter is already owned by other code (orbital rings, the
       carousel, the dock) and stays inert wherever the Live Studio's
       "component off" sheet zeroes --kick/--bass/--mid/--high (those are a
       DIFFERENT variable family from --lane-*, so the neutraliser below is
       what actually turns a configured element off). */
    '.sip-root .sip-ln-kick{--sip-l:var(--lane-kick,0);}' +
    '.sip-root .sip-ln-sub{--sip-l:var(--lane-sub,0);}' +
    '.sip-root .sip-ln-snare{--sip-l:var(--lane-snare,0);}' +
    '.sip-root .sip-ln-hat{--sip-l:var(--lane-hat,0);}' +
    '.sip-root .sip-ln-accent{--sip-l:var(--lane-accent,0);}' +
    '.sip-root .sip-ln-swell{--sip-l:var(--lane-swell,0);}' +
    '.sip-root [data-sip-mv]{--kick:0;--bass:0;--mid:0;--high:0;--bkick:0;}' +
    '.sip-root .sip-mv-lift{translate:0 calc(var(--sip-l,0) * var(--sip-a,1) * -8px);}' +
    '.sip-root .sip-mv-drop{translate:0 calc(var(--sip-l,0) * var(--sip-a,1) * 8px);}' +
    '.sip-root .sip-mv-pop{scale:calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.12);}' +
    '.sip-root .sip-mv-squash{scale:calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.18) calc(1 - var(--sip-l,0) * var(--sip-a,1) * 0.1);}' +
    '.sip-root .sip-mv-stretch-x{scale:calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.16) 1;}' +
    '.sip-root .sip-mv-sway{translate:calc(var(--sip-l,0) * var(--sip-a,1) * 10px) 0;}' +
    '.sip-root .sip-mv-tilt{rotate:calc(var(--sip-l,0) * var(--sip-a,1) * 6deg);}' +
    '.sip-root .sip-mv-wobble{rotate:calc((var(--sip-l,0) - 0.5) * var(--sip-a,1) * 10deg);}' +
    '.sip-root .sip-mv-lean{transform-origin:bottom left;rotate:calc(var(--sip-l,0) * var(--sip-a,1) * 5deg);}' +
    '.sip-root .sip-mv-nod{rotate:calc(var(--sip-l,0) * var(--sip-a,1) * 4deg);translate:0 calc(var(--sip-l,0) * var(--sip-a,1) * 3px);}' +
    '.sip-root .sip-mv-roll{rotate:calc(var(--sip-l,0) * var(--sip-a,1) * 360deg);}' +
    '.sip-root .sip-mv-float{translate:0 calc(var(--sip-l,0) * var(--sip-a,1) * -14px);scale:calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.04);}' +
    '.sip-root .sip-mv-jitter{translate:calc((var(--sip-l,0) - 0.5) * var(--sip-a,1) * 3px) calc((var(--sip-l,0) - 0.5) * var(--sip-a,1) * -3px);}' +
    '.sip-root .sip-mv-breathe{scale:calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.06);opacity:calc(0.85 + var(--sip-l,0) * 0.15);}' +
    '.sip-root .sip-mv-banner-drift{scale:calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.04);rotate:calc(var(--sip-l,0) * var(--sip-a,1) * 0.6deg);}' +
    '.sip-root .sip-mv-halo{box-shadow:0 0 0 calc(2px + var(--sip-l,0) * var(--sip-a,1) * 9px) rgba(56,245,138,calc(0.45 + var(--sip-l,0) * var(--sip-a,1) * 0.4)),0 0 calc(16px + var(--sip-l,0) * var(--sip-a,1) * 40px) rgba(56,245,138,calc(0.25 + var(--sip-l,0) * var(--sip-a,1) * 0.4));}' +
    '.sip-root .sip-mv-glow{box-shadow:0 0 calc(8px + var(--sip-l,0) * var(--sip-a,1) * 24px) rgba(56,245,138,calc(0.35 + var(--sip-l,0) * var(--sip-a,1) * 0.4));}' +
    '.sip-root .sip-mv-inner-glow{box-shadow:inset 0 0 calc(6px + var(--sip-l,0) * var(--sip-a,1) * 18px) rgba(56,245,138,calc(0.3 + var(--sip-l,0) * var(--sip-a,1) * 0.4));}' +
    '.sip-root .sip-mv-text-glow{text-shadow:0 0 calc(var(--sip-l,0) * var(--sip-a,1) * 28px) rgba(56,245,138,.65);}' +
    '.sip-root .sip-mv-letter-spread{letter-spacing:calc(var(--sip-l,0) * var(--sip-a,1) * 3px);}' +
    '.sip-root .sip-mv-flicker{opacity:calc(1 - var(--sip-l,0) * var(--sip-a,1) * 0.4);}' +
    '.sip-root .sip-mv-hover-lift{translate:0 calc(var(--sip-l,0) * var(--sip-a,1) * -6px);box-shadow:0 calc(4px + var(--sip-l,0) * var(--sip-a,1) * 14px) calc(10px + var(--sip-l,0) * var(--sip-a,1) * 20px) rgba(0,0,0,calc(0.2 + var(--sip-l,0) * 0.2));}' +
    '.sip-root .sip-mv-pulse-outline{outline:calc(1px + var(--sip-l,0) * var(--sip-a,1) * 3px) solid rgba(56,245,138,calc(0.4 + var(--sip-l,0) * 0.5));outline-offset:calc(var(--sip-l,0) * var(--sip-a,1) * 4px);}' +
    '.sip-root .sip-mv-rim-tint{background-color:rgba(56,245,138,calc(var(--sip-l,0) * var(--sip-a,1) * 0.14));}' +
    '.sip-root .sip-mv-settle{translate:0 calc((1 - var(--sip-l,0)) * var(--sip-a,1) * -6px);}' +
    /* Filter-based — dead on any element the Live Studio's component sheet
       marks "off" (that sheet also sets filter:none!important). The Reactions
       panel greys these out for banner/avatar/cards/orbitals for that reason. */
    '.sip-root .sip-mv-brighten{filter:brightness(calc(1 + var(--sip-l,0) * var(--sip-a,1) * 0.5));}' +
    '.sip-root .sip-mv-saturate{filter:saturate(calc(1 + var(--sip-l,0) * var(--sip-a,1) * 1.2));}' +
    '.sip-root .sip-mv-hue-shift{filter:hue-rotate(calc(var(--sip-l,0) * var(--sip-a,1) * 60deg));}' +
    '@media (prefers-reduced-motion:reduce){.sip-root [data-sip-mv]{translate:none !important;rotate:none !important;scale:none !important;}}' +
    '.sip-root *{box-sizing:border-box;}' +
    '.sip-root [hidden]{display:none !important;}' +
    '.sip-root .sip-sec[data-empty="1"]{display:none !important;}' +
    '.sip-root .sip-emptynote{font-size:12.5px;color:#6B7C90;line-height:1.6;padding:14px 4px;}' +
    '.sip-root:not(.sip-owner) .sip-slot-empty{display:none !important;}' +
    '.sip-root:not(.sip-owner) .sip-ph{font-size:0 !important;}' +            /* visitors see the empty pattern, never "banner image"/"avatar" labels */
    '.sip-root:not(.sip-owner) .sip-orbcol[data-empty="1"]{display:none !important;}' +
    '.sip-root.sip-owner .sip-visitor-only{display:none !important;}' +
    '.sip-root .sip-mediavid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}' +
    '.sip-root a{color:#38F58A;text-decoration:none;}.sip-root a:hover{color:#8dffc2;}' +
    '.sip-bg{position:fixed;inset:0;z-index:0;background-size:cover;background-position:center;}' +
    '.sip-bg-scrim{position:absolute;inset:0;background:rgba(7,13,20,.55);pointer-events:none;}' +
    '.sip-fx{position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none;}' +
    '.sip-worldnav{position:fixed;top:50%;transform:translateY(-50%);z-index:6;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(11,19,31,.72);color:#38F58A;font-size:18px;cursor:pointer;backdrop-filter:blur(8px);}' +
    '.sip-exit{position:fixed;top:calc(var(--sip-shell-top,0px) + 10px);right:12px;z-index:7;border:1px solid rgba(255,255,255,.2);background:rgba(11,19,31,.82);color:#c3ccd4;border-radius:999px;padding:7px 13px;font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.5px;cursor:pointer;backdrop-filter:blur(8px);}' +
    '.sip-exit:hover{border-color:#38F58A;color:#38F58A;}' +
    '.sip-reenter{position:fixed;right:14px;bottom:14px;z-index:2147483000;background:#38F58A;color:#03120A;border:none;border-radius:999px;padding:10px 16px;font:700 12.5px/1 "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4);}' +
    '.sip-content{position:relative;z-index:2;max-width:1060px;margin:0 auto;padding:clamp(14px,3vw,26px) clamp(12px,3vw,26px) 170px;}' +
    '.sip-topbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:2px 4px 16px;}' +
    '.sip-logo-dot{width:11px;height:11px;border-radius:50%;background:#38F58A;box-shadow:0 0 calc(10px + var(--kick,0)*24px) rgba(56,245,138,.85);display:inline-block;}' +
    '.sip-logo{font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:800;letter-spacing:2px;font-size:13px;}' +
    '.sip-nav{display:flex;gap:18px;font-size:13px;color:#7e8a96;margin-left:auto;}.sip-nav a{color:#7e8a96;}' +
    '.sip-worldtabs{display:flex;align-items:center;gap:6px;margin:0 0 12px;flex-wrap:wrap;}' +
    '.sip-wtab{border:1px solid rgba(255,255,255,.14);background:rgba(11,19,31,.6);color:#93A4B8;border-radius:999px;padding:6px 13px;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.4px;font-weight:600;cursor:pointer;}' +
    '.sip-wtab.on{background:#38F58A;color:#03120A;border-color:#38F58A;}' +
    '.sip-wtab-hint{font-size:11px;color:#6B7C90;margin-left:auto;}' +
    '.sip-kebab-wrap{position:relative;}' +
    '.sip-kebab{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(11,19,31,.6);color:#c3ccd4;font-size:15px;line-height:1;cursor:pointer;}' +
    '.sip-kebab[aria-expanded="true"]{background:#38F58A;color:#03120A;border-color:#38F58A;}' +
    '.sip-kebab-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:9;display:flex;flex-direction:column;min-width:150px;background:rgba(11,19,31,.95);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:6px;box-shadow:0 12px 30px rgba(0,0,0,.5);}' +
    '.sip-kebab-menu button{background:transparent;border:none;color:#dbe8f5;font:600 12px "IBM Plex Sans",system-ui,sans-serif;text-align:left;padding:9px 10px;border-radius:8px;cursor:pointer;}' +
    '.sip-kebab-menu button:hover{background:rgba(56,245,138,.14);color:#38F58A;}' +
    '.sip-react-modal{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:20px;}' +
    '.sip-react-backdrop{position:absolute;inset:0;background:rgba(3,7,11,.7);backdrop-filter:blur(4px);}' +
    '.sip-react-card{position:relative;width:min(560px,100%);max-height:min(74vh,560px);display:flex;flex-direction:column;background:rgba(11,19,31,.97);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.55);}' +
    '.sip-react-head{display:flex;align-items:center;justify-content:space-between;}' +
    '.sip-react-head strong{font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-size:17px;}' +
    '.sip-react-close{background:transparent;border:none;color:#c3ccd4;font-size:16px;cursor:pointer;padding:4px 8px;}' +
    '.sip-react-sub{font-size:11.5px;color:#6B7C90;margin:4px 0 10px;}' +
    '.sip-react-groupbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}' +
    '.sip-react-group-btn{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#93A4B8;border-radius:999px;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:.4px;cursor:pointer;}' +
    '.sip-react-group-btn.on{background:#38F58A;color:#03120A;border-color:#38F58A;}' +
    '.sip-react-body{overflow:auto;flex:1;}' +
    '.sip-react-row{display:grid;grid-template-columns:minmax(0,1fr) 88px 1fr 60px;gap:8px;align-items:center;padding:8px 2px;border-bottom:1px solid rgba(255,255,255,.06);}' +
    '.sip-react-row-label{font-size:12.5px;color:#dbe8f5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.sip-react-row select,.sip-react-row input[type="range"]{width:100%;background:rgba(255,255,255,.06);color:#dbe8f5;border:1px solid rgba(255,255,255,.14);border-radius:6px;font-size:11px;padding:5px;accent-color:#38F58A;}' +
    '.sip-screens{position:relative;perspective:1400px;transition:height .5s ease;}' +
    '.sip-screen{position:absolute;top:0;left:0;right:0;transition:transform .65s cubic-bezier(.22,.85,.3,1),opacity .65s;backface-visibility:hidden;}' +
    '.sip-worldtitle{font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:900;font-size:clamp(24px,4vw,34px);letter-spacing:-0.5px;}' +
    '.sip-worldsub{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;margin:4px 0 16px;}' +
    '.sip-hero{position:relative;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0B131F;}' +
    '.sip-banner{height:clamp(190px,30vw,300px);transform:scale(calc(1 + var(--bkick,0)*0.06)) rotate(calc(var(--bkick,0)*0.35deg));background-size:cover;background-position:center;}' +
    '.sip-ph{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 14px,rgba(255,255,255,.055) 14px 28px);color:#6B7C90;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:11px;letter-spacing:1px;text-align:center;padding:8px;}' +
    '.sip-hero-fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,13,20,0) 34%,rgba(7,13,20,.94) 100%);pointer-events:none;}' +
    '.sip-hero-row{position:absolute;left:0;right:0;bottom:0;display:flex;gap:16px;align-items:flex-end;padding:clamp(12px,2.5vw,22px);flex-wrap:wrap;}' +
    '.sip-avatar{position:relative;width:clamp(84px,12vw,112px);height:clamp(84px,12vw,112px);flex:none;}' +
    '.sip-avatar-img{width:100%;height:100%;border-radius:50%;background-size:cover;background-position:center;overflow:hidden;}' +
    '.sip-avatar-ring{position:absolute;inset:-5px;border-radius:50%;pointer-events:none;box-shadow:0 0 0 calc(2px + var(--bass,0)*9px) rgba(56,245,138,calc(0.45 + var(--kick,0)*0.55)),0 0 calc(16px + var(--kick,0)*54px) rgba(56,245,138,calc(0.25 + var(--kick,0)*0.5));}' +
    '.sip-name{margin:0;font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:900;font-size:clamp(26px,4.5vw,40px);letter-spacing:-1px;line-height:1.05;text-shadow:0 0 calc(var(--kick,0)*28px) rgba(56,245,138,.65);}' +
    '.sip-handle{color:#38F58A;font-size:14px;font-weight:600;margin-top:3px;}' +
    '.sip-roles{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}' +
    '.sip-role{font-size:11px;font-weight:600;color:#93A4B8;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 10px;background:rgba(11,19,31,.6);white-space:nowrap;}' +
    '.sip-btn{padding:9px 18px;border-radius:999px;border:none;background:#38F58A;color:#03120A;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;display:inline-block;}' +
    '.sip-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.16);color:#c3ccd4;font-weight:400;}' +
    '.sip-root a.sip-btn{color:#03120A;}.sip-root a.sip-btn:hover{color:#03120A;background:#5dffa3;}.sip-root a.sip-btn.ghost{color:#c3ccd4;}.sip-root a.sip-btn.ghost:hover{color:#fff;background:transparent;}' +
    '.sip-btn.sip-follow[data-on="1"]{background:transparent;border:1px solid rgba(56,245,138,.55);color:#38F58A;}' +
    '.sip-sec{border-radius:8px;}' +
    '.sip-sec.edit{outline:2px dashed rgba(56,245,138,.4);outline-offset:5px;cursor:grab;touch-action:none;user-select:none;}' +
    '.sip-sec.edit:active,.sip-sec.sip-dragging{cursor:grabbing;opacity:.68;}' +
    '.sip-sec.sip-drop-target{outline-color:#38F58A;box-shadow:0 0 24px rgba(56,245,138,.24);}' +
    '.sip-root[data-sml-imm-orbital-photos="0"] [data-orbital-kind="photos"],.sip-root[data-sml-imm-orbital-videos="0"] [data-orbital-kind="videos"]{display:none!important;}' +
    '.sip-root[data-sml-imm-orbital-photos="0"][data-sml-imm-orbital-videos="0"] .sip-sec[data-sec="orbitals"]{display:none!important;}' +
    '.sip-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-top:14px;}' +
    '.sip-stat{background:var(--card-bg);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:10px 12px;backdrop-filter:blur(8px);transform:translateY(calc(var(--kick,0)*-8px));}' +
    '.sip-stat-l{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:1.4px;color:#6B7C90;}' +
    '.sip-stat-v{font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:800;font-size:20px;margin-top:2px;}' +
    '.sip-ticks{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}' +
    '.sip-tick{display:flex;gap:8px;align-items:baseline;background:rgba(11,19,31,.7);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:7px 14px;backdrop-filter:blur(8px);font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;transform:translateY(calc(var(--kick,0)*-7px)) scale(calc(1 + var(--kick,0)*0.04));}' +
    '.sip-tick b{font-weight:600;font-size:12.5px;}.sip-tick span{font-size:11.5px;}' +
    '.sip-orbwrap{display:flex;flex-wrap:wrap;gap:20px;margin-top:14px;justify-content:space-around;align-items:flex-start;}' +
    '.sip-orbcol{flex:1;min-width:290px;padding:8px 0;}' +
    '.sip-orbhead{display:flex;align-items:center;gap:12px;}' +
    '.sip-orbhead-t{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;flex:1;}' +
    '.sip-stage{position:relative;height:300px;perspective:1000px;transform-style:preserve-3d;}' +
    '.sip-ring{position:absolute;inset:0;transform-style:preserve-3d;}' +
    '.sip-orb-photo{position:absolute;left:50%;top:50%;width:110px;height:150px;margin:-75px 0 0 -55px;border-radius:12px;backface-visibility:hidden;background-size:cover;background-position:center;background-color:rgba(17,24,35,.72);border:1px solid rgba(255,255,255,.09);overflow:hidden;}' +
    '.sip-orb-video{position:absolute;left:50%;top:50%;width:126px;height:190px;margin:-95px 0 0 -63px;border-radius:12px;overflow:hidden;backface-visibility:hidden;cursor:pointer;background:rgba(17,24,35,.72);border:1px solid rgba(255,255,255,.09);}' +
    '.sip-orb-video video{width:100%;height:100%;object-fit:cover;}' +
    '.sip-cellph{display:flex;width:100%;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:6px;background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 14px,rgba(255,255,255,.055) 14px 28px);color:#6B7C90;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:1px;text-align:center;padding:8px;}' +
    '.sip-itembtns{position:absolute;top:6px;left:6px;z-index:3;display:flex;gap:4px;}' +
    '.sip-ibtn{width:24px;height:24px;border-radius:6px;border:none;background:rgba(0,0,0,.55);color:#c3ccd4;font-size:12px;cursor:pointer;backdrop-filter:blur(6px);}' +
    '.sip-ibtn.z{color:#38F58A;}' +
    '.sip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-top:14px;}' +
    '.sip-card{background:var(--card-bg);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:18px 20px;backdrop-filter:blur(10px);}' +
    '.sip-card-h{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;margin-bottom:10px;}' +
    '.sip-row{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12.5px;}' +
    '.sip-row .k{color:#6B7C90;}.sip-row .v{color:#E6EDF5;font-weight:600;text-align:right;}' +
    '.sip-friend{display:flex;align-items:center;gap:12px;margin-top:10px;}' +
    '.sip-friend-av{width:44px;height:44px;border-radius:50%;background:linear-gradient(140deg,#38F58A,#01A77D);color:#03120A;display:flex;align-items:center;justify-content:center;font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:800;font-size:15px;flex:none;background-size:cover;background-position:center;box-shadow:0 0 0 calc(1px + var(--bass,0)*5px) rgba(56,245,138,.4);}' +
    '.sip-disc{background:rgba(11,19,31,.6);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:14px 20px;backdrop-filter:blur(10px);}' +
    '.sip-disc-h{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#6B7C90;margin-bottom:6px;}' +
    '.sip-disc-t{font-size:11.5px;color:#93A4B8;line-height:1.6;}' +
    '.sip-galphotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}' +
    '.sip-galphoto{position:relative;aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:var(--card-bg);border:1px solid rgba(255,255,255,.09);transform:scale(calc(1 + var(--kick,0)*0.04));box-shadow:0 10px 26px rgba(0,0,0,.4);background-size:cover;background-position:center;cursor:pointer;}' +
    '.sip-galvids{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;}' +
    '.sip-galvid{position:relative;aspect-ratio:3/4;border-radius:14px;overflow:hidden;background:var(--card-bg);border:1px solid rgba(255,255,255,.09);cursor:pointer;transform:scale(calc(1 + var(--bass,0)*0.03));box-shadow:0 10px 26px rgba(0,0,0,.4);}' +
    '.sip-galvid video{width:100%;height:100%;object-fit:cover;}' +
    '.sip-posts{display:flex;flex-direction:column;gap:10px;max-width:720px;min-width:0;}' +
    '.sip-activity{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start;}' +
    '.sip-friendbox{position:sticky;top:10px;max-height:calc(100vh - 140px);overflow:auto;}' +
    '.sip-friendlist{display:flex;flex-direction:column;}' +
    '.sip-friend{color:inherit;text-decoration:none;border-radius:12px;padding:4px 6px;margin:2px -6px 0;}a.sip-friend:hover{background:rgba(255,255,255,.06);}' +
    '.sip-friend-av{position:relative;}.sip-friend-live{position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;border-radius:50%;background:#38F58A;border:2px solid #0B131F;box-shadow:0 0 8px rgba(56,245,138,.8);}' +
    '@media (max-width:900px){.sip-activity{grid-template-columns:1fr;}.sip-friendbox{position:static;max-height:none;}.sip-friendlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:0 10px;}}' +
    '.sip-post{background:var(--card-bg);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px;backdrop-filter:blur(8px);transform:translateY(calc(var(--kick,0)*-3px));}' +
    '.sip-post-h{display:flex;gap:8px;align-items:center;margin-bottom:6px;}' +
    '.sip-post-badge{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:9px;letter-spacing:1.4px;border-radius:999px;padding:3px 9px;}' +
    '.sip-post-time{font-size:11px;color:#6B7C90;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;}' +
    '.sip-post-ctx{font-size:11.5px;color:#6B7C90;margin-bottom:4px;}' +
    '.sip-post-text{font-size:13.5px;line-height:1.6;color:#E6EDF5;word-break:break-word;}' +
    '.sip-post-text a.sip-tk{color:#35FF8D;font-weight:700;text-decoration:none;}' +
    '.sip-post-text a.sip-mn{color:#5DB9FF;font-weight:700;text-decoration:none;white-space:nowrap;}.sip-post-text a.sip-mn:hover{text-decoration:underline;}' +
    '.sip-post-text img.sip-mn-av,.sip-post-text .sip-mn-ph{display:inline-block;width:17px;height:17px;border-radius:50%;object-fit:cover;vertical-align:-3px;margin:0 4px 0 0;box-shadow:0 0 0 1.5px rgba(93,185,255,.75);background:linear-gradient(160deg,#24323F,#0E1620);}' +
    '.sip-post-link{font-size:11.5px;line-height:1.4;color:#6B7C90;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.sip-post-link a{color:#6B7C90;text-decoration:none;}.sip-post-link a:hover{color:#93A4B8;text-decoration:underline;}' +
    '.sip-socials{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;}' +
    '.sip-social{display:flex;gap:12px;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(11,19,31,.6);border-radius:14px;padding:12px 14px;color:#E6EDF5;transform:translateY(calc(var(--kick,0)*-4px));}' +
    '.sip-social:hover{border-color:rgba(56,245,138,.6);background:rgba(56,245,138,.06);}' +
    '.sip-social-tile{width:44px;height:44px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:900;font-size:16px;letter-spacing:-0.5px;box-shadow:0 0 calc(var(--kick,0)*14px) rgba(56,245,138,.4);}' +
    '.sip-social-txt{display:flex;flex-direction:column;gap:1px;min-width:0;}' +
    '.sip-social-name{font-size:13px;font-weight:700;}' +
    '.sip-social-handle{font-size:10.5px;color:#38F58A;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.sip-social-desc{font-size:11px;color:#6B7C90;line-height:1.45;}' +
    '.sip-editdone{margin-left:8px;padding:5px 12px;border-radius:999px;border:none;background:#38F58A;color:#03120A;font:700 11px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;letter-spacing:0;}' +
    /* Sticky inside the offset scrollport: reserve space and stay below the site header. */
    '.sip-editbadge{position:sticky;top:12px;margin:12px auto;width:fit-content;max-width:calc(100% - 380px);z-index:8;background:rgba(11,19,31,.9);border:1px solid rgba(56,245,138,.5);color:#38F58A;border-radius:18px;padding:7px 16px;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:11px;line-height:1.5;letter-spacing:1px;backdrop-filter:blur(10px);white-space:normal;text-align:center;}' +
    '.sip-dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);width:min(1024px,calc(100vw - 18px));z-index:5;background:rgba(11,19,31,.84);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 calc(var(--kick,0)*44px) rgba(56,245,138,calc(var(--kick,0)*0.3));}' +
    '.sip-play{width:46px;height:46px;border-radius:50%;border:none;background:#38F58A;color:#03120A;font-size:14px;font-weight:700;cursor:pointer;flex:none;box-shadow:0 0 calc(8px + var(--kick,0)*32px) rgba(56,245,138,.55);}' +
    '.sip-track{min-width:150px;max-width:210px;}' +
    '.sip-track-l{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:9px;letter-spacing:1.6px;color:#38F58A;}' +
    '.sip-track-t{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}' +
    '.sip-time{font-size:11px;color:#6B7C90;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;margin-top:2px;}' +
    '.sip-wave{flex:1;min-width:160px;height:44px;cursor:pointer;}.sip-wave canvas{width:100%;height:100%;display:block;}' +
    '.sip-eq{display:flex;gap:2px;align-items:flex-end;height:36px;flex:none;}' +
    '.sip-eq div{width:4px;height:3px;background:#38F58A;border-radius:2px;}' +
    '.sip-ctl{display:flex;flex-direction:column;gap:4px;position:relative;}' +
    '.sip-ctl-l{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:9px;letter-spacing:1.6px;color:#6B7C90;}' +
    '.sip-seg{display:flex;gap:4px;background:rgba(255,255,255,.04);border-radius:999px;padding:3px;}' +
    '.sip-chip{border:1px solid rgba(255,255,255,.14);background:transparent;color:#93A4B8;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
    '.sip-chip.on{background:#38F58A;color:#03120A;border-color:#38F58A;}' +
    '.sip-chip.tint.on{background:rgba(56,245,138,.16);color:#38F58A;border-color:rgba(56,245,138,.55);}' +
    '.sip-panel{position:absolute;bottom:calc(100% + 10px);right:0;width:min(460px,calc(100vw - 30px));max-height:330px;overflow:auto;background:rgba(11,19,31,.95);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;box-shadow:0 -10px 40px rgba(0,0,0,.5);}' +
    '.sip-panel-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;}' +
    '.sip-panel-t{font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;flex:1;}' +
    '.sip-panel-grid{display:flex;flex-wrap:wrap;gap:6px;}' +
    '.sip-panel-note{font-size:11px;color:#6B7C90;margin-top:10px;line-height:1.5;}' +
    '.sip-dock-more{display:none;}' +
    '.sip-panel-sub{width:100%;flex-basis:100%;font-family:var(--sip-fa,"IBM Plex Mono"),"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:1.6px;color:#8fa0b3;margin:6px 0 0;}' +
    '.sip-new{display:inline-block;margin-left:5px;padding:1px 5px;border-radius:999px;background:#38F58A;color:#06120c;font-size:8.5px;letter-spacing:.8px;font-weight:900;vertical-align:1px;}' +
    '.sip-tex{flex-wrap:wrap;max-width:420px;}' +
    '.sip-mini .sip-dock{left:auto;right:14px;bottom:14px;transform:none;width:auto;min-width:0;padding:6px;gap:0;border-radius:999px;flex-wrap:nowrap;}' +
    '.sip-mini .sip-dock .sip-track,.sip-mini .sip-dock .sip-wave,.sip-mini .sip-dock .sip-eq,.sip-mini .sip-dock .sip-ctl,.sip-mini .sip-dock .sip-dock-more,.sip-mini .sip-dock .sip-panel{display:none!important;}' +
    '.sip-mini .sip-dock .sip-play{margin:0;}' +
    '.sip-gift{background:linear-gradient(120deg,#38F58A,#7dffb8 50%,#ffd166);color:#06120c;border:0;font-weight:900;box-shadow:0 0 0 2px rgba(56,245,138,.25),0 0 18px rgba(56,245,138,.5);animation:sipGiftPulse 2.2s ease-in-out infinite;white-space:nowrap;}' +
    '@keyframes sipGiftPulse{0%,100%{box-shadow:0 0 0 2px rgba(56,245,138,.25),0 0 14px rgba(56,245,138,.45);}50%{box-shadow:0 0 0 4px rgba(56,245,138,.35),0 0 30px rgba(56,245,138,.85);}}' +
    '.sip-mini .sip-dock .sip-gift{margin-left:6px;font-size:12px;padding:7px 12px;}' +
    '.sip-mini .sip-dock.sip-dock--none{display:none!important;}' +
    '@media (max-width:640px){' +
      '.sip-content{padding:10px 10px 150px;}' +
      '.sip-topbar{gap:10px;padding:2px 84px 10px 4px;}.sip-nav{margin-left:0;width:100%;gap:14px;font-size:12px;flex-wrap:wrap;}' +   /* right gutter = the site's floating Loop Bucks pill */
      '.sip-worldtabs{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px;margin-bottom:10px;}.sip-worldtabs::-webkit-scrollbar{display:none;}' +
      '.sip-wtab{flex:none;padding:7px 12px;}.sip-wtab-hint{display:none;}' +
      '.sip-worldnav{display:none !important;}' +
      '.sip-banner{height:150px;}' +
      '.sip-hero-row{position:relative;left:auto;right:auto;bottom:auto;margin-top:-42px;padding:0 12px 14px;gap:10px;align-items:flex-start;flex-direction:column;}' +
      '.sip-hero-fade{background:linear-gradient(180deg,rgba(7,13,20,0) 40%,rgba(7,13,20,.9) 100%);}' +
      '.sip-avatar{width:84px;height:84px;}' +
      '.sip-name{font-size:26px;}.sip-handle{font-size:13px;}' +
      '.sip-hero-row>div:last-child{width:100%;}.sip-hero-row .sip-btn{flex:1 1 auto;text-align:center;}' +
      '.sip-stats{grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;}.sip-stat{padding:8px 9px;}.sip-stat-v{font-size:17px;}' +
      '.sip-orbwrap{gap:8px;}.sip-orbcol{min-width:0;flex:1 1 100%;}.sip-stage{height:250px;}' +
      '.sip-card{padding:14px 14px;}.sip-grid{gap:10px;}' +
      '.sip-galphotos{grid-template-columns:1fr;gap:10px;}.sip-galvids{grid-template-columns:1fr;gap:10px;}' +
      '.sip-worldtitle{font-size:22px;}' +
      '.sip-editbadge{position:fixed;left:50%;transform:translateX(-50%);margin:0;top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 94px + var(--sip-badge-lift,0px));width:calc(100vw - 20px);max-width:calc(100vw - 20px);max-height:calc(100dvh - var(--sip-shell-top,0px) - 112px);overflow:auto;white-space:normal;text-align:center;font-size:10px;line-height:1.5;}' +
      '.sip-react-row{grid-template-columns:1fr;gap:4px;}' +
      '.sip-dock{left:8px;right:8px;width:auto;transform:none;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);padding:10px 12px;gap:8px 10px;border-radius:14px;}' +
      '.sip-play{width:40px;height:40px;font-size:12px;}' +
      '.sip-track{min-width:0;max-width:none;flex:1 1 0;}.sip-track-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.sip-eq{display:none;}' +
      '.sip-dock-more{display:inline-block;flex:none;}' +
      '.sip-wave{flex:1 1 100%;order:5;height:34px;min-width:0;}' +
      '.sip-ctl{display:none;order:6;}' +
      '.sip-dock.open .sip-ctl{display:flex;}' +
      '.sip-dock.open .sip-wave{display:none;}' +
      '.sip-dock.open{max-height:calc(100vh - 80px);overflow:auto;}' +
      '.sip-panel{position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);width:auto;max-height:60vh;}' +
      '.sip-bsens{width:120px !important;}' +
    '}' +
    /* Playback stays user-initiated through the persistent Play control. A
       full-viewport sound gate blocked profile actions, including Edit. */
    '.sip-overlay{position:fixed;inset:0;z-index:9;background:radial-gradient(700px 420px at 50% 45%,rgba(56,245,138,.12),transparent 65%),rgba(4,9,14,.94);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;cursor:pointer;text-align:center;padding:24px;}' +
    '.sip-owner .sip-overlay{display:none!important;}' +
    '.sip-overlay-btn{width:92px;height:92px;border-radius:50%;background:#38F58A;color:#03120A;display:flex;align-items:center;justify-content:center;font-size:32px;animation:sip-breathe 1.6s ease-in-out infinite;box-shadow:0 0 70px rgba(56,245,138,.5);}' +
    '.sip-overlay-t{font-family:var(--sip-fh,Archivo),Archivo,sans-serif;font-weight:800;font-size:22px;letter-spacing:.5px;}' +
    '.sip-overlay-s{font-size:13px;color:#93A4B8;max-width:340px;text-align:center;line-height:1.6;}' +
    '.sip-gallery-add{margin-left:auto;padding:7px 12px;border:1px solid rgba(56,245,138,.55);border-radius:999px;background:rgba(56,245,138,.1);color:#38F58A;font:700 11px/1 "IBM Plex Sans",sans-serif;cursor:pointer;}' +
    '.sip-gallery-head{display:flex;align-items:center;gap:10px;margin-bottom:6px;}'
    /* owner call 2026-09-09: Delete stays out of sight until the owner taps Manage (then Done) */
    + '.sip-root.sip-manage .sip-gallery-delete{display:inline-block;}'
    + '.sip-gallery-manage{padding:7px 12px;border:1px solid rgba(255,255,255,.28);border-radius:999px;background:rgba(255,255,255,.06);color:#E6EDF5;font:700 11px/1 "IBM Plex Sans",sans-serif;cursor:pointer;}'
    + '.sip-root.sip-manage .sip-gallery-manage{border-color:rgba(255,92,119,.65);background:rgba(40,5,12,.6);color:#ff8299;}'
    /* owner call 2026-09-09: select several uploads and delete them at once */
    + '.sip-gallery-pick{display:none;position:absolute;left:8px;top:8px;z-index:4;width:28px;height:28px;border-radius:8px;background:rgba(2,7,11,.72);border:1px solid rgba(255,255,255,.35);align-items:center;justify-content:center;cursor:pointer;}'
    + '.sip-gallery-pick input{width:16px;height:16px;margin:0;accent-color:#ff5c77;cursor:pointer;}'
    + '.sip-root.sip-manage .sip-gallery-pick{display:flex;}'
    + '.sip-galphoto.sip-picked,.sip-galvid.sip-picked,.sip-orb-photo.sip-picked,.sip-orb-video.sip-picked{outline:3px solid #ff5c77;outline-offset:-3px;}'
    + '.sip-orbhead .sip-gallery-manage,.sip-orbhead .sip-gallery-bulk{padding:5px 9px;font-size:10px;}'
    + '.sip-gallery-bulk{padding:7px 12px;border:1px solid rgba(255,92,119,.65);border-radius:999px;background:rgba(255,92,119,.16);color:#ff8299;font:800 11px/1 "IBM Plex Sans",sans-serif;cursor:pointer;}.sip-gallery-bulk[hidden]{display:none;}' +
    '.sip-gallery-delete{display:none;position:absolute;right:8px;top:8px;z-index:3;border:1px solid rgba(255,92,119,.65);border-radius:999px;background:rgba(40,5,12,.9);color:#ff8299;padding:6px 9px;font:800 10px/1 Archivo,sans-serif;cursor:pointer;}' +
    '.sip-media-caption{position:absolute;left:0;right:0;bottom:0;padding:28px 10px 9px;background:linear-gradient(transparent,rgba(2,7,11,.9));color:#fff;font:700 11px/1.25 Archivo,sans-serif}.sip-media-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}.sip-media-tags a{color:#62bfff;text-decoration:none;font-size:10px;}' +
    '.sip-media-meta{position:fixed;inset:0;z-index:2147483645;background:rgba(2,7,11,.86);display:flex;align-items:center;justify-content:center;padding:20px;}' +
    '.sip-media-meta-card{width:min(440px,100%);background:#09121a;border:1px solid rgba(56,245,138,.4);border-radius:18px;padding:20px;box-shadow:0 24px 80px #000;}' +
    '.sip-media-meta-card h3{margin:0 0 6px;color:#fff;font:800 19px/1.2 Archivo,sans-serif}.sip-media-meta-card p{margin:0 0 15px;color:#93a4b8;font:500 12px/1.5 Archivo,sans-serif}.sip-media-meta-card label{display:block;margin:12px 0 5px;color:#c8d5df;font:700 11px/1 Archivo,sans-serif}.sip-media-meta-card input{width:100%;box-sizing:border-box;border:1px solid #263a48;border-radius:10px;background:#050b10;color:#fff;padding:11px 12px;outline:none}.sip-media-meta-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:17px}.sip-media-meta-actions button{border:1px solid #2a3d49;border-radius:999px;background:#101b23;color:#d7e2e9;padding:9px 14px;font-weight:800;cursor:pointer}.sip-media-meta-actions .primary{background:#38F58A;color:#03120a;border-color:#38F58A;}' +
    '.sip-yt{position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;border:0;}' +
    '@keyframes sip-breathe{0%,100%{transform:scale(1);}50%{transform:scale(1.07);}}';

  // ---------------------------------------------------------------- markup
  function markup(cfg) {
    var moduleVisibility = cfg.moduleVisibility && typeof cfg.moduleVisibility === 'object' ? cfg.moduleVisibility : {};
    var showOrbitalPhotos = moduleVisibility.orbital_photo_feed !== false;
    var showOrbitalVideos = moduleVisibility.orbital_video_feed !== false;
    function ph(url, label, cls) {
      var st = url ? ' style="background-image:url(\'' + esc(url) + '\')"' : '';
      var inner = url ? '' : '<div class="sip-ph"' + (cls === 'circle' ? ' style="border-radius:50%"' : '') + '>' + esc(label) + '</div>';
      return { st: st, inner: inner };
    }
    var statHtml = cfg.stats.map(function (s) {
      var slug = String(s.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return '<div class="sip-stat" data-stat="' + esc(slug) + '"><div class="sip-stat-l">' + esc(s.label) + '</div><div class="sip-stat-v">' + esc(s.value != null ? s.value : s.v) + '</div></div>';
    }).join('');
    var tickHtml = cfg.tickers.map(function (t) {
      var col = (t.dir === 'down' || /^-/.test(t.chg)) ? '#ff5c7a' : '#38F58A';
      return '<div class="sip-tick"><b>' + esc(t.sym) + '</b><span style="color:' + col + '">' + esc(t.chg) + '</span></div>';
    }).join('');
    var aboutHtml = (cfg.bio ? '<div class="sip-row" style="display:block"><span class="k">About</span><div class="v" style="margin-top:6px;white-space:pre-line;line-height:1.55">' + esc(cfg.bio) + '</div></div>' : '') + cfg.about.map(function (r) {
      return '<div class="sip-row"><span class="k">' + esc(r.k) + '</span><span class="v">' + esc(r.v) + '</span></div>';
    }).join('');
    var friendHtml = cfg.friends.map(function (f) {
      var initials = esc((f.name || '?').split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase());
      var av = f.avatarUrl ? ' style="background-image:url(\'' + esc(f.avatarUrl) + '\')"' : '';
      var sub = [f.place, f.meta].filter(Boolean).join(' · ') || f.handle;
      var open = f.url ? ' href="' + esc(f.url) + '"' : '';
      return '<a class="sip-friend"' + open + (f.id ? ' data-sml-user-id="' + f.id + '"' : '') + '><div class="sip-friend-av"' + av + '>' + (f.avatarUrl ? '' : initials) + (f.live ? '<i class="sip-friend-live"></i>' : '') + '</div><div style="min-width:0;"><div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(f.name) + '</div><div style="font-size:11.5px;color:#6B7C90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(sub) + '</div></div></a>';
    }).join('');
    var friendsBox = '<div class="sip-card sip-friendbox"><div class="sip-card-h">FRIENDS' + (cfg.friendsTotal ? ' · ' + cfg.friendsTotal : '') + '</div>' +
      (friendHtml ? '<div class="sip-friendlist">' + friendHtml + '</div>' : '<div class="sip-emptynote">No friends yet. When two members follow each other they become friends and show up here.</div>') + '</div>';

    // Orbital photo ring (6)
    var orbPhotos = '', nOrbP = 0;
    for (var i = 0; i < 6; i++) {
      var p = ph(cfg.orbitalPhotos[i], 'photo ' + (i + 1)); if (cfg.orbitalPhotos[i]) nOrbP++;
      var opItem = ((cfg.__media && cfg.__media.orbital) || [])[i] || null;
      var opCtl = (cfg.isOwner && opItem && opItem.attachment_id) ? '<label class="sip-gallery-pick" title="Select"><input type="checkbox" data-gallery-pick="orbital:' + i + ':' + Number(opItem.attachment_id) + '"></label><button type="button" class="sip-gallery-delete" data-gallery-delete="orbital:' + i + ':' + Number(opItem.attachment_id) + '">Delete</button>' : '';
      orbPhotos += '<div class="sip-orb-photo' + (cfg.orbitalPhotos[i] ? '' : ' sip-slot-empty') + '" data-ophoto="' + i + '"' + p.st + '>' + p.inner + opCtl +
        '<div class="sip-itembtns" data-editonly hidden><button class="sip-ibtn z" data-ozoom="' + i + '" title="Bring to front">⤢</button>' +
        '<button class="sip-ibtn" data-osmall="photo:' + i + '" title="Smaller">−</button>' +
        '<button class="sip-ibtn" data-obig="photo:' + i + '" title="Bigger">＋</button></div></div>';
    }
    // Orbital video ring (3)
    var orbVids = '', nOrbV = 0;
    for (var j = 0; j < 3; j++) {
      var ov = (cfg.orbitalVideos || [])[j] || ''; if (ov) nOrbV++;
      var ovItem = ((cfg.__media && cfg.__media.orbital_video) || [])[j] || null;
      var ovCtl = (cfg.isOwner && ovItem && ovItem.attachment_id) ? '<label class="sip-gallery-pick" title="Select"><input type="checkbox" data-gallery-pick="orbital_video:' + j + ':' + Number(ovItem.attachment_id) + '"></label><button type="button" class="sip-gallery-delete" data-gallery-delete="orbital_video:' + j + ':' + Number(ovItem.attachment_id) + '">Delete</button>' : '';
      orbVids += '<div class="sip-orb-video' + (ov ? '' : ' sip-slot-empty') + '" data-ovideo="' + j + '">' + (ov ? '<video class="sip-mediavid" data-lazyvid preload="metadata" src="' + esc(ov) + '" muted loop playsinline></video>' : '') + ovCtl + '<div class="sip-cellph" data-vph' + (ov ? ' style="display:none"' : '') + '><span style="font-size:20px;color:#38F58A;">＋</span><span>add clip ' + (j + 1) + '</span></div>' +
        '<div class="sip-itembtns" data-editonly hidden><button class="sip-ibtn" data-osmall="video:' + j + '" title="Smaller">−</button>' +
        '<button class="sip-ibtn" data-obig="video:' + j + '" title="Bigger">＋</button></div></div>';
    }

    // Gallery photos (8)
    function mediaCaption(item) {
      if (!item) return '';
      var title = item.title || item.caption || '', tags = Array.isArray(item.tags) ? item.tags : [];
      var tagHtml = tags.map(function (tag) { var handle = tag && (tag.handle || tag.name); return handle ? '<a href="' + esc(tag.url || ('/members/' + Number(tag.user_id || 0) + '/')) + '">@' + esc(String(handle).replace(/^@/, '')) + '</a>' : ''; }).join('');
      return (title || tagHtml) ? '<div class="sip-media-caption">' + (title ? '<div>' + esc(title) + '</div>' : '') + (tagHtml ? '<div class="sip-media-tags">' + tagHtml + '</div>' : '') + '</div>' : '';
    }
    var galP = '', nGalP = 0;
    for (var g = 0; g < 8; g++) {
      var gp = ph(cfg.galleryPhotos[g], 'gallery photo ' + (g + 1)); if (cfg.galleryPhotos[g]) nGalP++;
      var gpItem = ((cfg.__media && cfg.__media.gallery_photo) || [])[g] || null;
      galP += '<div class="sip-galphoto' + (cfg.galleryPhotos[g] ? '' : ' sip-slot-empty') + '" data-gphoto="' + g + '"' + gp.st + '>' + gp.inner + mediaCaption(gpItem) + (cfg.isOwner && gpItem && gpItem.attachment_id ? '<label class="sip-gallery-pick" title="Select"><input type="checkbox" data-gallery-pick="gallery_photo:' + g + ':' + Number(gpItem.attachment_id) + '"></label><button type="button" class="sip-gallery-delete" data-gallery-delete="gallery_photo:' + g + ':' + Number(gpItem.attachment_id) + '">Delete</button>' : '') + '</div>';
    }
    if (!nGalP) galP += '<div class="sip-emptynote sip-visitor-only" style="grid-column:1/-1">No photos shared yet.</div>';
    // Gallery videos (6)
    var galV = '', nGalV = 0;
    for (var gvi = 0; gvi < 6; gvi++) {
      var gvu = (cfg.galleryVideos || [])[gvi] || ''; if (gvu) nGalV++;
      var gvItem = ((cfg.__media && cfg.__media.gallery_video) || [])[gvi] || null;
      galV += '<div class="sip-galvid' + (gvu ? '' : ' sip-slot-empty') + '" data-gvideo="' + gvi + '">' + (gvu ? '<video class="sip-mediavid" data-lazyvid preload="metadata" src="' + esc(gvu) + '" muted loop playsinline></video>' : '') + '<div class="sip-cellph" data-vph' + (gvu ? ' style="display:none"' : '') + '><span style="font-size:22px;color:#38F58A;">＋</span><span>add video ' + (gvi + 1) + '</span><span style="opacity:.6;">(in edit mode)</span></div>' + mediaCaption(gvItem) + (cfg.isOwner && gvItem && gvItem.attachment_id ? '<label class="sip-gallery-pick" title="Select"><input type="checkbox" data-gallery-pick="gallery_video:' + gvi + ':' + Number(gvItem.attachment_id) + '"></label><button type="button" class="sip-gallery-delete" data-gallery-delete="gallery_video:' + gvi + ':' + Number(gvItem.attachment_id) + '">Delete</button>' : '') + '</div>';
    }

    var postHtml = cfg.posts.map(function (po) {
      return '<div class="sip-post"><div class="sip-post-h"><span class="sip-post-badge" style="color:' + esc(po.color) + ';border:1px solid ' + esc(po.color) + '">' + esc(po.type) + '</span><span class="sip-post-time">' + esc(po.time) + '</span></div>' +
        (po.ctx ? '<div class="sip-post-ctx">' + (po.ctxUrl ? '<a href="' + esc(po.ctxUrl) + '"' + (po.ctxUid ? ' data-sml-user-id="' + esc(String(po.ctxUid)) + '"' : '') + ' style="color:inherit;text-decoration:none">' + esc(po.ctx) + '</a>' : esc(po.ctx)) + '</div>' : '') +
        '<div class="sip-post-text">' + (po.html || esc(po.text)) + '</div>' +
        (po.links && po.links.length ? '<div class="sip-post-link">' + po.links.slice(0, 3).map(function (u) { var href = /^https?:\/\//i.test(u) ? u : ('https://' + u); return '<a href="' + esc(href) + '" target="_blank" rel="noopener nofollow ugc">' + esc(u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')) + '</a>'; }).join(' · ') + '</div>' : '') +
        '</div>';
    }).join('');
    var socialHtml = cfg.socials.map(function (so) {
      return '<a class="sip-social" href="' + esc(so.url || '#') + '"><span class="sip-social-tile" style="background:' + esc(so.tile) + ';color:' + esc(so.glyphColor || '#fff') + ';">' + esc(so.glyph) + '</span>' +
        '<span class="sip-social-txt"><span class="sip-social-name">' + esc(so.name) + '</span><span class="sip-social-handle">' + esc(so.handle) + '</span><span class="sip-social-desc">' + esc(so.desc || '') + '</span></span></a>';
    }).join('');

    var eqHtml = ''; for (var e = 0; e < 26; e++) eqHtml += '<div></div>';
    var lvlHtml = LEVELS.map(function (l) { return '<button class="sip-chip" data-level="' + l + '">' + l + '</button>'; }).join('');
    function chipShape(d) { var ci = CAT.shapes[d[0]]; return '<button class="sip-chip tint" data-shape="' + d[0] + '">' + esc(d[1]) + (ci && isNew(ci.added) ? '<b class="sip-new">NEW</b>' : '') + '</button>'; }
    var shapeHtml = '<div class="sip-panel-sub">CLASSIC</div>' + SHAPES.filter(function (d) { return !CAT.shapes[d[0]]; }).map(chipShape).join('') +
      ['2D', 'Objects', '3D', 'Graphs'].map(function (g) { var items = SHAPES.filter(function (d) { var ci = CAT.shapes[d[0]]; return ci && (ci.group || '2D') === g; }); return items.length ? '<div class="sip-panel-sub">' + ({ '2D': 'LIBRARY · 2D', Objects: 'LIBRARY · DRAWN OBJECTS', '3D': 'LIBRARY · 3D OBJECTS', Graphs: 'LIBRARY · REACTIVE GRAPHS' }[g]) + '</div>' + items.map(chipShape).join('') : ''; }).join('');
    var fxHtml = FXDEFS.filter(function (v) { return !CAT.fx[v]; }).map(function (v) { return '<button class="sip-chip tint" data-fx="' + v + '">' + v + '</button>'; }).join('') +
      (FXDEFS.some(function (v) { return CAT.fx[v]; }) ? '<div class="sip-panel-sub">LIBRARY · PRESETS</div>' + FXDEFS.filter(function (v) { return CAT.fx[v]; }).map(function (v) { return '<button class="sip-chip tint" data-fx="' + esc(v) + '">' + esc(v) + (isNew(CAT.fx[v].added) ? '<b class="sip-new">NEW</b>' : '') + '</button>'; }).join('') : '');
    var texHtml = Object.keys(TEX).map(function (v) { return '<button class="sip-chip" data-tex="' + esc(v) + '" title="' + esc(v) + '">' + esc(v) + (CAT.tex[v] && isNew(CAT.tex[v].added) ? '<b class="sip-new">NEW</b>' : '') + '</button>'; }).join('');
    var worldTabsHtml = WORLDS.map(function (w, i) { return '<button class="sip-wtab" data-world="' + i + '">' + w + '</button>'; }).join('');

    var b = ph(cfg.bannerUrl, 'banner image');
    if (cfg.bannerVideoUrl) b = { st: '', inner: '<video class="sip-mediavid" src="' + esc(cfg.bannerVideoUrl) + '" autoplay muted loop playsinline' + (cfg.bannerUrl ? ' poster="' + esc(cfg.bannerUrl) + '"' : '') + '></video>' };
    var av = ph(cfg.avatarUrl, 'avatar', 'circle');
    var bg = cfg.backgroundUrl ? ' style="background-image:url(\'' + esc(cfg.backgroundUrl) + '\')"' : '';
    var bgVid = cfg.backgroundVideoUrl ? '<video class="sip-mediavid" src="' + esc(cfg.backgroundVideoUrl) + '" autoplay muted loop playsinline' + (cfg.backgroundUrl ? ' poster="' + esc(cfg.backgroundUrl) + '"' : '') + '></video>' : '';
    // "Edit profile" opens the SITE's real editor (avatar/banner/bio/music) — the
    // user's native abilities. "Arrange" is the immersive-only layout edit mode.
    /* Reactions panel markup is built static (defaults only) here in markup(cfg);
       init(mount) — the only place elReact (the saved config) actually exists —
       syncs each row's real value after mount, the same way it already does
       for e.g. the orbital size inputs. */
    var REACT_GROUPS = ['Identity', 'Stats', 'Orbitals', 'Content', 'Chrome'];
    function reactLaneOpts() {
      return Object.keys(LANES).map(function (l) {
        return '<option value="' + l + '">' + (l === 'off' ? 'Off' : l.charAt(0).toUpperCase() + l.slice(1)) + '</option>';
      }).join('');
    }
    function reactMvOpts() {
      return '<option value="none">None</option>' + Object.keys(MOVEMENTS).map(function (mv) {
        return '<option value="' + mv + '">' + mv.replace(/-/g, ' ') + (MOVEMENTS[mv] ? ' (filter)' : '') + '</option>';
      }).join('');
    }
    var reactGroupChips = REACT_GROUPS.map(function (g, gi) {
      return '<button type="button" class="sip-chip sip-react-group-btn' + (gi === 0 ? ' on' : '') + '" data-react-group="' + g + '">' + g + '</button>';
    }).join('');
    var reactBodyHtml = REACT_GROUPS.map(function (g, gi) {
      var rows = Object.keys(ELEMENTS).filter(function (id) { return ELEMENTS[id].group === g; }).map(function (id) {
        return '<div class="sip-react-row">' +
          '<span class="sip-react-row-label">' + esc(ELEMENTS[id].label) + '</span>' +
          '<select class="sip-react-lane" data-react-id="' + id + '">' + reactLaneOpts() + '</select>' +
          '<select class="sip-react-mv" data-react-id="' + id + '">' + reactMvOpts() + '</select>' +
          '<input type="range" class="sip-react-amp" data-react-id="' + id + '" min="0" max="2" step="0.1" value="1">' +
          '</div>';
      }).join('');
      return '<div class="sip-react-group-section" data-react-group="' + g + '"' + (gi > 0 ? ' hidden' : '') + '>' + rows + '</div>';
    }).join('');
    var reactModalHtml = cfg.isOwner ?
      '<div class="sip-react-modal" hidden>' +
      '<div class="sip-react-backdrop"></div>' +
      '<div class="sip-react-card">' +
      '<div class="sip-react-head"><strong>Reactions</strong><button type="button" class="sip-react-close" aria-label="Close">✕</button></div>' +
      '<div class="sip-react-sub">PROFILE PULSE and BEAT SENS above still scale everything here.</div>' +
      '<div class="sip-react-groupbar">' + reactGroupChips + '</div>' +
      '<div class="sip-react-body">' + reactBodyHtml + '</div>' +
      '</div></div>' : '';

    var editBtn = '', arrangeBtn = '', ownerMenuHtml = '';
    var shareBtn = '<button class="sip-btn ghost sip-share" type="button">Share</button>';
    if (cfg.isOwner) {
      /* Edit live / Full settings used to sit on the banner next to the name — too much
         chrome over the photo. Moved into a small kebab menu next to the CONTACT tab. */
      ownerMenuHtml = '<div class="sip-kebab-wrap"><button class="sip-kebab" type="button" aria-haspopup="true" aria-expanded="false" title="Profile settings">⋮</button>' +
        '<div class="sip-kebab-menu" hidden role="menu">' +
        '<button class="sip-live-open" type="button" role="menuitem">Edit live</button>' +
        '<button class="sip-studio-open" type="button" role="menuitem">Full settings</button>' +
        '<button class="sip-react-open" type="button" role="menuitem">Reactions</button>' +
        '</div></div>';
      arrangeBtn = '<button class="sip-btn ghost sip-edit-toggle" type="button">Arrange</button>';
    } else if (cfg.followUid) {
      /* visitor: Follow — proxies the page's real follow button when the unified
         layout renders one; otherwise talks to the same sml-members/v1/follow
         endpoint directly ({user_id, action:'follow'|'unfollow'}) */
      editBtn = '<button class="sip-btn sip-follow" type="button"' + (cfg.isFollowing ? ' data-on="1"' : ' data-on="0"') + '>' + (cfg.isFollowing ? 'Following' : 'Follow') + '</button>';
    }

    // World 0: PROFILE
    var world0 =
      '<div class="sip-screen">' +
      '<div class="sip-hero"><div class="sip-banner"' + b.st + '>' + b.inner + '</div><div class="sip-hero-fade"></div>' +
      '<div class="sip-hero-row">' +
      '<div class="sip-avatar"><div class="sip-avatar-ring"></div><div class="sip-avatar-img"' + av.st + '>' + av.inner + '</div></div>' +
      '<div style="flex:1;min-width:200px;"><h1 class="sip-name">' + esc(cfg.name) + '</h1><div class="sip-handle">' + esc(cfg.handle) + '</div>' +
      '<div class="sip-roles">' + cfg.roles.map(function (r) { return '<span class="sip-role">' + esc(r) + '</span>'; }).join('') + '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + editBtn + arrangeBtn + shareBtn + '</div>' +
      '</div></div>' +
      '<div class="sip-sections" style="display:flex;flex-direction:column;">' +
      '<div class="sip-sec" data-sec="stats"' + (statHtml ? '' : ' data-empty="1"') + '><div class="sip-stats">' + statHtml + '</div></div>' +
      '<div class="sip-sec" data-sec="tickers"' + (tickHtml ? '' : ' data-empty="1"') + '><div class="sip-ticks">' + tickHtml + '</div></div>' +
      '<div class="sip-sec" data-sec="orbitals"' + ((!showOrbitalPhotos && !showOrbitalVideos) || (!cfg.isOwner && !nOrbP && !nOrbV) ? ' data-empty="1"' : '') + '><div class="sip-orbwrap">' +
      '<div class="sip-orbcol" data-orbital-kind="photos"' + (!showOrbitalPhotos ? ' style="display:none"' : '') + (nOrbP ? '' : ' data-empty="1"') + '><div class="sip-orbhead"><div class="sip-orbhead-t">ORBITAL PHOTOS</div><input type="range" min="180" max="560" step="10" class="sip-psize" data-editonly hidden title="Photo size" style="width:110px;accent-color:#38F58A;">' + (cfg.isOwner && nOrbP ? '<button class="sip-gallery-manage" type="button" data-gallery-manage aria-pressed="false">Manage</button><button class="sip-gallery-bulk" type="button" data-gallery-bulk hidden>Delete selected</button>' : '') + '</div>' +
      '<div class="sip-stage sip-pstage"><div class="sip-ring sip-pring">' + orbPhotos + '</div></div></div>' +
      '<div class="sip-orbcol" data-orbital-kind="videos"' + (!showOrbitalVideos ? ' style="display:none"' : '') + (nOrbV ? '' : ' data-empty="1"') + '><div class="sip-orbhead"><div class="sip-orbhead-t">ORBITAL VIDEOS</div><input type="range" min="180" max="560" step="10" class="sip-vsize" data-editonly hidden title="Video size" style="width:110px;accent-color:#38F58A;">' + (cfg.isOwner && nOrbV ? '<button class="sip-gallery-manage" type="button" data-gallery-manage aria-pressed="false">Manage</button><button class="sip-gallery-bulk" type="button" data-gallery-bulk hidden>Delete selected</button>' : '') + '</div>' +
      '<div class="sip-stage sip-vstage"><div class="sip-ring sip-vring">' + orbVids + '</div></div></div>' +
      '</div></div>' +
      '<div class="sip-sec" data-sec="about"><div class="sip-grid">' +
      '<div class="sip-card" data-card="about"><div class="sip-card-h">ABOUT</div>' + aboutHtml + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:14px;">' +
      '<div class="sip-card" data-card="friends"><div class="sip-card-h">FRIENDS</div>' + friendHtml + '</div>' +
      '<div class="sip-disc"><div class="sip-disc-h">DISCLAIMER</div><div class="sip-disc-t">' + esc(cfg.disclaimer) + '</div></div>' +
      '</div></div></div>' +
      '</div></div>';
    // World 1: PHOTOS
    var world1 = '<div class="sip-screen"><div class="sip-gallery-head"><div class="sip-worldtitle">Photo Gallery</div>' + (cfg.isOwner ? '<button class="sip-gallery-add" type="button" data-gallery-add="photo">＋ Upload photo</button><button class="sip-gallery-manage" type="button" data-gallery-manage aria-pressed="false">Manage</button><button class="sip-gallery-bulk" type="button" data-gallery-bulk hidden>Delete selected</button>' : '') + '</div><div class="sip-worldsub">SWIPE LEFT FOR VIDEOS →</div><div class="sip-galphotos">' + galP + '</div></div>';
    if (!nGalV) galV += '<div class="sip-emptynote sip-visitor-only" style="grid-column:1/-1">No videos shared yet.</div>';
    // World 2: VIDEOS
    var world2 = '<div class="sip-screen"><div class="sip-gallery-head"><div class="sip-worldtitle">Video Gallery</div>' + (cfg.isOwner ? '<button class="sip-gallery-add" type="button" data-gallery-add="video">＋ Upload video</button><button class="sip-gallery-manage" type="button" data-gallery-manage aria-pressed="false">Manage</button><button class="sip-gallery-bulk" type="button" data-gallery-bulk hidden>Delete selected</button>' : '') + '</div><div class="sip-worldsub">SWIPE LEFT FOR POSTS →</div><div class="sip-galvids">' + galV + '</div></div>';
    // World 3: POSTS
    var world3 = '<div class="sip-screen"><div class="sip-worldtitle">Recent Activity</div><div class="sip-worldsub">POSTS · COMMENTS · SHARES · FRIENDS — SWIPE LEFT FOR CONTACT →</div><div class="sip-activity"><div class="sip-posts">' + (postHtml || '<div class="sip-emptynote">No recent activity shared yet.</div>') + '</div>' + friendsBox + '</div></div>';
    // World 4: CONTACT
    var c = cfg.contact || {};
    var contactRows = (c.email ? '<div class="sip-row"><span class="k">Email</span><a href="mailto:' + esc(c.email) + '" class="v">' + esc(c.email) + '</a></div>' : '') +
      (c.phone ? '<div class="sip-row"><span class="k">Phone</span><span class="v">' + esc(c.phone) + '</span></div>' : '');
    var world4 = '<div class="sip-screen"><div class="sip-worldtitle">Contact &amp; Socials</div><div class="sip-worldsub">SWIPE RIGHT TO GO BACK ←</div>' +
      '<div class="sip-grid" style="align-items:start;">' +
      '<div class="sip-card" data-card="contact"><div class="sip-card-h">CONTACT INFO</div><div class="sip-contact-in">' + (contactRows || '<div style="font-size:12.5px;color:#6B7C90;line-height:1.6;">No contact info shared.</div>') + '</div>' +
      '<div class="sip-contact-out" style="display:none;font-size:12.5px;color:#6B7C90;line-height:1.6;">The profile owner hasn’t shared contact info.</div>' +
      '<button class="sip-optin sip-btn" type="button" data-editonly hidden style="margin-top:12px;background:rgba(56,245,138,.12);color:#38F58A;border:1px solid rgba(56,245,138,.5);"></button></div>' +
      '<div class="sip-card" data-card="socials"><div class="sip-card-h">SOCIALS</div><div class="sip-socials">' + (socialHtml || '<div class="sip-emptynote">No socials linked yet.</div>') + '</div></div>' +
      '</div></div>';

    var ytIframe = (!cfg.useExistingPlayer && ytId(cfg.music.url)) ?
      '<iframe id="' + FRAME_ID + '" class="sip-yt" allow="autoplay; encrypted-media" src="https://www.youtube-nocookie.com/embed/' + esc(ytId(cfg.music.url)) + '?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&controls=0&loop=1&playlist=' + esc(ytId(cfg.music.url)) + '"></iframe>' : '';

    return '' +
      '<div class="sip-root' + (cfg.isOwner ? ' sip-owner' : '') + (/[?&]sml_studio=1/.test(location.search) ? '' : ' sip-mini') + '">' +
      '<div class="sip-bg"' + bg + '>' + bgVid + '<div class="sip-bg-scrim"></div></div>' +
      '<canvas class="sip-fx"></canvas>' +
      '<button class="sip-worldnav sip-prev" style="left:10px;" title="Previous world">‹</button>' +
      '<button class="sip-worldnav sip-next" style="right:10px;" title="Next world">›</button>' +
      '<button class="sip-exit" title="Exit to your normal profile (Customize, Settings, everything)">✕ Classic profile</button>' +
      '<div class="sip-editbadge" hidden>ARRANGE MODE — drag sections to reorder · ⤢ − ＋ resize · double-click a slot to add media &nbsp;<button type="button" class="sip-editdone">Done ✓</button></div>' +
      reactModalHtml +
      '<div class="sip-content">' +
      '<div class="sip-topbar"><span class="sip-logo-dot"></span><span class="sip-logo">STOCKMARKETLOOP</span>' +
      '<nav class="sip-nav"><a href="/watch/">Watch</a><a href="/live/">Live</a><a href="/markets/">Markets</a><a href="/n/">Newsletters</a></nav></div>' +
      '<div class="sip-worldtabs">' + worldTabsHtml + ownerMenuHtml + '<span class="sip-wtab-hint">swipe or use ‹ › to travel</span></div>' +
      '<div class="sip-screens">' + world0 + world1 + world2 + world3 + world4 + '</div>' +
      '</div>' +
      // Dock
      '<div class="sip-dock">' +
      '<button class="sip-play">▶</button>' +
      '<button class="sip-chip sip-gift" type="button" hidden title="Leave a song on this profile for Loop Bucks — it plays right after the owner’s tracks">🎁 Leave a song</button>' +
      '<div class="sip-track"><div class="sip-track-l">PROFILE MUSIC · YOUTUBE</div><div class="sip-track-t">' + esc(cfg.music.title) + '</div><div class="sip-time">0:00 / 0:00</div></div>' +
      '<div class="sip-wave"><canvas></canvas></div>' +
      '<div class="sip-eq">' + eqHtml + '</div>' +
      '<button class="sip-chip sip-dock-more" type="button" aria-expanded="false">Looks ▾</button>' +
      '<div class="sip-ctl"><div class="sip-ctl-l">2D OBJECTS</div><button class="sip-chip sip-obj-btn"></button>' +
      '<div class="sip-panel sip-obj-panel" hidden><div class="sip-panel-h"><div class="sip-panel-t">FLOATING 2D OBJECTS</div>' +
      '<button class="sip-chip sip-all">All</button><button class="sip-chip sip-none">None</button></div>' +
      '<div class="sip-panel-grid">' + shapeHtml + '</div><div class="sip-panel-note">The 2D layer is fully transparent — set a background and the objects float over it.</div></div></div>' +
      '<div class="sip-ctl"><div class="sip-ctl-l">TEXTURE</div><div class="sip-seg sip-tex">' + texHtml + '</div></div>' +
      '<div class="sip-ctl"><div class="sip-ctl-l">SCREEN FX</div><button class="sip-chip sip-fx-btn"></button>' +
      '<div class="sip-panel sip-fx-panel" hidden><div class="sip-panel-h"><div class="sip-panel-t">SCREEN EFFECTS — MIX &amp; MATCH</div>' +
      '<button class="sip-chip sip-fx-none">None</button></div><div class="sip-panel-grid">' + fxHtml + '</div>' +
      '<div class="sip-panel-note">All effects react to the beat and layer on the transparent canvas.</div></div></div>' +
      '<div class="sip-ctl"><div class="sip-ctl-l">BEAT SENS</div><input type="range" class="sip-bsens" min="0.5" max="2" step="0.05" title="Beat sensitivity" style="width:92px;accent-color:#38F58A;"></div>' +
      '<div class="sip-ctl"><div class="sip-ctl-l">PROFILE PULSE</div><div class="sip-seg">' + lvlHtml + '</div></div>' +
      '</div>' +
      ytIframe +
      '<input type="file" accept="video/*" class="sip-vidinput" hidden>' +
      '<input type="file" accept="image/*" class="sip-imginput" hidden>' +
      '<div class="sip-overlay"><div class="sip-overlay-btn">▶</div><div class="sip-overlay-t">Click to view &amp; hear</div>' +
      '<div class="sip-overlay-s">Enter this profile and start its music experience.</div></div>' +
      '</div>';
  }

  // ---------------------------------------------------------------- reactions
  /* Rhythm lanes an element can be assigned to (see the --lane-* vars in
     tick()). "off" means the element ignores the beat entirely. */
  var LANES = { off: 1, kick: 1, sub: 1, snare: 1, hat: 1, accent: 1, swell: 1 };
  /* Movement library: id -> whether it's filter-based (dead on any element
     the Live Studio's component sheet marks off — see the CSS comment above
     the .sip-mv-* rules). Kept as a plain whitelist so normalizeElReact can
     reject anything that isn't a real, styled movement. */
  var MOVEMENTS = {
    lift: 0, drop: 0, pop: 0, squash: 0, 'stretch-x': 0, sway: 0, tilt: 0, wobble: 0,
    lean: 0, nod: 0, roll: 0, float: 0, jitter: 0, breathe: 0, 'banner-drift': 0,
    halo: 0, glow: 0, 'inner-glow': 0, 'text-glow': 0, 'letter-spread': 0, flicker: 0,
    'hover-lift': 0, 'pulse-outline': 0, 'rim-tint': 0, settle: 0,
    brighten: 1, saturate: 1, 'hue-shift': 1
  };
  /* Every element this version of the Reactions panel can address, grouped
     for the two-level UI, with the reactiveComponents group (if any) that
     must also be "on" for this element to react — see legacyOk below. */
  var ELEMENTS = {
    banner: { sel: '.sip-banner', label: 'Banner', group: 'Identity', legacy: 'banner' },
    avatar_img: { sel: '.sip-avatar-img', label: 'Avatar image', group: 'Identity', legacy: 'avatar' },
    avatar_ring: { sel: '.sip-avatar-ring', label: 'Avatar ring', group: 'Identity', legacy: 'avatar' },
    name: { sel: '.sip-name', label: 'Name', group: 'Identity', registry: 'name' },
    handle: { sel: '.sip-handle', label: 'Handle', group: 'Identity' },
    logo_dot: { sel: '.sip-logo-dot', label: 'Logo dot', group: 'Chrome' },
    dock: { sel: '.sip-dock', label: 'Dock', group: 'Chrome' },
    play_btn: { sel: '.sip-play', label: 'Play button', group: 'Chrome' },
    world_title: { sel: '.sip-worldtitle', label: 'World title', group: 'Chrome' },
    stat_followers: { sel: '.sip-stat[data-stat="followers"]', label: 'Followers tile', group: 'Stats', legacy: 'cards' },
    stat_following: { sel: '.sip-stat[data-stat="following"]', label: 'Following tile', group: 'Stats', legacy: 'cards' },
    stat_charts: { sel: '.sip-stat[data-stat="charts"]', label: 'Charts tile', group: 'Stats', legacy: 'cards' },
    stat_posts: { sel: '.sip-stat[data-stat="posts"]', label: 'Posts tile', group: 'Stats', legacy: 'cards' },
    stat_views: { sel: '.sip-stat[data-stat="profile-views"]', label: 'Profile views tile', group: 'Stats', legacy: 'cards' },
    stat_likes: { sel: '.sip-stat[data-stat="likes"]', label: 'Likes tile', group: 'Stats', legacy: 'cards' },
    stat_friends: { sel: '.sip-stat[data-stat="friends"]', label: 'Friends tile', group: 'Stats', legacy: 'cards' },
    orbital_photo_ring: { sel: '.sip-pring', label: 'Orbital photo ring', group: 'Orbitals', legacy: 'orbital_photos' },
    orbital_video_ring: { sel: '.sip-vring', label: 'Orbital video ring', group: 'Orbitals', legacy: 'orbital_videos' },
    card_about: { sel: '.sip-card[data-card="about"]', label: 'About card', group: 'Content', legacy: 'cards' },
    card_friends: { sel: '.sip-card[data-card="friends"]', label: 'Friends card', group: 'Content', legacy: 'cards' },
    card_contact: { sel: '.sip-card[data-card="contact"]', label: 'Contact card', group: 'Content', legacy: 'cards' },
    card_socials: { sel: '.sip-card[data-card="socials"]', label: 'Socials card', group: 'Content', legacy: 'cards' },
    disclaimer: { sel: '.sip-disc', label: 'Disclaimer', group: 'Content', legacy: 'cards' }
  };

  function applyMovement(el, movementId, laneId, amp) {
    if (!el) return;
    var prev = el.__sipMv;
    if (prev) { el.classList.remove('sip-mv-' + prev.mv, 'sip-ln-' + prev.ln); }
    if (!movementId || movementId === 'none' || !MOVEMENTS.hasOwnProperty(movementId) ||
        !laneId || laneId === 'off' || !LANES.hasOwnProperty(laneId)) {
      el.removeAttribute('data-sip-mv'); el.style.removeProperty('--sip-a'); el.__sipMv = null; return;
    }
    el.__sipMv = { mv: movementId, ln: laneId };
    el.classList.add('sip-mv-' + movementId, 'sip-ln-' + laneId);
    el.setAttribute('data-sip-mv', movementId);
    el.style.setProperty('--sip-a', String(Math.max(0, Math.min(2, +amp || 1))));
  }
  /* Drop anything that isn't a real element/movement/lane id, and clamp
     amplitude — this config round-trips through a server blob and a
     localStorage key a user could hand-edit. */
  function normalizeElReact(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (id) {
      if (!ELEMENTS[id]) return;
      var row = raw[id]; if (!row || typeof row !== 'object') return;
      var lane = LANES.hasOwnProperty(row.lane) ? row.lane : 'off';
      var mv = MOVEMENTS.hasOwnProperty(row.mv) ? row.mv : 'none';
      var amp = Math.max(0, Math.min(2, parseFloat(row.amp)));
      if (isNaN(amp)) amp = 1;
      if (lane === 'off' || mv === 'none') return; // absent = legacy behavior
      out[id] = { lane: lane, mv: mv, amp: amp };
    });
    return out;
  }

  /* Cross-module interactions: a real user action momentarily "impulses" a
     handful of other elements, independent of whatever lane/movement they're
     otherwise configured with. A small, deliberate set of pairings wired to
     real actions in this file — not an all-to-all system, which isn't
     well-defined without specific choices. More pairings are just more rows
     here. */
  var IMPULSES = {
    share: [{ el: 'name', mv: 'text-glow', amp: 2.0, ms: 800 }, { el: 'logo_dot', mv: 'glow', amp: 2.0, ms: 800 }],
    follow: [{ el: 'avatar_ring', mv: 'halo', amp: 1.8, ms: 900 }, { el: 'stat_followers', mv: 'pop', amp: 1.8, ms: 700 }],
    enter: [{ el: 'banner', mv: 'banner-drift', amp: 1.5, ms: 1200 }, { el: 'avatar_ring', mv: 'halo', amp: 1.4, ms: 1200 }],
    play: [{ el: 'dock', mv: 'glow', amp: 1.6, ms: 600 }, { el: 'play_btn', mv: 'pop', amp: 1.4, ms: 600 }],
    world: [{ el: 'world_title', mv: 'settle', amp: 1.2, ms: 500 }]
  };

  // ---------------------------------------------------------------- init
  /* Profile fonts (Typography panel, same 1,959-font library as groups): the engine emits
     --sml-pfe-font-heading/body/accent on main.sml-profile; the overlay mirrors them. */
  function applyProfileFonts(fo) {
    var root = document.querySelector('.sip-root'); if (!root) return;
    var src = document.querySelector('main.sml-profile'), cs = src ? getComputedStyle(src) : null;
    var h = (fo && fo.heading) || (cs && cs.getPropertyValue('--sml-pfe-font-heading').trim()) || '';
    var b = (fo && fo.body) || (cs && cs.getPropertyValue('--sml-pfe-font-body').trim()) || '';
    var a = (fo && fo.accent) || (cs && cs.getPropertyValue('--sml-pfe-font-accent').trim()) || '';
    if (h) root.style.setProperty('--sip-fh', h); if (b) root.style.setProperty('--sip-fb', b); if (a) root.style.setProperty('--sip-fa', a);
  }
  window.SMLImmersiveFonts = { apply: applyProfileFonts };
  var INIT_GEN = 0;
  function init(mount) {
    var cfg = merge();
    var GEN = ++INIT_GEN;                    /* soft refresh (Profile Studio) re-inits: old rAF/message loops exit */
    if (!document.getElementById('sip-fonts')) {
      var lk = document.createElement('link');
      lk.id = 'sip-fonts'; lk.rel = 'stylesheet';
      lk.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
      document.head.appendChild(lk);
    }
    if (!document.getElementById('sip-css')) {
      var st = document.createElement('style'); st.id = 'sip-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    mount.innerHTML = markup(cfg);
    var $ = function (s) { return mount.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(mount.querySelectorAll(s)); };
    var rootEl = document.documentElement;

    // ---- state ----
    /* Source of truth for the LOOK (pulse, shapes, FX, texture, section order,
       orbital sizes/scales, contact opt-in, beat sensitivity, reactive parts):
         profile pages  → the owner's saved settings.immersive_profile (cfg.immersive),
                          painted on the very first frame; missing keys → defaults.
                          localStorage is NOT consulted: it is per-browser and would
                          bleed profile A's arrangement into profile B.
         other mounts   → localStorage (demo / explicit window.SML_PROFILE), as before.
       Owner changes still write localStorage (the bridge's contract) AND persist to
       the server (persistImmersive), so a reload shows exactly what was saved. */
    var IM = (cfg.immersive && typeof cfg.immersive === 'object') ? cfg.immersive : null;
    var srvMode = !!IM;
    function pickStr(srv, key, def) { if (srvMode) return (srv != null && srv !== '') ? String(srv) : def; var v = lsGet(key, null); return v == null ? def : v; }
    function pickJSON(srv, key) { if (srvMode) return (srv !== undefined) ? srv : null; return lsJSON(key, null); }
    function pickNum(srv, key) { if (srvMode) return (srv != null && srv !== '') ? Number(srv) : NaN; return parseFloat(lsGet(key, '')); }
    var level = LEVELS.indexOf(cfg.pulse) >= 0 ? cfg.pulse : 'Immersive';
    var savedLvl = pickStr(IM && IM.pulse, 'sml_profile_pulse_level', null);
    if (LEVELS.map(function (l) { return l.toLowerCase(); }).indexOf(String(savedLvl)) >= 0) {
      level = LEVELS[LEVELS.map(function (l) { return l.toLowerCase(); }).indexOf(String(savedLvl))];
    }
    var shapes = pickJSON(IM && IM.shapes, 'sml-pulse-shapes'); if (!Array.isArray(shapes)) shapes = cfg.shapes.slice();
    var fxList = pickJSON(IM && IM.effects, 'sml-screen-fx-list'); if (!Array.isArray(fxList)) fxList = cfg.fx.slice();
    var texture = pickStr(IM && IM.texture, 'sml-card-texture', cfg.texture); if (!TEX[texture]) texture = 'Glass';
    var sectionOrder = pickJSON(IM && IM.section_order, 'sml-section-order');
    if (!Array.isArray(sectionOrder) || sectionOrder.length !== 4) sectionOrder = ['stats', 'tickers', 'orbitals', 'about'];
    var itemScales = pickJSON(IM && IM.item_scales, 'sml-orbital-item-scales');
    if (!itemScales || !itemScales.photo || !itemScales.video) itemScales = { photo: [1, 1, 1, 1, 1, 1], video: [1, 1, 1] };
    var photoSize = parseInt(pickNum(IM && IM.photo_size, 'sml-orbital-photo-size'), 10); if (isNaN(photoSize)) photoSize = null;
    var videoSize = parseInt(pickNum(IM && IM.video_size, 'sml-orbital-video-size'), 10); if (isNaN(videoSize)) videoSize = null;
    var contactOptIn = srvMode
      ? (IM.contact_opt_in !== undefined ? IM.contact_opt_in !== false : !(cfg.contact && cfg.contact.optIn === false))
      : lsGet('sml-contact-optin', (cfg.contact && cfg.contact.optIn === false) ? '0' : '1') !== '0';
    var beatSens = pickNum(IM && IM.beat_sensitivity, 'sml-beat-sens'); if (isNaN(beatSens)) beatSens = parseFloat(cfg.beatSensitivity);
    if (!(beatSens >= 0.5 && beatSens <= 2)) beatSens = (cfg.beatSensitivity >= 0.5 && cfg.beatSensitivity <= 2) ? cfg.beatSensitivity : 1;
    var reactiveComponents = pickJSON(IM && IM.components, 'sml-immersive-components');
    var allReactiveComponents = ['background', 'banner', 'avatar', 'cards', 'orbital_photos', 'orbital_videos'];
    if (!Array.isArray(reactiveComponents)) reactiveComponents = allReactiveComponents.slice();
    var elReact = normalizeElReact(pickJSON(IM && IM.element_reactions, 'sml-immersive-element-reactions'));
    if (srvMode) {
      /* keep the per-browser keys in step with what is painted, so the bridge, the
         dock chips and the owner's persistence all start from the same values */
      try {
        localStorage.setItem('sml_profile_pulse_level', level.toLowerCase()); localStorage.setItem('sml-pulse-shapes', JSON.stringify(shapes));
        localStorage.setItem('sml-screen-fx-list', JSON.stringify(fxList)); localStorage.setItem('sml-card-texture', texture);
        localStorage.setItem('sml-section-order', JSON.stringify(sectionOrder)); localStorage.setItem('sml-orbital-item-scales', JSON.stringify(itemScales));
        if (photoSize != null) localStorage.setItem('sml-orbital-photo-size', String(photoSize)); else localStorage.removeItem('sml-orbital-photo-size');
        if (videoSize != null) localStorage.setItem('sml-orbital-video-size', String(videoSize)); else localStorage.removeItem('sml-orbital-video-size');
        localStorage.setItem('sml-contact-optin', contactOptIn ? '1' : '0'); localStorage.setItem('sml-beat-sens', String(beatSens));
        localStorage.setItem('sml-immersive-components', JSON.stringify(reactiveComponents));
        localStorage.setItem('sml-immersive-element-reactions', JSON.stringify(elReact));
      } catch (e) {}
    }
    function reacts(key) { return reactiveComponents.indexOf(key) >= 0; }
    function applyComponentState() {
      if (!root) return;
      allReactiveComponents.forEach(function (key) {
        root.setAttribute('data-sml-imm-' + key.replace(/_/g, '-'), reactiveComponents.indexOf(key) >= 0 ? '1' : '0');
      });
      applyElementReactions();
    }
    /* Subordinates the new per-element config to the existing 6-group
       checkboxes: --lane-* isn't covered by the Live Studio's own kill-switch
       CSS (#sml-immersive-component-css only zeroes --kick/--bass/--mid/--high),
       so unchecking e.g. "banner" there would otherwise leave a configured
       banner still moving. */
    function legacyOk(id) { var g = ELEMENTS[id] && ELEMENTS[id].legacy; return !g || reacts(g); }
    function applyElementReactions() {
      if (!root) return;
      Object.keys(ELEMENTS).forEach(function (id) {
        var el = root.querySelector(ELEMENTS[id].sel);
        var cfgRow = elReact[id];
        if (!cfgRow || !legacyOk(id)) { applyMovement(el, null); return; }
        applyMovement(el, cfgRow.mv, cfgRow.lane, cfgRow.amp);
      });
    }
    /* One-shot impulses: a real action briefly overrides an element's --sip-l
       via inline style (which beats the sip-ln-* class rule), decaying back
       to whatever it was. Independent of the lane/movement classes, so it
       works whether or not that element has its own per-element config. */
    var impulses = [];
    /* If the element has no persistent movement (from the Reactions panel),
       borrow its class for the duration of the impulse and drop it again on
       restore. If it DOES have one, just push --sip-l — the class it already
       carries reads that same var, so the impulse reads as a one-off boost
       of whatever it's already doing. */
    function fireImpulse(action) {
      (IMPULSES[action] || []).forEach(function (spec) {
        var meta = ELEMENTS[spec.el]; if (!meta) return;
        var el = root && root.querySelector(meta.sel); if (!el) return;
        var temp = !el.__sipMv;
        if (temp) { el.classList.add('sip-mv-' + spec.mv); el.style.setProperty('--sip-a', '1'); }
        impulses.push({ el: el, mv: spec.mv, temp: temp, amp: spec.amp, ms: spec.ms, t0: performance.now() });
      });
      if (impulses.length > 8) impulses.splice(0, impulses.length - 8);
    }
    function emitAction(action, extra) {
      if (GEN !== INIT_GEN || !root) return;
      try { root.dispatchEvent(new CustomEvent('sml-immersive-action', { bubbles: true, detail: Object.assign({ action: action }, extra || {}) })); } catch (e) {}
      fireImpulse(action);
    }
    window.addEventListener('sml-immersive-components', function (event) {
      if (GEN !== INIT_GEN) return;
      if (event && Array.isArray(event.detail)) { reactiveComponents = event.detail.slice(); applyComponentState(); }
    });
    var editMode = false, screen = 0, enlarged = null;
    var videos = [null, null, null], gvids = [null, null, null, null, null, null], gphotoLocal = {};
    var pickIdx = 0, pickKind = 'ovideo';

    // ---- refs ----
    var root = $('.sip-root'), fx = $('.sip-fx'), wfWrap = $('.sip-wave'), wf = $('.sip-wave canvas'),
      eq = $('.sip-eq'), playBtn = $('.sip-play'), timeEl = $('.sip-time'), avatar = $('.sip-avatar'),
      overlay = $('.sip-overlay'), screens = $('.sip-screens'), editBadge = $('.sip-editbadge'),
      pStage = $('.sip-pstage'), vStage = $('.sip-vstage'), pRing = $('.sip-pring'), vRing = $('.sip-vring'),
      vidInput = $('.sip-vidinput'), imgInput = $('.sip-imginput');

    // ---- YouTube beat clock ----
    var frame = cfg.useExistingPlayer ? document.getElementById(FRAME_ID) : $('#' + FRAME_ID);
    /* the page always ships the player iframe; with no music configured its src is
       empty (resolves to the page URL). Treat that as "no music": no tap-for-sound
       gate, honest dock copy, nothing pretends to play. */
    if (frame && !isYT((function () { try { return new URL(frame.getAttribute('src') || '', location.href).origin; } catch (e) { return ''; } })())) frame = null;
    var playing = false, soundEnabled = false, lastTime = 0, lastStamp = 0, duration = 0, registered = false, lastBeat = -1;
    var BPM = (cfg.bpm >= 50 && cfg.bpm <= 220) ? cfg.bpm : 120;
    var wavePeaks = (function () { var a = []; for (var i = 0; i < 160; i++) a.push(0.12 + Math.abs(Math.sin(i * 0.7) * 0.5) + Math.random() * 0.28); var mx = Math.max.apply(null, a); return a.map(function (v) { return v / mx; }); })();
    function isYT(o) { return /(^|\.)youtube(-nocookie)?\.com$/.test(String(o).replace(/^https?:\/\//, '')); }
    /* optimistic transport (owner call 2026-09-08): the button reflects the tap at once, the player confirms a moment later */
    function cmd(func, args) { listen(); try { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*'); } catch (e) {} }
    function listen() { if (!frame || !frame.contentWindow) return; try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 8, channel: 'widget' }), '*'); } catch (e) {} }
    function register() { if (registered) return; listen(); registered = true; }
    function markPlaying(on) { playing = !!on; lastTime = nowTime(); lastStamp = performance.now(); }
    window.addEventListener('message', function (ev) {
      if (GEN !== INIT_GEN) return;
      if (!frame || !isYT(ev.origin)) return;
      var d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
      if (!d || !d.info) return;
      if (d.event !== 'infoDelivery' && d.event !== 'initialDelivery') return;
      if (typeof d.info.playerState === 'number') { registered = true; playing = (d.info.playerState === 1); }
      if (typeof d.info.currentTime === 'number') { lastTime = d.info.currentTime; lastStamp = performance.now(); }
      if (typeof d.info.duration === 'number' && d.info.duration) duration = d.info.duration;
    }, false);
    function nowTime() { return playing ? lastTime + (performance.now() - lastStamp) / 1000 : lastTime; }
    function easeBeat(p) { return p < 0.12 ? (p / 0.12) : Math.pow(1 - (p - 0.12) / 0.88, 2.2); }
    /* Same attack/decay envelope as easeBeat, generalized: env(p, attack, curve).
       easeBeat(p) === env(p, 0.12, 2.2) — kept separate since easeBeat also
       drives the 26 EQ bars elsewhere and must stay byte-identical. */
    function env(p, atk, curve) { return p < atk ? (p / atk) : Math.pow(1 - (p - atk) / (1 - atk), curve); }
    function frac(v) { return ((v % 1) + 1) % 1; }
    function mult() { return MULTS[level] || 0; }

    function startPlayback(unmute) {
      if (!frame) { overlay.style.display = 'none'; return; }
      register();
      if (unmute) { cmd('unMute'); cmd('setVolume', [60]); cmd('playVideo'); }
      else { cmd('mute'); cmd('playVideo'); }
      markPlaying(true);
      soundEnabled = !!unmute;
      overlay.style.display = 'none';
      emitAction('play');
      playBtn.textContent = unmute ? '❚❚' : '🔇';
      playBtn.title = unmute ? 'Pause profile music' : 'Music is autoplaying muted — click for sound';
    }

    // ---- controls ----
    function syncChips() {
      $$('[data-level]').forEach(function (b) { b.classList.toggle('on', b.dataset.level === level); });
      $$('[data-shape]').forEach(function (b) { b.classList.toggle('on', shapes.indexOf(b.dataset.shape) >= 0); });
      $$('[data-fx]').forEach(function (b) { b.classList.toggle('on', fxList.indexOf(b.dataset.fx) >= 0); });
      $$('[data-tex]').forEach(function (b) { b.classList.toggle('on', b.dataset.tex === texture); });
      $$('[data-world]').forEach(function (b) { b.classList.toggle('on', +b.dataset.world === screen); });
      var op = $('.sip-obj-panel'), fp = $('.sip-fx-panel');
      $('.sip-obj-btn').textContent = shapes.length + ' of ' + SHAPES.length + (op.hidden ? ' ▾' : ' ▴');
      $('.sip-fx-btn').textContent = fxList.length + ' of ' + FXDEFS.length + (fp.hidden ? ' ▾' : ' ▴');
    }
    $$('[data-level]').forEach(function (b) { b.addEventListener('click', function () { level = b.dataset.level; lsSet('sml_profile_pulse_level', level.toLowerCase()); rootEl.setAttribute('data-sml-pulse', level.toLowerCase()); syncChips(); }); });
    $$('[data-shape]').forEach(function (b) { b.addEventListener('click', function () { var k = b.dataset.shape, i = shapes.indexOf(k); if (i >= 0) shapes.splice(i, 1); else shapes.push(k); lsSet('sml-pulse-shapes', JSON.stringify(shapes)); syncChips(); }); });
    $$('[data-fx]').forEach(function (b) { b.addEventListener('click', function () { var k = b.dataset.fx, i = fxList.indexOf(k); if (i >= 0) fxList.splice(i, 1); else fxList.push(k); lsSet('sml-screen-fx-list', JSON.stringify(fxList)); syncChips(); }); });
    $$('[data-tex]').forEach(function (b) { b.addEventListener('click', function () { texture = b.dataset.tex; lsSet('sml-card-texture', texture); root.style.setProperty('--card-bg', TEX[texture]); syncChips(); }); });
    $('.sip-all').addEventListener('click', function () { shapes = SHAPES.map(function (d) { return d[0]; }); lsSet('sml-pulse-shapes', JSON.stringify(shapes)); syncChips(); });
    $('.sip-none').addEventListener('click', function () { shapes = []; lsSet('sml-pulse-shapes', JSON.stringify(shapes)); syncChips(); });
    $('.sip-fx-none').addEventListener('click', function () { fxList = []; lsSet('sml-screen-fx-list', JSON.stringify(fxList)); syncChips(); });
    $('.sip-obj-btn').addEventListener('click', function () { var p = $('.sip-obj-panel'); p.hidden = !p.hidden; syncChips(); });
    $('.sip-fx-btn').addEventListener('click', function () { var p = $('.sip-fx-panel'); p.hidden = !p.hidden; syncChips(); });

    // world nav
    function goScreen(i) { var next = (i + 5) % 5; if (next !== screen) { screen = next; emitAction('world'); } syncChips(); }
    $('.sip-prev').addEventListener('click', function () { goScreen(screen - 1); });
    $('.sip-next').addEventListener('click', function () { goScreen(screen + 1); });
    $$('[data-world]').forEach(function (b) { b.addEventListener('click', function () { goScreen(+b.dataset.world); }); });
    // swipe
    var swX = null, swY = 0;
    screens.addEventListener('pointerdown', function (e) {
      swX = null; if (editMode) return;
      if (e.target.closest && e.target.closest('input,button,a,video')) return;
      swX = e.clientX; swY = e.clientY;
    });
    screens.addEventListener('pointerup', function (e) {
      if (swX == null) return; var dx = e.clientX - swX, dy = e.clientY - swY; swX = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) goScreen(screen + (dx < 0 ? 1 : -1));
    });

    // edit mode
    /* Site-wide floating widgets (e.g. the "#sml-ps" profile-song-gift pill) share the
       bottom-left corner with the mobile edit badge; measure whatever is actually
       there instead of guessing a fixed offset, since the widget is conditional. */
    function syncEditBadgeLift() {
      var lift = 0;
      var ps = document.getElementById('sml-ps');
      if (ps) {
        var cs = getComputedStyle(ps);
        if (cs.display !== 'none' && cs.visibility !== 'hidden') {
          var r = ps.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) lift = Math.max(lift, window.innerHeight - r.top + 10);
        }
      }
      document.documentElement.style.setProperty('--sip-badge-lift', Math.max(0, Math.round(lift)) + 'px');
    }
    if (!window.__smlBadgeLiftResize) {
      window.__smlBadgeLiftResize = true;
      window.addEventListener('resize', syncEditBadgeLift, { passive: true });
    }
    function applyEditUI() {
      if (!cfg.isOwner) editMode = false;
      editBadge.hidden = !editMode;
      if (editMode) syncEditBadgeLift();
      $$('[data-editonly]').forEach(function (el) { el.hidden = !editMode; });
      $$('.sip-sec').forEach(function (s) { s.classList.toggle('edit', editMode); s.setAttribute('draggable', editMode ? 'true' : 'false'); });
      var et = $('.sip-edit-toggle'); if (et) et.textContent = editMode ? 'Done' : 'Arrange';
      var pin = $('.sip-psize'), vin = $('.sip-vsize');
      if (pin) pin.value = orbSize('photo'); if (vin) vin.value = orbSize('video');
      var ob = $('.sip-optin'); if (ob) ob.textContent = contactOptIn ? 'Hide my contact info' : 'Show my contact info';
    }
    var editToggle = $('.sip-edit-toggle');
    if (editToggle) editToggle.addEventListener('click', function () { editMode = !editMode; if (!editMode) enlarged = null; applyEditUI(); });
    var dockMore = $('.sip-dock-more'), dockEl = $('.sip-dock');
    if (dockMore && dockEl) dockMore.addEventListener('click', function () { var on = !dockEl.classList.contains('open'); dockEl.classList.toggle('open', on); dockMore.setAttribute('aria-expanded', on ? 'true' : 'false'); dockMore.textContent = on ? 'Looks ▴' : 'Looks ▾'; });
    var editDone = $('.sip-editdone');
    if (editDone) editDone.addEventListener('click', function () { editMode = false; enlarged = null; applyEditUI(); });
    var studioOpen = $('.sip-studio-open');
    if (studioOpen) studioOpen.addEventListener('click', function () { if (window.SML_PROFILE_STUDIO) window.SML_PROFILE_STUDIO.open(); });
    var liveOpen = $('.sip-live-open');
    if (liveOpen) liveOpen.addEventListener('click', function () {
      var bridge = document.querySelector('.sml-live-profile-edit');
      if (bridge) bridge.click();
      else if (window.SML_PROFILE_STUDIO) window.SML_PROFILE_STUDIO.open();
    });
    // Edit live / Full settings kebab menu, next to the CONTACT tab
    var kebabBtn = $('.sip-kebab'), kebabMenu = $('.sip-kebab-menu');
    function closeKebab() { if (!kebabBtn) return; kebabBtn.setAttribute('aria-expanded', 'false'); kebabMenu.hidden = true; }
    if (kebabBtn && kebabMenu) {
      kebabBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = kebabBtn.getAttribute('aria-expanded') === 'true';
        if (open) { closeKebab(); } else { kebabBtn.setAttribute('aria-expanded', 'true'); kebabMenu.hidden = false; }
      });
      kebabMenu.addEventListener('click', function (e) { if (e.target.closest('button')) closeKebab(); });
      document.addEventListener('click', function (e) { if (!e.target.closest('.sip-kebab-wrap')) closeKebab(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeKebab(); });
    }
    // Reactions panel: per-element lane/movement/amplitude
    var reactOpen = $('.sip-react-open'), reactModal = $('.sip-react-modal');
    if (reactOpen && reactModal) {
      function syncReactRows() {
        reactModal.querySelectorAll('.sip-react-row').forEach(function (row) {
          var id = row.querySelector('[data-react-id]').getAttribute('data-react-id');
          var cur = elReact[id] || { lane: 'off', mv: 'none', amp: 1 };
          row.querySelector('.sip-react-lane').value = cur.lane;
          row.querySelector('.sip-react-mv').value = cur.mv;
          row.querySelector('.sip-react-amp').value = cur.amp;
        });
      }
      function openReactModal() { syncReactRows(); reactModal.hidden = false; }
      function closeReactModal() { reactModal.hidden = true; }
      reactOpen.addEventListener('click', openReactModal);
      reactModal.querySelector('.sip-react-close').addEventListener('click', closeReactModal);
      reactModal.querySelector('.sip-react-backdrop').addEventListener('click', closeReactModal);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !reactModal.hidden) closeReactModal(); });
      reactModal.querySelectorAll('.sip-react-group-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var g = btn.getAttribute('data-react-group');
          reactModal.querySelectorAll('.sip-react-group-btn').forEach(function (b) { b.classList.toggle('on', b === btn); });
          reactModal.querySelectorAll('.sip-react-group-section').forEach(function (s) { s.hidden = s.getAttribute('data-react-group') !== g; });
        });
      });
      function saveReactRow(id) {
        var row = reactModal.querySelector('.sip-react-row [data-react-id="' + id + '"]').closest('.sip-react-row');
        var lane = row.querySelector('.sip-react-lane').value;
        var mv = row.querySelector('.sip-react-mv').value;
        var amp = parseFloat(row.querySelector('.sip-react-amp').value) || 1;
        if (lane === 'off' || mv === 'none') { delete elReact[id]; } else { elReact[id] = { lane: lane, mv: mv, amp: amp }; }
        applyElementReactions();
        lsSet('sml-immersive-element-reactions', JSON.stringify(elReact));
      }
      reactModal.addEventListener('change', function (e) {
        var id = e.target.getAttribute('data-react-id');
        if (id) saveReactRow(id);
      });
      reactModal.addEventListener('input', function (e) {
        if (e.target.classList.contains('sip-react-amp')) saveReactRow(e.target.getAttribute('data-react-id'));
      });
    }
    if (cfg.isOwner) mountStudio(mount, cfg);
    /* visitor follow button → clicks the real one underneath and mirrors its state */
    var followBtn = $('.sip-follow');
    if (followBtn) {
      var realFollow = function () { return document.querySelector('button.sml-pfe-action[data-sml-follow]'); };
      var setFollowUI = function (on, busy) { followBtn.textContent = on ? 'Following' : 'Follow'; followBtn.setAttribute('data-on', on ? '1' : '0'); followBtn.disabled = !!busy; };
      var syncFollow = function () {
        var rb = realFollow(); if (!rb) return;
        var on = rb.dataset.following === 'true' || rb.getAttribute('aria-pressed') === 'true';
        followBtn.textContent = on ? (rb.dataset.labelFollowing || 'Following') : (rb.dataset.labelFollow || 'Follow');
        followBtn.setAttribute('data-on', on ? '1' : '0');
        followBtn.disabled = !!rb.disabled;
      };
      var directFollow = function () {
        var nonce = U.nonce || (window.wpApiSettings && window.wpApiSettings.nonce) || '';   /* /members/{id}/ pages ship no unified bootstrap */
        if (!document.body.classList.contains('logged-in') || !nonce) { location.href = '/login/?redirect_to=' + encodeURIComponent(location.href); return; }
        var on = followBtn.getAttribute('data-on') === '1';
        setFollowUI(on, true);
        fetch('/wp-json/sml-members/v1/follow', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce }, body: JSON.stringify({ user_id: cfg.followUid, action: on ? 'unfollow' : 'follow' }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) { setFollowUI(on, false); toast((res.j && res.j.message) || 'Could not update follow.', true); return; }
            var j = res.j || {};
            var now = (typeof j.following === 'boolean') ? j.following : ((typeof j.is_following === 'boolean') ? j.is_following : !on);
            setFollowUI(now, false);
            var cnt = (j.followers_count != null) ? j.followers_count : j.follower_count;
            var stat = Array.prototype.slice.call($$('.sip-stat')).filter(function (st) { return /FOLLOWERS/.test(st.textContent); })[0];
            if (stat && cnt != null) { var v = stat.querySelector('.sip-stat-v'); if (v) v.textContent = String(cnt); }
          }, function () { setFollowUI(on, false); toast('Could not update follow.', true); });
      };
      followBtn.addEventListener('click', function () { emitAction('follow'); var rb = realFollow(); if (rb) { rb.click(); setTimeout(syncFollow, 300); setTimeout(syncFollow, 1500); } else directFollow(); });
      var rbEl = realFollow();
      if (rbEl) { if (window.MutationObserver) new MutationObserver(syncFollow).observe(rbEl, { attributes: true, childList: true, subtree: true }); syncFollow(); }
    }
    var shareBtnEl = $('.sip-share');
    if (shareBtnEl) {
      shareBtnEl.addEventListener('click', function () {
        emitAction('share');
        var url = location.href;
        if (navigator.share) { navigator.share({ title: document.title, url: url }).catch(function () {}); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { toast('Profile link copied'); }, function () { toast('Could not copy the link', true); });
        }
      });
    }

    // Section placement: desktop HTML drag plus Pointer Events for mouse, pen
    // and touch. Positions remain responsive and persist through section_order.
    var dragKey = null;
    function applyOrder() { $$('.sip-sec').forEach(function (s) { s.style.order = sectionOrder.indexOf(s.dataset.sec); }); }
    function moveSection(from, to) {
      if (!from || !to || from === to) return;
      var o = sectionOrder.filter(function (k) { return k !== from; });
      var at = o.indexOf(to); if (at < 0) return;
      o.splice(at, 0, from); sectionOrder = o;
      lsSet('sml-section-order', JSON.stringify(o)); applyOrder();
    }
    $$('.sip-sec').forEach(function (s) {
      s.addEventListener('dragstart', function () { if (editMode) dragKey = s.dataset.sec; });
      s.addEventListener('dragover', function (e) { if (editMode) e.preventDefault(); });
      s.addEventListener('drop', function (e) {
        e.preventDefault(); var from = dragKey, to = s.dataset.sec; dragKey = null;
        moveSection(from, to);
      });
      var pd = null;
      s.addEventListener('pointerdown', function (e) {
        if (!editMode || (e.target.closest && e.target.closest('button,input,a,video'))) return;
        pd = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        try { s.setPointerCapture(e.pointerId); } catch (ignore) {}
      });
      s.addEventListener('pointermove', function (e) {
        if (!pd || pd.id !== e.pointerId || !editMode) return;
        if (!pd.moved && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) < 8) return;
        pd.moved = true; s.classList.add('sip-dragging');
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var target = under && under.closest ? under.closest('.sip-sec') : null;
        $$('.sip-sec').forEach(function (x) { x.classList.toggle('sip-drop-target', x === target && x !== s); });
        if (target && target !== s) moveSection(s.dataset.sec, target.dataset.sec);
        e.preventDefault();
      });
      function endPointer(e) {
        if (!pd || (e && pd.id !== e.pointerId)) return;
        pd = null; s.classList.remove('sip-dragging');
        $$('.sip-sec').forEach(function (x) { x.classList.remove('sip-drop-target'); });
      }
      s.addEventListener('pointerup', endPointer);
      s.addEventListener('pointercancel', endPointer);
    });
    applyOrder();

    // orbital size + item scale
    function orbSize(which) { var st = which === 'photo' ? photoSize : videoSize; if (st != null) return st; return (cfg.orbitalSize == null ? 300 : cfg.orbitalSize); }
    function setOrbSize(which, v) { v = Math.max(180, Math.min(560, parseInt(v, 10) || 300)); if (which === 'photo') photoSize = v; else videoSize = v; lsSet('sml-orbital-' + which + '-size', String(v)); }
    var ps = $('.sip-psize'), vs = $('.sip-vsize');
    if (ps) ps.addEventListener('input', function () { setOrbSize('photo', ps.value); });
    if (vs) vs.addEventListener('input', function () { setOrbSize('video', vs.value); });
    function bumpItem(ring, i, d) { var arr = itemScales[ring]; arr[i] = Math.max(0.5, Math.min(2.2, Math.round((arr[i] + d) * 10) / 10)); lsSet('sml-orbital-item-scales', JSON.stringify(itemScales)); }
    $$('[data-osmall]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var p = b.dataset.osmall.split(':'); bumpItem(p[0], +p[1], -0.1); }); });
    $$('[data-obig]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var p = b.dataset.obig.split(':'); bumpItem(p[0], +p[1], 0.1); }); });
    $$('[data-ophoto]').forEach(function (cell) { cell.addEventListener('dblclick', function () { if (!editMode) return; pickFile('ophoto', +cell.dataset.ophoto); }); });
    $$('[data-ozoom]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var i = +b.dataset.ozoom; enlarged = (enlarged && enlarged.ring === 'photo' && enlarged.i === i) ? null : { ring: 'photo', i: i }; }); });

    // media pickers — REAL: upload to the profile engine, save the slot, everyone sees it.
    // Rings and galleries use independent slots. Legacy gallery items that were
    // stored after the ring items are still read below, but all new writes go to
    // gallery_photo / gallery_video so empty positions cannot collapse into a ring.
    var MEDIA = (cfg.__media && typeof cfg.__media === 'object') ? cfg.__media : { orbital: [], orbital_video: [], gallery_photo: [], gallery_video: [] };
    var U = window.SML_PROFILE_UNIFIED || {};
    function canPersist() { return !!(U.isOwner && U.nonce && U.uploadRest); }
    onLsSet = (U.isOwner && U.nonce && U.customRest) ? function (k) { if (IMMERSIVE_KEYS[k]) schedulePersist(); } : null;
    persistArmed = false; setTimeout(function () { if (GEN === INIT_GEN) persistArmed = true; }, 3000);
    function uploadFile(file, purpose) {
      var fd = new FormData(); fd.append('file', file); fd.append('purpose', purpose);
      return fetch(U.uploadRest + (U.uploadRest.indexOf('?') > -1 ? '&' : '?') + 'purpose=' + encodeURIComponent(purpose), { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': U.nonce }, body: fd })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'Upload failed'); return j; }); });
    }
    function saveSlot(slot, items) {
      var base = (U.customRest || '').replace(/customization.*$/, '') || '/wp-json/sml-profile/v2/profile/';
      return fetch(base + 'media', { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': U.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify({ slot_type: slot, items: items.map(function (it) { return { attachment_id: it.attachment_id, caption: it.caption || '', url: it.url || '' }; }) }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'Save failed'); return j; }); });
    }
    function setSlotItem(list, idx, item) { while (list.length < idx) list.push(null); list[idx] = item; return list.filter(function (x) { return !!x; }); }
    /* SAFETY: the media POST replaces the whole slot. Never build it from a seed that
       could be stale or empty — re-read the live list first, then merge one item in. */
    function currentSlot(slot) {
      var base = (U.customRest || '').replace(/customization.*$/, '') || '/wp-json/sml-profile/v2/profile/';
      return fetch(base + U.userId + '/media', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
        if (!m || !Array.isArray(m[slot])) throw new Error('Could not read your current ' + (slot === 'orbital' ? 'photos' : 'videos') + ' — nothing was changed.');
        return m[slot].map(function (it) { return { attachment_id: it.attachment_id, caption: it.caption || '', url: it.url && !/^https?:\/\/[^\/]*stockmarketloop\.com/.test(it.url) ? it.url : '' }; });
      });
    }
    function toast(msg, bad) { var t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483646;background:' + (bad ? '#3a1218' : '#0f2a1c') + ';color:' + (bad ? '#ff859f' : '#8dffc2') + ';border:1px solid ' + (bad ? '#7a2334' : '#1c6b45') + ';border-radius:10px;padding:10px 14px;font:600 12px/1 Archivo,sans-serif;'; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
    function pickFile(kind, idx) { pickKind = kind; pickIdx = idx; ((kind === 'gphoto' || kind === 'ophoto') ? imgInput : vidInput).click(); }
    function mediaEndpoint(path, payload) {
      var base = (U.customRest || '').replace(/customization.*$/, '') || '/wp-json/sml-profile/v2/profile/';
      return fetch(base + path, { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': U.nonce, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'Media update failed'); return j; }); });
    }
    function collectMediaDetails(file) {
      return new Promise(function (resolve) {
        var modal = document.createElement('div'); modal.className = 'sip-media-meta';
        var suggested = String(file.name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        modal.innerHTML = '<form class="sip-media-meta-card"><h3>Photo/video details</h3><p>Add a clear title so people and search engines understand this upload. You can optionally tag up to 10 members.</p><label>Title (required)</label><input name="title" maxlength="120" minlength="3" required placeholder="Describe this upload" value="' + esc(suggested) + '"><label>Tag members (optional)</label><input name="tags" maxlength="240" placeholder="@grandmasterobi, @anothermember"><div class="sip-media-meta-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Continue upload</button></div></form>';
        document.body.appendChild(modal);
        var form = modal.querySelector('form'), title = form.elements.title;
        setTimeout(function () { title.focus(); title.select(); }, 0);
        modal.querySelector('[data-cancel]').addEventListener('click', function () { modal.remove(); resolve(null); });
        modal.addEventListener('click', function (e) { if (e.target === modal) { modal.remove(); resolve(null); } });
        form.addEventListener('submit', function (e) {
          e.preventDefault(); var cleanTitle = title.value.trim();
          if (cleanTitle.length < 3) { title.setCustomValidity('Add a title of at least 3 characters.'); title.reportValidity(); return; }
          title.setCustomValidity('');
          var tags = String(form.elements.tags.value || '').split(/[\s,]+/).map(function (v) { return v.replace(/^@/, '').trim(); }).filter(Boolean).slice(0, 10);
          modal.remove(); resolve({ title: cleanTitle, tags: tags });
        });
      });
    }
    function finishUpload(file, kind, idx, details) {
      if (!canPersist()) { toast('Sign in as the profile owner to save media.', true); return; }
      var isVideo = kind === 'ovideo' || kind === 'gvideo';
      var slot = kind === 'ovideo' ? 'orbital_video' : kind === 'gvideo' ? 'gallery_video' : kind === 'gphoto' ? 'gallery_photo' : 'orbital';
      return uploadFile(file, isVideo ? 'orbital_video' : 'photo').then(function (att) {
        return mediaEndpoint('media/details', { attachment_id: att.id, title: details.title, tags: details.tags }).then(function () {
          return currentSlot(slot).then(function (items) {
            items = setSlotItem(items, idx, { attachment_id: att.id, caption: details.title, url: '' });
            return saveSlot(slot, items).then(function (saved) {
              MEDIA[slot] = Array.isArray(saved) ? saved : items;
              toast('Upload saved to your profile.');
              setTimeout(function () { location.reload(); }, 500);
            });
          });
        });
      }).catch(function (e) { toast(e.message || 'Could not save the upload.', true); });
    }
    vidInput.addEventListener('change', function () {
      var f = vidInput.files && vidInput.files[0]; if (!f) return; var kind = pickKind, idx = pickIdx; vidInput.value = '';
      collectMediaDetails(f).then(function (details) { if (details) finishUpload(f, kind, idx, details); });
    });
    imgInput.addEventListener('change', function () {
      var f = imgInput.files && imgInput.files[0]; if (!f) return; var kind = pickKind, idx = pickIdx; imgInput.value = '';
      collectMediaDetails(f).then(function (details) { if (details) finishUpload(f, kind, idx, details); });
    });
    function renderOrbVideo(i) {
      var cell = $('[data-ovideo="' + i + '"]'); if (!cell) return;
      var ph = cell.querySelector('[data-vph]'); if (ph) ph.style.display = 'none';
      var old = cell.querySelector('video'); if (old) old.remove();
      var v = document.createElement('video'); v.src = videos[i]; v.autoplay = v.muted = v.loop = v.playsInline = true; v.setAttribute('playsinline', '');
      cell.insertBefore(v, cell.firstChild);
    }
    function renderGalVideo(i) {
      var cell = $('[data-gvideo="' + i + '"]'); if (!cell) return; cell.innerHTML = '';
      var v = document.createElement('video'); v.src = gvids[i]; v.autoplay = v.muted = v.loop = v.playsInline = true; v.setAttribute('playsinline', '');
      cell.appendChild(v);
    }
    $$('[data-ovideo]').forEach(function (cell) {
      cell.addEventListener('click', function () { var i = +cell.dataset.ovideo; if (!editMode) return; if (videos[i]) { enlarged = (enlarged && enlarged.ring === 'video' && enlarged.i === i) ? null : { ring: 'video', i: i }; } else pickFile('ovideo', i); });
    });
    $$('[data-gvideo]').forEach(function (cell) { cell.addEventListener('click', function () { var i = +cell.dataset.gvideo; if (editMode && !(cfg.galleryVideos || [])[i]) pickFile('gvideo', i); }); });
    $$('[data-gphoto]').forEach(function (cell) { cell.addEventListener('click', function () { var i = +cell.dataset.gphoto; if (editMode) pickFile('gphoto', i); }); });
    $$('.sip-media-tags a').forEach(function (link) { link.addEventListener('click', function (e) { e.stopPropagation(); }); });
    /* Lazy playback for slot videos (measured 2026-08-22: the profile rendered
       13 <video autoplay> at once — 13 concurrent downloads + decodes competing
       with the page's data fetches, and a browser media-throttling breakage
       risk). Slot videos now render paused with preload="metadata" and only
       play while actually on screen; banner/background keep autoplay (they ARE
       the visible design). Falls back to play-everything if IntersectionObserver
       is unavailable — same behavior as before, never a black tile. */
    (function () {
      var lazies = $$('[data-lazyvid]'); if (!lazies.length) return;
      if (typeof IntersectionObserver !== 'function') { lazies.forEach(function (v) { try { v.play(); } catch (e) {} }); return; }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var v = en.target;
          if (en.isIntersecting) { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
          else if (!v.paused) { try { v.pause(); } catch (e) {} }
        });
      }, { threshold: 0.2 });
      lazies.forEach(function (v) { io.observe(v); });
    })();
    $$('[data-gallery-manage]').forEach(function (button) {
      button.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var on = !root.classList.contains('sip-manage');
        root.classList.toggle('sip-manage', on);
        if (!on) { $$('[data-gallery-pick]').forEach(function (c) { c.checked = false; }); syncPicks(); }
        $$('[data-gallery-manage]').forEach(function (b) { b.textContent = on ? 'Done' : 'Manage'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      });
    });
    function picked() { return $$('[data-gallery-pick]').filter(function (c) { return c.checked; }); }
    function syncPicks() {
      var n = picked().length;
      $$('[data-gallery-pick]').forEach(function (c) { var tile = c.closest('.sip-galphoto,.sip-galvid,.sip-orb-photo,.sip-orb-video'); if (tile) tile.classList.toggle('sip-picked', c.checked); });
      $$('[data-gallery-bulk]').forEach(function (b) { b.hidden = n === 0; b.textContent = 'Delete selected (' + n + ')'; });
    }
    $$('[data-gallery-pick]').forEach(function (c) {
      c.addEventListener('click', function (e) { e.stopPropagation(); });
      c.parentNode.addEventListener('click', function (e) { e.stopPropagation(); });
      c.addEventListener('change', syncPicks);
    });
    $$('[data-gallery-bulk]').forEach(function (button) {
      button.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var list = picked(); if (!list.length || !canPersist()) return;
        if (!window.confirm('Delete ' + list.length + ' upload' + (list.length === 1 ? '' : 's') + ' permanently? This removes them from the gallery and the files from the website.')) return;
        $$('[data-gallery-bulk]').forEach(function (b) { b.disabled = true; b.textContent = 'Deleting…'; });
        var failed = 0;
        list.reduce(function (chain, c) {
          var parts = c.dataset.galleryPick.split(':'), slot = parts[0], attachmentId = Number(parts[2] || 0);
          return chain.then(function () { return attachmentId ? mediaEndpoint('media/delete', { slot_type: slot, attachment_id: attachmentId }).catch(function () { failed++; }) : null; });
        }, Promise.resolve()).then(function () {
          toast(failed ? ((list.length - failed) + ' deleted, ' + failed + ' failed.') : (list.length + ' upload' + (list.length === 1 ? '' : 's') + ' permanently deleted.'));
          setTimeout(function () { location.reload(); }, 600);
        });
      });
    });
    $$('[data-gallery-delete]').forEach(function (button) {
      button.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var parts = button.dataset.galleryDelete.split(':'), slot = parts[0], attachmentId = Number(parts[2] || 0);
        if (!attachmentId || !canPersist()) return;
        if (!window.confirm('Delete this upload permanently? This removes the gallery item and the file from the website.')) return;
        button.disabled = true; button.textContent = 'Deleting…';
        mediaEndpoint('media/delete', { slot_type: slot, attachment_id: attachmentId }).then(function () { toast('Upload permanently deleted.'); setTimeout(function () { location.reload(); }, 450); }).catch(function (err) { button.disabled = false; button.textContent = 'Delete'; toast(err.message || 'Could not delete the upload.', true); });
      });
    });
    $$('[data-gallery-add]').forEach(function (button) {
      button.addEventListener('click', function () {
        var isPhoto = button.dataset.galleryAdd === 'photo';
        var list = isPhoto ? (cfg.galleryPhotos || []) : (cfg.galleryVideos || []);
        var limit = isPhoto ? 8 : 6, idx = -1;
        for (var x = 0; x < limit; x++) { if (!list[x]) { idx = x; break; } }
        if (idx < 0) { toast('This gallery is full. Enter Arrange mode and select a tile to replace it.', true); return; }
        pickFile(isPhoto ? 'gphoto' : 'gvideo', idx);
      });
    });

    // contact opt-in
    function applyContact() {
      var inn = $('.sip-contact-in'), out = $('.sip-contact-out');
      if (inn) inn.style.display = contactOptIn ? '' : 'none';
      if (out) out.style.display = contactOptIn ? 'none' : '';
    }
    var optBtn = $('.sip-optin');
    if (optBtn) optBtn.addEventListener('click', function () { contactOptIn = !contactOptIn; lsSet('sml-contact-optin', contactOptIn ? '1' : '0'); applyContact(); applyEditUI(); });
    applyContact();

    // Beat-sensitivity slider (0.5–2, persisted) — scales how hard the visuals react.
    var bsens = $('.sip-bsens');
    if (bsens) { bsens.value = beatSens; bsens.addEventListener('input', function () { var v = parseFloat(bsens.value); if (v >= 0.5 && v <= 2) { beatSens = v; lsSet('sml-beat-sens', String(v)); } }); }

    // Exit to the NATIVE profile (Customize profile, Settings, reactions — every
    // real ability). The overlay only hides that page; this reveals it, with a
    // floating button to return. Nothing the user had is removed.
    function setImmersive(on) {
      var m = document.getElementById('sml-immersive-profile-root');
      if (m) m.style.display = on ? '' : 'none';
      try { document.documentElement.style.overflow = on ? 'hidden' : ''; document.body.style.overflow = on ? 'hidden' : ''; } catch (e) {}
      var re = document.getElementById('sml-ip-reenter');
      if (!on) {
        if (!re) { re = document.createElement('button'); re.id = 'sml-ip-reenter'; re.className = 'sip-reenter'; re.textContent = '✦ Immersive view'; re.addEventListener('click', function () { setImmersive(true); }); document.body.appendChild(re); }
        re.style.display = '';
      } else if (re) { re.style.display = 'none'; }
    }
    var exitBtn = $('.sip-exit');
    if (exitBtn) exitBtn.addEventListener('click', function () { setImmersive(false); });

    // transport
    playBtn.addEventListener('click', function () {
      if (!frame) return;
      if (playing && !soundEnabled) { startPlayback(true); }
      else if (playing) { cmd('pauseVideo'); markPlaying(false); playBtn.textContent = '▶'; playBtn.title = 'Play profile music'; }
      else { startPlayback(true); }
    });
    wfWrap.addEventListener('click', function (e) { if (!duration) return; var r = wfWrap.getBoundingClientRect(); cmd('seekTo', [duration * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), true]); });
    overlay.addEventListener('click', function () { emitAction('enter'); startPlayback(true); });
    /* Browsers permit reliable autoplay only while muted. Honour the saved
       setting immediately, then let the persistent Play pill enable sound with
       one gesture instead of covering the profile with a click gate. */
    if (cfg.autoplay && frame && cfg.isOwner) setTimeout(function () { startPlayback(false); }, 700);

    root.style.setProperty('--card-bg', TEX[texture]);
    applyComponentState();
    rootEl.setAttribute('data-sml-pulse', level.toLowerCase());
    syncChips();
    applyEditUI();

    // ---- FX drawing state ----
    var particles = [], ripples = [], drops = [], qFlashes = [], quanta = null, fogs = null,
      flakes = null, motes = null, embers = [], bolts = [], glitchT = 0, energyT = 0, sig = '', sec = -1;
    function hasFx(v) { return fxList.indexOf(v) >= 0; }

    function onKick(m) {
      if (m <= 0.01) return;
      var W = window.innerWidth, H = window.innerHeight;
      var r = avatar.getBoundingClientRect();
      ripples.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: 12, a: 0.5 * m, w: 2.5 });
      if (ripples.length > 7) ripples.shift();
      if (hasFx('Waves')) { drops.push({ x: Math.random() * W, y: Math.random() * H, r: 6, a: 0.42 * m, ry: 0.42, v: 3.2, w: 2.2 }); if (drops.length > 26) drops.shift(); }
      if (hasFx('Lightning') && Math.random() < 0.45) {
        var x0 = Math.random() * W, pts = [[x0, 0]], px = x0, py = 0;
        while (py < H * (0.4 + Math.random() * 0.4)) { px += (Math.random() - 0.5) * 90; py += 30 + Math.random() * 50; pts.push([px, py]); }
        bolts.push({ pts: pts, a: 0.85 * m, flash: 0.16 * m }); if (bolts.length > 3) bolts.shift();
      }
      if (hasFx('Glitch')) glitchT = 7;
      if (hasFx('Quantum') && particles.length) {
        var qp = particles[Math.floor(Math.random() * particles.length)];
        if (qp) { qFlashes.push({ x: qp.x, y: qp.y, r: 3, a: 0.55 * m }); qp.x = Math.random() * W; qp.y = Math.random() * H; qp.pulse = Math.min(1.4, qp.pulse + m); qFlashes.push({ x: qp.x, y: qp.y, r: 3, a: 0.55 * m }); if (qFlashes.length > 14) qFlashes.splice(0, qFlashes.length - 14); }
      }
      var n = Math.floor(particles.length * 0.35);
      for (var i = 0; i < n; i++) { var p = particles[Math.floor(Math.random() * particles.length)]; if (!p) break; p.pulse = Math.min(1.4, p.pulse + m); p.vx += (Math.random() - 0.5) * 1.3 * m; p.vy += (Math.random() - 0.5) * 1.3 * m; }
    }
    function drawShape(x, t, r, rot) {
      var ci = CAT.shapes[t]; if (ci && ci.kind !== 'glyph') { drawCat(x, ci, r, rot || 0); return; }
      if (GLYPHS[t]) { x.font = '600 ' + Math.max(7, Math.round(r * 4.5)) + 'px "IBM Plex Sans", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(GLYPHS[t], 0, 0); return; }
      var s = r * 1.8, i, a2, rr, px, py;
      switch (t) {
        case 'ring': x.beginPath(); x.arc(0, 0, r * 1.6, 0, 6.284); x.stroke(); break;
        case 'vinyl': x.beginPath(); x.arc(0, 0, r * 1.7, 0, 6.284); x.stroke(); x.beginPath(); x.arc(0, 0, r * 0.5, 0, 6.284); x.fill(); break;
        case 'diamond': x.beginPath(); x.moveTo(0, -s); x.lineTo(s, 0); x.lineTo(0, s); x.lineTo(-s, 0); x.closePath(); x.stroke(); break;
        case 'plus': x.beginPath(); x.moveTo(-s, 0); x.lineTo(s, 0); x.moveTo(0, -s); x.lineTo(0, s); x.stroke(); break;
        case 'cross': x.beginPath(); x.moveTo(-s * 0.8, -s * 0.8); x.lineTo(s * 0.8, s * 0.8); x.moveTo(s * 0.8, -s * 0.8); x.lineTo(-s * 0.8, s * 0.8); x.stroke(); break;
        case 'tri': x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.9, s * 0.7); x.lineTo(-s * 0.9, s * 0.7); x.closePath(); x.stroke(); break;
        case 'square': x.strokeRect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4); break;
        case 'pill': x.beginPath(); if (x.roundRect) x.roundRect(-s, -s * 0.5, s * 2, s, s * 0.5); else x.rect(-s, -s * 0.5, s * 2, s); x.stroke(); break;
        case 'hex': x.beginPath(); for (i = 0; i < 6; i++) { a2 = i * Math.PI / 3; px = Math.cos(a2) * s; py = Math.sin(a2) * s; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.stroke(); break;
        case 'star': x.beginPath(); for (i = 0; i < 10; i++) { a2 = -Math.PI / 2 + i * Math.PI / 5; rr = i % 2 ? s * 0.45 : s; px = Math.cos(a2) * rr; py = Math.sin(a2) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.stroke(); break;
        case 'sparkle': x.beginPath(); for (i = 0; i < 8; i++) { a2 = -Math.PI / 2 + i * Math.PI / 4; rr = i % 2 ? s * 0.28 : s; px = Math.cos(a2) * rr; py = Math.sin(a2) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.fill(); break;
        case 'candle': x.beginPath(); x.moveTo(0, -s); x.lineTo(0, s); x.stroke(); x.fillRect(-s * 0.35, -s * 0.5, s * 0.7, s); break;
        case 'spark': x.beginPath(); x.moveTo(-s, s * 0.5); x.lineTo(-s * 0.4, -s * 0.2); x.lineTo(0, s * 0.2); x.lineTo(s * 0.5, -s * 0.6); x.lineTo(s, -s * 0.1); x.stroke(); break;
        case 'bars': x.fillRect(-s * 0.8, -s * 0.3, s * 0.4, s * 1.1); x.fillRect(-s * 0.2, -s * 0.8, s * 0.4, s * 1.6); x.fillRect(s * 0.4, -s * 0.1, s * 0.4, s * 0.9); break;
        case 'arc': x.beginPath(); x.arc(0, s * 0.3, s, Math.PI, 2 * Math.PI); x.stroke(); break;
        default: x.beginPath(); x.arc(0, 0, r, 0, 6.284); x.fill();
      }
    }
    function drawWave() {
      if (!wf.clientWidth) return;
      var w = wf.clientWidth, h = wf.clientHeight, dpr = window.devicePixelRatio || 1;
      if (wf.width !== Math.floor(w * dpr)) { wf.width = Math.floor(w * dpr); wf.height = Math.floor(h * dpr); }
      var x = wf.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      var prog = duration ? nowTime() / duration : 0, N = wavePeaks.length, bw = w / N;
      for (var i = 0; i < N; i++) { var bh = Math.max(2, wavePeaks[i] * (h - 6)); x.fillStyle = (i / N <= prog) ? '#38F58A' : 'rgba(230,237,245,.18)'; x.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1.6), bh); }
    }
    function drawFx(bass, mid) {
      curBass = bass; curMid = mid;
      var dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
      if (fx.width !== Math.floor(W * dpr)) { fx.width = Math.floor(W * dpr); fx.height = Math.floor(H * dpr); }
      var x = fx.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
      var pd = Math.round(cfg.particleDensity), s2 = pd + '|' + shapes.join(',');
      if (sig !== s2) {
        sig = s2; particles = [];
        for (var i = 0; i < (shapes.length ? pd : 0); i++) particles.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, r: 1.5 + Math.random() * 3.5, c: COLS[i % COLS.length], t: shapes[i % shapes.length], a: 0.08 + Math.random() * 0.3, pulse: 0, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.02 });
      }
      var sp = 0.35 + mid * 2.4;
      for (var j = 0; j < particles.length; j++) {
        var p = particles[j]; p.x += p.vx * sp; p.y += p.vy * sp; p.rot += p.vr * (1 + p.pulse * 4);
        if (p.x < -24) p.x = W + 24; if (p.x > W + 24) p.x = -24; if (p.y < -24) p.y = H + 24; if (p.y > H + 24) p.y = -24;
        p.pulse *= 0.93; var r = p.r * (1 + p.pulse * 1.6 + bass * 0.7);
        x.globalAlpha = Math.min(1, p.a + p.pulse * 0.5 + bass * 0.15); x.strokeStyle = x.fillStyle = p.c; x.lineWidth = 1.4;
        x.save(); x.translate(p.x, p.y); x.rotate(p.rot); drawShape(x, p.t, r); x.restore();
      }
      x.globalAlpha = 1;
      if (hasFx('Fog')) {
        if (!fogs) fogs = mk(6, function () { return { x: Math.random() * W, y: Math.random() * H, r: 160 + Math.random() * 220, vx: 0.14 + Math.random() * 0.3, a: 0.05 + Math.random() * 0.05 }; });
        for (var fi = 0; fi < fogs.length; fi++) { var fg = fogs[fi]; fg.x += fg.vx * (1 + mid * 2); if (fg.x - fg.r > W) fg.x = -fg.r; var gr = x.createRadialGradient(fg.x, fg.y, 0, fg.x, fg.y, fg.r); gr.addColorStop(0, 'rgba(141,255,194,' + (fg.a + bass * 0.04).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(141,255,194,0)'); x.fillStyle = gr; x.beginPath(); x.arc(fg.x, fg.y, fg.r, 0, 6.284); x.fill(); }
      } else fogs = null;
      if (hasFx('Snow')) {
        if (!flakes) flakes = mk(70, function () { return { x: Math.random() * W, y: Math.random() * H, v: 0.5 + Math.random() * 1.3, ph: Math.random() * 6.28, r: 1 + Math.random() * 2.2 }; });
        x.fillStyle = 'rgba(230,237,245,.65)';
        for (var si = 0; si < flakes.length; si++) { var fl = flakes[si]; fl.y += fl.v * (1 + bass * 1.5); fl.ph += 0.02; fl.x += Math.sin(fl.ph) * 0.6; if (fl.y > H + 4) { fl.y = -4; fl.x = Math.random() * W; } x.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(fl.ph)); x.beginPath(); x.arc(fl.x, fl.y, fl.r, 0, 6.284); x.fill(); }
        x.globalAlpha = 1;
      } else flakes = null;
      if (hasFx('Dust')) {
        if (!motes) motes = mk(44, function () { return { x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.2, vy: -0.08 - Math.random() * 0.25, r: 0.7 + Math.random() * 1.4, ph: Math.random() * 6.28 }; });
        x.fillStyle = 'rgba(255,176,32,.5)';
        for (var di = 0; di < motes.length; di++) { var mt = motes[di]; mt.x += mt.vx; mt.y += mt.vy; mt.ph += 0.03; if (mt.y < -4) { mt.y = H + 4; mt.x = Math.random() * W; } if (mt.x < 0) mt.x = W; if (mt.x > W) mt.x = 0; x.globalAlpha = 0.15 + 0.3 * Math.abs(Math.sin(mt.ph)) + bass * 0.2; x.beginPath(); x.arc(mt.x, mt.y, mt.r, 0, 6.284); x.fill(); }
        x.globalAlpha = 1;
      } else motes = null;
      if (hasFx('Embers')) {
        if (Math.random() < 0.12 + bass * 0.5) embers.push({ x: Math.random() * W, y: H + 6, vx: (Math.random() - 0.5) * 0.5, vy: -(0.8 + Math.random() * 1.6), r: 1 + Math.random() * 2, a: 0.7, ph: Math.random() * 6.28 });
        if (embers.length > 60) embers.shift();
        for (var ei = embers.length - 1; ei >= 0; ei--) { var em = embers[ei]; em.x += em.vx + Math.sin(em.ph += 0.05) * 0.4; em.y += em.vy * (1 + mid); em.a *= 0.995; if (em.y < -6 || em.a < 0.05) { embers.splice(ei, 1); continue; } x.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,120,40' : '255,176,32') + ',' + (em.a * (0.6 + 0.4 * Math.sin(em.ph * 3))).toFixed(3) + ')'; x.beginPath(); x.arc(em.x, em.y, em.r, 0, 6.284); x.fill(); }
      } else embers.length = 0;
      if (hasFx('Energy')) {
        energyT += 0.03 + mid * 0.12; x.lineWidth = 1.6;
        for (var b2 = 0; b2 < 2; b2++) { x.strokeStyle = b2 ? 'rgba(61,139,253,' + (0.1 + mid * 0.35).toFixed(3) + ')' : 'rgba(56,245,138,' + (0.14 + bass * 0.4).toFixed(3) + ')'; x.beginPath(); var yBase = H * (b2 ? 0.66 : 0.33); for (var px2 = 0; px2 <= W; px2 += 12) { var y2 = yBase + Math.sin(px2 * 0.008 + energyT * (b2 ? -1.3 : 1)) * (26 + mid * 90) + Math.sin(px2 * 0.02 - energyT * 2) * 8; px2 ? x.lineTo(px2, y2) : x.moveTo(px2, y2); } x.stroke(); }
      }
      for (var bi = bolts.length - 1; bi >= 0; bi--) {
        var bl = bolts[bi]; bl.a *= 0.82; bl.flash *= 0.8; if (bl.a < 0.03) { bolts.splice(bi, 1); continue; }
        if (bl.flash > 0.01) { x.fillStyle = 'rgba(230,240,255,' + bl.flash.toFixed(3) + ')'; x.fillRect(0, 0, W, H); }
        x.strokeStyle = 'rgba(230,240,255,' + bl.a.toFixed(3) + ')'; x.lineWidth = 2.2;
        x.beginPath(); for (var bj = 0; bj < bl.pts.length; bj++) { bj ? x.lineTo(bl.pts[bj][0], bl.pts[bj][1]) : x.moveTo(bl.pts[bj][0], bl.pts[bj][1]); } x.stroke();
        x.strokeStyle = 'rgba(141,255,194,' + (bl.a * 0.5).toFixed(3) + ')'; x.lineWidth = 5; x.stroke();
      }
      if (glitchT > 0 && hasFx('Glitch')) {
        glitchT--;
        for (var gi = 0; gi < 5; gi++) { var gy = Math.random() * H, gh = 2 + Math.random() * 10, gw = 60 + Math.random() * (W * 0.5), gx = Math.random() * W; x.fillStyle = gi % 2 ? 'rgba(56,245,138,' + (0.06 + Math.random() * 0.12).toFixed(3) + ')' : 'rgba(255,92,122,' + (0.05 + Math.random() * 0.1).toFixed(3) + ')'; x.fillRect(gx - gw / 2, gy, gw, gh); }
      }
      if (hasFx('Quantum')) {
        x.lineWidth = 1;
        for (var qi = 0; qi < particles.length; qi++) { var a1 = particles[qi]; for (var qj = qi + 1; qj < particles.length; qj++) { var b1 = particles[qj], ddx = a1.x - b1.x, ddy = a1.y - b1.y, d2 = ddx * ddx + ddy * ddy; if (d2 < 16900) { var al = (1 - Math.sqrt(d2) / 130) * (0.1 + bass * 0.5); x.strokeStyle = 'rgba(56,245,138,' + al.toFixed(3) + ')'; x.beginPath(); x.moveTo(a1.x, a1.y); x.lineTo(b1.x, b1.y); x.stroke(); } } }
        if (!quanta) quanta = mk(7, function () { return { x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, ph: Math.random() * 6.28, sp: 0.03 + Math.random() * 0.04, s: 14 + Math.random() * 16, tilt: Math.random() * 3.14 }; });
        for (var qk = 0; qk < quanta.length; qk++) { var q = quanta[qk]; q.x += q.vx; q.y += q.vy; q.ph += q.sp * (1 + mid * 4); if (q.x < -40) q.x = W + 40; if (q.x > W + 40) q.x = -40; if (q.y < -40) q.y = H + 40; if (q.y > H + 40) q.y = -40; var glow = 0.16 + bass * 0.5; x.save(); x.translate(q.x, q.y); x.rotate(q.tilt); x.strokeStyle = 'rgba(141,255,194,' + (glow * 0.6).toFixed(3) + ')'; x.lineWidth = 1; x.beginPath(); x.ellipse(0, 0, q.s, q.s * 0.38, 0, 0, 6.284); x.stroke(); x.beginPath(); x.ellipse(0, 0, q.s, q.s * 0.38, 1.57, 0, 6.284); x.stroke(); x.fillStyle = 'rgba(56,245,138,' + Math.min(1, glow + 0.25).toFixed(3) + ')'; x.beginPath(); x.arc(0, 0, 2.4 + bass * 3, 0, 6.284); x.fill(); x.beginPath(); x.arc(Math.cos(q.ph) * q.s, Math.sin(q.ph) * q.s * 0.38, 1.8, 0, 6.284); x.fill(); x.beginPath(); x.arc(-Math.sin(q.ph) * q.s * 0.38, Math.cos(q.ph) * q.s, 1.8, 0, 6.284); x.fill(); x.restore(); }
        for (var fli = qFlashes.length - 1; fli >= 0; fli--) { var qf = qFlashes[fli]; qf.r += 3.4; qf.a *= 0.9; if (qf.a < 0.02) { qFlashes.splice(fli, 1); continue; } x.lineWidth = 1.6; x.strokeStyle = 'rgba(141,255,194,' + qf.a.toFixed(3) + ')'; x.beginPath(); x.arc(qf.x, qf.y, qf.r, 0, 6.284); x.stroke(); x.strokeStyle = 'rgba(56,245,138,' + (qf.a * 0.6).toFixed(3) + ')'; x.beginPath(); x.arc(qf.x, qf.y, qf.r * 0.55, 0, 6.284); x.stroke(); }
      } else { quanta = null; qFlashes.length = 0; }
      if (hasFx('Rain') && Math.random() < 0.05 + bass * 0.35) { drops.push({ x: Math.random() * W, y: Math.random() * H, r: 1.5, a: 0.55, ry: 0.32 + Math.random() * 0.18, v: 2 + Math.random() * 2.4, w: 1.5 }); if (drops.length > 40) drops.shift(); }
      else if (hasFx('Waves') && Math.random() < 0.012) { drops.push({ x: Math.random() * W, y: Math.random() * H, r: 4, a: 0.35, ry: 0.42, v: 2.6, w: 2 }); }
      for (var dj = drops.length - 1; dj >= 0; dj--) { var d = drops[dj]; d.r += d.v; d.a *= hasFx('Waves') ? 0.965 : 0.945; if (d.a < 0.02 || (!hasFx('Rain') && !hasFx('Waves'))) { drops.splice(dj, 1); continue; } x.lineWidth = d.w; x.strokeStyle = 'rgba(56,245,138,' + d.a.toFixed(3) + ')'; x.beginPath(); x.ellipse(d.x, d.y, d.r, d.r * d.ry, 0, 0, 6.284); x.stroke(); x.strokeStyle = 'rgba(230,237,245,' + (d.a * 0.5).toFixed(3) + ')'; x.beginPath(); x.ellipse(d.x, d.y, d.r * 0.62, d.r * d.ry * 0.62, 0, 0, 6.284); x.stroke(); }
      for (var ri = ripples.length - 1; ri >= 0; ri--) { var rp = ripples[ri]; rp.r += 7 + rp.r * 0.045; rp.a *= 0.94; if (rp.a < 0.02 || rp.r > Math.max(W, H)) { ripples.splice(ri, 1); continue; } x.beginPath(); x.arc(rp.x, rp.y, rp.r, 0, 6.284); x.strokeStyle = 'rgba(56,245,138,' + rp.a.toFixed(3) + ')'; x.lineWidth = rp.w; x.stroke(); }
      runPresets(x, W, H, bass, mid);
    }
    function mk(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f()); return a; }
    /* ---------------- Looks library renderers ---------------- */
    var curBass = 0, curMid = 0, presetPools = {};
    function drawCat(x, ci, r, rot) {
      var s = r * 1.9, i, a2, rr, px, py;
      if (ci.kind === 'path') {
        if (ci._p === undefined) { try { ci._p = new Path2D(ci.d); } catch (e) { ci._p = null; } }
        if (!ci._p) { x.beginPath(); x.arc(0, 0, r, 0, 6.284); x.stroke(); return; }
        var b = ci.box || 24, k = (s * 2) / b; x.save(); x.scale(k, k); x.translate(-b / 2, -b / 2); x.lineWidth = 1.5 / k; if (ci.fill) x.fill(ci._p); else x.stroke(ci._p); x.restore(); return;
      }
      if (ci.kind === 'poly') { var n = ci.sides || 5, m = ci.star ? n * 2 : n; x.beginPath(); for (i = 0; i < m; i++) { a2 = -Math.PI / 2 + i * 2 * Math.PI / m; rr = (ci.star && i % 2) ? s * 0.45 : s; px = Math.cos(a2) * rr; py = Math.sin(a2) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.stroke(); return; }
      if (ci.kind === '3d') { draw3d(x, ci.sub, s, rot); return; }
      if (ci.kind === 'graph') { drawGraph(x, ci.sub, s, rot); return; }
      x.beginPath(); x.arc(0, 0, r, 0, 6.284); x.stroke();
    }
    var MESH = {};
    function mesh(sub) {
      if (MESH[sub]) return MESH[sub];
      var V = [], E = [], i, n;
      function ring(nn, y, rad, z0) { var st = V.length; for (i = 0; i < nn; i++) { var a = i / nn * 6.283; V.push(z0 === undefined ? [Math.cos(a) * rad, y, Math.sin(a) * rad] : [Math.cos(a) * rad, Math.sin(a) * rad, z0]); E.push([st + i, st + (i + 1) % nn]); } return st; }
      if (sub === 'cube') { V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]; E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]; }
      else if (sub === 'pyramid') { V = [[0, -1.2, 0], [-1, 0.8, -1], [1, 0.8, -1], [1, 0.8, 1], [-1, 0.8, 1]]; E = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]]; }
      else if (sub === 'octa') { V = [[1, 0, 0], [-1, 0, 0], [0, 1.2, 0], [0, -1.2, 0], [0, 0, 1], [0, 0, -1]]; E = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]]; }
      else if (sub === 'prism') { V = [[-1, 0.8, -0.9], [1, 0.8, -0.9], [0, -1, -0.9], [-1, 0.8, 0.9], [1, 0.8, 0.9], [0, -1, 0.9]]; E = [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [0, 3], [1, 4], [2, 5]]; }
      else if (sub === 'ring') { var a1 = ring(14, -0.28, 1), b1 = ring(14, 0.28, 1); for (i = 0; i < 14; i++) E.push([a1 + i, b1 + i]); }
      else if (sub === 'coin') { var c1 = ring(16, 0, 1, -0.22), c2 = ring(16, 0, 1, 0.22); for (i = 0; i < 16; i += 2) E.push([c1 + i, c2 + i]); }
      else if (sub === 'star') { for (n = 0; n < 2; n++) { var st = V.length; for (i = 0; i < 10; i++) { var aa = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? 0.45 : 1; V.push([Math.cos(aa) * rr2, Math.sin(aa) * rr2, n ? 0.25 : -0.25]); E.push([st + i, st + (i + 1) % 10]); } } for (i = 0; i < 10; i++) E.push([i, 10 + i]); }
      else if (sub === 'tetra') { V = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]]; E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]; }
      else if (sub === 'icosa') { var g = 1.618, sc = 0.62; [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]].forEach(function (v) { V.push([v[0] * sc, v[1] * sc, v[2] * sc]); }); E = [[0, 1], [0, 5], [0, 7], [0, 10], [0, 11], [1, 5], [1, 7], [1, 8], [1, 9], [2, 3], [2, 4], [2, 6], [2, 10], [2, 11], [3, 4], [3, 6], [3, 8], [3, 9], [4, 5], [4, 9], [4, 11], [5, 9], [5, 11], [6, 7], [6, 8], [6, 10], [7, 8], [7, 10], [8, 9], [10, 11]]; }
      else if (sub === 'dodeca') { var ph = 1.618, ip = 1 / 1.618, k = 0.58; var pts = [];[-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { [-1, 1].forEach(function (c) { pts.push([a, b, c]); }); }); }); [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { pts.push([0, a * ip, b * ph]); pts.push([a * ip, b * ph, 0]); pts.push([a * ph, 0, b * ip]); }); }); pts.forEach(function (v) { V.push([v[0] * k, v[1] * k, v[2] * k]); }); for (i = 0; i < V.length; i++) { for (var j2 = i + 1; j2 < V.length; j2++) { var dx = V[i][0] - V[j2][0], dy = V[i][1] - V[j2][1], dz = V[i][2] - V[j2][2]; if (Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) - 2 * ip * k) < 0.02) E.push([i, j2]); } } }
      else if (sub === 'cylinder') { var c3 = ring(14, -0.9, 1), c4 = ring(14, 0.9, 1); for (i = 0; i < 14; i += 2) E.push([c3 + i, c4 + i]); }
      else if (sub === 'cone') { V.push([0, -1.2, 0]); var cb = ring(14, 0.9, 1); for (i = 0; i < 14; i += 2) E.push([0, cb + i]); }
      else if (sub === 'torus') { var rings = []; for (n = 0; n < 10; n++) { var ang = n / 10 * 6.283, st2 = V.length; for (i = 0; i < 8; i++) { var t2 = i / 8 * 6.283, rr3 = 0.75 + 0.3 * Math.cos(t2); V.push([Math.cos(ang) * rr3, 0.3 * Math.sin(t2), Math.sin(ang) * rr3]); E.push([st2 + i, st2 + (i + 1) % 8]); } rings.push(st2); } for (n = 0; n < 10; n++) { for (i = 0; i < 8; i += 2) E.push([rings[n] + i, rings[(n + 1) % 10] + i]); } }
      else if (sub === 'sphere') { for (n = 1; n < 5; n++) { var yy = Math.cos(n / 5 * Math.PI), rr4 = Math.sin(n / 5 * Math.PI); ring(12, yy, rr4); } for (i = 0; i < 12; i += 2) { for (n = 0; n < 3; n++) E.push([n * 12 + i, (n + 1) * 12 + i]); } V.push([0, 1, 0]); V.push([0, -1, 0]); for (i = 0; i < 12; i += 2) { E.push([V.length - 2, i]); E.push([V.length - 1, 36 + i]); } }
      else if (sub === 'helix') { for (i = 0; i < 24; i++) { var hh = i / 24 * 6.283 * 2; V.push([Math.cos(hh) * 0.8, -1.2 + i / 23 * 2.4, Math.sin(hh) * 0.8]); if (i) E.push([i - 1, i]); } }
      else if (sub === 'dna') { for (i = 0; i < 20; i++) { var h2 = i / 20 * 6.283 * 2, y2 = -1.2 + i / 19 * 2.4; V.push([Math.cos(h2) * 0.8, y2, Math.sin(h2) * 0.8]); V.push([-Math.cos(h2) * 0.8, y2, -Math.sin(h2) * 0.8]); if (i) { E.push([2 * i - 2, 2 * i]); E.push([2 * i - 1, 2 * i + 1]); } if (i % 2 === 0) E.push([2 * i, 2 * i + 1]); } }
      else if (sub === 'gem') { V.push([0, -1.3, 0]); var gr1 = ring(8, -0.3, 1), gr2 = ring(8, 0.2, 0.7); V.push([0, 1.1, 0]); for (i = 0; i < 8; i++) { E.push([0, gr1 + i]); E.push([gr1 + i, gr2 + i]); E.push([V.length - 1, gr2 + i]); } }
      else if (sub === 'hexprism') { var hp1 = ring(6, -0.9, 1), hp2 = ring(6, 0.9, 1); for (i = 0; i < 6; i++) E.push([hp1 + i, hp2 + i]); }
      else if (sub === 'tower') { var hts = [0.5, 1.2, 0.8, 1.6, 1.0]; for (n = 0; n < 5; n++) { var bx = -1.2 + n * 0.6, bh = hts[n], st3 = V.length; V.push([bx, 1, -0.2]); V.push([bx + 0.4, 1, -0.2]); V.push([bx + 0.4, 1, 0.2]); V.push([bx, 1, 0.2]); V.push([bx, 1 - bh, -0.2]); V.push([bx + 0.4, 1 - bh, -0.2]); V.push([bx + 0.4, 1 - bh, 0.2]); V.push([bx, 1 - bh, 0.2]); [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) { E.push([st3 + e[0], st3 + e[1]]); }); } }
      else if (sub === 'coinstack') { for (n = 0; n < 5; n++) { var cs1 = ring(12, 0.9 - n * 0.45, 1, undefined); if (n) { for (i = 0; i < 12; i += 3) E.push([cs1 - 12 + i, cs1 + i]); } } }
      else if (sub === 'cross') { var cx1 = [[-0.3, -1, -0.3], [0.3, -1, -0.3], [0.3, -1, 0.3], [-0.3, -1, 0.3], [-0.3, 1, -0.3], [0.3, 1, -0.3], [0.3, 1, 0.3], [-0.3, 1, 0.3], [-1, -0.3, -0.3], [1, -0.3, -0.3], [1, -0.3, 0.3], [-1, -0.3, 0.3], [-1, 0.3, -0.3], [1, 0.3, -0.3], [1, 0.3, 0.3], [-1, 0.3, 0.3]]; V = cx1; E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7], [8, 9], [9, 10], [10, 11], [11, 8], [12, 13], [13, 14], [14, 15], [15, 12], [8, 12], [9, 13], [10, 14], [11, 15]]; }
      else if (sub === 'arrow') { V = [[0, -1.3, 0], [-1, -0.2, 0], [-0.4, -0.2, 0], [-0.4, 1.2, 0], [0.4, 1.2, 0], [0.4, -0.2, 0], [1, -0.2, 0], [0, -1.3, 0.35], [-1, -0.2, 0.35], [-0.4, -0.2, 0.35], [-0.4, 1.2, 0.35], [0.4, 1.2, 0.35], [0.4, -0.2, 0.35], [1, -0.2, 0.35]]; E = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 7], [0, 7], [1, 8], [3, 10], [4, 11], [6, 13]]; }
      else if (sub === 'steps') { for (n = 0; n < 4; n++) { var sz = 1.1 - n * 0.25, yb = 1 - n * 0.5, st4 = V.length; V.push([-sz, yb, -sz]); V.push([sz, yb, -sz]); V.push([sz, yb, sz]); V.push([-sz, yb, sz]); [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(function (e) { E.push([st4 + e[0], st4 + e[1]]); }); if (n) { for (i = 0; i < 4; i++) E.push([st4 - 4 + i, st4 + i]); } } }
      else if (sub === 'rocket') { var rk = ring(8, 0.6, 0.45); V.push([0, -1.4, 0]); for (i = 0; i < 8; i += 2) E.push([V.length - 1, rk + i]); var rk2 = ring(8, -0.5, 0.45); for (i = 0; i < 8; i++) E.push([rk + i, rk2 + i]); V.push([-0.9, 1.2, 0]); V.push([0.9, 1.2, 0]); V.push([0, 1.2, -0.9]); V.push([0, 1.2, 0.9]); E.push([rk + 4, V.length - 4]); E.push([rk + 0, V.length - 3]); E.push([rk + 6, V.length - 2]); E.push([rk + 2, V.length - 1]); }
      else if (sub === 'grid') { for (n = 0; n < 6; n++) { for (i = 0; i < 6; i++) { V.push([-1.2 + i * 0.48, 0, -1.2 + n * 0.48]); if (i) E.push([V.length - 2, V.length - 1]); if (n) E.push([V.length - 7, V.length - 1]); } } }
      else { V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]; E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]; }
      return MESH[sub] = { V: V, E: E };
    }
    function draw3d(x, sub, s, rot) {
      var m = mesh(sub), t = performance.now() / 900 + rot, cy = Math.cos(t), sy = Math.sin(t), tilt = 0.55 + curBass * 0.35, cx = Math.cos(tilt), sx = Math.sin(tilt), P = [], i;
      for (i = 0; i < m.V.length; i++) { var v = m.V[i]; if (sub === 'grid') v = [v[0], Math.sin(v[0] * 3 + t * 2) * Math.cos(v[2] * 3 + t) * (0.2 + curBass * 0.5), v[2]]; var x1 = v[0] * cy - v[2] * sy, z1 = v[0] * sy + v[2] * cy, y1 = v[1] * cx - z1 * sx, z2 = v[1] * sx + z1 * cx, f = 1 / (1.9 + z2 * 0.45) * 1.9; P.push([x1 * f * s * 0.7, y1 * f * s * 0.7, z2]); }
      x.beginPath(); for (i = 0; i < m.E.length; i++) { var e = m.E[i]; x.moveTo(P[e[0]][0], P[e[0]][1]); x.lineTo(P[e[1]][0], P[e[1]][1]); } x.stroke();
      x.globalAlpha *= 0.35; x.beginPath(); for (i = 0; i < P.length; i++) { x.moveTo(P[i][0] + 1.2, P[i][1]); x.arc(P[i][0], P[i][1], 1.2, 0, 6.283); } x.fill(); x.globalAlpha /= 0.35;
    }
    function drawGraph(x, sub, s, rot) {
      var t = performance.now() / 1000, i, n, v, w = s * 2.2, h = s * 1.4, amp = 0.55 + curBass * 0.6, prev = x.fillStyle;
      function val(i, k) { return 0.5 + 0.5 * Math.sin(i * (k || 0.9) + rot * 5 + t * (1.2 + curMid)) * amp * (0.6 + 0.4 * Math.sin(i * 2.3 + rot)); }
      if (sub === 'spark' || sub === 'area') { n = 12; x.beginPath(); for (i = 0; i < n; i++) { v = val(i); var px = -w / 2 + i / (n - 1) * w, py = h / 2 - v * h; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); if (sub === 'area') { x.lineTo(w / 2, h / 2); x.lineTo(-w / 2, h / 2); x.closePath(); x.globalAlpha *= 0.28; x.fill(); x.globalAlpha /= 0.28; } return; }
      if (sub === 'candles') { n = 5; for (i = 0; i < n; i++) { var o = val(i, 1.7), c = val(i + 0.5, 1.7), hi = Math.max(o, c) + 0.12, lo = Math.min(o, c) - 0.12, cx = -w / 2 + (i + 0.5) / n * w, bw = w / n * 0.55; x.fillStyle = c >= o ? prev : 'rgba(255,92,122,.95)'; x.strokeStyle = x.fillStyle; x.beginPath(); x.moveTo(cx, h / 2 - hi * h); x.lineTo(cx, h / 2 - lo * h); x.stroke(); x.fillRect(cx - bw / 2, h / 2 - Math.max(o, c) * h, bw, Math.max(0.06, Math.abs(c - o)) * h); } x.fillStyle = x.strokeStyle = prev; return; }
      if (sub === 'bars') { n = 6; for (i = 0; i < n; i++) { v = val(i, 1.3); var bx = -w / 2 + i / n * w, bw2 = w / n * 0.7; x.fillRect(bx, h / 2 - v * h, bw2, v * h); } return; }
      if (sub === 'donut') { var prog = 0.15 + 0.7 * val(0, 0.4); x.globalAlpha *= 0.3; x.beginPath(); x.arc(0, 0, s, 0, 6.283); x.stroke(); x.globalAlpha /= 0.3; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, s, -Math.PI / 2, -Math.PI / 2 + prog * 6.283); x.stroke(); x.lineWidth = 1.4; return; }
      if (sub === 'heatmap') { n = 5; var cell = w / n, ch = h / 4; for (i = 0; i < n; i++) { for (var r2 = 0; r2 < 4; r2++) { v = val(i * 4 + r2, 0.7); x.globalAlpha *= 0.25 + v * 0.7; x.fillRect(-w / 2 + i * cell + 0.5, -h / 2 + r2 * ch + 0.5, cell - 1, ch - 1); x.globalAlpha /= 0.25 + v * 0.7; } } return; }
      if (sub === 'scatter') { n = 14; for (i = 0; i < n; i++) { var sx2 = -w / 2 + val(i, 1.9) * w, sy2 = h / 2 - val(i + 7, 1.3) * h; x.beginPath(); x.arc(sx2, sy2, 1.2 + val(i, 0.5) * 1.6, 0, 6.283); x.fill(); } return; }
      if (sub === 'histogram') { n = 9; for (i = 0; i < n; i++) { v = Math.exp(-Math.pow((i - 4) / 2.2, 2)) * (0.6 + 0.4 * val(i, 1.1)); var hx = -w / 2 + i / n * w; x.fillRect(hx, h / 2 - v * h, w / n - 1, v * h); } return; }
      if (sub === 'depth') { n = 10; x.globalAlpha *= 0.5; x.beginPath(); x.moveTo(0, h / 2); for (i = 0; i <= n; i++) { v = 0.2 + i / n * 0.8 * (0.7 + 0.3 * val(i, 0.9)); x.lineTo(-i / n * w / 2, h / 2 - v * h); } x.lineTo(-w / 2, h / 2); x.closePath(); x.fill(); x.fillStyle = 'rgba(255,92,122,.95)'; x.beginPath(); x.moveTo(0, h / 2); for (i = 0; i <= n; i++) { v = 0.2 + i / n * 0.8 * (0.7 + 0.3 * val(i + 3, 0.9)); x.lineTo(i / n * w / 2, h / 2 - v * h); } x.lineTo(w / 2, h / 2); x.closePath(); x.fill(); x.globalAlpha /= 0.5; x.fillStyle = prev; return; }
      if (sub === 'bollinger') { n = 12; for (var b3 = -1; b3 <= 1; b3++) { x.globalAlpha *= b3 ? 0.4 : 1; x.beginPath(); for (i = 0; i < n; i++) { v = 0.5 + 0.25 * Math.sin(i * 0.8 + t) + b3 * (0.18 + 0.1 * val(i, 0.6)); var bpx = -w / 2 + i / (n - 1) * w, bpy = h / 2 - v * h; i ? x.lineTo(bpx, bpy) : x.moveTo(bpx, bpy); } x.stroke(); x.globalAlpha /= b3 ? 0.4 : 1; } return; }
      if (sub === 'volume') { n = 7; for (i = 0; i < n; i++) { v = 0.25 + 0.75 * val(i, 1.4); var vy = -h / 2 + i / n * h; x.globalAlpha *= 0.55; x.fillRect(-w / 2, vy, v * w, h / n - 1); x.globalAlpha /= 0.55; } x.beginPath(); x.moveTo(-w / 2 + w * 0.55, -h / 2); x.lineTo(-w / 2 + w * 0.55, h / 2); x.stroke(); return; }
      if (sub === 'tape') { x.font = '700 ' + Math.max(6, Math.round(s * 0.7)) + 'px "IBM Plex Mono", monospace'; x.textAlign = 'left'; x.textBaseline = 'middle'; var tp = ['SPY', 'NVDA', 'TSLA', 'AAPL', 'BTC', 'AMZN'], off = (t * 30 + rot * 100) % (w * 2); for (i = 0; i < tp.length; i++) { var tx = -w + ((i * w * 0.7 - off) % (w * 2) + w * 2) % (w * 2); var up2 = val(i, 0.3) > 0.5; x.fillStyle = up2 ? prev : 'rgba(255,92,122,.95)'; x.fillText(tp[i] + (up2 ? ' ▲' : ' ▼'), tx, 0); } x.fillStyle = prev; return; }
      if (sub === 'gauge') { var gp = 0.1 + 0.8 * val(0, 0.5); x.lineWidth = 3; x.globalAlpha *= 0.3; x.beginPath(); x.arc(0, s * 0.3, s, Math.PI, 2 * Math.PI); x.stroke(); x.globalAlpha /= 0.3; x.beginPath(); x.arc(0, s * 0.3, s, Math.PI, Math.PI + gp * Math.PI); x.stroke(); x.lineWidth = 1.4; var na = Math.PI + gp * Math.PI; x.beginPath(); x.moveTo(0, s * 0.3); x.lineTo(Math.cos(na) * s * 0.85, s * 0.3 + Math.sin(na) * s * 0.85); x.stroke(); return; }
      if (sub === 'ribbon') { n = 14; for (var rb = 0; rb < 3; rb++) { x.globalAlpha *= 0.7 - rb * 0.15; x.beginPath(); for (i = 0; i < n; i++) { v = 0.5 + 0.35 * Math.sin(i * 0.7 + t * 1.5 + rb * 0.9) * amp; var rpx = -w / 2 + i / (n - 1) * w, rpy = h / 2 - v * h; i ? x.lineTo(rpx, rpy) : x.moveTo(rpx, rpy); } x.stroke(); x.globalAlpha /= 0.7 - rb * 0.15; } return; }
      if (sub === 'pie') { var segs = [0.35, 0.25, 0.2, 0.2], a0 = -Math.PI / 2 + t * 0.4; for (i = 0; i < segs.length; i++) { var a1 = a0 + segs[i] * 6.283 * (0.9 + 0.1 * val(i, 0.4)); x.globalAlpha *= 0.35 + i * 0.2; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, s, a0, a1); x.closePath(); x.fill(); x.globalAlpha /= 0.35 + i * 0.2; a0 = a1; } return; }
      if (sub === 'waterfall') { n = 7; var run = 0.2; for (i = 0; i < n; i++) { var dlt = (val(i, 1.6) - 0.5) * 0.5, top = Math.max(run, run + dlt), bot = Math.min(run, run + dlt); x.fillStyle = dlt >= 0 ? prev : 'rgba(255,92,122,.95)'; x.fillRect(-w / 2 + i / n * w, h / 2 - top * h, w / n - 1, Math.max(0.03, top - bot) * h); run = Math.max(0.05, Math.min(0.95, run + dlt)); } x.fillStyle = prev; return; }
      if (sub === 'mountain') { n = 16; for (var lay = 0; lay < 3; lay++) { x.globalAlpha *= 0.6 - lay * 0.15; x.beginPath(); x.moveTo(-w / 2, h / 2); for (i = 0; i < n; i++) { v = 0.3 + 0.5 * Math.abs(Math.sin(i * 0.9 + lay * 1.3 + t * 0.3)) * (0.7 + 0.3 * val(i, 0.4)) * (1 - lay * 0.2); x.lineTo(-w / 2 + i / (n - 1) * w, h / 2 - v * h); } x.lineTo(w / 2, h / 2); x.closePath(); x.fill(); x.globalAlpha /= 0.6 - lay * 0.15; } return; }
      if (sub === 'treemap') { var cells = [[0, 0, 0.55, 0.6], [0.55, 0, 0.45, 0.35], [0.55, 0.35, 0.45, 0.25], [0, 0.6, 0.3, 0.4], [0.3, 0.6, 0.7, 0.4]]; for (i = 0; i < cells.length; i++) { var c5 = cells[i]; v = val(i, 0.6); x.fillStyle = v > 0.5 ? prev : 'rgba(255,92,122,.95)'; x.globalAlpha *= 0.3 + Math.abs(v - 0.5) * 1.2; x.fillRect(-w / 2 + c5[0] * w + 0.5, -h / 2 + c5[1] * h + 0.5, c5[2] * w - 1, c5[3] * h - 1); x.globalAlpha /= 0.3 + Math.abs(v - 0.5) * 1.2; } x.fillStyle = prev; return; }
      if (sub === 'dual') { n = 12; for (var ln = 0; ln < 2; ln++) { x.strokeStyle = ln ? 'rgba(61,139,253,.95)' : prev; x.beginPath(); for (i = 0; i < n; i++) { v = val(i + ln * 5, 0.8 + ln * 0.3); var dpx = -w / 2 + i / (n - 1) * w, dpy = h / 2 - v * h; i ? x.lineTo(dpx, dpy) : x.moveTo(dpx, dpy); } x.stroke(); } x.strokeStyle = prev; return; }
      if (sub === 'radar') { n = 6; x.globalAlpha *= 0.35; x.beginPath(); for (i = 0; i < n; i++) { var a = -Math.PI / 2 + i / n * 6.283; x.moveTo(0, 0); x.lineTo(Math.cos(a) * s, Math.sin(a) * s); } x.stroke(); x.globalAlpha /= 0.35; x.beginPath(); for (i = 0; i < n; i++) { var a3 = -Math.PI / 2 + i / n * 6.283, rr = (0.3 + 0.7 * val(i, 1.1)) * s; i ? x.lineTo(Math.cos(a3) * rr, Math.sin(a3) * rr) : x.moveTo(Math.cos(a3) * rr, Math.sin(a3) * rr); } x.closePath(); x.stroke(); x.globalAlpha *= 0.25; x.fill(); x.globalAlpha /= 0.25; return; }
    }
    function resetP(p, f, W, H, anywhere) {
      var sz = f.size || [2, 6], spd = f.speed || [0.5, 2], d = f.dir || 'drift';
      p.s = sz[0] + Math.random() * (sz[1] - sz[0]); p.v = spd[0] + Math.random() * (spd[1] - spd[0]); p.c = f.colors[Math.floor(Math.random() * f.colors.length)] || '#38F58A'; p.a = 0.5 + Math.random() * 0.45; p.life = 1;
      p.vx = (Math.random() - 0.5) * p.v; p.vy = (Math.random() - 0.5) * p.v; p.x = Math.random() * W; p.y = anywhere ? Math.random() * H : (d === 'up' ? H + 24 : -24);
      if (d === 'diag' && !anywhere) p.x = Math.random() * W - W * 0.35;
      if (d === 'left') { p.x = anywhere ? Math.random() * W : W + 30; p.y = Math.random() * H; }
      if (d === 'right') { p.x = anywhere ? Math.random() * W : -30; p.y = Math.random() * H; }
      if (d === 'orbit' || d === 'spiral' || d === 'vortex') { p.ang = Math.random() * 6.283; p.rad = d === 'spiral' ? Math.random() * 40 : (d === 'vortex' ? Math.max(W, H) * (0.3 + Math.random() * 0.4) : Math.min(W, H) * (0.12 + Math.random() * 0.4)); p.cx = W / 2; p.cy = H / 2; }
      if (d === 'wave') { p.base = Math.random() * H; p.x = anywhere ? Math.random() * W : -30; }
      if (d === 'bounce') { p.base = Math.random() * H; p.x = Math.random() * W; }
      if (d === 'burst') { p.x = anywhere ? Math.random() * W : (W * 0.2 + Math.random() * W * 0.6); p.y = anywhere ? Math.random() * H : (H * 0.15 + Math.random() * H * 0.5); var ba = Math.random() * 6.283; p.vx = Math.cos(ba) * p.v; p.vy = Math.sin(ba) * p.v; p.life = 0.5 + Math.random() * 0.5; }
      if (d === 'matrix') { p.col = Math.floor(Math.random() * Math.max(1, Math.floor(W / 18))); p.x = p.col * 18 + 9; p.y = anywhere ? Math.random() * H : -20; }
      if (d === 'warp') { var wa = Math.random() * 6.283, wr = anywhere ? Math.random() * Math.max(W, H) * 0.5 : 2 + Math.random() * 20; p.ang = wa; p.rad = wr; p.cx = W / 2; p.cy = H / 2; }
      if (d === 'fountain') { p.x = W / 2 + (Math.random() - 0.5) * W * 0.1; p.y = anywhere ? Math.random() * H : H + 10; p.vx = (Math.random() - 0.5) * p.v * 0.9; p.vy = -p.v * (1.4 + Math.random() * 0.8); }
      if (d === 'helix') { p.ph = Math.random() * 6.283; p.strand = Math.random() < 0.5 ? 0 : 1; p.x = anywhere ? Math.random() * W : -20; }
    }
    var PBUDGET = (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 380 : 900;
    function runPresets(x, W, H, bass, mid) {
      var active = {}, i, j, k;
      for (i = 0; i < fxList.length; i++) {
        var f = CAT.fx[fxList[i]]; if (!f) continue; active[f.name] = 1;
        var pool = presetPools[f.name] || (presetPools[f.name] = []);
        /* performance budget: many presets at once share one particle pool size */
        var want = f.count || 30, activeN = 0; for (var q0 = 0; q0 < fxList.length; q0++) if (CAT.fx[fxList[q0]]) activeN++;
        var totalWant = 0; for (var q1 = 0; q1 < fxList.length; q1++) { var ff = CAT.fx[fxList[q1]]; if (ff) totalWant += (ff.count || 30); }
        if (totalWant > PBUDGET) want = Math.max(6, Math.floor(want * PBUDGET / totalWant));
        while (pool.length < want) { var np = { ph: Math.random() * 6.28, rot: Math.random() * 6.28 }; resetP(np, f, W, H, true); pool.push(np); }
        if (pool.length > want) pool.length = want;
        x.lineWidth = 1.4; var dir = f.dir || 'drift', tnow = performance.now() / 1000;
        for (j = 0; j < pool.length; j++) {
          var p = pool[j], sp = p.v * (1 + bass * (f.beat || 1) * 0.9 + mid * 0.6);
          if (dir === 'down') p.y += sp; else if (dir === 'up') p.y -= sp; else if (dir === 'diag') { p.x += sp * 1.2; p.y += sp; }
          else if (dir === 'left') p.x -= sp; else if (dir === 'right') p.x += sp;
          else if (dir === 'orbit') { p.ang += sp * 0.004; p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad * 0.6; }
          else if (dir === 'spiral') { p.ang += sp * 0.02; p.rad += sp * 0.6; p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad * 0.65; if (p.rad > Math.max(W, H) * 0.75) resetP(p, f, W, H, false); }
          else if (dir === 'vortex') { p.ang += sp * 0.02 + 2 / Math.max(20, p.rad); p.rad -= sp * 0.8; p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad * 0.65; if (p.rad < 6) resetP(p, f, W, H, false); }
          else if (dir === 'wave') { p.x += sp; p.y = p.base + Math.sin(p.x / 60 + tnow * 2) * (18 + (f.sway || 1) * 14) * (1 + bass); if (p.x > W + 30) resetP(p, f, W, H, false); }
          else if (dir === 'bounce') { p.y = p.base + Math.abs(Math.sin(tnow * 2.2 + p.ph)) * -(40 + bass * 60) * (f.beat || 1); p.x += p.vx * 0.3; }
          else if (dir === 'burst') { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012; if (p.life <= 0) resetP(p, f, W, H, false); }
          else if (dir === 'matrix') { p.y += sp; p.x = p.col * 18 + 9; }
          else if (dir === 'warp') { p.rad += sp * (0.6 + p.rad / 120); p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad; if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) resetP(p, f, W, H, false); }
          else if (dir === 'fountain') { p.x += p.vx; p.y += p.vy; p.vy += 0.08; if (p.y > H + 20) resetP(p, f, W, H, false); }
          else if (dir === 'helix') { p.x += sp; p.y = H * 0.5 + Math.sin(p.x / 40 + tnow * 2 + p.strand * Math.PI) * (40 + bass * 30); if (p.x > W + 20) resetP(p, f, W, H, false); }
          else { p.x += p.vx * (1 + mid); p.y += p.vy * (1 + mid); }
          p.ph += 0.03; if (f.sway && dir !== 'wave' && dir !== 'orbit') p.x += Math.sin(p.ph) * f.sway * 0.7; if (f.spin) p.rot += 0.02 + bass * 0.12;
          if (dir === 'down' || dir === 'up' || dir === 'diag' || dir === 'drift' || dir === 'matrix' || dir === 'left' || dir === 'right') {
            if (p.y > H + 30) { if (dir === 'down' || dir === 'diag' || dir === 'matrix') resetP(p, f, W, H, false); else p.y = -30; }
            if (p.y < -30) { if (dir === 'up') resetP(p, f, W, H, false); else p.y = H + 30; }
            if (p.x > W + 40) { if (dir === 'diag' || dir === 'right') resetP(p, f, W, H, false); else p.x = -30; } if (p.x < -40) { if (dir === 'left') resetP(p, f, W, H, false); else p.x = W + 30; }
          }
          var a = p.a * (f.twinkle ? (0.35 + 0.65 * Math.abs(Math.sin(p.ph * 2.2))) : 1) * (dir === 'burst' ? p.life : 1);
          x.globalAlpha = Math.min(1, a + bass * 0.2); x.fillStyle = x.strokeStyle = p.c;
          x.save(); x.translate(p.x, p.y); if (f.spin) x.rotate(p.rot); if (f.glow) { x.shadowBlur = 10 + bass * 12; x.shadowColor = p.c; }
          if (f.trail) { x.globalAlpha *= 0.5; x.beginPath(); x.moveTo(0, 0); x.lineTo(f.dir === 'diag' ? -p.s * 3 : 0, f.dir === 'up' ? p.s * 3 : -p.s * 3); x.stroke(); x.globalAlpha = Math.min(1, a + bass * 0.2); }
          if (f.glyph) { x.font = '700 ' + Math.max(6, Math.round(p.s)) + 'px "IBM Plex Sans", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(f.glyph, 0, 0); }
          else drawShape(x, f.shape, Math.max(1, p.s / 2.2), p.rot);
          x.restore();
        }
      }
      for (k in presetPools) if (!active[k]) delete presetPools[k];
      x.globalAlpha = 1; x.shadowBlur = 0;
    }

    var orbAngle = 0, angV = 0;
    function tick() {
      // Impulse decay — independent of playback state, since a Share/Follow
      // click should react even when no music is playing.
      for (var ii = impulses.length - 1; ii >= 0; ii--) {
        var im = impulses[ii];
        var p = (performance.now() - im.t0) / im.ms;
        if (p >= 1 || !im.el) {
          if (im.el) { im.el.style.removeProperty('--sip-l'); if (im.temp) { im.el.classList.remove('sip-mv-' + im.mv); im.el.style.removeProperty('--sip-a'); } }
          impulses.splice(ii, 1);
          continue;
        }
        im.el.style.setProperty('--sip-l', (Math.pow(1 - p, 2.2) * im.amp).toFixed(3));
      }
      var m = mult();
      var beats = nowTime() * (BPM / 60);
      var active = playing && m > 0 && !document.hidden;
      var kick = active ? easeBeat(((beats % 1) + 1) % 1) : 0;
      var bass = kick, mid = active ? (0.25 + 0.5 * kick) : 0, high = active ? 1 : 0;
      var sMul = beatSens;
      var clampV = function (v) { return v > 1.35 ? 1.35 : v; };
      var bi = Math.floor(beats);
      if (active && bi !== lastBeat) { lastBeat = bi; onKick(Math.min(1.5, sMul)); }

      var kv = clampV(kick * m * sMul);
      root.style.setProperty('--kick', kv.toFixed(3));
      root.style.setProperty('--bkick', (cfg.bannerShake ? kv : 0).toFixed(3));
      root.style.setProperty('--bass', clampV(bass * m * sMul).toFixed(3));
      root.style.setProperty('--mid', clampV(mid * m * sMul).toFixed(3));
      root.style.setProperty('--high', clampV(high * m * sMul).toFixed(3));
      rootEl.style.setProperty('--sml-pulse', kv.toFixed(3));
      rootEl.style.setProperty('--sml-pulse-energy', (m * (active ? 1 : 0)).toFixed(3));

      /* Rhythm lanes: YouTube exposes no audio spectrum (see the top-of-file
         note), so these are not real frequency bands — six synthetic feels
         derived from the same estimated BPM with different attack/subdivision
         math, so different elements can visibly move differently on the same
         song. Same active/m/sMul gate as everything above: PROFILE PULSE
         "Off" and BEAT SENS still master every lane. */
      var laneSub    = active ? env(frac(beats / 2), 0.08, 1.0) : 0;
      var laneSnare  = active ? env(frac((beats + 1) / 2), 0.04, 3.0) : 0;
      var laneHat    = active ? 0.55 * env(frac(beats * 2), 0.03, 4.5) : 0;
      var laneAccent = active ? env(frac(beats / 4), 0.02, 6.0) : 0;
      var laneSwell  = active ? (0.5 + 0.5 * Math.sin(beats * Math.PI / 4)) : 0;
      root.style.setProperty('--lane-kick', kv.toFixed(3));
      root.style.setProperty('--lane-sub', clampV(laneSub * m * sMul).toFixed(3));
      root.style.setProperty('--lane-snare', clampV(laneSnare * m * sMul).toFixed(3));
      root.style.setProperty('--lane-hat', clampV(laneHat * m * sMul).toFixed(3));
      root.style.setProperty('--lane-accent', clampV(laneAccent * m * sMul).toFixed(3));
      root.style.setProperty('--lane-swell', clampV(laneSwell * m * sMul).toFixed(3));

      var bars = eq.children;
      for (var i = 0; i < bars.length; i++) { var v = active ? easeBeat(((beats + (i * 0.37)) % 1 + 1) % 1) * m : 0.02; bars[i].style.height = (3 + v * 32) + 'px'; bars[i].style.opacity = (0.35 + v * 0.6).toFixed(2); }

      // orbital rings
      var spin = 0.12 + mid * m * 1.3 + kick * m * 1.1;
      var ease = function (ang, rot) { var diff = ((((-rot) - ang) % 360) + 540) % 360 - 180; return ang + diff * 0.14; };
      var managing = root.classList.contains('sip-manage');
      if (enlarged && enlarged.ring === 'photo') orbAngle = ease(orbAngle, enlarged.i * 60); else if (!managing) orbAngle += spin;
      if (enlarged && enlarged.ring === 'video') angV = ease(angV, enlarged.i * 120); else if (!managing) angV -= spin * 0.8;
      var pScale = Math.min(orbSize('photo') / 300, pStage && pStage.clientWidth ? pStage.clientWidth / 440 : 1);
      var vScale = Math.min(orbSize('video') / 300, vStage && vStage.clientWidth ? vStage.clientWidth / 426 : 1);
      var pH = Math.round(pScale * 300) + 'px', vH = Math.round(vScale * 300) + 'px';
      if (pStage && pStage.style.height !== pH) pStage.style.height = pH;
      if (vStage && vStage.style.height !== vH) vStage.style.height = vH;
      if (pStage && pStage.parentElement) pStage.parentElement.style.flexBasis = orbSize('photo') > 380 ? '100%' : '';
      if (vStage && vStage.parentElement) vStage.parentElement.style.flexBasis = orbSize('video') > 380 ? '100%' : '';
      var photoTilePulse = reacts('orbital_photos') ? (1 + kick * m * 0.09 + bass * m * 0.05) : 1;
      var videoTilePulse = reacts('orbital_videos') ? (1 + kick * m * 0.09 + bass * m * 0.05) : 1;
      if (pRing) {
        pRing.style.transform = 'scale(' + pScale.toFixed(3) + ') rotateY(' + orbAngle.toFixed(2) + 'deg)';
        for (var pi = 0; pi < pRing.children.length; pi++) { var pbig = enlarged && enlarged.ring === 'photo' && enlarged.i === pi; var pf = (pbig ? Math.min(1.85 / pScale, 1.85) : (itemScales.photo[pi] || 1)) * photoTilePulse; pRing.children[pi].style.transform = 'rotateY(' + (pi * 60) + 'deg) translateZ(165px) scale(' + pf.toFixed(3) + ')'; pRing.children[pi].style.zIndex = pbig ? '5' : ''; }
      }
      if (vRing) {
        vRing.style.transform = 'scale(' + vScale.toFixed(3) + ') rotateY(' + angV.toFixed(2) + 'deg)';
        for (var vi = 0; vi < vRing.children.length; vi++) { var vbig = enlarged && enlarged.ring === 'video' && enlarged.i === vi; var vf = (vbig ? Math.min(1.85 / vScale, 1.85) : (itemScales.video[vi] || 1)) * videoTilePulse; vRing.children[vi].style.transform = 'rotateY(' + (vi * 120) + 'deg) translateZ(150px) scale(' + vf.toFixed(3) + ')'; vRing.children[vi].style.zIndex = vbig ? '5' : ''; }
      }

      // world carousel
      if (GEN !== INIT_GEN) return;          /* superseded by a newer init */
      var kids = screens.children;
      for (var wi = 0; wi < kids.length; wi++) { var dd = wi - screen; kids[wi].style.transform = 'translateX(' + (dd * 106) + '%) rotateY(' + (dd * -48) + 'deg) scale(' + (dd ? 0.9 : 1) + ')'; kids[wi].style.opacity = dd === 0 ? '1' : (Math.abs(dd) === 1 ? '0.18' : '0'); kids[wi].style.pointerEvents = dd === 0 ? 'auto' : 'none'; }
      var act = kids[screen]; if (act) { var hh = act.offsetHeight + 'px'; if (screens.style.height !== hh) screens.style.height = hh; }

      drawWave();
      drawFx(clampV(bass * m * sMul), mid * m * sMul);
      var ss = Math.floor(nowTime() || 0);
      if (ss !== sec) { sec = ss; timeEl.textContent = fmt(nowTime()) + ' / ' + fmt(duration); }
      requestAnimationFrame(tick);
    }

    // boot playback listeners
    if (frame) {
      var tries = 0; var iv = setInterval(function () { listen(); if (++tries > 240 || lastStamp) clearInterval(iv); }, 250);
      if (!cfg.useExistingPlayer) frame.addEventListener('load', function () { register(); setTimeout(function () { cmd('mute'); cmd('playVideo'); }, 600); });
    } else {
      /* no music: don't gate the profile behind "Tap for sound" */
      overlay.style.display = 'none';
      var tt = $('.sip-track-t'), tl = $('.sip-track-l');
      if (tt) tt.textContent = cfg.isOwner ? 'No profile music yet — add it in Edit profile → Profile music' : 'No profile music yet';
      if (tl) tl.textContent = 'PROFILE MUSIC';
      if (playBtn) { playBtn.disabled = true; playBtn.style.opacity = '.45'; playBtn.title = 'No profile music'; }
      if (timeEl) timeEl.textContent = '';
      /* mini mode + no music: a dead play pill is noise — show nothing at all */
      var miniRoot = $('.sip-root');
      if (miniRoot && miniRoot.classList.contains('sip-mini')) { var mdk = $('.sip-dock'); if (mdk) mdk.classList.add('sip-dock--none'); }
    }
    try { applyProfileFonts(); } catch (e) {}
    requestAnimationFrame(tick);
  }


  /* =====================================================================
     PROFILE STUDIO — the ONE "Edit profile" package for owners.
     Everything the site can customize (identity, socials, music, immersive
     parts/objects/effects/order, layout, theme, accent, typeface, background,
     banner, typography, cursor, orbital photos + videos, pinned moments, photo
     strip, cars, modules, social details) is the real /customize-profile/
     editor: it is embedded here (same origin), re-skinned to the studio, given
     a section navigator, and every successful save inside it refreshes the
     live profile behind the studio. The bridge's live-preview drawer (Live
     Profile Studio) and the immersive Arrange mode are exposed as studio
     buttons — nothing is duplicated, nothing is lost.
     ===================================================================== */
  var STUDIO_CSS = '' +
    '.sps{position:fixed;inset:0;z-index:2147483646;background:#070d14;color:#e6edf5;font-family:var(--sip-fb,"IBM Plex Sans"),"IBM Plex Sans",system-ui,sans-serif;display:flex;flex-direction:column;}' +
    '.sps[hidden]{display:none;}' +
    '.sps-bar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:#0a1119;flex-wrap:wrap;}' +
    '.sps-title{font-family:var(--sip-fh,Archivo),Archivo,"IBM Plex Sans",sans-serif;font-weight:800;font-size:15px;letter-spacing:.02em;}' +
    '.sps-title b{color:#38F58A;}.sps-sub{font-size:11.5px;color:#7e8a96;letter-spacing:.06em;text-transform:uppercase;}' +
    '.sps-sp{flex:1;}' +
    '.sps-btn{padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:transparent;color:#c3ccd4;font:600 12.5px/1 "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;}' +
    '.sps-btn:hover{color:#fff;border-color:rgba(255,255,255,.35);}' +
    '.sps-btn.pri{background:#38F58A;color:#03120A;border-color:#38F58A;font-weight:700;}.sps-btn.pri:hover{background:#5dffa3;color:#03120A;}' +
    '.sps-body{flex:1;display:flex;min-height:0;}' +
    '.sps-nav{width:232px;flex:none;overflow:auto;padding:12px 8px;border-right:1px solid rgba(255,255,255,.08);background:#0a1119;}' +
    '.sps-nav-h{font-size:10.5px;letter-spacing:.14em;color:#6B7C90;text-transform:uppercase;padding:8px 10px 6px;}' +
    '.sps-nav button{display:block;width:100%;text-align:left;padding:8px 10px;border:none;background:transparent;color:#c3ccd4;font:500 13px/1.25 "IBM Plex Sans",system-ui,sans-serif;border-radius:8px;cursor:pointer;}' +
    '.sps-nav button:hover{background:rgba(255,255,255,.06);color:#fff;}.sps-nav button.on{background:rgba(56,245,138,.12);color:#38F58A;}' +
    '.sps-main{flex:1;min-width:0;position:relative;background:#070d14;}' +
    '.sps-main iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#070d14;}' +
    '.sps-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7e8a96;font-size:13px;letter-spacing:.08em;text-transform:uppercase;background:#070d14;pointer-events:none;transition:opacity .3s;}' +
    '.sps-load[hidden]{display:none;}' +
    '.sps-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;background:#0d1a12;border:1px solid rgba(56,245,138,.5);color:#dfffea;padding:10px 16px;border-radius:999px;font:600 12.5px "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 8px 30px #000a;opacity:0;transition:opacity .25s;pointer-events:none;}' +
    '.sps-toast.on{opacity:1;}' +
    '@media(max-width:1024px){.sps-nav{width:196px;}.sps-nav button{font-size:12.5px;padding:7px 9px;}}' +
    '@media(max-width:820px){.sps-body{flex-direction:column;}.sps-nav{width:auto;display:flex;gap:4px;overflow-x:auto;padding:6px 8px;border-right:0;border-bottom:1px solid rgba(255,255,255,.08);}.sps-nav-h{display:none;}.sps-nav button{white-space:nowrap;width:auto;padding:7px 10px;font-size:12px;}.sps-bar{padding:8px 10px;gap:6px;}.sps-btn{padding:7px 10px;font-size:12px;}}';

  /* CSS injected INTO the embedded editor page: hide site chrome, keep the editor */
  var EMBED_CSS = '' +
    'html,body{background:#070d14!important;}' +
    '#wpadminbar,.wordads-ad-wrapper,.sml-uads-slot,.sml-loop-tape,.sml-acct,.sml-inbox,.sml-loop-bucks-root,#sml-lb-btn,.sml-lb-floating,.sml-loop-kick,#sml-hf-loop-kick,.sml-loop-launcher,#sml-ss-global-host,.sml-ss-global-host,.jetpack-instant-search,.sml-legal-footer-links,#sml-legal-footer,.sc-cart-wrapper,.wp-site-blocks>header,.wp-site-blocks>footer,header.wp-block-template-part,footer.wp-block-template-part,.wp-block-post-title,#wp-skip-link{display:none!important;}' +
    'html{margin-top:0!important;}' +
    'main.wp-block-group{padding-top:0!important;}main.wp-block-group>.wp-block-group.is-layout-constrained:not(.entry-content){display:none!important;}' +
    '.entry-content{max-width:1080px!important;margin:0 auto!important;padding:18px 18px 120px!important;}' +
    '.sml-profile-editor,.smlpe-section{scroll-margin-top:16px;}' +
    '.smlpe-actions{bottom:0!important;}';

  function mountStudio(mount, cfg) {
    if (window.SML_PROFILE_STUDIO) return;
    var U = window.SML_PROFILE_UNIFIED || {};
    var editorUrl = U.editorUrl || cfg.editUrl || '/customize-profile/';
    if (!document.getElementById('sps-css')) { var st = document.createElement('style'); st.id = 'sps-css'; st.textContent = STUDIO_CSS; document.head.appendChild(st); }
    var el = document.createElement('div'); el.className = 'sps'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Profile Studio');
    el.innerHTML =
      '<div class="sps-bar">' +
        '<div><div class="sps-title">PROFILE <b>STUDIO</b></div><div class="sps-sub">' + esc(cfg.handle || '') + ' · every customization, live</div></div>' +
        '<div class="sps-sp"></div>' +
        '<button class="sps-btn sps-live" type="button" title="Preview background, banner, music and reactions on the profile before saving">Live preview</button>' +
        '<button class="sps-btn sps-arrange" type="button" title="Drag sections, resize orbitals, double-click orbital slots to add photos/videos">Arrange on profile</button>' +
        '<button class="sps-btn sps-refresh" type="button" title="Re-read the saved profile behind the studio">Refresh preview</button>' +
        '<button class="sps-btn pri sps-done" type="button">Done ✓</button>' +
      '</div>' +
      '<div class="sps-body"><nav class="sps-nav"><div class="sps-nav-h">Sections</div></nav>' +
      '<div class="sps-main"><div class="sps-load">Loading your editor…</div></div></div>';
    document.body.appendChild(el);
    var toastEl = document.createElement('div'); toastEl.className = 'sps-toast'; document.body.appendChild(toastEl);
    var toastT = null;
    function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2600); }
    var nav = el.querySelector('.sps-nav'), main = el.querySelector('.sps-main'), loadEl = el.querySelector('.sps-load');
    var ifr = null, dirty = false, refreshT = null, prevScrollLock = '';

    /* the bridge's live-preview drawer button: keep it, hide it, call it from here */
    function bridgePill() { return document.querySelector('.sml-live-profile-edit'); }
    function parkPill() {
      var pill = bridgePill(); if (!pill) return;
      if (pill.parentNode !== document.body) document.body.appendChild(pill);   /* survive re-inits of the overlay */
      pill.style.setProperty('display', 'none', 'important'); pill.setAttribute('aria-hidden', 'true'); pill.tabIndex = -1;
    }
    parkPill();
    if (window.MutationObserver) { var mo = new MutationObserver(function () { if (bridgePill()) { parkPill(); mo.disconnect(); } }); mo.observe(document.documentElement, { childList: true, subtree: true }); setTimeout(function () { mo.disconnect(); }, 20000); }

    function refreshOverlay() {
      return realConfig().then(function (cfgReal) {
        parkPill();
        window.SML_PROFILE = cfgReal; init(mount);
        var arr = mount.querySelector('.sip-edit-toggle'); if (arr) { arr.style.setProperty('display', 'none', 'important'); arr.setAttribute('aria-hidden', 'true'); }
        /* the bridge's reactive-component attributes live in localStorage; re-apply them */
        try {
          var comps = JSON.parse(localStorage.getItem('sml-immersive-components') || 'null'), root = mount.querySelector('.sip-root');
          if (root && Array.isArray(comps)) ['background', 'banner', 'avatar', 'cards', 'orbital_photos', 'orbital_videos'].forEach(function (k) { root.setAttribute('data-sml-imm-' + k.replace(/_/g, '-'), comps.indexOf(k) >= 0 ? '1' : '0'); });
        } catch (e) {}
      }, function () {});
    }
    function onSaved() {
      dirty = true; clearTimeout(refreshT);
      refreshT = setTimeout(function () { toast('Saved · your live profile updated'); refreshOverlay(); }, 900);
    }
    function hookSaves(w) {
      try {
        var of = w.fetch;
        if (typeof of === 'function' && !of.__sps) {
          var nf = function (u, o) { var p = of.apply(this, arguments); try { var m = (o && o.method) || (u && u.method) || 'GET', url = String((u && u.url) || u || ''); if (/^(POST|PUT|PATCH|DELETE)$/i.test(m) && url.indexOf('/wp-json/') >= 0) p.then(function (r) { if (r && r.ok) onSaved(); }, function () {}); } catch (e) {} return p; };
          nf.__sps = 1; w.fetch = nf;
        }
        var XP = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
        if (XP && !XP.__sps) {
          var oo = XP.open, os = XP.send;
          XP.open = function (m, u) { this.__spsReq = [String(m || 'GET'), String(u || '')]; return oo.apply(this, arguments); };
          XP.send = function () { var x = this, r = x.__spsReq; if (r && /^(POST|PUT|PATCH|DELETE)$/i.test(r[0]) && r[1].indexOf('/wp-json/') >= 0) x.addEventListener('load', function () { if (x.status >= 200 && x.status < 300) onSaved(); }); return os.apply(this, arguments); };
          XP.__sps = 1;
        }
      } catch (e) {}
    }
    var navItems = [];
    function buildNav(d) {
      dedupeUnified(d);
      Array.prototype.slice.call(nav.querySelectorAll('button')).forEach(function (b) { b.remove(); });
      navItems = [];
      var secs = Array.prototype.slice.call(d.querySelectorAll('.entry-content section, .entry-content .sml-spd-panel'));
      var seen = {};
      secs.forEach(function (sec, i) {
        var h = sec.querySelector('h2,h3,h4'); var label = h ? (h.textContent || '').trim() : '';
        if (!label || sec.offsetHeight < 8) return;
        var key = label.toLowerCase(); if (seen[key]) label += ' ' + (++seen[key]); else seen[key] = 1;
        if (!sec.id) sec.id = 'sps-sec-' + i;
        var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.addEventListener('click', function () {
          spyLock = Date.now() + 900;
          Array.prototype.slice.call(nav.querySelectorAll('button')).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
          try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { sec.scrollIntoView(); }
        });
        nav.appendChild(b); navItems.push({ sec: sec, btn: b });
      });
      spy();
      if (!nav.querySelector('button')) { var b0 = document.createElement('button'); b0.type = 'button'; b0.textContent = 'Editor'; b0.className = 'on'; nav.appendChild(b0); }
    }
    var spyLock = 0;
    function spy() {
      if (!navItems.length || Date.now() < spyLock) return;
      var best = null, bestD = Infinity, anchor = 120;
      navItems.forEach(function (it) { var r = it.sec.getBoundingClientRect(); var dd = r.top <= anchor ? anchor - r.top : (r.top - anchor) + 4000; if (dd < bestD) { bestD = dd; best = it; } });
      if (!best) return;
      navItems.forEach(function (it) { it.btn.classList.toggle('on', it === best); });
      try { if (best.btn.scrollIntoViewIfNeeded) best.btn.scrollIntoViewIfNeeded(false); } catch (e) {}
    }
    function onFrameLoad() {
      var w, d;
      try { w = ifr.contentWindow; d = ifr.contentDocument || (w && w.document); } catch (e) { loadEl.hidden = true; return; }
      if (!d) { loadEl.hidden = true; return; }
      var path = '';
      try { path = w.location.pathname; } catch (e) {}
      var editorPath = editorUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
      if (path && editorPath && path.replace(/\/+$/, '') !== editorPath.replace(/\/+$/, '')) {
        /* the editor navigated away (e.g. "View public profile") — leave the studio */
        var target = ''; try { target = w.location.href; } catch (e) {}
        close(); if (target && target.indexOf(location.pathname) < 0) location.href = target; else if (dirty) refreshOverlay();
        return;
      }
      try { var st = d.createElement('style'); st.id = 'sps-embed-css'; st.textContent = EMBED_CSS; d.head.appendChild(st); } catch (e) {}
      hookSaves(w);
      loadEl.hidden = true;
      try { var spyT = null; w.addEventListener('scroll', function () { if (spyT) return; spyT = setTimeout(function () { spyT = null; spy(); }, 120); }, { passive: true }); } catch (e) {}
      /* the editor renders in stages (core sections, then the unified identity/
         music/immersive block, then social details) — build the navigator once
         the section count has settled, and keep it in sync afterwards */
      var last = -1, stable = 0, polls = 0;
      (function settle() {
        var n = d.querySelectorAll('.entry-content section').length;
        if (n === last && n > 0) stable++; else stable = 0;
        last = n;
        if ((stable >= 3) || ++polls > 45) { ensureUnified(w, d).then(function () { buildNav(d); }); }
        else setTimeout(settle, 400);
      })();
      try {
        var ec = d.querySelector('.entry-content');
        if (ec && w.MutationObserver) { var navT = null; new w.MutationObserver(function () { clearTimeout(navT); navT = setTimeout(function () { ensureUnified(w, d).then(function () { buildNav(d); }); }, 800); }).observe(ec, { childList: true, subtree: true }); }
      } catch (e) {}
    }
    /* Profile identity / Profile music / Immersive profile are mounted by the
       plugin's unified-editor.js on 'sml-profile-editor-ready'; when the core
       editor re-renders after that mount the block is dropped (a load-order
       race that shows up inside the studio frame). Re-run the mounter — a
       fresh copy of the script mounts again because its "already mounted"
       marker is gone. Nothing is duplicated: it refuses to mount twice. */
    var unifiedReinjects = 0;
    function ensureUnified(w, d) {
      return new Promise(function (resolve) {
        var t = 0, done = false, fin = function () { if (!done) { done = true; resolve(); } };
        if (unifiedReinjects >= 4) { fin(); return; }
        function marker() { return d.querySelector('[data-smlpe-unified-mounted]'); }
        function mountFinished() { var g = w.SML_PROFILE_UNIFIED_EDITOR; return !!(g && typeof g.prepareSave === 'function'); }
        function reinject() {
          unifiedReinjects++;
          try {
            var sc = d.createElement('script'); sc.src = '/wp-content/plugins/sml-profile-engine/assets/unified-editor.js?sps=' + encodeURIComponent(String((w.SML_PROFILE_UNIFIED_EDITOR_CONFIG && w.SML_PROFILE_UNIFIED_EDITOR_CONFIG.nonce) || '1'));
            sc.onload = function () { var k = 0; (function wait() { if (marker() || ++k > 25) fin(); else setTimeout(wait, 300); })(); };
            sc.onerror = fin; d.body.appendChild(sc); setTimeout(fin, 9000);
          } catch (e) { fin(); }
        }
        (function check() {
          try {
            if (!d.querySelector('[data-sml-profile-editor]')) { fin(); return; }
            if (marker()) { fin(); return; }                       /* block is there */
            if (mountFinished()) { reinject(); return; }            /* mounted, then wiped by a core re-render → mount again */
            if (++t > 50) { fin(); return; }                        /* 20s: the plugin never mounted (e.g. identity request failed) — leave it */
          } catch (e) { fin(); return; }
          setTimeout(check, 400);
        })();
      });
    }
    function dedupeUnified(d) {
      try { var ms = d.querySelectorAll('[data-smlpe-unified-mounted]'); for (var i = 1; i < ms.length; i++) ms[i].remove(); } catch (e) {}
    }
    function ensureFrame() {
      if (ifr) return;
      ifr = document.createElement('iframe'); ifr.title = 'Profile editor';
      ifr.src = editorUrl + (editorUrl.indexOf('?') >= 0 ? '&' : '?') + 'sml_studio=1';
      ifr.addEventListener('load', onFrameLoad);
      main.appendChild(ifr);
    }
    var lastFocus = null;
    function open() {
      parkPill();
      lastFocus = document.activeElement;
      el.hidden = false; loadEl.hidden = !!ifr; ensureFrame();
      try { el.querySelector('.sps-done').focus(); } catch (e) {}
      prevScrollLock = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
      try { history.replaceState(null, '', location.pathname + location.search + '#studio'); } catch (e) {}
    }
    function close() {
      el.hidden = true; document.documentElement.style.overflow = prevScrollLock;
      try { if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); else { var b = mount.querySelector('.sip-studio-open'); if (b) b.focus(); } } catch (e) {}
      try { if (location.hash === '#studio') history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
    el.querySelector('.sps-done').addEventListener('click', function () { close(); if (dirty) { dirty = false; refreshOverlay().then(function () { toast('Profile updated'); }); } });
    el.querySelector('.sps-refresh').addEventListener('click', function () { refreshOverlay().then(function () { toast('Preview refreshed from your saved profile'); }); });
    el.querySelector('.sps-arrange').addEventListener('click', function () { close(); var t = mount.querySelector('.sip-edit-toggle'); if (t) { t.click(); toast('Arrange mode — drag sections, resize orbitals, double-click a slot to add media. Click Done on the profile when finished.'); } });
    el.querySelector('.sps-live').addEventListener('click', function () { var pill = bridgePill(); if (!pill) { toast('Live preview is loading — try again in a moment'); return; } close(); pill.click(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.hidden) close(); });
    window.SML_PROFILE_STUDIO = { open: open, close: close, refresh: refreshOverlay };
    if (location.hash === '#studio') setTimeout(open, 50);
  }

  // Build a config from the live members-profile page (footer auto-inject mode):
  // identity from og:title + URL + existing DOM, music from the existing player.
  function autoConfig() {
    var seg = (location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '');
    var og = ((document.querySelector('meta[property="og:title"]') || {}).content) || document.title || '';
    var name = (og.split(/\s*[(—|]/)[0] || '').trim();
    var hm = og.match(/\(@?([A-Za-z0-9_.-]+)\)/);           // "(@grandmasterobi)" in og:title
    var handle = hm ? ('@' + hm[1].replace(/^@/, '')) : (seg ? ('@' + seg.replace(/^@/, '')) : '');
    var av = document.querySelector('.sml-profile-avatar img, img.sml-avatar, img[class*="avatar" i]');
    var bn = document.querySelector('.sml-profile-banner img, [class*="banner" i] img, [class*="cover" i] img');
    var nativeProfile = document.querySelector('[data-sml-profile]');
    var nativePlayer = document.getElementById(FRAME_ID);
    var nativePlayerSrc = nativePlayer ? String(nativePlayer.getAttribute('src') || '') : '';
    return {
      useExistingPlayer: true,
      name: name || 'Profile',
      handle: handle,
      avatarUrl: (av && av.src) || '',
      bannerUrl: (bn && bn.src) || '',
      editUrl: '/customize-profile/',
      visitorUrl: location.pathname,
      isOwner: !!((window.SML_PROFILE_UNIFIED && window.SML_PROFILE_UNIFIED.isOwner) || (window.SMLPublicProfile && window.SMLPublicProfile.profile && window.SMLPublicProfile.profile.is_owner)),
      autoplay: !!((nativeProfile && nativeProfile.getAttribute('data-music-autoplay') === '1') || /[?&]autoplay=1(?:&|$)/.test(nativePlayerSrc)),
      pulse: 'Immersive'
    };
  }
  /* Real profile config: the page already exposes SMLPublicProfile.profile (identity,
     real avatar, bio, follower counts), SML_PROFILE_UNIFIED (user id, owner, nonce,
     banner/background attachment ids + video modes, REST urls) and the profile
     engine's media API (orbital photos/videos, galleries). Nothing here is demo data:
     when a source is empty, the section stays empty. */
  function realConfig() {
    var base = autoConfig();
    var U = window.SML_PROFILE_UNIFIED || {}, P = (window.SMLPublicProfile && window.SMLPublicProfile.profile) || {};
    var uid = U.userId || P.user_id || 0;
    if (P.display_name) base.name = P.display_name;
    if (P.handle) base.handle = '@' + String(P.handle).replace(/^@/, '');
    if (P.avatar) base.avatarUrl = P.avatar; else if (/gravatar\.com/.test(base.avatarUrl)) base.avatarUrl = '';
    if (/gravatar\.com/.test(base.bannerUrl)) base.bannerUrl = '';
    base.bio = P.description || '';
    base.editUrl = U.editorUrl || base.editUrl; base.visitorUrl = P.url || base.visitorUrl;
    base.isOwner = !!(U.isOwner || P.is_owner);
    base.followUid = (!base.isOwner && uid) ? uid : 0;
    base.isFollowing = !!(P.relationship && P.relationship.is_following);
    /* the owner's saved look — painted on first frame (see init "state") */
    var imSrv = (U.immersive && typeof U.immersive === 'object') ? U.immersive : ((U.settings && U.settings.immersive_profile && typeof U.settings.immersive_profile === 'object') ? U.settings.immersive_profile : {});
    base.immersive = imSrv;
    var rel = P.relationship || {}; var stats = [];
    if (rel.follower_count != null) stats.push({ label: 'FOLLOWERS', value: String(rel.follower_count) });
    /* owner call 2026-09-09: subscribers belong to the member's Loop Channel, never to the profile page */
    /* the unified profile below already renders real counters — read them */
    try {
      var txt = (document.querySelector('main.sml-profile') || document.body).innerText || '';
      [['FOLLOWING', /FOLLOWING\s+([\d,\.KM]+)/i], ['CHARTS', /CHARTS\s+([\d,\.KM]+)/i], ['POSTS', /POSTS\s+([\d,\.KM]+)/i], ['PROFILE VIEWS', /PROFILE VIEWS\s+([\d,\.KM]+)/i], ['LIKES', /LIKES\s+([\d,\.KM]+)/i], ['FRIENDS', /FRIENDS\s+([\d,\.KM]+)/i]].forEach(function (d) { var m = txt.match(d[1]); if (m && !stats.some(function (x) { return x.label === d[0]; })) stats.push({ label: d[0], value: m[1] }); });
    } catch (e) {}
    base.stats = stats.filter(function (st) { return !/subscri/i.test(String(st.label || '')); });
    var mediaBase = '/wp-json/sml-profile/v2/profile/';
    function get(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    function att(id) { return id ? get('/wp-json/wp/v2/media/' + id) : Promise.resolve(null); }
    var mediaIds = U.media || {}; var app = (U.settings && U.settings._appearance) || {};
    return Promise.all([
      uid ? get(mediaBase + uid + '/media') : null,
      att(mediaIds.banner_id), att(mediaIds.background_id),
      uid ? get('/wp-json/sml-social-profile/v1/public/' + uid) : null,
      uid ? get('/wp-json/sml-profile/v2/profile/' + uid + '/customization') : null,
      uid ? get('/wp-json/sml-members/v1/profile-chart?user_id=' + encodeURIComponent(uid) + '&_=' + Date.now()) : null,
      uid ? get('/wp-json/sml-members/v1/tagged-posts?user_id=' + encodeURIComponent(uid) + '&_=' + Date.now()) : null,
      /* friends = members who follow each other (sml-friends-profile; 24 shown with city/state/age/relationship as their privacy allows) */
      uid ? get('/wp-json/sml-friends-profile/v1/list?user_id=' + encodeURIComponent(uid) + '&limit=24&_=' + Date.now()) : null,
      (window.SML_IL_CATALOG || CAT.applied) ? null : get('/wp-json/sml-immersive-library/v1/catalog')
    ]).then(function (r) {
      if (r[8]) applyCatalog(r[8]);
      var media = r[0] || {}, banner = r[1], bgm = r[2], soc = r[3], customization = r[4] || {};
      var fr = r[7] || {};
      base.friendsTotal = Number(fr.total || 0) || 0;
      base.friends = (Array.isArray(fr.friends) ? fr.friends : []).map(function (f) {
        var place = [f.city, f.state].filter(Boolean).join(', ');
        var meta = [f.age ? (f.age + ' yrs') : '', f.relationship || ''].filter(Boolean).join(' · ');
        return { id: Number(f.id || 0) || 0, name: f.name || 'Member', handle: f.handle ? ('@' + String(f.handle).replace(/^@/, '')) : '', avatarUrl: f.avatar || '', url: f.url || '', place: place, meta: meta, live: !!f.live };
      });
      /* Recent Activity = the member's real chart posts (sml-members profile-chart,
         the same store the homepage feed shows). Owner call 2026-09-05: one body,
         @tags as the tagged member's avatar + blue name, a typed link on the grey
         line — nothing else under a post. */
      var chart = (r[5] && Array.isArray(r[5].posts)) ? r[5].posts.slice(0, 12) : [];
      /* a friend's post that @tags this member shows up here too (owner call
         2026-09-05); the route excludes the member's own posts, so no doubles */
      var tagged = (r[6] && Array.isArray(r[6].posts)) ? r[6].posts.slice(0, 12) : [];
      tagged.forEach(function (po) { po.__tagged = true; });
      chart = chart.concat(tagged).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }).slice(0, 20);
      var handles = {}; chart.forEach(function (po) { (po.mentions || []).forEach(function (h) { h = String(h || '').toLowerCase(); if (h) handles[h] = 1; }); });
      var URL_RX = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
      base.__chartPending = Promise.all(Object.keys(handles).slice(0, 10).map(function (h) {
        return get('/wp-json/sml-site-search/v1/search?q=' + encodeURIComponent(h)).then(function (d) { var row = null; ((d && d.groups && d.groups.people) || []).forEach(function (p) { if (String(p.handle || '').toLowerCase() === h) row = p; }); return [h, row]; });
      })).then(function (pairs) {
        var MN = {}; pairs.forEach(function (pr) { if (pr[1]) MN[pr[0]] = pr[1]; });
        function rich(text) {
          return esc(text)
            .replace(/(^|[\s(])(\$[A-Za-z][A-Za-z0-9.\-]{0,9})\b/g, function (m, pre, tok) { return pre + '<a class="sip-tk" href="/stock-chart/?symbol=' + encodeURIComponent(tok.slice(1).toUpperCase()) + '">' + tok + '</a>'; })
            .replace(/(^|[\s(])@([A-Za-z0-9_.]{2,30})/g, function (m, pre, h) {
              var tail = '', mm = h.match(/^(.*?)(\.+)$/); if (mm) { h = mm[1]; tail = mm[2]; } if (h.length < 2) return m;
              var row = MN[h.toLowerCase()] || {}; var av = row.avatar ? '<img class="sip-mn-av" src="' + esc(row.avatar) + '" alt="" referrerpolicy="no-referrer">' : '<span class="sip-mn-ph"></span>';
              /* data-sml-user-id = the site's hover-card hook (sml-member-hover-cards) */
              return pre + '<a class="sip-mn" href="' + esc(row.url || ('/' + h.toLowerCase() + '/')) + '"' + (row.id ? ' data-sml-user-id="' + esc(String(row.id)) + '"' : '') + '>' + av + esc(row.name || h) + '</a>' + tail;
            });
        }
        base.posts = chart.map(function (po) {
          var raw = String(po.text || '').replace(/\s+/g, ' ').trim(); var links = [];
          var body = raw.replace(URL_RX, function (u) { links.push(u); return ' '; }).replace(/\s{2,}/g, ' ').trim();
          var when = ''; try { var d = new Date(po.date); if (!isNaN(+d)) when = d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); } catch (e) {}
          var by = po.__tagged ? (po.tagged_by || {}) : null;
          return { type: by ? 'TAGGED' : 'POST', color: by ? '#5DB9FF' : '#38F58A', time: when, ctx: by ? ('Tagged by ' + (by.name || by.handle || 'a member')) : '', ctxUrl: by ? (by.url || '') : '', ctxUid: by ? Number(by.user_id || 0) || 0 : 0, text: body, html: body ? rich(body) : '', links: links };
        }).filter(function (po) { return po.text || po.links.length; });
      }).catch(function () {});
      base.moduleVisibility = customization.module_visibility && typeof customization.module_visibility === 'object' ? customization.module_visibility : {};
      var orb = (media.orbital || []).slice(); var ov = (media.orbital_video || []).slice();
      var galleryPhoto = (media.gallery_photo || []).slice(); var galleryVideo = (media.gallery_video || []).slice();
      /* owner call 2026-09-09: desktop shows every photo at its full original resolution (the media API only hands
         out 300px Photon thumbs); phones get a Photon size that matches their screen (width × pixel ratio, ≤ 1600). */
      /* the device layer already encodes the rule (html.sml-desktop from sml-device-layers / site-search.js); any desktop window gets the original file */
      var DESKTOP = document.documentElement.classList.contains('sml-desktop') || (!(window.SMLDevice && window.SMLDevice.mobile) && !document.documentElement.classList.contains('sml-mobile') && (window.innerWidth || 1024) >= 1024);
      var PHONE_W = Math.min(1600, Math.ceil(((window.innerWidth || 390) * (window.devicePixelRatio || 1)) / 100) * 100);
      function mediaUrlFor(url) {
        url = String(url || ''); if (!url) return '';
        try {
          var u = new URL(url, location.href);
          var photon = /(^|\.)wp\.com$/.test(u.hostname) || /^i[0-9]\.wp\.com$/.test(u.hostname);
          if (DESKTOP) {
            ['fit', 'resize', 'w', 'h', 'crop', 'zoom'].forEach(function (k) { u.searchParams.delete(k); });
            u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(\.[a-z0-9]{2,5})$/i, '$1');
            return u.toString();
          }
          if (photon) { ['fit', 'resize', 'h', 'crop', 'zoom'].forEach(function (k) { u.searchParams.delete(k); }); u.searchParams.set('w', String(PHONE_W)); return u.toString(); }
          return url;
        } catch (e) { return url; }
      }
      var pick = function (it) { return it ? (it.url || it.thumb || '') : ''; };
      var pickThumb = function (it) { return it ? mediaUrlFor(it.url || it.thumb || '') : ''; };
      base.orbitalPhotos = [0, 1, 2, 3, 4, 5].map(function (i) { return pickThumb(orb[i]); });
      base.galleryPhotos = [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return pickThumb(galleryPhoto[i] || orb[6 + i]); });
      base.orbitalVideos = [0, 1, 2].map(function (i) { return pick(ov[i]); });
      base.galleryVideos = [0, 1, 2, 3, 4, 5].map(function (i) { return pick(galleryVideo[i] || ov[3 + i]); });
      base.__media = { orbital: orb, orbital_video: ov, gallery_photo: galleryPhoto, gallery_video: galleryVideo };
      if (banner && banner.source_url) { if (/^video\//.test(banner.mime_type || '') || app.banner_mode === 'video') base.bannerVideoUrl = banner.source_url; else base.bannerUrl = banner.source_url; }
      if (bgm && bgm.source_url) { if (/^video\//.test(bgm.mime_type || '') || app.background_mode === 'video') base.backgroundVideoUrl = bgm.source_url; else base.backgroundUrl = bgm.source_url; }
      var TILES = { youtube: ['▶', '#FF0033'], discord: ['DC', '#5865F2'], facebook: ['f', '#1877F2'], x: ['𝕏', '#0f1419'], twitter: ['𝕏', '#0f1419'], linkedin: ['in', '#0A66C2'], bluesky: ['BS', '#0285FF'], threads: ['@', '#101010'], instagram: ['IG', 'linear-gradient(45deg,#F58529,#DD2A7B 55%,#8134AF)'], tiktok: ['TT', '#010101'], website: ['🌐', '#1c2833'], site: ['🌐', '#1c2833'], twitch: ['TV', '#9146FF'], reddit: ['r/', '#FF4500'], telegram: ['TG', '#229ED9'] };
      /* "social profile details" = the profile's detail rows (Age, city, school,
         occupation, relationship …) — those are the ABOUT section; only real
         network keys become social tiles */
      var SOCIAL_KEYS = /^(youtube|discord|facebook|x|twitter|linkedin|bluesky|threads|instagram|tiktok|website|site|twitch|reddit|telegram|snapchat|rumble|medium|substack|github)$/;
      var items = ((soc && soc.items) || []).filter(function (it) { return it && it.value; });
      base.about = items.filter(function (it) { return !SOCIAL_KEYS.test(String(it.key || '').toLowerCase()); }).map(function (it) { return { k: it.label || it.key, v: String(it.value) }; });
      base.socials = items.filter(function (it) { return SOCIAL_KEYS.test(String(it.key || '').toLowerCase()); }).map(function (it) {
        var key = String(it.key || '').toLowerCase(); var t = TILES[key] || [String(it.label || key).charAt(0).toUpperCase(), '#1c2833'];
        var v = String(it.value); var url = /^https?:\/\//i.test(v) ? v : (key === 'x' || key === 'twitter' ? 'https://x.com/' + v.replace(/^@/, '') : key === 'instagram' ? 'https://instagram.com/' + v.replace(/^@/, '') : key === 'youtube' ? 'https://youtube.com/' + (v[0] === '@' ? v : '@' + v) : key === 'tiktok' ? 'https://tiktok.com/@' + v.replace(/^@/, '') : /^[\w.-]+\.[a-z]{2,}/i.test(v) ? 'https://' + v : '#');
        return { name: it.label || key, handle: v, url: url, glyph: t[0], tile: t[1], glyphColor: '#fff', glow: 'rgba(56,245,138,.25)', desc: '' };
      });
      var pending = base.__chartPending; delete base.__chartPending;
      return pending ? pending.then(function () { return base; }) : base;
    });
  }
  function syncOverlayTop(mount) {
    var top = 0;
    ['wpadminbar', 'sml-global-header'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var rect = el.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > top) top = rect.bottom;
    });
    top = Math.max(0, Math.ceil(top));
    mount.style.top = top + 'px';
    mount.style.setProperty('--sip-shell-top', top + 'px');
  }
  /* The site-wide "#sml-ps" song-gift pill duplicates the overlay's own dock
     "Songs for you" button — redundant chrome stacked on the same corner.
     Hidden (not removed) so the underlying plugin keeps working normally
     everywhere that isn't behind this takeover. Retried a few times since its
     own script may inject it slightly after this one boots. */
  function hideSongGiftPill() {
    var ps = document.getElementById('sml-ps');
    if (ps) ps.style.setProperty('display', 'none', 'important');
  }
  function enableOverlay(mount) {
    mount.style.cssText = 'position:fixed;left:0;right:0;bottom:0;top:0;z-index:2147483000;overflow:auto;-webkit-overflow-scrolling:touch;background:#070d14;';
    syncOverlayTop(mount);
    hideSongGiftPill();
    setTimeout(hideSongGiftPill, 500);
    setTimeout(hideSongGiftPill, 1500);
    if (!mount.__smlShellSync) {
      mount.__smlShellSync = function () { syncOverlayTop(mount); };
      window.addEventListener('resize', mount.__smlShellSync, { passive: true });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', mount.__smlShellSync, { passive: true });
      if (window.ResizeObserver) {
        mount.__smlShellObserver = new ResizeObserver(mount.__smlShellSync);
        ['wpadminbar', 'sml-global-header'].forEach(function (id) {
          var el = document.getElementById(id); if (el) mount.__smlShellObserver.observe(el);
        });
      }
      setTimeout(mount.__smlShellSync, 0);
      setTimeout(mount.__smlShellSync, 500);
    }
    try { document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; } catch (e) {}
  }
  function boot() {
    var isProfile = !!(document.body && document.body.classList.contains('sml-public-profile-page'));
    // Footer-safe: this may load site-wide, but only takes over real profile pages
    // (or anywhere an explicit window.SML_PROFILE is provided).
    if (!window.SML_PROFILE && !isProfile) return;
    if (document.getElementById('sml-immersive-profile-root') && document.querySelector('.sip-root')) return; // already mounted
    var mount = document.getElementById('sml-immersive-profile-root');
    if (!mount) { mount = document.createElement('div'); mount.id = 'sml-immersive-profile-root'; document.body.appendChild(mount); }
    if (isProfile || (window.SML_PROFILE && window.SML_PROFILE.overlay)) enableOverlay(mount);
    if (isProfile && !document.querySelector('meta[name="viewport"]')) {
      /* the public profile render ships no viewport meta (channel pages do) — phones
         laid the page out at 980px and zoomed out. Mobile rules below rely on this. */
      var vp = document.createElement('meta'); vp.name = 'viewport'; vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      document.head.appendChild(vp);
    }
    /* pre-paint guard (wpcode/prepaint-guard.php): the overlay's own dark canvas is
       up now, so the old unified profile never shows underneath — reveal */
    document.documentElement.classList.remove('sml-pp');
    if (!window.SML_PROFILE && isProfile) {
      /* real data first (identity, media, banner/background, socials); the overlay
         paints the dark canvas immediately so nothing old shows in the meantime */
      realConfig().then(function (cfgReal) { window.SML_PROFILE = cfgReal; init(mount); }, function () { window.SML_PROFILE = autoConfig(); init(mount); });
      return;
    }
    init(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
