/*!
 * SML Ticker Terminal V2 — shared symbol/session controller (Phase 1 shell).
 * Orchestration ONLY. Owns: the single normalized symbol, a monotonic request
 * generation, market-session state, the tab lifecycle, and an adapter registry
 * that existing modules mount into. It renders NO market data itself — every
 * value comes from the existing plugin modules (Phase 2 wires them in).
 *
 * Public surface: window.SMLTerminalV2
 *   .symbol / .requestVersion / .session / .source / .freshness / .adapters
 *   .setSymbol(sym)            switch symbols (bumps version, aborts, broadcasts)
 *   .on(evt, cb) / .off / .emit
 *   .guard(version)            true if a response for `version` is still current
 *   .signal()                  AbortSignal for the current generation
 *   .registerAdapter(name, a)  a = { mount, onSymbol, onShow, onHide }
 *   .showTab(id) / .activeTab
 *   .setSource(src, freshness) / .setSession(s)
 */
(function () {
  'use strict';
  if (window.SMLTerminalV2 && window.SMLTerminalV2.__ready) return;

  function normalizeSymbol(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
  }
  function symbolFromUrl() {
    try { return normalizeSymbol(new URLSearchParams(location.search).get('symbol') || ''); } catch (e) { return ''; }
  }

  // Market session in America/New_York, without pulling a tz library.
  function sessionNow() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour12: false,
        weekday: 'short', hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date());
      var map = {}; parts.forEach(function (p) { map[p.type] = p.value; });
      var dow = map.weekday; var mins = (parseInt(map.hour, 10) * 60) + parseInt(map.minute, 10);
      if (dow === 'Sat' || dow === 'Sun') return 'closed';
      if (mins >= 240 && mins < 570) return 'premarket';     // 04:00–09:30
      if (mins >= 570 && mins < 960) return 'regular';        // 09:30–16:00
      if (mins >= 960 && mins < 1200) return 'afterhours';    // 16:00–20:00
      return 'closed';
    } catch (e) { return 'regular'; }
  }

  var listeners = {};
  var adapters = {};
  var abort = null;

  var T = {
    __ready: true,
    symbol: symbolFromUrl() || 'SPY',
    requestVersion: 1,
    session: sessionNow(),
    source: 'unavailable',      // moomoo | massive | cached | unavailable
    freshness: {},              // per-feed: { ts, stale }
    adapters: adapters,
    activeTab: null,

    on: function (evt, cb) { (listeners[evt] || (listeners[evt] = [])).push(cb); return T; },
    off: function (evt, cb) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(function (f) { return f !== cb; }); return T; },
    emit: function (evt, data) { (listeners[evt] || []).forEach(function (f) { try { f(data); } catch (e) { /* isolate */ } }); return T; },

    // A response is still current only if its captured version matches the latest.
    guard: function (version) { return version === T.requestVersion; },
    signal: function () { return abort ? abort.signal : undefined; },

    setSymbol: function (raw) {
      var sym = normalizeSymbol(raw);
      if (!sym || sym === T.symbol) return T.symbol;
      T.symbol = sym;
      T.requestVersion += 1;              // invalidate every in-flight response
      if (abort) { try { abort.abort(); } catch (e) {} }
      abort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      T.source = 'unavailable'; T.freshness = {};
      var ctx = { symbol: sym, version: T.requestVersion, session: T.session };
      // Notify visible adapters to re-request; hidden ones refresh on show.
      Object.keys(adapters).forEach(function (name) {
        var a = adapters[name];
        if (a && typeof a.onSymbol === 'function' && (!a.__tab || a.__tab === T.activeTab || a.__persistent)) {
          try { a.onSymbol(ctx); } catch (e) {}
        }
      });
      T.emit('symbol', ctx);
      // keep the URL shareable without a reload
      try {
        var u = new URL(location.href);
        if (/^\/stocks\/[a-z0-9.\-]{1,12}\/?$/i.test(u.pathname)) {
          /* entity pages: the symbol lives in the PATH — switch the path, keep it clean */
          u.pathname = '/stocks/' + String(sym).toLowerCase() + '/';
          u.searchParams.delete('symbol');
        } else {
          u.searchParams.set('symbol', sym);
        }
        history.replaceState(null, '', u);
      } catch (e) {}
      return sym;
    },

    setSource: function (src, freshness) { T.source = src || 'unavailable'; if (freshness) T.freshness = freshness; T.emit('source', { source: T.source, freshness: T.freshness }); return T; },
    setSession: function (s) { if (s && s !== T.session) { T.session = s; T.emit('session', s); } return T; },

    registerAdapter: function (name, a) {
      if (!name || !a) return;
      adapters[name] = a;
      var ctx = { symbol: T.symbol, version: T.requestVersion, session: T.session };
      try { if (typeof a.mount === 'function') a.mount(ctx); } catch (e) {}
      return a;
    },

    // Tab lifecycle: lazy-mount on first show, refresh stale on return, pause hidden.
    showTab: function (id) {
      if (T.activeTab === id) return;
      var prev = T.activeTab; T.activeTab = id;
      Object.keys(adapters).forEach(function (name) {
        var a = adapters[name]; if (!a || a.__tab == null) return;
        if (a.__tab === id) {
          if (!a.__mounted && typeof a.mount === 'function') { try { a.mount({ symbol: T.symbol, version: T.requestVersion, session: T.session }); a.__mounted = true; } catch (e) {} }
          if (typeof a.onShow === 'function') { try { a.onShow({ symbol: T.symbol, version: T.requestVersion, session: T.session }); } catch (e) {} }
        } else if (a.__tab === prev && typeof a.onHide === 'function') {
          try { a.onHide(); } catch (e) {}
        }
      });
      T.emit('tab', id);
    },
  };

  // Keep session state fresh (drives the closed-market "frozen value" rule).
  setInterval(function () { T.setSession(sessionNow()); }, 30000);
  // Pause background work when the whole tab is hidden.
  document.addEventListener('visibilitychange', function () { T.emit(document.hidden ? 'pause' : 'resume'); });

  window.SMLTerminalV2 = T;
})();
