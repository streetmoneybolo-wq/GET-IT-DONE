/* AUTO LIVE DESK (owner only), built to be screen-shared in Discord: a big caption bar, a banner with the live ticker and its P/L, a scoreboard with every open call, a pointer, and a chime on hits.
   AUTO LIVE DESK (owner only). A live-stream trader that runs by itself: it looks across everything the Academy already knows (MEM ALGO signals,
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
  /* the short phrases the desk says out loud (the full read stays in the captions); few and fixed, so each is voiced once and reused */
  const OPENERS = { long: ['Check this stock out.', 'This stock is running.', 'Look at this one.', 'This one is moving.', 'Keep an eye on this one.', 'Here is one to watch.'], short: ['Watch this one drop.', 'This one is heading down.', 'Weakness here.', 'This one is falling.'] };
  const TARGET_SAY = { 1: 'Target one hit.', 2: 'Target two hit.', 3: 'Target three hit.' };
  let lastOpen = -1;
  const opener = (side) => { const pool = OPENERS[side === 'short' ? 'short' : 'long']; let i = Math.floor(Math.random() * pool.length); if (pool.length > 1 && i === lastOpen) i = (i + 1) % pool.length; lastOpen = i; return pool[i]; };
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

  /* the bars since a call was made decide it, so a spike between two polls still counts. Within one bar the order of high and low is unknown:
     if the stop and the next target both sit inside a bar, the stop is taken first (the cautious reading). Bars before the call are never used. */
  function judgeBars(call, bars, now = Date.now()) {
    const ev = []; if (!call || call.status !== 'open' || !Array.isArray(bars)) return ev;
    const long = call.side !== 'short', ms = (t) => (t < 1e12 ? t * 1000 : t);
    for (const b of bars) {
      const t = ms(Number(b.t)), hi = num(b.h), lo = num(b.l); if (!(t >= call.at) || t <= (call.scanned || 0) || hi == null || lo == null) continue;
      call.scanned = t;
      const stopHit = long ? lo <= call.stop : hi >= call.stop;
      if (stopHit) { call.status = call.hit ? 'stopped_after_target' : 'stopped'; call.closedAt = t; ev.push({ type: 'stop', price: call.stop, afterTarget: call.hit > 0, at: t, cautious: (long ? hi : lo) != null && (long ? hi >= call.targets[call.hit] : lo <= call.targets[call.hit]) }); return ev; }
      while (call.hit < call.targets.length && (long ? hi >= call.targets[call.hit] : lo <= call.targets[call.hit])) { call.hit++; ev.push({ type: 'target', n: call.hit, price: call.targets[call.hit - 1], at: t }); }
      if (call.hit >= call.targets.length) { call.status = 'done'; call.closedAt = t; ev.push({ type: 'done', at: t }); return ev; }
    }
    if (call.status === 'open' && now - call.at > CALL_LIFE_MS) { call.status = 'expired'; call.closedAt = now; ev.push({ type: 'expired', at: now }); }
    return ev;
  }

  /* is this ladder worth a call? Returns the entry to use (the live price when there is one) or why the desk passes. */
  function vetCall(t, livePrice) {
    if (!t || !Array.isArray(t.targets) || t.targets.length < 3 || !t.stop) return { ok: false, reason: 'the target engine had no clean ladder' };
    const long = t.direction !== 'short', px = livePrice > 0 ? livePrice : num(t.price), tg = t.targets.map((x) => num(x.price)), stop = num(t.stop.price);
    if (!(px > 0) || tg.some((v) => v == null) || stop == null) return { ok: false, reason: 'the numbers were incomplete' };
    const ordered = long ? px < tg[0] && tg[0] < tg[1] && tg[1] < tg[2] && stop < px : px > tg[0] && tg[0] > tg[1] && tg[1] > tg[2] && stop > px;
    if (!ordered) return { ok: false, reason: 'price has already moved through the first level' };
    const drift = Math.abs(px / num(t.price) - 1) * 100; if (num(t.price) > 0 && drift > 0.6) return { ok: false, reason: 'price moved ' + drift.toFixed(1) + ' percent since the read, so the ladder is stale' };
    const p1 = num(t.targets[0].prob); if (p1 != null && p1 < 30) return { ok: false, reason: 'the first target only has ' + p1 + ' percent odds' };
    const rr = Math.abs(tg[0] - px) / Math.abs(px - stop); if (rr < 0.5) return { ok: false, reason: 'the first target pays too little for the stop' };
    return { ok: true, entry: px, rr: Math.round(rr * 100) / 100 };
  }

  /* how far a call is: R multiple (1R = the stop distance), percent move for the trade side, and 0..1 progress from stop to the next target */
  function progress(call, price) {
    if (!call || !(price > 0)) return null; const dir = call.side === 'short' ? -1 : 1, risk = Math.abs(call.entry - call.stop) || 1;
    const r = ((price - call.entry) * dir) / risk, pct = (price / call.entry - 1) * dir * 100, next = call.targets[Math.min(call.hit, call.targets.length - 1)];
    const span = Math.abs(next - call.stop) || 1; return { r: Math.round(r * 100) / 100, pct: Math.round(pct * 100) / 100, frac: Math.max(0, Math.min(1, ((price - call.stop) * dir) / span)) };
  }

  const TIPS = [
    { say: 'To do this yourself: open the Targets tool, pick a horizon, and it draws the same ladder with the odds.', id: 'targets-toggle', label: 'TARGETS' },
    { say: 'Turn on Walls to see where the big resting orders sit. A target just before a wall is a target worth taking early.', id: 'depth-walls', label: 'WALLS' },
    { say: 'Turn on S M C to see order blocks and liquidity. The best stops sit just beyond them.', id: 'smc-toggle', label: 'SMC' },
    { say: 'Click the chart at any price to set an alert there, and the line stays on your chart until it breaks.', id: 'chart', label: 'CLICK TO ALERT' },
    { say: 'Open Market Direction before you take any long: trading with the market is the easiest edge there is.', id: 'academy-direction', label: 'MARKET DIRECTION' }
  ];

  /* what the host says for a trade: short, one idea per step, each with a chapter tag for the banner and a pointer target. Says only what the numbers say. */
  function setupScript(cand, t, dir, opts = {}) {
    const n = Number(opts.n) || 0, long = t.direction !== 'short', side = long ? 'long' : 'short', steps = [];
    const why = cand.why.slice(0, 2).join(', and ');
    steps.push({ ch: 'WHY IT IS HERE', say: cand.sym + ' came up' + (why ? ': ' + why : '') + '.', point: { kind: 'el', id: 'symbol', label: cand.sym } });
    if (dir && dir.line) steps.push({ ch: 'MARKET', say: dir.line, point: null });
    steps.push({ ch: 'ENTRY', say: 'The read leans ' + side + (t.confidence ? ', ' + t.confidence + ' confidence' : '') + '. Entry is about ' + fmt(opts.entry || t.price) + '.', point: { kind: 'price', price: opts.entry || t.price, label: 'ENTRY ' + fmt(opts.entry || t.price) } });
    t.targets.forEach((x, i) => steps.push({ ch: 'TARGET ' + (i + 1), say: i === 0 ? 'Target one is ' + fmt(x.price) + ', ' + Math.abs(x.pct).toFixed(1) + ' percent away. This stock\'s history got there before the stop about ' + x.prob + ' percent of the time.' : 'Target ' + (i === 1 ? 'two' : 'three') + ' is ' + fmt(x.price) + ', about ' + x.prob + ' percent.', point: { kind: 'price', price: x.price, label: 'T' + (i + 1) + ' ' + fmt(x.price) + ' · ' + x.prob + '%' } }));
    steps.push({ ch: 'STOP', say: 'The stop is ' + fmt(t.stop.price) + ', ' + (t.stop.basis || 'past the nearest level against the trade') + '. If it trades there the idea is wrong.', point: { kind: 'price', price: t.stop.price, label: 'STOP ' + fmt(t.stop.price) } });
    const rr = opts.rr != null ? opts.rr : (t.rr && t.rr[0] != null ? t.rr[0] : null);
    if (rr != null) steps.push({ ch: 'RISK', say: 'Target one pays ' + rr + ' times the stop' + (rr < 1 ? ', which is thin: small size or wait.' : '.'), point: null });
    if (t.notes && t.notes[0]) steps.push({ ch: 'NOTE', say: t.notes[0], point: null });
    const tip = TIPS[n % TIPS.length]; steps.push({ ch: 'HOW YOU DO IT', say: tip.say, point: { kind: 'el', id: tip.id, label: tip.label } });
    if (n % 3 === 0) steps.push({ ch: 'REMINDER', say: 'This is an education call, not advice. Nothing here places an order, and it goes on the scoreboard win or lose.', point: null });
    return steps;
  }

  function marketScript(dir, vix) {
    const steps = [];
    if (dir && dir.ok) {
      const side = dir.bias >= 25 ? 'leaning bullish' : dir.bias <= -25 ? 'leaning bearish' : 'mixed';
      steps.push({ ch: 'MARKET', say: 'Big picture first. The Academy reads the market ' + side + ', labeled ' + String(dir.label || 'neutral').toLowerCase() + ', with ' + Math.round(dir.confidence || 0) + ' percent confidence.', point: { kind: 'el', id: 'academy-direction', label: 'MARKET DIRECTION' } });
      if (dir.session && !/open|regular/i.test(String(dir.session))) steps.push({ ch: 'MARKET', say: 'The regular session is not open, so spreads are wide and these reads are a practice run.', point: null });
      const top = (dir.components || []).slice(0, 2).map((c) => c.label).filter(Boolean); if (top.length) steps.push({ ch: 'MARKET', say: 'Driving it: ' + top.join(' and ') + '. Open Market Direction to see every piece.', point: null });
    } else steps.push({ ch: 'MARKET', say: 'The market read is not available right now, so size small until it is.', point: null });
    const v = vix && vix.ok !== false ? num(vix.level) : null;
    if (v != null) steps.push({ ch: 'VIX', say: 'The VIX is ' + v.toFixed(1) + (v >= 25 ? ', elevated: expect wide swings and use smaller size.' : v <= 14 ? ', calm: moves tend to be smaller and cleaner.' : ', in a normal range.'), point: { kind: 'el', id: 'academy-sml-vix', label: 'VIX ' + v.toFixed(1) } });
    return steps;
  }

  function catalystScript(fda, earn) {
    const steps = [];
    const f = (fda || []).filter((e) => e.kind === 'scheduled').slice(0, 2);
    if (f.length) steps.push({ ch: 'FDA', say: 'On the FDA calendar: ' + f.map((e) => e.symbol + ' ' + (e.daysAway <= 0 ? 'today' : e.daysAway === 1 ? 'tomorrow' : 'in ' + e.daysAway + ' days')).join(', ') + '. These are binary: small size or defined risk, and only what you can lose.', point: { kind: 'el', id: 'catalysts-toggle', label: 'CATALYSTS' } });
    const e = (earn || []).filter((x) => num(x.daysAway) != null && x.daysAway >= 0 && x.daysAway <= 3).slice(0, 3);
    if (e.length) steps.push({ ch: 'EARNINGS', say: 'Earnings coming: ' + e.map((x) => x.symbol).join(', ') + '. Options price in a big move, so check the expected move before you buy contracts.', point: { kind: 'el', id: 'catalysts-toggle', label: 'EARNINGS' } });
    return steps;
  }

  /* sentences of at most ~170 characters, because browsers cut a long utterance off after about fifteen seconds */
  function chunk(text, max = 170) {
    const out = []; for (const sent of String(text || '').split(/(?<=[.!?])\s+/)) {
      let s = sent.trim(); while (s.length > max) { let k = s.lastIndexOf(',', max); if (k < 40) k = s.lastIndexOf(' ', max); if (k < 20) k = max; out.push(s.slice(0, k + 1).trim()); s = s.slice(k + 1).trim(); }
      if (s) out.push(s);
    } return out;
  }

  /* keep speech to plain words: symbols read badly */
  const speakable = (s) => String(s || '').replace(/·/g, ',').replace(SPOKEN, ' ').replace(/\b([A-Z]{2,5})\b/g, (m) => (m === 'FDA' || m === 'VIX' || m === 'MEM' || m === 'ALGO' ? m : m.split('').join(' '))).replace(/\s+/g, ' ').trim();
  const readMs = (s) => Math.max(1800, String(s || '').length * 62);

  const API = { OPENERS, TARGET_SAY, opener, buildQueue, judge, judgeBars, vetCall, progress, scoreboard, setupScript, marketScript, catalystScript, chunk, speakable, readMs, TIPS, COOL_MS, CALL_LIFE_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  if (!root || !root.document) return;

  /* ---- browser side ---- */
  (function boot(tries) {
    if (root.__smlAutoLive) return;
    const stage = document.querySelector('.academy-chart-stage'), chartCanvas = document.getElementById('chart');
    if (!stage || !chartCanvas) { if (tries < 120) setTimeout(() => boot(tries + 1), 150); return; }
    root.__smlAutoLive = true;
    const KEY = 'sml-auto-live-v2', token = () => String(root.smlAcademySessionToken || '');
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const S = { on: false, paused: false, muted: false, calls: [], seen: {}, cap: '', ch: '', phase: 'idle', focus: null, trades: 0, passed: 0, skip: false, owner: false, run: 0, queue: [], pace: 1, clean: false, voiceOk: null, fails: 0, flash: '', note: '' };
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { S.calls = (v.calls || []).slice(-80); S.seen = v.seen || {}; S.muted = v.muted === true; S.pace = [0.8, 1, 1.25].includes(v.pace) ? v.pace : 1; S.trades = Number(v.trades) || 0; S.passed = Number(v.passed) || 0; } } catch (_) { /* storage can be blocked */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ calls: S.calls.slice(-80), seen: S.seen, muted: S.muted, pace: S.pace, trades: S.trades, passed: S.passed })); } catch (_) { /* fine */ } };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const gone = () => !S.on;

    async function api(path) {
      try {
        const go = (tok) => fetch(path, { headers: { authorization: 'Bearer ' + tok }, cache: 'no-store' });
        let res = await go(token());
        if (res.status === 401 && typeof root.smlAcademyReauth === 'function') { const fresh = await Promise.resolve(root.smlAcademyReauth()).catch(() => ''); if (fresh) res = await go(fresh); }
        if (res.status === 403) { const j = await res.json().catch(() => null); if (j && j.error === 'owner_only') { S.denied = true; stop(true); } return null; }
        if (res.status === 429) { await wait(2500); return null; }
        return res.ok ? await res.json().catch(() => null) : null;
      } catch (_) { return null; }
    }

    /* ---- the pointer ---- */
    const ptr = document.createElement('div'); ptr.id = 'sml-pointer'; ptr.setAttribute('aria-hidden', 'true');
    ptr.innerHTML = '<span class="ring"></span><svg viewBox="0 0 24 24" width="40" height="40"><path d="M3 2l17 8-7 2-2 7z" fill="#ffd166" stroke="#1a1204" stroke-width="1.4" stroke-linejoin="round"/></svg><b class="lab"></b>';
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
      const stopHit = c.status === 'stopped' || c.status === 'stopped_after_target';
      const rows = [{ p: c.entry, t: 'DESK ENTRY ' + fmt(c.entry), col: '#4dc3ff' }, ...c.targets.map((p, i) => ({ p, t: 'DESK T' + (i + 1) + ' ' + fmt(p) + (c.hit > i ? ' ✓ HIT' : ''), col: c.hit > i ? '#ffd166' : '#b48cff', hit: c.hit > i })), { p: c.stop, t: 'DESK STOP ' + fmt(c.stop) + (stopHit ? ' ✗ HIT' : ''), col: '#ffb04a' }];
      /* the path from entry to the next target, so viewers see the distance left */
      const next = c.targets[Math.min(c.hit, c.targets.length - 1)], y1 = M.y(c.entry), y2 = M.y(next);
      lctx.save(); lctx.beginPath(); lctx.rect(left, top, M.pw, bottom - top); lctx.clip();
      if (c.status === 'open') { lctx.fillStyle = 'rgba(180,140,255,.07)'; lctx.fillRect(left, Math.min(y1, y2), M.pw, Math.abs(y2 - y1)); }
      for (const r of rows) { const y = M.y(r.p); if (!(y >= top && y <= bottom)) continue; lctx.setLineDash(r.hit ? [] : [7, 5]); lctx.lineWidth = r.hit ? 2.4 : 1.8; lctx.strokeStyle = r.col; lctx.globalAlpha = .92; lctx.beginPath(); lctx.moveTo(left, Math.round(y) + .5); lctx.lineTo(right, Math.round(y) + .5); lctx.stroke(); r.y = y; }
      lctx.restore(); lctx.setLineDash([]);
      const placed = [];
      for (const r of rows.filter((q) => q.y != null)) {
        let ly = r.y; for (let k = 0; k < 8; k++) { const hp = placed.find((q) => Math.abs(q - ly) < 18); if (hp == null) break; ly = ly >= hp ? hp + 19 : hp - 19; }
        placed.push(ly); lctx.font = '800 12px ui-monospace,monospace'; const tw = lctx.measureText(r.t).width + 14, x = left + 8;
        lctx.fillStyle = 'rgba(8,10,20,.92)'; lctx.fillRect(x, ly - 10, tw, 20); lctx.strokeStyle = r.col; lctx.lineWidth = 1.2; lctx.strokeRect(x + .5, ly - 9.5, tw - 1, 19);
        lctx.fillStyle = r.col; lctx.textAlign = 'left'; lctx.textBaseline = 'middle'; lctx.fillText(r.t, x + 7, ly + .5);
      }
    }
    root.addEventListener('sml-chart-view', draw); root.addEventListener('resize', () => { draw(); layoutOverlay(); });
    (function reg(n) { if (root.smlChartLevels) { root.smlChartLevels.register('auto-live', (s) => (S.on && S.focus && S.focus.sym === s ? [S.focus.entry, S.focus.stop, ...S.focus.targets] : [])); return; } if (n < 60) setTimeout(() => reg(n + 1), 500); })(0);

    /* ---- sound: a short chime on a hit, a low note on a stop (Web Audio, nothing downloaded) ---- */
    let actx = null;
    function chime(good) {
      if (S.muted) return;
      try {
        actx = actx || new (root.AudioContext || root.webkitAudioContext)(); const t0 = actx.currentTime;
        (good ? [660, 880, 1175] : [220, 165]).forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = good ? 'sine' : 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + i * .13); g.gain.exponentialRampToValueAtTime(.18, t0 + i * .13 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + i * .13 + .3); o.connect(g); g.connect(actx.destination); o.start(t0 + i * .13); o.stop(t0 + i * .13 + .32); });
      } catch (_) { /* silent is fine */ }
    }

    /* ---- the voice: the browser's own, free. Sentence by sentence; if it never starts the captions carry the show and the panel says so ---- */
    let voice = null;
    const pickVoice = () => {
      try {
        const vs = (root.speechSynthesis && root.speechSynthesis.getVoices()) || []; const en = vs.filter((v) => /^en[-_]/i.test(v.lang));
        voice = en.find((v) => /natural|neural|google us english|samantha|aria|jenny|guy/i.test(v.name)) || en.find((v) => /en[-_]US/i.test(v.lang)) || en[0] || null;
      } catch (_) { voice = null; }
    };
    if (root.speechSynthesis) { pickVoice(); try { root.speechSynthesis.onvoiceschanged = pickVoice; } catch (_) { /* fine */ } }
    function utter(text) {
      return new Promise((resolve) => {
        let done = false, started = false; const fin = () => { if (!done) { done = true; clearTimeout(tm); clearTimeout(wd); resolve(); } };
        const tm = setTimeout(fin, readMs(text) * 2.5 + 3000), wd = setTimeout(() => { if (!started) { S.voiceOk = false; paint(); fin(); } }, 3500);
        try {
          const u = new SpeechSynthesisUtterance(speakable(text)); if (voice) u.voice = voice; u.rate = 1.03 * (S.pace > 1 ? 1.12 : S.pace < 1 ? .92 : 1); u.pitch = 1; u.lang = 'en-US';
          u.onstart = () => { started = true; if (S.voiceOk !== true) { S.voiceOk = true; paint(); } }; u.onend = fin; u.onerror = fin; root.speechSynthesis.speak(u);
        } catch (_) { S.voiceOk = false; fin(); }
      });
    }
    /* The owner's own voice (ElevenLabs, stored once per line on the server). A line is fetched ahead of time, so the next one is usually ready when the
       last one ends. If it cannot be reached (or is rate limited) the desk speaks with the browser voice instead, so it never goes quiet. */
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
    async function sayMine(text, minePromise) {
      const url = await minePromise;
      if (!url) return false;
      if (gone() || S.muted) return true;
      while (S.on && S.paused) await wait(300);
      if (gone() || S.muted) return true;
      return new Promise((resolve) => {
        let done = false; const a = new Audio(url); S.audio = a;
        const fin = (ok) => { if (!done) { done = true; clearTimeout(tm); if (S.audio === a) S.audio = null; resolve(ok); } };
        const tm = setTimeout(() => fin(true), readMs(text) * 3 + 8000);
        a._fin = () => fin(true); a.onended = () => { if (S.voiceOk !== true) { S.voiceOk = true; } fin(true); };
        a.onerror = () => { mineFails += 1; fin(false); };
        a.play().then(() => { if (S.voiceOk !== true) { S.voiceOk = true; paint(); } }, () => fin(false));
      });
    }
    /* The captions carry the whole read; the voice only says a short tag: the ticker and a phrase from a small fixed bank, in the owner's voice (each
       one voiced once and reused, so it costs almost nothing). A step with no tag is read in silence at a quicker pace. */
    async function say(text, ch, spoken) {
      S.cap = text; if (ch != null) S.ch = ch; paintCap();
      const tags = (Array.isArray(spoken) ? spoken : spoken ? [spoken] : []).filter(Boolean);
      if (!tags.length || S.muted) { await timed(Math.min(readMs(text) * 0.45, 5000) / S.pace); return; }
      if (mineOn()) tags.forEach((p) => void clipFor(p));
      for (const p of tags) {
        if (gone() || S.skip) break;
        if (mineOn() && await sayMine(p, clipFor(p))) continue;
        if (gone() || S.skip) break;
        if (!root.speechSynthesis || S.voiceOk === false) { await timed(readMs(p) / S.pace); continue; }
        try { root.speechSynthesis.cancel(); } catch (_) { /* fine */ }
        await utter(p); while (S.on && S.paused) await wait(250);
      }
    }
    /* a wait that ends early on skip and holds while paused */
    async function timed(ms) { let left = ms; while (S.on && left > 0 && !S.skip) { await wait(200); if (!S.paused) left -= 200; } }
    const hold = (ms) => timed(ms / S.pace);
    async function speak(text, ch, spoken) { await say(text, ch, spoken); }
    function testVoice() { if (mineOn()) { void sayMine('Voice check.', clipFor('Voice check.')); return; } if (!root.speechSynthesis) { S.voiceOk = false; S.note = 'This browser has no speech. Captions still work.'; paint(); return; } S.voiceOk = null; S.muted = false; try { root.speechSynthesis.cancel(); } catch (_) { /* fine */ } void utter('Voice check. If you can hear this, the desk can talk.').then(() => { if (S.voiceOk == null) S.voiceOk = false; paint(); }); }

    /* ---- the overlays: banner at the top, caption bar at the bottom, board at the side ---- */
    const banner = document.createElement('div'); banner.id = 'al-banner';
    const capbar = document.createElement('div'); capbar.id = 'al-caption';
    const panel = document.createElement('aside'); panel.id = 'auto-live-panel'; panel.setAttribute('aria-label', 'Auto live desk');
    const capbody = document.createElement('div'); capbar.append(banner, capbody); document.body.append(capbar, panel);
    const st = document.createElement('style'); st.textContent = [
      '#auto-live-btn{border-color:#b48cff!important;color:#e4d3ff!important}#auto-live-btn.on{background:#3b2766!important;color:#fff!important;box-shadow:0 0 0 1px #b48cff}',
      '#al-caption,#auto-live-panel{display:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif}#al-banner{display:flex}body.al-on #al-caption{display:block}body.al-on #auto-live-panel{display:block}',
      '#al-banner{align-items:center;gap:10px;flex-wrap:wrap;color:#fff;font-weight:800;font-size:.95rem;padding:0 0 7px;margin-bottom:7px;border-bottom:1px solid #3a2c63;transition:background .3s}',
      '#al-banner i{width:10px;height:10px;border-radius:50%;background:#ff4d6d;animation:alp 1.2s infinite;flex:none}@keyframes alp{50%{opacity:.25}}#al-banner .ph{color:#caa8ff;font:800 .72rem ui-monospace,monospace;letter-spacing:.1em}#al-banner .sym{font-size:1.15rem}#al-banner .up{color:#35e6a0}#al-banner .dn{color:#ff6b86}#al-banner .px{font:800 .9rem ui-monospace,monospace}#al-banner .pl{font:800 .8rem ui-monospace,monospace;opacity:.95}',
      '#al-caption{transition:background .3s,border-color .3s,box-shadow .3s}#al-caption.win{background:#0f3a26;border-color:#35e6a0;box-shadow:0 0 40px rgba(53,230,160,.7)}#al-caption.loss{background:#3a1220;border-color:#ff6b86;box-shadow:0 0 40px rgba(255,107,134,.6)}',
      '#al-caption{position:fixed;left:12px;bottom:calc(var(--sml-inset-bottom,0px) + 12px);width:calc(100vw - 404px);max-width:980px;z-index:2147483002;background:rgba(8,6,18,.95);border:1px solid #6b4bb8;border-radius:14px;padding:11px 18px 13px;color:#fff;box-shadow:0 10px 34px rgba(0,0,0,.6)}',
      '#al-caption .chip{display:inline-block;background:#6b4bb8;color:#fff;font:800 .68rem ui-monospace,monospace;letter-spacing:.1em;padding:2px 9px;border-radius:5px;margin-bottom:5px}#al-caption .txt{font-weight:750;font-size:clamp(1.05rem,1.55vw,1.5rem);line-height:1.38;min-height:2.7em}',
      '#auto-live-panel{position:fixed;right:10px;bottom:calc(var(--sml-inset-bottom,0px) + 10px);z-index:2147483001;width:380px;max-height:62vh;overflow:auto;background:rgba(10,8,22,.96);border:1px solid #6b4bb8;border-radius:12px;color:#efeaff;font-weight:650;font-size:.78rem;padding:9px 11px;box-shadow:0 10px 36px rgba(0,0,0,.6)}',
      '#auto-live-panel h4{margin:0 0 5px;font:800 .66rem ui-monospace,monospace;letter-spacing:.1em;color:#caa8ff}#auto-live-panel .card{border:1px solid #3a2c63;border-radius:8px;padding:6px 8px;margin:5px 0;background:#150f2e}#auto-live-panel .card.f{border-color:#b48cff}',
      '#auto-live-panel .card b{color:#ffd166}#auto-live-panel .up{color:#35e6a0}#auto-live-panel .dn{color:#ff6b86}#auto-live-panel .bar{height:6px;border-radius:3px;background:#2a1f4d;margin-top:5px;overflow:hidden}#auto-live-panel .bar span{display:block;height:100%;background:linear-gradient(90deg,#ff6b86,#ffd166 40%,#35e6a0)}',
      '#auto-live-panel .row{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;transition:opacity .4s}#auto-live-panel.idle .row{opacity:0}#auto-live-panel:hover .row,#auto-live-panel .row:focus-within{opacity:1}',
      '#auto-live-panel button,#auto-live-panel select{border:1px solid #6b4bb8;background:#21163f;color:#efeaff;border-radius:6px;padding:4px 9px;font:800 .68rem system-ui,sans-serif;cursor:pointer}#auto-live-panel button.stop{border-color:#ff6b86;color:#ffb3c1}',
      '#auto-live-panel small{color:#a99bd3;font-weight:600;line-height:1.35;display:block;margin-top:5px}#auto-live-panel .sc{display:flex;gap:10px;flex-wrap:wrap;font:800 .7rem ui-monospace,monospace;margin:6px 0}#auto-live-panel .nx{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}#auto-live-panel .nx span{background:#21163f;border:1px solid #3a2c63;border-radius:5px;padding:1px 7px;font:800 .66rem ui-monospace,monospace;color:#d8c8ff}#auto-live-panel .warn{color:#ffb04a}',
      'body.al-clean #auto-live-panel{display:none}body.al-clean #al-caption{width:min(980px,calc(100vw - 24px));left:50%;transform:translateX(-50%)}#al-clean-fab{position:fixed;right:10px;bottom:calc(var(--sml-inset-bottom,0px) + 10px);z-index:2147483001;display:none;border:1px solid #6b4bb8;background:rgba(10,8,22,.8);color:#caa8ff;border-radius:8px;padding:3px 9px;font:800 .66rem system-ui;cursor:pointer;opacity:.35}#al-clean-fab:hover{opacity:1}body.al-on.al-clean #al-clean-fab{display:block}',
      '#sml-pointer{position:fixed;left:0;top:0;z-index:2147483003;pointer-events:none;opacity:0;transition:transform .9s cubic-bezier(.3,.8,.2,1),opacity .25s;will-change:transform}#sml-pointer.on{opacity:1}',
      '#sml-pointer svg{position:absolute;left:-6px;top:-4px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.8));animation:ptb 1s ease-in-out infinite}@keyframes ptb{50%{transform:translate(5px,5px)}}',
      '#sml-pointer .ring{position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;border:3px solid #ffd166;animation:ptr 1.3s ease-out infinite}@keyframes ptr{from{transform:scale(.5);opacity:1}to{transform:scale(1.7);opacity:0}}',
      '#sml-pointer .lab{position:absolute;left:36px;top:14px;white-space:nowrap;background:#ffd166;color:#1a1204;font:800 .85rem ui-monospace,monospace;padding:3px 10px;border-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,.5)}#sml-pointer .lab:empty{display:none}',
      '@media (max-width:900px){#al-caption{width:calc(100vw - 24px);bottom:auto;top:calc(var(--sml-inset-top,0px) + 50px)}#auto-live-panel{left:8px;right:8px;width:auto;max-height:36vh;bottom:calc(var(--sml-inset-bottom,0px) + 62px)}#al-banner{font-size:.8rem}#al-caption .txt{font-size:1rem;min-height:0}}'
    ].join(''); document.head.appendChild(st);
    const fab = document.createElement('button'); fab.id = 'al-clean-fab'; fab.type = 'button'; fab.textContent = 'show desk'; fab.onclick = () => { S.clean = false; document.body.classList.remove('al-clean'); }; document.body.appendChild(fab);
    function layoutOverlay() { document.body.classList.toggle('al-on', S.on); document.body.classList.toggle('al-clean', S.on && S.clean); }
    let idleT = 0; const bump = () => { panel.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => panel.classList.add('idle'), 6000); };
    ['mousemove', 'touchstart', 'keydown'].forEach((e) => document.addEventListener(e, bump, { passive: true })); bump();

    const statusText = (c) => c.status === 'done' ? 'all targets hit' : c.status === 'stopped' ? 'stopped out' : c.status === 'stopped_after_target' ? 'target ' + c.hit + ' hit, then stopped' : c.status === 'expired' ? 'expired' + (c.hit ? ' after target ' + c.hit : '') : 'open';
    const sign = (v) => (v > 0 ? '+' : '') + v;
    function paintCap() { capbody.innerHTML = (S.ch ? '<span class="chip">' + esc(S.ch) + '</span>' : '') + '<div class="txt">' + esc(S.cap) + '</div>'; }
    function paintBanner() {
      const f = S.focus, pr = f ? progress(f, f.last) : null;
      banner.innerHTML = '<i></i><span class="ph">' + esc(S.paused ? 'PAUSED' : (S.phase || '').toUpperCase()) + '</span>'
        + (f ? '<span class="sym">' + esc(f.sym) + '</span><span class="' + (f.side === 'short' ? 'dn' : 'up') + '">' + (f.side === 'short' ? 'SHORT' : 'LONG') + '</span>' + (f.last ? '<span class="px">' + fmt(f.last) + '</span>' : '') + (pr ? '<span class="pl ' + (pr.pct >= 0 ? 'up' : 'dn') + '">' + sign(pr.pct) + '% · ' + sign(pr.r) + 'R</span>' : '') + (f.status !== 'open' ? '<span class="ph">' + esc(statusText(f).toUpperCase()) + '</span>' : '')
          : '<span class="sym">AUTO LIVE DESK</span>')
        + '<span class="ph">EDUCATIONAL · NOT ADVICE</span>';
      capbar.classList.toggle('win', S.flash === 'win'); capbar.classList.toggle('loss', S.flash === 'loss');
    }
    function paint() {
      layoutOverlay(); if (btn) btn.classList.toggle('on', S.on); if (!S.on) return;
      paintBanner(); paintCap();
      const sb = scoreboard(S.calls), f = S.focus, open = S.calls.filter((c) => c.status === 'open');
      const card = (c, focus) => { const pr = progress(c, c.last); return '<div class="card' + (focus ? ' f' : '') + '"><b>' + esc(c.sym) + '</b> ' + (c.side === 'short' ? '<span class="dn">SHORT</span>' : '<span class="up">LONG</span>') + ' · in ' + fmt(c.entry) + ' · stop ' + fmt(c.stop) + (pr && c.status === 'open' ? ' · <span class="' + (pr.pct >= 0 ? 'up' : 'dn') + '">' + sign(pr.pct) + '% ' + sign(pr.r) + 'R</span>' : '') + '<br>' + c.targets.map((p, i) => '<span class="' + (c.hit > i ? 'up' : '') + '">T' + (i + 1) + ' ' + fmt(p) + (c.hit > i ? ' ✓' : '') + '</span>').join(' · ') + (c.status !== 'open' ? '<br><small>' + esc(statusText(c)) + '</small>' : '<div class="bar"><span style="width:' + Math.round(((pr && pr.frac) || 0) * 100) + '%"></span></div>') + '</div>'; };
      const others = open.filter((c) => !f || c.id !== f.id), recent = S.calls.filter((c) => c.status !== 'open').slice(-4).reverse();
      panel.innerHTML = '<h4>LIVE DESK</h4>'
        + (f ? card(f, true) : '')
        + (others.length ? '<small>Still watching (' + others.length + ')</small>' + others.slice(0, 4).map((c) => card(c, false)).join('') : '')
        + '<div class="sc"><span>CALLS ' + sb.calls + '</span><span class="up">WON ' + sb.wins + '</span><span class="dn">STOPPED ' + sb.losses + '</span><span>OPEN ' + sb.open + '</span><span>PASSED ' + S.passed + '</span>' + (sb.rate != null ? '<span>HIT ' + sb.rate + '%</span>' : '') + (sb.avgPct != null ? '<span>AVG ' + sign(sb.avgPct) + '%</span>' : '') + '</div>'
        + (S.queue.length ? '<small>Next up</small><div class="nx">' + S.queue.slice(0, 5).map((c) => '<span>' + esc(c.sym) + '</span>').join('') + '</div>' : '')
        + (recent.length ? '<small>' + recent.map((c) => esc(c.sym + ': ' + statusText(c))).join(' · ') + '</small>' : '')
        + (S.voiceOk === false ? '<small class="warn">Voice is blocked in this window, so the captions carry it. Press Test voice, or share with audio from a full browser tab.</small>' : '') + (S.note ? '<small class="warn">' + esc(S.note) + '</small>' : '')
        + '<div class="row"><button id="al-pause">' + (S.paused ? 'Resume' : 'Pause') + '</button><button id="al-skip">Skip</button><button id="al-mute">' + (S.muted ? 'Voice off' : 'Voice on') + '</button><button id="al-test">Test voice</button><select id="al-pace" title="Pace"><option value="0.8"' + (S.pace === 0.8 ? ' selected' : '') + '>Slow</option><option value="1"' + (S.pace === 1 ? ' selected' : '') + '>Normal</option><option value="1.25"' + (S.pace === 1.25 ? ' selected' : '') + '>Fast</option></select><button id="al-clean">Clean view</button><button class="stop" id="al-stop">Stop</button></div>'
        + '<small>Educational simulation. Every call is logged, stopped ones too. Judged on the 1-minute candles, and when one candle touches both the stop and a target the stop counts first. No orders are placed. Not advice.</small>';
      panel.querySelector('#al-pause').onclick = () => { S.paused = !S.paused; try { if (S.audio) { S.paused ? S.audio.pause() : S.audio.play().catch(() => {}); } if (root.speechSynthesis) S.paused ? root.speechSynthesis.pause() : root.speechSynthesis.resume(); } catch (_) { /* fine */ } paint(); };
      panel.querySelector('#al-skip').onclick = () => { S.skip = true; stopMine(); try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (_) { /* fine */ } };
      panel.querySelector('#al-mute').onclick = () => { S.muted = !S.muted; if (S.muted) stopMine(); try { if (S.muted && root.speechSynthesis) root.speechSynthesis.cancel(); } catch (_) { /* fine */ } save(); paint(); };
      panel.querySelector('#al-test').onclick = testVoice;
      panel.querySelector('#al-pace').onchange = (e) => { S.pace = Number(e.target.value) || 1; save(); };
      panel.querySelector('#al-clean').onclick = () => { S.clean = true; layoutOverlay(); };
      panel.querySelector('#al-stop').onclick = () => stop(false);
    }

    /* ---- data ---- */
    async function candidates() {
      const [sig, uv, fda, earn] = await Promise.all([api('/academy-activity/signals?limit=40'), api('/academy-activity/unusual-volume'), api('/academy-activity/fda?days=14&limit=10'), api('/academy-activity/earnings-playbook?days=3&limit=15')]);
      if (gone()) return [];
      const movers = [...document.querySelectorAll('#academy-scan-body tr[data-symbol]')].slice(0, 20).map((tr) => { const t = tr.textContent.match(/([+-]?\d+(?:\.\d+)?)%/); return { sym: tr.dataset.symbol, chg: t ? Number(t[1]) : null }; });
      const rows = (j, k) => (j && Array.isArray(j[k]) ? j[k] : []);
      return buildQueue({ signals: rows(sig, 'signals'), unusual: rows(uv, 'rows'), fda: rows(fda, 'events'), earnings: rows(earn, 'events').concat(rows(earn, 'rows')), movers }, { seen: S.seen, skip: S.calls.filter((c) => c.status === 'open').map((c) => c.sym) });
    }
    const priceOf = async (sym) => { const j = await api('/academy-activity/live?symbol=' + encodeURIComponent(sym)); return j && num(j.last); };
    const barsOf = async (sym) => { const j = await api('/academy-activity/market?symbol=' + encodeURIComponent(sym) + '&tf=1m'); return j && Array.isArray(j.bars) ? j.bars : null; };
    async function showSymbol(sym) { try { if (typeof root.smlAcademyNavigateMarket === 'function') await root.smlAcademyNavigateMarket(sym, '5m'); } catch (_) { /* keep going */ } await wait(1400); try { if (root.smlChartPro) root.smlChartPro.setView(); } catch (_) { /* fine */ } draw(); }

    /* ---- watching every open call, whatever is on screen ---- */
    const alerts = [];
    let watching = false;
    async function watchTick() {
      if (!S.on || watching) return; watching = true;
      try {
        for (const c of S.calls.filter((x) => x.status === 'open')) {
          const [bars, p] = await Promise.all([barsOf(c.sym), priceOf(c.sym)]);
          const lastBar = bars && bars.length ? num(bars[bars.length - 1].c) : null;
          if (p > 0 || lastBar > 0) c.last = p > 0 ? p : lastBar;
          const evs = bars ? judgeBars(c, bars) : (c.last > 0 ? judge(c, c.last) : []);
          for (const e of evs) alerts.push({ call: c, e });
        }
        save(); paintBanner(); if (S.on) paint();
      } finally { watching = false; }
    }
    async function drainAlerts() {
      while (S.on && alerts.length) {
        const { call, e } = alerts.shift(); S.phase = 'update'; S.focus = call; paint();
        await showSymbol(call.sym);
        const late = e.at && Date.now() - e.at > 4 * 60_000 ? ' This happened a little while ago.' : '';
        if (e.type === 'target') { S.flash = 'win'; chime(true); paint(); pointAt({ kind: 'price', price: e.price, label: 'TARGET ' + e.n + ' HIT ' + fmt(e.price) }); await speak(call.sym + ' hit target ' + (e.n === 1 ? 'one' : e.n === 2 ? 'two' : 'three') + ' at ' + fmt(e.price) + '.' + late + (e.n === 1 ? ' That counts as a win on the board. A common way to handle it is to take some off and move the stop to your entry.' : ' Still running, so trail the stop under the last target.'), 'TARGET HIT', [call.sym, TARGET_SAY[e.n] || 'Target hit.']); }
        else if (e.type === 'done') { S.flash = 'win'; chime(true); paint(); await speak(call.sym + ' finished the whole ladder. That is the full idea played out.', 'ALL TARGETS', [call.sym, 'Full ladder.']); }
        else if (e.type === 'stop') { S.flash = 'loss'; chime(false); paint(); pointAt({ kind: 'price', price: e.price, label: 'STOPPED ' + fmt(e.price) }); await speak(call.sym + ' hit the stop at ' + fmt(e.price) + (e.afterTarget ? ', after already paying at target ' + call.hit + '.' : '. That one is a loss and it stays on the scoreboard. This is why we know the stop before we enter.') + (e.cautious ? ' The same candle also reached the target, and we count the stop first to stay honest.' : '') + late, 'STOPPED', [call.sym, 'Stopped out.']); }
        else if (e.type === 'expired') await speak(call.sym + ' never resolved in time, so the desk closes it flat. Time is a cost too.', 'EXPIRED', [call.sym, 'Closed flat.']);
        S.flash = ''; pointAt(null); save(); paint(); await hold(1200);
      }
    }

    /* ---- the director ---- */
    async function marketSegment() {
      S.phase = 'market'; S.focus = null; paint(); await showSymbol('SPY');
      const [dir, vix] = await Promise.all([api('/academy-activity/direction?mode=day'), api('/academy-activity/vix')]);
      const ms_ = marketScript(dir, vix); for (let i = 0; i < ms_.length; i++) { const s = ms_[i]; if (gone() || S.skip) break; pointAt(s.point); await speak(s.say, s.ch, i === 0 ? 'Market check.' : null); await hold(400); }
      pointAt(null); S.skip = false;
      const [fda, earn] = await Promise.all([api('/academy-activity/fda?days=21&limit=10'), api('/academy-activity/earnings-playbook?days=5&limit=12')]);
      const cs = catalystScript(fda && fda.events, (earn && (earn.events || earn.rows)) || []);
      if (cs.length) { S.phase = 'catalysts'; paint(); }
      for (let i = 0; i < cs.length; i++) { const s = cs[i]; if (gone() || S.skip) break; pointAt(s.point); await speak(s.say, s.ch, i === 0 ? 'Catalysts ahead.' : null); await hold(400); }
      pointAt(null); S.skip = false;
    }
    async function pass(cand, reason) {
      S.passed++; S.seen[cand.sym] = Date.now(); save(); S.phase = 'scanning'; S.focus = null; paint();
      await speak('Passing on ' + cand.sym + ': ' + reason + '. Not every setup earns a trade, and skipping is part of the job.', 'PASS', [cand.sym, 'Passing on this one.']);
    }
    async function tradeSegment(cand) {
      S.phase = 'scanning'; S.focus = null; S.ch = 'LOOKING'; S.cap = 'Checking ' + cand.sym + '…'; paint(); S.seen[cand.sym] = Date.now(); save();
      const t = await api('/academy-activity/targets?symbol=' + encodeURIComponent(cand.sym) + '&direction=auto&horizon=day');
      if (gone()) return;
      if (!t || !t.ok) { S.fails++; return; }
      const live = await priceOf(cand.sym), v = vetCall(t, live);
      if (!v.ok) { await pass(cand, v.reason); return; }
      if (gone()) return;
      await showSymbol(cand.sym);
      const call = { id: cand.sym + ':' + Date.now(), sym: cand.sym, side: t.direction, entry: v.entry, targets: t.targets.slice(0, 3).map((x) => x.price), stop: t.stop.price, at: Date.now(), hit: 0, status: 'open', last: v.entry, why: cand.why.slice(0, 2), scanned: 0 };
      S.calls.push(call); S.focus = call; S.trades++; S.phase = 'trade'; S.fails = 0; save(); paint(); draw();
      const steps = setupScript(cand, t, null, { n: S.trades - 1, entry: v.entry, rr: v.rr }), tail = 'Now we watch it. If it moves I will come back; meanwhile, here is the next one.'; for (let i = 0; i < steps.length; i++) { const s = steps[i]; if (gone() || S.skip) break; pointAt(s.point); draw(); await speak(s.say, s.ch, i === 0 ? [cand.sym, opener(t.direction)] : null); await hold(350); }
      pointAt(null); S.skip = false;
      S.phase = 'watching'; paint(); await speak(tail, 'WATCHING', 'Now we watch.');
      await hold(12000);
    }
    async function loop() {
      const run = ++S.run; let since = 0;
      await watchTick(); await drainAlerts();
      await speak('Auto Live desk is on. I scan the whole Academy for setups, show how each one is read, and keep an honest scoreboard.', 'WELCOME', 'Desk is live.');
      while (S.on && run === S.run) {
        try {
          await watchTick(); await drainAlerts();
          if (since % 3 === 0) await marketSegment();
          since++;
          S.phase = 'scanning'; paint();
          const q = await candidates(); S.queue = q; paint();
          const open = S.calls.filter((c) => c.status === 'open').length;
          if (open >= 6) { S.cap = 'Six calls are open, so the desk waits for some to finish before opening more.'; S.ch = 'WAITING'; paint(); await hold(30000); continue; }
          if (!q.length) { S.cap = 'Nothing new worth a look right now. Scanning again shortly.'; S.ch = 'SCANNING'; paint(); await hold(25000); continue; }
          await tradeSegment(q[0]);
          if (S.fails >= 4) { S.note = 'The data feed is not answering. Retrying.'; paint(); await hold(30000); S.fails = 0; S.note = ''; }
        } catch (_) { S.fails++; await wait(5000); }
      }
    }
    function start() {
      if (S.on || !S.owner) return; S.on = true; S.paused = false; S.skip = false; S.voiceOk = null; layoutOverlay(); paint(); void loop();
      S.timer = setInterval(() => { if (document.hidden) return; void watchTick(); }, 12000);
      S.qtimer = setInterval(async () => { const f = S.focus; if (!S.on || !f || f.status !== 'open' || document.hidden) return; const p = await priceOf(f.sym); if (p > 0) { f.last = p; paintBanner(); } }, 4000);
    }
    function stop(denied) {
      S.on = false; S.run++; pointAt(null); clearInterval(S.timer); clearInterval(S.qtimer); stopMine(); try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (_) { /* fine */ }
      if (denied) { S.owner = false; if (btn) btn.style.display = 'none'; }
      layoutOverlay(); if (btn) btn.classList.remove('on'); draw(); save();
    }
    /* the voice is cut off when the tab is hidden in some browsers: say so rather than stall */
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.on) { void watchTick(); paint(); } });

    /* ---- the owner's button: built only after the server says this is the owner ---- */
    let btn = null;
    function build() {
      if (btn) return; const toolbar = document.querySelector('.toolbar') || document.body;
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'auto-live-btn'; btn.textContent = 'AUTO LIVE';
      btn.title = 'Owner only: the desk finds setups across the whole Academy, talks through them, points at the levels and keeps an honest scoreboard. Built to screen-share.';
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
