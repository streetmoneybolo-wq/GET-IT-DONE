/*!
 * SML Home Feed — full "Home Feed new" layout over the REAL feed.
 * Builds the complete 3-column shell (header, symbols tape, left profile/nav/
 * watchlist rail, center stories+composer+tabs+LIVE hero + the real feed, right
 * market-snapshot terminal + groups + creator rail) and MOVES the existing
 * #sml-optimized-home (real posts + sml-hfe engagement) into the center column —
 * nothing deleted, no 5th feed. Market numbers render as "—" (symbols only, no
 * fabricated prices) until a real quote source is wired. Self-gates on the feed host.
 */
(function () {
  'use strict';
  var GREEN = '#38F58A';

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  // ---- live quotes (moomoo OpenD bridge -> Render /api/quotes) ----
  // Stays on "—" until the bridge is up; never fabricates a number.
  var QUOTES_URL='https://stockmarketloop-loop-kick.onrender.com/api/quotes', Q={}, qTimer=null, SYMS=[];
  function fmtP(v){return v==null?'—':'$'+(Math.abs(Number(v))>=1000?Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):Number(v).toFixed(2));}
  function fmtPct(v){return v==null?'—':(v>=0?'▲ +':'▼ ')+Number(v).toFixed(2)+'%';}
  function fmtChg(v){return v==null?'—':(v>=0?'+':'')+Number(v).toFixed(2);}
  function fmtVol(v){if(v==null)return'—';v=Number(v);return v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(v);}
  function qColor(v){return v==null?'#6B7C90':(v>=0?'#38F58A':'#F2495C');}
  function applyQuotes(){ document.querySelectorAll('#sml-hf-shell [data-q]').forEach(function(el){ var d=Q[el.getAttribute('data-q')]; if(!d)return; var f=el.getAttribute('data-qf'), v=d[f]; if(f==='last'){el.textContent=fmtP(v);el.style.color=v==null?'#6B7C90':'#CFDAE4';} else if(f==='pct'){el.textContent=fmtPct(v);el.style.color=qColor(v);} else if(f==='chg'){el.textContent=fmtChg(v);el.style.color=qColor(v);} else if(f==='vol'){el.textContent=fmtVol(v);el.style.color=v==null?'#6B7C90':'#CFDAE4';} else if(f==='t'){el.textContent=v?String(v).slice(-8):'—';} }); }
  function pollQuotes(){ var u=QUOTES_URL+(SYMS.length?('?symbols='+encodeURIComponent(SYMS.join(','))):''); fetch(u,{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){ if(d&&d.quotes){Q=d.quotes;applyQuotes();} }).catch(function(){}); }

  function boot() {
    var host = document.getElementById('sml-optimized-home');
    if (!host || document.getElementById('sml-hf-shell')) return;

    if (!document.getElementById('sml-hf-fonts')) {
      var lk = document.createElement('link'); lk.id='sml-hf-fonts'; lk.rel='stylesheet';
      lk.href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
      document.head.appendChild(lk);
    }
    if (!document.getElementById('sml-hf-css')) {
      var st=document.createElement('style'); st.id='sml-hf-css';
      st.textContent =
        '#sml-hf-shell{position:fixed;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;z-index:2147483001;background:radial-gradient(1200px 520px at 50% -170px,rgba(1,167,125,.20) 0%,rgba(11,19,31,0) 60%),radial-gradient(900px 620px at 105% -60px,rgba(56,245,138,.07),transparent 62%),linear-gradient(180deg,#0D1622 0%,#080D15 70%);color:#E6EDF5;font-family:"Inter",system-ui,sans-serif;}' +
        '#sml-hf-shell *{box-sizing:border-box;}' +
        '#sml-hf-shell button{font-family:inherit;}' +
        // Un-fix the real feed and let it flow inside the center column.
        '#sml-hf-shell #sml-optimized-home{position:static !important;inset:auto !important;z-index:auto !important;height:auto !important;min-height:0 !important;width:auto !important;overflow:visible !important;background:transparent !important;display:block !important;}' +
        // The real feed is itself a full app (own header + nav/watchlist/groups rails).
        // Hide its chrome so only its real POSTS flow inside our shell's center column.
        '#sml-optimized-home .oh-top{display:none !important;}' +
        '#sml-optimized-home .oh-grid{display:block !important;grid-template-columns:none !important;}' +
        '#sml-optimized-home .oh-grid .oh-left,#sml-optimized-home .oh-grid .oh-right{display:none !important;}' +
        '#sml-optimized-home .oh-grid > main{width:auto !important;max-width:none !important;margin:0 !important;}' +
        // Re-dress the real cards to match the design.
        '#sml-optimized-home .oh-post{position:relative;background:linear-gradient(168deg,#1B2532 0%,#121A26 44%,#0B111A 100%);border:1px solid rgba(255,255,255,.07);border-top-color:rgba(255,255,255,.19);border-radius:18px;padding:20px 22px;margin:0 0 16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -2px 0 rgba(0,0,0,.6),0 2px 3px rgba(0,0,0,.45),0 18px 32px -14px rgba(0,0,0,.8),0 44px 70px -38px rgba(0,0,0,.95);transition:transform .2s cubic-bezier(.2,.7,.3,1),border-color .2s,box-shadow .2s;}' +
        '#sml-optimized-home .oh-post:hover{transform:translateY(-4px);border-color:rgba(56,245,138,.32);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 4px 6px rgba(0,0,0,.5),0 30px 52px -18px rgba(0,0,0,.9),0 0 60px -22px rgba(56,245,138,.45);}' +
        '#sml-optimized-home .oh-post-author{display:flex !important;align-items:center;gap:10px;margin-bottom:6px;text-decoration:none;}' +
        '#sml-optimized-home .oh-post-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:none;box-shadow:0 0 0 2px #131C28,0 0 0 3.5px rgba(34,224,122,.85);}' +
        '#sml-optimized-home .oh-post-author-name{font-weight:600;font-size:13.5px;color:#E6EDF5;}' +
        '#sml-optimized-home .oh-meta{font-family:"IBM Plex Mono",monospace;font-size:10px;color:#6B7C90;margin-bottom:10px;}' +
        '#sml-optimized-home .oh-post h2{font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:19px;line-height:1.25;letter-spacing:-.2px;margin:2px 0 7px;}' +
        '#sml-optimized-home .oh-post h2 a{color:#E6EDF5;text-decoration:none;}#sml-optimized-home .oh-post h2 a:hover{color:#38F58A;}' +
        '#sml-optimized-home .oh-post>p{font-size:13.5px;color:#93A4B8;line-height:1.6;margin:0 0 14px;}' +
        '#sml-optimized-home .sml-hfe-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;border:1px solid rgba(255,255,255,.09);border-top-color:rgba(255,255,255,.2);background:linear-gradient(180deg,#1C2734,#111926);color:#93A4B8;font-size:12px;font-weight:600;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 3px 8px -3px rgba(0,0,0,.7);transition:transform .12s,color .15s,border-color .15s;}' +
        '#sml-optimized-home .sml-hfe-btn:hover{border-color:rgba(56,245,138,.55);color:#E6EDF5;}' +
        '#sml-optimized-home .sml-sth-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;}' +
        // Responsive: collapse rails on narrow screens.
        '@media(max-width:1080px){#sml-hf-grid{grid-template-columns:1fr !important;}#sml-hf-left,#sml-hf-right{display:none !important;}}' +
        '@keyframes smlHfTape{from{transform:translateX(0)}to{transform:translateX(-50%)}}' +
        '@keyframes smlHfGlow{0%,100%{opacity:.5}50%{opacity:1}}' +
        '@media(prefers-reduced-motion:reduce){#sml-hf-shell .tape-row{animation:none}}';
      document.head.appendChild(st);
    }

    // ---- data (symbols from the feed's own $tags; NO fabricated prices) ----
    var syms = [];
    try { (host.innerText.match(/\$[A-Z]{1,5}\b/g)||[]).forEach(function(s){s=s.replace('$','');if(syms.indexOf(s)<0)syms.push(s);}); } catch(e){}
    if (syms.length < 6) syms = syms.concat(['SPY','QQQ','NVDA','AAPL','TSLA','MSFT','AMD','META','AMZN','SCKT','ILLR','MRAM']).filter(function(v,i,a){return a.indexOf(v)===i;});
    SYMS = syms.slice(); // symbols the modules render -> ask the quotes API for exactly these
    // profile identity from the page
    var meName = 'You', meInit = 'You';
    try { var og=(document.querySelector('meta[property="og:title"]')||{}).content||''; var au=host.querySelector('.oh-post-author-name'); meName = (au&&au.textContent.trim()) || og.split(/\s*[|—(]/)[0].trim() || 'You'; meInit = meName.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); } catch(e){}
    // Current viewer's real avatar, stamped server-side by the CDN-loader snippet.
    var meAvatar = null;
    try { if (window.SML_ME) { if (SML_ME.name) { meName = String(SML_ME.name); meInit = meName.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); } if (SML_ME.avatar) meAvatar = String(SML_ME.avatar); } } catch(e){}
    var authors = [];
    try { host.querySelectorAll('.oh-post-author-name').forEach(function(n){var t=n.textContent.trim(); if(t&&authors.indexOf(t)<0)authors.push(t);}); } catch(e){}
    while (authors.length < 6) authors.push(['Loop Desk','Momentum','Small Caps','Options Flow','Chart Room','Swing Trades'][authors.length]);

    var CARD = 'background:linear-gradient(168deg,#1A2431 0%,#121A26 45%,#0C121C 100%);border:1px solid rgba(255,255,255,.07);border-top-color:rgba(255,255,255,.18);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 14px 28px -12px rgba(0,0,0,.75),0 34px 60px -30px rgba(0,0,0,.9);';
    var GBTN = 'border:1px solid rgba(20,170,90,.9);background:linear-gradient(180deg,#6BFFB0 0%,#38F58A 46%,#17BC64 100%);color:#03120A;font-weight:700;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),inset 0 -2px 0 rgba(0,0,0,.28),0 6px 14px -5px rgba(56,245,138,.5),0 2px 3px rgba(0,0,0,.55);';
    var initialsOf = function(n){return n.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase();};
    // Viewer avatar: real profile pic if we have it (window.SML_ME.avatar), else initials.
    function avatarHTML(size, ring, rw){ ring = ring||'rgba(34,224,122,.85)'; rw = rw||3.5; var sh='0 0 0 2px #0B131F,0 0 0 '+rw+'px '+ring; if (meAvatar) return '<img src="'+esc(meAvatar)+'" alt="'+esc(meName)+'" referrerpolicy="no-referrer" style="width:'+size+'px;height:'+size+'px;border-radius:50%;object-fit:cover;flex:none;box-shadow:'+sh+'">'; return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:linear-gradient(160deg,#24323F,#0E1620);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:'+Math.round(size*0.37)+'px;color:#38F58A;flex:none;box-shadow:'+sh+'">'+esc(meInit)+'</div>'; }

    function tapeCells(){ return syms.map(function(s){return '<span style="display:inline-flex;align-items:center;gap:8px;padding:0 20px;font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;white-space:nowrap;border-right:1px solid rgba(255,255,255,.06)"><span style="color:#CFDAE4;font-weight:600">$'+esc(s)+'</span><span data-q="'+esc(s)+'" data-qf="last" style="color:#6B7C90">—</span><span data-q="'+esc(s)+'" data-qf="pct" style="color:#6B7C90;font-weight:600">—</span></span>';}).join(''); }
    var NAV = [['🏠','Home'],['📈','Markets'],['🎥','Watch'],['✉️','Letters'],['👥','Groups']];
    function navItems(){ return NAV.map(function(n,i){var on=i===0;return '<div style="display:flex;align-items:center;gap:11px;padding:10px 14px;border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:500;color:'+(on?'#E6EDF5':'#93A4B8')+';background:'+(on?'linear-gradient(180deg,#1B2634,#121A26)':'transparent')+';">'+'<span style="font-size:15px;width:18px;text-align:center">'+n[0]+'</span>'+n[1]+'</div>';}).join(''); }
    function watchRows(){ return syms.slice(0,6).map(function(s){return '<div style="display:flex;align-items:center;gap:8px;font-family:\'IBM Plex Mono\',monospace;font-size:12px;cursor:pointer"><span style="color:#38F58A;font-weight:600;width:56px">$'+esc(s)+'</span><span data-q="'+esc(s)+'" data-qf="last" style="color:#6B7C90;margin-left:auto">—</span><span data-q="'+esc(s)+'" data-qf="pct" style="color:#6B7C90;width:66px;text-align:right">—</span></div>';}).join(''); }
    function storyItems(){ return authors.slice(0,7).map(function(a){return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;flex:none"><div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(160deg,#26343F,#0D141D);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#38F58A;box-shadow:inset 0 2px 0 rgba(255,255,255,.22),0 0 0 2px #0B131F,0 0 0 4px rgba(34,224,122,.7)">'+esc(initialsOf(a))+'</div><span style="font-size:10px;color:#93A4B8;max-width:62px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(a)+'</span></div>';}).join(''); }
    function feedTabs(){ return ['For You','Following','Live'].map(function(t,i){var on=i===0;return '<button style="padding:8px 20px;border-radius:999px;border:1px solid '+(on?'rgba(56,245,138,.5)':'rgba(255,255,255,.1)')+';background:'+(on?'linear-gradient(180deg,rgba(56,245,138,.2),rgba(1,167,125,.06))':'linear-gradient(180deg,#1C2734,#111926)')+';color:'+(on?'#38F58A':'#93A4B8')+';font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">'+t+'</button>';}).join(''); }
    function snapRows(){ return syms.slice(0,3).map(function(s,i){return '<div style="padding:10px 13px 12px;border-top:1px solid rgba(56,245,138,.14);cursor:pointer"><div style="display:flex;align-items:center;gap:9px"><span style="width:26px;height:26px;flex:none;border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:10px;color:#38F58A;background:linear-gradient(180deg,rgba(56,245,138,.16),rgba(56,245,138,.03));border:1px solid rgba(56,245,138,.3)">'+esc(s.slice(0,2))+'</span><span style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:20px;line-height:1;letter-spacing:-.6px;color:#CFDAE4">$'+esc(s)+'</span><span data-q="'+esc(s)+'" data-qf="last" style="margin-left:auto;font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:16px;color:#6B7C90">—</span></div><div style="display:flex;gap:6px;margin-top:3px;font-size:10.5px"><span data-q="'+esc(s)+'" data-qf="pct" style="color:#6B7C90;font-weight:600">—</span><span style="color:#6B7C90;margin-left:auto;flex:none">$'+esc(s)+'</span></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(56,245,138,.14)">'+[['CHANGE','chg'],['VOLUME','vol'],['LAST','t']].map(function(m){return '<div><div style="font-family:\'IBM Plex Mono\',monospace;font-size:7.5px;letter-spacing:.12em;color:#7E93A6">'+m[0]+'</div><div data-q="'+esc(s)+'" data-qf="'+m[1]+'" style="font-size:12px;font-weight:600;color:#6B7C90">—</div></div>';}).join('')+'</div></div>';}).join(''); }
    var GROUPS=[['#22E07A','Small Caps'],['#3d8bfd','Options Flow'],['#ffb020','Swing Desk'],['#b98cff','Chart Room']];
    function groupRows(){ return GROUPS.map(function(g){return '<a href="/creator-studio/" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:11px;background:linear-gradient(180deg,#141D29,#0A1017);border:1px solid rgba(0,0,0,.5);border-top-color:rgba(255,255,255,.1);cursor:pointer;text-decoration:none;color:#E6EDF5"><span style="width:28px;height:28px;border-radius:9px;flex:none;background:'+g[0]+';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#03120A">'+esc(g[1].slice(0,2))+'</span><span style="font-size:12.5px;font-weight:500">'+esc(g[1])+'</span><span style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;color:#38F58A">open</span></a>';}).join(''); }

    // ---- build shell ----
    var shell = document.createElement('div'); shell.id='sml-hf-shell';
    shell.innerHTML =
      // header
      '<div style="position:sticky;top:0;z-index:50;background:linear-gradient(180deg,rgba(20,30,44,.92),rgba(9,15,24,.9));backdrop-filter:blur(16px) saturate(140%);border-bottom:1px solid rgba(0,0,0,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 14px 34px -14px rgba(0,0,0,.9)">' +
        '<div style="max-width:1360px;margin:0 auto;display:flex;align-items:center;gap:20px;padding:0 24px;height:60px">' +
          '<a href="/" style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:16px;letter-spacing:-.5px;color:#38F58A;text-decoration:none;white-space:nowrap">STOCKMARKETLOOP</a>' +
          '<div style="flex:1;max-width:460px;display:flex;align-items:center;gap:8px;background:linear-gradient(180deg,#080E17,#121B27);border:1px solid rgba(0,0,0,.6);border-bottom-color:rgba(255,255,255,.08);border-radius:999px;padding:8px 16px;box-shadow:inset 0 2px 5px rgba(0,0,0,.75)"><span style="color:#6B7C90;font-size:13px">⌕</span><input placeholder="Search a ticker, e.g. NVDA" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:#E6EDF5;font-size:13px"></div>' +
          '<div style="flex:1"></div>' +
          '<div style="display:flex;gap:18px;font-size:13.5px;font-weight:500;color:#93A4B8">' +
            '<a href="/" style="color:#38F58A;text-decoration:none">Feed</a><a href="/markets/" style="color:#93A4B8;text-decoration:none">Markets</a><a href="/live/" style="color:#93A4B8;text-decoration:none">Live</a><a href="/n/" style="color:#93A4B8;text-decoration:none">Letters</a>' +
          '</div>' +
          '<a href="/go-live/" style="padding:9px 20px;border-radius:999px;text-decoration:none;font-size:13px;white-space:nowrap;'+GBTN+'">Go Live</a>' +
          avatarHTML(36) +
        '</div>' +
        '<div style="border-top:1px solid rgba(0,0,0,.6);overflow:hidden;background:linear-gradient(180deg,#060A11,#0B1119)"><div class="tape-row" style="display:flex;width:max-content;animation:smlHfTape 30s linear infinite;padding:7px 0">'+tapeCells()+tapeCells()+'</div></div>' +
      '</div>' +
      // grid
      '<div id="sml-hf-grid" style="max-width:1360px;margin:0 auto;padding:24px;display:grid;grid-template-columns:250px minmax(0,1fr) 290px;gap:22px;align-items:start">' +
        // left rail
        '<div id="sml-hf-left" style="position:sticky;top:118px;display:flex;flex-direction:column;gap:16px">' +
          '<div style="'+CARD+'padding:18px"><div style="display:flex;align-items:center;gap:12px">'+avatarHTML(46,'#22E07A',4)+'<div><div style="font-weight:700;font-size:14.5px">'+esc(meName)+'</div><div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#38F58A"><span style="width:6px;height:6px;border-radius:50%;background:#38F58A"></span>Signed in</div></div></div></div>' +
          '<div style="display:flex;flex-direction:column;gap:2px">'+navItems()+'</div>' +
          '<div style="'+CARD+'padding:16px"><div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:.12em;color:#6B7C90;margin-bottom:12px">MY WATCHLIST</div><div style="display:flex;flex-direction:column;gap:10px">'+watchRows()+'</div></div>' +
        '</div>' +
        // center
        '<div style="min-width:0">' +
          '<div style="display:flex;gap:14px;margin-bottom:18px;overflow-x:auto;padding:2px">'+storyItems()+'</div>' +
          '<div style="'+CARD+'border-radius:18px;padding:16px 18px;margin-bottom:18px;display:flex;gap:12px;align-items:center">'+avatarHTML(40)+'<input placeholder="What\'s on the tape? Use $TICKER to tag…" style="flex:1;min-width:0;background:linear-gradient(180deg,#070C14,#111926);border:1px solid rgba(0,0,0,.6);border-bottom-color:rgba(255,255,255,.08);border-radius:999px;padding:11px 18px;color:#E6EDF5;font-size:13px;outline:none;box-shadow:inset 0 2px 5px rgba(0,0,0,.75)"><a href="/?compose=1" style="padding:10px 22px;border-radius:999px;text-decoration:none;font-size:13px;flex:none;'+GBTN+'">Post</a></div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:18px">'+feedTabs()+'<div style="margin-left:auto;display:flex;align-items:center;gap:6px;font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#6B7C90"><span style="width:6px;height:6px;border-radius:50%;background:#38F58A;animation:smlHfGlow 2s ease-in-out infinite"></span>live</div></div>' +
          // LIVE hero
          '<a href="/live/" style="display:block;text-decoration:none;color:inherit;position:relative;border-radius:20px;overflow:hidden;margin-bottom:20px;background:linear-gradient(155deg,#123B27 0%,#132132 46%,#0B111A 100%);border:1px solid rgba(56,245,138,.22);border-top-color:rgba(140,255,200,.42);box-shadow:inset 0 1px 0 rgba(190,255,222,.28),0 22px 40px -18px rgba(0,0,0,.85),0 0 50px -18px rgba(56,245,138,.35)"><div style="padding:22px 24px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:#F23645;color:#fff;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;letter-spacing:.08em"><span style="width:5px;height:5px;border-radius:50%;background:#fff"></span>LIVE NOW</span></div><div style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:26px;line-height:1.15;letter-spacing:-.4px;margin-bottom:8px">Market Open Desk — momentum names on watch</div><div style="font-size:13.5px;color:#93A4B8">Live with the Loop desk.</div></div></a>' +
          // real feed slot
          '<div id="sml-hf-feedslot"></div>' +
        '</div>' +
        // right rail
        '<div id="sml-hf-right" style="position:sticky;top:118px;display:flex;flex-direction:column;gap:16px">' +
          '<div style="position:relative;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#04090A,#020506);border:1.5px solid rgba(56,245,138,.5);box-shadow:inset 0 0 26px rgba(56,245,138,.1),0 0 18px -6px rgba(56,245,138,.35)"><div style="position:absolute;inset:0;pointer-events:none;opacity:.18;background:repeating-linear-gradient(90deg,rgba(56,245,138,.5) 0 1px,transparent 1px 18px),repeating-linear-gradient(0deg,rgba(56,245,138,.35) 0 1px,transparent 1px 18px);-webkit-mask-image:linear-gradient(90deg,transparent 45%,#000 100%);mask-image:linear-gradient(90deg,transparent 45%,#000 100%)"></div><div style="position:relative;padding:12px 13px 4px;font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:.2em;color:#38F58A;text-shadow:0 0 10px rgba(56,245,138,.6)">MARKET SNAPSHOT · SYMBOLS</div>'+snapRows()+'</div>' +
          '<div style="'+CARD+'padding:16px"><div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:.12em;color:#6B7C90;margin-bottom:12px">MY GROUPS</div><div style="display:flex;flex-direction:column;gap:8px">'+groupRows()+'</div></div>' +
          '<div style="background:linear-gradient(155deg,#123B27 0%,#132132 48%,#0B111A 100%);border:1px solid rgba(56,245,138,.22);border-top-color:rgba(140,255,200,.4);border-radius:18px;padding:18px;box-shadow:inset 0 1px 0 rgba(190,255,222,.26),0 20px 36px -16px rgba(0,0,0,.85),0 0 46px -20px rgba(56,245,138,.35)"><div style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:16px;margin-bottom:6px">Become a creator</div><div style="font-size:12.5px;color:#93A4B8;line-height:1.55;margin-bottom:14px">Go live, upload videos, or start your own Letter.</div><div style="display:flex;flex-direction:column;gap:8px"><a href="/go-live/" style="padding:9px 0;border-radius:999px;text-align:center;text-decoration:none;font-size:12.5px;'+GBTN+'">Go Live</a><a href="/upload-video/" style="padding:9px 0;border-radius:999px;text-align:center;text-decoration:none;font-size:12.5px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,#1D2836,#111926);color:#E6EDF5">Upload Video</a><a href="/creator-studio/loop-letters/write/" style="padding:9px 0;border-radius:999px;text-align:center;text-decoration:none;font-size:12.5px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,#1D2836,#111926);color:#E6EDF5">Start a Letter</a></div></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(shell);
    // Move the REAL feed into the center slot (preserves posts + engagement + listeners).
    var slot = shell.querySelector('#sml-hf-feedslot');
    slot.appendChild(host);
    try { document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; } catch(e){}

    // Start live-quote polling (fills tape / watchlist / snapshot; "—" while offline).
    pollQuotes(); if (qTimer) clearInterval(qTimer); qTimer = setInterval(pollQuotes, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  var tries=0, iv=setInterval(function(){ if(document.getElementById('sml-hf-shell')||++tries>40){clearInterval(iv);return;} boot(); },250);
})();
