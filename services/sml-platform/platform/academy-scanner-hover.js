/* Live Market Scanner: hover a ticker to see its real-time mini chart, with fast interval buttons (1m 3m 5m 15m 1h 1D 1W 1M 1Q 1Y).
 * Data comes from the same /academy-activity/market feed as the main chart, so every interval the chart has works here. Each (ticker, interval) is cached in
 * memory and requests are shared, so switching interval shows the last picture at once and then refreshes it. The newest candle is nudged by the scanner's own
 * live price so the chart moves with the table. Educational only: nothing here places a trade. */
(function (root) {
  'use strict';
  var INTERVALS = ['1m', '3m', '5m', '15m', '1h', '1D', '1W', '1M', '1Q', '1Y'];
  var FAST = { '1m': 1, '3m': 1, '5m': 1, '15m': 1, '1h': 1 };
  var MAX_BARS = 90;

  /* ---------- pure helpers (unit-tested) ---------- */
  function visibleBars(bars, max) {
    var list = Array.isArray(bars) ? bars.filter(function (b) { return b && [b.t, b.o, b.h, b.l, b.c].every(function (n) { return Number.isFinite(Number(n)); }); }) : [];
    return list.slice(-(max || MAX_BARS));
  }
  function priceRange(bars) {
    if (!bars.length) return null;
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) { lo = Math.min(lo, +b.l); hi = Math.max(hi, +b.h); });
    var pad = (hi - lo) * 0.06 || Math.max(0.01, hi * 0.002);
    return { lo: lo - pad, hi: hi + pad };
  }
  /* the live scanner price moves the last candle: close follows, high/low widen, nothing else changes */
  function withLivePrice(bars, price) {
    var p = Number(price);
    if (!bars.length || !Number.isFinite(p) || p <= 0) return bars;
    var last = bars[bars.length - 1], upd = { t: last.t, o: last.o, h: Math.max(last.h, p), l: Math.min(last.l, p), c: p, v: last.v };
    if (Math.abs(p - last.c) / Math.max(1e-9, last.c) > 0.2) return bars; // a wildly different print is not a tick: leave the candle alone
    return bars.slice(0, -1).concat([upd]);
  }
  function changeOver(bars) {
    if (bars.length < 2) return null;
    var first = bars[0].o, last = bars[bars.length - 1].c;
    return first > 0 ? (last - first) / first * 100 : null;
  }
  function fmtTime(t, tf) {
    var d = new Date(+t);
    if (FAST[tf]) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    if (tf === '1D' || tf === '1W') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'America/New_York' });
  }
  var api = { INTERVALS: INTERVALS, visibleBars: visibleBars, priceRange: priceRange, withLivePrice: withLivePrice, changeOver: changeOver, fmtTime: fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;
  if (root.__smlScannerHover) return;
  root.__smlScannerHover = true;

  /* ---------- the popover ---------- */
  var KEY = 'sml-scan-hover-tf';
  var tf = '5m'; try { var saved = localStorage.getItem(KEY); if (saved && INTERVALS.indexOf(saved) >= 0) tf = saved; } catch (e) { /* storage can be blocked */ }
  var cache = {}, inflight = {}, sym = '', pop, canvas, ctx, timer = 0, showTimer = 0, hideTimer = 0, rowEl = null, gen = 0, hoverPop = false;

  var css = document.createElement('style');
  css.textContent = '#sml-scan-pop{position:fixed;z-index:2147483200;width:360px;background:#08121a;border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 18px 50px #000d;color:#e6eef2;font:600 12px system-ui,sans-serif;display:none;overflow:hidden}'
    + '#sml-scan-pop .h{display:flex;align-items:baseline;gap:8px;padding:9px 12px 4px}#sml-scan-pop .h b{font:800 15px system-ui;color:#fff;letter-spacing:.03em}#sml-scan-pop .px{font:800 15px ui-monospace,monospace}#sml-scan-pop .ch{font:800 11px ui-monospace,monospace}'
    + '#sml-scan-pop .up{color:#35e6a0}#sml-scan-pop .dn{color:#ff6b86}#sml-scan-pop .live{margin-left:auto;font:800 9px ui-monospace,monospace;color:#7dffc4;letter-spacing:.08em}'
    + '#sml-scan-pop .iv{display:flex;gap:3px;padding:2px 10px 6px;flex-wrap:wrap}#sml-scan-pop .iv button{padding:3px 7px;border:1px solid #1d3b4a;border-radius:6px;background:#0b1a24;color:#9fc0cf;font:800 10px ui-monospace,monospace;cursor:pointer}'
    + '#sml-scan-pop .iv button.on{background:#00b878;border-color:#00b878;color:#001d13}#sml-scan-pop canvas{display:block;width:100%;height:190px}'
    + '#sml-scan-pop .f{padding:4px 12px 8px;color:#6f8794;font:600 10px system-ui;display:flex;justify-content:space-between}#sml-scan-pop .msg{padding:60px 0;text-align:center;color:#7f97a4}';
  document.head.appendChild(css);

  function build() {
    if (pop) return;
    pop = document.createElement('div'); pop.id = 'sml-scan-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Mini chart');
    pop.innerHTML = '<div class="h"><b data-s></b><span class="px" data-p></span><span class="ch" data-c></span><span class="live" data-l>LIVE</span></div>'
      + '<div class="iv">' + INTERVALS.map(function (i) { return '<button type="button" data-tf="' + i + '">' + i + '</button>'; }).join('') + '</div>'
      + '<canvas width="720" height="380"></canvas><div class="f"><span data-lo></span><span data-hi></span></div>';
    document.body.appendChild(pop); canvas = pop.querySelector('canvas'); ctx = canvas.getContext('2d');
    pop.addEventListener('mouseenter', function () { hoverPop = true; clearTimeout(hideTimer); });
    pop.addEventListener('mouseleave', function () { hoverPop = false; scheduleHide(); });
    pop.addEventListener('click', function (e) { var b = e.target.closest('[data-tf]'); if (!b) return; setTf(b.getAttribute('data-tf')); });
  }

  function key(s, t) { return s + ':' + t; }
  function load(s, t) {
    var k = key(s, t);
    if (inflight[k]) return inflight[k];
    var p = fetch('/academy-activity/market?symbol=' + encodeURIComponent(s) + '&tf=' + encodeURIComponent(t), { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j || !Array.isArray(j.bars)) throw new Error('unavailable'); return j; }); })
      .then(function (j) { cache[k] = { bars: visibleBars(j.bars), at: Date.now(), stale: !!j.stale }; return cache[k]; })
      .then(function (v) { delete inflight[k]; return v; }, function (e) { delete inflight[k]; throw e; });
    inflight[k] = p; return p;
  }

  function livePrice(s) {
    try { var rows = typeof root.smlAcademyScannerRows === 'function' ? root.smlAcademyScannerRows() : []; var r = rows.filter(function (x) { return x && x.symbol === s; })[0]; return r ? Number(r.price) : NaN; } catch (e) { return NaN; }
  }

  function draw() {
    if (!pop || !sym) return;
    var c = cache[key(sym, tf)], W = canvas.width, H = canvas.height;
    pop.querySelector('[data-s]').textContent = sym;
    Array.prototype.forEach.call(pop.querySelectorAll('[data-tf]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tf') === tf); });
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#08121a'; ctx.fillRect(0, 0, W, H);
    if (!c || !c.bars.length) {
      ctx.fillStyle = '#7f97a4'; ctx.font = '600 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(c ? 'No candles for this interval' : 'Loading ' + tf + '…', W / 2, H / 2);
      pop.querySelector('[data-p]').textContent = ''; pop.querySelector('[data-c]').textContent = ''; return;
    }
    var bars = withLivePrice(c.bars, livePrice(sym)), rng = priceRange(bars), n = bars.length;
    var padL = 8, padR = 74, padT = 10, padB = 46, pw = W - padL - padR, ph = H - padT - padB, step = pw / n, bw = Math.max(2, Math.min(18, step * 0.7));
    var Y = function (p) { return padT + (rng.hi - p) / (rng.hi - rng.lo) * ph; };
    ctx.strokeStyle = '#13303d'; ctx.lineWidth = 1; ctx.fillStyle = '#6f8794'; ctx.font = '600 20px ui-monospace,monospace'; ctx.textAlign = 'left';
    for (var g = 0; g <= 4; g++) { var gp = rng.lo + (rng.hi - rng.lo) * g / 4, gy = Y(gp); ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke(); ctx.fillText(gp.toFixed(gp >= 100 ? 1 : 2), W - padR + 8, gy + 7); }
    var vmax = 0; bars.forEach(function (b) { vmax = Math.max(vmax, +b.v || 0); });
    bars.forEach(function (b, i) {
      var x = padL + step * i + step / 2, up = b.c >= b.o, col = up ? '#35e6a0' : '#ff6b86';
      if (vmax > 0 && b.v) { ctx.fillStyle = up ? 'rgba(53,230,160,.28)' : 'rgba(255,107,134,.28)'; var vh = (b.v / vmax) * 34; ctx.fillRect(x - bw / 2, H - 12 - vh, bw, vh); }
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      var top = Y(Math.max(b.o, b.c)), bot = Y(Math.min(b.o, b.c)); ctx.fillRect(x - bw / 2, top, bw, Math.max(2, bot - top));
    });
    var last = bars[n - 1], ly = Y(last.c), lcol = last.c >= bars[0].o ? '#35e6a0' : '#ff6b86';
    ctx.setLineDash([6, 5]); ctx.strokeStyle = lcol; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(W - padR, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lcol; ctx.fillRect(W - padR + 2, ly - 14, padR - 4, 28); ctx.fillStyle = '#021810'; ctx.font = '800 20px ui-monospace,monospace'; ctx.fillText(last.c.toFixed(last.c >= 100 ? 2 : 3), W - padR + 6, ly + 7);
    var ch = changeOver(bars), chEl = pop.querySelector('[data-c]'), pxEl = pop.querySelector('[data-p]');
    pxEl.textContent = '$' + last.c.toFixed(last.c >= 100 ? 2 : 3);
    chEl.textContent = ch == null ? '' : (ch >= 0 ? '+' : '') + ch.toFixed(2) + '% · ' + tf; chEl.className = 'ch ' + (ch >= 0 ? 'up' : 'dn');
    pop.querySelector('[data-lo]').textContent = fmtTime(bars[0].t, tf); pop.querySelector('[data-hi]').textContent = fmtTime(last.t, tf) + (c.stale ? ' · delayed' : '');
  }

  function refresh() {
    if (!sym) return; var s = sym, t = tf, my = gen;
    load(s, t).then(function () { if (my === gen && s === sym && t === tf) draw(); }, function () { if (my === gen && !cache[key(s, t)]) { cache[key(s, t)] = { bars: [], at: Date.now() }; draw(); } });
  }
  function setTf(t) {
    if (INTERVALS.indexOf(t) < 0) return; tf = t; try { localStorage.setItem(KEY, t); } catch (e) { /* ignore */ }
    gen++; draw(); refresh(); schedule();
  }
  function schedule() { clearInterval(timer); timer = setInterval(function () { if (!document.hidden && pop && pop.style.display === 'block') { var c = cache[key(sym, tf)]; if (c) c.at = 0; refresh(); draw(); } }, FAST[tf] ? 3000 : 10000); }

  function place(row, ev) {
    var r = row.getBoundingClientRect(), w = 360, h = pop.offsetHeight || 300;
    var x = Math.min(window.innerWidth - w - 12, Math.max(8, (ev && ev.clientX ? ev.clientX : r.left) + 18));
    var y = Math.min(window.innerHeight - h - 8, Math.max(8, r.top - h / 2 + r.height / 2));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function show(row, ev) {
    var s = row.getAttribute('data-symbol'); if (!s) return; build();
    var changed = s !== sym; sym = s; rowEl = row; gen++; clearTimeout(hideTimer);
    pop.style.display = 'block'; place(row, ev); draw();
    if (changed || !cache[key(sym, tf)]) refresh(); else { var c = cache[key(sym, tf)]; if (Date.now() - c.at > 2500) refresh(); }
    schedule();
  }
  function hide() { if (pop) pop.style.display = 'none'; sym = ''; rowEl = null; clearInterval(timer); }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (!hoverPop) hide(); }, 220); }

  function bind(host) {
    host.addEventListener('mouseover', function (e) {
      var row = e.target.closest && e.target.closest('tbody tr[data-symbol]'); if (!row) return;
      if (row === rowEl) { clearTimeout(hideTimer); return; }
      clearTimeout(showTimer); showTimer = setTimeout(function () { show(row, e); }, rowEl ? 40 : 140);
    });
    host.addEventListener('mouseout', function (e) {
      var row = e.target.closest && e.target.closest('tbody tr[data-symbol]'); if (!row) return;
      clearTimeout(showTimer); var to = e.relatedTarget; if (to && pop && pop.contains(to)) return; scheduleHide();
    });
    host.addEventListener('mousemove', function (e) { if (pop && pop.style.display === 'block' && rowEl && e.target.closest && e.target.closest('tr') === rowEl) place(rowEl, e); }, { passive: true });
    host.addEventListener('scroll', hide, true);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('blur', hide);

  (function boot(tries) {
    var host = document.getElementById('academy-scanner-host');
    if (!host || !host.querySelector('.academy-scanner')) { if (tries < 200) setTimeout(function () { boot(tries + 1); }, 150); return; }
    bind(host);
  })(0);
})(typeof window !== 'undefined' ? window : globalThis);
