/* Academy profile music (the page that opens for a member): the player and the beat.
 *   player   a member's song plays INSIDE the Academy, in a music dock at the bottom of the profile, and starts by itself when the
 *            profile opens. A direct audio link plays through our own player; a YouTube, Spotify, SoundCloud or Apple Music link
 *            plays in that service's embedded player in the same dock. Nothing opens in another window.
 *   beat     the page moves with the music. A direct audio link is analysed live and split into five parts of the sound: KICK
 *            (40-110 Hz), BASS (110-260 Hz), VOCAL / LEAD (300 Hz - 2.5 kHz), SNARE (2.5-6 kHz) and HI-HATS (7-15 kHz), each with
 *            its own beat detector. Browsers do not let a page listen to another site's embedded player, so for YouTube / Spotify /
 *            SoundCloud / Apple the same five parts are driven by a beat clock at the BPM the member sets (the editor says so).
 * The file builds markup from plain strings and holds no backslash, backtick or template placeholder: it is inlined into the
 * Academy page. */
(() => {
  if (window.smlProfileMusic) return;
  const CH = ['kick', 'bass', 'vocal', 'snare', 'hats'];
  const LABEL = { kick: 'KICK', bass: 'BASS', vocal: 'VOCAL', snare: 'SNARE', hats: 'HI-HATS' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idOk = (s) => /^[A-Za-z0-9_-]{5,64}$/.test(String(s || ''));

  /* ---------- the embedded players (fixed provider hosts; only an id or the song's own link goes in) ---------- */
  function embed(song) {
    if (!song || !song.url) return null;
    let u; try { u = new URL(song.url); } catch (_) { return null; }
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www[.]/, '').replace(/^m[.]/, ''), parts = u.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'music.youtube.com') {
      let id = '';
      if (host === 'youtu.be') id = parts[0] || '';
      else if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
      else if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') id = parts[1] || '';
      const list = u.searchParams.get('list') || '';
      const base = 'https://www.youtube-nocookie.com/embed/';
      const q = 'autoplay=1&playsinline=1&rel=0&enablejsapi=1&modestbranding=1';
      if (idOk(id)) return { provider: 'youtube', src: base + id + '?' + q + '&loop=1&playlist=' + id, h: 220, label: 'YouTube' };
      if (idOk(list)) return { provider: 'youtube', src: base + 'videoseries?list=' + encodeURIComponent(list) + '&' + q + '&loop=1', h: 220, label: 'YouTube' };
      return null;
    }
    if (host === 'open.spotify.com' || host === 'spotify.com') {
      const i = parts.findIndex((p) => ['track', 'album', 'playlist', 'episode', 'show', 'artist'].indexOf(p) >= 0);
      if (i < 0 || !idOk(parts[i + 1])) return null;
      const kind = parts[i];
      return { provider: 'spotify', src: 'https://open.spotify.com/embed/' + kind + '/' + parts[i + 1] + '?utm_source=generator&theme=0', h: kind === 'track' || kind === 'episode' ? 152 : 232, label: 'Spotify' };
    }
    if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
      if (!parts.length) return null;
      return { provider: 'soundcloud', src: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(u.origin + u.pathname) + '&auto_play=true&hide_related=true&show_comments=false&show_teaser=false&visual=false', h: 166, label: 'SoundCloud' };
    }
    if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
      if (parts.length < 2) return null;
      return { provider: 'apple', src: 'https://embed.music.apple.com' + u.pathname + u.search, h: u.searchParams.get('i') ? 175 : 300, label: 'Apple Music' };
    }
    return null;
  }
  const hostMsg = (frame, provider, cmd) => {
    try {
      if (!frame || !frame.contentWindow) return;
      if (provider === 'youtube') frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: cmd === 'pause' ? 'pauseVideo' : cmd === 'unmute' ? 'unMute' : 'playVideo', args: [] }), '*');
      else if (provider === 'soundcloud' && cmd !== 'unmute') frame.contentWindow.postMessage(JSON.stringify({ method: cmd === 'pause' ? 'pause' : 'play' }), '*');
    } catch (_) { /* the embed is not ready yet */ }
  };

  /* ---------- the beat: five parts of the sound, each 0..1, from live analysis or from a beat clock ---------- */
  const E = { ctx: null, an: null, el: null, srcNode: null, buf: null, arr: null, mode: 'idle', bpm: 110, t0: 0, last: 0, lv: {}, peak: {}, prev: {}, flux: {}, hit: {}, at: {}, out: {} };
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
  function resume() { if (E.ctx && E.ctx.state === 'suspended') E.ctx.resume().catch(() => {}); }
  function detach() { E.an = null; E.el = null; E.srcNode = null; E.mode = 'idle'; for (const c of CH) { E.hit[c] = 0; E.out[c] = 0; } }
  function clock(bpm) { E.mode = 'clock'; E.bpm = Math.max(60, Math.min(200, Number(bpm) || 110)); E.t0 = performance.now(); }
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
      const kick = (bar === 0 || bar === 2 || (bar === 1 && b > 0.5 && beat % 8 > 4)) ? env(b, 6) : (bar === 1 || bar === 3 ? env(b, 6) * 0.35 : 0);
      E.out.kick = clamp01(kick);
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
    + '#pv-dock .dk-b{padding:0 10px 10px}#pv-dock.min .dk-b{display:none}#pv-dock iframe{width:100%;border:0;border-radius:10px;display:block;background:#000}'
    + '#pv-dock .dk-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;cursor:pointer;margin:2px 0 8px}#pv-dock .dk-bar i{display:block;height:100%;width:0;background:var(--acc,#00c47d)}'
    + '#pv-dock .dk-row{display:flex;align-items:center;gap:8px;color:#8fa5b1;font-size:.6rem}#pv-dock input[type=range]{flex:1;accent-color:var(--acc,#00c47d)}'
    + '#pv-dock .dk-ch{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:8px}#pv-dock .dk-ch div{text-align:center;font:800 .5rem ui-monospace,monospace;letter-spacing:.06em;color:#8fa5b1}#pv-dock .dk-ch span{display:block;height:34px;border-radius:5px;background:rgba(255,255,255,.07);position:relative;overflow:hidden;margin-bottom:3px}#pv-dock .dk-ch span i{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--acc,#00c47d);transition:height .05s linear}'
    + '#pv-dock .dk-note{margin:6px 0 0;color:#7f95a1;font-size:.58rem;line-height:1.4}#pv-dock .dk-tap{display:none;margin:0 10px 10px;padding:8px;border-radius:9px;background:var(--acc,#00c47d);color:#041b12;font:900 .72rem system-ui,sans-serif;text-align:center;cursor:pointer}#pv-dock.blocked .dk-tap{display:block}';
  document.head.appendChild(css);

  const D = { el: null, audio: null, frame: null, emb: null, song: null, playing: false, userPaused: false, armed: null, bars: null, prog: null, raf: 0, onState: null, acc: '' };
  const fmt = (s) => (Number.isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00');

  function setPlaying(on) {
    D.playing = on; if (D.el) { const b = D.el.querySelector('[data-dk=play]'); if (b) b.textContent = on ? '❚❚ Pause' : '▶ Play'; if (on) unblock(); }
    if (D.onState) D.onState(on);
  }
  function block(text) { if (!D.el) return; const t = D.el.querySelector('.dk-tap'); if (t && text) t.textContent = text; D.el.classList.add('blocked'); }
  function unblock() { if (D.el) D.el.classList.remove('blocked'); }
  /* the song is heard first; the live analysis joins in only once the browser lets the audio engine run (a suspended engine would
     swallow the sound), and until then the page moves to a beat clock */
  function tryAnalyse() {
    const a = D.audio; if (!a || a.paused) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; E.ctx = E.ctx || new AC(); } catch (_) { return; }
    if (E.ctx.state === 'suspended') E.ctx.resume().catch(() => {});
    if (E.ctx.state === 'running') { if (E.el !== a) { if (attach(a)) E.mode = 'live'; } else E.mode = 'live'; }
    else if (E.mode !== 'clock') clock(D.song && D.song.bpm);
  }
  function onMsg(e) {
    if (!D.frame || !D.emb || e.source !== D.frame.contentWindow) return;
    let m = e.data; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { return; } }
    if (!m || typeof m !== 'object') return;
    const on = () => { unblock(); if (!D.playing) setPlaying(true); if (E.mode !== 'clock') clock(D.song && D.song.bpm); };
    const off = () => { if (D.playing) setPlaying(false); idle(); };
    if (D.emb.provider === 'youtube') {
      const st = m.event === 'onStateChange' ? m.info : (m.info && typeof m.info.playerState === 'number' ? m.info.playerState : null);
      if (typeof st === 'number') { D.ytState = st; if (st === 1) on(); else if (st === 2 || st === 0) off(); }
      if (m.info && m.info.muted === true && D.ytState === 1 && !D.userPaused) { try { D.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*'); } catch (_) { /* fine */ } }
    } else if (D.emb.provider === 'soundcloud') {
      if (m.method === 'play') on(); else if (m.method === 'pause' || m.method === 'finish') off();
    }
  }
  window.addEventListener('message', onMsg);
  /* Spotify and Apple Music tell the page nothing; a click inside their player moves focus into the frame */
  window.addEventListener('blur', () => { if (D.emb && D.frame && document.activeElement === D.frame && !D.playing && (D.emb.provider === 'spotify' || D.emb.provider === 'apple')) { D.userPaused = false; unblock(); setPlaying(true); clock(D.song.bpm); } });
  function tick() {
    D.raf = requestAnimationFrame(tick);
    if (!D.el) return;
    if (D.audio && D.prog) { const a = D.audio; if (a.duration > 0) { D.prog.firstChild.style.width = (a.currentTime / a.duration * 100) + '%'; D.time.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration); } }
    if (D.bars) { const o = E.out; CH.forEach((c, i) => { D.bars[i].style.height = Math.max(3, Math.round(o[c] * 34)) + 'px'; }); }
  }
  function playAudio(auto) {
    const a = D.audio; if (!a) return;
    resume();
    const p = a.play(); if (!p || !p.then) { setPlaying(true); return; }
    p.then(() => { setPlaying(true); tryAnalyse(); }).catch(() => { setPlaying(false); if (auto) { block('▶ Tap to start the music'); arm(); } });
  }
  /* browsers hold autoplay back until the person has touched the page; the first tap, click or key press anywhere starts it */
  function arm() {
    if (D.armed) return;
    const go = () => { cancel(); if (D.userPaused) return; if (D.audio) { if (D.audio.paused) playAudio(false); else tryAnalyse(); } else if (D.emb) { hostMsg(D.frame, D.emb.provider, 'play'); hostMsg(D.frame, D.emb.provider, 'unmute'); } };
    const cancel = () => { for (const t of ['pointerdown', 'keydown']) window.removeEventListener(t, go, true); D.armed = null; };
    for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, go, true);
    D.armed = cancel;
  }
  function toggle() {
    if (!D.el) return;
    if (D.audio) { if (D.audio.paused) { D.userPaused = false; playAudio(false); } else { D.userPaused = true; D.audio.pause(); setPlaying(false); } return; }
    if (D.emb) { if (D.playing) { D.userPaused = true; hostMsg(D.frame, D.emb.provider, 'pause'); setPlaying(false); idle(); } else { D.userPaused = false; hostMsg(D.frame, D.emb.provider, 'play'); hostMsg(D.frame, D.emb.provider, 'unmute'); } }
  }
  function unmount() {
    if (D.raf) cancelAnimationFrame(D.raf); D.raf = 0;
    if (D.armed) D.armed();
    if (D.iv) clearInterval(D.iv); D.iv = 0;
    if (D.audio) { try { D.audio.pause(); } catch (_) { /* fine */ } D.audio.remove(); }
    if (D.el) D.el.remove();
    D.el = D.audio = D.frame = D.emb = D.song = D.bars = D.prog = null; D.playing = false; D.userPaused = false; D.ytState = -1;
    detach();
  }
  /* mount(song, ctx): ctx = { userId, token, accent, onState(playing) }; returns false when there is nothing the dock can play */
  function mount(song, ctx) {
    const same = D.song && song && D.song.url === song.url && D.el;
    if (same) { D.onState = ctx.onState || null; D.el.style.setProperty('--acc', ctx.accent || '#00c47d'); D.song = song; D.el.classList.add('on'); if (D.emb && D.playing && E.bpm !== (Number(song.bpm) || 110)) clock(song.bpm); return true; }
    unmount();
    if (!song || !song.url) return false;
    const isAudio = song.kind === 'audio', emb = isAudio ? null : embed(song);
    if (!isAudio && !emb) return false;
    D.song = song; D.emb = emb; D.onState = ctx.onState || null;
    const el = document.createElement('div'); el.id = 'pv-dock'; el.className = 'on'; el.style.setProperty('--acc', ctx.accent || '#00c47d');
    const title = song.title || 'Profile song';
    let body;
    if (isAudio) {
      body = '<div class="dk-bar" data-dk="bar"><i></i></div><div class="dk-row"><span data-dk="time">0:00 / 0:00</span><span style="flex:1"></span>🔊<input type="range" data-dk="vol" min="0" max="100" value="80" aria-label="Volume"></div>'
        + '<div class="dk-ch">' + CH.map((c) => '<div><span><i></i></span>' + LABEL[c] + '</div>').join('') + '</div>'
        + '<p class="dk-note">Live: the page moves to the kick, bass, vocals, snare and hi-hats in this song.</p>';
    } else {
      body = '<' + 'iframe data-dk="frame" title="' + esc(emb.label) + ' player" src="' + esc(emb.src) + '" height="' + emb.h + '" allow="autoplay *; encrypted-media *; fullscreen; clipboard-write" referrerpolicy="strict-origin-when-cross-origin" loading="eager" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"></iframe>'
        + '<div class="dk-ch">' + CH.map((c) => '<div><span><i></i></span>' + LABEL[c] + '</div>').join('') + '</div>'
        + '<p class="dk-note">' + esc(emb.label) + ' plays here. The page moves to a beat clock at ' + esc(String(song.bpm || 110)) + ' BPM (a site cannot listen inside ' + esc(emb.label) + '). Use a direct MP3 link to react to the real instruments.</p>';
    }
    el.innerHTML = '<div class="dk-h"><div class="dk-t"><b>♫ ' + esc(title) + '</b><small>' + (isAudio ? 'Academy player' : esc(emb.label) + ' · in the Academy') + '</small></div>'
      + (isAudio ? '<button type="button" class="go" data-dk="play">▶ Play</button>' : (emb.provider === 'youtube' || emb.provider === 'soundcloud' ? '<button type="button" class="go" data-dk="play">▶ Play</button>' : ''))
      + '<button type="button" data-dk="min" title="Minimise">▁</button></div><div class="dk-tap" data-dk="tap">▶ Tap to start the music</div><div class="dk-b">' + body + '</div>';
    document.body.appendChild(el); D.el = el;
    D.bars = [...el.querySelectorAll('.dk-ch span i')]; D.prog = el.querySelector('[data-dk=bar]'); D.time = el.querySelector('[data-dk=time]'); D.frame = el.querySelector('[data-dk=frame]');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dk]'); if (!b) return;
      const k = b.getAttribute('data-dk');
      if (k === 'play') toggle(); else if (k === 'tap') { D.userPaused = false; if (D.audio) { playAudio(false); tryAnalyse(); } else { hostMsg(D.frame, D.emb.provider, 'play'); hostMsg(D.frame, D.emb.provider, 'unmute'); unblock(); } }
      else if (k === 'min') { el.classList.toggle('min'); b.textContent = el.classList.contains('min') ? '▢' : '▁'; }
      else if (k === 'bar' && D.audio && D.audio.duration > 0) { const r = b.getBoundingClientRect(); D.audio.currentTime = D.audio.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
    });
    const vol = el.querySelector('[data-dk=vol]'); if (vol) vol.addEventListener('input', () => { if (D.audio) D.audio.volume = vol.value / 100; });
    if (isAudio) {
      const a = document.createElement('audio'); a.preload = 'auto'; a.loop = true; a.crossOrigin = 'anonymous'; a.volume = 0.8; a.style.display = 'none';
      a.src = '/academy-activity/profiles/' + encodeURIComponent(ctx.userId) + '/audio?t=' + encodeURIComponent(ctx.token);
      el.appendChild(a); D.audio = a;
      a.addEventListener('error', () => { if (ctx.onError) ctx.onError('That song link could not be played here. Use a direct MP3 or M4A link, or a YouTube / Spotify / SoundCloud link.'); setPlaying(false); });
      a.addEventListener('pause', () => { if (!a.ended) setPlaying(false); }); a.addEventListener('playing', () => { setPlaying(true); tryAnalyse(); });
      D.iv = setInterval(tryAnalyse, 500);
      playAudio(true);
    } else {
      /* the embed asks to start itself (autoplay=1); YouTube and SoundCloud report back when it really plays, and only then does
         the beat clock run. If nothing plays within a few seconds the dock says so and how to start it. */
      D.ytState = -1; idle(); setPlaying(false);
      D.frame.addEventListener('load', () => {
        try {
          if (emb.provider === 'youtube') D.frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
          if (emb.provider === 'soundcloud') for (const ev of ['play', 'pause', 'finish']) D.frame.contentWindow.postMessage(JSON.stringify({ method: 'addEventListener', value: ev }), '*');
        } catch (_) { /* fine */ }
        setTimeout(() => { if (!D.userPaused) { hostMsg(D.frame, emb.provider, 'play'); } }, 700);
        setTimeout(() => {
          if (D.playing || !D.el) return;
          if (emb.provider === 'youtube' || emb.provider === 'soundcloud') block('▶ Tap to start the music');
          else block('Press ▶ in the ' + emb.label + ' player to start (' + emb.label + ' does not allow autoplay)');
        }, 3500);
      });
      arm();
    }
    D.raf = requestAnimationFrame(tick);
    return true;
  }
  function setAccent(c) { if (D.el) D.el.style.setProperty('--acc', c || '#00c47d'); }
  function show(on) { if (D.el) D.el.classList.toggle('on', !!on); }

  window.smlProfileMusic = {
    CH, LABEL, DEFAULT_REACT, embed, mount, unmount, toggle, read, frequency, setAccent, show,
    isPlaying: () => D.playing, active: () => !!D.el, mode: () => E.mode
  };
})();
