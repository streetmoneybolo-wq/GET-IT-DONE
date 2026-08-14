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
  if (!/[?&]tv2=1(&|$)/.test(location.search)) return;

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
    var main = body.children[0], rail = body.children[1];
    if (!main || !rail) return false;

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

    // MAIN[1] = feed card ← #sml-lf
    var lf = document.getElementById('sml-lf');
    if (!done.lf && lf && main.children[1]) { done.lf = adopt(cardBody(main.children[1], true), lf); }
    // MAIN[3] = sponsored ← #sml-ad-slot
    var ad = document.getElementById('sml-ad-slot');
    if (!done.ad && ad && main.children[3]) { done.ad = adopt(cardBody(main.children[3], true), ad); }
    // RAIL[0] = alert card ← #sml-alert-list (fall back to whole side module's list)
    var al = document.getElementById('sml-alert-list') ||
             (document.getElementById('sml-side-alerts') && document.getElementById('sml-side-alerts').querySelector('.b, ul, ol'));
    if (!done.al && al && rail.children[0]) { done.al = adopt(rail.children[0], al); }
    // RAIL[2] = market position ← #sml-mp
    var mp = document.getElementById('sml-mp');
    if (!done.mp && mp && rail.children[2]) {
      done.mp = adopt(cardBody(rail.children[2], true), mp);
      if (done.mp) { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }
    }
    // RAIL[3] = short-sale: no live data owner → hide rather than show fake FINRA numbers
    if (rail.children[3] && !done.ss) { rail.children[3].style.display = 'none'; done.ss = true; }

    // banner reflects the true state once the chart is in
    if (done.chart && !done.banner) {
      var ban = root.querySelector(':scope > div');
      if (ban && /PREVIEW/.test(ban.textContent || '')) {
        ban.textContent = 'PREVIEW — live chart, quote, feed, market position, alerts and ads are REAL. Remaining: tabs (Options/Research/News), responsiveness, rollout QA.';
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
