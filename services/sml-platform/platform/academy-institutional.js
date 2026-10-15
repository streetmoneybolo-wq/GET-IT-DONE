'use strict';

/* Institutional flow for one symbol, from two sources no US retail platform puts together:
 *   - moomoo's capital distribution: today's net inflow split by order size (super-large / large / medium / small), read
 *     through the site bridge. Super-large + large is the institutional bucket, medium + small the retail bucket.
 *   - the Massive tape: intermarket sweeps and 10,000-share / $1M block prints the stream already classifies at the
 *     bid or the ask (academy-massive-stream.js).
 * Bias is -100..+100. Every number is an estimate from public prints and a broker's own size buckets; nothing here sees a
 * fund's order book. Educational context, not a trade signal. */

const num = (v, d = null) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, v));

/* moomoo column names drift between OpenD versions; read every spelling seen so far */
function pick(row, keys) { for (const k of keys) { const v = num(row && row[k]); if (v != null) return v; } return null; }
const IN = { super: ['capital_in_super', 'in_super', 'super_in'], big: ['capital_in_big', 'capital_in_large', 'in_big', 'big_in'], mid: ['capital_in_mid', 'in_mid', 'mid_in'], small: ['capital_in_small', 'in_small', 'small_in'] };
const OUT = { super: ['capital_out_super', 'out_super', 'super_out'], big: ['capital_out_big', 'capital_out_large', 'out_big', 'big_out'], mid: ['capital_out_mid', 'out_mid', 'mid_out'], small: ['capital_out_small', 'out_small', 'small_out'] };

function readDistribution(dist) {
  if (!dist || typeof dist !== 'object') return null;
  const b = {};
  for (const k of ['super', 'big', 'mid', 'small']) {
    const i = pick(dist, IN[k]), o = pick(dist, OUT[k]);
    if (i == null && o == null) continue;
    b[k] = { in: i || 0, out: o || 0, net: (i || 0) - (o || 0) };
  }
  if (!Object.keys(b).length) return null;
  const inst = (b.super ? b.super.net : 0) + (b.big ? b.big.net : 0), retail = (b.mid ? b.mid.net : 0) + (b.small ? b.small.net : 0);
  const gross = Object.values(b).reduce((s, x) => s + Math.abs(x.in) + Math.abs(x.out), 0);
  return { buckets: b, institutionalNet: inst, retailNet: retail, gross, institutionalShare: gross > 0 ? (Math.abs(b.super ? b.super.in + b.super.out : 0) + Math.abs(b.big ? b.big.in + b.big.out : 0)) / gross : null };
}

function readTape(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const sb = num(stats.sweepBuy, 0), ss = num(stats.sweepSell, 0), bb = num(stats.blockBuy, 0), bs = num(stats.blockSell, 0);
  const vol = num(stats.vol, 0);
  if (!(sb + ss + bb + bs > 0)) return { sweeps: { buy: sb, sell: ss, n: num(stats.sweepN, 0) }, blocks: { buy: bb, sell: bs, n: num(stats.blockN, 0) }, shareOfVolume: 0, bias: 0, available: false };
  const sweepBias = sb + ss > 0 ? (sb - ss) / (sb + ss) : 0, blockBias = bb + bs > 0 ? (bb - bs) / (bb + bs) : 0;
  const wS = sb + ss, wB = bb + bs;
  return {
    available: true,
    sweeps: { buy: sb, sell: ss, n: num(stats.sweepN, 0), recent: Array.isArray(stats.sweeps) ? stats.sweeps.slice(0, 8) : [] },
    blocks: { buy: bb, sell: bs, n: num(stats.blockN, 0), recent: Array.isArray(stats.blocks) ? stats.blocks.slice(0, 8) : [] },
    shareOfVolume: vol > 0 ? (wS + wB) / vol : null,
    bias: Math.round(100 * ((sweepBias * wS + blockBias * wB) / (wS + wB)))
  };
}

function labelOf(bias) {
  if (bias >= 40) return 'institutions buying'; if (bias >= 15) return 'leaning accumulation';
  if (bias <= -40) return 'institutions selling'; if (bias <= -15) return 'leaning distribution';
  return 'balanced';
}

function analyzeInstitutional({ capital = null, stats = null, now = Date.now() } = {}) {
  const dist = readDistribution(capital && capital.distribution);
  const tape = readTape(stats);
  const parts = []; let w = 0, s = 0;
  if (dist && dist.gross > 0) {
    const b = clamp(100 * dist.institutionalNet / Math.max(dist.gross / 2, 1));
    parts.push({ key: 'moomoo', label: 'Order-size flow (moomoo)', bias: Math.round(b), detail: `institutional net ${fmt(dist.institutionalNet)}, retail net ${fmt(dist.retailNet)}` });
    s += 0.6 * b; w += 0.6;
  }
  if (tape && tape.available) {
    parts.push({ key: 'tape', label: 'Sweeps and blocks (tape)', bias: tape.bias, detail: `${tape.sweeps.n} sweeps, ${tape.blocks.n} blocks, ${tape.shareOfVolume != null ? Math.round(tape.shareOfVolume * 100) + '% of session volume' : 'share unknown'}` });
    s += 0.4 * tape.bias; w += 0.4;
  }
  if (!w) return { available: false, reason: 'no_flow_data', asOf: now, capital: dist, tape };
  const bias = Math.round(s / w);
  const divergence = dist && tape && tape.available && Math.sign(dist.institutionalNet) !== 0 && Math.sign(tape.bias) !== 0 && Math.sign(dist.institutionalNet) !== Math.sign(tape.bias);
  return {
    available: true, asOf: now, bias, label: labelOf(bias), coverage: Math.round(w * 100), components: parts,
    retailVsInstitutional: dist ? (Math.sign(dist.institutionalNet) !== Math.sign(dist.retailNet) && dist.institutionalNet !== 0 ? (dist.institutionalNet > 0 ? 'institutions buying what retail sells' : 'institutions selling into retail buying') : 'same direction') : null,
    capital: dist, tape,
    notes: [divergence ? 'The broker size buckets and the public tape disagree on direction; treat as unsettled.' : null].filter(Boolean),
    note: 'Estimated from public prints and broker size buckets; no fund order is visible to anyone. Educational context, not a trade signal.'
  };
}
function fmt(v) { const a = Math.abs(v); const s = a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : String(Math.round(a)); return (v < 0 ? '-' : '+') + '$' + s; }

function createInstitutionalService({ capital, tape, now = Date.now, ttlMs = 30_000, logger = () => {} } = {}) {
  const cache = new Map(), inflight = new Map();
  const safe = async (name, fn) => { try { return await fn(); } catch (error) { logger('warn', 'institutional_input_failed', { input: name, error }); return null; } };
  async function compute(symbol) {
    const [cap, st] = await Promise.all([safe('capital', () => (capital ? capital(symbol) : null)), safe('tape', () => (tape ? tape(symbol) : null))]);
    return { ok: true, symbol, ...analyzeInstitutional({ capital: cap, stats: st, now: now() }) };
  }
  async function get(symbol) {
    const key = String(symbol || '').toUpperCase();
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = compute(key).then((v) => { cache.set(key, { until: now() + ttlMs, value: v }); if (cache.size > 300) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  return { get };
}

module.exports = { analyzeInstitutional, createInstitutionalService, readDistribution, readTape, labelOf };
