/* StockMarketLoop read-only market relay client.
 * One EventSource per symbol is shared by every chart/widget on the page.
 * The public relay is license-gated server-side; when it is disabled or down,
 * callers receive an offline status and keep their existing WordPress source. */
(function () {
  'use strict';
  if (window.SMLMarketRelay) return;
  var API = String(window.SML_MARKET_RELAY_URL || 'https://sml-platform-api.onrender.com').replace(/\/$/, '');
  var feeds = {};
  function clean(value) { var symbol = String(value || '').toUpperCase(); return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol) ? symbol : ''; }
  function emit(feed, kind, data) {
    feed.lastAt = Date.now(); feed.live = true;
    feed.listeners.slice().forEach(function (listener) { try { if (listener[kind]) listener[kind](data); } catch (_) {} });
    try { window.dispatchEvent(new CustomEvent('sml:market-' + kind.replace(/^on/, '').toLowerCase(), { detail: { symbol: feed.symbol, data: data } })); } catch (_) {}
  }
  function status(feed, value) { feed.live = value === 'live'; feed.listeners.slice().forEach(function (listener) { try { if (listener.onStatus) listener.onStatus(value); } catch (_) {} }); }
  function open(feed) {
    if (feed.source || !window.EventSource) return;
    var source;
    try { source = new EventSource(API + '/market-data/stream?symbol=' + encodeURIComponent(feed.symbol)); } catch (_) { status(feed, 'offline'); return; }
    feed.source = source;
    source.addEventListener('snapshot', function (event) { try { emit(feed, 'onSnapshot', JSON.parse(event.data)); } catch (_) {} });
    source.addEventListener('trade', function (event) { try { emit(feed, 'onTrade', JSON.parse(event.data)); } catch (_) {} });
    source.addEventListener('quote', function (event) { try { emit(feed, 'onQuote', JSON.parse(event.data)); } catch (_) {} });
    source.onopen = function () { status(feed, 'live'); };
    source.onerror = function () { status(feed, 'offline'); };
  }
  function subscribe(symbolRaw, listener) {
    var symbol = clean(symbolRaw); if (!symbol) return function () {};
    var feed = feeds[symbol] || (feeds[symbol] = { symbol: symbol, source: null, listeners: [], live: false, lastAt: 0 });
    feed.listeners.push(listener || {}); open(feed);
    return function () { var i = feed.listeners.indexOf(listener); if (i >= 0) feed.listeners.splice(i, 1); if (!feed.listeners.length && feed.source) { feed.source.close(); feed.source = null; feed.live = false; } };
  }
  function history(symbolRaw, timeframe, signal) {
    var symbol = clean(symbolRaw); if (!symbol) return Promise.reject(new TypeError('invalid_symbol'));
    return fetch(API + '/market-data/candles?symbol=' + encodeURIComponent(symbol) + '&tf=' + encodeURIComponent(timeframe || '5m'), { headers: { Accept: 'application/json' }, signal: signal }).then(function (response) { if (!response.ok) throw new Error('relay_' + response.status); return response.json(); });
  }
  function isLive(symbolRaw) { var feed = feeds[clean(symbolRaw)]; return !!(feed && feed.live && Date.now() - feed.lastAt < 60000); }
  window.SMLMarketRelay = { subscribe: subscribe, history: history, isLive: isLive, api: API };
}());
