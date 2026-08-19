/* SML LoopCharts engine — the site's OWN canvas chart engine, extracted verbatim
   from the sml-massive-terminal plugin's inline booter (sml-loopcharts-inline-js-after,
   v1.0.4) so Terminal V2 can run it standalone. 14 intervals (1m..1Y), per-bar stats
   legend, EMA20/50 + Bollinger + VWAP, crosshair + keyboard inspection, live quote
   merge, 30s history refresh, accessible table. Mounts next to #sml-tv-chart.
   window.SMLLC_CONFIG must be set BEFORE this script runs (terminal-chart.js does). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SMLLoopChartsMath = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function finite(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeTimestamp(value) {
    var number = finite(value);
    if (number === null || number <= 0) return null;
    if (number > 1e17) number = Math.floor(number / 1e6); // nanoseconds -> ms
    else if (number > 1e14) number = Math.floor(number / 1e3); // microseconds -> ms
    else if (number < 1e11) number = Math.floor(number * 1000); // seconds -> ms
    return number;
  }

  function normalizeBar(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var time = normalizeTimestamp(raw.t !== undefined ? raw.t : raw.time);
    var open = finite(raw.o !== undefined ? raw.o : raw.open);
    var high = finite(raw.h !== undefined ? raw.h : raw.high);
    var low = finite(raw.l !== undefined ? raw.l : raw.low);
    var close = finite(raw.c !== undefined ? raw.c : raw.close);
    var volume = finite(raw.v !== undefined ? raw.v : raw.volume);
    if (time === null || open === null || high === null || low === null || close === null) return null;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
    return {
      t: time,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume !== null && volume >= 0 ? volume : 0,
      vw: finite(raw.vw),
      n: finite(raw.n),
      source: String(raw.source || ''),
      quality: String(raw.quality || '')
    };
  }

  function normalizeBars(input) {
    if (!Array.isArray(input)) return [];
    var byTime = new Map();
    input.forEach(function (raw) {
      var bar = normalizeBar(raw);
      if (bar) byTime.set(bar.t, bar);
    });
    return Array.from(byTime.values()).sort(function (a, b) { return a.t - b.t; });
  }

  function sma(bars, period, source) {
    var field = source || 'c';
    var out = new Array(bars.length).fill(null);
    var sum = 0;
    var valid = 0;
    var queue = [];
    for (var i = 0; i < bars.length; i += 1) {
      var value = finite(bars[i] && bars[i][field]);
      queue.push(value);
      if (value !== null) { sum += value; valid += 1; }
      if (queue.length > period) {
        var removed = queue.shift();
        if (removed !== null) { sum -= removed; valid -= 1; }
      }
      if (queue.length === period && valid === period) out[i] = sum / period;
    }
    return out;
  }

  function ema(bars, period, source) {
    var field = source || 'c';
    var out = new Array(bars.length).fill(null);
    if (!Number.isInteger(period) || period < 1) return out;
    var alpha = 2 / (period + 1);
    var seed = [];
    var previous = null;
    for (var i = 0; i < bars.length; i += 1) {
      var value = finite(bars[i] && bars[i][field]);
      if (value === null) continue;
      if (previous === null) {
        seed.push(value);
        if (seed.length === period) {
          previous = seed.reduce(function (sum, item) { return sum + item; }, 0) / period;
          out[i] = previous;
        }
      } else {
        previous = alpha * value + (1 - alpha) * previous;
        out[i] = previous;
      }
    }
    return out;
  }

  function bollinger(bars, period, multiplier) {
    var mid = sma(bars, period, 'c');
    var out = new Array(bars.length).fill(null);
    for (var i = period - 1; i < bars.length; i += 1) {
      if (mid[i] === null) continue;
      var sumSquares = 0;
      var valid = true;
      for (var j = i - period + 1; j <= i; j += 1) {
        var value = finite(bars[j] && bars[j].c);
        if (value === null) { valid = false; break; }
        sumSquares += Math.pow(value - mid[i], 2);
      }
      if (!valid) continue;
      var deviation = Math.sqrt(sumSquares / period); // population standard deviation
      out[i] = {
        m: mid[i],
        u: mid[i] + multiplier * deviation,
        l: mid[i] - multiplier * deviation
      };
    }
    return out;
  }

  function exchangeDateKey(timestamp, timeZone) {
    var formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(new Date(timestamp));
  }

  function vwap(bars, timeZone) {
    var out = new Array(bars.length).fill(null);
    var currentSession = '';
    var cumulativePriceVolume = 0;
    var cumulativeVolume = 0;
    for (var i = 0; i < bars.length; i += 1) {
      var bar = bars[i];
      var session = exchangeDateKey(bar.t, timeZone);
      if (session !== currentSession) {
        currentSession = session;
        cumulativePriceVolume = 0;
        cumulativeVolume = 0;
      }
      var volume = finite(bar.v);
      if (volume !== null && volume > 0) {
        var typical = (bar.h + bar.l + bar.c) / 3;
        cumulativePriceVolume += typical * volume;
        cumulativeVolume += volume;
      }
      out[i] = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null;
    }
    return out;
  }

  function timeframeMs(timeframe) {
    return {
      '1m': 60000,
      '3m': 180000,
      '5m': 300000,
      '10m': 600000,
      '15m': 900000,
      '30m': 1800000,
      '1h': 3600000,
      '2h': 7200000,
      '4h': 14400000,
      '1D': 86400000
    }[timeframe] || 300000;
  }

  function floorBucket(timestamp, timeframe) {
    var size = timeframeMs(timeframe);
    return Math.floor(timestamp / size) * size;
  }

  function mergeProvisionalQuote(bars, quote, timeframe) {
    var price = finite(quote && quote.current);
    var timestamp = normalizeTimestamp(quote && quote.timestamp);
    if (price === null || price <= 0 || timestamp === null) return bars.slice();
    if (Date.now() - timestamp > 120000) return bars.slice();
    var copy = bars.slice();
    var bucket = floorBucket(timestamp, timeframe);
    var last = copy.length ? copy[copy.length - 1] : null;
    if (last && floorBucket(last.t, timeframe) === bucket) {
      var updated = Object.assign({}, last);
      updated.h = Math.max(updated.h, price);
      updated.l = Math.min(updated.l, price);
      updated.c = price;
      updated.quality = last.quality === 'authoritative' ? 'mixed-current' : 'provisional';
      copy[copy.length - 1] = updated;
    } else if (!last || bucket > floorBucket(last.t, timeframe)) {
      copy.push({
        t: bucket,
        o: price,
        h: price,
        l: price,
        c: price,
        v: 0,
        vw: null,
        n: null,
        source: 'quote-poll',
        quality: 'provisional'
      });
    }
    return copy;
  }

  function demoBars(count, timeframe, endTime) {
    var total = Math.max(40, Number(count) || 240);
    var size = timeframeMs(timeframe);
    var end = floorBucket(endTime || Date.now(), timeframe);
    var bars = [];
    var close = 198.25;
    var seed = 73129;
    function random() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }
    for (var i = 0; i < total; i += 1) {
      var drift = Math.sin(i / 18) * 0.28 + (random() - 0.48) * 1.8;
      var open = close;
      close = Math.max(10, open + drift);
      var high = Math.max(open, close) + random() * 1.1;
      var low = Math.min(open, close) - random() * 1.1;
      bars.push({
        t: end - (total - 1 - i) * size,
        o: open,
        h: high,
        l: low,
        c: close,
        v: Math.round(220000 + random() * 1400000),
        vw: null,
        n: null,
        source: 'replay',
        quality: 'demo'
      });
    }
    return bars;
  }

  return {
    finite: finite,
    normalizeTimestamp: normalizeTimestamp,
    normalizeBar: normalizeBar,
    normalizeBars: normalizeBars,
    sma: sma,
    ema: ema,
    bollinger: bollinger,
    exchangeDateKey: exchangeDateKey,
    vwap: vwap,
    timeframeMs: timeframeMs,
    floorBucket: floorBucket,
    mergeProvisionalQuote: mergeProvisionalQuote,
    demoBars: demoBars
  };
}));

(function () {
  'use strict';

  var config = window.SMLLC_CONFIG || {};
  var Mathx = window.SMLLoopChartsMath;
  var oldSlot = document.getElementById('sml-tv-chart');
  if (!oldSlot || !Mathx || oldSlot.dataset.loopchartsMounted === '1') return;
  oldSlot.dataset.loopchartsMounted = '1';

  var symbol = String(config.symbol || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 15) || 'SPY';
  var timeframes = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M', '1Q', '1Y'];
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('sml_lc2_preferences') || '{}'); } catch (error) { saved = {}; }

  var state = {
    symbol: symbol,
    timeframe: timeframes.indexOf(saved.timeframe) >= 0 ? saved.timeframe : '5m',
    bars: [],
    source: 'loading',
    quality: '',
    from: 0,
    to: 0,
    follow: true,
    crosshair: null,
    indicators: Object.assign({ boll: true, ema20: true, ema50: false, vwap: false }, saved.indicators || {}),
    quote: null,
    loading: false,
    error: '',
    active: false
  };

  var stage = document.createElement('section');
  stage.className = 'sml-lc-stage';
  stage.hidden = true;
  stage.setAttribute('aria-label', symbol + ' StockMarketLoop chart');
  oldSlot.parentNode.insertBefore(stage, oldSlot);

  var shell = document.createElement('div');
  shell.className = 'sml-lc-shell';
  stage.appendChild(shell);

  var toolbar = document.createElement('div');
  toolbar.className = 'sml-lc-toolbar';
  shell.appendChild(toolbar);

  var symbolLabel = document.createElement('strong');
  symbolLabel.className = 'sml-lc-symbol';
  symbolLabel.textContent = '$' + symbol;
  toolbar.appendChild(symbolLabel);

  var timeframeGroup = document.createElement('div');
  timeframeGroup.className = 'sml-lc-timeframes';
  timeframeGroup.setAttribute('aria-label', 'Chart intervals');
  toolbar.appendChild(timeframeGroup);

  var indicatorGroup = document.createElement('div');
  indicatorGroup.className = 'sml-lc-indicators';
  indicatorGroup.setAttribute('aria-label', 'Chart indicators');
  toolbar.appendChild(indicatorGroup);

  var resetButton = makeButton('Reset', 'sml-lc-reset');
  toolbar.appendChild(resetButton);

  var sourceBadge = document.createElement('span');
  sourceBadge.className = 'sml-lc-source';
  sourceBadge.textContent = 'CONNECTING';
  toolbar.appendChild(sourceBadge);

  var legend = document.createElement('div');
  legend.className = 'sml-lc-legend';
  legend.setAttribute('aria-live', 'polite');
  shell.appendChild(legend);

  var canvasHost = document.createElement('div');
  canvasHost.className = 'sml-lc-canvas-host';
  canvasHost.tabIndex = 0;
  canvasHost.setAttribute('role', 'application');
  canvasHost.setAttribute('aria-label', 'Interactive candlestick chart. Use arrow keys to inspect bars, plus and minus to zoom, and Escape to clear the crosshair.');
  shell.appendChild(canvasHost);

  var baseCanvas = document.createElement('canvas');
  baseCanvas.className = 'sml-lc-canvas sml-lc-base';
  var interactionCanvas = document.createElement('canvas');
  interactionCanvas.className = 'sml-lc-canvas sml-lc-interaction';
  canvasHost.appendChild(baseCanvas);
  canvasHost.appendChild(interactionCanvas);

  var footer = document.createElement('div');
  footer.className = 'sml-lc-footer';
  shell.appendChild(footer);

  var statusText = document.createElement('span');
  statusText.className = 'sml-lc-status';
  statusText.textContent = 'Preparing chart engine…';
  footer.appendChild(statusText);

  var qualityText = document.createElement('span');
  qualityText.className = 'sml-lc-quality';
  footer.appendChild(qualityText);

  var accessibleTable = document.createElement('table');
  accessibleTable.className = 'sml-lc-sr-table';
  accessibleTable.innerHTML = '<caption>Visible chart values</caption><thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead><tbody></tbody>';
  shell.appendChild(accessibleTable);

  var baseContext = baseCanvas.getContext('2d');
  var interactionContext = interactionCanvas.getContext('2d');
  var width = 0;
  var height = 0;
  var pad = { left: 12, right: 72, top: 18, bottom: 32 };
  var volumeHeight = 86;
  var volumeRatio = (function () { var v = Number(saved && saved.volumeRatio); return (v >= 0.05 && v <= 0.65) ? v : 0.19; }()); /* candle/volume split — draggable divider */
  var dividerDrag = false;
  var priceBottom = 0;
  var yMin = 0;
  var yMax = 1;
  var lastVisible = [];
  var lastSpacing = 1;
  var dragging = false;
  var dragStartX = 0;
  var dragStartFrom = 0;
  var frameRequested = false;
  var historyController = null;
  var quoteTimer = null;
  var historyTimer = null;

  var resizeObserver = new ResizeObserver(function () {
    resizeCanvases();
    scheduleRender();
  });
  resizeObserver.observe(canvasHost);

  function makeButton(label, className) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className || '';
    button.textContent = label;
    return button;
  }

  function persistPreferences() {
    try {
      localStorage.setItem('sml_lc2_preferences', JSON.stringify({
        timeframe: state.timeframe,
        indicators: state.indicators,
        volumeRatio: volumeRatio
      }));
    } catch (error) { /* Storage can be disabled without breaking the chart. */ }
  }

  function rebuildToolbar() {
    timeframeGroup.replaceChildren();
    timeframes.forEach(function (timeframe) {
      var button = makeButton(timeframe);
      button.dataset.timeframe = timeframe;
      button.setAttribute('aria-pressed', timeframe === state.timeframe ? 'true' : 'false');
      button.addEventListener('click', function () {
        if (timeframe === state.timeframe || state.loading) return;
        state.timeframe = timeframe;
        persistPreferences();
        loadHistory(false);
      });
      timeframeGroup.appendChild(button);
    });

    indicatorGroup.replaceChildren();
    [
      ['boll', 'BOLL'],
      ['ema20', 'EMA20'],
      ['ema50', 'EMA50'],
      ['vwap', 'VWAP']
    ].forEach(function (entry) {
      var button = makeButton(entry[1]);
      button.dataset.indicator = entry[0];
      button.setAttribute('aria-pressed', state.indicators[entry[0]] ? 'true' : 'false');
      button.addEventListener('click', function () {
        state.indicators[entry[0]] = !state.indicators[entry[0]];
        persistPreferences();
        rebuildToolbar();
        scheduleRender();
      });
      indicatorGroup.appendChild(button);
    });
  }

  function endpoint(path, params) {
    var base = String(config.restRoot || '/wp-json/sml/v1/').replace(/\/?$/, '/');
    var url = new URL(path, new URL(base, window.location.origin));
    Object.keys(params || {}).forEach(function (key) { url.searchParams.set(key, params[key]); });
    return url.toString();
  }

  function setStatus(message, kind) {
    statusText.textContent = message;
    stage.dataset.status = kind || 'neutral';
  }

  function activateChart(source, quality) {
    state.active = true;
    state.source = source;
    state.quality = quality;
    stage.hidden = false;
    stage.classList.remove('sml-lc-waiting');
    oldSlot.hidden = true;
    oldSlot.setAttribute('aria-hidden', 'true');
    sourceBadge.textContent = source === 'replay' ? 'ADMIN DEMO' : 'MASSIVE';
    sourceBadge.dataset.source = source;
    qualityText.textContent = quality === 'demo' ? 'Demonstration data — not market data' : 'Authoritative history; live bar reconciles automatically';
    resizeCanvases();
    scheduleRender();
  }

  function showWaiting(message) {
    state.active = false;
    oldSlot.hidden = false;
    oldSlot.removeAttribute('aria-hidden');
    if (config.canConfigure) {
      stage.hidden = false;
      stage.classList.add('sml-lc-waiting');
      sourceBadge.textContent = 'SETUP REQUIRED';
      setStatus(message, 'warning');
      qualityText.textContent = 'The existing chart remains active until verified data is available.';
    } else {
      stage.hidden = true;
    }
  }

  function loadHistory(refresh) {
    if (historyController) historyController.abort();
    historyController = new AbortController();
    state.loading = true;
    state.error = '';
    setStatus(refresh ? 'Refreshing authoritative candles…' : 'Loading authoritative candles…', 'loading');
    rebuildToolbar();

    fetch(endpoint('history', { symbol: symbol, tf: state.timeframe }), {
      credentials: 'same-origin',
      signal: historyController.signal,
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (!response.ok) throw new Error('History request returned ' + response.status);
      return response.json();
    }).then(function (payload) {
      var bars = Mathx.normalizeBars(payload && payload.bars);
      if (bars.length >= 2) {
        var wasFollowing = state.follow || state.to >= state.bars.length - 2;
        state.bars = bars;
        if (!refresh || wasFollowing) {
          state.to = bars.length;
          state.from = Math.max(0, state.to - defaultVisibleCount());
          state.follow = true;
        } else {
          state.to = Math.min(state.to, bars.length);
          state.from = Math.min(state.from, Math.max(0, state.to - 10));
        }
        activateChart(payload.source || 'massive-rest', payload.quality || 'authoritative');
        setStatus('Connected · ' + bars.length.toLocaleString() + ' candles', 'ready');
        updateAccessibleTable();
      } else if (config.demo) {
        state.bars = Mathx.demoBars(260, state.timeframe, Date.now());
        state.to = state.bars.length;
        state.from = Math.max(0, state.to - defaultVisibleCount());
        state.follow = true;
        activateChart('replay', 'demo');
        setStatus('Admin preview · deterministic replay', 'demo');
        updateAccessibleTable();
      } else {
        var code = payload && payload.error && payload.error.code;
        var message = code === 'missing_api_key'
          ? 'LoopCharts is ready. Add the Massive API key to enable authoritative candles.'
          : 'LoopCharts is waiting for verified market candles.';
        showWaiting(message);
      }
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return;
      state.error = error && error.message ? error.message : 'History request failed';
      if (config.demo) {
        state.bars = Mathx.demoBars(260, state.timeframe, Date.now());
        state.to = state.bars.length;
        state.from = Math.max(0, state.to - defaultVisibleCount());
        state.follow = true;
        activateChart('replay', 'demo');
        setStatus('Admin preview · data route unavailable', 'demo');
      } else {
        showWaiting('LoopCharts could not verify its history feed. The existing chart remains active.');
      }
    }).finally(function () {
      state.loading = false;
      rebuildToolbar();
    });
  }

  function pollQuote() {
    fetch(endpoint('quote', { symbol: symbol }), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (!response.ok) throw new Error('Quote request returned ' + response.status);
      return response.json();
    }).then(function (quote) {
      var price = Mathx.finite(quote && quote.current);
      state.quote = quote;
      if (state.active && state.quality !== 'demo' && price !== null && !/^1[WMQY]$/.test(state.timeframe)) {
        var beforeLength = state.bars.length;
        state.bars = Mathx.mergeProvisionalQuote(state.bars, quote, state.timeframe);
        if (state.follow && state.bars.length !== beforeLength) {
          state.to = state.bars.length;
          state.from = Math.max(0, state.to - defaultVisibleCount());
        }
        scheduleRender();
      }
    }).catch(function () {
      if (state.active && state.quality !== 'demo') setStatus('History connected · live quote temporarily unavailable', 'warning');
    }).finally(function () {
      quoteTimer = window.setTimeout(pollQuote, 5000);
    });
  }

  function defaultVisibleCount() {
    return state.timeframe === '1D' ? 140 : 120;
  }

  function resetView() {
    state.to = state.bars.length;
    state.from = Math.max(0, state.to - defaultVisibleCount());
    state.follow = true;
    state.crosshair = null;
    scheduleRender();
  }

  function resizeCanvases() {
    if (stage.hidden || stage.classList.contains('sml-lc-waiting')) return;
    var rect = canvasHost.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(360, rect.height);
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    [baseCanvas, interactionCanvas].forEach(function (canvas) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function scheduleRender() {
    if (frameRequested || !state.active) return;
    frameRequested = true;
    requestAnimationFrame(function () {
      frameRequested = false;
      render();
    });
  }

  function computeIndicators() {
    return {
      boll: state.indicators.boll ? Mathx.bollinger(state.bars, 20, 2) : null,
      ema20: state.indicators.ema20 ? Mathx.ema(state.bars, 20, 'c') : null,
      ema50: state.indicators.ema50 ? Mathx.ema(state.bars, 50, 'c') : null,
      vwap: state.indicators.vwap ? Mathx.vwap(state.bars, 'America/New_York') : null
    };
  }

  function render() {
    if (!width || !height || !state.bars.length) return;
    baseContext.clearRect(0, 0, width, height);
    interactionContext.clearRect(0, 0, width, height);

    var from = Math.max(0, Math.min(state.from, state.bars.length - 1));
    var to = Math.max(from + 1, Math.min(state.to, state.bars.length));
    state.from = from;
    state.to = to;
    var bars = state.bars.slice(from, to);
    lastVisible = bars;

    pad.right = width < 560 ? 58 : 72;
    volumeHeight = Math.max(24, Math.min(height * 0.65, height * volumeRatio));
    priceBottom = height - pad.bottom - volumeHeight - 18;
    var plotWidth = Math.max(1, width - pad.left - pad.right);
    var indicators = computeIndicators();
    var low = Infinity;
    var high = -Infinity;
    bars.forEach(function (bar, offset) {
      low = Math.min(low, bar.l);
      high = Math.max(high, bar.h);
      var absolute = from + offset;
      if (indicators.boll && indicators.boll[absolute]) {
        low = Math.min(low, indicators.boll[absolute].l);
        high = Math.max(high, indicators.boll[absolute].u);
      }
      ['ema20', 'ema50', 'vwap'].forEach(function (key) {
        if (indicators[key] && indicators[key][absolute] !== null) {
          low = Math.min(low, indicators[key][absolute]);
          high = Math.max(high, indicators[key][absolute]);
        }
      });
    });
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    var range = high - low || Math.max(high * 0.01, 1);
    yMin = low - range * 0.08;
    yMax = high + range * 0.08;
    lastSpacing = plotWidth / bars.length;

    drawBackground();
    drawGrid(low, high);
    drawVolume(bars, plotWidth);
    if (indicators.boll) drawBollinger(indicators.boll, from, bars.length);
    drawCandles(bars);
    if (indicators.ema20) drawLine(indicators.ema20, from, bars.length, '#f5a623', 1.6);
    if (indicators.ema50) drawLine(indicators.ema50, from, bars.length, '#4da3ff', 1.6);
    if (indicators.vwap) drawLine(indicators.vwap, from, bars.length, '#b77cff', 1.5);
    drawTimeAxis(bars);
    drawCurrentPrice();
    drawCrosshair();
    updateLegend();
    window.dispatchEvent(new CustomEvent('sml:loopcharts-render', { detail: {
      symbol: state.symbol,
      timeframe: state.timeframe,
      bars: bars.map(function (bar) { return { t: bar.t, h: bar.h }; }),
      host: canvasHost,
      padLeft: pad.left,
      spacing: lastSpacing,
      priceBottom: priceBottom
    } }));
  }

  function priceY(price) {
    return pad.top + (yMax - price) / (yMax - yMin || 1) * (priceBottom - pad.top);
  }

  function barX(index) {
    return pad.left + index * lastSpacing + lastSpacing / 2;
  }

  function drawBackground() {
    baseContext.fillStyle = '#0b1018';
    baseContext.fillRect(0, 0, width, height);
    baseContext.fillStyle = '#0d1420';
    baseContext.fillRect(pad.left, priceBottom + 18, width - pad.left - pad.right, volumeHeight);
  }

  function niceStep(range, target) {
    var rough = range / Math.max(2, target);
    var power = Math.pow(10, Math.floor(Math.log10(rough)));
    var normalized = rough / power;
    var factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    return factor * power;
  }

  function drawGrid(low, high) {
    var step = niceStep(high - low, 6);
    var start = Math.ceil(low / step) * step;
    baseContext.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    baseContext.textAlign = 'left';
    baseContext.textBaseline = 'middle';
    for (var value = start; value <= high + step; value += step) {
      var y = priceY(value);
      if (y < pad.top || y > priceBottom) continue;
      baseContext.strokeStyle = 'rgba(139, 148, 158, 0.14)';
      baseContext.beginPath();
      baseContext.moveTo(pad.left, Math.round(y) + 0.5);
      baseContext.lineTo(width - pad.right, Math.round(y) + 0.5);
      baseContext.stroke();
      baseContext.fillStyle = '#8f9baa';
      baseContext.fillText(formatPrice(value), width - pad.right + 7, y);
    }
  }

  function drawCandles(bars) {
    var bodyWidth = Math.max(1, Math.min(12, lastSpacing * 0.68));
    bars.forEach(function (bar, index) {
      var x = barX(index);
      var openY = priceY(bar.o);
      var closeY = priceY(bar.c);
      var color = bar.c >= bar.o ? '#24c875' : '#ff4d61';
      baseContext.strokeStyle = color;
      baseContext.fillStyle = color;
      baseContext.beginPath();
      baseContext.moveTo(Math.round(x) + 0.5, priceY(bar.h));
      baseContext.lineTo(Math.round(x) + 0.5, priceY(bar.l));
      baseContext.stroke();
      baseContext.fillRect(x - bodyWidth / 2, Math.min(openY, closeY), bodyWidth, Math.max(1, Math.abs(closeY - openY)));
    });
  }

  function drawVolume(bars, plotWidth) {
    var maxVolume = bars.reduce(function (max, bar) { return Math.max(max, bar.v || 0); }, 0) || 1;
    var baseY = height - pad.bottom;
    var available = volumeHeight - 8;
    var barWidth = Math.max(1, Math.min(12, lastSpacing * 0.68));
    bars.forEach(function (bar, index) {
      var h = (bar.v || 0) / maxVolume * available;
      baseContext.fillStyle = bar.c >= bar.o ? 'rgba(36,200,117,.55)' : 'rgba(255,77,97,.55)';
      baseContext.fillRect(barX(index) - barWidth / 2, baseY - h, barWidth, h);
    });
    baseContext.strokeStyle = 'rgba(139,148,158,.2)';
    baseContext.beginPath();
    baseContext.moveTo(pad.left, priceBottom + 9.5);
    baseContext.lineTo(pad.left + plotWidth, priceBottom + 9.5);
    baseContext.stroke();
  }

  function drawLine(series, from, count, color, lineWidth) {
    baseContext.beginPath();
    var started = false;
    for (var offset = 0; offset < count; offset += 1) {
      var value = series[from + offset];
      if (value === null || !Number.isFinite(value)) { started = false; continue; }
      var x = barX(offset);
      var y = priceY(value);
      if (!started) { baseContext.moveTo(x, y); started = true; }
      else baseContext.lineTo(x, y);
    }
    baseContext.strokeStyle = color;
    baseContext.lineWidth = lineWidth || 1;
    baseContext.stroke();
    baseContext.lineWidth = 1;
  }

  function drawBollinger(series, from, count) {
    baseContext.beginPath();
    var started = false;
    var validOffsets = [];
    for (var offset = 0; offset < count; offset += 1) {
      var value = series[from + offset];
      if (!value) continue;
      validOffsets.push(offset);
      if (!started) { baseContext.moveTo(barX(offset), priceY(value.u)); started = true; }
      else baseContext.lineTo(barX(offset), priceY(value.u));
    }
    for (var i = validOffsets.length - 1; i >= 0; i -= 1) {
      var lowerOffset = validOffsets[i];
      baseContext.lineTo(barX(lowerOffset), priceY(series[from + lowerOffset].l));
    }
    if (validOffsets.length) {
      baseContext.closePath();
      baseContext.fillStyle = 'rgba(77,163,255,.055)';
      baseContext.fill();
    }
    drawLine(series.map(function (value) { return value ? value.u : null; }), from, count, '#2de36f', 2);
    drawLine(series.map(function (value) { return value ? value.m : null; }), from, count, '#f1f5f9', 1.5);
    drawLine(series.map(function (value) { return value ? value.l : null; }), from, count, '#ff354f', 2);
  }

  function drawTimeAxis(bars) {
    var labels = Math.max(2, Math.min(6, Math.floor((width - pad.right) / 130)));
    baseContext.font = '11px system-ui, sans-serif';
    baseContext.fillStyle = '#8f9baa';
    baseContext.textAlign = 'center';
    baseContext.textBaseline = 'bottom';
    for (var i = 0; i < labels; i += 1) {
      var index = Math.round(i * (bars.length - 1) / Math.max(1, labels - 1));
      var x = barX(index);
      baseContext.fillText(formatTime(bars[index].t), x, height - 4);
      baseContext.strokeStyle = 'rgba(139,148,158,.08)';
      baseContext.beginPath();
      baseContext.moveTo(Math.round(x) + 0.5, pad.top);
      baseContext.lineTo(Math.round(x) + 0.5, priceBottom);
      baseContext.stroke();
    }
  }

  function drawCurrentPrice() {
    var price = Mathx.finite(state.quote && state.quote.current);
    if (price === null && state.bars.length) price = state.bars[state.bars.length - 1].c;
    if (price === null || price < yMin || price > yMax) return;
    var y = priceY(price);
    baseContext.save();
    baseContext.setLineDash([4, 4]);
    baseContext.strokeStyle = '#f3a53a';
    baseContext.beginPath();
    baseContext.moveTo(pad.left, y);
    baseContext.lineTo(width - pad.right, y);
    baseContext.stroke();
    baseContext.restore();
    baseContext.fillStyle = '#f3a53a';
    baseContext.fillRect(width - pad.right, y - 9, pad.right, 18);
    baseContext.fillStyle = '#111827';
    baseContext.font = 'bold 11px ui-monospace, monospace';
    baseContext.textAlign = 'center';
    baseContext.textBaseline = 'middle';
    baseContext.fillText(formatPrice(price), width - pad.right / 2, y);
  }

  function drawCrosshair() {
    interactionContext.clearRect(0, 0, width, height);
    if (!state.crosshair || !lastVisible.length) return;
    var index = Math.max(0, Math.min(lastVisible.length - 1, Math.round((state.crosshair.x - pad.left - lastSpacing / 2) / lastSpacing)));
    var x = barX(index);
    var y = Math.max(pad.top, Math.min(priceBottom, state.crosshair.y));
    interactionContext.save();
    interactionContext.setLineDash([3, 3]);
    interactionContext.strokeStyle = 'rgba(203,213,225,.62)';
    interactionContext.beginPath();
    interactionContext.moveTo(x, pad.top);
    interactionContext.lineTo(x, height - pad.bottom);
    interactionContext.moveTo(pad.left, y);
    interactionContext.lineTo(width - pad.right, y);
    interactionContext.stroke();
    interactionContext.restore();

    interactionContext.fillStyle = '#182131';
    interactionContext.fillRect(width - pad.right, y - 9, pad.right, 18);
    interactionContext.fillStyle = '#e5edf7';
    interactionContext.font = '11px ui-monospace, monospace';
    interactionContext.textAlign = 'center';
    interactionContext.textBaseline = 'middle';
    var pointedPrice = yMax - (y - pad.top) / (priceBottom - pad.top) * (yMax - yMin);
    interactionContext.fillText(formatPrice(pointedPrice), width - pad.right / 2, y);
  }

  function selectedBar() {
    if (!state.crosshair || !lastVisible.length) return state.bars[state.bars.length - 1] || null;
    var index = Math.max(0, Math.min(lastVisible.length - 1, Math.round((state.crosshair.x - pad.left - lastSpacing / 2) / lastSpacing)));
    return lastVisible[index];
  }

  function updateLegend() {
    var bar = selectedBar();
    if (!bar) { legend.textContent = 'No candle data'; return; }
    var direction = bar.c >= bar.o ? 'up' : 'down';
    legend.dataset.direction = direction;
    legend.textContent = formatFullTime(bar.t) + '   O ' + formatPrice(bar.o) + '   H ' + formatPrice(bar.h) + '   L ' + formatPrice(bar.l) + '   C ' + formatPrice(bar.c) + '   Vol ' + formatCompact(bar.v);
  }

  function updateAccessibleTable() {
    var body = accessibleTable.querySelector('tbody');
    var rows = state.bars.slice(-20).map(function (bar) {
      var row = document.createElement('tr');
      [formatFullTime(bar.t), formatPrice(bar.o), formatPrice(bar.h), formatPrice(bar.l), formatPrice(bar.c), formatCompact(bar.v)].forEach(function (value) {
        var cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });
      return row;
    });
    body.replaceChildren.apply(body, rows);
  }

  function formatPrice(value) {
    if (!Number.isFinite(value)) return '—';
    var decimals = value >= 100 ? 2 : value >= 1 ? 3 : 5;
    return value.toFixed(decimals);
  }

  function formatCompact(value) {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  }

  function formatTime(timestamp) {
    var options;
    if (state.timeframe === '1Y') {
      options = { year: 'numeric', timeZone: 'America/New_York' };
    } else if (state.timeframe === '1M' || state.timeframe === '1Q') {
      options = { month: 'short', year: '2-digit', timeZone: 'America/New_York' };
    } else if (state.timeframe === '1D' || state.timeframe === '1W') {
      options = { month: 'short', day: 'numeric', timeZone: 'America/New_York' };
    } else {
      options = { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' };
    }
    return new Intl.DateTimeFormat('en-US', options).format(new Date(timestamp));
  }

  function formatFullTime(timestamp) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    }).format(new Date(timestamp)) + ' ET';
  }

  function zoom(factor, anchorRatio) {
    var currentSpan = state.to - state.from;
    var nextSpan = Math.max(20, Math.min(state.bars.length, Math.round(currentSpan * factor)));
    var anchor = state.from + currentSpan * anchorRatio;
    var nextFrom = Math.round(anchor - nextSpan * anchorRatio);
    nextFrom = Math.max(0, Math.min(nextFrom, Math.max(0, state.bars.length - nextSpan)));
    state.from = nextFrom;
    state.to = Math.min(state.bars.length, nextFrom + nextSpan);
    state.follow = state.to >= state.bars.length;
    scheduleRender();
  }

  resetButton.addEventListener('click', resetView);
  canvasHost.addEventListener('wheel', function (event) {
    if (!state.active) return;
    event.preventDefault();
    var rect = canvasHost.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - pad.left) / Math.max(1, width - pad.left - pad.right)));
    zoom(event.deltaY > 0 ? 1.18 : 0.84, ratio);
  }, { passive: false });

  function inDividerZone(y) {
    return state.active && y >= priceBottom - 5 && y <= priceBottom + 21; /* the gap band above the volume pane */
  }

  canvasHost.addEventListener('pointerdown', function (event) {
    if (!state.active) return;
    var rect = canvasHost.getBoundingClientRect();
    if (inDividerZone(event.clientY - rect.top)) {
      dividerDrag = true;
      canvasHost.setPointerCapture(event.pointerId);
      return;
    }
    dragging = true;
    dragStartX = event.clientX;
    dragStartFrom = state.from;
    canvasHost.setPointerCapture(event.pointerId);
  });

  canvasHost.addEventListener('pointermove', function (event) {
    if (!state.active) return;
    var rect = canvasHost.getBoundingClientRect();
    if (dividerDrag) {
      var yy = event.clientY - rect.top;
      volumeRatio = Math.max(0.05, Math.min(0.65, (height - pad.bottom - 18 - yy) / Math.max(1, height)));
      state.crosshair = null;
      scheduleRender();
      return;
    }
    canvasHost.style.cursor = inDividerZone(event.clientY - rect.top) && !dragging ? 'ns-resize' : '';
    state.crosshair = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (dragging) {
      var deltaBars = Math.round((dragStartX - event.clientX) / Math.max(1, lastSpacing));
      var span = state.to - state.from;
      var nextFrom = Math.max(0, Math.min(dragStartFrom + deltaBars, Math.max(0, state.bars.length - span)));
      state.from = nextFrom;
      state.to = Math.min(state.bars.length, nextFrom + span);
      state.follow = state.to >= state.bars.length;
    }
    scheduleRender();
  });

  function endDrag(event) {
    if (dividerDrag) { dividerDrag = false; persistPreferences(); }
    dragging = false;
    if (event && canvasHost.hasPointerCapture(event.pointerId)) canvasHost.releasePointerCapture(event.pointerId);
  }
  canvasHost.addEventListener('pointerup', endDrag);
  canvasHost.addEventListener('pointercancel', endDrag);
  canvasHost.addEventListener('pointerleave', function () {
    if (!dragging) {
      state.crosshair = null;
      scheduleRender();
    }
  });

  canvasHost.addEventListener('keydown', function (event) {
    if (!state.active) return;
    var plotWidth = width - pad.left - pad.right;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.84, 0.5); }
    else if (event.key === '-') { event.preventDefault(); zoom(1.18, 0.5); }
    else if (event.key === 'Escape') { state.crosshair = null; scheduleRender(); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      var current = state.crosshair ? Math.round((state.crosshair.x - pad.left - lastSpacing / 2) / lastSpacing) : lastVisible.length - 1;
      current += event.key === 'ArrowLeft' ? -1 : 1;
      current = Math.max(0, Math.min(lastVisible.length - 1, current));
      state.crosshair = { x: pad.left + current / Math.max(1, lastVisible.length - 1) * plotWidth, y: priceY(lastVisible[current].c) };
      scheduleRender();
    }
  });

  function cleanup() {
    if (historyController) historyController.abort();
    if (quoteTimer) clearTimeout(quoteTimer);
    if (historyTimer) clearInterval(historyTimer);
    resizeObserver.disconnect();
  }
  window.addEventListener('pagehide', cleanup, { once: true });

  rebuildToolbar();
  loadHistory(false);
  pollQuote();
  historyTimer = window.setInterval(function () {
    if (state.quality !== 'demo') loadHistory(true);
  }, 30000);
}());
