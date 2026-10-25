/* SML Website Dev beacon. Runs for every visitor. Reports script errors, failed requests, broken assets, Web Vitals and a
   light accessibility count to the site's own /wp-json/sml-dev/v1/beacon. Nothing identifies the visitor: no ids, no
   names, no cookies read, no query strings (only paths), and the whole thing is bounded (25 events per page view). */
(function () {
  'use strict';
  var C = window.SML_WD; if (!C || !C.beacon || window.__smlWdBeacon) return; window.__smlWdBeacon = true;
  var Q = [], sent = 0, seen = {}, flushTimer = 0, MAX = 25, page = C.path || location.pathname;
  var phone = window.matchMedia && window.matchMedia('(max-width:720px)').matches;
  var con = (navigator.connection && navigator.connection.effectiveType) || '';
  var sampled = !!C.admin || (Math.random() * 100 < (Number(C.rate) || 25));
  function path(u) { try { return new URL(String(u), location.href).pathname; } catch (_) { return String(u || '').split('?')[0].slice(0, 200); } }
  function host(u) { try { return new URL(String(u), location.href).host; } catch (_) { return ''; } }
  function push(ev) {
    if (sent + Q.length >= MAX) return;
    var key = ev.kind + '|' + (ev.message || '') + '|' + (ev.target || '');
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 3) return; /* the same error firing in a loop is one bug, reported three times at most */
    ev.device = phone ? 'phone' : 'desktop'; ev.con = con;
    Q.push(ev);
    if (Q.length >= 8) flush(); else if (!flushTimer) flushTimer = setTimeout(flush, 4000);
  }
  function flush(final) {
    clearTimeout(flushTimer); flushTimer = 0;
    if (!Q.length) return;
    var batch = Q.splice(0, 40); sent += batch.length;
    var body = JSON.stringify({ page: page, events: batch });
    try {
      if (final && navigator.sendBeacon && navigator.sendBeacon(C.beacon, new Blob([body], { type: 'application/json' }))) return;
      fetch(C.beacon, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (_) {}
  }

  /* ---- errors ---- */
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t !== window && (t.src || t.href) && t.tagName) {
      var u = t.src || t.href; if (!u || /^data:/.test(u)) return;
      push({ kind: 'resource', message: t.tagName.toLowerCase() + ' failed to load: ' + path(u), target: u, source: host(u) ? 'https://' + host(u) + path(u) : path(u) });
      return;
    }
    if (!e || (!e.message && !e.error)) return;
    push({ kind: 'js_error', message: String(e.message || (e.error && e.error.message) || 'Script error').slice(0, 300), source: e.filename || '', line: e.lineno || 0, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 400) : '' });
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; var msg = r && (r.message || (typeof r === 'string' ? r : JSON.stringify(r).slice(0, 200)));
    if (!msg) return;
    push({ kind: 'js_rejection', message: String(msg).slice(0, 300), stack: r && r.stack ? String(r.stack).slice(0, 400) : '' });
  });

  /* ---- failed requests (fetch and XHR), skipping the beacon itself ---- */
  if (window.fetch) {
    var F = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = F.apply(this, arguments);
      if (!url || url.indexOf(C.beacon) === 0 || /\/sml-dev\/v1\//.test(url)) return p;
      return p.then(function (res) {
        if (res && res.status >= 400 && res.status !== 401 && res.status !== 403) push({ kind: 'fetch', message: 'HTTP ' + res.status + ' ' + path(url), target: url, status: res.status });
        return res;
      }, function (err) {
        if (!(init && init.signal && init.signal.aborted)) push({ kind: 'fetch', message: 'network: ' + String((err && err.message) || err).slice(0, 120) + ' ' + path(url), target: url, status: 0 });
        throw err;
      });
    };
  }
  if (window.XMLHttpRequest) {
    var O = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) {
      this.__smlUrl = url;
      this.addEventListener('loadend', function () {
        if (!this.__smlUrl || /\/sml-dev\/v1\//.test(String(this.__smlUrl))) return;
        if (this.status >= 400 && this.status !== 401 && this.status !== 403) push({ kind: 'fetch', message: 'HTTP ' + this.status + ' ' + path(this.__smlUrl), target: String(this.__smlUrl), status: this.status });
        else if (this.status === 0 && this.readyState === 4) push({ kind: 'fetch', message: 'network: xhr failed ' + path(this.__smlUrl), target: String(this.__smlUrl), status: 0 });
      });
      return O.apply(this, arguments);
    };
  }

  /* ---- Web Vitals (sampled) ---- */
  var V = { longTasks: 0 }, vitalsSent = false;
  if (sampled && 'PerformanceObserver' in window) {
    try { new PerformanceObserver(function (l) { var e = l.getEntries(); if (e.length) V.lcp = Math.round(e[e.length - 1].startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (_) {}
    try { var cls = 0; new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) cls += e.value; }); V.cls = Math.round(cls * 1000) / 1000; }).observe({ type: 'layout-shift', buffered: true }); } catch (_) {}
    try { var inp = 0; new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.interactionId && e.duration > inp) inp = e.duration; }); if (inp) V.inp = Math.round(inp); }).observe({ type: 'event', buffered: true, durationThreshold: 40 }); } catch (_) {}
    try { new PerformanceObserver(function (l) { V.longTasks += l.getEntries().length; }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.name === 'first-contentful-paint') V.fcp = Math.round(e.startTime); }); }).observe({ type: 'paint', buffered: true }); } catch (_) {}
  }
  function vitals() {
    if (vitalsSent || !sampled) return; vitalsSent = true;
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) { V.ttfb = Math.round(nav.responseStart); V.domMs = Math.round(nav.domContentLoadedEventEnd); V.loadMs = Math.round(nav.loadEventEnd || 0); V.transfer = nav.transferSize || 0; }
      V.resources = performance.getEntriesByType('resource').length;
    } catch (_) {}
    V.kind = 'vitals'; push(V);
  }

  /* ---- a light accessibility count, one sampled view in ten, after the page settles ---- */
  function a11y() {
    if (!sampled || Math.random() > 0.1) return;
    try {
      var btn = 0, img = 0;
      Array.prototype.forEach.call(document.querySelectorAll('button, [role="button"]'), function (b) { if (!(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && !b.title && b.offsetWidth > 0) btn++; });
      Array.prototype.forEach.call(document.images, function (i) { if (!i.alt && !i.getAttribute('aria-hidden') && i.getAttribute('role') !== 'presentation' && i.width > 40 && i.height > 40) img++; });
      if (btn || img) push({ kind: 'a11y', message: (btn ? btn + ' buttons without a name' : '') + (btn && img ? ', ' : '') + (img ? img + ' images without alt text' : ''), count: 1 });
    } catch (_) {}
  }
  if (document.readyState === 'complete') setTimeout(a11y, 3000); else window.addEventListener('load', function () { setTimeout(a11y, 3000); });

  function leave() { vitals(); flush(true); }
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  /* long sessions (live streams, the terminal) still report their vitals once */
  setTimeout(function () { vitals(); flush(); }, 20000);
})();
