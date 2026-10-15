/* Immersive layer for Loop Letters: 2D particles and shapes, 3D wireframe objects, and screen effects on one canvas.
   Reacts to --lls-kick (set by the audio dock) and scroll; pauses when the tab is hidden; respects reduced motion. */
(function () {
  'use strict';
  var S = window.smlLLS || {}, imm = S.immersive || {};
  var canvas = document.getElementById('lls-fx-canvas');
  if (!canvas || !imm.level || imm.level === 'off') { return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { return; }
  var level = imm.level, effects = imm.effects || [], shapes = imm.shapes || [], objects = imm.objects || [];
  var has = function (list, k) { return list.indexOf(k) !== -1; };
  if (imm.pulse !== false) { document.body.classList.add('lls-pulse'); }
  var density = level === 'max' ? 1.5 : level === 'alive' ? 1 : 0.55;
  var mobile = window.innerWidth < 720;
  if (mobile) { density *= 0.55; }
  var rgb = (S.accent && hexToRgb(S.accent)) || [56, 245, 138];
  var W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
  var kick = 0, scrollY = 0, t0 = performance.now(), running = true, pointer = { x: -1, y: -1 };

  function hexToRgb(h) { h = String(h).replace('#', ''); if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; } if (h.length !== 6) { return null; } return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  var col = function (a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', function () { window.clearTimeout(resize.t); resize.t = window.setTimeout(function () { resize(); build(); }, 150); });
  window.addEventListener('scroll', function () { scrollY = window.scrollY; }, { passive: true });
  window.addEventListener('pointermove', function (e) { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
  document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) { frame(); } });
  var readKick = function () { var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lls-kick')); return isNaN(v) ? 0 : v; };

  /* ---------- 2D systems ---------- */
  var particles = [], orbs = [], drops = [], tape = [], shapeList = [];
  var TAPE_SYMS = (S.tickers && S.tickers.length ? S.tickers : ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'AMD']);
  function build() {
    particles = []; orbs = []; drops = []; tape = []; shapeList = [];
    var area = W * H / 1e6;
    if (has(effects, 'particles') || (!effects.length && !shapes.length && !objects.length)) {
      var n = Math.round(90 * area * density);
      for (var i = 0; i < n; i++) { particles.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.6, 2.2), vx: rnd(-0.12, 0.12), vy: rnd(-0.25, -0.05), a: rnd(0.15, 0.7), p: rnd(0, 6.28) }); }
    }
    if (has(effects, 'orbs')) { for (var o = 0; o < Math.round(4 * density) + 1; o++) { orbs.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(140, 360), vx: rnd(-0.15, 0.15), vy: rnd(-0.1, 0.1), a: rnd(0.05, 0.14) }); } }
    if (has(effects, 'rain')) { for (var d = 0; d < Math.round(70 * area * density); d++) { drops.push({ x: rnd(0, W), y: rnd(-H, H), l: rnd(14, 60), v: rnd(2.5, 6.5), a: rnd(0.08, 0.3) }); } }
    if (has(effects, 'ticker')) { var x = 0; for (var k = 0; k < 40; k++) { var s = TAPE_SYMS[k % TAPE_SYMS.length]; var pct = rnd(-3, 3); tape.push({ s: s, pct: pct, x: x }); x += 150; } }
    var kinds = shapes.slice(); if (!kinds.length && has(effects, 'particles') === false && !objects.length && !effects.length) { kinds = ['rings']; }
    var perKind = Math.round(7 * density);
    kinds.forEach(function (kind) { for (var j = 0; j < perKind; j++) { shapeList.push({ kind: kind, x: rnd(0, W), y: rnd(0, H), s: rnd(10, 46), rot: rnd(0, 6.28), vr: rnd(-0.004, 0.004), vx: rnd(-0.1, 0.1), vy: rnd(-0.18, 0.05), a: rnd(0.06, 0.22), depth: rnd(0.3, 1) }); } });
  }
  build();

  function drawShape(sh, time) {
    ctx.save(); ctx.translate(sh.x, sh.y - scrollY * sh.depth * 0.15 % (H + 100)); ctx.rotate(sh.rot);
    var s = sh.s * (1 + kick * 0.25 * sh.depth);
    ctx.strokeStyle = col(sh.a + kick * 0.2); ctx.lineWidth = 1 + sh.depth; ctx.fillStyle = col(sh.a * 0.25);
    ctx.beginPath();
    switch (sh.kind) {
      case 'rings': ctx.arc(0, 0, s, 0, 6.283); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, 6.283); break;
      case 'triangles': ctx.moveTo(0, -s); ctx.lineTo(s * 0.87, s * 0.5); ctx.lineTo(-s * 0.87, s * 0.5); ctx.closePath(); break;
      case 'squares': ctx.rect(-s / 2, -s / 2, s, s); break;
      case 'hex': for (var i = 0; i < 6; i++) { var a = i * 1.0472; ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); } ctx.closePath(); break;
      case 'lines': ctx.moveTo(-s * 1.6, 0); ctx.lineTo(s * 1.6, 0); break;
      case 'candles':
        var up = Math.sin(time / 900 + sh.x) > 0; ctx.strokeStyle = up ? 'rgba(56,245,138,' + (sh.a + 0.1) + ')' : 'rgba(255,107,107,' + (sh.a + 0.1) + ')'; ctx.fillStyle = ctx.strokeStyle;
        ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke(); ctx.beginPath(); ctx.rect(-s * 0.3, -s * 0.45, s * 0.6, s * 0.9); ctx.fill(); break;
    }
    ctx.stroke(); if (sh.kind !== 'lines' && sh.kind !== 'rings') { ctx.fill(); }
    ctx.restore();
  }

  /* ---------- 3D wireframes ---------- */
  function makeObject(kind) {
    var v = [], e = [];
    var push = function (a) { v.push(a); return v.length - 1; };
    switch (kind) {
      case 'cube': [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].forEach(push); e = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]; break;
      case 'pyramid': [[0,-1.2,0],[-1,0.8,-1],[1,0.8,-1],[1,0.8,1],[-1,0.8,1]].forEach(push); e = [[0,1],[0,2],[0,3],[0,4],[1,2],[2,3],[3,4],[4,1]]; break;
      case 'octa': [[0,-1.3,0],[0,1.3,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1]].forEach(push); e = [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[4,3],[3,5],[5,2]]; break;
      case 'sphere':
        for (var la = -2; la <= 2; la++) { var r = Math.cos(la * 0.5), y = Math.sin(la * 0.5); var ring = []; for (var lo = 0; lo < 12; lo++) { ring.push(push([Math.cos(lo * 0.5236) * r, y, Math.sin(lo * 0.5236) * r])); } for (var q = 0; q < 12; q++) { e.push([ring[q], ring[(q + 1) % 12]]); } }
        for (var m = 0; m < 12; m++) { for (var n = 0; n < 4; n++) { e.push([m + n * 12, m + (n + 1) * 12]); } } break;
      case 'torus':
        for (var i = 0; i < 16; i++) { var ca = Math.cos(i * 0.3927), sa = Math.sin(i * 0.3927); for (var j = 0; j < 8; j++) { var cb = Math.cos(j * 0.785), sb = Math.sin(j * 0.785); push([(1 + 0.4 * cb) * ca, 0.4 * sb, (1 + 0.4 * cb) * sa]); } }
        for (var p = 0; p < 16; p++) { for (var w = 0; w < 8; w++) { e.push([p * 8 + w, p * 8 + (w + 1) % 8]); e.push([p * 8 + w, ((p + 1) % 16) * 8 + w]); } } break;
      case 'coin':
        for (var c = 0; c < 20; c++) { push([Math.cos(c * 0.3142), 0.12, Math.sin(c * 0.3142)]); push([Math.cos(c * 0.3142), -0.12, Math.sin(c * 0.3142)]); }
        for (var d = 0; d < 20; d++) { e.push([d * 2, ((d + 1) % 20) * 2]); e.push([d * 2 + 1, ((d + 1) % 20) * 2 + 1]); if (d % 5 === 0) { e.push([d * 2, d * 2 + 1]); } }
        push([-0.35, 0.12, -0.5]); push([-0.35, 0.12, 0.5]); push([0.35, 0.12, -0.5]); push([0.35, 0.12, 0.5]); push([-0.35, 0.12, 0]); push([0.35, 0.12, 0]);
        e.push([40, 41]); e.push([42, 43]); e.push([44, 45]); break;
      case 'bull':
        [[-1,0.2,0],[1,0.2,0],[1,-0.6,0],[-1,-0.6,0],[-1,0.2,0.6],[1,0.2,0.6],[1,-0.6,0.6],[-1,-0.6,0.6],[1.5,0.6,0.3],[1.9,0.3,0.3],[1.3,1.2,0.1],[1.3,1.2,0.5],[-1.4,-0.2,0.3]].forEach(push);
        e = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7],[1,8],[5,8],[8,9],[8,10],[8,11],[0,12],[4,12]]; break;
      default: return null;
    }
    return { v: v, e: e, x: rnd(0.15, 0.85), y: rnd(0.15, 0.85), size: rnd(70, 150) * (mobile ? 0.6 : 1), rx: rnd(0, 6.28), ry: rnd(0, 6.28), vx: rnd(0.002, 0.006), vy: rnd(0.003, 0.008), drift: rnd(0, 6.28), a: rnd(0.18, 0.4) };
  }
  var objs = objects.map(makeObject).filter(Boolean);
  function drawObject(o, time) {
    var cx = o.x * W + Math.sin(time / 4000 + o.drift) * 30, cy = o.y * H + Math.cos(time / 5000 + o.drift) * 24 - (scrollY * 0.08) % H;
    var size = o.size * (1 + kick * 0.18);
    var rx = o.rx + time * o.vx * 0.001 * 60, ry = o.ry + time * o.vy * 0.001 * 60;
    var cosx = Math.cos(rx), sinx = Math.sin(rx), cosy = Math.cos(ry), siny = Math.sin(ry);
    var pts = o.v.map(function (p) {
      var x = p[0], y = p[1] * cosx - p[2] * sinx, z = p[1] * sinx + p[2] * cosx;
      var x2 = x * cosy + z * siny, z2 = -x * siny + z * cosy;
      var f = 3 / (3 + z2);
      return [cx + x2 * size * f, cy + y * size * f, z2];
    });
    ctx.lineWidth = 1.2;
    o.e.forEach(function (ed) {
      var a = pts[ed[0]], b = pts[ed[1]], depth = (a[2] + b[2]) / 2;
      ctx.strokeStyle = col(Math.max(0.04, o.a + kick * 0.25 - depth * 0.08));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
    pts.forEach(function (p) { ctx.fillStyle = col(0.5 + kick * 0.3); ctx.beginPath(); ctx.arc(p[0], p[1], 1.4, 0, 6.283); ctx.fill(); });
  }

  /* ---------- screen effects ---------- */
  function aurora(time) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    var k = 0.06 + kick * 0.1;
    g.addColorStop(0, col(k * (0.6 + 0.4 * Math.sin(time / 3000))));
    g.addColorStop(0.5, 'rgba(60,120,255,' + (k * 0.6) + ')');
    g.addColorStop(1, col(k * (0.6 + 0.4 * Math.cos(time / 4200))));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 3; i++) {
      var y = H * (0.2 + 0.25 * i) + Math.sin(time / (1800 + i * 600)) * 60;
      var band = ctx.createLinearGradient(0, y - 120, 0, y + 120);
      band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.5, col(0.05 + kick * 0.08)); band.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = band; ctx.fillRect(0, y - 120, W, 240);
    }
    ctx.restore();
  }
  function grid(time) {
    ctx.strokeStyle = col(0.05 + kick * 0.05); ctx.lineWidth = 1;
    var step = 56, off = (scrollY * 0.3) % step;
    ctx.beginPath();
    for (var x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (var y = -off; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    /* a moving horizon line for depth */
    var hy = H * 0.62 + Math.sin(time / 2600) * 10;
    ctx.strokeStyle = col(0.16 + kick * 0.2); ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
  }
  function scan(time) {
    var y = (time / 9) % (H + 200) - 100;
    var g = ctx.createLinearGradient(0, y - 90, 0, y + 90);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, col(0.07 + kick * 0.1)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 90, W, 180);
  }
  function spotlight() {
    if (pointer.x < 0) { return; }
    var g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 320);
    g.addColorStop(0, col(0.09 + kick * 0.08)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(pointer.x - 320, pointer.y - 320, 640, 640);
  }
  var noiseTile = null;
  function noise() {
    if (!noiseTile) {
      noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 128;
      var nc = noiseTile.getContext('2d'), img = nc.createImageData(128, 128);
      for (var i = 0; i < img.data.length; i += 4) { var v = 255 * Math.random(); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22; }
      nc.putImageData(img, 0, 0);
    }
    ctx.save(); ctx.translate(Math.random() * 128, Math.random() * 128); ctx.fillStyle = ctx.createPattern(noiseTile, 'repeat'); ctx.fillRect(-128, -128, W + 256, H + 256); ctx.restore();
  }
  function tapeDraw(time) {
    ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
    var y = H - 26, speed = (time / 30) % (tape.length * 150);
    tape.forEach(function (t) {
      var x = ((t.x - speed) % (tape.length * 150) + tape.length * 150) % (tape.length * 150) - 150;
      if (x > W) { return; }
      ctx.fillStyle = 'rgba(255,255,255,' + (0.22 + kick * 0.2) + ')'; ctx.fillText('$' + t.s, x, y);
      ctx.fillStyle = t.pct >= 0 ? 'rgba(56,245,138,.5)' : 'rgba(255,107,107,.5)'; ctx.fillText((t.pct >= 0 ? '+' : '') + t.pct.toFixed(2) + '%', x + 58, y);
    });
  }

  /* ---------- main loop ---------- */
  var last = 0;
  function frame(now) {
    if (!running) { return; }
    now = now || performance.now();
    var dt = Math.min(50, now - last); last = now;
    var time = now - t0;
    var target = readKick(); kick += (target - kick) * 0.25;
    ctx.clearRect(0, 0, W, H);
    if (has(effects, 'aurora')) { aurora(time); }
    if (has(effects, 'grid')) { grid(time); }
    orbs.forEach(function (o) {
      o.x += o.vx * dt * 0.06; o.y += o.vy * dt * 0.06;
      if (o.x < -o.r) { o.x = W + o.r; } if (o.x > W + o.r) { o.x = -o.r; } if (o.y < -o.r) { o.y = H + o.r; } if (o.y > H + o.r) { o.y = -o.r; }
      var g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * (1 + kick * 0.2));
      g.addColorStop(0, col(o.a + kick * 0.1)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(o.x - o.r * 1.3, o.y - o.r * 1.3, o.r * 2.6, o.r * 2.6);
    });
    particles.forEach(function (p) {
      p.x += p.vx * dt * 0.06 + Math.sin(time / 1400 + p.p) * 0.08; p.y += p.vy * dt * 0.06 * (1 + kick);
      if (p.y < -4) { p.y = H + 4; p.x = rnd(0, W); } if (p.x < -4) { p.x = W + 4; } if (p.x > W + 4) { p.x = -4; }
      ctx.fillStyle = col(p.a * (0.6 + 0.4 * Math.sin(time / 700 + p.p)) + kick * 0.2);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + kick * 0.6), 0, 6.283); ctx.fill();
    });
    if (particles.length && level !== 'calm') {
      ctx.strokeStyle = col(0.05 + kick * 0.06); ctx.lineWidth = 0.6;
      var step = mobile ? 3 : 2;
      for (var i = 0; i < particles.length; i += step) { for (var j = i + step; j < particles.length; j += step) { var a = particles[i], b = particles[j], dx = a.x - b.x, dy = a.y - b.y; if (dx * dx + dy * dy < 9000) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } } }
    }
    drops.forEach(function (d) {
      d.y += d.v * dt * 0.06 * (1 + kick * 0.5); if (d.y > H + d.l) { d.y = -d.l; d.x = rnd(0, W); }
      ctx.strokeStyle = col(d.a); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x, d.y + d.l); ctx.stroke();
    });
    shapeList.forEach(function (sh) {
      sh.x += sh.vx * dt * 0.06; sh.y += sh.vy * dt * 0.06; sh.rot += sh.vr * dt * 0.06 * (1 + kick * 2);
      if (sh.y < -60) { sh.y = H + 60; sh.x = rnd(0, W); } if (sh.x < -60) { sh.x = W + 60; } if (sh.x > W + 60) { sh.x = -60; }
      drawShape(sh, time);
    });
    objs.forEach(function (o) { drawObject(o, time); });
    if (has(effects, 'scan')) { scan(time); }
    if (has(effects, 'spotlight')) { spotlight(); }
    if (has(effects, 'ticker')) { tapeDraw(time); }
    if (has(effects, 'noise')) { noise(); }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
})();
