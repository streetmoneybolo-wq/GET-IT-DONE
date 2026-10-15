/* Loop Arcade: Market Spin, Stream Jackpot and Tape Call on the live and watch pages. The server decides every outcome; this draws it. */
(function () {
  'use strict';
  var C = window.SML_ARCADE; if (!C || document.getElementById('sml-arc')) { return; }
  var ROOM = (window.SML_LW_ROOM && typeof window.SML_LW_ROOM === 'object') ? window.SML_LW_ROOM : {};
  var HANDLE = String(ROOM.handle || C.handle || '').toLowerCase(), STREAM = String(ROOM.stream || '');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Number(n || 0).toLocaleString(); };
  var api = function (path, body) {
    var h = { Accept: 'application/json' }; if (C.nonce) { h['X-WP-Nonce'] = C.nonce; } if (body) { h['Content-Type'] = 'application/json'; }
    return fetch(C.base + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Request failed'); e.code = j.code; throw e; } return j; }); });
  };
  var qsRoom = '?handle=' + encodeURIComponent(HANDLE) + (STREAM ? '&stream=' + encodeURIComponent(STREAM) : '');
  var roomBody = function (o) { o = o || {}; o.handle = HANDLE; if (STREAM) { o.stream = STREAM; } return o; };

  /* ---------- sound (synthesised, no files) ---------- */
  var SND = { ctx: null, muted: false };
  try { SND.muted = localStorage.getItem('sml-arc-mute') === '1'; } catch (e) {}
  function actx() { if (!SND.ctx) { try { SND.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { SND.ctx = null; } } if (SND.ctx && SND.ctx.state === 'suspended') { SND.ctx.resume(); } return SND.ctx; }
  function tone(freq, dur, type, gain, when) { var c = actx(); if (!c || SND.muted) { return; } var o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.value = freq; g.gain.value = 0; o.connect(g); g.connect(c.destination); var t = c.currentTime + (when || 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain || .08, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.start(t); o.stop(t + dur + .02); }
  var sfx = {
    tick: function () { tone(1800, .03, 'square', .025); },
    click: function () { tone(600, .05, 'triangle', .05); },
    coin: function () { tone(1320, .12, 'sine', .07); tone(1980, .18, 'sine', .05, .06); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, .22, 'triangle', .07, i * .09); }); },
    big: function () { [523, 659, 784, 1047, 1319, 1568].forEach(function (f, i) { tone(f, .3, 'triangle', .08, i * .08); }); tone(2093, .6, 'sine', .06, .5); },
    lose: function () { tone(220, .25, 'sawtooth', .04); tone(160, .35, 'sawtooth', .04, .12); },
    whoosh: function () { var c = actx(); if (!c || SND.muted) { return; } var b = c.createBuffer(1, c.sampleRate * .4, c.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) { d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); } var s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; g.gain.value = .12; s.buffer = b; s.connect(f); f.connect(g); g.connect(c.destination); s.start(); }
  };
  function buzz(p) { try { if (navigator.vibrate && !reduced) { navigator.vibrate(p); } } catch (e) {} }

  /* ---------- confetti ---------- */
  var conf = document.createElement('canvas'); conf.id = 'sml-arc-confetti'; document.body.appendChild(conf);
  function confetti(n, gold) {
    if (reduced) { return; }
    var ctx = conf.getContext('2d'), W = conf.width = window.innerWidth, H = conf.height = window.innerHeight; conf.classList.add('on');
    var cols = gold ? ['#ffd166', '#fff3c4', '#f0b000', '#00ff88', '#ffffff'] : ['#00ff88', '#00ccff', '#ffd166', '#ff5e6e', '#a78bfa', '#ffffff'];
    var ps = []; for (var i = 0; i < (n || 160); i++) { ps.push({ x: W / 2 + (Math.random() - .5) * 200, y: H / 2, vx: (Math.random() - .5) * 18, vy: -Math.random() * 16 - 4, r: Math.random() * 6 + 3, c: cols[i % cols.length], a: Math.random() * 6.28, va: (Math.random() - .5) * .3, life: 1 }); }
    var t0 = performance.now();
    (function frame(now) {
      var dt = Math.min(40, now - t0) / 16; t0 = now; ctx.clearRect(0, 0, W, H); var alive = 0;
      ps.forEach(function (p) { p.vy += .35 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .99; p.a += p.va; p.life -= .006 * dt; if (p.life <= 0 || p.y > H + 20) { return; } alive++; ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
      if (alive) { requestAnimationFrame(frame); } else { conf.classList.remove('on'); ctx.clearRect(0, 0, W, H); }
    })(performance.now());
  }
  var toastEl = document.createElement('div'); toastEl.className = 'arc-toast'; document.body.appendChild(toastEl);
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.classList.remove('on'); }, 2600); }

  /* ---------- shell ---------- */
  var fab = document.createElement('button'); fab.id = 'sml-arc-fab'; fab.type = 'button'; fab.innerHTML = '<span class="ico">🎰</span><span class="t">Arcade</span><span class="pill" id="arc-fab-pill">JACKPOT</span>';
  var panel = document.createElement('div'); panel.id = 'sml-arc';
  panel.innerHTML = '<div class="arc-win" role="dialog" aria-label="Loop Arcade"><div class="arc-head"><h3>Loop <span>Arcade</span></h3><div class="arc-bank"><span class="coin"></span><b id="arc-bal">0</b><span>LB</span></div><button type="button" class="arc-mute" id="arc-mute" aria-label="Sound">' + (SND.muted ? '🔇' : '🔊') + '</button><button type="button" class="arc-x" id="arc-x" aria-label="Close">×</button></div>'
    + '<div class="arc-tabs"><button type="button" data-tab="spin" class="on"><i>🎡</i>Market Spin</button><button type="button" data-tab="jackpot"><i>💰</i>Stream Jackpot <span class="dot" id="arc-jp-dot" style="display:none"></span></button><button type="button" data-tab="tape"><i>📈</i>Tape Call</button><button type="button" data-tab="ladder"><i>🏆</i>Ladders</button><button type="button" data-tab="tables"><i>▦</i>Tables</button></div>'
    + '<div class="arc-body"><div class="arc-pane on" data-pane="spin"></div><div class="arc-pane" data-pane="jackpot"></div><div class="arc-pane" data-pane="tape"></div><div class="arc-pane" data-pane="ladder"></div><div class="arc-pane" data-pane="tables"></div></div>'
    + '<div class="arc-foot"><span><b>Free to play.</b> Prizes are Loop Bucks from the vault; nothing is ever bought to enter. Up to 300 LB a day from the arcade, <b id="arc-cap">300</b> LB left today.</span></div></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);
  var S = { state: null, tab: 'spin', open: false, spinning: false, pollT: 0, tickT: 0, quoteT: 0, sym: 'SPY', quotes: {}, series: [], lastPx: 0 };
  fab.addEventListener('click', function () { actx(); openPanel(!S.open); });
  $('#arc-x', panel).addEventListener('click', function () { openPanel(false); });
  panel.addEventListener('click', function (e) { if (e.target === panel) { openPanel(false); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) { openPanel(false); } });
  $('#arc-mute', panel).addEventListener('click', function () { SND.muted = !SND.muted; try { localStorage.setItem('sml-arc-mute', SND.muted ? '1' : '0'); } catch (e) {} this.textContent = SND.muted ? '🔇' : '🔊'; });
  $('.arc-tabs', panel).addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (!b) { return; } sfx.click(); S.tab = b.getAttribute('data-tab'); $$('[data-tab]', panel).forEach(function (x) { x.classList.toggle('on', x === b); }); $$('.arc-pane', panel).forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === S.tab); }); render(); });
  function openPanel(on) { S.open = on; panel.classList.toggle('open', on); if (on) { load(); } }

  /* ---------- state ---------- */
  function load() { return api('/state' + qsRoom).then(function (j) { S.state = j; onState(); render(); }).catch(function (e) { var p = $('.arc-pane.on', panel); if (p) { p.innerHTML = '<div class="arc-note err">' + esc(e.message) + '</div>'; } }); }
  function onState() {
    var st = S.state; $('#arc-bal', panel).textContent = fmt(st.balance); $('#arc-cap', panel).textContent = fmt(st.capLeft);
    var round = st.jackpot && st.jackpot.round; fab.classList.toggle('has-round', !!round); $('#arc-jp-dot', panel).style.display = round ? '' : 'none';
    if (round && st.signedIn && !st.isHost) { tickSoon(); }
  }
  function tickSoon() { if (S.tickT) { return; } S.tickT = setTimeout(function () { S.tickT = 0; if (document.hidden) { tickSoon(); return; } api('/jackpot/tick', roomBody()).then(function (j) { if (S.state && S.state.jackpot) { S.state.jackpot.round = j.round; if (j.mine != null && j.round) { j.round.mine = j.mine; } } if (j.round && j.round.status === 'live') { tickSoon(); } else if (j.round && j.round.status === 'done') { onDrawn(j.round); } if (S.open && S.tab === 'jackpot') { render(); } }).catch(function () { tickSoon(); }); }, 60000); }
  function poll() { clearInterval(S.pollT); S.pollT = setInterval(function () { if (document.hidden) { return; } api('/state' + qsRoom).then(function (j) { var hadRound = S.state && S.state.jackpot && S.state.jackpot.round, had = hadRound ? hadRound.id : 0; S.state = j; onState(); var now = j.jackpot && j.jackpot.round; if (!now && had && j.jackpot.last && j.jackpot.last.id === had) { onDrawn(j.jackpot.last); } if (!had && now) { toast('🎰 ' + fmt(now.prize) + ' LB jackpot just opened. You are earning tickets.'); sfx.coin(); } if (S.open && !S.spinning) { render(); } }).catch(function () {}); }, S.open ? 15000 : 45000); }
  poll(); load();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(); } });

  /* ---------- render ---------- */
  function render() {
    if (!S.state) { return; }
    var p = $('.arc-pane.on', panel), tab = S.tab;
    if (tab === 'spin') { renderSpin(p); } else if (tab === 'jackpot') { renderJackpot(p); } else if (tab === 'tape') { renderTape(p); } else if (tab === 'ladder') { renderLadder(p); } else { renderTables(p); }
  }
  function signIn() { return '<div class="arc-note">Sign in to play. <a href="' + esc(C.loginUrl) + '" style="color:#ffd166">Sign in</a></div>'; }

  /* ======================= Market Spin ======================= */
  var WHEEL = { angle: 0, canvas: null, lights: 0 };
  var SEGCOL = ['#163b2d', '#2a1a1a', '#1a2a44', '#3a2a10', '#2b1a44', '#163b2d', '#4a3a05', '#2a1a1a', '#1a2a44', '#3a2a10', '#163b2d', '#5a1a3a'];
  function renderSpin(p) {
    var st = S.state, sp = st.spin, a = sp.allowance;
    if (!$('.arc-spin', p)) {
      p.innerHTML = '<div class="arc-spin"><div class="arc-wheel-wrap" id="arc-wheel-wrap"><div class="arc-wheel-ptr"></div><canvas id="arc-wheel" width="680" height="680"></canvas><div class="arc-wheel-hub">SPIN</div></div>'
        + '<div class="arc-spin-side"><div class="arc-spin-result" id="arc-spin-res"><b>Market Spin</b><small>One free spin a day. One more while a stream is live. One more on a 7-day streak.</small></div>'
        + '<div class="arc-row"><button type="button" class="arc-btn gold big" id="arc-spin-btn">Spin</button><div><div class="arc-spins" id="arc-spins"></div><div class="arc-streak" id="arc-streak"></div></div></div>'
        + '<div class="arc-prizes" id="arc-prizes"></div><div id="arc-spin-note"></div></div></div>';
      WHEEL.canvas = $('#arc-wheel', p); drawWheel(WHEEL.angle); startLights();
      $('#arc-spin-btn', p).addEventListener('click', spin);
    }
    var btn = $('#arc-spin-btn', p), spins = $('#arc-spins', p);
    spins.innerHTML = ''; for (var i = 0; i < Math.max(a.total, 1); i++) { spins.innerHTML += '<i class="' + (i < a.left ? 'on' : '') + '"></i>'; }
    $('#arc-streak', p).innerHTML = (a.streak ? '<b>🔥 ' + a.streak + '-day streak</b> · ' : '') + (a.won ? fmt(a.won) + ' LB won today' : (st.live ? 'Live stream bonus spin is on' : 'Watch a live stream for a bonus spin'));
    btn.disabled = !st.signedIn || a.left <= 0 || S.spinning; btn.textContent = !st.signedIn ? 'Sign in to spin' : (a.left > 0 ? 'Spin (' + a.left + ' left)' : 'Next spin tomorrow');
    $('#arc-prizes', p).innerHTML = sp.wheel.filter(function (s, i, arr) { return s.kind === 'lb' && arr.findIndex(function (x) { return x.lb === s.lb; }) === i; }).sort(function (x, y) { return y.lb - x.lb; }).map(function (s) { var w = sp.wheel.filter(function (x) { return x.lb === s.lb && x.kind === 'lb'; }).reduce(function (n, x) { return n + x.weight; }, 0), tot = sp.wheel.reduce(function (n, x) { return n + x.weight; }, 0); return '<span><b>' + s.label + '</b>' + Math.round(w / tot * 100) + '%</span>'; }).join('') + '<span><b>Extra spin</b>8%</span>';
    $('#arc-spin-note', p).innerHTML = st.signedIn ? '' : signIn();
  }
  function drawWheel(angle) {
    var cv = WHEEL.canvas; if (!cv) { return; } var ctx = cv.getContext('2d'), W = cv.width, cx = W / 2, cy = W / 2, R = W / 2 - 26, segs = S.state.spin.wheel, n = segs.length, step = Math.PI * 2 / n;
    ctx.clearRect(0, 0, W, W);
    /* rim */
    var rim = ctx.createRadialGradient(cx, cy, R, cx, cy, R + 26); rim.addColorStop(0, '#f6e7b0'); rim.addColorStop(.5, '#a8862a'); rim.addColorStop(1, '#4d3a08');
    ctx.beginPath(); ctx.arc(cx, cy, R + 24, 0, 6.283); ctx.fillStyle = rim; ctx.fill();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle - Math.PI / 2);
    for (var i = 0; i < n; i++) {
      var s = segs[i], a0 = i * step, a1 = a0 + step;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath();
      var g = ctx.createRadialGradient(0, 0, R * .2, 0, 0, R); var base = s.kind === 'lb' && s.lb >= 100 ? '#5a3f00' : s.kind === 'spin' ? '#1f3a6b' : s.kind === 'miss' ? '#2a2a2a' : SEGCOL[i];
      g.addColorStop(0, shade(base, 40)); g.addColorStop(1, base); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,160,.35)'; ctx.lineWidth = 2; ctx.stroke();
      /* label, always readable: text on the left half of the wheel is flipped to face outward */
      ctx.save(); var mid = a0 + step / 2; ctx.rotate(mid);
      var world = ((mid + angle - Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), leftHalf = world > Math.PI / 2 && world < Math.PI * 1.5;
      ctx.textBaseline = 'middle';
      if (leftHalf) { ctx.rotate(Math.PI); ctx.textAlign = 'left'; } else { ctx.textAlign = 'right'; }
      ctx.fillStyle = s.kind === 'miss' ? '#9aa' : s.lb >= 100 ? '#ffe08a' : '#fff'; ctx.font = (s.lb >= 100 ? '900 ' : '800 ') + (s.label.length > 8 ? 24 : 30) + 'px Archivo, "IBM Plex Sans", sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6; ctx.fillText(s.label, leftHalf ? -(R - 22) : R - 22, 0);
      ctx.shadowBlur = 0;
      if (s.kind === 'lb') { var cx2 = leftHalf ? -(R * .42) : R * .42; var cg = ctx.createRadialGradient(cx2 - 3, -3, 1, cx2, 0, 10); cg.addColorStop(0, '#fff6d6'); cg.addColorStop(.6, '#f0b000'); cg.addColorStop(1, '#7a5200'); ctx.beginPath(); ctx.arc(cx2, 0, 9, 0, 6.283); ctx.fillStyle = cg; ctx.fill(); }
      ctx.restore();
    }
    /* glass highlight */
    var gl = ctx.createLinearGradient(0, -R, 0, R); gl.addColorStop(0, 'rgba(255,255,255,.18)'); gl.addColorStop(.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283); ctx.fillStyle = gl; ctx.fill();
    ctx.restore();
    /* lights */
    for (var k = 0; k < 24; k++) { var la = k / 24 * Math.PI * 2, lx = cx + Math.cos(la) * (R + 12), ly = cy + Math.sin(la) * (R + 12), on = ((k + WHEEL.lights) % 3) === 0; ctx.beginPath(); ctx.arc(lx, ly, 6, 0, 6.283); ctx.fillStyle = on ? '#fff6c4' : '#7a5e14'; ctx.shadowColor = on ? '#ffe08a' : 'transparent'; ctx.shadowBlur = on ? 14 : 0; ctx.fill(); ctx.shadowBlur = 0; }
  }
  function shade(hex, amt) { var n = parseInt(hex.slice(1), 16), r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt); return 'rgb(' + r + ',' + g + ',' + b + ')'; }
  function startLights() { clearInterval(WHEEL.lt); WHEEL.lt = setInterval(function () { if (!S.open || S.tab !== 'spin' || S.spinning || reduced) { return; } WHEEL.lights = (WHEEL.lights + 1) % 3; drawWheel(WHEEL.angle); }, 420); }
  function spin() {
    if (S.spinning) { return; }
    var p = $('.arc-pane[data-pane="spin"]', panel), btn = $('#arc-spin-btn', p), res = $('#arc-spin-res', p);
    S.spinning = true; btn.disabled = true; res.className = 'arc-spin-result'; res.innerHTML = '<b>Spinning…</b><small>The wheel is drawn on the server, then shown here.</small>';
    $('#arc-wheel-wrap', p).classList.add('spinning'); sfx.whoosh();
    api('/spin', roomBody()).then(function (j) {
      var n = S.state.spin.wheel.length, step = Math.PI * 2 / n;
      /* the pointer is at the top; segment i spans [i*step, (i+1)*step) from the top when angle = 0 */
      var target = -(j.index * step + step / 2) + (Math.random() - .5) * step * .6;
      var turns = 6 + Math.floor(Math.random() * 2), start = WHEEL.angle, end = target - Math.PI * 2 * turns;
      /* normalise so the end is below start */
      while (end > start - Math.PI * 2 * 5) { end -= Math.PI * 2; }
      var dur = reduced ? 400 : 5600, t0 = performance.now(), lastSeg = -1;
      (function frame(now) {
        var t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3.2); WHEEL.angle = start + (end - start) * e; drawWheel(WHEEL.angle);
        var seg = Math.floor(((-WHEEL.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / step); if (seg !== lastSeg) { lastSeg = seg; sfx.tick(); WHEEL.lights = (WHEEL.lights + 1) % 3; }
        if (t < 1) { requestAnimationFrame(frame); } else { land(j); }
      })(t0);
    }).catch(function (e) { S.spinning = false; $('#arc-wheel-wrap', p).classList.remove('spinning'); res.className = 'arc-spin-result miss'; res.innerHTML = '<b>No spin</b><small>' + esc(e.message) + '</small>'; btn.disabled = false; });
    function land(j) {
      S.spinning = false; $('#arc-wheel-wrap', p).classList.remove('spinning');
      var seg = j.segment, won = j.paid > 0;
      res.className = 'arc-spin-result ' + (won ? 'win' : 'miss');
      res.innerHTML = won ? '<b>+' + fmt(j.paid) + ' LB</b><small>' + (seg.lb >= 100 ? 'Big hit. ' : '') + 'Paid to your balance.' + (j.note ? ' ' + esc(j.note) : '') + '</small>'
        : (seg.kind === 'spin' ? '<b>Extra spin</b><small>One more spin, right now.</small>' : '<b>Tape slip</b><small>Not this time. Tomorrow is another spin.</small>');
      if (won) { if (seg.lb >= 100) { sfx.big(); confetti(260, true); buzz([60, 40, 60, 40, 120]); } else { sfx.win(); confetti(120, true); buzz(50); } tween($('#arc-bal', panel), S.state.balance, j.balance); } else if (seg.kind === 'spin') { sfx.coin(); } else { sfx.lose(); }
      S.state.balance = j.balance; S.state.spin.allowance = j.allowance; S.state.capLeft = Math.max(0, S.state.capLeft - j.paid); renderSpin(p); onState();
    }
  }
  function tween(el, from, to) { var t0 = performance.now(); (function f(now) { var t = Math.min(1, (now - t0) / 900); el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))); if (t < 1) { requestAnimationFrame(f); } })(t0); }

  /* ======================= Stream Jackpot ======================= */
  var JP = { prize: 100, minutes: 10, timer: 0 };
  function renderJackpot(p) {
    var st = S.state, jp = st.jackpot, r = jp.round, last = jp.last;
    var h = '<div class="arc-jp"><div>';
    if (r) {
      h += '<div class="arc-pot"><small>STREAM JACKPOT' + (r.title ? ' · ' + esc(r.title.toUpperCase()) : '') + '</small><b>' + fmt(r.prize) + '<em>LB</em></b><div class="host">Put up by @' + esc(r.host.handle || r.host.name) + '</div>'
        + '<div class="arc-ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" id="arc-jp-ring" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg><div class="t"><div><span id="arc-jp-clock">--:--</span><small>UNTIL THE DRAW</small></div></div></div>'
        + '<div class="arc-tickets"><div><b id="arc-jp-mine">' + fmt(r.mine) + '</b><span>YOUR TICKETS</span></div><div><b>' + fmt(r.tickets) + '</b><span>IN THE DRUM</span></div><div><b>' + fmt(r.players) + '</b><span>PLAYERS</span></div></div>'
        + (st.signedIn ? (st.isHost ? '<div class="arc-ticket-stub">You are the host · viewers earn tickets every minute</div>' : '<div class="arc-ticket-stub">🎟 You are in · +1 ticket a minute while you watch</div>') : '<div class="arc-ticket-stub">Sign in to collect tickets</div>')
        + (r.tickets && r.mine ? '<div style="margin-top:8px;font:600 12px \'IBM Plex Mono\',monospace;color:#8fa3b5">Your odds right now: ' + Math.max(1, Math.round(r.mine / r.tickets * 100)) + '%</div>' : '') + '</div>';
      if (st.isHost) { h += '<div class="arc-row" style="margin-top:10px"><button type="button" class="arc-btn red" id="arc-jp-draw">Draw now</button><span style="font-size:12px;color:#8fa3b5">Ends the clock early and picks the winner.</span></div>'; }
    } else {
      var animating = last && JP.animating === last.id;
      h += '<div class="arc-pot"><small>STREAM JACKPOT' + (animating ? ' · THE DRAW' : '') + '</small>' + (animating ? '<b>' + fmt(last.prize) + '<em>LB</em></b>' : '<b style="color:#5d7085;text-shadow:none">—</b><div class="host">No jackpot running in this room</div>') + '<div id="arc-jp-drum-host"></div>'
        + (last && last.winner && !animating ? '<div class="arc-winner"><img src="' + esc(last.winner.avatar) + '" alt=""><b>@' + esc(last.winner.handle || last.winner.name) + '</b><span>won ' + fmt(last.prize) + ' LB</span></div>' : (animating ? '' : '<div style="margin-top:12px;font-size:12.5px;color:#8fa3b5">The host puts up a prize, the clock runs, and every minute you watch is a ticket. Drawn live.</div>')) + '</div>';
    }
    h += '</div><div>';
    if (st.isHost && !r) {
      h += '<div class="arc-card arc-host"><h4>Start a jackpot</h4><div class="arc-field"><label>Prize from your balance (' + fmt(st.balance) + ' LB)</label><div class="arc-chips" id="arc-jp-prizes">' + [25, 50, 100, 250, 500, 1000].map(function (v) { return '<button type="button" data-v="' + v + '"' + (v === JP.prize ? ' class="on"' : '') + (v > st.balance ? ' disabled' : '') + '>' + fmt(v) + '</button>'; }).join('') + '</div></div>'
        + '<div class="arc-field"><label>Clock</label><div class="arc-chips" id="arc-jp-mins">' + jp.minutes.map(function (m) { return '<button type="button" data-v="' + m + '"' + (m === JP.minutes ? ' class="on"' : '') + '>' + m + ' min</button>'; }).join('') + '</div></div>'
        + '<div class="arc-field"><label>Title (optional)</label><input type="text" id="arc-jp-title" maxlength="60" placeholder="Power hour jackpot"></div>'
        + '<button type="button" class="arc-btn gold" id="arc-jp-start">Put up ' + fmt(JP.prize) + ' LB</button><div class="hint" style="font-size:12px;color:#5d7085;margin-top:8px">Leaves your balance now. If nobody shows, it comes back.</div></div>';
    } else {
      h += '<div class="arc-card"><h4>Recent winners</h4><div class="arc-list">' + (jp.recent.length ? jp.recent.map(function (x) { return '<div class="arc-li"><img src="' + esc(x.winner.avatar) + '" alt=""><span class="n">@' + esc(x.winner.handle || x.winner.name) + '<br><small style="color:#5d7085">in @' + esc(x.host.handle || x.host.name) + '\'s room</small></span><span class="p">+' + fmt(x.prize) + '</span></div>'; }).join('') : '<div class="arc-empty">No draws yet. Hosts start them from this tab.</div>') + '</div></div>';
      if (!st.isHost) { h += '<div class="arc-note" style="margin-top:14px">Hosts: open this tab on your own stream to put up a prize. Tickets are free; the draw is random and weighted by minutes watched.</div>'; }
    }
    h += '</div></div>';
    p.innerHTML = h;
    if (r) { runClock(r); }
    var pr = $('#arc-jp-prizes', p); if (pr) { pr.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || b.disabled) { return; } JP.prize = +b.getAttribute('data-v'); sfx.click(); renderJackpot(p); }); }
    var mn = $('#arc-jp-mins', p); if (mn) { mn.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) { return; } JP.minutes = +b.getAttribute('data-v'); sfx.click(); renderJackpot(p); }); }
    var sb = $('#arc-jp-start', p); if (sb) { sb.addEventListener('click', function () { sb.disabled = true; api('/jackpot/start', roomBody({ prize: JP.prize, minutes: JP.minutes, title: ($('#arc-jp-title', p) || {}).value || '' })).then(function (j) { S.state.jackpot.round = j.round; S.state.balance = j.balance; onState(); sfx.coin(); toast('Jackpot is live. Tell the room.'); renderJackpot(p); }).catch(function (e) { sb.disabled = false; toast(e.message); }); }); }
    var db = $('#arc-jp-draw', p); if (db) { db.addEventListener('click', function () { db.disabled = true; api('/jackpot/draw', roomBody()).then(function (j) { onDrawn(j.round); }).catch(function (e) { db.disabled = false; toast(e.message); }); }); }
  }
  function runClock(r) {
    clearInterval(JP.timer);
    var end = new Date(r.endsAt).getTime(), total = Math.max(1, (end - new Date(r.startsAt).getTime()) / 1000);
    var tick = function () {
      var left = Math.max(0, Math.round((end - Date.now()) / 1000)), ring = $('#arc-jp-ring', panel), clk = $('#arc-jp-clock', panel);
      if (!ring || !clk) { clearInterval(JP.timer); return; }
      clk.textContent = Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2); ring.style.strokeDashoffset = String(276.5 * (1 - left / total));
      if (left <= 0) { clearInterval(JP.timer); clk.textContent = 'DRAW'; api('/state' + qsRoom).then(function (j) { S.state = j; if (j.jackpot.last && (!j.jackpot.round)) { onDrawn(j.jackpot.last); } }).catch(function () {}); }
    };
    tick(); JP.timer = setInterval(tick, 1000);
  }
  function onDrawn(round) {
    if (!round || round.status !== 'done' || onDrawn.seen === round.id) { return; } onDrawn.seen = round.id;
    S.state.jackpot.round = null; S.state.jackpot.last = round; fab.classList.remove('has-round'); JP.animating = round.id;
    if (!S.open) { openPanel(true); } S.tab = 'jackpot'; $$('[data-tab]', panel).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tab') === 'jackpot'); }); $$('.arc-pane', panel).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-pane') === 'jackpot'); });
    var p = $('.arc-pane[data-pane="jackpot"]', panel); renderJackpot(p);
    var host = $('#arc-jp-drum-host', p); if (!host) { return; }
    var names = ['@' + (round.winner ? (round.winner.handle || round.winner.name) : 'nobody')];
    var fillers = ['@bulltrader', '@tape_reader', '@optionsdesk', '@swingqueen', '@gammaguy', '@loopfan', '@deltaone', '@vwapper']; for (var i = 0; i < 18; i++) { names.unshift(fillers[i % fillers.length]); }
    host.innerHTML = '<div class="arc-drum"><div class="reel" id="arc-reel">' + names.map(function (n, i) { return '<div>' + (i === names.length - 1 && round.winner ? '<img src="' + esc(round.winner.avatar) + '" alt="">' : '') + esc(n) + '</div>'; }).join('') + '</div></div>';
    var reel = $('#arc-reel', host), total = (names.length - 1) * 60, t0 = performance.now(), dur = reduced ? 300 : 3800, last = -1;
    (function f(now) { var t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3); var y = total * e; reel.style.transform = 'translateY(-' + y + 'px)'; var idx = Math.floor(y / 60); if (idx !== last) { last = idx; sfx.tick(); } if (t < 1) { requestAnimationFrame(f); } else { reveal(); } })(t0);
    function reveal() {
      JP.animating = 0;
      var me = round.winner && S.state && C.userId && round.winner.id === C.userId;
      if (round.winner) { host.innerHTML += '<div class="arc-winner"><img src="' + esc(round.winner.avatar) + '" alt=""><b>@' + esc(round.winner.handle || round.winner.name) + (me ? ' (you!)' : '') + '</b><span>takes ' + fmt(round.prize) + ' LB</span></div>'; confetti(me ? 320 : 160, true); if (me) { sfx.big(); buzz([80, 40, 80, 40, 200]); load(); } else { sfx.win(); } }
      else { host.innerHTML += '<div class="arc-note">Nobody collected a ticket, so the prize went back to the host.</div>'; }
    }
  }

  /* ======================= Tape Call ======================= */
  var TAPE = { timer: 0, spark: null };
  function renderTape(p) {
    var st = S.state, tp = st.tape, open = tp.open;
    if (!$('.arc-tape', p)) {
      p.innerHTML = '<div class="arc-tape"><div><div class="arc-card"><h4>Call the next minute</h4><div class="arc-chips" id="arc-tape-syms">' + ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'AMZN', 'META'].map(function (s) { return '<button type="button" data-v="' + s + '"' + (s === S.sym ? ' class="on"' : '') + '>$' + s + '</button>'; }).join('') + '</div>'
        + '<div class="arc-field" style="margin-top:10px"><input type="text" id="arc-tape-sym" maxlength="6" placeholder="Any ticker" value="' + esc(S.sym) + '" style="text-transform:uppercase;font-family:IBM Plex Mono,monospace;font-weight:700"></div>'
        + '<div class="arc-quote"><span class="sym" id="arc-q-sym">$' + esc(S.sym) + '</span><span class="px" id="arc-q-px">—</span><span class="pct" id="arc-q-pct"></span></div><div class="arc-spark"><canvas id="arc-spark" width="800" height="144"></canvas></div>'
        + '<div class="arc-call-btns"><button type="button" class="arc-btn green" id="arc-call-up">▲ UP</button><button type="button" class="arc-btn red" id="arc-call-down">▼ DOWN</button></div><div id="arc-call-live"></div><div id="arc-call-res"></div><div id="arc-tape-note" style="margin-top:10px"></div></div></div>'
        + '<div><div class="arc-card"><h4>Room lean · last 10 calls</h4><div class="arc-lean"><div class="bar"><i id="arc-lean-bar" style="width:50%"></i></div><div class="lbl"><span id="arc-lean-up">▲ 0</span><span id="arc-lean-down">▼ 0</span></div></div><div class="arc-list arc-calls" id="arc-room-calls" style="margin-top:10px"></div></div>'
        + '<div class="arc-card" style="margin-top:12px"><h4>Your calls</h4><div class="arc-list arc-calls" id="arc-my-calls"></div></div>'
        + '<div class="arc-card" style="margin-top:12px"><h4>This month</h4><div class="arc-row" id="arc-tape-me"></div></div></div></div>';
      $('#arc-tape-syms', p).addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) { return; } setSym(b.getAttribute('data-v')); });
      $('#arc-tape-sym', p).addEventListener('change', function () { setSym(this.value); });
      $('#arc-call-up', p).addEventListener('click', function () { call('up'); }); $('#arc-call-down', p).addEventListener('click', function () { call('down'); });
      startQuotes();
    }
    var can = st.signedIn && !open && tp.todayLeft > 0;
    $('#arc-call-up', p).disabled = !can; $('#arc-call-down', p).disabled = !can;
    $('#arc-tape-note', p).innerHTML = !st.signedIn ? signIn() : (open ? '' : (tp.todayLeft > 0 ? '<div style="font-size:12px;color:#5d7085">' + tp.todayLeft + ' calls left today · +' + 10 + ' points a win, +5 on a streak of 3 · top 3 each day get ' + tp.prizes.join(' / ') + ' LB</div>' : '<div class="arc-note">Daily call limit reached. The ladder keeps your points.</div>'));
    renderOpenCall(open);
    var up = tp.room.filter(function (c) { return c.dir === 'up'; }).length, dn = tp.room.length - up;
    $('#arc-lean-bar', p).style.width = (tp.room.length ? Math.round(up / tp.room.length * 100) : 50) + '%'; $('#arc-lean-up', p).textContent = '▲ ' + up; $('#arc-lean-down', p).textContent = '▼ ' + dn;
    $('#arc-room-calls', p).innerHTML = tp.room.length ? tp.room.slice(0, 6).map(callRow).join('') : '<div class="arc-empty">No calls in this room yet. Be first.</div>';
    $('#arc-my-calls', p).innerHTML = tp.mine.length ? tp.mine.map(callRow).join('') : '<div class="arc-empty">Your calls show up here.</div>';
    $('#arc-tape-me', p).innerHTML = tp.me ? '<div class="arc-stat"><b>#' + tp.me.rank + '</b><span>Rank</span></div><div class="arc-stat"><b>' + fmt(tp.me.points) + '</b><span>Points</span></div><div class="arc-stat"><b>' + tp.me.wins + '/' + tp.me.plays + '</b><span>Hit rate</span></div><div class="arc-stat"><b>' + tp.me.streak + '</b><span>Streak</span></div>' : '<div class="arc-empty">Make a call to get on the ladder.</div>';
  }
  function callRow(c) { return '<div class="arc-li"><span class="dir ' + c.dir + '">' + (c.dir === 'up' ? '▲' : '▼') + ' $' + esc(c.symbol) + '</span><span class="n">' + (c.player ? '@' + esc(c.player.handle || c.player.name) : '') + ' <small style="color:#5d7085">' + c.p0.toFixed(2) + (c.p1 != null ? ' → ' + c.p1.toFixed(2) : '') + '</small></span><span class="res ' + (c.result || '') + '">' + (c.result ? c.result.toUpperCase() + (c.points ? ' +' + c.points : '') : c.secondsLeft + 's') + '</span></div>'; }
  function setSym(v) { v = String(v || '').toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6); if (!v) { return; } S.sym = v; S.series = []; var p = $('.arc-pane[data-pane="tape"]', panel); $('#arc-tape-sym', p).value = v; $('#arc-q-sym', p).textContent = '$' + v; $$('#arc-tape-syms button', p).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); $('#arc-q-px', p).textContent = '—'; fetchQuote(); }
  function startQuotes() { clearInterval(S.quoteT); fetchQuote(); S.quoteT = setInterval(function () { if (S.open && S.tab === 'tape' && !document.hidden) { fetchQuote(); } }, 4000); }
  function fetchQuote() {
    var syms = [S.sym]; var open = S.state && S.state.tape && S.state.tape.open; if (open && open.symbol !== S.sym) { syms.push(open.symbol); }
    fetch(C.quotes + '?symbols=' + encodeURIComponent(syms.join(','))).then(function (r) { return r.json(); }).then(function (j) {
      var q = (j && j.quotes) || {}; S.quotes = q; var d = q[S.sym], p = $('.arc-pane[data-pane="tape"]', panel); if (!p) { return; }
      var px = $('#arc-q-px', p), pct = $('#arc-q-pct', p);
      if (d && d.last) { var last = Number(d.last); px.textContent = last.toFixed(2); px.className = 'px ' + (S.lastPx && last !== S.lastPx ? (last > S.lastPx ? 'up' : 'down') : ''); S.lastPx = last; pct.textContent = (d.pct >= 0 ? '+' : '') + Number(d.pct || 0).toFixed(2) + '% today'; S.series.push(last); if (S.series.length > 60) { S.series.shift(); } drawSpark(); }
      if (open) { renderOpenCall(open); }
    }).catch(function () {});
  }
  function drawSpark() {
    var cv = $('#arc-spark', panel); if (!cv) { return; } var ctx = cv.getContext('2d'), W = cv.width, H = cv.height, s = S.series; ctx.clearRect(0, 0, W, H); if (s.length < 2) { return; }
    var min = Math.min.apply(null, s), max = Math.max.apply(null, s), rng = Math.max(max - min, 0.01), up = s[s.length - 1] >= s[0];
    var open = S.state && S.state.tape && S.state.tape.open;
    if (open && open.symbol === S.sym) { var y0 = H - ((open.p0 - min) / rng) * (H - 20) - 10; ctx.strokeStyle = 'rgba(255,209,102,.7)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke(); ctx.setLineDash([]); }
    ctx.beginPath(); s.forEach(function (v, i) { var x = i / (s.length - 1) * W, y = H - ((v - min) / rng) * (H - 20) - 10; if (i) { ctx.lineTo(x, y); } else { ctx.moveTo(x, y); } });
    ctx.lineWidth = 3; ctx.strokeStyle = up ? '#00ff88' : '#ff5e6e'; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
    var lx = W, ly = H - ((s[s.length - 1] - min) / rng) * (H - 20) - 10; ctx.beginPath(); ctx.arc(lx - 4, ly, 5, 0, 6.283); ctx.fillStyle = up ? '#00ff88' : '#ff5e6e'; ctx.fill();
  }
  function renderOpenCall(open) {
    var p = $('.arc-pane[data-pane="tape"]', panel), host = $('#arc-call-live', p); if (!host) { return; }
    clearInterval(TAPE.timer);
    if (!open) { host.innerHTML = ''; return; }
    if (open.result) { showResult(open); return; }
    var q = S.quotes[open.symbol], now = q && q.last ? Number(q.last) : null, d = now != null ? now - open.p0 : 0, good = now != null ? ((d > 0) === (open.dir === 'up') && d !== 0) : null;
    host.innerHTML = '<div class="arc-call-live"><div class="arc-ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" id="arc-call-ring" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg><div class="t"><span id="arc-call-clock">' + open.secondsLeft + '</span></div></div>'
      + '<div class="body"><b>' + (open.dir === 'up' ? '▲ UP' : '▼ DOWN') + ' on $' + esc(open.symbol) + ' from ' + open.p0.toFixed(2) + '</b><div class="delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '" id="arc-call-delta">' + (now != null ? (d >= 0 ? '+' : '') + d.toFixed(2) : '…') + '</div><small>' + (good === null ? 'Waiting on the tape' : good ? 'In the money right now' : 'Against you right now') + '</small></div></div>';
    var end = new Date(open.resolvesAt).getTime(), total = S.state.tape.seconds || 60;
    TAPE.timer = setInterval(function () {
      var left = Math.max(0, Math.round((end - Date.now()) / 1000)), c = $('#arc-call-clock', p), r = $('#arc-call-ring', p); if (!c) { clearInterval(TAPE.timer); return; }
      c.textContent = left; r.style.strokeDashoffset = String(276.5 * (1 - left / total)); if (left <= 5 && left > 0) { sfx.tick(); }
      if (left <= 0) { clearInterval(TAPE.timer); c.textContent = '…'; setTimeout(function () { api('/state' + qsRoom).then(function (j) { S.state = j; onState(); var o = j.tape.open, done = (!o && j.tape.mine[0] && j.tape.mine[0].id === open.id) ? j.tape.mine[0] : o; if (done && done.result) { showResult(done); } renderTape(p); if (done && done.result) { showResult(done); } }); }, 1500); }
    }, 1000);
  }
  function showResult(c) {
    var p = $('.arc-pane[data-pane="tape"]', panel), host = $('#arc-call-live', p); if (!host) { return; } clearInterval(TAPE.timer);
    host.innerHTML = '<div class="arc-result ' + c.result + '"><b>' + (c.result === 'win' ? 'CALLED IT' : c.result === 'loss' ? 'TAPE WENT THE OTHER WAY' : 'FLAT · PUSH') + '</b><span>$' + esc(c.symbol) + ' ' + c.p0.toFixed(2) + ' → ' + (c.p1 != null ? c.p1.toFixed(2) : '?') + (c.points ? ' · +' + c.points + ' points' : '') + '</span></div>';
    if (showResult.seen !== c.id) { showResult.seen = c.id; if (c.result === 'win') { sfx.win(); confetti(110, false); buzz(50); } else if (c.result === 'loss') { sfx.lose(); } else { sfx.coin(); } }
  }
  function call(dir) {
    var p = $('.arc-pane[data-pane="tape"]', panel); sfx.click(); $('#arc-call-up', p).disabled = true; $('#arc-call-down', p).disabled = true;
    api('/tape/call', roomBody({ symbol: S.sym, dir: dir })).then(function (j) { S.state.tape.open = j.call; S.state.tape.todayLeft--; S.state.tape.mine.unshift(j.call); S.state.tape.room.unshift(Object.assign({ player: { handle: 'you' } }, j.call)); renderTape(p); fetchQuote(); }).catch(function (e) { toast(e.message); renderTape(p); });
  }

  /* ======================= Ladders ======================= */
  function renderLadder(p) {
    p.innerHTML = '<div class="arc-grid2"><div class="arc-card"><h4>Tape Call · this month</h4><div class="arc-list" id="arc-lad-tape"><div class="arc-empty">Loading…</div></div></div><div class="arc-card"><h4>Luckiest spinners · this month</h4><div class="arc-list" id="arc-lad-spin"><div class="arc-empty">Loading…</div></div></div></div><div class="arc-card" style="margin-top:12px"><h4>Jackpot winners</h4><div class="arc-list" id="arc-lad-jp"></div></div>';
    var row = function (r, unit) { var me = C.userId && r.player.id === C.userId; return '<div class="arc-li' + (me ? ' me' : '') + '"><span class="r">' + r.rank + '</span><img src="' + esc(r.player.avatar) + '" alt=""><span class="n">@' + esc(r.player.handle || r.player.name) + '<br><small style="color:#5d7085">' + r.wins + ' wins · best streak ' + r.best + '</small></span><span class="p">' + fmt(r.points) + (unit ? ' ' + unit : '') + '</span></div>'; };
    ['tape', 'spin'].forEach(function (g) { api('/ladder?game=' + g).then(function (j) { var el = $('#arc-lad-' + g, p); if (!el) { return; } el.innerHTML = j.rows.length ? j.rows.map(function (r) { return row(r, g === 'spin' ? 'LB' : ''); }).join('') : '<div class="arc-empty">Nobody on the board yet.</div>'; if (j.mine && !j.rows.some(function (r) { return C.userId && r.player.id === C.userId; })) { el.innerHTML += '<div class="arc-li me"><span class="r">' + j.mine.rank + '</span><span class="n">You</span><span class="p">' + fmt(j.mine.points) + '</span></div>'; } }).catch(function () {}); });
    var jp = S.state.jackpot.recent; $('#arc-lad-jp', p).innerHTML = jp.length ? jp.map(function (x) { return '<div class="arc-li"><img src="' + esc(x.winner.avatar) + '" alt=""><span class="n">@' + esc(x.winner.handle || x.winner.name) + ' <small style="color:#5d7085">· ' + new Date(x.drawnAt).toLocaleDateString() + '</small></span><span class="p">+' + fmt(x.prize) + ' LB</span></div>'; }).join('') : '<div class="arc-empty">No jackpots drawn yet.</div>';
  }

  /* ======================= Tables (hand-off to the games desk) ======================= */
  function renderTables(p) {
    var playTab = document.querySelector('.slw-tab[data-tab="4"]'), gp = document.querySelector('.gp-head');
    p.innerHTML = '<div class="arc-card"><h4>Player versus player</h4><p style="margin:0 0 12px;color:#8fa3b5;font-size:13.5px">Chess, Checkers, Connect Four, Tic-Tac-Toe, Spades and Blackjack run on the games desk beside the stream. Free tables are open to everyone now; staked tables put Loop Bucks on the table, winner takes the pot, no cut.</p>'
      + '<div class="arc-row">' + (playTab ? '<button type="button" class="arc-btn green" id="arc-open-play">Open the Play tab</button>' : gp ? '<button type="button" class="arc-btn green" id="arc-open-gp">Open the game panel</button>' : '<span style="color:#5d7085;font-size:12.5px">The games desk is not on this page.</span>') + '</div></div>'
      + '<div class="arc-note" style="margin-top:14px">New on every board: real materials, piece and disc motion, dealt cards, sound and a win burst. Turn sound off with the speaker button up top.</div>';
    var b1 = $('#arc-open-play', p); if (b1) { b1.addEventListener('click', function () { openPanel(false); playTab.click(); playTab.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); }
    var b2 = $('#arc-open-gp', p); if (b2) { b2.addEventListener('click', function () { openPanel(false); var w = gp.closest('.gp-wrap'); if (w && w.getAttribute('data-open') !== '1') { gp.click(); } gp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); }
  }
})();
