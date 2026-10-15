/* Board motion and sound for the existing games. Watches the boards the games desk repaints and marks what changed,
   so a placed mark pops, a disc drops, a piece slides, a card deals, and a win bursts. */
(function () {
  'use strict';
  if (window.__smlBoardsFx) { return; } window.__smlBoardsFx = true;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var muted = false; try { muted = localStorage.getItem('sml-arc-mute') === '1'; } catch (e) {}
  var ctx = null;
  function actx() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } } if (ctx && ctx.state === 'suspended') { ctx.resume(); } return ctx; }
  function tone(f, d, type, g, when) { try { muted = localStorage.getItem('sml-arc-mute') === '1'; } catch (e) {} var c = actx(); if (!c || muted) { return; } var o = c.createOscillator(), gn = c.createGain(); o.type = type || 'sine'; o.frequency.value = f; o.connect(gn); gn.connect(c.destination); var t = c.currentTime + (when || 0); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g || .06, t + .01); gn.gain.exponentialRampToValueAtTime(.0001, t + d); o.start(t); o.stop(t + d + .02); }
  var sfx = { place: function () { tone(520, .07, 'triangle', .06); tone(260, .09, 'sine', .04); }, drop: function () { tone(180, .12, 'triangle', .07); tone(120, .2, 'sine', .05, .05); }, slide: function () { tone(400, .05, 'square', .02); }, deal: function () { tone(900, .04, 'square', .02); tone(1200, .04, 'square', .015, .03); }, win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, .25, 'triangle', .07, i * .09); }); }, lose: function () { tone(220, .25, 'sawtooth', .04); tone(150, .35, 'sawtooth', .04, .12); } };
  document.addEventListener('pointerdown', function () { actx(); }, { once: true, passive: true });

  var snap = new WeakMap();
  var SEL = '#slw-ttt .slw-cell, .slw-c4c, .slw-ckc, .slw-sq, .slw-card, .gp-board .gp-cell, .gp-hand .gp-card';
  function sig(el) { return el.className.replace(/\bbd-new\b/g, '') + '|' + (el.textContent || '').trim() + '|' + (el.getAttribute('data-card') || ''); }
  function filled(el) { return /\b(x|o|p1|p2)\b/.test(el.className) || !!el.querySelector('.pc, .gp-disc, .gp-mark') || !!el.getAttribute('data-card') || (el.textContent || '').trim().length > 0; }
  function mark(el, kind) { if (reduced) { return; } el.classList.remove('bd-new'); void el.offsetWidth; el.classList.add('bd-new'); setTimeout(function () { el.classList.remove('bd-new'); }, 700); if (kind) { sfx[kind](); } }
  function scan(root) {
    var cells = (root.matches && root.matches(SEL)) ? [root] : Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll(SEL) : []);
    cells.forEach(function (el) {
      var now = sig(el), was = snap.get(el);
      snap.set(el, now);
      if (was === undefined || was === now) { return; }
      if (!filled(el)) { return; }
      if (el.classList.contains('slw-c4c') || el.classList.contains('gp-cell') && el.closest('.gp-c4')) { mark(el, 'drop'); }
      else if (el.classList.contains('slw-sq') || el.classList.contains('slw-ckc') || (el.classList.contains('gp-cell') && el.closest('.gp-ch, .gp-ck'))) { mark(el, 'slide'); }
      else if (el.classList.contains('slw-card') || el.classList.contains('gp-card')) { mark(el, 'deal'); }
      else { mark(el, 'place'); }
    });
  }
  /* boards are rebuilt by innerHTML, so new cells have no history: seed them from the previous board of the same kind */
  var lastBoard = {};
  function boardKey(host) { return host.id || host.className.split(' ')[0]; }
  function seed(host) {
    var key = boardKey(host), cells = Array.prototype.slice.call(host.querySelectorAll(SEL)), prev = lastBoard[key];
    if (prev && prev.length === cells.length) { cells.forEach(function (el, i) { if (!snap.has(el)) { snap.set(el, prev[i]); } }); }
    lastBoard[key] = cells.map(sig);
  }
  var BOARDS = '#slw-ttt, .slw-c4, .slw-ck, #slw-chess, .slw-sphand, .gp-board, .gp-hand';
  var statusSeen = '';
  var mo = new MutationObserver(function (muts) {
    var touched = [];
    muts.forEach(function (m) { var t = m.target; if (t.nodeType !== 1) { t = t.parentElement; } if (t && touched.indexOf(t) === -1) { touched.push(t); } });
    touched.forEach(function (t) {
      var host = t.closest ? t.closest(BOARDS) : null; if (host) { seed(host); scan(host); }
      Array.prototype.forEach.call(t.querySelectorAll ? t.querySelectorAll(BOARDS) : [], function (h) { seed(h); scan(h); });
      var st = t.closest ? t.closest('.slw-ttt-status, .gp-status') || t.querySelector && t.querySelector('.slw-ttt-status.win, .slw-ttt-status.lose') : null;
      if (st) { var key = st.className + '|' + st.textContent; if (key !== statusSeen) { statusSeen = key; if (/\bwin\b/.test(st.className)) { sfx.win(); burst(st); } else if (/\blose\b/.test(st.className)) { sfx.lose(); } } }
    });
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  function burst(anchor) {
    if (reduced) { return; }
    var r = anchor.getBoundingClientRect(), cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483100'; cv.width = window.innerWidth; cv.height = window.innerHeight; document.body.appendChild(cv);
    var c = cv.getContext('2d'), ps = [], cols = ['#00ff88', '#00ccff', '#ffd166', '#ffffff'];
    for (var i = 0; i < 120; i++) { var a = Math.random() * 6.283, v = Math.random() * 9 + 3; ps.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, r: Math.random() * 4 + 2, col: cols[i % 4], life: 1 }); }
    var t0 = performance.now();
    (function f(now) { var dt = Math.min(40, now - t0) / 16; t0 = now; c.clearRect(0, 0, cv.width, cv.height); var alive = 0; ps.forEach(function (p) { p.vy += .3 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= .012 * dt; if (p.life <= 0) { return; } alive++; c.globalAlpha = p.life; c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill(); }); if (alive) { requestAnimationFrame(f); } else { cv.remove(); } })(t0);
  }
})();
