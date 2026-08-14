/*!
 * SML Ticker Terminal — REVERTED to the original terminal look (user decision,
 * 2026-08-13). The V2 chrome / re-skin / artifact layout are disabled; the ONLY
 * remaining change is the heat-map removal, done in terminal-v2.css under the
 * body class added here. Every layout experiment remains in git history
 * (GET-IT-DONE) and can be restored by reverting this commit.
 */
(function () {
  'use strict';
  // Marker class only — terminal-v2.css scopes the heat-map removal under it.
  document.body.classList.add('tv2-heatmap-off');
})();
