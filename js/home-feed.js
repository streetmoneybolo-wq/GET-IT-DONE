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
  // Shadow-banned groups: never build them into the My Groups module.
  var SML_BANNED_SLUGS = ['the-options-plug','spy-spy-highflyers'];
  function SML_BANNED_GROUP(slug, name){ slug=String(slug||'').toLowerCase(); if(SML_BANNED_SLUGS.indexOf(slug)>=0) return true; return /options?\s*plug|spy.?spy.?highfly/i.test(String(name||'')); }

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  // ---- live quotes (moomoo OpenD bridge -> Render /api/quotes) ----
  // Stays on "—" until the bridge is up; never fabricates a number.
  var QUOTES_URL='https://stockmarketloop-loop-kick.onrender.com/api/quotes', LOGO_URL='https://stockmarketloop-loop-kick.onrender.com/api/logo/', BRAND_IMG='https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@3560eef3c519/img/loop-logo.png', AJAX_URL='/wp-admin/admin-ajax.php', Q={}, qTimer=null, SYMS=[];
  function fmtP(v){return v==null?'—':'$'+(Math.abs(Number(v))>=1000?Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):Number(v).toFixed(2));}
  function fmtPct(v){return v==null?'—':(v>=0?'▲ +':'▼ ')+Number(v).toFixed(2)+'%';}
  function fmtChg(v){return v==null?'—':(v>=0?'+':'')+Number(v).toFixed(2);}
  function fmtVol(v){if(v==null)return'—';v=Number(v);return v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(v);}
  function qColor(v){return v==null?'#6B7C90':(v>=0?'#38F58A':'#F2495C');}
  function applyQuotes(){ document.querySelectorAll('#sml-hf-shell [data-q]').forEach(function(el){ var d=Q[el.getAttribute('data-q')]; if(!d)return; var f=el.getAttribute('data-qf'), v=d[f]; if(f==='last'){el.textContent=fmtP(v);el.style.color=v==null?'#6B7C90':'#CFDAE4';} else if(f==='pct'){el.textContent=fmtPct(v);el.style.color=qColor(v);} else if(f==='chg'){el.textContent=fmtChg(v);el.style.color=qColor(v);} else if(f==='vol'){el.textContent=fmtVol(v);el.style.color=v==null?'#6B7C90':'#CFDAE4';} else if(f==='pc'){el.textContent=fmtP(v);el.style.color=v==null?'#6B7C90':'#CFDAE4';} else if(f==='t'){el.textContent=v?String(v).slice(-8):'—';} }); }
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
        // Rabbit-hole reveal: right-edge arrow on each post opens a looping mini-carousel.
        '#sml-optimized-home .oh-post{overflow:visible;}' +
        '.sml-rh-btn{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;border:1px solid rgba(56,245,138,.4);background:linear-gradient(180deg,rgba(28,39,52,.96),rgba(17,25,38,.96));color:#38F58A;font-size:17px;font-weight:700;cursor:pointer;z-index:5;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px -4px rgba(0,0,0,.8);transition:transform .15s,box-shadow .15s;padding:0;line-height:1;}' +
        '.sml-rh-btn:hover{transform:translateY(-50%) scale(1.12);box-shadow:0 0 18px -4px rgba(56,245,138,.65);}' +
        '.sml-rh-panel{position:absolute;inset:0;z-index:6;border-radius:18px;overflow:hidden;background:linear-gradient(168deg,#1B2532 0%,#121A26 44%,#0B111A 100%);border:1px solid rgba(56,245,138,.3);display:flex;flex-direction:column;opacity:0;transform:translateX(26px);pointer-events:none;transition:transform .3s cubic-bezier(.2,.8,.25,1),opacity .25s ease;}' +
        '.sml-rh-panel.on{opacity:1;transform:translateX(0);pointer-events:auto;}' +
        '.sml-rh-track{display:flex;flex:1;transition:transform .32s cubic-bezier(.2,.8,.25,1);}' +
        '.sml-rh-item{min-width:100%;padding:14px 22px;display:flex;flex-direction:column;justify-content:center;gap:7px;}' +
        '.sml-rh-item a{text-decoration:none;}' +
        '.sml-rh-nav{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,#1C2734,#111926);color:#93A4B8;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;}' +
        '.sml-rh-nav:hover{color:#38F58A;border-color:rgba(56,245,138,.5);}' +
        '@keyframes smlHfTape{from{transform:translateX(0)}to{transform:translateX(-50%)}}' +
        '@keyframes smlHfNew{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}' +
        '@keyframes smlHfGlow{0%,100%{opacity:.5}50%{opacity:1}}' +
        '@media(prefers-reduced-motion:reduce){#sml-hf-shell .tape-row{animation:none}}';
      document.head.appendChild(st);
    }

    // ---- data (symbols from the feed's own $tags; NO fabricated prices) ----
    var syms = [];
    try { (host.innerText.match(/\$[A-Z]{1,5}\b/g)||[]).forEach(function(s){s=s.replace('$','');if(syms.indexOf(s)<0)syms.push(s);}); } catch(e){}
    if (syms.length < 6) syms = syms.concat(['SPY','QQQ','NVDA','AAPL','TSLA','MSFT','AMD','META','AMZN','SCKT','ILLR','MRAM']).filter(function(v,i,a){return a.indexOf(v)===i;});
    SYMS = syms.slice(); // symbols the modules render -> ask the quotes API for exactly these
    try { (JSON.parse(localStorage.getItem('sml_hf_watchlist')||'[]')||[]).forEach(function(s){ if(SYMS.indexOf(s)<0) SYMS.push(s); }); } catch(e){}
    // profile identity from the page
    var meName = 'You', meInit = 'You';
    try { var og=(document.querySelector('meta[property="og:title"]')||{}).content||''; var au=host.querySelector('.oh-post-author-name'); meName = (au&&au.textContent.trim()) || og.split(/\s*[|—(]/)[0].trim() || 'You'; meInit = meName.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); } catch(e){}
    // Current viewer's real avatar, stamped server-side by the CDN-loader snippet.
    var meAvatar = null;
    try { if (window.SML_ME) { if (SML_ME.name) { meName = String(SML_ME.name); meInit = meName.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); } if (SML_ME.avatar) meAvatar = String(SML_ME.avatar); } } catch(e){}
    var authors = []; // [{name, img, href}] — real avatars from the feed's own post markup
    try { host.querySelectorAll('.oh-post-author').forEach(function(a){ var nm=((a.querySelector('.oh-post-author-name')||{}).textContent||'').trim(); if(!nm) return; var im=a.querySelector('img.oh-post-avatar')||a.querySelector('img'); var src=im?(im.getAttribute('data-src')||im.getAttribute('src')||''):''; var hf=a.getAttribute('href')||''; var sm=hf.match(/^(?:https?:\/\/[^\/]+)?\/([a-z0-9_\-]+)\/?$/i); if(!authors.some(function(x){return x.name===nm;})) authors.push({name:nm,img:src,href:hf,slug:sm?sm[1]:''}); }); } catch(e){}
    while (authors.length < 6) authors.push({name:['Loop Desk','Momentum','Small Caps','Options Flow','Chart Room','Swing Trades'][authors.length]||'Loop',img:'',href:'',slug:''});
    // per-user groups from the feed's own (hidden) right rail; logos merged in async from /groups/
    var myGroups = [];
    try { host.querySelectorAll('.oh-right a[href*="/groups/"]').forEach(function(a){ var hf=a.getAttribute('href')||''; var m=hf.match(/\/groups\/([a-z0-9-]+)/i); if(!m) return; var im=a.querySelector('img'); var src=im?(im.getAttribute('data-src')||im.getAttribute('src')||''):''; var nm=(a.textContent||'').replace(/\s+/g,' ').trim(); if(!nm&&im) nm=(im.getAttribute('alt')||'').replace(/\s*group logo\s*/i,'').trim(); if(!nm||nm.length>48) return; if(SML_BANNED_GROUP(m[1],nm)) return; if(!myGroups.some(function(g){return g.slug===m[1];})) myGroups.push({slug:m[1],name:nm,href:hf,img:src}); }); } catch(e){}

    var CARD = 'background:linear-gradient(168deg,#1A2431 0%,#121A26 45%,#0C121C 100%);border:1px solid rgba(255,255,255,.07);border-top-color:rgba(255,255,255,.18);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 14px 28px -12px rgba(0,0,0,.75),0 34px 60px -30px rgba(0,0,0,.9);';
    var GBTN = 'border:1px solid rgba(20,170,90,.9);background:linear-gradient(180deg,#6BFFB0 0%,#38F58A 46%,#17BC64 100%);color:#03120A;font-weight:700;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),inset 0 -2px 0 rgba(0,0,0,.28),0 6px 14px -5px rgba(56,245,138,.5),0 2px 3px rgba(0,0,0,.55);';
    var initialsOf = function(n){return n.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase();};
    // Viewer avatar: real profile pic if we have it (window.SML_ME.avatar), else initials.
    function avatarHTML(size, ring, rw){ ring = ring||'rgba(34,224,122,.85)'; rw = rw||3.5; var sh='0 0 0 2px #0B131F,0 0 0 '+rw+'px '+ring; if (meAvatar) return '<img src="'+esc(meAvatar)+'" alt="'+esc(meName)+'" referrerpolicy="no-referrer" style="width:'+size+'px;height:'+size+'px;border-radius:50%;object-fit:cover;flex:none;box-shadow:'+sh+'">'; return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:linear-gradient(160deg,#24323F,#0E1620);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:'+Math.round(size*0.37)+'px;color:#38F58A;flex:none;box-shadow:'+sh+'">'+esc(meInit)+'</div>'; }

    function tapeCells(){ return syms.map(function(s){return '<span style="display:inline-flex;align-items:center;gap:8px;padding:0 20px;font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;white-space:nowrap;border-right:1px solid rgba(255,255,255,.06)"><span style="color:#CFDAE4;font-weight:600">$'+esc(s)+'</span><span data-q="'+esc(s)+'" data-qf="last" style="color:#6B7C90">—</span><span data-q="'+esc(s)+'" data-qf="pct" style="color:#6B7C90;font-weight:600">—</span></span>';}).join(''); }
    var NAV = [['🎥','Watch','/watch/'],['✉️','Letters','/n/'],['👥','Groups','/groups/']];
    function navItems(){ return NAV.map(function(n){return '<a href="'+n[2]+'" style="display:flex;align-items:center;gap:11px;padding:10px 14px;border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:500;color:#93A4B8;text-decoration:none;background:transparent" onmouseover="this.style.background=\'linear-gradient(180deg,#1B2634,#121A26)\';this.style.color=\'#E6EDF5\'" onmouseout="this.style.background=\'transparent\';this.style.color=\'#93A4B8\'"><span style="font-size:15px;width:18px;text-align:center">'+n[0]+'</span>'+n[1]+'</a>';}).join(''); }
    // Watchlist: user-editable, saved per-browser; defaults to symbols from the feed.
    var WKEY='sml_hf_watchlist', wl=null, wEdit=false;
    try { var wraw=localStorage.getItem(WKEY); if(wraw){ wl=JSON.parse(wraw); if(!Object.prototype.toString.call(wl).match(/Array/)) wl=null; } } catch(e){}
    function watchSyms(){ return (wl&&wl.length?wl:syms.slice(0,6)); }
    function saveWl(){ try{ localStorage.setItem(WKEY,JSON.stringify(wl||[])); }catch(e){} }
    // Account sync: persist the watchlist to the logged-in user's SML account
    // (falls back to localStorage-only when logged out / no nonce).
    var WL_API='/wp-json/sml-members/v1/watchlist';
    function wlNonce(){ try{ return (window.SML_ME && window.SMLHomeFeedEngagement && SMLHomeFeedEngagement.nonce) || ''; }catch(e){ return ''; } }
    function wlSync(symbol, action){ var n=wlNonce(); if(!n) return; fetch(WL_API,{method:'POST',credentials:'same-origin',headers:{'X-WP-Nonce':n,'Content-Type':'application/json'},body:JSON.stringify({symbol:symbol,action:action})}).catch(function(){}); }
    function loadAccountWatchlist(){ var n=wlNonce(); if(!n) return; fetch(WL_API,{credentials:'same-origin',headers:{'X-WP-Nonce':n}}).then(function(r){return r.json();}).then(function(d){ if(d&&d.watchlist&&d.watchlist.length){ wl=d.watchlist.slice(0,12).map(function(s){return String(s).toUpperCase();}); saveWl(); wl.forEach(function(s){ if(SYMS.indexOf(s)<0) SYMS.push(s); }); renderWatch(); pollQuotes(); } }).catch(function(){}); }
    function watchRows(){ return watchSyms().map(function(s){return '<div style="display:flex;align-items:center;gap:8px;font-family:\'IBM Plex Mono\',monospace;font-size:12px;cursor:pointer"><span style="color:#38F58A;font-weight:600;width:56px">$'+esc(s)+'</span><span data-q="'+esc(s)+'" data-qf="last" style="color:#6B7C90;margin-left:auto">—</span><span data-q="'+esc(s)+'" data-qf="pct" style="color:#6B7C90;width:66px;text-align:right">—</span>'+(wEdit?'<button data-wdel="'+esc(s)+'" title="Remove" style="flex:none;width:20px;height:20px;border-radius:6px;border:1px solid rgba(242,73,92,.45);background:rgba(242,73,92,.12);color:#F2495C;font-size:11px;line-height:1;cursor:pointer;padding:0">✕</button>':'')+'</div>';}).join(''); }
    function renderWatch(){ var el=document.getElementById('sml-hf-watch-list'); if(el){ el.innerHTML=watchRows(); applyQuotes(); } var ab=document.getElementById('sml-hf-watch-add'); if(ab) ab.style.display=wEdit?'flex':'none'; var eb=document.getElementById('sml-hf-watch-edit'); if(eb){ eb.textContent=wEdit?'done':'edit'; eb.style.color=wEdit?'#38F58A':'#6B7C90'; eb.style.borderColor=wEdit?'rgba(56,245,138,.5)':'rgba(255,255,255,.12)'; } }
    function addTicker(){ var inp=document.getElementById('sml-hf-watch-inp'); if(!inp) return; var v=String(inp.value||'').toUpperCase().replace(/[^A-Z0-9.\-]/g,''); inp.value=''; if(!v||v.length>6) return; var cur=watchSyms().slice(); if(cur.indexOf(v)<0){ cur.unshift(v); wlSync(v,'add'); } wl=cur.slice(0,12); saveWl(); if(SYMS.indexOf(v)<0) SYMS.push(v); renderWatch(); pollQuotes(); inp.focus(); }
    function storyItems(){ return authors.slice(0,7).map(function(a){var ring='0 0 0 2px #0B131F,0 0 0 4px rgba(34,224,122,.7)'; var pres=a.slug?' data-pres="'+esc(a.slug)+'"':''; var av=a.img?'<img src="'+esc(a.img)+'" alt="'+esc(a.name)+'" loading="lazy"'+pres+' style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none;box-shadow:'+ring+'">':'<div'+pres+' style="width:56px;height:56px;border-radius:50%;background:linear-gradient(160deg,#26343F,#0D141D);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#38F58A;box-shadow:inset 0 2px 0 rgba(255,255,255,.22),'+ring+'">'+esc(initialsOf(a.name))+'</div>'; var inner=av+'<span style="font-size:10px;color:#93A4B8;max-width:62px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(a.name)+'</span>'; var st='display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;flex:none;text-decoration:none;color:inherit'; return a.href?'<a href="'+esc(a.href)+'" style="'+st+'">'+inner+'</a>':'<div style="'+st+'">'+inner+'</div>';}).join(''); }
    var curTab='foryou';
    function feedTabs(){ return [['foryou','For You'],['following','Following'],['live','Live']].map(function(t){var on=curTab===t[0];return '<button data-tab="'+t[0]+'" style="padding:8px 20px;border-radius:999px;border:1px solid '+(on?'rgba(56,245,138,.5)':'rgba(255,255,255,.1)')+';background:'+(on?'linear-gradient(180deg,rgba(56,245,138,.2),rgba(1,167,125,.06))':'linear-gradient(180deg,#1C2734,#111926)')+';color:'+(on?'#38F58A':'#93A4B8')+';font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">'+t[1]+'</button>';}).join(''); }
    function styleTabs(){ var w=document.getElementById('sml-hf-tabs'); if(!w) return; w.querySelectorAll('button[data-tab]').forEach(function(b){ var on=b.getAttribute('data-tab')===curTab; b.style.border='1px solid '+(on?'rgba(56,245,138,.5)':'rgba(255,255,255,.1)'); b.style.background=on?'linear-gradient(180deg,rgba(56,245,138,.2),rgba(1,167,125,.06))':'linear-gradient(180deg,#1C2734,#111926)'; b.style.color=on?'#38F58A':'#93A4B8'; }); }
    function snapRows(){ return syms.slice(0,3).map(function(s,i){return '<div style="padding:10px 13px 12px;border-top:1px solid rgba(56,245,138,.14);cursor:pointer"><div style="display:flex;align-items:center;gap:9px"><span style="width:26px;height:26px;flex:none;position:relative;display:block"><img src="'+LOGO_URL+esc(s)+'" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" style="width:26px;height:26px;border-radius:6px;object-fit:contain;background:rgba(255,255,255,.06);border:1px solid rgba(56,245,138,.3);display:block"><span style="display:none;position:absolute;inset:0;border-radius:6px;align-items:center;justify-content:center;font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:10px;color:#38F58A;background:linear-gradient(180deg,rgba(56,245,138,.16),rgba(56,245,138,.03));border:1px solid rgba(56,245,138,.3)">'+esc(s.slice(0,2))+'</span></span><span style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:20px;line-height:1;letter-spacing:-.6px;color:#CFDAE4">$'+esc(s)+'</span><span data-q="'+esc(s)+'" data-qf="last" style="margin-left:auto;font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:16px;color:#6B7C90">—</span></div><div style="display:flex;gap:6px;margin-top:3px;font-size:10.5px"><span data-q="'+esc(s)+'" data-qf="pct" style="color:#6B7C90;font-weight:600">—</span><span style="color:#6B7C90;margin-left:auto;flex:none">$'+esc(s)+'</span></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(56,245,138,.14)">'+[['CHANGE','chg'],['VOLUME','vol'],['PREV CLOSE','pc']].map(function(m){return '<div><div style="font-family:\'IBM Plex Mono\',monospace;font-size:7.5px;letter-spacing:.12em;color:#7E93A6">'+m[0]+'</div><div data-q="'+esc(s)+'" data-qf="'+m[1]+'" style="font-size:12px;font-weight:600;color:#6B7C90">—</div></div>';}).join('')+'</div></div>';}).join(''); }
    var GCOLORS=['#22E07A','#3d8bfd','#ffb020','#b98cff','#ff6b81','#4dd0e1'];
    function groupRow(g,i){ var icon=g.img?'<img src="'+esc(g.img)+'" alt="" loading="lazy" style="width:28px;height:28px;border-radius:9px;flex:none;object-fit:cover;background:#0A1017">':'<span style="width:28px;height:28px;border-radius:9px;flex:none;background:'+GCOLORS[i%GCOLORS.length]+';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#03120A">'+esc(g.name.slice(0,2))+'</span>'; return '<a href="'+esc(g.href||'/groups/')+'" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:11px;background:linear-gradient(180deg,#141D29,#0A1017);border:1px solid rgba(0,0,0,.5);border-top-color:rgba(255,255,255,.1);cursor:pointer;text-decoration:none;color:#E6EDF5"><span style="display:contents">'+icon+'</span><span style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(g.name)+'</span><span style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;color:#38F58A;flex:none">open</span></a>'; }
    function groupRows(){ var list=myGroups.length?myGroups:[{name:'Small Caps',href:'/groups/',img:''},{name:'Options Flow',href:'/groups/',img:''},{name:'Swing Desk',href:'/groups/',img:''},{name:'Chart Room',href:'/groups/',img:''}]; return list.slice(0,6).map(groupRow).join(''); }

    // ---- build shell ----
    var shell = document.createElement('div'); shell.id='sml-hf-shell';
    shell.innerHTML =
      // header
      '<div style="position:sticky;top:0;z-index:50;background:linear-gradient(180deg,rgba(20,30,44,.92),rgba(9,15,24,.9));backdrop-filter:blur(16px) saturate(140%);border-bottom:1px solid rgba(0,0,0,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 14px 34px -14px rgba(0,0,0,.9)">' +
        '<div style="max-width:1360px;margin:0 auto;display:flex;align-items:center;gap:20px;padding:0 24px;height:60px">' +
          '<a href="/" aria-label="StockMarketLoop" style="display:flex;align-items:center;flex:none;text-decoration:none"><img src="'+BRAND_IMG+'" alt="StockMarketLoop" style="height:46px;width:auto;display:block"></a>' +
          '<div style="flex:1;max-width:460px;display:flex;align-items:center;gap:8px;background:linear-gradient(180deg,#080E17,#121B27);border:1px solid rgba(0,0,0,.6);border-bottom-color:rgba(255,255,255,.08);border-radius:999px;padding:8px 16px;box-shadow:inset 0 2px 5px rgba(0,0,0,.75)"><span style="color:#6B7C90;font-size:13px">⌕</span><input placeholder="Search a ticker, e.g. NVDA" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:#E6EDF5;font-size:13px"></div>' +
          '<div style="flex:1"></div>' +
          '<div style="display:flex;gap:18px;font-size:13.5px;font-weight:500;color:#93A4B8">' +
            '<a href="/" style="color:#38F58A;text-decoration:none">Feed</a><a href="/markets/" style="color:#93A4B8;text-decoration:none">Markets</a><a href="/live/" style="color:#93A4B8;text-decoration:none">Live</a><a href="/n/" style="color:#93A4B8;text-decoration:none">Letters</a>' +
          '</div>' +
          '<a href="/go-live/" style="padding:9px 20px;border-radius:999px;text-decoration:none;font-size:13px;white-space:nowrap;'+GBTN+'">Go Live</a>' +
          '<div id="sml-hf-me-top" role="button" aria-label="Account menu" style="cursor:pointer;flex:none">'+avatarHTML(36)+'</div>' +
        '</div>' +
        '<div style="border-top:1px solid rgba(0,0,0,.6);overflow:hidden;background:linear-gradient(180deg,#060A11,#0B1119)"><div class="tape-row" style="display:flex;width:max-content;animation:smlHfTape 30s linear infinite;padding:7px 0">'+tapeCells()+tapeCells()+'</div></div>' +
      '</div>' +
      // grid
      '<div id="sml-hf-grid" style="max-width:1360px;margin:0 auto;padding:24px;display:grid;grid-template-columns:250px minmax(0,1fr) 290px;gap:22px;align-items:start">' +
        // left rail
        '<div id="sml-hf-left" style="position:sticky;top:118px;display:flex;flex-direction:column;gap:16px">' +
          '<div style="'+CARD+'padding:18px"><div style="display:flex;align-items:center;gap:12px"><div id="sml-hf-me-card" role="button" aria-label="Account menu" style="cursor:pointer;flex:none">'+avatarHTML(46,'#22E07A',4)+'</div><div><div style="font-weight:700;font-size:14.5px">'+esc(meName)+'</div><div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#38F58A"><span style="width:6px;height:6px;border-radius:50%;background:#38F58A"></span>Signed in</div></div></div></div>' +
          '<div style="display:flex;flex-direction:column;gap:2px">'+navItems()+'</div>' +
          '<div style="'+CARD+'padding:16px"><div style="display:flex;align-items:center;margin-bottom:12px"><span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:.12em;color:#6B7C90">MY WATCHLIST</span><button id="sml-hf-watch-edit" style="margin-left:auto;padding:3px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,#1C2734,#111926);color:#6B7C90;font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;cursor:pointer">edit</button></div>' +
          '<div id="sml-hf-watch-add" style="display:none;gap:6px;margin-bottom:12px"><input id="sml-hf-watch-inp" placeholder="Add ticker, e.g. NVDA" maxlength="6" style="flex:1;min-width:0;background:linear-gradient(180deg,#070C14,#111926);border:1px solid rgba(0,0,0,.6);border-bottom-color:rgba(255,255,255,.08);border-radius:9px;padding:7px 11px;color:#E6EDF5;font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;outline:none;text-transform:uppercase"><button id="sml-hf-watch-addbtn" style="flex:none;padding:0 14px;border-radius:9px;font-size:11.5px;'+GBTN+'">Add</button></div>' +
          '<div id="sml-hf-watch-list" style="display:flex;flex-direction:column;gap:10px">'+watchRows()+'</div></div>' +
        '</div>' +
        // center
        '<div style="min-width:0">' +
          '<div style="display:flex;gap:14px;margin-bottom:18px;overflow-x:auto;padding:2px">'+storyItems()+'</div>' +
          '<div style="'+CARD+'border-radius:18px;padding:16px 18px;margin-bottom:18px;display:flex;gap:12px;align-items:center">'+avatarHTML(40)+'<input placeholder="What\'s on the tape? Use $TICKER to tag…" style="flex:1;min-width:0;background:linear-gradient(180deg,#070C14,#111926);border:1px solid rgba(0,0,0,.6);border-bottom-color:rgba(255,255,255,.08);border-radius:999px;padding:11px 18px;color:#E6EDF5;font-size:13px;outline:none;box-shadow:inset 0 2px 5px rgba(0,0,0,.75)"><a href="/?compose=1" style="padding:10px 22px;border-radius:999px;text-decoration:none;font-size:13px;flex:none;'+GBTN+'">Post</a></div>' +
          '<div id="sml-hf-tabs" style="display:flex;align-items:center;gap:8px;margin-bottom:18px">'+feedTabs()+'<div style="margin-left:auto;display:flex;align-items:center;gap:6px;font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#6B7C90"><span style="width:6px;height:6px;border-radius:50%;background:#38F58A;animation:smlHfGlow 2s ease-in-out infinite"></span>live</div></div>' +
          // LIVE hero
          '<a href="/live/" style="display:block;text-decoration:none;color:inherit;position:relative;border-radius:20px;overflow:hidden;margin-bottom:20px;background:linear-gradient(155deg,#123B27 0%,#132132 46%,#0B111A 100%);border:1px solid rgba(56,245,138,.22);border-top-color:rgba(140,255,200,.42);box-shadow:inset 0 1px 0 rgba(190,255,222,.28),0 22px 40px -18px rgba(0,0,0,.85),0 0 50px -18px rgba(56,245,138,.35)"><div style="padding:22px 24px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:#F23645;color:#fff;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;letter-spacing:.08em"><span style="width:5px;height:5px;border-radius:50%;background:#fff"></span>LIVE NOW</span></div><div style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:26px;line-height:1.15;letter-spacing:-.4px;margin-bottom:8px">Market Open Desk — momentum names on watch</div><div style="font-size:13.5px;color:#93A4B8">Live with the Loop desk.</div></div></a>' +
          // real feed slot
          '<div id="sml-hf-feedslot"></div>' +
        '</div>' +
        // right rail
        '<div id="sml-hf-right" style="position:sticky;top:118px;display:flex;flex-direction:column;gap:16px">' +
          '<div style="position:relative;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#04090A,#020506);border:1.5px solid rgba(56,245,138,.5);box-shadow:inset 0 0 26px rgba(56,245,138,.1),0 0 18px -6px rgba(56,245,138,.35)"><div style="position:absolute;inset:0;pointer-events:none;opacity:.18;background:repeating-linear-gradient(90deg,rgba(56,245,138,.5) 0 1px,transparent 1px 18px),repeating-linear-gradient(0deg,rgba(56,245,138,.35) 0 1px,transparent 1px 18px);-webkit-mask-image:linear-gradient(90deg,transparent 45%,#000 100%);mask-image:linear-gradient(90deg,transparent 45%,#000 100%)"></div><div style="position:relative;padding:12px 13px 4px;font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:.2em;color:#38F58A;text-shadow:0 0 10px rgba(56,245,138,.6)">MARKET SNAPSHOT · SYMBOLS</div>'+snapRows()+'</div>' +
          '<div style="'+CARD+'padding:16px"><div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:.12em;color:#6B7C90;margin-bottom:12px">MY GROUPS</div><div id="sml-hf-groups-list" style="display:flex;flex-direction:column;gap:8px">'+groupRows()+'</div></div>' +
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
    loadAccountWatchlist(); // pull the user's saved watchlist from their account

    // Watchlist edit controls (event delegation — rows re-render).
    shell.addEventListener('click', function(ev){
      var b = ev.target && ev.target.closest ? ev.target.closest('button') : null; if (!b) return;
      var tb = b.getAttribute('data-tab');
      if (tb){ curTab = tb; styleTabs(); if (tb === 'following') loadFollowSet(dedupeFeed); else if (tb === 'live') buildLiveGrid(); dedupeFeed(); return; }
      if (b.id === 'sml-hf-watch-edit') { wEdit = !wEdit; renderWatch(); var i=document.getElementById('sml-hf-watch-inp'); if (wEdit && i) i.focus(); return; }
      if (b.id === 'sml-hf-watch-addbtn') { addTicker(); return; }
      var del = b.getAttribute('data-wdel');
      if (del) { wl = watchSyms().filter(function(x){ return x !== del; }); saveWl(); wlSync(del, 'remove'); renderWatch(); }
    });
    shell.addEventListener('keydown', function(ev){ if (ev.key === 'Enter' && ev.target && ev.target.id === 'sml-hf-watch-inp') { ev.preventDefault(); addTicker(); } });

    // ---- account menu: the site's existing avatar menu, opened from our avatars ----
    // Links are harvested from the original feed header (hidden under the skin), so
    // My profile / Settings / the nonce'd Sign out are the site's REAL urls.
    function harvestMenu(){
      var out=[], top=host.querySelector('.oh-top'); if(!top) return out;
      var KNOWN=['home','my profile','creator studio','go live','settings','customize profile'];
      top.querySelectorAll('a').forEach(function(a){
        var t=(a.textContent||'').replace(/\s+/g,' ').trim(), hf=a.getAttribute('href')||''; if(!hf) return;
        if(/action=logout/.test(hf)||/^(sign|log)\s?out$/i.test(t)){ out.push({l:'Sign out',h:hf,k:'out'}); return; }
        var lt=t.toLowerCase();
        if(KNOWN.indexOf(lt)>=0) out.push({l:t,h:hf,k:lt});
      });
      var seen={}; return out.filter(function(x){ if(seen[x.k]) return false; seen[x.k]=1; return true; });
    }
    function menuIcon(k){
      var P={'home':'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10','my profile':'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8.5c1.4-3.6 5-5 8-5s6.6 1.4 8 5','creator studio':'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4','go live':'M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 16.5v-9ZM15 10l6-3.5v11L15 14','settings':'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3-1.8-.6.4-1.9-1.6-1.6-1.9.4L14.5 6h-5L8.9 7.9 7 7.5 5.4 9.1l.4 1.9L4 12l1.8.6-.4 1.9 1.6 1.6 1.9-.4 1.6 1.8h5l.6-1.8 1.9.4 1.6-1.6-.4-1.9L20 12Z','customize profile':'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3ZM14 6l3 3','out':'M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M9 12h11m-3-3 3 3-3 3'};
      return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="'+(P[k]||P['home'])+'"/></svg>';
    }
    function closeMeMenu(){ var p=document.getElementById('sml-hf-memenu'); if(p) p.remove(); }
    function openMeMenu(){
      if(document.getElementById('sml-hf-memenu')){ closeMeMenu(); return; }
      var m=harvestMenu();
      if(!m.length) m=[{l:'Home',h:'/',k:'home'},{l:'My profile',h:'#',k:'my profile'},{l:'Creator Studio',h:'/creator-studio/',k:'creator studio'},{l:'Go live',h:'/go-live/',k:'go live'},{l:'Customize profile',h:'/customize-profile/',k:'customize profile'},{l:'Sign out',h:'/wp-login.php?action=logout',k:'out'}];
      var handle=''; m.forEach(function(it){ if(it.k==='my profile'){ var hm=it.h.match(/\/([a-z0-9_\-]+)\/?$/i); if(hm) handle='@'+hm[1]; } });
      var SEP={'creator studio':1,'settings':1,'out':1}, rows='';
      m.forEach(function(it){
        if(SEP[it.k]) rows+='<div style="height:1px;background:rgba(255,255,255,.09);margin:7px 0"></div>';
        rows+='<a href="'+esc(it.h)+'" style="display:flex;align-items:center;gap:13px;padding:11px 14px;border-radius:11px;text-decoration:none;font-size:14.5px;font-weight:600;color:'+(it.k==='out'?'#F2495C':'#E6EDF5')+'" onmouseover="this.style.background=\'rgba(255,255,255,.06)\'" onmouseout="this.style.background=\'transparent\'">'+menuIcon(it.k)+'<span>'+esc(it.l)+'</span>'+(it.k==='go live'?'<span style="margin-left:auto;width:9px;height:9px;border-radius:50%;background:#F23645;box-shadow:0 0 8px rgba(242,54,69,.8)"></span>':'')+'</a>';
      });
      var p=document.createElement('div'); p.id='sml-hf-memenu';
      p.style.cssText='position:fixed;top:64px;right:24px;z-index:2147483002;width:282px;padding:10px;border-radius:18px;background:linear-gradient(180deg,#10151C,#0A0E14);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 70px -20px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.08);font-family:\'Inter\',system-ui,sans-serif';
      p.innerHTML='<div style="padding:12px 14px 10px"><div style="font-weight:700;font-size:15.5px;color:#E6EDF5">'+esc(meName)+'</div>'+(handle?'<div style="font-size:12.5px;color:#7E8A96;margin-top:2px">'+esc(handle)+'</div>':'')+'</div><div style="height:1px;background:rgba(255,255,255,.09);margin:0 0 7px"></div>'+rows;
      document.body.appendChild(p);
    }
    ['sml-hf-me-top','sml-hf-me-card'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('click', function(ev){ ev.stopPropagation(); openMeMenu(); }); });
    document.addEventListener('click', function(ev){ var p=document.getElementById('sml-hf-memenu'); if(p && !p.contains(ev.target)) closeMeMenu(); });
    document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') closeMeMenu(); });

    // Presence: heartbeat + online rings on story circles (green = online, dim = offline).
    // Endpoints ship in the CDN-loader WP snippet; until it's updated, rings stay default.
    function beat(){ try { var fd=new FormData(); fd.append('action','sml_beat'); fetch(AJAX_URL,{method:'POST',body:fd,credentials:'same-origin'}); } catch(e){} }
    function pollPresence(){
      var slugs = authors.map(function(a){ return a.slug; }).filter(Boolean); if (!slugs.length) return;
      var fd = new FormData(); fd.append('action','sml_online'); fd.append('slugs', slugs.join(','));
      fetch(AJAX_URL, { method:'POST', body:fd, credentials:'same-origin' }).then(function(r){ return r.json(); }).then(function(d){
        if (!d || !d.online) return;
        document.querySelectorAll('#sml-hf-shell [data-pres]').forEach(function(el){
          var on = !!d.online[el.getAttribute('data-pres')];
          el.style.boxShadow = on ? '0 0 0 2px #0B131F,0 0 0 4px rgba(34,224,122,.9)' : '0 0 0 2px #0B131F,0 0 0 4px rgba(110,125,140,.3)';
        });
      }).catch(function(){});
    }
    beat(); setInterval(beat, 60000);
    pollPresence(); setInterval(pollPresence, 60000);

    // ---- rabbit hole: right arrow on each post reveals a looping rail of more ----
    // User posts -> author's recent posts; ticker/news cards -> recent articles on
    // that stock. The rail wraps around endlessly (1..N then back to 1).
    function rhFmtDate(d){ try { return new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric'}); } catch(e){ return ''; } }
    function rhGo(card, st, i, instant){
      var n = st.items.length || 1; i = ((i % n) + n) % n; st.i = i;
      var tr = card.__rhTrack; if (tr){ if (instant){ tr.style.transition='none'; tr.style.transform='translateX(-'+(i*100)+'%)'; void tr.offsetWidth; tr.style.transition=''; } else { tr.style.transform='translateX(-'+(i*100)+'%)'; } }
      if (card.__rhCount) card.__rhCount.textContent = st.items.length ? ((i+1)+' / '+st.items.length+' ∞') : '';
    }
    function rhRender(card, st){
      var tr = card.__rhTrack; if (!tr) return;
      if (!st.items.length){ tr.innerHTML='<div class="sml-rh-item"><div style="font-size:13.5px;color:#93A4B8">Nothing more here yet — keep scrolling the feed.</div></div>'; if(card.__rhCount) card.__rhCount.textContent=''; return; }
      tr.innerHTML = st.items.map(function(it){ return '<div class="sml-rh-item"><a href="'+esc(it.link)+'"><div style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:16.5px;line-height:1.3;color:#E6EDF5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+it.title+'</div></a><div style="display:flex;align-items:center;gap:10px;font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#6B7C90"><span>'+esc(rhFmtDate(it.date))+'</span><a href="'+esc(it.link)+'" style="color:#38F58A;font-weight:600">Read →</a></div></div>'; }).join('');
      rhGo(card, st, st.i || 0, true);
    }
    // Resolve a card's rail data (cached per query so many cards share fetches).
    var rhCache = {};
    function rhResolve(card, cb){
      if (card.__rhData){ cb(card.__rhData.items, card.__rhData.label); return; }
      var text = card.innerText || '';
      var tick = (text.match(/\$([A-Z]{1,5})\b/)||[])[1];
      var an = ((card.querySelector('.oh-post-author-name')||{}).textContent||'').trim();
      var aEl = card.querySelector('.oh-post-author');
      var ahref = aEl ? (aEl.getAttribute('href')||'') : '';
      var asm = ahref.match(/^(?:https?:\/\/[^\/]+)?\/([a-z0-9_\-]+)\/?$/i);
      var hEl = card.querySelector('h2 a');
      var cur = hEl ? (hEl.getAttribute('href')||'') : '';
      // A card is a NEWS article only when it's posted by the site's own news
      // account. Every member post — even one tagging $TICKERs — is a USER post
      // and reveals that user's latest posts.
      var isNews = /^(stock\s*market\s*loop|sml(\s*news)?)$/i.test(an);
      var title = hEl ? (hEl.textContent||'') : '';
      var topic = title.replace(/[^A-Za-z0-9$ ]/g,' ').split(/\s+/).filter(function(w){ return w.length>3 && !/^(this|that|with|from|will|have|been|after|about|says|over|into|their|would|could|these|those|when|what|where|more|than)$/i.test(w); }).slice(0,3).join(' ');
      var label = isNews ? (tick ? ('MORE ON $'+tick) : 'MORE LIKE THIS') : ('MORE FROM '+(an||'THIS TRADER').toUpperCase());
      var ck = isNews ? ('s:'+(tick||topic||'stocks')) : ('a:'+((asm&&asm[1])||an));
      function finish(arr){
        var items = (arr||[]).filter(function(x){ return x && x.link !== cur; }).map(function(x){ return { title:(x.title&&x.title.rendered)||'Untitled', link:x.link, date:x.date }; }).slice(0,10);
        card.__rhData = { items: items, label: label };
        cb(items, label);
      }
      if (rhCache[ck]){ finish(rhCache[ck]); return; }
      var save = function(arr){ rhCache[ck] = arr || []; finish(arr); };
      var base = '/wp-json/wp/v2/';
      function searchBy(q){ return fetch(base+'posts?search='+encodeURIComponent(q)+'&per_page=10&_fields=title,link,date').then(function(r){ return r.json(); }); }
      if (isNews){
        // News article -> more articles on the same stock (or same topic if no ticker).
        searchBy(tick || topic || 'stocks').then(save).catch(function(){ save([]); });
      }
      else if (asm){
        // User post -> ALWAYS that user's latest posts (ticker mentions don't change this).
        fetch(base+'users?slug='+encodeURIComponent(asm[1])+'&_fields=id').then(function(r){ return r.json(); })
          .then(function(u){ var id = u && u[0] && u[0].id; if (!id) throw 0; return fetch(base+'posts?author='+id+'&per_page=10&_fields=title,link,date').then(function(r){ return r.json(); }); })
          .then(function(arr){ if (arr && arr.length) save(arr); else return searchBy(an).then(save); })
          .catch(function(){ searchBy(an).then(save).catch(function(){ save([]); }); });
      }
      else { searchBy(an || tick || 'stocks').then(save).catch(function(){ save([]); }); }
    }
    function rhOpen(card){
      if (card.__rhPanel){ card.__rhPanel.classList.add('on'); return; }
      var p = document.createElement('div'); p.className='sml-rh-panel';
      p.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 18px 8px"><span class="sml-rh-label" style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:.14em;color:#38F58A"></span><span class="sml-rh-count" style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;color:#6B7C90"></span><button class="sml-rh-nav sml-rh-x" title="Back" style="font-size:12px">✕</button></div>'
        + '<div style="flex:1;overflow:hidden;position:relative"><div class="sml-rh-track"><div class="sml-rh-item"><div style="font-size:13px;color:#6B7C90">Loading…</div></div></div></div>'
        + '<div style="display:flex;align-items:center;justify-content:center;gap:14px;padding:8px 0 12px"><button class="sml-rh-nav sml-rh-prev">‹</button><button class="sml-rh-nav sml-rh-next">›</button></div>';
      card.appendChild(p);
      card.__rhPanel = p; card.__rhTrack = p.querySelector('.sml-rh-track'); card.__rhCount = p.querySelector('.sml-rh-count');
      var st = { items: [], i: 0 }; card.__rhState = st;
      requestAnimationFrame(function(){ p.classList.add('on'); });
      p.querySelector('.sml-rh-x').addEventListener('click', function(){ p.classList.remove('on'); });
      p.querySelector('.sml-rh-prev').addEventListener('click', function(){ rhGo(card, st, st.i-1); });
      p.querySelector('.sml-rh-next').addEventListener('click', function(){ rhGo(card, st, st.i+1); });
      rhResolve(card, function(items, label){
        var lab = p.querySelector('.sml-rh-label'); if (lab) lab.textContent = label;
        st.items = items; rhRender(card, st);
      });
    }
    function attachRh(card){
      if (card.querySelector('.sml-rh-btn')) return;
      var b = document.createElement('button'); b.className='sml-rh-btn'; b.innerHTML='›'; b.title='More like this';
      b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); rhOpen(card); });
      card.appendChild(b);
    }
    // Only add the arrow when there IS more to see: prefetch each card's rail
    // (staggered, cached) and attach the arrow only if items came back.
    function armRh(card, delay){ setTimeout(function(){ rhResolve(card, function(items){ if (items.length) attachRh(card); }); }, delay); }
    (function(){ var i = 0; host.querySelectorAll('.oh-post').forEach(function(card){ armRh(card, 350 * i++); }); })();

    // ---- feed hygiene: one card per user per content type ----
    // A user may appear again only with a DIFFERENT kind of activity (photo /
    // video / comment / liked post / text post). The site's own news account is
    // exempt so the news flow never collapses.
    function cardType(card){
      var meta = ((card.querySelector('.oh-meta')||{}).textContent||'').toLowerCase();
      if (/comment|repl/.test(meta)) return 'comment';
      if (/\blik/.test(meta)) return 'like';
      if (card.querySelector('video,iframe')) return 'video';
      var imgs = card.querySelectorAll('img');
      for (var i=0;i<imgs.length;i++){ if (!imgs[i].classList.contains('oh-post-avatar')) return 'photo'; }
      return 'post';
    }
    // Nonce for the site's own authed REST routes (harvested from its inline boot scripts).
    var RNONCE='';
    try { var scs=document.querySelectorAll('script:not([src])'); for (var si=0; si<scs.length; si++){ var sm=(scs[si].textContent||'').match(/["'](?:nonce|restNonce|rest_nonce|_wpnonce|wpNonce)["']\s*[:=]\s*["']([A-Za-z0-9]{8,12})["']/); if (sm){ RNONCE=sm[1]; break; } } } catch(e){}
    function api(u){ var h={}; if (RNONCE) h['X-WP-Nonce']=RNONCE; return fetch(u,{credentials:'same-origin',headers:h}).then(function(r){ if(!r.ok) throw r.status; return r.json(); }); }

    // Following = the viewer's friends + anyone they follow (site's own APIs).
    var fSet=null, fLoading=false;
    function loadFollowSet(cb){
      if (fSet){ cb(); return; } if (fLoading) return; fLoading=true;
      fSet={};
      var me=(window.SML_ME&&window.SML_ME.id)||0;
      var done=function(){ fLoading=false; cb(); };
      if (!me){ done(); return; }
      var add=function(f){ var h=String(f.handle||f.slug||'').toLowerCase(); if(h) fSet[h]=1; if(f.name) fSet['n:'+String(f.name).toLowerCase()]=1; };
      var tasks=[ api('/wp-json/sml-friends/v1/friends/'+me).then(function(d){ (d.friends||[]).forEach(add); }).catch(function(){}) ];
      ['/wp-json/sml-members/v1/follow?user_id='+me,'/wp-json/sml-members/v1/follow?scope=following'].forEach(function(u){
        tasks.push(api(u).then(function(d){ (d.following||d.follows||d.users||d.items||[]).forEach(add); }).catch(function(){}));
      });
      Promise.all(tasks).then(done,done);
    }

    // One visibility engine: dedupe (one card per user per content type; news
    // exempt) + the active tab's filter. Live tab swaps the feed for the grid.
    function dedupeFeed(){
      var live = curTab==='live';
      var lg=document.getElementById('sml-hf-livegrid'); if (lg) lg.style.display=live?'grid':'none';
      host.style.display=live?'none':'';
      if (live) return;
      var seen={}, any=false;
      host.querySelectorAll('.oh-post').forEach(function(card){
        var an=((card.querySelector('.oh-post-author-name')||{}).textContent||'').trim();
        var lan=an.toLowerCase();
        var isNewsA=/^(stock\s*market\s*loop|sml(\s*news)?)$/.test(lan);
        var show=true;
        if (!isNewsA && lan){ var key=lan+'|'+cardType(card); if (seen[key]) show=false; else seen[key]=1; }
        if (show && curTab==='following'){
          if (isNewsA) show=false;
          else { var aEl=card.querySelector('.oh-post-author'); var hf=aEl?(aEl.getAttribute('href')||''):''; var m=hf.match(/\/([a-z0-9_\-]+)\/?$/i); var slug=m?m[1].toLowerCase():''; show=!!(fSet&&(fSet[slug]||fSet['n:'+lan])); }
        }
        card.style.display=show?'':'none'; if (show) any=true;
      });
      var es=document.getElementById('sml-hf-emptyfollow');
      if (curTab==='following' && !any){
        if (!es){ es=document.createElement('div'); es.id='sml-hf-emptyfollow'; es.style.cssText='padding:44px 20px;text-align:center;color:#93A4B8;font-size:14px;line-height:1.6'; es.innerHTML='No posts from your people yet.<br>Follow traders and add friends to build this feed.'; host.appendChild(es); }
        es.style.display='block';
      } else if (es){ es.style.display='none'; }
    }

    // Facebook-style comment attribution: "Alice commented on Bob's post".
    function fbComments(){
      host.querySelectorAll('.oh-post').forEach(function(card){
        if (card.getAttribute('data-sml-fb')) return; card.setAttribute('data-sml-fb','1');
        if (cardType(card)!=='comment') return;
        var aEl=card.querySelector('.oh-post-author'); if (!aEl) return;
        var ahf=aEl.getAttribute('href')||'', target=null;
        card.querySelectorAll('a').forEach(function(l){
          if (target||l===aEl||aEl.contains(l)) return;
          var hf=l.getAttribute('href')||'';
          if (hf&&hf!==ahf&&/^(?:https?:\/\/[^\/]+)?\/[a-z0-9_\-]+\/?$/i.test(hf)&&!/\/(groups?|watch|live|creator-studio|go-live|markets|settings|n)\b/i.test(hf)){
            var t=(l.textContent||'').replace(/\s+/g,' ').trim(); if (t&&t.length<40) target={name:t,href:hf};
          }
        });
        var nameEl=card.querySelector('.oh-post-author-name'); if (!nameEl||!nameEl.parentNode) return;
        var span=document.createElement('span'); span.style.cssText='font-weight:400;color:#93A4B8;font-size:12.5px';
        span.innerHTML=' commented on '+(target?('<a href="'+esc(target.href)+'" style="color:#CFDAE4;font-weight:600;text-decoration:none">'+esc(target.name)+'</a>’s'):'a')+' post';
        nameEl.parentNode.insertBefore(span, nameEl.nextSibling);
      });
    }

    // Live tab: current live streams with watch pages (site API, /live/ scrape fallback).
    function buildLiveGrid(){
      var lg=document.getElementById('sml-hf-livegrid');
      if (!lg){ lg=document.createElement('div'); lg.id='sml-hf-livegrid'; lg.style.cssText='display:none;grid-template-columns:1fr 1fr;gap:14px'; var fs=document.getElementById('sml-hf-feedslot'); fs.parentNode.insertBefore(lg, fs); }
      lg.innerHTML='<div style="grid-column:1/-1;color:#6B7C90;font-size:13px;padding:16px">Checking who’s live…</div>';
      function render(items){
        if (!items.length){ lg.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px 16px;color:#93A4B8"><div style="font-size:15px;margin-bottom:14px">No one is live right now.</div><a href="/go-live/" style="padding:10px 26px;border-radius:999px;text-decoration:none;font-size:13px;'+GBTN+'">Be the first — Go Live</a></div>'; return; }
        lg.innerHTML=items.map(function(it){ return '<a href="'+esc(it.url)+'" style="display:block;text-decoration:none;color:inherit;border-radius:16px;overflow:hidden;position:relative;background:linear-gradient(160deg,#16202C,#0B111A);border:1px solid rgba(242,54,69,.35)">'+(it.img?'<img src="'+esc(it.img)+'" style="width:100%;height:122px;object-fit:cover;display:block">':'<div style="height:122px;display:flex;align-items:center;justify-content:center;font-size:34px">📺</div>')+'<span style="position:absolute;top:10px;left:10px;display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:#F23645;color:#fff;font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:700"><span style="width:5px;height:5px;border-radius:50%;background:#fff"></span>LIVE</span><div style="padding:10px 12px"><div style="font-weight:600;font-size:13.5px;color:#E6EDF5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.title||it.name||'Live stream')+'</div>'+(it.name&&it.title?'<div style="font-size:11px;color:#93A4B8">'+esc(it.name)+'</div>':'')+'</div></a>'; }).join('');
      }
      api('/wp-json/sml-live/v1/slots').then(function(d){
        var arr=d.slots||d.streams||d.items||d;
        if (!Array.isArray(arr)) arr=Object.keys(arr||{}).map(function(k){ return arr[k]; }).filter(function(x){ return x&&typeof x==='object'; });
        render(arr.filter(function(s){ return s&&(s.live||s.is_live||s.active||s.status==='live'); }).map(function(s){ return { title:s.title||s.stream_title||'', name:s.name||s.display_name||s.handle||'', url:s.watch_url||s.url||(s.handle?('/watch/'+s.handle+'/'):'/live/'), img:s.thumbnail||s.image||'' }; }));
      }).catch(function(){
        fetch('/live/',{credentials:'same-origin'}).then(function(r){ return r.text(); }).then(function(html){
          var doc=new DOMParser().parseFromString(html,'text/html'); var items=[], seenL={};
          doc.querySelectorAll('a[href*="/watch"]').forEach(function(a){ var hf=a.getAttribute('href')||''; if (!hf||seenL[hf]) return; seenL[hf]=1; var im=a.querySelector('img'); items.push({ title:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,60), name:'', url:hf, img:im?(im.getAttribute('src')||''):'' }); });
          render(items.slice(0,8));
        }).catch(function(){ render([]); });
      });
    }

    fbComments();
    dedupeFeed();

    // ---- live feed: poll for new posts and slide them in (no reload) ----
    var feedSeen = {};
    function cardKeyOf(card){ var a = card.querySelector('h2 a'); if (a && a.getAttribute('href')) return a.getAttribute('href'); return 'x:' + ((card.innerText||'').replace(/\s+/g,' ').slice(0,140)); }
    host.querySelectorAll('.oh-post').forEach(function(c){ feedSeen[cardKeyOf(c)] = 1; });
    function pollFeed(){
      fetch('/', { credentials:'same-origin', cache:'no-store' }).then(function(r){ return r.text(); }).then(function(html){
        if (html.indexOf('sml-optimized-home') < 0) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fresh = [];
        doc.querySelectorAll('#sml-optimized-home .oh-post').forEach(function(c){ if (!feedSeen[cardKeyOf(c)]) fresh.push(c); });
        if (!fresh.length) return;
        var main = host.querySelector('.oh-grid main') || host.querySelector('main') || host;
        for (var i = fresh.length - 1; i >= 0; i--) {
          var node = document.importNode(fresh[i], true);
          node.style.animation = 'smlHfNew .6s ease';
          main.insertBefore(node, main.firstChild);
          feedSeen[cardKeyOf(node)] = 1;
          armRh(node, 250 * (fresh.length - i));
        }
        fbComments(); dedupeFeed(); applyQuotes();
      }).catch(function(){});
    }
    setInterval(pollFeed, 45000);

    // Real group logos from the public /groups/ directory: fill logos for the
    // user's harvested groups (matched by slug); if none were harvested, show
    // the directory's top groups instead of placeholders.
    fetch('/groups/', { credentials: 'same-origin' }).then(function(r){ return r.text(); }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html'), dir = [], map = {};
      doc.querySelectorAll('a[href*="/groups/"]').forEach(function(a){
        var hf = a.getAttribute('href') || ''; var m = hf.match(/\/groups\/([a-z0-9-]+)/i); if (!m) return;
        var slug = m[1]; var im = a.querySelector('img'); var src = im ? (im.getAttribute('data-src') || im.getAttribute('src') || '') : '';
        var nm = im ? (im.getAttribute('alt') || '').replace(/\s*group logo\s*/i, '').trim() : '';
        if (!nm) nm = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (SML_BANNED_GROUP(slug, nm)) return;
        if (src && !map[slug]) map[slug] = src;
        if (nm && nm.length <= 48 && !dir.some(function(g){ return g.slug === slug; })) dir.push({ slug: slug, name: nm, href: hf, img: src });
      });
      myGroups.forEach(function(g){ if (!g.img && map[g.slug]) g.img = map[g.slug]; });
      if (!myGroups.length) myGroups = dir.slice(0, 4);
      var el = document.getElementById('sml-hf-groups-list');
      if (el && myGroups.length) el.innerHTML = myGroups.slice(0, 6).map(groupRow).join('');
    }).catch(function(){});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  var tries=0, iv=setInterval(function(){ if(document.getElementById('sml-hf-shell')||++tries>40){clearInterval(iv);return;} boot(); },250);
})();
