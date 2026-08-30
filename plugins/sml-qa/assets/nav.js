/*!
 * SML Q&A — add a "Q&A" item to the site's global header nav (.sml-gh-nav) on
 * every page, so the knowledge base is reachable sitewide. The global header is
 * a custom server-rendered component; this appends additively without touching
 * its source (reversible by deactivating the plugin). CSP-safe: external file,
 * no inline handlers. The link inherits the nav's own `.sml-gh-nav a` styling.
 */
(function () {
  'use strict';
  var HREF = '/q/';
  function onQA() { return location.pathname === HREF || location.pathname.indexOf('/q/') === 0; }
  function add() {
    var nav = document.querySelector('.sml-gh-nav');
    if (!nav) return false;
    if (nav.querySelector('a[data-sml-qa-nav]')) return true;
    var a = document.createElement('a');
    a.href = HREF;
    a.textContent = 'Q&A';
    a.setAttribute('data-sml-qa-nav', '1');
    if (onQA()) { a.setAttribute('aria-current', 'page'); }
    nav.appendChild(a);
    return true;
  }
  function start() {
    if (add()) { return; }
    /* The header can hydrate slightly after DOMContentLoaded — retry briefly. */
    var n = 0;
    var t = setInterval(function () { if (add() || ++n > 15) { clearInterval(t); } }, 400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
