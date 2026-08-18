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

  /* ---------- dropdown injection: target the verified live account menu,
     with defensive fallbacks for templates that render an older shell. ---------- */
  function findAccountMenu() {
    var exact = document.querySelector('.sml-acct[data-sml-acct] .sml-acct__menu[role="menu"]');
    if (exact) return { trigger: exact.parentElement && exact.parentElement.querySelector('.sml-acct__btn'), menu: exact };
    var candidates = document.querySelectorAll('[aria-label*="Account" i], [aria-label*="account menu" i], .sml-account-menu, .account-menu, [data-account-menu]');
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var menu = c.tagName === 'UL' || c.tagName === 'DIV' ? c : (c.nextElementSibling || c.closest('[role="menu"]'));
      if (menu) return { trigger: c, menu: menu };
    }
    return null;
  }
  function injectMenuItems() {
    if (el('sml-cg-open-channel') || !LOGGED_IN) return;
    var found = findAccountMenu();
    var items =
      '<div class="sml-acct__sep" data-sml-cg-sep></div>' +
      '<a href="#" id="sml-cg-open-channel" class="sml-acct__item" role="menuitem"><span class="sml-acct__label">Create a Loop Channel</span></a>' +
      '<a href="#" id="sml-cg-open-letter" class="sml-acct__item" role="menuitem"><span class="sml-acct__label">Create a Loop Letter</span></a>';
    if (found && found.menu) {
      found.menu.insertAdjacentHTML('beforeend', items);
    } else {
      var btn = document.createElement('div');
      btn.id = 'sml-cg-fallback';
      btn.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:#0a121b;border:1px solid #1c2833;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;font-family:Archivo,sans-serif';
      btn.innerHTML = '<span style="font:700 9px/1 Archivo,sans-serif;letter-spacing:.1em;color:#5d7085;padding:0 4px">CREATOR</span>' + items;
      document.body.appendChild(btn);
    }
    var chLink = el('sml-cg-open-channel'), ltLink = el('sml-cg-open-letter');
    if (chLink) chLink.onclick = function (e) { e.preventDefault(); startFlow('channel'); };
    if (ltLink) ltLink.onclick = function (e) { e.preventDefault(); startFlow('letter'); };
  }

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
  function closeModal() { var o = el('sml-cg-overlay'); if (o) o.remove(); }
  function openModal(html) {
    ensureCSS(); closeModal();
    var o = document.createElement('div'); o.id = 'sml-cg-overlay';
    o.innerHTML = '<div id="sml-cg-modal">' + html + '</div>';
    o.onclick = function (e) { if (e.target === o) closeModal(); };
    document.body.appendChild(o);
  }

  /* ---------- flow ---------- */
  function startFlow(kind) {
    if (!LOGGED_IN) { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname); return; }
    openModal('<p style="color:#5d7085;font:400 12px/1 Archivo,sans-serif">Loading…</p>');
    api('/sml-creator-gate/v1/status').then(function (res) {
      if (!res.ok) {
        // bound in JS, not an inline onclick attribute — inline handlers are blocked by CSP on some pages
        openModal('<p class="sml-cg-h">Couldn’t load your account status</p><p class="sml-cg-sub">Try again in a moment.</p><button class="sml-cg-cancel" id="sml-cg-errclose">Close</button>');
        var ec = el('sml-cg-errclose'); if (ec) ec.onclick = closeModal;
        return;
      }
      var j = res.j || {};
      if (!j.registered) renderRegistration(kind);
      else if ((kind === 'channel' && j.hasChannel) || (kind === 'letter' && j.hasLetter)) {
        window.location.href = kind === 'channel' ? '/channel/' + encodeURIComponent(j.channelHandle) + '/?ch=1' : '/creator-studio/loop-letters/write/';
      } else renderHandleStep(kind, j.creatorName || '');
    });
  }

  function renderRegistration(kind) {
    openModal(
      '<h3 class="sml-cg-h">Complete your creator profile</h3>' +
      '<p class="sml-cg-sub">Required once, before your first Loop ' + (kind === 'letter' ? 'Letter' : 'Channel') + '.</p>' +
      '<div class="sml-cg-row"><label>FULL NAME</label><input id="sml-cg-name" type="text" autocomplete="name"></div>' +
      '<div class="sml-cg-row2">' +
        '<div class="sml-cg-row"><label>DATE OF BIRTH</label><input id="sml-cg-dob" type="date"></div>' +
        '<div class="sml-cg-row"><label>PHONE</label><input id="sml-cg-phone" type="tel" autocomplete="tel"></div>' +
      '</div>' +
      '<div class="sml-cg-row2">' +
        '<div class="sml-cg-row"><label>CITY</label><input id="sml-cg-city" type="text" autocomplete="address-level2"></div>' +
        '<div class="sml-cg-row"><label>STATE</label><input id="sml-cg-state" type="text" autocomplete="address-level1"></div>' +
      '</div>' +
      '<div class="sml-cg-row"><label>EMAIL</label><input id="sml-cg-email" type="email" autocomplete="email"></div>' +
      '<div class="sml-cg-err" id="sml-cg-regerr"></div>' +
      '<div class="sml-cg-btns"><button class="sml-cg-cancel" id="sml-cg-regcancel">Cancel</button><button class="sml-cg-primary" id="sml-cg-regsubmit">Continue</button></div>'
    );
    el('sml-cg-regcancel').onclick = closeModal;
    el('sml-cg-regsubmit').onclick = function () {
      var body = {
        name: el('sml-cg-name').value.trim(), dob: el('sml-cg-dob').value,
        city: el('sml-cg-city').value.trim(), state: el('sml-cg-state').value.trim(),
        phone: el('sml-cg-phone').value.trim(), email: el('sml-cg-email').value.trim()
      };
      var btn = el('sml-cg-regsubmit'); btn.disabled = true; btn.textContent = 'Saving…';
      api('/sml-creator-gate/v1/register', { method: 'POST', body: JSON.stringify(body) }).then(function (res) {
        btn.disabled = false; btn.textContent = 'Continue';
        if (res.ok) {
          api('/sml-creator-gate/v1/status').then(function (next) {
            var s = next.j || {};
            if (next.ok && ((kind === 'channel' && s.hasChannel) || (kind === 'letter' && s.hasLetter))) {
              window.location.reload();
              return;
            }
            renderHandleStep(kind, s.creatorName || body.name);
          });
        }
        else el('sml-cg-regerr').textContent = (res.j && res.j.message) || 'Could not save — check the fields above.';
      });
    };
  }

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
    if (document.body) { clearInterval(t); injectMenuItems(); }
    else if (tries > 60) clearInterval(t);
  }, 300);
})();
