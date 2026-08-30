/*!
 * SML Q&A — add a "Q&A" item to the site's header nav on every page, so the
 * knowledge base is reachable sitewide. The site renders two header variants:
 *   .sml-gh-nav  — the theme header (question pages, posts)
 *   .hf-nav      — the custom "home feed" shell (homepage + custom surfaces)
 * This appends additively to whichever is present, without touching either
 * source (reversible by deactivating the plugin). CSP-safe: external file, no
 * inline handlers. The link inherits each nav's own `a` styling.
 */
(function () {
  'use strict';
  var HREF = '/q/';
  var SELECTORS = ['.sml-gh-nav', '.hf-nav'];
  function onQA() { return location.pathname === HREF || location.pathname.indexOf('/q/') === 0; }
  function addTo(nav) {
    if (!nav || nav.querySelector('a[data-sml-qa-nav]')) { return; }
    var a = document.createElement('a');
    a.href = HREF;
    a.textContent = 'Q&A';
    a.setAttribute('data-sml-qa-nav', '1');
    if (onQA()) { a.setAttribute('aria-current', 'page'); }
    nav.appendChild(a);
  }
  function add() {
    var found = 0;
    for (var i = 0; i < SELECTORS.length; i++) {
      var nav = document.querySelector(SELECTORS[i]);
      if (nav) { found++; addTo(nav); }
    }
    return found > 0;
  }
  function start() {
    if (add()) { return; }
    /* Header can hydrate slightly after DOMContentLoaded — retry briefly. */
    var n = 0;
    var t = setInterval(function () { if (add() || ++n > 15) { clearInterval(t); } }, 400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
