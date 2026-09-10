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
  /* ---------- Portal watermark: swap the raw GIF for a WebP derivative ----------
   * The Portal background is uploaded as a raw animated GIF and painted at 15%
   * opacity: currently Untitled-800-x-800-px-2.gif at 34,851,089 bytes, ~82% of
   * the whole page transfer. The shell reads config.portalWatermarkUrl by
   * reference at apply time, and applyWatermark() does not run until the shell
   * has booted (measured ~5.1s in), so replacing the value here means the GIF is
   * never requested at all.
   * Server-side rewriting was tried first and could not be made to run on this
   * page, so this is deliberately done client-side where it is verifiable.
   * No observers: a short bounded poll covers the case where the shell config
   * has not been printed yet, and gives up on its own. */
  (function portalWatermarkSwap() {
    var BASE = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@179a35f/media/watermarks/';
    var MAP = {
      'Untitled-800-x-800-px-2.gif': BASE + 'portal-bg-2-poster.webp',
      'portal-watermark.gif': BASE + 'portal-watermark-poster.webp'
    };
    function swap() {
      var cfg = window.SMLGroupShell;
      if (!cfg || !cfg.portalWatermarkUrl) return false;
      var url = String(cfg.portalWatermarkUrl);
      for (var name in MAP) {
        if (Object.prototype.hasOwnProperty.call(MAP, name) && url.indexOf(name) !== -1) {
          cfg.portalWatermarkUrl = MAP[name];
          return true;
        }
      }
      return true;                 /* already optimised or unknown: stop looking */
    }
    if (swap()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (swap() || ++tries > 60) clearInterval(timer);   /* <=3s, then give up */
    }, 50);
  })();

  (function portalWatermarkUpgrade() {
    /* The server serves a tiny static "<name>-poster.webp" so the critical path
     * stays small; once idle we upgrade to the animated "<name>.webp" beside it.
     * Deriving the animated URL from the poster URL keeps this working for any
     * future background without another code change. */
    var POSTER_RE = /-poster\.webp($|\?)/;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var conn = navigator.connection || navigator.webkitConnection;
      if (conn && (conn.saveData || /(^|-)2g$/.test(String(conn.effectiveType || '')))) return;
    } catch (e) { /* capability probe only; never block the page */ }
    function go() {
      var cfg = window.SMLGroupShell;
      var poster = cfg && String(cfg.portalWatermarkUrl || '');
      if (!poster || !POSTER_RE.test(poster)) return;
      var anim = poster.replace(/-poster(\.webp)/, '$1');
      var pre = new Image();
      pre.onload = function () {
        cfg.portalWatermarkUrl = anim;
        var layer = document.querySelector('[data-smlgs-watermark]');
        if (layer && String(layer.style.backgroundImage || '').indexOf('-poster.webp') !== -1) {
          layer.style.backgroundImage = 'url("' + anim + '")';
        }
      };
      pre.src = anim;                       /* failure leaves the poster in place */
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

  /* ---- market-session countdown, ported inline from the standalone
     market-countdown-embed.html (4-phase NYSE session model, seasonal/holiday
     themes, urgency tiers, progress bar, viewer-local "at X your time"). Runs
     inline because jsDelivr serves .html as text/plain (nosniff) so it can't be
     iframed. Rendered into a stable sidebar mount + scaled to fit. Every name
     below is local to cdStart(root); root is the 380px-native mount element. ---- */
  var CD_NATIVE_W = 380, cdStartedMount = null, cdIntervalId = null;
  function cdStart(root){
    var fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hour12:false});
    function etParts(ts){var p={};fmt.formatToParts(ts).forEach(function(x){p[x.type]=x.value;});return{y:+p.year,mo:+p.month,d:+p.day,h:(+p.hour)%24,mi:+p.minute};}
    function etTime(y,mo,d,h,mi){var ts=Date.UTC(y,mo-1,d,h,mi);for(var i=0;i<3;i++){var p=etParts(ts);var diff=Date.UTC(y,mo-1,d,h,mi)-Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi);if(!diff)break;ts+=diff;}return ts;}
    function nth(y,mo,dow,n){var first=new Date(Date.UTC(y,mo-1,1)).getUTCDay();return 1+((dow-first+7)%7)+(n-1)*7;}
    function lastDow(y,mo,dow){var dim=new Date(Date.UTC(y,mo,0)).getUTCDate();var wd=new Date(Date.UTC(y,mo-1,dim)).getUTCDay();return dim-((wd-dow+7)%7);}
    function easter(y){var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);return[Math.floor((h+l-7*m+114)/31),((h+l-7*m+114)%31)+1];}
    function dayKey(ts){var dt=new Date(ts);return dt.getUTCFullYear()+'-'+(dt.getUTCMonth()+1)+'-'+dt.getUTCDate();}
    var holCache={};
    function holidaySet(y){
      if(holCache[y])return holCache[y];
      var set={};
      function add(mo,d,observe){var ts=Date.UTC(y,mo-1,d);if(observe){var wd=new Date(ts).getUTCDay();if(wd===6)ts-=864e5;if(wd===0)ts+=864e5;}set[dayKey(ts)]=1;}
      add(1,1,true);add(1,nth(y,1,1,3));add(2,nth(y,2,1,3));
      var e=easter(y);set[dayKey(Date.UTC(y,e[0]-1,e[1])-2*864e5)]=1;
      add(5,lastDow(y,5,1));add(6,19,true);add(7,4,true);
      add(9,nth(y,9,1,1));add(11,nth(y,11,4,4));add(12,25,true);
      holCache[y]=set;return set;
    }
    function isTrading(y,mo,d){var wd=new Date(Date.UTC(y,mo-1,d)).getUTCDay();if(wd===0||wd===6)return false;return !holidaySet(y)[y+'-'+mo+'-'+d];}
    function prevClose(p){var ts=Date.UTC(p.y,p.mo-1,p.d);for(var i=0;i<15;i++){ts-=864e5;var dt=new Date(ts),y=dt.getUTCFullYear(),mo=dt.getUTCMonth()+1,d=dt.getUTCDate();if(isTrading(y,mo,d))return etTime(y,mo,d,20,0);}return null;}
    function schedule(now){
      var p=etParts(now),trading=isTrading(p.y,p.mo,p.d);
      if(trading){
        var pre=etTime(p.y,p.mo,p.d,4,0);
        if(now<pre)return{label:'PRE-MARKET OPENS',target:pre,start:prevClose(p)||pre-288e5};
        var open=etTime(p.y,p.mo,p.d,9,30);
        if(now<open)return{label:'MARKET OPENS',target:open,start:pre};
        var ah=etTime(p.y,p.mo,p.d,16,0);
        if(now<ah)return{label:'AFTER-HOURS BEGINS',target:ah,start:open};
        var close=etTime(p.y,p.mo,p.d,20,0);
        if(now<close)return{label:'AFTER-HOURS ENDS',target:close,start:ah};
      }
      var ts=Date.UTC(p.y,p.mo-1,p.d);
      for(var i=0;i<15;i++){
        ts+=864e5;var dt=new Date(ts),y=dt.getUTCFullYear(),mo=dt.getUTCMonth()+1,d=dt.getUTCDate();
        if(isTrading(y,mo,d)){var target=etTime(y,mo,d,4,0);return{label:'PRE-MARKET OPENS',target:target,start:trading?etTime(p.y,p.mo,p.d,20,0):(prevClose(p)||target-864e5)};}
      }
    }
    var THEMES={
      winter:{name:'Winter',icon:'❄️',accent:'#7dd3fc',wash:'linear-gradient(180deg, rgba(125,211,252,.10), rgba(30,64,110,.14))',decor:['❄️','❄️','✦','❄️','✧','❄️']},
      spring:{name:'Spring',icon:'🌱',accent:'#6ee7a0',wash:'linear-gradient(180deg, rgba(110,231,160,.10), rgba(34,84,61,.16))',decor:['🌱','🌸','🦋','🌷','🌸','🍃']},
      summer:{name:'Summer',icon:'☀️',accent:'#ffd166',wash:'linear-gradient(180deg, rgba(255,209,102,.10), rgba(120,80,20,.14))',decor:['☀️','🌊','🍉','🌴','☀️','🐚']},
      fall:{name:'Fall',icon:'🍂',accent:'#f4a261',wash:'linear-gradient(180deg, rgba(244,162,97,.10), rgba(110,50,20,.16))',decor:['🍂','🍁','🍂','🌰','🍁','🍂']},
      newyear:{name:'New Year',icon:'🎆',accent:'#ffd700',wash:'linear-gradient(180deg, rgba(255,215,0,.12), rgba(60,40,110,.18))',decor:['🎆','✨','🥂','🎇','✨','🎉']},
      valentine:{name:"Valentine's",icon:'💘',accent:'#ff6b9d',wash:'linear-gradient(180deg, rgba(255,107,157,.12), rgba(120,20,60,.16))',decor:['💘','❤️','💝','💕','❤️','🌹']},
      stpatrick:{name:"St. Patrick's",icon:'🍀',accent:'#4ade80',wash:'linear-gradient(180deg, rgba(74,222,128,.12), rgba(20,90,45,.18))',decor:['🍀','🌈','🍀','💰','🍀','🎩']},
      easter:{name:'Easter',icon:'🐣',accent:'#c4b5fd',wash:'linear-gradient(180deg, rgba(196,181,253,.12), rgba(90,70,140,.16))',decor:['🐣','🥚','🐰','🌷','🥚','🐣']},
      memorial:{name:'Memorial Day',icon:'🇺🇸',accent:'#93c5fd',wash:'linear-gradient(180deg, rgba(147,197,253,.10), rgba(150,40,50,.14))',decor:['🇺🇸','⭐','🎗️','🇺🇸','⭐','🕊️']},
      juneteenth:{name:'Juneteenth',icon:'✊🏾',accent:'#f87171',wash:'linear-gradient(180deg, rgba(248,113,113,.10), rgba(30,80,50,.16))',decor:['✊🏾','⭐','🎉','✊🏾','⭐','🎊']},
      july4:{name:'4th of July',icon:'🎇',accent:'#60a5fa',wash:'linear-gradient(180deg, rgba(96,165,250,.12), rgba(150,40,50,.16))',decor:['🎇','🇺🇸','🎆','⭐','🇺🇸','🎇']},
      laborday:{name:'Labor Day',icon:'🛠️',accent:'#fbbf24',wash:'linear-gradient(180deg, rgba(251,191,36,.10), rgba(90,60,20,.16))',decor:['🛠️','⚙️','🇺🇸','🔧','⭐','🛠️']},
      halloween:{name:'Halloween',icon:'🎃',accent:'#fb923c',wash:'linear-gradient(180deg, rgba(251,146,60,.14), rgba(80,30,120,.20))',decor:['🎃','👻','🦇','🕸️','🎃','💀']},
      thanksgiving:{name:'Thanksgiving',icon:'🦃',accent:'#e8a24a',wash:'linear-gradient(180deg, rgba(232,162,74,.12), rgba(110,55,20,.18))',decor:['🦃','🍂','🥧','🌽','🍁','🦃']},
      christmas:{name:'Christmas',icon:'🎄',accent:'#f87171',wash:'linear-gradient(180deg, rgba(248,113,113,.10), rgba(20,90,50,.20))',decor:['🎄','❄️','🎁','⛄','🔔','🎅']}
    };
    function holidayDates(y){var e=easter(y);return[['newyear',1,1],['valentine',2,14],['stpatrick',3,17],['easter',e[0],e[1]],['memorial',5,lastDow(y,5,1)],['juneteenth',6,19],['july4',7,4],['laborday',9,nth(y,9,1,1)],['halloween',10,31],['thanksgiving',11,nth(y,11,4,4)],['christmas',12,25]];}
    function activeThemeKey(now){
      var p=etParts(now),nowU=Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi),best=null;
      [p.y-1,p.y,p.y+1].forEach(function(y){holidayDates(y).forEach(function(h){
        var end=Date.UTC(y,h[1]-1,h[2])+864e5,startW=end-15*864e5;
        if(nowU>=startW&&nowU<end&&(!best||end<best.end))best={k:h[0],end:end};
      });});
      if(best)return best.k;
      var m=p.mo;return(m===12||m<=2)?'winter':m<=5?'spring':m<=8?'summer':'fall';
    }
    function z(n){return String(n).padStart(2,'0');}
    var P=[[6,0,9],[22,3.2,11],[40,1.5,8.5],[57,4.4,10],[73,2.3,12],[88,5.6,9],[14,6.8,10.5],[65,7.5,8]];
    var builtTheme=null;
    function build(theme){
      var parts='';
      P.forEach(function(q,i){
        parts+='<div style="position:absolute;bottom:-34px;left:'+q[0]+'%;font-size:'+(13+(i%3)*5)+'px;animation:smlFloatUp '+q[2]+'s linear '+q[1]+'s infinite;opacity:0;pointer-events:none;user-select:none">'+theme.decor[i%theme.decor.length]+'</div>';
      });
      root.innerHTML=
        '<div style="position:relative;width:380px;border-radius:18px;overflow:hidden;background:#0d1512;border:1px solid #1e2c25;box-shadow:0 30px 80px rgba(0,0,0,.65);font-family:\'Sora\',sans-serif">'+
          '<div style="position:absolute;inset:0;background:'+theme.wash+';pointer-events:none"></div>'+
          '<div style="position:absolute;inset:0;border-radius:18px;border:1px solid '+theme.accent+'44;pointer-events:none"></div>'+parts+
          '<div style="position:relative;padding:20px 22px 18px;display:flex;flex-direction:column;gap:12px">'+
            '<div style="display:flex;align-items:center;gap:10px">'+
              '<div id="sml-dot" style="width:10px;height:10px;border-radius:50%;flex-shrink:0"></div>'+
              '<div id="sml-label" style="font-size:12px;font-weight:700;letter-spacing:3px;color:#cfe0d6;flex:1"></div>'+
              '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:'+theme.accent+';background:rgba(0,0,0,.35);border:1px solid '+theme.accent+'44;border-radius:999px;padding:3px 10px;white-space:nowrap"><span>'+theme.icon+'</span><span>'+theme.name+'</span></div>'+
            '</div>'+
            '<div style="display:flex;align-items:baseline;gap:12px">'+
              '<div id="sml-days" style="display:none;font-family:\'JetBrains Mono\',monospace;font-size:26px;font-weight:800"></div>'+
              '<div id="sml-clock" style="font-family:\'JetBrains Mono\',monospace;font-size:46px;font-weight:800;letter-spacing:2px;line-height:1"></div>'+
            '</div>'+
            '<div style="font-size:12px;color:#8fa89b">at <span id="sml-at" style="color:#d7e6dd;font-weight:600"></span> your time</div>'+
            '<div style="height:6px;border-radius:999px;background:#14211b;overflow:hidden"><div id="sml-bar" style="height:100%;width:0%;border-radius:999px;transition:width .4s linear"></div></div>'+
          '</div>'+
        '</div>';
    }
    function tick(){
      var now=Date.now(),sched=schedule(now);
      var themeKey=activeThemeKey(now),theme=THEMES[themeKey];
      if(builtTheme!==themeKey){build(theme);builtTheme=themeKey;}
      var rem=Math.max(0,sched.target-now),total=sched.target-sched.start;
      var sec=Math.floor(rem/1000),days=Math.floor(sec/86400),hh=Math.floor(sec%86400/3600),mm=Math.floor(sec%3600/60),ss=sec%60;
      var tier=rem<6e4?4:rem<3e5?3:rem<9e5?2:rem<36e5?1:0;
      var urg=[theme.accent,'#ffd24a','#ff9d3b','#ff5252','#ff2b4a'][tier];
      var dur=[3,2.2,1.4,0.8,0.45][tier];
      var tgt=new Date(sched.target);
      var sameDay=tgt.toDateString()===new Date(now).toDateString();
      var opts=sameDay?{hour:'numeric',minute:'2-digit'}:{weekday:'long',hour:'numeric',minute:'2-digit'};
      var $=function(id){return root.querySelector('#'+id);};
      $('sml-label').textContent=sched.label;
      var dot=$('sml-dot');dot.style.background=urg;dot.style.boxShadow='0 0 12px '+urg;dot.style.animation='smlPulseDot '+dur+'s ease-in-out infinite';
      var dEl=$('sml-days');
      if(days>0){dEl.style.display='block';dEl.style.color=urg;dEl.style.textShadow='0 0 18px '+urg+'99';dEl.innerHTML=days+'<span style="font-size:14px;font-weight:700;opacity:.7">d</span>';}
      else dEl.style.display='none';
      var c=$('sml-clock');c.textContent=z(hh)+':'+z(mm)+':'+z(ss);c.style.color=urg;c.style.textShadow='0 0 22px '+urg+'99';c.style.animation='smlGlowPulse '+dur+'s ease-in-out infinite';
      $('sml-at').textContent=tgt.toLocaleString([],opts);
      var bar=$('sml-bar');bar.style.width=Math.min(100,Math.max(0,(1-rem/total)*100)).toFixed(2)+'%';
      bar.style.background='linear-gradient(90deg, '+theme.accent+', '+urg+')';bar.style.boxShadow='0 0 10px '+urg+'99';
    }
    tick(); return setInterval(tick, 250);
  }

  /* ---- styles (once) ---- */
  function ensureStyles(){
    if (document.getElementById('sml-ghx-css')) { return; }
    var css = ''
      + '.sml-gshell__side-head.sml-ghx-head{display:block !important;padding-bottom:12px;}'
      + '.sml-ghx-cd{margin-top:10px;position:relative;width:100%;overflow:hidden;}'
      + '.sml-ghx-cd-mount{width:380px;transform-origin:top left;}'
      + '@keyframes smlFloatUp{0%{transform:translateY(0) rotate(-6deg);opacity:0}12%{opacity:.85}80%{opacity:.55}100%{transform:translateY(-190px) rotate(14deg);opacity:0}}'
      + '@keyframes smlPulseDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.7);opacity:.45}}'
      + '@keyframes smlGlowPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}'
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
    // countdown widget fonts (degrades to the inline monospace/sans fallbacks if CSP blocks it)
    if (!document.getElementById('sml-ghx-fonts')) {
      var fl = document.createElement('link'); fl.id = 'sml-ghx-fonts'; fl.rel = 'stylesheet';
      fl.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&family=Sora:wght@400;600;700&display=swap';
      (document.head || document.documentElement).appendChild(fl);
    }
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

  /* ---- countdown widget: render the ported widget into a stable sidebar mount and
     uniformly scale the native 380px design down to fit the ~247px column. The
     side-head is stable (only the channel LIST is rebuilt), so cdStart() runs once
     and its own interval drives it; we only recompute scale + height here. ---- */
  function ensureTimer(){
    var head = document.querySelector('.sml-gshell__side-head');
    if (!head) { return; }
    head.classList.add('sml-ghx-head');
    var box = head.querySelector('#sml-ghx-timer');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sml-ghx-timer'; box.className = 'sml-ghx-cd';
      var mount = document.createElement('div');
      mount.id = 'sml-ghx-cd-mount'; mount.className = 'sml-ghx-cd-mount';
      box.appendChild(mount);
      head.appendChild(box);
    }
    var mount2 = box.querySelector('#sml-ghx-cd-mount');
    if (!mount2) { return; }
    // (Re)start the engine whenever a FRESH mount appears. The shell can replace the
    // side-head's contents during load, so a once-only global guard would leave a
    // replacement mount permanently empty. Clear the prior interval to avoid leaks.
    if (mount2 !== cdStartedMount) {
      if (cdIntervalId) { clearInterval(cdIntervalId); cdIntervalId = null; }
      cdStartedMount = mount2;
      try { cdIntervalId = cdStart(mount2); } catch (e) {}
    }
    // Uniformly scale the 380px design down to the available width (never upscale).
    var avail = box.clientWidth;
    if (avail > 0) {
      var s = Math.min(1, avail / CD_NATIVE_W);
      var tf = 'scale(' + s.toFixed(4) + ')';
      if (mount2.style.transform !== tf) { mount2.style.transform = tf; }
      var card = mount2.firstElementChild;
      var nativeH = card ? card.offsetHeight : 170;
      box.style.height = Math.round(nativeH * s) + 'px';
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


/* ---- Background fit: position & zoom for channel / group backgrounds and the site-wide
   Portal chat background (owner call 2026-09-05). The shell paints backgrounds with
   background-size:cover + center, which cut most images off. Managers now drag the image
   to place it and scroll/slide to zoom, like a photo app; the result is saved per channel
   (or for the whole group) through sml-cbg/v1/fit and applied for every viewer. Site admins
   get the same editor — plus upload and opacity — for the Portal chat background
   (sml-portal-bg/v1/background), which is the default canvas every group opens on. ---- */
(function () {
  'use strict';
  if (window.__smlBgFit) return;
  window.__smlBgFit = 1;
  var NONCE = window.SML_GCAT_NONCE || (window.SMLGroupShell && window.SMLGroupShell.nonce) || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var F = { gid: '', fits: null, portal: null, natural: {}, edit: null, ui: null, lastApplied: '' };

  function ctx() { return window.SMLGroupShellContext || {}; }
  function gid() { var c = ctx(); if (c.groupId) return String(c.groupId).replace(/\D/g, ''); var cfg = window.SMLGroupShell; return cfg && cfg.groupId ? String(cfg.groupId).replace(/\D/g, '') : ''; }
  /* The shell publishes SMLGroupShellContext only when it announces a render; on a load where
     that never happened the editor used to think every channel was the Portal (owner report
     2026-09-06). The active sidebar button carries the truth, so read it when the context is missing. */
  function cid() {
    var c = ctx();
    if (c && c.mode) return c.mode === 'channel' && c.channelId ? String(c.channelId).replace(/\D/g, '') : '';
    var act = document.querySelector('.sml-gshell button.sml-gshell__channel.is-active[data-smlgs-channel]');
    return act ? String(act.getAttribute('data-smlgs-channel') || '').replace(/\D/g, '') : '';
  }
  function layer() { return document.querySelector('.sml-gshell__watermark'); }
  function conv() { return document.querySelector('.sml-gshell__conversation'); }
  function isPortal() { return !cid(); } /* the Portal chat is the group's channel-less canvas */
  function hdr() { return NONCE ? { 'X-WP-Nonce': NONCE } : {}; }
  function bgUrl(L) { var m = /url\(["']?(.*?)["']?\)/.exec((L && L.style.backgroundImage) || ''); return m ? m[1] : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function load(force) {
    var g = gid(); if (!g) return;
    if (F.gid !== g || force) {
      F.gid = g;
      fetch('/wp-json/sml-cbg/v1/fit?group_id=' + encodeURIComponent(g), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json(); }).then(function (j) { F.fits = (j && j.fits) || {}; apply(); }).catch(function () { F.fits = F.fits || {}; });
    }
    if (!F.portal || force) {
      fetch('/wp-json/sml-portal-bg/v1/background?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', headers: hdr() })
        .then(function (r) { return r.json(); }).then(function (j) { F.portal = j || {}; apply(); }).catch(function () { F.portal = F.portal || {}; });
    }
  }
  function currentFit() {
    if (isPortal()) { var p = F.portal || {}; return p.url ? { x: Number(p.x), y: Number(p.y), scale: Number(p.scale) || 0, opacity: p.opacity, portal: true } : null; }
    var fits = F.fits || {}; var own = fits['c' + cid()];
    if (own) return own;
    /* owner call 2026-09-07: a previous group-wide size must never be applied to a channel's own background */
    var urls = window.SMLBgSwitch && SMLBgSwitch.urls; var L = layer();
    var mine = urls && urls[String(cid())]; var showing = L ? bgUrl(L) : '';
    if (mine && showing && showing.indexOf(mine) !== -1) return null;
    return fits.g || null;
  }
  function apply() {
    var L = layer(); if (!L || F.edit) return;
    var f = currentFit();
    var size = f && f.scale > 0 ? (f.scale * 100).toFixed(2) + '% auto' : '';
    var pos = f && f.scale > 0 ? f.x + '% ' + f.y + '%' : '';
    if (L.style.backgroundSize !== size) L.style.backgroundSize = size;
    if (L.style.backgroundPosition !== pos) L.style.backgroundPosition = pos;
    /* the shell re-paints the Portal layer at its 15% default every render; the admin's opacity wins */
    if (f && f.portal) { var cfg = window.SMLGroupShell; if (cfg) { if (f.opacity != null) cfg.portalWatermarkOpacity = Number(f.opacity); if (F.portal && F.portal.url) cfg.portalWatermarkUrl = F.portal.url; } }
    if (f && f.portal && f.opacity != null && L.style.backgroundImage && L.style.backgroundImage.indexOf('none') < 0) {
      var o = String(Math.max(0, Math.min(100, Number(f.opacity))) / 100);
      if (L.style.opacity !== o) L.style.opacity = o;
    }
  }

  /* ---------------- editor ---------------- */
  var CSS = '' +
    '.sml-cbg-drag{position:absolute;inset:0;z-index:66;cursor:grab;background:rgba(0,0,0,.08);outline:2px dashed rgba(0,255,102,.45);outline-offset:-2px;touch-action:none}' +
    '.sml-cbg-drag.is-dragging{cursor:grabbing}' +
    '.sml-cbg-bar{position:absolute;left:12px;right:12px;bottom:12px;z-index:67;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(6,14,10,.94);border:1px solid rgba(0,255,102,.35);box-shadow:0 14px 34px rgba(0,0,0,.5);color:#dfe;font:600 12px/1.3 Inter,system-ui,sans-serif}' +
    '.sml-cbg-bar .hint{flex:1 1 100%;color:#9fb3a8;font-weight:500;font-size:11px}' +
    '.sml-cbg-bar label{display:flex;align-items:center;gap:6px;color:#bcd}' +
    '.sml-cbg-bar input[type=range]{width:130px;accent-color:#00ff66}' +
    '.sml-cbg-bar button{border:1px solid rgba(255,255,255,.14);background:#101923;color:#fff;border-radius:8px;padding:7px 11px;font:700 11px/1 Inter,system-ui,sans-serif;cursor:pointer}' +
    '.sml-cbg-bar button.pri{background:#00ff66;color:#031008;border-color:#00ff66}' +
    '.sml-cbg-bar button.warn{border-color:rgba(255,92,122,.5);color:#ff8fa3}' +
    '.sml-cbg-bar .st{flex:1 1 100%;color:#7ee2a8;font-size:11px;min-height:1em}' +
    '.sml-cbg-portal-btn{position:absolute;top:8px;right:46px;z-index:61;border:1px solid rgba(0,255,102,.45);background:rgba(8,18,24,.86);color:#cfe;border-radius:8px;padding:6px 10px;font:700 11px/1 Inter,system-ui,sans-serif;cursor:pointer}' +
    '.sml-cbg-hidden{display:none!important}';
  function ensureCss() { if (document.getElementById('sml-cbg-css')) return; var s = document.createElement('style'); s.id = 'sml-cbg-css'; s.textContent = CSS; document.head.appendChild(s); }

  function natural(url, cb) {
    if (F.natural[url]) return cb(F.natural[url]);
    var im = new Image(); im.onload = function () { F.natural[url] = { w: im.naturalWidth, h: im.naturalHeight }; cb(F.natural[url]); }; im.onerror = function () { cb(null); }; im.src = url;
  }
  function coverScale(nat, rect) { var ar = nat.w / nat.h, cr = rect.width / Math.max(1, rect.height); return Math.max(1, ar / cr); }
  function paint(st, L) {
    L.style.backgroundSize = (st.scale * 100).toFixed(2) + '% auto';
    L.style.backgroundPosition = st.x.toFixed(2) + '% ' + st.y.toFixed(2) + '%';
    if (st.portal && st.opacity != null) L.style.opacity = String(st.opacity / 100);
    if (F.ui) { var z = F.ui.querySelector('[data-cbg-zoom]'); if (z && Number(z.value) !== Math.round(st.scale * 100)) z.value = String(Math.round(st.scale * 100)); var zo = F.ui.querySelector('[data-cbg-zoom-out]'); if (zo) zo.textContent = Math.round(st.scale * 100) + '%'; }
  }
  function say(msg, bad) { if (!F.ui) return; var s = F.ui.querySelector('.st'); if (s) { s.textContent = msg || ''; s.style.color = bad ? '#ff8fa3' : '#7ee2a8'; } }

  function closeEditor(restore) {
    var L = layer();
    F.edit = null;
    if (F.ui) { F.ui.remove(); F.ui = null; }
    var d = document.querySelector('.sml-cbg-drag'); if (d) d.remove();
    if (restore && L) { L.style.backgroundSize = ''; L.style.backgroundPosition = ''; apply(); }
  }

  function openEditor(opts) {
    var L = layer(), C = conv(); if (!L || !C) return;
    var portal = isPortal();
    var url = bgUrl(L);
    if (!url && !(portal && opts && opts.allowEmpty)) { alert('Set a background image first (Channel background), then adjust it here.'); return; }
    ensureCss();
    var rect = L.getBoundingClientRect();
    var f = currentFit() || {};
    var start = function (nat) {
      var st = {
        portal: portal, url: url, nat: nat,
        x: f.x != null ? Number(f.x) : 50, y: f.y != null ? Number(f.y) : 50,
        scale: f.scale > 0 ? Number(f.scale) : (nat ? coverScale(nat, rect) : 1),
        opacity: portal ? (F.portal && F.portal.opacity != null ? Number(F.portal.opacity) : 35) : null,
        all: false, file: null
      };
      F.edit = st;
      if (getComputedStyle(C).position === 'static') C.style.position = 'relative';
      var drag = document.createElement('div'); drag.className = 'sml-cbg-drag'; drag.title = 'Drag to move the background';
      var bar = document.createElement('div'); bar.className = 'sml-cbg-bar';
      bar.innerHTML =
        '<div class="hint">' + (portal ? 'Portal chat background (site-wide default, admins only)' : 'Channel background') + ' — drag the image to place it, scroll or slide to zoom.</div>' +
        '<label>Zoom <input type="range" min="20" max="400" step="1" data-cbg-zoom value="' + Math.round(st.scale * 100) + '"><span data-cbg-zoom-out>' + Math.round(st.scale * 100) + '%</span></label>' +
        '<button type="button" data-cbg="cover">Fill</button><button type="button" data-cbg="width">Fit width</button><button type="button" data-cbg="center">Center</button>' +
        (portal ? '<label>Opacity <input type="range" min="5" max="100" step="1" data-cbg-op value="' + st.opacity + '"><span data-cbg-op-out>' + st.opacity + '%</span></label><label><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-cbg-file hidden><button type="button" data-cbg="upload">Upload new image</button></label>' :
                  '<label><input type="checkbox" data-cbg-all> Use for every channel in this group</label>') +
        '<button type="button" class="warn" data-cbg="reset">Reset</button><button type="button" data-cbg="cancel">Cancel</button><button type="button" class="pri" data-cbg="save">Save</button>' +
        '<div class="st"></div>';
      C.appendChild(drag); C.appendChild(bar); F.ui = bar;
      paint(st, L);

      /* drag → background-position: with the image wider than the box, moving from 0% to 100%
         shifts it by (image − box), so dx pixels = dx·100/(box − image) percent (sign included) */
      var down = null;
      drag.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }; drag.classList.add('is-dragging'); drag.setPointerCapture(e.pointerId); e.preventDefault(); });
      drag.addEventListener('pointermove', function (e) {
        if (!down) return;
        var r = L.getBoundingClientRect(); var ar = st.nat ? st.nat.w / st.nat.h : 1;
        var imgW = st.scale * r.width, imgH = imgW / ar;
        /* when the image is about the box's size the true denominator is ~0 and a 1px drag
           would fling the image; keep the denominator at least a quarter of the box so drags
           stay smooth and proportional in every case */
        var dX = r.width - imgW, dY = r.height - imgH;
        var minX = r.width * 0.25, minY = r.height * 0.25;
        dX = (dX < 0 ? -1 : 1) * Math.max(Math.abs(dX), minX);
        dY = (dY < 0 ? -1 : 1) * Math.max(Math.abs(dY), minY);
        st.x = Math.max(-100, Math.min(200, down.sx + (e.clientX - down.x) * 100 / dX));
        st.y = Math.max(-100, Math.min(200, down.sy + (e.clientY - down.y) * 100 / dY));
        paint(st, L);
      });
      var up = function () { down = null; drag.classList.remove('is-dragging'); };
      drag.addEventListener('pointerup', up); drag.addEventListener('pointercancel', up);
      drag.addEventListener('wheel', function (e) { e.preventDefault(); st.scale = Math.max(0.2, Math.min(6, st.scale * (e.deltaY < 0 ? 1.06 : 0.94))); paint(st, L); }, { passive: false });

      bar.querySelector('[data-cbg-zoom]').addEventListener('input', function (e) { st.scale = Math.max(0.2, Math.min(6, Number(e.target.value) / 100)); paint(st, L); });
      var op = bar.querySelector('[data-cbg-op]');
      if (op) op.addEventListener('input', function (e) { st.opacity = Number(e.target.value); bar.querySelector('[data-cbg-op-out]').textContent = st.opacity + '%'; paint(st, L); });
      var fileIn = bar.querySelector('[data-cbg-file]');
      if (fileIn) fileIn.addEventListener('change', function () {
        var fl = fileIn.files && fileIn.files[0]; if (!fl) return; st.file = fl;
        var fr = new FileReader(); fr.onload = function () { st.url = fr.result; L.style.backgroundImage = 'url("' + fr.result + '")'; natural(fr.result, function (n) { st.nat = n; st.scale = n ? coverScale(n, L.getBoundingClientRect()) : 1; st.x = 50; st.y = 50; paint(st, L); say('New image loaded — place it, then Save.'); }); }; fr.readAsDataURL(fl);
      });
      var allIn = bar.querySelector('[data-cbg-all]');
      if (allIn) allIn.addEventListener('change', function () { st.all = !!allIn.checked; });

      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-cbg]'); if (!b) return; e.preventDefault(); e.stopPropagation();
        var act = b.getAttribute('data-cbg'); var r = L.getBoundingClientRect();
        if (act === 'cover') { st.scale = st.nat ? coverScale(st.nat, r) : 1; st.x = 50; st.y = 50; paint(st, L); }
        else if (act === 'width') { st.scale = 1; st.x = 50; paint(st, L); }
        else if (act === 'center') { st.x = 50; st.y = 50; paint(st, L); }
        else if (act === 'upload') { if (fileIn) fileIn.click(); }
        else if (act === 'cancel') { closeEditor(true); }
        else if (act === 'reset') { save(st, true); }
        else if (act === 'save') { save(st, false); }
      });
    };
    if (url) natural(url, start); else start(null);
  }

  function save(st, reset) {
    say(reset ? 'Resetting…' : 'Saving…');
    var p;
    if (st.portal) {
      var fd = new FormData();
      if (reset) { fd.append('reset_fit', '1'); } else { fd.append('x', st.x.toFixed(2)); fd.append('y', st.y.toFixed(2)); fd.append('scale', st.scale.toFixed(3)); }
      fd.append('opacity', String(st.opacity));
      if (st.file) fd.append('file', st.file);
      p = fetch('/wp-json/sml-portal-bg/v1/background', { method: 'POST', credentials: 'same-origin', headers: hdr(), body: fd });
    } else {
      var body = { group_id: Number(gid()), channel_id: st.all ? 0 : Number(cid()) };
      if (reset) body.reset = true; else { body.x = Number(st.x.toFixed(2)); body.y = Number(st.y.toFixed(2)); body.scale = Number(st.scale.toFixed(3)); }
      p = fetch('/wp-json/sml-cbg/v1/fit', { method: 'POST', credentials: 'same-origin', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr()), body: JSON.stringify(body) });
    }
    p.then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
      if (!j && /Checking your browser|Javascript required/i.test(t)) throw new Error('WordPress.com is verifying your browser. Reload this page once, then save again.');
      if (!j && !r.ok && !st.__retried) { st.__retried = true; return new Promise(function (ok) { setTimeout(function () { ok(save(st, reset)); }, 1500); }); }
      return { ok: r.ok, j: j || {} }; }); }).then(function (res) {
      if (!res) return;
      if (!res.ok) throw new Error((res.j && res.j.message) || 'Could not save (HTTP error).');
      say('Saved.');
      setTimeout(function () { closeEditor(false); load(true); if (st.portal && st.file) location.reload(); }, 400);
    }).catch(function (e) { say(e.message || 'Could not save.', true); });
  }

  /* ---------------- entry points ---------------- */
  function canManageHere() {
    if (isPortal()) return !!(F.portal && F.portal.can_edit);
    return !!document.querySelector('[data-smlgs-owner-controls], .sml-gshell__channel-watermark-button, #sml-ghx-menu');
  }
  function menuNode() { return document.querySelector('[data-smlgs-owner-menu]') || document.getElementById('sml-ghx-menu'); }
  function closeMenu(menu) { if (menu) menu.classList.remove('open'); var d = document.querySelector('.sml-gshell__owner-dots'); if (d) d.setAttribute('aria-expanded', 'false'); }
  function ensureEntry() {
    ensureCss();
    var menu = menuNode();
    var L = layer();
    var show = !!L && canManageHere();
    if (menu) {
      var mine = menu.querySelector('[data-cbg-menu]');
      if (show && !mine) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-cbg-menu', '1');
        b.textContent = isPortal() ? 'Portal background' : 'Adjust background (drag & zoom)';
        b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); closeMenu(menu); openEditor({ allowEmpty: isPortal() }); });
        menu.appendChild(b);
      } else if (mine) {
        var label = isPortal() ? 'Portal background' : 'Adjust background (drag & zoom)';
        if (mine.textContent !== label) mine.textContent = label;
        if (!show) mine.remove();
      }
    }
    /* Portal chat with no ⋯ menu on this layout: give admins a direct button on the canvas */
    var C = conv();
    var direct = document.querySelector('.sml-cbg-portal-btn');
    if (isPortal() && F.portal && F.portal.can_edit && !menu && C) {
      if (!direct) { direct = document.createElement('button'); direct.type = 'button'; direct.className = 'sml-cbg-portal-btn'; direct.textContent = 'Portal background'; direct.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openEditor({ allowEmpty: true }); }); if (getComputedStyle(C).position === 'static') C.style.position = 'relative'; C.appendChild(direct); }
    } else if (direct) { direct.remove(); }
  }

  /* After the owner UPLOADS a new Channel background (the shell modal's form submit), the
     server drops the old fit for that channel and we open the editor so they place the new
     picture. Keyed on the submit, never on the layer's URL: the shell repaints the URL on every
     channel switch, and watching it opened the editor on switches (owner report 2026-09-06). */
  var pending = null;
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || !form.matches || !form.matches('[data-smlgs-channel-watermark-form]')) return;
    if (isPortal()) return;
    pending = { key: gid() + ':' + cid(), url: bgUrl(layer()), t: Date.now() };
  }, true);
  function watchNewImage() {
    if (!pending) return;
    if (Date.now() - pending.t > 90000) { pending = null; return; }
    var L = layer(); if (!L) return;
    if (gid() + ':' + cid() !== pending.key) { pending = null; return; }
    var modal = document.querySelector('[data-smlgs-channel-watermark-modal]');
    if (modal && !modal.hidden) return;   /* still inside the upload dialog */
    var url = bgUrl(L);
    if (!url || url === pending.url || url.indexOf('data:') === 0) return;
    pending = null;
    if (F.edit || !canManageHere()) return;
    load(true);
    setTimeout(function () { if (!F.edit && bgUrl(layer()) === url) { openEditor({}); say('New background — drag to place it, zoom, then Save.'); } }, 600);
  }
  function tick() { load(false); apply(); ensureEntry(); watchNewImage(); }
  function boot() { tick(); setInterval(tick, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.SMLBgFit = { open: openEditor, close: closeEditor, reload: function () { load(true); }, apply: apply, state: F };
})();


/* ---- Message rows (owner call 2026-09-05): Discord-style row surfaces. Over a channel or
   Portal background the shell's messages had no row of their own (a 1.8% hover tint only),
   so replies/reactions landed on the wrong message. Every message now sits on its own
   translucent row with a clear hover/focus state (brighter row + green edge) and the action
   bar appears on hover, not only on keyboard focus. Pure CSS; the shell's markup is untouched. */
(function () {
  'use strict';
  if (document.getElementById('sml-msgrow-css')) return;
  var css = '' +
    '.sml-gshell__messages .sml-gshell__message{margin:0 0 6px!important;padding:8px 10px!important;border-radius:10px;background:rgba(6,14,10,.62);border:1px solid rgba(255,255,255,.05);box-shadow:inset 3px 0 0 transparent;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}' +
    '.sml-gshell__messages .sml-gshell__message:hover,.sml-gshell__messages .sml-gshell__message:focus-within{background:rgba(12,26,18,.9)!important;border-color:rgba(0,255,102,.3);box-shadow:inset 3px 0 0 rgba(0,255,102,.6)}' +
    '.sml-gshell__messages .sml-gshell__message.is-reply-highlight{border-color:rgba(0,255,102,.55)}' +
    '.sml-gshell__messages .sml-gshell__message.is-thread-reply{background:rgba(6,14,10,.5)}' +
    '.sml-gshell__message:hover .sml-gshell__message-actions{opacity:1;pointer-events:auto;transform:translateY(0)}' +
    '.sml-gshell__messages .sml-gshell__message .sml-gshell__message-actions{top:-12px;right:8px}' +
    '@media (prefers-reduced-motion:reduce){.sml-gshell__messages .sml-gshell__message{transition:none}}';
  var st = document.createElement('style'); st.id = 'sml-msgrow-css'; st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();


/* ---- Right rail (owner call 2026-09-05): when a channel shows its VERIFIED 5-DAY RECORD,
   the Watchlist 24h block is hidden — the two together crowd the rail. Channels without a
   record (and the Portal chat) keep the watchlist. Re-evaluated every second because the
   shell rebuilds the rail per channel. ---- */
(function () {
  'use strict';
  if (window.__smlAsideRecord) return;
  window.__smlAsideRecord = 1;
  var css = '.sml-gshell__aside.sml-has-record > .sml-sw-group{display:none!important}';
  function ensureCss() { if (document.getElementById('sml-aside-record-css')) return; var st = document.createElement('style'); st.id = 'sml-aside-record-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function hasRecord(aside) {
    var kids = aside.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList.contains('sml-sw-group')) continue;
      var head = (k.querySelector('h1,h2,h3,h4,strong,.sml-gshell__aside-title') || k);
      var t = (head.textContent || k.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (/5-?DAY RECORD/i.test(t) && getComputedStyle(k).display !== 'none' && !k.hidden) return true;
    }
    return false;
  }
  function tick() {
    ensureCss();
    var aside = document.querySelector('.sml-gshell__aside');
    if (!aside) return;
    aside.classList.toggle('sml-has-record', hasRecord(aside));
  }
  function boot() { tick(); setInterval(tick, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();


/* ---- Owner calls 2026-09-05/06:
   (1) Banner resize handle: the channel-banner "pull-down" is hidden unless the owner
       chooses "Resize banner" from the ⋯ menu (strict — no accidental drags).
   (2) Portal chat right rail: "Online" becomes "Groups in the Portal" — which groups have
       members online right now (sml-portal/v1/online-groups), instead of one group's roster. ---- */
(function () {
  'use strict';
  if (window.__smlPortalOnline) return;
  window.__smlPortalOnline = 1;
  var css = '' +
    '.sml-gshell .sml-cbanner-resize{display:none!important}' +
    '.sml-gshell.sml-banner-edit .sml-cbanner-resize{display:flex!important}' +
    /* the shell's own '.sml-gshell__main-head > button{position:relative}' out-specifies the banner plugin's absolute handle and
       floated it into the middle of the banner — pin it back to the bottom edge (owner report 2026-09-09) */
    /* owner call 2026-09-09 ("grab the bottom of it"): the WHOLE bottom edge is the grab zone — the button spans the banner
       width as an invisible 22px strip straddling the edge; the green pill (span) + px readout sit centred inside it */
    '.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize{position:absolute!important;left:0!important;right:0!important;width:100%!important;bottom:-11px!important;top:auto!important;height:22px!important;margin:0!important;padding:0!important;transform:none!important;z-index:40!important;cursor:ns-resize!important;background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0!important;display:flex;align-items:center;justify-content:center;touch-action:none}' +
    '.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize > span{position:static!important;transform:none!important;width:84px!important;height:18px!important;border:1px solid rgba(56,245,138,.76)!important;border-radius:999px!important;background:rgba(7,20,13,.92)!important;box-shadow:0 0 0 3px rgba(56,245,138,.14),0 6px 18px rgba(0,0,0,.45)!important;position:relative!important}' +
    '.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize > span::after{content:"";position:absolute;left:50%;top:50%;width:26px;height:3px;margin:-1.5px 0 0 -13px;border-radius:999px;background:#38F58A}' +
    '.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize output{position:static!important;transform:none!important;margin-left:8px;color:#bafbd7;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}' +
    '.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize:hover > span,.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize.is-dragging > span{border-color:#7dffb5!important;background:#0b3a22!important}' +
    'html.sml-mobile .sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize{height:34px!important;bottom:-17px!important}html.sml-mobile .sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize > span{width:120px!important;height:26px!important}' +
    /* owner call 2026-09-09: while the banner editor is open (drag the picture left/right, zoom) the strip must not sit over the
       picture — shrink it to the pill and hang it fully below the edge so the placement drag owns the whole banner */
    '.sml-gshell.sml-banner-edit .sml-gshell__main-head > button.sml-cbanner-resize{left:50%!important;right:auto!important;width:132px!important;transform:translateX(-50%)!important;bottom:-24px!important;height:24px!important}' +
    'html.sml-mobile .sml-gshell.sml-banner-edit .sml-gshell__main-head > button.sml-cbanner-resize{bottom:-34px!important;height:34px!important;width:160px!important}' +
    /* desktop managers can grab the bottom edge straight away: the handle appears while the pointer is over the banner */
    /* owner call 2026-09-09: managers always see the grab strip on the banner's bottom edge (the plugin only creates it for
       managers); hover-only left it invisible at mousedown, so drags never started */
    '.sml-gshell .sml-gshell__main-head > button.sml-cbanner-resize{display:flex!important}.sml-gshell .sml-gshell__main-head.sml-cbanner-is-hidden > button.sml-cbanner-resize{display:none!important}' +
    '.sml-banner-edit-done{position:absolute;top:8px;left:8px;z-index:62;border:1px solid rgba(0,255,102,.55);background:#00ff66;color:#031008;border-radius:8px;padding:6px 10px;font:800 11px/1 Inter,system-ui,sans-serif;cursor:pointer}' +
    '.sml-pgo-list{display:flex;flex-direction:column;gap:6px}' +
    '.sml-pgo-row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:9px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.05);text-decoration:none;color:inherit}' +
    '.sml-pgo-row:hover{border-color:rgba(0,255,102,.35);background:rgba(0,255,102,.06)}' +
    '.sml-pgo-row img,.sml-pgo-row .ph{width:28px;height:28px;border-radius:8px;object-fit:cover;flex:none;background:#0b1a13;display:flex;align-items:center;justify-content:center;color:#7ee2a8;font:800 12px/1 Inter,system-ui,sans-serif}' +
    '.sml-pgo-row .nm{flex:1;min-width:0;font:700 12px/1.3 Inter,system-ui,sans-serif;color:#e6f5ec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sml-pgo-row .ct{flex:none;display:inline-flex;align-items:center;gap:5px;font:700 11px/1 "IBM Plex Mono",monospace;color:#00ff88}' +
    '.sml-pgo-row .ct i{width:7px;height:7px;border-radius:50%;background:#00ff88;box-shadow:0 0 0 3px rgba(0,255,136,.18)}' +
    '.sml-pgo-empty{color:#7e8a96;font:500 12px/1.5 Inter,system-ui,sans-serif}';
  function ensureCss() { if (document.getElementById('sml-portal-online-css')) return; var st = document.createElement('style'); st.id = 'sml-portal-online-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ctx() { return window.SMLGroupShellContext || {}; }
  function isPortal() { return String(ctx().mode || '') === 'chat' || !ctx().channelId; }

  /* (1) strict banner resize — and, since 2026-09-06 (owner call), PLACEMENT: while "Resize
     banner" is on, the banner image can be dragged into position and zoomed with the wheel or
     the slider, on top of the height handle. Saves through the banner plugin's own route with the
     same zoom / pos_x / pos_y it already stores, so the "Channel banner" dialog and this agree. */
  var BCSS = '' +
    /* the banner plugin pins the handle to the banner's bottom edge (position:absolute; bottom:-8px); never override that —
       'position:relative' pulled it up into the toolbar (owner report 2026-09-09: could not grab the bottom to shrink it) */
    '.sml-gshell.sml-banner-edit .sml-cbanner-resize{z-index:40}' +
    '.sml-banner-drag{position:absolute;inset:0;z-index:2;cursor:grab;outline:2px dashed rgba(0,255,102,.5);outline-offset:-2px;background:rgba(0,0,0,.06);touch-action:none}' +
    '.sml-banner-drag.is-dragging{cursor:grabbing}' +
    '.sml-banner-bar{position:absolute;top:8px;left:8px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:calc(100% - 60px);padding:8px 10px;border-radius:10px;background:rgba(6,14,10,.94);border:1px solid rgba(0,255,102,.35);box-shadow:0 10px 26px rgba(0,0,0,.5);color:#dfe;font:600 11px/1.3 Inter,system-ui,sans-serif}' +
    '.sml-banner-bar .hint{flex:1 1 100%;color:#9fb3a8;font-weight:500}' +
    '.sml-banner-bar label{display:flex;align-items:center;gap:6px;color:#bcd}' +
    '.sml-banner-bar input[type=range]{width:110px;accent-color:#00ff66}' +
    '.sml-banner-bar button{border:1px solid rgba(255,255,255,.14);background:#101923;color:#fff;border-radius:8px;padding:6px 10px;font:700 11px/1 Inter,system-ui,sans-serif;cursor:pointer}' +
    '.sml-banner-bar button.pri{background:#00ff66;color:#031008;border-color:#00ff66}' +
    '.sml-banner-bar .st{flex:1 1 100%;color:#7ee2a8;min-height:1em}';
  function bannerCss() { if (document.getElementById('sml-banner-place-css')) return; var st = document.createElement('style'); st.id = 'sml-banner-place-css'; st.textContent = BCSS; (document.head || document.documentElement).appendChild(st); }
  function bannerCid() { var c = ctx(); if (c && c.mode) return c.mode === 'channel' && c.channelId ? String(c.channelId) : ''; var a = document.querySelector('.sml-gshell button.sml-gshell__channel.is-active[data-smlgs-channel]'); return a ? String(a.getAttribute('data-smlgs-channel') || '') : ''; }
  function bannerCfg() { return window.SMLChannelBanners || {}; }
  function bannerEntry(cid) { var b = bannerCfg().banners; return b && b[cid] ? b[cid] : null; }
  var B = { on: false, cid: '', st: null, orig: null, ui: null, drag: null };

  function ensureBannerRule() {
    var shell = document.querySelector('.sml-gshell'); if (!shell) return;
    var menu = document.querySelector('[data-smlgs-owner-menu]') || document.getElementById('sml-ghx-menu');
    var handle = document.querySelector('.sml-cbanner-resize');
    if (menu && handle && !menu.querySelector('[data-banner-edit]')) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-banner-edit', '1'); b.textContent = 'Resize banner';
      b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); menu.classList.remove('open'); var d = document.querySelector('.sml-gshell__owner-dots'); if (d) d.setAttribute('aria-expanded', 'false'); shell.classList.add('sml-banner-edit'); openBannerEditor(shell); });
      menu.appendChild(b);
    }
    if (!handle || !shell.classList.contains('sml-banner-edit')) { if (B.on) closeBannerEditor(shell, true); var d = document.querySelector('.sml-banner-edit-done'); if (d) d.remove(); }
    else if (B.on && (B.cid !== bannerCid() || !document.querySelector('.sml-banner-bar'))) { closeBannerEditor(shell, true); }
  }
  function ensureDone(shell) { openBannerEditor(shell); }

  function bannerPaint() {
    var img = document.querySelector('.sml-gshell__main-head .sml-cbanner-image'); var st = B.st; if (!st) return;
    /* the plugin's render() repaints from its state on every shell mutation — keep state in step */
    var e = bannerEntry(B.cid); if (e) { e.zoom = Math.round(st.zoom); e.pos_x = Math.round(st.x); e.pos_y = Math.round(st.y); }
    if (img) { img.style.objectPosition = st.x.toFixed(1) + '% ' + st.y.toFixed(1) + '%'; img.style.transform = 'scale(' + (st.zoom / 100).toFixed(3) + ')'; }
    if (B.ui) { var z = B.ui.querySelector('[data-bz]'); if (z && Number(z.value) !== Math.round(st.zoom)) z.value = String(Math.round(st.zoom)); var o = B.ui.querySelector('[data-bz-out]'); if (o) o.textContent = Math.round(st.zoom) + '%'; }
  }
  function bannerSay(msg, bad) { if (!B.ui) return; var el = B.ui.querySelector('.st'); if (el) { el.textContent = msg || ''; el.style.color = bad ? '#ff8fa3' : '#7ee2a8'; } }

  function openBannerEditor(shell) {
    var head = document.querySelector('.sml-gshell__main-head'); if (!head || B.on) return;
    bannerCss();
    var cid = bannerCid(); var entry = bannerEntry(cid); var img = head.querySelector('.sml-cbanner-image');
    var placeable = !!(cid && entry && entry.url && !entry.hidden && img);
    if (getComputedStyle(head).position === 'static') head.style.position = 'relative';
    B.on = true; B.cid = cid;
    B.st = placeable ? { zoom: Number(entry.zoom) || 100, x: entry.pos_x == null ? 50 : Number(entry.pos_x), y: entry.pos_y == null ? 50 : Number(entry.pos_y) } : null;
    B.orig = B.st ? { zoom: B.st.zoom, x: B.st.x, y: B.st.y } : null;
    var bar = document.createElement('div'); bar.className = 'sml-banner-bar';
    bar.innerHTML = '<div class="hint">' + (placeable ? 'Drag the banner to place it · scroll or slide to zoom · pull the handle below to change its height.' : 'Pull the handle below to change the banner height. To drag a picture into place, give this channel its own image first (⋮ → Channel banner).') + '</div>' +
      (placeable ? '<label>Zoom <input type="range" min="100" max="300" step="1" data-bz value="' + Math.round(B.st.zoom) + '"><span data-bz-out>' + Math.round(B.st.zoom) + '%</span></label><button type="button" data-b="center">Center</button>' : '') +
      '<button type="button" data-b="cancel">Cancel</button><button type="button" class="pri" data-b="done">' + (placeable ? 'Save' : 'Done') + '</button><div class="st"></div>';
    head.appendChild(bar); B.ui = bar;
    if (placeable) {
      var drag = document.createElement('div'); drag.className = 'sml-banner-drag'; drag.title = 'Drag to place the banner'; head.appendChild(drag); B.drag = drag;
      var down = null;
      drag.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, sx: B.st.x, sy: B.st.y }; drag.classList.add('is-dragging'); try { drag.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
      drag.addEventListener('pointermove', function (e) {
        if (!down || !img) return;
        var box = head.getBoundingClientRect(), nw = img.naturalWidth || box.width, nh = img.naturalHeight || box.height;
        var cover = Math.max(box.width / nw, box.height / nh), z = B.st.zoom / 100;
        var ovX = (nw * cover - box.width) * z, ovY = (nh * cover - box.height) * z;   /* px the image overhangs the box, per axis */
        if (ovX > 1) B.st.x = Math.max(0, Math.min(100, down.sx - (e.clientX - down.x) * 100 / ovX));
        if (ovY > 1) B.st.y = Math.max(0, Math.min(100, down.sy - (e.clientY - down.y) * 100 / ovY));
        bannerPaint();
      });
      var up = function () { down = null; drag.classList.remove('is-dragging'); };
      drag.addEventListener('pointerup', up); drag.addEventListener('pointercancel', up);
      drag.addEventListener('wheel', function (e) { e.preventDefault(); B.st.zoom = Math.max(100, Math.min(300, B.st.zoom * (e.deltaY < 0 ? 1.06 : 0.94))); bannerPaint(); }, { passive: false });
      bar.querySelector('[data-bz]').addEventListener('input', function (e) { B.st.zoom = Math.max(100, Math.min(300, Number(e.target.value) || 100)); bannerPaint(); });
      bannerPaint();
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-b]'); if (!b) return; e.preventDefault(); e.stopPropagation();
      var act = b.getAttribute('data-b');
      if (act === 'center') { B.st.x = 50; B.st.y = 50; bannerPaint(); }
      else if (act === 'cancel') { closeBannerEditor(shell, true); }
      else if (act === 'done') { if (!placeable) { closeBannerEditor(shell, false); return; } saveBannerPlacement(shell); }
    });
  }
  function closeBannerEditor(shell, restore) {
    if (restore && B.st && B.orig) { B.st.zoom = B.orig.zoom; B.st.x = B.orig.x; B.st.y = B.orig.y; bannerPaint(); }
    if (B.ui) B.ui.remove(); if (B.drag) B.drag.remove();
    B.on = false; B.ui = null; B.drag = null; B.st = null; B.orig = null; B.cid = '';
    if (shell) shell.classList.remove('sml-banner-edit');
  }
  function saveBannerPlacement(shell) {
    var cfg = bannerCfg(); var st = B.st; if (!st) return;
    bannerSay('Saving…');
    var fd = new FormData(); fd.append('group_id', String(gid())); fd.append('channel_id', String(B.cid));
    fd.append('zoom', String(Math.round(st.zoom))); fd.append('pos_x', String(Math.round(st.x))); fd.append('pos_y', String(Math.round(st.y)));
    var hdrs = {}; if (cfg.nonce) hdrs['X-WP-Nonce'] = cfg.nonce;
    fetch(cfg.saveApi || '/wp-json/sml/v1/group/channel/banner', { method: 'POST', credentials: 'same-origin', headers: hdrs, body: fd })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (err) { j = null; }
        if (!j && /Checking your browser|Javascript required/i.test(t)) throw new Error('WordPress.com is verifying your browser. Reload this page once, then save again.');
        if (!r.ok || !j) throw new Error((j && j.message) || 'Could not save the banner placement.');
        return j; }); })
      .then(function (j) {
        if (j && j.banner && cfg.banners) cfg.banners[B.cid] = j.banner;
        B.orig = { zoom: st.zoom, x: st.x, y: st.y };
        bannerSay('Saved.');
        setTimeout(function () { closeBannerEditor(shell, false); }, 350);
      }).catch(function (e) { bannerSay(e.message || 'Could not save.', true); });
  }
  function gid() { var c = ctx(); if (c && c.groupId) return String(c.groupId); var cfg = window.SMLGroupShell; return cfg && cfg.groupId ? String(cfg.groupId) : String(bannerCfg().groupId || ''); }

  /* (2) Portal: groups online */
  var P = { data: null, at: 0, inflight: false, saved: null };
  function fetchGroups() {
    if (P.inflight || Date.now() - P.at < 15000) return;
    P.inflight = true;
    fetch('/wp-json/sml-portal/v1/online-groups?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(function (j) { P.data = j || {}; P.at = Date.now(); P.inflight = false; render(); })
      .catch(function () { P.inflight = false; P.at = Date.now(); });
  }
  function onlineSection() {
    var aside = document.querySelector('.sml-gshell__aside'); if (!aside) return null;
    var box = aside.querySelector('[data-smlgs-online]'); return box ? box.closest('section') || box.parentElement : null;
  }
  function render() {
    var sec = onlineSection(); if (!sec) return;
    var title = sec.querySelector('.sml-gshell__section-title'); var box = sec.querySelector('[data-smlgs-online]');
    if (!box) return;
    if (!isPortal()) {
      if (sec.getAttribute('data-pgo') === '1') { sec.removeAttribute('data-pgo'); if (title) title.innerHTML = 'Online <span data-smlgs-online-count></span>'; box.innerHTML = '<p class="sml-gshell__empty">Checking who is online…</p>'; }
      return;
    }
    var groups = (P.data && P.data.groups) || [];
    sec.setAttribute('data-pgo', '1');
    if (title) title.innerHTML = 'Groups in the Portal <span data-smlgs-online-count>' + (groups.length ? '— ' + esc(groups.length) : '') + '</span>';
    if (!P.data) { box.innerHTML = '<p class="sml-pgo-empty">Checking which groups are here…</p>'; return; }
    if (!groups.length) { box.innerHTML = '<p class="sml-pgo-empty">No groups have members in the Portal right now.</p>'; return; }
    box.innerHTML = '<div class="sml-pgo-list">' + groups.map(function (g) {
      var ic = g.icon_url ? '<img src="' + esc(g.icon_url) + '" alt="">' : '<span class="ph">' + esc(String(g.name || '?').slice(0, 1).toUpperCase()) + '</span>';
      return '<a class="sml-pgo-row" href="' + esc(g.url || ('/groups/' + g.slug + '/')) + '">' + ic + '<span class="nm">' + esc(g.name) + '</span><span class="ct"><i></i>' + esc(g.online) + ' online</span></a>';
    }).join('') + '</div>';
  }
  function tick() { ensureCss(); ensureBannerRule(); if (isPortal()) fetchGroups(); render(); }
  function boot() { tick(); setInterval(tick, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();


/* ---- Transparent banners + backgrounds (owner call 2026-09-06):
   (1) A channel background whose image has real transparency also runs OVER the channel banner —
       one continuous picture across the header and the chat, not a strip that stops at the banner.
   (2) A banner image with transparency gets no backing at all: the header's black fill, its
       gradient wash and the group-banner layer beneath are switched off, so the picture is 100%
       see-through where its pixels are. Opaque images behave exactly as before.
   Transparency is measured, not guessed: the image is drawn to a 64×64 canvas and counted. ---- */
(function () {
  'use strict';
  if (window.__smlTransparentLayers) return;
  window.__smlTransparentLayers = 1;
  var css = '' +
    '.sml-gshell__main-head.sml-banner-transparent{background:transparent!important}' +
    '.sml-gshell__main-head.sml-banner-transparent::after{display:none!important}' +
    '.sml-gshell__main-head.sml-banner-transparent > .sml-gshell__header-banner{background-color:transparent!important}' +
    '.sml-gshell__main-head.sml-banner-transparent-own > .sml-gshell__header-banner{visibility:hidden!important}' +
    '.sml-bg-over{position:absolute;inset:0;z-index:1;pointer-events:none;background-repeat:no-repeat}';
  function ensureCss() { if (document.getElementById('sml-transparent-layers-css')) return; var st = document.createElement('style'); st.id = 'sml-transparent-layers-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function urlOf(bgi) { var m = /url\(["']?(.*?)["']?\)/.exec(bgi || ''); return m ? m[1] : ''; }

  /* alpha probe, cached per URL: {done, alpha, nw, nh} */
  var A = {};
  function probe(url) {
    if (!url || url.indexOf('data:') === 0 && url.length > 200000) return null;
    if (A[url]) return A[url].done ? A[url] : null;
    var rec = A[url] = { done: false, alpha: false, nw: 0, nh: 0 };
    var im = new Image();
    if (url.indexOf('data:') !== 0) im.crossOrigin = 'anonymous';
    im.onload = function () {
      rec.nw = im.naturalWidth; rec.nh = im.naturalHeight;
      try {
        var w = 64, h = 64, c = document.createElement('canvas'); c.width = w; c.height = h;
        var cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, w, h);
        var d = cx.getImageData(0, 0, w, h).data, t = 0;
        for (var i = 3; i < d.length; i += 4) { if (d[i] < 128) t++; }
        rec.alpha = t >= (w * h) * 0.02;   /* at least 2% of the picture is see-through */
      } catch (e) { rec.alpha = false; }     /* cross-origin taint etc.: treat as opaque */
      rec.done = true;
    };
    im.onerror = function () { rec.done = true; };
    im.src = url;
    return null;
  }

  function head() { return document.querySelector('.sml-gshell__main-head'); }
  function layer() { return document.querySelector('[data-smlgs-watermark]'); }

  /* (2) transparent banner → no backing */
  function bannerPass(H) {
    var img = H.querySelector('.sml-cbanner-image');
    var own = img && (img.currentSrc || img.src) ? probe(img.currentSrc || img.src) : null;
    var ownAlpha = !!(own && own.alpha);
    var groupLayer = H.querySelector('.sml-gshell__header-banner');
    var gUrl = groupLayer ? urlOf(getComputedStyle(groupLayer).backgroundImage) : '';
    var grp = (!img && gUrl) ? probe(gUrl) : null;
    var grpAlpha = !!(grp && grp.alpha);
    H.classList.toggle('sml-banner-transparent-own', ownAlpha);
    H.classList.toggle('sml-banner-transparent', ownAlpha || grpAlpha);
  }

  /* (1) transparent channel background → continue it over the banner */
  function overlayPass(H) {
    var L = layer(); var url = L ? urlOf(L.style.backgroundImage || getComputedStyle(L).backgroundImage) : '';
    var over = H.querySelector('.sml-bg-over');
    var rec = url ? probe(url) : null;
    var want = !!(rec && rec.alpha && rec.nw > 0 && rec.nh > 0) && String(L.style.opacity || getComputedStyle(L).opacity) !== '0';
    if (!want) { if (over) over.remove(); return; }
    if (!over) { over = document.createElement('div'); over.className = 'sml-bg-over'; var img = H.querySelector('.sml-cbanner-image'); if (img && img.nextSibling) H.insertBefore(over, img.nextSibling); else H.appendChild(over); }
    var Lr = L.getBoundingClientRect(), Hr = H.getBoundingClientRect(), lcs = getComputedStyle(L);
    var nw = rec.nw, nh = rec.nh, iw, ih;
    var size = String(lcs.backgroundSize || 'cover').trim();
    if (size === 'cover') { var sc = Math.max(Lr.width / nw, Lr.height / nh); iw = nw * sc; ih = nh * sc; }
    else if (size === 'contain') { var sc2 = Math.min(Lr.width / nw, Lr.height / nh); iw = nw * sc2; ih = nh * sc2; }
    else {
      var parts = size.split(/\s+/), a = parts[0], b = parts[1] || 'auto';
      iw = /%$/.test(a) ? Lr.width * parseFloat(a) / 100 : (/px$/.test(a) ? parseFloat(a) : nw);
      ih = b === 'auto' ? iw * nh / nw : (/%$/.test(b) ? Lr.height * parseFloat(b) / 100 : parseFloat(b));
      if (a === 'auto' && b !== 'auto') iw = ih * nw / nh;
    }
    var pos = String(lcs.backgroundPosition || '50% 50%').split(/\s+/), px, py;
    px = /%$/.test(pos[0]) ? (Lr.width - iw) * parseFloat(pos[0]) / 100 : parseFloat(pos[0]) || 0;
    py = /%$/.test(pos[1] || '50%') ? (Lr.height - ih) * parseFloat(pos[1] || '50%') / 100 : parseFloat(pos[1]) || 0;
    var bx = px + (Lr.left - Hr.left), by = py + (Lr.top - Hr.top);
    var bgi = 'url("' + url.replace(/["\\]/g, '\\$&') + '")';
    if (over.style.backgroundImage !== bgi) over.style.backgroundImage = bgi;
    over.style.backgroundSize = iw.toFixed(1) + 'px ' + ih.toFixed(1) + 'px';
    over.style.backgroundPosition = bx.toFixed(1) + 'px ' + by.toFixed(1) + 'px';
    over.style.opacity = String(L.style.opacity || lcs.opacity || 1);
  }

  function tick() { var H = head(); if (!H) return; ensureCss(); bannerPass(H); overlayPass(H); }
  function boot() { tick(); setInterval(tick, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.SMLTransparentLayers = { probe: probe, cache: A, tick: tick };
})();


/* ---- Sidebar, owner calls 2026-09-06:
   (1) Categories collapse like Discord: click a category header to fold its channels (the
       active channel and channels with unread messages stay visible, as Discord does); the
       fold is remembered per group in this browser. Folding never moves an engine node — it
       is a <head> stylesheet keyed by channel id, the same way the categories are ordered.
   (2) Unread = a tiny red counter on the channel (the shell's own "NEW" stamp, restyled and
       given the number it already carries), a counter on the Portal Chat button, and a summed
       counter on a folded category so nothing hides.
   (3) Landing channel: on arrival members open the owner's chosen channel (Edit Group →
       Landing channel, plugin sml-group-landing) — never the Portal chat; unset = the first
       open channel in the sidebar. ---- */
(function () {
  'use strict';
  if (window.__smlSidebarPlus) return;
  window.__smlSidebarPlus = 1;
  var STRIDE = 1000000, NATIVE = 1000000000;
  var css = '' +
    '.sml-gshell__channels .sml-gshell__category[data-sml-gcat],.sml-gshell__channels .sml-gshell__category:not([data-sml-gcat]){cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px}' +
    '.sml-gshell__channels .sml-gshell__category::before{content:"\\25BE";font-size:10px;opacity:.7;transition:transform .15s ease;display:inline-block}' +
    '.sml-gshell__channels .sml-gshell__category.is-collapsed::before{transform:rotate(-90deg)}' +
    '.sml-gshell__category-row .sml-gshell__category::before{content:none}' +
    '.sml-gshell__new-stamp,.sml-sb-badge{display:inline-flex!important;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:auto;border-radius:999px;background:#ff3b4a!important;color:#fff!important;font:800 10.5px/1 Inter,system-ui,sans-serif!important;letter-spacing:0;box-shadow:0 0 0 2px rgba(6,14,10,.9);flex:none}' +
    '.sml-gshell__channel.has-mention .sml-gshell__new-stamp{box-shadow:0 0 0 2px rgba(6,14,10,.9),0 0 10px rgba(255,59,74,.7)}' +
    '.sml-gshell__channels .sml-gshell__category[data-sb-unread]::after{content:attr(data-sb-unread);display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:auto;border-radius:999px;background:#ff3b4a;color:#fff;font:800 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:0;box-shadow:0 0 0 2px rgba(6,14,10,.9)}' +
    '.sml-gl-field{display:block;margin:12px 0}.sml-gl-field span{display:block;font:700 12px/1.3 inherit;margin-bottom:4px}.sml-gl-field select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.28);color:inherit;font:inherit}.sml-gl-field small{display:block;color:#8fa89b;font-size:11px;margin-top:4px}';
  function ensureCss() { if (document.getElementById('sml-sidebar-plus-css')) return; var st = document.createElement('style'); st.id = 'sml-sidebar-plus-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function ctx() { return window.SMLGroupShellContext || {}; }
  function slug() { var m = /\/groups\/([^\/?#]+)/.exec(location.pathname); return m ? decodeURIComponent(m[1]) : ''; }
  function gid() { var c = ctx(); if (c.groupId) return String(c.groupId); var cfg = window.SMLGroupShell; return cfg && cfg.groupId ? String(cfg.groupId) : ''; }
  function box() { return document.querySelector('.sml-gshell__channels'); }
  function ord(el) { var v = parseFloat(el.style.order || getComputedStyle(el).order); return isFinite(v) ? v : 0; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- unread map, read off the shell's own poll (no extra requests) ---------- */
  var unread = { chat: 0, channels: {} };
  (function observeUnread() {
    var F = window.fetch; if (!F || F.__smlSb) return;
    var W = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = F.apply(this, arguments);
      if (/\/group\/unread\b/.test(url)) {
        p.then(function (res) { try { res.clone().json().then(function (d) { if (!d) return; unread.chat = Number(d.chat && d.chat.unread || 0); var m = {}; Object.keys(d.channels || {}).forEach(function (k) { m[k] = Number(d.channels[k].unread || 0); }); unread.channels = m; }).catch(function () {}); } catch (e) {} });
      }
      return p;
    };
    W.__smlSb = 1; window.fetch = W;
  })();
  function countOf(btn) {
    var id = btn.getAttribute('data-smlgs-channel');
    if (id) return Number(unread.channels[String(Number(id))] || 0) || (function () { var s = btn.querySelector('.sml-gshell__new-stamp'); var m = s && /(\d+)/.exec(s.getAttribute('aria-label') || ''); return m ? Number(m[1]) : 0; })();
    return btn.classList.contains('sml-gshell__portal-channel') ? unread.chat : 0;
  }
  function fmt(n) { return n > 99 ? '99+' : String(n); }
  function badgePass(B) {
    [].slice.call(B.querySelectorAll('.sml-gshell__channel')).forEach(function (btn) {
      var n = countOf(btn), active = btn.classList.contains('is-active');
      var stamp = btn.querySelector('.sml-gshell__new-stamp, .sml-sb-badge');
      if (active || n < 1) { if (stamp && stamp.classList.contains('sml-sb-badge')) stamp.remove(); else if (stamp && stamp.textContent !== 'NEW') { /* shell stamp, count hidden by shell next render */ } return; }
      if (!stamp) { stamp = document.createElement('span'); stamp.className = 'sml-sb-badge'; stamp.setAttribute('aria-label', n + ' unread'); btn.appendChild(stamp); }
      var t = fmt(n); if (stamp.textContent !== t) stamp.textContent = t;
    });
  }

  /* ---------- category membership (by CSS order, never by moving nodes) ---------- */
  function headers(B) { return [].slice.call(B.querySelectorAll(':scope > .sml-gshell__category')); }
  function membersOf(B, h) {
    var btns = [].slice.call(B.querySelectorAll(':scope > .sml-gshell__channel[data-smlgs-channel]'));
    if (h.hasAttribute('data-sml-gcat')) {
      var o = ord(h), lo = o, hi = o + STRIDE;          /* header = (n)*STRIDE-1; its channels = (n)*STRIDE + rank */
      return btns.filter(function (b) { var v = ord(b); return v > lo && v < hi; });
    }
    /* native header: the engine's own following siblings until the next header, only those not
       claimed by a custom category (they keep the NATIVE order) */
    var out = [], n = h.nextElementSibling;
    while (n && !(n.classList && n.classList.contains('sml-gshell__category'))) {
      if (n.classList && n.classList.contains('sml-gshell__channel') && n.hasAttribute('data-smlgs-channel') && (!B.hasAttribute('data-sml-gcat-active') || ord(n) >= NATIVE)) out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  }
  function keyOf(h) { return String(h.textContent || '').replace(/\s+/g, ' ').trim(); }
  var LS = 'sml-gcat-collapsed:' + slug();
  function loadFolds() { try { return JSON.parse(localStorage.getItem(LS) || '[]') || []; } catch (e) { return []; } }
  function saveFolds(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  var folds = loadFolds();
  var SHEET = 'sml-gcat-collapse-style', sheetKey = '';
  function foldPass(B) {
    var rules = [];
    headers(B).forEach(function (h) {
      if (h.parentElement !== B) return;
      var k = keyOf(h), on = folds.indexOf(k) !== -1;
      h.classList.toggle('is-collapsed', on);
      var mem = membersOf(B, h), hidden = 0, sum = 0;
      if (on) {
        mem.forEach(function (b) {
          var n = countOf(b);
          if (b.classList.contains('is-active') || n > 0) { sum += n; return; }   /* Discord keeps these visible */
          hidden++;
          rules.push('.sml-gshell__channels>[data-smlgs-channel="' + b.getAttribute('data-smlgs-channel') + '"]{display:none!important}');
        });
      }
      /* the summed counter is a ::after on the header (attr), never a child node: the categories
         module matches headers by textContent and would drop a header whose text changed */
      if (on && sum > 0) { var t = fmt(sum); if (h.getAttribute('data-sb-unread') !== t) h.setAttribute('data-sb-unread', t); }
      else if (h.hasAttribute('data-sb-unread')) h.removeAttribute('data-sb-unread');
    });
    var want = rules.join('\n');
    var sheet = document.getElementById(SHEET);
    if (!sheet) { sheet = document.createElement('style'); sheet.id = SHEET; (document.head || document.documentElement).appendChild(sheet); }
    if (sheetKey !== want) { sheet.textContent = want; sheetKey = want; }
  }
  document.addEventListener('click', function (ev) {
    var h = ev.target.closest && ev.target.closest('.sml-gshell__channels > .sml-gshell__category');
    if (!h || ev.target.closest('button, a, input')) return;
    var k = keyOf(h); if (!k) return;
    var i = folds.indexOf(k); if (i === -1) folds.push(k); else folds.splice(i, 1);
    saveFolds(folds); var B = box(); if (B) foldPass(B);
  }, true);

  /* ---------- landing channel ---------- */
  var L = { done: false, touched: false, fetched: false, id: 0, t0: Date.now(), doneAt: 0 };
  /* Owner call 2026-09-07: the Portal must never show first. Until the landing channel is open, the conversation
     area is kept invisible (the sidebar, banner and rail still paint), so arrival goes straight to the channel. */
  var GATE = 'sml-landing-wait';
  (function () {
    var st = document.createElement('style'); st.id = 'sml-landing-gate-css';
    st.textContent = 'html.' + GATE + ' [data-smlgs-conversation],html.' + GATE + ' [data-smlgs-composer],html.' + GATE + ' .sml-gshell__composer{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(st);
  })();
  function release() { if (!L.doneAt) L.doneAt = Date.now(); L.done = true; document.documentElement.classList.remove(GATE); }
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, function (e) { if (e.target && e.target.closest && e.target.closest('.sml-gshell')) L.touched = true; }, true); });
  function deepLinked() { return /channel|#/.test(location.hash) && location.hash.length > 1 || /[?&](channel|c|tool)=/.test(location.search); }
  function fetchLanding() {
    var g = gid(); if (!g || L.fetched) return; L.fetched = true;
    fetch('/wp-json/sml-group-landing/v1/group/' + encodeURIComponent(g) + '?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(function (j) { L.id = Number(j && j.channel_id || 0); L.can = !!(j && j.can_manage); L.ready = true; try { localStorage.setItem('sml-landing:' + g, String(L.id)); } catch (e) {} })
      .catch(function () { L.ready = true; });
  }
  function firstOpen(B) {
    var btns = [].slice.call(B.querySelectorAll(':scope > .sml-gshell__channel[data-smlgs-channel]')).filter(function (b) { return !b.disabled && !b.classList.contains('is-locked') && !/🔒/.test(b.textContent || '') && getComputedStyle(b).display !== 'none'; });
    btns.sort(function (a, b) { return ord(a) - ord(b); });
    return btns[0] || null;
  }
  function landingPass(B) {
    if (L.done) { document.documentElement.classList.remove(GATE); return; }
    if (!L.fetched) fetchLanding();
    if (deepLinked() || L.touched) { L.done = true; return; }
    var c = ctx(); if (c.mode && c.mode !== 'chat') { L.done = true; return; }       /* already somewhere */
    if (!L.ready) {
      var cached = null; try { cached = localStorage.getItem('sml-landing:' + gid()); } catch (e) {}
      if (cached !== null) { L.id = Number(cached) || 0; }                       /* remembered from the last visit: open it now, the fresh setting confirms next time */
      else if (Date.now() - L.t0 > 12000) { L.ready = true; }
      else return;
    }
    var target = L.id ? B.querySelector(':scope > .sml-gshell__channel[data-smlgs-channel="' + L.id + '"]') : null;
    if (!target) target = firstOpen(B);
    if (!target) { if (Date.now() - L.t0 > 15000) L.done = true; return; }
    if (target.classList.contains('is-active')) { release(); return; }
    /* the shell may still be binding its handlers on the first tick: click, then confirm next tick */
    if (Date.now() - L.t0 > 8000) { release(); return; }
    if (L.lastClick && Date.now() - L.lastClick < 400) return;
    L.lastClick = Date.now(); L.tries = (L.tries || 0) + 1;
    target.click();
  }

  /* ---------- Edit Group → Landing channel picker (owner editor form) ---------- */
  function editorPass() {
    var form = document.querySelector('form[data-sml-goe-form]'); if (!form || form.querySelector('.sml-gl-field')) return;
    var B = box(); if (!B) return;
    var btns = [].slice.call(B.querySelectorAll(':scope > .sml-gshell__channel[data-smlgs-channel]')).sort(function (a, b) { return ord(a) - ord(b); });
    if (!btns.length) return;
    var wrap = document.createElement('label'); wrap.className = 'sml-gl-field';
    wrap.innerHTML = '<span>Landing channel</span><select name="sml_landing_channel"><option value="0">First open channel (automatic)</option>' +
      btns.map(function (b) { var nm = (b.querySelector('.sml-gshell__channel-name') || b).textContent.trim(); return '<option value="' + esc(b.getAttribute('data-smlgs-channel')) + '">#' + esc(nm) + '</option>'; }).join('') +
      '</select><small>The channel members open into when they arrive — never the Portal chat.</small>';
    var submit = form.querySelector('button[type="submit"]'); var anchor = submit ? (submit.closest('.sml-goe-actions') || submit.parentElement) : null;
    if (anchor && anchor.parentElement === form) form.insertBefore(wrap, anchor); else form.appendChild(wrap);
    var sel = wrap.querySelector('select'); sel.value = String(L.id || 0);
    if (!form.__smlGl) {
      form.__smlGl = 1;
      form.addEventListener('submit', function () {
        var v = Number(sel.value || 0), g = gid(); if (!g) return;
        var nonce = window.SML_GCAT_NONCE || (window.SMLGroupShell && window.SMLGroupShell.nonce) || (window.SMLChannelBanners && window.SMLChannelBanners.nonce) || '';
        fetch('/wp-json/sml-group-landing/v1/group/' + encodeURIComponent(g), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce }, body: JSON.stringify({ channel_id: v }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok) L.id = Number(j.channel_id || 0); }).catch(function () {});
      }, true);
    }
  }

  function tick() {
    var B = box(); if (!B) return;
    ensureCss(); badgePass(B); foldPass(B); landingPass(B); editorPass();
  }
  function boot() {
    if (!deepLinked()) { document.documentElement.classList.add(GATE); fetchLanding(); }
    tick(); setInterval(tick, 1000);
    /* the first seconds: check every 60ms so the landing channel opens on the shell's first render */
    var fast = setInterval(function () { var B = box(); if (B) landingPass(B); if (L.done || Date.now() - L.t0 > 8000) { clearInterval(fast); release(); } }, 60);
    setTimeout(function () { release(); }, 8000);   /* never keep the conversation hidden longer than this */
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.SMLSidebarPlus = { unread: unread, folds: folds, landing: L, tick: tick, release: release };
})();


/* ---- Group rail = Discord's server column (owner call 2026-09-06): every group the member
   belongs to sits in the left rail, current group first, then the rest, then "+". Icons are the
   shell's own rail tiles (`.sml-gshell__rail-item`); list from sml-group-landing/v1/my-groups.
   The shell rebuilds the rail on its own renders, so the tick re-adds what is missing. ---- */
(function () {
  'use strict';
  if (window.__smlGroupRail) return;
  window.__smlGroupRail = 1;
  var css = '' +
    '.sml-gshell__rail-item.sml-rail-mine{position:relative;overflow:hidden;font:800 12px/1 Inter,system-ui,sans-serif;letter-spacing:.02em}' +
    '.sml-gshell__rail-item.sml-rail-mine img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}' +
    '.sml-gshell__rail-item.sml-rail-mine[data-role="owner"]::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%;background:#38f58a;box-shadow:0 0 0 2px #06100b}';
  function ensureCss() { if (document.getElementById('sml-group-rail-css')) return; var st = document.createElement('style'); st.id = 'sml-group-rail-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slug() { var m = /\/groups\/([^\/?#]+)/.exec(location.pathname); return m ? decodeURIComponent(m[1]) : ''; }
  var R = { groups: null, at: 0, inflight: false };
  function load() {
    if (R.inflight || Date.now() - R.at < 300000) return;
    R.inflight = true;
    var nonce = window.SML_GCAT_NONCE || (window.SMLGroupShell && window.SMLGroupShell.nonce) || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
    fetch('/wp-json/sml-group-landing/v1/my-groups?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', headers: nonce ? { 'X-WP-Nonce': nonce } : {} })   /* logged-in route: the REST nonce is what makes the cookie count */
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { R.groups = (j && j.groups) || []; R.at = Date.now(); R.inflight = false; paint(); })
      .catch(function () { R.inflight = false; R.at = Date.now(); });
  }
  function tile(g) {
    var a = document.createElement('a');
    a.className = 'sml-gshell__rail-item sml-rail-mine';
    a.href = g.url || ('/groups/' + encodeURIComponent(g.slug) + '/');
    a.setAttribute('aria-label', g.name); a.title = g.name;
    a.setAttribute('data-gid', String(g.id)); a.setAttribute('data-role', g.role || 'member');
    a.innerHTML = g.icon_url ? '<img src="' + esc(g.icon_url) + '" alt="" loading="lazy">' : esc(String(g.name || 'G').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 2).toUpperCase() || 'G');
    return a;
  }
  function paint() {
    var rail = document.querySelector('.sml-gshell__rail'); if (!rail || !R.groups) return;
    var here = slug();
    var want = R.groups.filter(function (g) { return g.slug !== here; });
    var have = {}; [].slice.call(rail.querySelectorAll('.sml-rail-mine')).forEach(function (a) { have[a.getAttribute('data-gid')] = a; });
    var plus = [].slice.call(rail.querySelectorAll('.sml-gshell__rail-item')).filter(function (a) { return /create=1/.test(a.getAttribute('href') || '') || (a.textContent || '').trim() === '+'; })[0] || null;
    want.forEach(function (g) {
      var key = String(g.id);
      if (have[key]) { delete have[key]; return; }
      var t = tile(g);
      if (plus) rail.insertBefore(t, plus); else rail.appendChild(t);
    });
    Object.keys(have).forEach(function (k) { have[k].remove(); });   /* left a group: drop its tile */
  }
  function tick() { if (!document.querySelector('.sml-gshell__rail')) return; ensureCss(); load(); paint(); }
  function boot() { tick(); setInterval(tick, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.SMLGroupRail = { state: R, reload: function () { R.at = 0; load(); } };
})();


/* ---- Background switch (owner call 2026-09-07): clicking through channels showed the PREVIOUS
   background until the next one had downloaded, because Chrome keeps painting the old CSS image
   while the new URL loads, and the per-channel fit + banner overlay only caught up on their timers.
   Now every channel's background is preloaded when the group opens, the layer is hidden for the
   instant an image is still loading (no stale picture), and the fit + overlay are applied the moment
   the shell swaps the image, before the first paint. ---- */
(function () {
  'use strict';
  if (window.__smlBgSwitch) return;
  window.__smlBgSwitch = 1;
  var NONCE = (window.wpApiSettings && wpApiSettings.nonce) || (window.SML_NOTIFY && SML_NOTIFY.nonce) || '';
  var loaded = {}, pending = {}, preloadedFor = 0, lastSeen = '', urls = {}, fitsAt = Date.now();
  function css() { if (document.getElementById('sml-bgswitch-css')) return; var st = document.createElement('style'); st.id = 'sml-bgswitch-css'; st.textContent = '.sml-gshell__watermark.sml-bg-pending{opacity:0!important;transition:none!important}'; (document.head || document.documentElement).appendChild(st); }
  function layer() { return document.querySelector('[data-smlgs-watermark]'); }
  function gid() { var c = window.SMLGroupShellContext || {}; if (c.groupId) return Number(String(c.groupId).replace(/D/g, '')); var cfg = window.SMLGroupShell; return cfg && cfg.groupId ? Number(String(cfg.groupId).replace(/D/g, '')) : 0; }
  function urlOf(v) { var m = /url\(["']?(.*?)["']?\)/.exec(String(v || '')); return m ? m[1] : ''; }
  function preload(url, cb) {
    if (!url || loaded[url]) { if (cb) cb(); return; }
    if (pending[url]) { if (cb) pending[url].push(cb); return; }
    pending[url] = cb ? [cb] : [];
    var im = new Image();
    im.onload = im.onerror = function () { loaded[url] = 1; var cbs = pending[url] || []; delete pending[url]; cbs.forEach(function (f) { try { f(); } catch (e) {} }); };
    im.src = url;
  }
  /* warm every channel background of this group once (the fit plugin injects watermark urls into the channel list) */
  function warm() {
    var g = gid(); if (!g || preloadedFor === g) return;
    preloadedFor = g;
    fetch('/wp-json/sml/v1/group/channels?group_id=' + encodeURIComponent(g) + '&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', headers: NONCE ? { 'X-WP-Nonce': NONCE } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = (j && (j.channels || j.items || j)) || [];
        if (!Array.isArray(list)) return;
        list.forEach(function (c) { var u = c && c.watermark && c.watermark.url; if (u) { preload(u); urls[String(c.id)] = u; } });
        var grp = window.SMLGroupShellContext && window.SMLGroupShellContext.group; if (grp && grp.watermark && grp.watermark.url) preload(grp.watermark.url);
      }).catch(function () { preloadedFor = 0; });
  }
  function settle() {
    if (window.SMLBgFit && SMLBgFit.reload && Date.now() - fitsAt > 30000) { fitsAt = Date.now(); try { SMLBgFit.reload(); } catch (e) {} }
    try { if (window.SMLBgFit && SMLBgFit.apply) SMLBgFit.apply(); } catch (e) {}
    try { if (window.SMLTransparentLayers && SMLTransparentLayers.tick) SMLTransparentLayers.tick(); } catch (e) {}
  }
  function onChange() {
    var L = layer(); if (!L) return;
    var url = urlOf(L.style.backgroundImage);
    if (url === lastSeen) return;
    lastSeen = url;
    if (url && !loaded[url]) {
      L.classList.add('sml-bg-pending');
      preload(url, function () { if (urlOf(L.style.backgroundImage) === url) { L.classList.remove('sml-bg-pending'); settle(); } });
    } else { L.classList.remove('sml-bg-pending'); }
    settle();
  }
  var watching = null;
  function watch() {
    var L = layer(); if (!L || L === watching) return;
    watching = L;
    new MutationObserver(onChange).observe(L, { attributes: true, attributeFilter: ['style'] });
    var u = urlOf(L.style.backgroundImage); if (u) { loaded[u] = 1; lastSeen = u; }
  }
  function tick() { css(); watch(); warm(); }
  function boot() { tick(); setInterval(tick, 2000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.SMLBgSwitch = { loaded: loaded, urls: urls, warm: function () { preloadedFor = 0; warm(); } };
})();


/* ---- Owner call 2026-09-09: the channel-banner height drag must ALWAYS respond.
   The banner plugin (sml-channel-banners) binds its pointerdown once, on the handle it creates; the group shell then
   rebuilds the banner head and the plugin re-uses the rebuilt `[data-sml-cbanner-resize]` node — which has no listener.
   Result: a visible strip that ignores the grab (verified live: dispatching pointerdown on it set no is-dragging).
   This module owns the drag from a capture-phase document listener (survives every rebuild), applies the height live
   and saves through the plugin's own route + payload (group_id, channel_id, resize=1, height), keeping its state in step. */
(function () {
  'use strict';
  if (window.__smlBannerDragV2) return;
  window.__smlBannerDragV2 = 1;
  function cfg() { return window.SMLChannelBanners || {}; }
  function activeCid() { var a = document.querySelector('.sml-gshell__channel[data-smlgs-channel].is-active'); return a ? (parseInt(a.getAttribute('data-smlgs-channel'), 10) || 0) : 0; }
  function groupId() { try { var root = document.getElementById('sml-group-shell'); return parseInt(JSON.parse(root.getAttribute('data-config') || '{}').groupId, 10) || 0; } catch (e) { return 0; } }
  function clamp(v) { return Math.max(1, Math.min(400, parseInt(v, 10) || 152)); }
  function apply(head, h) { head.classList.add('sml-cbanner-has-height'); head.style.setProperty('--sml-cbanner-height', h + 'px'); }
  function entryOf(cid) { var b = cfg().banners; return (b && b[String(cid)]) || {}; }
  function remember(cid, h) { var c = cfg(); if (!c.banners) c.banners = {}; c.banners[String(cid)] = Object.assign({}, c.banners[String(cid)] || {}, { height: h }); }
  function save(cid, gid, h, prev, handle, head) {
    var c = cfg(); if (!c.api) return;
    var fd = new FormData(); fd.append('group_id', String(gid)); fd.append('channel_id', String(cid)); fd.append('resize', '1'); fd.append('height', String(h));
    remember(cid, h);
    handle.classList.add('is-saving');
    var path = c.saveApi || 'visual'; var url = /^https?:\/\//i.test(path) ? path : c.api + path;   /* same rule as the plugin's request(): saveApi is absolute */
    fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': c.nonce || '' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || 'The channel banner height could not be saved.'); if (j.banner && c.banners) c.banners[String(cid)] = j.banner; handle.classList.remove('is-error'); handle.title = 'Channel banner height saved at ' + h + 'px'; }); })
      .catch(function (err) { remember(cid, prev); apply(head, prev); handle.classList.add('is-error'); handle.title = err.message || 'The channel banner height could not be saved.'; })
      .then(function () { handle.classList.remove('is-saving'); });
  }
  document.addEventListener('pointerdown', function (e) {
    var handle = e.target && e.target.closest ? e.target.closest('.sml-cbanner-resize') : null;
    if (!handle) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (handle.classList.contains('is-saving')) return;
    var cid = activeCid(), gid = groupId(); if (!cid || !gid) return;
    var head = document.querySelector('.sml-gshell__main-head'); if (!head) return;
    e.preventDefault(); e.stopPropagation();
    var entry = entryOf(cid);
    var start = clamp(entry.height != null ? entry.height : head.getBoundingClientRect().height), y0 = e.clientY, next = start, pid = e.pointerId;
    var out = handle.querySelector('output');
    handle.classList.add('is-dragging'); document.body.classList.add('sml-cbanner-resizing');
    try { handle.setPointerCapture(pid); } catch (err) {}
    function move(ev) { if (ev.pointerId !== pid) return; next = clamp(start + ev.clientY - y0); apply(head, next); if (out) out.textContent = next + 'px'; handle.setAttribute('aria-valuenow', String(next)); ev.preventDefault(); }
    function cleanup() {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', cancel, true);
      handle.classList.remove('is-dragging'); document.body.classList.remove('sml-cbanner-resizing');
      try { handle.releasePointerCapture(pid); } catch (err) {}
    }
    function end(ev) { if (ev.pointerId !== pid) return; cleanup(); if (next !== start) save(cid, gid, next, start, handle, head); }
    function cancel(ev) { if (ev && ev.pointerId !== pid) return; cleanup(); apply(head, start); if (out) out.textContent = start + 'px'; }
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', cancel, true);
  }, true);
})();

/* ===== Group alerts → LOOP-KICK + group Chirp on the group page (owner call 2026-09-10; WordPress mu-plugin sml-group-kick) =====
   Members: a 🔔 on every channel button (alerts for that channel land in their LOOP-KICK), an "All alerts" switch,
   a 🔊 Chirp switch (hear this group's chirps anywhere on the site), and — when the owner gave them the mic —
   a hold-to-talk 🎙 button. Everyone in the group who is on the page hears a chirp within ~4s (polled). */
(function () {
  'use strict';
  if (!document.querySelector('#sml-group-shell, .sml-gshell')) return;
  var NONCE = window.SML_GCAT_NONCE || (window.SMLGroupShell && window.SMLGroupShell.nonce) || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var API = '/wp-json/sml-group-kick/v1/';
  function ctx() { return window.SMLGroupShellContext || {}; }
  function gid() {
    var c = ctx(); if (c.groupId) return String(c.groupId).replace(/\D/g, '');
    var cfg = window.SMLGroupShell; if (cfg && cfg.groupId) return String(cfg.groupId).replace(/\D/g, '');
    try { var root = document.getElementById('sml-group-shell'); var conf = root && root.getAttribute('data-config') ? JSON.parse(root.getAttribute('data-config')) : null; if (conf && conf.groupId) return String(conf.groupId).replace(/\D/g, ''); } catch (e) {}
    return '';
  }
  function cid() {
    var c = ctx(); if (c && c.mode) return c.mode === 'channel' && c.channelId ? String(c.channelId).replace(/\D/g, '') : '';
    var act = document.querySelector('.sml-gshell button.sml-gshell__channel.is-active[data-smlgs-channel]');
    return act ? String(act.getAttribute('data-smlgs-channel') || '').replace(/\D/g, '') : '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hdr(json) { var h = {}; if (NONCE) h['X-WP-Nonce'] = NONCE; if (json) h['Content-Type'] = 'application/json'; return h; }
  function parse(r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.message) || ('HTTP ' + r.status)); e.code = j && j.code; throw e; } return j; }); }
  function freshNonce() {
    return fetch('/wp-admin/admin-ajax.php?action=rest-nonce', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { t = String(t || '').trim(); if (/^[a-f0-9]{8,12}$/i.test(t)) NONCE = t; return NONCE; });
  }
  function get(path, retried) {
    return fetch(API + path, { credentials: 'same-origin', headers: hdr(false), cache: 'no-store' }).then(parse).catch(function (e) {
      if (!retried && /nonce|401|403/.test(String(e.message) + ' ' + String(e.code))) return freshNonce().then(function () { return get(path, true); });
      throw e;
    });
  }
  function post(path, body, retried) {
    return fetch(API + path, { method: 'POST', credentials: 'same-origin', headers: hdr(true), body: JSON.stringify(body) }).then(parse).catch(function (e) {
      if (!retried && /nonce|401/.test(String(e.message) + ' ' + String(e.code))) return freshNonce().then(function () { return post(path, body, true); });
      throw e;
    });
  }

  var G = null;          /* my membership entry for this group (null = not a member / not loaded) */
  var MOBILE = document.documentElement.classList.contains('sml-mobile') || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
  /* Phones refuse audio that was not started by a touch. One shared element is "blessed" by the first touch on the page
     (a silent clip) and reused for every chirp afterwards. */
  var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  var player = null, unlocked = false;
  function getPlayer() { if (!player) { player = new Audio(); player.preload = 'auto'; player.setAttribute('playsinline', ''); } return player; }
  function unlock() {
    if (unlocked) return; unlocked = true;
    try { var a = getPlayer(); a.src = SILENT; a.play().catch(function () { unlocked = false; }); } catch (e) { unlocked = false; }
  }
  document.addEventListener('touchstart', unlock, { passive: true, capture: true });
  document.addEventListener('pointerdown', unlock, { passive: true, capture: true });
  var loaded = false, member = true;
  var last = 0, queue = [], audio = null, playing = null;
  var rec = null, chunks = [], recStart = 0, recTimer = null, busy = '';

  var style = document.createElement('style');
  style.id = 'sml-gk-css';
  style.textContent = ''
    + '#sml-gk-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px 10px;border-bottom:1px solid rgba(255,255,255,.06)}'
    + '#sml-gk-bar .sml-gk-t{width:100%;font:700 9.5px/1.2 Archivo,Inter,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#7e8a96}'
    + '.sml-gk-btn{border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:5px 9px;font:700 10px/1 Inter,Archivo,sans-serif;background:#0e1721;color:#b9c6d2;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;user-select:none}'
    + '.sml-gk-btn.on{background:#00ff88;border-color:#00ff88;color:#06120c}'
    + '.sml-gk-btn.rec{background:#ff3b5c;border-color:#ff3b5c;color:#fff}'
    + '.sml-gk-btn.mic{background:linear-gradient(140deg,#3d8bfd,#1f5fd0);border-color:transparent;color:#fff;touch-action:none}'
    + '.sml-gk-btn[disabled]{opacity:.55;cursor:default}'
    + '#sml-gk-status{width:100%;font:500 10px/1.35 Inter,sans-serif;color:#8b98a5;min-height:0}'
    + '#sml-gk-status.err{color:#ff7a90}'
    + '.sml-gk-bell{margin-left:auto;padding:2px 4px;border-radius:6px;font-size:11px;line-height:1;opacity:.4;cursor:pointer;flex:none}'
    + '.sml-gk-bell.on{opacity:1;filter:drop-shadow(0 0 4px rgba(0,255,136,.6))}'
    + '.sml-gk-bell:hover{opacity:1;background:rgba(255,255,255,.08)}'
    + '#sml-gk-perms{width:100%;display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:6px 0 2px;font:600 10px/1 Inter,sans-serif;color:#8b98a5}'
    + '#sml-gk-perms .sml-gk-btn{padding:4px 8px;font-size:9.5px}'
    + '#sml-gk-toast{position:fixed;right:16px;bottom:16px;z-index:2147483600;display:flex;align-items:center;gap:9px;max-width:320px;padding:10px 12px;border-radius:13px;background:#0b1f18;color:#e8edf2;box-shadow:0 0 0 1px rgba(0,255,136,.35),0 18px 40px -12px rgba(0,0,0,.9);font:600 12px/1.3 Inter,Archivo,sans-serif;cursor:default}'
    + '#sml-gk-toast.tap{cursor:pointer}'
    + '#sml-gk-toast img{width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none}'
    + '#sml-gk-toast b{color:#00ff88}'
    /* phones (2026-09-10): the bar scrolls away with the page, so a floating pill keeps the mic / listen switch within thumb reach */
    + '.sml-gk-btn{-webkit-touch-callout:none}'
    + '#sml-gk-fab{position:fixed;left:12px;right:12px;bottom:14px;z-index:2147483500;display:flex;gap:8px;align-items:center;padding:8px;border-radius:999px;background:rgba(8,13,23,.96);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 16px 36px -12px rgba(0,0,0,.9)}'
    + '#sml-gk-fab .sml-gk-btn{height:40px;padding:0 14px;font-size:12px;display:flex;align-items:center;justify-content:center}'
    + '#sml-gk-fab .sml-gk-btn.mic{flex:1}'
    + '#sml-gk-fab .sml-gk-x{margin-left:auto;width:32px;height:32px;border-radius:50%;border:0;background:#131c26;color:#8b98a5;font:700 14px/1 Inter,sans-serif;cursor:pointer}'
    + 'html.sml-mobile #sml-gk-toast{left:12px;right:12px;bottom:74px;max-width:none}';
  document.head.appendChild(style);

  function status(text, err) { var s = document.getElementById('sml-gk-status'); if (!s) return; s.textContent = text || ''; s.className = err ? 'err' : ''; if (text && !err) { clearTimeout(status._t); status._t = setTimeout(function () { if (s.textContent === text) s.textContent = ''; }, 6000); } }

  var loadTries = 0;
  function load() {
    var g = gid();
    if (!g) { if (loadTries++ < 20) setTimeout(load, 1500); return Promise.resolve(); }
    return get('me').then(function (j) {
      loaded = true;
      G = null;
      (j.groups || []).forEach(function (x) { if (String(x.id) === String(g)) G = x; });
      member = !!G;
      if (!last) last = Number(j.lastChirp) || 0;
      paint();
    }).catch(function () {
      /* the group page fires a burst of requests at boot and the edge answers 429 to some of them — try again, later */
      if (loadTries++ < 8) setTimeout(load, 2000 * loadTries); else { loaded = true; member = false; }
    });
  }

  function paint() {
    ensureBar(); decorate();
  }

  function ensureFab() {
    if (!MOBILE || !G) return;
    var fab = document.getElementById('sml-gk-fab');
    if (sessionStorage.getItem('sml_gk_fab_off') === '1') { if (fab) fab.remove(); return; }
    if (!fab) {
      fab = document.createElement('div'); fab.id = 'sml-gk-fab';
      document.body.appendChild(fab);
      fab.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('.sml-gk-x')) { try { sessionStorage.setItem('sml_gk_fab_off', '1'); } catch (e) {} fab.remove(); return; } onBarClick(ev); });
      fab.addEventListener('pointerdown', function (ev) { var b = ev.target.closest && ev.target.closest('[data-gk="rec"]'); if (!b || b.disabled) return; ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch (e) {} recStartNow(); });
      fab.addEventListener('pointerup', function (ev) { if (ev.target.closest && ev.target.closest('[data-gk="rec"]')) { ev.preventDefault(); recStop(); } });
      fab.addEventListener('pointercancel', function () { recStop(); });
      fab.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    }
    var html = (G.canChirp ? '<button type="button" class="sml-gk-btn ' + (busy === 'rec' ? 'rec' : 'mic') + '" data-gk="rec"' + (busy === 'send' ? ' disabled' : '') + '>' + (busy === 'rec' ? '● Recording… release to send' : busy === 'send' ? 'Sending…' : '🎙 Hold to Chirp the group') + '</button>' : '<span class="sml-gk-btn" style="flex:1;cursor:default">Loop Kick · alerts &amp; chirp</span>')
      + '<button type="button" class="sml-gk-btn' + (G.chirp ? ' on' : '') + '" data-gk="chirp" title="Hear this group\'s chirps anywhere">🔊</button>'
      + '<button type="button" class="sml-gk-btn' + (G.alertsAll ? ' on' : '') + '" data-gk="all" title="Every channel alerts your Loop Kick">🔔</button>'
      + '<button type="button" class="sml-gk-x" aria-label="Hide">×</button>';
    if (fab.getAttribute('data-html') !== html) { fab.innerHTML = html; fab.setAttribute('data-html', html); }
  }
  function ensureBar() {
    ensureFab();
    var head = document.querySelector('.sml-gshell__side-head'); if (!head || !G) return;
    var bar = document.getElementById('sml-gk-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'sml-gk-bar';
      head.insertAdjacentElement('afterend', bar);
      bar.addEventListener('click', onBarClick);
      bar.addEventListener('pointerdown', function (ev) { var b = ev.target.closest && ev.target.closest('[data-gk="rec"]'); if (!b || b.disabled) return; ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch (e) {} recStartNow(); });
      bar.addEventListener('pointerup', function (ev) { if (ev.target.closest && ev.target.closest('[data-gk="rec"]')) { ev.preventDefault(); recStop(); } });
      bar.addEventListener('pointercancel', function () { recStop(); });
      bar.addEventListener('contextmenu', function (ev) { if (ev.target.closest && ev.target.closest('[data-gk="rec"]')) ev.preventDefault(); });
    }
    var html = '<span class="sml-gk-t">Loop Kick · alerts &amp; chirp</span>'
      + '<button type="button" class="sml-gk-btn' + (G.alertsAll ? ' on' : '') + '" data-gk="all" title="Every channel in this group alerts your LOOP-KICK">' + (G.alertsAll ? '🔔 All alerts on' : '🔔 All alerts') + '</button>'
      + '<button type="button" class="sml-gk-btn' + (G.chirp ? ' on' : '') + '" data-gk="chirp" title="Hear this group\'s chirps anywhere on the site">' + (G.chirp ? '🔊 Chirp on' : '🔊 Chirp') + '</button>'
      + (G.canChirp ? '<button type="button" class="sml-gk-btn ' + (busy === 'rec' ? 'rec' : 'mic') + '" data-gk="rec"' + (busy === 'send' ? ' disabled' : '') + ' title="Hold to talk — everyone in the group hears it">' + (busy === 'rec' ? '● Recording… release to send' : busy === 'send' ? 'Sending…' : '🎙 Hold to Chirp') + '</button>' : '')
      + (G.canManage ? '<button type="button" class="sml-gk-btn" data-gk="perms" title="Choose who can Chirp this group">⚙ Who can Chirp</button>' : '')
      + '<div id="sml-gk-status"></div>'
      + (G.canManage && bar.getAttribute('data-perms') === '1' ? permsHtml() : '');
    if (bar.getAttribute('data-html') !== html) { var st = document.getElementById('sml-gk-status'); var keep = st ? st.textContent : ''; bar.innerHTML = html; bar.setAttribute('data-html', html); if (keep) { var s2 = document.getElementById('sml-gk-status'); if (s2) s2.textContent = keep; } }
  }
  function permsHtml() {
    var rule = G.chirpRule || { mode: 'owner', users: [] };
    var modes = [['owner', 'Only me'], ['staff', 'Admins & analysts'], ['members', 'Everyone'], ['list', 'Pick members']];
    var h = '<div id="sml-gk-perms"><span>Who can Chirp:</span>' + modes.map(function (m) { return '<button type="button" class="sml-gk-btn' + (rule.mode === m[0] ? ' on' : '') + '" data-gk-mode="' + m[0] + '">' + m[1] + '</button>'; }).join('');
    if (rule.mode === 'list') {
      h += (G.members || []).map(function (m) { var on = rule.users.indexOf(m.id) >= 0; return '<button type="button" class="sml-gk-btn' + (on ? ' on' : '') + '" data-gk-user="' + m.id + '">' + (on ? '✓ ' : '') + esc(m.name) + '</button>'; }).join('');
      if (!G.members) h += '<span>loading members…</span>'; else if (!G.members.length) h += '<span>no other members yet</span>';
    }
    return h + '</div>';
  }
  function onBarClick(ev) {
    var t = ev.target.closest && ev.target.closest('[data-gk],[data-gk-mode],[data-gk-user]'); if (!t || !G) return;
    var bar = document.getElementById('sml-gk-bar');
    if (t.getAttribute('data-gk') === 'all') return toggle(0, 'alerts', !G.alertsAll);
    if (t.getAttribute('data-gk') === 'chirp') return toggle(0, 'chirp', !G.chirp);
    if (t.getAttribute('data-gk') === 'perms') { bar.setAttribute('data-perms', bar.getAttribute('data-perms') === '1' ? '0' : '1'); if (!G.members) refreshMembers(); return paint(); }
    if (t.hasAttribute('data-gk-mode')) return savePerms(t.getAttribute('data-gk-mode'), (G.chirpRule || {}).users || []);
    if (t.hasAttribute('data-gk-user')) { var id = Number(t.getAttribute('data-gk-user')); var users = ((G.chirpRule || {}).users || []).slice(); var i = users.indexOf(id); if (i >= 0) users.splice(i, 1); else users.push(id); return savePerms('list', users); }
  }
  function refreshMembers() { get('me?members=1').then(function (j) { (j.groups || []).forEach(function (x) { if (G && x.id === G.id) { G.members = x.members || []; } }); paint(); }).catch(function () {}); }
  function toggle(channelId, field, on) {
    var body = { group_id: Number(G.id), channel_id: Number(channelId) }; body[field] = on;
    post('sub', body).then(function (j) { var members = G.members; G = j.group; G.members = members; paint();
      if (field === 'chirp') status(on ? '🔊 You will hear this group\'s chirps anywhere on the site (Loop Kick open or not on this page).' : 'Chirp off for this group.');
      else if (!channelId) status(on ? '🔔 Every channel now alerts your Loop Kick in real time.' : 'Group alerts off.');
      else status(on ? '🔔 This channel now alerts your Loop Kick.' : 'Channel alerts off.');
    }).catch(function (e) { status(e.message || 'Could not save that', true); });
  }
  function savePerms(mode, users) {
    post('chirp-perms', { group_id: Number(G.id), mode: mode, users: users }).then(function (j) { G.chirpRule = j.rule; if (mode === 'list' && !G.members) refreshMembers(); paint(); status('Saved who can Chirp.'); }).catch(function (e) { status(e.message || 'Could not save', true); });
  }

  /* 🔔 on every channel button — the shell rebuilds the list every few seconds, so this re-decorates on a timer */
  function decorate() {
    if (!G) return;
    var byId = {}; (G.channels || []).forEach(function (c) { byId[String(c.id)] = c; });
    var btns = document.querySelectorAll('button.sml-gshell__channel[data-smlgs-channel]');
    Array.prototype.forEach.call(btns, function (b) {
      var id = String(b.getAttribute('data-smlgs-channel') || '').replace(/\D/g, ''); var c = byId[id]; if (!c) return;
      var bell = b.querySelector('.sml-gk-bell');
      if (!bell) { bell = document.createElement('span'); bell.className = 'sml-gk-bell'; bell.setAttribute('role', 'button'); bell.setAttribute('data-gk-cid', id); b.appendChild(bell); }
      var on = !!c.alerts; var want = on ? '🔔' : '🔕';
      if (bell.textContent !== want) bell.textContent = want;
      bell.classList.toggle('on', on);
      bell.title = G.alertsAll ? 'All channels alert your Loop Kick' : (on ? 'Alerting your Loop Kick — tap to turn off' : 'Tap: alert your Loop Kick when this channel posts');
    });
  }
  document.addEventListener('click', function (ev) {
    var bell = ev.target.closest && ev.target.closest('.sml-gk-bell'); if (!bell || !G) return;
    ev.preventDefault(); ev.stopPropagation();
    var id = Number(bell.getAttribute('data-gk-cid')); var c = null; (G.channels || []).forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    if (G.alertsAll) { status('All channels are on for this group — switch "All alerts" off to pick channels.'); return; }
    toggle(id, 'alerts', !c.own);
  }, true);

  /* hold-to-talk */
  function recStartNow() {
    if (rec || !G || !G.canChirp) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { status('This browser cannot record audio.', true); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
      var r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      r.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      r.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); recDone(r.mimeType || mime || 'audio/webm'); };
      r.start(250); rec = r; recStart = Date.now(); busy = 'rec'; paint();
      recTimer = setInterval(function () { var sec = Math.floor((Date.now() - recStart) / 1000); status('● ' + sec + 's — release to send'); if (sec >= 30) recStop(); }, 250);
    }).catch(function () { status('Microphone blocked — allow the mic to Chirp.', true); });
  }
  function recStop() { var r = rec; if (!r) return; rec = null; if (recTimer) { clearInterval(recTimer); recTimer = null; } try { if (r.state !== 'inactive') r.stop(); } catch (e) {} }
  function recDone(mime) {
    var sec = Math.max(1, Math.round((Date.now() - recStart) / 1000));
    var blob = new Blob(chunks, { type: mime.split(';')[0] }); chunks = [];
    if (blob.size < 400) { busy = ''; paint(); status('Hold the button while you talk.', true); return; }
    busy = 'send'; paint(); status('Sending your chirp…');
    var ext = /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
    var fd = new FormData(); fd.append('file', new File([blob], 'chirp-' + Date.now() + '.' + ext, { type: blob.type })); fd.append('purpose', 'voice');
    fetch('/wp-json/sml-loop/v1/upload', { method: 'POST', credentials: 'same-origin', headers: hdr(false), body: fd }).then(parse)
      .then(function (up) { return post('chirp', { group_id: Number(G.id), channel_id: Number(cid() || 0), attachment_id: up.id, duration: sec }); })
      .then(function (j) { busy = ''; paint(); if (j.chirp) last = Math.max(last, Number(j.chirp.id) || 0); status('🔊 Chirped the group · ' + sec + 's · everyone on this page hears it now' + (j.listeners ? ', ' + j.listeners + ' listening elsewhere' : '') + '.'); })
      .catch(function (e) { busy = ''; paint(); status(e.message || 'That chirp did not send', true); });
  }

  /* listening on the page: every member on the page hears a chirp within ~4s */
  function poll() {
    var g = gid(); if (!g || !member || !loaded) return;
    get('chirps?group_id=' + encodeURIComponent(g) + '&since=' + last).then(function (j) {
      var l = Number(j.last) || 0;
      last = Math.max(last, l);   /* with no cursor the server only sends the last 45 s, so the first chirp ever still plays */
      if (j.chirps && j.chirps.length) { queue = queue.concat(j.chirps); playNext(); }
    }).catch(function () {});
  }
  function toast(c, needTap) {
    var t = document.getElementById('sml-gk-toast');
    if (!c) { if (t) t.remove(); return; }
    if (!t) { t = document.createElement('div'); t.id = 'sml-gk-toast'; document.body.appendChild(t); t.addEventListener('click', function () { if (audio) audio.play().then(function () { t.classList.remove('tap'); t.querySelector('span').textContent = ''; }).catch(function () {}); }); }
    t.className = needTap ? 'tap' : '';
    t.innerHTML = (c.by && c.by.avatar ? '<img src="' + esc(c.by.avatar) + '" alt="" referrerpolicy="no-referrer">' : '') + '<div><b>🔊 ' + esc(c.by ? c.by.name : 'A member') + '</b> chirped the group' + (c.duration ? ' · ' + c.duration + 's' : '') + '<span style="display:block;font-weight:500;color:#9fb0bf">' + (needTap ? 'Tap to hear it' : '') + '</span></div>';
  }
  function playNext() {
    if (playing || !queue.length) return;
    var c = queue.shift(); playing = c;
    var el = getPlayer(); audio = el;
    var done = function () { el.onended = null; el.onerror = null; audio = null; playing = null; toast(null); playNext(); };
    el.onended = done; el.onerror = done;
    el.src = c.url;
    toast(c, false);
    el.play().catch(function () { toast(c, true); });
  }

  /* ?channel=<id> deep link from a LOOP-KICK alert: open that channel once the shell is up */
  (function deepLink() {
    var m = /[?&]channel=(\d+)/.exec(location.search); if (!m) return;
    var tries = 0, clicks = 0; var t = setInterval(function () {
      tries++; var c = ctx();
      if (c.mode === 'channel' && String(c.channelId) === m[1]) { clearInterval(t); return; }
      var b = document.querySelector('button.sml-gshell__channel[data-smlgs-channel="' + m[1] + '"]');
      /* the shell binds its click handling after it announces the first context — click only once it has, and re-try until the context agrees */
      if (b && c.mode && clicks < 4 && tries % 3 === 0) { clicks++; b.click(); }
      if (tries > 60) clearInterval(t);
    }, 500);
  })();

  load().then(function () { setInterval(function () { if (G) paint(); }, 2500); setInterval(poll, 4000); });
  document.addEventListener('sml:group-context-change', function () { setTimeout(paint, 50); });
})();
