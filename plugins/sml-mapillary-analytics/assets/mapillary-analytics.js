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

  function message(panel, title, body, action) {
    var content = panel.querySelector('[data-sml-mly-content]');
    content.innerHTML = '<div class="sml-mly-message"><strong>' + esc(title) + '</strong><span>' + esc(body) + '</span>' + (action || '') + '</div>';
  }

  function embedUrl(imageId) {
    return 'https://www.mapillary.com/embed?map_style=Mapillary%20streets&image_key=' + encodeURIComponent(imageId) + '&style=split';
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
      message(panel, 'Mapillary connection required', 'Add a Mapillary client token to enable inline street imagery.', setup);
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
          message(panel, 'No nearby street imagery', 'Mapillary does not currently have a public capture near this map coordinate.');
          return;
        }
        var captured = data.image.captured_at ? new Date(Number(data.image.captured_at)).toLocaleDateString() : '';
        var distance = Number(data.image.distance_m) || 0;
        panel.querySelector('[data-sml-mly-content]').innerHTML = '<iframe title="Mapillary street imagery near ' + esc(options.label || 'selected location') + '" src="' + esc(embedUrl(data.image.id)) + '" loading="eager" allow="fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
          '<div class="sml-mly-meta"><span>Nearest public capture' + (distance ? ' &middot; ' + distance.toLocaleString() + ' m away' : '') + '</span>' + (captured ? '<span>Captured ' + esc(captured) + '</span>' : '') + '</div>';
      })
      .catch(function (error) {
        if (!current || current.panel !== panel || !panel.isConnected) { return; }
        message(panel, 'Street imagery unavailable', error && error.message ? error.message : 'Mapillary could not be loaded.');
      });
  }

  window.SMLMapillary = { open: open, close: close, configured: !!cfg.configured };
  window.dispatchEvent(new CustomEvent('sml-mapillary-ready'));
}());
