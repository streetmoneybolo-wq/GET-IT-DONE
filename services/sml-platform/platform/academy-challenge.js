'use strict';

/* The $1,000 -> $100,000 challenge: MEM ALGO runs a SIMULATED account on real prices and real time, as if it were one
 * person's portfolio (Grandmaster-obi's), with $100 added every Monday like a normal pay-day contribution.
 *
 * It only takes the trades the full confluence grades A (every data source on the platform agrees), sizes each one so a
 * stop costs one percent of the account, never borrows, never holds more than five names or a quarter of the account in
 * one, stays out of names reporting earnings within five days, stops buying when the market read turns bearish, and
 * hedges an exposed book with an inverse index ETF when the market read turns clearly bearish. Fills are at the next
 * price after the signal with slippage and a commission, exactly like the backtest.
 *
 * Nothing here is real money and nothing is advice. The engine is pure (state in, state out) so every rule is tested;
 * the service wraps it with the data services, a durable store and a five-minute tick in market hours. */

const { marketState, etParts } = require('./market-clock');

/* Aggressive track: $250 a week, 18-month target. 3% of the account to the stop on a grade-A swing (1.5% day), up to eight
   names, 35% in one, A or strong-B signals (70+). The target is a target, not a promise: the panel shows the pace it needs
   against the pace it is actually running. */
const RULES = Object.freeze({
  start: 1000, goal: 100000, weeklyDeposit: 250, depositWeekday: 1, horizonMonths: 18,
  riskPerTrade: { swing: 0.03, day: 0.015 }, maxPositions: 8, maxPositionPct: 0.35, minNotional: 25, minScore: 70,
  costBps: 3, slippageBps: 5, earningsBlackoutDays: 5,
  noNewLongsBelowBias: -30, hedge: { etf: 'SH', triggerBias: -40, clearBias: 0, sizePct: 0.5, minExposurePct: 0.4 },
  dayFlatByMinutesET: 945, maxEquityPoints: 4000
});
const DAY = 86_400_000;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

function freshState(now = Date.now(), rules = RULES) {
  return { version: 1, startedAt: now, cash: rules.start, deposits: [{ t: now, amount: rules.start, kind: 'start' }], positions: [], trades: [], equity: [{ t: now, value: rules.start, cash: rules.start }], log: [], lastTick: null, lastDepositWeek: weekKey(now), nextId: 1, filled: {} };
}
function weekKey(ms) { const e = etParts(ms); const d = new Date(Date.UTC(e.y, e.m - 1, e.d)); const day = d.getUTCDay(); const monday = new Date(d.getTime() - ((day + 6) % 7) * DAY); return monday.toISOString().slice(0, 10); }
function minutesET(ms) { const e = etParts(ms); return e.hh * 60 + e.mm; }
function etDate(ms) { const e = etParts(ms); return `${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`; }

function note(state, now, text, extra = {}) { state.log.push({ t: now, text, ...extra }); if (state.log.length > 400) state.log.splice(0, state.log.length - 400); }

/* $100 on the first trading day of each new week (Monday, or the next open day when Monday is a holiday) */
function applyDeposit(state, now, rules = RULES, open = true) {
  const wk = weekKey(now);
  if (wk === state.lastDepositWeek || !open) return false;
  state.cash = r2(state.cash + rules.weeklyDeposit); state.lastDepositWeek = wk;
  state.deposits.push({ t: now, amount: rules.weeklyDeposit, kind: 'weekly' });
  note(state, now, `Weekly deposit of $${rules.weeklyDeposit} added, like a pay-day contribution.`, { kind: 'deposit' });
  return true;
}

function fillPrice(price, side, rules = RULES) { return r4(price * (1 + (side === 'buy' ? 1 : -1) * rules.slippageBps / 1e4)); }
function commission(notional, rules = RULES) { return r2(notional * rules.costBps / 1e4); }

function exposure(state, prices) { return state.positions.filter((p) => !p.hedge).reduce((s, p) => s + p.qty * num(prices[p.symbol], p.entry), 0); }
function equityOf(state, prices) { return r2(state.cash + state.positions.reduce((s, p) => s + p.qty * num(prices[p.symbol], p.entry), 0)); }

function closePosition(state, p, price, now, reason, rules = RULES) {
  const px = fillPrice(price, 'sell', rules), gross = px * p.qty, fee = commission(gross, rules);
  state.cash = r2(state.cash + gross - fee);
  const pnl = r2(gross - fee - p.cost);
  const t = { id: p.id, symbol: p.symbol, mode: p.mode, hedge: Boolean(p.hedge), qty: p.qty, entry: p.entry, exit: px, entryT: p.entryT, exitT: now, pnl, pnlPct: r2(pnl / p.cost * 100), R: p.risk > 0 ? r2(pnl / (p.risk * p.qty)) : null, reason, score: p.score, grade: p.grade, bars: p.bars };
  state.trades.push(t); if (state.trades.length > 500) state.trades.splice(0, state.trades.length - 500);
  state.positions = state.positions.filter((x) => x.id !== p.id);
  note(state, now, `${p.hedge ? 'Hedge' : 'Sold'} ${p.symbol} ${p.qty} @ $${px} (${reason}) ${pnl >= 0 ? '+' : ''}$${pnl}`, { kind: 'exit', symbol: p.symbol, pnl });
  return t;
}

/* Exits on the latest completed bar of each position: stop (fill at the stop, or the open when it gapped through), target,
   trailing stop (swing), max hold, the day session's flat time, or MEM ALGO's own exit signal. */
function manageExits(state, feeds, now, rules = RULES) {
  const closed = [];
  for (const p of state.positions.slice()) {
    if (p.hedge) continue;
    const f = feeds[p.symbol]; if (!f || !f.bar) continue;
    const b = f.bar; if (p.lastBarT && b.t <= p.lastBarT) continue;
    p.lastBarT = b.t; p.bars += 1;
    if (f.atr > 0) p.atr = f.atr;
    if (b.o <= p.stop) { closed.push(closePosition(state, p, b.o, now, 'stop (gap)', rules)); continue; }
    if (b.l <= p.stop) { closed.push(closePosition(state, p, p.stop, now, 'stop', rules)); continue; }
    if (p.target && b.h >= p.target) { closed.push(closePosition(state, p, b.o >= p.target ? b.o : p.target, now, 'target', rules)); continue; }
    if (p.mode === 'day' && minutesET(now) >= rules.dayFlatByMinutesET) { closed.push(closePosition(state, p, b.c, now, 'session end', rules)); continue; }
    if (p.maxHold && p.bars >= p.maxHold) { closed.push(closePosition(state, p, b.c, now, 'time', rules)); continue; }
    if (f.exitSignal) { closed.push(closePosition(state, p, b.c, now, 'exit signal', rules)); continue; }
    // the trailing stop follows this bar's high and applies from the NEXT bar, exactly as in the backtest; it only ever tightens
    if (p.trail && p.atr > 0) { p.ext = Math.max(p.ext || p.entry, b.h); const ts = p.ext - p.trail * p.atr; if (ts > p.stop) p.stop = r4(ts); }
  }
  return closed;
}

/* The inverse-ETF hedge: on when the market read is clearly bearish and the book is exposed, off when the read recovers. */
function manageHedge(state, direction, prices, now, rules = RULES) {
  const h = rules.hedge, held = state.positions.find((p) => p.hedge && p.symbol === h.etf), price = num(prices[h.etf]);
  const bias = direction && direction.ok ? num(direction.bias, 0) : null;
  if (bias == null || !(price > 0)) return null;
  const eq = equityOf(state, prices), exp = exposure(state, prices);
  if (!held && bias <= h.triggerBias && exp >= h.minExposurePct * eq) {
    const notional = Math.min(state.cash * 0.95, exp * h.sizePct); if (notional < rules.minNotional) return null;
    const px = fillPrice(price, 'buy', rules), qty = r4(notional / px), cost = r2(qty * px + commission(qty * px, rules));
    state.cash = r2(state.cash - cost);
    state.positions.push({ id: state.nextId++, symbol: h.etf, hedge: true, mode: 'hedge', qty, entry: px, cost, entryT: now, stop: 0, target: null, trail: null, maxHold: null, bars: 0, risk: 0, score: null, grade: null, reason: `market read ${bias}: hedging ${Math.round(h.sizePct * 100)}% of exposure` });
    note(state, now, `Hedge on: bought ${qty} ${h.etf} @ $${px} with the market read at ${bias}.`, { kind: 'hedge', symbol: h.etf });
    return 'on';
  }
  if (held && (bias >= h.clearBias || exp < rules.minNotional)) { closePosition(state, held, price, now, bias >= h.clearBias ? 'market read recovered' : 'no exposure left', rules); return 'off'; }
  return null;
}

/* Entries: fresh grade-A BUY signals, best first, sized to the risk budget, inside every limit. */
function pickEntries(state, candidates, prices, now, direction, rules = RULES) {
  const opened = [];
  const bias = direction && direction.ok ? num(direction.bias, 0) : 0;
  if (bias <= rules.noNewLongsBelowBias) return opened;
  const eq = equityOf(state, prices);
  const sorted = candidates.filter((c) => c && c.signal && c.signal.dir > 0 && c.score >= rules.minScore).sort((a, b) => b.score - a.score);
  for (const c of sorted) {
    if (state.positions.filter((p) => !p.hedge).length >= rules.maxPositions) break;
    if (state.positions.some((p) => p.symbol === c.symbol)) continue;
    const key = c.symbol + ':' + c.signal.t; if (state.filled[key]) continue;
    if (c.earningsDays != null && c.earningsDays <= rules.earningsBlackoutDays) { state.filled[key] = now; note(state, now, `Skipped ${c.symbol}: earnings in ${c.earningsDays} days.`, { kind: 'skip', symbol: c.symbol }); continue; }
    const price = num(prices[c.symbol]); if (!(price > 0) || !(c.stop > 0) || c.stop >= price) continue;
    const px = fillPrice(price, 'buy', rules), riskPerShare = px - c.stop;
    const riskDollars = eq * (rules.riskPerTrade[c.mode] || rules.riskPerTrade.swing);
    let qty = riskDollars / riskPerShare;
    qty = Math.min(qty, (rules.maxPositionPct * eq) / px, (state.cash * 0.98) / px);
    qty = r4(Math.floor(qty * 10000) / 10000);
    if (qty * px < rules.minNotional) { state.filled[key] = now; continue; }
    const cost = r2(qty * px + commission(qty * px, rules));
    state.cash = r2(state.cash - cost);
    const p = { id: state.nextId++, symbol: c.symbol, mode: c.mode, qty, entry: px, cost, entryT: now, signalT: c.signal.t, stop: r4(c.stop), stop0: r4(c.stop), target: c.target ? r4(c.target) : null, trail: c.trail || null, maxHold: c.maxHold || null, bars: 0, atr: c.atr || null, ext: px, risk: riskPerShare, score: c.score, grade: c.grade, reason: c.reason || '', factors: c.factors || [] };
    state.positions.push(p); state.filled[key] = now; opened.push(p);
    note(state, now, `Bought ${qty} ${c.symbol} @ $${px} (${c.mode}, grade ${c.grade} ${c.score}) stop $${p.stop}${p.target ? ' target $' + p.target : ''}.`, { kind: 'entry', symbol: c.symbol });
  }
  for (const k of Object.keys(state.filled)) if (now - state.filled[k] > 10 * DAY) delete state.filled[k];
  return opened;
}

function recordEquity(state, prices, now, rules = RULES) {
  const value = equityOf(state, prices);
  const last = state.equity[state.equity.length - 1];
  if (last && now - last.t < 4 * 60_000 && last.value === value) return value;
  state.equity.push({ t: now, value, cash: state.cash });
  if (state.equity.length > rules.maxEquityPoints) state.equity = state.equity.filter((_, i) => i % 2 === 0 || i === state.equity.length - 1);
  return value;
}

function stats(state, prices = {}, now = Date.now(), rules = RULES) {
  const equity = equityOf(state, prices), deposited = state.deposits.reduce((s, d) => s + d.amount, 0);
  const closed = state.trades.filter((t) => !t.hedge), wins = closed.filter((t) => t.pnl > 0);
  let peak = 0, dd = 0; for (const e of state.equity) { peak = Math.max(peak, e.value); dd = Math.max(dd, peak > 0 ? (peak - e.value) / peak : 0); }
  const days = Math.max(1, (now - state.startedAt) / DAY);
  const pnl = r2(equity - deposited);
  return { equity, cash: r2(state.cash), deposited: r2(deposited), pnl, returnPct: r2(pnl / Math.max(1, deposited) * 100), progressPct: r2(Math.min(100, equity / rules.goal * 100)), goal: rules.goal, days: Math.round(days), trades: closed.length, winRate: closed.length ? r2(wins.length / closed.length * 100) : null, avgR: closed.length ? r2(closed.reduce((s, t) => s + (t.R || 0), 0) / closed.length) : null, maxDrawdownPct: r2(dd * 100), openPositions: state.positions.filter((p) => !p.hedge).length, hedged: state.positions.some((p) => p.hedge), exposurePct: equity > 0 ? r2(exposure(state, prices) / equity * 100) : 0, pace: pace(state, equity, deposited, now, rules) };
}

/* The pace the target needs from here versus the pace the account is actually running. Needed = the monthly growth that turns
   today's equity plus the remaining deposits into the goal by the deadline (bisection). Realized = monthly growth of each
   dollar put in, once there is at least two weeks of curve. Neither is a forecast. */
const MONTH = 30.44 * DAY;
function pace(state, equity, deposited, now, rules) {
  if (!rules.horizonMonths) return null;
  const deadline = state.startedAt + rules.horizonMonths * MONTH, monthsLeft = Math.max(0, (deadline - now) / MONTH), monthsRun = Math.max(0, (now - state.startedAt) / MONTH);
  const perMonth = rules.weeklyDeposit * (7 * 52 / 12 / 7);
  const fv = (g) => (g <= 0 ? equity + perMonth * monthsLeft : equity * (1 + g) ** monthsLeft + perMonth * ((1 + g) ** monthsLeft - 1) / g);
  let needed = null;
  if (monthsLeft > 0.1) { if (fv(0) >= rules.goal) needed = 0; else { let lo = 0, hi = 5; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (fv(mid) >= rules.goal) hi = mid; else lo = mid; } needed = hi; } }
  const realized = monthsRun >= 0.5 && deposited > 0 ? (equity / deposited) ** (1 / monthsRun) - 1 : null;
  const projected = realized != null && monthsLeft > 0 ? r2(fv(Math.max(-0.5, realized))) : null;
  return { deadline, monthsLeft: r2(monthsLeft), monthsRun: r2(monthsRun), neededMonthlyPct: needed == null ? null : r2(needed * 100), realizedMonthlyPct: realized == null ? null : r2(realized * 100), projectedAtDeadline: projected, onPace: realized != null && needed != null ? realized >= needed : null, note: 'A target, not a promise. Needed pace is what the goal asks from today; realized pace is what the account has actually done.' };
}

/* ------------------------------------------------------------------ the service */
function createChallenge({ store, candles, analyze, ctxFor = null, universe, direction = null, nextEarnings = null, now = Date.now, rules = RULES, logger = () => {}, scanPerTick = 40, name = "Grandmaster-obi's MEM ALGO Challenge" } = {}) {
  let state = null, busy = false, cursor = 0;
  const safe = async (label, fn, ms = 12_000) => { try { return await Promise.race([fn(), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'challenge_input_failed', { input: label, error: String(error && error.message || error) }); return null; } };
  async function load() { if (!state) { const s = await store.read(); state = s && s.version === 1 ? s : freshState(now(), rules); } return state; }
  async function persist() { await store.write(state); }
  const bars5 = async (s) => { const r = await safe('5m:' + s, () => candles(s, '5m')); return r && Array.isArray(r.bars) ? r.bars : []; };
  const bars1d = async (s) => { const r = await safe('1D:' + s, () => candles(s, '1D')); return r && Array.isArray(r.bars) ? r.bars : []; };
  const atrOf = (bars, len = 14) => { if (bars.length < len + 1) return null; let s = 0; for (let i = bars.length - len; i < bars.length; i++) { const b = bars[i], pc = bars[i - 1].c; s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); } return s / len; };

  /* a candidate: run the model on the bars, and only when a BUY just fired, grade it with every data source */
  async function candidate(symbol, mode, t) {
    const tf = mode === 'day' ? '5m' : '1D';
    let bars = mode === 'day' ? await bars5(symbol) : await bars1d(symbol);
    if (mode === 'swing') { const today = etDate(t); bars = bars.filter((b) => etDate(b.t) < today); } // today's daily candle is not complete
    if (bars.length < 120) return null;
    let raw; try { raw = analyze(bars, mode, { minScore: 0 }, tf, {}); } catch (_) { return null; }
    const last = raw.latest; if (!last || last.dir <= 0 || last.i !== bars.length - 1) return null;
    let graded = raw;
    if (ctxFor) { const ctx = await safe('ctx:' + symbol, () => ctxFor(symbol, tf, bars), 20_000); if (ctx) { try { graded = analyze(bars, mode, { minScore: 0 }, tf, ctx); } catch (_) { graded = raw; } } }
    const sig = graded.latest && graded.latest.i === last.i ? graded.latest : null; if (!sig || !sig.conf) return null;
    const earnings = nextEarnings ? await safe('earn:' + symbol, () => nextEarnings(symbol), 6_000) : null;
    const p = graded.params;
    return { symbol, mode, signal: { t: sig.t, dir: sig.dir, i: sig.i }, score: sig.conf.score, grade: sig.conf.grade, factors: sig.conf.factors.filter((f) => f.available).map((f) => ({ key: f.key, pts: f.pts, max: f.max })), stop: sig.stop, target: sig.target, trail: p.trail || null, maxHold: p.maxHold || null, atr: atrOf(bars), earningsDays: earnings && earnings.daysAway != null ? earnings.daysAway : null, reason: sig.conf.factors.filter((f) => f.available && f.ok).map((f) => f.label).join(', ') };
  }

  async function tick(force = false) {
    if (busy) return null; busy = true;
    try {
      const t = now(), ms = marketState(t), open = ms.session === 'regular';
      await load();
      if (!open && !force) { return null; }
      applyDeposit(state, t, rules, ms.tradingDay !== false);
      const held = state.positions.map((p) => p.symbol), feeds = {}, prices = {};
      for (const s of [...new Set(held.concat([rules.hedge.etf]))]) {
        const b5 = await bars5(s); if (!b5.length) continue;
        const bar = b5[b5.length - 1]; prices[s] = bar.c;
        const pos = state.positions.find((p) => p.symbol === s && !p.hedge);
        let exitSignal = false;
        if (pos) { try { const b = pos.mode === 'day' ? b5 : (await bars1d(s)).filter((x) => etDate(x.t) < etDate(t)); if (b.length > 120) { const a = analyze(b, pos.mode, { minScore: 0 }, pos.mode === 'day' ? '5m' : '1D', {}); const lastSig = a.latest; exitSignal = Boolean(lastSig && lastSig.dir < 0 && lastSig.t > pos.signalT) || Boolean(a.confluence && a.confluence.exitWatch && a.confluence.exitWatch.level === 'exit'); } } catch (_) { exitSignal = false; } }
        feeds[s] = { bar, atr: atrOf(b5.slice(-60)) || null, exitSignal };
      }
      const closed = manageExits(state, feeds, t, rules);
      const dir = direction ? await safe('direction', () => direction(), 8_000) : null;
      manageHedge(state, dir, prices, t, rules);
      // entries: a slice of the universe each tick so the data feed is never burst; swing on daily candles, day on 5m
      let list = []; try { list = (await universe()) || []; } catch (error) { logger('warn', 'challenge_universe_failed', { error: String(error && error.message || error) }); }
      list = list.filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase())).map((r) => String(r.symbol).toUpperCase());
      const opened = [];
      if (list.length && state.positions.filter((p) => !p.hedge).length < rules.maxPositions && num(dir && dir.bias, 0) > rules.noNewLongsBelowBias) {
        const slice = []; for (let k = 0; k < Math.min(scanPerTick, list.length); k++) slice.push(list[(cursor + k) % list.length]); cursor = (cursor + scanPerTick) % Math.max(1, list.length);
        const cands = [];
        for (const s of slice) { if (held.includes(s)) continue; for (const mode of ['swing', 'day']) { const c = await candidate(s, mode, t); if (c) { cands.push(c); const b5 = await bars5(s); if (b5.length) prices[s] = b5[b5.length - 1].c; } } }
        opened.push(...pickEntries(state, cands, prices, t, dir, rules));
      }
      const value = recordEquity(state, prices, t, rules);
      state.lastTick = t; state.lastPrices = prices;
      await persist();
      return { equity: value, closed: closed.length, opened: opened.length };
    } catch (error) { logger('error', 'challenge_tick_failed', { error: String(error && error.message || error) }); return null; }
    finally { busy = false; }
  }

  async function snapshot() {
    await load();
    const prices = state.lastPrices || {};
    return { ok: true, name, simulated: true, asOf: now(), lastTick: state.lastTick, startedAt: state.startedAt, rules: { start: rules.start, goal: rules.goal, weeklyDeposit: rules.weeklyDeposit, horizonMonths: rules.horizonMonths, riskPerTrade: rules.riskPerTrade, maxPositions: rules.maxPositions, maxPositionPct: rules.maxPositionPct, minScore: rules.minScore, earningsBlackoutDays: rules.earningsBlackoutDays, hedge: rules.hedge, costBps: rules.costBps, slippageBps: rules.slippageBps },
      stats: stats(state, prices, now(), rules), positions: state.positions.map((p) => ({ ...p, price: num(prices[p.symbol], p.entry), value: r2(p.qty * num(prices[p.symbol], p.entry)), pnl: r2(p.qty * num(prices[p.symbol], p.entry) - p.cost), factors: undefined })),
      trades: state.trades.slice(-40).reverse(), deposits: state.deposits.slice(-20).reverse(), equity: state.equity.slice(-600), log: state.log.slice(-40).reverse(),
      disclaimer: 'SIMULATED portfolio on real market prices. No real money, no advice, no guarantee: a model that grades setups is not a promise of returns. Educational only.' };
  }
  async function reset() { state = freshState(now(), rules); await persist(); return snapshot(); }
  return { tick, snapshot, reset, rules };
}

module.exports = { RULES, createChallenge, freshState, applyDeposit, manageExits, manageHedge, pickEntries, recordEquity, stats, equityOf, exposure, weekKey, fillPrice };
