/* StockMarketLoop site-wide search: one header field, grouped live results. */
(function () {
  'use strict';
  if (window.__smlSiteSearchBooted) return;
  window.__smlSiteSearchBooted = true;

  var CFG = window.SML_SITE_SEARCH || {};
  var REST = CFG.rest || '/wp-json/sml-site-search/v1/search';
  var state = { tab: 'all', data: null, timer: null, abort: null, anchor: null, fallbackTimer: null };
  var scriptNode = document.currentScript;
  var assetBase = scriptNode && scriptNode.src ? scriptNode.src.split('/js/site-search.js')[0] + '/' : '';
  var QUOTES_URL = 'https://stockmarketloop-loop-kick.onrender.com/api/quotes';

  /* Group-tool embeds (Live Chart / Analyst Dashboard iframes on /groups/…)
     load this page with ?sml_group_tool&embed=… — inside those frames the
     site-wide header, tape, admin bar and theme chrome must NOT render
     (they were duplicating the header inside the tool = the reported bug).
     Instead the tool gets a slim ticker-ONLY search wired straight to the
     dashboard's own chart controls (#csym + #csym-go), so picking a result
     re-points the streaming chart instantly without leaving the frame. */
  var EMBED_Q = new URLSearchParams(location.search);
  var EMBED_TOOL = EMBED_Q.has('sml_group_tool') || (EMBED_Q.has('embed') && window.self !== window.top);
  var HEADER_SYMBOLS = ['SPY','QQQ','NVDA','AAPL','TSLA','MSFT','AMD','META','AMZN','SCKT','ILLR','MRAM'];
  var headerQuoteTimer = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function attr(v) { return esc(v); }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function visible(node) { return !!(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length)); }

  function isHomeFeed() {
    var path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
    return path === '/' || !!el('#sml-hf-shell');
  }

  function currentPath(path) {
    var here = String(location.pathname || '/').replace(/\/+$/, '') || '/';
    var want = String(path || '/').replace(/\/+$/, '') || '/';
    return here === want;
  }

  function viewerIdentity() {
    var cfg = window.SML_LB || window.SML_ME || {};
    var name = String(cfg.name || cfg.displayName || 'Account');
    var avatar = String(cfg.avatar || cfg.photo || '');
    if (!avatar) {
      var image = el('.sml-acct__btn img, .wv-user img, #wpadminbar img.avatar, img.avatar');
      if (image) avatar = image.currentSrc || image.src || '';
    }
    return { name: name, avatar: avatar, initials: name.split(/\s+/).map(function (word) { return word.charAt(0); }).slice(0, 2).join('').toUpperCase() || 'ME' };
  }

  function tickerCells() {
    return HEADER_SYMBOLS.map(function (symbol) {
      return '<a class="sml-gh-tick" data-tkpop="' + symbol + '" href="/stock-chart/?symbol=' + symbol + '"><b>$' + symbol + '</b><span data-gh-quote="' + symbol + '" data-field="last">—</span><em data-gh-quote="' + symbol + '" data-field="pct">—</em></a>';
    }).join('');
  }

  function replaceKnownHeader() {
    var nativeHeader = el('.wv-head');
    if (nativeHeader) nativeHeader.classList.add('sml-gh-replaced');
    var themeHeader = el('.wp-site-blocks > header.wp-block-template-part');
    if (themeHeader) themeHeader.classList.add('sml-gh-replaced');
  }

  function mountGlobalHeader() {
    if (isHomeFeed() || el('#sml-global-header')) return;
    var me = viewerIdentity();
    var header = document.createElement('header');
    header.id = 'sml-global-header';
    header.setAttribute('role', 'banner');
    header.innerHTML = '<div class="sml-gh-main">' +
      '<a class="sml-gh-brand" href="/" aria-label="Stock Market Loop home"><img src="' + attr(assetBase + 'img/loop-logo.png') + '" alt="Stock Market Loop"></a>' +
      '<label class="sml-gh-search"><span aria-hidden="true">⌕</span><span class="screen-reader-text">Search Stock Market Loop</span><input type="search" aria-label="Search ticker" placeholder="Search a ticker, e.g. NVDA" autocomplete="off"></label>' +
      '<nav class="sml-gh-nav" aria-label="Primary navigation">' +
        [['/','Feed'],['/markets/','Markets'],['/live/','Live'],['/n/','Letters']].map(function (item) { return '<a href="' + item[0] + '"' + (currentPath(item[0]) ? ' aria-current="page"' : '') + '>' + item[1] + '</a>'; }).join('') +
      '</nav>' +
      '<button type="button" id="sml-hf-loop-kick" class="sml-gh-kick" aria-label="Open LOOP-KICK" aria-expanded="false">LOOP-KICK</button>' +
      '<button type="button" class="sml-gh-account" aria-label="Open account menu for ' + attr(me.name) + '">' + (me.avatar ? '<img src="' + attr(me.avatar) + '" alt="' + attr(me.name) + '">' : '<span>' + esc(me.initials) + '</span>') + '</button>' +
    '</div>' +
    '<div class="sml-gh-tape" aria-label="Live market quotes"><div class="sml-gh-tape-row">' + tickerCells() + tickerCells() + '</div></div>';
    document.body.insertBefore(header, document.body.firstChild);
    document.body.classList.add('sml-global-header-on');
    replaceKnownHeader();
    dockLegacyAccount(header);
    bindAccountMenu(header);
    bindLoopKick(header);
    pollHeaderQuotes();
    headerQuoteTimer = window.setInterval(pollHeaderQuotes, 5000);
  }

  /* ONE account control: the theme's floating account chip (.sml-acct, printed in
     wp_footer by the Settings plugin, bottom-right) is moved INTO the header next to
     the header avatar. Its own round button is hidden by CSS; its menu — the real,
     server-rendered one with every item (profile, studio, go live, settings, sign out…)
     — opens under the header avatar. Listeners survive the move (same node). */
  function dockLegacyAccount(header) {
    var acct = el('.sml-acct[data-sml-acct]');
    var main = el('.sml-gh-main', header);
    if (!acct || !main || main.contains(acct)) return;
    var account = el('.sml-gh-account', header);
    if (account && account.parentNode === main) account.insertAdjacentElement('afterend', acct); else main.appendChild(acct);
    acct.classList.add('sml-gh-docked');
  }

  function bindAccountMenu(header) {
    var button = el('.sml-gh-account', header);
    if (!button) return;
    button.addEventListener('click', function () {
      var nativeButton = all('.sml-acct__btn, .wv-user, [aria-label="Account menu"]')
        .filter(function (node) { return node !== button && !node.classList.contains('sml-gh-account'); })[0];   /* the legacy chip is docked INSIDE the header now (dockLegacyAccount) */
      /* defer: the chip's own document-level "click outside → close" handler runs for
         THIS click (its target is the header avatar, outside the chip) and would close
         the menu we just opened; opening on the next tick lets that handler pass first */
      if (nativeButton && typeof nativeButton.click === 'function') window.setTimeout(function () { nativeButton.click(); }, 0);
      else location.href = '/members/';
    });
  }

  function pollHeaderQuotes() {
    var header = el('#sml-global-header');
    if (!header) { if (headerQuoteTimer) clearInterval(headerQuoteTimer); return; }
    fetch(QUOTES_URL + '?symbols=' + encodeURIComponent(HEADER_SYMBOLS.join(',')), { cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('quotes unavailable'); return response.json(); })
      .then(function (payload) {
        var quotes = payload && payload.quotes ? payload.quotes : {};
        all('[data-gh-quote]', header).forEach(function (node) {
          var quote = quotes[node.getAttribute('data-gh-quote')];
          if (!quote) return;
          var field = node.getAttribute('data-field');
          var value = Number(quote[field]);
          if (!Number.isFinite(value)) return;
          if (field === 'last') node.textContent = '$' + (Math.abs(value) >= 1000 ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value.toFixed(2));
          else { node.textContent = (value >= 0 ? '▲ +' : '▼ ') + value.toFixed(2) + '%'; node.classList.toggle('is-up', value >= 0); node.classList.toggle('is-down', value < 0); }
        });
      }).catch(function () { /* Honest empty state remains —; never fabricate quotes. */ });
  }

  function bindLoopKick(header) {
    var button = el('#sml-hf-loop-kick', header);
    if (!button) return;
    document.body.classList.add('sml-gh-loop-kick-nav');
    function parts() { return { popup: el('#sml-loop-popup'), frame: el('#sml-loop-popup-frame') }; }
    function closeKick() { var item = parts(); if (!item.popup) return; item.popup.hidden = true; document.body.classList.remove('sml-loop-open'); button.setAttribute('aria-expanded', 'false'); }
    function openKick() {
      var item = parts();
      if (!item.popup) { var launcher = el('.sml-loop-launcher'); if (launcher) launcher.click(); return; }
      if (item.frame) { var src = item.frame.getAttribute('src'); var wanted = item.frame.dataset.src || src; if (!src && wanted) item.frame.setAttribute('src', wanted); }
      item.popup.hidden = false; document.body.classList.add('sml-loop-open'); button.setAttribute('aria-expanded', 'true');
    }
    button.addEventListener('click', function (event) { event.preventDefault(); var item = parts(); if (item.popup && !item.popup.hidden) closeKick(); else openKick(); });
    window.addEventListener('message', function (event) { var item = parts(); var data = event.data; if (item.frame && event.source === item.frame.contentWindow && data && data.type === 'sml-loop-kick:surface' && data.surface === 'closed') closeKick(); });
  }

  function mountEmbedTool() {
    document.body.classList.add('sml-embed-tool');
    /* the admin bar forces html{margin-top:32px!important} — cancel it */
    try { document.documentElement.style.setProperty('margin-top', '0', 'important'); } catch (e) {}
    replaceKnownHeader();
    if (!/\/analyst-dashboard\b/.test(location.pathname)) return;
    if (el('#sml-ets')) return;
    var bar = document.createElement('div');
    bar.id = 'sml-ets';
    bar.innerHTML = '<span class="mk" aria-hidden="true">\u2315</span>' +
      '<input type="search" autocomplete="off" spellcheck="false" aria-label="Search a stock ticker" placeholder="Search a stock ticker \u2014 the chart switches live">' +
      '<span class="lv">LIVE</span><div class="drop" hidden></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    var input = bar.querySelector('input'), drop = bar.querySelector('.drop');
    var t = null, ab = null;
    function closeDrop() { drop.hidden = true; drop.innerHTML = ''; }
    function apply(sym) {
      sym = String(sym || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
      if (!sym) return;
      var csym = document.getElementById('csym'), go = document.getElementById('csym-go');
      if (csym && go) {
        csym.value = sym;
        try { csym.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        go.click();
        bar.classList.add('flash'); setTimeout(function () { bar.classList.remove('flash'); }, 700);
      }
      input.value = '$' + sym;
      closeDrop();
    }
    function rows(list) {
      drop.innerHTML = list.map(function (x) {
        return '<button type="button" data-sym="' + attr(x.symbol) + '"><span class="sym">$' + esc(x.symbol) + '</span><span class="nm">' + esc(x.name || x.symbol) + '</span><span class="ex">' + esc([x.exchange, x.type].filter(Boolean).join(' \u00b7 ')) + '</span></button>';
      }).join('');
      drop.hidden = !list.length;
    }
    input.addEventListener('input', function () {
      clearTimeout(t);
      var q = input.value.trim().replace(/^\$/, '');
      if (q.length < 1) { closeDrop(); return; }
      t = setTimeout(function () {
        if (ab) ab.abort();
        ab = 'AbortController' in window ? new AbortController() : null;
        fetch(REST + '?q=' + encodeURIComponent(q), { credentials: 'same-origin', cache: 'no-store', signal: ab ? ab.signal : undefined })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var qs = (d && d.groups && Array.isArray(d.groups.quotes)) ? d.groups.quotes.slice(0, 8) : [];
            rows(qs);
          })
          .catch(function () {});
      }, 140); /* tickers only, near-instant */
    });
    input.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(drop.querySelectorAll('button'));
      var cur = items.indexOf(drop.querySelector('button.on'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur <= 0 ? items.length - 1 : cur - 1);
        items.forEach(function (b, i) { b.classList.toggle('on', i === next); });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var on = drop.querySelector('button.on') || drop.querySelector('button');
        if (on) apply(on.getAttribute('data-sym'));
        else apply(input.value.trim().replace(/^\$/, ''));
      } else if (e.key === 'Escape') { closeDrop(); }
    });
    drop.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-sym]');
      if (b) apply(b.getAttribute('data-sym'));
    });
    document.addEventListener('click', function (e) { if (!bar.contains(e.target)) closeDrop(); });
  }

  /* Analyst Dashboard / group Live Chart: while Detect is on, its floating
     "Pattern x of y" results card sits on top of the candles. When the card
     overlaps the chart plot it goes see-through so the candles stay readable,
     and solidifies again the moment the pointer (or keyboard focus) is on it. */
  function mountDetectFade() {
    if (!/\/analyst-dashboard\b/.test(location.pathname)) return;
    if (document.getElementById('sml-lct-fade-css')) return;
    var css = document.createElement('style');
    css.id = 'sml-lct-fade-css';
    css.textContent = '.sml-lct-results{transition:opacity .22s ease}' +
      '.sml-lct-results.sml-see-through{opacity:.16!important}' +
      '.sml-lct-results.sml-see-through:hover,.sml-lct-results.sml-see-through:focus-within,.sml-lct-results.sml-see-through.is-hover{opacity:1!important}';
    document.head.appendChild(css);
    function chartRect() {
      var best = null, area = 0;
      all('canvas').forEach(function (c) {
        var r = c.getBoundingClientRect();
        var a = r.width * r.height;
        if (a > area && r.width > 300 && r.height > 150) { area = a; best = r; }
      });
      return best;
    }
    function check() {
      var p = el('.sml-lct-results');
      if (!p || !p.offsetParent) return;
      if (!p.__smlFadeWired) {
        p.__smlFadeWired = true;
        p.addEventListener('mouseenter', function () { p.classList.add('is-hover'); });
        p.addEventListener('mouseleave', function () { p.classList.remove('is-hover'); });
      }
      var pr = p.getBoundingClientRect();
      var cr = chartRect();
      var overlaps = !!cr && pr.left < cr.right && pr.right > cr.left && pr.top < cr.bottom && pr.bottom > cr.top;
      p.classList.toggle('sml-see-through', overlaps);
    }
    setInterval(check, 500);
    window.addEventListener('scroll', check, true);
  }

  /* ---- ticker hover popover: hovering any tagged ticker ([data-tkpop]) in the
     rolling tape or the watchlist freezes in place and shows TODAY'S intraday
     chart (real /sml/v1/history 5m candles) in a floating glass card. Click
     anywhere on it -> that stock's Ticker Terminal. ---- */
  function mountTickerPop() {
    if (document.getElementById('sml-tkpop')) return;
    var css = document.createElement('style');
    css.textContent = '.sml-gh-tape:hover .sml-gh-tape-row{animation-play-state:paused}' +
      '#sml-tkpop{position:fixed;z-index:2147483000;width:310px;background:linear-gradient(168deg,rgba(16,24,35,.97),rgba(8,12,18,.98));border:1px solid rgba(0,255,136,.35);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.75),0 0 24px rgba(0,255,136,.08);padding:12px 14px 10px;opacity:0;transform:translateY(6px) scale(.97);pointer-events:none;transition:opacity .18s ease,transform .18s ease;cursor:pointer;backdrop-filter:blur(10px)}' +
      '#sml-tkpop.on{opacity:1;transform:none;pointer-events:auto}' +
      '#sml-tkpop .h{display:flex;align-items:baseline;gap:9px;margin-bottom:8px}' +
      '#sml-tkpop .sym{font:700 15px/1 Archivo,ui-sans-serif,sans-serif;color:#e6edf3}' +
      '#sml-tkpop .px{font:700 14px/1 "IBM Plex Mono",monospace}' +
      '#sml-tkpop .pc{font:600 11px/1 "IBM Plex Mono",monospace}' +
      '#sml-tkpop .up{color:#00e07a}#sml-tkpop .dn{color:#ff4757}' +
      '#sml-tkpop .tag{margin-left:auto;font:700 8px/1 "IBM Plex Mono",monospace;letter-spacing:.1em;color:#04060a;background:#00ff88;border-radius:9px;padding:3px 6px;box-shadow:0 0 8px rgba(0,255,136,.5)}' +
      '#sml-tkpop canvas{display:block;width:100%;height:110px;border-radius:8px}' +
      '#sml-tkpop .f{display:flex;justify-content:space-between;margin-top:7px;font:500 9px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
      '#sml-tkpop .msg{display:flex;align-items:center;justify-content:center;height:110px;font:500 10.5px/1.5 "IBM Plex Mono",monospace;color:#5d7085}';
    document.head.appendChild(css);
    var pop = document.createElement('div');
    pop.id = 'sml-tkpop';
    pop.innerHTML = '<div class="h"><span class="sym"></span><span class="px"></span><span class="pc"></span><span class="tag">TODAY</span></div><div class="wrap"><canvas width="282" height="110"></canvas></div><div class="f"><span class="lo"></span><span class="mid">Intraday · 5m · open terminal →</span><span class="hi"></span></div>';
    document.body.appendChild(pop);
    var cache = {}, curSym = '', hideT = null, gen = 0;
    function draw(bars) {
      var cv = pop.querySelector('canvas'), ctx = cv.getContext('2d');
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      if (!bars.length) return;
      var lo = Infinity, hi = -Infinity;
      bars.forEach(function (b) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; });
      var span = (hi - lo) || 1;
      var up = bars[bars.length - 1].c >= bars[0].o;
      var col = up ? '#00e07a' : '#ff4757';
      var x = function (i) { return bars.length > 1 ? i / (bars.length - 1) * (W - 4) + 2 : W / 2; };
      var y = function (v) { return 8 + (hi - v) / span * (H - 16); };
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, up ? 'rgba(0,224,122,.35)' : 'rgba(255,71,87,.35)');
      grad.addColorStop(1, 'rgba(8,12,18,0)');
      ctx.beginPath();
      ctx.moveTo(x(0), y(bars[0].c));
      for (var i = 1; i < bars.length; i++) ctx.lineTo(x(i), y(bars[i].c));
      ctx.lineTo(x(bars.length - 1), H); ctx.lineTo(x(0), H); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x(0), y(bars[0].c));
      for (i = 1; i < bars.length; i++) ctx.lineTo(x(i), y(bars[i].c));
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
      /* session open reference line */
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(143,163,181,.4)';
      ctx.beginPath(); ctx.moveTo(2, y(bars[0].o)); ctx.lineTo(W - 2, y(bars[0].o)); ctx.stroke(); ctx.restore();
      /* live dot */
      ctx.beginPath(); ctx.arc(x(bars.length - 1), y(bars[bars.length - 1].c), 3, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.arc(x(bars.length - 1), y(bars[bars.length - 1].c), 6, 0, Math.PI * 2);
      ctx.fillStyle = up ? 'rgba(0,224,122,.25)' : 'rgba(255,71,87,.25)'; ctx.fill();
      pop.querySelector('.lo').textContent = 'L ' + lo.toFixed(2);
      pop.querySelector('.hi').textContent = 'H ' + hi.toFixed(2);
      var last = bars[bars.length - 1].c, first = bars[0].o;
      var chg = last - first, pct = first ? chg / first * 100 : 0;
      pop.querySelector('.px').textContent = last.toFixed(2);
      pop.querySelector('.px').className = 'px ' + (up ? 'up' : 'dn');
      pop.querySelector('.pc').textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
      pop.querySelector('.pc').className = 'pc ' + (up ? 'up' : 'dn');
    }
    function msg(txt) {
      var w = pop.querySelector('.wrap');
      w.innerHTML = txt ? '<div class="msg">' + txt + '</div>' : '<canvas width="282" height="110"></canvas>';
    }
    function sessionBars(bars) {
      if (!bars.length) return [];
      var lastDay = new Date(bars[bars.length - 1].t).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
      return bars.filter(function (b) { return new Date(b.t).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === lastDay; });
    }
    function show(sym, rect) {
      curSym = sym; clearTimeout(hideT);
      pop.querySelector('.sym').textContent = '$' + sym;
      pop.querySelector('.px').textContent = ''; pop.querySelector('.pc').textContent = '';
      pop.querySelector('.lo').textContent = ''; pop.querySelector('.hi').textContent = '';
      var left = Math.max(8, Math.min(window.innerWidth - 318, rect.left + rect.width / 2 - 155));
      var top = rect.bottom + 8;
      if (top + 190 > window.innerHeight) top = rect.top - 198;
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
      pop.classList.add('on');
      var g = ++gen;
      var c = cache[sym];
      if (c && Date.now() - c.t < 60000) { msg(''); draw(c.bars); return; }
      msg('Loading intraday…');
      fetch('/wp-json/sml/v1/history?symbol=' + encodeURIComponent(sym) + '&tf=5m', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (g !== gen || curSym !== sym) return;
          var bars = sessionBars((d && d.bars) || []);
          if (!bars.length) { msg('No intraday candles for $' + sym + ' yet today.'); return; }
          cache[sym] = { bars: bars, t: Date.now() };
          msg(''); draw(bars);
        })
        .catch(function () { if (g === gen) msg('Intraday chart unavailable right now.'); });
    }
    function scheduleHide() { clearTimeout(hideT); hideT = setTimeout(function () { pop.classList.remove('on'); curSym = ''; }, 220); }
    document.addEventListener('mouseover', function (e) {
      var tk = e.target.closest ? e.target.closest('[data-tkpop]') : null;
      if (tk) { var sym = String(tk.getAttribute('data-tkpop') || '').toUpperCase(); if (sym && sym !== curSym) show(sym, tk.getBoundingClientRect()); else clearTimeout(hideT); return; }
      if (pop.contains(e.target)) { clearTimeout(hideT); return; }
      if (pop.classList.contains('on')) scheduleHide();
    });
    pop.addEventListener('click', function () { if (curSym) location.href = '/stock-chart/?symbol=' + encodeURIComponent(curSym); });
    /* hide only on PAGE scroll — capture-phase caught internal feed widgets
       auto-scrolling and killed the popover while the user was still hovering */
    window.addEventListener('scroll', function () { if (pop.classList.contains('on')) scheduleHide(); });
  }

  function build() {
    mountDetectFade();
    mountTickerPop();
    if (EMBED_TOOL) { mountEmbedTool(); return; }
    if (el('#sml-ss-panel')) return;
    mountGlobalHeader();
    var panel = document.createElement('div');
    panel.className = 'sml-ss-panel'; panel.id = 'sml-ss-panel';
    panel.innerHTML = '<section class="sml-ss-dialog" role="dialog" aria-label="StockMarketLoop search results">' +
      '<div class="sml-ss-head"><span class="sml-ss-mark" aria-hidden="true">⌕</span><strong id="sml-ss-query-label">Search results</strong><button class="sml-ss-close" type="button" aria-label="Close search results">✕</button></div>' +
      '<div class="sml-ss-tabs" role="tablist">' + [['all','All'],['quotes','Quotes'],['videos','Videos'],['news','News + Letters'],['people','People']].map(function (t) { return '<button type="button" class="sml-ss-tab' + (t[0] === 'all' ? ' is-active' : '') + '" data-tab="' + t[0] + '" role="tab">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="sml-ss-body" id="sml-ss-body"><div class="sml-ss-hint">Enter a ticker, company, video topic, article headline, or member name above.</div></div>' +
      '</section>';
    document.body.appendChild(panel);

    el('.sml-ss-close', panel).addEventListener('click', close);
    all('.sml-ss-tab', panel).forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    panel.addEventListener('click', function (e) { var intent = e.target.closest('[data-intent]'); if (intent) { e.preventDefault(); setTab(intent.getAttribute('data-intent')); } });
    document.addEventListener('keydown', keys, true);
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    bindExistingSearch();
    scheduleFallback();
    if (window.MutationObserver) {
      var pending = null;
      new MutationObserver(function () { if (pending) return; pending = setTimeout(function () { pending = null; bindExistingSearch(); scheduleFallback(); }, 180); }).observe(document.body, { childList: true, subtree: true });
    }
  }

  function searchInputs() {
    return all('input[placeholder*="Search a ticker" i], input[aria-label="Search ticker" i]').filter(function (node) {
      return !node.closest('#sml-ss-panel') && node.id !== 'sml-hf-watch-inp';
    });
  }

  function bindExistingSearch() {
    searchInputs().forEach(function (input) {
      // Use a versioned ownership marker. Older search builds and other home
      // modules used data-sml-ss-bound, which could make a newly rendered
      // input look connected even though this engine had no listeners on it.
      if (input.dataset.smlSsV2Bound) return;
      input.dataset.smlSsV2Bound = '1';
      input.dataset.smlSsBound = '1';
      input.setAttribute('autocomplete', 'off');
      input.addEventListener('focus', function () { open(input); });
      input.addEventListener('click', function () { open(input); });
      input.addEventListener('input', function () { open(input); queue(input.value); });
      var form = input.closest('form');
      if (form && !form.dataset.smlSsV2Bound) {
        form.dataset.smlSsV2Bound = '1';
        form.dataset.smlSsBound = '1';
        form.addEventListener('submit', function (e) { e.preventDefault(); open(input); queue(input.value, true); });
      }
    });
  }

  function scheduleFallback() {
    if (state.fallbackTimer || searchInputs().some(visible) || el('#sml-ss-global-host')) return;
    state.fallbackTimer = setTimeout(function () {
      state.fallbackTimer = null;
      if (searchInputs().some(visible) || el('#sml-ss-global-host')) return;
      var host = document.createElement('div');
      host.className = 'sml-ss-global-host'; host.id = 'sml-ss-global-host';
      host.innerHTML = '<span aria-hidden="true">⌕</span><input type="search" aria-label="Search ticker" placeholder="Search a ticker, e.g. NVDA">';
      document.body.appendChild(host);
      bindExistingSearch();
    }, 700);
  }

  function open(input) {
    var panel = el('#sml-ss-panel'); if (!panel || !input) return;
    state.anchor = input;
    panel.classList.add('is-open');
    reposition();
    var q = String(input.value || '').trim();
    el('#sml-ss-query-label').textContent = q ? 'Results for “' + q + '”' : 'Search StockMarketLoop';
    if (q.length >= 2) queue(q, true);
  }

  function reposition() {
    var panel = el('#sml-ss-panel');
    if (!panel || !panel.classList.contains('is-open') || !state.anchor || !visible(state.anchor)) return;
    var r = state.anchor.getBoundingClientRect();
    var width = Math.min(920, Math.max(320, window.innerWidth - 24));
    var left = Math.max(12, Math.min(window.innerWidth - width - 12, (r.left + r.width / 2) - width / 2));
    var top = Math.min(window.innerHeight - 180, r.bottom + 9);
    panel.style.width = width + 'px'; panel.style.left = left + 'px'; panel.style.top = top + 'px';
    panel.style.setProperty('--sml-ss-max-height', Math.max(170, window.innerHeight - top - 12) + 'px');
  }

  function close() {
    var panel = el('#sml-ss-panel'); if (!panel) return;
    panel.classList.remove('is-open');
    if (state.abort) state.abort.abort();
  }

  function outside(e) {
    var panel = el('#sml-ss-panel');
    if (!panel || !panel.classList.contains('is-open')) return;
    if (panel.contains(e.target) || e.target === state.anchor || (e.target.closest && e.target.closest('#sml-ss-global-host'))) return;
    close();
  }

  function keys(e) {
    var panel = el('#sml-ss-panel');
    var openNow = panel && panel.classList.contains('is-open');
    if (e.key === '/' && !openNow && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) {
      var target = searchInputs().filter(visible)[0];
      if (target) { e.preventDefault(); target.focus(); open(target); }
      return;
    }
    if (!openNow) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); if (state.anchor) state.anchor.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var items = all('.sml-ss-body a[href]:not([hidden]),.sml-ss-body button:not([hidden])'); if (!items.length) return;
      var i = items.indexOf(document.activeElement); i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1); e.preventDefault(); items[i].focus();
    }
  }

  function queue(q, immediate) {
    clearTimeout(state.timer);
    q = String(q || '').trim();
    el('#sml-ss-query-label').textContent = q ? 'Results for “' + q + '”' : 'Search StockMarketLoop';
    if (q.length < 2) { state.data = null; el('#sml-ss-body').innerHTML = '<div class="sml-ss-hint">Enter at least 2 characters. Search by ticker, company, topic, headline, display name, or @handle.</div>'; return; }
    state.timer = setTimeout(function () { run(q); }, immediate ? 0 : 240);
  }

  function run(q) {
    if (state.abort) state.abort.abort();
    state.abort = 'AbortController' in window ? new AbortController() : null;
    el('#sml-ss-body').innerHTML = '<div class="sml-ss-loading">Searching StockMarketLoop</div>';
    fetch(REST + '?q=' + encodeURIComponent(q), { credentials: 'same-origin', cache: 'no-store', signal: state.abort ? state.abort.signal : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || 'Search failed.'); return j; }); })
      .then(function (data) { state.data = data || {}; render(); })
      .catch(function (e) { if (e.name !== 'AbortError') el('#sml-ss-body').innerHTML = '<div class="sml-ss-error">' + esc(e.message || 'Search failed.') + '</div>'; });
  }

  function setTab(tab) {
    state.tab = tab || 'all';
    all('.sml-ss-tab').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === state.tab); });
    if (state.data) render();
  }

  function cardQuote(x) { return '<a class="sml-ss-card sml-ss-card--quote" href="' + attr(x.terminal_url || ('/stock-chart/?symbol=' + encodeURIComponent(x.symbol || ''))) + '"><span class="sml-ss-symbol">$' + esc(x.symbol) + '</span><span class="sml-ss-copy"><span class="sml-ss-name">' + esc(x.name || x.symbol) + '</span><span class="sml-ss-meta">' + esc([x.exchange,x.type].filter(Boolean).join(' · ')) + '</span></span></a>'; }
  function cardVideo(x) { return '<a class="sml-ss-card" href="' + attr(x.url) + '">' + (x.thumbnail ? '<img src="' + attr(x.thumbnail) + '" alt="" loading="lazy">' : '') + '<span class="sml-ss-copy"><span class="sml-ss-name">' + esc(x.title || 'Video') + '</span><span class="sml-ss-meta">' + esc([x.ticker ? '$' + x.ticker : '',x.creator,x.duration,x.views].filter(Boolean).join(' · ')) + '</span></span></a>'; }
  function cardNews(x, letter) { return '<a class="sml-ss-card" href="' + attr(x.url) + '">' + (x.image ? '<img src="' + attr(x.image) + '" alt="" loading="lazy">' : '') + '<span class="sml-ss-copy"><span class="sml-ss-name">' + esc(x.title || (letter ? 'Loop Letter' : 'Article')) + '</span><span class="sml-ss-meta">' + esc([letter ? 'Loop Letter' : 'News',x.author,x.date].filter(Boolean).join(' · ')) + '</span></span></a>'; }
  function cardPerson(x) { return '<a class="sml-ss-card sml-ss-card--person" href="' + attr(x.url) + '"><img src="' + attr(x.avatar || '') + '" alt="" loading="lazy"><span class="sml-ss-copy"><span class="sml-ss-name">' + esc(x.name || x.handle) + '</span><span class="sml-ss-meta">@' + esc(x.handle) + '</span></span></a>'; }
  function section(key, title, rows, renderer) {
    var show = state.tab === 'all' || state.tab === key || (state.tab === 'news' && key === 'letters');
    return '<section class="sml-ss-section" data-section="' + key + '"' + (show ? '' : ' hidden') + '><h2 class="sml-ss-title">' + title + '<span class="sml-ss-count">' + rows.length + '</span></h2>' + (rows.length ? '<div class="sml-ss-grid">' + rows.map(renderer).join('') + '</div>' : '<div class="sml-ss-empty">No matching ' + title.toLowerCase() + ' found.</div>') + '</section>';
  }

  function render() {
    var d = state.data || {}, g = d.groups || {}, sym = d.symbol || '';
    var intents = sym ? '<div class="sml-ss-intents"><a class="sml-ss-intent" href="/stock-chart/?symbol=' + encodeURIComponent(sym) + '"><b>$' + esc(sym) + ' Quote</b><span>OPEN TICKER TERMINAL</span></a><button class="sml-ss-intent" data-intent="videos"><b>$' + esc(sym) + ' Videos</b><span>LATEST WATCH PAGES</span></button><button class="sml-ss-intent" data-intent="news"><b>$' + esc(sym) + ' News</b><span>ARTICLES + LOOP LETTERS</span></button><button class="sml-ss-intent" data-intent="people"><b>People</b><span>NAMES + @HANDLES</span></button></div>' : '';
    el('#sml-ss-body').innerHTML = intents +
      section('quotes','Quotes',g.quotes || [],cardQuote) +
      section('videos','Videos',g.videos || [],cardVideo) +
      section('news','News articles',g.news || [],function (x) { return cardNews(x,false); }) +
      section('letters','Loop Letters',g.letters || [],function (x) { return cardNews(x,true); }) +
      section('people','People',g.people || [],cardPerson);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
}());
