/* SML Profile Photo — the "change your profile image" card on /customize-profile/.
 *
 * Server side (WPCode "SML Profile Photo" snippet) exposes
 * GET/POST/DELETE /wp-json/sml-avatar/v1/me and a pre_get_avatar_data filter,
 * so the photo saved here replaces Gravatar on every surface of the site.
 * Config arrives in window.SML_AVATAR = {nonce, endpoint}.
 *
 * The smlpe profile editor renders in STAGES (core sections first, the unified
 * identity block later), so this card cannot mount once at DOMContentLoaded:
 * it polls for the "Profile identity" section, inserts above it, and a
 * watchdog re-inserts the same node if an engine re-render wipes it (the node
 * keeps its listeners). Styling is fully self-contained — no dependency on
 * engine class names. CSP: no inline handlers — listeners only.
 */
(function () {
  'use strict';
  if (window.__smlProfilePhotoMounted) return;
  var CFG = window.SML_AVATAR;
  if (!CFG || !CFG.nonce || !CFG.endpoint) return;
  window.__smlProfilePhotoMounted = true;

  var MAX_BYTES = 8 * 1024 * 1024;
  var TYPES = /^image\/(jpeg|png|webp|gif)$/;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var css = el('style');
  css.textContent =
    '#sml-avatar-card{margin:0 0 18px;padding:18px 20px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09);font-family:inherit;}' +
    '#sml-avatar-card .sml-av-title{margin:0 0 4px;font-size:15px;font-weight:700;letter-spacing:.01em;}' +
    '#sml-avatar-card .sml-av-hint{margin:0 0 14px;font-size:12.5px;opacity:.7;}' +
    '#sml-avatar-card .sml-av-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}' +
    '#sml-avatar-card img.sml-av-preview{width:84px;height:84px;border-radius:50%;object-fit:cover;flex:none;box-shadow:0 0 0 2px rgba(0,0,0,.35),0 0 0 4px rgba(34,224,122,.55);background:#101720;}' +
    '#sml-avatar-card .sml-av-btns{display:flex;gap:10px;flex-wrap:wrap;}' +
    '#sml-avatar-card .sml-av-btn{appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:9px 18px;font:600 13px/1.2 inherit;cursor:pointer;background:rgba(255,255,255,.06);color:inherit;}' +
    '#sml-avatar-card .sml-av-btn--primary{background:#22E07A;border-color:#22E07A;color:#08150d;}' +
    '#sml-avatar-card .sml-av-btn:focus-visible{outline:2px solid #22E07A;outline-offset:2px;}' +
    '#sml-avatar-card .sml-av-btn[disabled]{opacity:.55;cursor:wait;}' +
    '#sml-avatar-card .sml-av-note{font-size:12px;opacity:.75;margin-top:6px;}' +
    '#sml-avatar-card .sml-av-err{display:none;margin-top:8px;font-size:12.5px;font-weight:600;color:#ff8fa3;}' +
    '#sml-avatar-card .sml-av-ok{color:#7ce6ad;}' +
    '#sml-avatar-card input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);}';
  document.head.appendChild(css);

  /* ---- build the card once; the node survives re-insertion ---- */
  var card = el('section');
  card.id = 'sml-avatar-card';
  var img = el('img', 'sml-av-preview');
  img.alt = 'Your profile photo';
  img.referrerPolicy = 'no-referrer';
  var upBtn = el('button', 'sml-av-btn sml-av-btn--primary', 'Upload photo');
  upBtn.type = 'button';
  var rmBtn = el('button', 'sml-av-btn', 'Remove photo');
  rmBtn.type = 'button';
  rmBtn.style.display = 'none';
  var file = el('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp,image/gif';
  var err = el('div', 'sml-av-err');
  err.setAttribute('role', 'alert');

  var row = el('div', 'sml-av-row');
  var btns = el('div', 'sml-av-btns');
  btns.appendChild(upBtn); btns.appendChild(rmBtn);
  row.appendChild(img); row.appendChild(btns);
  card.appendChild(el('h3', 'sml-av-title', 'Profile photo'));
  card.appendChild(el('p', 'sml-av-hint', 'The image members see everywhere — your posts, comments, and menus.'));
  card.appendChild(row);
  card.appendChild(el('div', 'sml-av-note', 'JPEG, PNG, WebP, or GIF — up to 8 MB. Changes apply across StockMarketLoop right away.'));
  card.appendChild(err);
  card.appendChild(file);

  function say(msg, ok) {
    err.textContent = msg || '';
    err.className = 'sml-av-err' + (ok ? ' sml-av-ok' : '');
    err.style.display = msg ? 'block' : 'none';
  }
  function busy(on) { upBtn.disabled = on; rmBtn.disabled = on; upBtn.textContent = on ? 'Saving…' : 'Upload photo'; }
  function render(state) {
    if (state && state.avatar) img.src = state.avatar;
    rmBtn.style.display = state && state.custom ? '' : 'none';
  }
  function req(method, body) {
    return fetch(CFG.endpoint, {
      method: method,
      credentials: 'same-origin',
      headers: { 'X-WP-Nonce': CFG.nonce },
      body: body || undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.message || ('That did not work (HTTP ' + r.status + ').'));
        return j;
      });
    });
  }

  upBtn.addEventListener('click', function () { file.click(); });
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (!TYPES.test(f.type)) { say('Use a JPEG, PNG, WebP, or GIF image.'); return; }
    if (f.size > MAX_BYTES) { say('That image is over 8 MB — pick a smaller one.'); return; }
    say('');
    busy(true);
    var fd = new FormData();
    fd.append('file', f);
    req('POST', fd).then(function (state) {
      render(state);
      say('Profile photo updated.', true);
    }).catch(function (e) { say(e.message || 'The upload failed — try again.'); })
      .then(function () { busy(false); });
  });
  rmBtn.addEventListener('click', function () {
    if (!window.confirm('Remove your photo and go back to the default avatar?')) return;
    say('');
    busy(true);
    req('DELETE').then(function (state) {
      render(state);
      say('Photo removed — using the default avatar again.', true);
    }).catch(function (e) { say(e.message || 'That did not work — try again.'); })
      .then(function () { busy(false); });
  });

  /* ---- placement: the editor renders in stages; wait for the identity
     section, and re-insert if a later engine render removes the card ---- */
  function identitySection() {
    var hit = null;
    document.querySelectorAll('.smlpe-section, section, fieldset').forEach(function (s) {
      if (hit) return;
      var h = s.querySelector('h2,h3,h4,legend,.smlpe-section__title');
      if (h && /profile identity/i.test(h.textContent || '') && !card.contains(s) && s !== card) hit = s;
    });
    return hit;
  }
  var placedAtAnchor = false;
  function place() {
    var anchor = identitySection();
    if (anchor && anchor.parentNode) {
      if (!placedAtAnchor || !document.contains(card)) {
        anchor.parentNode.insertBefore(card, anchor);
        placedAtAnchor = true;
      }
      return true;
    }
    if (!document.contains(card)) {
      var fallback = document.querySelector('.smlpe-section');
      if (fallback && fallback.parentNode) fallback.parentNode.insertBefore(card, fallback);
    }
    return false;
  }
  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    if (place() || tries > 50) {
      clearInterval(poll);
      if (!document.contains(card)) (document.querySelector('main') || document.body).appendChild(card);
      /* watchdog: engine re-renders can wipe injected nodes — put it back */
      setInterval(function () { if (!document.contains(card)) { placedAtAnchor = false; place() || (document.querySelector('main') || document.body).appendChild(card); } }, 2000);
    }
  }, 400);

  req('GET').then(render).catch(function () { /* preview stays empty; upload still works */ });
})();
