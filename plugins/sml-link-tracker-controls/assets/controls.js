/* SML Link Tracker Controls: click map and per-link access rules.
 * Adds a "Map and access rules" button to every tracker card the Link Intelligence Tracker draws.
 * MapLibre is loaded only when a user opens a click map. */
(function () {
  'use strict';
  var cfg = window.SML_LINK_TRACKER_CONTROLS || {};
  var api = cfg.rest || '/wp-json/sml-intel/v1';
  if (window.__smlLcBooted) { return; }
  window.__smlLcBooted = true;

  var TOPO = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js';
  var WORLD = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';

  /* ISO 3166-1 alpha-2 to the numeric ids world-atlas uses, so blocked countries can be shaded */
  var NUM = { US: '840', GB: '826', CA: '124', AU: '036', NZ: '554', IE: '372', DE: '276', FR: '250', ES: '724', IT: '380', PT: '620', NL: '528', BE: '056', CH: '756', AT: '040', SE: '752', NO: '578', DK: '208', FI: '246', PL: '616', CZ: '203', RO: '642', UA: '804', RU: '643', TR: '792', GR: '300', IL: '376', SA: '682', AE: '784', EG: '818', ZA: '710', NG: '566', KE: '404', GH: '288', MA: '504', IN: '356', PK: '586', BD: '050', LK: '144', CN: '156', TW: '158', JP: '392', KR: '410', MY: '458', ID: '360', TH: '764', VN: '704', PH: '608', MX: '484', BR: '076', AR: '032', CL: '152', CO: '170', PE: '604', VE: '862', JM: '388', TT: '780', HT: '332', DO: '214' };

  var panels = {};          // link id -> state
  var world = null;         // { countries } once loaded, or false if it could not load
  var mapLibrePromise = null;
  var mapLibreLoadError = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function req(path, opts) {
    opts = opts || {};
    return fetch(api + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce || '' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { throw new Error(d.message || 'Request failed'); }
        return d;
      });
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = resolve; s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* The world outline comes from two small files on a CDN (a topojson reader and the country shapes). If either cannot load,
     the map still works on a plain latitude and longitude grid. */
  function loadWorld() {
    if (world !== null) { return Promise.resolve(world); }
    return loadScript(TOPO)
      .then(function () { return fetch(WORLD).then(function (r) { if (!r.ok) { throw new Error('map data'); } return r.json(); }); })
      .then(function (data) {
        if (!window.topojson) { throw new Error('map libs'); }
        world = { countries: window.topojson.feature(data, data.objects.countries) };
        return world;
      })
      .catch(function () { world = false; return world; });
  }

  function loadMapLibrary() {
    if (window.maplibregl && window.maplibregl.Map) { return Promise.resolve(); }
    if (window.__smlMapLibrePromise) {
      mapLibrePromise = window.__smlMapLibrePromise;
      return mapLibrePromise.catch(function () { mapLibreLoadError = true; return loadWorld(); });
    }
    if (mapLibrePromise) { return mapLibrePromise; }
    mapLibrePromise = new Promise(function (resolve, reject) {
      var css = document.querySelector('link[data-sml-maplibre-css]');
      if (!css) {
        css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css';
        css.setAttribute('data-sml-maplibre-css', '1');
        document.head.appendChild(css);
      }
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js';
      s.async = true;
      s.onload = function () { window.maplibregl && window.maplibregl.Map ? resolve() : reject(new Error('MapLibre did not initialize')); };
      s.onerror = function () { reject(new Error('MapLibre could not load')); };
      document.head.appendChild(s);
    });
    window.__smlMapLibrePromise = mapLibrePromise;
    return mapLibrePromise.catch(function () { mapLibreLoadError = true; return loadWorld(); });
  }

  /* Natural Earth projection (Savric 2011), small enough to carry here instead of a charting library. */
  function naturalEarth(lng, lat) {
    var l = lng * Math.PI / 180, f = lat * Math.PI / 180, f2 = f * f, f4 = f2 * f2;
    return [
      l * (0.8707 - 0.131979 * f2 + f4 * (-0.013791 + f4 * (0.003971 * f2 - 0.001529 * f4))),
      f * (1.007226 + f2 * (0.015085 + f4 * (-0.044475 + 0.028874 * f2 - 0.005916 * f4)))
    ];
  }
  var NE_X = naturalEarth(180, 0)[0], NE_Y = naturalEarth(0, 90)[1];
  var NE_W = 900, NE_H = Math.round(NE_W * NE_Y / NE_X);
  function neProject(c) {
    var p = naturalEarth(c[0], c[1]);
    return [(p[0] / NE_X + 1) / 2 * NE_W, (1 - p[1] / NE_Y) / 2 * NE_H];
  }

  function ringPath(ring) {
    var d = '', prev = null;
    for (var i = 0; i < ring.length; i++) {
      var xy = neProject(ring[i]);
      // a jump of more than half the world means the shape crosses the date line: start a new stroke instead of drawing across the map
      var jump = prev !== null && Math.abs(ring[i][0] - prev) > 180;
      d += (i === 0 || jump ? 'M' : 'L') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
      prev = ring[i][0];
    }
    return d + 'Z';
  }
  function featurePath(f) {
    var g = f.geometry; if (!g) { return ''; }
    var polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
    return polys.map(function (poly) { return poly.map(ringPath).join(''); }).join('');
  }

  function place(p) { return [p.city, p.region, p.country || p.cc].filter(Boolean).join(', ') || 'Unknown location'; }

  /* ---------- map ---------- */

  function drawMap(host, st) {
    if (!mapLibreLoadError && window.maplibregl && window.maplibregl.Map) {
      drawMapLibre(host, st);
      return;
    }
    var pts = (st.map.points || []).filter(function (p) { return p.lat != null && p.lng != null; });
    var blockedCountries = {};
    (st.rules || []).forEach(function (r) { if (r.rule_type === 'country' && NUM[r.value]) { blockedCountries[NUM[r.value]] = true; } });
    var everyone = (st.rules || []).some(function (r) { return r.rule_type === 'all'; });

    var W, H, proj, land = '';
    if (world) {
      W = NE_W; H = NE_H;
      proj = function (c) { return neProject(c); };
      land = '<rect width="' + W + '" height="' + H + '" fill="#06101b"></rect>'
        + world.countries.features.map(function (f) {
            var blocked = everyone || blockedCountries[String(f.id).padStart(3, '0')];
            return '<path d="' + featurePath(f) + '" fill="' + (blocked ? 'rgba(255,86,110,.3)' : '#12243a') + '" stroke="#1f3a58" stroke-width=".5"></path>';
          }).join('');
    } else {
      W = 900; H = 450;
      proj = function (c) { return [(c[0] + 180) / 360 * W, (90 - c[1]) / 180 * H]; };
      var g = '';
      for (var lo = -180; lo <= 180; lo += 30) { g += '<line x1="' + proj([lo, 0])[0] + '" y1="0" x2="' + proj([lo, 0])[0] + '" y2="' + H + '" stroke="#16283f"></line>'; }
      for (var la = -60; la <= 60; la += 30) { g += '<line x1="0" y1="' + proj([0, la])[1] + '" x2="' + W + '" y2="' + proj([0, la])[1] + '" stroke="#16283f"></line>'; }
      land = '<rect width="' + W + '" height="' + H + '" fill="#08121f" stroke="#1f3a58"></rect>' + g;
    }

    var maxN = pts.reduce(function (m, p) { return Math.max(m, p.clicks, p.blocked); }, 1);
    function rad(n) { return n <= 0 ? 0 : 4 + 16 * Math.sqrt(n / maxN); }
    var dots = pts.map(function (p, i) {
      var xy = proj([p.lng, p.lat]);
      if (!xy || isNaN(xy[0])) { return ''; }
      var out = '';
      if (p.blocked > 0) { out += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + (rad(p.blocked) + 3) + '" fill="rgba(255,86,110,.22)" stroke="#ff566e" stroke-width="1.5" data-i="' + i + '"></circle>'; }
      if (p.clicks > 0) { out += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + rad(p.clicks) + '" fill="rgba(35,240,143,.55)" stroke="#23f08f" data-i="' + i + '"></circle>'; }
      return out;
    }).join('');

    host.innerHTML = '<div class="sml-lc-maptools"><button type="button" data-map-zoom="in" aria-label="Zoom in">+</button><button type="button" data-map-zoom="out" aria-label="Zoom out">−</button><button type="button" data-map-zoom="reset">Reset</button><span>Scroll to zoom · drag to move</span></div><div class="sml-lc-mapwrap"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="World map of clicks">' + land + dots + '</svg>'
      + '<div class="sml-lc-tip" hidden></div></div>'
      + '<div class="sml-lc-legend"><span><i class="g"></i>Clicks that went through</span><span><i class="r"></i>Blocked attempts</span>'
      + (everyone ? '<span class="sml-lc-warn">Everyone is blocked on this link</span>' : '') + '</div>'
      + (mapLibreLoadError ? '<p class="sml-lc-note">The interactive map library could not load. Showing the lightweight outline map instead.</p>' : '')
      + (world === false ? '<p class="sml-lc-note">The world outline could not load, so this shows a plain grid. The dots are still in the right places.</p>' : '');

    var tip = host.querySelector('.sml-lc-tip'), wrap = host.querySelector('.sml-lc-mapwrap');
    var svg = wrap.querySelector('svg'), zoom = 1, panX = 0, panY = 0, drag = null;
    function applyView() { svg.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')'; }
    host.querySelectorAll('[data-map-zoom]').forEach(function (b) { b.addEventListener('click', function () { var a=b.getAttribute('data-map-zoom'); zoom=a==='reset'?1:Math.max(1,Math.min(5,zoom*(a==='in'?1.25:.8))); if(a==='reset'){panX=0;panY=0;} applyView(); }); });
    wrap.addEventListener('wheel', function(e){ e.preventDefault(); zoom=Math.max(1,Math.min(5,zoom*(e.deltaY<0?1.12:.89))); applyView(); }, {passive:false});
    wrap.addEventListener('pointerdown',function(e){if(e.target.closest('circle'))return;drag={x:e.clientX-panX,y:e.clientY-panY};wrap.setPointerCapture(e.pointerId);});
    wrap.addEventListener('pointermove',function(e){if(drag){panX=e.clientX-drag.x;panY=e.clientY-drag.y;applyView();}});
    wrap.addEventListener('pointerup',function(){drag=null;});
    host.querySelectorAll('circle[data-i]').forEach(function (c) {
      var point = pts[Number(c.getAttribute('data-i'))];
      c.setAttribute('tabindex', '0'); c.setAttribute('role', 'button');
      c.setAttribute('aria-label', place(point) + '. View Mapillary street imagery.');
      c.addEventListener('mousemove', function (e) {
        var p = pts[Number(c.getAttribute('data-i'))], b = wrap.getBoundingClientRect();
        tip.hidden = false;
        tip.innerHTML = '<b>' + esc(place(p)) + '</b><br>' + p.clicks + ' click' + (p.clicks === 1 ? '' : 's') + (p.blocked ? ' · ' + p.blocked + ' blocked' : '');
        tip.style.left = Math.min(b.width - 190, Math.max(4, e.clientX - b.left + 12)) + 'px';
        tip.style.top = Math.max(4, e.clientY - b.top + 12) + 'px';
      });
      c.addEventListener('mouseleave', function () { tip.hidden = true; });
      function showStreet() {
        var p = pts[Number(c.getAttribute('data-i'))];
        if (!p || !window.SMLMapillary || typeof window.SMLMapillary.open !== 'function') { return; }
        window.SMLMapillary.open({ host: host, marker: c, lat: Number(p.lat), lng: Number(p.lng), label: place(p) });
      }
      c.addEventListener('click', showStreet);
      c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showStreet(); } });
    });
  }

  function drawMapLibre(host, st) {
    var pts = (st.map.points || []).filter(function (p) {
      var lat = Number(p.lat), lng = Number(p.lng);
      return p.lat != null && p.lng != null && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 85.0511 && Math.abs(lng) <= 180;
    }).map(function (p) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [Number(p.lng), Number(p.lat)] }, properties: {
        clicks: Math.max(0, Number(p.clicks) || 0), blocked: Math.max(0, Number(p.blocked) || 0), place: place(p)
      } };
    });
    if (host._smlStreetMarker) { host._smlStreetMarker.remove(); host._smlStreetMarker = null; }
    if (host._smlMap) { host._smlMap.remove(); host._smlMap = null; }
    host.innerHTML = '<div class="sml-lc-maplibre" role="application" aria-label="Interactive map of all-time link clicks"></div>'
      + '<div class="sml-lc-legend"><span><i class="g"></i>Clicks that went through</span><span><i class="r"></i>Blocked attempts</span></div>'
      + '<p class="sml-lc-map-note" aria-live="polite">Loading map tiles…</p>';
    var mapHost = host.querySelector('.sml-lc-maplibre');
    var note = host.querySelector('.sml-lc-map-note');
    var map = new maplibregl.Map({
      container: mapHost,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [0, 20], zoom: 1.35, minZoom: 1, maxZoom: 18,
      attributionControl: true, cooperativeGestures: true, renderWorldCopies: false
    });
    host._smlMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    var mapLoaded = false, fallbackStarted = false, fallbackTimer;
    function fallbackToOutline() {
      if (fallbackStarted || !host.isConnected || host._smlMap !== map) { return; }
      fallbackStarted = true;
      window.clearTimeout(fallbackTimer);
      if (host._smlStreetMarker) { host._smlStreetMarker.remove(); host._smlStreetMarker = null; }
      map.remove(); host._smlMap = null; mapLibreLoadError = true;
      // Show a usable grid immediately. The optional country outline may load
      // slowly or fail on a CDN, so it must never hold the fallback hostage.
      drawMap(host, st);
      loadWorld().then(function () {
        if (host.isConnected && !host._smlMap) { drawMap(host, st); }
      });
    }
    // A style can load while its vector tiles are still failing. Keep the
    // timeout active until at least one basemap feature has actually rendered.
    fallbackTimer = window.setTimeout(fallbackToOutline, 10000);
    map.on('load', function () {
      mapLoaded = true;
      map.addSource('sml-click-points', {
        type: 'geojson', data: { type: 'FeatureCollection', features: pts },
        cluster: pts.length > 120, clusterRadius: 42, clusterMaxZoom: 8,
        clusterProperties: { clicks: ['+', ['get', 'clicks']], blocked: ['+', ['get', 'blocked']] }
      });
      map.addLayer({ id: 'sml-click-clusters', type: 'circle', source: 'sml-click-points', filter: ['has', 'point_count'], paint: {
        'circle-color': '#159b66', 'circle-opacity': 0.88, 'circle-stroke-color': '#9affca', 'circle-stroke-width': 1.5,
        'circle-radius': ['interpolate', ['linear'], ['+', ['get', 'clicks'], ['get', 'blocked']], 1, 14, 100, 24, 1000, 34]
      } });
      map.addLayer({ id: 'sml-click-cluster-count', type: 'symbol', source: 'sml-click-points', filter: ['has', 'point_count'], layout: {
        'text-field': ['to-string', ['+', ['get', 'clicks'], ['get', 'blocked']]], 'text-size': 12, 'text-font': ['Noto Sans Bold']
      }, paint: { 'text-color': '#ffffff' } });
      map.addLayer({ id: 'sml-click-blocked', type: 'circle', source: 'sml-click-points', filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'blocked'], 0]], paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'blocked'], 1, 7, 100, 18, 1000, 28],
        'circle-color': '#ff566e', 'circle-opacity': 0.12, 'circle-stroke-color': '#ff566e', 'circle-stroke-opacity': 0.95, 'circle-stroke-width': 2
      } });
      map.addLayer({ id: 'sml-click-human', type: 'circle', source: 'sml-click-points', filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'clicks'], 0]], paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'clicks'], 1, 6, 100, 16, 1000, 26],
        'circle-color': '#23c982', 'circle-opacity': 0.58, 'circle-stroke-color': '#a4ffd5', 'circle-stroke-opacity': 0.95, 'circle-stroke-width': 1.5
      } });
      note.textContent = pts.length ? 'Click a marker to inspect this location.' : 'No located clicks are available for this link yet.';
      if (pts.length) {
        var bounds = new maplibregl.LngLatBounds();
        pts.forEach(function (f) { bounds.extend(f.geometry.coordinates); });
        map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: 0 });
      }
      function inspectPoint(e) {
        var feature = e.features && e.features[0];
        if (!feature) { return; }
        if (feature.properties.cluster) {
          map.getSource('sml-click-points').getClusterExpansionZoom(feature.properties.cluster_id).then(function (zoom) {
            map.easeTo({ center: feature.geometry.coordinates, zoom: zoom });
          }).catch(function () {});
          return;
        }
        var props = feature.properties, coords = feature.geometry.coordinates;
        var box = document.createElement('div'); box.className = 'sml-lc-mapinfo';
        var title = document.createElement('strong'); title.textContent = props.place; box.appendChild(title);
        var row = document.createElement('div'); row.textContent = Number(props.clicks).toLocaleString() + ' clicks · ' + Number(props.blocked).toLocaleString() + ' blocked attempts'; box.appendChild(row);
        var nearby = document.createElement('button'); nearby.type = 'button'; nearby.className = 'sml-lc-street'; nearby.textContent = 'View street imagery here'; box.appendChild(nearby);
        var popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' }).setLngLat(coords).setDOMContent(box).addTo(map);
        nearby.addEventListener('click', function () {
          if (!window.SMLMapillary || typeof window.SMLMapillary.open !== 'function') { return; }
          if (host._smlStreetMarker) { host._smlStreetMarker.remove(); }
          var markerElement = document.createElement('div'); markerElement.className = 'sml-mly-maplibre-dot';
          var selectedMarker = new maplibregl.Marker({ element: markerElement, anchor: 'center' }).setLngLat(coords).addTo(map);
          host._smlStreetMarker = selectedMarker;
          popup.remove();
          window.SMLMapillary.open({
            host: host, marker: markerElement, lat: Number(coords[1]), lng: Number(coords[0]), label: props.place,
            onClose: function () { if (host._smlStreetMarker === selectedMarker) { selectedMarker.remove(); host._smlStreetMarker = null; } }
          });
        });
      }
      ['sml-click-human', 'sml-click-blocked', 'sml-click-clusters'].forEach(function (layer) {
        map.on('click', layer, inspectPoint);
        map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
      });
    });
    map.on('idle', function () {
      if (!mapLoaded || fallbackStarted || !host.isConnected || host._smlMap !== map) { return; }
      var rendered = map.queryRenderedFeatures();
      var hasBasemap = rendered.some(function (feature) { return feature.source && feature.source !== 'sml-click-points'; });
      if (hasBasemap) {
        window.clearTimeout(fallbackTimer);
        if (note && note.isConnected) { note.remove(); }
      }
    });
    map.on('error', function (event) {
      if (note && note.isConnected) {
        note.textContent = 'Map tiles are taking longer than expected. Switching to the lightweight map if they do not load.';
      }
      // Avoid leaving a blank map when a style loads but its tiles do not.
      if (event && event.error && !mapLoaded) { window.setTimeout(fallbackToOutline, 10000); }
    });
  }

  /* ---------- sections ---------- */

  function ruleBlocked(st, type, value, cc) {
    return (st.rules || []).some(function (r) {
      if (r.rule_type === 'all') { return true; }
      return r.rule_type === type && String(r.value).toLowerCase() === String(value).toLowerCase() && (!cc || !r.country_code || r.country_code === cc);
    });
  }

  function whereTable(st) {
    var pts = st.map.points || [];
    var by = {};
    pts.forEach(function (p) {
      var k = p.cc || '??';
      var e = by[k] || (by[k] = { cc: p.cc, country: p.country || p.cc || 'Unknown', clicks: 0, blocked: 0, cities: {} });
      e.clicks += p.clicks; e.blocked += p.blocked;
      if (p.city) {
        var ck = p.city + '|' + p.region;
        var c = e.cities[ck] || (e.cities[ck] = { city: p.city, region: p.region, cc: p.cc, clicks: 0, blocked: 0 });
        c.clicks += p.clicks; c.blocked += p.blocked;
      }
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (b.clicks + b.blocked) - (a.clicks + a.blocked); }).slice(0, 12);
    if (!rows.length) { return '<p class="sml-lc-empty">No clicks in this period yet.</p>'; }
    return '<table class="sml-lc-table"><thead><tr><th>Where</th><th>Clicks</th><th>Blocked</th><th></th></tr></thead><tbody>' + rows.map(function (e) {
      var cities = Object.keys(e.cities).map(function (k) { return e.cities[k]; }).sort(function (a, b) { return b.clicks - a.clicks; }).slice(0, 3);
      var countryBtn = e.cc && !ruleBlocked(st, 'country', e.cc)
        ? '<button type="button" class="sml-lc-btn sml-lc-danger" data-lc-quick="country" data-v="' + esc(e.cc) + '">Block country</button>'
        : (e.cc ? '<span class="sml-lc-tag">Blocked</span>' : '');
      return '<tr><td><b>' + esc(e.country) + '</b>' + (cities.length ? '<div class="sml-lc-sub">' + cities.map(function (c) {
        var done = ruleBlocked(st, 'city', c.city, c.cc);
        return esc(c.city) + (done ? ' (blocked)' : ' <button type="button" class="sml-lc-link" data-lc-quick="city" data-v="' + esc(c.city) + '" data-cc="' + esc(c.cc) + '">block</button>');
      }).join(' · ') + '</div>' : '') + '</td><td>' + e.clicks + '</td><td>' + (e.blocked || '–') + '</td><td>' + countryBtn + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function recentList(st) {
    var rows = st.map.recent || [];
    if (!rows.length) { return '<p class="sml-lc-empty">No visits in this period yet.</p>'; }
    return '<div class="sml-lc-recent">' + rows.map(function (r) {
      var what = [r.device, r.platform, r.browser].filter(Boolean).join(' · ');
      var tag = r.status === 'blocked' ? '<span class="sml-lc-tag red">Blocked</span>' : (r.status === 'bot' ? '<span class="sml-lc-tag">Bot or preview</span>' : '<span class="sml-lc-tag green">Went through</span>');
      return '<div class="sml-lc-visit"><div><b>' + esc(place(r)) + '</b> ' + tag + '<div class="sml-lc-sub">' + esc(r.at) + ' · ' + esc(what || 'Unknown device') + '</div></div>'
        + (r.reason ? '<div class="sml-lc-guard-reason"><b>' + esc(r.layer || 'protection') + '</b>' + esc(r.reason) + '</div>' : '')
        + '<div class="sml-lc-acts"><button type="button" class="sml-lc-link" data-lc-visit="ip" data-src="' + r.source + '" data-id="' + r.id + '">Block this IP</button>'
        + '<button type="button" class="sml-lc-link" data-lc-visit="device" data-src="' + r.source + '" data-id="' + r.id + '">Block ' + esc(r.device || 'device') + 's</button></div></div>';
    }).join('') + '</div>';
  }

  function rulesBlock(st) {
    var list = (st.rules || []).length
      ? '<ul class="sml-lc-rules">' + st.rules.map(function (r) {
          return '<li><span><b>' + esc(r.label) + '</b><small>' + (r.hits ? r.hits + ' blocked' + (r.last_hit_at ? ' · last ' + esc(r.last_hit_at) : '') : 'Nothing blocked yet') + '</small></span>'
            + '<button type="button" class="sml-lc-btn" data-lc-remove="' + r.id + '">Remove</button></li>';
        }).join('') + '</ul>'
      : '<p class="sml-lc-empty">No rules. Everyone who has the link can use it.</p>';
    var types = [['country', 'Country'], ['region', 'State or region'], ['city', 'City'], ['device', 'Device type'], ['platform', 'Operating system'], ['browser', 'Browser'], ['ip', 'IP address or range'], ['all', 'Everyone']];
    return list
      + '<form class="sml-lc-add" data-lc-add><select name="rule_type" aria-label="What to block">' + types.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select>'
      + '<span data-lc-valuehost></span>'
      + '<input name="country_code" maxlength="2" placeholder="Country (optional)" aria-label="Limit to country" hidden>'
      + '<button type="submit" class="sml-lc-btn sml-lc-danger">Block</button></form>'
      + '<p class="sml-lc-note">Anyone who matches a rule sees &ldquo;This link can&rsquo;t be used in your region&rdquo; instead of the destination. Rules apply the moment you add them. Location comes from the visitor&rsquo;s IP address, so someone using a VPN can appear to be somewhere else.</p>';
  }

  var VALUE_FIELDS = {
    country: '<input name="value" placeholder="US, GB, IN or a country name" aria-label="Country">',
    region: '<input name="value" placeholder="State or region, for example Texas" aria-label="Region">',
    city: '<input name="value" placeholder="City, for example Atlanta" aria-label="City">',
    device: '<select name="value" aria-label="Device type"><option>mobile</option><option>desktop</option><option>tablet</option></select>',
    platform: '<select name="value" aria-label="Operating system"><option>Windows</option><option>macOS</option><option>iOS</option><option>Android</option><option>Linux</option></select>',
    browser: '<select name="value" aria-label="Browser"><option>Chrome</option><option>Safari</option><option>Firefox</option><option>Edge</option></select>',
    ip: '<input name="value" placeholder="203.0.113.5 or 203.0.113.0/24" aria-label="IP address or range">',
    all: '<input name="value" value="everyone" disabled aria-label="Everyone">'
  };

  function syncForm(form) {
    var t = form.elements.rule_type.value;
    form.querySelector('[data-lc-valuehost]').innerHTML = VALUE_FIELDS[t] || '';
    form.elements.country_code.hidden = !(t === 'region' || t === 'city');
  }

  /* ---------- panel ---------- */

  function render(id) {
    var st = panels[id];
    var el = st.el;
    if (st.error) { el.innerHTML = '<p class="sml-lc-err">' + esc(st.error) + '</p>'; return; }
    var m = st.map, t = m.totals;
    el.innerHTML = '<div class="sml-lc-head"><div class="sml-lc-stats"><span><b>' + t.clicks + '</b> clicks</span><span><b>' + t.blocked + '</b> blocked</span>'
      + (t.unlocated ? '<span><b>' + t.unlocated + '</b> without a location</span>' : '') + '</div>'
      + '<select data-lc-days aria-label="Time period"><option value="all"' + (m.period === 'all' ? ' selected' : '') + '>All time</option>' + [7, 30, 90, 365].map(function (d) { return '<option value="' + d + '"' + (d === m.days ? ' selected' : '') + '>Last ' + d + ' days</option>'; }).join('') + '</select></div>'
      + (st.flash ? '<div class="sml-lc-flash">' + esc(st.flash) + '</div>' : '')
      + '<div data-lc-map></div>'
      + '<h4>Where clicks come from</h4>' + whereTable(st)
      + '<h4>Recent visits</h4>' + recentList(st)
      + '<h4>Protection and monitoring</h4>' + monitoringBlock(st)
      + '<h4>Who is blocked</h4>' + rulesBlock(st);
    drawMap(el.querySelector('[data-lc-map]'), st);
    var form = el.querySelector('[data-lc-add]');
    if (form) { syncForm(form); }
  }

  function monitoringBlock(st) {
    var m=st.monitor||{};
    return '<form class="sml-lc-monitor" data-lc-monitor><fieldset class="sml-lc-guard"><legend>Protection layers</legend><label>Protection mode<select name="protection_mode"><option value="standard" '+(m.protection_mode==='standard'?'selected':'')+'>Standard · manual rules</option><option value="balanced" '+(m.protection_mode!=='standard'&&m.protection_mode!=='strict'?'selected':'')+'>Balanced · rules + rate controls</option><option value="strict" '+(m.protection_mode==='strict'?'selected':'')+'>Strict · rate controls + verification</option></select></label><div class="sml-lc-monitor-grid">'
      + '<label>Rate window (minutes)<input type="number" name="rate_window" min="1" max="60" value="'+esc(m.rate_window||10)+'"></label>'
      + '<label>Per-IP request limit<input type="number" name="ip_limit" min="5" value="'+esc(m.ip_limit||60)+'"></label>'
      + '<label>Per-network request limit<input type="number" name="network_limit" min="10" value="'+esc(m.network_limit||180)+'"></label>'
      + '<label>Fingerprint request limit<input type="number" name="fingerprint_limit" min="5" value="'+esc(m.fingerprint_limit||90)+'"></label></div>'
      + '<label><input type="checkbox" name="challenge_enabled" '+(Number(m.challenge_enabled)?'checked':'')+'> Require signed browser verification</label>'
      + '<label><input type="checkbox" name="block_bots" '+(Number(m.block_bots)?'checked':'')+'> Block detected bots and link-preview clients</label>'
      + '<p class="sml-lc-note">Balanced mode blocks malformed and excessive requests. Strict mode also requires JavaScript verification and blocks detected bots. The bot switch adds that denial to Balanced mode and can stop Discord or social preview cards.</p></fieldset>'
      + '<label><input type="checkbox" name="enabled" '+(Number(m.enabled)?'checked':'')+'> Email me about unusual activity on this link</label><div class="sml-lc-monitor-grid">'
      + '<label>Window (minutes)<input type="number" name="window_minutes" min="1" max="60" value="'+esc(m.window_minutes||10)+'"></label>'
      + '<label>Click burst threshold<input type="number" name="click_threshold" min="5" value="'+esc(m.click_threshold||40)+'"></label>'
      + '<label>Bot/preview threshold<input type="number" name="bot_threshold" min="1" value="'+esc(m.bot_threshold||15)+'"></label>'
      + '<label>Blocked attempt threshold<input type="number" name="blocked_threshold" min="1" value="'+esc(m.blocked_threshold||10)+'"></label>'
      + '<label>Repeated device threshold<input type="number" name="repeat_threshold" min="3" value="'+esc(m.repeat_threshold||12)+'"></label></div><button class="sml-lc-btn" type="submit">Save monitoring</button></form>'
      + '<div class="sml-lc-alerts"><b>Recent alerts</b>'+(st.alerts&&st.alerts.length?st.alerts.map(function(a){return '<p>'+esc(a.message)+' <small>'+esc(a.created_at)+'</small></p>';}).join(''):'<p class="sml-lc-empty">No activity alerts recorded.</p>')+'</div>';
  }

  function refresh(id, days) {
    var st = panels[id];
    st.el.innerHTML = st.map ? st.el.innerHTML : '<p class="sml-lc-empty">Loading…</p>';
    return Promise.all([
      req('/links/' + id + '/map?' + (days === 'all' || (!days && (!st.map || st.map.period === 'all')) ? 'period=all' : 'days=' + (days || (st.map && st.map.days) || 30))),
      req('/links/' + id + '/access'),
      req('/links/' + id + '/monitoring'),
      loadMapLibrary()
    ]).then(function (r) { st.map = r[0]; st.rules = r[1].rules || []; st.monitor=r[2].settings; st.alerts=r[2].alerts||[]; st.error = ''; render(id); })
      .catch(function (e) { st.error = e.message; render(id); });
  }

  function flash(id, msg) {
    var st = panels[id]; st.flash = msg; render(id);
    setTimeout(function () { if (st.flash === msg) { st.flash = ''; render(id); } }, 4000);
  }

  function addRule(id, body, confirmText) {
    if (confirmText && !window.confirm(confirmText)) { return Promise.resolve(); }
    return req('/links/' + id + '/access', { method: 'POST', body: body }).then(function (r) {
      return refresh(id).then(function () { flash(id, r.already ? 'That rule already exists.' : 'Blocked: ' + r.rule.label + '. It is live now.'); });
    }).catch(function (e) { flash(id, e.message); });
  }

  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-lc-open]');
    if (open) {
      var id = open.getAttribute('data-lc-open');
      var card = open.closest('[data-link-id]');
      var host = card && card.querySelector('[data-lc-panel]');
      if (!host) { return; }
      if (!host.hidden) { host.hidden = true; open.textContent = 'Map and access rules'; return; }
      host.hidden = false; open.textContent = 'Hide map and access rules';
      panels[id] = panels[id] || { el: host, rules: [], map: null, flash: '' };
      panels[id].el = host;
      refresh(id);
      return;
    }
    var panel = e.target.closest('[data-lc-panel]');
    if (!panel) { return; }
    var pid = panel.getAttribute('data-lc-panel');
    var q = e.target.closest('[data-lc-quick]');
    if (q) {
      var type = q.getAttribute('data-lc-quick'), v = q.getAttribute('data-v');
      addRule(pid, { rule_type: type, value: v, country_code: q.getAttribute('data-cc') || '' }, 'Block everyone in ' + v + (type === 'city' ? ' (city)' : '') + ' from using this link?');
      return;
    }
    var vis = e.target.closest('[data-lc-visit]');
    if (vis) {
      var what = vis.getAttribute('data-lc-visit');
      addRule(pid, { rule_type: what, source: vis.getAttribute('data-src'), source_id: Number(vis.getAttribute('data-id')) },
        what === 'ip' ? 'Block this visitor\'s IP address from using this link?' : 'Block this device type from using this link?');
      return;
    }
    var rm = e.target.closest('[data-lc-remove]');
    if (rm) {
      req('/links/' + pid + '/access/' + rm.getAttribute('data-lc-remove') + '/delete', { method: 'POST', body: {} })
        .then(function () { return refresh(pid); }).then(function () { flash(pid, 'Rule removed.'); })
        .catch(function (err) { flash(pid, err.message); });
    }
  });

  document.addEventListener('change', function (e) {
    var panel = e.target.closest('[data-lc-panel]');
    if (!panel) { return; }
    var pid = panel.getAttribute('data-lc-panel');
    if (e.target.matches('[data-lc-days]')) { refresh(pid, e.target.value === 'all' ? 'all' : Number(e.target.value)); return; }
    if (e.target.name === 'rule_type' && e.target.form && e.target.form.hasAttribute('data-lc-add')) { syncForm(e.target.form); }
  });

  document.addEventListener('submit', function (e) {
    var monitor=e.target.closest('[data-lc-monitor]');
    if(monitor){e.preventDefault();var mp=monitor.closest('[data-lc-panel]'),mid=mp.getAttribute('data-lc-panel');var body={enabled:monitor.elements.enabled.checked?1:0,window_minutes:Number(monitor.elements.window_minutes.value),click_threshold:Number(monitor.elements.click_threshold.value),bot_threshold:Number(monitor.elements.bot_threshold.value),blocked_threshold:Number(monitor.elements.blocked_threshold.value),repeat_threshold:Number(monitor.elements.repeat_threshold.value),protection_mode:monitor.elements.protection_mode.value,rate_window:Number(monitor.elements.rate_window.value),ip_limit:Number(monitor.elements.ip_limit.value),network_limit:Number(monitor.elements.network_limit.value),fingerprint_limit:Number(monitor.elements.fingerprint_limit.value),challenge_enabled:monitor.elements.challenge_enabled.checked?1:0,block_bots:monitor.elements.block_bots.checked?1:0};req('/links/'+mid+'/monitoring',{method:'POST',body:body}).then(function(r){var st=panels[mid];st.monitor=r.settings;st.alerts=r.alerts||[];render(mid);flash(mid,'Protection and monitoring settings saved.');}).catch(function(err){flash(mid,err.message);});return;}
    var form = e.target.closest('[data-lc-add]');
    if (!form) { return; }
    e.preventDefault();
    var panel = form.closest('[data-lc-panel]');
    var pid = panel.getAttribute('data-lc-panel');
    var type = form.elements.rule_type.value;
    var body = { rule_type: type, value: form.elements.value ? form.elements.value.value : '', country_code: form.elements.country_code.value || '' };
    addRule(pid, body, type === 'all' ? 'Block everyone from using this link? Nobody will be able to reach the destination until you remove this rule.' : '');
  });

  /* ---------- hook into the tracker's cards ---------- */

  function enhance(card) {
    if (card.getAttribute('data-lc') === '1') { return; }
    var id = card.getAttribute('data-link-id');
    if (!id) { return; }
    var after = card.querySelector('[data-load-analytics]');
    if (!after) { return; }
    card.setAttribute('data-lc', '1');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sml-lit-secondary sml-lc-open';
    btn.setAttribute('data-lc-open', id);
    btn.textContent = 'Map and access rules';
    after.parentNode.insertBefore(btn, after.nextSibling);
    var host = document.createElement('div');
    host.className = 'sml-lc-panel';
    host.setAttribute('data-lc-panel', id);
    host.hidden = true;
    btn.parentNode.insertBefore(host, btn.nextSibling);
  }

  function scan(root) {
    (root || document).querySelectorAll('.sml-lit-card[data-link-id]').forEach(enhance);
  }

  function start() {
    scan();
    new MutationObserver(function () { scan(); }).observe(document.body, { childList: true, subtree: true });
  }
  window.SMLLinkTrackerControls = window.SMLLinkTrackerControls || {};
  window.SMLLinkTrackerControls.renderAllTimeMap = function (host, id) {
    if (!host) { return; }
    host.innerHTML='<p class="sml-lc-empty">Loading all-time click map…</p>';
    Promise.all([req('/links/'+encodeURIComponent(id)+'/map?period=all'),req('/links/'+encodeURIComponent(id)+'/access'),loadMapLibrary()]).then(function(r){
      var st={map:r[0],rules:r[1].rules||[]};
      host.innerHTML='<h4>All-time click map</h4><div class="sml-lc-stats"><span><b>'+st.map.totals.clicks+'</b> clicks</span><span><b>'+st.map.totals.blocked+'</b> blocked</span></div><div data-alltime-map></div>';
      drawMap(host.querySelector('[data-alltime-map]'),st);
    }).catch(function(e){host.innerHTML='<p class="sml-lc-err">'+esc(e.message)+'</p>';});
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
