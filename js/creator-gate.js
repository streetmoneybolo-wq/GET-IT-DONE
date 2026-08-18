/* SML Creator Gate — dropdown entry points + registration + Channel/Letter
   creation. Loads site-wide (needs to reach the account dropdown on every
   page). Two new items under the account menu: "Create a Loop Channel" and
   "Create a Loop Letter." Either starts full registration (name/DOB/city/
   state/phone/email — brand-new data, didn't exist anywhere before) if not
   already done, then the specific handle-claim step.
   Channel creation reuses the real sml-channel/v1 endpoints. Letter creation
   uses the verified sml-loopletters/v1 settings contract (name + handle) and
   then opens the existing Loop Letter writer. */
(function () {
  'use strict';
  if (window.__smlCreatorGateBooted) return;
  window.__smlCreatorGateBooted = true;

  var loader = document.getElementById('sml-cg-js');
  var NONCE = (window.wpApiSettings && window.wpApiSettings.nonce) || window.SML_CG_NONCE || (loader && loader.dataset.nonce) || '';
  var LOGGED_IN = !!(window.SML_CG_ME || (loader && loader.dataset.me === '1') || (window.wpApiSettings && window.wpApiSettings.nonce));

  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'same-origin'; opts.headers = opts.headers || {};
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    opts.cache = 'no-store';
    return fetch('/wp-json' + path, opts).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(id) { return document.getElementById(id); }

  /* ---------- dropdown injection ----------
     Audit 2026-08-18: the old fallback accepted ANY element whose aria-label
     mentioned "Account" as the menu — on the Home Feed homepage that is the
     avatar BUTTON, so the links were injected inside the button, unstyled;
     and on the Creator Studio shell (no menu at all) a floating "CREATOR" box
     was pinned bottom-left forever. Now: only real menu containers, no
     floating box, and we watch for menus that are built on demand
     (Home Feed builds #sml-hf-memenu when the avatar is clicked). ---------- */
  var MENU_SELECTORS = [
    '.sml-acct[data-sml-acct] .sml-acct__menu[role="menu"]', // theme launcher (server-printed in wp_footer)
    '#sml-hf-memenu',                                        // Home Feed popover (built on demand)
    '[role="menu"][aria-label*="account" i]',
    '.sml-account-menu', '.account-menu', '[data-account-menu]'
  ];
  function findAccountMenus() {
    var out = [];
    MENU_SELECTORS.forEach(function (sel) {
      [].forEach.call(document.querySelectorAll(sel), function (m) {
        // never a trigger: buttons/links/anything role=button
        if (m.tagName === 'BUTTON' || m.tagName === 'A' || m.getAttribute('role') === 'button') return;
        if (out.indexOf(m) === -1) out.push(m);
      });
    });
    return out;
  }
  function closeHostMenu(menu) {
    // best effort: the launcher toggles is-open/open + aria-expanded on its trigger
    try {
      menu.classList.remove('is-open', 'open', 'active');
      var host = menu.closest('.sml-acct, [data-sml-acct], .sml-hf-me') || menu.parentElement;
      var trig = host && host.querySelector('[aria-expanded="true"]');
      if (trig) trig.setAttribute('aria-expanded', 'false');
      if (menu.id === 'sml-hf-memenu') { menu.style.display = 'none'; }
    } catch (e) {}
  }
  function injectInto(menu) {
    if (!LOGGED_IN || menu.querySelector('[data-sml-cg-item]')) return;
    // adopt the host menu's own item look so we match wherever we land
    var proto = menu.querySelector('a[role="menuitem"], a, button');
    var cls = proto ? (proto.className || '') : 'sml-acct__item';
    var sepProto = menu.querySelector('.sml-acct__sep, hr, [role="separator"]');
    var sep = sepProto ? sepProto.cloneNode(false) : document.createElement('div');
    if (!sepProto) sep.className = 'sml-acct__sep';
    sep.setAttribute('data-sml-cg-item', 'sep');
    var mk = function (label, kind) {
      var a = document.createElement('a'); a.href = '#'; a.className = cls; a.setAttribute('role', 'menuitem'); a.setAttribute('data-sml-cg-item', kind);
      var span = document.createElement('span'); span.className = 'sml-acct__label'; span.textContent = label; a.appendChild(span);
      a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeHostMenu(menu); startFlow(kind); });
      return a;
    };
    menu.appendChild(sep);
    menu.appendChild(mk('Create a Loop Channel', 'channel'));
    menu.appendChild(mk('Create a Loop Letter', 'letter'));
  }
  function injectMenuItems() { findAccountMenus().forEach(injectInto); }

  /* ---------- modal shell ---------- */
  var CSS = '#sml-cg-overlay{position:fixed;inset:0;z-index:2147483100;background:rgba(2,4,8,.8);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Archivo,sans-serif}' +
    '#sml-cg-modal{width:420px;max-width:100%;max-height:88vh;overflow-y:auto;background:#070b10;border:1px solid #16202b;border-radius:14px;padding:22px}' +
    '.sml-cg-h{font:800 15px/1 Archivo,sans-serif;color:#e6edf3;margin:0 0 4px}' +
    '.sml-cg-sub{font:400 11px/1.5 Archivo,sans-serif;color:#5d7085;margin:0 0 18px}' +
    '.sml-cg-row{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}' +
    '.sml-cg-row label{font:700 9px/1 Archivo,sans-serif;letter-spacing:.08em;color:#5d7085}' +
    '.sml-cg-row input,.sml-cg-row select{border:1px solid #1c2833;border-radius:8px;background:#0a121b;color:#e6edf3;font:400 13px/1 Archivo,sans-serif;padding:11px 12px;outline:none;width:100%;box-sizing:border-box}' +
    '.sml-cg-row2{display:flex;gap:10px}.sml-cg-row2>div{flex:1}' +
    '.sml-cg-err{font:400 11px/1.5 Archivo,sans-serif;color:#ff5e6e;margin:-4px 0 12px;min-height:14px}' +
    '.sml-cg-btns{display:flex;gap:10px;margin-top:6px}' +
    '.sml-cg-primary{flex:1;font:700 11px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border:none;border-radius:8px;padding:13px;cursor:pointer}' +
    '.sml-cg-primary:disabled{opacity:.5;cursor:not-allowed}' +
    '.sml-cg-cancel{font:600 11px/1 Archivo,sans-serif;color:#5d7085;background:#0a121b;border:1px solid #1c2833;border-radius:8px;padding:13px 16px;cursor:pointer}' +
    '.sml-cg-avail{font:400 10px/1.5 \'IBM Plex Mono\',monospace;min-height:14px;margin-top:6px}' +
    '.sml-cg-handlein{display:flex;align-items:center;border:1px solid #1c2833;border-radius:8px;background:#0a121b;overflow:hidden}' +
    '.sml-cg-handlein span{font:600 13px/1 \'IBM Plex Mono\',monospace;color:#4c5d6d;padding:12px 2px 12px 12px}' +
    '.sml-cg-handlein input{border:none;background:none;color:#7ae6ff;font:600 13px/1 \'IBM Plex Mono\',monospace;padding:12px 12px 12px 2px}';
  function ensureCSS() { if (!document.getElementById('sml-cg-css')) { var s = document.createElement('style'); s.id = 'sml-cg-css'; s.textContent = CSS; document.head.appendChild(s); } }
  var lastFocus = null;
  function closeModal() {
    var o = el('sml-cg-overlay'); if (o) o.remove();
    document.removeEventListener('keydown', modalKeys, true);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }
  function modalKeys(e) {
    var o = el('sml-cg-overlay'); if (!o) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    var f = [].filter.call(o.querySelectorAll('button, a[href], input, select, textarea'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); return; }
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  function openModal(html) {
    ensureCSS();
    if (!el('sml-cg-overlay')) lastFocus = document.activeElement;
    var prev = el('sml-cg-overlay'); if (prev) prev.remove();
    var o = document.createElement('div'); o.id = 'sml-cg-overlay';
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.tabIndex = -1;
    o.innerHTML = '<div id="sml-cg-modal">' + html + '</div>';
    o.onclick = function (e) { if (e.target === o) closeModal(); };
    document.body.appendChild(o);
    document.removeEventListener('keydown', modalKeys, true);
    document.addEventListener('keydown', modalKeys, true);
    var first = o.querySelector('input, select, textarea, button'); if (first) { try { first.focus(); } catch (e) {} }
  }

  /* ---------- flow ---------- */
  function startFlow(kind) {
    if (!LOGGED_IN) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
    // Channel creation lives on its own page now (/create-channel/ — the "Create
    // Loop Channel" design: registration + channel together, then → /go-live/).
    // If the creator already has a channel, the page itself sends them on.
    if (kind === 'channel') { window.location.href = '/create-channel/'; return; }
    openModal('<p style="color:#5d7085;font:400 12px/1 Archivo,sans-serif">Loading…</p>');
    api('/sml-creator-gate/v1/status').then(function (res) {
      if (res.status === 401) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
      if (res.status === 403 && res.j && /nonce/i.test(res.j.code || '') && !sessionStorage.getItem('sml-cg-nonce-retry')) {
        sessionStorage.setItem('sml-cg-nonce-retry', '1'); window.location.reload(); return; // stale nonce (page cache) -> fresh one
      }
      if (!res.ok) {
        // bound in JS, not an inline onclick attribute — inline handlers are blocked by CSP on some pages
        openModal('<p class="sml-cg-h">Couldn’t load your account status</p><p class="sml-cg-sub">Try again in a moment.</p><button class="sml-cg-cancel" id="sml-cg-errclose">Close</button>');
        var ec = el('sml-cg-errclose'); if (ec) ec.onclick = closeModal;
        return;
      }
      var j = res.j || {};
      /* URGENT (2026-08-18): the name/DOB/city/state/phone registration step
         was removed — it collected real personal data under a flow the real
         design (Create Loop Channel.dc.html) doesn't call for at all. That
         design only wants a verified email at channel-creation time; DOB/
         phone/address belong in a future monetization Settings screen, not
         here. Skip straight to the handle step until that's rebuilt properly. */
      if ((kind === 'channel' && j.hasChannel) || (kind === 'letter' && j.hasLetter)) {
        window.location.href = kind === 'channel' ? '/channel/' + encodeURIComponent(j.channelHandle) + '/?ch=1' : '/creator-studio/loop-letters/write/';
      } else renderHandleStep(kind, j.creatorName || '');
    });
  }

  /* renderRegistration (name/DOB/city/state/phone) removed 2026-08-18 — see
     the note in startFlow(). Was here; check git history if the monetization
     Settings screen work later needs to reuse any of this. */

  function renderHandleStep(kind, creatorName) {
    var isChannel = kind === 'channel';
    var title = isChannel ? 'Create your Loop Channel' : 'Create your Loop Letter';
    var checkPath = isChannel ? '/sml-channel/v1/handle-availability' : '/sml-loopletters/v1/handle-available';
    var savePath = isChannel ? '/sml-channel/v1/handle' : '/sml-loopletters/v1/settings';
    openModal(
      '<h3 class="sml-cg-h">' + title + '</h3>' +
      '<p class="sml-cg-sub">Pick a handle' + (isChannel ? ' — separate from your profile handle' : '') + '.</p>' +
      (isChannel ? '' : '<div class="sml-cg-row"><label>PUBLICATION NAME</label><input id="sml-cg-letter-name" type="text" maxlength="60" value="' + esc(creatorName || '') + '" placeholder="Your newsletter name"></div>') +
      '<div class="sml-cg-handlein"><span>@</span><input id="sml-cg-handle" type="text" placeholder="yourhandle" maxlength="30"></div>' +
      '<div class="sml-cg-avail" id="sml-cg-avail"></div>' +
      '<div class="sml-cg-err" id="sml-cg-handleerr"></div>' +
      '<div class="sml-cg-btns"><button class="sml-cg-cancel" id="sml-cg-handlecancel">Cancel</button><button class="sml-cg-primary" id="sml-cg-handlesubmit" disabled>Create</button></div>'
    );
    var status = { ok: false };
    var timer;
    el('sml-cg-handlecancel').onclick = closeModal;
    el('sml-cg-handle').oninput = function () {
      var h = this.value.trim().replace(/^@/, '');
      var av = el('sml-cg-avail'), btn = el('sml-cg-handlesubmit');
      status.ok = false; btn.disabled = true;
      clearTimeout(timer);
      if (h.length < 3) { av.textContent = h.length ? 'At least 3 characters.' : ''; av.style.color = '#ff5e6e'; return; }
      timer = setTimeout(function () {
        api(checkPath + '?handle=' + encodeURIComponent(h)).then(function (res) {
          if (!res.ok) { av.textContent = (res.j && res.j.message) || 'Could not check that handle.'; av.style.color = '#ff5e6e'; return; }
          var j = res.j || {}; var avail = j.available != null ? j.available : j.is_available;
          av.textContent = avail ? 'Available.' : ((j.message) || 'That handle is taken.');
          av.style.color = avail ? '#00ff88' : '#ff5e6e';
          status.ok = !!avail; btn.disabled = !avail;
        });
      }, 400);
    };
    el('sml-cg-handlesubmit').onclick = function () {
      if (!status.ok) return;
      var h = el('sml-cg-handle').value.trim().replace(/^@/, '');
      var btn = this; btn.disabled = true; btn.textContent = 'Creating…';
      var payload = { handle: h };
      if (!isChannel) {
        payload.name = (el('sml-cg-letter-name').value || '').trim();
        payload.tagline = '';
        payload.topics = [];
        payload.cadence = 'weekly';
        payload.visibility = 'public';
        if (!payload.name) {
          btn.disabled = false; btn.textContent = 'Create';
          el('sml-cg-handleerr').textContent = 'Enter a publication name.';
          return;
        }
      }
      api(savePath, { method: 'POST', body: JSON.stringify(payload) }).then(function (res) {
        if (res.ok) {
          if (isChannel) { window.location.href = '/channel/' + encodeURIComponent(h) + '/?ch=1'; }
          else { window.location.href = '/creator-studio/loop-letters/write/'; }
        } else {
          btn.disabled = false; btn.textContent = 'Create';
          el('sml-cg-handleerr').textContent = (res.j && res.j.message) || 'Could not create — the server said: ' + (res.status || 'unknown error') + '.';
        }
      });
    };
  }

  window.__smlCreatorGateStart = startFlow; /* exposed for the enforcement script's CTA */

  var tries = 0;
  var t = setInterval(function () {
    tries++;
    if (document.body) { clearInterval(t); injectMenuItems(); watchMenus(); }
    else if (tries > 60) clearInterval(t);
  }, 300);
  function watchMenus() {
    // menus that appear later (Home Feed builds its popover on click; theme
    // launcher prints late) - re-run on DOM additions, debounced; stays cheap
    // because injectInto() is a no-op once a menu carries our items.
    if (!('MutationObserver' in window)) { setTimeout(injectMenuItems, 2000); setTimeout(injectMenuItems, 6000); return; }
    var pending = null;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; injectMenuItems(); }, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();
