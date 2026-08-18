/* StockMarketLoop site-wide search: Quotes, Videos, News + Loop Letters, People. */
(function () {
  'use strict';
  if (window.__smlSiteSearchBooted) return;
  window.__smlSiteSearchBooted = true;

  var CFG = window.SML_SITE_SEARCH || {};
  var REST = CFG.rest || '/wp-json/sml-site-search/v1/search';
  var state = { tab: 'all', data: null, timer: null, abort: null, lastFocus: null };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function attr(v) { return esc(v); }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function plain(v) { var d = document.createElement('div'); d.innerHTML = String(v || ''); return (d.textContent || '').trim(); }

  function build() {
    if (el('#sml-ss-overlay')) return;
    var trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'sml-ss-trigger'; trigger.id = 'sml-ss-trigger';
    trigger.setAttribute('aria-label', 'Search StockMarketLoop');
    trigger.innerHTML = '<span aria-hidden="true">⌕</span><span>Search SML</span><kbd>/</kbd>';
    document.body.appendChild(trigger);

    var overlay = document.createElement('div'); overlay.className = 'sml-ss-overlay'; overlay.id = 'sml-ss-overlay';
    overlay.innerHTML = '<section class="sml-ss-dialog" role="dialog" aria-modal="true" aria-label="Search StockMarketLoop">' +
      '<div class="sml-ss-head"><span class="sml-ss-mark" aria-hidden="true">⌕</span><input class="sml-ss-input" id="sml-ss-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search a ticker, video, article, Letter, or person…" aria-label="Search StockMarketLoop"><button class="sml-ss-close" type="button" aria-label="Close search">✕</button></div>' +
      '<div class="sml-ss-tabs" role="tablist">' + [['all','All'],['quotes','Quotes'],['videos','Videos'],['news','News + Letters'],['people','People']].map(function (t) { return '<button type="button" class="sml-ss-tab' + (t[0] === 'all' ? ' is-active' : '') + '" data-tab="' + t[0] + '" role="tab">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="sml-ss-body" id="sml-ss-body"><div class="sml-ss-hint">Try <b>$AMC</b>, a company name, video topic, article headline, or member handle.</div></div>' +
      '</section>';
    document.body.appendChild(overlay);

    trigger.addEventListener('click', function () { open(''); });
    el('.sml-ss-close', overlay).addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    el('#sml-ss-input').addEventListener('input', function () { queue(this.value); });
    all('.sml-ss-tab', overlay).forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    overlay.addEventListener('click', function (e) { var intent = e.target.closest('[data-intent]'); if (intent) { e.preventDefault(); setTab(intent.getAttribute('data-intent')); } });
    document.addEventListener('keydown', keys, true);
    bindExistingSearch();
    if (window.MutationObserver) {
      var pending = null;
      new MutationObserver(function () { if (pending) return; pending = setTimeout(function () { pending = null; bindExistingSearch(); }, 180); }).observe(document.body, { childList: true, subtree: true });
    }
  }

  function bindExistingSearch() {
    all('input[placeholder*="Search a ticker" i], .slw-search').forEach(function (node) {
      if (node.closest('#sml-ss-overlay') || node.id === 'sml-hf-watch-inp' || node.dataset.smlSsBound) return;
      node.dataset.smlSsBound = '1';
      var input = node.matches('input') ? node : node.querySelector('input');
      node.addEventListener('click', function (e) { e.preventDefault(); open(input ? input.value : ''); });
      if (input) {
        input.addEventListener('focus', function () { open(input.value); });
        var form = input.closest('form'); if (form && !form.dataset.smlSsBound) { form.dataset.smlSsBound = '1'; form.addEventListener('submit', function (e) { e.preventDefault(); open(input.value); }); }
      }
    });
  }

  function open(seed) {
    var overlay = el('#sml-ss-overlay'); if (!overlay) return;
    state.lastFocus = document.activeElement;
    overlay.classList.add('is-open'); document.documentElement.classList.add('sml-ss-lock');
    var input = el('#sml-ss-input'); input.value = seed || input.value || ''; input.focus(); input.select();
    if (input.value.trim().length >= 2) queue(input.value, true);
  }
  function close() {
    var overlay = el('#sml-ss-overlay'); if (!overlay) return;
    overlay.classList.remove('is-open'); document.documentElement.classList.remove('sml-ss-lock');
    if (state.abort) state.abort.abort();
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) {} }
  }
  function keys(e) {
    var openNow = el('#sml-ss-overlay') && el('#sml-ss-overlay').classList.contains('is-open');
    if (!openNow && e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) { e.preventDefault(); open(''); return; }
    if (!openNow) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var items = all('.sml-ss-body a[href]:not([hidden]),.sml-ss-body button:not([hidden])'); if (!items.length) return;
      var i = items.indexOf(document.activeElement); i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1); e.preventDefault(); items[i].focus();
    }
  }

  function queue(q, immediate) {
    clearTimeout(state.timer);
    q = String(q || '').trim();
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
    var d = state.data || {}, g = d.groups || {}, sym = d.symbol || String(d.query || '').replace(/^\$/,'').toUpperCase();
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
