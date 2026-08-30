/*!
 * SML Group Categories — freely nameable Discord-style channel categories.
 *
 * Companion layer over the groups engine's sidebar: reads per-group category
 * names + channel assignments from sml-gcat/v1 and REGROUPS the existing
 * sidebar VISUALLY under those headers. It never creates or deletes a
 * channel — and, critically, it never MOVES an engine node at all.
 *
 * Adversarially reviewed 2026-08-30, then hardened against the live engine:
 *  - the bootstrap GET sends X-WP-Nonce (core demotes cookie-authed REST
 *    without it to user 0, which would hide the manage gear from owners
 *    forever); an expired nonce retries once anonymously so members still
 *    get read-only grouping.
 *  - regrouping is pure CSS — and (since the jump fix, 2026-08-30 PM) the
 *    channel orders live in ONE injected STYLESHEET keyed by channel id,
 *    not in inline styles on engine nodes. The live shell REBUILDS every
 *    channel button every ~10s; with inline orders each rebuild produced
 *    buttons with order:auto (= 0) that jumped to the TOP of the flex
 *    column until the next debounced re-apply — the "sidebar jumping"
 *    bug. A stylesheet rule matches the recreated button the instant the
 *    shell inserts it, so a rebuild now changes nothing visually. The
 *    box itself is only marked with data-sml-gcat-active; everything
 *    without a per-id rule defaults to order:100000 (the native zone,
 *    ties resolved by DOM order = the engine's own order).
 *  - our headers are APPENDED (new nodes only) and float up via inline
 *    order (category order minus 1 — an appended header must beat its
 *    channels' tie-break or it lands under them). apply() is INCREMENTAL:
 *    it only appends missing headers, removes stale ones, and writes
 *    changed style values — a no-op apply produces zero mutations, so the
 *    body observer can never feed itself (the old clear-and-rebuild pass
 *    re-created every header on every pass and amplified shell churn).
 *  - physically moving buttons is still fatal (verified live): the shell
 *    keeps insertBefore anchors on the channel buttons and throws
 *    NotFoundError, then wipes the sidebar in the ensuing observer
 *    tug-of-war. DOM order always stays the engine's.
 *  - empty categories render ONLY for managers (dimmed) — members never see
 *    dead headers from suggestions or restricted channels.
 *  - the observer watches document.body (the shell can replace the container
 *    node) and skips batches while apply() itself is mutating (an `applying`
 *    flag cleared on a macrotask, after the observer's microtask fires); any
 *    other change — including something removing OUR nodes — re-applies
 *    after an 80ms debounce (was 400ms; headers should be back within a
 *    frame or two of a shell rebuild).
 *  - panel: renames carry assignments along; names are trimmed everywhere;
 *    duplicate names block Save; category cap is code-point safe; channel
 *    ↑/↓ reordering persists through sml-gcat/v1/reorder into the ENGINE's
 *    own order_index column (its sidebar sorts ORDER BY order_index, id),
 *    so the saved order is real for every member, JS or not.
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

  /* ---------- CSS-order regrouping (no engine node is ever moved OR written) ---------- */
  var NATIVE_BASE = 100000; // stylesheet default zone: DOM-order ties keep the engine's own order

  var SHEET_ID = 'sml-gcat-style';
  var sheetKey = null;
  function ensureSheet() {
    var want = JSON.stringify([S.categories, S.assignments]);
    var sheet = document.getElementById(SHEET_ID);
    if (sheet && sheetKey === want) return;
    var css = [
      '.sml-gshell__channels[data-sml-gcat-active]{display:flex;flex-direction:column;}',
      '.sml-gshell__channels[data-sml-gcat-active]>*{order:' + NATIVE_BASE + ';}'
    ];
    S.categories.forEach(function (cat, ci) {
      var ord = (ci + 1) * 1000;
      Object.keys(S.assignments).forEach(function (id) {
        if (S.assignments[id] !== cat) return;
        var n = parseInt(id, 10);
        if (n > 0) css.push('.sml-gshell__channels[data-sml-gcat-active]>[data-smlgs-channel="' + n + '"]{order:' + ord + ';}');
      });
    });
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = SHEET_ID;
      (document.head || document.documentElement).appendChild(sheet); // head, not body: never re-fires our own observer
    }
    sheet.textContent = css.join('\n');
    sheetKey = want;
  }

  function clearOurs(box) {
    [].slice.call(box.querySelectorAll('.sml-gshell__category[data-sml-gcat]')).forEach(function (h) { h.remove(); });
    box.removeAttribute('data-sml-gcat-active');
    [].slice.call(box.children).forEach(function (el) {
      // legacy cleanup: earlier versions wrote inline orders on engine nodes
      if (el.id !== 'sml-gcat-gear') el.style.removeProperty('order');
      if (el.hasAttribute('data-sml-gcat-ord')) el.removeAttribute('data-sml-gcat-ord');
    });
    box.style.removeProperty('display');
    box.style.removeProperty('flex-direction');
  }

  // drop any assignment whose category is not declared, at every ingest —
  // the server intersects too, but a single orphaned assignment would make
  // grouped() permanently false and drive a constant apply loop (review #3)
  function intersectAssignments() {
    Object.keys(S.assignments).forEach(function (k) {
      if (S.categories.indexOf(S.assignments[k]) === -1) delete S.assignments[k];
    });
  }

  // headers that SHOULD exist right now: every category for managers
  // (empty ones dimmed), only populated ones for members. Order is the
  // category order minus 1 so an appended header always sorts above its
  // channels' shared order despite losing the DOM-order tie-break.
  function desiredHeaders(box) {
    var present = Object.create(null);
    channelButtons(box).forEach(function (b) {
      var a = S.assignments[b.getAttribute('data-smlgs-channel')];
      if (a) present[a] = (present[a] || 0) + 1;
    });
    var out = [];
    S.categories.forEach(function (cat, ci) {
      var count = present[cat] || 0;
      if (!count && !S.canManage) return; // members never see empty headers
      out.push({ name: cat, order: (ci + 1) * 1000 - 1, empty: !count });
    });
    return out;
  }

  function grouped(box) {
    var ours = [].slice.call(box.querySelectorAll('.sml-gshell__category[data-sml-gcat]'));
    if (!S.categories.length) return !ours.length;
    if (!box.hasAttribute('data-sml-gcat-active')) return false;
    var want = desiredHeaders(box);
    if (ours.length !== want.length) return false;
    var byName = Object.create(null); // null proto: a category named "__proto__" must not alias (review #12)
    ours.forEach(function (h) { byName[h.textContent] = h; });
    return want.every(function (w) {
      var h = byName[w.name];
      return !!h && h.style.order === String(w.order) && h.style.opacity === (w.empty ? '0.45' : '');
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

      if (!S.categories.length) {
        clearOurs(box);
        hideEmpties(box);
        ensureGear(box);
        return;
      }

      ensureSheet();
      if (!box.hasAttribute('data-sml-gcat-active')) box.setAttribute('data-sml-gcat-active', '1');

      // incremental header sync: reuse by name, only touch what differs
      var want = desiredHeaders(box);
      var wantByName = Object.create(null);
      want.forEach(function (w) { wantByName[w.name] = w; });
      var byName = Object.create(null);
      [].slice.call(box.querySelectorAll('.sml-gshell__category[data-sml-gcat]')).forEach(function (h) {
        var nm = h.textContent;
        if (!wantByName[nm] || byName[nm]) { h.remove(); return; } // stale or duplicate
        byName[nm] = h;
      });
      want.forEach(function (w) {
        var h = byName[w.name];
        if (!h) {
          h = document.createElement('div');
          h.className = 'sml-gshell__category';
          h.setAttribute('data-sml-gcat', '1');
          h.textContent = w.name;
          box.appendChild(h);
        }
        if (h.style.order !== String(w.order)) h.style.order = String(w.order);
        if (w.empty) { if (h.style.opacity !== '0.45') h.style.opacity = '0.45'; } // manager-only editing affordance
        else if (h.style.opacity !== '') h.style.removeProperty('opacity');
      });

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
    if (g.style.order !== '999999') g.style.order = '999999'; // visually last in the flex column
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

    // channel data comes from the ENGINE's own list endpoint (bare DB names —
    // the sidebar's "#" is decoration), falling back to sidebar buttons
    // read-only when it can't be reached. Creation uses the engine's own
    // create endpoint; only rename and reorder need our companion routes.
    var gid = (window.SMLGroupShell && window.SMLGroupShell.groupId) ? parseInt(window.SMLGroupShell.groupId, 10) : 0;
    var chans = null;                    // [{id, name, type, ro}] — null while loading; ARRAY ORDER = sidebar order
    var orig = Object.create(null);      // id -> name at panel open
    var origSeq = '';                    // id sequence at load (+ later creates) — reorder saves only when it changed
    var createdAny = false;
    var CH_TYPES = ['text', 'alerts', 'education', 'voice', 'live'];
    function loadChannels() {
      function fromSidebar() {
        var box = channelsBox();
        chans = (box ? channelButtons(box) : []).map(function (b) {
          return { id: parseInt(b.getAttribute('data-smlgs-channel'), 10), name: (b.textContent || '').trim().replace(/^#\s*/, ''), type: '', ro: true };
        });
        chans.forEach(function (c) { orig[c.id] = c.name; });
        origSeq = chans.map(function (c) { return c.id; }).join(',');
      }
      if (!gid) { fromSidebar(); drawAssign(); return; }
      fetch('/wp-json/sml/v1/group/channels?group_id=' + gid, { credentials: 'same-origin', headers: NONCE ? { 'X-WP-Nonce': NONCE } : {} })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var list = j && (Array.isArray(j.channels) ? j.channels : (Array.isArray(j) ? j : null));
          if (!list) { fromSidebar(); }
          else {
            chans = list.map(function (c) { return { id: parseInt(c.id, 10), name: String(c.name || ''), type: String(c.type || 'text'), ro: false }; });
            chans.forEach(function (c) { orig[c.id] = c.name; });
            origSeq = chans.map(function (c) { return c.id; }).join(',');
          }
          drawAssign();
        })
        .catch(function () { fromSidebar(); drawAssign(); });
    }

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

    el('div', 'font:700 12px inherit;letter-spacing:1px;color:#8fa89b;margin:4px 0 6px;', card, 'CHANNELS — rename, reorder (↑↓) and pick a category');
    var chBox = el('div', 'display:flex;flex-direction:column;gap:5px;margin-bottom:10px;', card);
    function catSelect(row, id) {
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
      return sel;
    }
    function drawAssign() {
      chBox.innerHTML = '';
      if (chans === null) { el('div', 'color:#8fa89b;font-size:12px;', chBox, 'Loading channels…'); return; }
      if (!chans.length) { el('div', 'color:#8fa89b;font-size:12px;', chBox, 'No channels yet — add one below.'); return; }
      chans.forEach(function (c, idx) {
        var row = el('div', 'display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;', chBox);
        if (!c.ro) {
          // ↑/↓ move the channel in the ENGINE's real order (order_index) on Save
          [['↑', -1], ['↓', 1]].forEach(function (mv) {
            var edge = mv[1] === -1 ? idx === 0 : idx === chans.length - 1;
            var b = el('button', 'flex:0 0 auto;background:#101c16;border:1px solid #24382e;border-radius:7px;color:#8fa89b;padding:4px 8px;cursor:pointer;font:12px inherit;' + (edge ? 'opacity:.35;cursor:default;' : ''), row, mv[0]);
            b.type = 'button';
            b.addEventListener('click', function () {
              var j = idx + mv[1];
              if (j < 0 || j >= chans.length) return;
              var t = chans[idx]; chans[idx] = chans[j]; chans[j] = t;
              drawAssign();
            });
          });
        }
        el('span', 'flex:0 0 auto;color:#8fa89b;font-size:13px;', row, '#');
        var nm = el('input', 'flex:1 1 130px;min-width:110px;background:#0f1a15;border:1px solid #24382e;border-radius:7px;color:#e6f2ea;padding:5px 8px;font:13px inherit;', row);
        nm.type = 'text'; nm.value = c.name; nm.maxLength = 120;
        if (c.ro) { nm.readOnly = true; nm.style.opacity = '0.6'; nm.title = 'Renaming unavailable — channel list could not be loaded.'; }
        else { nm.addEventListener('input', function () { c.name = nm.value; }); }
        if (c.type) el('span', 'flex:0 0 auto;font-size:10px;letter-spacing:1px;color:#5f7a6c;text-transform:uppercase;', row, c.type);
        catSelect(row, c.id);
      });
    }

    // ---- add channel (the engine's own create endpoint does the work) ----
    var addWrap = el('div', 'display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin-bottom:6px;padding-top:8px;border-top:1px dashed #1e2f27;', card);
    var newName = el('input', 'flex:1 1 130px;min-width:110px;background:#0f1a15;border:1px solid #24382e;border-radius:7px;color:#e6f2ea;padding:6px 9px;font:13px inherit;', addWrap);
    newName.type = 'text'; newName.placeholder = 'new-channel-name'; newName.maxLength = 120;
    var newType = el('select', 'flex:0 1 auto;background:#0f1a15;border:1px solid #24382e;border-radius:7px;color:#e6f2ea;padding:6px 8px;font:12px inherit;', addWrap);
    CH_TYPES.forEach(function (ty) {
      var o = document.createElement('option');
      o.value = ty; o.textContent = ty;
      newType.appendChild(o);
    });
    var addBtn = el('button', 'background:#101c16;border:1px solid #2a3a32;border-radius:7px;color:#38F58A;padding:6px 12px;cursor:pointer;font:600 12px inherit;', addWrap, '+ Add channel');
    addBtn.type = 'button';
    var addNote = el('div', 'font-size:11px;color:#8fa89b;margin-bottom:14px;', card, gid
      ? 'New channels appear for everyone after saving. Channels with "alert" in the name (or the alerts type) only allow group admins to post.'
      : 'Adding channels is unavailable on this page load.');
    if (!gid) { addBtn.disabled = true; addBtn.style.opacity = '0.5'; }
    addBtn.addEventListener('click', function () {
      var name = norm(newName.value);
      if (!name) { addNote.textContent = 'Give the new channel a name first.'; return; }
      addBtn.disabled = true; addNote.textContent = 'Creating…';
      fetch('/wp-json/sml/v1/group/channel/create', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
        body: JSON.stringify({ group_id: gid, name: name, type: newType.value })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          addBtn.disabled = false;
          var ch = res.ok && res.j && res.j.channel;
          if (!ch || !ch.id) { addNote.textContent = (res.j && res.j.message) || 'Could not create the channel.'; return; }
          createdAny = true;
          chans = chans || [];
          chans.push({ id: parseInt(ch.id, 10), name: String(ch.name || name), type: String(ch.type || newType.value), ro: false });
          orig[ch.id] = String(ch.name || name);
          // the engine appends creates at MAX(order_index)+1 — extending the
          // baseline keeps "did the user reorder?" honest across a create
          origSeq = origSeq ? origSeq + ',' + ch.id : String(ch.id);
          newName.value = '';
          addNote.textContent = '#' + ch.name + ' created — assign it a category, then Save.';
          drawAssign();
        })
        .catch(function () { addBtn.disabled = false; addNote.textContent = 'Could not create the channel.'; });
    });

    drawCats(); loadChannels();

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
      // channel renames go first, one at a time (our companion route), then
      // the reorder (engine order_index), then the categories; renamed,
      // created, or reordered channels need a reload because the engine
      // renders the sidebar (names and DOM order), not us
      var renames = (chans || []).filter(function (c) {
        return !c.ro && norm(c.name) !== '' && norm(c.name) !== orig[c.id];
      });
      var anyRo = (chans || []).some(function (c) { return c.ro; });
      var seq = (chans || []).map(function (c) { return c.id; }).join(',');
      var orderChanged = !anyRo && chans !== null && seq !== origSeq;
      note.textContent = 'Saving…';
      save.disabled = true;
      var chain = Promise.resolve(true);
      renames.forEach(function (c) {
        chain = chain.then(function (okSoFar) {
          if (!okSoFar) return false;
          return fetch('/wp-json/sml-gcat/v1/channel?slug=' + encodeURIComponent(SLUG), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
            body: JSON.stringify({ channel_id: c.id, name: norm(c.name) })
          }).then(function (r) { return r.json().then(function (j) { return r.ok && j && j.saved === true; }); })
            .catch(function () { return false; });
        });
      });
      chain.then(function (renamesOk) {
        if (!renamesOk) { save.disabled = false; note.textContent = 'A channel rename failed — nothing else was saved.'; return; }
        var reorderStep = !orderChanged ? Promise.resolve(true)
          : fetch('/wp-json/sml-gcat/v1/reorder?slug=' + encodeURIComponent(SLUG), {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
              body: JSON.stringify({ order: (chans || []).map(function (c) { return c.id; }) })
            }).then(function (r) { return r.json().then(function (j) { return r.ok && j && j.saved === true; }); })
              .catch(function () { return false; });
        reorderStep.then(function (orderOk) {
          if (!orderOk) { save.disabled = false; note.textContent = 'Saving the channel order failed — categories were not saved.'; return; }
          fetch(API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
            body: JSON.stringify({ categories: clean, assignments: outAsgn })
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
              save.disabled = false;
              if (!res.ok || !res.j || res.j.saved !== true) { note.textContent = (res.j && res.j.message) || 'Could not save.'; return; }
              S.categories = res.j.categories || [];
              S.assignments = res.j.assignments || {};
              intersectAssignments();
              if (renames.length || createdAny || orderChanged) { note.textContent = 'Saved — reloading…'; location.reload(); return; }
              close(); apply();
            })
            .catch(function () { save.disabled = false; note.textContent = 'Could not save.'; });
        });
      });
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
      }, 80); // fast: the shell rebuilds every button ~10s and wipes our headers — they must be back within a frame or two. Channel ORDER survives rebuilds by itself now (stylesheet rules, not inline styles), so a pending debounce no longer shows a shuffled sidebar.
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
