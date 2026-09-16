/*!
 * SML Feed Signals — the member-side half of plugin sml-feed-signals.
 *
 *  - "Not interested" / "Hide posts from this account" on other members' cards,
 *    with Undo. Filtering asks the server which on-screen refs to hide, because
 *    article cards carry no author in the DOM — only the server can match an
 *    author hide against them.
 *  - Impressions: a card counts once per page view, after it has been at least
 *    half visible for one second. Batched; flushed every 10s and on page hide.
 *  - A dismissible "Personalize your feed" prompt that opens the 10-question
 *    onboarding questionnaire.
 *  - The corporate slot: one server decision per page view (GET /slot, decided
 *    from these same signals), rendered as a clearly labelled "Promoted" card
 *    at feed position 4. No decision means no card — never a filler.
 *
 * Loaded by home-feed.js from the same commit-pinned CDN path. Signed-in only.
 * Every failure is silent and leaves the feed exactly as it was. All member
 * text goes through textContent — never innerHTML.
 * Kill switch: ?smlfs=0 or localStorage sml_fs_off=1.
 */
(function () {
  'use strict';
  if (window.__smlFeedSignalsLoaded) return;
  window.__smlFeedSignalsLoaded = true;

  try { if (/[?&]smlfs=0\b/.test(location.search) || localStorage.getItem('sml_fs_off') === '1') return; } catch (e) { /* storage blocked: keep going */ }
  var ME = window.SML_ME && window.SML_ME.id ? String(window.SML_ME.id) : '';
  if (!ME) return;

  var API = '/wp-json/sml-feed/v1';
  var CARD = 'article.oh-post[data-hfe-item]';

  function nonce() {
    return (window.SMLHomeOwnerControls && window.SMLHomeOwnerControls.nonce)
      || (window.wpApiSettings && window.wpApiSettings.nonce)
      || (window.SMLHomeFeedEngagement && window.SMLHomeFeedEngagement.nonce) || '';
  }

  function api(method, path, body, opts) {
    var n = nonce();
    if (!n) return Promise.reject(new Error('no nonce'));
    var init = {
      method: method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-WP-Nonce': n, Accept: 'application/json' },
      keepalive: !!(opts && opts.keepalive)
    };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error((j && j.message) || ('HTTP ' + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function host() {
    return document.getElementById('sml-optimized-home') || document.body;
  }

  /* ------------------------------------------------------------------ styles */

  function injectStyles() {
    if (document.getElementById('sml-fs-css')) return;
    var css =
      '[data-sml-fs-hidden]{display:none!important;}' +
      '.sml-fs-note{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;padding:12px 16px;border-radius:14px;' +
        'border:1px dashed rgba(255,255,255,.16);background:rgba(10,16,24,.6);color:#93A4B8;font:500 13px/1.4 Inter,system-ui,sans-serif;}' +
      '.sml-fs-note button{border:0;background:transparent;color:#38F58A;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;padding:4px 6px;border-radius:6px;}' +
      '.sml-fs-note button:focus-visible{outline:2px solid #38F58A;outline-offset:2px;}' +
      '.sml-kmenu .sml-fs-mi{color:#E6EDF5;}' +
      '.sml-fs-prompt{position:relative;margin:0 0 14px;padding:18px 18px 16px;border-radius:16px;border:1px solid rgba(56,245,138,.28);' +
        'background:linear-gradient(135deg,rgba(56,245,138,.10),rgba(10,16,24,.9) 60%);color:#E6EDF5;font:14px/1.45 Inter,system-ui,sans-serif;}' +
      '.sml-fs-prompt h3{margin:0 0 4px;font:700 16px/1.25 Archivo,Inter,system-ui,sans-serif;color:#fff;text-wrap:balance;}' +
      '.sml-fs-prompt p{margin:0 0 12px;color:#B7C3CF;max-width:60ch;}' +
      '.sml-fs-row{display:flex;gap:10px;flex-wrap:wrap;}' +
      '.sml-fs-btn{border-radius:10px;padding:9px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:transparent;color:#E6EDF5;}' +
      '.sml-fs-btn.primary{background:#38F58A;border-color:#38F58A;color:#04130A;}' +
      '.sml-fs-btn:focus-visible{outline:2px solid #fff;outline-offset:2px;}' +
      '.sml-fs-btn[disabled]{opacity:.55;cursor:wait;}' +
      '.sml-fs-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(3,6,10,.72);display:flex;align-items:center;justify-content:center;padding:16px;}' +
      '.sml-fs-dialog{width:min(640px,100%);max-height:min(88vh,900px);overflow:auto;border-radius:18px;background:#0B1017;border:1px solid rgba(255,255,255,.12);' +
        'box-shadow:0 30px 80px -20px rgba(0,0,0,.9);color:#E6EDF5;font:14px/1.45 Inter,system-ui,sans-serif;}' +
      '.sml-fs-dialog header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:#0B1017;border-bottom:1px solid rgba(255,255,255,.08);}' +
      '.sml-fs-dialog header h2{margin:0;font:700 17px Archivo,Inter,system-ui,sans-serif;}' +
      '.sml-fs-dialog .close{border:0;background:transparent;color:#93A4B8;font:700 20px/1 Inter,system-ui,sans-serif;cursor:pointer;padding:4px 8px;border-radius:8px;}' +
      '.sml-fs-dialog form{padding:6px 20px 20px;}' +
      '.sml-fs-q{margin:16px 0 0;padding:0;border:0;}' +
      '.sml-fs-q legend{margin:0 0 8px;font:600 14px Inter,system-ui,sans-serif;color:#fff;}' +
      '.sml-fs-q .opt{display:inline-flex;margin:0 8px 8px 0;}' +
      '.sml-fs-q .opt input{position:absolute;opacity:0;pointer-events:none;}' +
      '.sml-fs-q .opt span{display:inline-block;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);color:#B7C3CF;cursor:pointer;font:600 13px Inter,system-ui,sans-serif;}' +
      '.sml-fs-q .opt input:checked + span{background:rgba(56,245,138,.14);border-color:#38F58A;color:#fff;}' +
      '.sml-fs-q .opt input:focus-visible + span{outline:2px solid #38F58A;outline-offset:2px;}' +
      '.sml-fs-q input[type=text]{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:#070B10;color:#fff;font:14px Inter,system-ui,sans-serif;}' +
      '.sml-fs-q .hint{display:block;margin-top:6px;color:#7B8A9B;font-size:12px;}' +
      '.sml-fs-q.missing legend{color:#FFB547;}' +
      '.sml-fs-q.missing legend::after{content:" — required";font-weight:500;}' +
      '.sml-fs-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:22px;}' +
      '.sml-fs-status{color:#93A4B8;font-size:13px;min-height:1.2em;}' +
      '[data-sml-fs-dup]{display:none!important;}' +
      '.sml-fs-slot .sml-fs-slot-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;}' +
      '.sml-fs-slot .sml-fs-slot-av{width:34px;height:34px;border-radius:50%;object-fit:cover;flex:0 0 auto;}' +
      '.sml-fs-slot .sml-fs-slot-name{color:#E6EDF5;font:700 14px Inter,system-ui,sans-serif;text-decoration:none;}' +
      '.sml-fs-slot .sml-fs-slot-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:6px;background:#1D4ED8;color:#fff;font:700 11px/1.5 Inter,system-ui,sans-serif;letter-spacing:.02em;}' +
      '.sml-fs-slot .sml-fs-slot-disclosure{margin-left:auto;color:#93A4B8;font:600 11px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;}' +
      '.sml-fs-slot h2{margin:0 0 6px;font:700 17px/1.3 Archivo,Inter,system-ui,sans-serif;text-wrap:balance;}' +
      '.sml-fs-slot h2 a{color:#fff;text-decoration:none;}' +
      '.sml-fs-slot h2 a:hover,.sml-fs-slot h2 a:focus-visible{text-decoration:underline;}' +
      '.sml-fs-slot p{margin:0 0 10px;color:#B7C3CF;font:14px/1.5 Inter,system-ui,sans-serif;}' +
      '.sml-fs-slot .sml-fs-slot-img{display:block;width:100%;max-height:320px;object-fit:cover;border-radius:12px;margin:4px 0 10px;}' +
      '@media (prefers-reduced-motion: no-preference){.sml-fs-prompt,.sml-fs-note{animation:smlFsIn .25s ease-out;}}' +
      '@keyframes smlFsIn{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}';
    var s = el('style');
    s.id = 'sml-fs-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------- hide + filter */

  var checkedRefs = {};       // ref -> true once asked
  var serverHidden = {};      // ref -> true while the server says hide it

  /* The server answer takes ~2s on this host, long enough for hidden posts to
     flash on every page load. The last known hidden refs are cached per member
     and applied immediately; the server's answer still wins moments later.
     Stale entries only ever hide a post the member already chose to hide. */
  var CACHE_KEY = 'sml_fs_hidden_' + ME;
  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && Array.isArray(c.refs) && Date.now() - c.at < 14 * 86400000) c.refs.forEach(function (r) { serverHidden[r] = true; });
    } catch (e) { /* no storage: first answer comes from the server */ }
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), refs: Object.keys(serverHidden).slice(-400) })); } catch (e) { /* ignore */ }
  }

  function cardsOnScreen() { return Array.prototype.slice.call(host().querySelectorAll(CARD)); }
  function refOf(card) { return card.getAttribute('data-hfe-item') || ''; }

  function applyHidden(hiddenList, askedRefs) {
    var hidden = {};
    (hiddenList || []).forEach(function (r) { hidden[r] = true; });
    askedRefs.forEach(function (r) { if (hidden[r]) serverHidden[r] = true; else delete serverHidden[r]; });
    saveCache();
    cardsOnScreen().forEach(function (card) {
      var r = refOf(card);
      if (serverHidden[r]) card.setAttribute('data-sml-fs-hidden', '1');
      else if (askedRefs.indexOf(r) >= 0) card.removeAttribute('data-sml-fs-hidden');
    });
  }

  /* home-feed.js re-renders and de-dupes cards; a rebuilt node loses its
     attribute, so every sweep re-applies what the server already said. */
  function reapplyHidden() {
    cardsOnScreen().forEach(function (card) {
      if (serverHidden[refOf(card)] && !card.hasAttribute('data-sml-fs-hidden')) card.setAttribute('data-sml-fs-hidden', '1');
    });
  }

  function onScreenRefs() {
    var refs = cardsOnScreen().map(refOf).filter(Boolean);
    return refs.filter(function (r, i) { return refs.indexOf(r) === i; }).slice(0, 120);
  }

  /* At most one background /visible request per VISIBILITY_GAP_MS. The feed
     renders cards in waves (12, then 40, then more on scroll), and this
     homepage already makes dozens of REST calls per load — five back-to-back
     /visible calls tipped the host into 429 throttling on the first deploy.
     Explicit actions (hide/undo) are unaffected: they carry refs themselves. */
  var VISIBILITY_GAP_MS = 4000;
  var lastVisibilityAt = 0, visibilityTimer = null, visibilityInFlight = false;
  function scheduleVisibilityCheck() {
    if (visibilityTimer) return;
    var wait = visibilityInFlight ? VISIBILITY_GAP_MS : Math.max(0, lastVisibilityAt + VISIBILITY_GAP_MS - Date.now());
    visibilityTimer = setTimeout(function () {
      visibilityTimer = null;
      if (visibilityInFlight) { scheduleVisibilityCheck(); return; }
      var pending = cardsOnScreen().some(function (c) { var r = refOf(c); return r && !checkedRefs[r]; });
      if (!pending) return;
      visibilityInFlight = true;
      lastVisibilityAt = Date.now();
      checkVisibility(false).then(function () { visibilityInFlight = false; }, function () { visibilityInFlight = false; });
    }, wait);
  }

  function checkVisibility(all) {
    var refs = cardsOnScreen().map(refOf).filter(function (r) { return r && (all || !checkedRefs[r]); });
    refs = refs.filter(function (r, i) { return refs.indexOf(r) === i; });
    if (!refs.length) return Promise.resolve();
    refs.forEach(function (r) { checkedRefs[r] = true; });
    var chunks = [];
    for (var i = 0; i < refs.length; i += 120) chunks.push(refs.slice(i, i + 120));
    return Promise.all(chunks.map(function (chunk) {
      return api('POST', '/visible', { refs: chunk })
        .then(function (j) { applyHidden(j && j.hidden, chunk); })
        .catch(function () { chunk.forEach(function (r) { delete checkedRefs[r]; }); });
    }));
  }

  /* Optimistic: the card disappears and the note appears immediately — the
     server takes ~2-5s here, far too long to leave a dismissed post on screen.
     A failure puts the card back. Undo works even before the server answers:
     the card returns at once and the hide is reversed when its target is known. */
  function hide(card, scope) {
    var ref = refOf(card);
    if (!ref || card.hasAttribute('data-sml-fs-hidden')) return;
    var asked = onScreenRefs();
    var target = null, undone = false, settled = false;

    var note = el('div', 'sml-fs-note');
    note.setAttribute('role', 'status');
    note.appendChild(el('span', '', scope === 'author' ? 'Posts from this account are hidden.' : 'Post hidden. We\u2019ll show you less like this.'));
    var undo = el('button', '', 'Undo');
    undo.type = 'button';
    note.appendChild(undo);
    card.parentNode.insertBefore(note, card);
    card.setAttribute('data-sml-fs-hidden', '1');
    serverHidden[ref] = true;
    saveCache();
    setTimeout(function () { undo.focus({ preventScroll: true }); }, 0);

    function restoreLocally() {
      delete serverHidden[ref];
      card.removeAttribute('data-sml-fs-hidden');
      note.remove();
      saveCache();
    }
    function reverseOnServer() {
      var again = onScreenRefs();
      return api('DELETE', '/hide', { target: target, refs: again }).then(function (res) {
        if (res && Array.isArray(res.hiddenRefs)) applyHidden(res.hiddenRefs, again);
        else return checkVisibility(true);
      });
    }

    undo.addEventListener('click', function () {
      if (undone) return;
      undone = true;
      restoreLocally();
      if (settled && target) reverseOnServer().catch(function () { /* next /visible reconciles */ });
    });

    api('POST', '/hide', { scope: scope, item_ref: ref, refs: asked }).then(function (j) {
      settled = true;
      target = j && j.target;
      if (undone) { if (target) return reverseOnServer(); return; }
      /* the response already says which on-screen cards this hide covers */
      if (j && Array.isArray(j.hiddenRefs)) applyHidden(j.hiddenRefs, asked);
      else if (scope === 'author') checkVisibility(true);
    }).catch(function (e) {
      settled = true;
      if (!undone) restoreLocally();
      if (e && e.data && e.data.code === 'sml_fs_self') return;   /* own post: nothing to hide */
      window.console && console.warn && console.warn('[feed-signals] hide failed', e && e.message);
    });
  }

  /* The ⋯ menu for OTHER members' posts. home-feed.js owns the menu on the
     viewer's own posts (Edit / Delete); this never touches those cards. */
  function addMenus() {
    cardsOnScreen().forEach(function (card) {
      if (card.getAttribute('data-sml-fs-menu')) return;
      if (card.getAttribute('data-sml-owner-id') === ME) return;
      if (card.querySelector('.sml-kebab')) return;           // already has home-feed's own menu
      var ref = refOf(card);
      if (!ref) return;
      card.setAttribute('data-sml-fs-menu', '1');

      var kb = el('button', 'sml-kebab', '⋯');
      kb.type = 'button';
      kb.setAttribute('aria-label', 'Post options');
      kb.setAttribute('aria-haspopup', 'menu');
      kb.setAttribute('aria-expanded', 'false');
      var menu = el('div', 'sml-kmenu');
      menu.setAttribute('role', 'menu');

      [['item', 'Not interested'], ['author', 'Hide posts from this account']].forEach(function (pair) {
        var b = el('button', 'sml-fs-mi', pair[1]);
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          menu.classList.remove('open'); kb.setAttribute('aria-expanded', 'false');
          hide(card, pair[0]);
        });
        menu.appendChild(b);
      });

      kb.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        host().querySelectorAll('.sml-kmenu.open').forEach(function (m) { if (m !== menu) m.classList.remove('open'); });
        var open = menu.classList.toggle('open');
        kb.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) { var first = menu.querySelector('button'); if (first) first.focus({ preventScroll: true }); }
      });

      place(card, kb, menu);
    });
  }

  /* Same placement contract as home-feed.js: inline after the card's Open
     control when the action row exists, otherwise top-right; re-homed inline
     once the (late-hydrating) action row appears. */
  function place(card, kb, menu) {
    var open = card.querySelector('.sml-hfe-actions .sml-hfe-open');
    if (open && open.parentElement) {
      var wrap = el('span', 'sml-kwrap');
      wrap.appendChild(kb); wrap.appendChild(menu);
      open.parentElement.insertBefore(wrap, open.nextSibling);
    } else {
      card.appendChild(kb); card.appendChild(menu);
    }
  }

  function rehome() {
    cardsOnScreen().forEach(function (card) {
      if (!card.getAttribute('data-sml-fs-menu')) return;
      var kb = card.querySelector('.sml-kebab');
      if (!kb || kb.closest('.sml-kwrap')) return;
      var open = card.querySelector('.sml-hfe-actions .sml-hfe-open');
      if (!open || !open.parentElement) return;
      var menu = card.querySelector('.sml-kmenu');
      var wrap = el('span', 'sml-kwrap');
      wrap.appendChild(kb); if (menu) wrap.appendChild(menu);
      open.parentElement.insertBefore(wrap, open.nextSibling);
    });
  }

  /* ------------------------------------------------------------ impressions */

  var seen = {};                 // ref|surface -> true, per page view
  var queue = [];
  var impressionsOff = false;    // set on 401/403/404: never retry a dead endpoint
  var timers = typeof WeakMap === 'function' ? new WeakMap() : null;
  var observed = typeof WeakSet === 'function' ? new WeakSet() : null;
  var io = null;

  function surfaceOf(card) { return card.hasAttribute('data-sml-slot') ? 'slot' : 'feed'; }

  function positionOf(card) {
    var visible = cardsOnScreen().filter(function (c) { return !c.hasAttribute('data-sml-fs-hidden'); });
    var i = visible.indexOf(card);
    return i < 0 ? 998 : i;
  }

  function record(card) {
    if (impressionsOff) return;
    var ref = refOf(card);
    if (!ref || card.hasAttribute('data-sml-fs-hidden')) return;
    var surface = surfaceOf(card);
    var key = ref + '|' + surface;
    if (seen[key]) return;
    seen[key] = true;
    queue.push({ ref: ref, position: positionOf(card), surface: surface });
    if (queue.length >= 60) flush(false);
  }

  function flush(onExit) {
    if (impressionsOff || !queue.length) return;
    var batch = queue.splice(0, 60);
    api('POST', '/impressions', { items: batch }, { keepalive: onExit }).catch(function (e) {
      var status = e && e.status;
      if (status === 401 || status === 403 || status === 404) { impressionsOff = true; queue.length = 0; return; }
      /* rate limit or transient: requeue what fits, retried on the next tick */
      if (!onExit && status !== 400) Array.prototype.unshift.apply(queue, batch.slice(0, Math.max(0, 120 - queue.length)));
    });
    if (queue.length && !onExit) setTimeout(function () { flush(false); }, 1000);
  }

  function observeCards() {
    if (!io) return;
    cardsOnScreen().forEach(function (card) {
      if (observed && observed.has(card)) return;
      if (observed) observed.add(card);
      io.observe(card);
    });
  }

  function startImpressions() {
    if (typeof IntersectionObserver !== 'function') return;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var card = entry.target;
        var pending = timers ? timers.get(card) : null;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!pending) {
            var t = setTimeout(function () { if (timers) timers.delete(card); record(card); }, 1000);
            if (timers) timers.set(card, t);
          }
        } else if (pending) {
          clearTimeout(pending);
          if (timers) timers.delete(card);
        }
      });
    }, { threshold: [0, 0.5] });
    setInterval(function () { flush(false); }, 10000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
    window.addEventListener('pagehide', function () { flush(true); });
  }

  /* ------------------------------------------------------------- onboarding */

  var LABELS = {
    stocks: 'Stocks', options: 'Options', crypto: 'Crypto', futures: 'Futures', learning: 'Still learning',
    minutes: 'Minutes', days: 'Days', weeks: 'Weeks', months_plus: 'Months or longer',
    protect_capital: 'Protect my capital', balanced: 'Balanced', aggressive: 'Aggressive', swing_for_the_fences: 'Swing for the fences',
    just_starting: 'Just starting', under_a_year: 'Under a year', one_to_five: '1–5 years', over_five: 'Over 5 years',
    technology: 'Technology', energy: 'Energy', healthcare: 'Healthcare', financials: 'Financials', consumer: 'Consumer',
    industrials: 'Industrials', macro: 'Macro',
    live_video: 'Live video', short_clips: 'Short clips', written_letters: 'Written letters', chat: 'Chat',
    voice_and_chat: 'Voice rooms & chat', read_quietly: 'Mostly read quietly',
    follow_pros: 'Follow pros', share_my_trades: 'Share my trades', both: 'Both',
    headlines_only: 'Headlines only', a_few_a_day: 'A few a day', everything: 'Everything'
  };
  function label(v) { return LABELS[v] || String(v).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }

  var promptState = null;        // set while the member still needs prompting

  function insertPrompt(state) {
    promptState = state;
    if (document.getElementById('sml-fs-prompt')) return;
    var feed = host();
    var card = el('section', 'sml-fs-prompt');
    card.id = 'sml-fs-prompt';
    card.setAttribute('aria-labelledby', 'sml-fs-prompt-title');
    var h = el('h3', '', 'Personalize your feed');
    h.id = 'sml-fs-prompt-title';
    card.appendChild(h);
    card.appendChild(el('p', '', 'Answer 10 quick questions about how you trade and we’ll show you more of what matters to you. About a minute.'));
    var row = el('div', 'sml-fs-row');
    var start = el('button', 'sml-fs-btn primary', 'Personalize my feed');
    start.type = 'button';
    start.addEventListener('click', function () { openQuestionnaire(state, card); });
    var later = el('button', 'sml-fs-btn', 'Not now');
    later.type = 'button';
    later.addEventListener('click', function () {
      promptState = null;
      later.disabled = true;
      api('POST', '/onboarding/snooze', { days: 7 }).then(function () { card.remove(); }).catch(function () { card.remove(); });
    });
    row.appendChild(start); row.appendChild(later);
    card.appendChild(row);

    placePromptTop(card);
  }

  /* Directly after the pinned breaking-news block, above every post. home-feed
     top-inserts personalized posts AFTER the prompt exists, so this runs on
     every sweep — the same contract as its own ensurePinnedTop(). */
  function placePromptTop(card) {
    var feed = host();
    var pinned = document.getElementById('sml-hf-pinned');
    if (pinned && pinned.parentNode) {
      if (pinned.nextSibling !== card) pinned.parentNode.insertBefore(card, pinned.nextSibling);
      return;
    }
    var first = feed.querySelector(CARD);
    if (!first || !first.parentNode) { if (!card.parentNode) feed.insertBefore(card, feed.firstChild); return; }
    var precedes = first.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!card.parentNode || precedes) first.parentNode.insertBefore(card, first);
  }

  function openQuestionnaire(state, promptCard) {
    var previousFocus = document.activeElement;
    var overlay = el('div', 'sml-fs-overlay');
    var dialog = el('div', 'sml-fs-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'sml-fs-dialog-title');

    var head = el('header');
    var title = el('h2', '', 'Personalize your feed');
    title.id = 'sml-fs-dialog-title';
    var close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    head.appendChild(title); head.appendChild(close);
    dialog.appendChild(head);

    var form = el('form');
    form.noValidate = true;
    var groups = {};
    (state.questions || []).forEach(function (q, qi) {
      var fs = el('fieldset', 'sml-fs-q');
      var lg = el('legend', '', q.prompt);
      fs.appendChild(lg);
      groups[q.id] = fs;
      if (q.type === 'tickers') {
        var input = el('input');
        input.type = 'text';
        input.name = q.id;
        input.autocomplete = 'off';
        input.setAttribute('autocapitalize', 'characters');
        input.placeholder = 'e.g. AAPL, NVDA, SPY';
        input.setAttribute('aria-describedby', 'sml-fs-hint-' + qi);
        fs.appendChild(input);
        var hint = el('span', 'hint', 'Optional. Up to 5, separated by commas or spaces.');
        hint.id = 'sml-fs-hint-' + qi;
        fs.appendChild(hint);
      } else {
        (q.options || []).forEach(function (opt) {
          var wrap = el('label', 'opt');
          var inp = el('input');
          inp.type = q.type === 'multi' ? 'checkbox' : 'radio';
          inp.name = q.id;
          inp.value = opt;
          wrap.appendChild(inp);
          wrap.appendChild(el('span', '', label(opt)));
          fs.appendChild(wrap);
        });
        if (!q.required) fs.appendChild(el('span', 'hint', 'Optional. Pick any that apply.'));
      }
      form.appendChild(fs);
    });

    var foot = el('div', 'sml-fs-foot');
    var status = el('span', 'sml-fs-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var submit = el('button', 'sml-fs-btn primary', 'Save my preferences');
    submit.type = 'submit';
    foot.appendChild(status); foot.appendChild(submit);
    form.appendChild(foot);
    dialog.appendChild(form);
    overlay.appendChild(dialog);

    function dismiss() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); dismiss(); return; }
      if (ev.key !== 'Tab') return;
      var f = dialog.querySelectorAll('button, input');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey, true);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var answers = {};
      (state.questions || []).forEach(function (q) {
        if (q.type === 'tickers') {
          var raw = (form.elements[q.id] && form.elements[q.id].value) || '';
          var list = raw.split(/[\s,]+/).filter(Boolean);
          if (list.length) answers[q.id] = list;
        } else if (q.type === 'multi') {
          var picked = Array.prototype.slice.call(form.querySelectorAll('input[name="' + q.id + '"]:checked')).map(function (i) { return i.value; });
          if (picked.length) answers[q.id] = picked;
        } else {
          var one = form.querySelector('input[name="' + q.id + '"]:checked');
          if (one) answers[q.id] = one.value;
        }
      });

      Object.keys(groups).forEach(function (id) { groups[id].classList.remove('missing'); });
      var missing = (state.questions || []).filter(function (q) { return q.required && answers[q.id] === undefined; });
      if (missing.length) {
        missing.forEach(function (q) { groups[q.id].classList.add('missing'); });
        status.textContent = missing.length === 1 ? '1 question still needs an answer.' : missing.length + ' questions still need an answer.';
        var firstInput = groups[missing[0].id].querySelector('input');
        if (firstInput) firstInput.focus();
        return;
      }

      submit.disabled = true;
      status.textContent = 'Saving…';
      api('POST', '/onboarding', { answers: answers }).then(function () {
        promptState = null;
        status.textContent = 'Saved.';
        dismiss();
        if (promptCard) {
          promptCard.replaceChildren(el('h3', '', 'Your feed is personalized'), el('p', '', 'Thanks — we’ll use your answers from now on.'));
          setTimeout(function () { promptCard.remove(); }, 4000);
        }
      }).catch(function (e) {
        submit.disabled = false;
        var serverMissing = e && e.data && e.data.data && e.data.data.missing;
        if (serverMissing && serverMissing.length) {
          serverMissing.forEach(function (id) { if (groups[id]) groups[id].classList.add('missing'); });
          status.textContent = 'Some required questions are missing.';
        } else if (e && e.status === 429) {
          status.textContent = 'Too many attempts. Please try again in a little while.';
        } else {
          status.textContent = 'Couldn’t save right now. Please try again.';
        }
      });
    });

    /* Inside the home-feed shell, not <body>: the shell is itself a fixed,
       full-screen layer at z-index 2147483001, so anything appended to <body>
       below the max z-index renders BEHIND the page. */
    (document.getElementById('sml-hf-shell') || document.body).appendChild(overlay);
    var firstField = form.querySelector('input');
    (firstField || close).focus({ preventScroll: true });
  }

  function startOnboarding() {
    api('GET', '/onboarding').then(function (state) {
      if (state && state.slot === true) startSlot();   /* only when the slot is switched on for this member */
      if (state && state.shouldPrompt && Array.isArray(state.questions) && state.questions.length) insertPrompt(state);
    }).catch(function () { /* no prompt is always a safe outcome */ });
  }

  /* --------------------------------------------------------- corporate slot */

  var slotCard = null;

  function sameSite(u) {
    try { var x = new URL(String(u || ''), location.origin); return x.origin === location.origin ? x.href : ''; } catch (e) { return ''; }
  }
  function httpsUrl(u) {
    try { var x = new URL(String(u || '')); return x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; }
  }

  /* A paid placement must say so. "Corporate" is the verified-account badge;
     "Promoted" is the disclosure — they are deliberately two labels. */
  function buildSlotCard(slot) {
    var card = el('article', 'oh-card oh-post sml-fs-slot');
    card.setAttribute('data-hfe-item', slot.ref);
    card.setAttribute('data-sml-slot', '1');
    card.setAttribute('aria-label', 'Promoted post');
    if (slot.author && slot.author.id) card.setAttribute('data-sml-authorid', String(slot.author.id));
    var url = sameSite(slot.url);
    if (url) card.setAttribute('data-hfe-url', url);

    var head = el('div', 'sml-fs-slot-head');
    var av = slot.author && httpsUrl(slot.author.avatar);
    if (av) { var img = el('img', 'sml-fs-slot-av'); img.src = av; img.alt = ''; img.loading = 'lazy'; head.appendChild(img); }
    var authorUrl = slot.author && sameSite(slot.author.url);
    var name = el(authorUrl ? 'a' : 'span', 'sml-fs-slot-name', (slot.author && slot.author.name) || 'Corporate account');
    if (authorUrl) name.href = authorUrl;
    head.appendChild(name);
    head.appendChild(el('span', 'sml-fs-slot-badge', 'Corporate'));
    head.appendChild(el('span', 'sml-fs-slot-disclosure', 'Promoted'));
    card.appendChild(head);

    var h = el('h2');
    if (url) { var a = el('a', '', slot.title || ''); a.href = url; h.appendChild(a); } else h.textContent = slot.title || '';
    card.appendChild(h);
    if (slot.excerpt) card.appendChild(el('p', '', slot.excerpt));
    var pic = httpsUrl(slot.image);
    if (pic) { var im = el('img', 'sml-fs-slot-img'); im.src = pic; im.alt = ''; im.loading = 'lazy'; card.appendChild(im); }
    return card;
  }

  /* Position 4 among the posts the member can actually see, below any pinned
     breaking news. Re-placed every sweep: home-feed inserts and re-orders posts
     after load, exactly as it does for its own pin. The organic copy of the
     same item is hidden so the member never sees it twice. */
  function placeSlot() {
    if (!slotCard) return;
    var ref = refOf(slotCard);
    cardsOnScreen().forEach(function (c) {
      if (c !== slotCard && refOf(c) === ref) c.setAttribute('data-sml-fs-dup', '1');
    });
    var visible = cardsOnScreen().filter(function (c) {
      return c !== slotCard && !c.hasAttribute('data-sml-fs-hidden') && !c.hasAttribute('data-sml-fs-dup')
        && !c.hasAttribute('data-sml-pinned') && getComputedStyle(c).display !== 'none';
    });
    if (!visible.length) return;
    var index = Math.min(SLOT_POSITION, visible.length);
    var anchor = visible[index] || null;
    if (anchor) {
      if (slotCard.nextElementSibling !== anchor || slotCard.parentNode !== anchor.parentNode) anchor.parentNode.insertBefore(slotCard, anchor);
    } else {
      var last = visible[visible.length - 1];
      if (last.nextElementSibling !== slotCard) last.parentNode.insertBefore(slotCard, last.nextSibling);
    }
  }
  var SLOT_POSITION = 4;

  function startSlot() {
    api('GET', '/slot').then(function (j) {
      if (!j || !j.slot || typeof j.slot.ref !== 'string' || !j.slot.ref) return;
      if (typeof j.position === 'number' && j.position >= 0) SLOT_POSITION = j.position;
      slotCard = buildSlotCard(j.slot);
      placeSlot();
      addMenus();
      observeCards();
    }).catch(function () { /* no slot is always a safe outcome */ });
  }

  /* ------------------------------------------------------------------- boot */

  var sweepQueued = false;
  function sweep() {
    sweepQueued = false;
    addMenus();
    rehome();
    reapplyHidden();
    placeSlot();
    observeCards();
    scheduleVisibilityCheck();
    var promptEl = document.getElementById('sml-fs-prompt');
    if (promptState && !promptEl) insertPrompt(promptState);
    else if (promptEl) placePromptTop(promptEl);
  }
  function queueSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    setTimeout(sweep, 250);
  }

  function boot() {
    if (!nonce()) return;           /* no REST auth on this page: stay entirely inert */
    injectStyles();
    loadCache();
    reapplyHidden();
    startImpressions();
    sweep();
    startOnboarding();
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].addedNodes && records[i].addedNodes.length) { queueSweep(); return; }
      }
    });
    mo.observe(host(), { childList: true, subtree: true });
    setInterval(sweep, 5000);       /* belt and braces for re-renders the observer misses */
  }

  window.SMLFeedSignals = { flush: function () { flush(false); }, recheck: function () { return checkVisibility(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
