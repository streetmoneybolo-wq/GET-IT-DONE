/* Academy member profiles (server: academy-profile-pages.js, routes /academy-activity/profiles/...).
 *
 * A full-screen page inside the Academy for any member: identity + tier, main Discord server, paper account and its
 * leaderboard rank, one song, social link cards, and a feed of their live-chat posts. The owner of a page customizes it:
 * 20 layouts, accent colours, stackable background effects, textures and lights that move to the song (it plays in the
 * Academy music dock, academy-profile-music.js: an uploaded song or a direct MP3/M4A link), font, immersive level, tagline, bio, what to show.
 * Members follow each other; follower counts show on the page and on the hover card in chat (last 3 posts, paper
 * rank, main server, Follow). Opened from the 👤 button, a name in chat, or ?popout=profile&user=<id>. */
(() => {
  if (window.__smlProfileUi) return;
  window.__smlProfileUi = 1;
  const POP = window.smlAcademyPopout || '';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const auth = (extra = {}) => ({ authorization: 'Bearer ' + token(), ...extra });
  const api = async (path, opts = {}) => { try { const r = await fetch('/academy-activity/profiles' + path, { cache: 'no-store', ...opts, headers: auth(opts.body ? { 'content-type': 'application/json' } : {}) }); const j = await r.json().catch(() => null); return j || { ok: false, error: 'http_' + r.status }; } catch (_) { return { ok: false, error: 'offline' }; } };
  const openOut = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  const selfId = () => { try { const part = token().split('.')[1] || ''; const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/')); const json = decodeURIComponent(Array.from(bin).map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')); const c = JSON.parse(json); return String(c.u || c.sub || ''); } catch (_) { return ''; } };
  const money = (v) => (Number.isFinite(v) ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
  const pct = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '–');
  const ago = (iso) => { const d = Date.now() - Date.parse(iso); if (!Number.isFinite(d)) return ''; const m = Math.round(d / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm'; const h = Math.round(m / 60); if (h < 24) return h + 'h'; return Math.round(h / 24) + 'd'; };
  const ROOMS = { global: 'Global', day: 'Day Trade', swing: 'Swing Trade', short: 'Short Sale', options: 'Options' };
  const SOCIAL_ICON = { reddit: 'r/', discord: '◉', x: '𝕏', facebook: 'f', bluesky: '🦋', threads: '@', 'loop-channel': '∞', 'loop-letter': '✉', 'loop-profile': '👤', youtube: '▶', link: '↗' };
  const LINK_KINDS = [['reddit', 'Reddit', 'https://www.reddit.com/user/you'], ['discord', 'Discord', 'https://discord.gg/your-server'], ['x', 'Twitter / X', 'https://x.com/you'], ['facebook', 'Facebook', 'https://www.facebook.com/you'], ['bluesky', 'Bluesky', 'https://bsky.app/profile/you.bsky.social'], ['threads', 'Threads', 'https://www.threads.net/@you'],
    ['loop-channel', 'StockMarketLoop.com Loop channel', 'https://stockmarketloop.com/channel/you/'], ['loop-letter', 'StockMarketLoop.com Loop Letter publication', 'https://stockmarketloop.com/n/you/'], ['loop-profile', 'StockMarketLoop.com profile page', 'https://stockmarketloop.com/members/you/'], ['youtube', 'YouTube', 'https://www.youtube.com/@you']];

  /* ---------- the 20 layouts: where each section sits on a wide screen (areas) and the look that goes with it ---------- */
  const AREAS = {
    classic: '"head head head" "stats server paper" "song social social" "feed feed feed"',
    'hero-left': '"head feed feed" "stats feed feed" "server feed feed" "paper feed feed" "song feed feed" "social feed feed"',
    magazine: '"head head head head" "song social social paper" "feed feed server stats"',
    terminal: '"head stats" "server paper" "song social" "feed feed"',
    glass: '"head head head" "song server paper" "social social stats" "feed feed feed"',
    neon: '"head head" "stats paper" "server song" "social social" "feed feed"',
    minimal: '"head" "stats" "song" "feed" "server" "paper" "social"',
    poster: '"head head head" "song song song" "social server paper" "stats feed feed"',
    ticker: '"feed feed feed" "head head head" "server paper song" "stats social social"',
    dashboard: '"head head stats stats" "server paper song social" "feed feed feed feed"',
    timeline: '"head head stats" "feed feed server" "feed feed paper" "feed feed song" "feed feed social"',
    mosaic: '"head song paper" "head social server" "feed feed stats"',
    split: '"head feed" "song feed" "server feed" "paper feed" "social feed" "stats feed"',
    polaroid: '"head head head" "song social paper" "server stats stats" "feed feed feed"',
    newspaper: '"head head head" "feed feed server" "feed feed paper" "feed feed song" "social social stats"',
    orbit: '"server head paper" "song head social" "stats feed feed"',
    stack: '"head" "song" "server" "paper" "social" "stats" "feed"',
    compact: '"head stats server" "paper song social" "feed feed feed"',
    cinema: '"head head head" "song song song" "server paper stats" "social social social" "feed feed feed"',
    gradient: '"head head" "song paper" "server social" "stats stats" "feed feed"'
  };
  const COLS = { classic: 3, 'hero-left': 3, magazine: 4, terminal: 2, glass: 3, neon: 2, minimal: 1, poster: 3, ticker: 3, dashboard: 4, timeline: 3, mosaic: 3, split: 2, polaroid: 3, newspaper: 3, orbit: 3, stack: 1, compact: 3, cinema: 3, gradient: 2 };
  const LAYOUT_FX = { classic: 'aurora', 'hero-left': 'particles', magazine: 'none', terminal: 'grid', glass: 'aurora', neon: 'stars', minimal: 'none', poster: 'waves', ticker: 'grid', dashboard: 'none', timeline: 'particles', mosaic: 'aurora', split: 'waves', polaroid: 'stars', newspaper: 'none', orbit: 'stars', stack: 'embers', compact: 'none', cinema: 'rain', gradient: 'aurora' };

  const css = document.createElement('style');
  css.textContent = '#academy-profile-view{position:fixed;inset:0;z-index:2147482500;display:none;background:#05080e;color:#e6eef2;overflow:auto;font:500 .78rem/1.45 system-ui,-apple-system,sans-serif}'
    + '#academy-profile-view.open{display:block}'
    /* the page styles every canvas with the chart's dark gradient; the effect layers must stay see-through or the front one hides the whole profile */
    + '#academy-profile-view canvas{background:none!important;border:0!important;border-radius:0!important}.pv-fx{position:fixed;inset:0;z-index:0;pointer-events:none}.pv-fx3{position:fixed;inset:0;z-index:4;pointer-events:none}'
    + '.pv-top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(5,8,14,.72);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.06)}'
    + '.pv-top b{font:800 .72rem ui-monospace,monospace;letter-spacing:.08em;color:var(--acc,#00c47d)}.pv-top .sp{flex:1}'
    + '.pv-btn{border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.04);color:#e6eef2;padding:6px 10px;font:800 .66rem system-ui,sans-serif;cursor:pointer}.pv-btn:hover{border-color:var(--acc,#00c47d);color:#fff}.pv-btn.acc{background:var(--acc,#00c47d);color:#04140d;border-color:transparent}'
    + '.pv-root{position:relative;z-index:1;max-width:1240px;margin:0 auto;padding:18px 16px 60px;display:grid;gap:14px;grid-template-columns:1fr}'
    + '@media(min-width:900px){.pv-root{grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));grid-template-areas:var(--areas)}.pv-sec.head{grid-area:head}.pv-sec.stats{grid-area:stats}.pv-sec.server{grid-area:server}.pv-sec.paper{grid-area:paper}.pv-sec.song{grid-area:song}.pv-sec.social{grid-area:social}.pv-sec.feed{grid-area:feed}}'
    + '.pv-sec{position:relative;min-width:0;border:1px solid rgba(255,255,255,.08);border-radius:var(--rad,14px);background:rgba(10,16,26,.78);padding:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden}'
    + '.pv-sec h6{margin:0 0 8px;font:800 .56rem ui-monospace,monospace;letter-spacing:.14em;color:var(--acc,#00c47d);text-transform:uppercase}'
    + '.pv-sec.hidden{display:none!important}'
    + '.pv-head{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.pv-ava{width:86px;height:86px;border-radius:50%;border:3px solid var(--acc,#00c47d);background:#17303b;object-fit:cover;flex:none;box-shadow:0 0 0 6px color-mix(in srgb,var(--acc,#00c47d) 18%,transparent)}'
    + '.pv-name{font:900 1.5rem/1.1 system-ui,sans-serif;color:#fff;letter-spacing:-.01em}.pv-tag{color:#b9c7d2;margin-top:4px}.pv-tier{display:inline-block;margin-top:6px;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--acc,#00c47d) 22%,transparent);color:var(--acc,#00c47d);font:800 .58rem ui-monospace,monospace;letter-spacing:.08em}'
    + '.pv-bio{margin-top:10px;color:#cfd9e2;white-space:pre-wrap;max-width:70ch}'
    + '.pv-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.pv-kv div{padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04)}.pv-kv span{display:block;font:800 .52rem ui-monospace,monospace;letter-spacing:.1em;color:#7f95a1}.pv-kv b{display:block;font:900 1rem system-ui,sans-serif;color:#fff;margin-top:2px}.pv-kv b.up{color:#52e6ad}.pv-kv b.dn{color:#ff778b}'
    + '.pv-song{display:flex;gap:12px;align-items:center}.pv-song .disc{width:58px;height:58px;border-radius:50%;flex:none;background:conic-gradient(from 0deg,var(--acc,#00c47d),var(--acc2,#6c8cff),var(--acc,#00c47d));position:relative;animation:pvspin 6s linear infinite paused}.pv-song.playing .disc{animation-play-state:running}.pv-song .disc:after{content:"";position:absolute;inset:40%;border-radius:50%;background:#05080e}'
    + '@keyframes pvspin{to{transform:rotate(360deg)}}.pv-song .ttl{font:800 .8rem system-ui,sans-serif;color:#fff}.pv-song .sub{color:#8fa5b1;font-size:.64rem}.pv-bars{display:flex;gap:2px;align-items:flex-end;height:22px;margin-top:4px}.pv-bars i{width:4px;height:3px;background:var(--acc,#00c47d);border-radius:2px;transition:height .08s}'
    + '.pv-links{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.pv-link{display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.03);cursor:pointer;text-align:left;color:inherit;padding:0}.pv-link:hover{border-color:var(--acc,#00c47d)}.pv-link img{width:100%;height:82px;object-fit:cover;display:block;background:#0b1424}.pv-link .ph{height:82px;display:flex;align-items:center;justify-content:center;font:900 1.6rem system-ui;color:var(--acc,#00c47d);background:linear-gradient(135deg,rgba(255,255,255,.04),rgba(255,255,255,.01))}.pv-link .t{padding:7px 9px;font:700 .66rem system-ui,sans-serif;color:#e6eef2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pv-link .t small{display:block;color:#7f95a1;font-weight:500}'
    + '.pv-feed{display:flex;flex-direction:column;gap:8px}.pv-post{padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.035);border-left:3px solid var(--acc,#00c47d)}.pv-post .m{display:flex;gap:8px;align-items:center;font:800 .54rem ui-monospace,monospace;letter-spacing:.08em;color:#7f95a1;margin-bottom:3px}.pv-post .m i{font-style:normal;color:var(--acc,#00c47d)}.pv-post p{margin:0;color:#e6eef2;white-space:pre-wrap;word-break:break-word}'
    + '.pv-empty{color:#7f95a1;font-weight:500}'
    /* the ACTIVITY module: Ticker Talk comments, Academy chat posts and the member's stockmarketloop.com activity, one tab each */
    + '.pv-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.pv-tabs button{border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.04);color:#cfd9e2;padding:5px 11px;font:800 .62rem system-ui,sans-serif;cursor:pointer}.pv-tabs button.on{border-color:var(--acc,#00c47d);color:#fff;background:color-mix(in srgb,var(--acc,#00c47d) 18%,transparent)}.pv-tabs button i{font-style:normal;opacity:.7;margin-left:3px}'
    + '.pv-acts{display:flex;gap:10px;margin-top:6px;flex-wrap:wrap}.pv-acts button{border:0;background:none;padding:0;color:var(--acc,#00c47d);font:800 .6rem ui-monospace,monospace;cursor:pointer;letter-spacing:.04em}.pv-acts button:hover{text-decoration:underline}'
    + '.pv-replybox{display:flex;gap:6px;margin-top:6px;align-items:flex-end}.pv-replybox textarea{flex:1;min-height:44px;max-height:140px;resize:vertical;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(0,0,0,.25);color:#e6eef2;padding:6px 8px;font:500 .7rem/1.4 system-ui,sans-serif}'
    + '.pv-post b.t{display:block;color:#fff;margin:2px 0;font:800 .76rem system-ui,sans-serif}.pv-post small.on{display:block;color:#8fa5b1;margin-top:3px}.pv-post small.on button{border:0;background:none;color:var(--acc,#00c47d);font:700 .62rem system-ui,sans-serif;cursor:pointer;padding:0}.pv-post .m i.sym{cursor:pointer}'
    + '.pv-site-who{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px;color:#cfd9e2}.pv-site-who button{border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.04);color:#e6eef2;padding:4px 10px;font:800 .6rem system-ui,sans-serif;cursor:pointer}.pv-site-who button:hover{border-color:var(--acc,#00c47d)}'
    + '.pv-srv{display:flex;gap:10px;align-items:center}.pv-srv .ic{width:40px;height:40px;border-radius:12px;background:#5865f2;display:flex;align-items:center;justify-content:center;font:900 1rem system-ui;color:#fff;flex:none}.pv-srv b{display:block;color:#fff;font-size:.82rem}.pv-srv small{color:#8fa5b1}'
    /* fonts */
    + '.pv-root.f-mono{font-family:ui-monospace,Menlo,Consolas,monospace}.pv-root.f-serif{font-family:Georgia,"Times New Roman",serif}.pv-root.f-serif .pv-name{font-family:Georgia,serif;font-weight:700}.pv-root.f-display .pv-name{font-size:2.2rem;letter-spacing:-.03em;text-transform:uppercase}.pv-root.f-rounded{font-family:"Segoe UI Rounded","Nunito",system-ui,sans-serif}.pv-root.f-rounded .pv-sec{border-radius:22px}'
    /* layout looks */
    + '.pv-root.pl-terminal .pv-sec{border-radius:4px;border-color:#1f3a2a;background:rgba(4,10,8,.9);font-family:ui-monospace,monospace}.pv-root.pl-terminal .pv-sec h6:before{content:"> "}'
    + '.pv-root.pl-glass .pv-sec{background:rgba(255,255,255,.06);backdrop-filter:blur(14px);border-color:rgba(255,255,255,.18)}'
    + '.pv-root.pl-neon .pv-sec{border-color:var(--acc,#00c47d);box-shadow:0 0 18px color-mix(in srgb,var(--acc,#00c47d) 35%,transparent),inset 0 0 18px color-mix(in srgb,var(--acc,#00c47d) 8%,transparent)}.pv-root.pl-neon .pv-name{text-shadow:0 0 14px var(--acc,#00c47d)}'
    + '.pv-root.pl-minimal{max-width:720px}.pv-root.pl-minimal .pv-sec{background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.08);border-radius:0;box-shadow:none;padding:12px 0}'
    + '.pv-root.pl-poster .pv-name{font-size:3.2rem;line-height:.95;text-transform:uppercase;letter-spacing:-.04em}.pv-root.pl-poster .pv-sec.head{background:linear-gradient(135deg,var(--acc,#00c47d),var(--acc2,#6c8cff));color:#04140d}.pv-root.pl-poster .pv-sec.head .pv-tag,.pv-root.pl-poster .pv-sec.head .pv-bio{color:#06251a}.pv-root.pl-poster .pv-sec.head h6,.pv-root.pl-poster .pv-sec.head .pv-tier{color:#04140d;background:rgba(0,0,0,.14)}'
    + '.pv-root.pl-ticker .pv-sec.feed{padding:8px 0}.pv-root.pl-ticker .pv-sec.feed .pv-feed{flex-direction:row;overflow-x:auto;gap:10px;padding:0 10px;scrollbar-width:thin}.pv-root.pl-ticker .pv-post{min-width:260px;max-width:320px;flex:none}'
    + '.pv-root.pl-dashboard .pv-sec{border-radius:8px;background:#0b1220}.pv-root.pl-dashboard .pv-sec h6{font-size:.62rem}'
    + '.pv-root.pl-timeline .pv-feed{position:relative;padding-left:16px}.pv-root.pl-timeline .pv-feed:before{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;background:var(--acc,#00c47d);opacity:.5}.pv-root.pl-timeline .pv-post{border-left:0;position:relative}.pv-root.pl-timeline .pv-post:before{content:"";position:absolute;left:-16px;top:12px;width:10px;height:10px;border-radius:50%;background:var(--acc,#00c47d)}'
    + '.pv-root.pl-mosaic .pv-sec{border-radius:18px}.pv-root.pl-mosaic .pv-sec.head{background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02))}'
    + '.pv-root.pl-polaroid .pv-sec{background:#f4f1ea;color:#1c1c1c;border:0;border-radius:4px;padding:14px 14px 22px;box-shadow:0 14px 30px rgba(0,0,0,.45)}.pv-root.pl-polaroid .pv-sec:nth-child(odd){transform:rotate(-1.2deg)}.pv-root.pl-polaroid .pv-sec:nth-child(even){transform:rotate(1deg)}.pv-root.pl-polaroid .pv-name,.pv-root.pl-polaroid .pv-kv b,.pv-root.pl-polaroid .pv-post p,.pv-root.pl-polaroid .pv-srv b,.pv-root.pl-polaroid .pv-song .ttl,.pv-root.pl-polaroid .pv-link .t{color:#1c1c1c}.pv-root.pl-polaroid .pv-tag,.pv-root.pl-polaroid .pv-bio{color:#444}.pv-root.pl-polaroid .pv-kv div,.pv-root.pl-polaroid .pv-post,.pv-root.pl-polaroid .pv-link{background:rgba(0,0,0,.05)}'
    + '.pv-root.pl-newspaper{font-family:Georgia,serif}.pv-root.pl-newspaper .pv-sec{background:#f7f3e8;color:#171717;border:0;border-top:3px double #171717;border-radius:0;box-shadow:none}.pv-root.pl-newspaper .pv-sec h6{color:#171717;font-family:Georgia,serif;letter-spacing:.2em}.pv-root.pl-newspaper .pv-name{font-family:Georgia,serif;font-size:2.4rem}.pv-root.pl-newspaper .pv-name,.pv-root.pl-newspaper .pv-kv b,.pv-root.pl-newspaper .pv-post p,.pv-root.pl-newspaper .pv-srv b,.pv-root.pl-newspaper .pv-song .ttl,.pv-root.pl-newspaper .pv-link .t{color:#171717}.pv-root.pl-newspaper .pv-tag,.pv-root.pl-newspaper .pv-bio,.pv-root.pl-newspaper .pv-kv span,.pv-root.pl-newspaper .pv-post .m{color:#555}.pv-root.pl-newspaper .pv-kv div,.pv-root.pl-newspaper .pv-post,.pv-root.pl-newspaper .pv-link{background:rgba(0,0,0,.04)}.pv-root.pl-newspaper .pv-feed{column-count:2;column-gap:18px;display:block}.pv-root.pl-newspaper .pv-post{break-inside:avoid;margin-bottom:8px}'
    + '.pv-root.pl-orbit .pv-sec{border-radius:50% 50% 50% 50%/30% 30% 30% 30%;text-align:center}.pv-root.pl-orbit .pv-sec.head,.pv-root.pl-orbit .pv-sec.feed{border-radius:24px;text-align:left}.pv-root.pl-orbit .pv-head{justify-content:center;text-align:center;flex-direction:column}.pv-root.pl-orbit .pv-ava{width:120px;height:120px}'
    + '.pv-root.pl-stack .pv-sec{border-radius:0;border-left:6px solid var(--acc,#00c47d)}.pv-root.pl-stack .pv-sec:nth-child(even){border-left:0;border-right:6px solid var(--acc2,#6c8cff);text-align:right}.pv-root.pl-stack .pv-sec:nth-child(even) .pv-head{flex-direction:row-reverse}'
    + '.pv-root.pl-compact{gap:8px}.pv-root.pl-compact .pv-sec{padding:9px 11px;border-radius:8px}.pv-root.pl-compact .pv-ava{width:54px;height:54px}.pv-root.pl-compact .pv-name{font-size:1.1rem}'
    + '.pv-root.pl-cinema .pv-sec.head{min-height:220px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(5,8,14,.9)),radial-gradient(circle at 20% 20%,color-mix(in srgb,var(--acc,#00c47d) 40%,transparent),transparent 60%);display:flex;align-items:flex-end}.pv-root.pl-cinema .pv-sec{border-radius:6px}.pv-root.pl-cinema .pv-name{font-size:2.6rem}'
    + '.pv-root.pl-gradient .pv-sec{border:0;background:linear-gradient(135deg,color-mix(in srgb,var(--acc,#00c47d) 28%,#0a1020),color-mix(in srgb,var(--acc2,#6c8cff) 28%,#0a1020));border-radius:26px}'
    + '.pv-root.pl-hero-left .pv-head{flex-direction:column;align-items:flex-start}.pv-root.pl-hero-left .pv-ava{width:120px;height:120px}'
    + '.pv-root.pl-magazine .pv-sec.head{min-height:180px;background:linear-gradient(120deg,color-mix(in srgb,var(--acc,#00c47d) 35%,#0a1020),#0a1020 70%)}.pv-root.pl-magazine .pv-name{font-size:2.4rem}'
    + '.pv-root.pl-split .pv-sec.feed{max-height:calc(100vh - 120px);overflow:auto}'
    /* editor */
    + '#pv-edit{position:fixed;right:0;top:0;bottom:0;z-index:2147482600;width:min(380px,100vw);background:#0a1118;border-left:1px solid #1f3a4a;box-shadow:-12px 0 40px rgba(0,0,0,.6);overflow:auto;padding:14px;display:none;color:#e6eef2;font:600 .7rem/1.4 system-ui,sans-serif}#pv-edit.open{display:block}'
    + '#pv-edit h4{margin:0 0 10px;font:900 .9rem system-ui,sans-serif;color:#fff}#pv-edit h6{margin:12px 0 6px;font:800 .56rem ui-monospace,monospace;letter-spacing:.12em;color:#8fa5b1}'
    + '#pv-edit input[type=text],#pv-edit input[type=url],#pv-edit textarea,#pv-edit select{width:100%;box-sizing:border-box;border:1px solid #23404d;border-radius:7px;background:#0c1821;color:#e6eef2;padding:7px 8px;font:600 .7rem system-ui,sans-serif}#pv-edit textarea{min-height:70px;resize:vertical}'
    + '.pv-fxbox{max-height:260px;overflow:auto;border:1px solid #1d3744;border-radius:8px;padding:6px 8px;background:#0b141c}.pv-fxg b{display:block;margin:6px 0 3px;font:800 .56rem ui-monospace,monospace;letter-spacing:.1em;color:#7ef0bd;text-transform:uppercase}.pv-fxg .pv-opts button{font-size:.62rem;padding:4px 7px}'
    + '.pv-lay{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.pv-lay button{border:1px solid #23404d;border-radius:8px;background:#0c1821;color:#cfe3ea;padding:5px 4px 4px;cursor:pointer;font:700 .52rem system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;gap:4px}.pv-lay button.on{border-color:var(--acc,#00c47d);color:#fff;background:#0e1f1a}.pv-lay .mini{width:54px;height:36px;display:grid;gap:2px;grid-template-columns:repeat(var(--c,3),1fr);grid-template-areas:var(--a)}.pv-lay .mini i{display:block;background:#2a4a58;border-radius:2px;min-height:4px}.pv-lay .mini i.h{background:var(--acc,#00c47d);grid-area:head}.pv-lay .mini i.f{grid-area:feed;background:#3a5d6e}.pv-lay .mini i.s{grid-area:song}.pv-lay .mini i.p{grid-area:paper}.pv-lay .mini i.v{grid-area:server}.pv-lay .mini i.o{grid-area:social}.pv-lay .mini i.t{grid-area:stats}'
    + '.pv-sw{display:flex;flex-wrap:wrap;gap:5px}.pv-sw button{width:24px;height:24px;border-radius:50%;border:2px solid transparent;cursor:pointer}.pv-sw button.on{border-color:#fff}.pv-opts{display:flex;flex-wrap:wrap;gap:5px}.pv-opts button{border:1px solid #23404d;border-radius:6px;background:#0c1821;color:#cfe3ea;padding:5px 8px;font:700 .62rem system-ui,sans-serif;cursor:pointer}.pv-opts button.on{border-color:var(--acc,#00c47d);color:#fff}'
    + '.pv-soc{display:flex;gap:6px;align-items:center;margin-top:5px}.pv-soc span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#cfe3ea}.pv-soc button{border:1px solid #3a2a2a;border-radius:6px;background:#1a0e0e;color:#ff9f9f;padding:3px 7px;cursor:pointer;font:800 .6rem system-ui}'
    + '.pv-row{display:flex;gap:6px;margin-top:6px}.pv-row input{flex:1}.pv-chk{display:flex;align-items:center;gap:6px;margin:5px 0;color:#cfe3ea}.pv-ft{display:flex;gap:6px;margin-top:14px;position:sticky;bottom:0;background:#0a1118;padding:8px 0}.pv-note{color:#7f95a1;font-weight:500;margin-top:6px}'
    + '.pv-wall-wrap{position:relative;z-index:1;max-width:1240px;margin:0 auto;padding:0 16px 60px}.pv-wall .pv-cmp{display:flex;gap:8px;align-items:flex-end}.pv-wall textarea{flex:1;min-height:58px;max-height:160px;resize:vertical;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.04);color:#e6eef2;padding:8px 10px;font:500 .74rem/1.4 system-ui,sans-serif}'
    + '.pv-wall .pv-cnote{margin:4px 0 10px;color:#7f95a1;font:600 .6rem ui-monospace,monospace}.pv-wall-list{display:flex;flex-direction:column;gap:8px}.pv-wc{border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(255,255,255,.03);padding:8px 10px}'
    + '.pv-wc .m{display:flex;gap:8px;align-items:center;font:700 .58rem ui-monospace,monospace;color:#86a2b0}.pv-wc .m button.who{border:0;background:none;color:var(--acc,#00c47d);font:800 .62rem system-ui,sans-serif;cursor:pointer;padding:0}.pv-wc .m .sp{flex:1}.pv-wc .m button.del{border:1px solid #3a2a2a;border-radius:6px;background:#1a0d0d;color:#ff9f9f;font:700 .56rem system-ui,sans-serif;padding:2px 6px;cursor:pointer}'
    + '.pv-wc p{margin:5px 0 0;white-space:pre-wrap;word-break:break-word;color:#e6eef2}.pv-wall .pv-more{margin-top:8px}.pv-wall .pv-empty{color:#7f95a1;font:600 .66rem system-ui,sans-serif}.pv-wall .pv-closed{color:#7f95a1;font:600 .66rem system-ui,sans-serif}'
    + '#pv-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147482700;padding:9px 14px;border:1px solid #1f8a5f;border-radius:9px;background:#071a13;color:#c9f6e2;font:700 .7rem system-ui,sans-serif;display:none;max-width:min(560px,92vw)}'
    + '#academy-profile-btn{position:fixed;right:10px;bottom:48px;z-index:2147483199;border:1px solid #2a4a58;border-radius:999px;background:#0d1a24;color:#e6eef2;padding:7px 12px;font:800 .7rem system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5)}#academy-profile-btn:hover{border-color:#00c47d;color:#7ef0bd}body.sml-mobile #academy-profile-btn{bottom:56px}'
    /* hover card section */
    + '#academy-profile-card .apc{margin:10px 12px 0;padding-top:8px;border-top:1px solid #16303e}#academy-profile-card .apc h6{margin:0 0 5px;font:800 .56rem ui-monospace,monospace;letter-spacing:.1em;color:#7ef0bd}#academy-profile-card .apc .kv{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font:600 .62rem system-ui,sans-serif;color:#cfe3ea}#academy-profile-card .apc .kv span{color:#7f95a1}#academy-profile-card .apc .p{margin:4px 0 0;padding:4px 6px;border-radius:6px;background:rgba(255,255,255,.04);font:500 .62rem system-ui,sans-serif;color:#dfe9ee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#academy-profile-card .apc .p i{font-style:normal;color:#7ef0bd;font-weight:800;margin-right:4px}#academy-profile-card .apc .btns{margin-top:6px}';
  document.head.appendChild(css);

  const view = document.createElement('div'); view.id = 'academy-profile-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-label', 'Member profile');
  const edit = document.createElement('div'); edit.id = 'pv-edit';
  const toastEl = document.createElement('div'); toastEl.id = 'pv-toast';
  let toastTm = 0; const toast = (t) => { toastEl.textContent = t; toastEl.style.display = 'block'; clearTimeout(toastTm); toastTm = setTimeout(() => { toastEl.style.display = 'none'; }, 3800); };
  document.body.appendChild(view); document.body.appendChild(edit); document.body.appendChild(toastEl);

  const S = { open: false, userId: '', data: null, draft: null, saving: false, fx: null, tab: 'talk', chatAll: false };

  /* ---------- background effects, pulsing with the song when one plays here ---------- */
  const CHN = ['kick', 'bass', 'vocal', 'snare', 'hats'];
  function pulse() {
    const lvl = { off: 0, subtle: .35, balanced: .7, immersive: 1 }[(S.data && S.data.settings.theme.immersive) || 'balanced'];
    const M = window.smlProfileMusic;
    if (M && M.active() && M.isPlaying()) {
      const raw = M.read(performance.now()), k = lvl === 0 ? 0 : 0.45 + 0.55 * lvl, ch = {};
      for (const c of CHN) ch[c] = Math.min(1, (raw[c] || 0) * k);
      return { p: Math.min(1, Math.max(ch.kick, ch.bass * .85)), ch: ch, arr: M.frequency(), live: M.mode() === 'live' };
    }
    return { p: (0.5 + 0.5 * Math.sin(Date.now() / 900)) * lvl * 0.35, ch: null, arr: null, live: false };
  }
  function startFx(modes) {
    stopFx();
    const back = view.querySelector('.pv-fx'), front = view.querySelector('.pv-fx3'), FXE = window.smlProfileFx;
    if (!back || !front || !FXE || !modes || !modes.length) return;
    const bc = back.getContext('2d'), fc = front.getContext('2d'); let w = 0, h = 0;
    const acc = (S.data && S.data.settings.theme.accent) || '#00c47d', acc2 = (S.data && S.data.settings.theme.accent2) || '#6c8cff';
    const size = () => { w = back.width = front.width = innerWidth; h = back.height = front.height = innerHeight; if (S.fxEng) S.fxEng.resize(w, h); };
    size();
    S.fxEng = FXE.make(modes, { acc: acc, acc2: acc2, w: w, h: h, mobile: innerWidth < 700 });
    const bars = () => { const b = view.querySelector('.pv-bars'); return b ? [...b.children] : []; };
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { p, arr, ch } = pulse();
      bc.clearRect(0, 0, w, h); fc.clearRect(0, 0, w, h);
      S.fxEng.draw(bc, fc, w, h, { p: p, ch: ch, arr: arr, t: now / 1000, dt: dt });
      const bs = bars(); if (bs.length) { for (let i = 0; i < bs.length; i++) { const v = arr ? arr[i * 3] / 255 : (ch ? Math.min(1, ch[CHN[i % 5]] * .9 + .08) : (0.15 + 0.1 * Math.sin(Date.now() / 300 + i))); bs[i].style.height = Math.max(3, Math.round(v * 22)) + 'px'; } }
      S.fx = requestAnimationFrame(frame);
    };
    S.fx = requestAnimationFrame(frame);
    S.fxResize = size; window.addEventListener('resize', size);
  }
  function stopFx() { if (S.fx) cancelAnimationFrame(S.fx); S.fx = null; S.fxEng = null; if (S.fxResize) window.removeEventListener('resize', S.fxResize); S.fxResize = null; }

  /* ---------- the song: plays in the Academy music dock (academy-profile-music.js), starts by itself when the page opens ---------- */
  function playable(song) { return !!(song && window.smlProfileMusic && song.kind === 'audio'); }
  function syncSong() {
    const M = window.smlProfileMusic; if (!M) return;
    const d = S.data, song = d && d.settings.song;
    if (!S.open || !d || !playable(song)) { M.unmount(); return; }
    M.mount(Object.assign({}, song, { rev: S.upRev || 0 }), { userId: d.userId, token: token(), accent: (d.settings.theme && d.settings.theme.accent) || '#00c47d', onState: (on) => { const box = view.querySelector('.pv-song'); if (box) box.classList.toggle('playing', on); }, onError: toast, slot: () => view.querySelector('.pv-slot') });
  }
  function stopAudio() { const M = window.smlProfileMusic; if (M) M.unmount(); }


  /* ---------- the Trading Wall: comments members leave on this page ---------- */
  function wallHtml(d) {
    const w = d.wall, me = selfId();
    if (!w) return d.own ? '<section class="pv-sec wall pv-wall"><h6>Trading Wall</h6><div class="pv-closed">Your Trading Wall is switched off. Turn it on under Customize → Show on my page.</div></section>' : '';
    const items = w.items || [];
    const row = (c) => '<div class="pv-wc" data-wc="' + esc(c.id) + '"><div class="m"><button type="button" class="who" data-pv="profile" data-user="' + esc(c.authorId) + '">' + esc(c.authorName || 'Member') + '</button><span>' + esc(ago(c.createdAt)) + '</span><span class="sp"></span>'
      + (d.own || c.authorId === me ? '<button type="button" class="del" data-pv="walldel" data-id="' + esc(c.id) + '">remove</button>' : '') + '</div><p>' + esc(c.body) + '</p></div>';
    return '<section class="pv-sec wall pv-wall"><h6>Trading Wall · ' + (w.count || 0) + '</h6>'
      + '<div class="pv-cmp"><textarea maxlength="500" data-wall="body" placeholder="' + esc(d.own ? 'Post on your own wall…' : 'Leave a note on this trader\'s wall…') + '"></textarea><button type="button" class="pv-btn acc" data-pv="wallpost">Post</button></div><div class="pv-cnote">Up to 500 characters. Plain text. Members see it on this page; the author, this page\'s owner and the Academy owners can remove it.</div>'
      + '<div class="pv-wall-list">' + (items.length ? items.map(row).join('') : '<div class="pv-empty">No comments yet. Be the first.</div>') + '</div>'
      + (w.more ? '<button type="button" class="pv-btn pv-more" data-pv="wallmore">Load older comments</button>' : '') + '</section>';
  }
  function paintWall() { const d = S.data, host = view.querySelector('.pv-wall-wrap'); if (d && host) host.innerHTML = wallHtml(d); }
  /* ---------- ACTIVITY: the member's last Ticker Talk comments (the comment section on every chart), their Academy chat posts, and
     their recent activity on stockmarketloop.com (posts, comments, their social feed; the site answers through the LOOP-KICK bridge for a
     member who connected their site account). Every item opens where it lives: a Ticker Talk comment opens that chart with the
     comment in view and can be replied to right here; a chat post opens that room; a site item opens the page on the site. ---------- */
  const TALK_SHOW = 7, CHAT_SHOW = 7;
  const SITE_KIND = { post: 'POST', comment: 'COMMENT', stream: 'FEED' };
  const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '\u2026' : x; };
  function talkRow(c) {
    const root = c.parentId || c.id;
    return '<div class="pv-post pv-talk" data-talk="' + esc(c.id) + '"><div class="m"><i class="sym" data-pv="talkopen" data-sym="' + esc(c.symbol) + '" data-id="' + esc(c.id) + '">$' + esc(c.symbol) + '</i><span>' + esc(ago(c.createdAt)) + '</span>' + (c.parentId ? '<span>reply</span>' : '') + (c.replyCount ? '<span>' + c.replyCount + (c.replyCount === 1 ? ' reply' : ' replies') + '</span>' : '') + (c.images ? '<span>\uD83D\uDDBC ' + c.images + '</span>' : '') + (c.links ? '<span>\uD83D\uDD17 ' + c.links + '</span>' : '') + '</div>'
      + '<p>' + esc(clip(c.body, 280)) + '</p>'
      + '<div class="pv-acts"><button type="button" data-pv="talkopen" data-sym="' + esc(c.symbol) + '" data-id="' + esc(c.id) + '">Open on the chart</button><button type="button" data-pv="talkreply" data-id="' + esc(c.id) + '">Reply</button></div>'
      + '<div class="pv-replybox" hidden><textarea maxlength="2000" placeholder="Reply on $' + esc(c.symbol) + ' Ticker Talk\u2026"></textarea><button type="button" class="pv-btn acc" data-pv="talksend" data-sym="' + esc(c.symbol) + '" data-root="' + esc(root) + '" data-id="' + esc(c.id) + '">Send</button></div></div>';
  }
  const chatRow = (p) => '<div class="pv-post"><div class="m"><i>' + esc(ROOMS[p.channel] || p.channel) + '</i><span>' + esc(ago(p.createdAt)) + '</span>' + (p.reply ? '<span>reply</span>' : '') + (p.score ? '<span>\u25B2 ' + p.score + '</span>' : '') + '</div><p>' + esc(p.body) + '</p><div class="pv-acts"><button type="button" data-pv="chatopen" data-room="' + esc(p.channel) + '">Open the room</button></div></div>';
  function siteRow(x) {
    const commentUrl = x.kind === 'post' && x.url ? x.url + '#respond' : x.kind === 'comment' && x.post && x.post.url ? x.post.url + '#respond' : '';
    return '<div class="pv-post pv-site"><div class="m"><i>' + esc(SITE_KIND[x.kind] || 'SITE') + '</i>' + (x.kind === 'post' && x.type ? '<span>' + esc(x.type) + '</span>' : '') + '<span>' + esc(ago(x.date)) + '</span>' + (x.symbol ? '<span>$' + esc(x.symbol) + '</span>' : '') + (x.likes ? '<span>\u2665 ' + x.likes + '</span>' : '') + (x.comments ? '<span>\uD83D\uDCAC ' + x.comments + '</span>' : '') + '</div>'
      + (x.title ? '<b class="t">' + esc(x.title) + '</b>' : '') + (x.text ? '<p>' + esc(clip(x.text, 240)) + '</p>' : '')
      + (x.kind === 'comment' && x.post && x.post.title ? '<small class="on">on ' + (x.post.url ? '<button type="button" data-pv="open" data-url="' + esc(x.post.url) + '">' + esc(x.post.title) + '</button>' : esc(x.post.title)) + '</small>' : '')
      + '<div class="pv-acts">' + (x.url ? '<button type="button" data-pv="open" data-url="' + esc(x.url) + '">Open on stockmarketloop.com \u2197</button>' : '') + (commentUrl ? '<button type="button" data-pv="open" data-url="' + esc(commentUrl) + '">Comment \u2197</button>' : '') + '</div></div>';
  }
  function siteHtml(d, site) {
    if (!site) return '<p class="pv-empty">' + (d.own ? 'Your stockmarketloop.com activity is not available right now.' : 'stockmarketloop.com activity is not available right now.') + '</p>';
    if (site.unavailable) return '<p class="pv-empty">stockmarketloop.com did not answer just now. It will show here on the next load.</p>';
    if (!site.linked) return '<p class="pv-empty">' + (d.own ? 'Connect your stockmarketloop.com account (LOOP-KICK \u2192 Connect) and your posts, comments and feed from the site show here.' : 'This member has not connected a stockmarketloop.com account yet.') + '</p>';
    const u = site.user || {};
    const who = '<div class="pv-site-who">' + (u.handle ? '<b>@' + esc(u.handle) + '</b>' : '') + (u.name && u.name !== u.handle ? '<span>' + esc(u.name) + '</span>' : '') + (u.profileUrl ? '<button type="button" data-pv="open" data-url="' + esc(u.profileUrl) + '">View on stockmarketloop.com \u2197</button>' : '') + '</div>';
    const items = site.items || [];
    return who + (items.length ? items.map(siteRow).join('') : '<p class="pv-empty">No posts or comments on the site yet.</p>');
  }
  function activityBody(d) {
    const s = d.settings, talk = s.flags.showTalk === false ? null : (d.talk || []), chat = s.flags.showFeed === false ? null : (d.posts || []), site = s.flags.showSite === false ? null : (d.site || null);
    const tabs = [];
    if (talk) tabs.push(['talk', 'Ticker Talk', talk.length]);
    if (chat) tabs.push(['chat', 'Academy chat', chat.length + (chat.length >= 30 ? '+' : '')]);
    if (s.flags.showSite !== false && (site || d.own)) tabs.push(['site', 'stockmarketloop.com', site && site.items ? site.items.length : 0]);
    if (!tabs.length) return '';
    if (!tabs.some((t) => t[0] === S.tab)) S.tab = tabs[0][0];
    let body = '';
    if (S.tab === 'talk') body = talk.length ? talk.slice(0, TALK_SHOW).map(talkRow).join('') : '<p class="pv-empty">No Ticker Talk comments yet. Open any chart and tap TALK.</p>';
    else if (S.tab === 'chat') body = chat.length ? (S.chatAll ? chat : chat.slice(0, CHAT_SHOW)).map(chatRow).join('') + (chat.length > CHAT_SHOW && !S.chatAll ? '<button type="button" class="pv-btn pv-more" data-pv="chatall">Show all ' + chat.length + (chat.length >= 30 ? '+' : '') + ' posts</button>' : '') : '<p class="pv-empty">No chat posts yet.</p>';
    else body = siteHtml(d, site);
    return '<div class="pv-tabs">' + tabs.map(([k, l, n]) => '<button type="button" data-ptab="' + k + '" class="' + (S.tab === k ? 'on' : '') + '">' + esc(l) + ' <i>' + esc(n) + '</i></button>').join('') + '</div><div class="pv-feed">' + body + '</div>';
  }
  /* a tab switch repaints the module's inside only: the desk scene's textures and 3D stay on the section */
  function paintActivity() { const d = S.data, host = view.querySelector('.pv-sec.feed .pv-act'); if (d && host) host.innerHTML = activityBody(d); }
  /* ---------- rendering ---------- */
  const sec = (name, title, body, hidden) => '<section class="pv-sec ' + name + (hidden ? ' hidden' : '') + '">' + (title ? '<h6>' + esc(title) + '</h6>' : '') + body + '</section>';
  function render() {
    const d = S.data; if (!d) return;
    const s = d.settings, t = s.theme || {}, acc = t.accent || '#00c47d', acc2 = t.accent2 || '#6c8cff', fx = t.fx || LAYOUT_FX[s.layout] || 'aurora';
    const name = s.displayName || d.discordName || 'Academy member';
    const ava = '/academy-activity/avatar?user=' + encodeURIComponent(d.userId) + '&t=' + encodeURIComponent(token());
    let h = '<canvas class="pv-fx"></canvas><canvas class="pv-fx3"></canvas><div class="pv-top"><b>👤 ACADEMY PROFILE</b><span class="sp"></span>'
      + (d.own ? '<button type="button" class="pv-btn acc" data-pv="edit">✎ Customize my profile</button>' : '<button type="button" class="pv-btn' + (d.viewerFollows ? '' : ' acc') + '" data-pv="follow">' + (d.viewerFollows ? '✓ Following' : '+ Follow') + '</button>')
      + (POP ? '' : '<button type="button" class="pv-btn" data-pv="popout" title="This profile in its own window">⧉</button>') + '<button type="button" class="pv-btn" data-pv="close">✕</button></div>';
    const orbit = (t.orbit || []).filter((o) => o && o.image), DESK = window.smlProfileDesk;
    const cols = COLS[s.layout] || 3, areas = (orbit.length && DESK ? '"' + Array(cols).fill('orb').join(' ') + '" ' : '') + (AREAS[s.layout] || AREAS.classic);
    h += '<div class="pv-root pl-' + esc(s.layout) + ' f-' + esc(t.font || 'system') + '" style="--acc:' + esc(acc) + ';--acc2:' + esc(acc2) + ';--areas:' + esc(areas) + ';--cols:' + cols + '">';
    h += sec('head', '', '<div class="pv-head"><img class="pv-ava" alt="" src="' + ava + '" data-ava><div><div class="pv-name">' + esc(name) + '</div>' + (s.tagline ? '<div class="pv-tag">' + esc(s.tagline) + '</div>' : '') + '<span class="pv-tier">' + esc(d.tierLabel) + '</span></div></div>' + (s.bio ? '<div class="pv-bio">' + esc(s.bio) + '</div>' : ''));
    if (orbit.length && DESK) h += sec('orb', '3D gallery', DESK.orbitHtml(orbit, token(), esc));
    h += sec('stats', 'Following', '<div class="pv-kv"><div><span>FOLLOWERS</span><b>' + (d.followers || 0) + '</b></div><div><span>FOLLOWING</span><b>' + (d.following || 0) + '</b></div><div><span>POSTS</span><b>' + (d.posts ? d.posts.length : 0) + (d.posts && d.posts.length >= 30 ? '+' : '') + '</b></div></div>', s.flags.showFollowers === false);
    h += sec('server', 'Main Discord server', d.server ? '<div class="pv-srv"><div class="ic">' + esc(String(d.server.name || 'D').slice(0, 1).toUpperCase()) + '</div><div><b>' + esc(d.server.name) + '</b><small>' + d.server.minutes + ' min in the Academy here' + (d.server.servers > 1 ? ' · ' + d.server.sharePct + '% of their time' : '') + '</small></div></div>' : '<p class="pv-empty">Shows the Discord server they use the Academy in most.</p>', s.flags.showServer === false);
    h += sec('paper', 'Paper trading account', d.paper ? '<div class="pv-kv"><div><span>ACCOUNT</span><b>' + money(d.paper.equity) + '</b></div><div><span>P&amp;L</span><b class="' + (d.paper.pnl >= 0 ? 'up' : 'dn') + '">' + money(d.paper.pnl) + '</b></div><div><span>RETURN</span><b class="' + (d.paper.returnPct >= 0 ? 'up' : 'dn') + '">' + pct(d.paper.returnPct) + '</b></div><div><span>LEADERBOARD</span><b>' + (d.paper.rank ? '#' + d.paper.rank + ' <small style="color:#7f95a1;font-size:.6rem">of ' + d.paper.of + '</small>' : 'unranked') + '</b></div></div><p class="pv-note">Simulated paper account. Not real money.</p>' : '<p class="pv-empty">No paper trades yet.</p>', s.flags.showPaper === false);
    const song = s.song;
    const canPlay = playable(song), MU = window.smlProfileMusic;
    h += sec('song', 'Song', song ? '<div class="pv-song' + (MU && MU.isPlaying() ? ' playing' : '') + '"><div class="disc"></div><div style="min-width:0;flex:1">' + (canPlay ? '' : '<div class="ttl">' + esc(song.title || 'Profile song') + '</div><div class="sub">Song unavailable</div>') + (canPlay ? '<div class="pv-bars">' + '<i></i>'.repeat(14) + '</div>' : '') + '</div></div>' + (canPlay ? '<div class="pv-slot"></div>' : '') : '<p class="pv-empty">' + (d.own ? 'Add one song in Customize.' : 'No song yet.') + '</p>', !song && !d.own);
    const socials = s.socials || [];
    h += sec('social', 'Links', socials.length ? '<div class="pv-links">' + socials.map((x) => '<button type="button" class="pv-link" data-pv="open" data-url="' + esc(x.url) + '">' + (x.card && x.card.image ? '<img alt="" loading="lazy" src="/academy-activity/profiles/link-image?u=' + encodeURIComponent(x.card.image) + '&t=' + encodeURIComponent(token()) + '">' : '<div class="ph">' + esc(SOCIAL_ICON[x.kind] || '↗') + '</div>') + '<span class="t">' + esc(x.title || (x.card && x.card.title) || x.kind) + '<small>' + esc((x.card && x.card.site) || x.kind) + '</small></span></button>').join('') + '</div>' : '<p class="pv-empty">' + (d.own ? 'Add your social links in Customize.' : 'No links yet.') + '</p>', s.flags.showSocials === false || (!socials.length && !d.own));
    const act = activityBody(d);
    h += sec('feed', 'Activity', '<div class="pv-act">' + act + '</div>', !act);
    h += '</div>';
    h += '<div class="pv-wall-wrap">' + wallHtml(d) + '</div>';
    view.innerHTML = h;
    if (window.smlProfileMusic && window.smlProfileMusic.active()) window.smlProfileMusic.dockInto(view.querySelector('.pv-slot'));
    view.style.background = '';
    view.classList.add('open');
    startFx((Array.isArray(t.fxs) && t.fxs.length ? t.fxs : [fx]).filter((x) => x && x !== 'none'));
    /* textures, desk, lighting, 3D orbs and the 3D gallery (academy-profile-desk.js) */
    if (DESK) { try { DESK.apply(view, d, pulse); } catch (_) { /* the page still works without the scene */ } }
    syncSong();
  }

  async function open(userId) {
    const id = String(userId || selfId()); if (!id) { toast('Sign in to the Academy first.'); return; }
    if (!token()) { toast('Sign in to the Academy first.'); return; }
    if (S.userId !== id) stopAudio();
    S.open = true; S.userId = id; view.classList.add('open'); view.innerHTML = '<div class="pv-top"><b>👤 ACADEMY PROFILE</b><span class="sp"></span><button type="button" class="pv-btn" data-pv="close">✕</button></div><p style="padding:30px;text-align:center;color:#7f95a1">Loading profile…</p>';
    const r = await api('/' + encodeURIComponent(id));
    if (!r.ok) { view.innerHTML = '<div class="pv-top"><b>👤 ACADEMY PROFILE</b><span class="sp"></span><button type="button" class="pv-btn" data-pv="close">✕</button></div><p style="padding:30px;text-align:center;color:#ff9f9f">' + esc(r.error === 'not_found' ? 'That member has no Academy profile yet.' : 'The profile could not be loaded right now.') + '</p>'; return; }
    S.data = r.profile; render();
  }
  function close() { S.open = false; view.classList.remove('open'); edit.classList.remove('open'); stopFx(); if (window.smlProfileDesk) window.smlProfileDesk.stop(); stopAudio(); S.draft = null; }

  /* ---------- the editor (own profile) ---------- */
  const SWATCH = ['#00c47d', '#6c8cff', '#ff9f43', '#ff6b6b', '#c46bff', '#ffe600', '#19d3f3', '#ff4fa3', '#9aa7b8', '#ffffff'];
  function openEditor() {
    if (!S.data || !S.data.own) return;
    S.draft = JSON.parse(JSON.stringify(S.data.settings)); S.draft.theme = { accent: '', accent2: '', fx: '', font: 'system', immersive: 'balanced', dark: true, ...S.draft.theme };
    const th = S.draft.theme;
    if (!Array.isArray(th.textures) || !th.textures.length) th.textures = th.texture && th.texture !== 'none' ? [th.texture] : [];
    if (!Array.isArray(th.lights) || !th.lights.length) th.lights = th.light && th.light !== 'off' ? [th.light] : [];
    if (!Array.isArray(th.fxs) || !th.fxs.length) th.fxs = th.fx && th.fx !== 'none' ? [th.fx] : (th.fx === 'none' ? [] : [LAYOUT_FX[S.draft.layout] || 'aurora']);
    th.moduleTex = th.moduleTex || {}; th.moduleReact = th.moduleReact || {};
    paintEditor(); edit.classList.add('open');
  }
  const toggleIn = (list, id, max) => { const i = list.indexOf(id); if (i >= 0) { list.splice(i, 1); return true; } if (list.length >= max) return false; list.push(id); return true; };
  /* the look and feel controls: texture, desk, lighting, 3D orbs and the 3D gallery (academy-profile-desk.js) */
  function deskControls(t) {
    const D = window.smlProfileDesk; if (!D) return '';
    const on = (cond) => (cond ? 'on' : '');
    const opts = (key, list, cur) => '<div class="pv-opts">' + list.map((x) => '<button type="button" data-' + key + '="' + esc(x.id) + '" class="' + on((cur || list[0].id) === x.id) + '">' + esc(x.label) + '</button>').join('') + '</div>';
    const picked = Array.isArray(t.textures) ? t.textures : [];
    const grid = [{ id: 'none', label: 'Plain (none)' }].concat(D.textures).map((x) => '<button type="button" data-tex="' + esc(x.id) + '" class="' + on(x.id === 'none' ? !picked.length : picked.indexOf(x.id) >= 0) + '"><span class="pd-sw ' + (x.id === 'none' ? 'none' : 'tx-' + esc(x.id)) + '"><span>' + esc(x.label) + '</span></span></button>').join('');
    const lights = Array.isArray(t.lights) ? t.lights : [], light = (D.lights || []).map((x) => '<button type="button" data-light="' + esc(x.id) + '" class="' + on(x.id === 'off' ? !lights.length : lights.indexOf(x.id) >= 0) + '">' + esc(x.label) + '</button>').join('');
    const MODN = [['head', 'Name'], ['stats', 'Followers'], ['server', 'Server'], ['paper', 'Paper acct'], ['song', 'Song'], ['social', 'Links'], ['feed', 'Posts']], RX = [['auto', 'auto'], ['off', 'none'], ['kick', 'kick'], ['bass', 'bass'], ['vocal', 'vocals'], ['snare', 'snare'], ['hats', 'hi-hats']];
    const mods = MODN.map(([k, l]) => '<div class="pd-mod"><b>' + l + '</b><select data-modtex="' + k + '"><option value="">texture: auto</option>' + D.textures.map((x) => '<option value="' + esc(x.id) + '"' + ((t.moduleTex || {})[k] === x.id ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select><select data-modrx="' + k + '">' + RX.map(([v, n]) => '<option value="' + v + '"' + (((t.moduleReact || {})[k] || 'auto') === v ? ' selected' : '') + '>moves to: ' + n + '</option>').join('') + '</select></div>').join('');
    const orbit = t.orbit || [];
    const rows = orbit.map((o, i) => '<div class="pd-orow"><div class="r"><b>' + (i + 1) + '</b><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cfe3ea" title="' + esc(o.image) + '">' + esc(o.image) + '</span><button type="button" data-orb-rm="' + i + '">remove</button></div>'
      + '<div class="r"><input type="url" data-orb="href" data-i="' + i + '" placeholder="Link this picture goes to (https://, optional)" value="' + esc(o.href || '') + '"></div><div class="r"><input type="text" data-orb="title" data-i="' + i + '" maxlength="60" placeholder="Caption (optional)" value="' + esc(o.title || '') + '"></div></div>').join('');
    return '<h6>MODULE SHAPE</h6>' + opts('shape', [{ id: '3d', label: '3D' }, { id: 'flat', label: 'Flat' }], t.modules || '3d') + '<p class="pv-note">3D: every module is an extruded card that tilts toward the pointer with a moving highlight; links spin on a ring, posts are a stack of cards you flip through, the server badge is a coin, the song is a turntable, the avatar sits on a ring of light.</p>'
      + '<h6>MODULE TEXTURES · ' + (picked.length ? picked.length + ' picked' : 'plain (or your desk dresses them)') + '</h6><p class="pv-note">Pick as many as you like (up to 6). They are handed out across your modules in turn, so a page can be legal pad, leather, marble and brushed steel all at once.</p><div class="pd-grid">' + grid + '</div>'
      + '<h6>EACH MODULE: ITS OWN TEXTURE AND WHAT IT MOVES TO</h6>' + mods + '<p class="pv-note">Every module listens to one part of the song: the kick punches, the bass lifts, vocals glow, the snare flashes, hi-hats shimmer. Leave it on auto, or point a module at the part you want.</p>'
      + '<h6>DESK</h6>' + opts('desk', D.desks, t.desk || 'none') + '<p class="pv-note">The surface your modules sit on. With a desk and a plain texture, the desk dresses each module itself: paper desk = a different sheet of paper each, NYSE floor = screens and instruments.</p>'
      + '<h6>LIGHT ON MY MODULES · ' + (lights.length ? lights.length + ' on' : 'off') + '</h6><div class="pv-opts">' + light + '</div><p class="pv-note">Turn on several lights at once.</p>'
      + '<h6>3D GALLERY (UP TO 12 PICTURES)</h6>' + rows + (orbit.length < 12 ? '<div class="pd-orow"><div class="r"><input type="url" data-orbnew="image" placeholder="Picture link (https://…)"></div><div class="r"><input type="url" data-orbnew="href" placeholder="Link it goes to (https://, optional)"></div><div class="r"><input type="text" data-orbnew="title" maxlength="60" placeholder="Caption (optional)"><button type="button" class="pv-btn acc" data-pv="addorb">Add</button></div></div>' : '')
      + '<p class="pv-note">Pictures orbit in 3D on your page; drag to spin. A picture with a link opens that page when tapped, so you can point people to your own pages.</p>';
  }
  /* the reactive screen effects (academy-profile-fx.js): every one moves to the song; stack up to 5, search by name */
  function fxControls(t) {
    const FXE = window.smlProfileFx, on = t.fxs || [];
    if (!FXE) return '';
    const chip = (e) => '<button type="button" data-fx="' + e.id + '" data-fxn="' + esc(e.label.toLowerCase()) + '" class="' + (on.indexOf(e.id) >= 0 ? 'on' : '') + '">' + esc(e.label) + '</button>';
    const light = FXE.list.filter((e) => e.group === 'Lighting'), rest = FXE.list.filter((e) => e.group !== 'Lighting'), groups = [];
    rest.forEach((e) => { let g = groups.find((x) => x.name === e.group); if (!g) { g = { name: e.group, items: [] }; groups.push(g); } g.items.push(e); });
    const label = (id) => (FXE.list.find((e) => e.id === id) || { label: id }).label;
    return '<h6>LIGHTING · STROBE, SEARCHLIGHTS, LASERS, DISCO BALL</h6><div class="pv-opts">' + light.map(chip).join('') + '</div><p class="pv-note">Realistic background lighting that moves to your song. Strobe flashes on the kick (a gentle, limited flash, and it stays off if your device asks for reduced motion).</p>'
      + '<h6>BACKGROUND EFFECTS · ' + (on.length ? on.map(label).join(', ') : 'none picked') + '</h6>'
      + '<div class="pv-row"><input type="search" data-fxq placeholder="Search effects: rain, coins, bulls, fireworks"><button type="button" class="pv-btn" data-fx="none">Clear all</button></div>'
      + '<div class="pv-fxbox">' + groups.map((g) => '<div class="pv-fxg" data-fxg><b>' + esc(g.name) + '</b><div class="pv-opts">' + g.items.map(chip).join('') + '</div></div>').join('') + '</div>'
      + '<p class="pv-note">Flying objects and weather that react to your song: the kick, bass, vocals, snare and hi-hats make them swell, speed up, burst and flash. Lighting and effects share the same 5 slots.</p>';
  }
  function paintEditor() {
    const d = S.draft, t = d.theme, lay = (S.data && S.data.layouts) || [];
    const mini = (id) => '<span class="mini" style="--a:' + esc(AREAS[id] || AREAS.classic) + ';--c:' + (COLS[id] || 3) + '"><i class="h"></i><i class="t"></i><i class="v"></i><i class="p"></i><i class="s"></i><i class="o"></i><i class="f"></i></span>';
    edit.innerHTML = '<h4>✎ Customize my profile</h4><p class="pv-note">Changes show on the page as you make them. Save keeps them on your Academy account.</p>'
      + '<h6>NAME ON THE PAGE</h6><input type="text" data-k="displayName" maxlength="40" value="' + esc(d.displayName) + '" placeholder="Your name">'
      + '<h6>TAGLINE</h6><input type="text" data-k="tagline" maxlength="90" value="' + esc(d.tagline) + '" placeholder="One line about you">'
      + '<h6>BIO</h6><textarea data-k="bio" maxlength="600" placeholder="A few lines">' + esc(d.bio) + '</textarea>'
      + '<h6>LAYOUT · ' + esc((lay.find((l) => l.id === d.layout) || {}).name || d.layout) + '</h6><div class="pv-lay">' + lay.map((l) => '<button type="button" data-layout="' + esc(l.id) + '" class="' + (l.id === d.layout ? 'on' : '') + '">' + mini(l.id) + esc(l.name) + '</button>').join('') + '</div>'
      + '<h6>ACCENT</h6><div class="pv-sw">' + SWATCH.map((c) => '<button type="button" data-accent="' + c + '" class="' + (t.accent === c ? 'on' : '') + '" style="background:' + c + '"></button>').join('') + '</div><div class="pv-row"><label style="color:#cfe3ea">Any colour <input type="color" data-color="accent" value="' + esc(t.accent || '#00c47d') + '"></label></div>'
      + '<h6>SECOND COLOUR</h6><div class="pv-sw">' + SWATCH.map((c) => '<button type="button" data-accent2="' + c + '" class="' + (t.accent2 === c ? 'on' : '') + '" style="background:' + c + '"></button>').join('') + '</div><div class="pv-row"><label style="color:#cfe3ea">Any colour <input type="color" data-color="accent2" value="' + esc(t.accent2 || '#6c8cff') + '"></label></div>'
      + fxControls(t)
      + '<h6>IMMERSIVE</h6><div class="pv-opts">' + ['off', 'subtle', 'balanced', 'immersive'].map((f) => '<button type="button" data-imm="' + f + '" class="' + (t.immersive === f ? 'on' : '') + '">' + f + '</button>').join('') + '</div><p class="pv-note">How hard the background moves with the song.</p>'
      + '<h6>FONT</h6><div class="pv-opts">' + ['system', 'mono', 'serif', 'display', 'rounded'].map((f) => '<button type="button" data-font="' + f + '" class="' + (t.font === f ? 'on' : '') + '">' + f + '</button>').join('') + '</div>'
      + deskControls(t)
      + '<h6>SONG (ONE)</h6>' + (d.song && d.song.upload ? '<div class="pv-soc"><span>🎵 Uploaded: ' + esc(d.song.title || 'My song') + '</span><button type="button" data-pv="rmsong">remove</button></div>' : '') + '<div class="pv-row"><button type="button" class="pv-btn acc" data-pv="pickaudio" style="flex:1">⬆ Upload a song from your device</button><input type="file" data-audiofile accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.opus" style="display:none"></div><p class="pv-note" data-upnote>MP3, M4A, AAC, OGG, WAV or FLAC, up to 50 MB. Use music you made or have the rights to. It plays here without any setup, and the page moves to its kick, bass, vocals, snare and hi-hats.</p><p class="pv-note">Or paste a direct link to an MP3/M4A file:</p><input type="url" data-song="url" placeholder="https://… a direct .mp3 or .m4a file" value="' + esc(d.song && !d.song.upload ? d.song.url : '') + '"><div class="pv-row"><input type="text" data-song="title" maxlength="80" placeholder="Song title" value="' + esc(d.song ? d.song.title : '') + '"></div>'
      + '<h6>LINKS</h6>' + LINK_KINDS.map(([k, label, hint]) => { const cur = (d.socials || []).find((x) => x.kind === k); return '<div class="pv-row" style="align-items:center"><span style="flex:none;width:34px;text-align:center;color:#cfe3ea" title="' + esc(label) + '">' + esc(SOCIAL_ICON[k]) + '</span><input type="url" data-link="' + k + '" value="' + esc(cur ? cur.url : '') + '" placeholder="' + esc(label + ' · ' + hint) + '"></div>'; }).join('') + '<p class="pv-note">One link of each kind. Paste the full https:// address; the kind is checked against the site.</p>'
      + '<h6>SHOW ON MY PAGE</h6>' + [['showPaper', 'Paper trading account and rank'], ['showServer', 'Main Discord server'], ['showSocials', 'Links'], ['showTalk', 'My Ticker Talk comments'], ['showFeed', 'My chat posts'], ['showSite', 'My stockmarketloop.com activity (posts, comments, feed)'], ['showFollowers', 'Follower counts'], ['showWall', 'Trading Wall (members can leave comments)']].map(([k, l]) => '<label class="pv-chk"><input type="checkbox" data-flag="' + k + '"' + (d.flags[k] === false ? '' : ' checked') + '> ' + l + '</label>').join('')
      + '<div class="pv-ft"><button type="button" class="pv-btn acc" data-pv="save">💾 Save profile</button><button type="button" class="pv-btn" data-pv="cancel">Cancel</button></div>';
  }
  const preview = () => { if (S.data && S.draft) { S.data.settings = JSON.parse(JSON.stringify(S.draft)); render(); } };
  edit.addEventListener('input', (e) => {
    const el = e.target; if (!S.draft) return;
    if (el.dataset.k) S.draft[el.dataset.k] = el.value;
    if (el.dataset.link) {
      const kind = el.dataset.link, url = String(el.value || '').trim();
      S.draft.socials = (S.draft.socials || []).filter((x) => x.kind !== kind);
      if (url) S.draft.socials.push({ url, kind, title: '', card: null });
      clearTimeout(S.pt); S.pt = setTimeout(preview, 450); return;
    }
    if (el.dataset.fxq !== undefined) { const q = el.value.trim().toLowerCase(); edit.querySelectorAll('[data-fxn]').forEach((b) => { b.style.display = !q || b.dataset.fxn.indexOf(q) >= 0 ? '' : 'none'; }); edit.querySelectorAll('[data-fxg]').forEach((g) => { g.style.display = [...g.querySelectorAll('[data-fxn]')].some((b) => b.style.display !== 'none') ? '' : 'none'; }); return; }
    if (el.dataset.song === 'url') {
      const v = el.value.trim(), isAudio = /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)(\?|#|$)/i.test(v), note = edit.querySelector('[data-upnote]');
      if (v && !isAudio) { S.draft.song = null; if (note) note.textContent = 'Only an uploaded song or a direct link to an MP3/M4A file can play here. Links to YouTube, Spotify and other sites are not supported.'; }
      else S.draft.song = v ? { url: v, title: (S.draft.song && S.draft.song.title) || '', kind: 'audio' } : null;
    }
    if (el.dataset.song === 'title' && S.draft.song) S.draft.song.title = el.value;
    if (el.dataset.orb && S.draft.theme.orbit && S.draft.theme.orbit[Number(el.dataset.i)]) { S.draft.theme.orbit[Number(el.dataset.i)][el.dataset.orb] = el.value.trim(); clearTimeout(S.pt); S.pt = setTimeout(preview, 450); return; }
    if (el.dataset.color) { S.draft.theme[el.dataset.color] = el.value; preview(); return; }
    if (el.dataset.k !== undefined || el.dataset.song !== undefined) { clearTimeout(S.pt); S.pt = setTimeout(preview, 350); }
  });
  edit.addEventListener('change', async (e) => {
    const el = e.target; if (!S.draft) return;
    if (el.dataset.flag) { S.draft.flags[el.dataset.flag] = !!el.checked; preview(); }
    else if (el.hasAttribute('data-audiofile')) {
      const f = el.files && el.files[0]; el.value = ''; if (!f) return;
      const note = edit.querySelector('[data-upnote]'), say = (t) => { if (note) note.textContent = t; };
      if (f.size > 50 * 1024 * 1024) { say('That file is ' + (f.size / 1048576).toFixed(1) + ' MB. The limit is 50 MB; export a smaller MP3 or M4A.'); return; }
      if (f.size < 1024) { say('That file looks empty.'); return; }
      say('Uploading ' + f.name + ' …');
      let r = null;
      try { const res = await fetch('/academy-activity/profiles/audio-upload?title=' + encodeURIComponent(f.name.replace(/[.][A-Za-z0-9]{2,5}$/, '').slice(0, 80)), { method: 'POST', headers: auth({ 'content-type': f.type || 'application/octet-stream' }), body: f, cache: 'no-store' }); r = await res.json().catch(() => null); if (!r) r = { ok: false, error: 'bad_response' }; } catch (_) { r = { ok: false, error: 'network' }; }
      if (!r.ok || !S.draft) { say(r.error === 'not_audio' ? 'That is not an audio file the Academy can play. Use MP3, M4A, AAC, OGG, WAV or FLAC.' : r.error === 'file_too_large' ? 'That file is over 50 MB.' : r.error === 'storage_failed' ? 'The server could not store the file just now. Wait a minute and try again.' : 'The upload did not go through. Try again.'); return; }
      S.draft.song = { url: '', title: r.song.title, kind: 'audio', upload: true };
      S.upRev = (S.upRev || 0) + 1; toast('Song uploaded. It plays on your page now.'); paintEditor(); preview();
    }
    else if (el.dataset.modtex) { const m = S.draft.theme.moduleTex = S.draft.theme.moduleTex || {}; if (el.value) m[el.dataset.modtex] = el.value; else delete m[el.dataset.modtex]; preview(); }
    else if (el.dataset.modrx) { const m = S.draft.theme.moduleReact = S.draft.theme.moduleReact || {}; if (el.value && el.value !== 'auto') m[el.dataset.modrx] = el.value; else delete m[el.dataset.modrx]; preview(); }
  });
  edit.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || !S.draft) return;
    const d = S.draft;
    if (b.dataset.layout) { d.layout = b.dataset.layout; paintEditor(); preview(); return; }
    if (b.dataset.accent) { d.theme.accent = b.dataset.accent; paintEditor(); preview(); return; }
    if (b.dataset.accent2) { d.theme.accent2 = b.dataset.accent2; paintEditor(); preview(); return; }
    if (b.dataset.fx) {
      if (b.dataset.fx === 'none') { d.theme.fxs = []; d.theme.fx = 'none'; } else { if (!toggleIn(d.theme.fxs, b.dataset.fx, 5)) toast('Up to 5 effects at once. Tap one that is on to remove it.'); d.theme.fx = d.theme.fxs[0] || 'none'; }
      paintEditor(); preview(); return;
    }
    if (b.dataset.imm) { d.theme.immersive = b.dataset.imm; paintEditor(); preview(); return; }
    if (b.dataset.font) { d.theme.font = b.dataset.font; paintEditor(); preview(); return; }
    if (b.dataset.tex) {
      if (b.dataset.tex === 'none') d.theme.textures = []; else if (!toggleIn(d.theme.textures, b.dataset.tex, 6)) toast('Up to 6 textures at once. Tap one to remove it first.');
      d.theme.texture = d.theme.textures[0] || 'none'; paintEditor(); preview(); return;
    }
    if (b.dataset.shape) { d.theme.modules = b.dataset.shape; paintEditor(); preview(); return; }
    if (b.dataset.desk) { d.theme.desk = b.dataset.desk; paintEditor(); preview(); return; }
    if (b.dataset.light) {
      if (b.dataset.light === 'off') d.theme.lights = []; else if (!toggleIn(d.theme.lights, b.dataset.light, 4)) toast('Up to 4 lights at once.');
      d.theme.light = d.theme.lights[0] || 'off'; paintEditor(); preview(); return;
    }
    if (b.dataset.orbs) { d.theme.orbs = b.dataset.orbs; paintEditor(); preview(); return; }
    if (b.dataset.orbRm !== undefined) { (d.theme.orbit || []).splice(Number(b.dataset.orbRm), 1); paintEditor(); preview(); return; }
    if (b.dataset.rm) { d.socials.splice(Number(b.dataset.rm), 1); paintEditor(); preview(); return; }
    const a = b.dataset.pv;
    if (a === 'addorb') {
      const g = (k) => { const el = edit.querySelector('[data-orbnew="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
      const image = g('image'), href = g('href'), title = g('title');
      if (!/^https:\/\//i.test(image)) { toast('Paste the picture as a full https:// link.'); return; }
      if (href && !/^https:\/\//i.test(href)) { toast('The link a picture goes to must be a full https:// link.'); return; }
      d.theme.orbit = d.theme.orbit || []; if (d.theme.orbit.length >= 12) { toast('Up to 12 pictures.'); return; }
      b.disabled = true; b.textContent = 'Checking…';
      const r = await api('/orbit-image', { method: 'POST', body: JSON.stringify({ url: image }) });
      if (!r.ok) { b.disabled = false; b.textContent = 'Add'; toast(r.error === 'not_an_image' ? 'That link is not a picture (use a direct .jpg, .png, .webp or .gif link under 1.5 MB).' : 'That picture link could not be used.'); return; }
      d.theme.orbit.push({ image: r.url, href, title }); paintEditor(); preview(); return;
    }
    if (a === 'pickaudio') { const f = edit.querySelector('[data-audiofile]'); if (f) f.click(); return; }
    if (a === 'rmsong') { d.song = null; paintEditor(); preview(); return; }
    if (a === 'cancel') { edit.classList.remove('open'); S.draft = null; await open(S.userId); return; }
    if (a === 'save') {
      if (S.saving) return; S.saving = true; b.textContent = 'Saving…';
      const r = await api('/me', { method: 'PUT', body: JSON.stringify({ displayName: d.displayName, tagline: d.tagline, bio: d.bio, layout: d.layout, theme: d.theme, song: d.song, socials: d.socials.map((x) => ({ url: x.url, kind: x.kind, title: x.title })), flags: d.flags }) });
      S.saving = false;
      if (!r.ok) { toast('Could not save: ' + (r.error || 'try again')); b.textContent = '💾 Save profile'; return; }
      edit.classList.remove('open'); S.draft = null; toast('Profile saved. Members see it on your name in chat and on your page.'); await open(S.userId);
    }
  });

  /* ---------- page buttons ---------- */
  view.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-ptab]'); if (tab) { S.tab = tab.dataset.ptab; paintActivity(); return; }
    const b = e.target.closest('[data-pv]'); if (!b) return;
    const a = b.dataset.pv;
    if (a === 'close') close();
    else if (a === 'chatall') { S.chatAll = true; paintActivity(); }
    else if (a === 'talkopen') { const sym = b.dataset.sym, id = b.dataset.id; close(); if (window.smlTickerTalk && window.smlTickerTalk.openComment) void window.smlTickerTalk.openComment(sym, id); else toast('Open the chart and tap TALK to see Ticker Talk.'); }
    else if (a === 'talkreply') { const row = b.closest('.pv-talk'), box = row && row.querySelector('.pv-replybox'); if (box) { box.hidden = !box.hidden; if (!box.hidden) { const ta = box.querySelector('textarea'); if (ta) ta.focus(); } } }
    else if (a === 'talksend') {
      const box = b.closest('.pv-replybox'), ta = box && box.querySelector('textarea'), body = ta ? String(ta.value || '').trim() : '';
      if (!body) { toast('Write your reply first.'); return; }
      b.disabled = true;
      let r = null;
      try { const res = await fetch('/academy-activity/talk/' + encodeURIComponent(b.dataset.sym), { method: 'POST', headers: auth({ 'content-type': 'application/json' }), body: JSON.stringify({ body, parentId: b.dataset.root }), cache: 'no-store' }); r = await res.json().catch(() => null); if (!r) r = { ok: false, error: 'http_' + res.status }; } catch (_) { r = { ok: false, error: 'offline' }; }
      b.disabled = false;
      if (!r.ok) { toast(r.error === 'slow_down' ? 'Easy: one comment at a time.' : r.error === 'too_many_today' ? 'You have hit the hourly limit.' : r.error === 'discord_links_not_allowed' ? 'Discord links are not allowed there.' : r.error === 'parent_not_found' ? 'That comment is gone.' : 'Could not post the reply right now.'); return; }
      if (ta) ta.value = ''; box.hidden = true;
      const c = (S.data && S.data.talk || []).find((x) => x.id === b.dataset.id); if (c && !c.parentId) c.replyCount = (c.replyCount || 0) + 1;
      paintActivity(); toast('Reply posted on $' + b.dataset.sym + ' Ticker Talk.');
    }
    else if (a === 'chatopen') { const room = b.dataset.room; close(); if (typeof window.smlAcademyChatOpen === 'function') window.smlAcademyChatOpen(room); else toast('The chat is further down the page.'); }
    else if (a === 'edit') openEditor();
    else if (a === 'play') { if (window.smlProfileMusic) window.smlProfileMusic.toggle(); }
    else if (a === 'open' && b.dataset.url) openOut(b.dataset.url);
    else if (a === 'popout') { if (typeof window.smlAcademyPopBrowser === 'function') void window.smlAcademyPopBrowser('profile', { user: S.userId }); }
    else if (a === 'profile' && b.dataset.user) { void open(b.dataset.user); }
    else if (a === 'wallpost') {
      const d = S.data; if (!d) return; const ta = view.querySelector('[data-wall="body"]'); const body = ta ? String(ta.value || '').trim() : '';
      if (!body) { toast('Write something first.'); return; }
      b.disabled = true;
      const r = await api('/' + encodeURIComponent(d.userId) + '/wall', { method: 'POST', body: JSON.stringify({ body }) });
      b.disabled = false;
      if (!r.ok) { toast(r.error === 'slow_down' ? 'Slow down: a few comments a minute.' : r.error === 'too_many_today' ? 'That is enough comments for this hour.' : r.error === 'wall_closed' ? 'This member has switched their wall off.' : 'Could not post right now.'); return; }
      d.wall = d.wall || { items: [], count: 0, more: false };
      if (!r.duplicate) { d.wall.items.unshift(r.item); d.wall.count = (d.wall.count || 0) + 1; }
      paintWall();
    }
    else if (a === 'walldel' && b.dataset.id) {
      const d = S.data; if (!d || !d.wall) return;
      const r = await api('/' + encodeURIComponent(d.userId) + '/wall/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
      if (!r.ok) { toast('Could not remove that comment.'); return; }
      d.wall.items = d.wall.items.filter((c) => c.id !== b.dataset.id); d.wall.count = Math.max(0, (d.wall.count || 1) - 1); paintWall();
    }
    else if (a === 'wallmore') {
      const d = S.data; if (!d || !d.wall || !d.wall.items.length) return;
      const last = d.wall.items[d.wall.items.length - 1];
      const r = await api('/' + encodeURIComponent(d.userId) + '/wall?before=' + encodeURIComponent(last.id));
      if (r.ok) { d.wall.items = d.wall.items.concat(r.items || []); d.wall.more = !!r.more; paintWall(); }
    }
    else if (a === 'follow') {
      const d = S.data; if (!d) return; const on = !d.viewerFollows;
      const r = await api('/' + encodeURIComponent(d.userId) + '/follow', { method: on ? 'POST' : 'DELETE' });
      if (r.ok) { d.viewerFollows = on; d.followers = r.followers; render(); toast(on ? 'Following. Their posts and alerts count toward your Academy feed.' : 'Unfollowed.'); }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) { if (edit.classList.contains('open')) { edit.classList.remove('open'); S.draft = null; void open(S.userId); } else close(); } });

  /* ---------- the hover card section in chat ---------- */
  const cardCache = new Map();
  async function hover(id, cardEl) {
    if (!id || !cardEl || !token()) return;
    let p = cardCache.get(id); if (!p) { p = api('/card?user=' + encodeURIComponent(id)); cardCache.set(id, p); setTimeout(() => cardCache.delete(id), 60_000); }
    const r = await p; if (!r.ok || !r.card || !cardEl.isConnected) return;
    if (cardEl.dataset.pvFor !== id) return;
    const c = r.card;
    const old = cardEl.querySelector('.apc'); if (old) old.remove();
    const div = document.createElement('div'); div.className = 'apc';
    div.innerHTML = '<h6>ACADEMY</h6><div class="kv"><span>Tier</span><b>' + esc(c.tierLabel) + '</b><span>Followers</span><b>' + c.followers + '</b>'
      + (c.server ? '<span>Main server</span><b>' + esc(c.server.name) + '</b>' : '') + (c.paper ? '<span>Paper rank</span><b>' + (c.paper.rank ? '#' + c.paper.rank + ' of ' + c.paper.of + (Number.isFinite(c.paper.returnPct) ? ' (' + pct(c.paper.returnPct) + ')' : '') : 'unranked') + '</b>' : '') + '</div>'
      + (c.posts && c.posts.length ? c.posts.map((x) => '<div class="p"><i>' + esc(ROOMS[x.channel] || x.channel) + '</i>' + esc(x.body) + '</div>').join('') : '<p class="note" style="margin:4px 0 0;color:#7f95a1;font-weight:500">No posts yet.</p>')
      + '<div class="btns"><button type="button" data-pv-open="' + esc(id) + '">View Academy profile</button>' + (c.own ? '' : '<button type="button" data-pv-follow="' + esc(id) + '" data-on="' + (c.viewerFollows ? '1' : '0') + '">' + (c.viewerFollows ? '✓ Following' : '+ Follow') + '</button>') + '</div>';
    const ft = cardEl.querySelector('.ft'); if (ft) cardEl.insertBefore(div, ft); else cardEl.appendChild(div);
  }
  document.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-pv-open]'); if (o) { e.preventDefault(); e.stopPropagation(); void open(o.dataset.pvOpen); const card = document.getElementById('academy-profile-card'); if (card) card.style.display = 'none'; return; }
    const f = e.target.closest('[data-pv-follow]'); if (f) {
      e.preventDefault(); e.stopPropagation(); const on = f.dataset.on !== '1';
      const r = await api('/' + encodeURIComponent(f.dataset.pvFollow) + '/follow', { method: on ? 'POST' : 'DELETE' });
      if (r.ok) { f.dataset.on = on ? '1' : '0'; f.textContent = on ? '✓ Following' : '+ Follow'; cardCache.delete(f.dataset.pvFollow); const kv = f.closest('.apc') && f.closest('.apc').querySelector('.kv'); if (kv) { const bs = kv.querySelectorAll('b'); if (bs[1]) bs[1].textContent = r.followers; } }
    }
  }, true);
  window.smlAcademyProfileHover = hover;
  window.smlAcademyProfile = { open, close, me: () => open(selfId()) };

  /* ---------- the 👤 button, presence beats, pop-out boot ---------- */
  if (!POP) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'academy-profile-btn'; btn.textContent = '👤 Profile'; btn.title = 'Your Academy profile page';
    btn.addEventListener('click', () => open(selfId()));
    document.body.appendChild(btn);
  }
  let lastBeat = 0;
  async function beat() {
    if (document.hidden || !token()) return;
    const g = String(window.smlAcademyGuildId || ''); if (!/^\d{15,25}$/.test(g)) return;
    if (Date.now() - lastBeat < 58_000) return; lastBeat = Date.now();
    try { await fetch('/academy-activity/presence', { method: 'POST', headers: auth({ 'content-type': 'application/json' }), body: JSON.stringify({ guildId: g }), cache: 'no-store' }); } catch (_) { /* next minute */ }
  }
  setInterval(beat, 60_000); window.addEventListener('sml-academy-session', () => setTimeout(beat, 3000)); document.addEventListener('visibilitychange', () => { if (!document.hidden) void beat(); });
  if (POP === 'profile') {
    const who = new URLSearchParams(location.search).get('user') || '';
    const boot = () => { if (token()) void open(who || selfId()); };
    if (token()) boot(); else window.addEventListener('sml-academy-session', boot, { once: true });
  }
})();
