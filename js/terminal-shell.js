/*!
 * SML Ticker Terminal — ARTIFACT SHELL loader (Phase A of the replace-not-convert
 * plan). Public behavior: only adds the heat-map-off class. With ?tv2=1 (admin
 * preview via the WPCode gate) it renders the user's design 1:1: fetches the
 * captured artifact shell + styles from the same pinned CDN base as this script,
 * injects it above the legacy terminal and hides the legacy visually (it stays
 * booted — its modules and data connections are reused in later phases).
 */
(function () {
  'use strict';
  document.body.classList.add('tv2-heatmap-off'); // heat map stays off everywhere

  // LIVE MODE: the WPCode go-live snippet sets window.SML_TV2_LIVE=1 for every
  // visitor on /stock-chart/. Without the flag, ?tv2=1 remains the explicit
  // preview opt-in. ?tv2=0 is the escape hatch (the snippet also bails server-side).
  var params = new URLSearchParams(location.search);
  var LIVE = (window.SML_TV2_LIVE === 1) && params.get('tv2') !== '0';
  if (!LIVE && params.get('tv2') !== '1') return;

  // Derive the pinned CDN base from this script's own URL (commit-pinned by the loader).
  var self = document.currentScript || document.getElementById('sml-tv2-shell') ||
    [].slice.call(document.scripts).filter(function (s) { return /terminal-shell\.js/.test(s.src || ''); })[0];
  var base = self && self.src ? self.src.replace(/js\/terminal-shell\.js.*$/, '') : '';
  if (!base) return;

  function boot() {
    var root = document.getElementById('sml-tv2-root');
    if (!root || root.getAttribute('data-artifact')) return;
    root.setAttribute('data-artifact', '1');

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = base + 'css/terminal-artifact.css';
    document.head.appendChild(link);

    fetch(base + 'terminal-artifact.html')
      .then(function (r) { if (!r.ok) throw new Error('shell ' + r.status); return r.text(); })
      .then(function (html) {
        root.innerHTML = html;
        document.body.classList.add('tv2-artifact-on'); // hides the legacy terminal (CSS)
        // the PREVIEW banner is a dev aid — never show it to live visitors
        if (window.SML_TV2_LIVE === 1) {
          var ban = root.querySelector(':scope > div');
          if (ban && /PREVIEW/.test(ban.textContent || '')) ban.style.display = 'none';
        }
        // Tag the captured wrapper chain + zones so responsive CSS can address
        // them — the captured divs carry NO classes (one has width:1440px inline
        // to the design's fixed frame). Attributes only; structure untouched, so
        // the other phase scripts' zone resolution keeps working.
        try {
          var el = root.querySelector(':scope > :last-child');
          while (el) {
            el.setAttribute('data-tv2-frame', '1');
            if (el.children.length !== 1) break;
            el = el.children[0];
          }
          if (el && el.children.length >= 4) {
            ['header', 'strip', 'tabs', 'zbody'].forEach(function (n, i) { el.children[i].setAttribute('data-tv2-zone', n); });
            var bz = el.children[3];
            if (bz.children[0]) bz.children[0].setAttribute('data-tv2-zone', 'main');
            if (bz.children[1]) bz.children[1].setAttribute('data-tv2-zone', 'rail');
          }
        } catch (e) {}
        // place the shell where the terminal was, so page flow reads naturally
        var legacy = document.querySelector('.sml-terminal');
        if (legacy && legacy.parentNode) legacy.parentNode.insertBefore(root, legacy);
        // The theme gives .sml-ticker-summary a negative full-bleed right margin
        // (rule lives in a cross-origin sheet, unbeatable by specificity) — on
        // narrow viewports it overflows the page; clamp inline (beats everything).
        function clampSummary() {
          var sm = document.querySelector('.sml-ticker-summary');
          if (!sm) return;
          /* at EVERY width (2026-08-19): the theme rule is !important and won at
             1200-1699 too, pushing the page 60px+ past the viewport at 1440 */
          sm.style.setProperty('margin-right', '0', 'important');
          sm.style.setProperty('margin-left', '0', 'important');
          sm.style.setProperty('max-width', '100%', 'important');
          sm.style.setProperty('width', '100%', 'important');
        }
        clampSummary();
        window.addEventListener('resize', clampSummary);
        // Phase B: wire real data into the shell
        /* module chain — async=false keeps INSERTION ORDER (a dynamically inserted script
           is async by default): the native chart must set its flag before adopt runs */
        var chain = function (file) { var s = document.createElement('script'); s.src = base + file; s.async = false; document.body.appendChild(s); };
        chain('js/terminal-data.js');      // Phase B: real quote/strip/rail data
        chain('js/terminal-chart.js');     // Phase 2: NATIVE chart (history + quote), replaces the adopted LoopCharts canvas
        chain('js/terminal-adopt.js');     // Phase C: adopt the still-legacy modules (feed, alerts, ad) into the shell's cards
        chain('js/terminal-options.js');   // Options tab: chain + what-if calculator
        chain('js/terminal-mp2.js');       // Market Position v2 (+ chain-loads the Short sale card)
      })
      .catch(function () { /* fetch failed → leave the legacy terminal untouched */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // the legacy terminal renders late; keep trying briefly so placement lands
  var tries = 0;
  var t = setInterval(function () {
    var root = document.getElementById('sml-tv2-root');
    var legacy = document.querySelector('.sml-terminal');
    if (root && root.getAttribute('data-artifact') && legacy && legacy.previousElementSibling !== root && legacy.parentNode) {
      legacy.parentNode.insertBefore(root, legacy);
    }
    if (++tries > 20) clearInterval(t);
  }, 400);
})();
