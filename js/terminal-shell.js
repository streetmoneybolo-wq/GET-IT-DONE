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

  var params = new URLSearchParams(location.search);
  if (params.get('tv2') !== '1') return; // artifact preview is explicit opt-in

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
        // place the shell where the terminal was, so page flow reads naturally
        var legacy = document.querySelector('.sml-terminal');
        if (legacy && legacy.parentNode) legacy.parentNode.insertBefore(root, legacy);
        // Phase B: wire real data into the shell
        var d = document.createElement('script'); d.src = base + 'js/terminal-data.js'; document.body.appendChild(d);
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
