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
    name: 'Vaughn McNair',
    handle: '@grandmasterobi',
    roles: ['Momentum Trader', 'Options Trader'],
    avatarUrl: '', bannerUrl: '', backgroundUrl: '',
    editUrl: '', visitorUrl: '',
    stats: [
      { label: 'FOLLOWERS', value: '2' }, { label: 'FOLLOWING', value: '1' },
      { label: 'CHARTS', value: '1' }, { label: 'POSTS', value: '1' },
      { label: 'PROFILE VIEWS', value: '61' }, { label: 'LIKES', value: '1' }
    ],
    tickers: [
      { sym: '$MRAM', chg: '+12.4%', dir: 'up' }, { sym: '$SNDK', chg: '+3.1%', dir: 'up' },
      { sym: '$AKAN', chg: '-4.2%', dir: 'down' }, { sym: '$SDOT', chg: '+8.9%', dir: 'up' },
      { sym: '$NVDA', chg: '+1.6%', dir: 'up' }
    ],
    about: [
      { k: 'Age', v: '32 years old' }, { k: 'Birth month and year', v: 'February 1994' },
      { k: 'Current city', v: 'Chicago' }, { k: 'Birth city', v: 'Joliet, IL' },
      { k: 'High school', v: 'Lockport, IL' }, { k: 'Graduated', v: '2012' },
      { k: 'Occupation', v: 'Stock Market Analyst' }, { k: 'Relationship', v: 'In a relationship' }
    ],
    friends: [{ name: 'Stock Market Loop', handle: '@stockmarketloop', avatarUrl: '' }],
    disclaimer: 'Market data and content on Stock Market Loop are for informational purposes only and do not constitute investment advice.',
    orbitalPhotos: ['', '', '', '', '', ''],           // 6 URLs (ring)
    galleryPhotos: ['', '', '', '', '', '', '', ''],   // 8 URLs (grid)
    posts: [
      { type: 'POST', color: '#38F58A', time: '2h ago', ctx: '', text: 'Locked in $MRAM at 4.20 pre-market. Momentum thesis playing out — watching volume into the close.' },
      { type: 'COMMENT', color: '#3d8bfd', time: '5h ago', ctx: 'On Stock Market Loop’s post “Semis weekly recap”', text: 'Great breakdown of the semis run. $SNDK still has legs imo.' },
      { type: 'SHARED', color: '#ffb020', time: '1d ago', ctx: 'Shared Stock Market Loop’s chart', text: '$NVDA weekly — ascending channel intact, retest of the mid-line looks likely.' },
      { type: 'POST', color: '#38F58A', time: '2d ago', ctx: '', text: 'New week, new watchlist: $MRAM, $SDOT, $AKAN. Risk tight, size small.' },
      { type: 'COMMENT', color: '#3d8bfd', time: '3d ago', ctx: 'On @tradequeen’s post “Chasing green candles”', text: 'This is why you wait for confirmation candles.' }
    ],
    socials: [
      { name: 'YouTube', handle: '@grandmasterobi', url: '#', glyph: '▶', tile: '#FF0033', glyphColor: '#fff', glow: 'rgba(255,0,51,.5)', desc: 'Market breakdowns, live trading streams & recaps' },
      { name: 'Discord', handle: 'grandmasterobi', url: '#', glyph: 'DC', tile: '#5865F2', glyphColor: '#fff', glow: 'rgba(88,101,242,.5)', desc: 'Trading community — watchlists & live calls' },
      { name: 'Facebook', handle: 'Vaughn McNair', url: '#', glyph: 'f', tile: '#1877F2', glyphColor: '#fff', glow: 'rgba(24,119,242,.5)', desc: 'Daily market notes & longer write-ups' },
      { name: 'X (Twitter)', handle: '@grandmasterobi', url: '#', glyph: '𝕏', tile: '#0f1419', glyphColor: '#fff', glow: 'rgba(230,237,245,.35)', desc: 'Real-time trade alerts & hot takes' },
      { name: 'LinkedIn', handle: 'vaughn-mcnair', url: '#', glyph: 'in', tile: '#0A66C2', glyphColor: '#fff', glow: 'rgba(10,102,194,.5)', desc: 'Professional background & analyst work' },
      { name: 'Bluesky', handle: '@grandmasterobi.bsky.social', url: '#', glyph: 'BS', tile: '#0285FF', glyphColor: '#fff', glow: 'rgba(2,133,255,.5)', desc: 'Casual market chatter, off the algorithm' },
      { name: 'Threads', handle: '@grandmasterobi', url: '#', glyph: '@', tile: '#101010', glyphColor: '#fff', glow: 'rgba(230,237,245,.35)', desc: 'Quick thoughts between trading sessions' },
      { name: 'Instagram', handle: '@grandmasterobi', url: '#', glyph: 'IG', tile: 'linear-gradient(45deg,#F58529,#DD2A7B 55%,#8134AF)', glyphColor: '#fff', glow: 'rgba(221,42,123,.5)', desc: 'Chart snapshots, setups & lifestyle' }
    ],
    contact: { email: '', phone: '', optIn: true },
    music: { url: '', title: 'Profile track' },
    useExistingPlayer: false,
    bpm: 120,
    pulse: 'Immersive',
    shapes: ['dot', 'ring', 'diamond', 'plus', 'sparkle', 'note', 'dollar', 'candle'],
    fx: ['Rain'],
    texture: 'Glass',
    particleDensity: 60, bannerShake: true, orbitalSize: 300
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
      out[k] = empty ? DEFAULTS[k] : v;
    }
    if (user.music && user.music.url) out.music = { url: user.music.url, title: user.music.title || DEFAULTS.music.title };
    if (user.contact) out.contact = { email: user.contact.email || '', phone: user.contact.phone || '', optIn: user.contact.optIn !== false };
    return out;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }

  var CSS = '' +
    '.sip-root{--kick:0;--bkick:0;--bass:0;--mid:0;--high:0;--card-bg:rgba(17,24,35,.72);min-height:100vh;background:radial-gradient(1100px 560px at 72% -8%,rgba(1,167,125,.16) 0%,rgba(7,13,20,0) 62%),#070d14;color:#E6EDF5;font-family:"IBM Plex Sans",sans-serif;overflow-x:hidden;position:relative;box-sizing:border-box;}' +
    '.sip-root *{box-sizing:border-box;}' +
    '.sip-root [hidden]{display:none !important;}' +
    '.sip-root a{color:#38F58A;text-decoration:none;}.sip-root a:hover{color:#8dffc2;}' +
    '.sip-bg{position:fixed;inset:0;z-index:0;background-size:cover;background-position:center;}' +
    '.sip-bg-scrim{position:absolute;inset:0;background:rgba(7,13,20,.55);pointer-events:none;}' +
    '.sip-fx{position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none;}' +
    '.sip-worldnav{position:fixed;top:50%;transform:translateY(-50%);z-index:6;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(11,19,31,.72);color:#38F58A;font-size:18px;cursor:pointer;backdrop-filter:blur(8px);}' +
    '.sip-exit{position:fixed;top:10px;right:12px;z-index:7;border:1px solid rgba(255,255,255,.2);background:rgba(11,19,31,.82);color:#c3ccd4;border-radius:999px;padding:7px 13px;font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.5px;cursor:pointer;backdrop-filter:blur(8px);}' +
    '.sip-exit:hover{border-color:#38F58A;color:#38F58A;}' +
    '.sip-reenter{position:fixed;right:14px;bottom:14px;z-index:2147483000;background:#38F58A;color:#03120A;border:none;border-radius:999px;padding:10px 16px;font:700 12.5px/1 "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4);}' +
    '.sip-content{position:relative;z-index:2;max-width:1060px;margin:0 auto;padding:clamp(14px,3vw,26px) clamp(12px,3vw,26px) 170px;}' +
    '.sip-topbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:2px 4px 16px;}' +
    '.sip-logo-dot{width:11px;height:11px;border-radius:50%;background:#38F58A;box-shadow:0 0 calc(10px + var(--kick,0)*24px) rgba(56,245,138,.85);display:inline-block;}' +
    '.sip-logo{font-family:Archivo,sans-serif;font-weight:800;letter-spacing:2px;font-size:13px;}' +
    '.sip-nav{display:flex;gap:18px;font-size:13px;color:#7e8a96;margin-left:auto;}.sip-nav a{color:#7e8a96;}' +
    '.sip-worldtabs{display:flex;align-items:center;gap:6px;margin:0 0 12px;flex-wrap:wrap;}' +
    '.sip-wtab{border:1px solid rgba(255,255,255,.14);background:rgba(11,19,31,.6);color:#93A4B8;border-radius:999px;padding:6px 13px;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.4px;font-weight:600;cursor:pointer;}' +
    '.sip-wtab.on{background:#38F58A;color:#03120A;border-color:#38F58A;}' +
    '.sip-wtab-hint{font-size:11px;color:#6B7C90;margin-left:auto;}' +
    '.sip-screens{position:relative;perspective:1400px;transition:height .5s ease;}' +
    '.sip-screen{position:absolute;top:0;left:0;right:0;transition:transform .65s cubic-bezier(.22,.85,.3,1),opacity .65s;backface-visibility:hidden;}' +
    '.sip-worldtitle{font-family:Archivo,sans-serif;font-weight:900;font-size:clamp(24px,4vw,34px);letter-spacing:-0.5px;}' +
    '.sip-worldsub{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;margin:4px 0 16px;}' +
    '.sip-hero{position:relative;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0B131F;}' +
    '.sip-banner{height:clamp(190px,30vw,300px);transform:scale(calc(1 + var(--bkick,0)*0.06)) rotate(calc(var(--bkick,0)*0.35deg));background-size:cover;background-position:center;}' +
    '.sip-ph{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 14px,rgba(255,255,255,.055) 14px 28px);color:#6B7C90;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:1px;text-align:center;padding:8px;}' +
    '.sip-hero-fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,13,20,0) 34%,rgba(7,13,20,.94) 100%);pointer-events:none;}' +
    '.sip-hero-row{position:absolute;left:0;right:0;bottom:0;display:flex;gap:16px;align-items:flex-end;padding:clamp(12px,2.5vw,22px);flex-wrap:wrap;}' +
    '.sip-avatar{position:relative;width:clamp(84px,12vw,112px);height:clamp(84px,12vw,112px);flex:none;}' +
    '.sip-avatar-img{width:100%;height:100%;border-radius:50%;background-size:cover;background-position:center;overflow:hidden;}' +
    '.sip-avatar-ring{position:absolute;inset:-5px;border-radius:50%;pointer-events:none;box-shadow:0 0 0 calc(2px + var(--bass,0)*9px) rgba(56,245,138,calc(0.45 + var(--kick,0)*0.55)),0 0 calc(16px + var(--kick,0)*54px) rgba(56,245,138,calc(0.25 + var(--kick,0)*0.5));}' +
    '.sip-name{margin:0;font-family:Archivo,sans-serif;font-weight:900;font-size:clamp(26px,4.5vw,40px);letter-spacing:-1px;line-height:1.05;text-shadow:0 0 calc(var(--kick,0)*28px) rgba(56,245,138,.65);}' +
    '.sip-handle{color:#38F58A;font-size:14px;font-weight:600;margin-top:3px;}' +
    '.sip-roles{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}' +
    '.sip-role{font-size:11px;font-weight:600;color:#93A4B8;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 10px;background:rgba(11,19,31,.6);white-space:nowrap;}' +
    '.sip-btn{padding:9px 18px;border-radius:999px;border:none;background:#38F58A;color:#03120A;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;display:inline-block;}' +
    '.sip-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.16);color:#c3ccd4;font-weight:400;}' +
    '.sip-sec{border-radius:8px;}' +
    '.sip-sec.edit{outline:2px dashed rgba(56,245,138,.4);outline-offset:5px;cursor:move;}' +
    '.sip-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-top:14px;}' +
    '.sip-stat{background:var(--card-bg);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:10px 12px;backdrop-filter:blur(8px);transform:translateY(calc(var(--kick,0)*-8px));}' +
    '.sip-stat-l{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:1.4px;color:#6B7C90;}' +
    '.sip-stat-v{font-family:Archivo,sans-serif;font-weight:800;font-size:20px;margin-top:2px;}' +
    '.sip-ticks{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}' +
    '.sip-tick{display:flex;gap:8px;align-items:baseline;background:rgba(11,19,31,.7);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:7px 14px;backdrop-filter:blur(8px);font-family:"IBM Plex Mono",monospace;transform:translateY(calc(var(--kick,0)*-7px)) scale(calc(1 + var(--kick,0)*0.04));}' +
    '.sip-tick b{font-weight:600;font-size:12.5px;}.sip-tick span{font-size:11.5px;}' +
    '.sip-orbwrap{display:flex;flex-wrap:wrap;gap:20px;margin-top:14px;justify-content:space-around;align-items:flex-start;}' +
    '.sip-orbcol{flex:1;min-width:290px;padding:8px 0;}' +
    '.sip-orbhead{display:flex;align-items:center;gap:12px;}' +
    '.sip-orbhead-t{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;flex:1;}' +
    '.sip-stage{position:relative;height:300px;perspective:1000px;transform-style:preserve-3d;}' +
    '.sip-ring{position:absolute;inset:0;transform-style:preserve-3d;}' +
    '.sip-orb-photo{position:absolute;left:50%;top:50%;width:110px;height:150px;margin:-75px 0 0 -55px;border-radius:12px;backface-visibility:hidden;background-size:cover;background-position:center;background-color:rgba(17,24,35,.72);border:1px solid rgba(255,255,255,.09);overflow:hidden;}' +
    '.sip-orb-video{position:absolute;left:50%;top:50%;width:126px;height:190px;margin:-95px 0 0 -63px;border-radius:12px;overflow:hidden;backface-visibility:hidden;cursor:pointer;background:rgba(17,24,35,.72);border:1px solid rgba(255,255,255,.09);}' +
    '.sip-orb-video video{width:100%;height:100%;object-fit:cover;}' +
    '.sip-cellph{display:flex;width:100%;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:6px;background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 14px,rgba(255,255,255,.055) 14px 28px);color:#6B7C90;font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:1px;text-align:center;padding:8px;}' +
    '.sip-itembtns{position:absolute;top:6px;left:6px;z-index:3;display:flex;gap:4px;}' +
    '.sip-ibtn{width:24px;height:24px;border-radius:6px;border:none;background:rgba(0,0,0,.55);color:#c3ccd4;font-size:12px;cursor:pointer;backdrop-filter:blur(6px);}' +
    '.sip-ibtn.z{color:#38F58A;}' +
    '.sip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-top:14px;}' +
    '.sip-card{background:var(--card-bg);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:18px 20px;backdrop-filter:blur(10px);}' +
    '.sip-card-h{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;margin-bottom:10px;}' +
    '.sip-row{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12.5px;}' +
    '.sip-row .k{color:#6B7C90;}.sip-row .v{color:#E6EDF5;font-weight:600;text-align:right;}' +
    '.sip-friend{display:flex;align-items:center;gap:12px;margin-top:10px;}' +
    '.sip-friend-av{width:44px;height:44px;border-radius:50%;background:linear-gradient(140deg,#38F58A,#01A77D);color:#03120A;display:flex;align-items:center;justify-content:center;font-family:Archivo,sans-serif;font-weight:800;font-size:15px;flex:none;background-size:cover;background-position:center;box-shadow:0 0 0 calc(1px + var(--bass,0)*5px) rgba(56,245,138,.4);}' +
    '.sip-disc{background:rgba(11,19,31,.6);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:14px 20px;backdrop-filter:blur(10px);}' +
    '.sip-disc-h{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#6B7C90;margin-bottom:6px;}' +
    '.sip-disc-t{font-size:11.5px;color:#93A4B8;line-height:1.6;}' +
    '.sip-galphotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}' +
    '.sip-galphoto{aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:var(--card-bg);border:1px solid rgba(255,255,255,.09);transform:scale(calc(1 + var(--kick,0)*0.04));box-shadow:0 10px 26px rgba(0,0,0,.4);background-size:cover;background-position:center;cursor:pointer;}' +
    '.sip-galvids{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;}' +
    '.sip-galvid{aspect-ratio:3/4;border-radius:14px;overflow:hidden;background:var(--card-bg);border:1px solid rgba(255,255,255,.09);cursor:pointer;transform:scale(calc(1 + var(--bass,0)*0.03));box-shadow:0 10px 26px rgba(0,0,0,.4);}' +
    '.sip-galvid video{width:100%;height:100%;object-fit:cover;}' +
    '.sip-posts{display:flex;flex-direction:column;gap:10px;max-width:720px;}' +
    '.sip-post{background:var(--card-bg);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px;backdrop-filter:blur(8px);transform:translateY(calc(var(--kick,0)*-3px));}' +
    '.sip-post-h{display:flex;gap:8px;align-items:center;margin-bottom:6px;}' +
    '.sip-post-badge{font-family:"IBM Plex Mono",monospace;font-size:9px;letter-spacing:1.4px;border-radius:999px;padding:3px 9px;}' +
    '.sip-post-time{font-size:11px;color:#6B7C90;font-family:"IBM Plex Mono",monospace;}' +
    '.sip-post-ctx{font-size:11.5px;color:#6B7C90;margin-bottom:4px;}' +
    '.sip-post-text{font-size:13.5px;line-height:1.6;color:#E6EDF5;}' +
    '.sip-socials{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;}' +
    '.sip-social{display:flex;gap:12px;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(11,19,31,.6);border-radius:14px;padding:12px 14px;color:#E6EDF5;transform:translateY(calc(var(--kick,0)*-4px));}' +
    '.sip-social:hover{border-color:rgba(56,245,138,.6);background:rgba(56,245,138,.06);}' +
    '.sip-social-tile{width:44px;height:44px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:Archivo,sans-serif;font-weight:900;font-size:16px;letter-spacing:-0.5px;box-shadow:0 0 calc(var(--kick,0)*14px) rgba(56,245,138,.4);}' +
    '.sip-social-txt{display:flex;flex-direction:column;gap:1px;min-width:0;}' +
    '.sip-social-name{font-size:13px;font-weight:700;}' +
    '.sip-social-handle{font-size:10.5px;color:#38F58A;font-family:"IBM Plex Mono",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.sip-social-desc{font-size:11px;color:#6B7C90;line-height:1.45;}' +
    '.sip-editbadge{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:8;background:rgba(11,19,31,.9);border:1px solid rgba(56,245,138,.5);color:#38F58A;border-radius:999px;padding:7px 16px;font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:1px;backdrop-filter:blur(10px);white-space:nowrap;}' +
    '.sip-dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);width:min(1024px,calc(100vw - 18px));z-index:5;background:rgba(11,19,31,.84);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 calc(var(--kick,0)*44px) rgba(56,245,138,calc(var(--kick,0)*0.3));}' +
    '.sip-play{width:46px;height:46px;border-radius:50%;border:none;background:#38F58A;color:#03120A;font-size:14px;font-weight:700;cursor:pointer;flex:none;box-shadow:0 0 calc(8px + var(--kick,0)*32px) rgba(56,245,138,.55);}' +
    '.sip-track{min-width:150px;max-width:210px;}' +
    '.sip-track-l{font-family:"IBM Plex Mono",monospace;font-size:9px;letter-spacing:1.6px;color:#38F58A;}' +
    '.sip-track-t{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}' +
    '.sip-time{font-size:11px;color:#6B7C90;font-family:"IBM Plex Mono",monospace;margin-top:2px;}' +
    '.sip-wave{flex:1;min-width:160px;height:44px;cursor:pointer;}.sip-wave canvas{width:100%;height:100%;display:block;}' +
    '.sip-eq{display:flex;gap:2px;align-items:flex-end;height:36px;flex:none;}' +
    '.sip-eq div{width:4px;height:3px;background:#38F58A;border-radius:2px;}' +
    '.sip-ctl{display:flex;flex-direction:column;gap:4px;position:relative;}' +
    '.sip-ctl-l{font-family:"IBM Plex Mono",monospace;font-size:9px;letter-spacing:1.6px;color:#6B7C90;}' +
    '.sip-seg{display:flex;gap:4px;background:rgba(255,255,255,.04);border-radius:999px;padding:3px;}' +
    '.sip-chip{border:1px solid rgba(255,255,255,.14);background:transparent;color:#93A4B8;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
    '.sip-chip.on{background:#38F58A;color:#03120A;border-color:#38F58A;}' +
    '.sip-chip.tint.on{background:rgba(56,245,138,.16);color:#38F58A;border-color:rgba(56,245,138,.55);}' +
    '.sip-panel{position:absolute;bottom:calc(100% + 10px);right:0;width:min(460px,calc(100vw - 30px));max-height:330px;overflow:auto;background:rgba(11,19,31,.95);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;box-shadow:0 -10px 40px rgba(0,0,0,.5);}' +
    '.sip-panel-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;}' +
    '.sip-panel-t{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:1.8px;color:#38F58A;flex:1;}' +
    '.sip-panel-grid{display:flex;flex-wrap:wrap;gap:6px;}' +
    '.sip-panel-note{font-size:11px;color:#6B7C90;margin-top:10px;line-height:1.5;}' +
    '.sip-overlay{position:fixed;inset:0;z-index:9;background:rgba(4,9,14,.72);backdrop-filter:blur(7px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;cursor:pointer;}' +
    '.sip-overlay-btn{width:92px;height:92px;border-radius:50%;background:#38F58A;color:#03120A;display:flex;align-items:center;justify-content:center;font-size:32px;animation:sip-breathe 1.6s ease-in-out infinite;box-shadow:0 0 70px rgba(56,245,138,.5);}' +
    '.sip-overlay-t{font-family:Archivo,sans-serif;font-weight:800;font-size:22px;letter-spacing:.5px;}' +
    '.sip-overlay-s{font-size:13px;color:#93A4B8;max-width:340px;text-align:center;line-height:1.6;}' +
    '.sip-yt{position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;border:0;}' +
    '@keyframes sip-breathe{0%,100%{transform:scale(1);}50%{transform:scale(1.07);}}';

  // ---------------------------------------------------------------- markup
  function markup(cfg) {
    function ph(url, label, cls) {
      var st = url ? ' style="background-image:url(\'' + esc(url) + '\')"' : '';
      var inner = url ? '' : '<div class="sip-ph"' + (cls === 'circle' ? ' style="border-radius:50%"' : '') + '>' + esc(label) + '</div>';
      return { st: st, inner: inner };
    }
    var statHtml = cfg.stats.map(function (s) {
      return '<div class="sip-stat"><div class="sip-stat-l">' + esc(s.label) + '</div><div class="sip-stat-v">' + esc(s.value != null ? s.value : s.v) + '</div></div>';
    }).join('');
    var tickHtml = cfg.tickers.map(function (t) {
      var col = (t.dir === 'down' || /^-/.test(t.chg)) ? '#ff5c7a' : '#38F58A';
      return '<div class="sip-tick"><b>' + esc(t.sym) + '</b><span style="color:' + col + '">' + esc(t.chg) + '</span></div>';
    }).join('');
    var aboutHtml = cfg.about.map(function (r) {
      return '<div class="sip-row"><span class="k">' + esc(r.k) + '</span><span class="v">' + esc(r.v) + '</span></div>';
    }).join('');
    var friendHtml = cfg.friends.map(function (f) {
      var initials = esc((f.name || '?').split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase());
      var av = f.avatarUrl ? ' style="background-image:url(\'' + esc(f.avatarUrl) + '\')"' : '';
      return '<div class="sip-friend"><div class="sip-friend-av"' + av + '>' + (f.avatarUrl ? '' : initials) + '</div><div><div style="font-weight:600;font-size:13.5px;">' + esc(f.name) + '</div><div style="font-size:11.5px;color:#6B7C90;">' + esc(f.handle) + '</div></div></div>';
    }).join('');

    // Orbital photo ring (6)
    var orbPhotos = '';
    for (var i = 0; i < 6; i++) {
      var p = ph(cfg.orbitalPhotos[i], 'photo ' + (i + 1));
      orbPhotos += '<div class="sip-orb-photo" data-ophoto="' + i + '"' + p.st + '>' + p.inner +
        '<div class="sip-itembtns" data-editonly hidden><button class="sip-ibtn z" data-ozoom="' + i + '" title="Bring to front">⤢</button>' +
        '<button class="sip-ibtn" data-osmall="photo:' + i + '" title="Smaller">−</button>' +
        '<button class="sip-ibtn" data-obig="photo:' + i + '" title="Bigger">＋</button></div></div>';
    }
    // Orbital video ring (3)
    var orbVids = '';
    for (var j = 0; j < 3; j++) {
      orbVids += '<div class="sip-orb-video" data-ovideo="' + j + '"><div class="sip-cellph" data-vph><span style="font-size:20px;color:#38F58A;">＋</span><span>add clip ' + (j + 1) + '</span></div>' +
        '<div class="sip-itembtns" data-editonly hidden><button class="sip-ibtn" data-osmall="video:' + j + '" title="Smaller">−</button>' +
        '<button class="sip-ibtn" data-obig="video:' + j + '" title="Bigger">＋</button></div></div>';
    }

    // Gallery photos (8)
    var galP = '';
    for (var g = 0; g < 8; g++) {
      var gp = ph(cfg.galleryPhotos[g], 'gallery photo ' + (g + 1));
      galP += '<div class="sip-galphoto" data-gphoto="' + g + '"' + gp.st + '>' + gp.inner + '</div>';
    }
    // Gallery videos (6)
    var galV = '';
    for (var gvi = 0; gvi < 6; gvi++) {
      galV += '<div class="sip-galvid" data-gvideo="' + gvi + '"><div class="sip-cellph" data-vph><span style="font-size:22px;color:#38F58A;">＋</span><span>add video ' + (gvi + 1) + '</span><span style="opacity:.6;">(in edit mode)</span></div></div>';
    }

    var postHtml = cfg.posts.map(function (po) {
      return '<div class="sip-post"><div class="sip-post-h"><span class="sip-post-badge" style="color:' + esc(po.color) + ';border:1px solid ' + esc(po.color) + '">' + esc(po.type) + '</span><span class="sip-post-time">' + esc(po.time) + '</span></div>' +
        (po.ctx ? '<div class="sip-post-ctx">' + esc(po.ctx) + '</div>' : '') +
        '<div class="sip-post-text">' + esc(po.text) + '</div></div>';
    }).join('');
    var socialHtml = cfg.socials.map(function (so) {
      return '<a class="sip-social" href="' + esc(so.url || '#') + '"><span class="sip-social-tile" style="background:' + esc(so.tile) + ';color:' + esc(so.glyphColor || '#fff') + ';">' + esc(so.glyph) + '</span>' +
        '<span class="sip-social-txt"><span class="sip-social-name">' + esc(so.name) + '</span><span class="sip-social-handle">' + esc(so.handle) + '</span><span class="sip-social-desc">' + esc(so.desc || '') + '</span></span></a>';
    }).join('');

    var eqHtml = ''; for (var e = 0; e < 26; e++) eqHtml += '<div></div>';
    var lvlHtml = LEVELS.map(function (l) { return '<button class="sip-chip" data-level="' + l + '">' + l + '</button>'; }).join('');
    var shapeHtml = SHAPES.map(function (d) { return '<button class="sip-chip tint" data-shape="' + d[0] + '">' + esc(d[1]) + '</button>'; }).join('');
    var fxHtml = FXDEFS.map(function (v) { return '<button class="sip-chip tint" data-fx="' + v + '">' + v + '</button>'; }).join('');
    var texHtml = ['Glass', 'Carbon', 'Brushed', 'Holo'].map(function (v) { return '<button class="sip-chip" data-tex="' + v + '">' + v + '</button>'; }).join('');
    var worldTabsHtml = WORLDS.map(function (w, i) { return '<button class="sip-wtab" data-world="' + i + '">' + w + '</button>'; }).join('');

    var b = ph(cfg.bannerUrl, 'banner image');
    var av = ph(cfg.avatarUrl, 'avatar', 'circle');
    var bg = cfg.backgroundUrl ? ' style="background-image:url(\'' + esc(cfg.backgroundUrl) + '\')"' : '';
    // "Edit profile" opens the SITE's real editor (avatar/banner/bio/music) — the
    // user's native abilities. "Arrange" is the immersive-only layout edit mode.
    var editBtn = cfg.editUrl
      ? '<a class="sip-btn" href="' + esc(cfg.editUrl) + '">Edit profile</a>'
      : '<button class="sip-btn sip-edit-toggle" type="button">Arrange</button>';
    var arrangeBtn = cfg.editUrl ? '<button class="sip-btn ghost sip-edit-toggle" type="button">Arrange</button>' : '';
    var visitorBtn = '<a class="sip-btn ghost" href="' + esc(cfg.visitorUrl || '#') + '">View as visitor</a>';

    // World 0: PROFILE
    var world0 =
      '<div class="sip-screen">' +
      '<div class="sip-hero"><div class="sip-banner"' + b.st + '>' + b.inner + '</div><div class="sip-hero-fade"></div>' +
      '<div class="sip-hero-row">' +
      '<div class="sip-avatar"><div class="sip-avatar-ring"></div><div class="sip-avatar-img"' + av.st + '>' + av.inner + '</div></div>' +
      '<div style="flex:1;min-width:200px;"><h1 class="sip-name">' + esc(cfg.name) + '</h1><div class="sip-handle">' + esc(cfg.handle) + '</div>' +
      '<div class="sip-roles">' + cfg.roles.map(function (r) { return '<span class="sip-role">' + esc(r) + '</span>'; }).join('') + '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + editBtn + arrangeBtn + visitorBtn + '</div>' +
      '</div></div>' +
      '<div class="sip-sections" style="display:flex;flex-direction:column;">' +
      '<div class="sip-sec" data-sec="stats"><div class="sip-stats">' + statHtml + '</div></div>' +
      '<div class="sip-sec" data-sec="tickers"><div class="sip-ticks">' + tickHtml + '</div></div>' +
      '<div class="sip-sec" data-sec="orbitals"><div class="sip-orbwrap">' +
      '<div class="sip-orbcol"><div class="sip-orbhead"><div class="sip-orbhead-t">ORBITAL PHOTOS</div><input type="range" min="180" max="560" step="10" class="sip-psize" data-editonly hidden title="Photo size" style="width:110px;accent-color:#38F58A;"></div>' +
      '<div class="sip-stage sip-pstage"><div class="sip-ring sip-pring">' + orbPhotos + '</div></div></div>' +
      '<div class="sip-orbcol"><div class="sip-orbhead"><div class="sip-orbhead-t">ORBITAL VIDEOS</div><input type="range" min="180" max="560" step="10" class="sip-vsize" data-editonly hidden title="Video size" style="width:110px;accent-color:#38F58A;"></div>' +
      '<div class="sip-stage sip-vstage"><div class="sip-ring sip-vring">' + orbVids + '</div></div></div>' +
      '</div></div>' +
      '<div class="sip-sec" data-sec="about"><div class="sip-grid">' +
      '<div class="sip-card"><div class="sip-card-h">ABOUT</div>' + aboutHtml + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:14px;">' +
      '<div class="sip-card"><div class="sip-card-h">FRIENDS</div>' + friendHtml + '</div>' +
      '<div class="sip-disc"><div class="sip-disc-h">DISCLAIMER</div><div class="sip-disc-t">' + esc(cfg.disclaimer) + '</div></div>' +
      '</div></div></div>' +
      '</div></div>';
    // World 1: PHOTOS
    var world1 = '<div class="sip-screen"><div class="sip-worldtitle">Photo Gallery</div><div class="sip-worldsub">SWIPE LEFT FOR VIDEOS →</div><div class="sip-galphotos">' + galP + '</div></div>';
    // World 2: VIDEOS
    var world2 = '<div class="sip-screen"><div class="sip-worldtitle">Video Gallery</div><div class="sip-worldsub">SWIPE LEFT FOR POSTS →</div><div class="sip-galvids">' + galV + '</div></div>';
    // World 3: POSTS
    var world3 = '<div class="sip-screen"><div class="sip-worldtitle">Recent Activity</div><div class="sip-worldsub">POSTS · COMMENTS · SHARES — SWIPE LEFT FOR CONTACT →</div><div class="sip-posts">' + postHtml + '</div></div>';
    // World 4: CONTACT
    var c = cfg.contact || {};
    var contactRows = (c.email ? '<div class="sip-row"><span class="k">Email</span><a href="mailto:' + esc(c.email) + '" class="v">' + esc(c.email) + '</a></div>' : '') +
      (c.phone ? '<div class="sip-row"><span class="k">Phone</span><span class="v">' + esc(c.phone) + '</span></div>' : '');
    var world4 = '<div class="sip-screen"><div class="sip-worldtitle">Contact &amp; Socials</div><div class="sip-worldsub">SWIPE RIGHT TO GO BACK ←</div>' +
      '<div class="sip-grid" style="align-items:start;">' +
      '<div class="sip-card"><div class="sip-card-h">CONTACT INFO</div><div class="sip-contact-in">' + (contactRows || '<div style="font-size:12.5px;color:#6B7C90;line-height:1.6;">No contact info shared.</div>') + '</div>' +
      '<div class="sip-contact-out" style="display:none;font-size:12.5px;color:#6B7C90;line-height:1.6;">The profile owner hasn’t shared contact info.</div>' +
      '<button class="sip-optin sip-btn" type="button" data-editonly hidden style="margin-top:12px;background:rgba(56,245,138,.12);color:#38F58A;border:1px solid rgba(56,245,138,.5);"></button></div>' +
      '<div class="sip-card"><div class="sip-card-h">SOCIALS</div><div class="sip-socials">' + socialHtml + '</div></div>' +
      '</div></div>';

    var ytIframe = (!cfg.useExistingPlayer && ytId(cfg.music.url)) ?
      '<iframe id="' + FRAME_ID + '" class="sip-yt" allow="autoplay; encrypted-media" src="https://www.youtube-nocookie.com/embed/' + esc(ytId(cfg.music.url)) + '?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&controls=0&loop=1&playlist=' + esc(ytId(cfg.music.url)) + '"></iframe>' : '';

    return '' +
      '<div class="sip-root">' +
      '<div class="sip-bg"' + bg + '><div class="sip-bg-scrim"></div></div>' +
      '<canvas class="sip-fx"></canvas>' +
      '<button class="sip-worldnav sip-prev" style="left:10px;" title="Previous world">‹</button>' +
      '<button class="sip-worldnav sip-next" style="right:10px;" title="Next world">›</button>' +
      '<button class="sip-exit" title="Exit to your normal profile (Customize, Settings, everything)">✕ Classic profile</button>' +
      '<div class="sip-editbadge" hidden>EDIT MODE — drag sections to reorder · ⤢ − ＋ resize photos &amp; videos</div>' +
      '<div class="sip-content">' +
      '<div class="sip-topbar"><span class="sip-logo-dot"></span><span class="sip-logo">STOCKMARKETLOOP</span>' +
      '<nav class="sip-nav"><a href="/watch/">Watch</a><a href="/live/">Live</a><a href="/markets/">Markets</a><a href="/n/">Newsletters</a></nav></div>' +
      '<div class="sip-worldtabs">' + worldTabsHtml + '<span class="sip-wtab-hint">swipe or use ‹ › to travel</span></div>' +
      '<div class="sip-screens">' + world0 + world1 + world2 + world3 + world4 + '</div>' +
      '</div>' +
      // Dock
      '<div class="sip-dock">' +
      '<button class="sip-play">▶</button>' +
      '<div class="sip-track"><div class="sip-track-l">PROFILE MUSIC · YOUTUBE</div><div class="sip-track-t">' + esc(cfg.music.title) + '</div><div class="sip-time">0:00 / 0:00</div></div>' +
      '<div class="sip-wave"><canvas></canvas></div>' +
      '<div class="sip-eq">' + eqHtml + '</div>' +
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
      '<div class="sip-overlay"><div class="sip-overlay-btn">▶</div><div class="sip-overlay-t">Tap for sound</div>' +
      '<div class="sip-overlay-s">Profile Pulse reacts to the beat of your YouTube profile music. Set to Immersive.</div></div>' +
      '</div>';
  }

  // ---------------------------------------------------------------- init
  function init(mount) {
    var cfg = merge();
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
    var level = LEVELS.indexOf(cfg.pulse) >= 0 ? cfg.pulse : 'Immersive';
    var savedLvl = lsGet('sml_profile_pulse_level', null);
    if (LEVELS.map(function (l) { return l.toLowerCase(); }).indexOf(String(savedLvl)) >= 0) {
      level = LEVELS[LEVELS.map(function (l) { return l.toLowerCase(); }).indexOf(String(savedLvl))];
    }
    var shapes = lsJSON('sml-pulse-shapes', null); if (!Array.isArray(shapes)) shapes = cfg.shapes.slice();
    var fxList = lsJSON('sml-screen-fx-list', null); if (!Array.isArray(fxList)) fxList = cfg.fx.slice();
    var texture = lsGet('sml-card-texture', cfg.texture); if (!TEX[texture]) texture = 'Glass';
    var sectionOrder = lsJSON('sml-section-order', null);
    if (!Array.isArray(sectionOrder) || sectionOrder.length !== 4) sectionOrder = ['stats', 'tickers', 'orbitals', 'about'];
    var itemScales = lsJSON('sml-orbital-item-scales', null);
    if (!itemScales || !itemScales.photo || !itemScales.video) itemScales = { photo: [1, 1, 1, 1, 1, 1], video: [1, 1, 1] };
    var photoSize = parseInt(lsGet('sml-orbital-photo-size', ''), 10); if (isNaN(photoSize)) photoSize = null;
    var videoSize = parseInt(lsGet('sml-orbital-video-size', ''), 10); if (isNaN(videoSize)) videoSize = null;
    var contactOptIn = lsGet('sml-contact-optin', (cfg.contact && cfg.contact.optIn === false) ? '0' : '1') !== '0';
    var beatSens = parseFloat(lsGet('sml-beat-sens', cfg.beatSensitivity));
    if (!(beatSens >= 0.5 && beatSens <= 2)) beatSens = (cfg.beatSensitivity >= 0.5 && cfg.beatSensitivity <= 2) ? cfg.beatSensitivity : 1;
    var reactiveComponents = lsJSON('sml-immersive-components', null);
    var allReactiveComponents = ['background', 'banner', 'avatar', 'cards', 'orbital_photos', 'orbital_videos'];
    if (!Array.isArray(reactiveComponents)) reactiveComponents = allReactiveComponents.slice();
    function reacts(key) { return reactiveComponents.indexOf(key) >= 0; }
    window.addEventListener('sml-immersive-components', function (event) {
      if (event && Array.isArray(event.detail)) reactiveComponents = event.detail.slice();
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
    var playing = false, lastTime = 0, lastStamp = 0, duration = 0, registered = false, lastBeat = -1;
    var BPM = (cfg.bpm >= 50 && cfg.bpm <= 220) ? cfg.bpm : 120;
    var wavePeaks = (function () { var a = []; for (var i = 0; i < 160; i++) a.push(0.12 + Math.abs(Math.sin(i * 0.7) * 0.5) + Math.random() * 0.28); var mx = Math.max.apply(null, a); return a.map(function (v) { return v / mx; }); })();
    function isYT(o) { return /(^|\.)youtube(-nocookie)?\.com$/.test(String(o).replace(/^https?:\/\//, '')); }
    function cmd(func, args) { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*'); } catch (e) {} }
    function register() { if (registered || !frame || !frame.contentWindow) return; try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 8, channel: 'widget' }), '*'); registered = true; } catch (e) {} }
    window.addEventListener('message', function (ev) {
      if (!frame || !isYT(ev.origin)) return;
      var d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
      if (!d || !d.info) return;
      if (d.event !== 'infoDelivery' && d.event !== 'initialDelivery') return;
      if (typeof d.info.playerState === 'number') playing = (d.info.playerState === 1);
      if (typeof d.info.currentTime === 'number') { lastTime = d.info.currentTime; lastStamp = performance.now(); }
      if (typeof d.info.duration === 'number' && d.info.duration) duration = d.info.duration;
    }, false);
    function nowTime() { return playing ? lastTime + (performance.now() - lastStamp) / 1000 : lastTime; }
    function easeBeat(p) { return p < 0.12 ? (p / 0.12) : Math.pow(1 - (p - 0.12) / 0.88, 2.2); }
    function mult() { return MULTS[level] || 0; }

    function startPlayback(unmute) {
      if (!frame) { overlay.style.display = 'none'; return; }
      register();
      setTimeout(function () { cmd('mute'); cmd('playVideo'); if (unmute) { cmd('unMute'); cmd('setVolume', [60]); } }, 250);
      overlay.style.display = 'none';
      playBtn.textContent = '❚❚';
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
    function goScreen(i) { screen = (i + 5) % 5; syncChips(); }
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
    function applyEditUI() {
      editBadge.hidden = !editMode;
      $$('[data-editonly]').forEach(function (el) { el.hidden = !editMode; });
      $$('.sip-sec').forEach(function (s) { s.classList.toggle('edit', editMode); s.setAttribute('draggable', editMode ? 'true' : 'false'); });
      var et = $('.sip-edit-toggle'); if (et) et.textContent = editMode ? 'Done' : 'Arrange';
      var pin = $('.sip-psize'), vin = $('.sip-vsize');
      if (pin) pin.value = orbSize('photo'); if (vin) vin.value = orbSize('video');
      var ob = $('.sip-optin'); if (ob) ob.textContent = contactOptIn ? 'Hide my contact info' : 'Show my contact info';
    }
    $('.sip-edit-toggle').addEventListener('click', function () { editMode = !editMode; if (!editMode) enlarged = null; applyEditUI(); });

    // section drag-reorder
    var dragKey = null;
    function applyOrder() { $$('.sip-sec').forEach(function (s) { s.style.order = sectionOrder.indexOf(s.dataset.sec); }); }
    $$('.sip-sec').forEach(function (s) {
      s.addEventListener('dragstart', function () { if (editMode) dragKey = s.dataset.sec; });
      s.addEventListener('dragover', function (e) { if (editMode) e.preventDefault(); });
      s.addEventListener('drop', function (e) {
        e.preventDefault(); var from = dragKey, to = s.dataset.sec; dragKey = null;
        if (!from || from === to) return;
        var o = sectionOrder.filter(function (k) { return k !== from; });
        o.splice(o.indexOf(to), 0, from); sectionOrder = o;
        lsSet('sml-section-order', JSON.stringify(o)); applyOrder();
      });
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
    $$('[data-ozoom]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var i = +b.dataset.ozoom; enlarged = (enlarged && enlarged.ring === 'photo' && enlarged.i === i) ? null : { ring: 'photo', i: i }; }); });

    // media pickers
    function pickFile(kind, idx) { pickKind = kind; pickIdx = idx; (kind === 'gphoto' ? imgInput : vidInput).click(); }
    vidInput.addEventListener('change', function () {
      var f = vidInput.files && vidInput.files[0]; if (!f) return; var url = URL.createObjectURL(f);
      if (pickKind === 'ovideo') { videos[pickIdx] = url; renderOrbVideo(pickIdx); }
      else if (pickKind === 'gvideo') { gvids[pickIdx] = url; renderGalVideo(pickIdx); }
      vidInput.value = '';
    });
    imgInput.addEventListener('change', function () {
      var f = imgInput.files && imgInput.files[0]; if (!f) return; var url = URL.createObjectURL(f);
      gphotoLocal[pickIdx] = url; var el = $('[data-gphoto="' + pickIdx + '"]');
      if (el) { el.style.backgroundImage = "url('" + url + "')"; el.innerHTML = ''; }
      imgInput.value = '';
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
    $$('[data-gvideo]').forEach(function (cell) { cell.addEventListener('click', function () { var i = +cell.dataset.gvideo; if (editMode && !gvids[i]) pickFile('gvideo', i); }); });
    $$('[data-gphoto]').forEach(function (cell) { cell.addEventListener('click', function () { var i = +cell.dataset.gphoto; if (editMode) pickFile('gphoto', i); }); });

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
      if (playing) { cmd('pauseVideo'); playBtn.textContent = '▶'; }
      else { startPlayback(true); }
    });
    wfWrap.addEventListener('click', function (e) { if (!duration) return; var r = wfWrap.getBoundingClientRect(); cmd('seekTo', [duration * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), true]); });
    overlay.addEventListener('click', function () { startPlayback(true); });

    root.style.setProperty('--card-bg', TEX[texture]);
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
    function drawShape(x, t, r) {
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
    }
    function mk(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f()); return a; }

    var orbAngle = 0, angV = 0;
    function tick() {
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

      var bars = eq.children;
      for (var i = 0; i < bars.length; i++) { var v = active ? easeBeat(((beats + (i * 0.37)) % 1 + 1) % 1) * m : 0.02; bars[i].style.height = (3 + v * 32) + 'px'; bars[i].style.opacity = (0.35 + v * 0.6).toFixed(2); }

      // orbital rings
      var spin = 0.12 + mid * m * 1.3 + kick * m * 1.1;
      var ease = function (ang, rot) { var diff = ((((-rot) - ang) % 360) + 540) % 360 - 180; return ang + diff * 0.14; };
      if (enlarged && enlarged.ring === 'photo') orbAngle = ease(orbAngle, enlarged.i * 60); else orbAngle += spin;
      if (enlarged && enlarged.ring === 'video') angV = ease(angV, enlarged.i * 120); else angV -= spin * 0.8;
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
      var tries = 0; var iv = setInterval(function () { register(); if (++tries > 40 || registered) clearInterval(iv); }, 250);
      if (!cfg.useExistingPlayer) frame.addEventListener('load', function () { register(); setTimeout(function () { cmd('mute'); cmd('playVideo'); }, 600); });
    } else {
      overlay.querySelector('.sip-overlay-s').textContent = 'No profile music configured yet.';
    }
    requestAnimationFrame(tick);
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
    return {
      useExistingPlayer: true,
      name: name || 'Profile',
      handle: handle,
      avatarUrl: (av && av.src) || '',
      bannerUrl: (bn && bn.src) || '',
      editUrl: '/customize-profile/',
      visitorUrl: location.pathname,
      pulse: 'Immersive'
    };
  }
  function enableOverlay(mount) {
    mount.style.cssText = 'position:fixed;inset:0;z-index:2147483000;overflow:auto;-webkit-overflow-scrolling:touch;background:#070d14;';
    try { document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; } catch (e) {}
  }
  function boot() {
    var isProfile = !!(document.body && document.body.classList.contains('sml-public-profile-page'));
    // Footer-safe: this may load site-wide, but only takes over real profile pages
    // (or anywhere an explicit window.SML_PROFILE is provided).
    if (!window.SML_PROFILE && !isProfile) return;
    if (document.getElementById('sml-immersive-profile-root') && document.querySelector('.sip-root')) return; // already mounted
    if (!window.SML_PROFILE && isProfile) window.SML_PROFILE = autoConfig();
    var mount = document.getElementById('sml-immersive-profile-root');
    if (!mount) { mount = document.createElement('div'); mount.id = 'sml-immersive-profile-root'; document.body.appendChild(mount); }
    if (isProfile || (window.SML_PROFILE && window.SML_PROFILE.overlay)) enableOverlay(mount);
    init(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
