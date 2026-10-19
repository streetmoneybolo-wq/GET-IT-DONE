'use strict';
/* Live pattern examples: which other stocks are forming the same chart pattern, on the same interval, right now.
 *
 * The scanner's universe (the names the Academy already tracks: the scanner rows plus the index ETFs) is run through the
 * pattern detector (academy-patterns.js) on the requested interval, one scan per interval kept for a short while so every
 * pattern a member clicks reuses it. Examples are ranked for teaching value: a high-confidence pattern that is still
 * forming or just confirmed, recent, and in the same direction as the one on the member's chart, beats an old or failed one.
 * Each example carries the bars that frame the formation and the pattern's points and lines, so a small chart can draw it,
 * and the symbol so the Academy can open it in one click.
 *
 * createPatternLive({ candles(symbol, tf) -> { bars }, scanner() -> { rows: [{ symbol, name, price, changePct }] },
 *                     patterns: { detect(bars) }, logger, now, concurrency, universeMax, ttlMs, perSymbolMs })
 *   .examples({ type, tf, exclude, dir, limit }) -> { ok, type, tf, examples: [...], scanned, universe, asOf, cached }
 * rankExamples(found, { type, dir, last }) is pure, for tests. */

const FAMILY = [[/head_and_shoulders/, 'head_and_shoulders'], [/double_/, 'double'], [/triple_/, 'triple'], [/triangle/, 'triangle'], [/wedge/, 'wedge'], [/flag|pennant/, 'flag'], [/rectangle|range/, 'rectangle']];
const familyOf = (type) => { for (const [re, f] of FAMILY) if (re.test(String(type || ''))) return f; return String(type || ''); };
const TTL = { '1m': 60_000, '3m': 90_000, '5m': 120_000, '15m': 180_000, '1h': 300_000, '1D': 900_000, '1W': 1_800_000 };

/* "Forming right now" is strict: a chart pattern must still be forming (its last pivot within the last 4 bars) or have broken out
 * within the last 3 bars; a candle pattern must be the last bar or the one before; a level must have been touched within the last
 * 3 bars; a gap must be open and no more than 6 bars old. Everything older, expired or failed is not an example of "now". */
const LIVE_BARS = { chart: 3, candle: 1, level: 3, gap: 6 };
function isLive(kind, p, last) {
  if (!p || !Number.isFinite(last)) return false;
  if (kind === 'chart') { if (p.status === 'failed' || p.status === 'expired') return false; if (p.status === 'forming') return last - Number(p.endIdx) <= 4; if (p.status === 'confirmed') return Number(p.breakIdx) >= 0 && last - Number(p.breakIdx) <= LIVE_BARS.chart; return false; }
  if (kind === 'candle') return last - Number(p.i) <= LIVE_BARS.candle;
  if (kind === 'level') return last - Number(p.lastIdx) <= LIVE_BARS.level;
  if (kind === 'gap') return !p.filled && last - Number(p.i) <= LIVE_BARS.gap;
  return false;
}

/* quality for teaching: the best example is a confident formation that is live right now, fresh, and leaning the same way */
function scoreExample(p, { type, dir, last, kind = 'chart' }) {
  if (!p) return -Infinity;
  if (kind === 'candle') { if (p.name !== type || !isLive('candle', p, last)) return -Infinity; return Number(p.strength || 0) * 100 + (Number(p.i) === last ? 12 : 0) + (dir && p.dir === dir ? 6 : 0); }
  if (kind === 'level') { if (p.kind !== type || !isLive('level', p, last)) return -Infinity; return Math.min(60, Number(p.touches || 0) * 12) + (last - Number(p.lastIdx) === 0 ? 15 : 0) + 20; }
  if (kind === 'gap') { const want = type === 'gap_up' ? 'bull' : type === 'gap_down' ? 'bear' : type; if (p.dir !== want || !isLive('gap', p, last)) return -Infinity; return 60 - (last - Number(p.i)) * 6 + Math.min(30, Math.abs(Number(p.to) - Number(p.from)) / Math.max(1e-9, Number(p.from)) * 1000); }
  if (!isLive('chart', p, last)) return -Infinity;
  const sameType = p.type === type, sameFamily = familyOf(p.type) === familyOf(type);
  if (!sameType && !sameFamily) return -Infinity;
  let s = Number(p.confidence || 0) * 100;
  s += sameType ? 20 : 0;
  s += p.status === 'forming' ? 16 : 12;
  const age = Math.max(0, last - (p.breakIdx >= 0 ? p.breakIdx : p.endIdx));
  s -= age * 3;
  if (dir && p.dir === dir) s += 6;
  const span = Number.isFinite(p.startIdx) && Number.isFinite(p.endIdx) ? p.endIdx - p.startIdx : 0;
  if (span >= 8) s += 4; if (span > 150) s -= 10;
  return s;
}
const LIST = { chart: 'charts', candle: 'candles', level: 'levels', gap: 'gaps' };

function rankExamples(found, { type, dir = '', last = null, kind = 'chart' } = {}) {
  const out = [];
  const list = LIST[kind] || 'charts';
  for (const f of found || []) {
    const items = f && f.result && Array.isArray(f.result[list]) ? f.result[list] : [];
    const lastIdx = Number.isFinite(f && f.last) ? f.last : last;
    let best = null, bestScore = -Infinity;
    for (const p of items) { const sc = scoreExample(p, { type, dir, last: lastIdx, kind }); if (sc > bestScore) { bestScore = sc; best = p; } }
    if (best && bestScore > -Infinity) out.push({ symbol: f.symbol, score: Math.round(bestScore * 10) / 10, pattern: best, exact: kind !== 'chart' || best.type === type });
  }
  out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score);
  return out;
}

function frame(bars, p, maxBars = 90, kind = 'chart') {
  const n = bars.length; if (!n) return { bars: [], offset: 0 };
  const anchor = kind === 'chart' ? (Number.isFinite(p.startIdx) ? p.startIdx - 6 : n - maxBars) : kind === 'level' ? (Number.isFinite(p.firstIdx) ? p.firstIdx - 4 : n - 60) : n - 40;
  const start = Math.max(0, Math.min(anchor, n - 12));
  const from = Math.max(start, n - maxBars);
  return { bars: bars.slice(from).map((b) => [Number(b.t), Number(b.o), Number(b.h), Number(b.l), Number(b.c)]), offset: from };
}

function createPatternLive({ candles = null, scanner = null, patterns = null, logger = () => {}, now = Date.now, concurrency = 4, universeMax = 60, ttlMs = null, perSymbolMs = 3_500, maxWaitMs = 6_000, extra = ['SPY', 'QQQ', 'IWM'] } = {}) {
  const scans = new Map(); // tf -> { at, inflight, found: [{ symbol, name, price, changePct, bars, last, result }], universe }
  const within = (p, ms) => new Promise((resolve) => { let done = false; const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms); Promise.resolve(p).then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } }, () => { if (!done) { done = true; clearTimeout(t); resolve(null); } }); });

  async function universe() {
    const rows = []; const seen = new Set();
    try { const sc = scanner ? await within(scanner(), 4_000) : null; for (const r of (sc && Array.isArray(sc.rows) ? sc.rows : [])) { const s = String(r.symbol || '').toUpperCase(); if (!s || seen.has(s)) continue; seen.add(s); rows.push({ symbol: s, name: String(r.name || ''), price: Number(r.price) || null, changePct: Number.isFinite(Number(r.changePct)) ? Number(r.changePct) : null }); } } catch (error) { logger('warn', 'pattern_live_universe_failed', { error: String(error && error.message || error) }); }
    for (const s of extra) if (!seen.has(s)) { seen.add(s); rows.push({ symbol: s, name: '', price: null, changePct: null }); }
    return rows.slice(0, universeMax);
  }

  async function scan(tf, progress) {
    const u = await universe();
    const found = progress.found; progress.universe = u.length;
    let i = 0;
    const worker = async () => {
      while (i < u.length) {
        const row = u[i++];
        let payload = null;
        try { payload = candles ? await within(candles(row.symbol, tf), perSymbolMs) : null; } catch (_) { payload = null; }
        const bars = payload && Array.isArray(payload.bars) ? payload.bars : [];
        if (bars.length < 30 || !patterns || typeof patterns.detect !== 'function') continue;
        let result = null; try { result = patterns.detect(bars); } catch (_) { result = null; }
        if (!result || !result.ok) continue;
        const last = bars[bars.length - 1], prev = bars.length > 1 ? bars[bars.length - 2] : null;
        found.push({ symbol: row.symbol, name: row.name, price: Number(last.c) || row.price, changePct: row.changePct != null ? row.changePct : (prev && prev.c > 0 ? (last.c - prev.c) / prev.c * 100 : null), bars, last: bars.length - 1, result });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, u.length)) }, worker));
    progress.done = true;
    return { at: now(), found, universe: u.length };
  }

  /* A scan can take a while on a cold cache (every symbol's candles), so a request waits at most maxWaitMs and gets what has been
     scanned so far, flagged partial; the scan keeps running and the next request (the panel refreshes) gets the rest. */
  async function scanned(tf) {
    const ttl = ttlMs || TTL[tf] || 90_000;
    const e = scans.get(tf);
    if (e && e.done && now() - e.at < ttl) return { at: e.at, found: e.found, universe: e.universe, cached: true, partial: false };
    let entry = e && e.inflight ? e : null;
    if (!entry) {
      const progress = { found: [], universe: 0, done: false };
      const inflight = scan(tf, progress).then((r) => { scans.set(tf, { at: r.at, found: r.found, universe: r.universe, done: true, inflight: null }); return r; })
        .catch((error) => { logger('warn', 'pattern_live_scan_failed', { tf, error: String(error && error.message || error) }); const r = { at: now(), found: progress.found, universe: progress.universe, done: true, inflight: null }; scans.set(tf, r); return r; });
      entry = { at: now(), progress, inflight, done: false, found: progress.found, universe: 0 };
      scans.set(tf, entry);
    }
    const finished = await Promise.race([entry.inflight.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), maxWaitMs))]);
    const pr = entry.progress;
    return { at: entry.at, found: pr.found.slice(), universe: pr.universe, cached: false, partial: !finished && !pr.done };
  }

  function describe(kind, p) {
    if (kind === 'candle') return { kind, type: p.name, name: p.label || p.name, dir: p.dir, status: 'forming', confidence: Number(p.strength || 0), i: p.i, bars: p.bars || [p.i, p.i], note: p.note || '', points: [], lines: [] };
    if (kind === 'level') return { kind, type: p.kind, name: (p.kind === 'support' ? 'Support ' : 'Resistance ') + Number(p.p).toFixed(Number(p.p) >= 1 ? 2 : 4), dir: p.kind === 'support' ? 'bull' : 'bear', status: 'holding', confidence: Math.min(1, Number(p.touches || 0) / 5), level: p.p, touches: p.touches, firstIdx: p.firstIdx, lastIdx: p.lastIdx, note: p.touches + ' touches', points: [], lines: [] };
    if (kind === 'gap') return { kind, type: p.dir === 'bull' ? 'gap_up' : 'gap_down', name: p.dir === 'bull' ? 'Gap up (open)' : 'Gap down (open)', dir: p.dir, status: 'open', confidence: 1, i: p.i, from: p.from, to: p.to, note: '', points: [], lines: [] };
    return { kind: 'chart', type: p.type, name: p.name, dir: p.dir, status: p.status, confidence: p.confidence, startIdx: p.startIdx, endIdx: p.endIdx, breakIdx: p.breakIdx, points: p.points || [], lines: p.lines || [], neckline: p.neckline, level: p.level, target: p.target, invalidation: p.invalidation, note: p.note || '' };
  }
  async function examples({ kind = 'chart', type, tf = '5m', exclude = '', dir = '', limit = 6 } = {}) {
    const want = String(type || '').toLowerCase(); if (!want) return { ok: false, error: 'invalid_pattern' };
    const k = LIST[kind] ? kind : 'chart';
    const s = await scanned(tf);
    const ranked = rankExamples((s.found || []).filter((f) => f.symbol !== String(exclude || '').toUpperCase()), { type: want, dir, kind: k });
    const picked = ranked.slice(0, Math.max(1, Math.min(8, limit))).map((r) => {
      const f = (s.found || []).find((x) => x.symbol === r.symbol), p = r.pattern, fr = frame(f.bars, p, 90, k);
      return { symbol: r.symbol, name: f.name, price: f.price, changePct: f.changePct == null ? null : Math.round(f.changePct * 100) / 100, score: r.score, exact: r.exact, pattern: describe(k, p), bars: fr.bars, offset: fr.offset, last: f.last };
    });
    return { ok: true, kind: k, type: want, family: k === 'chart' ? familyOf(want) : want, tf, examples: picked, scanned: (s.found || []).length, universe: s.universe || 0, asOf: s.at, cached: !!s.cached, partial: !!s.partial, ttlMs: ttlMs || TTL[tf] || 90_000 };
  }

  return { examples, scanned, familyOf, _scans: scans };
}

module.exports = { createPatternLive, rankExamples, scoreExample, isLive, familyOf, frame, TTL, LIVE_BARS };
