'use strict';

/* MEM LAB: the engine that keeps testing MEM ALGO and proposes better versions of it, and refuses to believe a result it has not earned.
 *
 * What it does, in order:
 *   1. Takes a dataset of candles (many stocks, one timeframe) and a "config": MEM ALGO's parameters plus an ensemble of extra models (academy-mem-signals.js), each with
 *      a weight. The ensemble can only CONFIRM or VETO a MEM crossover signal (it never invents entries), so every trade is still a MEM ALGO trade.
 *   2. Searches a few dozen variations (parameter nudges and ensemble weights, from a seeded generator, so a run can be repeated exactly) and scores each ONLY on the first
 *      60% of every stock's history.
 *   3. Takes the best few and re-scores them on the next 20% (validation), and picks the winner there, which cancels most of the luck in step 2.
 *   4. Looks at the final 20% (test) for the first and only time, for the winner and for the current champion side by side, and applies a strict gate:
 *      enough trades, a positive average, an improvement whose 95% confidence interval stays above zero, no worse a drawdown, and a majority of stocks improving.
 *   A run on pure noise must fail the gate, and the tests prove it does. The lab only PROPOSES: promotion (academy-mem-lab-service.js) also needs the same winner to pass on a
 *   later, fresh run, and is switched off unless the owner turns it on.
 * Costs are charged by MEM ALGO's own backtest, entries are the next candle's open, and there is no look-ahead anywhere. Educational: a backtest describes the past. */

const algo = require('./academy-mem-algo');
const signals = require('./academy-mem-signals');

const fin = Number.isFinite;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function rngOf(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- running one config on one stock ---------- */
function cleanBars(bars) { return (bars || []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(fin) && b.h >= b.l); }

function ensembleScore(votes, weights) {
  const names = Object.keys(weights || {}).filter((k) => votes[k] && weights[k] > 0);
  const n = names.length ? votes[names[0]].length : 0, out = new Array(n).fill(0);
  let tot = 0; for (const k of names) tot += weights[k];
  if (!(tot > 0)) return out;
  for (let i = 0; i < n; i++) { let s = 0; for (const k of names) s += weights[k] * votes[k][i]; out[i] = s / tot; }
  return out;
}

function runTrades(item, cfg) {
  const params = algo.resolveParams(cfg.mode, cfg.overrides || {}, cfg.tf || '');
  params.minScore = null; // the lab measures the crossover plus the ensemble; the page's older confluence filter is left out so the comparison is clean
  const ind = algo.computeSignals(item.bars, params);
  let sig = ind.sig;
  const ens = cfg.ensemble;
  if (ens && ens.weights && Object.keys(ens.weights).length) {
    if (!item.votes) item.votes = signals.allVotes(item.bars);
    const score = ensembleScore(item.votes, ens.weights), th = ens.threshold || 0;
    sig = sig.map((d, i) => (d && d * score[i] >= th ? d : 0));
  }
  return algo.backtest(item.bars, params, Object.assign({}, ind, { sig })).trades;
}

/* the R multiples of every trade a config takes inside one slice of each stock's history, by stock */
function evaluate(cfg, dataset, from, to) {
  const perSymbol = [];
  for (const item of dataset) {
    const n = item.bars.length, a = Math.floor(n * from), b = Math.floor(n * to);
    const rs = runTrades(item, cfg).filter((t) => t.entryIdx >= a && t.entryIdx < b).map((t) => t.R);
    perSymbol.push({ symbol: item.symbol, rs });
  }
  return perSymbol;
}

/* ---------- statistics ---------- */
function metrics(perSymbol) {
  const all = []; let ddSum = 0, ddCount = 0, ddWorst = 0, positive = 0, active = 0;
  for (const s of perSymbol) {
    if (!s.rs.length) continue;
    active++; all.push(...s.rs);
    let eq = 0, peak = 0, dd = 0; for (const r of s.rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
    ddSum += dd; ddCount++; ddWorst = Math.max(ddWorst, dd);
    if (s.rs.reduce((x, y) => x + y, 0) > 0) positive++;
  }
  const n = all.length;
  if (!n) return { trades: 0, symbols: active, mean: null, sd: null, se: null, winRate: null, profitFactor: null, drawdownR: null, worstDrawdownR: null, positiveSymbols: 0 };
  const mean = all.reduce((x, y) => x + y, 0) / n;
  const sd = n > 1 ? Math.sqrt(all.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1)) : 0;
  const win = all.filter((r) => r > 0).reduce((x, y) => x + y, 0), loss = -all.filter((r) => r <= 0).reduce((x, y) => x + y, 0);
  return { trades: n, symbols: active, mean, sd, se: n > 1 ? sd / Math.sqrt(n) : null, winRate: all.filter((r) => r > 0).length / n, profitFactor: loss > 0 ? win / loss : (win > 0 ? Infinity : null), drawdownR: ddCount ? ddSum / ddCount : 0, worstDrawdownR: ddWorst, positiveSymbols: positive };
}
const flat = (perSymbol) => perSymbol.flatMap((s) => s.rs);

/* difference of mean R between two sets of trades, with a bootstrap confidence interval (seeded) */
function bootstrapDiff(a, b, { iters = 1500, level = 0.95, seed = 7 } = {}) {
  if (!a.length || !b.length) return { diff: null, lo: null, hi: null };
  const rnd = rngOf(seed), mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const diff = mean(a) - mean(b), draws = [];
  for (let it = 0; it < iters; it++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[Math.floor(rnd() * a.length)];
    for (let i = 0; i < b.length; i++) sb += b[Math.floor(rnd() * b.length)];
    draws.push(sa / a.length - sb / b.length);
  }
  draws.sort((x, y) => x - y);
  return { diff, lo: draws[Math.floor(iters * (1 - level))], hi: draws[Math.min(iters - 1, Math.floor(iters * level))] };
}

/* score used to pick a config on one slice: the average R minus one standard error (a lower bound, so thin luck is not rewarded), and nothing without enough trades */
const objective = (m, minTrades) => (m.trades >= minTrades && m.se != null ? m.mean - m.se : -Infinity);

/* ---------- the search space ---------- */
const BOUNDS = { fast: [3, 60], slow: [8, 120], trend: [20, 300], minSep: [0, 1.5], confirm: [1, 4], stopAtr: [0.8, 4], targetAtr: [1, 8], trail: [1.5, 8] };
function perturb(base, rnd, mode) {
  const o = {}, pick = (k) => { const b = base[k]; if (!fin(b)) return undefined; const [lo, hi] = BOUNDS[k]; const span = hi - lo; return clamp(b + (rnd() - 0.5) * span * 0.35, lo, hi); };
  for (const k of ['fast', 'slow', 'trend']) { const v = pick(k); if (v !== undefined && rnd() < 0.6) o[k] = Math.round(v); }
  for (const k of ['minSep', 'stopAtr', 'targetAtr', 'trail']) { const v = pick(k); if (v !== undefined && rnd() < 0.6) o[k] = Math.round(v * 100) / 100; }
  if (rnd() < 0.4) o.confirm = Math.round(clamp(base.confirm + (rnd() < 0.5 ? -1 : 1), 1, 4));
  return o;
}
function randomEnsemble(rnd) {
  const names = signals.NAMES.slice(); const k = 2 + Math.floor(rnd() * 3), weights = {};
  for (let i = 0; i < k; i++) { const j = Math.floor(rnd() * names.length); weights[names.splice(j, 1)[0]] = Math.round((0.3 + rnd() * 0.7) * 100) / 100; }
  return { weights, threshold: [0, 0.1, 0.2, 0.3, 0.4][Math.floor(rnd() * 5)] };
}

/* ---------- the strict gate ---------- */
function gate(challenger, champion, a, b, { minTrades = 150, level = 0.95, drawdownRatio = 1.3, seed = 11 } = {}) {
  const reasons = [];
  if (challenger.trades < minTrades) reasons.push('only ' + challenger.trades + ' test trades (needs ' + minTrades + ')');
  if (!(challenger.mean > 0)) reasons.push('the average test trade is not positive');
  const d = bootstrapDiff(a, b, { level, seed });
  if (d.lo == null || !(d.lo > 0)) reasons.push('the improvement over the champion is not statistically clear (' + Math.round(level * 100) + '% interval ' + (d.lo == null ? 'n/a' : d.lo.toFixed(3)) + ' to ' + (d.hi == null ? 'n/a' : d.hi.toFixed(3)) + ' R per trade)');
  if (champion.drawdownR != null && challenger.drawdownR != null && challenger.drawdownR > champion.drawdownR * drawdownRatio + 0.5) reasons.push('drawdown is worse than the champion');
  if (challenger.symbols && challenger.positiveSymbols / Math.max(1, challenger.symbols) < 0.5) reasons.push('fewer than half the stocks made money');
  return { pass: reasons.length === 0, reasons, diff: d };
}

/* ---------- the search ---------- */
function optimize({ dataset, mode = 'swing', tf = '1D', champion = null, budget = 48, seed = 1, minTrainTrades = 120, minTestTrades = 150, level = 0.95 } = {}) {
  const data = (dataset || []).map((d) => ({ symbol: d.symbol, bars: cleanBars(d.bars) })).filter((d) => d.bars.length >= 250);
  if (data.length < 5) return { ok: false, reason: 'need at least 5 stocks with 250+ candles', symbols: data.length };
  const rnd = rngOf(seed);
  const base = algo.resolveParams(mode, {}, tf);
  const champ = { mode, tf, overrides: champion && champion.overrides ? champion.overrides : {}, ensemble: champion && champion.ensemble ? champion.ensemble : null };

  // 1. candidates, judged on the first 60% only
  const cands = [{ cfg: champ, note: 'champion' }];
  for (let i = 0; i < budget; i++) {
    const useEns = rnd() < 0.85;
    cands.push({ cfg: { mode, tf, overrides: Object.assign({}, champ.overrides, perturb(base, rnd, mode)), ensemble: useEns ? randomEnsemble(rnd) : champ.ensemble }, note: 'candidate ' + (i + 1) });
  }
  for (const c of cands) { c.train = metrics(evaluate(c.cfg, data, 0, 0.6)); c.trainObj = objective(c.train, minTrainTrades); }
  // 2. the best few, re-judged on the next 20%
  const top = cands.filter((c) => c.note !== 'champion').sort((x, y) => y.trainObj - x.trainObj).slice(0, 5).filter((c) => c.trainObj > -Infinity);
  for (const c of top) { c.valid = metrics(evaluate(c.cfg, data, 0.6, 0.8)); c.validObj = objective(c.valid, Math.round(minTrainTrades / 2)); }
  const winner = top.slice().sort((x, y) => y.validObj - x.validObj)[0] || null;
  const champTrain = cands[0].train, champValid = metrics(evaluate(champ, data, 0.6, 0.8));
  const out = { ok: true, mode, tf, seed, symbols: data.length, tried: cands.length - 1, champion: { cfg: champ, train: champTrain, valid: champValid }, shortlist: top.map((c) => ({ cfg: c.cfg, trainObj: c.trainObj, validObj: c.validObj })), winner: null, gate: null };
  if (!winner || winner.validObj === -Infinity) { out.gate = { pass: false, reasons: ['no candidate cleared the training and validation bars'] }; return out; }
  // 3. the untouched final 20%, once
  const chTest = evaluate(winner.cfg, data, 0.8, 1), cpTest = evaluate(champ, data, 0.8, 1);
  const chM = metrics(chTest), cpM = metrics(cpTest);
  out.winner = { cfg: winner.cfg, train: winner.train, valid: winner.valid, test: chM };
  out.champion.test = cpM;
  out.gate = gate(chM, cpM, flat(chTest), flat(cpTest), { minTrades: minTestTrades, level });
  // which parts earn their place: the test average with each ensemble component taken out
  if (winner.cfg.ensemble && winner.cfg.ensemble.weights) {
    out.ablation = Object.keys(winner.cfg.ensemble.weights).map((k) => {
      const w = Object.assign({}, winner.cfg.ensemble.weights); delete w[k];
      const m = metrics(evaluate(Object.assign({}, winner.cfg, { ensemble: { weights: w, threshold: winner.cfg.ensemble.threshold } }), data, 0.8, 1));
      return { component: k, label: signals.COMPONENTS[k] ? signals.COMPONENTS[k].label : k, withoutMean: m.mean, withMean: chM.mean, adds: m.mean == null || chM.mean == null ? null : chM.mean - m.mean };
    });
  }
  return out;
}

module.exports = { optimize, evaluate, metrics, bootstrapDiff, gate, runTrades, ensembleScore, objective, rngOf, cleanBars, BOUNDS };
