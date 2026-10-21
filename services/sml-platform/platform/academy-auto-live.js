/* AUTO LIVE DESK (owner only). A live-stream trader that runs by itself: it looks across everything the Academy already knows (MEM ALGO signals,
   unusual volume, the scanner's movers, FDA dates, earnings), picks the stock worth a look, puts it on the chart, builds the setup with the same
   target engine the TARGETS tool uses, and talks through it: why it is on screen, the levels, entry, three targets, stop and odds, and how a member
   makes the same read with the Academy's own tools. A pointer moves to what it is talking about (a price line on the chart, a button, a module).
   When a call reaches a target or is stopped the desk says so, then moves on to the next ticker while the other calls keep being watched.
   Between trades it reads the market direction and VIX, and the next FDA and earnings dates.
   The voice is the owner's own (ElevenLabs, each line stored once), with the browser's free speech as the fallback, and captions; it can be paused, skipped, muted or stopped.
   HONEST BY DESIGN: every call it makes goes on the scoreboard, the stopped ones too; it is an educational simulation, places no orders, and is
   not advice. Owner only: the button is built only for the owner and the desk stops itself if the server says owner_only. */
(function (root) {
  'use strict';
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = (p) => (Number(p) >= 10 ? Number(p).toFixed(2) : Number(p) >= 1 ? Number(p).toFixed(3) : Number(p).toFixed(4));
  const COOL_MS = 45 * 60_000, CALL_LIFE_MS = 6 * 3_600_000, SPOKEN = /[^\w\s.,%$+\-:;!?'/()]/g;

  /* ---- pure logic (tested) ---- */
  /* candidates: every source adds reasons and points; a stock named by several sources floats up; a cooled-down one is skipped */
  function buildQueue(src, { seen = {}, now = Date.now(), skip = [] } = {}) {
    const by = new Map();
    const add = (sym, pts, why, kind) => {
      sym = String(sym || '').toUpperCase(); if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return;
      const c = by.get(sym) || { sym, score: 0, why: [], kinds: new Set() }; c.score += pts; if (why) c.why.push(why); if (kind) c.kinds.add(kind); by.set(sym, c);
    };
    for (const s of (src.signals || [])) {
      const ageH = Math.max(0, (now - (num(s.at) || now)) / 3_600_000); if (ageH > 36) continue;
      const g = String(s.grade || '').toUpperCase(), gp = g.startsWith('A') ? 30 : g.startsWith('B') ? 20 : 12;
      add(s.symbol, gp + Math.max(0, 14 - ageH), 'MEM ALGO flagged a ' + (s.label || s.style || 'buy') + ' setup' + (g ? ' graded ' + g : '') + (ageH < 1 ? ' within the hour' : ' about ' + Math.round(ageH) + 'h ago'), 'signal');
    }
    for (const u of (src.unusual || [])) { const r = num(u.ratio) || 0; add(u.sym, Math.min(32, 8 + r * 2.2), 'volume is ' + (r >= 10 ? Math.round(r) : r.toFixed(1)) + 'x yesterday\'s whole day' + (u.chg != null ? ' and price is ' + (u.chg > 0 ? 'up ' : 'down ') + Math.abs(u.chg) + '%' : ''), 'volume'); }
    for (const m of (src.movers || [])) { const c = num(m.chg); if (c != null) add(m.sym, Math.min(18, 4 + Math.abs(c) * 1.6), 'it is ' + (c > 0 ? 'up ' : 'down ') + Math.abs(c).toFixed(1) + '% on the scanner', 'mover'); }
    for (const f of (src.fda || [])) { const d = num(f.daysAway); if (d != null && d <= 14) add(f.symbol, 18 - d, 'an FDA decision date is ' + (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days'), 'fda'); }
    for (const e of (src.earnings || [])) { const d = num(e.daysAway); if (d != null && d >= 0 && d <= 3) add(e.symbol, 12 - d * 2, 'earnings ' + (d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days'), 'earnings'); }
    const out = [...by.values()].filter((c) => !(seen[c.sym] && now - seen[c.sym] < COOL_MS) && !skip.includes(c.sym));
    for (const c of out) { if (c.kinds.size > 1) c.score += 10 * (c.kinds.size - 1); c.kinds = [...c.kinds]; }
    return out.sort((a, b) => b.score - a.score);
  }

  /* what a price does to a call: targets are taken in order; a stop ends it. Returns the events that just happened. */
  function judge(call, price, now = Date.now()) {
    const ev = []; if (!call || call.status !== 'open' || !(price > 0)) return ev;
    const long = call.side !== 'short', beyond = (a, b) => (long ? a >= b : a <= b);
    while (call.hit < call.targets.length && beyond(price, call.targets[call.hit])) { call.hit++; ev.push({ type: 'target', n: call.hit, price: call.targets[call.hit - 1] }); }
    if (call.hit >= call.targets.length) { call.status = 'done'; call.closedAt = now; ev.push({ type: 'done' }); return ev; }
    if (long ? price <= call.stop : price >= call.stop) { call.status = call.hit ? 'stopped_after_target' : 'stopped'; call.closedAt = now; ev.push({ type: 'stop', price: call.stop, afterTarget: call.hit > 0 }); return ev; }
    if (now - call.at > CALL_LIFE_MS) { call.status = 'expired'; call.closedAt = now; call.exit = price; ev.push({ type: 'expired' }); }
    return ev;
  }

  /* the honest scoreboard: a call counts as a win only if it reached target 1 */
  function scoreboard(calls) {
    const b = { calls: calls.length, open: 0, wins: 0, losses: 0, flat: 0, t1: 0, t2: 0, t3: 0, avgPct: null };
    let sum = 0, n = 0;
    for (const c of calls) {
      if (c.status === 'open') { b.open++; continue; }
      const long = c.side !== 'short', dir = long ? 1 : -1;
      if (c.hit >= 1) { b.wins++; b.t1++; } else if (c.status === 'stopped') b.losses++; else b.flat++;
      if (c.hit >= 2) b.t2++; if (c.hit >= 3) b.t3++;
      const exitP = c.hit ? c.targets[c.hit - 1] : c.status === 'stopped' ? c.stop : num(c.exit);
      if (exitP > 0 && c.entry > 0) { sum += (exitP / c.entry - 1) * dir * 100; n++; }
    }
    b.avgPct = n ? Math.round((sum / n) * 10) / 10 : null; b.rate = b.wins + b.losses ? Math.round((b.wins / (b.wins + b.losses)) * 100) : null;
    return b;
  }

  /* what the host says for a trade: each step may carry a pointer target. Says only what the numbers say. */
  function setupScript(cand, t, dir) {
    const long = t.direction !== 'short', side = long ? 'long' : 'short', last = t.targets.length - 1, steps = [];
    const why = cand.why.slice(0, 2).join(', and ');
    steps.push({ say: cand.sym + ' just came up on the board' + (why ? ': ' + why : '') + '. Let\'s look at the chart.', point: { kind: 'el', id: 'symbol', label: cand.sym } });
    if (cand.how) steps.push({ say: cand.how, point: cand.howPoint || null });
    if (dir && dir.line) steps.push({ say: dir.line, point: null });
    steps.push({ say: 'The read here leans ' + side + (t.confidence ? ', with ' + t.confidence + ' confidence' : '') + '. Entry is around ' + fmt(t.price) + '.', point: { kind: 'price', price: t.price, label: 'ENTRY ' + fmt(t.price) } });
    t.targets.forEach((x, i) => steps.push({ say: 'Target ' + (i + 1) + ' is ' + fmt(x.price) + ', that is ' + Math.abs(x.pct).toFixed(1) + ' percent away. This stock\'s own history got there before the stop about ' + x.prob + ' percent of the time.', point: { kind: 'price', price: x.price, label: 'T' + (i + 1) + ' ' + fmt(x.price) + ' · ' + x.prob + '%' } }));
    steps.push({ say: 'The stop goes at ' + fmt(t.stop.price) + ', ' + (t.stop.basis || 'past the nearest level against the trade') + '. If it trades there, the idea is wrong and we say so.', point: { kind: 'price', price: t.stop.price, label: 'STOP ' + fmt(t.stop.price) } });
    if (t.rr && t.rr[0] != null) steps.push({ say: 'First target pays ' + t.rr[0] + ' times what the stop risks' + (t.rr[0] < 1 ? ', which is thin, so this one is a small size or a wait.' : '.'), point: null });
    if (t.notes && t.notes[0]) steps.push({ say: t.notes[0], point: null });
    steps.push({ say: 'To do this yourself: open the Targets tool, pick a horizon, and it draws the same ladder with the odds. Then check the walls and smart money layers before you ever size a trade.', point: { kind: 'el', id: 'targets-toggle', label: 'TARGETS' } });
    steps.push({ say: 'This is an education call, not advice, and nothing here places an order. It goes on the scoreboard win or lose.', point: null });
    return steps;
  }

  function marketScript(dir, vix) {
    const steps = [];
    if (dir && dir.ok) {
      const side = dir.bias >= 25 ? 'leaning bullish' : dir.bias <= -25 ? 'leaning bearish' : 'mixed';
      steps.push({ say: 'Big picture first. The Academy reads the overall market ' + side + ', labeled ' + String(dir.label || 'neutral').toLowerCase() + ', with ' + Math.round(dir.confidence || 0) + ' percent confidence.', point: { kind: 'el', id: 'academy-direction', label: 'MARKET DIRECTION' } });
      const top = (dir.components || []).slice(0, 2).map((c) => c.label).filter(Boolean); if (top.length) steps.push({ say: 'What is driving that: ' + top.join(' and ') + '. Open Market Direction on your side to see every piece.', point: null });
    } else steps.push({ say: 'The market direction read is not available right now, so size small until it is.', point: null });
    const v = vix && vix.ok !== false ? num(vix.level) : null;
    if (v != null) steps.push({ say: 'The VIX is ' + v.toFixed(1) + (v >= 25 ? ', elevated: expect wide swings and use smaller size.' : v <= 14 ? ', calm: moves tend to be smaller and cleaner.' : ', in a normal range.'), point: { kind: 'el', id: 'academy-sml-vix', label: 'VIX ' + v.toFixed(1) } });
    return steps;
  }

  function catalystScript(fda, earn) {
    const steps = [];
    const f = (fda || []).filter((e) => e.kind === 'scheduled').slice(0, 2);
    if (f.length) steps.push({ say: 'On the FDA calendar: ' + f.map((e) => e.symbol + ' ' + (e.daysAway <= 0 ? 'today' : e.daysAway === 1 ? 'tomorrow' : 'in ' + e.daysAway + ' days')).join(', ') + '. These are binary: size small or use defined risk options, and never hold more than you can lose.', point: { kind: 'el', id: 'catalysts-toggle', label: 'CATALYSTS' } });
    const e = (earn || []).filter((x) => num(x.daysAway) != null && x.daysAway <= 3).slice(0, 3);
    if (e.length) steps.push({ say: 'Earnings coming: ' + e.map((x) => x.symbol).join(', ') + '. Options are priced for a big move, so look at the expected move before you buy contracts.', point: { kind: 'el', id: 'catalysts-toggle', label: 'EARNINGS' } });
    return steps;
  }

  /* keep speech to plain words: symbols read badly */
  const speakable = (s) => String(s || '').replace(/·/g, ',').replace(SPOKEN, ' ').replace(/\b([A-Z]{2,5})\b/g, (m) => (m === 'FDA' || m === 'VIX' || m === 'MEM' || m === 'ALGO' ? m : m.split('').join(' '))).replace(/\s+/g, ' ').trim();
  const readMs = (s) => Math.max(1800, String(s || '').length * 62);

  const API = { buildQueue, judge, scoreboard, setupScript, marketScript, catalystScript, speakable, readMs, COOL_MS, CALL_LIFE_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  if (!root || !root.document) return;

  /* ---- browser side ---- */
  (function boot(tries) {
    if (root.__smlAutoLive) return;
    const stage = document.querySelector('.academy-chart-stage'), chartCanvas = document.getElementById('chart');
    if (!stage || !chartCanvas) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
    root.__smlAutoLive = true;
    const KEY = 'sml-auto-live-v1', token = () => String(root.smlAcademySessionToken || '');
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const S = { on: false, paused: false, muted: false, calls: [], seen: {}, cap: '', phase: 'idle', focus: null, trades: 0, market: null, skip: false, owner: false, run: 0, queue: [] };
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.calls = (v.calls || []).slice(-60); S.seen = v.seen || {}; S.muted = v.muted === true; } } catch (_) { /* storage can be blocked */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ calls: S.calls.slice(-60), seen: S.seen, muted: S.muted })); } catch (_) { /* fine */ } };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    async function api(path) {
      const go = (tok) => fetch(path, { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
      let res = await go(token());
      if (res.status === 401 && typeof root.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(root.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
      if (res.status === 403) { const j = await res.json().catch(() => null); if (j && j.error === 'owner_only') { S.denied = true; stop(true); } return null; }
      return res.ok ? res.json().catch(() => null) : null;
    }

    /* ---- the pointer ---- */
    const ptr = document.createElement('div'); ptr.id = 'sml-pointer'; ptr.setAttribute('aria-hidden', 'true');
    ptr.innerHTML = '<span class="ring"></span><svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l17 8-7 2-2 7z" fill="#ffd166" stroke="#1a1204" stroke-width="1.4" stroke-linejoin="round"/></svg><b class="lab"></b>';
    document.body.appendChild(ptr);
    const lab = ptr.querySelector('.lab');
    function pointAt(spec) {
      if (!spec) { ptr.classList.remove('on'); return; }
      let x = null, y = null;
      try {
        if (spec.kind === 'price') {
          const M = root.smlChartModel && root.smlChartModel(); if (!M || !M.y) { ptr.classList.remove('on'); return; }
          const r = chartCanvas.getBoundingClientRect(), yy = M.y(spec.price);
          if (!(yy >= M.pad.t && yy <= M.pad.t + (M.priceH || M.ph))) { ptr.classList.remove('on'); return; }
          x = r.left + M.pad.l + M.pw * 0.55; y = r.top + yy;
        } else if (spec.kind === 'el') {
          const el = document.getElementById(spec.id); if (!el) { ptr.classList.remove('on'); return; }
          const r = el.getBoundingClientRect(); if (!r.width && !r.height) { ptr.classList.remove('on'); return; }
          x = r.left + r.width * 0.5; y = r.top + r.height * 0.5;
        }
      } catch (_) { x = null; }
      if (x == null) { ptr.classList.remove('on'); return; }
      ptr.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; lab.textContent = spec.label || ''; ptr.classList.add('on');
    }

    /* ---- the desk lines on the chart for the call being discussed ---- */
    const layer = document.createElement('canvas'); layer.id = 'auto-live-layer'; layer.style.cssText = 'position:absolute;pointer-events:none;z-index:8;background:none;border:0'; const lctx = layer.getContext('2d');
    function draw() {
      const w = chartCanvas.clientWidth, h = chartCanvas.clientHeight, dpr = root.smlChartDpr ? root.smlChartDpr() : (root.devicePixelRatio || 1);
      if (layer.parentElement !== chartCanvas.parentElement && chartCanvas.parentElement) chartCanvas.parentElement.appendChild(layer);
      layer.style.left = chartCanvas.offsetLeft + 'px'; layer.style.top = chartCanvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
      if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, h);
      const c = S.on && S.focus; const M = root.smlChartModel && root.smlChartModel(); if (!c || !M || M.symbol !== c.sym) return;
      const left = M.pad.l, right = M.pad.l + M.pw, top = M.pad.t, bottom = M.pad.t + (M.priceH || M.ph);
      const rows = [{ p: c.entry, t: 'DESK ENTRY ' + fmt(c.entry), col: '#4dc3ff' }, ...c.targets.map((p, i) => ({ p, t: 'DESK T' + (i + 1) + ' ' + fmt(p) + (c.hit > i ? ' ✓' : ''), col: c.hit > i ? '#ffd166' : '#b48cff' })), { p: c.stop, t: 'DESK STOP ' + fmt(c.stop), col: '#ffb04a' }];
      lctx.save(); lctx.beginPath(); lctx.rect(left, top, M.pw, bottom - top); lctx.clip();
      for (const r of rows) { const y = M.y(r.p); if (!(y >= top && y <= bottom)) continue; lctx.setLineDash([7, 5]); lctx.lineWidth = 1.6; lctx.strokeStyle = r.col; lctx.globalAlpha = .9; lctx.beginPath(); lctx.moveTo(left, Math.round(y) + .5); lctx.lineTo(right, Math.round(y) + .5); lctx.stroke(); r.y = y; }
      lctx.restore(); lctx.setLineDash([]);
      const placed = [];
      for (const r of rows.filter((q) => q.y != null)) {
        let ly = r.y; for (let k = 0; k < 8; k++) { const hp = placed.find((q) => Math.abs(q - ly) < 15); if (hp == null) break; ly = ly >= hp ? hp + 16 : hp - 16; }
        placed.push(ly); lctx.font = '800 10px ui-monospace,monospace'; const tw = lctx.measureText(r.t).width + 12, x = left + 8;
        lctx.fillStyle = 'rgba(8,10,20,.9)'; lctx.fillRect(x, ly - 8.5, tw, 17); lctx.strokeStyle = r.col; lctx.lineWidth = 1; lctx.strokeRect(x + .5, ly - 8, tw - 1, 16);
        lctx.fillStyle = r.col; lctx.textAlign = 'left'; lctx.textBaseline = 'middle'; lctx.fillText(r.t, x + 6, ly + .5);
      }
    }
    root.addEventListener('sml-chart-view', draw); root.addEventListener('resize', draw);
    (function reg(n) { if (root.smlChartLevels) { root.smlChartLevels.register('auto-live', (s) => (S.on && S.focus && S.focus.sym === s ? [S.focus.entry, S.focus.stop, ...S.focus.targets] : [])); return; } if (n < 60) setTimeout(() => reg(n + 1), 500); })(0);

    /* ---- the voice: the browser's own (the fallback) ---- */
    let voice = null;
    const pickVoice = () => {
      try {
        const vs = (root.speechSynthesis && root.speechSynthesis.getVoices()) || []; const en = vs.filter((v) => /^en[-_]/i.test(v.lang));
        voice = en.find((v) => /natural|neural|google us english|samantha|aria|jenny|guy/i.test(v.name)) || en.find((v) => /en[-_]US/i.test(v.lang)) || en[0] || null;
      } catch (_) { voice = null; }
    };
    if (root.speechSynthesis) { pickVoice(); try { root.speechSynthesis.onvoiceschanged = pickVoice; } catch (_) { /* fine */ } }
    /* The owner's own voice (ElevenLabs, stored once per line on the server). A line is fetched ahead of time, so the next one is usually ready when the
       last one ends. If the voice cannot be reached (or is rate limited) the desk speaks with the browser voice instead, so it never goes quiet. */
    const clips = new Map(); let mineFails = 0;
    const mineOn = () => mineFails < 3 && typeof root.Audio === 'function';
    function clipFor(text) {
      const key = speakable(text); if (!key || key.length > 600) return Promise.resolve(null);
      if (clips.has(key)) return clips.get(key);
      const go = (tok) => fetch('/academy-activity/desk-speech', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ text: key }) });
      const p = (async () => {
        let res = await go(token());
        if (res.status === 401 && typeof root.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(root.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
        if (!res.ok) throw new Error('voice_' + res.status);
        return URL.createObjectURL(await res.blob());
      })().then((u) => { mineFails = 0; return u; }, () => { mineFails += 1; clips.delete(key); return null; });
      clips.set(key, p);
      if (clips.size > 40) { const old = clips.keys().next().value; clips.get(old).then((u) => { if (u) URL.revokeObjectURL(u); }); clips.delete(old); }
      return p;
    }
    const stopMine = () => { const a = S.audio; S.audio = null; if (a) { try { a.pause(); } catch (_) { /* fine */ } if (a._fin) a._fin(); } };
    function say(text, next) {
      S.cap = text; paintCap();
      if (!S.muted && mineOn()) { const mine = clipFor(text); if (next) void clipFor(next); return sayMine(text, mine); }
      return sayBrowser(text);
    }
    async function sayMine(text, minePromise) {
      const url = await minePromise;
      if (!url || !S.on || S.muted) return url ? undefined : sayBrowser(text);
      while (S.on && S.paused) await wait(300);
      if (!S.on || S.muted) return;
      return new Promise((resolve) => {
        let done = false; const a = new Audio(url); S.audio = a;
        const fin = () => { if (!done) { done = true; clearTimeout(tm); if (S.audio === a) S.audio = null; resolve(); } };
        const tm = setTimeout(fin, readMs(text) * 3 + 8000);
        a._fin = fin; a.onended = fin; a.onerror = () => { if (!done) { done = true; clearTimeout(tm); if (S.audio === a) S.audio = null; mineFails += 1; sayBrowser(text).then(resolve); } };
        a.play().catch(() => { if (!done) { done = true; clearTimeout(tm); if (S.audio === a) S.audio = null; sayBrowser(text).then(resolve); } });
      });
    }
    function sayBrowser(text) {
      return new Promise((resolve) => {
        const ms = readMs(text); let done = false; const fin = () => { if (!done) { done = true; clearTimeout(tm); resolve(); } };
        const tm = setTimeout(fin, S.muted || !root.speechSynthesis ? ms : ms * 3 + 4000);
        if (S.muted || !root.speechSynthesis) return;
        try {
          root.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(speakable(text)); if (voice) u.voice = voice; u.rate = 1.04; u.pitch = 1; u.lang = 'en-US';
          u.onend = fin; u.onerror = fin; root.speechSynthesis.speak(u);
        } catch (_) { /* captions still show */ }
      });
    }
    /* wait while paused; return early when the viewer skips */
    async function hold(ms) { const end = Date.now() + ms; while (S.on && Date.now() < end && !S.skip) { await wait(S.paused ? 400 : 250); if (S.paused) { const r = end - Date.now(); if (r < 300) break; } } }
    async function speak(text, next) { const run = S.run; await say(text, next); while (S.on && S.paused && run === S.run) await wait(300); }

    /* ---- the panel ---- */
    const panel = document.createElement('aside'); panel.id = 'auto-live-panel'; panel.setAttribute('aria-label', 'Auto live desk'); document.body.appendChild(panel);
    const st = document.createElement('style'); st.textContent = [
      '#auto-live-btn{border-color:#b48cff!important;color:#e4d3ff!important}#auto-live-btn.on{background:#3b2766!important;color:#fff!important;box-shadow:0 0 0 1px #b48cff}',
      '#auto-live-panel{position:fixed;right:10px;bottom:10px;z-index:2147483000;width:min(360px,calc(100vw - 20px));max-height:56vh;overflow:auto;background:rgba(10,8,22,.96);border:1px solid #6b4bb8;border-radius:12px;color:#efeaff;font:600 .72rem system-ui,sans-serif;padding:9px 11px;box-shadow:0 10px 36px rgba(0,0,0,.6);display:none}',
      '#auto-live-panel.on{display:block}#auto-live-panel h4{margin:0 0 5px;font:800 .64rem ui-monospace,monospace;letter-spacing:.1em;color:#caa8ff;display:flex;gap:6px;align-items:center}#auto-live-panel h4 i{width:8px;height:8px;border-radius:50%;background:#ff4d6d;animation:alp 1.2s infinite}',
      '@keyframes alp{50%{opacity:.25}}#auto-live-panel .cap{font:700 .8rem/1.4 system-ui,sans-serif;color:#fff;margin:2px 0 8px;min-height:3.4em}#auto-live-panel .card{border:1px solid #3a2c63;border-radius:8px;padding:6px 8px;margin:5px 0;background:#150f2e}',
      '#auto-live-panel .card b{color:#ffd166}#auto-live-panel .up{color:#35e6a0}#auto-live-panel .dn{color:#ff6b86}#auto-live-panel .row{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}',
      '#auto-live-panel button{border:1px solid #6b4bb8;background:#21163f;color:#efeaff;border-radius:6px;padding:4px 9px;font:800 .66rem system-ui,sans-serif;cursor:pointer}#auto-live-panel button.stop{border-color:#ff6b86;color:#ffb3c1}',
      '#auto-live-panel small{color:#a99bd3;font-weight:600;line-height:1.35;display:block;margin-top:5px}#auto-live-panel .sc{display:flex;gap:10px;flex-wrap:wrap;font:800 .66rem ui-monospace,monospace}',
      '#sml-pointer{position:fixed;left:0;top:0;z-index:2147483001;pointer-events:none;opacity:0;transition:transform .9s cubic-bezier(.3,.8,.2,1),opacity .25s;will-change:transform}#sml-pointer.on{opacity:1}',
      '#sml-pointer svg{position:absolute;left:-4px;top:-3px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.7));animation:ptb 1s ease-in-out infinite}@keyframes ptb{50%{transform:translate(4px,4px)}}',
      '#sml-pointer .ring{position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;border:2px solid #ffd166;animation:ptr 1.3s ease-out infinite}@keyframes ptr{from{transform:scale(.5);opacity:1}to{transform:scale(1.6);opacity:0}}',
      '#sml-pointer .lab{position:absolute;left:30px;top:12px;white-space:nowrap;background:#ffd166;color:#1a1204;font:800 .66rem ui-monospace,monospace;padding:2px 7px;border-radius:5px}#sml-pointer .lab:empty{display:none}',
      '@media (max-width:720px){#auto-live-panel{left:8px;right:8px;width:auto;bottom:calc(var(--sml-inset-bottom,0px) + 62px);max-height:44vh}}'
    ].join(''); document.head.appendChild(st);
    function paintCap() { const el = panel.querySelector('.cap'); if (el) el.textContent = S.cap; }
    function paint() {
      panel.classList.toggle('on', S.on); if (btn) btn.classList.toggle('on', S.on); if (!S.on) return;
      const sb = scoreboard(S.calls), f = S.focus, open = S.calls.filter((c) => c.status === 'open');
      const card = (c) => '<div class="card"><b>' + esc(c.sym) + '</b> ' + (c.side === 'short' ? '<span class="dn">SHORT</span>' : '<span class="up">LONG</span>') + ' · entry ' + fmt(c.entry) + ' · stop ' + fmt(c.stop) + '<br>' + c.targets.map((p, i) => '<span class="' + (c.hit > i ? 'up' : '') + '">T' + (i + 1) + ' ' + fmt(p) + (c.hit > i ? ' ✓' : '') + '</span>').join(' · ') + (c.status !== 'open' ? '<br><small>' + esc(statusText(c)) + '</small>' : '') + '</div>';
      const recent = S.calls.filter((c) => c.status !== 'open').slice(-3).reverse();
      panel.innerHTML = '<h4><i></i>LIVE DESK · ' + esc(S.phase.toUpperCase()) + '</h4><div class="cap">' + esc(S.cap) + '</div>'
        + (f ? card(f) : '')
        + (open.filter((c) => !f || c.id !== f.id).length ? '<small>Still watching</small>' + open.filter((c) => !f || c.id !== f.id).map(card).join('') : '')
        + '<div class="sc"><span>CALLS ' + sb.calls + '</span><span class="up">WON ' + sb.wins + '</span><span class="dn">STOPPED ' + sb.losses + '</span><span>OPEN ' + sb.open + '</span>' + (sb.rate != null ? '<span>HIT ' + sb.rate + '%</span>' : '') + (sb.avgPct != null ? '<span>AVG ' + (sb.avgPct > 0 ? '+' : '') + sb.avgPct + '%</span>' : '') + '</div>'
        + (recent.length ? '<small>' + recent.map((c) => esc(c.sym + ': ' + statusText(c))).join(' · ') + '</small>' : '')
        + '<div class="row"><button id="al-pause">' + (S.paused ? 'Resume' : 'Pause') + '</button><button id="al-skip">Skip</button><button id="al-mute">' + (S.muted ? 'Voice off' : 'Voice on') + '</button><button class="stop" id="al-stop">Stop</button></div>'
        + '<small>Educational simulation. Every call is logged, stopped ones too. No orders are placed. Not advice.</small>';
      panel.querySelector('#al-pause').onclick = () => { S.paused = !S.paused; try { if (S.audio) { S.paused ? S.audio.pause() : S.audio.play().catch(() => {}); } if (root.speechSynthesis) S.paused ? root.speechSynthesis.pause() : root.speechSynthesis.resume(); } catch (_) { /* fine */ } paint(); };
      panel.querySelector('#al-skip').onclick = () => { S.skip = true; stopMine(); try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (_) { /* fine */ } };
      panel.querySelector('#al-mute').onclick = () => { S.muted = !S.muted; if (S.muted) stopMine(); try { if (S.muted && root.speechSynthesis) root.speechSynthesis.cancel(); } catch (_) { /* fine */ } save(); paint(); };
      panel.querySelector('#al-stop').onclick = () => stop(false);
    }
    const statusText = (c) => c.status === 'done' ? 'all targets hit' : c.status === 'stopped' ? 'stopped out' : c.status === 'stopped_after_target' ? 'target ' + c.hit + ' hit, then stopped' : c.status === 'expired' ? 'expired' + (c.hit ? ' after target ' + c.hit : '') : 'open';

    /* ---- data ---- */
    async function candidates() {
      const [sig, uv, fda, earn] = await Promise.all([api('/academy-activity/signals?limit=40'), api('/academy-activity/unusual-volume'), api('/academy-activity/fda?days=14&limit=10'), api('/academy-activity/earnings-playbook?days=3&limit=15')]);
      if (!S.on) return [];
      const movers = [...document.querySelectorAll('#academy-scan-body tr[data-symbol]')].slice(0, 20).map((tr) => { const t = tr.textContent.match(/([+-]?\d+(?:\.\d+)?)%/); return { sym: tr.dataset.symbol, chg: t ? Number(t[1]) : null }; });
      const rows = (j, k) => (j && Array.isArray(j[k]) ? j[k] : []);
      return buildQueue({ signals: rows(sig, 'signals'), unusual: rows(uv, 'rows'), fda: rows(fda, 'events'), earnings: rows(earn, 'events').concat(rows(earn, 'rows')), movers }, { seen: S.seen, skip: S.calls.filter((c) => c.status === 'open').map((c) => c.sym) });
    }
    const priceOf = async (sym) => { const j = await api('/academy-activity/live?symbol=' + encodeURIComponent(sym)); return j && num(j.last); };
    async function showSymbol(sym) { try { if (typeof root.smlAcademyNavigateMarket === 'function') await root.smlAcademyNavigateMarket(sym, '5m'); } catch (_) { /* keep going */ } await wait(1200); try { if (root.smlChartPro) root.smlChartPro.setView(); } catch (_) { /* fine */ } draw(); }

    /* ---- watching every open call, whatever is on screen ---- */
    const alerts = [];
    async function watchTick() {
      if (!S.on) return;
      for (const c of S.calls.filter((x) => x.status === 'open')) {
        const p = await priceOf(c.sym); if (!(p > 0)) continue; c.last = p;
        for (const e of judge(c, p)) alerts.push({ call: c, e });
      }
      save(); if (alerts.length) paint();
    }
    async function drainAlerts() {
      while (S.on && alerts.length) {
        const { call, e } = alerts.shift(); S.phase = 'update'; S.focus = call; paint();
        await showSymbol(call.sym);
        if (e.type === 'target') { pointAt({ kind: 'price', price: e.price, label: 'TARGET ' + e.n + ' HIT ' + fmt(e.price) }); await speak(call.sym + ' just hit target ' + e.n + ' at ' + fmt(e.price) + '. ' + (e.n === 1 ? 'That one counts as a win on the board. A common way to handle it is to take some off and move the stop to your entry.' : 'Still running, so trail the stop under the last target.')); }
        else if (e.type === 'done') await speak(call.sym + ' finished the whole ladder. That is the full idea played out.');
        else if (e.type === 'stop') { pointAt({ kind: 'price', price: e.price, label: 'STOPPED ' + fmt(e.price) }); await speak(call.sym + ' hit the stop at ' + fmt(e.price) + (e.afterTarget ? ', after already paying at target ' + call.hit + '.' : '. That one is a loss and it stays on the scoreboard. This is why we always know the stop before we enter.')); }
        else if (e.type === 'expired') await speak(call.sym + ' never resolved today, so the desk closes it flat. Time is a cost too.');
        pointAt(null); save(); paint(); await hold(1500);
      }
    }

    /* ---- the director ---- */
    async function marketSegment() {
      S.phase = 'market'; paint(); await showSymbol('SPY');
      const [dir, vix] = await Promise.all([api('/academy-activity/direction?mode=day'), api('/academy-activity/vix')]);
      const ms_ = marketScript(dir, vix); for (let i = 0; i < ms_.length; i++) { const s = ms_[i]; if (!S.on || S.skip) break; pointAt(s.point); await speak(s.say, ms_[i + 1] && ms_[i + 1].say); await hold(500); }
      pointAt(null); S.skip = false;
      const [fda, earn] = await Promise.all([api('/academy-activity/fda?days=21&limit=10'), api('/academy-activity/earnings-playbook?days=5&limit=12')]);
      const cs = catalystScript(fda && fda.events, (earn && (earn.events || earn.rows)) || []);
      if (cs.length) S.phase = 'catalysts';
      for (let i = 0; i < cs.length; i++) { const s = cs[i]; if (!S.on || S.skip) break; paint(); pointAt(s.point); await speak(s.say, cs[i + 1] && cs[i + 1].say); await hold(500); }
      pointAt(null); S.skip = false;
    }
    async function tradeSegment(cand) {
      S.phase = 'scanning'; S.focus = null; S.cap = 'Looking at ' + cand.sym + '…'; paint(); S.seen[cand.sym] = Date.now(); save();
      const t = await api('/academy-activity/targets?symbol=' + encodeURIComponent(cand.sym) + '&direction=auto&horizon=day');
      if (!S.on) return;
      if (!t || !t.ok || !Array.isArray(t.targets) || t.targets.length < 3) return;
      await showSymbol(cand.sym);
      const call = { id: cand.sym + ':' + Date.now(), sym: cand.sym, side: t.direction, entry: t.price, targets: t.targets.slice(0, 3).map((x) => x.price), stop: t.stop.price, at: Date.now(), hit: 0, status: 'open', why: cand.why.slice(0, 2) };
      S.calls.push(call); S.focus = call; S.trades++; S.phase = 'trade'; save(); paint(); draw();
      const dirRead = null;
      const steps = setupScript(cand, t, dirRead);
      for (let i = 0; i < steps.length; i++) { const s = steps[i]; if (!S.on || S.skip) break; pointAt(s.point); draw(); await speak(s.say, steps[i + 1] ? steps[i + 1].say : "Now we watch it. If it moves, I will come back to it; meanwhile let's find the next one."); await hold(450); }
      pointAt(null); S.skip = false;
      S.phase = 'watching'; paint(); await speak('Now we watch it. If it moves, I will come back to it; meanwhile let\'s find the next one.');
      await hold(3000);
    }
    async function loop() {
      const run = ++S.run; let since = 0;
      await speak('Auto Live desk is on. I will scan the whole Academy for the best setups, show you how to read each one, and keep score honestly.');
      while (S.on && run === S.run) {
        try {
          await watchTick(); await drainAlerts();
          if (since % 3 === 0) await marketSegment();
          since++;
          S.phase = 'scanning'; paint();
          const q = await candidates(); S.queue = q;
          if (!q.length) { S.cap = 'Nothing new worth a look right now. Scanning again shortly.'; paint(); await hold(25000); await watchTick(); await drainAlerts(); continue; }
          await tradeSegment(q[0]);
          await watchTick(); await drainAlerts();
        } catch (_) { await wait(5000); }
      }
    }
    function start() {
      if (S.on || !S.owner) return; S.on = true; S.paused = false; S.skip = false; paint(); void loop();
      S.timer = setInterval(() => { void watchTick().then(() => (alerts.length && S.phase === 'watching' ? paint() : null)); }, 20000);
    }
    function stop(denied) {
      S.on = false; S.run++; pointAt(null); clearInterval(S.timer); stopMine(); try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (_) { /* fine */ }
      if (denied) { S.owner = false; if (btn) btn.style.display = 'none'; }
      panel.classList.remove('on'); if (btn) btn.classList.remove('on'); draw(); save();
    }

    /* ---- the owner's button: built only after the server says this is the owner ---- */
    let btn = null;
    function build() {
      if (btn) return; const toolbar = document.querySelector('.toolbar') || document.body;
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'auto-live-btn'; btn.textContent = 'AUTO LIVE';
      btn.title = 'Owner only: the desk finds setups across the whole Academy, talks through them, points at the levels and keeps an honest scoreboard.';
      btn.addEventListener('click', () => { if (S.on) stop(false); else start(); });
      toolbar.appendChild(btn);
    }
    async function checkOwner() {
      if (!token() || S.owner || S.denied) return;
      const j = await api('/academy-activity/signals?limit=1');
      if (j && j.ok) { S.owner = true; root.smlOwner = true; build(); }
    }
    root.addEventListener('sml-academy-session', () => { void checkOwner(); });
    setTimeout(() => { void checkOwner(); }, 1500); setInterval(() => { if (!S.owner && !document.hidden) void checkOwner(); }, 30000);
    root.smlAutoLive = { check: checkOwner, start, stop: () => stop(false), state: () => S, scoreboard: () => scoreboard(S.calls) };
  })(0);
})(typeof window !== 'undefined' ? window : null);
