/* Live cells for the Academy: one stream, one flash model, shared by the SIRE panel and the market scanner.
   Modelled on moomoo's Markets list. Every cell is on its own: when its value changes it gets a tinted box with a
   1px border in the direction colour (green for an up tick, red for a down tick) and its text takes that colour.
   The box does not fade: it stays while the cell keeps ticking, flips colour the instant a tick goes the other way,
   and clears about 2.2 s after the cell's last change (measured from moomoo), dropping the text back to its resting
   colour. A rebuilt row asks for its marks back with restore(), so a re-render never loses a live box.
   The feed is /academy-activity/sire-stream read through fetch (so the Academy session header rides along): one
   snapshot, then only the symbols whose values moved. It opens while something is subscribed and the tab is visible. */
(() => {
  if (window.smlLiveCells) return;
  const IDLE_MS = 2200;
  const STREAM_URL = '/academy-activity/sire-stream';
  const css = document.createElement('style');
  css.textContent = 'td.sml-up,td.sml-down{transition:none!important;box-shadow:inset 0 0 0 1px var(--sml-up,#19c37d);background:rgba(25,195,125,.17)!important;color:var(--sml-up-text,#39ff14)!important}'
    + 'td.sml-down{box-shadow:inset 0 0 0 1px var(--sml-down,#ff1744);background:rgba(255,23,68,.17)!important;color:var(--sml-down-text,#ff4d6d)!important}'
    + 'td.sml-off{transition:background-color .15s ease-out,box-shadow .15s ease-out,color .15s ease-out}';
  document.head.appendChild(css);

  /* ---- the flash model ---- */
  const marks = new Map(); // key -> { dir, until, td }
  function paint(td, dir) { td.classList.remove('sml-off'); td.classList.toggle('sml-up', dir > 0); td.classList.toggle('sml-down', dir < 0); }
  /** The cell's value just moved: box it in the direction colour and keep it boxed until IDLE_MS after the last move. */
  function mark(td, dir, key) {
    if (!td || !dir) return;
    const k = key || td;
    const m = marks.get(k);
    if (m && m.td !== td && m.td) m.td.classList.remove('sml-up', 'sml-down');
    marks.set(k, { dir, until: Date.now() + IDLE_MS, td });
    paint(td, dir);
  }
  /** A rebuilt cell takes its live box back, if that box is still due. */
  function restore(td, key) {
    const m = marks.get(key);
    if (!m || !td) return false;
    if (m.until <= Date.now()) { marks.delete(key); return false; }
    m.td = td; paint(td, m.dir); return true;
  }
  function sweep() {
    const now = Date.now();
    for (const [k, m] of marks) {
      if (m.until > now) continue;
      marks.delete(k);
      if (m.td && m.td.isConnected) { m.td.classList.add('sml-off'); m.td.classList.remove('sml-up', 'sml-down'); }
    }
  }
  setInterval(sweep, 150);

  /* ---- the feed ---- */
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const FIELDS = { p: 'price', ch: 'change', c: 'changePct', r1: 'changeRate1min', r3: 'changeRate3min', rv: 'rvol', v: 'volume', b: 'bid', a: 'ask', bs: 'bidSize', as: 'askSize' };
  const rows = new Map(); // SYMBOL -> normalised row
  const listeners = new Set();
  const state = { mode: 'idle', okAt: 0, ctl: null, retryAt: 0, fails: 0, live: false };
  function normalise(raw) {
    if (!raw) return null;
    const symbol = String(raw.s || raw.symbol || '').toUpperCase(); if (!symbol) return null;
    const r = { symbol, t: num(raw.t) || 0 };
    for (const [short, long] of Object.entries(FIELDS)) r[long] = num(raw[short] != null ? raw[short] : raw[long]);
    if (r.rvol == null) r.rvol = num(raw.volumeRatio);
    return r;
  }
  const emit = (kind, list) => { for (const fn of listeners) { try { fn(kind, list); } catch (_) { /* one broken listener must not stop the rest */ } } };
  function snapshot(list) {
    rows.clear();
    for (const raw of list) { const r = normalise(raw); if (r) rows.set(r.symbol, r); }
    emit('snapshot', Array.from(rows.values()));
  }
  function tick(list) {
    const out = [];
    for (const u of list) {
      if (!u || !u.s) continue;
      const symbol = String(u.s).toUpperCase();
      if (u.gone) { rows.delete(symbol); out.push({ symbol, gone: true, changed: {} }); continue; }
      let r = rows.get(symbol);
      if (!r) { r = normalise(u); rows.set(symbol, r); out.push({ symbol, row: r, fresh: true, changed: {} }); continue; }
      const changed = {};
      for (const [short, long] of Object.entries(FIELDS)) if (u[short] !== undefined) { const v = num(u[short]); if (v !== r[long]) { changed[long] = { from: r[long], to: v }; r[long] = v; } }
      if (u.t !== undefined) r.t = num(u.t) || r.t;
      if (Object.keys(changed).length) out.push({ symbol, row: r, changed });
    }
    if (out.length) emit('tick', out);
  }
  function setMode(mode) { if (state.mode !== mode) { state.mode = mode; emit('mode', mode); } }
  function close() { if (state.ctl) { try { state.ctl.abort(); } catch (_) { /* closing */ } state.ctl = null; } if (state.mode === 'live') setMode('idle'); }
  async function connect() {
    if (!listeners.size || state.ctl || document.hidden || !window.fetch || !window.ReadableStream || !window.AbortController) return;
    if (Date.now() < state.retryAt) return;
    const ctl = new AbortController(); state.ctl = ctl;
    let res;
    try { res = await fetch(STREAM_URL, { cache: 'no-store', headers: { accept: 'text/event-stream' }, signal: ctl.signal }); } catch (_) { res = null; }
    if (!res || !res.ok || !res.body || !/text\/event-stream/.test(res.headers.get('content-type') || '')) {
      if (state.ctl === ctl) state.ctl = null;
      state.fails += 1; state.retryAt = Date.now() + (res && (res.status === 503 || res.status === 403) ? 60000 : Math.min(30000, 1000 * 2 ** Math.min(state.fails, 5)));
      setMode('poll');
      return;
    }
    state.fails = 0; state.okAt = Date.now(); setMode('live');
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const part of parts) {
          let event = 'message', data = '';
          for (const line of part.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
          state.okAt = Date.now();
          if (!data) continue;
          let body; try { body = JSON.parse(data); } catch (_) { continue; }
          if (event === 'snapshot' && body && Array.isArray(body.rows)) { state.live = Boolean(body.live); snapshot(body.rows); }
          else if (event === 'tick' && body && Array.isArray(body.rows)) tick(body.rows);
          else if (event === 'error') break;
        }
      }
    } catch (_) { /* aborted or dropped: the loop below reconnects */ }
    if (state.ctl === ctl) state.ctl = null;
    if (listeners.size && !ctl.signal.aborted) { setMode('down'); state.retryAt = Date.now() + 1500; }
  }
  setInterval(() => { if (listeners.size && !document.hidden) connect(); }, 2000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); else { state.retryAt = 0; connect(); } });

  /** subscribe(fn): fn('snapshot', rows) now if rows are loaded, then fn('tick', changes) and fn('mode', mode). Returns the unsubscribe. */
  function subscribe(fn) {
    listeners.add(fn);
    if (rows.size) { try { fn('snapshot', Array.from(rows.values())); } catch (_) { /* ignore */ } }
    state.retryAt = Math.min(state.retryAt, Date.now());
    connect();
    return () => { listeners.delete(fn); if (!listeners.size) close(); };
  }
  const streaming = () => state.mode === 'live' && Date.now() - state.okAt < 8000;
  window.smlLiveCells = {
    IDLE_MS, mark, restore, marks,
    feed: { subscribe, rows: () => rows, get: (symbol) => rows.get(String(symbol || '').toUpperCase()) || null, mode: () => state.mode, streaming, trades: () => state.live, state }
  };
})();
