/* StockMarketLoop site-wide search: one header field, grouped live results. */
(function () {
  'use strict';
  if (window.__smlSiteSearchBooted) return;
  window.__smlSiteSearchBooted = true;

  var CFG = window.SML_SITE_SEARCH || {};
  var REST = CFG.rest || '/wp-json/sml-site-search/v1/search';
  var state = { tab: 'all', data: null, timer: null, abort: null, anchor: null, fallbackTimer: null };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function attr(v) { return esc(v); }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function visible(node) { return !!(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length)); }

  function build() {
    if (el('#sml-ss-panel')) return;
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
