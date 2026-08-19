/*!
 * SML Loop Bucks — header button + earn dropdown.
 * Backed ENTIRELY by the site's real Loop Bucks system (sml-lb/v1): balance /
 * rank / badge / history from /me, earning rules from /earn (the plugin
 * publishes its own "ways" with amounts + daily caps), unlock progress from
 * /gates, top earners from /leaderboard. Nothing here invents a rule or a
 * number — if the plugin doesn't report it, the panel doesn't show it.
 * (An earlier package for this button shipped its own parallel ledger; that
 * was dropped so users never see two different Loop Bucks balances.)
 * Anchors next to #sml-hf-loop-kick (home-feed header) when present; falls
 * back to a fixed top-right pill elsewhere.
 */
(function () {
  'use strict';
  var C = window.SML_LB;
  if (!C || !C.me || !C.me.id) return;

  var ME = null, EARN = null, GATES = null, BOARD = null, panelOpen = false, loading = false;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function api(path){
    return fetch(C.rest + path, { credentials: 'same-origin', headers: {'X-WP-Nonce': C.nonce}, cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }
  function fmt(n){ return Number(n||0).toLocaleString(); }
  function ago(iso){
    var s0 = String(iso||''); var t = Date.parse(s0.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s0) ? '' : 'Z')); if (!t) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 3600) return Math.max(1, Math.floor(s/60)) + 'm ago'; if (s < 86400) return Math.floor(s/3600) + 'h ago';
    if (s < 604800) return Math.floor(s/86400) + 'd ago'; return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  var MONO = "'IBM Plex Mono',monospace";

  /* where each real earning rule happens on the site (labels/amounts come from the plugin) */
  var WAY = {
    profile_done:     { icon:'👤', page:'/settings/' },
    first_comment:    { icon:'💬', page:'/' },
    first_watch:      { icon:'▶️', page:'/watch/' },
    first_follow:     { icon:'🤝', page:'/' },
    stream_started:   { icon:'🔴', page:'/go-live/' },
    video_published:  { icon:'📺', page:'/upload-video/' },
    letter_published: { icon:'✉️', page:'/creator-studio/loop-letters/write/' },
    follower_got:     { icon:'⭐', page:'/create-channel/' }
  };
  var GATE_ICON = { games:'🎮', creator:'🎬', live_comment:'💬' };

  function head(){
    var b = ME || {}, badge = b.badge || {};
    var tier = badge.title ? badge.title.replace(/^Top 100 - rank \d+$/, 'Top 100').replace(/^Rank \d+ by Loop Bucks$/, '') : '';
    var rank = b.rank ? ' · <b style="color:#38F58A">#' + fmt(b.rank) + '</b>' + (tier ? ' <span style="color:#6B7C90">' + esc(tier) + '</span>' : '') : '';
    return '<div class="sml-lb-head"><img src="'+esc(C.icon)+'" alt="">'
      + '<div><div style="font-weight:800;font-size:15px;color:#fff">Loop Bucks</div>'
      + '<div style="color:#93A4B8;font-size:12px">Your balance: <b style="color:#38F58A">'+fmt(b.balance)+' LB</b>'+rank+'</div></div>'
      + '<button class="sml-lb-x" data-close="1" aria-label="Close">✕</button></div>';
  }
  function todayRow(){
    if (!EARN || EARN.ceiling == null) return '';
    var t = +EARN.today || 0, cap = +EARN.ceiling || 0, pct = cap ? Math.min(100, Math.round(t / cap * 100)) : 0;
    return '<div class="sml-lb-sec">Today</div><div class="sml-lb-row" style="cursor:default"><span class="sml-lb-ic">📅</span>'
      + '<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span class="sml-lb-name">Earned today</span>'
      + '<span class="sml-lb-sub">'+fmt(t)+' of '+fmt(cap)+' LB daily cap</span><div class="sml-lb-prog"><i style="width:'+pct+'%"></i></div></span>'
      + '<span class="sml-lb-amt">'+(t >= cap && cap ? 'MAX' : '+'+fmt(t)+' LB')+'</span></div>';
  }
  function wayRows(){
    var ways = (EARN && EARN.ways) || [];
    if (!ways.length) return '';
    return '<div class="sml-lb-sec">Earn Loop Bucks</div>' + ways.map(function(w){
      var meta = WAY[w.key] || { icon:'💰' };
      var sub = w.once ? 'One-time' : (w.left != null ? (w.left > 0 ? fmt(w.left) + ' LB left today' : 'Daily limit reached') : 'Repeatable');
      var name = meta.page ? '<a class="sml-lb-name" href="'+esc(meta.page)+'" data-stop="1">'+esc(w.label)+' ↗</a>' : '<span class="sml-lb-name">'+esc(w.label)+'</span>';
      var maxed = !w.once && w.left != null && w.left <= 0;
      return '<div class="sml-lb-row" style="cursor:default'+(maxed?';opacity:.55':'')+'"><span class="sml-lb-ic">'+meta.icon+'</span>'
        + '<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px">'+name+'<span class="sml-lb-sub">'+esc(sub)+'</span></span>'
        + '<span class="sml-lb-amt">+'+fmt(w.amount)+' LB</span></div>';
    }).join('');
  }
  function gateRows(){
    var g = (GATES && GATES.gates) || {}; var keys = Object.keys(g);
    if (!keys.length) return '';
    return '<div class="sml-lb-sec">Unlocks — hold Loop Bucks to open</div>' + keys.map(function(k){
      var x = g[k] || {}; var need = +x.need || 0, have = +x.have || 0, pct = need ? Math.min(100, Math.round(have / need * 100)) : 100;
      var ok = !!(x.open || x.exempt);
      var state = x.exempt ? 'Always open for you' : (x.open ? 'Open' : fmt(x.short) + ' LB short');
      return '<div class="sml-lb-row" style="cursor:default" title="'+esc(x.why||'')+'"><span class="sml-lb-ic">'+(GATE_ICON[k]||'🔓')+'</span>'
        + '<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span class="sml-lb-name">'+esc(x.label||k)+'</span>'
        + '<span class="sml-lb-sub">'+esc(state)+' · needs '+fmt(need)+' LB</span>'+(ok ? '' : '<div class="sml-lb-prog"><i style="width:'+pct+'%"></i></div>')+'</span>'
        + '<span class="sml-lb-amt" style="color:'+(ok?'#38F58A':'#93A4B8')+'">'+(ok?'✓':fmt(need))+'</span></div>';
    }).join('');
  }
  function historyRows(){
    var h = (ME && ME.history) || [];
    if (!h.length) return '';
    return '<div class="sml-lb-sec">Recent</div><div class="sml-lb-ms" style="margin:0 2px 8px">' + h.slice(0, 6).map(function(e){
      var d = +e.delta || 0;
      return '<div class="sml-lb-msrow"><span class="dot"'+(d<0?' style="background:#F2495C"':'')+'></span><span>'+esc(e.label||e.reason||'Loop Bucks')+'</span>'
        + '<span style="color:#6B7C90;font-size:10.5px;margin-left:6px">'+esc(ago(e.at))+'</span><span class="amt"'+(d<0?' style="color:#F2495C"':'')+'>'+(d>=0?'+':'')+fmt(d)+' LB</span></div>';
    }).join('') + '</div>';
  }
  function boardRows(){
    var b = (BOARD && BOARD.board) || [];
    if (!b.length) return '';
    var rows = b.slice(0, 3).map(function(r){
      var me = ME && r.id === C.me.id;
      var av = r.avatar ? '<img src="'+esc(r.avatar)+'" alt="" style="width:18px;height:18px;border-radius:50%;object-fit:cover">' : '';
      return '<div class="sml-lb-msrow"'+(me?' style="color:#fff"':'')+'><span style="width:18px;color:#6B7C90;font-family:'+MONO+'">'+r.rank+'</span>'+av+'<span>'+esc(r.name||r.handle||'')+(me?' (you)':'')+'</span><span class="amt">'+fmt(r.balance)+' LB</span></div>';
    }).join('');
    if (ME && ME.rank && ME.rank > 3) rows += '<div class="sml-lb-msrow" style="color:#fff"><span style="width:18px;color:#6B7C90;font-family:'+MONO+'">'+ME.rank+'</span><span>You</span><span class="amt">'+fmt(ME.balance)+' LB</span></div>';
    return '<div class="sml-lb-sec">Top earners</div><div class="sml-lb-ms" style="margin:0 2px 10px">' + rows + '</div>';
  }

  function renderPanel(){
    var p = document.getElementById('sml-lb-panel');
    if (!panelOpen){ if (p) p.remove(); return; }
    if (!p){ p = document.createElement('div'); p.id = 'sml-lb-panel'; p.setAttribute('role','dialog'); p.setAttribute('aria-label','Loop Bucks'); document.body.appendChild(p); }
    var b = document.getElementById('sml-lb-btn');
    var r = b ? b.getBoundingClientRect() : { bottom: 60, right: window.innerWidth - 16 };
    p.style.top = Math.round(r.bottom + 8) + 'px';
    p.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    var body = ME ? (todayRow() + wayRows() + gateRows() + historyRows() + boardRows())
      : '<div style="padding:22px 12px;color:#6B7C90;font-size:12px">'+(loading ? 'Loading your Loop Bucks…' : 'Loop Bucks are unavailable right now — try again in a moment.')+'</div>';
    p.innerHTML = head() + '<div class="sml-lb-scroll">' + body + '</div>';
  }
  function renderBtn(){
    var b = document.getElementById('sml-lb-btn');
    if (!b) return;
    b.innerHTML = '<img src="'+esc(C.icon)+'" alt=""><span class="sml-lb-lbl"><span class="sml-lb-k">Loop Bucks</span><span class="sml-lb-v">'+(ME ? fmt(ME.balance) : '—')+'</span></span>';
  }

  /* ---- mount: next to LOOP-KICK when the shell header exists ---- */
  function mount(){
    if (document.getElementById('sml-lb-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'sml-lb-btn'; b.setAttribute('aria-label', 'Loop Bucks — balance and how to earn'); b.setAttribute('aria-haspopup', 'dialog');
    var kick = document.getElementById('sml-hf-loop-kick');
    if (kick && kick.parentNode) kick.parentNode.insertBefore(b, kick);
    else { b.className = 'sml-lb-floating'; document.body.appendChild(b); }
    renderBtn();
  }
  var mo = new MutationObserver(function(){
    var kick = document.getElementById('sml-hf-loop-kick');
    var b = document.getElementById('sml-lb-btn');
    if (kick && b && b.classList.contains('sml-lb-floating')) { b.remove(); mount(); }
    else if (!b) mount();
  });

  /* ---- events ---- */
  document.addEventListener('click', function(ev){
    var el = ev.target;
    if (el.closest && el.closest('#sml-lb-btn')){ panelOpen = !panelOpen; renderPanel(); if (panelOpen) refresh(); return; }
    var p = document.getElementById('sml-lb-panel');
    if (el.closest && el.closest('[data-close]')){ panelOpen = false; renderPanel(); return; }
    if (el.closest && el.closest('[data-stop]')) return; /* page links navigate */
    if (p && !p.contains(el)) { panelOpen = false; renderPanel(); }
  });
  document.addEventListener('keydown', function(ev){ if (ev.key === 'Escape' && panelOpen){ panelOpen = false; renderPanel(); } });

  function refresh(){
    loading = true;
    return Promise.all([ api('/me'), api('/earn'), api('/gates'), api('/leaderboard') ]).then(function(a){
      loading = false;
      if (a[0] && a[0].balance != null) ME = a[0];
      if (a[1] && a[1].ways) EARN = a[1];
      if (a[2] && a[2].gates) GATES = a[2];
      if (a[3] && a[3].board) BOARD = a[3];
      renderBtn(); if (panelOpen) renderPanel();
    });
  }

  function boot(){
    mount();
    mo.observe(document.body, { childList: true, subtree: false });
    refresh();
    /* balance can change from other tabs/pages (watching, live, comments) — light refresh */
    setInterval(function(){ if (document.visibilityState === 'visible') api('/me').then(function(d){ if (d && d.balance != null){ ME = d; renderBtn(); if (panelOpen) renderPanel(); } }); }, 120000);
    document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') refresh(); });
    window.addEventListener('resize', function(){ if (panelOpen) renderPanel(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
