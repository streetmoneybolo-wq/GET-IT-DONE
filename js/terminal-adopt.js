/*!
 * SML Terminal — Phase C: adopt the booted LEGACY modules into the artifact shell.
 * The legacy terminal keeps booting (hidden); its live modules are then MOVED
 * into the artifact's cards, replacing the design's sample content:
 *   MAIN:  feed card  ← #sml-lf (real stream + composer, auth intact)
 *          sponsored  ← #sml-ad-slot
 *   RAIL:  alert card ← #sml-alert-list (list body; card header/count stay wired)
 *          MP card    ← #sml-mp (canvas move-safety proven live)
 *   Short-sale card: hidden — no verified live data owner (never fake FINRA data).
 * Modules not present in the design (voice room, videos) stay booted but hidden;
 * the user decides their fate separately.
 */
(function () {
  'use strict';
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return; // live flag or explicit preview

  function cardBody(card, keepHeader) {
    // hide the card's sample content (keep header row), return the card as mount target
    if (!card) return null;
    var kids = [].slice.call(card.children);
    for (var i = keepHeader ? 1 : 0; i < kids.length; i++) {
      if (!kids[i].hasAttribute('data-tv2-keep')) kids[i].style.display = 'none';
    }
    return card;
  }
  function adopt(target, el) {
    if (!target || !el || target.contains(el)) return false;
    el.style.width = '100%';
    target.appendChild(el);
    return true;
  }

  function run() {
    var root = document.getElementById('sml-tv2-root');
    if (!root || root.getAttribute('data-artifact') !== '1' || root.children.length < 2) return false;
    // the captured markup wraps the zones — descend through single-child wrappers
    var shell = root.querySelector(':scope > :last-child');
    while (shell && shell.children.length === 1) shell = shell.children[0];
    if (!shell || shell.children.length < 4) return false;
    var body = shell.children[3];
    var mainZone = body.children[0], railZone = body.children[1];
    if (!mainZone || !railZone) return false;
    /* DESIGN cards only: modules this build inserts itself (Market position v2,
       Short sale analysis — marked data-tv2-keep / tv2-* class) must not shift
       the index map, whichever script happens to run first. */
    var own = function (zone) { return [].filter.call(zone.children, function (c) { return !c.hasAttribute('data-tv2-keep') && !/(^|\s)tv2-/.test(c.className || ''); }); };
    var main = own(mainZone), rail = own(railZone);
    main.children = main; rail.children = rail;   /* keep the children[n] reads below unchanged */

    var done = root.__adopted || (root.__adopted = {});

    // MAIN[0] = chart card ← #sml-ws-left (the REAL LoopCharts chart column:
    // controls + stage + alert layers). Verified live: canvases re-measure and
    // the engine redraws after the move; the hidden TradingView fallback iframe
    // rides along (its background reload is harmless). Mock candles + mock
    // control row are hidden — the real controls come with the module.
    var wsl = document.getElementById('sml-ws-left');
    if (!done.chart && wsl && wsl.querySelector('canvas') && main.children[0]) {
      done.chart = adopt(cardBody(main.children[0], false), wsl);
      if (done.chart) { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }
    }

    // MAIN[1] = feed card ← #sml-lf. The design card keeps ITS header; the legacy
    // module's own "Live Feed" header is hidden so there is exactly ONE title.
    var lf = document.getElementById('sml-lf');
    if (!done.lf && lf && main.children[1]) {
      done.lf = adopt(cardBody(main.children[1], true), lf);
      if (done.lf) {
        var oldHead = lf.querySelector('.lf-head');
        if (oldHead) oldHead.style.display = 'none';
        // ---- "Voice Room" as a 5th SOURCE TAB (like moomoo/Stocktwits/Webull).
        // The legacy #live-voice-room UI is NEVER shown; it stays booted+hidden and
        // this NEW design-matched panel proxies its controls (the old system does
        // the real join/heartbeat/media work).
        var tabRow = lf.querySelector('.sml-tct-tabs');
        var legacyRoom = document.getElementById('live-voice-room');
        if (tabRow && legacyRoom && !lf.querySelector('[data-tv2-voice-tab]')) {
          var proto = tabRow.querySelector('button');
          var vtab = proto ? proto.cloneNode(false) : document.createElement('button');
          vtab.textContent = '🎙 Voice Room';
          vtab.setAttribute('data-tv2-voice-tab', '1');
          vtab.classList.remove('active', 'is-active'); vtab.removeAttribute('aria-selected');
          tabRow.appendChild(vtab);

          // my panel, design tokens; controls proxy the hidden legacy buttons
          var panel = document.createElement('div');
          panel.setAttribute('data-tv2-voice-panel', '1');
          panel.style.cssText = 'display:none;padding:18px 16px;background:#0d141c;border:1px solid #134a33;border-radius:10px;margin:12px 0';
          panel.innerHTML =
            '<div style="font:600 13px Archivo,sans-serif;color:#e6edf3;margin-bottom:4px">Live Voice Room</div>' +
            '<div data-v-status style="font:400 11px/1.5 \'IBM Plex Mono\',monospace;color:#8fa3b5;margin-bottom:12px">Connecting to the room system…</div>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
              '<button data-v="join" style="padding:8px 20px;border-radius:999px;border:1px solid #134a33;background:linear-gradient(180deg,#00ff88,#00c86b);color:#04120b;font:600 12px Archivo,sans-serif;cursor:pointer">Join</button>' +
              '<button data-v="listen" style="padding:8px 18px;border-radius:999px;border:1px solid #1c2833;background:#131c26;color:#8fa3b5;font:600 12px Archivo,sans-serif;cursor:pointer">Listen only</button>' +
              '<button data-v="mute" style="padding:8px 18px;border-radius:999px;border:1px solid #1c2833;background:#131c26;color:#8fa3b5;font:600 12px Archivo,sans-serif;cursor:pointer">Mute</button>' +
              '<button data-v="leave" style="padding:8px 18px;border-radius:999px;border:1px solid #4a1d24;background:#1a0d10;color:#ff4757;font:600 12px Archivo,sans-serif;cursor:pointer">Leave</button>' +
            '</div>';
          var stream = lf.querySelector('.lf-stream'), composer = lf.querySelector('.lf-composer'), status = lf.querySelector('.sml-tct-status');
          (stream && stream.parentNode ? stream.parentNode : lf).insertBefore(panel, stream || null);

          function legacyBtn(rx) {
            var bs = [].slice.call(legacyRoom.querySelectorAll('button, [role="button"], a'));
            return bs.find(function (b) { return rx.test((b.textContent || '').trim()); }) || null;
          }
          var statusTimer = null;
          function mirrorStatus() {
            var el = panel.querySelector('[data-v-status]');
            var t = (legacyRoom.innerText || '').replace(/\s+/g, ' ').trim();
            el.textContent = t ? t.slice(0, 140) : 'Room idle.';
          }
          function showVoice(on) {
            panel.style.display = on ? 'block' : 'none';
            if (stream) stream.style.display = on ? 'none' : '';
            if (composer) composer.style.display = on ? 'none' : '';
            if (status) status.style.display = on ? 'none' : '';
            vtab.style.background = on ? 'rgba(0,255,136,.14)' : '';
            vtab.style.color = on ? '#00ff88' : '';
            if (on) { mirrorStatus(); statusTimer = setInterval(mirrorStatus, 1500); }
            else if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
          }
          vtab.addEventListener('click', function () { showVoice(panel.style.display === 'none'); });
          [].forEach.call(tabRow.querySelectorAll('button'), function (b) {
            if (b !== vtab) b.addEventListener('click', function () { showVoice(false); });
          });
          panel.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('button[data-v]') : null; if (!b) return;
            var map = { join: /join/i, listen: /listen/i, mute: /mute|unmute/i, leave: /leave|exit/i };
            var lb = legacyBtn(map[b.getAttribute('data-v')]);
            if (lb) { try { lb.click(); } catch (e) {} setTimeout(mirrorStatus, 400); }
            else { var st = panel.querySelector('[data-v-status]'); st.textContent = 'That control isn’t available right now (the room system hasn’t offered it yet).'; }
          });
        }
      }
    }
    // MAIN[2] = the design's sample news card — sample articles can't ship, and
    // the real news module lives in the News tab; hide (guard: never hide a card
    // that an adopted module already moved into)
    if (!done.newsCard && main.children[2] && !main.children[2].querySelector('#sml-lf,#sml-ws-left,#sml-ad-slot')) {
      main.children[2].style.display = 'none'; done.newsCard = true;
    }
    // MAIN[3] = sponsored ← #sml-ad-slot (back to its original slot — the legacy
    // #sml-mp module is no longer adopted anywhere; terminal-mp2.js replaces it
    // with a brand-new card built straight off the real market-position API,
    // inserted directly under the chart. Legacy #sml-mp stays hidden, see CSS.)
    var ad = document.getElementById('sml-ad-slot');
    if (!done.ad && ad && main.children[3]) { done.ad = adopt(cardBody(main.children[3], true), ad); }
    // RAIL[0] = alert card ← #sml-alert-list (fall back to whole side module's list)
    var al = document.getElementById('sml-alert-list') ||
             (document.getElementById('sml-side-alerts') && document.getElementById('sml-side-alerts').querySelector('.b, ul, ol'));
    if (!done.al && al && rail.children[0]) { done.al = adopt(rail.children[0], al); }
    // RAIL[2]: no longer used (was MP's old slot) — hide its sample content
    if (rail.children[2] && !done.mp) { rail.children[2].style.display = 'none'; done.mp = true; }
    // RAIL[3] = short-sale: no live data owner → hide rather than show fake FINRA numbers
    if (rail.children[3] && !done.ss) { rail.children[3].style.display = 'none'; done.ss = true; }

    // banner reflects the true state once the chart is in
    if (done.chart && !done.banner) {
      var ban = root.querySelector(':scope > div');
      if (ban && /PREVIEW/.test(ban.textContent || '')) {
        ban.textContent = 'PREVIEW — chart, quote, feed, market position, alerts, ads and the Options / Research / News tabs are all REAL. Remaining: responsiveness + rollout QA.';
        done.banner = true;
      }
    }
    return !!(done.lf && done.mp && done.chart);
  }

  var tries = 0;
  var t = setInterval(function () {
    var ok = false;
    try { ok = run(); } catch (e) {}
    if (ok || ++tries > 50) clearInterval(t); // keep retrying ~15s for late-booting modules
  }, 300);
})();
