/* SML Design System 1.0.3
   The few jobs the stylesheet cannot do on its own:
   1. The read-only counts under each feed card arrive as plain text ("Likes 0"). They become an icon and a number.
   2. An avatar whose image never arrives shows the author's initials instead of a broken picture or its alt text.
   3. A theme page whose content carries its own heading, or an app screen, drops the theme's duplicate title.
   4. An archive page reads "Crypto", not "Category: Crypto", and says so when it has no stories yet. */
(function () {
  'use strict';
  if (window.__smlDesignSystem) return; window.__smlDesignSystem = true;

  var ICON = {
    likes: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z'/%3E%3C/svg%3E\")",
    comments: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E\")",
    shares: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='18' cy='5' r='3'/%3E%3Ccircle cx='6' cy='12' r='3'/%3E%3Ccircle cx='18' cy='19' r='3'/%3E%3Cline x1='8.6' y1='13.5' x2='15.4' y2='17.5'/%3E%3Cline x1='15.4' y1='6.5' x2='8.6' y2='10.5'/%3E%3C/svg%3E\")"
  };
  var LABEL = { likes: 'likes', comments: 'comments', shares: 'shares' };

  function counts(root) {
    var rows = (root || document).querySelectorAll('.sml-sth-actions');
    for (var i = 0; i < rows.length; i++) {
      var spans = rows[i].querySelectorAll(':scope > span');
      for (var j = 0; j < spans.length; j++) {
        var s = spans[j]; if (s.getAttribute('data-sml-ds')) continue;
        var m = /^\s*(Likes?|Comments?|Shares?)\s+([\d.,]+[kKmM]?)\s*$/.exec(s.textContent || '');
        if (!m) continue;
        var key = m[1].toLowerCase().replace(/s?$/, 's');
        s.setAttribute('data-sml-ds', key);
        s.setAttribute('title', m[2] + ' ' + LABEL[key]);
        s.setAttribute('aria-label', m[2] + ' ' + LABEL[key]);
        var ico = document.createElement('i'); ico.className = 'sml-ds-ico'; ico.style.setProperty('--i', ICON[key]);
        var n = document.createElement('b'); n.className = 'sml-ds-n'; n.textContent = m[2];
        s.textContent = ''; s.appendChild(ico); s.appendChild(n);
      }
    }
  }

  function initials(text) {
    var words = String(text || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return (words.length ? words.slice(0, 2).map(function (w) { return w[0]; }).join('') : 'SL').toUpperCase();
  }
  function fallback(img) {
    if (!img || img.getAttribute('data-sml-ds-fallback')) return;
    img.setAttribute('data-sml-ds-fallback', '1');
    var span = document.createElement('span');
    span.className = 'sml-ds-avatar';
    span.textContent = initials(img.getAttribute('alt') || img.getAttribute('title') || '');
    var w = img.getAttribute('width') || img.style.width, h = img.getAttribute('height') || img.style.height;
    if (w) span.style.width = /px|%|em/.test(String(w)) ? w : w + 'px';
    if (h) span.style.height = /px|%|em/.test(String(h)) ? h : h + 'px';
    if (img.parentNode) img.parentNode.replaceChild(span, img);
  }
  // avatars and logos: the classed ones anywhere, plus any small picture in the feed shell (story circles, group badges)
  var AVATAR = 'img.oh-post-avatar, .sml-gex-tile-logo img, .sml-gex-rank-logo img, img.sml-hfe-avatar, img[class*="avatar"], img[class*="logo"], #sml-hf-shell img[alt]';
  function small(img) { var r = img.getBoundingClientRect(); return r.width > 0 ? r.width <= 96 && r.height <= 96 : /avatar|logo/.test(img.className); }
  function onError(e) { var img = e.target; if (small(img)) fallback(img); }
  function avatars(root) {
    var imgs = (root || document).querySelectorAll(AVATAR);
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) { if (small(img)) fallback(img); }
      else if (!img.getAttribute('data-sml-ds-watch')) { img.setAttribute('data-sml-ds-watch', '1'); img.addEventListener('error', onError); }
    }
  }

  // a visitor who is not signed in: the profile card's "Sign In" becomes a button with one plain line under it, and the header
  // drops its second, text-only sign-in circle (the green Sign In pill beside it does that job)
  function guest() {
    var card = document.getElementById('sml-hf-me-card');
    if (card && /^\s*sign\s*in\s*$/i.test(card.textContent || '')) {
      card.classList.add('sml-ds-guest');
      var note = card.nextElementSibling;
      if (note && /browse free/i.test(note.textContent || '') && note.className !== 'sml-ds-guest-note') { note.className = 'sml-ds-guest-note'; note.textContent = 'Browse free. Sign in to post, follow traders and save your watchlist.'; }
    }
    // the feed shell's own header: a white circle reading "Sign In" in 8px type next to the real Sign In button
    var top = document.getElementById('sml-hf-me-top');
    if (top && !top.querySelector('img') && /^\s*sign\s*in\s*$/i.test(top.textContent || '')) top.classList.add('sml-ds-hide');
    var accounts = document.querySelectorAll('.sml-gh-account');
    for (var i = 0; i < accounts.length; i++) {
      var span = accounts[i].querySelector('span');
      if (span && !accounts[i].querySelector('img') && (span.textContent || '').trim().length > 3) accounts[i].classList.add('sml-ds-hide');
    }
  }

  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  // the theme prints the page title above the content; when the content opens with the same heading, has an <h1> of its own,
  // or is an app screen (the ticker terminal, the newsletter, Loop Letters, a publisher page) the theme's copy goes, and an
  // app screen takes the full width of the page
  function titles() {
    var body = document.body; if (!body || body.getAttribute('data-sml-ds-titles')) return;
    var main = document.querySelector('.wp-site-blocks > main'); if (!main) return;
    var content = main.querySelector('.entry-content'); if (!content) return;
    body.setAttribute('data-sml-ds-titles', '1');
    var title = main.querySelector(':scope > .wp-block-group:first-child > .wp-block-post-title');
    var first = null, kids = content.children;
    for (var i = 0; i < kids.length; i++) { var tag = kids[i].tagName; if (tag !== 'STYLE' && tag !== 'SCRIPT' && tag !== 'LINK') { first = kids[i]; break; } }
    if (!first) return;
    var app = /(^|\s)(sml-|ll-)/.test(first.className || '') || /^(sml-|ll-)/.test(first.id || '') || !!first.querySelector('[class^="sml-"], [id^="sml-"], .ll-pub');
    var own = !!content.querySelector('h1');
    if (title && !own && /^H[1-3]$/.test(first.tagName) && norm(first.textContent) === norm(title.textContent)) own = true;
    if (app) body.classList.add('sml-ds-app');
    if (own || app) body.classList.add('sml-ds-own-title');
  }
  function archive() {
    var h = document.querySelector('.wp-block-query-title'); if (!h || h.getAttribute('data-sml-ds')) return;
    h.setAttribute('data-sml-ds', '1');
    var m = /^\s*(Category|Tag|Author|Archives?)\s*:\s*(.+?)\s*$/i.exec(h.textContent || ''), kind = m ? m[1].toLowerCase() : '', name = m ? m[2] : (h.textContent || '').trim();
    var span = h.querySelector('span'); if (span) name = (span.textContent || '').trim() || name;
    if (m) h.textContent = name;
    var sub = document.createElement('p'); sub.className = 'sml-ds-archive-sub alignwide';
    sub.textContent = kind === 'author' ? 'Stories by ' + name : kind === 'tag' ? 'Stories tagged ' + name : 'The latest stories filed under ' + name;
    h.parentNode.insertBefore(sub, h.nextSibling);
    var q = document.querySelector('main.wp-block-query'), list = q && q.querySelector('.wp-block-post-template');
    if (q && (!list || !list.children.length)) {
      var p = document.createElement('p'); p.className = 'sml-ds-empty';
      p.textContent = 'No stories in this section yet. Check back soon or read the latest from ';
      var a = document.createElement('a'); a.href = '/news/'; a.textContent = 'Stockmarketloop News'; p.appendChild(a); p.appendChild(document.createTextNode('.'));
      q.appendChild(p);
    }
  }

  function run(root) { try { counts(root); avatars(root); guest(); titles(); archive(); } catch (e) { /* never break the page */ } }
  function boot() {
    run(document);
    if (!window.MutationObserver) return;
    var pending = null;
    new MutationObserver(function () { if (pending) return; pending = setTimeout(function () { pending = null; run(document); }, 120); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
