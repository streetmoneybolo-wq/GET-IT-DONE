/*!
 * SML Group Categories — freely nameable Discord-style channel categories.
 *
 * Companion layer over the groups engine's sidebar: reads per-group category
 * names + channel assignments from sml-gcat/v1 and REGROUPS the existing
 * sidebar buttons under those headers. It only MOVES the engine's own buttons
 * (listeners survive) and never creates, renames, or deletes a channel.
 *
 * Adversarially reviewed 2026-08-30; the shape below encodes those findings:
 *  - the bootstrap GET sends X-WP-Nonce (core demotes cookie-authed REST
 *    without it to user 0, which would hide the manage gear from owners
 *    forever); an expired nonce retries once anonymously so members still
 *    get read-only grouping.
 *  - apply() moves ONLY assigned buttons, leaving an invisible placeholder at
 *    each one's exact native spot; every re-apply first sends buttons home via
 *    their placeholders, then regroups. Unassigned channels are never touched,
 *    so the engine's own progressive render order can't be corrupted (the
 *    earlier whole-sidebar snapshot/restore raced that render and clustered
 *    every channel above the native headers).
 *  - empty categories render ONLY for managers (dimmed) — members never see
 *    dead headers from suggestions or restricted channels.
 *  - the observer watches document.body (the shell can replace the container
 *    node), ignores our own mutations, and verifies grouping CORRECTNESS,
 *    not just header presence; apply() refuses to build over an empty box
 *    mid-re-render.
 *  - panel: renames carry assignments along; names are trimmed everywhere;
 *    duplicate names block Save; category cap is code-point safe.
 */
(function () {
  'use strict';
  if (window.__smlGcatBooted) return;
  window.__smlGcatBooted = true;

  var m = location.pathname.match(/^\/groups\/([^/]+)\/?$/);
  if (!m) return;
  var SLUG = decodeURIComponent(m[1]);
  var API = '/wp-json/sml-gcat/v1/group?slug=' + encodeURIComponent(SLUG);
  var NONCE = window.SML_GCAT_NONCE || '';

  var S = { categories: [], assignments: {}, canManage: false, lastBox: null };

  function channelsBox() { return document.querySelector('.sml-gshell__channels'); }
  function channelButtons(box) {
    return [].slice.call(box.querySelectorAll('.sml-gshell__channel[data-smlgs-channel]'));
  }
  function norm(name) { return String(name == null ? '' : name).trim(); }
  function capPoints(s) { return Array.from(String(s)).slice(0, 40).join(''); }

  /* ---------- placeholder-based move/restore ---------- */
  // Moving an assigned button out leaves an invisible <i> marker at its exact
  // native position; restoring is "insert before your marker, remove marker".
  // Unassigned buttons and the engine's own headers are NEVER moved, so a
  // progressive or partial engine render can't be reordered by us.
  function markHome(b) {
    var ph = document.createElement('i');
    ph.setAttribute('data-sml-gcat-ph', b.getAttribute('data-smlgs-channel') || '');
    ph.style.display = 'none';
    b.parentNode.insertBefore(ph, b);
  }
  function restoreAll(box) {
    [].slice.call(box.querySelectorAll('i[data-sml-gcat-ph]')).forEach(function (ph) {
      var id = ph.getAttribute('data-sml-gcat-ph');
      var b = id && box.querySelector('.sml-gshell__channel[data-smlgs-channel="' + id + '"]');
      if (b) ph.parentNode.insertBefore(b, ph);
      ph.remove();
    });
    [].slice.call(box.querySelectorAll('.sml-gshell__category[data-sml-gcat]')).forEach(function (h) { h.remove(); });
  }

  /* ---------- regrouping ---------- */
  function underOurHeader(b) {
    var n = b.previousElementSibling;
    while (n) {
      if (n.hasAttribute && n.hasAttribute('data-sml-gcat')) return true;
      if (n.classList && n.classList.contains('sml-gshell__category') && !n.hasAttribute('data-sml-gcat')) return false;
      n = n.previousElementSibling;
    }
    return false;
  }
  function grouped(box) {
    // correctness, not presence: EVERY assigned button that exists must sit
    // under one of our headers (a late-arriving button from the engine's
    // progressive render fails this and triggers a re-apply)
    var assigned = channelButtons(box).filter(function (b) {
      return !!S.assignments[b.getAttribute('data-smlgs-channel')];
    });
    if (!assigned.length) return !S.categories.length || !!box.querySelector('.sml-gshell__category[data-sml-gcat]') || S.canManage === false;
    return assigned.every(underOurHeader);
  }

  function apply() {
    var box = channelsBox();
    if (!box) return;
    var btns = channelButtons(box);
    // never build headers over an empty box mid-re-render — the engine is
    // between "cleared" and "repopulated"; the observer retries when it fills
    if (S.categories.length && !btns.length) return;

    S.lastBox = box;

    // 1) send every previously-moved button home and drop our headers
    restoreAll(box);

    // 2) rebuild the grouped block in one fragment, inserted once at the top;
    //    each button we take marks its native home first
    if (S.categories.length) {
      var frag = document.createDocumentFragment();
      var current = channelButtons(box); // fresh, in native DOM order
      S.categories.forEach(function (cat) {
        var mine = current.filter(function (b) { return S.assignments[b.getAttribute('data-smlgs-channel')] === cat; });
        if (!mine.length && !S.canManage) return; // members never see empty headers
        var head = document.createElement('div');
        head.className = 'sml-gshell__category';
        head.setAttribute('data-sml-gcat', '1');
        head.textContent = cat;
        if (!mine.length) head.style.opacity = '0.45'; // manager-only editing affordance
        frag.appendChild(head);
        mine.forEach(function (b) { markHome(b); frag.appendChild(b); });
      });
      box.insertBefore(frag, box.firstChild);
    }

    // 3) native headers left without any channel before the next header hide;
    //    with no categories at all, everything is back to native — unhide all
    [].slice.call(box.querySelectorAll('.sml-gshell__category:not([data-sml-gcat])')).forEach(function (h) {
      if (!S.categories.length) { h.style.display = ''; return; }
      var n = h.nextElementSibling, has = false;
      while (n && !(n.classList && n.classList.contains('sml-gshell__category'))) {
        if (n.classList && n.classList.contains('sml-gshell__channel')) { has = true; break; }
        n = n.nextElementSibling;
      }
      h.style.display = has ? '' : 'none';
    });

    ensureGear(box);
  }

  /* ---------- manage panel (owner/admin only) ---------- */
  var PANEL = null;
  function ensureGear(box) {
    if (!S.canManage || box.querySelector('#sml-gcat-gear')) return;
    var g = document.createElement('button');
    g.type = 'button';
    g.id = 'sml-gcat-gear';
    g.textContent = '⚙ Categories';
    g.style.cssText = 'display:block;width:calc(100% - 16px);margin:10px 8px 12px;padding:7px 10px;font:600 11px/1.2 inherit;letter-spacing:1px;color:#8fa89b;background:transparent;border:1px dashed #2a3a32;border-radius:8px;cursor:pointer;';
    g.addEventListener('click', openPanel);
    box.appendChild(g);
  }

  function el(tag, css, parent, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (parent) parent.appendChild(e);
    if (text != null) e.textContent = text;
    return e;
  }

  function openPanel() {
    if (PANEL) { PANEL.remove(); PANEL = null; }
    var cats = S.categories.slice();
    var asgn = {};
    Object.keys(S.assignments).forEach(function (k) { asgn[k] = S.assignments[k]; });
    if (!cats.length) cats = ['Announcements', 'Onboarding', 'Video', 'News']; // suggestions — members never see them unless channels are assigned

    PANEL = el('div', 'position:fixed;inset:0;z-index:2147480000;display:flex;align-items:center;justify-content:center;background:rgba(3,8,6,0.72);', document.body);
    var card = el('div', 'width:min(520px,92vw);max-height:84vh;overflow:auto;background:#0b1210;border:1px solid #1e2f27;border-radius:14px;padding:18px 20px;color:#e6f2ea;font:14px/1.5 -apple-system,Segoe UI,sans-serif;box-shadow:0 24px 80px rgba(0,0,0,.7);', PANEL);
    el('div', 'font:700 16px inherit;margin-bottom:2px;', card, 'Channel categories');
    el('div', 'font-size:12px;color:#8fa89b;margin-bottom:14px;', card, 'Name your categories and assign channels. Members only see a category once it has channels.');

    var catBox = el('div', 'display:flex;flex-direction:column;gap:6px;margin-bottom:14px;', card);
    function drawCats() {
      catBox.innerHTML = '';
      cats.forEach(function (name, i) {
        var row = el('div', 'display:flex;gap:6px;align-items:center;', catBox);
        var inp = el('input', 'flex:1;min-width:120px;background:#0f1a15;border:1px solid #24382e;border-radius:8px;color:#e6f2ea;padding:7px 10px;font:inherit;', row);
        inp.type = 'text'; inp.value = name;
        inp.addEventListener('input', function () {
          // renames carry their channel assignments along (else save orphans them)
          var old = cats[i];
          var next = capPoints(inp.value); // code-point cap, surrogate-safe
          if (next !== inp.value) inp.value = next;
          cats[i] = next;
          Object.keys(asgn).forEach(function (k) { if (asgn[k] === old) asgn[k] = next; });
        });
        inp.addEventListener('change', drawAssign);
        [['↑', -1], ['↓', 1]].forEach(function (mv) {
          var b = el('button', 'background:#101c16;border:1px solid #24382e;border-radius:7px;color:#8fa89b;padding:6px 9px;cursor:pointer;', row, mv[0]);
          b.type = 'button';
          b.addEventListener('click', function () {
            var j = i + mv[1];
            if (j < 0 || j >= cats.length) return;
            var t = cats[i]; cats[i] = cats[j]; cats[j] = t;
            drawCats(); drawAssign();
          });
        });
        var del = el('button', 'background:#1a1012;border:1px solid #3a2428;border-radius:7px;color:#ff8a96;padding:6px 9px;cursor:pointer;', row, '✕');
        del.type = 'button';
        del.addEventListener('click', function () {
          var gone = cats.splice(i, 1)[0];
          Object.keys(asgn).forEach(function (k) { if (asgn[k] === gone) delete asgn[k]; });
          drawCats(); drawAssign();
        });
      });
      var add = el('button', 'align-self:flex-start;background:transparent;border:1px dashed #2a3a32;border-radius:8px;color:#38F58A;padding:6px 12px;cursor:pointer;font:600 12px inherit;', catBox, '+ Add category');
      add.type = 'button';
      add.addEventListener('click', function () { if (cats.length < 30) { cats.push(''); drawCats(); drawAssign(); } });
    }

    el('div', 'font:700 12px inherit;letter-spacing:1px;color:#8fa89b;margin:4px 0 6px;', card, 'CHANNELS');
    var chBox = el('div', 'display:flex;flex-direction:column;gap:5px;margin-bottom:16px;', card);
    function drawAssign() {
      chBox.innerHTML = '';
      var box = channelsBox();
      var btns = box ? channelButtons(box) : [];
      if (!btns.length) { el('div', 'color:#8fa89b;font-size:12px;', chBox, 'No channels found in the sidebar.'); return; }
      btns.forEach(function (b) {
        var id = b.getAttribute('data-smlgs-channel');
        var row = el('div', 'display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;', chBox);
        el('span', 'flex:1 1 140px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', row, (b.textContent || '').trim());
        var sel = el('select', 'flex:0 1 auto;max-width:100%;background:#0f1a15;border:1px solid #24382e;border-radius:7px;color:#e6f2ea;padding:5px 8px;font:12px inherit;', row);
        var none = document.createElement('option');
        none.value = ''; none.textContent = '— default —';
        sel.appendChild(none);
        cats.forEach(function (c) {
          var name = norm(c);
          if (!name) return;
          var o = document.createElement('option');
          o.value = name; o.textContent = name;
          if (norm(asgn[id]) === name) o.selected = true;
          sel.appendChild(o);
        });
        sel.title = sel.value || '';
        sel.addEventListener('change', function () {
          if (sel.value) asgn[id] = sel.value; else delete asgn[id];
          sel.title = sel.value || '';
        });
      });
    }
    drawCats(); drawAssign();

    var foot = el('div', 'display:flex;gap:10px;justify-content:flex-end;align-items:center;', card);
    var note = el('span', 'margin-right:auto;font-size:12px;color:#8fa89b;', foot, '');
    var cancel = el('button', 'background:transparent;border:1px solid #24382e;border-radius:8px;color:#8fa89b;padding:8px 16px;cursor:pointer;font:600 12px inherit;', foot, 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    var save = el('button', 'background:#38F58A;border:0;border-radius:8px;color:#04120a;padding:8px 18px;cursor:pointer;font:700 12px inherit;', foot, 'Save');
    save.type = 'button';
    save.addEventListener('click', function () {
      var clean = [], seen = {}, dup = null;
      cats.forEach(function (c) {
        var name = norm(c);
        if (!name) return;
        var key = name.toLowerCase();
        if (seen[key]) { dup = name; return; }
        seen[key] = 1; clean.push(name);
      });
      if (dup) { note.textContent = 'Duplicate category name: "' + dup + '" — make names unique.'; return; }
      var outAsgn = {};
      Object.keys(asgn).forEach(function (k) {
        var v = norm(asgn[k]);
        if (v && clean.indexOf(v) !== -1) outAsgn[k] = v;
      });
      note.textContent = 'Saving…';
      fetch(API, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
        body: JSON.stringify({ categories: clean, assignments: outAsgn })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j || res.j.saved !== true) { note.textContent = (res.j && res.j.message) || 'Could not save.'; return; }
          S.categories = res.j.categories || [];
          S.assignments = res.j.assignments || {};
          close(); apply();
        })
        .catch(function () { note.textContent = 'Could not save.'; });
    });

    function close() { if (PANEL) { PANEL.remove(); PANEL = null; } document.removeEventListener('keydown', esc, true); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc, true);
    PANEL.addEventListener('click', function (e) { if (e.target === PANEL) close(); });
  }

  /* ---------- boot ---------- */
  function load() {
    function go(withNonce) {
      var h = {};
      if (withNonce && NONCE) h['X-WP-Nonce'] = NONCE; // without it, core demotes cookie sessions to user 0 and can_manage is false for owners
      return fetch(API, { credentials: 'same-origin', headers: h });
    }
    return go(true)
      .then(function (r) {
        if (r.ok) return r.json();
        if (NONCE) return go(false).then(function (r2) { return r2.ok ? r2.json() : null; }); // stale nonce: fall back to read-only grouping
        return null;
      })
      .then(function (d) {
        if (!d) return false;
        S.categories = Array.isArray(d.categories) ? d.categories : [];
        S.assignments = (d.assignments && typeof d.assignments === 'object') ? d.assignments : {};
        S.canManage = !!d.can_manage;
        return true;
      })
      .catch(function () { return false; });
  }

  var debounce = null;
  function ours(node) {
    return node && node.nodeType === 1 && (node.hasAttribute('data-sml-gcat') || node.hasAttribute('data-sml-gcat-ph') || node.id === 'sml-gcat-gear');
  }
  function watch() {
    new MutationObserver(function (muts) {
      // ignore batches that are entirely our own header/gear churn
      var foreign = muts.some(function (mu) {
        var nodes = [].slice.call(mu.addedNodes).concat([].slice.call(mu.removedNodes));
        return nodes.some(function (n) { return !ours(n); });
      });
      if (!foreign) return;
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        var box = channelsBox();
        if (!box) return;
        if (box !== S.lastBox || !grouped(box) || (S.canManage && !box.querySelector('#sml-gcat-gear'))) apply();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true }); // body: the shell may REPLACE the container node
  }

  function boot() {
    load().then(function (ok) {
      if (!ok) return;
      var tries = 0;
      var iv = setInterval(function () {
        var box = channelsBox();
        if (box && channelButtons(box).length) {
          clearInterval(iv);
          apply(); watch();
        } else if (++tries > 90) { clearInterval(iv); }
      }, 700);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
