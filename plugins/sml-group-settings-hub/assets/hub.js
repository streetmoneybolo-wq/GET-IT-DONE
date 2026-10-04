/*! SML Group Settings Hub — one Discord-style settings window per group.
 *  Server: sml-hub/v1 (this plugin). Existing tools are reached, not rebuilt:
 *  Memberships → billing bridge modal, Discord → Discord Connect panels,
 *  Onboarding → onboarding editor, Channel layout → categories gear. Their old
 *  scattered buttons are hidden (body.sml-hub-dedupe) but stay in the DOM so the
 *  hub can click them; the owner can turn that off in Overview. */
(function () {
  'use strict';
  if (window.__smlHubBooted) return;
  window.__smlHubBooted = true;
  var CFG = window.SML_HUB || {};
  if (!CFG.groupId) return;

  var S = { data: null, section: 'overview', members: null, memberSearch: '', memberPage: 1, audit: null, editingRole: null };
  var SECTIONS = [
    ['overview', 'Overview', '⌂'], ['roles', 'Roles', '◆'], ['members', 'Members', '☺'], ['channels', 'Channels', '#'],
    ['memberships', 'Memberships', '💳'], ['discord', 'Discord', '◍'], ['socials', 'Socials', '↗'], ['onboarding', 'Onboarding', '➜']
  ];

  /* ---------- utils ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  /* The REST nonce is baked into the page when it loads and WordPress retires it after 12-24 hours, so a hub left open
     "timed out" with a raw 403. Ask core for a fresh nonce (admin-ajax rest-nonce) and retry the request once; only when
     that also fails is the member truly signed out, and then say so plainly. */
  var nonceRefresh = null;
  function freshNonce() {
    if (!nonceRefresh) {
      var ajax = (CFG.ajax || '/wp-admin/admin-ajax.php');
      nonceRefresh = fetch(ajax + '?action=rest-nonce', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) { t = String(t || '').trim(); if (/^[a-f0-9]{8,12}$/i.test(t)) { CFG.nonce = t; return true; } return false; })
        .catch(function () { return false; })
        .then(function (ok) { setTimeout(function () { nonceRefresh = null; }, 2000); return ok; });
    }
    return nonceRefresh;
  }
  setInterval(function () { freshNonce(); }, 10 * 60 * 1000);
  function api(path, opt, retried) {
    opt = Object.assign({}, opt || {});
    opt.credentials = 'same-origin';
    opt.headers = Object.assign({ 'X-WP-Nonce': CFG.nonce }, opt.headers || {});
    if (opt.body && typeof opt.body !== 'string') { opt.body = JSON.stringify(opt.body); }
    if (opt.body && !opt.headers['Content-Type']) opt.headers['Content-Type'] = 'application/json';
    var url = /^https?:/.test(path) ? path : CFG.api + path;
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var stale = r.status === 403 && j && (j.code === 'rest_cookie_invalid_nonce' || /cookie check failed|nonce/i.test(String(j.message || '')));
          if (stale && !retried) {
            return freshNonce().then(function (ok) {
              if (ok) { opt.headers['X-WP-Nonce'] = CFG.nonce; return api(path, opt, true); }
              throw new Error('Your session ended. Please log in again and reopen Group Settings.');
            });
          }
          if (stale || r.status === 401) throw new Error('Your session ended. Please log in again and reopen Group Settings.');
          throw new Error(j && j.message ? j.message : ('Request failed (' + r.status + ')'));
        }
        return j;
      });
    });
  }
  function G() { return 'group/' + CFG.groupId; }
  function money(c) { return '$' + (Number(c || 0) / 100).toFixed(2); }
  function baseLabel(k) { return (S.data && S.data.base_levels && S.data.base_levels[k]) || k; }
  function roleById(id) { return ((S.data && S.data.roles) || []).filter(function (r) { return r.id === Number(id); })[0]; }
  function can(p) { return !!(S.data && S.data.viewer && (S.data.viewer.is_manager || (S.data.viewer.permissions || {})[p])); }
  function msg(box, text, ok) { var m = box.querySelector('[data-msg]'); if (!m) { m = h('<div data-msg></div>'); box.prepend(m); } m.className = ok ? 'sml-hub__ok' : 'sml-hub__err'; m.textContent = text; m.hidden = !text; }
  function options(list, value) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function baseOptions(value, max) { var out = []; var order = ['member', 'premium', 'analyst', 'mod', 'admin']; order.forEach(function (k) { if (max && order.indexOf(k) > order.indexOf(max)) return; out.push([k, baseLabel(k)]); }); return options(out, value); }
  function refresh() { return api(G()).then(function (d) { S.data = d; return d; }); }

  /* ---------- delegation to the existing tools ---------- */
  function delegate(selector, missing) {
    var el = document.querySelector(selector);
    if (!el) return missing || 'That tool is not loaded on this page.';
    closeHub();
    setTimeout(function () { el.click(); }, 30);
    return '';
  }
  function openProducts() {
    if (typeof window.smlPlatformOpenProducts !== 'function') return 'The billing plugin is not loaded on this page.';
    closeHub();
    setTimeout(window.smlPlatformOpenProducts, 30);
    return '';
  }

  /* ---------- overlays that paint above a dialog ----------
   * The site's fixed header (search, ticker tape) sits at the top of the stacking
   * order and used to cover the top of every panel. While a dialog is open, find
   * whatever paints above it (elementsFromPoint, top-first) and hide that fixed or
   * sticky ancestor; put it back when the dialog closes. Applied to the hub and to
   * the panels it opens (billing, Discord Connect, onboarding). */
  var covered = [];
  function restoreOverlays() { covered.forEach(function (c) { c.el.style.visibility = c.vis; }); covered = []; }
  function suppressOverlays(modal) {
    if (!modal || !document.body.contains(modal) || !document.elementsFromPoint) return;
    restoreOverlays();
    var xs = [8, innerWidth * 0.25, innerWidth * 0.5, innerWidth * 0.75, innerWidth - 8];
    var ys = [6, 40, 90, 140, 200, innerHeight / 2, innerHeight - 10];
    var seen = [];
    xs.forEach(function (x) { ys.forEach(function (y) {
      var stack = document.elementsFromPoint(x, y);
      for (var i = 0; i < stack.length; i++) {
        var el = stack[i];
        if (el === modal || modal.contains(el)) break;
        var root = el;
        while (root && root !== document.body) { var pos = getComputedStyle(root).position; if (pos === 'fixed' || pos === 'sticky') break; root = root.parentElement; }
        if (!root || root === document.body || root === document.documentElement || root.contains(modal) || seen.indexOf(root) >= 0) continue;
        seen.push(root);
        covered.push({ el: root, vis: root.style.visibility });
        root.style.setProperty('visibility', 'hidden', 'important');
      }
    }); });
  }
  var OTHER_DIALOGS = '.sml-dgc-modal,#sml-ob-config,.sml-billing-modal';
  /* Headers that re-render or animate in later: while any dialog is open, re-check once a second. */
  var guardTimer = null;
  function overlayGuard() {
    if (guardTimer) return;
    guardTimer = setInterval(function () {
      var dlg = document.querySelector('.sml-hub,' + OTHER_DIALOGS);
      if (!dlg) { clearInterval(guardTimer); guardTimer = null; restoreOverlays(); return; }
      var probe = [[innerWidth / 2, 12], [innerWidth / 2, 60], [innerWidth - 40, 12], [40, 12]];
      for (var i = 0; i < probe.length; i++) {
        var top = document.elementFromPoint(probe[i][0], probe[i][1]);
        if (top && !dlg.contains(top) && top !== dlg) { suppressOverlays(dlg); return; }
      }
    }, 1000);
  }
  function watchOtherDialogs() {
    if (!window.MutationObserver) return;
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && n.matches && n.matches(OTHER_DIALOGS)) { requestAnimationFrame(function () { suppressOverlays(n); }); setTimeout(function () { if (document.body.contains(n)) suppressOverlays(n); }, 350); overlayGuard(); } });
        Array.prototype.forEach.call(m.removedNodes, function (n) { if (n.nodeType === 1 && n.matches && n.matches(OTHER_DIALOGS) && !document.querySelector(OTHER_DIALOGS + ',.sml-hub')) restoreOverlays(); });
      });
    }).observe(document.body, { childList: true });
  }
  watchOtherDialogs();

  /* ---------- window ---------- */
  var win = null;
  function closeHub() {
    if (win) { win.remove(); win = null; }
    document.body.classList.remove('sml-hub-lock');
    document.removeEventListener('keydown', onKey);
    if (!document.querySelector(OTHER_DIALOGS)) restoreOverlays();
  }
  function onKey(e) { if (e.key === 'Escape') closeHub(); }
  function openHub(section, memberOnly) {
    if (!S.data) return;
    closeHub();
    S.section = section || (memberOnly ? 'socials' : 'overview');
    var list = memberOnly ? SECTIONS.filter(function (s) { return s[0] === 'socials'; }) : SECTIONS;
    win = h('<div class="sml-hub" role="dialog" aria-modal="true" aria-label="Group settings"><div class="sml-hub__win">' +
      '<aside class="sml-hub__nav"><div class="sml-hub__nav-head"><b>' + esc(S.data.group.name || S.data.group.slug) + '</b><small>' + (memberOnly ? 'Follow to unlock' : 'Group settings') + '</small></div><nav class="sml-hub__nav-list" data-nav>' +
      (memberOnly ? '' : '<span class="sml-hub__nav-label">Settings</span>') +
      list.map(function (s) { return '<button type="button" data-go="' + s[0] + '"><span>' + s[2] + '</span>' + esc(s[1]) + '</button>'; }).join('') +
      '</nav></aside><section class="sml-hub__body"><header class="sml-hub__head"><h2 data-title></h2><button type="button" class="sml-hub__close" data-close>Close ✕</button></header><div class="sml-hub__content" data-content></div></section></div></div>');
    win.addEventListener('click', function (e) { if (e.target === win) closeHub(); });
    win.querySelector('[data-close]').onclick = closeHub;
    win.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
    document.body.appendChild(win);
    document.body.classList.add('sml-hub-lock');
    document.addEventListener('keydown', onKey);
    go(S.section);
    var w = win;
    requestAnimationFrame(function () { suppressOverlays(w); });
    setTimeout(function () { if (win === w) suppressOverlays(w); }, 350);
    overlayGuard();
  }
  function go(section) {
    if (!win) return;
    S.section = section;
    win.querySelectorAll('[data-go]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-go') === section); });
    var title = SECTIONS.filter(function (s) { return s[0] === section; })[0];
    win.querySelector('[data-title]').textContent = title ? title[1] : section;
    var c = win.querySelector('[data-content]');
    c.innerHTML = '';
    c.scrollTop = 0;
    (RENDER[section] || RENDER.overview)(c);
  }

  var RENDER = {};

  /* ---------- Overview ---------- */
  RENDER.overview = function (c) {
    var d = S.data, f = d.features || {};
    c.appendChild(h('<div class="sml-hub__stat">' +
      '<div><b>' + esc(d.group.members) + '</b><small>members</small></div>' +
      '<div><b>' + esc((d.roles || []).length) + '</b><small>custom roles</small></div>' +
      '<div><b>' + esc((d.channels || []).length) + '</b><small>channels</small></div>' +
      '<div><b>' + esc((d.plans || []).filter(function (p) { return p.active; }).length) + '</b><small>products</small></div></div>'));
    c.appendChild(h('<p>Owner: <b>' + esc(d.group.owner_name || ('user #' + d.group.owner_id)) + '</b> · <code>/groups/' + esc(d.group.slug) + '/</code></p>'));
    var cards = h('<div class="sml-hub__cards"></div>');
    cards.appendChild(card('Group profile & visuals', 'Name, description, banner, watermark, category — the group editor.', 'Open editor', function () { return delegate('[data-smlgs-edit],.sml-gshell__edit:not(.sml-dgc-owner):not(.sml-hub-open-btn)', 'The group editor button is not on this page.'); }));
    cards.appendChild(card('Channel layout', 'Rename, reorder and group channels under categories.', 'Open layout', function () { return f.categories ? delegate('#sml-gcat-gear', 'The categories gear is not on this page (open the sidebar first).') : 'The Group Categories snippet is not installed.'; }));
    cards.appendChild(card('Membership products', 'Paid tiers, Stripe payouts.', 'Go to Memberships', function () { go('memberships'); return ''; }));
    cards.appendChild(card('Discord', 'Pair a server, map roles, sync channels.', 'Go to Discord', function () { go('discord'); return ''; }));
    c.appendChild(cards);
    if (d.viewer.is_manager) {
      var pref = h('<div class="sml-hub__item"><div class="grow"><b>Hide the old scattered buttons</b><small>Discord Access, Membership Billing, Membership products, Channel Sync and Onboarding buttons stay reachable from here. Turn this off to show them again (instant rollback).</small></div><label><input type="checkbox" data-hide ' + (d.prefs.hide_legacy ? 'checked' : '') + '> Hide</label></div>');
      pref.querySelector('[data-hide]').onchange = function () {
        var cb = this;
        api(G() + '/prefs', { method: 'POST', body: { hide_legacy: cb.checked } }).then(function (r) { S.data.prefs = r.prefs; applyDedupe(); }).catch(function (e) { alert(e.message); cb.checked = !cb.checked; });
      };
      c.appendChild(h('<h3>Housekeeping</h3>'));
      c.appendChild(pref);
      c.appendChild(h('<h3>Recent changes</h3>'));
      var log = h('<div class="sml-hub__list"><p class="note">Loading…</p></div>');
      c.appendChild(log);
      api(G() + '/audit').then(function (r) {
        log.innerHTML = (r.audit || []).length ? r.audit.slice(0, 30).map(function (a) { return '<div class="sml-hub__item"><div class="grow"><b>' + esc(a.action.replace(/_/g, ' ')) + '</b><small>' + esc(a.created_at) + ' · by user #' + esc(a.actor_user_id) + (a.subject_user_id ? ' · on user #' + esc(a.subject_user_id) : '') + '</small></div></div>'; }).join('') : '<p class="note">Nothing yet.</p>';
      }).catch(function () { log.innerHTML = '<p class="note">Could not load the log.</p>'; });
    }
  };
  function card(title, text, btn, onClick) {
    var el = h('<div class="sml-hub__card"><b>' + esc(title) + '</b><p>' + esc(text) + '</p><div class="sml-hub__row"><button type="button" class="sml-hub__btn sml-hub__btn--sm">' + esc(btn) + '</button></div></div>');
    el.querySelector('button').onclick = function () { var err = onClick(); if (err) msg(el, err, false); };
    return el;
  }

  /* ---------- Roles ---------- */
  function permsHtml(perms) {
    var cat = S.data.catalog || {};
    return '<div class="sml-hub__perms">' + Object.keys(cat).map(function (k) {
      return '<label><input type="checkbox" name="perm_' + esc(k) + '" ' + (perms && perms[k] ? 'checked' : '') + '><span>' + esc(cat[k].label) + '<small>' + esc(cat[k].help) + '</small></span></label>';
    }).join('') + '</div>';
  }
  function roleForm(role) {
    var max = S.data.viewer.is_manager ? null : 'analyst';
    var f = h('<form class="sml-hub__form" data-role-form>' +
      '<label>Name<input name="name" maxlength="40" required value="' + esc(role ? role.name : '') + '" placeholder="VIP"></label>' +
      '<label>Color<input type="color" name="color" value="' + esc(role ? role.color : '#38f58a') + '"></label>' +
      '<label class="wide">Base level (what the groups engine enforces)<select name="base_level">' + baseOptions(role ? role.base_level : 'member', max) + '</select></label>' +
      permsHtml(role ? role.permissions : {}) +
      '<div class="sml-hub__actions"><button type="submit" class="sml-hub__btn sml-hub__btn--primary">' + (role ? 'Save role' : 'Create role') + '</button>' + (role ? '<button type="button" class="sml-hub__btn" data-cancel>Cancel</button>' : '') + '</div></form>');
    f.onsubmit = function (e) {
      e.preventDefault();
      var body = { name: f.name.value, color: f.color.value, base_level: f.base_level.value, permissions: {} };
      Object.keys(S.data.catalog || {}).forEach(function (k) { body.permissions[k] = f['perm_' + k].checked; });
      var btn = f.querySelector('[type=submit]'); btn.disabled = true;
      api(G() + '/roles' + (role ? '/' + role.id : ''), { method: 'POST', body: body }).then(function (r) { S.data.roles = r.roles; S.editingRole = null; go('roles'); }).catch(function (err) { btn.disabled = false; msg(f.parentNode, err.message, false); });
    };
    if (role) f.querySelector('[data-cancel]').onclick = function () { S.editingRole = null; go('roles'); };
    return f;
  }
  RENDER.roles = function (c) {
    var d = S.data, counts = d.role_counts || {};
    c.appendChild(h('<p>Custom roles work like Discord roles: a name, a color, and permissions. Each one also maps to a <b>base level</b> the groups engine already understands (Member → Admin), so chat, alerts and moderation keep working. The owner is never a role.</p>'));
    c.appendChild(h('<h3>Built-in levels</h3>'));
    c.appendChild(h('<div class="sml-hub__row">' + ['member', 'premium', 'analyst', 'mod', 'admin'].map(function (k) { return '<span class="sml-hub__chip base">' + esc(baseLabel(k)) + '</span>'; }).join('') + '<span class="sml-hub__chip base">Owner</span></div>'));
    c.appendChild(h('<h3>Custom roles</h3>'));
    if (!can('manage_roles')) c.appendChild(h('<p class="note">You can see roles but not change them.</p>'));
    var list = h('<div class="sml-hub__list"></div>');
    if (!(d.roles || []).length) list.appendChild(h('<p class="note">No custom roles yet.</p>'));
    (d.roles || []).forEach(function (r) {
      if (S.editingRole === r.id) { var w = h('<div class="sml-hub__item" style="display:block"></div>'); w.appendChild(roleForm(r)); list.appendChild(w); return; }
      var on = Object.keys(r.permissions || {}).filter(function (k) { return r.permissions[k]; }).length;
      var it = h('<div class="sml-hub__item"><span class="sml-hub__dot" style="background:' + esc(r.color) + '"></span><div class="grow"><b>' + esc(r.name) + '</b><small>' + esc(baseLabel(r.base_level)) + ' level · ' + esc(counts[r.id] || 0) + ' member' + ((counts[r.id] || 0) === 1 ? '' : 's') + ' · ' + on + ' permission' + (on === 1 ? '' : 's') + '</small></div>' +
        (can('manage_roles') ? '<button type="button" class="sml-hub__btn sml-hub__btn--sm" data-edit>Edit</button><button type="button" class="sml-hub__btn sml-hub__btn--sm sml-hub__btn--danger" data-del>Delete</button>' : '') + '</div>');
      if (can('manage_roles')) {
        it.querySelector('[data-edit]').onclick = function () { S.editingRole = r.id; go('roles'); };
        it.querySelector('[data-del]').onclick = function () {
          if (!confirm('Delete the role “' + r.name + '”? Members keep their current engine level; the role and its channel overrides are removed.')) return;
          api(G() + '/roles/' + r.id, { method: 'DELETE' }).then(function (res) { S.data.roles = res.roles; S.data.overrides = res.overrides; go('roles'); }).catch(function (e) { msg(c, e.message, false); });
        };
      }
      list.appendChild(it);
    });
    c.appendChild(list);
    if (can('manage_roles')) { c.appendChild(h('<h3>New role</h3>')); c.appendChild(roleForm(null)); }
  };

  /* ---------- Members ---------- */
  RENDER.members = function (c) {
    if (!can('manage_members')) { c.appendChild(h('<p class="note">You do not have the Manage members permission.</p>')); return; }
    var bar = h('<div class="sml-hub__row"><input class="sml-hub__input" type="search" placeholder="Search name or email" value="' + esc(S.memberSearch) + '" style="flex:1;min-width:160px"><button type="button" class="sml-hub__btn">Search</button></div>');
    var list = h('<div class="sml-hub__list"><p class="note">Loading…</p></div>');
    var more = h('<div class="sml-hub__row"><button type="button" class="sml-hub__btn" hidden data-more>Load more</button></div>');
    c.appendChild(bar); c.appendChild(list); c.appendChild(more);
    function load(reset) {
      if (reset) { S.memberPage = 1; list.innerHTML = '<p class="note">Loading…</p>'; }
      api(G() + '/members?search=' + encodeURIComponent(S.memberSearch) + '&page=' + S.memberPage).then(function (r) {
        if (reset) list.innerHTML = '';
        if (!r.members.length && reset) list.innerHTML = '<p class="note">No members match.</p>';
        r.members.forEach(function (m) { list.appendChild(memberRow(m)); });
        more.querySelector('[data-more]').hidden = r.page * r.per_page >= r.total;
      }).catch(function (e) { list.innerHTML = '<div class="sml-hub__err">' + esc(e.message) + '</div>'; });
    }
    bar.querySelector('button').onclick = function () { S.memberSearch = bar.querySelector('input').value.trim(); load(true); };
    bar.querySelector('input').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); bar.querySelector('button').click(); } };
    more.querySelector('[data-more]').onclick = function () { S.memberPage++; load(false); };
    load(true);
  };
  function memberRow(m) {
    var manager = S.data.viewer.is_manager;
    var roles = S.data.roles || [];
    var row = h('<div class="sml-hub__item"><img class="sml-hub__avatar" alt="" src="' + esc(m.avatar || '') + '"><div class="grow"><b>' + esc(m.name) + (m.is_owner ? ' <span class="sml-hub__chip base">Owner</span>' : '') + '</b><small>joined ' + esc((m.joined_at || '').slice(0, 10)) + '</small><div class="sml-hub__member-roles" data-roles></div></div>' +
      '<select class="sml-hub__select" data-engine ' + (m.is_owner ? 'disabled' : '') + '>' + baseOptions(m.engine_role, manager ? null : 'premium') + '</select>' +
      (m.is_owner ? '' : '<button type="button" class="sml-hub__btn sml-hub__btn--sm sml-hub__btn--danger" data-remove>Remove</button>') + '</div>');
    function paint(mm) {
      var box = row.querySelector('[data-roles]');
      box.innerHTML = '';
      (mm.roles || []).forEach(function (mr) {
        var r = roleById(mr.role_id); if (!r) return;
        var chip = h('<span class="sml-hub__chip" style="border-color:' + esc(r.color) + '"><span class="sml-hub__dot" style="background:' + esc(r.color) + ';width:8px;height:8px"></span>' + esc(r.name) + (mr.source !== 'manual' ? ' <small>(' + esc(mr.source) + ')</small>' : '') + '<button type="button" title="Remove role">×</button></span>');
        chip.querySelector('button').onclick = function () { update({ remove_role_id: r.id }); };
        box.appendChild(chip);
      });
      var held = (mm.roles || []).map(function (x) { return x.role_id; });
      var avail = roles.filter(function (r) { return held.indexOf(r.id) < 0 && (manager || ['member', 'premium', 'analyst'].indexOf(r.base_level) >= 0); });
      if (avail.length && !mm.is_owner) {
        var add = h('<select class="sml-hub__select" style="padding:3px 6px;font-size:12px"><option value="">+ role</option>' + avail.map(function (r) { return '<option value="' + r.id + '">' + esc(r.name) + '</option>'; }).join('') + '</select>');
        add.onchange = function () { if (add.value) update({ add_role_id: Number(add.value) }); };
        box.appendChild(add);
      }
      var sel = row.querySelector('[data-engine]');
      if (sel && !sel.disabled) sel.value = mm.engine_role;
    }
    function update(body) {
      row.style.opacity = '.5';
      api(G() + '/members/' + m.user_id, { method: 'POST', body: body }).then(function (r) {
        row.style.opacity = '';
        if (body.remove || !r.member) { row.remove(); return; }
        m = r.member; paint(m);
      }).catch(function (e) { row.style.opacity = ''; alert(e.message); paint(m); });
    }
    var sel = row.querySelector('[data-engine]');
    if (sel && !sel.disabled) sel.onchange = function () { update({ engine_role: sel.value }); };
    var rm = row.querySelector('[data-remove]');
    if (rm) rm.onclick = function () { if (confirm('Remove ' + m.name + ' from the group?')) update({ remove: true }); };
    paint(m);
    return row;
  }

  /* ---------- Channels ---------- */
  RENDER.channels = function (c) {
    var d = S.data, f = d.features || {};
    c.appendChild(h('<p>Per-channel overrides work like Discord: <b>@everyone</b> sets the default, then each level or role can be allowed or denied. Owners and admins always have access. Overrides are enforced on the chat API, not just hidden in the sidebar.</p>'));
    var row = h('<div class="sml-hub__row"><button type="button" class="sml-hub__btn" data-layout>Rename, reorder & categories</button><span class="note" style="color:#8ea0bd;font-size:13px">Channels whose name or type contains “alert” only accept posts from Analyst level and above (engine rule).</span></div>');
    row.querySelector('[data-layout]').onclick = function () { var err = f.categories ? delegate('#sml-gcat-gear', 'The categories gear is not on this page yet.') : 'The Group Categories snippet is not installed.'; if (err) msg(c, err, false); };
    c.appendChild(row);
    if (!(d.channels || []).length) { c.appendChild(h('<p class="note">No channels.</p>')); return; }
    var keys = [['everyone', '@everyone']].concat(['member', 'premium', 'analyst', 'mod'].map(function (k) { return ['base:' + k, baseLabel(k) + ' level']; })).concat((d.roles || []).map(function (r) { return [r.key, r.name, r.color]; }));
    (d.channels || []).forEach(function (ch) {
      var ov = (d.overrides || {})[String(ch.id)] || {};
      var det = h('<details class="sml-hub__channel"><summary><b># ' + esc(ch.name) + '</b><small>' + esc(ch.type) + (ch.category ? ' · ' + esc(ch.category) : '') + '</small>' + (Object.keys(ov).length ? '<span class="sml-hub__chip">custom permissions</span>' : '') + '</summary><div></div></details>');
      var body = det.querySelector('div');
      var table = h('<table class="sml-hub__matrix"><thead><tr><th>Who</th><th>View</th><th>Post</th></tr></thead><tbody>' + keys.map(function (k) {
        var v = ov[k[0]] || {};
        return '<tr data-key="' + esc(k[0]) + '"><td>' + (k[2] ? '<span class="sml-hub__dot" style="display:inline-block;vertical-align:-1px;margin-right:6px;background:' + esc(k[2]) + '"></span>' : '') + esc(k[1]) + '</td>' +
          ['view', 'post'].map(function (w) { var cur = v[w] || 'inherit'; return '<td><select data-w="' + w + '" class="' + cur + '"><option value="inherit"' + (cur === 'inherit' ? ' selected' : '') + '>inherit</option><option value="allow"' + (cur === 'allow' ? ' selected' : '') + '>✓ allow</option><option value="deny"' + (cur === 'deny' ? ' selected' : '') + '>✕ deny</option></select></td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>');
      table.querySelectorAll('select').forEach(function (s) { s.onchange = function () { s.className = s.value; }; });
      body.appendChild(table);
      if (can('manage_channels')) {
        var save = h('<div class="sml-hub__row"><button type="button" class="sml-hub__btn sml-hub__btn--primary sml-hub__btn--sm">Save channel permissions</button><button type="button" class="sml-hub__btn sml-hub__btn--sm" data-clear>Clear all</button></div>');
        save.querySelector('.sml-hub__btn--primary').onclick = function () {
          var out = {};
          table.querySelectorAll('tr[data-key]').forEach(function (tr) { var set = {}; tr.querySelectorAll('select').forEach(function (s) { if (s.value !== 'inherit') set[s.getAttribute('data-w')] = s.value; }); if (Object.keys(set).length) out[tr.getAttribute('data-key')] = set; });
          var b = this; b.disabled = true;
          api(G() + '/channels/' + ch.id + '/overrides', { method: 'POST', body: { overrides: out } }).then(function (r) { S.data.overrides = r.all; b.disabled = false; msg(body, 'Saved.', true); var chip = det.querySelector('summary .sml-hub__chip'); if (Object.keys(r.overrides).length && !chip) det.querySelector('summary').appendChild(h('<span class="sml-hub__chip">custom permissions</span>')); else if (!Object.keys(r.overrides).length && chip) chip.remove(); }).catch(function (e) { b.disabled = false; msg(body, e.message, false); });
        };
        save.querySelector('[data-clear]').onclick = function () { table.querySelectorAll('select').forEach(function (s) { s.value = 'inherit'; s.className = 'inherit'; }); };
        body.appendChild(save);
      }
      c.appendChild(det);
    });
  };

  /* ---------- Memberships ---------- */
  RENDER.memberships = function (c) {
    var d = S.data, f = d.features || {};
    if (!f.billing) { c.appendChild(h('<p class="note">The StockMarketLoop billing plugin is not installed on this site, so there are no membership products here.</p>')); return; }
    c.appendChild(h('<p>Paid tiers are Stripe subscriptions. Members pay through Stripe Checkout; the payout lands in your connected Stripe account after the disclosed 6% platform fee. A product grants a website level for as long as the subscription is active.</p>'));
    var row = h('<div class="sml-hub__row"><button type="button" class="sml-hub__btn sml-hub__btn--primary" data-products>Manage products</button><button type="button" class="sml-hub__btn" data-stripe>Stripe payout setup</button></div>');
    row.querySelector('[data-products]').onclick = function () { var err = can('manage_memberships') ? openProducts() : 'You do not have the Manage memberships permission.'; if (err) msg(c, err, false); };
    row.querySelector('[data-stripe]').onclick = function () { var err = delegate('.sml-billing-setup', 'Stripe payout setup is already complete, or the billing plugin is not loaded on this page.'); if (err) msg(c, err, false); };
    c.appendChild(row);
    c.appendChild(h('<h3>Products</h3>'));
    var list = h('<div class="sml-hub__list"></div>');
    if (!(d.plans || []).length) list.appendChild(h('<p class="note">No products yet. Use “Manage products” to create one; the Stripe product and price are created for you.</p>'));
    (d.plans || []).forEach(function (p) {
      list.appendChild(h('<div class="sml-hub__item" style="' + (p.active ? '' : 'opacity:.55') + '"><div class="grow"><b>' + esc(p.name) + '</b><small>' + money(p.priceCents) + ' / ' + esc(p.intervalLabel || p.intervalKey) + ' · grants ' + esc(baseLabel(p.grantsRole || 'premium')) + ' · ' + (p.active ? 'live' : 'archived') + '</small></div></div>'));
    });
    c.appendChild(list);
  };

  /* ---------- Discord ---------- */
  RENDER.discord = function (c) {
    var d = S.data, f = d.features || {}, ds = d.discord;
    if (!f.discord || !ds) { c.appendChild(h('<p class="note">The Discord Connect snippet is not installed on this site.</p>')); return; }
    var active = ds.state === 'active';
    c.appendChild(h('<p>Status: <b>' + (active ? 'Connected to server ' + esc(ds.guild_id) : ds.state === 'pending' ? 'Pairing started, waiting for /claim-sml in Discord' : 'Not connected') + '</b></p>'));
    var row = h('<div class="sml-hub__row">' + (active ? '<button type="button" class="sml-hub__btn sml-hub__btn--primary" data-sync>Role mappings & channel sync</button>' : '<button type="button" class="sml-hub__btn sml-hub__btn--primary" data-pair>' + (ds.state === 'pending' ? 'Continue pairing' : 'Connect a Discord server') + '</button>') + '</div>');
    var b = row.querySelector('button');
    b.onclick = function () {
      if (!can('manage_discord')) { msg(c, 'You do not have the Manage Discord permission.', false); return; }
      var err = active ? delegate('[data-sml-dgc-channel-sync]', 'The channel sync button has not loaded yet. Wait a few seconds and try again.') : delegate('[data-sml-dgc-owner]', 'The Discord Access button has not loaded yet. Wait a few seconds and try again.');
      if (err) msg(c, err, false);
    };
    c.appendChild(row);
    c.appendChild(h('<h3>Role mappings</h3>'));
    if (!(ds.mappings || []).length) c.appendChild(h('<p class="note">No Discord role is mapped to a website level yet.</p>'));
    else c.appendChild(h('<div class="sml-hub__list">' + ds.mappings.map(function (m) { return '<div class="sml-hub__item"><div class="grow"><b>Discord role ' + esc(m.role_id) + '</b><small>grants ' + esc(baseLabel(m.website_role)) + '</small></div></div>'; }).join('') + '</div>'));
    c.appendChild(h('<p class="note">Members link their Discord account with <code>/link-sml</code>; their mapped role then controls website access. Paid or manually managed access is never replaced by Discord sync.</p>'));
  };

  /* ---------- Onboarding ---------- */
  RENDER.onboarding = function (c) {
    var f = S.data.features || {};
    if (!f.onboarding) { c.appendChild(h('<p class="note">The onboarding module is not installed on this site.</p>')); return; }
    c.appendChild(h('<p>The onboarding is what people who cannot enter your Premium channels see: welcome text, what is inside, featured channels, membership cards and the unlock step.</p>'));
    var b = h('<div class="sml-hub__row"><button type="button" class="sml-hub__btn sml-hub__btn--primary">Edit onboarding</button></div>');
    b.querySelector('button').onclick = function () { var err = can('manage_onboarding') ? delegate('[data-sml-ob-open]', 'The onboarding editor has not loaded yet. Wait a few seconds and try again.') : 'You do not have the Manage onboarding permission.'; if (err) msg(c, err, false); };
    c.appendChild(b);
    c.appendChild(h('<p class="note">Membership cards shown in the onboarding come from your products (Memberships section).</p>'));
  };

  /* ---------- Socials ---------- */
  var PLAT = { loop: 'Loop Channel', bluesky: 'Bluesky', youtube: 'YouTube', reddit: 'Reddit', x: 'X' };
  var PICON = { loop: 'L', bluesky: '🦋', youtube: '▶', reddit: 'r/', x: 'X' };
  RENDER.socials = function (c) {
    var d = S.data, so = d.socials || {};
    if (!so.available) { c.appendChild(h('<p class="note">Follow-to-unlock is not enabled for this group.</p>')); return; }
    if (can('manage_socials') && so.config) renderSocialsOwner(c, so); else renderSocialsMember(c, so);
  };
  function platformStatusText(p, st) { return st === 'ready' ? 'ready' : st === 'needs_setup' ? 'needs API setup by site admin' : (p === 'x' ? 'not offered (paid X API)' : 'not available on this site'); }
  function renderSocialsOwner(c, so) {
    var cfg = so.config, roles = S.data.roles || [], st = so.platforms || {};
    c.appendChild(h('<p>Members who <b>verifiably</b> follow you get a role automatically, and lose it again when they unfollow (checked daily). Only platforms with a real API check are offered — Facebook pages, Threads and LinkedIn cannot be verified, and X needs a paid API tier.</p>'));
    var form = h('<form class="sml-hub__form" data-cfg>' +
      '<label>Feature<select name="enabled">' + options([['1', 'On'], ['0', 'Off']], cfg.enabled ? '1' : '0') + '</select></label>' +
      '<label>Rule<select name="rule">' + options([['any', 'Follow any one target'], ['all', 'Follow every target']], cfg.rule) + '</select></label>' +
      '<label class="wide">Reward<select name="reward">' + options([['base:premium', 'Premium level']].concat(['member', 'analyst'].map(function (k) { return ['base:' + k, baseLabel(k) + ' level']; })).concat(roles.map(function (r) { return ['role:' + r.id, 'Role: ' + r.name]; })), cfg.grant_role_id ? 'role:' + cfg.grant_role_id : 'base:' + cfg.grant_engine_role) + '</select></label>' +
      '<label class="wide">Message shown to members<textarea name="message" maxlength="300" rows="2" placeholder="Follow me and unlock the Premium channels for free.">' + esc(cfg.message) + '</textarea></label>' +
      '<div class="sml-hub__actions"><button type="submit" class="sml-hub__btn sml-hub__btn--primary">Save</button><button type="button" class="sml-hub__btn" data-recheck>Re-check everyone now</button></div></form>');
    form.onsubmit = function (e) {
      e.preventDefault();
      var reward = form.reward.value.split(':');
      var body = { enabled: form.enabled.value === '1', rule: form.rule.value, message: form.message.value, grant_role_id: reward[0] === 'role' ? Number(reward[1]) : 0 };
      if (reward[0] === 'base') body.grant_engine_role = reward[1];
      api(G() + '/socials/config', { method: 'POST', body: body }).then(function (r) { S.data.socials = r.socials; msg(c, 'Saved.', true); }).catch(function (err) { msg(c, err.message, false); });
    };
    form.querySelector('[data-recheck]').onclick = function () { var b = this; b.disabled = true; api(G() + '/socials/recheck', { method: 'POST', body: {} }).then(function (r) { b.disabled = false; S.data.socials = r.socials; go('socials'); msg(c, 'Checked ' + r.checked + ' member' + (r.checked === 1 ? '' : 's') + ', revoked ' + r.revoked + '.', true); }).catch(function (e) { b.disabled = false; msg(c, e.message, false); }); };
    c.appendChild(form);
    c.appendChild(h('<h3>Targets (what members must follow)</h3>'));
    var list = h('<div></div>');
    if (!(so.targets || []).length) list.appendChild(h('<p class="note">Add at least one target.</p>'));
    (so.targets || []).forEach(function (t) {
      var it = h('<div class="sml-hub__social-target"><span class="icon">' + esc(PICON[t.platform] || '?') + '</span><div><b>' + esc(t.label || t.handle) + '</b><br><small style="color:#8ea0bd">' + esc(PLAT[t.platform] || t.platform) + ' · ' + esc(t.handle) + '</small></div><button type="button" class="sml-hub__btn sml-hub__btn--sm sml-hub__btn--danger">Remove</button></div>');
      it.querySelector('button').onclick = function () { if (!confirm('Remove this target?')) return; api(G() + '/socials/targets/' + t.id, { method: 'DELETE' }).then(function (r) { S.data.socials = r.socials; go('socials'); }).catch(function (e) { msg(c, e.message, false); }); };
      list.appendChild(it);
    });
    c.appendChild(list);
    var add = h('<form class="sml-hub__form" data-add><label>Platform<select name="platform">' + Object.keys(st).map(function (p) { return '<option value="' + p + '"' + (st[p] !== 'ready' ? ' disabled' : '') + '>' + esc(PLAT[p] || p) + ' — ' + esc(platformStatusText(p, st[p])) + '</option>'; }).join('') + '</select></label>' +
      '<label>Handle / ID<input name="handle" required placeholder="handle"></label>' +
      '<label class="wide">Label (optional)<input name="label" maxlength="80" placeholder="My YouTube channel"></label>' +
      '<label class="wide" data-reddit hidden><span><input type="checkbox" name="reddit_profile"> This is a profile (u/…), not a subreddit</span></label>' +
      '<div class="sml-hub__actions"><button type="submit" class="sml-hub__btn sml-hub__btn--primary">Add target</button></div><p class="note wide" data-help></p></form>');
    var HELP = { loop: 'The StockMarketLoop username whose Loop Channel members must follow.', bluesky: 'Bluesky handle, e.g. name.bsky.social.', youtube: 'The YouTube channel ID (starts with UC): YouTube Studio → Settings → Channel → Advanced.', reddit: 'Subreddit name (r/…) or your profile (u/…).' };
    function helpFor() { var p = add.platform.value; add.querySelector('[data-help]').textContent = HELP[p] || ''; add.querySelector('[data-reddit]').hidden = p !== 'reddit'; }
    add.platform.onchange = helpFor; helpFor();
    add.onsubmit = function (e) {
      e.preventDefault(); var b = add.querySelector('[type=submit]'); b.disabled = true;
      api(G() + '/socials/targets', { method: 'POST', body: { platform: add.platform.value, handle: add.handle.value, label: add.label.value, reddit_profile: add.reddit_profile.checked } }).then(function (r) { S.data.socials = r.socials; go('socials'); }).catch(function (err) { b.disabled = false; msg(add, err.message, false); });
    };
    c.appendChild(h('<h3>Add a target</h3>'));
    c.appendChild(add);
    c.appendChild(h('<h3>Members unlocked this way</h3>'));
    c.appendChild(h('<div class="sml-hub__list">' + ((so.grants || []).length ? so.grants.map(function (g) { var r = roleById(g.applied_role_id); return '<div class="sml-hub__item"><div class="grow"><b>' + esc(g.display_name || ('user #' + g.user_id)) + '</b><small>' + esc(r ? r.name : baseLabel(g.applied_engine_role || 'premium')) + ' · since ' + esc((g.created_at || '').slice(0, 10)) + ' · last verified ' + esc((g.last_verified_at || '').slice(0, 16)) + '</small></div></div>'; }).join('') : '<p class="note">Nobody yet.</p>') + '</div>'));
  }
  function renderSocialsMember(c, so) {
    if (!so.enabled) { c.appendChild(h('<p class="note">The owner has not switched this on yet.</p>')); return; }
    var st = so.platforms || {}, links = so.links || {};
    c.appendChild(h('<p>' + esc(so.message || ('Follow ' + (so.rule === 'all' ? 'all of these' : 'any of these') + ' and unlock ' + so.reward + ' access for free.')) + '</p>'));
    c.appendChild(h('<p class="note">Rule: follow <b>' + (so.rule === 'all' ? 'every' : 'any one') + '</b> target · Reward: <b>' + esc(so.reward) + '</b>' + (so.granted ? ' · <span class="status ok">unlocked ✓</span>' : '') + '</p>'));
    (so.targets || []).forEach(function (t) {
      var link = links[t.platform], sat = (so.satisfied || []).map(Number).indexOf(t.id) >= 0;
      var status = sat ? '<span class="status ok">following ✓</span>' : t.platform === 'loop' ? '<span class="status warn">not following yet</span>' : !link ? '<span class="status off">not connected</span>' : !link.verified ? '<span class="status warn">connected, not verified</span>' : '<span class="status warn">verified, not following</span>';
      var it = h('<div class="sml-hub__social-target"><span class="icon">' + esc(PICON[t.platform] || '?') + '</span><div><b>' + esc(t.label || t.handle) + '</b> <a href="' + esc(t.url) + '" target="_blank" rel="noopener" style="color:#9df5c9">open ↗</a><br><small style="color:#8ea0bd">' + esc(PLAT[t.platform] || t.platform) + ' · ' + esc(t.handle) + '</small><div class="status-line">' + status + '</div></div><div class="sml-hub__row" data-act></div></div>');
      var act = it.querySelector('[data-act]');
      if (t.platform === 'loop') {
        act.appendChild(h('<a class="sml-hub__btn sml-hub__btn--sm" href="' + esc(t.url) + '" target="_blank" rel="noopener">Follow on Loop</a>'));
      } else if (t.platform === 'bluesky') {
        var b = h('<button type="button" class="sml-hub__btn sml-hub__btn--sm">' + (link ? 'Change handle' : 'Connect Bluesky') + '</button>');
        b.onclick = function () {
          var handle = prompt('Your Bluesky handle (e.g. name.bsky.social):', link ? link.handle : '');
          if (!handle) return;
          api(G() + '/socials/connect', { method: 'POST', body: { platform: 'bluesky', handle: handle } }).then(function (r) { alert(r.instructions); return refresh(); }).then(function () { go('socials'); }).catch(function (e) { msg(c, e.message, false); });
        };
        act.appendChild(b);
        if (link && !link.verified && link.proof_code) act.appendChild(h('<span class="sml-hub__chip">put <b>&nbsp;' + esc(link.proof_code) + '&nbsp;</b> in your bio</span>'));
      } else if (t.platform === 'youtube' || t.platform === 'reddit') {
        var ob = h('<button type="button" class="sml-hub__btn sml-hub__btn--sm"' + (st[t.platform] !== 'ready' ? ' disabled' : '') + '>' + (link ? 'Reconnect' : 'Connect ' + PLAT[t.platform]) + '</button>');
        ob.onclick = function () { api(G() + '/socials/connect', { method: 'POST', body: { platform: t.platform } }).then(function (r) { if (r.authorize_url) location.href = r.authorize_url; }).catch(function (e) { msg(c, e.message, false); }); };
        act.appendChild(ob);
      }
      if (link && t.platform !== 'loop') {
        var dc = h('<button type="button" class="sml-hub__btn sml-hub__btn--sm sml-hub__btn--ghost">Disconnect</button>');
        dc.onclick = function () { api(G() + '/socials/disconnect', { method: 'POST', body: { platform: t.platform } }).then(refresh).then(function () { go('socials'); }); };
        act.appendChild(dc);
      }
      c.appendChild(it);
    });
    var v = h('<div class="sml-hub__row"><button type="button" class="sml-hub__btn sml-hub__btn--primary">Verify now</button></div>');
    v.querySelector('button').onclick = function () {
      var b = this; b.disabled = true;
      api(G() + '/socials/verify', { method: 'POST', body: {} }).then(function (r) { S.data.socials = r.socials; go('socials'); msg(win.querySelector('[data-content]'), r.result.granted ? 'Unlocked! Reload the page to see your new access.' : r.result.eligible ? 'Verified.' : 'Not unlocked yet: ' + (so.rule === 'all' ? 'every target must be followed.' : 'follow at least one target, then verify again.'), r.result.granted || r.result.eligible); }).catch(function (e) { b.disabled = false; msg(c, e.message, false); });
    };
    c.appendChild(v);
  }

  /* ---------- mounting on the group page ---------- */
  function applyDedupe() { document.body.classList.toggle('sml-hub-dedupe', !!(S.data && S.data.prefs && S.data.prefs.hide_legacy && S.data.viewer.can_open_hub)); }
  function installButtons() {
    if (!S.data || !S.data.viewer.can_open_hub) return;
    var head = document.querySelector('.sml-gshell__main-head,.sml-group-head,.sml-group-header');
    if (head && !head.querySelector('[data-sml-hub-open]')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sml-gshell__edit sml-hub-open-btn'; b.setAttribute('data-sml-hub-open', '1'); b.textContent = '⚙ Settings';
      b.onclick = function () { openHub('overview'); };
      var edit = head.querySelector('[data-smlgs-edit],.sml-gshell__edit');
      if (edit) edit.insertAdjacentElement('afterend', b); else head.appendChild(b);
    }
    var menu = document.querySelector('[data-smlgs-owner-menu]');
    if (menu && !menu.querySelector('[data-sml-hub-menu]')) {
      var m = document.createElement('button');
      m.type = 'button'; m.setAttribute('data-sml-hub-menu', '1'); m.textContent = 'Group settings';
      m.onclick = function () { menu.classList.remove('open'); var dots = document.querySelector('[data-smlgs-owner-dots]'); if (dots) dots.setAttribute('aria-expanded', 'false'); openHub('overview'); };
      menu.prepend(m);
    }
  }
  function installMemberCard() {
    var so = S.data && S.data.socials;
    if (!so || !so.available || !so.enabled || S.data.viewer.can_open_hub || so.granted) return;
    if (document.querySelector('.sml-hub-card')) return;
    var host = document.querySelector('.sml-gshell__main') || document.querySelector('main') || document.getElementById('sml-group-root');
    if (!host) return;
    var card = h('<section class="sml-hub-card"><h3>Follow to unlock ' + esc(so.reward) + '</h3><p>' + esc(so.message || ('Follow ' + (so.rule === 'all' ? 'all of these' : 'any of these') + ' and get ' + so.reward + ' access for free: ' + so.targets.map(function (t) { return t.label || t.handle; }).join(', '))) + '</p><div class="sml-hub__row"><button type="button" class="sml-hub__btn sml-hub__btn--primary sml-hub__btn--sm">Connect & verify</button></div></section>');
    card.querySelector('button').onclick = function () { openHub('socials', true); };
    host.prepend(card);
  }
  function tick() { installButtons(); installMemberCard(); }
  refresh().then(function () {
    applyDedupe();
    tick();
    var tries = 0, timer = setInterval(function () { tick(); if (++tries > 40) clearInterval(timer); }, 500);
    if (window.MutationObserver) {
      var pending = false;
      new MutationObserver(function () { if (pending) return; pending = true; setTimeout(function () { pending = false; tick(); }, 150); }).observe(document.body, { childList: true, subtree: true });
    }
    var q = new URLSearchParams(location.search).get('socials');
    if (q) { openHub('socials', !S.data.viewer.can_open_hub); setTimeout(function () { if (win) msg(win.querySelector('[data-content]'), q === 'connected' ? 'Account connected. Press “Verify now” to check your follow.' : 'Connecting the account failed. Try again.', q === 'connected'); }, 200); }
  }).catch(function () { /* not a member, or hub not available */ });
  window.smlHubOpen = openHub;
})();
