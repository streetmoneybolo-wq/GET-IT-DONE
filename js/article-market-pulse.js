/* StockMarketLoop permanent alert articles — verified live market module. */
(function () {
  'use strict';
  if (window.__smlArticleMarketPulse) return;
  window.__smlArticleMarketPulse = true;

  var root = document.querySelector('.sml-alert-report');
  if (!root) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char];
    });
  }

  function ticker() {
    var explicit = root.getAttribute('data-symbol') || '';
    var tickerLink = root.querySelector('.sml-ticker-link');
    var linked = tickerLink ? (tickerLink.textContent || '') : '';
    var title = (document.querySelector('h1.wp-block-post-title') || {}).textContent || '';
    var match = (explicit || linked || title).match(/\$?([A-Z][A-Z0-9.\-]{0,9})/);
    return match ? match[1].toUpperCase() : '';
  }

  var symbol = ticker();
  if (!symbol) return;

  function money(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });
  }

  function compact(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function api(path) {
    return fetch('/wp-json/sml/v1/' + path, { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('market data unavailable');
      return response.json();
    });
  }

  function validBars(payload) {
    return (payload && Array.isArray(payload.bars) ? payload.bars : []).filter(function (bar) {
      return bar && isFinite(Number(bar.t)) && isFinite(Number(bar.c)) && isFinite(Number(bar.v));
    }).slice(-120);
  }

  function sample(rows, limit) {
    if (rows.length <= limit) return rows;
    var result = [];
    var step = (rows.length - 1) / (limit - 1);
    for (var i = 0; i < limit; i++) result.push(rows[Math.round(i * step)]);
    return result;
  }

  function graph(rows) {
    var bars = sample(rows, 90);
    if (bars.length < 2) return '';
    var closes = bars.map(function (bar) { return Number(bar.c); });
    var volumes = bars.map(function (bar) { return Math.max(0, Number(bar.v) || 0); });
    var low = Math.min.apply(Math, closes);
    var high = Math.max.apply(Math, closes);
    var span = Math.max(high - low, Math.abs(high || 1) * 0.002);
    var maxVolume = Math.max.apply(Math, volumes) || 1;
    var last = bars.length - 1;
    var points = closes.map(function (price, index) {
      var x = index * (800 / last);
      var y = 18 + ((high - price) / span) * 204;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var up = closes[last] >= closes[0];
    var color = up ? '#38F58A' : '#FF4D67';
    var volumeBars = volumes.map(function (volume, index) {
      var width = Math.max(2, 760 / bars.length);
      var height = Math.max(2, (volume / maxVolume) * 74);
      var x = index * (800 / last) - width / 2;
      return '<rect x="' + x.toFixed(1) + '" y="' + (80 - height).toFixed(1) + '" width="' + width.toFixed(1) + '" height="' + height.toFixed(1) + '" rx="1" />';
    }).join('');
    return '<div class="sml-pulse-graphs">' +
      '<div class="sml-pulse-graph sml-pulse-price-graph"><span>INTRADAY PRICE</span><svg viewBox="0 0 800 240" role="img" aria-label="Verified intraday $' + esc(symbol) + ' price graph">' +
      '<defs><linearGradient id="sml-pulse-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".42"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="sml-pulse-grid"><path d="M0 55H800M0 120H800M0 185H800"/></g>' +
      '<polygon points="' + points.join(' ') + ' 800,238 0,238" fill="url(#sml-pulse-fill)"/>' +
      '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg><b>' + money(low) + ' LOW</b><b>' + money(high) + ' HIGH</b></div>' +
      '<div class="sml-pulse-graph sml-pulse-volume-graph"><span>INTRADAY VOLUME</span><svg viewBox="0 0 800 82" role="img" aria-label="Verified intraday $' + esc(symbol) + ' volume graph"><g fill="' + color + '" opacity=".72">' + volumeBars + '</g></svg></div>' +
      '</div>';
  }

  function logo(company) {
    var website = String(company && company.website || '').match(/^https?:\/\/([^/]+)/i);
    return website
      ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(website[1]) + '&sz=128'
      : 'https://stockmarketloop-loop-kick.onrender.com/api/logo/' + encodeURIComponent(symbol);
  }

  var mount = root.querySelector('[data-sml-market-pulse]');
  if (!mount) {
    mount = document.createElement('section');
    mount.className = 'sml-live-market';
    mount.setAttribute('data-sml-market-pulse', '');
    mount.setAttribute('data-symbol', symbol);
    mount.setAttribute('aria-label', 'Live $' + symbol + ' price action');
    var table = root.querySelector('table');
    if (table) table.insertAdjacentElement('afterend', mount);
    else (root.querySelector('.sml-dek') || root.firstElementChild).insertAdjacentElement('afterend', mount);
  }

  function waiting() {
    mount.innerHTML = '<div class="sml-pulse-loading"><i></i><strong>Loading verified $' + esc(symbol) + ' market data</strong><span>Price and graph data come from StockMarketLoop market endpoints.</span></div>';
  }

  function unavailable() {
    mount.classList.add('is-unavailable');
    mount.innerHTML = '<div class="sml-pulse-unavailable"><strong>Live $' + esc(symbol) + ' data is temporarily unavailable.</strong><span>No substitute or sample figures are shown.</span><a href="/stock-chart/?symbol=' + encodeURIComponent(symbol) + '">Open the full $' + esc(symbol) + ' terminal →</a></div>';
  }

  function render(quote, history, company) {
    var bars = validBars(history);
    if ((!quote || !isFinite(Number(quote.current))) && bars.length < 2) return unavailable();
    var current = quote && isFinite(Number(quote.current)) ? Number(quote.current) : Number(bars[bars.length - 1].c);
    var pct = quote && isFinite(Number(quote.percentChange)) ? Number(quote.percentChange) : 0;
    var up = pct >= 0;
    var delayed = Boolean(quote && (quote.stale || /delayed/i.test(String(quote.quality || ''))));
    var companyName = String(company && company.name || symbol);
    var asOf = Number(quote && quote.timestamp || history && history.asOf || Date.now());
    mount.classList.remove('is-unavailable');
    mount.classList.toggle('is-down', !up);
    mount.innerHTML = '<div class="sml-pulse-head">' +
      '<div class="sml-pulse-company"><span class="sml-pulse-logo"><img src="' + esc(logo(company)) + '" alt="' + esc(companyName) + ' logo"><b>' + esc(symbol.slice(0, 2)) + '</b></span><span><em>LIVE PRICE ACTION</em><strong>$' + esc(symbol) + '</strong><small>' + esc(companyName) + '</small></span></div>' +
      '<div class="sml-pulse-price"><strong>' + money(current) + '</strong><span class="' + (up ? 'sml-up' : 'sml-down') + '">' + (up ? '+' : '') + pct.toFixed(2) + '% ' + (up ? '▲' : '▼') + '</span></div>' +
      '<span class="sml-pulse-status ' + (delayed ? 'is-delayed' : '') + '"><i></i>' + (delayed ? 'DELAYED' : 'LIVE') + '</span></div>' +
      '<div class="sml-pulse-stats">' +
      '<div><span>OPEN</span><b>' + money(quote && quote.open) + '</b></div>' +
      '<div><span>HIGH</span><b>' + money(quote && quote.high) + '</b></div>' +
      '<div><span>LOW</span><b>' + money(quote && quote.low) + '</b></div>' +
      '<div><span>VOLUME</span><b>' + compact(quote && quote.volume) + '</b></div>' +
      '<div><span>VWAP</span><b>' + money(quote && quote.vwap) + '</b></div></div>' +
      graph(bars) +
      '<div class="sml-pulse-foot"><span>Verified market snapshot · ' + esc(new Date(asOf).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) + '</span><a href="/stock-chart/?symbol=' + encodeURIComponent(symbol) + '">OPEN FULL-SCREEN $' + esc(symbol) + ' CHART →</a></div>';
    var image = mount.querySelector('img');
    if (image) image.onerror = function () { image.style.display = 'none'; };
  }

  function load() {
    return Promise.allSettled([
      api('quote?symbol=' + encodeURIComponent(symbol)),
      api('history?symbol=' + encodeURIComponent(symbol) + '&interval=1m&range=1d'),
      api('company2?symbol=' + encodeURIComponent(symbol))
    ]).then(function (results) {
      render(results[0].status === 'fulfilled' ? results[0].value : null,
        results[1].status === 'fulfilled' ? results[1].value : null,
        results[2].status === 'fulfilled' ? results[2].value : null);
    }).catch(unavailable);
  }

  waiting();
  load();
  setInterval(function () { if (!document.hidden) load(); }, 120000);
}());
