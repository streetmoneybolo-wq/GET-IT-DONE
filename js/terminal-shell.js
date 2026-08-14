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

    // ---- integrate with the LIVE terminal (verified approach, no DOM moves) ----
    // The legacy terminal (.sml-terminal > .sml-pro-*) already has the Direction B
    // structure: tabs + chart + rails. The chart is a LoopCharts canvas (and a
    // hidden TradingView IFRAME fallback) — moving either kills them. So V2 sits
    // ABOVE the legacy terminal, its tabs PROXY the legacy .sml-pro-tabs buttons
    // (all lazy-mount logic stays the legacy code's), and CSS re-skins in place.
    var PROXY = { overview: 'overview', options: 'options', research: 'research', news: 'news' };
    var legacyTabs = {};
    var integrated = false;
    // The legacy terminal renders after DOMContentLoaded — poll for it (up to ~12s)
    // and only integrate (and only hide its tab bar) once it actually exists.
    var tryInt = 0;
    var intTimer = setInterval(function () {
      var legacyTerm = document.querySelector('.sml-terminal');
      var btns = document.querySelectorAll('.sml-pro-tabs button');
      if (legacyTerm && btns.length) {
        clearInterval(intTimer);
        [].forEach.call(btns, function (b) { legacyTabs[(b.textContent || '').trim().toLowerCase()] = b; });
        legacyTerm.parentNode.insertBefore(root, legacyTerm); // root has no iframes — safe to place
        root.classList.add('tv2-integrated');                  // collapse V2's empty slots
        document.body.classList.add('tv2-integrated-on');      // NOW hide legacy tab bar + re-skin
        integrated = true;
        // Fix the legacy overflow (shell renders wider than its container and gets
        // clipped, hiding "Trader sentiment"). Inline !important because a legacy
        // stylesheet rule of equal weight loads later and beats external CSS.
        [['.sml-shell'], ['.sml-pro-terminal'], ['.sml-pro-quote']].forEach(function (s) {
          var el = document.querySelector(s[0]);
          if (el) { el.style.setProperty('width', '100%', 'important'); el.style.setProperty('max-width', '100%', 'important'); el.style.setProperty('min-width', '0', 'important'); }
        });
        var pq = document.querySelector('.sml-pro-quote');
        if (pq) pq.style.setProperty('overflow-x', 'auto', 'important'); // safety valve on narrow screens
        try { window.dispatchEvent(new Event('resize')); } catch (e) {}  // let the chart re-measure
        // Direction B's slim left rail: tab shortcuts + jump-to-section anchors.
        if (!document.getElementById('sml-tv2-rail')) {
          var rail = document.createElement('nav'); rail.id = 'sml-tv2-rail'; rail.setAttribute('aria-label', 'Terminal shortcuts');
          var items = [
            ['OVR', 'tab', 'overview'], ['OPT', 'tab', 'options'], ['RES', 'tab', 'research'], ['NWS', 'tab', 'news'],
            ['MP', 'goto', 'sml-mp'], ['FEED', 'goto', 'sml-lf'], // HEAT removed — heat map retired from the terminal
          ];
          items.forEach(function (it) {
            var b = document.createElement('button'); b.type = 'button'; b.textContent = it[0];
            b.setAttribute('data-rail', it[1] + ':' + it[2]);
            b.addEventListener('click', function () {
              if (it[1] === 'tab') { var t = root.querySelector('.tv2-tab[data-tab="' + it[2] + '"]'); if (t) t.click(); }
              else { var el = document.getElementById(it[2]); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
            });
            rail.appendChild(b);
          });
          document.body.appendChild(rail);
          T.on('tab', function (id) {
            [].forEach.call(rail.querySelectorAll('button'), function (b) {
              b.classList.toggle('on', b.getAttribute('data-rail') === 'tab:' + id);
            });
          });
          var first = rail.querySelector('button'); if (first) first.classList.add('on');
        }
        // sync the legacy's active view with whatever V2 tab is selected
        var cur = root.querySelector('.tv2-tab[aria-selected="true"]');
        if (cur) { var lb = legacyTabs[PROXY[cur.getAttribute('data-tab')]]; if (lb) { try { lb.click(); } catch (e) {} } }
      } else if (++tryInt > 40) { clearInterval(intTimer); } // give up gracefully — plain shell remains
    }, 300);

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
      // drive the legacy view (programmatic .click() works even when the bar is hidden)
      if (integrated) { var lb = legacyTabs[PROXY[id]]; if (lb) { try { lb.click(); } catch (e) {} } }
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
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = String(input.value || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
        if (!v) return;
        if (integrated) {
          // The legacy terminal is server-keyed to ?symbol= — navigate (keeping the
          // preview flag) so every module re-renders through its own real path.
          try { var u = new URL(location.href); u.searchParams.set('symbol', v); u.searchParams.set('tv2', '1'); location.href = u.toString(); return; } catch (err) {}
        }
        T.setSymbol(v);
      });
    }
    // reflect symbol changes from anywhere back into the field
    T.on('symbol', function (ctx) { if (input && document.activeElement !== input) input.value = ctx.symbol; });

    activate('overview');
    // Phase 2 module relocation intentionally removed pending a safer, verified,
    // one-module-at-a-time approach. Phase 1 shell renders empty slots only.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
