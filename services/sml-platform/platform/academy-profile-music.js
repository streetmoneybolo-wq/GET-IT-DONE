/* Academy profile music (the page that opens for a member): the player and the beat.
 *   player   a member's song plays INSIDE the Academy, in a music dock at the bottom of the profile, and starts by itself when the
 *            profile opens. The song is a file the member uploaded or a direct MP3/M4A link; the Academy serves it from its own
 *            address, which is the only kind of audio the Discord Activity frame lets through. (Embedded players from other sites,
 *            YouTube included, are not supported.)
 *   beat     the page moves with the music. The song is analysed live and split into five parts of the sound: KICK (40-110 Hz),
 *            BASS (110-260 Hz), VOCAL / LEAD (300 Hz - 2.5 kHz), SNARE (2.5-6 kHz) and HI-HATS (7-15 kHz), each with its own beat
 *            detector. Until the browser lets the audio engine run, the page moves to a plain beat clock instead.
 * The file builds markup from plain strings and holds no backslash, backtick or template placeholder: it is inlined into the
 * Academy page. */
(() => {
  if (window.smlProfileMusic) return;
  const CH = ['kick', 'bass', 'vocal', 'snare', 'hats'];
  const LABEL = { kick: 'KICK', bass: 'BASS', vocal: 'VOCAL', snare: 'SNARE', hats: 'HI-HATS' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the beat: five parts of the sound, each 0..1, from live analysis or from a beat clock ---------- */
  const E = { ctx: null, an: null, el: null, srcNode: null, buf: null, mode: 'idle', bpm: 110, t0: 0, last: 0, lv: {}, peak: {}, prev: {}, flux: {}, hit: {}, at: {}, out: {} };
  for (const c of CH) { E.lv[c] = 0; E.peak[c] = 0.2; E.prev[c] = 0; E.flux[c] = 0.02; E.hit[c] = 0; E.at[c] = 0; E.out[c] = 0; }
  const BANDS = { kick: [40, 110], bass: [110, 260], vocal: [300, 2500], snare: [2500, 6000], hats: [7000, 15000] };
  function attach(el) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      E.ctx = E.ctx || new AC();
      if (E.el !== el) {
        E.srcNode = E.ctx.createMediaElementSource(el);
        E.an = E.ctx.createAnalyser(); E.an.fftSize = 2048; E.an.smoothingTimeConstant = 0.35;
        E.srcNode.connect(E.an); E.an.connect(E.ctx.destination);
        E.buf = new Uint8Array(E.an.frequencyBinCount); E.el = el;
      }
      return true;
    } catch (_) { E.an = null; return false; }
  }
  function detach() { E.an = null; E.el = null; E.srcNode = null; E.mode = 'idle'; for (const c of CH) { E.hit[c] = 0; E.out[c] = 0; } }
  function clock() { E.mode = 'clock'; E.t0 = performance.now(); }
  function idle() { E.mode = 'idle'; }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function read(now) {
    const t = now || performance.now(), dt = Math.max(8, Math.min(80, t - (E.last || t - 16))); E.last = t;
    const decay = Math.exp(-dt / 120);
    if (E.mode === 'live' && E.an && E.el && !E.el.paused) {
      E.an.getByteFrequencyData(E.buf);
      const hz = E.ctx.sampleRate / E.an.fftSize;
      for (const c of CH) {
        const a = Math.max(1, Math.floor(BANDS[c][0] / hz)), b = Math.max(a + 1, Math.min(E.buf.length - 1, Math.ceil(BANDS[c][1] / hz)));
        let sum = 0; for (let i = a; i <= b; i++) sum += E.buf[i];
        const level = sum / (b - a + 1) / 255;
        E.peak[c] = Math.max(level, E.peak[c] * 0.9965, 0.12);
        const norm = level / E.peak[c], flux = Math.max(0, norm - E.prev[c]);
        E.prev[c] = norm;
        const gate = t - E.at[c] > 95 && flux > 0.09 && flux > E.flux[c] * 1.7 && norm > 0.35;
        E.flux[c] = E.flux[c] * 0.93 + flux * 0.07;
        if (gate) { E.hit[c] = 1; E.at[c] = t; } else E.hit[c] *= decay;
        E.lv[c] = E.lv[c] * 0.55 + norm * 0.45;
        E.out[c] = clamp01(Math.max(E.hit[c], E.lv[c] * (c === 'vocal' ? 0.95 : 0.7)));
      }
    } else if (E.mode === 'clock') {
      const beat = (t - E.t0) / (60000 / E.bpm), b = beat - Math.floor(beat), bar = Math.floor(beat) % 4, half = (beat * 2) - Math.floor(beat * 2);
      const env = (ph, k) => Math.exp(-ph * k);
      E.out.kick = clamp01(bar === 0 || bar === 2 ? env(b, 6) : env(b, 6) * 0.35);
      E.out.bass = clamp01((bar === 0 || bar === 2 ? env(b, 2.6) : env(b, 4) * 0.5) * 0.9);
      E.out.snare = clamp01(bar === 1 || bar === 3 ? env(b, 7) : 0);
      E.out.hats = clamp01(env(half, 9) * 0.8);
      E.out.vocal = clamp01(0.35 + 0.35 * Math.sin(beat * 0.9) * Math.sin(beat * 0.37 + 1) + 0.25 * env(b, 3));
    } else {
      for (const c of CH) E.out[c] = E.out[c] * decay;
    }
    return E.out;
  }
  function frequency() { if (E.mode === 'live' && E.an && E.buf) { E.an.getByteFrequencyData(E.buf); return E.buf; } return null; }
  /* where each module listens unless the member picked a part for it */
  const DEFAULT_REACT = { head: 'vocal', stats: 'kick', server: 'bass', paper: 'snare', song: 'hats', social: 'hats', feed: 'bass' };

  /* ---------- the dock: the player on the profile page ---------- */
  const css = document.createElement('style');
  css.textContent = '#pv-dock{position:fixed;left:12px;bottom:12px;z-index:2147482550;width:min(380px,calc(100vw - 24px));border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(7,12,20,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 18px 50px rgba(0,0,0,.65);color:#e6eef2;font:600 .72rem system-ui,sans-serif;overflow:hidden;display:none}'
    + '#pv-dock.on{display:block}#pv-dock .dk-h{display:flex;align-items:center;gap:8px;padding:8px 10px}#pv-dock .dk-t{flex:1;min-width:0}#pv-dock .dk-t b{display:block;color:#fff;font:800 .76rem system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#pv-dock .dk-t small{display:block;color:#8fa5b1;font-size:.6rem}'
    + '#pv-dock button{border:1px solid rgba(255,255,255,.16);border-radius:8px;background:rgba(255,255,255,.05);color:#e6eef2;padding:5px 9px;font:800 .66rem system-ui,sans-serif;cursor:pointer}#pv-dock button.go{background:var(--acc,#00c47d);color:#041b12;border-color:transparent}'
    + '#pv-dock.inl{position:static;width:auto;margin-top:10px;box-shadow:none;background:rgba(255,255,255,.04);z-index:auto}#pv-dock.inl [data-dk=min]{display:none}'
    + '#pv-dock .dk-b{padding:0 10px 10px}#pv-dock.min .dk-b{display:none}'
    + '#pv-dock .dk-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;cursor:pointer;margin:2px 0 8px}#pv-dock .dk-bar i{display:block;height:100%;width:0;background:var(--acc,#00c47d)}'
    + '#pv-dock .dk-row{display:flex;align-items:center;gap:8px;color:#8fa5b1;font-size:.6rem}#pv-dock input[type=range]{flex:1;accent-color:var(--acc,#00c47d)}'
    + '#pv-dock .dk-ch{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:8px}#pv-dock .dk-ch div{text-align:center;font:800 .5rem ui-monospace,monospace;letter-spacing:.06em;color:#8fa5b1}#pv-dock .dk-ch span{display:block;height:34px;border-radius:5px;background:rgba(255,255,255,.07);position:relative;overflow:hidden;margin-bottom:3px}#pv-dock .dk-ch span i{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--acc,#00c47d);transition:height .05s linear}'
    + '#pv-dock .dk-note{margin:6px 0 0;color:#7f95a1;font-size:.58rem;line-height:1.4}#pv-dock .dk-tap{display:none;margin:0 10px 10px;padding:8px;border-radius:9px;background:var(--acc,#00c47d);color:#041b12;font:900 .72rem system-ui,sans-serif;text-align:center;cursor:pointer}#pv-dock.blocked .dk-tap{display:block}';
  document.head.appendChild(css);

  const D = { el: null, audio: null, song: null, playing: false, userPaused: false, armed: null, bars: null, prog: null, time: null, raf: 0, iv: 0, onState: null };
  const fmt = (s) => (Number.isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00');

  function block(text) { if (!D.el) return; const t = D.el.querySelector('.dk-tap'); if (t && text) t.textContent = text; D.el.classList.add('blocked'); }
  function unblock() { if (D.el) D.el.classList.remove('blocked'); }
  function setPlaying(on) {
    D.playing = on;
    if (D.el) { const b = D.el.querySelector('[data-dk=play]'); if (b) b.textContent = on ? '❚❚ Pause' : '▶ Play'; if (on) unblock(); }
    if (D.onState) D.onState(on);
  }
  /* the song is heard first; the live analysis joins in only once the browser lets the audio engine run (a suspended engine would
     swallow the sound), and until then the page moves to a beat clock */
  function tryAnalyse() {
    const a = D.audio; if (!a || a.paused) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; E.ctx = E.ctx || new AC(); } catch (_) { return; }
    if (E.ctx.state === 'suspended') E.ctx.resume().catch(() => {});
    if (E.ctx.state === 'running') { if (E.el !== a) { if (attach(a)) E.mode = 'live'; } else E.mode = 'live'; }
    else if (E.mode !== 'clock') clock();
  }
  function tick() {
    D.raf = requestAnimationFrame(tick);
    if (!D.el) return;
    const a = D.audio;
    if (a && D.prog && a.duration > 0) { D.prog.firstChild.style.width = (a.currentTime / a.duration * 100) + '%'; D.time.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration); }
    if (D.bars) { const o = E.out; CH.forEach((c, i) => { D.bars[i].style.height = Math.max(3, Math.round(o[c] * 34)) + 'px'; }); }
  }
  function playAudio(auto) {
    const a = D.audio; if (!a) return;
    const p = a.play(); if (!p || !p.then) { setPlaying(true); return; }
    p.then(() => { setPlaying(true); tryAnalyse(); }).catch(() => { setPlaying(false); if (auto) { block('▶ Tap to start the music'); arm(); } });
  }
  /* browsers hold autoplay back until the person has touched the page; the first tap, click or key press anywhere starts it */
  function arm() {
    if (D.armed) return;
    const go = () => { cancel(); if (D.userPaused) return; if (D.audio) { if (D.audio.paused) playAudio(false); else tryAnalyse(); } };
    const cancel = () => { for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, go, true); D.armed = null; };
    for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, go, true);
    D.armed = cancel;
  }
  function toggle() {
    if (!D.el || !D.audio) return;
    if (D.audio.paused) { D.userPaused = false; playAudio(false); } else { D.userPaused = true; D.audio.pause(); setPlaying(false); }
  }
  function unmount() {
    if (D.raf) cancelAnimationFrame(D.raf); D.raf = 0;
    if (D.armed) D.armed();
    if (D.iv) clearInterval(D.iv); D.iv = 0;
    if (D.audio) { try { D.audio.pause(); } catch (_) { /* fine */ } D.audio.remove(); }
    if (D.el) D.el.remove();
    D.el = D.audio = D.song = D.bars = D.prog = D.time = null; D.playing = false; D.userPaused = false;
    detach();
  }
  /* mount(song, ctx): song = { kind: 'audio', title, rev? }; ctx = { userId, token, accent, onState(playing), onError(text) }.
     Returns false when there is nothing to play. */
  function mount(song, ctx) {
    if (!song || song.kind !== 'audio') { unmount(); return false; }
    const same = D.song && (D.song.url || '') === (song.url || '') && (D.song.rev || 0) === (song.rev || 0) && D.el;
    if (same) { D.onState = ctx.onState || null; D.el.style.setProperty('--acc', ctx.accent || '#00c47d'); D.song = song; D.el.classList.add('on'); return true; }
    unmount();
    D.song = song; D.onState = ctx.onState || null;
    const el = document.createElement('div'); el.id = 'pv-dock'; el.className = 'on'; el.style.setProperty('--acc', ctx.accent || '#00c47d');
    el.innerHTML = '<div class="dk-h"><div class="dk-t"><b>♫ ' + esc(song.title || 'Profile song') + '</b><small>Academy player</small></div><button type="button" class="go" data-dk="play">▶ Play</button><button type="button" data-dk="min" title="Minimise">▁</button></div>'
      + '<div class="dk-tap" data-dk="tap">▶ Tap to start the music</div><div class="dk-b"><div class="dk-bar" data-dk="bar"><i></i></div><div class="dk-row"><span data-dk="time">0:00 / 0:00</span><span style="flex:1"></span>🔊<input type="range" data-dk="vol" min="0" max="100" value="80" aria-label="Volume"></div>'
      + '<div class="dk-ch">' + CH.map((c) => '<div><span><i></i></span>' + LABEL[c] + '</div>').join('') + '</div><p class="dk-note">The page moves to the kick, bass, vocals, snare and hi-hats in this song.</p></div>';
    D.el = el;
    D.bars = [...el.querySelectorAll('.dk-ch span i')]; D.prog = el.querySelector('[data-dk=bar]'); D.time = el.querySelector('[data-dk=time]');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dk]'); if (!b) return;
      const k = b.getAttribute('data-dk');
      if (k === 'play') toggle();
      else if (k === 'tap') { D.userPaused = false; playAudio(false); tryAnalyse(); }
      else if (k === 'min') { el.classList.toggle('min'); b.textContent = el.classList.contains('min') ? '▢' : '▁'; }
      else if (k === 'bar' && D.audio && D.audio.duration > 0) { const r = b.getBoundingClientRect(); D.audio.currentTime = D.audio.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
    });
    const vol = el.querySelector('[data-dk=vol]'); if (vol) vol.addEventListener('input', () => { if (D.audio) D.audio.volume = vol.value / 100; });
    const a = document.createElement('audio'); a.preload = 'auto'; a.loop = true; a.crossOrigin = 'anonymous'; a.volume = 0.8; a.style.display = 'none';
    a.src = '/academy-activity/profiles/' + encodeURIComponent(ctx.userId) + '/audio?t=' + encodeURIComponent(ctx.token) + (song.rev ? '&v=' + song.rev : '');
    el.appendChild(a); D.audio = a;
    a.addEventListener('error', () => { if (ctx.onError) ctx.onError('That song could not be played. Upload an MP3 or M4A in Customize, or paste a direct link to one.'); setPlaying(false); });
    a.addEventListener('pause', () => { if (!a.ended) setPlaying(false); });
    a.addEventListener('playing', () => { setPlaying(true); tryAnalyse(); });
    D.iv = setInterval(tryAnalyse, 500);
    playAudio(true);
    D.raf = requestAnimationFrame(tick);
    dockInto(ctx.slot ? ctx.slot() : null);
    return true;
  }
  /* the player lives inside the profile's Song module; only when that module is not on the page does it float at the corner */
  function dockInto(slot) {
    const el = D.el; if (!el) return;
    if (slot) { el.classList.add('inl'); el.classList.remove('min'); if (el.parentNode !== slot) slot.appendChild(el); }
    else { el.classList.remove('inl'); if (el.parentNode !== document.body) document.body.appendChild(el); }
  }
  function setAccent(c) { if (D.el) D.el.style.setProperty('--acc', c || '#00c47d'); }
  function show(on) { if (D.el) D.el.classList.toggle('on', !!on); }

  window.smlProfileMusic = {
    CH, LABEL, DEFAULT_REACT, mount, unmount, dockInto, toggle, read, frequency, setAccent, show,
    isPlaying: () => D.playing, active: () => !!D.el, mode: () => E.mode
  };
})();
