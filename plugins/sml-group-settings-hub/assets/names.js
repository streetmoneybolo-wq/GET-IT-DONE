(function () {
  'use strict';
  /* Role colours and icons on names inside a group: the colour a manager gave a custom role tints the member's name, and its icon sits in front of it,
     in chat messages and in the member and online lists. The server sends who holds a styled role; this only paints. */
  var CFG = window.SML_HUB || {};
  if (!CFG.api || !CFG.groupId || window.__smlRoleNames) return;
  window.__smlRoleNames = 1;

  var map = {}, loadedAt = 0, loading = false;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : ''; }
  function iconHtml(icon) {
    icon = String(icon || '');
    if (!icon) return '';
    if (/^https:\/\//i.test(icon)) return '<img class="sml-rn-icon" alt="" src="' + esc(icon) + '" loading="lazy">';
    return '<span class="sml-rn-icon sml-rn-emoji">' + esc(icon) + '</span>';
  }
  function load(force) {
    if (loading || (!force && Date.now() - loadedAt < 45000)) return;
    loading = true;
    fetch(CFG.api + 'group/' + CFG.groupId + '/role-styles', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': CFG.nonce || '' } })
      .then(function (r) { return r.ok ? r.json() : { styles: [] }; })
      .then(function (j) {
        var m = {};
        (j.styles || []).forEach(function (s) { (s.names || []).forEach(function (n) { if (n) m[String(n).toLowerCase()] = s; }); });
        map = m; loadedAt = Date.now(); loading = false; sweep(true);
      }).catch(function () { loading = false; loadedAt = Date.now(); });
  }

  function styleFor(el, name) {
    var key = String(name || '').trim().toLowerCase();
    /* a chat message also shows @handle: prefer it, since display names can repeat */
    var head = el.closest && el.closest('.sml-gshell__message-head');
    if (head) { var h = head.querySelector('span'); if (h && /^@/.test(h.textContent || '')) { var hs = map[String(h.textContent).slice(1).trim().toLowerCase()]; if (hs) return hs; } }
    return map[key] || null;
  }
  function paint(el) {
    if (el.getAttribute('data-sml-rn') === '1' && !el.__smlForce) return;
    var raw = el.getAttribute('data-sml-rn-name') || el.textContent;
    var s = styleFor(el, raw);
    if (!s) { el.setAttribute('data-sml-rn', '1'); el.setAttribute('data-sml-rn-name', raw); return; }
    var c = safeColor(s.color);
    el.setAttribute('data-sml-rn', '1'); el.setAttribute('data-sml-rn-name', raw);
    if (el.querySelector('.sml-rn-icon')) { if (c) el.style.color = c; return; }
    if (c) el.style.color = c;
    var ic = iconHtml(s.icon);
    if (ic) el.insertAdjacentHTML('afterbegin', ic + ' ');
    el.setAttribute('title', s.role || '');
  }
  var SEL = '.sml-gshell__message-head strong, .sml-gshell__person-name, .sml-gshell__me-name';
  function sweep(force) {
    if (!Object.keys(map).length) return;
    document.querySelectorAll(SEL).forEach(function (el) {
      if (force) { el.removeAttribute('data-sml-rn'); var old = el.querySelectorAll('.sml-rn-icon'); old.forEach(function (n) { n.remove(); }); var raw = el.getAttribute('data-sml-rn-name'); if (raw != null) { el.textContent = raw; } }
      paint(el);
    });
  }

  var root = document.getElementById('sml-group-shell');
  if (!root) return;
  var queued = false;
  new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; load(false); sweep(false); }); }).observe(root, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(true); });
  setInterval(function () { if (!document.hidden) load(true); }, 60000);
  load(true);
})();
