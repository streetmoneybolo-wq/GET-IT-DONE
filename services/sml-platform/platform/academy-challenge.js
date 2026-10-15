'use strict';

/* The $1,000 -> $100,000 challenge, Grandmaster-obi's: MEM ALGO finds the trades, the owner takes them with one click, the
 * paper-trading simulator holds the money. Every five minutes in market hours this engine
 *   - adds the weekly deposit to the challenge paper account on the first open day of the week,
 *   - scans the moving names and, when the full confluence grades a BUY high enough, raises an IDEA sized to the rules
 *     (entry, stop, target, shares, why) and notifies the owner (Academy pop-up, push, Discord DM),
 *   - manages the exits of the ideas that were taken: stop (gap-aware), target, trailing stop, max hold, the day session's
 *     close, or MEM ALGO's own exit signal, selling in the paper account with the fills it would really get.
 * Ideas that are not taken expire. Nothing is bought without the click. SIMULATED throughout; educational only. */

const { marketState, etParts } = require('./market-clock');

const RULES = Object.freeze({
  goal: 100000, weeklyDeposit: 250, riskPerTrade: { swing: 0.03, day: 0.015 }, maxPositions: 8, maxPositionPct: 0.35, minNotional: 25, minScore: 70,
  earningsBlackoutDays: 5, noNewLongsBelowBias: -30, dayFlatByMinutesET: 945, ideaTtlMs: { day: 2 * 3_600_000, swing: 2 * 86_400_000 }, maxIdeas: 300
});
const DAY = 86_400_000;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const etDate = (ms) => { const e = etParts(ms); return `${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`; };
const minutesET = (ms) => { const e = etParts(ms); return e.hh * 60 + e.mm; };
function weekKey(ms) { const e = etParts(ms); const d = new Date(Date.UTC(e.y, e.m - 1, e.d)); const day = d.getUTCDay(); return new Date(d.getTime() - ((day + 6) % 7) * DAY).toISOString().slice(0, 10); }

function freshState(now = Date.now()) { return { version: 2, startedAt: now, lastDepositWeek: weekKey(now), ideas: [], log: [], nextId: 1, seen: {}, lastTick: null }; }
function note(state, now, text, extra = {}) { state.log.push({ t: now, text, ...extra }); if (state.log.length > 300) state.log.splice(0, state.log.length - 300); }

/* shares for an idea: the risk budget to the stop, capped by the position limit and cash */
function sizeIdea(c, equity, cash, rules = RULES) {
  const price = num(c.entry), stop = num(c.stop); if (!(price > 0) || !(stop > 0) || stop >= price) return 0;
  const risk = equity * (rules.riskPerTrade[c.mode] || rules.riskPerTrade.swing);
  let qty = risk / (price - stop);
  qty = Math.min(qty, (rules.maxPositionPct * equity) / price, (cash * 0.98) / price);
  qty = r4(Math.floor(qty * 10000) / 10000);
  return qty * price >= rules.minNotional ? qty : 0;
}

/* a candidate becomes an idea when it clears the score, is not already open or pending, is outside the earnings blackout, and the market read allows buying */
function raiseIdeas(state, candidates, account, direction, now, rules = RULES) {
  const out = [];
  const bias = direction && direction.ok ? num(direction.bias, 0) : 0;
  if (bias <= rules.noNewLongsBelowBias) return out;
  const openSymbols = new Set(Object.values(account.positions || {}).map((p) => p.symbol));
  const pending = new Set(state.ideas.filter((i) => i.status === 'new').map((i) => i.symbol));
  const equity = num(account.equity, 0), cash = num(account.cash, 0);
  const openCount = Object.keys(account.positions || {}).length;
  for (const c of candidates.filter((x) => x && x.signal && x.signal.dir > 0 && x.score >= rules.minScore).sort((a, b) => b.score - a.score)) {
    const key = c.symbol + ':' + c.signal.t;
    if (state.seen[key] || openSymbols.has(c.symbol) || pending.has(c.symbol)) continue;
    state.seen[key] = now;
    if (c.earningsDays != null && c.earningsDays <= rules.earningsBlackoutDays) { note(state, now, `Passed on ${c.symbol}: earnings in ${c.earningsDays} days.`, { kind: 'skip', symbol: c.symbol }); continue; }
    if (openCount + pending.size >= rules.maxPositions) { note(state, now, `Passed on ${c.symbol}: the book is full (${rules.maxPositions}).`, { kind: 'skip', symbol: c.symbol }); continue; }
    const qty = sizeIdea(c, equity, cash, rules);
    if (!qty) { note(state, now, `Passed on ${c.symbol}: too small to size against the stop.`, { kind: 'skip', symbol: c.symbol }); continue; }
    const idea = { id: state.nextId++, t: now, status: 'new', symbol: c.symbol, mode: c.mode, signalT: c.signal.t, score: c.score, grade: c.grade, entry: r4(c.entry), stop: r4(c.stop), target: c.target ? r4(c.target) : null, trail: c.trail || null, maxHold: c.maxHold || null, atr: c.atr ? r4(c.atr) : null, qty, riskDollars: r2(qty * (c.entry - c.stop)), notional: r2(qty * c.entry), reason: c.reason || '', factors: c.factors || [], expiresAt: now + (rules.ideaTtlMs[c.mode] || rules.ideaTtlMs.swing) };
    state.ideas.push(idea); pending.add(c.symbol); out.push(idea);
    note(state, now, `Idea: BUY ${qty} ${c.symbol} (${c.mode}, grade ${c.grade} ${c.score}) near $${idea.entry}, stop $${idea.stop}${idea.target ? ', target $' + idea.target : ''}.`, { kind: 'idea', symbol: c.symbol, ideaId: idea.id });
  }
  if (state.ideas.length > rules.maxIdeas) state.ideas.splice(0, state.ideas.length - rules.maxIdeas);
  for (const k of Object.keys(state.seen)) if (now - state.seen[k] > 14 * DAY) delete state.seen[k];
  return out;
}
function expireIdeas(state, now) { let n = 0; for (const i of state.ideas) if (i.status === 'new' && now > i.expiresAt) { i.status = 'expired'; n++; } return n; }

/* exits for taken ideas, judged on the latest completed bar of the symbol: returns the sells to place */
function planExits(state, positions, feeds, now, rules = RULES) {
  const sells = [];
  for (const i of state.ideas) {
    if (i.status !== 'taken') continue;
    const p = positions[i.symbol]; if (!p || !(p.qty > 0)) { i.status = 'closed'; i.closedAt = now; i.exitReason = i.exitReason || 'closed by hand'; continue; }
    const f = feeds[i.symbol]; if (!f || !f.bar) continue;
    const b = f.bar; if (i.lastBarT && b.t <= i.lastBarT) continue;
    i.lastBarT = b.t; i.bars = (i.bars || 0) + 1; if (f.atr > 0) i.atr = r4(f.atr);
    let reason = null, price = b.c;
    if (b.o <= i.stop) { reason = 'stop (gap)'; price = b.o; }
    else if (b.l <= i.stop) { reason = 'stop'; price = i.stop; }
    else if (i.target && b.h >= i.target) { reason = 'target'; price = b.o >= i.target ? b.o : i.target; }
    else if (i.mode === 'day' && minutesET(now) >= rules.dayFlatByMinutesET) reason = 'session end';
    else if (i.maxHold && i.bars >= i.maxHold) reason = 'time';
    else if (f.exitSignal) reason = 'exit signal';
    if (reason) { sells.push({ idea: i, qty: p.qty, reason, price }); continue; }
    if (i.trail && i.atr > 0) { i.ext = Math.max(i.ext || i.entry, b.h); const ts = i.ext - i.trail * i.atr; if (ts > i.stop) i.stop = r4(ts); }
  }
  return sells;
}

function createChallenge({ store, paper, candles, analyze, ctxFor = null, universe, direction = null, nextEarnings = null, notify = null, now = Date.now, rules = RULES, logger = () => {}, scanPerTick = 40, accountId = 'challenge', accountOpts = { cash: 1000, name: "Grandmaster-obi's Challenge" } } = {}) {
  let state = null, busy = false, cursor = 0;
  const safe = async (label, fn, ms = 12_000) => { try { return await Promise.race([fn(), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'challenge_input_failed', { input: label, error: String(error && error.message || error) }); return null; } };
  async function load() { if (!state) { const s = await store.read(); state = s && s.version === 2 ? s : freshState(now()); } return state; }
  const persist = () => store.write(state);
  const bars5 = async (s) => { const r = await safe('5m:' + s, () => candles(s, '5m')); return r && Array.isArray(r.bars) ? r.bars : []; };
  const bars1d = async (s) => { const r = await safe('1D:' + s, () => candles(s, '1D')); return r && Array.isArray(r.bars) ? r.bars : []; };
  const atrOf = (bars, len = 14) => { if (bars.length < len + 1) return null; let s = 0; for (let i = bars.length - len; i < bars.length; i++) { const b = bars[i], pc = bars[i - 1].c; s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); } return s / len; };
  const account = async () => { const acct = await paper.load(accountId, accountOpts); const summary = Object.values(acct.positions).reduce((s, p) => s + p.qty * p.mark * (p.kind === 'option' ? 100 : 1), 0); return { positions: Object.fromEntries(Object.values(acct.positions).filter((p) => p.kind === 'stock').map((p) => [p.symbol, p])), cash: acct.cash, equity: r2(acct.cash + summary) }; };

  async function candidate(symbol, mode, t) {
    const tf = mode === 'day' ? '5m' : '1D';
    let bars = mode === 'day' ? await bars5(symbol) : await bars1d(symbol);
    if (mode === 'swing') { const today = etDate(t); bars = bars.filter((b) => etDate(b.t) < today); }
    if (bars.length < 120) return null;
    let raw; try { raw = analyze(bars, mode, { minScore: 0 }, tf, {}); } catch (_) { return null; }
    const last = raw.latest; if (!last || last.dir <= 0 || last.i !== bars.length - 1) return null;
    let graded = raw;
    if (ctxFor) { const ctx = await safe('ctx:' + symbol, () => ctxFor(symbol, tf, bars), 20_000); if (ctx) { try { graded = analyze(bars, mode, { minScore: 0 }, tf, ctx); } catch (_) { graded = raw; } } }
    const sig = graded.latest && graded.latest.i === last.i ? graded.latest : null; if (!sig || !sig.conf) return null;
    const live = await bars5(symbol); const entry = live.length ? num(live[live.length - 1].c) : num(sig.price);
    const earnings = nextEarnings ? await safe('earn:' + symbol, () => nextEarnings(symbol), 6_000) : null;
    const p = graded.params;
    return { symbol, mode, signal: { t: sig.t, dir: sig.dir, i: sig.i }, score: sig.conf.score, grade: sig.conf.grade, entry, stop: sig.stop, target: sig.target, trail: p.trail || null, maxHold: p.maxHold || null, atr: atrOf(bars), earningsDays: earnings && earnings.daysAway != null ? earnings.daysAway : null, factors: sig.conf.factors.filter((f) => f.available).map((f) => ({ key: f.key, label: f.label, pts: f.pts, max: f.max, ok: f.ok })), reason: sig.conf.factors.filter((f) => f.available && f.ok).map((f) => f.label).join(', ') };
  }

  async function tick(force = false) {
    if (busy) return null; busy = true;
    try {
      const t = now(), ms = marketState(t), open = ms.session === 'regular';
      await load();
      if (!open && !force) return null;
      const wk = weekKey(t);
      if (wk !== state.lastDepositWeek && ms.tradingDay !== false) { await paper.addDeposit(accountId, rules.weeklyDeposit, 'weekly'); state.lastDepositWeek = wk; note(state, t, `Weekly deposit of $${rules.weeklyDeposit} added to the challenge account.`, { kind: 'deposit' }); }
      // exits first, on the ideas that were taken
      let acct = await account();
      const feeds = {};
      for (const i of state.ideas) {
        if (i.status !== 'taken' || feeds[i.symbol]) continue;
        const b5 = await bars5(i.symbol); if (!b5.length) continue;
        let exitSignal = false;
        try { const b = i.mode === 'day' ? b5 : (await bars1d(i.symbol)).filter((x) => etDate(x.t) < etDate(t)); if (b.length > 120) { const a = analyze(b, i.mode, { minScore: 0 }, i.mode === 'day' ? '5m' : '1D', {}); exitSignal = Boolean(a.latest && a.latest.dir < 0 && a.latest.t > i.signalT) || Boolean(a.confluence && a.confluence.exitWatch && a.confluence.exitWatch.level === 'exit'); } } catch (_) { exitSignal = false; }
        feeds[i.symbol] = { bar: b5[b5.length - 1], atr: atrOf(b5.slice(-60)) || null, exitSignal };
      }
      const sells = planExits(state, acct.positions, feeds, t, rules);
      for (const s of sells) {
        const res = await paper.order(accountId, { kind: 'stock', symbol: s.idea.symbol, side: 'sell', qty: s.qty, note: 'MEM ALGO exit: ' + s.reason, ideaId: String(s.idea.id) }, accountOpts);
        if (res && res.ok) { s.idea.status = 'closed'; s.idea.closedAt = t; s.idea.exitReason = s.reason; s.idea.exitPrice = res.trade.price; s.idea.realized = res.realized; note(state, t, `Sold ${s.qty} ${s.idea.symbol} @ $${res.trade.price} (${s.reason}) ${res.realized >= 0 ? '+' : ''}$${res.realized}.`, { kind: 'exit', symbol: s.idea.symbol, ideaId: s.idea.id }); }
        else note(state, t, `Could not sell ${s.idea.symbol} (${res && (res.message || res.error)}); will retry.`, { kind: 'warn', symbol: s.idea.symbol });
      }
      expireIdeas(state, t);
      // then new ideas from a slice of the universe
      const dir = direction ? await safe('direction', () => direction(), 8_000) : null;
      let list = []; try { list = (await universe()) || []; } catch (error) { logger('warn', 'challenge_universe_failed', { error: String(error && error.message || error) }); }
      list = list.filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase())).map((r) => String(r.symbol).toUpperCase());
      const raised = [];
      if (list.length && num(dir && dir.bias, 0) > rules.noNewLongsBelowBias) {
        acct = await account();
        const slice = []; for (let k = 0; k < Math.min(scanPerTick, list.length); k++) slice.push(list[(cursor + k) % list.length]); cursor = (cursor + scanPerTick) % Math.max(1, list.length);
        const cands = [];
        for (const s of slice) { if (acct.positions[s]) continue; for (const mode of ['swing', 'day']) { const c = await candidate(s, mode, t); if (c) cands.push(c); } }
        raised.push(...raiseIdeas(state, cands, acct, dir, t, rules));
      }
      state.lastTick = t;
      await persist();
      if (notify) for (const idea of raised) { try { await notify(idea); } catch (error) { logger('warn', 'challenge_notify_failed', { error: String(error && error.message || error) }); } }
      return { raised: raised.length, sold: sells.length };
    } catch (error) { logger('error', 'challenge_tick_failed', { error: String(error && error.message || error) }); return null; }
    finally { busy = false; }
  }

  async function take(id, { qty = null } = {}) {
    await load();
    const idea = state.ideas.find((i) => i.id === Number(id)); if (!idea) return { ok: false, error: 'not_found' };
    if (idea.status !== 'new') return { ok: false, error: 'idea_' + idea.status };
    const q = num(qty) > 0 ? r4(num(qty)) : idea.qty;
    const res = await paper.order(accountId, { kind: 'stock', symbol: idea.symbol, side: 'buy', qty: q, note: `1K→100K idea #${idea.id}: ${idea.mode} grade ${idea.grade} ${idea.score}`, ideaId: String(idea.id) }, accountOpts);
    if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'order_failed', message: res && res.message };
    idea.status = 'taken'; idea.takenAt = now(); idea.fill = res.trade.price; idea.qty = q; idea.ext = res.trade.price;
    note(state, now(), `Taken: bought ${q} ${idea.symbol} @ $${res.trade.price}.`, { kind: 'entry', symbol: idea.symbol, ideaId: idea.id });
    await persist();
    return { ok: true, idea, trade: res.trade };
  }
  async function skip(id) { await load(); const idea = state.ideas.find((i) => i.id === Number(id)); if (!idea) return { ok: false, error: 'not_found' }; if (idea.status === 'new') { idea.status = 'skipped'; note(state, now(), `Skipped idea #${idea.id} ${idea.symbol}.`, { kind: 'skip', ideaId: idea.id }); await persist(); } return { ok: true, idea }; }
  async function ideas({ since = 0, limit = 40 } = {}) { await load(); expireIdeas(state, now()); return state.ideas.filter((i) => i.t > since).slice(-limit).reverse(); }
  async function snapshot() {
    await load(); expireIdeas(state, now());
    const snap = await paper.snapshot(accountId, accountOpts);
    const byId = Object.fromEntries(state.ideas.map((i) => [i.id, i]));
    return { ok: true, simulated: true, name: accountOpts.name, asOf: now(), lastTick: state.lastTick, startedAt: state.startedAt, rules: { goal: rules.goal, weeklyDeposit: rules.weeklyDeposit, riskPerTrade: rules.riskPerTrade, maxPositions: rules.maxPositions, maxPositionPct: rules.maxPositionPct, minScore: rules.minScore, earningsBlackoutDays: rules.earningsBlackoutDays, noNewLongsBelowBias: rules.noNewLongsBelowBias },
      paper: snap, progressPct: r2(Math.min(100, snap.summary.equity / rules.goal * 100)), ideas: state.ideas.slice(-30).reverse(), open: state.ideas.filter((i) => i.status === 'taken').map((i) => ({ id: i.id, symbol: i.symbol, mode: i.mode, stop: i.stop, target: i.target, trail: i.trail, bars: i.bars || 0, grade: i.grade, score: i.score })), log: state.log.slice(-40).reverse(),
      disclaimer: 'SIMULATED account on real market prices. Ideas are MEM ALGO reads, taken only by the owner\'s click. No real money, no advice, no guarantee. Educational only.', byId };
  }
  async function reset() { state = freshState(now()); await persist(); await paper.reset(accountId, accountOpts); return snapshot(); }
  return { tick, take, skip, ideas, snapshot, reset, rules };
}

module.exports = { RULES, createChallenge, freshState, sizeIdea, raiseIdeas, expireIdeas, planExits, weekKey };
