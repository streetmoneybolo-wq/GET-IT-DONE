(function () {
  'use strict';

  var cfg = window.SML_MAPILLARY_ANALYTICS || {};
  var current = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char];
    });
  }

  function close() {
    if (!current) { return; }
    if (current.marker && current.marker.classList) { current.marker.classList.remove('sml-mly-selected'); }
    if (typeof current.onClose === 'function') { try { current.onClose(); } catch (error) {} }
    if (current.panel && current.panel.parentNode) { current.panel.parentNode.removeChild(current.panel); }
    current = null;
  }

  function embedUrl(imageId) {
    return 'https://www.mapillary.com/embed?map_style=Mapillary%20streets&image_key=' + encodeURIComponent(imageId) + '&style=split';
  }

  function googleEmbedUrl(lat, lng) {
    return 'https://maps.google.com/maps?q=' + encodeURIComponent(lat.toFixed(6) + ',' + lng.toFixed(6)) + '&z=17&output=embed';
  }

  function googleFallback(panel, options, reason, action) {
    var lat = Number(options.lat), lng = Number(options.lng);
    var content = panel.querySelector('[data-sml-mly-content]');
    var eyebrow = panel.querySelector('header span');
    if (eyebrow) { eyebrow.textContent = 'GOOGLE MAPS BACKUP'; }
    content.innerHTML = '<div class="sml-mly-google-map"><iframe title="Google map backup near ' + esc(options.label || 'selected location') + '" src="' + esc(googleEmbedUrl(lat, lng)) + '" loading="eager" allow="fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><i class="sml-mly-google-dot" aria-hidden="true"></i></div>' +
      '<div class="sml-mly-google-note"><div><strong>Google Maps backup</strong><span>' + esc(reason) + '</span></div>' + (action || '') + '</div>';
  }

  function open(options) {
    options = options || {};
    var lat = Number(options.lat), lng = Number(options.lng);
    var host = options.host && options.host.nodeType === 1 ? options.host : null;
    if (!host || !isFinite(lat) || !isFinite(lng)) { return; }

    close();
    var panel = document.createElement('section');
    panel.className = 'sml-mly-panel';
    panel.setAttribute('aria-label', 'Mapillary street imagery');
    panel.innerHTML = '<header><div><span>MAPILLARY STREET IMAGERY</span><strong>' + esc(options.label || 'Selected location') + '</strong></div><button type="button" data-sml-mly-close aria-label="Close street imagery">&times;</button></header>' +
      '<div class="sml-mly-content" data-sml-mly-content><div class="sml-mly-loading"><i></i><span>Finding the nearest street capture...</span></div></div>' +
      '<footer>The analytics map and selected dot remain visible. Imagery is near the selected map coordinate and may not show a visitor\'s exact position.</footer>';
    host.insertAdjacentElement('afterend', panel);
    if (options.marker && options.marker.classList) { options.marker.classList.add('sml-mly-selected'); }
    current = { panel: panel, marker: options.marker || null, onClose: options.onClose || null };
    panel.querySelector('[data-sml-mly-close]').addEventListener('click', close);

    if (!cfg.configured) {
      var setup = cfg.isAdmin && cfg.settings ? '<a class="sml-mly-setup" href="' + esc(cfg.settings) + '">Connect Mapillary</a>' : '';
      googleFallback(panel, options, 'Mapillary is not connected. The selected coordinates are shown here without leaving StockMarketLoop.', setup);
      return;
    }

    var url = cfg.rest + (cfg.rest.indexOf('?') === -1 ? '?' : '&') + 'lat=' + encodeURIComponent(lat.toFixed(6)) + '&lng=' + encodeURIComponent(lng.toFixed(6));
    fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': cfg.nonce || '' } })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) { throw new Error(data.message || 'Mapillary is unavailable right now.'); }
          return data;
        });
      })
      .then(function (data) {
        if (!current || current.panel !== panel || !panel.isConnected) { return; }
        if (!data.available || !data.image || !data.image.id) {
          googleFallback(panel, options, 'Mapillary has no nearby public capture, so Google Maps is showing the selected coordinates.');
          return;
        }
        var captured = data.image.captured_at ? new Date(Number(data.image.captured_at)).toLocaleDateString() : '';
        var distance = Number(data.image.distance_m) || 0;
        panel.querySelector('[data-sml-mly-content]').innerHTML = '<iframe title="Mapillary street imagery near ' + esc(options.label || 'selected location') + '" src="' + esc(embedUrl(data.image.id)) + '" loading="eager" allow="fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
          '<div class="sml-mly-meta"><span>Nearest public capture' + (distance ? ' &middot; ' + distance.toLocaleString() + ' m away' : '') + '</span>' + (captured ? '<span>Captured ' + esc(captured) + '</span>' : '') + '</div>';
      })
      .catch(function (error) {
        if (!current || current.panel !== panel || !panel.isConnected) { return; }
        googleFallback(panel, options, (error && error.message ? error.message : 'Mapillary could not be loaded.') + ' Google Maps is showing the selected coordinates instead.');
      });
  }

  function delegatedTarget(event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-sml-mapillary-lat][data-sml-mapillary-lng]') : null;
    if (!target || (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')) { return; }
    if (event.type === 'keydown') { event.preventDefault(); }
    var host = target.closest('.ca-map, .sml-lt-map, [data-ca-geo-map]');
    if (!host) { return; }
    event.stopPropagation();
    open({
      host: host,
      marker: target,
      lat: Number(target.getAttribute('data-sml-mapillary-lat')),
      lng: Number(target.getAttribute('data-sml-mapillary-lng')),
      label: target.getAttribute('data-sml-mapillary-label') || target.getAttribute('aria-label') || 'Selected location'
    });
  }

  window.SMLMapillary = { open: open, close: close, configured: !!cfg.configured };
  document.addEventListener('click', delegatedTarget);
  document.addEventListener('keydown', delegatedTarget);
  window.dispatchEvent(new CustomEvent('sml-mapillary-ready'));
}());
