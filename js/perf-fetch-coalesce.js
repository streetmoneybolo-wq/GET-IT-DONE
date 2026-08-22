/*!
 * SML Performance — GET request coalescing.
 *
 * Measured live, 2026-08-22: on the ticker terminal, groups pages, and profile
 * pages, the SAME endpoint (quote, ticker-alerts, group/roster, group/watchlist,
 * the Loop Bucks header widget's leaderboard/gates/earn/me calls, uads-event)
 * is fetched 2-5 times within a ~500ms-1.5s window by independent scripts that
 * don't know about each other (some are in this repo, several are legacy
 * plugin code with no visibility into their source). Each of those calls pays
 * a real ~1.8-2.9s backend cold-cache cost (server-timing confirms it; see
 * [[performance-investigation]] memory) — so N duplicate concurrent calls to
 * the same URL cost N times the latency for the exact same data.
 *
 * This wraps window.fetch so that while a GET request to a given URL is
 * in-flight, any OTHER caller requesting the exact same URL gets the SAME
 * response instead of firing a second network request. Once the first
 * request settles, the entry clears — a later, genuinely-new poll cycle to
 * the same URL still fires its own real request. Only GETs are ever
 * coalesced; anything with side effects (POST/PUT/PATCH/DELETE) always
 * fires as its own independent request, unmodified.
 *
 * Must load BEFORE any other script that calls fetch — see the loader
 * snippet's placement (early <head>, not deferred).
 *
 * WPCode: served from CDN, injected by wpcode/perf-coalesce-loader.php.
 */
(function () {
  'use strict';
  if (window.__smlFetchCoalesced || typeof window.fetch !== 'function') return;
  window.__smlFetchCoalesced = true;

  var native = window.fetch.bind(window);
  var inflight = Object.create(null); // url -> Promise<Response> (of a CLONE-able response)

  function isPlainGet( input, init ) {
    var method = ( init && init.method ) || ( input && input.method ) || 'GET';
    if ( String( method ).toUpperCase() !== 'GET' ) return false;
    // a body on an otherwise-GET call is unusual/invalid — don't coalesce it, let it pass through untouched
    if ( init && init.body ) return false;
    return true;
  }
  function keyFor( input, init ) {
    var url = typeof input === 'string' ? input : ( input && input.url );
    if ( !url ) return null;
    // absolute-ize so relative and absolute callers of the same resource share a key
    try { url = new URL( url, location.href ).href; } catch ( e ) { /* leave as-is */ }
    var creds = ( init && init.credentials ) || ( input && input.credentials ) || 'same-origin';
    return creds + '|' + url;
  }

  window.fetch = function ( input, init ) {
    if ( !isPlainGet( input, init ) ) return native( input, init );
    var key = keyFor( input, init );
    if ( !key ) return native( input, init );

    if ( inflight[ key ] ) {
      // a matching request is already on the wire — ride it, don't fire a second one
      return inflight[ key ].then( function ( res ) { return res.clone(); } );
    }

    var p = native( input, init ).then(
      function ( res ) { delete inflight[ key ]; return res; },
      function ( err ) { delete inflight[ key ]; throw err; }
    );
    inflight[ key ] = p;
    return p.then( function ( res ) { return res.clone(); } );
  };
})();
