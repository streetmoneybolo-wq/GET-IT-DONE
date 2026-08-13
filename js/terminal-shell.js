/*!
 * SML Ticker Terminal V2 — Phase 1 shell view.
 * Builds the Direction B layout scaffold into #sml-tv2-root and wires it to the
 * SMLTerminalV2 controller. PHASE 1 = structure only: header + symbol search +
 * tabs + 3-column grid with LABELED, EMPTY slots. No market data is rendered here
 * — Phase 2 adapters mount the existing modules into these slots. Renders only
 * when the WPCode snippet injected the root (admin + ?tv2=1).
 */
(function () {
  'use strict';
  function boot() {
    var root = document.getElementById('sml-tv2-root');
    var T = window.SMLTerminalV2;
    if (!root || !T || root.getAttribute('data-built')) return;
    root.setAttribute('data-built', '1');

    var TABS = [
      { id: 'overview', label: 'Overview' },
      { id: 'options', label: 'Options' },
      { id: 'research', label: 'Research' },
      { id: 'news', label: 'News' },
    ];
    // slot(name, note) -> a labeled placeholder a Phase 2 adapter will mount into.
    function slot(name, note, tab) {
      return '<div class="tv2-slot" data-slot="' + name + '"' + (tab ? ' data-tab="' + tab + '"' : '') +
        '><span class="tv2-slot-tag">' + name + '</span>' +
        '<span class="tv2-slot-note">' + (note || 'module mounts here') + '</span></div>';
    }

    root.className = 'tv2';
    root.innerHTML =
      // ---- header ----
      '<header class="tv2-head">' +
        '<a class="tv2-brand" href="/stock-chart/">TERMINAL</a>' +
        '<form class="tv2-search" role="search"><input id="tv2-search-input" type="text" autocomplete="off" ' +
          'placeholder="Search a ticker — e.g. NVDA" aria-label="Search ticker"></form>' +
        '<div class="tv2-watchstrip" data-slot="watchlist-strip">' + slot('watchlist', 'watchlist strip') + '</div>' +
        '<button class="tv2-add" type="button" data-slot="add-watchlist">+ Watchlist</button>' +
      '</header>' +
      // ---- identity + quote stats ----
      '<div class="tv2-identity">' +
        '<div class="tv2-id-main">' + slot('symbol-identity', 'symbol · company') + '</div>' +
        '<div class="tv2-id-price">' + slot('price', 'price · change') + '</div>' +
        '<div class="tv2-id-stats">' + slot('quote-stats', 'vol · vwap · bid/ask · spread') + '</div>' +
      '</div>' +
      // ---- tabs ----
      '<div class="tv2-tabs" role="tablist" aria-label="Terminal sections">' +
        TABS.map(function (t) {
          return '<button class="tv2-tab" role="tab" id="tv2-tab-' + t.id + '" aria-controls="tv2-panel-' + t.id +
            '" aria-selected="false" tabindex="-1" data-tab="' + t.id + '">' + t.label + '</button>';
        }).join('') +
      '</div>' +
      // ---- body: rail | workspace | context ----
      '<div class="tv2-body">' +
        '<nav class="tv2-rail" aria-label="Quick tools">' + slot('rail', 'tools rail') + '</nav>' +
        '<main class="tv2-work">' +
          '<section class="tv2-panel" id="tv2-panel-overview" role="tabpanel" aria-labelledby="tv2-tab-overview">' +
            slot('chart', 'live chart · intervals · drawings', 'overview') +
            slot('market-position', 'market position overview', 'overview') +
            slot('news-cards', 'related coverage', 'overview') +
          '</section>' +
          '<section class="tv2-panel" id="tv2-panel-options" role="tabpanel" aria-labelledby="tv2-tab-options" hidden>' +
            slot('options-chain', 'options chain · greeks · expiries', 'options') +
          '</section>' +
          '<section class="tv2-panel" id="tv2-panel-research" role="tabpanel" aria-labelledby="tv2-tab-research" hidden>' +
            slot('research', 'financials · filings · splits · earnings', 'research') +
          '</section>' +
          '<section class="tv2-panel" id="tv2-panel-news" role="tabpanel" aria-labelledby="tv2-tab-news" hidden>' +
            slot('news', 'ticker news stream', 'news') +
          '</section>' +
        '</main>' +
        '<aside class="tv2-context" aria-label="Context">' +
          slot('quotes', 'live quotes') +
          slot('sentiment', 'terminal sentiment') +
          slot('alerts', 'alert box') +
          slot('voice', 'live trading room') +
          slot('videos', 'recent videos') +
          slot('sponsored', 'sponsored') +
        '</aside>' +
      '</div>' +
      // ---- lower strip ----
      '<div class="tv2-lower">' + slot('heatmap', 'ticker heat map') + slot('feed', 'live ticker feed') + '</div>' +
      '<div class="tv2-preview-note">Phase 1 preview — layout &amp; symbol controller only. Slots are empty until Phase 2 mounts the live modules. Public terminal is unaffected.</div>';

    // ---- wire the tabs to the controller (with keyboard support) ----
    var tabEls = [].slice.call(root.querySelectorAll('.tv2-tab'));
    function activate(id, focus) {
      tabEls.forEach(function (b) {
        var on = b.getAttribute('data-tab') === id;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        var panel = document.getElementById('tv2-panel-' + b.getAttribute('data-tab'));
        if (panel) panel.hidden = !on;
        if (on && focus) b.focus();
      });
      T.showTab(id);
    }
    tabEls.forEach(function (b, i) {
      b.addEventListener('click', function () { activate(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = tabEls[(i + 1) % tabEls.length];
        else if (e.key === 'ArrowLeft') n = tabEls[(i - 1 + tabEls.length) % tabEls.length];
        else if (e.key === 'Home') n = tabEls[0];
        else if (e.key === 'End') n = tabEls[tabEls.length - 1];
        if (n) { e.preventDefault(); activate(n.getAttribute('data-tab'), true); }
      });
    });

    // ---- wire symbol search to the controller ----
    var form = root.querySelector('.tv2-search');
    var input = root.querySelector('#tv2-search-input');
    if (form && input) {
      input.value = T.symbol;
      form.addEventListener('submit', function (e) { e.preventDefault(); if (input.value.trim()) T.setSymbol(input.value); });
    }
    // reflect symbol changes from anywhere back into the field
    T.on('symbol', function (ctx) { if (input && document.activeElement !== input) input.value = ctx.symbol; });

    activate('overview');

    // ---- Phase 2: relocate EXISTING live modules into the V2 slots ----
    // We move the already-booted element by id (it keeps its own IDs, listeners,
    // data connections). One instance only; the legacy #sml-ws stays hidden as the
    // safety net until every mount is verified. No new data connection is opened.
    function fillSlot(slotName, sourceId) {
      var slot = root.querySelector('.tv2-slot[data-slot="' + slotName + '"]');
      var src = document.getElementById(sourceId);
      if (!slot || !src) return false;
      if (slot.contains(src)) return true;      // already mounted — idempotent
      slot.innerHTML = '';                       // drop the Phase 1 placeholder
      slot.classList.add('tv2-slot-filled');
      slot.appendChild(src);
      return true;
    }
    var MOUNTS = [
      ['chart', 'sml-tv-chart'], ['market-position', 'sml-mp'], ['heatmap', 'sml-terminal-heatmap'],
      ['quotes', 'sml-side-quotes'], ['alerts', 'sml-side-alerts'], ['videos', 'sml-side-videos'],
      ['sponsored', 'sml-ad-slot'], ['voice', 'live-voice-room'], ['feed', 'sml-lf'],
      ['options-chain', 'sml-opt-host'], ['research', 'sml-side-profile'],
    ];
    function mountModules() {
      var done = 0;
      MOUNTS.forEach(function (p) { if (fillSlot(p[0], p[1])) done++; });
      // charts/canvases were sized while inside the hidden #sml-ws — force a re-measure.
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      return done;
    }
    // Modules boot at different times; re-run a few times to catch late ones, then stop.
    mountModules();
    [350, 900, 1800, 3200].forEach(function (t) { setTimeout(mountModules, t); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
