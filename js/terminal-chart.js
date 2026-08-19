/* SML Terminal — chart module (Phase 3): runs the site's OWN LoopCharts engine.
   The renderer is js/loopcharts-engine.js — the canvas engine originally built for
   the ticker terminal (extracted verbatim from the sml-massive-terminal plugin):
   14 intervals (1m 3m 5m 10m 15m 30m 1h 2h 4h 1D 1W 1M 1Q 1Y), per-bar interval
   stats legend (time · O H L C · Vol under the crosshair), EMA20/EMA50/Bollinger/
   VWAP, drag-pan + wheel-zoom + keyboard inspection, live-quote merge into the
   forming bar, 30s authoritative history refresh, screen-reader table. Data is the
   site's own /wp-json/sml/v1/history + /quote. No third-party chart library — the
   TradingView Lightweight Charts renderer used in Phase 2 is gone.
   Sets window.SML_TV2_NATIVE_CHART=1 synchronously so terminal-adopt.js does NOT
   move the legacy #sml-ws-left card in. Honest states: the engine itself reports
   "Loading / Connected · N candles / error" in its footer; while nothing has
   painted yet we show a plain loading line, and if the engine never activates we
   say the history feed is unavailable instead of pretending. */
(function () {
  'use strict';
  if (window.__smlTerminalChartBooted) return;
  window.__smlTerminalChartBooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;
  window.SML_TV2_NATIVE_CHART = 1;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 15) || 'SPY';
  var me = document.currentScript || Array.prototype.filter.call(document.scripts, function (s) { return /terminal-chart\.js/.test(s.src); })[0];
  var BASE = me && me.src ? me.src.replace(/js\/terminal-chart\.js.*$/, '') : '';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  var CSS = '' +
    '.tv2-ch{display:flex;flex-direction:column;gap:8px}' +
    '.tv2-ch-head{display:flex;align-items:center;gap:10px}' +
    '.tv2-ch-sym{font:700 13px/1 Archivo,sans-serif;color:#e6edf3}.tv2-ch-sym span{color:#00ff88}' +
    '.tv2-ch-tag{font:500 9px/1 "IBM Plex Mono",monospace;letter-spacing:.12em;color:#5d7085;border:1px solid #1c2833;border-radius:12px;padding:4px 8px}' +
    /* placeholder slot the engine watches — visible only while the engine has not activated */
    '#sml-tv-chart{display:flex;align-items:center;justify-content:center;min-height:430px;border:1px solid #16202b;border-radius:10px;background:#080c12;font:500 12px/1.6 "IBM Plex Mono",monospace;color:#5d7085;text-align:center;padding:24px}' +
    '#sml-tv-chart[hidden]{display:none!important}' +
    /* the engine stage lives inside a dark card that already has its own border — blend it in */
    '.tv2-ch .sml-lc-stage{margin:0}' +
    '@media(max-width:700px){#sml-tv-chart{min-height:340px}}';

  function boot() {
    var main = document.querySelector('#sml-tv2-root [data-tv2-zone="main"]');
    if (!main || !main.children.length) return false;
    var card = main.children[0];
    if (card.querySelector('.tv2-ch')) return true;

    if (!document.getElementById('tv2-ch-css')) { var st = document.createElement('style'); st.id = 'tv2-ch-css'; st.textContent = CSS; document.head.appendChild(st); }
    Array.prototype.forEach.call(card.children, function (k) { if (!k.hasAttribute('data-tv2-keep')) k.style.display = 'none'; });

    var root = document.createElement('div');
    root.className = 'tv2-ch';
    root.setAttribute('data-tv2-keep', '1');
    root.innerHTML = '<div class="tv2-ch-head"><span class="tv2-ch-sym">$<span>' + esc(SYM) + '</span></span><span class="tv2-ch-tag">LOOPCHARTS ENGINE</span></div>' +
      '<div id="sml-tv-chart">Loading $' + esc(SYM) + ' chart engine…</div>';
    card.appendChild(root);

    /* the engine reads its config synchronously at load */
    window.SMLLC_CONFIG = {
      version: '1.0.4',
      symbol: SYM,
      restRoot: location.origin + '/wp-json/sml/v1/',
      demo: false,
      canConfigure: false
    };
    var s = document.createElement('script');
    s.src = BASE + 'js/loopcharts-engine.js';
    s.async = true;
    s.onerror = function () {
      var slot = document.getElementById('sml-tv-chart');
      if (slot) slot.textContent = 'The chart engine could not load (network/CSP). Reload to retry.';
      document.documentElement.classList.remove('sml-pp');
    };
    document.body.appendChild(s);

    /* pre-paint guard + honest failure state: reveal as soon as the engine's stage
       activates (it hides #sml-tv-chart); if it never does, say so instead of
       showing "Loading" forever */
    var waited = 0;
    var iv = setInterval(function () {
      var slot = document.getElementById('sml-tv-chart');
      var live = slot && slot.hidden; /* engine hides the slot when real candles painted */
      if (live) { clearInterval(iv); document.documentElement.classList.remove('sml-pp'); return; }
      waited += 500;
      if (waited === 4000) document.documentElement.classList.remove('sml-pp'); /* don't hold the page hostage */
      if (waited >= 25000) {
        clearInterval(iv);
        if (slot && !slot.hidden && /Loading .* chart engine/.test(slot.textContent)) {
          slot.textContent = 'No history is available for $' + SYM + ' right now — the candles feed is not responding.';
        }
      }
    }, 500);
    return true;
  }

  var tries = 0;
  var t = setInterval(function () { var ok = false; try { ok = boot(); } catch (e) {} if (ok || ++tries > 60) clearInterval(t); }, 250);
})();
