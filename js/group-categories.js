/*!
 * SML Group Categories — freely nameable Discord-style channel categories.
 *
 * Companion layer over the groups engine's sidebar: reads per-group category
 * names + channel assignments from sml-gcat/v1 and REGROUPS the existing
 * sidebar VISUALLY under those headers. It never creates, renames, or deletes
 * a channel — and, critically, it never MOVES an engine node at all.
 *
 * Adversarially reviewed 2026-08-30, then hardened against the live engine:
 *  - the bootstrap GET sends X-WP-Nonce (core demotes cookie-authed REST
 *    without it to user 0, which would hide the manage gear from owners
 *    forever); an expired nonce retries once anonymously so members still
 *    get read-only grouping.
 *  - regrouping is pure CSS: the container becomes a flex column and every
 *    child gets an inline `order`; our headers are APPENDED (new nodes only)
 *    and float up via their order. Verified live that physically moving
 *    buttons breaks the engine — its installer keeps insertBefore anchors on
 *    the channel buttons and throws NotFoundError, then wipes the sidebar in
 *    the ensuing observer tug-of-war. DOM order always stays the engine's.
 *  - empty categories render ONLY for managers (dimmed) — members never see
 *    dead headers from suggestions or restricted channels.
 *  - the observer watches document.body (the shell can replace the container
 *    node) and skips batches while apply() itself is mutating (an `applying`
 *    flag cleared on a macrotask, after the observer's microtask fires); any
 *    other change — including something removing OUR nodes — re-applies.
 *  - grouped() checks per-button correctness (inline order + data-sml-gcat-ord
 *    matching the assignment), so an engine re-render that recreates or
 *    resets a button triggers a re-apply.
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

  /* ---------- CSS-order regrouping (no engine node ever moves) ---------- */
  var NATIVE_BASE = 100000; // non-category children keep engine DOM order up here

  function clearOurs(box) {
    [].slice.call(box.querySelectorAll('.sml-gshell__category[data-sml-gcat]')).forEach(function (h) { h.remove(); });
    [].slice.call(box.children).forEach(function (el) {
      el.style.removeProperty('order');
      if (el.hasAttribute('data-sml-gcat-ord')) el.removeAttribute('data-sml-gcat-ord');
    });
  }

  // drop any assignment whose category is not declared, at every ingest —
  // the server intersects too, but a single orphaned assignment would make
  // grouped() permanently false and drive a 400ms apply loop (review #3)
  function intersectAssignments() {
    Object.keys(S.assignments).forEach(function (k) {
      if (S.categories.indexOf(S.assignments[k]) === -1) delete S.assignments[k];
    });
  }

  function grouped(box) {
    // per-button correctness: every present assigned button must carry the
    // inline order + marker apply() gave it (a recreated/reset button fails)
    var headsPresent = !!box.querySelector('.sml-gshell__category[data-sml-gcat]');
    var assigned = channelButtons(box).filter(function (b) {
      var a = S.assignments[b.getAttribute('data-smlgs-channel')];
      return !!a && S.categories.indexOf(a) !== -1;
    });
    if (!S.categories.length) return !headsPresent;
    if (!assigned.length) {
      // managers keep dimmed empty headers; for members every header is dead
      // weight and must be torn down (review #4: engine deleting the last
      // assigned channel used to leave the member a permanent empty header)
      return S.canManage ? headsPresent : !headsPresent;
    }
    return headsPresent && assigned.every(function (b) {
      return b.style.order !== '' && b.getAttribute('data-sml-gcat-ord') === S.assignments[b.getAttribute('data-smlgs-channel')];
    });
  }

  var applying = false;
  function apply() {
    var box = channelsBox();
    if (!box) return;
    var btns = channelButtons(box);

    applying = true;
    try {
      // never build headers over an empty box mid-re-render — the engine is
      // between "cleared" and "repopulated"; the observer retries when it
      // fills. The gear still renders so a manager of a channel-less group
      // can reach the panel at all (review #13).
      if (S.categories.length && !btns.length) { ensureGear(box); return; }

      S.lastBox = box;
      clearOurs(box);

      if (S.categories.length) {
        box.style.display = 'flex';
        box.style.flexDirection = 'column';

        // engine children keep their own relative order, shifted after ours
        [].slice.call(box.children).forEach(function (el, i) {
          el.style.order = String(NATIVE_BASE + i);
        });

        S.categories.forEach(function (cat, ci) {
          var mine = btns.filter(function (b) { return S.assignments[b.getAttribute('data-smlgs-channel')] === cat; });
          if (!mine.length && !S.canManage) return; // members never see empty headers
          var head = document.createElement('div');
          head.className = 'sml-gshell__category';
          head.setAttribute('data-sml-gcat', '1');
          head.textContent = cat;
          head.style.order = String((ci + 1) * 1000);
          if (!mine.length) head.style.opacity = '0.45'; // manager-only editing affordance
          box.appendChild(head);
          mine.forEach(function (b, j) {
            b.style.order = String((ci + 1) * 1000 + j + 1);
            b.setAttribute('data-sml-gcat-ord', cat);
          });
        });
      } else {
        box.style.removeProperty('display');
        box.style.removeProperty('flex-direction');
      }

      hideEmpties(box);
      ensureGear(box);
    } finally {
      // cleared on a macrotask: the observer's microtask for our own
      // mutations fires first and sees applying === true
      setTimeout(function () { applying = false; }, 0);
    }
  }

  // native headers whose every own channel moved to a category hide (the
  // walk is DOM order, which we never change; the portal button has no
  // channel id and counts as staying). Runs from the observer too, because
  // an unassigned channel the engine adds under an already-hidden header
  // must un-hide it without a full re-apply (review #5).
  function hideEmpties(box) {
    [].slice.call(box.querySelectorAll('.sml-gshell__category:not([data-sml-gcat])')).forEach(function (h) {
      if (!S.categories.length) { h.style.display = ''; return; }
      var n = h.nextElementSibling, has = false;
      while (n && !(n.classList && n.classList.contains('sml-gshell__category'))) {
        if (n.classList && n.classList.contains('sml-gshell__channel')) {
          var id = n.getAttribute('data-smlgs-channel');
          if (!id || !S.assignments[id]) { has = true; break; }
        }
        n = n.nextElementSibling;
      }
      h.style.display = has ? '' : 'none';
    });
  }

  /* ---------- manage panel (owner/admin only) ---------- */
  var PANEL = null;
  function ensureGear(box) {
    var g = box.querySelector('#sml-gcat-gear');
    if (!S.canManage) { if (g) g.remove(); return; }
    if (!g) {
      g = document.createElement('button');
      g.type = 'button';
      g.id = 'sml-gcat-gear';
      g.textContent = '⚙ Categories';
      g.style.cssText = 'display:block;width:calc(100% - 16px);margin:10px 8px 12px;padding:7px 10px;font:600 11px/1.2 inherit;letter-spacing:1px;color:#8fa89b;background:transparent;border:1px dashed #2a3a32;border-radius:8px;cursor:pointer;';
      g.addEventListener('click', openPanel);
      box.appendChild(g);
    }
    g.style.order = '999999'; // visually last in the flex column
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
    // panel-internal assignments are keyed by category INDEX, not name — a
    // rename that transiently collides with another category's name must not
    // merge their channel sets (review #10)
    var asgn = Object.create(null); // channelId -> index into cats
    Object.keys(S.assignments).forEach(function (k) {
      var i = cats.indexOf(S.assignments[k]);
      if (i !== -1) asgn[k] = i;
    });
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
          // index-keyed assignments ride along with the rename for free
          var next = capPoints(inp.value); // code-point cap, surrogate-safe
          if (next !== inp.value) inp.value = next;
          cats[i] = next;
        });
        inp.addEventListener('change', drawAssign);
        [['↑', -1], ['↓', 1]].forEach(function (mv) {
          var b = el('button', 'background:#101c16;border:1px solid #24382e;border-radius:7px;color:#8fa89b;padding:6px 9px;cursor:pointer;', row, mv[0]);
          b.type = 'button';
          b.addEventListener('click', function () {
            var j = i + mv[1];
            if (j < 0 || j >= cats.length) return;
            var t = cats[i]; cats[i] = cats[j]; cats[j] = t;
            Object.keys(asgn).forEach(function (k) {
              if (asgn[k] === i) asgn[k] = j; else if (asgn[k] === j) asgn[k] = i;
            });
            drawCats(); drawAssign();
          });
        });
        var del = el('button', 'background:#1a1012;border:1px solid #3a2428;border-radius:7px;color:#ff8a96;padding:6px 9px;cursor:pointer;', row, '✕');
        del.type = 'button';
        del.addEventListener('click', function () {
          cats.splice(i, 1);
          Object.keys(asgn).forEach(function (k) {
            if (asgn[k] === i) delete asgn[k]; else if (asgn[k] > i) asgn[k]--;
          });
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
        cats.forEach(function (c, ci) {
          var name = norm(c);
          if (!name) return;
          var o = document.createElement('option');
          o.value = String(ci); o.textContent = name;
          if (asgn[id] === ci) o.selected = true;
          sel.appendChild(o);
        });
        sel.title = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
        sel.addEventListener('change', function () {
          if (sel.value !== '') asgn[id] = parseInt(sel.value, 10); else delete asgn[id];
          sel.title = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
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
      // null-prototype map: a category literally named "constructor" or
      // "__proto__" must not trip the duplicate check (review #12)
      var clean = [], seen = Object.create(null), dup = null;
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
        var name = norm(cats[asgn[k]]);
        if (name && clean.indexOf(name) !== -1) outAsgn[k] = name;
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
          intersectAssignments();
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
        intersectAssignments();
        return true;
      })
      .catch(function () { return false; });
  }

  var debounce = null;
  function watch() {
    new MutationObserver(function () {
      if (applying) return; // our own apply() churn — everything else re-checks
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        var box = channelsBox();
        if (!box) return;
        if (box !== S.lastBox || !grouped(box) || (S.canManage && !box.querySelector('#sml-gcat-gear'))) apply();
        else hideEmpties(box); // display-only refresh (attribute writes — no childList re-fire)
      }, 400);
    }).observe(document.body, { childList: true, subtree: true }); // body: the shell may REPLACE the container node
  }

  function boot() {
    load().then(function (ok) {
      if (!ok) return;
      // the observer installs unconditionally — a sidebar that renders after
      // the polling window (or a group with no id'd channels yet) must still
      // get grouped/geared when it eventually appears (reviews #6/#13)
      watch();
      var tries = 0;
      var iv = setInterval(function () {
        var box = channelsBox();
        if (box && box.children.length) {
          clearInterval(iv);
          apply();
        } else if (++tries > 90) { clearInterval(iv); }
      }, 700);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
