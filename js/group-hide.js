/*!
 * SML group shadow-ban scrub. Loaded site-wide by the CDN loader for NON-admins
 * only, with a data-ban="slug,slug" attribute listing the hidden group slugs.
 * Removes each banned group's whole CARD (not just its link, which would leave an
 * empty tile shell) from any listing — the /groups/ directory, homepage rails,
 * search, profiles — and keeps watching briefly for lazily-rendered cards.
 * Server-side the loader also 302-redirects the group pages themselves, so this
 * only has to handle listings. Admins never load this script.
 */
(function () {
  var self = document.getElementById('sml-ghide') || document.currentScript;
  var ban = ((self && self.getAttribute('data-ban')) || '')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!ban.length) return;

  function hit(href) {
    href = String(href || '').toLowerCase();
    for (var i = 0; i < ban.length; i++) { if (href.indexOf('/groups/' + ban[i]) >= 0) return true; }
    return false;
  }

  // Prefer real card containers so the whole tile/row is removed, not just the link.
  var CARD = '.sml-gex-tile, .sml-gex-rank, .sml-gex-primary, article, li, .oh-post, [class*="group-card"], [class*="group-tile"]';

  function scrub() {
    var links = document.querySelectorAll('a[href*="/groups/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!hit(a.getAttribute('href'))) continue;
      var card = a.closest(CARD) || a;
      // Never remove something huge (a whole section/main) by mistake.
      if (card && card.parentNode && !/^(MAIN|SECTION|BODY|HTML)$/.test(card.tagName)) card.remove();
      else if (a.parentNode) a.remove();
    }
  }

  scrub();
  [150, 500, 1200, 2500, 4000].forEach(function (t) { setTimeout(scrub, t); });
  try {
    var mo = new MutationObserver(scrub);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 15000);
  } catch (e) { /* no observer support */ }
})();
