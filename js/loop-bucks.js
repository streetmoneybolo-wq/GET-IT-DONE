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

  var ME = null, EARN = null, GATES = null, BOARD = null, MS = null, panelOpen = false, loading = false, copied = false, expanded = null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function api(path, body){
    var abs = /^https?:/.test(path) || path.indexOf('/wp-json/') === 0;
    return fetch(abs ? path : C.rest + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? {'X-WP-Nonce': C.nonce, 'Content-Type': 'application/json'} : {'X-WP-Nonce': C.nonce}, cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }
  var MSAPI = '/wp-json/sml-lbm/v1';
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
    follower_got:     { icon:'⭐', page:'/create-channel/' },
    share_link:       { icon:'⤴', news:true }
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
      var name = meta.news ? '<a class="sml-lb-name" href="#" data-news="1">'+esc(w.label)+' ↗</a>' : meta.page ? '<a class="sml-lb-name" href="'+esc(meta.page)+'" data-stop="1">'+esc(w.label)+' ↗</a>' : '<span class="sml-lb-name">'+esc(w.label)+'</span>';
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

  /* ---- Milestones (sml-lbm/v1 — streaks / referrals / socials / shares, all paid into the real ledger) ---- */
  function msRows(){
    if (!MS || !MS.ready) return '';
    var out = '<div class="sml-lb-sec">Milestones</div>';
    var st = MS.streak || {}; var next = (st.tiers||[]).filter(function(t){ return !t.done; })[0];
    out += '<div class="sml-lb-row" style="cursor:default"><span class="sml-lb-ic">🔥</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span class="sml-lb-name">Daily streak · ' + fmt(st.days||0) + (st.days === 1 ? ' day' : ' days') + '</span>' +
      '<span class="sml-lb-sub">' + (st.checkedInToday ? 'Checked in today' : 'Visit today to keep it going') + (next ? ' · ' + (next.len === 365 ? '1-year' : next.len + '-day') + ' bonus +' + fmt(next.amount) + ' LB' : '') + '</span>' +
      (next ? '<div class="sml-lb-prog"><i style="width:' + Math.min(100, Math.round((st.days||0) / next.len * 100)) + '%"></i></div>' : '') + '</span>' +
      '<span class="sml-lb-amt">' + (next ? '+' + fmt(next.amount) : '✓') + '</span></div>';
    var rf = MS.referral || {};
    out += '<div class="sml-lb-row" data-task="refer"><span class="sml-lb-ic">🎁</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span class="sml-lb-name">Refer a friend</span><span class="sml-lb-sub">+' + fmt(rf.per||0) + ' LB after they check in ' + (rf.checkinsRequired||7) + ' days · ' + fmt(rf.count||0) + ' so far</span></span><span class="sml-lb-amt">+' + fmt(rf.per||0) + ' LB</span><span class="sml-lb-chev">' + (expanded === 'refer' ? '▲' : '▼') + '</span></div>';
    if (expanded === 'refer') out += '<div class="sml-lb-ms">' + refCard(rf.link) + (rf.tiers||[]).map(function(t){ return '<div class="sml-lb-msrow' + (t.done ? ' done' : '') + '"><span class="dot"></span><span>' + t.count + ' referrals bonus</span><span class="amt">' + (t.done ? '✓ ' : '+') + fmt(t.amount) + ' LB</span></div>'; }).join('') + '</div>';
    var so = MS.socials || {}; var plats = so.platforms || [];
    if (plats.length) {
      out += '<div class="sml-lb-row sml-lb-feat" data-task="socials"><span class="sml-lb-shine"></span><span class="sml-lb-ic">📣</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span style="display:flex;align-items:center;gap:6px"><span class="sml-lb-name">Follow Stock Market Loop</span><span class="sml-lb-badge">🔥 TOP REWARD</span></span><span class="sml-lb-sub">+' + fmt(so.each) + ' LB per platform · all ' + plats.length + ' = +' + fmt(so.allBonus) + ' LB bonus</span></span><span class="sml-lb-amt">+' + fmt(so.each) + ' LB each</span><span class="sml-lb-chev">' + (expanded === 'socials' ? '▲' : '▼') + '</span></div>';
      if (expanded === 'socials') out += '<div class="sml-lb-ms">' + plats.map(function(pl){ return '<div class="sml-lb-msrow' + (pl.done ? ' done' : '') + '"><span class="dot"></span>' + (pl.done ? '<span>' + esc(pl.label) + '</span>' : '<a href="' + esc(pl.url) + '" target="_blank" rel="noopener" data-social="' + esc(pl.key) + '">' + esc(pl.label) + ' ↗</a>') + '<span class="amt">' + (pl.done ? '✓ ' : '+') + fmt(so.each) + ' LB</span></div>'; }).join('') +
        '<div class="sml-lb-msrow' + (so.allDone ? ' done' : '') + '"><span class="dot"></span><span>All platforms bonus</span><span class="amt">' + (so.allDone ? '✓ ' : '+') + fmt(so.allBonus) + ' LB</span></div></div>';
    }
    var sh = MS.share || {};
    out += '<div class="sml-lb-row" data-news="1"><span class="sml-lb-ic">⤴</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px"><span class="sml-lb-name" style="color:#38F58A;text-decoration:underline;text-underline-offset:2px">Share an article ↗</span><span class="sml-lb-sub">+' + fmt(sh.amount||0) + ' LB per share · ' + fmt(Math.max(0,(sh.cap||0)-(sh.today||0))) + ' LB left today</span></span><span class="sml-lb-amt">+' + fmt(sh.amount||0) + ' LB</span></div>';
    return out;
  }
  function refCard(link){
    return '<div class="sml-lb-refcard"><span class="ring"></span><div style="font-weight:800;font-size:13px;color:#fff">Invite friends to Stock Market Loop</div><div style="color:#93A4B8;font-size:11px">Your link — they sign up, you earn once they check in ' + fmt((MS.referral||{}).checkinsRequired||7) + ' days</div>' +
      '<div style="display:flex;align-items:center;gap:8px"><span class="lnk">' + esc(link||'') + '</span><button class="sml-lb-copy" data-copy="' + esc(link||'') + '">' + (copied ? 'Copied!' : 'Copy') + '</button></div></div>';
  }
  /* ---- share overlay: 10 randomized recent articles → Share → real share_link credit ---- */
  function openNews(){
    if (document.getElementById('sml-lb-news')) return;
    var o = document.createElement('div'); o.id = 'sml-lb-news';
    o.innerHTML = '<div class="box"><div class="bhead"><span style="font-weight:800;font-size:15px">Share an article, earn Loop Bucks</span><button class="sml-lb-x" data-close-news="1">✕</button></div><div class="blist" id="sml-lb-news-list"><div style="padding:20px;color:#6B7C90;font-size:13px">Loading recent articles…</div></div></div>';
    document.body.appendChild(o);
    fetch('/wp-json/wp/v2/posts?per_page=40&_fields=title,link,date').then(function(r){ return r.json(); }).then(function(arr){
      arr = (arr || []).slice();
      for (var i = arr.length - 1; i > 0; i--){ var j = Math.floor(Math.random()*(i+1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      var list = document.getElementById('sml-lb-news-list'); if (!list) return;
      list.innerHTML = arr.slice(0, 10).map(function(p){
        var d = ''; try { d = new Date(p.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}); } catch(e){}
        return '<div class="art"><a href="'+esc(p.link)+'" target="_blank" rel="noopener">'+((p.title&&p.title.rendered)||'Untitled')+'</a><span class="d">'+esc(d)+'</span><button class="sml-lb-share" data-share="'+esc(p.link)+'">Share</button></div>';
      }).join('') || '<div style="padding:20px;color:#6B7C90;font-size:13px">No articles found.</div>';
    }).catch(function(){});
  }
  function doShare(url, btn){
    var finish = function(){
      btn.textContent = 'Shared ✓'; btn.disabled = true;
      api(MSAPI + '/share', { url: url }).then(function(d){ if (d && d.state){ MS = d.state; if (d.balance != null && ME) ME.balance = d.balance; renderBtn(); if (panelOpen) renderPanel(); } });
    };
    if (navigator.share) navigator.share({ url: url }).then(finish).catch(function(){});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ btn.textContent = 'Link copied'; finish(); });
    else finish();
  }

  function renderPanel(){
    var p = document.getElementById('sml-lb-panel');
    if (!panelOpen){ if (p) p.remove(); return; }
    if (!p){ p = document.createElement('div'); p.id = 'sml-lb-panel'; p.setAttribute('role','dialog'); p.setAttribute('aria-label','Loop Bucks'); document.body.appendChild(p); }
    var b = document.getElementById('sml-lb-btn');
    var r = b ? b.getBoundingClientRect() : { bottom: 60, right: window.innerWidth - 16 };
    p.style.top = Math.round(r.bottom + 8) + 'px';
    p.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    var body = ME ? (todayRow() + wayRows() + msRows() + gateRows() + historyRows() + boardRows())
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
    if (el.closest && el.closest('[data-close-news]')){ var n = document.getElementById('sml-lb-news'); if (n) n.remove(); return; }
    var news = el.closest ? el.closest('[data-news]') : null;
    if (news){ ev.preventDefault(); openNews(); return; }
    var share = el.closest ? el.closest('[data-share]') : null;
    if (share){ doShare(share.getAttribute('data-share'), share); return; }
    var soc = el.closest ? el.closest('[data-social]') : null;
    if (soc){ api(MSAPI + '/social-follow', { platform: soc.getAttribute('data-social') }).then(function(d){ if (d && d.state){ MS = d.state; if (d.balance != null && ME) ME.balance = d.balance; renderBtn(); if (panelOpen) renderPanel(); } }); return; /* the link still opens in a new tab */ }
    var cp = el.closest ? el.closest('[data-copy]') : null;
    if (cp){ if (navigator.clipboard) navigator.clipboard.writeText(cp.getAttribute('data-copy')); copied = true; renderPanel(); setTimeout(function(){ copied = false; if (panelOpen) renderPanel(); }, 1500); return; }
    if (el.closest && el.closest('[data-stop]')) return; /* page links navigate */
    var row = el.closest ? el.closest('[data-task]') : null;
    if (row){ var id = row.getAttribute('data-task'); expanded = expanded === id ? null : id; renderPanel(); return; }
    if (p && !p.contains(el)) { panelOpen = false; renderPanel(); }
  });
  document.addEventListener('keydown', function(ev){ if (ev.key === 'Escape'){ var n = document.getElementById('sml-lb-news'); if (n) { n.remove(); return; } if (panelOpen){ panelOpen = false; renderPanel(); } } });

  function refresh(){
    loading = true;
    /* each REST call here takes ~2s on this site — paint the balance the moment
       /me lands instead of holding the button until the leaderboard arrives */
    var me = api('/me').then(function(d){ if (d && d.balance != null){ ME = d; renderBtn(); if (panelOpen) renderPanel(); } });
    return Promise.all([ me, api('/earn'), api('/gates'), api('/leaderboard'), api(MSAPI + '/state') ]).then(function(a){
      loading = false;
      if (a[1] && a[1].ways) EARN = a[1];
      if (a[2] && a[2].gates) GATES = a[2];
      if (a[3] && a[3].board) BOARD = a[3];
      MS = (a[4] && a[4].ready) ? a[4] : null; /* milestone snippet not deployed → section simply absent */
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
