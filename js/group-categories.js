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
 *    column until the next re-apply — the "sidebar jumping" bug. Every
 *    channel now has a UNIQUE persisted CSS slot (never a shared category
 *    slot whose tie is broken by transient DOM order). A stylesheet rule
 *    matches the recreated button the instant the shell inserts it, so a
 *    rebuild now changes nothing visually. The
 *    box itself is only marked with data-sml-gcat-active; everything
 *    without a per-id rule defaults to the separate native zone,
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
 *    sidebar changes repair synchronously in the observer's pre-paint
 *    microtask; unrelated page churn uses a throttled 80ms check.
 *  - panel: renames carry assignments along; names are trimmed everywhere;
 *    duplicate names block Save; category cap is code-point safe; category
 *    membership + the full channel sequence persist as ONE revision-checked
 *    layout transaction. Two admin tabs cannot silently overwrite each
 *    other, and a partial category/order save is impossible.
 *  - delete: each channel row has a 🗑 button (managers only, loaded rows
 *    only). It takes an inline confirm and then calls the ENGINE's own
 *    permission-gated delete, applied immediately (not deferred to Save),
 *    then reloads so the sidebar/order/revision re-sync from scratch.
 */
(function () {
  'use strict';
  if (window.__smlGcatBooted) return;
  window.__smlGcatBooted = true;

  /* ---------- Portal watermark: upgrade poster -> animated WebP ----------
   * The server (WPCode "SML Group Watermark Optimizer") swaps the Portal
   * watermark from a 33,062,888-byte GIF to a 1,226-byte static poster so the
   * critical path stays tiny. Once the page is idle we quietly upgrade to the
   * animated WebP (2,870,066 bytes, 91.3% smaller than the GIF) and hand it to
   * the shell's config, which applyWatermark() reads by reference on every
   * later call. No observers: we preload, then swap once.
   * Skipped entirely for prefers-reduced-motion, Save-Data and 2g, which keep
   * the poster deliberately. If the WebP fails to load the poster simply stays.
   */
  (function portalWatermarkUpgrade() {
    var BASE = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@4befb9c/media/watermarks/';
    var ANIM = BASE + 'portal-watermark.webp';
    var POSTER_MARK = 'portal-watermark-poster.webp';
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var conn = navigator.connection || navigator.webkitConnection;
      if (conn && (conn.saveData || /(^|-)2g$/.test(String(conn.effectiveType || '')))) return;
    } catch (e) { /* capability probe only; never block the page */ }
    function go() {
      var cfg = window.SMLGroupShell;
      if (!cfg || String(cfg.portalWatermarkUrl || '').indexOf(POSTER_MARK) === -1) return;
      var pre = new Image();
      pre.onload = function () {
        cfg.portalWatermarkUrl = ANIM;
        var layer = document.querySelector('[data-smlgs-watermark]');
        if (layer && String(layer.style.backgroundImage || '').indexOf(POSTER_MARK) !== -1) {
          layer.style.backgroundImage = 'url("' + ANIM + '")';
        }
      };
      pre.src = ANIM;                       // failure leaves the poster in place
    }
    if (window.requestIdleCallback) { requestIdleCallback(go, { timeout: 3000 }); }
    else { setTimeout(go, 1200); }
  })();

  var m = location.pathname.match(/^\/groups\/([^/]+)\/?$/);
  if (!m) return;
  var SLUG = decodeURIComponent(m[1]);

  // The group shell renders custom channel-name emojis (:free_green:/:free_red:)
  // as loading="lazy" <img>s — low priority and deferred, so a tiny, always-
  // visible sidebar emoji paints late. Preload the catalog at high priority the
  // instant this script runs (well before the shell fetches channels and draws
  // buttons), turning that lazy fetch — and every ~10s rebuild — into an instant
  // cache hit. The images are small and edge-cached; catalog mirrors the shell's
  // customEmojiCatalog (sml-group-shell-v11 assets/group-shell.js).
  (function preloadChannelEmojis() {
    ['sml-free-green-128', 'sml-free-red-128'].forEach(function (base) {
      var href = 'https://stockmarketloop.com/wp-content/uploads/2026/08/' + base + '.png';
      if (document.querySelector('link[data-sml-emoji="' + base + '"]')) return;
      var l = document.createElement('link');
      l.rel = 'preload'; l.as = 'image'; l.href = href;
      l.setAttribute('fetchpriority', 'high');
      l.setAttribute('data-sml-emoji', base);
      (document.head || document.documentElement).appendChild(l);
    });
  })();
  var API = '/wp-json/sml-gcat/v1/group?slug=' + encodeURIComponent(SLUG);
  var LAYOUT_API = '/wp-json/sml-gcat/v1/layout?slug=' + encodeURIComponent(SLUG);
  var NONCE = window.SML_GCAT_NONCE || '';

  var S = { categories: [], assignments: {}, channelOrder: [], layoutRevision: '', canManage: false, lastBox: null };

  function channelsBox() { return document.querySelector('.sml-gshell__channels'); }
  function channelButtons(box) {
    return [].slice.call(box.querySelectorAll('.sml-gshell__channel[data-smlgs-channel]'));
  }
  function norm(name) { return String(name == null ? '' : name).trim(); }
  function capPoints(s) { return Array.from(String(s)).slice(0, 40).join(''); }

  /* ---------- CSS-order regrouping (no engine node is ever moved OR written) ---------- */
  // One million positions per category means category N can never collide
  // with category N+1, even for an exceptionally large group. Native engine
  // rows and the manage control live in separate, later zones.
  var CATEGORY_STRIDE = 1000000;
  var NATIVE_BASE = 1000000000;

  var SHEET_ID = 'sml-gcat-style';
  var sheetKey = null;
  function ensureSheet() {
    var want = JSON.stringify([S.categories, S.assignments, S.channelOrder]);
    var sheet = document.getElementById(SHEET_ID);
    if (sheet && sheetKey === want) return;
    var css = [
      '.sml-gshell__channels[data-sml-gcat-active]{display:flex;flex-direction:column;}',
      '.sml-gshell__channels[data-sml-gcat-active]>*{order:' + NATIVE_BASE + ';}'
    ];
    var orderSource = S.channelOrder.slice();
    // Rolling deploy safety: if the PHP endpoint has not yet started sending
    // channel_order, freeze the first visible engine order instead of falling
    // back to Object.keys() (integer-key sorting is not the owner's order).
    if (!orderSource.length) {
      var currentBox = channelsBox();
      orderSource = currentBox ? channelButtons(currentBox).map(function (b) {
        return parseInt(b.getAttribute('data-smlgs-channel'), 10);
      }).filter(function (id) { return id > 0; }) : [];
    }
    var savedRank = Object.create(null);
    orderSource.forEach(function (id, i) {
      id = parseInt(id, 10);
      if (id > 0 && savedRank[id] == null) savedRank[id] = i + 1;
    });
    S.categories.forEach(function (cat, ci) {
      var ord = (ci + 1) * CATEGORY_STRIDE;
      var fallbackRank = orderSource.length + 1;
      Object.keys(S.assignments).forEach(function (id) {
        if (S.assignments[id] !== cat) return;
        var n = parseInt(id, 10);
        if (n > 0) {
          // Every channel gets a UNIQUE slot. 17ebc49 gave all channels in a
          // category the same order and therefore still depended on the
          // engine's transient DOM sequence to break ties during a rebuild.
          var rank = savedRank[n] || fallbackRank++;
          css.push('.sml-gshell__channels[data-sml-gcat-active]>[data-smlgs-channel="' + n + '"]{order:' + (ord + rank) + ';}');
        }
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

  /* ---------- Portal Chat placement (per-group rule) ----------
   * Making Easy Money: Portal Chat sits FIRST inside the "💬 CHATS 🗣️"
   * category. Every other group: Portal Chat is the very FIRST item in the
   * whole sidebar. Positioned the same safe way as channels — a CSS `order`
   * rule keyed by the portal's own class in a <head> stylesheet, so the shell
   * rebuilding the button never dislodges it and no engine node is moved. */
  var PORTAL_IN_CATEGORY = { 'making-easy-money': '💬 CHATS 🗣️' };
  var PORTAL_SHEET_ID = 'sml-gcat-portal-style';
  var portalSheetKey = null;
  function portalCategoryIndex() {
    var wanted = PORTAL_IN_CATEGORY[SLUG];
    if (!wanted) return -1;
    var i = S.categories.indexOf(wanted);
    if (i !== -1) return i;
    // emoji/spacing-tolerant fallback so a small edit to the category name
    // (variation selectors, extra spaces) doesn't silently drop the portal
    var normx = function (s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var w = normx(wanted);
    for (var k = 0; k < S.categories.length; k++) { if (normx(S.categories[k]) === w) return k; }
    return -1;
  }
  function positionPortal() {
    if (!channelsBox()) return;
    var ci = portalCategoryIndex();
    // Inside the named category: exactly (n)*STRIDE — after its header
    // (n*STRIDE-1) and before its first channel (n*STRIDE+rank, rank>=1).
    // Otherwise -1: below every native element (default 0 AND the active
    // sheet's NATIVE_BASE) — the very first item, whether or not categories
    // are active in this group.
    var portalOrder = (ci !== -1) ? ((ci + 1) * CATEGORY_STRIDE) : -1;
    var key = SLUG + '|' + portalOrder;
    var sheet = document.getElementById(PORTAL_SHEET_ID);
    if (sheet && portalSheetKey === key) return;
    // DESKTOP ONLY. On desktop the engine renders .sml-gshell__channels as a
    // block (order is inert on block) so we make it flex-column to honour the
    // portal's `order`. Below 561px the engine deliberately makes it a
    // HORIZONTAL scroller (display:flex;overflow-x:auto) — never override that.
    // `order !important` beats the category sheet's non-important
    // `[data-sml-gcat-active]>*{order:NATIVE_BASE}` rule regardless of which
    // <style> was appended to <head> last (equal specificity would otherwise
    // let source order decide, and positionPortal runs before ensureSheet).
    var css = '@media (min-width:561px){'
      + '.sml-gshell__channels{display:flex;flex-direction:column;}'
      + '.sml-gshell__channels>.sml-gshell__portal-channel{order:' + portalOrder + ' !important;}'
      + '}';
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = PORTAL_SHEET_ID;
      (document.head || document.documentElement).appendChild(sheet); // head: never re-fires our body observer
    }
    sheet.textContent = css;
    portalSheetKey = key;
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
    var portalHome = portalCategoryIndex(); // the category the portal lives in (-1 = none)
    S.categories.forEach(function (cat, ci) {
      var count = present[cat] || 0;
      // The portal's home category ALWAYS shows its header (the portal is its
      // content), for members too — otherwise an empty CHATS would leave the
      // portal floating with no label. Every other empty category is
      // manager-only + dimmed.
      var portalHere = (ci === portalHome);
      if (!count && !S.canManage && !portalHere) return;
      out.push({ name: cat, order: (ci + 1) * CATEGORY_STRIDE - 1, empty: (!count && !portalHere) });
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

  // The public-alerts channel (the one every group has, wired to the ticker
  // terminal's chart of the underlying stock) reads "🌐 | PUBLIC ALERTS" in
  // every group. DISPLAY relabel only — the channel, its id and its behaviour
  // are untouched; matched by its standard name so it holds on every group with
  // no per-group data, and re-applied on each shell rebuild. Idempotent: once
  // relabelled the text no longer equals "PUBLIC ALERTS", so it won't re-fire.
  var PUBLIC_ALERTS_LABEL = '🌐 | PUBLIC ALERTS';
  function relabelPublicAlerts(box) {
    channelButtons(box).forEach(function (btn) {
      var nameEl = btn.querySelector('.sml-gshell__channel-name');
      if (nameEl && nameEl.textContent.trim().toUpperCase() === 'PUBLIC ALERTS') {
        nameEl.textContent = PUBLIC_ALERTS_LABEL;
      }
    });
  }
  // The shell renders channel-name custom emojis (:free_green:/:free_red:) as
  // loading="lazy" <img>s. In the sidebar's own scroll container the lazy loader
  // never pulls them (verified: in-viewport + preloaded-to-cache, yet the <img>
  // stays unloaded), so a tiny always-visible emoji just doesn't paint. Flip
  // them to eager+high priority the moment they appear; the bytes are already
  // in cache (preloaded at boot), so this is an instant paint. Idempotent, and
  // re-applied on every ~10s rebuild that recreates the buttons.
  function eagerizeChannelEmojis(box) {
    [].slice.call(box.querySelectorAll('img.sml-gshell__custom-emoji')).forEach(function (img) {
      if (img.getAttribute('loading') === 'eager') return;
      img.setAttribute('loading', 'eager');
      img.setAttribute('fetchpriority', 'high');
      if (!img.complete) {           // nudge a stalled lazy <img> to load now (from cache)
        var s = img.getAttribute('src');
        if (s) { img.removeAttribute('src'); img.setAttribute('src', s); }
      }
    });
  }

  var applying = false;
  function apply() {
    var box = channelsBox();
    if (!box) return;
    var btns = channelButtons(box);

    applying = true;
    try {
      // Portal Chat placement runs first and unconditionally — it must hold on
      // EVERY group (categories or not), and its own <head> stylesheet is
      // independent of the category-header work below.
      positionPortal();
      // Same deal: the public-alerts channel is relabelled on every group,
      // categories or not, before any early return below. Custom emojis get
      // eagerized here too so they paint instantly instead of stalling lazy.
      relabelPublicAlerts(box);
      eagerizeChannelEmojis(box);

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
  // Native section labels the owner wants gone from EVERY group (2026-08-30):
  // the custom categories replace them. Matched by text — the engine gives
  // these headers no data attribute (categoryName() returns the literal
  // 'Alerts'/'Channels'/'Conversation'). Only NATIVE headers are touched (the
  // query below is :not([data-sml-gcat])), so a custom category the owner named
  // the same thing is never hidden by this.
  var HIDE_NATIVE = { ALERTS: 1, CHANNELS: 1, CONVERSATION: 1 };
  function hideEmpties(box) {
    [].slice.call(box.querySelectorAll('.sml-gshell__category:not([data-sml-gcat])')).forEach(function (h) {
      // unconditional hide (independent of custom categories) so it holds on
      // groups that use no custom categories at all
      if (HIDE_NATIVE[h.textContent.trim().toUpperCase()]) {
        if (h.style.display !== 'none') h.style.display = 'none';
        return;
      }
      if (!S.categories.length) { if (h.style.display !== '') h.style.display = ''; return; }
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
    if (g.style.order !== '2000000000') g.style.order = '2000000000'; // visually last in the flex column
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
    var revisionRefresh = Promise.resolve(true);
    var CH_TYPES = ['text', 'alerts', 'education', 'voice', 'live'];
    function refreshLayoutSnapshot() {
      revisionRefresh = fetch(API, { credentials: 'same-origin', headers: NONCE ? { 'X-WP-Nonce': NONCE } : {} })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.layout_revision) return false;
          var serverOrder = Array.isArray(d.channel_order)
            ? d.channel_order.map(function (id) { return parseInt(id, 10); }).filter(function (id) { return id > 0; })
            : [];
          var panelOrder = (chans || []).map(function (c) { return c.id; });
          var fingerprint = function (obj) {
            return Object.keys(obj || {}).sort(function (a, b) { return Number(a) - Number(b); })
              .map(function (k) { return k + ':' + obj[k]; }).join('|');
          };
          // A create is expected to append exactly one channel. If anything
          // else changed while this panel was open, do not adopt the newer
          // revision and then overwrite it with the stale panel snapshot.
          if (serverOrder.join(',') !== panelOrder.join(',') ||
              JSON.stringify(d.categories || []) !== JSON.stringify(S.categories) ||
              fingerprint(d.assignments) !== fingerprint(S.assignments)) return false;
          S.layoutRevision = String(d.layout_revision);
          return true;
        })
        .catch(function () { return false; });
      return revisionRefresh;
    }
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
            // The layout endpoint is canonical. Never trust transport/SQL
            // row order from the engine list endpoint when an explicit saved
            // sequence is available.
            if (S.channelOrder.length) {
              var rank = Object.create(null);
              S.channelOrder.forEach(function (id, i) { rank[id] = i; });
              chans.sort(function (a, b) {
                var ar = rank[a.id] == null ? Number.MAX_SAFE_INTEGER : rank[a.id];
                var br = rank[b.id] == null ? Number.MAX_SAFE_INTEGER : rank[b.id];
                return ar - br || a.id - b.id;
              });
            }
            S.channelOrder = chans.map(function (c) { return c.id; });
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
        if (!c.ro) {
          if (norm(c.name).toUpperCase() === 'PUBLIC ALERTS') {
            // The engine protects the "PUBLIC ALERTS" default channel (wired to
            // the public charts) — a delete returns 403 sml_protected_channel.
            // Show a lock instead of a trash button that could only ever fail.
            var lock = el('span', 'flex:0 0 auto;color:#6f8a7c;font-size:13px;cursor:default;', row, '🔒');
            lock.title = 'Default channel wired to the public charts — it can’t be deleted';
          } else {
            var trash = el('button', 'flex:0 0 auto;background:#1a1012;border:1px solid #3a2428;border-radius:7px;color:#ff8a96;padding:5px 9px;cursor:pointer;font:12px inherit;', row, '🗑');
            trash.type = 'button'; trash.title = 'Delete this channel';
            trash.addEventListener('click', function () { confirmDeleteChannel(c); });
          }
        }
      });
    }
    // Deleting a channel is destructive, so it takes an explicit confirmation
    // and then calls the ENGINE's own permission-gated delete (POST
    // sml/v1/group/channel/delete {channel_id} — the engine derives the group
    // from the channel and removes it for everyone; verified live). The confirm
    // is a separate OVERLAY, not a mutated row, so a concurrent drawAssign()
    // (a reorder click, a category edit) can't wipe it mid-decision and the
    // status stays visible. We reload on success so the sidebar, channel order
    // and layout revision all re-sync from scratch — the delete response
    // carries no fresh layout_revision, so a reload (not an in-place splice) is
    // the only way to keep the next Save's base_revision valid.
    function confirmDeleteChannel(c) {
      var ov = el('div', 'position:fixed;inset:0;z-index:2147480001;display:flex;align-items:center;justify-content:center;background:rgba(3,8,6,0.6);', PANEL);
      var box = el('div', 'width:min(400px,90vw);background:#12100f;border:1px solid #3a2428;border-radius:12px;padding:18px 20px;color:#ffdfe2;font:14px/1.5 inherit;box-shadow:0 20px 60px rgba(0,0,0,.7);', ov);
      el('div', 'font:700 15px inherit;color:#ffb3bb;margin-bottom:8px;', box, 'Delete #' + norm(c.name) + '?');
      el('div', 'font-size:12.5px;color:#e8c9cd;margin-bottom:8px;', box, 'This permanently removes the channel and its messages for everyone. This cannot be undone.');
      if ((chans || []).filter(function (x) { return !x.ro; }).length <= 1) {
        el('div', 'font-size:11.5px;color:#ffce7a;margin-bottom:8px;', box, 'This is the group’s only channel — the group will have no channels until you add one.');
      }
      el('div', 'font-size:11.5px;color:#9c8f86;margin-bottom:14px;', box, 'Deleting takes effect immediately and reloads the panel, so Save any unsaved category or name changes first.');
      var msg = el('div', 'font-size:12px;color:#c9b7ba;min-height:16px;margin-bottom:10px;', box, '');
      var btns = el('div', 'display:flex;gap:10px;justify-content:flex-end;', box);
      var keep = el('button', 'background:#101c16;border:1px solid #24382e;border-radius:8px;color:#cfe0d7;padding:7px 16px;cursor:pointer;font:600 12px inherit;', btns, 'Keep');
      keep.type = 'button';
      keep.addEventListener('click', function () { ov.remove(); });
      var del = el('button', 'background:#e5484d;border:0;border-radius:8px;color:#fff;padding:7px 18px;cursor:pointer;font:700 12px inherit;', btns, 'Delete');
      del.type = 'button';
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
      del.addEventListener('click', function () {
        del.disabled = true; keep.disabled = true; msg.textContent = 'Deleting…';
        fetch('/wp-json/sml/v1/group/channel/delete', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
          body: JSON.stringify({ channel_id: c.id })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); })
          .then(function (res) {
            // 404 = the channel is already gone (deleted in another tab) — the
            // manager's goal is met, so re-sync rather than showing an error.
            if (res.ok || res.status === 404) {
              msg.textContent = '#' + norm(c.name) + ' deleted — reloading…';
              location.reload();
              return;
            }
            del.disabled = false; keep.disabled = false;
            // Prefer the server's own reason — 403 covers both an expired nonce
            // AND a protected/default channel ("PUBLIC ALERTS is a default
            // channel and cannot be deleted"), so show the message when there is
            // one; only the genuine nonce failure gets the session hint.
            msg.textContent = (res.j && res.j.code === 'rest_cookie_invalid_nonce')
              ? 'Your session expired — reload the page and try again.'
              : ((res.j && res.j.message) || ((res.status === 401 || res.status === 403)
                ? 'Your session expired — reload the page and try again.'
                : 'Could not delete the channel.'));
          })
          .catch(function () { del.disabled = false; keep.disabled = false; msg.textContent = 'Could not delete the channel — check your connection and try again.'; });
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
          S.channelOrder.push(parseInt(ch.id, 10));
          orig[ch.id] = String(ch.name || name);
          // the engine appends creates at MAX(order_index)+1 — extending the
          // baseline keeps "did the user reorder?" honest across a create
          origSeq = origSeq ? origSeq + ',' + ch.id : String(ch.id);
          newName.value = '';
          addNote.textContent = '#' + ch.name + ' created — synchronizing layout…';
          drawAssign();
          refreshLayoutSnapshot().then(function (ok) {
            addNote.textContent = ok
              ? '#' + ch.name + ' created — assign it a category, then Save.'
              : '#' + ch.name + ' was created, but the layout changed. Reload before editing its position.';
          });
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
      // Channel renames are independent of layout. Category membership and
      // the complete sequence then save together through /layout; there is
      // no intermediate state where one changed and the other did not.
      var renames = (chans || []).filter(function (c) {
        return !c.ro && norm(c.name) !== '' && norm(c.name) !== orig[c.id];
      });
      var anyRo = (chans || []).some(function (c) { return c.ro; });
      var seq = (chans || []).map(function (c) { return c.id; }).join(',');
      var orderChanged = !anyRo && chans !== null && seq !== origSeq;
      if (chans === null || anyRo) {
        note.textContent = 'Channel list unavailable — reload before changing the layout.';
        return;
      }
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
        revisionRefresh.then(function (revisionOk) {
          if (!revisionOk || !S.layoutRevision) {
            save.disabled = false;
            note.textContent = 'Could not confirm the current layout — reload before saving.';
            return;
          }
          fetch(LAYOUT_API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE },
            body: JSON.stringify({
              base_revision: S.layoutRevision,
              categories: clean,
              assignments: outAsgn,
              order: chans.map(function (c) { return c.id; })
            })
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
              save.disabled = false;
              if (!res.ok || !res.j || res.j.saved !== true) {
                note.textContent = res.j && res.j.code === 'sml_gcat_layout_conflict'
                  ? 'This layout changed in another tab. Reload, then make your changes again.'
                  : (res.j && res.j.message) || 'Could not save.';
                return;
              }
              S.categories = res.j.categories || [];
              S.assignments = res.j.assignments || {};
              S.channelOrder = Array.isArray(res.j.channel_order)
                ? res.j.channel_order.map(function (id) { return parseInt(id, 10); }).filter(function (id) { return id > 0; })
                : (chans || []).map(function (c) { return c.id; });
              S.layoutRevision = String(res.j.layout_revision || S.layoutRevision);
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
        S.channelOrder = Array.isArray(d.channel_order)
          ? d.channel_order.map(function (id) { return parseInt(id, 10); }).filter(function (id) { return id > 0; })
          : [];
        S.layoutRevision = String(d.layout_revision || '');
        S.canManage = !!d.can_manage;
        intersectAssignments();
        return true;
      })
      .catch(function () { return false; });
  }

  var pending = null;
  function check() {
    pending = null;
    var box = channelsBox();
    if (!box) return;
    if (box !== S.lastBox || !grouped(box) || (S.canManage && !box.querySelector('#sml-gcat-gear'))) apply();
    else hideEmpties(box); // display-only refresh (attribute writes — no childList re-fire)
  }
  function schedule() {
    // THROTTLE, never a resetting debounce: a page that mutates more often
    // than the delay (live chat, presence ticks) must not starve the repair —
    // once a check is queued it always runs. 80ms: the shell rebuilds every
    // button ~10s and wipes our headers; they must be back within a frame or
    // two. Channel ORDER survives rebuilds by itself (stylesheet rules, not
    // inline styles), so a queued check never shows a shuffled sidebar.
    if (pending) return;
    pending = setTimeout(check, 80);
  }
  function watch() {
    new MutationObserver(function (records) {
      if (applying) return; // our own apply() churn — everything else re-checks
      var box = channelsBox();
      var sidebarChanged = box !== S.lastBox;
      if (!sidebarChanged && box) {
        sidebarChanged = records.some(function (record) {
          if (record.target === box || box.contains(record.target)) return true;
          return [].slice.call(record.addedNodes || []).concat([].slice.call(record.removedNodes || [])).some(function (node) {
            return node && node.nodeType === 1 && (node === box || (node.matches && node.matches('.sml-gshell__channels')) || (node.querySelector && node.querySelector('.sml-gshell__channels')));
          });
        });
      }
      if (sidebarChanged) {
        // MutationObserver runs before the browser paints. Repairing the
        // sidebar now prevents a single wrong-order frame; the old 80ms queue
        // made the broken intermediate layout visible.
        if (pending) clearTimeout(pending);
        pending = null;
        check();
        return;
      }
      schedule();
    }).observe(document.body, { childList: true, subtree: true }); // body: the shell may REPLACE the container node
    // hidden tabs throttle timers to a crawl (verified live: a backgrounded
    // group page ran ZERO timers/mutations for 6s+ and sat header-less in a
    // mid-rebuild state) — repair the instant the user comes back
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (pending) clearTimeout(pending);
      pending = null;
      check();
    });
    // belt-and-braces heartbeat: grouped() is cheap and check() is a no-op
    // when the sidebar is already correct, so a missed observer edge (or a
    // wipe whose repair timer died with a throttled tab) always heals
    setInterval(function () { if (!applying && !pending) check(); }, 4000);
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

/* ============================================================================
 * SML group HEADER enhancements (independent of the categories module above):
 *   1. A US market-session countdown timer inside the sidebar group-name block
 *      (the block is extended taller to hold it).
 *   2. Fold "Edit Group" and (owner-only) "Channel Background" into a single
 *      3-dots (⋮) menu at the top-right of the channel banner; the original
 *      buttons are hidden and each menu item proxies a click to its original,
 *      so no knowledge of their internals is needed.
 * Self-contained: a 1s tick drives the clock AND re-applies both enhancements,
 * healing the shell's ~10s full rebuild (same problem the categories layer has).
 * Timer core verified by node tests (15/15: sessions, weekends, NYSE holidays,
 * DST, boundaries, viewer-local 12h display).
 * ========================================================================== */
(function () {
  'use strict';
  if (!/^\/groups\/[^/]+\/?$/.test(location.pathname)) { return; }

  /* ---- market-session countdown: the whole widget (session logic, seasonal/
     holiday themes, animations) lives in the standalone market-countdown-embed.html,
     which ensureTimer() iframes into the sidebar and scales to fit. Keeping it a
     separate file means the design can be edited in one place. ---- */
  var CD_REPO = 'streetmoneybolo-wq/GET-IT-DONE';
  var CD_FILE = 'market-countdown-embed.html';
  var CD_NATIVE_W = 380, CD_NATIVE_H = 176; // native box the iframe content occupies
  // Resolve the CDN ref THIS script was loaded with, so the embed matches the
  // deployed version and rides the same resolver freshness. Falls back to @main.
  function cdEmbedUrl(){
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var m = /cdn\.jsdelivr\.net\/gh\/([^@]+)@([^/]+)\/[^"']*group-categories\.js/.exec(scripts[i].src || '');
        if (m) { return 'https://cdn.jsdelivr.net/gh/' + m[1] + '@' + m[2] + '/' + CD_FILE; }
      }
    } catch (e) {}
    return 'https://cdn.jsdelivr.net/gh/' + CD_REPO + '@main/' + CD_FILE;
  }

  /* ---- styles (once) ---- */
  function ensureStyles(){
    if (document.getElementById('sml-ghx-css')) { return; }
    var css = ''
      + '.sml-gshell__side-head.sml-ghx-head{display:block !important;padding-bottom:12px;}'
      + '.sml-ghx-cd{margin-top:10px;position:relative;width:100%;overflow:hidden;}'
      + '.sml-ghx-cd-frame{border:0;display:block;background:transparent;transform-origin:top left;color-scheme:normal;}'
      + '.sml-ghx-dots{position:absolute;top:8px;right:8px;z-index:40;width:30px;height:30px;display:flex;align-items:center;justify-content:center;'
      +   'pointer-events:auto !important;' /* the banner sets pointer-events:none; re-enable ours or real clicks pass through */
      +   'font-size:20px;line-height:1;color:#cfe;background:rgba(8,18,24,.66);border:1px solid rgba(255,255,255,.14);border-radius:8px;cursor:pointer;backdrop-filter:blur(4px);}'
      + '.sml-ghx-dots:hover{background:rgba(0,255,102,.16);border-color:rgba(0,255,102,.4);}'
      + '.sml-ghx-menu{position:absolute;top:44px;right:8px;z-index:41;min-width:186px;display:none;flex-direction:column;overflow:hidden;pointer-events:auto !important;'
      +   'background:#0d171e;border:1px solid rgba(0,255,102,.22);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.5);}'
      + '.sml-ghx-menu.open{display:flex;}'
      + '.sml-ghx-menu button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:11px 14px;background:none;border:0;cursor:pointer;'
      +   'color:#e2ece6;font-size:13.5px;font-family:inherit;}'
      + '.sml-ghx-menu button:hover{background:rgba(0,255,102,.1);color:#4dff97;}'
      + '.sml-ghx-menu button + button{border-top:1px solid rgba(255,255,255,.06);}'
      + '.sml-ghx-hidden-src{position:absolute !important;width:1px !important;height:1px !important;padding:0 !important;margin:-1px !important;overflow:hidden !important;clip:rect(0,0,0,0) !important;white-space:nowrap !important;border:0 !important;}'
      /* per-channel custom title image overlaid on the banner */
      + '.sml-ghx-title{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;max-width:88%;max-height:90%;width:auto;height:auto;object-fit:contain;pointer-events:none;filter:drop-shadow(0 3px 12px rgba(0,0,0,.5));}'
      /* title setter panel */
      + '.sml-ghx-tp{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(2,7,13,.72);backdrop-filter:blur(6px);font-family:inherit;}'
      + '.sml-ghx-tp-card{width:min(460px,100%);max-height:calc(100vh - 36px);overflow:auto;padding:20px;border:1px solid rgba(0,255,102,.28);border-radius:16px;background:#0b141b;color:#e8f1ec;box-shadow:0 24px 70px rgba(0,0,0,.6);}'
      + '.sml-ghx-tp-card h3{margin:0 0 4px;font-size:16px;color:#fff;}'
      + '.sml-ghx-tp-note{margin:0 0 12px;font-size:12.5px;line-height:1.5;color:#94a89e;}'
      + '.sml-ghx-tp-prev{display:block;max-width:100%;max-height:120px;margin:2px auto 12px;border-radius:8px;background:rgba(255,255,255,.03);}'
      + '.sml-ghx-tp label{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8aa89b;margin:12px 0 5px;}'
      + '.sml-ghx-tp input[type=file],.sml-ghx-tp input[type=url]{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #263039;border-radius:8px;background:#060d14;color:#e8f1ec;font:inherit;font-size:13px;}'
      + '.sml-ghx-tp-or{text-align:center;font-size:11px;color:#5f7268;margin:10px 0;}'
      + '.sml-ghx-tp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;}'
      + '.sml-ghx-tp-actions button{flex:1 1 40%;border:0;border-radius:9px;padding:10px;font:inherit;font-weight:700;font-size:13px;cursor:pointer;}'
      + '.sml-ghx-tp-save{background:#38F58A;color:#05130b;}'
      + '.sml-ghx-tp-cancel{background:#1a2731;color:#cfe;}'
      + '.sml-ghx-tp-remove{background:#3a1720 !important;color:#ff9aa6 !important;border:1px solid rgba(255,90,110,.3) !important;}'
      + '.sml-ghx-tp-status{margin-top:10px;font-size:12.5px;min-height:16px;color:#7dffc0;}'
      + '.sml-ghx-tp-status.err{color:#ff9aa6;}'
      + '.sml-ghx-tp-close{float:right;border:0;background:#1a2731;color:#cfe;border-radius:8px;padding:5px 9px;cursor:pointer;font:inherit;}';
    var s = document.createElement('style'); s.id = 'sml-ghx-css'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function findByText(re){
    var els = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      // never match our own injected controls (our menu items carry the same
      // labels as the real buttons, so a plain text search would proxy to itself)
      if (e.id === 'sml-ghx-dots' || (e.closest && e.closest('#sml-ghx-menu'))) { continue; }
      if (re.test((e.textContent || '').trim())) { return e; }
    }
    return null;
  }

  /* ---- countdown widget: iframe the standalone embed, scaled to fit the sidebar.
     The side-head is stable (only the channel LIST is rebuilt by the shell), so the
     iframe is injected once and never reloads — only its scale is recomputed. ---- */
  function ensureTimer(){
    var head = document.querySelector('.sml-gshell__side-head');
    if (!head) { return; }
    head.classList.add('sml-ghx-head');
    var box = head.querySelector('#sml-ghx-timer');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sml-ghx-timer'; box.className = 'sml-ghx-cd';
      var frame = document.createElement('iframe');
      frame.className = 'sml-ghx-cd-frame';
      frame.title = 'Market session countdown';
      frame.setAttribute('scrolling', 'no');
      frame.setAttribute('loading', 'eager');
      frame.width = CD_NATIVE_W; frame.height = CD_NATIVE_H;
      frame.style.width = CD_NATIVE_W + 'px'; frame.style.height = CD_NATIVE_H + 'px';
      frame.src = cdEmbedUrl();
      box.appendChild(frame);
      head.appendChild(box);
    }
    // Uniformly scale the native-size (380px) iframe down to the available width so
    // the exact design is preserved, just smaller. Never upscale past 1.
    var frame2 = box.querySelector('.sml-ghx-cd-frame');
    var avail = box.clientWidth;
    if (frame2 && avail > 0) {
      var s = Math.min(1, avail / CD_NATIVE_W);
      var tf = 'scale(' + s.toFixed(4) + ')';
      if (frame2.style.transform !== tf) { frame2.style.transform = tf; }
      box.style.height = Math.round(CD_NATIVE_H * s) + 'px';
    }
  }

  /* ---- 3-dots menu folding Edit Group + Channel Background ---- */
  function proxyClick(finder){
    return function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var b = finder();
      var menu = document.getElementById('sml-ghx-menu');
      if (menu) { menu.classList.remove('open'); }
      if (b) { b.click(); }
    };
  }
  // The channel-header controls (verified live): Edit Group = .sml-gshell__edit,
  // Channel Background (channel watermark) = .sml-gshell__channel-watermark-button,
  // both inside .sml-gshell__main-head. Text is the fallback if the shell renames.
  // NOTE: the group-landing hero's .sml-goe-edit-btn is deliberately NOT matched —
  // this menu only reworks the channel-view header the user asked about.
  function findEdit(){ return document.querySelector('.sml-gshell__edit') || findByText(/^Edit Group$/i); }
  function findBg(){ return document.querySelector('.sml-gshell__channel-watermark-button') || findByText(/^Channel Background$/i); }

  function ensureMenu(){
    // channel-view only: the banner is the yellow-dot anchor and its absence
    // means the landing/overview layout, which we leave untouched.
    var banner = document.querySelector('.sml-gshell__header-banner');
    if (!banner) { return; }
    var editBtn = findEdit();
    var bgBtn = findBg();
    // Show the menu for anyone with a real control OR title-management rights
    // (analysts may be allowed to set titles without seeing Edit/Background).
    if (!editBtn && !bgBtn && !titleCanManage()) { return; }

    // Visually remove the originals but keep them FUNCTIONAL. display:none makes
    // offsetParent null and the shell's own click handler bails on that, so a
    // proxied click to a display:none button does nothing. The sr-only style
    // keeps the button laid out + clickable while invisible.
    [editBtn, bgBtn].forEach(function (b) {
      if (b) { b.classList.add('sml-ghx-hidden-src'); b.style.removeProperty('display'); }
    });

    var anchor = banner || (editBtn && editBtn.parentElement) || (bgBtn && bgBtn.parentElement);
    if (!anchor) { return; }
    if (getComputedStyle(anchor).position === 'static') { anchor.style.position = 'relative'; }

    var dots = anchor.querySelector('#sml-ghx-dots');
    if (!dots) {
      dots = document.createElement('button');
      dots.id = 'sml-ghx-dots'; dots.type = 'button'; dots.className = 'sml-ghx-dots';
      dots.setAttribute('aria-label', 'Group options'); dots.textContent = '⋮';
      var menu = document.createElement('div'); menu.id = 'sml-ghx-menu'; menu.className = 'sml-ghx-menu';
      anchor.appendChild(dots); anchor.appendChild(menu);
      dots.addEventListener('click', function (ev) { ev.stopPropagation(); menu.classList.toggle('open'); });
      document.addEventListener('click', function (ev) { if (!menu.contains(ev.target) && ev.target !== dots) { menu.classList.remove('open'); } });
    }
    var menu = anchor.querySelector('#sml-ghx-menu');
    // rebuild items to reflect which controls currently exist
    var wantBg = !!bgBtn;
    var wantTitle = titleCanManage();
    var sig = (editBtn ? 'e' : '') + (wantBg ? 'b' : '') + (wantTitle ? 't' : '');
    if (menu.getAttribute('data-sig') !== sig) {
      menu.setAttribute('data-sig', sig);
      menu.innerHTML = '';
      if (editBtn) {
        var e = document.createElement('button'); e.type = 'button'; e.textContent = 'Edit group';
        e.addEventListener('click', proxyClick(findEdit)); menu.appendChild(e);
      }
      if (wantBg) {
        var g = document.createElement('button'); g.type = 'button'; g.textContent = 'Channel background';
        g.addEventListener('click', proxyClick(findBg)); menu.appendChild(g);
      }
      if (wantTitle) {
        var tt = document.createElement('button'); tt.type = 'button'; tt.textContent = 'Channel title';
        tt.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var m = document.getElementById('sml-ghx-menu'); if (m) { m.classList.remove('open'); }
          openTitlePanel();
        });
        menu.appendChild(tt);
      }
    }
  }

  /* ---- per-channel custom title overlay (SML Channel Title plugin) ----
     The plugin injects window.SMLChannelTitle = { api, nonce } on group pages
     and owns the storage + gated REST. Here we render the title image over the
     banner and, for managers (owner/admin/analyst), add the "Channel title"
     setter to the menu. Everything degrades to a no-op if the plugin is absent. */
  var TITLE = { loaded:false, loading:false, titles:{}, canManage:false, gid:null };

  function ghxCtx(){ return window.SMLGroupShellContext || {}; }
  function ghxCfg(){ return window.SMLChannelTitle || null; }
  function ghxGroupId(){
    var c = ghxCtx();
    if (c && c.groupId) { return String(c.groupId).replace(/\D/g,''); }
    var root = document.getElementById('sml-group-root');
    return (root && root.dataset && root.dataset.groupId) ? String(root.dataset.groupId).replace(/\D/g,'') : '';
  }
  function ghxChannelId(){ var c = ghxCtx(); return (c && c.channelId) ? String(c.channelId).replace(/\D/g,'') : ''; }
  function titleCanManage(){ return !!(ghxCfg() && TITLE.canManage); }

  function loadTitles(force){
    var cfg = ghxCfg(), gid = ghxGroupId();
    if (!cfg || !cfg.api || !gid || TITLE.loading) { return; }
    if (TITLE.loaded && TITLE.gid === gid && !force) { return; }
    TITLE.loading = true; TITLE.gid = gid;
    var headers = {}; if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    fetch(cfg.api + 'titles?group_id=' + encodeURIComponent(gid), { credentials:'same-origin', headers: headers, cache:'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { TITLE.titles = (j && j.titles) || {}; TITLE.canManage = !!(j && j.can_manage); TITLE.loaded = true; })
      .catch(function () {})
      .then(function () { TITLE.loading = false; });
  }

  function ensureTitle(){
    loadTitles(false);
    var banner = document.querySelector('.sml-gshell__header-banner');
    if (!banner) { return; }
    var cid = ghxChannelId();
    var url = (cid && TITLE.titles) ? TITLE.titles[cid] : '';
    var img = banner.querySelector('#sml-ghx-title');
    if (!url) { if (img) { img.remove(); } return; }
    if (!img) {
      img = document.createElement('img');
      img.id = 'sml-ghx-title'; img.className = 'sml-ghx-title'; img.alt = ''; img.setAttribute('aria-hidden','true');
      banner.appendChild(img);
    }
    if (img.getAttribute('src') !== url) { img.setAttribute('src', url); }
  }

  function openTitlePanel(){
    var cfg = ghxCfg(), gid = ghxGroupId(), cid = ghxChannelId();
    if (!cfg || !gid || !cid) { return; }
    var existing = document.querySelector('.sml-ghx-tp'); if (existing) { existing.remove(); }
    var curUrl = (TITLE.titles && TITLE.titles[cid]) ? TITLE.titles[cid] : '';

    var wrap = document.createElement('div'); wrap.className = 'sml-ghx-tp';
    var card = document.createElement('section'); card.className = 'sml-ghx-tp-card'; card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true');
    card.innerHTML =
      '<button type="button" class="sml-ghx-tp-close" aria-label="Close">Close</button>'
      + '<h3>Channel title</h3>'
      + '<p class="sml-ghx-tp-note">A custom title image overlaid on this channel’s banner. Design it in Canva, export a <strong>transparent PNG</strong>, then upload it here. Owner, admin, or analyst only.</p>'
      + (curUrl ? '<img class="sml-ghx-tp-prev" src="' + curUrl.replace(/"/g,'&quot;') + '" alt="Current title">' : '')
      + '<label>Upload image (PNG / JPG / WEBP / GIF · max 6MB)</label>'
      + '<input type="file" class="sml-ghx-tp-file" accept="image/png,image/jpeg,image/webp,image/gif">'
      + '<div class="sml-ghx-tp-actions">'
      +   '<button type="button" class="sml-ghx-tp-save">Save title</button>'
      +   (curUrl ? '<button type="button" class="sml-ghx-tp-remove">Remove</button>' : '')
      +   '<button type="button" class="sml-ghx-tp-cancel">Cancel</button>'
      + '</div>'
      + '<div class="sml-ghx-tp-status" role="status"></div>';
    wrap.appendChild(card); document.body.appendChild(wrap);

    var fileEl = card.querySelector('.sml-ghx-tp-file');
    var statusEl = card.querySelector('.sml-ghx-tp-status');
    function close(){ wrap.remove(); }
    function busy(b){ card.querySelectorAll('button,input').forEach(function (n) { n.disabled = b; }); }
    function say(msg, err){ statusEl.textContent = msg || ''; statusEl.className = 'sml-ghx-tp-status' + (err ? ' err' : ''); }

    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) { close(); } });
    card.querySelector('.sml-ghx-tp-close').addEventListener('click', close);
    card.querySelector('.sml-ghx-tp-cancel').addEventListener('click', close);

    card.querySelector('.sml-ghx-tp-save').addEventListener('click', function () {
      var file = fileEl.files && fileEl.files[0];
      if (!file) { say('Choose an image file to upload.', true); return; }
      if (file.size > 6 * 1024 * 1024) { say('Image must be 6MB or smaller.', true); return; }
      var fd = new FormData();
      fd.append('group_id', gid); fd.append('channel_id', cid);
      fd.append('file', file);
      busy(true); say('Saving…');
      fetch(cfg.api + 'title', { method:'POST', credentials:'same-origin', headers:{ 'X-WP-Nonce': cfg.nonce }, body: fd })
        .then(function (r) { return r.json().then(function (j) { return { ok:r.ok, j:j }; }); })
        .then(function (res) {
          if (!res.ok) { throw new Error((res.j && res.j.message) || 'Save failed.'); }
          say('Saved. Updating…');
          loadTitles(true);
          setTimeout(function () { ensureTitle(); close(); }, 400);
        })
        .catch(function (e) { busy(false); say(e.message || 'Save failed.', true); });
    });

    var rm = card.querySelector('.sml-ghx-tp-remove');
    if (rm) {
      rm.addEventListener('click', function () {
        busy(true); say('Removing…');
        fetch(cfg.api + 'title?group_id=' + encodeURIComponent(gid) + '&channel_id=' + encodeURIComponent(cid),
          { method:'DELETE', credentials:'same-origin', headers:{ 'X-WP-Nonce': cfg.nonce } })
          .then(function (r) { return r.json().then(function (j) { return { ok:r.ok, j:j }; }); })
          .then(function (res) {
            if (!res.ok) { throw new Error((res.j && res.j.message) || 'Remove failed.'); }
            say('Removed.');
            loadTitles(true);
            setTimeout(function () { ensureTitle(); close(); }, 300);
          })
          .catch(function (e) { busy(false); say(e.message || 'Remove failed.', true); });
      });
    }
  }

  function tick(){ ensureStyles(); ensureTimer(); ensureTitle(); ensureMenu(); }
  function boot(){ tick(); setInterval(tick, 1000); }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); }
  else { boot(); }
})();
