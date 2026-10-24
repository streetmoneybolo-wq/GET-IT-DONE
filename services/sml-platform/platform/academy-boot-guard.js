/* Start-up guard, the first script in <head>.
   1. A start that never finishes is counted. The next start after one that froze clears the Academy's saved layout and view state
      (keeping chart drawings, theme and the tour flags) before anything else runs.
   2. Each start reports the saved keys' names and sizes (never their values).
   3. A small watchdog in a Web Worker notes each script as it finishes; if the page then goes silent for 6 s (frozen), the worker,
      which keeps running while the page is stuck, reports the last steps so the freeze can be traced. Cleared when sign-in works. */
(function () {
  try {
    var K = 'sml-boot', n = Number(localStorage.getItem(K)) || 0, keys = [], rec = false;
    localStorage.setItem(K, String(n + 1));
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('sml-') === 0) keys.push(k + ':' + String(localStorage.getItem(k) || '').length); }
    if (n >= 1) {
      var keep = /^(sml-chart-draw-v1|sml-academy-appearance-v1|sml-academy-tour-v1|sml-academy-explain|sml-last-symbol|sml-boot)$/, drop = [];
      for (var j = 0; j < localStorage.length; j++) { var kk = localStorage.key(j); if (kk && kk.indexOf('sml-') === 0 && !keep.test(kk)) drop.push(kk); }
      for (var d = 0; d < drop.length; d++) localStorage.removeItem(drop[d]);
      try { sessionStorage.clear(); } catch (_) { /* ignore */ }
      localStorage.setItem(K, '1'); rec = true;
    }
    window.__smlBootDone = function () { try { localStorage.removeItem(K); } catch (_) { /* ignore */ } };
    setTimeout(window.__smlBootDone, 15000);
    var send = function (body) { try { if (navigator.sendBeacon) navigator.sendBeacon('/academy-activity/diag', new Blob([JSON.stringify(body)], { type: 'application/json' })); } catch (_) { /* ignore */ } };
    send({ stage: rec ? 'boot_recovered' : 'boot_start', code: 'boots:' + n, message: keys.join(' ').slice(0, 190), ua: navigator.userAgent.slice(0, 80), inDiscord: location.search.indexOf('frame_id') >= 0 });
    var wk = new Worker('/academy-activity/boot-watch.js'); // same-origin file: the page's policy refuses blob: workers
    wk.postMessage({ url: location.origin + '/academy-activity/diag' });
    var crumb = function (c) { try { wk.postMessage({ c: c }); } catch (_) { /* ignore */ } };
    window.__smlCrumb = crumb;
    document.addEventListener('load', function (e) { var t = e.target; if (t && t.tagName === 'SCRIPT') crumb('ran ' + String(t.src || 'inline').split('/').pop().slice(0, 10)); }, true);
    document.addEventListener('DOMContentLoaded', function () { crumb('dom'); });
    window.addEventListener('load', function () { crumb('loaded'); });
    var beats = 0, bt = setInterval(function () { crumb(''); if (++beats > 30) { clearInterval(bt); try { wk.terminate(); } catch (_) { /* ignore */ } } }, 1000);
  } catch (_) { /* never in the way */ }
})();
