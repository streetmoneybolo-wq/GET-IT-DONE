/* SML creator realtime presence — aggregate-only, first-party heartbeat. */
(function () {
  'use strict';
  if (window.__smlCreatorPresenceBooted) return;
  window.__smlCreatorPresenceBooted = true;

  var cfg = window.SML_CREATOR_PRESENCE || {};
  if (!cfg.endpoint || !cfg.context) return;

  /* One canonical creator-view event for every supported creator page. The
     server supplies the identity; the browser never infers it from markup.
     Use gtag directly so a GTM custom-event listener cannot double count it. */
  function trackCreatorView(attempt) {
    if (window.__smlCreatorAttributionSent) return;
    var handle = String(cfg.creatorHandle || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    var kind = String(cfg.contentKind || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    var contentId = String(cfg.contentId || '').slice(0, 100);
    if (!handle || !kind) return;
    if (typeof window.gtag !== 'function') {
      if ((attempt || 0) < 120) {
        document.documentElement.setAttribute('data-sml-creator-attribution', 'waiting');
        window.setTimeout(function () { trackCreatorView((attempt || 0) + 1); }, 500);
      } else {
        document.documentElement.setAttribute('data-sml-creator-attribution', 'unavailable');
      }
      return;
    }
    window.gtag('event', 'sml_creator_view', {
      creator_handle: handle,
      content_kind: kind,
      content_id: contentId,
      page_location: window.location.href,
      transport_type: 'beacon'
    });
    window.__smlCreatorAttributionSent = true;
    document.documentElement.setAttribute('data-sml-creator-attribution', 'sent');
  }

  function randomToken() {
    var bytes = new Uint8Array(24);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var out = '';
    for (var j = 0; j < bytes.length; j++) out += ('0' + bytes[j].toString(16)).slice(-2);
    return out;
  }

  var key = 'sml_creator_presence_visitor_v1';
  var visitor = '';
  try {
    visitor = window.localStorage.getItem(key) || '';
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(visitor)) {
      visitor = randomToken();
      window.localStorage.setItem(key, visitor);
    }
  } catch (e) {
    visitor = randomToken();
  }

  function beat() {
    if (document.hidden || !navigator.onLine) return;
    fetch(cfg.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: cfg.context, visitor: visitor })
    }).catch(function () {});
  }

  trackCreatorView(0);
  beat();
  window.setInterval(beat, Math.max(30000, Number(cfg.interval) || 40000));
  document.addEventListener('visibilitychange', function () { if (!document.hidden) beat(); });
  window.addEventListener('online', beat);
})();
